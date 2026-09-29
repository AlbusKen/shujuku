import { resolveApiConfigByPreset_ACU, type ApiPresetApiConfig_ACU, type ApiPresetApiMode_ACU } from '../settings/api-preset-service';
import { withLiveCurrentChannel_ACU } from '../settings/live-current-channel';
import {
  ContinuationValidationError_ACU,
  createContinuationError_ACU,
  type ContinuationAgentApiPresetRole_ACU,
  type ContinuationErrorPhase_ACU,
  type ContinuationSettings_ACU,
} from './model';

export interface ContinuationResolvedApiPreset_ACU {
  presetName: string;
  source: 'current' | 'fixed';
  reason: 'fixed_preset' | 'current_configuration';
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: ApiPresetApiConfig_ACU;
  tavernProfile: string;
}

type ApiPresetResolution_ACU = Omit<ContinuationResolvedApiPreset_ACU, 'presetName' | 'source' | 'reason'> & { resolved: boolean };
export interface ContinuationApiPresetDependencies_ACU {
  resolvePreset: (presetName: string) => ApiPresetResolution_ACU;
}

const defaultDependencies_ACU: ContinuationApiPresetDependencies_ACU = {
  resolvePreset: resolveApiConfigByPreset_ACU,
};

function failPreset_ACU(phase: ContinuationErrorPhase_ACU, reason: 'empty' | 'missing'): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU(
    'CONTINUATION_API_PRESET_MISSING',
    phase,
    reason === 'empty' ? '固定智能续写 API 预设不能为空' : '智能续写 API 预设不存在或已失效',
    false,
    { reason },
  ));
}

export function resolveContinuationApiPreset_ACU(settings: Pick<ContinuationSettings_ACU, 'apiPresetMode' | 'fixedApiPresetName'>, phase: ContinuationErrorPhase_ACU, dependencies: ContinuationApiPresetDependencies_ACU = defaultDependencies_ACU): ContinuationResolvedApiPreset_ACU {
  if (settings.apiPresetMode === 'fixed') {
    const presetName = settings.fixedApiPresetName.trim();
    if (!presetName) failPreset_ACU(phase, 'empty');
    const resolved = dependencies.resolvePreset(presetName);
    if (!resolved.resolved) failPreset_ACU(phase, 'missing');
    return { presetName, source: 'fixed', reason: 'fixed_preset', apiMode: resolved.apiMode, apiConfig: resolved.apiConfig, tavernProfile: resolved.tavernProfile };
  }
  if (settings.apiPresetMode !== 'current') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_CONFIG_MISSING', phase, '智能续写 API 预设模式非法', false));
  }
  const resolved = dependencies.resolvePreset('');
  // 当前配置模式下渠道必须在发请求时回读：run/波次级缓存 + 全局写入替换引用会让定值永久陈旧。
  return withLiveCurrentChannel_ACU(
    { presetName: '', source: 'current', reason: 'current_configuration', apiMode: resolved.apiMode, apiConfig: resolved.apiConfig, tavernProfile: resolved.tavernProfile },
    () => {
      const current = dependencies.resolvePreset('');
      return { apiMode: current.apiMode, apiConfig: current.apiConfig, tavernProfile: current.tavernProfile };
    },
  );
}

type AgentApiPresetSettings_ACU = Pick<ContinuationSettings_ACU, 'apiPresetMode' | 'fixedApiPresetName'> & Partial<Pick<ContinuationSettings_ACU, 'agentApiPresets'>>;

/**
 * 计算某个角色的生效渠道模式：inherit 回落到全局 apiPresetMode。
 * 波次并发规则不再据此判定串行：并发门禁以解析后的真实渠道为准（酒馆连接或主 API 才串行）。
 * @param settings 续写设置
 * @param role 渠道角色
 * @returns 'current' 或 'fixed'
 */
export function effectiveAgentApiPresetMode_ACU(settings: AgentApiPresetSettings_ACU, role: ContinuationAgentApiPresetRole_ACU): 'current' | 'fixed' {
  const choice = settings.agentApiPresets?.[role];
  if (!choice || choice.mode === 'inherit') return settings.apiPresetMode;
  return choice.mode;
}

/**
 * 按角色解析 AI 渠道。inherit（或缺失配置）沿用全局解析；
 * current/fixed 以角色自己的配置复用同一 fail-closed 解析逻辑。
 * @param settings 续写设置
 * @param role 渠道角色（main/outline/maintainer/mainlinePlanner/beatPlanner/reviewer）
 * @param phase 出错时记录的阶段
 * @returns 解析后的渠道；固定预设缺失时抛 CONTINUATION_API_PRESET_MISSING
 */
export function resolveContinuationAgentApiPreset_ACU(settings: AgentApiPresetSettings_ACU, role: ContinuationAgentApiPresetRole_ACU, phase: ContinuationErrorPhase_ACU, dependencies: ContinuationApiPresetDependencies_ACU = defaultDependencies_ACU): ContinuationResolvedApiPreset_ACU {
  const choice = settings.agentApiPresets?.[role];
  if (!choice || choice.mode === 'inherit') return resolveContinuationApiPreset_ACU(settings, phase, dependencies);
  return resolveContinuationApiPreset_ACU({ apiPresetMode: choice.mode, fixedApiPresetName: choice.presetName }, phase, dependencies);
}
