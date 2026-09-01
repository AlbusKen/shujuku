import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveStrict: vi.fn(), transaction: vi.fn(), setScope: vi.fn(), setGuide: vi.fn(),
  restoreMetadata: vi.fn(), clearRuntime: vi.fn(), deleteVector: vi.fn(), deleteEntries: vi.fn(),
  clearHotCache: vi.fn(), clearFlushTasks: vi.fn(), safeGc: vi.fn(),
  getEntries: vi.fn(), getTarget: vi.fn(), worldbookAvailable: vi.fn(),
  loadOrCreate: vi.fn(), reloadProvider: vi.fn(), sqliteMode: vi.fn(), notifyTemplate: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.chat,
  saveChatToHostStrict_ACU: mocks.saveStrict,
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  MESSAGE_TABLE_FIELDS_ACU: ['TavernDB_ACU_IsolatedData', 'TavernDB_ACU_Data', 'TavernDB_ACU_LocalMessageAnchor'],
  FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU: ['TavernDB_ACU_ScopedConfig', 'TavernDB_ACU_InternalSheetGuide', 'TavernDB_ACU_TableHeaderGuide'],
  clearAllTableFields_ACU: (msg: any) => {
    delete msg.TavernDB_ACU_IsolatedData; delete msg.TavernDB_ACU_Data; delete msg.TavernDB_ACU_LocalMessageAnchor;
  },
  scanResidualTableFields_ACU: (msg: any) => ['TavernDB_ACU_IsolatedData', 'TavernDB_ACU_Data', 'TavernDB_ACU_LocalMessageAnchor'].filter(key => Object.prototype.hasOwnProperty.call(msg, key)),
  scanResidualFirstMessageScopeFields_ACU: (chat: any[]) => ['TavernDB_ACU_ScopedConfig', 'TavernDB_ACU_InternalSheetGuide', 'TavernDB_ACU_TableHeaderGuide'].filter(key => Object.prototype.hasOwnProperty.call(chat[0] || {}, key)),
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  CHAT_SCOPED_CONFIG_FIELD_ACU: 'TavernDB_ACU_ScopedConfig', CHAT_SHEET_GUIDE_FIELD_ACU: 'TavernDB_ACU_InternalSheetGuide',
  getActiveChatStorageIdentity_ACU: () => 'chat-1',
  peekChatScopedConfigContainer_ACU: () => null, peekChatSheetGuideContainer_ACU: () => null,
  snapshotChatMetadataFields_ACU: () => ({ fields: [] }), restoreChatMetadataFields_ACU: mocks.restoreMetadata,
  setChatScopedConfigContainer_ACU: (chat: any[], value: any) => {
    mocks.setScope(value);
    if (value) chat[0].TavernDB_ACU_ScopedConfig = value;
    else delete chat[0].TavernDB_ACU_ScopedConfig;
  },
  setChatSheetGuideContainer_ACU: (chat: any[], value: any) => {
    mocks.setGuide(value);
    if (value) chat[0].TavernDB_ACU_InternalSheetGuide = value;
    else delete chat[0].TavernDB_ACU_InternalSheetGuide;
  },
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: (options: any, task: any) => mocks.transaction(options, task),
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  clearTableRuntimeWithoutReload_ACU: mocks.clearRuntime,
  reloadStorageProvider: mocks.reloadProvider,
}));
vi.mock('../../../src/service/table/table-service', () => ({ loadOrCreateJsonTableFromChatHistory_ACU: mocks.loadOrCreate }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: mocks.sqliteMode }));
vi.mock('../../../src/shared/template-runtime-change', () => ({ notifyTemplateRuntimeCommitted_ACU: mocks.notifyTemplate }));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  deleteSummaryVectorIndexExternal_ACU: mocks.deleteVector,
  cleanupUnreachableSummaryVectorIndexFiles_ACU: mocks.safeGc,
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  deleteSummaryVectorHotCacheByScope_ACU: mocks.clearHotCache,
  clearSummaryVectorFlushTasksByScope_ACU: mocks.clearFlushTasks,
}));
vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  isWorldbookApiAvailable_ACU: mocks.worldbookAvailable, getLorebookEntries_ACU: mocks.getEntries, deleteLorebookEntries_ACU: mocks.deleteEntries,
}));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({ getInjectionTargetLorebook_ACU: mocks.getTarget }));
vi.mock('../../../src/shared/constants', () => ({ getImportStablePrefix_ACU: () => '外部导入-' }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() }));

import { purgeCurrentChatDatabaseState_ACU } from '../../../src/service/chat/chat-database-purge';

beforeEach(() => {
  vi.clearAllMocks(); mocks.saveStrict.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((_options: any, task: any) => task());
  mocks.deleteVector.mockResolvedValue(undefined); mocks.worldbookAvailable.mockReturnValue(false);
  mocks.getTarget.mockResolvedValue(null); mocks.getEntries.mockResolvedValue([]);
  mocks.clearHotCache.mockResolvedValue(undefined); mocks.clearFlushTasks.mockResolvedValue(undefined); mocks.safeGc.mockResolvedValue({ failedDeletes: [] });
  mocks.loadOrCreate.mockResolvedValue({ loaded: true, source: 'initialized' });
  mocks.reloadProvider.mockResolvedValue(undefined); mocks.sqliteMode.mockReturnValue(false);
});

describe('purgeCurrentChatDatabaseState_ACU', () => {
  it('清空全部消息（含用户首条）且保留正文和 qrf_plot 业务字段', async () => {
    mocks.chat = [
      { is_user: true, mes: '用户正文', qrf_plot: { keep: true }, TavernDB_ACU_Data: { sheet_0: {} }, TavernDB_ACU_ScopedConfig: {} },
      { is_user: false, mes: 'AI正文', TavernDB_ACU_IsolatedData: { a: { summaryVectorIndexManifest: { indexId: 'v1' } } }, TavernDB_ACU_LocalMessageAnchor: 'x' },
    ];
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result).toMatchObject({ saved: true, clearedMessageCount: 2, removedMetadata: ['TavernDB_ACU_ScopedConfig'] });
    expect(mocks.chat[0]).toMatchObject({ mes: '用户正文', qrf_plot: { keep: true } });
    expect(mocks.chat[1]).toMatchObject({ mes: 'AI正文' });
    expect(mocks.saveStrict).toHaveBeenCalledTimes(1);
    expect(mocks.deleteVector).toHaveBeenCalledWith({ indexId: 'v1' });
    expect(mocks.clearRuntime).toHaveBeenCalledOnce();
  });

  it('严格保存失败时恢复消息字段并严格保存回滚状态', async () => {
    mocks.chat = [{ mes: '正文', TavernDB_ACU_Data: { sheet_0: {} } }];
    mocks.saveStrict.mockRejectedValueOnce(new Error('host down')).mockResolvedValueOnce(undefined);
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('已回滚并严格保存恢复状态') });
    expect(mocks.chat[0].TavernDB_ACU_Data).toEqual({ sheet_0: {} });
    expect(mocks.saveStrict).toHaveBeenCalledTimes(2);
    expect(mocks.restoreMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.clearRuntime).not.toHaveBeenCalled();
  });

  it('向量清理失败仅产生 warning，不撤销成功保存', async () => {
    mocks.chat = [{ TavernDB_ACU_IsolatedData: { a: { summaryVectorIndexManifest: { indexId: 'v1' } } } }];
    mocks.deleteVector.mockRejectedValueOnce(new Error('disk locked'));
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result.saved).toBe(true);
    expect(result.cleanupWarnings?.join(' ')).toContain('disk locked');
    expect(mocks.saveStrict).toHaveBeenCalledTimes(1);
  });

  it('成功保存后按 manifest scope 清理热缓存、flush task 并运行安全 GC', async () => {
    const manifest = { indexId: 'v1', chatKey: 'chat-1', isolationKey: 'tag-A', sourceTableKey: 'sheet_summary' };
    mocks.chat = [{ TavernDB_ACU_IsolatedData: { a: { summaryVectorIndexManifest: manifest } } }];

    const result = await purgeCurrentChatDatabaseState_ACU();

    expect(result.saved).toBe(true);
    const scope = { chatKey: 'chat-1', isolationKey: 'tag-A', sourceTableKey: 'sheet_summary' };
    expect(mocks.clearHotCache).toHaveBeenCalledWith(scope);
    expect(mocks.clearFlushTasks).toHaveBeenCalledWith(scope);
    expect(mocks.safeGc).toHaveBeenCalledWith({ scopeHints: [scope] });
  });

  it('purge 成功后回落全局模板：先清 runtime 再 loadOrCreate，native 模式不 reloadStorageProvider，并广播模板变更', async () => {
    mocks.chat = [{ TavernDB_ACU_Data: { sheet_0: {} } }];
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result.saved).toBe(true);
    expect(mocks.clearRuntime).toHaveBeenCalledOnce();
    expect(mocks.loadOrCreate).toHaveBeenCalledOnce();
    expect(mocks.loadOrCreate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.clearRuntime.mock.invocationCallOrder[0]);
    expect(mocks.reloadProvider).not.toHaveBeenCalled();
    expect(result.cleanupWarnings || []).toEqual([]);
    expect(mocks.notifyTemplate).toHaveBeenCalledOnce();
  });

  it('SQLite 模式下回落时额外 reloadStorageProvider', async () => {
    mocks.chat = [{ TavernDB_ACU_Data: { sheet_0: {} } }];
    mocks.sqliteMode.mockReturnValue(true);
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result.saved).toBe(true);
    expect(mocks.loadOrCreate).toHaveBeenCalledOnce();
    expect(mocks.reloadProvider).toHaveBeenCalledOnce();
  });

  it('回落重建失败降级为 cleanupWarnings，不推翻已成功的 purge，也不广播模板变更', async () => {
    mocks.chat = [{ TavernDB_ACU_Data: { sheet_0: {} } }];
    mocks.loadOrCreate.mockRejectedValueOnce(new Error('template broken'));
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result.saved).toBe(true);
    expect(result.cleanupWarnings?.join(' ')).toContain('template broken');
    expect(mocks.notifyTemplate).not.toHaveBeenCalled();
  });

  it('loadOrCreate 返回 loaded:false 时同样降级为 warning', async () => {
    mocks.chat = [{ TavernDB_ACU_Data: { sheet_0: {} } }];
    mocks.loadOrCreate.mockResolvedValueOnce({ loaded: false, source: 'initialized', error: 'no template' });
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result.saved).toBe(true);
    expect(result.cleanupWarnings?.join(' ')).toContain('no template');
  });

  it('purge 失败（严格保存回滚）时不触发回落重建', async () => {
    mocks.chat = [{ mes: '正文', TavernDB_ACU_Data: { sheet_0: {} } }];
    mocks.saveStrict.mockRejectedValueOnce(new Error('host down')).mockResolvedValueOnce(undefined);
    const result = await purgeCurrentChatDatabaseState_ACU();
    expect(result.saved).toBe(false);
    expect(mocks.loadOrCreate).not.toHaveBeenCalled();
    expect(mocks.reloadProvider).not.toHaveBeenCalled();
  });
});
