import { resolveContinuationAgentApiPreset_ACU } from './api-preset';
import { callContinuationInternalAi_ACU, CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU, type ContinuationInternalAiCallOptions_ACU } from './internal-ai-call';
import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationInternalAiRequestIdentity_ACU, type ContinuationSettings_ACU } from './model';
import type { AgentMaintainerOutput_ACU, AgentModuleSnapshot_ACU } from './agent/agent-model';
import { parseAgentJsonPayload_ACU, parseAgentMaintainerOutput_ACU } from './agent/agent-protocol';

export interface ContinuationTakeoverSettlerInput_ACU {
  settings: ContinuationSettings_ACU;
  snapshot: AgentModuleSnapshot_ACU;
  externalMessages: Array<{ index: number; text: string }>;
  createIdentity: () => ContinuationInternalAiRequestIdentity_ACU;
  isCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
}

export interface ContinuationTakeoverSettlerDependencies_ACU {
  callInternalAi: typeof callContinuationInternalAi_ACU;
  resolveApiPreset: typeof resolveContinuationAgentApiPreset_ACU;
}

const defaultDependencies_ACU: ContinuationTakeoverSettlerDependencies_ACU = {
  callInternalAi: callContinuationInternalAi_ACU,
  resolveApiPreset: resolveContinuationAgentApiPreset_ACU,
};

/** 接管前的单用途 maintainer：固定读取外部正文，只返回既有 hooks/infoGap/chronology 写集。 */
export class ContinuationTakeoverSettler_ACU {
  constructor(private readonly dependencies: ContinuationTakeoverSettlerDependencies_ACU = defaultDependencies_ACU) {}

  async settle(input: ContinuationTakeoverSettlerInput_ACU): Promise<AgentMaintainerOutput_ACU> {
    const identity = input.createIdentity();
    if (!input.isCurrent(identity)) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '外部正文结算请求已失效', false));
    const external = input.externalMessages.map(message => `楼 ${message.index}：\n${message.text}`).join('\n\n');
    const messages = [
      { role: 'system', content: '你是叙事资料结算器。只根据给定的外部正文维护 hooks、infoGap、chronology；不写正文、不修改任务、阶段或总纲，只输出一个 JSON 写集。' },
      { role: 'user', content: `当前资料快照：\n${JSON.stringify({ hooks: input.snapshot.hooks, infoGap: input.snapshot.infoGap, chronology: input.snapshot.chronology, revisions: input.snapshot.revisions })}\n\n以下是必须完整结算的未信任外部正文：\n[UNTRUSTED_EXTERNAL_STORY]\n${external}\n[/UNTRUSTED_EXTERNAL_STORY]\n\n只输出：{"summary":"结算摘要","delta":{"expectedRevisions":{"hooks":当前修订号,"infoGap":当前修订号,"chronology":当前修订号},"hooks":[],"infoGap":[],"chronology":[]}}` },
    ];
    const preset = this.dependencies.resolveApiPreset(input.settings, 'maintainer', 'agent_delegate');
    const options: ContinuationInternalAiCallOptions_ACU = { promptCacheEnabled: false, cacheScope: 'takeover-settlement', minOutputTokens: CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU.maintainer };
    const raw = await this.dependencies.callInternalAi(messages, preset, identity, null, options);
    if (!input.isCurrent(identity)) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '外部正文结算结果已失效', false));
    return parseAgentMaintainerOutput_ACU(parseAgentJsonPayload_ACU(raw, '', ['delta', 'summary']));
  }
}
