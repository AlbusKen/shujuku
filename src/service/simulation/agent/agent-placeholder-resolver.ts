import type { WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import type { WorldSimulationPromptPlaceholder_ACU } from './agent-defaults';

export interface WorldSimulationPlaceholderContext_ACU {
  task: unknown;
  history: unknown;
  runtimeContext: unknown;
  agentCatalog: unknown;
  toolCatalog: unknown;
  evidence: unknown;
  userGuidance: unknown;
  worldState: unknown;
  anchorMessage: unknown;
  anchorIdentity: unknown;
  worldStagePlan: unknown;
  worldChronicle: unknown;
  worldCandidates: unknown;
  evidenceRegistry: WorldSimulationEvidenceRegistrySnapshot_ACU;
  projectionPreview: unknown;
}

function serialize_ACU(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

export function createWorldSimulationPlaceholderResolvers_ACU(
  context: WorldSimulationPlaceholderContext_ACU,
): Record<WorldSimulationPromptPlaceholder_ACU, () => string> {
  return {
    '$WORLD_TASK': () => serialize_ACU(context.task),
    '$WORLD_HISTORY': () => serialize_ACU(context.history),
    '$WORLD_RUNTIME_CONTEXT': () => serialize_ACU(context.runtimeContext),
    '$WORLD_AGENT_CATALOG': () => serialize_ACU(context.agentCatalog),
    '$WORLD_TOOL_CATALOG': () => serialize_ACU(context.toolCatalog),
    '$WORLD_EVIDENCE': () => serialize_ACU(context.evidence),
    '$WORLD_USER_GUIDANCE': () => serialize_ACU(context.userGuidance),
    '$WORLD_STATE': () => serialize_ACU(context.worldState),
    '$ANCHOR_MESSAGE': () => serialize_ACU(context.anchorMessage),
    '$ANCHOR_IDENTITY': () => serialize_ACU(context.anchorIdentity),
    '$WORLD_STAGE_PLAN': () => serialize_ACU(context.worldStagePlan),
    '$WORLD_CHRONICLE': () => serialize_ACU(context.worldChronicle),
    '$WORLD_CANDIDATES': () => serialize_ACU(context.worldCandidates),
    '$CURRENT_EVIDENCE_REGISTRY': () => serialize_ACU(context.evidenceRegistry),
    '$PROJECTION_PREVIEW': () => serialize_ACU(context.projectionPreview),
  };
}
