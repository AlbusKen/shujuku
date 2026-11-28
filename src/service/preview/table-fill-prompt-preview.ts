/**
 * service/preview/table-fill-prompt-preview.ts — 填表提示词只读预览
 *
 * 三条真实管线各取「第一个将发出的请求」做干跑：
 *  - auto         ：buildAutoUpdatePlan_ACU 的首个普通组首个未跳过批（update-orchestrator.ts:2486-2688 切法）；
 *  - manual_refill：orchestrateManualUpdate_ACU 纯计算段（update-orchestrator.ts:5104-5181）的第一组第一批；
 *  - catch_up     ：prepareManualCatchUpPlan_ACU（update-orchestrator.ts:4026-4079）的第一波第一组
 *                   （波内 segment 拆分只影响写路径 staging，预览直接用 wave.messageIndices）。
 * 零副作用红线：不进入 callCustomOpenAI_ACU 的接管/中止全局副作用，不触碰
 * ensureManualCatchUpAnchorBeforeTarget_ACU / clearManualRefillSheetDataInRange 等任何写路径，
 * 世界书读取经 createLorebookReadContext_ACU({source:'form_fill'}) 只读上下文并在 finally dispose。
 */
import { settings_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, pendingFinalGenerationGreenlights_ACU } from '../runtime/state-manager';
import { getChatArray_ACU } from '../chat/chat-service';
import { prepareAIInput_ACU } from '../ai/prompt-builder/prompt-prepare';
import { renderTableFillMessages_ACU } from '../ai/prompt-builder/prompt-api-call';
import { getApiConfigByPreset_ACU, buildCustomApiRequestBody_ACU, requireResolvedApiPreset_ACU } from '../ai/api-call';
import { isSqliteMode } from '../table/storage-mode';
import { cloneStrictPromptSegments_ACU, buildStrictJsonTableFillResponseFormatForData_ACU } from '../ai/prompt-builder/strict-json-table-fill';
import { buildTableFillNativeTools_ACU } from '../ai/prompt-builder/table-fill-tools';
import { isNativeToolChannelAvailable_ACU } from '../ai/agent-tool-mode';
import { estimateTextTk_ACU } from '../../shared/token-estimate';
import { parseTableTemplateJson_ACU, isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { resolveCurrentChatFillMode_ACU } from '../fill-mode/fill-mode-chat-record';
import { buildAutoUpdatePlan_ACU } from '../table/update-scheduler';
import { resolveUpdateMode_ACU, resolveTableApiPresetOverride_ACU } from '../table/update-orchestrator';
import { resolveTableHistoryStateFromChat_ACU } from '../table/table-history';
import { planManualCatchUpWaves_ACU } from '../table/manual-fill-planner';
import { resolveManualUpdateBatchSize_ACU, resolveManualUpdateContextDepth_ACU } from '../table/manual-update-settings';
import { isNonFillAiFloor_ACU, selectFillEligibleIndices_ACU } from '../runtime/message-handler';
import { createLorebookReadContext_ACU } from '../worldbook/read-context';
import { DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU } from '../../shared/defaults-json.js';
import { evaluatePromptPreviewGate_ACU } from './prompt-preview-gate';
import { sanitizeApiRequestBodyForPreview_ACU } from './prompt-preview-sanitize';
import {
    PromptPreviewGateBlockedError_ACU,
    PromptPreviewPrepareError_ACU,
    type PromptPreviewFillScenario_ACU,
    type PromptPreviewSegment_ACU,
    type TableFillPromptPreview_ACU,
} from './prompt-preview-types';

// UI 组合层（usePromptPreview.ts）直接从本文件取类型：对外 re-export 契约类型。
export type { TableFillPromptPreview_ACU, TableFillPromptPreviewMeta_ACU } from './prompt-preview-types';
export type { PromptPreviewFillScenario_ACU as TableFillPreviewScenario_ACU } from './prompt-preview-types';

interface PreviewJobPlan_ACU {
    scenario: PromptPreviewFillScenario_ACU;
    updateMode: string;
    targetSheetKeys: string[];
    /** 批内消息索引（batchFirst..batchLast）。 */
    batchFirstMessageIndex: number;
    batchLastMessageIndex: number;
    /** 管线自身的 requestOptions（auto 携带 skipProfileSwitch/forceDirectApi）。 */
    requestOptions: Record<string, any>;
}

/** update-orchestrator.ts:559 capturePromptMessageSnapshot_ACU 的只读等价（模块私有，无法导入）。 */
function capturePromptMessageSnapshotForPreview_ACU(messages: any[]): any[] {
    return messages.map(message => {
        if (!message || typeof message !== 'object') return {};
        return {
            is_user: message.is_user === true,
            ...(typeof message.name === 'string' ? { name: message.name } : {}),
            ...(typeof message.mes === 'string' ? { mes: message.mes } : {}),
            ...(typeof message.message === 'string' ? { message: message.message } : {}),
        };
    });
}

/** update-orchestrator.ts:3939 collectEffectiveAiMessageIndices_ACU 的只读等价（模块私有，无法导入）。 */
function collectEffectiveAiMessageIndicesForPreview_ACU(chat: any[]): number[] {
    const allAiMessageIndices = chat
        .map((message: any, index: number) => !message?.is_user ? index : -1)
        .filter((index: number) => index >= 0);
    const skipped = Math.max(0, Math.trunc(Number(settings_ACU.skipUpdateFloors) || 0));
    if (skipped <= 0) return allAiMessageIndices;
    const eligiblePositions = allAiMessageIndices
        .map((messageIndex: number, position: number) => isNonFillAiFloor_ACU(chat[messageIndex]) ? -1 : position)
        .filter((position: number) => position >= 0);
    if (eligiblePositions.length <= skipped) return [];
    return allAiMessageIndices.slice(0, eligiblePositions[eligiblePositions.length - skipped]);
}

function resolveGroupIdFromSheet_ACU(sheet: any): number {
    const raw = Number((sheet?.updateConfig)?.groupId);
    return Number.isFinite(raw) ? Math.trunc(raw) : -1;
}

/** auto 管线：首普通组首个未因末楼过短被跳过的批。 */
function planAutoFillJobForPreview_ACU(chatHistory: any[], isolationKey: string): PreviewJobPlan_ACU {
    const liveChat = getChatArray_ACU() || [];
    const plan = buildAutoUpdatePlan_ACU(liveChat, currentJsonTableData_ACU, settings_ACU, isolationKey);
    const updateGroups = plan?.updateGroups || {};
    const normalGroupKeys = Object.keys(updateGroups)
        .filter((key) => updateGroups[key]?.requiresBoundaryStaging !== true);
    const threshold = Number((settings_ACU as any).autoUpdateTokenThreshold) || 0;
    for (const key of normalGroupKeys) {
        const group = updateGroups[key];
        const indices = Array.isArray(group?.indices) ? group.indices : [];
        if (!indices.length) continue;
        const batchSize = Math.max(1, Number(group.batchSize) || Number((settings_ACU as any).updateBatchSize) || 2);
        for (let i = 0; i < indices.length; i += batchSize) {
            const batch = indices.slice(i, i + batchSize);
            const firstMessageIndexOfBatch = batch[0];
            const lastMessageIndexOfBatch = batch[batch.length - 1];
            // update-orchestrator.ts:2701-2711：auto 系末楼文本过短直接跳过该批。
            // 与上游逐字对齐：mes || message || ''（|| 链，空串 fallback）；空内容 length 0
            // 在 threshold>0 时同样跳批（旧复刻的 ?? + 真值守卫会在空串时漏跳）。
            const lastAiMessageInBatch = chatHistory[lastMessageIndexOfBatch];
            const lastAiMessageContent = lastAiMessageInBatch?.mes || lastAiMessageInBatch?.message || '';
            if (String(lastAiMessageContent).length < threshold) continue;
            return {
                scenario: 'auto',
                updateMode: resolveUpdateMode_ACU('auto_independent'),
                targetSheetKeys: [...(group.sheetKeys || [])],
                batchFirstMessageIndex: firstMessageIndexOfBatch,
                batchLastMessageIndex: lastMessageIndexOfBatch,
                requestOptions: { skipProfileSwitch: true, forceDirectApi: true },
            };
        }
    }
    throw new PromptPreviewPrepareError_ACU('当前没有可预览的自动填表任务（可能已全部更新或末楼内容过短被阈值跳过）', 'no_pending_auto_job');
}

/** manual_refill 管线：orchestrateManualUpdate_ACU 纯计算段（update-orchestrator.ts:5104-5181）。 */
function planManualRefillJobForPreview_ACU(chatHistory: any[], targetSheetKeysInput: string[] | null | undefined): PreviewJobPlan_ACU {
    const liveChat = getChatArray_ACU() || [];
    const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true }) || {};
    const runtimeTableData: Record<string, any> = (currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object')
        ? currentJsonTableData_ACU as Record<string, any>
        : {};
    const allSheetKeys = [...new Set([
        ...Object.keys(templateData).filter((key) => key.startsWith('sheet_')),
        ...Object.keys(runtimeTableData).filter((key) => key.startsWith('sheet_')),
    ])].sort();
    const selectedSheetKeys = Array.isArray(targetSheetKeysInput) && targetSheetKeysInput.length
        ? allSheetKeys.filter((key) => targetSheetKeysInput.includes(key))
        : allSheetKeys;
    if (!selectedSheetKeys.length) {
        throw new PromptPreviewPrepareError_ACU('没有可填的表格', 'no_target_sheets');
    }

    const allAiMessageIndices = liveChat.map((message: any, index: number) => !message?.is_user ? index : -1).filter((index: number) => index >= 0);
    const uiThreshold = resolveManualUpdateContextDepth_ACU();
    const uiBatchSize = Math.max(1, resolveManualUpdateBatchSize_ACU());
    const uiSkip = Math.max(0, Math.trunc(Number((settings_ACU as any).skipUpdateFloors) || 0));
    const contextScopeIndices = selectFillEligibleIndices_ACU(liveChat, allAiMessageIndices, 0, uiSkip, (index: number) => !isNonFillAiFloor_ACU(liveChat[index]))
        .slice(uiThreshold > 0 ? -uiThreshold : 0);
    if (!contextScopeIndices.length) {
        throw new PromptPreviewPrepareError_ACU('没有可填的 AI 楼层', 'no_fillable_floors');
    }

    const scopeKey = contextScopeIndices.join(',');
    const groups = new Map<string, { sheetKeys: string[]; groupId: number; requestOptions: Record<string, any> | null }>();
    const presetSlotByKey = new Map<string, number>();
    for (const sheetKey of selectedSheetKeys) {
        const tableName = templateData?.[sheetKey]?.name || runtimeTableData?.[sheetKey]?.name || '';
        const preset = resolveTableApiPresetOverride_ACU(tableName);
        const presetKey = preset || '';
        if (!presetSlotByKey.has(presetKey)) presetSlotByKey.set(presetKey, presetSlotByKey.size);
        const tableGroupId = resolveGroupIdFromSheet_ACU(templateData?.[sheetKey]);
        const groupKey = `${tableGroupId}|${scopeKey}|${uiBatchSize}|presetSlot:${presetSlotByKey.get(presetKey)}`;
        let group = groups.get(groupKey);
        if (!group) {
            group = { sheetKeys: [], groupId: tableGroupId, requestOptions: preset ? { tableApiPreset: preset } : null };
            groups.set(groupKey, group);
        }
        group.sheetKeys.push(sheetKey);
    }

    const firstGroup = groups.values().next().value;
    if (!firstGroup || !firstGroup.sheetKeys.length) {
        throw new PromptPreviewPrepareError_ACU('没有可填的表格分组', 'no_manual_groups');
    }
    return {
        scenario: 'manual_refill',
        updateMode: resolveUpdateMode_ACU('manual_independent'),
        targetSheetKeys: [...firstGroup.sheetKeys].sort(),
        batchFirstMessageIndex: contextScopeIndices[0],
        batchLastMessageIndex: contextScopeIndices[Math.min(uiBatchSize, contextScopeIndices.length) - 1],
        requestOptions: firstGroup.requestOptions || {},
    };
}

/** catch_up 管线：prepareManualCatchUpPlan_ACU 纯计算段（update-orchestrator.ts:4026-4079）。 */
function planCatchUpJobForPreview_ACU(targetSheetKeysInput: string[] | null | undefined): PreviewJobPlan_ACU {
    const chat = getChatArray_ACU() || [];
    const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true }) || {};
    const runtimeTableData: Record<string, any> = (currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object')
        ? currentJsonTableData_ACU as Record<string, any>
        : {};
    const candidateKeys = Array.isArray(targetSheetKeysInput) && targetSheetKeysInput.length
        ? targetSheetKeysInput
        : Object.keys(runtimeTableData);
    const selectedSheetKeys = [...new Set(candidateKeys
        .filter((key) => typeof key === 'string' && key.startsWith('sheet_') && Boolean(runtimeTableData?.[key])))].sort();
    if (!selectedSheetKeys.length) {
        throw new PromptPreviewPrepareError_ACU('没有需要追平的表格', 'no_catch_up_sheets');
    }

    const effectiveAiMessageIndices = collectEffectiveAiMessageIndicesForPreview_ACU(chat);
    const isolationKey = getCurrentIsolationKey_ACU();
    const plan = planManualCatchUpWaves_ACU(
        effectiveAiMessageIndices,
        selectedSheetKeys.map((sheetKey) => {
            const sheet = runtimeTableData?.[sheetKey] || templateData[sheetKey] || {};
            const isSummaryTable = isSummaryOrOutlineTable_ACU(String(sheet?.name || ''));
            const lastCompletedAiFloor = resolveTableHistoryStateFromChat_ACU(chat, {
                sheetKey,
                isSummaryTable,
                isolationKey,
                settings: settings_ACU,
            }).lastCompletedAiFloor;
            const preset = resolveTableApiPresetOverride_ACU(sheet?.name);
            return {
                sheetKey,
                lastCompletedAiFloor,
                groupId: resolveGroupIdFromSheet_ACU(sheet),
                batchSize: resolveManualUpdateBatchSize_ACU(),
                requestOptions: preset ? { tableApiPreset: preset } : null,
                updateMode: 'manual_independent',
                executionKind: isSqliteMode() ? 'sql' : 'standard',
            };
        }),
        (messageIndex: number) => !isNonFillAiFloor_ACU(chat[messageIndex]),
    );

    const firstWave = (plan?.waves || [])[0];
    const firstGroup = (firstWave?.groups || [])[0];
    const messageIndices = firstWave?.messageIndices || [];
    if (!firstGroup || !firstGroup.sheetKeys?.length || !messageIndices.length) {
        throw new PromptPreviewPrepareError_ACU('当前已追平，没有待补填的楼层', 'no_catch_up_waves');
    }
    // 波内按 originalFullIndex 的 segment 拆分只影响写路径 staging，预览直接取整波消息序列。
    const batchSize = Math.max(1, Number(firstGroup.batchSize) || resolveManualUpdateBatchSize_ACU() || 2);
    const firstBatch = messageIndices.slice(0, batchSize);
    return {
        scenario: 'catch_up',
        updateMode: String(firstGroup.updateMode || resolveUpdateMode_ACU('manual_independent')),
        targetSheetKeys: [...firstGroup.sheetKeys],
        batchFirstMessageIndex: firstBatch[0],
        batchLastMessageIndex: firstBatch[firstBatch.length - 1],
        requestOptions: firstGroup.requestOptions || {},
    };
}

/**
 * 复刻 callCustomOpenAI_ACU 入口推导（prompt-api-call.ts:84-131 与 :250-348 的准备段），
 * 但绝不触碰接管租约 / 全局中止控制器，也不发送任何请求。
 */
async function renderPreviewRequest_ACU(
    dynamicContent: any,
    plan: PreviewJobPlan_ACU,
    tableData: Record<string, any>,
    abortSignal: AbortSignal,
): Promise<{ messages: { role: string; content: string }[]; presetName: string; requestBody: Record<string, any> }> {
    const options = plan.requestOptions || {};
    const forceDirectApi = options.forceDirectApi === true;
    const readPresetName = () => (options.tableApiPreset !== undefined && options.tableApiPreset !== null)
        ? options.tableApiPreset
        : (settings_ACU as any).tableApiPreset;
    const readChannel = (presetName: string) => {
        const apiConfig = getApiConfigByPreset_ACU(presetName);
        requireResolvedApiPreset_ACU(presetName, apiConfig);
        return apiConfig;
    };

    const initialPresetName = readPresetName();
    const initialChannel = readChannel(initialPresetName);
    const strictJsonFillEnabled = (settings_ACU as any).strictJsonTableFillEnabled === true;
    const sqliteMode = isSqliteMode();
    const charCardPromptSetting = strictJsonFillEnabled
        ? (sqliteMode
            ? cloneStrictPromptSegments_ACU((settings_ACU as any).strictJsonSqlCharCardPrompt, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU)
            : cloneStrictPromptSegments_ACU((settings_ACU as any).strictJsonCharCardPrompt, DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU))
        : (settings_ACU as any).charCardPrompt;
    let promptSegments: any[] = [];
    if (Array.isArray(charCardPromptSetting)) {
        promptSegments = charCardPromptSetting;
    } else if (typeof charCardPromptSetting === 'string') {
        promptSegments = [{ role: 'USER', content: charCardPromptSetting }];
    }
    const tableFillToolOptIn = (settings_ACU as any).tableFillNativeToolEnabled === true;
    const canUseTools = (channel: ReturnType<typeof getApiConfigByPreset_ACU>) =>
        !strictJsonFillEnabled && tableFillToolOptIn && isNativeToolChannelAvailable_ACU(channel, forceDirectApi);
    const initialToolChannelAvailable = canUseTools(initialChannel);

    let messages = await renderTableFillMessages_ACU(dynamicContent, initialToolChannelAvailable, {
        sourcePromptSegments: promptSegments,
        strictJsonFillEnabled,
        sqliteMode,
        tableFillToolOptIn,
        tableData,
        sqlReadContext: null,
        abortSignal,
    });
    // 预览无执行资格校验，assertCurrent 不传；工具可用性变化重渲染与原实现同构。
    let effectiveTableApiPreset = initialPresetName;
    let apiPresetConfig = readChannel(effectiveTableApiPreset);
    let tableFillToolChannelAvailable = canUseTools(apiPresetConfig);
    if (tableFillToolChannelAvailable !== initialToolChannelAvailable) {
        messages = await renderTableFillMessages_ACU(dynamicContent, tableFillToolChannelAvailable, {
            sourcePromptSegments: promptSegments,
            strictJsonFillEnabled,
            sqliteMode,
            tableFillToolOptIn,
            tableData,
            sqlReadContext: null,
            abortSignal,
        });
        effectiveTableApiPreset = readPresetName();
        apiPresetConfig = readChannel(effectiveTableApiPreset);
        if (canUseTools(apiPresetConfig) !== tableFillToolChannelAvailable) {
            throw new PromptPreviewPrepareError_ACU('预览准备期间 API 工具协议再次变化，请重新发起预览。', 'api_channel_changed_during_preparation');
        }
    }
    apiPresetConfig = structuredClone(apiPresetConfig);
    const effectiveApiConfig = (apiPresetConfig as any).apiConfig;
    const streaming = (settings_ACU as any).streamingEnabled || false;

    let strictJsonResponseFormat: Record<string, any> | undefined;
    if (strictJsonFillEnabled) {
        try {
            const apiFormat = effectiveApiConfig.customApiFormat || 'openai_compat';
            const useJsonObject = /deepseek/i.test(String(effectiveApiConfig.model ?? ''))
                && (apiFormat === 'openai_compat' || apiFormat === 'openai_responses');
            if (useJsonObject) {
                strictJsonResponseFormat = { type: 'json_object' };
            } else {
                strictJsonResponseFormat = buildStrictJsonTableFillResponseFormatForData_ACU(
                    sqliteMode,
                    tableData,
                    plan.targetSheetKeys,
                ).responseFormat;
            }
        } catch (error) {
            // schema 构建失败不阻断预览：回退到纯提示词约束（与真实请求同语义）。
            strictJsonResponseFormat = undefined;
        }
    }
    const tableFillTools = (strictJsonFillEnabled || !tableFillToolChannelAvailable) ? [] : buildTableFillNativeTools_ACU(sqliteMode);
    const requestBody = buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, {
        stripModelPrefix: false,
        streaming,
        responseFormat: strictJsonResponseFormat,
        ...(tableFillTools.length ? { tools: tableFillTools } : {}),
    });
    return { messages, presetName: String(effectiveTableApiPreset || ''), requestBody };
}

export async function previewTableFillPrompt_ACU(options?: {
    scenario?: PromptPreviewFillScenario_ACU;
    targetSheetKeys?: string[] | null;
}): Promise<TableFillPromptPreview_ACU> {
    const gate = evaluatePromptPreviewGate_ACU();
    if (!gate.tableFill.available) {
        throw new PromptPreviewGateBlockedError_ACU('tableFill', gate.tableFill.blockers);
    }
    const scenario: PromptPreviewFillScenario_ACU = options?.scenario || 'auto';
    const liveChat = getChatArray_ACU() || [];
    const chatHistory = capturePromptMessageSnapshotForPreview_ACU(liveChat);
    const isolationKey = getCurrentIsolationKey_ACU();

    let plan: PreviewJobPlan_ACU;
    if (scenario === 'manual_refill') {
        plan = planManualRefillJobForPreview_ACU(chatHistory, options?.targetSheetKeys);
    } else if (scenario === 'catch_up') {
        plan = planCatchUpJobForPreview_ACU(options?.targetSheetKeys);
    } else {
        plan = planAutoFillJobForPreview_ACU(chatHistory, isolationKey);
    }

    // update-orchestrator.ts:2651-2655：批首若紧邻用户楼则把用户楼一并纳入上下文。
    let sliceStartIndex = plan.batchFirstMessageIndex;
    if (sliceStartIndex > 0 && chatHistory[sliceStartIndex - 1]?.is_user) {
        sliceStartIndex -= 1;
    }
    const messagesForContext = chatHistory.slice(sliceStartIndex, plan.batchLastMessageIndex + 1);
    if (!messagesForContext.length) {
        throw new PromptPreviewPrepareError_ACU('待填楼层上下文为空', 'empty_context');
    }

    // update-orchestrator.ts:2656-2663：未显式指定预设时按首表名解析表级预设覆盖。
    const effectiveRequestOptions: Record<string, any> = { ...(plan.requestOptions || {}) };
    if ((effectiveRequestOptions.tableApiPreset === undefined || effectiveRequestOptions.tableApiPreset === null)
        && plan.targetSheetKeys.length) {
        const templateForLookup = parseTableTemplateJson_ACU({ stripSeedRows: true });
        const presetOverride = resolveTableApiPresetOverride_ACU(templateForLookup?.[plan.targetSheetKeys[0]]?.name);
        if (presetOverride) effectiveRequestOptions.tableApiPreset = presetOverride;
    }
    plan.requestOptions = effectiveRequestOptions;

    // 显式传 tableData（结构克隆）绕开 prepareAIInput 的 seed 写入陷阱（prompt-prepare.ts:179-199）。
    const tableData = structuredClone(currentJsonTableData_ACU || {});
    const abortController = new AbortController();
    const worldbookReadContext = createLorebookReadContext_ACU({ source: 'form_fill' });
    let dynamicContent: any;
    try {
        dynamicContent = await prepareAIInput_ACU(messagesForContext, plan.updateMode, plan.targetSheetKeys, {
            tableData,
            signal: abortController.signal,
            worldbookReadContext,
            agentGreenlights: [...(pendingFinalGenerationGreenlights_ACU || [])],
        });
    } finally {
        try { worldbookReadContext.dispose(); } catch (_) { /* dispose 失败不影响预览结果 */ }
    }
    if (!dynamicContent) {
        throw new PromptPreviewPrepareError_ACU('提示词准备返回空结果', 'prepare_empty');
    }
    if ((dynamicContent as any).ok === false) {
        const failure = dynamicContent as { message?: string; failureCode?: string; retryable?: boolean };
        throw new PromptPreviewPrepareError_ACU(
            String(failure.message || '提示词准备失败'),
            failure.failureCode,
            failure.retryable,
        );
    }

    const rendered = await renderPreviewRequest_ACU(dynamicContent, plan, tableData, abortController.signal);
    const segments: PromptPreviewSegment_ACU[] = rendered.messages.map((message) => ({
        role: String(message.role),
        content: String(message.content ?? ''),
        tokens: estimateTextTk_ACU(String(message.content ?? '')),
    }));
    return {
        segments,
        requestBody: sanitizeApiRequestBodyForPreview_ACU(rendered.requestBody),
        totalTokens: segments.reduce((sum, segment) => sum + segment.tokens, 0),
        meta: {
            fillMode: String(resolveCurrentChatFillMode_ACU()?.mode || ''),
            scenario,
            storageMode: isSqliteMode() ? 'sqlite' : 'json',
            updateMode: plan.updateMode,
            targetSheetKeys: plan.targetSheetKeys,
            presetName: rendered.presetName,
        },
    };
}
