/**
 * tests/integration/table-lifecycle.test.ts
 * I1+I2 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logWarn_ACU } from '../../src/shared/utils';

const { mockChat, mockSettings, mockCurrentJsonTableDataRef, mockSaveChat } = vi.hoisted(() => ({
  mockChat: [] as any[],
  mockSettings: { dataIsolationEnabled: false, dataIsolationCode: '' } as any,
  mockCurrentJsonTableDataRef: { value: null as any },
  // persist 非 strict 分支已改走合并调度入口；别名到同一 fn，保持旧计数语义。
  mockSaveChat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChat),
  saveChatToHost_ACU: mockSaveChat,

  saveChatToHostCoalesced_ACU: mockSaveChat,

  openChatSaveCoalescing_ACU: vi.fn(),

  closeChatSaveCoalescing_ACU: vi.fn(),

  forceFlushChatSave_ACU: vi.fn(async () => {}),
}));
vi.mock('../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((n: string) => n.includes('\u7eaa\u8981')),
  logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(() => ({
    sheet_0: { name: 'T', content: [['row_id', 'A', 'B']], sourceData: {} },
  })),
}));
vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  currentChatFileIdentifier_ACU: 'test-chat',
  independentTableStates_ACU: {},
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableDataRef.value = v; }),
}));
vi.mock('../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));
vi.mock('../../src/service/template/chat-scope', () => ({
  attachSeedRowsToCurrentDataFromGuide_ACU: vi.fn(),
  buildChatSheetGuideDataFromData_ACU: vi.fn(() => ({ sheet_0: { headers: ['A'] } })),
  ensureChatSheetGuideSeeded_ACU: vi.fn().mockResolvedValue(null),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getCurrentChatTemplateScopeState_ACU: vi.fn(() => null),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => null),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(() => null),
  ensureStableRowIdsForSeedRows_ACU: vi.fn((rows: any[]) => rows),
  getSortedSheetKeys_ACU: vi.fn((d: any) => d ? Object.keys(d).filter((k: string) => k.startsWith('sheet_')).sort() : []),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any) => {
    if (!Array.isArray(content) || content.length === 0) return [];
    const header = Array.isArray(content[0]) ? [...content[0]] : ['row_id'];
    const rows = content.slice(1).map((row: any) => Array.isArray(row) ? [...row] : []);
    const used = new Set<string>();
    let nextId = 1;
    return [header, ...rows.map((row: any) => {
      let value = row[0] == null ? '' : String(row[0]).trim();
      if (!value || used.has(value)) {
        while (used.has(String(nextId))) nextId += 1;
        value = String(nextId++);
      }
      used.add(value);
      row[0] = value;
      return row;
    })];
  }),
  sanitizeSheetForStorage_ACU: vi.fn((s: any) => JSON.parse(JSON.stringify(s))),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
}));
vi.mock('../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  mergeAllIndependentTables_ACU: vi.fn(async () => {
    const applyPatch = (state: any, patch: any) => {
      if (patch.kind === 'sheet_replace') {
        state[patch.sheetKey] = JSON.parse(JSON.stringify(patch.sheet));
        return;
      }
      const sheet = state[patch.sheetKey];
      if (!sheet || !Array.isArray(sheet.content)) return;
      if (patch.kind === 'row_upsert') {
        const idx = sheet.content.findIndex((row: any[]) => Array.isArray(row) && row[0] === patch.rowId);
        if (idx >= 0) sheet.content[idx] = JSON.parse(JSON.stringify(patch.cells));
        else sheet.content.push(JSON.parse(JSON.stringify(patch.cells)));
      } else if (patch.kind === 'row_delete') {
        sheet.content = sheet.content.filter((row: any[]) => !(Array.isArray(row) && row[0] === patch.rowId));
      } else if (patch.kind === 'meta_update') {
        Object.assign(sheet, JSON.parse(JSON.stringify(patch.meta)));
      }
    };

    for (let i = mockChat.length - 1; i >= 0; i--) {
      const m = mockChat[i];
      if (m.is_user) continue;
      const iso = m.TavernDB_ACU_IsolatedData;
      const tagData = iso?.[''];
      const frame = tagData?.storageFrame;
      if (frame?.checkpoint?.kind === 'full') {
        const state = JSON.parse(JSON.stringify(frame.checkpoint.data));
        for (let j = i; j < mockChat.length; j++) {
          const msg = mockChat[j];
          if (!msg || msg.is_user) continue;
          const nextFrame = msg.TavernDB_ACU_IsolatedData?.['']?.storageFrame;
          if (!nextFrame) continue;
          for (const entry of [...(nextFrame.logEntries || [])].sort((a: any, b: any) => a.seq - b.seq)) {
            if (Array.isArray(entry.operations) && entry.operations.length > 0) {
              for (const operation of entry.operations) {
                if (operation.kind === 'data_replace') {
                  Object.keys(state).forEach(key => delete state[key]);
                  Object.assign(state, JSON.parse(JSON.stringify(operation.data)));
                } else if (operation.kind === 'sheet_replace') {
                  state[operation.sheetKey] = JSON.parse(JSON.stringify(operation.sheet));
                } else if (operation.kind === 'row_upsert' || operation.kind === 'row_delete' || operation.kind === 'meta_update') {
                  applyPatch(state, operation);
                }
              }
            } else {
              for (const patch of entry.patches || []) applyPatch(state, patch);
            }
          }
        }
        return state;
      }
      if (tagData?.independentData) return JSON.parse(JSON.stringify(tagData.independentData));
    }
    return null;
  }),
}));
vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (j: string, f: any) => { try { return JSON.parse(j); } catch { return f; } },
  safeJsonStringify_ACU: (o: any, f: string) => { try { return JSON.stringify(o); } catch { return f; } },
}));
vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));

import { saveChatToHost_ACU } from '../../src/data/gateways/chat-gateway';
import { persistTablesToChatMessage_ACU, loadOrCreateJsonTableFromChatHistory_ACU } from '../../src/service/table/table-service';
import { getCurrentIsolationKey_ACU } from '../../src/service/runtime/state-manager';
import { buildTableDelta_ACU, applyTableDelta_ACU, isDeltaTagData_ACU, isCheckpointTagData_ACU } from '../../src/service/table/table-delta';
import { persistTableMutationLogV2_ACU } from '../../src/service/table/storage-frame-v2-persist';
import { loadTableStateFromFramesV2_ACU } from '../../src/service/table/storage-frame-v2-replay';
import { getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU, projectFlightModeHiddenChronicleRows_ACU } from '../../src/service/flight-mode/flight-mode-hidden-rows';
import type { TableWriteTransactionContext_ACU } from '../../src/service/table/table-write-transaction';

function seedLegacySlot(message: any, isolationKey = ''): void {
  message.TavernDB_ACU_IsolatedData = {
    ...(message.TavernDB_ACU_IsolatedData || {}),
    [isolationKey]: {
      independentData: {},
      modifiedKeys: [],
      updateGroupKeys: [],
      _acu_storage_mode: 'checkpoint',
      _acu_storage_version: 1,
    },
  };
}

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildV2BaseData_ACU(): any {
  return {
    mate: { type: 'acu', version: 1, padding: 'x'.repeat(2000) },
    sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '旧A']] },
    sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
  };
}

function makeTestTransactionContext_ACU(baseRevision: string | null, writeSet: any[]): TableWriteTransactionContext_ACU {
  return {
    transactionId: 'tx-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: 'group_fill',
    baseRevision,
    writeSet,
    runCommit: async task => task(),
  } as TableWriteTransactionContext_ACU;
}

function saveIndependentForTest_ACU(
  targetMessageIndex = -1,
  targetSheetKeys: string[] | null = null,
  updateGroupKeys: string[] | null = null,
  _skipPostRefresh = false,
  trackingSheetKeys: string[] | null = targetSheetKeys,
  operations?: any[],
) {
  return persistTablesToChatMessage_ACU({
    targetMessageIndex,
    targetSheetKeys,
    updateGroupKeys,
    trackingSheetKeys,
    trackAsUpdate: true,
    operations,
    assumeCommitLock: true,
    transactionContext: makeTestTransactionContext_ACU(null, [{ kind: 'all' }]),
  });
}

function seedV2FrameWithSheetACommit_ACU(baseData: any): { checkpointRevision: string; sheetARevision: string } {
  const checkpointRevision = 'checkpoint:rev0';
  const sheetARevision = '1:rev-a';
  mockChat.push({
    is_user: false,
    mes: 'AI回复',
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          headRevision: sheetARevision,
          checkpoint: {
            kind: 'full',
            createdAt: 1,
            reason: 'init',
            data: clone_ACU(baseData),
          },
          logEntries: [{
            seq: 1,
            entryId: 'rev-a',
            createdAt: 2,
            source: 'manual_crud',
            targetMessageIndex: 0,
            aiFloor: 1,
            filledSheetKeys: [],
            changedSheetKeys: ['sheet_a'],
            groupKeys: [],
            operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: { ...clone_ACU(baseData).sheet_a, content: [['row_id', 'A'], ['a1', '新A']] }, reason: 'manual_crud' }],
            patches: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: 'a1', cells: ['a1', '新A'] }],
            baseRevision: checkpointRevision,
            parentRevision: checkpointRevision,
            commitRevision: sheetARevision,
            writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
          }],
        },
      },
    },
  });
  return { checkpointRevision, sheetARevision };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentIsolationKey_ACU).mockReturnValue('');
  mockChat.length = 0;
  mockCurrentJsonTableDataRef.value = null;
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
});

describe('I1: 表格数据完整生命周期', () => {
  it('空聊天 → 初始化 → 保存 → 重新加载 → 数据一致', async () => {
    const r1 = await loadOrCreateJsonTableFromChatHistory_ACU();
    expect(r1.loaded).toBe(true);
    expect(r1.source).toBe('initialized');
    expect(mockCurrentJsonTableDataRef.value).not.toBeNull();
    mockChat.push({ is_user: false, mes: 'AI回复' });
    mockCurrentJsonTableDataRef.value.sheet_0.content.push(['1', '铁剑', '3']);
    const sr = await saveIndependentForTest_ACU();
    expect(sr.saved).toBe(true);
    expect(mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame.version).toBe(2);
    expect(mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0).toBeDefined();
    mockCurrentJsonTableDataRef.value = null;
    const r2 = await loadOrCreateJsonTableFromChatHistory_ACU();
    expect(r2.loaded).toBe(true);
    expect(r2.source).toBe('merged');
    expect(mockCurrentJsonTableDataRef.value.sheet_0.content).toContainEqual(['1', '铁剑', '3']);
  });

  it('多次保存后数据不丢失', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: 'T', content: [['row_id', 'A'], ['1', '铁剑']] },
    };
    await saveIndependentForTest_ACU();
    mockCurrentJsonTableDataRef.value.sheet_0.content.push(['2', '药水']);
    const sr2 = await saveIndependentForTest_ACU(-1, ['sheet_0'], null, false, ['sheet_0'], [
      { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '药水'] },
    ]);
    expect(sr2.saved).toBe(true);
    mockCurrentJsonTableDataRef.value = null;
    const r2 = await loadOrCreateJsonTableFromChatHistory_ACU();
    expect(r2.loaded).toBe(true);
    const sd = mockCurrentJsonTableDataRef.value.sheet_0;
    expect(sd.content).toHaveLength(3);
    expect(sd.content[2]).toEqual(['2', '药水']);
  });

  it('隔离模式下数据按标签隔离', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    vi.mocked(getCurrentIsolationKey_ACU).mockReturnValue('tag_A');
    mockChat.push({ is_user: false, mes: 'AI回复' });
    mockCurrentJsonTableDataRef.value = { sheet_0: { name: 'T', content: [['row_id', 'A'], ['1', '铁剑']] } };
    await saveIndependentForTest_ACU();
    expect(mockChat[0].TavernDB_ACU_IsolatedData['tag_A']).toBeDefined();
    expect(mockChat[0].TavernDB_ACU_IsolatedData['tag_A'].storageFrame.checkpoint.data.sheet_0).toBeDefined();
  });
});

describe('V2 顺序日志追加', () => {
  it('显式事务上下文下按顺序追加 operation log', async () => {
    const baseData = buildV2BaseData_ACU();
    const { checkpointRevision, sheetARevision } = seedV2FrameWithSheetACommit_ACU(baseData);
    const afterData = clone_ACU(baseData);
    afterData.sheet_b.content[1][1] = '新B';

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_b', sheet: afterData.sheet_b, reason: 'system' }],
      candidateChangedSheetKeys: ['sheet_b'],
      isolationKey: '',
      baseRevision: checkpointRevision,
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_b' }],
      transactionContext: makeTestTransactionContext_ACU(checkpointRevision, [{ kind: 'sheet', sheetKey: 'sheet_b' }]),
    });

    expect(result.saved).toBe(true);
    expect(result.entry?.baseRevision).toBe(checkpointRevision);
    expect(result.entry?.parentRevision).toBe(sheetARevision);
    expect(result.entry?.writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_b' }]);
    const frame = mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.headRevision).toBe(result.entry?.commitRevision);
    expect(frame.logEntries).toHaveLength(2);
    expect(vi.mocked(saveChatToHost_ACU)).toHaveBeenCalledTimes(1);

    const replayed = await loadTableStateFromFramesV2_ACU(mockChat, '');
    expect(replayed?.sheet_a.content[1]).toEqual(['a1', '新A']);
    expect(replayed?.sheet_b.content[1]).toEqual(['b1', '新B']);
  });

  it('已有 V2 checkpoint 后缺失 operation 的普通写入会失败', async () => {
    const baseData = buildV2BaseData_ACU();
    seedV2FrameWithSheetACommit_ACU(baseData);
    const afterData = clone_ACU(baseData);
    afterData.sheet_b.content[1][1] = '新B';

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      candidateChangedSheetKeys: ['sheet_b'],
      isolationKey: '',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_b' }],
      transactionContext: makeTestTransactionContext_ACU(null, [{ kind: 'sheet', sheetKey: 'sheet_b' }]),
    });

    expect(result.saved).toBe(false);
    expect(result.error).toContain('requires explicit operations');
  });

  it('忽略非初次 forceCheckpoint 并继续追加 operation log', async () => {
    const baseData = buildV2BaseData_ACU();
    seedV2FrameWithSheetACommit_ACU(baseData);
    const frameBefore = mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    frameBefore.logEntries[0].filledSheetKeys = ['sheet_a'];
    frameBefore.logEntries[0].groupKeys = ['sheet_a'];

    const afterData = clone_ACU(baseData);
    afterData.sheet_b.content[1][1] = '新B';

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_b', sheet: afterData.sheet_b, reason: 'system' }],
      filledSheetKeys: ['sheet_b'],
      candidateChangedSheetKeys: ['sheet_b'],
      groupKeys: ['sheet_b'],
      forceCheckpoint: true,
      isolationKey: '',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_b' }],
      transactionContext: makeTestTransactionContext_ACU(null, [{ kind: 'sheet', sheetKey: 'sheet_b' }]),
    });

    expect(result.saved).toBe(true);
    const frame = mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'init',
    }));
    expect(frame.logEntries).toHaveLength(2);
    expect(frame.logEntries[1]).toEqual(expect.objectContaining({ source: 'group_fill' }));
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('已忽略非初次 forceCheckpoint'));
    const replayed = await loadTableStateFromFramesV2_ACU(mockChat, '');
    expect(replayed?.sheet_b.content[1]).toEqual(['b1', '新B']);
  });

  it('V2 持久层不处理冲突，baseRevision 落后也只顺序追加日志', async () => {
    const baseData = buildV2BaseData_ACU();
    const { checkpointRevision, sheetARevision } = seedV2FrameWithSheetACommit_ACU(baseData);
    const afterData = clone_ACU(baseData);
    afterData.sheet_a.content[1][1] = '冲突A';

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      operations: [{ kind: 'data_replace', data: afterData, reason: 'system' }],
      candidateChangedSheetKeys: ['sheet_a'],
      isolationKey: '',
      baseRevision: checkpointRevision,
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      transactionContext: makeTestTransactionContext_ACU(checkpointRevision, [{ kind: 'sheet', sheetKey: 'sheet_a' }]),
    });

    expect(result.saved).toBe(true);
    const frame = mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.headRevision).toBe(result.entry?.commitRevision);
    expect(frame.logEntries).toHaveLength(2);
    expect(vi.mocked(saveChatToHost_ACU)).toHaveBeenCalledTimes(1);
  });

  it('飞行模式大总结写入后：隐藏仅作用于投影，V2 checkpoint/replay 保留纪要物理行', async () => {
    const beforeData = {
      mate: { type: 'acu', version: 1 },
      sheet_chronicle: {
        name: '纪要表',
        content: [['row_id', '事件'], ['c1', '第一段纪要'], ['c2', '第二段纪要']],
      },
      sheet_da_zong_jie: {
        name: '大总结',
        content: [['row_id', '总结']],
      },
    };
    const afterData = clone_ACU(beforeData);
    afterData.sheet_da_zong_jie.content.push(['s1', '阶段总结']);
    const flightMode = {
      enabled: true,
      enabledAt: 1,
      hiddenRowIds: [],
      bigSummarySheetKey: 'sheet_da_zong_jie',
    };

    const hiddenRowIds = getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(beforeData, afterData, flightMode);
    expect(hiddenRowIds).toEqual(['c1', 'c2']);

    mockChat.push({
      is_user: false,
      mes: 'AI回复',
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            headRevision: 'checkpoint:flight-mode',
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: clone_ACU(beforeData) },
            logEntries: [],
          },
        },
      },
    });

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_da_zong_jie', sheet: afterData.sheet_da_zong_jie, reason: 'system' }],
      candidateChangedSheetKeys: ['sheet_da_zong_jie'],
      isolationKey: '',
      baseRevision: 'checkpoint:flight-mode',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_da_zong_jie' }],
      transactionContext: makeTestTransactionContext_ACU('checkpoint:flight-mode', [{ kind: 'sheet', sheetKey: 'sheet_da_zong_jie' }]),
    });

    expect(result.saved).toBe(true);
    expect(mockChat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_chronicle.content).toEqual(beforeData.sheet_chronicle.content);
    const replayed = await loadTableStateFromFramesV2_ACU(mockChat, '');
    expect(replayed?.sheet_chronicle.content).toEqual(beforeData.sheet_chronicle.content);
    expect(replayed?.sheet_da_zong_jie.content).toEqual(afterData.sheet_da_zong_jie.content);

    const projected = projectFlightModeHiddenChronicleRows_ACU(replayed!, { ...flightMode, hiddenRowIds: hiddenRowIds! });
    expect(projected.sheet_chronicle.content).toEqual([['row_id', '事件']]);
    expect(replayed?.sheet_chronicle.content).toEqual(beforeData.sheet_chronicle.content);
  });
});

describe.skip('I2: 旧 V1 增量存储端到端链路（V2 迁移后废弃）', () => {
  it('首次保存 → checkpoint 模式确认', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: 'T', content: [['row_id', 'A', 'B'], ['r1', '铁剑', '3']] },
    };
    await saveIndependentForTest_ACU();
    const tagData = mockChat[0].TavernDB_ACU_IsolatedData[''];
    expect(tagData._acu_storage_mode).toBe('checkpoint');
    expect(tagData._acu_storage_version).toBe(1);
    expect(tagData.independentData.sheet_0).toBeDefined();
    expect(tagData.independentData.sheet_0.content).toContainEqual(['r1', '铁剑', '3']);
    expect(tagData.incrementalData).toBeUndefined();
    expect(isCheckpointTagData_ACU(tagData)).toBe(true);
    expect(isDeltaTagData_ACU(tagData)).toBe(false);
  });

  it('第二次保存（有 checkpoint base）→ delta 模式确认', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: 'T', content: [['row_id', 'A', 'B'], ['r1', '铁剑', '3']] },
    };
    await saveIndependentForTest_ACU();
    mockChat.push({ is_user: true, mes: '用户' });
    mockChat.push({ is_user: false, mes: 'AI回复2' });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: 'T', content: [['row_id', 'A', 'B'], ['r1', '铁剑', '3'], ['r2', '药水', '5']] },
    };
    await saveIndependentForTest_ACU();
    const td2 = mockChat[2].TavernDB_ACU_IsolatedData[''];
    expect(td2._acu_storage_mode).toBe('delta');
    expect(td2._acu_storage_version).toBe(1);
    expect(Object.keys(td2.independentData).filter((k: string) => k.startsWith('sheet_'))).toHaveLength(0);
    expect(td2.incrementalData).toBeDefined();
    expect(td2.incrementalData.sheet_0).toBeDefined();
    expect(td2.incrementalData.sheet_0.rowDeltas.length).toBeGreaterThan(0);
    const ud = td2.incrementalData.sheet_0.rowDeltas.find((d: any) => d.row_id === 'r2' && d.op === 'upsert');
    expect(ud).toBeDefined();
    expect(ud.cells).toEqual(['r2', '药水', '5']);
    expect(isDeltaTagData_ACU(td2)).toBe(true);
    expect(isCheckpointTagData_ACU(td2)).toBe(false);
  });

  it('同一楼层多组分批保存时合并 incrementalData，不丢失先写入的表', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '旧A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
    };
    await saveIndependentForTest_ACU();

    mockChat.push({ is_user: true, mes: '用户' });
    mockChat.push({ is_user: false, mes: 'AI回复2' });

    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '新A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
    };
    await saveIndependentForTest_ACU(2, ['sheet_a'], ['sheet_a'], false, ['sheet_a']);

    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '新A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '新B']] },
    };
    await saveIndependentForTest_ACU(2, ['sheet_b'], ['sheet_b'], false, ['sheet_b']);

    const td2 = mockChat[2].TavernDB_ACU_IsolatedData[''];
    expect(td2._acu_storage_mode).toBe('delta');
    expect(Object.keys(td2.independentData).filter((k: string) => k.startsWith('sheet_'))).toHaveLength(0);
    expect(td2.incrementalData.sheet_a).toBeDefined();
    expect(td2.incrementalData.sheet_b).toBeDefined();
    expect(td2.modifiedKeys.sort()).toEqual(['sheet_a', 'sheet_b']);
    expect(td2.updateGroupKeys.sort()).toEqual(['sheet_a', 'sheet_b']);

    const sheetADelta = td2.incrementalData.sheet_a.rowDeltas.find((d: any) => d.row_id === 'a1');
    const sheetBDelta = td2.incrementalData.sheet_b.rowDeltas.find((d: any) => d.row_id === 'b1');
    expect(sheetADelta?.cells).toEqual(['a1', '新A']);
    expect(sheetBDelta?.cells).toEqual(['b1', '新B']);

    const rebuiltA = applyTableDelta_ACU(mockChat[0].TavernDB_ACU_IsolatedData[''].independentData.sheet_a, td2.incrementalData.sheet_a, 'sheet_a');
    const rebuiltB = applyTableDelta_ACU(mockChat[0].TavernDB_ACU_IsolatedData[''].independentData.sheet_b, td2.incrementalData.sheet_b, 'sheet_b');
    expect(rebuiltA.content).toEqual([['row_id', 'A'], ['a1', '新A']]);
    expect(rebuiltB.content).toEqual([['row_id', 'B'], ['b1', '新B']]);
  });

  it('同一楼层后续分组在 row_id 稳定化后仍走 delta，且不丢失先写入的表', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '旧A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
    };
    await saveIndependentForTest_ACU();

    mockChat.push({ is_user: true, mes: '用户' });
    mockChat.push({ is_user: false, mes: 'AI回复2' });

    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '新A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
    };
    await saveIndependentForTest_ACU(2, ['sheet_a'], ['sheet_a'], false, ['sheet_a']);
    expect(mockChat[2].TavernDB_ACU_IsolatedData['']._acu_storage_mode).toBe('delta');

    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '新A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['', '坏行1'], ['', '坏行2']] },
    };
    await saveIndependentForTest_ACU(2, ['sheet_b'], ['sheet_b'], false, ['sheet_b']);

    const td2 = mockChat[2].TavernDB_ACU_IsolatedData[''];
    expect(td2._acu_storage_mode).toBe('delta');
    expect(td2.independentData).toEqual({});
    expect(td2.incrementalData.sheet_b).toBeDefined();
    const rebuiltSheetB = applyTableDelta_ACU(
      { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] } as any,
      td2.incrementalData.sheet_b,
      'sheet_b',
    );
    expect(rebuiltSheetB.content).toEqual([['row_id', 'B'], ['1', '坏行1'], ['2', '坏行2']]);
    const rebuiltSheetA = applyTableDelta_ACU(
      { name: '表A', content: [['row_id', 'A'], ['a1', '新A']] } as any,
      td2.incrementalData.sheet_a,
      'sheet_a',
    );
    expect(rebuiltSheetA.content).toEqual([['row_id', 'A'], ['a1', '新A']]);
    expect(td2.modifiedKeys.sort()).toEqual(['sheet_a', 'sheet_b']);
    expect(td2.updateGroupKeys.sort()).toEqual(['sheet_a', 'sheet_b']);
  });

  it('旧脏 base 在同一 saveTargetIndex 多次保存时会先被稳定化，不再打印 base_no_stable_row_id', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['a1', '旧A']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
    };
    await saveIndependentForTest_ACU();
    mockChat[0].TavernDB_ACU_IsolatedData[''].independentData.sheet_a.content = [['row_id', 'A'], ['', '旧A1'], ['', '旧A2']];

    mockChat.push({ is_user: true, mes: '用户' });
    mockChat.push({ is_user: false, mes: 'AI回复2' });

    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['1', '新A1'], ['2', '新A2']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '旧B']] },
    };
    await saveIndependentForTest_ACU(2, ['sheet_a'], ['sheet_a'], false, ['sheet_a']);

    mockCurrentJsonTableDataRef.value = {
      sheet_a: { name: '表A', content: [['row_id', 'A'], ['1', '新A1'], ['2', '新A2']] },
      sheet_b: { name: '表B', content: [['row_id', 'B'], ['b1', '新B']] },
    };
    await saveIndependentForTest_ACU(2, ['sheet_b'], ['sheet_b'], false, ['sheet_b']);

    const td2 = mockChat[2].TavernDB_ACU_IsolatedData[''];
    expect(td2._acu_storage_mode).toBe('delta');
    expect(td2.incrementalData.sheet_a).toBeDefined();
    expect(td2.incrementalData.sheet_b).toBeDefined();
    const rebuiltA = applyTableDelta_ACU({ name: '表A', content: [['row_id', 'A'], ['1', '旧A1'], ['2', '旧A2']] } as any, td2.incrementalData.sheet_a, 'sheet_a');
    expect(rebuiltA.content).toEqual([['row_id', 'A'], ['1', '新A1'], ['2', '新A2']]);
    const baseWarnings = vi.mocked(logWarn_ACU).mock.calls.filter(call => String(call[0]).includes('base 缺少稳定 row_id'));
    expect(baseWarnings).toHaveLength(0);
  });

  it('delta 模式保留本轮 tracking metadata，即使纪要表未产生增量', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_summary: { name: '纪要表', content: [['row_id', '内容'], ['s1', '旧纪要']] },
      sheet_data: { name: '数据表', content: [['row_id', '值'], ['d1', '旧数据']] },
    };
    await saveIndependentForTest_ACU();

    mockChat.push({ is_user: true, mes: '用户' });
    mockChat.push({ is_user: false, mes: 'AI回复2' });

    mockCurrentJsonTableDataRef.value = {
      sheet_summary: { name: '纪要表', content: [['row_id', '内容'], ['s1', '旧纪要']] },
      sheet_data: { name: '数据表', content: [['row_id', '值'], ['d1', '新数据']] },
    };
    await saveIndependentForTest_ACU(
      2,
      ['sheet_summary', 'sheet_data'],
      ['sheet_summary', 'sheet_data'],
      false,
      ['sheet_summary', 'sheet_data'],
    );

    const td2 = mockChat[2].TavernDB_ACU_IsolatedData[''];
    expect(td2._acu_storage_mode).toBe('delta');
    expect(td2.incrementalData.sheet_data).toBeDefined();
    expect(td2.incrementalData.sheet_summary).toBeUndefined();
    expect(td2.modifiedKeys).toEqual(['sheet_summary', 'sheet_data']);
    expect(td2.updateGroupKeys).toEqual(['sheet_summary', 'sheet_data']);
  });

  it('buildTableDelta + applyTableDelta 往返一致性', () => {
    const base = { name: 'T', content: [['row_id', 'A', 'B'], ['r1', '铁剑', '3'], ['r2', '药水', '5']] } as any;
    const next = { name: 'T', content: [['row_id', 'A', 'B'], ['r1', '铁剑', '10'], ['r3', '盾牌', '1']] } as any;
    const res = buildTableDelta_ACU(base, next, 'sheet_0');
    expect(res.degraded).toBe(false);
    expect(res.delta).toBeDefined();
    const rebuilt = applyTableDelta_ACU(base, res.delta!, 'sheet_0');
    expect(rebuilt.content).toEqual(next.content);
  });

  it('row_id 缺失时会在落盘前稳定化，因此仍可写成 delta', async () => {
    mockChat.push({ is_user: false, mes: 'AI回复1' });
    seedLegacySlot(mockChat[mockChat.length - 1]);
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: 'T', content: [['row_id', 'A'], ['r1', '铁剑']] },
    };
    await saveIndependentForTest_ACU();
    mockChat.push({ is_user: true, mes: '用户' });
    mockChat.push({ is_user: false, mes: 'AI回复2' });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: 'T', content: [['row_id', 'A'], ['', '铁剑'], ['', '药水']] },
    };
    await saveIndependentForTest_ACU();
    const td2 = mockChat[2].TavernDB_ACU_IsolatedData[''];
    expect(td2._acu_storage_mode).toBe('delta');
    expect(td2.independentData).toEqual({});
    expect(td2.incrementalData.sheet_0).toBeDefined();
    const rebuilt = applyTableDelta_ACU(
      { name: 'T', content: [['row_id', 'A'], ['r1', '铁剑']] } as any,
      td2.incrementalData.sheet_0,
      'sheet_0',
    );
    expect(rebuilt.content).toEqual([['row_id', 'A'], ['1', '铁剑'], ['2', '药水']]);
    expect(isDeltaTagData_ACU(td2)).toBe(true);
  });

  it('旧版数据（无 _acu_storage_mode 标记）兼容性确认', () => {
    const legacy = {
      independentData: { sheet_0: { name: 'T', content: [['row_id', 'A'], ['r1', '铁剑']] } },
      modifiedKeys: ['sheet_0'],
      updateGroupKeys: [],
    } as any;
    expect(isCheckpointTagData_ACU(legacy)).toBe(true);
    expect(isDeltaTagData_ACU(legacy)).toBe(false);
    const legacyExplicit = { ...legacy, _acu_storage_mode: 'legacy' };
    expect(isCheckpointTagData_ACU(legacyExplicit)).toBe(true);
    expect(isDeltaTagData_ACU(legacyExplicit)).toBe(false);
  });
});