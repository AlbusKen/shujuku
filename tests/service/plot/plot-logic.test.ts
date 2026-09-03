/**
 * tests/service/plot/plot-logic.test.ts
 * 剧情推进纯逻辑函数 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings } = vi.hoisted(() => {
  const mockSettings: any = {
    plotSettings: {
      promptPresets: [],
      lastUsedPresetName: '',
      globalRevision: 0,
      loopSettings: { quickReplyContent: [], currentPromptIndex: 0, maxRetries: 3 },
      prompts: [],
      plotTasks: [],
      plotPresetBindings: {},
    },
    plotPresetBindings: {},
  };
  return { mockSettings };
});

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_PLOT_SETTINGS_ACU: {
    contextExtractRules: [],
    contextExcludeRules: [],
    contextExtractTags: '',
    contextExcludeTags: '',
    loopSettings: { maxRetries: 3 },
    prompts: [
      { id: 'mainPrompt', content: '默认主提示词' },
      { id: 'systemPrompt', content: '默认系统提示词' },
    ],
  },
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentChatFileIdentifier_ACU: 'test-chat',
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  cleanChatName_ACU: vi.fn((name: string) => {
    if (!name || typeof name !== 'string') return 'unknown_chat_source';
    return name.replace(/\.(jsonl|json)$/, '').replace(/^.*[/\\]/, '') || 'unknown_chat_source';
  }),
  normalizeExcludeRules_ACU: vi.fn((rules: any) => Array.isArray(rules) ? rules : []),
  normalizeExtractRules_ACU: vi.fn((rules: any) => Array.isArray(rules) ? rules : []),
  normalizeNonNegativeInteger_ACU: vi.fn((v: any, fb = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  }),
  normalizePositiveInteger_ACU: vi.fn((v: any, fb = 1) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fb;
  }),
}));

const { mockPlotState } = vi.hoisted(() => {
  const mockPlotState: any = {
    activePlotEditorSettings_ACU: null,
    currentEditablePlotPresetState_ACU: { initialized: false, presetName: '', scope: 'resolved', source: '' },
  };
  return { mockPlotState };
});

vi.mock('../../../src/service/plot/plot-state', () => ({
  get activePlotEditorSettings_ACU() { return mockPlotState.activePlotEditorSettings_ACU; },
  buildDefaultPlotPromptGroup_ACU: vi.fn(({ mainAContent = '', mainBContent = '' } = {}) => [
    { role: 'SYSTEM', content: mainAContent, mainSlot: 'A', isMain: true, deletable: false },
    { role: 'USER', content: mainBContent, mainSlot: 'B', isMain2: true, deletable: false },
  ]),
  get currentEditablePlotPresetState_ACU() { return mockPlotState.currentEditablePlotPresetState_ACU; },
  ensurePlotPromptGroup_ACU: vi.fn(),
  _set_currentEditablePlotPresetState_ACU: vi.fn((v: any) => { mockPlotState.currentEditablePlotPresetState_ACU = v; }),
  _set_activePlotEditorSettings_ACU: vi.fn((v: any) => { mockPlotState.activePlotEditorSettings_ACU = v; }),
  _set_currentPlotTaskEditorId_ACU: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
  saveChatToHost_ACU: vi.fn(),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatPlotScopeStateFromSettings_ACU: vi.fn(() => null),
  clearCurrentChatPlotScopeState_ACU: vi.fn(),
  getCurrentChatPlotScopeState_ACU: vi.fn(() => null),
  sanitizePlotSettingsSnapshotForChat_ACU: vi.fn((s: any) => s),
  setCurrentChatPlotScopeState_ACU: vi.fn(),
}));

vi.mock('../../../src/service/optimization/content-optimization', () => ({
  getLastOptimizationBase_ACU: vi.fn(() => null),
  setLastOptimizationBase_ACU: vi.fn(),
}));

import {
  ensureLoopPromptsArray_ACU,
  ensureTagRulesCompat_ACU,
  getLegacyPromptFromThree_ACU,
  getLegacyPromptTextsFromPromptGroup_ACU,
  getPlotPromptGroupFromSource_ACU,
  getPlotFinalDirectiveFromSource_ACU,
  normalizePlotTask_ACU,
  normalizePlotTasks_ACU,
  normalizePlotPresetSelectionValue_ACU,
  isDefaultPlotPresetSelection_ACU,
  DEFAULT_PRESET_OPTION_VALUE_ACU,
  ensurePlotPresetBindingsStore_ACU,
  getPlotPresetBindingForChat_ACU,
  clearPlotPresetBindingForChat_ACU,
  findPlotPresetByName_ACU,
  resolveActivePlotPresetName_ACU,
  ensurePlotPromptsArray_ACU,
  getPlotPromptContentByIdFromSettings_ACU,
  setPlotPromptContentByIdForSettings_ACU,
  markPlotIntercept_ACU,
  shouldSkipPlotIntercept_ACU,
  getPlotGlobalRevision_ACU,
  normalizePlotPresetExcludeRules_ACU,
  stripPlotPresetWorldbookEntrySelectionForExport_ACU,
  getLastOptimizedMessageIndex_ACU,
  syncLegacyPlotSettingsFromTask_ACU,
  ensurePlotTasksCompat_ACU,
  getCurrentRuntimePlotPresetName_ACU,
  setCurrentEditablePlotPresetState_ACU,
  syncCurrentEditablePlotPresetState_ACU,
  getActivePlotEditorSettings_ACU,
  setActivePlotEditorSettings_ACU,
  applyPlotPresetToSettings_ACU,
  resetPlotSettingsToDefault_ACU,
  replaceCurrentPlotSettingsWithSnapshot_ACU,
  persistPlotPresetSelectionState_ACU,
  switchCurrentChatPlotPreset_ACU,
  clearCurrentChatPlotPresetOverride_ACU,
  applyGlobalPlotPresetSelectionForEditor_ACU,
} from '../../../src/service/plot/plot-logic';

import { saveSettings_ACU } from '../../../src/service/settings/settings-service';
import { saveChatToHost_ACU } from '../../../src/data/gateways/chat-gateway';
import { getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, buildChatPlotScopeStateFromSettings_ACU, setCurrentChatPlotScopeState_ACU, clearCurrentChatPlotScopeState_ACU } from '../../../src/service/template/chat-scope';
import { _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU } from '../../../src/service/plot/plot-state';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.plotSettings = {
    promptPresets: [],
    lastUsedPresetName: '',
    globalRevision: 0,
    loopSettings: { quickReplyContent: [], currentPromptIndex: 0, maxRetries: 3 },
    prompts: [],
    plotTasks: [],
  };
  mockSettings.plotPresetBindings = {};
});

// ═══ ensureLoopPromptsArray_ACU ═══
describe('ensureLoopPromptsArray_ACU', () => {
  it('清除字符串形式的废弃循环字段', () => {
    const ps: any = { loopSettings: { quickReplyContent: '提示词' } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings).toEqual({});
  });
  it('清除空字符串形式的废弃循环字段', () => {
    const ps: any = { loopSettings: { quickReplyContent: '  ' } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings).toEqual({});
  });
  it('清除数组和索引并保留其余 loop 设置', () => {
    const ps: any = { loopSettings: { quickReplyContent: ['a', 'b'], currentPromptIndex: 1, maxRetries: 3, loopDelay: 500 } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings).toEqual({ maxRetries: 3, loopDelay: 500 });
  });
  it('null plotSettings 不报错', () => {
    expect(() => ensureLoopPromptsArray_ACU(null as any)).not.toThrow();
  });
  it('无 loopSettings 不报错', () => {
    expect(() => ensureLoopPromptsArray_ACU({})).not.toThrow();
  });
  it('仅有索引时也会清除', () => {
    const ps: any = { loopSettings: { currentPromptIndex: 5, maxRetries: 3 } };
    ensureLoopPromptsArray_ACU(ps);
    expect(ps.loopSettings).toEqual({ maxRetries: 3 });
  });
});

// ═══ getLegacyPromptFromThree_ACU ═══
describe('getLegacyPromptFromThree_ACU', () => {
  it('从数组中按 id 查找', () => {
    const prompts = [{ id: 'mainPrompt', content: '主提示词' }];
    expect(getLegacyPromptFromThree_ACU(prompts, 'mainPrompt')).toBe('主提示词');
  });
  it('从对象中按 key 查找', () => {
    expect(getLegacyPromptFromThree_ACU({ mainPrompt: '主提示词' }, 'mainPrompt')).toBe('主提示词');
  });
  it('未找到返回空字符串', () => {
    expect(getLegacyPromptFromThree_ACU([], 'notExist')).toBe('');
  });
  it('null 返回空字符串', () => {
    expect(getLegacyPromptFromThree_ACU(null, 'any')).toBe('');
  });
});

// ═══ getLegacyPromptTextsFromPromptGroup_ACU ═══
describe('getLegacyPromptTextsFromPromptGroup_ACU', () => {
  it('从 promptGroup 提取 mainPrompt 和 systemPrompt', () => {
    const group = [
      { role: 'SYSTEM', content: '主内容', mainSlot: 'A', isMain: true },
      { role: 'USER', content: '系统内容', mainSlot: 'B', isMain2: true },
    ];
    const result = getLegacyPromptTextsFromPromptGroup_ACU(group);
    expect(result.mainPrompt).toBe('主内容');
    expect(result.systemPrompt).toBe('系统内容');
  });
  it('空数组返回空字符串', () => {
    const result = getLegacyPromptTextsFromPromptGroup_ACU([]);
    expect(result.mainPrompt).toBe('');
    expect(result.systemPrompt).toBe('');
  });
  it('null 返回空字符串', () => {
    const result = getLegacyPromptTextsFromPromptGroup_ACU(null);
    expect(result.mainPrompt).toBe('');
    expect(result.systemPrompt).toBe('');
  });
});

// ═══ getPlotFinalDirectiveFromSource_ACU ═══
describe('getPlotFinalDirectiveFromSource_ACU', () => {
  it('优先使用 finalSystemDirective', () => {
    expect(getPlotFinalDirectiveFromSource_ACU({ finalSystemDirective: '指令A' })).toBe('指令A');
  });
  it('回退到 finalDirective', () => {
    expect(getPlotFinalDirectiveFromSource_ACU({ finalDirective: '指令B' })).toBe('指令B');
  });
  it('null 返回空字符串', () => {
    expect(getPlotFinalDirectiveFromSource_ACU(null)).toBe('');
  });
  it('空对象返回空字符串', () => {
    expect(getPlotFinalDirectiveFromSource_ACU({})).toBe('');
  });
});

// ═══ normalizePlotTask_ACU ═══
describe('normalizePlotTask_ACU', () => {
  it('规范化任务结构', () => {
    const task = normalizePlotTask_ACU({ id: 'task1', name: '任务1', enabled: true });
    expect(task.id).toBe('task1');
    expect(task.name).toBe('任务1');
    expect(task.enabled).toBe(true);
    expect(task.mergeStrategy).toBe('append');
  });
  it('null 任务使用默认值', () => {
    const task = normalizePlotTask_ACU(null, { index: 0 });
    expect(task.id).toBe('plotTask1');
    expect(task.name).toBe('剧情任务1');
    expect(task.enabled).toBe(true);
  });
  it('id 中的特殊字符被替换', () => {
    const task = normalizePlotTask_ACU({ id: 'task 1!@#' });
    expect(task.id).not.toContain(' ');
    expect(task.id).not.toContain('!');
  });
  it('enabled 默认为 true', () => {
    const task = normalizePlotTask_ACU({});
    expect(task.enabled).toBe(true);
  });
  it('enabled=false 保持', () => {
    const task = normalizePlotTask_ACU({ enabled: false });
    expect(task.enabled).toBe(false);
  });
});

// ═══ normalizePlotTasks_ACU ═══
describe('normalizePlotTasks_ACU', () => {
  it('有 plotTasks 时规范化', () => {
    const source = { plotTasks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    const tasks = normalizePlotTasks_ACU(source);
    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe('a');
  });
  it('无 plotTasks 时创建默认任务', () => {
    const tasks = normalizePlotTasks_ACU({});
    expect(tasks.length).toBeGreaterThan(0);
  });
  it('null 创建默认任务', () => {
    const tasks = normalizePlotTasks_ACU(null);
    expect(tasks.length).toBeGreaterThan(0);
  });
  it('按 order 排序', () => {
    const source = { plotTasks: [{ id: 'a', order: 2 }, { id: 'b', order: 0 }] };
    const tasks = normalizePlotTasks_ACU(source);
    expect(tasks[0].order).toBeLessThanOrEqual(tasks[1].order);
  });
});

// ═══ normalizePlotPresetSelectionValue_ACU ═══
describe('normalizePlotPresetSelectionValue_ACU', () => {
  it('正常预设名原样返回', () => {
    expect(normalizePlotPresetSelectionValue_ACU('预设A')).toBe('预设A');
  });
  it('默认值标记返回空字符串', () => {
    expect(normalizePlotPresetSelectionValue_ACU(DEFAULT_PRESET_OPTION_VALUE_ACU)).toBe('');
  });
  it('null 返回空字符串', () => {
    expect(normalizePlotPresetSelectionValue_ACU(null)).toBe('');
  });
  it('前后空格被 trim', () => {
    expect(normalizePlotPresetSelectionValue_ACU('  预设A  ')).toBe('预设A');
  });
});

// ═══ isDefaultPlotPresetSelection_ACU ═══
describe('isDefaultPlotPresetSelection_ACU', () => {
  it('默认值标记返回 true', () => {
    expect(isDefaultPlotPresetSelection_ACU(DEFAULT_PRESET_OPTION_VALUE_ACU)).toBe(true);
  });
  it('空字符串返回 true', () => {
    expect(isDefaultPlotPresetSelection_ACU('')).toBe(true);
  });
  it('正常预设名返回 false', () => {
    expect(isDefaultPlotPresetSelection_ACU('预设A')).toBe(false);
  });
});

// ═══ ensurePlotPresetBindingsStore_ACU ═══
describe('ensurePlotPresetBindingsStore_ACU', () => {
  it('初始化绑定存储', () => {
    mockSettings.plotPresetBindings = null;
    const store = ensurePlotPresetBindingsStore_ACU();
    expect(typeof store).toBe('object');
  });
  it('已有存储时返回现有', () => {
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: 'A' } };
    const store = ensurePlotPresetBindingsStore_ACU();
    expect(store['test-chat']).toEqual({ presetName: 'A' });
  });
});

// ═══ ensurePlotPromptsArray_ACU ═══
describe('ensurePlotPromptsArray_ACU', () => {
  it('对象格式迁移为数组', () => {
    const ps: any = { prompts: { mainPrompt: '主', systemPrompt: '系统' } };
    ensurePlotPromptsArray_ACU(ps);
    expect(Array.isArray(ps.prompts)).toBe(true);
    expect(ps.prompts.find((p: any) => p.id === 'mainPrompt')?.content).toBe('主');
  });
  it('数组格式补充缺失项', () => {
    const ps: any = { prompts: [{ id: 'mainPrompt', content: '主', role: 'system' }] };
    ensurePlotPromptsArray_ACU(ps);
    expect(ps.prompts.some((p: any) => p.id === 'systemPrompt')).toBe(true);
    expect(ps.prompts.some((p: any) => p.id === 'finalSystemDirective')).toBe(true);
  });
  it('null 不报错', () => {
    expect(() => ensurePlotPromptsArray_ACU(null as any)).not.toThrow();
  });
});

// ═══ getPlotPromptContentByIdFromSettings_ACU / setPlotPromptContentByIdForSettings_ACU ═══
describe('getPlotPromptContentByIdFromSettings_ACU', () => {
  it('获取指定 id 的内容', () => {
    const ps: any = { prompts: [{ id: 'mainPrompt', content: '主提示词' }] };
    expect(getPlotPromptContentByIdFromSettings_ACU(ps, 'mainPrompt')).toBe('主提示词');
  });
  it('不存在的 id 返回空字符串', () => {
    const ps: any = { prompts: [] };
    expect(getPlotPromptContentByIdFromSettings_ACU(ps, 'notExist')).toBe('');
  });
});

describe('setPlotPromptContentByIdForSettings_ACU', () => {
  it('设置指定 id 的内容', () => {
    const ps: any = { prompts: [{ id: 'mainPrompt', content: '' }] };
    setPlotPromptContentByIdForSettings_ACU(ps, 'mainPrompt', '新内容');
    expect(ps.prompts[0].content).toBe('新内容');
  });
  it('null 不报错', () => {
    expect(() => setPlotPromptContentByIdForSettings_ACU(null as any, 'any', '')).not.toThrow();
  });
});

// ═══ markPlotIntercept_ACU / shouldSkipPlotIntercept_ACU ═══
describe('markPlotIntercept_ACU / shouldSkipPlotIntercept_ACU', () => {
  it('标记后相同文本应跳过', () => {
    markPlotIntercept_ACU('测试文本');
    expect(shouldSkipPlotIntercept_ACU('测试文本')).toBe(true);
  });
  it('不同文本不跳过', () => {
    markPlotIntercept_ACU('文本A');
    expect(shouldSkipPlotIntercept_ACU('文本B')).toBe(false);
  });
  it('空文本不跳过', () => {
    markPlotIntercept_ACU('');
    expect(shouldSkipPlotIntercept_ACU('')).toBe(false);
  });
  it('超过窗口时间不跳过', () => {
    markPlotIntercept_ACU('测试');
    // windowMs=-1 表示已过期（age >= 0 > -1）
    expect(shouldSkipPlotIntercept_ACU('测试', -1)).toBe(false);
  });
});

// ═══ getPlotGlobalRevision_ACU ═══
describe('getPlotGlobalRevision_ACU', () => {
  it('返回全局修订号', () => {
    mockSettings.plotSettings.globalRevision = 5;
    expect(getPlotGlobalRevision_ACU()).toBe(5);
  });
  it('无修订号返回 0', () => {
    mockSettings.plotSettings.globalRevision = undefined;
    expect(getPlotGlobalRevision_ACU()).toBe(0);
  });
  it('负数返回 0', () => {
    mockSettings.plotSettings.globalRevision = -3;
    expect(getPlotGlobalRevision_ACU()).toBe(0);
  });
  it('浮点数取整', () => {
    mockSettings.plotSettings.globalRevision = 3.7;
    expect(getPlotGlobalRevision_ACU()).toBe(3);
  });
});

// ═══ normalizePlotPresetExcludeRules_ACU ═══
describe('normalizePlotPresetExcludeRules_ACU', () => {
  it('规范化预设排除规则', () => {
    const preset = { name: '预设A', contextExtractRules: [], contextExcludeRules: [] };
    const result = normalizePlotPresetExcludeRules_ACU(preset);
    expect(result).toHaveProperty('name', '预设A');
    expect(result).toHaveProperty('contextExtractRules');
    expect(result).toHaveProperty('contextExcludeRules');
  });
  it('null 返回 null', () => {
    expect(normalizePlotPresetExcludeRules_ACU(null)).toBeNull();
  });
  it('删除旧标签字段', () => {
    const preset = { name: 'A', contextExtractTags: 'tag1', contextExcludeTags: 'tag2' };
    const result = normalizePlotPresetExcludeRules_ACU(preset);
    expect(result.contextExtractTags).toBeUndefined();
    expect(result.contextExcludeTags).toBeUndefined();
  });
  it('清除已废弃的循环提示词字段并保留其他 loop 设置', () => {
    const preset: any = {
      name: '预设',
      loopSettings: { quickReplyContent: ['旧提示词'], currentPromptIndex: 1, maxRetries: 4, loopDelay: 250 },
    };
    const result = normalizePlotPresetExcludeRules_ACU(preset);
    expect(result.loopSettings).toEqual({ maxRetries: 4, loopDelay: 250 });
    expect(preset.loopSettings.quickReplyContent).toEqual(['旧提示词']);
  });
});

// ═══ stripPlotPresetWorldbookEntrySelectionForExport_ACU ═══
describe('stripPlotPresetWorldbookEntrySelectionForExport_ACU', () => {
  it('移除世界书条目选择', () => {
    const preset = {
      name: '预设A',
      plotWorldbookConfig: { enabledEntries: ['entry1'], otherField: true },
    };
    const result = stripPlotPresetWorldbookEntrySelectionForExport_ACU(preset);
    expect(result.plotWorldbookConfig.enabledEntries).toBeUndefined();
    expect(result.plotWorldbookConfig.otherField).toBe(true);
  });
  it('无 plotWorldbookConfig 不报错', () => {
    const result = stripPlotPresetWorldbookEntrySelectionForExport_ACU({ name: 'A' });
    expect(result).not.toBeNull();
    expect(result.name).toBe('A');
  });
  it('null 返回 null', () => {
    expect(stripPlotPresetWorldbookEntrySelectionForExport_ACU(null)).toBeNull();
  });
});

// ═══ findPlotPresetByName_ACU ═══
describe('findPlotPresetByName_ACU', () => {
  it('找到预设', () => {
    mockSettings.plotSettings.promptPresets = [{ name: '预设A' }];
    const result = findPlotPresetByName_ACU('预设A');
    expect(result).not.toBeNull();
    expect(result.name).toBe('预设A');
  });
  it('未找到返回 null', () => {
    mockSettings.plotSettings.promptPresets = [];
    expect(findPlotPresetByName_ACU('不存在')).toBeNull();
  });
  it('空名称返回 null', () => {
    expect(findPlotPresetByName_ACU('')).toBeNull();
  });
});

// ═══ getLastOptimizedMessageIndex_ACU ═══
describe('getLastOptimizedMessageIndex_ACU', () => {
  it('无聊天记录返回 -1', () => {
    expect(getLastOptimizedMessageIndex_ACU()).toBe(-1);
  });
});

// ═══ ensureTagRulesCompat_ACU ═══
describe('ensureTagRulesCompat_ACU', () => {
  it('规范化顶层和 plotSettings 的标签规则', () => {
    const settings: any = {
      tableContextExtractRules: null,
      tableContextExcludeRules: null,
      tableContextExtractTags: 'tag1',
      tableContextExcludeTags: 'tag2',
      plotSettings: {
        contextExtractRules: null,
        contextExcludeRules: null,
        contextExtractTags: 'ptag1',
        contextExcludeTags: 'ptag2',
      },
    };
    ensureTagRulesCompat_ACU(settings);
    expect(Array.isArray(settings.tableContextExtractRules)).toBe(true);
    expect(Array.isArray(settings.tableContextExcludeRules)).toBe(true);
    expect(Array.isArray(settings.plotSettings.contextExtractRules)).toBe(true);
    expect(Array.isArray(settings.plotSettings.contextExcludeRules)).toBe(true);
  });
  it('null 输入不报错', () => {
    expect(() => ensureTagRulesCompat_ACU(null as any)).not.toThrow();
  });
  it('非对象输入不报错', () => {
    expect(() => ensureTagRulesCompat_ACU('string' as any)).not.toThrow();
  });
  it('无 plotSettings 时只处理顶层', () => {
    const settings: any = { tableContextExtractRules: null, tableContextExcludeRules: null };
    ensureTagRulesCompat_ACU(settings);
    expect(Array.isArray(settings.tableContextExtractRules)).toBe(true);
  });
});

// ═══ getPlotPromptGroupFromSource_ACU ═══
describe('getPlotPromptGroupFromSource_ACU', () => {
  it('优先使用 source.promptGroup', () => {
    const source = { promptGroup: [{ role: 'SYSTEM', content: '内容A', mainSlot: 'A', isMain: true }] };
    const result = getPlotPromptGroupFromSource_ACU(source);
    expect(result[0].content).toBe('内容A');
  });
  it('null source 返回默认 promptGroup', () => {
    const result = getPlotPromptGroupFromSource_ACU(null);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
  it('空 promptGroup 回退到 legacy prompts', () => {
    const source = { promptGroup: [], mainPrompt: '旧主提示词' };
    const result = getPlotPromptGroupFromSource_ACU(source);
    expect(result.some((s: any) => s.content === '旧主提示词')).toBe(true);
  });
  it('使用 fallbackPromptGroup', () => {
    const fallback = [{ role: 'SYSTEM', content: '回退内容', mainSlot: 'A', isMain: true }];
    const result = getPlotPromptGroupFromSource_ACU({}, { fallbackPromptGroup: fallback });
    expect(result.some((s: any) => s.content === '回退内容')).toBe(true);
  });
});

// ═══ syncLegacyPlotSettingsFromTask_ACU ═══
describe('syncLegacyPlotSettingsFromTask_ACU', () => {
  it('从任务同步 promptGroup 和 extractTags 到 plotSettings', () => {
    const plotSettings: any = { prompts: [] };
    const task = {
      promptGroup: [{ role: 'SYSTEM', content: '任务内容', mainSlot: 'A', isMain: true }],
      extractTags: '<tag>',
      minLength: 100,
    };
    syncLegacyPlotSettingsFromTask_ACU(plotSettings, task);
    expect(plotSettings.promptGroup).toBeInstanceOf(Array);
    expect(plotSettings.promptGroup.length).toBeGreaterThan(0);
    expect(plotSettings.extractTags).toBe('<tag>');
    expect(plotSettings.minLength).toBe(100);
  });
  it('null plotSettings 不报错', () => {
    expect(() => syncLegacyPlotSettingsFromTask_ACU(null as any, {} as any)).not.toThrow();
  });
  it('null task 不报错', () => {
    expect(() => syncLegacyPlotSettingsFromTask_ACU({} as any, null as any)).not.toThrow();
  });
});

// ═══ ensurePlotTasksCompat_ACU ═══
describe('ensurePlotTasksCompat_ACU', () => {
  it('规范化 plotTasks 并同步 legacy', () => {
    const plotSettings: any = {
      plotTasks: [{ id: 'task1', name: '任务1', enabled: true }],
      prompts: [],
    };
    ensurePlotTasksCompat_ACU(plotSettings);
    expect(Array.isArray(plotSettings.plotTasks)).toBe(true);
    expect(plotSettings.plotTasks[0].id).toBe('task1');
  });
  it('null 输入不报错', () => {
    expect(() => ensurePlotTasksCompat_ACU(null as any)).not.toThrow();
  });
  it('syncLegacy=false 时不同步但仍规范化', () => {
    const plotSettings: any = { plotTasks: [{ id: 'task1' }], prompts: [] };
    ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: false });
    // normalizePlotTasks_ACU 会补充所有默认字段
    expect(plotSettings.plotTasks.length).toBe(1);
    expect(plotSettings.plotTasks[0].id).toBe('task1');
    expect(plotSettings.plotTasks[0].enabled).toBe(true);
    expect(plotSettings.plotTasks[0].mergeStrategy).toBe('append');
    expect(plotSettings.plotTasks[0].maxRetries).toBe(3);
    expect(plotSettings.plotTasks[0].stage).toBe(1);
    expect(plotSettings.plotTasks[0].order).toBe(0);
    // syncLegacy=false 时不应调用 syncLegacyPlotSettingsFromTask_ACU
    // 验证 plotSettings 上没有被同步的 legacy 字段
    expect(plotSettings.rateMain).toBeUndefined();
  });
  it('persist=true 时调用 saveSettings', () => {
    const plotSettings: any = { plotTasks: [{ id: 'task1' }], prompts: [] };
    ensurePlotTasksCompat_ACU(plotSettings, { persist: true });
    expect(saveSettings_ACU).toHaveBeenCalled();
  });
});

// ═══ getPlotPresetBindingForChat_ACU ═══
describe('getPlotPresetBindingForChat_ACU', () => {
  it('有绑定时返回规范化的绑定对象', () => {
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: '预设A', source: 'ui', isExplicit: true, updatedAt: 1000 } };
    const binding = getPlotPresetBindingForChat_ACU('test-chat');
    expect(binding).not.toBeNull();
    expect(binding!.presetName).toBe('预设A');
    expect(binding!.source).toBe('ui');
    expect(binding!.isExplicit).toBe(true);
  });
  it('无绑定时返回 null', () => {
    mockSettings.plotPresetBindings = {};
    expect(getPlotPresetBindingForChat_ACU('test-chat')).toBeNull();
  });
  it('无效 source 规范化为 inherit', () => {
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: 'A', source: 'invalid' } };
    const binding = getPlotPresetBindingForChat_ACU('test-chat');
    expect(binding!.source).toBe('inherit');
  });
});

// ═══ clearPlotPresetBindingForChat_ACU ═══
describe('clearPlotPresetBindingForChat_ACU', () => {
  it('清除已有绑定返回 true', () => {
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: 'A' } };
    expect(clearPlotPresetBindingForChat_ACU('test-chat')).toBe(true);
    expect(mockSettings.plotPresetBindings['test-chat']).toBeUndefined();
  });
  it('无绑定时返回 false', () => {
    mockSettings.plotPresetBindings = {};
    expect(clearPlotPresetBindingForChat_ACU('test-chat')).toBe(false);
  });
});

// ═══ resolveActivePlotPresetName_ACU ═══
describe('resolveActivePlotPresetName_ACU', () => {
  it('无任何绑定和 scope 时返回空字符串', () => {
    expect(resolveActivePlotPresetName_ACU()).toBe('');
  });
  it('有 chatScope 时使用 chatScope 的 presetName', () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU).mockReturnValueOnce({ presetName: '聊天预设' } as any);
    expect(resolveActivePlotPresetName_ACU()).toBe('聊天预设');
  });
  it('fallbackToGlobal=false 时不回退到全局', () => {
    mockSettings.plotSettings.lastUsedPresetName = '全局预设';
    expect(resolveActivePlotPresetName_ACU({ fallbackToGlobal: false })).toBe('');
  });
  it('有全局预设且存在时返回全局预设名', () => {
    mockSettings.plotSettings.lastUsedPresetName = '全局预设';
    mockSettings.plotSettings.promptPresets = [{ name: '全局预设' }];
    expect(resolveActivePlotPresetName_ACU()).toBe('全局预设');
  });
});

// ═══ getCurrentRuntimePlotPresetName_ACU ═══
describe('getCurrentRuntimePlotPresetName_ACU', () => {
  it('返回规范化的预设名', () => {
    expect(getCurrentRuntimePlotPresetName_ACU()).toBe('');
  });
  it('fallbackToGlobal 参数传递', () => {
    mockSettings.plotSettings.lastUsedPresetName = '全局预设';
    mockSettings.plotSettings.promptPresets = [{ name: '全局预设' }];
    expect(getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true })).toBe('全局预设');
    expect(getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: false })).toBe('');
  });
});

// ═══ setCurrentEditablePlotPresetState_ACU ═══
describe('setCurrentEditablePlotPresetState_ACU', () => {
  it('设置编辑器预设状态', () => {
    setCurrentEditablePlotPresetState_ACU('预设A', { scope: 'chat', source: 'ui' });
    expect(_set_currentEditablePlotPresetState_ACU).toHaveBeenCalledWith({
      initialized: true,
      presetName: '预设A',
      scope: 'chat',
      source: 'ui',
    });
  });
  it('scope 默认为 resolved', () => {
    setCurrentEditablePlotPresetState_ACU('预设B');
    expect(_set_currentEditablePlotPresetState_ACU).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'resolved' }),
    );
  });
  it('DEFAULT_PRESET_OPTION_VALUE 规范化为空字符串', () => {
    setCurrentEditablePlotPresetState_ACU('__ACU_DEFAULT_PRESET__');
    expect(_set_currentEditablePlotPresetState_ACU).toHaveBeenCalledWith(
      expect.objectContaining({ presetName: '' }),
    );
  });
});

// ═══ syncCurrentEditablePlotPresetState_ACU ═══
describe('syncCurrentEditablePlotPresetState_ACU', () => {
  it('无 chatScope 和 binding 时 scope 为 global', () => {
    syncCurrentEditablePlotPresetState_ACU();
    expect(_set_currentEditablePlotPresetState_ACU).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global' }),
    );
  });
  it('有 chatScope 时 scope 为 chat', () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU).mockReturnValueOnce({ presetName: 'A' } as any);
    syncCurrentEditablePlotPresetState_ACU();
    expect(_set_currentEditablePlotPresetState_ACU).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'chat' }),
    );
  });
  it('source 默认为 runtime_sync', () => {
    syncCurrentEditablePlotPresetState_ACU();
    expect(_set_currentEditablePlotPresetState_ACU).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'runtime_sync' }),
    );
  });
});

// ═══ getActivePlotEditorSettings_ACU ═══
describe('getActivePlotEditorSettings_ACU', () => {
  it('activePlotEditorSettings 为 null 时回退到 settings.plotSettings', () => {
    const result = getActivePlotEditorSettings_ACU();
    expect(result).toBe(mockSettings.plotSettings);
  });
  it('fallbackToRuntime=false 且无 active 时返回 null', () => {
    const result = getActivePlotEditorSettings_ACU({ fallbackToRuntime: false });
    expect(result).toBeNull();
  });
});

// ═══ setActivePlotEditorSettings_ACU ═══
describe('setActivePlotEditorSettings_ACU', () => {
  it('设置 null 时清空', () => {
    setActivePlotEditorSettings_ACU(null);
    expect(_set_activePlotEditorSettings_ACU).toHaveBeenCalledWith(null);
  });
  it('设置有效对象时调用兼容性处理', () => {
    const ps: any = { prompts: [], loopSettings: { quickReplyContent: [] } };
    setActivePlotEditorSettings_ACU(ps);
    expect(_set_activePlotEditorSettings_ACU).toHaveBeenCalledWith(ps);
  });
  it('非对象输入清空', () => {
    setActivePlotEditorSettings_ACU('invalid' as any);
    expect(_set_activePlotEditorSettings_ACU).toHaveBeenCalledWith(null);
  });
});

// ═══ applyPlotPresetToSettings_ACU ═══
describe('applyPlotPresetToSettings_ACU', () => {
  it('应用预设到 plotSettings', () => {
    const plotSettings: any = { prompts: [], loopSettings: {} };
    const preset = {
      name: '预设A',
      rateMain: 0.8,
      ratePersonal: 0.5,
      rateErotic: 0.1,
      rateCuckold: 0.3,
      recallCount: 10,
      extractTags: '<tag>',
      minLength: 50,
      contextTurnCount: 5,
      contextExtractRules: [],
      contextExcludeRules: [],
    };
    const result = applyPlotPresetToSettings_ACU(plotSettings, preset);
    expect(result.normalizedPreset).not.toBeNull();
    expect(result.normalizedPreset.name).toBe('预设A');
    expect(plotSettings.rateMain).toBe(0.8);
    expect(plotSettings.recallCount).toBe(10);
    expect(plotSettings.extractTags).toBe('<tag>');
  });
  it('null preset 返回空结果', () => {
    const result = applyPlotPresetToSettings_ACU({} as any, null);
    expect(result.normalizedPreset).toBeNull();
  });
  it('null plotSettings 返回空结果', () => {
    const result = applyPlotPresetToSettings_ACU(null as any, { name: 'A' });
    expect(result.normalizedPreset).toBeNull();
  });
  it('预设的 loopSettings 合并到 plotSettings', () => {
    const plotSettings: any = { prompts: [], loopSettings: { maxRetries: 3 } };
    const preset = { name: 'A', loopSettings: { maxRetries: 5 } };
    applyPlotPresetToSettings_ACU(plotSettings, preset);
    expect(plotSettings.loopSettings.maxRetries).toBe(5);
  });
  it('应用预设时不让废弃循环字段留在运行时设置中', () => {
    const plotSettings: any = {
      prompts: [],
      loopSettings: { quickReplyContent: ['旧设置'], currentPromptIndex: 1, maxRetries: 3 },
    };
    const preset: any = {
      name: '预设',
      loopSettings: { quickReplyContent: ['旧预设'], currentPromptIndex: 0, maxRetries: 5, loopDelay: 300 },
    };
    applyPlotPresetToSettings_ACU(plotSettings, preset);
    expect(plotSettings.loopSettings).toEqual({ maxRetries: 5, loopDelay: 300 });
  });
});

// ═══ resetPlotSettingsToDefault_ACU ═══
describe('resetPlotSettingsToDefault_ACU', () => {
  it('重置后保留 promptPresets 和 lastUsedPresetName', () => {
    const plotSettings: any = {
      prompts: [],
      promptPresets: [{ name: '保留预设' }],
      lastUsedPresetName: '保留名称',
      globalRevision: 5,
      rateMain: 0.5,
    };
    const result = resetPlotSettingsToDefault_ACU(plotSettings);
    expect(result).not.toBeNull();
    expect(result!.promptPresets).toEqual([{ name: '保留预设' }]);
    expect(result!.lastUsedPresetName).toBe('保留名称');
    expect(result!.globalRevision).toBe(5);
  });
  it('重置时清理保留预设中的废弃循环字段', () => {
    const plotSettings: any = {
      prompts: [],
      promptPresets: [{ name: '保留预设', loopSettings: { quickReplyContent: ['旧提示词'], currentPromptIndex: 0, maxRetries: 3 } }],
    };
    const result = resetPlotSettingsToDefault_ACU(plotSettings);
    expect(result!.promptPresets).toEqual([{ name: '保留预设', loopSettings: { maxRetries: 3 } }]);
  });
  it('重置后保留剧情世界书选择（以角色卡为单位，不属于预设）', () => {
    const plotSettings: any = {
      prompts: [],
      plotWorldbookConfig: { source: 'manual', manualSelection: ['手动书'], enabledEntries: { 手动书: [1] } },
    };
    const result = resetPlotSettingsToDefault_ACU(plotSettings);
    expect(result!.plotWorldbookConfig).toEqual({ source: 'manual', manualSelection: ['手动书'], enabledEntries: { 手动书: [1] } });
  });
  it('null 输入返回 null', () => {
    expect(resetPlotSettingsToDefault_ACU(null as any)).toBeNull();
  });
  it('非对象输入返回 null', () => {
    expect(resetPlotSettingsToDefault_ACU('invalid' as any)).toBeNull();
  });
});

// ═══ replaceCurrentPlotSettingsWithSnapshot_ACU ═══
describe('replaceCurrentPlotSettingsWithSnapshot_ACU', () => {
  it('用快照替换当前设置并保留 promptPresets', () => {
    vi.mocked(sanitizePlotSettingsSnapshotForChat_ACU).mockReturnValueOnce({ rateMain: 0.9 } as any);
    const plotSettings: any = {
      prompts: [],
      promptPresets: [{ name: '保留' }],
      lastUsedPresetName: '保留名',
      globalRevision: 3,
    };
    const result = replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings, { rateMain: 0.9 });
    expect(result).not.toBeNull();
    expect(result!.promptPresets).toEqual([{ name: '保留' }]);
    expect(result!.lastUsedPresetName).toBe('保留名');
    expect(result!.globalRevision).toBe(3);
  });
  it('恢复聊天快照时清理保留预设中的废弃循环字段', () => {
    vi.mocked(sanitizePlotSettingsSnapshotForChat_ACU).mockReturnValueOnce({ rateMain: 0.9 } as any);
    const plotSettings: any = {
      prompts: [],
      promptPresets: [{ name: '保留', loopSettings: { quickReplyContent: ['旧提示词'], currentPromptIndex: 0, maxRetries: 3 } }],
    };
    const result = replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings, { rateMain: 0.9 });
    expect(result!.promptPresets).toEqual([{ name: '保留', loopSettings: { maxRetries: 3 } }]);
  });
  it('快照中的旧剧情世界书选择不覆盖当前角色卡的选择', () => {
    vi.mocked(sanitizePlotSettingsSnapshotForChat_ACU).mockReturnValueOnce({
      rateMain: 0.9,
      plotWorldbookConfig: { source: 'character', manualSelection: [] },
    } as any);
    const plotSettings: any = {
      prompts: [],
      plotWorldbookConfig: { source: 'manual', manualSelection: ['当前卡的书'], enabledEntries: {} },
    };
    const result = replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings, { rateMain: 0.9 });
    expect(result!.rateMain).toBe(0.9);
    expect(result!.plotWorldbookConfig).toEqual({ source: 'manual', manualSelection: ['当前卡的书'], enabledEntries: {} });
  });
  it('null plotSettings 返回 null', () => {
    expect(replaceCurrentPlotSettingsWithSnapshot_ACU(null as any, {})).toBeNull();
  });
  it('null snapshot 返回 null', () => {
    vi.mocked(sanitizePlotSettingsSnapshotForChat_ACU).mockReturnValueOnce(null as any);
    expect(replaceCurrentPlotSettingsWithSnapshot_ACU({} as any, null)).toBeNull();
  });
});

// ═══ persistPlotPresetSelectionState_ACU ═══
describe('persistPlotPresetSelectionState_ACU', () => {
  it('updateGlobal=true 时更新全局 lastUsedPresetName', () => {
    persistPlotPresetSelectionState_ACU('新预设', { updateGlobal: true });
    expect(mockSettings.plotSettings.lastUsedPresetName).toBe('新预设');
  });
  it('save=true 时调用 saveSettings', () => {
    persistPlotPresetSelectionState_ACU('预设A', { save: true });
    expect(saveSettings_ACU).toHaveBeenCalled();
  });
  it('save=false 时不调用 saveSettings', () => {
    vi.mocked(saveSettings_ACU).mockClear();
    persistPlotPresetSelectionState_ACU('预设A', { save: false });
    expect(saveSettings_ACU).not.toHaveBeenCalled();
  });
  it('返回规范化的预设名', () => {
    const result = persistPlotPresetSelectionState_ACU('  预设B  ');
    expect(result).toBe('预设B');
  });
  it('persistChatScope 时写入当前聊天预设绑定', () => {
    vi.mocked(buildChatPlotScopeStateFromSettings_ACU).mockReturnValueOnce({ presetName: 'A' } as any);
    persistPlotPresetSelectionState_ACU('预设A', { updateGlobal: false, persistChatScope: true });
    expect(mockSettings.plotPresetBindings?.['test-chat']).toMatchObject({
      presetName: '预设A',
      source: 'ui',
      isExplicit: true,
    });
    expect(setCurrentChatPlotScopeState_ACU).not.toHaveBeenCalled();
  });
});

// ═══ switchCurrentChatPlotPreset_ACU ═══
describe('switchCurrentChatPlotPreset_ACU', () => {
  it('切换到默认预设时清除绑定并重置', () => {
    mockSettings.plotSettings.promptPresets = [];
    mockSettings.plotSettings.lastUsedPresetName = '';
    const result = switchCurrentChatPlotPreset_ACU('');
    expect(result).toBeTruthy();
    if (result && typeof result === 'object') {
      expect(result.isDefault).toBe(true);
      expect(result.followsGlobal).toBe(true);
    }
  });
  it('切换到不存在的预设返回 false', () => {
    mockSettings.plotSettings.promptPresets = [];
    expect(switchCurrentChatPlotPreset_ACU('不存在的预设')).toBe(false);
  });
  it('切换到存在的预设返回结果对象', () => {
    mockSettings.plotSettings.promptPresets = [{ name: '预设A', contextExtractRules: [], contextExcludeRules: [] }];
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    const result = switchCurrentChatPlotPreset_ACU('预设A');
    expect(result).toBeTruthy();
    if (result && typeof result === 'object') {
      expect(result.presetName).toBe('预设A');
      expect(result.isDefault).toBe(false);
    }
  });
  it('settings 无 plotSettings 时返回 false', () => {
    mockSettings.plotSettings = null;
    expect(switchCurrentChatPlotPreset_ACU('任意')).toBe(false);
  });
  it('有旧 chatScope 时先清除', () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU).mockReturnValueOnce({ presetName: '旧' } as any);
    mockSettings.plotSettings.promptPresets = [{ name: '预设A', contextExtractRules: [], contextExcludeRules: [] }];
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    switchCurrentChatPlotPreset_ACU('预设A');
    expect(clearCurrentChatPlotScopeState_ACU).toHaveBeenCalled();
  });
});

// ═══ clearCurrentChatPlotPresetOverride_ACU ═══
describe('clearCurrentChatPlotPresetOverride_ACU', () => {
  it('清理当前聊天剧情快照和绑定，并切回跟随全局', async () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any);
    mockSettings.plotSettings.promptPresets = [{ name: '全局预设', contextExtractRules: [], contextExcludeRules: [] }];
    mockSettings.plotSettings.lastUsedPresetName = '全局预设';
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: '聊天预设', source: 'ui', isExplicit: true } };

    const result = await clearCurrentChatPlotPresetOverride_ACU({ source: 'test_reset' });

    expect(result.changed).toBe(true);
    expect(result.clearedChatScope).toBe(true);
    expect(result.clearedBinding).toBe(true);
    expect(result.activePresetName).toBe('全局预设');
    expect(result.followsGlobal).toBe(true);
    expect(clearCurrentChatPlotScopeState_ACU).toHaveBeenCalled();
    expect(mockSettings.plotPresetBindings['test-chat']).toBeUndefined();
    expect(mockSettings.plotSettings.promptPresets.map((preset: any) => preset.name)).toContain('全局预设');
    expect(saveSettings_ACU).toHaveBeenCalled();
    expect(saveChatToHost_ACU).toHaveBeenCalled();
  });

  it('saveSettings=false 时不立即保存设置，但仍可保存聊天快照清理', async () => {
    vi.mocked(getCurrentChatPlotScopeState_ACU)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any)
      .mockReturnValueOnce({ presetName: '聊天预设', snapshot: {} } as any);
    mockSettings.plotSettings.promptPresets = [];
    mockSettings.plotSettings.lastUsedPresetName = '';
    mockSettings.plotPresetBindings = { 'test-chat': { presetName: '聊天预设', source: 'ui', isExplicit: true } };

    await clearCurrentChatPlotPresetOverride_ACU({
      source: 'test_reset',
      saveSettings: false,
      saveChat: true,
    });

    expect(saveSettings_ACU).not.toHaveBeenCalled();
    expect(saveChatToHost_ACU).toHaveBeenCalled();
  });

  it('没有 plotSettings 时返回未变更结果', async () => {
    mockSettings.plotSettings = null;

    const result = await clearCurrentChatPlotPresetOverride_ACU();

    expect(result.changed).toBe(false);
    expect(result.followsGlobal).toBe(false);
  });
});

// ═══ applyGlobalPlotPresetSelectionForEditor_ACU ═══
describe('applyGlobalPlotPresetSelectionForEditor_ACU', () => {
  it('应用全局预设选择', () => {
    mockSettings.plotSettings.promptPresets = [{ name: '全局预设', contextExtractRules: [], contextExcludeRules: [] }];
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    const result = applyGlobalPlotPresetSelectionForEditor_ACU('全局预设');
    expect(result).toBeTruthy();
    if (result && typeof result === 'object') {
      expect(result.presetName).toBe('全局预设');
      expect(result.isDefault).toBe(false);
    }
  });
  it('不存在的预设返回 false', () => {
    mockSettings.plotSettings.promptPresets = [];
    expect(applyGlobalPlotPresetSelectionForEditor_ACU('不存在')).toBe(false);
  });
  it('settings 无 plotSettings 时返回 false', () => {
    mockSettings.plotSettings = null;
    expect(applyGlobalPlotPresetSelectionForEditor_ACU('任意')).toBe(false);
  });
  it('默认预设选择时 isDefault 为 true', () => {
    mockSettings.plotSettings.prompts = [];
    mockSettings.plotSettings.loopSettings = { quickReplyContent: [], maxRetries: 3 };
    const result = applyGlobalPlotPresetSelectionForEditor_ACU('');
    expect(result).toBeTruthy();
    if (result && typeof result === 'object') {
      expect(result.isDefault).toBe(true);
    }
  });
});
