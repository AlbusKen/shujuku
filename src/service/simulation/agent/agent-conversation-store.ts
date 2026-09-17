import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import {
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
} from '../model';
import {
  readWorldSimulationBucketEntry_ACU,
  resolveWorldSimulationAnchor_ACU,
  writeWorldSimulationBucketEntry_ACU,
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

function collectSegments_ACU(chat?: any[]): { segments: WorldSimulationConversationSegment_ACU[]; diagnostics: string[] } {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const segments: WorldSimulationConversationSegment_ACU[] = [];
  const diagnostics: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isRecord_ACU(message) || message.is_user === true || message.is_system === true) continue;
    const anchor = resolveWorldSimulationAnchor_ACU(index, messages);
    try {
      const record = readWorldSimulationBucketEntry_ACU(
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
  const existing = readWorldSimulationBucketEntry_ACU(
    WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
    input.anchor,
    validateWorldSimulationConversationFloorRecord_ACU,
    messages,
  ) ?? { schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU, segments: [], updatedAt: 0 };
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
  await writeWorldSimulationBucketEntry_ACU(
    WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
    input.anchor,
    { ...existing, segments: [...existing.segments, segment], updatedAt: at },
    messages,
  );
  return true;
}
