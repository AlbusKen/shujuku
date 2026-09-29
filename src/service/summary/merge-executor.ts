/**
 * service/summary/merge-executor.ts — 手动合并纪要核心执行逻辑
 * 从 presentation/triggers/update-trigger.ts 的 handleManualMergeSummary_ACU 中提取
 * 
 * 只负责「构建 prompt + 调用 AI + 解析结果 + 累积合并」，不涉及 UI（toast/按钮/进度条）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 【已遗弃 · 封存】合并纪要功能整体已遗弃：
 * - 手动合并 UI 入口已在 update-trigger.ts 停用（点击只弹「功能已停用」提示）；
 * - 自动合并触发已在 merge-logic.ts 的 checkAutoMergeTrigger_ACU 封存（恒不触发）；
 * - 遗弃原因见 merge-logic.ts 文件头横幅（SQLite 协议断裂、占位符未替换等）。
 * 本文件仅作代码存档，禁止新增生产调用路径。
 * ═══════════════════════════════════════════════════════════════
 */

import { DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU } from '../../shared/defaults-json.js';
import { isSqliteMode } from '../table/storage-mode';
import { sendConnectionManagerRequest_ACU, generateRaw_ACU, getHostRequestHeaders_ACU } from '../ai/ai-service';
import { pristineFetch_ACU } from '../../data/gateways/pristine-fetch';
import { extractTableEditInner_ACU, handleApiResponse_ACU } from '../ai/prompt-builder';
import { buildCustomApiRequestBody_ACU } from '../ai/api-call';
import { currentJsonTableData_ACU, settings_ACU, isAutoUpdatingCard_ACU, _set_isAutoUpdatingCard_ACU, _set_wasStoppedByUser_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { loadAllChatMessages_ACU, updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../table/table-service';
import { runTableUpdateCommit_ACU } from '../table/table-update-commit';
import { getLastMessageIndex_ACU } from '../chat/chat-service';

export interface MergeBatchConfig {
    summaryKey: string;
    allSummaryRows: any[];
    fullSummaryRows: any[];
    startIndex: number;
    targetCount: number;
    batchSize: number;
    promptTemplate: string;
    maxRetries?: number;
}

export interface MergeBatchResult {
    success: boolean;
    accumulatedSummary: any[];
    error?: string;
    failedBatchIndex?: number;
}

/**
 * 从指定范围之前的原表格数据中取最近 N 条记录
 */
export function pickLastRowsBeforeIndex_ACU(allRows: any[], beforeIndex: number, count: number): any[] {
    if (!Array.isArray(allRows) || allRows.length === 0) return [];
    const end = Math.max(0, Math.min(Number.isFinite(beforeIndex) ? beforeIndex : 0, allRows.length));
    const start = Math.max(0, end - (Number.isFinite(count) ? count : 0));
    return allRows.slice(start, end);
}

/**
 * 格式化表格结构（用于 prompt 中的 $BASE_DATA）
 */
export function formatTableStructure(tableName: string, currentRows: any[], originalTableObj: Record<string, any>, tableIndex: number): string {
    let str = `[${tableIndex}:${tableName}]\n`;
    const headers = originalTableObj.content[0] ? originalTableObj.content[0].slice(1).map((h: any, i: number) => `[${i}:${h}]`).join(', ') : 'No Headers';
    str += `  Columns: ${headers}\n`;
    if (originalTableObj.sourceData) {
        str += `  - Note: ${originalTableObj.sourceData.note || 'N/A'}\n`;
    }
    if (currentRows && currentRows.length > 0) {
        currentRows.forEach((row: any, rIdx: number) => { str += `  [${rIdx}] ${row.join(', ')}\n`; });
    } else {
        str += `  (Table Empty - No rows yet)\n`;
    }
    return str + "\n";
}

/**
 * 执行合并纪要的所有批次
 * 
 * @param config - 合并配置
 * @param onBatchProgress - 批次进度回调（可选，用于 UI 更新）
 * @param checkAbort - 中止检查回调（可选，返回 true 表示应中止）
 * @returns MergeBatchResult
 */
export async function executeMergeBatches_ACU(
    config: MergeBatchConfig,
    onBatchProgress?: (batchIndex: number, totalBatches: number, attempt: number, maxRetries: number) => void,
    checkAbort?: () => boolean
): Promise<MergeBatchResult> {
    const { summaryKey, allSummaryRows, fullSummaryRows, startIndex, targetCount, batchSize, promptTemplate, maxRetries = 3 } = config;
    const totalBatches = Math.ceil(allSummaryRows.length / batchSize);
    let accumulatedSummary: any[] = [];

    for (let i = 0; i < totalBatches; i++) {
        if (checkAbort?.()) {
            return { success: false, accumulatedSummary, error: '用户终止操作', failedBatchIndex: i };
        }

        const startIdx = i * batchSize;
        const endIdx = startIdx + batchSize;
        const batchSummaryRows = allSummaryRows.slice(startIdx, endIdx);

        const formatRows = (rows: any[], displayStartIndex: number) => rows.map((r: any, idx: number) => `[${displayStartIndex + idx}] ${r.slice(1).join(', ')}`).join('\n');
        const textA = batchSummaryRows.length > 0 ? formatRows(batchSummaryRows, (startIndex + 1) + startIdx) : "(本批次无新增纪要数据)";

        let textBase = "";
        const summaryTableObj = currentJsonTableData_ACU[summaryKey];

        // 为 $BASE_DATA 准备数据
        const summaryBaseData = (i === 0)
            ? pickLastRowsBeforeIndex_ACU(fullSummaryRows, startIndex, 2)
            : accumulatedSummary.slice();

        if (summaryTableObj) textBase += formatTableStructure(summaryTableObj.name, summaryBaseData, summaryTableObj, 0);

        let currentPrompt = promptTemplate.replace('$TARGET_COUNT', String(targetCount)).replace('$A', textA).replace('$BASE_DATA', textBase);

        let aiResponseText = "";
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (checkAbort?.()) {
                return { success: false, accumulatedSummary, error: '用户终止操作', failedBatchIndex: i };
            }

            onBatchProgress?.(i, totalBatches, attempt, maxRetries);

            let messagesToUse = JSON.parse(JSON.stringify(settings_ACU.charCardPrompt || [isSqliteMode() ? DEFAULT_CHAR_CARD_PROMPT_SQL_ACU : DEFAULT_CHAR_CARD_PROMPT_ACU]));
            let mainPromptSegment =
                messagesToUse.find((m: any) => (String(m?.mainSlot || '').toUpperCase() === 'A') || m?.isMain) ||
                messagesToUse.find((m: any) => m && m.content && m.content.includes("你接下来需要扮演一个填表用的美杜莎"));
            if (mainPromptSegment) {
                mainPromptSegment.content = currentPrompt;
            } else {
                messagesToUse.push({ role: 'USER', content: currentPrompt });
            }
            const finalMessages = messagesToUse.map((m: any) => ({ role: m.role.toLowerCase(), content: m.content }));

            try {
                if (settings_ACU.apiMode === 'tavern') {
                    const result = await sendConnectionManagerRequest_ACU(settings_ACU.tavernProfile, finalMessages, settings_ACU.apiConfig.max_tokens ?? settings_ACU.apiConfig.maxTokens ?? 4096);
                    if (result && result.ok) aiResponseText = result.result.choices[0].message.content;
                    else throw new Error('API请求返回不成功状态');
                } else {
                    if (settings_ACU.apiConfig.useMainApi) {
                        aiResponseText = await generateRaw_ACU({ ordered_prompts: finalMessages, should_stream: settings_ACU.streamingEnabled || false });
                    } else {
                        const res = await pristineFetch_ACU(`/api/backends/chat-completions/generate`, {
                            method: 'POST',
                            headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' },
                            body: JSON.stringify(buildCustomApiRequestBody_ACU(finalMessages, settings_ACU.apiConfig, { stripModelPrefix: false }))
                        });
                        if (!res.ok) throw new Error(`API请求失败: ${res.status} ${await res.text()}`);
                        aiResponseText = await handleApiResponse_ACU(res);
                        if (!aiResponseText) throw new Error('API返回的数据格式不正确');
                    }
                }

                const extractResult = extractTableEditInner_ACU(aiResponseText, { allowNoTableEditTags: true });
                if (!extractResult || !extractResult.inner) {
                    throw new Error('AI未返回有效的 <tableEdit> 块（缺少 <tableEdit> 边界或 <!-- --> 注释块不完整）。');
                }

                const editsString = extractResult.inner;
                const newSummaryRows: any[] = [];

                editsString.split('\n').forEach((line: string) => {
                    const match = line.trim().match(/insertRow\s*\(\s*(\d+)\s*,\s*(\{.*?\}|\[.*?\])\s*\)/);
                    if (match) {
                        try {
                            const tableIdx = parseInt(match[1], 10);
                            let rowData = JSON.parse(match[2].replace(/'/g, '"'));
                            if (typeof rowData === 'object' && !Array.isArray(rowData)) {
                                const sortedKeys = Object.keys(rowData).sort((a: string, b: string) => parseInt(a) - parseInt(b));
                                const dataColumns = sortedKeys.map((k: string) => rowData[k]);
                                rowData = [null, ...dataColumns];
                            }
                            if (tableIdx === 0 && summaryKey) newSummaryRows.push(rowData);
                        } catch (e) { logWarn_ACU('解析行失败:', line, e); }
                    }
                });

                if (newSummaryRows.length === 0) {
                    throw new Error('AI返回了内容，但未能解析出任何有效的数据行。');
                }

                accumulatedSummary = accumulatedSummary.concat(newSummaryRows);
                lastError = null;
                break;
            } catch (e) {
                lastError = e;
                logWarn_ACU(`批次 ${i + 1} 尝试 ${attempt} 失败: ${e.message}`);
                if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        if (lastError) {
            return { success: false, accumulatedSummary, error: `批次 ${i + 1} 在 ${maxRetries} 次尝试后均失败: ${lastError.message}`, failedBatchIndex: i };
        }
    }

    return { success: true, accumulatedSummary };
}

// ============================================================
// 前置校验和结果写入（从 update-trigger.ts 提取）
// ============================================================

export interface MergeValidationResult {
    valid: boolean;
    error?: string;
    summaryKey?: string;
    allSummaryRows?: any[];
    fullSummaryRows?: any[];
    startIndex?: number;
    actualEndIndex?: number;
    selectedRange?: number;
    promptTemplate?: string;
    batchSize?: number;
    targetCount?: number;
}

/**
 * 验证合并纪要参数并返回处理所需的数据
 * 纯业务逻辑，不涉及 UI
 */
export function validateMergeParams_ACU(defaultMergePrompt: string): MergeValidationResult {
    const apiIsConfigured = (settings_ACU.apiMode === 'custom' && (settings_ACU.apiConfig.useMainApi || (settings_ACU.apiConfig.url && settings_ACU.apiConfig.model))) || (settings_ACU.apiMode === 'tavern' && settings_ACU.tavernProfile);
    if (!apiIsConfigured) {
        return { valid: false, error: '请先配置API连接。' };
    }

    if (!currentJsonTableData_ACU) {
        return { valid: false, error: '数据库未加载。' };
    }

    const targetCount = settings_ACU.mergeTargetCount || 1;
    const batchSize = settings_ACU.mergeBatchSize || 5;
    const startIndex = Math.max(0, (settings_ACU.mergeStartIndex || 1) - 1);
    const endIndex = settings_ACU.mergeEndIndex ? Math.max(startIndex + 1, settings_ACU.mergeEndIndex) : null;
    const promptTemplate = settings_ACU.mergeSummaryPrompt || defaultMergePrompt;

    if (!promptTemplate) {
        return { valid: false, error: '提示词模板不能为空。' };
    }

    // 查找纪要表
    const summaryKey = Object.keys(currentJsonTableData_ACU).find(k =>
        currentJsonTableData_ACU[k].name === '纪要表' ||
        currentJsonTableData_ACU[k].name === '总结表'
    );

    if (!summaryKey) {
        return { valid: false, error: '未找到"纪要表"，无法进行合并。' };
    }

    const fullSummaryRows = summaryKey ? (currentJsonTableData_ACU[summaryKey].content || []).slice(1) : [];

    if (fullSummaryRows.length === 0) {
        return { valid: false, error: '当前没有纪要数据需要合并。' };
    }

    const maxRows = fullSummaryRows.length;

    if (startIndex >= maxRows) {
        return { valid: false, error: `起始条数超出可用数据范围。可用数据: ${maxRows} 条` };
    }

    const actualEndIndex = endIndex ? Math.min(endIndex, maxRows) : maxRows;
    if (startIndex >= actualEndIndex) {
        return { valid: false, error: '起始条数不能大于或等于终止条数。' };
    }

    const allSummaryRows = fullSummaryRows.slice(startIndex, actualEndIndex);
    const selectedRange = actualEndIndex - startIndex;

    if (allSummaryRows.length === 0) {
        return { valid: false, error: `指定范围内没有纪要数据需要合并。范围: 第${startIndex + 1}条 到 第${actualEndIndex}条` };
    }

    return {
        valid: true,
        summaryKey,
        allSummaryRows,
        fullSummaryRows,
        startIndex,
        actualEndIndex,
        selectedRange,
        promptTemplate,
        batchSize,
        targetCount,
    };
}

/**
 * 将合并结果写入数据库
 * 纯业务逻辑，不涉及 UI
 */
export function applyMergeResult_ACU(
    summaryKey: string,
    accumulatedSummary: any[],
    startIndex: number,
    actualEndIndex: number
): void {
    if (summaryKey && accumulatedSummary.length > 0) {
        const table = currentJsonTableData_ACU[summaryKey];
        const originalContent = table.content.slice(1);
        const newSummaryContent = [
            ...originalContent.slice(0, startIndex),
            ...accumulatedSummary,
            ...originalContent.slice(actualEndIndex)
        ];
        table.content = [table.content[0], ...newSummaryContent];
    }
}

// ============================================================
// 手动合并纪要编排（纯业务逻辑）
// ============================================================

/** 手动合并纪要的返回值 */
export interface ManualMergeResult {
    success: boolean;
    error?: string;
}

/** 手动合并纪要的确认信息（用于 presentation 层显示 confirm 弹窗） */
export interface MergeConfirmInfo {
    startIndex: number;
    actualEndIndex: number;
    selectedRange: number;
    allSummaryRowsCount: number;
    targetCount: number;
}

/**
 * 手动合并纪要的前置准备：刷新数据 + 校验参数
 * 纯业务逻辑，不涉及 UI
 * @returns 校验结果，包含确认信息供 presentation 层显示
 */
export async function prepareMergeSummary_ACU(defaultMergePrompt: string): Promise<{
    valid: boolean;
    error?: string;
    confirmInfo?: MergeConfirmInfo;
    validation?: MergeValidationResult;
}> {
    if (isAutoUpdatingCard_ACU) {
        return { valid: false, error: '后台已有任务在运行，请稍候。' };
    }

    // 刷新内存数据库
    try {
        await loadAllChatMessages_ACU();
        await loadOrCreateJsonTableFromChatHistory_ACU();
    } catch (e) {
        logWarn_ACU('[手动合并纪要] 合并前刷新数据库失败，将继续使用当前内存数据:', e);
    }

    // 校验参数
    const validation = validateMergeParams_ACU(defaultMergePrompt);
    if (!validation.valid) {
        return { valid: false, error: validation.error };
    }

    return {
        valid: true,
        confirmInfo: {
            startIndex: validation.startIndex!,
            actualEndIndex: validation.actualEndIndex!,
            selectedRange: validation.selectedRange!,
            allSummaryRowsCount: validation.allSummaryRows!.length,
            targetCount: validation.targetCount!,
        },
        validation,
    };
}

/**
 * 执行手动合并纪要：执行批次 + 写入结果 + 保存 + 更新世界书
 * 纯业务逻辑，不涉及 UI。
 * @param validation - prepareMergeSummary 返回的校验结果
 * @param onBatchProgress - 可选的进度回调（传递纯数据）
 * @param checkAbort - 可选的中止检查回调
 */
export async function executeManualMergeSummary_ACU(
    validation: MergeValidationResult,
    onBatchProgress?: (batchIndex: number, totalBatches: number, attempt: number, maxRetries: number) => void,
    checkAbort?: () => boolean
): Promise<ManualMergeResult> {
    const { summaryKey, allSummaryRows, fullSummaryRows, startIndex, actualEndIndex, promptTemplate, batchSize, targetCount } = validation;

    _set_wasStoppedByUser_ACU(false);
    _set_isAutoUpdatingCard_ACU(true);

    try {
        const mergeResult = await executeMergeBatches_ACU(
            {
                summaryKey: summaryKey!,
                allSummaryRows: allSummaryRows!,
                fullSummaryRows: fullSummaryRows!,
                startIndex: startIndex!,
                targetCount: targetCount!,
                batchSize: batchSize!,
                promptTemplate: promptTemplate!,
                maxRetries: 3
            },
            onBatchProgress,
            checkAbort
        );

        if (!mergeResult.success) {
            return { success: false, error: mergeResult.error || '合并失败' };
        }

        // 写入结果
        applyMergeResult_ACU(summaryKey!, mergeResult.accumulatedSummary, startIndex!, actualEndIndex!);

        // 保存到聊天记录
        const keysToSave = [summaryKey!];
        const writeSet = keysToSave.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
        await runTableUpdateCommit_ACU<null>({
            source: 'merge_summary',
            reason: 'manual_merge_summary',
            writeSet,
            revisionWriteSet: writeSet,
            initialData: currentJsonTableData_ACU as any,
            targetMessageIndex: getLastMessageIndex_ACU(),
            targetSheetKeys: keysToSave,
            updateGroupKeys: keysToSave,
            trackingSheetKeys: keysToSave,
            trackAsUpdate: true,
            operations: [{ kind: 'sheet_replace', sheetKey: summaryKey!, sheet: (currentJsonTableData_ACU as any)[summaryKey!], reason: 'system' }],
        }, () => ({
            success: true,
            value: null,
            tableData: currentJsonTableData_ACU as any,
            mutationResult: { changes: keysToSave.length, errors: [] },
        }));

        // 更新世界书
        await updateReadableLorebookEntry_ACU(true);

        return { success: true };
    } catch (e: any) {
        logError_ACU('合并过程出错:', e);
        return { success: false, error: e.message || '合并过程出错' };
    } finally {
        _set_isAutoUpdatingCard_ACU(false);
        _set_wasStoppedByUser_ACU(false);
    }
}
