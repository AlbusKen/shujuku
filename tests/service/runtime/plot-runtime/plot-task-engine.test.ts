import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCreateOrdinaryPlotCausalContext,
  mockSettings,
  mockAbortControllerRef,
  mockCurrentJsonTableDataRef,
  mockPlanningGuard,
  mockSetTempPlotToSave,
  mockTempPlotToSaveRef,
  mockCurrentChatFileIdentifier,
  mockFlushPlotPendingSave,
  mockSetCurrentJsonTableData,
  mockSetPendingFinalGenerationGreenlights,
  mockGetApiConfigByPreset,
  mockCallApi,
  mockCallApiWithPlotPreset,
  mockGetCurrentCharacterWorldbookBinding,
  mockGetChatArray,
  mockGetPersonaDescription,
  mockGetCharDescription,
  mockBuildCombinedWorldbookContentByStrategy,
  mockCollectCombinedWorldbookEntriesByStrategy,
  mockFormatCombinedWorldbookEntries,
  mockGetLorebookEntriesStrict,
  mockEnsurePlotTasksCompat,
  mockGetPlotPromptContentById,
  mockNormalizePlotTask,
  mockNormalizePlotTasks,
  mockParseRandomTags,
  mockReplaceRandomVariables,
  mockGetLatestAIMessageContent,
  mockApplyContextTagFilters,
  mockApplyExcludeRulesToText,
  mockMergeAllIndependentTables,
  mockFormatSummaryIndexForPlot,
  mockFormatOutlineTableForPlot,
  mockGetNormalizedPlotMessageRole,
  mockTryRenderPlotTemplateWithEjs,
  mockRenderPlotTaskContentWithIsolatedVariables,
  mockExtractPlotTagsFromResponse,
  mockGetPlotPlaceholderTagNames,
  mockBuildPlotTagMapFromText,
  mockReplacePlotTagPlaceholders,
  mockBuildTaskWorldbookTriggerText,
  mockAggregatePlotTaskTags,
  mockBuildPlotSaveContentFromTaskResults,
  mockBuildFinalPlotInjectionMessage,
  mockGetPlotFromHistory,
  mockSavePlotToLatestMessage,
  mockHashUserInput,
  mockIsEntryBlocked,
  mockRunAgentDecisionForPlot,
  mockClearFinalGenerationGreenlights,
  mockWriteFinalGenerationGreenlights,
  mockResolveAgentWorldbookFilterAvailability,
  mockResolvePreTakeoverSnapshot,
  mockIsDatabaseGeneratedLorebookEntry,
  mockResolveGeneratedEntriesForTable,
  mockCapturePlotRuntimeScope,
  mockIsSamePlotRuntimeScope,
  mockAbortableDelay,
  mockRenderPlotSimulationSceneFacts,
  mockBuildPlotInternalCausalMessage,
  mockValidatePlotInternalCausalView,
  mockParsePlotInternalCausalResult,
  mockLogDebug,
  mockLogError,
  mockLogWarn,
} = vi.hoisted(() => {
  const mockAbortControllerRef = { value: null as any };
  const mockCurrentJsonTableDataRef = {
    value: {
      sheet_0: {
        name: '纪要表',
        content: [['row_id', '内容'], ['1', '初始纪要']],
      },
    } as any,
  };

  return {
    mockCreateOrdinaryPlotCausalContext: vi.fn(async () => null as any),
    mockSettings: {
      plotApiPreset: '',
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
      plotSettings: {
        contextTurnCount: 2,
        contextExtractTags: '',
        contextExtractRules: [],
        contextExcludeTags: '',
        contextExcludeRules: [],
        loopSettings: { maxRetries: 3 },
      },
    } as any,
    mockAbortControllerRef,
    mockCurrentJsonTableDataRef,
    mockPlanningGuard: { ignoreNextGenerationEndedCount: 0 } as any,
    mockTempPlotToSaveRef: { value: null as any },
    mockCurrentChatFileIdentifier: 'test-chat',
    mockFlushPlotPendingSave: vi.fn(),
    mockSetTempPlotToSave: vi.fn(),
    mockSetCurrentJsonTableData: vi.fn((value: any) => {
      mockCurrentJsonTableDataRef.value = value;
    }),
    mockSetPendingFinalGenerationGreenlights: vi.fn(),
    mockGetApiConfigByPreset: vi.fn(),
    mockCallApi: vi.fn(),
    mockCallApiWithPlotPreset: vi.fn(),
    mockGetCurrentCharacterWorldbookBinding: vi.fn(),
    mockGetChatArray: vi.fn(),
    mockGetPersonaDescription: vi.fn(),
    mockGetCharDescription: vi.fn(),
    mockBuildCombinedWorldbookContentByStrategy: vi.fn(),
    mockCollectCombinedWorldbookEntriesByStrategy: vi.fn(),
    mockFormatCombinedWorldbookEntries: vi.fn(),
    mockGetLorebookEntriesStrict: vi.fn(),
    mockEnsurePlotTasksCompat: vi.fn(),
    mockGetPlotPromptContentById: vi.fn(),
    mockNormalizePlotTask: vi.fn(),
    mockNormalizePlotTasks: vi.fn(),
    mockParseRandomTags: vi.fn(),
    mockReplaceRandomVariables: vi.fn(),
    mockGetLatestAIMessageContent: vi.fn(),
    mockApplyContextTagFilters: vi.fn(),
    mockApplyExcludeRulesToText: vi.fn(),
    mockMergeAllIndependentTables: vi.fn(),
    mockFormatSummaryIndexForPlot: vi.fn(),
    mockFormatOutlineTableForPlot: vi.fn(),
    mockGetNormalizedPlotMessageRole: vi.fn(),
    mockTryRenderPlotTemplateWithEjs: vi.fn(),
    mockRenderPlotTaskContentWithIsolatedVariables: vi.fn(),
    mockExtractPlotTagsFromResponse: vi.fn(),
    mockGetPlotPlaceholderTagNames: vi.fn(),
    mockBuildPlotTagMapFromText: vi.fn(),
    mockReplacePlotTagPlaceholders: vi.fn(),
    mockBuildTaskWorldbookTriggerText: vi.fn(),
    mockAggregatePlotTaskTags: vi.fn(),
    mockBuildPlotSaveContentFromTaskResults: vi.fn(),
    mockBuildFinalPlotInjectionMessage: vi.fn(),
    mockGetPlotFromHistory: vi.fn(),
    mockSavePlotToLatestMessage: vi.fn(),
    mockHashUserInput: vi.fn((text: string) => `hash_${text}`),
    mockIsEntryBlocked: vi.fn((entry: any) => !!entry?.blocked),
    mockRunAgentDecisionForPlot: vi.fn(),
    mockClearFinalGenerationGreenlights: vi.fn(),
    mockWriteFinalGenerationGreenlights: vi.fn(),
    mockResolveAgentWorldbookFilterAvailability: vi.fn(),
    mockResolvePreTakeoverSnapshot: vi.fn(),
    mockIsDatabaseGeneratedLorebookEntry: vi.fn(),
    mockResolveGeneratedEntriesForTable: vi.fn(),
    mockCapturePlotRuntimeScope: vi.fn(),
    mockIsSamePlotRuntimeScope: vi.fn(),
    mockAbortableDelay: vi.fn(async () => {}),
    mockRenderPlotSimulationSceneFacts: vi.fn(),
    mockBuildPlotInternalCausalMessage: vi.fn(),
    mockValidatePlotInternalCausalView: vi.fn(),
    mockParsePlotInternalCausalResult: vi.fn(),
    mockLogDebug: vi.fn(),
    mockLogError: vi.fn(),
    mockLogWarn: vi.fn(),
  };
});

const mockMainChatCompletionAvailable = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../../../src/data/gateways/ai-gateway', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/data/gateways/ai-gateway')>(),
  isMainApiChatCompletionAvailable_ACU: mockMainChatCompletionAvailable,
}));

vi.mock('../../../../src/shared/defaults-json.js', () => ({
  DEFAULT_PLOT_SETTINGS_ACU: {
    loopSettings: { maxRetries: 3 },
  },
}));

vi.mock('../../../../src/service/runtime/plot-runtime/ordinary-plot-causal-context', () => ({
  createOrdinaryPlotCausalContext_ACU: mockCreateOrdinaryPlotCausalContext,
}));

vi.mock('../../../../src/service/ai/api-call', () => ({
  callApi_ACU: mockCallApi,
  callApiWithPlotPreset_ACU: mockCallApiWithPlotPreset,
  getApiConfigByPreset_ACU: mockGetApiConfigByPreset,
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  planningGuard_ACU: mockPlanningGuard,
  currentChatFileIdentifier_ACU: mockCurrentChatFileIdentifier,
  get tempPlotToSave_ACU() {
    return mockTempPlotToSaveRef.value;
  },
  _set_tempPlotToSave_ACU: mockSetTempPlotToSave,
  _set_currentJsonTableData_ACU: mockSetCurrentJsonTableData,
  _set_pendingFinalGenerationGreenlights_ACU: mockSetPendingFinalGenerationGreenlights,
  get currentJsonTableData_ACU() {
    return mockCurrentJsonTableDataRef.value;
  },
  get abortController_ACU() {
    return mockAbortControllerRef.value;
  },
}));

vi.mock('../../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharacterWorldbookBinding_ACU: mockGetCurrentCharacterWorldbookBinding,
}));

vi.mock('../../../../src/data/gateways/worldbook-gateway', () => ({
  createLorebookReadGuard_ACU: vi.fn(async () => async () => {}),
}));

vi.mock('../../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
}));

vi.mock('../../../../src/data/gateways/host-state-gateway', () => ({
  getPersonaDescription_ACU: mockGetPersonaDescription,
  getCharDescription_ACU: mockGetCharDescription,
}));

vi.mock('../../../../src/service/worldbook/pipeline', () => ({
  buildCombinedWorldbookContentByStrategy_ACU: mockBuildCombinedWorldbookContentByStrategy,
  collectCombinedWorldbookEntriesByStrategy_ACU: mockCollectCombinedWorldbookEntriesByStrategy,
  createStrictLorebookReadError_ACU: (result: any) => Object.assign(new Error(`StrictLorebookRead:${result.status}`), {
    name: 'StrictLorebookReadError_ACU',
    status: result.status,
    source: result.source,
    validationPolicy: result.validationPolicy,
    runId: result.runId,
    failedBooks: Array.isArray(result.failedBooks) ? result.failedBooks : [],
    invalidBookNames: Array.isArray(result.invalidBookNames) ? result.invalidBookNames : [],
    staleBookNames: Array.isArray(result.staleBookNames) ? result.staleBookNames : [],
  }),
  formatCombinedWorldbookEntries_ACU: mockFormatCombinedWorldbookEntries,
  getLorebookEntriesStrict_ACU: mockGetLorebookEntriesStrict,
  isStrictLorebookReadError_ACU: (error: any) => error?.name === 'StrictLorebookReadError_ACU',
  summarizeStrictLorebookReadError_ACU: (error: any) => error?.name === 'StrictLorebookReadError_ACU'
    ? {
      category: 'strict_lorebook_read',
      status: error.status,
      source: error.source,
      validationPolicy: error.validationPolicy,
      runId: error.runId,
      failedCount: error.failedBooks.length,
      failedBookNames: error.failedBooks.map((failure: any) => failure.bookName),
      errorCategories: error.failedBooks.map((failure: any) => failure.errorCategory),
      invalidCount: error.invalidBookNames.length,
      staleCount: error.staleBookNames.length,
    }
    : null,
}));

vi.mock('../../../../src/service/worldbook/worldbook-placeholder-classification', () => ({
  isDatabaseGeneratedLorebookEntry_ACU: mockIsDatabaseGeneratedLorebookEntry,
  resolveGeneratedEntriesForTable_ACU: mockResolveGeneratedEntriesForTable,
}));

vi.mock('../../../../src/shared/utils', () => ({
  escapeRegExp_ACU: (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  hashUserInput_ACU: mockHashUserInput,
  isEntryBlocked_ACU: mockIsEntryBlocked,
  logDebug_ACU: mockLogDebug,
  logError_ACU: mockLogError,
  logWarn_ACU: mockLogWarn,
  normalizeNonNegativeInteger_ACU: (value: any, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : fallback;
  },
  normalizePositiveInteger_ACU: (value: any, fallback = 1) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  },
  normalizeExcludeRules_ACU: (rules: any) => Array.isArray(rules) ? rules : [],
  normalizeExtractRules_ACU: (rules: any) => Array.isArray(rules) ? rules : [],
}));

vi.mock('../../../../src/service/plot/plot-logic', () => ({
  ensurePlotTasksCompat_ACU: mockEnsurePlotTasksCompat,
  getPlotPromptContentByIdFromSettings_ACU: mockGetPlotPromptContentById,
  normalizePlotTask_ACU: mockNormalizePlotTask,
  normalizePlotTasks_ACU: mockNormalizePlotTasks,
}));

vi.mock('../../../../src/service/runtime/template-vars', () => ({
  parseRandomTags_ACU: mockParseRandomTags,
  replaceRandomVariables_ACU: mockReplaceRandomVariables,
  getLatestAIMessageContent_ACU: mockGetLatestAIMessageContent,
  getLatestUserMessageContent_ACU: vi.fn(() => ''),
  composeSeedMatchContent_ACU: (userContent: string, aiContent: string) => [userContent, aiContent].filter(Boolean).join('\n'),
  replaceDbSqlVariables: vi.fn((s: string) => s),
}));

vi.mock('../../../../src/service/runtime/helpers-context-tags', () => ({
  applyContextTagFilters_ACU: mockApplyContextTagFilters,
  applyExcludeRulesToText_ACU: mockApplyExcludeRulesToText,
}));

vi.mock('../../../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: mockMergeAllIndependentTables,
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-data-format', () => ({
  formatTableDataForLLM_ACU: vi.fn(),
  formatOutlineTableForPlot_ACU: mockFormatOutlineTableForPlot,
  formatSummaryIndexForPlot_ACU: mockFormatSummaryIndexForPlot,
  getSummaryIndexContentForPlot_ACU: vi.fn(),
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-tag-utils', () => ({
  getNormalizedPlotMessageRole_ACU: mockGetNormalizedPlotMessageRole,
  tryRenderPlotTemplateWithEjs_ACU: mockTryRenderPlotTemplateWithEjs,
  renderPlotTaskContentWithIsolatedVariables_ACU: mockRenderPlotTaskContentWithIsolatedVariables,
  extractPlotTagsFromResponse_ACU: mockExtractPlotTagsFromResponse,
  getPlotPlaceholderTagNames_ACU: mockGetPlotPlaceholderTagNames,
  buildPlotTagMapFromText_ACU: mockBuildPlotTagMapFromText,
  replacePlotTagPlaceholders_ACU: mockReplacePlotTagPlaceholders,
  buildTaskWorldbookTriggerText_ACU: mockBuildTaskWorldbookTriggerText,
  sortPlotTaskResults_ACU: vi.fn(),
  aggregatePlotTaskTags_ACU: mockAggregatePlotTaskTags,
  buildPlotSaveContentFromTaskResults_ACU: mockBuildPlotSaveContentFromTaskResults,
  buildFinalPlotInjectionMessage_ACU: mockBuildFinalPlotInjectionMessage,
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-simulation-scene', () => ({
  PLOT_SIMULATION_SCENE_TOKEN_ACU: '$SIMULATION_SCENE_FACTS',
  renderPlotSimulationSceneFacts_ACU: mockRenderPlotSimulationSceneFacts,
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-internal-causal-result', () => ({
  parsePlotInternalCausalResult_ACU: mockParsePlotInternalCausalResult,
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-internal-causal', () => ({
  buildPlotInternalCausalMessage_ACU: mockBuildPlotInternalCausalMessage,
  validatePlotInternalCausalView_ACU: mockValidatePlotInternalCausalView,
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-history-preset', () => ({
  getPlotFromHistory_ACU: mockGetPlotFromHistory,
  savePlotToLatestMessage_ACU: mockSavePlotToLatestMessage,
  flushPlotPendingSave_ACU: mockFlushPlotPendingSave,
}));

vi.mock('../../../../src/shared/abortable-delay', () => ({
  abortableDelay: mockAbortableDelay,
}));

vi.mock('../../../../src/service/runtime/plot-runtime/plot-runtime-scope', () => ({
  capturePlotRuntimeScope_ACU: mockCapturePlotRuntimeScope,
  isSamePlotRuntimeScope_ACU: mockIsSamePlotRuntimeScope,
  isTransientLorebookNotFoundError_ACU: (error: any) => error?.name !== 'AbortError' && /worldbook.*not found/i.test(String(error?.message || '')),
  normalizeLorebookNames_ACU: (raw: any) => [raw?.primary, ...(Array.isArray(raw?.additional) ? raw.additional : [])]
    .filter((name: unknown): name is string => typeof name === 'string')
    .map(name => name.trim())
    .filter((name, index, names) => !!name && names.indexOf(name) === index),
  summarizePlotRuntimeScope_ACU: (scope: any) => scope,
  summarizePlotRuntimeError_ACU: () => ({ category: 'unknown' }),
}));

vi.mock('../../../../src/service/agent/agent-decision-engine', () => ({
  runAgentDecisionForPlot_ACU: mockRunAgentDecisionForPlot,
}));

vi.mock('../../../../src/service/agent/agent-skillify-service', () => ({
  getWorldbookEntryKeywordsForSkillify_ACU: vi.fn((entry: any) => [...(entry?.keys || []), ...(entry?.key || [])]),
  isDatabaseGeneratedWorldbookEntryForAgent_ACU: vi.fn((entry: any) => String(entry?.comment || entry?.name || '').startsWith('TavernDB-ACU-')),
}));

vi.mock('../../../../src/service/agent/agent-worldbook-takeover', () => ({
  clearFinalGenerationGreenlights_ACU: mockClearFinalGenerationGreenlights,
  writeFinalGenerationGreenlights_ACU: mockWriteFinalGenerationGreenlights,
  resolvePreTakeoverWorldbookSnapshot_ACU: mockResolvePreTakeoverSnapshot,
}));

vi.mock('../../../../src/service/agent/agent-worldbook-skill-meta', () => ({
  resolveAgentWorldbookFilterAvailability_ACU: mockResolveAgentWorldbookFilterAvailability,
  hasUsableWorldbookSkillMeta_ACU: vi.fn((comment: unknown) => String(comment || '').includes('ACU_SKILL_META_START')),
}));

import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../../src/service/simulation/defaults';
import { buildPlotWorldContext_ACU } from '../../../../src/service/runtime/plot-runtime/plot-world-context';
import {
  willPlotUseMainApiGenerateRaw_ACU,
  runPlotTasksRuntime_ACU,
  getWorldbookContentForPlot_ACU,
  getAgentControlledWorldbookEntriesForFinalPrompt_ACU,
  resolveCharacterLorebookNamesStable_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-task-engine';

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateOrdinaryPlotCausalContext.mockReset();
  mockCreateOrdinaryPlotCausalContext.mockResolvedValue(null);
  mockCallApiWithPlotPreset.mockReset();
  mockRenderPlotSimulationSceneFacts.mockReset();
  mockRenderPlotSimulationSceneFacts.mockResolvedValue('安全场景摘要');
  mockBuildPlotInternalCausalMessage.mockReset();
  mockBuildPlotInternalCausalMessage.mockResolvedValue({ role: 'system', content: '内部因果资料' });
  mockValidatePlotInternalCausalView.mockReset();
  mockValidatePlotInternalCausalView.mockImplementation((view: any) => ({
    canonical: JSON.stringify(view), fingerprint: view?.fingerprint || 'a'.repeat(64), snapshot: view,
  }));
  mockParsePlotInternalCausalResult.mockReset();
  mockParsePlotInternalCausalResult.mockImplementation((raw: string) => ({ schemaVersion: 1, viewFingerprint: 'a'.repeat(64), selectedFactIds: JSON.parse(raw).selectedFactIds }));
  mockMainChatCompletionAvailable.mockReturnValue(false);

  mockSettings.plotApiPreset = '';
  mockSettings.plotTaskApiPresetOverridesById = {};
  mockSettings.apiMode = 'custom';
  mockSettings.apiConfig = { useMainApi: true };
  mockSettings.plotSettings = {
    contextTurnCount: 2,
    contextExtractTags: '',
    contextExtractRules: [],
    contextExcludeTags: '',
    contextExcludeRules: [],
    loopSettings: { maxRetries: 3 },
  };

  mockAbortControllerRef.value = null;
  const stableScope = { chatId: 'chat-1', characterId: '1', isolationKey: '', reliable: true };
  mockCapturePlotRuntimeScope.mockReturnValue(stableScope);
  mockIsSamePlotRuntimeScope.mockImplementation((before: any, after: any) => (
    before?.reliable === true
    && after?.reliable === true
    && before.chatId === after.chatId
    && before.characterId === after.characterId
    && before.isolationKey === after.isolationKey
  ));
  mockAbortableDelay.mockResolvedValue(undefined);
  mockCurrentJsonTableDataRef.value = {
    sheet_0: {
      name: '纪要表',
      content: [['row_id', '内容'], ['1', '初始纪要']],
    },
  };
  mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
  mockTempPlotToSaveRef.value = null;
  mockFlushPlotPendingSave.mockResolvedValue(null);

  mockGetApiConfigByPreset.mockReturnValue({
    apiMode: 'custom',
    apiConfig: { useMainApi: true },
  });
  mockGetChatArray.mockReturnValue([
    { is_user: false, mes: '前文AI-1' },
    { is_user: false, mes: '前文AI-2' },
    { is_user: true, mes: '本轮输入' },
  ]);
  mockGetPersonaDescription.mockReturnValue('用户设定');
  mockGetCharDescription.mockReturnValue('角色设定');
  mockBuildCombinedWorldbookContentByStrategy.mockResolvedValue('世界书内容');
  mockCollectCombinedWorldbookEntriesByStrategy.mockResolvedValue([]);
  mockFormatCombinedWorldbookEntries.mockReturnValue('');
  mockGetLorebookEntriesStrict.mockResolvedValue({
    status: 'success',
    entriesByBook: {},
    invalidBookNames: [],
    failedBookNames: [],
    failedBooks: [],
    staleBookNames: [],
  });
  mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
    primary: '剧情书',
    additional: [],
    orderedNames: ['剧情书'],
    apiSource: 'getCharWorldbookNames',
  });

  mockIsDatabaseGeneratedLorebookEntry.mockImplementation((entry: any) => {
    const comment = String(entry?.comment || entry?.name || '');
    return comment.startsWith('TavernDB-ACU-') && !comment.startsWith('外部导入-');
  });
  mockResolveGeneratedEntriesForTable.mockImplementation((entries: any[], tableName: string) => {
    if (tableName !== '关系档案') return [];
    return entries.filter((entry: any) => entry.bookName === '剧情书' && entry.uid === 7);
  });
  mockResolvePreTakeoverSnapshot.mockResolvedValue({
    snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    expectedSignature: 'signature:["Agent书"]',
  });

  mockEnsurePlotTasksCompat.mockImplementation(() => undefined);
  mockGetPlotPromptContentById.mockReturnValue('');
  mockNormalizePlotTasks.mockImplementation((plotSettings: any) => Array.isArray(plotSettings?.tasks) ? plotSettings.tasks : []);
  mockNormalizePlotTask.mockImplementation((task: any) => ({
    enabled: true,
    stage: 1,
    order: 0,
    maxRetries: 1,
    minLength: 0,
    extractTags: '',
    promptGroup: [],
    ...task,
  }));

  mockParseRandomTags.mockImplementation((text: string) => text);
  mockReplaceRandomVariables.mockImplementation((text: string) => text);
  mockGetLatestAIMessageContent.mockReturnValue('最近一条AI内容');
  mockApplyContextTagFilters.mockImplementation((text: string) => text);
  mockApplyExcludeRulesToText.mockImplementation((text: string) => String(text ?? ''));
  mockMergeAllIndependentTables.mockResolvedValue(null);
  mockFormatSummaryIndexForPlot.mockReturnValue({ success: true, content: '纪要索引' });
  mockFormatOutlineTableForPlot.mockReturnValue('总体大纲');
  mockGetNormalizedPlotMessageRole.mockImplementation((role: any) => String(role || 'user').toLowerCase());
  mockTryRenderPlotTemplateWithEjs.mockImplementation(async (text: string) => text);
  mockRenderPlotTaskContentWithIsolatedVariables.mockImplementation((text: string) => text);
  mockExtractPlotTagsFromResponse.mockImplementation(() => ({ tagNames: [], extractedTags: {}, injectedFragments: [], injectOnlyTags: {}, injectOnlyFragments: [], injectOnlyTagNames: [] }));
  mockGetPlotPlaceholderTagNames.mockReturnValue([]);
  mockBuildPlotTagMapFromText.mockReturnValue(new Map());
  mockReplacePlotTagPlaceholders.mockImplementation((text: string) => text);
  mockBuildTaskWorldbookTriggerText.mockReturnValue('');
  mockAggregatePlotTaskTags.mockImplementation((results: any[]) => ({ aggregated: new Map(results.map((result: any) => [result.taskId, result.taskName])), injectOnlyTagNames: new Set<string>() }));
  mockBuildPlotSaveContentFromTaskResults.mockReturnValue('保存的剧情内容');
  mockBuildFinalPlotInjectionMessage.mockReturnValue('最终注入消息');
  mockGetPlotFromHistory.mockReturnValue('上一轮剧情');
  mockSavePlotToLatestMessage.mockResolvedValue({ status: 'committed', targetIndex: 2 });
  mockCallApiWithPlotPreset.mockResolvedValue('任务输出');
  mockRunAgentDecisionForPlot.mockImplementation(async ({ enabledTasks }: any) => ({
    active: false,
    taskPlan: [],
    plotGreenlights: {},
    finalGenerationGreenlights: [],
    effectiveTasks: enabledTasks,
  }));
  mockClearFinalGenerationGreenlights.mockResolvedValue({
    status: 'cleared',
    patched: 0,
    staleBookNames: [],
  });
  mockWriteFinalGenerationGreenlights.mockResolvedValue(true);
  mockResolveAgentWorldbookFilterAvailability.mockResolvedValue({
    available: false,
    reason: 'not_agent_mode',
    configuredMode: 'disabled',
    control: null,
    configSource: 'default',
    skillCount: 0,
    bookNames: [],
    skillMetas: [],
  });
});

describe('willPlotUseMainApiGenerateRaw_ACU', () => {
  it.each([
    ['custom', false, false, false],
    ['custom', false, true, false],
    ['custom', true, false, true],
    ['custom', true, true, false],
    ['tavern', false, false, true],
    ['tavern', false, true, false],
    ['tavern', true, false, true],
    ['tavern', true, true, false],
  ])('模式=%s useMainApi=%s CC可用=%s 时 generateRaw 预判=%s', (apiMode, useMainApi, ccAvailable, expected) => {
    mockMainChatCompletionAvailable.mockReturnValue(ccAvailable as boolean);
    mockGetApiConfigByPreset.mockReturnValue({ apiMode, apiConfig: { useMainApi } });
    expect(willPlotUseMainApiGenerateRaw_ACU()).toBe(expected);
  });

  it('读取预设失败时不登记不存在的宿主生成', () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { useMainApi: true };
    mockGetApiConfigByPreset.mockImplementation(() => {
      throw new Error('preset broken');
    });
    expect(willPlotUseMainApiGenerateRaw_ACU()).toBe(false);
  });

  it('悬挂任务预设不会按回退渠道登记计数', () => {
    mockGetApiConfigByPreset.mockReturnValue({ apiMode: 'tavern', apiConfig: {}, resolved: false });
    expect(willPlotUseMainApiGenerateRaw_ACU('ghost')).toBe(false);
  });
});

describe('getWorldbookContentForPlot_ACU', () => {
  it('apiSettings 为空时返回空字符串', async () => {
    await expect(getWorldbookContentForPlot_ACU(null as any, '用户输入')).resolves.toBe('');
    expect(mockBuildCombinedWorldbookContentByStrategy).not.toHaveBeenCalled();
  });

  it('手动模式会去重书名，并把过滤/选择回调正确传给聚合器', async () => {
    mockGetChatArray.mockReturnValue([
      { mes: '旧消息1' },
      { mes: '旧消息2' },
      { mes: '旧消息3' },
    ]);

    const result = await getWorldbookContentForPlot_ACU(
      {
        contextTurnCount: 2,
        plotWorldbookConfig: {
          source: 'manual',
          manualSelection: ['书A', '书A', '书B'],
          enabledEntries: {
            书A: [1],
          },
        },
      },
      '当前输入',
      '附加剧情',
    );

    expect(result).toBe('世界书内容');
    expect(mockBuildCombinedWorldbookContentByStrategy).toHaveBeenCalledTimes(1);

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.bookNames).toEqual(['书A', '书B']);
    expect(options.baseScanText).toContain('旧消息2');
    expect(options.baseScanText).toContain('旧消息3');
    expect(options.baseScanText).toContain('当前输入');
    expect(options.baseScanText).toContain('附加剧情');

    expect(options.includeEntry({ normalizedComment: 'TavernDB-ACU-OutlineTable-1' })).toBe(false);
    expect(options.includeEntry({ normalizedComment: 'TavernDB-ACU-CustomExport-纪要索引-1' })).toBe(false);
    expect(options.includeEntry({ normalizedComment: '普通条目', blocked: true, rawComment: '普通条目' })).toBe(false);
    expect(options.includeEntry({ normalizedComment: 'TavernDB-ACU-自动生成条目', blocked: true })).toBe(true);

    expect(options.isSelected({ bookName: '书A', uid: 1, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '书A', uid: 2, normalizedComment: '普通条目' })).toBe(false);
    expect(options.isSelected({ bookName: '书A', uid: 2, normalizedComment: '普通条目', enabled: true, _acuPreTakeoverSnapshotHit: true })).toBe(true);
    expect(options.isSelected({ bookName: '书B', uid: 9, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '书A', uid: 999, normalizedComment: 'TavernDB-ACU-自动生成条目' })).toBe(true);
    expect(options.entryStateView).toBe('pre_takeover');
    expect(options.entryStateSnapshot).toEqual(expect.objectContaining({ active: false }));
    expect(options.entryStateSnapshotSignature).toBe('signature:["Agent书"]');
  });


  it('旧数组参数存在 Agent 绿灯时保持 agent-controlled 兼容语义', async () => {
    await getWorldbookContentForPlot_ACU(
      { plotWorldbookConfig: { source: 'manual', manualSelection: ['书A'] } },
      '当前输入',
      '',
      [{ bookName: '书A', uid: 7, reason: '正文需要' }],
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    const greenlightEntry = { bookName: '书A', uid: 7, comment: 'TavernDB-ACU-AgentGreenlight-元数据', content: '剧情推进绿灯正文', normalizedComment: 'TavernDB-ACU-OutlineTable-1', blocked: true, rawComment: '被屏蔽绿灯' };
    const normalEntry = { bookName: '书A', uid: 8, comment: '普通条目', content: '普通正文', normalizedComment: '普通条目', blocked: false };
    const controlledEntry = { bookName: '书A', uid: 10, comment: '受控条目\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"受控","triggerWhen":"触发","tk":1}\nACU_SKILL_META_END -->', content: '受控正文', normalizedComment: '受控条目', blocked: false };
    const dbGeneratedEntry = { bookName: '书A', uid: 9, comment: 'TavernDB-ACU-自动生成条目', content: '未被 Agent 放行的自动生成正文', normalizedComment: 'TavernDB-ACU-自动生成条目', enabled: true, blocked: false };
    expect(options.includeEntry(greenlightEntry)).toBe(true);
    expect(options.forceIncludeEntry(greenlightEntry)).toBe(true);
    expect(options.isSelected(greenlightEntry)).toBe(true);
    expect(options.isSelected(normalEntry)).toBe(true);
    expect(options.isSelected(controlledEntry)).toBe(false);
    expect(options.isSelected(dbGeneratedEntry)).toBe(true);
    expect(options.formatEntry(greenlightEntry)).toBe('剧情推进绿灯正文');
    expect(options.formatEntry(greenlightEntry)).not.toContain('TavernDB-ACU-AgentGreenlight');
    expect(options.formatEntry(greenlightEntry)).not.toContain('#');
    expect(options.formatEntry(normalEntry)).toBe('普通正文');
    expect(options.formatEntry(normalEntry)).not.toContain('普通条目');
    expect(options.formatEntry(normalEntry)).not.toContain('#');
    expect(options.includeEntry({ bookName: '书A', uid: 8, normalizedComment: 'TavernDB-ACU-OutlineTable-1', blocked: true })).toBe(false);
    expect(options.entryStateView).toBe('live');
    expect(options.entryStateSnapshot).toBeUndefined();
  });

  it('normal 模式即使传入绿灯也保持普通世界书选择语义', async () => {
    await getWorldbookContentForPlot_ACU(
      {
        plotWorldbookConfig: {
          source: 'manual',
          manualSelection: ['书A'],
          enabledEntries: { 书A: [1] },
        },
      },
      '当前输入',
      '',
      { agentMode: 'normal', agentGreenlights: [{ bookName: '书A', uid: 7, reason: '不应接管' }] },
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.isSelected({ bookName: '书A', uid: 1, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '书A', uid: 2, normalizedComment: '普通条目' })).toBe(false);
    expect(options.isSelected({ bookName: '书A', uid: 999, normalizedComment: 'TavernDB-ACU-自动生成条目' })).toBe(true);
  });

  it('agent-controlled 模式绿灯为空时仍读取未接管普通条目，但排除受 Agent 控制条目', async () => {
    await getWorldbookContentForPlot_ACU(
      {
        plotWorldbookConfig: {
          source: 'manual',
          manualSelection: ['书A'],
          enabledEntries: { 书A: [1] },
        },
      },
      '当前输入',
      '',
      { agentMode: 'agent-controlled', agentGreenlights: [] },
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    const controlledEntry = { bookName: '书A', uid: 3, comment: '受控条目\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"受控","triggerWhen":"触发","tk":1}\nACU_SKILL_META_END -->', normalizedComment: '受控条目' };
    expect(options.isSelected({ bookName: '书A', uid: 1, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '书A', uid: 2, normalizedComment: '普通条目' })).toBe(false);
    expect(options.isSelected({ bookName: '书A', uid: 2, normalizedComment: '普通条目', enabled: true, _acuPreTakeoverSnapshotHit: true })).toBe(false);
    expect(options.isSelected(controlledEntry)).toBe(false);
    expect(options.isSelected({ bookName: '书A', uid: 999, normalizedComment: 'TavernDB-ACU-自动生成条目' })).toBe(true);
    expect(options.forceIncludeEntry({ bookName: '书A', uid: 1, normalizedComment: '普通条目' })).toBe(false);
    expect(options.entryStateView).toBe('live');
    expect(mockResolvePreTakeoverSnapshot).not.toHaveBeenCalled();
  });

  it('normal 模式 hydration 持久化快照，并使用同一快照的签名', async () => {
    const snapshot = {
      active: true,
      selectionSignature: 'signature:["Agent书"]',
      createdAt: 1,
      books: { Agent书: [{ uid: 1, previousEnabled: true, previousKeys: ['触发'], previousType: 'selective' }] },
    };
    mockResolvePreTakeoverSnapshot.mockResolvedValue({ snapshot, expectedSignature: 'signature:["Agent书"]' });

    await getWorldbookContentForPlot_ACU(
      { plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] } },
      '当前输入',
      '',
      { agentMode: 'normal' },
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.bookNames).toEqual(['剧情书']);
    expect(options.entryStateView).toBe('pre_takeover');
    expect(options.entryStateSnapshot).toBe(snapshot);
    expect(options.entryStateSnapshotSignature).toBe('signature:["Agent书"]');
    expect(mockResolvePreTakeoverSnapshot).toHaveBeenCalledTimes(1);
  });

  it('normal 模式 hydration 失败时阻断收集且不记录宿主正文', async () => {
    const sensitiveText = '用户输入、提示词和世界书正文都不能泄露';
    mockResolvePreTakeoverSnapshot.mockRejectedValue(new Error(sensitiveText));

    await expect(getWorldbookContentForPlot_ACU(
      { plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] } },
      '当前输入',
      '',
      { agentMode: 'normal' },
    )).rejects.toThrow(sensitiveText);
    expect(mockBuildCombinedWorldbookContentByStrategy).not.toHaveBeenCalled();
    expect(JSON.stringify([mockLogWarn.mock.calls, mockLogError.mock.calls])).not.toContain(sensitiveText);
  });


  it('Agent 上下文参数未显式配置时继续使用旧 contextTurnCount', async () => {
    mockGetChatArray.mockReturnValue([
      { mes: '旧消息1' },
      { mes: '旧消息2' },
      { mes: '旧消息3' },
      { mes: '旧消息4' },
    ]);

    await getWorldbookContentForPlot_ACU(
      {
        contextTurnCount: 3,
        agentWorldbookControl: {
          contextSettingsConfigured: false,
          contextSettings: { plotWorldbookScanMessageLimit: 1 },
        },
        plotWorldbookConfig: {
          source: 'manual',
          manualSelection: ['书A'],
        },
      },
      '当前输入',
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.baseScanText).not.toContain('旧消息1');
    expect(options.baseScanText).toContain('旧消息2');
    expect(options.baseScanText).toContain('旧消息3');
    expect(options.baseScanText).toContain('旧消息4');
    expect(options.baseScanText).toContain('当前输入');
  });

  it('Agent 上下文参数显式配置后使用 plotWorldbookScanMessageLimit', async () => {
    mockGetChatArray.mockReturnValue([
      { mes: '旧消息1' },
      { mes: '旧消息2' },
      { mes: '旧消息3' },
      { is_user: false, mes: '等待占位', _qrf_plot_pending_placeholder: true },
    ]);

    await getWorldbookContentForPlot_ACU(
      {
        contextTurnCount: 3,
        agentWorldbookControl: {
          contextSettingsConfigured: true,
          contextSettings: { plotWorldbookScanMessageLimit: 1 },
        },
        plotWorldbookConfig: { source: 'manual', manualSelection: ['书A'] },
      },
      '当前输入',
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.baseScanText).not.toContain('旧消息1');
    expect(options.baseScanText).not.toContain('旧消息2');
    expect(options.baseScanText).toContain('旧消息3');
    expect(options.baseScanText).toContain('当前输入');
    expect(options.baseScanText).not.toContain('等待占位');
  });

  it('角色模式会合并 primary 和 additional 世界书并去重', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主书',
      additional: ['副书', '主书'],
      orderedNames: ['主书', '副书'],
      apiSource: 'getCharWorldbookNames',
    });

    const result = await getWorldbookContentForPlot_ACU(
      { plotWorldbookConfig: { source: 'character' } },
      '继续推进',
    );

    expect(result).toBe('世界书内容');
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledWith();
    expect(mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0].bookNames).toEqual(['主书', '副书']);
  });

  it('角色世界书读取失败时转换为安全严格读取错误', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(new Error('读取失败'));

    await expect(
      getWorldbookContentForPlot_ACU({ plotWorldbookConfig: { source: 'character' } }, '继续推进'),
    ).rejects.toMatchObject({
      name: 'StrictLorebookReadError_ACU',
      status: 'read_failed',
      source: 'plot_runtime',
      validationPolicy: 'trusted_direct',
      failedBooks: [],
    });
  });

  it('没有任何可用世界书时直接返回空字符串', async () => {
    const result = await getWorldbookContentForPlot_ACU(
      {
        plotWorldbookConfig: {
          source: 'manual',
          manualSelection: [],
        },
      },
      '继续推进',
    );

    expect(result).toBe('');
    expect(mockBuildCombinedWorldbookContentByStrategy).not.toHaveBeenCalled();
  });

  it('将 $9 与表名 resolver 的 collector 筛选选项完整透传，并保留旧调用默认值', async () => {
    const excludeEntry = vi.fn((entry: any) => entry.uid === 9);
    const entryScope = vi.fn((entry: any) => entry.uid === 7);

    await getWorldbookContentForPlot_ACU(
      { plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] } },
      '当前输入',
      '任务标签内容',
      { excludeEntry, entryScope, includeGeneratedEntries: true },
    );

    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.excludeEntry).toBe(excludeEntry);
    expect(options.entryScope).toBe(entryScope);
    expect(options.includeGeneratedEntries).toBe(true);
    expect(options.baseScanText).toContain('任务标签内容');
  });
});

describe('resolveCharacterLorebookNamesStable_ACU', () => {
  it('稳定作用域下首次成功只读取一次，并使用 gateway 标准化书名', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主书',
      additional: ['副书'],
      orderedNames: ['主书', '副书'],
      apiSource: 'getCharWorldbookNames',
    });

    await expect(resolveCharacterLorebookNamesStable_ACU()).resolves.toEqual(['主书', '副书']);
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).not.toHaveBeenCalled();
  });

  it('明确 not-found 且作用域稳定时只重试一次', async () => {
    mockGetCurrentCharacterWorldbookBinding
      .mockRejectedValueOnce(new Error('worldbook not found'))
      .mockResolvedValueOnce({ primary: '恢复书', additional: [], orderedNames: ['恢复书'], apiSource: 'getCharWorldbookNames' });

    await expect(resolveCharacterLorebookNamesStable_ACU()).resolves.toEqual(['恢复书']);
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(2);
    expect(mockAbortableDelay).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).toHaveBeenCalledWith(300, undefined);
  });

  it('连续 not-found 后抛出，且日志不复制宿主错误正文', async () => {
    const sensitiveText = '用户输入、提示词和世界书正文都不能泄露';
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(new Error(`worldbook not found: ${sensitiveText}`));

    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toThrow(sensitiveText);
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(2);
    expect(mockAbortableDelay).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[剧情推进][世界书] 角色绑定世界书读取失败，已达到重试上限。',
      expect.objectContaining({ attempt: 2, error: { category: 'unknown' } }),
    );
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(sensitiveText);
  });

  it('非 not-found 错误不重试', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(new Error('permission denied'));

    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toThrow('permission denied');
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).not.toHaveBeenCalled();
  });

  it('第二次读取转为非 not-found 错误时直接抛出', async () => {
    mockGetCurrentCharacterWorldbookBinding
      .mockRejectedValueOnce(new Error('worldbook not found'))
      .mockRejectedValueOnce(new Error('permission denied'));

    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toThrow('permission denied');
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(2);
  });

  it('重试等待后作用域变化时不执行第二次读取', async () => {
    const initialScope = { chatId: 'chat-1', characterId: '1', isolationKey: '', reliable: true };
    const changedScope = { chatId: 'chat-2', characterId: '1', isolationKey: '', reliable: true };
    mockCapturePlotRuntimeScope
      .mockReturnValueOnce(initialScope)
      .mockReturnValueOnce(initialScope)
      .mockReturnValueOnce(changedScope);
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(new Error('worldbook not found'));

    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toMatchObject({ name: 'CharacterLorebookScopeChangedError_ACU' });
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['character', { chatId: 'chat-1', characterId: '2', isolationKey: '', reliable: true }],
    ['isolation', { chatId: 'chat-1', characterId: '1', isolationKey: 'isolated', reliable: true }],
  ])('重试等待后 %s 作用域变化时不执行第二次读取', async (_dimension, changedScope) => {
    const initialScope = { chatId: 'chat-1', characterId: '1', isolationKey: '', reliable: true };
    mockCapturePlotRuntimeScope
      .mockReturnValueOnce(initialScope)
      .mockReturnValueOnce(initialScope)
      .mockReturnValueOnce(changedScope);
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(new Error('worldbook not found'));

    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toMatchObject({ name: 'CharacterLorebookScopeChangedError_ACU' });
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).toHaveBeenCalledTimes(1);
  });

  it('重试等待被 Abort 中止时不执行第二次读取', async () => {
    const controller = new AbortController();
    mockAbortControllerRef.value = controller;
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(new Error('worldbook not found'));
    mockAbortableDelay.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toThrow('TaskAbortedByUser');
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).toHaveBeenCalledWith(300, controller.signal);
  });

  it('不可靠 scope 仍允许首次读取，但明确 not-found 不重试', async () => {
    const unreliableScope = { chatId: null, characterId: null, isolationKey: '', reliable: false };
    mockCapturePlotRuntimeScope.mockReturnValue(unreliableScope);
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({ primary: '初始化书', additional: [], orderedNames: ['初始化书'], apiSource: 'getCharWorldbookNames' });

    await expect(resolveCharacterLorebookNamesStable_ACU()).resolves.toEqual(['初始化书']);
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);

    mockGetCurrentCharacterWorldbookBinding.mockReset().mockRejectedValue(new Error('worldbook not found'));
    await expect(resolveCharacterLorebookNamesStable_ACU()).rejects.toThrow('worldbook not found');
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(mockAbortableDelay).not.toHaveBeenCalled();
  });
});

describe('getAgentControlledWorldbookEntriesForFinalPrompt_ACU', () => {
  it('最终提示词受控目录排除带首尾空白的 constant 条目', async () => {
    await getAgentControlledWorldbookEntriesForFinalPrompt_ACU({
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['书A'],
      },
    });

    expect(mockCollectCombinedWorldbookEntriesByStrategy).toHaveBeenCalledTimes(1);
    const options = mockCollectCombinedWorldbookEntriesByStrategy.mock.calls[0][0];
    expect(options.bookNames).toEqual(['书A']);
    expect(options.includeConstantEntriesInBaseScan).toBe(false);

    expect(options.includeEntry({
      type: ' CONSTANT ',
      keys: ['应由酒馆常驻注入'],
      comment: '带空白的常量条目',
    })).toBe(false);
    expect(options.includeEntry({
      type: 'normal',
      keys: ['可由 Agent 控制'],
      comment: '普通条目',
    })).toBe(true);
    expect(options.includeEntry({
      type: 'normal',
      keys: ['数据库生成条目'],
      comment: 'TavernDB-ACU-OutlineTable-1',
    })).toBe(false);
  });

  it('Agent 控制范围条目收集失败时返回空数组且不记录宿主正文', async () => {
    const sensitiveText = '用户输入、提示词和世界书正文都不能泄露';
    mockCollectCombinedWorldbookEntriesByStrategy.mockRejectedValue(new Error(sensitiveText));

    await expect(getAgentControlledWorldbookEntriesForFinalPrompt_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['书A'] },
    })).resolves.toEqual([]);

    expect(mockLogError).toHaveBeenCalledWith('[剧情推进] 处理 Agent 控制范围正文世界书条目时发生错误:', expect.objectContaining({
      phase: 'process_agent_controlled_entries',
      error: { category: 'unknown' },
    }));
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain(sensitiveText);
  });
});

describe('runPlotTasksRuntime_ACU', () => {
  it('清绿灯读取失败时阻断本轮剧情任务', async () => {
    mockClearFinalGenerationGreenlights.mockRejectedValue(new Error('Lorebook permission denied'));
    const plotSettings = {
      tasks: [{
        id: 'preflight-clear-read-fail', name: '清绿灯读取失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '不应到达 AI 调用' }],
      }],
    };

    const reportWarning = vi.fn();
    await expect(runPlotTasksRuntime_ACU(plotSettings, '当前输入', { reportWarning })).rejects.toThrow('Lorebook permission denied');
    expect(mockClearFinalGenerationGreenlights).toHaveBeenCalledTimes(1);
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenCalledWith([]);
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('清绿灯条目更新失败时阻断本轮剧情任务', async () => {
    mockClearFinalGenerationGreenlights.mockRejectedValue(new Error('host setLorebookEntries rejected'));
    const plotSettings = {
      tasks: [{
        id: 'preflight-clear-write-fail', name: '清绿灯写失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '不应到达 AI 调用' }],
      }],
    };

    await expect(runPlotTasksRuntime_ACU(plotSettings, '当前输入')).rejects.toThrow('host setLorebookEntries rejected');
    expect(mockClearFinalGenerationGreenlights).toHaveBeenCalledTimes(1);
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('Agent availability discovery 失败时阻断普通剧情任务', async () => {
    mockResolveAgentWorldbookFilterAvailability.mockRejectedValue(new Error('Lorebook response malformed'));
    const plotSettings = {
      tasks: [{
        id: 'preflight-availability-fail', name: 'Agent 可用性失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '不应到达 AI 调用' }],
      }],
    };

    await expect(runPlotTasksRuntime_ACU(plotSettings, '当前输入')).rejects.toThrow('Lorebook response malformed');
    expect(mockClearFinalGenerationGreenlights).toHaveBeenCalledTimes(1);
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('清绿灯预检发现失效世界书引用时隔离 stale，其余有效任务继续工作', async () => {
    mockClearFinalGenerationGreenlights.mockResolvedValue({
      status: 'isolated_stale',
      patched: 1,
      staleBookNames: ['已删除的世界书'],
    });
    const plotSettings = {
      tasks: [{
        id: 'preflight-stale-task', name: 'stale 隔离后继续', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '有效任务应继续执行' }],
      }],
    };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(result.successfulResults).toHaveLength(1);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    expect(mockClearFinalGenerationGreenlights).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown', 'scope_changed', 'aborted', 'api_unavailable'])('清绿灯预检 failed 时保留 %s 分类并阻断 AI', async category => {
    mockClearFinalGenerationGreenlights.mockResolvedValue({
      status: 'failed',
      patched: 0,
      staleBookNames: [],
      error: { category, phase: 'clear_final_generation_greenlights' },
    });
    const plotSettings = {
      tasks: [{
        id: 'preflight-failed-stage', name: '预检失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '不应到达 AI 调用' }],
      }],
    };

    const reportWarning = vi.fn();
    await expect(runPlotTasksRuntime_ACU(plotSettings, '当前输入', { reportWarning })).rejects.toMatchObject({
      name: 'PlotWorldbookPreflightError_ACU', category, phase: 'clear_final_generation_greenlights',
    });
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('清绿灯预检 failed 时停止且不泄露宿主正文或堆栈到提示', async () => {
    mockClearFinalGenerationGreenlights.mockResolvedValue({
      status: 'failed',
      patched: 0,
      staleBookNames: [],
      error: { category: 'unknown', phase: 'clear_final_generation_greenlights' },
    });
    mockLogError.mockClear();
    const plotSettings = {
      tasks: [{
        id: 'preflight-safe-summary', name: '安全摘要', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '不应到达 AI 调用' }],
      }],
    };

    const reportWarning = vi.fn();
    await expect(runPlotTasksRuntime_ACU(plotSettings, '当前输入', { reportWarning })).rejects.toMatchObject({
      name: 'PlotWorldbookPreflightError_ACU', category: 'unknown',
    });
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    const logCallsJson = JSON.stringify([mockLogError.mock.calls, mockLogWarn.mock.calls, reportWarning.mock.calls]);
    expect(logCallsJson).not.toContain('宿主正文泄露样例');
  });


  it.each([
    ['中文符号点数字', '部落生活 - 2026.08@记录'],
    ['全角与组合 Unicode', 'ワールドブック・記録（2026年08月）'],
    ['纯中文', '普通世界书'],
  ])('名称兼容矩阵：%s 作为角色世界书名不被清洗、拒绝或误当正则', async (_label, bookName) => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: bookName,
      additional: [],
      orderedNames: [bookName],
      apiSource: 'getCharWorldbookNames',
    });
    const plotSettings = {
      plotWorldbookConfig: { source: 'character' },
      tasks: [{
        id: 'unicode-name-task', name: 'Unicode 名称', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '按角色绑定读取世界书' }],
      }],
    };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(result.successfulResults).toHaveLength(1);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    const strictCalls = mockGetLorebookEntriesStrict.mock.calls;
    const bookNamesPassed = strictCalls.map((call: any[]) => call[0]).flat();
    expect(bookNamesPassed).toContain(bookName);
    expect(bookNamesPassed.every(name => String(name) === bookName)).toBe(true);
  });

  it('没有启用任务时返回空结果，并确保兼容处理被调用', async () => {
    const plotSettings = {
      tasks: [],
    };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockEnsurePlotTasksCompat).toHaveBeenCalledWith(plotSettings, { syncLegacy: true });
    expect(result).toEqual({
      finalMessage: null,
      successfulResults: [],
      failedResults: [],
      aggregatedTags: new Map(),
      enabledTaskCount: 0,
      internalTaskCount: 0,
    });
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenCalledWith([]);
  });

  it('入口存在残留 pending 时调用 flush 补写，且不阻断本轮任务', async () => {
    mockTempPlotToSaveRef.value = { content: '旧剧情', userInputHash: 'hash_旧' };
    mockFlushPlotPendingSave.mockResolvedValue({ status: 'committed', targetIndex: 0 });
    const plotSettings = { tasks: [] };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockFlushPlotPendingSave).toHaveBeenCalledTimes(1);
    // flush 不阻断本轮推进：任务照常执行
    expect(result.enabledTaskCount).toBe(0);
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenCalledWith([]);
  });

  it('入口 flush 返回 failed 时仍继续本轮任务，不抛错', async () => {
    mockTempPlotToSaveRef.value = { content: '旧剧情', userInputHash: 'hash_旧' };
    mockFlushPlotPendingSave.mockResolvedValue({ status: 'failed', reason: 'host_save_failed', error: new Error('保存失败') });
    const plotSettings = { tasks: [] };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockFlushPlotPendingSave).toHaveBeenCalledTimes(1);
    expect(result.enabledTaskCount).toBe(0);
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenCalledWith([]);
  });

  it('入口 flush 抛异常时被捕获，本轮任务继续', async () => {
    mockTempPlotToSaveRef.value = { content: '旧剧情', userInputHash: 'hash_旧' };
    mockFlushPlotPendingSave.mockRejectedValue(new Error('flush 内部异常'));
    const plotSettings = { tasks: [] };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockFlushPlotPendingSave).toHaveBeenCalledTimes(1);
    expect(result.enabledTaskCount).toBe(0);
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenCalledWith([]);
  });

  it('无残留 pending 时不调用 flush', async () => {
    mockTempPlotToSaveRef.value = null;
    const plotSettings = { tasks: [] };

    await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockFlushPlotPendingSave).not.toHaveBeenCalled();
  });

  it.each([false, true])('按 stage/order 执行并保存到 user，排除真实 AI 占位（已有 user=%s）', async hasExistingUserMessage => {
    if (hasExistingUserMessage) {
      mockGetChatArray.mockReturnValue([
        { is_user: false, mes: '历史回复1' },
        { is_user: false, mes: '历史回复2' },
        { is_user: true, mes: '当前输入' },
        { is_user: false, mes: '等待占位', _qrf_plot_pending_placeholder: true },
      ]);
      mockResolveAgentWorldbookFilterAvailability.mockResolvedValueOnce({
        available: true,
        control: { mode: 'agent', agentPlotExecutionMode: 'sequential' },
      });
    }
    const plotSettings = {
      tasks: [
        {
          id: 'task-c',
          name: '任务C',
          stage: 2,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-2-task-c' }],
        },
        {
          id: 'task-b',
          name: '任务B',
          stage: 1,
          order: 2,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-1-task-b' }],
        },
        {
          id: 'task-a',
          name: '任务A',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-1-task-a' }],
        },
      ],
    };

    mockCallApiWithPlotPreset
      .mockResolvedValueOnce('结果A')
      .mockResolvedValueOnce('结果B')
      .mockResolvedValueOnce('结果C');

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入', { hasExistingUserMessage });

    expect(result.finalMessage).toBe('最终注入消息');
    expect(result.successfulResults).toHaveLength(3);
    expect(result.failedResults).toHaveLength(0);
    expect(result.enabledTaskCount).toBe(3);

    expect(mockCallApiWithPlotPreset.mock.calls[0][0][0].content).toBe('stage-1-task-a');
    expect(mockCallApiWithPlotPreset.mock.calls[1][0][0].content).toBe('stage-1-task-b');
    expect(mockCallApiWithPlotPreset.mock.calls[2][0][0].content).toBe('stage-2-task-c');

    expect(mockSetTempPlotToSave).toHaveBeenCalledWith(expect.objectContaining({
      content: '保存的剧情内容',
      userInputHash: 'hash_当前输入',
      userInputText: '当前输入',
      targetStartIndex: hasExistingUserMessage ? 2 : mockGetChatArray().length,
      finalMessageHash: 'hash_最终注入消息',
      chatId: 'test-chat',
      taskResults: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-a', success: true, rawResponse: '结果A' }),
        expect.objectContaining({ taskId: 'task-b', success: true, rawResponse: '结果B' }),
        expect.objectContaining({ taskId: 'task-c', success: true, rawResponse: '结果C' }),
      ]),
    }));
    expect(mockSavePlotToLatestMessage).toHaveBeenCalledWith(true);
    if (hasExistingUserMessage) {
      const context = mockRunAgentDecisionForPlot.mock.calls[0][0].sharedContext;
      expect(context.recentContextMessages).toEqual([
        { is_user: false, mes: '历史回复1' },
        { is_user: false, mes: '历史回复2' },
      ]);
    }
  });


  it('严格世界书读取失败时保留分类并阻断 API 调用', async () => {
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'read_failed',
      source: 'manual_validation',
      validationPolicy: 'validate_list',
      runId: 'manual-run',
      entriesByBook: {},
      invalidBookNames: [],
      failedBookNames: ['剧情书'],
      failedBooks: [{ bookName: '剧情书', errorCategory: 'unknown' }],
      staleBookNames: [],
    });

    await expect(runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [{
        id: 'strict-read-failure', name: '严格读取失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '必须读取世界书' }],
      }],
    }, '当前输入')).rejects.toMatchObject({
      name: 'StrictLorebookReadError_ACU', status: 'read_failed',
      failedBooks: [{ bookName: '剧情书', errorCategory: 'unknown' }],
    });

    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['剧情书'], expect.objectContaining({
      source: 'manual_validation',
      validationPolicy: 'validate_list',
    }));
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('手动选择包含失效世界书时拒绝选择并阻断任务', async () => {
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'invalid_selection',
      source: 'manual_validation',
      validationPolicy: 'validate_list',
      runId: 'manual-invalid-run',
      entriesByBook: {},
      invalidBookNames: ['残留配置书'],
      failedBookNames: [],
      failedBooks: [],
      staleBookNames: [],
    });

    await expect(runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['残留配置书'] },
      tasks: [{
        id: 'invalid-manual-selection', name: '失效手动选择', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '必须读取世界书' }],
      }],
    }, '当前输入')).rejects.toMatchObject({
      name: 'StrictLorebookReadError_ACU', status: 'invalid_selection',
      invalidBookNames: ['残留配置书'],
    });

    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['残留配置书'], expect.objectContaining({
      source: 'manual_validation',
      validationPolicy: 'validate_list',
    }));
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['权限错误', new Error('permission denied')],
    ['能力缺失', Object.assign(new Error('CharacterWorldbookApiUnavailableError_ACU'), { name: 'CharacterWorldbookApiUnavailableError_ACU' })],
    ['宿主契约错误', Object.assign(new Error('CharacterWorldbookBindingContractError_ACU'), { name: 'CharacterWorldbookBindingContractError_ACU' })],
    ['未知错误', new Error('host response malformed')],
  ])('角色绑定%s时阻断 AI 调用', async (_label, error) => {
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(error);

    await expect(runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'character' },
      tasks: [{
        id: 'character-binding-failure', name: '角色绑定失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '必须读取角色世界书' }],
      }],
    }, '当前输入')).rejects.toMatchObject({
      name: 'StrictLorebookReadError_ACU', status: 'read_failed',
      source: 'plot_runtime', validationPolicy: 'trusted_direct',
    });

    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['AbortError', Object.assign(new Error('request aborted'), { name: 'AbortError' })],
    ['TaskAbortedByUser', new Error('TaskAbortedByUser')],
  ])('角色 binding %s 时拒绝迟到结果并停止后续调用', async (_label, error) => {
    mockGetCurrentCharacterWorldbookBinding.mockRejectedValue(error);

    const request = runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'character' },
      tasks: [{
        id: 'character-binding-aborted', name: '角色绑定取消', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '必须读取角色世界书' }],
      }],
    }, '当前输入');
    await expect(request).rejects.toMatchObject({ name: error.name, message: error.message });
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
  });

  it('角色绑定读取后 scope 变化时保留终态并停止任务', async () => {
    const stableScope = { chatId: 'chat-1', characterId: '1', isolationKey: '', reliable: true };
    const changedScope = { chatId: 'chat-2', characterId: '1', isolationKey: '', reliable: true };
    mockCapturePlotRuntimeScope
      .mockReturnValueOnce(stableScope)
      .mockReturnValueOnce(stableScope)
      .mockReturnValueOnce(stableScope)
      .mockReturnValueOnce(changedScope);
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '剧情书', additional: [], orderedNames: ['剧情书'], apiSource: 'getCharWorldbookNames',
    });

    await expect(runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'character' },
      tasks: [{
        id: 'character-binding-scope-changed', name: '角色绑定作用域变化', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '必须读取角色世界书' }],
      }],
    }, '当前输入')).rejects.toMatchObject({
      name: 'StrictLorebookReadError_ACU', status: 'scope_changed',
      source: 'plot_runtime', validationPolicy: 'trusted_direct',
    });

    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('角色绑定与同 stage 的 $1/$9 共享同一个请求读取上下文', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({ primary: '主书', additional: ['副书'], orderedNames: ['主书', '副书'], apiSource: 'getCharWorldbookNames' });
    const result = await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'character' },
      tasks: [
        { id: 'shared-a', name: '共享A', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '$1 / $9' }] },
        { id: 'shared-b', name: '共享B', stage: 1, order: 2, maxRetries: 1, promptGroup: [{ role: 'user', content: '$1 / $9' }] },
      ],
    }, '当前输入');

    const strictCalls = mockGetLorebookEntriesStrict.mock.calls;
    const readContext = strictCalls[0]?.[1]?.context;
    expect(result.successfulResults).toHaveLength(2);
    expect(mockGetCurrentCharacterWorldbookBinding).toHaveBeenCalledTimes(1);
    expect(strictCalls).toHaveLength(4);
    expect(strictCalls.every((call: any[]) => call[1]?.context === readContext)).toBe(true);
    expect(readContext.bookEntriesPromises.size).toBe(0);
  });

  it('表名索引严格读取失败时不调用 AI、不保存并阻断后续阶段', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
    };
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'read_failed',
      source: 'plot_table_index',
      validationPolicy: 'validate_list',
      runId: 'table-index-run',
      entriesByBook: {},
      invalidBookNames: [],
      failedBookNames: ['剧情书'],
      failedBooks: [{ bookName: '剧情书', errorCategory: 'unknown' }],
      staleBookNames: [],
    });

    const result = await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: [] },
      tasks: [{
        id: 'table-read-failure', name: '表名读取失败', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '表={{关系档案}}' }],
      }],
    }, '当前输入');

    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith([], expect.objectContaining({
      source: 'plot_table_index',
      validationPolicy: 'validate_list',
      notFoundPolicy: 'isolate_stale',
    }));
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
    expect(result.successfulResults).toHaveLength(0);
    expect(result.failedResults).toHaveLength(1);
    expect(result.abortedByStageFailure).toBe(true);
    expect(result.apiRetriesExhausted).not.toBe(true);
  });

  it.each(['success', 'not_written', 'exception'])('Agent 正文绿灯写入结果=%s 时继续执行剧情任务', async outcome => {
    const finalGreenlights = [{ bookName: '剧情书', uid: 12, reason: '正文需要' }];
    mockResolveAgentWorldbookFilterAvailability.mockResolvedValueOnce({
      available: true,
      reason: 'available',
      configuredMode: 'agent',
      control: { mode: 'agent', agentPlotExecutionMode: 'sequential' },
      configSource: 'worldbook',
      skillCount: 1,
      bookNames: ['剧情书'],
      skillMetas: [{ bookName: '剧情书', uid: 12, skillMeta: { description: '正文需要', triggerWhen: '正文生成' } }],
      configBookName: '剧情书',
      writableBookName: '剧情书',
    });
    mockRunAgentDecisionForPlot.mockResolvedValueOnce({
      active: true,
      taskPlan: [],
      plotGreenlights: {},
      finalGenerationGreenlights: finalGreenlights,
      effectiveTasks: [
        {
          id: 'task-a',
          name: '任务A',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-1-task-a' }],
        },
      ],
    });

    const reportWarning = vi.fn();
    if (outcome === 'exception') {
      mockWriteFinalGenerationGreenlights.mockRejectedValueOnce(new Error('绿灯快照恢复失败'));
    } else {
      mockWriteFinalGenerationGreenlights.mockResolvedValueOnce(outcome === 'success');
    }
    const result = await runPlotTasksRuntime_ACU({ tasks: [{ id: 'task-a', name: '任务A', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: 'stage-1-task-a' }] }] }, '当前输入', { reportWarning });

    expect(mockClearFinalGenerationGreenlights).toHaveBeenCalled();
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenCalledWith(finalGreenlights);
    expect(mockWriteFinalGenerationGreenlights).toHaveBeenCalledWith(finalGreenlights);
    expect(result.finalMessage).toBe('最终注入消息');
    expect(result.successfulResults).toHaveLength(1);
    expect(result.apiRetriesExhausted).not.toBe(true);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    if (outcome === 'exception') {
      expect(reportWarning).toHaveBeenCalledWith('正文世界书绿灯写入异常，保留剧情结果并继续。');
   }
    const availabilityReadContext = mockResolveAgentWorldbookFilterAvailability.mock.calls[0][0];
    const decisionReadContext = mockRunAgentDecisionForPlot.mock.calls[0][0].sharedContext.worldbookReadContext;
    expect(availabilityReadContext).toBe(decisionReadContext);
    expect(availabilityReadContext.bookEntriesPromises.size).toBe(0);
  });

  it('Agent active 但任务没有 description/triggerWhen 时，任务级世界书回退普通来源', async () => {
    mockResolveAgentWorldbookFilterAvailability.mockResolvedValueOnce({
      available: true,
      reason: 'available',
      configuredMode: 'agent',
      control: { mode: 'agent', agentPlotExecutionMode: 'sequential' },
      configSource: 'worldbook',
      skillCount: 1,
      bookNames: ['剧情书'],
      skillMetas: [{ bookName: '剧情书', uid: 7, skillMeta: { description: '任务需要', triggerWhen: '任务执行' } }],
      configBookName: '剧情书',
      writableBookName: '剧情书',
    });
    mockRunAgentDecisionForPlot.mockResolvedValueOnce({
      active: true,
      taskPlan: [],
      plotGreenlights: {
        'task-no-skill': [{ bookName: '剧情书', uid: 7, reason: '不应接管无 skill 任务' }],
      },
      finalGenerationGreenlights: [],
      effectiveTasks: [
        {
          id: 'task-no-skill',
          name: '无 Skill 任务',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: '无 skill 任务' }],
        },
      ],
    });

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['剧情书'],
      },
      tasks: [{ id: 'task-no-skill', name: '无 Skill 任务', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '无 skill 任务' }] }],
    }, '当前输入');

    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    expect(mockBuildCombinedWorldbookContentByStrategy).toHaveBeenCalledTimes(1);
    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.isSelected({ bookName: '剧情书', uid: 7, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '剧情书', uid: 999, normalizedComment: 'TavernDB-ACU-自动生成条目' })).toBe(true);
  });

  it('Agent active 且任务有 description/triggerWhen 时，任务级世界书只由 Agent 控制 Skill meta 条目', async () => {
    mockResolveAgentWorldbookFilterAvailability.mockResolvedValueOnce({
      available: true,
      reason: 'available',
      configuredMode: 'agent',
      control: { mode: 'agent', agentPlotExecutionMode: 'sequential' },
      configSource: 'worldbook',
      skillCount: 1,
      bookNames: ['剧情书'],
      skillMetas: [{ bookName: '剧情书', uid: 7, skillMeta: { description: '任务需要', triggerWhen: '任务执行' } }],
      configBookName: '剧情书',
      writableBookName: '剧情书',
    });
    mockRunAgentDecisionForPlot.mockResolvedValueOnce({
      active: true,
      taskPlan: [],
      plotGreenlights: {
        'task-skill': [{ bookName: '剧情书', uid: 7, reason: '任务需要' }],
      },
      finalGenerationGreenlights: [],
      effectiveTasks: [
        {
          id: 'task-skill',
          name: 'Skill 任务',
          description: '推进冲突',
          triggerWhen: '',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'skill 任务' }],
        },
      ],
    });

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['剧情书'],
      },
      tasks: [{ id: 'task-skill', name: 'Skill 任务', description: '推进冲突', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: 'skill 任务' }] }],
    }, '当前输入');

    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    expect(mockBuildCombinedWorldbookContentByStrategy).toHaveBeenCalledTimes(1);
    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.isSelected({ bookName: '剧情书', uid: 7, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '剧情书', uid: 8, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '剧情书', uid: 8, comment: '受控条目\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"受控","triggerWhen":"触发","tk":1}\nACU_SKILL_META_END-->', normalizedComment: '受控条目' })).toBe(false);
    expect(options.isSelected({ bookName: '剧情书', uid: 999, normalizedComment: 'TavernDB-ACU-自动生成条目' })).toBe(true);
  });

  it('并发模式下 skillMetas 为空仍运行 Agent 决策，剧情成功后写正文蓝灯', async () => {
    const finalGreenlights = [{ bookName: '剧情书', uid: 12, reason: '正文需要' }];
    mockResolveAgentWorldbookFilterAvailability.mockResolvedValueOnce({
      available: true,
      reason: 'available',
      configuredMode: 'agent',
      control: { mode: 'agent', agentPlotExecutionMode: 'concurrent' },
      configSource: 'worldbook',
      skillCount: 0,
      bookNames: ['剧情书'],
      skillMetas: [],
      configBookName: '剧情书',
      writableBookName: '剧情书',
    });
    mockRunAgentDecisionForPlot.mockResolvedValueOnce({
      active: true,
      taskPlan: [{ taskId: 'agent-only', run: false, effectiveStage: 9, effectiveOrder: 9 }],
      plotGreenlights: {
        'task-skill': [{ bookName: '剧情书', uid: 7, reason: '并发时不应控制剧情任务世界书' }],
      },
      finalGenerationGreenlights: finalGreenlights,
      effectiveTasks: [],
    });

    const result = await runPlotTasksRuntime_ACU({
      agentWorldbookControl: { agentPlotExecutionMode: 'concurrent' },
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['剧情书'],
        enabledEntries: { 剧情书: [1] },
      },
      tasks: [{ id: 'task-skill', name: 'Skill 任务', description: '推进冲突', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: 'skill 任务' }] }],
    }, '当前输入');

    expect(mockRunAgentDecisionForPlot).toHaveBeenCalledWith(expect.objectContaining({
      requireTaskPlan: false,
    }));
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    expect(result.successfulResults).toHaveLength(1);
    const options = mockBuildCombinedWorldbookContentByStrategy.mock.calls[0][0];
    expect(options.isSelected({ bookName: '剧情书', uid: 1, normalizedComment: '普通条目' })).toBe(true);
    expect(options.isSelected({ bookName: '剧情书', uid: 7, normalizedComment: '普通条目' })).toBe(false);
    expect(options.isSelected({ bookName: '剧情书', uid: 999, normalizedComment: 'TavernDB-ACU-自动生成条目' })).toBe(true);
    expect(mockSetPendingFinalGenerationGreenlights).toHaveBeenLastCalledWith(finalGreenlights);
    expect(mockWriteFinalGenerationGreenlights).toHaveBeenCalledWith(finalGreenlights);
  });

  it.each(['api', 'validation', 'reject'])('快任务失败（%s）时等齐慢任务与 Agent 收尾，再阻断后续阶段', async failureMode => {
    const plotSettings = {
      tasks: [
        {
          id: 'task-ok',
          name: '成功任务',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-1-ok' }],
        },
        {
          id: 'task-fail',
          name: '失败任务',
          stage: 1,
          order: 2,
          maxRetries: 1,
          extractTags: failureMode === 'validation' ? 'plot' : '',
          promptGroup: [{ role: 'user', content: 'stage-1-fail' }],
        },
        {
          id: 'task-never',
          name: '不应执行的任务',
          stage: 2,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-2-never' }],
        },
      ],
    };

    let finishSlow!: (text: string) => void;
    let finishAgent!: (decision: any) => void;
    const slow = new Promise<string>(resolve => { finishSlow = resolve; });
    const agent = new Promise<any>(resolve => { finishAgent = resolve; });
    mockResolveAgentWorldbookFilterAvailability.mockResolvedValue({
      available: true, control: { mode: 'agent', agentPlotExecutionMode: 'concurrent' },
      bookNames: [], skillMetas: [],
    });
    mockRunAgentDecisionForPlot.mockReturnValue(agent);
    mockCallApiWithPlotPreset.mockImplementation(async (messages: any[]) => {
      const content = messages[0]?.content;
      if (content === 'stage-1-fail') {
        if (failureMode === 'validation') return '缺少配置标签';
        if (failureMode === 'reject') throw new Error('TaskAbortedByUser');
        throw new Error('接口失败');
      }
      return slow;
    });

    let finished = false;
    const outcome = runPlotTasksRuntime_ACU(plotSettings, '当前输入').then(
      result => { finished = true; return { result, error: null }; },
      error => { finished = true; return { result: null, error }; },
    );
    try {
      await vi.waitFor(() => expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(2));
      expect(finished).toBe(false);
      expect(mockBuildFinalPlotInjectionMessage).not.toHaveBeenCalled();
      finishSlow('成功结果');
      // 让任务结果完成结算；仍未收尾的 Agent 必须继续持有本轮生命周期。
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(finished).toBe(false);
      expect(mockSetTempPlotToSave).not.toHaveBeenCalled();
    } finally {
      finishSlow('成功结果');
      finishAgent({ active: false, taskPlan: [], plotGreenlights: {}, finalGenerationGreenlights: [], effectiveTasks: plotSettings.tasks });
    }
    const { result, error } = await outcome;
    if (failureMode === 'reject') {
      expect(error).toMatchObject({ message: 'TaskAbortedByUser' });
      expect(result).toBeNull();
    } else {
      expect(error).toBeNull();
      expect(result).toMatchObject({ finalMessage: null, abortedByStageFailure: true, failedStage: 1 });
      expect(result!.errorMessage).toContain('失败任务');
      expect(result!.apiRetriesExhausted).toBe(failureMode === 'api');
    }
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(2);
    expect(mockCallApiWithPlotPreset.mock.calls.some((call: any[]) => call[0][0].content === 'stage-2-never')).toBe(false);
    expect(mockSavePlotToLatestMessage).not.toHaveBeenCalled();
  });

  it('用户中止时抛出 TaskAbortedByUser', async () => {
    mockAbortControllerRef.value = { signal: { aborted: true } };
    const plotSettings = {
      tasks: [
        {
          id: 'task-a',
          name: '任务A',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-1-task-a' }],
        },
      ],
    };

    await expect(runPlotTasksRuntime_ACU(plotSettings, '当前输入')).rejects.toThrow('TaskAbortedByUser');
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
  });

  it('内存表格为空时会尝试合并独立表并写回运行时状态', async () => {
    mockCurrentJsonTableDataRef.value = null;
    mockMergeAllIndependentTables.mockResolvedValue({
      sheet_merged: {
        name: '合并表',
        content: [['row_id', '字段'], ['1', '合并值']],
      },
    });

    const plotSettings = {
      tasks: [
        {
          id: 'task-a',
          name: '任务A',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-1-task-a' }],
        },
      ],
    };

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(result.finalMessage).toBe('最终注入消息');
    expect(mockMergeAllIndependentTables).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentJsonTableData).toHaveBeenCalledWith({
      sheet_merged: {
        name: '合并表',
        content: [['row_id', '字段'], ['1', '合并值']],
      },
    });
  });

  it('使用主 API 时会为每次任务执行递增 ignoreNextGenerationEndedCount', async () => {
    mockGetApiConfigByPreset.mockReturnValue({
      apiMode: 'custom',
      apiConfig: { useMainApi: true },
    });

    const plotSettings = {
      tasks: [
        {
          id: 'task-a',
          name: '任务A',
          stage: 1,
          order: 1,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'task-a' }],
        },
        {
          id: 'task-b',
          name: '任务B',
          stage: 1,
          order: 2,
          maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'task-b' }],
        },
      ],
    };

    await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockPlanningGuard.ignoreNextGenerationEndedCount).toBe(2);
  });

  it('标签来源按阶段切换：阶段1用历史，阶段1产出后阶段2用本轮', async () => {
    const plotSettings = {
      tasks: [
        { id: 't1', name: '任务1', stage: 1, order: 1, maxRetries: 1, extractTags: '', promptGroup: [{ role: 'user', content: 'T1 {{recall}}' }] },
        { id: 't2', name: '任务2', stage: 1, order: 2, maxRetries: 1, extractTags: '', promptGroup: [{ role: 'user', content: 'T2 {{recall}}' }] },
        { id: 't3', name: '任务3', stage: 1, order: 3, maxRetries: 1, extractTags: 'recall', promptGroup: [{ role: 'user', content: 'T3 {{recall}}' }] },
        { id: 't4', name: '任务4', stage: 2, order: 4, maxRetries: 1, extractTags: '', promptGroup: [{ role: 'user', content: 'T4 {{recall}}' }] },
        { id: 't5', name: '任务5', stage: 2, order: 5, maxRetries: 1, extractTags: '', promptGroup: [{ role: 'user', content: 'T5 {{recall}}' }] },
      ],
    };

    const historyTagMap = new Map<string, any>([['recall', ['上一轮标签']]]);
    mockBuildPlotTagMapFromText.mockReturnValue(historyTagMap);

    mockAggregatePlotTaskTags.mockImplementation((results: any[]) => {
      const aggregated = new Map<string, any>();
      for (const result of results) {
        if (!result?.success || !result?.extractedTags) continue;
        for (const [tagName, tagContent] of Object.entries(result.extractedTags)) {
          if (!aggregated.has(tagName)) aggregated.set(tagName, []);
          aggregated.get(tagName).push(tagContent);
        }
      }
      return { aggregated, injectOnlyTagNames: new Set<string>() };
    });

    mockReplacePlotTagPlaceholders.mockImplementation((text: string) => text);
    mockCallApiWithPlotPreset
      .mockResolvedValueOnce('R1')
      .mockResolvedValueOnce('R2')
      .mockResolvedValueOnce('<recall>本轮新标签</recall>')
      .mockResolvedValueOnce('R4')
      .mockResolvedValueOnce('R5');

    mockExtractPlotTagsFromResponse.mockImplementation((rawText: string) => {
      if (String(rawText).includes('<recall>')) {
        return {
          tagNames: ['recall'],
          extractedTags: { recall: '本轮新标签' },
          injectedFragments: ['<recall>本轮新标签</recall>'],
          injectOnlyTags: {},
          injectOnlyFragments: [],
          injectOnlyTagNames: [],
        };
      }
      return {
        tagNames: [],
        extractedTags: {},
        injectedFragments: [],
        injectOnlyTags: {},
        injectOnlyFragments: [],
        injectOnlyTagNames: [],
      };
    });

    await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(mockReplacePlotTagPlaceholders).toHaveBeenCalledTimes(5);
    const calls = mockReplacePlotTagPlaceholders.mock.calls;

    // 每个任务都应拿到历史 map（第3参）
    expect(calls[0][2]).toBe(historyTagMap);
    expect(calls[1][2]).toBe(historyTagMap);
    expect(calls[2][2]).toBe(historyTagMap);
    expect(calls[3][2]).toBe(historyTagMap);
    expect(calls[4][2]).toBe(historyTagMap);

    // 阶段1的 T1/T2/T3 渲染时本轮无 recall；阶段2的 T4/T5 渲染时本轮已含 recall
    expect(calls[0][1] instanceof Map ? calls[0][1].has('recall') : false).toBe(false);
    expect(calls[1][1] instanceof Map ? calls[1][1].has('recall') : false).toBe(false);
    expect(calls[2][1] instanceof Map ? calls[2][1].has('recall') : false).toBe(false);
    expect(calls[3][1] instanceof Map ? calls[3][1].has('recall') : false).toBe(true);
    expect(calls[4][1] instanceof Map ? calls[4][1].has('recall') : false).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════
  // 任务级 API 预设独立解析
  // ═══════════════════════════════════════════════════════════════
  it.each(['preset-B', ''])('同 stage 按任务覆盖独立选择，归一化丢弃旧字段后仍并发执行（任务2覆盖=%s）', async task2Preset => {
    mockSettings.plotApiPreset = 'global-plot-preset';
    mockSettings.plotTaskApiPresetOverridesById = { t1: 'preset-A', t2: task2Preset };
    const normalizeTask = mockNormalizePlotTask.getMockImplementation()!;
    mockNormalizePlotTask.mockImplementation((task: any) => {
      const normalized = normalizeTask(task);
      delete normalized.taskApiPreset;
      return normalized;
    });
    let activeCalls = 0;
    let maxActiveCalls = 0;
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const bothStarted = new Promise<void>(resolve => { started = resolve; });
    mockCallApiWithPlotPreset.mockImplementation(async () => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      if (activeCalls === 2) started();
      await pending;
      activeCalls -= 1;
      return 'AI回复内容';
    });
    mockExtractPlotTagsFromResponse.mockReturnValue({
      tagNames: ['tag1'],
      extractedTags: { tag1: '内容' },
      injectedFragments: [],
      injectOnlyTags: {},
      injectOnlyFragments: [],
      injectOnlyTagNames: [],
    });

    const plotSettings = {
      enabled: true,
      contextTurnCount: 1,
      contextExtractTags: '',
      contextExtractRules: [],
      contextExcludeTags: '',
      contextExcludeRules: [],
      loopSettings: { maxRetries: 1 },
      tasks: [
        { id: 't1', name: '任务1', enabled: true, stage: 1, order: 0, promptGroup: [{ role: 'USER', content: '提示词1' }], extractTags: 'tag1', taskApiPreset: 'preset-A' },
        { id: 't2', name: '任务2', enabled: true, stage: 1, order: 1, promptGroup: [{ role: 'USER', content: '提示词2' }], extractTags: 'tag1', taskApiPreset: '' },
      ],
    };

    const request = runPlotTasksRuntime_ACU(plotSettings, '当前输入');
    await bothStarted;
    try {
      expect(activeCalls).toBe(2);
      expect(mockBuildFinalPlotInjectionMessage).not.toHaveBeenCalled();
    } finally { release(); }
    await request;

    // 按任务提示词关联请求，避免依赖并发请求的到达顺序。
    const allCalls = mockCallApiWithPlotPreset.mock.calls;
    expect(allCalls).toHaveLength(2);
    expect(allCalls.find(call => call[0][0].content === '提示词1')?.[1]).toBe('preset-A');
    expect(allCalls.find(call => call[0][0].content === '提示词2')?.[1]).toBe(task2Preset || 'global-plot-preset');
    expect(maxActiveCalls).toBeGreaterThan(1);
    delete mockSettings.plotTaskApiPresetOverridesById;
  });

  it('同 stage 未配置任务覆盖时，各自回退到全局 plotApiPreset', async () => {
    mockCallApiWithPlotPreset.mockResolvedValue('AI回复内容');
    mockExtractPlotTagsFromResponse.mockReturnValue({
      tagNames: ['tag1'],
      extractedTags: { tag1: '内容' },
      injectedFragments: [],
      injectOnlyTags: {},
      injectOnlyFragments: [],
      injectOnlyTagNames: [],
    });
    mockSettings.plotApiPreset = 'global-plot-preset';

    const plotSettings = {
      enabled: true,
      contextTurnCount: 1,
      contextExtractTags: '',
      contextExtractRules: [],
      contextExcludeTags: '',
      contextExcludeRules: [],
      loopSettings: { maxRetries: 1 },
      tasks: [
        { id: 't1', name: '任务1', enabled: true, stage: 1, order: 0, promptGroup: [{ role: 'USER', content: '提示词1' }], extractTags: 'tag1', taskApiPreset: '' },
        { id: 't2', name: '任务2', enabled: true, stage: 1, order: 1, promptGroup: [{ role: 'USER', content: '提示词2' }], extractTags: 'tag1', taskApiPreset: '' },
      ],
    };

    await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    const allCalls = mockCallApiWithPlotPreset.mock.calls;
    expect(allCalls.length).toBeGreaterThanOrEqual(2);
    expect(allCalls[0][1]).toBe('global-plot-preset');
    expect(allCalls[1][1]).toBe('global-plot-preset');
  });

  it('不同 stage 的任务独立使用任务覆盖或全局预设', async () => {
    mockCallApiWithPlotPreset.mockResolvedValue('AI回复内容');
    mockExtractPlotTagsFromResponse.mockReturnValue({
      tagNames: ['tag1'],
      extractedTags: { tag1: '内容' },
      injectedFragments: [],
      injectOnlyTags: {},
      injectOnlyFragments: [],
      injectOnlyTagNames: [],
    });
    mockSettings.plotApiPreset = 'global-default';
    mockSettings.plotTaskApiPresetOverridesById = { t1: 'stage1-preset' };

    const plotSettings = {
      enabled: true,
      contextTurnCount: 1,
      contextExtractTags: '',
      contextExtractRules: [],
      contextExcludeTags: '',
      contextExcludeRules: [],
      loopSettings: { maxRetries: 1 },
      tasks: [
        { id: 't1', name: '任务1', enabled: true, stage: 1, order: 0, promptGroup: [{ role: 'USER', content: '提示词1' }], extractTags: 'tag1', taskApiPreset: 'stage1-preset' },
        { id: 't2', name: '任务2', enabled: true, stage: 2, order: 0, promptGroup: [{ role: 'USER', content: '提示词2' }], extractTags: 'tag1', taskApiPreset: '' },
      ],
    };

    await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    const allCalls = mockCallApiWithPlotPreset.mock.calls;
    expect(allCalls.length).toBeGreaterThanOrEqual(2);
    // stage 1 任务使用 stage1-preset
    expect(allCalls[0][1]).toBe('stage1-preset');
    // stage 2 任务无显式 preset，回退到全局
    expect(allCalls[1][1]).toBe('global-default');
  });

  it('任务提示词中的 $9 只收集非数据库生成条目，且 Agent 绿灯不能复活被排除条目', async () => {
    mockResolveAgentWorldbookFilterAvailability.mockResolvedValueOnce({
      available: true,
      reason: 'available',
      configuredMode: 'agent',
      control: { mode: 'agent', agentPlotExecutionMode: 'sequential' },
      configSource: 'worldbook',
      skillCount: 1,
      bookNames: ['剧情书'],
      skillMetas: [],
    });
    mockRunAgentDecisionForPlot.mockResolvedValueOnce({
      active: true,
      taskPlan: [],
      plotGreenlights: { 'task-nine': [{ bookName: '剧情书', uid: 9, reason: '错误绿灯' }] },
      finalGenerationGreenlights: [],
      effectiveTasks: [{
        id: 'task-nine',
        name: '数据库排除',
        description: '需要世界书',
        stage: 1,
        order: 1,
        maxRetries: 1,
        promptGroup: [{ role: 'user', content: '重复 $9 / $9' }],
      }],
    });
    mockBuildCombinedWorldbookContentByStrategy.mockImplementation(async (options: any) => {
      if (typeof options.excludeEntry === 'function') return '外部导入内容';
      return '普通世界书内容';
    });

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [{
        id: 'task-nine',
        name: '数据库排除',
        description: '需要世界书',
        stage: 1,
        order: 1,
        maxRetries: 1,
        promptGroup: [{ role: 'user', content: '重复 $9 / $9' }],
      }],
    }, '当前输入');

    const databaseExcludedOptions = mockBuildCombinedWorldbookContentByStrategy.mock.calls
      .map((call: any[]) => call[0])
      .find((options: any) => typeof options.excludeEntry === 'function');
    expect(databaseExcludedOptions).toBeDefined();
    expect(databaseExcludedOptions.excludeEntry({ comment: 'TavernDB-ACU-CustomExport-关系档案', uid: 9 })).toBe(true);
    expect(databaseExcludedOptions.excludeEntry({ comment: '外部导入-关系档案', uid: 10 })).toBe(false);
    expect(databaseExcludedOptions.forceIncludeEntry({ bookName: '剧情书', uid: 9 })).toBe(true);
    expect(mockCallApiWithPlotPreset.mock.calls[0][0][0].content).toBe('重复 \n<worldbook_context>\n外部导入内容\n</worldbook_context>\n / \n<worldbook_context>\n外部导入内容\n</worldbook_context>\n');
  });

  it('在 EJS 前解析唯一 {{表格名}}，隔离幽灵书后仍只放行精确 scope，并保留未知 token', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
    };
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {
        剧情书: [{ uid: 7, comment: 'TavernDB-ACU-CustomExport-关系档案' }],
      },
      invalidBookNames: [],
      failedBookNames: [],
      failedBooks: [],
      staleBookNames: ['幽灵书'],
    });
    const renderOrder: string[] = [];
    mockTryRenderPlotTemplateWithEjs.mockImplementation(async (text: string) => {
      renderOrder.push(text);
      return text;
    });
    mockBuildCombinedWorldbookContentByStrategy.mockImplementation(async (options: any) => {
      if (typeof options.entryScope === 'function') return '关系档案世界书';
      return '普通世界书内容';
    });

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [{
        id: 'task-table', name: '表名解析', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '表 {{关系档案}} 与 {{未知表}}' }],
      }],
    }, '当前输入');

    const triggerPromptGroup = mockBuildTaskWorldbookTriggerText.mock.calls
      .map((call: any[]) => call[0])
      .find((promptGroup: any[]) => promptGroup?.[0]?.content?.includes('{{未知表}}'));
    expect(triggerPromptGroup?.[0]?.content).not.toContain('{{关系档案}}');
    expect(triggerPromptGroup?.[0]?.content).toContain('{{未知表}}');
    expect(triggerPromptGroup?.[0]?.content).toBe('表  与 {{未知表}}');

    const scopeOptions = mockBuildCombinedWorldbookContentByStrategy.mock.calls
      .map((call: any[]) => call[0])
      .find((options: any) => typeof options.entryScope === 'function');
    expect(mockResolveGeneratedEntriesForTable).toHaveBeenCalledWith(
      [{ bookName: '剧情书', uid: 7, comment: 'TavernDB-ACU-CustomExport-关系档案' }],
      '关系档案',
      mockCurrentJsonTableDataRef.value,
    );
    expect(scopeOptions.includeGeneratedEntries).toBe(true);
    expect(scopeOptions.entryScope({ bookName: '剧情书', uid: 7 })).toBe(true);
    expect(scopeOptions.entryScope({ bookName: '剧情书', uid: 8 })).toBe(false);
    expect(renderOrder.some(text => text.includes('<worldbook_context>\n关系档案世界书\n</worldbook_context>'))).toBe(true);
    expect(mockCallApiWithPlotPreset.mock.calls[0][0][0].content).toContain('{{未知表}}');
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[剧情推进][世界书] 表名索引已隔离宿主列表中的不存在世界书。',
      expect.objectContaining({
        phase: 'table_worldbook_index',
        source: 'plot_table_index',
        category: 'lorebook_not_found',
        isolatedCount: 1,
        staleBookNames: ['幽灵书'],
      }),
    );
  });

  it('表名索引仍使用未被手动选择的真实世界书条目', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
    };
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {
        未绑定真实书: [{ uid: 17, comment: 'TavernDB-ACU-CustomExport-关系档案' }],
      },
      invalidBookNames: [],
      failedBookNames: [],
      failedBooks: [],
      staleBookNames: ['幽灵书'],
    });
    mockResolveGeneratedEntriesForTable.mockImplementation((entries: any[], tableName: string) => (
      tableName === '关系档案' ? entries.filter((entry: any) => entry.bookName === '未绑定真实书') : []
    ));
    mockBuildCombinedWorldbookContentByStrategy.mockImplementation(async (options: any) => (
      typeof options.entryScope === 'function' ? '未绑定真实书内容' : '手动书内容'
    ));

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['手动书'] },
      tasks: [{
        id: 'unbound-table-book', name: '未绑定表名索引', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '表={{关系档案}}' }],
      }],
    }, '当前输入');

    const scopeOptions = mockBuildCombinedWorldbookContentByStrategy.mock.calls
      .map((call: any[]) => call[0])
      .find((options: any) => typeof options.entryScope === 'function');
    expect(scopeOptions.entryScope({ bookName: '未绑定真实书', uid: 17 })).toBe(true);
    expect(scopeOptions.entryScope({ bookName: '手动书', uid: 17 })).toBe(false);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    expect(mockCallApiWithPlotPreset.mock.calls[0][0][0].content).toContain('未绑定真实书内容');
  });

  it('finalSystemDirective 中的唯一表名也可在隔离幽灵书后完成解析', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
    };
    mockGetPlotPromptContentById.mockImplementation((_settings: any, promptId: string) => (
      promptId === 'finalSystemDirective' ? '最终指令={{关系档案}}' : ''
    ));
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {
        未绑定真实书: [{ uid: 18, comment: 'TavernDB-ACU-CustomExport-关系档案' }],
      },
      invalidBookNames: [],
      failedBookNames: [],
      failedBooks: [],
      staleBookNames: ['幽灵书'],
    });
    mockResolveGeneratedEntriesForTable.mockImplementation((entries: any[], tableName: string) => (
      tableName === '关系档案' ? entries : []
    ));
    mockBuildCombinedWorldbookContentByStrategy.mockImplementation(async (options: any) => (
      typeof options.entryScope === 'function' ? '最终指令世界书内容' : '普通世界书内容'
    ));

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['手动书'] },
      tasks: [{
        id: 'final-directive-table-book', name: '最终指令表名解析', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '任务正文不含表名' }],
      }],
    }, '当前输入');

    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['手动书'], expect.objectContaining({
      source: 'plot_table_index',
      validationPolicy: 'validate_list',
      notFoundPolicy: 'isolate_stale',
    }));
    expect(mockBuildFinalPlotInjectionMessage).toHaveBeenCalledWith(
      expect.stringContaining('最终指令世界书内容'),
      expect.any(Array),
      expect.anything(),
      expect.anything(),
    );
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[剧情推进][世界书] 表名索引已隔离宿主列表中的不存在世界书。',
      expect.objectContaining({
        phase: 'table_worldbook_index',
        source: 'plot_table_index',
        category: 'lorebook_not_found',
        isolatedCount: 1,
        staleBookNames: ['幽灵书'],
      }),
    );
  });

  it('同一运行内跨任务复用表名索引与每表 scope，不为 prompt segment 重复建立它们', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
      item_sheet: { name: '道具档案', exportConfig: { entryName: '道具档案' } },
    };
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {
        剧情书: [
          { uid: 7, comment: 'TavernDB-ACU-CustomExport-关系档案' },
          { uid: 8, comment: 'TavernDB-ACU-CustomExport-道具档案' },
        ],
      },
      invalidBookNames: [],
      failedBookNames: [],
      failedBooks: [],
      staleBookNames: [],
    });
    mockResolveGeneratedEntriesForTable.mockImplementation((entries: any[], tableName: string) => (
      entries.filter((entry: any) => (
        (tableName === '关系档案' && entry.uid === 7)
        || (tableName === '道具档案' && entry.uid === 8)
      ))
    ));

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [
        {
          id: 'table-index-a', name: '表名索引A', stage: 1, order: 1, maxRetries: 1,
          promptGroup: [{ role: 'user', content: '{{关系档案}} / {{道具档案}}' }],
        },
        {
          id: 'table-index-b', name: '表名索引B', stage: 1, order: 2, maxRetries: 1,
          promptGroup: [{ role: 'user', content: '{{关系档案}} / {{道具档案}}' }],
        },
      ],
    }, '当前输入');

    const tableIndexCalls = mockGetLorebookEntriesStrict.mock.calls.filter((call: any[]) => (
      call[1]?.source === 'plot_table_index'
    ));
    expect(tableIndexCalls).toHaveLength(1);
    expect(mockResolveGeneratedEntriesForTable).toHaveBeenCalledTimes(2);
    expect(mockResolveGeneratedEntriesForTable).toHaveBeenCalledWith(
      expect.any(Array), '关系档案', mockCurrentJsonTableDataRef.value,
    );
    expect(mockResolveGeneratedEntriesForTable).toHaveBeenCalledWith(
      expect.any(Array), '道具档案', mockCurrentJsonTableDataRef.value,
    );
  });

  it('唯一当前表名没有可用导出条目时替换为空，不保留 token', async () => {
    mockCurrentJsonTableDataRef.value = {
      empty_sheet: { name: '空表', exportConfig: { entryName: '空表' } },
    };
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {},
      invalidBookNames: [],
      failedBookNames: [],
      failedBooks: [],
      staleBookNames: [],
    });

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [{
        id: 'task-empty-table', name: '空表解析', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '表={{空表}}' }],
      }],
    }, '当前输入');

    expect(mockResolveGeneratedEntriesForTable).toHaveBeenCalledWith([], '空表', mockCurrentJsonTableDataRef.value);
    expect(mockCallApiWithPlotPreset.mock.calls[0][0][0].content).toBe('表=');
  });

  it('重名中文表名不作为表名占位符解析，并保留给既有渲染链路', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_a: { name: '关系档案', exportConfig: { entryName: '关系档案A' } },
      relation_b: { name: '关系档案', exportConfig: { entryName: '关系档案B' } },
    };

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [{
        id: 'task-duplicate-table', name: '重名表解析', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '表={{关系档案}}' }],
      }],
    }, '当前输入');

    expect(mockResolveGeneratedEntriesForTable).not.toHaveBeenCalled();
    expect(mockBuildCombinedWorldbookContentByStrategy.mock.calls.some((call: any[]) => (
      typeof call[0]?.entryScope === 'function'
    ))).toBe(false);
    expect(mockGetLorebookEntriesStrict.mock.calls.some((call: any[]) => (
      call[1]?.source === 'plot_table_index'
    ))).toBe(false);
    expect(mockLogWarn.mock.calls.some((call: any[]) => (
      call[1]?.phase === 'table_worldbook_index'
    ))).toBe(false);
    expect(mockBuildTaskWorldbookTriggerText.mock.calls[0][0][0].content).toBe('表={{关系档案}}');
    expect(mockCallApiWithPlotPreset.mock.calls[0][0][0].content).toBe('表={{关系档案}}');
  });

  it('没有表名 token 时不触发表名全量索引', async () => {
    mockCurrentJsonTableDataRef.value = {
      relation_sheet: { name: '关系档案', exportConfig: { entryName: '关系档案' } },
    };

    await runPlotTasksRuntime_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: ['剧情书'] },
      tasks: [{
        id: 'task-no-table-token', name: '无表名索引', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '不含表名占位符的普通任务' }],
      }],
    }, '当前输入');

    expect(mockGetLorebookEntriesStrict.mock.calls.some((call: any[]) => (
      call[1]?.source === 'plot_table_index'
    ))).toBe(false);
    expect(mockLogWarn.mock.calls.some((call: any[]) => (
      call[1]?.phase === 'table_worldbook_index'
    ))).toBe(false);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
  });

  it('未授权 token 时不读取场景因果视图，保持既有任务输出', async () => {
    const readSimulationCausalView = vi.fn();
    const callApi = vi.fn().mockResolvedValue('任务输出');
    await runPlotTasksRuntime_ACU({
      tasks: [{ id: 'plain-task', name: '普通任务', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '普通提示词' }] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        simulationScene: { time: { day: 1, slot: 'morning' }, location: { region: '测试区域', place: '测试地点' } },
        readSimulationCausalView, resolveTaskApiPreset: () => '', callApi,
      },
    });
    expect(readSimulationCausalView).not.toHaveBeenCalled();
    expect(mockRenderPlotSimulationSceneFacts).not.toHaveBeenCalled();
    expect(callApi).toHaveBeenCalledWith([{ role: 'user', content: '普通提示词' }], '');
  });

  it('原始 token 只读取一次，并只向 provider 发送渲染后的安全摘要', async () => {
    const view = { facts: [{ id: 'visible' }], locked: '不得泄露' } as any;
    const readSimulationCausalView = vi.fn(() => view);
    const callApi = vi.fn().mockResolvedValue('任务输出');
    mockRenderPlotSimulationSceneFacts.mockResolvedValue('公开摘要含 $9，不应二次替换');
    await runPlotTasksRuntime_ACU({
      tasks: [{ id: 'scene-task', name: '场景任务', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '场景：$SIMULATION_SCENE_FACTS' }] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        simulationScene: { time: { day: 1, slot: 'morning' }, location: { region: '测试区域', place: '测试地点' } },
        readSimulationCausalView, resolveTaskApiPreset: () => '', callApi,
      },
    });
    expect(readSimulationCausalView).toHaveBeenCalledTimes(1);
    expect(mockRenderPlotSimulationSceneFacts).toHaveBeenCalledTimes(1);
    expect(mockRenderPlotSimulationSceneFacts).toHaveBeenCalledWith(view, expect.objectContaining({
      signal: expect.any(AbortSignal),
      assertCurrent: expect.any(Function),
      scene: { time: { day: 1, slot: 'morning' }, location: { region: '测试区域', place: '测试地点' } },
    }));
    expect(callApi).toHaveBeenCalledWith([{ role: 'user', content: '场景：公开摘要含 $9，不应二次替换' }], '');
  });

  it('同一任务多个原始 token 仍只读取和渲染一次', async () => {
    const readSimulationCausalView = vi.fn(() => ({ facts: [] }));
    const callApi = vi.fn().mockResolvedValue('任务输出');
    await runPlotTasksRuntime_ACU({
      tasks: [{ id: 'scene-many', name: '多场景 token', stage: 1, order: 1, maxRetries: 1, promptGroup: [
        { role: 'user', content: '$SIMULATION_SCENE_FACTS / $SIMULATION_SCENE_FACTS' },
        { role: 'assistant', content: '$SIMULATION_SCENE_FACTS' },
      ] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        simulationScene: { time: { day: 1, slot: 'morning' }, location: { region: '测试区域', place: '测试地点' } },
        readSimulationCausalView, resolveTaskApiPreset: () => '', callApi,
      },
    });
    expect(readSimulationCausalView).toHaveBeenCalledTimes(1);
    expect(mockRenderPlotSimulationSceneFacts).toHaveBeenCalledTimes(1);
    expect(callApi.mock.calls[0][0]).toEqual([
      { role: 'user', content: '安全场景摘要 / 安全场景摘要' },
      { role: 'assistant', content: '安全场景摘要' },
    ]);
  });

  it('原始 token 缺失请求上下文或因果读取器时拒绝且不调用 API', async () => {
    const withoutContext = await runPlotTasksRuntime_ACU({
      tasks: [{ id: 'scene-missing-context', name: '缺少上下文', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '$SIMULATION_SCENE_FACTS' }] }],
    }, '当前输入');
    expect(withoutContext.failedResults[0].error).toContain('需要请求级上下文');
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();

    await expect(runPlotTasksRuntime_ACU({
      tasks: [{ id: 'scene-missing-reader', name: '缺少读取器', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '$SIMULATION_SCENE_FACTS' }] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        resolveTaskApiPreset: () => '', callApi: vi.fn(),
      },
    })).rejects.toThrow('需要已配置的因果视图读取器');
  });

  it('EJS 或 tag 渲染动态生成 token 时拒绝，不读取因果视图', async () => {
    const readSimulationCausalView = vi.fn();
    const callApi = vi.fn();
    mockTryRenderPlotTemplateWithEjs.mockImplementation(async (text: string) => (
      text === '<%= dynamic %>' ? '$SIMULATION_SCENE_FACTS' : text
    ));
    await expect(runPlotTasksRuntime_ACU({
      tasks: [{ id: 'dynamic-ejs', name: '动态 EJS token', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '<%= dynamic %>' }] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        simulationScene: { time: { day: 1, slot: 'morning' }, location: { region: '测试区域', place: '测试地点' } },
        readSimulationCausalView, resolveTaskApiPreset: () => '', callApi,
      },
    })).rejects.toThrow('动态生成了未授权');
    expect(readSimulationCausalView).not.toHaveBeenCalled();
    expect(mockRenderPlotSimulationSceneFacts).not.toHaveBeenCalled();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('最终系统指令含 token 时明确拒绝', async () => {
    mockGetPlotPromptContentById.mockImplementation((_settings: any, id: string) => id === 'finalSystemDirective' ? '$SIMULATION_SCENE_FACTS' : '');
    await expect(runPlotTasksRuntime_ACU({
      tasks: [{ id: 'directive-token', name: '指令 token', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '普通任务' }] }],
    }, '当前输入')).rejects.toThrow('最终系统指令不支持');
    expect(mockRenderPlotSimulationSceneFacts).not.toHaveBeenCalled();
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
  });

  it('场景摘要渲染失败或取消时拒绝，且不调用 API', async () => {
    const callApi = vi.fn();
    mockRenderPlotSimulationSceneFacts.mockRejectedValueOnce(new Error('scene renderer failed'));
    const makeContext = () => ({
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      simulationScene: { time: { day: 1, slot: 'morning' }, location: { region: '测试区域', place: '测试地点' } },
      readSimulationCausalView: vi.fn(() => ({ facts: [] })), resolveTaskApiPreset: () => '', callApi,
    });
    const settings = { tasks: [{ id: 'scene-failure', name: '场景失败', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '$SIMULATION_SCENE_FACTS' }] }] };
    await expect(runPlotTasksRuntime_ACU(settings, '当前输入', { requestContext: makeContext() })).rejects.toThrow('scene renderer failed');
    expect(callApi).not.toHaveBeenCalled();

    mockRenderPlotSimulationSceneFacts.mockRejectedValueOnce(new Error('TaskAbortedByUser'));
    await expect(runPlotTasksRuntime_ACU(settings, '当前输入', { requestContext: makeContext() })).rejects.toThrow('TaskAbortedByUser');
    expect(callApi).not.toHaveBeenCalled();
  });

  it.each([
    { isolated: false, acceptedTag: 'plot' },
    { isolated: true, acceptedTag: 'plot' },
    { isolated: false, acceptedTag: 'memory' },
    { isolated: true, acceptedTag: 'memory' },
  ])('重试直接重发原请求，任一配置标签闭合即通过（隔离调用=$isolated，标签=$acceptedTag）', async ({ isolated, acceptedTag }) => {
    const plotSettings = {
      tasks: [{
        id: 'tag-retry', name: '标签重试任务', stage: 1, order: 1, maxRetries: 3, minLength: 100,
        extractTags: 'plot,unused', extractInjectTags: 'memory',
        promptGroup: [{ role: 'user', content: 'tag-retry-prompt' }],
      }],
    };
    const acceptedContent = acceptedTag === 'memory' ? '' : '有效剧情'.repeat(30);
    const acceptedResponse = `${'足够长度的任务结果'.repeat(10)}<${acceptedTag}>${acceptedContent}</${acceptedTag}><unused>未闭合`;
    const shortResponse = '第一次没有标签';
    mockCallApiWithPlotPreset.mockResolvedValueOnce(shortResponse)
      .mockResolvedValueOnce(`${'第二次长度足够但无完整配置标签'.repeat(10)}<plot>未闭合<memory>未闭合<unknown>非配置标签</unknown>`)
      .mockResolvedValueOnce(acceptedResponse);
    const contextCall = vi.fn((messages: any[], preset: string) => mockCallApiWithPlotPreset(messages, preset));
    const requestContext = isolated ? {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      resolveTaskApiPreset: () => '', callApi: contextCall,
    } : undefined;
    const { extractPlotTagsFromResponse_ACU } = await vi.importActual<
      typeof import('../../../../src/service/runtime/plot-runtime/plot-tag-utils')
    >('../../../../src/service/runtime/plot-runtime/plot-tag-utils');
    mockExtractPlotTagsFromResponse.mockImplementation(extractPlotTagsFromResponse_ACU);

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入', { requestContext });

    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(3);
    expect(contextCall).toHaveBeenCalledTimes(isolated ? 3 : 0);
    const firstMessages = mockCallApiWithPlotPreset.mock.calls[0][0];
    const retryMessages = mockCallApiWithPlotPreset.mock.calls[1][0];
    const finalMessages = mockCallApiWithPlotPreset.mock.calls[2][0];
    expect(firstMessages).toEqual([{ role: 'user', content: 'tag-retry-prompt' }]);
    expect(retryMessages).toBe(firstMessages);
    expect(retryMessages).toEqual(firstMessages);
    expect(finalMessages).toBe(firstMessages);
    expect(finalMessages).toEqual(firstMessages);
    expect(mockExtractPlotTagsFromResponse).toHaveBeenCalledTimes(2);
    expect(mockAbortableDelay).toHaveBeenCalledTimes(2);
    expect(result.apiRetriesExhausted).not.toBe(true);
    expect(result.successfulResults).toEqual([
      expect.objectContaining({
        taskId: 'tag-retry',
        rawResponse: acceptedResponse,
        extractedTags: { [acceptedTag]: acceptedContent },
      }),
    ]);
  });

  it('配置标签缺失且重试耗尽时停止后续阶段，不保存不完整结果', async () => {
    const plotSettings = {
      tasks: [
        {
          id: 'tag-fail', name: '标签失败任务', stage: 1, order: 1, maxRetries: 2,
          extractTags: 'plot', promptGroup: [{ role: 'user', content: 'stage-1-tag-fail' }],
        },
        {
          id: 'tag-next', name: '后续任务', stage: 2, order: 1, maxRetries: 1,
          promptGroup: [{ role: 'user', content: 'stage-2-continue' }],
        },
      ],
    };
    mockCallApiWithPlotPreset.mockResolvedValue('始终无标签');
    mockExtractPlotTagsFromResponse.mockReturnValue({
      tagNames: ['plot'],
      extractedTags: {},
      injectedFragments: [],
      injectOnlyTags: {},
      injectOnlyFragments: [],
      injectOnlyTagNames: [],
    });

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(result.abortedByStageFailure).toBe(true);
    expect(result.apiRetriesExhausted).not.toBe(true);
    expect(result.finalMessage).toBeNull();
    expect(result.failedResults).toEqual([expect.objectContaining({ taskId: 'tag-fail', validationRetriesExhausted: true })]);
    expect(mockLogError).toHaveBeenCalledExactlyOnceWith('[剧情推进] 任务回复验收重试耗尽，本轮剧情推进失败。', {
      stage: 1,
      tasks: [{
        taskId: 'tag-fail',
        taskName: '标签失败任务',
        attempts: 2,
        reason: expect.stringContaining('任务回复未包含任何完整闭合的配置标签'),
      }],
    });
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain('始终无标签');
    expect(result.successfulResults).toHaveLength(0);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(2);
    const retryMessages = mockCallApiWithPlotPreset.mock.calls[1][0];
    expect(mockCallApiWithPlotPreset.mock.calls[0][0]).toHaveLength(1);
    expect(retryMessages).toBe(mockCallApiWithPlotPreset.mock.calls[0][0]);
    expect(retryMessages).toEqual(mockCallApiWithPlotPreset.mock.calls[0][0]);
    expect(mockCallApiWithPlotPreset.mock.calls.some((call: any[]) => call[0][0].content === 'stage-2-continue')).toBe(false);
    expect(mockSetTempPlotToSave).not.toHaveBeenCalled();
  });

  it('仅配置 extractInjectTags 且未提取标签时仍判定验收失败', async () => {
    const plotSettings = {
      tasks: [{
        id: 'inject-tag-fail', name: '注入标签失败任务', stage: 1, order: 1, maxRetries: 1,
        extractInjectTags: 'memory', promptGroup: [{ role: 'user', content: 'inject-tag-fail-prompt' }],
      }],
    };
    mockCallApiWithPlotPreset.mockResolvedValue('没有注入标签');
    mockExtractPlotTagsFromResponse.mockReturnValue({
      tagNames: ['memory'],
      extractedTags: {},
      injectedFragments: [],
      injectOnlyTags: {},
      injectOnlyFragments: [],
      injectOnlyTagNames: [],
    });

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(result.abortedByStageFailure).toBe(true);
    expect(result.apiRetriesExhausted).not.toBe(true);
    expect(result.finalMessage).toBeNull();
    expect(result.failedResults).toEqual([expect.objectContaining({ taskId: 'inject-tag-fail', validationRetriesExhausted: true })]);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0][1]).toMatchObject({
      stage: 1, tasks: [{ taskId: 'inject-tag-fail', attempts: 1 }],
    });
    expect(result.successfulResults).toHaveLength(0);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'success', expected: '' },
    { kind: 'empty', expected: '上一轮没有返回非空文本' },
    { kind: 'extraction', expected: '标签提取发生异常' },
    { kind: 'api', error: { status: 401 }, expected: '鉴权或访问权限失败（HTTP 401）' },
    { kind: 'api', error: { status: 403 }, expected: '鉴权或访问权限失败（HTTP 403）' },
    { kind: 'api', error: { status: 408 }, expected: '请求超时（HTTP 408）' },
    { kind: 'api', error: { status: 504 }, expected: '请求超时（HTTP 504）' },
    { kind: 'api', error: { status: 413 }, expected: '请求体超过服务允许的大小（HTTP 413）' },
    { kind: 'api', error: { status: 429 }, expected: '限流或配额受限（HTTP 429）' },
    { kind: 'api', error: { status: 503 }, expected: '服务端异常（HTTP 503）' },
    { kind: 'api', error: { status: 400 }, expected: '拒绝了请求（HTTP 400）' },
    { kind: 'api', error: { code: 'API_PRESET_UNRESOLVED' }, expected: '预设无法解析' },
    { kind: 'api', error: { name: 'TimeoutError' }, expected: '请求超时，未取得有效响应' },
    { kind: 'api', error: { name: 'AbortError' }, expected: '请求被中止（停止生成、切换聊天或宿主取消）' },
    { kind: 'api', error: { name: 'TypeError' }, expected: '网络或传输异常' },
    { kind: 'api', error: {}, expected: '具体原因尚未确认' },
  ])('未配置标签时按长度验收，$kind 重试原请求且诊断不进入消息：$expected', async ({ kind, error, expected }) => {
    const plotSettings = {
      tasks: [{
        id: 'no-tag-config', name: '无标签配置任务', stage: 1, order: 1, maxRetries: 2, minLength: 2,
        promptGroup: [{ role: 'user', content: 'no-tag-config-prompt' }],
      }],
    };
    const sensitiveText = '私密接口正文 https://private.example token=secret';
    mockCallApiWithPlotPreset.mockResolvedValue('正常输出');
    if (kind === 'empty') mockCallApiWithPlotPreset.mockResolvedValueOnce('  ');
    if (kind === 'api') {
      mockCallApiWithPlotPreset.mockRejectedValueOnce(Object.assign(new Error(sensitiveText), error));
    }
    mockExtractPlotTagsFromResponse.mockReturnValue({
      tagNames: [],
      extractedTags: {},
      injectedFragments: [],
      injectOnlyTags: {},
      injectOnlyFragments: [],
      injectOnlyTagNames: [],
    });
    if (kind === 'extraction') {
      mockExtractPlotTagsFromResponse.mockImplementationOnce(() => { throw new Error(sensitiveText); });
    }

    const result = await runPlotTasksRuntime_ACU(plotSettings, '当前输入');

    expect(result.successfulResults).toEqual([
      expect.objectContaining({ taskId: 'no-tag-config', rawResponse: '正常输出' }),
    ]);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(kind === 'success' ? 1 : 2);
    expect(mockExtractPlotTagsFromResponse).toHaveBeenCalledTimes(kind === 'extraction' ? 2 : 1);
    const firstMessages = mockCallApiWithPlotPreset.mock.calls[0][0];
    expect(firstMessages).toEqual([{ role: 'user', content: 'no-tag-config-prompt' }]);
    if (kind !== 'success') {
      const retryMessages = mockCallApiWithPlotPreset.mock.calls[1][0];
      expect(retryMessages).toBe(firstMessages);
      expect(retryMessages).toEqual(firstMessages);
      expect(JSON.stringify(retryMessages)).not.toContain(sensitiveText);
      expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(sensitiveText);
      if (kind === 'api') expect(JSON.stringify(mockLogWarn.mock.calls)).toContain(expected);
      expect(mockAbortableDelay).toHaveBeenCalledTimes(1);
    }
  });

  it.each([false, true])('完整世界资料在模板处理后进入各推进任务，隔离上下文=%s，最终只保留模型任务输出', async isolated => {
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    ledger.clock = { day: 9, slot: '上午', storyTime: '第九日上午', precision: 'exact', evidenceRefs: [] };
    ledger.facts = [{ id: 'distant-secret', summary: 'DISTANT_LOCKED_CAUSAL_BACKGROUND', temporalKind: 'condition',
      happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: null, locationRef: { region: '远方', place: '密室' },
      actorIds: [], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked', revealGate: null,
      nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    const worldContext = buildPlotWorldContext_ACU({ ledger, previousLedger: null, summary: '已确认的推演结果' });
    const callApi = vi.fn(async (_messages: any, _name: string) => '推进模型自行处理后的结果');
    mockCallApiWithPlotPreset.mockResolvedValue('推进模型自行处理后的结果');
    if (!isolated) mockCreateOrdinaryPlotCausalContext.mockResolvedValue({ worldContext });
    const requestContext = isolated ? {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readWorldSimulationContext: () => structuredClone(worldContext), resolveTaskApiPreset: () => '', callApi,
    } : undefined;
    const result = await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'recall', stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '仅执行召回任务' }] },
      { id: 'physio', stage: 2, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '仅执行生理任务' }] },
    ] }, '继续', { requestContext });
    const calls = isolated ? callApi.mock.calls : mockCallApiWithPlotPreset.mock.calls;
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      const messages = args[0] as Array<{ role: string; content: string }>;
      expect(messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('[[ACU_WORLD_SIMULATION_CONTEXT]]') });
      const input = JSON.parse(messages.at(-1)!.content.split('\n').at(-1)!);
      expect(Object.keys(input)).toEqual(['clock', 'round', 'worldEvents', 'actors', 'facts', 'historyMilestones']);
      expect(input.clock.day).toBe(9);
      expect(input.facts.hot[0]).toMatchObject({ summary: 'DISTANT_LOCKED_CAUSAL_BACKGROUND', revealState: 'locked' });
      if (!isolated) expect(args[3]).toBeUndefined();
    }
    expect(JSON.stringify(mockTryRenderPlotTemplateWithEjs.mock.calls)).not.toContain('DISTANT_LOCKED_CAUSAL_BACKGROUND');
    expect(JSON.stringify(result)).not.toContain('DISTANT_LOCKED_CAUSAL_BACKGROUND');
    expect(JSON.stringify(mockSetTempPlotToSave.mock.calls)).not.toContain('DISTANT_LOCKED_CAUSAL_BACKGROUND');
    expect(JSON.stringify(mockLogDebug.mock.calls)).not.toContain('DISTANT_LOCKED_CAUSAL_BACKGROUND');
    expect(result.successfulResults).toHaveLength(2);
  });

  it('任意任务及预设的原始 token 在全部模板和继电之后就地插入六键冷热完整资料，且不追加第二份 system', async () => {
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    ledger.clock.day = 11;
    ledger.worldEvents = [{ id: 'unseen-event', title: '远方密谋', state: '仍在策划', status: 'active',
      actorIds: ['hidden-actor'], organizationIds: [], locationRefs: [{ region: '远方' }],
      startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [],
      evidenceRefs: [], tags: [], revision: 1, legacy: null }];
    ledger.actors = [{ id: 'hidden-actor', name: '幕后人物', interests: [], location: '远方',
      locationRef: { region: '远方' }, life: 'alive', diedAtDay: null, deathSummary: null,
      resources: [], goals: ['尚未完成的目标'], constraints: [], informationSources: ['信使'],
      knownFacts: ['仅知密函存在'], visibility: 'hidden', currentAction: null, longTermAction: null,
      shortTermAction: null, experiences: [], revision: 1 }];
    const lockedFact = {
      id: 'locked-hot', summary: 'HOT_LOCKED_SECRET_$8/{{tag}}/<%= ready %>', temporalKind: 'condition' as const,
      happenedAt: null, validFrom: { day: 2, slot: '' }, validUntil: null,
      locationRef: { region: '远方', place: '密室' }, actorIds: [], worldEventIds: [],
      projectionPolicy: 'internal' as const, revealState: 'locked' as const,
      revealGate: { condition: '取得线索' }, nextCheck: null, sourceRefs: [], evidenceRefs: [],
      supersedesFactIds: [], revision: 1,
    };
    ledger.facts = [lockedFact];
    ledger.factArchive = [{ ...lockedFact, id: 'locked-cold', summary: 'COLD_LOCKED_SECRET' }];
    const milestone = {
      id: 'hot-milestone', summary: 'HOT_MILESTONE', happenedAt: { day: 3, slot: '夜' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: ['locked-hot'],
      importance: 3, category: '历史', visibility: 'internal' as const, revision: 1, legacyRefs: [],
    };
    ledger.historyMilestones = [milestone];
    ledger.historyArchive = [{ ...milestone, id: 'cold-milestone', summary: 'COLD_MILESTONE' }];
    const context = buildPlotWorldContext_ACU({ ledger, previousLedger: null, summary: 'ROUND_SECRET' });
    const readWorldSimulationContext = vi.fn(() => structuredClone(context));
    const callApi = vi.fn().mockResolvedValue('模型自己的推进结果');
    const forbidden = ['HOT_LOCKED_SECRET', 'COLD_LOCKED_SECRET', 'ROUND_SECRET'];
    mockTryRenderPlotTemplateWithEjs.mockImplementation(async (text: string) => {
      for (const secret of forbidden) expect(text).not.toContain(secret);
      return text.replaceAll('<%= ready %>', 'EJS已执行');
    });
    mockReplacePlotTagPlaceholders.mockImplementation((text: string) => {
      for (const secret of forbidden) expect(text).not.toContain(secret);
      return text.replaceAll('{{tag}}', '继电已执行');
    });
    mockRenderPlotTaskContentWithIsolatedVariables.mockImplementation((text: string) => {
      for (const secret of forbidden) expect(text).not.toContain(secret);
      return text.replaceAll('{{variable}}', '变量已执行');
    });
    const result = await runPlotTasksRuntime_ACU({ tasks: [{
      id: 'user-defined-task-42', name: '自由配置的任务', stage: 1, order: 1, maxRetries: 1,
      promptGroup: [
        { role: 'system', content: '先执行 <%= ready %> 和 {{tag}}' },
        { role: 'user', content: '前 $8 / {{variable}} / $WORLD_SIMULATION / $WORLD_SIMULATION 后' },
      ],
    }] }, '当前输入', { requestContext: {
      history: [], tableData: {}, presetName: 'custom-preset', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readWorldSimulationContext, resolveTaskApiPreset: () => 'any-preset', callApi,
    } });

    expect(readWorldSimulationContext).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledTimes(1);
    const [messages, preset] = callApi.mock.calls[0] as [Array<{ role: string; content: string }>, string];
    expect(preset).toBe('any-preset');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: '先执行 EJS已执行 和 继电已执行' });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('前 当前输入 / 变量已执行 / [[ACU_WORLD_SIMULATION_CONTEXT]]');
    expect(messages[1].content.match(/\[\[ACU_WORLD_SIMULATION_CONTEXT\]\]/g)).toHaveLength(2);
    const inserted = messages[1].content.match(/\[\[ACU_WORLD_SIMULATION_CONTEXT\]\][^]*?\n(\{[^\n]+\})/);
    expect(inserted).not.toBeNull();
    const payload = JSON.parse(inserted![1]);
    expect(Object.keys(payload)).toEqual(['clock', 'round', 'worldEvents', 'actors', 'facts', 'historyMilestones']);
    expect(payload).toEqual(context);
    expect(payload.clock.day).toBe(11);
    expect(payload.round.summary).toBe('ROUND_SECRET');
    expect(payload.worldEvents[0]).toMatchObject({ id: 'unseen-event', state: '仍在策划' });
    expect(payload.actors[0]).toMatchObject({ id: 'hidden-actor', goals: ['尚未完成的目标'], knownFacts: ['仅知密函存在'] });
    expect(payload.facts.hot[0]).toMatchObject({ storage: 'hot', revealState: 'locked', summary: lockedFact.summary });
    expect(payload.facts.cold[0]).toMatchObject({ storage: 'cold', revealState: 'locked', summary: 'COLD_LOCKED_SECRET' });
    expect(payload.historyMilestones.hot[0].summary).toBe('HOT_MILESTONE');
    expect(payload.historyMilestones.cold[0].summary).toBe('COLD_MILESTONE');
    expect(messages[1].content).toContain('HOT_LOCKED_SECRET_$8/{{tag}}/<%= ready %>');
    expect(messages[1].content).not.toContain('HOT_LOCKED_SECRET_当前输入/继电已执行/EJS已执行');
    expect(result.successfulResults).toEqual([expect.objectContaining({ rawResponse: '模型自己的推进结果' })]);
    expect(result.finalMessage).toBe('最终注入消息');
    expect(result.saveContent).toBe('保存的剧情内容');
    expect(JSON.stringify(result)).not.toContain('HOT_LOCKED_SECRET');
    expect(JSON.stringify(mockBuildFinalPlotInjectionMessage.mock.calls)).not.toContain('HOT_LOCKED_SECRET');
    expect(JSON.stringify(mockTryRenderPlotTemplateWithEjs.mock.calls)).not.toContain('HOT_LOCKED_SECRET');
    expect(JSON.stringify(mockReplacePlotTagPlaceholders.mock.calls)).not.toContain('HOT_LOCKED_SECRET');
  });

  it.each([false, true])('token 缺资料时就地清空、不留下占位或追加空 system；隔离请求=%s', async isolated => {
    mockCreateOrdinaryPlotCausalContext.mockResolvedValue(null);
    const callApi = vi.fn().mockResolvedValue('模型回复');
    const readWorldSimulationContext = vi.fn(() => null);
    const requestContext = isolated ? {
      history: [], tableData: {}, presetName: 'another-preset', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readWorldSimulationContext, resolveTaskApiPreset: () => 'another-preset', callApi,
    } : undefined;
    const result = await runPlotTasksRuntime_ACU({ tasks: [{
      id: 'unrelated-task', stage: 1, order: 1, maxRetries: 1,
      promptGroup: [{ role: 'user', content: '前 $WORLD_SIMULATION 后' }],
    }] }, '继续', { requestContext });
    const actualCall = isolated ? callApi : mockCallApiWithPlotPreset;
    expect(actualCall).toHaveBeenCalledTimes(1);
    expect(actualCall.mock.calls[0][0]).toEqual([{ role: 'user', content: '前  后' }]);
    if (isolated) expect(readWorldSimulationContext).toHaveBeenCalledTimes(1);
    else expect(mockCreateOrdinaryPlotCausalContext).toHaveBeenCalledWith(expect.objectContaining({ explicitWorldSimulation: true }));
    expect(result.successfulResults).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('$WORLD_SIMULATION');
  });

  it('同组任意任务显式使用 token 时只投送该任务，不向无 token 的时间召回隐式追加完整资料', async () => {
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const secret = 'ONLY_EXPLICIT_TASK_SEES_WORLD';
    const context = buildPlotWorldContext_ACU({ ledger, previousLedger: null, summary: secret });
    mockCreateOrdinaryPlotCausalContext.mockResolvedValue({ worldContext: context });
    mockSettings.plotApiPreset = 'shared-preset';
    mockSettings.plotTaskApiPresetOverridesById = { 'free-task-name': 'alternate-preset' };
    const result = await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'time-recall-custom', name: '时间召回', stage: 1, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '只召回当前时间' }] },
      { id: 'free-task-name', name: '任意推进任务', stage: 1, order: 2, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '此处读取：$WORLD_SIMULATION' }] },
    ] }, '继续');

    expect(mockCreateOrdinaryPlotCausalContext).toHaveBeenCalledWith(expect.objectContaining({ explicitWorldSimulation: true }));
    expect(result.successfulResults).toHaveLength(2);
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(2);
    const recallCall = mockCallApiWithPlotPreset.mock.calls.find((call: any[]) => call[0][0].content === '只召回当前时间');
    const explicitCall = mockCallApiWithPlotPreset.mock.calls.find((call: any[]) => call[0][0].content.startsWith('此处读取：'));
    expect(recallCall).toBeDefined();
    expect(recallCall![0]).toEqual([{ role: 'user', content: '只召回当前时间' }]);
    expect(recallCall![1]).toBe('shared-preset');
    expect(JSON.stringify(recallCall![0])).not.toContain(secret);
    expect(explicitCall).toBeDefined();
    expect(explicitCall![1]).toBe('alternate-preset');
    expect(explicitCall![0]).toHaveLength(1);
    expect(explicitCall![0][0].content).toContain(`[[ACU_WORLD_SIMULATION_CONTEXT]]`);
    expect(explicitCall![0][0].content).toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('普通入口从任意启用任务的原文识别 token，不绑定任务 id 或预设；无 token 保留旧末尾 system 行为', async () => {
    const context = buildPlotWorldContext_ACU({ ledger: buildDefaultWorldSimulationEnvelope_ACU().ledger, previousLedger: null, summary: '幕后资料' });
    mockCreateOrdinaryPlotCausalContext.mockResolvedValue({ worldContext: context });
    mockSettings.plotApiPreset = 'different-global-preset';
    mockSettings.plotTaskApiPresetOverridesById = { 'my-custom-task': 'user-selected-preset' };
    await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'my-custom-task', enabled: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '资料就在这里：$WORLD_SIMULATION' }] },
      { id: 'disabled-token', enabled: false, stage: 1, order: 2, maxRetries: 1, promptGroup: [{ role: 'user', content: '$WORLD_SIMULATION' }] },
    ] }, '继续');
    expect(mockCreateOrdinaryPlotCausalContext).toHaveBeenCalledWith(expect.objectContaining({ explicitWorldSimulation: true }));
    expect(mockCallApiWithPlotPreset).toHaveBeenCalledTimes(1);
    const [tokenMessages, tokenPreset] = mockCallApiWithPlotPreset.mock.calls[0];
    expect(tokenPreset).toBe('user-selected-preset');
    expect(tokenMessages).toHaveLength(1);
    expect(tokenMessages[0].content).toContain('资料就在这里：[[ACU_WORLD_SIMULATION_CONTEXT]]');

    mockCreateOrdinaryPlotCausalContext.mockClear();
    mockCallApiWithPlotPreset.mockClear();
    await runPlotTasksRuntime_ACU({ tasks: [{
      id: 'another-unrelated-task', stage: 1, order: 1, maxRetries: 1,
      promptGroup: [{ role: 'user', content: '这次没有占位符' }],
    }] }, '继续');
    expect(mockCreateOrdinaryPlotCausalContext).toHaveBeenCalledWith(expect.objectContaining({ explicitWorldSimulation: false }));
    const legacyMessages = mockCallApiWithPlotPreset.mock.calls[0][0];
    expect(legacyMessages).toHaveLength(2);
    expect(legacyMessages[0]).toEqual({ role: 'user', content: '这次没有占位符' });
    expect(legacyMessages[1]).toMatchObject({ role: 'system', content: expect.stringContaining('[[ACU_WORLD_SIMULATION_CONTEXT]]') });
  });

  it('最终系统指令明确拒绝完整资料 token，原文不进入最终正文或模型调用', async () => {
    const secret = 'FINAL_DIRECTIVE_WORLD_SECRET';
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const context = buildPlotWorldContext_ACU({ ledger, previousLedger: null, summary: secret });
    mockCreateOrdinaryPlotCausalContext.mockResolvedValue({ worldContext: context });
    mockGetPlotPromptContentById.mockImplementation((_settings: any, id: string) => id === 'finalSystemDirective'
      ? '最终写作：$WORLD_SIMULATION' : '');
    await expect(runPlotTasksRuntime_ACU({ tasks: [{
      id: 'directive-world-token', stage: 1, order: 1, maxRetries: 1,
      promptGroup: [{ role: 'user', content: '正常任务' }],
    }] }, '继续')).rejects.toThrow('仅用于推进任务提示词');
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
    expect(mockBuildFinalPlotInjectionMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain(secret);
  });

  it('内部因果任务只走专用调用器，秘密回复不会进入公开结果、保存、继电或日志', async () => {
    const secret = 'INTERNAL_SECRET_MARKER_不得泄露';
    const callApi = vi.fn().mockResolvedValue('公开后续结果');
    const selected = { schemaVersion: 1 as const, viewFingerprint: 'a'.repeat(64), selectedFactIds: ['fact-1'] };
    const callInternalApi = vi.fn().mockResolvedValue(JSON.stringify({ selectedFactIds: ['fact-1'] }));
    const acceptInternalCausalResult = vi.fn();
    const requestContext = {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readSimulationCausalView: vi.fn(() => ({ revision: 1 })), acceptInternalCausalResult, resolveTaskApiPreset: () => '', callApi, callInternalApi,
    };
    const result = await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'internal', name: '内部', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, extractTags: 'leak', promptGroup: [{ role: 'user', content: '内部常规提示词' }] },
      { id: 'public', name: '公开', stage: 2, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '公开常规提示词' }] },
    ] }, '当前输入', { requestContext });

    expect(callInternalApi).toHaveBeenCalledTimes(1);
    expect(callInternalApi.mock.calls[0][0]).toEqual([
      { role: 'user', content: '内部常规提示词' },
      { role: 'system', content: '内部因果资料' },
    ]);
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi.mock.calls[0][0]).toEqual([{ role: 'user', content: '公开常规提示词' }]);
    expect(mockExtractPlotTagsFromResponse).toHaveBeenCalledTimes(1);
    expect(mockParsePlotInternalCausalResult).toHaveBeenCalledWith(JSON.stringify({ selectedFactIds: ['fact-1'] }), { revision: 1 });
    expect(acceptInternalCausalResult).toHaveBeenCalledOnce();
    expect(acceptInternalCausalResult).toHaveBeenCalledWith(selected);
    expect(result.internalTaskCount).toBe(1);
    expect(result.successfulResults).toEqual([expect.objectContaining({ taskId: 'public', rawResponse: '公开后续结果' })]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(mockSetTempPlotToSave.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(mockLogDebug.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(secret);
  });

  it('内部因果任务缺少读取器或专用调用器时，在任何 API 前拒绝', async () => {
    const internal = { id: 'internal-preflight', name: '内部预检', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '内部' }] };
    const callApi = vi.fn();
    await expect(runPlotTasksRuntime_ACU({ tasks: [internal] }, '当前输入')).rejects.toThrow('需要请求级上下文');
    await expect(runPlotTasksRuntime_ACU({ tasks: [internal] }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        resolveTaskApiPreset: () => '', callApi,
      },
    })).rejects.toThrow('需要已配置的因果视图读取器');
    await expect(runPlotTasksRuntime_ACU({ tasks: [
      { id: 'public-preflight', name: '同阶段公开', stage: 1, order: 0, promptGroup: [{ role: 'user', content: '公开' }] },
      internal,
    ] }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        readSimulationCausalView: vi.fn(), resolveTaskApiPreset: () => '', callApi,
      },
    })).rejects.toThrow('需要专用内部 API 调用器');
    expect(callApi).not.toHaveBeenCalled();
    expect(mockCallApiWithPlotPreset).not.toHaveBeenCalled();
  });

  it('仅内部因果任务不生成正文或保存内容', async () => {
    const callInternalApi = vi.fn().mockResolvedValue(JSON.stringify({ selectedFactIds: [] }));
    const result = await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'internal-only', name: '仅内部', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '内部' }] },
    ] }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        readSimulationCausalView: vi.fn(() => ({ revision: 1 })), resolveTaskApiPreset: () => '', callApi: vi.fn(), callInternalApi,
      },
    });
    expect(result.finalMessage).toBeNull();
    expect(result.saveContent).toBeUndefined();
    expect(result.successfulResults).toEqual([]);
    expect(result.internalTaskCount).toBe(1);
  });

  it('内部因果视图在模型响应前替换为另一合法快照时拒绝，不交付 sink', async () => {
    const viewA = { revision: 1, fingerprint: 'a'.repeat(64) };
    const viewB = { revision: 1, fingerprint: 'b'.repeat(64) };
    let reads = 0;
    const acceptInternalCausalResult = vi.fn();
    const result = await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'internal', name: '内部', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '内部' }] },
    ] }, '当前输入', { requestContext: {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readSimulationCausalView: vi.fn(() => (++reads === 1 ? viewA : viewB)), acceptInternalCausalResult,
      resolveTaskApiPreset: () => '', callApi: vi.fn(), callInternalApi: vi.fn().mockResolvedValue(JSON.stringify({ selectedFactIds: [] })),
    } });
    expect(result.failedResults).toEqual([expect.objectContaining({ internalCausalRead: true })]);
    expect(acceptInternalCausalResult).not.toHaveBeenCalled();
  });

  it('内部因果结果在全部阶段成功后才批量交付，后续阶段失败时不调用 sink', async () => {
    const acceptInternalCausalResult = vi.fn();
    const callInternalApi = vi.fn().mockResolvedValue(JSON.stringify({ selectedFactIds: ['fact-1'] }));
    const callApi = vi.fn().mockResolvedValue('');
    const result = await runPlotTasksRuntime_ACU({ tasks: [
      { id: 'internal', name: '内部', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '内部' }] },
      { id: 'failing-public', name: '失败公开', stage: 2, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '公开' }] },
    ] }, '当前输入', { requestContext: {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readSimulationCausalView: vi.fn(() => ({ revision: 1 })), acceptInternalCausalResult,
      resolveTaskApiPreset: () => '', callApi, callInternalApi,
    } });
    expect(result.abortedByStageFailure).toBe(true);
    expect(acceptInternalCausalResult).not.toHaveBeenCalled();
  });

  it('内部结果 sink 抛错时安全失败且不泄漏模型回复', async () => {
    const secret = 'INTERNAL_SINK_SECRET';
    const acceptInternalCausalResult = vi.fn(() => { throw new Error(secret); });
    const callInternalApi = vi.fn().mockResolvedValue(JSON.stringify({ selectedFactIds: [] }));
    await expect(runPlotTasksRuntime_ACU({ tasks: [
      { id: 'internal', name: '内部', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '内部' }] },
    ] }, '当前输入', { requestContext: {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
      readSimulationCausalView: vi.fn(() => ({ revision: 1 })), acceptInternalCausalResult,
      resolveTaskApiPreset: () => '', callApi: vi.fn(), callInternalApi,
    } })).rejects.toThrow('内部因果结果交付失败');
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain(secret);
  });

  it('内部因果资料构建异常或取消时不调用 API，取消继续抛出', async () => {
    const callInternalApi = vi.fn();
    const assertCurrent = vi.fn();
    const context = {
      history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
      sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent,
      readSimulationCausalView: vi.fn(() => ({ revision: 1 })), resolveTaskApiPreset: () => '', callApi: vi.fn(), callInternalApi,
    };
    const settings = { tasks: [{ id: 'internal-build', name: '内部构建', internalCausalRead: true, stage: 1, order: 1, maxRetries: 1, promptGroup: [{ role: 'user', content: '内部' }] }] };
    mockBuildPlotInternalCausalMessage.mockRejectedValueOnce(new Error('secret build failure'));
    const failed = await runPlotTasksRuntime_ACU(settings, '当前输入', { requestContext: context });
    expect(failed.failedResults).toEqual([expect.objectContaining({ internalCausalRead: true, error: '内部因果资料准备失败。' })]);
    expect(callInternalApi).not.toHaveBeenCalled();

    mockBuildPlotInternalCausalMessage.mockRejectedValueOnce(new Error('TaskAbortedByUser'));
    await expect(runPlotTasksRuntime_ACU(settings, '当前输入', { requestContext: context })).rejects.toThrow('TaskAbortedByUser');
    expect(callInternalApi).not.toHaveBeenCalled();
  });

});