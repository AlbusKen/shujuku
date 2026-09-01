/**
 * tests/service/settings/settings-service.test.ts
 * 设置加载/保存编排 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockGlobalMeta,
  mockGetConfigStorage,
  mockIsIndexedDbAvailable,
  mockInitTavernSettingsBridge,
  mockPersistSettingsToStorage,
  mockAddDataIsolationHistory,
  mockNormalizeDataIsolationHistory,
  mockSaveGlobalMeta,
  mockLoadGlobalMeta,
  mockReadProfileSettings,
  mockReadProfileTemplate,
  mockWriteProfileSettings,
  mockWriteProfileTemplate,
  mockSanitizeSettingsForProfileSave,
  mockEnsureProfileExists,
  mockSetSettings,
  mockSetTableTemplate,
  mockGetCurrentIsolationKey,
  mockGetCurrentCharSettings,
  mockGetCurrentWorldbookConfig,
  mockEnsureTagRulesCompat,
  mockNormalizeTemplatePresetSelectionValue,
  mockGetCurrentTemplatePresetName,
  mockGetCurrentChatTemplateScopeState,
  mockMigrateLegacyTemplateScopeForCurrentChat,
  mockNormalizeTemplateScopeIsolationKey,
  mockSanitizeTemplateSnapshotForChat,
  mockGetTemplatePreset,
  mockGetDefaultTemplateSnapshot,
  mockGetGlobalTemplateSnapshotForCurrentProfile,
  mockSanitizeChatSheetsObject,
  mockEnsureSheetOrderNumbers,
  mockEnsureConfigIdbCacheLoaded,
  mockMigrateKeyToTavernStorage,
  mockSetPendingSettingsReloadFromIdb,
  DEFAULT_TEMPLATE_STR_ACU,
  NEW_DEFAULT_TEMPLATE_STR_ACU,
  CUSTOM_TEMPLATE_STR_ACU,
} = vi.hoisted(() => {
  const mockSettings: any = {
    dataIsolationCode: '',
    dataIsolationEnabled: false,
    charCardPrompt: [],
    mergeSummaryPrompt: '',
    mergeTargetCount: 1,
    mergeBatchSize: 5,
    mergeStartIndex: 1,
    mergeEndIndex: null,
    autoMergeEnabled: false,
    autoMergeThreshold: 20,
    autoMergeReserve: 0,
    deleteStartFloor: null,
    deleteEndFloor: null,
    plotSettings: { plotWorldbookConfig: null },
    plotPresetBindings: {},
    currentTemplatePresetName: '',
    maxConcurrentGroups: 1,
    zeroTkOccupyModeDefault: false,
    characterSettings: {},
  };
  const mockGlobalMeta: any = {
    activeIsolationCode: '',
    isolationCodeList: [],
    migratedLegacySingleStore: true,
    zeroTkOccupyModeGlobal: false,
  };
  const DEFAULT_TEMPLATE_STR_ACU = '{"mate":{"type":"chatSheets","version":1},"sheet_0":{"name":"默认表","content":[["row_id","值"]],"sourceData":{"ddl":"CREATE TABLE default_table (row_id INTEGER PRIMARY KEY, value TEXT);"}}}';
  const NEW_DEFAULT_TEMPLATE_STR_ACU = '{"mate":{"type":"chatSheets","version":1},"sheet_0":{"name":"默认表","content":[["row_id","值"]],"sourceData":{"ddl":"CREATE TABLE default_table (row_id INTEGER PRIMARY KEY, value TEXT);"},"updated":true}}';
  const CUSTOM_TEMPLATE_STR_ACU = '{"mate":{"type":"chatSheets","version":1},"sheet_custom":{"name":"自定义表","content":[["row_id","自定义列"]],"sourceData":{"ddl":"CREATE TABLE custom_table (row_id INTEGER PRIMARY KEY, custom_value TEXT);"}}}';
  return {
    mockSettings,
    mockGlobalMeta,
    mockGetConfigStorage: vi.fn(),
    mockIsIndexedDbAvailable: vi.fn(() => false),
    mockInitTavernSettingsBridge: vi.fn().mockResolvedValue(undefined),
    mockPersistSettingsToStorage: vi.fn(),
    mockAddDataIsolationHistory: vi.fn(),
    mockNormalizeDataIsolationHistory: vi.fn(),
    mockSaveGlobalMeta: vi.fn(),
    mockLoadGlobalMeta: vi.fn(),
    mockReadProfileSettings: vi.fn(() => null),
    mockReadProfileTemplate: vi.fn(() => null),
    mockWriteProfileSettings: vi.fn(),
    mockWriteProfileTemplate: vi.fn(),
    mockSanitizeSettingsForProfileSave: vi.fn((obj: any) => ({ ...obj })),
    mockEnsureProfileExists: vi.fn(),
    mockSetSettings: vi.fn((newSettings: any) => {
      Object.assign(mockSettings, newSettings);
    }),
    mockSetTableTemplate: vi.fn(),
    mockGetCurrentIsolationKey: vi.fn(() => ''),
    mockGetCurrentCharSettings: vi.fn(() => ({ worldbookConfig: { zeroTkOccupyMode: false, outlineEntryEnabled: true } })),
    mockGetCurrentWorldbookConfig: vi.fn(() => ({ zeroTkOccupyMode: false, outlineEntryEnabled: true })),
    mockEnsureTagRulesCompat: vi.fn(),
    mockNormalizeTemplatePresetSelectionValue: vi.fn((v: any) => v || ''),
    mockGetCurrentTemplatePresetName: vi.fn(() => ''),
    mockGetCurrentChatTemplateScopeState: vi.fn(() => null),
    mockMigrateLegacyTemplateScopeForCurrentChat: vi.fn(() => null),
    mockNormalizeTemplateScopeIsolationKey: vi.fn((key: any) => key || ''),
    mockSanitizeTemplateSnapshotForChat: vi.fn((str: any) => str ? { templateStr: str } : null),
    mockGetTemplatePreset: vi.fn(() => null),
    mockGetDefaultTemplateSnapshot: vi.fn(() => null),
    mockGetGlobalTemplateSnapshotForCurrentProfile: vi.fn(() => null),
    mockSanitizeChatSheetsObject: vi.fn((obj: any) => obj),
    mockEnsureSheetOrderNumbers: vi.fn(() => false),
    mockEnsureConfigIdbCacheLoaded: vi.fn().mockResolvedValue(undefined),
    mockMigrateKeyToTavernStorage: vi.fn(),
    mockSetPendingSettingsReloadFromIdb: vi.fn(),
    DEFAULT_TEMPLATE_STR_ACU,
    NEW_DEFAULT_TEMPLATE_STR_ACU,
    CUSTOM_TEMPLATE_STR_ACU,
  };
});

vi.mock('../../../src/shared/data-constants', () => ({
  STORAGE_KEY_ALL_SETTINGS_ACU: 'ACU_ALL_SETTINGS',
  STORAGE_KEY_CUSTOM_TEMPLATE_ACU: 'ACU_CUSTOM_TEMPLATE',
  normalizeIsolationCode_ACU: (code: any) => String(code || '').trim(),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_BUILTIN_PLOT_PRESETS_ACU: [{ name: '时间召回', _acuBuiltinPresetId: 'time-recall', _acuBuiltinPresetVersion: 'test' }],
  DEFAULT_CHAR_CARD_PROMPT_ACU: [{ role: 'USER', content: '默认提示词' }],
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU: [{ role: 'USER', content: '默认 strict json 提示词' }],
  DEFAULT_CHAR_CARD_PROMPT_SQL_ACU: [{ role: 'USER', content: '默认 sql 提示词' }],
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU: [{ role: 'USER', content: '默认 sql strict json 提示词' }],
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU: '默认合并提示词',
  DEFAULT_PLOT_SETTINGS_ACU: { enabled: false },
  DEFAULT_TABLE_TEMPLATE_ACU: DEFAULT_TEMPLATE_STR_ACU,
  ORIGINAL_DEFAULT_TABLE_TEMPLATE_ACU: JSON.stringify(DEFAULT_TEMPLATE_STR_ACU),
  get TABLE_TEMPLATE_ACU() { return '{"mate":{"type":"chatSheets","version":1}}'; },
  _set_TABLE_TEMPLATE_ACU: mockSetTableTemplate,
}));

vi.mock('../../../src/shared/defaults', () => ({
  DEFAULT_AUTO_UPDATE_FREQUENCY_ACU: 1,
  DEFAULT_AUTO_UPDATE_THRESHOLD_ACU: 3,
  DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU: 500,
  TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU: 'test-table-defaults-refresh',
  TABLE_FILL_PROMPT_FORCE_DEFAULT_VERSION_ACU: 'test-prompt-force-default',
  TEMPLATE_ASSISTANT_PROMPT_FORCE_DEFAULT_VERSION_ACU: 'test-template-assistant-prompt-force-default',
  STRICT_JSON_TABLE_FILL_FORCE_DISABLE_VERSION_ACU: 'test-strict-json-force-disable',
  VECTOR_MEMORY_DEFAULTS_REFRESH_VERSION_ACU: 'spv3.6.3-keyword-prompt-content-based-refresh',
  SUMMARY_INDEX_V2_WRITER_FORCE_ENABLE_VERSION_ACU: 'spv3.6.10-v2-writer-force-enable',
  defaultWorldbookConfig_ACU: {
    zeroTkOccupyMode: false,
    outlineEntryEnabled: true,
  },
  defaultVectorMemoryConfig_ACU: { 
    enabled: false,
    archiveTriggerCount: 9,
    archiveBatchSize: 3,
    archiveMaxConcurrency: 3,
    summaryIndexArchiveMaxConcurrency: 30,
    topK: 200,
    minScore: 0.45,
    recallCandidateLimit: 100,
    summaryIndexKeywordMinRows: 200,
    recentFixedInjectCount: 50,
    summaryIndexV2WriteEnabled: true,
    summaryIndexV2WriteScopeAllowlist: [],
    summaryPromptGroup: []
  },
  buildDefaultPlotWorldbookConfig_ACU: () => ({ source: 'character', manualSelection: [], enabledEntries: {} }),
  buildDefaultAgentWorldbookPromptTemplates_ACU: () => ({
    agentDecisionPromptSegments: [],
    agentSkillifyPromptSegments: [],
  }),
  buildDefaultAgentWorldbookControl_ACU: () => ({
    enabled: false,
    mode: 'disabled',
    scopeMode: 'follow_worldbook_page_selection',
    agentApiPreset: '',
    agentSkillApiPreset: '',
    contextSettingsConfigured: false,
    contextSettings: {},
    agentDecisionPromptSegments: [],
    agentSkillifyPromptSegments: [],
    maxEntriesPerChannel: { plot: 20, tableFill: 20, finalGeneration: 20 },
  }),
  buildDefaultContentOptimizationPromptGroup_ACU: () => [],
}));

vi.mock('../../../src/data/repositories/isolation-repo', () => ({
  addDataIsolationHistory_ACU: mockAddDataIsolationHistory,
  ensureProfileExists_ACU: mockEnsureProfileExists,
  normalizeDataIsolationHistory_ACU: mockNormalizeDataIsolationHistory,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: mockGlobalMeta,
  loadGlobalMeta_ACU: mockLoadGlobalMeta,
  readProfileSettingsFromStorage_ACU: mockReadProfileSettings,
  readProfileTemplateFromStorage_ACU: mockReadProfileTemplate,
  sanitizeSettingsForProfileSave_ACU: mockSanitizeSettingsForProfileSave,
  saveGlobalMeta_ACU: mockSaveGlobalMeta,
  writeProfileSettingsToStorage_ACU: mockWriteProfileSettings,
  writeProfileTemplateToStorage_ACU: mockWriteProfileTemplate,
}));

vi.mock('../../../src/shared/template-preset-utils', () => ({
  getCurrentTemplatePresetName_ACU: mockGetCurrentTemplatePresetName,
  normalizeTemplatePresetSelectionValue_ACU: mockNormalizeTemplatePresetSelectionValue,
}));

vi.mock('../../../src/data/storage/config-storage', () => ({
  persistSettingsToStorage_ACU: mockPersistSettingsToStorage,
}));

vi.mock('../../../src/shared/idb-import-temp', () => ({
  isIndexedDbAvailable_ACU: mockIsIndexedDbAvailable,
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  configIdbCacheLoaded_ACU: false,
  ensureConfigIdbCacheLoaded_ACU: mockEnsureConfigIdbCacheLoaded,
  getConfigStorage_ACU: mockGetConfigStorage,
  initTavernSettingsBridge_ACU: mockInitTavernSettingsBridge,
  migrateKeyToTavernStorageIfNeeded_ACU: mockMigrateKeyToTavernStorage,
  pendingSettingsReloadFromIdb_ACU: false,
  _set_pendingSettingsReloadFromIdb_ACU: mockSetPendingSettingsReloadFromIdb,
  persistTavernSettings_ACU: vi.fn(),
}));

vi.mock('../../../src/service/plot/plot-logic', () => ({
  ensureTagRulesCompat_ACU: mockEnsureTagRulesCompat,
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  getDefaultTemplateSnapshot_ACU: mockGetDefaultTemplateSnapshot,
  getTemplatePreset_ACU: mockGetTemplatePreset,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'test-char',
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  settings_ACU: mockSettings,
  _set_settings_ACU: mockSetSettings,
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentCharSettings_ACU: mockGetCurrentCharSettings,
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getCurrentChatTemplateScopeState_ACU: mockGetCurrentChatTemplateScopeState,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: mockGetGlobalTemplateSnapshotForCurrentProfile,
  migrateLegacyTemplateScopeForCurrentChat_ACU: mockMigrateLegacyTemplateScopeForCurrentChat,
  normalizeTemplateScopeIsolationKey_ACU: mockNormalizeTemplateScopeIsolationKey,
  sanitizeChatSheetsObject_ACU: mockSanitizeChatSheetsObject,
  sanitizeTemplateSnapshotForChat_ACU: mockSanitizeTemplateSnapshotForChat,
}));

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => {
    try { return JSON.parse(json); } catch { return fallback; }
  },
}));

vi.mock('../../../src/shared/utils', () => ({
  deepMerge_ACU: (target: any, source: any) => ({ ...target, ...source }),
  ensureSheetOrderNumbers_ACU: mockEnsureSheetOrderNumbers,
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import {
  saveSettings_ACU,
  resetPlotWorldbookSelectionForChatChange_ACU,
  loadSettings_ACU,
  buildDefaultSettings_ACU,
  applyTemplateScopeForCurrentChat_ACU,
  persistCurrentTemplatePresetName_ACU,
  setZeroTkOccupyMode_ACU,
  applyCombinedSettingsImport_ACU,
  _set_settingsStorageReadyForSave_ACU,
} from '../../../src/service/settings/settings-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfigStorage.mockReset().mockReturnValue(undefined);
  mockIsIndexedDbAvailable.mockReset().mockReturnValue(false);
  mockReadProfileSettings.mockReset().mockReturnValue(null);
  mockReadProfileTemplate.mockReset().mockReturnValue(null);
  mockGetCurrentWorldbookConfig.mockReset().mockReturnValue({ zeroTkOccupyMode: false, outlineEntryEnabled: true });
  mockGetCurrentChatTemplateScopeState.mockReset().mockReturnValue(null);
  mockMigrateLegacyTemplateScopeForCurrentChat.mockReset().mockReturnValue(null);
  mockNormalizeTemplatePresetSelectionValue.mockReset().mockImplementation((v: any) => v || '');
  mockGetTemplatePreset.mockReset().mockReturnValue(null);
  mockSanitizeTemplateSnapshotForChat.mockReset().mockImplementation((str: any) => str ? { templateStr: str } : null);
  mockGetDefaultTemplateSnapshot.mockReset().mockReturnValue(null);
  mockGetGlobalTemplateSnapshotForCurrentProfile.mockReset().mockReturnValue(null);
  mockSanitizeChatSheetsObject.mockReset().mockImplementation((obj: any) => obj);
  mockEnsureSheetOrderNumbers.mockReset().mockReturnValue(false);
  mockSettings.dataIsolationCode = '';
  mockSettings.dataIsolationEnabled = false;
  mockSettings.storageMode = 'native';
  mockSettings.charCardPrompt = [];
  mockSettings.strictJsonCharCardPrompt = [];
  mockSettings.strictJsonSqlCharCardPrompt = [];
  mockSettings.mergeSummaryPrompt = '';
  mockSettings.plotSettings = { plotWorldbookConfig: null };
  mockSettings.plotPresetBindings = {};
  mockSettings.currentTemplatePresetName = '';
  mockSettings.tableTemplateDefaultsRefreshVersion = '';
  mockSettings.tableFillPromptForceDefaultVersion = '';
  mockSettings.strictJsonTableFillEnabled = false;
  mockSettings.strictJsonTableFillForceDisableVersion = '';
  mockSettings.maxConcurrentGroups = 1;
  mockSettings.zeroTkOccupyModeDefault = false;
  mockSettings.characterSettings = {};
  mockGlobalMeta.activeIsolationCode = '';
  mockGlobalMeta.isolationCodeList = [];
  mockGlobalMeta.migratedLegacySingleStore = true;
  mockGlobalMeta.zeroTkOccupyModeGlobal = false;
  mockGlobalMeta.vectorMemoryConfigGlobal = null;
  _set_settingsStorageReadyForSave_ACU(true);
});

// ═══ resetPlotWorldbookSelectionForChatChange_ACU ═══
describe('resetPlotWorldbookSelectionForChatChange_ACU', () => {
  it('仅重置剧情世界书选择并保存一次', () => {
    mockGetConfigStorage.mockReturnValue({ _isTavern: true, getItem: vi.fn(), setItem: vi.fn() });
    const previousSelection = {
      source: 'manual',
      manualSelection: ['旧世界书'],
      enabledEntries: { '旧世界书': [1, 2] },
    };
    const formFillWorldbookConfig = {
      source: 'manual',
      manualSelection: ['填表世界书'],
      enabledEntries: { '填表世界书': [7] },
    };
    mockSettings.plotSettings = {
      plotWorldbookConfig: previousSelection,
      promptTemplate: '保留的剧情提示词',
      loopDelaySeconds: 3,
    };
    mockSettings.characterSettings = {
      'chat-a': { worldbookConfig: formFillWorldbookConfig },
    };

    const result = resetPlotWorldbookSelectionForChatChange_ACU();

    expect(result).toEqual({ saved: true, storageType: 'tavern' });
    expect(mockSettings.plotSettings).toMatchObject({
      promptTemplate: '保留的剧情提示词',
      loopDelaySeconds: 3,
      plotWorldbookConfig: {
        source: 'character',
        manualSelection: [],
        enabledEntries: {},
      },
    });
    expect(mockSettings.plotSettings.plotWorldbookConfig).not.toBe(previousSelection);
    expect(mockSettings.characterSettings['chat-a'].worldbookConfig).toBe(formFillWorldbookConfig);
    expect(mockPersistSettingsToStorage).toHaveBeenCalledTimes(1);
  });
});

// ═══ saveSettings_ACU ═══
describe('saveSettings_ACU', () => {
  it('tavern 存储正常时返回 { saved: true, storageType: "tavern" }', () => {
    mockGetConfigStorage.mockReturnValue({ _isTavern: true, getItem: vi.fn(), setItem: vi.fn() });
    const result = saveSettings_ACU();
    expect(result).toEqual({ saved: true, storageType: 'tavern' });
    expect(mockPersistSettingsToStorage).toHaveBeenCalledTimes(1);
    expect(mockSaveGlobalMeta).toHaveBeenCalledTimes(1);
  });

  it('非 tavern + IndexedDB 可用时返回 indexeddb 并带 warning', () => {
    mockGetConfigStorage.mockReturnValue({ _isTavern: false });
    mockIsIndexedDbAvailable.mockReturnValue(true);
    const result = saveSettings_ACU();
    expect(result.saved).toBe(true);
    expect(result.storageType).toBe('indexeddb');
    expect(result.warning).toBeDefined();
  });

  it('非 tavern + IndexedDB 不可用时返回 memory 并带 warning', () => {
    mockGetConfigStorage.mockReturnValue({ _isTavern: false });
    mockIsIndexedDbAvailable.mockReturnValue(false);
    const result = saveSettings_ACU();
    expect(result.saved).toBe(true);
    expect(result.storageType).toBe('memory');
    expect(result.warning).toContain('刷新后会丢失');
  });

  it('getConfigStorage 抛错时返回 { saved: false, error }', () => {
    mockGetConfigStorage.mockImplementation(() => { throw new Error('存储异常'); });
    const result = saveSettings_ACU();
    expect(result.saved).toBe(false);
    expect(result.storageType).toBe('memory');
    expect(result.error).toBeDefined();
  });
});

// ═══ buildDefaultSettings_ACU ═══
describe('buildDefaultSettings_ACU', () => {
  it('返回包含所有必要字段的默认设置对象', () => {
    const defaults = buildDefaultSettings_ACU();
    expect(defaults.apiConfig).toBeDefined();
    expect(defaults.apiConfig.useMainApi).toBe(true);
    expect(defaults.autoUpdateThreshold).toBe(3);
    expect(defaults.autoUpdateEnabled).toBe(true);
    expect(defaults.maxConcurrentGroups).toBe(1);
    expect(defaults.discardUnauthorizedTableEditsEnabled).toBe(true);
    expect(defaults.storageMode).toBe('native');
    expect(defaults.promptTemplateSettings).toBeDefined();
    expect(defaults.promptTemplateSettings.enabled).toBe(true);
    expect(defaults.contentOptimizationSettings).toBeDefined();
    expect(defaults.contentOptimizationSettings.enabled).toBe(false);
  });

  it('plotSettings 是深拷贝，修改不影响默认常量', () => {
    const defaults1 = buildDefaultSettings_ACU();
    const defaults2 = buildDefaultSettings_ACU();
    defaults1.plotSettings.customField = 'modified';
    expect(defaults2.plotSettings.customField).toBeUndefined();
  });

  it('characterSettings 初始为空对象', () => {
    const defaults = buildDefaultSettings_ACU();
    expect(defaults.characterSettings).toEqual({});
  });
});

// ═══ applyCombinedSettingsImport_ACU ═══
describe('applyCombinedSettingsImport_ACU', () => {
  beforeEach(() => {
    // saveSettings_ACU 内部会调用 getConfigStorage，需要 mock
    mockGetConfigStorage.mockReturnValue({ _isTavern: true });
  });

  it('导入 prompt 字段', () => {
    const fields = applyCombinedSettingsImport_ACU({
      prompt: [{ role: 'USER', content: '新提示词' }],
    });
    expect(fields).toContain('charCardPrompt');
    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: '新提示词' }]);
  });

  it('导入合并设置字段', () => {
    const fields = applyCombinedSettingsImport_ACU({
      autoMergeEnabled: true,
      autoMergeThreshold: 30,
      mergeBatchSize: 10,
    });
    expect(fields).toContain('autoMergeEnabled');
    expect(fields).toContain('autoMergeThreshold');
    expect(mockSettings.autoMergeEnabled).toBe(true);
    expect(mockSettings.autoMergeThreshold).toBe(30);
    expect(mockSettings.mergeBatchSize).toBe(10);
  });

  it('导入 AI 改表助手提示词段（归一化 role 与空内容过滤）', () => {
    const fields = applyCombinedSettingsImport_ACU({
      templateAssistantPromptSegments: [
        { role: 'system', content: '规则一', deletable: false },
        { role: 'weird', content: '   ' },
        { role: 'assistant', content: '样例' },
      ],
    });
    expect(fields).toContain('templateAssistantPromptSegments');
    expect(mockSettings.templateAssistantPromptSegments).toEqual([
      { role: 'SYSTEM', content: '规则一', deletable: false, pinned: false },
      { role: 'assistant', content: '样例', deletable: true, pinned: false },
    ]);
  });

  it('templateAssistantPromptSegments 非数组时不导入', () => {
    mockSettings.templateAssistantPromptSegments = [{ role: 'SYSTEM', content: '原有' }];
    const fields = applyCombinedSettingsImport_ACU({ templateAssistantPromptSegments: 'not-array' });
    expect(fields).not.toContain('templateAssistantPromptSegments');
    expect(mockSettings.templateAssistantPromptSegments).toEqual([{ role: 'SYSTEM', content: '原有' }]);
  });

  it('空对象不修改任何字段', () => {
    const fields = applyCombinedSettingsImport_ACU({});
    // 不包含 charCardPrompt（因为 combinedData.prompt 不是数组）
    expect(fields).not.toContain('charCardPrompt');
  });

  it('导入后调用 saveSettings_ACU 持久化', () => {
    applyCombinedSettingsImport_ACU({ prompt: [{ role: 'USER', content: '测试' }] });
    expect(mockPersistSettingsToStorage).toHaveBeenCalled();
  });

  it('保存失败时回滚全部导入字段并抛错', () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '原有' }];
    mockSettings.mergeSummaryPrompt = '原有合并';
    mockPersistSettingsToStorage.mockImplementationOnce(() => {
      throw new Error('存储写入失败');
    });

    expect(() => applyCombinedSettingsImport_ACU({
      prompt: [{ role: 'USER', content: '新提示词' }],
      mergeSummaryPrompt: '新合并',
    })).toThrow('合并配置保存失败');

    // 回滚：恢复导入前值
    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: '原有' }]);
    expect(mockSettings.mergeSummaryPrompt).toBe('原有合并');
  });

  it('保存返回 saved:false 时回滚全部导入字段并抛错', () => {
    mockSettings.charCardPrompt = [{ role: 'USER', content: '原有' }];
    mockSettings.mergeSummaryPrompt = '原有合并';
    _set_settingsStorageReadyForSave_ACU(false);

    expect(() => applyCombinedSettingsImport_ACU({
      prompt: [{ role: 'USER', content: '新提示词' }],
      mergeSummaryPrompt: '新合并',
    })).toThrow();

    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: '原有' }]);
    expect(mockSettings.mergeSummaryPrompt).toBe('原有合并');
    _set_settingsStorageReadyForSave_ACU(true);
  });
});

// ═══ persistCurrentTemplatePresetName_ACU ═══
describe('persistCurrentTemplatePresetName_ACU', () => {
  it('settingsObj 为 null 时返回空字符串', () => {
    expect(persistCurrentTemplatePresetName_ACU(null, '预设A')).toBe('');
  });

  it('save=true 时触发持久化', () => {
    const obj: any = { dataIsolationCode: 'code1' };
    persistCurrentTemplatePresetName_ACU(obj, '预设A', { save: true });
    expect(obj.currentTemplatePresetName).toBe('预设A');
    expect(mockPersistSettingsToStorage).toHaveBeenCalledWith(obj, 'code1');
  });

  it('save=false 时不触发持久化', () => {
    const obj: any = {};
    persistCurrentTemplatePresetName_ACU(obj, '预设B', { save: false });
    expect(obj.currentTemplatePresetName).toBe('预设B');
    expect(mockPersistSettingsToStorage).not.toHaveBeenCalled();
  });
});

// ═══ setZeroTkOccupyMode_ACU ═══
describe('setZeroTkOccupyMode_ACU', () => {
  beforeEach(() => {
    mockGetConfigStorage.mockReturnValue({ _isTavern: true });
  });

  it('启用时设置 zeroTkOccupyMode=true 且 outlineEntryEnabled=false', () => {
    const cfg: any = { zeroTkOccupyMode: false, outlineEntryEnabled: true };
    mockGetCurrentWorldbookConfig.mockReturnValue(cfg);
    setZeroTkOccupyMode_ACU(true);
    expect(cfg.zeroTkOccupyMode).toBe(true);
    expect(cfg.outlineEntryEnabled).toBe(false);
    expect(mockSettings.zeroTkOccupyModeDefault).toBe(true);
    expect(mockGlobalMeta.zeroTkOccupyModeGlobal).toBe(true);
    expect(mockSaveGlobalMeta).toHaveBeenCalled();
  });

  it('禁用时设置 zeroTkOccupyMode=false 且 outlineEntryEnabled=true', () => {
    const cfg: any = { zeroTkOccupyMode: true, outlineEntryEnabled: false };
    mockGetCurrentWorldbookConfig.mockReturnValue(cfg);
    setZeroTkOccupyMode_ACU(false);
    expect(cfg.zeroTkOccupyMode).toBe(false);
    expect(cfg.outlineEntryEnabled).toBe(true);
    expect(mockSettings.zeroTkOccupyModeDefault).toBe(false);
  });
});

// ═══ applyTemplateScopeForCurrentChat_ACU ═══
describe('applyTemplateScopeForCurrentChat_ACU', () => {
  it('chat_override 模式：使用聊天级模板覆盖', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'chat_override',
      templateStr: '{"mate":{"type":"chatSheets"},"sheet_0":{"name":"覆盖表"}}',
      presetName: '预设X',
    });
    mockSanitizeTemplateSnapshotForChat.mockReturnValue({
      templateStr: '{"mate":{"type":"chatSheets"},"sheet_0":{"name":"覆盖表"}}',
    });

    const result = applyTemplateScopeForCurrentChat_ACU();
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
    expect(mockSetTableTemplate).toHaveBeenCalled();
  });

  it('preset_link 兼容模式：应用后对外按聊天快照处理', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue({
      mode: 'preset_link',
      presetName: '预设A',
    });
    mockNormalizeTemplatePresetSelectionValue.mockReturnValue('预设A');
    mockGetTemplatePreset.mockReturnValue({ templateStr: '{"sheet_0":{}}' });
    mockSanitizeTemplateSnapshotForChat.mockReturnValue({ templateStr: '{"sheet_0":{}}' });

    const result = applyTemplateScopeForCurrentChat_ACU();
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat_override');
    expect(result!.presetName).toBe('预设A');
  });

  it('无有效快照时回退到全局模板', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockMigrateLegacyTemplateScopeForCurrentChat.mockReturnValue(null);
    mockGetGlobalTemplateSnapshotForCurrentProfile.mockReturnValue({
      templateStr: '{"sheet_0":{"name":"全局表"}}',
    });

    const result = applyTemplateScopeForCurrentChat_ACU();
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('inherit_global');
  });

  it('所有快照都无效时返回 null', () => {
    mockGetCurrentChatTemplateScopeState.mockReturnValue(null);
    mockMigrateLegacyTemplateScopeForCurrentChat.mockReturnValue(null);
    mockGetGlobalTemplateSnapshotForCurrentProfile.mockReturnValue(null);

    const result = applyTemplateScopeForCurrentChat_ACU();
    expect(result).toBeNull();
  });
});

// ═══ loadSettings_ACU ═══
describe('loadSettings_ACU', () => {
  beforeEach(() => {
    mockGetConfigStorage.mockReturnValue({
      _isTavern: true,
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
    });
    mockReadProfileSettings.mockReturnValue(null);
    mockReadProfileTemplate.mockReturnValue(null);
  });

  it('无保存设置时使用默认值', () => {
    loadSettings_ACU();
    // _set_settings_ACU 应被调用，传入默认设置
    expect(mockSetSettings).toHaveBeenCalled();
    const calledWith = mockSetSettings.mock.calls[0][0];
    expect(calledWith.autoUpdateEnabled).toBe(true);
    expect(calledWith.maxConcurrentGroups).toBe(1);
    expect(calledWith.discardUnauthorizedTableEditsEnabled).toBe(true);
  });

  it('有保存设置时 deepMerge 合并', () => {
    mockReadProfileSettings.mockReturnValue({
      autoUpdateEnabled: false,
      customField: '自定义值',
    });
    loadSettings_ACU();
    expect(mockSetSettings).toHaveBeenCalled();
    // deepMerge 的 mock 实现是 { ...target, ...source }，source 覆盖 target
    const calledWith = mockSetSettings.mock.calls[0][0];
    expect(calledWith.autoUpdateEnabled).toBe(false);
    expect(calledWith.customField).toBe('自定义值');
    expect(calledWith.discardUnauthorizedTableEditsEnabled).toBe(true);
  });

  it('补齐缺失的 V2 rollout 开关与 allowlist，且持久化全局配置', () => {
    mockGlobalMeta.vectorMemoryConfigGlobal = {
      defaultsRefreshVersion: 'old-vector-defaults',
    };

    loadSettings_ACU();

    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteEnabled).toBe(true);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteScopeAllowlist).toEqual([]);
    expect(mockSaveGlobalMeta).toHaveBeenCalled();
  });

  it('当前 defaults marker 下仍补齐缺失的 V2 rollout 字段并持久化，不触发关键词默认值覆盖', () => {
    mockGlobalMeta.vectorMemoryConfigGlobal = {
      defaultsRefreshVersion: 'spv3.6.3-keyword-prompt-content-based-refresh',
      keywordPromptGroup: [{ content: '用户自定义关键词提示词' }],
    };

    loadSettings_ACU();

    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteEnabled).toBe(true);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteScopeAllowlist).toEqual([]);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.keywordPromptGroup).toEqual([{ content: '用户自定义关键词提示词' }]);
    expect(mockSaveGlobalMeta).toHaveBeenCalled();
  });

  it('一次性强制开启 V2 writer：未标记 marker 的显式 false 会被反转为 true 并写入 marker', () => {
    mockGlobalMeta.vectorMemoryConfigGlobal = {
      defaultsRefreshVersion: 'spv3.6.3-keyword-prompt-content-based-refresh',
      summaryIndexV2WriteEnabled: false,
      summaryIndexV2WriteScopeAllowlist: ['scope-user-configured'],
    };

    loadSettings_ACU();

    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteEnabled).toBe(true);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteScopeAllowlist).toEqual(['scope-user-configured']);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteForceEnableVersion)
      .toBe('spv3.6.10-v2-writer-force-enable');
    expect(mockSaveGlobalMeta).toHaveBeenCalled();
  });

  it('已标记 V2 writer force enable marker 后，保留用户手动关闭的 writer 显式意图', () => {
    mockGlobalMeta.vectorMemoryConfigGlobal = {
      defaultsRefreshVersion: 'spv3.6.3-keyword-prompt-content-based-refresh',
      summaryIndexV2WriteEnabled: false,
      summaryIndexV2WriteScopeAllowlist: ['scope-user-configured'],
      summaryIndexV2WriteForceEnableVersion: 'spv3.6.10-v2-writer-force-enable',
    };

    loadSettings_ACU();

    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteEnabled).toBe(false);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteScopeAllowlist).toEqual(['scope-user-configured']);
    expect(mockGlobalMeta.vectorMemoryConfigGlobal.summaryIndexV2WriteForceEnableVersion)
      .toBe('spv3.6.10-v2-writer-force-enable');
  });

  it('解析异常时回退到默认设置', () => {
    mockReadProfileSettings.mockImplementation(() => { throw new Error('解析失败'); });
    loadSettings_ACU();
    expect(mockSetSettings).toHaveBeenCalled();
    // 异常路径也会调用 _set_settings_ACU(buildDefaultSettings_ACU())
    const calledWith = mockSetSettings.mock.calls[0][0];
    expect(calledWith.autoUpdateEnabled).toBe(true);
  });

  it('一次性默认模板刷新会覆盖旧默认模板', () => {
    mockReadProfileTemplate.mockReturnValue(DEFAULT_TEMPLATE_STR_ACU);
    mockGetDefaultTemplateSnapshot.mockReturnValue({ templateStr: NEW_DEFAULT_TEMPLATE_STR_ACU });

    loadSettings_ACU();

    expect(mockSetTableTemplate).toHaveBeenCalledWith(NEW_DEFAULT_TEMPLATE_STR_ACU);
    expect(mockWriteProfileTemplate).toHaveBeenCalledWith('', NEW_DEFAULT_TEMPLATE_STR_ACU);
    expect(mockSettings.tableTemplateDefaultsRefreshVersion).toBe('test-table-defaults-refresh');
  });

  it('一次性默认模板刷新遇到命名预设时只记录版本，不覆盖模板', () => {
    mockReadProfileSettings.mockReturnValue({ currentTemplatePresetName: '我的预设' });
    mockReadProfileTemplate.mockReturnValue(DEFAULT_TEMPLATE_STR_ACU);
    mockGetDefaultTemplateSnapshot.mockReturnValue({ templateStr: NEW_DEFAULT_TEMPLATE_STR_ACU });

    loadSettings_ACU();

    expect(mockNormalizeTemplatePresetSelectionValue).toHaveBeenCalledWith('我的预设');
    expect(mockSettings.currentTemplatePresetName).toBe('我的预设');
    expect(mockWriteProfileTemplate).not.toHaveBeenCalledWith('', NEW_DEFAULT_TEMPLATE_STR_ACU);
    expect(mockSetTableTemplate).not.toHaveBeenCalledWith(NEW_DEFAULT_TEMPLATE_STR_ACU);
    expect(mockSettings.tableTemplateDefaultsRefreshVersion).toBe('test-table-defaults-refresh');
  });

  it('一次性默认模板刷新会保留结构不同的用户自定义默认槽位模板', () => {
    mockReadProfileTemplate.mockReturnValue(CUSTOM_TEMPLATE_STR_ACU);
    mockGetDefaultTemplateSnapshot.mockReturnValue({ templateStr: NEW_DEFAULT_TEMPLATE_STR_ACU });

    loadSettings_ACU();

    expect(mockWriteProfileTemplate).not.toHaveBeenCalledWith('', NEW_DEFAULT_TEMPLATE_STR_ACU);
    expect(mockSetTableTemplate).not.toHaveBeenCalledWith(NEW_DEFAULT_TEMPLATE_STR_ACU);
    expect(mockSettings.tableTemplateDefaultsRefreshVersion).toBe('test-table-defaults-refresh');
  });

  it('一次性强制关闭历史严格 JSON 填表开关并写入 marker', () => {
    mockReadProfileSettings.mockReturnValue({
      strictJsonTableFillEnabled: true,
    });

    loadSettings_ACU();

    expect(mockSettings.strictJsonTableFillEnabled).toBe(false);
    expect(mockSettings.strictJsonTableFillForceDisableVersion)
      .toBe('test-strict-json-force-disable');
  });

  it('已记录严格 JSON 关闭 marker 后保留用户后续重新开启的设置', () => {
    mockReadProfileSettings.mockReturnValue({
      strictJsonTableFillEnabled: true,
      strictJsonTableFillForceDisableVersion: 'test-strict-json-force-disable',
      tableFillPromptForceDefaultVersion: 'test-prompt-force-default',
    });

    loadSettings_ACU();

    expect(mockSettings.strictJsonTableFillEnabled).toBe(true);
  });

  it('一次性强制恢复会覆盖用户自定义的原生与严格 JSON 填表提示词', () => {
    mockReadProfileSettings.mockReturnValue({
      storageMode: 'native',
      charCardPrompt: [{ role: 'USER', content: '用户自定义提示词', enabled: false }],
      strictJsonCharCardPrompt: [{ role: 'USER', content: '用户自定义 strict json 提示词' }],
      strictJsonSqlCharCardPrompt: [{ role: 'USER', content: '用户自定义 sql strict json 提示词' }],
    });

    loadSettings_ACU();

    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: '默认提示词' }]);
    expect(mockSettings.strictJsonCharCardPrompt).toEqual([{ role: 'USER', content: '默认 strict json 提示词' }]);
    expect(mockSettings.strictJsonSqlCharCardPrompt).toEqual([{ role: 'USER', content: '默认 sql strict json 提示词' }]);
    expect(mockSettings.tableFillPromptForceDefaultVersion).toBe('test-prompt-force-default');
  });

  it('SQLite 模式的一次性强制恢复使用 SQL 默认填表提示词', () => {
    mockReadProfileSettings.mockReturnValue({
      storageMode: 'sqlite',
      charCardPrompt: [{ role: 'USER', content: '我自己写的提示词' }],
    });

    loadSettings_ACU();

    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: '默认 sql 提示词' }]);
    expect(mockSettings.tableFillPromptForceDefaultVersion).toBe('test-prompt-force-default');
  });

  it('已记录强制恢复版本时不再改写用户后续自定义提示词', () => {
    mockReadProfileSettings.mockReturnValue({
      tableFillPromptForceDefaultVersion: 'test-prompt-force-default',
      charCardPrompt: [{ role: 'USER', content: '迁移后再次自定义' }],
    });

    loadSettings_ACU();

    expect(mockSettings.charCardPrompt[0].content).toBe('迁移后再次自定义');
  });

  it('一次性强制恢复会清空 AI 改表助手自定义提示词并写入 marker', () => {
    mockReadProfileSettings.mockReturnValue({
      templateAssistantPromptSegments: [
        { role: 'SYSTEM', content: '历史自定义改表助手提示词', deletable: false, pinned: true },
      ],
    });

    loadSettings_ACU();

    // 空数组不是空提示词：它是既有契约，运行时会回退到内置伪 role 默认提示词。
    expect(mockSettings.templateAssistantPromptSegments).toEqual([]);
    expect(mockSettings.templateAssistantPromptForceDefaultVersion)
      .toBe('test-template-assistant-prompt-force-default');
    expect(mockPersistSettingsToStorage).toHaveBeenCalled();
  });

  it('已记录 AI 改表助手恢复 marker 后，保留用户后续保存的自定义提示词', () => {
    const customized = [
      { role: 'SYSTEM', content: '迁移后再次自定义的改表助手提示词', deletable: false, pinned: true },
    ];
    mockReadProfileSettings.mockReturnValue({
      templateAssistantPromptForceDefaultVersion: 'test-template-assistant-prompt-force-default',
      templateAssistantPromptSegments: customized,
    });

    loadSettings_ACU();

    expect(mockSettings.templateAssistantPromptSegments).toEqual(customized);
    expect(mockSettings.templateAssistantPromptForceDefaultVersion)
      .toBe('test-template-assistant-prompt-force-default');
  });

});
