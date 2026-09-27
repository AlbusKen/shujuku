/**
 * service/continuation/agent/agent-final-request-gate.ts — 续写最终请求容量门禁
 *
 * 方案契约（fixed-workflow-material-injection-optimization §2.3）：
 * - 「本次请求已经占用的上下文」以最终装配边界计量：消息、原生工具定义全部计入；
 * - 默认读取上围栏预算 =（本地输入限制 - 已占用）× 60%，向下取整；
 * - 本地输入限制非法或耗尽时，在发送前 fail-closed；max_tokens 仅控制输出；
 * - 返回的 defaultReadFenceTokens 只是地址适配器的解析输入，不是正文截断阈值。
 *
 * 计量与 60% 原语复用推演侧 final-request-token-gate，避免两套公式漂移。
 */

import { measurePreparedReadRequestTokens_ACU, resolveDefaultReadFenceTokens_ACU } from '../../simulation/agent/final-request-token-gate';
import type { TokenCounter_ACU } from './agent-token-budget';

export interface ContinuationFinalRequestCapacity_ACU {
  /** 最终 prepared 请求边界（消息 + 工具定义）的实测 token。 */
  occupiedTokens: number;
  /** 60% 默认上围栏预算；仅作地址适配器解析默认读取范围的输入。 */
  defaultReadFenceTokens: number;
}

/** 在 provider 调用前计量最终请求并解析默认上围栏预算；非法或耗尽时抛错，不发起调用。 */
export async function measureContinuationFinalRequestCapacity_ACU(input: {
  messages: readonly { role: string; content: string }[];
  tools?: readonly unknown[];
  inputLimitTokens: number;
  count: TokenCounter_ACU;
}): Promise<ContinuationFinalRequestCapacity_ACU> {
  if (!Number.isSafeInteger(input.inputLimitTokens) || input.inputLimitTokens <= 0) throw new Error('READ_FENCE_CAPACITY_INVALID');
  const occupiedTokens = await measurePreparedReadRequestTokens_ACU(input.messages, input.tools ?? [], input.count);
  if (occupiedTokens >= input.inputLimitTokens) throw new Error('READ_FENCE_CAPACITY_EXHAUSTED');
  return { occupiedTokens, defaultReadFenceTokens: resolveDefaultReadFenceTokens_ACU(input.inputLimitTokens, occupiedTokens) };
}
