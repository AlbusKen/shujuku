/**
 * presentation/bootstrap/api-groups/core-data-api.ts
 * 核心数据操作 API — exportTableAsJson / importTableAsJson / triggerUpdate
 */

import { ACU_TOAST_CATEGORY_ACU } from '../../../shared/constants';
import { topLevelWindow_ACU } from '../../../shared/env';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { SillyTavern_API_ACU } from '../../../shared/host-api';
import {
    currentJsonTableData_ACU,
    isAutoUpdatingCard_ACU,
    _set_isAutoUpdatingCard_ACU,
} from '../../../service/runtime/state-manager';
import { loadAllChatMessages_ACU } from '../../../service/worldbook/pipeline';
import { getEffectiveAutoUpdateThreshold_ACU } from '../../../service/runtime/helpers-remaining';
import { proceedWithCardUpdate_ACU } from '../../triggers/update-process';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../../components/pipeline-ui-helpers';
import { showToastr_ACU } from '../../theme/toast';
import { getCurrentWorldbookConfig_ACU } from '../../../service/settings/settings-readers';
import { enqueueSummaryVectorIndexFlush_ACU } from '../../../service/vector/summary-vector-index-flush-queue';
import { importTableJsonThroughCommit_ACU } from '../../../service/table/table-import-service';
import type { ApiGroupContext } from './callback-api';

function shouldPersistImportedTableJson_ACU(options: any): boolean {
    if (!options || typeof options !== 'object') return true;
    if (options.persist === false || options.runtimeOnly === true) return false;
    const mode = String(options.mode || options.source || '').toLowerCase();
    return !(mode === 'restore' || mode === 'runtime' || mode === 'runtime-only' || mode === 'delete-layer-restore');
}

export function createCoreDataApi(ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 导出当前表格数据
        exportTableAsJson: function() {
            return currentJsonTableData_ACU || {};
        },

        // 导入并覆盖当前表格数据；默认外部导入会持久化，传 { persist:false } / { mode:'restore' } 时仅恢复运行时。
        importTableAsJson: async function(jsonString: any, options?: any) {
            if (typeof jsonString !== 'string' || jsonString.trim() === '') {
                logError_ACU('importTableAsJson received invalid input.');
                showToastr_ACU('error', '导入数据失败：输入为空。');
                return false;
            }
            try {
                const persist = shouldPersistImportedTableJson_ACU(options);
                const commitResult = await importTableJsonThroughCommit_ACU(jsonString, { persist });
                if (commitResult.success) {
                    if (persist) {
                        const targetMessageIndexForVectorSync = commitResult.messageIndex ?? -1;
                        logDebug_ACU(`[importTableAsJson] 已通过服务层导入提交入口导入表格数据，messageIndex=${targetMessageIndexForVectorSync}。`);

                        await refreshMergedDataAndNotifyWithUI_ACU();

                        const sourceTableKey = Object.keys(commitResult.tableData || {}).find((sheetKey) => {
                            const table = (commitResult.tableData as any)?.[sheetKey];
                            return sheetKey.startsWith('sheet_') && !!table?.name && isSummaryOrOutlineTable_ACU(String(table.name));
                        });
                        if (sourceTableKey && getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true) {
                            try {
                                const queueResult = await enqueueSummaryVectorIndexFlush_ACU({
                                    sourceTableKey,
                                    reason: 'importTableAsJson',
                                });
                                if (!queueResult.queued && !queueResult.skipped) {
                                    logWarn_ACU(`[importTableAsJson] 交火向量索引防抖归档入队失败: reason=${queueResult.reason || 'unknown'}`);
                                } else {
                                    logDebug_ACU(`[importTableAsJson] 交火向量索引防抖归档已入队: queued=${queueResult.queued}, reason=${queueResult.reason || 'ok'}`);
                                }
                            } catch (syncError) {
                                logError_ACU('[importTableAsJson] 交火向量索引防抖归档入队异常（表格导入已完成）:', syncError);
                            }
                        }
                    } else {
                        logDebug_ACU('[importTableAsJson] 已按运行时恢复模式导入表格数据，未写入聊天持久化。');
                        (topLevelWindow_ACU as any).AutoCardUpdaterAPI?._notifyTableUpdate?.({ persisted: false });
                    }

                    return true;
                } else {
                    throw new Error(commitResult.error || '导入数据提交失败。');
                }
            } catch (error: any) {
                logError_ACU('Failed to import table data from JSON:', error);
                showToastr_ACU('error', `导入数据失败: ${error?.message || String(error)}`);
                return false;
            }
        },

        // 删除楼层/备份恢复专用：只恢复运行时数据，不制造新的 V2 data_replace/checkpoint/log。
        restoreTableAsJson: async function(jsonString: any) {
            return this.importTableAsJson(jsonString, { mode: 'restore', persist: false });
        },

        // 外部触发增量更新
        triggerUpdate: async function() {
            logDebug_ACU('External trigger for database update received.');
            if (isAutoUpdatingCard_ACU) {
                showToastr_ACU('info', '已有更新任务在后台进行中。', { acuToastCategory: ACU_TOAST_CATEGORY_ACU.MANUAL_TABLE });
                return false;
            }
            _set_isAutoUpdatingCard_ACU(true);
            try {
                await loadAllChatMessages_ACU();
                const chatHistory = SillyTavern_API_ACU.chat || [];
                const currentThreshold = getEffectiveAutoUpdateThreshold_ACU('manual_update');

                const allAiMessageIndices = chatHistory
                    .map((msg: any, index: number) => !msg.is_user ? index : -1)
                    .filter((index: number) => index !== -1);

                const numberOfAiMessages = allAiMessageIndices.length;

                let sliceStartIndex = 0;
                if (numberOfAiMessages > currentThreshold) {
                    const firstRelevantAiMessageMapIndex = numberOfAiMessages - currentThreshold;
                    const previousAiMessageMapIndex = firstRelevantAiMessageMapIndex - 1;
                    if (previousAiMessageMapIndex >= 0) {
                        sliceStartIndex = allAiMessageIndices[previousAiMessageMapIndex] + 1;
                    }
                }

                if (sliceStartIndex > 0 &&
                    chatHistory[sliceStartIndex] &&
                    !chatHistory[sliceStartIndex].is_user &&
                    chatHistory[sliceStartIndex - 1] &&
                    chatHistory[sliceStartIndex - 1].is_user)
                {
                    sliceStartIndex = sliceStartIndex - 1;
                    logDebug_ACU(`Adjusted slice start index to ${sliceStartIndex} to include preceding user message.`);
                }

                const messagesToProcess = chatHistory.slice(sliceStartIndex);
                return await proceedWithCardUpdate_ACU(messagesToProcess);
            } catch (error) {
                logError_ACU('triggerUpdate failed:', error);
                return false;
            } finally {
                _set_isAutoUpdatingCard_ACU(false);
            }
        },
    };
}
