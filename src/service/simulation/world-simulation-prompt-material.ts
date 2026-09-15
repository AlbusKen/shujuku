/**
 * service/simulation/world-simulation-prompt-material.ts — 世界推演 request-local 提示词材料
 *
 * 目标：每一次 AI 请求发送前，以当前锚点为上限度重新读取正文概览与纪要表概览，
 * 同一次请求内的全部占位符共享这一份快照；不再把运行起点的旧快照反复复用于多个 Agent 回合。
 *
 * 该模块只描述"新鲜材料"的形状与刷新器接口，具体读取由持有 chat/表格依赖的调用方提供，
 * 从而避免把 mes/swipes、表格存储模式、isolation 等宿主细节泄漏到渲染层。
 */

import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';

export interface WorldSimulationPromptMaterialSnapshot_ACU {
  /** 以当前锚点为上限重新装配的正文概览；读取失败时不阻断请求，由调用方回退旧值。 */
  storyContext?: AgentStoryContextSnapshot_ACU;
  /** 以当前锚点为上限重新解析的纪要表概览文本。 */
  summaryOverview?: string;
  /** 与纪要概览同一时刻的表格快照，供 $TABLE 读取与 search 使用。 */
  tableData?: unknown;
}

/** 每次 AI 请求发送前调用一次；同一次请求内只调用一次，结果被该请求的全部占位符共享。 */
export type WorldSimulationPromptMaterialRefresher_ACU = () => Promise<WorldSimulationPromptMaterialSnapshot_ACU>;

/**
 * 按"新鲜优先、失败保留旧值"合并材料。任一字段刷新失败时回退运行起点冻结值，
 * 保证材料读取失败不会阻断模型调用，也不会让占位符退化成空串。
 */
export function mergeWorldSimulationPromptMaterial_ACU(
  previous: { storyContext?: AgentStoryContextSnapshot_ACU; summaryOverview?: string; tableData?: unknown },
  fresh: WorldSimulationPromptMaterialSnapshot_ACU | null | undefined,
): { storyContext?: AgentStoryContextSnapshot_ACU; summaryOverview?: string; tableData?: unknown } {
  if (!fresh) return previous;
  return {
    storyContext: fresh.storyContext ?? previous.storyContext,
    summaryOverview: fresh.summaryOverview ?? previous.summaryOverview,
    tableData: fresh.tableData ?? previous.tableData,
  };
}
