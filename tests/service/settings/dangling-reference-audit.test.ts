/**
 * 失效引用审计：只读收集；清除走显式写入口，审计路径本身不写盘。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSettings,
  mockGlobalMeta,
  mockSaveSettings,
  mockGetChatArray,
  mockGetCurrentWorldbookConfig,
  mockListLorebooks,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockSettings: {} as Record<string, unknown>,
  mockGlobalMeta: {} as Record<string, unknown>,
  mockSaveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' })),
  mockGetChatArray: vi.fn(() => []),
  mockGetCurrentWorldbookConfig: vi.fn(() => ({ injectionTarget: 'character' })),
  mockListLorebooks: vi.fn(async () => [] as string[]),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentChatFileIdentifier_ACU: 'chat-audit',
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: mockGlobalMeta,
  saveGlobalMeta_ACU: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHostStrict_ACU: vi.fn(async () => undefined),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: mockGetCurrentWorldbookConfig,
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/gateways/worldbook-gateway')>();
  return {
    ...actual,
    listLorebooks_ACU: mockListLorebooks,
  };
});

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: vi.fn(),
}));

import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import {
  CONTINUATION_FIRST_FLOOR_FIELD_ACU,
  CONTINUATION_GLOBAL_SETTINGS_KEY_ACU,
} from '../../../src/service/continuation/continuation-store';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU } from '../../../src/service/simulation/simulation-store';
import {
  clearDanglingReference_ACU,
  collectDanglingApiPresetReferences_ACU,
  collectDanglingWorldbookReferences_ACU,
} from '../../../src/service/settings/dangling-reference-audit-service';

function seedBaseSettings() {
  Object.keys(mockSettings).forEach(key => { delete mockSettings[key]; });
  mockGlobalMeta.vectorMemoryConfigGlobal = { keywordApiPreset: '' };
  Object.assign(mockSettings, {
    apiMode: 'custom',
    apiConfig: { url: '', model: '', useMainApi: false },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [{
      name: '存在的预设',
      apiMode: 'custom',
      apiConfig: { url: '', apiKey: '', model: 'm', useMainApi: false },
      tavernProfile: '',
    }],
    defaultApiPresetName: '存在的预设',
    apiPresetBindingsByChat: {},
    tableApiPreset: '',
    plotApiPreset: '',
    tableApiPresetOverridesByName: {},
    plotTaskApiPresetOverridesById: {},
    contentOptimizationSettings: { apiPreset: '' },
    vectorMemoryConfig: { keywordApiPreset: '' },
    characterSettings: {},
  });
  mockGetChatArray.mockReturnValue([]);
  mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: 'character' });
  mockListLorebooks.mockResolvedValue(['角色世界书']);
  mockSaveSettings.mockReturnValue({ saved: true, storageType: 'memory' });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedBaseSettings();
});

describe('collectDanglingApiPresetReferences_ACU', () => {
  it('只标记非空且不在预设列表中的引用，不调用 saveSettings', () => {
    mockSettings.tableApiPreset = 'ghost-table';
    mockSettings.plotApiPreset = '存在的预设';
    (mockSettings.contentOptimizationSettings as { apiPreset: string }).apiPreset = 'ghost-opt';
    (mockGlobalMeta.vectorMemoryConfigGlobal as { keywordApiPreset: string }).keywordApiPreset = 'ghost-kw';
    mockSettings.tableApiPresetOverridesByName = { 人物表: 'ghost-sheet', 道具表: '存在的预设' };
    mockSettings.plotTaskApiPresetOverridesById = { t1: 'ghost-task' };

    const items = collectDanglingApiPresetReferences_ACU();
    expect(items.map(item => item.clearKey).sort()).toEqual([
      'optimization',
      'plot_task:t1',
      'table',
      'table_override:人物表',
      'vector_keyword',
    ]);
    expect(items.find(item => item.clearKey === 'table')?.name).toBe('ghost-table');
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('收集续写全局副本、当前聊天信封与推演信封中的悬挂名', () => {
    const settings = {
      ...buildDefaultContinuationSettings_ACU(),
      apiPresetMode: 'fixed' as const,
      fixedApiPresetName: 'ghost-fixed',
      agentApiPresets: {
        ...buildDefaultContinuationSettings_ACU().agentApiPresets,
        main: { mode: 'fixed' as const, presetName: 'ghost-main' },
      },
    };
    mockSettings[CONTINUATION_GLOBAL_SETTINGS_KEY_ACU] = JSON.parse(JSON.stringify(settings));
    const simulation = buildDefaultWorldSimulationEnvelope_ACU();
    simulation.settings.fixedApiPresetName = 'ghost-sim';
    simulation.settings.agentApiPresets = { planner: { mode: 'fixed', presetName: 'ghost-planner' } };
    mockGetChatArray.mockReturnValue([{
      [CONTINUATION_FIRST_FLOOR_FIELD_ACU]: { schemaVersion: 1, settings, activeTask: null },
      [WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU]: simulation,
    }]);

    const items = collectDanglingApiPresetReferences_ACU();
    expect(items.some(item => item.clearKey === 'continuation_global_fixed' && item.name === 'ghost-fixed')).toBe(true);
    expect(items.some(item => item.clearKey === 'continuation_fixed' && item.name === 'ghost-fixed')).toBe(true);
    expect(items.some(item => item.clearKey === 'continuation_agent:main' && item.name === 'ghost-main')).toBe(true);
    expect(items.some(item => item.clearKey === 'simulation_fixed' && item.name === 'ghost-sim')).toBe(true);
    expect(items.some(item => item.clearKey === 'simulation_agent:planner' && item.name === 'ghost-planner')).toBe(true);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('空预设名与存在的预设不进入审计结果', () => {
    mockSettings.tableApiPreset = '';
    mockSettings.plotApiPreset = '存在的预设';
    expect(collectDanglingApiPresetReferences_ACU()).toEqual([]);
  });
});

describe('collectDanglingWorldbookReferences_ACU', () => {
  it('injectionTarget=character 或空名不标记', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: 'character' });
    expect(await collectDanglingWorldbookReferences_ACU()).toEqual([]);
    expect(mockListLorebooks).not.toHaveBeenCalled();

    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: '' });
    expect(await collectDanglingWorldbookReferences_ACU()).toEqual([]);
  });

  it('名单未命中时标记注入目标，forceRefresh 读取且不写盘', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: '失踪世界书' });
    mockListLorebooks.mockResolvedValue(['角色世界书']);
    const items = await collectDanglingWorldbookReferences_ACU();
    expect(items).toEqual([{
      id: 'injection-target',
      kind: 'worldbook',
      label: '填表写入目标世界书',
      name: '失踪世界书',
      clearKey: 'worldbook_injection',
    }]);
    expect(mockListLorebooks).toHaveBeenCalledWith({ forceRefresh: true });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('名单读取失败时不标记、不写盘', async () => {
    mockGetCurrentWorldbookConfig.mockReturnValue({ injectionTarget: '失踪世界书' });
    mockListLorebooks.mockRejectedValue(new Error('host down'));
    expect(await collectDanglingWorldbookReferences_ACU()).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe('clearDanglingReference_ACU', () => {
  it('清除填表预设走 setFeatureApiPreset 并保存', async () => {
    mockSettings.tableApiPreset = 'ghost-table';
    const result = await clearDanglingReference_ACU({
      id: 'table',
      kind: 'api_preset',
      label: '填表 API 预设',
      name: 'ghost-table',
      clearKey: 'table',
    });
    expect(result.ok).toBe(true);
    expect(mockSettings.tableApiPreset).toBe('');
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('清除注入目标写回 character，失败则回滚', async () => {
    const cfg = { injectionTarget: '失踪世界书' };
    mockGetCurrentWorldbookConfig.mockReturnValue(cfg);
    mockSaveSettings.mockReturnValue({ saved: false, warning: '保存失败' });
    const result = await clearDanglingReference_ACU({
      id: 'injection-target',
      kind: 'worldbook',
      label: '填表写入目标世界书',
      name: '失踪世界书',
      clearKey: 'worldbook_injection',
    });
    expect(result.ok).toBe(false);
    expect(cfg.injectionTarget).toBe('失踪世界书');
  });

  it('清除注入目标成功时才改为 character', async () => {
    const cfg = { injectionTarget: '失踪世界书' };
    mockGetCurrentWorldbookConfig.mockReturnValue(cfg);
    const result = await clearDanglingReference_ACU({
      id: 'injection-target',
      kind: 'worldbook',
      label: '填表写入目标世界书',
      name: '失踪世界书',
      clearKey: 'worldbook_injection',
    });
    expect(result.ok).toBe(true);
    expect(cfg.injectionTarget).toBe('character');
  });
});
