/**
 * service/simulation/world-simulation-material-reader.ts — 世界推演 request-local 材料读取器
 *
 * 职责：在一次 AI 请求发送前，以「当前锚点」为上限重新读取三样材料：
 * 1. 截至锚点的正文概览/新增/衔接快照（active swipe 口径）；
 * 2. 截至锚点的纪要表概览（最近 30 条逐轮概要）；
 * 3. 与纪要概览同一时刻的表格快照，供 $TABLE 读取与 tables 搜索使用。
 *
 * 硬规则：
 * - 任何一个材料读取失败都不得阻断模型调用，也不得把占位符退化成空串；失败字段保留调用方旧值。
 * - 表格只读回放，绝不改写全局 schedule/runtime 状态。
 * - 本模块不做门禁判断：没有 enabled、minFloorGap、flight-mode、branch identity 前置阻断。
 */

import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { loadTableStateFromFramesV2Detailed_ACU } from '../table/storage-frame-v2-replay';
import { buildWorldSimulationStoryContext_ACU } from './world-simulation-story-context';
import { captureSummaryOverviewText_ACU } from './world-simulation-shared-context';
import type { WorldSimulationPromptMaterialRefresher_ACU, WorldSimulationPromptMaterialSnapshot_ACU } from './world-simulation-prompt-material';

export interface WorldSimulationMaterialReaderDependencies_ACU {
  getChat: () => any[];
  /** 诊断回调；材料读取失败时上报，不改变控制流。 */
  onDiagnostic?: (message: string, error: unknown) => void;
  getIsolationKey?: () => string;
  /** 按锚点只读回放表格；默认走 storage-frame-v2 只读路径。 */
  loadTableDataAtAnchor?: (chat: readonly unknown[], maxMessageIndex: number) => Promise<unknown | undefined>;
  buildStoryContext?: typeof buildWorldSimulationStoryContext_ACU;
  readSummaryOverview?: (tableData: unknown) => string;
}

/** 一次请求的材料读取请求；锚点与水位由调用方在本次飞行中固定。 */
export interface WorldSimulationMaterialReadRequest_ACU {
  anchorMessageIndex: number;
  settledThroughIndex: number;
  runId: string;
  chatIdentity: string;
}

export interface WorldSimulationMaterialReader_ACU {
  /** 以调用方固定的锚点/水位/runId 读取一次材料。 */
  read: (request: WorldSimulationMaterialReadRequest_ACU) => Promise<WorldSimulationPromptMaterialSnapshot_ACU>;
  /** 绑定到一次具体航班的刷新器：每次 AI 请求发送前调用，返回同一份 request-local 快照。 */
  bind: (request: WorldSimulationMaterialReadRequest_ACU) => WorldSimulationPromptMaterialRefresher_ACU;
}

/** 只读回放：以 maxMessageIndex 为上限，且 updateRuntimeState:false，绝不污染全局表格运行时。 */
async function loadTableDataAtAnchor_ACU(chat: readonly unknown[], maxMessageIndex: number): Promise<unknown | undefined> {
  const replay = await loadTableStateFromFramesV2Detailed_ACU(chat as any, getCurrentIsolationKey_ACU(), { maxMessageIndex, updateRuntimeState: false });
  return replay?.data;
}

export function createWorldSimulationMaterialReader_ACU(
  dependencies: WorldSimulationMaterialReaderDependencies_ACU,
): WorldSimulationMaterialReader_ACU {
  const diagnostic = dependencies.onDiagnostic;
  const read = async (request: WorldSimulationMaterialReadRequest_ACU): Promise<WorldSimulationPromptMaterialSnapshot_ACU> => {
    const snapshot: WorldSimulationPromptMaterialSnapshot_ACU = {};
    try {
      const chat = dependencies.getChat();
      snapshot.storyContext = await (dependencies.buildStoryContext ?? buildWorldSimulationStoryContext_ACU)({
        chat,
        anchorMessageIndex: request.anchorMessageIndex,
        chatIdentity: request.chatIdentity,
        runId: request.runId,
        settledThroughIndex: request.settledThroughIndex,
      });
    } catch (error) {
      diagnostic?.('[世界推演] 正文快照即时读取失败，沿用旧值。', error);
    }
    try {
      const chat = dependencies.getChat();
      const tableData = await (dependencies.loadTableDataAtAnchor ?? loadTableDataAtAnchor_ACU)(chat, request.anchorMessageIndex);
      if (tableData !== undefined && tableData !== null) {
        snapshot.tableData = tableData;
        snapshot.summaryOverview = (dependencies.readSummaryOverview ?? captureSummaryOverviewText_ACU)(tableData);
      }
    } catch (error) {
      diagnostic?.('[世界推演] 纪要表锚点快照读取失败，沿用旧值。', error);
    }
    return snapshot;
  };
  return { read, bind: request => () => read(request) };
}
