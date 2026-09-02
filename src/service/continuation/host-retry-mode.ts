import { countAiMessages_ACU, isAiMessage_ACU } from '../runtime/message-handler';
import type { ContinuationHostGenerationCapture_ACU } from './model';

export type ContinuationHostRetryMode_ACU = 'regenerate' | 'generate';

/**
 * 依据发送时捕获的快照判断「让酒馆重试当前轮」是否仍然安全，以及该用哪条原语。
 *
 * 捕获快照里的 AI 楼数是本轮正文产生之前的基数（regenerate 重试时已预减掉将被删的那楼），
 * 因此只看 AI 楼数与末楼类型就能判定楼层是否还是发送时的形状：
 * - AI 楼数比基数多一：本轮正文已存在于末楼，走 regenerate（酒馆会删掉它再生成）；
 * - AI 楼数等于基数且末楼是用户楼：正文还没产出（生成报错/被中止后已被删），对承载指令的用户楼 generate；
 * - 其余形状（用户手动删掉了指令楼、连带删了更早的正文……）：重试原语找不到正确的落点，
 *   regenerate 会误删上一轮正文，必须放弃重试、回到 Agent 重新规划。
 * @param chat 当前聊天数组
 * @param capture 等待轮记录的捕获快照
 * @returns 可安全执行的重试模式；楼层已不匹配时为 null
 */
export function resolveHostRetryMode_ACU(chat: readonly unknown[], capture: ContinuationHostGenerationCapture_ACU): ContinuationHostRetryMode_ACU | null {
  if (!Array.isArray(chat) || !chat.length) return null;
  const aiCount = countAiMessages_ACU(chat as unknown[]);
  const last = chat[chat.length - 1];
  if (aiCount === capture.capturedAiFloorCount + 1 && isAiMessage_ACU(last)) return 'regenerate';
  if (aiCount === capture.capturedAiFloorCount && !isAiMessage_ACU(last)) return 'generate';
  return null;
}
