import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { callAIWithResolvedPreset_ACU } from '../ai/api-call';
import { worldSimulationDirectorVisibleCatalog_ACU, type WorldSimulationAgentName_ACU } from './agent/agent-catalog';
import { appendWorldSimulationSessionEvent_ACU, appendWorldSimulationUserInstruction_ACU, readWorldSimulationConversation_ACU } from './agent/agent-conversation-store';
import { readLatestWorldSimulationMaterials_ACU, readWorldSimulationLedgerAtAnchor_ACU } from './agent/agent-module-store';
import { compactWorldSimulationConversationAndDispatchRequirements_ACU } from './agent/agent-requirements-dispatch';
import { clearWorldSimulationRunState_ACU } from './agent/agent-run-cache';
import { clearWorldSimulationSessionLog_ACU, isWorldSimulationSessionRunning_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU } from './agent/agent-session-log';
import { WORLD_SIMULATION_TOOL_ADDRESSES_ACU } from './world-simulation-agent-tools';
import { WorldSimulationMainLoop_ACU } from './agent/agent-main-loop';
import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_RUN_STATE_FIELD_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  type WorldSimulationAnchorIdentity_ACU,
} from './agent/agent-model';
import type { WorldSimulationPlaceholderContext_ACU } from './agent/agent-placeholder-resolver';
import { WorldSimulationSubagentRuntime_ACU } from './agent/agent-subagent-runtime';
import {
  readLatestWorldSimulationUserRequirements_ACU,
  renderWorldSimulationUserRequirements_ACU,
  replaceWorldSimulationUserRequirementsByUser_ACU,
  seedWorldSimulationUserRequirementsIfEmpty_ACU,
} from './agent/agent-user-requirements';
import { createWorldSimulationError_ACU, WorldSimulationValidationError_ACU, type WorldCollisionReport_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationSettings_ACU } from './model';
import { commitWorldSimulationProjection_ACU } from './simulation-commit-adapter';
import {
  WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU,
  WORLD_SIMULATION_STOP_REASON_MANUAL_ACU,
  WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU,
  WorldSimulationOrchestrator_ACU,
  type WorldSimulationOrchestratorResult_ACU,
} from './simulation-orchestrator';
import { buildDirectorOwnedStageRevision_ACU } from './simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from './simulation-stage-execution-engine';
import { FirstFloorWorldSimulationStore_ACU, assertWorldSimulationAnchorCurrent_ACU, buildEmptyWorldChronicleArchiveSnapshot_ACU, readWorldSimulationBucketEntry_ACU, resolveCurrentWorldSimulationAnchor_ACU, validateWorldSimulationChronicleArchiveSnapshot_ACU } from './simulation-store';
import { buildDefaultWorldSimulationEnvelope_ACU } from './defaults';
import { buildWorldSimulationProjection_ACU } from './simulation-projection';
import { detectWorldCollisions_ACU } from './world-dynamics';
import { createWorldSimulationHostToolDependencies_ACU } from './world-simulation-host-tools';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from './world-simulation-evidence-registry';
import { beginWorldSimulationInternalAiMainApiInvocation_ACU, beginWorldSimulationInternalAiRequest_ACU, endWorldSimulationInternalAiMainApiInvocation_ACU, settleWorldSimulationInternalAiRequest_ACU } from './simulation-internal-ai-events';
import { createWorldSimulationCompletionIntent_ACU, resolveLatestWorldSimulationAssistant_ACU, resolveWorldSimulationAssistantCompletion_ACU, restoreWorldSimulationAnchor_ACU } from './simulation-trigger-adapter';

let allocatedId_ACU = 0;
let internalRequestSequence_ACU = 0;
const allocateId_ACU = (kind: 'task' | 'stage' | 'run' | 'timeline'): string => `${kind}-${Date.now().toString(36)}-${++allocatedId_ACU}`;
const anchorText_ACU = (anchor: WorldSimulationAnchorIdentity_ACU, chat: any[]): string => {
  const current = resolveCurrentWorldSimulationAnchor_ACU(anchor, chat);
  const message = chat[current.messageIndex];
  return typeof message?.mes === 'string' ? message.mes : typeof message?.message === 'string' ? message.message : '';
};

async function invokeWorldSimulationAgent_ACU(
  role: WorldSimulationAgentName_ACU,
  messages: readonly { role: string; content: string }[],
  preset: Parameters<typeof callAIWithResolvedPreset_ACU>[1],
  identity: WorldSimulationRunIdentity_ACU,
  signal: AbortSignal,
): Promise<string> {
  const requestId = `${identity.runId}:${role}:${++internalRequestSequence_ACU}`;
  beginWorldSimulationInternalAiRequest_ACU({ requestId, runId: identity.runId, role });
  try {
    const response = await callAIWithResolvedPreset_ACU([...messages], preset, signal, {
      beforeMainApiCall: () => beginWorldSimulationInternalAiMainApiInvocation_ACU(requestId),
      afterMainApiCall: () => endWorldSimulationInternalAiMainApiInvocation_ACU(requestId),
    });
    if (typeof response === 'string' && response.trim()) return response;
    throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_loop', '世界推演 Agent 返回空响应', false, { role },
    ));
  } finally {
    settleWorldSimulationInternalAiRequest_ACU(requestId);
  }
}

function buildPromptContext_ACU(input: {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  instruction: string;
  envelope: WorldSimulationEnvelope_ACU;
  stagePlan: unknown;
  registry: ReturnType<typeof createWorldSimulationEvidenceRegistry_ACU>;
  chat: any[];
}): WorldSimulationPlaceholderContext_ACU {
  const history = readWorldSimulationConversation_ACU(input.chat);
  return {
    task: input.envelope.task,
    history,
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
      readLatestWorldSimulationUserRequirements_ACU(input.chat).snapshot,
      input.envelope.task?.originInstruction ?? input.instruction,
    ),
    originInstruction: input.envelope.task?.originInstruction ?? input.instruction,
    worldState: input.envelope.ledger,
    anchorMessage: anchorText_ACU(input.anchor, input.chat),
    anchorIdentity: input.anchor,
    worldStagePlan: input.stagePlan,
    worldChronicle: input.envelope.ledger.chronicle,
    worldCandidates: [],
    worldCollisions: detectWorldCollisions_ACU(input.envelope.ledger),
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry),
    projectionPreview: buildWorldSimulationProjection_ACU(input.envelope.ledger),
  };
}

function createProductionOrchestrator_ACU(): WorldSimulationOrchestrator_ACU {
  const store = new FirstFloorWorldSimulationStore_ACU();
  return new WorldSimulationOrchestrator_ACU({
    store,
    now: () => Date.now(),
    allocateId: allocateId_ACU,
    assertAnchorCurrent: anchor => { resolveCurrentWorldSimulationAnchor_ACU(anchor, getChatArray_ACU()); },
    commitProjection: commitWorldSimulationProjection_ACU,
    appendUserMessage: async ({ identity, anchor, text, idempotent }) => {
      // 与智能续写 recordUserMessage 同语义：用户指令先写会话流（实时显示），再持久化到楼层锚定会话。
      logWorldSimulationSession_ACU(identity.chatIdentity, { kind: 'user_message', title: '你的消息', detail: text });
      await appendWorldSimulationUserInstruction_ACU({
        anchor,
        runId: identity.runId,
        taskId: identity.taskId,
        stageId: identity.stageId,
        stageRevision: identity.stageRevision,
        triggerConversationMessageId: identity.triggerConversationMessageId,
        text,
        idempotent,
      }, getChatArray_ACU());
    },
    prepare: async ({ identity, anchor, instruction, envelope, signal, resetRunBudget }) => {
      const chat = getChatArray_ACU();
      const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(anchor, chat);
      const registry = createWorldSimulationEvidenceRegistry_ACU(identity.runId);
      recordWorldSimulationEvidence_ACU(registry, {
        operation: 'initial',
        address: 'anchor:message',
        status: 'ok',
        summary: '冻结 assistant 锚点正文',
        exact: true,
      });
      const baseContext = buildPromptContext_ACU({
        identity, anchor: currentAnchor, instruction, envelope, stagePlan: {}, registry, chat,
      });

      const persistSessionEvent = (eventKey: string, event: import('./agent/agent-session-log').WorldSimulationSessionInput_ACU, stageRevision = identity.stageRevision) =>
        appendWorldSimulationSessionEvent_ACU({
          anchor: currentAnchor,
          runId: identity.runId,
          taskId: identity.taskId,
          stageId: identity.stageId,
          stageRevision,
          eventKey,
          event,
        }, getChatArray_ACU());

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
        stagePlan: plannedRevision.plan, registry, chat,
      });
      const tools = createWorldSimulationHostToolDependencies_ACU({
        anchorMessage: promptContext.anchorMessage,
        summary: '',
        ledger: envelope.ledger,
        stagePlan: plannedRevision.plan,
        candidates: [],
        chronicle: envelope.ledger.chronicle,
        projectionPreview: promptContext.projectionPreview,
        chronicleArchive: readWorldSimulationBucketEntry_ACU(
          WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
          currentAnchor,
          validateWorldSimulationChronicleArchiveSnapshot_ACU,
          chat,
        ) ?? buildEmptyWorldChronicleArchiveSnapshot_ACU(),
        webResearch: envelope.settings.webResearch,
      });
      const invoke = (role: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[], preset: Parameters<typeof callAIWithResolvedPreset_ACU>[1]) =>
        invokeWorldSimulationAgent_ACU(role, messages, preset, identity, signal);
      const subagents = new WorldSimulationSubagentRuntime_ACU({ invoke });
      const mainLoop = new WorldSimulationMainLoop_ACU({ invoke, subagents });
      if (identity.triggerKind === 'agent_chat_message') {
        await seedWorldSimulationUserRequirementsIfEmpty_ACU(envelope.task?.originInstruction ?? instruction, currentAnchor, chat);
        promptContext.userRequirements = renderWorldSimulationUserRequirements_ACU(
          readLatestWorldSimulationUserRequirements_ACU(getChatArray_ACU()).snapshot,
          envelope.task?.originInstruction ?? instruction,
        );
      }
      await compactWorldSimulationConversationAndDispatchRequirements_ACU({
        identity,
        anchor: currentAnchor,
        settings: envelope.settings,
        originInstruction: envelope.task?.originInstruction ?? instruction,
        promptContext,
        subagents,
        registry,
        tools,
        persistSessionEvent: (eventKey, event) => persistSessionEvent(eventKey, event),
        chat: getChatArray_ACU(),
      });
      return {
        revision: plannedRevision,
        execute: async runIdentity => {
          const engine = new WorldSimulationStageExecutionEngine_ACU({
            readEnvelope: () => store.read(),
            getChatIdentity: () => getActiveChatStorageIdentity_ACU(getChatArray_ACU()),
            assertAnchorCurrent: currentIdentity => {
              const restored = restoreWorldSimulationAnchor_ACU(currentIdentity, getChatArray_ACU());
              assertWorldSimulationAnchorCurrent_ACU(restored, getChatArray_ACU());
            },
            runMainLoop: () => mainLoop.run({
              identity: runIdentity,
              settings: store.read()!.settings,
              promptContext: { ...promptContext, task: store.read()!.task, worldStagePlan: plannedRevision.plan },
              registry,
              tools,
              persistSessionEvent: (eventKey, event) => persistSessionEvent(eventKey, event, runIdentity.stageRevision),
              anchor: currentAnchor,
              chat: getChatArray_ACU(),
              resetRunBudget,
              anchorMaterialsCommitted: readWorldSimulationLedgerAtAnchor_ACU(currentAnchor, getChatArray_ACU()) !== null,
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
  conversation: ReturnType<typeof readWorldSimulationConversation_ACU>;
  materials: ReturnType<typeof readLatestWorldSimulationMaterials_ACU>;
  userRequirements: ReturnType<typeof readLatestWorldSimulationUserRequirements_ACU>;
  session: {
    chatIdentity: string | null;
    entries: ReturnType<typeof readWorldSimulationSessionLog_ACU>;
    running: boolean;
  };
  anchor: WorldSimulationAnchorIdentity_ACU | null;
  projectionPreview: string | null;
}

/** 非模型终局 stopReason 的中文文案；模型给出的 blocked 摘要不在表内，原样展示。 */
export const WORLD_SIMULATION_STOP_REASON_LABELS_ACU: Record<string, string> = {
  [WORLD_SIMULATION_STOP_REASON_MANUAL_ACU]: '用户手动停止',
  [WORLD_SIMULATION_STOP_REASON_INTERRUPTED_ACU]: '运行被中断（页面重载或事件丢失），可直接恢复',
  [WORLD_SIMULATION_STOP_REASON_SUPERSEDED_ACU]: '已被更新楼层的推演取代',
  cancelled: '已取消',
};

/** 世界推演写在各楼层上的非权威分桶字段：会话 segment、材料快照、账本状态快照、run 恢复状态。 */
const WORLD_SIMULATION_FLOOR_FIELDS_ACU = [
  WORLD_SIMULATION_STATE_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
  WORLD_SIMULATION_RUN_STATE_FIELD_ACU,
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
] as const;

const RESUME_KEYWORD_ACU = /^(继续|开始|恢复(?:任务)?|resume|continue)$/i;

export class WorldSimulationRuntime_ACU {
  constructor(
    private readonly orchestrator = createProductionOrchestrator_ACU(),
    private readonly getChat: () => any[] = getChatArray_ACU,
  ) {}

  /** 读取派生视图：重载后残留的 running 以 paused/interrupted 呈现，不落盘。 */
  private readEnvelopeView_ACU(): WorldSimulationEnvelope_ACU | null {
    return this.orchestrator.deriveEnvelopeView(new FirstFloorWorldSimulationStore_ACU().read());
  }

  /** 恢复冻结锚点；锚点楼层已删除 / swipe 已切换时返回 null，由调用方决定取代或阻断，不让整页读取失败。 */
  private restoreAnchorOrNull_ACU(identity: WorldSimulationRunIdentity_ACU, chat: any[]): WorldSimulationAnchorIdentity_ACU | null {
    try {
      return restoreWorldSimulationAnchor_ACU(identity, chat);
    } catch {
      return null;
    }
  }

  readUiSnapshot(): WorldSimulationUiSnapshot_ACU {
    const chat = this.getChat();
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat) || null;
    const envelope = this.readEnvelopeView_ACU();
    let anchor: WorldSimulationAnchorIdentity_ACU | null = envelope?.task?.activeRun
      ? this.restoreAnchorOrNull_ACU(envelope.task.activeRun, chat)
      : null;
    if (!anchor) {
      const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
      anchor = resolved.kind === 'resolved' ? resolved.anchor : null;
    }
    return {
      envelope,
      conversation: readWorldSimulationConversation_ACU(chat),
      materials: readLatestWorldSimulationMaterials_ACU(chat),
      userRequirements: readLatestWorldSimulationUserRequirements_ACU(chat),
      session: {
        chatIdentity,
        entries: chatIdentity ? readWorldSimulationSessionLog_ACU(chatIdentity) : [],
        running: chatIdentity ? isWorldSimulationSessionRunning_ACU(chatIdentity) : false,
      },
      anchor,
      projectionPreview: envelope ? buildWorldSimulationProjection_ACU(envelope.ledger) : null,
    };
  }

  isInFlight(): boolean {
    const chatIdentity = getActiveChatStorageIdentity_ACU(this.getChat());
    return chatIdentity ? this.orchestrator.isInFlight(chatIdentity) : false;
  }

  async handleAssistantCompletion(intent: Parameters<typeof resolveWorldSimulationAssistantCompletion_ACU>[0]): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, { getChat: this.getChat, delay: ms => new Promise(resolve => setTimeout(resolve, ms)) });
    if (resolved.kind !== 'resolved') {
      logWarn_ACU(`世界推演自动触发跳过：锚点解析失败（${resolved.reason}）`);
      return null;
    }
    const outcome = await this.orchestrator.start({ triggerKind: 'assistant_completed', anchor: resolved.anchor, instruction: '根据最新 assistant 正文推进世界状态' });
    if (outcome.status === 'skipped') logDebug_ACU(`世界推演自动触发跳过：orchestrator skipped（${outcome.reason}）`);
    return outcome;
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
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
    if (chatIdentity && this.orchestrator.isInFlight(chatIdentity)) await this.orchestrator.interrupt(chatIdentity);
    const envelope = this.readEnvelopeView_ACU();
    const pausedRun = envelope?.task?.status === 'paused' ? envelope.task.activeRun : null;
    const resumeKeyword = !instruction || RESUME_KEYWORD_ACU.test(instruction);
    const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
    if (pausedRun) {
      const pausedAnchor = this.restoreAnchorOrNull_ACU(pausedRun, chat);
      if (pausedAnchor) {
        return this.orchestrator.resume(resumeKeyword ? { anchor: pausedAnchor, resetRunBudget: true } : { anchor: pausedAnchor, instruction, resetRunBudget: true });
      }
    }
    if (!instruction || resolved.kind !== 'resolved') return null;
    return this.orchestrator.start({ triggerKind: 'agent_chat_message', anchor: resolved.anchor, instruction, triggerConversationMessageId: triggerConversationMessageId ?? allocateId_ACU('run') });
  }

  async resume(): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    const envelope = this.readEnvelopeView_ACU();
    const identity = envelope?.task?.activeRun;
    if (!identity) return null;
    const anchor = restoreWorldSimulationAnchor_ACU(identity, this.getChat());
    return this.orchestrator.resume({ anchor });
  }

  /**
   * 保存设置。只有真在途的运行才拒绝（retryable，由页面稍后自动重试）；
   * paused / blocked / 已完成任务都允许改设置——设置在每次运行开始时才被读取。
   */
  async saveSettings(settings: WorldSimulationSettings_ACU): Promise<void> {
    const chat = this.getChat();
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
    if (!chatIdentity) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法保存世界推演设置', false,
      ));
    }
    if (this.orchestrator.isInFlight(chatIdentity)) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '世界推演正在运行，设置将在本轮结束后自动保存', true,
      ));
    }
    await new FirstFloorWorldSimulationStore_ACU().updateAtomically(envelope => ({
      ...(envelope ?? buildDefaultWorldSimulationEnvelope_ACU()),
      settings,
      updatedAt: Date.now(),
    }), { chatIdentity });
  }

  async saveUserRequirements(requirements: unknown): Promise<void> {
    await replaceWorldSimulationUserRequirementsByUser_ACU(requirements, this.getChat());
  }

  /**
   * 一键清空：丢弃任务、阶段、时间线、账本与所有楼层上的会话 / 材料 / 状态 / run 恢复分桶，保留设置。
   * 正文与已写进正文的 <与此同时> 段不动。首楼信封与楼层字段是两次独立宿主保存，不是跨字段事务。
   * @returns 被清理了分桶字段的楼层数
   */
  async clearData(): Promise<{ clearedFloors: number }> {
    const chat = this.getChat();
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
    if (!chatIdentity) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法清空世界推演数据', false,
      ));
    }
    if (this.orchestrator.isInFlight(chatIdentity)) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '世界推演正在运行，请先停止再清空', false,
      ));
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
          'WORLD_SIMULATION_PERSIST_FAILED', 'persist', '清空楼层世界推演字段保存失败，已还原', false,
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
    const chatIdentity = getActiveChatStorageIdentity_ACU(this.getChat());
    return chatIdentity ? this.orchestrator.cancel(chatIdentity) : false;
  }

  /** 停止在途运行并等待其落盘为 paused/manual；返回后可立刻发送新消息恢复或取代。 */
  async stop(): Promise<boolean> {
    const chatIdentity = getActiveChatStorageIdentity_ACU(this.getChat());
    return chatIdentity ? this.orchestrator.interrupt(chatIdentity) : false;
  }
}

let runtime_ACU: WorldSimulationRuntime_ACU | null = null;
export function getWorldSimulationRuntime_ACU(): WorldSimulationRuntime_ACU {
  runtime_ACU ??= new WorldSimulationRuntime_ACU();
  return runtime_ACU;
}

export function createWorldSimulationCompletionIntentForCurrentChat_ACU(eventMessageId: number, chatKey: string, isolationKey: string, generationSeq?: number) {
  return createWorldSimulationCompletionIntent_ACU(eventMessageId, chatKey, isolationKey, getChatArray_ACU(), generationSeq);
}
