import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  migration: vi.fn(),
  reload: vi.fn(),
  transaction: vi.fn(),
  persist: vi.fn(),
  ensureProvider: vi.fn(),
  setCurrentData: vi.fn(),
  currentChatKey: 'chat-a',
  currentIsolationKey: 'scope-a',
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mocks.currentChatKey; },
  currentJsonTableData_ACU: null,
  isAutoUpdatingCard_ACU: false,
  getCurrentIsolationKey_ACU: () => mocks.currentIsolationKey,
  _set_currentJsonTableData_ACU: mocks.setCurrentData,
}));
vi.mock('../../../src/service/table/table-service', () => ({
  ensureLegacyStorageMigratedBeforeWrite_ACU: mocks.migration,
  persistTablesToChatMessage_ACU: mocks.persist,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: mocks.ensureProvider,
  reloadStorageProvider: mocks.reload,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mocks.transaction,
}));
vi.mock('../../../src/service/table/manual-catch-up-provisional-bridge', () => ({
  ensureNoActiveProvisionalBridgeForCurrentScope_ACU: vi.fn(async () => ({ ok: true, action: 'none' })),
}));

import { runSqliteRuntimeMutationCommit_ACU, runTableUpdateCommit_ACU } from '../../../src/service/table/table-update-commit';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  registerRuntimeOnlyPendingFlusher_ACU,
} from '../../../src/service/table/runtime-only-pending-state';

function options(reason: string) {
  return {
    source: 'system' as const,
    reason,
    writeSet: [{ kind: 'all' as const }],
    targetMessageIndex: -1,
    targetSheetKeys: null,
  };
}

describe('runTableUpdateCommit_ACU migration gate', () => {
  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: false, error: 'mixed storage evidence insufficient' });
    mocks.reload.mockReset();
    mocks.transaction.mockReset();
    mocks.persist.mockReset();
    mocks.ensureProvider.mockReset();
    mocks.setCurrentData.mockReset();
  });

  it('mixed/legacy 迁移失败时不执行 apply、事务或持久化', async () => {
    const apply = vi.fn();

    const result = await runTableUpdateCommit_ACU(options('test_mixed_gate'), apply);

    expect(result).toEqual({
      success: false,
      error: 'mixed storage evidence insufficient',
      errorCategory: 'infrastructure',
    });
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('SQLite mutation 同样在 provider 写入前被 migration gate 拦截', async () => {
    const result = await runSqliteRuntimeMutationCommit_ACU({
      ...options('test_sqlite_mixed_gate'),
      sql: 'UPDATE sheet_0 SET value = ?',
      params: ['changed'],
      mapValue: () => 'unreachable',
    });

    expect(result).toEqual({
      success: false,
      error: 'mixed storage evidence insufficient',
      errorCategory: 'infrastructure',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.ensureProvider).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('AI 等待期间切换聊天后 fail-loud，禁止进入事务与 apply', async () => {
    const apply = vi.fn();
    mocks.migration.mockImplementation(async () => {
      mocks.currentChatKey = 'chat-b';
      mocks.currentIsolationKey = 'scope-b';
      return { success: true, migrated: false };
    });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_scope_switch_guard'),
      chatKey: 'chat-a',
      isolationKey: 'scope-a',
    }, apply);

    expect(result).toMatchObject({
      success: false,
      errorCategory: 'precondition',
      error: expect.stringContaining('聊天或隔离标识已切换'),
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('RuntimeRevision 错误不再分类为 conflict，未知提交错误统一归为 infrastructure', async () => {
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('[RuntimeRevision] 表 sheet_0 已变化'), {
      name: 'TableRuntimeRevisionConflictError',
    }));

    const result = await runTableUpdateCommit_ACU(options('test_runtime_conflict'), vi.fn());

    expect(result).toEqual({
      success: false,
      error: '[RuntimeRevision] 表 sheet_0 已变化',
      errorCategory: 'infrastructure',
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('persist 前只读拒绝空 row_id，且不会调用持久化或修复数据', async () => {
    const invalidData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0',
        name: '损坏表',
        content: [['row_id', '名称'], ['', '未分配身份']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));

    const result = await runTableUpdateCommit_ACU(options('test_row_identity_guard'), async () => ({
      success: true,
      tableData: invalidData,
      value: 'unreachable',
    }));

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('sheetKey=sheet_0, rowIndex=1 的 row_id 为空') });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(invalidData.sheet_0.content[1][0]).toBe('');
  });

  it('persist 前拒绝重复 row_id，并提供可定位的行号', async () => {
    const invalidData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0',
        name: '损坏表',
        content: [['row_id', '名称'], ['stable', '第一行'], ['stable', '第二行']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));

    const result = await runTableUpdateCommit_ACU(options('test_duplicate_row_identity_guard'), async () => ({
      success: true,
      tableData: invalidData,
    }));

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('sheetKey=sheet_0, rowIndex=2 的 row_id 重复：stable') });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('将 workingDataMode=none 透传给事务层，并允许 apply 使用预计算结果', async () => {
    const precomputedData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (transactionOptions: any, task: any) => {
      expect(transactionOptions.workingDataMode).toBe('none');
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_precomputed_commit'),
      workingDataMode: 'none',
      targetSheetKeys: ['sheet_target'],
    }, async ({ workingData }) => ({ success: true, tableData: precomputedData, value: workingData }));

    expect(result).toMatchObject({ success: true, value: null, tableData: precomputedData });
  });

  it('表格持久化失败时回滚同提交暂存的附属状态', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    const rollback = vi.fn();
    const beforePersist = vi.fn(() => ({ rollback }));
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockResolvedValue({ saved: false, error: 'host save failed' });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_before_persist_rollback'),
      targetSheetKeys: ['sheet_target'],
    }, async () => ({
      success: true,
      tableData: data,
      persist: { beforePersist },
    }));

    expect(result).toMatchObject({ success: false, error: 'host save failed' });
    expect(beforePersist).toHaveBeenCalledWith(data);
    expect(rollback).toHaveBeenCalledOnce();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });

  it('表格持久化成功后保留同提交暂存的附属状态', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    const rollback = vi.fn();
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });

    const result = await runTableUpdateCommit_ACU({ ...options('test_before_persist_success'), targetSheetKeys: ['sheet_target'] }, async () => ({
      success: true,
      tableData: data,
      persist: { beforePersist: () => ({ rollback }) },
    }));

    expect(result.success).toBe(true);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('增量提交只校验目标表，不因未写入表的既有坏行重复扫描并阻断', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: {
        uid: 'sheet_target',
        name: '目标表',
        content: [['row_id', '名称'], ['target-1', '正常']],
      },
      sheet_untouched: {
        uid: 'sheet_untouched',
        name: '未修改表',
        content: [['row_id', '名称'], ['', '历史坏行']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockResolvedValue({ saved: true, messageIndex: 1 });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_scoped_row_identity_guard'),
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }],
      targetSheetKeys: ['sheet_target'],
    }, async () => ({
      success: true,
      tableData: data,
      value: 'saved',
    }));

    expect(result).toMatchObject({ success: true, value: 'saved', saved: true });
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: ['sheet_target'],
      tableData: data,
    }));
  });

  it('全量提交仍校验全部表，不能借范围收窄绕过坏行', async () => {
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: {
        uid: 'sheet_target',
        name: '目标表',
        content: [['row_id', '名称'], ['target-1', '正常']],
      },
      sheet_broken: {
        uid: 'sheet_broken',
        name: '损坏表',
        content: [['row_id', '名称'], ['', '坏行']],
      },
    };
    mocks.migration.mockResolvedValue({ success: true, migrated: false });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));

    const result = await runTableUpdateCommit_ACU({
      ...options('test_full_row_identity_guard'),
      targetSheetKeys: null,
    }, async () => ({ success: true, tableData: data }));

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('sheetKey=sheet_broken, rowIndex=1 的 row_id 为空'),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});


describe('runTableUpdateCommit_ACU runtime-only 未落盘登记与写回', () => {
  const scope = { chatKey: 'chat-a', isolationKey: 'scope-a' };
  const data: any = {
    mate: { type: 'acu', version: 1 },
    sheet_a: { uid: 'sheet_a', name: '表A', content: [['row_id'], ['1']] },
    sheet_b: { uid: 'sheet_b', name: '表B', content: [['row_id'], ['1']] },
  };

  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      runCommit: async (commitTask: any) => commitTask(),
    }, null));
    mocks.persist.mockReset().mockResolvedValue({ saved: true, messageIndex: 1 });
    mocks.setCurrentData.mockReset();
    clearRuntimeOnlyPendingSheets_ACU();
    registerRuntimeOnlyPendingFlusher_ACU(null);
  });

  it('外部来源 skipChatSave 提交按写集登记待落盘表，不写聊天', async () => {
    const result = await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      revisionWriteSet: [{ kind: 'row', sheetKey: 'sheet_a', rowId: '1' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data, value: 1 }));

    expect(result).toMatchObject({ success: true, saved: true });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toEqual({ all: false, sheetKeys: ['sheet_a'] });
  });

  it('kind:all 的外部 skipChatSave 写集按当前全部表登记', async () => {
    await runTableUpdateCommit_ACU({
      source: 'raw_sql_batch',
      reason: 'raw_sql_batch',
      writeSet: [{ kind: 'all' }],
      targetMessageIndex: -1,
      targetSheetKeys: null,
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toEqual({ all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
  });

  it('非外部来源（填表 import 候选 / 运行时恢复）的 skipChatSave 不登记', async () => {
    await runTableUpdateCommit_ACU({
      source: 'group_fill',
      reason: 'executeCardUpdateCore',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: -1,
      targetSheetKeys: null,
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));
    await runTableUpdateCommit_ACU({
      source: 'import',
      reason: 'importTableAsJson',
      writeSet: [{ kind: 'all' }],
      targetMessageIndex: -1,
      targetSheetKeys: null,
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    expect(readRuntimeOnlyPendingSheets_ACU(scope)).toBeNull();
  });

  it('普通持久化提交在开启事务前先触发已注册的写回；flush 自身提交不再触发', async () => {
    const flusher = vi.fn(async () => ({ flushed: true, sheetKeys: ['sheet_a'] }));
    registerRuntimeOnlyPendingFlusher_ACU(flusher);
    await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));
    expect(flusher).not.toHaveBeenCalled();

    const order: string[] = [];
    flusher.mockImplementation(async (reason: string) => { order.push(`flush:${reason}`); return { flushed: true, sheetKeys: ['sheet_a'] }; });
    mocks.transaction.mockImplementation(async (_options: any, task: any) => {
      order.push('transaction');
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });

    await runTableUpdateCommit_ACU({
      source: 'group_fill',
      reason: 'executeCardUpdateCore',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
    }, async () => ({ success: true, tableData: data }));
    expect(order).toEqual(['flush:executeCardUpdateCore', 'transaction']);

    flusher.mockClear();
    await runTableUpdateCommit_ACU({
      source: 'system',
      reason: 'runtime_only_flush:test',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipRuntimeOnlyPendingFlush: true,
    }, async () => ({ success: true, tableData: data }));
    expect(flusher).not.toHaveBeenCalled();
  });

  it('写回失败不阻断本次提交', async () => {
    registerRuntimeOnlyPendingFlusher_ACU(vi.fn(async () => { throw new Error('flush exploded'); }));
    await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'insertRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
      skipChatSave: true,
    }, async () => ({ success: true, tableData: data }));

    const result = await runTableUpdateCommit_ACU({
      source: 'manual_crud',
      reason: 'updateRow:sqlite',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_a'],
    }, async () => ({ success: true, tableData: data, value: true }));
    expect(result.success).toBe(true);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });
});

describe('runTableUpdateCommit_ACU stage_only 判别联合（计划 5.3）', () => {
  beforeEach(() => {
    mocks.currentChatKey = 'chat-a';
    mocks.currentIsolationKey = 'scope-a';
    mocks.migration.mockReset().mockResolvedValue({ success: true, migrated: false });
    mocks.reload.mockReset();
    mocks.transaction.mockReset();
    mocks.persist.mockReset();
    mocks.ensureProvider.mockReset();
    mocks.setCurrentData.mockReset();
  });

  it('stage_only 不调用 migration、bridge gate、persist，只更新运行时快照', async () => {
    const stagedData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_target: { uid: 'sheet_target', name: '目标表', content: [['row_id'], ['r1']] },
    };
    mocks.transaction.mockImplementation(async (transactionOptions: any, task: any) => {
      expect(transactionOptions.workingDataMode).toBe('none');
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_stage_only_commit'),
      commitMode: 'stage_only',
      workingDataMode: 'none',
      targetSheetKeys: ['sheet_target'],
    }, async () => ({ success: true, tableData: stagedData, value: 'staged' }));

    expect(result).toMatchObject({ success: true, value: 'staged', saved: false });
    expect(mocks.migration).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).toHaveBeenCalledTimes(1);
  });

  it('stage_only 在应用阶段检测到聊天切换时 fail-closed', async () => {
    mocks.transaction.mockImplementation(async (_options: any, task: any) => {
      mocks.currentChatKey = 'chat-b';
      mocks.currentIsolationKey = 'scope-b';
      return task({ runCommit: async (commitTask: any) => commitTask() }, null);
    });

    const result = await runTableUpdateCommit_ACU({
      ...options('test_stage_only_scope_guard'),
      commitMode: 'stage_only',
      chatKey: 'chat-a',
      isolationKey: 'scope-a',
    }, async () => ({ success: true, tableData: { mate: { type: 'acu', version: 1 } } }));

    expect(result).toMatchObject({
      success: false,
      errorCategory: 'precondition',
      error: expect.stringContaining('聊天或隔离标识已切换'),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.setCurrentData).not.toHaveBeenCalled();
  });
});
