import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  chatKey: 'chat-a',
  isolationKey: '',
  sqlite: true,
  providerData: null as any,
  currentJsonTableData: null as any,
  replay: vi.fn(),
  commit: vi.fn(),
  settings: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.chat,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mocks.chatKey; },
  get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
  get settings_ACU() { return mocks.settings; },
  getCurrentIsolationKey_ACU: () => mocks.isolationKey,
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: () => mocks.sqlite,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: vi.fn(async () => ({ mode: 'sqlite', getCurrentData: () => mocks.providerData })),
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2Detailed_ACU: (...args: any[]) => mocks.replay(...args),
}));
vi.mock('../../../src/service/table/table-history', () => ({
  getLatestTableAppendMessageIndexFromChat_ACU: (chat: any[]) => {
    for (let i = chat.length - 1; i >= 0; i -= 1) if (chat[i] && !chat[i].is_user) return i;
    return -1;
  },
}));
vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: (...args: any[]) => mocks.commit(...args),
}));

import { flushRuntimeOnlyPendingChanges_ACU } from '../../../src/service/table/runtime-only-pending-flush';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  markRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  runRegisteredRuntimeOnlyPendingFlush_ACU,
} from '../../../src/service/table/runtime-only-pending-state';

const scope = () => ({ chatKey: mocks.chatKey, isolationKey: mocks.isolationKey });

function sheet(rows: any[][]) {
  return { uid: 'sheet_a', name: '表A', content: rows, sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 };
}

describe('flushRuntimeOnlyPendingChanges_ACU', () => {
  beforeEach(() => {
    clearRuntimeOnlyPendingSheets_ACU();
    mocks.chat.length = 0;
    mocks.chat.push({ is_user: false, mes: 'AI0' }, { is_user: true, mes: 'U1' }, { is_user: false, mes: 'AI2' });
    mocks.sqlite = true;
    mocks.providerData = {
      mate: { type: 'acu' },
      sheet_a: sheet([['row_id', '值'], ['1', '前端写入']]),
      sheet_b: sheet([['row_id', '值']]),
    };
    mocks.currentJsonTableData = null;
    mocks.replay.mockReset().mockResolvedValue({ data: { sheet_a: sheet([['row_id', '值']]), sheet_b: sheet([['row_id', '值']]) } });
    mocks.commit.mockReset().mockResolvedValue({ success: true, messageIndex: 2 });
  });

  it('无登记时不读运行时、不提交', async () => {
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result).toEqual({ flushed: false, sheetKeys: [] });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('登记表与回放不一致时，以 sheet_replace 写回最新 AI 楼层并清空登记', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a', 'sheet_b'] });

    const result = await flushRuntimeOnlyPendingChanges_ACU('processUpdatesBatch');

    expect(result).toEqual({ flushed: true, sheetKeys: ['sheet_a'], messageIndex: 2 });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    const [options, apply] = mocks.commit.mock.calls[0];
    expect(options).toMatchObject({
      source: 'system',
      reason: 'runtime_only_flush:processUpdatesBatch',
      targetMessageIndex: 2,
      targetSheetKeys: ['sheet_a'],
      trackAsUpdate: false,
      trackingSheetKeys: [],
      revisionWriteSet: [],
      skipRuntimeOnlyPendingFlush: true,
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
    });
    expect(options.operations).toEqual([{
      kind: 'sheet_replace',
      sheetKey: 'sheet_a',
      sheet: expect.objectContaining({ content: [['row_id', '值'], ['1', '前端写入']] }),
      reason: 'system',
    }]);
    const applied = apply({});
    expect(applied.success).toBe(true);
    expect(applied.tableData.sheet_a.content).toEqual([['row_id', '值'], ['1', '前端写入']]);
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toBeNull();
  });

  it('运行时与回放一致的表不写入；全部一致时清空登记且不提交', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_b'] });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result).toEqual({ flushed: false, sheetKeys: [] });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toBeNull();
  });

  it('all 登记按运行时全部表比对；回放失败时保守地写回全部候选表', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: true, sheetKeys: [] });
    mocks.replay.mockRejectedValue(new Error('replay broken'));
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result.flushed).toBe(true);
    expect(result.sheetKeys).toEqual(['sheet_a', 'sheet_b']);
    expect(mocks.commit.mock.calls[0][0].targetSheetKeys).toEqual(['sheet_a', 'sheet_b']);
  });

  it('提交失败时保留登记等待下次重试', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    mocks.commit.mockResolvedValue({ success: false, error: 'host save failed' });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result).toEqual({ flushed: false, sheetKeys: ['sheet_a'], error: 'host save failed' });
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).toEqual({ all: false, sheetKeys: ['sheet_a'] });
  });

  it('没有 AI 楼层可写时不提交且保留登记', async () => {
    mocks.chat.length = 0;
    mocks.chat.push({ is_user: true, mes: 'U0' });
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result.flushed).toBe(false);
    expect(result.error).toContain('no AI message');
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(readRuntimeOnlyPendingSheets_ACU(scope())).not.toBeNull();
  });

  it('native 模式以 currentJsonTableData 作为运行时快照', async () => {
    mocks.sqlite = false;
    mocks.currentJsonTableData = { mate: { type: 'acu' }, sheet_a: sheet([['row_id', '值'], ['1', 'native 行']]) };
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    const result = await flushRuntimeOnlyPendingChanges_ACU('test');
    expect(result.flushed).toBe(true);
    expect(mocks.commit.mock.calls[0][0].operations[0].sheet.content).toEqual([['row_id', '值'], ['1', 'native 行']]);
  });

  it('模块加载即向 state 注册落盘器，提交模型可通过注册入口触发', async () => {
    markRuntimeOnlyPendingSheets_ACU(scope(), { all: false, sheetKeys: ['sheet_a'] });
    const result = await runRegisteredRuntimeOnlyPendingFlush_ACU(scope(), 'insertRow');
    expect(result.flushed).toBe(true);
    expect(mocks.commit.mock.calls[0][0].reason).toBe('runtime_only_flush:insertRow');
  });
});
