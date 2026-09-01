/**
 * service/continuation/agent/agent-prompt-drift.ts — 出站提示词前缀漂移诊断
 *
 * 用途：主 Agent 相邻两次请求理论上共享「静态骨架 + append-only 历史」的字节级前缀，
 * 服务商缓存却持续 0 命中时，需要确定分歧发生在第几条消息、什么内容。
 * 本模块在插件能观测的最后一层（骨架 + 历史拼接完成后的最终 messages）对比
 * 相邻两次序列，报出 system 条数、前缀共享量与首个分歧点的摘录。
 *
 * 判读标准：健康状态的分歧点应落在尾部的运行时数据段（每迭代必变）；
 * 分歧点出现在头部（前几条消息）即为缓存断点的直接证据。
 */

export interface AgentPromptMessage_ACU {
  role: string;
  content: string;
}

export interface AgentPromptDriftReport_ACU {
  /** 首次调用（无上次序列可比）时为 true。 */
  baseline: boolean;
  messageCount: number;
  systemRoleCount: number;
  /** 与上次序列完全一致（协议重试场景）。 */
  identical?: boolean;
  /** 从头起完全相同的消息条数。 */
  sharedMessages?: number;
  /** 完全相同消息的内容字符总量 + 分歧消息内的相同前缀字符数。 */
  sharedChars?: number;
  /** 首个分歧消息的序号（0 起）；纯尾部追加时为 undefined。 */
  divergedMessageIndex?: number;
  /** 分歧消息内首个不同字符的偏移；role 不同或一侧序列已结束时为 undefined。 */
  divergedCharOffset?: number;
  previousRole?: string;
  currentRole?: string;
  previousExcerpt?: string;
  currentExcerpt?: string;
  /** 上次序列耗尽、本次只是尾部追加的消息条数。 */
  appendedMessages?: number;
}

const DRIFT_EXCERPT_RADIUS_ACU = 60;

function excerptAround_ACU(content: string, offset: number): string {
  const start = Math.max(0, offset - DRIFT_EXCERPT_RADIUS_ACU);
  const end = Math.min(content.length, offset + DRIFT_EXCERPT_RADIUS_ACU);
  const head = start > 0 ? '…' : '';
  const tail = end < content.length ? '…' : '';
  return `${head}${content.slice(start, end)}${tail}`;
}

/**
 * 对比相邻两次出站消息序列，定位首个分歧点。
 * @param previous 上一次发送的消息序列；首次调用传 null
 * @param current 本次即将发送的消息序列
 * @returns 结构化漂移报告
 */
export function compareAgentPromptMessages_ACU(
  previous: ReadonlyArray<AgentPromptMessage_ACU> | null,
  current: ReadonlyArray<AgentPromptMessage_ACU>,
): AgentPromptDriftReport_ACU {
  const systemRoleCount = current.filter(message => message.role === 'system').length;
  if (!previous) {
    return { baseline: true, messageCount: current.length, systemRoleCount };
  }

  let sharedMessages = 0;
  let sharedChars = 0;
  const sharedLimit = Math.min(previous.length, current.length);
  while (
    sharedMessages < sharedLimit
    && previous[sharedMessages].role === current[sharedMessages].role
    && previous[sharedMessages].content === current[sharedMessages].content
  ) {
    sharedChars += current[sharedMessages].content.length;
    sharedMessages += 1;
  }

  const base: AgentPromptDriftReport_ACU = {
    baseline: false,
    messageCount: current.length,
    systemRoleCount,
    sharedMessages,
    sharedChars,
  };

  if (sharedMessages === previous.length && sharedMessages === current.length) {
    return { ...base, identical: true };
  }
  if (sharedMessages === previous.length) {
    return { ...base, appendedMessages: current.length - sharedMessages };
  }
  if (sharedMessages === current.length) {
    // 本次序列比上次短且是上次的前缀：按分歧点=本次末尾之后处理。
    return { ...base, divergedMessageIndex: sharedMessages, previousRole: previous[sharedMessages].role };
  }

  const previousMessage = previous[sharedMessages];
  const currentMessage = current[sharedMessages];
  const report: AgentPromptDriftReport_ACU = {
    ...base,
    divergedMessageIndex: sharedMessages,
    previousRole: previousMessage.role,
    currentRole: currentMessage.role,
  };
  if (previousMessage.role !== currentMessage.role) {
    report.previousExcerpt = excerptAround_ACU(previousMessage.content, 0);
    report.currentExcerpt = excerptAround_ACU(currentMessage.content, 0);
    return report;
  }

  let offset = 0;
  const charLimit = Math.min(previousMessage.content.length, currentMessage.content.length);
  while (offset < charLimit && previousMessage.content[offset] === currentMessage.content[offset]) {
    offset += 1;
  }
  report.divergedCharOffset = offset;
  report.sharedChars = (report.sharedChars ?? 0) + offset;
  report.previousExcerpt = excerptAround_ACU(previousMessage.content, offset);
  report.currentExcerpt = excerptAround_ACU(currentMessage.content, offset);
  return report;
}

/**
 * 把漂移报告渲染成单行人读文本（用于 console 输出）。
 * @param report 漂移报告
 * @returns 可直接打印的诊断行
 */
export function formatAgentPromptDriftReport_ACU(report: AgentPromptDriftReport_ACU): string {
  const head = `消息 ${report.messageCount} 条，system ${report.systemRoleCount} 条`;
  if (report.baseline) return `基线建立：${head}`;
  if (report.identical) return `与上次完全一致（重试）：${head}`;
  if (report.appendedMessages !== undefined) {
    return `前缀完整保留：${head}；共享 ${report.sharedMessages} 条 / ${report.sharedChars} 字符，尾部新增 ${report.appendedMessages} 条`;
  }
  const location = `首个分歧在第 ${report.divergedMessageIndex} 条`
    + (report.divergedCharOffset !== undefined ? `第 ${report.divergedCharOffset} 字符` : `（role: ${report.previousRole ?? '无'} → ${report.currentRole ?? '无'}）`);
  const excerpts = report.previousExcerpt !== undefined || report.currentExcerpt !== undefined
    ? `；上次「${report.previousExcerpt ?? ''}」本次「${report.currentExcerpt ?? ''}」`
    : '';
  return `前缀分歧：${head}；共享 ${report.sharedMessages} 条 / ${report.sharedChars} 字符；${location}${excerpts}`;
}

const lastPromptByScope_ACU = new Map<string, AgentPromptMessage_ACU[]>();

/**
 * 记录并对比某调用方 scope 的出站消息序列。
 * @param scope 调用方标识（如 'agent-main'）
 * @param messages 本次即将发送的最终消息序列
 * @returns 单行诊断文本
 */
export function trackAgentPromptDrift_ACU(scope: string, messages: ReadonlyArray<AgentPromptMessage_ACU>): string {
  const previous = lastPromptByScope_ACU.get(scope) ?? null;
  const report = compareAgentPromptMessages_ACU(previous, messages);
  lastPromptByScope_ACU.set(scope, messages.map(message => ({ role: message.role, content: message.content })));
  return formatAgentPromptDriftReport_ACU(report);
}

/** 清空指定 scope（缺省全部）的记忆序列。测试隔离用。 */
export function resetAgentPromptDrift_ACU(scope?: string): void {
  if (scope === undefined) {
    lastPromptByScope_ACU.clear();
    return;
  }
  lastPromptByScope_ACU.delete(scope);
}
