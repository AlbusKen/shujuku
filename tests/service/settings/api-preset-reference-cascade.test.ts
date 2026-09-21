/**
 * API 预设删除/重命名级联：六类旧字段 + vector keyword + 续写/推演 envelope。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSettings,
  mockGlobalMeta,
  mockSaveSettings,
  mockGetChatArray,
  mockSaveChatToHostStrict,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockSettings: {} as Record<string, unknown>,
  mockGlobalMeta: {} as Record<string, unknown>,
  mockSaveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' })),
  mockGetChatArray: vi.fn(),
  mockSaveChatToHostStrict: vi.fn(async () => undefined),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentChatFileIdentifier_ACU: 'chat-cascade',
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: mockGlobalMeta,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHostStrict_ACU: mockSaveChatToHostStrict,
}));

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
  clearApiPresetReferences_ACU,
  deleteApiPreset_ACU,
  renameApiPresetReferences_ACU,
  saveApiPreset_ACU,
} from '../../../src/service/settings/api-preset-service';

const OLD_NAME = '旧预设';
const NEW_NAME = '新预设';

function makePreset(name: string) {
  return {
    name,
    apiMode: 'custom' as const,
    apiConfig: {
      url: `https://${name}.example`,
      apiKey: '',
      model: name,
      useMainApi: false,
      max_tokens: 100,
      temperature: 1,
      bodyParams: '',
      excludeBodyParams: '',
      requestHeaders: '',
    },
    tavernProfile: '',
  };
}

function resetSettings(firstFloor: Record<string, unknown> | null) {
  mockGlobalMeta.vectorMemoryConfigGlobal = { keywordApiPreset: OLD_NAME };
  const continuationSettings = {
    ...buildDefaultContinuationSettings_ACU(),
    apiPresetMode: 'fixed' as const,
    fixedApiPresetName: OLD_NAME,
    agentApiPresets: {
      ...buildDefaultContinuationSettings_ACU().agentApiPresets,
      main: { mode: 'fixed' as const, presetName: OLD_NAME },
      outline: { mode: 'inherit' as const, presetName: OLD_NAME },
      reviewer: { mode: 'fixed' as const, presetName: '其他预设' },
    },
  };
  const simulationEnvelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulationEnvelope.settings.apiPresetMode = 'fixed';
  simulationEnvelope.settings.fixedApiPresetName = OLD_NAME;
  simulationEnvelope.settings.agentApiPresets = {
    planner: { mode: 'fixed', presetName: OLD_NAME },
    reviewer: { mode: 'current', presetName: OLD_NAME },
    narrator: { mode: 'fixed', presetName: '其他预设' },
  };

  Object.keys(mockSettings).forEach(key => { delete mockSettings[key]; });
  Object.assign(mockSettings, {
    apiMode: 'custom',
    apiConfig: { url: 'https://current.example', model: 'current', useMainApi: false },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [makePreset(OLD_NAME), makePreset('其他预设')],
    defaultApiPresetName: OLD_NAME,
    apiPresetBindingsByChat: {
      'chat-cascade': { presetName: OLD_NAME, updatedAt: 1 },
      other: { presetName: '其他预设', updatedAt: 1 },
    },
    tableApiPreset: OLD_NAME,
    plotApiPreset: OLD_NAME,
    tableApiPresetOverridesByName: { 人物表: OLD_NAME, 道具表: '其他预设' },
    plotTaskApiPresetOverridesById: { taskA: OLD_NAME, taskB: '其他预设' },
    contentOptimizationSettings: { apiPreset: OLD_NAME },
    vectorMemoryConfig: { keywordApiPreset: OLD_NAME },
    [CONTINUATION_GLOBAL_SETTINGS_KEY_ACU]: JSON.parse(JSON.stringify(continuationSettings)),
  });

  if (firstFloor) {
    firstFloor[CONTINUATION_FIRST_FLOOR_FIELD_ACU] = {
      schemaVersion: 1,
      settings: JSON.parse(JSON.stringify(continuationSettings)),
      activeTask: null,
    };
    firstFloor[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = JSON.parse(JSON.stringify(simulationEnvelope));
    mockGetChatArray.mockReturnValue([firstFloor]);
  } else {
    mockGetChatArray.mockImplementation(() => { throw new Error('no chat'); });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveSettings.mockReturnValue({ saved: true, storageType: 'memory' });
  mockSaveChatToHostStrict.mockResolvedValue(undefined);
});

describe('renameApiPresetReferences_ACU / clearApiPresetReferences_ACU', () => {
  it('重命名同步改写六类旧字段、keyword、全局续写副本与两个 envelope', () => {
    const firstFloor: Record<string, unknown> = { mes: '首楼' };
    resetSettings(firstFloor);

    renameApiPresetReferences_ACU(OLD_NAME, NEW_NAME);

    expect(mockSettings.tableApiPreset).toBe(NEW_NAME);
    expect(mockSettings.plotApiPreset).toBe(NEW_NAME);
    expect((mockSettings.contentOptimizationSettings as { apiPreset: string }).apiPreset).toBe(NEW_NAME);
    expect((mockGlobalMeta.vectorMemoryConfigGlobal as { keywordApiPreset: string }).keywordApiPreset).toBe(NEW_NAME);
    expect((mockSettings.vectorMemoryConfig as { keywordApiPreset: string }).keywordApiPreset).toBe(NEW_NAME);
    expect((mockSettings.tableApiPresetOverridesByName as Record<string, string>)['人物表']).toBe(NEW_NAME);
    expect((mockSettings.tableApiPresetOverridesByName as Record<string, string>)['道具表']).toBe('其他预设');
    expect((mockSettings.plotTaskApiPresetOverridesById as Record<string, string>).taskA).toBe(NEW_NAME);
    expect((mockSettings.apiPresetBindingsByChat as Record<string, { presetName: string }>)['chat-cascade'].presetName).toBe(NEW_NAME);

    const global = mockSettings[CONTINUATION_GLOBAL_SETTINGS_KEY_ACU] as any;
    expect(global.fixedApiPresetName).toBe(NEW_NAME);
    expect(global.agentApiPresets.main.presetName).toBe(NEW_NAME);
    expect(global.agentApiPresets.outline.presetName).toBe(NEW_NAME);
    expect(global.agentApiPresets.reviewer.presetName).toBe('其他预设');

    const continuation = (firstFloor[CONTINUATION_FIRST_FLOOR_FIELD_ACU] as any).settings;
    expect(continuation.fixedApiPresetName).toBe(NEW_NAME);
    expect(continuation.agentApiPresets.main.presetName).toBe(NEW_NAME);
    expect(continuation.agentApiPresets.outline.mode).toBe('inherit');
    expect(continuation.agentApiPresets.reviewer.presetName).toBe('其他预设');

    const simulation = (firstFloor[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] as any).settings;
    expect(simulation.fixedApiPresetName).toBe(NEW_NAME);
    expect(simulation.agentApiPresets.planner.presetName).toBe(NEW_NAME);
    expect(simulation.agentApiPresets.reviewer.presetName).toBe(NEW_NAME);
    expect(simulation.agentApiPresets.narrator.presetName).toBe('其他预设');
  });

  it('删除置空引用并回退 current；inherit 只清匹配的 presetName', () => {
    const firstFloor: Record<string, unknown> = { mes: '首楼' };
    resetSettings(firstFloor);

    clearApiPresetReferences_ACU(OLD_NAME);

    expect(mockSettings.tableApiPreset).toBe('');
    expect(mockSettings.plotApiPreset).toBe('');
    expect((mockSettings.contentOptimizationSettings as { apiPreset: string }).apiPreset).toBe('');
    expect((mockGlobalMeta.vectorMemoryConfigGlobal as { keywordApiPreset: string }).keywordApiPreset).toBe('');
    expect((mockSettings.tableApiPresetOverridesByName as Record<string, string>)['人物表']).toBeUndefined();
    expect((mockSettings.tableApiPresetOverridesByName as Record<string, string>)['道具表']).toBe('其他预设');
    expect((mockSettings.plotTaskApiPresetOverridesById as Record<string, string>).taskA).toBeUndefined();
    expect((mockSettings.apiPresetBindingsByChat as Record<string, unknown>)['chat-cascade']).toBeUndefined();
    expect((mockSettings.apiPresetBindingsByChat as Record<string, { presetName: string }>).other.presetName).toBe('其他预设');

    const continuation = (firstFloor[CONTINUATION_FIRST_FLOOR_FIELD_ACU] as any).settings;
    expect(continuation.apiPresetMode).toBe('current');
    expect(continuation.fixedApiPresetName).toBe('');
    expect(continuation.agentApiPresets.main).toEqual({ mode: 'current', presetName: '' });
    expect(continuation.agentApiPresets.outline).toEqual({ mode: 'inherit', presetName: '' });
    expect(continuation.agentApiPresets.reviewer).toEqual({ mode: 'fixed', presetName: '其他预设' });

    const simulation = (firstFloor[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] as any).settings;
    expect(simulation.apiPresetMode).toBe('current');
    expect(simulation.fixedApiPresetName).toBe('');
    expect(simulation.agentApiPresets.planner).toEqual({ mode: 'current', presetName: '' });
    expect(simulation.agentApiPresets.reviewer).toEqual({ mode: 'current', presetName: '' });
    expect(simulation.agentApiPresets.narrator).toEqual({ mode: 'fixed', presetName: '其他预设' });
  });

  it('无聊天时跳过 envelope，不阻断 settings 级联', () => {
    resetSettings(null);
    expect(() => clearApiPresetReferences_ACU(OLD_NAME)).not.toThrow();
    expect(mockSettings.tableApiPreset).toBe('');
    expect((mockGlobalMeta.vectorMemoryConfigGlobal as { keywordApiPreset: string }).keywordApiPreset).toBe('');
  });
});

describe('deleteApiPreset_ACU / saveApiPreset_ACU 事务', () => {
  it('删除成功后尽力 persist 信封', async () => {
    const firstFloor: Record<string, unknown> = { mes: '首楼' };
    resetSettings(firstFloor);

    const result = deleteApiPreset_ACU(OLD_NAME);
    expect(result.ok).toBe(true);
    expect((mockSettings.apiPresets as Array<{ name: string }>).map(p => p.name)).toEqual(['其他预设']);
    expect((firstFloor[CONTINUATION_FIRST_FLOOR_FIELD_ACU] as any).settings.fixedApiPresetName).toBe('');

    await vi.waitFor(() => expect(mockSaveChatToHostStrict).toHaveBeenCalled());
  });

  it('保存失败时回滚 keyword、全局续写副本与两个 envelope', () => {
    const firstFloor: Record<string, unknown> = { mes: '首楼' };
    resetSettings(firstFloor);
    mockSaveSettings.mockReturnValue({ saved: false, warning: '磁盘失败' });

    const result = deleteApiPreset_ACU(OLD_NAME);
    expect(result.ok).toBe(false);
    expect((mockSettings.apiPresets as Array<{ name: string }>).map(p => p.name)).toEqual([OLD_NAME, '其他预设']);
    expect(mockSettings.tableApiPreset).toBe(OLD_NAME);
    expect((mockGlobalMeta.vectorMemoryConfigGlobal as { keywordApiPreset: string }).keywordApiPreset).toBe(OLD_NAME);
    expect((mockSettings[CONTINUATION_GLOBAL_SETTINGS_KEY_ACU] as any).fixedApiPresetName).toBe(OLD_NAME);
    expect((firstFloor[CONTINUATION_FIRST_FLOOR_FIELD_ACU] as any).settings.fixedApiPresetName).toBe(OLD_NAME);
    expect((firstFloor[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] as any).settings.fixedApiPresetName).toBe(OLD_NAME);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('重命名预设经 saveApiPreset 改写全部引用', async () => {
    const firstFloor: Record<string, unknown> = { mes: '首楼' };
    resetSettings(firstFloor);

    const result = saveApiPreset_ACU({ ...makePreset(NEW_NAME), apiConfig: makePreset(OLD_NAME).apiConfig }, OLD_NAME);
    expect(result.ok).toBe(true);
    expect(mockSettings.tableApiPreset).toBe(NEW_NAME);
    expect((firstFloor[CONTINUATION_FIRST_FLOOR_FIELD_ACU] as any).settings.fixedApiPresetName).toBe(NEW_NAME);
    expect((firstFloor[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] as any).settings.agentApiPresets.planner.presetName).toBe(NEW_NAME);
    await vi.waitFor(() => expect(mockSaveChatToHostStrict).toHaveBeenCalled());
  });
});
