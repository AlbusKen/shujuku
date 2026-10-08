/** 请求内只读身份快照；不生成持久化字段，也不把隔离区标识当作消息身份。 */
export interface AiMessageSnapshot_ACU {
  readonly index: number;
  readonly message: any;
  readonly swipeId: number;
  readonly body: string;
}

export class TableFillTargetStaleError_ACU extends Error {
  readonly code = 'table_fill_target_stale';
  constructor() {
    super('填表目标消息或内容版本已变化，已拒绝旧请求结果。请重新执行填表。');
    this.name = 'TableFillTargetStaleError';
  }
}

function body_ACU(message: any): string {
  return String(message?.mes ?? message?.message ?? '');
}

function swipeId_ACU(message: any): number {
  return typeof message?.swipe_id === 'number' ? message.swipe_id : 0;
}

export function captureAiMessageSnapshot_ACU(chat: any[], targetIndex: number): AiMessageSnapshot_ACU {
  let index = targetIndex;
  if (index < 0) {
    index = chat.length - 1;
    while (index >= 0 && (!chat[index] || chat[index].is_user)) index--;
  }
  const message = chat[index];
  if (!Number.isInteger(index) || !message || message.is_user) throw new TableFillTargetStaleError_ACU();
  return Object.freeze({ index, message, swipeId: swipeId_ACU(message), body: body_ACU(message) });
}

export function assertAiMessageSnapshotCurrent_ACU(
  chat: any[], snapshot: AiMessageSnapshot_ACU, targetIndex = snapshot.index,
): void {
  const message = chat[snapshot.index];
  if (targetIndex !== snapshot.index || message !== snapshot.message || message?.is_user
    || swipeId_ACU(message) !== snapshot.swipeId || body_ACU(message) !== snapshot.body) {
    throw new TableFillTargetStaleError_ACU();
  }
}
