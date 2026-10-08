import { clickRegenerateButton_ACU, clickSendButton_ACU, setSendTextareaValue_ACU, triggerHostGenerate_ACU } from '../../shared/host-input';
import { SillyTavern_API_ACU } from '../../shared/host-api';

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
    // 与剧情最终指令共用一次同步恢复；只有完整指令留在原控件中才触发宿主发送。
    if (!setSendTextareaValue_ACU(instruction, undefined, { restoreAfterInput: true })) return false;
    return clickSendButton_ACU();
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
