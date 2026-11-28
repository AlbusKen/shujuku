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
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerTableCandidate_ACU, type ZeroLayerTableResult_ACU } from './model';
import { buildZeroLayerTimeline_ACU, getPublishedZeroLayerPath_ACU, projectZeroLayerPromptHistory_ACU, type ZeroLayerFloorRef_ACU } from './timeline';
import { validateZeroLayerTableResult_ACU, validateZeroLayerTableData_ACU, validateZeroLayerTableCandidate_ACU } from './validation';
import type { ZeroLayerResponseSettlement_ACU } from './session';
import type { ZeroLayerStore_ACU } from './store';

const ZERO_LAYER_TABLE_BUCKET_TIMEOUT_MS_ACU = 45_000;

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
    signal.addEventListener('abort', abort, { once: true }); // arch-ok: AbortSignal 取消结算请求，非 DOM 监听；finally 释放。
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
          const bucketController = new AbortController();
          const forwardAbort = () => bucketController.abort();
          controller.signal.addEventListener('abort', forwardAbort, { once: true });
          if (controller.signal.aborted) forwardAbort();
          let bucketTimedOut = false;
          let bucketTimer: ReturnType<typeof setTimeout> | null = null;
          const timeoutPromise = new Promise<never>((_, reject) => {
            bucketTimer = setTimeout(() => {
              bucketTimedOut = true;
              bucketController.abort();
              reject(new ZeroLayerError_ACU('effects-pending', '逻辑填表结算超时，将沿用当前表底顺延至下轮补齐。'));
            }, ZERO_LAYER_TABLE_BUCKET_TIMEOUT_MS_ACU);
          });
          let response;
          try {
            const fillPromise = collectGroupFillResponse_ACU({
              isolatedSnapshot: true, logicalTarget, groupKey: bucket.groupKey,
              groupId: bucket.group.groupId, batchNumber: bucket.batchNumber, targetSheetKeys: bucket.sheetKeys,
              messagesForContext: messages.slice(sliceStart, lastIndex + 1), updateMode,
              baseSnapshot, isImportMode: false, chatKey: input.chatKey, isolationKey: input.isolationKey,
              templateScope, sqlApplyScope,
              requestOptions: { isolatedSnapshot: true, forceDirectApi: true, skipProfileSwitch: true,
                tableApiPreset: presetName, apiPresetSnapshot, streaming: settings_ACU.streamingEnabled === true,
                sqlReadContext: readProvider ? { provider: readProvider, mapper: readProvider.createReadNameMapper_ACU(),
                  tableData: runtimeData! } : null },
            }, undefined, bucketController, { respectGlobalStop: false, assertCurrent, worldbookReadContext });
            fillPromise.catch(() => {});
            response = await Promise.race([fillPromise, timeoutPromise]);
          } finally {
            if (bucketTimer !== null) clearTimeout(bucketTimer);
            controller.signal.removeEventListener('abort', forwardAbort);
          }
          if (bucketTimedOut) {
            throw new ZeroLayerError_ACU('effects-pending', '逻辑填表结算超时，将沿用当前表底顺延至下轮补齐。');
          }
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

/**
 * 故障自愈 / 异步锚点占位结算：
 * - 当 markPendingBackfill=true（正常异步流水线）：先沿用当前已持久化表底写入合法回执并将本回合标为 tableBackfillStatus='pending'，
 *   让正文在 <20ms 内无损发布并立刻解锁下一轮正文，后台队列随后凭 (turnId, floorId) 精确回填；
 * - 当 markPendingBackfill=false（故障兜底恢复）：直接沿用表底发布，未填桶前沿自动留给下一轮补齐。
 */
export async function carryForwardZeroLayerTableSettlement_ACU(
  store: ZeroLayerStore_ACU,
  envelope: ZeroLayerEnvelope_ACU,
  turnId: string,
  attemptId: string,
  signal: AbortSignal,
  options?: { markPendingBackfill?: boolean },
): Promise<void> {
  if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '表格兜底结算已中止。');
  const context = captureZeroLayerCarrier_ACU();
  assertZeroLayerCarrier_ACU(context);
  const turn = envelope.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
  if (!turn || turn.branchId !== envelope.activeBranchId || turn.phase !== 'response-durable' || !turn.tableInput) {
    throw new ZeroLayerError_ACU('effects-pending', '回合缺少已保存正文或可恢复的表格基底。');
  }
  const effectId = JSON.stringify([envelope.sessionId, turnId, attemptId, 'table']);
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
  const candidate: ZeroLayerTableCandidate_ACU = structuredClone(turn.tableCandidate ?? {
    floorId: turn.assistantFloor.floorId,
    tableData: turn.tableInput.tableData,
    completedAiFloorBySheetKey: turn.tableInput.completedAiFloorBySheetKey,
    filledSheetKeys: [],
    completedBucketIds: [],
  });
  validateZeroLayerTableCandidate_ACU(candidate, turn.assistantFloor.floorId);
  const { completedBucketIds: _completed, ...result } = candidate;
  validateZeroLayerTableResult_ACU(result, turn.assistantFloor.floorId);
  if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '表格兜底结算已中止。');
  assertZeroLayerCarrier_ACU(context);
  const markPending = options?.markPendingBackfill === true && turn.tableInput.autoUpdateEnabled === true;
  await store.commit({
    type: 'record-effect',
    turnId,
    attemptId,
    receipt: { effectId, kind: 'table', status: 'durable', fingerprint: getTableDataFingerprint_ACU(result) },
    assistantData: { table: result as ZeroLayerTableResult_ACU },
    tableBackfillStatus: markPending ? 'pending' : 'settled',
  }, envelope.revision);
}

/**
 * 异步锚点后台填表计算（只读上下文、不抢主正文锁、不因下一层正文抢先发布导致 revision 递增而中止）：
 * 严格将时间线截断至锚点回合 (anchorTurnId, anchorFloorId)，按锚点自己的 tableInput 计算完整填表结果，
 * 随后交由 store.commitAnchoredTableBackfill 精确插入锚点并前向同步给后续已发布的 pending 回合。
 */
export async function computeAnchoredTableBackfill_ACU(
  envelope: ZeroLayerEnvelope_ACU,
  physicalChat: readonly Record<string, unknown>[],
  anchorTurnId: string,
  anchorAttemptId: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; result: ZeroLayerTableResult_ACU }
  | { ok: false; fallbackResult: ZeroLayerTableResult_ACU; reason: string; aborted?: boolean }
> {
  const context = captureZeroLayerCarrier_ACU();
  const path = getPublishedZeroLayerPath_ACU(envelope);
  const anchorTurn = path.find(item => item.turnId === anchorTurnId && item.attemptId === anchorAttemptId);
  if (!anchorTurn || anchorTurn.tableBackfillStatus !== 'pending' || !anchorTurn.tableInput) {
    throw new ZeroLayerError_ACU('invalid-transition', '锚点回合不存在或不处于待回填状态。');
  }
  const input = anchorTurn.tableInput;
  const fallbackResult: ZeroLayerTableResult_ACU = {
    floorId: anchorTurn.assistantFloor.floorId,
    tableData: structuredClone(input.tableData),
    completedAiFloorBySheetKey: structuredClone(input.completedAiFloorBySheetKey),
    filledSheetKeys: [],
  };
  if (!input.autoUpdateEnabled || !input.scheduling) {
    return { ok: true, result: fallbackResult };
  }

  const assertAnchorStillValid = () => {
    if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '后台锚点填表已中止。');
    assertZeroLayerCarrier_ACU(context);
    const live = readZeroLayerCarrier_ACU(context);
    if (!live?.enabled || live.exitManifest || live.sessionId !== envelope.sessionId
      || live.activeBranchId !== envelope.activeBranchId
      || String(currentChatFileIdentifier_ACU) !== input.chatKey
      || getCurrentIsolationKey_ACU() !== input.isolationKey
      || getCurrentStorageMode() !== input.storageMode) {
      throw new ZeroLayerError_ACU('scope-changed', '后台锚点填表作用域或分支已变化。');
    }
    const livePath = getPublishedZeroLayerPath_ACU(live);
    const stillThere = livePath.find(item => item.turnId === anchorTurnId && item.attemptId === anchorAttemptId);
    if (!stillThere || stillThere.tableBackfillStatus !== 'pending') {
      throw new ZeroLayerError_ACU('scope-changed', '目标锚点已不在当前已发布分支或已结算。');
    }
  };

  assertAnchorStillValid();

  // 严格截断时间线至锚点回合的 assistantFloor，即使下一层正文已先发布也绝不混入！
  const fullTimeline = buildZeroLayerTimeline_ACU(envelope, physicalChat);
  const anchorFloorIdx = fullTimeline.floors.findIndex(floor => floor.ref.kind === 'logical'
    && floor.ref.turnId === anchorTurnId
    && floor.ref.floorId === anchorTurn.assistantFloor.floorId
    && floor.role === 'assistant');
  if (anchorFloorIdx < 0) {
    return { ok: false, fallbackResult, reason: 'anchor-floor-missing' };
  }
  const anchorFloors = fullTimeline.floors.slice(0, anchorFloorIdx + 1);
  const messages = anchorFloors.map(floor => ({
    ...(floor.data.qrf_plot !== undefined ? { qrf_plot: structuredClone(floor.data.qrf_plot) } : {}),
    ...(floor.data.qrf_plot_tasks !== undefined ? { qrf_plot_tasks: structuredClone(floor.data.qrf_plot_tasks) } : {}),
    ...(floor.data.qrf_plot_preset !== undefined ? { qrf_plot_preset: structuredClone(floor.data.qrf_plot_preset) } : {}),
    mes: floor.body,
    is_user: floor.role === 'user',
    is_system: floor.role === 'system',
  }));
  const aiMessageIndices = anchorFloors.flatMap((floor, index) => floor.aiOrdinal !== null ? [index] : []);
  const updateMode = resolveUpdateMode_ACU('auto');
  const logicalTarget: ZeroLayerFloorRef_ACU & { kind: 'logical' } = {
    kind: 'logical',
    sessionId: envelope.sessionId,
    branchId: anchorTurn.branchId,
    turnId: anchorTurnId,
    floorId: anchorTurn.assistantFloor.floorId,
    role: 'assistant',
  };

  let workingTableData: TableDataObject_ACU = structuredClone(input.tableData);
  let workingFrontier: Record<string, number> = structuredClone(input.completedAiFloorBySheetKey);
  const filledSheetKeys = new Set<string>();

  const templateData = input.storageMode === 'sqlite'
    ? captureSqlTableApplyScope_ACU({
      chat: [], isolationKey: input.isolationKey, templateData: input.templateData,
    }).templateData
    : input.templateData;
  const templateKeys = Object.keys(templateData).filter(key => key.startsWith('sheet_'));
  const templateScope = {
    sheetKeys: new Set(templateKeys),
    sheets: Object.fromEntries(templateKeys.map(key => [key, structuredClone(templateData[key] as Sheet_ACU)])),
  };
  const schedulingData: TableDataObject_ACU = {
    mate: input.tableData.mate,
    ...Object.fromEntries(templateKeys.map(key => [key, structuredClone(input.tableData[key] ?? templateData[key])])),
  };
  const plan = buildAutoUpdatePlan_ACU(messages, schedulingData, input.scheduling, input.isolationKey, undefined, {
    lastCompletedAiFloorBySheetKey: input.completedAiFloorBySheetKey,
    aiMessageIndices,
  });
  const buckets = Object.entries(plan.updateGroups).flatMap(([groupKey, group]) => {
    const batchSize = Math.max(1, Math.trunc(group.batchSize));
    return Array.from({ length: Math.ceil(group.indices.length / batchSize) }, (_, offset) => {
      const indices = group.indices.slice(offset * batchSize, (offset + 1) * batchSize);
      const sheetKeys = [...group.sheetKeys].sort();
      return {
        groupKey, group, indices, sheetKeys, batchNumber: offset + 1,
        id: JSON.stringify([logicalTarget.floorId, groupKey, offset + 1, indices, sheetKeys]),
      };
    });
  }).sort((left, right) => left.indices[left.indices.length - 1] - right.indices[right.indices.length - 1]
    || left.groupKey.localeCompare(right.groupKey) || left.batchNumber - right.batchNumber);

  if (!buckets.length) {
    return { ok: true, result: fallbackResult };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true }); // arch-ok: AbortSignal 取消后台锚点填表请求，finally 释放。
  if (signal.aborted) abort();

  let anyBucketFailed = false;
  let lastFailReason = '';
  try {
    for (const bucket of buckets) {
      assertAnchorStillValid();
      const run = createTableFillStagingRunContext_ACU({
        runId: bucket.id, chatKey: input.chatKey, isolationKey: input.isolationKey,
        targetSheetKeys: bucket.sheetKeys, originalFullIndex: null,
        templateFingerprint: getTableDataFingerprint_ACU(templateData), logicalTarget, storageMode: input.storageMode,
      });
      const stagingSession = createTableFillStagingSession_ACU(run, assertAnchorStillValid);
      const readProvider = input.storageMode === 'sqlite' ? createDetachedSqlTableService_ACU() : null;
      const worldbookReadContext = createLorebookReadContext_ACU({
        source: 'zero-layer-table', isAborted: () => signal.aborted,
        isActive: () => { try { assertAnchorStillValid(); return true; } catch { return false; } },
      });
      try {
        const baseSnapshot = structuredClone(workingTableData);
        for (const key of bucket.sheetKeys) {
          if (!baseSnapshot[key]) baseSnapshot[key] = structuredClone(input.templateData[key]);
        }
        validateZeroLayerTableData_ACU(baseSnapshot);
        if (readProvider) {
          const loaded = await readProvider.loadFromData(baseSnapshot);
          assertAnchorStillValid();
          if (loaded.error || !readProvider.isReady()) {
            anyBucketFailed = true;
            lastFailReason = 'sqlite-snapshot-not-ready';
            continue;
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
          anyBucketFailed = true;
          lastFailReason = 'api-preset-unconfigured';
          continue;
        }
        const lastIndex = bucket.indices[bucket.indices.length - 1];
        const firstAiOffset = aiMessageIndices.indexOf(bucket.indices[0]);
        const sliceStart = firstAiOffset > 0 ? aiMessageIndices[firstAiOffset - 1] + 1 : 0;

        const bucketController = new AbortController();
        const forwardAbort = () => bucketController.abort();
        controller.signal.addEventListener('abort', forwardAbort, { once: true });
        if (controller.signal.aborted) forwardAbort();
        let bucketTimer: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          bucketTimer = setTimeout(() => {
            bucketController.abort();
            reject(new ZeroLayerError_ACU('effects-pending', '后台锚点填表超时'));
          }, ZERO_LAYER_TABLE_BUCKET_TIMEOUT_MS_ACU);
        });
        let response;
        try {
          const fillPromise = collectGroupFillResponse_ACU({
            isolatedSnapshot: true, logicalTarget, groupKey: bucket.groupKey,
            groupId: bucket.group.groupId, batchNumber: bucket.batchNumber, targetSheetKeys: bucket.sheetKeys,
            messagesForContext: messages.slice(sliceStart, lastIndex + 1), updateMode,
            baseSnapshot, isImportMode: false, chatKey: input.chatKey, isolationKey: input.isolationKey,
            templateScope, sqlApplyScope,
            requestOptions: { isolatedSnapshot: true, forceDirectApi: true, skipProfileSwitch: true,
              tableApiPreset: presetName, apiPresetSnapshot, streaming: settings_ACU.streamingEnabled === true,
              sqlReadContext: readProvider ? { provider: readProvider, mapper: readProvider.createReadNameMapper_ACU(),
                tableData: runtimeData! } : null },
          }, undefined, bucketController, { respectGlobalStop: false, assertCurrent: assertAnchorStillValid, worldbookReadContext });
          fillPromise.catch(() => {});
          response = await Promise.race([fillPromise, timeoutPromise]);
        } catch (err) {
          if (signal.aborted) throw err;
          anyBucketFailed = true;
          lastFailReason = err instanceof Error ? err.message : String(err);
          continue;
        } finally {
          if (bucketTimer !== null) clearTimeout(bucketTimer);
          controller.signal.removeEventListener('abort', forwardAbort);
        }

        assertAnchorStillValid();
        if (!response || !response.success) {
          anyBucketFailed = true;
          lastFailReason = 'fill-response-incomplete';
          continue;
        }
        const applied = await applyUnifiedGroupFillResponses_ACU([response], baseSnapshot, {
          logicalTarget, updateMode, isImportMode: false, chatKey: input.chatKey,
          isolationKey: input.isolationKey, templateScope, sqlApplyScope,
          commitMode: 'stage_only', stagingSession, syncAfterCommit: false,
        });
        assertAnchorStillValid();
        if (!applied.success || !applied.tableData) {
          anyBucketFailed = true;
          lastFailReason = 'fill-apply-failed';
          continue;
        }
        const nextTableData = structuredClone(workingTableData);
        for (const key of bucket.sheetKeys) {
          nextTableData[key] = structuredClone(applied.tableData[key]);
          filledSheetKeys.add(key);
        }
        validateZeroLayerTableData_ACU(nextTableData);
        workingTableData = nextTableData;
        const nextFrontier = { ...workingFrontier };
        for (const key of bucket.sheetKeys) {
          nextFrontier[key] = aiMessageIndices.indexOf(lastIndex) + 1;
        }
        workingFrontier = nextFrontier;
      } finally {
        worldbookReadContext.dispose();
        readProvider?.dispose();
        await stagingSession.discard();
      }
    }
  } catch (err) {
    const partialResult: ZeroLayerTableResult_ACU = {
      floorId: logicalTarget.floorId,
      tableData: workingTableData,
      completedAiFloorBySheetKey: workingFrontier,
      filledSheetKeys: [...filledSheetKeys].sort(),
    };
    return {
      ok: false,
      fallbackResult: partialResult,
      reason: err instanceof Error ? err.message : String(err),
      aborted: signal.aborted || (err instanceof ZeroLayerError_ACU && err.code === 'scope-changed'),
    };
  } finally {
    signal.removeEventListener('abort', abort);
  }

  const finalResult: ZeroLayerTableResult_ACU = {
    floorId: logicalTarget.floorId,
    tableData: workingTableData,
    completedAiFloorBySheetKey: workingFrontier,
    filledSheetKeys: [...filledSheetKeys].sort(),
  };
  validateZeroLayerTableResult_ACU(finalResult, logicalTarget.floorId);
  if (anyBucketFailed && filledSheetKeys.size === 0) {
    return { ok: false, fallbackResult: finalResult, reason: lastFailReason || 'bucket-fill-failed' };
  }
  return { ok: true, result: finalResult };
}