/**
 * shared/chat-floor-identity.ts — 聊天楼层语义身份指纹
 *
 * 供持久化提交边界核对楼层是否被删除、错位或切换角色。
 * 规范化宿主与扩展（如 JS-Slash-Runner / TauriTavern）对新生成楼层的常见语义等价补全：
 * - `is_user` / `is_system`：`undefined` 与 `false` 等价（仅 `true` 表示启用）；
 * - `message_id`：`undefined` / `null` / `''` 与当前楼层自身下标 `index`（或 `String(index)`）等价；
 *   任何真实的角色/隐藏状态翻转、删楼错位或显式异值 `message_id` 仍会触发冲突拒绝。
 */

function normalizeFloorMessageId_ACU(messageId: unknown, index: number): unknown {
  if (messageId === undefined || messageId === null || messageId === '') return null;
  if (messageId === index || messageId === String(index)) return null;
  return messageId;
}

export function buildChatFloorIdentity_ACU(
  message: unknown,
  index: number,
  options?: { includeSwipeId?: boolean },
): string {
  if (!message || typeof message !== 'object') {
    return JSON.stringify([false]);
  }
  const record = message as Record<string, unknown>;
  const normalizedMessageId = normalizeFloorMessageId_ACU(record.message_id, index);
  const isUser = record.is_user === true;
  const isSystem = record.is_system === true;
  if (options?.includeSwipeId) {
    return JSON.stringify([true, normalizedMessageId, record.swipe_id, isUser, isSystem]);
  }
  return JSON.stringify([true, normalizedMessageId, isUser, isSystem]);
}
