import { logWarn_ACU } from '../../shared/utils';

export type PassiveCompletionDispatch_ACU = (stage: string, run: () => unknown) => void;

interface CompletionReceipt_ACU {
  readonly id: number;
  readonly eventType: string;
  readonly jobs: Array<{ stage: string; run: () => unknown }>;
  status: 'received' | 'dispatched';
}

/** 接收登记仅存于插件内存；不改公共参数，不返回任务 Promise，不派发宿主事件。 */
export class PassiveCompletionReceiver_ACU {
  private sequence = 0;
  private readonly pending = new Map<number, CompletionReceipt_ACU>();

  receive(eventType: string, capture: (dispatch: PassiveCompletionDispatch_ACU) => void): void {
    const receipt: CompletionReceipt_ACU = {
      id: ++this.sequence, eventType, jobs: [], status: 'received',
    };
    this.pending.set(receipt.id, receipt);
    try {
      capture((stage, run) => { receipt.jobs.push({ stage, run }); });
    } catch {
      this.reportFailure(receipt, 'capture');
    }
    // 不在公共事件回调或其微任务中启动内部处理。
    setTimeout(() => {
      this.pending.delete(receipt.id);
      receipt.status = 'dispatched';
      for (const job of receipt.jobs) {
        void Promise.resolve().then(job.run).catch(() => {
          this.reportFailure(receipt, job.stage);
        });
      }
    }, 0);
  }

  private reportFailure(receipt: CompletionReceipt_ACU, stage: string): void {
    try {
      // 仅记录接收编号和阶段，不记录事件载荷、消息正文或异常原文。
      logWarn_ACU('[CompletionReceiver] 内部处理失败', {
        receiptId: receipt.id, eventType: receipt.eventType, stage,
      });
    } catch { /* 诊断失败也不能影响公共事件或其他内部任务。 */ }
  }
}
