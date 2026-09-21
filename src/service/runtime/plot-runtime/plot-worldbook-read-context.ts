import { createStrictLorebookReadError_ACU, getLorebookEntriesStrict_ACU, type StrictLorebookReadContext_ACU } from '../../worldbook/pipeline';
import { listLorebooks_ACU } from '../../../data/gateways/worldbook-gateway';
import { resolveGeneratedEntriesForTable_ACU } from '../../worldbook/worldbook-placeholder-classification';
import { capturePlotRuntimeScope_ACU, isSamePlotRuntimeScope_ACU, type PlotRuntimeScope_ACU } from './plot-runtime-scope';
import { logWarn_ACU } from '../../../shared/utils';

export interface PlotTableWorldbookIndex_ACU {
  entriesByBook: Record<string, any[]>;
  entries: any[];
}

export interface PlotWorldbookReadContext_ACU extends StrictLorebookReadContext_ACU {
  readonly initialScope: PlotRuntimeScope_ACU;
  readonly characterLorebookNamesPromise: Promise<string[]>;
  readonly tableWorldbookIndexPromise: Promise<PlotTableWorldbookIndex_ACU>;
  /** 表名占位符解析观测（T8-2）：index 懒建次数。 */
  readonly tableIndexBuildCount: number;
  getTableWorldbookScopedKeys(tableName: string, tableData: Record<string, any>): Promise<Set<string>>;
  dispose(): void;
}

export function createPlotWorldbookReadContext_ACU(
  options: {
    resolveCharacterLorebookNames: () => Promise<string[]>;
    /** 表名占位符候选作用域解析器：返回剧情实际使用的候选书（manual 选择或角色绑定）。 */
    resolveTableCandidates?: () => Promise<string[]>;
    signal?: AbortSignal | null;
  },
): PlotWorldbookReadContext_ACU {
  const initialScope = capturePlotRuntimeScope_ACU();
  let disposed = false;
  let characterLorebookNamesPromise: Promise<string[]> | undefined;
  let availableBookNamesPromise: Promise<string[]> | undefined;
  let tableWorldbookIndexPromise: Promise<PlotTableWorldbookIndex_ACU> | undefined;
  const tableWorldbookScopedKeysPromises = new WeakMap<Record<string, any>, Map<string, Promise<Set<string>>>>();
  let tableCandidateNamesPromise: Promise<string[]> | undefined;
  let tableIndexBuildCount = 0;
  const context: PlotWorldbookReadContext_ACU = {
    runId: `plot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    initialScope,
    bookEntriesPromises: new Map(),
    get tableIndexBuildCount() {
      return tableIndexBuildCount;
    },
    get availableBookNamesPromise() {
      if (!availableBookNamesPromise) availableBookNamesPromise = Promise.resolve().then(() => listLorebooks_ACU());
      return availableBookNamesPromise;
    },
    get characterLorebookNamesPromise() {
      if (!characterLorebookNamesPromise) {
        characterLorebookNamesPromise = Promise.resolve().then(options.resolveCharacterLorebookNames);
      }
      return characterLorebookNamesPromise;
    },
    get tableWorldbookIndexPromise() {
      if (!tableWorldbookIndexPromise) {
        tableIndexBuildCount += 1;
        // 候选作用域：只读取剧情实际涉及的书（角色绑定 primary/additional），
        // 不再为表名占位符隐式枚举全部世界书。
        if (!tableCandidateNamesPromise) {
          tableCandidateNamesPromise = options.resolveTableCandidates
            ? Promise.resolve().then(options.resolveTableCandidates)
            : context.characterLorebookNamesPromise;
        }
        tableWorldbookIndexPromise = tableCandidateNamesPromise
          .then(candidateBookNames => getLorebookEntriesStrict_ACU(candidateBookNames, {
            source: 'plot_table_index',
            validationPolicy: 'validate_list',
            runId: context.runId,
            context,
            notFoundPolicy: 'isolate_stale',
          }))
          .then(result => {
          if (result.status !== 'success') throw createStrictLorebookReadError_ACU(result);
          if (result.staleBookNames.length > 0) {
            logWarn_ACU('[剧情推进][世界书] 表名索引已隔离宿主列表中的不存在世界书。', {
              phase: 'table_worldbook_index',
              runId: context.runId,
              source: 'plot_table_index',
              category: 'lorebook_not_found',
              isolatedCount: result.staleBookNames.length,
              staleBookNames: result.staleBookNames,
            });
          }
          const entries = Object.entries(result.entriesByBook).flatMap(([bookName, bookEntries]) => (
            (Array.isArray(bookEntries) ? bookEntries : []).map((entry: any) => ({ ...entry, bookName }))
          ));
          return { entriesByBook: result.entriesByBook, entries };
        });
      }
      return tableWorldbookIndexPromise;
    },
    getTableWorldbookScopedKeys: (tableName, tableData) => {
      const normalizedTableName = String(tableName || '').trim();
      let scopedKeysByTableName = tableWorldbookScopedKeysPromises.get(tableData);
      if (!scopedKeysByTableName) {
        scopedKeysByTableName = new Map();
        tableWorldbookScopedKeysPromises.set(tableData, scopedKeysByTableName);
      }
      const existing = scopedKeysByTableName.get(normalizedTableName);
      if (existing) return existing;
      const promise = context.tableWorldbookIndexPromise.then(index => new Set(
        resolveGeneratedEntriesForTable_ACU(index.entries, normalizedTableName, tableData)
          .map((entry: any) => `${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`),
      ));
      scopedKeysByTableName.set(normalizedTableName, promise);
      return promise;
    },
    isActive: () => !disposed && (!initialScope.reliable || isSamePlotRuntimeScope_ACU(initialScope, capturePlotRuntimeScope_ACU())),
    isAborted: () => disposed || options.signal?.aborted === true,
    dispose: () => {
      disposed = true;
      context.bookEntriesPromises.clear();
      availableBookNamesPromise = undefined;
      tableWorldbookIndexPromise = undefined;
      characterLorebookNamesPromise = undefined;
    },
  };
  return context;
}
