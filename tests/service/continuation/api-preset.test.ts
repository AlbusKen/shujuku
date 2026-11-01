import { describe, expect, it, vi } from 'vitest';
import { effectiveAgentApiPresetMode_ACU, resolveContinuationAgentApiPreset_ACU } from '../../../src/service/continuation/api-preset';
import { buildDefaultContinuationAgentApiPresets_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';

function settings_ACU(overrides: Record<string, unknown> = {}) {
  return {
    apiPresetMode: 'fixed' as const,
    fixedApiPresetName: 'global-preset',
    agentApiPresets: buildDefaultContinuationAgentApiPresets_ACU(),
    ...overrides,
  };
}

function dependencies_ACU() {
  return {
    resolvePreset: vi.fn((presetName: string) => ({
      resolved: true,
      apiMode: 'custom' as const,
      apiConfig: { url: `https://example.invalid/${presetName || 'active'}`, apiKey: '', model: 'test', useMainApi: !presetName, max_tokens: 1, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' },
      tavernProfile: '',
    })),
  };
}

describe('resolveContinuationAgentApiPreset_ACU', () => {
  it('falls back to the global channel when the role is set to inherit', () => {
    const deps = dependencies_ACU();
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU(), 'main', 'turn_call', deps);
    expect(preset).toMatchObject({ presetName: 'global-preset', source: 'fixed' });
    expect(deps.resolvePreset).toHaveBeenCalledWith('global-preset');
  });

  it('falls back to the global channel when agentApiPresets is missing entirely', () => {
    const deps = dependencies_ACU();
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU({ agentApiPresets: undefined }), 'outline', 'outline_call', deps);
    expect(preset).toMatchObject({ presetName: 'global-preset', source: 'fixed' });
  });

  it('resolves a role-specific fixed preset independent of the global channel', () => {
    const agentApiPresets = buildDefaultContinuationAgentApiPresets_ACU();
    agentApiPresets.reviewer = { mode: 'fixed', presetName: 'reviewer-preset' };
    const deps = dependencies_ACU();
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU({ agentApiPresets, apiPresetMode: 'current' }), 'reviewer', 'agent_delegate', deps);
    expect(preset).toMatchObject({ presetName: 'reviewer-preset', source: 'fixed' });
  });

  it('resolves a role-specific current channel while the global channel stays fixed', () => {
    const agentApiPresets = buildDefaultContinuationAgentApiPresets_ACU();
    agentApiPresets.beatPlanner = { mode: 'current', presetName: '' };
    const deps = dependencies_ACU();
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU({ agentApiPresets }), 'beatPlanner', 'agent_delegate', deps);
    expect(preset).toMatchObject({ presetName: '', source: 'current' });
    expect(deps.resolvePreset).toHaveBeenCalledWith('');
  });

  it('fails closed when a role-specific fixed preset has no name', () => {
    const agentApiPresets = buildDefaultContinuationAgentApiPresets_ACU();
    agentApiPresets.maintainer = { mode: 'fixed', presetName: '  ' };
    try {
      resolveContinuationAgentApiPreset_ACU(settings_ACU({ agentApiPresets }), 'maintainer', 'agent_delegate', dependencies_ACU());
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_API_PRESET_MISSING');
      return;
    }
    throw new Error('Expected CONTINUATION_API_PRESET_MISSING');
  });

  it.each(['fixed', 'current'] as const)('%s 渠道在配置对象被替换后读取最新 URL 和模型', mode => {
    const deps = dependencies_ACU();
    let channel = deps.resolvePreset(mode === 'fixed' ? 'global-preset' : '');
    deps.resolvePreset.mockImplementation(() => channel);
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU({ apiPresetMode: mode }), 'main', 'turn_call', deps);
    const oldConfig = preset.apiConfig;
    channel = { ...channel, apiConfig: { ...channel.apiConfig, url: 'https://updated.invalid/v1', model: 'updated-model' } };

    expect(preset.apiConfig).toBe(channel.apiConfig);
    expect(preset.apiConfig).not.toBe(oldConfig);
    expect(preset.apiConfig).toMatchObject({ url: 'https://updated.invalid/v1', model: 'updated-model' });
    expect(preset.presetName).toBe(mode === 'fixed' ? 'global-preset' : '');
  });

  it('固定预设始终按原名称回读，不跟随当前渠道切换', () => {
    const deps = dependencies_ACU();
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU(), 'main', 'turn_call', deps);
    deps.resolvePreset.mockClear();
    expect(preset.apiConfig.url).toBe('https://example.invalid/global-preset');
    expect(deps.resolvePreset).toHaveBeenCalledWith('global-preset');
    expect(deps.resolvePreset).not.toHaveBeenCalledWith('');
  });

  it('固定预设解析后被删除时拒绝回读，不沿用旧配置', () => {
    const deps = dependencies_ACU();
    const preset = resolveContinuationAgentApiPreset_ACU(settings_ACU(), 'main', 'turn_call', deps);
    deps.resolvePreset.mockReturnValue({ ...deps.resolvePreset(''), resolved: false });
    expect(() => preset.apiConfig).toThrow(ContinuationValidationError_ACU);
    try { void preset.apiMode; }
    catch (error) {
      expect((error as ContinuationValidationError_ACU).error).toMatchObject({
        code: 'CONTINUATION_API_PRESET_MISSING', phase: 'turn_call',
      });
      return;
    }
    throw new Error('Expected CONTINUATION_API_PRESET_MISSING');
  });
});

describe('effectiveAgentApiPresetMode_ACU', () => {
  it('reports the inherited global mode and role-specific overrides', () => {
    const agentApiPresets = buildDefaultContinuationAgentApiPresets_ACU();
    agentApiPresets.mainlinePlanner = { mode: 'current', presetName: '' };
    agentApiPresets.reviewer = { mode: 'fixed', presetName: 'r1' };
    const settings = settings_ACU({ agentApiPresets, apiPresetMode: 'fixed' });
    expect(effectiveAgentApiPresetMode_ACU(settings, 'main')).toBe('fixed');
    expect(effectiveAgentApiPresetMode_ACU(settings, 'mainlinePlanner')).toBe('current');
    expect(effectiveAgentApiPresetMode_ACU(settings, 'reviewer')).toBe('fixed');
    expect(effectiveAgentApiPresetMode_ACU(settings_ACU({ apiPresetMode: 'current' }), 'beatPlanner')).toBe('current');
  });
});
