/**
 * tests/service/table/table-service.test.ts
 * 表格数据操作 service 层 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logWarn_ACU } from '../../../src/shared/utils';

const {
  mockSettings,
  mockCurrentJsonTableDataRef,
  mockGetCurrentIsolationKey,
  mockSetCurrentJsonTableData,
  mockGetChatArray,
  mockSaveChatToHost,
  mockParseTableTemplateJson,
  mockApplyTemplateScopeForCurrentChat,
  mockGetChatSheetGuideData,
  mockSetChatSheetGuideData,
  mockBuildChatSheetGuideData,
  mockGetSortedSheetKeys,
  mockSanitizeSheetForStorage,
  mockAttachSeedRows,
  mockEnsureChatSheetGuideSeeded,
  mockDeleteAllGeneratedEntries,
  mockMergeAllIndependentTables,
  mockCloneIsolatedData,
  mockWriteIsolatedTagData,
  mockWriteMessageIdentity,
  mockReadIsolatedTagData,
  mockReadLegacyIndependentData,
  mockIsLegacyMatchForIsolation,
  mockResolveTableStorageStrategy,
  mockPersistTableMutationLogV2,
  mockMigrateLegacyStorage,
  mockEnsureStableRowIdsForSheetContent,
} = vi.hoisted(() => {
  const mockCurrentJsonTableDataRef = {
    value: {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
      sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
    } as any,
  };
  return {
    mockSettings: {
      dataIsolationEnabled: false,
      dataIsolationCode: '',
    } as any,
    mockCurrentJsonTableDataRef,
    mockGetCurrentIsolationKey: vi.fn(() => ''),
    mockSetCurrentJsonTableData: vi.fn((value: any) => { mockCurrentJsonTableDataRef.value = value; }),
    mockGetChatArray: vi.fn(),
    mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
    mockParseTableTemplateJson: vi.fn(),
    mockApplyTemplateScopeForCurrentChat: vi.fn(),
    mockGetChatSheetGuideData: vi.fn(() => null),
    mockSetChatSheetGuideData: vi.fn(),
    mockBuildChatSheetGuideData: vi.fn(() => null),
    mockGetSortedSheetKeys: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
    mockSanitizeSheetForStorage: vi.fn((sheet: any) => sheet),
    mockAttachSeedRows: vi.fn(),
    mockEnsureChatSheetGuideSeeded: vi.fn().mockResolvedValue(null),
    mockDeleteAllGeneratedEntries: vi.fn().mockResolvedValue(undefined),
    mockMergeAllIndependentTables: vi.fn(),
    mockCloneIsolatedData: vi.fn(() => ({})),
    mockWriteIsolatedTagData: vi.fn(),
    mockWriteMessageIdentity: vi.fn(),
    mockReadIsolatedTagData: vi.fn(() => null),
    mockReadLegacyIndependentData: vi.fn(() => null),
    mockEnsureStableRowIdsForSheetContent: vi.fn((content: any) => {
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
        if (row.length === 0) return [value];
        row[0] = value;
        return row;
      })];
    }),
    mockIsLegacyMatchForIsolation: vi.fn(() => false),
    mockResolveTableStorageStrategy: vi.fn(() => ({ mode: 'empty' })),
    mockPersistTableMutationLogV2: vi.fn(async () => ({ saved: true, messageIndex: 0 })),
    mockMigrateLegacyStorage: vi.fn(),
  };
});

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: mockParseTableTemplateJson,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  currentChatFileIdentifier_ACU: 'test-chat',
  settings_ACU: mockSettings,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: mockApplyTemplateScopeForCurrentChat,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  attachSeedRowsToCurrentDataFromGuide_ACU: mockAttachSeedRows,
  buildChatSheetGuideDataFromData_ACU: mockBuildChatSheetGuideData,
  ensureChatSheetGuideSeeded_ACU: mockEnsureChatSheetGuideSeeded,
  getChatSheetGuideDataForIsolationKey_ACU: mockGetChatSheetGuideData,
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
  ensureStableRowIdsForSheetContent_ACU: mockEnsureStableRowIdsForSheetContent,
  sanitizeSheetForStorage_ACU: mockSanitizeSheetForStorage,
  setChatSheetGuideDataForIsolationKey_ACU: mockSetChatSheetGuideData,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: mockDeleteAllGeneratedEntries,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  mergeAllIndependentTables_ACU: mockMergeAllIndependentTables,
  mergeAllIndependentTablesLegacyV1_ACU: mockMergeAllIndependentTables,
  consumeLastMergeSourceInventory_ACU: vi.fn(() => new Map<string, string>()),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: mockCloneIsolatedData,
  writeIsolatedTagData_ACU: mockWriteIsolatedTagData,
  writeMessageIdentity_ACU: mockWriteMessageIdentity,
  readIsolatedTagData_ACU: mockReadIsolatedTagData,
  readLegacyIndependentData_ACU: mockReadLegacyIndependentData,
  isLegacyMatchForIsolation_ACU: mockIsLegacyMatchForIsolation,
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: vi.fn(() => false),
  resolveTableStorageStrategy_ACU: mockResolveTableStorageStrategy,
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  persistTableMutationLogV2_ACU: mockPersistTableMutationLogV2,
}));

vi.mock('../../../src/service/table/storage-v2-migration', () => ({
  migrateLegacyStorageToV2OnLoad_ACU: mockMigrateLegacyStorage,
}));

import {
  saveIndependentTableToChatHistory_ACU,
  persistTablesToChatMessage_ACU,
  checkIfFirstTimeInit_ACU,
  loadOrCreateJsonTableFromChatHistory_ACU,
  ensureLegacyStorageMigratedBeforeWrite_ACU,
} from '../../../src/service/table/table-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentJsonTableDataRef.value = {
    sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
  };
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockCloneIsolatedData.mockReturnValue({});
  mockReadIsolatedTagData.mockReturnValue({ independentData: {}, modifiedKeys: [], updateGroupKeys: [], _acu_storage_mode: 'checkpoint', _acu_storage_version: 1 });
  mockGetChatSheetGuideData.mockReturnValue(null);
  mockSaveChatToHost.mockResolvedValue(undefined);
  mockResolveTableStorageStrategy.mockReturnValue({ mode: 'empty' });
  mockPersistTableMutationLogV2.mockResolvedValue({ saved: true, messageIndex: 0 });
  mockMigrateLegacyStorage.mockReset();
});

function makeTestTransactionContext_ACU(): any {
  return {
    transactionId: 'tx-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: 'system',
    baseRevision: null,
    writeSet: [{ kind: 'all' }],
    runCommit: async (task: any) => task(),
  };
}

function persistTablesForTest(options: any = {}) {
  return persistTablesToChatMessage_ACU({
    assumeCommitLock: true,
    transactionContext: makeTestTransactionContext_ACU(),
    ...options,
  });
}

function saveIndependentForTest(
  targetMessageIndex = -1,
  targetSheetKeys: string[] | null = null,
  updateGroupKeys: string[] | null = null,
  _skipPostRefresh = false,
  trackingSheetKeys: string[] | null = targetSheetKeys,
) {
  return persistTablesForTest({
    targetMessageIndex,
    targetSheetKeys,
    updateGroupKeys,
    trackingSheetKeys,
    trackAsUpdate: true,
  });
}

describe('direct persistence guards', () => {
  it('旧兼容入口直接调用被拒绝', async () => {
    const result = await saveIndependentTableToChatHistory_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('commit model');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('底层持久化未带公共提交锁时被拒绝', async () => {
    const result = await persistTablesToChatMessage_ACU();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('commit model');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('empty 策略的首次真实写入自动下发 init checkpoint 参数', async () => {
    const message = { is_user: false, mes: 'AI 回复' };
    mockGetChatArray.mockReturnValue([message]);
    const transactionContext = makeTestTransactionContext_ACU();

    const result = await persistTablesToChatMessage_ACU({
      assumeCommitLock: true,
      transactionContext,
      targetMessageIndex: 0,
      tableData: mockCurrentJsonTableDataRef.value,
      source: 'manual_fill',
      filledSheetKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: mockCurrentJsonTableDataRef.value.sheet_0, reason: 'system' }],
    });

    expect(result).toEqual({ saved: true, messageIndex: 0, error: undefined });
    expect(mockResolveTableStorageStrategy).toHaveBeenCalledWith([message], '', { enabled: false, code: '' });
    expect(mockPersistTableMutationLogV2).toHaveBeenCalledWith(expect.objectContaining({
      afterData: mockCurrentJsonTableDataRef.value,
      forceCheckpoint: true,
      checkpointReason: 'init',
      operations: [],
      transactionContext,
    }));
  });

  it('empty 策略的 import 恢复保留 data_replace，不伪装成 init 填表', async () => {
    const message = { is_user: false, mes: 'AI 回复' };
    mockGetChatArray.mockReturnValue([message]);
    const transactionContext = makeTestTransactionContext_ACU();
    const tableData = mockCurrentJsonTableDataRef.value;
    const operations = [{ kind: 'data_replace', data: tableData, reason: 'checkpoint_fallback' }];

    const result = await persistTablesToChatMessage_ACU({
      assumeCommitLock: true,
      transactionContext,
      targetMessageIndex: 0,
      tableData,
      source: 'import',
      checkpointReason: 'import',
      trackAsUpdate: false,
      trackingSheetKeys: ['sheet_0', 'sheet_1'],
      operations,
    });

    expect(result).toEqual({ saved: true, messageIndex: 0, error: undefined });
    expect(mockPersistTableMutationLogV2).toHaveBeenCalledWith(expect.objectContaining({
      source: 'import',
      afterData: tableData,
      forceCheckpoint: false,
      checkpointReason: 'import',
      operations,
      filledSheetKeys: [],
      transactionContext,
    }));
  });
});

describe('ensureLegacyStorageMigratedBeforeWrite_ACU', () => {
  it('迁移成功后使用修复候选数据替换 runtime 状态', async () => {
    const legacyData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], [' 1 ', '原始旧数据']] },
    };
    const repairedData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '修复候选数据']] },
    };
    const chat = [{ is_user: false, mes: 'AI 回复' }];
    mockGetChatArray.mockReturnValue(chat);
    mockMergeAllIndependentTables.mockResolvedValue(legacyData);
    mockResolveTableStorageStrategy
      .mockReturnValueOnce({ mode: 'legacy-v1', reason: 'legacy-data' })
      .mockReturnValueOnce({ mode: 'v2' });
    mockMigrateLegacyStorage.mockResolvedValue({ migrated: true, data: repairedData });

    const result = await ensureLegacyStorageMigratedBeforeWrite_ACU('test');

    expect(result).toEqual({ success: true, migrated: true, data: repairedData });
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(repairedData);
  });

  it('mixed storage strategy 的 warning 会写入 migration gate 日志', async () => {
    const legacyData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '旧数据']] },
    };
    const repairedData = structuredClone(legacyData);
    mockGetChatArray.mockReturnValue([{ is_user: false, mes: 'AI 回复' }]);
    mockMergeAllIndependentTables.mockResolvedValue(legacyData);
    mockResolveTableStorageStrategy
      .mockReturnValueOnce({ mode: 'legacy-v1', reason: 'legacy-data', warning: 'mixed legacy-v1 and v2 data detected; legacy-v1 wins' })
      .mockReturnValueOnce({ mode: 'v2' });
    mockMigrateLegacyStorage.mockResolvedValue({ migrated: true, data: repairedData });

    await expect(ensureLegacyStorageMigratedBeforeWrite_ACU('mixed-test')).resolves.toEqual({ success: true, migrated: true, data: repairedData });

    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('warning=mixed legacy-v1 and v2 data detected; legacy-v1 wins'));
  });

  it('迁移伪成功但缺少候选数据时拒绝继续并保留 runtime 状态', async () => {
    const runtimeBefore = mockCurrentJsonTableDataRef.value;
    mockGetChatArray.mockReturnValue([{ is_user: false, mes: 'AI 回复' }]);
    mockMergeAllIndependentTables.mockResolvedValue({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '旧数据']] },
    });
    mockResolveTableStorageStrategy.mockReturnValue({ mode: 'legacy-v1', reason: 'legacy-data' });
    mockMigrateLegacyStorage.mockResolvedValue({ migrated: true });

    const result = await ensureLegacyStorageMigratedBeforeWrite_ACU('test');

    expect(result).toEqual({ success: false, error: '旧存储迁移到 V2 失败: 迁移成功结果缺少修复后的表格数据。' });
    expect(mockSetCurrentJsonTableData).not.toHaveBeenCalled();
    expect(mockCurrentJsonTableDataRef.value).toBe(runtimeBefore);
  });
});

// ═══ persistTablesToChatMessage_ACU under commit model ═══
describe.skip('saveIndependentTableToChatHistory_ACU（旧 V1 兼容写入断言，V2 迁移后废弃）', () => {
  it('currentJsonTableData 为 null 时返回 saved=false', async () => {
    mockCurrentJsonTableDataRef.value = null;
    const result = await saveIndependentForTest();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('null');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('传入显式 tableData 时保存内容优先使用显式数据而不是全局数据', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: [], updateGroupKeys: [] },
    });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '全局表', content: [['row_id', '物品名'], ['1', '全局铁剑']] },
    };
    const explicitTableData = {
      sheet_0: { name: '显式表', content: [['row_id', '物品名'], ['1', '显式铁剑']] },
    } as any;

    const result = await persistTablesForTest({ tableData: explicitTableData });

    expect(result.saved).toBe(true);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.independentData.sheet_0.content[1][1]).toBe('显式铁剑');
    expect(writtenTagData.independentData.sheet_0.name).toBe('显式表');
  });

  it('落盘前会稳定化目标 sheet 的 row_id', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: [], updateGroupKeys: [] },
    });

    const explicitTableData = {
      sheet_0: {
        name: '显式表',
        content: [['row_id', '物品名'], [null, '苹果'], ['', '梨子']],
      },
    } as any;

    const result = await persistTablesForTest({ tableData: explicitTableData });

    expect(result.saved).toBe(true);
    expect(mockEnsureStableRowIdsForSheetContent).toHaveBeenCalledTimes(1);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.independentData.sheet_0.content).toEqual([['row_id', '物品名'], ['1', '苹果'], ['2', '梨子']]);
    expect(explicitTableData.sheet_0.content).toEqual([['row_id', '物品名'], [null, '苹果'], ['', '梨子']]);
  });

  it('显式传入 tableData:null 时不回退全局数据，直接返回失败', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '全局表', content: [['row_id', '物品名'], ['1', '全局铁剑']] },
    };

    const result = await persistTablesForTest({ tableData: null });

    expect(result.saved).toBe(false);
    expect(result.error).toContain('null');
    expect(mockWriteIsolatedTagData).not.toHaveBeenCalled();
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('聊天记录为空时返回 saved=false', async () => {
    mockGetChatArray.mockReturnValue([]);
    const result = await saveIndependentForTest();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('无 AI 消息时返回 saved=false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    const result = await saveIndependentForTest();
    expect(result.saved).toBe(false);
    expect(result.error).toContain('no AI message');
  });

  it('正常保存到最后一条 AI 消息，写入隔离数据', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
      aiMsg,
    ]);

    const result = await saveIndependentForTest();

    expect(result.saved).toBe(true);
    expect(result.messageIndex).toBe(1);
    // 验证隔离数据写入
    expect(mockWriteIsolatedTagData).toHaveBeenCalledTimes(1);
    expect(mockWriteMessageIdentity).toHaveBeenCalledTimes(1);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('指定 targetMessageIndex 时保存到指定 AI 消息', async () => {
    const aiMsg0: any = { is_user: false, mes: 'AI回复0' };
    const aiMsg1: any = { is_user: false, mes: 'AI回复1' };
    mockGetChatArray.mockReturnValue([aiMsg0, { is_user: true }, aiMsg1]);

    const result = await saveIndependentForTest(0);

    expect(result.saved).toBe(true);
    expect(result.messageIndex).toBe(0);
  });

  it('指定 targetSheetKeys 时只保存部分表，并记录 modifiedKeys', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: ['sheet_0'], updateGroupKeys: [] },
    });

    const result = await saveIndependentForTest(-1, ['sheet_1'], ['sheet_1']);

    expect(result.saved).toBe(true);
    // writeIsolatedTagData 应被调用，且 tagData 中 modifiedKeys 包含 sheet_1
    expect(mockWriteIsolatedTagData).toHaveBeenCalledTimes(1);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.modifiedKeys).toContain('sheet_0');
    expect(writtenTagData.modifiedKeys).toContain('sheet_1');
    expect(writtenTagData.updateGroupKeys).toContain('sheet_1');
  });

  it('仅 trackingSheetKeys 且不保存任何表时，仍写入 tracking metadata', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: [], updateGroupKeys: [] },
    });

    const result = await persistTablesForTest({
      targetMessageIndex: 0,
      targetSheetKeys: [],
      trackingSheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0', 'sheet_missing'],
      trackAsUpdate: true,
    });

    expect(result.saved).toBe(true);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.modifiedKeys).toEqual(['sheet_0']);
    expect(writtenTagData.updateGroupKeys).toEqual(['sheet_0']);
    expect(writtenTagData.independentData).toEqual({});
  });

  it('真实保存表与仅追踪表混合时，仍记录全部 tracking metadata', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: [], updateGroupKeys: [] },
    });

    const result = await persistTablesForTest({
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_1'],
      trackingSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: ['sheet_0', 'sheet_1'],
    });

    expect(result.saved).toBe(true);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.modifiedKeys).toEqual(expect.arrayContaining(['sheet_0', 'sheet_1']));
    expect(writtenTagData.updateGroupKeys).toEqual(expect.arrayContaining(['sheet_0', 'sheet_1']));
  });

  it('同一目标楼层连续保存不同 group 时保留已有表、modifiedKeys 与 updateGroupKeys', async () => {
    const aiMsg: any = { is_user: false, mes: 'AI回复' };
    mockGetChatArray.mockReturnValue([aiMsg]);
    mockCurrentJsonTableDataRef.value = {
      sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['2', '后写组']] },
    };
    mockCloneIsolatedData.mockReturnValue({
      '': {
        independentData: {
          sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '先写组']] },
        },
        incrementalData: {},
        modifiedKeys: ['sheet_0'],
        updateGroupKeys: ['sheet_0'],
        _acu_storage_mode: 'delta',
        _acu_storage_version: 1,
      },
    });

    const result = await saveIndependentForTest(0, ['sheet_1'], ['sheet_1']);

    expect(result.saved).toBe(true);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData.independentData.sheet_0.content[1][1]).toBe('先写组');
    expect(writtenTagData.independentData.sheet_1.content[1][1]).toBe('后写组');
    expect(writtenTagData.modifiedKeys).toEqual(expect.arrayContaining(['sheet_0', 'sheet_1']));
    expect(writtenTagData.updateGroupKeys).toEqual(expect.arrayContaining(['sheet_0', 'sheet_1']));
  });

  it('上一楼层 base 缺失 row_id 时仍会稳定化 base 副本并继续写成 delta', async () => {
    const prevAiMsg: any = { is_user: false, mes: 'AI回复0' };
    const targetAiMsg: any = { is_user: false, mes: 'AI回复1' };
    mockGetChatArray.mockReturnValue([prevAiMsg, targetAiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: [], updateGroupKeys: [] },
    });
    mockReadIsolatedTagData.mockImplementation((message: any) => {
      if (message === prevAiMsg) {
        return {
          independentData: {
            sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['', '旧苹果'], [null, '旧梨子']] },
          },
          modifiedKeys: ['sheet_0'],
          updateGroupKeys: [],
          _acu_storage_mode: 'checkpoint',
        };
      }
      return null;
    });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '新苹果'], ['2', '新梨子']] },
    };

    const result = await persistTablesForTest({ targetMessageIndex: 1 });

    expect(result.saved).toBe(true);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData._acu_storage_mode).toBe('delta');
    expect(writtenTagData.independentData).toEqual({});
    expect(writtenTagData.incrementalData.sheet_0).toBeDefined();
    expect(mockEnsureStableRowIdsForSheetContent).toHaveBeenCalledWith([['row_id', '物品名'], ['', '旧苹果'], [null, '旧梨子']]);
    const baseWarnings = vi.mocked(logWarn_ACU).mock.calls.filter(call => String(call[0]).includes('base 缺少稳定 row_id'));
    expect(baseWarnings).toHaveLength(0);
  });

  it('上一楼层 base 存在重复 row_id 时仍会稳定化 base 副本并继续写成 delta', async () => {
    const prevAiMsg: any = { is_user: false, mes: 'AI回复0' };
    const targetAiMsg: any = { is_user: false, mes: 'AI回复1' };
    mockGetChatArray.mockReturnValue([prevAiMsg, targetAiMsg]);
    mockCloneIsolatedData.mockReturnValue({
      '': { independentData: {}, modifiedKeys: [], updateGroupKeys: [] },
    });
    mockReadIsolatedTagData.mockImplementation((message: any) => {
      if (message === prevAiMsg) {
        return {
          independentData: {
            sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['dup', '旧苹果'], ['dup', '旧梨子']] },
          },
          modifiedKeys: ['sheet_0'],
          updateGroupKeys: [],
          _acu_storage_mode: 'checkpoint',
        };
      }
      return null;
    });
    mockCurrentJsonTableDataRef.value = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['dup', '新苹果'], ['1', '新梨子']] },
    };

    const result = await persistTablesForTest({ targetMessageIndex: 1 });

    expect(result.saved).toBe(true);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData._acu_storage_mode).toBe('delta');
    expect(writtenTagData.incrementalData.sheet_0).toBeDefined();
    expect(mockEnsureStableRowIdsForSheetContent).toHaveBeenCalledWith([['row_id', '物品名'], ['dup', '旧苹果'], ['dup', '旧梨子']]);
    const baseWarnings = vi.mocked(logWarn_ACU).mock.calls.filter(call => String(call[0]).includes('base 缺少稳定 row_id'));
    expect(baseWarnings).toHaveLength(0);
  });

  it.skip('废弃 V1 写入：当前目标楼层已是 delta tag 时会先重建并稳定化既有 base，再保留先前增量表', async () => {
    const prevAiMsg: any = { is_user: false, mes: 'AI回复0' };
    const targetAiMsg: any = { is_user: false, mes: 'AI回复1' };
    mockGetChatArray.mockReturnValue([prevAiMsg, targetAiMsg]);
    mockReadIsolatedTagData.mockImplementation((message: any) => {
      if (message === prevAiMsg) {
        return {
          independentData: {
            sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['', '旧苹果'], ['', '旧梨子']] },
            sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '旧事件']] },
          },
          modifiedKeys: ['sheet_0', 'sheet_1'],
          updateGroupKeys: ['sheet_0', 'sheet_1'],
          _acu_storage_mode: 'checkpoint',
        };
      }
      return null;
    });
    mockCloneIsolatedData.mockReturnValue({
      '': {
        independentData: {},
        incrementalData: {
          sheet_0: { sheetUid: 'sheet_0', rowDeltas: [{ row_id: '1', op: 'upsert', cells: ['1', '新苹果'] }] },
        },
        modifiedKeys: ['sheet_0'],
        updateGroupKeys: ['sheet_0'],
        _acu_storage_mode: 'delta',
        _acu_storage_version: 1,
      },
    });
    mockCurrentJsonTableDataRef.value = {
      sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '新事件']] },
    };

    const result = await saveIndependentForTest(1, ['sheet_1'], ['sheet_1'], false, ['sheet_1']);

    expect(result.saved).toBe(true);
    const writtenTagData = mockWriteIsolatedTagData.mock.calls[0][2];
    expect(writtenTagData._acu_storage_mode).toBe('delta');
    expect(writtenTagData.incrementalData.sheet_0).toBeDefined();
    expect(writtenTagData.incrementalData.sheet_1).toBeDefined();
    const baseWarnings = vi.mocked(logWarn_ACU).mock.calls.filter(call => String(call[0]).includes('base 缺少稳定 row_id'));
    expect(baseWarnings).toHaveLength(0);
  });
});

// ═══ checkIfFirstTimeInit_ACU ═══
describe('checkIfFirstTimeInit_ACU', () => {
  it('空聊天记录返回 true', async () => {
    mockGetChatArray.mockReturnValue([]);
    expect(await checkIfFirstTimeInit_ACU()).toBe(true);
  });

  it('有隔离数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue({
      independentData: { sheet_0: { name: '表', content: [] } },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('有 legacy 数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue(null);
    mockIsLegacyMatchForIsolation.mockReturnValue(true);
    mockReadLegacyIndependentData.mockReturnValue({
      sheet_0: { name: '表', content: [] },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('有 V2 checkpoint 数据的 AI 消息返回 false', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockReadIsolatedTagData.mockReturnValue({
      _acu_storage_version: 2,
      storageFrame: {
        version: 2,
        checkpoint: {
          kind: 'full',
          data: { mate: {}, sheet_0: { name: '表', content: [['row_id']] } },
        },
        logEntries: [],
      },
    });
    expect(await checkIfFirstTimeInit_ACU()).toBe(false);
  });

  it('只有用户消息时返回 true', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '用户消息' },
    ]);
    expect(await checkIfFirstTimeInit_ACU()).toBe(true);
  });
});

// ═══ loadOrCreateJsonTableFromChatHistory_ACU ═══
describe('loadOrCreateJsonTableFromChatHistory_ACU', () => {
  it('空聊天记录时触发初始化，返回 source=initialized', async () => {
    mockGetChatArray.mockReturnValue([]);
    mockParseTableTemplateJson.mockReturnValue({
      sheet_0: { name: '默认表', content: [['row_id', '列1']] },
    });
    // initializeJsonTableInChatHistory 内部会调用 _set_currentJsonTableData_ACU
    // 然后检查 currentJsonTableData_ACU 是否为 null
    // 由于 mockSetCurrentJsonTableData 会更新 mockCurrentJsonTableDataRef.value
    // 所以 parseTableTemplateJson 返回非 null 时，initialized=true

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('initialized');
    expect(result.loaded).toBe(true);
    expect(mockApplyTemplateScopeForCurrentChat).toHaveBeenCalledTimes(1);
    expect(mockDeleteAllGeneratedEntries).toHaveBeenCalledTimes(1);
  });

  it('有合并数据时返回 source=merged', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    const mergedData = {
      sheet_0: { name: '合并表', content: [['row_id', '列1'], ['1', '值1']] },
    };
    mockMergeAllIndependentTables.mockResolvedValue(mergedData);

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('merged');
    expect(result.loaded).toBe(true);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(mergedData);
  });

  it('无合并数据时触发初始化', async () => {
    mockGetChatArray.mockReturnValue([
      { is_user: false, mes: 'AI回复' },
    ]);
    mockMergeAllIndependentTables.mockResolvedValue(null);
    mockParseTableTemplateJson.mockReturnValue({
      sheet_0: { name: '默认表', content: [['row_id', '列1']] },
    });

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.source).toBe('initialized');
    expect(result.loaded).toBe(true);
  });

  it('模板解析失败时返回 loaded=false', async () => {
    mockGetChatArray.mockReturnValue([]);
    mockParseTableTemplateJson.mockImplementation(() => { throw new Error('模板格式错误'); });

    const result = await loadOrCreateJsonTableFromChatHistory_ACU();

    expect(result.loaded).toBe(false);
    expect(result.error).toBeDefined();
  });
});