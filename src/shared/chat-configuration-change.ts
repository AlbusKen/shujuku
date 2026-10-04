/** 已提交的会话模式或预设库变更；通知失败不影响持久化结果。 */
export type ChatConfigurationChange_ACU = 'fill-mode' | 'plot-presets';
const subscribers = new Set<(source: ChatConfigurationChange_ACU) => void>();

export function notifyChatConfigurationChanged_ACU(source: ChatConfigurationChange_ACU): void {
  for (const subscriber of subscribers) {
    try { subscriber(source); } catch { /* 提交后的订阅者故障彼此隔离。 */ }
  }
}

export function subscribeChatConfigurationChanges_ACU(
  subscriber: (source: ChatConfigurationChange_ACU) => void,
): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
