import { resolveApiConfigByPreset_ACU, type ApiPresetApiConfig_ACU, type ApiPresetApiMode_ACU } from '../settings/api-preset-service';
import { withLiveCurrentChannel_ACU } from '../settings/live-current-channel';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationErrorPhase_ACU, type WorldSimulationSettings_ACU } from './model';

export interface WorldSimulationResolvedApiPreset_ACU { presetName: string; source: 'current' | 'fixed'; reason: 'fixed_preset' | 'current_configuration'; apiMode: ApiPresetApiMode_ACU; apiConfig: ApiPresetApiConfig_ACU; tavernProfile: string; }
type Resolution_ACU = Omit<WorldSimulationResolvedApiPreset_ACU, 'presetName' | 'source' | 'reason'> & { resolved: boolean };
export interface WorldSimulationApiPresetDependencies_ACU { resolvePreset: (presetName: string) => Resolution_ACU; }
const defaults_ACU: WorldSimulationApiPresetDependencies_ACU = { resolvePreset: resolveApiConfigByPreset_ACU };
type Settings_ACU = Pick<WorldSimulationSettings_ACU, 'apiPresetMode' | 'fixedApiPresetName' | 'agentApiPresets'>;

function fail_ACU(phase: WorldSimulationErrorPhase_ACU, code: 'WORLD_SIMULATION_API_PRESET_MISSING' | 'WORLD_SIMULATION_CONFIG_INVALID', reason: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(code, phase, reason, false, { reason }));
}

export function resolveWorldSimulationApiPreset_ACU(settings: Pick<Settings_ACU, 'apiPresetMode' | 'fixedApiPresetName'>, phase: WorldSimulationErrorPhase_ACU, dependencies: WorldSimulationApiPresetDependencies_ACU = defaults_ACU): WorldSimulationResolvedApiPreset_ACU {
  if (settings.apiPresetMode === 'fixed') {
    const presetName = settings.fixedApiPresetName.trim();
    if (!presetName) fail_ACU(phase, 'WORLD_SIMULATION_API_PRESET_MISSING', '固定格林推演 API 预设不能为空');
    const resolved = dependencies.resolvePreset(presetName);
    if (!resolved.resolved) fail_ACU(phase, 'WORLD_SIMULATION_API_PRESET_MISSING', '格林推演 API 预设不存在或已失效');
    return { presetName, source: 'fixed', reason: 'fixed_preset', apiMode: resolved.apiMode, apiConfig: resolved.apiConfig, tavernProfile: resolved.tavernProfile };
  }
  if (settings.apiPresetMode !== 'current') fail_ACU(phase, 'WORLD_SIMULATION_CONFIG_INVALID', '格林推演 API 预设模式非法');
  const resolved = dependencies.resolvePreset('');
  // 当前配置模式下渠道必须在发请求时回读：run 级捕获 + 全局写入替换引用会让定值永久陈旧。
  return withLiveCurrentChannel_ACU(
    { presetName: '', source: 'current', reason: 'current_configuration', apiMode: resolved.apiMode, apiConfig: resolved.apiConfig, tavernProfile: resolved.tavernProfile },
    () => {
      const current = dependencies.resolvePreset('');
      return { apiMode: current.apiMode, apiConfig: current.apiConfig, tavernProfile: current.tavernProfile };
    },
  );
}

export function effectiveWorldSimulationAgentApiPresetMode_ACU(settings: Settings_ACU, role: string): 'current' | 'fixed' {
  return settings.agentApiPresets[role]?.mode ?? settings.apiPresetMode;
}

export function resolveWorldSimulationAgentApiPreset_ACU(settings: Settings_ACU, role: string, phase: WorldSimulationErrorPhase_ACU, dependencies: WorldSimulationApiPresetDependencies_ACU = defaults_ACU): WorldSimulationResolvedApiPreset_ACU {
  const choice = settings.agentApiPresets[role];
  return choice ? resolveWorldSimulationApiPreset_ACU({ apiPresetMode: choice.mode, fixedApiPresetName: choice.presetName }, phase, dependencies) : resolveWorldSimulationApiPreset_ACU(settings, phase, dependencies);
}
