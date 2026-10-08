import { clickRegenerateButton_ACU, setSendTextareaValue_ACU, triggerHostGenerate_ACU } from '../../shared/host-input';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { markUserSendIntent_ACU } from '../runtime/state-manager';
import type { ContinuationGenerationDebug_ACU } from './generation-debug';

export type ContinuationHostRetryMode_ACU = 'regenerate' | 'generate';

/** Minimal host boundary: only final plain text may reach SillyTavern input. */
export interface ContinuationHostTurnAdapter_ACU {
  send(instruction: string, debug?: ContinuationGenerationDebug_ACU): boolean;
  removeLastMessage(): Promise<boolean>;
  /** 复用酒馆自己的生成链路：regenerate 会删末 AI 楼；generate 只对已有用户楼要回复。 */
  retryGeneration(mode: ContinuationHostRetryMode_ACU): boolean;
  /** 打断酒馆正在进行的正文生成；宿主 API 不可用时静默跳过。 */
  stopGeneration(): void;
}

export class SillyTavernHostTurnAdapter_ACU implements ContinuationHostTurnAdapter_ACU {
  send(instruction: string, debug?: ContinuationGenerationDebug_ACU): boolean {
    if (typeof instruction !== 'string' || !instruction.trim()) {
      debug?.finish('failed', { reason: 'empty_instruction' }, false);
      return false;
    }
    // 每轮指导写入后直接启动宿主生成，正文完成由生成桥统一确认。
    debug?.step('input_writing', { chars: instruction.length });
    if (!setSendTextareaValue_ACU(instruction, failure => {
      debug?.finish('failed', failure, false);
    }, { restoreAfterInput: true })) {
      debug?.finish('failed', { reason: 'input_unavailable' }, false);
      return false;
    }
    debug?.step('input_written', { chars: instruction.length });
    markUserSendIntent_ACU();
    return triggerHostGenerate_ACU('normal', debug ? event => {
      if (event.stage === 'unavailable') debug?.finish('host_rejected', { reason: 'host_unavailable' }, false);
      else if (event.stage === 'rejected') debug?.finish('host_rejected', { reason: event.source, errorType: event.errorType }, false);
      else debug?.step(event.stage === 'calling' ? 'host_call'
        : event.stage === 'dispatched' ? 'host_dispatched' : 'host_resolved', { reason: event.source });
    } : undefined);
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
