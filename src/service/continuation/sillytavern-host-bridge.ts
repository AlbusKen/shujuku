import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import type { ContinuationOrchestrator_ACU } from './continuation-orchestrator';
import { ContinuationHostGenerationBridge_ACU } from './host-generation-bridge';
import { SillyTavernHostTurnAdapter_ACU } from './host-turn-adapter';

/**
 * Production host composition for a continuation orchestrator.
 * Registration is intentionally explicit: no UI or bootstrap path may create a
 * second concurrent continuation dispatcher by importing this module.
 */
export function createSillyTavernContinuationHostBridge_ACU(
  orchestrator: Pick<ContinuationOrchestrator_ACU, 'readPendingHostTurn' | 'readAutoContinueState' | 'recordHostTurn' | 'bindHostTurnGeneration' | 'confirmCurrentTurn' | 'rejectHostTurnForMissingTags' | 'rejectHostTurnForShortGeneration' | 'rejectHostTurnForFailedGeneration' | 'pauseForHostInputFailure' | 'pauseForHostResultFailure' | 'failHostTurnForStoppedGeneration' | 'retryCurrentTurn' | 'continueTask'>,
): ContinuationHostGenerationBridge_ACU {
  const getChat = (): any[] => Array.isArray(SillyTavern_API_ACU?.chat) ? SillyTavern_API_ACU.chat as any[] : [];
  const getChatIdentity = (): string => String(getActiveChatStorageIdentity_ACU(getChat()) ?? '');
  return new ContinuationHostGenerationBridge_ACU({
    runtime: {
      getChatIdentity,
      getChat,
      getGenerationSequence: () => 0,
      readPendingHostTurn: () => orchestrator.readPendingHostTurn(),
      retryCurrentTurn: () => orchestrator.retryCurrentTurn(),
      readAutoContinueState: () => orchestrator.readAutoContinueState(),
      continueTask: () => orchestrator.continueTask(),
      recordHostTurn: input => orchestrator.recordHostTurn(input),
      bindHostTurnGeneration: (identity, generationSeq) => orchestrator.bindHostTurnGeneration(identity, generationSeq),
      confirmCurrentTurn: (identity, messageIndex) => orchestrator.confirmCurrentTurn(identity, messageIndex),
      rejectHostTurnForMissingTags: input => orchestrator.rejectHostTurnForMissingTags(input),
      rejectHostTurnForShortGeneration: input => orchestrator.rejectHostTurnForShortGeneration(input),
      rejectHostTurnForFailedGeneration: identity => orchestrator.rejectHostTurnForFailedGeneration(identity),
      pauseForHostInputFailure: identity => orchestrator.pauseForHostInputFailure(identity),
      pauseForHostResultFailure: identity => orchestrator.pauseForHostResultFailure(identity),
      failHostTurnForStoppedGeneration: identity => orchestrator.failHostTurnForStoppedGeneration(identity),
    },
    hostInput: new SillyTavernHostTurnAdapter_ACU(),
    now: () => Date.now(),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    materializationRetries: 3,
    materializationRetryDelayMs: 100,
  });
}
