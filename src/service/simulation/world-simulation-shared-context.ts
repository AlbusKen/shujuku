/**
 * service/simulation/world-simulation-shared-context.ts — 世界推演运行级共享冻结上下文
 *
 * 目标：gate、主控与子代理消费同一份冻结上下文，不能各用一套窗口。
 * 组成：
 * - 已维护世界账本（WorldStateSnapshot，由调用方在飞行开始时读定并冻结）；
 * - 纪要表最近 30 条逐轮概要（定位用；详细纪要经 $TABLE:纪要表:a-b 精读）；
 * - active swipe 最近 3 个 AI 正文楼层（衔接场景起点）。
 *
 * 概要只用于定位；信息不足时允许通过 $TABLE:纪要表:起始行-结束行 读取详细纪要。
 */

import { findAgentSheetsByAliases_ACU, AGENT_TABLE_ALIASES_ACU } from '../continuation/agent/agent-tables';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import type { WorldStateSnapshot_ACU } from './model';

export const WORLD_SIMULATION_SUMMARY_OVERVIEW_ROWS_ACU = 30;
export const WORLD_SIMULATION_SHARED_BRIDGE_FLOORS_ACU = 3;

/** 全局数据表/表格数据的只读引用：生产从 runtime 快照获取，测试可注入静态对象。 */
export type WorldSimulationTableData_ACU = unknown;

export interface WorldSimulationSharedContextSummary_ACU {
  /** 人类可读的最近 30 条概览文本；空表或缺表时如实说明。 */
  text: string;
  /** 纪要表是否存在（按别名命中的第一张）；行区间读取以真实表名为准。 */
  available: boolean;
  /** 命中的纪要表名（可能为空）。 */
  tableName: string;
  /** 概览行的 1 基行号范围（全表口径），供 $TABLE:纪要表:a-b 精读。*/
  coveredRows: { start: number; end: number } | null;
}

export interface WorldSimulationSharedContext_ACU {
  ledger: WorldStateSnapshot_ACU;
  summaryOverview: WorldSimulationSharedContextSummary_ACU;
  tableData: WorldSimulationTableData_ACU;
}

export interface WorldSimulationSharedContextInput_ACU {
  ledger: WorldStateSnapshot_ACU;
  tableData?: WorldSimulationTableData_ACU;
  /** 仅测试注入：跳过真实表格快照读取。 */
  summaryOverride?: WorldSimulationSharedContextSummary_ACU;
}

function renderSummaryOverviewText_ACU(summary: WorldSimulationSharedContextSummary_ACU): string {
  return summary.text;
}

/** 冻结纪要表最近 30 行概览（1 基全表行号口径）。 */
export function captureSummaryOverview_ACU(tableData?: WorldSimulationTableData_ACU): WorldSimulationSharedContextSummary_ACU {
  const matched = findAgentSheetsByAliases_ACU(AGENT_TABLE_ALIASES_ACU.chronicles, tableData);
  if (!matched.length) {
    return { text: '当前聊天没有纪要表，无法提供逐轮概览；剧情脉络只能依靠楼层索引与正文楼层本身。', available: false, tableName: '', coveredRows: null };
  }
  const sheet = matched[0]!;
  if (!sheet.rows.length) {
    return { text: `纪要表「${sheet.name}」存在但没有数据行。`, available: false, tableName: sheet.name, coveredRows: null };
  }
  const windowStart = Math.max(0, sheet.rows.length - WORLD_SIMULATION_SUMMARY_OVERVIEW_ROWS_ACU);
  const lines: string[] = [];
  for (let index = windowStart; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index]!;
    lines.push(`第 ${index + 1} 行｜${row.join(' | ')}`);
  }
  const text = [
    `纪要表「${sheet.name}」最近 ${sheet.rows.length - windowStart} 条（全表共 ${sheet.rows.length} 行）：`,
    ...lines,
    windowStart > 0 ? `更早的 ${windowStart} 条已省略；需要细节时用 $TABLE:${sheet.name}:起始行-结束行 精读。` : '',
  ].filter(Boolean).join('\n');
  return { text, available: true, tableName: sheet.name, coveredRows: { start: windowStart + 1, end: sheet.rows.length } };
}

/**
 * 在运行起点一次性冻结共享上下文。调用方把返回对象同时交给 gate、主控与子代理；
 * 不再各自重新读表或读正文，保证同一 run 的窗口一致。
 */
export function buildWorldSimulationSharedContext_ACU(input: WorldSimulationSharedContextInput_ACU): WorldSimulationSharedContext_ACU {
  if (!input.ledger || typeof input.ledger !== 'object') throw new Error('WORLD_SIM_SHARED_CONTEXT_INVALID: 账本快照缺失');
  const summaryOverview = input.summaryOverride ?? captureSummaryOverview_ACU(input.tableData);
  return {
    ledger: input.ledger,
    summaryOverview,
    tableData: input.tableData ?? null,
  };
}

/** 渲染为进入 runtime context 的概要文本。 */
export function renderSharedSummaryOverview_ACU(shared: WorldSimulationSharedContext_ACU | null | undefined): string {
  return shared ? renderSummaryOverviewText_ACU(shared.summaryOverview) : '（本次运行未提供纪要概览快照）';
}

/** 只冻结纪要概览文本的轻量入口（gate/主控/子代理共享同一份文本）。 */
export function captureSummaryOverviewText_ACU(tableData?: unknown): string {
  return captureSummaryOverview_ACU(tableData).text;
}

export type { AgentStoryContextSnapshot_ACU };
