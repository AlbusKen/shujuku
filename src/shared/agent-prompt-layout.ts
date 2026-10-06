/** Agent 提示词的固定插入卡与请求装配；历史卡自身不发送。 */
import { USER_PREFILL_CONTENT_ACU } from './user-prefill.js';
export const AGENT_HISTORY_TOKEN_ACU = '$HISTORY_ANCHOR';
export const AGENT_SNAPSHOT_TOKEN_ACU = '$RUNTIME_SNAPSHOT';
export const AGENT_HISTORY_SENTINEL_ACU = '\u0000__QRF_AGENT_HISTORY__\u0000';
export const AGENT_SNAPSHOT_SENTINEL_ACU = '\u0000__QRF_AGENT_SNAPSHOT__\u0000';

export function isAgentHistorySlot_ACU(segment: { content: string }): boolean {
  return segment.content.trim() === AGENT_HISTORY_TOKEN_ACU;
}

export function isAgentSnapshotSlot_ACU(segment: { content: string }): boolean {
  return segment.content.trim() === AGENT_SNAPSHOT_TOKEN_ACU;
}

export function isAgentFixedSlot_ACU(segment: { content: string }): boolean {
  return isAgentHistorySlot_ACU(segment) || isAgentSnapshotSlot_ACU(segment);
}

/** 给默认或升级后的提示词补固定插入点；不覆盖用户正文和开关。 */
export function withAgentPromptLayout_ACU<T extends { role: string; content: string; enabled?: boolean; deletable?: boolean; pinned?: boolean }>(segments: readonly T[]): T[] {
  const next = segments.filter(segment => segment.content !== USER_PREFILL_CONTENT_ACU).map(segment => ({ ...segment }));
  let historyAt = next.findIndex(isAgentHistorySlot_ACU);
  if (historyAt < 0) {
    historyAt = next.length;
    next.splice(historyAt, 0, { role: 'history', content: AGENT_HISTORY_TOKEN_ACU, enabled: true, deletable: false, pinned: true } as T);
  } else next[historyAt] = { ...next[historyAt], role: 'history', enabled: true, deletable: false, pinned: true };
  const snapshotAt = next.findIndex(isAgentSnapshotSlot_ACU);
  if (snapshotAt < 0) {
    next.splice(historyAt, 0, { role: 'system', content: AGENT_SNAPSHOT_TOKEN_ACU, enabled: true, deletable: false, pinned: true } as T);
  } else next[snapshotAt] = { ...next[snapshotAt], role: 'system', enabled: true, deletable: false, pinned: true };
  const prefill = segments.find(segment => segment.content === USER_PREFILL_CONTENT_ACU);
  next.push({ ...prefill, role: 'user', content: USER_PREFILL_CONTENT_ACU, enabled: true, deletable: false, pinned: true } as T);
  return next;
}

/** 保留模板顺序、历史身份和工具字段；没有插入卡的旧模板在尾段前兼容插入。 */
export function assembleAgentPrompt_ACU<T extends { role: string; content: string }>(template: readonly T[], history: readonly T[], snapshot: string, fallbackPrefill?: T): T[] {
  const result: T[] = [];
  let insertedHistory = false;
  let insertedSnapshot = false;
  const hasSnapshotSlot = template.some(item => item.content === AGENT_SNAPSHOT_SENTINEL_ACU || isAgentSnapshotSlot_ACU(item));
  for (const message of template) {
    if (message.content === USER_PREFILL_CONTENT_ACU) continue;
    if (message.content === AGENT_HISTORY_SENTINEL_ACU || isAgentHistorySlot_ACU(message)) {
      if (!insertedSnapshot && !hasSnapshotSlot) {
        result.push({ role: 'system', content: snapshot } as T);
        insertedSnapshot = true;
      }
      if (!insertedHistory) result.push(...history.map(item => ({ ...item })));
      insertedHistory = true;
    } else if (message.content === AGENT_SNAPSHOT_SENTINEL_ACU || isAgentSnapshotSlot_ACU(message)) {
      if (!insertedSnapshot) result.push({ ...message, role: 'system', content: snapshot });
      insertedSnapshot = true;
    } else result.push({ ...message });
  }
  if (!insertedSnapshot) result.push({ role: 'system', content: snapshot } as T);
  if (!insertedHistory) result.push(...history.map(item => ({ ...item })));
  result.push({ ...fallbackPrefill, role: 'user', content: USER_PREFILL_CONTENT_ACU } as T);
  return result;
}
