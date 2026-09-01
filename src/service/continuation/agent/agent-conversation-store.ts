/**
 * service/continuation/agent/agent-conversation-store.ts — 主 Agent 自身会话记录的楼层分段存储
 *
 * 主 Agent 像标准 coding agent 一样看得到自己的对话：用户的输入、它历次迭代的原始输出、
 * 运行时回灌的工具结果，按真实 role 顺序累积成消息序列。小说正文不在这里。
 *
 * 存储策略（v2）：会话按楼层分段增量存储——每条消息写进它产生时的末楼段（segment），
 * 读取时按楼层顺序把各段拼接成完整会话。删楼、Swipe、编辑替换会让该楼层的段消失，
 * 会话自动回退到更早的状态，与正文回退天然同步。
 *
 * 压缩是非破坏的：token 预算触发压缩时不删除任何消息，只在末楼记录一个
 * compaction 标记（compactedThroughId + 交接报告）。拼接时取标记里最大的
 * compactedThroughId，把 id 不大于它的消息投影掉、报告合成为最前的交接消息。
 * 删掉承载标记的楼层即自动撤销压缩，原始消息原样回来。
 *
 * 兼容：v1 的末楼全量快照在读取时充当「基线段」——遇到 v1 快照就把之前收集的段
 * 全部替换为它的消息，再继续拼接其后楼层的 v2 段。
 */

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_CONVERSATION_FIELD_ACU,
  AGENT_CONVERSATION_MESSAGE_KINDS_ACU,
  AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
  AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU,
  type AgentConversationAppend_ACU,
  type AgentConversationCompactionMark_ACU,
  type AgentConversationFloorRecord_ACU,
  type AgentConversationMessage_ACU,
  type AgentConversationMessageKind_ACU,
  type AgentConversationSnapshot_ACU,
} from './agent-model';

/** 单条会话消息的字符上限。模型原始输出与工具结果都可能很长，超出即截断并如实标注。 */
export const AGENT_CONVERSATION_TEXT_LIMIT_ACU = 8000;

/** 各非 assistant 种类在发送给模型时的标题前缀，让模型能区分「谁在说话」。 */
const KIND_PREFIXES_ACU: Record<AgentConversationMessageKind_ACU, string> = {
  user: '【用户】',
  agent: '',
  tool: '【工具结果】',
  runtime: '【运行时快照】',
  turn: '【新的一轮】',
  handoff: '【早期会话交接报告】',
};

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKind_ACU(value: unknown): value is AgentConversationMessageKind_ACU {
  return typeof value === 'string' && (AGENT_CONVERSATION_MESSAGE_KINDS_ACU as readonly string[]).includes(value);
}

function truncateText_ACU(text: string): string {
  if (text.length <= AGENT_CONVERSATION_TEXT_LIMIT_ACU) return text;
  return `${text.slice(0, AGENT_CONVERSATION_TEXT_LIMIT_ACU)}\n（本条内容超出 ${AGENT_CONVERSATION_TEXT_LIMIT_ACU} 字上限，已截断）`;
}

export function buildEmptyAgentConversation_ACU(): AgentConversationSnapshot_ACU {
  return { schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU, nextId: 1, updatedAt: 0, messages: [] };
}

function validateMessage_ACU(raw: unknown): AgentConversationMessage_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (!isKind_ACU(raw.kind)) return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!text.trim()) return null;
  const id = typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0 ? raw.id : 0;
  if (!id) return null;
  const message: AgentConversationMessage_ACU = {
    id,
    kind: raw.kind,
    text,
    digest: typeof raw.digest === 'string' ? raw.digest : '',
    turnKey: typeof raw.turnKey === 'string' ? raw.turnKey : '',
    at: typeof raw.at === 'number' && raw.at >= 0 ? raw.at : 0,
  };
  if (typeof raw.readKey === 'string' && raw.readKey.trim()) message.readKey = raw.readKey.trim();
  return message;
}

/**
 * 校验一份 v1 全量快照（历史遗留格式）。整体结构非法返回 null；个别条目非法只丢该条。
 * @param raw 楼层字段上的原始值
 * @returns 合法快照或 null
 */
export function validateAgentConversationSnapshot_ACU(raw: unknown): AgentConversationSnapshot_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (raw.schemaVersion !== AGENT_CONVERSATION_SCHEMA_VERSION_ACU) return null;
  if (!Array.isArray(raw.messages)) return null;
  const messages = raw.messages.flatMap(item => { const message = validateMessage_ACU(item); return message ? [message] : []; });
  const highestId = messages.reduce((max, message) => Math.max(max, message.id), 0);
  const declaredNextId = typeof raw.nextId === 'number' && Number.isInteger(raw.nextId) && raw.nextId > 0 ? raw.nextId : 1;
  return {
    schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
    // nextId 必须严格大于已有最大 id，否则追加会撞号导致 UI 的 key 冲突。
    nextId: Math.max(declaredNextId, highestId + 1),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    messages,
  };
}

function isNonNegativeInteger_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStringArray_ACU(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0);
}

function hasExactKeys_ACU(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(raw, key))
    && Object.keys(raw).every(key => allowed.has(key));
}

function validateCompactionMark_ACU(raw: unknown): AgentConversationCompactionMark_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const compactedThroughId = typeof raw.compactedThroughId === 'number' && Number.isInteger(raw.compactedThroughId) && raw.compactedThroughId > 0 ? raw.compactedThroughId : 0;
  const report = typeof raw.report === 'string' ? raw.report : '';
  const at = isNonNegativeInteger_ACU(raw.at) ? raw.at : -1;
  if (!compactedThroughId || !report.trim() || at < 0) return null;
  if (!Object.prototype.hasOwnProperty.call(raw, 'schemaVersion')) {
    // V1 是已经写入聊天记录的历史格式；兼容读取，直到下一次成功压缩才升级。
    return { compactedThroughId, report, at };
  }
  if (raw.schemaVersion !== 2 || !isRecord_ACU(raw.summaryState) || !isRecord_ACU(raw.metrics)) return null;
  const state = raw.summaryState;
  const stateKeys = ['currentGoal', 'effectiveConstraints', 'decisions', 'completedItems', 'pendingItems', 'blockers', 'continuityFacts', 'readKeys', 'recentTurns'];
  if (!hasExactKeys_ACU(state, stateKeys)
    || typeof state.currentGoal !== 'string'
    || !isStringArray_ACU(state.effectiveConstraints)
    || !isStringArray_ACU(state.decisions)
    || !isStringArray_ACU(state.completedItems)
    || !isStringArray_ACU(state.pendingItems)
    || !isStringArray_ACU(state.blockers)
    || !isStringArray_ACU(state.continuityFacts)
    || !isStringArray_ACU(state.readKeys)
    || !isStringArray_ACU(state.recentTurns)) return null;
  const metrics = raw.metrics;
  const metricKeys = ['sourceFromId', 'sourceThroughId', 'beforeTokens', 'afterTokens', 'fixedPromptTokens', 'reportTokens', 'targetTokens', 'triggerTokens', 'droppedMessages', 'droppedTurns', 'degraded'];
  if (!hasExactKeys_ACU(metrics, metricKeys, ['degradationReason'])
    || !isNonNegativeInteger_ACU(metrics.sourceFromId)
    || !isNonNegativeInteger_ACU(metrics.sourceThroughId)
    || !isNonNegativeInteger_ACU(metrics.beforeTokens)
    || !isNonNegativeInteger_ACU(metrics.afterTokens)
    || !isNonNegativeInteger_ACU(metrics.fixedPromptTokens)
    || !isNonNegativeInteger_ACU(metrics.reportTokens)
    || !isNonNegativeInteger_ACU(metrics.targetTokens)
    || !isNonNegativeInteger_ACU(metrics.triggerTokens)
    || !isNonNegativeInteger_ACU(metrics.droppedMessages)
    || !isNonNegativeInteger_ACU(metrics.droppedTurns)
    || typeof metrics.degraded !== 'boolean'
    || (Object.prototype.hasOwnProperty.call(metrics, 'degradationReason') && (typeof metrics.degradationReason !== 'string' || !metrics.degradationReason.trim()))
    || metrics.sourceFromId <= 0
    || metrics.sourceThroughId < metrics.sourceFromId) return null;
  return {
    schemaVersion: 2,
    compactedThroughId,
    report,
    summaryState: {
      currentGoal: state.currentGoal,
      effectiveConstraints: [...state.effectiveConstraints],
      decisions: [...state.decisions],
      completedItems: [...state.completedItems],
      pendingItems: [...state.pendingItems],
      blockers: [...state.blockers],
      continuityFacts: [...state.continuityFacts],
      readKeys: [...state.readKeys],
      recentTurns: [...state.recentTurns],
    },
    at,
    metrics: {
      sourceFromId: metrics.sourceFromId,
      sourceThroughId: metrics.sourceThroughId,
      beforeTokens: metrics.beforeTokens,
      afterTokens: metrics.afterTokens,
      fixedPromptTokens: metrics.fixedPromptTokens,
      reportTokens: metrics.reportTokens,
      targetTokens: metrics.targetTokens,
      triggerTokens: metrics.triggerTokens,
      droppedMessages: metrics.droppedMessages,
      droppedTurns: metrics.droppedTurns,
      degraded: metrics.degraded,
      ...(typeof metrics.degradationReason === 'string' ? { degradationReason: metrics.degradationReason } : {}),
    },
  };
}

/**
 * 校验一份 v2 楼层段记录。整体结构非法返回 null；个别消息非法只丢该条。
 * @param raw 楼层字段上的原始值
 * @returns 合法段记录或 null
 */
export function validateAgentConversationFloorRecord_ACU(raw: unknown): AgentConversationFloorRecord_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (raw.schemaVersion !== AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU) return null;
  if (!Array.isArray(raw.segment)) return null;
  const segment = raw.segment.flatMap(item => { const message = validateMessage_ACU(item); return message ? [message] : []; });
  const record: AgentConversationFloorRecord_ACU = {
    schemaVersion: AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    segment,
  };
  if (Object.prototype.hasOwnProperty.call(raw, 'compaction')) {
    const compaction = validateCompactionMark_ACU(raw.compaction);
    if (!compaction) {
      throw new ContinuationValidationError_ACU(createContinuationError_ACU(
        'CONTINUATION_AGENT_SNAPSHOT_INVALID',
        'load',
        'Agent 会话压缩标记版本或字段无效',
        false,
      ));
    }
    record.compaction = compaction;
  }
  return record;
}

/** 读取当前生效的压缩标记；与模型投影相同，选择 compactedThroughId 最大的合法标记。 */
export function readActiveAgentConversationCompactionMark_ACU(chat?: any[]): AgentConversationCompactionMark_ACU | null {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let active: AgentConversationCompactionMark_ACU | null = null;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_CONVERSATION_FIELD_ACU)) continue;
    const raw = (message as Record<string, unknown>)[AGENT_CONVERSATION_FIELD_ACU];
    const record = validateAgentConversationFloorRecord_ACU(raw);
    if (record?.compaction && (!active || record.compaction.compactedThroughId > active.compactedThroughId)) active = record.compaction;
  }
  if (!active) return null;
  if (!('summaryState' in active)) return { ...active };
  return {
    ...active,
    summaryState: {
      ...active.summaryState,
      effectiveConstraints: [...active.summaryState.effectiveConstraints],
      decisions: [...active.summaryState.decisions],
      completedItems: [...active.summaryState.completedItems],
      pendingItems: [...active.summaryState.pendingItems],
      blockers: [...active.summaryState.blockers],
      continuityFacts: [...active.summaryState.continuityFacts],
      readKeys: [...active.summaryState.readKeys],
      recentTurns: [...active.summaryState.recentTurns],
    },
    metrics: { ...active.metrics },
  };
}

/** 由压缩标记合成的交接消息。id 复用 compactedThroughId（该 id 的原始消息已被投影掉，不会撞号）。 */
function buildHandoffMessage_ACU(mark: AgentConversationCompactionMark_ACU): AgentConversationMessage_ACU {
  return { id: mark.compactedThroughId, kind: 'handoff', text: mark.report, digest: '早期会话交接报告', turnKey: '', at: mark.at };
}

/**
 * 读取当前生效的会话视图：按楼层顺序拼接各段，应用最新的压缩标记投影。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 拼接后的会话；没有任何段时返回空会话
 */
export function readAgentConversation_ACU(chat?: any[]): AgentConversationSnapshot_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let collected: AgentConversationMessage_ACU[] = [];
  let updatedAt = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_CONVERSATION_FIELD_ACU)) continue;
    const raw = (message as Record<string, unknown>)[AGENT_CONVERSATION_FIELD_ACU];
    const record = validateAgentConversationFloorRecord_ACU(raw);
    if (record) {
      collected = [...collected, ...record.segment];
      updatedAt = Math.max(updatedAt, record.updatedAt);
      continue;
    }
    // v1 全量快照：它是当时的完整会话，充当基线段——之前收集的段全部被它覆盖。
    const legacy = validateAgentConversationSnapshot_ACU(raw);
    if (legacy) {
      collected = [...legacy.messages];
      updatedAt = Math.max(updatedAt, legacy.updatedAt);
    }
  }
  const mark = readActiveAgentConversationCompactionMark_ACU(messages);
  if (!collected.length && !mark) return buildEmptyAgentConversation_ACU();
  let projected = collected;
  if (mark) {
    const threshold = mark.compactedThroughId;
    projected = [buildHandoffMessage_ACU(mark), ...collected.filter(item => item.id > threshold)];
  }
  const highestId = collected.reduce((max, item) => Math.max(max, item.id), mark?.compactedThroughId ?? 0);
  return {
    schemaVersion: AGENT_CONVERSATION_SCHEMA_VERSION_ACU,
    nextId: highestId + 1,
    updatedAt,
    messages: projected,
  };
}

/**
 * 读取完整的会话时间线（展示通道专用）：拼接所有楼层段，不做压缩投影，
 * 而是把每一份压缩标记的交接报告合成 handoff 消息插在它的截止位置上。
 *
 * 与 readAgentConversation_ACU（模型通道）的区别：模型通道只保留最新标记之后的内容，
 * 时间线保留全部原始消息——用户在 UI 里仍能回看交接文件之前的历史，并直观看到
 * 「AI 可见性从哪条交接文件开始」。删除承载标记的楼层后，该标记连同其 handoff 一起消失。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 按时间顺序的完整消息数组（含合成的 handoff 条目）
 */
export function readAgentConversationTimeline_ACU(chat?: any[]): AgentConversationMessage_ACU[] {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let collected: AgentConversationMessage_ACU[] = [];
  const marksById = new Map<number, AgentConversationCompactionMark_ACU>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_CONVERSATION_FIELD_ACU)) continue;
    const raw = (message as Record<string, unknown>)[AGENT_CONVERSATION_FIELD_ACU];
    const record = validateAgentConversationFloorRecord_ACU(raw);
    if (record) {
      collected = [...collected, ...record.segment];
      if (record.compaction) {
        const existing = marksById.get(record.compaction.compactedThroughId);
        if (!existing || record.compaction.at > existing.at) marksById.set(record.compaction.compactedThroughId, record.compaction);
      }
      continue;
    }
    const legacy = validateAgentConversationSnapshot_ACU(raw);
    if (legacy) collected = [...legacy.messages];
  }
  const marks = [...marksById.values()].sort((a, b) => a.compactedThroughId - b.compactedThroughId);
  if (!marks.length) return collected;
  const latestThroughId = marks[marks.length - 1].compactedThroughId;
  const describe = (mark: AgentConversationCompactionMark_ACU): string =>
    mark.compactedThroughId === latestThroughId ? '早期会话交接报告（此前内容对当前 AI 不可见）' : '早期会话交接报告（已被更晚的总结取代）';
  const timeline: AgentConversationMessage_ACU[] = [];
  let markIndex = 0;
  for (const item of collected) {
    // 消息 id 在拼接顺序上单调递增，因此「插在 id ≤ 截止值的最后一条之后」等价于
    // 在第一条 id 超过截止值的消息之前插入。
    while (markIndex < marks.length && item.id > marks[markIndex].compactedThroughId) {
      timeline.push({ ...buildHandoffMessage_ACU(marks[markIndex]), digest: describe(marks[markIndex]) });
      markIndex += 1;
    }
    timeline.push(item);
  }
  // 截止值不小于全部消息 id 的标记（含消息段所在楼层已被删除、只剩标记的情况）挂在末尾。
  while (markIndex < marks.length) {
    timeline.push({ ...buildHandoffMessage_ACU(marks[markIndex]), digest: describe(marks[markIndex]) });
    markIndex += 1;
  }
  return timeline;
}

function floorRecordOf_ACU(container: Record<string, unknown>): AgentConversationFloorRecord_ACU {
  const raw = container[AGENT_CONVERSATION_FIELD_ACU];
  const record = validateAgentConversationFloorRecord_ACU(raw);
  if (record) return record;
  // 该楼层挂着 v1 快照时就地升级为段记录：v1 的消息全部转为本楼的段。
  // 回退语义不变——v1 本来也是删掉这一楼就整体消失。
  const legacy = validateAgentConversationSnapshot_ACU(raw);
  return {
    schemaVersion: AGENT_CONVERSATION_SEGMENT_SCHEMA_VERSION_ACU,
    updatedAt: legacy?.updatedAt ?? 0,
    segment: legacy ? [...legacy.messages] : [],
  };
}

async function writeFloorRecord_ACU(chat: any[], targetIndex: number, record: AgentConversationFloorRecord_ACU): Promise<void> {
  const message = Array.isArray(chat) ? chat[targetIndex] : null;
  if (!message || typeof message !== 'object') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 会话记录的目标楼层不可用', false, { targetIndex }));
  }
  const container = message as Record<string, unknown>;
  const hadPrevious = Object.prototype.hasOwnProperty.call(container, AGENT_CONVERSATION_FIELD_ACU);
  const previous = container[AGENT_CONVERSATION_FIELD_ACU];
  try {
    container[AGENT_CONVERSATION_FIELD_ACU] = { ...record, updatedAt: Date.now() };
    await saveChatToHostStrict_ACU();
  } catch (error) {
    if (hadPrevious) container[AGENT_CONVERSATION_FIELD_ACU] = previous;
    else delete container[AGENT_CONVERSATION_FIELD_ACU];
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 会话记录写盘失败，已还原楼层字段', false, { targetIndex, message: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * 把已分配 id 的消息追加进末楼的段并落盘。
 * @param chat 聊天数组
 * @param prepared 待落盘的消息（id 由调用方从拼接视图的 nextId 起分配）
 * @returns 是否真的写入；没有楼层可承载或列表为空时为 false
 */
export async function appendPreparedAgentConversationMessages_ACU(chat: any[], prepared: readonly AgentConversationMessage_ACU[]): Promise<boolean> {
  if (!prepared.length) return false;
  const targetIndex = chat.length - 1;
  if (targetIndex < 0) return false;
  const container = chat[targetIndex];
  if (!container || typeof container !== 'object') return false;
  const record = floorRecordOf_ACU(container as Record<string, unknown>);
  const existingIds = new Set(record.segment.map(item => item.id));
  const fresh = prepared.filter(item => !existingIds.has(item.id));
  if (!fresh.length) return false;
  await writeFloorRecord_ACU(chat, targetIndex, { ...record, segment: [...record.segment, ...fresh] });
  return true;
}

/**
 * 在末楼记录一个非破坏压缩标记。已有更大的标记时保持不动。
 * @param chat 聊天数组
 * @param mark 压缩标记（截止消息 id + 交接报告）
 * @returns 是否真的写入
 */
export async function writeAgentConversationCompactionMark_ACU(chat: any[], mark: AgentConversationCompactionMark_ACU): Promise<boolean> {
  const targetIndex = chat.length - 1;
  if (targetIndex < 0) return false;
  const container = chat[targetIndex];
  if (!container || typeof container !== 'object') return false;
  const record = floorRecordOf_ACU(container as Record<string, unknown>);
  if (record.compaction && record.compaction.compactedThroughId >= mark.compactedThroughId) return false;
  await writeFloorRecord_ACU(chat, targetIndex, { ...record, compaction: { ...mark, at: mark.at || Date.now() } });
  return true;
}

/**
 * 在内存会话视图上追加若干条消息（纯函数，不落盘）。
 * @param snapshot 当前会话视图
 * @param appends 待追加的消息；text 为空的条目被忽略
 * @returns 新的会话视图；没有有效条目时原样返回，调用方据此跳过落盘
 */
export function appendAgentConversation_ACU(snapshot: AgentConversationSnapshot_ACU, appends: readonly AgentConversationAppend_ACU[]): AgentConversationSnapshot_ACU {
  const usable = appends.filter(item => String(item.text ?? '').trim());
  if (!usable.length) return snapshot;
  let nextId = snapshot.nextId;
  const at = Date.now();
  const added = usable.map(item => {
    const message: AgentConversationMessage_ACU = {
      id: nextId++,
      kind: item.kind,
      text: item.kind === 'runtime' ? String(item.text) : truncateText_ACU(String(item.text)),
      digest: String(item.digest ?? ''),
      turnKey: String(item.turnKey ?? ''),
      at,
    };
    if (item.readKey) message.readKey = item.readKey;
    return message;
  });
  return { ...snapshot, nextId, messages: [...snapshot.messages, ...added] };
}

/**
 * 追加消息到当前聊天的持久会话并落盘。供循环之外的调用方（用户输入、重规划说明）使用。
 * @param appends 待追加的消息
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否真的写入；没有楼层可承载或没有有效条目时为 false
 */
export async function appendAgentConversationToChat_ACU(appends: readonly AgentConversationAppend_ACU[], chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const targetIndex = messages.length - 1;
  if (targetIndex < 0) return false;
  const snapshot = readAgentConversation_ACU(messages);
  const next = appendAgentConversation_ACU(snapshot, appends);
  if (next === snapshot) return false;
  return appendPreparedAgentConversationMessages_ACU(messages, next.messages.slice(snapshot.messages.length));
}

/**
 * 渲染会话消息为发送给模型的消息序列。
 *
 * 渲染严格使用每条消息自身的持久化文本；向尾部追加消息不得反向改写既有渲染前缀。
 * @param snapshot 当前会话视图
 * @returns `{ role, content }` 数组；主 Agent 自己的输出是 assistant，其余一律 user
 */
export function renderAgentConversationMessages_ACU(snapshot: AgentConversationSnapshot_ACU): Array<{ role: string; content: string }> {
  return snapshot.messages.map((message) => {
    const prefix = KIND_PREFIXES_ACU[message.kind];
    return {
      role: message.kind === 'agent' ? 'assistant' : 'user',
      content: prefix ? `${prefix}\n${message.text}` : message.text,
    };
  });
}

/**
 * 找出会话里最后一次轮次通告的游标指纹。
 * @param snapshot 当前会话视图
 * @returns 最后一条 turn 消息的 turnKey；没有通告过则为空串
 */
export function lastAnnouncedTurnKey_ACU(snapshot: AgentConversationSnapshot_ACU): string {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (snapshot.messages[index].kind === 'turn') return snapshot.messages[index].turnKey;
  }
  return '';
}

/**
 * 投影视图里最近一条运行时快照的正文。压缩掉旧快照后返回空串，
 * 调用方据此重新追加当前快照，避免模型只剩过期目录。
 */
export function lastRuntimeSnapshotText_ACU(snapshot: AgentConversationSnapshot_ACU): string {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (snapshot.messages[index].kind === 'runtime') return snapshot.messages[index].text;
  }
  return '';
}

/**
 * 从全部楼层清除会话字段。用于「一键清空」，只删扩展字段，绝不触碰正文。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否有楼层被改动
 */
export async function clearAgentConversationField_ACU(chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_CONVERSATION_FIELD_ACU)) continue;
    delete (message as Record<string, unknown>)[AGENT_CONVERSATION_FIELD_ACU];
    changed = true;
  }
  if (changed) await saveChatToHostStrict_ACU();
  return changed;
}
