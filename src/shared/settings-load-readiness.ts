/**
 * 全局设置延迟加载状态（IndexedDB 缓存 / 酒馆设置桥接尚未落定前为 pending）。
 * 用于防止填表模式对账在 globalMeta 尚未从持久后端读出前，把默认偏好误固化进新对话。
 */
let settingsDeferredLoadPending_ACU = false;
const settledSubscribers_ACU = new Set<() => void>();

export function setSettingsDeferredLoadPending_ACU(pending: boolean): void {
  settingsDeferredLoadPending_ACU = pending;
}

export function isSettingsDeferredLoadPending_ACU(): boolean {
  return settingsDeferredLoadPending_ACU;
}

export function notifySettingsDeferredLoadSettled_ACU(): void {
  settingsDeferredLoadPending_ACU = false;
  for (const subscriber of settledSubscribers_ACU) {
    try { subscriber(); } catch { /* 订阅者故障彼此隔离。 */ }
  }
}

export function subscribeSettingsDeferredLoadSettled_ACU(subscriber: () => void): () => void {
  settledSubscribers_ACU.add(subscriber);
  return () => { settledSubscribers_ACU.delete(subscriber); };
}
