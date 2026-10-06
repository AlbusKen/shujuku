import { topLevelWindow_ACU } from '../../shared/env';
import { injectTavernBridgeIntoTopWindow_ACU, sleep_ACU, TAVERN_BRIDGE_GLOBAL_KEY_ACU } from '../storage/tavern-storage';

/** 宿主 script.js 的 isGenerating() 同时覆盖单聊和群聊；每次读取实时调用。 */
export function readHostGenerationState_ACU(): 'idle' | 'busy' | 'unknown' {
  try {
    const bridge = (topLevelWindow_ACU as any)?.[TAVERN_BRIDGE_GLOBAL_KEY_ACU];
    if (typeof bridge?.isGenerating !== 'function') return 'unknown';
    const busy: unknown = bridge.isGenerating();
    return busy === true ? 'busy' : busy === false ? 'idle' : 'unknown';
  } catch { return 'unknown'; }
}

/** 仅显式启用/桥接恢复时加载；不启动生成，也不修改宿主生成状态。 */
export async function ensureHostGenerationState_ACU(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (readHostGenerationState_ACU() !== 'unknown') return;
  if (!await injectTavernBridgeIntoTopWindow_ACU()) return;
  // 沿用现有设置桥接的加载等待边界；超时仍保留 unknown，由业务拒绝启用。
  for (let index = 0; index < 40; index += 1) {
    signal.throwIfAborted();
    if (readHostGenerationState_ACU() !== 'unknown') return;
    await sleep_ACU(50);
  }
  signal.throwIfAborted();
}
