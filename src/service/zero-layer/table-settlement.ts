import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { getApiConfigByPreset_ACU, requireResolvedApiPreset_ACU } from '../ai/api-call';
import { getCurrentStorageMode } from '../table/storage-mode';
import { createDetachedSqlTableService_ACU } from '../table/table-storage-strategy';
import { captureSqlTableApplyScope_ACU } from '../table/sql-table-service';
import { buildAutoUpdatePlan_ACU } from '../table/update-scheduler';
import { collectGroupFillResponse_ACU, applyUnifiedGroupFillResponses_ACU, resolveTableApiPresetOverride_ACU, resolveUpdateMode_ACU } from '../table/update-orchestrator';
import { createTableFillStagingRunContext_ACU } from '../table/table-fill-boundary-staging';
import { createTableFillStagingSession_ACU } from '../table/table-fill-staging-session';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { createLorebookReadContext_ACU } from '../worldbook/read-context';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU, readZeroLayerCarrier_ACU } from './carrier-context';
import { ZeroLayerError_ACU, type ZeroLayerTableCandidate_ACU, type ZeroLayerTableResult_ACU } from './model';
import { buildZeroLayerTimeline_ACU, projectZeroLayerPromptHistory_ACU, type ZeroLayerFloorRef_ACU } from './timeline';
import { validateZeroLayerTableResult_ACU, validateZeroLayerTableData_ACU, validateZeroLayerTableCandidate_ACU } from './validation';
import type { ZeroLayerResponseSettlement_ACU } from './session';
import type { ZeroLayerStore_ACU } from './store';

/** 正文已持久化后才进入；仅产出逻辑回合候选，不调用物理表格写口。 */
export function createZeroLayerTableSettlement_ACU(store: ZeroLayerStore_ACU): ZeroLayerResponseSettlement_ACU {
  return async (envelope, turnId, attemptId, signal) => {
    const context = captureZeroLayerCarrier_ACU();
    let current = envelope;
    const turn = current.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
    if (!turn || turn.branchId !== current.activeBranchId || turn.phase !== 'response-durable' || !turn.tableInput) {
      throw new ZeroLayerError_ACU('effects-pending', '回合缺少已保存正文或可恢复的表格基底。');
    }
    const input = turn.tableInput;
    const assertCurrent = () => {
      if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '表格结算已中止。');
      assertZeroLayerCarrier_ACU(context);
      const live = readZeroLayerCarrier_ACU(context);
      if (!live?.enabled || live.sessionId !== current.sessionId || live.revision !== current.revision
        || live.activeBranchId !== current.activeBranchId || String(currentChatFileIdentifier_ACU) !== input.chatKey
        || getCurrentIsolationKey_ACU() !== input.isolationKey || getCurrentStorageMode() !== input.storageMode) {
        throw new ZeroLayerError_ACU('revision-conflict', '表格结算作用域或 revision 已变化。');
      }
    };

    assertCurrent();
    const effectId = JSON.stringify([current.sessionId, turnId, attemptId, 'table']);
    const previousReceipt = turn.effectReceipts.find(receipt => receipt.kind === 'table');
    if (previousReceipt) {
      const result = turn.assistantFloor.data.table;
      validateZeroLayerTableResult_ACU(result, turn.assistantFloor.floorId);
      if (previousReceipt.effectId !== effectId || previousReceipt.status !== 'durable'
        || previousReceipt.fingerprint !== getTableDataFingerprint_ACU(result)) {
        throw new ZeroLayerError_ACU('corrupt-data', '表格回执与持久结果不匹配。');
      }
      return;
    }

    const timeline = buildZeroLayerTimeline_ACU(current, context.chat as Record<string, unknown>[]);
    const messages = projectZeroLayerPromptHistory_ACU(timeline, turn.input);
    messages.push({ mes: turn.body!, is_user: false, is_system: false });
    const aiMessageIndices = timeline.floors.flatMap((floor, index) => floor.aiOrdinal !== null ? [index] : []);
    aiMessageIndices.push(messages.length - 1);
    const updateMode = resolveUpdateMode_ACU('auto');
    const logicalTarget: ZeroLayerFloorRef_ACU & { kind: 'logical' } = {
      kind: 'logical', sessionId: current.sessionId, branchId: turn.branchId,
      turnId, floorId: turn.assistantFloor.floorId, role: 'assistant',
    };
    let candidate: ZeroLayerTableCandidate_ACU = structuredClone(turn.tableCandidate ?? {
      floorId: logicalTarget.floorId, tableData: input.tableData,
      completedAiFloorBySheetKey: input.completedAiFloorBySheetKey,
      filledSheetKeys: [], completedBucketIds: [],
    });
    validateZeroLayerTableCandidate_ACU(candidate, logicalTarget.floorId);

    // 始终从请求前持久基底规划，不能用已完成候选重新分批而改变桶身份。
    const templateData = input.storageMode === 'sqlite'
      ? captureSqlTableApplyScope_ACU({
        chat: [], isolationKey: input.isolationKey, templateData: input.templateData,
      }).templateData
      : input.templateData;
    const templateKeys = Object.keys(templateData).filter(key => key.startsWith('sheet_'));
    const templateScope = { sheetKeys: new Set(templateKeys), sheets: Object.fromEntries(
      templateKeys.map(key => [key, structuredClone(templateData[key] as Sheet_ACU)]),
    ) };
    const schedulingData: TableDataObject_ACU = { mate: input.tableData.mate, ...Object.fromEntries(
      templateKeys.map(key => [key, structuredClone(input.tableData[key] ?? templateData[key])]),
    ) };
    if (input.autoUpdateEnabled && !input.scheduling) {
      throw new ZeroLayerError_ACU('effects-pending', '持久表格输入缺少调度快照，禁止推测恢复计划。');
    }
    const plan = input.autoUpdateEnabled
      ? buildAutoUpdatePlan_ACU(messages, schedulingData, input.scheduling, input.isolationKey, undefined, {
        lastCompletedAiFloorBySheetKey: input.completedAiFloorBySheetKey, aiMessageIndices,
      })
      : { updateGroups: {} };
    const buckets = Object.entries(plan.updateGroups).flatMap(([groupKey, group]) => {
      const batchSize = Math.max(1, Math.trunc(group.batchSize));
      return Array.from({ length: Math.ceil(group.indices.length / batchSize) }, (_, offset) => {
        const indices = group.indices.slice(offset * batchSize, (offset + 1) * batchSize);
        const sheetKeys = [...group.sheetKeys].sort();
        return { groupKey, group, indices, sheetKeys, batchNumber: offset + 1,
          id: JSON.stringify([logicalTarget.floorId, groupKey, offset + 1, indices, sheetKeys]) };
      });
    }).sort((left, right) => left.indices[left.indices.length - 1] - right.indices[right.indices.length - 1]
      || left.groupKey.localeCompare(right.groupKey) || left.batchNumber - right.batchNumber);
    if (candidate.completedBucketIds.some(id => !buckets.some(bucket => bucket.id === id))) {
      throw new ZeroLayerError_ACU('corrupt-data', '持久表格桶不属于本回合固定调度计划。');
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try {
      for (const bucket of buckets) {
        if (candidate.completedBucketIds.includes(bucket.id)) continue;
        assertCurrent();
        const run = createTableFillStagingRunContext_ACU({
          runId: bucket.id, chatKey: input.chatKey, isolationKey: input.isolationKey,
          targetSheetKeys: bucket.sheetKeys, originalFullIndex: null,
          templateFingerprint: getTableDataFingerprint_ACU(templateData), logicalTarget, storageMode: input.storageMode,
        });
        const stagingSession = createTableFillStagingSession_ACU(run, assertCurrent);
        const readProvider = input.storageMode === 'sqlite' ? createDetachedSqlTableService_ACU() : null;
        const worldbookReadContext = createLorebookReadContext_ACU({
          source: 'zero-layer-table', isAborted: () => signal.aborted,
          isActive: () => { try { assertCurrent(); return true; } catch { return false; } },
        });
        try {
          const baseSnapshot = structuredClone(candidate.tableData);
          // 缺失表只在本桶隔离副本中从持久模板建底；完成后仍仅合并授权目标表。
          for (const key of bucket.sheetKeys) {
            if (!baseSnapshot[key]) baseSnapshot[key] = structuredClone(input.templateData[key]);
          }
          validateZeroLayerTableData_ACU(baseSnapshot);
          if (readProvider) {
            const loaded = await readProvider.loadFromData(baseSnapshot);
            assertCurrent();
            if (loaded.error || !readProvider.isReady()) {
              throw new ZeroLayerError_ACU('effects-pending', '表格结算的独立 SQLite 快照未能就绪。');
            }
          }
          const runtimeData = readProvider?.getCurrentDataStrict_ACU();
          const sqlApplyScope = input.storageMode === 'sqlite' ? captureSqlTableApplyScope_ACU({
            chat: [], isolationKey: input.isolationKey, templateData: input.templateData, runtimeData,
          }) : undefined;
          const presetName = resolveTableApiPresetOverride_ACU((schedulingData[bucket.sheetKeys[0]] as Sheet_ACU).name)
            || settings_ACU.tableApiPreset || '';
          const apiPresetSnapshot = structuredClone(getApiConfigByPreset_ACU(presetName));
          requireResolvedApiPreset_ACU(presetName, apiPresetSnapshot);
          if (apiPresetSnapshot.apiMode !== 'custom' || !apiPresetSnapshot.apiConfig.url || !apiPresetSnapshot.apiConfig.model) {
            throw new ZeroLayerError_ACU('effects-pending', '逻辑填表需要数据库独立 API 配置。');
          }
          const lastIndex = bucket.indices[bucket.indices.length - 1];
          const firstAiOffset = aiMessageIndices.indexOf(bucket.indices[0]);
          const sliceStart = firstAiOffset > 0 ? aiMessageIndices[firstAiOffset - 1] + 1 : 0;
          const response = await collectGroupFillResponse_ACU({
            isolatedSnapshot: true, logicalTarget, groupKey: bucket.groupKey,
            groupId: bucket.group.groupId, batchNumber: bucket.batchNumber, targetSheetKeys: bucket.sheetKeys,
            messagesForContext: messages.slice(sliceStart, lastIndex + 1), updateMode,
            baseSnapshot, isImportMode: false, chatKey: input.chatKey, isolationKey: input.isolationKey,
            templateScope, sqlApplyScope,
            requestOptions: { isolatedSnapshot: true, forceDirectApi: true, skipProfileSwitch: true,
              tableApiPreset: presetName, apiPresetSnapshot, streaming: settings_ACU.streamingEnabled === true,
              sqlReadContext: readProvider ? { provider: readProvider, mapper: readProvider.createReadNameMapper_ACU(),
                tableData: runtimeData! } : null },
          }, undefined, controller, { respectGlobalStop: false, assertCurrent, worldbookReadContext });
          assertCurrent();
          if (!response.success) throw new ZeroLayerError_ACU('effects-pending', '逻辑填表请求未取得可应用的完整结果。');
          const applied = await applyUnifiedGroupFillResponses_ACU([response], baseSnapshot, {
            logicalTarget, updateMode, isImportMode: false, chatKey: input.chatKey,
            isolationKey: input.isolationKey, templateScope, sqlApplyScope,
            commitMode: 'stage_only', stagingSession, syncAfterCommit: false,
          });
          assertCurrent();
          if (!applied.success || !applied.tableData) {
            throw new ZeroLayerError_ACU('effects-pending', '逻辑填表候选应用失败，尚未确认本桶。');
          }
          // 仅合并授权目标表，detached runtime 的活动表投影不能删除其他持久表。
          const tableData = structuredClone(candidate.tableData);
          for (const key of bucket.sheetKeys) tableData[key] = structuredClone(applied.tableData[key]);
          validateZeroLayerTableData_ACU(tableData);
          const frontier = { ...candidate.completedAiFloorBySheetKey };
          for (const key of bucket.sheetKeys) frontier[key] = aiMessageIndices.indexOf(lastIndex) + 1;
          const nextCandidate = { floorId: logicalTarget.floorId, tableData, completedAiFloorBySheetKey: frontier,
            filledSheetKeys: [...new Set([...candidate.filledSheetKeys, ...bucket.sheetKeys])].sort(),
            completedBucketIds: [...candidate.completedBucketIds, bucket.id] };
          current = await store.commit({ type: 'stage-table', turnId, attemptId, candidate: nextCandidate }, current.revision);
          candidate = current.turns.find(item => item.turnId === turnId)!.tableCandidate!;
          assertCurrent();
        } finally {
          worldbookReadContext.dispose();
          readProvider?.dispose();
          await stagingSession.discard();
        }
      }
      const { completedBucketIds: _completed, ...result } = candidate;
      validateZeroLayerTableResult_ACU(result, logicalTarget.floorId);
      assertCurrent();
      current = await store.commit({ type: 'record-effect', turnId, attemptId,
        receipt: { effectId, kind: 'table', status: 'durable', fingerprint: getTableDataFingerprint_ACU(result) },
        assistantData: { table: result as ZeroLayerTableResult_ACU },
      }, current.revision);
      assertCurrent();
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
}