/**
 * service/continuation/agent/agent-read-gate.ts — read/search 结果注入前的 Token 门禁
 *
 * 单批次 read/search 注入门禁。每个工具批次独立判定，避免一份过大的读取撑爆上下文；
 * 总次数由主循环 / 子代理运行预算控制，超过上下文阈值交给既有总结机制处理。
 *
 * 四个量：
 * - S：agentHistoryTokenBudget（会话压缩阈值，同时用于百分比折算）
 * - M：agentReadTokenBudget 解析后的**单批次** read/search 上限（固定值或 S 的百分比）
 * - F：min(agentReadFallbackTokens, M)，临近 S 时仍放行的精读兜底额度
 * - B：本批次全部材料的实测 token
 *
 * 状态机：
 * - B > M 直接整批打回；
 * - 否则 H + B > S 且 B > F 时打回，持续要求缩小到 F 以下；
 * - B <= F 时放行，由既有总结机制处理超长上下文。
 *
 * 打回报告不含正文，只含各目标实测 token 数、四量与剩余额度，尾附修正协议。
 * 门禁统一作用于三条注入路径：主 Agent 工具批次、子代理工具轮次、派工种子材料。
 */

import { AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU } from './agent-model';
import { countAgentTokens_ACU, type TokenCounter_ACU } from './agent-token-budget';

/** 一条待注入的材料（read 的一个地址的解析结果，或一次 search 的结果文本）。 */
export interface AgentGateItem_ACU {
  /** 材料标识，如读取地址 token 或「search "关键词"」。进入打回报告。 */
  label: string;
  text: string;
}

/** 保留状态对象以兼容调用侧的工具遥测；单批次门禁不再累计扣减。 */
export interface AgentReadGateState_ACU {
  grantedTokens: number;
}

export function createAgentReadGateState_ACU(): AgentReadGateState_ACU {
  return { grantedTokens: 0 };
}

export interface AgentReadGateConfig_ACU {
  /** S：会话压缩阈值（agentHistoryTokenBudget）；<=0 视为不限。 */
  historyTokenBudget: number;
  /** M 原始配置（agentReadTokenBudget）：正整数或 "20%" 百分比串。 */
  readTokenBudget: number | string;
  /** F 原始配置（agentReadFallbackTokens）。 */
  fallbackTokens: number;
}

export interface AgentReadBudgetResolution_ACU {
  /** M：有效单批次读取上限。 */
  effectiveMaxReadTokens: number;
  /** F：有效精读兜底额度 = min(配置值, M)。 */
  effectiveFallbackTokens: number;
  basis: 'fixed' | 'history-budget-percent';
}

/**
 * 解析 read/search 单批次上限。
 * 百分比按 S 折算；S 不限（<=0）时按默认历史预算折算，保证百分比配置永远可解析。
 * @param config 三项预算设置
 * @returns 有效 M / F 与解析依据
 */
export function resolveAgentReadBudget_ACU(config: AgentReadGateConfig_ACU): AgentReadBudgetResolution_ACU {
  const percentBase = config.historyTokenBudget > 0 ? config.historyTokenBudget : AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU;
  let effectiveMaxReadTokens = 0;
  let basis: AgentReadBudgetResolution_ACU['basis'] = 'history-budget-percent';
  const raw = config.readTokenBudget;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    effectiveMaxReadTokens = Math.floor(raw);
    basis = 'fixed';
  } else if (typeof raw === 'string' && raw.trim().endsWith('%')) {
    const percent = parseFloat(raw.trim());
    if (Number.isFinite(percent) && percent >= 1 && percent <= 100) {
      effectiveMaxReadTokens = Math.floor(percentBase * (percent / 100));
    }
  }
  if (!Number.isFinite(effectiveMaxReadTokens) || effectiveMaxReadTokens < 1) {
    // 损坏配置回退默认 20%，与设置校验层的默认一致。
    effectiveMaxReadTokens = Math.floor(percentBase * 0.2);
    basis = 'history-budget-percent';
  }
  const configuredFallback = Number.isFinite(config.fallbackTokens) && config.fallbackTokens >= 1 ? Math.floor(config.fallbackTokens) : 6000;
  return { effectiveMaxReadTokens, effectiveFallbackTokens: Math.min(configuredFallback, effectiveMaxReadTokens), basis };
}

export type AgentReadGateRejectReason_ACU = 'read-batch-too-large' | 'near-compaction-overflow';

export interface AgentReadGateDecision_ACU {
  allowed: boolean;
  reason?: AgentReadGateRejectReason_ACU;
  /** B：本批次全部材料实测 token。 */
  batchTokens: number;
  /** 每条材料的实测 token（与 items 一一对应），打回报告的数据来源。 */
  itemTokens: number[];
  /** 打回报告文本（allowed 时为空串）。回灌给 AI 的正是这段，不含任何材料正文。 */
  report: string;
}

function buildRejectionReport_ACU(
  reason: AgentReadGateRejectReason_ACU,
  items: readonly AgentGateItem_ACU[],
  itemTokens: readonly number[],
  batchTokens: number,
  state: AgentReadGateState_ACU,
  budget: AgentReadBudgetResolution_ACU,
  historyTokenBudget: number,
  contextTokens: number,
): string {
  const itemLines = items.map((item, index) => `- ${item.label}：实测 ${itemTokens[index]} tokens`);
  const lines: string[] = ['【读取被门禁打回：内容未注入，不要原样重试】'];
  if (reason === 'read-batch-too-large') {
    lines.push(`原因：本次 read/search 工具批次需要 ${batchTokens} tokens，超过单批次上限 ${budget.effectiveMaxReadTokens} tokens。该上限不跨批次累计；缩小本批内容后可在下一轮继续读取。`);
  } else {
    const headroom = Math.max(0, historyTokenBudget - contextTokens);
    lines.push(`原因：上下文临近总结阈值。当前上下文实测 ${contextTokens} tokens，总结阈值 ${historyTokenBudget} tokens（阈值前余量 ${headroom} tokens）；本批次 ${batchTokens} tokens 大于精读兜底额度 ${budget.effectiveFallbackTokens} tokens。请持续缩小读取范围，直到单批次不超过 ${budget.effectiveFallbackTokens} tokens；届时会放行并由总结机制处理超长上下文。`);
  }
  lines.push('本批次各目标的实测大小：', ...itemLines);
  const nextLimit = reason === 'near-compaction-overflow' ? budget.effectiveFallbackTokens : budget.effectiveMaxReadTokens;
  lines.push(`修正协议：先用 search 定位相关剧情，再用更小的目标重试——正文改用更窄的 $STORY_RANGE 区间，表格改按 $TABLE:表名:起始行-结束行 分段读，模块改按 ID 精读（如 $HOOKS_LEDGER:H001），让下一次请求落在 ${nextLimit} tokens 内。`);
  return lines.join('\n');
}

/**
 * 对一批待注入材料执行门禁判定。
 *
 * 判定是批次原子的：整批放行或整批打回，禁止同批部分注入（拆分绕过预算）。
 * 放行时调用方须把 batchTokens 记账进 state（本函数不自动记账，
 * 因为去重命中的材料由调用方决定是否计费）。
 * @param items 待注入材料
 * @param state 运行内累计状态（P）
 * @param config 预算设置
 * @param contextTokens H：本批次注入前的完整上下文实测；临近总结阈值时只放行 F 以内的精读
 * @param count token 统计函数，缺省 countAgentTokens_ACU
 * @returns 判定结果；拒绝时 report 为可直接回灌的打回报告
 */
export async function gateAgentReadBatch_ACU(
  items: readonly AgentGateItem_ACU[],
  state: AgentReadGateState_ACU,
  config: AgentReadGateConfig_ACU,
  contextTokens: number,
  count: TokenCounter_ACU = countAgentTokens_ACU,
): Promise<AgentReadGateDecision_ACU> {
  const itemTokens = await Promise.all(items.map(item => count(item.text)));
  const batchTokens = itemTokens.reduce((sum, tokens) => sum + tokens, 0);
  if (!items.length) return { allowed: true, batchTokens: 0, itemTokens: [], report: '' };

  const budget = resolveAgentReadBudget_ACU(config);
  const decide = (reason: AgentReadGateRejectReason_ACU): AgentReadGateDecision_ACU => ({
    allowed: false,
    reason,
    batchTokens,
    itemTokens,
    report: buildRejectionReport_ACU(reason, items, itemTokens, batchTokens, state, budget, config.historyTokenBudget, contextTokens),
  });

  // 每个工具批次独立判定：不存在跨批次累计额度。
  if (batchTokens > budget.effectiveMaxReadTokens) return decide('read-batch-too-large');
  if (config.historyTokenBudget > 0 && contextTokens > 0 && contextTokens + batchTokens > config.historyTokenBudget
    && batchTokens > budget.effectiveFallbackTokens) {
    return decide('near-compaction-overflow');
  }
  void state;
  return { allowed: true, batchTokens, itemTokens, report: '' };
}
