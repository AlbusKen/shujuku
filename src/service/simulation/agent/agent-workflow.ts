import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import {
  WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU,
  formatWorldSimulationLedgerRequiredFields_ACU,
  type WorldCollisionReport_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationLedgerModule_ACU,
  type WorldSimulationMaterialCompletionRecord_ACU,
  type WorldSimulationPendingFix_ACU,
  type WorldSimulationPendingAnchor_ACU,
  type WorldSimulationRunIdentity_ACU,
  type WorldSimulationSettings_ACU,
} from '../model';
import { applyWorldSimulationCandidatesDetailedViaSql_ACU } from '../simulation-transaction';
import { snapshotWorldSimulationEvidenceRegistry_ACU, type WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import type { WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { findWorldSimulationAgentDefinition_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import type {
  WorldSimulationCandidate_ACU,
  WorldSimulationCommitCandidate_ACU,
  WorldSimulationSubagentIssue_ACU,
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
  /** 显式补足时的程序级写集；省略表示正常固定工作流。 */
  targetModules?: readonly WorldSimulationLedgerModule_ACU[];
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
const COMPLETE_STATES_ACU = new Set(['complete_changed', 'complete_no_change']);

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

function ledgerModule_ACU(key: string): WorldSimulationLedgerModule_ACU | null {
  if (key === 'chronicleArchive') return 'chronicle';
  return ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player'].includes(key)
    ? key as WorldSimulationLedgerModule_ACU
    : null;
}

function modulesForAgent_ACU(agentName: string): WorldSimulationLedgerModule_ACU[] {
  return [...(findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? [])];
}

function candidateModules_ACU(candidate: WorldSimulationCandidate_ACU | undefined): WorldSimulationLedgerModule_ACU[] {
  if (!candidate) return [];
  return [...new Set(Object.keys(candidate.patch).map(ledgerModule_ACU).filter((module): module is WorldSimulationLedgerModule_ACU => module !== null))];
}

function pendingAnchor_ACU(identity: WorldSimulationRunIdentity_ACU): WorldSimulationPendingAnchor_ACU {
  return {
    messageKey: identity.anchorMessageKey,
    swipeId: identity.anchorSwipeId,
    contentDigest: identity.anchorContentDigest,
    baseLedgerRevision: identity.baseLedgerRevision,
  };
}

function acceptedKeysForModule_ACU(keys: readonly string[] | undefined, module: WorldSimulationLedgerModule_ACU): string[] {
  return [...new Set((keys ?? []).filter(key => key.startsWith(`${module}:`)))];
}

function fixesForAgent_ACU(ledger: WorldSimulationLedger_ACU, agentName: string): WorldSimulationPendingFix_ACU[] {
  const modules = new Set(findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? []);
  return ledger.pendingFixes.filter(item => modules.has(item.module));
}

function formatFixes_ACU(fixes: readonly WorldSimulationPendingFix_ACU[]): string {
  if (!fixes.length) return '无';
  return fixes.map(item => `${item.module} 第 ${item.attempts} 次：${item.violations.map(violation => `${violation.path}: ${violation.message}`).join('；') || item.lastError}`).join(' | ');
}

function instructionFor_ACU(
  agentName: string,
  focus: string,
  ledger: WorldSimulationLedger_ACU,
  repair: boolean,
  targetModules?: readonly WorldSimulationLedgerModule_ACU[],
): string {
  const modules = targetModules ?? findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? [];
  const fixes = repair
    ? fixesForAgent_ACU(ledger, agentName).filter(item => item.attempts < WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU && modules.includes(item.module))
    : fixesForAgent_ACU(ledger, agentName);
  const lines = [
    repair ? '这是独立预算的自动修复派工。只提交违规模块的增量 patch，不要重写无关模块。' : `本轮焦点：${focus}`,
    `只维护这些模块：${modules.join(', ') || '无'}。正文里已经发生或已经变化的事实，直接 upsert 到自己的模块。`,
    `本模块待修复：${formatFixes_ACU(fixes)}`,
    formatWorldSimulationLedgerRequiredFields_ACU(),
  ];
  return lines.join('\n');
}

function failedOutcome_ACU(
  agentName: string,
  error: unknown,
  source: WorldSimulationSubagentIssue_ACU['source'] = 'invoke_failed',
  targetModules?: readonly WorldSimulationLedgerModule_ACU[],
): WorldSimulationSubagentOutcome_ACU {
  const modules = targetModules?.length ? [...targetModules] : modulesForAgent_ACU(agentName);
  const message = error instanceof Error ? error.message : String(error);
  return {
    completion: 'failed',
    moduleCompletion: Object.fromEntries(modules.map(module => [module, 'failed'])),
    unresolvedIssues: modules.map(module => ({ module, source, path: `$.patch.${module}`, message })),
    acceptedKeys: [],
    agentName,
    status: 'failed',
    summary: message,
    evidenceRefs: [],
    uncertainties: [],
    reasonCode: 'WORLD_SIMULATION_SUBAGENT_FAILED',
  };
}

function restrictOutcome_ACU(
  outcome: WorldSimulationSubagentOutcome_ACU,
  targetModules: readonly WorldSimulationLedgerModule_ACU[],
): WorldSimulationSubagentOutcome_ACU {
  const allowed = new Set(targetModules);
  const patch = outcome.candidate
    ? Object.fromEntries(Object.entries(outcome.candidate.patch).filter(([key]) => {
      const module = ledgerModule_ACU(key);
      return module !== null && allowed.has(module);
    }))
    : null;
  const candidate = outcome.candidate && patch && Object.keys(patch).length
    ? { ...outcome.candidate, patch, writableModules: [...targetModules] }
    : undefined;
  const touched = new Set(candidateModules_ACU(candidate));
  const issueModules = new Set((outcome.unresolvedIssues ?? []).map(issue => issue.module));
  const sourceCompletion = outcome.moduleCompletion ?? Object.fromEntries(targetModules.map(module => [
    module,
    issueModules.has(module)
      ? (touched.has(module) ? 'partial' : 'failed')
      : outcome.status === 'no_change'
        ? 'complete_no_change'
        : outcome.status === 'candidate'
          ? (touched.has(module) ? 'complete_changed' : 'complete_no_change')
          : 'failed',
  ]));
  return {
    ...outcome,
    ...(candidate ? { candidate } : { candidate: undefined }),
    moduleCompletion: Object.fromEntries(Object.entries(sourceCompletion).filter(([module]) => allowed.has(module as WorldSimulationLedgerModule_ACU))),
    unresolvedIssues: (outcome.unresolvedIssues ?? []).filter(issue => allowed.has(issue.module)),
    acceptedKeys: (outcome.acceptedKeys ?? []).filter(key => targetModules.some(module => key.startsWith(`${module}:`))),
  };
}

function clearCompletedPending_ACU(
  ledger: WorldSimulationLedger_ACU,
  outcomes: readonly WorldSimulationSubagentOutcome_ACU[],
): WorldSimulationLedger_ACU {
  const completed = new Set<WorldSimulationLedgerModule_ACU>();
  for (const outcome of outcomes) {
    const fallbackModules = modulesForAgent_ACU(outcome.agentName);
    const touched = new Set(candidateModules_ACU(outcome.candidate));
    const moduleCompletion = outcome.moduleCompletion ?? Object.fromEntries(fallbackModules.map(module => [
      module,
      outcome.status === 'no_change' ? 'complete_no_change'
        : outcome.status === 'candidate' && candidateModules_ACU(outcome.candidate).includes(module) ? 'complete_changed'
          : outcome.status === 'candidate' ? 'complete_no_change' : 'failed',
    ]));
    for (const [module, state] of Object.entries(moduleCompletion)) {
      const ledgerModule = module as WorldSimulationLedgerModule_ACU;
      if (COMPLETE_STATES_ACU.has(String(state)) && !touched.has(ledgerModule)) completed.add(ledgerModule);
    }
  }
  if (!completed.size) return ledger;
  return { ...ledger, pendingFixes: ledger.pendingFixes.filter(item => !completed.has(item.module)) };
}

function recordWorkflowIssues_ACU(
  ledger: WorldSimulationLedger_ACU,
  outcomes: readonly WorldSimulationSubagentOutcome_ACU[],
  identity: WorldSimulationRunIdentity_ACU,
): WorldSimulationLedger_ACU {
  const pending = ledger.pendingFixes.map(item => ({
    ...item,
    violations: item.violations.map(violation => ({ ...violation })),
    acceptedKeys: [...item.acceptedKeys],
    anchor: item.anchor ? { ...item.anchor } : null,
  }));
  const anchor = pendingAnchor_ACU(identity);
  const now = Date.now();
  for (const outcome of outcomes) {
    const issues = outcome.unresolvedIssues ?? [];
    const grouped = new Map<WorldSimulationLedgerModule_ACU, WorldSimulationSubagentIssue_ACU[]>();
    for (const issue of issues) {
      const list = grouped.get(issue.module) ?? [];
      list.push(issue);
      grouped.set(issue.module, list);
    }
    for (const [module, moduleIssues] of grouped) {
      const index = pending.findIndex(item => item.module === module);
      const previous = index >= 0 ? pending[index] : null;
      const acceptedKeys = acceptedKeysForModule_ACU(outcome.acceptedKeys, module);
      const next: WorldSimulationPendingFix_ACU = {
        module,
        candidateId: outcome.candidate?.candidateId || previous?.candidateId || `${identity.runId}:${outcome.agentName}:pending:${module}`,
        agentName: outcome.agentName || previous?.agentName || '',
        violations: moduleIssues.map(issue => ({ path: issue.path, message: issue.message })),
        attempts: (previous?.attempts ?? 0) + 1,
        firstFailedAtDay: previous?.firstFailedAtDay ?? ledger.clock.day,
        lastError: moduleIssues.map(issue => issue.message).join('；'),
        source: moduleIssues[0]?.source ?? 'protocol_failed',
        completion: acceptedKeys.length ? 'partial' : 'failed',
        acceptedKeys: [...new Set([...(previous?.acceptedKeys ?? []), ...acceptedKeys])],
        anchor: previous?.anchor ?? anchor,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      if (index >= 0) pending[index] = next;
      else pending.push(next);
    }
  }
  return {
    ...ledger,
    pendingFixes: pending.map(item => ({ ...item, anchor: item.anchor ?? anchor })),
  };
}

function completionRecord_ACU(
  base: WorldSimulationLedger_ACU,
  ledger: WorldSimulationLedger_ACU,
  outcomes: readonly WorldSimulationSubagentOutcome_ACU[],
  expectedModules: readonly WorldSimulationLedgerModule_ACU[],
  identity: WorldSimulationRunIdentity_ACU,
  reuseBase: boolean,
): WorldSimulationMaterialCompletionRecord_ACU {
  const modules: WorldSimulationMaterialCompletionRecord_ACU['modules'] = reuseBase
    ? { ...base.materialCompletion.modules }
    : {};
  for (const outcome of outcomes) {
    const writable = modulesForAgent_ACU(outcome.agentName);
    const touched = new Set(candidateModules_ACU(outcome.candidate));
    const states = outcome.moduleCompletion ?? Object.fromEntries(writable.map(module => [
      module,
      outcome.status === 'no_change' ? 'complete_no_change'
        : outcome.status === 'candidate' ? (touched.has(module) ? 'complete_changed' : 'complete_no_change')
          : 'failed',
    ]));
    Object.assign(modules, states);
  }
  for (const fix of ledger.pendingFixes) modules[fix.module] = fix.completion;
  const expected = [...new Set(expectedModules)];
  const states = expected.map(module => modules[module] ?? 'failed');
  const hasIncomplete = states.some(state => state === 'partial' || state === 'failed' || state === 'legacy_unknown');
  const hasComplete = states.some(state => state === 'complete_changed' || state === 'complete_no_change');
  const state = hasIncomplete
    ? (hasComplete ? 'partial' : 'failed')
    : states.some(item => item === 'complete_changed') ? 'complete_changed' : 'complete_no_change';
  return { state, expectedModules: expected, modules, sourceRunId: identity.runId, updatedAt: Date.now() };
}

function anchorMaterialsComplete_ACU(ledger: WorldSimulationLedger_ACU): boolean {
  const expected = ledger.materialCompletion.expectedModules;
  return expected.length > 0
    && ledger.pendingFixes.length === 0
    && expected.every(module => COMPLETE_STATES_ACU.has(String(ledger.materialCompletion.modules[module])));
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

async function applySafely_ACU(
  ledger: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorized: ReadonlySet<string>,
  settings: WorldSimulationSettings_ACU,
  anchorMessage: string,
): Promise<{ ledger: WorldSimulationLedger_ACU; accepted: WorldSimulationCandidate_ACU[]; rejected: WorldSimulationSubagentOutcome_ACU[] }> {
  if (!candidates.length) return { ledger, accepted: [], rejected: [] };
  const rejected: WorldSimulationSubagentOutcome_ACU[] = [];
  const tryApply = async (base: WorldSimulationLedger_ACU, batch: readonly WorldSimulationCandidate_ACU[]): Promise<{ ledger: WorldSimulationLedger_ACU } | { error: unknown }> => {
    try {
      return { ledger: (await applyWorldSimulationCandidatesDetailedViaSql_ACU(base, batch, authorized, settings, { anchorMessage })).ledger };
    } catch (error) {
      return { error };
    }
  };
  const whole = await tryApply(ledger, candidates);
  if ('ledger' in whole) return { ledger: whole.ledger, accepted: [...candidates], rejected };
  if (candidates.length === 1) {
    rejected.push(failedOutcome_ACU(candidates[0].agentName, whole.error, 'transaction_rejected', candidateModules_ACU(candidates[0])));
    return { ledger, accepted: [], rejected };
  }
  const accepted: WorldSimulationCandidate_ACU[] = [];
  for (const candidate of candidates) {
    const single = await tryApply(ledger, [candidate]);
    if ('ledger' in single) accepted.push(candidate);
    else rejected.push(failedOutcome_ACU(candidate.agentName, single.error, 'transaction_rejected', candidateModules_ACU(candidate)));
  }
  if (!accepted.length) return { ledger, accepted, rejected };
  const combined = await tryApply(ledger, accepted);
  if ('ledger' in combined) return { ledger: combined.ledger, accepted, rejected };
  let rolling = ledger;
  const kept: WorldSimulationCandidate_ACU[] = [];
  for (const candidate of accepted) {
    const single = await tryApply(rolling, [candidate]);
    if ('ledger' in single) {
      rolling = single.ledger;
      kept.push(candidate);
    } else {
      rejected.push(failedOutcome_ACU(candidate.agentName, single.error, 'transaction_rejected', candidateModules_ACU(candidate)));
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
    return failedOutcome_ACU(agentName, error, 'invoke_failed', ['guidance']);
  }
}

export async function runWorldSimulationWorkflow_ACU(input: WorldSimulationWorkflowInput_ACU): Promise<WorldSimulationWorkflowResult_ACU> {
  const base = cloneLedger_ACU(requireLedger_ACU(input.promptContext.worldState));
  const skipModules = new Set(input.opening.skipModules);
  const requestedTargets = input.targetModules ? new Set(input.targetModules) : null;
  const expectedModules = new Set<WorldSimulationLedgerModule_ACU>();
  const outcomes: WorldSimulationSubagentOutcome_ACU[] = [];
  const seq = new Map<string, number>();
  const anchorMessage = anchorText_ACU(input.promptContext);
  const authorized = authorizedRefs_ACU(input.registry);
  const nextSeq = (agentName: string): number => {
    const value = (seq.get(agentName) ?? 0) + 1;
    seq.set(agentName, value);
    return value;
  };
  const runAgent = async (
    agentName: WorldSimulationAgentName_ACU,
    repair: boolean,
    ledger: WorldSimulationLedger_ACU,
    targetModules = modulesForAgent_ACU(agentName).filter(module => !skipModules.has(module)),
  ): Promise<WorldSimulationSubagentOutcome_ACU> => {
    try {
      const outcome = await input.subagents.run({
        delegation: {
          agentName,
          instruction: instructionFor_ACU(agentName, input.opening.focus, ledger, repair, targetModules),
          reads: ['ledger:current', 'anchor:message'],
        },
        settings: input.settings,
        promptContext: { ...input.promptContext, worldState: ledger },
        registry: input.registry,
        tools: input.tools,
        runId: input.identity.runId,
        candidateSeq: nextSeq(agentName),
      });
      return restrictOutcome_ACU(outcome, targetModules);
    } catch (error) {
      return failedOutcome_ACU(agentName, error, 'invoke_failed', targetModules);
    }
  };

  if (input.anchorMaterialsCommitted && anchorMaterialsComplete_ACU(base)) {
    return {
      outcome: 'no_change',
      summary: '正文指纹未变且所有预期资料模块均已完成，整轮跳过',
      outcomes,
      pendingFixes: [],
      escalated: false,
      ledger: base,
    };
  }

  const projectionBefore = worldSimulationProjectionFingerprint_ACU(base);
  const primaryTargets = new Map<WorldSimulationAgentName_ACU, WorldSimulationLedgerModule_ACU[]>();
  for (const agentName of WORKFLOW_AGENTS_ACU) {
    const targets = modulesForAgent_ACU(agentName).filter(module =>
      !skipModules.has(module) && (!requestedTargets || requestedTargets.has(module)),
    );
    if (!targets.length) continue;
    primaryTargets.set(agentName, targets);
    targets.forEach(module => expectedModules.add(module));
  }
  const timekeeperTargets = primaryTargets.get('timekeeper');
  if (timekeeperTargets?.length) outcomes.push(await runAgent('timekeeper', false, base, timekeeperTargets));
  const parallel = (['undercurrent-analyst', 'dramatis-keeper'] as const).filter(name => primaryTargets.has(name));
  outcomes.push(...await Promise.all(parallel.map(name => runAgent(name, false, base, primaryTargets.get(name)!))));

  const primaryOutcomes = [...outcomes];
  let ledger = base;
  let accepted: WorldSimulationCandidate_ACU[] = [];
  const primaryCandidates = primaryOutcomes.flatMap(item => item.candidate ? [item.candidate] : []);
  const primary = await applySafely_ACU(ledger, primaryCandidates, authorized, input.settings, anchorMessage);
  ledger = primary.ledger;
  accepted = primary.accepted;
  outcomes.push(...primary.rejected);
  ledger = recordWorkflowIssues_ACU(ledger, [...primaryOutcomes, ...primary.rejected], input.identity);

  const repairTargets = new Map<WorldSimulationAgentName_ACU, WorldSimulationLedgerModule_ACU[]>();
  for (const fix of ledger.pendingFixes) {
    if (requestedTargets && !requestedTargets.has(fix.module)) continue;
    if (fix.attempts >= WORLD_SIMULATION_AUTO_FIX_MAX_ATTEMPTS_ACU) continue;
    const definition = findWorldSimulationAgentDefinition_ACU(fix.agentName);
    if (!definition || !definition.writableModules.includes(fix.module)) continue;
    const modules = repairTargets.get(definition.name) ?? [];
    if (!modules.includes(fix.module)) modules.push(fix.module);
    repairTargets.set(definition.name, modules);
  }
  if (input.settings.workflow.autoFixEnabled && repairTargets.size) {
    const repairs = await Promise.all([...repairTargets].map(([name, targets]) => runAgent(name, true, ledger, targets)));
    outcomes.push(...repairs);
    ledger = clearCompletedPending_ACU(ledger, repairs);
    const repaired = await applySafely_ACU(ledger, repairs.flatMap(item => item.candidate ? [item.candidate] : []), authorized, input.settings, anchorMessage);
    ledger = repaired.ledger;
    accepted = [...accepted, ...repaired.accepted];
    outcomes.push(...repaired.rejected);
    ledger = recordWorkflowIssues_ACU(ledger, [...repairs, ...repaired.rejected], input.identity);
  }

  const shouldChronicle = (!requestedTargets || requestedTargets.has('chronicle'))
    && !agentSkipped_ACU('chronicler', skipModules) && (
    input.opening.dispatchChronicler
    || ledger.chronicle.length >= input.settings.workflow.chroniclerHotThreshold
    || seedsClosedThisRound_ACU(base, ledger)
  );
  if (shouldChronicle) {
    expectedModules.add('chronicle');
    const chronicler = await runAgent('chronicler', false, ledger, ['chronicle']);
    outcomes.push(chronicler);
    ledger = clearCompletedPending_ACU(ledger, [chronicler]);
    if (chronicler.candidate) {
      const archived = await applySafely_ACU(ledger, [chronicler.candidate], authorized, input.settings, anchorMessage);
      ledger = archived.ledger;
      accepted = [...accepted, ...archived.accepted];
      outcomes.push(...archived.rejected);
      ledger = recordWorkflowIssues_ACU(ledger, [chronicler, ...archived.rejected], input.identity);
    } else {
      ledger = recordWorkflowIssues_ACU(ledger, [chronicler], input.identity);
    }
  }

  const projectionChanged = worldSimulationProjectionFingerprint_ACU(ledger) !== projectionBefore;
  const substantive = accepted.some(item => Object.keys(item.patch).some(key => (PROJECTION_MODULES_ACU as readonly string[]).includes(key)));
  if (substantive && projectionChanged && (!requestedTargets || requestedTargets.has('guidance'))
    && !agentSkipped_ACU('guidance-composer', skipModules)) {
    expectedModules.add('guidance');
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
    ledger = clearCompletedPending_ACU(ledger, [composer]);
    if (composer.candidate) {
      const projected = await applySafely_ACU(ledger, [composer.candidate], authorized, input.settings, anchorMessage);
      ledger = projected.ledger;
      accepted = [...accepted, ...projected.accepted];
      outcomes.push(...projected.rejected);
      ledger = recordWorkflowIssues_ACU(ledger, [composer, ...projected.rejected], input.identity);
    } else {
      ledger = recordWorkflowIssues_ACU(ledger, [composer], input.identity);
    }
  }

  ledger = recordWorkflowIssues_ACU(ledger, [], input.identity);
  const materialCompletion = completionRecord_ACU(
    base, ledger, outcomes, [...expectedModules], input.identity, input.anchorMaterialsCommitted === true,
  );
  ledger = { ...ledger, materialCompletion };
  const escalated = needsEscalation_ACU(ledger, input.settings.workflow.autoFixEnabled);
  const summary = escalated
    ? `工作流完成，仍有待修复模块需要主会话处理：${ledger.pendingFixes.map(item => `${item.module}(${item.attempts})`).join('、')}`
    : accepted.length
      ? `固定工作流已处理 ${accepted.length} 个候选`
      : '固定工作流没有产生账本变更';
  const evidenceRefs = [...new Set(accepted.flatMap(item => item.evidenceRefs))];
  return {
    outcome: accepted.length ? 'commit' : escalated ? 'escalate' : 'no_change',
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
      pendingFixes: ledger.pendingFixes,
      materialCompletion,
      collisionReport: collisionReport_ACU(input.promptContext),
    },
  };
}

export const WORLD_SIMULATION_WORKFLOW_AGENT_ORDER_ACU = WORKFLOW_AGENTS_ACU;
