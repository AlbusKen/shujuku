import { SillyTavern_API_ACU } from '../../shared/host-api';

const invocations_ACU = new Set<{ quiet_prompt: string; signal: AbortSignal }>();

/** 只认可本轮实际装配的完整输入与取消信号，不接受外部布尔标记冒充。 */
export function isZeroLayerHostInvocation_ACU(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const params = value as { quiet_prompt?: unknown; signal?: unknown };
  return [...invocations_ACU].some(invocation => !invocation.signal.aborted
    && params.quiet_prompt === invocation.quiet_prompt && params.signal === invocation.signal);
}

/** 复用宿主 quiet 装配；只支持已核对的 Chat Completion 单角色入口。 */
export function requireZeroLayerHostGeneration_ACU(): void {
  const api = SillyTavern_API_ACU;
  if (!api || typeof api.generate !== 'function' || api.mainApi !== 'openai') {
    throw new Error('零层生成需要酒馆原生 Chat Completion 生成入口。');
  }
  if (api.groupId != null && api.groupId !== '') {
    throw new Error('群聊生成会转入成员调度，当前零层适配尚未验证该路径。');
  }
  const events = api.eventTypes as Record<string, string>;
  if (!events?.CHAT_COMPLETION_PROMPT_READY || !events?.CHAT_COMPLETION_SETTINGS_READY) {
    throw new Error('宿主缺少零层请求绑定所需的提示词与设置事件。');
  }
}

const WORLD_INFO_SCAN_PROMPT_KEY_ACU = 'acu_zero_layer_world_info_scan';

/** 只请求装配并走宿主实际 fetch；最终原请求由零层拦截器阻断。 */
export async function invokeZeroLayerHostGeneration_ACU(quietPrompt: string, signal: AbortSignal, worldInfoScanText = ''): Promise<void> {
  requireZeroLayerHostGeneration_ACU();
  if (signal.aborted) throw new DOMException('本轮已停止。', 'AbortError');
  const api = SillyTavern_API_ACU!;
  const options = {
    quiet_prompt: quietPrompt, quietToLoud: false, signal,
  };
  // 位置 -1 不注入提示词；scan=true 只让本次 quiet 装配的世界书扫描看到最近逻辑对话。
  const scanned = !!worldInfoScanText && typeof api.setExtensionPrompt === 'function';
  invocations_ACU.add(options);
  try {
    if (scanned) await api.setExtensionPrompt(WORLD_INFO_SCAN_PROMPT_KEY_ACU, worldInfoScanText, -1, 0, true, 0,
      () => invocations_ACU.has(options));
    await api.generate('quiet', options);
  } finally {
    invocations_ACU.delete(options);
    if (scanned) {
      try { await api.setExtensionPrompt(WORLD_INFO_SCAN_PROMPT_KEY_ACU, '', -1, 0, false); }
      catch { /* filter 已随调用结束失效，清空失败不影响后续生成。 */ }
    }
  }
}
