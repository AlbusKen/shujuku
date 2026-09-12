import { emitMessageUpdated_ACU, getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { markWorldSimulationProjectionEmit_ACU } from './simulation-commit-guard';
import { readIsolatedDataContainer_ACU, writeIsolatedTagWorldSimulation_ACU } from '../../data/repositories/chat-message-data-repo';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
  createWorldSimError_ACU,
  isWorldStableId_ACU,
  isWorldStateSnapshot_ACU,
  WorldSimulationValidationError_ACU,
  type WorldSimulationLedgerRecord_ACU,
  type WorldSimulationPerSwipeEnvelope_ACU,
  type WorldSimulationSwipeIdentity_ACU,
  type WorldStateDelta_ACU,
  type WorldStateSnapshot_ACU,
} from './model';
import {
  applyWorldSimulationDelta_ACU,
  countWorldSimulationDeltasSinceCheckpoint_ACU,
  parseWorldSimulationLedgerRecord_ACU,
  replayWorldSimulationFromChat_ACU,
  type WorldSimulationReplay_ACU,
} from './simulation-replay';
import { parseWorldSimulationPerSwipeEnvelope_ACU } from './simulation-schema';
import { parseWorldSimulationProjection_ACU, renderWorldSimulationProjection_ACU } from './simulation-projection';
import { captureWorldSimulationSwipeSnapshot_ACU, restoreWorldSimulationSwipeSnapshot_ACU, writeWorldSimulationSwipeText_ACU } from './simulation-swipe';

export interface WorldSimulationStoreDependencies_ACU {
  getChat: () => any[];
  getChatIdentity: (chat: unknown[]) => string;
  getIsolationKey: () => string;
  saveChatStrict: () => Promise<void>;
  emitMessageUpdated?: (messageIndex: number) => void;
}

const defaultDependencies_ACU: WorldSimulationStoreDependencies_ACU = {
  // All host bindings are lazy on purpose: this store is reached by presentation and table import
  // chains whose tests may use deliberately narrow gateway mocks. A suite that never performs a
  // world-simulation commit must not need to mock unrelated host bindings at module evaluation.
  getChat: () => getChatArray_ACU(),
  getChatIdentity: (chat: unknown[]) => getActiveChatStorageIdentity_ACU(chat),
  getIsolationKey: () => getCurrentIsolationKey_ACU(),
  saveChatStrict: () => saveChatToHostStrict_ACU(),
  emitMessageUpdated: (messageIndex: number) => emitMessageUpdated_ACU(messageIndex),
};

type StoreContext_ACU = { chat: any[]; chatIdentity: string; isolationKey: string };

export interface WorldSimulationCommitInput_ACU {
  anchorMessageIndex: number;
  recordId: string;
  state: WorldStateSnapshot_ACU;
  delta?: WorldStateDelta_ACU;
  expectedReplayDigest?: string | null;
  checkpointInterval: number;
}

/** Joint v2 write: ledger entry and the active AI page's public projection share one save. */
export interface WorldSimulationProjectionCommitInput_ACU {
  anchorMessageIndex: number;
  recordId: string;
  state: WorldStateSnapshot_ACU;
  delta?: WorldStateDelta_ACU;
  checkpointInterval: number;
  expectedReplayDigest: string | null;
  parentReplayDigest: string | null;
  swipe: WorldSimulationSwipeIdentity_ACU;
  sourceAnchorMessageIndex: number;
  coverageStartMessageIndex: number;
  coverageEndMessageIndex: number;
  expectedProjectionBlockHash: string | null;
  /** null is a hidden-only ledger commit and owns no terminal public block. */
  publicText: string | null;
  publicEntryIds: readonly string[];
}

export interface WorldSimulationProjectionCommitResult_ACU {
  record: WorldSimulationLedgerRecord_ACU;
  projection: { blockHash: string; baseTextHash: string } | null;
}

function fail_ACU(code: 'WORLD_SIM_STALE' | 'WORLD_SIM_CONFLICT' | 'WORLD_SIM_PERSIST_FAILED', message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'persist', message, false, details));
}

function captureContext_ACU(deps: WorldSimulationStoreDependencies_ACU): StoreContext_ACU {
  const chat = deps.getChat();
  const chatIdentity = deps.getChatIdentity(chat);
  if (!Array.isArray(chat) || !chat.length || !chatIdentity) fail_ACU('WORLD_SIM_STALE', '当前聊天不可用于世界推演写入');
  return { chat, chatIdentity, isolationKey: deps.getIsolationKey() };
}

function sameContext_ACU(context: StoreContext_ACU, deps: WorldSimulationStoreDependencies_ACU): boolean {
  const chat = deps.getChat();
  return chat === context.chat
    && deps.getChatIdentity(chat) === context.chatIdentity
    && deps.getIsolationKey() === context.isolationKey;
}

function restoreIsolatedField_ACU(message: Record<string, unknown>, existed: boolean, value: unknown): void {
  if (existed) message.TavernDB_ACU_IsolatedData = value;
  else delete message.TavernDB_ACU_IsolatedData;
}

function validProjectionCommit_ACU(input: WorldSimulationProjectionCommitInput_ACU): boolean {
  return Number.isInteger(input.anchorMessageIndex) && input.anchorMessageIndex >= 0
    && typeof input.recordId === 'string' && !!input.recordId.trim()
    && isWorldStateSnapshot_ACU(input.state) && input.state.anchorMessageIndex === input.anchorMessageIndex
    && Number.isInteger(input.checkpointInterval) && input.checkpointInterval >= 1
    && (input.expectedReplayDigest === null || (typeof input.expectedReplayDigest === 'string' && !!input.expectedReplayDigest))
    && (input.parentReplayDigest === null || (typeof input.parentReplayDigest === 'string' && !!input.parentReplayDigest))
    && input.swipe && input.swipe.messageIndex === input.anchorMessageIndex
    && typeof input.swipe.messageKey === 'string' && !!input.swipe.messageKey.trim()
    && Number.isInteger(input.swipe.swipeIndex) && input.swipe.swipeIndex >= 0
    && typeof input.swipe.baseTextHash === 'string' && !!input.swipe.baseTextHash
    && Number.isInteger(input.sourceAnchorMessageIndex) && input.sourceAnchorMessageIndex >= 0
    && Number.isInteger(input.coverageStartMessageIndex) && input.coverageStartMessageIndex >= input.sourceAnchorMessageIndex
    && input.coverageEndMessageIndex === input.anchorMessageIndex
    && (input.expectedProjectionBlockHash === null || (typeof input.expectedProjectionBlockHash === 'string' && !!input.expectedProjectionBlockHash))
    && (input.publicText === null || (typeof input.publicText === 'string' && !!input.publicText.trim()))
    && Array.isArray(input.publicEntryIds) && input.publicEntryIds.every(isWorldStableId_ACU)
    && new Set(input.publicEntryIds).size === input.publicEntryIds.length
    && (input.publicText !== null || input.publicEntryIds.length === 0);
}

function sameSwipeLocation_ACU(left: WorldSimulationSwipeIdentity_ACU, right: WorldSimulationSwipeIdentity_ACU): boolean {
  return left.messageIndex === right.messageIndex
    && left.messageKey === right.messageKey
    && left.swipeIndex === right.swipeIndex;
}

function buildProjectionRecord_ACU(
  input: WorldSimulationProjectionCommitInput_ACU,
  priorReplay: WorldSimulationReplay_ACU | null,
): WorldSimulationLedgerRecord_ACU {
  if (!priorReplay || !input.delta || countWorldSimulationDeltasSinceCheckpoint_ACU(priorReplay) + 1 >= input.checkpointInterval) {
    return { version: 1, kind: 'checkpoint', id: input.recordId, anchorMessageIndex: input.anchorMessageIndex, state: { ...input.state, anchorMessageIndex: input.anchorMessageIndex } };
  }
  let predicted: WorldStateSnapshot_ACU;
  try {
    predicted = applyWorldSimulationDelta_ACU(priorReplay.state, { ...input.delta, anchorMessageIndex: input.anchorMessageIndex });
  } catch (error) {
    if (error instanceof WorldSimulationValidationError_ACU) {
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演候选 delta 未通过联合提交校验', { reason: error.error.message });
    }
    throw error;
  }
  const expected = { ...input.state, anchorMessageIndex: input.anchorMessageIndex };
  if (JSON.stringify(predicted) !== JSON.stringify(expected)) {
    fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合提交 delta 与待写快照不一致');
  }
  return { version: 1, kind: 'delta', id: input.recordId, anchorMessageIndex: input.anchorMessageIndex, delta: { ...input.delta, anchorMessageIndex: input.anchorMessageIndex } };
}


/** One-chat serialized writer for the worldSimulation slot. */
export class WorldSimulationStore_ACU {
  private static writeTailsByChatIdentity_ACU = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: WorldSimulationStoreDependencies_ACU = defaultDependencies_ACU) {}

  read(maxMessageIndex?: number): WorldSimulationReplay_ACU | null {
    const context = captureContext_ACU(this.dependencies);
    return replayWorldSimulationFromChat_ACU(context.chat, context.isolationKey, maxMessageIndex);
  }

  async commit(input: WorldSimulationCommitInput_ACU): Promise<WorldSimulationLedgerRecord_ACU> {
    return this.enqueueWrite_ACU(context => this.commitWithinQueue_ACU(input, context));
  }

  /** Atomically stages the active AI page projection and its v2 ledger envelope before one strict save. */
  async commitProjection(input: WorldSimulationProjectionCommitInput_ACU): Promise<WorldSimulationProjectionCommitResult_ACU> {
    return this.enqueueWrite_ACU(context => this.commitProjectionWithinQueue_ACU(input, context));
  }

  private async commitProjectionWithinQueue_ACU(input: WorldSimulationProjectionCommitInput_ACU, context: StoreContext_ACU): Promise<WorldSimulationProjectionCommitResult_ACU> {
    if (!sameContext_ACU(context, this.dependencies)) fail_ACU('WORLD_SIM_STALE', '世界推演联合提交前聊天已切换');
    if (!validProjectionCommit_ACU(input) || input.anchorMessageIndex >= context.chat.length) {
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合提交参数非法', { anchorMessageIndex: input.anchorMessageIndex });
    }
    const target = context.chat[input.anchorMessageIndex] as Record<string, unknown> | undefined;
    if (!target) fail_ACU('WORLD_SIM_STALE', '世界推演联合提交目标楼层不存在', { anchorMessageIndex: input.anchorMessageIndex });
    let snapshot;
    try {
      snapshot = captureWorldSimulationSwipeSnapshot_ACU(input.anchorMessageIndex, target);
    } catch (error) {
      if (error instanceof WorldSimulationValidationError_ACU) fail_ACU('WORLD_SIM_STALE', '世界推演联合提交目标 AI 页已变化', { reason: error.error.message });
      throw error;
    }
    const currentProjection = parseWorldSimulationProjection_ACU(snapshot.mes);
    const currentBaseText = currentProjection?.baseText ?? snapshot.mes;
    const currentBaseTextHash = currentProjection?.baseTextHash ?? snapshot.identity.baseTextHash;
    if (!sameSwipeLocation_ACU(snapshot.identity, input.swipe) || currentBaseTextHash !== input.swipe.baseTextHash) {
      fail_ACU('WORLD_SIM_STALE', '世界推演联合提交目标 swipe 或正文基底不匹配');
    }

    const currentReplay = replayWorldSimulationFromChat_ACU(context.chat, context.isolationKey);
    if (currentReplay?.branchReparsed) fail_ACU('WORLD_SIM_CONFLICT', '当前世界推演分支存在未结算后缀，拒绝联合提交');
    const actualDigest = currentReplay?.digest ?? null;
    if (actualDigest !== input.expectedReplayDigest) {
      fail_ACU('WORLD_SIM_CONFLICT', '世界推演回放摘要已变化，拒绝联合提交', { expected: input.expectedReplayDigest, actual: actualDigest });
    }

    const existingValue = readIsolatedDataContainer_ACU(target)?.[context.isolationKey]?.worldSimulation;
    const existingEnvelope = existingValue === undefined ? null : parseWorldSimulationPerSwipeEnvelope_ACU(existingValue);
    if (existingValue !== undefined && !existingEnvelope) {
      fail_ACU('WORLD_SIM_CONFLICT', '目标 AI 页已有非 per-swipe 世界推演账本，拒绝覆盖');
    }
    const existingEntry = existingEnvelope?.entries.find(entry => sameSwipeLocation_ACU(entry.swipe, input.swipe));
    if (existingEntry) {
      const existingProjectionMatches = existingEntry.projection === null
        ? currentProjection === null && input.expectedProjectionBlockHash === null
        : !!currentProjection
          && input.expectedProjectionBlockHash === currentProjection.blockHash
          && existingEntry.projection.blockHash === currentProjection.blockHash
          && existingEntry.projection.baseTextHash === currentBaseTextHash;
      if (!existingProjectionMatches || existingEntry.parentReplayDigest !== input.parentReplayDigest) {
        fail_ACU('WORLD_SIM_CONFLICT', '目标 AI 页的系统投影已被编辑或身份不匹配');
      }
    } else if (currentProjection || input.expectedProjectionBlockHash !== null) {
      fail_ACU('WORLD_SIM_CONFLICT', '目标 AI 页已有不可替换的世界推演投影');
    }

    const priorReplay = replayWorldSimulationFromChat_ACU(context.chat, context.isolationKey, input.anchorMessageIndex - 1);
    const priorDigest = priorReplay?.digest ?? null;
    if (input.parentReplayDigest !== priorDigest) {
      fail_ACU('WORLD_SIM_CONFLICT', '世界推演联合提交父回放摘要已变化', { expected: input.parentReplayDigest, actual: priorDigest });
    }
    if (currentReplay) {
      const activeReplayTip = currentReplay.deltaMessageIndices.length > 0
        ? currentReplay.deltaMessageIndices[currentReplay.deltaMessageIndices.length - 1]
        : currentReplay.checkpointMessageIndex;
      if (existingEntry ? activeReplayTip !== input.anchorMessageIndex : input.anchorMessageIndex <= activeReplayTip) {
        fail_ACU('WORLD_SIM_CONFLICT', '世界推演联合提交目标不处于合法回放末端', { anchorMessageIndex: input.anchorMessageIndex, activeReplayTip });
      }
    }
   const record = buildProjectionRecord_ACU(input, priorReplay);
    try {
      parseWorldSimulationLedgerRecord_ACU(record, input.anchorMessageIndex);
    } catch (error) {
      if (error instanceof WorldSimulationValidationError_ACU) fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合提交账本未通过校验', { reason: error.error.message });
      throw error;
    }
    const projection = input.publicText === null ? null : renderWorldSimulationProjection_ACU(currentBaseText, input.publicText);
    if ((input.publicText !== null && !projection) || (projection && projection.baseTextHash !== input.swipe.baseTextHash)) {
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演公开投影格式或正文基底非法');
    }
    const nextText = projection?.fullText ?? currentBaseText;
    const envelope: WorldSimulationPerSwipeEnvelope_ACU = {
      version: 2,
      kind: 'per_swipe',
      entries: [
        ...(existingEnvelope?.entries.filter(entry => !sameSwipeLocation_ACU(entry.swipe, input.swipe)) ?? []),
        {
          swipe: input.swipe,
          parentReplayDigest: input.parentReplayDigest,
          sourceAnchorMessageIndex: input.sourceAnchorMessageIndex,
          coverageStartMessageIndex: input.coverageStartMessageIndex,
          coverageEndMessageIndex: input.coverageEndMessageIndex,
          projection: projection ? { version: 1, blockHash: projection.blockHash, baseTextHash: projection.baseTextHash, publicEntryIds: [...input.publicEntryIds] } : null,
          record,
        },
      ],
    };
    if (!parseWorldSimulationPerSwipeEnvelope_ACU(envelope)) {
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合提交 per-swipe 账本非法');
    }

    let saveAttempted = false;
    try {
      writeIsolatedTagWorldSimulation_ACU(target, context.isolationKey, envelope);
      writeWorldSimulationSwipeText_ACU(snapshot, nextText);
      if (!sameContext_ACU(context, this.dependencies)) fail_ACU('WORLD_SIM_STALE', '世界推演联合写入后聊天已切换');
      saveAttempted = true;
      await this.dependencies.saveChatStrict();
      if (!sameContext_ACU(context, this.dependencies)) fail_ACU('WORLD_SIM_STALE', '世界推演联合保存后聊天已切换');
      try {
        // The repaint that follows a successful commit is OUR OWN event. Token it before emitting so
        // the MESSAGE_UPDATED invalidation listener cannot mistake it for a user edit and discard the
        // candidate this save just settled.
        markWorldSimulationProjectionEmit_ACU(input.anchorMessageIndex);
        this.dependencies.emitMessageUpdated?.(input.anchorMessageIndex);
      } catch (_) { /* Message refresh must not invalidate a completed save. */ }
      return { record, projection: projection ? { blockHash: projection.blockHash, baseTextHash: projection.baseTextHash } : null };
    } catch (error) {
      restoreWorldSimulationSwipeSnapshot_ACU(snapshot);
      const stillCurrent = sameContext_ACU(context, this.dependencies);
      if (saveAttempted && !stillCurrent) {
        fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合保存期间聊天已切换，原聊天持久化状态未知', {
          primaryMessage: error instanceof Error ? error.message : String(error), persistenceState: 'unknown', rollbackAttempted: false,
        });
      }
      if (saveAttempted && stillCurrent) {
        let rollbackError: unknown;
        try { await this.dependencies.saveChatStrict(); } catch (errorDuringRollback) { rollbackError = errorDuringRollback; }
        if (!sameContext_ACU(context, this.dependencies)) {
          fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合补偿保存期间聊天已切换，原聊天持久化状态未知', {
            primaryMessage: error instanceof Error ? error.message : String(error), persistenceState: 'unknown', rollbackAttempted: true,
            ...(rollbackError === undefined ? {} : { rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) }),
          });
        }
        if (rollbackError !== undefined) {
          fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合保存与补偿保存均失败', {
            primaryMessage: error instanceof Error ? error.message : String(error), rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError), persistenceState: 'unknown', rollbackAttempted: true,
          });
        }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演联合保存失败', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async commitWithinQueue_ACU(input: WorldSimulationCommitInput_ACU, context: StoreContext_ACU): Promise<WorldSimulationLedgerRecord_ACU> {
    if (!sameContext_ACU(context, this.dependencies)) fail_ACU('WORLD_SIM_STALE', '世界推演提交前聊天已切换');
    if (!Number.isInteger(input.anchorMessageIndex) || input.anchorMessageIndex < 0 || input.anchorMessageIndex >= context.chat.length
      || !context.chat[input.anchorMessageIndex] || typeof input.recordId !== 'string' || !input.recordId.trim()) {
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演提交参数非法', { anchorMessageIndex: input.anchorMessageIndex });
    }
    if (!Number.isInteger(input.checkpointInterval) || input.checkpointInterval < 1) {
      fail_ACU('WORLD_SIM_PERSIST_FAILED', 'checkpointInterval 必须是正整数', { checkpointInterval: input.checkpointInterval });
    }

    const replay = replayWorldSimulationFromChat_ACU(context.chat, context.isolationKey);
    const actualDigest = replay?.digest ?? null;
    if (input.expectedReplayDigest !== undefined && input.expectedReplayDigest !== actualDigest) {
      fail_ACU('WORLD_SIM_CONFLICT', '世界推演回放摘要已变化，拒绝提交', { expected: input.expectedReplayDigest, actual: actualDigest });
    }
    if (replay) {
      const activeReplayTip = replay.deltaMessageIndices.length > 0
        ? replay.deltaMessageIndices[replay.deltaMessageIndices.length - 1]
        : replay.checkpointMessageIndex;
      if (input.anchorMessageIndex <= activeReplayTip) {
        fail_ACU('WORLD_SIM_CONFLICT', '世界推演账本仅允许追加到当前回放末端之后', {
          anchorMessageIndex: input.anchorMessageIndex,
          activeReplayTip,
        });
      }
    }

    let record: WorldSimulationLedgerRecord_ACU;
    if (!replay || !input.delta || countWorldSimulationDeltasSinceCheckpoint_ACU(replay) + 1 >= input.checkpointInterval) {
      record = { version: 1, kind: 'checkpoint', id: input.recordId, anchorMessageIndex: input.anchorMessageIndex, state: { ...input.state, anchorMessageIndex: input.anchorMessageIndex } };
    } else {
      const replayed = replayWorldSimulationFromChat_ACU(context.chat, context.isolationKey);
      if (!replayed || replayed.digest !== replay.digest) {
        fail_ACU('WORLD_SIM_CONFLICT', '世界推演写入前状态已变化');
      }
      const expectedState = {
        ...input.state,
        anchorMessageIndex: input.anchorMessageIndex,
      };
      const actualState = replayed.state;
      let predicted: WorldStateSnapshot_ACU;
      try {
        predicted = applyWorldSimulationDelta_ACU(actualState, {
          ...input.delta,
          anchorMessageIndex: input.anchorMessageIndex,
        });
      } catch (error) {
        if (error instanceof WorldSimulationValidationError_ACU) {
          fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演候选 delta 未通过提交校验', {
            reason: error.error.message,
          });
        }
        throw error;
      }
      if (JSON.stringify(predicted) !== JSON.stringify(expectedState)) {
        fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演 delta 与待提交快照不一致');
      }
      record = { version: 1, kind: 'delta', id: input.recordId, anchorMessageIndex: input.anchorMessageIndex, delta: { ...input.delta, anchorMessageIndex: input.anchorMessageIndex } };
    }

    try {
      parseWorldSimulationLedgerRecord_ACU(record, input.anchorMessageIndex);
    } catch (error) {
      if (error instanceof WorldSimulationValidationError_ACU) {
        fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演待写记录未通过校验', { reason: error.error.message });
      }
      throw error;
    }

    const target = context.chat[input.anchorMessageIndex] as Record<string, unknown>;
    const existingRecord = readIsolatedDataContainer_ACU(target)?.[context.isolationKey]?.worldSimulation;
    if (existingRecord !== undefined) {
      fail_ACU('WORLD_SIM_CONFLICT', '世界推演锚点已有不可变账本记录，拒绝覆盖', { anchorMessageIndex: input.anchorMessageIndex });
    }
    const existed = Object.prototype.hasOwnProperty.call(target, 'TavernDB_ACU_IsolatedData');
    const previous = target.TavernDB_ACU_IsolatedData;
    let saveAttempted = false;
    try {
      writeIsolatedTagWorldSimulation_ACU(target, context.isolationKey, record);
      if (!sameContext_ACU(context, this.dependencies)) fail_ACU('WORLD_SIM_STALE', '世界推演写入后聊天已切换');
      saveAttempted = true;
      await this.dependencies.saveChatStrict();
      if (!sameContext_ACU(context, this.dependencies)) fail_ACU('WORLD_SIM_STALE', '世界推演保存后聊天已切换');
      return record;
    } catch (error) {
      restoreIsolatedField_ACU(target, existed, previous);
      const stillCurrent = sameContext_ACU(context, this.dependencies);
      if (saveAttempted && !stillCurrent) {
        fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演保存期间聊天已切换，原聊天持久化状态未知', {
          primaryMessage: error instanceof Error ? error.message : String(error),
          persistenceState: 'unknown',
          rollbackAttempted: false,
        });
      }
      if (saveAttempted && stillCurrent) {
        let rollbackError: unknown;
        try {
          await this.dependencies.saveChatStrict();
        } catch (errorDuringRollback) {
          rollbackError = errorDuringRollback;
        }
        if (!sameContext_ACU(context, this.dependencies)) {
          fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演补偿保存期间聊天已切换，原聊天持久化状态未知', {
            primaryMessage: error instanceof Error ? error.message : String(error),
            persistenceState: 'unknown',
            rollbackAttempted: true,
            ...(rollbackError === undefined ? {} : {
              rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            }),
          });
        }
        if (rollbackError !== undefined) {
          fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演保存与补偿保存均失败', {
            primaryMessage: error instanceof Error ? error.message : String(error),
            rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            persistenceState: 'unknown',
            rollbackAttempted: true,
          });
        }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      fail_ACU('WORLD_SIM_PERSIST_FAILED', '世界推演保存失败', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private enqueueWrite_ACU<T>(operation: (context: StoreContext_ACU) => Promise<T>): Promise<T> {
    const context = captureContext_ACU(this.dependencies);
    const previous = WorldSimulationStore_ACU.writeTailsByChatIdentity_ACU.get(context.chatIdentity) ?? Promise.resolve();
    const result = previous.then(() => operation(context), () => operation(context));
    const settled: Promise<void> = result.then((): void => undefined, (): void => undefined);
    WorldSimulationStore_ACU.writeTailsByChatIdentity_ACU.set(context.chatIdentity, settled);
    void settled.finally(() => {
      if (WorldSimulationStore_ACU.writeTailsByChatIdentity_ACU.get(context.chatIdentity) === settled) {
        WorldSimulationStore_ACU.writeTailsByChatIdentity_ACU.delete(context.chatIdentity);
      }
    });
    return result;
  }
}
