import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import {
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
import type { WorldSimulationRunWriteState_ACU } from '../simulation-run-write-state';
import { snapshotWorldSimulationEvidenceRegistry_ACU, type WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import type { WorldSimulationReadRoundState_ACU, WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { buildWorldSimulationProjection_ACU } from '../simulation-projection';
import { assertCollisionFulfillment_ACU } from '../world-dynamics';
import { findWorldSimulationAgentDefinition_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import type {
  WorldSimulationCandidate_ACU,
  WorldSimulationCommitCandidate_ACU,
  WorldSimulationSubagentIssue_ACU,
  WorldSimulationSubagentOutcome_ACU,
} from './agent-model';
import type { WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { inferWorldSimulationElapsedDays_ACU, type WorldSimulationSubagentRuntime_ACU } from './agent-subagent-runtime';
import type { WorldSimulationFixedWorldbook_ACU } from './agent-shared-materials';
import { logWorldSimulationSession_ACU, updateWorldSimulationSession_ACU } from './agent-session-log';

export interface WorldSimulationWorkflowOpening_ACU {
  summary: string;
  focus: string;
  dispatchChronicler: boolean;
  skipModules: readonly string[];
}

export interface WorldSimulationWorkflowInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  toolMode?: import('../../ai/agent-tool-mode').AgentToolMode_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  roundId?: string;
  readRoundState?: WorldSimulationReadRoundState_ACU;
  writeSql?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['writeSql'];
  readCurrent?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['readCurrent'];
  readFieldSnapshot?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['readFieldSnapshot'];
  runWrites?: WorldSimulationRunWriteState_ACU;
  isCurrent?: () => boolean;
  opening: WorldSimulationWorkflowOpening_ACU;
  anchorMaterialsCommitted?: boolean;
  /** 显式补足时的程序级写集；省略表示正常固定工作流。 */
  targetModules?: readonly WorldSimulationLedgerModule_ACU[];
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run'>;
  directorMaterials?: string;
  triggeredWorldbook?: string;
  fixedWorldbook?: WorldSimulationFixedWorldbook_ACU;
}

export interface WorldSimulationWorkflowResult_ACU {
  outcome: 'commit' | 'no_change' | 'escalate' | 'blocked';
  summary: string;
  outcomes: WorldSimulationSubagentOutcome_ACU[];
  pendingFixes: WorldSimulationPendingFix_ACU[];
  escalated: boolean;
  ledger: WorldSimulationLedger_ACU;
  /** Commit 路径仅为候选；提交适配器可能过滤信号，最终交付以提交后的权威账本为准。 */
  finalProjection: {
    content: string | null;
    sourceAgent: 'guidance-composer' | 'current-ledger';
    sourceRevision: number;
    deliverable: boolean;
  };
  commitCandidate?: WorldSimulationCommitCandidate_ACU;
}

const WORKFLOW_AGENTS_ACU = ['timekeeper', 'undercurrent-analyst', 'dramatis-keeper'] as const;
/** 场外信号未提交、为空或 strict 碰撞未兑现时，回灌 guidance-composer 的定向修正次数上限。 */
export const WORLD_SIMULATION_PROJECTION_CORRECTION_ATTEMPTS_ACU = 2;
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

function isRunWriteOverlap_ACU(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WORLD_SIMULATION_RUN_WRITE_OVERLAP');
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
  targetModules?: readonly WorldSimulationLedgerModule_ACU[],
): string {
  const modules = targetModules ?? findWorldSimulationAgentDefinition_ACU(agentName)?.writableModules ?? [];
  const fixes = fixesForAgent_ACU(ledger, agentName);
  const lines = [
    `本轮焦点：${focus}`,
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
  // 同一轮多个角色可共享模块（rumors）。一方的 no_change 不能抹去另一方
  // 的事务拒绝或不完整结果；只有本轮该模块全体结果均合格才清历史缺口。
  const incomplete = new Set<WorldSimulationLedgerModule_ACU>();
  for (const outcome of outcomes) {
    for (const issue of outcome.unresolvedIssues ?? []) incomplete.add(issue.module);
    for (const [module, state] of Object.entries(outcome.moduleCompletion ?? {})) {
      if (!COMPLETE_STATES_ACU.has(String(state))) incomplete.add(module as WorldSimulationLedgerModule_ACU);
    }
  }
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
      if (COMPLETE_STATES_ACU.has(String(state)) && !touched.has(ledgerModule) && !incomplete.has(ledgerModule)) completed.add(ledgerModule);
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

/** 新流程只接受能从运行 base 整组重放的完整候选；旧逐栏流程保留原宽容预览。 */
async function applyOneShotCandidates_ACU(
  base: WorldSimulationLedger_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  authorized: ReadonlySet<string>,
  settings: WorldSimulationSettings_ACU,
  anchorMessage: string,
): Promise<{ ledger: WorldSimulationLedger_ACU; accepted: WorldSimulationCandidate_ACU[]; rejected: WorldSimulationSubagentOutcome_ACU[] }> {
  let ledger = base;
  const accepted: WorldSimulationCandidate_ACU[] = [];
  const rejected: WorldSimulationSubagentOutcome_ACU[] = [];
  for (const candidate of candidates) {
    const required = candidateModules_ACU(candidate);
    try {
      const batch = [...accepted, candidate];
      const preview = await applyWorldSimulationCandidatesDetailedViaSql_ACU(
        base, batch, authorized, settings, { anchorMessage });
      const batchIds = new Set(batch.map(item => item.candidateId));
      const incomplete = preview.pendingFixes.filter(fix => batchIds.has(fix.candidateId));
      const expectedModules = new Set(batch.flatMap(candidateModules_ACU));
      if (incomplete.length || [...expectedModules].some(module => !preview.appliedModules.includes(module))) {
        rejected.push(failedOutcome_ACU(candidate.agentName,
          `整组候选未完整应用：${incomplete.map(fix => `${fix.module}: ${fix.lastError}`).join('；') || [...expectedModules].filter(module => !preview.appliedModules.includes(module)).join('、')}`,
          'transaction_rejected', required));
        continue;
      }
      ledger = preview.ledger;
      accepted.push(candidate);
    } catch (error) {
      rejected.push(failedOutcome_ACU(candidate.agentName, error, 'transaction_rejected', required));
    }
  }
  return { ledger, accepted, rejected };
}

export async function runWorldSimulationGuidanceComposer_ACU(input: {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  toolMode?: import('../../ai/agent-tool-mode').AgentToolMode_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  roundId?: string;
  readRoundState?: WorldSimulationReadRoundState_ACU;
  writeSql?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['writeSql'];
  readCurrent?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['readCurrent'];
  readFieldSnapshot?: import('./agent-subagent-runtime').WorldSimulationSubagentRunInput_ACU['readFieldSnapshot'];
  isCurrent?: () => boolean;
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run'>;
  directorMaterials?: string;
  triggeredWorldbook?: string;
  fixedWorldbook?: WorldSimulationFixedWorldbook_ACU;
  ledger: WorldSimulationLedger_ACU;
  focus: string;
  candidateSeq: number;
}): Promise<WorldSimulationSubagentOutcome_ACU> {
  const agentName = 'guidance-composer' as const;
  try {
    return await input.subagents.run({
      delegation: {
        agentName,
        instruction: instructionFor_ACU(agentName, input.focus, input.ledger),
        reads: ['ledger:current', 'anchor:message', 'player:current'],
      },
      settings: input.settings,
      promptContext: { ...input.promptContext, worldState: input.ledger },
      toolMode: input.toolMode,
      registry: input.registry,
      tools: input.tools,
      writeSql: input.writeSql,
      readCurrent: input.readCurrent,
      readFieldSnapshot: input.readFieldSnapshot,
      isCurrent: input.isCurrent,
      roundId: input.roundId,
      readRoundState: input.readRoundState,
      runId: input.identity.runId,
      candidateSeq: input.candidateSeq,
      directorMaterials: input.directorMaterials,
      triggeredWorldbook: input.triggeredWorldbook,
      fixedWorldbook: input.fixedWorldbook,
    });
  } catch (error) {
    return failedOutcome_ACU(agentName, error, 'invoke_failed', ['guidance']);
  }
}

export async function runWorldSimulationWorkflow_ACU(input: WorldSimulationWorkflowInput_ACU): Promise<WorldSimulationWorkflowResult_ACU> {
  input.runWrites?.assertCurrent();
  const base = cloneLedger_ACU(requireLedger_ACU(input.readCurrent?.() ?? input.promptContext.worldState));
  const skipModules = new Set(input.opening.skipModules);
  const requestedTargets = input.targetModules ? new Set(input.targetModules) : null;
  const expectedModules = new Set<WorldSimulationLedgerModule_ACU>();
  const outcomes: WorldSimulationSubagentOutcome_ACU[] = [];
  const seq = new Map<string, number>();
  const anchorMessage = anchorText_ACU(input.promptContext);
  const authorized = authorizedRefs_ACU(input.registry);
  let confirmedWrites = input.runWrites?.confirmedWrites ?? 0;
  const refreshLedger = async (preview: WorldSimulationLedger_ACU, candidates: readonly WorldSimulationCandidate_ACU[]): Promise<WorldSimulationLedger_ACU> => {
    if (!input.readCurrent) return preview;
    input.runWrites?.assertCurrent();
    const current = requireLedger_ACU(input.readCurrent());
    if ((input.runWrites?.confirmedWrites ?? 0) === confirmedWrites) {
      if (current.revision !== base.revision && !input.runWrites) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
      return preview;
    }
    input.runWrites?.assertCandidatesDisjoint(candidates);
    confirmedWrites = input.runWrites!.confirmedWrites;
    if (!candidates.length) return cloneLedger_ACU(current);
    const replay = await applyWorldSimulationCandidatesDetailedViaSql_ACU(current, candidates, authorized, input.settings, { anchorMessage });
    if (!replay.appliedModules.length || replay.pendingFixes.length) throw new Error('WORLD_SIMULATION_WORKFLOW_REBASE_FAILED');
    return replay.ledger;
  };
  const applyPending = async (preview: WorldSimulationLedger_ACU, candidates: readonly WorldSimulationCandidate_ACU[]) => {
    try {
      input.runWrites?.assertCandidatesDisjoint(candidates);
      return applySafely_ACU(preview, candidates, authorized, input.settings, anchorMessage);
    } catch (error) {
      if (!isRunWriteOverlap_ACU(error)) throw error;
      return {
        ledger: preview,
        accepted: [],
        rejected: candidates.map(candidate => failedOutcome_ACU(candidate.agentName, error, 'transaction_rejected', candidateModules_ACU(candidate))),
      };
    }
  };
  const nextSeq = (agentName: string): number => {
    const value = (seq.get(agentName) ?? 0) + 1;
    seq.set(agentName, value);
    return value;
  };
  const runAgent = async (
    agentName: WorldSimulationAgentName_ACU,
    ledger: WorldSimulationLedger_ACU,
    targetModules = modulesForAgent_ACU(agentName).filter(module => !skipModules.has(module)),
  ): Promise<WorldSimulationSubagentOutcome_ACU> => {
    try {
      const outcome = await input.subagents.run({
        delegation: {
          agentName,
          instruction: instructionFor_ACU(agentName, input.opening.focus, ledger, targetModules),
          reads: ['ledger:current', 'anchor:message'],
        },
        settings: input.settings,
        promptContext: { ...input.promptContext, worldState: ledger },
        toolMode: input.toolMode,
        registry: input.registry,
        tools: input.tools,
        writeSql: input.writeSql,
        readCurrent: input.readCurrent,
        readFieldSnapshot: input.readFieldSnapshot,
        isCurrent: input.isCurrent,
        roundId: input.roundId,
        readRoundState: input.readRoundState,
        writableModules: targetModules,
        runId: input.identity.runId,
        candidateSeq: nextSeq(agentName),
        directorMaterials: input.directorMaterials,
        triggeredWorldbook: input.triggeredWorldbook,
        fixedWorldbook: input.fixedWorldbook,
      });
      const restricted = restrictOutcome_ACU(outcome, targetModules);
      if (restricted.candidate && input.runWrites) {
        const stripped = input.runWrites.stripConfirmedWrites(restricted.candidate);
        if (!stripped) {
          return failedOutcome_ACU(
            restricted.agentName,
            new Error('WORLD_SIMULATION_RUN_WRITE_OVERLAP:confirmed write fully covered candidate'),
            'transaction_rejected',
            targetModules,
          );
        }
        restricted.candidate = stripped;
      }
      return restricted;
    } catch (error) {
      return failedOutcome_ACU(agentName, error, 'invoke_failed', targetModules);
    }
  };

  if (input.anchorMaterialsCommitted && anchorMaterialsComplete_ACU(base)) {
    return {
      outcome: 'no_change',
      summary: '正文指纹未变且所有预期资料模块均已完成，整轮跳过',
      outcomes,
      finalProjection: { content: buildWorldSimulationProjection_ACU(base), sourceAgent: 'current-ledger', sourceRevision: base.revision, deliverable: true },
      pendingFixes: [],
      escalated: false,
      ledger: base,
    };
  }

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
  if (timekeeperTargets?.length) outcomes.push(await runAgent('timekeeper', base, timekeeperTargets));
  const afterTimekeeper = await refreshLedger(base, []);
  const parallel = (['undercurrent-analyst', 'dramatis-keeper'] as const).filter(name => primaryTargets.has(name));
  outcomes.push(...await Promise.all(parallel.map(name => runAgent(name, afterTimekeeper, primaryTargets.get(name)!))));

  const primaryOutcomes = [...outcomes];
  let ledger = await refreshLedger(afterTimekeeper, []);
  let accepted: WorldSimulationCandidate_ACU[] = [];
  const primaryCandidates = primaryOutcomes.flatMap(item => item.candidate ? [item.candidate] : []);
  const primary = await applyPending(ledger, primaryCandidates);
  ledger = primary.ledger;
  accepted = primary.accepted;
  outcomes.push(...primary.rejected);
  ledger = recordWorkflowIssues_ACU(ledger, [...primaryOutcomes, ...primary.rejected], input.identity);

  const shouldChronicle = (!requestedTargets || requestedTargets.has('chronicle') || requestedTargets.has('rumors'))
    && !agentSkipped_ACU('chronicler', skipModules) && (
    !requestedTargets
    || input.opening.dispatchChronicler
    || ledger.chronicle.length >= input.settings.workflow.chroniclerHotThreshold
    || seedsClosedThisRound_ACU(base, ledger)
  );
  if (shouldChronicle) {
    expectedModules.add('chronicle');
    expectedModules.add('rumors');
    const chronicler = await runAgent('chronicler', ledger, ['chronicle', 'rumors'].filter(module => !skipModules.has(module)) as WorldSimulationLedgerModule_ACU[]);
    outcomes.push(chronicler);
    ledger = clearCompletedPending_ACU(await refreshLedger(ledger, accepted), [chronicler]);
    if (chronicler.candidate) {
      const archived = await applyPending(ledger, [chronicler.candidate]);
      ledger = archived.ledger;
      accepted = [...accepted, ...archived.accepted];
      outcomes.push(...archived.rejected);
      ledger = recordWorkflowIssues_ACU(ledger, [chronicler, ...archived.rejected], input.identity);
    } else {
      ledger = recordWorkflowIssues_ACU(ledger, [chronicler], input.identity);
    }
  }

  // 〈与此同时〉每轮必写：不再以本轮是否有投影相关变更为门控，composer 每轮依据最新正文重新分析。
  if ((!requestedTargets || requestedTargets.has('guidance'))
    && !agentSkipped_ACU('guidance-composer', skipModules)) {
    expectedModules.add('guidance');
    const composer = await runWorldSimulationGuidanceComposer_ACU({
      identity: input.identity,
      settings: input.settings,
      toolMode: input.toolMode,
      promptContext: input.promptContext,
      registry: input.registry,
      tools: input.tools,
      writeSql: input.writeSql,
      readCurrent: input.readCurrent,
      readFieldSnapshot: input.readFieldSnapshot,
      isCurrent: input.isCurrent,
      roundId: input.roundId,
      readRoundState: input.readRoundState,
      subagents: input.subagents,
      ledger,
      focus: input.opening.focus,
      candidateSeq: nextSeq('guidance-composer'),
      directorMaterials: input.directorMaterials,
      triggeredWorldbook: input.triggeredWorldbook,
      fixedWorldbook: input.fixedWorldbook,
    });
    outcomes.push(composer);
    ledger = clearCompletedPending_ACU(await refreshLedger(ledger, accepted), [composer]);
    if (composer.candidate) {
      const projected = await applyPending(ledger, [composer.candidate]);
      ledger = projected.ledger;
      accepted = [...accepted, ...projected.accepted];
      outcomes.push(...projected.rejected);
      ledger = recordWorkflowIssues_ACU(ledger, [composer, ...projected.rejected], input.identity);
    } else {
      ledger = recordWorkflowIssues_ACU(ledger, [composer], input.identity);
    }
  }

  ledger = recordWorkflowIssues_ACU(await refreshLedger(ledger, accepted), [], input.identity);
  const materialCompletion = completionRecord_ACU(
    base, ledger, outcomes, [...expectedModules], input.identity, input.anchorMaterialsCommitted === true,
  );
  ledger = { ...ledger, materialCompletion };
  const escalated = ledger.pendingFixes.length > 0;
  const summary = escalated
    ? `工作流完成，仍有待修复模块需要主会话处理：${ledger.pendingFixes.map(item => `${item.module}(${item.attempts})`).join('、')}`
    : accepted.length
      ? `固定工作流已处理 ${accepted.length} 个候选`
      : '固定工作流没有产生账本变更';
  const evidenceRefs = [...new Set(accepted.flatMap(item => item.evidenceRefs))];
  const finalProjection = {
    content: buildWorldSimulationProjection_ACU(ledger),
    sourceAgent: accepted.some(item => item.agentName === 'guidance-composer' && Object.prototype.hasOwnProperty.call(item.patch, 'guidance'))
      ? 'guidance-composer' as const : 'current-ledger' as const,
    sourceRevision: ledger.revision,
    deliverable: !escalated && accepted.length === 0,
  };
  return {
    outcome: escalated ? 'escalate' : accepted.length ? 'commit' : 'no_change',
    summary,
    outcomes,
    pendingFixes: ledger.pendingFixes,
    escalated,
    ledger,
    finalProjection,
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

/** 新任务只在内存预览，最终仍由提交适配器在同一 base 上提交全部候选。 */
export async function runWorldSimulationOneShotWorkflow_ACU(
  input: Omit<WorldSimulationWorkflowInput_ACU, 'subagents'> & {
    subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'runOneShot'>;
  },
): Promise<WorldSimulationWorkflowResult_ACU> {
  if (input.runWrites?.hasConfirmedWrites) throw new Error('WORLD_SIMULATION_ONE_SHOT_LEGACY_WRITES');
  input.runWrites?.assertCurrent();
  const base = cloneLedger_ACU(requireLedger_ACU(input.readCurrent?.() ?? input.promptContext.worldState));
  const outcomes: WorldSimulationSubagentOutcome_ACU[] = [];
  if (input.anchorMaterialsCommitted && anchorMaterialsComplete_ACU(base)) {
    return { outcome: 'no_change', summary: '正文指纹未变且资料模块已经完成', outcomes,
      pendingFixes: [], escalated: false, ledger: base,
      finalProjection: { content: buildWorldSimulationProjection_ACU(base), sourceAgent: 'current-ledger', sourceRevision: base.revision, deliverable: true } };
  }
  const anchorMessage = anchorText_ACU(input.promptContext);
  const elapsedDays = inferWorldSimulationElapsedDays_ACU(anchorMessage);
  const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
  const anchorEvidenceRef = snapshot.entries.find(entry => entry.address === 'anchor:message' && entry.evidenceRef)?.evidenceRef;
  if (!anchorEvidenceRef) throw new Error('WORLD_SIMULATION_ANCHOR_EVIDENCE_MISSING');
  const authorized = authorizedRefs_ACU(input.registry);
  const requested = input.targetModules ? new Set(input.targetModules) : null;
  const skip = new Set(input.opening.skipModules);
  const expected = new Set<WorldSimulationLedgerModule_ACU>();
  const entries = new Map<string, { entryId: number; label: string }>();
  const roles = (['undercurrent-analyst', 'dramatis-keeper'] as const).filter(role =>
    modulesForAgent_ACU(role).some(module => !skip.has(module) && (!requested || requested.has(module))));
  const call = async (role: 'undercurrent-analyst' | 'dramatis-keeper' | 'guidance-composer',
    ledger: WorldSimulationLedger_ACU, seq: number, roundChanges?: string,
    targetOverride?: readonly WorldSimulationLedgerModule_ACU[]): Promise<WorldSimulationSubagentOutcome_ACU> => {
    const targets = targetOverride
      ? [...targetOverride]
      : modulesForAgent_ACU(role).filter(module => !skip.has(module) && (!requested || requested.has(module)));
    targets.forEach(module => expected.add(module));
    if (input.isCurrent && !input.isCurrent()) throw new Error('WORLD_SIMULATION_RUN_STALE');
    const label = role === 'undercurrent-analyst' ? '批次一：时序与伏线'
      : role === 'dramatis-keeper' ? '批次一：人物谱'
        : seq > 2 ? `碰撞修正：场外信号（第 ${seq - 2} 次）` : '批次二：纪要、风声与场外信号';
    const entryKey = `${role}:${seq}`;
    const entryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
      kind: 'delegation', title: `${label}正在执行`, agentName: role, status: 'running',
    });
    entries.set(entryKey, { entryId, label });
    let state: 'done' | 'failed' | 'running' = 'failed';
    try {
      const outcome = await input.subagents.runOneShot({ agentName: role, settings: input.settings,
        toolMode: input.toolMode,
        promptContext: { ...input.promptContext, worldState: ledger }, registry: input.registry,
        tools: input.tools, runId: input.identity.runId, candidateSeq: seq,
        focus: input.opening.focus, anchorEvidenceRef, givenLedger: ledger,
        baseLedgerRevision: base.revision, elapsedDays, roundChanges, injectWorldbook: seq === 1,
        sessionChatIdentity: input.identity.chatIdentity,
        triggeredWorldbook: seq === 1 ? input.triggeredWorldbook : undefined,
        fixedWorldbook: seq === 1 ? input.fixedWorldbook : undefined, isCurrent: input.isCurrent });
      const restricted = restrictOutcome_ACU(outcome, targets);
      state = restricted.candidate ? 'running'
        : restricted.completion !== 'failed' && restricted.completion !== 'partial'
          && restricted.status !== 'failed' && restricted.status !== 'blocked' ? 'done' : 'failed';
      return restricted;
    } catch (error) {
      if (error instanceof Error && error.message === 'WORLD_SIMULATION_RUN_STALE') throw error;
      return failedOutcome_ACU(role, error, 'invoke_failed', targets);
    } finally {
      updateWorldSimulationSession_ACU(input.identity.chatIdentity, entryId, {
        title: `${label}${state === 'done' ? '已完成' : state === 'running' ? '待事务校验' : '未完整完成'}`,
        ok: state === 'done', status: state,
      });
    }
  };
  const settleCandidate = (outcome: WorldSimulationSubagentOutcome_ACU, acceptedCandidates: readonly WorldSimulationCandidate_ACU[], seq: number): void => {
    if (!outcome.candidate) return;
    const entry = entries.get(`${outcome.agentName}:${seq}`);
    if (!entry) return;
    const ok = acceptedCandidates.some(item => item.candidateId === outcome.candidate?.candidateId);
    updateWorldSimulationSession_ACU(input.identity.chatIdentity, entry.entryId, {
      title: `${entry.label}${ok ? '已通过事务校验' : '事务校验失败'}`,
      ok, status: ok ? 'done' : 'failed',
    });
  };
  const first = await Promise.all(roles.map(role => call(role, base, 1)));
  outcomes.push(...first);
  const primary = await applyOneShotCandidates_ACU(base, first.flatMap(item => item.candidate ? [item.candidate] : []), authorized, input.settings, anchorMessage);
  first.forEach(item => settleCandidate(item, primary.accepted, 1));
  outcomes.push(...primary.rejected);
  let ledger = primary.ledger;
  const accepted = [...primary.accepted];
  const changes: string[] = [];
  if (base.clock.day !== ledger.clock.day || base.clock.storyTime !== ledger.clock.storyTime) changes.push(`clock：第 ${base.clock.day} 日 → 第 ${ledger.clock.day} 日，${ledger.clock.storyTime}`);
  for (const module of ['dimensions', 'seeds', 'actors', 'rumors'] as const) {
    const before = new Map(base[module].map(row => [row.id, JSON.stringify(row)]));
    for (const row of ledger[module]) if (before.get(row.id) !== JSON.stringify(row)) {
      const title = 'title' in row ? row.title : 'name' in row ? row.name : row.fact;
      changes.push(`${module} ${row.id}：${title}${'status' in row ? ` (${row.status})` : 'life' in row ? ` (${row.life})` : ''}`);
    }
    const after = new Set(ledger[module].map(row => row.id));
    for (const id of before.keys()) if (!after.has(id)) changes.push(`${module} ${id}：删除`);
  }
  if (JSON.stringify(base.player) !== JSON.stringify(ledger.player)) changes.push(`player：${JSON.stringify(ledger.player.location)} / ${ledger.player.contact}`);
  const secondTargets = !requested || ['chronicle', 'rumors', 'guidance'].some(module => requested.has(module as WorldSimulationLedgerModule_ACU));
  const roundChangesText = changes.slice(0, 40).join('\n') || '本轮批次一无新增变更';
  const guidanceWritable = !skip.has('guidance') && (!requested || requested.has('guidance'));
  // 〈与此同时〉每轮必写：批次二不再以批次一有无变更为门控，每轮都依据最新正文重新分析场外信号。
  // 场外信号是写给后续剧情的引导提示，不是正文补写；大变局时逐轮牵引。
  const projectionDirective = '【本轮场外信号要求】每轮都必须依据本轮锚点正文与最新账本重新判断：剧情视角下一步快要碰到账本里的哪些事、世界大势正把故事往哪里推，并写成给后续剧情的引导提示，不写景物或旁白式的补充描写。signals 整列替换，至少 1 条，跟随剧情位置与人物变化更新；存在大变局时至少一条 ambient 指向它，并在上一轮基础上推进一步；删去已被正文写出、过时或不可达的旧信号；即使批次一无变更也必须提交 guidance，不得以无变化跳过。';
  let lastRejection = '';
  // composer 调用本身失败（运行时已做过协议修正）时不再追加修正轮；只对偷懒无变化、事务拒绝、空信号与碰撞未兑现回灌。
  let composerFailed = false;
  if (secondTargets) {
    const second = await call('guidance-composer', ledger, 2,
      guidanceWritable ? `${roundChangesText}\n${projectionDirective}` : roundChangesText);
    outcomes.push(second);
    if (second.candidate) {
      const preview = await applyOneShotCandidates_ACU(base, [...accepted, second.candidate], authorized, input.settings, anchorMessage);
      ledger = preview.ledger;
      accepted.splice(0, accepted.length, ...preview.accepted);
      settleCandidate(second, preview.accepted, 2);
      outcomes.push(...preview.rejected);
      lastRejection = preview.rejected.map(item => item.summary).join('；');
    } else {
      lastRejection = second.summary;
      composerFailed = second.status === 'failed' || second.status === 'blocked';
    }
  }
  // 程序层兜底：guidance 未提交/为空，或 strict 碰撞后验（与提交管线同源）未兑现时，
  // 把具体原因回灌唯一有 guidance 写权的 composer，有上限地定向修正；修正候选只写 guidance。
  const collisionReport = collisionReport_ACU(input.promptContext);
  const strictCollision = !!collisionReport && input.settings.dynamics.collisionEnforcement === 'strict';
  const projectionViolations = (): string[] => {
    const issues: string[] = [];
    const submitted = accepted.some(item => item.agentName === 'guidance-composer' && Object.prototype.hasOwnProperty.call(item.patch, 'guidance'));
    if (!submitted) issues.push('本轮没有通过事务校验的 guidance：每轮必须重新分析并整列提交 signals');
    else if (!ledger.guidance.signals.length) issues.push('本轮 guidance.signals 为空：至少需要 1 条贴合当前剧情的场外信号');
    if (strictCollision) issues.push(...assertCollisionFulfillment_ACU(collisionReport!, ledger.guidance, ledger));
    return issues;
  };
  if (secondTargets && guidanceWritable && !composerFailed) {
    let violations = projectionViolations();
    for (let attempt = 1; violations.length && attempt <= WORLD_SIMULATION_PROJECTION_CORRECTION_ATTEMPTS_ACU; attempt += 1) {
      const seq = 2 + attempt;
      const feedback = [
        roundChangesText,
        projectionDirective,
        `【场外信号未通过·第 ${attempt} 次修正】${violations.join('；')}`,
        lastRejection ? `【上次提交未通过的原因】${lastRejection}` : '',
        '只修正 guidance：按上述原因整列提交 signals；列出的碰撞种子各补一条 voice=encounter 且 sourceId 等于该种子 ID 的信号；移除泄露 latent/dead 传闻的信号。不要改纪要与风声。',
      ].filter(Boolean).join('\n');
      const fix = await call('guidance-composer', ledger, seq, feedback, ['guidance']);
      outcomes.push(fix);
      if (!fix.candidate) {
        lastRejection = fix.summary;
        if (fix.status === 'failed' || fix.status === 'blocked') break;
        continue;
      }
      const fixId = fix.candidate.candidateId;
      const preview = await applyOneShotCandidates_ACU(base, [...accepted, fix.candidate], authorized, input.settings, anchorMessage);
      settleCandidate(fix, preview.accepted, seq);
      outcomes.push(...preview.rejected);
      if (!preview.accepted.some(item => item.candidateId === fixId)) {
        lastRejection = preview.rejected.map(item => item.summary).join('；');
        continue;
      }
      ledger = preview.ledger;
      accepted.splice(0, accepted.length, ...preview.accepted);
      lastRejection = '';
      violations = projectionViolations();
    }
    // 修正耗尽：以 guidance 模块级缺口显式落账，不伪装成无变化。
    if (violations.length) {
      outcomes.push(failedOutcome_ACU('guidance-composer', `场外信号修正耗尽：${violations.join('；')}`, 'protocol_failed', ['guidance']));
    }
  }
  ledger = recordWorkflowIssues_ACU(ledger, outcomes, input.identity);
  ledger = clearCompletedPending_ACU(ledger, outcomes);
  const materialCompletion = completionRecord_ACU(base, ledger, outcomes, [...expected], input.identity, input.anchorMaterialsCommitted === true);
  ledger = { ...ledger, materialCompletion };
  const blocked = accepted.length === 0 && (ledger.pendingFixes.length > 0 || outcomes.some(item => item.status === 'failed' || item.status === 'blocked'));
  // Protocol/invocation errors have no attributable ledger module. Report them
  // without fabricating a pending fix for every module owned by the role.
  const failures = outcomes.filter(item => (item.status === 'failed' || item.status === 'blocked') && !(item.unresolvedIssues?.length));
  const reasons = [...ledger.pendingFixes.map(fix => `${fix.module}(${fix.lastError})`),
    ...failures.map(item => `${item.agentName}(${item.summary})`)];
  const summary = blocked ? `资料维护失败：${reasons.join('、')}`
    : accepted.length ? `固定工作流已处理 ${accepted.length} 个候选` : '固定工作流没有产生账本变更';
  return { outcome: blocked ? 'blocked' : accepted.length ? 'commit' : 'no_change', summary,
    outcomes, pendingFixes: ledger.pendingFixes, escalated: false, ledger,
    finalProjection: { content: buildWorldSimulationProjection_ACU(ledger),
      sourceAgent: accepted.some(item => item.agentName === 'guidance-composer' && 'guidance' in item.patch) ? 'guidance-composer' : 'current-ledger',
      sourceRevision: ledger.revision, deliverable: !blocked && accepted.length === 0 },
    ...(accepted.length ? { commitCandidate: { runId: input.identity.runId, taskId: input.identity.taskId,
      stageId: input.identity.stageId, stageRevision: input.identity.stageRevision,
      baseLedgerRevision: input.identity.baseLedgerRevision, summary: input.opening.summary || summary,
      acceptedCandidates: accepted, evidenceRefs: [...new Set(accepted.flatMap(item => item.evidenceRefs))],
      pendingFixes: ledger.pendingFixes, materialCompletion, collisionReport: collisionReport_ACU(input.promptContext) } } : {}) };
}
