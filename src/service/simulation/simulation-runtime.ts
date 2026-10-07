import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { callAIChatTurn_ACU, callAIWithResolvedPreset_ACU } from '../ai/api-call';
import { callContinuationInternalAiWithRetry_ACU } from '../continuation/internal-ai-call';
import { agentNativeTools_ACU, type AiChatTurn_ACU } from '../ai/native-tool';
import { settings_ACU } from '../runtime/state-manager';
import { readZeroLayerPublishedMaterials_ACU } from '../zero-layer/published-materials';
import { buildOpenAiPromptCacheKey_ACU, supportsExplicitOpenAiCacheKey_ACU } from '../ai/prompt-cache';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, worldSimulationAgentNativeTools_ACU, worldSimulationDirectorVisibleCatalog_ACU, type WorldSimulationAgentName_ACU } from './agent/agent-catalog';
import { appendWorldSimulationSessionEvent_ACU, appendWorldSimulationUserInstruction_ACU, readWorldSimulationConversation_ACU, projectWorldSimulationConversationSegments_ACU } from './agent/agent-conversation-store';
import { readLatestWorldSimulationMaterials_ACU, readWorldSimulationLedgerAtAnchor_ACU } from './agent/agent-module-store';
import { clearWorldSimulationRunState_ACU } from './agent/agent-run-cache';
import { clearWorldSimulationSessionLog_ACU, isWorldSimulationSessionRunning_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU } from './agent/agent-session-log';
import { WORLD_SIMULATION_TOOL_ADDRESSES_ACU } from './world-simulation-agent-tools';
import { WorldSimulationMainLoop_ACU } from './agent/agent-main-loop';
import { createHostWorldSimulationAgentStorage_ACU } from './agent/agent-storage';
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
import type { WorldSimulationPlaceholderContext_ACU } from './agent/agent-placeholder-resolver';
import { WorldSimulationSubagentRuntime_ACU, type WorldSimulationInvokeTools_ACU } from './agent/agent-subagent-runtime';
import {
  readLatestWorldSimulationUserRequirements_ACU,
  renderWorldSimulationUserRequirements_ACU,
  replaceWorldSimulationUserRequirementsByUser_ACU,
  seedWorldSimulationUserRequirementsIfEmpty_ACU,
} from './agent/agent-user-requirements';
import { isMechanicalWorldSimulationResumeText_ACU, validateWorldSimulationUserRequirementsSnapshot_ACU } from './agent/agent-user-requirements';
import type { WorldSimulationFieldCommitInput_ACU } from './simulation-field-commit-adapter';
import { createWorldSimulationError_ACU, WorldSimulationValidationError_ACU, type WorldCollisionReport_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationSettings_ACU } from './model';
import { commitWorldSimulationFieldWrites_ACU, commitWorldSimulationProjection_ACU } from './simulation-commit-adapter';
import {
  WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU,
  WORLD_SIMULATION_STOP_REASON_MANUAL_ACU,
  WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU,
  WorldSimulationOrchestrator_ACU,
  type WorldSimulationOrchestratorResult_ACU,
} from './simulation-orchestrator';
import { buildDirectorOwnedStageRevision_ACU } from './simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from './simulation-stage-execution-engine';
import { FirstFloorWorldSimulationStore_ACU, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, assertWorldSimulationAnchorCurrent_ACU, resolveCurrentWorldSimulationAnchor_ACU } from './simulation-store';
import { WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROMPT_VERSION_V20_ACU } from './agent/agent-defaults';
import { buildDefaultWorldSimulationEnvelope_ACU } from './defaults';
import { buildWorldSimulationProjection_ACU } from './simulation-projection';
import { detectWorldCollisions_ACU } from './world-dynamics';
import { createWorldSimulationHostToolDependencies_ACU } from './world-simulation-host-tools';
import { loadAgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import { foldWorldSimulationArchive_ACU, foldWorldSimulationLedger_ACU, readWorldSimulationLedgerFieldSnapshot_ACU, seedLedgerFieldView_ACU } from './simulation-ledger-fold';
import { readWorldSimulationRunWriteProof_ACU, restoreWorldSimulationRunWrites_ACU, restoreWorldSimulationRunWritesFromProof_ACU } from './simulation-run-write-state';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from './world-simulation-evidence-registry';
import { beginWorldSimulationInternalAiMainApiInvocation_ACU, beginWorldSimulationInternalAiRequest_ACU, endWorldSimulationInternalAiMainApiInvocation_ACU, settleWorldSimulationInternalAiRequest_ACU } from './simulation-internal-ai-events';
import { createWorldSimulationCompletionIntent_ACU, resolveLatestWorldSimulationAssistant_ACU, resolveWorldSimulationAssistantCompletion_ACU, restoreWorldSimulationAnchor_ACU } from './simulation-trigger-adapter';
import { assertWorldSimulationHostRun_ACU, requireWorldSimulationHostAnchor_ACU } from './simulation-identity';
import { ZeroLayerStore_ACU } from '../zero-layer/store';
import { ZERO_LAYER_CARRIER_FIELD_ACU, ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from '../zero-layer/model';
import { ZeroLayerSimulationStore_ACU, emptyZeroLayerSimulation_ACU } from '../zero-layer/simulation-store';
import { appendZeroLayerSimulationSessionEvent_ACU, appendZeroLayerSimulationUserInstruction_ACU, createZeroLayerSimulationAgentStorage_ACU } from '../zero-layer/simulation-agent-storage';
import { commitZeroLayerSimulationFields_ACU, commitZeroLayerSimulationFinal_ACU } from '../zero-layer/simulation-commit';
import { validateZeroLayerSimulationReceipt_ACU } from '../zero-layer/simulation-validation';

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

function buildPromptContext_ACU(input: {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationTargetAnchor_ACU;
  instruction: string;
  envelope: WorldSimulationEnvelope_ACU;
  stagePlan: unknown;
  registry: ReturnType<typeof createWorldSimulationEvidenceRegistry_ACU>;
  chat: any[];
  conversation?: WorldSimulationConversationView_ACU;
  userRequirements?: ReturnType<typeof readLatestWorldSimulationUserRequirements_ACU>['snapshot'];
  anchorBody?: string;
}): WorldSimulationPlaceholderContext_ACU {
  const history = input.conversation ?? readWorldSimulationConversation_ACU(input.chat);
  const visibleHistory = { ...history, messages: history.messages.filter(item => item.kind !== 'model_agent' && item.kind !== 'model_feedback'
    && !(item.kind === 'tool' && item.toolCallId)) };
  return {
    task: input.envelope.task,
    history: visibleHistory,
    runtimeContext: {
      triggerKind: input.identity.triggerKind,
      instruction: input.instruction,
      baseLedgerRevision: input.identity.baseLedgerRevision,
    },
    agentCatalog: worldSimulationDirectorVisibleCatalog_ACU(),
    toolCatalog: WORLD_SIMULATION_TOOL_ADDRESSES_ACU,
    evidence: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry).entries,
    userGuidance: input.instruction,
    userRequirements: renderWorldSimulationUserRequirements_ACU(
      input.userRequirements ?? readLatestWorldSimulationUserRequirements_ACU(input.chat).snapshot,
      input.envelope.task?.originInstruction ?? input.instruction,
    ),
    originInstruction: input.envelope.task?.originInstruction ?? input.instruction,
    worldState: input.envelope.ledger,
    anchorMessage: input.anchorBody ?? anchorText_ACU(requireWorldSimulationHostAnchor_ACU(input.anchor), input.chat),
    anchorIdentity: input.anchor,
    worldStagePlan: input.stagePlan,
    worldChronicle: input.envelope.ledger.chronicle,
    worldCandidates: [],
    worldCollisions: detectWorldCollisions_ACU(input.envelope.ledger),
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry),
    projectionPreview: buildWorldSimulationProjection_ACU(input.envelope.ledger, input.envelope.settings.projection.template),
  };
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
  const readProof = (anchor: WorldSimulationTargetAnchor_ACU) => {
    if (logicalStore) { logicalStore.assertAnchor(anchor); return logicalStore.readState().runProof; }
    return readWorldSimulationRunWriteProof_ACU(requireWorldSimulationHostAnchor_ACU(anchor), getChatArray_ACU());
  };
  const restoreWrites = (identity: WorldSimulationRunIdentity_ACU, anchor: WorldSimulationTargetAnchor_ACU) => {
    if (logicalStore) {
      logicalStore.restoreAnchor(identity);
      return restoreWorldSimulationRunWritesFromProof_ACU(() => readView(anchor), identity, readProof(anchor));
    }
    return restoreWorldSimulationRunWrites_ACU(() => readView(anchor), identity, requireWorldSimulationHostAnchor_ACU(anchor), getChatArray_ACU());
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
    assertAnchorCurrent: anchor => { resolveAnchor(anchor); },
    readResumeLedgerRevision: (identity, anchor) => {
      return restoreWrites(identity, resolveAnchor(anchor)).currentLedgerRevision;
    },
    commitProjection: input => {
      if (logicalStore) return commitZeroLayerSimulationFinal_ACU(logicalStore, input);
      assertWorldSimulationHostRun_ACU(input.identity);
      return commitWorldSimulationProjection_ACU({ ...input, anchor: requireWorldSimulationHostAnchor_ACU(input.anchor) });
    },
    persistCompletion: async ({ identity, anchor, outcome, summary }) => {
      if (logicalStore) {
        logicalStore.assertAnchor(anchor);
        await appendZeroLayerSimulationSessionEvent_ACU(logicalStore, anchor, { ...identity,
          eventKey: `run-completed-${outcome}`, idempotent: true,
          event: { kind: 'run_completed', title: outcome === 'commit' ? '格林推演已提交' : '格林推演无变化', detail: summary, agentName: 'world-director' } });
        return;
      }
      assertWorldSimulationHostRun_ACU(identity);
      const chat = getChatArray_ACU();
      const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(requireWorldSimulationHostAnchor_ACU(anchor), chat);
      await appendWorldSimulationSessionEvent_ACU({
        anchor: currentAnchor, runId: identity.runId, taskId: identity.taskId,
        stageId: identity.stageId, stageRevision: identity.stageRevision,
        eventKey: `run-completed-${outcome}`,
        event: { kind: 'run_completed', title: outcome === 'commit' ? '格林推演已提交' : '格林推演无变化', detail: summary, agentName: 'world-director' },
      }, chat);
    },
    appendUserMessage: async ({ identity, anchor, text, idempotent }) => {
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
      if (!logicalStore) assertWorldSimulationHostRun_ACU(identity);
      const currentAnchor = resolveAnchor(anchor);
      const chat = readChat(currentAnchor);
      const registry = createWorldSimulationEvidenceRegistry_ACU(identity.runId);
      recordWorldSimulationEvidence_ACU(registry, {
        operation: 'initial',
        address: 'anchor:message',
        status: 'ok',
        summary: '冻结 assistant 锚点正文',
        exact: true,
      });
      const baseContext = buildPromptContext_ACU({
        identity, anchor: currentAnchor, instruction, envelope, stagePlan: {}, registry, chat, ...contextSource(currentAnchor),
      });

      const persistSessionEvent = (eventKey: string, event: import('./agent/agent-session-log').WorldSimulationSessionInput_ACU, stageRevision = identity.stageRevision) => {
        if (logicalStore) { logicalStore.assertAnchor(currentAnchor); return appendZeroLayerSimulationSessionEvent_ACU(logicalStore, currentAnchor,
          { ...identity, stageRevision, eventKey, event }); }
        return appendWorldSimulationSessionEvent_ACU({
          anchor: requireWorldSimulationHostAnchor_ACU(currentAnchor),
          runId: identity.runId,
          taskId: identity.taskId,
          stageId: identity.stageId,
          stageRevision,
          eventKey,
          event,
        }, getChatArray_ACU());
      };

      const activeStage = envelope.stages.find(stage => stage.stageId === identity.stageId);
      const resumableRevision = envelope.task?.status === 'paused'
        ? activeStage?.revisions.find(revision => revision.revision === identity.stageRevision && revision.frozen)
        : undefined;
      const plannedRevision = resumableRevision
        ?? buildDirectorOwnedStageRevision_ACU({
          instruction,
          collisions: baseContext.worldCollisions as WorldCollisionReport_ACU,
          now: Date.now(),
        });
      const promptContext = buildPromptContext_ACU({
        identity, anchor: currentAnchor, instruction, envelope,
        stagePlan: plannedRevision.plan, registry, chat, ...contextSource(currentAnchor),
      });
      const liveLedger = () => readView(currentAnchor);
      const runWrites = restoreWrites(identity, currentAnchor);
      const worldbookSnapshot = loadAgentWorldbookSnapshot_ACU();
      const tools = createWorldSimulationHostToolDependencies_ACU({
        worldbookSnapshot,
        liveLedger,
        anchorMessage: promptContext.anchorMessage,
        summary: '',
        ledger: envelope.ledger,
        stagePlan: plannedRevision.plan,
        candidates: [],
        chronicle: envelope.ledger.chronicle,
        projectionPreview: promptContext.projectionPreview,
        liveArchive: () => readView(currentAnchor).archive,
        webResearch: envelope.settings.webResearch,
      });
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
      const subagents = new WorldSimulationSubagentRuntime_ACU({ invoke });
      const writeSql = (runIdentity: WorldSimulationRunIdentity_ACU) => async (write: Parameters<NonNullable<import('./agent/agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['writeSql']>>[0]) => {
        if (signal.aborted) throw new Error('WORLD_SIMULATION_RUN_STALE');
        const input: Omit<WorldSimulationFieldCommitInput_ACU, 'anchor'> = { identity: runIdentity, ...write,
          isCurrent: () => !signal.aborted && (write.isCurrent?.() ?? true),
          assertRunLedger: view => {
            runWrites.assertCurrent(view);
            runWrites.assertPersistedProof(runIdentity, readProof(currentAnchor));
          },
          prepareRunProof: (view, refs, accepted) => runWrites.prepareConfirmation(runIdentity, view, refs, accepted),
          confirmRunLedger: (view, refs, accepted) => runWrites.confirm(view, refs, accepted),
        };
        if (logicalStore) { logicalStore.assertAnchor(currentAnchor); return commitZeroLayerSimulationFields_ACU(logicalStore, { ...input, anchor: currentAnchor }); }
        return commitWorldSimulationFieldWrites_ACU({ ...input, anchor: requireWorldSimulationHostAnchor_ACU(currentAnchor) });
      };
      const mainLoop = new WorldSimulationMainLoop_ACU({ invoke, subagents });
      if (identity.triggerKind === 'agent_chat_message') {
        if (logicalStore) {
          const text = envelope.task?.originInstruction ?? instruction;
          if (!isMechanicalWorldSimulationResumeText_ACU(text)) await logicalStore.updateState(state => {
            if (!state.userRequirements.requirements.length) state.userRequirements = validateWorldSimulationUserRequirementsSnapshot_ACU({
              schemaVersion: 1, requirements: [text], updatedAt: Date.now() });
          });
        } else await seedWorldSimulationUserRequirementsIfEmpty_ACU(envelope.task?.originInstruction ?? instruction, requireWorldSimulationHostAnchor_ACU(currentAnchor), chat);
        promptContext.userRequirements = renderWorldSimulationUserRequirements_ACU(
          logicalStore ? logicalStore.readState().userRequirements : readLatestWorldSimulationUserRequirements_ACU(getChatArray_ACU()).snapshot,
          envelope.task?.originInstruction ?? instruction,
        );
      }
      return {
        revision: plannedRevision,
        runWrites,
        execute: async runIdentity => {
          const agentStorage = logicalStore ? createZeroLayerSimulationAgentStorage_ACU(logicalStore, logicalStore.restoreAnchor(runIdentity), signal)
            : createHostWorldSimulationAgentStorage_ACU(requireWorldSimulationHostAnchor_ACU(currentAnchor), chat);
          const engine = new WorldSimulationStageExecutionEngine_ACU({
            readEnvelope: () => store.read(),
            runWrites,
            getChatIdentity: () => logicalStore ? logicalStore.getChatIdentity() : getActiveChatStorageIdentity_ACU(getChatArray_ACU()),
            assertAnchorCurrent: currentIdentity => {
              if (logicalStore) { logicalStore.restoreAnchor(currentIdentity); return; }
              const restored = restoreWorldSimulationAnchor_ACU(currentIdentity, getChatArray_ACU());
              assertWorldSimulationAnchorCurrent_ACU(restored, getChatArray_ACU());
            },
            runMainLoop: () => mainLoop.run({
              identity: runIdentity,
              settings: store.read()!.settings,
              promptContext: { ...promptContext, task: store.read()!.task, worldStagePlan: plannedRevision.plan },
              registry,
              tools,
              worldbookSnapshot,
              writeSql: writeSql(runIdentity),
              runWrites,
              readCurrent: () => liveLedger().ledger,
              readFieldSnapshot: () => {
                const fields = liveLedger().fields;
                if (!fields) throw new Error('WORLD_SIMULATION_FIELD_VIEW_UNAVAILABLE');
                return fields;
              },
              isCurrent: () => !signal.aborted && store.read()?.task?.activeRun?.runId === runIdentity.runId,
              persistSessionEvent: (eventKey, event) => persistSessionEvent(eventKey, event, runIdentity.stageRevision),
              anchor: currentAnchor,
              chat,
              storage: agentStorage,
              resetRunBudget,
              directOpening: !resumableRevision && !resetRunBudget,
              anchorMaterialsCommitted: logicalStore ? logicalStore.readState().confirmed.some(item => item.ref.turnId === logicalStore.restoreAnchor(runIdentity).logicalRef.turnId)
                : readWorldSimulationLedgerAtAnchor_ACU(requireWorldSimulationHostAnchor_ACU(currentAnchor), getChatArray_ACU()) !== null,
              targetModules,
            }),
          });
          return engine.run({ identity: runIdentity });
        },
      };
    },
  });
}

export interface WorldSimulationUiSnapshot_ACU {
  envelope: WorldSimulationEnvelope_ACU | null;
  /** 零层资料展示与运行 envelope 分开；null 表示尚无已发布账本。 */
  publishedLedger?: WorldSimulationEnvelope_ACU['ledger'] | null;
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

  private async persistPromptMigration_ACU(): Promise<void> {
    this.assertScope_ACU();
    const chat = this.getChat();
    const raw = this.logicalStore ? this.logicalStore.read()
      : (chat[0] as Record<string, any> | undefined)?.[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
    if (!raw || raw.settings?.promptForceDefaultVersion === WORLD_SIMULATION_PROMPT_VERSION_ACU) return;
    const identity = this.getChatIdentity_ACU();
    if (!identity || this.orchestrator.isInFlight(identity)) return;
    // First validate the persisted envelope so an invalid one fails before any write.
    this.getStore_ACU().read();
    await this.getStore_ACU().updateAtomically(current => current!, { chatIdentity: identity });
  }

  async initialize(): Promise<void> {
    await this.persistPromptMigration_ACU();
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
      projectionPreview: envelope ? buildWorldSimulationProjection_ACU(envelope.ledger, envelope.settings.projection.template) : null,
    };
  }

  isInFlight(): boolean {
    const chatIdentity = this.getChatIdentity_ACU();
    return chatIdentity ? this.orchestrator.isInFlight(chatIdentity) : false;
  }

  async handleAssistantCompletion(intent: Parameters<typeof resolveWorldSimulationAssistantCompletion_ACU>[0]): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    if (this.logicalStore) { this.assertScope_ACU(); return null; }
    await this.persistPromptMigration_ACU();
    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, { getChat: this.getChat, delay: ms => new Promise(resolve => setTimeout(resolve, ms)) });
    if (resolved.kind !== 'resolved') {
      logWarn_ACU(`格林推演自动触发跳过：锚点解析失败（${resolved.reason}）`);
      return null;
    }
    const outcome = await this.orchestrator.start({ triggerKind: 'assistant_completed', anchor: resolved.anchor, instruction: '根据最新 assistant 正文推进世界状态' });
    if (outcome.status === 'skipped') logDebug_ACU(`格林推演自动触发跳过：orchestrator skipped（${outcome.reason}）`);
    return outcome;
  }

  /** 从已保存的逻辑正文结算；已确认结果只回读，暂停运行只恢复，不重发正文。 */
  async handleLogicalCompletion(envelope: ZeroLayerEnvelope_ACU, turnId: string, attemptId: string,
    signal: AbortSignal): Promise<void> {
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
    const instruction = text.trim();
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU();
    if (chatIdentity && this.orchestrator.isInFlight(chatIdentity)) await this.orchestrator.interrupt(chatIdentity);
    await this.recoverLogicalCheckpoints_ACU();
    await this.persistPromptMigration_ACU();
    const envelope = this.readEnvelopeView_ACU();
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
    await this.recoverLogicalCheckpoints_ACU();
    await this.persistPromptMigration_ACU();
    const envelope = this.readEnvelopeView_ACU();
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
    await this.persistPromptMigration_ACU();
    const chat = this.getChat();
    const chatIdentity = this.getChatIdentity_ACU();
    if (!chatIdentity) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法保存格林推演设置', false,
      ));
    }
    if (this.orchestrator.isInFlight(chatIdentity)) {
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
    if (this.orchestrator.isInFlight(chatIdentity)) {
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
    const chatIdentity = this.getChatIdentity_ACU();
    return chatIdentity ? this.orchestrator.cancel(chatIdentity) : false;
  }

  /** 停止在途运行并等待其落盘为 paused/manual；返回后可立刻发送新消息恢复或取代。 */
  async stop(): Promise<boolean> {
    const chatIdentity = this.getChatIdentity_ACU();
    return chatIdentity ? this.orchestrator.interrupt(chatIdentity) : false;
  }
  dispose(): void {
    if (this.disposed) return;
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
