import type { TableDataObject_ACU } from '../../../shared/models/table-data';
import type { SqlTemplateReadContext_ACU } from '../template-vars/sql-query-var';

/** 完整的请求级隔离边界；存在时不读取或保存宿主物理回合。 */
export interface PlotRequestContext_ACU {
  readonly history: readonly Record<string, any>[];
  readonly tableData: TableDataObject_ACU;
  readonly presetName: string;
  readonly signal: AbortSignal;
  readonly sqlReadContext: SqlTemplateReadContext_ACU | null;
  readonly ejsContext: Record<string, unknown>;
  readonly finalPromptEntries: Record<string, any>[];
  assertCurrent(): void;
  resolveTaskApiPreset(task: Record<string, any>): string;
  callApi(messages: Array<{ role: string; content: string }>, presetName: string): Promise<string | null>;
}
