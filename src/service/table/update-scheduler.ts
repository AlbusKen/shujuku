/**
 * service/table/update-scheduler.ts — 自动更新调度核心逻辑
 * 从 presentation/triggers/settings-ui-sync/settings-ui-trigger.ts 的 triggerAutomaticUpdateIfNeeded_ACU 中提取
 * 
 * 只负责「遍历表格检查更新条件 + 构建 tablesToUpdate 列表 + 分组」，不涉及 UI（toast/status）。
 */

import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { startRuntimePerformanceSpan_ACU } from '../../shared/runtime-performance';
import { logAutoFillSkip_ACU, logAutoFillStage_ACU } from '../../shared/trigger-diagnostics';
import { getSortedSheetKeys_ACU } from '../template/chat-scope';
import { getLatestV2FullCheckpointMessageIndex_ACU, resolveTableHistoryStatesFromChat_ACU } from './table-history';

export interface TableUpdateItem {
    sheetKey: string;
    sheetName: string;
    indices: number[];
    /** 完整历史待填缺口（未与 contextDepth 裁剪求交），跨根判定与全量追补使用。 */
    allIndices: number[];
    /** 该表的待填范围是否跨当前唯一 full checkpoint（需要走 run 级隔离 staging）。 */
    requiresBoundaryStaging: boolean;
    groupId: number;
    batchSize: number;
    scheduleSignature: string;
}

export interface UpdateGroup {
    indices: number[];
    batchSize: number;
    groupId: number;
    scheduleSignature: string;
    sheetKeys: string[];
    sheetNames: string[];
    /** 该组是否跨当前唯一 full checkpoint（需要走 run 级隔离 staging，与普通组分离执行）。 */
    requiresBoundaryStaging: boolean;
}

export interface AutoUpdatePlan {
    tablesToUpdate: TableUpdateItem[];
    updateGroups: Record<string, UpdateGroup>;
    /** 跨 full checkpoint 边界元数据（调度层预计算，执行层据此走 staging 流程）。 */
    boundary: {
        fullCheckpointIndices: number[];
        requiresBoundaryStaging: boolean;
    };
}

/**
 * 构建自动更新计划：遍历所有表格，检查每个表的独立更新条件，返回需要更新的表列表和分组
 * 
 * @param liveChat - 当前聊天记录数组
 * @param tableData - 当前表格数据（currentJsonTableData_ACU）
 * @param settings - 当前设置
 * @param isolationKey - 当前隔离标签键名
 * @returns AutoUpdatePlan 包含 tablesToUpdate 和 updateGroups
 */
export function buildAutoUpdatePlan_ACU(
    liveChat: any[],
    tableData: Record<string, any>,
    settings: any,
    isolationKey: string,
    performanceContext?: { runId?: string; parentSpanId?: string },
    logicalHistory?: {
        lastCompletedAiFloorBySheetKey: Readonly<Record<string, number>>;
        aiMessageIndices: readonly number[];
    },
): AutoUpdatePlan {
    const tablesToUpdate: TableUpdateItem[] = [];
    const sheetKeys = getSortedSheetKeys_ACU(tableData);
    const performanceSpan = startRuntimePerformanceSpan_ACU('auto-update-plan', {
        ...performanceContext,
        settings,
        metrics: { messageCount: liveChat.length, sheetCount: sheetKeys.length },
    });

    const historyBySheetKey = logicalHistory
      ? new Map(sheetKeys.map(sheetKey => [sheetKey, { lastCompletedAiFloor: logicalHistory.lastCompletedAiFloorBySheetKey[sheetKey] ?? 0 }]))
      : resolveTableHistoryStatesFromChat_ACU(
        liveChat,
        sheetKeys.map(sheetKey => ({
            sheetKey,
            isSummaryTable: isSummaryOrOutlineTable_ACU(tableData[sheetKey]?.name),
            isolationKey,
            settings,
        })),
    );

    // 逻辑模式的索引只定位请求快照；AI 身份与序号由 Timeline 提供，不推测物理楼层。
    const allAiMessageIndices = logicalHistory
        ? [...logicalHistory.aiMessageIndices]
        : liveChat
        .map((msg: any, index: number) => !msg.is_user ? index : -1)
        .filter((index: number) => index !== -1);

    const totalAiMessages = allAiMessageIndices.length;

    // 统一的全局默认参数
    const globalFrequency = settings.autoUpdateFrequency || 1;
    const globalSkip = settings.skipUpdateFloors || 0;

    // 当前唯一 full checkpoint（replay 正式根）：为 -1 时表示尚无 full，不触发跨根 staging。
    const originalFullIndex = logicalHistory ? -1 : getLatestV2FullCheckpointMessageIndex_ACU(liveChat, isolationKey);

    for (const sheetKey of sheetKeys) {
        const table = tableData[sheetKey];
        if (!table) continue;

        const tableConfig = table.updateConfig || {};

        // 获取该表的更新配置 (优先使用表内配置，否则使用全局默认)
        const rawDepth = Number.isFinite(tableConfig.contextDepth) ? tableConfig.contextDepth : -1;
        const rawFreq = Number.isFinite(tableConfig.updateFrequency) ? tableConfig.updateFrequency : -1;
        const rawSkip = Number.isFinite(tableConfig.skipFloors) ? tableConfig.skipFloors : -1;
        const rawBatch = Number.isFinite(tableConfig.batchSize) ? tableConfig.batchSize : -1;
        const rawGroupId = Number.isFinite(tableConfig.groupId) ? Math.trunc(tableConfig.groupId) : -1;

        const threshold = (rawDepth === -1 || rawDepth === 0) ? (settings.autoUpdateThreshold || 3) : Math.max(0, rawDepth);
        const frequency = (rawFreq === -1) ? globalFrequency : rawFreq;
        const skipFloors = Math.max(0, (rawSkip === -1) ? globalSkip : rawSkip);
        const groupId = rawGroupId;

        const history = historyBySheetKey.get(sheetKey);
        const lastUpdatedAiFloor = history?.lastCompletedAiFloor ?? 0;

        // 计算未记录楼层数
        const effectiveUnrecordedFloors = Math.max(0, (totalAiMessages - skipFloors) - lastUpdatedAiFloor);

        logDebug_ACU(`[Trigger Check] Table: ${table.name}, TotalAI: ${totalAiMessages}, Skip: ${skipFloors}, LastUpdated: ${lastUpdatedAiFloor}, Unrecorded: ${effectiveUnrecordedFloors}, Freq: ${frequency}`);

        // updateFrequency=0：该表不参与自动更新
        if (frequency > 0 && effectiveUnrecordedFloors >= frequency && threshold > 0) {
            const effectiveAiIndices = skipFloors > 0
                ? allAiMessageIndices.slice(0, -skipFloors)
                : allAiMessageIndices;

            const startIndexInAiArray = lastUpdatedAiFloor;

            logDebug_ACU(`[Trigger Check] EffIndicesLen: ${effectiveAiIndices.length}, StartIndex: ${startIndexInAiArray}`);

            if (startIndexInAiArray < effectiveAiIndices.length) {
                const unupdatedAiIndices = effectiveAiIndices.slice(startIndexInAiArray);
                const contextScopeIndices = effectiveAiIndices.slice(-threshold);

                logDebug_ACU(`[Trigger Check] Unupdated: ${unupdatedAiIndices.length}, ContextScope: ${contextScopeIndices.length}`);

                // 历史补填范围 = 完整待更新缺口（不再与 contextDepth 求交）。
                // 计划 §5.6：新增表历史前沿为 0 时必须能从第 1 楼补到当前楼，
                // 不能把 contextDepth（AI prompt 上下文窗口）当作历史补填范围。
                const indicesToUpdate = unupdatedAiIndices;
                const requiresBoundaryStaging = originalFullIndex >= 0
                    && indicesToUpdate.length > 0
                    && indicesToUpdate[0] < originalFullIndex;

                if (indicesToUpdate.length > 0) {
                    tablesToUpdate.push({
                        sheetKey,
                        sheetName: table.name,
                        indices: indicesToUpdate,
                        allIndices: indicesToUpdate,
                        requiresBoundaryStaging,
                        groupId,
                        batchSize: (rawBatch === -1) ? (settings.updateBatchSize || 3) : ((rawBatch > 0) ? rawBatch : (settings.updateBatchSize || 3)),
                        scheduleSignature: [groupId, threshold, frequency, skipFloors, rawBatch].join('|'),
                    });
                }
            }
        }
    }

    // 分组：将待更新的表按 (groupId + indices + batchSize + staging 归属) 进行分组。
    // 同组混合正常表与跨根表必须拆开（计划 §5.6）：staging 表走隔离提交，
    // 普通表走常规提交，两者不能混在一次统一提交中。
    const updateGroups: Record<string, UpdateGroup> = {};

    tablesToUpdate.forEach(item => {
        const key = item.scheduleSignature + '|' + item.indices.join(',') + '|' + item.batchSize + '|' + (item.requiresBoundaryStaging ? 'staging' : 'normal');
        if (!updateGroups[key]) {
            updateGroups[key] = {
                indices: item.indices,
                batchSize: item.batchSize,
                groupId: item.groupId,
                scheduleSignature: item.scheduleSignature,
                requiresBoundaryStaging: item.requiresBoundaryStaging,
                sheetKeys: [],
                sheetNames: []
            };
        }
        updateGroups[key].sheetKeys.push(item.sheetKey);
        updateGroups[key].sheetNames.push(item.sheetName);
    });

    performanceSpan.end({
        groupCount: Object.keys(updateGroups).length,
        changedSheetCount: tablesToUpdate.length,
    });
    return {
        tablesToUpdate,
        updateGroups,
        boundary: {
            fullCheckpointIndices: originalFullIndex >= 0 ? [originalFullIndex] : [],
            requiresBoundaryStaging: tablesToUpdate.some(item => item.requiresBoundaryStaging),
        },
    };
}

// ============================================================
// 前置检查
// ============================================================

/**
 * 检查自动更新的前置条件
 * 纯业务逻辑：不涉及 UI
 */
export function checkAutoUpdatePreConditions_ACU(
    settings: any,
): {
    canProceed: boolean;

    reason?: string;
    /** 稳定原因码：供诊断日志区分失败分支，不承诺为面向用户的文案 */
    code?: 'auto_update_disabled';
} {
    if (!settings.autoUpdateEnabled) {
        return { canProceed: false, reason: 'Auto update is disabled via settings.', code: 'auto_update_disabled' };
    }

    // 信号逐次串行调度；待填范围、请求和持久化校验由各自业务层负责。
    return { canProceed: true };
}
// ============================================================
// 执行编排
// ============================================================

/**
 * 自动更新计划的返回值
 */
export interface AutoUpdateResult {
    success: boolean;
    aborted?: boolean;
    failedGroups: number;
    totalGroups: number;
    errors?: string[];
    /** 稳定失败分类（spv8.9）：staging 组无可用 runner 时为 'staging_runner_unavailable'。 */
    diagnosticCode?: 'staging_runner_unavailable';
    /** 稳定结构化诊断字段：标记因缺少 staging runner 而失败的组 key；不含聊天内容。 */
    diagnostic?: { stagingGroupKeys: string[]; requiresBoundaryStaging: boolean; aiStarted: false };
    autoMergeTriggered?: boolean;
    autoMergeSuccess?: boolean;
}

/**
 * 自动更新计划的业务操作委托接口
 * 只包含纯业务操作（数据处理），不包含 UI 操作（toast/状态显示）
 */
export interface AutoUpdateOperations {
    processUpdates: (indices: number[], mode: string, options: any) => Promise<any>;
    processGroupedUpdates?: (groups: Array<{ key: string; groupId: number; indices: number[]; batchSize: number; sheetKeys: string[]; requestOptions: Record<string, any> | null }>, mode: string, options: any) => Promise<{ success: boolean; failedGroups: string[]; error?: string }>;
    /**
     * 跨 full checkpoint 边界分组的执行委托（由 orchestrator 提供共享 staging runner）。
     * 传入的是 requiresBoundaryStaging=true 的组；执行器负责 pre 段 stage_only、
     * 边界原子汇合与 post 段普通持久化。缺省时降级为 processGroupedUpdates。
     */
    processStagingGroupedUpdates?: (groups: Array<{ key: string; groupId: number; indices: number[]; batchSize: number; sheetKeys: string[]; requestOptions: Record<string, any> | null }>, mode: string, options: any) => Promise<{ success: boolean; failedGroups: string[]; error?: string }>;
    refreshData: () => Promise<any>;
    loadAllChatMessages: () => Promise<void>;
    purgeOldLayerData: () => Promise<void>;
}

/**
 * 执行自动更新计划：并发分组执行 + 自动合并检测 + 旧数据清理
 * 
 * 纯业务编排逻辑：决定执行顺序、并发策略、错误处理。
 * 不驱动 UI，只返回结果。presentation 层根据返回值自行决定 UI 操作。
 */
export async function executeAutoUpdatePlan_ACU(
    plan: AutoUpdatePlan,
    settings: any,
    setAutoUpdating: (v: boolean) => void,
    ops: AutoUpdateOperations,
    performanceContext?: { runId?: string; parentSpanId?: string },
    abortController: AbortController = new AbortController(),
): Promise<AutoUpdateResult> {
    const { tablesToUpdate, updateGroups } = plan;
    const groupKeys = Object.keys(updateGroups);
    if (groupKeys.length === 0) return { success: true, failedGroups: 0, totalGroups: 0 };
    const performanceSpan = startRuntimePerformanceSpan_ACU('auto-update-execute', {
        ...performanceContext,
        settings,
        metrics: { groupCount: groupKeys.length, sheetCount: tablesToUpdate.length },
    });

    const totalGroups = groupKeys.length;
    const cancelledResult = (): AutoUpdateResult => ({
        success: false, aborted: true, failedGroups: failedGroupKeys.length, totalGroups, errors: failedGroupErrors,
    });
    const maxConcurrentGroups = Math.max(1, settings.maxConcurrentGroups || 1);
    const failedGroupKeys: string[] = [];
    const failedGroupErrors: string[] = [];
    const runnerUnavailableGroupKeys: string[] = [];
    let executionStage = 'execute';
    const pushGroupError_ACU = (groupKey: string, error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error || '').trim();
        if (!message) return;
        failedGroupErrors.push(`group ${groupKey}: ${message}`);
    };
    // 跨 full checkpoint 边界组分离：staging 组必须与普通组分开调度，
    // 由共享 staging runner（processStagingGroupedUpdates）处理边界分段与原子汇合。
    const stagingGroupKeys = groupKeys.filter(key => updateGroups[key].requiresBoundaryStaging === true);
    const normalGroupKeys = groupKeys.filter(key => updateGroups[key].requiresBoundaryStaging !== true);
    const executeGroupChunk = async (
        chunkKeys: string[],
        runner: ((groups: Array<{ key: string; groupId: number; indices: number[]; batchSize: number; sheetKeys: string[]; requestOptions: Record<string, any> | null }>, mode: string, options: any) => Promise<{ success: boolean; failedGroups: string[]; error?: string }>),
    ): Promise<void> => {
        const groupedChunk = chunkKeys.map(key => {
            const group = updateGroups[key];
            logDebug_ACU(`[Parallel] Processing ${group.requiresBoundaryStaging ? 'staging' : 'grouped'} update for groupId=${group.groupId}, sheets: ${group.sheetNames.join(', ')}`);
            return {
                key,
                groupId: group.groupId,
                indices: group.indices,
                batchSize: group.batchSize,
                sheetKeys: group.sheetKeys,
                requestOptions: { skipProfileSwitch: true, forceDirectApi: true },
            };
        });
        const groupedOptions = performanceContext?.runId || performanceContext?.parentSpanId
            ? {
                ...(performanceContext.runId ? { performanceRunId: performanceContext.runId } : {}),
                performanceParentSpanId: performanceSpan.id,
            }
            : {};
        const groupedResult = await runner(groupedChunk, 'auto_independent', { ...groupedOptions, abortController });
        if ((groupedResult as { aborted?: boolean }).aborted) abortController.abort();
        logAutoFillStage_ACU('chunk_result', {
            runId: performanceContext?.runId, groupCount: chunkKeys.length, success: groupedResult.success,
        });
        if (!groupedResult.success) {
            logAutoFillSkip_ACU('execution_failed', {
                runId: performanceContext?.runId, stage: 'group', failedGroupCount: groupedResult.failedGroups.length,
            });
            failedGroupKeys.push(...groupedResult.failedGroups);
            const groupedError = groupedResult.error || '分组更新失败，未返回具体错误。';
            groupedResult.failedGroups.forEach(groupKey => pushGroupError_ACU(groupKey, groupedError));
        }
    };

    try {
      setAutoUpdating(true);

    // 调度顺序：先普通组（现有并发语义），再 staging 组（边界分段 + 原子汇合）。
    // staging 组不与普通组并发：边界汇合需要独占 run 级写集，混跑会破坏原子性。
    for (let start = 0; start < normalGroupKeys.length; start += maxConcurrentGroups) {
        if (abortController.signal.aborted) break;
        const chunkKeys = normalGroupKeys.slice(start, start + maxConcurrentGroups);
        if (ops.processGroupedUpdates) {
            await executeGroupChunk(chunkKeys, ops.processGroupedUpdates);
        } else {
            const groupPromises = chunkKeys.map(key => (async () => {
                const group = updateGroups[key];
                logDebug_ACU(`[Parallel] Processing group update for groupId=${group.groupId}, sheets: ${group.sheetNames.join(', ')}`);

                const success = await ops.processUpdates(group.indices, 'auto_independent', {
                    abortController,
                    planManaged: true,
                    targetSheetKeys: group.sheetKeys,
                    batchSize: group.batchSize,
                    ...(performanceContext?.runId ? { performanceRunId: performanceContext.runId } : {}),
                    requestOptions: { skipProfileSwitch: true, forceDirectApi: true }
                });

                if (success && typeof success === 'object' && success.aborted) abortController.abort();
                return { key, success, sheetNames: group.sheetNames };
            })());

            const results = await Promise.allSettled(groupPromises);
            results.forEach((result, idx) =>{
                if (result.status === 'rejected') {
                    failedGroupKeys.push(chunkKeys[idx]);
                    pushGroupError_ACU(chunkKeys[idx], result.reason || '分组更新异常退出。');
                    return;
                }
                const rawResult = result.value?.success;
                const groupSucceeded = typeof rawResult === 'object' && rawResult !== null && 'success' in rawResult
                    ? (rawResult as { success?: boolean }).success !== false
                    : !!rawResult;
                if (!groupSucceeded) {
                    failedGroupKeys.push(chunkKeys[idx]);
                    const error = rawResult && typeof rawResult === 'object' && 'error' in rawResult
                        ? (rawResult as { error?: unknown }).error
                        : '分组更新失败，未返回具体错误。';
                    pushGroupError_ACU(chunkKeys[idx], error);
                }
            });
        }
    }

    // staging 组：使用共享 staging runner（orchestrator 提供）。
    // spv8.9 硬化：跨 replay 根（requiresBoundaryStaging）的组绝不允许降级到普通
    // processUpdates —— 那会让写目标早于最新 full checkpoint 的 bucket 在 AI 消耗
    // token 后才被 persist 层 fail-fast，违背「AI 前准入」目标。无任何可用 runner 时
    // 必须把 staging 组记为稳定失败（staging_runner_unavailable），而不是退回普通执行。
    // 调用方（presentation）负责为 staging 提供 processStagingGroupedUpdates 接线。
    for (let start = 0; start < stagingGroupKeys.length; start += maxConcurrentGroups) {
        if (abortController.signal.aborted) break;
        const chunkKeys = stagingGroupKeys.slice(start, start + maxConcurrentGroups);
        const stagingRunner = ops.processStagingGroupedUpdates || ops.processGroupedUpdates;
        if (stagingRunner) {
            await executeGroupChunk(chunkKeys, stagingRunner);
        } else {
            // 无 staging/grouped runner：结构化失败，绝不用 legacy processUpdates 兜底。
            chunkKeys.forEach(key => {
                runnerUnavailableGroupKeys.push(key);
                failedGroupKeys.push(key);
                pushGroupError_ACU(key, 'staging_runner_unavailable：跨 replay 根的分组缺少 staging runner，已阻止本次填表。');
            });
        }
    }

    if (failedGroupKeys.length > 0) {
        logAutoFillSkip_ACU(runnerUnavailableGroupKeys.length ? 'staging_runner_unavailable' : 'execution_failed', {
            runId: performanceContext?.runId, stage: 'execute', groupCount: totalGroups,
            failedGroupCount: failedGroupKeys.length,
        });
    }

    // 并发更新完成后统一刷新数据链条
    executionStage = 'refresh';
    logAutoFillStage_ACU('refresh', { runId: performanceContext?.runId });
    logDebug_ACU(`All group updates completed. Forcing data refresh...`);
    await ops.loadAllChatMessages();
    await ops.refreshData();

    if (abortController.signal.aborted) {
        const result = cancelledResult();
        performanceSpan.end({ success: false, failedGroupCount: result.failedGroups });
        return result;
    }

    // 【已封存】自动合并纪要功能已遗弃：checkAutoMergeTrigger_ACU 恒返回不触发，
    // 本块永不进入合并流程，保留为存档（原因见 service/summary/merge-logic.ts 文件头）。
    let autoMergeTriggered = false;
    let autoMergeSuccess = false;
    try {
        const { checkAutoMergeTrigger_ACU, prepareAutoMergeBatches_ACU, executeAutoMergeBatch_ACU, finalizeAutoMerge_ACU } = await import('../summary/merge-logic');
        const trigger = checkAutoMergeTrigger_ACU();
        if (trigger.shouldTrigger) {
            autoMergeTriggered = true;
            const prepared = prepareAutoMergeBatches_ACU({
                startIndex: 0, endIndex: trigger.mergeCount, targetCount: 1,
                batchSize: 5, promptTemplate: '', isAutoMode: true,
            });
            let acc: any[] = [];
            for (let i = 0; i < prepared.batches.length; i++) {
                const batchResult = await executeAutoMergeBatch_ACU(prepared, prepared.batches[i], acc);
                acc = batchResult.accumulatedSummary;
            }
            await finalizeAutoMerge_ACU(prepared, acc);
            autoMergeSuccess = true;
        }
    } catch (e) {
        logWarn_ACU('自动合并总结检测失败:', e);
    }

    // 清理超出保留层数的旧数据
    try {
        await ops.purgeOldLayerData();
    } catch (e) {
        logWarn_ACU('清理旧层数据失败:', e);
    }

    const result = {
        success: failedGroupKeys.length === 0,
        failedGroups: failedGroupKeys.length,
        totalGroups,
        errors: failedGroupErrors,
        autoMergeTriggered,
        autoMergeSuccess,
        ...(runnerUnavailableGroupKeys.length > 0
            ? {
                diagnosticCode: 'staging_runner_unavailable' as const,
                diagnostic: {
                    stagingGroupKeys: runnerUnavailableGroupKeys,
                    requiresBoundaryStaging: true,
                    aiStarted: false as const,
                },
            }
            : {}),
    };
    performanceSpan.end({ success: result.success, failedGroupCount: result.failedGroups });
    return result;
    } catch (error) {
      performanceSpan.end({ success: false });
      setAutoUpdating(false);
      logAutoFillSkip_ACU(executionStage === 'refresh' ? 'refresh_failed' : 'execution_failed', {
          runId: performanceContext?.runId, stage: executionStage,
      });
      throw error;
    } finally {
      setAutoUpdating(false);
    }
}
