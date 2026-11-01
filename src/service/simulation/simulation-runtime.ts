import { SillyTavern_API_ACU } from '../../shared/host-api';
import { scanWorldbookActors_ACU } from './worldbook-actor-import';
import { worldModelReplyText_ACU } from './agent/model-reply-text';
import { appendZeroLayerSimulationActors_ACU } from '../zero-layer/simulation-actor-import';
import { confirmWorldActorRegistration_ACU } from '../../presentation/theme/confirm-actor-registration';
import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { callAIChatTurn_ACU, callAIWithResolvedPreset_ACU } from '../ai/api-call';
import { callContinuationInternalAiWithRetry_ACU } from '../continuation/internal-ai-call';
import { agentNativeTools_ACU, type AiChatTurn_ACU } from '../ai/native-tool';
import { settings_ACU } from '../runtime/state-manager';
import { readZeroLayerPublishedMaterials_ACU } from '../zero-layer/published-materials';
import { buildOpenAiPromptCacheKey_ACU, supportsExplicitOpenAiCacheKey_ACU } from '../ai/prompt-cache';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, worldSimulationAgentNativeTools_ACU, type WorldSimulationAgentName_ACU } from './agent/agent-catalog';
import { appendWorldSimulationSessionEvent_ACU, appendWorldSimulationUserInstruction_ACU, readWorldSimulationConversation_ACU, projectWorldSimulationConversationSegments_ACU } from './agent/agent-conversation-store';
import { readLatestWorldSimulationMaterials_ACU, readWorldSimulationLedgerAtAnchor_ACU } from './agent/agent-module-store';
import { clearWorldSimulationRunState_ACU } from './agent/agent-run-cache';
import { beginWorldSimulationSessionRun_ACU, clearWorldSimulationSessionLog_ACU, endWorldSimulationSessionRun_ACU, isWorldSimulationSessionRunning_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU, updateWorldSimulationSession_ACU, type WorldSimulationSessionInput_ACU } from './agent/agent-session-log';
import { prepareWorldRoundRun_ACU } from './agent/world-round-prepare';
import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_RUN_STATE_FIELD_ACU,
  WORLD_SIMULATION_RUN_WRITE_FIELD_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  type WorldSimulationAnchorIdentity_ACU,
  type WorldSimulationTargetAnchor_ACU,
  type WorldSimulationConversationView_ACU,
} from './agent/agent-model';
import type { WorldSimulationInvokeTools_ACU } from './agent/agent-subagent-runtime';
import {
  readLatestWorldSimulationUserRequirements_ACU,
  renderWorldSimulationUserRequirements_ACU,
  replaceWorldSimulationUserRequirementsByUser_ACU,
} from './agent/agent-user-requirements';
import { validateWorldSimulationUserRequirementsSnapshot_ACU } from './agent/agent-user-requirements';
import type { WorldSimulationUserRequirementsSnapshot_ACU } from './agent/agent-model';
import { createWorldSimulationError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationSettings_ACU } from './model';
import { commitReviewedWorldSimulationRound_ACU, commitWorldSimulationProjection_ACU, commitWorldSimulationRound_ACU, applyWorldLegacyBackfillHost_ACU, deleteWorldSimulationActorHost_ACU, deleteWorldSimulationEventHost_ACU, deleteWorldSimulationHistoryHost_ACU, appendWorldSimulationActorsHost_ACU } from './simulation-commit-adapter';
import {
  WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU,
  WORLD_SIMULATION_STOP_REASON_MANUAL_ACU,
  WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU,
  WorldSimulationOrchestrator_ACU,
  type WorldSimulationOrchestratorResult_ACU,
} from './simulation-orchestrator';
import { WorldSimulationStageExecutionEngine_ACU } from './simulation-stage-execution-engine';
import { WorldDeliveryHostStore_ACU } from './world-delivery-host-store';
import { resolveWorldSimulationAgentApiPreset_ACU } from './api-preset';
import { FirstFloorWorldSimulationStore_ACU, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, assertWorldSimulationAnchorCurrent_ACU, resolveCurrentWorldSimulationAnchor_ACU, resolveWorldSimulationAnchor_ACU } from './simulation-store';
import { isAiMessage_ACU } from '../runtime/message-handler';
import { buildDefaultWorldSimulationEnvelope_ACU } from './defaults';
import { buildWorldSimulationProjection_ACU } from './simulation-projection';
import { loadAgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import { buildWorldRunMaterials_ACU, sameWorldRunMaterials_ACU } from './world-run-materials';
import { foldWorldSimulationArchive_ACU, foldWorldSimulationLedger_ACU, readWorldSimulationLedgerFieldSnapshot_ACU, seedLedgerFieldView_ACU } from './simulation-ledger-fold';
import { reviewWorldLegacyMigration_ACU } from './world-legacy-migration-review';
import type { WorldLegacyMigrationReview_ACU } from './world-legacy-migration-review';
import { planWorldLegacyBackfill_ACU, legacyBackfillFingerprint_ACU } from './world-legacy-backfill';
import { readWorldSimulationRunWriteProof_ACU, hasPartialWorldSimulationRunWrites_ACU } from './simulation-run-write-state';
import { readZeroLayerLegacyBackfillSource_ACU, commitZeroLayerLegacyBackfill_ACU } from '../zero-layer/simulation-legacy-backfill';
import { beginWorldSimulationInternalAiMainApiInvocation_ACU, beginWorldSimulationInternalAiRequest_ACU, endWorldSimulationInternalAiMainApiInvocation_ACU, settleWorldSimulationInternalAiRequest_ACU } from './simulation-internal-ai-events';
import { createWorldSimulationCompletionIntent_ACU, resolveLatestWorldSimulationAssistant_ACU, resolveWorldSimulationAssistantCompletion_ACU, restoreWorldSimulationAnchor_ACU } from './simulation-trigger-adapter';
import { assertWorldSimulationHostRun_ACU, requireWorldSimulationHostAnchor_ACU, sameWorldSimulationTargetRef_ACU, worldSimulationRunTargetRef_ACU } from './simulation-identity';
import { ZeroLayerStore_ACU } from '../zero-layer/store';
import { ZERO_LAYER_CARRIER_FIELD_ACU, ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from '../zero-layer/model';
import { ZeroLayerSimulationStore_ACU, emptyZeroLayerSimulation_ACU } from '../zero-layer/simulation-store';
import { appendZeroLayerSimulationSessionEvent_ACU, appendZeroLayerSimulationUserInstruction_ACU } from '../zero-layer/simulation-agent-storage';
import { commitZeroLayerSimulationFinal_ACU, commitZeroLayerReviewedSimulationRound_ACU, commitZeroLayerSimulationRound_ACU } from '../zero-layer/simulation-commit';
import { validateZeroLayerSimulationReceipt_ACU } from '../zero-layer/simulation-validation';
import { deleteZeroLayerSimulationActor_ACU } from '../zero-layer/simulation-actor-removal';
import { deleteZeroLayerSimulationEvent_ACU } from '../zero-layer/simulation-event-removal';
import { deleteZeroLayerSimulationHistory_ACU } from '../zero-layer/simulation-history-removal';
import { readHostWorldTableSnapshot_ACU, readLogicalWorldTableSnapshot_ACU } from './world-table-context';

let allocatedId_ACU = 0;
let internalRequestSequence_ACU = 0;
const allocateId_ACU = (kind: 'task' | 'stage' | 'run' | 'timeline'): string => `${kind}-${Date.now().toString(36)}-${++allocatedId_ACU}`;
const anchorText_ACU = (anchor: WorldSimulationAnchorIdentity_ACU, chat: any[]): string => {
  const current = resolveCurrentWorldSimulationAnchor_ACU(anchor, chat);
  const message = chat[current.messageIndex];
  return typeof message?.mes === 'string' ? message.mes : typeof message?.message === 'string' ? message.message : '';
};

const WORLD_SIMULATION_TRANSPORT_RETRIES_ACU = 2;
const WORLD_SIMULATION_RETRY_DELAY_SECONDS_ACU = 3;

/** 错误日志只记录结构化定位信息；绝不传入请求、资料快照或完整异常对象。 */
function logRuntimeFailure_ACU(operation: string, error: unknown, identity?: WorldSimulationRunIdentity_ACU, chatIdentity?: string): void {
  const failure = error instanceof WorldSimulationValidationError_ACU ? error.error : null;
  logError_ACU('格林推演运行时失败', {
    operation, runId: identity?.runId, taskId: identity?.taskId, stageId: identity?.stageId,
    chatIdentity: identity?.chatIdentity ?? chatIdentity,
    phase: failure?.phase ?? (operation === 'auto_trigger' ? 'agent_loop' : 'persist'),
    code: failure?.code ?? (error instanceof ZeroLayerError_ACU ? error.code
      : operation === 'auto_trigger' ? 'WORLD_SIMULATION_REVISION_CONFLICT' : 'WORLD_SIMULATION_PERSIST_FAILED'),
    message: failure?.message ?? (error instanceof Error ? error.message : String(error)),
    ...(typeof failure?.details?.primaryMessage === 'string' ? { primaryMessage: failure.details.primaryMessage } : {}),
    ...(typeof failure?.details?.rollbackMessage === 'string' ? { rollbackMessage: failure.details.rollbackMessage } : {}),
  });
}

function isRetryableWorldSimulationTransportError_ACU(error: unknown): boolean {
  if (error instanceof ZeroLayerError_ACU) return false;
  if (error instanceof WorldSimulationValidationError_ACU) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof Error && error.message === 'WORLD_SIMULATION_RUN_STALE') return false;
  return true;
}

async function invokeWorldSimulationAgent_ACU(
  ...args: Parameters<typeof invokeWorldSimulationAgentOnce_ACU>
): Promise<string | AiChatTurn_ACU> {
  return callContinuationInternalAiWithRetry_ACU(() => {
    if (args[4].aborted) throw new Error('WORLD_SIMULATION_RUN_STALE');
    return invokeWorldSimulationAgentOnce_ACU(...args);
  }, {
    transportRetries: WORLD_SIMULATION_TRANSPORT_RETRIES_ACU,
    retryDelaySeconds: WORLD_SIMULATION_RETRY_DELAY_SECONDS_ACU,
    isRetryable: isRetryableWorldSimulationTransportError_ACU,
    isCurrent: () => !args[4].aborted,
  });
}

async function invokeWorldSimulationAgentOnce_ACU(
  role: WorldSimulationAgentName_ACU,
  messages: readonly { role: string; content: string }[],
  preset: Parameters<typeof callAIWithResolvedPreset_ACU>[1],
  identity: WorldSimulationRunIdentity_ACU,
  signal: AbortSignal,
  request?: WorldSimulationInvokeTools_ACU,
  readConversation: () => WorldSimulationConversationView_ACU = () => readWorldSimulationConversation_ACU(getChatArray_ACU()),
): Promise<string | AiChatTurn_ACU> {
  const requestId = `${identity.runId}:${role}:${++internalRequestSequence_ACU}`;
  beginWorldSimulationInternalAiRequest_ACU({ requestId, runId: identity.runId, role });
  try {
    const definition = WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === role);
    // 调用方按工具模式给出请求体 tools 与缓存键标记；json 模式 tools 为空、缓存键带 mode:json。
    const tools = request?.tools ?? agentNativeTools_ACU(worldSimulationAgentNativeTools_ACU(role));
    const cacheTools = request?.cacheTools ?? worldSimulationAgentNativeTools_ACU(role);
    const boundary = readConversation().compaction?.report;
    const promptCacheKey = supportsExplicitOpenAiCacheKey_ACU(preset) ? buildOpenAiPromptCacheKey_ACU({
      chatIdentity: identity.chatIdentity, role,
      tools: [...cacheTools, ...(definition?.writableModules.map(module => `module:${module}`) ?? [])],
      boundary, preset,
    }) : undefined;
    const response = await callAIChatTurn_ACU([...messages], preset, signal, {
      beforeMainApiCall: () => beginWorldSimulationInternalAiMainApiInvocation_ACU(requestId),
      afterMainApiCall: () => endWorldSimulationInternalAiMainApiInvocation_ACU(requestId),
    }, {
      ...(promptCacheKey ? { promptCacheKey } : {}),
      tools: [...tools],
    });
    if (response.content.trim() || response.toolCalls.length) return response;
    throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_loop', '格林推演 Agent 返回空响应', false, { role },
    ));
  } finally {
    settleWorldSimulationInternalAiRequest_ACU(requestId);
  }
}

function sameHostAnchor_ACU(left: { chatIdentity: string; messageKey: string; swipeId: string; contentDigest: string }, right: { chatIdentity: string; messageKey: string; swipeId: string; contentDigest: string }): boolean {
  return left.chatIdentity === right.chatIdentity && left.messageKey === right.messageKey
    && left.swipeId === right.swipeId && left.contentDigest === right.contentDigest;
}

/** 只把本次完成 assistant 作为上一 source 的真实首后继；HTTP 成功本身绝不等于采用。 */
async function reconcilePreviousHostWorldDelivery_ACU(
  successor: WorldSimulationAnchorIdentity_ACU,
): Promise<void> {
  const chat = getChatArray_ACU();
  const history = new WorldDeliveryHostStore_ACU(successor).readHistory();
  for (const delivery of history.records) {
    if (delivery.source.kind === 'logical' || (delivery.status !== 'attempted' && delivery.status !== 'response-durable')) continue;
    let source: WorldSimulationAnchorIdentity_ACU | null = null;
    for (let index = 0; index < chat.length; index += 1) {
      if (!isAiMessage_ACU(chat[index])) continue;
      const candidate = resolveWorldSimulationAnchor_ACU(index, chat);
      if (sameHostAnchor_ACU(candidate, delivery.source)) { source = candidate; break; }
    }
    if (!source) continue;
    const sourceIndex = source.messageIndex;
    const firstSuccessorIndex = chat.findIndex((message, index) => index > sourceIndex && isAiMessage_ACU(message));
    if (firstSuccessorIndex !== successor.messageIndex) continue;
    const store = new WorldDeliveryHostStore_ACU(source);
    if (delivery.status === 'attempted') await store.recordDurableSuccessor(delivery.deliveryId);
  }
}

function createProductionOrchestrator_ACU(logicalStore?: ZeroLayerSimulationStore_ACU): WorldSimulationOrchestrator_ACU {
  const store = logicalStore ?? new FirstFloorWorldSimulationStore_ACU();
  const resolveAnchor = (anchor: WorldSimulationTargetAnchor_ACU): WorldSimulationTargetAnchor_ACU => {
    if (logicalStore) { logicalStore.assertAnchor(anchor); return anchor; }
    return resolveCurrentWorldSimulationAnchor_ACU(requireWorldSimulationHostAnchor_ACU(anchor), getChatArray_ACU());
  };
  const readChat = (anchor: WorldSimulationTargetAnchor_ACU): any[] => {
    if (logicalStore) { logicalStore.assertAnchor(anchor); return logicalStore.readChat(anchor); }
    return getChatArray_ACU();
  };
  const readView = (anchor: WorldSimulationTargetAnchor_ACU) => {
    if (logicalStore) { logicalStore.assertAnchor(anchor); return logicalStore.readView(); }
    const chat = getChatArray_ACU();
    const current = resolveCurrentWorldSimulationAnchor_ACU(requireWorldSimulationHostAnchor_ACU(anchor), chat);
    const folded = foldWorldSimulationLedger_ACU(chat, current.messageIndex);
    const envelope = store.read();
    if (!folded && !envelope) throw new Error('WORLD_SIMULATION_LEDGER_UNAVAILABLE');
    return { ledger: folded?.ledger ?? envelope!.ledger, fields: folded?.fields,
      archive: foldWorldSimulationArchive_ACU(chat, current.messageIndex).snapshot };
  };
  const contextSource = (anchor: WorldSimulationTargetAnchor_ACU) => {
    if (!logicalStore) return {};
    logicalStore.assertAnchor(anchor);
    const state = logicalStore.readState();
    return { conversation: projectWorldSimulationConversationSegments_ACU(state.conversation.segments),
      userRequirements: state.userRequirements,
      anchorBody: logicalStore.readSource().turns.find(turn => turn.turnId === anchor.logicalRef.turnId)!.body! };
  };
  return new WorldSimulationOrchestrator_ACU({
    store,
    assertCanOperate: logicalStore ? () => logicalStore.store.assertCanOperate() : undefined,
    now: () => Date.now(),
    allocateId: allocateId_ACU,
    workflowProtocol: 'world-round-v1',
    assertAnchorCurrent: anchor => { resolveAnchor(anchor); },
    readResumeLedgerRevision: (identity, anchor) => {
      const currentAnchor = resolveAnchor(anchor);
      if (identity.workflowProtocol !== 'world-round-v1') {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '旧运行已退役，请结束旧任务后重新启动新推演', false,
        ));
      }
      return readView(currentAnchor).ledger.revision;
    },
    checkResumeMaterials: async (identity, anchor, envelope, signal) => {
      if (identity.workflowProtocol !== 'world-round-v1') return;
      if (signal.aborted) throw new Error('WORLD_SIMULATION_RUN_STALE');
      const frozen = envelope.task?.runMaterials;
      if (!frozen) throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CONFIG_INVALID', 'load', '新整轮协议缺少冻结资料，拒绝恢复旧存档', false,
      ));
      const currentAnchor = resolveAnchor(anchor);
      const requirementsResult = logicalStore
        ? { snapshot: validateWorldSimulationUserRequirementsSnapshot_ACU(logicalStore.readState().userRequirements), diagnostics: [] as string[] }
        : readLatestWorldSimulationUserRequirements_ACU(readChat(currentAnchor));
      if (!logicalStore && requirementsResult.snapshot === null && requirementsResult.diagnostics.length) {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '用户长期要求快照损坏，拒绝恢复整轮推演', false,
          { diagnostics: requirementsResult.diagnostics },
        ));
      }
      const userRequirements = requirementsResult.snapshot === null ? undefined
        : validateWorldSimulationUserRequirementsSnapshot_ACU(requirementsResult.snapshot);
      const worldbookSnapshot = await loadAgentWorldbookSnapshot_ACU();
      if (signal.aborted) throw new Error('WORLD_SIMULATION_RUN_STALE');
      resolveAnchor(currentAnchor);
      const current = store.read();
      if (!current?.task || current.task.taskId !== envelope.task?.taskId || current.task.status !== 'paused'
        || !current.task.activeRun || JSON.stringify(current.task.activeRun) !== JSON.stringify(identity)
        || current.ledger.revision !== identity.baseLedgerRevision || !current.task.runMaterials
        || !sameWorldRunMaterials_ACU(current.task.runMaterials, frozen)) {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '恢复资料核验期间任务已变化', true,
        ));
      }
      let actual;
      try {
        actual = buildWorldRunMaterials_ACU({ instruction: current.task.originInstruction, userRequirements, worldbookSnapshot,
          worldRoundPrompts: current.settings.worldRoundPrompts, workflowMode: identity.workflowMode,
          deliveryTarget: identity.deliveryTarget });
      } catch (error) {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '世界书资料不可用或格式无效，拒绝恢复整轮推演', false,
          { cause: error instanceof Error ? error.message : String(error) },
        ));
      }
      if (!sameWorldRunMaterials_ACU(frozen, actual)) {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_REVISION_CONFLICT', 'load', '世界书、长期要求、原始意图或有效提示词已变化，拒绝恢复整轮推演', false,
        ));
      }
    },
    commitRound: input => {
      if (logicalStore) {
        const anchor = input.anchor as import('./agent/agent-model').WorldSimulationLogicalAnchorIdentity_ACU;
        return input.reviewedReveal
          ? commitZeroLayerReviewedSimulationRound_ACU(logicalStore, { ...input, anchor,
            proof: input.reviewedReveal.proof, factIds: input.reviewedReveal.factIds })
          : commitZeroLayerSimulationRound_ACU(logicalStore, { ...input, anchor });
      }
      assertWorldSimulationHostRun_ACU(input.identity);
      return input.reviewedReveal
        ? commitReviewedWorldSimulationRound_ACU({ ...input, anchor: requireWorldSimulationHostAnchor_ACU(input.anchor),
          proof: input.reviewedReveal.proof, factIds: input.reviewedReveal.factIds,
          commitCandidate: { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId,
            stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision,
            summary: input.summary, acceptedCandidates: [], evidenceRefs: [] } })
        : commitWorldSimulationRound_ACU({ ...input, anchor: requireWorldSimulationHostAnchor_ACU(input.anchor),
          commitCandidate: { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId,
            stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision,
            summary: input.summary, acceptedCandidates: [], evidenceRefs: [] } });
    },
    commitProjection: input => {
      if (input.identity.workflowProtocol !== 'world-round-v1') {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '旧运行已退役，请结束旧任务后重新启动新推演', false,
        ));
      }
      if (logicalStore) return commitZeroLayerSimulationFinal_ACU(logicalStore, input);
      assertWorldSimulationHostRun_ACU(input.identity);
      return commitWorldSimulationProjection_ACU({ ...input, anchor: requireWorldSimulationHostAnchor_ACU(input.anchor) });
    },
    persistCompletion: async ({ identity, anchor, outcome, summary }) => {
      if (identity.workflowProtocol !== 'world-round-v1') {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '旧运行已退役，请结束旧任务后重新启动新推演', false,
        ));
      }
      if (logicalStore) {
        logicalStore.assertAnchor(anchor);
        await appendZeroLayerSimulationSessionEvent_ACU(logicalStore, anchor, { ...identity,
          eventKey: `run-completed-${outcome}`, idempotent: true,
          event: { kind: 'run_completed', title: outcome === 'commit' ? '整轮推演已提交' : '整轮推演无变化', detail: summary, agentName: 'world-round' } });
        return;
      }
      assertWorldSimulationHostRun_ACU(identity);
      const chat = getChatArray_ACU();
      const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(requireWorldSimulationHostAnchor_ACU(anchor), chat);
      await appendWorldSimulationSessionEvent_ACU({
        anchor: currentAnchor, runId: identity.runId, taskId: identity.taskId,
        stageId: identity.stageId, stageRevision: identity.stageRevision,
        eventKey: `run-completed-${outcome}`,
        event: { kind: 'run_completed', title: outcome === 'commit' ? '整轮推演已提交' : '整轮推演无变化', detail: summary, agentName: 'world-round' },
      }, chat);
    },
    appendUserMessage: async ({ identity, anchor, text, idempotent }) => {
      if (identity.workflowProtocol !== 'world-round-v1') {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '旧运行已退役，请结束旧任务后重新启动新推演', false,
        ));
      }
      if (logicalStore) {
        logicalStore.assertAnchor(anchor);
        logWorldSimulationSession_ACU(identity.chatIdentity, { kind: 'user_message', title: '你的消息', detail: text });
        await appendZeroLayerSimulationUserInstruction_ACU(logicalStore, anchor, { ...identity, text, idempotent });
        return;
      }
      assertWorldSimulationHostRun_ACU(identity);
      const hostAnchor = requireWorldSimulationHostAnchor_ACU(anchor);
      // 与智能续写 recordUserMessage 同语义：用户指令先写会话流（实时显示），再持久化到楼层锚定会话。
      logWorldSimulationSession_ACU(identity.chatIdentity, { kind: 'user_message', title: '你的消息', detail: text });
      await appendWorldSimulationUserInstruction_ACU({
        anchor: hostAnchor,
        runId: identity.runId,
        taskId: identity.taskId,
        stageId: identity.stageId,
        stageRevision: identity.stageRevision,
        triggerConversationMessageId: identity.triggerConversationMessageId,
        text,
        idempotent,
      }, getChatArray_ACU());
    },
    prepare: async ({ identity, anchor, instruction, envelope, signal, resetRunBudget, targetModules }) => {
      if (identity.workflowProtocol !== 'world-round-v1') {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '旧运行已退役，请结束旧任务后重新启动新推演', false,
        ));
      }
      if (!logicalStore) assertWorldSimulationHostRun_ACU(identity);
      const currentAnchor = resolveAnchor(anchor);
      const runProof = logicalStore
        ? (logicalStore.assertAnchor(currentAnchor), logicalStore.readState().runProof)
        : readWorldSimulationRunWriteProof_ACU(requireWorldSimulationHostAnchor_ACU(currentAnchor), getChatArray_ACU());
      const view = readView(currentAnchor);
      if (runProof || hasPartialWorldSimulationRunWrites_ACU(view)) {
          throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
            'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '新整轮协议不能混合旧逐栏写入或运行证明', false,
          ));
        }
        const anchorBody = logicalStore
          ? contextSource(currentAnchor).anchorBody!
          : anchorText_ACU(requireWorldSimulationHostAnchor_ACU(currentAnchor), readChat(currentAnchor));
        const historyDeliveryText = logicalStore ? (() => {
          logicalStore.assertAnchor(currentAnchor);
          const turn = logicalStore.readSource().turns.find(item => item.turnId === currentAnchor.logicalRef.turnId
            && item.attemptId === currentAnchor.logicalRef.attemptId);
          const candidate = turn?.plotCandidate;
          return candidate?.outcome === 'generated' && typeof candidate.finalMessage === 'string'
            ? candidate.finalMessage : '';
        })() : (() => {
          const chat = readChat(currentAnchor);
          const hostAnchor = resolveCurrentWorldSimulationAnchor_ACU(requireWorldSimulationHostAnchor_ACU(currentAnchor), chat);
          const user = chat[hostAnchor.messageIndex - 1];
          // qrf_plot 是原始任务记录，可能含未注入的 physio_state；优先使用同楼层保存的最终投送文本。
          const plot = user?.is_user === true && typeof user.qrf_plot === 'string' ? user.qrf_plot : '';
          if (!plot.trim()) return '';
          const savedDelivery = user._qrf_plot_final_message;
          if (typeof savedDelivery === 'string') return savedDelivery;
          // 旧档没有独立最终文本，仅在用户楼层正文可辨认为剧情注入时回退；不信任任意原始任务。
          const mes = typeof user.mes === 'string' ? user.mes : '';
          if (!mes.trim()) return '';
          const deliveredTag = /<([a-z][\w-]*)>([\s\S]*?)<\/\1>/gi;
          const hasSharedTag = [...plot.matchAll(deliveredTag)].some(match => mes.includes(match[0]));
          return mes.includes('[SYSTEM_DIRECTIVE:') || hasSharedTag ? mes : '';
        })();
        const invoke = (role: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[], preset: Parameters<typeof callAIWithResolvedPreset_ACU>[1], request?: WorldSimulationInvokeTools_ACU) =>
          invokeWorldSimulationAgent_ACU(role, messages, preset, identity, signal, request, () => {
            if (!logicalStore) return readWorldSimulationConversation_ACU(getChatArray_ACU());
            logicalStore.assertAnchor(currentAnchor);
            const state = logicalStore.readState();
            if (state.envelope?.task?.activeRun?.runId !== identity.runId) {
              throw new ZeroLayerError_ACU('scope-changed', '推演请求运行租约已失效。');
            }
            return projectWorldSimulationConversationSegments_ACU(state.conversation.segments);
          });
        const requirementsResult = logicalStore
          ? { snapshot: validateWorldSimulationUserRequirementsSnapshot_ACU(logicalStore.readState().userRequirements), diagnostics: [] as string[] }
          : readLatestWorldSimulationUserRequirements_ACU(readChat(currentAnchor));
        if (!logicalStore && requirementsResult.snapshot === null && requirementsResult.diagnostics.length) {
          throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
            'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '用户长期要求快照损坏，已拒绝本轮而非伪装为空要求', false,
            { diagnostics: requirementsResult.diagnostics },
          ));
        }
        const userRequirements: WorldSimulationUserRequirementsSnapshot_ACU | undefined = requirementsResult.snapshot === null
          ? undefined : validateWorldSimulationUserRequirementsSnapshot_ACU(requirementsResult.snapshot);
        const frozenLedger = structuredClone(envelope.ledger);
        const sameLedger = (left: unknown, right: unknown): boolean => {
          if (left === right) return true;
          if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
          if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length && left.every((item, index) => sameLedger(item, right[index]));
          const leftRecord = left as Record<string, unknown>; const rightRecord = right as Record<string, unknown>;
          const leftKeys = Object.keys(leftRecord).sort(); const rightKeys = Object.keys(rightRecord).sort();
          return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
            && sameLedger(leftRecord[key], rightRecord[key]));
        };
        const sameRun = (active: WorldSimulationRunIdentity_ACU): boolean => {
          const scalarKeys: Array<keyof WorldSimulationRunIdentity_ACU> = [
            'kind', 'chatIdentity', 'triggerKind', 'triggerConversationMessageId', 'anchorContentDigest', 'baseLedgerRevision',
            'taskId', 'stageId', 'stageRevision', 'runId', 'deliveryTarget', 'workflowMode', 'workflowProtocol',
          ];
          if (scalarKeys.some(key => active[key] !== identity[key])
            || !sameWorldSimulationTargetRef_ACU(worldSimulationRunTargetRef_ACU(active), worldSimulationRunTargetRef_ACU(identity))) return false;
          if (active.kind === 'logical' || identity.kind === 'logical') {
            return active.kind === 'logical' && identity.kind === 'logical'
              && active.logicalRef.sessionId === identity.logicalRef.sessionId && active.logicalRef.branchId === identity.logicalRef.branchId
              && active.logicalRef.turnId === identity.logicalRef.turnId && active.logicalRef.attemptId === identity.logicalRef.attemptId
              && active.logicalRef.floorId === identity.logicalRef.floorId;
          }
          return active.anchorMessageId === identity.anchorMessageId && active.anchorMessageKey === identity.anchorMessageKey
            && active.anchorSwipeId === identity.anchorSwipeId;
        };
        const beforeWorldbookLoad = () => {
          if (signal.aborted) throw new Error('WORLD_SIMULATION_RUN_STALE');
          const current = store.read(); const active = current?.task?.activeRun;
          if (!current || current.task?.taskId !== identity.taskId || !active
            || !sameRun(active)
            || current.ledger.revision !== identity.baseLedgerRevision || !sameLedger(current.ledger, frozenLedger)) {
            throw new Error('WORLD_SIMULATION_RUN_STALE');
          }
          resolveAnchor(currentAnchor);
        };
        beforeWorldbookLoad();
        const tableData = logicalStore ? (() => {
          logicalStore.assertAnchor(currentAnchor);
          const turn = logicalStore.readSource().turns.find(item => item.turnId === currentAnchor.logicalRef.turnId
            && item.attemptId === currentAnchor.logicalRef.attemptId && item.branchId === currentAnchor.logicalRef.branchId);
          if (!turn) throw new ZeroLayerError_ACU('revision-conflict', '逻辑表格锚点已变化。');
          return readLogicalWorldTableSnapshot_ACU(turn, logicalStore.sessionId);
        })() : await readHostWorldTableSnapshot_ACU(readChat(currentAnchor),
          requireWorldSimulationHostAnchor_ACU(currentAnchor).messageIndex);
        beforeWorldbookLoad();
        const worldbookSnapshot = await loadAgentWorldbookSnapshot_ACU();
        beforeWorldbookLoad();
        let runMaterials;
        try {
          runMaterials = buildWorldRunMaterials_ACU({ instruction: envelope.task?.originInstruction ?? instruction, userRequirements, worldbookSnapshot,
            worldRoundPrompts: envelope.settings.worldRoundPrompts, workflowMode: identity.workflowMode,
            deliveryTarget: identity.deliveryTarget });
        } catch (error) {
          throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
            'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '世界书资料不可用或格式无效，拒绝开始整轮推演', false,
            { cause: error instanceof Error ? error.message : String(error) },
          ));
        }
        const isResume = envelope.task?.status === 'paused';
        if (isResume) {
          if (!envelope.task?.runMaterials || !sameWorldRunMaterials_ACU(envelope.task.runMaterials, runMaterials)) {
            throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
              'WORLD_SIMULATION_REVISION_CONFLICT', 'load', '恢复资料与冻结资料不一致，拒绝继续整轮推演', false,
            ));
          }
        } else {
          // 首次 prepare 在模型调用前只冻结 task.runMaterials 与 updatedAt；不得触碰预留 identity、阶段或账本。
          const frozenAt = Date.now();
          await store.updateAtomically(current => {
            const active = current?.task?.activeRun;
            if (!current?.task || current.task.taskId !== identity.taskId || current.task.status !== 'drafting'
              || !active || !sameRun(active) || current.task.runMaterials !== undefined) {
              throw new Error('WORLD_SIMULATION_RUN_STALE');
            }
            return { ...current, task: { ...current.task, runMaterials, updatedAt: frozenAt }, updatedAt: frozenAt };
          }, { chatIdentity: identity.chatIdentity, taskId: identity.taskId, stageId: identity.stageId, revision: identity.stageRevision });
          beforeWorldbookLoad();
          const persistedMaterials = store.read()?.task?.runMaterials;
          if (!persistedMaterials || !sameWorldRunMaterials_ACU(persistedMaterials, runMaterials)) {
            throw new Error('WORLD_SIMULATION_RUN_STALE');
          }
        }
        const progressEntries = new Map<string, number>();
        const onProgress = async (eventKey: string, event: WorldSimulationSessionInput_ACU): Promise<void> => {
          const entryId = progressEntries.get(eventKey);
          if (entryId === undefined) {
            progressEntries.set(eventKey, logWorldSimulationSession_ACU(identity.chatIdentity, event));
          } else {
            updateWorldSimulationSession_ACU(identity.chatIdentity, entryId, event);
          }
          if (event.status === 'running') return;
          try {
            if (logicalStore) {
              logicalStore.assertAnchor(currentAnchor);
              await appendZeroLayerSimulationSessionEvent_ACU(logicalStore, currentAnchor, {
                ...identity, eventKey, event,
              });
            } else {
              const chat = getChatArray_ACU();
              await appendWorldSimulationSessionEvent_ACU({
                anchor: resolveCurrentWorldSimulationAnchor_ACU(requireWorldSimulationHostAnchor_ACU(currentAnchor), chat),
                runId: identity.runId, taskId: identity.taskId, stageId: identity.stageId,
                stageRevision: identity.stageRevision, eventKey, event,
              }, chat);
            }
          } catch (error) {
            logRuntimeFailure_ACU('persist_progress', error, identity);
            logWorldSimulationSession_ACU(identity.chatIdentity, {
              kind: 'thought', title: '阶段进度记录未保存', detail: '实时进度仍可查看，刷新后可能缺少该条记录。',
              ok: false, status: 'failed',
            });
          }
        };
        const prepared = prepareWorldRoundRun_ACU({
          identity, envelope: store.read()!, anchor: currentAnchor, anchorBody, historyDeliveryText, signal, invoke, onProgress,
          confirmActorRegistration: confirmWorldActorRegistration_ACU,
          // 从持久化首次意图重建，避免任何恢复机械文本污染 round payload。
          instruction: store.read()!.task!.originInstruction,
          ...(userRequirements ? { userRequirements } : {}),
          worldbookSnapshot,
          tableData,
          runMaterials,
          readCurrent: () => store.read(),
          assertAnchorCurrent: () => { resolveAnchor(currentAnchor); },
          hasLegacyWrites: false,
        });
        return {
          revision: prepared.revision,
          execute: async runIdentity => {
            beginWorldSimulationSessionRun_ACU(identity.chatIdentity,
              identity.workflowMode === 'single' ? '单 Agent 推演' : '分层推演', '', isResume);
            const engine = new WorldSimulationStageExecutionEngine_ACU({
              readEnvelope: () => store.read(),
              getChatIdentity: () => logicalStore ? logicalStore.getChatIdentity() : getActiveChatStorageIdentity_ACU(getChatArray_ACU()),
              assertAnchorCurrent: currentIdentity => {
                if (logicalStore) { logicalStore.restoreAnchor(currentIdentity); return; }
                const restored = restoreWorldSimulationAnchor_ACU(currentIdentity, getChatArray_ACU());
                assertWorldSimulationAnchorCurrent_ACU(restored, getChatArray_ACU());
              },
              runMainLoop: () => prepared.execute(runIdentity),
            });
            return engine.run({ identity: runIdentity });
          },
        };
    },
  });
}

export type WorldLegacyBackfillPlan_ACU = ReturnType<typeof planWorldLegacyBackfill_ACU>;

export interface WorldSimulationUiSnapshot_ACU {
  envelope: WorldSimulationEnvelope_ACU | null;
  /** 零层资料展示与运行 envelope 分开；null 表示尚无已发布账本。 */
  publishedLedger?: WorldSimulationEnvelope_ACU['ledger'] | null;
  /** 旧账本迁移归档的派生只读复核；无可展示账本时为 null。 */
  migrationReview?: WorldLegacyMigrationReview_ACU | null;
  conversation: ReturnType<typeof readWorldSimulationConversation_ACU>;
  materials: ReturnType<typeof readLatestWorldSimulationMaterials_ACU>;
  /** 账本分栏视图：partial 记录只出现在这里，面板据此按模块/ID 展示已写字段与缺栏。 */
  fieldSnapshot: ReturnType<typeof readWorldSimulationLedgerFieldSnapshot_ACU>;
  userRequirements: ReturnType<typeof readLatestWorldSimulationUserRequirements_ACU>;
  session: {
    chatIdentity: string | null;
    entries: ReturnType<typeof readWorldSimulationSessionLog_ACU>;
    running: boolean;
  };
  anchor: WorldSimulationTargetAnchor_ACU | null;
  projectionPreview: string | null;
}

/** 非模型终局 stopReason 的中文文案；模型给出的 blocked 摘要不在表内，原样展示。 */
export const WORLD_SIMULATION_STOP_REASON_LABELS_ACU: Record<string, string> = {
  [WORLD_SIMULATION_STOP_REASON_MANUAL_ACU]: '用户手动停止',
  [WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU]: '运行被中断（页面重载或事件丢失），可直接恢复',
  [WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU]: '已被更新楼层的推演取代',
  cancelled: '已取消',
};

/** 格林推演写在各楼层上的非权威分桶字段：会话 segment、材料快照、账本状态快照、run 恢复状态。 */
const WORLD_SIMULATION_FLOOR_FIELDS_ACU = [
  WORLD_SIMULATION_STATE_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
  WORLD_SIMULATION_RUN_STATE_FIELD_ACU,
  WORLD_SIMULATION_RUN_WRITE_FIELD_ACU,
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
] as const;

const RESUME_KEYWORD_ACU = /^(继续|开始|恢复(?:任务)?|resume|continue)$/i;

export class WorldSimulationRuntime_ACU {
  private readonly orchestrator: WorldSimulationOrchestrator_ACU;
  private disposed = false;
  private actorScan: { controller: AbortController; completion: Promise<{ addedCount: number; bookCount: number; failedBookNames: string[] } | null> } | null = null;
  /** 预览只在运行时内存中保留，不构成持久授权或证明。 */
  private legacyBackfillPreview: { chatIdentity: string; fingerprint: string; anchor?: WorldSimulationAnchorIdentity_ACU } | null = null;
  constructor(
    orchestrator?: WorldSimulationOrchestrator_ACU,
    private readonly getChat: () => any[] = getChatArray_ACU,
    private readonly logicalStore?: ZeroLayerSimulationStore_ACU,
  ) { this.orchestrator = orchestrator ?? createProductionOrchestrator_ACU(logicalStore); }

  private assertScope_ACU(): void {
    if (this.disposed) throw new ZeroLayerError_ACU('scope-changed', '推演运行时作用域已失效。');
    if (this.logicalStore) this.logicalStore.readSource();
    else if (readEnabledSimulationCarrier_ACU(this.getChat())) {
      throw new ZeroLayerError_ACU('scope-changed', '逻辑模式不能使用普通推演运行时。');
    }
  }
  private getChatIdentity_ACU(): string {
    this.assertScope_ACU();
    return this.logicalStore?.getChatIdentity() ?? getActiveChatStorageIdentity_ACU(this.getChat());
  }
  private getStore_ACU() { return this.logicalStore ?? new FirstFloorWorldSimulationStore_ACU(); }

  private assertActiveRunUsesWorldRoundProtocol_ACU(envelope: WorldSimulationEnvelope_ACU | null): void {
    const identity = envelope?.task?.activeRun;
    if (identity && identity.workflowProtocol !== 'world-round-v1') {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CONFIG_INVALID', 'agent_loop', '旧运行已退役，请结束旧任务后重新启动新推演', false,
      ));
    }
  }

  async initialize(): Promise<void> {
    this.assertScope_ACU();
    this.getStore_ACU().read();
  }

  /** 读取派生视图：重载后残留的 running 以 paused/interrupted 呈现，不落盘。 */
  private readEnvelopeView_ACU(): WorldSimulationEnvelope_ACU | null {
    this.assertScope_ACU();
    return this.orchestrator.deriveEnvelopeView(this.getStore_ACU().read());
  }

  /** 恢复冻结锚点；锚点楼层已删除 / swipe 已切换时返回 null，由调用方决定取代或阻断，不让整页读取失败。 */
  private restoreAnchorOrNull_ACU(identity: WorldSimulationRunIdentity_ACU, chat: any[]): WorldSimulationTargetAnchor_ACU | null {
    this.assertScope_ACU();
    if (this.logicalStore) return this.logicalStore.restoreAnchor(identity);
    try {
      return restoreWorldSimulationAnchor_ACU(identity, chat);
    } catch {
      return null;
    }
  }

  readUiSnapshot(): WorldSimulationUiSnapshot_ACU {
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU() || null;
    const envelope = this.readEnvelopeView_ACU();
    let anchor: WorldSimulationTargetAnchor_ACU | null = envelope?.task?.activeRun
      ? this.restoreAnchorOrNull_ACU(envelope.task.activeRun, chat)
      : null;
    if (this.logicalStore) {
      const state = this.logicalStore.readState();
      const published = readZeroLayerPublishedMaterials_ACU(this.logicalStore.readSource()).simulation
        ?? emptyZeroLayerSimulation_ACU();
      anchor ??= this.logicalStore.latestAnchor();
      return {
        envelope, anchor,
        publishedLedger: published.envelope?.ledger ?? null,
        migrationReview: published.envelope ? reviewWorldLegacyMigration_ACU(published.envelope.ledger, published.archive) : null,
        conversation: projectWorldSimulationConversationSegments_ACU(state.conversation.segments),
        materials: { snapshot: published.envelope ? { schemaVersion: 1, ledgerRevision: published.envelope.ledger.revision,
          ledger: published.envelope.ledger, evidenceRefs: published.runProof?.evidenceRefs ?? [], updatedAt: published.envelope.updatedAt } : null,
          diagnostics: [], adoptedIndex: null },
        fieldSnapshot: published.fields,
        userRequirements: { snapshot: published.userRequirements, diagnostics: [], adoptedIndex: null },
        session: { chatIdentity,
          entries: chatIdentity ? readWorldSimulationSessionLog_ACU(chatIdentity) : [],
          running: chatIdentity ? isWorldSimulationSessionRunning_ACU(chatIdentity) : false },
        projectionPreview: published.envelope ? buildWorldSimulationProjection_ACU(published.envelope.ledger, published.envelope.settings.projection.template) : null,
      };
    }
    if (!anchor) {
      const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
      anchor = resolved.kind === 'resolved' ? resolved.anchor : null;
    }
    return {
      envelope,
      conversation: readWorldSimulationConversation_ACU(chat),
      materials: readLatestWorldSimulationMaterials_ACU(chat),
      fieldSnapshot: readWorldSimulationLedgerFieldSnapshot_ACU(chat),
      userRequirements: readLatestWorldSimulationUserRequirements_ACU(chat),
      session: {
        chatIdentity,
        entries: chatIdentity ? readWorldSimulationSessionLog_ACU(chatIdentity) : [],
        running: chatIdentity ? isWorldSimulationSessionRunning_ACU(chatIdentity) : false,
      },
      anchor,
      migrationReview: envelope?.ledger
        ? reviewWorldLegacyMigration_ACU(envelope.ledger, foldWorldSimulationArchive_ACU(chat).snapshot)
        : null,
      projectionPreview: envelope ? buildWorldSimulationProjection_ACU(envelope.ledger, envelope.settings.projection.template) : null,
    };
  }

  isInFlight(): boolean {
    const chatIdentity = this.getChatIdentity_ACU();
    return this.actorScan !== null || (chatIdentity ? this.orchestrator.isInFlight(chatIdentity) : false);
  }

  previewLegacyBackfill(): WorldLegacyBackfillPlan_ACU {
    this.assertScope_ACU();
    this.legacyBackfillPreview = null;
    const chatIdentity = this.getChatIdentity_ACU();
    if (this.isInFlight()) throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_REVISION_CONFLICT', 'load', '推演正在运行，请结束后再补迁', false,
    ));
    if (this.logicalStore) {
      const source = readZeroLayerLegacyBackfillSource_ACU(this.logicalStore);
      const plan = planWorldLegacyBackfill_ACU(source.ledger, source.archive);
      this.legacyBackfillPreview = { chatIdentity, fingerprint: legacyBackfillFingerprint_ACU(source.ledger, source.archive) };
      return plan;
    }
    const chat = this.getChat();
    const ledger = foldWorldSimulationLedger_ACU(chat)?.ledger ?? this.getStore_ACU().read()?.ledger;
    if (!ledger) throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '没有权威账本，无法预览旧账本补迁', false,
    ));
    const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
    if (resolved.kind !== 'resolved') throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '没有稳定 assistant 正文，无法补迁', false,
    ));
    const archive = foldWorldSimulationArchive_ACU(chat).snapshot;
    const plan = planWorldLegacyBackfill_ACU(ledger, archive);
    this.legacyBackfillPreview = { chatIdentity, fingerprint: legacyBackfillFingerprint_ACU(ledger, archive), anchor: resolved.anchor };
    return plan;
  }

  async applyLegacyBackfill(): Promise<WorldLegacyBackfillPlan_ACU> {
    this.assertScope_ACU();
    const preview = this.legacyBackfillPreview;
    if (!preview || preview.chatIdentity !== this.getChatIdentity_ACU() || this.isInFlight()) {
      this.legacyBackfillPreview = null;
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '请在推演结束后重新预览旧资料补迁', false,
      ));
    }
    try {
      return this.logicalStore
        ? await commitZeroLayerLegacyBackfill_ACU(this.logicalStore, preview.fingerprint)
        : await applyWorldLegacyBackfillHost_ACU(preview.fingerprint, preview.anchor);
    } finally {
      this.legacyBackfillPreview = null;
    }
  }

  async handleAssistantCompletion(intent: Parameters<typeof resolveWorldSimulationAssistantCompletion_ACU>[0]): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    if (this.actorScan) await this.stop();
    if (this.logicalStore) { this.assertScope_ACU(); return null; }
    this.assertScope_ACU();
    this.getStore_ACU().read();
    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, { getChat: this.getChat, delay: ms => new Promise(resolve => setTimeout(resolve, ms)) });
    if (resolved.kind !== 'resolved') {
      logWarn_ACU(`格林推演自动触发跳过：锚点解析失败（${resolved.reason}）`);
      return null;
    }
    try {
      await reconcilePreviousHostWorldDelivery_ACU(resolved.anchor);
      const outcome = await this.orchestrator.start({ triggerKind: 'assistant_completed', anchor: resolved.anchor, instruction: '根据最新 assistant 正文推进世界状态' });
      if (outcome.status === 'skipped') logDebug_ACU(`格林推演自动触发跳过：orchestrator skipped（${outcome.reason}）`);
      return outcome;
    } catch (error) {
      logRuntimeFailure_ACU('auto_trigger', error, undefined, resolved.anchor.chatIdentity);
      throw error;
    }
  }

  /** 从已保存的逻辑正文结算；已确认结果只回读，暂停运行只恢复，不重发正文。 */
  async handleLogicalCompletion(envelope: ZeroLayerEnvelope_ACU, turnId: string, attemptId: string,
    signal: AbortSignal): Promise<void> {
    if (this.actorScan) await this.stop();
    this.assertScope_ACU();
    const store: ZeroLayerSimulationStore_ACU | undefined = this.logicalStore;
    if (!store || envelope.sessionId !== store.sessionId || envelope.activeBranchId !== store.branchId) {
      throw new ZeroLayerError_ACU('scope-changed', '逻辑正文与推演运行时不属于同一作用域。');
    }
    const readTurn = () => {
      if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '逻辑正文结算已中止。');
      const turn = store.readSource().turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
      if (!turn || turn.branchId !== store.branchId) throw new ZeroLayerError_ACU('revision-conflict', '逻辑正文结算身份已变化。');
      return turn;
    };
    const turn = readTurn();
    if (turn.effectReceipts.some(receipt => receipt.kind === 'simulation')) {
      validateZeroLayerSimulationReceipt_ACU(turn, store.sessionId);
      return;
    }
    const anchor = store.anchorForTurn(turnId);
    store.assertAnchor(anchor);
    const existing = this.readEnvelopeView_ACU();
    const run = existing?.task?.activeRun;
    if (run && run.kind === 'logical' && run.logicalRef.turnId === turnId) {
      if (this.orchestrator.isInFlight(run.chatIdentity)) {
        throw new ZeroLayerError_ACU('effects-pending', '该逻辑正文的推演仍在执行。');
      }
    } else if (settings_ACU.worldSimulationPageEnabled !== true || existing?.settings.autoTriggerEnabled === false) {
      await store.skipAutomatic(anchor);
      validateZeroLayerSimulationReceipt_ACU(readTurn(), store.sessionId);
      return;
    }
    const abort = () => { this.orchestrator.cancel(store.getChatIdentity()); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      readTurn();
      const outcome = run && run.kind === 'logical' && run.logicalRef.turnId === turnId
        ? await this.orchestrator.resume({ anchor })
        : await this.orchestrator.start({ triggerKind: 'assistant_completed', anchor, instruction: '根据本轮已保存的正文推进世界状态' });
      const saved = readTurn();
      if (!saved.effectReceipts.some(receipt => receipt.kind === 'simulation')) {
        throw new ZeroLayerError_ACU('effects-pending', outcome.status === 'failed' ? outcome.error.message
          : '逻辑正文推演尚未取得持久结果，请恢复结算。');
      }
      validateZeroLayerSimulationReceipt_ACU(saved, store.sessionId);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  /**
   * Agent 会话发送。
   * - 在途运行先打断并等待其落盘为 paused；
   * - 存在暂停中的运行且冻结锚点仍可恢复 → 带着这句话 resume 同一 run，并重置派工/迭代预算；
   * - 锚点已失效（楼层删除 / swipe 变更）→ 新建运行；
   * - 空闲 → 新建运行。
   * 无 assistant 楼层或空指令时返回 null，不调用模型。
   */
  async sendAgentMessage(text: string, triggerConversationMessageId?: string): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    if (this.actorScan) await this.stop();
    const instruction = text.trim();
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU();
    if (chatIdentity && this.orchestrator.isInFlight(chatIdentity)) await this.orchestrator.interrupt(chatIdentity);
    await this.recoverLogicalCheckpoints_ACU();
    this.assertScope_ACU();
    this.getStore_ACU().read();
    const envelope = this.readEnvelopeView_ACU();
    this.assertActiveRunUsesWorldRoundProtocol_ACU(envelope);
    const pausedRun = envelope?.task?.status === 'paused' ? envelope.task.activeRun : null;
    const resumeKeyword = !instruction || RESUME_KEYWORD_ACU.test(instruction);
    const resolved = this.logicalStore ? { kind: 'resolved' as const, anchor: this.logicalStore.latestAnchor() }
      : resolveLatestWorldSimulationAssistant_ACU(chat);
    if (pausedRun) {
      const pausedAnchor = this.restoreAnchorOrNull_ACU(pausedRun, chat);
      if (pausedAnchor) {
        return this.orchestrator.resume(resumeKeyword ? { anchor: pausedAnchor, resetRunBudget: true } : { anchor: pausedAnchor, instruction, resetRunBudget: true });
      }
    }
    if (!instruction || resolved.kind !== 'resolved' || !resolved.anchor) return null;
    return this.orchestrator.start({ triggerKind: 'agent_chat_message', anchor: resolved.anchor, instruction, triggerConversationMessageId: triggerConversationMessageId ?? allocateId_ACU('run') });
  }

  /** 先收尾 carrier checkpoint，再进入推演；普通模式不参与此恢复。 */
  private async recoverLogicalCheckpoints_ACU(): Promise<void> {
    if (!this.logicalStore) return;
    this.assertScope_ACU();
    const source = this.logicalStore.readSource();
    const state = source.branches.find(branch => branch.branchId === source.activeBranchId)!.checkpoints;
    if (!state?.pending && !state?.cleanupPending) return;
    const { getZeroLayerRuntime_ACU } = await import('../zero-layer/runtime');
    this.assertScope_ACU();
    await getZeroLayerRuntime_ACU().recoverCheckpoints();
    this.assertScope_ACU();
  }

  async resume(): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    if (this.actorScan) await this.stop();
    await this.recoverLogicalCheckpoints_ACU();
    this.assertScope_ACU();
    this.getStore_ACU().read();
    const envelope = this.readEnvelopeView_ACU();
    this.assertActiveRunUsesWorldRoundProtocol_ACU(envelope);
    const identity = envelope?.task?.activeRun;
    if (!identity) return null;
    const anchor = this.logicalStore ? this.logicalStore.restoreAnchor(identity)
      : restoreWorldSimulationAnchor_ACU(identity, this.getChat());
    return this.orchestrator.resume({ anchor });
  }

  /**
   * 保存设置。只有真在途的运行才拒绝（retryable，由页面稍后自动重试）；
   * paused / blocked / 已完成任务都允许改设置——设置在每次运行开始时才被读取。
   */
  async saveSettings(settings: WorldSimulationSettings_ACU): Promise<void> {
    this.assertScope_ACU();
    this.getStore_ACU().read();
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU();
    if (!chatIdentity) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法保存格林推演设置', false,
      ));
    }
    if (this.isInFlight()) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '格林推演正在运行，设置将在本轮结束后自动保存', true,
      ));
    }
    await this.getStore_ACU().updateAtomically(envelope => ({
      ...(envelope ?? buildDefaultWorldSimulationEnvelope_ACU()),
      settings,
      updatedAt: Date.now(),
    }), { chatIdentity });
  }

  async scanWorldbookActors(): Promise<{ addedCount: number; bookCount: number; failedBookNames: string[] } | null> {
    this.assertScope_ACU();
    if (this.isInFlight()) throw new Error('当前任务正在运行，请结束后再扫描世界书。');
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU();
    const current = this.readEnvelopeView_ACU() ?? buildDefaultWorldSimulationEnvelope_ACU();
    const ledger = this.logicalStore?.readView().ledger ?? foldWorldSimulationLedger_ACU(chat)?.ledger ?? current.ledger;
    const settings = structuredClone(current.settings);
    const controller = new AbortController();
    const isCurrent = () => {
      if (controller.signal.aborted || this.disposed) return false;
      try { return this.getChat() === chat && this.getChatIdentity_ACU() === chatIdentity; }
      catch { return false; }
    };
    const assertCurrent = () => { if (!isCurrent()) throw new Error('WORLD_ACTOR_SCAN_CANCELLED'); };
    const events = SillyTavern_API_ACU?.eventSource;
    const chatChangedEvent = SillyTavern_API_ACU?.eventTypes?.CHAT_CHANGED;
    const cancelOnChatChange = () => controller.abort();
    if (events && chatChangedEvent) events.on(chatChangedEvent, cancelOnChatChange);
    const completion = Promise.resolve().then(async () => {
      beginWorldSimulationSessionRun_ACU(chatIdentity, '扫描世界书角色');
      const progress = logWorldSimulationSession_ACU(chatIdentity, {
        kind: 'delegation', title: '世界书角色整理', detail: '正在读取当前角色卡关联的世界书。', status: 'running',
      });
      try {
        const result = await scanWorldbookActors_ACU({ settings, ledger, actors: ledger.actors,
          signal: controller.signal, isCurrent,
          onProgress: message => { updateWorldSimulationSession_ACU(chatIdentity, progress, { detail: message }); },
          invoke: async messages => {
            assertCurrent();
            const preset = resolveWorldSimulationAgentApiPreset_ACU(settings, 'dramatis-keeper', 'agent_loop');
            const response = await callAIChatTurn_ACU([...messages], preset, controller.signal, undefined, { tools: [] });
            assertCurrent();
            return worldModelReplyText_ACU(response) ?? '';
          },
        });
        const approved: typeof result.actors = [];
        for (const [index, actor] of result.actors.entries()) {
          assertCurrent();
          updateWorldSimulationSession_ACU(chatIdentity, progress, { detail: `等待确认第 ${index + 1}/${result.actors.length} 位人物。` });
          if (await confirmWorldActorRegistration_ACU(structuredClone(actor), controller.signal)) approved.push(actor);
          assertCurrent();
        }
        updateWorldSimulationSession_ACU(chatIdentity, progress, { detail: '正在保存已同意新增的人物。' });
        assertCurrent();
        const options = { signal: controller.signal, isCurrent };
        const addedCount = approved.length ? this.logicalStore
          ? await appendZeroLayerSimulationActors_ACU(this.logicalStore, approved, options)
          : await appendWorldSimulationActorsHost_ACU(approved, options) : 0;
        updateWorldSimulationSession_ACU(chatIdentity, progress, { detail: `新增 ${addedCount} 位人物，其他世界资料未改动。`, status: 'done', ok: true });
        logWorldSimulationSession_ACU(chatIdentity, { kind: 'run_completed', title: '世界书角色整理完成',
          detail: `读取 ${result.bookCount} 本世界书，新增 ${addedCount} 位人物。` });
        return { addedCount, bookCount: result.bookCount, failedBookNames: result.failedBookNames };
      } catch (error) {
        if (!isCurrent()) {
          updateWorldSimulationSession_ACU(chatIdentity, progress, { detail: '已停止，未提交的候选人物不会新增。', status: 'done' });
          return null;
        }
        updateWorldSimulationSession_ACU(chatIdentity, progress, { detail: error instanceof Error ? error.message : String(error), status: 'failed', ok: false });
        logRuntimeFailure_ACU('scan_worldbook_actors', error, undefined, chatIdentity);
        throw error;
      } finally {
        if (events && chatChangedEvent) events.removeListener(chatChangedEvent, cancelOnChatChange);
        if (this.actorScan?.controller === controller) this.actorScan = null;
        endWorldSimulationSessionRun_ACU(chatIdentity);
      }
    });
    this.actorScan = { controller, completion };
    return completion;
  }

  async deleteActor(actorId: string): Promise<void> {
    this.assertScope_ACU();
    const chatIdentity = this.getChatIdentity_ACU();
    if (this.isInFlight()) {
      throw new Error('格林推演正在运行，请停止后再删除人物。');
    }
    try {
      if (this.logicalStore) await deleteZeroLayerSimulationActor_ACU(this.logicalStore, actorId);
      else await deleteWorldSimulationActorHost_ACU(actorId);
      clearWorldSimulationRunState_ACU(chatIdentity);
    } catch (error) {
      logRuntimeFailure_ACU('delete_actor', error, undefined, chatIdentity);
      throw error;
    }
  }

  async deleteWorldEvent(eventId: string): Promise<void> {
    this.assertScope_ACU();
    const chatIdentity = this.getChatIdentity_ACU();
    if (this.isInFlight()) throw new Error('格林推演正在运行，请停止后再删除事件。');
    try {
      if (this.logicalStore) await deleteZeroLayerSimulationEvent_ACU(this.logicalStore, eventId);
      else await deleteWorldSimulationEventHost_ACU(eventId);
      clearWorldSimulationRunState_ACU(chatIdentity);
    } catch (error) {
      logRuntimeFailure_ACU('delete_world_event', error, undefined, chatIdentity);
      throw error;
    }
  }

  async deleteWorldHistory(historyId: string): Promise<void> {
    this.assertScope_ACU();
    const chatIdentity = this.getChatIdentity_ACU();
    if (this.isInFlight()) throw new Error('格林推演正在运行，请停止后再删除重要历史。');
    try {
      if (this.logicalStore) await deleteZeroLayerSimulationHistory_ACU(this.logicalStore, historyId);
      else await deleteWorldSimulationHistoryHost_ACU(historyId);
      clearWorldSimulationRunState_ACU(chatIdentity);
    } catch (error) {
      logRuntimeFailure_ACU('delete_world_history', error, undefined, chatIdentity);
      throw error;
    }
  }

  async saveUserRequirements(requirements: unknown): Promise<void> {
    this.assertScope_ACU();
    if (this.logicalStore) {
      const snapshot = validateWorldSimulationUserRequirementsSnapshot_ACU({
        schemaVersion: 1, requirements, updatedAt: Date.now() });
      await this.logicalStore.updateState(state => { state.userRequirements = snapshot; });
      return;
    }
    await replaceWorldSimulationUserRequirementsByUser_ACU(requirements, this.getChat());
  }

  /**
   * 一键清空：丢弃任务、阶段、时间线、账本与所有楼层上的会话 / 材料 / 状态 / run 恢复分桶，保留设置。
   * 正文与已写进正文的 <与此同时> 段不动。首楼信封与楼层字段是两次独立宿主保存，不是跨字段事务。
   * @returns 被清理了分桶字段的楼层数
   */
  async clearData(): Promise<{ clearedFloors: number }> {
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU();
    if (!chatIdentity) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法清空格林推演数据', false,
      ));
    }
    if (this.isInFlight()) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '格林推演正在运行，请先停止再清空', false,
      ));
    }
    if (this.logicalStore) {
      const pending = this.logicalStore.readSource().turns.some(turn => turn.branchId === this.logicalStore!.branchId
        && turn.phase === 'response-durable' && !turn.effectReceipts.some(receipt => receipt.kind === 'simulation'));
      if (pending) throw new ZeroLayerError_ACU('effects-pending', '逻辑正文推演尚未确认，请先完成结算再清空。');
      await this.logicalStore.updateState(state => {
        const settings = state.envelope?.settings;
        const previousRevision = state.envelope?.ledger.revision ?? 0;
        const cleared = emptyZeroLayerSimulation_ACU();
        if (settings) {
          cleared.envelope = { ...buildDefaultWorldSimulationEnvelope_ACU(), settings, updatedAt: Date.now() };
          // 显式清空也是一次新确认的状态；历史 checkpoint 不得让版本回退或复活旧账本。
          cleared.envelope.ledger.revision = previousRevision + 1;
        }
        if (cleared.envelope) cleared.fields = seedLedgerFieldView_ACU(cleared.envelope.ledger, cleared.envelope.updatedAt);
        delete state.legacyBackfill;
        Object.assign(state, cleared);
      });
      clearWorldSimulationRunState_ACU(chatIdentity);
      clearWorldSimulationSessionLog_ACU(chatIdentity);
      return { clearedFloors: 0 };
    }
    const store = new FirstFloorWorldSimulationStore_ACU();
    if (store.read()) {
      await store.updateAtomically(envelope => ({
        ...buildDefaultWorldSimulationEnvelope_ACU(),
        settings: envelope!.settings,
        updatedAt: Date.now(),
      }), { chatIdentity });
    }
    const snapshots: Array<{ message: Record<string, unknown>; key: string; value: unknown }> = [];
    let clearedFloors = 0;
    for (const message of chat) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
      const record = message as Record<string, unknown>;
      let touched = false;
      for (const field of WORLD_SIMULATION_FLOOR_FIELDS_ACU) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
        snapshots.push({ message: record, key: field, value: record[field] });
        delete record[field];
        touched = true;
      }
      if (touched) clearedFloors += 1;
    }
    if (snapshots.length) {
      try {
        await saveChatToHostStrict_ACU();
      } catch (error) {
        for (const snapshot of snapshots) snapshot.message[snapshot.key] = snapshot.value;
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_PERSIST_FAILED', 'persist', '清空楼层格林推演字段保存失败，已还原', false,
          { message: error instanceof Error ? error.message : String(error) },
        ));
      }
    }
    clearWorldSimulationRunState_ACU(chatIdentity);
    clearWorldSimulationSessionLog_ACU(chatIdentity);
    return { clearedFloors };
  }

  /** 请求停止但不等待结算（供不关心结果的调用方使用）。 */
  cancel(): boolean {
    if (this.actorScan) { this.actorScan.controller.abort(); return true; }
    const chatIdentity = this.getChatIdentity_ACU();
    return chatIdentity ? this.orchestrator.cancel(chatIdentity) : false;
  }

  /** 停止在途运行并等待其落盘为 paused/manual；返回后可立刻发送新消息恢复或取代。 */
  async stop(): Promise<boolean> {
    if (this.actorScan) {
      const scan = this.actorScan;
      scan.controller.abort();
      await scan.completion.catch((): void => undefined);
      return true;
    }
    const chatIdentity = this.getChatIdentity_ACU();
    return chatIdentity ? this.orchestrator.interrupt(chatIdentity) : false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.actorScan?.controller.abort();
    const identity = this.logicalStore?.getChatIdentity() ?? getActiveChatStorageIdentity_ACU(this.getChat());
    if (identity) this.orchestrator.cancel(identity);
    this.disposed = true;
  }
}

let runtime_ACU: WorldSimulationRuntime_ACU | null = null;
let logicalRuntimeKey_ACU: string | null = null;
let logicalRuntimeChat_ACU: any[] | null = null;
function readEnabledSimulationCarrier_ACU(chat: any[]): ZeroLayerEnvelope_ACU | null {
  const source = chat.some(message => message && Object.prototype.hasOwnProperty.call(message, ZERO_LAYER_CARRIER_FIELD_ACU))
    ? new ZeroLayerStore_ACU().readSnapshot() : null;
  return source?.enabled ? source : null;
}
export function getWorldSimulationRuntime_ACU(): WorldSimulationRuntime_ACU {
  const chat = getChatArray_ACU();
  const source = readEnabledSimulationCarrier_ACU(chat);
  const key = source ? JSON.stringify([source.scope.characterKey, source.scope.chatId,
    source.sessionId, source.activeBranchId, source.carrierSwipeId]) : null;
  if (runtime_ACU && (key !== logicalRuntimeKey_ACU || key !== null && chat !== logicalRuntimeChat_ACU)) {
    runtime_ACU.dispose();
    runtime_ACU = null;
  }
  if (!runtime_ACU) {
    logicalRuntimeKey_ACU = key;
    logicalRuntimeChat_ACU = key ? chat : null;
    runtime_ACU = new WorldSimulationRuntime_ACU(undefined, getChatArray_ACU, key ? new ZeroLayerSimulationStore_ACU() : undefined);
  }
  return runtime_ACU;
}

export function createWorldSimulationCompletionIntentForCurrentChat_ACU(eventMessageId: number, chatKey: string, isolationKey: string, generationSeq?: number) {
  return createWorldSimulationCompletionIntent_ACU(eventMessageId, chatKey, isolationKey, getChatArray_ACU(), generationSeq);
}
