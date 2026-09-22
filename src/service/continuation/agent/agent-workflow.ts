/**
 * service/continuation/agent/agent-workflow.ts — 续写固定工作流
 *
 * 程序按固定顺序驱动结算、策划、条件审查、容错提交、自动修复与写作指令编排。
 * 主会话只提供开局参数，不再逐个派这些角色。模型调用通过端口注入，便于单测。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import type { ContinuationSettings_ACU } from '../model';
import {
  AGENT_INSTRUCTION_COMPOSER_NAME_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentComposerOutput_ACU,
  type AgentFinalReviewerOutput_ACU,
  type AgentMaterialCompletionState_ACU,
  type AgentMaintainerOutput_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentPendingFix_ACU,
  type AgentPendingFixSource_ACU,
  type AgentPlannerOutput_ACU,
  type AgentResearcherOutput_ACU,
  type AgentReviewerOutput_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';
import {
  applyAgentConstraintRegistration_ACU,
  applyAgentModuleDelta_ACU,
  applyAgentWebRefsDelta_ACU,
  applyAgentConstraintRegistrationViaSql_ACU,
  applyAgentModuleDeltaViaSql_ACU,
  applyAgentWebRefsDeltaViaSql_ACU,
  mergeAgentDeltaRevisions_ACU,
  type AgentModuleApplyOptions_ACU,
} from './agent-transaction';

export interface ContinuationWorkflowOpening_ACU {
  focus: string;
  summary: string;
  dispatchWebResearcher: boolean;
}

export type ContinuationWorkflowBilling_ACU = 'pipeline' | 'opening' | 'repair';

export interface ContinuationWorkflowAgentCall_ACU {
  agentName: string;
  prompt: string;
  billing: ContinuationWorkflowBilling_ACU;
  repair: boolean;
  targetModules?: AgentWritableModule_ACU[];
}

export interface ContinuationWorkflowUnresolvedIssue_ACU {
  module: AgentWritableModule_ACU;
  source: AgentPendingFixSource_ACU;
  path: string;
  message: string;
  id?: string;
}

export interface ContinuationWorkflowAgentPayload_ACU {
  ok: boolean;
  summary: string;
  noChange?: boolean;
  maintainer?: AgentMaintainerOutput_ACU | null;
  arc?: AgentMaintainerOutput_ACU | null;
  planner?: AgentPlannerOutput_ACU | null;
  reviewer?: AgentReviewerOutput_ACU | null;
  researcher?: AgentResearcherOutput_ACU | null;
  readRevisions?: AgentModuleRevisions_ACU;
  writes?: readonly string[];
  completion?: Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>;
  moduleCompletion?: Partial<Record<AgentWritableModule_ACU, Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>>>;
  unresolvedIssues?: ContinuationWorkflowUnresolvedIssue_ACU[];
  acceptedKeys?: string[];
}

export interface ContinuationWorkflowStep_ACU {
  agentName: string;
  status: 'ok' | 'failed' | 'skipped' | 'no_change';
  summary: string;
}

export interface ContinuationWorkflowResult_ACU {
  outcome: 'deliver' | 'no_change' | 'escalate';
  summary: string;
  instruction: string;
  pendingFixes: AgentPendingFix_ACU[];
  escalated: boolean;
  escalationKind: '' | 'pending_fix' | 'final_review';
  snapshot: AgentModuleSnapshot_ACU;
  steps: ContinuationWorkflowStep_ACU[];
}

export interface ContinuationWorkflowInput_ACU {
  settings: ContinuationSettings_ACU;
  snapshot: AgentModuleSnapshot_ACU;
  opening: ContinuationWorkflowOpening_ACU;
  hasUnsettledHistory: boolean;
  beatObligation: boolean;
  majorTurn: boolean;
  settledIndex: number;
  completedStageNumbers: readonly number[];
  runAgent: (call: ContinuationWorkflowAgentCall_ACU) => Promise<ContinuationWorkflowAgentPayload_ACU>;
  runComposer: (call: { prompt: string; revisionFeedback: string; priorInstruction: string }) => Promise<AgentComposerOutput_ACU>;
  runFinalReview: (instruction: string, summary: string) => Promise<AgentFinalReviewerOutput_ACU>;
}

export interface ContinuationMaterialRepairInput_ACU {
  snapshot: AgentModuleSnapshot_ACU;
  targetModules: readonly AgentWritableModule_ACU[];
  settledIndex: number;
  completedStageNumbers: readonly number[];
  runAgent: (call: ContinuationWorkflowAgentCall_ACU) => Promise<ContinuationWorkflowAgentPayload_ACU>;
}

export interface ContinuationMaterialRepairResult_ACU {
  snapshot: AgentModuleSnapshot_ACU;
  repairedModules: AgentWritableModule_ACU[];
  failedModules: AgentWritableModule_ACU[];
  steps: ContinuationWorkflowStep_ACU[];
}

const MAINTAINER_NAME_ACU = 'hook-cognition-maintainer';
const MAINLINE_NAME_ACU = 'mainline-planner';
const BEAT_NAME_ACU = 'beat-planner';
const REVIEWER_NAME_ACU = 'continuity-reviewer';
const ARC_NAME_ACU = 'arc-architect';
const WEB_NAME_ACU = 'web-researcher';
const MAINTAINER_MODULES_ACU = ['hooks', 'infoGap', 'chronology'] as const;
export const CONTINUATION_REPAIRABLE_MODULES_ACU = [...MAINTAINER_MODULES_ACU, 'storyArc', 'webRefs'] as const;
const BEAT_OBLIGATION_PATTERN_ACU = /伏笔|埋设|回收|误导|信息差|揭示/;
const CONFLICT_PATTERN_ACU = /冲突|矛盾|红线/;

export function continuationBeatObligation_ACU(turn: { goal?: string; function?: string } | null): boolean {
  if (!turn) return false;
  if (turn.function === 'payoff' || turn.function === 'reveal') return true;
  return BEAT_OBLIGATION_PATTERN_ACU.test(turn.goal ?? '');
}

export function continuationMajorTurn_ACU(turn: { pacing?: string; function?: string } | null): boolean {
  if (!turn) return false;
  return turn.pacing === 'turn' || turn.function === 'reveal';
}

export function continuationContinuityReviewRequired_ACU(input: {
  majorTurn: boolean;
  recommendations: readonly string[];
  risks: readonly string[];
}): boolean {
  if (input.majorTurn) return true;
  return CONFLICT_PATTERN_ACU.test([...input.recommendations, ...input.risks].join('\n'));
}

function isStale_ACU(error: unknown): boolean {
  return error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE';
}

function errorText_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return error.error.message;
  return error instanceof Error ? error.message : String(error);
}

function tolerantOptions_ACU(agentName: string): AgentModuleApplyOptions_ACU {
  return { onViolation: () => undefined, agentName };
}

function deltaTouched_ACU(delta: AgentMaintainerOutput_ACU['delta'] | null | undefined): boolean {
  if (!delta) return false;
  return Boolean(
    delta.hooks.length || delta.hookPatches.length || delta.infoGap.length || delta.infoGapPatches.length
    || delta.storyArc.length || delta.storyArcPatches.length || delta.chronology.length,
  );
}

function repairableAgents_ACU(snapshot: AgentModuleSnapshot_ACU, settings: ContinuationSettings_ACU): string[] {
  if (!settings.workflow.autoFixEnabled) return [];
  const names = new Set<string>();
  for (const fix of snapshot.pendingFixes) {
    if (fix.attempts >= settings.workflow.autoFixMaxAttempts) continue;
    if (fix.module === 'hooks' || fix.module === 'infoGap' || fix.module === 'chronology') names.add(MAINTAINER_NAME_ACU);
    else if (fix.module === 'storyArc') names.add(ARC_NAME_ACU);
    else if (fix.module === 'webRefs') names.add(WEB_NAME_ACU);
  }
  return [...names];
}

function repairModulesForAgent_ACU(snapshot: AgentModuleSnapshot_ACU, agentName: string): AgentWritableModule_ACU[] {
  return [...new Set(snapshot.pendingFixes
    .filter(item => {
      if (agentName === MAINTAINER_NAME_ACU) return (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module);
      if (agentName === ARC_NAME_ACU) return item.module === 'storyArc';
      if (agentName === WEB_NAME_ACU) return item.module === 'webRefs';
      return false;
    })
    .map(item => item.module))];
}

function restrictMaintainerOutput_ACU(
  output: AgentMaintainerOutput_ACU | null | undefined,
  allowedModules: readonly AgentWritableModule_ACU[],
): AgentMaintainerOutput_ACU | null | undefined {
  if (!output) return output;
  const allowed = new Set<AgentWritableModule_ACU>(allowedModules);
  return {
    ...output,
    delta: {
      ...output.delta,
      hooks: allowed.has('hooks') ? output.delta.hooks : [],
      hookPatches: allowed.has('hooks') ? output.delta.hookPatches : [],
      infoGap: allowed.has('infoGap') ? output.delta.infoGap : [],
      infoGapPatches: allowed.has('infoGap') ? output.delta.infoGapPatches : [],
      storyArc: allowed.has('storyArc') ? output.delta.storyArc : [],
      storyArcPatches: allowed.has('storyArc') ? output.delta.storyArcPatches : [],
      chronology: allowed.has('chronology') ? output.delta.chronology : [],
      constraintProposals: allowed.has('constraints') ? output.delta.constraintProposals : [],
    },
  };
}

function needsPendingEscalation_ACU(snapshot: AgentModuleSnapshot_ACU, settings: ContinuationSettings_ACU): boolean {
  if (!snapshot.pendingFixes.length) return false;
  if (!settings.workflow.autoFixEnabled) return true;
  return snapshot.pendingFixes.some(item => item.attempts >= settings.workflow.autoFixMaxAttempts);
}

function formatFixes_ACU(fixes: readonly AgentPendingFix_ACU[]): string {
  if (!fixes.length) return '无';
  return fixes.map(item => `${item.module} 第 ${item.attempts} 次：${item.violations.map(violation => violation.message).join('；') || item.lastError}`).join(' | ');
}

function acceptedKeysForModule_ACU(keys: readonly string[] | undefined, module: AgentWritableModule_ACU): string[] {
  return [...new Set((keys ?? []).filter(key => key.startsWith(`${module}:`)))];
}

function recordWorkflowIssues_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  issues: readonly ContinuationWorkflowUnresolvedIssue_ACU[],
  agentName: string,
  rangeStartIndex: number,
  rangeEndIndex: number,
  acceptedKeys: readonly string[] | undefined,
): AgentModuleSnapshot_ACU {
  if (!issues.length) return snapshot;
  const now = Date.now();
  const pending = snapshot.pendingFixes.map(item => ({
    ...item,
    violations: item.violations.map(violation => ({ ...violation })),
    acceptedKeys: [...(item.acceptedKeys ?? [])],
  }));
  const byModule = new Map<AgentWritableModule_ACU, ContinuationWorkflowUnresolvedIssue_ACU[]>();
  for (const issue of issues) {
    const list = byModule.get(issue.module) ?? [];
    list.push(issue);
    byModule.set(issue.module, list);
  }
  for (const [module, moduleIssues] of byModule) {
    const found = pending.findIndex(item => item.module === module);
    const previous = found >= 0 ? pending[found] : null;
    const accepted = acceptedKeysForModule_ACU(acceptedKeys, module);
    const next: AgentPendingFix_ACU = {
      module,
      agentName: agentName || previous?.agentName || '',
      violations: moduleIssues.map(issue => ({ path: issue.path, message: issue.message })),
      attempts: (previous?.attempts ?? 0) + 1,
      firstFailedAtIndex: previous?.firstFailedAtIndex ?? rangeStartIndex,
      lastError: moduleIssues.map(issue => issue.message).join('；'),
      source: moduleIssues[0]?.source ?? 'protocol_failed',
      completion: accepted.length ? 'partial' : 'failed',
      rangeStartIndex: previous?.rangeStartIndex ?? rangeStartIndex,
      rangeEndIndex: Math.max(previous?.rangeEndIndex ?? rangeEndIndex, rangeEndIndex),
      acceptedKeys: [...new Set([...(previous?.acceptedKeys ?? []), ...accepted])],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    if (found >= 0) pending[found] = next;
    else pending.push(next);
  }
  return { ...snapshot, pendingFixes: pending };
}

function completionModules_ACU(
  payload: ContinuationWorkflowAgentPayload_ACU,
  writes: readonly AgentWritableModule_ACU[],
  fallback: Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>,
): Partial<Record<AgentWritableModule_ACU, Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>>> {
  const modules = { ...(payload.moduleCompletion ?? {}) };
  for (const module of writes) if (!modules[module]) modules[module] = fallback;
  return modules;
}

function clearCompletedPending_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  modules: Partial<Record<AgentWritableModule_ACU, Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>>>,
): AgentModuleSnapshot_ACU {
  const completed = new Set(Object.entries(modules)
    .filter(([, state]) => state === 'complete_changed' || state === 'complete_no_change')
    .map(([module]) => module));
  if (!completed.size) return snapshot;
  return { ...snapshot, pendingFixes: snapshot.pendingFixes.filter(item => !completed.has(item.module)) };
}

function maintainerPrompt_ACU(focus: string, snapshot: AgentModuleSnapshot_ACU, repair: boolean): string {
  const fixes = snapshot.pendingFixes.filter(item => (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module));
  return [
    repair ? '这是独立预算的自动修复。只提交违规模块的增量 patch，不要重写无关模块。' : `本轮焦点：${focus}`,
    '结算已经发生的正文。没有新事实时 delta 留空并在 summary 写明 no_change。',
    `待修复：${formatFixes_ACU(fixes)}`,
  ].join('\n');
}

function repairAgentForModule_ACU(module: AgentWritableModule_ACU): string | null {
  if ((MAINTAINER_MODULES_ACU as readonly string[]).includes(module)) return MAINTAINER_NAME_ACU;
  if (module === 'storyArc') return ARC_NAME_ACU;
  if (module === 'webRefs') return WEB_NAME_ACU;
  return null;
}

function outputTouchesModule_ACU(payload: ContinuationWorkflowAgentPayload_ACU, module: AgentWritableModule_ACU): boolean {
  if (module === 'webRefs') return Boolean(payload.researcher?.items.length);
  const delta = (payload.maintainer ?? payload.arc)?.delta;
  if (!delta) return false;
  if (module === 'hooks') return Boolean(delta.hooks.length || delta.hookPatches.length);
  if (module === 'infoGap') return Boolean(delta.infoGap.length || delta.infoGapPatches.length);
  if (module === 'storyArc') return Boolean(delta.storyArc.length || delta.storyArcPatches.length);
  if (module === 'chronology') return Boolean(delta.chronology.length);
  return false;
}

/**
 * 只运行资料补足子代理，不进入策划、编排或宿主正文发送。目标模块同时用于派工分组和
 * 程序级写集裁剪；非目标 pending、模块内容与 revision 均保持原样。
 */
export async function runContinuationMaterialRepair_ACU(
  input: ContinuationMaterialRepairInput_ACU,
): Promise<ContinuationMaterialRepairResult_ACU> {
  const targets = [...new Set(input.targetModules)];
  const unsupported = targets.filter(module => !repairAgentForModule_ACU(module));
  if (!targets.length || unsupported.length) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU(
      'CONTINUATION_AGENT_SNAPSHOT_INVALID',
      'agent_loop',
      unsupported.length
        ? `这些资料模块没有安全的定向补足代理：${unsupported.join(', ')}`
        : '请选择至少一个可补足的资料模块',
      false,
    ));
  }

  let snapshot = input.snapshot;
  const steps: ContinuationWorkflowStep_ACU[] = [];
  const moduleStates: Partial<Record<AgentWritableModule_ACU, Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>>> = {};
  const groups = new Map<string, AgentWritableModule_ACU[]>();
  for (const module of targets) {
    const agentName = repairAgentForModule_ACU(module)!;
    groups.set(agentName, [...(groups.get(agentName) ?? []), module]);
  }
  const calls = [...groups.entries()].map(([agentName, targetModules]) => ({
    agentName,
    billing: 'repair' as const,
    repair: true,
    targetModules,
    prompt: `用户显式要求定向补足。程序只接受这些模块：${targetModules.join(', ')}。${formatFixes_ACU(snapshot.pendingFixes.filter(item => targetModules.includes(item.module)))}`,
  }));

  const results = await Promise.all(calls.map(async call => {
    try {
      return await input.runAgent(call);
    } catch (error) {
      if (isStale_ACU(error)) throw error;
      return { ok: false, summary: errorText_ACU(error) } satisfies ContinuationWorkflowAgentPayload_ACU;
    }
  }));

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const payload = results[index];
    const fallback: Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'> = !payload.ok
      ? 'failed'
      : payload.noChange ? 'complete_no_change' : 'complete_changed';
    const reported = completionModules_ACU(payload, call.targetModules, fallback);
    const appliedModules: AgentWritableModule_ACU[] = [];
    const issues = (payload.unresolvedIssues ?? []).filter(issue => call.targetModules.includes(issue.module));

    if (payload.ok) {
      try {
        if (call.targetModules.includes('webRefs') && payload.researcher) {
          const applied = await applyAgentWebRefsDeltaViaSql_ACU(
            snapshot,
            payload.researcher,
            payload.readRevisions?.webRefs,
            Date.now(),
            tolerantOptions_ACU(call.agentName),
          );
          snapshot = applied.snapshot;
          appliedModules.push(...applied.appliedModules);
        }
        const restricted = restrictMaintainerOutput_ACU(payload.maintainer ?? payload.arc, call.targetModules);
        if (restricted && deltaTouched_ACU(restricted.delta)) {
          const delta = payload.readRevisions
            ? mergeAgentDeltaRevisions_ACU(restricted.delta, payload.readRevisions)
            : restricted.delta;
          const applied = await applyAgentModuleDeltaViaSql_ACU(
            snapshot,
            delta,
            call.targetModules,
            input.settledIndex,
            input.completedStageNumbers,
            tolerantOptions_ACU(call.agentName),
          );
          snapshot = applied.snapshot;
          appliedModules.push(...applied.appliedModules);
        }
      } catch (error) {
        if (isStale_ACU(error)) throw error;
        for (const module of call.targetModules) {
          issues.push({ module, source: 'transaction_rejected', path: module, message: errorText_ACU(error) });
        }
      }
    } else {
      for (const module of call.targetModules) {
        issues.push({ module, source: 'invoke_failed', path: module, message: payload.summary || '定向补足子代理调用失败' });
      }
    }

    if (issues.length) {
      snapshot = recordWorkflowIssues_ACU(
        snapshot,
        issues,
        call.agentName,
        snapshot.materialCompletion.rangeStartIndex,
        Math.max(input.settledIndex, snapshot.materialCompletion.rangeEndIndex),
        payload.acceptedKeys,
      );
    }

    const completedWithoutIssue: Partial<Record<AgentWritableModule_ACU, Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'>>> = {};
    for (const module of call.targetModules) {
      const moduleIssues = issues.some(issue => issue.module === module);
      const touched = outputTouchesModule_ACU(payload, module);
      const applied = appliedModules.includes(module);
      const state = reported[module] ?? fallback;
      if (!moduleIssues && (applied || (!touched && state === 'complete_no_change'))) {
        completedWithoutIssue[module] = applied || state === 'complete_changed' ? 'complete_changed' : 'complete_no_change';
      }
    }
    snapshot = clearCompletedPending_ACU(snapshot, completedWithoutIssue);

    for (const module of call.targetModules) {
      const pending = snapshot.pendingFixes.some(item => item.module === module);
      const applied = appliedModules.includes(module);
      moduleStates[module] = pending ? (applied ? 'partial' : 'failed')
        : completedWithoutIssue[module] ?? (applied ? 'complete_changed' : 'complete_no_change');
    }
    const failed = call.targetModules.filter(module => moduleStates[module] === 'failed' || moduleStates[module] === 'partial');
    steps.push({
      agentName: call.agentName,
      status: failed.length ? 'failed' : payload.noChange ? 'no_change' : 'ok',
      summary: payload.summary || (failed.length ? `仍有待补模块：${failed.join(', ')}` : '定向补足完成'),
    });
  }

  const now = Date.now();
  const mergedModules = { ...snapshot.materialCompletion.modules, ...moduleStates };
  const targetSet = new Set(targets);
  const unresolvedLegacy = snapshot.materialCompletion.state === 'legacy_unknown'
    && (AGENT_WRITABLE_MODULES_ACU as readonly AgentWritableModule_ACU[])
      .some(module => !targetSet.has(module) && (mergedModules[module] === undefined || mergedModules[module] === 'legacy_unknown'));
  const repairedModules = targets.filter(module => moduleStates[module] === 'complete_changed' || moduleStates[module] === 'complete_no_change');
  const failedModules = targets.filter(module => !repairedModules.includes(module));
  const overall: AgentMaterialCompletionState_ACU = snapshot.pendingFixes.length
    ? (repairedModules.length ? 'partial' : 'failed')
    : unresolvedLegacy ? 'legacy_unknown'
      : Object.values(moduleStates).includes('complete_changed') ? 'complete_changed' : 'complete_no_change';
  snapshot = {
    ...snapshot,
    materialCompletion: { ...snapshot.materialCompletion, state: overall, modules: mergedModules, updatedAt: now },
    updatedAt: Math.max(snapshot.updatedAt, now),
  };
  return { snapshot, repairedModules, failedModules, steps };
}

export async function runContinuationAgentWorkflow_ACU(input: ContinuationWorkflowInput_ACU): Promise<ContinuationWorkflowResult_ACU> {
  let snapshot = input.snapshot;
  const steps: ContinuationWorkflowStep_ACU[] = [];
  const plannerNotes: string[] = [];
  const plannerRisks: string[] = [];
  let reviewerNote = '';
  const pendingRangeStarts = snapshot.pendingFixes.map(item => item.rangeStartIndex).filter(index => Number.isInteger(index) && index >= 0);
  const settlementStartIndex = pendingRangeStarts.length ? Math.min(...pendingRangeStarts) : Math.max(0, snapshot.settledThroughIndex + 1);
  const settlementEndIndex = input.settledIndex;

  const runSafe_ACU = async (call: ContinuationWorkflowAgentCall_ACU): Promise<ContinuationWorkflowAgentPayload_ACU> => {
    try {
      return await input.runAgent(call);
    } catch (error) {
      if (isStale_ACU(error)) throw error;
      return { ok: false, summary: errorText_ACU(error) };
    }
  };

  const applyMaintainerLike_ACU = async (
    output: AgentMaintainerOutput_ACU | null | undefined,
    writes: readonly string[],
    readRevisions: AgentModuleRevisions_ACU | undefined,
    agentName: string,
  ): Promise<AgentWritableModule_ACU[]> => {
    if (!output || !deltaTouched_ACU(output.delta)) return [];
    const delta = readRevisions ? mergeAgentDeltaRevisions_ACU(output.delta, readRevisions) : output.delta;
    const applied = await applyAgentModuleDeltaViaSql_ACU(snapshot, delta, writes, input.settledIndex, input.completedStageNumbers, tolerantOptions_ACU(agentName));
    snapshot = applied.snapshot;
    return applied.appliedModules;
  };

  if (input.opening.dispatchWebResearcher) {
    const web = await runSafe_ACU({
      agentName: WEB_NAME_ACU,
      billing: 'opening',
      repair: false,
      prompt: `开局要求补充外部设定。焦点：${input.opening.focus}`,
    });
    steps.push({ agentName: WEB_NAME_ACU, status: web.ok ? 'ok' : 'failed', summary: web.summary });
    if (web.ok && web.researcher && web.researcher.items.length) {
      const applied = await applyAgentWebRefsDeltaViaSql_ACU(
        snapshot,
        web.researcher,
        web.readRevisions?.webRefs,
        Date.now(),
        tolerantOptions_ACU(WEB_NAME_ACU),
      );
      snapshot = applied.snapshot;
    }
  }

  const maintainerPending = snapshot.pendingFixes.some(item =>
    (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module)
    && item.attempts < input.settings.workflow.autoFixMaxAttempts);
  if (!input.hasUnsettledHistory && !maintainerPending) {
    steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'no_change', summary: '没有未结算正文，也没有待修复的结算模块' });
  } else {
    const maintainer = await runSafe_ACU({
      agentName: MAINTAINER_NAME_ACU,
      billing: 'pipeline',
      repair: false,
      prompt: maintainerPrompt_ACU(input.opening.focus, snapshot, false),
    });
    const writes = (maintainer.writes ?? [...MAINTAINER_MODULES_ACU])
      .filter((module): module is AgentWritableModule_ACU => (MAINTAINER_MODULES_ACU as readonly string[]).includes(module));
    let completion: Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'> = maintainer.completion
      ?? (!maintainer.ok ? 'failed' : maintainer.noChange || !deltaTouched_ACU(maintainer.maintainer?.delta) ? 'complete_no_change' : 'complete_changed');
    let modules = completionModules_ACU(maintainer, writes, completion);
    const appliedModules = maintainer.ok
      ? await applyMaintainerLike_ACU(maintainer.maintainer, writes, maintainer.readRevisions, MAINTAINER_NAME_ACU)
      : [];
    const issues = [...(maintainer.unresolvedIssues ?? [])];
    if (!maintainer.ok && !issues.length) {
      for (const module of writes.length ? writes : [...MAINTAINER_MODULES_ACU]) {
        issues.push({ module, source: 'invoke_failed', path: module, message: maintainer.summary || '维护子代理调用失败' });
        modules[module] = 'failed';
      }
    }
    if (issues.length) {
      snapshot = recordWorkflowIssues_ACU(snapshot, issues, MAINTAINER_NAME_ACU, settlementStartIndex, settlementEndIndex, maintainer.acceptedKeys);
      completion = appliedModules.length ? 'partial' : 'failed';
    }
    const transactionPending = snapshot.pendingFixes.filter(item => writes.includes(item.module));
    if (transactionPending.length) {
      for (const fix of transactionPending) {
        const moduleAccepted = appliedModules.includes(fix.module) || acceptedKeysForModule_ACU(maintainer.acceptedKeys, fix.module).length > 0;
        modules[fix.module] = moduleAccepted ? 'partial' : 'failed';
      }
      completion = appliedModules.length ? 'partial' : 'failed';
    } else {
      snapshot = clearCompletedPending_ACU(snapshot, modules);
    }
    const now = Date.now();
    snapshot = {
      ...snapshot,
      materialCompletion: {
        state: completion,
        rangeStartIndex: settlementStartIndex,
        rangeEndIndex: settlementEndIndex,
        modules,
        updatedAt: now,
      },
      updatedAt: Math.max(snapshot.updatedAt, now),
    };
    if (completion === 'complete_changed' || completion === 'complete_no_change') {
      snapshot = { ...snapshot, settledThroughIndex: Math.max(snapshot.settledThroughIndex, input.settledIndex) };
    }
    if (!maintainer.ok || completion === 'failed') {
      steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'failed', summary: maintainer.summary });
    } else if (completion === 'complete_no_change') {
      steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'no_change', summary: maintainer.summary || '结算没有新事实' });
    } else if (completion === 'partial') {
      steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'failed', summary: `${maintainer.summary || '已保留部分资料'}；仍有待补条目` });
    } else {
      steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'ok', summary: maintainer.summary });
    }
  }

  const plannerCalls: ContinuationWorkflowAgentCall_ACU[] = [
    { agentName: MAINLINE_NAME_ACU, billing: 'pipeline', repair: false, prompt: `策划本轮场景。焦点：${input.opening.focus}` },
  ];
  if (input.beatObligation) {
    plannerCalls.push({ agentName: BEAT_NAME_ACU, billing: 'pipeline', repair: false, prompt: `本轮有伏笔操作义务。焦点：${input.opening.focus}` });
  } else {
    steps.push({ agentName: BEAT_NAME_ACU, status: 'skipped', summary: '本轮没有伏笔操作义务' });
  }
  const planners = await Promise.all(plannerCalls.map(call => runSafe_ACU(call)));
  for (let index = 0; index < planners.length; index += 1) {
    const planner = planners[index];
    steps.push({ agentName: plannerCalls[index].agentName, status: planner.ok ? 'ok' : 'failed', summary: planner.summary });
    if (planner.planner) {
      plannerNotes.push(planner.planner.recommendation);
      plannerRisks.push(...planner.planner.risks);
    }
  }

  const reviewRequired = continuationContinuityReviewRequired_ACU({
    majorTurn: input.majorTurn,
    recommendations: plannerNotes,
    risks: plannerRisks,
  });
  if (!reviewRequired) {
    steps.push({ agentName: REVIEWER_NAME_ACU, status: 'skipped', summary: '没有策划冲突或大转折' });
  } else {
    const reviewer = await runSafe_ACU({
      agentName: REVIEWER_NAME_ACU,
      billing: 'pipeline',
      repair: false,
      prompt: `审查策划是否冲突。焦点：${input.opening.focus}\n${plannerNotes.join('\n')}`,
    });
    steps.push({ agentName: REVIEWER_NAME_ACU, status: reviewer.ok ? 'ok' : 'failed', summary: reviewer.summary });
    if (reviewer.reviewer) reviewerNote = `${reviewer.reviewer.verdict} ${reviewer.reviewer.reason} ${reviewer.reviewer.fixes.join('；')}`;
  }

  const escalateBeforeRepair = needsPendingEscalation_ACU(snapshot, input.settings);
  const repairAgents = repairableAgents_ACU(snapshot, input.settings);
  const composerBase = [
    `本轮焦点：${input.opening.focus}`,
    input.opening.summary ? `开局摘要：${input.opening.summary}` : '',
    `策划建议：${plannerNotes.join('\n') || '无'}`,
    `审查结论：${reviewerNote || '未触发连续性审查'}`,
    `待修复：${formatFixes_ACU(snapshot.pendingFixes)}`,
    '通读结算后的资料、用户要求与活跃约束，产出本轮写作指令。',
  ].filter(Boolean).join('\n');

  const repairCalls = repairAgents.map(agentName => {
    const targetModules = repairModulesForAgent_ACU(snapshot, agentName);
    const targetFixes = snapshot.pendingFixes.filter(item => targetModules.includes(item.module));
    return {
      agentName,
      billing: 'repair' as const,
      repair: true,
      targetModules,
      prompt: `自动修复。程序只接受这些待补模块：${targetModules.join(', ') || '无'}。${formatFixes_ACU(targetFixes)}`,
    };
  });
  const repairPromise = Promise.all(repairCalls.map(call => runSafe_ACU(call)));
  const composerPromise = input.runComposer({ prompt: composerBase, revisionFeedback: '', priorInstruction: '' }).catch(error => {
    if (isStale_ACU(error)) throw error;
    const failed: AgentComposerOutput_ACU = { instruction: '', summary: errorText_ACU(error), constraints: null };
    return failed;
  });
  const [repairs, composer] = await Promise.all([repairPromise, composerPromise]);
  for (let index = 0; index < repairs.length; index += 1) {
    const repair = repairs[index];
    const agentName = repairAgents[index] ?? 'repair';
    steps.push({ agentName, status: repair.ok ? 'ok' : 'failed', summary: repair.summary });
    if (!repair.ok) continue;
    const targetModules = repairCalls[index]?.targetModules ?? [];
    if (repair.researcher && targetModules.includes('webRefs')) {
      snapshot = (await applyAgentWebRefsDeltaViaSql_ACU(snapshot, repair.researcher, repair.readRevisions?.webRefs, Date.now(), tolerantOptions_ACU(agentName))).snapshot;
    }
    const restricted = restrictMaintainerOutput_ACU(repair.maintainer ?? repair.arc, targetModules);
    await applyMaintainerLike_ACU(restricted, targetModules, repair.readRevisions, agentName);
  }
  steps.push({
    agentName: AGENT_INSTRUCTION_COMPOSER_NAME_ACU,
    status: composer.instruction.trim() ? 'ok' : 'failed',
    summary: composer.summary || (composer.instruction.trim() ? '已产出写作指令' : 'instruction 为空'),
  });
  if (composer.constraints) {
    snapshot = (await applyAgentConstraintRegistrationViaSql_ACU(
      snapshot,
      composer.constraints.add,
      composer.constraints.retire,
      input.settledIndex,
      tolerantOptions_ACU(AGENT_INSTRUCTION_COMPOSER_NAME_ACU),
    )).snapshot;
  }

  if (escalateBeforeRepair || needsPendingEscalation_ACU(snapshot, input.settings)) {
    const summary = `工作流停止交付，待修复模块需要主会话处理：${snapshot.pendingFixes.map(item => `${item.module}(${item.attempts})`).join('、') || '自动修复已关闭'}`;
    return {
      outcome: 'escalate',
      summary,
      instruction: '',
      pendingFixes: snapshot.pendingFixes,
      escalated: true,
      escalationKind: 'pending_fix',
      snapshot,
      steps,
    };
  }

  let instruction = composer.instruction.trim();
  if (!instruction) {
    return {
      outcome: 'escalate',
      summary: composer.summary || 'instruction-composer 没有产出非空写作指令',
      instruction: '',
      pendingFixes: snapshot.pendingFixes,
      escalated: true,
      escalationKind: 'final_review',
      snapshot,
      steps,
    };
  }

  if (input.settings.finalReview.enabled) {
    let failures = 0;
    const limit = input.settings.workflow.reviseLimit;
    while (failures < limit) {
      let review: AgentFinalReviewerOutput_ACU;
      try {
        review = await input.runFinalReview(instruction, composer.summary);
      } catch (error) {
        if (isStale_ACU(error)) throw error;
        failures += 1;
        steps.push({ agentName: 'final-reviewer', status: 'failed', summary: errorText_ACU(error) });
        if (failures >= limit) break;
        continue;
      }
      if (review.verdict === 'pass') {
        steps.push({ agentName: 'final-reviewer', status: 'ok', summary: review.summary || 'pass' });
        failures = 0;
        break;
      }
      failures += 1;
      steps.push({ agentName: 'final-reviewer', status: 'failed', summary: `${review.verdict}：${review.requiredFixes.join('；') || review.summary}` });
      if (failures >= limit) break;
      let revised: AgentComposerOutput_ACU;
      try {
        revised = await input.runComposer({
          prompt: `按反馈清单增量修订，不要全量重写。\n原指令：\n${instruction}`,
          revisionFeedback: review.requiredFixes.join('\n'),
          priorInstruction: instruction,
        });
      } catch (error) {
        if (isStale_ACU(error)) throw error;
        failures += 1;
        steps.push({ agentName: AGENT_INSTRUCTION_COMPOSER_NAME_ACU, status: 'failed', summary: errorText_ACU(error) });
        continue;
      }
      if (!revised.instruction.trim()) {
        failures += 1;
        steps.push({ agentName: AGENT_INSTRUCTION_COMPOSER_NAME_ACU, status: 'failed', summary: '修订后的 instruction 为空' });
        continue;
      }
      instruction = revised.instruction.trim();
      if (revised.constraints) {
        snapshot = (await applyAgentConstraintRegistrationViaSql_ACU(
          snapshot,
          revised.constraints.add,
          revised.constraints.retire,
          input.settledIndex,
          tolerantOptions_ACU(AGENT_INSTRUCTION_COMPOSER_NAME_ACU),
       )).snapshot;
      }
      steps.push({ agentName: AGENT_INSTRUCTION_COMPOSER_NAME_ACU, status: 'ok', summary: '已按反馈增量修订' });
    }
    if (failures >= limit) {
      return {
        outcome: 'escalate',
        summary: `终审连续 ${limit} 次未通过，已升级主会话`,
        instruction: '',
        pendingFixes: snapshot.pendingFixes,
        escalated: true,
        escalationKind: 'final_review',
        snapshot,
        steps,
      };
    }
  }

  return {
    outcome: 'deliver',
    summary: composer.summary || input.opening.summary || '固定工作流已交付写作指令',
    instruction,
    pendingFixes: snapshot.pendingFixes,
    escalated: false,
    escalationKind: '',
    snapshot,
    steps,
  };
}
