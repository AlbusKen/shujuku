import { describe, expect, it, vi } from 'vitest';
import { effectiveWorldSimulationAgentApiPresetMode_ACU, resolveWorldSimulationAgentApiPreset_ACU } from '../../../src/service/simulation/api-preset';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';

const apiConfig = { url: 'https://example.invalid', apiKey: '', model: 'test', useMainApi: false, max_tokens: 100, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '', promptPostProcessing: 'strict' as const, customApiFormat: 'openai_compat' as const };
const dependencies = (resolved = true) => ({ resolvePreset: vi.fn((name: string) => ({ resolved, apiMode: 'custom' as const, apiConfig: { ...apiConfig, model: name || 'current' }, tavernProfile: '' })) });
const settings = { apiPresetMode: 'fixed' as const, fixedApiPresetName: 'global', agentApiPresets: { reviewer: { mode: 'fixed' as const, presetName: 'review' }, planner: { mode: 'current' as const, presetName: '' } } };

describe('世界推演 API preset', () => {
  it('角色配置覆盖全局配置，缺失角色继承全局', () => {
    const deps = dependencies();
    expect(resolveWorldSimulationAgentApiPreset_ACU(settings, 'reviewer', 'agent_delegate', deps)).toMatchObject({ presetName: 'review', source: 'fixed' });
    expect(resolveWorldSimulationAgentApiPreset_ACU(settings, 'planner', 'agent_delegate', deps)).toMatchObject({ presetName: '', source: 'current' });
    expect(resolveWorldSimulationAgentApiPreset_ACU(settings, 'main', 'agent_loop', deps)).toMatchObject({ presetName: 'global', source: 'fixed' });
    expect(effectiveWorldSimulationAgentApiPresetMode_ACU(settings, 'planner')).toBe('current');
  });

  it('固定预设为空或悬挂时 fail-closed', () => {
    for (const [presetName, deps] of [['', dependencies()], ['missing', dependencies(false)]] as const) {
      try { resolveWorldSimulationAgentApiPreset_ACU({ ...settings, agentApiPresets: { role: { mode: 'fixed' as const, presetName } } }, 'role', 'agent_delegate', deps); }
      catch (error) { expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU); expect((error as WorldSimulationValidationError_ACU).error.code).toBe('WORLD_SIMULATION_API_PRESET_MISSING'); continue; }
      throw new Error('expected preset failure');
    }
  });
});
