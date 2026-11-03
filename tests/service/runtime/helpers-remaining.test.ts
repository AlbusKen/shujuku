/**
 * tests/service/runtime/helpers-remaining.test.ts
 * 辅助函数集入口文件 单元测试（handleChatCompletionReady_ACU）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockCurrentJsonTableData,
  mockLogDebug,
  mockParseRandomTags,
  mockReplaceRandomVariables,
  mockPendingFinalGenerationGreenlightsRef,
  mockSetPendingFinalGenerationGreenlights,
  mockParseCalcTags,
  mockParseMaxTags,
  mockParseMinTags,
  mockReplaceCalcVariables,
  mockReplaceMaxVariables,
  mockReplaceMinVariables,
  mockParseIfBlockRecursive,
  mockGetLatestAIMessageContent,
  mockGetPlotFromHistory,
  mockGetWorldbookContentForPlot,
  mockGetAgentControlledWorldbookEntriesForFinalPrompt,
  mockIsWorldbookTakeoverActive,
  mockEnsureHydrated,
  mockAgentWorldbookEnabled,
  mockAgentWorldbookNativeFallback,
} = vi.hoisted(() => {
  const mockPendingFinalGenerationGreenlightsRef = { value: [] as any[] };
  return {
    mockSettings: { promptTemplateSettings: { enabled: true, maxNestingDepth: 10, debugMode: false } } as any,
    mockCurrentJsonTableData: { sheet_0: { name: '表', content: [['row_id']] } } as any,
    mockLogDebug: vi.fn(),
    mockParseRandomTags: vi.fn((s: string) => s),
    mockReplaceRandomVariables: vi.fn((s: string) => s),
    mockPendingFinalGenerationGreenlightsRef,
    mockSetPendingFinalGenerationGreenlights: vi.fn((value: any) => {
      mockPendingFinalGenerationGreenlightsRef.value = Array.isArray(value) ? value : [];
    }),
    mockParseCalcTags: vi.fn((s: string) => s),
    mockParseMaxTags: vi.fn((s: string) => s),
    mockParseMinTags: vi.fn((s: string) => s),
    mockReplaceCalcVariables: vi.fn((s: string) => s),
    mockReplaceMaxVariables: vi.fn((s: string) => s),
    mockReplaceMinVariables: vi.fn((s: string) => s),
    mockParseIfBlockRecursive: vi.fn((s: string) => s),
    mockGetLatestAIMessageContent: vi.fn(() => ''),
    mockGetPlotFromHistory: vi.fn(() => null),
    mockGetWorldbookContentForPlot: vi.fn(),
    mockGetAgentControlledWorldbookEntriesForFinalPrompt: vi.fn(),
    mockIsWorldbookTakeoverActive: vi.fn(() => false),
    mockEnsureHydrated: vi.fn(async () => undefined),
    mockAgentWorldbookEnabled: vi.fn(() => true),
    mockAgentWorldbookNativeFallback: vi.fn(() => false),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  get pendingFinalGenerationGreenlights_ACU() { return mockPendingFinalGenerationGreenlightsRef.value; },
  _set_pendingFinalGenerationGreenlights_ACU: mockSetPendingFinalGenerationGreenlights,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
}));

vi.mock('../../../src/service/runtime/template-vars', () => ({
  parseRandomTags_ACU: mockParseRandomTags,
  replaceRandomVariables_ACU: mockReplaceRandomVariables,
  parseCalcTags_ACU: mockParseCalcTags,
  parseMaxTags_ACU: mockParseMaxTags,
  parseMinTags_ACU: mockParseMinTags,
  replaceCalcVariables_ACU: mockReplaceCalcVariables,
  replaceMaxVariables_ACU: mockReplaceMaxVariables,
  replaceMinVariables_ACU: mockReplaceMinVariables,
  parseIfBlockRecursive_ACU: mockParseIfBlockRecursive,
  parseIfBlocksInContent_ACU: vi.fn(),
  getLatestAIMessageContent_ACU: mockGetLatestAIMessageContent,
  getLatestUserMessageContent_ACU: vi.fn(() => ''),
  composeSeedMatchContent_ACU: (userContent: string, aiContent: string) => [userContent, aiContent].filter(Boolean).join('\n'),
  replaceDbSqlVariables: vi.fn((s: string) => s),
}));

vi.mock('../../../src/service/runtime/plot-runtime', () => ({
  formatOutlineTableForPlot_ACU: vi.fn(),
  formatSummaryIndexForPlot_ACU: vi.fn(),
  loadPresetAndCleanCharacterData_ACU: vi.fn(),
  getPlotFromHistory_ACU: mockGetPlotFromHistory,
  runOptimizationLogic_ACU: vi.fn(),
  getWorldbookContentForPlot_ACU: mockGetWorldbookContentForPlot,
  getAgentControlledWorldbookEntriesForFinalPrompt_ACU: mockGetAgentControlledWorldbookEntriesForFinalPrompt,
}));

vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({
  isWorldbookTakeoverActive_ACU: mockIsWorldbookTakeoverActive,
  ensurePlotAgentWorldbookSnapshotHydrated_ACU: mockEnsureHydrated,
}));
vi.mock('../../../src/service/agent/agent-worldbook-runtime-state', () => ({
  isAgentWorldbookRuntimeEnabled_ACU: mockAgentWorldbookEnabled,
  isAgentWorldbookNativeFallback_ACU: mockAgentWorldbookNativeFallback,
}));

vi.mock('../../../src/service/runtime/helpers-context-tags', () => ({
  getDefaultPlotContextExtractRules_ACU: vi.fn(),
  getDefaultPlotContextExcludeRules_ACU: vi.fn(),
  applyExcludeRulesToText_ACU: vi.fn(),
  applyContextTagFilters_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/helpers-table-lock', () => ({
  getTableLocksForSheet_ACU: vi.fn(),
  saveTableLocksForSheet_ACU: vi.fn(),
  toggleRowLock_ACU: vi.fn(),
  toggleColLock_ACU: vi.fn(),
  toggleCellLock_ACU: vi.fn(),
  isSpecialIndexLockEnabled_ACU: vi.fn(),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(),
  formatSummaryIndexCode_ACU: vi.fn(),
  applySummaryIndexSequenceToTable_ACU: vi.fn(),
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: vi.fn(),
  formatJsonToReadable_ACU: vi.fn(),
  shouldSuppressWorldbookInjection_ACU: vi.fn(),
  maybeLiftWorldbookSuppression_ACU: vi.fn(),
  fillFirstLayerWithTemplateData_ACU: vi.fn(),
  getEffectiveAutoUpdateThreshold_ACU: vi.fn(),
  isNewChatGreetingStage_ACU: vi.fn(),
  isSingleAiNoUserChat_ACU: vi.fn(),
  buildTemplateBaseStateDataForLocalStorage_ACU: vi.fn(),
  seedGreetingLocalDataFromTemplate_ACU: vi.fn(),
  parseReadableToJson_ACU: vi.fn(),
  GREETING_LOCAL_BASE_STATE_MARKER_ACU: '__GREETING_LOCAL_BASE_STATE__',
}));

import { handleChatCompletionReady_ACU } from '../../../src/service/runtime/helpers-remaining';

beforeEach(() => {
  vi.clearAllMocks();
  mockParseRandomTags.mockImplementation((s: string) => s);
  mockReplaceRandomVariables.mockImplementation((s: string) => s);
  mockParseCalcTags.mockImplementation((s: string) => s);
  mockParseMaxTags.mockImplementation((s: string) => s);
  mockParseMinTags.mockImplementation((s: string) => s);
  mockReplaceCalcVariables.mockImplementation((s: string) => s);
  mockReplaceMaxVariables.mockImplementation((s: string) => s);
  mockReplaceMinVariables.mockImplementation((s: string) => s);
  mockParseIfBlockRecursive.mockImplementation((s: string) => s);
  mockGetPlotFromHistory.mockReturnValue(null);
  mockSettings.promptTemplateSettings = { enabled: true, maxNestingDepth: 10, debugMode: false };
  mockPendingFinalGenerationGreenlightsRef.value = [];
  mockAgentWorldbookEnabled.mockReturnValue(true);
  mockAgentWorldbookNativeFallback.mockReturnValue(false);
  mockIsWorldbookTakeoverActive.mockReturnValue(false);
  mockGetWorldbookContentForPlot.mockResolvedValue('');
  mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([]);
});

describe('handleChatCompletionReady_ACU', () => {
  it('功能未启用时跳过处理', async () => {
    mockSettings.promptTemplateSettings = { enabled: false };
    const data = { messages: [{ content: '{{random}}' }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockParseRandomTags).not.toHaveBeenCalled();
  });

  it('settings 为 null 时跳过处理', async () => {
    mockSettings.promptTemplateSettings = null;
    const data = { messages: [{ content: '{{random}}' }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockParseRandomTags).not.toHaveBeenCalled();
  });

  it('data 为 null 时跳过处理', async () => {
    await handleChatCompletionReady_ACU(null);
    expect(mockParseRandomTags).not.toHaveBeenCalled();
  });

  it('data.messages 不是数组时跳过处理', async () => {
    await handleChatCompletionReady_ACU({ messages: 'not array' });
    expect(mockParseRandomTags).not.toHaveBeenCalled();
  });

  it('处理字符串类型的 message.content', async () => {
    mockParseRandomTags.mockReturnValue('processed');
    mockReplaceRandomVariables.mockReturnValue('processed');
    mockParseCalcTags.mockReturnValue('processed');
    mockParseMaxTags.mockReturnValue('processed');
    mockParseMinTags.mockReturnValue('processed');
    mockReplaceCalcVariables.mockReturnValue('processed');
    mockReplaceMaxVariables.mockReturnValue('processed');
    mockReplaceMinVariables.mockReturnValue('processed');
    mockParseIfBlockRecursive.mockReturnValue('processed');

    const data = { messages: [{ content: '原始内容' }] };
    await handleChatCompletionReady_ACU(data);

    expect(mockParseRandomTags).toHaveBeenCalledWith('原始内容');
    expect(data.messages[0].content).toBe('processed');
  });

  it('处理数组类型的 message.content（多模态）', async () => {
    mockParseRandomTags.mockReturnValue('processed');
    mockReplaceRandomVariables.mockReturnValue('processed');
    mockParseCalcTags.mockReturnValue('processed');
    mockParseMaxTags.mockReturnValue('processed');
    mockParseMinTags.mockReturnValue('processed');
    mockReplaceCalcVariables.mockReturnValue('processed');
    mockReplaceMaxVariables.mockReturnValue('processed');
    mockReplaceMinVariables.mockReturnValue('processed');
    mockParseIfBlockRecursive.mockReturnValue('processed');

    const data = {
      messages: [{
        content: [
          { type: 'text', text: '原始文本' },
          { type: 'image_url', image_url: 'http://img.png' },
        ],
      }],
    };
    await handleChatCompletionReady_ACU(data);

    expect(mockParseRandomTags).toHaveBeenCalledWith('原始文本');
    expect(data.messages[0].content[0].text).toBe('processed');
    // image_url 部分不应被处理
    expect(data.messages[0].content[1].image_url).toBe('http://img.png');
  });

  it('content 不是字符串也不是数组时不处理', async () => {
    const data = { messages: [{ content: 123 }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockParseRandomTags).not.toHaveBeenCalled();
  });

  it('空字符串 content 不调用处理函数', async () => {
    const data = { messages: [{ content: '' }] };
    await handleChatCompletionReady_ACU(data);
    expect(mockParseRandomTags).not.toHaveBeenCalled();
  });

  it('多条消息都被处理', async () => {
    mockParseRandomTags.mockImplementation((s: string) => s + '_r');
    mockReplaceRandomVariables.mockImplementation((s: string) => s);
    mockParseCalcTags.mockImplementation((s: string) => s);
    mockParseMaxTags.mockImplementation((s: string) => s);
    mockParseMinTags.mockImplementation((s: string) => s);
    mockReplaceCalcVariables.mockImplementation((s: string) => s);
    mockReplaceMaxVariables.mockImplementation((s: string) => s);
    mockReplaceMinVariables.mockImplementation((s: string) => s);
    mockParseIfBlockRecursive.mockImplementation((s: string) => s);

    const data = {
      messages: [
        { content: '消息1' },
        { content: '消息2' },
        { content: '消息3' },
      ],
    };
    await handleChatCompletionReady_ACU(data);

    expect(mockParseRandomTags).toHaveBeenCalledTimes(3);
    expect(data.messages[0].content).toBe('消息1_r');
    expect(data.messages[1].content).toBe('消息2_r');
    expect(data.messages[2].content).toBe('消息3_r');
  });

  it('getPlotFromHistory_ACU 被调用获取剧情数据', async () => {
    mockGetPlotFromHistory.mockReturnValue('剧情内容');
    const data = { messages: [{ content: '测试' }] };
    // 让处理函数返回不同值以触发 processedCount
    mockParseRandomTags.mockReturnValue('changed');
    mockReplaceRandomVariables.mockReturnValue('changed');
    mockParseCalcTags.mockReturnValue('changed');
    mockParseMaxTags.mockReturnValue('changed');
    mockParseMinTags.mockReturnValue('changed');
    mockReplaceCalcVariables.mockReturnValue('changed');
    mockReplaceMaxVariables.mockReturnValue('changed');
    mockReplaceMinVariables.mockReturnValue('changed');
    mockParseIfBlockRecursive.mockReturnValue('changed');

    await handleChatCompletionReady_ACU(data);
    expect(mockGetPlotFromHistory).toHaveBeenCalled();
  });



  it('正文蓝灯 allowlist 中的原生世界书内容会保留且不手工重复注入', async () => {
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'allowed', reason: '正文需要' }];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'allowed', comment: '放行绿灯', content: '放行内容' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '系统提示\n\n# 放行绿灯\n放行内容\n\n其他系统提示' },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(mockGetAgentControlledWorldbookEntriesForFinalPrompt).toHaveBeenCalledWith({});
    expect(data.messages).toEqual([
      { role: 'system', content: '系统提示\n\n# 放行绿灯\n放行内容\n\n其他系统提示' },
      { role: 'user', content: '当前输入' },
    ]);
    expect(mockLogDebug).not.toHaveBeenCalledWith('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', expect.any(Number));
  });

  it('正文蓝灯反向过滤只删除未被 Agent 放行的受控原生 skill 条目', async () => {
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'allowed' }];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'allowed', comment: '放行绿灯', content: '放行内容' },
      { bookName: '世界书', uid: 'blocked', comment: '未放行绿灯', content: '未放行但被原生触发的内容' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '系统提示\n\n# 未放行绿灯\n未放行但被原生触发的内容\n\n# 放行绿灯\n放行内容\n\n其他系统提示' },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(data.messages).toEqual([
      { role: 'system', content: '系统提示\n\n# 放行绿灯\n放行内容\n\n其他系统提示' },
      { role: 'user', content: '当前输入' },
    ]);
    expect(mockLogDebug).toHaveBeenCalledWith('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', 1);
  });

  it('冷启动初判未接管时会先水合快照再复判，复判接管活跃则执行过滤', async () => {
    mockEnsureHydrated.mockClear();
    // 初判（内存快照为空）返回 false，水合后复判返回 true。
    mockIsWorldbookTakeoverActive.mockReturnValueOnce(false).mockReturnValue(true);
    mockPendingFinalGenerationGreenlightsRef.value = [];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'blocked-cold-start', comment: '冷启动条目', content: '冷启动时必须过滤的原生内容' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '系统提示\n\n# 冷启动条目\n冷启动时必须过滤的原生内容\n\n其他系统提示' },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(mockEnsureHydrated).toHaveBeenCalledTimes(1);
    expect(data.messages).toEqual([
      { role: 'system', content: '系统提示\n\n其他系统提示' },
      { role: 'user', content: '当前输入' },
    ]);
  });

  it('Agent 接管启用但本轮正文蓝灯为空时会过滤全部受控原生 skill 条目', async () => {
    mockIsWorldbookTakeoverActive.mockReturnValue(true);
    mockPendingFinalGenerationGreenlightsRef.value = [];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'blocked-empty-allowlist', comment: '空放行绿灯', content: '空放行时也必须过滤的原生内容' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '系统提示\n\n# 空放行绿灯\n空放行时也必须过滤的原生内容\n\n其他系统提示' },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(mockGetAgentControlledWorldbookEntriesForFinalPrompt).toHaveBeenCalledWith({});
    expect(data.messages).toEqual([
      { role: 'system', content: '系统提示\n\n其他系统提示' },
      { role: 'user', content: '当前输入' },
    ]);
    expect(mockLogDebug).toHaveBeenCalledWith('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', 1);
  });

  it.each(['disabled', 'native_fallback'])('Agent 状态为 %s 时保留原生正文，不水合或扫描受控目录', async state => {
    mockAgentWorldbookEnabled.mockReturnValue(state !== 'disabled');
    mockAgentWorldbookNativeFallback.mockReturnValue(state === 'native_fallback');
    mockIsWorldbookTakeoverActive.mockReturnValue(true);
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'old-selection' }];
    const data = { messages: [
      { role: 'system', content: '原生世界书正文' },
      { role: 'user', content: '当前输入' },
    ] };
    const original = structuredClone(data.messages);

    await handleChatCompletionReady_ACU(data);

    expect(data.messages).toEqual(original);
    expect(mockEnsureHydrated).not.toHaveBeenCalled();
    expect(mockGetAgentControlledWorldbookEntriesForFinalPrompt).not.toHaveBeenCalled();
  });

  it('正文蓝灯过滤不会删除普通用户消息中的相同文本', async () => {
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'allowed' }];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'blocked', comment: '用户提到的绿灯', content: '用户正文里的相同句子' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '用户正文里的相同句子' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(data.messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '用户正文里的相同句子' },
    ]);
  });

  it('正文蓝灯过滤不会删除普通 system 消息中的裸相同文本', async () => {
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'allowed' }];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'blocked', comment: '普通系统提示同文', content: '这段系统提示恰好与世界书相同' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '系统前缀\n\n这段系统提示恰好与世界书相同\n\n系统后缀' },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(data.messages).toEqual([
      { role: 'system', content: '系统前缀\n\n这段系统提示恰好与世界书相同\n\n系统后缀' },
      { role: 'user', content: '当前输入' },
    ]);
    expect(mockLogDebug).not.toHaveBeenCalledWith('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', expect.any(Number));
  });

  it('正文蓝灯过滤会删除 worldInfo 标识消息中的裸相同文本', async () => {
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'allowed' }];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'blocked', comment: '原生裸内容', content: '原生 worldInfo 只保留正文内容' },
    ]);

    const data = {
      messages: [
        { role: 'system', identifier: 'worldInfoBefore', content: '原生 worldInfo 只保留正文内容' },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(data.messages).toEqual([
      { role: 'system', identifier: 'worldInfoBefore', content: '' },
      { role: 'user', content: '当前输入' },
    ]);
    expect(mockLogDebug).toHaveBeenCalledWith('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', 1);
  });

  it('正文蓝灯过滤不会重复注入已经存在的插件 Agent 消息', async () => {
    mockPendingFinalGenerationGreenlightsRef.value = [{ bookName: '世界书', uid: 'injected-safe' }];
    mockGetAgentControlledWorldbookEntriesForFinalPrompt.mockResolvedValue([
      { bookName: '世界书', uid: 'injected-safe', comment: '已注入', content: '已注入内容' },
    ]);

    const data = {
      messages: [
        { role: 'system', content: '[ACU Agent Greenlight: 已注入]\n已注入内容', injected: true },
        { role: 'user', content: '当前输入' },
      ],
    };

    await handleChatCompletionReady_ACU(data);

    expect(data.messages).toEqual([
      { role: 'system', content: '[ACU Agent Greenlight: 已注入]\n已注入内容', injected: true },
      { role: 'user', content: '当前输入' },
    ]);
  });


  it('处理管线按正确顺序执行', async () => {
    const callOrder: string[] = [];
    mockParseRandomTags.mockImplementation((s: string) => { callOrder.push('parseRandom'); return s; });
    mockReplaceRandomVariables.mockImplementation((s: string) => { callOrder.push('replaceRandom'); return s; });
    mockParseCalcTags.mockImplementation((s: string) => { callOrder.push('parseCalc'); return s; });
    mockParseMaxTags.mockImplementation((s: string) => { callOrder.push('parseMax'); return s; });
    mockParseMinTags.mockImplementation((s: string) => { callOrder.push('parseMin'); return s; });
    mockReplaceCalcVariables.mockImplementation((s: string) => { callOrder.push('replaceCalc'); return s; });
    mockReplaceMaxVariables.mockImplementation((s: string) => { callOrder.push('replaceMax'); return s; });
    mockReplaceMinVariables.mockImplementation((s: string) => { callOrder.push('replaceMin'); return s; });
    mockParseIfBlockRecursive.mockImplementation((s: string) => { callOrder.push('parseIf'); return s; });

    const data = { messages: [{ content: '测试内容' }] };
    await handleChatCompletionReady_ACU(data);

    expect(callOrder).toEqual([
      'parseRandom', 'replaceRandom',
      'parseCalc', 'parseMax', 'parseMin',
      'replaceCalc', 'replaceMax', 'replaceMin',
      'parseIf',
    ]);
  });
});
