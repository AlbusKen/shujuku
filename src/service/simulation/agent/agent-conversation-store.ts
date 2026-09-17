import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import {
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
} from '../model';
import {
  assertWorldSimulationAnchorCurrent_ACU,
  buildWorldSimulationBucketKey_ACU,
  readWorldSimulationBucketEntry_ACU,
  resolveWorldSimulationAnchor_ACU,
} from '../simulation-store';
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
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(WORLD_SIMULATION_MESSAGE_KINDS_ACU as readonly string[]).includes(kind)) {
    reject_ACU(`${path}.kind 非法`, { path: `${path}.kind` });
  }
  const message: WorldSimulationConversationMessage_ACU = {
    id: nonNegativeInteger_ACU(raw.id, `${path}.id`),
    kind: kind as WorldSimulationConversationMessage_ACU['kind'],
    text: requiredText_ACU(raw.text, `${path}.text`),
    digest: typeof raw.digest === 'string' ? raw.digest : '',
    turnKey: typeof raw.turnKey === 'string' ? raw.turnKey : '',
    at: nonNegativeInteger_ACU(raw.at, `${path}.at`),
  };
  if (raw.readKey !== undefined) message.readKey = requiredText_ACU(raw.readKey, `${path}.readKey`);
  return message;
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

function truncateText_ACU(text: string): string {
  return text.length <= TEXT_LIMIT_ACU
    ? text
    : `${text.slice(0, TEXT_LIMIT_ACU)}\n（本条内容超出 ${TEXT_LIMIT_ACU} 字上限，已截断）`;
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
}

export async function appendWorldSimulationConversationSegment_ACU(
  input: AppendWorldSimulationConversationInput_ACU,
  chat?: any[],
): Promise<boolean> {
  const usable = input.appends.filter(item => String(item.text ?? '').trim());
  if (usable.length === 0) return false;
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const currentView = readWorldSimulationConversation_ACU(messages);
  let nextId = currentView.nextId;
  const at = Date.now();
  const added = usable.map(item => {
    const message: WorldSimulationConversationMessage_ACU = {
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
  const hostMessage = messages[input.anchor.messageIndex] as Record<string, unknown>;
  const previous = hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
  const migrated = previous === undefined ? null : migrateLegacyWorldSimulationConversationBucket_ACU(
    previous, hostMessage, input.anchor.chatIdentity, input.anchor.messageIndex,
  );
  let currentBucket: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>;
  if (previous === undefined) currentBucket = { schemaVersion: 1, entries: {} };
  else if (migrated) currentBucket = migrated;
  else if (isRecord_ACU(previous) && previous.schemaVersion === 1 && isRecord_ACU(previous.entries)) {
    currentBucket = previous as unknown as WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>;
  } else reject_ACU(`${WORLD_SIMULATION_CONVERSATION_FIELD_ACU} 分桶结构损坏`);
  const key = buildWorldSimulationBucketKey_ACU(input.anchor);
  const existing = currentBucket.entries[key]
    ? validateWorldSimulationConversationFloorRecord_ACU(currentBucket.entries[key].value)
    : { schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU, segments: [], updatedAt: 0 };
  if (existing.segments.some(segment => segment.segmentId === input.segmentId)) {
    reject_ACU('重复 segmentId，拒绝重复持久化', { segmentId: input.segmentId });
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
        anchor: { ...input.anchor },
        value: { ...existing, segments: [...existing.segments, segment], updatedAt: at },
        updatedAt: at,
      },
    },
  };
  try {
    assertWorldSimulationAnchorCurrent_ACU(input.anchor, messages);
    hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = candidate;
    await saveChatToHostStrict_ACU();
    assertWorldSimulationAnchorCurrent_ACU(input.anchor, messages);
  } catch (error) {
    if (previous === undefined) delete hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    else hostMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = previous;
    throw error;
  }
  return true;
}
