import {
  parseAgentRequirementSnapshot_ACU,
  parseAgentRequirementsReplacement_ACU,
  type AgentRequirementSnapshot_ACU,
  type AgentRequirementsReplacement_ACU,
} from './requirements';
import type { AgentFeature_ACU } from './material-grants';

export function createEmptyAgentRequirementSnapshot_ACU(feature: AgentFeature_ACU): AgentRequirementSnapshot_ACU {
  return { feature, revision: 0, lastAppliedUserMessageId: null, requirements: [] };
}

/** Applies one full replacement after source-reference validation; stale revisions never overwrite current requirements. */
export function replaceAgentRequirementsSnapshot_ACU(
  current: AgentRequirementSnapshot_ACU | null,
  feature: AgentFeature_ACU,
  rawReplacement: unknown,
  knownUserMessageIds: readonly string[],
): AgentRequirementSnapshot_ACU {
  const base = current === null ? createEmptyAgentRequirementSnapshot_ACU(feature) : parseAgentRequirementSnapshot_ACU(current);
  if (base.feature !== feature) throw new Error('AGENT_REQUIREMENTS_CONFLICT: feature 不匹配');
  const replacement: AgentRequirementsReplacement_ACU = parseAgentRequirementsReplacement_ACU(rawReplacement, knownUserMessageIds);
  if (replacement.expectedRevision !== base.revision) throw new Error('AGENT_REQUIREMENTS_CONFLICT: revision 已变化');
  return {
    feature,
    revision: base.revision + 1,
    lastAppliedUserMessageId: replacement.appliedUserMessageId,
    requirements: replacement.requirements.map(item => ({ ...item, sourceRefs: [...item.sourceRefs] })),
  };
}

export function parseOptionalAgentRequirementSnapshot_ACU(value: unknown, feature: AgentFeature_ACU): AgentRequirementSnapshot_ACU | null {
  if (value === undefined) return null;
  const snapshot = parseAgentRequirementSnapshot_ACU(value);
  if (snapshot.feature !== feature) throw new Error('AGENT_REQUIREMENTS_CONFLICT: feature 不匹配');
  return snapshot;
}