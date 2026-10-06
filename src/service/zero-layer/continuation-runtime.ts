import type { ContinuationRuntime_ACU } from '../continuation/continuation-runtime';
import { ContinuationOrchestrator_ACU, type ContinuationPlanningContext_ACU } from '../continuation/continuation-orchestrator';
import { ContinuationOutlinePlanner_ACU } from '../continuation/outline-planner';
import { StageExecutionEngine_ACU, type ContinuationPreparedTurnInstruction_ACU } from '../continuation/stage-execution-engine';
import { ContinuationAgentTurnPlanner_ACU } from '../continuation/agent/agent-main-loop';
import { applyAgentUserRequirementsReplace_ACU } from '../continuation/agent/agent-user-requirements';
import type { ContinuationAgentTurnPlanRequest_ACU } from '../continuation/agent/agent-model';
import type { ContinuationSettings_ACU, ContinuationLogicalRef_ACU, TurnAttemptIdentity_ACU } from '../continuation/model';
import type { ContinuationPromptPlaceholder_ACU } from '../continuation/prompt-template';
import { loadZeroLayerRuntimeForPage_ACU } from '../../presentation/bootstrap/zero-layer-bootstrap';
import { ZeroLayerContinuationStore_ACU, emptyZeroLayerContinuation_ACU } from './continuation-store';
import { createZeroLayerContinuationAgentStorage_ACU, clearZeroLayerContinuationModules_ACU } from './continuation-agent-storage';
import { getZeroLayerRuntime_ACU } from './runtime';
import { ZeroLayerError_ACU } from './model';
import { logAgentSession_ACU } from '../continuation/agent/agent-session-log';

type Storage_ACU = NonNullable<ContinuationAgentTurnPlanRequest_ACU['storage']>;
interface Dependencies_ACU {
  allocateId: (prefix: string) => string;
  buildSettings: () => ContinuationSettings_ACU;
  onSettingsReplaced: (settings: ContinuationSettings_ACU) => void;
  createOutlineResolvers: (context: ContinuationPlanningContext_ACU, storage: Storage_ACU) =>
    Partial<Record<ContinuationPromptPlaceholder_ACU, () => string | Promise<string>>>;
}

/** 逻辑正文独占发送链；不登记宿主生成桥，也不持有输入框或物理楼层写权限。 */
export function createZeroLayerContinuationRuntime_ACU(dependencies: Dependencies_ACU): ContinuationRuntime_ACU {
  const store = new ZeroLayerContinuationStore_ACU();
  const zero = getZeroLayerRuntime_ACU();
  const listeners = new Set<() => void>();
  let disposed = false;
  let sending = false;
  let autoContinueTimer: ReturnType<typeof setTimeout> | null = null;
  let autoContinueEpoch = 0;
  const cancelAutoContinue = () => {
    autoContinueEpoch += 1;
    if (autoContinueTimer !== null) clearTimeout(autoContinueTimer);
    autoContinueTimer = null;
  };
  const assertCurrent = () => {
    if (disposed) throw new ZeroLayerError_ACU('scope-changed', '零层续写运行时已失效。');
    store.readSource();
  };
  const notify = () => { for (const listener of listeners) listener(); };
  const storage = (signal?: AbortSignal | null) => {
    assertCurrent();
    return createZeroLayerContinuationAgentStorage_ACU(store, signal);
  };
  const executionEngine = new StageExecutionEngine_ACU({
    readEnvelope: () => store.readPersisted(),
    getChatIdentity: () => { assertCurrent(); return store.getChatIdentity(); },
    allocateId: dependencies.allocateId,
    planner: new ContinuationAgentTurnPlanner_ACU(),
    prepareStorage: async signal => storage(signal),
  });
  const orchestrator = new ContinuationOrchestrator_ACU({
    store,
    logicalHistory: store,
    executionEngine,
    planner: new ContinuationOutlinePlanner_ACU(),
    getChatIdentity: () => { assertCurrent(); return store.getChatIdentity(); },
    assertCanOperate: () => zero.store.assertCanOperate(),
    now: () => Date.now(),
    allocateId: dependencies.allocateId,
    createOutlineResolvers: context => dependencies.createOutlineResolvers(context, storage()),
    hasLiveHostClaim: identity => sending && identity === store.getChatIdentity(),
    buildFallbackSettings: dependencies.buildSettings,
    onSettingsReplaced: dependencies.onSettingsReplaced,
    appendAgentConversation: appends => store.appendConversation(appends),
    seedAgentUserRequirements: async text => {
      const adapter = storage();
      const chat = adapter.readChat();
      const snapshot = adapter.readModuleSnapshot(chat);
      if (!text.trim() || snapshot.userRequirements.length) return;
      await adapter.writeModuleSnapshot(chat, chat.length - 1,
        applyAgentUserRequirementsReplace_ACU(snapshot, [text.trim()]));
    },
    clearAgentModules: () => clearZeroLayerContinuationModules_ACU(store),
    clearAgentConversation: async () => {
      store.assertCanContinue();
      const changed = store.readState().conversation.segment.length > 0
        || store.readState().conversation.compaction !== undefined;
      if (changed) await store.updateState(state => {
        state.conversation = emptyZeroLayerContinuation_ACU().conversation;
      });
      return changed;
    },
  });
  const unregister = zero.registerContinuationSettlement(async (envelope, turnId, attemptId, signal) => {
    assertCurrent();
    if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '续写确认已中止。');
    const turn = envelope.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
    if (!turn || envelope.sessionId !== store.sessionId || turn.branchId !== store.branchId) {
      throw new ZeroLayerError_ACU('revision-conflict', '续写正文不属于当前运行时。');
    }
    await orchestrator.confirmLogicalTurn({ sessionId: envelope.sessionId, branchId: turn.branchId,
      turnId, attemptId, floorId: turn.assistantFloor.floorId });
    notify();
  });
  // 确认仍在结算链内；只有提交返回、正文已发布后才安排下一轮。
  const pauseFailure = async (error: unknown, identity: TurnAttemptIdentity_ACU, ref?: ContinuationLogicalRef_ACU) => {
    // 保存状态不确定或会话失效时不尝试再写；原错误与严格回读门禁保持权威。
    if (disposed || (error instanceof ZeroLayerError_ACU
      && ['persist-unknown', 'persist-failed', 'scope-changed', 'source-changed'].includes(error.code))) return;
    assertCurrent();
    await store.pauseTurnFailure(identity, ref);
  };

  const scheduleAutoContinue = () => {
    cancelAutoContinue();
    const state = orchestrator.readAutoContinueState();
    if (disposed || !state.eligible) return;
    const epoch = autoContinueEpoch;
    const taskId = store.readPersisted()?.activeTask?.taskId;
    const headTurnId = store.anchor().logicalAnchor.headTurnId;
    autoContinueTimer = setTimeout(async () => {
      autoContinueTimer = null;
      try {
        if (disposed || sending || epoch !== autoContinueEpoch) return;
        assertCurrent();
        if (store.readPersisted()?.activeTask?.taskId !== taskId
          || store.anchor().logicalAnchor.headTurnId !== headTurnId
          || !orchestrator.readAutoContinueState().eligible) return;
        const continuation = continueTask();
        const continuationEpoch = autoContinueEpoch;
        const result = await continuation;
        if (disposed || continuationEpoch !== autoContinueEpoch) return;
        assertCurrent();
        if (result.preparedTurn) await send(result.preparedTurn);
      } catch {
        if (!disposed) logAgentSession_ACU({ kind: 'run_failed', title: '自动续写已暂停',
          detail: '逻辑正文或续写准备未完成，进度已保留；请检查任务状态后显式继续。', ok: false });
      } finally {
        if (!disposed) notify();
      }
    }, state.delaySeconds * 1_000);
  };
  const send = async (prepared: ContinuationPreparedTurnInstruction_ACU): Promise<boolean> => {
    assertCurrent();
    if (sending) throw new ZeroLayerError_ACU('pending-turn', '零层续写已有在途正文。');
    const frozen = structuredClone(prepared);
    if (frozen.identity.chatIdentity !== store.getChatIdentity()) {
      throw new ZeroLayerError_ACU('scope-changed', '规划结果不属于当前零层续写。');
    }
    cancelAutoContinue();
    sending = true;
    let published = false;
    let logicalRef: ContinuationLogicalRef_ACU | undefined;
    try {
      await loadZeroLayerRuntimeForPage_ACU();
      assertCurrent();
      await zero.submit(frozen.instruction.instruction, ['table'], frozen.identity, async ref => {
        assertCurrent();
        logicalRef = ref;
        await orchestrator.recordLogicalTurn(frozen.identity, ref);
        notify();
      });
      assertCurrent();
      published = true;
      return true;
    } catch (error) {
      await pauseFailure(error, frozen.identity, logicalRef);
      throw error;
    } finally {
      sending = false;
      notify();
      if (published) scheduleAutoContinue();
    }
  };

  /** 显式继续先回读持久结果：正文已保存只补结算，未知发送绝不重发。 */
  const continueTask: ContinuationRuntime_ACU['continueTask'] = async () => {
    if (disposed) throw new ZeroLayerError_ACU('scope-changed', '零层续写运行时已失效。');
    if (sending) throw new ZeroLayerError_ACU('pending-turn', '零层续写已有在途正文。');
    zero.store.assertCanOperate();
    cancelAutoContinue();
    await zero.store.readPersisted();
    assertCurrent();
    let source = store.readSource();
    const checkpoints = source.branches.find(branch => branch.branchId === store.branchId)!.checkpoints;
    if (checkpoints?.pending || checkpoints?.cleanupPending) {
      await zero.recoverCheckpoints();
      assertCurrent();
      source = store.readSource();
    }
    const turn = source.turns.find(item => item.branchId === store.branchId
      && !['published', 'failed', 'cancelled'].includes(item.phase));
    if (!turn) return orchestrator.continueTask();
    if (!turn.continuationIdentity
      || turn.continuationIdentity.taskId !== store.readPersisted()?.activeTask?.taskId) {
      throw new ZeroLayerError_ACU('pending-turn', '未结算逻辑回合不属于当前续写，请恢复原回合。');
    }
    sending = true;
    const ref = { sessionId: source.sessionId, branchId: turn.branchId, turnId: turn.turnId,
      attemptId: turn.attemptId, floorId: turn.assistantFloor.floorId };
    let published = false;
    try {
      if (['response-durable', 'effects-durable'].includes(turn.phase)) {
        const confirmed = store.readState().confirmed.some(item => item.turnId === turn.turnId);
        if (!confirmed) {
          await orchestrator.recordLogicalTurn(turn.continuationIdentity, ref, true);
        }
        await zero.recoverSettlement(turn.turnId, turn.attemptId);
      } else if (turn.phase === 'prepared' && turn.plotCandidate) {
        await loadZeroLayerRuntimeForPage_ACU();
        assertCurrent();
        await zero.resumePrepared(turn.turnId, turn.attemptId, ref =>
          orchestrator.recordLogicalTurn(turn.continuationIdentity!, ref, true));
      } else {
        throw new ZeroLayerError_ACU('pending-turn', '正文发送结果未知或准备未完成；禁止重新请求模型，请检查原回合。');
      }
      assertCurrent();
      await store.clearPublishedTurnFailure(turn.continuationIdentity, ref);
      const envelope = store.readPersisted();
      if (!envelope?.activeTask) throw new ZeroLayerError_ACU('corrupt-data', '恢复后续写任务缺失。');
      published = true;
      return { envelope, task: envelope.activeTask };
    } catch (error) {
      await pauseFailure(error, turn.continuationIdentity, ref);
      throw error;
    } finally {
      sending = false;
      notify();
      if (published) scheduleAutoContinue();
    }
  };

  const unregisterStop = zero.registerContinuationStop(async () => {
    if (disposed) return;
    cancelAutoContinue();
    await orchestrator.interrupt();
    assertCurrent();
    cancelAutoContinue();
  });

  return {
    mode: 'logical', orchestrator, bridge: null,
    continueTask, send,
    retryHostGeneration: async () => {
      throw new ZeroLayerError_ACU('invalid-transition', '零层正文不使用酒馆物理重发，请通过继续恢复已保存回合。');
    },
    stopGeneration: () => { cancelAutoContinue(); zero.cancel(); },
    subscribeStateChanges: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    initialize: async () => {
      if (disposed) throw new ZeroLayerError_ACU('scope-changed', '零层续写运行时已失效。');
      zero.store.assertCanOperate();
      await zero.store.readPersisted();
      assertCurrent();
      return store.read();
    },
    read: () => {
      assertCurrent();
      return sending ? store.readPersisted() : store.read();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAutoContinue();
      if (sending) zero.cancel();
      unregister();
      unregisterStop();
      listeners.clear();
    },
  };
}
