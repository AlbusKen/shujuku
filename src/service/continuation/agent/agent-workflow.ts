/**
 * service/continuation/agent/agent-workflow.ts — 续写固定工作流
 *
 * 程序按固定顺序驱动结算、策划、条件审查、容错提交、自动修复与写作指令编排。
 * 主会话只提供开局参数，不再逐个派这些角色。模型调用通过端口注入，便于单测。
 */

import { ContinuationValidationError_ACU } from '../model';
import type { ContinuationSettings_ACU } from '../model';
import {
  AGENT_INSTRUCTION_COMPOSER_NAME_ACU,
  type AgentComposerOutput_ACU,
  type AgentFinalReviewerOutput_ACU,
  type AgentMaintainerOutput_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentPendingFix_ACU,
  type AgentPlannerOutput_ACU,
  type AgentResearcherOutput_ACU,
  type AgentReviewerOutput_ACU,
} from './agent-model';
import {
  applyAgentConstraintRegistration_ACU,
  applyAgentModuleDelta_ACU,
  applyAgentWebRefsDelta_ACU,
  mergeAgentDeltaRevisions_ACU,
  type AgentModuleApplyOptions_ACU,
} from './agent-transaction';

export interface ContinuationWorkflowOpening_ACU {
  focus: string;
  summary: string;
  dispatchArcArchitect: boolean;
  dispatchWebResearcher: boolean;
}

export type ContinuationWorkflowBilling_ACU = 'pipeline' | 'opening' | 'repair';

export interface ContinuationWorkflowAgentCall_ACU {
  agentName: string;
  prompt: string;
  billing: ContinuationWorkflowBilling_ACU;
  repair: boolean;
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

const MAINTAINER_NAME_ACU = 'hook-cognition-maintainer';
const MAINLINE_NAME_ACU = 'mainline-planner';
const BEAT_NAME_ACU = 'beat-planner';
const REVIEWER_NAME_ACU = 'continuity-reviewer';
const ARC_NAME_ACU = 'arc-architect';
const WEB_NAME_ACU = 'web-researcher';
const MAINTAINER_MODULES_ACU = ['hooks', 'infoGap', 'chronology'] as const;
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

function needsPendingEscalation_ACU(snapshot: AgentModuleSnapshot_ACU, settings: ContinuationSettings_ACU): boolean {
  if (!snapshot.pendingFixes.length) return false;
  if (!settings.workflow.autoFixEnabled) return true;
  return snapshot.pendingFixes.some(item => item.attempts >= settings.workflow.autoFixMaxAttempts);
}

function formatFixes_ACU(fixes: readonly AgentPendingFix_ACU[]): string {
  if (!fixes.length) return '无';
  return fixes.map(item => `${item.module} 第 ${item.attempts} 次：${item.violations.map(violation => violation.message).join('；') || item.lastError}`).join(' | ');
}

function maintainerPrompt_ACU(focus: string, snapshot: AgentModuleSnapshot_ACU, repair: boolean): string {
  const fixes = snapshot.pendingFixes.filter(item => (MAINTAINER_MODULES_ACU as readonly string[]).includes(item.module));
  return [
    repair ? '这是独立预算的自动修复。只提交违规模块的增量 patch，不要重写无关模块。' : `本轮焦点：${focus}`,
    '结算已经发生的正文。没有新事实时 delta 留空并在 summary 写明 no_change。',
    `待修复：${formatFixes_ACU(fixes)}`,
  ].join('\n');
}

export async function runContinuationAgentWorkflow_ACU(input: ContinuationWorkflowInput_ACU): Promise<ContinuationWorkflowResult_ACU> {
  let snapshot = input.snapshot;
  const steps: ContinuationWorkflowStep_ACU[] = [];
  const plannerNotes: string[] = [];
  const plannerRisks: string[] = [];
  let reviewerNote = '';

  const runSafe_ACU = async (call: ContinuationWorkflowAgentCall_ACU): Promise<ContinuationWorkflowAgentPayload_ACU> => {
    try {
      return await input.runAgent(call);
    } catch (error) {
      if (isStale_ACU(error)) throw error;
      return { ok: false, summary: errorText_ACU(error) };
    }
  };

  const applyMaintainerLike_ACU = (
    output: AgentMaintainerOutput_ACU | null | undefined,
    writes: readonly string[],
    readRevisions: AgentModuleRevisions_ACU | undefined,
    agentName: string,
  ): void => {
    if (!output || !deltaTouched_ACU(output.delta)) return;
    const delta = readRevisions ? mergeAgentDeltaRevisions_ACU(output.delta, readRevisions) : output.delta;
    const applied = applyAgentModuleDelta_ACU(snapshot, delta, writes, input.settledIndex, input.completedStageNumbers, tolerantOptions_ACU(agentName));
    snapshot = applied.snapshot;
  };

  if (input.opening.dispatchArcArchitect) {
    const arc = await runSafe_ACU({
      agentName: ARC_NAME_ACU,
      billing: 'opening',
      repair: false,
      prompt: `开局要求维护总纲。焦点：${input.opening.focus}`,
    });
    steps.push({ agentName: ARC_NAME_ACU, status: arc.ok ? 'ok' : 'failed', summary: arc.summary });
    if (arc.ok) applyMaintainerLike_ACU(arc.arc, arc.writes ?? ['storyArc'], arc.readRevisions, ARC_NAME_ACU);
  }
  if (input.opening.dispatchWebResearcher) {
    const web = await runSafe_ACU({
      agentName: WEB_NAME_ACU,
      billing: 'opening',
      repair: false,
      prompt: `开局要求补充外部设定。焦点：${input.opening.focus}`,
    });
    steps.push({ agentName: WEB_NAME_ACU, status: web.ok ? 'ok' : 'failed', summary: web.summary });
    if (web.ok && web.researcher && web.researcher.items.length) {
      const applied = applyAgentWebRefsDelta_ACU(
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
    if (!maintainer.ok) {
      steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'failed', summary: maintainer.summary });
    } else if (maintainer.noChange || !deltaTouched_ACU(maintainer.maintainer?.delta)) {
      steps.push({ agentName: MAINTAINER_NAME_ACU, status: 'no_change', summary: maintainer.summary || '结算没有新事实' });
      snapshot = { ...snapshot, settledThroughIndex: Math.max(snapshot.settledThroughIndex, input.settledIndex) };
    } else {
      applyMaintainerLike_ACU(maintainer.maintainer, maintainer.writes ?? ['hooks', 'infoGap', 'chronology'], maintainer.readRevisions, MAINTAINER_NAME_ACU);
      snapshot = { ...snapshot, settledThroughIndex: Math.max(snapshot.settledThroughIndex, input.settledIndex) };
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

  const repairPromise = Promise.all(repairAgents.map(agentName => runSafe_ACU({
    agentName,
    billing: 'repair',
    repair: true,
    prompt: `自动修复。只提交违规模块。${formatFixes_ACU(snapshot.pendingFixes)}`,
  })));
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
    if (repair.researcher) {
      snapshot = applyAgentWebRefsDelta_ACU(snapshot, repair.researcher, repair.readRevisions?.webRefs, Date.now(), tolerantOptions_ACU(agentName)).snapshot;
    }
    applyMaintainerLike_ACU(repair.maintainer ?? repair.arc, repair.writes ?? [], repair.readRevisions, agentName);
  }
  steps.push({
    agentName: AGENT_INSTRUCTION_COMPOSER_NAME_ACU,
    status: composer.instruction.trim() ? 'ok' : 'failed',
    summary: composer.summary || (composer.instruction.trim() ? '已产出写作指令' : 'instruction 为空'),
  });
  if (composer.constraints) {
    snapshot = applyAgentConstraintRegistration_ACU(
      snapshot,
      composer.constraints.add,
      composer.constraints.retire,
      input.settledIndex,
      tolerantOptions_ACU(AGENT_INSTRUCTION_COMPOSER_NAME_ACU),
    ).snapshot;
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
        snapshot = applyAgentConstraintRegistration_ACU(
          snapshot,
          revised.constraints.add,
          revised.constraints.retire,
          input.settledIndex,
          tolerantOptions_ACU(AGENT_INSTRUCTION_COMPOSER_NAME_ACU),
        ).snapshot;
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
