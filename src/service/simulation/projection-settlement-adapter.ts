import {
  createWorldSimError_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationSwipeIdentity_ACU,
  type WorldStateSnapshot_ACU,
} from './model';
import { renderWorldSimulationPublicDelta_ACU } from './simulation-public-delta';
import type { WorldSimulationRebaseResult_ACU } from './simulation-rebase';
import type {
  WorldSimulationProjectionCommitInput_ACU,
  WorldSimulationProjectionCommitResult_ACU,
} from './simulation-store';

export interface WorldSimulationProjectionSettlementContext_ACU {
  recordId: string;
  checkpointInterval: number;
  expectedReplayDigest: string | null;
  parentReplayDigest: string | null;
  swipe: WorldSimulationSwipeIdentity_ACU;
  expectedProjectionBlockHash: string | null;
}

export interface WorldSimulationProjectionSettlementInput_ACU {
  before: WorldStateSnapshot_ACU;
  rebase: WorldSimulationRebaseResult_ACU;
  context: WorldSimulationProjectionSettlementContext_ACU;
}

export type WorldSimulationProjectionCommitter_ACU = (input: WorldSimulationProjectionCommitInput_ACU) => Promise<WorldSimulationProjectionCommitResult_ACU>;

function fail_ACU(message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_REBASE_REJECTED', 'rebase', message, false));
}

/** Maps one verified r6 result to the complete r4 joint-commit input. */
export function createWorldSimulationProjectionSettlementAdapter_ACU(commit: WorldSimulationProjectionCommitter_ACU) {
  return async (input: WorldSimulationProjectionSettlementInput_ACU): Promise<WorldSimulationProjectionCommitResult_ACU> => {
    const { rebase, context } = input;
    if (typeof commit !== 'function' || !context || rebase.targetAnchorMessageIndex !== rebase.transaction.anchorMessageIndex
      || rebase.coverageStartMessageIndex > rebase.coverageEndMessageIndex
      || rebase.coverageEndMessageIndex !== rebase.targetAnchorMessageIndex
      || context.swipe.messageIndex !== rebase.targetAnchorMessageIndex) {
      fail_ACU('世界推演公开投影结算上下文与重锚定结果不一致');
    }
    const delta = renderWorldSimulationPublicDelta_ACU(input.before, rebase.transaction, rebase.state);
    return commit({
      anchorMessageIndex: rebase.targetAnchorMessageIndex,
      recordId: context.recordId,
      state: rebase.state,
      delta: {
        anchorMessageIndex: rebase.targetAnchorMessageIndex,
        storyClock: rebase.transaction.storyClock,
        entities: rebase.state.entities,
        events: rebase.state.events,
        threads: rebase.state.threads,
        revisions: rebase.state.revisions,
      },
      checkpointInterval: context.checkpointInterval,
      expectedReplayDigest: context.expectedReplayDigest,
      parentReplayDigest: context.parentReplayDigest,
      swipe: context.swipe,
      sourceAnchorMessageIndex: rebase.coverageStartMessageIndex,
      coverageStartMessageIndex: rebase.coverageStartMessageIndex,
      coverageEndMessageIndex: rebase.coverageEndMessageIndex,
      expectedProjectionBlockHash: context.expectedProjectionBlockHash,
      publicText: delta.text || null,
      publicEntryIds: delta.publicEntryIds,
    });
  };
}
