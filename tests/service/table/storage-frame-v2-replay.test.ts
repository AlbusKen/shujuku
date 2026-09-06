import { beforeEach, describe, expect, it, vi } from 'vitest';
import validV2FrameFixture from '../../fixtures/migrations/spv7.9/v2-valid-full-checkpoint.json';
import invalidV2FrameFixture from '../../fixtures/migrations/spv7.9/v2-invalid-duplicate-row-id.json';
import orphanV2FrameFixture from '../../fixtures/migrations/spv7.9/v2-orphan-data-replace.json';
import { buildLongHistoryFixture_ACU } from './v2-long-history-fixture';

const { mockLogWarn } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logWarn_ACU: mockLogWarn };
});

import { applyTableOperationV2_ACU, applyTablePatchV2_ACU, collectScheduleSummaryFromFramesV2_ACU, deriveSheetLifecycleFromFramesV2_ACU, flushPendingCompatTransitionFixations_ACU, loadTableStateFromFramesV2_ACU, loadTableStateFromFramesV2Detailed_ACU, loadTableStatesAtBoundariesFromFramesV2Detailed_ACU, V2ReplayAbortedError_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import { buildSheetSchemaMigrationOperation_ACU, buildSheetSchemaMigrationOperationV2_ACU } from '../../../src/service/table/table-schema-migration';
import { applySqlEditsToTableDataSnapshot_ACU } from '../../../src/service/table/sql-table-service';
import { _set_independentTableStates_ACU, independentTableStates_ACU } from '../../../src/service/runtime/state-manager';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { persistTableMutationLogV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';
import { reindexSpv79TransitionState_ACU } from '../../../src/service/table/spv79-transition-checkpoint';

function makeCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_0: {
      uid: 'inventory',
      name: 'inventory',
      content: [
        ['row_id', 'name'],
        ['1', '铁剑'],
      ],
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);',
      },
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  } as any;
}

function makeLegacyMessyCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_legacy: {
      uid: 'legacy_inventory',
      name: '旧背包',
      content: [
        ['行号', '名称', '备注'],
        ['1', '铁剑', '完整行'],
        [' 1 ', '木剑'],
      ],
      sourceData: { ddl: 'CREATE TABLE legacy_inventory (row_id INTEGER PRIMARY KEY, name TEXT, note TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    },
  } as any;
}

function makeDslCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_a: {
      uid: 'global_state',
      name: '全局数据表',
      content: [['row_id', '地点'], ['1', '起点']],
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
    sheet_b: {
      uid: 'chronicle',
      name: '纪要表',
      content: [['row_id', '时间跨度', '地点', '纪要', '概要']],
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
      orderNo: 1,
    },
  } as any;
}

describe('loadTableStateFromFramesV2_ACU', () => {
  beforeEach(() => {
    mockLogWarn.mockClear();
  });

  it('从最后 checkpoint 开始，在同一个恢复 runtime 上顺序回放 sql_batch', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [
                {
                  seq: 1,
                  entryId: 'v2_sql_1',
                  createdAt: 2,
                  source: 'auto_fill',
                  targetMessageIndex: 0,
                  aiFloor: 1,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [
                    { kind: 'sql_batch', statements: ["UPDATE inventory SET name = '钢剑' WHERE row_id = 1"] },
                  ],
                },
                {
                  seq: 2,
                  entryId: 'v2_sql_2',
                  createdAt: 3,
                  source: 'auto_fill',
                  targetMessageIndex: 0,
                  aiFloor: 1,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [
                    { kind: 'sql_batch', statements: ["INSERT INTO inventory VALUES (2, '药水')"] },
                  ],
                },
              ],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '钢剑'],
      ['2', '药水'],
    ]);
  });

  it('只读回放保持数据结果但不更新 independentTableStates', async () => {
    const previousIndependentStates = independentTableStates_ACU;
    _set_independentTableStates_ACU({ sheet_existing: { lastUpdatedAiFloor: 99 } });
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData(),
              event: { filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'readonly-replay', createdAt: 2, source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{ kind: 'sql_batch', statements: ["UPDATE inventory SET name = '钢剑' WHERE row_id = 1"] }],
            }],
          },
        },
      },
    }];

    try {
      const result = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });

      expect(result?.sheet_0.content[1]).toEqual(['1', '钢剑']);
      expect(independentTableStates_ACU).toEqual({ sheet_existing: { lastUpdatedAiFloor: 99 } });
    } finally {
      _set_independentTableStates_ACU(previousIndependentStates);
    }
  });

  it('回放带参数绑定的 sql_batch', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_sql_params_1',
                createdAt: 2,
                source: 'manual_crud',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: [],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_batch',
                  statements: ['UPDATE inventory SET name = ? WHERE row_id = ?'],
                  params: [['钢剑', 1]],
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content[1]).toEqual(['1', '钢剑']);
  });

  it('回放带 sheetKey 的 sql_sheet_batch，并保留 SQL runtime 语义', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_sql_sheet_batch_1',
                createdAt: 2,
                source: 'manual_crud',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_sheet_batch',
                  sheetKey: 'sheet_0',
                  statements: ['UPDATE inventory SET name = ? WHERE row_id = ?', 'INSERT INTO inventory VALUES (?, ?)'],
                  params: [['钢剑', 1], [2, '药水']],
                  tableName: 'inventory',
                  reason: 'system',
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '钢剑'],
      ['2', '药水'],
    ]);
  });

  it('已物化的 SQL INSERT 回放与实时快照一致，删除中间 ID 后仍保留 max + 1 身份', async () => {
    const baseSnapshot = makeCheckpointData();
    baseSnapshot.sheet_0.content = [
      ['row_id', 'name'],
      ['1', '铁剑'],
      ['3', '盾牌'],
    ];
    const liveResult = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT INTO inventory (name) VALUES ('药水');",
      baseSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(liveResult.success, liveResult.error).toBe(true);
    expect(liveResult.workingData?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '铁剑'],
      ['3', '盾牌'],
      ['4', '药水'],
    ]);
    expect(liveResult.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: ["INSERT INTO inventory (row_id, name) VALUES (4, '药水')"],
      tableName: 'inventory',
      reason: 'system',
    }]);

    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: baseSnapshot,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'materialized-row-id-replay', createdAt: 2,
              source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: liveResult.operations,
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false }))
      .resolves.toEqual(liveResult.workingData);
  });

  it('固定槽位 INSERT OR REPLACE 实时执行后原样持久化并由 V2 replay 覆盖相同 row_id', async () => {
    const baseSnapshot = makeCheckpointData();
    baseSnapshot.sheet_0.sourceData = {
      ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY CHECK(row_id BETWEEN 1 AND 2), name TEXT NOT NULL);',
      insertNode: "后续填表使用 INSERT OR REPLACE INTO inventory (row_id, name) VALUES (1, '...')。",
    };
    baseSnapshot.sheet_0.content = [
      ['row_id', 'name'],
      ['1', '旧槽位一'],
      ['2', '旧槽位二'],
    ];
    const liveResult = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT OR REPLACE INTO inventory (row_id, name) VALUES (1, '新槽位一');",
      baseSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );

    expect(liveResult.success, liveResult.error).toBe(true);
    expect(liveResult.operations).toEqual([{
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_0',
      statements: ["INSERT OR REPLACE INTO inventory (row_id, name) VALUES (1, '新槽位一')"],
      tableName: 'inventory',
      reason: 'system',
    }]);

    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: baseSnapshot,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'fixed-slot-replace-replay', createdAt: 2,
              source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: liveResult.operations,
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false }))
      .resolves.toEqual(liveResult.workingData);
  });

  it('固定槽位 INSERT OR REPLACE 经真实 V2 persist 写入后仍与实时快照一致', async () => {
    const baseSnapshot = makeCheckpointData();
    baseSnapshot.sheet_0.sourceData = {
      ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY CHECK(row_id BETWEEN 1 AND 2), name TEXT NOT NULL);',
      insertNode: '禁止 INSERT OR REPLACE；该字段不参与固定槽位契约。',
    };
    baseSnapshot.sheet_0.content = [
      ['row_id', 'name'],
      ['1', '旧槽位一'],
      ['2', '旧槽位二'],
    ];
    const liveResult = await applySqlEditsToTableDataSnapshot_ACU(
      "INSERT OR REPLACE INTO inventory (row_id, name) VALUES (1, '新槽位一');",
      baseSnapshot,
      'auto_standard',
      { targetSheetKeys: ['sheet_0'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
    );
    expect(liveResult.success, liveResult.error).toBe(true);
    expect(liveResult.workingData).toBeDefined();
    expect(liveResult.operations).toEqual([{
      kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system',
      statements: ["INSERT OR REPLACE INTO inventory (row_id, name) VALUES (1, '新槽位一')"],
    }]);

    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: baseSnapshot,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [],
          },
        },
      },
    }];
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat: async () => undefined } as any);
      const persisted = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 0,
        source: 'auto_fill',
        afterData: liveResult.workingData!,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: liveResult.operations,
        transactionContext: {
          baseRevision: 'test-fixed-slot-replace',
          writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
          assertFresh: () => undefined,
          runCommit: async (task: () => Promise<any>) => task(),
        },
      });

      expect(persisted.saved).toBe(true);
      expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations).toEqual(liveResult.operations);
      await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false }))
        .resolves.toEqual(liveResult.workingData);
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });

  it('真实 persist 将连续 native buckets 写入同一锚点之后，bounded replay 可恢复累计行', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content = [['row_id', 'name']];
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
              logEntries: [],
            },
          },
        },
      },
      { is_user: false, mes: '第一段追平' },
      { is_user: false, mes: '第二段追平' },
    ];
    const transactionContext = {
      baseRevision: 'manual-catch-up-integration',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
      assertFresh: () => undefined,
      runCommit: async (task: () => Promise<any>) => task(),
    };
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat: async () => undefined } as any);
      const firstAfterData = {
        ...checkpointData,
        sheet_0: { ...checkpointData.sheet_0, content: [['row_id', 'name'], ['1', '第一 bucket']] },
      } as any;
      const first = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 1,
        source: 'manual_fill',
        afterData: firstAfterData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '第一 bucket'] }],
        transactionContext,
      });
      expect(first).toMatchObject({ saved: true, messageIndex: 1 });

      const secondAfterData = {
        ...firstAfterData,
        sheet_0: { ...firstAfterData.sheet_0, content: [['row_id', 'name'], ['1', '第一 bucket'], ['2', '第二 bucket']] },
      } as any;
      const second = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 2,
        source: 'manual_fill',
        afterData: secondAfterData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '第二 bucket'] }],
        transactionContext,
      });
      expect(second).toMatchObject({ saved: true, messageIndex: 2 });

      await expect(loadTableStateFromFramesV2_ACU(chat, '', {
        maxMessageIndex: 2,
        updateRuntimeState: false,
      })).resolves.toEqual(secondAfterData);
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });

  it('真实 persist 可在无锚点历史边界写入 integrity_repair checkpoint，并保留后缀 artifact 严格回放', async () => {
    const template = makeCheckpointData();
    template.sheet_0.content = [['row_id', 'name'], ['99', '模板示例行']];
    const earlyFrame = {
      version: 2,
      logEntries: [{
        seq: 1, entryId: 'orphan-early-row', createdAt: 1, source: 'manual_fill',
        targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '早期 artifact'] }],
      }],
    };
    const suffixFrame = {
      version: 2,
      logEntries: [{
        seq: 1, entryId: 'orphan-suffix-row', createdAt: 2, source: 'manual_fill',
        targetMessageIndex: 2, aiFloor: 3, filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '3', cells: ['3', '后缀 artifact'] }],
      }],
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_ScopedConfig: {
          version: 1,
          template: { '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) } },
        },
        TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(earlyFrame) } },
      },
      { is_user: false, mes: '在此建立正式边界 checkpoint' },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(suffixFrame) } } },
    ];
    const suffixBefore = structuredClone(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame);
    const saveChat = vi.fn(async () => undefined);
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat } as any);
      const boundaryBeforeWrite = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
        maxMessageIndex: 1,
        updateRuntimeState: false,
        allowTemporaryTemplateBaseline: true,
        compatibilityMode: 'disabled',
      });
      expect(boundaryBeforeWrite).toMatchObject({ baseKind: 'temporary_template_baseline' });
      const boundaryOperation = {
        kind: 'row_upsert' as const, sheetKey: 'sheet_0', rowId: '2', cells: ['2', '边界写入'],
      };
      const afterData = structuredClone(boundaryBeforeWrite!.data);
      await applyTableOperationV2_ACU(afterData, boundaryOperation);
      const persisted = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 1,
        source: 'manual_fill',
        afterData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: [boundaryOperation],
        transactionContext: {
          baseRevision: 'unanchored-boundary-before-suffix',
          writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
          assertFresh: () => undefined,
          runCommit: async (task: () => Promise<any>) => task(),
        },
      });

      expect(persisted.saved, JSON.stringify(persisted)).toBe(true);
      expect(persisted.messageIndex).toBe(1);
      const checkpointFrame = chat[1].TavernDB_ACU_IsolatedData[''].storageFrame;
      expect(checkpointFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'integrity_repair', data: afterData });
      expect(checkpointFrame.logEntries).toEqual([]);
      expect(checkpointFrame.perSheetCheckpoints).toBeUndefined();
      expect(chat[1].TavernDB_ACU_IsolatedData[''].recoveryBackup).toBeUndefined();
      expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(suffixBefore);
      expect(saveChat).toHaveBeenCalledTimes(1);

      const replayed = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
        updateRuntimeState: false,
        compatibilityMode: 'disabled',
      });
      expect(replayed).toMatchObject({ baseKind: 'full_checkpoint' });
      expect(replayed?.requiresCheckpointConvergence).toBeFalsy();
      expect(replayed?.compatibilityRepairs ?? []).toEqual([]);
      expect(replayed?.data.sheet_0.content).toEqual([
        ['row_id', 'name'],
        ['1', '早期 artifact'],
        ['2', '边界写入'],
        ['3', '后缀 artifact'],
      ]);
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });


  it('真实 persist 在后缀 artifact 无法严格回放时拒绝边界升级且不污染聊天', async () => {
    const template = makeCheckpointData();
    const earlyFrame = {
      version: 2,
      logEntries: [{
        seq: 1, entryId: 'orphan-early-row', createdAt: 1, source: 'manual_fill',
        targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '早期 artifact'] }],
      }],
    };
    const incompatibleSuffixFrame = {
      version: 2,
      logEntries: [{
        seq: 1, entryId: 'invalid-suffix-sql', createdAt: 2, source: 'manual_fill',
        targetMessageIndex: 2, aiFloor: 3, filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
        operations: [{
          kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system',
          statements: ['INSERT INTO inventory (missing_column) VALUES (1)'],
        }],
      }],
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_ScopedConfig: {
          version: 1,
          template: { '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) } },
        },
        TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: earlyFrame } },
      },
      { is_user: false, mes: '失败边界目标' },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: incompatibleSuffixFrame } } },
    ];
    const before = structuredClone(chat);
    const saveChat = vi.fn(async () => undefined);
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat } as any);
      const boundary = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
        maxMessageIndex: 1,
        updateRuntimeState: false,
        allowTemporaryTemplateBaseline: true,
        compatibilityMode: 'disabled',
      });
      const operation = { kind: 'row_upsert' as const, sheetKey: 'sheet_0', rowId: '2', cells: ['2', '边界写入'] };
      const afterData = structuredClone(boundary!.data);
      await applyTableOperationV2_ACU(afterData, operation);
      const result = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 1,
        source: 'manual_fill',
        afterData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: [operation],
        transactionContext: {
          baseRevision: 'unanchored-boundary-incompatible-suffix',
          writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
          assertFresh: () => undefined,
          runCommit: async (task: () => Promise<any>) => task(),
        },
      });

      expect(result).toEqual({ saved: false, error: expect.stringContaining('V2 candidate_suffix_replay_failed') });
      expect(chat).toEqual(before);
      expect(saveChat).not.toHaveBeenCalled();
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });


  it('真实 persist 拒绝 checkpoint 之前的 metadata-only 写入，且不触碰聊天或宿主保存', async () => {
    const checkpointData = makeCheckpointData();
    const chat = [
      { is_user: false, mes: '过早目标' },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
              logEntries: [],
            },
          },
        },
      },
    ];
    const saveChat = vi.fn(async () => undefined);
    const before = structuredClone(chat);
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat } as any);
      const result = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 0,
        source: 'manual_fill',
        afterData: checkpointData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: [],
        operations: [],
        transactionContext: {
          baseRevision: 'metadata-before-anchor',
          writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
          assertFresh: () => undefined,
          runCommit: async (task: () => Promise<any>) => task(),
        },
      });

      expect(result).toEqual({
        saved: false,
        error: 'V2 write target precedes the latest full checkpoint and would never replay: targetMessageIndex=0, latestFullCheckpointIndex=1.',
      });
      expect(chat).toEqual(before);
      expect(saveChat).not.toHaveBeenCalled();
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });

  it('真实 persist 将连续 SQLite buckets 写入同一锚点之后，replay 保留累计 SQL 结果', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content = [['row_id', 'name']];
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
              logEntries: [],
            },
          },
        },
      },
      { is_user: false, mes: 'SQLite 第一段追平' },
      { is_user: false, mes: 'SQLite 第二段追平' },
    ];
    const transactionContext = {
      baseRevision: 'manual-catch-up-sqlite-integration',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
      assertFresh: () => undefined,
      runCommit: async (task: () => Promise<any>) => task(),
    };
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat: async () => undefined } as any);
      const firstAfterData = {
        ...checkpointData,
        sheet_0: { ...checkpointData.sheet_0, content: [['row_id', 'name'], ['1', 'SQLite 第一 bucket']] },
      } as any;
      const first = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 1,
        source: 'manual_fill',
        afterData: firstAfterData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: [{
          kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system',
          statements: ['INSERT INTO inventory (row_id, name) VALUES (?, ?)'], params: [[1, 'SQLite 第一 bucket']],
        }],
        transactionContext,
      });
      expect(first).toMatchObject({ saved: true, messageIndex: 1 });

      const secondAfterData = {
        ...firstAfterData,
        sheet_0: { ...firstAfterData.sheet_0, content: [['row_id', 'name'], ['1', 'SQLite 第一 bucket'], ['2', 'SQLite 第二 bucket']] },
      } as any;
      const second = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 2,
        source: 'manual_fill',
        afterData: secondAfterData,
        filledSheetKeys: ['sheet_0'],
        candidateChangedSheetKeys: ['sheet_0'],
        operations: [{
          kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system',
          statements: ['INSERT INTO inventory (row_id, name) VALUES (?, ?)'], params: [[2, 'SQLite 第二 bucket']],
        }],
        transactionContext,
      });
      expect(second).toMatchObject({ saved: true, messageIndex: 2 });

      await expect(loadTableStateFromFramesV2_ACU(chat, '', {
        maxMessageIndex: 2,
        updateRuntimeState: false,
      })).resolves.toEqual(secondAfterData);
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });

  it('legacy 显式 row_id SQL operation 保持历史指定身份', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData(),
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'legacy-explicit-row-id', createdAt: 2,
              source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system',
                statements: ["INSERT INTO inventory (row_id, name) VALUES (10, '旧日志行')"],
              }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false })).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', 'name'], ['1', '铁剑'], ['10', '旧日志行']] }),
    });
  });

  it('宽松映射历史 DDL 表名、sheetKey 与 sql_sheet_batch tableName 到当前 runtime 表名', async () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state_sheet',
        name: '全局数据表',
        content: [['row_id', 'story_state', 'note'], ['1', '初始状态', ''] ],
        sourceData: {
          ddl: 'CREATE TABLE "global_state" (row_id INTEGER PRIMARY KEY, story_state TEXT, note TEXT);',
          tableAliases: ['全局状态'],
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'legacy-global-state', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_global'], groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: 'sheet_global', tableName: 'obsolete_metadata', reason: 'system',
                statements: [
                  "WITH source AS (SELECT ? AS row_id, ? AS story_state) UPDATE [global_state] SET story_state = (SELECT story_state FROM source), note = 'global_state must remain text' /* global_state comment */ WHERE row_id = (SELECT row_id FROM source) AND EXISTS (WITH RECURSIVE global_state(row_id) AS (SELECT 1) SELECT 1 FROM global_state)",
                  'INSERT INTO sheet_global (row_id, story_state, note) VALUES (?, ?, ?)',
                  "UPDATE 全局状态 SET note = 'explicit table alias' WHERE row_id = 1",
                ],
                params: [[1, '更新后'], [2, '新增状态', 'sheet key alias']],
              }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_global.content).toEqual([
      ['row_id', 'story_state', 'note'],
      ['1', '更新后', 'explicit table alias'],
      ['2', '新增状态', 'sheet key alias'],
    ]);
  });

  it('首填在 API reset 收敛后的稳定 key 上接受全部唯一历史别名，并可由 V2 replay 重放', async () => {
    const initialData = {
      mate: { type: 'acu', version: 1 },
      sheet_zhu_jue_xin_xi: {
        uid: 'sheet_zhu_jue_xin_xi',
        name: '主角信息表',
        content: [['row_id', 'name'], ['1', '初始名']],
        sourceData: {
          ddl: 'CREATE TABLE protagonist_info (row_id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
          // resetCurrentChatTableStateFromTemplate_ACU 保留被稳定 key 替换的 transport identity。
          tableAliases: ['sheet_DpKcVGqg', 'legacy_protagonist_uid', '主角信息'],
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const aliases = [
      'sheet_zhu_jue_xin_xi', 'sheet_DpKcVGqg', 'legacy_protagonist_uid',
      '主角信息表', '主角信息', 'protagonist_info', 'zhujuexinxibiao',
    ];
    let workingData = JSON.parse(JSON.stringify(initialData));
    const operations: any[] = [];

    for (let index = 0; index < aliases.length; index += 1) {
      const result = await applySqlEditsToTableDataSnapshot_ACU(
        `UPDATE ${aliases[index]} SET name = '第${index + 1}次填表' WHERE row_id = 1`,
        workingData,
        'auto_standard',
        { targetSheetKeys: ['sheet_zhu_jue_xin_xi'], requireSheetScopedOperations: true, allowSingleTargetFallback: true },
      );
      expect(result.success, `${aliases[index]}: ${result.error || ''}`).toBe(true);
      expect(result.modifiedKeys).toEqual(['sheet_zhu_jue_xin_xi']);
      expect(result.operations).toHaveLength(1);
      expect(result.operations?.[0]).toMatchObject({ kind: 'sql_sheet_batch', sheetKey: 'sheet_zhu_jue_xin_xi' });
      operations.push(...(result.operations || []));
      workingData = result.workingData;
    }

    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: initialData,
              event: { filledSheetKeys: [], changedSheetKeys: ['sheet_zhu_jue_xin_xi'], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'first-fill-alias-replay', createdAt: 2, source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_zhu_jue_xin_xi'], changedSheetKeys: ['sheet_zhu_jue_xin_xi'], groupKeys: [], operations,
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false }))
      .resolves.toEqual(workingData);
  });

  it('宽松映射去前缀 sheetKey、uid 与 sql_sheet_batch metadata 表名', async () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state_uid',
        name: '全局数据表',
        content: [['row_id', 'note'], ['1', '初始状态']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, note TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'legacy-sheet-identities', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_global'], groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: 'sheet_global', tableName: 'obsolete_metadata', reason: 'system',
                statements: [
                  "UPDATE global SET note = 'short-key' WHERE row_id = 1",
                  "UPDATE global_state_uid SET note = 'uid' WHERE row_id = 1",
                  "UPDATE obsolete_metadata SET note = 'operation-table-name' WHERE row_id = 1",
                ],
              }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_global.content).toEqual([
      ['row_id', 'note'],
      ['1', 'operation-table-name'],
    ]);
  });

  it('冲突的 replay alias 保持原 SQL，并保留 SQLite operation 上下文', async () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_alpha: {
        uid: 'alpha_uid', name: '甲表', content: [['row_id', 'note'], ['1', 'a']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, note TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
      sheet_beta: {
        uid: 'beta_uid', name: '乙表', content: [['row_id', 'note'], ['1', 'b']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, note TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'conflicting-legacy-name', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_alpha'], groupKeys: [],
              operations: [{
                kind: 'sql_batch',
                statements: ["UPDATE global_state SET note = 'must not choose a sheet' WHERE row_id = 1"],
              }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(
      /messageIndex=0, seq=1, operationIndex=0, kind=sql_batch:.*no such table: global_state/i,
    );
  });

  it('宽松映射不改写 CTE、字符串或未知表，仍保留真实 SQLite 错误', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1, entryId: 'unknown-table', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'obsolete_table', reason: 'system',
                statements: [
                  "WITH inventory AS (SELECT 1 AS row_id) INSERT INTO nonexistent_table (row_id) SELECT row_id FROM inventory -- inventory remains a CTE",
                ],
              }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(/no such table: nonexistent_table/i);
  });


  it('直接执行历史 WITH SQL、参数与混合 SQL operation，不消费 sheet 元数据', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData(),
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [{
              seq: 1, entryId: 'legacy-with-dml', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [
                {
                  kind: 'sql_batch',
                  statements: ["WITH selected AS (SELECT ? AS row_id) UPDATE inventory SET name = '钢剑' /* FROM inventory */ WHERE row_id IN (SELECT row_id FROM selected)"],
                  params: [[1]],
                },
                {
                  kind: 'sql_sheet_batch', sheetKey: 'obsolete_sheet', tableName: 'obsolete_table', reason: 'manual_crud',
                  statements: ['WITH source AS (SELECT ? AS row_id, ? AS name) INSERT INTO inventory (row_id, name) SELECT row_id, name FROM source'],
                  params: [[2, '药水']],
                },
                {
                  kind: 'sql_batch',
                  statements: ['WITH RECURSIVE doomed(row_id) AS (SELECT ? UNION ALL SELECT row_id + 1 FROM doomed WHERE row_id < ?) DELETE FROM inventory WHERE row_id IN (SELECT row_id FROM doomed)'],
                  params: [[2, 2]],
                },
              ],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '钢剑'],
    ]);
  });

  it('历史 SQL 的真实 SQLite 执行错误仍会中断回放并包含 operation 上下文', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1, entryId: 'invalid-sql', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: 'obsolete_sheet', tableName: 'obsolete_table', reason: 'manual_crud',
                statements: ['WITH missing AS (SELECT 1) INSERT INTO nonexistent_table (row_id) SELECT * FROM missing'],
              }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(
      /messageIndex=0, seq=1, operationIndex=0, kind=sql_sheet_batch:.*no such table/i,
    );
  });


  it('同楼层单表 checkpoint 引入新 DDL/CHECK 后再回放 sql_batch', async () => {
    const oldData = {
      mate: { type: 'acu', version: 1 },
      sheet_MapElements: {
        uid: 'sheet_MapElements',
        name: 'mapelements',
        content: [['row_id', '元素名称', '元素类型'], ['1', '旧点', '地标']],
        sourceData: {
          ddl: `CREATE TABLE map_elements (
            row_id INTEGER PRIMARY KEY,
            element_name TEXT NOT NULL, -- 元素名称
            element_type TEXT NOT NULL CHECK(element_type IN ('地标')) -- 元素类型
          );`,
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const schemaChangeSheet = {
      ...oldData.sheet_MapElements,
      sourceData: {
        ddl: `CREATE TABLE map_elements (
          row_id INTEGER PRIMARY KEY,
          element_name TEXT NOT NULL, -- 元素名称
          element_type TEXT NOT NULL CHECK(element_type IN ('地标','地形')) -- 元素类型
        );`,
      },
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: oldData,
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_MapElements: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'schema_change',
                  sheetKey: 'sheet_MapElements',
                  data: schemaChangeSheet,
                },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_sql_terrain',
                createdAt: 3,
                source: 'manual_crud',
                targetMessageIndex: 1,
                aiFloor: 2,
                filledSheetKeys: [],
                changedSheetKeys: ['sheet_MapElements'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_batch',
                  statements: ["INSERT INTO mapelements (row_id, element_name, element_type) VALUES (2, '废弃集装箱', '地形')"],
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_MapElements.sourceData.ddl).toContain("'地形'");
    expect(result?.sheet_MapElements.content).toEqual([
      ['row_id', '元素名称', '元素类型'],
      ['1', '旧点', '地标'],
      ['2', '废弃集装箱', '地形'],
    ]);
  });

  it('当前 guide 不改写历史 full checkpoint，也不凭空创建新表', async () => {
    const oldData = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_InternalSheetGuide: {
        version: 2,
        tags: {
          '': {
            data: {
              mate: { type: 'chatSheets', version: 2 },
              sheet_0: { ...oldData.sheet_0, content: [['row_id', '未来名称']], sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, future_name TEXT);' } },
              sheet_future: { uid: 'future', name: '未来表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
            },
          },
        },
      },
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: oldData },
            logEntries: [],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content[0]).toEqual(['row_id', 'name']);
    expect(result?.sheet_0.sourceData.ddl).toBe('CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    expect(result).not.toHaveProperty('sheet_future');
  });

  it('回放无分号分隔且含前置文本的 table_edit_dsl', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: makeDslCheckpointData(),
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [{
                seq: 1,
                entryId: 'v2_dsl_1',
                createdAt: 2,
                source: 'auto_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_a', 'sheet_b'],
                changedSheetKeys: ['sheet_a', 'sheet_b'],
                groupKeys: [],
                operations: [{
                  kind: 'table_edit_dsl',
                  text: '说明文字 updateRow(0, 0, {"0":"城镇(北区)"}) insertRow(1, {"0":"第一天","1":"城镇(北区)","2":"记录包含括号(测试)，不应破坏命令切分。","3":"抵达城镇"})',
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_a.content[1]).toEqual(['1', '城镇(北区)']);
    expect(result?.sheet_b.content).toEqual([
      ['row_id', '时间跨度', '地点', '纪要', '概要'],
      ['1', '第一天', '城镇(北区)', '记录包含括号(测试)，不应破坏命令切分。', '抵达城镇'],
    ]);
  });

  it('row_upsert 的空 row_id 删除目标行，身份不一致的 row_upsert 经兼容降级按 rowId 归一后仍可读', async () => {
    const makeChat = (cells: any[]) => [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1,
              entryId: 'row-upsert',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells }],
            }],
          },
        },
      },
    }];

    const removed = await loadTableStateFromFramesV2_ACU(makeChat([' ', '不会保留']), '');
    expect(removed?.sheet_0.content).toEqual([['row_id', 'name']]);

    // 严格路径拒绝身份漂移，但读取降级链按 spv7.9 宽松语义以 rowId 为准归一（读永不 fail-closed）。
    const tolerated = await loadTableStateFromFramesV2_ACU(makeChat(['2', '冲突身份']), '');
    expect(tolerated?.sheet_0.content).toEqual([['row_id', 'name'], ['1', '冲突身份']]);
  });

  it('row_upsert 在身份、行宽或既有重复身份无效时不修改 state', () => {
    const cases = [
      { rowId: '1', cells: ['2', '身份漂移'] },
      { rowId: '1', cells: ['1'] },
    ];

    for (const patch of cases) {
      const state = makeCheckpointData();
      const before = JSON.parse(JSON.stringify(state));
      expect(() => applyTablePatchV2_ACU(state, { kind: 'row_upsert', sheetKey: 'sheet_0', ...patch } as any)).toThrow(/身份|行宽/i);
      expect(state).toEqual(before);
    }

    const duplicateState = makeCheckpointData();
    duplicateState.sheet_0.content.push([' 1 ', '重复行']);
    const duplicateBefore = JSON.parse(JSON.stringify(duplicateState));
    expect(() => applyTablePatchV2_ACU(duplicateState, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '新值'],
    } as any)).toThrow(/重复 row_id/i);
    expect(duplicateState).toEqual(duplicateBefore);
  });

  it('legacy 空身份 row_upsert 删除在目标缺失、坏表头或重复目标时 fail closed', () => {
    const cases = [
      { mutate: (state: any) => { state.sheet_0.content[0][0] = 'id'; }, error: /row_id 表头/i },
      { mutate: (state: any) => { state.sheet_0.content.push([' 1 ', '重复']); }, error: /重复 row_id/i },
    ];
    for (const { mutate, error } of cases) {
      const state = makeCheckpointData();
      mutate(state);
      const before = JSON.parse(JSON.stringify(state));
      expect(() => applyTablePatchV2_ACU(state, {
        kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: [null, '旧兼容删除'],
      } as any)).toThrow(error);
      expect(state).toEqual(before);
    }

    const missingTargetState = makeCheckpointData();
    const missingTargetBefore = JSON.parse(JSON.stringify(missingTargetState));
    expect(() => applyTablePatchV2_ACU(missingTargetState, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '404', cells: [null, '旧兼容删除'],
    } as any)).toThrow(/目标 row_id 不存在/i);
    expect(missingTargetState).toEqual(missingTargetBefore);

    const missingSheetState = makeCheckpointData();
    delete missingSheetState.sheet_0;
    const missingSheetBefore = JSON.parse(JSON.stringify(missingSheetState));
    expect(() => applyTablePatchV2_ACU(missingSheetState, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: [null, '旧兼容删除'],
    } as any)).toThrow(/删除目标 Sheet 缺失或 content 非法/i);
    expect(missingSheetState).toEqual(missingSheetBefore);

    const invalidContentState = makeCheckpointData();
    invalidContentState.sheet_0.content = null;
    const invalidContentBefore = JSON.parse(JSON.stringify(invalidContentState));
    expect(() => applyTablePatchV2_ACU(invalidContentState, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: [null, '旧兼容删除'],
    } as any)).toThrow(/删除目标 Sheet 缺失或 content 非法/i);
    expect(invalidContentState).toEqual(invalidContentBefore);

    const missingIdState = makeCheckpointData();
    const missingIdBefore = JSON.parse(JSON.stringify(missingIdState));
    expect(() => applyTablePatchV2_ACU(missingIdState, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: ' ', cells: [null, '旧兼容删除'],
    } as any)).toThrow(/缺少 row_id/i);
    expect(missingIdState).toEqual(missingIdBefore);
  });

  it('row_upsert 使用 canonical 身份更新现有行', () => {
    const state = makeCheckpointData();

    applyTablePatchV2_ACU(state, { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: ' 1 ', cells: ['1', '钢剑'] } as any);

    expect(state.sheet_0.content).toEqual([['row_id', 'name'], ['1', '钢剑']]);
  });

  it('旧 patches 与 DSL 生成的非法 canonical 行在 replay 边界被清理或拒绝', async () => {
    const legacyPatchChat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1,
              entryId: 'legacy-empty-row',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              patches: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: [null, '坏行'] }],
            }],
          },
        },
      },
    }];

    const legacyResult = await loadTableStateFromFramesV2_ACU(legacyPatchChat, '');
    expect(legacyResult?.sheet_0.content).toEqual([['row_id', 'name']]);

    const dslChat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1,
              entryId: 'dsl-insert',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{ kind: 'table_edit_dsl', text: 'insertRow(0, {"0":"药水"})' }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(dslChat, '')).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', 'name'], ['1', '铁剑'], ['2', '药水']] }),
    });
  });

  it('阶段 B1：DML → legacy meta_update(name/tableAliases) → DML：warm 与 cold 结果一致且发生失效', async () => {
    // 场景：legacy patches 中 meta_update 修改 sheet.name 与 sourceData.tableAliases
    // （身份证据变化），后续 sql_sheet_batch 必须用新身份重绑，否则旧 registry 会
    // 错误映射并写错表。
    const makeChat = () => [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init',
              data: {
                mate: { type: 'acu', version: 1 },
                sheet_0: {
                  uid: 'uid_0', name: '旧名称',
                  content: [['row_id', 'name'], ['1', '铁剑']],
                  sourceData: {
                    ddl: 'CREATE TABLE tbl_0 (row_id INTEGER PRIMARY KEY, name TEXT);',
                    tableAliases: ['旧名称'],
                  },
                  updateConfig: {}, exportConfig: {}, orderNo: 0,
                },
              },
            },
            logEntries: [
              {
                seq: 1, entryId: 'patch-meta', createdAt: 2, source: 'manual_crud',
                targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                patches: [{
                  kind: 'meta_update', sheetKey: 'sheet_0',
                  meta: { name: '新名称', sourceData: { tableAliases: ['新名称'] } },
                }],
              },
              {
                seq: 2, entryId: 'sql-after-meta', createdAt: 3, source: 'manual_crud',
                targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'tbl_0',
                  statements: ['INSERT INTO 新名称 (name) VALUES (?)'],
                  params: [['旧名SQL']], reason: 'system',
                }],
              },
            ],
          },
        },
      },
    }];

    const warm = await loadTableStateFromFramesV2Detailed_ACU(makeChat(), '', { updateRuntimeState: false });
    const cold = await loadTableStateFromFramesV2Detailed_ACU(makeChat(), '',
      { updateRuntimeState: false, enableAliasContext: false });

    // canonical 数据一致（meta_update 后新表名/别名生效，后续 SQL 命中新身份）。
    expect(warm?.data).toEqual(cold?.data);
    expect(warm?.data.sheet_0.name).toBe('新名称');
    expect(warm?.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '旧名SQL']]);
    // legacy patches 身份变更触发失效：warm 计数一次（enabled 路径）。
    expect(warm?.metrics?.aliasInvalidateCount).toBeGreaterThanOrEqual(1);
    expect(cold?.metrics?.aliasInvalidateCount).toBeGreaterThanOrEqual(1);
  });

  it('阶段 B1：DML → legacy sheet_replace → DML：warm 与 cold 一致且发生失效', async () => {
    const makeChat = () => [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init',
              data: {
                mate: { type: 'acu', version: 1 },
                sheet_0: {
                  uid: 'uid_0', name: '旧表',
                  content: [['row_id', 'name'], ['1', '铁剑']],
                  sourceData: { ddl: 'CREATE TABLE old_tbl (row_id INTEGER PRIMARY KEY, name TEXT);' },
                  updateConfig: {}, exportConfig: {}, orderNo: 0,
                },
              },
            },
            logEntries: [
              {
                seq: 1, entryId: 'patch-replace', createdAt: 2, source: 'manual_crud',
                targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                patches: [{
                  kind: 'sheet_replace', sheetKey: 'sheet_0',
                  reason: 'schema_change',
                  sheet: {
                    uid: 'uid_0', name: '新表',
                    content: [['row_id', 'name'], ['1', '铁剑']],
                    sourceData: { ddl: 'CREATE TABLE new_tbl (row_id INTEGER PRIMARY KEY, name TEXT);' },
                    updateConfig: {}, exportConfig: {}, orderNo: 0,
                  },
                }],
              },
              {
                seq: 2, entryId: 'sql-after-replace', createdAt: 3, source: 'manual_crud',
                targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'old_tbl',
                  statements: ['INSERT INTO new_tbl (name) VALUES (?)'],
                  params: [['替换后SQL']], reason: 'system',
                }],
              },
            ],
          },
        },
      },
    }];

    const warm = await loadTableStateFromFramesV2Detailed_ACU(makeChat(), '', { updateRuntimeState: false });
    const cold = await loadTableStateFromFramesV2Detailed_ACU(makeChat(), '',
      { updateRuntimeState: false, enableAliasContext: false });

    expect(warm?.data).toEqual(cold?.data);
    expect(warm?.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '替换后SQL']]);
    expect(warm?.metrics?.aliasInvalidateCount).toBeGreaterThanOrEqual(1);
    expect(cold?.metrics?.aliasInvalidateCount).toBeGreaterThanOrEqual(1);
  });

  it('阶段 B1：DML → legacy row_upsert/row_delete → DML：不失效但结果一致', async () => {
    const makeChat = () => [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init',
              data: {
                mate: { type: 'acu', version: 1 },
                sheet_0: {
                  uid: 'uid_0', name: '表',
                  content: [['row_id', 'name'], ['1', '铁剑'], ['2', '药水']],
                  sourceData: { ddl: 'CREATE TABLE tbl_0 (row_id INTEGER PRIMARY KEY, name TEXT);' },
                  updateConfig: {}, exportConfig: {}, orderNo: 0,
                },
              },
            },
            logEntries: [
              {
                seq: 1, entryId: 'patch-upsert', createdAt: 2, source: 'manual_crud',
                targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                patches: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '改名药水'] }],
              },
              {
                seq: 2, entryId: 'sql-after-data', createdAt: 3, source: 'manual_crud',
                targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'tbl_0',
                  statements: ['INSERT INTO tbl_0 (name) VALUES (?)'],
                  params: [['数据行SQL']], reason: 'system',
                }],
              },
            ],
          },
        },
      },
    }];

    const warm = await loadTableStateFromFramesV2Detailed_ACU(makeChat(), '', { updateRuntimeState: false });
    const cold = await loadTableStateFromFramesV2Detailed_ACU(makeChat(), '',
      { updateRuntimeState: false, enableAliasContext: false });

    expect(warm?.data).toEqual(cold?.data);
    expect(warm?.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '改名药水'], ['3', '数据行SQL']]);
    // row_upsert/row_delete 不改身份：aliasInvalidateCount 不因数据 patch 递增。
    expect(warm?.metrics?.aliasInvalidateCount).toBe(0);
    expect(cold?.metrics?.aliasInvalidateCount).toBe(0);
  });


  it('DSL 删除中间行后插入使用最大 row_id + 1，且保留 0 和 false', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content = [
      ['row_id', 'name', 'enabled'],
      ['1', '铁剑', true],
      ['2', '药水', true],
      ['3', '盾牌', true],
    ];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1, entryId: 'dsl-stable-row-id', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{ kind: 'table_edit_dsl', text: 'deleteRow(0, 1) insertRow(0, {"0":0,"1":false})' }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', 'name', 'enabled'], ['1', '铁剑', true], ['3', '盾牌', true], ['4', 0, false]] }),
    });
  });

  it('可回放合成 spv7.9 valid V2 full checkpoint fixture', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(validV2FrameFixture) } },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false })).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', '名称'], ['1', '铁剑']] }),
    });
  });

  it('合成 spv7.9 重复 row_id full checkpoint 在内存副本中无损修复且不修改 frame', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(invalidV2FrameFixture) } },
    }];
    const before = structuredClone(chat);

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false })).resolves.toMatchObject({
      sheet_0: expect.objectContaining({
        content: [['row_id', '名称'], ['1', '铁剑'], ['2', '冒名副本']],
      }),
    });
    expect(chat).toEqual(before);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('已在内存副本中保留全部行并重映射 1 行'));
  });

  it('合成 spv7.9 orphan data_replace fixture 无 full checkpoint 时以 replacement anchor 回放', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(orphanV2FrameFixture) } },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false })).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', '名称'], ['1', '铁剑']] }),
    });
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('data_replace 作为替换基底'));
  });

  it('显式开启时使用当前聊天模板 header-only 基线回放无锚点 sql_sheet_batch', async () => {
    const template = makeCheckpointData();
    template.sheet_0.content.push(['99', '模板示例行']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: {
          '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) },
        },
      },
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1,
              entryId: 'orphan-sql-sheet-batch',
              createdAt: 1,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_0',
                tableName: 'inventory',
                statements: ['INSERT INTO inventory (row_id, name) VALUES (?, ?)'],
                params: [[1, '孤立日志数据']],
                reason: 'system',
              }],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false })).resolves.toBeNull();

    const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      allowTemporaryTemplateBaseline: true,
    });

    expect(detailed?.baseKind).toBe('temporary_template_baseline');
    expect(detailed?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '孤立日志数据'],
    ]);
    expect(detailed?.data.sheet_0.content).not.toContainEqual(['99', '模板示例行']);
  });

  it('已有 full checkpoint 局部缺表时，在 sql_sheet_batch 执行点从同 key 模板补临时表并标记待收敛', async () => {
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'], ['99', '模板示例', '0分', '模板时间']],
        sourceData: {
          ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, prev_scene_time TEXT, elapsed_time TEXT, cur_time TEXT);',
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 1,
      },
    } as any;
    const checkpointData = makeCheckpointData();
    const messageIndex = 384;
    const frameMessage = {
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: {
          '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) },
        },
      },
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1,
              entryId: 'missing-global-sheet',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: messageIndex,
              aiFloor: 1,
              filledSheetKeys: ['sheet_global'],
              changedSheetKeys: ['sheet_global'],
              groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_global',
                tableName: 'quanjushujubiao',
                statements: ["INSERT INTO quanjushujubiao (row_id, prev_scene_time, elapsed_time, cur_time) VALUES (1, '2026-08-07 00:15', '5分', '2026-08-07 00:20')"],
                reason: 'system',
              }],
            }],
          },
        },
      },
    };
    const chat = [...Array.from({ length: messageIndex }, (_, index) => ({ is_user: index % 2 === 0 })), frameMessage];
    chat[0] = {
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: {
          '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) },
        },
      },
    };

    await expect(loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    })).rejects.toThrow('no such table: quanjushujubiao');

    const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(detailed?.data.sheet_global.content).toEqual([
      ['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'],
      ['1', '2026-08-07 00:15', '5分', '2026-08-07 00:20'],
    ]);
    expect(detailed?.compatibilityRepairs).toEqual([
      expect.objectContaining({
        kind: 'temporary_sheet_anchor',
        severity: 'provisional',
        sheetKey: 'sheet_global',
        messageIndex: 384,
        seq: 1,
        operationIndex: 0,
      }),
    ]);
    expect(detailed?.requiresCheckpointConvergence).toBe(true);
    expect(detailed?.data.sheet_global.content).not.toContainEqual(['99', '模板示例', '0分', '模板时间']);

    const chatWithoutMatchingTemplateSheet = structuredClone(chat) as any[];
    chatWithoutMatchingTemplateSheet[0].TavernDB_ACU_ScopedConfig.template[''].templateStr = JSON.stringify({
      mate: { type: 'acu', version: 1 },
    });

    await expect(loadTableStateFromFramesV2Detailed_ACU(chatWithoutMatchingTemplateSheet, '', {
      updateRuntimeState: false,
    })).rejects.toThrow('no such table: quanjushujubiao');

    const chatWithConflictingHistoricalTableName = structuredClone(chat) as any[];
    const conflictingOperation = chatWithConflictingHistoricalTableName[messageIndex]
      .TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations[0];
    conflictingOperation.tableName = 'inventory';
    conflictingOperation.statements = ["INSERT INTO inventory (row_id, name) VALUES (2, '不得误写到其他 Sheet')"];

    // 读取主路径不再 fail-closed：降级链按 spv7.9 历史表名别名语义回放，
    // 这条增量落到占用该历史表名的 sheet_0（忠实还原写入时代的可见结果）。
    const conflictTolerated = await loadTableStateFromFramesV2Detailed_ACU(chatWithConflictingHistoricalTableName, '', {
      updateRuntimeState: false,
    });
    expect(conflictTolerated?.baseKind).toBe('compat_tolerant_replay');
    expect(conflictTolerated?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '铁剑'],
      ['2', '不得误写到其他 Sheet'],
    ]);
    // 写路径校验探针（compatibilityMode:'disabled'）不进入降级链：无临时补锚时
    // sheet_global 不在 state 中，严格路径经历史别名回退解析（既有行为），
    // 结果绝不带 compat_tolerant_replay 基。
    const disabledProbe = await loadTableStateFromFramesV2Detailed_ACU(chatWithConflictingHistoricalTableName, '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(disabledProbe?.baseKind).toBe('full_checkpoint');

    const chatAfterDataReplace = structuredClone(chat) as any[];
    const entry = chatAfterDataReplace[messageIndex].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0];
    entry.operations = [
      { kind: 'data_replace', data: checkpointData, reason: 'system' },
      entry.operations[0],
    ];
    const afterDataReplace = await loadTableStateFromFramesV2Detailed_ACU(chatAfterDataReplace, '', {
      updateRuntimeState: false,
    });
    expect(afterDataReplace?.compatibilityRepairs).toEqual([
      expect.objectContaining({
        kind: 'temporary_sheet_anchor',
        sheetKey: 'sheet_global',
        operationIndex: 1,
      }),
    ]);
    expect(afterDataReplace?.data.sheet_global.content).toEqual([
      ['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'],
      ['1', '2026-08-07 00:15', '5分', '2026-08-07 00:20'],
    ]);
  });

  it('orphan data_replace 不依赖临时模板基线或恢复确认', async () => {
    const template = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: { '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) } },
      },
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: structuredClone(orphanV2FrameFixture) },
      },
    }];

    await expect(loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      allowTemporaryTemplateBaseline: true,
      throwOnRecoveryRequired: true,
    })).resolves.toMatchObject({
      baseKind: 'replacement_anchor',
      data: { sheet_0: expect.objectContaining({ content: [['row_id', '名称'], ['1', '铁剑']] }) },
    });
  });

  it('无 full checkpoint 时从完整 data_replace 建立 replacement anchor', async () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1,
                entryId: 'v2_import_data_replace',
                createdAt: 1,
                source: 'import',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_a', 'sheet_b'],
                changedSheetKeys: ['sheet_a', 'sheet_b'],
                groupKeys: [],
                operations: [{ kind: 'data_replace', data: makeDslCheckpointData(), reason: 'import' }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result).toEqual(makeDslCheckpointData());
  });

  it('旧 full checkpoint 含重复 canonical row_id 时保留全部行并按既有最大 ID 加一', async () => {


    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content.push([' 1 ', '冒名副本']);
    checkpointData.sheet_0.content.push(['7', '既有高位身份']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [],
          },
        },
      },
    }];
    const before = structuredClone(chat);

    const result = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '铁剑'],
      ['8', '冒名副本'],
      ['7', '既有高位身份'],
    ]);
    expect(chat).toEqual(before);
  });

  it('旧 full checkpoint 的重复 row_id 与短行共存时无损修复，并保留行号身份列', async () => {
    const checkpointData = makeLegacyMessyCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [],
          },
        },
      },
    }];
    const before = structuredClone(chat);

    const result = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });

    expect(result?.sheet_legacy.content).toEqual([
      ['row_id', '名称', '备注'],
      ['1', '铁剑', '完整行'],
      ['2', '木剑', null],
    ]);
    expect(chat).toEqual(before);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('已在内存副本中保留全部行并重映射 1 行'));

    const again = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });
    expect(again).toEqual(result);
  });

  it('不可无损修复的历史重复 checkpoint 输出脱敏审计原因，读取降级链仍按兼容语义读出数据', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content.push([' 1 ', '不会进入诊断的业务值', '不可确定的额外列']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [],
          },
        },
      },
    }];

    // 读取主路径不再 fail-closed：严格路径的 audit gate 失败后，降级链按
    // spv7.9 兼容语义读出数据（行身份重编号），越界尾格保留。
    const result = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });
    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '铁剑'],
      ['2', '不会进入诊断的业务值', '不可确定的额外列'],
    ]);
    // 严格路径的脱敏审计诊断仍然输出（可定位、不含业务值）。
    const diagnostic = mockLogWarn.mock.calls.map(([message]) => String(message)).find(message => message.includes('gate=audit_gate'));
    expect(diagnostic).toContain('upgrade_duplicate_row_id:1');
    expect(diagnostic).toContain('upgrade_overflow_cells:1');
    expect(diagnostic).toContain('导出原始 frame 后在数据管理执行 V2 恢复');
    expect(diagnostic).not.toContain('不会进入诊断的业务值');
    expect(diagnostic).not.toContain('不可确定的额外列');
    // 写路径校验探针（compatibilityMode:'disabled'）维持严格失败信号。
    await expect(loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false, compatibilityMode: 'disabled' }))
      .rejects.toThrow(/gate=audit_gate.*upgrade_overflow_cells:1.*upgrade_overflow_cells@sheet_0#2/);
  });


  it('replacement anchor 跳过同 frame 内其前的 operation，不复活已被替换的业务状态', async () => {
    const superseded = makeCheckpointData();
    superseded.sheet_0.content = [['row_id', 'name'], ['1', '应被替换掉']];
    const replacement = makeCheckpointData();
    replacement.sheet_0.content = [['row_id', 'name'], ['2', 'replacement 基底']];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1, entryId: 'mixed-anchor-entry', createdAt: 1, source: 'import', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [
                { kind: 'data_replace', data: superseded, reason: 'import' },
                { kind: 'data_replace', data: replacement, reason: 'import' },
                { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '3', cells: ['3', 'replacement 后增量'], reason: 'system' },
              ],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(result?.baseKind).toBe('replacement_anchor');
    expect(result?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['2', 'replacement 基底'],
      ['3', 'replacement 后增量'],
    ]);
    expect(result?.data.sheet_0.content.flat()).not.toContain('应被替换掉');
  });

  it('replacement anchor 与旧 seq 的物理顺序归一共用同一 cursor', async () => {
    const superseded = makeCheckpointData();
    superseded.sheet_0.content = [['row_id', 'name'], ['1', '不能复活']];
    const replacement = makeCheckpointData();
    replacement.sheet_0.content = [['row_id', 'name'], ['2', '旧 seq replacement']];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [
              {
                entryId: 'legacy-first', createdAt: 1, source: 'import', targetMessageIndex: 0, aiFloor: 1,
                filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
                operations: [{ kind: 'data_replace', data: superseded, reason: 'import' }],
              },
              {
                entryId: 'legacy-anchor', createdAt: 2, source: 'import', targetMessageIndex: 0, aiFloor: 1,
                filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
                operations: [
                  { kind: 'data_replace', data: replacement, reason: 'import' },
                  { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '3', cells: ['3', 'anchor 后写入'], reason: 'system' },
                ],
              },
            ],
          },
        },
      },
    }] as any[];

    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(result?.baseKind).toBe('replacement_anchor');
    expect(result?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['2', '旧 seq replacement'],
      ['3', 'anchor 后写入'],
    ]);
    expect(result?.data.sheet_0.content.flat()).not.toContain('不能复活');
  });

  it('旧重复 row_id 修复后，历史 row_delete 仍只作用于首个原身份', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content.push([' 1 ', '冒名副本']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1,
              entryId: 'legacy-delete-first-row-id',
              createdAt: 2,
              source: 'system',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{ kind: 'row_delete', sheetKey: 'sheet_0', rowId: '1' }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });

    expect(result?.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['2', '冒名副本'],
    ]);
  });

  it('旧 full checkpoint 含空 row_id 时保留该行并补稳定 ID，且不修改持久化 frame', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content.push(['', '无身份行']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [],
          },
        },
      },
    }];
    const before = structuredClone(chat);

    const result = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });

    // 业务行必须保留，并获得不与既有 ID 冲突的稳定身份。
    const rows = result!.sheet_0.content.slice(1);
    expect(rows).toHaveLength(checkpointData.sheet_0.content.length - 1);
    const restored = rows.find((row: any[]) => row[1] === '无身份行');
    expect(restored).toBeDefined();
    expect(String(restored![0]).trim()).not.toBe('');
    const rowIds = rows.map((row: any[]) => String(row[0]));
    expect(new Set(rowIds).size).toBe(rowIds.length);

    // 只读回放不得改写持久化 frame。
    expect(chat).toEqual(before);

    // 幂等：同一输入重复回放结果一致。
    const again = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });
    expect(again).toEqual(result);
  });

  it('bounded replay 范围早于首个 V2 frame 时返回空基底但不误报无锚点历史', async () => {
    const chat = [
      { is_user: false, mes: '早期普通 AI 消息' },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 2, reason: 'init', data: makeCheckpointData() },
              logEntries: [],
            },
          },
        },
      },
    ];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { maxMessageIndex: 0 })).resolves.toBeNull();
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it('只有空 V2 frame 且没有 full checkpoint 时返回空基底但不声称存在 log-only 数据', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toBeNull();
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it.each([
    ['perSheetCheckpoints', { perSheetCheckpoints: { sheet_0: { kind: 'sheet_full' } } }],
    ['manualRefillProgress', { manualRefillProgress: { kind: 'manual_refill' } }],
    ['headRevision', { headRevision: 'orphan-revision' }],
    ['畸形 null perSheetCheckpoints', { perSheetCheckpoints: null }],
    ['畸形数组 perSheetCheckpoints', { perSheetCheckpoints: [] }],
    ['畸形数字 perSheetCheckpoints', { perSheetCheckpoints: 7 }],
    ['畸形 headRevision', { headRevision: 7 }],
  ])('无 full checkpoint 且仅存在 %s 时保守告警并返回空基底', async (_label, artifact) => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [],
            ...artifact,
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('无锚点 V2 replay artifacts'));
  });

  it('空 perSheetCheckpoints 与空 headRevision 不构成无锚点 replay artifact', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [], perSheetCheckpoints: {}, headRevision: '' } },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toBeNull();
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it('bounded replay 在 anchor 前只有 checkpoint_fallback、full 位于 anchor 后时拒绝越界恢复', async () => {
    const fallbackData = makeCheckpointData();
    fallbackData.sheet_0.content[1][1] = '降级快照';
    const laterFullData = makeCheckpointData();
    laterFullData.sheet_0.content[1][1] = '后方 full';
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1, entryId: 'checkpoint-fallback-before-anchor', createdAt: 1, source: 'system', targetMessageIndex: 0, aiFloor: 1,
                filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
                operations: [{ kind: 'data_replace', data: fallbackData, reason: 'checkpoint_fallback' }],
              }],
            },
          },
        },
      },
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 3, reason: 'compaction', data: laterFullData },
              logEntries: [],
            },
          },
        },
      },
    ];

    await expect(loadTableStateFromFramesV2_ACU(chat, '', { maxMessageIndex: 1 })).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', 'name'], ['1', '降级快照']] }),
    });
    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toMatchObject({
      sheet_0: expect.objectContaining({ content: [['row_id', 'name'], ['1', '后方 full']] }),
    });
  });

  it('按日志顺序混合回放旧 data_replace、新 sheet_replace 与 row_upsert', async () => {
    const checkpointData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '表A',
        content: [['row_id', '值'], ['1', 'checkpoint-a']],
      },
      sheet_1: {
        name: '表B',
        content: [['row_id', '值'], ['1', 'checkpoint-b']],
      },
    } as any;
    const legacyDataReplace = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '表A',
        content: [['row_id', '值'], ['1', 'legacy-a']],
      },
      sheet_1: {
        name: '表B',
        content: [['row_id', '值'], ['1', 'legacy-b']],
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full',
              createdAt: 1,
              reason: 'init',
              data: checkpointData,
            },
            logEntries: [
              {
                seq: 1,
                entryId: 'legacy-data-replace',
                createdAt: 2,
                source: 'group_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0', 'sheet_1'],
                changedSheetKeys: ['sheet_0', 'sheet_1'],
                groupKeys: [],
                operations: [{ kind: 'data_replace', data: legacyDataReplace, reason: 'system' }],
              },
              {
                seq: 2,
                entryId: 'single-sheet-replace',
                createdAt: 3,
                source: 'group_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: { name: '表A', content: [['row_id', '值'], ['1', 'sheet-replace-a']] }, reason: 'system' }],
              },
              {
                seq: 3,
                entryId: 'row-upsert-after-replace',
                createdAt: 4,
                source: 'group_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_1'],
                changedSheetKeys: ['sheet_1'],
                groupKeys: [],
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_1', rowId: '2', cells: ['2', 'row-upsert-b'] }],
              },
            ],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([['row_id', '值'], ['1', 'sheet-replace-a']]);
    expect(result?.sheet_1.content).toEqual([['row_id', '值'], ['1', 'legacy-b'], ['2', 'row-upsert-b']]);
  });

  it('按跨 frame 时间线回放旧 SQL、单表 checkpoint、新 SQL 与后续替换操作', async () => {
    const rootData = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: {
        uid: 'inventory',
        name: 'inventory',
        content: [['row_id', 'name'], ['1', '铁剑']],
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
      sheet_equipment: {
        uid: 'equipment',
        name: 'equipment',
        content: [['row_id', 'name'], ['1', '布甲']],
        sourceData: { ddl: 'CREATE TABLE equipment (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 1,
      },
    } as any;
    const shardData = {
      ...rootData.sheet_inventory,
      content: [['row_id', 'name'], ['1', '分片剑']],
    };
    const replacementData = {
      mate: { type: 'acu', version: 1 },
      sheet_inventory: {
        ...rootData.sheet_inventory,
        content: [['row_id', 'name'], ['1', '替换前剑']],
      },
      sheet_equipment: {
        ...rootData.sheet_equipment,
        content: [['row_id', 'name'], ['1', '替换后布甲']],
      },
    } as any;
    const entry = (seq: number, entryId: string, operations: any[]) => ({
      seq,
      entryId,
      createdAt: seq + 1,
      source: 'manual_crud',
      targetMessageIndex: 0,
      aiFloor: 1,
      filledSheetKeys: [],
      changedSheetKeys: [],
      groupKeys: [],
      operations,
    });
    const chat: any[] = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [entry(1, 'legacy-cross-sheet-sql', [{
                kind: 'sql_batch',
                statements: [
                  "UPDATE inventory SET name = '旧 SQL 剑' WHERE row_id = 1",
                  "UPDATE equipment SET name = '旧 SQL 甲' WHERE row_id = 1",
                ],
              }])],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_inventory: {
                  kind: 'sheet_full',
                  createdAt: 3,
                  reason: 'manual',
                  sheetKey: 'sheet_inventory',
                  data: shardData,
                },
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [entry(2, 'sheet-sql-after-shard', [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_inventory',
                tableName: 'inventory',
                statements: ["UPDATE inventory SET name = '分片后 SQL 剑' WHERE row_id = 1"],
                reason: 'manual',
              }])],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [entry(3, 'whole-state-replace', [{
                kind: 'data_replace',
                data: replacementData,
                reason: 'checkpoint_fallback',
              }])],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                entry(4, 'sheet-replace-after-data-replace', [{
                  kind: 'sheet_replace',
                  sheetKey: 'sheet_inventory',
                  sheet: {
                    ...rootData.sheet_inventory,
                    content: [['row_id', 'name'], ['1', 'sheet_replace 剑']],
                  },
                  reason: 'manual',
                }]),
                entry(5, 'row-upsert-after-sheet-replace', [{
                  kind: 'row_upsert',
                  sheetKey: 'sheet_inventory',
                  rowId: '1',
                  cells: ['1', '最终剑'],
                }]),
              ],
            },
          },
        },
      },
    ];

    const afterShardAndSql = await loadTableStateFromFramesV2_ACU(chat.slice(0, 3), '');
    expect(afterShardAndSql?.sheet_inventory.content).toEqual([['row_id', 'name'], ['1', '分片后 SQL 剑']]);
    expect(afterShardAndSql?.sheet_equipment.content).toEqual([['row_id', 'name'], ['1', '旧 SQL 甲']]);

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_inventory.content).toEqual([['row_id', 'name'], ['1', '最终剑']]);
    expect(result?.sheet_equipment.content).toEqual([['row_id', 'name'], ['1', '替换后布甲']]);
  });

  it('从 boundary compaction checkpoint 开始回放降级旧 full 的 data_replace 与后续日志', async () => {
    const boundaryData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '剑']],
      },
    } as any;
    const downgradedManualSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        name: '物品表',
        content: [['row_id', '物品名'], ['1', '盾']],
      },
    } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'init',
                data: {
                  mate: { type: 'acu', version: 1 },
                  sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '旧剑']] },
                },
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                createdAt: 2,
                reason: 'compaction',
                data: boundaryData,
              },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 0,
                  entryId: 'downgraded-checkpoint-2',
                  createdAt: 3,
                  source: 'system',
                  targetMessageIndex: 2,
                  aiFloor: 3,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [{ kind: 'data_replace', data: downgradedManualSnapshot, reason: 'checkpoint_fallback' }],
                  writeSet: [{ kind: 'all' }],
                },
                {
                  seq: 1,
                  entryId: 'after-downgrade-update',
                  createdAt: 4,
                  source: 'auto_fill',
                  targetMessageIndex: 2,
                  aiFloor: 3,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: [],
                  operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '药水'] }],
                },
              ],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([
      ['row_id', '物品名'],
      ['1', '盾'],
      ['2', '药水'],
    ]);
  });

  it('手动重填 retain=10/30 层后删除第 30 层时，可从第 29 层安全 full baseline 恢复纪要表', async () => {
    const staleBoundaryData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        name: '纪要表',
        content: [['row_id', '事件'], ['20', '边界旧事件']],
      },
    } as any;
    const fullRefillData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        name: '纪要表',
        content: [
          ['row_id', '事件'],
          ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `第${index + 1}层事件`]),
        ],
      },
      sheet_outline: {
        name: '总体大纲',
        content: [
          ['row_id', '大纲'],
          ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `第${index + 1}层大纲`]),
        ],
      },
    } as any;
    const chat = Array.from({ length: 30 }, (_, index) => ({ is_user: false } as any));
    chat[20].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 20,
            reason: 'compaction',
            data: staleBoundaryData,
          },
          logEntries: [],
        },
      },
    };
    chat[28].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 29,
            reason: 'manual',
            data: fullRefillData,
          },
          logEntries: [],
        },
      },
    };
    chat[29].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          logEntries: [{
            seq: 1,
            entryId: 'manual-refill-progress-final',
            createdAt: 30,
            source: 'group_fill',
            targetMessageIndex: 29,
            aiFloor: 30,
            filledSheetKeys: ['sheet_summary', 'sheet_outline'],
            changedSheetKeys: ['sheet_summary', 'sheet_outline'],
            groupKeys: [],
            operations: [{ kind: 'data_replace', data: fullRefillData, reason: 'checkpoint_fallback' }],
          }],
        },
      },
    };
    chat.splice(29, 1);

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_summary.content).toHaveLength(31);
    expect(result?.sheet_summary.content[30]).toEqual(['30', '第30层事件']);
    expect(result?.sheet_outline.content[30]).toEqual(['30', '第30层大纲']);
  });

  it('跨第20层边界重填纪要表1-30后，重入从既有 full checkpoint 的单表快照恢复全部楼层且不污染非目标表', async () => {
    const boundaryData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        name: '纪要表',
        content: [['row_id', '事件'], ['20', '旧边界事件']],
      },
      sheet_outline: {
        name: '总体大纲',
        content: [['row_id', '大纲'], ['20', '保留的大纲']],
      },
    } as any;
    const refilledSummary = {
      name: '纪要表',
      content: [
        ['row_id', '事件'],
        ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `重填第${index + 1}层事件`]),
      ],
    } as any;
    const chat = Array.from({ length: 30 }, () => ({ is_user: false } as any));
    chat[20].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 20,
            reason: 'compaction',
            data: {
              ...boundaryData,
              sheet_summary: undefined,
            },
          },
          perSheetCheckpoints: {
            sheet_summary: {
              kind: 'sheet_full',
              createdAt: 30,
              reason: 'manual',
              sheetKey: 'sheet_summary',
              data: refilledSummary,
            },
          },
          logEntries: [],
        },
      },
    };

    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_summary).toEqual(expect.objectContaining({ kind: 'sheet_full', data: refilledSummary }));
    expect(chat[29].TavernDB_ACU_IsolatedData).toBeUndefined();
    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_summary.content).toHaveLength(31);
    expect(result?.sheet_summary.content[1]).toEqual(['1', '重填第1层事件']);
    expect(result?.sheet_summary.content[30]).toEqual(['30', '重填第30层事件']);
    expect(result?.sheet_outline).toEqual(boundaryData.sheet_outline);
  });

  it('按消息时间线用单表 checkpoint 覆盖旧 full 中的目标表，同时保留根数据与非目标表', async () => {
    const rootData = makeDslCheckpointData();
    const rebuiltSummarySheet = {
      ...rootData.sheet_b,
      content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '新 1-20 层纪要']],
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_b: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'manual',
                  sheetKey: 'sheet_b',
                  data: rebuiltSummarySheet,
                },
              },
              logEntries: [],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.mate).toEqual(rootData.mate);
    expect(result?.sheet_a).toEqual(rootData.sheet_a);
    expect(result?.sheet_b).toEqual(rebuiltSummarySheet);
  });

  it('同一 frame 内先应用单表 checkpoint，再按 seq 回放该 frame 的日志', async () => {
    const rootData = makeDslCheckpointData();
    const rebuiltSummarySheet = {
      ...rootData.sheet_b,
      content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '新 1-20 层纪要']],
    };
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_b: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'manual',
                  sheetKey: 'sheet_b',
                  data: rebuiltSummarySheet,
                },
              },
              logEntries: [{
                seq: 1,
                entryId: 'after-sheet-checkpoint',
                createdAt: 3,
                source: 'manual_fill',
                targetMessageIndex: 1,
                aiFloor: 2,
                filledSheetKeys: ['sheet_b'],
                changedSheetKeys: ['sheet_b'],
                groupKeys: [],
                operations: [{
                  kind: 'row_upsert',
                  sheetKey: 'sheet_b',
                  rowId: '21',
                  cells: ['21', '21-30', '新地点', '新第21层纪要', '新概要'],
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_b.content).toEqual([
      ['row_id', '时间跨度', '地点', '纪要', '概要'],
      ['20', '新 1-20 层纪要'],
      ['21', '21-30', '新地点', '新第21层纪要', '新概要'],
    ]);
  });

  it('同一 frame 内 data_replace 会整体替换先应用的单表 checkpoint', async () => {
    const rootData = makeDslCheckpointData();
    const shardData = {
      ...rootData.sheet_b,
      content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '分片纪要']],
    };
    const replacementData = {
      mate: { type: 'acu', version: 2 },
      sheet_a: {
        ...rootData.sheet_a,
        content: [['row_id', '地点'], ['1', '全量替换地点']],
      },
      sheet_b: {
        ...rootData.sheet_b,
        content: [['row_id', '时间跨度', '地点', '纪要', '概要'], ['20', '全量替换纪要']],
      },
    } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                sheet_b: {
                  kind: 'sheet_full',
                  createdAt: 2,
                  reason: 'manual',
                  sheetKey: 'sheet_b',
                  data: shardData,
                },
              },
              logEntries: [{
                seq: 1,
                entryId: 'same-frame-whole-state-replace',
                createdAt: 3,
                source: 'manual_fill',
                targetMessageIndex: 1,
                aiFloor: 2,
                filledSheetKeys: ['sheet_a', 'sheet_b'],
                changedSheetKeys: ['sheet_a', 'sheet_b'],
                groupKeys: [],
                operations: [{
                  kind: 'data_replace',
                  data: replacementData,
                  reason: 'checkpoint_fallback',
                }],
              }],
            },
          },
        },
      },
    ];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_b.content).toEqual([
      ['row_id', '时间跨度', '地点', '纪要', '概要'],
      ['20', '全量替换纪要'],
    ]);
    expect(result?.sheet_a.content).toEqual([
      ['row_id', '地点'],
      ['1', '全量替换地点'],
    ]);
    expect(result?.sheet_b.content.flat()).not.toContain('分片纪要');
  });

  it('只有单表 checkpoint 而没有整库 full 时拒绝恢复', async () => {
    const rootData = makeDslCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            perSheetCheckpoints: {
              sheet_b: {
                kind: 'sheet_full',
                createdAt: 1,
                reason: 'manual',
                sheetKey: 'sheet_b',
                data: rootData.sheet_b,
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).resolves.toBeNull();
  });


  it('introduction shard 在 afterSeq 后激活，使同 frame 的旧 data_replace 不会删除新增表', async () => {
    const rootData = makeDslCheckpointData();
    const introducedSheet = {
      uid: 'new_sheet', name: '新增表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 2,
    } as any;
    const replacementData = {
      ...rootData,
      sheet_a: { ...rootData.sheet_a, content: [['row_id', '地点'], ['1', '已替换']] },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_new: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_new', data: introducedSheet,
                timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 1 },
              },
            },
            logEntries: [{
              seq: 1, entryId: 'replace-before-introduction', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'data_replace', data: replacementData, reason: 'system' }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_a.content[1]).toEqual(['1', '已替换']);
    expect(result?.sheet_new).toEqual(introducedSheet);
  });

  it('introduction shard 在激活后仍允许后续 data_replace 保持全局覆盖语义', async () => {
    const rootData = makeDslCheckpointData();
    const introducedSheet = {
      uid: 'new_sheet', name: '新增表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 2,
    } as any;
    const replacementData = { ...rootData, sheet_new: { ...introducedSheet, content: [['row_id', '值'], ['1', '覆盖值']] } } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_new: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_new', data: introducedSheet,
                timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 0 },
              },
            },
            logEntries: [{
              seq: 1, entryId: 'replace-after-introduction', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'data_replace', data: replacementData, reason: 'system' }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_new.content).toEqual([['row_id', '值'], ['1', '覆盖值']]);
  });

  it('introduction 在空日志帧结束后同步应用自身 tracking event 与 schedule summary', async () => {
    const previousIndependentStates = independentTableStates_ACU;
    _set_independentTableStates_ACU({});
    const rootData = makeDslCheckpointData();
    const introducedSheet = {
      uid: 'new_sheet', name: '新增表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 2,
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_new: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_new', data: introducedSheet,
                timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 0 },
                event: { filledSheetKeys: ['sheet_new'], changedSheetKeys: ['sheet_new'], groupKeys: [] },
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    try {
      const result = await loadTableStateFromFramesV2_ACU(chat, '');
      const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

      expect(result?.sheet_new).toEqual(introducedSheet);
      expect(independentTableStates_ACU.sheet_new?.lastUpdatedAiFloor).toBe(1);
      expect(summary.sheet_new).toEqual({ lastFilledAiFloor: 1, lastChangedAiFloor: 1 });
    } finally {
      _set_independentTableStates_ACU(previousIndependentStates);
    }
  });

  it('多个 introduction 按 afterSeq 在 entry 之间激活，且不改变 data_replace 的全局语义', async () => {
    const rootData = makeDslCheckpointData();
    const sheetEarly = { uid: 'early', name: '早表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 2 } as any;
    const sheetLate = { uid: 'late', name: '晚表', content: [['row_id', '值']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 3 } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_early: { kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_early', data: sheetEarly, timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 0 } },
              sheet_late: { kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_late', data: sheetLate, timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 2 } },
            },
            logEntries: [
              { seq: 1, entryId: 'replace-before-late', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'data_replace', data: { ...rootData, sheet_early: sheetEarly }, reason: 'system' }] },
              { seq: 3, entryId: 'replace-after-late', createdAt: 3, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'data_replace', data: { ...rootData, sheet_early: sheetEarly, sheet_late: { ...sheetLate, content: [['row_id', '值'], ['1', '已覆盖']] } }, reason: 'system' }] },
            ],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');

    expect(result?.sheet_early).toEqual(sheetEarly);
    expect(result?.sheet_late.content).toEqual([['row_id', '值'], ['1', '已覆盖']]);
  });

  it.each([
    { label: 'missing', entries: [{}, {}] },
    { label: 'duplicate', entries: [{ seq: 1 }, { seq: 1 }] },
    { label: 'out-of-order', entries: [{ seq: 2 }, { seq: 1 }] },
    { label: 'negative', entries: [{ seq: -1 }, { seq: 0 }] },
  ])('按物理数组顺序兼容 $label frame seq，且 schedule summary 使用同一顺序', async ({ entries }) => {
    const rootData = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            logEntries: entries.map((entry, index) => ({
              ...entry, entryId: `bad-${index}`, createdAt: index + 1, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: index === 0 ? ['sheet_0'] : [],
              changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', `物理顺序-${index}`] }],
            })),
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual([['row_id', 'name'], ['1', '物理顺序-1']]);
    expect(summary.sheet_0).toEqual({ lastFilledAiFloor: 1, lastChangedAiFloor: 1 });
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('按数组物理顺序重建临时 seq'));
  });

  it('introduction 的声明 messageIndex 漂移时，replay 与 schedule summary 按物理承载 frame 继续工作', async () => {
    const rootData = makeCheckpointData();
    const introducedSheet = {
      ...rootData.sheet_0,
      uid: 'introduced-sheet',
      name: 'introduced-sheet',
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_new: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_new', data: introducedSheet,
                event: { filledSheetKeys: ['sheet_new'], changedSheetKeys: ['sheet_new'], groupKeys: [] },
                timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 34, afterSeq: 0 },
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(result?.sheet_new).toEqual(introducedSheet);
    expect(summary.sheet_new).toEqual({ lastFilledAiFloor: 1, lastChangedAiFloor: 1 });
  });
  it('rebase 分片在 afterSeq 之后整表替换既有表结构（E3：前置日志先应用）', async () => {
    const rootData = makeCheckpointData();
    // 边界楼层已有 AI 填表日志（seq=1 追加一行），随后 rebase 在 afterSeq=1 之后整表替换为新结构。
    const rebasedSheet = {
      uid: 'inventory', name: 'inventory',
      content: [['row_id', 'name', 'quality'], ['1', '铁剑', ''], ['2', '木剑', '']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT NOT NULL);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_0: {
                kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_0', data: rebasedSheet,
                event: { filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] },
                timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 34, afterSeq: 1 },
              },
            },
            logEntries: [
              { seq: 1, entryId: 'ai-fill', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'data_replace', data: { ...rootData, sheet_0: { ...rootData.sheet_0, content: [['row_id', 'name'], ['1', '铁剑'], ['2', '木剑']] } }, reason: 'system' }] },
            ],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    // rebase 在 seq=1 日志之后生效：新结构（含 quality 列）+ 两行数据都在。
    expect(result?.sheet_0.content).toEqual([['row_id', 'name', 'quality'], ['1', '铁剑', ''], ['2', '木剑', '']]);
    expect(summary.sheet_0).toEqual({ lastFilledAiFloor: 1, lastChangedAiFloor: 1 });
  });

  it('带 provenance 的模板临时根可回放 data_replace，并由末端 rebase 恢复目标表', async () => {
    const template = makeCheckpointData();
    const finalSheet = { ...template.sheet_0, content: [['row_id', 'name'], ['final', '重填完成']] };
    const replacement = {
      ...template,
      sheet_0: { ...template.sheet_0, content: [['row_id', 'name'], ['old', '旧数据']] },
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'manual', data: template,
              fallbackProvenance: {
                version: 1, kind: 'manual_refill_template_root', runId: 'manual-refill:test', isolationKey: '',
                targetSheetKeys: ['sheet_0'], rangeStartMessageIndex: 0, rangeEndMessageIndex: 0,
                templateFingerprint: 'fnv1a:test', createdAt: 1,
              },
            },
            perSheetCheckpoints: {
              sheet_0: { kind: 'sheet_full', createdAt: 3, reason: 'manual', sheetKey: 'sheet_0', data: finalSheet, timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 0, afterSeq: 1 } },
            },
            logEntries: [{ seq: 1, entryId: 'replace', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'data_replace', data: replacement, reason: 'system' }] }],
          },
        },
      },
    }];

    const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(detailed?.baseKind).toBe('full_checkpoint');
    expect(detailed?.data.sheet_0.content).toEqual([['row_id', 'name'], ['final', '重填完成']]);
  });

  it('sheet_reveal 分片在 afterSeq 之后整表恢复被隐藏的表（恢复离开时数据）', async () => {
    const rootData = makeCheckpointData();
    // 根 checkpoint 中不含 sheet_revived（已隐藏）；reveal 分片将其带数据整表恢复。
    const revivedSheet = {
      uid: 'revived', name: '重要NPC表',
      content: [['row_id', 'value'], ['1', '离开时的数据']],
      sourceData: { ddl: 'CREATE TABLE revived (row_id INTEGER PRIMARY KEY, value TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 5,
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_revived: {
                kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_revived', data: revivedSheet,
                event: { filledSheetKeys: ['sheet_revived'], changedSheetKeys: ['sheet_revived'], groupKeys: [] },
                timeline: { kind: 'sheet_reveal', activateAtMessageIndex: 34, afterSeq: 0 },
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(result?.sheet_revived?.content).toEqual([['row_id', 'value'], ['1', '离开时的数据']]);
    expect(summary.sheet_revived).toEqual({ lastFilledAiFloor: 1, lastChangedAiFloor: 1 });
  });

  it('sheet_hide 分片在 afterSeq 之后从 replay state 移除该表可见性（数据不参与 active state）', async () => {
    const rootData = makeCheckpointData();
    // 根 checkpoint 含 sheet_0；hide 分片在 afterSeq=0 之后将其从 active state 移除。
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_0: {
                kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_0', data: rootData.sheet_0,
                event: { filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [] },
                timeline: { kind: 'sheet_hide', activateAtMessageIndex: 34, afterSeq: 0 },
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(result && Object.prototype.hasOwnProperty.call(result, 'sheet_0')).toBe(false);
    expect(summary.sheet_0).toEqual({ lastChangedAiFloor: 1 });
  });

  it('hide 的 afterSeq 晚于同 frame 日志时，先执行针对该表的 operation 再隐藏（切回原模板不再崩溃）', async () => {
    // 复现真实场景：多表模板下 sheet_extra 已存在于 active state（已被一键补齐填过），
    // 同 frame 仍有 seq=1 的 sql_sheet_batch 写该表；随后切回默认模板写入 hide。
    // perSheetCheckpoints 是按 sheetKey 唯一的 map，hide 会覆盖先前的 introduction，
    // 所以存档里只剩 hide 一条。hide 必须晚于 seq=1 生效，否则表被提前删 → no such table。
    const rootData = makeCheckpointData();
    rootData.sheet_extra = {
      uid: 'extra',
      name: '系统规则表',
      content: [['row_id', 'rule_name']],
      sourceData: { ddl: 'CREATE TABLE extra_rules (row_id INTEGER PRIMARY KEY, rule_name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 9,
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              // 修复后的值：afterSeq = lastLogSeq + 1 = 2，使 hide 晚于 seq=1 生效。
              sheet_extra: {
                kind: 'sheet_full', createdAt: 4, reason: 'schema_change', sheetKey: 'sheet_extra',
                data: rootData.sheet_extra,
                timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 2 },
              },
            },
            logEntries: [{
              seq: 1,
              entryId: 'fill-extra',
              createdAt: 3,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: ['sheet_extra'],
              changedSheetKeys: ['sheet_extra'],
              groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_extra',
                tableName: 'extra_rules',
                reason: 'system',
                statements: ['INSERT INTO extra_rules (row_id, rule_name) VALUES (?, ?)'],
                params: [[1, '六维属性']],
              }],
            }],
          },
        },
      },
    }] as any[];

    // 不报错（afterSeq=0 的旧行为会抛 no such table），且最终该表被隐藏。
    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result).not.toBeNull();
    expect(result && Object.prototype.hasOwnProperty.call(result, 'sheet_extra')).toBe(false);
    // 原有表不受影响。
    expect(result?.sheet_0?.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
  });

  it('hide 的 afterSeq 早于同 frame 日志时复现旧 bug（回归护栏）', async () => {
    // 锁住因果：afterSeq=0 会让 hide 抢在 seq=1 之前删表，导致 operation 撞上 no such table。
    const rootData = makeCheckpointData();
    rootData.sheet_extra = {
      uid: 'extra',
      name: '系统规则表',
      content: [['row_id', 'rule_name']],
      sourceData: { ddl: 'CREATE TABLE extra_rules (row_id INTEGER PRIMARY KEY, rule_name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 9,
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: {
          '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(rootData) },
        },
      },
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_extra: {
                kind: 'sheet_full', createdAt: 4, reason: 'schema_change', sheetKey: 'sheet_extra',
                data: rootData.sheet_extra,
                timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
              },
            },
            logEntries: [{
              seq: 1,
              entryId: 'fill-extra',
              createdAt: 3,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: ['sheet_extra'],
              changedSheetKeys: ['sheet_extra'],
              groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_extra',
                tableName: 'extra_rules',
                reason: 'system',
                statements: ['INSERT INTO extra_rules (row_id, rule_name) VALUES (?, ?)'],
                params: [[1, '六维属性']],
              }],
            }],
          },
        },
      },
    }] as any[];

    await expect(loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    })).rejects.toThrow(/no such table/);

    const repaired = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
    expect(repaired?.compatibilityRepairs).toEqual([
      expect.objectContaining({ kind: 'temporary_sheet_anchor', sheetKey: 'sheet_extra', seq: 1, operationIndex: 0 }),
    ]);
    // hide 已在 operation 前生效；后续明确 sql_sheet_batch 是新的写入事实，因此补锚后的表保持 active。
    // 若业务仍要求最终隐藏，必须存在 operation 之后的 hide timeline，不能让已消费的 hide 再次生效。
    expect(repaired?.data.sheet_extra.content).toEqual([['row_id', 'rule_name'], ['1', '六维属性']]);
    expect(repaired?.requiresCheckpointConvergence).toBe(true);
  });





  it.each([
    { label: 'kind', timeline: { kind: 'sheet_bogus', activateAtMessageIndex: 0, afterSeq: 0 } },
    { label: 'negative activateAtMessageIndex', timeline: { kind: 'sheet_rebase', activateAtMessageIndex: -1, afterSeq: 0 } },
    { label: 'fractional activateAtMessageIndex', timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 1.5, afterSeq: 0 } },
    { label: 'afterSeq', timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 0, afterSeq: -1 } },
  ])('rebase 分片与旧 sheet_schema_migrate 无关，非法 timeline $label fail-closed', async ({ timeline }) => {
    const rootData = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_0: { kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_0', data: rootData.sheet_0, timeline },
            },
            logEntries: [],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow('非法 timeline');
    expect(() => collectScheduleSummaryFromFramesV2_ACU(chat, '')).toThrow('非法 timeline');
  });

  it('per-sheet checkpoint 的合法 map key 覆盖冲突 sheetKey，state 与 schedule 使用同一物理归属', async () => {
    const rootData = makeCheckpointData();
    const rebasedSheet = {
      ...rootData.sheet_0,
      content: [['row_id', 'name'], ['1', '来自 map key 的 checkpoint']],
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_0: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_other', data: rebasedSheet,
                event: { filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [] },
                timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 34, afterSeq: 0 },
              },
            },
            logEntries: [],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(result?.sheet_0.content).toEqual(rebasedSheet.content);
    expect(result && Object.prototype.hasOwnProperty.call(result, 'sheet_other')).toBe(false);
    expect(summary.sheet_0).toEqual({ lastChangedAiFloor: 1 });
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('sheetKey sheet_other→sheet_0'));
  });

  it('per-sheet checkpoint 的非法 map key 使用合法 sheetKey，并为缺失 activateAtMessageIndex 补承载 frame 位置', async () => {
    const rootData = makeCheckpointData();
    const introducedSheet = {
      ...rootData.sheet_0,
      uid: 'legacy-sheet',
      name: '旧协议表',
      content: [['row_id', 'name'], ['1', '旧元数据仍可读']],
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              legacy_checkpoint_slot: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_legacy', data: introducedSheet,
                event: { filledSheetKeys: ['sheet_legacy'], changedSheetKeys: ['sheet_legacy'], groupKeys: [] },
                timeline: { kind: 'sheet_introduction', afterSeq: 0 },
              },
            },
            logEntries: {
              entryId: 'legacy-single-entry', createdAt: 3, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [],
            },
          },
        },
      },
    }] as any[];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(result?.sheet_legacy.content).toEqual(introducedSheet.content);
    expect(summary.sheet_legacy).toEqual({ lastFilledAiFloor: 1, lastChangedAiFloor: 1 });
    expect(mockLogWarn).not.toHaveBeenCalledWith(expect.stringContaining('sheetKey sheet_legacy→sheet_legacy'));
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('activateAtMessageIndex→0'));
  });

  it('per-sheet checkpoint 缺失 afterSeq 时保留结构性拒绝并提供 frame 定位', async () => {
    const rootData = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: rootData },
            perSheetCheckpoints: {
              sheet_legacy: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_legacy', data: rootData.sheet_0,
                timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0 },
              },
            },
            logEntries: [],
          },
        },
      },
    }] as any[];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(
      'sheetKey=sheet_legacy, messageIndex=0',
    );
    expect(() => collectScheduleSummaryFromFramesV2_ACU(chat, '')).toThrow(
      'sheetKey=sheet_legacy, messageIndex=0',
    );
  });



  it('V2 schema operation 经 replay 保留历史值并应用 literal DEFAULT', async () => {
    const state = makeCheckpointData();
    const before = state.sheet_0;
    const target = {
      ...before,
      content: [['row_id', 'name', 'quality'], ['1', '铁剑', 'normal']],
      sourceData: { ddl: "CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, quality TEXT NOT NULL DEFAULT 'normal');" },
    };
    const operation = await buildSheetSchemaMigrationOperationV2_ACU('sheet_0', before, target, {
      physicalColumnMappings: [],
      fills: {
        quality: { kind: 'ddl_literal_default', literal: { kind: 'string', sql: "'normal'", value: 'normal' } },
      },
      conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    });

    await applyTableOperationV2_ACU(state, operation);

    expect(state.sheet_0.content).toEqual([
      ['row_id', 'name', 'quality'],
      ['1', '铁剑', 'normal'],
    ]);
    expect(state.sheet_0.sourceData.ddl).toContain("quality TEXT NOT NULL DEFAULT 'normal'");
  });

  it('首个 schema operation 即使没有前置 SQL 也必须执行真实 SQLite hydrate', async () => {
    const before = makeCheckpointData().sheet_0;
    const validAfter = {
      ...before,
      content: [['row_id', 'name', 'marker'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, marker TEXT);' },
    };
    const operation = await buildSheetSchemaMigrationOperation_ACU('sheet_0', before, validAfter);
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_other = {
      uid: 'other', name: '损坏表', orderNo: 1,
      content: [['row_id', 'value'], ['1', null]],
      sourceData: { ddl: 'CREATE TABLE other_table (row_id INTEGER PRIMARY KEY, value TEXT CHECK (value IS NOT NULL));' },
      updateConfig: {}, exportConfig: {},
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1, entryId: 'schema-without-sql', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [operation],
            }],
          },
        },
      },
    }];

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow('SQLite');
    expect(checkpointData.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
  });

  it('已加载 runtime 导出后 schema contract 失败仍不提交 exported state', async () => {
    const state = makeCheckpointData();
    const original = structuredClone(state);
    const exported = structuredClone(state);
    exported.sheet_0.content[1][1] = '运行时新值';
    const loadedRuntime = {
      loaded: true,
      engine: { dispose: () => undefined },
      syncBridge: {
        exportToTableData: () => exported,
        loadFromTableData: () => undefined,
      },
    };
    const invalidOperation = {
      kind: 'sheet_schema_migrate', contractVersion: 0, sheetKey: 'sheet_0',
    };

    await expect(applyTableOperationV2_ACU(state, invalidOperation as any, loadedRuntime as any)).rejects.toThrow('contractVersion');
    expect(state).toEqual(original);
    expect(loadedRuntime.loaded).toBe(true);
  });

  it('旧 data_replace 含空 row_id 时保留业务行并补稳定 ID', async () => {
    const state = makeCheckpointData();
    const legacyData = makeCheckpointData();
    legacyData.sheet_0.content.push(['', '无身份行']);
    const legacyDataBefore = structuredClone(legacyData);

    await applyTableOperationV2_ACU(state, {
      kind: 'data_replace',
      data: legacyData,
      reason: 'system',
    } as any);

    const rows = state.sheet_0.content.slice(1);
    expect(rows).toHaveLength(legacyDataBefore.sheet_0.content.length - 1);
    const restored = rows.find((row: any[]) => row[1] === '无身份行');
    expect(restored).toBeDefined();
    expect(String(restored![0]).trim()).not.toBe('');
    const rowIds = rows.map((row: any[]) => String(row[0]));
    expect(new Set(rowIds).size).toBe(rowIds.length);

    // operation 载荷本身不得被就地改写。
    expect(legacyData).toEqual(legacyDataBefore);
  });

  it('旧 sheet_replace 含空 row_id 时保留业务行并补稳定 ID', async () => {
    const state = makeCheckpointData();
    const legacySheet = {
      ...structuredClone(state.sheet_0),
      content: [['row_id', 'name'], ['', '无身份行']],
    };
    const legacySheetBefore = structuredClone(legacySheet);

    await applyTableOperationV2_ACU(state, {
      kind: 'sheet_replace',
      sheetKey: 'sheet_0',
      sheet: legacySheet,
      reason: 'system',
    } as any);

    const rows = state.sheet_0.content.slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('无身份行');
    expect(String(rows[0][0]).trim()).not.toBe('');

    expect(legacySheet).toEqual(legacySheetBefore);
  });

  it('data_replace 含非数组行时仍然拒绝且不修改输入 state', async () => {
    const state = makeCheckpointData();
    const original = structuredClone(state);
    const invalidData = makeCheckpointData();
    invalidData.sheet_0.content.push('不是数组行' as any);

    await expect(applyTableOperationV2_ACU(state, {
      kind: 'data_replace',
      data: invalidData,
      reason: 'system',
    } as any)).rejects.toThrow('行标识不合法');

    expect(state).toEqual(original);
  });

  it('data_replace 空 row_id 补 ID 后，后续 row_upsert 仍按既有身份命中原行', async () => {
    const state = makeCheckpointData();
    const legacyData = makeCheckpointData();
    // '1' 已被占用；无身份行补 ID 时不得抢占既有身份。
    legacyData.sheet_0.content = [['row_id', 'name'], ['1', '原有行'], ['', '无身份行']];

    await applyTableOperationV2_ACU(state, {
      kind: 'data_replace',
      data: legacyData,
      reason: 'system',
    } as any);

    const synthesized = state.sheet_0.content
      .slice(1)
      .find((row: any[]) => row[1] === '无身份行');
    expect(String(synthesized![0])).not.toBe('1');

    // 后续 operation 引用 '1' 必须仍然命中原有行，而不是被合成 ID 顶掉。
    await applyTableOperationV2_ACU(state, {
      kind: 'row_upsert',
      sheetKey: 'sheet_0',
      rowId: '1',
      cells: ['1', '原有行已更新'],
      reason: 'system',
    } as any);

    const rows = state.sheet_0.content.slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.find((row: any[]) => String(row[0]) === '1')![1]).toBe('原有行已更新');
    expect(rows.find((row: any[]) => row[1] === '无身份行')).toBeDefined();
  });

  it('data_replace 旧 id 表头归一为 row_id 且业务值不移位', async () => {
    const state = makeCheckpointData();
    const legacyData = makeCheckpointData();
    legacyData.sheet_0.content = [['id', 'name'], ['1', '铁剑'], ['', '药水']];

    await applyTableOperationV2_ACU(state, {
      kind: 'data_replace',
      data: legacyData,
      reason: 'system',
    } as any);

    expect(state.sheet_0.content[0][0]).toBe('row_id');
    const rows = state.sheet_0.content.slice(1);
    expect(rows).toHaveLength(2);
    // 业务列不得因表头改名而错位。
    expect(rows.map((row: any[]) => row[1])).toEqual(['铁剑', '药水']);
    expect(String(rows[1][0]).trim()).not.toBe('');
  });

  it('data_replace 完全缺失身份列时前插 row_id 且保留全部业务单元格', async () => {
    const state = makeCheckpointData();
    const legacyData = makeCheckpointData();
    // header-chinese.json 同型：旧数据没有身份列概念。
    legacyData.sheet_0.content = [['名称', '数量'], ['铁剑', 1], ['药水', 2]];

    await applyTableOperationV2_ACU(state, {
      kind: 'data_replace',
      data: legacyData,
      reason: 'system',
    } as any);

    expect(state.sheet_0.content[0]).toEqual(['row_id', '名称', '数量']);
    const rows = state.sheet_0.content.slice(1);
    expect(rows).toHaveLength(2);
    // 每行业务值整体右移一列，不得丢失或截断。
    expect(rows.map((row: any[]) => row.slice(1))).toEqual([['铁剑', 1], ['药水', 2]]);
    const rowIds = rows.map((row: any[]) => String(row[0]));
    expect(rowIds.every(rowId => rowId.trim() !== '')).toBe(true);
    expect(new Set(rowIds).size).toBe(rowIds.length);
  });

  it('data_replace 空 row_id 与 duplicate 并存时仍拒绝，不静默择一', async () => {
    const state = makeCheckpointData();
    const original = structuredClone(state);
    const legacyData = makeCheckpointData();
    legacyData.sheet_0.content = [['row_id', 'name'], ['1', '甲'], ['1', '乙'], ['', '丙']];

    await expect(applyTableOperationV2_ACU(state, {
      kind: 'data_replace',
      data: legacyData,
      reason: 'system',
    } as any)).rejects.toThrow('行标识不合法');

    expect(state).toEqual(original);
  });


  it('JS-native 操作离开 SQL 段时先 materialize 一次并 dispose（单 Database 峰值）', async () => {
    const state = makeCheckpointData();
    const oldDispose = vi.fn();
    const exported = structuredClone(state);
    const loadedRuntime = {
      loaded: true,
      mode: 'sqlite_loaded',
      engine: { dispose: oldDispose },
      syncBridge: {
        exportToTableData: () => structuredClone(exported),
      },
    };
    const nextSheet = {
      ...structuredClone(state.sheet_0),
      content: [['row_id', 'name'], ['1', '铁剑'], ['2', '新行']],
    };

    await applyTableOperationV2_ACU(state, {
      kind: 'sheet_replace',
      sheetKey: 'sheet_0',
      sheet: nextSheet,
      reason: 'system',
    } as any, loadedRuntime as any);

    // materialize：SQLite 导出 → state，随后 dispose，runtime 标记未加载。
    // JS-native 提交不再 hydrate candidate，因此这里不重建 Database。
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(loadedRuntime.loaded).toBe(false);
    expect(loadedRuntime.mode).toBe('js_materialized');
    expect(state.sheet_0.content).toEqual(nextSheet.content);
  });

  it('materialize 导出抛错时 state 不变、runtime 保持 SQLite 权威（失败原子性）', async () => {
    const state = makeCheckpointData();
    const original = structuredClone(state);
    const dispose = vi.fn();
    const loadedRuntime = {
      loaded: true,
      mode: 'sqlite_loaded',
      engine: { dispose },
      syncBridge: {
        exportToTableData: () => { throw new Error('导出中途失败'); },
      },
    };

    await expect(applyTableOperationV2_ACU(state, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '新行'],
    } as any, loadedRuntime as any)).rejects.toThrow('导出中途失败');

    // 导出失败：state 未被替换，runtime 仍保持 SQLite 权威（loaded/mode 不变），
    // 且不 dispose（导出失败不应破坏可重试的 SQLite 权威状态）。
    expect(state).toEqual(original);
    expect(loadedRuntime.loaded).toBe(true);
    expect(loadedRuntime.mode).toBe('sqlite_loaded');
    expect(dispose).not.toHaveBeenCalled();
  });


  it('SQL→JS→SQL 多段回放只 hydrate 2 次并 dispose 1 次（单 Database 峰值）', async () => {
    const state = makeCheckpointData();
    const init = vi.fn().mockResolvedValue(undefined);
    const runBatch = vi.fn();
    const dispose = vi.fn();
    const loadFromTableData = vi.fn();
    const exportToTableData = vi.fn(() => structuredClone(state));
    const loadedRuntime = {
      loaded: false,
      mode: 'js_materialized',
      engine: { init, runBatch, dispose },
      syncBridge: { loadFromTableData, exportToTableData },
    };

    // 第一段：SQL hydrate 一次
    await applyTableOperationV2_ACU(state, {
      kind: 'sql_batch',
      statements: ["UPDATE inventory SET name = '钢剑' WHERE row_id = 1"],
    } as any, loadedRuntime as any);
    expect(init).toHaveBeenCalledTimes(1);
    expect(loadFromTableData).toHaveBeenCalledTimes(1);
    expect(loadedRuntime.mode).toBe('sqlite_loaded');

    // 第二段：JS-native 操作先 materialize（导出 + dispose），不再 hydrate
    await applyTableOperationV2_ACU(state, {
      kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '新行'],
    } as any, loadedRuntime as any);
    expect(exportToTableData).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1); // 不重建 Database
    expect(loadedRuntime.loaded).toBe(false);
    expect(loadedRuntime.mode).toBe('js_materialized');

    // 第三段：回到 SQL 再次 hydrate（第二次）
    await applyTableOperationV2_ACU(state, {
      kind: 'sql_batch',
      statements: ["UPDATE inventory SET name = '木剑' WHERE row_id = 1"],
    } as any, loadedRuntime as any);
    expect(init).toHaveBeenCalledTimes(2);
    expect(loadFromTableData).toHaveBeenCalledTimes(2);
    expect(loadedRuntime.mode).toBe('sqlite_loaded');

    // 峰值不变量：任意时刻最多一个活跃 Database（dispose 后 init，不叠加）
    expect(dispose).toHaveBeenCalledTimes(1);
  });


  it('legacy meta_update 携带 sourceData.ddl 时严格路径拒绝，读取降级链按 spv7.9 语义应用且不改写原 checkpoint', async () => {
    const previousIndependentStates = independentTableStates_ACU;
    _set_independentTableStates_ACU({});
    const checkpointData = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1, entryId: 'legacy-meta-ddl', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{
                kind: 'meta_update', sheetKey: 'sheet_0',
                meta: { sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, unsafe TEXT);' } },
              }],
            }],
          },
        },
      },
    }];

    try {
      // 读取降级链（Tier-1）按 spv7.9 语义 Object.assign 应用 legacy ddl，数据可读。
      const result = await loadTableStateFromFramesV2_ACU(chat, '');
      expect(result?.sheet_0.sourceData.ddl).toBe('CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, unsafe TEXT);');
      expect(result?.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
      // 原始 checkpoint 对象不被回放修改（回放全程在深拷贝副本上进行）。
      expect(checkpointData.sheet_0.sourceData.ddl).toBe('CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);');
    } finally {
      _set_independentTableStates_ACU(previousIndependentStates);
    }
  });

  it('已加载 runtime 下 legacy meta_update DDL 被拒绝前不导出或提交 runtime state', async () => {
    const state = makeCheckpointData();
    const original = structuredClone(state);
    const exported = structuredClone(state);
    exported.sheet_0.content[1][1] = '运行时未提交值';
    const loadedRuntime = {
      loaded: true,
      engine: { dispose: () => undefined },
      syncBridge: {
        exportToTableData: () => exported,
        loadFromTableData: () => undefined,
      },
    };

    await expect(applyTableOperationV2_ACU(state, {
      kind: 'meta_update', sheetKey: 'sheet_0',
      meta: { sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, unsafe TEXT);' } },
    } as any, loadedRuntime as any)).rejects.toThrow('迁移为 sheet_schema_migrate 或 sheet_replace');

    expect(state).toEqual(original);
    expect(loadedRuntime.loaded).toBe(true);
  });

  it('不含 DDL 的 meta_update 继续合并非结构 sourceData', async () => {
    const state = makeCheckpointData();

    await applyTableOperationV2_ACU(state, {
      kind: 'meta_update', sheetKey: 'sheet_0', meta: { sourceData: { provider: 'legacy' } },
    } as any);

    expect(state.sheet_0.sourceData).toEqual({
      ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);',
      provider: 'legacy',
    });
  });

  it('同一 frame 按 introduction 后 migration 再 meta_update 的顺序恢复最终持久化状态', async () => {
    const checkpointData = makeCheckpointData();
    const before = checkpointData.sheet_0;
    const migrated = {
      ...before,
      content: [['row_id', 'name', 'marker'], ['1', '铁剑', null]],
      sourceData: { ...before.sourceData, ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, marker TEXT);' },
    };
    const migration = await buildSheetSchemaMigrationOperation_ACU('sheet_0', before, migrated);
    const introducedSheet = {
      uid: 'introduced', name: '新增表', orderNo: 2,
      content: [['row_id', 'value']],
      sourceData: { ddl: 'CREATE TABLE introduced (row_id INTEGER PRIMARY KEY, value TEXT);' },
      updateConfig: {}, exportConfig: {},
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            perSheetCheckpoints: {
              sheet_new: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_new', data: introducedSheet,
                timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 7 },
              },
            },
            logEntries: [{
              seq: 8, entryId: 'template-migration-meta', createdAt: 3, source: 'template_assistant', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [
                migration,
                {
                  kind: 'meta_update', sheetKey: 'sheet_0',
                  meta: {
                    name: '新背包', orderNo: 4,
                    sourceData: { provider: 'template' },
                    updateConfig: { mode: 'manual' },
                    exportConfig: { enabled: true },
                  },
                },
              ],
            }],
          },
        },
      },
    }];

    const replayed = await loadTableStateFromFramesV2_ACU(chat, '', { updateRuntimeState: false });

    expect(replayed?.sheet_new).toEqual(introducedSheet);
    expect(replayed?.sheet_0).toEqual({
      ...migrated,
      name: '新背包', orderNo: 4,
      sourceData: { ...migrated.sourceData, provider: 'template' },
      updateConfig: { mode: 'manual' },
      exportConfig: { enabled: true },
    });
    expect(replayed?.sheet_0.content[1][2]).toBeNull();
  });

  it('未知或畸形 operation 严格路径拒绝，读取降级链按 spv7.9 语义跳过并保留已知历史', async () => {
    const previousIndependentStates = independentTableStates_ACU;
    _set_independentTableStates_ACU({});
    const checkpointData = makeCheckpointData();
    const makeChat = (operation: any) => [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,

          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1, entryId: 'invalid-operation', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [], operations: [operation],
            }],
          },
        },
      },
    }];

    try {
      // 读取降级链（Tier-1）按 spv7.9 语义跳过未知/畸形 operation，checkpoint 历史照常可读。
      for (const operation of [{ kind: 'future_unknown_operation' }, null, {}]) {
        const result = await loadTableStateFromFramesV2_ACU(makeChat(operation), '');
        expect(result?.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
      }
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('跳过未知 operation kind: future_unknown_operation'));
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('跳过缺少有效 kind 的 operation'));
      // 原始 checkpoint 对象不被回放修改。
      expect(checkpointData.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
    } finally {
      _set_independentTableStates_ACU(previousIndependentStates);
    }
  });


  it('V1: 唯一历史英文 SQL 跨改名回放，映射到改名后的当前物理名', async () => {
    // 显示名决定当前物理名（背包物品表 -> beibaowupinbiao），DDL 英文名 inventory 仍唯一，
    // 历史 SQL 用英文名 inventory 写入，replay 必须把它重绑到改名后的当前物理名。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory_uid', name: '背包物品表',
        content: [['row_id', 'name'], ['1', '铁剑']],
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data, event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] } },
            logEntries: [{
              seq: 1, entryId: 'v1-english-replay', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{ kind: 'sql_batch', statements: ["UPDATE inventory SET name = '改名后写入' WHERE row_id = 1"] }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result?.sheet_0.content).toEqual([['row_id', 'name'], ['1', '改名后写入']]);
  });

  it('V2: 当前拼音物理名 SQL 回放定位到正确 sheet，不因英文名冲突污染', async () => {
    // 两个 sheet 共用英文名 shared_legacy（冲突），但物理名各自唯一（甲表->jiabiao，乙表->yibiao）。
    // 历史 SQL 用物理名 jiabiao 写入，必须只落到 sheet_0，不得被英文名冲突污染或误路由。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'jiabiao_uid', name: '甲表',
        content: [['row_id', 'note'], ['1', '甲']],
        sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY, note TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
      sheet_1: {
        uid: 'yibiao_uid', name: '乙表',
        content: [['row_id', 'note'], ['1', '乙']],
        sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY, note TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data, event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] } },
            logEntries: [{
              seq: 1, entryId: 'v2-physical-replay', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              // 物理名 jiabiao 必须正确定位到 sheet_0，即使 shared_legacy 冲突也不受影响。
              operations: [{ kind: 'sql_batch', statements: ["UPDATE jiabiao SET note = '甲更新' WHERE row_id = 1"] }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result?.sheet_0.content).toEqual([['row_id', 'note'], ['1', '甲更新']]);
    expect(result?.sheet_1.content).toEqual([['row_id', 'note'], ['1', '乙']]);
  });

  it('V3: 带稳定 sheetKey 的 sql_sheet_batch 可跨改名回放', async () => {
    // sql_sheet_batch 带 sheetKey=sheet_0 与历史 tableName=obsolete_legacy；
    // 当前物理名由显示名决定（背包物品表 -> beibaowupinbiao），与历史物理名不同，
    // 但稳定 sheetKey 必须保证这条历史增量正确落到 sheet_0。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory_uid', name: '背包物品表',
        content: [['row_id', 'name'], ['1', '铁剑']],
        sourceData: { ddl: 'CREATE TABLE obsolete_legacy (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data, event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] } },
            logEntries: [{
              seq: 1, entryId: 'v3-sheetkey-replay', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'obsolete_legacy', reason: 'system',
                statements: ["UPDATE obsolete_legacy SET name = '跨改名写入' WHERE row_id = 1"],
              }],
            }],
          },
        },
      },
    }];

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result?.sheet_0.content).toEqual([['row_id', 'name'], ['1', '跨改名写入']]);
  });

});

describe('SPv7.9 duplicate row_id transition checkpoint', () => {
  it('重编号保留行序和业务值，并让 seedRows 接续 content 身份空间', () => {
    const source = makeCheckpointData();
    source.sheet_0.content = [
      ['row_id', 'name'],
      [' 7 ', '旧剑'],
      ['7', '重复剑'],
    ];
    source.sheet_0.seedRows = [['7', '种子药水'], ['8', '种子绷带']];

    const result = reindexSpv79TransitionState_ACU(source);

    expect(result.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '旧剑'],
      ['2', '重复剑'],
    ]);
    expect(result.sheet_0.seedRows).toEqual([['3', '种子药水'], ['4', '种子绷带']]);
    expect(source.sheet_0.content[1][0]).toBe(' 7 ');
  });

  it('私有过渡根硬截断旧 full、同帧旧 operation 和 patch，仅回放 cutoff 后增量', async () => {
    const transitionData = makeCheckpointData();
    transitionData.sheet_0.content = [['row_id', 'name'], ['1', '过渡快照']];
    const oldData = makeCheckpointData();
    oldData.sheet_0.content = [['row_id', 'name'], ['99', '不应复活']];
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            spv79TransitionCheckpoint: {
              version: 1,
              kind: 'spv79_duplicate_row_id_transition',
              createdAt: 1,
              data: transitionData,
              cutoff: { messageIndex: 0, seq: 1, operationIndex: 0 },
              scheduleSummary: { sheet_0: { lastChangedAiFloor: 1 } },
            },
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: oldData },
              perSheetCheckpoints: {
                sheet_old: {
                  kind: 'sheet_full', createdAt: 1, reason: 'schema_change', sheetKey: 'sheet_old',
                  data: { ...makeCheckpointData().sheet_0, uid: 'old', name: '旧表' },
                },
              },
              logEntries: [{
                seq: 1, entryId: 'transition-cutoff', createdAt: 1, source: 'system', targetMessageIndex: 0, aiFloor: 1,
                filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
                operations: [
                  { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: oldData.sheet_0, reason: 'system' },
                  { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '同 seq 后增量'] },
                ],
              }, {
                seq: 2, entryId: 'old-patch', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
                filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], patches: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '3', cells: ['3', '后续 patch'] }], operations: [],
              }],
            },
          },
        },
      },
    ];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(replay?.baseKind).toBe('spv79_transition_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '过渡快照'],
      ['2', '同 seq 后增量'],
      ['3', '后续 patch'],
    ]);
    expect(replay?.data.sheet_old).toBeUndefined();
    expect(summary.sheet_0).toEqual({ lastChangedAiFloor: 1 });
  });

  it('结构损坏的私有根不会替代正常 full checkpoint 或截断其后的日志', async () => {
    const fullData = makeCheckpointData();
    fullData.sheet_0.content[1] = ['1', '正常基底'];
    const invalidTransitionData = makeCheckpointData();
    invalidTransitionData.sheet_0.content[1] = ['1', '不得采用'];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 1,
            data: invalidTransitionData,
            cutoff: { messageIndex: 1, seq: -1, operationIndex: -1 },
          },
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: fullData },
            logEntries: [{
              seq: 1, entryId: 'normal-suffix', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '正常后缀'] }],
            }],
          },
        },
      },
    }];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(replay?.baseKind).toBe('full_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '正常基底'],
      ['2', '正常后缀'],
    ]);
  });

  it.each([
    ['seq 不存在', { messageIndex: 0, seq: 0, operationIndex: 0 }, true],
    ['operationIndex 越过 operations', { messageIndex: 0, seq: 1, operationIndex: 1 }, false],
    ['非空 operations 使用根游标', { messageIndex: 0, seq: 1, operationIndex: -1 }, true],
  ])('cutoff artifact 已被历史清理（%s）时仍采用私有完整根，不回退旧 full', async (_label, cutoff, appliesSuffix) => {
    const fullData = makeCheckpointData();
    fullData.sheet_0.content[1] = ['1', '正常基底'];
    const invalidTransitionData = makeCheckpointData();
    invalidTransitionData.sheet_0.content[1] = ['1', '不得采用'];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 1,
            data: invalidTransitionData, cutoff,
          },
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: fullData },
            logEntries: [{
              seq: 1, entryId: 'normal-suffix', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '正常后缀'] }],
            }],
          },
        },
      },
    }];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(replay?.baseKind).toBe('spv79_transition_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual(appliesSuffix
      ? [['row_id', 'name'], ['1', '不得采用'], ['2', '正常后缀']]
      : [['row_id', 'name'], ['1', '不得采用']]);
  });

  it('cutoff 对应 artifact 已不存在时仍采用私有完整根，不要求旁路标签提供证明', async () => {
    const fullData = makeCheckpointData();
    fullData.sheet_0.content[1] = ['1', '当前标签基底'];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 1,
            data: makeCheckpointData(), cutoff: { messageIndex: 0, seq: 1, operationIndex: 0 },
          },
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: fullData },
            logEntries: [],
          },
        },
        other: {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1, entryId: 'other-isolation-entry', createdAt: 1, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '不属于当前标签'] }],
            }],
          },
        },
      },
    }];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(replay?.baseKind).toBe('spv79_transition_checkpoint');
    expect(replay?.data).toEqual(makeCheckpointData());
  });

  it('cutoff 消息索引晚于私有根承载楼层时仍采用 canonical 私有根，不新增位置门禁', async () => {
    const transitionData = makeCheckpointData();
    transitionData.sheet_0.content[1] = ['1', '私有根状态'];
    const fullData = makeCheckpointData();
    fullData.sheet_0.content[1] = ['1', '旧 full 状态'];
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 1,
            data: transitionData,
            cutoff: { messageIndex: 9, seq: 3, operationIndex: 0 },
            scheduleSummary: {},
          },
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: fullData },
            logEntries: [],
          },
        },
      },
    }];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(replay?.baseKind).toBe('spv79_transition_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '私有根状态'],
    ]);
  });

  it('cutoff 跨越后续楼层时统一吸收中间 full、per-sheet、timeline、schedule，仅应用真正后缀', async () => {
    const transitionData = makeCheckpointData();
    transitionData.sheet_0.content = [['row_id', 'name'], ['1', '私有根状态']];
    const absorbedFull = makeCheckpointData();
    absorbedFull.sheet_0.content = [['row_id', 'name'], ['90', '不得覆盖私有根']];
    const absorbedSheet = {
      ...makeCheckpointData().sheet_0,
      uid: 'absorbed',
      name: 'absorbed',
      content: [['row_id', 'name'], ['91', '不得复活']],
    };
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 1,
            data: transitionData,
            cutoff: { messageIndex: 1, seq: 1, operationIndex: 0 },
            scheduleSummary: { sheet_0: { lastChangedAiFloor: 1 } },
          },
          storageFrame: { version: 2, logEntries: [] },
        },
      },
    }, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 2, reason: 'manual', data: absorbedFull },
            perSheetCheckpoints: {
              sheet_0: {
                kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_0',
                data: absorbedFull.sheet_0,
                timeline: { kind: 'sheet_hide', activateAtMessageIndex: 1, afterSeq: 0 },
                scheduleSummary: { lastFilledAiFloor: 2 },
              },
              sheet_absorbed: {
                kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_absorbed',
                data: absorbedSheet,
                scheduleSummary: { lastChangedAiFloor: 2 },
              },
            },
            logEntries: [{
              seq: 1, entryId: 'absorbed-cutoff', createdAt: 2, source: 'system', targetMessageIndex: 1, aiFloor: 2,
              filledSheetKeys: ['sheet_absorbed'], changedSheetKeys: ['sheet_middle'], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '已被吸收'] }],
            }],
          },
        },
      },
    }, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1, entryId: 'real-suffix', createdAt: 3, source: 'system', targetMessageIndex: 2, aiFloor: 3,
              filledSheetKeys: [], changedSheetKeys: ['sheet_suffix'], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '真正后缀'] }],
            }],
          },
        },
      },
    }];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');
    const lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, '');

    expect(replay?.baseKind).toBe('spv79_transition_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '私有根状态'],
      ['2', '真正后缀'],
    ]);
    expect(replay?.data.sheet_absorbed).toBeUndefined();
    expect(summary).toEqual({
      sheet_0: { lastChangedAiFloor: 1 },
      sheet_suffix: { lastChangedAiFloor: 3 },
    });
    expect(lifecycle.activeSheetKeys).toEqual(['sheet_0']);
    expect(lifecycle.hiddenSheetKeys).toEqual([]);
    expect(lifecycle.statusBySheetKey.sheet_absorbed).toBeUndefined();
  });

  it('cutoff 后的普通 full 在 replay、schedule、lifecycle 三路径共同取代旧私有根', async () => {
    const transitionData = makeCheckpointData();
    transitionData.sheet_0.content = [['row_id', 'name'], ['1', '旧私有根']];
    const newerFullData = makeCheckpointData();
    newerFullData.sheet_0.content = [['row_id', 'name'], ['1', '新 full 基底']];
    const newerSheet = {
      ...makeCheckpointData().sheet_0,
      uid: 'newer',
      name: 'newer',
      content: [['row_id', 'name'], ['1', '新 full 表']],
    };
    newerFullData.sheet_newer = newerSheet;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 1,
            data: transitionData,
            cutoff: { messageIndex: 0, seq: 1, operationIndex: 0 },
            scheduleSummary: { sheet_0: { lastChangedAiFloor: 1 } },
          },
          storageFrame: { version: 2, logEntries: [] },
        },
      },
    }, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 2, reason: 'compaction', data: newerFullData,
              scheduleSummary: { sheet_newer: { lastFilledAiFloor: 2 } },
              event: { filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [] },
            },
            logEntries: [],
          },
        },
      },
    }, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1, entryId: 'after-new-full', createdAt: 3, source: 'system', targetMessageIndex: 2, aiFloor: 3,
              filledSheetKeys: [], changedSheetKeys: ['sheet_suffix'], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '新 full 后缀'] }],
            }],
          },
        },
      },
    }];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');
    const lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, '');

    expect(replay?.baseKind).toBe('full_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '新 full 基底'],
      ['2', '新 full 后缀'],
    ]);
    expect(replay?.data.sheet_newer.content).toEqual(newerSheet.content);
    expect(summary).toEqual({
      sheet_newer: { lastFilledAiFloor: 2 },
      sheet_0: { lastChangedAiFloor: 2 },
      sheet_suffix: { lastChangedAiFloor: 3 },
    });
    expect(lifecycle.activeSheetKeys).toEqual(['sheet_0', 'sheet_newer']);
    expect(lifecycle.hiddenSheetKeys).toEqual([]);
  });

  it('schedule summary 忽略过渡承载帧 cutoff 前 artifact，但累计 cutoff 后日志事件', () => {
    const data = makeCheckpointData();
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 1,
            data,
            cutoff: { messageIndex: 0, seq: 1, operationIndex: 0 },
            scheduleSummary: { sheet_transition: { lastFilledAiFloor: 1 } },
          },
          storageFrame: {
            version: 2,
            perSheetCheckpoints: {
              sheet_pre_cutoff: {
                kind: 'sheet_full', createdAt: 1, reason: 'manual', sheetKey: 'sheet_pre_cutoff',
                data: makeCheckpointData().sheet_0,
                scheduleSummary: { lastChangedAiFloor: 1 },
              },
            },
            logEntries: [{
              seq: 1, entryId: 'cutoff-entry', createdAt: 1, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_after_cutoff'], changedSheetKeys: [], groupKeys: [],
              operations: [
                { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '已吸收'] },
                { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '后缀'] },
              ],
            }, {
              seq: 2, entryId: 'later-entry', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: ['sheet_later'], groupKeys: [], operations: [],
            }],
          },
        },
      },
    }];

    const summary = collectScheduleSummaryFromFramesV2_ACU(chat, '');

    expect(summary).toEqual({
      sheet_transition: { lastFilledAiFloor: 1 },
      sheet_later: { lastChangedAiFloor: 1 },
    });
  });

  it('宿主真实加载遇到 duplicate_row_id 后接 SQL 时首次即返回兼容结果，异步固化通用过渡根且不改写原 storageFrame', async () => {
    const checkpointData = makeCheckpointData();
    checkpointData.sheet_0.content = [['row_id', 'name'], ['1', '原始行']];
    const duplicateSheet = structuredClone(checkpointData.sheet_0);
    duplicateSheet.content.push([' 1 ', '重复行']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1, entryId: 'legacy-duplicate-replace', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [
                { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: duplicateSheet, reason: 'system' },
                { kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system', statements: ["UPDATE inventory SET name = 'SQL 后缀' WHERE row_id = 1"] },
              ],
            }],
          },
        },
      },
    }];
    const storageFrameBefore = structuredClone(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame);
    const saveChat = vi.fn(async () => undefined);
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat } as any);

      const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

      // 首次加载即返回兼容结果（重编号后与将来固化根一致），固化异步进行。
      expect(replay?.baseKind).toBe('compat_tolerant_replay');
      expect(replay?.data.sheet_0.content).toEqual([
        ['row_id', 'name'],
        ['1', 'SQL 后缀'],
        ['2', 'SQL 后缀'],
      ]);

      await flushPendingCompatTransitionFixations_ACU();
      expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(storageFrameBefore);
      expect(chat[0].TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
      expect(chat[0].TavernDB_ACU_IsolatedData[''].compatTransitionCheckpoint).toEqual(expect.objectContaining({
        kind: 'compat_replay_transition',
        cutoff: { messageIndex: 0, seq: 1, operationIndex: 1 },
        tolerances: expect.arrayContaining(['legacy_duplicate_row_ids']),
      }));
      expect(saveChat).toHaveBeenCalledTimes(1);

      // 固化后二次加载走过渡根严格快路径，数据与首次返回完全一致。
      const second = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
      expect(second?.baseKind).toBe('compat_transition_checkpoint');
      expect(second?.data.sheet_0.content).toEqual(replay?.data.sheet_0.content);
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });

  it('旧重复行 SQL 回放保留 SQL INSERT/DELETE/params 语义，固化后通用过渡根 cutoff 覆盖全部 operation', async () => {
    const checkpointData = makeCheckpointData();
    const duplicateSheet = structuredClone(checkpointData.sheet_0);
    duplicateSheet.content.push(['1', '重复行']);
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1, entryId: 'legacy-duplicate-sql-lifecycle', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [
                { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: duplicateSheet, reason: 'system' },
                { kind: 'sql_sheet_batch', sheetKey: 'sheet_0', tableName: 'inventory', reason: 'system', statements: ['UPDATE inventory SET name = ? WHERE row_id = ?'], params: [['SQL 更新', 1]] },
                { kind: 'sql_batch', statements: ['INSERT INTO inventory (row_id, name) VALUES (?, ?)'], params: [[2, 'SQL 新行']] },
                { kind: 'sql_batch', statements: ['DELETE FROM inventory WHERE row_id = ?'], params: [[1]] },
                { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '非 SQL 后缀'], reason: 'system' },
              ],
            }],
          },
        },
      },
    }];
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn(async () => undefined) } as any);

      const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

      expect(replay?.baseKind).toBe('compat_tolerant_replay');
      expect(replay?.data.sheet_0.content).toEqual([
        ['row_id', 'name'],
        ['1', '非 SQL 后缀'],
      ]);

      await flushPendingCompatTransitionFixations_ACU();
      expect(chat[0].TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
      expect(chat[0].TavernDB_ACU_IsolatedData[''].compatTransitionCheckpoint?.cutoff).toEqual({
        messageIndex: 0, seq: 1, operationIndex: 4,
      });
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });
});

describe('deriveSheetLifecycleFromFramesV2_ACU', () => {
  const ISOLATION = '';

  function makeFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 2,
      logEntries: [],
      ...overrides,
    };
  }

  function makeChat(messages: Array<Record<string, unknown>>): any[] {
    return messages.map(message => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        [ISOLATION]: {
          _acu_storage_version: 2,
          storageFrame: makeFrame(message.frame as Record<string, unknown>),
        },
      },
    }));
  }

  function makeSheet(key: string, rows: unknown[][]): any {
    return {
      uid: key.replace('sheet_', ''),
      name: key,
      content: [['row_id', 'value'], ...rows],
      sourceData: { ddl: `CREATE TABLE ${key.replace('sheet_', '')} (row_id INTEGER PRIMARY KEY, value TEXT);` },
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    };
  }

  it('active：仅含全量 checkpoint 时派生为 active', () => {
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: makeSheet('sheet_a', [['1', 'x']]) } },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.activeSheetKeys).toEqual(['sheet_a']);
    expect(projection.hiddenSheetKeys).toEqual([]);
    expect(projection.indeterminateSheetKeys).toEqual([]);
    expect(projection.statusBySheetKey.sheet_a.status).toBe('active');
  });

  it('hidden：hide timeline 后目标从 active 移入 hidden', () => {
    const sheet = makeSheet('sheet_a', [['1', '离开数据']]);
    const chat = makeChat([{
      frame: {
        perSheetCheckpoints: {
          sheet_a: {
            kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
            timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
          },
        },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.hiddenSheetKeys).toEqual(['sheet_a']);
    expect(projection.activeSheetKeys).toEqual([]);
    expect(projection.statusBySheetKey.sheet_a.status).toBe('hidden');
    expect(projection.statusBySheetKey.sheet_a.restoreSourceData?.content).toEqual(sheet.content);
  });

  it('hidden 休眠溯源（S3-4）：hide checkpoint 的 createdAt 与 hideSourcePresetName 附带进 lifecycle 条目', () => {
    const sheet = makeSheet('sheet_a', [['1', '离开数据']]);
    const chat = makeChat([{
      frame: {
        perSheetCheckpoints: {
          sheet_a: {
            kind: 'sheet_full', createdAt: 1717000000000, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
            hideSourcePresetName: '旧预设',
            timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
          },
        },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.statusBySheetKey.sheet_a.lastTimelineCreatedAt).toBe(1717000000000);
    expect(projection.statusBySheetKey.sheet_a.hideSourcePresetName).toBe('旧预设');
  });

  it('hidden 休眠溯源（S3-4）：历史 hide checkpoint 无 hideSourcePresetName 时字段不填充', () => {
    const sheet = makeSheet('sheet_a', [['1', '离开数据']]);
    const chat = makeChat([{
      frame: {
        perSheetCheckpoints: {
          sheet_a: {
            kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
            timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
          },
        },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.statusBySheetKey.sheet_a.lastTimelineCreatedAt).toBe(2);
    expect(projection.statusBySheetKey.sheet_a.hideSourcePresetName).toBeUndefined();
  });

  it('hide 后 reveal：按 afterSeq 归并，最后状态为 active（恢复离开数据）', () => {
    const sheet = makeSheet('sheet_a', [['1', '离开数据']]);
    const chat = makeChat([{
      frame: {
        perSheetCheckpoints: {
          sheet_a: {
            kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
            timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
          },
        },
      },
    }, {
      frame: {
        perSheetCheckpoints: {
          sheet_a: {
            kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
            timeline: { kind: 'sheet_reveal', activateAtMessageIndex: 1, afterSeq: 0 },
          },
        },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.activeSheetKeys).toEqual(['sheet_a']);
    expect(projection.hiddenSheetKeys).toEqual([]);
    expect(projection.statusBySheetKey.sheet_a.lastTimelineKind).toBe('sheet_reveal');
  });

  it('never_seen：无任何 checkpoint/log 时为空集合（不派生未知表）', () => {
    const projection = deriveSheetLifecycleFromFramesV2_ACU([], ISOLATION);
    expect(projection.activeSheetKeys).toEqual([]);
    expect(projection.hiddenSheetKeys).toEqual([]);
    expect(projection.neverSeenSheetKeys).toEqual([]);
  });

  it('indeterminate：timeline 缺 afterSeq 时 fail-closed 标 indeterminate', () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        perSheetCheckpoints: {
          sheet_a: {
            kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
            timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0 },
          },
        },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.indeterminateSheetKeys).toEqual(['sheet_a']);
    expect(projection.statusBySheetKey.sheet_a.status).toBe('indeterminate');
  });

  it('legacy 无 timeline checkpoint：与 replay 一致视为 active（帧开头写回）', () => {
    const sheet = makeSheet('sheet_legacy', [['1', '旧数据']]);
    const chat = makeChat([{
      frame: {
        perSheetCheckpoints: {
          sheet_legacy: {
            kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_legacy', data: sheet,
          },
        },
      },
    }]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.activeSheetKeys).toEqual(['sheet_legacy']);
    expect(projection.statusBySheetKey.sheet_legacy.lastTimelineKind).toBe('sheet_introduction');
  });

  it('maxMessageIndex 截断：只统计该楼层之前的 frame', () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([
      { frame: { perSheetCheckpoints: { sheet_a: { kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet, timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 0 } } } } },
      { frame: { perSheetCheckpoints: { sheet_a: { kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet, timeline: { kind: 'sheet_hide', activateAtMessageIndex: 1, afterSeq: 0 } } } } },
    ]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION, { maxMessageIndex: 0 });
    expect(projection.activeSheetKeys).toEqual(['sheet_a']);
    expect(projection.hiddenSheetKeys).toEqual([]);
  });

  it('full checkpoint 起算点：更早帧留下的 active 痕迹被该快照清扫（与 replay 基线一致）', () => {
    // replay 以最后一个 full checkpoint 为基底，帧 0 的 per-sheet checkpoint 根本不参与回放。
    // lifecycle 若仍累积它，会产出「active 但基线不含该表」的自相矛盾结论。
    const stale = makeSheet('sheet_stale', [['1', '旧模板数据']]);
    const kept = makeSheet('sheet_kept', [['1', 'x']]);
    const chat = makeChat([
      {
        frame: {
          perSheetCheckpoints: {
            sheet_stale: {
              kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_stale', data: stale,
              timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 0 },
            },
          },
        },
      },
      {
        frame: {
          checkpoint: { kind: 'full', createdAt: 5, reason: 'schema_change', data: { sheet_kept: kept } },
        },
      },
    ]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.activeSheetKeys).toEqual(['sheet_kept']);
    expect(projection.statusBySheetKey.sheet_stale).toBeUndefined();
    expect(projection.hiddenSheetKeys).toEqual([]);
    expect(projection.indeterminateSheetKeys).toEqual([]);
  });

  it('full checkpoint 起算点：基底之前的 legacy untimed checkpoint 同样不再产出 active', () => {
    const legacy = makeSheet('sheet_legacy', [['1', '旧数据']]);
    const kept = makeSheet('sheet_kept', [['1', 'x']]);
    const chat = makeChat([
      {
        frame: {
          perSheetCheckpoints: {
            sheet_legacy: { kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_legacy', data: legacy },
          },
        },
      },
      {
        frame: {
          checkpoint: { kind: 'full', createdAt: 5, reason: 'schema_change', data: { sheet_kept: kept } },
        },
      },
    ]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.activeSheetKeys).toEqual(['sheet_kept']);
    expect(projection.statusBySheetKey.sheet_legacy).toBeUndefined();
  });

  it('full checkpoint 起算点：基底之前的 hide 证据必须保留（compaction 迁移隐藏表依赖）', () => {
    // hide 的表按设计不出现在 full checkpoint.data 中，其数据唯一存放处是 hide checkpoint。
    // 起算点清扫不得把这份 restoreSourceData 一起丢弃，否则边界 checkpoint 写入会失败。
    const hidden = makeSheet('sheet_hidden', [['1', '离开数据']]);
    const kept = makeSheet('sheet_kept', [['1', 'x']]);
    const chat = makeChat([
      {
        frame: {
          perSheetCheckpoints: {
            sheet_hidden: {
              kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_hidden', data: hidden,
              timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
            },
          },
        },
      },
      {
        frame: {
          checkpoint: { kind: 'full', createdAt: 5, reason: 'schema_change', data: { sheet_kept: kept } },
        },
      },
    ]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.activeSheetKeys).toEqual(['sheet_kept']);
    expect(projection.hiddenSheetKeys).toEqual(['sheet_hidden']);
    expect(projection.statusBySheetKey.sheet_hidden.restoreSourceData?.content).toEqual(hidden.content);
    // 休眠溯源（S3-4）：基底前回收的 hide 证据同样附带 createdAt。
    expect(projection.statusBySheetKey.sheet_hidden.lastTimelineCreatedAt).toBe(2);
  });

  it('full checkpoint 起算点：基底之前的 hide 证据附带 hideSourcePresetName（S3-4）', () => {
    const hidden = makeSheet('sheet_hidden', [['1', '离开数据']]);
    const kept = makeSheet('sheet_kept', [['1', 'x']]);
    const chat = makeChat([
      {
        frame: {
          perSheetCheckpoints: {
            sheet_hidden: {
              kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_hidden', data: hidden,
              hideSourcePresetName: '基底前预设',
              timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
            },
          },
        },
      },
      {
        frame: {
          checkpoint: { kind: 'full', createdAt: 5, reason: 'schema_change', data: { sheet_kept: kept } },
        },
      },
    ]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    expect(projection.hiddenSheetKeys).toEqual(['sheet_hidden']);
    expect(projection.statusBySheetKey.sheet_hidden.hideSourcePresetName).toBe('基底前预设');
  });

  it('阶段 A 观测：sql_sheet_batch 回放上报纯数值 replay metrics', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1,
              entryId: 'metrics-sql-sheet-batch',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: ['sheet_0'],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_0',
                tableName: 'inventory',
                statements: ['INSERT INTO inventory (name) VALUES (?)'],
                params: [['钢剑']],
                reason: 'system',
              }],
            }],
          },
        },
      },
    }];

    const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(detailed?.metrics).toEqual({
      frameCount: 1,
      logEntryCount: 1,
      operationCount: 1,
      sqlOperationCount: 1,
      columnRebindCount: 0,
      tableAliasBuildCount: 1,
      columnAliasBuildCount: 1,
      aliasInvalidateCount: 0,
      // 单条 sql operation：表/列 registry 均为冷构建，无命中。
      aliasCacheHitCount: 0,
      sqliteHydrateCount: 1,
      sqliteMaterializeCount: 1,
      // 未传 evidence：既不命中复用，也不计入失配。
      replayReuseCount: 0,
      replayReuseFallbackCount: 0,
      // 未并发：in-flight 去重未命中。
      replayShareCount: 0,
      // 未传 yieldBudgetMs：不让出事件循环。
      yieldCount: 0,
    });
  });

  it('阶段 A 观测：JS-native 路径（row_upsert）不触发 SQLite runtime 计数', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1,
              entryId: 'metrics-row-upsert',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '钢剑'] }],
            }],
          },
        },
      },
    }];

    const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(detailed?.metrics).toEqual({
      frameCount: 1,
      logEntryCount: 1,
      operationCount: 1,
      sqlOperationCount: 0,
      columnRebindCount: 0,
      tableAliasBuildCount: 0,
      columnAliasBuildCount: 0,
      aliasInvalidateCount: 0,
      aliasCacheHitCount: 0,
      sqliteHydrateCount: 0,
      sqliteMaterializeCount: 0,
      replayReuseCount: 0,
      replayReuseFallbackCount: 0,
      // 未并发：in-flight 去重未命中。
      replayShareCount: 0,
      // 未传 yieldBudgetMs：不让出事件循环。
      yieldCount: 0,
    });
  });


  it('阶段 A 基线：17 表/62 帧/约 660 operation 长历史下 alias registry 近似逐 operation 构建', async () => {
    const { chat, totalSqlOperations, frameCount, totalOperations } = buildLongHistoryFixture_ACU();

    // 阶段 B2：alias context 默认开启；冷基线必须显式关闭，保持逐 operation 构建语义。
    const detailed = await loadTableStateFromFramesV2Detailed_ACU(chat, '',
      { updateRuntimeState: false, enableAliasContext: false });

    expect(detailed).not.toBeNull();
    expect(detailed?.metrics).toBeDefined();
    const m = detailed!.metrics!;
    expect(m.frameCount).toBe(frameCount);
    expect(m.operationCount).toBe(totalOperations);
    expect(m.sqlOperationCount).toBe(totalSqlOperations);

    // 基线裁决：当前实现每个 sql_sheet_batch 都重建表/列 alias registry，
    // 因此 tableAliasBuildCount / columnAliasBuildCount 约等于 sql operation 数，
    // 而非每个 state epoch 一次。该断言是阶段 B 的对照基线。
    expect(m.tableAliasBuildCount).toBeGreaterThanOrEqual(totalSqlOperations);
    expect(m.columnAliasBuildCount).toBe(totalSqlOperations);
    // 每帧末尾 data_replace 触发结构失效：aliasInvalidateCount 应等于非首帧数。
    expect(m.aliasInvalidateCount).toBe(frameCount - 1);
    // 连续 SQL 段跨 data_replace 时 runtime 反复 hydrate/materialize：
    // 每帧 row_upsert 与 data_replace 之间各 materialize 一次（2 次/帧，非首帧）。
    expect(m.sqliteHydrateCount).toBeGreaterThanOrEqual(frameCount - 1);
    expect(m.sqliteMaterializeCount).toBe((frameCount - 1) * 2);
  });

  it('阶段 A 基线：长历史回放结果确定性（两次回放 canonical 数据一致）', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    const first = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
    const second = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(first?.data).toEqual(second?.data);
  });



  it('阶段 B：enableAliasContext 后 alias registry 从逐 operation 构建降至每 state epoch 一次', async () => {
    const { chat, totalSqlOperations, frameCount } = buildLongHistoryFixture_ACU();

    const cold = await loadTableStateFromFramesV2Detailed_ACU(chat, '',
      { updateRuntimeState: false, enableAliasContext: false });
    const warm = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
    });

    expect(cold?.data).toEqual(warm?.data);
    const coldM = cold!.metrics!;
    const warmM = warm!.metrics!;

    // 基线：每个 sql_sheet_batch 都重建表/列 registry（≥ sql operation 数）。
    expect(coldM.tableAliasBuildCount).toBeGreaterThanOrEqual(totalSqlOperations);
    expect(coldM.columnAliasBuildCount).toBe(totalSqlOperations);

    // 优化（阶段 B）：每帧仅第一个 sql_sheet_batch 冷构建（其后 DML 命中缓存），
    // data_replace 使 epoch 递增一次 → 表 registry 构建次数 = 非首帧数。
    expect(warmM.tableAliasBuildCount).toBe(frameCount - 1);
    // 优化（阶段 D）：列 registry 按 physicalName 惰性构建，每 epoch 只构建
    // 被 sql_sheet_batch 命中的表。fixture 每帧 8 张不同表各一条 sql_sheet_batch
    // （17 表中 8 张被命中，epoch 每帧失效一次），因此列构建次数 = 总 SQL operation 数。
    expect(warmM.columnAliasBuildCount).toBe(totalSqlOperations);
    // 结构事件计数语义不变（flag 开/关均由失效点计数一次）。
    expect(warmM.aliasInvalidateCount).toBe(frameCount - 1);
    // SQL 执行次数不受缓存影响，语义等价。
    expect(warmM.sqlOperationCount).toBe(coldM.sqlOperationCount);
    expect(warmM.sqliteHydrateCount).toBe(coldM.sqliteHydrateCount);
    expect(warmM.sqliteMaterializeCount).toBe(coldM.sqliteMaterializeCount);
  });

  it('阶段 B：结构 SQL 强制冷构建（不读不写缓存），同 epoch 后续 DML 仍命中', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([
      {
        frame: {
          version: 2,
          checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
          logEntries: [],
        },
      },
      {
        frame: {
          version: 2,
          logEntries: [{
            seq: 2,
            entryId: 'e2',
            createdAt: 2,
            source: 'auto_fill',
            targetMessageIndex: 1,
            aiFloor: 1,
            filledSheetKeys: [],
            changedSheetKeys: [],
            groupKeys: [],
            operations: [
              {
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_a',
                tableName: 'a',
                statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'],
                params: [[2, 'y']],
                reason: 'system',
              },
              {
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_a',
                tableName: 'a',
                // 结构 SQL（ALTER）不经过表名重绑（mutationTarget 仅识别 DML），
                // 必须使用当前物理表名直写；DML 的别名重绑不受影响（见下两条）。
                statements: ['ALTER TABLE sheeta ADD COLUMN extra TEXT'],
                params: [],
                reason: 'system',
              },
              {
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_a',
                tableName: 'a',
                statements: ['INSERT INTO a (row_id, value) VALUES (?, ?)'],
                params: [[3, 'z']],
                reason: 'system',
              },
            ],
          }],
        },
      },
    ]);

    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      enableAliasContext: true,
    });
    expect(result).not.toBeNull();
    const m = result!.metrics!;
    // DML#1 冷构建（epoch 0）→ CREATE 强制冷构建 → DML#2 命中 epoch 0 缓存：共 2 次。
    expect(m.tableAliasBuildCount).toBe(2);
    expect(m.columnAliasBuildCount).toBe(2);
    expect(m.sqlOperationCount).toBe(3);
    // 结构 SQL 是真实 SQLite 执行、JS state 不随之同步（计划第 6 条已知边界），
    // 本测试只断言构建次数与计数路径，不把 JS state 当 canonical。
  });

  it('阶段 E：同 chat 同 boundary 的重复 replay 复用 evidence，且返回深克隆（不共享引用）', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [{
          seq: 1, entryId: 'e1', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
          filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [],
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', 'y'] }],
        }],
      },
    }]);

    // 首次冷 replay 写入 evidence。
    const evidence = {
      data: null as any, chatIdentity: null as any, isolationKey: '', maxMessageIndex: undefined,
      baseKind: 'full_checkpoint' as const, compatibilityRepairs: null as any, requiresCheckpointConvergence: false, headRevisionDigest: '', createdAt: 0,
      structureMappingDigest: '', replayOptionsFingerprint: 'tpl|0|compat|default|alias|1',
    };
    const first = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(first?.data.sheet_a.content).toEqual([['row_id', 'value'], ['1', 'x'], ['2', 'y']]);
    expect(evidence.chatIdentity).toBe(chat);
    expect(evidence.baseKind).toBe('full_checkpoint');
    // 首次传入的是空 evidence（chatIdentity 未绑定）→ 判定失配、走冷回放并计入 fallback。
    expect(first?.metrics?.replayReuseCount).toBe(0);
    expect(first?.metrics?.replayReuseFallbackCount).toBe(1);

    // 第二次同 chat 同 boundary 调用命中复用：内容一致且返回深克隆。
    const second = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(second?.data.sheet_a.content).toEqual(first?.data.sheet_a.content);
    expect(second?.data).not.toBe(first?.data);
    expect(second?.data.sheet_a).not.toBe(first?.data.sheet_a);
    // 命中复用：整轮冷回放被跳过，reuse 计数为 1 且 frame/operation 均未再扫描。
    expect(second?.metrics?.replayReuseCount).toBe(1);
    expect(second?.metrics?.replayReuseFallbackCount).toBe(0);
    expect(second?.metrics?.frameCount).toBe(0);
    // 性能采样：复用路径跳过整轮 SQLite 回放，hydrate 次数必须为 0。
    expect(second?.metrics?.sqliteHydrateCount).toBe(0);
  });

  it('阶段 G：同 fixture 冷回放与 evidence 复用对比回放次数和 SQLite hydrate 次数（不设硬阈值）', async () => {
    const { chat } = buildLongHistoryFixture_ACU();
    const evidence = {
      data: null as any, chatIdentity: null as any, isolationKey: '', maxMessageIndex: undefined,
      baseKind: 'full_checkpoint' as const, compatibilityRepairs: null as any, requiresCheckpointConvergence: false,
      headRevisionDigest: '', structureMappingDigest: '', replayOptionsFingerprint: 'tpl|0|compat|default|alias|1', createdAt: 0,
    };

    const cold = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(cold?.metrics?.replayReuseCount).toBe(0);
    expect(cold?.metrics?.replayReuseFallbackCount).toBe(1);
    expect(cold?.metrics?.sqliteHydrateCount).toBeGreaterThan(0);

    const reused = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(reused?.metrics?.replayReuseCount).toBe(1);
    expect(reused?.metrics?.sqliteHydrateCount).toBe(0);
    expect(reused?.data).toEqual(cold?.data);
  });

  it('阶段 E：boundary 不同或 chat 引用不同时不命中，回退冷 replay', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [],
      },
    }]);
    const evidence = {
      data: { sheet_a: { name: 'stale' } } as any, chatIdentity: chat, isolationKey: ISOLATION, maxMessageIndex: undefined,
      baseKind: 'full_checkpoint' as const, compatibilityRepairs: null as any, requiresCheckpointConvergence: false, headRevisionDigest: '', createdAt: 0,
      structureMappingDigest: '', replayOptionsFingerprint: 'tpl|0|compat|default|alias|1',
    };

    // boundary 不同（evidence 未定义 vs 调用 0）→ 不命中，返回真实 replay 结果。
    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      maxMessageIndex: 0,
      replayEvidence: evidence as any,
    });
    expect(result?.data.sheet_a.name).toBe('sheet_a');
    expect(result?.data.sheet_a.name).not.toBe('stale');
    expect(result?.metrics?.replayReuseCount).toBe(0);
    expect(result?.metrics?.replayReuseFallbackCount).toBe(1);

    // chat 引用不同 → 不命中。
    const otherChat = makeChat([{
      frame: { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } }, logEntries: [] },
    }]);
    const staleEvidence = {
      ...evidence, chatIdentity: otherChat, maxMessageIndex: undefined,
    };
    const result2 = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      replayEvidence: staleEvidence as any,
    });
    expect(result2?.data.sheet_a.name).toBe('sheet_a');
    expect(result2?.metrics?.replayReuseFallbackCount).toBe(1);
  });

  it('阶段 G：chat 内容原地变化（headRevision 递增）时 evidence 失效，回退冷 replay', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [],
      },
    }]);
    const evidence = {
      data: { sheet_a: { name: 'stale' } } as any, chatIdentity: chat, isolationKey: ISOLATION, maxMessageIndex: undefined,
      baseKind: 'full_checkpoint' as const, compatibilityRepairs: null as any, requiresCheckpointConvergence: false,
      headRevisionDigest: 'rev:old', createdAt: 0,
      structureMappingDigest: '', replayOptionsFingerprint: 'tpl|0|compat|default|alias|1',
    };
    // digest 不匹配（chat 实际无 headRevision → digest 空串）→ 不命中，返回真实 replay 结果。
    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(result?.data.sheet_a.name).toBe('sheet_a');
    expect(result?.data.sheet_a.name).not.toBe('stale');
    // digest 失配必须计入 fallback：这是「快路径是否真的在拦截陈旧证据」的唯一可观测信号。
    expect(result?.metrics?.replayReuseCount).toBe(0);
    expect(result?.metrics?.replayReuseFallbackCount).toBe(1);
  });

  it('阶段 G：模板结构映射变化（template fingerprint 不同）时 evidence 失效，回退冷 replay', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const templateA = {
      mate: { type: 'acu', version: 1 },
      sheet_a: {
        uid: 'a', name: 'sheet_a',
        content: [['row_id', 'value'], ['1', 'template-a']],
        sourceData: { ddl: 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, value TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const templateB = {
      ...templateA,
      sheet_a: {
        ...templateA.sheet_a,
        content: [['row_id', 'value', 'extra'], ['1', 'template-a', 'x']],
        sourceData: { ddl: 'CREATE TABLE a (row_id INTEGER PRIMARY KEY, value TEXT, extra TEXT);' },
      },
    };
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [],
      },
    }]) as any;
    chat[0].TavernDB_ACU_ScopedConfig = {
      version: 1,
      template: {
        '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(templateA) },
      },
    };
    const evidence = {
      data: null as any, chatIdentity: null as any, isolationKey: ISOLATION, maxMessageIndex: undefined,
      baseKind: 'full_checkpoint' as const, compatibilityRepairs: null as any, requiresCheckpointConvergence: false,
      headRevisionDigest: '', structureMappingDigest: '', replayOptionsFingerprint: 'tpl|0|compat|default|alias|1', createdAt: 0,
    };
    const first = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(first?.metrics?.replayReuseFallbackCount).toBe(1);
    const fingerprintA = evidence.structureMappingDigest as string;
    expect(fingerprintA).not.toBe('');

    // 模板结构变化：fingerprint B 与 evidence 中 A 不一致 → 不命中，回退冷 replay。
    chat[0].TavernDB_ACU_ScopedConfig.template[''].templateStr = JSON.stringify(templateB);
    const second = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      replayEvidence: evidence as any,
    });
    expect(second?.data.sheet_a.name).toBe('sheet_a');
    expect(second?.metrics?.replayReuseCount).toBe(0);
    expect(second?.metrics?.replayReuseFallbackCount).toBe(1);
  });

  it('阶段 G：回放 options（compatibilityMode/enableAliasContext）变化时 evidence 失效，回退冷 replay', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [],
      },
    }]);
    const evidence = {
      data: null as any, chatIdentity: null as any, isolationKey: ISOLATION, maxMessageIndex: undefined,
      baseKind: 'full_checkpoint' as const, compatibilityRepairs: null as any, requiresCheckpointConvergence: false,
      headRevisionDigest: '', structureMappingDigest: '', replayOptionsFingerprint: '', createdAt: 0,
    };
    const first = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      enableAliasContext: false,
      replayEvidence: evidence as any,
    });
    expect(evidence.replayOptionsFingerprint).toContain('alias|0');

    // options 变化（默认 alias 开启）→ fingerprint 失配 → 回退冷 replay。
    const second = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
      replayEvidence: evidence as any,
    });
    expect(second?.data.sheet_a.name).toBe('sheet_a');
    expect(second?.metrics?.replayReuseCount).toBe(0);
    expect(second?.metrics?.replayReuseFallbackCount).toBe(1);
  });

  it('阶段 I：只读 replay 在 signal 已取消时于 frame 边界抛 V2ReplayAbortedError_ACU', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [{
          seq: 1, entryId: 'e1', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
          filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [],
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', 'y'] }],
        }],
      },
    }]);
    const controller = new AbortController();
    controller.abort();

    // 专用错误类型而非裸 Error：调用方必须能把「用户取消/切聊天」与「回放真的失败」
    // 分开，否则取消会被误记为回放故障并可能触发 V2 恢复流程。
    await expect(loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      signal: controller.signal,
    })).rejects.toBeInstanceOf(V2ReplayAbortedError_ACU);
  });

  it('阶段 I：未取消的 signal 不改变只读 replay 的正常结果', async () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const chat = makeChat([{
      frame: {
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: sheet } },
        logEntries: [{
          seq: 1, entryId: 'e1', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
          filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [],
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', 'y'] }],
        }],
      },
    }]);
    const controller = new AbortController();

    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, ISOLATION, {
      updateRuntimeState: false,
      signal: controller.signal,
    });
    expect(result?.data.sheet_a.content).toEqual([['row_id', 'value'], ['1', 'x'], ['2', 'y']]);
  });

  it('阶段 I：yieldBudgetMs 让出事件循环且结果与基线一致（yieldCount > 0）', async () => {
    // 长历史 fixture：entry 数量足以在 1ms 预算下触发多次让出。
    const { chat } = buildLongHistoryFixture_ACU();

    // 基线：不让出。
    const baseline = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      enableAliasContext: false,
    });
    // yield 预算 1ms：只要累计处理超过 1ms 就让出，长 fixture 必然触发。
    const yielded = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      enableAliasContext: false,
      yieldBudgetMs: 1,
    });

    expect(yielded?.data).toEqual(baseline?.data);
    expect(yielded?.baseKind).toBe(baseline?.baseKind);
    expect(yielded?.metrics?.yieldCount).toBeGreaterThan(0);
    // 基线不传预算：yieldCount 恒为 0（零开销，不产生额外宏任务）。
    expect(baseline?.metrics?.yieldCount).toBe(0);
  });

  it('阶段 I：updateRuntimeState:true（副作用路径）即使传 yieldBudgetMs 也不让出', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    const result = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: true,
      yieldBudgetMs: 1,
    });

    // 副作用路径禁止 yield：中途让出会引入重入窗口，改写全局 schedule state。
    expect(result?.metrics?.yieldCount).toBe(0);
  });


  it('阶段 H：同 checkpoint 根多 boundary 前向捕获，结果与分别冷 replay 完全一致', async () => {
    const { chat } = buildLongHistoryFixture_ACU();
    const boundaries = [10, 30, 50];

    // 基线：对每个 boundary 分别冷 replay（逐次冷回放，语义权威）。
    const coldByBoundary = new Map<number, any>();
    for (const boundary of boundaries) {
      const cold = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
        updateRuntimeState: false,
        maxMessageIndex: boundary,
      });
      expect(cold).not.toBeNull();
      expect(cold!.baseKind).toBe('full_checkpoint');
      coldByBoundary.set(boundary, cold!.data);
    }

    // 前向捕获：单次 replay，captureBoundaries 驱动中间快照。
    const captured = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(chat, '', boundaries, {
      updateRuntimeState: false,
    });

    expect(captured.size).toBe(boundaries.length);
    for (const boundary of boundaries) {
      const snap = captured.get(boundary);
      expect(snap).toBeDefined();
      expect(snap!.baseKind).toBe('full_checkpoint');
      expect(snap!.capturedBoundary).toBe(boundary);
      // 核心正确性：前向捕获快照与分别冷 replay 的 canonical data 完全一致。
      expect(snap!.data).toEqual(coldByBoundary.get(boundary));
    }
    // 快路径可观测性：前向捕获是「单次 SQL 扫描、多快照」——各快照 metrics
    // 是同一轮累计的递增序列，且起算根是 messageIndex 0（replayStart=0），
    // 最大 boundary 快照的 frameCount = 0..50 共 51 帧。若悄悄回退逐次冷 replay，
    // 各快照 frameCount 会等于各自 boundary 的截断值（6/31/51），此处可区分。
    const frameCounts = [...captured.values()].map(snap => snap!.metrics!.frameCount);
    expect(frameCounts[0]).toBeLessThan(frameCounts[1]);
    expect(frameCounts[1]).toBeLessThan(frameCounts[2]);
    expect(frameCounts).toEqual([11, 31, 51]);
    // key 严格递增。
    expect([...captured.keys()]).toEqual([10, 30, 50]);
  });

  it('阶段 H：跨 checkpoint 段（不同起算根）时回退逐次冷 replay，结果仍一致', async () => {
    const { chat } = buildLongHistoryFixture_ACU();
    // 在第 10 帧后插入第二个 full checkpoint：使 [0..9] 与 [10..61] 起算根不同。
    const secondCheckpointChat = [...chat];
    // 第二个 checkpoint 必须包含全部 17 张表（后续帧的 sql_sheet_batch 引用
    // tbl_11 等物理表），因此直接深拷贝初始 checkpoint 数据作为其内容。
    const secondCheckpointData = structuredClone(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    secondCheckpointChat[10] = {
      ...secondCheckpointChat[10],
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 999, reason: 'second', data: secondCheckpointData },
            logEntries: [],
          },
        },
      },
    };
    const boundaries = [5, 12, 20];

    // 分别冷 replay（基线）。
    const coldByBoundary = new Map<number, any>();
    for (const boundary of boundaries) {
      const cold = await loadTableStateFromFramesV2Detailed_ACU(secondCheckpointChat, '', {
        updateRuntimeState: false,
        maxMessageIndex: boundary,
      });
      expect(cold).not.toBeNull();
      coldByBoundary.set(boundary, cold!.data);
    }

    // 跨 checkpoint 段：allShareRoot 应为 false，走回退逐次冷 replay。
    const captured = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(secondCheckpointChat, '', boundaries, {
      updateRuntimeState: false,
    });

    expect(captured.size).toBe(boundaries.length);
    for (const boundary of boundaries) {
      const snap = captured.get(boundary);
      expect(snap).toBeDefined();
      expect(snap!.data).toEqual(coldByBoundary.get(boundary));
      expect(snap!.capturedBoundary).toBe(boundary);
    }
    // 回退路径可观测性：逐次冷 replay 时每个快照 frameCount = 该 boundary 的
    // replayStart 起算帧数。boundary=5 从根 0 起算 → 0..5 共 6 帧；boundary=12/20
    // 从第二个 checkpoint（messageIndex 10）起算 → 10..12 共 3 帧、10..20 共 11 帧。
    const frameCounts = [...captured.values()].map(snap => snap!.metrics!.frameCount);
    expect(frameCounts).toEqual([6, 3, 11]);
  });

  it('阶段 H：boundary 超出 frameRefs 范围时等价于全量上界（与原 maxMessageIndex 语义一致）', async () => {
    const { chat } = buildLongHistoryFixture_ACU();
    const boundaries = [10, 30, 9999]; // 9999 超出 frameRefs 范围。

    // maxMessageIndex 是「处理 ≤ boundary 的所有帧」的上界：chat 只有 62 条消息，
    // 9999 等价于不设上限（处理全量）。capture 对 9999 不会命中（core 只遍历实际
    // frameRefs）→ sink 缺 key → 回退逐次冷 replay。回退路径 maxMessageIndex=9999
    // 返回全量末尾态——这正是原 maxMessageIndex 语义，不是错误快照。
    const captured = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(chat, '', boundaries, {
      updateRuntimeState: false,
    });

    expect(captured.size).toBe(3);
    expect(captured.get(9999)).toBeDefined();
    // 9999 的快照 = 全量 replay（无上限），其 frameCount 应为 62（0..61 全部帧）。
    expect(captured.get(9999)!.metrics!.frameCount).toBe(62);
  });

  it('阶段 G2：并发同 key 只读 replay 共享一次全量回放（in-flight 去重）', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    // 两个并发调用，相同 chat + isolationKey + 无 maxMessageIndex（latest）。
    // 第一个启动全量 replay，第二个应共享同一 promise 而非再跑一次。
    const [first, second] = await Promise.all([
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false }),
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false }),
    ]);

    expect(first?.data).toEqual(second?.data);
    expect(first).not.toBe(second);
    // 第二个是等待方：replayShareCount=1（共享命中），且不应是 evidence 复用。
    expect(second?.metrics?.replayShareCount).toBe(1);
    expect(second?.metrics?.replayReuseCount).toBe(0);
    // 第一个是启动方：真实冷 replay，无共享标记（其 frameCount 反映全量扫描）。
    expect(first?.metrics?.replayShareCount).toBe(0);
    expect(first?.metrics?.frameCount).toBe(62);
    expect(first?.metrics?.sqliteHydrateCount).toBeGreaterThan(0);
    expect(second?.metrics?.sqliteHydrateCount).toBe(0);
  });

  it('阶段 G2：不同回放 options 的并发只读调用不共享（各自独立全量回放）', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    const [disabled, apply] = await Promise.all([
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false, compatibilityMode: 'disabled' }),
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false, compatibilityMode: 'apply' }),
    ]);

    // options 不同 → in-flight key 不同 → 不共享。
    expect(disabled?.metrics?.replayShareCount).toBe(0);
    expect(apply?.metrics?.replayShareCount).toBe(0);
    expect(disabled?.data).toEqual(apply?.data);
  });

  it('阶段 G2：不同 boundary 的并发调用不共享（各跑各的全量回放）', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    const [latest, bounded] = await Promise.all([
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false }),
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false, maxMessageIndex: 20 }),
    ]);

    // boundary 不同 → key 不同 → 各自独立 replay。
    expect(bounded?.metrics?.replayShareCount).toBe(0);
    expect(bounded?.metrics?.frameCount).toBe(21); // 0..20 共 21 帧。
    expect(latest?.metrics?.frameCount).toBe(62);
  });

  it('阶段 G2：副作用路径（updateRuntimeState:true）不参与 in-flight 去重', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    const [a, b] = await Promise.all([
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: true }),
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: true }),
    ]);

    // 副作用路径不共享：各自独立执行（不设 replayShareCount）。
    expect(a?.metrics?.replayShareCount).toBe(0);
    expect(b?.metrics?.replayShareCount).toBe(0);
  });

  it('阶段 G2：in-flight 去重只在并发窗口内生效，settle 后重新冷 replay', async () => {
    const { chat } = buildLongHistoryFixture_ACU();

    // 第一次并发：共享。
    const [first] = await Promise.all([
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false }),
      loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false }),
    ]);
    expect(first?.metrics?.replayShareCount).toBe(0);

    // settle 后再次调用：Map 已清理，重新冷 replay（不再是共享命中）。
    const after = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
    expect(after?.metrics?.replayShareCount).toBe(0);
    expect(after?.metrics?.replayReuseCount).toBe(0);
    expect(after?.data).toEqual(first?.data);
  });





  it('full checkpoint 起算点：基底之前 hide 后又 reveal 的表，可见性由基底快照裁决', () => {
    const sheet = makeSheet('sheet_a', [['1', 'x']]);
    const kept = makeSheet('sheet_kept', [['1', 'y']]);
    const chat = makeChat([
      {
        frame: {
          perSheetCheckpoints: {
            sheet_a: {
              kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
              timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
            },
          },
        },
      },
      {
        frame: {
          perSheetCheckpoints: {
            sheet_a: {
              kind: 'sheet_full', createdAt: 3, reason: 'schema_change', sheetKey: 'sheet_a', data: sheet,
              timeline: { kind: 'sheet_reveal', activateAtMessageIndex: 1, afterSeq: 0 },
            },
          },
        },
      },
      {
        frame: {
          checkpoint: { kind: 'full', createdAt: 5, reason: 'schema_change', data: { sheet_a: sheet, sheet_kept: kept } },
        },
      },
    ]);
    const projection = deriveSheetLifecycleFromFramesV2_ACU(chat, ISOLATION);
    // reveal 撤销了更早的 hidden 结论；基底 full 快照含 sheet_a → active，且不残留 hidden。
    expect(projection.activeSheetKeys).toEqual(['sheet_a', 'sheet_kept']);
    expect(projection.hiddenSheetKeys).toEqual([]);
  });

});
