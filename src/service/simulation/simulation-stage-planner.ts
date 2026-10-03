import {
  WORLD_SIMULATION_SCHEMA_VERSION_ACU,
  type WorldCollisionReport_ACU,
  type WorldSimulationEnvelope_ACU,
  type WorldSimulationLedgerModule_ACU,
  type WorldSimulationStagePlan_ACU,
  type WorldSimulationStageRevision_ACU,
  type WorldSimulationSettings_ACU,
} from './model';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU, type WorldSimulationResolvedApiPreset_ACU } from './api-preset';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationPlannerProtocolInstruction_ACU } from './agent/agent-defaults';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent/agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationJsonPayload_ACU, parseWorldSimulationPlannerOutput_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationPlannerProtocolRejection_ACU } from './agent/agent-protocol';
import { executeWorldSimulationFinalRequest_ACU } from './agent/final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './agent/prompt-template';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';
import { logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU, updateWorldSimulationSession_ACU } from './agent/agent-session-log';
import type { WorldSimulationSessionInput_ACU } from './agent/agent-session-log';
import { nativeToolArguments_ACU, nativeToolExchange_ACU, normalizeAgentModelReply_ACU, type AiChatTurn_ACU, type AiWireMessage_ACU } from '../ai/native-tool';
import { resolveAgentToolMode_ACU, type AgentToolMode_ACU } from '../ai/agent-tool-mode';
import { splitNativeDecisionCalls_ACU, submitPayloadObject_ACU, worldSimulationPlannerSubmitTool_ACU } from '../ai/agent-decision-tools';
import { adaptWorldSimulationPromptSegmentsToToolMode_ACU, worldSimulationProtocolForMode_ACU } from './agent/agent-prompt-mode';
import { finishWorldSimulationMessages_ACU, worldSimulationInvokeTools_ACU, type WorldSimulationInvokeTools_ACU } from './agent/agent-subagent-runtime';

export interface WorldSimulationStagePlannerDependencies_ACU {
  invoke(messages: readonly { role: string; content: string }[], preset: WorldSimulationResolvedApiPreset_ACU, request?: WorldSimulationInvokeTools_ACU): Promise<string | AiChatTurn_ACU>;
  countTokens?: WorldSimulationTokenCounter_ACU;
  apiPreset?: WorldSimulationApiPresetDependencies_ACU;
  protocolRetries?: number;
  chatIdentity?: string;
  persistSessionEvent?: (eventKey: string, event: WorldSimulationSessionInput_ACU, stageRevision: number) => Promise<unknown>;
}
export interface WorldSimulationStagePlanRequest_ACU {
  settings: WorldSimulationSettings_ACU;
  toolMode?: AgentToolMode_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  now?: number;
}

const DIRECTOR_OWNED_SPECIALISTS_ACU = ['timekeeper', 'undercurrent-analyst', 'dramatis-keeper'] as const;
const DIRECTOR_OWNED_LEDGER_CHANGES_ACU: WorldSimulationLedgerModule_ACU[] = ['clock', 'dimensions', 'seeds', 'actors', 'rumors', 'player'];

/**
 * 新建 run 不再单独调用 planner LLM。阶段计划由确定性模板填入，
 * director 首轮把「锁定焦点」与取证/派工写进同一次决策。
 * chronicler 不进入常规 plannedSpecialists。
 */
export function buildDirectorOwnedStageRevision_ACU(input: {
  instruction: string;
  collisions: WorldCollisionReport_ACU;
  now?: number;
}): WorldSimulationStageRevision_ACU {
  const factsToVerify = [
    ...(input.collisions.collidedSeeds.length ? [`碰撞暗流：${input.collisions.collidedSeeds.join('、')}`] : []),
    ...(input.collisions.ripeRumors.length ? [`成熟传闻：${input.collisions.ripeRumors.join('、')}`] : []),
    '正文时间跨度',
    '维度压力与暗流生命周期',
    '行动者信息边界',
  ];
  const objective = input.instruction.trim() || '根据最新剧情推算幕后世界动态';
  return {
    revision: 1,
    createdAt: input.now ?? Date.now(),
    reason: 'initial',
    replanInstruction: '',
    frozen: false,
    plan: {
      schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU,
      title: '本轮幕后推演',
      objective,
      impactScope: ['当前世界状态'],
      factsToVerify,
      plannedTools: ['read'],
      plannedSpecialists: [...DIRECTOR_OWNED_SPECIALISTS_ACU],
      expectedLedgerChanges: [...DIRECTOR_OWNED_LEDGER_CHANGES_ACU],
      convergenceConditions: ['证据与候选闭合'],
      blockingConditions: ['缺少锚点或关键证据'],
      completedSteps: [],
      nextStep: '取证后同批派工',
    },
  };
}

export class WorldSimulationStagePlanner_ACU {
  constructor(private readonly dependencies: WorldSimulationStagePlannerDependencies_ACU) {}

  async plan(input: WorldSimulationStagePlanRequest_ACU): Promise<{ summary: string; revision: WorldSimulationStageRevision_ACU }> {
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, 'world-stage-planner', 'agent_loop', this.dependencies.apiPreset);
    const toolMode = input.toolMode ?? resolveAgentToolMode_ACU('worldSimulation', preset);
    const request = worldSimulationInvokeTools_ACU(toolMode, [worldSimulationPlannerSubmitTool_ACU()]);
    let protocolEventSequence = 0;
    const persistEntry = async (entryId: number, eventKey: string, stageRevision: number): Promise<void> => {
      if (!this.dependencies.chatIdentity || !this.dependencies.persistSessionEvent) return;
      const entry = readWorldSimulationSessionLog_ACU(this.dependencies.chatIdentity).find(item => item.id === entryId);
      if (!entry) return;
      await this.dependencies.persistSessionEvent(eventKey, {
        kind: entry.kind, title: entry.title, detail: entry.detail,
        agentName: entry.agentName, ok: entry.ok, status: entry.status,
      }, stageRevision);
    };
    const entryId = this.dependencies.chatIdentity
      ? logWorldSimulationSession_ACU(this.dependencies.chatIdentity, {
        kind: 'stage_plan',
        title: '阶段规划正在工作',
        detail: '正在对照世界时钟、暗流状态与本轮指令锁定推演焦点…',
        agentName: 'world-stage-planner',
        status: 'running',
      })
      : null;

    try {
      const rendered = await renderWorldSimulationPrompt_ACU(adaptWorldSimulationPromptSegmentsToToolMode_ACU('world-stage-planner', input.settings.agentPrompts['world-stage-planner'], toolMode), 'world-stage-planner', createWorldSimulationPlaceholderResolvers_ACU(input.promptContext));
      const transcript: AiWireMessage_ACU[] = [];
      const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
      const protocolGuard = { role: 'system', content: worldSimulationProtocolForMode_ACU('world-stage-planner', worldSimulationPlannerProtocolInstruction_ACU(), toolMode) };

      for (;;) {
        const sent = await executeWorldSimulationFinalRequest_ACU({
          messages: finishWorldSimulationMessages_ACU(toolMode, [...rendered.messages, protocolGuard, ...transcript]),
          tools: request.tools,
          inputLimitTokens: input.settings.agentHistoryTokenBudget,
          historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          invoke: messages => this.dependencies.invoke(messages, preset, request),
        });
        if (sent.status === 'rejected') throw new Error(sent.reason);
        const turn = normalizeAgentModelReply_ACU(sent.response);
        const raw = turn.content;
        let parsed;
        try {
          let payload: Record<string, unknown>;
          if (toolMode === 'tools') {
            const split = splitNativeDecisionCalls_ACU(nativeToolArguments_ACU(turn.toolCalls), ['submit']);
            if (!split.decision || split.tools.length) throw new Error('WORLD_SIMULATION_PLANNER_SUBMIT_REQUIRED');
            payload = { ...submitPayloadObject_ACU(split.decision.payload), action: 'plan' };
          } else {
            if (turn.toolCalls.length) throw new Error('WORLD_SIMULATION_PLANNER_JSON_REQUIRED');
            payload = parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU['world-stage-planner'], ['action', 'plan']);
          }
          parsed = parseWorldSimulationPlannerOutput_ACU(payload);
          if (parsed.action !== 'plan') throw new Error('WORLD_SIMULATION_PLAN_ACTION_REQUIRED');
        } catch (error) {
          const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
          if (this.dependencies.chatIdentity) {
            const retryEntryId = logWorldSimulationSession_ACU(this.dependencies.chatIdentity, {
              kind: 'protocol_retry',
              title: failure.retry ? '阶段规划协议修正' : '阶段规划输出被拒绝',
              detail: `${failure.issue.reasonCode} ${failure.issue.path}\n模型返回片段：${raw.slice(0, 300) || '(空)'}`,
              agentName: 'world-stage-planner',
              ok: false,
            });
            await persistEntry(retryEntryId, `stage-plan-protocol-${++protocolEventSequence}`, 0);
          }
          if (!failure.retry) throw error;
          const rejection = worldSimulationProtocolForMode_ACU('world-stage-planner', renderWorldSimulationPlannerProtocolRejection_ACU(failure.issue), toolMode);
          if (toolMode === 'tools' && turn.toolCalls.length && turn.toolCalls.every(call => call.id && call.name)) {
            transcript.push(...nativeToolExchange_ACU(turn.content, turn.toolCalls, turn.toolCalls.map(() => rejection)));
          } else {
            transcript.push(
              { role: 'assistant', content: raw || '(empty)' },
              { role: 'user', content: rejection },
            );
          }
          continue;
        }
        const revision = 1;
        if (this.dependencies.chatIdentity && entryId !== null) {
          updateWorldSimulationSession_ACU(this.dependencies.chatIdentity, entryId, {
            title: parsed.plan.title,
            detail: parsed.summary,
            ok: true,
            status: 'done',
          });
          await persistEntry(entryId, 'stage-plan', revision);
        }
        return { summary: parsed.summary, revision: { revision, createdAt: input.now ?? Date.now(), reason: 'initial' as const, replanInstruction: '', frozen: false, plan: parsed.plan } };
      }
    } catch (error) {
      if (this.dependencies.chatIdentity && entryId !== null) {
        updateWorldSimulationSession_ACU(this.dependencies.chatIdentity, entryId, {
          title: '阶段规划失败',
          detail: error instanceof Error ? error.message : String(error),
          ok: false,
          status: 'failed',
        });
        await persistEntry(entryId, 'stage-plan-failed', 0);
      }
      throw error;
    }
  }
}

export function confirmWorldSimulationStageRevision_ACU(revision: WorldSimulationStageRevision_ACU): WorldSimulationStageRevision_ACU {
  if (revision.frozen) return { ...revision, plan: { ...revision.plan } };
  return { ...revision, frozen: true, plan: { ...revision.plan } };
}

export function replaceWorldSimulationStagePlan_ACU(revision: WorldSimulationStageRevision_ACU, plan: WorldSimulationStagePlan_ACU): WorldSimulationStageRevision_ACU {
  if (revision.frozen) throw new Error('WORLD_SIMULATION_STAGE_REVISION_FROZEN');
  if (plan.schemaVersion !== WORLD_SIMULATION_SCHEMA_VERSION_ACU) throw new Error('WORLD_SIMULATION_STAGE_PLAN_SCHEMA_INVALID');
  return { ...revision, plan: { ...plan } };
}

export function activeWorldSimulationStageRevision_ACU(envelope: WorldSimulationEnvelope_ACU): WorldSimulationStageRevision_ACU | null {
  const stage = envelope.stages.find(item => item.stageId === envelope.activeStageId);
  return stage?.revisions.find(item => item.revision === stage.activeRevision) ?? null;
}
