import { countAiMessages_ACU, isAiMessage_ACU, resolveGeneratedAiMessageIndex_ACU, type AutoFillIntent_ACU } from '../runtime/message-handler';
import { validateLoopTags_ACU } from '../loop/loop-evaluator';
import { countAgentTokens_ACU } from './agent/agent-token-budget';
import { logAgentSession_ACU } from './agent/agent-session-log';
import type { ContinuationPreparedTurnInstruction_ACU } from './stage-execution-engine';
import type { ContinuationHostGenerationCapture_ACU, TurnAttemptIdentity_ACU } from './model';
import type { ContinuationHostTurnAdapter_ACU } from './host-turn-adapter';

export interface ContinuationHostTurnRuntime_ACU {
  getChatIdentity(): string;
  getChat(): any[];
  getGenerationSequence(): number;
  retryCurrentTurn(): Promise<{ retryHostGeneration?: boolean }>;
  readPendingHostTurn(): { settings: { loopTags: string; retryDelaySeconds?: number; minGenerationTokens?: number }; pending: { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU; status: 'awaiting_generation' | 'retry_ready' | 'exhausted' } } | null;
  readAutoContinueState(): { eligible: boolean; delaySeconds: number };
  continueTask(): Promise<{ preparedTurn?: ContinuationPreparedTurnInstruction_ACU; retryHostGeneration?: boolean }>;
  recordHostTurn(input: { identity: TurnAttemptIdentity_ACU; capture: ContinuationHostGenerationCapture_ACU }): Promise<unknown>;
  bindHostTurnGeneration(identity: TurnAttemptIdentity_ACU, generationSeq: number): Promise<void>;
  confirmCurrentTurn(identity: TurnAttemptIdentity_ACU, messageIndex?: number): Promise<unknown>;
  rejectHostTurnForMissingTags(input: { identity: TurnAttemptIdentity_ACU; messageIndex: number }): Promise<unknown>;
  rejectHostTurnForShortGeneration(input: { identity: TurnAttemptIdentity_ACU; messageIndex: number; tokenCount: number; threshold: number }): Promise<unknown>;
  rejectHostTurnForFailedGeneration(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  pauseForHostInputFailure(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  pauseForHostResultFailure(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
  failHostTurnForStoppedGeneration(identity: TurnAttemptIdentity_ACU): Promise<unknown>;
}

export interface ContinuationHostGenerationEventContext_ACU {
  allowOrdinaryLooseClaim: boolean;
  automaticTrigger: boolean;
  quietLike: boolean;
  dryRun: boolean;
}

type ContinuationHostGenerationEventContextInput_ACU = ContinuationHostGenerationEventContext_ACU | boolean | undefined;

function normalizeGenerationEventContext_ACU(input: ContinuationHostGenerationEventContextInput_ACU): ContinuationHostGenerationEventContext_ACU {
  if (typeof input === 'boolean') return { allowOrdinaryLooseClaim: input, automaticTrigger: false, quietLike: false, dryRun: false };
  return input ?? { allowOrdinaryLooseClaim: false, automaticTrigger: false, quietLike: false, dryRun: false };
}

export interface ContinuationHostGenerationBridgeDependencies_ACU {
  runtime: ContinuationHostTurnRuntime_ACU;
  hostInput: ContinuationHostTurnAdapter_ACU;
  now(): number;
  wait(ms: number): Promise<void>;
  materializationRetries: number;
  materializationRetryDelayMs: number;
  countTokens?: (text: string) => Promise<number>;
}

type StartedHostGeneration_ACU = { identity: TurnAttemptIdentity_ACU; sequence: number; bind: Promise<void> };
type LocalRetryClaim_ACU = { identity: TurnAttemptIdentity_ACU; mode: 'generate' | 'regenerate'; createdAt: number; sequence: number | null; consumed: boolean };

/**
 * The only bridge that may couple a prepared continuation turn to host input
 * and GENERATION_* events.
 *
 * 认领采用两层判定：
 * - 严格层：GENERATION_STARTED 在发送的同步窗口内到达时按序列号精确配对（历史行为）。
 * - 宽松层：参考最原始智能续写的状态法——持久化的 pendingHostTurn（awaiting_generation）
 *   就是"正在等待回复"的标志，任意非 quiet 的生成事件（由调用方经 allowLoose 过滤后）
 *   都可被认领；归属安全交给 resolveGeneratedAiMessageIndex_ACU 的唯一候选解析兜底。
 *   宿主的 GENERATION_STARTED 通常在点击发送后的微任务中才送达，严格层此时必然错过，
 *   没有宽松层就会永远收不到正文完成信号。
 */
export class ContinuationHostGenerationBridge_ACU {
  private sendingIdentity: TurnAttemptIdentity_ACU | null = null;
  private readonly startedByChat = new Map<string, StartedHostGeneration_ACU>();
  private readonly stateListeners = new Set<() => void>();
  private localRetryClaim: LocalRetryClaim_ACU | null = null;
  private static readonly LOCAL_RETRY_CLAIM_TTL_MS = 60_000;

  constructor(private readonly dependencies: ContinuationHostGenerationBridgeDependencies_ACU) {}

  /** 订阅桥驱动的持久化状态变更；页面无需猜测宿主事件何时完成。 */
  subscribeStateChanges(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyStateChanges_ACU(): void {
    for (const listener of this.stateListeners) {
      try { listener(); } catch { /* 观察者失败不能影响正文确认链 */ }
    }
  }

  /** 打断酒馆正在进行的正文生成。用户点停止时必须先走这里，否则正文写完仍会确认并自动续写。 */
  stopHostGeneration(): void {
    this.dependencies.hostInput.stopGeneration();
  }

  /** 桥内存中是否持有该聊天的活认领（发送窗口内或已认领生成开始）。用于区分真在飞与重载后的滞留态。 */
  hasLiveClaim(chatIdentity: string): boolean {
    if (this.sendingIdentity?.chatIdentity === chatIdentity) return true;
    return this.startedByChat.has(chatIdentity);
  }

  async send(prepared: ContinuationPreparedTurnInstruction_ACU): Promise<boolean> {
    const runtime = this.dependencies.runtime;
    if (prepared.identity.chatIdentity !== runtime.getChatIdentity()) return false;
    const chat = runtime.getChat();
    const capture: ContinuationHostGenerationCapture_ACU = {
      capturedAt: this.dependencies.now(),
      capturedChatLength: Array.isArray(chat) ? chat.length : 0,
      capturedAiFloorCount: Array.isArray(chat) ? chat.filter(message => message && !message.is_user && message?.extra?.type !== 'narrator').length : 0,
      generationSeq: null,
    };
    await runtime.recordHostTurn({ identity: prepared.identity, capture });
    this.sendingIdentity = prepared.identity;
    this.notifyStateChanges_ACU();
    try {
      if (!this.dependencies.hostInput.send(prepared.instruction.instruction)) {
        await runtime.pauseForHostInputFailure(prepared.identity);
        return false;
      }
      return true;
    } finally {
      this.sendingIdentity = null;
    }
  }

  /**
   * 认领宿主生成开始事件。
   * 严格路径：发送同步窗口内到达（sendingIdentity 仍在）按历史行为配对。
   * 宽松路径（allowLoose，调用方已过滤 quiet/dryRun/automatic）：当前聊天存在未绑定
   * 序列号的等待轮时认领——宿主事件通常在发送返回后的微任务里才送达，没有这条路径
   * 生成开始永远配对不上（spv8.9.2 时代的状态法没有这个问题）。
   */
  onGenerationStarted(sequence: number, contextInput: ContinuationHostGenerationEventContextInput_ACU = undefined): boolean {
    const context = normalizeGenerationEventContext_ACU(contextInput);
    const runtime = this.dependencies.runtime;
    const identity = this.sendingIdentity;
    if (identity && identity.chatIdentity === runtime.getChatIdentity()) {
      const pending = runtime.readPendingHostTurn();
      if (!pending || pending.pending.identity.attemptId !== identity.attemptId || pending.pending.capture.generationSeq !== null) return false;
      this.startedByChat.set(identity.chatIdentity, { identity, sequence, bind: runtime.bindHostTurnGeneration(identity, sequence) });
      if (this.localRetryClaim?.identity.attemptId === identity.attemptId) this.localRetryClaim = null;
      return true;
    }
    const localRetryClaim = this.getMatchingLocalRetryClaim_ACU(context, sequence);
    if (!context.allowOrdinaryLooseClaim && !localRetryClaim) return false;
    const chatIdentity = runtime.getChatIdentity();
    if (this.startedByChat.has(chatIdentity)) return false;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation' || snapshot.pending.capture.generationSeq !== null) return false;
    const pendingIdentity = snapshot.pending.identity;
    if (localRetryClaim && pendingIdentity.attemptId !== localRetryClaim.identity.attemptId) return false;
    this.startedByChat.set(chatIdentity, { identity: pendingIdentity, sequence, bind: runtime.bindHostTurnGeneration(pendingIdentity, sequence) });
    if (localRetryClaim) this.localRetryClaim = null;
    return true;
  }

  /**
   * 是否认领本次生成结束。严格路径按已认领的序列号精确匹配；
   * 宽松路径（allowLoose）参考 spv8.9.2 的状态法：只要当前聊天有等待中的宿主轮
   * 且序列号不冲突（未绑定或一致）就认领，归属由唯一候选解析器兜底。
   */
  claimsGenerationEnded(sequence: number | undefined, contextInput: ContinuationHostGenerationEventContextInput_ACU = undefined): boolean {
    const context = normalizeGenerationEventContext_ACU(contextInput);
    const runtime = this.dependencies.runtime;
    const started = this.startedByChat.get(runtime.getChatIdentity());
    if (started && sequence !== undefined && started.sequence === sequence) return true;
    const localRetryClaim = this.getMatchingLocalRetryClaim_ACU(context, sequence);
    if (!context.allowOrdinaryLooseClaim && !localRetryClaim) return false;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation') return false;
    if (localRetryClaim && snapshot.pending.identity.attemptId !== localRetryClaim.identity.attemptId) return false;
    const boundSequence = snapshot.pending.capture.generationSeq ?? started?.sequence ?? null;
    return boundSequence === null || sequence === undefined || boundSequence === sequence;
  }

  async onGenerationEnded(eventMessageId: unknown, sequence: number | undefined, contextInput: ContinuationHostGenerationEventContextInput_ACU = undefined): Promise<void> {
    const context = normalizeGenerationEventContext_ACU(contextInput);
    const endedOnlyLocalRetryClaim = this.getMatchingLocalRetryClaim_ACU(context, sequence);
    if (!this.claimsGenerationEnded(sequence, context)) return;
    const chatIdentity = this.dependencies.runtime.getChatIdentity();
    const started = this.startedByChat.get(chatIdentity) ?? null;
    this.startedByChat.delete(chatIdentity);
    if (endedOnlyLocalRetryClaim) {
      endedOnlyLocalRetryClaim.consumed = true;
      this.localRetryClaim = null;
    }
    // 宽松路径没有 started 记录：身份以持久化等待轮为准。
    const claimedIdentity = started?.identity ?? this.dependencies.runtime.readPendingHostTurn()?.pending.identity;
    if (!claimedIdentity) return;
    try {
      if (started) await started.bind;
      const snapshot = this.dependencies.runtime.readPendingHostTurn();
      if (!snapshot || snapshot.pending.status !== 'awaiting_generation' || snapshot.pending.identity.attemptId !== claimedIdentity.attemptId) return;
      const boundSequence = snapshot.pending.capture.generationSeq;
      if (boundSequence !== null && sequence !== undefined && boundSequence !== sequence) return;
      const resolution = await this.resolveMessageIndex_ACU(eventMessageId, snapshot.pending.capture, chatIdentity);
      if (resolution.kind === 'no_reply') {
        // 生成失败/未产出正文：没有新楼层，走酒馆 Generate 对已有用户楼要回复，不重跑 Agent。
        await this.dependencies.runtime.rejectHostTurnForFailedGeneration(claimedIdentity);
        await this.autoRetryHostGenerationIfReady_ACU(claimedIdentity, snapshot.settings.retryDelaySeconds ?? 0);
        return;
      }
      if (resolution.kind === 'unsafe') {
        // 归属不安全（多候选歧义/快照失效）：自动重试可能删错楼，fail closed 交人工。
        await this.dependencies.runtime.pauseForHostResultFailure(claimedIdentity);
        return;
      }
      const messageIndex = resolution.messageIndex;
      const chat = this.dependencies.runtime.getChat();
      if (messageIndex !== chat.length - 1) {
        await this.dependencies.runtime.pauseForHostResultFailure(claimedIdentity);
        return;
      }
      const message = chat[messageIndex];
      const body = String(message?.mes ?? '');
      if (!message || !validateLoopTags_ACU(body, snapshot.settings.loopTags)) {
        await this.dependencies.runtime.rejectHostTurnForMissingTags({ identity: claimedIdentity, messageIndex });
        await this.autoRetryHostGenerationIfReady_ACU(claimedIdentity, snapshot.settings.retryDelaySeconds ?? 0);
        return;
      }
      const minTokens = Number.isInteger(snapshot.settings.minGenerationTokens) ? snapshot.settings.minGenerationTokens as number : 0;
      if (minTokens > 0) {
        const countTokens = this.dependencies.countTokens ?? countAgentTokens_ACU;
        const tokenCount = await countTokens(body);
        if (tokenCount < minTokens) {
          await this.dependencies.runtime.rejectHostTurnForShortGeneration({ identity: claimedIdentity, messageIndex, tokenCount, threshold: minTokens });
          await this.autoRetryHostGenerationIfReady_ACU(claimedIdentity, snapshot.settings.retryDelaySeconds ?? 0);
          return;
        }
      }
      await this.dependencies.runtime.confirmCurrentTurn(claimedIdentity, messageIndex);
    } catch {
      // A bridge failure must not leave an attributable turn indefinitely running.
      // The guarded fallback preserves a stale/persistence error when it can no
      // longer safely write the original task identity.
      try {
        await this.dependencies.runtime.pauseForHostResultFailure(claimedIdentity);
      } catch {
        // No safe write remains after a stale or persistence failure.
      }
      return;
    } finally {
      this.notifyStateChanges_ACU();
    }
    await this.autoContinueAfterTurn_ACU();
  }

  /**
   * 宿主生成被中止（GENERATION_STOPPED）：等待中的宿主轮不会再有结束事件，
   * 转入 retry_ready + 暂停，用户可重试当前轮或继续/停止，不再卡死在等待态。
   */
  async onGenerationStopped(sequence: number | undefined): Promise<void> {
    const runtime = this.dependencies.runtime;
    const chatIdentity = runtime.getChatIdentity();
    const started = this.startedByChat.get(chatIdentity) ?? null;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation') return;
    const boundSequence = snapshot.pending.capture.generationSeq ?? started?.sequence ?? null;
    if (boundSequence !== null && sequence !== undefined && boundSequence !== sequence) return;
    this.startedByChat.delete(chatIdentity);
    if (this.localRetryClaim?.identity.attemptId === snapshot.pending.identity.attemptId) this.localRetryClaim = null;
    if (started) {
      try { await started.bind; } catch { /* 绑定失败不阻碍中止转换 */ }
    }
    try {
      await runtime.failHostTurnForStoppedGeneration(snapshot.pending.identity);
    } catch {
      // 状态已变化（轮次已被其他路径推进/暂停）时无需补写。
    }
    this.notifyStateChanges_ACU();
  }

  /**
   * 一轮正文确认成功后的自动续写：等待轮次延迟后自动触发下一轮，
   * 与正文重试自动链同构。资格在延迟前后各读一次——用户可能在延迟期间停止任务。
   * continueTask 的失败已由 orchestrator 落为 paused+lastError，这里不再改写状态。
   */
  private async autoContinueAfterTurn_ACU(): Promise<void> {
    const runtime = this.dependencies.runtime;
    const state = runtime.readAutoContinueState();
    if (!state.eligible) return;
    await this.dependencies.wait(state.delaySeconds * 1_000);
    if (!runtime.readAutoContinueState().eligible) return;
    try {
      const result = await runtime.continueTask();
      if (result.retryHostGeneration) await this.retryHostGeneration();
      else if (result.preparedTurn) await this.send(result.preparedTurn);
    } catch (error) {
      // 状态已由 orchestrator 记录（paused+lastError 或拒绝原因），自动链到此为止；
      // 但必须在会话流留痕——静默吞掉会让用户以为自动续写根本没触发。
      const message = error instanceof Error ? error.message : String(error);
      logAgentSession_ACU({ kind: 'run_failed', title: '自动续写已暂停', detail: `${message}\n进度已保留，输入新指令后发送即可继续。`, ok: false });
    } finally {
      this.notifyStateChanges_ACU();
    }
  }

  /**
   * 解析本轮宿主正文的楼层归属。
   * - resolved：唯一候选，可安全确认。
   * - no_reply：物化等待耗尽仍无任何候选——生成失败或未产出正文，可安全自动重试
   *   （没有楼层被写入）。生成出错时宿主的 message_id 常为 undefined，非整数锚点
   *   不短路：解析器各锚点分支自带整数守卫，会自然落到捕获边界候选扫描。
   * - unsafe：多候选歧义 / 快照失效 / 聊天已切换——自动重试可能重复楼层，fail closed。
   */
  private async resolveMessageIndex_ACU(eventMessageId: unknown, capture: ContinuationHostGenerationCapture_ACU, chatIdentity: string): Promise<{ kind: 'resolved'; messageIndex: number } | { kind: 'no_reply' } | { kind: 'unsafe' }> {
    const anchor = Number.isInteger(eventMessageId) ? (eventMessageId as number) : Number.NaN;
    const intent: AutoFillIntent_ACU = { eventMessageId: anchor, chatKey: chatIdentity, isolationKey: '', capturedAt: capture.capturedAt, capturedChatLength: capture.capturedChatLength, capturedAiFloorCount: capture.capturedAiFloorCount, generationSeq: capture.generationSeq ?? undefined };
    for (let attempt = 0; attempt <= this.dependencies.materializationRetries; attempt += 1) {
      if (this.dependencies.runtime.getChatIdentity() !== chatIdentity) return { kind: 'unsafe' };
      const result = resolveGeneratedAiMessageIndex_ACU({ liveChat: this.dependencies.runtime.getChat(), intent });
      if (result.kind === 'resolved') return { kind: 'resolved', messageIndex: result.messageIndex };
      if (result.kind !== 'pending_materialization') return { kind: 'unsafe' };
      if (attempt === this.dependencies.materializationRetries) return { kind: 'no_reply' };
      await this.dependencies.wait(this.dependencies.materializationRetryDelayMs);
    }
    return { kind: 'no_reply' };
  }

  private async autoRetryHostGenerationIfReady_ACU(identity: TurnAttemptIdentity_ACU, retryDelaySeconds: number): Promise<void> {
    const afterReject = this.dependencies.runtime.readPendingHostTurn();
    if (afterReject?.pending.status !== 'retry_ready' || afterReject.pending.identity.attemptId !== identity.attemptId) return;
    await this.dependencies.wait(Math.max(0, retryDelaySeconds) * 1_000);
    const beforeRetry = this.dependencies.runtime.readPendingHostTurn();
    if (beforeRetry?.pending.status !== 'retry_ready' || beforeRetry.pending.identity.attemptId !== identity.attemptId) return;
    const action = await this.dependencies.runtime.retryCurrentTurn();
    if (!action.retryHostGeneration) return;
    await this.retryHostGeneration();
  }

  private getMatchingLocalRetryClaim_ACU(context: ContinuationHostGenerationEventContext_ACU, sequence: number | undefined): LocalRetryClaim_ACU | null {
    const claim = this.localRetryClaim;
    if (!claim || claim.consumed || !context.automaticTrigger || context.quietLike || context.dryRun) return null;
    if (this.dependencies.now() - claim.createdAt > ContinuationHostGenerationBridge_ACU.LOCAL_RETRY_CLAIM_TTL_MS) {
      this.localRetryClaim = null;
      return null;
    }
    if (claim.identity.chatIdentity !== this.dependencies.runtime.getChatIdentity()) return null;
    if (claim.sequence !== null && sequence !== undefined && claim.sequence !== sequence) return null;
    const snapshot = this.dependencies.runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'awaiting_generation' || snapshot.pending.identity.attemptId !== claim.identity.attemptId) return null;
    return claim;
  }

  /**
   * 用酒馆自己的重新生成/生成链路重试当前轮，不再让 Agent 另造一条请求。
   * 末楼是 AI 时走 regenerate（酒馆会删掉该楼）；末楼不是 AI 时走 generate。
   */
  async retryHostGeneration(): Promise<boolean> {
    const runtime = this.dependencies.runtime;
    const snapshot = runtime.readPendingHostTurn();
    if (!snapshot || snapshot.pending.status !== 'retry_ready') return false;
    if (snapshot.pending.identity.chatIdentity !== runtime.getChatIdentity()) return false;
    const chat = runtime.getChat();
    const lastIsAi = Array.isArray(chat) && chat.length > 0 && isAiMessage_ACU(chat[chat.length - 1]);
    const aiCount = countAiMessages_ACU(Array.isArray(chat) ? chat : []);
    const capture: ContinuationHostGenerationCapture_ACU = {
      capturedAt: this.dependencies.now(),
      capturedChatLength: lastIsAi ? Math.max(0, chat.length - 1) : (Array.isArray(chat) ? chat.length : 0),
      capturedAiFloorCount: lastIsAi ? Math.max(0, aiCount - 1) : aiCount,
      generationSeq: null,
    };
    await runtime.recordHostTurn({ identity: snapshot.pending.identity, capture });
    const mode = lastIsAi ? 'regenerate' : 'generate';
    this.localRetryClaim = { identity: snapshot.pending.identity, mode, createdAt: this.dependencies.now(), sequence: null, consumed: false };
    this.sendingIdentity = snapshot.pending.identity;
    this.notifyStateChanges_ACU();
    try {
      if (!this.dependencies.hostInput.retryGeneration(mode)) {
        this.localRetryClaim = null;
        await runtime.pauseForHostInputFailure(snapshot.pending.identity);
        return false;
      }
      return true;
    } finally {
      this.sendingIdentity = null;
    }
  }
}
