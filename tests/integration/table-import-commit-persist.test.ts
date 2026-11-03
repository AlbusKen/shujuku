import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  runtime: { value: null as any },
  provider: { replaceAllData: vi.fn(), getCurrentData: vi.fn() },
  strictSave: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: vi.fn().mockResolvedValue(undefined),
  saveChatToHostStrict_ACU: h.strictSave,
}));
vi.mock('../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => h.chat }));
vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.runtime.value; },
  _set_currentJsonTableData_ACU: vi.fn((value: any) => { h.runtime.value = value; }),
  currentChatFileIdentifier_ACU: 'p3-import-chain',
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '' },
  independentTableStates_ACU: {},
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: () => h.provider,
  reloadStorageProvider: vi.fn(),
}));
vi.mock('../../src/service/table/sqlite-template-validation', () => ({
  validateSqliteTemplateDataStrict_ACU: vi.fn().mockResolvedValue({ success: true }),
  hydrateTableDataStrict_ACU: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/service/template/chat-scope', () => ({
  sanitizeChatSheetsObject_ACU: (data: any) => JSON.parse(JSON.stringify(data)),
  getSortedSheetKeys_ACU: (data: any) => Object.keys(data || {}).filter(key => key.startsWith('sheet_')).sort(),
  getChatSheetGuideDataForIsolationKey_ACU: () => null,
  getCurrentChatTemplateScopeState_ACU: () => null,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: () => null,
  sanitizeTemplateSnapshotForChat_ACU: () => null,
  buildChatSheetGuideDataFromData_ACU: () => null,
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  normalizeGuideData_ACU: (data: any) => data,
  getEffectiveSeedRowsForSheet_ACU: () => [],
}));
vi.mock('../../src/service/runtime/helpers-remaining', () => ({ mergeAllIndependentTablesLegacyV1_ACU: vi.fn() }));
vi.mock('../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: (chat: unknown[]) => chat.length > 0 ? 'p3-import-chain' : '',
  getChatScopedConfigContainer_ACU: () => null, getChatSheetGuideContainer_ACU: () => null,
  setChatScopedConfigContainer_ACU: vi.fn(), setChatSheetGuideContainer_ACU: vi.fn(),
}));
vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: () => false, parseTableTemplateJson_ACU: vi.fn(),
}));

import { importTableJsonThroughCommit_ACU } from '../../src/service/table/table-import-service';

function data(value: string) {
  return { mate: { type: 'acu', version: 1 }, sheet_0: { uid: 's0', name: 'P3', sourceData: {}, content: [['row_id', 'value'], ['1', value]], updateConfig: {}, exportConfig: {}, orderNo: 0 } };
}

describe('P3 import → commit → V2 persist', () => {
  beforeEach(() => {
    h.chat.splice(0, h.chat.length, { is_user: false, mes: 'target' });
    h.runtime.value = null;
    h.strictSave.mockClear();
    h.provider.replaceAllData.mockResolvedValue({ success: true });
    h.provider.getCurrentData.mockReturnValue(null);
  });

  it('首次导入经真实 commit 写入 full/init，后续导入追加可回放的 import replace', async () => {
    const firstResult = await importTableJsonThroughCommit_ACU(JSON.stringify(data('first')));
    expect(firstResult, firstResult.error).toMatchObject({ success: true, persisted: true });
    const firstFrame = h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(firstFrame).toMatchObject({ checkpoint: { kind: 'full', reason: 'init', data: data('first') }, logEntries: [] });

    expect(await importTableJsonThroughCommit_ACU(JSON.stringify(data('second')))).toMatchObject({ success: true, persisted: true });
    const secondFrame = h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(secondFrame.logEntries).toHaveLength(1);
    expect(secondFrame.logEntries[0]).toMatchObject({ source: 'import', operations: [{ kind: 'data_replace', reason: 'import', data: data('second') }] });
    expect(h.strictSave).toHaveBeenCalledTimes(2);
  });

  it('首次导入只有业务表头的空模板时，持久化 canonical 表头且不制造数据行', async () => {
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 's0', name: 'P3', sourceData: {}, content: [['value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    };

    const result = await importTableJsonThroughCommit_ACU(JSON.stringify(template));
    expect(result, result.error).toMatchObject({ success: true, persisted: true });

    const checkpointData = h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    expect(checkpointData.sheet_0.content).toEqual([['row_id', 'value']]);
    expect(h.provider.replaceAllData).toHaveBeenCalledWith(expect.objectContaining({
      sheet_0: expect.objectContaining({ content: [['row_id', 'value']] }),
    }));
  });
});
