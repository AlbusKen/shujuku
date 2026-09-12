import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationAgentName_ACU, type WorldSimulationSwipeIdentity_ACU } from './model';
import { resolveActiveWorldSimulationSwipe_ACU } from './simulation-swipe';

export const WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU = '_qrf_world_simulation_agent_chat';
export type WorldSimulationConversationKind_ACU = 'user' | 'plan' | 'delegation' | 'commit' | 'queued' | 'error';
export type WorldSimulationConversationStatus_ACU = 'pending' | 'running' | 'done' | 'failed';
export interface WorldSimulationConversationMessage_ACU { id: number; at: number; kind: WorldSimulationConversationKind_ACU; status: WorldSimulationConversationStatus_ACU; title: string; detail: string; requestId?: string; agentName?: WorldSimulationAgentName_ACU; }
export interface WorldSimulationConversationAppend_ACU extends Omit<WorldSimulationConversationMessage_ACU, 'id' | 'at'> {}
export interface WorldSimulationConversationRef_ACU { messageIndex: number; swipe: WorldSimulationSwipeIdentity_ACU; id: number; text: string; }
/**
 * Conversation history follows a selected swipe page, not the ledger's body hash. A successful
 * projection commit necessarily changes that hash while remaining on the same user-visible page.
 */
export interface WorldSimulationConversationSwipeLocation_ACU { messageIndex: number; messageKey: string; swipeIndex: number; }
interface ConversationEntry_ACU { swipe: WorldSimulationSwipeIdentity_ACU; nextId: number; messages: WorldSimulationConversationMessage_ACU[]; }
interface ConversationEnvelope_ACU { version: 1; entries: ConversationEntry_ACU[]; }

const KINDS: readonly WorldSimulationConversationKind_ACU[] = ['user', 'plan', 'delegation', 'commit', 'queued', 'error'];
const STATUSES: readonly WorldSimulationConversationStatus_ACU[] = ['pending', 'running', 'done', 'failed'];
const AGENT_NAMES: readonly WorldSimulationAgentName_ACU[] = ['world-director', 'entity-movement', 'faction-events', 'thread-weaver'];
const listeners = new Set<() => void>();
function notify(): void { for (const listener of listeners) { try { listener(); } catch (_) {} } }
export function subscribeWorldSimulationConversation_ACU(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => allowed.has(key));
}
export function sameWorldSimulationConversationSwipeLocation_ACU(
  left: WorldSimulationConversationSwipeLocation_ACU,
  right: WorldSimulationConversationSwipeLocation_ACU,
): boolean { return left.messageIndex === right.messageIndex && left.messageKey === right.messageKey && left.swipeIndex === right.swipeIndex; }
function sameSwipeLocation(left: WorldSimulationSwipeIdentity_ACU, right: WorldSimulationSwipeIdentity_ACU): boolean {
  return sameWorldSimulationConversationSwipeLocation_ACU(left, right);
}
function fail(message: string): never { throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_PROTOCOL_INVALID', 'persist', message, false)); }
function validMessage(value: unknown): value is WorldSimulationConversationMessage_ACU {
  return record(value) && exactKeys(value, ['id', 'at', 'kind', 'status', 'title', 'detail'], ['requestId', 'agentName'])
    && Number.isInteger(value.id) && (value.id as number) > 0 && Number.isFinite(value.at) && (value.at as number) >= 0
    && KINDS.includes(value.kind as WorldSimulationConversationKind_ACU) && STATUSES.includes(value.status as WorldSimulationConversationStatus_ACU)
    && typeof value.title === 'string' && value.title.trim().length > 0 && typeof value.detail === 'string' && value.detail.trim().length > 0
    && (value.requestId === undefined || (typeof value.requestId === 'string' && value.requestId.trim().length > 0))
    && (value.agentName === undefined || AGENT_NAMES.includes(value.agentName as WorldSimulationAgentName_ACU));
}
function validSwipe(value: unknown): value is WorldSimulationSwipeIdentity_ACU {
  return record(value) && exactKeys(value, ['messageIndex', 'messageKey', 'swipeIndex', 'baseTextHash'])
    && Number.isInteger(value.messageIndex) && (value.messageIndex as number) >= 0
    && Number.isInteger(value.swipeIndex) && (value.swipeIndex as number) >= 0
    && typeof value.messageKey === 'string' && value.messageKey.trim().length > 0
    && typeof value.baseTextHash === 'string' && value.baseTextHash.trim().length > 0;
}
function parse(value: unknown): ConversationEnvelope_ACU | null {
  if (!record(value) || !exactKeys(value, ['version', 'entries']) || value.version !== 1 || !Array.isArray(value.entries)) return null;
  const entries: ConversationEntry_ACU[] = [];
  const locations = new Set<string>();
  for (const raw of value.entries) {
    if (!record(raw) || !exactKeys(raw, ['swipe', 'nextId', 'messages']) || !validSwipe(raw.swipe)
      || !Number.isInteger(raw.nextId) || (raw.nextId as number) < 1 || !Array.isArray(raw.messages) || !raw.messages.every(validMessage)) return null;
    const location = `${raw.swipe.messageIndex}|${raw.swipe.messageKey}|${raw.swipe.swipeIndex}`;
    if (locations.has(location)) return null;
    locations.add(location);
    const messages = raw.messages.map(item => ({ ...item }));
    const ids = new Set(messages.map(item => item.id));
    const highest = messages.reduce((max, item) => Math.max(max, item.id), 0);
    if (ids.size !== messages.length || (raw.nextId as number) <= highest) return null;
    entries.push({ swipe: { ...raw.swipe }, nextId: raw.nextId as number, messages });
  }
  return { version: 1, entries };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function entryFor(message: Record<string, unknown>, index: number): { active: ReturnType<typeof resolveActiveWorldSimulationSwipe_ACU>; envelope: ConversationEnvelope_ACU } { const active = resolveActiveWorldSimulationSwipe_ACU(index, message); const existing = message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU]; const envelope = existing === undefined ? { version: 1 as const, entries: [] } : parse(existing); if (!envelope) fail('世界推演 Agent 会话记录格式非法'); return { active, envelope }; }

export interface WorldSimulationConversationTimeline_ACU {
  messages: WorldSimulationConversationMessage_ACU[];
  invalidMessageIndexes: number[];
}

/** A damaged non-authoritative envelope is isolated to its host floor and never blocks other swipes. */
export function readWorldSimulationConversationTimelineWithDiagnostics_ACU(chat: any[] = getChatArray_ACU()): WorldSimulationConversationTimeline_ACU {
  const result: WorldSimulationConversationMessage_ACU[] = [];
  const invalidMessageIndexes: number[] = [];
  if (!Array.isArray(chat)) return { messages: result, invalidMessageIndexes };
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!record(message) || message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] === undefined) continue;
    try {
      const { active, envelope } = entryFor(message, index);
      const entry = envelope.entries.find(item => sameSwipeLocation(item.swipe, active.identity));
      if (entry) result.push(...entry.messages.map(item => ({ ...item })));
    } catch (_) { invalidMessageIndexes.push(index); }
  }
  return { messages: result, invalidMessageIndexes };
}
export function readWorldSimulationConversationTimeline_ACU(chat: any[] = getChatArray_ACU()): WorldSimulationConversationMessage_ACU[] { return readWorldSimulationConversationTimelineWithDiagnostics_ACU(chat).messages; }

function normalizeAppend(item: WorldSimulationConversationAppend_ACU): Omit<WorldSimulationConversationMessage_ACU, 'id' | 'at'> | null {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const detail = typeof item.detail === 'string' ? item.detail.trim().slice(0, 4_000) : '';
  if (!KINDS.includes(item.kind) || !STATUSES.includes(item.status) || !title || !detail) return null;
  return {
    kind: item.kind, status: item.status, title, detail,
    ...(typeof item.requestId === 'string' && item.requestId.trim() ? { requestId: item.requestId.trim() } : {}),
    ...(item.agentName && AGENT_NAMES.includes(item.agentName) ? { agentName: item.agentName } : {}),
  };
}

export async function appendWorldSimulationConversation_ACU(
  targetIndex: number,
  appends: readonly WorldSimulationConversationAppend_ACU[],
  chat: any[] = getChatArray_ACU(),
): Promise<WorldSimulationConversationMessage_ACU[]> {
  if (!Array.isArray(chat) || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= chat.length || !record(chat[targetIndex])) {
    fail('世界推演会话目标 AI 楼层不可用');
  }
  const usable = appends.flatMap(item => {
    const normalized = normalizeAppend(item);
    return normalized ? [normalized] : [];
  });
  if (!usable.length) return [];
  const message = chat[targetIndex] as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(message, WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU);
  const previous = message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU];
  const { active, envelope } = entryFor(message, targetIndex);
  let entry = envelope.entries.find(item => sameSwipeLocation(item.swipe, active.identity));
  if (!entry) {
    entry = { swipe: { ...active.identity }, nextId: 1, messages: [] };
    envelope.entries.push(entry);
  }
  const added = usable.map(item => ({ ...item, id: entry!.nextId++, at: Date.now() }));
  try {
    entry.messages.push(...added);
    message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] = clone(envelope);
    await saveChatToHostStrict_ACU();
    notify();
    return added;
  } catch (error) {
    if (had) message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] = previous;
    else delete message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU];
    throw error;
  }
}



async function writeEnvelope_ACU(message: Record<string, unknown>, envelope: ConversationEnvelope_ACU): Promise<void> {
  const had = Object.prototype.hasOwnProperty.call(message, WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU);
  const previous = message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU];
  if (!parse(envelope)) fail('世界推演 Agent 会话更新后的格式非法');
  try {
    message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] = clone(envelope);
    await saveChatToHostStrict_ACU();
  } catch (error) {
    if (had) message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] = previous;
    else delete message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU];
    throw error;
  }
}

export function readLatestPendingWorldSimulationInstruction_ACU(chat: any[] = getChatArray_ACU()): WorldSimulationConversationRef_ACU | null {
  let latest: (WorldSimulationConversationRef_ACU & { at: number }) | null = null;
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!record(message) || message[WORLD_SIMULATION_AGENT_CONVERSATION_FIELD_ACU] === undefined) continue;
    try {
      const { active, envelope } = entryFor(message, index);
      const entry = envelope.entries.find(item => sameSwipeLocation(item.swipe, active.identity));
      for (const item of entry?.messages ?? []) {
        if (item.kind === 'user' && item.status === 'pending' && (!latest || item.at >= latest.at)) {
          latest = { messageIndex: index, swipe: { ...active.identity }, id: item.id, text: item.detail, at: item.at };
        }
      }
    } catch (_) { /* A non-authoritative damaged floor cannot block requests from valid floors. */ }
  }
  return latest && { messageIndex: latest.messageIndex, swipe: latest.swipe, id: latest.id, text: latest.text };
}

export async function updateWorldSimulationConversationStatus_ACU(
  ref: WorldSimulationConversationRef_ACU,
  status: WorldSimulationConversationStatus_ACU,
  detail?: string,
  chat: any[] = getChatArray_ACU(),
): Promise<void> {
  if (!STATUSES.includes(status)) fail('世界推演会话状态非法');
  const message = chat[ref.messageIndex];
  if (!record(message)) fail('世界推演会话来源楼层已不存在');
  const { active, envelope } = entryFor(message, ref.messageIndex);
  if (!sameSwipeLocation(active.identity, ref.swipe)) fail('世界推演会话来源 swipe 已变化');
  const entry = envelope.entries.find(item => sameSwipeLocation(item.swipe, ref.swipe));
  const item = entry?.messages.find(candidate => candidate.id === ref.id);
  if (!item) fail('世界推演会话请求已不存在');
  item.status = status;
  if (detail !== undefined) {
    const nextDetail = detail.trim().slice(0, 4_000);
    if (!nextDetail) fail('世界推演会话状态详情不能为空');
    item.detail = nextDetail;
  }
  await writeEnvelope_ACU(message, envelope);
  notify();
}
