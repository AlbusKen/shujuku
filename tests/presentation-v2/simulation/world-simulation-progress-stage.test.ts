import { describe, expect, it } from 'vitest';
import type { WorldSimulationSessionEntry_ACU } from '../../../src/service/simulation/agent/agent-session-log';
import {
  deriveWorldSimulationProgressView_ACU,
  WORLD_SIMULATION_PROGRESS_LABELS_ACU,
} from '../../../src/presentation-v2/simulation/world-simulation-progress-stage';

function entry(overrides: Partial<WorldSimulationSessionEntry_ACU> = {}): WorldSimulationSessionEntry_ACU {
  return {
    id: 1,
    at: 1,
    kind: 'run_started',
    title: '世界推演 Agent 运行',
    detail: '',
    agentName: 'world-director',
    ok: true,
    status: 'done',
    ...overrides,
  };
}

describe('deriveWorldSimulationProgressView_ACU', () => {
  it('运行中且无独立 stage_plan 时跳过世界线测绘，直接进入信息取证', () => {
    const view = deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'main_action', title: '主 Agent 第 1 轮正在工作', status: 'running' }),
    ], true);
    expect(view).toMatchObject({
      visible: true,
      phase: 'intel',
      label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.intel,
      concurrent: 0,
      terminal: false,
    });
  });

  it('仅有 stage_plan 时显示世界线测绘', () => {
    const view = deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'stage_plan', title: '阶段计划就绪', agentName: 'world-stage-planner', status: 'done' }),
    ], true);
    expect(view).toMatchObject({ visible: true, phase: 'survey', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.survey });
  });

  it('specialist 并行派工显示幕后演算路数，审核员不计入并行', () => {
    const view = deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'delegation', title: 'timekeeper 正在工作', agentName: 'timekeeper', status: 'running' }),
      entry({ id: 3, kind: 'delegation', title: 'undercurrent-analyst 正在工作', agentName: 'undercurrent-analyst', status: 'running' }),
      entry({ id: 4, kind: 'delegation', title: '因果审核正在工作', agentName: 'causality-reviewer', status: 'running' }),
    ], true);
    expect(view).toMatchObject({
      visible: true,
      phase: 'review',
      label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.review,
      concurrent: 0,
    });
  });

  it('仅 specialist 运行时显示幕后演算并行路数', () => {
    const view = deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'delegation', title: 'timekeeper 正在工作', agentName: 'timekeeper', status: 'running' }),
      entry({ id: 3, kind: 'delegation', title: 'dramatis-keeper 正在工作', agentName: 'dramatis-keeper', status: 'running' }),
    ], true);
    expect(view).toMatchObject({
      visible: true,
      phase: 'backstage',
      label: `${WORLD_SIMULATION_PROGRESS_LABELS_ACU.backstage} · 2 路并行`,
      concurrent: 2,
    });
  });

  it('finalize 显示现实锚定', () => {
    expect(deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'finalize', title: '提交候选', status: 'running' }),
    ], true)).toMatchObject({ phase: 'anchor', label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.anchor });
    expect(deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'main_action', title: '主 Agent 动作：finalize' }),
    ], true)).toMatchObject({ phase: 'anchor' });
  });

  it('未运行且终态为完成/中断时短暂可见', () => {
    expect(deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'run_completed', title: '世界推演完成' }),
    ], false)).toMatchObject({
      visible: true,
      phase: 'completed',
      label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.completed,
      terminal: true,
    });
    expect(deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'block', title: '证据不足', ok: false }),
    ], false)).toMatchObject({
      visible: true,
      phase: 'interrupted',
      label: WORLD_SIMULATION_PROGRESS_LABELS_ACU.interrupted,
      terminal: true,
    });
  });

  it('未运行且无终态时隐藏；只统计最近一次 run 的条目', () => {
    expect(deriveWorldSimulationProgressView_ACU([
      entry({ id: 1, kind: 'run_started' }),
      entry({ id: 2, kind: 'run_completed' }),
      entry({ id: 3, kind: 'run_started', at: 2 }),
    ], false)).toMatchObject({ visible: false, phase: null, terminal: false });
  });
});
