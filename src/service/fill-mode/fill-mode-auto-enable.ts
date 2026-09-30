/**
 * 新对话自动启用经典表格（飞行模式）。
 * 只在聊天表格数据已加载完成后调用；已有表格数据的旧对话不改写模板，由 resolver 按旧默认方案临时运行。
 */
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { enableFlightMode_ACU, type FlightModeTransitionResult_ACU } from '../flight-mode/flight-mode-transition';
import { isLegacyCrossfireEnabled_ACU, readFillModePreferences_ACU } from './fill-mode-preferences';
import { resolveFillPlan_ACU } from './fill-mode-resolver';
import { buildFillRuntimeContext_ACU } from './fill-mode-gate';

export type FlightModeAutoEnableResult_ACU =
  | { attempted: false; reason: 'not_required' | 'legacy_crossfire_default' | 'in_flight' | 'chat_changed' }
  | { attempted: true; result: FlightModeTransitionResult_ACU };

let inFlightChatKey_ACU: string | null = null;

export async function autoEnableFlightModeForNewChatIfNeeded_ACU(): Promise<FlightModeAutoEnableResult_ACU> {
  const chatKey = String(currentChatFileIdentifier_ACU || '');
  if (inFlightChatKey_ACU !== null) return { attempted: false, reason: 'in_flight' };
  const { preferences, source } = readFillModePreferences_ACU();
  // 从未选择过填表模式且旧交火开关开启：保持升级前行为，不给新对话叠加飞行模式。
  if (source === 'default' && isLegacyCrossfireEnabled_ACU()) {
    return { attempted: false, reason: 'legacy_crossfire_default' };
  }
  const plan = resolveFillPlan_ACU(preferences, buildFillRuntimeContext_ACU());
  if (!plan.autoEnableFlightMode) return { attempted: false, reason: 'not_required' };

  inFlightChatKey_ACU = chatKey;
  try {
    if (String(currentChatFileIdentifier_ACU || '') !== chatKey) return { attempted: false, reason: 'chat_changed' };
    const result = await enableFlightMode_ACU();
    if (result.ok) {
      logDebug_ACU(`[填表模式] 新对话已自动启用经典表格（飞行模式）：chat=${chatKey}, reason=${result.reason || 'enabled'}`);
    } else {
      logWarn_ACU(`[填表模式] 新对话自动启用经典表格失败：chat=${chatKey}, reason=${result.reason || 'unknown'}${result.error ? `, error=${result.error}` : ''}`);
    }
    return { attempted: true, result };
  } finally {
    inFlightChatKey_ACU = null;
  }
}

/** 仅供测试：重置重入标记。 */
export function __resetFlightModeAutoEnableForTests_ACU(): void {
  inFlightChatKey_ACU = null;
}
