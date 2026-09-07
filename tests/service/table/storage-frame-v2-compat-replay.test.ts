/**
 * tests/service/table/storage-frame-v2-compat-replay.test.ts
 *
 * 全版本兼容读取架构测试：
 * - Tier-1 宽容回放器 replayWithLegacyTolerances_ACU 的各容忍项；
 * - 两代 sheetKey 身份归并接入回放（截图场景：旧 key checkpoint + 新 key sheet_replace + sql_sheet_batch）；
 * - Detailed 层自动降级链（严格失败 → tolerant 结果可用 → 异步固化）；
 * - 固化失败（canonical 不过）时结果仍返回、不写盘；
 * - spv79 与 compat 过渡根共存优先级；
 * - bounded（maxMessageIndex）调用。
 */
import { describe, expect, it, vi } from 'vitest';

const { mockLogWarn } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logWarn_ACU: mockLogWarn };
});

import {
  flushPendingCompatTransitionFixations_ACU,
  loadTableStateFromFramesV2Detailed_ACU,
  replayWithLegacyTolerances_ACU,
} from '../../../src/service/table/storage-frame-v2-replay';
import {
  compareTransitionCutoffs_ACU,
  findLatestTransitionCheckpoint_ACU,
} from '../../../src/service/table/compat-transition-checkpoint';
import { buildStableSheetKeyCandidate_ACU } from '../../../src/shared/sheet-identity';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../../src/shared/host-api';

const NEW_KEY = buildStableSheetKeyCandidate_ACU('背包')!;

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

function makeEntry(seq: number, entryId: string, operations: unknown[]): any {
  return {
    seq,
    entryId,
    createdAt: seq + 1,
    source: 'system',
    targetMessageIndex: 0,
    aiFloor: 1,
    filledSheetKeys: [],
    changedSheetKeys: [],
    groupKeys: [],
    operations,
  };
}

function makeV2Message(frame: Record<string, unknown>, extraTagData: Record<string, unknown> = {}): any {
  return {
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        storageFrame: frame,
        ...extraTagData,
      },
    },
  };
}

describe('replayWithLegacyTolerances_ACU（Tier-1 各容忍项）', () => {
  it('logEntries 乱序 seq 按 seq 稳定排序回放并计数', async () => {
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
      logEntries: [
        makeEntry(2, 'later', [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '后写的值'] }]),
        makeEntry(1, 'earlier', [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '先写的值'] }]),
      ],
    })];

    const result = await replayWithLegacyTolerances_ACU(chat, '');

    expect(result.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '后写的值']]);
    expect(result.toleranceReport.outOfOrderSeqSorted).toBe(1);
    expect(result.cutoff).toEqual({ messageIndex: 0, seq: 2, operationIndex: 0 });
  });

  it('legacy meta_update.sourceData.ddl 按 spv7.9 语义应用并计数', async () => {
    const newDdl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, extra TEXT);';
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
      logEntries: [
        makeEntry(1, 'legacy-ddl', [{ kind: 'meta_update', sheetKey: 'sheet_0', meta: { sourceData: { ddl: newDdl } } }]),
      ],
    })];

    const result = await replayWithLegacyTolerances_ACU(chat, '');

    expect(result.data.sheet_0.sourceData.ddl).toBe(newDdl);
    expect(result.toleranceReport.legacyMetaUpdateDdlApplied).toBe(1);
  });

  it('未知与畸形 operation kind 跳过并记入报告，不使整条历史不可读', async () => {
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
      logEntries: [
        makeEntry(1, 'unknown-ops', [{ kind: 'future_unknown_operation' }, null]),
      ],
    })];

    const result = await replayWithLegacyTolerances_ACU(chat, '');

    expect(result.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
    expect(result.toleranceReport.unknownOperationKindsSkipped).toEqual(['future_unknown_operation', 'missing_kind']);
  });

  it('row_upsert 宽松语义：目标不存在则 push、身份漂移按 rowId 归一，均计数', async () => {
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
      logEntries: [
        makeEntry(1, 'lenient-upserts', [
          { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '9', cells: ['9', '宽松新增'] },
          { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['2', '身份漂移值'] },
        ]),
      ],
    })];

    const result = await replayWithLegacyTolerances_ACU(chat, '');

    expect(result.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '身份漂移值'],
      ['9', '宽松新增'],
    ]);
    expect(result.toleranceReport.lenientRowUpserts).toBe(2);
  });

  it('table_edit_dsl insertRow 使用旧行号算法 String(content.length) 并计数', async () => {
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
      logEntries: [
        makeEntry(1, 'legacy-dsl', [{ kind: 'table_edit_dsl', text: 'insertRow(0, {"0":"新道具"})' }]),
      ],
    })];

    const result = await replayWithLegacyTolerances_ACU(chat, '');

    expect(result.data.sheet_0.content).toEqual([
      ['row_id', 'name'],
      ['1', '铁剑'],
      ['2', '新道具'],
    ]);
    expect(result.toleranceReport.legacyDslRowIdAllocations).toBe(1);
  });

  it('checkpoint 内两代同名 key 被归并并记入 identityRemaps', async () => {
    const data = makeCheckpointData();
    delete data.sheet_0;
    data.sheet_x9k2f = {
      uid: 'x9k2f', name: '背包',
      content: [['row_id', 'name'], ['1', '旧行'], ['2', '旧独有行']],
      sourceData: { ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    };
    data[NEW_KEY] = {
      uid: 'beibao', name: '背包',
      content: [['row_id', 'name'], ['1', '新行']],
      sourceData: { ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    };
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
      logEntries: [],
    })];

    const result = await replayWithLegacyTolerances_ACU(chat, '');

    expect(result.data.sheet_x9k2f).toBeUndefined();
    expect(result.data[NEW_KEY].content).toEqual([
      ['row_id', 'name'],
      ['1', '新行'],
      ['2', '旧独有行'],
    ]);
    expect(result.toleranceReport.identityRemaps).toEqual([
      expect.objectContaining({ fromKey: 'sheet_x9k2f', toKey: NEW_KEY, canonicalName: '背包' }),
    ]);
  });

  it('bounded 调用（maxMessageIndex）只回放边界内的帧', async () => {
    const chat = [
      makeV2Message({
        version: 2,
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
        logEntries: [makeEntry(1, 'in-bound', [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '边界内'] }])],
      }),
      makeV2Message({
        version: 2,
        logEntries: [{
          ...makeEntry(1, 'out-of-bound', [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '边界外'] }]),
          targetMessageIndex: 1,
          aiFloor: 2,
        }],
      }),
    ];

    const bounded = await replayWithLegacyTolerances_ACU(chat, '', { maxMessageIndex: 0 });
    const full = await replayWithLegacyTolerances_ACU(chat, '');

    expect(bounded.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '边界内']]);
    expect(bounded.cutoff.messageIndex).toBe(0);
    expect(full.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '边界外']]);
    expect(full.cutoff.messageIndex).toBe(1);
  });
});

describe('自动降级链（严格失败 → Tier-1 → 固化）', () => {
  it('截图场景：旧 key checkpoint + 新 key sheet_replace 同名 + sql_sheet_batch，降级后身份归并、SQL 照常生效', async () => {
    const data = makeCheckpointData();
    delete data.sheet_0;
    data.sheet_x9k2f = {
      uid: 'x9k2f', name: '背包',
      content: [['row_id', 'name'], ['1', '旧行'], ['2', '旧独有行']],
      sourceData: { ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    };
    const templateSheet = {
      uid: 'beibao', name: '背包',
      content: [['row_id', 'name'], ['1', '模板行']],
      sourceData: { ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    };
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
      logEntries: [
        makeEntry(1, 'screenshot-scenario', [
          { kind: 'sheet_replace', sheetKey: NEW_KEY, sheet: templateSheet, reason: 'system' },
          { kind: 'sql_sheet_batch', sheetKey: NEW_KEY, tableName: 'beibao', reason: 'system', statements: ["UPDATE beibao SET name = 'SQL 改' WHERE row_id = 1"] },
        ]),
      ],
    })];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    // 表的身份是表名：同名新 key 的 sheet_replace 接管旧表（表内容以事件数据为准，不合并行），
    // 不再进入降级链，结果是严格可写历史；被接管的旧行数记录在 identityMerges 里。
    expect(replay?.baseKind).toBe('full_checkpoint');
    expect(replay?.requiresCheckpointConvergence).toBeFalsy();
    // 本测试无宿主模板（无 key 偏好）：规范 key 沿用已在历史中的旧 key，事件 key 登记重定向。
    expect(replay?.identityMerges).toEqual([
      expect.objectContaining({ fromKey: NEW_KEY, toKey: 'sheet_x9k2f', supersededRows: 2 }),
    ]);
    expect(replay?.data[NEW_KEY]).toBeUndefined();
    expect(replay?.data.sheet_x9k2f.content).toEqual([
      ['row_id', 'name'],
      ['1', 'SQL 改'],
    ]);
    // 严格探针（写路径语义）得到同一结果。
    const strictProbe = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false, compatibilityMode: 'disabled' });
    expect(strictProbe?.data.sheet_x9k2f.content).toEqual(replay?.data.sheet_x9k2f.content);
    // 未进入兼容路径：没有固化调度。
    await flushPendingCompatTransitionFixations_ACU();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].compatTransitionCheckpoint).toBeUndefined();
  });

  it('固化 canonical 校验不过时：tolerant 结果仍返回、不写盘、不抛错', async () => {
    const garbageSheet = {
      uid: 'inventory', name: 'inventory',
      content: [['row_id', 'name'], ['1', 'a'], ['1', 'b'], '畸形行'],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {}, exportConfig: {}, orderNo: 0,
    };
    const chat = [makeV2Message({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
      logEntries: [
        makeEntry(1, 'garbage-replace', [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: garbageSheet, reason: 'system' }]),
      ],
    })];
    const saveChat = vi.fn(async () => undefined);
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat, saveChat } as any);

      const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

      // 重编号无法满足 canonical 契约（畸形行）：按原始兼容结果返回。
      expect(replay?.baseKind).toBe('compat_tolerant_replay');
      expect(replay?.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', 'a'], ['1', 'b'], '畸形行']);

      await flushPendingCompatTransitionFixations_ACU();
      expect(chat[0].TavernDB_ACU_IsolatedData[''].compatTransitionCheckpoint).toBeUndefined();
      expect(chat[0].TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
      expect(saveChat).not.toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('放弃固化兼容过渡根'));
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });
});

describe('过渡根共存优先级', () => {
  function makeRoot(kind: 'spv79' | 'compat', cutoffMessageIndex: number, createdAt: number): any {
    const base = {
      version: 1,
      createdAt,
      data: makeCheckpointData(),
      cutoff: { messageIndex: cutoffMessageIndex, seq: 1, operationIndex: 0 },
    };
    return kind === 'spv79'
      ? { ...base, kind: 'spv79_duplicate_row_id_transition' }
      : { ...base, kind: 'compat_replay_transition', tolerances: ['legacy_duplicate_row_ids'] };
  }

  it('compareTransitionCutoffs_ACU 按 (messageIndex, seq, operationIndex) 字典序比较', () => {
    expect(compareTransitionCutoffs_ACU(
      { messageIndex: 0, seq: 5, operationIndex: 9 },
      { messageIndex: 1, seq: 0, operationIndex: 0 },
    )).toBeLessThan(0);
    expect(compareTransitionCutoffs_ACU(
      { messageIndex: 1, seq: 2, operationIndex: 0 },
      { messageIndex: 1, seq: 1, operationIndex: 9 },
    )).toBeGreaterThan(0);
    expect(compareTransitionCutoffs_ACU(
      { messageIndex: 1, seq: 1, operationIndex: 1 },
      { messageIndex: 1, seq: 1, operationIndex: 1 },
    )).toBe(0);
  });

  it('两代根共存时取 cutoff 更新者；cutoff 全等取 createdAt 新者；再平局取 compat', () => {
    const spv79Newer = [makeV2Message({ version: 2, logEntries: [] }, {
      spv79TransitionCheckpoint: makeRoot('spv79', 1, 10),
      compatTransitionCheckpoint: makeRoot('compat', 0, 20),
    })];
    expect(findLatestTransitionCheckpoint_ACU(spv79Newer, '')?.source).toBe('spv79');

    const compatNewer = [makeV2Message({ version: 2, logEntries: [] }, {
      spv79TransitionCheckpoint: makeRoot('spv79', 0, 20),
      compatTransitionCheckpoint: makeRoot('compat', 1, 10),
    })];
    expect(findLatestTransitionCheckpoint_ACU(compatNewer, '')?.source).toBe('compat');

    const createdAtBreaksTie = [makeV2Message({ version: 2, logEntries: [] }, {
      spv79TransitionCheckpoint: makeRoot('spv79', 0, 30),
      compatTransitionCheckpoint: makeRoot('compat', 0, 20),
    })];
    expect(findLatestTransitionCheckpoint_ACU(createdAtBreaksTie, '')?.source).toBe('spv79');

    const fullTie = [makeV2Message({ version: 2, logEntries: [] }, {
      spv79TransitionCheckpoint: makeRoot('spv79', 0, 20),
      compatTransitionCheckpoint: makeRoot('compat', 0, 20),
    })];
    expect(findLatestTransitionCheckpoint_ACU(fullTie, '')?.source).toBe('compat');
  });

  it('Detailed 回放以共存中 cutoff 更新的根为基座（compat 胜出 → baseKind=compat_transition_checkpoint）', async () => {
    const compatRoot = makeRoot('compat', 0, 20);
    compatRoot.data.sheet_0.content = [['row_id', 'name'], ['1', 'compat 根数据']];
    const spv79Root = makeRoot('spv79', 0, 10);
    spv79Root.data.sheet_0.content = [['row_id', 'name'], ['1', 'spv79 根数据']];
    spv79Root.cutoff = { messageIndex: 0, seq: 0, operationIndex: 0 };
    const chat = [makeV2Message({ version: 2, logEntries: [] }, {
      spv79TransitionCheckpoint: spv79Root,
      compatTransitionCheckpoint: compatRoot,
    })];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(replay?.baseKind).toBe('compat_transition_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', 'compat 根数据']]);
  });

  it('既有 spv79TransitionCheckpoint 单独存在时仍被识别为回放根（向后兼容）', async () => {
    const spv79Root = makeRoot('spv79', 0, 10);
    spv79Root.data.sheet_0.content = [['row_id', 'name'], ['1', '旧私有根数据']];
    const chat = [makeV2Message({ version: 2, logEntries: [] }, {
      spv79TransitionCheckpoint: spv79Root,
    })];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    expect(replay?.baseKind).toBe('spv79_transition_checkpoint');
    expect(replay?.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '旧私有根数据']]);
  });
});
