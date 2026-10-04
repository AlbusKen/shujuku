import { isMainApiChatCompletionAvailable_ACU } from '../../data/gateways/ai-gateway';

export type PlotApiTransport_ACU = 'custom' | 'main-chat-completion' | 'generate-raw';

/** 剧情预判与实际发送共用的传输选择；直发不登记宿主结束事件。 */
export function resolvePlotApiTransport_ACU(
  apiMode: unknown,
  apiConfig: { useMainApi?: unknown },
): PlotApiTransport_ACU {
  if (apiMode !== 'tavern' && !apiConfig.useMainApi) return 'custom';
  return isMainApiChatCompletionAvailable_ACU() ? 'main-chat-completion' : 'generate-raw';
}
