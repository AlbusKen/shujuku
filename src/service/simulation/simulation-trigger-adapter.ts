import { countAiMessages_ACU, isAiMessage_ACU, resolveGeneratedAiMessageIndex_ACU, type AutoFillIntent_ACU } from '../runtime/message-handler';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
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
}
const defaults_ACU: Pick<WorldSimulationTriggerDependencies_ACU, 'delay'> = { delay: ms => new Promise(resolve => setTimeout(resolve, ms)) };

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
      return { kind: 'resolved', anchor: resolveWorldSimulationAnchor_ACU(result.messageIndex, chat) };
    }
    if (result.kind === 'ambiguous') return { kind: 'blocked', reason: 'ambiguous' };
    if (result.kind === 'invalid_intent') return { kind: 'blocked', reason: 'invalid_intent' };
    if (attempt < maxRetries) await (dependencies.delay ?? defaults_ACU.delay)(retryDelay);
  }
  return { kind: 'blocked', reason: 'not_materialized' };
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
