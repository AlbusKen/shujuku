import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRuntimeOnlyPendingScopeKey_ACU,
  clearRuntimeOnlyPendingSheets_ACU,
  extractPendingSheetKeysFromWriteSet_ACU,
  hasRuntimeOnlyPendingSheets_ACU,
  markRuntimeOnlyPendingSheets_ACU,
  readRuntimeOnlyPendingSheets_ACU,
  registerRuntimeOnlyPendingFlusher_ACU,
  runRegisteredRuntimeOnlyPendingFlush_ACU,
} from '../../../src/service/table/runtime-only-pending-state';

const scopeA = { chatKey: 'chat-a', isolationKey: '' };
const scopeB = { chatKey: 'chat-b', isolationKey: 'tag' };

describe('runtime-only-pending-state', () => {
  beforeEach(() => {
    clearRuntimeOnlyPendingSheets_ACU();
    registerRuntimeOnlyPendingFlusher_ACU(null);
  });

  it('scope key 对空 chatKey/isolationKey 使用稳定默认值', () => {
    expect(buildRuntimeOnlyPendingScopeKey_ACU({})).toBe('current-chat::default');
    expect(buildRuntimeOnlyPendingScopeKey_ACU({ chatKey: ' chat ', isolationKey: 'tag' })).toBe('chat::tag');
  });

  it('extractPendingSheetKeysFromWriteSet：sheet/row/cell 单元归并到表；all 或缺 sheetKey 视为全部', () => {
    expect(extractPendingSheetKeysFromWriteSet_ACU([
      { kind: 'sheet', sheetKey: 'sheet_b' },
      { kind: 'row', sheetKey: 'sheet_a' },
      { kind: 'cell', sheetKey: 'sheet_a' },
    ])).toEqual({ all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
    expect(extractPendingSheetKeysFromWriteSet_ACU([{ kind: 'all' }])).toEqual({ all: true, sheetKeys: [] });
    expect(extractPendingSheetKeysFromWriteSet_ACU([{ kind: 'sheet', sheetKey: '' }])).toEqual({ all: true, sheetKeys: [] });
    expect(extractPendingSheetKeysFromWriteSet_ACU([])).toEqual({ all: true, sheetKeys: [] });
    expect(extractPendingSheetKeysFromWriteSet_ACU(null)).toEqual({ all: true, sheetKeys: [] });
  });

  it('按 scope 隔离登记，多次登记合并且去重', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_b', 'sheet_a'] });
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a', 'not_a_sheet'] });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: false, sheetKeys: ['sheet_a', 'sheet_b'] });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeB)).toBeNull();
    expect(hasRuntimeOnlyPendingSheets_ACU(scopeA)).toBe(true);
    expect(hasRuntimeOnlyPendingSheets_ACU(scopeB)).toBe(false);
  });

  it('all 登记一旦出现就保持为 all', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: true, sheetKeys: [] });
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toEqual({ all: true, sheetKeys: ['sheet_a'] });
  });

  it('clear 只清指定 scope；不传 scope 清空全部', () => {
    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    markRuntimeOnlyPendingSheets_ACU(scopeB, { all: false, sheetKeys: ['sheet_b'] });
    clearRuntimeOnlyPendingSheets_ACU(scopeA);
    expect(readRuntimeOnlyPendingSheets_ACU(scopeA)).toBeNull();
    expect(readRuntimeOnlyPendingSheets_ACU(scopeB)).toEqual({ all: false, sheetKeys: ['sheet_b'] });
    clearRuntimeOnlyPendingSheets_ACU();
    expect(readRuntimeOnlyPendingSheets_ACU(scopeB)).toBeNull();
  });

  it('未注册落盘器或无登记时 runRegistered 直接返回未落盘且不调用', async () => {
    const flusher = vi.fn(async () => ({ flushed: true, sheetKeys: ['sheet_a'] }));
    expect(await runRegisteredRuntimeOnlyPendingFlush_ACU(scopeA, 'r')).toEqual({ flushed: false, sheetKeys: [] });

    registerRuntimeOnlyPendingFlusher_ACU(flusher);
    expect(await runRegisteredRuntimeOnlyPendingFlush_ACU(scopeA, 'r')).toEqual({ flushed: false, sheetKeys: [] });
    expect(flusher).not.toHaveBeenCalled();

    markRuntimeOnlyPendingSheets_ACU(scopeA, { all: false, sheetKeys: ['sheet_a'] });
    expect(await runRegisteredRuntimeOnlyPendingFlush_ACU(scopeA, 'reason-x')).toEqual({ flushed: true, sheetKeys: ['sheet_a'] });
    expect(flusher).toHaveBeenCalledWith('reason-x');
  });
});
