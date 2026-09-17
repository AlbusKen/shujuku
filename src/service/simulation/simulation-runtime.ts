import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { callAIWithResolvedPreset_ACU } from '../ai/api-call';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, type WorldSimulationAgentName_ACU } from './agent/agent-catalog';
import { appendWorldSimulationConversationSegment_ACU, readWorldSimulationConversation_ACU } from './agent/agent-conversation-store';
import { readLatestWorldSimulationMaterials_ACU } from './agent/agent-module-store';
import { isWorldSimulationSessionRunning_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU } from './agent/agent-session-log';
import { WORLD_SIMULATION_TOOL_ADDRESSES_ACU } from './world-simulation-agent-tools';
import { WorldSimulationMainLoop_ACU } from './agent/agent-main-loop';
import type { WorldSimulationAnchorIdentity_ACU } from './agent/agent-model';
import type { WorldSimulationPlaceholderContext_ACU } from './agent/agent-placeholder-resolver';
import { WorldSimulationSubagentRuntime_ACU } from './agent/agent-subagent-runtime';
import { createWorldSimulationError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationSettings_ACU } from './model';
import { commitWorldSimulationProjection_ACU } from './simulation-commit-adapter';
import { WorldSimulationOrchestrator_ACU, type WorldSimulationOrchestratorResult_ACU } from './simulation-orchestrator';
import { WorldSimulationStagePlanner_ACU } from './simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from './simulation-stage-execution-engine';
import { FirstFloorWorldSimulationStore_ACU, assertWorldSimulationAnchorCurrent_ACU } from './simulation-store';
import { buildDefaultWorldSimulationEnvelope_ACU } from './defaults';
import { buildWorldSimulationProjection_ACU } from './simulation-projection';
import { createWorldSimulationHostToolDependencies_ACU } from './world-simulation-host-tools';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from './world-simulation-evidence-registry';
import { beginWorldSimulationInternalAiMainApiInvocation_ACU, beginWorldSimulationInternalAiRequest_ACU, endWorldSimulationInternalAiMainApiInvocation_ACU, settleWorldSimulationInternalAiRequest_ACU } from './simulation-internal-ai-events';
import { createWorldSimulationCompletionIntent_ACU, resolveLatestWorldSimulationAssistant_ACU, resolveWorldSimulationAssistantCompletion_ACU, restoreWorldSimulationAnchor_ACU } from './simulation-trigger-adapter';

let allocatedId_ACU = 0;
let internalRequestSequence_ACU = 0;
const allocateId_ACU = (kind: 'task' | 'stage' | 'run' | 'timeline'): string => `${kind}-${Date.now().toString(36)}-${++allocatedId_ACU}`;
const anchorText_ACU = (anchor: WorldSimulationAnchorIdentity_ACU, chat: any[]): string => {
  const message = chat[anchor.messageIndex];
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
    agentCatalog: WORLD_SIMULATION_AGENT_CATALOG_ACU,
    toolCatalog: WORLD_SIMULATION_TOOL_ADDRESSES_ACU,
    evidence: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry).entries,
    userGuidance: input.instruction,
    worldState: input.envelope.ledger,
    anchorMessage: anchorText_ACU(input.anchor, input.chat),
    anchorIdentity: input.anchor,
    worldStagePlan: input.stagePlan,
    worldChronicle: input.envelope.ledger.chronicle,
    worldCandidates: [],
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry),
    projectionPreview: {},
  };
}

function createProductionOrchestrator_ACU(): WorldSimulationOrchestrator_ACU {
  const store = new FirstFloorWorldSimulationStore_ACU();
  return new WorldSimulationOrchestrator_ACU({
    store,
    now: () => Date.now(),
    allocateId: allocateId_ACU,
    assertAnchorCurrent: anchor => { assertWorldSimulationAnchorCurrent_ACU(anchor, getChatArray_ACU()); },
    commitProjection: commitWorldSimulationProjection_ACU,
    appendUserMessage: async ({ identity, anchor, text }) => {
      // 与智能续写 recordUserMessage 同语义：用户指令先写会话流（实时显示），再持久化到楼层锚定会话。
      logWorldSimulationSession_ACU(identity.chatIdentity, { kind: 'user_message', title: '你的消息', detail: text });
      await appendWorldSimulationConversationSegment_ACU({
        anchor,
        segmentId: `user:${identity.runId}`,
        runId: identity.runId,
        taskId: identity.taskId,
        stageId: identity.stageId,
        stageRevision: identity.stageRevision,
        appends: [{ kind: 'user', text, turnKey: identity.triggerConversationMessageId ?? identity.runId }],
      }, getChatArray_ACU());
    },
    prepare: async ({ identity, anchor, instruction, envelope, signal }) => {
      const chat = getChatArray_ACU();
      assertWorldSimulationAnchorCurrent_ACU(anchor, chat);
      const registry = createWorldSimulationEvidenceRegistry_ACU(identity.runId);
      recordWorldSimulationEvidence_ACU(registry, {
        operation: 'initial',
        address: 'anchor:message',
        status: 'ok',
        summary: '冻结 assistant 锚点正文',
        exact: true,
      });
      const baseContext = buildPromptContext_ACU({
        identity, anchor, instruction, envelope, stagePlan: {}, registry, chat,
      });

      const planner = new WorldSimulationStagePlanner_ACU({
        invoke: (messages, preset) => invokeWorldSimulationAgent_ACU('world-stage-planner', messages, preset, identity, signal),
        chatIdentity: identity.chatIdentity,
      });
      const plannedRevision = (await planner.plan({ settings: envelope.settings, promptContext: baseContext, now: Date.now() })).revision;
      const promptContext = buildPromptContext_ACU({
        identity, anchor, instruction, envelope,
        stagePlan: plannedRevision.plan, registry, chat,
      });
      const tools = createWorldSimulationHostToolDependencies_ACU({
        anchorMessage: promptContext.anchorMessage,
        summary: '',
        ledger: envelope.ledger,
        stagePlan: plannedRevision.plan,
        candidates: [],
        chronicle: envelope.ledger.chronicle,
        projectionPreview: {},
        webResearch: envelope.settings.webResearch,
      });
      const invoke = (role: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[], preset: Parameters<typeof callAIWithResolvedPreset_ACU>[1]) =>
        invokeWorldSimulationAgent_ACU(role, messages, preset, identity, signal);
      const subagents = new WorldSimulationSubagentRuntime_ACU({ invoke });
      const mainLoop = new WorldSimulationMainLoop_ACU({ invoke, subagents });
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
  session: {
    chatIdentity: string | null;
    entries: ReturnType<typeof readWorldSimulationSessionLog_ACU>;
    running: boolean;
  };
  anchor: WorldSimulationAnchorIdentity_ACU | null;
  projectionPreview: string | null;
}

export class WorldSimulationRuntime_ACU {
  constructor(
    private readonly orchestrator = createProductionOrchestrator_ACU(),
    private readonly getChat: () => any[] = getChatArray_ACU,
  ) {}

  readUiSnapshot(): WorldSimulationUiSnapshot_ACU {
    const chat = this.getChat();
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat) || null;
    const envelope = new FirstFloorWorldSimulationStore_ACU().read();
    let anchor: WorldSimulationAnchorIdentity_ACU | null = null;
    if (envelope?.task?.activeRun) {
      anchor = restoreWorldSimulationAnchor_ACU(envelope.task.activeRun, chat);
    } else {
      const resolved = resolveLatestWorldSimulationAssistant_ACU(chat);
      anchor = resolved.kind === 'resolved' ? resolved.anchor : null;
    }
    return {
      envelope,
      conversation: readWorldSimulationConversation_ACU(chat),
      materials: readLatestWorldSimulationMaterials_ACU(chat),
      session: {
        chatIdentity,
        entries: chatIdentity ? readWorldSimulationSessionLog_ACU(chatIdentity) : [],
        running: chatIdentity ? isWorldSimulationSessionRunning_ACU(chatIdentity) : false,
      },
      anchor,
      projectionPreview: envelope ? buildWorldSimulationProjection_ACU(envelope.ledger) : null,
    };
  }

  async handleAssistantCompletion(intent: Parameters<typeof resolveWorldSimulationAssistantCompletion_ACU>[0]): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    const resolved = await resolveWorldSimulationAssistantCompletion_ACU(intent, { getChat: this.getChat, delay: ms => new Promise(resolve => setTimeout(resolve, ms)) });
    if (resolved.kind !== 'resolved') return null;
    return this.orchestrator.start({ triggerKind: 'assistant_completed', anchor: resolved.anchor, instruction: '根据最新 assistant 正文推进世界状态' });
  }

  async sendAgentMessage(text: string, triggerConversationMessageId?: string): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    const instruction = text.trim();
    if (!instruction) return null;
    const resolved = resolveLatestWorldSimulationAssistant_ACU(this.getChat());
    if (resolved.kind !== 'resolved') return null;
    return this.orchestrator.start({ triggerKind: 'agent_chat_message', anchor: resolved.anchor, instruction, triggerConversationMessageId: triggerConversationMessageId ?? allocateId_ACU('run') });
  }

  async resume(): Promise<WorldSimulationOrchestratorResult_ACU | null> {
    const envelope = new FirstFloorWorldSimulationStore_ACU().read();
    const identity = envelope?.task?.activeRun;
    if (!identity) return null;
    const anchor = restoreWorldSimulationAnchor_ACU(identity, this.getChat());
    return this.orchestrator.resume({ anchor });
  }

  async saveSettings(settings: WorldSimulationSettings_ACU): Promise<void> {
    const chat = this.getChat();
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
    if (!chatIdentity) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法保存世界推演设置', false,
      ));
    }
    const store = new FirstFloorWorldSimulationStore_ACU();
    const current = store.read();
    if (current?.task?.activeRun) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '世界推演正在运行，拒绝覆盖设置', false,
      ));
    }
    await store.updateAtomically(envelope => ({
      ...(envelope ?? buildDefaultWorldSimulationEnvelope_ACU()),
      settings,
      updatedAt: Date.now(),
    }), {
      chatIdentity,
      taskId: current?.task?.taskId ?? null,
      stageId: current?.activeStageId ?? null,
      revision: current?.task?.activeRun?.stageRevision ?? null,
    });
  }

  cancel(): boolean {
    const chatIdentity = getActiveChatStorageIdentity_ACU(this.getChat());
    return chatIdentity ? this.orchestrator.cancel(chatIdentity) : false;
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
