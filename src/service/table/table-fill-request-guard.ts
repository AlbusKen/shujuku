import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { assertAiMessageSnapshotCurrent_ACU, type AiMessageSnapshot_ACU } from '../../data/gateways/chat-message-snapshot';

/** 仅请求内有效；不写入 V2 日志或持久化配置。 */
export interface TableFillRequestGuard_ACU {
  signal?: AbortSignal;
  targetSnapshot?: AiMessageSnapshot_ACU;
}

export function assertTableFillRequestCurrent_ACU(
  guard: TableFillRequestGuard_ACU, targetIndex?: number, chat?: any[],
): void {
  if (guard.signal?.aborted) throw new DOMException('填表任务已取消。', 'AbortError');
  if (guard.targetSnapshot) {
    assertAiMessageSnapshotCurrent_ACU(chat ?? getChatArray_ACU(), guard.targetSnapshot, targetIndex);
  }
}
