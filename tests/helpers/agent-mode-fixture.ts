import type { AiChatTurn_ACU } from '../../src/service/ai/native-tool';

/** 将业务夹具的合法文本对象编码为原生回包；非法文本和原生反例原样保留。 */
export function nativeAgentReply_ACU(reply: string | AiChatTurn_ACU | null): string | AiChatTurn_ACU | null {
  if (typeof reply !== 'string') return reply;
  try {
    const payload = JSON.parse(reply);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply;
    const { action, ...parameters } = payload;
    const name = typeof action === 'string' ? action : 'submit';
    return { content: '', toolCalls: [{ id: `fixture-${name}`, name, arguments: JSON.stringify(action ? parameters : payload) }] };
  } catch {
    return reply;
  }
}
