import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  chatIdentifier: 'session-chat',
  isolationKey: '',
  sqlite: false,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mocks.chatIdentifier; },
  getCurrentIsolationKey_ACU: vi.fn(() => mocks.isolationKey),
}));

vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mocks.sqlite),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  parseAndApplyTableEditsToData_ACU: vi.fn((_response: string, data: any) => {
    const next = JSON.parse(JSON.stringify(data));
    next.sheet_b.content = [['row_id', '值'], ['1', 'from-dsl']];
    return { success: true, modifiedKeys: ['sheet_b'], workingData: next };
  }),
}));

const detachedSql = vi.hoisted(() => ({
  loadFromData: vi.fn(async () => ({ loaded: true, source: 'merged' })),
  applyEditsWithSystemRowIds: vi.fn(() => ({
    success: true,
    tableData: {
      mate: { type: 'acu' },
      sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', '值'], ['9', 'must-not-overlay']] },
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值'], ['1', 'from-sql']] },
    },
  })),
  isReady: vi.fn(() => true),
  dispose: vi.fn(),
}));

vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  createDetachedSqlTableService_ACU: vi.fn(() => detachedSql),
}));

import { createTableFillStagingRunContext_ACU } from '../../../src/service/table/table-fill-boundary-staging';
import { createTableFillStagingSession_ACU } from '../../../src/service/table/table-fill-staging-session';
import { createDetachedSqlTableService_ACU } from '../../../src/service/table/table-storage-strategy';

describe('TableFillStagingSession', () => {
  beforeEach(() => {
    mocks.chatIdentifier = 'session-chat';
    mocks.isolationKey = '';
    mocks.sqlite = false;
  });

  it('连续 bucket 累积目标 overlay，且不把未来非目标数据写入 overlay', async () => {
    const run = createTableFillStagingRunContext_ACU({
      runId: 'run-session',
      chatKey: 'session-chat',
      isolationKey: '',
      targetSheetKeys: ['sheet_b'],
      originalFullIndex: 100,
      templateFingerprint: 'tpl',
    });
    const session = createTableFillStagingSession_ACU(run);
    const historical = {
      mate: { type: 'acu' },
      sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', '值']] },
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值']] },
    };

    const first = await session.applyBucket({
      historicalBase: historical,
      saveTargetIndex: 80,
      updateMode: 'manual_independent',
      appliedTableData: {
        ...historical,
        sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值'], ['1', 'b1']] },
      },
    });
    expect(first.ok).toBe(true);
    expect(Object.keys(session.getTargetOverlay().sheets)).toEqual(['sheet_b']);

    const second = await session.applyBucket({
      historicalBase: historical,
      saveTargetIndex: 90,
      updateMode: 'manual_independent',
      dslResponses: [{ aiResponse: 'edit', targetSheetKeys: ['sheet_b'] }],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.tableData.sheet_b.content[1][1]).toBe('from-dsl');
    expect(session.getTargetOverlay().sheets.sheet_a).toBeUndefined();
    await session.discard();
    const afterDiscard = await session.applyBucket({
      historicalBase: historical,
      saveTargetIndex: 91,
      updateMode: 'manual_independent',
      appliedTableData: historical,
    });
    expect(afterDiscard.ok).toBe(false);
  });

  it('SQLite bucket 只操作 detached provider，overlay 仅收口目标表', async () => {
    mocks.sqlite = true;
    detachedSql.loadFromData.mockClear();
    detachedSql.applyEditsWithSystemRowIds.mockClear();
    detachedSql.dispose.mockClear();
    const run = createTableFillStagingRunContext_ACU({
      runId: 'run-sql-session',
      chatKey: 'session-chat',
      isolationKey: '',
      targetSheetKeys: ['sheet_b'],
      originalFullIndex: 100,
      templateFingerprint: 'tpl',
    });
    const session = createTableFillStagingSession_ACU(run);
    const historical = {
      mate: { type: 'acu' },
      sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', '值']] },
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值']] },
    };

    const result = await session.applyBucket({
      historicalBase: historical,
      saveTargetIndex: 80,
      updateMode: 'manual_independent',
      sqlTexts: ['UPDATE B SET 值 = \'from-sql\' WHERE row_id = 1;'],
    });

    expect(result.ok).toBe(true);
    expect(createDetachedSqlTableService_ACU).toHaveBeenCalledOnce();
    expect(detachedSql.loadFromData).toHaveBeenCalledOnce();
    expect(detachedSql.applyEditsWithSystemRowIds).toHaveBeenCalledOnce();
    expect(detachedSql.dispose).toHaveBeenCalled();
    expect(Object.keys(session.getTargetOverlay().sheets)).toEqual(['sheet_b']);
    expect(session.getTargetOverlay().sheets.sheet_b.content[1][1]).toBe('from-sql');
    expect(session.getTargetOverlay().sheets.sheet_a).toBeUndefined();
    await session.discard();
  });
});
