import { WORLD_SIMULATION_SCHEMA_VERSION_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationStagePlan_ACU, type WorldSimulationStageRevision_ACU, type WorldSimulationSettings_ACU } from './model';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU, type WorldSimulationResolvedApiPreset_ACU } from './api-preset';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationPlannerProtocolInstruction_ACU } from './agent/agent-defaults';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent/agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationJsonPayload_ACU, parseWorldSimulationPlannerOutput_ACU, recordWorldSimulationProtocolFailure_ACU } from './agent/agent-protocol';
import { executeWorldSimulationFinalRequest_ACU } from './agent/final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './agent/prompt-template';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';
import { logWorldSimulationSession_ACU, updateWorldSimulationSession_ACU } from './agent/agent-session-log';

export interface WorldSimulationStagePlannerDependencies_ACU {
  invoke(messages: readonly { role: string; content: string }[], preset: WorldSimulationResolvedApiPreset_ACU): Promise<string>;
  countTokens?: WorldSimulationTokenCounter_ACU;
  apiPreset?: WorldSimulationApiPresetDependencies_ACU;
  protocolRetries?: number;
  chatIdentity?: string;
}
export interface WorldSimulationStagePlanRequest_ACU {
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  now?: number;
}

export class WorldSimulationStagePlanner_ACU {
  constructor(private readonly dependencies: WorldSimulationStagePlannerDependencies_ACU) {}

  async plan(input: WorldSimulationStagePlanRequest_ACU): Promise<{ summary: string; revision: WorldSimulationStageRevision_ACU }> {
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, 'world-stage-planner', 'agent_loop', this.dependencies.apiPreset);
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
      const rendered = await renderWorldSimulationPrompt_ACU(input.settings.agentPrompts['world-stage-planner'], 'world-stage-planner', createWorldSimulationPlaceholderResolvers_ACU(input.promptContext));
      const transcript: Array<{ role: string; content: string }> = [];
      const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
      const protocolGuard = { role: 'system', content: worldSimulationPlannerProtocolInstruction_ACU() };

      for (;;) {
        const sent = await executeWorldSimulationFinalRequest_ACU({
          messages: [...rendered.messages, protocolGuard, ...transcript],
          historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          invoke: messages => this.dependencies.invoke(messages, preset),
        });
        if (sent.status === 'rejected') throw new Error(sent.reason);
        const raw = String(sent.response ?? '');
        try {
          const parsed = parseWorldSimulationPlannerOutput_ACU(parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU['world-stage-planner'], ['action', 'plan']));
          if (parsed.action !== 'plan') throw new Error('WORLD_SIMULATION_PLAN_ACTION_REQUIRED');
          const revision = 1;
          if (this.dependencies.chatIdentity && entryId !== null) {
            updateWorldSimulationSession_ACU(this.dependencies.chatIdentity, entryId, {
              title: parsed.plan.title,
              detail: parsed.summary,
              ok: true,
              status: 'done',
            });
          }
          return { summary: parsed.summary, revision: { revision, createdAt: input.now ?? Date.now(), reason: 'initial' as const, replanInstruction: '', frozen: false, plan: parsed.plan } };
        } catch (error) {
          const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
          if (this.dependencies.chatIdentity) {
            logWorldSimulationSession_ACU(this.dependencies.chatIdentity, {
              kind: 'protocol_retry',
              title: failure.retry ? '阶段规划协议修正' : '阶段规划输出被拒绝',
              detail: `${failure.issue.reasonCode} ${failure.issue.path}\n模型返回片段：${raw.slice(0, 300) || '(空)'}`,
              agentName: 'world-stage-planner',
              ok: false,
            });
          }
          if (!failure.retry) throw error;
          transcript.push(
            { role: 'assistant', content: raw || '(empty)' },
            { role: 'user', content: `阶段规划输出未通过协议：${failure.issue.reasonCode} ${failure.issue.path}。请根据上方协议重新输出一个完整 JSON 对象；不得省略 plan，不得附加解释或 Markdown。` },
          );
        }
      }
    } catch (error) {
      if (this.dependencies.chatIdentity && entryId !== null) {
        updateWorldSimulationSession_ACU(this.dependencies.chatIdentity, entryId, {
          title: '阶段规划失败',
          detail: error instanceof Error ? error.message : String(error),
          ok: false,
          status: 'failed',
        });
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
