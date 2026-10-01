/**
 * chat-runtime-reload-signal — 旧 CHAT_CHANGED 链路完成派生数据重建后的显式完成信号。
 *
 * 旧链路（presentation/bootstrap/init.ts）在 CHAT_CHANGED 后延迟 1200ms，再串行执行
 * V2 回放、世界书刷新、SQLite hydrate、向量缓存预热等异步步骤；新 UI 需要在它完成后
 * 再读取运行时状态，不能按固定延迟猜测。订阅方按 chatFileName 匹配；被后续切换取代、
 * 主动放弃的旧链路不发信号。
 */
export type ChatRuntimeReloadListener_ACU = (chatFileName: string) => void;

const listeners_ACU = new Set<ChatRuntimeReloadListener_ACU>();

export function notifyChatRuntimeReloaded_ACU(chatFileName: unknown): void {
  const name = String(chatFileName ?? '');
  for (const listener of [...listeners_ACU]) {
    try {
      listener(name);
    } catch {
      // 订阅方异常不得反向破坏聊天加载链路。
    }
  }
}

export function subscribeChatRuntimeReloaded_ACU(listener: ChatRuntimeReloadListener_ACU): () => void {
  listeners_ACU.add(listener);
  return () => {
    listeners_ACU.delete(listener);
  };
}
