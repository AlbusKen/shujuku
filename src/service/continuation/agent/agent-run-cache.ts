/**
 * service/continuation/agent/agent-run-cache.ts — Agent 循环运行恢复缓存
 *
 * 纯内存缓存：主循环在每次迭代边界保存运行账本（派工结论、迭代进度），
 * 失败中断后用户再发送时据此从中断点恢复，而不是丢掉全部已获得的证据从头重跑。
 * 键为聊天身份；恢复时按任务与大纲游标严格校验，任何不匹配都作废缓存。
 * 页面重载会清空缓存——此时资料快照已持久化，从头重跑是安全降级而非错误。
 */

import type { AgentDelegationOutcome_ACU } from './agent-model';

/** 可序列化的运行账本快照。perAgent 用普通对象而非 Map，便于快照复制。 */
export interface AgentRunLedgerSnapshot_ACU {
  delegationsUsed: number;
  perAgent: Record<string, number>;
  outcomes: AgentDelegationOutcome_ACU[];
}

/** 发送前终审在一次主 Agent 运行内的恢复状态。终审反馈正文同时追加到会话，供跨重启读取。 */
export const AGENT_FINAL_REVIEW_STATUSES_ACU = ['not_started', 'reviewing', 'feedback_ready', 'consumed'] as const;
export type AgentFinalReviewStatus_ACU = typeof AGENT_FINAL_REVIEW_STATUSES_ACU[number];

export interface AgentFinalReviewResumeState_ACU {
  status: AgentFinalReviewStatus_ACU;
  /** 当前候选指导的稳定 FNV 标识；游标或候选变化后不得复用旧状态。 */
  candidateFingerprint: string;
  /** 用于恢复诊断的候选摘要，不保存完整模型提示词。 */
  candidateSummary: string;
  /** 已回灌主 Agent 的最终审查结论或失败诊断。 */
  feedback: string;
}

export interface AgentRunResumeState_ACU {
  taskId: string;
  /** 保存时刻的大纲游标指纹（stageId#revision#turnId）。游标变了的旧证据不允许污染新轮次。 */
  cursorKey: string;
  /** 恢复后应执行的迭代序号（从 1 开始）。 */
  nextIteration: number;
  ledger: AgentRunLedgerSnapshot_ACU;
  finalReview: AgentFinalReviewResumeState_ACU;
}

const statesByChat_ACU = new Map<string, AgentRunResumeState_ACU>();

function cloneFinalReviewState_ACU(value: Partial<AgentFinalReviewResumeState_ACU> | undefined): AgentFinalReviewResumeState_ACU {
  const status = value?.status;
  return {
    status: (AGENT_FINAL_REVIEW_STATUSES_ACU as readonly string[]).includes(status ?? '') ? status as AgentFinalReviewStatus_ACU : 'not_started',
    candidateFingerprint: typeof value?.candidateFingerprint === 'string' ? value.candidateFingerprint : '',
    candidateSummary: typeof value?.candidateSummary === 'string' ? value.candidateSummary : '',
    feedback: typeof value?.feedback === 'string' ? value.feedback : '',
  };
}

/**
 * 保存运行状态。同一聊天只保留最新一份（租约保证同聊天无并发循环）。
 * @param chatIdentity 聊天身份
 * @param state 运行状态；内部做深拷贝，调用方后续修改不影响缓存
 */
export function saveAgentRunState_ACU(chatIdentity: string, state: AgentRunResumeState_ACU): void {
  if (!chatIdentity) return;
  statesByChat_ACU.set(chatIdentity, {
    taskId: state.taskId,
    cursorKey: state.cursorKey,
    nextIteration: state.nextIteration,
    ledger: {
      delegationsUsed: state.ledger.delegationsUsed,
      perAgent: { ...state.ledger.perAgent },
      outcomes: state.ledger.outcomes.map(outcome => ({ ...outcome })),
    },
    finalReview: cloneFinalReviewState_ACU(state.finalReview),
  });
}

/**
 * 读取可恢复的运行状态。任务或游标不匹配即作废并返回 null——
 * 旧轮次的证据对新轮次而言是污染而不是资产。
 * @param chatIdentity 聊天身份
 * @param taskId 当前任务
 * @param cursorKey 当前大纲游标指纹
 * @returns 匹配的运行状态深拷贝；无缓存或不匹配时为 null
 */
export function readAgentRunState_ACU(chatIdentity: string, taskId: string, cursorKey: string): AgentRunResumeState_ACU | null {
  const cached = statesByChat_ACU.get(chatIdentity);
  if (!cached) return null;
  if (cached.taskId !== taskId || cached.cursorKey !== cursorKey) {
    statesByChat_ACU.delete(chatIdentity);
    return null;
  }
  return {
    taskId: cached.taskId,
    cursorKey: cached.cursorKey,
    nextIteration: cached.nextIteration,
    ledger: {
      delegationsUsed: cached.ledger.delegationsUsed,
      perAgent: { ...cached.ledger.perAgent },
      outcomes: cached.ledger.outcomes.map(outcome => ({ ...outcome })),
    },
    finalReview: cloneFinalReviewState_ACU(cached.finalReview),
  };
}

/**
 * 清除运行状态。finalize 成功交付与主 Agent 主动 block 时调用：
 * 前者本轮已完成，后者是明确的终局判断，重跑应给全新预算而不是复播旧证据。
 * @param chatIdentity 聊天身份
 */
export function clearAgentRunState_ACU(chatIdentity: string): void {
  statesByChat_ACU.delete(chatIdentity);
}

export function resetAgentRunCacheForTests_ACU(): void {
  statesByChat_ACU.clear();
}
