import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableDataObject_ACU } from '../../src/shared/models/table-data';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  data: null as any,
  provider: null as any,
  scope: null as any,
  guide: null as any,
  sqliteMode: false,
  persistedTableData: null as any,
}));

vi.mock('../../src/shared/utils', () => ({ hashUserInput_ACU: () => 'hash', logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(), parseTableTemplateJson_ACU: () => h.data, stripSeedRowsFromTemplate_ACU: (value: any) => value }));
vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.data; },
  _set_currentJsonTableData_ACU: (value: any) => { h.data = value; },
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: { storageMode: 'native' },
}));
vi.mock('../../src/data/storage/chat-history', () => ({
  peekChatScopedConfigContainer_ACU: () => h.scope || {},
  peekChatSheetGuideContainer_ACU: () => h.guide || {},
  setChatScopedConfigContainer_ACU: (_chat: any[], value: any) => { h.scope = value; },
  setChatSheetGuideContainer_ACU: (_chat: any[], value: any) => { h.guide = value; },
}));
vi.mock('../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => h.chat, saveChatToHostStrict_ACU: vi.fn().mockResolvedValue(undefined), emitMessageUpdated_ACU: vi.fn() }));
vi.mock('../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => h.chat,
  clearAllAiTableDataForCheckpointRestore_ACU: async () => ({ clearedCount: 1, vectorManifestsToDeleteAfterCommit: [] }),
  cleanupCheckpointVectorIndexManifestsAfterCommit_ACU: async () => [],
}));
vi.mock('../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: vi.fn() }));
vi.mock('../../src/service/worldbook/pipeline', () => ({ deleteAllGeneratedEntries_ACU: vi.fn(), refreshMergedDataAndNotify_ACU: vi.fn() }));
vi.mock('../../src/service/table/storage-mode', () => ({ isSqliteMode: () => h.sqliteMode }));
vi.mock('../../src/service/template/chat-scope', () => ({
  buildChatTemplateScopeStateFromCurrent_ACU: (options: any) => ({ mode: 'chat_override', presetName: options.presetName, templateStr: JSON.stringify(options.templateSource) }),
  getCurrentChatTemplateScopeState_ACU: () => h.scope,
  getChatSheetGuideDataForIsolationKey_ACU: () => h.guide,
  setCurrentChatTemplateScopeState_ACU: (value: any) => { h.scope = value; return true; },
  setChatSheetGuideDataForIsolationKey_ACU: (_key: string, value: any) => { h.guide = value; return true; },
  normalizeGuideData_ACU: (value: any) => value,
  sanitizeChatSheetsObject_ACU: (value: any) => value,
  sanitizeTemplateSnapshotForChat_ACU: (source: any) => source ? { templateObj: typeof source === 'string' ? JSON.parse(source) : JSON.parse(JSON.stringify(source)), templateStr: typeof source === 'string' ? source : JSON.stringify(source) } : null,
  ensureStableRowIdsForSheetContent_ACU: (value: any) => value,
  getEffectiveSeedRowsForSheet_ACU: () => [],
  shouldUseInitialSeedRows_ACU: () => false,
}));
vi.mock('../../src/service/table/table-history', () => ({ getLatestAiMessageIndexFromChat_ACU: (chat: any[]) => chat.length - 1 }));
vi.mock('../../src/service/table/table-write-transaction', () => ({ runTableWriteTransaction_ACU: async (_options: any, task: any) => task({ runCommit: async (work: any) => work() }) }));
vi.mock('../../src/service/table/table-service', () => ({
  persistTablesToChatMessage_ACU: async (options: any) => {
    h.persistedTableData = JSON.parse(JSON.stringify(options.tableData));
    return { saved: true, messageIndex: 1 };
  },
  loadOrCreateJsonTableFromChatHistory_ACU: async () => ({ loaded: false, source: 'empty' }),
  saveIndependentTableToChatHistory_ACU: vi.fn(),
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: () => h.provider,
  getActiveStorageProvider: () => h.provider,
  reloadStorageProvider: async () => {
    const provider = new SqlTableService();
    await provider.replaceAllData(h.persistedTableData);
    h.provider = provider;
  },
}));

import { NativeTableServiceAdapter } from '../../src/service/table/native-table-service-adapter';
import { SqlTableService } from '../../src/service/table/sql-table-service';
import { buildCurrentTableCheckpoint_ACU, parseTableCheckpointFile_ACU, restoreTableCheckpointToLatestAi_ACU } from '../../src/service/table/table-checkpoint-transfer';

describe('cp-07: Checkpoint 真实存储跨模式恢复', () => {
  const tableData: TableDataObject_ACU = { mate: { type: 'acu', version: 1 } as any, sheet_3NoMc1wI: { uid: 'chronicle', name: '纪要表', content: [['row_id', 'content'], ['1', '铁剑']], sourceData: { ddl: 'CREATE TABLE chronicle (row_id INTEGER PRIMARY KEY, content TEXT)' }, updateConfig: {}, exportConfig: {}, orderNo: 0 } as any };
  const checkpoint = (sourceStorageMode: 'native' | 'sqlite') => ({ format: 'acu-table-checkpoint', version: 1, createdAt: 1, source: { storageMode: sourceStorageMode }, tableSnapshot: tableData, templateSnapshot: { data: tableData, presetName: '测试预设' }, guideSnapshot: { data: tableData }, integrity: { algorithm: 'fnv1a', payloadHash: 'hash' } } as any);
  const setHeterogeneousTarget = async () => {
    const target = { mate: { type: 'acu', version: 1 }, sheet_target: { uid: 'target', name: '目标旧表', content: [['row_id', 'old', 'extra'], ['1', '旧值', 'x']], sourceData: { ddl: 'CREATE TABLE target (row_id INTEGER PRIMARY KEY, old TEXT, extra TEXT)' }, updateConfig: {}, exportConfig: {}, orderNo: 0 } };
    await h.provider.replaceAllData(target);
    h.data = target;
    h.guide = target;
    h.scope = { mode: 'chat_override', templateStr: JSON.stringify(target) };
  };

  beforeEach(() => { h.chat = [{ is_user: true }, { is_user: false }]; h.data = null; h.scope = null; h.guide = null; h.sqliteMode = false; h.persistedTableData = null; h.provider = new NativeTableServiceAdapter(); });

  it('native → native：来源与目标均为原生 provider 时保留完整 Checkpoint 快照', async () => {
    await setHeterogeneousTarget();
    const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint('native'));
    expect(result).toMatchObject({ success: true, postCondition: { runtimeMatches: true, scopeIsChatOverride: true, templateMatches: true, guideMatches: true, providerMode: 'native' } });
    expect(h.provider).toBeInstanceOf(NativeTableServiceAdapter);
    expect(h.provider.getCurrentData()).toEqual(tableData);
  });

  it('native → sqlite：目标 SQLite provider 以真实 sql.js 重建持久化快照', async () => {
    h.sqliteMode = true;
    h.provider = new SqlTableService();
    await setHeterogeneousTarget();
    const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint('native'));
    expect(result).toMatchObject({ success: true, postCondition: { runtimeMatches: true, scopeIsChatOverride: true, templateMatches: true, guideMatches: true, providerMode: 'sqlite' } });
    expect(h.provider).toBeInstanceOf(SqlTableService);
    expect(h.provider.isReady()).toBe(true);
    h.provider.dispose();
  });

  it('sqlite → native：来源元数据不改变真实 native 目标运行时', async () => {
    await setHeterogeneousTarget();
    const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint('sqlite'));
    expect(result).toMatchObject({ success: true, postCondition: { runtimeMatches: true, scopeIsChatOverride: true, templateMatches: true, guideMatches: true, providerMode: 'native' } });
    expect(h.provider).toBeInstanceOf(NativeTableServiceAdapter);
  });

  it('sqlite → sqlite：来源与目标均为 SQLite 时重建真实 SQL runtime', async () => {
    h.sqliteMode = true;
    h.provider = new SqlTableService();
    await setHeterogeneousTarget();
    const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint('sqlite'));
    expect(result).toMatchObject({ success: true, postCondition: { runtimeMatches: true, scopeIsChatOverride: true, templateMatches: true, guideMatches: true, providerMode: 'sqlite' } });
    expect(h.provider).toBeInstanceOf(SqlTableService);
    expect(h.provider.isReady()).toBe(true);
    expect(h.provider.getCurrentData()).toEqual(tableData);
    h.provider.dispose();
  });

  it('修复 sheet_3NoMc1wI 历史尾标记后可导出并再次恢复，列宽不漂移', async () => {
    const legacyTable = { ...tableData, sheet_3NoMc1wI: { ...tableData.sheet_3NoMc1wI, content: [['row_id', 'content'], ['1', '旧纪要', 'auto_merged']] } } as any;
    const legacyCheckpoint = { ...checkpoint('native'), tableSnapshot: legacyTable, templateSnapshot: { data: legacyTable, presetName: '旧预设' }, guideSnapshot: { data: legacyTable } };
    const parsed = parseTableCheckpointFile_ACU(JSON.stringify(legacyCheckpoint));
    expect(parsed).toMatchObject({ success: true });
    if (!parsed.success) throw new Error(parsed.error);

    await expect(restoreTableCheckpointToLatestAi_ACU(parsed.checkpoint)).resolves.toMatchObject({ success: true });
    h.data = parsed.checkpoint.templateSnapshot.data;
    h.guide = parsed.checkpoint.guideSnapshot.data;
    const reExported = buildCurrentTableCheckpoint_ACU();

    expect(reExported.tableSnapshot.sheet_3NoMc1wI.content[1]).toHaveLength(2);
    expect(parseTableCheckpointFile_ACU(JSON.stringify(reExported))).toMatchObject({ success: true });
    await expect(restoreTableCheckpointToLatestAi_ACU(reExported)).resolves.toMatchObject({ success: true });
  });
});