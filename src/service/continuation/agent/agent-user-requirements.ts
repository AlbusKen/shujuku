/**
 * service/continuation/agent/agent-user-requirements.ts — 用户要求资料区的过滤、渲染与机械写入
 *
 * 与伏笔账本等结构化模块分离：这里只处理 string[] 全量替换。压缩触发的语义合并由
 * requirements-maintainer 完成；本文件负责机械过滤、空快照回退与 fail-closed 种子写入。
 */

import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import type { AgentConversationMessage_ACU, AgentModuleSnapshot_ACU } from './agent-model';
import { readAgentModuleSnapshot_ACU, writeAgentModuleSnapshot_ACU } from './agent-module-store';

/**
 * 继续/恢复类关键词。与世界推演 `RESUME_KEYWORD_ACU` 对齐，并补上验收要求的「开始」。
 * 整段匹配才视为无实质要求，避免「继续写主角隐瞒身份」被误过滤。
 */
export const AGENT_RESUME_KEYWORD_ACU = /^(继续|开始|恢复(?:任务)?|resume|continue)$/i;

export function isMechanicalResumeUserText_ACU(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || AGENT_RESUME_KEYWORD_ACU.test(trimmed);
}

/**
 * 从压缩区间收集仍有实质内容的用户发言。
 * @param messages 压缩前的会话消息（含将被浓缩的部分）
 * @param fromIdExclusive 上一份 compaction mark 的 compactedThroughId，没有则为 0
 * @param toIdInclusive 本次压缩截止 id
 */
export function collectSubstantialUserTexts_ACU(
  messages: readonly AgentConversationMessage_ACU[],
  fromIdExclusive: number,
  toIdInclusive: number,
): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.kind !== 'user') continue;
    if (message.id <= fromIdExclusive || message.id > toIdInclusive) continue;
    const trimmed = message.text.trim();
    if (!trimmed || AGENT_RESUME_KEYWORD_ACU.test(trimmed)) continue;
    texts.push(trimmed);
  }
  return texts;
}

/**
 * 规范化用户要求清单：trim、拒绝非字符串与空串、按首次出现去重。
 * 供子代理契约解析使用——任一条非法则整份返回 null，由调用方 fail-closed。
 */
export function normalizeUserRequirementLines_ACU(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    if (!text) return null;
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
}

/**
 * 渲染注入块正文。快照为空时回退 originInstruction，保证创建任务后第一轮仍有内容。
 */
export function renderAgentUserRequirements_ACU(snapshot: AgentModuleSnapshot_ACU, originInstruction: string): string {
  const fallback = originInstruction.trim();
  const lines = snapshot.userRequirements.length ? snapshot.userRequirements : (fallback ? [fallback] : []);
  if (!lines.length) return '（用户尚未提出任务要求）';
  return lines.map(line => `- ${line}`).join('\n');
}

export function applyAgentUserRequirementsReplace_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  requirements: readonly string[],
): AgentModuleSnapshot_ACU {
  return {
    ...snapshot,
    userRequirements: [...requirements],
    revisions: { ...snapshot.revisions, userRequirements: snapshot.revisions.userRequirements + 1 },
  };
}

/**
 * 创建任务时把 originInstruction 机械写成首条。没有可承载楼层时静默跳过，由渲染回退兜底。
 * 快照里已经有条目则不覆盖。
 */
export async function seedAgentUserRequirementsIfEmpty_ACU(originInstruction: string, chat?: any[]): Promise<void> {
  const text = originInstruction.trim();
  if (!text) return;
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  if (!Array.isArray(messages) || messages.length === 0) return;
  const snapshot = readAgentModuleSnapshot_ACU(messages);
  if (snapshot.userRequirements.length) return;
  await writeAgentModuleSnapshot_ACU(messages, messages.length - 1, applyAgentUserRequirementsReplace_ACU(snapshot, [text]));
}
