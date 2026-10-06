/** 仅内部的临时正文通知；不是 published 历史，不保存请求或 Agent 资料。 */
export interface ZeroLayerViewPreview_ACU {
  readonly sessionId: string;
  readonly branchId: string;
  readonly carrierId: string;
  readonly carrierSwipeId: number;
  readonly turnId: string;
  readonly attemptId: string;
  readonly revision: number;
  readonly sequence: number;
  readonly body: string | null;
}

const listeners_ACU = new Set<(preview: ZeroLayerViewPreview_ACU) => void>();

export function subscribeZeroLayerViewPreview_ACU(listener: (preview: ZeroLayerViewPreview_ACU) => void): () => void {
  listeners_ACU.add(listener);
  return () => { listeners_ACU.delete(listener); };
}

/** body 为累计正文；null 结束预览，消费者恢复最近一次 published 快照。 */
export function notifyZeroLayerViewPreview_ACU(preview: ZeroLayerViewPreview_ACU): void {
  for (const listener of [...listeners_ACU]) {
    try { listener({ ...preview }); }
    catch { /* 展示失败不能改变生成、正文保存或结算结果。 */ }
  }
}
