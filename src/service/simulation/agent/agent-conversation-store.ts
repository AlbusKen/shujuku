import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { isModelExchangeSequence_ACU, toOpenAiToolCalls_ACU } from '../../ai/native-tool';
import {
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
} from '../model';
import {
  buildWorldSimulationBucketKey_ACU,
  readWorldSimulationBucketEntry_ACU,
  resolveCurrentWorldSimulationAnchor_ACU,
  resolveWorldSimulationAnchor_ACU,
} from '../simulation-store';
import {
  WORLD_SIMULATION_SESSION_EVENT_KINDS_ACU,
  type WorldSimulationSessionInput_ACU,
} from './agent-session-log';
import {
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
  WORLD_SIMULATION_MESSAGE_KINDS_ACU,
  WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU,
  type WorldSimulationAnchorIdentity_ACU,
  type WorldSimulationConversationAppend_ACU,
  type WorldSimulationConversationCompaction_ACU,
  type WorldSimulationConversationFloorRecord_ACU,
  type WorldSimulationConversationMessage_ACU,
  type WorldSimulationConversationSegment_ACU,
  type WorldSimulationConversationView_ACU,
  type WorldSimulationBucket_ACU,
} from './agent-model';

const TEXT_LIMIT_ACU = 8000;
let sessionEventSequence_ACU = 0;
const conversationWriteQueues_ACU = new Map<string, Promise<void>>();

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'agent_persist', message, false, details,
  ));
}

function requiredText_ACU(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) reject_ACU(`${path} 必须是非空字符串`, { path });
  return value;
}

function nonNegativeInteger_ACU(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) reject_ACU(`${path} 必须是非负整数`, { path });
  return value;
}

function validateMessage_ACU(raw: unknown, path: string): WorldSimulationConversationMessage_ACU {
  if (!isRecord_ACU(raw)) reject_ACU(`${path} 必须是对象`, { path });
  const allowed = new Set(['id', 'kind', 'text', 'digest', 'turnKey', 'at', 'readKey', 'eventKind', 'title', 'status', 'agentName', 'ok', 'toolCalls', 'toolCallId']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) reject_ACU(`${path}.${key} 是未知字段`, { path: `${path}.${key}` });
  }
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(WORLD_SIMULATION_MESSAGE_KINDS_ACU as readonly string[]).includes(kind)) {
    reject_ACU(`${path}.kind 非法`, { path: `${path}.kind` });
  }
  const toolCalls = parseConversationToolCalls_ACU(raw.toolCalls, path);
  const toolCallId = raw.toolCallId === undefined ? undefined : requiredText_ACU(raw.toolCallId, `${path}.toolCallId`);
  const message: WorldSimulationConversationMessage_ACU = {
    id: nonNegativeInteger_ACU(raw.id, `${path}.id`),
    kind: kind as WorldSimulationConversationMessage_ACU['kind'],
    text: typeof raw.text === 'string' && raw.text.trim() ? raw.text : (toolCalls?.length || toolCallId ? String(raw.text ?? '') : requiredText_ACU(raw.text, `${path}.text`)),
    digest: typeof raw.digest === 'string' ? raw.digest : '',
    turnKey: typeof raw.turnKey === 'string' ? raw.turnKey : '',
    at: nonNegativeInteger_ACU(raw.at, `${path}.at`),
  };
  if (raw.readKey !== undefined) message.readKey = requiredText_ACU(raw.readKey, `${path}.readKey`);
  if (raw.eventKind !== undefined) {
    const eventKind = requiredText_ACU(raw.eventKind, `${path}.eventKind`);
    if (!(WORLD_SIMULATION_SESSION_EVENT_KINDS_ACU as readonly string[]).includes(eventKind)) {
      reject_ACU(`${path}.eventKind 非法`, { path: `${path}.eventKind` });
    }
    message.eventKind = eventKind;
  }
  if (raw.title !== undefined) message.title = requiredText_ACU(raw.title, `${path}.title`);
  if (raw.status !== undefined) {
    if (raw.status !== 'running' && raw.status !== 'done' && raw.status !== 'failed') {
      reject_ACU(`${path}.status 非法`, { path: `${path}.status` });
    }
    message.status = raw.status;
  }
  if (raw.agentName !== undefined) message.agentName = requiredText_ACU(raw.agentName, `${path}.agentName`);
  if (raw.ok !== undefined) {
    if (typeof raw.ok !== 'boolean') reject_ACU(`${path}.ok 必须是布尔值`, { path: `${path}.ok` });
    message.ok = raw.ok;
  }
  if (toolCalls?.length) message.toolCalls = toolCalls;
  if (toolCallId) message.toolCallId = toolCallId;
  return message;
}

function parseConversationToolCalls_ACU(raw: unknown, path: string): Array<{ id: string; name: string; arguments: string }> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.length) reject_ACU(`${path}.toolCalls 必须是非空数组`, { path: `${path}.toolCalls` });
  return (raw as unknown[]).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) reject_ACU(`${path}.toolCalls[${index}] 必须是对象`);
    const value = item as { id?: unknown; name?: unknown; arguments?: unknown };
    return {
      id: requiredText_ACU(value.id, `${path}.toolCalls[${index}].id`),
      name: requiredText_ACU(value.name, `${path}.toolCalls[${index}].name`),
      arguments: typeof value.arguments === 'string' ? value.arguments : '{}',
    };
  });
}

function validateCompaction_ACU(raw: unknown, path: string): WorldSimulationConversationCompaction_ACU {
  if (!isRecord_ACU(raw)) reject_ACU(`${path} 必须是对象`, { path });
  return {
    compactedThroughId: nonNegativeInteger_ACU(raw.compactedThroughId, `${path}.compactedThroughId`),
    report: requiredText_ACU(raw.report, `${path}.report`),
    at: nonNegativeInteger_ACU(raw.at, `${path}.at`),
  };
}

function validateSegment_ACU(raw: unknown, path: string): WorldSimulationConversationSegment_ACU {
  if (!isRecord_ACU(raw)) reject_ACU(`${path} 必须是对象`, { path });
  const allowed = new Set(['schemaVersion', 'segmentId', 'runId', 'taskId', 'stageId', 'stageRevision', 'messages', 'compaction', 'updatedAt']);
  for (const key of ['schemaVersion', 'segmentId', 'runId', 'taskId', 'stageId', 'stageRevision', 'messages', 'updatedAt']) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) reject_ACU(`${path}.${key} 缺失`, { path: `${path}.${key}` });
  }
  for (const key of Object.keys(raw)) if (!allowed.has(key)) reject_ACU(`${path}.${key} 是未知字段`, { path: `${path}.${key}` });
  if (raw.schemaVersion !== WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU) reject_ACU(`${path}.schemaVersion 非法`);
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) reject_ACU(`${path}.messages 不能为空`);
  return {
    schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU,
    segmentId: requiredText_ACU(raw.segmentId, `${path}.segmentId`),
    runId: requiredText_ACU(raw.runId, `${path}.runId`),
    taskId: requiredText_ACU(raw.taskId, `${path}.taskId`),
    stageId: requiredText_ACU(raw.stageId, `${path}.stageId`),
    stageRevision: nonNegativeInteger_ACU(raw.stageRevision, `${path}.stageRevision`),
    messages: raw.messages.map((message, index) => validateMessage_ACU(message, `${path}.messages[${index}]`)),
    ...(raw.compaction === undefined ? {} : { compaction: validateCompaction_ACU(raw.compaction, `${path}.compaction`) }),
    updatedAt: nonNegativeInteger_ACU(raw.updatedAt, `${path}.updatedAt`),
  };
}

export function validateWorldSimulationConversationFloorRecord_ACU(raw: unknown): WorldSimulationConversationFloorRecord_ACU {
  if (!isRecord_ACU(raw)) reject_ACU('会话楼层记录必须是对象');
  const keys = Object.keys(raw);
  if (keys.some(key => !['schemaVersion', 'segments', 'updatedAt'].includes(key))) reject_ACU('会话楼层记录存在未知字段');
  if (raw.schemaVersion !== WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU || !Array.isArray(raw.segments)) {
    reject_ACU('会话楼层记录结构非法');
  }
  const segments = raw.segments.map((segment, index) => validateSegment_ACU(segment, `segments[${index}]`));
  const ids = new Set<string>();
  for (const segment of segments) {
    if (ids.has(segment.segmentId)) reject_ACU('会话楼层记录存在重复 segmentId', { segmentId: segment.segmentId });
    ids.add(segment.segmentId);
  }
  return {
    schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU,
    segments,
    updatedAt: nonNegativeInteger_ACU(raw.updatedAt, 'updatedAt'),
  };
}

interface LegacyConversationMessage_ACU {
  id: number; at: number; kind: string; status: string; title: string; detail: string;
  requestId?: string; agentName?: string;
}
interface LegacyConversationEntry_ACU {
  swipe: { messageIndex: number; messageKey: string; swipeIndex: number; baseTextHash: string };
  nextId: number;
  messages: LegacyConversationMessage_ACU[];
}

function legacyConversationEnvelope_ACU(raw: unknown): { version: 1; entries: LegacyConversationEntry_ACU[] } | null {
  if (!isRecord_ACU(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) return null;
  if (Object.keys(raw).some(key => !['version', 'entries'].includes(key))) reject_ACU('旧版会话 envelope 存在未知字段');
  const entries: LegacyConversationEntry_ACU[] = [];
  const locations = new Set<string>();
  for (const [entryIndex, candidate] of raw.entries.entries()) {
    if (!isRecord_ACU(candidate) || !isRecord_ACU(candidate.swipe) || !Array.isArray(candidate.messages)) {
      reject_ACU(`旧版会话 entries[${entryIndex}] 结构非法`);
    }
    if (Object.keys(candidate).some(key => !['swipe', 'nextId', 'messages'].includes(key))
      || Object.keys(candidate.swipe).some(key => !['messageIndex', 'messageKey', 'swipeIndex', 'baseTextHash'].includes(key))) {
      reject_ACU(`旧版会话 entries[${entryIndex}] 存在未知字段`);
    }
    const swipe = candidate.swipe;
    if (!Number.isInteger(swipe.messageIndex) || (swipe.messageIndex as number) < 0
      || typeof swipe.messageKey !== 'string' || !swipe.messageKey.trim()
      || !Number.isInteger(swipe.swipeIndex) || (swipe.swipeIndex as number) < 0
      || typeof swipe.baseTextHash !== 'string' || !swipe.baseTextHash.trim()
      || !Number.isInteger(candidate.nextId) || (candidate.nextId as number) < 1) {
      reject_ACU(`旧版会话 entries[${entryIndex}] 身份非法`);
    }
    const location = `${swipe.messageIndex}|${swipe.messageKey}|${swipe.swipeIndex}`;
    if (locations.has(location)) reject_ACU(`旧版会话 entries[${entryIndex}] 位置重复`);
    locations.add(location);
    const messages = candidate.messages.map((message, messageIndex) => {
      if (!isRecord_ACU(message) || !Number.isInteger(message.id) || (message.id as number) < 1
        || typeof message.at !== 'number' || !Number.isFinite(message.at)
        || typeof message.kind !== 'string' || typeof message.status !== 'string'
        || typeof message.title !== 'string' || !message.title.trim()
        || typeof message.detail !== 'string' || !message.detail.trim()) {
        reject_ACU(`旧版会话 entries[${entryIndex}].messages[${messageIndex}] 非法`);
      }
      if (Object.keys(message).some(key => !['id', 'at', 'kind', 'status', 'title', 'detail', 'requestId', 'agentName'].includes(key))) {
        reject_ACU(`旧版会话 entries[${entryIndex}].messages[${messageIndex}] 存在未知字段`);
      }
      return message as unknown as LegacyConversationMessage_ACU;
    });
    const ids = new Set(messages.map(message => message.id));
    const highestId = messages.reduce((max, message) => Math.max(max, message.id), 0);
    if (ids.size !== messages.length || (candidate.nextId as number) <= highestId) {
      reject_ACU(`旧版会话 entries[${entryIndex}] 消息 ID 非法`);
    }
    entries.push({ swipe: swipe as LegacyConversationEntry_ACU['swipe'], nextId: candidate.nextId as number, messages });
  }
  return { version: 1, entries };
}

function legacyMessageKind_ACU(kind: string): WorldSimulationConversationMessage_ACU['kind'] {
  if (kind === 'user') return 'user';
  if (kind === 'delegation' || kind === 'plan') return 'agent';
  return 'runtime';
}

function contentForLegacySwipe_ACU(message: Record<string, unknown>, swipeIndex: number): string | null {
  if (Array.isArray(message.swipes) && typeof message.swipes[swipeIndex] === 'string') return message.swipes[swipeIndex];
  const active = typeof message.swipe_id === 'number' ? message.swipe_id : 0;
  if (swipeIndex !== active) return null;
  return typeof message.mes === 'string' ? message.mes : typeof message.message === 'string' ? message.message : null;
}

/** Converts the pre-T1 envelope without mutating the host message. Null means the value is not legacy. */
export function migrateLegacyWorldSimulationConversationBucket_ACU(
  raw: unknown,
  message: Record<string, unknown>,
  chatIdentity: string,
  messageIndex: number,
): WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU> | null {
  const legacy = legacyConversationEnvelope_ACU(raw);
  if (!legacy) return null;
  const entries: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>['entries'] = {};
  for (const [entryIndex, legacyEntry] of legacy.entries.entries()) {
    const content = contentForLegacySwipe_ACU(message, legacyEntry.swipe.swipeIndex);
    if (content === null) reject_ACU(`旧版会话 entries[${entryIndex}] 无法解析对应 swipe 正文`);
    const rawId = message.message_id;
    const messageId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : legacyEntry.swipe.messageIndex;
    const expectedMessageKey = `${typeof messageId}:${String(messageId)}`;
    if (legacyEntry.swipe.messageIndex !== messageIndex || legacyEntry.swipe.messageKey !== expectedMessageKey) {
      reject_ACU(`旧版会话 entries[${entryIndex}] 与宿主楼层身份不一致`);
    }
    const anchor = {
      chatIdentity,
      messageIndex: legacyEntry.swipe.messageIndex,
      messageId,
      messageKey: expectedMessageKey,
      swipeId: String(legacyEntry.swipe.swipeIndex),
      contentDigest: sha256HexSync_ACU(content),
    };
    const updatedAt = legacyEntry.messages.reduce((max, item) => Math.max(max, item.at), 0);
    const messages = legacyEntry.messages.map(item => ({
      id: item.id,
      kind: legacyMessageKind_ACU(item.kind),
      text: item.detail,
      digest: item.title,
      turnKey: item.requestId ?? '',
      at: item.at,
    }));
    const segments = messages.length ? [{
      schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU,
      segmentId: `legacy:${anchor.messageIndex}:${anchor.swipeId}`,
      runId: 'legacy', taskId: 'legacy', stageId: 'legacy', stageRevision: 0,
      messages, updatedAt,
    }] : [];
    entries[buildWorldSimulationBucketKey_ACU(anchor)] = {
      anchor,
      value: { schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU, segments, updatedAt },
      updatedAt,
    };
  }
  return { schemaVersion: 1, entries };
}

function collectSegments_ACU(chat?: any[]): { segments: WorldSimulationConversationSegment_ACU[]; diagnostics: string[] } {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const segments: WorldSimulationConversationSegment_ACU[] = [];
  const diagnostics: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isRecord_ACU(message) || message.is_user === true || message.is_system === true) continue;
    const anchor = resolveWorldSimulationAnchor_ACU(index, messages);
    try {
      const raw = message[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
      const legacy = raw === undefined ? null : migrateLegacyWorldSimulationConversationBucket_ACU(
        raw, message, anchor.chatIdentity, index,
      );
      const record = legacy
        ? legacy.entries[buildWorldSimulationBucketKey_ACU(anchor)]?.value ?? null
        : readWorldSimulationBucketEntry_ACU(
            WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
            anchor,
            validateWorldSimulationConversationFloorRecord_ACU,
            messages,
          );
      if (record) segments.push(...record.segments);
    } catch (error) {
      if (error instanceof WorldSimulationValidationError_ACU) {
        diagnostics.push(`楼层 ${index}: ${error.message}`);
        continue;
      }
      throw error;
    }
  }
  return { segments, diagnostics };
}

export function readWorldSimulationConversation_ACU(chat?: any[]): WorldSimulationConversationView_ACU {
  const collected = collectSegments_ACU(chat);
  const allMessages = collected.segments.flatMap(segment => segment.messages);
  const maxId = allMessages.reduce((max, message) => Math.max(max, message.id), 0);
  let compaction: WorldSimulationConversationCompaction_ACU | null = null;
  for (const segment of collected.segments) {
    if (segment.compaction && (!compaction || segment.compaction.compactedThroughId > compaction.compactedThroughId)) {
      compaction = segment.compaction;
    }
  }
  const projected = compaction
    ? [
        { id: 0, kind: 'handoff' as const, text: compaction.report, digest: '早期会话交接报告', turnKey: '', at: compaction.at },
        ...allMessages.filter(message => message.id > compaction!.compactedThroughId),
      ]
    : allMessages;
  return { nextId: maxId + 1, messages: projected, compaction, diagnostics: collected.diagnostics };
}

/** Director requests and compaction must project the same confirmed, model-visible floor messages. */
export function readWorldSimulationDirectorCompactionSource_ACU(chat?: any[]): {
  view: WorldSimulationConversationView_ACU;
  fingerprint: string;
} {
  const { segments, diagnostics } = collectSegments_ACU(chat);
  if (diagnostics.length) reject_ACU('世界推演主会话历史楼层损坏', { diagnostics });
  const all = segments.flatMap(segment => segment.messages);
  const compaction = segments.flatMap(segment => segment.compaction ? [segment.compaction] : [])
    .sort((left, right) => right.compactedThroughId - left.compactedThroughId)[0] ?? null;
  const visible = all.filter(message => message.kind === 'model_agent' || message.kind === 'model_feedback'
    || (message.kind === 'user' && !message.eventKind));
  const projected = visible.filter(message => message.id > (compaction?.compactedThroughId ?? 0));
  return {
    view: {
      nextId: all.reduce((max, message) => Math.max(max, message.id), 0) + 1,
      messages: compaction
        ? [{ id: 0, kind: 'handoff', text: compaction.report, digest: '早期会话交接报告', turnKey: '', at: compaction.at }, ...projected]
        : projected,
      compaction,
      diagnostics,
    },
    fingerprint: sha256HexSync_ACU(JSON.stringify(segments)),
  };
}

/** Only director requests use this projection; session cards and specialist output are never model turns. */
export function readWorldSimulationDirectorHistory_ACU(chat?: any[]): Array<{ role: 'assistant' | 'user' | 'tool'; content: string; tool_calls?: ReturnType<typeof toOpenAiToolCalls_ACU>; tool_call_id?: string }> {
  return readWorldSimulationDirectorCompactionSource_ACU(chat).view.messages.map(message => {
    if (message.kind === 'model_agent') {
      return { role: 'assistant' as const, content: message.text, ...(message.toolCalls?.length ? { tool_calls: toOpenAiToolCalls_ACU(message.toolCalls) } : {}) };
    }
    if (message.toolCallId) return { role: 'tool' as const, tool_call_id: message.toolCallId, content: message.text };
    return { role: 'user' as const, content: message.text };
  });
}

/** Only the current run's model turns are used when migrating an old run-state transcript. */
export function readWorldSimulationDirectorRunHistory_ACU(runId: string, chat?: any[], afterId = 0): Array<{ role: 'assistant' | 'user' | 'tool'; content: string; tool_calls?: ReturnType<typeof toOpenAiToolCalls_ACU>; tool_call_id?: string }> {
  const { segments, diagnostics } = collectSegments_ACU(chat);
  if (diagnostics.length) reject_ACU('世界推演主会话历史楼层损坏', { diagnostics });
  return segments.filter(segment => segment.runId === runId).flatMap(segment => segment.messages.filter(message => message.id > afterId).flatMap((message): Array<{ role: 'assistant' | 'user' | 'tool'; content: string; tool_calls?: ReturnType<typeof toOpenAiToolCalls_ACU>; tool_call_id?: string }> => {
    if (message.kind === 'model_agent') return [{ role: 'assistant' as const, content: message.text, ...(message.toolCalls?.length ? { tool_calls: toOpenAiToolCalls_ACU(message.toolCalls) } : {}) }];
    if (message.toolCallId) return [{ role: 'tool' as const, tool_call_id: message.toolCallId, content: message.text }];
    if (message.kind === 'model_feedback') return [{ role: 'user' as const, content: message.text }];
    return [];
  }));
}

/** Append a complete director action/feedback pair at the frozen assistant anchor. */
export async function appendWorldSimulationDirectorHistory_ACU(input: {
  anchor: WorldSimulationAnchorIdentity_ACU;
  runId: string;
  taskId: string;
  stageId: string;
  stageRevision: number;
  messages: readonly { role: 'assistant' | 'user' | 'tool'; content: string; tool_calls?: ReturnType<typeof toOpenAiToolCalls_ACU>; tool_call_id?: string }[];
}, chat?: any[]): Promise<boolean> {
  if (!input.messages.length) return false;
  if (!isModelExchangeSequence_ACU(input.messages)) {
    reject_ACU('主会话动作与反馈必须成对保存');
  }
  return serializeConversationWrite_ACU(input.anchor.chatIdentity, () => {
    const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
    if (messages !== getChatArray_ACU()) reject_ACU('主会话锚点聊天已经切换');
    const prefix = `director:${input.runId}:`;
    const seq = peekCurrentConversationSegments_ACU(input.anchor, messages)
      .filter(segment => segment.segmentId.startsWith(prefix)).length;
    return appendWorldSimulationConversationSegmentUnlocked_ACU({
      anchor: input.anchor,
      segmentId: `${prefix}${seq}`,
      runId: input.runId,
      taskId: input.taskId,
      stageId: input.stageId,
      stageRevision: input.stageRevision,
      appends: input.messages.map(item => ({
        kind: item.role === 'assistant' ? 'model_agent' as const : 'model_feedback' as const,
        text: item.content || (item.tool_calls?.length || item.tool_call_id ? ' ' : item.content),
        ...(item.tool_call_id ? { toolCallId: item.tool_call_id } : {}),
        ...(item.tool_calls?.length ? { toolCalls: item.tool_calls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })) } : {}),
      })),
    }, messages);
  });
}

function truncateText_ACU(text: string): string {
  return text.length <= TEXT_LIMIT_ACU
    ? text
    : `${text.slice(0, TEXT_LIMIT_ACU)}\n（本条内容超出 ${TEXT_LIMIT_ACU} 字上限，已截断）`;
}

function conversationAppendFingerprint_ACU(
  items: readonly { kind: string; text: string; digest?: string; turnKey?: string }[],
): string {
  return sha256HexSync_ACU(JSON.stringify(items.map(item => [
    item.kind,
    item.kind === 'model_agent' || item.kind === 'model_feedback' ? String(item.text ?? '') : truncateText_ACU(String(item.text ?? '')),
    String(item.digest ?? ''),
    String(item.turnKey ?? ''),
  ])));
}

export function nextWorldSimulationUserInstructionSegmentId_ACU(
  runId: string,
  segments: readonly { segmentId: string }[],
): string {
  const prefix = `user:${runId}:`;
  const legacyId = `user:${runId}`;
  let maxSeq = -1;
  for (const segment of segments) {
    if (segment.segmentId === legacyId) {
      maxSeq = Math.max(maxSeq, 0);
      continue;
    }
    if (!segment.segmentId.startsWith(prefix)) continue;
    const rawSeq = segment.segmentId.slice(prefix.length);
    if (!/^\d+$/.test(rawSeq)) continue;
    maxSeq = Math.max(maxSeq, Number(rawSeq));
  }
  return `${prefix}${maxSeq + 1}`;
}

function peekCurrentConversationSegments_ACU(
  anchor: WorldSimulationAnchorIdentity_ACU,
  messages: any[],
): readonly { segmentId: string }[] {
  const record = readWorldSimulationBucketEntry_ACU(
    WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
    anchor,
    validateWorldSimulationConversationFloorRecord_ACU,
    messages,
  );
  return record?.segments ?? [];
}

export interface AppendWorldSimulationConversationInput_ACU {
  anchor: WorldSimulationAnchorIdentity_ACU;
  segmentId: string;
  runId: string;
  taskId: string;
  stageId: string;
  stageRevision: number;
  appends: readonly WorldSimulationConversationAppend_ACU[];
  compaction?: WorldSimulationConversationCompaction_ACU;
  idempotent?: boolean;
}

async function serializeConversationWrite_ACU<T>(chatIdentity: string, operation: () => Promise<T>): Promise<T> {
  const previous = conversationWriteQueues_ACU.get(chatIdentity) ?? Promise.resolve();
  const current: Promise<T> = previous.catch((): void => undefined).then(() => operation());
  const tail: Promise<void> = current.then((): void => undefined, (): void => undefined);
  conversationWriteQueues_ACU.set(chatIdentity, tail);
  try {
    return await current;
  } finally {
    if (conversationWriteQueues_ACU.get(chatIdentity) === tail) conversationWriteQueues_ACU.delete(chatIdentity);
  }
}

async function appendWorldSimulationConversationSegmentUnlocked_ACU(
  input: AppendWorldSimulationConversationInput_ACU,
  chat?: any[],
): Promise<boolean> {
  const usable = input.appends.filter(item => String(item.text ?? '').trim() || item.kind === 'model_agent' || item.toolCallId || item.toolCalls?.length);
  if (usable.length === 0) return false;
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const currentView = readWorldSimulationConversation_ACU(messages);
  let nextId = currentView.nextId;
  const at = Date.now();
  const added = usable.map(item => {
    const message: WorldSimulationConversationMessage_ACU = {
      id: nextId++,
      kind: item.kind,
      text: item.kind === 'model_agent' || item.kind === 'model_feedback'
        ? String(item.text)
        : truncateText_ACU(String(item.text)),
      digest: String(item.digest ?? ''),
      turnKey: String(item.turnKey ?? ''),
      at,
    };
    if (item.readKey) message.readKey = item.readKey;
    if (item.eventKind) message.eventKind = item.eventKind;
    if (item.title) message.title = item.title;
    if (item.status) message.status = item.status;
    if (item.agentName) message.agentName = item.agentName;
    if (item.ok !== undefined) message.ok = item.ok;
    if (item.toolCallId) message.toolCallId = item.toolCallId;
    if (item.toolCalls?.length) message.toolCalls = item.toolCalls.map(call => ({ ...call }));
    return message;
  });
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(input.anchor, messages);
  const hostMessage = messages[currentAnchor.messageIndex] as Record<string, unknown>;
  const previous = hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
  const migrated = previous === undefined ? null : migrateLegacyWorldSimulationConversationBucket_ACU(
    previous, hostMessage, currentAnchor.chatIdentity, currentAnchor.messageIndex,
  );
  let currentBucket: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>;
  if (previous === undefined) currentBucket = { schemaVersion: 1, entries: {} };
  else if (migrated) currentBucket = migrated;
  else if (isRecord_ACU(previous) && previous.schemaVersion === 1 && isRecord_ACU(previous.entries)) {
    currentBucket = previous as unknown as WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>;
  } else reject_ACU(`${WORLD_SIMULATION_CONVERSATION_FIELD_ACU} 分桶结构损坏`);
  const key = buildWorldSimulationBucketKey_ACU(currentAnchor);
  const existing = currentBucket.entries[key]
    ? validateWorldSimulationConversationFloorRecord_ACU(currentBucket.entries[key].value)
    : { schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU, segments: [], updatedAt: 0 };
  const incomingFingerprint = conversationAppendFingerprint_ACU(added);
  const sameId = existing.segments.find(segment => segment.segmentId === input.segmentId);
  if (sameId) {
    if (input.idempotent && conversationAppendFingerprint_ACU(sameId.messages) === incomingFingerprint) return true;
    reject_ACU('重复 segmentId，拒绝重复持久化', { segmentId: input.segmentId });
  }
  if (input.idempotent) {
    const sameContent = existing.segments.find(segment => (
      segment.runId === input.runId
      && conversationAppendFingerprint_ACU(segment.messages) === incomingFingerprint
    ));
    if (sameContent) return true;
  }
  const segment: WorldSimulationConversationSegment_ACU = {
    schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU,
    segmentId: requiredText_ACU(input.segmentId, 'segmentId'),
    runId: requiredText_ACU(input.runId, 'runId'),
    taskId: requiredText_ACU(input.taskId, 'taskId'),
    stageId: requiredText_ACU(input.stageId, 'stageId'),
    stageRevision: nonNegativeInteger_ACU(input.stageRevision, 'stageRevision'),
    messages: added,
    ...(input.compaction ? { compaction: validateCompaction_ACU(input.compaction, 'compaction') } : {}),
    updatedAt: at,
  };
  const candidate: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU> = {
    schemaVersion: 1,
    entries: {
      ...currentBucket.entries,
      [key]: {
        anchor: { ...currentAnchor },
        value: { ...existing, segments: [...existing.segments, segment], updatedAt: at },
        updatedAt: at,
      },
    },
  };
  try {
    hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = candidate;
    await saveChatToHostStrict_ACU();
    resolveCurrentWorldSimulationAnchor_ACU(currentAnchor, messages);
  } catch (error) {
    if (previous === undefined) delete hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    else hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = previous;
    throw error;
  }
  return true;
}

export async function appendWorldSimulationConversationSegment_ACU(
  input: AppendWorldSimulationConversationInput_ACU,
  chat?: any[],
): Promise<boolean> {
  return serializeConversationWrite_ACU(input.anchor.chatIdentity, () =>
    appendWorldSimulationConversationSegmentUnlocked_ACU(input, chat));
}

export async function appendWorldSimulationUserInstruction_ACU(
  input: {
    runId: string;
    taskId: string;
    stageId: string;
    stageRevision: number;
    triggerConversationMessageId?: string | null;
    anchor: WorldSimulationAnchorIdentity_ACU;
    text: string;
    idempotent?: boolean;
  },
  chat?: any[],
): Promise<boolean> {
  return serializeConversationWrite_ACU(input.anchor.chatIdentity, () => {
    const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
    const segments = peekCurrentConversationSegments_ACU(input.anchor, messages);
    return appendWorldSimulationConversationSegmentUnlocked_ACU({
      anchor: input.anchor,
      segmentId: nextWorldSimulationUserInstructionSegmentId_ACU(input.runId, segments),
      runId: input.runId,
      taskId: input.taskId,
      stageId: input.stageId,
      stageRevision: input.stageRevision,
      appends: [{ kind: 'user', text: input.text, turnKey: input.triggerConversationMessageId ?? input.runId }],
      idempotent: input.idempotent === true,
    }, messages);
  });
}


export interface AppendWorldSimulationSessionEventInput_ACU {
  anchor: WorldSimulationAnchorIdentity_ACU;
  runId: string;
  taskId: string;
  stageId: string;
  stageRevision: number;
  eventKey: string;
  event: WorldSimulationSessionInput_ACU;
}

function conversationKindForSessionEvent_ACU(kind: WorldSimulationSessionInput_ACU['kind']): WorldSimulationConversationMessage_ACU['kind'] {
  if (kind === 'user_message') return 'user';
  if (kind === 'run_started' || kind === 'run_resumed') return 'turn';
  if (kind === 'tool_read') return 'tool';
  if (kind === 'handoff') return 'handoff';
  if (kind === 'protocol_retry' || kind === 'thought') return 'runtime';
  return 'agent';
}

/**
 * 将已定格的会话卡片追加到楼层锚定会话。调用方应在 running 卡片转为 done/failed，
 * 或产生终态事件时调用；eventKey 在同一 run 内必须稳定且唯一。
 */
export async function appendWorldSimulationSessionEvent_ACU(
  input: AppendWorldSimulationSessionEventInput_ACU,
  chat?: any[],
): Promise<boolean> {
  const ok = input.event.ok !== false;
  const status = input.event.status ?? (ok ? 'done' : 'failed');
  const title = requiredText_ACU(input.event.title, 'event.title');
  const eventKey = requiredText_ACU(input.eventKey, 'eventKey');
  return appendWorldSimulationConversationSegment_ACU({
    anchor: input.anchor,
    segmentId: `session:${input.runId}:${eventKey}:${Date.now().toString(36)}:${++sessionEventSequence_ACU}`,
    runId: input.runId,
    taskId: input.taskId,
    stageId: input.stageId,
    stageRevision: input.stageRevision,
    appends: [{
      kind: conversationKindForSessionEvent_ACU(input.event.kind),
      text: String(input.event.detail || title),
      digest: title,
      turnKey: `${input.runId}:${eventKey}`,
      eventKind: input.event.kind,
      title,
      status,
      agentName: input.event.agentName,
      ok,
    }],
  }, chat);
}

/**
 * 把压缩标记写到当前锚点楼层的最后一段。不能新建空 messages 段（校验拒绝），
 * 因此当前楼层还没有任何 segment 时返回 false，由调用方跳过本次派工。
 */
export async function writeWorldSimulationConversationCompaction_ACU(
  input: {
    anchor: WorldSimulationAnchorIdentity_ACU;
    compaction: WorldSimulationConversationCompaction_ACU;
    expectedFingerprint?: string;
    expectedStageId?: string;
    expectedStageRevision?: number;
  },
  chat?: any[],
): Promise<boolean> {
  return serializeConversationWrite_ACU(input.anchor.chatIdentity, async () => {
    const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
    if (messages !== getChatArray_ACU()) reject_ACU('主会话锚点聊天已经切换');
    const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(input.anchor, messages);
    if (input.expectedFingerprint && readWorldSimulationDirectorCompactionSource_ACU(messages).fingerprint !== input.expectedFingerprint) {
      reject_ACU('主会话压缩来源或保留后缀在总结期间发生变化');
    }
    const hostMessage = messages[currentAnchor.messageIndex] as Record<string, unknown>;
    const previous = hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    const migrated = previous === undefined ? null : migrateLegacyWorldSimulationConversationBucket_ACU(
      previous, hostMessage, currentAnchor.chatIdentity, currentAnchor.messageIndex,
    );
    let currentBucket: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>;
    if (previous === undefined) return false;
    if (migrated) currentBucket = migrated;
    else if (isRecord_ACU(previous) && previous.schemaVersion === 1 && isRecord_ACU(previous.entries)) {
      currentBucket = previous as unknown as WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>;
    } else reject_ACU(`${WORLD_SIMULATION_CONVERSATION_FIELD_ACU} 分桶结构损坏`);
    const key = buildWorldSimulationBucketKey_ACU(currentAnchor);
    const existing = currentBucket.entries[key]
      ? validateWorldSimulationConversationFloorRecord_ACU(currentBucket.entries[key].value)
      : { schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU, segments: [], updatedAt: 0 };
    if (!existing.segments.length) return false;
    if (readWorldSimulationDirectorCompactionSource_ACU(messages).view.compaction?.compactedThroughId >= input.compaction.compactedThroughId) return false;
    const at = Date.now();
    const last = existing.segments[existing.segments.length - 1];
    if ((input.expectedStageId && last.stageId !== input.expectedStageId)
      || (input.expectedStageRevision !== undefined && last.stageRevision !== input.expectedStageRevision)) {
      reject_ACU('主会话压缩锚点阶段或 revision 已变化');
    }
    const updated: WorldSimulationConversationSegment_ACU = {
      ...last,
      compaction: validateCompaction_ACU(input.compaction, 'compaction'),
      updatedAt: at,
    };
    const candidate: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU> = {
      schemaVersion: 1,
      entries: {
        ...currentBucket.entries,
        [key]: {
          anchor: { ...currentAnchor },
          value: { ...existing, segments: [...existing.segments.slice(0, -1), updated], updatedAt: at },
          updatedAt: at,
        },
      },
    };
    try {
      hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = candidate;
      await saveChatToHostStrict_ACU();
      resolveCurrentWorldSimulationAnchor_ACU(currentAnchor, messages);
    } catch (error) {
      hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = previous;
      throw error;
    }
    return true;
  });
}
