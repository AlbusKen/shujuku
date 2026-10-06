import type { ChatCompletionPromptContext_ACU } from '../runtime/helpers-remaining';
import { createDetachedSqlTableService_ACU } from '../table/table-storage-strategy';
import type { SqlTemplateReadContext_ACU } from '../runtime/template-vars/sql-query-var';
import { validateZeroLayerTableData_ACU } from './validation';
import { ZeroLayerError_ACU } from './model';

/** 只按请求对象绑定，不存在可泄漏到后台 Agent 请求的全局历史替换。 */
const contexts_ACU = new WeakMap<object, ChatCompletionPromptContext_ACU>();
const passes_ACU = new WeakMap<object, Promise<void>>();

export function bindZeroLayerPromptContext_ACU(
  request: object,
  context: ChatCompletionPromptContext_ACU,
): void {
  const existing = contexts_ACU.get(request);
  if (existing && existing !== context) throw new Error('同一请求不能绑定不同零层回合。');
  contexts_ACU.set(request, context);
}

export function getZeroLayerPromptContext_ACU(request: unknown): ChatCompletionPromptContext_ACU | undefined {
  return request !== null && typeof request === 'object' ? contexts_ACU.get(request) : undefined;
}

/** 同一请求重复事件复用原处理结果；失败不会再次执行随机变量与 SQL 模板。 */
export function runZeroLayerTemplatePass_ACU(
  request: object, process: (sqlReadContext?: SqlTemplateReadContext_ACU | null) => Promise<void>,
  context?: ChatCompletionPromptContext_ACU,
): Promise<void> {
  const previous = passes_ACU.get(request);
  if (previous) return previous;
  const result = Promise.resolve().then(async () => {
    context?.assertCurrent?.();
    if (!context?.storageMode) return process(context?.sqlReadContext);
    if (context.storageMode === 'native') return process(null);
    validateZeroLayerTableData_ACU(context.allTablesJson);
    const provider = createDetachedSqlTableService_ACU();
    try {
      const loaded = await provider.loadFromData(structuredClone(context.allTablesJson));
      context.assertCurrent?.();
      if (loaded.error || !provider.isReady()) {
        throw new ZeroLayerError_ACU('effects-pending', '正文模板的独立 SQLite 快照未就绪。');
      }
      await process({ provider, mapper: provider.createReadNameMapper_ACU(),
        tableData: provider.getCurrentDataStrict_ACU() });
      context.assertCurrent?.();
    } finally { provider.dispose(); }
  });
  passes_ACU.set(request, result);
  return result;
}
