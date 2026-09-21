import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log'; // arch-ok: 仅类型导入，进度卡从会话 kinds 推导展示阶段

export const WORLD_SIMULATION_PROGRESS_LABELS_ACU = {
  survey: '世界线测绘',
  intel: '信息取证',
  backstage: '幕后演算',
  review: '因果审核',
  anchor: '现实锚定',
  completed: '推演完成',
  interrupted: '推演中断',
} as const;

export type WorldSimulationProgressPhase_ACU = keyof typeof WORLD_SIMULATION_PROGRESS_LABELS_ACU;

export interface WorldSimulationProgressView_ACU {
  visible: boolean;
  phase: WorldSimulationProgressPhase_ACU | null;
  label: string;
  concurrent: number;
  terminal: boolean;
}

function isReviewerEntry_ACU(entry: WorldSimulationSessionEntry_ACU): boolean {
  return entry.agentName === 'causality-reviewer';
}

function currentRunEntries_ACU(entries: readonly WorldSimulationSessionEntry_ACU[]): WorldSimulationSessionEntry_ACU[] {
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].kind === 'run_started' || entries[index].kind === 'run_resumed') {
      start = index;
      break;
    }
  }
  return entries.slice(start);
}

function hiddenView_ACU(): WorldSimulationProgressView_ACU {
  return { visible: false, phase: null, label: '', concurrent: 0, terminal: false };
}

/**
 * 从最近一次 run 的 session entries 推导浮卡阶段。不读 patch 正文，不暴露角色内部名。
 * 无独立 stage_plan 时跳过「世界线测绘」。
 */
export function deriveWorldSimulationProgressView_ACU(
  entries: readonly WorldSimulationSessionEntry_ACU[],
  running: boolean,
): WorldSimulationProgressView_ACU {
  const run = currentRunEntries_ACU(entries);
  const last = run[run.length - 1];
  if (!running) {
    if (last?.kind === 'run_completed') {
      return { visible: true, phase: 'completed', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.completed, concurrent: 0, terminal: true };
    }
    if (last?.kind === 'run_failed' || last?.kind === 'block') {
      return { visible: true, phase: 'interrupted', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.interrupted, concurrent: 0, terminal: true };
    }
    return hiddenView_ACU();
  }

  const runningSpecialists = run.filter(item => item.kind === 'delegation' && !isReviewerEntry_ACU(item) && item.status === 'running');
  const reviewerRunning = run.some(item => isReviewerEntry_ACU(item) && item.status === 'running');
  const lastIsFinalize = last?.kind === 'finalize' || (last?.kind === 'main_action' && /finalize/.test(last.title));

  if (lastIsFinalize) {
    return { visible: true, phase: 'anchor', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.anchor, concurrent: 0, terminal: false };
  }
  if (reviewerRunning || (last && isReviewerEntry_ACU(last))) {
    return { visible: true, phase: 'review', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.review, concurrent: 0, terminal: false };
  }
  if (runningSpecialists.length) {
    const concurrent = runningSpecialists.length;
    return { visible: true, phase: 'backstage', label: `${WORLD_SIMULATION_PROGRESS_LABELS_ACU.backstage} · ${concurrent} 路并行`, concurrent, terminal: false };
  }
  if (last?.kind === 'stage_plan' || (run.some(item => item.kind === 'stage_plan') && !run.some(item => item.kind === 'main_action' || item.kind === 'tool_read' || item.kind === 'delegation'))) {
    return { visible: true, phase: 'survey', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.survey, concurrent: 0, terminal: false };
  }
  return { visible: true, phase: 'intel', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.intel, concurrent: 0, terminal: false };
}
