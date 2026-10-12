/** 请求内楼层锚点与启动正文快照；正文、对象引用不参与运行结果的定位。 */
export interface AiMessageSnapshot_ACU {
  readonly index: number;
  readonly message: any;
  readonly swipeId: number;
  readonly body: string;
}

export class TableFillTargetStaleError_ACU extends Error {
  readonly code = 'table_fill_target_stale';
  constructor() {
    super('填表目标楼层不存在或已不是 AI 楼层，已拒绝旧请求结果。请重新执行填表。');
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
  if (targetIndex !== snapshot.index || !Number.isInteger(snapshot.index) || snapshot.index < 0 || !message || message.is_user) {
    throw new TableFillTargetStaleError_ACU();
  }
}
