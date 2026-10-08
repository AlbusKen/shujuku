import { clickRegenerateButton_ACU, setSendTextareaValue_ACU, triggerHostGenerate_ACU } from '../../shared/host-input';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { markUserSendIntent_ACU } from '../runtime/state-manager';

export type ContinuationHostRetryMode_ACU = 'regenerate' | 'generate';

/** Minimal host boundary: only final plain text may reach SillyTavern input. */
export interface ContinuationHostTurnAdapter_ACU {
  send(instruction: string): boolean;
  removeLastMessage(): Promise<boolean>;
  /** 复用酒馆自己的生成链路：regenerate 会删末 AI 楼；generate 只对已有用户楼要回复。 */
  retryGeneration(mode: ContinuationHostRetryMode_ACU): boolean;
  /** 打断酒馆正在进行的正文生成；宿主 API 不可用时静默跳过。 */
  stopGeneration(): void;
}

export class SillyTavernHostTurnAdapter_ACU implements ContinuationHostTurnAdapter_ACU {
  send(instruction: string): boolean {
    if (typeof instruction !== 'string' || !instruction.trim()) return false;
    // 每轮指导写入后直接启动宿主生成，正文完成由生成桥统一确认。
    if (!setSendTextareaValue_ACU(instruction, undefined, { restoreAfterInput: true })) return false;
    markUserSendIntent_ACU();
    return triggerHostGenerate_ACU('normal');
  }

  async removeLastMessage(): Promise<boolean> {
    try {
      if (typeof SillyTavern_API_ACU?.deleteLastMessage !== 'function') return false;
      await SillyTavern_API_ACU.deleteLastMessage();
      return true;
    } catch {
      return false;
    }
  }

  retryGeneration(mode: ContinuationHostRetryMode_ACU): boolean {
    return mode === 'regenerate' ? clickRegenerateButton_ACU() : triggerHostGenerate_ACU('normal');
  }

  stopGeneration(): void {
    if (typeof SillyTavern_API_ACU?.stopGeneration !== 'function') return;
    SillyTavern_API_ACU.stopGeneration();
  }
}
