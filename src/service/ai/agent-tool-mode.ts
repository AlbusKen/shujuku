/**
 * 续写与推演的工具协议模式。
 * json：请求体不带 tools，工具、决策与交付都写成文本 JSON 对象。
 * tools：请求体携带原生函数，工具、决策与交付都通过函数调用完成。
 * 每次运行开始时解析一次，整条运行固定使用同一模式。
 */
import { settings_ACU } from '../runtime/state-manager';
import { getConnectionManagerProfiles_ACU, isConnectionProfileChatCompletion_ACU, isMainApiChatCompletionAvailable_ACU } from '../../data/gateways/ai-gateway';
import { logDebug_ACU } from '../../shared/utils';
import type { ApiPresetApiConfig_ACU, ApiPresetApiMode_ACU } from '../settings/api-preset-service';

export type AgentToolMode_ACU = 'json' | 'tools';
export type AgentToolModeFeature_ACU = 'continuation' | 'worldSimulation';

export interface NativeToolChannelPreset_ACU {
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: Pick<ApiPresetApiConfig_ACU, 'useMainApi' | 'url' | 'model'>;
  tavernProfile: string;
}

/**
 * 判定通道能否携带原生工具并取回 tool_calls。
 * Text Completion 连接与 generateRaw 回退只返回正文，必须走 json 协议。
 */
export function isNativeToolChannelAvailable_ACU(preset: NativeToolChannelPreset_ACU, forceDirectApi = false): boolean {
  if (preset.apiMode === 'tavern') {
    const profile = getConnectionManagerProfiles_ACU().find(item => item.id === preset.tavernProfile);
    return !!profile && isConnectionProfileChatCompletion_ACU(profile);
  }
  if (preset.apiConfig.useMainApi) {
    if (!forceDirectApi) return isMainApiChatCompletionAvailable_ACU();
    return !!(preset.apiConfig.url && preset.apiConfig.model);
  }
  return true;
}

const FEATURE_LABELS_ACU: Record<AgentToolModeFeature_ACU, string> = {
  continuation: '智能续写',
  worldSimulation: '世界推演',
};

/** 全局开关是否打开；只读插件全局设置，不读对话级设置。 */
export function isAgentNativeToolOptIn_ACU(feature: AgentToolModeFeature_ACU): boolean {
  return feature === 'continuation'
    ? settings_ACU?.continuationNativeToolEnabled === true
    : settings_ACU?.worldSimulationNativeToolEnabled === true;
}

/** 开关打开且通道支持时才用 tools；开着但通道不支持时降级为 json。 */
export function resolveAgentToolMode_ACU(feature: AgentToolModeFeature_ACU, preset: NativeToolChannelPreset_ACU): AgentToolMode_ACU {
  if (!isAgentNativeToolOptIn_ACU(feature)) return 'json';
  if (isNativeToolChannelAvailable_ACU(preset)) return 'tools';
  logDebug_ACU(`[${FEATURE_LABELS_ACU[feature]}] 当前通道无法携带原生工具，降级使用 JSON 协议。`);
  return 'json';
}
