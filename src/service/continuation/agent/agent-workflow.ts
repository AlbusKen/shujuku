/**
 * service/continuation/agent/agent-workflow.ts — 续写固定工作流
 *
 * 程序按固定顺序驱动结算、策划、容错提交与写作指令编排。
 * 主会话只提供开局参数，不再逐个派这些角色。模型调用通过端口注入，便于单测。
 */

import { ContinuationValidationError_ACU } from '../model';
import type { ContinuationSettings_ACU } from '../model';
import {
  AGENT_INSTRUCTION_COMPOSER_NAME_ACU,
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

export type ContinuationWorkflowBilling_ACU = 'pipeline' | 'opening';

export interface ContinuationWorkflowAgentCall_ACU {
  agentName: string;
  prompt: string;
  billing: ContinuationWorkflowBilling_ACU;
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
  usedFieldWrites?: boolean;
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
  turnNumber: number;
  settledIndex: number;
  /** 本轮实际注入的正文起点；缺省保留既有完整结算语义。 */
  settlementStartIndex?: number;
  /** 窗口外仍有未处理正文时，不得推进连续结算水位。 */
  canAdvanceSettlement?: boolean;
  completedStageNumbers: readonly number[];
  evidenceFloorIndexes?: ReadonlySet<number>;
  runAgent: (call: ContinuationWorkflowAgentCall_ACU) => Promise<ContinuationWorkflowAgentPayload_ACU>;
  readCommittedSnapshot?: () => AgentModuleSnapshot_ACU;
  runComposer: (call: { prompt: string; revisionFeedback: string; priorInstruction: string }) => Promise<AgentComposerOutput_ACU>;
  runFinalReview: (instruction: string, summary: string) => Promise<AgentFinalReviewerOutput_ACU>;
}

const MAINTAINER_NAME_ACU = 'hook-cognition-maintainer';
const MAINLINE_NAME_ACU = 'mainline-planner';
const BEAT_NAME_ACU = 'beat-planner';
const ARC_NAME_ACU = 'arc-architect';
const WEB_NAME_ACU = 'web-researcher';
const MAINTAINER_MODULES_ACU = ['hooks', 'infoGap', 'chronology'] as const;
const BEAT_OBLIGATION_PATTERN_ACU = /伏笔|埋设|回收|误导|信息差|揭示/;

export function continuationBeatObligation_ACU(turn: { goal?: string; function?: string } | null): boolean {
  if (!turn) return false;
  if (turn.function === 'payoff' || turn.function === 'reveal') return true;
  return BEAT_OBLIGATION_PATTERN_ACU.test(turn.goal ?? '');
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
    || delta.storyArc.length || delta.storyArcPatches.length || delta.chronology.length || delta.chronologyPatches.length,
  );
}

function formatFixes_ACU(fixes: readonly AgentPendingFix_ACU[]): string {
  if (!fixes.length) return '无';
  return fixes.map(item => `${item.module} 第 ${item.attempts} 次：${item.violations.map(violation => `${violation.path}: ${violation.message}`).join('；') || item.lastError}`).join(' | ');
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
  rangeStartIndex: number,
  rangeEndIndex: number,
): AgentModuleSnapshot_ACU {
  const completed = new Set(Object.entries(modules)
    .filter(([, state]) => state === 'complete_changed' || state === 'complete_no_change')
    .map(([module]) => module));
  if (!completed.size) return snapshot;
  return { ...snapshot, pendingFixes: snapshot.pendingFixes.filter(item => !completed.has(item.module)
    || !pendingWithinSettlement_ACU(item, rangeStartIndex, rangeEndIndex)) };
}

function pendingWithinSettlement_ACU(item: AgentPendingFix_ACU, start: number, end: number): boolean {
  return start <= end && (item.rangeStartIndex ?? start) >= start && (item.rangeEndIndex ?? end) <= end;
}

function maintainerPrompt_ACU(focus: string, snapshot: AgentModuleSnapshot_ACU): string {
  const fixes = snapshot.pendingFixes.filter(item => (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module));
  return [
    `本轮焦点：${focus}`,
    '只逐楼结算 $HISTORY_UNSETTLED 实际提供的窗口内正文；窗口外省略内容不得宣称已读或已结算。没有新事实时 delta 留空并在 summary 写明 no_change。',
    `待修复：${formatFixes_ACU(fixes)}`,
  ].join('\n');
}

export async function runContinuationAgentWorkflow_ACU(input: ContinuationWorkflowInput_ACU): Promise<ContinuationWorkflowResult_ACU> {
  let snapshot = input.snapshot;
  const steps: ContinuationWorkflowStep_ACU[] = [];
  const plannerNotes: string[] = [];
  const pendingRangeStarts = snapshot.pendingFixes.map(item => item.rangeStartIndex).filter(index => Number.isInteger(index) && index >= 0);
  const settlementStartIndex = input.settlementStartIndex
    ?? (pendingRangeStarts.length ? Math.min(...pendingRangeStarts) : Math.max(0, snapshot.settledThroughIndex + 1));
  const settlementEndIndex = input.settledIndex;
  const previousCompletion = snapshot.materialCompletion;
  // 事务的旧路径会按模块清账；本轮未覆盖的缺口必须原样保留。
  const outsidePending = snapshot.pendingFixes.filter(item => !pendingWithinSettlement_ACU(item, settlementStartIndex, settlementEndIndex));
  const restoreOutsidePending_ACU = () => {
    const pendingFixes = [...snapshot.pendingFixes];
    for (const previous of outsidePending) {
      const index = pendingFixes.findIndex(item => item.module === previous.module);
      if (index < 0) { pendingFixes.push(previous); continue; }
      const current = pendingFixes[index];
      if (current === previous) continue;
      pendingFixes[index] = {
        ...current,
        attempts: Math.max(previous.attempts, current.attempts),
        firstFailedAtIndex: Math.min(previous.firstFailedAtIndex, current.firstFailedAtIndex),
        rangeStartIndex: Math.min(previous.rangeStartIndex ?? previous.firstFailedAtIndex, current.rangeStartIndex ?? settlementStartIndex),
        rangeEndIndex: Math.max(previous.rangeEndIndex ?? settlementEndIndex, current.rangeEndIndex ?? settlementEndIndex),
        violations: [...previous.violations, ...current.violations.filter(issue =>
          !previous.violations.some(old => old.path === issue.path && old.message === issue.message))],
        acceptedKeys: [...new Set([...(previous.acceptedKeys ?? []), ...(current.acceptedKeys ?? [])])],
        createdAt: previous.createdAt ?? current.createdAt,
      };
    }
    snapshot = { ...snapshot, pendingFixes };
  };

  const runSafe_ACU = async (call: ContinuationWorkflowAgentCall_ACU): Promise<ContinuationWorkflowAgentPayload_ACU> => {
    try {
      const result = await input.runAgent(call);
      if ((result.usedFieldWrites || result.acceptedKeys?.length) && input.readCommittedSnapshot) snapshot = input.readCommittedSnapshot();
      return result;
    } catch (error) {
      if (isStale_ACU(error)) throw error;
      const details = error instanceof ContinuationValidationError_ACU ? error.error.details : undefined;
      const unresolvedIssues = Array.isArray(details?.unresolvedIssues)
        ? details.unresolvedIssues as ContinuationWorkflowUnresolvedIssue_ACU[] : undefined;
      return { ok: false, summary: errorText_ACU(error), unresolvedIssues,
        acceptedKeys: Array.isArray(details?.acceptedKeys) ? details.acceptedKeys as string[] : undefined };
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
    const applied = await applyAgentModuleDeltaViaSql_ACU(snapshot, delta, writes, input.settledIndex, input.completedStageNumbers, tolerantOptions_ACU(agentName), input.evidenceFloorIndexes);
    snapshot = applied.snapshot;
    restoreOutsidePending_ACU();
    return applied.appliedModules;
  };

  // 开局检索与首轮结算并发：两者写集不相交（webRefs vs 结算模块）、互不消费，
  // 与主会话派工波次同一并发语义；结果落定后仍按「先百科、后结算」的原顺序应用到快照。
  const openingWeb = input.opening.dispatchWebResearcher
    ? runSafe_ACU({
      agentName: WEB_NAME_ACU,
      billing: 'opening',
      prompt: `开局要求补充外部设定。焦点：${input.opening.focus}`,
    })
    : null;
  const maintainerPending = snapshot.pendingFixes.some(item =>
    (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module)
    && pendingWithinSettlement_ACU(item, settlementStartIndex, settlementEndIndex));
  const runFirstMaintainer = input.hasUnsettledHistory || maintainerPending;
  const firstMaintainer = runFirstMaintainer
    ? runSafe_ACU({
      agentName: MAINTAINER_NAME_ACU,
      billing: 'pipeline',
      prompt: maintainerPrompt_ACU(input.opening.focus, { ...snapshot,
        pendingFixes: snapshot.pendingFixes.filter(item => pendingWithinSettlement_ACU(item, settlementStartIndex, settlementEndIndex)) }),
    })
    : null;
  const [web, firstMaintainerResult] = await Promise.all([openingWeb, firstMaintainer]);
  // 并发批次落定后统一回读权威快照：任一方的逐栏写入都不会被另一方的旧快照覆盖。
  if (input.readCommittedSnapshot) snapshot = input.readCommittedSnapshot();

  if (web) {
    steps.push({ agentName: WEB_NAME_ACU, status: web.ok ? 'ok' : 'failed', summary: web.summary });
    if (web.ok && !web.usedFieldWrites && web.researcher && (web.researcher.items.length || (web.researcher.patches ?? []).length)) {
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

  if (!runFirstMaintainer) {
    steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'no_change', summary: '没有未结算正文，也没有待修复的结算模块' });
  } else {
    let maintainer = firstMaintainerResult!;
    let repairAttempts = 0;
    const maxRepairAttempts = Math.max(0, input.settings.workflow.reviseLimit);
    while (true) {
      const writes = (maintainer.writes ?? [...MAINTAINER_MODULES_ACU])
        .filter((module): module is AgentWritableModule_ACU => (MAINTAINER_MODULES_ACU as readonly string[]).includes(module));
      let completion: Exclude<AgentMaterialCompletionState_ACU, 'legacy_unknown'> = maintainer.completion
        ?? (!maintainer.ok ? 'failed' : maintainer.noChange || !deltaTouched_ACU(maintainer.maintainer?.delta) ? 'complete_no_change' : 'complete_changed');
      let modules = completionModules_ACU(maintainer, writes, completion);
      const appliedModules = maintainer.ok
        ? await applyMaintainerLike_ACU(maintainer.usedFieldWrites ? null : maintainer.maintainer, writes, maintainer.readRevisions, MAINTAINER_NAME_ACU)
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
      if (maintainer.ok && maintainer.usedFieldWrites) {
        // 逐栏写入事务保留旧 pendingFixes（见 agent-module-field-commit），delta 路径不会走到这里。
        // 运行时已按权威折叠状态核对缺栏与拒绝，本轮没有新问题的已完成模块在此清账，避免旧缺口每轮升级。
        const unresolvedModules = new Set<string>(issues.map(item => item.module));
        snapshot = clearCompletedPending_ACU(snapshot, Object.fromEntries(Object.entries(modules)
          .filter(([module]) => !unresolvedModules.has(module))) as typeof modules, settlementStartIndex, settlementEndIndex);
      }
      const transactionPending = snapshot.pendingFixes.filter(item => writes.includes(item.module)
        && pendingWithinSettlement_ACU(item, settlementStartIndex, settlementEndIndex));
      if (transactionPending.length) {
        for (const fix of transactionPending) {
          const moduleAccepted = appliedModules.includes(fix.module) || acceptedKeysForModule_ACU(maintainer.acceptedKeys, fix.module).length > 0;
          modules[fix.module] = moduleAccepted ? 'partial' : 'failed';
        }
        completion = appliedModules.length ? 'partial' : 'failed';
      } else {
        snapshot = clearCompletedPending_ACU(snapshot, modules, settlementStartIndex, settlementEndIndex);
      }
      restoreOutsidePending_ACU();
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
        // 最近窗口可以完成，但这不等于此前所有正文都已处理。
        if (input.canAdvanceSettlement !== false && !outsidePending.some(item =>
          (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module))) {
          snapshot = { ...snapshot, settledThroughIndex: Math.max(snapshot.settledThroughIndex, input.settledIndex) };
        }
        if (previousCompletion && (previousCompletion.state === 'complete_changed' || previousCompletion.state === 'complete_no_change')
          && previousCompletion.rangeStartIndex >= 0
          && previousCompletion.rangeEndIndex >= previousCompletion.rangeStartIndex
          && previousCompletion.rangeEndIndex + 1 >= settlementStartIndex
          && previousCompletion.rangeStartIndex <= settlementEndIndex + 1) {
          snapshot = { ...snapshot, materialCompletion: { ...snapshot.materialCompletion,
            rangeStartIndex: Math.min(previousCompletion.rangeStartIndex, settlementStartIndex),
            rangeEndIndex: Math.max(previousCompletion.rangeEndIndex, settlementEndIndex) } };
        }
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
      const repairPending = snapshot.pendingFixes.filter(item =>
        (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module)
        && pendingWithinSettlement_ACU(item, settlementStartIndex, settlementEndIndex)
        && item.source !== 'truncated');
      if (!repairPending.length || repairAttempts >= maxRepairAttempts) break;
      repairAttempts += 1;
      const repairModules = [...new Set(repairPending.map(item => item.module))];
      maintainer = await runSafe_ACU({
        agentName: MAINTAINER_NAME_ACU,
        billing: 'pipeline',
        targetModules: repairModules,
        prompt: [
          `上一轮资料写入仍有待修复项（第 ${repairAttempts} 次定向修正）：`,
          formatFixes_ACU(repairPending),
          '只修复上述模块和字段；不要重发已成功保存的其它模块。先 read 对应权威模块，再提交最小 write_sql；仍无法确定时明确返回 unresolvedIssues。',
        ].join('\n'),
      });
    }
  }

  const plannerCalls: ContinuationWorkflowAgentCall_ACU[] = [
    { agentName: MAINLINE_NAME_ACU, billing: 'pipeline', prompt: `策划本轮场景。焦点：${input.opening.focus}` },
  ];
  // 编排不变量：mainline-planner 与 beat-planner 写集不相交、判定互不依赖，属同层并发批（Promise.all）；
  // beat-planner 第二轮起保底派遣，是否操作由其 no_change 出口判断，仅首轮且无义务时跳过。
  if (input.turnNumber >= 2 || input.beatObligation) {
    plannerCalls.push({ agentName: BEAT_NAME_ACU, billing: 'pipeline', prompt: `策划本轮伏笔操作与情绪节拍；本轮没有真实需要时明确 no_change，不虚构钩子。焦点：${input.opening.focus}` });
  } else {
    steps.push({ agentName: BEAT_NAME_ACU, status: 'skipped', summary: '首轮且无伏笔义务，节拍策划跳过' });
  }
  const planners = await Promise.all(plannerCalls.map(call => runSafe_ACU(call)));
  for (let index = 0; index < planners.length; index += 1) {
    const planner = planners[index];
    steps.push({ agentName: plannerCalls[index].agentName, status: planner.ok ? 'ok' : 'failed', summary: planner.summary });
    if (planner.planner) {
      plannerNotes.push(planner.planner.recommendation);
    }
  }

  const composerBase = [
    `本轮焦点：${input.opening.focus}`,
    input.opening.summary ? `开局摘要：${input.opening.summary}` : '',
    `策划建议：${plannerNotes.join('\n') || '无'}`,
    `待修复：${formatFixes_ACU(snapshot.pendingFixes)}`,
    '通读结算后的资料、用户要求与活跃约束，产出本轮写作指令。产出前自查：策划建议之间是否互相冲突、是否与本轮 pacing 冲突、是否与已结算的硬事实/长期约束冲突；发现冲突时取更保守的一方并在 summary 注明取舍，不得原样拼接两份矛盾建议。',
  ].filter(Boolean).join('\n');

  const composer = await input.runComposer({ prompt: composerBase, revisionFeedback: '', priorInstruction: '' }).catch(error => {
    if (isStale_ACU(error)) throw error;
    const failed: AgentComposerOutput_ACU = { instruction: '', summary: errorText_ACU(error), constraints: null };
    return failed;
  });
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

  if (snapshot.pendingFixes.length) {
    const summary = `工作流停止交付，待修复模块需要主会话处理：${snapshot.pendingFixes.map(item => `${item.module}(${item.attempts})`).join('、') || '无'}`;
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
