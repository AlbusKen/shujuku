
/**
 * tests/service/worldbook/injection-engine-state.test.ts
 * 世界书注入引擎状态管理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings, mockCurrentChatFileIdentifier, mockCurrentJsonTableData,
  mockGenerationGate, mockSetCurrentChatFileIdentifier, mockSetAllChatMessages,
  mockSetCurrentJsonTableData, mockSetIndependentTableStates, mockSetLastTotalAiMessages,
  mockGetCurrentWorldbookConfig,
  mockGetLorebookEntries, mockDeleteLorebookEntries, mockGwGetCurrentCharPrimaryLorebook, mockGetCurrentCharacterWorldbookBinding,
  mockGetChatArray, mockSaveChatToHost,
  mockApplyTemplateScopeForCurrentChat, mockLoadSettings, mockSaveSettings,
  mockResetPlotWorldbookSelectionForChatChange,
  mockGetSortedSheetKeys,
  mockLoadAllChatMessages,
  mockCleanChatName, mockGetChatFirstLayerMessage, mockLogDebug, mockLogError, mockLogWarn,
  mockLoadOrCreateJsonTableFromChatHistory,
  mockPurgeSheetKeysFromMessage,
  mockRunTableWriteTransaction,
  mockCHAT_SHEET_GUIDE_FIELD,
  mockListLorebooks,
  mockResolveLorebookNameFromList,
  mockResetPlotAgentWorldbookSessionSnapshot,
} = vi.hoisted(() => ({
  mockSettings: {
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    knownCustomEntryNames: [] as string[],
  } as any,
  mockCurrentChatFileIdentifier: { value: 'test-chat' },
  mockCurrentJsonTableData: { value: null as any },
  mockGenerationGate: {
    lastUserMessageId: null as any,
    lastUserMessageText: '',
    lastUserMessageAt: 0,
    lastUserSendIntentAt: 0,
    lastGeneration: null as any,
  },
  mockSetCurrentChatFileIdentifier: vi.fn(),
  mockSetAllChatMessages: vi.fn(),
  mockSetCurrentJsonTableData: vi.fn(),
  mockSetIndependentTableStates: vi.fn(),
  mockSetLastTotalAiMessages: vi.fn(),
  mockGetCurrentWorldbookConfig: vi.fn(() => ({
    injectionTarget: 'character',
  })),
  mockGetLorebookEntries: vi.fn(async () => []),
  mockDeleteLorebookEntries: vi.fn(async () => {}),
  mockGwGetCurrentCharPrimaryLorebook: vi.fn(async () => 'primary-lorebook'),
  mockGetCurrentCharacterWorldbookBinding: vi.fn(async () => ({
    primary: '角色世界书',
    additional: [],
    orderedNames: ['角色世界书'],
    apiSource: 'getCharWorldbookNames',
  })),
  mockListLorebooks: vi.fn(async () => ['角色世界书', '自定义世界书']),
  mockGetChatArray: vi.fn(() => []),
  mockSaveChatToHost: vi.fn(async () => {}),
  mockApplyTemplateScopeForCurrentChat: vi.fn(),
  mockLoadSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockResetPlotWorldbookSelectionForChatChange: vi.fn(),
  mockGetSortedSheetKeys: vi.fn(() => []),
  mockLoadAllChatMessages: vi.fn(async () => {}),
  mockCleanChatName: vi.fn((name: string) => name),
  mockGetChatFirstLayerMessage: vi.fn(() => null),
  mockLogDebug: vi.fn(),
  mockLogError: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLoadOrCreateJsonTableFromChatHistory: vi.fn(async () => {}),
  mockPurgeSheetKeysFromMessage: vi.fn(() => false),
  mockRunTableWriteTransaction: vi.fn(async (_options: any, task: any) => task({
    transactionId: 'tx-cleanup-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: _options.source,
    baseRevision: null,
    writeSet: _options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  })),
  mockCHAT_SHEET_GUIDE_FIELD: 'chatSheetGuide',
  mockResolveLorebookNameFromList: vi.fn((requestedName: unknown, bookList: unknown) => {
    const requested = String(requestedName ?? '').normalize('NFKC').replace(/[\u200B\uFEFF]/g, '').trim();
    const matches = (Array.isArray(bookList) ? bookList : []).filter(item =>
      String(item ?? '').normalize('NFKC').replace(/[\u200B\uFEFF]/g, '').trim() === requested
    );
    return matches.length === 1 ? String(matches[0]) : null;
  }),
  mockResetPlotAgentWorldbookSessionSnapshot: vi.fn(),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/data/storage/chat-history', () => ({
  CHAT_SHEET_GUIDE_FIELD_ACU: mockCHAT_SHEET_GUIDE_FIELD,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentChatFileIdentifier_ACU() { return mockCurrentChatFileIdentifier.value; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData.value; },
  get generationGate_ACU() { return mockGenerationGate; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_currentChatFileIdentifier_ACU: mockSetCurrentChatFileIdentifier,
  _set_allChatMessages_ACU: mockSetAllChatMessages,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
  _set_independentTableStates_ACU: mockSetIndependentTableStates,
  _set_lastTotalAiMessages_ACU: mockSetLastTotalAiMessages,
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: mockGetLorebookEntries,
  deleteLorebookEntries_ACU: mockDeleteLorebookEntries,
  getCurrentCharPrimaryLorebook_ACU: mockGwGetCurrentCharPrimaryLorebook,
  getCurrentCharacterWorldbookBinding_ACU: mockGetCurrentCharacterWorldbookBinding,
  listLorebooks_ACU: mockListLorebooks,
  resolveLorebookNameFromList_ACU: mockResolveLorebookNameFromList,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: mockApplyTemplateScopeForCurrentChat,
  loadSettings_ACU: mockLoadSettings,
  resetPlotWorldbookSelectionForChatChange_ACU: mockResetPlotWorldbookSelectionForChatChange,
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: mockGetSortedSheetKeys,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: mockLoadAllChatMessages,
}));

vi.mock('../../../src/shared/utils', () => ({
  cleanChatName_ACU: mockCleanChatName,
  getChatFirstLayerMessage_ACU: mockGetChatFirstLayerMessage,
  logDebug_ACU: mockLogDebug,
  logError_ACU: mockLogError,
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: mockLoadOrCreateJsonTableFromChatHistory,
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  purgeSheetKeysFromMessage_ACU: mockPurgeSheetKeysFromMessage,
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mockRunTableWriteTransaction,
}));

vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({
  resetPlotAgentWorldbookSessionSnapshot_ACU: mockResetPlotAgentWorldbookSessionSnapshot,
}));

import {
  resetScriptStateForNewChat_ACU,
  getInjectionTargetLorebook_ACU,
  getIsolationPrefix_ACU,
  purgeSheetKeysFromChatHistoryHard_ACU,
} from '../../../src/service/worldbook/injection-engine-state';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: 'character' });
  mockGwGetCurrentCharPrimaryLorebook.mockResolvedValue('primary-lorebook');
  mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
    primary: '角色世界书',
    additional: [],
    orderedNames: ['角色世界书'],
    apiSource: 'getCharWorldbookNames',
  });
  mockListLorebooks.mockResolvedValue(['角色世界书', '自定义世界书']);
  mockResolveLorebookNameFromList.mockClear();
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockSettings.knownCustomEntryNames = [];
  mockCurrentChatFileIdentifier.value = 'test-chat';
  mockCurrentJsonTableData.value = null;
  mockGenerationGate.lastUserMessageId = null;
  mockGenerationGate.lastUserMessageText = '';
  mockGenerationGate.lastUserMessageAt = 0;
  mockGenerationGate.lastUserSendIntentAt = 0;
  mockGenerationGate.lastGeneration = null;
  mockGetChatArray.mockReturnValue([]);
  mockRunTableWriteTransaction.mockImplementation(async (_options: any, task: any) => task({
    transactionId: 'tx-cleanup-test',
    chatKey: 'test-chat',
    isolationKey: '',
    source: _options.source,
    baseRevision: null,
    writeSet: _options.writeSet,
    runCommit: async (commitTask: any) => commitTask(),
  }));
});

// ═══ getIsolationPrefix_ACU ═══
describe('getIsolationPrefix_ACU', () => {
  it('隔离启用且有 code 时返回前缀', () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'test123';
    expect(getIsolationPrefix_ACU()).toBe('ACU-[test123]-');
  });

  it('隔离未启用时返回空字符串', () => {
    mockSettings.dataIsolationEnabled = false;
    mockSettings.dataIsolationCode = 'test123';
    expect(getIsolationPrefix_ACU()).toBe('');
  });

  it('隔离启用但无 code 时返回空字符串', () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = '';
    expect(getIsolationPrefix_ACU()).toBe('');
  });
});

// ═══ getInjectionTargetLorebook_ACU ═══
describe('getInjectionTargetLorebook_ACU', () => {
  it('target 为 character 时使用统一 binding resolver 的 primary', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: 'character' });
    mockGwGetCurrentCharPrimaryLorebook.mockResolvedValue('旧接口世界书');
    const result = await getInjectionTargetLorebook_ACU();
    expect(result).toBe('角色世界书');
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockGwGetCurrentCharPrimaryLorebook).not.toHaveBeenCalled();
  });

  it('target 为具体名称时直接返回', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: '自定义世界书' });
    const result = await getInjectionTargetLorebook_ACU();
    expect(result).toBe('自定义世界书');
  });

  it('配置名称含全角或不可见字符差异时返回宿主真实名称', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: 'ＡＢＣ' });
    mockListLorebooks.mockResolvedValue(['AB\u200BC']);

    const result = await getInjectionTargetLorebook_ACU();
    expect(result).toBe('AB\u200BC');
  });

  it('角色无主世界书时返回 null', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: 'character' });
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: null,
      additional: ['副书'],
      orderedNames: ['副书'],
      apiSource: 'getCharWorldbookNames',
    });
    const result = await getInjectionTargetLorebook_ACU();
    expect(result).toBeNull();
    expect(mockListLorebooks).not.toHaveBeenCalled();
  });
});

// ═══ resetScriptStateForNewChat_ACU ═══
describe('resetScriptStateForNewChat_ACU', () => {
  it('有效 chatFileName 重置状态', async () => {
    mockCleanChatName.mockReturnValue('clean-chat');
    await resetScriptStateForNewChat_ACU('new-chat.jsonl');
    expect(mockSetCurrentChatFileIdentifier).toHaveBeenCalledWith('clean-chat');
    expect(mockLoadSettings).toHaveBeenCalled();
    expect(mockResetPlotAgentWorldbookSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSetAllChatMessages).toHaveBeenCalledWith([]);
    expect(mockSetLastTotalAiMessages).toHaveBeenCalledWith(0);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(null);
    expect(mockSetIndependentTableStates).toHaveBeenCalledWith({});
    expect(mockLoadAllChatMessages).not.toHaveBeenCalled();
    expect(mockApplyTemplateScopeForCurrentChat).not.toHaveBeenCalled();
    expect(mockLoadOrCreateJsonTableFromChatHistory).not.toHaveBeenCalled();
  });

  it('真实 CHAT_CHANGED 在加载设置后重置剧情世界书选择', async () => {
    await resetScriptStateForNewChat_ACU('new-chat.jsonl', { reason: 'chat_changed' });

    expect(mockLoadSettings).toHaveBeenCalledTimes(1);
    expect(mockResetPlotWorldbookSelectionForChatChange).toHaveBeenCalledTimes(1);
    expect(mockLoadSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mockResetPlotWorldbookSelectionForChatChange.mock.invocationCallOrder[0],
    );
  });

  it('启动恢复不清空剧情世界书选择', async () => {
    await resetScriptStateForNewChat_ACU('new-chat.jsonl', { reason: 'startup_restore' });

    expect(mockResetPlotWorldbookSelectionForChatChange).not.toHaveBeenCalled();
  });

  it('重置 generationGate 状态', async () => {
    mockGenerationGate.lastUserMessageId = 5;
    mockGenerationGate.lastUserMessageText = '旧消息';
    mockGenerationGate.lastUserMessageAt = 12345;
    await resetScriptStateForNewChat_ACU('new-chat.jsonl');
    expect(mockGenerationGate.lastUserMessageId).toBeNull();
    expect(mockGenerationGate.lastUserMessageText).toBe('');
    expect(mockGenerationGate.lastUserMessageAt).toBe(0);
    expect(mockGenerationGate.lastUserSendIntentAt).toBe(0);
    expect(mockGenerationGate.lastGeneration).toBeNull();
  });

  it('无活动聊天且 chatFileName 为空时清空运行时状态', async () => {
    mockGenerationGate.lastUserMessageId = 5;
    mockGenerationGate.lastUserMessageText = '旧消息';
    mockGenerationGate.lastUserMessageAt = 12345;

    await resetScriptStateForNewChat_ACU('');

    expect(mockSetCurrentChatFileIdentifier).toHaveBeenCalledWith('');
    expect(mockResetPlotAgentWorldbookSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(null);
    expect(mockSetIndependentTableStates).toHaveBeenCalledWith({});
    expect(mockSetAllChatMessages).toHaveBeenCalledWith([]);
    expect(mockSetLastTotalAiMessages).toHaveBeenCalledWith(0);
    expect(mockGenerationGate.lastUserMessageId).toBeNull();
    expect(mockGenerationGate.lastUserMessageText).toBe('');
    expect(mockGenerationGate.lastUserMessageAt).toBe(0);
  });

  it('有聊天数组但 chatFileName 临时无效时仍忽略事件保护当前状态', async () => {
    mockGetChatArray.mockReturnValue([{ is_user: false }]);

    await resetScriptStateForNewChat_ACU(null as any);

    expect(mockSetCurrentChatFileIdentifier).not.toHaveBeenCalled();
    expect(mockSetCurrentJsonTableData).not.toHaveBeenCalled();
    expect(mockResetPlotAgentWorldbookSessionSnapshot).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('invalid chat file name'));
  });

  it('"null" 字符串且无活动聊天时清空运行时状态', async () => {
    await resetScriptStateForNewChat_ACU('null');
    expect(mockSetCurrentChatFileIdentifier).toHaveBeenCalledWith('');
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(null);
  });

  it('纯空格 chatFileName 且无活动聊天时清空运行时状态', async () => {
    await resetScriptStateForNewChat_ACU('   ');
    expect(mockSetCurrentChatFileIdentifier).toHaveBeenCalledWith('');
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith(null);
  });
});

// ═══ purgeSheetKeysFromChatHistoryHard_ACU ═══
describe('purgeSheetKeysFromChatHistoryHard_ACU', () => {
  it('删除指定 sheetKey 的数据', async () => {
    const msg = { is_user: false, someField: 'data' };
    mockGetChatArray.mockReturnValue([msg]);
    mockPurgeSheetKeysFromMessage.mockReturnValue(true);
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0']);
    expect(result.changed).toBe(true);
    expect(result.changedCount).toBe(1);
    expect(mockSaveChatToHost).toHaveBeenCalled();
  });

  it('硬删除表进入 maintenance exclusive 事务', async () => {
    const msg = { is_user: false, someField: 'data' };
    mockGetChatArray.mockReturnValue([msg]);
    mockPurgeSheetKeysFromMessage.mockReturnValue(true);
    await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0', 'sheet_1']);
    expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'system_cleanup',
      reason: 'purgeSheetKeysFromChatHistoryHard',
      maintenanceMode: 'exclusive',
      writeSet: [
        { kind: 'sheet', sheetKey: 'sheet_0' },
        { kind: 'sheet', sheetKey: 'sheet_1' },
      ],
    }), expect.any(Function));
  });

  it('空 keys 数组不做任何操作', async () => {
    const result = await purgeSheetKeysFromChatHistoryHard_ACU([]);
    expect(result.changed).toBe(false);
    expect(result.changedCount).toBe(0);
    expect(mockGetChatArray).not.toHaveBeenCalled();
  });

  it('过滤非 sheet_ 前缀的 key', async () => {
    mockGetChatArray.mockReturnValue([]);
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(['invalid_key', 'sheet_0']);
    // 只有 sheet_0 被保留
    expect(result.changed).toBe(false);
  });

  it('空聊天记录不做操作', async () => {
    mockGetChatArray.mockReturnValue([]);
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0']);
    expect(result.changed).toBe(false);
    expect(result.changedCount).toBe(0);
  });

  it('跳过用户消息', async () => {
    const userMsg = { is_user: true };
    const aiMsg = { is_user: false };
    mockGetChatArray.mockReturnValue([userMsg, aiMsg]);
    mockPurgeSheetKeysFromMessage.mockReturnValue(true);
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0']);
    // 只处理 AI 消息
    expect(mockPurgeSheetKeysFromMessage).toHaveBeenCalledTimes(1);
    expect(mockPurgeSheetKeysFromMessage).toHaveBeenCalledWith(aiMsg, ['sheet_0']);
  });

  it('无变更时不保存', async () => {
    mockGetChatArray.mockReturnValue([{ is_user: false }]);
    mockPurgeSheetKeysFromMessage.mockReturnValue(false);
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0']);
    expect(result.changed).toBe(false);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('去重 sheetKeys', async () => {
    mockGetChatArray.mockReturnValue([{ is_user: false }]);
    mockPurgeSheetKeysFromMessage.mockReturnValue(false);
    await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0', 'sheet_0', 'sheet_1']);
    // purgeSheetKeysFromMessage 应该收到去重后的 keys
    const callArgs = mockPurgeSheetKeysFromMessage.mock.calls[0][1];
    expect(new Set(callArgs).size).toBe(callArgs.length);
  });

  it('同步清理聊天第一层的指导表', async () => {
    const firstMsg = {
      [mockCHAT_SHEET_GUIDE_FIELD]: {
        tags: {
          tag1: {
            data: { sheet_0: { name: '测试' }, sheet_1: { name: '保留' } },
          },
        },
      },
    };
    mockGetChatFirstLayerMessage.mockReturnValue(firstMsg);
    mockGetChatArray.mockReturnValue([firstMsg]);
    mockPurgeSheetKeysFromMessage.mockReturnValue(false);
    const result = await purgeSheetKeysFromChatHistoryHard_ACU(['sheet_0']);
    expect(result.changed).toBe(true);
    // 验证 sheet_0 被删除
    const guide = firstMsg[mockCHAT_SHEET_GUIDE_FIELD];
    expect(guide.tags.tag1.data.sheet_0).toBeUndefined();
    expect(guide.tags.tag1.data.sheet_1).toBeDefined();
  });
});
