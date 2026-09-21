/**
 * service/simulation/agent/agent-requirements-dispatch.ts — 会话压缩后系统派工 requirements-maintainer
 *
 * 不计入主 Agent 派工预算。压缩标记先落盘，再收集被浓缩范围内的实质用户发言；
 * 子代理失败 fail-closed 保留旧快照，只记会话日志。
 */

import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import type { WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import type { WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import type { WorldSimulationRunIdentity_ACU, WorldSimulationSettings_ACU } from '../model';
import {
  readWorldSimulationConversation_ACU,
  writeWorldSimulationConversationCompaction_ACU,
} from './agent-conversation-store';
import { planWorldSimulationHistoryCompaction_ACU } from './agent-history-compactor';
import type { WorldSimulationAnchorIdentity_ACU } from './agent-model';
import type { WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU } from './agent-catalog';
import { logWorldSimulationSession_ACU, updateWorldSimulationSession_ACU, type WorldSimulationSessionInput_ACU } from './agent-session-log';
import type { WorldSimulationSubagentRuntime_ACU } from './agent-subagent-runtime';
import { countWorldSimulationTokens_ACU } from './agent-token-budget';
import {
  collectWorldSimulationSubstantialUserTexts_ACU,
  readLatestWorldSimulationUserRequirements_ACU,
  renderWorldSimulationUserRequirements_ACU,
  writeWorldSimulationUserRequirementsSnapshot_ACU,
} from './agent-user-requirements';

export async function compactWorldSimulationConversationAndDispatchRequirements_ACU(input: {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  originInstruction: string;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  subagents: WorldSimulationSubagentRuntime_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  persistSessionEvent: (eventKey: string, event: WorldSimulationSessionInput_ACU) => Promise<unknown>;
  chat?: any[];
}): Promise<void> {
  const trigger = input.settings.agentHistoryTokenBudget;
  if (!Number.isFinite(trigger) || trigger <= 0) return;
  const messages = Array.isArray(input.chat) ? input.chat : getChatArray_ACU();
  const view = readWorldSimulationConversation_ACU(messages);
  const previousThroughId = view.compaction?.compactedThroughId ?? 0;
  const planned = await planWorldSimulationHistoryCompaction_ACU({
    view,
    triggerTokens: trigger,
    fixedPromptTokens: 0,
    countTokens: countWorldSimulationTokens_ACU,
  });
  if (!planned.mark) return;
  const persisted = await writeWorldSimulationConversationCompaction_ACU({
    anchor: input.anchor,
    compaction: planned.mark,
  }, messages);
  if (!persisted) return;
  const userTexts = collectWorldSimulationSubstantialUserTexts_ACU(view.messages, previousThroughId, planned.mark.compactedThroughId);
  input.promptContext.history = readWorldSimulationConversation_ACU(messages);
  if (!userTexts.length) return;

  const entryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
    kind: 'delegation',
    agentName: WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU,
    title: '用户要求维护执行中',
    detail: `压缩范围内 ${userTexts.length} 条实质用户发言`,
    status: 'running',
  });
  try {
    const instruction = [
      '会话历史刚被压缩。请根据被浓缩范围内的实质用户发言，全量替换整理 $WORLD_USER_REQUIREMENTS。',
      '被浓缩范围内的实质用户发言：',
      ...userTexts.map((text, index) => `${index + 1}. ${text}`),
    ].join('\n');
    const result = await input.subagents.runRequirementsMaintainer({
      instruction,
      settings: input.settings,
      promptContext: input.promptContext,
      registry: input.registry,
      tools: input.tools,
      runId: input.identity.runId,
    });
    await writeWorldSimulationUserRequirementsSnapshot_ACU(input.anchor, result.requirements, getChatArray_ACU());
    const snapshot = readLatestWorldSimulationUserRequirements_ACU(getChatArray_ACU()).snapshot;
    input.promptContext.userRequirements = renderWorldSimulationUserRequirements_ACU(snapshot, input.originInstruction);
    updateWorldSimulationSession_ACU(input.identity.chatIdentity, entryId, {
      title: '用户要求维护完成',
      detail: result.requirements.length ? `现有 ${result.requirements.length} 条用户要求` : '清单为空',
      ok: true,
      status: 'done',
    });
    await input.persistSessionEvent(`requirements-${planned.mark.compactedThroughId}`, {
      kind: 'delegation',
      agentName: WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU,
      title: '用户要求维护完成',
      detail: result.summary,
      ok: true,
      status: 'done',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    updateWorldSimulationSession_ACU(input.identity.chatIdentity, entryId, {
      title: '用户要求维护失败',
      detail,
      ok: false,
      status: 'failed',
    });
    await input.persistSessionEvent(`requirements-${planned.mark.compactedThroughId}-failed`, {
      kind: 'delegation',
      agentName: WORLD_SIMULATION_REQUIREMENTS_MAINTAINER_NAME_ACU,
      title: '用户要求维护失败',
      detail,
      ok: false,
      status: 'failed',
    }).catch((): void => undefined);
  }
}
