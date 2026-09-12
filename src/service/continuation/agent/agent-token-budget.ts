/**
 * service/continuation/agent/agent-token-budget.ts — Agent 会话的 token 预算与压缩
 *
 * 会话跨轮累积必然增长，因此需要一个可判定的上界。超出预算时按「整轮丢弃 + 交接报告」压缩：
 * 被丢弃的轮次不是凭空消失，而是浓缩成一条交接报告放在历史开头，让主 Agent 始终知道走到哪了。
 *
 * 压缩时机固定在轮次边界（见 resolveAgentCompactionTiming_ACU）：一轮规划进行中到达阈值只登记，
 * 等这一轮结束、下一轮开始时才真正压。否则模型会在同一轮内看到自己的历史突然换了形状。
 *
 * 交接报告在本地拼装而不是再发一次 AI 调用：需要保留的信息（每轮的用户指令、各次迭代的动作
 * 标签、交付摘要）在消息追加时已经作为 digest 结构化落库，本地拼装是无损的；再走一次 AI 反而
 * 是有损压缩，还会新增一条失败路径与额外延迟。
 */

import { createAgentKernelTokenCounter_ACU } from '../../agent-kernel/token-budget';
import { countTextTokens_ACU } from '../../ai/token-counter';
import {
  AGENT_HISTORY_EMERGENCY_FACTOR_ACU,
  type AgentConversationCompactionMark_ACU,
  type AgentConversationMessage_ACU,
  type AgentConversationSnapshot_ACU,
} from './agent-model';

/** 交接报告里单条用户指令的摘录上限，避免报告本身变成新的膨胀源。 */
const HANDOFF_QUOTE_LIMIT_ACU = 160;

export interface AgentConversationCompaction_ACU {
  /** 压缩后的会话视图（已应用标记投影），供本次运行继续使用。 */
  snapshot: AgentConversationSnapshot_ACU;
  /**
   * 非破坏压缩标记。调用方把它写进末楼（writeAgentConversationCompactionMark_ACU）；
   * changed 为 false 时为 null。原始消息不删除，删掉承载楼层即自动撤销压缩。
   */
  mark: AgentConversationCompactionMark_ACU | null;
  /** 是否真的压缩了。false 表示未超预算或无可丢弃内容，调用方据此跳过落盘。 */
  changed: boolean;
  droppedMessages: number;
  droppedTurns: number;
  /** 压缩后的总 token 数。 */
  totalTokens: number;
  /** 压缩后是否已落在预算内。单轮内容本身超预算时为 false，此时如实标注而不是继续砍。 */
  withinBudget: boolean;
}

/**
 * 统计一段文本的 token 数。
 * @param text 待统计文本
 * @returns token 数；宿主分词器不可用或抛错时按字符数估算，绝不把异常抛给调用方
 */
export async function countAgentTokens_ACU(text: string): Promise<number> {
  return countTextTokens_ACU(text);
}

export type TokenCounter_ACU = (text: string) => Promise<number>;

/**
 * 包一层按文本记忆的计数器。
 *
 * 一次运行内会先判定时机、再执行压缩，两处都要量同一批消息；宿主分词是逐条异步调用，
 * 不记忆就等于把分词开销翻倍。
 * @param count 底层计数函数，缺省用 countAgentTokens_ACU
 * @returns 记忆化计数器；同一段文本只向宿主问一次
 */
export function createAgentTokenCounter_ACU(count: TokenCounter_ACU = countAgentTokens_ACU): TokenCounter_ACU {
  return createAgentKernelTokenCounter_ACU(count);
}

async function measureMessages_ACU(messages: readonly AgentConversationMessage_ACU[], count: TokenCounter_ACU): Promise<number[]> {
  const sizes: number[] = [];
  for (const message of messages) sizes.push(await count(message.text));
  return sizes;
}

/**
 * 统计整份会话的 token 数。
 * @param snapshot 会话快照
 * @param count token 统计函数，缺省用 countAgentTokens_ACU
 * @returns 全部消息的 token 之和
 */
export async function measureAgentConversationTokens_ACU(
  snapshot: AgentConversationSnapshot_ACU,
  count: TokenCounter_ACU = countAgentTokens_ACU,
): Promise<number> {
  const sizes = await measureMessages_ACU(snapshot.messages, count);
  return sizes.reduce((sum, size) => sum + size, 0);
}

/**
 * 统计一组已渲染的提示词消息的 token 总数。用于测量主 Agent 除会话历史之外
 * 实际读取的上下文开销（提示词骨架、正文摘取、资料目录等）。
 * @param messages 已渲染的消息序列
 * @param count token 统计函数，缺省用 countAgentTokens_ACU
 * @returns 全部消息内容的 token 之和
 */
export async function measureAgentPromptTokens_ACU(
  messages: ReadonlyArray<{ role: string; content: string }>,
  count: TokenCounter_ACU = countAgentTokens_ACU,
): Promise<number> {
  let total = 0;
  for (const message of messages) total += await count(message.content);
  return total;
}

export interface AgentCompactionTiming_ACU {
  /** compact 立即压缩；defer 已超预算但要等轮次边界；skip 未超预算或不限预算。 */
  action: 'compact' | 'defer' | 'skip';
  totalTokens: number;
  /** 是否是轮次进行中的越界压缩（超出预算达 AGENT_HISTORY_EMERGENCY_FACTOR_ACU 倍）。 */
  emergency: boolean;
}

/**
 * 判定压缩时机。
 *
 * 压缩会重塑模型看到的历史形状，落在一轮规划进行中就等于中途换掉它的上下文。因此到达阈值
 * 只是「登记」，真正执行要等这一轮结束、下一轮开始——也就是游标变化的那一刻。
 * @param snapshot 会话快照
 * @param budgetTokens 预算上限；<= 0 视为不限
 * @param continuingSameTurn 本次运行是否仍在会话里最后通告的那一轮内（中断恢复即为 true）
 * @param count token 统计函数，缺省用 countAgentTokens_ACU
 * @param overheadTokens 会话之外的上下文开销（提示词骨架、正文摘取等），与会话一起计入总量
 * @returns 时机判定结果；totalTokens 为「会话 + 开销」的完整上下文总量
 */
export async function resolveAgentCompactionTiming_ACU(
  snapshot: AgentConversationSnapshot_ACU,
  budgetTokens: number,
  continuingSameTurn: boolean,
  count: TokenCounter_ACU = countAgentTokens_ACU,
  overheadTokens = 0,
): Promise<AgentCompactionTiming_ACU> {
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) return { action: 'skip', totalTokens: 0, emergency: false };
  // 会话为空时无可压缩：即使开销本身超阈值，压缩也改变不了任何东西。
  if (!snapshot.messages.length) return { action: 'skip', totalTokens: overheadTokens, emergency: false };
  const totalTokens = overheadTokens + await measureAgentConversationTokens_ACU(snapshot, count);
  if (totalTokens <= budgetTokens) return { action: 'skip', totalTokens, emergency: false };
  if (!continuingSameTurn) return { action: 'compact', totalTokens, emergency: false };
  const emergency = totalTokens > budgetTokens * AGENT_HISTORY_EMERGENCY_FACTOR_ACU;
  return { action: emergency ? 'compact' : 'defer', totalTokens, emergency };
}

/** 按 turnKey 的连续段分组。连续段而非全局分组，保证时间顺序不被打乱。 */
function groupByTurn_ACU(messages: readonly AgentConversationMessage_ACU[]): AgentConversationMessage_ACU[][] {
  const groups: AgentConversationMessage_ACU[][] = [];
  for (const message of messages) {
    const tail = groups[groups.length - 1];
    if (tail && tail[0].turnKey === message.turnKey) tail.push(message);
    else groups.push([message]);
  }
  return groups;
}

function quote_ACU(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= HANDOFF_QUOTE_LIMIT_ACU ? flat : `${flat.slice(0, HANDOFF_QUOTE_LIMIT_ACU)}…`;
}

/**
 * 把被丢弃的会话消息浓缩成一份交接报告。
 * @param messages 被丢弃的消息，按时间顺序
 * @returns 交接报告正文；无可报告内容时返回空串
 */
export function buildAgentHandoffReport_ACU(messages: readonly AgentConversationMessage_ACU[]): string {
  if (!messages.length) return '';
  // 之前压缩产生的交接报告原样保留在最前，避免多轮压缩后早期信息彻底丢失。
  const inherited = messages.filter(message => message.kind === 'handoff').map(message => message.text.trim()).filter(Boolean);
  const sections: string[] = [];
  for (const group of groupByTurn_ACU(messages.filter(message => message.kind !== 'handoff'))) {
    const lines: string[] = [];
    const instructions = group.filter(message => message.kind === 'user').map(message => quote_ACU(message.text));
    const announcements = group.filter(message => message.kind === 'turn').map(message => quote_ACU(message.digest || message.text));
    const actions = group.filter(message => message.kind === 'agent').map(message => message.digest || '（未标注动作）');
    const results = group.filter(message => message.kind === 'tool').map(message => message.digest).filter(Boolean);
    const snapshots = group.filter(message => message.kind === 'runtime').map(message => message.digest).filter(Boolean);
    if (announcements.length) lines.push(`  轮次：${announcements.join('；')}`);
    if (instructions.length) lines.push(`  用户要求：${instructions.join('；')}`);
    if (actions.length) lines.push(`  我的动作：${actions.join(' → ')}`);
    if (results.length) lines.push(`  运行时结果：${results.join('；')}`);
    if (snapshots.length) lines.push(`  运行时快照：${snapshots.join('；')}`);
    if (!lines.length) continue;
    sections.push(`- ${group[0].turnKey || '未编号轮次'}\n${lines.join('\n')}`);
  }
  if (!sections.length && !inherited.length) return '';
  const head = '以下是更早会话的浓缩记录（原始消息已因 token 预算被移出上下文）。这些是已经发生的过程，不要重复执行：';
  // 曾调阅过的资料地址单独列出：内容已移出上下文，但地址可直接用 read 重新调阅。
  const readKeys = [...new Set(messages.filter(message => message.kind === 'tool' && message.readKey).map(message => message.readKey!))];
  const readsLine = readKeys.length ? `\n曾调阅过的资料地址（内容已移出上下文，需要时用 read 重新调阅）：${readKeys.join('、')}` : '';
  return [...inherited, `${head}\n${sections.join('\n')}${readsLine}`].join('\n\n');
}

/**
 * 按 token 预算压缩会话。
 *
 * 压缩是非破坏的：不重建消息序列，只产出一个 compaction 标记（截止消息 id + 交接报告）。
 * 调用方把标记写进末楼，拼接层负责投影；本函数同时返回投影后的会话视图供本次运行继续使用。
 * @param snapshot 当前会话视图
 * @param budgetTokens 预算上限；<= 0 视为不限
 * @param count token 统计函数，缺省用 countAgentTokens_ACU
 * @param overheadTokens 会话之外的上下文开销；压缩目标是让「会话 + 开销」整体回到预算内
 * @returns 压缩结果；changed 为 false 时 snapshot 与入参同一引用、mark 为 null
 */
export async function compactAgentConversation_ACU(
  snapshot: AgentConversationSnapshot_ACU,
  budgetTokens: number,
  count: TokenCounter_ACU = countAgentTokens_ACU,
  overheadTokens = 0,
): Promise<AgentConversationCompaction_ACU> {
  const unchanged = (totalTokens: number, withinBudget: boolean): AgentConversationCompaction_ACU =>
    ({ snapshot, mark: null, changed: false, droppedMessages: 0, droppedTurns: 0, totalTokens, withinBudget });

  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) return unchanged(0, true);
  if (!snapshot.messages.length) return unchanged(overheadTokens, overheadTokens <= budgetTokens);

  const sizes = await measureMessages_ACU(snapshot.messages, count);
  const total = overheadTokens + sizes.reduce((sum, size) => sum + size, 0);
  if (total <= budgetTokens) return unchanged(total, true);

  const groups = groupByTurn_ACU(snapshot.messages);
  const groupSizes = (() => {
    let cursor = 0;
    return groups.map(group => {
      const size = group.reduce((sum, _message, offset) => sum + sizes[cursor + offset], 0);
      cursor += group.length;
      return size;
    });
  })();

  let firstKept = 0;
  let remaining = total;
  // 最近一轮永远完整保留：宁可超预算也不能让主 Agent 丢失当前轮的上下文。
  while (firstKept < groups.length - 1 && remaining > budgetTokens) {
    remaining -= groupSizes[firstKept];
    firstKept += 1;
  }
  if (firstKept === 0) return unchanged(total, false);

  const dropped = groups.slice(0, firstKept).flat();
  const kept = groups.slice(firstKept).flat();
  const report = buildAgentHandoffReport_ACU(dropped);
  // 截止 id 取被丢弃消息的最大 id。消息 id 按追加顺序单调递增（合成交接消息的 id 恒小于
  // 其后消息），因此「丢弃视图前缀」等价于「丢弃 id ≤ 截止值」。
  const compactedThroughId = dropped.reduce((max, message) => Math.max(max, message.id), 0);
  if (!report || compactedThroughId <= 0) return unchanged(total, false);
  const mark: AgentConversationCompactionMark_ACU = { compactedThroughId, report, at: Date.now() };
  const handoffMessage: AgentConversationMessage_ACU = {
    id: compactedThroughId,
    kind: 'handoff',
    text: report,
    digest: `交接报告（浓缩 ${firstKept} 个轮次）`,
    turnKey: '',
    at: mark.at,
  };
  const next: AgentConversationSnapshot_ACU = { ...snapshot, messages: [handoffMessage, ...kept] };
  const reportTokens = await count(report);

  return {
    snapshot: next,
    mark,
    changed: true,
    droppedMessages: dropped.length,
    droppedTurns: firstKept,
    totalTokens: remaining + reportTokens,
    withinBudget: remaining + reportTokens <= budgetTokens,
  };
}
