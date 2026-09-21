import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import {
  WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU,
  formatWorldSimulationLedgerRequiredFields_ACU,
  type WorldCollisionReport_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationPendingFix_ACU,
  type WorldSimulationRunIdentity_ACU,
  type WorldSimulationSettings_ACU,
} from '../model';
import { applyWorldSimulationCandidatesDetailed_ACU } from '../simulation-transaction';
import { snapshotWorldSimulationEvidenceRegistry_ACU, type WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import type { WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { findWorldSimulationAgentDefinition_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import type {
  WorldSimulationCandidate_ACU,
  WorldSimulationCommitCandidate_ACU,
  WorldSimulationSubagentOutcome_ACU,
} from './agent-model';
import type { WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import type { WorldSimulationSubagentRuntime_ACU } from './agent-subagent-runtime';

export interface WorldSimulationWorkflowOpening_ACU {
  summary: string;
  focus: string;
  dispatchChronicler: boolean;
  skipModules: readonly string[];
}

export interface WorldSimulationWorkflowInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  opening: WorldSimulationWorkflowOpening_ACU;
  anchorMaterialsCommitted?: boolean;
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run'>;
}

export interface WorldSimulationWorkflowResult_ACU {
  outcome: 'commit' | 'no_change' | 'escalate';
  summary: string;
  outcomes: WorldSimulationSubagentOutcome_ACU[];
  pendingFixes: WorldSimulationPendingFix_ACU[];
  escalated: boolean;
  ledger: WorldSimulationLedger_ACU;
  commitCandidate?: WorldSimulationCommitCandidate_ACU;
}

const WORKFLOW_AGENTS_ACU = ['timekeeper', 'undercurrent-analyst', 'dramatis-keeper'] as const;
const PROJECTION_MODULES_ACU = ['clock', 'dimensions', 'seeds', 'actors', 'rumors', 'player'] as const;

function cloneLedger_ACU(ledger: WorldSimulationLedger_ACU): WorldSimulationLedger_ACU {
  return JSON.parse(JSON.stringify(ledger)) as WorldSimulationLedger_ACU;
}

function requireLedger_ACU(value: unknown): WorldSimulationLedger_ACU {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as WorldSimulationLedger_ACU).pendingFixes)) {
    throw new Error('WORLD_SIMULATION_WORKFLOW_LEDGER_REQUIRED');
  }
  return value as WorldSimulationLedger_ACU;
}

function anchorText_ACU(context: WorldSimulationPlaceholderContext_ACU): string {
  return typeof context.anchorMessage === 'string' ? context.anchorMessage : '';
}

function collisionReport_ACU(context: WorldSimulationPlaceholderContext_ACU): WorldCollisionReport_ACU | undefined {
  const value = context.worldCollisions;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('playerContact' in value)) return undefined;
  return value as WorldCollisionReport_ACU;
}

export function worldSimulationProjectionFingerprint_ACU(ledger: WorldSimulationLedger_ACU): string {
  return sha256HexSync_ACU(JSON.stringify({
    clock: ledger.clock,
    dimensions: ledger.dimensions,
    seeds: ledger.seeds,
    actors: ledger.actors,
    rumors: ledger.rumors,
    player: ledger.player,
  }));
}

function authorizedRefs_ACU(registry: WorldSimulationEvidenceRegistry_ACU): Set<string> {
  return new Set(snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries.flatMap(entry => entry.evidenceRef ? [entry.evidenceRef] : []));
}

function agentSkipped_ACU(agentName: WorldSimulationAgentName_ACU, skipModules: ReadonlySet<string>): boolean {
  const modules = findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? [];
  return modules.length > 0 && modules.every(module => skipModules.has(module));
}

function fixesForAgent_ACU(ledger: WorldSimulationLedger_ACU, agentName: string): WorldSimulationPendingFix_ACU[] {
  const modules = new Set(findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? []);
  return ledger.pendingFixes.filter(item => modules.has(item.module));
}

function formatFixes_ACU(fixes: readonly WorldSimulationPendingFix_ACU[]): string {
  if (!fixes.length) return '无';
  return fixes.map(item => `${item.module} 第 ${item.attempts} 次：${item.violations.map(violation => `${violation.path}: ${violation.message}`).join('；') || item.lastError}`).join(' | ');
}

function instructionFor_ACU(agentName: string, focus: string, ledger: WorldSimulationLedger_ACU, repair: boolean): string {
  const modules = findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? [];
  const fixes = repair
    ? fixesForAgent_ACU(ledger, agentName).filter(item => item.attempts < WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU)
    : fixesForAgent_ACU(ledger, agentName);
  const lines = [
    repair ? '这是独立预算的自动修复派工。只提交违规模块的增量 patch，不要重写无关模块。' : `本轮焦点：${focus}`,
    `只维护这些模块：${modules.join(', ') || '无'}。正文里已经发生或已经变化的事实，直接 upsert 到自己的模块。`,
    `本模块待修复：${formatFixes_ACU(fixes)}`,
    formatWorldSimulationLedgerRequiredFields_ACU(),
  ];
  return lines.join('\n');
}

function failedOutcome_ACU(agentName: string, error: unknown): WorldSimulationSubagentOutcome_ACU {
  return {
    agentName,
    status: 'failed',
    summary: error instanceof Error ? error.message : String(error),
    evidenceRefs: [],
    uncertainties: [],
    reasonCode: 'WORLD_SIMULATION_SUBAGENT_FAILED',
  };
}

function needsEscalation_ACU(ledger: WorldSimulationLedger_ACU, autoFixEnabled: boolean): boolean {
  if (!ledger.pendingFixes.length) return false;
  if (!autoFixEnabled) return true;
  return ledger.pendingFixes.some(item => item.attempts >= WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU);
}

function seedsClosedThisRound_ACU(before: WorldSimulationLedger_ACU, after: WorldSimulationLedger_ACU): boolean {
  const previous = new Map(before.seeds.map(seed => [seed.id, seed.status]));
  return after.seeds.some(seed => (seed.status === 'resolved' || seed.status === 'retired') && previous.get(seed.id) !== seed.status);
}

function applySafely_ACU(
  ledger: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorized: ReadonlySet<string>,
  settings: WorldSimulationSettings_ACU,
  anchorMessage: string,
): { ledger: WorldSimulationLedger_ACU; accepted: WorldSimulationCandidate_ACU[]; rejected: WorldSimulationSubagentOutcome_ACU[] } {
  if (!candidates.length) return { ledger, accepted: [], rejected: [] };
  const rejected: WorldSimulationSubagentOutcome_ACU[] = [];
  const tryApply = (base: WorldSimulationLedger_ACU, batch: readonly WorldSimulationCandidate_ACU[]): { ledger: WorldSimulationLedger_ACU } | { error: unknown } => {
    try {
      return { ledger: applyWorldSimulationCandidatesDetailed_ACU(base, batch, authorized, settings, { anchorMessage }).ledger };
    } catch (error) {
      return { error };
    }
  };
  const whole = tryApply(ledger, candidates);
  if ('ledger' in whole) return { ledger: whole.ledger, accepted: [...candidates], rejected };
  if (candidates.length === 1) {
    rejected.push(failedOutcome_ACU(candidates[0].agentName, whole.error));
    return { ledger, accepted: [], rejected };
  }
  const accepted: WorldSimulationCandidate_ACU[] = [];
  for (const candidate of candidates) {
    const single = tryApply(ledger, [candidate]);
    if ('ledger' in single) accepted.push(candidate);
    else rejected.push(failedOutcome_ACU(candidate.agentName, single.error));
  }
  if (!accepted.length) return { ledger, accepted, rejected };
  const combined = tryApply(ledger, accepted);
  if ('ledger' in combined) return { ledger: combined.ledger, accepted, rejected };
  let rolling = ledger;
  const kept: WorldSimulationCandidate_ACU[] = [];
  for (const candidate of accepted) {
    const single = tryApply(rolling, [candidate]);
    if ('ledger' in single) {
      rolling = single.ledger;
      kept.push(candidate);
    } else {
      rejected.push(failedOutcome_ACU(candidate.agentName, single.error));
    }
  }
  return { ledger: rolling, accepted: kept, rejected };
}

export async function runWorldSimulationGuidanceComposer_ACU(input: {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run'>;
  ledger: WorldSimulationLedger_ACU;
  focus: string;
  candidateSeq: number;
}): Promise<WorldSimulationSubagentOutcome_ACU> {
  const agentName = 'guidance-composer' as const;
  try {
    return await input.subagents.run({
      delegation: {
        agentName,
        instruction: instructionFor_ACU(agentName, input.focus, input.ledger, false),
        reads: ['ledger:current', 'anchor:message', 'player:current'],
      },
      settings: input.settings,
      promptContext: { ...input.promptContext, worldState: input.ledger },
      registry: input.registry,
      tools: input.tools,
      runId: input.identity.runId,
      candidateSeq: input.candidateSeq,
    });
  } catch (error) {
    return failedOutcome_ACU(agentName, error);
  }
}

export async function runWorldSimulationWorkflow_ACU(input: WorldSimulationWorkflowInput_ACU): Promise<WorldSimulationWorkflowResult_ACU> {
  const base = cloneLedger_ACU(requireLedger_ACU(input.promptContext.worldState));
  const skipModules = new Set(input.opening.skipModules);
  const outcomes: WorldSimulationSubagentOutcome_ACU[] = [];
  const seq = new Map<string, number>();
  const anchorMessage = anchorText_ACU(input.promptContext);
  const authorized = authorizedRefs_ACU(input.registry);
  const nextSeq = (agentName: string): number => {
    const value = (seq.get(agentName) ?? 0) + 1;
    seq.set(agentName, value);
    return value;
  };
  const runAgent = async (agentName: WorldSimulationAgentName_ACU, repair: boolean, ledger: WorldSimulationLedger_ACU): Promise<WorldSimulationSubagentOutcome_ACU> => {
    try {
      return await input.subagents.run({
        delegation: {
          agentName,
          instruction: instructionFor_ACU(agentName, input.opening.focus, ledger, repair),
          reads: ['ledger:current', 'anchor:message'],
        },
        settings: input.settings,
        promptContext: { ...input.promptContext, worldState: ledger },
        registry: input.registry,
        tools: input.tools,
        runId: input.identity.runId,
        candidateSeq: nextSeq(agentName),
      });
    } catch (error) {
      return failedOutcome_ACU(agentName, error);
    }
  };

  if (input.anchorMaterialsCommitted && base.pendingFixes.length === 0) {
    return {
      outcome: 'no_change',
      summary: '正文指纹未变且没有待修复项，整轮跳过',
      outcomes,
      pendingFixes: [],
      escalated: false,
      ledger: base,
    };
  }

  const projectionBefore = worldSimulationProjectionFingerprint_ACU(base);
  if (!agentSkipped_ACU('timekeeper', skipModules)) outcomes.push(await runAgent('timekeeper', false, base));
  const parallel = (['undercurrent-analyst', 'dramatis-keeper'] as const).filter(name => !agentSkipped_ACU(name, skipModules));
  outcomes.push(...await Promise.all(parallel.map(name => runAgent(name, false, base))));

  let ledger = base;
  let accepted: WorldSimulationCandidate_ACU[] = [];
  const primaryCandidates = outcomes.flatMap(item => item.candidate ? [item.candidate] : []);
  const primary = applySafely_ACU(ledger, primaryCandidates, authorized, input.settings, anchorMessage);
  ledger = primary.ledger;
  accepted = primary.accepted;
  outcomes.push(...primary.rejected);

  const repairableAgents = [...new Set(ledger.pendingFixes
    .filter(item => item.attempts < WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU)
    .map(item => item.agentName))]
    .filter((name): name is WorldSimulationAgentName_ACU => !!findWorldSimulationAgentDefinition_ACU(name));
  if (input.settings.workflow.autoFixEnabled && repairableAgents.length) {
    const repairs = await Promise.all(repairableAgents.map(name => runAgent(name, true, ledger)));
    outcomes.push(...repairs);
    const repaired = applySafely_ACU(ledger, repairs.flatMap(item => item.candidate ? [item.candidate] : []), authorized, input.settings, anchorMessage);
    ledger = repaired.ledger;
    accepted = [...accepted, ...repaired.accepted];
    outcomes.push(...repaired.rejected);
  }

  const shouldChronicle = !agentSkipped_ACU('chronicler', skipModules) && (
    input.opening.dispatchChronicler
    || ledger.chronicle.length >= input.settings.workflow.chroniclerHotThreshold
    || seedsClosedThisRound_ACU(base, ledger)
  );
  if (shouldChronicle) {
    const chronicler = await runAgent('chronicler', false, ledger);
    outcomes.push(chronicler);
    if (chronicler.candidate) {
      const archived = applySafely_ACU(ledger, [chronicler.candidate], authorized, input.settings, anchorMessage);
      ledger = archived.ledger;
      accepted = [...accepted, ...archived.accepted];
      outcomes.push(...archived.rejected);
    }
  }

  const projectionChanged = worldSimulationProjectionFingerprint_ACU(ledger) !== projectionBefore;
  const substantive = accepted.some(item => Object.keys(item.patch).some(key => (PROJECTION_MODULES_ACU as readonly string[]).includes(key)));
  if (substantive && projectionChanged && !agentSkipped_ACU('guidance-composer', skipModules)) {
    const composer = await runWorldSimulationGuidanceComposer_ACU({
      identity: input.identity,
      settings: input.settings,
      promptContext: input.promptContext,
      registry: input.registry,
      tools: input.tools,
      subagents: input.subagents,
      ledger,
      focus: input.opening.focus,
      candidateSeq: nextSeq('guidance-composer'),
    });
    outcomes.push(composer);
    if (composer.candidate) {
      const projected = applySafely_ACU(ledger, [composer.candidate], authorized, input.settings, anchorMessage);
      ledger = projected.ledger;
      accepted = [...accepted, ...projected.accepted];
      outcomes.push(...projected.rejected);
    }
  }

  const escalated = needsEscalation_ACU(ledger, input.settings.workflow.autoFixEnabled);
  const summary = escalated
    ? `工作流完成，仍有待修复模块需要主会话处理：${ledger.pendingFixes.map(item => `${item.module}(${item.attempts})`).join('、')}`
    : accepted.length
      ? `固定工作流已处理 ${accepted.length} 个候选`
      : '固定工作流没有产生账本变更';
  if (!accepted.length) {
    return {
      outcome: escalated ? 'escalate' : 'no_change',
      summary,
      outcomes,
      pendingFixes: ledger.pendingFixes,
      escalated,
      ledger,
    };
  }
  const evidenceRefs = [...new Set(accepted.flatMap(item => item.evidenceRefs))];
  return {
    outcome: 'commit',
    summary,
    outcomes,
    pendingFixes: ledger.pendingFixes,
    escalated,
    ledger,
    commitCandidate: {
      runId: input.identity.runId,
      taskId: input.identity.taskId,
      stageId: input.identity.stageId,
      stageRevision: input.identity.stageRevision,
      baseLedgerRevision: input.identity.baseLedgerRevision,
      summary: input.opening.summary || summary,
      acceptedCandidates: accepted,
      evidenceRefs,
      collisionReport: collisionReport_ACU(input.promptContext),
    },
  };
}

export const WORLD_SIMULATION_WORKFLOW_AGENT_ORDER_ACU = WORKFLOW_AGENTS_ACU;
