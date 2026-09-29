// merge-logic.ts
//
// ═══════════════════════════════════════════════════════════════
// 【已遗弃 · 封存】自动合并纪要（auto merge summary）
//
// 本功能已被正式遗弃，仅作代码存档，禁止恢复使用：
// 1. SQLite 模式下协议断裂：默认 SQL 合并提示词要求模型输出
//    INSERT INTO chronicle (...)，但本文件的解析器只识别 insertRow(...)，
//    自动合并在 SQLite 模式下必然失败（重试耗尽）。
// 2. 手动合并入口早已停用（见 presentation/triggers/update-trigger.ts 的停用壳）。
// 3. 本路径劫持主填表提示词壳但不做占位符替换，$0/$1/$4 等会原样发给模型。
//
// 封存方式：checkAutoMergeTrigger_ACU 无条件返回不触发，
// 使 update-orchestrator / update-scheduler 的两个调用点永不进入合并流程。
// 其余函数保留为历史存档，不再有生产调用路径。
// ═══════════════════════════════════════════════════════════════

import { DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_ACU } from '../../shared/defaults-json.js';
import { isSqliteMode } from '../table/storage-mode';
import { handleApiResponse_ACU } from '../ai/prompt-builder';
import { buildCustomApiRequestBody_ACU } from '../ai/api-call';
import { currentJsonTableData_ACU, settings_ACU } from '../runtime/state-manager';
import { sendConnectionManagerRequest_ACU, isGenerateRawAvailable_ACU, generateRaw_ACU } from '../../data/gateways/ai-gateway';
import { getLastMessageIndex_ACU } from '../../data/gateways/chat-gateway';
import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
import { pristineFetch_ACU } from '../../data/gateways/pristine-fetch';
import { updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { runTableUpdateCommit_ACU } from '../table/table-update-commit';
import { extractTableEditInner_ACU } from '../ai/prompt-builder';

// ═══ 自动合并纪要：触发检查 ═══

function isAutoMergedSummaryRow_ACU(summaryKey: string, row: unknown): boolean {
    if (!Array.isArray(row)) return false;
    const rowId = String(row[0] ?? '').trim();
    const storedOrder = settings_ACU.autoMergedOrder?.[summaryKey];
    return (Array.isArray(storedOrder) && storedOrder.some((id: unknown) => String(id) === rowId))
        || row[row.length - 1] === 'auto_merged';
}

function getAutoMergedOrder_ACU(summaryKey: string): string[] {
    const storedOrder = settings_ACU.autoMergedOrder?.[summaryKey];
    return Array.isArray(storedOrder) ? storedOrder.map((id: unknown) => String(id)) : [];
}

export function checkAutoMergeTrigger_ACU(): { shouldTrigger: boolean; mergeCount?: number; summaryCount?: number; reserve?: number } {
    // 【封存】自动合并纪要已遗弃（原因见文件头横幅），无条件不触发。
    // 即使用户旧设置里 autoMergeEnabled 为 true 也不再执行。
    return { shouldTrigger: false };

    // ↓↓↓ 以下为封存前的原始触发逻辑，注释保留为存档 ↓↓↓
    //
    // if (!settings_ACU.autoMergeEnabled) return { shouldTrigger: false };
    //
    // const summaryKey = Object.keys(currentJsonTableData_ACU).find(k =>
    //     currentJsonTableData_ACU[k].name === '纪要表' ||
    //     currentJsonTableData_ACU[k].name === '总结表'
    // );
    //
    // if (!summaryKey) return { shouldTrigger: false };
    //
    // const summaryCount = (currentJsonTableData_ACU[summaryKey].content || [])
    //     .slice(1)
    //     .filter((row: any) => !isAutoMergedSummaryRow_ACU(summaryKey, row))
    //     .length;
    //
    // const threshold = settings_ACU.autoMergeThreshold || 20;
    // const reserve = settings_ACU.autoMergeReserve || 0;
    // const triggerThreshold = threshold + reserve;
    //
    // if (summaryCount < triggerThreshold) return { shouldTrigger: false };
    //
    // const mergeCount = summaryCount - reserve;
    // if (mergeCount <= 0) return { shouldTrigger: false };
    //
    // return { shouldTrigger: true, mergeCount, summaryCount, reserve };
}

// ═══ 自动合并纪要：准备批次 ═══

export interface AutoMergeBatch {
    batchIndex: number;
    batchRows: any[];
    globalStartOffset: number;
}

export interface AutoMergePrepared {
    summaryKey: string;
    batches: AutoMergeBatch[];
    targetCount: number;
    promptTemplate: string;
    isAutoMode: boolean;
    startIndex: number;
    endIndex: number;
}

export function prepareAutoMergeBatches_ACU(options: {
    startIndex: number;
    endIndex: number;
    targetCount: number;
    batchSize: number;
    promptTemplate: string;
    isAutoMode: boolean;
}): AutoMergePrepared {
    const { startIndex, endIndex, targetCount, batchSize, promptTemplate, isAutoMode } = options;

    const summaryKey = Object.keys(currentJsonTableData_ACU).find(k =>
        currentJsonTableData_ACU[k].name === '纪要表' ||
        currentJsonTableData_ACU[k].name === '总结表'
    );

    if (!summaryKey) throw new Error('未找到纪要表');

    let allSummaryRows = (currentJsonTableData_ACU[summaryKey].content || [])
        .slice(1)
        .filter((row: any) => !isAutoMergedSummaryRow_ACU(summaryKey, row));

    allSummaryRows = allSummaryRows.slice(startIndex, endIndex);

    const batches: AutoMergeBatch[] = [];
    for (let i = 0; i < allSummaryRows.length; i += batchSize) {
        batches.push({
            batchIndex: batches.length,
            batchRows: allSummaryRows.slice(i, i + batchSize),
            globalStartOffset: (startIndex + 1) + i,
        });
    }

    return { summaryKey, batches, targetCount, promptTemplate, isAutoMode, startIndex, endIndex };
}

// ═══ 自动合并纪要：执行单个批次 ═══

export async function executeAutoMergeBatch_ACU(
    prepared: AutoMergePrepared,
    batch: AutoMergeBatch,
    accumulatedSummary: any[],
): Promise<{ accumulatedSummary: any[] }> {
    const { summaryKey, targetCount, promptTemplate, isAutoMode } = prepared;
    const { batchRows, globalStartOffset, batchIndex } = batch;

    const summaryTableObj = currentJsonTableData_ACU[summaryKey];

    const usedSummaryRowIds = new Set<string>([
        ...(Array.isArray(summaryTableObj?.content) ? summaryTableObj.content.slice(1) : []),
        ...accumulatedSummary,
    ].filter(Array.isArray).map((row: any[]) => String(row[0] ?? '').trim()).filter(Boolean));
    let nextSummaryRowId = (() => {
        const numericIds = [...usedSummaryRowIds]
            .filter(rowId => /^\d+$/.test(rowId))
            .map(rowId => Number(rowId))
            .filter(Number.isSafeInteger);
        return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
    })();
    const allocateSummaryRowId = (): string => {
        while (usedSummaryRowIds.has(String(nextSummaryRowId))) nextSummaryRowId += 1;
        const rowId = String(nextSummaryRowId);
        usedSummaryRowIds.add(rowId);
        nextSummaryRowId += 1;
        return rowId;
    };

    const formatRows = (rows: any[], globalStartIndex: number) => rows.map((r: any[], idx: number) => `[${globalStartIndex + idx}] ${r.slice(1).join(', ')}`).join('\n');
    const textA = batchRows.length > 0 ? formatRows(batchRows, globalStartOffset) : "(本批次无新增纪要数据)";

    let textBase = "";

    const formatTableStructure = (tableName: string, currentRows: any[], originalTableObj: Record<string, any>) => {
        let str = `[0:${tableName}]\n`;
        const headers = originalTableObj.content[0] ? originalTableObj.content[0].slice(1).map((h: any, i: number) => `[${i}:${h}]`).join(', ') : 'No Headers';
        str += `  Columns: ${headers}\n`;
        if (originalTableObj.sourceData) {
            str += `  - Note: ${originalTableObj.sourceData.note || 'N/A'}\n`;
        }
        if (currentRows && currentRows.length > 0) {
            currentRows.forEach((row: any[], rIdx: number) => { str += `  [${rIdx}] ${row.join(', ')}\n`; });
        } else {
            str += `  (Table Empty - No rows yet)\n`;
        }
        return str + "\n";
    };

    const getExistingAutoMergedRows = (tableObj: Record<string, any>, count: number = 1) => {
        if (!tableObj || !tableObj.content) return [];
        const allRows = tableObj.content.slice(1);
        const autoMergedRows = allRows.filter((row: any) => isAutoMergedSummaryRow_ACU(summaryKey, row));
        if (!autoMergedRows.length) return [];
        const n = Number.isFinite(count) ? Math.max(0, count) : 0;
        if (n <= 0) return [];
        const order = getAutoMergedOrder_ACU(summaryKey);
        const rank = new Map(order.map((rowId, index) => [rowId, index]));
        return autoMergedRows
            .slice()
            .sort((left: any, right: any) => (rank.get(String(left?.[0] ?? '')) ?? -1) - (rank.get(String(right?.[0] ?? '')) ?? -1))
            .slice(-n);
    };

    const existingSummaryAutoMerged = summaryTableObj ? getExistingAutoMergedRows(summaryTableObj, 1) : [];
    const summaryBaseData = [...existingSummaryAutoMerged, ...accumulatedSummary];

    if (summaryTableObj) textBase += formatTableStructure(summaryTableObj.name, summaryBaseData, summaryTableObj);

    let currentPrompt = promptTemplate.replace('$TARGET_COUNT', String(targetCount)).replace('$A', textA).replace('$BASE_DATA', textBase);

    let aiResponseText = "";
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const messagesToUse = JSON.parse(JSON.stringify(settings_ACU.charCardPrompt || [isSqliteMode() ? DEFAULT_CHAR_CARD_PROMPT_SQL_ACU : DEFAULT_CHAR_CARD_PROMPT_ACU]));
            const mainPromptSegment =
                messagesToUse.find((m: any) => (String(m?.mainSlot || '').toUpperCase() === 'A') || m?.isMain) ||
                messagesToUse.find((m: any) => m && m.content && m.content.includes("你接下来需要扮演一个填表用的美杜莎"));
            if (mainPromptSegment) {
                mainPromptSegment.content = currentPrompt;
            } else {
                messagesToUse.push({ role: 'USER', content: currentPrompt });
            }
            const finalMessages = messagesToUse.map((m: any) => ({ role: m.role.toLowerCase(), content: m.content }));

            if (settings_ACU.apiMode === 'tavern') {
                const result = await sendConnectionManagerRequest_ACU(settings_ACU.tavernProfile, finalMessages, settings_ACU.apiConfig.max_tokens ?? settings_ACU.apiConfig.maxTokens ?? 4096);
                if (result && result.ok) aiResponseText = result.result.choices[0].message.content;
                else throw new Error('API请求返回不成功状态');
            } else {
                if (settings_ACU.apiConfig.useMainApi) {
                    aiResponseText = isGenerateRawAvailable_ACU()
                        ? await generateRaw_ACU({ ordered_prompts: finalMessages, should_stream: settings_ACU.streamingEnabled || false })
                        : '';
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
                throw new Error('AI未返回有效的 <tableEdit> 块');
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
                            rowData = dataColumns;
                        }
                        if (!Array.isArray(rowData)) throw new Error('insertRow 数据必须是对象或数组。');
                        rowData = [allocateSummaryRowId(), ...rowData];
                        const header = Array.isArray(summaryTableObj?.content?.[0]) ? summaryTableObj.content[0] : null;
                        if (header) {
                            if (rowData.length > header.length) throw new Error('自动合并结果列数超过纪要表表头。');
                            while (rowData.length < header.length) rowData.push('');
                        }
                        if (tableIdx === 0 && summaryKey) newSummaryRows.push(rowData);
                    } catch (e) { logWarn_ACU('解析行失败:', line, e); }
                }
            });

            if (newSummaryRows.length === 0) {
                throw new Error('AI返回了内容，但未能解析出任何有效的数据行。');
            }

            return { accumulatedSummary: accumulatedSummary.concat(newSummaryRows) };

        } catch (e) {
            logWarn_ACU(`自动合并批次 ${batchIndex + 1} 尝试 ${attempt} 失败: ${e.message}`);
            if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    throw new Error(`批次 ${batchIndex + 1} 在 ${maxRetries} 次尝试后均失败`);
}

// ═══ 自动合并纪要：写回结果 ═══

export async function finalizeAutoMerge_ACU(
    prepared: AutoMergePrepared,
    accumulatedSummary: any[],
): Promise<{ mergedRows: number }> {
    const { summaryKey, endIndex } = prepared;

    if (!summaryKey || accumulatedSummary.length === 0) return { mergedRows: 0 };

    const table = currentJsonTableData_ACU[summaryKey];
    const originalContent = table.content.slice(1);

    let actualEndIndex = 0;
    let foundCount = 0;
    for (let i = 0; i < originalContent.length; i++) {
        const row = originalContent[i];
        if (!isAutoMergedSummaryRow_ACU(summaryKey, row)) {
            foundCount++;
            if (foundCount === endIndex) {
                actualEndIndex = i + 1;
                break;
            }
        }
    }

    const existingAutoMergedRows = originalContent.filter((row: any) => isAutoMergedSummaryRow_ACU(summaryKey, row));
    const remainingRows = originalContent.slice(actualEndIndex);

    const newSummaryContent = [
        ...existingAutoMergedRows,
        ...accumulatedSummary,
        ...remainingRows.filter((row: any) => !isAutoMergedSummaryRow_ACU(summaryKey, row))
    ];
    table.content = [table.content[0], ...newSummaryContent];

    if (!settings_ACU.autoMergedOrder) settings_ACU.autoMergedOrder = {} as Record<string, any>;
    if (!settings_ACU.autoMergedOrder[summaryKey]) settings_ACU.autoMergedOrder[summaryKey] = [] as any[];

    const orderList: any[] = settings_ACU.autoMergedOrder[summaryKey];
    accumulatedSummary.forEach((row: any[]) => {
        if (row && row[0] !== null && row[0] !== undefined && !orderList.includes(row[0])) {
            orderList.push(row[0]);
        }
    });

    const keysToSave = [summaryKey];
    const writeSet = keysToSave.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
    await runTableUpdateCommit_ACU<null>({
        source: 'merge_summary',
        reason: 'auto_merge_summary',
        writeSet,
        revisionWriteSet: writeSet,
        initialData: currentJsonTableData_ACU as any,
        targetMessageIndex: getLastMessageIndex_ACU(),
        targetSheetKeys: keysToSave,
        updateGroupKeys: keysToSave,
        trackingSheetKeys: keysToSave,
        trackAsUpdate: true,
        operations: [{ kind: 'sheet_replace', sheetKey: summaryKey, sheet: (currentJsonTableData_ACU as any)[summaryKey], reason: 'system' }],
    }, () => ({
        success: true,
        value: null,
        tableData: currentJsonTableData_ACU as any,
        mutationResult: { changes: keysToSave.length, errors: [] },
    }));
    await updateReadableLorebookEntry_ACU(true);

    return { mergedRows: accumulatedSummary.length };
}
