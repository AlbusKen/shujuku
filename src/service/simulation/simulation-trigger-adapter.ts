import { countAiMessages_ACU, isAiMessage_ACU, resolveGeneratedAiMessageIndex_ACU, type AutoFillIntent_ACU } from '../runtime/message-handler';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { WorldSimulationRunIdentity_ACU } from './model';
import { resolveWorldSimulationAnchor_ACU } from './simulation-store';
import type { WorldSimulationAnchorIdentity_ACU } from './agent/agent-model';

export type WorldSimulationTriggerResolution_ACU =
  | { kind: 'resolved'; anchor: WorldSimulationAnchorIdentity_ACU }
  | { kind: 'blocked'; reason: 'chat_changed' | 'ambiguous' | 'not_materialized' | 'invalid_intent' | 'no_assistant' };
export interface WorldSimulationTriggerDependencies_ACU {
  getChat(): any[];
  delay(ms: number): Promise<void>;
  maxRetries?: number;
  retryDelayMs?: number;
  settleRetries?: number;
  settleDelayMs?: number;
}
const defaults_ACU: Pick<WorldSimulationTriggerDependencies_ACU, 'delay'> = { delay: ms => new Promise(resolve => setTimeout(resolve, ms)) };
const SETTLE_RETRIES_DEFAULT_ACU = 4;
const SETTLE_DELAY_MS_DEFAULT_ACU = 500;

function readWorldSimulationSettleContent_ACU(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  return typeof record.mes === 'string' ? record.mes : typeof record.message === 'string' ? record.message : '';
}

function readWorldSimulationSettleSample_ACU(message: unknown): { ready: true; swipeId: string; digest: string } | { ready: false } {
  if (!message || typeof message !== 'object') return { ready: false };
  const record = message as Record<string, unknown>;
  const content = readWorldSimulationSettleContent_ACU(record);
  const swipeId = record.swipe_id;
  if (!content || typeof swipeId !== 'number' || !Number.isInteger(swipeId) || swipeId < 0) return { ready: false };
  return { ready: true, swipeId: String(swipeId), digest: sha256HexSync_ACU(content) };
}

async function waitForWorldSimulationAnchorSettle_ACU(
  messageIndex: number,
  chatIdentity: string,
  dependencies: WorldSimulationTriggerDependencies_ACU,
): Promise<WorldSimulationTriggerResolution_ACU> {
  const delayFn = dependencies.delay ?? defaults_ACU.delay;
  const settleRetries = dependencies.settleRetries ?? SETTLE_RETRIES_DEFAULT_ACU;
  const settleDelay = dependencies.settleDelayMs ?? SETTLE_DELAY_MS_DEFAULT_ACU;
  let previous: { swipeId: string; digest: string } | null = null;
  for (let attempt = 0; attempt <= settleRetries; attempt += 1) {
    const chat = dependencies.getChat();
    if (getActiveChatStorageIdentity_ACU(chat) !== chatIdentity) return { kind: 'blocked', reason: 'chat_changed' };
    const sample = readWorldSimulationSettleSample_ACU(chat[messageIndex]);
    if (sample.ready) {
      if (previous && previous.swipeId === sample.swipeId && previous.digest === sample.digest) {
        return { kind: 'resolved', anchor: resolveWorldSimulationAnchor_ACU(messageIndex, chat) };
      }
      previous = { swipeId: sample.swipeId, digest: sample.digest };
    } else {
      previous = null;
    }
    if (attempt < settleRetries) await delayFn(settleDelay);
  }
  return { kind: 'blocked', reason: 'not_materialized' };
}

export function createWorldSimulationCompletionIntent_ACU(eventMessageId: number, chatKey: string, isolationKey: string, chat: any[], generationSeq?: number): AutoFillIntent_ACU {
  return {
    eventMessageId, chatKey, isolationKey, capturedAt: Date.now(), capturedChatLength: chat.length,
    capturedAiFloorCount: countAiMessages_ACU(chat), ...(generationSeq === undefined ? {} : { generationSeq }),
  };
}
export async function resolveWorldSimulationAssistantCompletion_ACU(
  intent: AutoFillIntent_ACU,
  dependencies: WorldSimulationTriggerDependencies_ACU,
): Promise<WorldSimulationTriggerResolution_ACU> {
  const captured = dependencies.getChat();
  const chatIdentity = getActiveChatStorageIdentity_ACU(captured);
  if (!chatIdentity) return { kind: 'blocked', reason: 'invalid_intent' };
  const maxRetries = dependencies.maxRetries ?? 5;
  const retryDelay = dependencies.retryDelayMs ?? 50;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const chat = dependencies.getChat();
    if (getActiveChatStorageIdentity_ACU(chat) !== chatIdentity) return { kind: 'blocked', reason: 'chat_changed' };
    const result = resolveGeneratedAiMessageIndex_ACU({ liveChat: chat, intent });
    if (result.kind === 'resolved') {
      if (!isAiMessage_ACU(chat[result.messageIndex])) return { kind: 'blocked', reason: 'invalid_intent' };
      return waitForWorldSimulationAnchorSettle_ACU(result.messageIndex, chatIdentity, dependencies);
    }
    if (result.kind === 'ambiguous') return { kind: 'blocked', reason: 'ambiguous' };
    if (result.kind === 'invalid_intent') return { kind: 'blocked', reason: 'invalid_intent' };
    if (attempt < maxRetries) await (dependencies.delay ?? defaults_ACU.delay)(retryDelay);
  }
  // 原地重新生成不新增楼层：捕获长度与 AI 数都没变，intent 的候选区间必然为空；宿主若同时换掉
  // message_id，事件携带的旧 id 也命中不了，于是上面每一轮都只能拿到 pending_materialization。
  // 这种情形下回退到当前最新 assistant 楼层，让重新生成后的正文能接着推演；若它其实就是上一轮
  // 已结算的同一楼层，orchestrator 会按锚点四元组判重跳过，不会重复跑。
  const settled = dependencies.getChat();
  if (getActiveChatStorageIdentity_ACU(settled) !== chatIdentity) return { kind: 'blocked', reason: 'chat_changed' };
  const latest = resolveLatestWorldSimulationAssistant_ACU(settled);
  if (latest.kind !== 'resolved') return { kind: 'blocked', reason: 'not_materialized' };
  return waitForWorldSimulationAnchorSettle_ACU(latest.anchor.messageIndex, chatIdentity, dependencies);
}
export function resolveLatestWorldSimulationAssistant_ACU(chat: any[]): WorldSimulationTriggerResolution_ACU {
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    if (isAiMessage_ACU(chat[index])) return { kind: 'resolved', anchor: resolveWorldSimulationAnchor_ACU(index, chat) };
  }
  return { kind: 'blocked', reason: 'no_assistant' };
}

export function restoreWorldSimulationAnchor_ACU(
  identity: WorldSimulationRunIdentity_ACU,
  chat: any[],
): WorldSimulationAnchorIdentity_ACU {
  for (let index = 0; index < chat.length; index += 1) {
    if (!isAiMessage_ACU(chat[index])) continue;
    const anchor = resolveWorldSimulationAnchor_ACU(index, chat);
    if (anchor.chatIdentity === identity.chatIdentity
      && anchor.messageKey === identity.anchorMessageKey
      && anchor.swipeId === identity.anchorSwipeId
      && anchor.contentDigest === identity.anchorContentDigest) return anchor;
  }
  throw new Error('WORLD_SIMULATION_ANCHOR_STALE');
}
