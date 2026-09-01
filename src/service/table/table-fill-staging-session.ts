import type { SqlTableApplyScope_ACU } from '../../shared/table-storage-provider';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { parseAndApplyTableEditsToData_ACU } from '../ai/prompt-builder';
import { isSqliteMode } from './storage-mode';
import { createDetachedSqlTableService_ACU } from './table-storage-strategy';
import type { SqlTableService } from './sql-table-service';
import {
  assembleBucketWorkingView_ACU,
  mergeTargetOverlayFromBucket_ACU,
  type TableFillStagingRunContext_ACU,
  type TableFillTargetOverlay_ACU,
} from './table-fill-boundary-staging';

export interface StagingBucketInput_ACU {
  historicalBase: Record<string, any>;
  saveTargetIndex: number;
  updateMode: string;
  sqlTexts?: string[];
  dslResponses?: Array<{ aiResponse: string; targetSheetKeys: readonly string[] }>;
  /** 调用方已在隔离副本上应用 DSL 时，直接收口 overlay，不再二次应用。 */
  appliedTableData?: Record<string, any>;
  sqlApplyScope?: SqlTableApplyScope_ACU;
}

export type StagingBucketResult_ACU =
  | { ok: true; overlay: TableFillTargetOverlay_ACU; tableData: Record<string, any> }
  | { ok: false; error: string; errorCategory: 'model' | 'infrastructure' | 'precondition' };

export interface TableFillStagingSession_ACU {
  applyBucket(input: StagingBucketInput_ACU): Promise<StagingBucketResult_ACU>;
  getTargetOverlay(): TableFillTargetOverlay_ACU;
  discard(): Promise<void>;
}

export function createTableFillStagingSession_ACU(
  run: TableFillStagingRunContext_ACU,
): TableFillStagingSession_ACU {
  let discarded = false;
  let detachedProvider: SqlTableService | null = null;

  const assertScope = (phase: string): StagingBucketResult_ACU | null => {
    if (discarded) {
      return { ok: false, error: `staging session 已释放，拒绝 ${phase}。`, errorCategory: 'precondition' };
    }
    if (String(currentChatFileIdentifier_ACU || '') !== String(run.chatKey || '')
      || String(getCurrentIsolationKey_ACU() || '') !== String(run.isolationKey || '')) {
      return { ok: false, error: `staging session ${phase} 检测到聊天或隔离标识已切换。`, errorCategory: 'precondition' };
    }
    return null;
  };

  const releaseDetached = async (): Promise<void> => {
    if (!detachedProvider) return;
    try {
      detachedProvider.dispose();
    } catch (error) {
      logWarn_ACU('[TableFillStagingSession] 释放 detached SQLite 失败。', error);
    }
    detachedProvider = null;
  };

  return {
    getTargetOverlay() {
      return run.overlay;
    },
    async discard() {
      discarded = true;
      await releaseDetached();
    },
    async applyBucket(input: StagingBucketInput_ACU): Promise<StagingBucketResult_ACU> {
      const scopeError = assertScope('applyBucket');
      if (scopeError) return scopeError;
      const workingView = assembleBucketWorkingView_ACU(input.historicalBase, run.overlay);
      try {
        if (input.appliedTableData && typeof input.appliedTableData === 'object') {
          run.overlay = mergeTargetOverlayFromBucket_ACU(run.overlay, input.appliedTableData, input.saveTargetIndex);
          return { ok: true, overlay: run.overlay, tableData: input.appliedTableData };
        }
        if (isSqliteMode() && Array.isArray(input.sqlTexts) && input.sqlTexts.length > 0) {
          await releaseDetached();
          detachedProvider = createDetachedSqlTableService_ACU();
          const loaded = await detachedProvider.loadFromData(workingView as TableDataObject_ACU);
          if (loaded.error || !detachedProvider.isReady()) {
            await releaseDetached();
            return {
              ok: false,
              error: loaded.error || 'staging detached SQLite 未能就绪。',
              errorCategory: 'infrastructure',
            };
          }
          const parseResult = detachedProvider.applyEditsWithSystemRowIds(
            input.sqlTexts,
            input.updateMode,
            input.sqlApplyScope,
          );
          if (!parseResult?.success || !parseResult.tableData) {
            await releaseDetached();
            return {
              ok: false,
              error: parseResult?.error || 'staging SQL 执行失败。',
              errorCategory: 'model',
            };
          }
          const tableData = parseResult.tableData as Record<string, any>;
          run.overlay = mergeTargetOverlayFromBucket_ACU(run.overlay, tableData, input.saveTargetIndex);
          await releaseDetached();
          logDebug_ACU(`[TableFillStagingSession] SQLite bucket 已累积 overlay：runId=${run.runId}, target=${input.saveTargetIndex}, sheets=${run.targetSheetKeys.join('、')}`);
          return { ok: true, overlay: run.overlay, tableData };
        }

        let workingTableData = JSON.parse(JSON.stringify(workingView));
        if (Array.isArray(input.dslResponses)) {
          for (const response of input.dslResponses) {
            const parseResult: any = parseAndApplyTableEditsToData_ACU(
              response.aiResponse,
              workingTableData,
              input.updateMode,
              false,
            );
            const parseSuccess = typeof parseResult === 'object' && parseResult !== null ? parseResult.success : !!parseResult;
            if (!parseSuccess) {
              return {
                ok: false,
                error: (parseResult && typeof parseResult.error === 'string' && parseResult.error)
                  ? parseResult.error
                  : 'staging DSL 应用失败。',
                errorCategory: 'model',
              };
            }
            if (parseResult?.workingData) workingTableData = parseResult.workingData;
            const parsedKeys: string[] = Array.isArray(parseResult?.modifiedKeys) ? parseResult.modifiedKeys : [];
            const unauthorized = parsedKeys.filter(sheetKey => !run.targetSheetKeys.includes(sheetKey));
            if (unauthorized.length > 0) {
              return {
                ok: false,
                error: `staging DSL 越权修改了非目标表（${unauthorized.join(', ')}）。`,
                errorCategory: 'model',
              };
            }
          }
        }
        run.overlay = mergeTargetOverlayFromBucket_ACU(run.overlay, workingTableData, input.saveTargetIndex);
        logDebug_ACU(`[TableFillStagingSession] native bucket 已累积 overlay：runId=${run.runId}, target=${input.saveTargetIndex}, sheets=${run.targetSheetKeys.join('、')}`);
        return { ok: true, overlay: run.overlay, tableData: workingTableData };
      } catch (error: any) {
        await releaseDetached();
        return {
          ok: false,
          error: error?.message || String(error),
          errorCategory: 'infrastructure',
        };
      }
    },
  };
}
