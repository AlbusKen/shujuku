import type { TableDataObject_ACU } from '../../../shared/models/table-data';
import type { ConfirmedSimulationCausalView_ACU } from '../../zero-layer/simulation-causal-view';
import type { OrdinaryPlotCausalView_ACU } from './plot-internal-causal';
import type { SqlTemplateReadContext_ACU } from '../template-vars/sql-query-var';
import type { PlotInternalCausalResult_ACU } from './plot-internal-causal-result';
import type { buildPlotWorldContext_ACU } from './plot-world-context';
import type { PlotSimulationSceneContext_ACU } from './plot-simulation-scene';

/** 完整的请求级隔离边界；存在时不读取或保存宿主物理回合。 */
export interface PlotRequestContext_ACU {
  readonly history: readonly Record<string, any>[];
  readonly tableData: TableDataObject_ACU;
  readonly presetName: string;
  readonly signal: AbortSignal;
  readonly sqlReadContext: SqlTemplateReadContext_ACU | null;
  readonly ejsContext: Record<string, unknown>;
  readonly finalPromptEntries: Record<string, any>[];
  /** 仅供内部 typed runtime 按需读取冻结因果资料，绝不隐式注入提示词。 */
  readSimulationCausalView?(): ConfirmedSimulationCausalView_ACU | OrdinaryPlotCausalView_ACU | null;
  /** 内部选择只经请求私有 sink 交付，绝不进入公开剧情结果。 */
  acceptInternalCausalResult?(result: PlotInternalCausalResult_ACU): void;
  /** 经 scene review 与 reveal gate 收窄的公开事实；只在普通任务最终调用前作为独立 system 消息读取。 */
  readSafeCausalFacts?(): string;
  readWorldSimulationContext?(): ReturnType<typeof buildPlotWorldContext_ACU> | null;
  /** 冻结请求显式给出的当前场景；仅场景 token 渲染可使用。 */
  readonly simulationScene?: PlotSimulationSceneContext_ACU;
  assertCurrent(): void;
  resolveTaskApiPreset(task: Record<string, any>): string;
  callApi(messages: Array<{ role: string; content: string }>, presetName: string): Promise<string | null>;
  /** 内部因果任务专用直接 transport；不得回退至宿主或常规 API。 */
  callInternalApi?(messages: Array<{ role: string; content: string }>, presetName: string): Promise<string | null>;
}
