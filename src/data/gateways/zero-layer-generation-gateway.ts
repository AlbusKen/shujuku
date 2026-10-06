import { SillyTavern_API_ACU } from '../../shared/host-api';

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

/** 只请求装配并走宿主实际 fetch；最终原请求由零层拦截器阻断。 */
export async function invokeZeroLayerHostGeneration_ACU(quietPrompt: string, signal: AbortSignal): Promise<void> {
  requireZeroLayerHostGeneration_ACU();
  if (signal.aborted) throw new DOMException('本轮已停止。', 'AbortError');
  await SillyTavern_API_ACU!.generate('quiet', {
    quiet_prompt: quietPrompt, quietToLoud: false, signal,
  });
}
