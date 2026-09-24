import type { WorldSimulationLedger_ACU } from '../model';
import { relevanceGate_ACU } from '../relevance-gate';
import { buildInUseWorldCatalog_ACU, catalogArchiveHints_ACU, sliceModuleCatalog_ACU, summarizeCandidatePatches_ACU } from '../world-catalog';
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
  userRequirements?: unknown;
  originInstruction?: string;
  worldState: unknown;
  anchorMessage: unknown;
  anchorIdentity: unknown;
  worldStagePlan: unknown;
  worldChronicle: unknown;
  worldCandidates: unknown;
  worldCollisions: unknown;
  evidenceRegistry: WorldSimulationEvidenceRegistrySnapshot_ACU;
  projectionPreview: unknown;
  readBudgetText?: string;
  candidateView?: 'full' | 'summary';
  writableModules?: readonly string[];
}

function serialize_ACU(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

export function isWorldSimulationLedgerContext_ACU(value: unknown): value is WorldSimulationLedger_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as WorldSimulationLedger_ACU).seeds)
    && Array.isArray((value as WorldSimulationLedger_ACU).chronicle)
    && Array.isArray((value as WorldSimulationLedger_ACU).chronicleOverview)
    && !!(value as WorldSimulationLedger_ACU).clock;
}

function storyText_ACU(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createWorldSimulationPlaceholderResolvers_ACU(
  context: WorldSimulationPlaceholderContext_ACU,
): Record<WorldSimulationPromptPlaceholder_ACU, () => string> {
  return {
    '$WORLD_TASK': () => serialize_ACU(context.task),
    '$WORLD_HISTORY': () => serialize_ACU(context.history),
    '$WORLD_RUNTIME_CONTEXT': () => serialize_ACU(context.runtimeContext),
    '$WORLD_AGENT_CATALOG': () => serialize_ACU(context.agentCatalog),
    '$WORLD_TOOL_CATALOG': () => serialize_ACU({
      addresses: context.toolCatalog,
      hint: '目录中任一条目可通过调用 read 函数按地址调阅详细信息。参数 reads 是地址数组。',
    }),
    '$WORLD_EVIDENCE': () => serialize_ACU(context.evidence),
    '$WORLD_USER_GUIDANCE': () => serialize_ACU(context.userGuidance),
    '$WORLD_USER_REQUIREMENTS': () => serialize_ACU(context.userRequirements ?? context.userGuidance),
    '$WORLD_STATE': () => {
      if (isWorldSimulationLedgerContext_ACU(context.worldState)) {
        const ledger = context.worldState;
        const catalog = buildInUseWorldCatalog_ACU(ledger);
        const composerView = context.writableModules?.length === 1 && context.writableModules[0] === 'guidance';
        if (composerView) {
          return serialize_ACU({
            clock: ledger.clock,
            player: ledger.player,
            dimensions: ledger.dimensions,
            seeds: ledger.seeds,
            actors: ledger.actors,
            rumors: ledger.rumors,
            chronicle: ledger.chronicle,
            chronicleOverview: ledger.chronicleOverview,
            guidance: ledger.guidance,
            pendingFixes: ledger.pendingFixes,
            readHint: catalog.readHint,
          });
        }
        if (context.writableModules?.length) {
          const hints = Array.isArray(context.worldCandidates)
            ? catalogArchiveHints_ACU(context.worldCandidates as Array<{ patch: Record<string, unknown> }>, ledger.chronicleOverview)
            : [];
          return serialize_ACU({
            ...sliceModuleCatalog_ACU(catalog, ledger.chronicleOverview, context.writableModules),
            pendingFixes: ledger.pendingFixes.filter(item => context.writableModules!.includes(item.module)),
            archiveHints: hints,
          });
        }
        return serialize_ACU(catalog);
      }
      return serialize_ACU(context.worldState);
    },
    '$ANCHOR_MESSAGE': () => serialize_ACU(context.anchorMessage),
    '$ANCHOR_IDENTITY': () => serialize_ACU(context.anchorIdentity),
    '$WORLD_STAGE_PLAN': () => serialize_ACU(context.worldStagePlan),
    '$WORLD_CHRONICLE': () => {
      if (isWorldSimulationLedgerContext_ACU(context.worldState)) {
        return serialize_ACU(buildInUseWorldCatalog_ACU(context.worldState).chronicleHot);
      }
      return serialize_ACU(context.worldChronicle);
    },
    '$WORLD_CANDIDATES': () => {
      if (context.candidateView === 'full' || !Array.isArray(context.worldCandidates)) return serialize_ACU(context.worldCandidates);
      return serialize_ACU(summarizeCandidatePatches_ACU(context.worldCandidates as Array<{ candidateId: string; agentName: string; patch: Record<string, unknown>; summary: string }>));
    },
    '$WORLD_COLLISIONS': () => {
      if (isWorldSimulationLedgerContext_ACU(context.worldState)) {
        return serialize_ACU(relevanceGate_ACU(context.worldState, storyText_ACU(context.anchorMessage)));
      }
      return serialize_ACU(context.worldCollisions);
    },
    '$CURRENT_EVIDENCE_REGISTRY': () => serialize_ACU(context.evidenceRegistry),
    '$PROJECTION_PREVIEW': () => serialize_ACU(context.projectionPreview),
    '$READ_BUDGET': () => context.readBudgetText ?? '（实时阅读预算不可用）',
  };
}
