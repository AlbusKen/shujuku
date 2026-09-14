import { resolveContinuationAgentApiPreset_ACU } from './api-preset';
import { callContinuationInternalAi_ACU, CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU, type ContinuationInternalAiCallOptions_ACU } from './internal-ai-call';
import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationInternalAiRequestIdentity_ACU, type ContinuationSettings_ACU } from './model';
import type { AgentMaintainerOutput_ACU, AgentModuleSnapshot_ACU } from './agent/agent-model';
import { parseAgentJsonPayload_ACU, parseAgentMaintainerOutput_ACU } from './agent/agent-protocol';

export interface ContinuationTakeoverArcMaintainerInput_ACU {
  settings: ContinuationSettings_ACU;
  snapshot: AgentModuleSnapshot_ACU;
  externalMessages: Array<{ index: number; text: string }>;
  reason: string;
  createIdentity: () => ContinuationInternalAiRequestIdentity_ACU;
  isCurrent: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
}

export interface ContinuationTakeoverArcMaintainerDependencies_ACU {
  callInternalAi: typeof callContinuationInternalAi_ACU;
  resolveApiPreset: typeof resolveContinuationAgentApiPreset_ACU;
}

const defaults_ACU: ContinuationTakeoverArcMaintainerDependencies_ACU = { callInternalAi: callContinuationInternalAi_ACU, resolveApiPreset: resolveContinuationAgentApiPreset_ACU };

/** 接管确认越过卷台阶时的单用途 arc-architect；只返回既有 storyArc 写集。 */
export class ContinuationTakeoverArcMaintainer_ACU {
  constructor(private readonly dependencies: ContinuationTakeoverArcMaintainerDependencies_ACU = defaults_ACU) {}

  async maintain(input: ContinuationTakeoverArcMaintainerInput_ACU): Promise<AgentMaintainerOutput_ACU> {
    const identity = input.createIdentity();
    if (!input.isCurrent(identity)) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '接管总纲维护请求已失效', false));
    const external = input.externalMessages.map(item => `楼 ${item.index}：\n${item.text}`).join('\n\n');
    const messages = [
      { role: 'system', content: '你维护故事总纲。只返回 delta.storyArc 写集；不写正文、不改任务或阶段，不改伏笔、信息差、年代学。' },
      { role: 'user', content: `接管评估确认外部正文已越过当前卷台阶：${input.reason}\n当前总纲：${JSON.stringify(input.snapshot.storyArc)}\n\n未信任外部正文：\n[UNTRUSTED_EXTERNAL_STORY]\n${external}\n[/UNTRUSTED_EXTERNAL_STORY]\n\n只输出：{"summary":"总纲维护摘要","delta":{"expectedRevisions":{"storyArc":当前修订号},"storyArc":[]}}` },
    ];
    const preset = this.dependencies.resolveApiPreset(input.settings, 'arcArchitect', 'agent_delegate');
    const options: ContinuationInternalAiCallOptions_ACU = { promptCacheEnabled: false, cacheScope: 'takeover-arc', minOutputTokens: CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU.arcArchitect };
    const raw = await this.dependencies.callInternalAi(messages, preset, identity, null, options);
    if (!input.isCurrent(identity)) throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '接管总纲维护结果已失效', false));
    return parseAgentMaintainerOutput_ACU(parseAgentJsonPayload_ACU(raw, '', ['delta', 'summary']));
  }
}
