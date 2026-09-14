import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { parseOptionalAgentRequirementSnapshot_ACU, replaceAgentRequirementsSnapshot_ACU } from '../agent-kernel/requirements-store';
import type { AgentRequirementSnapshot_ACU } from '../agent-kernel/requirements';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationSwipeIdentity_ACU } from './model';
import { resolveActiveWorldSimulationSwipe_ACU, sameWorldSimulationSwipeIdentity_ACU } from './simulation-swipe';

export const WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU = '_qrf_world_simulation_requirements';
const VERSION = 1 as const;
type Entry = { messageIndex: number; messageKey: string; swipeIndex: number; snapshot: AgentRequirementSnapshot_ACU };
type Envelope = { version: typeof VERSION; entries: Entry[] };
type WriteContext = { chat: any[]; chatIdentity: string; targetIndex: number; message: Record<string, unknown>; swipe: WorldSimulationSwipeIdentity_ACU };
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fail(code: 'WORLD_SIM_PROTOCOL_INVALID' | 'WORLD_SIM_STALE' | 'WORLD_SIM_PERSIST_FAILED', message: string, details?: Record<string, unknown>): never { throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'persist', message, false, details)); }
function same(entry: Entry, active: { messageIndex: number; messageKey: string; swipeIndex: number }): boolean { return entry.messageIndex === active.messageIndex && entry.messageKey === active.messageKey && entry.swipeIndex === active.swipeIndex; }
function parse(raw: unknown): Envelope | null {
  if (!record(raw) || raw.version !== VERSION || !Array.isArray(raw.entries)) return null;
  const locations = new Set<string>(); const entries: Entry[] = [];
  for (const item of raw.entries) {
    if (!record(item) || Object.keys(item).sort().join(',') !== 'messageIndex,messageKey,snapshot,swipeIndex'
      || !Number.isInteger(item.messageIndex) || (item.messageIndex as number) < 0 || typeof item.messageKey !== 'string' || !item.messageKey.trim()
      || !Number.isInteger(item.swipeIndex) || (item.swipeIndex as number) < 0) return null;
    const snapshot = parseOptionalAgentRequirementSnapshot_ACU(item.snapshot, 'world-simulation');
    if (!snapshot) return null;
    const entry: Entry = { messageIndex: item.messageIndex as number, messageKey: item.messageKey.trim(), swipeIndex: item.swipeIndex as number, snapshot };
    const key = `${entry.messageIndex}|${entry.messageKey}|${entry.swipeIndex}`;
    if (locations.has(key)) return null; locations.add(key); entries.push(entry);
  }
  return { version: VERSION, entries };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function sourceId(index: number, key: string, swipe: number, conversationId: number): string { return `world-simulation-user:${index}:${key}:${swipe}:${conversationId}`; }
function restoreSidecar(message: Record<string, unknown>, had: boolean, previous: unknown): void {
  if (had) message[WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU] = previous;
  else delete message[WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU];
}
function queueKey(context: WriteContext): string | any[] {
  return context.chatIdentity === '__host_without_chat_id__' ? context.chat : context.chatIdentity;
}

function captureWriteContext(targetIndex: number, chat: any[]): WriteContext {
  if (getChatArray_ACU() !== chat) fail('WORLD_SIM_STALE', '世界推演要求资料写入前聊天已切换');
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  const message = chat[targetIndex];
  if (!chatIdentity || !record(message)) fail('WORLD_SIM_STALE', '世界推演要求资料目标聊天或楼层不可用');
  const active = resolveActiveWorldSimulationSwipe_ACU(targetIndex, message);
  return { chat, chatIdentity, targetIndex, message, swipe: active.identity };
}

function sameTargetChatContext(context: WriteContext): boolean {
  const activeChat = getChatArray_ACU();
  return activeChat === context.chat
    && getActiveChatStorageIdentity_ACU(activeChat) === context.chatIdentity
    && activeChat[context.targetIndex] === context.message;
}

function assertCurrentWriteContext(context: WriteContext): void {
  if (!sameTargetChatContext(context)) fail('WORLD_SIM_STALE', '世界推演要求资料写入时聊天或目标楼层已切换');
  try {
    const active = resolveActiveWorldSimulationSwipe_ACU(context.targetIndex, context.message);
    if (!sameWorldSimulationSwipeIdentity_ACU(active.identity, context.swipe)) {
      fail('WORLD_SIM_STALE', '世界推演要求资料目标 swipe 或正文基底已变化');
    }
  } catch (error) {
    if (error instanceof WorldSimulationValidationError_ACU) throw error;
    fail('WORLD_SIM_STALE', '世界推演要求资料目标 swipe 不可用');
  }
}

function userSourceIdsForActive(message: Record<string, unknown>, active: WorldSimulationSwipeIdentity_ACU): string[] {
  const conversation = message['_qrf_world_simulation_agent_chat'];
  if (conversation === undefined) return [];
  if (!record(conversation) || conversation.version !== 1 || !Array.isArray(conversation.entries)) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演 Agent 会话记录格式非法');
  const entry = conversation.entries.find((item: unknown) => record(item) && record(item.swipe)
    && item.swipe.messageIndex === active.messageIndex && item.swipe.messageKey === active.messageKey && item.swipe.swipeIndex === active.swipeIndex);
  if (!entry || !Array.isArray(entry.messages)) return [];
  return entry.messages.filter((item: any) => item?.kind === 'user' && Number.isInteger(item.id) && item.id > 0)
    .map((item: any) => sourceId(active.messageIndex, active.messageKey, active.swipeIndex, item.id));
}

/** Per-active-swipe requirements sidecar; deliberately independent from world ledger/projection commits. */
export class WorldSimulationRequirementsStore_ACU {
  private static writeTailsByChatIdentity_ACU = new Map<string | any[], Promise<void>>();

  read(targetIndex: number, chat: any[] = getChatArray_ACU()): AgentRequirementSnapshot_ACU | null {
    const message = chat[targetIndex]; if (!record(message)) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演要求资料目标楼层不可用');
    const active = resolveActiveWorldSimulationSwipe_ACU(targetIndex, message).identity;
    const raw = message[WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU]; if (raw === undefined) return null;
    const envelope = parse(raw); if (!envelope) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演要求资料格式非法');
    return envelope.entries.find(entry => same(entry, active))?.snapshot ?? null;
  }
  userSourceIds(targetIndex: number, chat: any[] = getChatArray_ACU()): string[] {
    const message = chat[targetIndex]; if (!record(message)) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演要求资料目标楼层不可用');
    const active = resolveActiveWorldSimulationSwipe_ACU(targetIndex, message).identity;
    return userSourceIdsForActive(message, active);
  }
  pendingSourceIds(targetIndex: number, chat: any[] = getChatArray_ACU()): string[] {
    const sourceIds = this.userSourceIds(targetIndex, chat);
    const last = this.read(targetIndex, chat)?.lastAppliedUserMessageId;
    if (last === null || last === undefined) return sourceIds;
    const position = sourceIds.indexOf(last);
    if (position < 0) fail('WORLD_SIM_PROTOCOL_INVALID', '最近已吸收的世界推演用户输入不在当前 active swipe 会话中');
    return sourceIds.slice(position + 1);
  }
  async replace(targetIndex: number, rawReplacement: unknown, chat: any[] = getChatArray_ACU()): Promise<AgentRequirementSnapshot_ACU> {
    const context = captureWriteContext(targetIndex, chat);
    return this.enqueueWrite(context, () => this.replaceWithinQueue(rawReplacement, context));
  }

  private async replaceWithinQueue(rawReplacement: unknown, context: WriteContext): Promise<AgentRequirementSnapshot_ACU> {
    assertCurrentWriteContext(context);
    const message = context.message;
    const active = context.swipe;
    const known = userSourceIdsForActive(message, active);
    const had = Object.prototype.hasOwnProperty.call(message, WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU);
    const previous = message[WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU];
    const envelope = previous === undefined ? { version: VERSION, entries: [] } : parse(previous); if (!envelope) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演要求资料格式非法');
    const index = envelope.entries.findIndex(entry => same(entry, active));
    const current = index < 0 ? null : envelope.entries[index].snapshot;
    const next = replaceAgentRequirementsSnapshot_ACU(current, 'world-simulation', rawReplacement, known);
    const updated: Envelope = clone(envelope); const entry: Entry = { messageIndex: active.messageIndex, messageKey: active.messageKey, swipeIndex: active.swipeIndex, snapshot: next };
    if (index < 0) updated.entries.push(entry); else updated.entries[index] = entry;
    let saveAttempted = false;
    try {
      message[WORLD_SIMULATION_REQUIREMENTS_FIELD_ACU] = updated;
      assertCurrentWriteContext(context);
      saveAttempted = true;
      await saveChatToHostStrict_ACU();
      assertCurrentWriteContext(context);
      return next;
    } catch (error) {
      restoreSidecar(message, had, previous);
      // 即使 active swipe 已漂移，只要原聊天和原楼层仍活跃，也要持久化回滚，避免旧正文基底
      // 的 requirements sidecar 留在新分支可见的消息对象上；聊天已切换则绝不跨聊天回写。
      const stillCurrent = sameTargetChatContext(context);
      if (saveAttempted && !stillCurrent) {
        fail('WORLD_SIM_PERSIST_FAILED', '世界推演要求资料保存期间聊天已切换，原聊天持久化状态未知', {
          primaryMessage: error instanceof Error ? error.message : String(error),
          persistenceState: 'unknown',
          rollbackAttempted: false,
        });
      }
      if (saveAttempted && stillCurrent) {
        try { await saveChatToHostStrict_ACU(); }
        catch (rollbackError) {
          fail('WORLD_SIM_PERSIST_FAILED', '世界推演要求资料保存与回滚均失败', {
            primaryMessage: error instanceof Error ? error.message : String(error),
            rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      fail('WORLD_SIM_PERSIST_FAILED', '世界推演要求资料保存失败', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private enqueueWrite(context: WriteContext, operation: () => Promise<AgentRequirementSnapshot_ACU>): Promise<AgentRequirementSnapshot_ACU> {
    const key = queueKey(context);
    const previous = WorldSimulationRequirementsStore_ACU.writeTailsByChatIdentity_ACU.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled: Promise<void> = result.then((): void => undefined, (): void => undefined);
    WorldSimulationRequirementsStore_ACU.writeTailsByChatIdentity_ACU.set(key, settled);
    void settled.finally(() => {
      if (WorldSimulationRequirementsStore_ACU.writeTailsByChatIdentity_ACU.get(key) === settled) {
        WorldSimulationRequirementsStore_ACU.writeTailsByChatIdentity_ACU.delete(key);
      }
    });
    return result;
  }
}