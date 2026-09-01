/**
 * service/table/update-orchestrator.ts — 表格更新编排（service 层：纯业务逻辑）
 * 从 presentation/triggers/update-process.ts 提取。
 * service 层不驱动 UI，只返回结果/状态，presentation 层根据返回值自行决定 UI 操作。
 */

import { currentChatFileIdentifier_ACU, isAutoUpdatingCard_ACU, pendingFinalGenerationGreenlights_ACU, wasStoppedByUser_ACU, _set_isAutoUpdatingCard_ACU, _set_manualExtraHint_ACU, _set_wasStoppedByUser_ACU } from '../runtime/state-manager';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { callCustomOpenAI_ACU, RetryableAiResponseError_ACU } from '../ai/prompt-builder';
import { clearManualRefillSheetDataInRange_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU, ensureManualCatchUpAnchorBeforeTarget_ACU, ensureV2BoundaryCheckpointForRetainedBuffer_ACU, establishManualRefillTemplateRoot_ACU, getChatArray_ACU, shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU } from '../chat/chat-service';
import { coreApisAreReady_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { checkAutoMergeTrigger_ACU, prepareAutoMergeBatches_ACU, executeAutoMergeBatch_ACU, finalizeAutoMerge_ACU } from '../summary/merge-logic';
import { ensureStableRowIdsForSheetContent_ACU, filterSheetKeysByTemplateScope_ACU, getChatSheetGuideDataForIsolationKey_ACU, getCurrentChatTemplateScopeState_ACU, getEffectiveSeedRowsForSheet_ACU, getGlobalTemplateSnapshotForCurrentProfile_ACU, resolveTemplateScope_ACU, sanitizeTemplateSnapshotForChat_ACU, shouldUseInitialSeedRows_ACU } from '../template/chat-scope';
import type { TemplateScope_ACU } from '../template/chat-scope';
import { loadAllChatMessages_ACU, updateReadableLorebookEntry_ACU } from '../worldbook/pipeline';
import { enqueueSummaryVectorIndexFlush_ACU } from '../vector/summary-vector-index-flush-queue';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { getLatestV2FullCheckpointMessageIndex_ACU, resolveTableHistoryStateFromChat_ACU } from './table-history';
import { planManualCatchUpWaves_ACU, type ManualCatchUpPlan_ACU } from './manual-fill-planner';
import type { ManualRefillProgressV2_ACU } from './storage-frame-v2-types';
import type { SqlTableApplyScope_ACU } from '../../shared/table-storage-provider';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { rebindSheetKeysThroughTableAliases_ACU, resolveHistoricalSheetKeyMigrations_ACU, SheetTableAliasResolutionError_ACU } from '../../shared/sql-read-resolver';
import { recoverProvisionalBridgeSession_ACU, hasActiveProvisionalBridgeAnywhere_ACU } from './manual-catch-up-provisional-bridge';
import {
  assembleBucketWorkingView_ACU,
  commitStagedSheetsAtFullBoundaryAtomic_ACU,
  createTableFillStagingRunContext_ACU,
  planTableFillBoundaryStaging_ACU,
  publishVerifiedBoundaryHead_ACU,
  readOriginalFullFrameFingerprint_ACU,
  splitMessageIndicesAtBoundary_ACU,
  type BoundarySegment_ACU,
  type TableFillBoundaryDiagnosticCode_ACU,
  type TableFillBoundaryStagingPlan_ACU,
  type TableFillStagingRunContext_ACU,
} from './table-fill-boundary-staging';
import { createTableFillStagingSession_ACU, type TableFillStagingSession_ACU } from './table-fill-staging-session';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';

import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { startRuntimePerformanceSpan_ACU } from '../../shared/runtime-performance';
import { showUiSurfaceToast_ACU } from '../../shared/ui-surface-registry';
import { createLorebookReadContext_ACU, type LorebookReadContext_ACU } from '../worldbook/read-context';

import { applyTableDelta_ACU, isDeltaTagData_ACU } from './table-delta';
/**
 * 表名标准化：trim 后空串视为无效键
 */
function normalizeTableNameForPresetLookup_ACU(name: any): string {
    const trimmed = String(name ?? '').trim();
    return trimmed;
}

/**
 * 根据起始表的名称，查找表级 API 预设覆盖
 * @returns 预设名称，空字符串表示使用全局 tableApiPreset
 */
function resolveTableApiPresetOverride_ACU(tableName: any): string {
    const normalizedName = normalizeTableNameForPresetLookup_ACU(tableName);
    if (!normalizedName) return '';
    const overrides = settings_ACU.tableApiPresetOverridesByName;
    if (!overrides || typeof overrides !== 'object') return '';
    const preset = overrides[normalizedName];
    return (typeof preset === 'string' && preset.trim()) ? preset.trim() : '';
}
import { checkIfFirstTimeInit_ACU, ensureLegacyStorageMigratedBeforeWrite_ACU } from './table-service';
import { assertSingleActiveFullCheckpointV2_ACU, assertWriteTargetNotBeforeReplayRoot_ACU, hasAnyV2Checkpoint_ACU } from './storage-frame-v2-persist';
import { parseAndApplyTableEditsToData_ACU, prepareAIInput_ACU } from '../ai/prompt-builder';
import { extractStrictJsonTableFillResponse_ACU } from '../ai/prompt-builder/strict-json-table-fill';
import { isSqlContent } from '../ai/prompt-builder/table-edit-parser';
import { buildGuidedBaseDataFromSheetGuide_ACU, getSortedSheetKeys_ACU } from '../template/chat-scope';
import { isSqliteMode } from './storage-mode';
import type { TableMutationOperationV2_ACU } from './storage-frame-v2-types';
import { applySqlEditsToTableDataSnapshot_ACU, assertNoHiddenPhysicalColumnMutations_ACU, buildSqlSheetBatchOperations_ACU, captureSqlTableApplyScope_ACU, extractTableNamesFromStatements, mapSqlTableNamesToSheetKeys_ACU, normalizeSqlStatementsForRuntimeLog_ACU, rebindSqlMutationIdentifiers_ACU, splitSqlStatements, SqlRowIdMaterializationError_ACU, SqlRuntimeSchemaInvalidError_ACU, SqlRuntimeSchemaStaleError_ACU, SqlRuntimeSnapshotError_ACU } from './sql-table-service';
import { hasStructuralReplayCompatibilityRepairs_ACU, hasUnanchoredReplayArtifactsForChatV2_ACU, loadTableStateFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';
import { ensureStorageProviderReady_ACU, getStorageProvider, reloadStorageProvider } from './table-storage-strategy';
import { applySpecialIndexSequenceToSummaryTables_ACU } from '../runtime/helpers-remaining';
import { isSameSheetHeader_ACU } from '../template/guide-metadata-overlay';
import { captureTableRuntimeRevisionForWriteSet_ACU } from './table-write-transaction';
import { runTableUpdateCommit_ACU, type TableUpdateCommitErrorCategory_ACU } from './table-update-commit';
import { commitPreparedV2Recovery_ACU, prepareV2Recovery_ACU } from './table-v2-recovery-service';
import { isV2TagData_ACU, resolveTableStorageStrategy_ACU } from './storage-strategy-resolver';
import { getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU } from '../flight-mode/flight-mode-hidden-rows';
import { getCurrentFlightModeState_ACU, stageFlightModeHiddenRowIds_ACU } from '../flight-mode/flight-mode-state';

// ============================================================
// 类型定义：返回值 + 进度事件（service 层不驱动 UI）
// ============================================================

/** 卡片更新进度事件阶段 */
export type CardUpdatePhase =
    | 'preparing'        // 准备 AI 输入
    | 'calling_ai'       // 调用 AI（含重试信息）
    | 'parsing'          // 解析 AI 返回
    | 'saving'           // 保存到聊天记录
    | 'chunk_done'       // 分块处理成功（import 模式）
    | 'complete'         // 完成
    | 'retry'            // 重试中
    | 'error';           // 出错

/** 卡片更新进度事件 */
export interface CardUpdateProgressEvent {
    phase: CardUpdatePhase;
    attempt?: number;
    maxRetries?: number;
    message?: string;
    currentBatch?: number;
    totalBatches?: number;
}

/** 批处理进度上下文 */
export interface BatchUpdateProgressContext {
    currentBatch: number;
    totalBatches: number;
    batchBaseSnapshot?: Record<string, any>;
}

/** executeCardUpdateCore 的返回值 */
export interface CardUpdateResult {
    success: boolean;
    modifiedKeys: string[];
    tableData?: Record<string, any>;
    error?: string;
    errorCategory?: TableUpdateCommitErrorCategory_ACU;
    aborted?: boolean;
    /**
     * 面向 UI/恢复诊断的稳定失败分类；不得解析 error 文案。
     * 与 ManualUpdateResult.diagnosticCode 同一套治理约定。
     */
    diagnosticCode?: WriteTargetAdmissionDiagnosticCode_ACU;
    /** 稳定结构化诊断上下文（与 diagnosticCode 成对出现）。 */
    diagnostic?: WriteTargetAdmissionDiagnostic_ACU;
}

/** processUpdatesBatch 的返回值 */
export interface BatchUpdateResult {
    success: boolean;
    failedBatch?: number;
    error?: string;
    /** 稳定失败分类，供 UI 与日志按 code 判断，不解析 error 文案。 */
    diagnosticCode?: WriteTargetAdmissionDiagnosticCode_ACU;
    /** 稳定结构化诊断上下文（与 diagnosticCode 成对出现）。 */
    diagnostic?: WriteTargetAdmissionDiagnostic_ACU;
}

/** 写目标回放根准入诊断码（稳定契约，禁止改字符串值）。 */
export type WriteTargetAdmissionDiagnosticCode_ACU =
    | 'write_target_before_replay_root'
    | 'staging_runner_unavailable';

/** 写目标回放根准入的稳定结构化诊断字段。 */
export interface WriteTargetAdmissionDiagnostic_ACU {
    /** 准入发生时所在的执行路径。 */
    executionPath: 'legacy_auto' | 'grouped_auto' | 'manual' | 'import';
    /** 本次写目标楼层。 */
    targetMessageIndex: number;
    /** 最新 V2 full checkpoint（replay 根）楼层；无根时为 -1。 */
    latestReplayRootIndex: number;
    /** 分组 id（自动 grouped/staging 路径），非分组路径为 0。 */
    groupId?: number;
    /** 是否需要边界 staging（跨 replay 根）。 */
    requiresBoundaryStaging?: boolean;
}

/** orchestrateManualUpdate 的返回值 */
export interface ManualUpdateResult {
    success: boolean;
    error?: string;
    /** 是否触发了自动合并 */
    autoMergeTriggered?: boolean;
    autoMergeSuccess?: boolean;
    checkpointWarning?: string;
    outcome?: 'complete' | 'no_work' | 'stopped' | 'sync_pending' | 'blocked' | 'integrity_failed' | 'progress_metadata_failed';
    committedBucketCount?: number;
    /** 是否至少有一个 bucket 已严格提交到聊天记录。 */
    dataCommitted?: boolean;
    /** 至少一次终态 bounded replay 已确认可读取已提交状态。 */
    replayVerified?: boolean;
    /** terminal manualRefillProgress 是否已严格保存。 */
    terminalProgressSaved?: boolean;
    /** 面向 UI/恢复诊断的稳定失败分类；不得依赖错误文案解析。 */
    diagnosticCode?: 'anchor_preflight_blocked' | 'replay_anchor_missing' | 'replay_missing_selected_sheet' | 'replay_requires_checkpoint_convergence' | 'replay_data_mismatch' | 'replay_failed' | 'catch_up_migration_failed' | 'catch_up_migration_reload_failed' | 'catch_up_migration_changed_topology' | 'catch_up_runtime_changed_after_confirmation' | 'provisional_bridge_required' | 'provisional_baseline_unreconstructable' | 'provisional_bridge_conflict' | 'bridge_finalize_failed' | 'bridge_replay_mismatch' | 'provisional_recovery_required' | 'stale_bucket_after_boundary_checkpoint' | 'staging_plan_failed' | 'boundary_commit_failed' | TableFillBoundaryDiagnosticCode_ACU;
    catchUpPlan?: ManualCatchUpPlan_ACU;
}

export interface ManualCatchUpPlanningResult_ACU {
    success: boolean;
    error?: string;
    plan?: ManualCatchUpPlan_ACU;
}

async function settleStagedBoundaryAndPublish_ACU(
    stagingRun: TableFillStagingRunContext_ACU,
    originalFullIndex: number,
    session: TableFillStagingSession_ACU | null,
): Promise<{ ok: true } | { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] }> {
    const commitResult = await commitStagedSheetsAtFullBoundaryAtomic_ACU(stagingRun.runId, {
        chatKey: stagingRun.chatKey,
        isolationKey: stagingRun.isolationKey,
        originalFullIndex,
        originalFullFingerprint: stagingRun.originalFullFingerprint,
        templateFingerprint: stagingRun.templateFingerprint,
        stagedSnapshot: stagingRun.overlay.sheets,
        targetSheetKeys: stagingRun.targetSheetKeys,
    });
    if (commitResult.ok === false) {
        await session?.discard();
        return {
            ok: false,
            error: commitResult.error,
            diagnosticCode: commitResult.diagnosticCode ?? 'boundary_commit_failed',
        };
    }
    const published = await publishVerifiedBoundaryHead_ACU({
        verifiedHeadSnapshot: commitResult.verifiedHeadSnapshot,
        chatKey: stagingRun.chatKey,
        isolationKey: stagingRun.isolationKey,
    });
    await session?.discard();
    if (!published.ok) return published;
    return { ok: true };
}

export interface GroupFillJob_ACU {
    groupKey: string;
    groupId: number;
    batchNumber: number;
    targetSheetKeys: string[] | null;
    messagesForContext: any[];
    saveTargetIndex: number;
    updateMode: string;
    requestOptions: Record<string, any> | null;
    baseSnapshot: Record<string, any>;
    baseRevision?: string | null;
    isImportMode?: boolean;
    /** AI 请求发起前锁定的提交作用域；后续不得重新读取全局当前聊天。 */
    chatKey?: string;
    isolationKey?: string;
    templateScope?: TemplateScope_ACU;
    sqlApplyScope?: SqlTableApplyScope_ACU;
    performanceRunId?: string;
    performanceParentSpanId?: string;
}

export interface GroupFillResponse_ACU {
    success: boolean;
    attempt: number;
    job: GroupFillJob_ACU;
    aiResponse?: string;
    tableEditText?: string;
    error?: string;
    rawError?: string;
    errorCategory?: TableUpdateCommitErrorCategory_ACU;
    aborted?: boolean;
}

export interface UnifiedApplyAttempt_ACU {
    saveTargetIndex: number;
    responseCount: number;
    attempt: number;
    error?: string;
}

interface FillExecutionScope_ACU {
    chatKey: string;
    isolationKey: string;
    promptMessages: any[];
    templateScope: TemplateScope_ACU;
    sqlApplyScope?: SqlTableApplyScope_ACU;
}

function buildTemplateScopeFromData_ACU(data: Record<string, any> | null | undefined): TemplateScope_ACU {
    if (!data || typeof data !== 'object') return null;
    const sheetKeys = new Set<string>();
    const sheets: Record<string, any> = {};
    Object.keys(data).forEach(sheetKey => {
        if (!sheetKey.startsWith('sheet_') || !data[sheetKey] || typeof data[sheetKey] !== 'object') return;
        sheetKeys.add(sheetKey);
        sheets[sheetKey] = data[sheetKey];
    });
    // 空集合表示“已确认无活动表”（SQL 活动模板投影后全部被过滤），绝不能折叠成 null：
    // null 在契约中表示“范围未知、不过滤”，会把所有运行时表重新放进来。
    return { sheetKeys, sheets };
}

function resolveManualRefillTemplateData_ACU(chat: any[], isolationKey: string): Record<string, any> | null {
    const scopedState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey });
    const globalSnapshot = scopedState ? null : getGlobalTemplateSnapshotForCurrentProfile_ACU();
    const effectiveTemplate = scopedState?.templateObj || scopedState?.templateStr
        || globalSnapshot?.templateObj || globalSnapshot?.templateStr;
    const snapshot = sanitizeTemplateSnapshotForChat_ACU(effectiveTemplate || null);
    if (!snapshot?.templateObj || typeof snapshot.templateObj !== 'object' || Array.isArray(snapshot.templateObj)) {
        return null;
    }
    return snapshot.templateObj as Record<string, any>;
}

function capturePromptMessageSnapshot_ACU(messages: any[]): any[] {
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

/**
 * AI 请求前捕获请求级执行作用域：
 * - 模板上下文（stripped / with rows / active sheet keys）
 * - live SQLite provider 的 runtime schema 冻结视图（窄 schema + digest + 完整 runtimeData）
 *
 * schema 冻结失败（provider 未 ready / 导出失败 / 解析失败）时，不在捕获阶段抛错冒泡
 * （调用点控制流复杂），而是把结构化失败标记写入 scope.runtimeSchemaFailure；所有
 * 消费方必须在使用 scope 前检查并 fail-closed。绝不回退 baseSnapshot 冒充 live schema。
 */
async function captureFillExecutionScope_ACU(
    performanceContext?: { runId?: string; parentSpanId?: string },
): Promise<FillExecutionScope_ACU> {
    const performanceSpan = startRuntimePerformanceSpan_ACU('fill-execution-scope-capture', {
        ...performanceContext,
        settings: settings_ACU,
        metrics: { sqlite: isSqliteMode() },
    });
    const chatKey = String(currentChatFileIdentifier_ACU || 'current-chat');
    const isolationKey = getCurrentIsolationKey_ACU();
    const liveChat = getChatArray_ACU() || [];
    const promptMessages = capturePromptMessageSnapshot_ACU(liveChat);
    let sqlApplyScope: SqlTableApplyScope_ACU | undefined;
    if (isSqliteMode()) {
        let runtimeData: TableDataObject_ACU | null = null;
        let runtimeSchemaFailure: SqlTableApplyScope_ACU['runtimeSchemaFailure'] | undefined;
        try {
            const provider = await ensureStorageProviderReady_ACU();
            if (provider.mode !== 'sqlite') {
                runtimeSchemaFailure = { code: 'provider_unavailable', message: 'SQLite 模式需要 SQLite provider，当前未就绪。' };
            } else {
                runtimeData = provider.getCurrentData();
                if (!runtimeData) {
                    runtimeSchemaFailure = { code: 'SQL_RUNTIME_SCHEMA_INVALID_ACU', message: 'SQLite runtime 未导出表格数据，无法冻结 schema。' };
                }
            }
        } catch (e: any) {
            runtimeSchemaFailure = { code: 'provider_unavailable', message: `SQLite 运行时未就绪，已阻止本轮填表：${String(e?.message || e)}` };
        }
        sqlApplyScope = captureSqlTableApplyScope_ACU({ chat: liveChat, isolationKey, runtimeData });
        if (runtimeSchemaFailure) {
            sqlApplyScope = { ...sqlApplyScope, runtimeSchemaFailure };
        }
    }
    const templateScope = sqlApplyScope
        ? buildTemplateScopeFromData_ACU(sqlApplyScope.templateData)
        : resolveTemplateScope_ACU(isolationKey);
    const result = { chatKey, isolationKey, promptMessages, templateScope, sqlApplyScope };
    performanceSpan.end({ messageCount: liveChat.length });
    return result;
}

interface ManualRuntimeUpdateGroup_ACU {
    indices: number[];
    batchSize: number;
    groupId: number;
    sheetKeys: string[];
    requestOptions: Record<string, any> | null;
}

export interface GroupedRuntimeUpdateGroup_ACU {
    key: string;
    groupId: number;
    indices: number[];
    batchSize: number;
    sheetKeys: string[];
    requestOptions: Record<string, any> | null;
    /**
     * 仅供“按 wave 追平”使用的基底边界下界。
     * 实际边界取 max(本值, bucketFirstMessageIndex - 1)，因此同一 wave 内的
     * 后续 bucket 仍能看到前一 bucket 刚提交的增量。
     */
    mergeBaseMaxMessageIndex?: number;
}

interface PlannedGroupedRuntimeJob_ACU {
    group: GroupedRuntimeUpdateGroup_ACU;
    batchNumber: number;
    firstMessageIndexOfBatch: number;
    lastMessageIndexOfBatch: number;
    messageIndices: number[];
    saveTargetIndex: number;
    updateMode: string;
}

const SQL_ERROR_MARKER_ACU = '\n\n<!-- SQL_ERROR_FEEDBACK -->\n';
const UNIFIED_GROUP_ERROR_MARKER_ACU = '\n\n<!-- UNIFIED_GROUP_ERROR_FEEDBACK -->\n';
const MAX_RETRY_FEEDBACK_LENGTH_ACU = 500;
const MAX_WARN_ERROR_LENGTH_ACU = 800;

class ModelOutputRetryError_ACU extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ModelOutputRetryError';
    }
}

class UpdateAttemptError_ACU extends Error {
    constructor(message: string, readonly category: TableUpdateCommitErrorCategory_ACU) {
        super(message);
        this.name = 'UpdateAttemptError';
    }
}

function sanitizeRetryFeedback_ACU(value: unknown, maxLength = MAX_RETRY_FEEDBACK_LENGTH_ACU): string {
    return String(value || '')
        .replace(/<!--\s*(?:SQL_ERROR_FEEDBACK|UNIFIED_GROUP_ERROR_FEEDBACK)\s*-->/gi, '')
        .replace(/\b(?:authorization\s*:\s*)?bearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|cookie)\b(\s*[:=]\s*)([^\s,;}&]+)/gi, '$1$2[REDACTED]')
        .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)=)[^&#\s]*/gi, '$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function formatGroupAttemptLabel_ACU(job: GroupFillJob_ACU): string {
    return `groupId=${job.groupId},batch=${job.batchNumber},targets=${job.targetSheetKeys?.length || 0}`;
}

function formatGroupReference_ACU(group: Pick<GroupedRuntimeUpdateGroup_ACU, 'groupId' | 'sheetKeys'>): string {
    return `groupId=${group.groupId},targets=${group.sheetKeys?.length || 0}`;
}

function formatResponseGroupReference_ACU(response: GroupFillResponse_ACU): string {
    return formatGroupAttemptLabel_ACU(response.job);
}

// ============================================================
// 核心业务函数
// ============================================================

/**
 * 加载批次基础数据：从聊天记录中为每个表格查找最新数据
 * 纯业务逻辑，不涉及任何 UI 操作
 */
/**
 * [辅助] 从聊天记录加载旧数据覆盖 sheet 后，恢复指导表基底中的关键结构字段。
 *
 * 背景：loadBatchBaseData_ACU 从聊天记录中加载旧数据时，会整体覆盖 mergedBatchData[sheetKey]。
 * 基底（guideSnapshots）中可能包含用户在可视化编辑器中修改过的 sourceData.ddl 和表头（content[0]），
 * 这些结构信息不应该被聊天记录中的旧数据覆盖；而 name/uid/updateConfig/exportConfig 保留聊天记录中的值，
 * 因为它们可能在聊天过程中被合法修改。
 *
 * 结构权归属：运行时/回放数据持结构权。表头（content[0]）是数据形状定义，不是元数据；
 * 无校验地用基底表头覆盖运行时会产出「表头 N 列 + 数据行 M 列」的错位填表基底。
 * 仅当表头与权威数据完全一致时才继承基底的 sourceData.ddl；不一致时保留权威 ddl 并记录 warning。
 */
function restoreGuideStructure(mergedSheet: any, guideSheet: any): void {
    if (!guideSheet || typeof guideSheet !== 'object') return;
    if (!mergedSheet || typeof mergedSheet !== 'object') return;

    // 基底表头若存在，必须校验首列为 row_id
    const guideHeader = Array.isArray(guideSheet.content) ? guideSheet.content[0] : null;
    if (guideHeader && (!Array.isArray(guideHeader) || String(guideHeader[0] ?? '') !== 'row_id')) {
        throw new Error(`Sheet Guide 表头缺少 row_id 首列：${String(guideSheet.uid || guideSheet.name || 'unknown')}`);
    }

    const mergedHeader = Array.isArray(mergedSheet.content) ? mergedSheet.content[0] : null;
    const headerMatches = !!guideHeader && !!mergedHeader && isSameSheetHeader_ACU(guideHeader, mergedHeader);

    // 表头不一致时：保留权威结构，不覆盖、不 padding、不截断，仅记录 warning。
    if (guideHeader && mergedHeader && !headerMatches) {
        logWarn_ACU(
            `[MergeBase] 表「${String(mergedSheet.name || guideSheet.name || mergedSheet.uid)}」的基底表头`
            + `与权威数据不一致，已保留权威结构：guide=${guideHeader.length} 列, data=${mergedHeader.length} 列。`,
        );
    }
    // 仅当合并数据完全没有表头时，才用基底表头补位（无权威结构可循）。
    if (!mergedHeader && Array.isArray(guideHeader) && Array.isArray(mergedSheet.content)) {
        mergedSheet.content[0] = JSON.parse(JSON.stringify(guideHeader));
    }

    // 只恢复结构字段 sourceData.ddl：表头一致时继承基底 ddl，否则保留权威 ddl。
    // 不触碰 name/uid/updateConfig/exportConfig/orderNo（保留聊天记录中的值）。
    if (guideSheet.sourceData && typeof guideSheet.sourceData === 'object') {
        const targetSourceData = (mergedSheet.sourceData && typeof mergedSheet.sourceData === 'object')
            ? mergedSheet.sourceData
            : (mergedSheet.sourceData = {});
        if (headerMatches && guideSheet.sourceData.ddl !== undefined) {
            targetSourceData.ddl = JSON.parse(JSON.stringify(guideSheet.sourceData.ddl));
        }
    }
}

export function loadBatchBaseData_ACU(
    chatHistory: any[],
    firstMessageIndexOfBatch: number,
    batchIsolationKey: string,
    batchSheetKeys: string[],
    mergedBatchData: Record<string, any>
): { foundCount: number; totalCount: number } {
    const batchFoundSheets: Record<string, boolean> = {};
    batchSheetKeys.forEach(k => batchFoundSheets[k] = false);

    // 收集 delta 楼层的增量数据（逆序收集，后续正序叠加）
    const pendingDeltas: { msgIndex: number; incrementalData: Record<string, any> }[] = [];

    // [修复] 保存指导表基底中每个 sheet 的结构快照（sourceData/DDL/表头/表名等），
    // 以便从聊天记录加载旧数据覆盖后恢复。防止旧数据中的旧 DDL/旧表头覆盖用户在可视化编辑器中的修改。
    const guideSnapshots: Record<string, any> = {};
    batchSheetKeys.forEach(k => {
        if (mergedBatchData[k] && typeof mergedBatchData[k] === 'object') {
            guideSnapshots[k] = mergedBatchData[k];
        }
    });

    for (let j = firstMessageIndexOfBatch - 1; j >= 0; j--) {
        const msg = chatHistory[j];
        if (msg.is_user) continue;

        // [优先级1] 新版按标签分组存储
        if (msg.TavernDB_ACU_IsolatedData && msg.TavernDB_ACU_IsolatedData[batchIsolationKey]) {
            const tagData = msg.TavernDB_ACU_IsolatedData[batchIsolationKey];

            // delta 楼层：收集增量，不做整表覆盖
            if (isDeltaTagData_ACU(tagData)) {
                if (tagData.incrementalData) {
                    pendingDeltas.push({ msgIndex: j, incrementalData: tagData.incrementalData });
                }
                continue;
            }

            // checkpoint / legacy 楼层：原 first-write-wins 逻辑
            const independentData = tagData.independentData || {};
            Object.keys(independentData).forEach(storedSheetKey => {
                if (batchFoundSheets[storedSheetKey] === false && mergedBatchData[storedSheetKey]) {
                    mergedBatchData[storedSheetKey] = JSON.parse(JSON.stringify(independentData[storedSheetKey]));
                    restoreGuideStructure(mergedBatchData[storedSheetKey], guideSnapshots[storedSheetKey]);
                    batchFoundSheets[storedSheetKey] = true;
                }
            });
        }

        // [优先级2] 兼容旧版存储格式
        const msgIdentity = msg.TavernDB_ACU_Identity;
        let isLegacyMatch = false;
        if (settings_ACU.dataIsolationEnabled) {
            isLegacyMatch = (msgIdentity === settings_ACU.dataIsolationCode);
        } else {
            isLegacyMatch = !msgIdentity;
        }

        if (isLegacyMatch) {
            if (msg.TavernDB_ACU_IndependentData) {
                const independentData = msg.TavernDB_ACU_IndependentData;
                Object.keys(independentData).forEach(storedSheetKey => {
                    if (batchFoundSheets[storedSheetKey] === false && mergedBatchData[storedSheetKey]) {
                        mergedBatchData[storedSheetKey] = JSON.parse(JSON.stringify(independentData[storedSheetKey]));
                        restoreGuideStructure(mergedBatchData[storedSheetKey], guideSnapshots[storedSheetKey]);
                        batchFoundSheets[storedSheetKey] = true;
                    }
                });
            }

            if (msg.TavernDB_ACU_Data) {
                const standardData = msg.TavernDB_ACU_Data;
                Object.keys(standardData).forEach(k => {
                    if (k.startsWith('sheet_') && batchFoundSheets[k] === false && mergedBatchData[k]) {
                        mergedBatchData[k] = JSON.parse(JSON.stringify(standardData[k]));
                        restoreGuideStructure(mergedBatchData[k], guideSnapshots[k]);
                        batchFoundSheets[k] = true;
                    }
                });
            }

            if (msg.TavernDB_ACU_SummaryData) {
                const summaryData = msg.TavernDB_ACU_SummaryData;
                Object.keys(summaryData).forEach(k => {
                    if (k.startsWith('sheet_') && batchFoundSheets[k] === false && mergedBatchData[k]) {
                        mergedBatchData[k] = JSON.parse(JSON.stringify(summaryData[k]));
                        restoreGuideStructure(mergedBatchData[k], guideSnapshots[k]);
                        batchFoundSheets[k] = true;
                    }
                });
            }
        }

        if (Object.values(batchFoundSheets).every(v => v === true)) {
            break;
        }
    }

    // 正序叠加 delta 增量到已找到的 base 数据上
    if (pendingDeltas.length > 0) {
        pendingDeltas.reverse(); // 逆序收集 → 正序叠加
        for (const { incrementalData } of pendingDeltas) {
            for (const sheetKey of Object.keys(incrementalData)) {
                if (!mergedBatchData[sheetKey] || batchFoundSheets[sheetKey] === undefined) continue;
                try {
                    mergedBatchData[sheetKey] = applyTableDelta_ACU(mergedBatchData[sheetKey], incrementalData[sheetKey], sheetKey);
                    restoreGuideStructure(mergedBatchData[sheetKey], guideSnapshots[sheetKey]);
                    if (Array.isArray(mergedBatchData[sheetKey]?.content)) {
                        mergedBatchData[sheetKey].content = ensureStableRowIdsForSheetContent_ACU(mergedBatchData[sheetKey].content);
                    }
                    batchFoundSheets[sheetKey] = true;
                } catch (e: any) {
                    logWarn_ACU(`[表格增量] loadBatchBaseData: 叠加 delta 失败 (sheet=${sheetKey}): ${e?.message || e}`);
                }
            }
        }
    }

    const foundCount = Object.values(batchFoundSheets).filter(v => v === true).length;
    const totalCount = batchSheetKeys.length;
    return { foundCount, totalCount };
}

/**
 * 构建批次合并基底数据
 * 纯业务逻辑，不涉及任何 UI 操作
 */
function cloneTableDataSnapshot_ACU(data: Record<string, any> | null | undefined): Record<string, any> | null {
    if (!data || typeof data !== 'object') return null;
    return JSON.parse(JSON.stringify(data));
}

function hasUsableRuntimeTableData_ACU(data: Record<string, any> | null): boolean {
    if (!data || typeof data !== 'object') return false;
    return Object.keys(data).some(k => k.startsWith('sheet_') && Array.isArray(data[k]?.content));
}

function buildWriteSetForSheetKeys_ACU(sheetKeys: string[] | null | undefined, fallbackData?: Record<string, any> | null) {
    const keys = Array.isArray(sheetKeys) && sheetKeys.length > 0
        ? sheetKeys
        : getSortedSheetKeys_ACU(fallbackData || currentJsonTableData_ACU || {});
    const normalized = [...new Set(keys.filter(sheetKey => typeof sheetKey === 'string' && sheetKey.startsWith('sheet_')))].sort();
    return normalized.length > 0
        ? normalized.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }))
        : [{ kind: 'all' as const }];
}

function buildFlightModeHiddenRowsBeforePersist_ACU(
    beforeData: Record<string, any>,
    isImportMode: boolean,
): (afterData: Record<string, any>) => { rollback?: () => void } | void {
    return (afterData) => {
        if (isImportMode) return;
        const state = getCurrentFlightModeState_ACU();
        if (!state.enabled) return;
        const hiddenRowIds = getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(beforeData, afterData, state);
        if (!hiddenRowIds) return;
        const rollback = stageFlightModeHiddenRowIds_ACU(hiddenRowIds);
        return rollback ? { rollback } : undefined;
    };
}


function hasSheetContentRows_ACU(sheet: any): boolean {
    return Array.isArray(sheet?.content) && sheet.content.length > 1;
}


function buildSqlSheetBatchOperationsFromText_ACU(
    sqlText: string,
    tableData: Record<string, any>,
    targetSheetKeys: string[] | null | undefined,
): { success: true; operations: TableMutationOperationV2_ACU[] } | { success: false; error: string } {
    const statements = normalizeSqlStatementsForRuntimeLog_ACU(sqlText);
    if (statements.length === 0) return { success: true, operations: [] };
    const buildResult = buildSqlSheetBatchOperations_ACU(statements, tableData as any, {
        fallbackTargetSheetKeys: Array.isArray(targetSheetKeys) ? targetSheetKeys : [],
        allowSingleTargetFallback: true,
        keepLegacyForUnclassified: true,
        reason: 'system',
    });
    if (buildResult.ambiguousStatements.length > 0) {
        return { success: false, error: 'SQL 表身份存在歧义，拒绝生成可回放操作。' };
    }
    if (buildResult.unknownStatements.some(statement => extractTableNamesFromStatements([statement]).length > 0)) {
        return { success: false, error: 'SQL 显式引用了未知表名，拒绝生成可回放操作。' };
    }
    return { success: true, operations: buildResult.operations };
}

function buildSheetReplaceOperationsFromData_ACU(
    afterData: Record<string, any> | null | undefined,
    sheetKeys: string[] | null | undefined,
    reason: 'manual_crud' | 'import' | 'system',
): TableMutationOperationV2_ACU[] {
    if (!afterData || typeof afterData !== 'object' || !Array.isArray(sheetKeys) || sheetKeys.length === 0) return [];
    const seen = new Set<string>();
    const operations: TableMutationOperationV2_ACU[] = [];
    sheetKeys.forEach(sheetKey => {
        if (typeof sheetKey !== 'string' || !sheetKey.startsWith('sheet_') || seen.has(sheetKey)) return;
        const sheet = afterData[sheetKey];
        if (!sheet || typeof sheet !== 'object') return;
        seen.add(sheetKey);
        operations.push({ kind: 'sheet_replace', sheetKey, sheet: JSON.parse(JSON.stringify(sheet)), reason });
    });
    return operations;
}

/**
 * 对 afterData 中给定持久化范围内的总结/大纲表应用自动编号，返回内容实际变化的表键。
 *
 * 编号只作用于本次会被持久化的表（scopeKeys）：编号变更必须随 afterData 一起落盘，
 * 否则 persist 的 replay === afterData 校验会失败或编号静默丢失。调用方须对返回的
 * 表键追加 sheet_replace 操作——sql_sheet_batch 回放不应用编号，必须由 replace 覆盖
 * 才能保证回放结果与 afterData 一致（回放零语义改动）。
 */
function applyAutoNumberingWithinScope_ACU(afterData: Record<string, any>, scopeKeys: readonly string[]): string[] {
    if (!afterData || typeof afterData !== 'object' || !Array.isArray(scopeKeys) || scopeKeys.length === 0) return [];
    const view: Record<string, any> = {};
    const before = new Map<string, string>();
    for (const sheetKey of scopeKeys) {
        if (typeof sheetKey !== 'string' || !sheetKey.startsWith('sheet_')) continue;
        const sheet = afterData[sheetKey];
        if (!sheet || typeof sheet !== 'object') continue;
        view[sheetKey] = sheet;
        before.set(sheetKey, JSON.stringify(sheet.content ?? null));
    }
    applySpecialIndexSequenceToSummaryTables_ACU(view);
    const renumbered: string[] = [];
    for (const [sheetKey, snapshot] of before) {
        if (JSON.stringify(view[sheetKey]?.content ?? null) !== snapshot) renumbered.push(sheetKey);
    }
    return renumbered;
}

function getTouchedSheetKeysFromSqlText_ACU(sqlText: string, tableData: Record<string, any>): string[] {
    const statements = normalizeSqlStatementsForRuntimeLog_ACU(sqlText);
    if (statements.length === 0) return [];
    const tableNames = extractTableNamesFromStatements(statements);
    return mapSqlTableNamesToSheetKeys_ACU(tableData as any, tableNames);
}

function shouldDiscardUnauthorizedTableEdits_ACU(): boolean {
    return settings_ACU.discardUnauthorizedTableEditsEnabled !== false;
}

function formatAllowedSheetKeys_ACU(sheetKeys: readonly string[]): string {
    const normalized = [...new Set(sheetKeys.filter(key => typeof key === 'string' && key.startsWith('sheet_')))].sort();
    return normalized.length > 0 ? normalized.join(', ') : '无（当前任务未授权任何目标表）';
}

function findSqlFailureGroupKey_ACU(sqlTexts: string[], responses: GroupFillResponse_ACU[], errorMessage: string): string | null {
    const match = String(errorMessage || '').match(/第\s*(\d+)\s*条语句失败/);
    const failedIndex = match ? Number.parseInt(match[1], 10) : NaN;
    if (!Number.isFinite(failedIndex) || failedIndex <= 0) return null;

    let cursor = 0;
    for (let i = 0; i < sqlTexts.length; i += 1) {
        const count = normalizeSqlStatementsForRuntimeLog_ACU(sqlTexts[i]).length;
        if (failedIndex > cursor && failedIndex <= cursor + count) {
            return responses[i]?.job?.groupKey || null;
        }
        cursor += count;
    }
    return null;
}

function getRuntimeTableDataSnapshot_ACU(fallbackData: Record<string, any> | null = null): Record<string, any> | null {
    const explicitFallback = cloneTableDataSnapshot_ACU(fallbackData || null);
    if (hasUsableRuntimeTableData_ACU(explicitFallback)) return explicitFallback;

    try {
        const providerData = getStorageProvider().getCurrentData();
        const cloned = cloneTableDataSnapshot_ACU(providerData as any);
        if (hasUsableRuntimeTableData_ACU(cloned)) return cloned;
    } catch (error) {
        logWarn_ACU('[RuntimeSnapshot] 无法从运行时存储导出当前表格快照，改用内存快照兜底。', error);
    }

    const fallback = cloneTableDataSnapshot_ACU(currentJsonTableData_ACU || null);
    if (hasUsableRuntimeTableData_ACU(fallback)) return fallback;
    return null;
}



function mergeGuideStructureIntoBaseData_ACU(data: Record<string, any>): Record<string, any> {
    const base = cloneTableDataSnapshot_ACU(data) || {};
    const batchIsoKey = getCurrentIsolationKey_ACU();
    const sheetGuideForBatch = getChatSheetGuideDataForIsolationKey_ACU(batchIsoKey);
    if (!sheetGuideForBatch || typeof sheetGuideForBatch !== 'object' || !Object.keys(sheetGuideForBatch).some(k => k.startsWith('sheet_'))) {
        return base;
    }

    const guideBase = buildGuidedBaseDataFromSheetGuide_ACU(sheetGuideForBatch);
    const historicalKeyMigrations = resolveHistoricalSheetKeyMigrations_ACU(base, guideBase);
    for (const [sourceKey, targetKey] of historicalKeyMigrations) {
        base[targetKey] = base[sourceKey];
        if (base[targetKey] && typeof base[targetKey] === 'object') base[targetKey].uid = targetKey;
        delete base[sourceKey];
        logDebug_ACU(`[MergeBase] 已按规范表名将历史 Sheet key 对齐：${sourceKey} -> ${targetKey}`);
    }

    if (!base.mate && guideBase?.mate) base.mate = JSON.parse(JSON.stringify(guideBase.mate));
    Object.keys(guideBase || {}).forEach(sheetKey => {
        if (!sheetKey.startsWith('sheet_')) return;
        if (base[sheetKey]) {
            restoreGuideStructure(base[sheetKey], guideBase[sheetKey]);
        } else {
            base[sheetKey] = JSON.parse(JSON.stringify(guideBase[sheetKey]));
        }
    });
    return base;
}

async function loadV2ReplayMergeBase_ACU(
    batchNumber: number,
    options: { maxMessageIndex?: number } = {},
    replayEvidence?: import('./v2-replay-session').V2ReplayEvidence_ACU | null,
): Promise<{ data: Record<string, any> | null; attempted: boolean; failed?: string }> {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) return { data: null, attempted: false };

    const isolationKey = getCurrentIsolationKey_ACU();
    const strategy = resolveTableStorageStrategy_ACU(chat, isolationKey, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
    });
    if (strategy.mode !== 'v2') return { data: null, attempted: false };

    try {
        const replayResult = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
            ...options,
            updateRuntimeState: false,
            allowTemporaryTemplateBaseline: true,
            throwOnRecoveryRequired: true,
            ...(replayEvidence ? { replayEvidence } : {}),
        });
        if (hasStructuralReplayCompatibilityRepairs_ACU(replayResult?.compatibilityRepairs)) {
            const affectedSheetKeys = [...new Set((replayResult.compatibilityRepairs || []).map(item => item.sheetKey))];
            throw new Error(`V2 replay 存在结构性兼容修复（${affectedSheetKeys.join('、') || '未知 Sheet'}）；请先执行 V2 恢复或边界 compaction，再继续生成新表格增量。`);
        }
        const cloned = cloneTableDataSnapshot_ACU(replayResult?.data as any);
        if (!hasUsableRuntimeTableData_ACU(cloned)) return { data: null, attempted: true };
        const mergedData = mergeGuideStructureIntoBaseData_ACU(cloned as Record<string, any>);
        _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(mergedData)));
        const scope = Number.isInteger(options.maxMessageIndex) ? `<=${options.maxMessageIndex}` : 'latest';
        const baseKind = replayResult?.baseKind === 'temporary_template_baseline' ? 'temporary-template' : 'checkpoint';
        logDebug_ACU(`[Batch ${batchNumber}] Using V2 replay state as merge base (${scope}, base=${baseKind}).`);
        return { data: mergedData, attempted: true };
    } catch (error) {
        // 回放异常与「边界内确实没有数据」必须区分开。
        // 回放坏掉时若退化成空模板基底，AI 会以为表是空的并生成 INSERT，
        // 写下的增量与真实基底同 row_id 冲突（UNIQUE constraint failed），坏数据继续扩散。
        const message = error instanceof Error ? error.message : String(error);
        logError_ACU(`[Batch ${batchNumber}] V2 replay merge base failed; 已中止本批填表以避免写出冲突增量。`, error);
        return { data: null, attempted: true, failed: message };
    }
}


/** 空基底退化提示的节流窗口：同一次手动补齐会按批次多次命中，30 秒内只提示一次。 */
const EMPTY_BASE_FALLBACK_TOAST_THROTTLE_MS_ACU = 30_000;
let lastEmptyBaseFallbackToastAt_ACU = 0;

/**
 * S2-3：有界填表在目标楼层前找不到任何可回放表格基底时，会从空指导表/模板结构起底填表。
 * 该退化语义上是安全的（避免把边界后的未来状态喂给本批次），但必须让用户知道
 * 「本次填表不含任何历史数据」，否则会误以为历史数据参与了填表。提示绝不抛错，且做节流去重。
 */
function notifyBoundedEmptyBaseFallback_ACU(batchNumber: number): void {
    try {
        const now = Date.now();
        if (now - lastEmptyBaseFallbackToastAt_ACU < EMPTY_BASE_FALLBACK_TOAST_THROTTLE_MS_ACU) return;
        lastEmptyBaseFallbackToastAt_ACU = now;
        showUiSurfaceToast_ACU({
            kind: 'info',
            text: `目标楼层之前没有可用的表格历史基底，本次填表（批次 ${batchNumber} 起）将从空白模板结构开始，不包含任何历史表格数据。`,
        });
    } catch (_) {}
}

function buildGuideOrTemplateMergeBase_ACU(batchNumber: number): { data: Record<string, any> | null; error: string | null } {
    const batchIsoKey = getCurrentIsolationKey_ACU();
    const sheetGuideForBatch = getChatSheetGuideDataForIsolationKey_ACU(batchIsoKey);
    if (sheetGuideForBatch && typeof sheetGuideForBatch === 'object' && Object.keys(sheetGuideForBatch).some(k => k.startsWith('sheet_'))) {
        const data = buildGuidedBaseDataFromSheetGuide_ACU(sheetGuideForBatch);
        logDebug_ACU(`[Batch ${batchNumber}] Using chat sheet guide as merge base.`);
        return { data, error: null };
    }
    const data = parseTableTemplateJson_ACU({ stripSeedRows: true });
    logDebug_ACU(`[Batch ${batchNumber}] No chat sheet guide found, using template as merge base.`);
    return { data, error: null };
}

export async function buildBatchMergeBase_ACU(
    batchNumber: number,
    options: { maxMessageIndex?: number } = {},
    replayEvidence?: import('./v2-replay-session').V2ReplayEvidence_ACU | null,
): Promise<{ data: Record<string, any> | null; error: string | null }> {
    try {
        const hasBoundedScope = Number.isInteger(options.maxMessageIndex);
        if (hasBoundedScope) {
            const v2ReplayResult = await loadV2ReplayMergeBase_ACU(batchNumber, options, replayEvidence);
            if (v2ReplayResult.data) return { data: v2ReplayResult.data, error: null };
            if (v2ReplayResult.failed) {
                // 回放坏了：绝不能退化为空基底去填表，否则 AI 会按空表生成 INSERT，
                // 与真实基底的同 row_id 冲突，把损坏继续放大。
                return {
                    data: null,
                    error: `历史表格数据回放失败（已自动尝试全部兼容读取层仍失败），已中止填表以避免写出冲突增量。请在数据管理中导出原始数据后执行 V2 恢复：${v2ReplayResult.failed}`,
                };
            }
            // 有历史边界时不能让 SQLite latest runtime 越过 maxMessageIndex；
            // 若当前聊天已进入 V2 replay 语义但边界内无可用基底，同样不能退回最新 runtime，
            // 否则会把目标范围之后的未来表格状态带回 prompt。只有非 SQLite 且未命中 V2 replay
            // 的旧路径才允许沿用 runtime fallback，以保留连续 bucket 的既有行为。
            if (isSqliteMode() || v2ReplayResult.attempted) {
                notifyBoundedEmptyBaseFallback_ACU(batchNumber);
                return buildGuideOrTemplateMergeBase_ACU(batchNumber);
            }
        }

        const runtimeData = getRuntimeTableDataSnapshot_ACU();
        if (runtimeData && isSqliteMode()) {
            logDebug_ACU(`[Batch ${batchNumber}] Using SQLite runtime storage snapshot as merge base.`);
            return { data: mergeGuideStructureIntoBaseData_ACU(runtimeData), error: null };
        }

        const v2ReplayResult = await loadV2ReplayMergeBase_ACU(batchNumber, options, replayEvidence);
        if (v2ReplayResult.data) return { data: v2ReplayResult.data, error: null };
        if (v2ReplayResult.failed) {
            return {
                data: null,
                error: `历史表格数据回放失败（已自动尝试全部兼容读取层仍失败），已中止填表以避免写出冲突增量。请在数据管理中导出原始数据后执行 V2 恢复：${v2ReplayResult.failed}`,
            };
        }

        // 指定了历史边界时，若当前聊天是 V2 但边界前没有可重放 checkpoint，不能退回“最新运行时快照”，
        // 否则会把目标楼之后的表格数据喂给本批次；此时应按空指导表/模板从零开始。
        if (!isSqliteMode() && v2ReplayResult.attempted && hasBoundedScope) {
            notifyBoundedEmptyBaseFallback_ACU(batchNumber);
            return buildGuideOrTemplateMergeBase_ACU(batchNumber);
        }

        if (runtimeData) {
            logDebug_ACU(`[Batch ${batchNumber}] Using runtime storage snapshot as merge base.`);
            return { data: mergeGuideStructureIntoBaseData_ACU(runtimeData), error: null };
        }

        return buildGuideOrTemplateMergeBase_ACU(batchNumber);
    } catch (e) {
        logError_ACU(`[Batch ${batchNumber}] Failed to build merge base from guide/template.`, e);
        return { data: null, error: '无法构建合并基底，操作已终止。' };
    }
}


/**
 * 确定更新模式
 * 纯业务逻辑
 */
export function resolveUpdateMode_ACU(mode: string): string {
    if (mode === 'auto_unified' || mode === 'manual_unified' || mode === 'full') {
        return mode;
    } else if (mode === 'auto_summary_silent') {
        return 'auto_summary_silent';
    } else if (mode && mode.startsWith('manual')) {
        if (mode.includes('summary')) return 'manual_summary';
        else if (mode === 'manual_independent') return 'manual_independent';
        else return 'manual_standard';
    } else {
        if (mode && mode.includes('summary')) return 'auto_summary';
        else return 'auto_standard';
    }
}

export async function collectGroupFillResponse_ACU(
    job: GroupFillJob_ACU,
    feedback?: { lastSqlError?: string | null; lastUnifiedError?: string | null },
    abortController: AbortController | null = new AbortController(),
    options: {
        onProgress?: (event: CardUpdateProgressEvent) => void;
        maxRetriesOverride?: number;
        respectGlobalStop?: boolean;
        worldbookReadContext?: LorebookReadContext_ACU;
    } = {}
): Promise<GroupFillResponse_ACU> {
    const effectiveAbortController = abortController || new AbortController();
    const isStopped = () => effectiveAbortController.signal.aborted || (options.respectGlobalStop !== false && wasStoppedByUser_ACU);
    const maxRetries = options.maxRetriesOverride || settings_ACU.tableMaxRetries || 3;
    if (isStopped()) return { job, success: false, attempt: 0, aborted: true };
    // 请求前冻结 runtime schema 失败 = 本地基础设施失败：模型无法通过重试修复。
    // 必须在 AI 调用前 fail-closed，避免消耗 token 后在提交阶段才失败。
    const runtimeSchemaFailure = job.sqlApplyScope?.runtimeSchemaFailure;
    if (runtimeSchemaFailure) {
        const error = `SQLite runtime schema 冻结失败（${runtimeSchemaFailure.code}）：${runtimeSchemaFailure.message}`;
        return {
            job,
            success: false,
            attempt: 0,
            error,
            rawError: error,
            errorCategory: 'infrastructure',
        };
    }
    options.onProgress?.({ phase: 'preparing', attempt: 1, maxRetries: 1 });
    const prepareSpan = startRuntimePerformanceSpan_ACU('table-fill-prepare-ai-input', {
        runId: job.performanceRunId,
        parentSpanId: job.performanceParentSpanId,
        settings: settings_ACU,
        metrics: {
            messageCount: job.messagesForContext.length,
            sheetCount: Array.isArray(job.targetSheetKeys) ? job.targetSheetKeys.length : 0,
            sqlite: isSqliteMode(),
        },
    });
    let dynamicContent: any = null;
    try {
        dynamicContent = await prepareAIInput_ACU(job.messagesForContext, job.updateMode, job.targetSheetKeys, {
            tableData: job.baseSnapshot,
            excludeImportTaggedWorldbookEntries: job.isImportMode === true && settings_ACU.importPromptExcludeImportedWorldbookEntries !== false,
            agentGreenlights: Array.isArray(pendingFinalGenerationGreenlights_ACU) ? [...pendingFinalGenerationGreenlights_ACU] : [],
            isolationKey: job.isolationKey,
            templateScope: job.templateScope,
            sqlApplyScope: job.sqlApplyScope,
            signal: effectiveAbortController.signal,
            worldbookReadContext: options.worldbookReadContext,
        });
    } catch (error: any) {
        prepareSpan.end({ success: false });
        if (error?.name === 'AbortError' || isStopped()) return { job, success: false, attempt: 0, aborted: true };
        throw error;
    }
    prepareSpan.end({ success: Boolean(dynamicContent) });
    if (dynamicContent && typeof dynamicContent === 'object' && dynamicContent.ok === false) {
        const failure = dynamicContent as { failureCode?: string; message?: string };
        const error = `无法准备AI输入（${failure.failureCode || 'provider_load_failed'}）：${failure.message || 'SQLite 运行时未就绪。'}`;
        return {
            job,
            success: false,
            attempt: 0,
            error,
            rawError: error,
            errorCategory: 'infrastructure',
        };
    }

    if (!dynamicContent) {
        return {
            job,
            success: false,
            attempt: 0,
            error: '无法准备AI输入，数据库未加载。',
            rawError: '无法准备AI输入，数据库未加载。',
            errorCategory: 'infrastructure',
        };
    }
    let lastErrorMessage = 'AI响应中未找到完整有效的 <tableEdit> 标签';
    let lastErrorCategory: TableUpdateCommitErrorCategory_ACU = 'model';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (isStopped()) {
            return { job, success: false, attempt, aborted: true };
        }

        options.onProgress?.({ phase: 'calling_ai', attempt, maxRetries });

        if (feedback?.lastSqlError && isSqliteMode()) {
            const markerIndex = dynamicContent.tableDataText.indexOf(SQL_ERROR_MARKER_ACU);
            if (markerIndex !== -1) {
                dynamicContent.tableDataText = dynamicContent.tableDataText.substring(0, markerIndex);
            }
            dynamicContent.tableDataText += `${SQL_ERROR_MARKER_ACU}[SQL执行错误，请修正后重新输出]\n错误信息: ${sanitizeRetryFeedback_ACU(feedback.lastSqlError)}`;
        }
        if (feedback?.lastUnifiedError) {
            const markerIndex = dynamicContent.tableDataText.indexOf(UNIFIED_GROUP_ERROR_MARKER_ACU);
            if (markerIndex !== -1) {
                dynamicContent.tableDataText = dynamicContent.tableDataText.substring(0, markerIndex);
            }
            dynamicContent.tableDataText += `${UNIFIED_GROUP_ERROR_MARKER_ACU}[统一提交失败，请修正后重新输出]\n错误信息: ${sanitizeRetryFeedback_ACU(feedback.lastUnifiedError)}`;
        }

        try {
            const aiWaitSpan = startRuntimePerformanceSpan_ACU('table-fill-ai-wait', {
                runId: job.performanceRunId,
                parentSpanId: job.performanceParentSpanId,
                settings: settings_ACU,
                metrics: { sheetCount: Array.isArray(job.targetSheetKeys) ? job.targetSheetKeys.length : 0 },
            });
            let aiResponse: string;
            try {
                aiResponse = await callCustomOpenAI_ACU(dynamicContent, effectiveAbortController, {
                    ...(job.requestOptions || {}),
                    tableData: job.baseSnapshot,
                    targetSheetKeys: job.targetSheetKeys,
                });
                aiWaitSpan.end({ success: true });
            } catch (error) {
                aiWaitSpan.end({ success: false });
                throw error;
            }
            if (isStopped()) {
                return { job, success: false, attempt, aborted: true };
            }

            const minReplyLength = settings_ACU.autoUpdateTokenThreshold || 0;
            if (aiResponse && minReplyLength > 0 && aiResponse.length < minReplyLength) {
                throw new ModelOutputRetryError_ACU(`AI回复过短 (${aiResponse.length} 字符)，低于阈值 (${minReplyLength} 字符)`);
            }
            let normalizedAiResponse = aiResponse;
            let tableEditText = '';
            if (settings_ACU.strictJsonTableFillEnabled === true) {
                const extracted = extractStrictJsonTableFillResponse_ACU(aiResponse, {
                    sqlite: isSqliteMode(),
                    tableData: job.baseSnapshot,
                    targetSheetKeys: job.targetSheetKeys,
                });
                if (!extracted.ok) {
                    throw new ModelOutputRetryError_ACU(extracted.retryHint || extracted.error || '严格 JSON 填表响应格式无效');
                }
                normalizedAiResponse = extracted.normalizedResponse || aiResponse;
                tableEditText = (extracted.tableEditText || '').trim();
            } else {
                if (!aiResponse || !aiResponse.includes('<tableEdit>') || !aiResponse.includes('</tableEdit>')) {
                    throw new ModelOutputRetryError_ACU('AI响应中未找到完整有效的 <tableEdit> 标签');
                }
                tableEditText = (aiResponse.match(/<tableEdit>([\s\S]*?)<\/tableEdit>/i)?.[1] || '').trim();
            }
            if (isSqliteMode() && tableEditText && isSqlContent(tableEditText)) {
                try {
                    // 隐藏列保护使用请求前冻结的 live runtime schema 证据，而不是 baseSnapshot：
                    // 历史快照可能缺失 descriptor 或含旧表头，会把 live 合法列误判为隐藏列。
                    assertNoHiddenPhysicalColumnMutations_ACU(
                        splitSqlStatements(tableEditText),
                        job.sqlApplyScope?.runtimeData ? job.sqlApplyScope.runtimeData as any : job.baseSnapshot,
                    );
                } catch (error: any) {
                    throw new ModelOutputRetryError_ACU(error?.message || 'SQLite 填表 SQL 无效。');
                }
            }

            return { job, success: true, attempt, aiResponse: normalizedAiResponse, tableEditText };
        } catch (error: any) {
            lastErrorMessage = error?.message || '未知错误';
            lastErrorCategory = error instanceof ModelOutputRetryError_ACU
                || error instanceof RetryableAiResponseError_ACU
                ? 'model'
                : 'infrastructure';
            const warnMessage = sanitizeRetryFeedback_ACU(lastErrorMessage, MAX_WARN_ERROR_LENGTH_ACU);
            logWarn_ACU(`[${formatGroupAttemptLabel_ACU(job)}] 第 ${attempt} 次尝试失败: ${warnMessage}`);
            if (error?.name === 'AbortError' || String(lastErrorMessage).toLowerCase().includes('aborted') || isStopped()) {
                return { job, success: false, attempt, aborted: true };
            }
            if (lastErrorCategory !== 'model') {
                const safeError = sanitizeRetryFeedback_ACU(lastErrorMessage, MAX_WARN_ERROR_LENGTH_ACU);
                return {
                    job,
                    success: false,
                    attempt,
                    error: safeError,
                    rawError: safeError,
                    errorCategory: lastErrorCategory,
                };
            }
            if (attempt < maxRetries) {
                if (isSqliteMode() && error instanceof ModelOutputRetryError_ACU) {
                    const markerIndex = dynamicContent.tableDataText.indexOf(SQL_ERROR_MARKER_ACU);
                    if (markerIndex !== -1) dynamicContent.tableDataText = dynamicContent.tableDataText.substring(0, markerIndex);
                    dynamicContent.tableDataText += `${SQL_ERROR_MARKER_ACU}[上次 SQL 输出无效，请修正后重新输出]\n错误信息: ${sanitizeRetryFeedback_ACU(lastErrorMessage)}`;
                }
                options.onProgress?.({ phase: 'retry', attempt, maxRetries, message: sanitizeRetryFeedback_ACU(lastErrorMessage, 50) });
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    const safeError = sanitizeRetryFeedback_ACU(lastErrorMessage, MAX_WARN_ERROR_LENGTH_ACU);
    return {
        job,
        success: false,
        attempt: maxRetries,
        error: `填表在 ${maxRetries} 次尝试后仍失败: ${safeError}`,
        rawError: safeError,
        errorCategory: lastErrorCategory,
    };
}

function buildSqlInitializationBase_ACU(baseSnapshot: Record<string, any>, targetSheetKeys: string[]) {
    const workingTableData = JSON.parse(JSON.stringify(baseSnapshot || {}));
    const initializedSheetKeys = new Set<string>();

    let templateData: Record<string, any> | null = null;
    let guideData: Record<string, any> | null = null;
    let guidedBaseData: Record<string, any> | null = null;

    try {
        templateData = parseTableTemplateJson_ACU({ stripSeedRows: false }) as Record<string, any> | null;
    } catch (error) {
        logWarn_ACU('[SQL Init] parseTableTemplateJson_ACU failed, fallback to baseSnapshot only.', error);
    }
    try {
        guideData = getChatSheetGuideDataForIsolationKey_ACU(getCurrentIsolationKey_ACU());
        guidedBaseData = guideData ? buildGuidedBaseDataFromSheetGuide_ACU(guideData) : null;
    } catch (error) {
        logWarn_ACU('[SQL Init] getChatSheetGuideDataForIsolationKey_ACU failed, fallback to template/baseSnapshot only.', error);
    }

    const identityTargetData = guidedBaseData && Object.keys(guidedBaseData).some(key => key.startsWith('sheet_'))
        ? guidedBaseData
        : templateData;
    if (identityTargetData) {
        const historicalKeyMigrations = resolveHistoricalSheetKeyMigrations_ACU(workingTableData, identityTargetData);
        for (const [sourceKey, targetKey] of historicalKeyMigrations) {
            workingTableData[targetKey] = workingTableData[sourceKey];
            if (workingTableData[targetKey] && typeof workingTableData[targetKey] === 'object') workingTableData[targetKey].uid = targetKey;
            delete workingTableData[sourceKey];
        }
    }

    if (!workingTableData.mate && templateData?.mate) {
        workingTableData.mate = JSON.parse(JSON.stringify(templateData.mate));
    }

    for (const sheetKey of Array.isArray(targetSheetKeys) ? targetSheetKeys : []) {
        if (!sheetKey || !String(sheetKey).startsWith('sheet_')) continue;

        const templateSheet = templateData?.[sheetKey];
        const guidedSheet = guidedBaseData?.[sheetKey];
        const existingSheet = workingTableData?.[sheetKey];
        const sourceSheet = guidedSheet || templateSheet;
        if ((!existingSheet || typeof existingSheet !== 'object') && (!sourceSheet || typeof sourceSheet !== 'object')) continue;

        let sheetChanged = false;
        if (!existingSheet || typeof existingSheet !== 'object') {
            workingTableData[sheetKey] = {};
            sheetChanged = true;
        }

        const targetSheet = workingTableData[sheetKey];
        const fallbackUid = guidedSheet?.uid || templateSheet?.uid;
        const fallbackName = guidedSheet?.name || templateSheet?.name;
        const fallbackSourceData = guidedSheet?.sourceData && typeof guidedSheet.sourceData === 'object'
            ? guidedSheet.sourceData
            : (templateSheet?.sourceData && typeof templateSheet.sourceData === 'object' ? templateSheet.sourceData : null);
        const fallbackUpdateConfig = guidedSheet?.updateConfig && typeof guidedSheet.updateConfig === 'object'
            ? guidedSheet.updateConfig
            : (templateSheet?.updateConfig && typeof templateSheet.updateConfig === 'object' ? templateSheet.updateConfig : null);
        const fallbackExportConfig = guidedSheet?.exportConfig && typeof guidedSheet.exportConfig === 'object'
            ? guidedSheet.exportConfig
            : (templateSheet?.exportConfig && typeof templateSheet.exportConfig === 'object' ? templateSheet.exportConfig : null);
        const fallbackOrderNo = guidedSheet?.orderNo !== undefined ? guidedSheet.orderNo : templateSheet?.orderNo;
        const headerRow = Array.isArray(targetSheet?.content?.[0])
            ? targetSheet.content[0]
            : (Array.isArray(guidedSheet?.content?.[0])
                ? guidedSheet.content[0]
                : (Array.isArray(templateSheet?.content?.[0]) ? templateSheet.content[0] : null));

        if (!targetSheet.uid && fallbackUid) { targetSheet.uid = fallbackUid; sheetChanged = true; }
        if (!targetSheet.name && fallbackName) { targetSheet.name = fallbackName; sheetChanged = true; }
        if ((!targetSheet.sourceData || typeof targetSheet.sourceData !== 'object') && fallbackSourceData) {
            targetSheet.sourceData = JSON.parse(JSON.stringify(fallbackSourceData));
            sheetChanged = true;
        } else if (!targetSheet?.sourceData?.ddl && fallbackSourceData?.ddl) {
            targetSheet.sourceData = { ...(targetSheet.sourceData || {}), ddl: fallbackSourceData.ddl };
            sheetChanged = true;
        }
        if ((!targetSheet.updateConfig || typeof targetSheet.updateConfig !== 'object') && fallbackUpdateConfig) {
            targetSheet.updateConfig = JSON.parse(JSON.stringify(fallbackUpdateConfig));
            sheetChanged = true;
        }
        if ((!targetSheet.exportConfig || typeof targetSheet.exportConfig !== 'object') && fallbackExportConfig) {
            targetSheet.exportConfig = JSON.parse(JSON.stringify(fallbackExportConfig));
            sheetChanged = true;
        }
        if ((targetSheet.orderNo === undefined || targetSheet.orderNo === null) && fallbackOrderNo !== undefined) {
            targetSheet.orderNo = fallbackOrderNo;
            sheetChanged = true;
        }

        if (!Array.isArray(targetSheet.content)) {
            targetSheet.content = headerRow ? [JSON.parse(JSON.stringify(headerRow))] : [];
            sheetChanged = true;
        } else if (targetSheet.content.length === 0 && headerRow) {
            targetSheet.content = [JSON.parse(JSON.stringify(headerRow))];
            sheetChanged = true;
        } else if (!Array.isArray(targetSheet.content[0]) && headerRow) {
            targetSheet.content[0] = JSON.parse(JSON.stringify(headerRow));
            sheetChanged = true;
        }

        if (shouldUseInitialSeedRows_ACU() && Array.isArray(targetSheet.content) && targetSheet.content.length <= 1) {
            let seedRows = getEffectiveSeedRowsForSheet_ACU(sheetKey, { guideData, allowTemplateFallback: true });
            if ((!Array.isArray(seedRows) || seedRows.length === 0) && Array.isArray(sourceSheet?.content) && sourceSheet.content.length > 1) {
                seedRows = JSON.parse(JSON.stringify(sourceSheet.content.slice(1)));
            }
            if (Array.isArray(seedRows) && seedRows.length > 0) {
                targetSheet.content = [targetSheet.content[0] || [], ...JSON.parse(JSON.stringify(seedRows))];
                targetSheet.content = ensureStableRowIdsForSheetContent_ACU(targetSheet.content);
                sheetChanged = true;
            }
        }

        if (sheetChanged) initializedSheetKeys.add(sheetKey);
    }

    return { workingTableData, initializedSheetKeys };
}

function sortGroupFillResponses_ACU(responses: GroupFillResponse_ACU[]): GroupFillResponse_ACU[] {
    return [...responses].sort((a, b) => {
        const jobA = a.job;
        const jobB = b.job;
        return (jobA?.saveTargetIndex || 0) - (jobB?.saveTargetIndex || 0)
            || (jobA?.batchNumber || 0) - (jobB?.batchNumber || 0)
            || (jobA?.groupId || 0) - (jobB?.groupId || 0)
            || String(jobA?.groupKey || '').localeCompare(String(jobB?.groupKey || ''));
    });
}

function isGroupFillSqlResponse_ACU(response: GroupFillResponse_ACU): boolean {
    return typeof response.tableEditText === 'string' && isSqlContent(response.tableEditText);
}

function getMixedSqliteNonSqlResponses_ACU(responses: GroupFillResponse_ACU[]): GroupFillResponse_ACU[] {
    if (!isSqliteMode()) return [];
    const hasSql = responses.some(isGroupFillSqlResponse_ACU);
    if (!hasSql) return [];
    return responses.filter(response => !isGroupFillSqlResponse_ACU(response));
}

function buildMixedSqliteFormatError_ACU(nonSqlResponses: GroupFillResponse_ACU[]): string {
    const groupLabels = nonSqlResponses.map(formatResponseGroupReference_ACU).join(', ');
    return `SQLite 严格模式下同一批分组填表禁止混合 SQL/非 SQL 输出；以下分组未返回 SQL tableEdit：${groupLabels}。请只重试这些分组，并输出 SQL。`;
}

async function applyUnifiedGroupFillResponsesCore_ACU(
    responses: GroupFillResponse_ACU[],
    baseSnapshot: Record<string, any>,
    options: {
        saveTargetIndex: number;
        updateMode: string;
        isImportMode: boolean;
        chatKey?: string;
        isolationKey?: string;
        templateScope?: TemplateScope_ACU;
        sqlApplyScope?: SqlTableApplyScope_ACU;
        replaceExistingIncremental?: { targetMessageIndices: number[]; targetSheetKeys: string[] };
        manualRefillProgress?: ManualRefillProgressV2_ACU;
        syncAfterCommit?: boolean;
        baseRevision?: string | null;
        manualCatchUpRunId?: string;
        commitMode?: 'persist_v2' | 'stage_only';
        stagingSession?: TableFillStagingSession_ACU;
        performanceRunId?: string;
        performanceParentSpanId?: string;
    }
): Promise<CardUpdateResult> {
    if (!Array.isArray(responses) || responses.length === 0) {
        return { success: false, modifiedKeys: [], error: '统一提交失败：responses 为空。', errorCategory: 'precondition' };
    }
    if (!baseSnapshot || typeof baseSnapshot !== 'object') {
        return { success: false, modifiedKeys: [], error: '统一提交失败：baseSnapshot 无效。', errorCategory: 'precondition' };
    }

    const sortedResponses = sortGroupFillResponses_ACU(responses);
    const firstJob = sortedResponses[0]?.job;
    const capturedChatKey = options.chatKey ?? firstJob?.chatKey;
    const capturedIsolationKey = options.isolationKey ?? firstJob?.isolationKey ?? getCurrentIsolationKey_ACU();
    const capturedSqlApplyScope = options.sqlApplyScope ?? firstJob?.sqlApplyScope;
    const capturedTemplateScope = options.templateScope !== undefined
        ? options.templateScope
        : firstJob?.templateScope !== undefined
        ? firstJob.templateScope
        : capturedSqlApplyScope
        ? buildTemplateScopeFromData_ACU(capturedSqlApplyScope.templateData)
        : resolveTemplateScope_ACU(capturedIsolationKey);

    // 请求前冻结 runtime schema 失败 = 本地前置条件/infrastructure 失败：
    // 模型无法通过重试修复，不得进入 UNIFIED_GROUP_ERROR_FEEDBACK、不得触发第二次模型调用。
    const runtimeSchemaFailure = capturedSqlApplyScope?.runtimeSchemaFailure;
    if (runtimeSchemaFailure) {
        return {
            success: false,
            modifiedKeys: [],
            error: `统一提交失败：SQLite runtime schema 冻结失败（${runtimeSchemaFailure.code}）。${sanitizeRetryFeedback_ACU(runtimeSchemaFailure.message)}`,
            errorCategory: 'infrastructure' as const,
        };
    }

    const seenTargetSheetKeys = new Set<string>();
    const allTargetSheetKeySet = new Set<string>();
    for (const response of sortedResponses) {
        if (!response.success || !response.aiResponse || response.tableEditText === undefined || response.tableEditText === null || !response.job) {
            return { success: false, modifiedKeys: [], error: '统一提交失败：存在未完成或无效的 group 响应。', errorCategory: 'precondition' };
        }
        for (const sheetKey of response.job.targetSheetKeys || []) {
            if (seenTargetSheetKeys.has(sheetKey)) {
                return { success: false, modifiedKeys: [], error: `统一提交失败：targetSheetKeys 存在重叠冲突 (${sheetKey})。`, errorCategory: 'precondition' };
            }
            seenTargetSheetKeys.add(sheetKey);
            allTargetSheetKeySet.add(sheetKey);
        }
    }

    const hasSqlResponse = isSqliteMode() && sortedResponses.some(isGroupFillSqlResponse_ACU);
    const nonSqlResponsesInMixedSqlite = getMixedSqliteNonSqlResponses_ACU(sortedResponses);
    if (hasSqlResponse && nonSqlResponsesInMixedSqlite.length > 0) {
        return {
            success: false,
            modifiedKeys: [],
            error: buildMixedSqliteFormatError_ACU(nonSqlResponsesInMixedSqlite),
            errorCategory: 'model',
        };
    }

    const allResponsesAreRuntimeSql = isSqliteMode()
        && sortedResponses.length > 0
        && sortedResponses.every(isGroupFillSqlResponse_ACU);

    if (hasSqlResponse && !allResponsesAreRuntimeSql) {
        return {
            success: false,
            modifiedKeys: [],
            error: 'SQLite 严格模式下 SQL 填表禁止退化为快照写入；请使用 live SQLite runtime 提交或重试本组。',
            errorCategory: 'model',
        };
    }

    if (allResponsesAreRuntimeSql) {
        const operations: TableMutationOperationV2_ACU[] = [];
        const sqlTexts: string[] = [];
        // 与 sqlTexts 一一对应的 response，避免屏蔽后按索引取值错位。
        const sqlResponses: typeof sortedResponses = [];
        // 模板只起指导作用：范围外的表连 SQL 一起屏蔽。
        // 只屏蔽写入而仍执行 SQL，会在运行时改动范围外的表并产生无法回放的孤立增量。
        const sqlScope = capturedTemplateScope;
        const sqlScopedKeys = (keys: readonly string[]) => filterSheetKeysByTemplateScope_ACU(keys, sqlScope);

        for (const response of sortedResponses) {
            const scopedTargets = sqlScopedKeys(response.job.targetSheetKeys || []);
            if ((response.job.targetSheetKeys || []).length > 0 && scopedTargets.length === 0) {
                logDebug_ACU(`[TemplateScope] ${formatResponseGroupReference_ACU(response)} 的目标表不在模板范围内，已屏蔽其 SQL。`);
                continue;
            }
            let reboundStatements: string[];
            try {
                // 列 registry 只注册本次请求的 SQL 活动表（scope 已过滤非首列空表头表）：
                // 休眠表即使被 AI 猜中也不进入 registry，杜绝把它当作可写目标。
                const activeSheetKeySet = capturedSqlApplyScope?.activeSheetKeys
                    ? new Set(capturedSqlApplyScope.activeSheetKeys)
                    : undefined;
                // [统一 schema 权威] 重绑 targetData 使用请求前冻结的 live runtime schema 视图，
                // 而不是 baseSnapshot（历史 replay/merge 基底只承担数据/CAS/操作职责）。
                // baseSnapshot 含旧空表头时不再阻断对 live 合法表的 SQL 校验（test31 根因修复）。
                const rebindTargetData = (capturedSqlApplyScope?.runtimeData
                    ? capturedSqlApplyScope.runtimeData
                    : baseSnapshot) as any;
                reboundStatements = rebindSqlMutationIdentifiers_ACU(
                    normalizeSqlStatementsForRuntimeLog_ACU(response.tableEditText || ''),
                    rebindTargetData,
                    capturedSqlApplyScope?.templateData,
                    { requireKnownTables: true, targetSheetKeys: activeSheetKeySet, requireKnownInsertColumns: true },
                );
                // collect 不是安全边界。执行前再次校验 AI SQL，防止导出函数被直接调用时绕过白名单。
                assertNoHiddenPhysicalColumnMutations_ACU(reboundStatements, capturedSqlApplyScope?.runtimeData ? capturedSqlApplyScope.runtimeData as any : baseSnapshot);
            } catch (error: any) {
                // 歧义英文表名属于前置条件失败：AI 无法通过重试解决，回灌错误只会浪费模型调用并等待 5 秒。
                // 分类为 precondition，不包装 ModelOutputRetryError_ACU、不回灌、不重试。
                const isAliasAmbiguous = error?.code === 'SQL_ALIAS_AMBIGUOUS_ACU';
                // 本地 runtime schema 问题（冻结失败/漂移）也是前置条件/infrastructure 失败：
                // 模型无法修复，禁止回灌 UNIFIED_GROUP_ERROR_FEEDBACK。
                const isRuntimeSchemaError = error instanceof SqlRuntimeSchemaInvalidError_ACU
                    || error instanceof SqlRuntimeSchemaStaleError_ACU
                    || error?.code === 'SQL_RUNTIME_SCHEMA_INVALID_ACU'
                    || error?.code === 'SQL_RUNTIME_SCHEMA_STALE_ACU';
                return {
                    success: false,
                    modifiedKeys: [],
                    error: isAliasAmbiguous || isRuntimeSchemaError
                        ? `统一提交失败：${formatResponseGroupReference_ACU(response)} ${sanitizeRetryFeedback_ACU(error?.message || String(error))}`
                        : `统一提交失败：${formatResponseGroupReference_ACU(response)} SQL 校验失败。${sanitizeRetryFeedback_ACU(error?.message || String(error))}`,
                    errorCategory: isAliasAmbiguous || isRuntimeSchemaError ? 'precondition' : 'model',
                };
            }

            if (Array.isArray(response.job.targetSheetKeys) && response.job.targetSheetKeys.length > 0) {
                // 授权集合必须与"已按 TemplateScope 过滤的目标"一致：隐藏表已从 scope 移除，
                // 即使 AI 仍把它写进 targetSheetKeys，也不得授权写入（阶段3：统一 allowed）。
                const allowedSheetKeys = new Set(scopedTargets);
                const retainedStatements: string[] = [];
                const discardedKeys = new Set<string>();
                for (const statement of reboundStatements) {
                    // 表名归属同样以冻结 runtime 视图为准：baseSnapshot 可能是旧 schema/空表头，
                    // 用它反查会让真实表被误判为"未授权"或"范围外"。
                    const touchedKeys = getTouchedSheetKeysFromSqlText_ACU(statement, capturedSqlApplyScope?.runtimeData ? capturedSqlApplyScope.runtimeData as any : baseSnapshot);
                    const unauthorizedKeys = touchedKeys.filter(sheetKey => !allowedSheetKeys.has(sheetKey));
                    if (unauthorizedKeys.length === 0) {
                        retainedStatements.push(statement);
                        continue;
                    }
                    const authorizedKeys = touchedKeys.filter(sheetKey => allowedSheetKeys.has(sheetKey));
                    const mayDiscardStatement = shouldDiscardUnauthorizedTableEdits_ACU()
                        && authorizedKeys.length === 0
                        && touchedKeys.length > 0;
                    if (!mayDiscardStatement) {
                        return {
                            success: false,
                            modifiedKeys: [],
                            error: `统一提交失败：${formatResponseGroupReference_ACU(response)} 越权修改了非目标表 (${unauthorizedKeys.join(', ')})。允许写入表：${formatAllowedSheetKeys_ACU(scopedTargets)}。`,
                            errorCategory: 'model',
                        };
                    }
                    unauthorizedKeys.forEach(sheetKey => discardedKeys.add(sheetKey));
                }
                if (discardedKeys.size > 0) {
                    logWarn_ACU(`[TargetScope] ${formatResponseGroupReference_ACU(response)} 已丢弃仅影响非目标表的 SQL statement: ${[...discardedKeys].sort().join(', ')}`);
                }
                reboundStatements = retainedStatements;
                if (reboundStatements.length === 0) {
                    return {
                        success: false,
                        modifiedKeys: [],
                        error: `统一提交失败：${formatResponseGroupReference_ACU(response)} 的 SQL 仅修改非目标表，已全部丢弃。允许写入表：${formatAllowedSheetKeys_ACU(scopedTargets)}。请仅生成允许表的写入。`,
                        errorCategory: 'model',
                    };
                }
            }
            const sqlText = reboundStatements.join(';\n');
            sqlTexts.push(sqlText);
            sqlResponses.push(response);
        }

        if (sqlTexts.length === 0) {
            // 全部目标表都在模板范围外：无需执行也无需提交，避免写出空 entry。
            logDebug_ACU('[TemplateScope] 本次 SQL 填表的目标表全部在模板范围外，已跳过提交。');
            return { success: true, modifiedKeys: [], tableData: baseSnapshot as any };
        }

        if (options.commitMode === 'stage_only' && options.stagingSession) {
            const staged = await options.stagingSession.applyBucket({
                historicalBase: baseSnapshot,
                saveTargetIndex: options.saveTargetIndex,
                updateMode: options.updateMode,
                sqlTexts,
                sqlApplyScope: capturedSqlApplyScope,
            });
            if (staged.ok === false) {
                return {
                    success: false,
                    modifiedKeys: [],
                    error: sanitizeRetryFeedback_ACU(staged.error, MAX_WARN_ERROR_LENGTH_ACU),
                    errorCategory: staged.errorCategory,
                };
            }
            return { success: true, modifiedKeys: [...options.stagingSession.getTargetOverlay().targetSheetKeys], tableData: staged.tableData as any };
        }

        const commitResult = await runTableUpdateCommit_ACU<{ modifiedKeys: string[] }>({
            source: 'group_fill',
            reason: 'applyUnifiedGroupFillResponses:runtime_sql',
            chatKey: capturedChatKey,
            isolationKey: capturedIsolationKey,
            writeSet: buildWriteSetForSheetKeys_ACU([...allTargetSheetKeySet].filter(sheetKey => sqlScopedKeys([sheetKey]).length > 0), baseSnapshot),
            baseRevision: options.baseRevision,
            workingDataMode: 'none',
            initialData: baseSnapshot as any,
            targetMessageIndex: options.saveTargetIndex,
            targetSheetKeys: null,
            updateGroupKeys: null,
            trackingSheetKeys: null,
            trackAsUpdate: true,
            replaceExistingIncremental: options.replaceExistingIncremental,
            manualRefillProgress: options.manualRefillProgress,
            manualCatchUpRunId: options.manualCatchUpRunId,
            commitMode: options.commitMode,
            skipChatSave: options.isImportMode,
        }, async () => {
            const provider = await ensureStorageProviderReady_ACU();
            if (typeof provider.applyEditsWithSystemRowIds !== 'function') {
                return {
                    success: false,
                    error: '统一提交失败：SQLite provider 不支持原子 row_id 分配。',
                    errorCategory: 'infrastructure' as const,
                };
            }
            let parseResult: any;
            try {
                parseResult = provider.applyEditsWithSystemRowIds(sqlTexts, options.updateMode, capturedSqlApplyScope);
                sqlTexts.splice(0, sqlTexts.length, ...parseResult.materializedSqlTexts);
            } catch (error: any) {
                const rawErrorMessage = error?.message || String(error);
                const isInfrastructureError = error instanceof SqlRuntimeSnapshotError_ACU
                    || error instanceof SqlRuntimeSchemaInvalidError_ACU
                    || error instanceof SqlRuntimeSchemaStaleError_ACU;
                const failedGroupKey = findSqlFailureGroupKey_ACU(sqlTexts, sortedResponses, rawErrorMessage);
                return {
                    success: false,
                    error: error instanceof SqlRowIdMaterializationError_ACU
                        ? `统一提交失败：AI SQL 行身份分配失败。${sanitizeRetryFeedback_ACU(rawErrorMessage)}`
                        : failedGroupKey
                        ? `统一提交失败：${formatResponseGroupReference_ACU(sortedResponses.find(response => response.job.groupKey === failedGroupKey) || sortedResponses[0])} SQL 执行失败。${sanitizeRetryFeedback_ACU(rawErrorMessage)}`
                        : `统一提交失败：SQL 执行失败。${sanitizeRetryFeedback_ACU(rawErrorMessage)}`,
                    errorCategory: isInfrastructureError ? 'infrastructure' as const : 'model' as const,
                };
            }
            if (!parseResult?.success) {
                return {
                    success: false,
                    error: parseResult?.error ? `统一提交失败：SQL 执行失败。${sanitizeRetryFeedback_ACU(parseResult.error)}` : '统一提交失败：SQL 执行失败。',
                    errorCategory: 'model',
                };
            }

            const runtimeData = parseResult.tableData;
            operations.length = 0;
            const parsedModifiedKeys: string[] = Array.isArray(parseResult.modifiedKeys)
                ? parseResult.modifiedKeys.filter((key: unknown): key is string => typeof key === 'string')
                : [];
            const modifiedKeys: string[] = Array.from(new Set<string>(parsedModifiedKeys)).sort();
            const isFirstTimeInit = await checkIfFirstTimeInit_ACU();
            // 模板只起指导作用：快照只覆盖模板声明的表；范围外的表保持休眠。
            const snapshotScope = capturedTemplateScope;
            const scopedKeys = (keys: readonly string[]) => filterSheetKeysByTemplateScope_ACU(keys, snapshotScope);
            const allRuntimeSheetKeys: string[] = scopedKeys(getSortedSheetKeys_ACU(runtimeData));
            const initializedKeys = scopedKeys([...allTargetSheetKeySet])
                .filter(sheetKey => Boolean((runtimeData as any)?.[sheetKey]) && !Boolean((baseSnapshot as any)?.[sheetKey]))
                .sort();
            const keysToSave = isFirstTimeInit
                ? allRuntimeSheetKeys
                : scopedKeys([...new Set([...modifiedKeys, ...initializedKeys])].sort());
            const keysToTrack = scopedKeys([...new Set([...modifiedKeys, ...initializedKeys])].sort());
            // 自动编号（live SQL 填表出口）：作用于本次持久化范围内启用锁的总结/大纲表。
            const renumberedSheetKeys = applyAutoNumberingWithinScope_ACU(runtimeData, keysToSave);
            // 与快照路径同理：缺少 full checkpoint 锚点时本次写入是初始
            // checkpoint，只接受 afterData，不能附带 sql_sheet_batch operations；但若已存在
            // 可由模板临时基线回放的 orphan artifacts，则必须保留本次 operations，供 persist
            // 层校验 replay + operations === afterData 后升级为 integrity_repair checkpoint。
            // Prompt 上下文保持执行开始时的冻结快照；但 checkpoint 拓扑是持久化事实，
            // 首个 bucket 成功后必须立即对后续 bucket 可见，不能继续使用旧快照。
            const persistChat = getChatArray_ACU() || [];
            const persistIsolationKey = capturedIsolationKey;
            const hasCheckpointAnchor = hasAnyV2Checkpoint_ACU(
                persistChat,
                persistIsolationKey,
                options.saveTargetIndex,
            );
            const hasTemporaryReplayArtifacts = !hasCheckpointAnchor
                && hasUnanchoredReplayArtifactsForChatV2_ACU(persistChat, persistIsolationKey, { maxMessageIndex: options.saveTargetIndex });
            if (hasCheckpointAnchor || hasTemporaryReplayArtifacts) {
                // 只遍历实际执行过的 SQL（范围外的表已在收集阶段整条屏蔽），
                // 因此 sqlResponses 与 sqlTexts 一一对应，不会错位。
                for (let index = 0; index < sqlResponses.length; index += 1) {
                    const response = sqlResponses[index];
                    const operationBuild = buildSqlSheetBatchOperationsFromText_ACU(sqlTexts[index] || '', runtimeData, scopedKeys(response.job.targetSheetKeys || []));
                    if (operationBuild.success === false) {
                        return {
                            success: false,
                            error: `统一提交失败：${formatResponseGroupReference_ACU(response)} ${sanitizeRetryFeedback_ACU(operationBuild.error)}`,
                            errorCategory: 'model' as const,
                        };
                    }
                    operations.push(...operationBuild.operations);
                }
                // sql_sheet_batch 回放不应用自动编号：对编号实际变化的表追加 sheet_replace
                // 覆盖，保证回放结果与 afterData（含编号）逐字节一致。
                operations.push(...buildSheetReplaceOperationsFromData_ACU(runtimeData, renumberedSheetKeys, 'system'));
            } else {
                logDebug_ACU(
                    `[V2 Fill] 目标楼层 #${options.saveTargetIndex} 前无承载目标表的 full checkpoint，`
                    + `本次以初始 checkpoint 形式提交 SQL 运行时快照（tracked=${keysToTrack.join(',') || '无'}）。`,
                );
            }
            const fillAttemptKeys = scopedKeys([...allTargetSheetKeySet])
                .filter(sheetKey => Boolean((runtimeData as any)?.[sheetKey]))
                .sort();
            const revisionWriteSet = modifiedKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));

            return {
                success: true,
                value: { modifiedKeys },
                tableData: runtimeData as any,
                mutationResult: { changes: parseResult.appliedEdits || 0, errors: [] },
                persist: {
                    targetSheetKeys: keysToSave,
                    updateGroupKeys: fillAttemptKeys,
                    trackingSheetKeys: keysToTrack,
                    trackAsUpdate: true,
                    operations,
                    revisionWriteSet,
                    beforePersist: buildFlightModeHiddenRowsBeforePersist_ACU(baseSnapshot, options.isImportMode),
                },
            };
        });

        if (!commitResult.success || !commitResult.value) {
            _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(baseSnapshot || {})) as any);
            return {
                success: false,
                modifiedKeys: [],
                error: sanitizeRetryFeedback_ACU(commitResult.error || '统一提交失败。', MAX_WARN_ERROR_LENGTH_ACU),
                errorCategory: commitResult.errorCategory || 'infrastructure',
            };
        }
        if (!options.isImportMode && options.syncAfterCommit !== false && commitResult.tableData) {
            await updateReadableLorebookEntry_ACU(true, false, null, commitResult.tableData);
        }
        return { success: true, modifiedKeys: commitResult.value.modifiedKeys, tableData: commitResult.tableData as any };
    }

    const sqlInitialization = isSqliteMode()
        ? buildSqlInitializationBase_ACU(baseSnapshot, [...allTargetSheetKeySet])
        : { workingTableData: JSON.parse(JSON.stringify(baseSnapshot)), initializedSheetKeys: new Set<string>() };

    let workingTableData = sqlInitialization.workingTableData;
    const initializedSheetKeys = sqlInitialization.initializedSheetKeys;
    const modifiedKeySet = new Set<string>();
    const operations: TableMutationOperationV2_ACU[] = [];

    for (const response of sortedResponses) {
        let parseResult: any;
        if (isSqliteMode() && typeof response.tableEditText === 'string' && isSqlContent(response.tableEditText)) {
            parseResult = await applySqlEditsToTableDataSnapshot_ACU(
                response.tableEditText,
                workingTableData,
                options.updateMode,
                {
                    targetSheetKeys: response.job.targetSheetKeys,
                    requireSheetScopedOperations: true,
                    allowSingleTargetFallback: true,
                },
            );
            if (parseResult?.success && parseResult.workingData) {
                workingTableData = parseResult.workingData;
                if (Array.isArray(parseResult.operations)) operations.push(...parseResult.operations);
            }
        } else {
            parseResult = parseAndApplyTableEditsToData_ACU(response.aiResponse!, workingTableData, options.updateMode, options.isImportMode);
        }
        const parseResultObject = typeof parseResult === 'object' && parseResult !== null ? parseResult : null;
        const parseSuccess = parseResultObject ? parseResultObject.success : !!parseResult;
        const parsedKeys = parseResultObject ? (parseResultObject.modifiedKeys || []) : (response.job?.targetSheetKeys || []);
        const appliedEdits = parseResultObject && typeof parseResultObject.appliedEdits === 'number'
            ? parseResultObject.appliedEdits
            : (Array.isArray(parsedKeys) ? parsedKeys.length : 0);
        const parseError = parseResultObject && typeof parseResultObject.error === 'string'
            ? parseResultObject.error.trim()
            : '';
        if (!parseSuccess) {
            return {
                success: false,
                modifiedKeys: [],
                error: parseError
                    ? `统一提交失败：${formatResponseGroupReference_ACU(response)} 解析或应用失败。${sanitizeRetryFeedback_ACU(parseError)}`
                    : `统一提交失败：${formatResponseGroupReference_ACU(response)} 解析或应用失败。`,
                errorCategory: 'model',
            };
        }
        if (Array.isArray(response.job.targetSheetKeys) && response.job.targetSheetKeys.length > 0) {
            const allowedSheetKeys = new Set(response.job.targetSheetKeys);
            const unauthorizedKeys = parsedKeys.filter((sheetKey: string) => !allowedSheetKeys.has(sheetKey));
            if (unauthorizedKeys.length > 0) {
                return {
                    success: false,
                    modifiedKeys: [],
                    error: `统一提交失败：${formatResponseGroupReference_ACU(response)} 越权修改了非目标表 (${unauthorizedKeys.join(', ')})。允许写入表：${formatAllowedSheetKeys_ACU(response.job.targetSheetKeys)}。`,
                    errorCategory: 'model',
                };
            }
        }
        parsedKeys.forEach((sheetKey: string) => modifiedKeySet.add(sheetKey));
    }

    applySpecialIndexSequenceToSummaryTables_ACU(workingTableData);

    const modifiedKeys = [...modifiedKeySet].sort();
    if (!options.isImportMode) {
        const isFirstTimeInit = await checkIfFirstTimeInit_ACU();
        // 模板只起指导作用：快照只覆盖模板声明的表。
        // 模板范围外的表保持休眠，其数据留在更早的帧与保留边界 checkpoint 中，不被覆盖也不被删除。
        const snapshotScope = capturedTemplateScope;
        const scopedKeys = (keys: readonly string[]) => filterSheetKeysByTemplateScope_ACU(keys, snapshotScope);
        const allUnifiedSheetKeys = scopedKeys(getSortedSheetKeys_ACU(workingTableData));
        const initializedKeys = [...initializedSheetKeys].sort();
        const keysToSave = isFirstTimeInit
            ? allUnifiedSheetKeys
            : scopedKeys([...new Set([...modifiedKeys, ...initializedKeys])].sort());
        const keysToTrack = scopedKeys([...new Set([...modifiedKeys, ...initializedKeys])].sort());
        const fillAttemptKeys = [...allTargetSheetKeySet]
            .filter(sheetKey => Boolean((workingTableData as any)?.[sheetKey]))
            .filter(sheetKey => scopedKeys([sheetKey]).length > 0)
            .sort();
        // 目标楼层前没有 full checkpoint 锚点时，本次写入会被 persist 层当作初始
        // full checkpoint；pristine 场景只接受 afterData 快照。若已有可临时回放的
        // orphan artifacts，则必须保留本次 operations，由 persist 验证
        // temporary replay + operations === afterData 后升级为 integrity_repair checkpoint。
        // 同 SQLite 路径：只冻结 AI 上下文，不冻结存储锚点事实。
        // 否则首 bucket 建立 checkpoint 后，后续 bucket 仍会被误判为无锚点。
        const persistChat = getChatArray_ACU() || [];
        const persistIsolationKey = capturedIsolationKey;
        const hasCheckpointAnchor = hasAnyV2Checkpoint_ACU(
            persistChat,
            persistIsolationKey,
            options.saveTargetIndex,
        );
        const hasTemporaryReplayArtifacts = !hasCheckpointAnchor
            && hasUnanchoredReplayArtifactsForChatV2_ACU(persistChat, persistIsolationKey, { maxMessageIndex: options.saveTargetIndex });
        let effectiveOperations: TableMutationOperationV2_ACU[] = [];
        if (hasCheckpointAnchor || hasTemporaryReplayArtifacts) {
            // operations 必须与 keysToSave 用同一份模板范围：若为范围外的表写增量，
            // 而 checkpoint 又不含该表，回放时会建不出表并以 no such table 失败。
            const scopedOperations = operations.filter(operation => {
                const sheetKey = (operation as any)?.sheetKey;
                if (typeof sheetKey !== 'string' || !sheetKey.startsWith('sheet_')) return true;
                return scopedKeys([sheetKey]).length > 0;
            });
            effectiveOperations = [...scopedOperations, ...buildSheetReplaceOperationsFromData_ACU(workingTableData, keysToSave, 'system')];
        } else {
            // 本次写入将成为初始 full checkpoint，afterData 快照已包含全部结果；
            // 记录日志便于区分“按设计走 checkpoint”与“锚点判定异常导致数据未落增量”。
            logDebug_ACU(
                `[V2 Fill] 目标楼层 #${options.saveTargetIndex} 前无承载目标表的 full checkpoint，`
                + `本次以初始 checkpoint 形式提交快照（tracked=${keysToTrack.join(',') || '无'}）。`,
            );
        }
        const revisionWriteSet = modifiedKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
        if (options.commitMode === 'stage_only' && options.stagingSession) {
            const staged = await options.stagingSession.applyBucket({
                historicalBase: baseSnapshot,
                saveTargetIndex: options.saveTargetIndex,
                updateMode: options.updateMode,
                appliedTableData: workingTableData,
            });
            if (staged.ok === false) {
                return {
                    success: false,
                    modifiedKeys,
                    error: sanitizeRetryFeedback_ACU(staged.error, MAX_WARN_ERROR_LENGTH_ACU),
                    errorCategory: staged.errorCategory,
                };
            }
            return { success: true, modifiedKeys, tableData: staged.tableData as any };
        }
        const commitResult = await runTableUpdateCommit_ACU<{ modifiedKeys: string[] }>({
            source: 'group_fill',
            reason: 'applyUnifiedGroupFillResponses:snapshot',
            chatKey: capturedChatKey,
            isolationKey: capturedIsolationKey,
            writeSet: buildWriteSetForSheetKeys_ACU([...allTargetSheetKeySet], baseSnapshot),
            revisionWriteSet,
            baseRevision: options.baseRevision,
            performanceRunId: options.performanceRunId,
            performanceParentSpanId: options.performanceParentSpanId,
            workingDataMode: 'none',
            initialData: baseSnapshot as any,
            targetMessageIndex: options.saveTargetIndex,
            targetSheetKeys: keysToSave,
            updateGroupKeys: fillAttemptKeys,
            trackingSheetKeys: keysToTrack,
            trackAsUpdate: true,
            operations: effectiveOperations,
            replaceExistingIncremental: options.replaceExistingIncremental,
            manualRefillProgress: options.manualRefillProgress,
            manualCatchUpRunId: options.manualCatchUpRunId,
            commitMode: options.commitMode,
        }, () => ({
            success: true,
            value: { modifiedKeys },
            tableData: workingTableData as any,
            persist: {
                beforePersist: buildFlightModeHiddenRowsBeforePersist_ACU(baseSnapshot, options.isImportMode),
            },
        }));
        if (!commitResult.success) {
            return {
                success: false,
                modifiedKeys,
                error: sanitizeRetryFeedback_ACU(commitResult.error || '统一提交失败：保存聊天记录失败。', MAX_WARN_ERROR_LENGTH_ACU),
                errorCategory: commitResult.errorCategory || 'infrastructure',
            };
        }

        if (options.syncAfterCommit !== false) {
            const lorebookSpan = startRuntimePerformanceSpan_ACU('table-fill-worldbook-sync', {
                runId: options.performanceRunId,
                parentSpanId: options.performanceParentSpanId,
                settings: settings_ACU,
                metrics: { targetMessageIndex: options.saveTargetIndex },
            });
            try {
                await updateReadableLorebookEntry_ACU(true, false, null, workingTableData);
                lorebookSpan.end({ success: true });
            } catch (error) {
                lorebookSpan.end({ success: false });
                throw error;
            }
            if (getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true) {
                const vectorSpan = startRuntimePerformanceSpan_ACU('table-fill-vector-flush', {
                    runId: options.performanceRunId,
                    parentSpanId: options.performanceParentSpanId,
                    settings: settings_ACU,
                    metrics: { targetMessageIndex: options.saveTargetIndex },
                });
                try {
                    await enqueueSummaryVectorIndexFlush_ACU({ targetMessageIndex: options.saveTargetIndex, mode: 'sync', reason: 'unified_group_fill_complete' });
                    vectorSpan.end({ success: true });
                } catch (error) {
                    vectorSpan.end({ success: false });
                    throw error;
                }
            }
        }
    }

    return { success: true, modifiedKeys, tableData: workingTableData as any };
}

export function applyUnifiedGroupFillResponses_ACU(
    ...args: Parameters<typeof applyUnifiedGroupFillResponsesCore_ACU>
): ReturnType<typeof applyUnifiedGroupFillResponsesCore_ACU> {
    const responses = args[0];
    const options = args[2];
    const performanceSpan = startRuntimePerformanceSpan_ACU('table-fill-apply', {
        runId: options.performanceRunId,
        parentSpanId: options.performanceParentSpanId,
        settings: settings_ACU,
        metrics: {
            groupCount: Array.isArray(responses) ? responses.length : 0,
            targetMessageIndex: options.saveTargetIndex,
        },
    });
    return applyUnifiedGroupFillResponsesCore_ACU(args[0], args[1], {
        ...options,
        performanceParentSpanId: performanceSpan.id,
    }).then(result => {
        performanceSpan.end({ success: result.success, changedSheetCount: result.modifiedKeys.length });
        return result;
    }, error => {
        performanceSpan.end({ success: false });
        throw error;
    });
}

async function processGroupedRuntimeChunkCore_ACU(
    groups: GroupedRuntimeUpdateGroup_ACU[],
    mode: string,
    options: {
        isImportMode?: boolean;
        abortController?: AbortController;
        replaceExistingIncremental?: boolean;
        buildManualRefillProgress?: (bucket: {
            saveTargetIndex: number;
            messageIndices: number[];
            sheetKeys: string[];
            committedBucketCount: number;
        }) => ManualRefillProgressV2_ACU;
        onBucketCommitted?: (bucket: {
            saveTargetIndex: number;
            messageIndices: number[];
            sheetKeys: string[];
            committedBucketCount: number;
        }) => void;
        syncAfterCommit?: boolean;
        onProgress?: (event: CardUpdateProgressEvent) => void;
        respectGlobalStop?: boolean;
        /** 手动追平 run 专用标记：执行阶段再次发生 migration 视为 topology drift 并中止。 */
        manualCatchUpRun?: boolean;
        /** 手动追平 run 的 runId，用于 provisional bridge 写入准入（t5）。 */
        manualCatchUpRunId?: string;
        /** 手动重填专用豁免：清旧数据后从头重填，中间 bucket 目标早于
         *  清理前保留的旧 full checkpoint 是预期行为（commitManualRefillSheetSnapshotInRangeAtomic_ACU
         *  在全部 bucket 提交后才原子写新 checkpoint）。豁免仅限重填路径。 */
        skipWriteTargetAdmission?: boolean;
        /** 提交模式：stage_only 只更新 run 级 staging overlay，不写聊天 V2 frame。 */
        commitMode?: 'persist_v2' | 'stage_only';
        stagingSession?: TableFillStagingSession_ACU;
        performanceRunId?: string;
        performanceParentSpanId?: string;
    } = {}
): Promise<{ success: boolean; failedGroups: string[]; error?: string; aborted?: boolean; committedBucketCount: number; diagnosticCode?: ManualUpdateResult['diagnosticCode'] }> {
    if (!Array.isArray(groups) || groups.length === 0) {
        return { success: true, failedGroups: [], committedBucketCount: 0 };
    }
    const schedulingIdentitySnapshot = cloneTableDataSnapshot_ACU(currentJsonTableData_ACU);

    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU('processGroupedRuntimeChunk');
    if (!migration.success) {
        return {
            success: false,
            failedGroups: groups.map(group => group.key),
            error: sanitizeRetryFeedback_ACU(migration.error || '旧存储迁移失败，已阻止本次填表。', MAX_WARN_ERROR_LENGTH_ACU),
            committedBucketCount: 0,
        };
    }
    if (migration.migrated) {
        // 手动追平 run 已在规划前完成迁移；执行阶段再次发生迁移意味着 preflight 之后
        // 拓扑被外部改动（聊天切换、另一 run 抢先迁移等）。继续按旧 plan 写入会把
        // bucket 写到新锚点之前，等价于截图事故的重演，必须视为 topology drift 中止。
        if (mode === 'manual_independent' && options.manualCatchUpRun === true) {
            return {
                success: false,
                failedGroups: groups.map(group => group.key),
                error: sanitizeRetryFeedback_ACU(
                    '手动追平执行阶段检测到 legacy→V2 迁移改变锚点拓扑；已中止，请重新执行追平。',
                    MAX_WARN_ERROR_LENGTH_ACU,
                ),
                committedBucketCount: 0,
                diagnosticCode: 'catch_up_migration_changed_topology',
            };
        }
        await reloadStorageProvider();
    }

    const executionScope = await captureFillExecutionScope_ACU({
        runId: options.performanceRunId,
        parentSpanId: options.performanceParentSpanId,
    });
    const templateForLookup = executionScope.sqlApplyScope?.templateData || parseTableTemplateJson_ACU({ stripSeedRows: true });
    const failedGroups = new Set<string>();
    let firstError: string | undefined;
    // 模板只起指导作用：只有模板声明的表参与填表。
    // 范围未知时不过滤，避免把所有表判成不参与导致数据写不进去。
    const templateScope = executionScope.templateScope;
    let scopedGroups: GroupedRuntimeUpdateGroup_ACU[];
    try {
        scopedGroups = groups
            .map(group => {
                const reboundSheetKeys = templateForLookup
                    ? rebindSheetKeysThroughTableAliases_ACU(group.sheetKeys || [], schedulingIdentitySnapshot, templateForLookup)
                    : [...(group.sheetKeys || [])];
                const scopedSheetKeys = filterSheetKeysByTemplateScope_ACU(reboundSheetKeys, templateScope);
                if (scopedSheetKeys.length === reboundSheetKeys.length) return { ...group, sheetKeys: scopedSheetKeys };
                const dropped = reboundSheetKeys.filter(sheetKey => !scopedSheetKeys.includes(sheetKey));
                logDebug_ACU(`[TemplateScope] ${formatGroupReference_ACU(group)} 剔除模板未声明的表：${dropped.join('、')}。`);
                return { ...group, sheetKeys: scopedSheetKeys };
            })
            .filter(group => (group.sheetKeys || []).length > 0);
    } catch (error) {
        const message = error instanceof SheetTableAliasResolutionError_ACU ? error.message : String(error);
        return {
            success: false,
            failedGroups: groups.map(group => group.key),
            error: sanitizeRetryFeedback_ACU(message, MAX_WARN_ERROR_LENGTH_ACU),
            committedBucketCount: 0,
        };
    }
    if (scopedGroups.length === 0) {
        logDebug_ACU('[TemplateScope] 所有分组的目标表都不在模板范围内，本次无需填表。');
        return { success: true, failedGroups: [], committedBucketCount: 0 };
    }

    const transactionBuckets = new Map<string, {
        saveTargetIndex: number;
        batchNumber: number;
        updateMode: string;
        plannedJobs: PlannedGroupedRuntimeJob_ACU[];
    }>();

    for (const group of scopedGroups) {
        const batchSize = Math.max(1, Number(group.batchSize) || Number(settings_ACU.updateBatchSize) || 2);
        const groupBatches: number[][] = [];
        for (let i = 0; i < group.indices.length; i += batchSize) {
            groupBatches.push(group.indices.slice(i, i + batchSize));
        }

        for (let i = 0; i < groupBatches.length; i++) {
            const batchIndices = groupBatches[i];
            const batchNumber = i + 1;
            const firstMessageIndexOfBatch = batchIndices[0];
            const lastMessageIndexOfBatch = batchIndices[batchIndices.length - 1];
            const finalSaveTargetIndex = lastMessageIndexOfBatch;

            const updateMode = resolveUpdateMode_ACU(mode);
            const bucketKey = `${finalSaveTargetIndex}|${batchNumber}|${updateMode}|${options.isImportMode === true ? 1 : 0}`;
            const plannedJob: PlannedGroupedRuntimeJob_ACU = {
                group,
                batchNumber,
                firstMessageIndexOfBatch,
                lastMessageIndexOfBatch,
                messageIndices: [...batchIndices],
                saveTargetIndex: finalSaveTargetIndex,
                updateMode,
            };
            const existingBucket = transactionBuckets.get(bucketKey);
            if (existingBucket) {
                existingBucket.plannedJobs.push(plannedJob);
            } else {
                transactionBuckets.set(bucketKey, {
                    saveTargetIndex: finalSaveTargetIndex,
                    batchNumber,
                    updateMode,
                    plannedJobs: [plannedJob],
                });
            }
        }
    }

    const orderedBuckets = [...transactionBuckets.values()].sort((a, b) => a.saveTargetIndex - b.saveTargetIndex || a.batchNumber - b.batchNumber);
    const emitBucketProgress = (bucketIndex: number, event: CardUpdateProgressEvent): void => {
        options.onProgress?.({
            ...event,
            currentBatch: bucketIndex + 1,
            totalBatches: orderedBuckets.length,
        });
    };
    const isStopped = () => options.abortController?.signal.aborted === true || (options.respectGlobalStop !== false && wasStoppedByUser_ACU);
    let committedBucketCount = 0;
    let aborted = false;
    for (let bucketIndex = 0; bucketIndex < orderedBuckets.length; bucketIndex++) {
        if (isStopped()) {
            aborted = true;
            break;
        }
        const bucket = orderedBuckets[bucketIndex];
        const maxBucketRetries = Math.max(1, Number(settings_ACU.tableMaxRetries) || 3);
        let retryUnifiedError: string | null = null;
        let bucketSucceeded = false;
        // 阶段 G1：bucket 重试循环外持有 request-scoped replay evidence。
        // 同 bucket 的各次 attempt 共享同一 boundary（mergeBaseMaxMessageIndex），
        // 因此重试可复用首次冷 replay 结果；bucket 提交写入新 chat entry 后
        // headRevision digest 变化，evidence 自然失效（fail-open 回退冷 replay）。
        // 传空对象而非 null：replay 只在冷回放成功后原地写回 evidence，传 null 会被
        // loadV2ReplayMergeBase_ACU 的条件展开丢掉，重试将永远冷回放（接线失效）。
        // 不允许重试（maxBucketRetries === 1）时必须传 null：此时循环体最多执行一次，
        // evidence 绝无被读机会，而 replay 仍会为写回多付一次全表 deepClone —— 纯亏。
        const replayEvidence: import('./v2-replay-session').V2ReplayEvidence_ACU | null =
            maxBucketRetries > 1 ? ({} as import('./v2-replay-session').V2ReplayEvidence_ACU) : null;

        for (let bucketAttempt = 1; bucketAttempt <= maxBucketRetries; bucketAttempt++) {
            if (isStopped()) {
                aborted = true;
                break;
            }
            const chatHistory = executionScope.promptMessages;
            const bucketFirstMessageIndex = Math.min(...bucket.plannedJobs.map(job => job.firstMessageIndexOfBatch));
            const explicitMergeBaseBounds = [...new Set(
                bucket.plannedJobs
                    .map(job => job.group.mergeBaseMaxMessageIndex)
                    .filter((value): value is number => Number.isInteger(value)),
            )];
            if (explicitMergeBaseBounds.length > 1) {
                bucket.plannedJobs.forEach(job => failedGroups.add(job.group.key));
                firstError = firstError || '同一提交批次包含不一致的表格基底边界，已中止以避免重填数据污染。';
                break;
            }
            // 基底边界必须随 bucket 推进：显式边界只作为下界，保证本 bucket 之前刚提交的
            // 增量进入 prompt 基底，同时不把本 bucket 之后尚未处理的楼层带进来。
            const mergeBaseMaxMessageIndex = Math.max(
                explicitMergeBaseBounds.length === 1 ? explicitMergeBaseBounds[0] : Number.NEGATIVE_INFINITY,
                bucketFirstMessageIndex - 1,
            );
            const baseResult: { data: Record<string, any> | null; error: string | null } =
                await buildBatchMergeBase_ACU(bucket.batchNumber, { maxMessageIndex: mergeBaseMaxMessageIndex }, replayEvidence);
            if (!baseResult.data) {
                bucket.plannedJobs.forEach(job => failedGroups.add(job.group.key));
                firstError = firstError || baseResult.error || '无法构建合并基底，操作已终止。';
                break;
            }

            const mergedBatchData = options.stagingSession
                ? assembleBucketWorkingView_ACU(baseResult.data, options.stagingSession.getTargetOverlay())
                : baseResult.data;
            try {
                bucket.plannedJobs = bucket.plannedJobs.map(plannedJob => ({
                    ...plannedJob,
                    group: {
                        ...plannedJob.group,
                        sheetKeys: rebindSheetKeysThroughTableAliases_ACU(
                            plannedJob.group.sheetKeys || [],
                            templateForLookup || schedulingIdentitySnapshot,
                            mergedBatchData,
                        ),
                    },
                }));
            } catch (error) {
                bucket.plannedJobs.forEach(job => failedGroups.add(job.group.key));
                firstError = firstError || (error instanceof Error ? error.message : String(error));
                break;
            }
            if (!options.stagingSession) {
                _set_currentJsonTableData_ACU(mergedBatchData);
            }
            const baseSnapshot = JSON.parse(JSON.stringify(mergedBatchData));
            const bucketSheetKeys = [...new Set(bucket.plannedJobs.flatMap(job => job.group.sheetKeys || []))].sort();
            const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(
                buildWriteSetForSheetKeys_ACU(bucketSheetKeys, baseSnapshot),
                { chatKey: executionScope.chatKey, isolationKey: executionScope.isolationKey },
            );

            const jobs: GroupFillJob_ACU[] = [];
            for (const plannedJob of bucket.plannedJobs) {
                const isAutoUpdateMode = mode && mode.startsWith('auto');
                const lastAiMessageInBatch = chatHistory[plannedJob.lastMessageIndexOfBatch];
                const lastAiMessageContent = lastAiMessageInBatch?.mes || lastAiMessageInBatch?.message || '';
                const lastAiMessageLength = lastAiMessageContent.length;
                const minReplyLength = settings_ACU.autoUpdateTokenThreshold || 0;
                if (isAutoUpdateMode && lastAiMessageLength < minReplyLength) {
                    continue;
                }

                let sliceStartIndex = plannedJob.firstMessageIndexOfBatch;
                if (sliceStartIndex > 0 && chatHistory[sliceStartIndex - 1]?.is_user) {
                    sliceStartIndex--;
                }
                const messagesForContext = chatHistory.slice(sliceStartIndex, plannedJob.lastMessageIndexOfBatch + 1);
                let effectiveRequestOptions = plannedJob.group.requestOptions || null;
                if (!effectiveRequestOptions?.tableApiPreset && Array.isArray(plannedJob.group.sheetKeys) && plannedJob.group.sheetKeys.length > 0) {
                    const firstTableName = templateForLookup?.[plannedJob.group.sheetKeys[0]]?.name || '';
                    const resolvedPreset = resolveTableApiPresetOverride_ACU(firstTableName);
                    if (resolvedPreset) {
                        effectiveRequestOptions = { ...(effectiveRequestOptions || {}), tableApiPreset: resolvedPreset };
                    }
                }

                jobs.push({
                    groupKey: plannedJob.group.key,
                    groupId: plannedJob.group.groupId,
                    batchNumber: plannedJob.batchNumber,
                    targetSheetKeys: plannedJob.group.sheetKeys,
                    messagesForContext,
                    saveTargetIndex: plannedJob.saveTargetIndex,
                    updateMode: plannedJob.updateMode,
                    requestOptions: effectiveRequestOptions,
                    baseSnapshot,
                    baseRevision,
                    isImportMode: options.isImportMode === true,
                    chatKey: executionScope.chatKey,
                    isolationKey: executionScope.isolationKey,
                    templateScope: executionScope.templateScope,
                    sqlApplyScope: executionScope.sqlApplyScope,
                    performanceRunId: options.performanceRunId,
                    performanceParentSpanId: options.performanceParentSpanId,
                });
            }

            // 回放根准入（Task 4）：任何写目标早于最新 full checkpoint 的 bucket 必须在
            // AI 调用（collectGroupFillResponse_ACU → callCustomOpenAI_ACU）之前被阻止。
            // 否则 AI 先消耗 token，写入阶段才被 persist 层 fail-fast（persist.ts:1908）。
            // provisional bridge run（manual catch-up 追平）跳过此处：其写入安全由
            // orchestrateManualCatchUp_ACU 的 ensureManualCatchUpAnchorBeforeTarget_ACU 预检
            // 与 persist 层 bridge 写入授权（persist.ts:2293-2295）双层保证，且此处依赖的
            // readActiveProvisionalBridge_ACU 在编排层无法可靠读取（bridge 状态在 persist 事务内）。
            // 手动重填（clearBeforeUpdate）也跳过此处：重填先清旧增量，中间 bucket 目标
            // 早于清理后保留的旧 full checkpoint 是预期（末尾 commitManualRefillSheetSnapshotInRangeAtomic_ACU
            // 才原子写新 checkpoint）；清理前 refillAdmission 已对范围末尾做准入。
            // stage_only 边界前段同样跳过：staging 不写聊天 V2 frame，不参与 replay 根准入，
            // 准入检查只针对真正持久化到聊天的目标。
            if (!options.manualCatchUpRunId && !options.skipWriteTargetAdmission && options.commitMode !== 'stage_only') {
                for (const job of jobs) {
                    const writeTargetAdmission = assertWriteTargetNotBeforeReplayRoot_ACU({
                        chat: getChatArray_ACU() || [],
                        isolationKey: job.isolationKey,
                        targetMessageIndex: job.saveTargetIndex,
                    });
                    if (!writeTargetAdmission.allow) {
                        failedGroups.add(job.groupKey);
                        firstError = firstError || `写目标早于 V2 回放根，已阻止本次填表：${writeTargetAdmission.reason}`;
                        logDebug_ACU(`[V2 准入] 阻止填表：${writeTargetAdmission.reason}`);
                    }
                }
            }
            if (firstError) {
                break;
            }


            if (jobs.length === 0) {
                bucketSucceeded = true;
                break;
            }

            // 请求级世界书读取上下文：一个 bucket attempt 一个 context，
            // 同 bucket sibling jobs 与格式重试共享物理读取；bucket 完成后 dispose，
            // 下一 bucket 新建以便看到前一 bucket 提交后同步到世界书的新内容。
            const bucketReadContext = createLorebookReadContext_ACU({
                source: 'form_fill_bucket',
                isActive: () => !isStopped(),
                isAborted: () => isStopped(),
            });
            const disposeBucketReadContext = () => {
                try { bucketReadContext.dispose(); } catch { /* dispose 幂等 */ }
            };
            try {
            const collectFeedback = retryUnifiedError ? { lastUnifiedError: retryUnifiedError } : undefined;
            const settledResponses = await Promise.allSettled(jobs.map(job => collectGroupFillResponse_ACU(
                    job,
                    collectFeedback,
                    options.abortController,
                    {
                        onProgress: event => emitBucketProgress(bucketIndex, event),
                        respectGlobalStop: options.respectGlobalStop,
                        worldbookReadContext: bucketReadContext,
                    },
                )));
            let responses: GroupFillResponse_ACU[] = [];
            let collectFailed = false;
            let collectError: string | undefined;

            for (let i = 0; i < settledResponses.length; i++) {
                const settledResponse = settledResponses[i];
                if (settledResponse.status === 'rejected') {
                    collectFailed = true;
                    collectError = collectError || (settledResponse.reason instanceof Error ? settledResponse.reason.message : String(settledResponse.reason || 'AI响应收集失败'));
                    continue;
                }
                if (!settledResponse.value.success || settledResponse.value.aborted || !settledResponse.value.aiResponse) {
                    collectFailed = true;
                    collectError = collectError || settledResponse.value.error || settledResponse.value.rawError || 'AI响应收集失败';
                    continue;
                }
                responses.push(settledResponse.value);
            }

            if (collectFailed) {
                jobs.forEach(job => failedGroups.add(job.groupKey));
                firstError = firstError || collectError || 'AI响应收集失败';
                break;
            }

            if (isSqliteMode()) {
                const responseByGroupKey = new Map<string, GroupFillResponse_ACU>();
                responses.forEach(response => responseByGroupKey.set(response.job.groupKey, response));
                let nonSqlResponses = getMixedSqliteNonSqlResponses_ACU(responses);
                let formatError = nonSqlResponses.length > 0 ? buildMixedSqliteFormatError_ACU(nonSqlResponses) : '';
                for (let formatAttempt = 1; nonSqlResponses.length > 0 && formatAttempt < maxBucketRetries; formatAttempt += 1) {
                    emitBucketProgress(bucketIndex, {
                        phase: 'retry',
                        attempt: formatAttempt,
                        maxRetries: maxBucketRetries,
                        message: formatError.substring(0, 50),
                    });
                    const retryJobs = nonSqlResponses.map(response => response.job);
                    const retrySettled = await Promise.allSettled(retryJobs.map(job => collectGroupFillResponse_ACU(
                        job,
                        { lastUnifiedError: formatError },
                        options.abortController,
                        {
                            onProgress: event => emitBucketProgress(bucketIndex, event),
                            respectGlobalStop: options.respectGlobalStop,
                            worldbookReadContext: bucketReadContext,
                        },
                    )));
                    for (let i = 0; i < retrySettled.length; i++) {
                        const settledResponse = retrySettled[i];
                        if (settledResponse.status === 'fulfilled' && settledResponse.value.success && !settledResponse.value.aborted && settledResponse.value.aiResponse) {
                            responseByGroupKey.set(settledResponse.value.job.groupKey, settledResponse.value);
                        }
                    }
                    responses = jobs
                        .map(job => responseByGroupKey.get(job.groupKey))
                        .filter((response): response is GroupFillResponse_ACU => Boolean(response));
                    nonSqlResponses = getMixedSqliteNonSqlResponses_ACU(responses);
                    formatError = nonSqlResponses.length > 0 ? buildMixedSqliteFormatError_ACU(nonSqlResponses) : '';
                }
                if (nonSqlResponses.length > 0) {
                    nonSqlResponses.forEach(response => failedGroups.add(response.job.groupKey));
                    firstError = firstError || formatError;
                    break;
                }
            }

            if (isStopped()) {
                aborted = true;
                break;
            }
            emitBucketProgress(bucketIndex, { phase: 'saving' });
            const replacementMessageIndices = [...new Set(bucket.plannedJobs.flatMap(job => job.messageIndices))].sort((left, right) => left - right);
            const replacementSheetKeys = [...new Set(bucket.plannedJobs.flatMap(job => job.group.sheetKeys || []))].sort();
            const applyResult = await applyUnifiedGroupFillResponses_ACU(responses, baseSnapshot, {
                saveTargetIndex: bucket.saveTargetIndex,
                updateMode: bucket.updateMode,
                isImportMode: options.isImportMode === true,
                ...(options.replaceExistingIncremental === true ? {
                    replaceExistingIncremental: {
                        targetMessageIndices: replacementMessageIndices,
                        targetSheetKeys: replacementSheetKeys,
                    },
                } : {}),
                ...(options.buildManualRefillProgress ? {
                    manualRefillProgress: options.buildManualRefillProgress({
                        saveTargetIndex: bucket.saveTargetIndex,
                        messageIndices: replacementMessageIndices,
                        sheetKeys: replacementSheetKeys,
                        committedBucketCount,
                    }),
                } : {}),
                syncAfterCommit: options.syncAfterCommit,
                baseRevision,
                chatKey: executionScope.chatKey,
                isolationKey: executionScope.isolationKey,
                templateScope: executionScope.templateScope,
                sqlApplyScope: executionScope.sqlApplyScope,
                manualCatchUpRunId: options.manualCatchUpRunId,
                commitMode: options.commitMode,
                stagingSession: options.stagingSession,
                performanceRunId: options.performanceRunId,
                performanceParentSpanId: options.performanceParentSpanId,
            });
            if (applyResult.success) {
                const nextCommittedBucketCount = committedBucketCount + 1;
                options.onBucketCommitted?.({
                    saveTargetIndex: bucket.saveTargetIndex,
                    messageIndices: replacementMessageIndices,
                    sheetKeys: replacementSheetKeys,
                    committedBucketCount: nextCommittedBucketCount,
                });
                emitBucketProgress(bucketIndex, { phase: 'complete' });
                bucketSucceeded = true;
                committedBucketCount = nextCommittedBucketCount;
                break;
            }

            const safeApplyError = sanitizeRetryFeedback_ACU(applyResult.error || '统一提交失败。', MAX_WARN_ERROR_LENGTH_ACU);
            if (applyResult.errorCategory !== 'model') {
                jobs.forEach(job => failedGroups.add(job.groupKey));
                firstError = firstError || safeApplyError;
                break;
            }
            retryUnifiedError = safeApplyError;
            if (bucketAttempt >= maxBucketRetries) {
                jobs.forEach(job => failedGroups.add(job.groupKey));
                firstError = firstError || `统一提交在 ${maxBucketRetries} 次尝试后仍失败: ${retryUnifiedError}`;
            } else {
                emitBucketProgress(bucketIndex, {
                    phase: 'retry',
                    attempt: bucketAttempt,
                    maxRetries: maxBucketRetries,
                    message: sanitizeRetryFeedback_ACU(retryUnifiedError, 50),
                });
            }
            } finally {
                disposeBucketReadContext();
            }
        }

        if (aborted || (!bucketSucceeded && isStopped())) {
            aborted = true;
            break;
        }
        if (!bucketSucceeded) {
            // 连续前沿模型不允许跨过失败 bucket 继续提交，否则会制造无法自动追平的内部空洞。
            break;
        }
    }

    if (aborted) {
        return { success: false, failedGroups: [...failedGroups], error: '手动更新已终止。', aborted: true, committedBucketCount };
    }
    return failedGroups.size > 0
        ? { success: false, failedGroups: [...failedGroups], error: firstError || '统一提交失败。', committedBucketCount }
        : { success: true, failedGroups: [], committedBucketCount };
}

export function processGroupedRuntimeChunk_ACU(
    ...args: Parameters<typeof processGroupedRuntimeChunkCore_ACU>
): ReturnType<typeof processGroupedRuntimeChunkCore_ACU> {
    const groups = args[0];
    const options = args[2] || {};
    const performanceSpan = startRuntimePerformanceSpan_ACU('grouped-runtime-chunk', {
        runId: options.performanceRunId,
        parentSpanId: options.performanceParentSpanId,
        settings: settings_ACU,
        metrics: {
            groupCount: Array.isArray(groups) ? groups.length : 0,
            sheetCount: Array.isArray(groups) ? new Set(groups.flatMap(group => group.sheetKeys || [])).size : 0,
            sqlite: isSqliteMode(),
        },
    });
    return processGroupedRuntimeChunkCore_ACU(groups, args[1], {
        ...options,
        performanceParentSpanId: performanceSpan.id,
    }).then(result => {
        performanceSpan.end({ success: result.success, failedGroupCount: result.failedGroups.length, bucketCount: result.committedBucketCount });
        return result;
    }, error => {
        performanceSpan.end({ success: false });
        throw error;
    });
}
/**
 * 自动填表跨 full checkpoint staging 编排器（计划 5.6 执行层）。
 *
 * 由 presentation 层绑定为 AutoUpdateOperations.processStagingGroupedUpdates：
 *  - 无 full checkpoint 或组内无 pre-boundary 索引 → 直接普通分组执行（退化安全）；
 *  - 有 pre-boundary 段 → 先以 commitMode='stage_only' 执行 pre 段（run 级隔离 staging，
 *    不写聊天 V2 frame），到达原 full 边界时用 commitStagedSheetsAtFullBoundaryAtomic_ACU
 *    把累计目标表快照原子折叠为原根的 sheet_rebase，边界后段恢复普通持久化；
 *  - 失败/停止时只丢弃内存 staging（零持久化改写），符合自动填表失败语义矩阵。
 */
export async function executeAutoFillStagingGroups_ACU(
    groups: GroupedRuntimeUpdateGroup_ACU[],
    mode: string,
    options: {
        abortController?: AbortController;
        onProgress?: (event: CardUpdateProgressEvent) => void;
        respectGlobalStop?: boolean;
        performanceRunId?: string;
        performanceParentSpanId?: string;
        /** 调度层预计算的边界元数据（AutoUpdatePlan.boundary 透传）。 */
        boundary?: {
            fullCheckpointIndices: number[];
            requiresBoundaryStaging: boolean;
        };
    } = {},
): Promise<{ success: boolean; failedGroups: string[]; error?: string; aborted?: boolean; committedBucketCount: number }> {
    const boundary = options.boundary;
    const originalFullIndex = boundary?.fullCheckpointIndices?.length === 1 ? boundary.fullCheckpointIndices[0] : null;
    const normalizedGroups = Array.isArray(groups) ? groups : [];

    // 无 full 根或未标记 staging：直接普通执行，不引入任何 staging 语义。
    if (originalFullIndex === null || normalizedGroups.length === 0) {
        return processGroupedRuntimeChunk_ACU(normalizedGroups, mode, {
            abortController: options.abortController,
            onProgress: options.onProgress,
            respectGlobalStop: options.respectGlobalStop,
            performanceRunId: options.performanceRunId,
            performanceParentSpanId: options.performanceParentSpanId,
        });
    }

    const failedGroups = new Set<string>();
    let firstError: string | undefined;
    let committedBucketCount = 0;
    let boundaryCommitted = false;
    let stagingRun: TableFillStagingRunContext_ACU | null = null;
    let stagingSession: TableFillStagingSession_ACU | null = null;
    let boundaryPlan: TableFillBoundaryStagingPlan_ACU | null = null;

    // 冻结 run 级 staging scope（与手动追平同款：单 full 根复检、范围、目标表、模板指纹）。
    const isolationKey = getCurrentIsolationKey_ACU();
    const chatKey = currentChatFileIdentifier_ACU;
    const allPendingIndices = [...new Set(normalizedGroups.flatMap(group => group.indices || []))].sort((a, b) => a - b);
    const targetSheetKeys = [...new Set(normalizedGroups.flatMap(group => group.sheetKeys || []))].sort();
    const templateFingerprint = getTableDataFingerprint_ACU(parseTableTemplateJson_ACU({ stripSeedRows: true }) || {});
    try {
        boundaryPlan = planTableFillBoundaryStaging_ACU({
            runKind: 'auto_fill',
            runId: options.performanceRunId || `auto-fill-${Date.now()}`,  // 仅作作用域身份，不写任何持久化
            chatKey,
            isolationKey,
            targetSheetKeys,
            templateFingerprint,
            messageIndices: allPendingIndices,
            fullCheckpointIndices: boundary?.fullCheckpointIndices || [],
        });
    } catch (error: any) {
        return {
            success: false,
            failedGroups: normalizedGroups.map(group => group.key),
            error: `跨 full checkpoint 自动填表规划失败：${error?.message || String(error)}`,
            committedBucketCount: 0,
        };
    }
    if (!boundaryPlan.requiresStaging) {
        // 规划后发现实际无需 staging（如 full 索引被过滤）：普通执行。
        return processGroupedRuntimeChunk_ACU(normalizedGroups, mode, {
            abortController: options.abortController,
            onProgress: options.onProgress,
            respectGlobalStop: options.respectGlobalStop,
            performanceRunId: options.performanceRunId,
            performanceParentSpanId: options.performanceParentSpanId,
        });
    }
    stagingRun = createTableFillStagingRunContext_ACU({
        runId: boundaryPlan.scope.runId,
        chatKey: boundaryPlan.scope.chatKey,
        isolationKey: boundaryPlan.scope.isolationKey,
        targetSheetKeys: boundaryPlan.scope.targetSheetKeys,
        originalFullIndex: boundaryPlan.scope.originalFullIndex,
        originalFullFingerprint: readOriginalFullFrameFingerprint_ACU(
            getChatArray_ACU(),
            boundaryPlan.scope.isolationKey,
            originalFullIndex,
        ),
        templateFingerprint,
    });
    stagingSession = createTableFillStagingSession_ACU(stagingRun);

    const settleStagingBoundary = async (): Promise<{ ok: true } | { ok: false; error: string; diagnosticCode?: string }> => {
        if (!boundaryPlan || boundaryCommitted) return { ok: true };
        if (!stagingRun || stagingRun.overlay.stagedBucketCount === 0) {
            boundaryCommitted = true;
            await stagingSession?.discard();
            return { ok: true };
        }
        const fullIndex = boundaryPlan.scope.originalFullIndex;
        if (fullIndex === null) {
            boundaryCommitted = true;
            await stagingSession?.discard();
            return { ok: true };
        }
        const settleResult = await settleStagedBoundaryAndPublish_ACU(stagingRun, fullIndex, stagingSession);
        if (!settleResult.ok) return settleResult;
        boundaryCommitted = true;
        stagingSession = null;
        return { ok: true };
    };

    for (const group of normalizedGroups) {
        if (options.abortController?.signal.aborted) {
            return { success: false, failedGroups: [...failedGroups, ...normalizedGroups.map(g => g.key)], error: '自动填表已终止。', aborted: true, committedBucketCount };
        }
        const groupIndices = [...(group.indices || [])].sort((a, b) => a - b);
        const segments = splitMessageIndicesAtBoundary_ACU(groupIndices, originalFullIndex);
        const preSegments = segments.filter(segment => segment.indices.length > 0 && segment.indices[0] < originalFullIndex);
        const postSegments = segments.filter(segment => segment.indices.length > 0 && segment.indices[0] >= originalFullIndex);

        for (const preSegment of preSegments) {
            if (options.abortController?.signal.aborted) {
                return { success: false, failedGroups: [...failedGroups, ...normalizedGroups.map(g => g.key)], error: '自动填表已终止。', aborted: true, committedBucketCount };
            }
            const preGroups: GroupedRuntimeUpdateGroup_ACU[] = [{
                ...group,
                indices: [...preSegment.indices],
                mergeBaseMaxMessageIndex: preSegment.mergeBaseMaxMessageIndex,
            }];
            const preResult = await processGroupedRuntimeChunk_ACU(preGroups, mode, {
                abortController: options.abortController,
                respectGlobalStop: options.respectGlobalStop,
                commitMode: 'stage_only',
                stagingSession: stagingSession || undefined,
                replaceExistingIncremental: true,
                syncAfterCommit: false,
                onProgress: options.onProgress,
                performanceRunId: options.performanceRunId,
                performanceParentSpanId: options.performanceParentSpanId,
            });
            committedBucketCount += preResult.committedBucketCount;
            if (!preResult.success) {
                failedGroups.add(group.key);
                firstError = firstError || preResult.error || '边界前 staging 提交失败。';
                break;
            }
        }

        // 首个 post 段提交前收敛 staging：边界前累计快照原子折叠回原根；零 staging 则丢弃。
        if (postSegments.length > 0) {
            if (options.abortController?.signal.aborted) {
                return { success: false, failedGroups: [...failedGroups, ...normalizedGroups.map(g => g.key)], error: '自动填表已终止。', aborted: true, committedBucketCount };
            }
            const settleResult = await settleStagingBoundary();
            if (!settleResult.ok) {
                failedGroups.add(group.key);
                firstError = firstError || `跨根 staging 汇合失败：${(settleResult as { ok: false; error: string }).error}`;
                break;
            }
        }

        for (const postSegment of postSegments) {
            if (options.abortController?.signal.aborted) {
                return { success: false, failedGroups: [...failedGroups, ...normalizedGroups.map(g => g.key)], error: '自动填表已终止。', aborted: true, committedBucketCount };
            }
            const postGroups: GroupedRuntimeUpdateGroup_ACU[] = [{
                ...group,
                indices: [...postSegment.indices],
                mergeBaseMaxMessageIndex: postSegment.mergeBaseMaxMessageIndex,
            }];
            const postResult = await processGroupedRuntimeChunk_ACU(postGroups, mode, {
                abortController: options.abortController,
                respectGlobalStop: options.respectGlobalStop,
                replaceExistingIncremental: true,
                syncAfterCommit: false,
                onProgress: options.onProgress,
                performanceRunId: options.performanceRunId,
                performanceParentSpanId: options.performanceParentSpanId,
            });
            committedBucketCount += postResult.committedBucketCount;
            if (!postResult.success) {
                failedGroups.add(group.key);
                firstError = firstError || postResult.error || '边界后持久化提交失败。';
                break;
            }
        }
    }

    // 所有组都只有 pre-boundary 段（未触发循环内汇合）：正常收尾时仍须把 staging 汇合回原根。
    if (!boundaryCommitted && stagingRun && stagingRun.overlay.stagedBucketCount > 0) {
        const settleResult = await settleStagingBoundary();
        if (!settleResult.ok) {
            normalizedGroups.forEach(g => failedGroups.add(g.key));
            firstError = firstError || `跨根 staging 收尾汇合失败：${(settleResult as { ok: false; error: string }).error}`;
        }
    }
    await stagingSession?.discard();

    return failedGroups.size > 0
        ? { success: false, failedGroups: [...failedGroups], error: firstError || '跨根 staging 执行失败。', committedBucketCount }
        : { success: true, failedGroups: [], committedBucketCount };
}


/**
 * 执行单次卡片更新的核心逻辑（AI调用 + 重试 + 解析 + 保存）
 * 纯业务逻辑，不驱动 UI。通过可选的 onProgress 回调传递纯数据进度事件。
 * presentation 层根据返回值和进度事件自行决定 UI 操作。
 */
export async function executeCardUpdateCore_ACU(
    messagesToUse: any[],
    saveTargetIndex: number,
    isImportMode: boolean,
    updateMode: string,
    isSilentMode: boolean,
    targetSheetKeys: string[] | null,
    requestOptions: Record<string, any> | null,
    abortController: AbortController | null = new AbortController(),
    progressContext: BatchUpdateProgressContext | null = null,
    onProgress?: (event: CardUpdateProgressEvent) => void,
    admissionContext?: {
        /** 跳过写目标回放根准入（import/内部合法路径显式声明，不得由普通自动入口使用）。 */
        skipWriteTargetAdmission?: boolean;
    },
): Promise<CardUpdateResult> {
    // 向后兼容：历史调用可能把 onProgress 作为第9参传入
    if (typeof progressContext === 'function' && !onProgress) {
        onProgress = progressContext as unknown as (event: CardUpdateProgressEvent) => void;
        progressContext = null;
    }
    // 兜底保护：若误传了非对象 progressContext，避免读取属性报错
    if (progressContext && typeof progressContext !== 'object') {
        progressContext = null;
    }
    const effectiveAbortController = abortController || new AbortController();

    const emitProgress = (event: CardUpdateProgressEvent): void => {
        onProgress?.({
            ...event,
            ...(progressContext
                ? {
                    currentBatch: progressContext.currentBatch,
                    totalBatches: progressContext.totalBatches,
                }
                : {}),
        });
    };
    let success = false;
    let modifiedKeys: string[] = [];
    const maxRetries = settings_ACU.tableMaxRetries || 3;
    const executionScope = await captureFillExecutionScope_ACU();
    const writeTargetAdmission = assertWriteTargetNotBeforeReplayRoot_ACU({
        chat: getChatArray_ACU() || [],
        isolationKey: executionScope.isolationKey,
        targetMessageIndex: saveTargetIndex,
    });

    try {
        // V2 replay-root 准入（spv8.9）：任何写目标早于最新 full checkpoint 的
        // 自动/legacy 填表必须在 AI 调用（collectGroupFillResponse_ACU →
        // prepareAIInput/callCustomOpenAI）之前被结构化阻断，否则 AI 先消耗 token，
        // 写入阶段才被 persist 层 fail-fast。import 模式只生成候选不写聊天 frame，
        // 不受写目标回放根约束；provisional bridge（manual catch-up）例外由
        // manualCatchUpRunId 匹配 active bridge 放行。
        if (writeTargetAdmission.allow === false) {
            // 仅普通自动/legacy 路径受写目标回放根约束；import 只生成候选不写聊天 frame，
            // skipWriteTargetAdmission 由内部合法路径显式声明（不得被普通自动入口使用）。
            if (!isImportMode && !admissionContext?.skipWriteTargetAdmission) {
            // allow===false 分支必然携带 reason/targetMessageIndex/latestFullCheckpointIndex；
            // 联合类型收窄因 reason?: never 失效，此处显式取窄成员。
            const admissionFailure = writeTargetAdmission as { allow: false; reason: string; targetMessageIndex: number; latestFullCheckpointIndex: number };
            const diagnostic: WriteTargetAdmissionDiagnostic_ACU = {
                executionPath: 'legacy_auto',
                targetMessageIndex: saveTargetIndex,
                latestReplayRootIndex: admissionFailure.latestFullCheckpointIndex,
            };
            return {
                success: false,
                modifiedKeys: [],
                error: admissionFailure.reason,
                diagnosticCode: 'write_target_before_replay_root',
                diagnostic,
            };
            }
        }
        let lastSqlError: string | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const attemptReadContext = createLorebookReadContext_ACU({ source: 'form_fill_legacy', isActive: () => !effectiveAbortController?.signal.aborted, isAborted: () => effectiveAbortController?.signal.aborted === true });
            try {
                let rawBaseSnapshot: Record<string, any> = getRuntimeTableDataSnapshot_ACU(progressContext?.batchBaseSnapshot || null) || {};
                const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(
                    buildWriteSetForSheetKeys_ACU(targetSheetKeys, rawBaseSnapshot),
                    { chatKey: executionScope.chatKey, isolationKey: executionScope.isolationKey },
                );
                const currentJob: GroupFillJob_ACU = {
                    groupKey: `legacy_execute_${saveTargetIndex}`,
                    groupId: 0,
                    batchNumber: progressContext?.currentBatch || 1,
                    targetSheetKeys,
                    messagesForContext: messagesToUse,
                    saveTargetIndex,
                    updateMode,
                    requestOptions,
                    baseSnapshot: rawBaseSnapshot,
                    baseRevision,
                    isImportMode,
                    chatKey: executionScope.chatKey,
                    isolationKey: executionScope.isolationKey,
                    templateScope: executionScope.templateScope,
                    sqlApplyScope: executionScope.sqlApplyScope,
                };
                const collectResult = await collectGroupFillResponse_ACU(
                    currentJob,
                    { lastSqlError },
                    effectiveAbortController,
                    { onProgress: emitProgress, maxRetriesOverride: 1, worldbookReadContext: attemptReadContext },
                );

                if (collectResult.aborted) {
                    return { success: false, modifiedKeys: [], aborted: true };
                }
                if (!collectResult.success || !collectResult.aiResponse) {
                    throw new UpdateAttemptError_ACU(
                        collectResult.rawError || collectResult.error || 'AI响应收集失败',
                        collectResult.errorCategory || 'infrastructure',
                    );
                }

                emitProgress({ phase: 'parsing' });
                const aiResponse = collectResult.aiResponse;

                const isSqlTableEdit = isSqliteMode() && typeof collectResult.tableEditText === 'string' && isSqlContent(collectResult.tableEditText);

                if (isSqlTableEdit) {
                    const writeSet = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0
                        ? targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }))
                        : [{ kind: 'all' as const }];
                    const commitResult = await runTableUpdateCommit_ACU<CardUpdateResult>({
                        source: 'group_fill',
                        reason: 'executeCardUpdateCore',
                        chatKey: executionScope.chatKey,
                        isolationKey: executionScope.isolationKey,
                        writeSet,
                        baseRevision,
                        workingDataMode: 'none',
                        initialData: rawBaseSnapshot as any,
                        targetMessageIndex: saveTargetIndex,
                        targetSheetKeys: null,
                        updateGroupKeys: null,
                        trackingSheetKeys: null,
                        trackAsUpdate: true,
                        skipChatSave: isImportMode,
                    }, async () => {
                        const provider = await ensureStorageProviderReady_ACU();
                        if (typeof provider.applyEditsWithSystemRowIds !== 'function') {
                            return {
                                success: false,
                                error: 'SQLite provider 不支持原子 row_id 分配。',
                                errorCategory: 'infrastructure' as const,
                            };
                        }
                        let parseResult: any;
                        try {
                            parseResult = provider.applyEditsWithSystemRowIds(
                                [collectResult.tableEditText || ''],
                                updateMode,
                                executionScope.sqlApplyScope,
                            );
                        } catch (error: any) {
                            const isRuntimeSchemaError = error instanceof SqlRuntimeSnapshotError_ACU
                                || error instanceof SqlRuntimeSchemaInvalidError_ACU
                                || error instanceof SqlRuntimeSchemaStaleError_ACU;
                            const errorCategory = isRuntimeSchemaError ? 'infrastructure' as const : 'model' as const;
                            return { success: false, error: sanitizeRetryFeedback_ACU(error?.message || String(error)), errorCategory };
                        }
                        const parseSuccess = !!parseResult?.success;
                        const parsedKeys: string[] = Array.isArray(parseResult?.modifiedKeys) ? parseResult.modifiedKeys : [];
                        if (!parseSuccess) {
                            return { success: false, error: sanitizeRetryFeedback_ACU(parseResult?.error || '解析或应用AI更新时出错'), errorCategory: 'model' as const };
                        }

                        const runtimeSqlText = parseResult.materializedSqlTexts[0] || '';
                        const runtimeData = parseResult.tableData as Record<string, any>;
                        const operationBuild = buildSqlSheetBatchOperationsFromText_ACU(runtimeSqlText, runtimeData, targetSheetKeys);
                        if (operationBuild.success === false) {
                            return { success: false, error: sanitizeRetryFeedback_ACU(operationBuild.error), errorCategory: 'model' as const };
                        }
                        const operations = operationBuild.operations;

                        if (isImportMode) {
                            // import 不写聊天帧、无回放操作，编号可全量应用（无漂移风险）。
                            applySpecialIndexSequenceToSummaryTables_ACU(runtimeData);
                            emitProgress({ phase: 'chunk_done' });
                            logDebug_ACU('Import mode: skipping save to chat history for this chunk.');
                            return {
                                success: true,
                                value: { success: true, modifiedKeys: parsedKeys },
                                tableData: runtimeData as any,
                                mutationResult: { changes: parseResult.appliedEdits || 0, errors: [] },
                                persist: { revisionWriteSet: parsedKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey })) },
                            };
                        }

                        emitProgress({ phase: 'saving' });
                        let keysToPersist = parsedKeys;
                        if (targetSheetKeys && Array.isArray(targetSheetKeys)) {
                            keysToPersist = keysToPersist.filter((k: string) => targetSheetKeys.includes(k));
                        }

                        const isFirstTimeInit = await checkIfFirstTimeInit_ACU();
                        const hasTargetSheetTracking = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0;
                        const allSheetKeys = getSortedSheetKeys_ACU(runtimeData);
                        const targetTrackingKeys = hasTargetSheetTracking
                            ? targetSheetKeys.filter((sheetKey: string) => Boolean(runtimeData?.[sheetKey]))
                            : [];
                        let keysToActuallySave = keysToPersist;
                        if (isFirstTimeInit) {
                            keysToActuallySave = allSheetKeys;
                            const fullTemplate = executionScope.sqlApplyScope?.templateDataWithRows || parseTableTemplateJson_ACU({ stripSeedRows: false });
                            if (fullTemplate) {
                                allSheetKeys.forEach(sheetKey => {
                                    if (!keysToPersist.includes(sheetKey) && fullTemplate[sheetKey]) {
                                        const templateSheet = JSON.parse(JSON.stringify(fullTemplate[sheetKey]));
                                        if (Array.isArray(templateSheet.content)) templateSheet.content = ensureStableRowIdsForSheetContent_ACU(templateSheet.content);
                                        runtimeData[sheetKey] = templateSheet;
                                        logDebug_ACU(`[Init] Table ${sheetKey} not modified by AI, using template data (may include seed rows).`);
                                    }
                                });
                            }
                            logDebug_ACU('[Init] First time initialization detected. Saving complete template structure with all tables.');
                        }
                        const keysToTrackAsUpdated = hasTargetSheetTracking
                            ? keysToPersist.filter((sheetKey: string) => targetTrackingKeys.includes(sheetKey))
                            : keysToPersist.filter((sheetKey: string) => keysToActuallySave.includes(sheetKey));
                        const fillAttemptKeys = hasTargetSheetTracking
                            ? targetTrackingKeys
                            : keysToPersist;
                        const updateGroupKeysToUse = Array.isArray(fillAttemptKeys)
                            ? fillAttemptKeys.filter(sheetKey => {
                                const table = runtimeData?.[sheetKey];
                                if (!table || !isSummaryOrOutlineTable_ACU(table.name)) return true;
                                return keysToTrackAsUpdated.includes(sheetKey);
                            })
                            : fillAttemptKeys;
                        // 自动编号（卡级 SQL 出口）：只作用于本次持久化范围内的表，并对编号
                        // 变化的表追加 sheet_replace，消除既有的 live/回放编号漂移。
                        const renumberedSheetKeys = applyAutoNumberingWithinScope_ACU(runtimeData, keysToActuallySave);
                        operations.push(...buildSheetReplaceOperationsFromData_ACU(runtimeData, renumberedSheetKeys, 'system'));
                        const revisionWriteSet = parsedKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));

                        return {
                            success: true,
                            value: { success: true, modifiedKeys: parsedKeys },
                            tableData: runtimeData as any,
                            mutationResult: { changes: parseResult.appliedEdits || 0, errors: [] },
                            persist: {
                                targetSheetKeys: keysToActuallySave,
                                updateGroupKeys: updateGroupKeysToUse,
                                trackingSheetKeys: keysToTrackAsUpdated,
                                trackAsUpdate: true,
                                operations,
                                revisionWriteSet,
                                beforePersist: buildFlightModeHiddenRowsBeforePersist_ACU(rawBaseSnapshot, isImportMode),
                            },
                        };
                    });

                    if (!commitResult.success || !commitResult.value) {
                        throw new UpdateAttemptError_ACU(
                            commitResult.error || '解析或应用AI更新时出错',
                            commitResult.errorCategory || 'infrastructure',
                        );
                    }
                    modifiedKeys = commitResult.value.modifiedKeys;
                    if (!isImportMode && commitResult.tableData) {
                        await updateReadableLorebookEntry_ACU(true, false, null, commitResult.tableData);
                    }
                    success = true;
                    break;
                }

                const writeSet = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0
                    ? targetSheetKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }))
                    : [{ kind: 'all' as const }];
                const updateOutcome = await runTableUpdateCommit_ACU<CardUpdateResult>({
                    source: 'group_fill',
                    reason: 'executeCardUpdateCore:snapshot',
                    chatKey: executionScope.chatKey,
                    isolationKey: executionScope.isolationKey,
                    writeSet,
                    baseRevision,
                    initialData: rawBaseSnapshot as any,
                    targetMessageIndex: saveTargetIndex,
                    targetSheetKeys: null,
                    updateGroupKeys: null,
                    trackingSheetKeys: null,
                    trackAsUpdate: true,
                    skipChatSave: isImportMode,
                }, async ({ workingData }) => {
                    let workingTableData = (workingData || {}) as Record<string, any>;
                    const parseResult: any = parseAndApplyTableEditsToData_ACU(aiResponse, workingTableData, updateMode, isImportMode);

                    let parseSuccess = false;
                    let parsedKeys: string[] = [];

                    if (typeof parseResult === 'object' && parseResult !== null) {
                        parseSuccess = parseResult.success;
                        parsedKeys = parseResult.modifiedKeys || [];
                    } else {
                        parseSuccess = !!parseResult;
                        parsedKeys = targetSheetKeys || [];
                    }

                    if (!parseSuccess) {
                        return { success: false, error: sanitizeRetryFeedback_ACU(parseResult?.error || '解析或应用AI更新时出错'), errorCategory: 'model' as const };
                    }

                    applySpecialIndexSequenceToSummaryTables_ACU(workingTableData);
                    const revisionWriteSet = parsedKeys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey }));
                    if (isImportMode) {
                        emitProgress({ phase: 'chunk_done' });
                        logDebug_ACU("Import mode: skipping save to chat history for this chunk.");
                        return {
                            success: true,
                            value: { success: true, modifiedKeys: parsedKeys },
                            tableData: workingTableData as any,
                            persist: { revisionWriteSet },
                        };
                    }

                    emitProgress({ phase: 'saving' });

                    let keysToPersist = parsedKeys;
                    if (targetSheetKeys && Array.isArray(targetSheetKeys)) {
                        keysToPersist = keysToPersist.filter((k: string) => targetSheetKeys.includes(k));
                    }

                    const isFirstTimeInit = await checkIfFirstTimeInit_ACU();
                    const hasTargetSheetTracking = Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0;
                    const allSheetKeys = getSortedSheetKeys_ACU(workingTableData);
                    const targetTrackingKeys = hasTargetSheetTracking
                        ? targetSheetKeys.filter((sheetKey: string) => Boolean(workingTableData?.[sheetKey]))
                        : [];
                    let keysToActuallySave = keysToPersist;
                    if (isFirstTimeInit) {
                        keysToActuallySave = allSheetKeys;

                        const fullTemplate = executionScope.sqlApplyScope?.templateDataWithRows || parseTableTemplateJson_ACU({ stripSeedRows: false });
                        if (fullTemplate) {
                            allSheetKeys.forEach(sheetKey => {
                                if (!keysToPersist.includes(sheetKey) && fullTemplate[sheetKey]) {
                                    const templateSheet = JSON.parse(JSON.stringify(fullTemplate[sheetKey]));
                                    if (Array.isArray(templateSheet.content)) templateSheet.content = ensureStableRowIdsForSheetContent_ACU(templateSheet.content);
                                    workingTableData[sheetKey] = templateSheet;
                                    logDebug_ACU(`[Init] Table ${sheetKey} not modified by AI, using template data (may include seed rows).`);
                                }
                            });
                        }

                        logDebug_ACU('[Init] First time initialization detected. Saving complete template structure with all tables.');
                    }

                    if (keysToPersist.length === 0 && !isFirstTimeInit && !hasTargetSheetTracking) {
                        logDebug_ACU("No tables were modified by AI and no target sheets are known; committing runtime view without chat persistence.");
                        return {
                            success: true,
                            value: { success: true, modifiedKeys: parsedKeys },
                            tableData: workingTableData as any,
                            persist: { targetSheetKeys: [], updateGroupKeys: [], trackingSheetKeys: [], trackAsUpdate: false, operations: [], revisionWriteSet },
                        };
                    }

                    const keysToTrackAsUpdated = hasTargetSheetTracking
                        ? keysToPersist.filter((sheetKey: string) => targetTrackingKeys.includes(sheetKey))
                        : keysToPersist.filter((sheetKey: string) => keysToActuallySave.includes(sheetKey));
                    const fillAttemptKeys = hasTargetSheetTracking
                        ? targetTrackingKeys
                        : keysToPersist;
                    const updateGroupKeysToUse = Array.isArray(fillAttemptKeys)
                        ? fillAttemptKeys.filter(sheetKey => {
                            const table = workingTableData?.[sheetKey];
                            if (!table || !isSummaryOrOutlineTable_ACU(table.name)) return true;
                            return keysToTrackAsUpdated.includes(sheetKey);
                        })
                        : fillAttemptKeys;
                    const operations = buildSheetReplaceOperationsFromData_ACU(workingTableData, keysToActuallySave, 'system');

                    return {
                        success: true,
                        value: { success: true, modifiedKeys: parsedKeys },
                        tableData: workingTableData as any,
                        persist: {
                            targetSheetKeys: keysToActuallySave,
                            updateGroupKeys: updateGroupKeysToUse,
                            trackingSheetKeys: keysToTrackAsUpdated,
                            trackAsUpdate: true,
                            operations,
                            revisionWriteSet,
                            beforePersist: buildFlightModeHiddenRowsBeforePersist_ACU(rawBaseSnapshot, isImportMode),
                        },
                    };
                });

                if (!updateOutcome.success || !updateOutcome.value) {
                    return {
                        success: false,
                        modifiedKeys: [],
                        error: sanitizeRetryFeedback_ACU(updateOutcome.error || '无法将更新后的数据库保存到聊天记录。', MAX_WARN_ERROR_LENGTH_ACU),
                        errorCategory: updateOutcome.errorCategory || 'infrastructure',
                    };
                }
                modifiedKeys = updateOutcome.value.modifiedKeys;
                if (!isImportMode && updateOutcome.tableData) {
                    await updateReadableLorebookEntry_ACU(true, false, null, updateOutcome.tableData);
                }

                success = true;
                break;

            } catch (error: any) {
                const safeError = sanitizeRetryFeedback_ACU(error?.message || String(error), MAX_WARN_ERROR_LENGTH_ACU);
                logWarn_ACU(`第 ${attempt} 次尝试失败: ${safeError}`);

                if (error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted') || wasStoppedByUser_ACU) {
                    return { success: false, modifiedKeys: [], aborted: true };
                }

                const errorCategory: TableUpdateCommitErrorCategory_ACU = error instanceof UpdateAttemptError_ACU
                    ? error.category
                    : 'infrastructure';
                if (errorCategory !== 'model') {
                    return { success: false, modifiedKeys: [], error: safeError, errorCategory };
                }
                if (isSqliteMode()) lastSqlError = safeError;

                if (attempt < maxRetries) {
                    const waitTime = 5000;
                    logDebug_ACU(`等待 ${waitTime}ms 后重试...`);
                    emitProgress({ phase: 'retry', attempt, maxRetries, message: sanitizeRetryFeedback_ACU(safeError, 50) });
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                } else {
                    return { success: false, modifiedKeys: [], error: `填表在 ${maxRetries} 次尝试后仍失败: ${safeError}`, errorCategory };
                }
            }
            finally {
                try {
                    attemptReadContext.dispose();
                } catch {
                    // 清理失败不应影响主流程结果
                }
            }
        }

        if (success) {

            emitProgress({ phase: 'complete' });

            if (!isImportMode) {
                try {
                    await loadAllChatMessages_ACU();
                    const boundaryCheckpoint = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });
                    if (!boundaryCheckpoint.success) {
                        logWarn_ACU(`[Auto Update] 自动更新完成，但 AI 楼层边界 checkpoint 建立失败: ${boundaryCheckpoint.error || '未知错误'}`);
                    }
                } catch (checkpointError: any) {
                    logWarn_ACU(
                        `[Auto Update] 自动更新完成，但 AI 楼层边界 checkpoint 建立异常: ${checkpointError?.message || checkpointError}`,
                        checkpointError,
                    );
                }
            }

            // [spv3.6.6] 填表完成后异步触发交火向量索引防抖归档
            // 将 embedding + 归档写入从 saving 阶段移到 complete 之后，
            // 避免 embedding API 调用阻塞"正在保存"提示框。
            // 使用 flush queue 替代直接调用，由防抖定时器统一调度。
            // [spv3.6.9] 增加诊断日志，记录入队结果（queued/skipped）
            if (!isImportMode && success && getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true) {
                enqueueSummaryVectorIndexFlush_ACU({
                    targetMessageIndex: saveTargetIndex,
                    mode: 'sync',
                    reason: 'table_fill_complete',
                }).then(result => {
                    if (result.skipped) {
                        logWarn_ACU(`[交火模式纪要索引] 填表完成后防抖归档被跳过：${result.reason || 'unknown'}, scopeKey=${result.scopeKey || ''}`);
                    } else if (result.queued) {
                        logDebug_ACU(`[交火模式纪要索引] 填表完成后已入队防抖归档, scopeKey=${result.scopeKey}, debounceUntil=${result.debounceUntil}`);
                    }
                }).catch(err => {
                    logWarn_ACU('[交火模式纪要索引] 填表完成后防抖归档入队异常:', err);
                });
            }

        }
        return { success, modifiedKeys };

    } catch (error: any) {
        if (error.name === 'AbortError') {
            logDebug_ACU('Fetch request was aborted by the user.');
            return { success: false, modifiedKeys: [], aborted: true };
        } else {
            logError_ACU(`数据库增量更新流程失败: ${error.message}`);
            return { success: false, modifiedKeys: [], error: error.message };
        }
    }
}

/**
 * 批处理更新编排（纯业务逻辑）
 * 从 processUpdates_ACU 提取。不驱动 UI，只返回结果。
 */
export async function processUpdatesBatch_ACU(
    indicesToUpdate: number[],
    mode: string,
    options: any,
    executeUpdate: (
        messagesToUse: any[],
        saveTargetIndex: number,
        updateMode: string,
        isSilentMode: boolean,
        targetSheetKeys: string[] | null,
        requestOptions: Record<string, any> | null,
        progressContext: BatchUpdateProgressContext
    ) => Promise<CardUpdateResult>
): Promise<BatchUpdateResult> {
    if (!indicesToUpdate || indicesToUpdate.length === 0) {
        return { success: true };
    }

    const { targetSheetKeys, batchSize: specificBatchSize, requestOptions } = options;
    const schedulingIdentitySnapshot = cloneTableDataSnapshot_ACU(currentJsonTableData_ACU);

    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU('processUpdatesBatch');
    if (!migration.success) {
        return { success: false, error: migration.error || '旧存储迁移失败，已阻止本次填表。' };
    }
    if (migration.migrated) {
        await reloadStorageProvider();
    }

    _set_wasStoppedByUser_ACU(false);
    _set_isAutoUpdatingCard_ACU(true);

    try {
        const isSummaryMode = (mode && (mode.includes('summary') || mode === 'manual_summary')) || false;
        const batchSize = specificBatchSize || (settings_ACU.updateBatchSize || 2);

        const batches: number[][] = [];
        for (let i = 0; i < indicesToUpdate.length; i += batchSize) {
            batches.push(indicesToUpdate.slice(i, i + batchSize));
        }

        logDebug_ACU(`[${mode}] Processing ${indicesToUpdate.length} updates in ${batches.length} batches of size ${batchSize} (${isSummaryMode ? '总结表模式' : '标准表模式'}). Target Sheets: ${targetSheetKeys ? targetSheetKeys.length : 'All'}`);

        const chatHistory = getChatArray_ACU();
        const isAutoUpdateMode = mode && mode.startsWith('auto');
        const isSilentMode = !!(isAutoUpdateMode && settings_ACU.toastMuteEnabled);
        // 此处刻意不接 replayEvidence：本循环每批 maxMessageIndex = firstMessageIndexOfBatch - 1
        // 严格递增，evidence 复用要求 boundary 完全相同（v2-replay-session.ts），命中率恒为 0，
        // 而 replay 仍会为写回 evidence 多付一次全表深克隆 —— 纯亏。跨批复用属阶段 G2
        // run-scoped session 语义（需从已提交 snapshot 增量前进），不能用同 boundary evidence 冒充。

        for (let i = 0; i < batches.length; i++) {
            const batchIndices = batches[i];
            const batchNumber = i + 1;
            const firstMessageIndexOfBatch = batchIndices[0];
            const lastMessageIndexOfBatch = batchIndices[batchIndices.length - 1];
            const finalSaveTargetIndex = lastMessageIndexOfBatch;

            // 构建合并基底
            const baseResult = await buildBatchMergeBase_ACU(batchNumber, { maxMessageIndex: firstMessageIndexOfBatch - 1 });
            if (!baseResult.data) {
                return { success: false, failedBatch: batchNumber, error: baseResult.error || '无法构建合并基底，操作已终止。' };
            }
            const mergedBatchData = baseResult.data;
            let effectiveTargetSheetKeys = targetSheetKeys;
            if (Array.isArray(targetSheetKeys) && targetSheetKeys.length > 0) {
                try {
                    effectiveTargetSheetKeys = rebindSheetKeysThroughTableAliases_ACU(
                        targetSheetKeys,
                        schedulingIdentitySnapshot,
                        mergedBatchData,
                    );
                } catch (error) {
                    return { success: false, failedBatch: batchNumber, error: error instanceof Error ? error.message : String(error) };
                }
            }

            const batchSheetKeys = getSortedSheetKeys_ACU(mergedBatchData);
            const batchIsolationKey = getCurrentIsolationKey_ACU();

            // 加载历史数据
            const loadResult = loadBatchBaseData_ACU(chatHistory, firstMessageIndexOfBatch, batchIsolationKey, batchSheetKeys, mergedBatchData);
            _set_currentJsonTableData_ACU(mergedBatchData);
            logDebug_ACU(`[Batch ${batchNumber}] Loaded ${loadResult.foundCount}/${loadResult.totalCount} tables from history before index ${firstMessageIndexOfBatch}. Missing tables will use template structure (header-only).`);

            // 计算上下文范围
            let sliceStartIndex = firstMessageIndexOfBatch;
            if (sliceStartIndex > 0 && chatHistory[sliceStartIndex - 1]?.is_user) {
                sliceStartIndex--;
                logDebug_ACU(`[Batch ${batchNumber}] Adjusted slice start to ${sliceStartIndex} to include preceding user message.`);
            }
            const messagesForContext = chatHistory.slice(sliceStartIndex, lastMessageIndexOfBatch + 1);

            // 检查最新AI回复长度阈值
            const lastAiMessageInBatch = chatHistory[lastMessageIndexOfBatch];
            const lastAiMessageContent = lastAiMessageInBatch?.mes || lastAiMessageInBatch?.message || '';
            const lastAiMessageLength = lastAiMessageContent.length;
            const minReplyLength = settings_ACU.autoUpdateTokenThreshold || 0;

            if (isAutoUpdateMode && lastAiMessageLength < minReplyLength) {
                logDebug_ACU(`[Auto] Batch ${batchNumber}/${batches.length} skipped: Last AI reply length (${lastAiMessageLength}) is below threshold (${minReplyLength}).`);
                continue;
            }

            // 确定更新模式
            const updateMode = resolveUpdateMode_ACU(mode);

            // 决议 effective API preset：如果调用方未指定 tableApiPreset，
            // 则以 targetSheetKeys 中第一个表名为准查覆盖映射
            let effectiveRequestOptions = requestOptions;
            if (!effectiveRequestOptions?.tableApiPreset && effectiveTargetSheetKeys && effectiveTargetSheetKeys.length > 0) {
                const firstTableName = mergedBatchData?.[effectiveTargetSheetKeys[0]]?.name || '';
                const resolvedPreset = resolveTableApiPresetOverride_ACU(firstTableName);
                if (resolvedPreset) {
                    effectiveRequestOptions = { ...(effectiveRequestOptions || {}), tableApiPreset: resolvedPreset };
                }
            }

            const result = await executeUpdate(
                messagesForContext,
                finalSaveTargetIndex,
                updateMode,
                isSilentMode,
                effectiveTargetSheetKeys,
                effectiveRequestOptions,
                {
                    currentBatch: batchNumber,
                    totalBatches: batches.length,
                    batchBaseSnapshot: JSON.parse(JSON.stringify(mergedBatchData)),
                }
            );

            if (!result.success) {
                return {
                    success: false,
                    failedBatch: batchNumber,
                    error: result.error || `批处理在第 ${batchNumber} 批时失败或被终止。`,
                    ...(result.diagnosticCode ? { diagnosticCode: result.diagnosticCode } : {}),
                    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
                };
            }
        }

        return { success: true };
    } finally {
        _set_isAutoUpdatingCard_ACU(false);
        _set_wasStoppedByUser_ACU(false);
    }
}

function collectEffectiveAiMessageIndices_ACU(chat: any[]): number[] {
    const allAiMessageIndices = chat
        .map((message: any, index: number) => !message?.is_user ? index : -1)
        .filter((index: number) => index >= 0);
    const skipped = Math.max(0, Math.trunc(Number(settings_ACU.skipUpdateFloors) || 0));
    return skipped > 0 ? allAiMessageIndices.slice(0, -skipped) : allAiMessageIndices;
}

/**
 * 确认后 TOCTOU 复检的核心判定：只比较 runtime 真实表键与确认前快照。
 * 绝不允许模板兜底——展示回退（parseTableTemplateJson_ACU）不能成为执行资格。
 * runtime 缺失或表集合与快照不一致时返回 false，调用方必须 fail-closed 阻断。
 */
function runtimeSheetKeysMatchSnapshot_ACU(snapshotKeys: string[]): boolean {
    if (!Array.isArray(snapshotKeys) || snapshotKeys.length === 0) return false;
    const liveRuntimeTable = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
        ? (currentJsonTableData_ACU as Record<string, any>)
        : null;
    if (!liveRuntimeTable) return false;
    const liveSheetKeys = Object.keys(liveRuntimeTable).filter(key => key.startsWith('sheet_')).sort();
    const normalizedSnapshotKeys = [...snapshotKeys].sort();
    if (liveSheetKeys.length !== normalizedSnapshotKeys.length) return false;
    const snapshotSet = new Set(normalizedSnapshotKeys);
    return liveSheetKeys.every(key => snapshotSet.has(key));
}

function createManualCatchUpRunId_ACU(): string {
    return `manual-catch-up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function countCatchUpChunkBuckets_ACU(groups: ManualCatchUpPlan_ACU['waves'][number]['groups'], messageIndices: number[]): number {
    const bucketKeys = new Set<string>();
    groups.forEach(group => {
        const batchSize = Math.max(1, Math.trunc(Number(group.batchSize) || 1));
        for (let offset = 0, batchNumber = 1; offset < messageIndices.length; offset += batchSize, batchNumber += 1) {
            const batchIndices = messageIndices.slice(offset, offset + batchSize);
            const saveTargetIndex = batchIndices[batchIndices.length - 1];
            bucketKeys.add(`${saveTargetIndex}|${batchNumber}|${group.updateMode}`);
        }
    });
    return bucketKeys.size;
}

/**
 * 从聊天中的已提交事实生成 catch-up 计划，不调用 AI、不写入数据。
 * 调用方可用于确认展示；真正执行时必须重新规划，以吸收确认期间的提交变化。
 */
export async function prepareManualCatchUpPlan_ACU(targetKeys: string[]): Promise<ManualCatchUpPlanningResult_ACU> {
    if (!Array.isArray(targetKeys) || targetKeys.length === 0) {
        return { success: false, error: '未选择需要追平的表格。' };
    }

    await loadAllChatMessages_ACU();
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return { success: false, error: '聊天记录为空，无法执行追平。' };
    }

    // 追平资格只认 runtime 真实表，绝不允许用模板兜底：
    // runtime 若在此前被 purge 清空，目标集合必须为空，防止展示回退渗进执行资格判定。
    // 模板仅用于后续规划时解析表配置（name/updateConfig/preset），不能作为目标存在的依据。
    const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true }) || {};
    const runtimeTableData = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
        ? (currentJsonTableData_ACU as Record<string, any>)
        : null;
    const selectedSheetKeys = [...new Set(targetKeys.filter(key =>
        typeof key === 'string'
        && key.startsWith('sheet_')
        && Boolean(runtimeTableData?.[key])
    ))].sort();
    if (selectedSheetKeys.length === 0) {
        return { success: false, error: '未找到可追平的已选表格。' };
    }

    const effectiveAiMessageIndices = collectEffectiveAiMessageIndices_ACU(chat);
    const isolationKey = getCurrentIsolationKey_ACU();
    const plan = planManualCatchUpWaves_ACU(effectiveAiMessageIndices, selectedSheetKeys.map(sheetKey => {
        const sheet = runtimeTableData?.[sheetKey] || templateData[sheetKey] || {};
        const history = resolveTableHistoryStateFromChat_ACU(chat, {
            sheetKey,
            isSummaryTable: isSummaryOrOutlineTable_ACU(String(sheet.name || '')),
            isolationKey,
            settings: settings_ACU,
        });
        const updateConfig = sheet.updateConfig || {};
        const groupId = Number.isFinite(updateConfig.groupId) ? Math.trunc(updateConfig.groupId) : -1;
        const preset = resolveTableApiPresetOverride_ACU(sheet.name);
        return {
            sheetKey,
            lastCompletedAiFloor: history.lastTrackedUpdateAiFloor,
            groupId,
            batchSize: Math.max(1, Math.trunc(Number(settings_ACU.updateBatchSize) || 1)),
            requestOptions: preset ? { tableApiPreset: preset } : null,
            updateMode: 'manual_independent',
            executionKind: isSqliteMode() ? 'sql' as const : 'standard' as const,
        };
    }));

    return { success: true, plan };
}

/**
 * 按聊天中已提交的 scheduleSummary/事件事实规划并执行所选表的后缀追平。
 * 不扫描或声称修复历史内部空洞；一期只处理每表连续前沿后的缺口。
 */
export async function orchestrateManualCatchUp_ACU(
    targetKeys: string[],
    refreshData: () => Promise<{ degraded?: boolean } | void>,
    options: {
        abortController?: AbortController;
        onProgress?: (event: CardUpdateProgressEvent) => void;
        /**
         * UI 确认前的 runtime 表键快照（可选）。
         * 提供时，orchestrator 在内部规划完成、任何 AI 调用或持久化写入之前
         * 重新校验当前 runtime 与快照的一致性；若 runtime 在确认期间被 purge
         * 或表集合变化，直接 fail-closed 阻断，防止展示回退/陈旧目标继续执行。
         */
        executionSnapshot?: { sheetKeys: string[] };
    } = {},
): Promise<ManualUpdateResult> {
    if (isAutoUpdatingCard_ACU) {
        return { success: false, error: '数据库更新正在进行中，请稍候。' };
    }
    if (!coreApisAreReady_ACU) {
        return { success: false, error: 'API未就绪。' };
    }

    // 追平规划前必须先完成 legacy→V2 迁移：迁移会按 skipUpdateFloors 在后方楼层创建
    // migration full checkpoint。若等到 chunk 执行时才迁移，第一 bucket 的目标楼层早于
    // 新锚点，persist 会以 target < latestFullCheckpoint fail-fast 拒绝，用户已经白白
    // 支付了一次 AI 调用。迁移成功后必须重载存储运行时与聊天，再重新规划与重新预检。
    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU('orchestrateManualCatchUp:preplan');
    if (!migration.success) {
        return {
            success: false,
            error: migration.error || '旧存储迁移失败，已阻止手动追平。',
            committedBucketCount: 0,
            dataCommitted: false,
            replayVerified: false,
            terminalProgressSaved: false,
            diagnosticCode: 'catch_up_migration_failed',
        };
    }
    if (migration.migrated) {
        // 迁移改写聊天持久化拓扑：内存 runtime、模板与聊天数组都必须基于新状态重建，
        // 否则规划会建立在迁移前的陈旧快照上。
        const reloadResult = await reloadStorageProvider();
        if (!reloadResult?.ok) {
            return {
                success: false,
                error: reloadResult?.error || reloadResult?.failureCode || '迁移后存储运行时重载失败，已阻止手动追平。',
                committedBucketCount: 0,
                dataCommitted: false,
                replayVerified: false,
                terminalProgressSaved: false,
                diagnosticCode: 'catch_up_migration_reload_failed',
            };
        }
        logDebug_ACU('[手动追平] 已前置完成 legacy→V2 迁移并重载运行时，重新规划追平计划。');
    }

    const planningResult = await prepareManualCatchUpPlan_ACU(targetKeys);
    if (!planningResult.success || !planningResult.plan) {
        return { success: false, error: planningResult.error || '无法生成手动追平计划。' };
    }
    const plan = planningResult.plan;
    const selectedSheetKeys = [...new Set(plan.waves.flatMap(wave => wave.sheetKeys))].sort();

    // 确认后 TOCTOU 复检（service 层最终准入）：
    // UI 层在调用前已复检一次，但 orchestrator 内部跨越了 loadAllChatMessages/reloadStorage
    // 等多个异步边界，runtime 可能在此间被 purge 或表集合变化。这里在内部规划完成、
    // 任何锚点预检/写 bridge/AI 调用之前再次核对当前 runtime 与确认前快照。
    // 只比较 runtime 真实表键，绝不允许模板兜底：展示回退不能成为执行资格。
    // 契约：executionSnapshot 未提供（undefined）→ legacy 不启用保护；
    // 显式提供（即使 sheetKeys 为空/非法）→ 必须 fail-closed，禁止静默降级。
    const executionSnapshot = options.executionSnapshot?.sheetKeys;
    if (options.executionSnapshot !== undefined) {
        if (!runtimeSheetKeysMatchSnapshot_ACU(executionSnapshot)) {
            logWarn_ACU('[手动追平] runtime 表集合在确认期间变化，已阻止执行（快照未匹配）。');
            return {
                success: false,
                outcome: 'blocked',
                error: '表格运行时在确认期间发生变化，已取消追平，请重新确认目标。',
                catchUpPlan: plan,
                committedBucketCount: 0,
                dataCommitted: false,
                replayVerified: false,
                terminalProgressSaved: false,
                diagnosticCode: 'catch_up_runtime_changed_after_confirmation',
            };
        }
    }

    if (plan.waves.length === 0) {
        return {
            success: true,
            outcome: 'no_work',
            catchUpPlan: plan,
            committedBucketCount: 0,
            dataCommitted: false,
            replayVerified: true,
            terminalProgressSaved: false,
        };
    }

    // runId 必须在 preflight 之前创建：staging run 与 bucket 提交共用同一个 runId，
    // 保证 run-scoped 隔离（staging 只认本 run 授权的目标表）。
    const runId = createManualCatchUpRunId_ACU();
    // 跨 full checkpoint staging run 状态：冻结 scope 后在 bucket 循环内累积 staging
    // overlay，到达原 full 边界原子汇合。不能依赖全局状态——必须在 run 内显式跟踪。
    let boundaryPlan: TableFillBoundaryStagingPlan_ACU | null = null;
    let stagingRun: TableFillStagingRunContext_ACU | null = null;
    let stagingSession: TableFillStagingSession_ACU | null = null;
    let boundaryCommitted = false;

    // 旧版“删除全部数据”会将 header-only reset checkpoint 留在原先较晚楼层。
    // 在任何 AI 调用之前修复可证明安全的布局；无法证明安全则阻断，而不是让 bucket
    // 伪提交后由 terminal progress-only 写入兜底报错。
    const preflightTargetIndex = plan.waves[0]?.messageIndices[0] ?? plan.targetMessageIndex;
    if (preflightTargetIndex !== null && preflightTargetIndex !== undefined) {
        const anchorPreflight = await ensureManualCatchUpAnchorBeforeTarget_ACU(preflightTargetIndex, getCurrentIsolationKey_ACU());
        if (anchorPreflight.status === 'blocked') {
            return {
                success: false,
                outcome: 'blocked',
                error: anchorPreflight.error,
                catchUpPlan: plan,
                committedBucketCount: 0,
                dataCommitted: false,
                diagnosticCode: 'anchor_preflight_blocked',
            };
        }
        if (anchorPreflight.status === 'provisional_bridge_required') {
            // 追平目标早于含真实数据的正式 full checkpoint：不能移动原根，也不建立临时根。
            // 改为冻结跨根 staging scope：边界前 bucket 只进 run 级隔离 staging（不写聊天
            // V2 frame），到达原 full 边界原子汇合（sheet_rebase），边界后恢复普通持久化。
            const isolationKey = getCurrentIsolationKey_ACU();
            const liveChat = getChatArray_ACU();
            // 旧版本遗留的 active provisional bridge 仍需恢复（兼容窗口未结束）；
            // 新运行不再建立 bridge，因此这里只处理历史残留。
            if (hasActiveProvisionalBridgeAnywhere_ACU(liveChat)) {
                const recovery = await recoverProvisionalBridgeSession_ACU({ isolationKey });
                if (!recovery.ok) {
                    return {
                        success: false,
                        outcome: 'blocked',
                        error: `检测到 active provisional bridge 且自动恢复失败：${(recovery as { ok: false; error: string }).error}`,
                        catchUpPlan: plan,
                        committedBucketCount: 0,
                        dataCommitted: false,
                        diagnosticCode: 'provisional_recovery_required',
                    };
                }
            }
            // 冻结跨根 staging scope。checkpointMessageIndex 是唯一 full（多根已在
            // ensureManualCatchUpAnchorBeforeTarget_ACU 内 blocked），作为 originalFullIndex。
            const allPendingIndices = [...new Set(plan.waves.flatMap(wave => wave.messageIndices))].sort((left, right) => left - right);
            const templateFingerprint = getTableDataFingerprint_ACU(parseTableTemplateJson_ACU({ stripSeedRows: true }) || {});
            try {
                boundaryPlan = planTableFillBoundaryStaging_ACU({
                    runKind: 'manual_catch_up',
                    runId,
                    chatKey: currentChatFileIdentifier_ACU,
                    isolationKey,
                    targetSheetKeys: selectedSheetKeys,
                    templateFingerprint,
                    messageIndices: allPendingIndices,
                    fullCheckpointIndices: [anchorPreflight.checkpointMessageIndex],
                });
            } catch (error: any) {
                return {
                    success: false,
                    outcome: 'blocked',
                    error: `跨 full checkpoint 追平规划失败：${error?.message || String(error)}`,
                    catchUpPlan: plan,
                    committedBucketCount: 0,
                    dataCommitted: false,
                    diagnosticCode: 'staging_plan_failed',
                };
            }
            stagingRun = createTableFillStagingRunContext_ACU({
                runId,
                chatKey: boundaryPlan.scope.chatKey,
                isolationKey: boundaryPlan.scope.isolationKey,
                targetSheetKeys: boundaryPlan.scope.targetSheetKeys,
                originalFullIndex: boundaryPlan.scope.originalFullIndex,
                originalFullFingerprint: readOriginalFullFrameFingerprint_ACU(
                    liveChat,
                    isolationKey,
                    anchorPreflight.checkpointMessageIndex,
                ),
                templateFingerprint,
            });
            stagingSession = createTableFillStagingSession_ACU(stagingRun);
            logDebug_ACU(`[手动追平] 已冻结跨根 staging scope：runId=${runId}, originalFull=${anchorPreflight.checkpointMessageIndex}, preBoundary=${boundaryPlan.preBoundaryIndices.length}。`);
        }
    }

    // 最终准入（第二次复检）：锚点预检/staging scope 冻结都是异步边界，
    // 等待期间 runtime 可能被 purge 或表集合变化。紧邻 AI 调用与 bucket 写入再次核对。
    // staging 只是 run 级内存状态（未写任何聊天帧），二检阻断直接丢弃 staging 返回，
    // 不遗留任何持久化拓扑改写，无需 rollback。
    if (options.executionSnapshot !== undefined) {
        if (!runtimeSheetKeysMatchSnapshot_ACU(executionSnapshot)) {
            logWarn_ACU('[手动追平] runtime 在 AI 调用前一刻变化，已阻止执行（快照未匹配）。');
            stagingRun = null;
            boundaryPlan = null;
            logWarn_ACU('[手动追平] runtime 变化阻断：已丢弃 run 级 staging，未遗留任何持久化改写。');
            return {
                success: false,
                outcome: 'blocked',
                error: '表格运行时在确认期间发生变化，已取消本次追平，请重新确认目标。',
                catchUpPlan: plan,
                committedBucketCount: 0,
                dataCommitted: false,
                replayVerified: false,
                terminalProgressSaved: false,
                diagnosticCode: 'catch_up_runtime_changed_after_confirmation',
            };
        }
    }

    const maxConcurrentGroups = Math.max(1, Math.trunc(Number(settings_ACU.maxConcurrentGroups) || 1));
    const totalBuckets = plan.waves.reduce((count, wave) => {
        let waveBuckets = 0;
        for (let start = 0; start < wave.groups.length; start += maxConcurrentGroups) {
            waveBuckets += countCatchUpChunkBuckets_ACU(wave.groups.slice(start, start + maxConcurrentGroups), wave.messageIndices);
        }
        return count + waveBuckets;
    }, 0);
    let committedBucketCount = 0;
    let activeWaveIndex = 0;
    let lastCommittedBucketTargetIndex: number | null = null;
    const completedSheetMessageIndexByKey: Record<string, number> = {};
    const allContextMessageIndices = [...new Set(plan.waves.flatMap(wave => wave.messageIndices))].sort((left, right) => left - right);
    const originalStartMessageIndex = plan.waves[0]?.messageIndices[0] ?? plan.targetMessageIndex ?? 0;
    const terminalTargetMessageIndex = plan.targetMessageIndex ?? allContextMessageIndices[allContextMessageIndices.length - 1] ?? 0;
    const catchUpBatchSize = Math.max(1, ...plan.waves.flatMap(wave => wave.groups.map(group => group.batchSize)));
    const buildCatchUpProgress = (
        status: ManualRefillProgressV2_ACU['status'],
        lastError?: string,
    ): ManualRefillProgressV2_ACU => {
        const completedMessageIndices = Object.values(completedSheetMessageIndexByKey);
        return {
            kind: 'manual_refill',
            version: 2,
            status,
            selectedSheetKeys,
            contextMessageIndices: allContextMessageIndices,
            originalStartMessageIndex,
            targetMessageIndex: terminalTargetMessageIndex,
            batchSize: catchUpBatchSize,
            completedUntilMessageIndex: completedMessageIndices.length > 0
                ? Math.max(...completedMessageIndices)
                : Math.max(0, originalStartMessageIndex - 1),
            completedSheetMessageIndexByKey: { ...completedSheetMessageIndexByKey },
            runId,
            mode: 'catch_up',
            targetAiFloor: plan.targetAiFloor,
            planSignature: plan.planSignature,
            waveIndex: Math.min(activeWaveIndex, Math.max(0, plan.waves.length - 1)),
            bucketIndex: Math.max(0, committedBucketCount - 1),
            totalWaves: plan.waves.length,
            totalBuckets,
            ...(lastError ? { lastError } : {}),
            updatedAt: Date.now(),
        };
    };
    const resolveSafeTerminalTargetMessageIndex = (): number | undefined => {
        const liveChat = getChatArray_ACU() || [];
        const isolationKey = getCurrentIsolationKey_ACU();
        const targetCandidates = [terminalTargetMessageIndex, lastCommittedBucketTargetIndex]
            .filter((value): value is number => Number.isInteger(value) && value >= 0)
            .filter((value, index, values) => values.indexOf(value) === index);
        return targetCandidates.find(targetIndex =>
            hasAnyV2Checkpoint_ACU(liveChat, isolationKey, targetIndex),
        );
    };
    const verifyCommittedCatchUpReplay = async (): Promise<{ error?: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] }> => {
        // 不能用内存 runtime 作为验收依据：bucket 的唯一交付物是聊天中的 V2 frame。
        // 在终态前从 live chat 做 bounded replay，并用结果回写运行时视图，确保 UI 不会继续
        // 展示仅存在于内存的假数据。
        const safeTargetMessageIndex = resolveSafeTerminalTargetMessageIndex();
        if (safeTargetMessageIndex === undefined) {
            return {
                error: '手动追平提交后未找到可见 full checkpoint，无法验证 V2 replay。',
                diagnosticCode: 'replay_anchor_missing',
            };
        }
        try {
            const replay = await loadTableStateFromFramesV2Detailed_ACU(getChatArray_ACU(), getCurrentIsolationKey_ACU(), {
                maxMessageIndex: safeTargetMessageIndex,
                updateRuntimeState: false,
            });
            if (hasStructuralReplayCompatibilityRepairs_ACU(replay?.compatibilityRepairs)) {
                const affectedSheetKeys = [...new Set((replay.compatibilityRepairs || []).map(item => item.sheetKey))];
                return {
                    error: `V2 replay 存在结构性兼容修复：${affectedSheetKeys.join('、') || '未知 Sheet'}。请先执行恢复收敛。`,
                    diagnosticCode: 'replay_requires_checkpoint_convergence',
                };
            }
            const replayData = replay?.data as Record<string, any> | undefined;
            const missingSheetKeys = selectedSheetKeys.filter(sheetKey => !replayData?.[sheetKey]);
            if (!replayData || missingSheetKeys.length > 0) {
                return {
                    error: `V2 replay 未恢复所选表：${missingSheetKeys.join('、') || '无可用回放数据'}。`,
                    diagnosticCode: 'replay_missing_selected_sheet',
                };
            }
            // 存在 sheet 只证明锚点可见，不证明本轮 bucket 的 operations 真正进入可回放
            // 时间线。对运行时产生的数据内容逐表比对，防止“有表头但本轮数据被最后 checkpoint
            // 跳过”的伪成功。
            const replayMismatchSheetKeys = selectedSheetKeys.filter(sheetKey =>
                JSON.stringify(replayData[sheetKey]?.content)
                !== JSON.stringify((currentJsonTableData_ACU as Record<string, any> | null)?.[sheetKey]?.content),
            );
            if (replayMismatchSheetKeys.length > 0) {
                return {
                    error: `V2 replay 与本轮已提交数据不一致：${replayMismatchSheetKeys.join('、')}。`,
                    diagnosticCode: 'replay_data_mismatch',
                };
            }
            _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(replayData)));
            return {};
        } catch (error: any) {
            return {
                error: error?.message || String(error || 'V2 replay 验证失败。'),
                diagnosticCode: 'replay_failed',
            };
        }
    };
    const persistCatchUpTerminalProgress = async (
        status: 'complete' | 'stopped' | 'failed' | 'sync_pending',
        lastError?: string,

    ): Promise<string | undefined> => {
        try {
            // terminal progress 是纯 metadata，必须写在当前 live chat 中能看到 full
            // checkpoint 的楼层。优先计划终点；聊天在运行期间变化时才退回最后一个已严格
            // 提交的 bucket，绝不能向无锚点楼层发起一次注定失败的写入。
            const isolationKey = getCurrentIsolationKey_ACU();
            const safeTargetMessageIndex = resolveSafeTerminalTargetMessageIndex();
            if (safeTargetMessageIndex === undefined) {
                return `手动追平终态 ${status} 未找到可见 full checkpoint。`;
            }
            const progress = buildCatchUpProgress(status, lastError);
            const commitResult = await runTableUpdateCommit_ACU({
                source: 'manual_fill',
                reason: `orchestrateManualCatchUp:terminal:${status}`,
                isolationKey,
                writeSet: buildWriteSetForSheetKeys_ACU(selectedSheetKeys, currentJsonTableData_ACU),
                revisionWriteSet: [],
                workingDataMode: 'none',
                initialData: currentJsonTableData_ACU,
                targetMessageIndex: safeTargetMessageIndex,
                targetSheetKeys: [],
                updateGroupKeys: [],
                trackingSheetKeys: [],
                trackAsUpdate: false,
                operations: [],
                manualRefillProgress: progress,
                strictSave: true,
            }, () => ({
                success: true,
                tableData: currentJsonTableData_ACU,
            }));
            return commitResult.success ? undefined : (commitResult.error || `手动追平终态 ${status} 保存失败。`);
        } catch (error: any) {
            return error?.message || String(error || `手动追平终态 ${status} 保存异常。`);
        }
    };
    // 跨根 staging 收敛：有 staging 快照且有已提交 bucket 则 boundary commit 原子汇合
    // （sheet_rebase 到原 full 根）；零 staging 或零提交则丢弃 staging（不写任何聊天帧）。
    // 只用于正常收尾与 stopped/failed 路径（计划阶段 7：终态必须在收敛后写入）。
    const settleStagingBoundary = async (): Promise<{ ok: true } | { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] }> => {
        if (!boundaryPlan || boundaryCommitted) return { ok: true };
        if (!stagingRun || stagingRun.overlay.stagedBucketCount === 0) {
            // 零提交：staging 只是内存状态，直接丢弃，不产生任何持久化改写。
            boundaryCommitted = true;
            await stagingSession?.discard();
            return { ok: true };
        }
        const originalFullIndex = boundaryPlan.scope.originalFullIndex;
        if (originalFullIndex === null) {
            boundaryCommitted = true;
            await stagingSession?.discard();
            return { ok: true };
        }
        const settleResult = await settleStagedBoundaryAndPublish_ACU(stagingRun, originalFullIndex, stagingSession);
        if (!settleResult.ok) return settleResult;
        boundaryCommitted = true;
        stagingSession = null;
        return { ok: true };
    };
    const refreshCommittedDataBeforeExit = async (): Promise<void> => {
        if (committedBucketCount <= 0) return;
        try {
            await refreshData();
        } catch (error) {
            logWarn_ACU('[手动追平] 已提交 bucket 保留成功，但失败/终止后的最终刷新未完成。', error);
        }
    };
    _set_isAutoUpdatingCard_ACU(true);

    try {
        for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex += 1) {
            activeWaveIndex = waveIndex;
            if (options.abortController?.signal.aborted) {
                // 终态不变量：stopped 只能在 staging 已汇合或丢弃后写入。
                // abort 时先收敛 staging（有 staging 则汇合、零 staging 则丢弃），
                // 收敛失败则不写终态，直接返回 integrity_failed。
                const settleResult = await settleStagingBoundary();
                if (!settleResult.ok) {
                    const settleError = (settleResult as { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] });
                    return {
                        success: false, outcome: 'integrity_failed',
                        error: `跨根 staging 收敛失败：${settleError.error}`,
                        committedBucketCount, catchUpPlan: plan,
                        dataCommitted: committedBucketCount > 0,
                        replayVerified: false,
                        terminalProgressSaved: false,
                        diagnosticCode: settleError.diagnosticCode ?? 'boundary_commit_failed',
                    };
                }
                const terminalError = await persistCatchUpTerminalProgress('stopped', '手动追平已终止。');
                await refreshCommittedDataBeforeExit();
                return {
                    success: false, outcome: 'stopped',
                    error: terminalError ? `手动追平已终止；终态进度保存失败：${terminalError}` : '手动追平已终止。',
                    committedBucketCount, catchUpPlan: plan,
                    dataCommitted: committedBucketCount > 0,
                    replayVerified: false,
                    terminalProgressSaved: !terminalError,
                };
            }
            const wave = plan.waves[waveIndex];
            // 跨 full checkpoint 边界汇合：wave 的 messageIndices 是连续 AI 楼层切片，
            // 可能同时跨越原 full 边界两侧。用共享分段器拆成边界前/后两段：
            // 边界前段走 stage_only（run 级隔离 staging，不写聊天 V2 frame），
            // 在首个边界后段前 boundary commit 原子汇合（sheet_rebase 到原根），
            // 边界后段恢复普通 persist（target >= originalFull 放行）。
            const originalFullIndex = boundaryPlan?.scope.originalFullIndex ?? null;
            const isBoundaryActive = originalFullIndex !== null && !boundaryCommitted;
            const fullMessageIndexSet = new Set<number>(isBoundaryActive ? [originalFullIndex as number] : []);
            const waveSegments: BoundarySegment_ACU[] = splitMessageIndicesAtBoundary_ACU(
                wave.messageIndices,
                originalFullIndex,
                fullMessageIndexSet,
            );
            for (const segment of waveSegments) {
                if (options.abortController?.signal.aborted) {
                    // 终态不变量：stopped 只能在 staging 已汇合或丢弃后写入。
                    // pre-boundary 只丢 staging；post-boundary 保留已提交结果。
                    const settleResult = await settleStagingBoundary();
                    if (!settleResult.ok) {
                        const settleError = (settleResult as { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] });
                        return {
                            success: false, outcome: 'integrity_failed',
                            error: `跨根 staging 收敛失败：${settleError.error}`,
                            committedBucketCount, catchUpPlan: plan,
                            dataCommitted: committedBucketCount > 0,
                            replayVerified: false,
                            terminalProgressSaved: false,
                            diagnosticCode: settleError.diagnosticCode ?? 'boundary_commit_failed',
                        };
                    }
                    const terminalError = await persistCatchUpTerminalProgress('stopped', '手动追平已终止。');
                    await refreshCommittedDataBeforeExit();
                    return {
                        success: false, outcome: 'stopped',
                        error: terminalError ? `手动追平已终止；终态进度保存失败：${terminalError}` : '手动追平已终止。',
                        committedBucketCount, catchUpPlan: plan,
                        dataCommitted: committedBucketCount > 0,
                        replayVerified: false,
                        terminalProgressSaved: !terminalError,
                    };
                }
                const groupChunk = wave.groups.slice(0, wave.groups.length);
                const groups: GroupedRuntimeUpdateGroup_ACU[] = groupChunk.map(group => ({
                    key: group.key,
                    groupId: group.groupId,
                    indices: [...segment.indices],
                    batchSize: group.batchSize,
                    sheetKeys: [...group.sheetKeys],
                    requestOptions: group.requestOptions,
                    mergeBaseMaxMessageIndex: segment.mergeBaseMaxMessageIndex,
                }));
                // 首个边界后段提交前收敛 staging：边界前段已完成（或本 wave 直接起于边界后，
                // 前序 wave 已完成），有 staging 快照则把累计结果原子折叠回原根
                // （sheet_rebase），零 staging 则丢弃（不写任何聊天帧）。随后边界后段在
                // 正式根上普通写入。不能内联假设 staging 非空：边界前段可能被模板过滤
                // 导致零提交，直接把空快照 rebase 进原根是数据丢失。
                if (isBoundaryActive && segment.indices[0] >= originalFullIndex!) {
                    const settleResult = await settleStagingBoundary();
                    if (!settleResult.ok) {
                        const settleError = (settleResult as { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] });
                        const terminalError = await persistCatchUpTerminalProgress('failed', `跨根 staging 汇合失败：${settleError.error}`);
                        await refreshCommittedDataBeforeExit();
                        return {
                            success: false,
                            outcome: 'integrity_failed',
                            error: terminalError ? `跨根 staging 汇合失败：${settleError.error}；终态进度保存失败：${terminalError}` : `跨根 staging 汇合失败：${settleError.error}`,
                            committedBucketCount,
                            catchUpPlan: plan,
                            dataCommitted: committedBucketCount > 0,
                            replayVerified: false,
                            terminalProgressSaved: !terminalError,
                            diagnosticCode: settleError.diagnosticCode ?? 'boundary_commit_failed',
                        };
                    }
                    logDebug_ACU(`[手动追平] 跨根 staging 已${boundaryCommitted ? '汇合回原根' : '丢弃'}：originalFull=${originalFullIndex}。`);
                }
                const isPreBoundarySegment = isBoundaryActive && segment.indices[0] < originalFullIndex!;
                const result = await processGroupedRuntimeChunk_ACU(groups, 'manual_independent', {
                    abortController: options.abortController,
                    respectGlobalStop: false,
                    manualCatchUpRun: true,
                    ...(isPreBoundarySegment ? { commitMode: 'stage_only' as const, stagingSession: stagingSession || undefined } : {}),
                    replaceExistingIncremental: true,
                    syncAfterCommit: false,
                    onProgress: event => options.onProgress?.({
                        ...event,
                        currentBatch: committedBucketCount + (event.currentBatch || 1),
                        totalBatches: totalBuckets,
                    }),
                    buildManualRefillProgress: bucket => {
                        const nextCompletedSheetMessageIndexByKey = { ...completedSheetMessageIndexByKey };
                        bucket.sheetKeys.forEach(sheetKey => {
                            nextCompletedSheetMessageIndexByKey[sheetKey] = bucket.saveTargetIndex;
                        });
                        return {
                            kind: 'manual_refill',
                            version: 2,
                            status: 'committed',
                            selectedSheetKeys,
                            contextMessageIndices: [...wave.messageIndices],
                            originalStartMessageIndex: wave.messageIndices[0],
                            targetMessageIndex: plan.targetMessageIndex ?? bucket.saveTargetIndex,
                            batchSize: Math.max(...wave.groups.map(group => group.batchSize)),
                            completedUntilMessageIndex: bucket.saveTargetIndex,
                            completedSheetMessageIndexByKey: nextCompletedSheetMessageIndexByKey,
                            runId,
                            mode: 'catch_up',
                            targetAiFloor: plan.targetAiFloor,
                            planSignature: plan.planSignature,
                            waveIndex,
                            bucketIndex: committedBucketCount + bucket.committedBucketCount,
                            totalWaves: plan.waves.length,
                            totalBuckets,
                            updatedAt: Date.now(),
                        };
                    },
                    onBucketCommitted: bucket => {
                        bucket.sheetKeys.forEach(sheetKey => {
                            completedSheetMessageIndexByKey[sheetKey] = bucket.saveTargetIndex;
                        });
                        lastCommittedBucketTargetIndex = bucket.saveTargetIndex;
                    },
                });
                committedBucketCount += result.committedBucketCount;
                if (!result.success) {
                    const outcome = result.aborted ? 'stopped' : undefined;
                    const primaryError = result.error || (result.aborted ? '手动追平已终止。' : '手动追平失败。');
                    // 终态不变量：stopped/failed 只能在 staging 已汇合或丢弃后写入。
                    // 已有已提交 bucket 时先收敛 staging；收敛失败则返回 integrity_failed，不写误导性终态。
                    const settleResult = await settleStagingBoundary();
                    if (!settleResult.ok) {
                        const settleError = (settleResult as { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] });
                        return {
                            success: false,
                            outcome: 'integrity_failed',
                            error: `${primaryError}；跨根 staging 收敛失败：${settleError.error}`,
                            committedBucketCount,
                            catchUpPlan: plan,
                            dataCommitted: committedBucketCount > 0,
                            replayVerified: false,
                            terminalProgressSaved: false,
                            diagnosticCode: settleError.diagnosticCode ?? 'boundary_commit_failed',
                        };
                    }
                    const terminalError = await persistCatchUpTerminalProgress(result.aborted ? 'stopped' : 'failed', primaryError);
                    await refreshCommittedDataBeforeExit();
                    return {
                        success: false,
                        outcome,
                        error: terminalError ? `${primaryError}；终态进度保存失败：${terminalError}` : primaryError,
                        committedBucketCount,
                        catchUpPlan: plan,
                        dataCommitted: committedBucketCount > 0,
                        replayVerified: false,
                        terminalProgressSaved: !terminalError,
                    };
                }
            }
            await loadAllChatMessages_ACU();
        }

        // 跨根 staging 收尾：wave 循环结束后 staging 仍活跃（所有目标都早于原 full
        // 边界，未触发循环内汇合）时，必须把已提交成果原子汇合回原根；零 staging 则
        // 丢弃。这是 run 的正常终态，staging 只是内存状态，不会遗留持久化改写。
        if (boundaryPlan && !boundaryCommitted) {
            const settleResult = await settleStagingBoundary();
            if (!settleResult.ok) {
                const settleError = (settleResult as { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] });
                return {
                    success: false,
                    outcome: 'integrity_failed',
                    error: `跨根 staging 收敛失败：${settleError.error}`,
                    committedBucketCount,
                    catchUpPlan: plan,
                    dataCommitted: committedBucketCount > 0,
                    replayVerified: false,
                    terminalProgressSaved: false,
                    diagnosticCode: settleError.diagnosticCode ?? 'boundary_commit_failed',
                };
            }
            logDebug_ACU(`[手动追平] 跨根 staging 收尾${boundaryCommitted ? '汇合' : '丢弃'}完成：originalFull=${boundaryPlan.scope.originalFullIndex}。`);
        }

        const replayVerification = await verifyCommittedCatchUpReplay();
        if (replayVerification.error) {
            // 任何 bucket 在内存中的成功都不足以证明已交付。回放失败后不能继续刷新世界书，
            // 更不能写 complete/failed progress 掩盖不可验证的持久化状态。
            let reloadError: string | undefined;
            try {
                const reloadResult = await reloadStorageProvider();
                if (!reloadResult.ok) {
                    reloadError = reloadResult.error || reloadResult.failureCode || '存储运行时重载未完成。';
                }
            } catch (error: any) {
                reloadError = error?.message || String(error || '存储运行时重载异常。');
            }
            return {
                success: false,
                outcome: 'integrity_failed',
                error: `手动追平持久化完整性校验失败：${replayVerification.error}${reloadError ? `；聊天状态回载失败：${reloadError}` : '；已从聊天持久化状态回载运行时。'}`,
                committedBucketCount,
                dataCommitted: committedBucketCount > 0,
                replayVerified: false,
                terminalProgressSaved: false,
                diagnosticCode: replayVerification.diagnosticCode,
                catchUpPlan: plan,
            };
        }

        const refreshResult = await refreshData();
        if (refreshResult && refreshResult.degraded === true) {
            const terminalError = await persistCatchUpTerminalProgress('sync_pending');
            if (terminalError) {
                return {
                    // 世界书同步已经明确处于待重试状态；terminal progress 同样只是恢复
                    // 辅助元数据，不能把已提交的表数据误报成失败。
                    success: true,
                    outcome: 'progress_metadata_failed',
                    error: `手动追平数据已提交且世界书同步待重试，但终态进度保存失败：${terminalError}`,
                    committedBucketCount,
                    dataCommitted: committedBucketCount > 0,
                    replayVerified: true,
                    terminalProgressSaved: false,
                    catchUpPlan: plan,
                };
            }
            return {
                success: true,
                outcome: 'sync_pending',
                committedBucketCount,
                dataCommitted: committedBucketCount > 0,
                replayVerified: true,
                terminalProgressSaved: true,
                catchUpPlan: plan,
            };
        }
        const terminalError = await persistCatchUpTerminalProgress('complete');
        if (terminalError) {
            return {
                // bucket 已严格提交并完成最终刷新；终态进度是恢复辅助元数据，失败不能
                // 反向篡改“表数据已提交”的事实。
                success: true,
                outcome: 'progress_metadata_failed',
                error: `手动追平数据与世界书同步已完成，但终态进度保存失败：${terminalError}`,
                committedBucketCount,
                dataCommitted: committedBucketCount > 0,
                replayVerified: true,
                terminalProgressSaved: false,
                catchUpPlan: plan,
            };
        }
        return { success: true, outcome: 'complete', committedBucketCount, dataCommitted: committedBucketCount > 0, replayVerified: true, terminalProgressSaved: true, catchUpPlan: plan };
    } catch (error: any) {
        const primaryError = error?.message || String(error || '手动追平执行异常。');
        // 终态不变量：failed 只能在 staging 已汇合或丢弃后写入。
        // 异常路径同样先收敛 staging；收敛失败则返回 integrity_failed，不写误导性 failed 终态。
        const settleResult = await settleStagingBoundary();
        if (!settleResult.ok) {
            const settleError = (settleResult as { ok: false; error: string; diagnosticCode?: ManualUpdateResult['diagnosticCode'] });
            return {
                success: false,
                error: `${primaryError}；跨根 staging 收敛失败：${settleError.error}`,
                committedBucketCount,
                catchUpPlan: plan,
                dataCommitted: committedBucketCount > 0,
                replayVerified: false,
                terminalProgressSaved: false,
                diagnosticCode: settleError.diagnosticCode ?? 'boundary_commit_failed',
            };
        }
        const terminalError = await persistCatchUpTerminalProgress('failed', primaryError);
        await refreshCommittedDataBeforeExit();
        return {
            success: false,
            error: terminalError ? `${primaryError}；终态进度保存失败：${terminalError}` : primaryError,
            committedBucketCount,
            catchUpPlan: plan,
            dataCommitted: committedBucketCount > 0,
            replayVerified: false,
            terminalProgressSaved: !terminalError,
        };
    } finally {
        _set_isAutoUpdatingCard_ACU(false);
    }
}

/**
 * 手动重填锚点健康检查 + 自动收敛（无 UI，仅后台日志）。
 *
 * 两类死锁形态同族处理：
 * - 多根：同一隔离键存在 >=2 个 full checkpoint，回放只认最后一个，之前增量全部失效；
 * - 零根有帧：存在 V2 storage frame 但没有任何 full/transition checkpoint 锚点，
 *   persist 层会 fail-closed 拒绝隐式 migration checkpoint（先烧完 AI 费用才撞墙）。
 *
 * 命中任一形态时调用 V2 恢复服务：requiresConfirmation=false 的恢复计划（冗余根收敛、
 * recoveryBackup 重建、full 修复候选）自动 prepare+commit，成功后重跑健康检查；
 * 计划缺失、需人工确认（无锚点 data_replace 提升无法证明不截断数据）或提交失败
 * 则维持阻断并返回原始违规描述。
 */
async function ensureManualRefillAnchorHealth_ACU(
    liveChat: any[],
    isolationKey: string,
    options: { checkZeroRoot: boolean },
): Promise<{ blockedError: string | null; healed: boolean }> {
    const healthViolation = (chat: any[]): string | null => {
        const multiRoot = assertSingleActiveFullCheckpointV2_ACU(chat, isolationKey, 'orchestrateManualUpdate:anchor_preflight');
        if (multiRoot) return multiRoot;
        // 零根检测只针对增量重填：clearBeforeUpdate 路径清理后会自行补写单表快照/模板
        // 临时根（零根是其合法中间态），增量路径则会在 persist 层撞隐式 migration 拒绝。
        if (!options.checkZeroRoot) return null;
        const hasFrames = chat.some(message => message && !message.is_user && isV2TagData_ACU(readIsolatedTagData_ACU(message, isolationKey)));
        if (hasFrames && !hasAnyV2Checkpoint_ACU(chat, isolationKey)) {
            return 'V2 orchestrateManualUpdate:anchor_preflight 检测到零根状态：该隔离键存在 V2 storage frame 但没有任何 full checkpoint 锚点，persist 层将拒绝隐式 migration checkpoint。';
        }
        return null;
    };
    const initialViolation = healthViolation(liveChat);
    if (!initialViolation) return { blockedError: null, healed: false };
    logWarn_ACU('[ManualUpdate] 锚点预检发现异常，尝试自动收敛：', initialViolation);
    try {
        const summary = await prepareV2Recovery_ACU({ chat: liveChat, isolationKey });
        if (!summary.planId || summary.requiresConfirmation) {
            logWarn_ACU('[ManualUpdate] 锚点自动收敛不可行（无恢复计划或需人工确认）：', summary.status, summary.message);
            return { blockedError: `手动重填被锚点预检阻断：${initialViolation}`, healed: false };
        }
        const commitResult = await commitPreparedV2Recovery_ACU(summary.planId);
        if (commitResult.status !== 'committed') {
            logWarn_ACU('[ManualUpdate] 锚点自动收敛提交失败：', commitResult.error || commitResult.status);
            return { blockedError: `手动重填被锚点预检阻断：${initialViolation}`, healed: false };
        }
        logWarn_ACU('[ManualUpdate] 锚点自动收敛完成：', summary.message);
    } catch (error) {
        logWarn_ACU('[ManualUpdate] 锚点自动收敛异常：', error);
        return { blockedError: `手动重填被锚点预检阻断：${initialViolation}`, healed: false };
    }
    const postViolation = healthViolation(getChatArray_ACU());
    if (postViolation) return { blockedError: `手动重填被锚点预检阻断（自动收敛后仍未通过）：${postViolation}`, healed: false };
    return { blockedError: null, healed: true };
}

/**
 * 手动更新编排（纯业务逻辑）
 * 从 handleManualUpdate_ACU 提取。不驱动 UI，只返回结果。
 * presentation 层负责：收集 manualSelection、设置 manualExtraHint、刷新 UI、显示 toast、弹出确认框。
 *
 * @param targetKeys 手动选择的目标表格键列表
 * @param processBatch 批处理执行回调
 * @param refreshData 数据刷新回调
 * @param options 可选参数：
 *   - clearBeforeUpdate: 兼容旧调用名；启用事务式手动重填。普通可回放路径按 bucket 原子替换历史增量；仅跨 checkpoint 特例会预清理并等待最终 snapshot。
 */
export async function orchestrateManualUpdate_ACU(
    targetKeys: string[],
    processBatch: (indices: number[], mode: string, options: any) => Promise<BatchUpdateResult>,
    refreshData: () => Promise<void>,
    options: {
        clearBeforeUpdate?: boolean;
        onProgress?: (event: CardUpdateProgressEvent) => void;
        /**
         * UI 确认前的 runtime 键快照（可选）。
         * 提供时，orchestrator 在破坏性清理（clearManualRefillSheetDataInRange_ACU）
         * 之前重新校验当前 runtime 与快照的一致性；runtime 若在确认期间被 purge
         * 或表集合变化，直接 fail-closed 阻断，防止对已失效目标执行破坏性重填。
         */
        executionSnapshot?: { sheetKeys: string[] };
    } = {},
): Promise<ManualUpdateResult> {
    let committedBucketCount = 0;
    // 跨根 staging 作用域（仅 manualRefillEnabled 且跨根时启用；提升到函数级以便
    // chunk 循环内 settle 与收尾共用）。non-null 断言仅在 requiresBoundaryStaging
    // 分支内使用，普通路径保持 null。
    let boundaryPlan: TableFillBoundaryStagingPlan_ACU | null = null;
    let stagingRun: TableFillStagingRunContext_ACU | null = null;
    let stagingSession: TableFillStagingSession_ACU | null = null;
    let boundaryCommitted = false;
    // 破坏性清理是否已开始：清理一旦开始即不可逆（失败不回滚、不恢复已删数据），
    // 后续任何失败都必须走 failManualRefillSession 对齐运行时，而不是裸抛。
    let refillCleanupStarted = false;
    // 手动重填失败语义（计划 §5.5 / §5.6，已删除旧 snapshot/rollback 机制）：
    // 破坏性清理不可逆，失败绝不回滚、绝不恢复已删数据；已提交的 bucket 成果保留，
    // 仅按聊天记录里的已提交事实重新对齐运行时快照，避免界面显示与持久化不一致。
    // 手动追平/自动填表路径的 staging 汇合失败会自行返回 integrity_failed，不在此回滚。
    const failManualRefillSession = async (failureError: string): Promise<ManualUpdateResult> => {
        // 清理失败或 bucket 失败后：运行时快照可能停在中间态，必须按聊天记录里的
        // 已提交事实重新同步，否则界面会显示与持久化结果不一致的数据。
        // 不回滚、不恢复已删数据；已提交成果保留。
        try {
            await loadAllChatMessages_ACU();
            await refreshData();
        } catch (refreshError) {
            logWarn_ACU('[Manual Refill] 失败后刷新运行时数据失败:', refreshError);
        }
        return {
            success: false,
            error: failureError,
        };
    };
    // 跨根 staging 汇合：边界前 bucket 只进入 run 级 staging（不写聊天 V2 frame），
    // 到达原 full 边界时把累计目标表快照原子折叠为原根的 sheet_rebase（正式根），
    // 边界后段恢复普通逐 bucket 持久化。零 staging 则直接丢弃（不写任何聊天帧）。
    const settleStagingBoundary = async (): Promise<{ ok: true } | { ok: false; error: string; diagnosticCode?: string }> => {
        if (!boundaryPlan || boundaryCommitted) return { ok: true };
        if (!stagingRun || stagingRun.overlay.stagedBucketCount === 0) {
            boundaryCommitted = true;
            await stagingSession?.discard();
            return { ok: true };
        }
        const fullIndex = boundaryPlan.scope.originalFullIndex;
        if (fullIndex === null) {
            boundaryCommitted = true;
            await stagingSession?.discard();
            return { ok: true };
        }
        const settleResult = await settleStagedBoundaryAndPublish_ACU(stagingRun, fullIndex, stagingSession);
        if (!settleResult.ok) return settleResult;
        boundaryCommitted = true;
        stagingSession = null;
        return { ok: true };
    };

    try {
        if (isAutoUpdatingCard_ACU) {
            return { success: false, error: '数据库更新正在进行中，请稍候...' };
        }

        if (!coreApisAreReady_ACU) {
            return { success: false, error: 'API未就绪。' };
        }

        const apiIsConfigured = (settings_ACU.apiMode === 'custom' && (settings_ACU.apiConfig.useMainApi || (settings_ACU.apiConfig.url && settings_ACU.apiConfig.model))) || (settings_ACU.apiMode === 'tavern' && settings_ACU.tavernProfile);
        if (!apiIsConfigured) {
            return { success: false, error: 'API未配置，无法更新数据库。' };
        }

        await loadAllChatMessages_ACU();
        await refreshData();

        if (!currentJsonTableData_ACU) {
            return { success: false, error: '数据库未加载。' };
        }
        const liveChat = getChatArray_ACU();
        if (!liveChat || liveChat.length === 0) {
            return { success: false, error: '聊天记录为空，无法更新。' };
        }

        const allAiMessageIndices = liveChat
            .map((msg: any, index: number) => !msg.is_user ? index : -1)
            .filter((index: number) => index !== -1);

        if (allAiMessageIndices.length === 0) {
            return { success: false, error: '尚未检测到AI回复，无法执行手动更新。' };
        }

        if (!targetKeys.length) {
            return { success: false, error: '未选择需要更新的表格。' };
        }

        // 锚点预检（健康检查 + 自动收敛）：多根 / 零根有帧两类死锁形态在首次 AI 调用
        // （processBatch）前先尝试用 V2 恢复服务自动收敛（requiresConfirmation=false 才
        // 自动执行）；无法自愈才阻断，避免先付完 AI 费用才撞 persist 层 fail-fast。
        const preflightIsolationKey = getCurrentIsolationKey_ACU();
        const anchorHealth = await ensureManualRefillAnchorHealth_ACU(liveChat, preflightIsolationKey, {
            checkZeroRoot: options.clearBeforeUpdate !== true,
        });
        if (anchorHealth.blockedError) {
            return { success: false, error: anchorHealth.blockedError };
        }
        if (anchorHealth.healed) {
            // 自动收敛可能改变回放输出（如 recoveryBackup 重建根），重填基线必须基于收敛后状态。
            await refreshData();
            if (!currentJsonTableData_ACU) {
                return { success: false, error: '锚点自动收敛后数据库未能重新加载。' };
            }
        }

        const uiThreshold = settings_ACU.autoUpdateThreshold || 3;
        const uiBatchSize = settings_ACU.updateBatchSize || 3;
        const uiSkip = settings_ACU.skipUpdateFloors || 0;

        const effectiveAiIndices = uiSkip > 0 ? allAiMessageIndices.slice(0, -uiSkip) : allAiMessageIndices.slice();
        const contextScopeIndices = uiThreshold > 0 ? effectiveAiIndices.slice(-uiThreshold) : effectiveAiIndices;

        if (!contextScopeIndices.length) {
            return { success: false, error: '未找到可用的上下文进行手动更新，请检查阈值或跳过楼层设置。' };
        }

        const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true }) || {};
        const updateGroups: Record<string, ManualRuntimeUpdateGroup_ACU> = {};
        const presetGroupSlots = new Map<string, number>();
        targetKeys.forEach((sheetKey: string) => {
            const tableConfig = templateData?.[sheetKey]?.updateConfig || {};
            const tableName = templateData?.[sheetKey]?.name || currentJsonTableData_ACU?.[sheetKey]?.name || '';
            const resolvedPreset = resolveTableApiPresetOverride_ACU(tableName);
            const requestOptions = resolvedPreset ? { tableApiPreset: resolvedPreset } : null;
            const tableGroupId = Number.isFinite(tableConfig?.groupId)
                ? Math.trunc(tableConfig.groupId)
                : -1;
            const presetKey = String(resolvedPreset || '');
            if (!presetGroupSlots.has(presetKey)) {
                presetGroupSlots.set(presetKey, presetGroupSlots.size);
            }
            const presetGroupSlot = presetGroupSlots.get(presetKey)!;
            // updateFrequency/contextDepth/skipFloors 属于自动更新调度参数，不进入手动路径；
            // API preset 属于请求执行契约，不同 preset 必须拆组，禁止静默采用第一张表配置。
            const groupKey = `${tableGroupId}|${contextScopeIndices.join(',')}|${uiBatchSize}|presetSlot:${presetGroupSlot}`;
            if (!updateGroups[groupKey]) {
                updateGroups[groupKey] = {
                    indices: contextScopeIndices,
                    batchSize: uiBatchSize,
                    groupId: tableGroupId,
                    sheetKeys: [],
                    requestOptions,
                };
            }
            updateGroups[groupKey].sheetKeys.push(sheetKey);
        });
        const groupKeys = Object.keys(updateGroups);

        const manualRefillEnabled = options.clearBeforeUpdate === true;
        // 破坏性/普通手动更新前 TOCTOU 复检（service 层最终准入，与 clearBeforeUpdate 无关）：
        // UI 层在调用前已复检一次，但 orchestrator 内部已跨越 loadAllChatMessages/refreshData
        // 等异步边界；runtime 可能在此间被 purge 或表集合变化。显式提供 executionSnapshot
        // 即表示调用方要求保护——无论是否重填路径，都必须在任何 AI 调用/数据写入前再次
        // 核对当前 runtime 与确认前快照，防止对确认后已失效的目标执行更新。
        // 契约：executionSnapshot 未提供（undefined）→ legacy 路径不启用保护；
        // 显式提供（即使 sheetKeys 为空/非法）→ 必须 fail-closed，禁止静默降级。
        const manualUpdateSnapshotKeys = options.executionSnapshot?.sheetKeys;
        if (options.executionSnapshot !== undefined) {
            if (!runtimeSheetKeysMatchSnapshot_ACU(manualUpdateSnapshotKeys)) {
                logWarn_ACU('[Manual Update] runtime 在确认期间变化，已阻止手动更新（快照未匹配）。');
                return { success: false, error: '表格运行时在确认期间发生变化，已取消本次手动填表，请确认后重试。' };
            }
        }
        // 最终 commit 只能消费本次会话开始时解析出的模板，不能在 bucket 已写入后重新读取
        // chat override / profile 全局模板；后者在长事务期间变化会让 fallback 根与本次重填依据脱节。
        const frozenManualRefillTemplateData = manualRefillEnabled
            ? resolveManualRefillTemplateData_ACU(liveChat, getCurrentIsolationKey_ACU())
            : null;
        // 手动填表先无条件清空本次范围内选中表的 checkpoint 与增量，再完全沿用自动填表语义
        // （逐 bucket 取 bucketFirstMessageIndex - 1）解析基底。初始基线保持原位，不做前移。
        if (manualRefillEnabled) {

            const currentIsolationKey = getCurrentIsolationKey_ACU();
            const refillTargetIndex = contextScopeIndices[contextScopeIndices.length - 1];
            // Task 4 破坏性清理前准入：重填会先清空范围内旧数据，若最新 full checkpoint
            // 晚于重填范围末尾，清理后写入目标早于回放根，必然撞 persist 层 fail-fast。
            // 必须在删除任何数据前阻止，避免用户数据先被清空才报错。
            const refillAdmission = assertWriteTargetNotBeforeReplayRoot_ACU({
                chat: liveChat,
                isolationKey: currentIsolationKey,
                targetMessageIndex: refillTargetIndex,
            });
            if (!refillAdmission.allow) {
                logDebug_ACU(`[手动重填准入] 阻断：${refillAdmission.reason}（refillTarget=${refillTargetIndex}, isolationKey=[${currentIsolationKey || '无标签'}]）。`);
                return { success: false, error: `手动重填被回放根准入阻断${refillAdmission.reason}` };
            }

            // 跨根 staging 判定：重填范围首个目标早于原 full checkpoint 时，
            // 中间 bucket 若按普通 persist 写入会撞 persist 层 fail-fast（写目标早于回放根）。
            // 必须改为边界前 stage_only（不写聊天帧）、边界处原子汇合、边界后普通 persist。
            // 例外：清理会删除该 checkpoint 时（全选表且 checkpoint.data 不含其它表），
            // staging 的「原 full 边界」前提在清理后消失，汇合必以 full_checkpoint_root_mismatch
            // fail-closed。此时禁用 staging，改走普通路径 + 清理后临时根前置，由末尾
            // commitManualRefillSheetSnapshotInRangeAtomic_ACU 以既有 fallbackRequired 分支重建根。
            const originalFullIndex = getLatestV2FullCheckpointMessageIndex_ACU(liveChat, currentIsolationKey);
            let requiresBoundaryStaging = originalFullIndex >= 0 && contextScopeIndices.length > 0 && contextScopeIndices[0] < originalFullIndex;
            if (requiresBoundaryStaging && contextScopeIndices.includes(originalFullIndex)) {
                // 原 checkpoint 在重填范围内：检查清理是否会删除它（checkpoint.data 的
                // sheet 键集合是否被 targetKeys 全量覆盖）。
                const originalTag = readIsolatedTagData_ACU(liveChat[originalFullIndex], currentIsolationKey) as any;
                const originalCheckpointData = originalTag?.storageFrame?.checkpoint?.data;
                if (originalCheckpointData && typeof originalCheckpointData === 'object' && !Array.isArray(originalCheckpointData)) {
                    const checkpointSheetKeys = Object.keys(originalCheckpointData).filter(key => key.startsWith('sheet_'));
                    const targetKeySet = new Set(targetKeys);
                    const fullyCoversCheckpoint = checkpointSheetKeys.length > 0 && checkpointSheetKeys.every(key => targetKeySet.has(key));
                    if (fullyCoversCheckpoint) {
                        logDebug_ACU(`[Manual Refill] 原 full checkpoint 位于重填范围内（#${originalFullIndex}）且目标表覆盖其全部数据表，清理将删除该 checkpoint；已禁用跨根 staging，改用清理后临时根前置。`);
                        requiresBoundaryStaging = false;
                    }
                }
            }
            if (requiresBoundaryStaging) {
                const templateFingerprint = getTableDataFingerprint_ACU(parseTableTemplateJson_ACU({ stripSeedRows: true }) || {});
                boundaryPlan = planTableFillBoundaryStaging_ACU({
                    runKind: 'manual_refill',
                    runId: `manual-refill-${Date.now()}`,
                    chatKey: currentChatFileIdentifier_ACU,
                    isolationKey: currentIsolationKey,
                    targetSheetKeys: targetKeys,
                    templateFingerprint,
                    messageIndices: contextScopeIndices,
                    fullCheckpointIndices: [originalFullIndex],
                });
                stagingRun = createTableFillStagingRunContext_ACU({
                    runId: boundaryPlan.scope.runId,
                    chatKey: boundaryPlan.scope.chatKey,
                    isolationKey: boundaryPlan.scope.isolationKey,
                    targetSheetKeys: boundaryPlan.scope.targetSheetKeys,
                    originalFullIndex: boundaryPlan.scope.originalFullIndex,
                    originalFullFingerprint: readOriginalFullFrameFingerprint_ACU(
                        getChatArray_ACU(),
                        currentIsolationKey,
                        originalFullIndex,
                    ),
                    templateFingerprint,
                });
                stagingSession = createTableFillStagingSession_ACU(stagingRun);
                logDebug_ACU(`[Manual Refill] 跨根 staging 已启用：originalFull=${originalFullIndex}, 范围 [${contextScopeIndices[0]}..${contextScopeIndices[contextScopeIndices.length - 1]}]，边界前 bucket 仅写入 staging。`);
            }

            // 重填会先删除持久化增量，不能在 SQLite runtime 尚未 ready 时进入破坏性阶段。
            // native 路径没有 SQLite 后置条件，保持既有行为。
            if (isSqliteMode()) {
                try {
                    await ensureStorageProviderReady_ACU();
                } catch (error: any) {
                    return { success: false, error: `SQLite 运行时未就绪，已阻止重填：${error?.message || String(error)}` };
                }
            }

            // 最终准入（第二次复检）：ensureStorageProviderReady_ACU 也是异步边界，
            // 等待期间 runtime 可能被 purge/表集合变化。必须紧邻破坏性清理再次核对，
            // 覆盖“第一次复检通过 → await provider ready → 清理开始”之间的窗口。
            if (options.executionSnapshot !== undefined) {
                if (!runtimeSheetKeysMatchSnapshot_ACU(manualUpdateSnapshotKeys)) {
                    logWarn_ACU('[Manual Refill] runtime 在清理前一刻变化，已阻止破坏性重填（快照未匹配）。');
                    return { success: false, error: '表格运行时在确认期间发生变化，已取消本次手动填表，请确认后重试。' };
                }
            }

            try {
                // 破坏性清理不可逆：一旦开始，后续任何失败都不回滚、不恢复已删数据。
                refillCleanupStarted = true;
                await clearManualRefillSheetDataInRange_ACU(contextScopeIndices, targetKeys);
            } catch (error: any) {
                logError_ACU('[Manual Refill] 清理本次范围内选中表旧数据失败:', error);
                const failureError = error?.message || '手动重填清理本次范围内选中表旧数据失败。';
                // 清理已部分发生且不可逆：不回滚、不恢复已删数据，直接失败返回。
                return { success: false, error: failureError };
            }
            logDebug_ACU(`[Manual Refill] 已清理 AI 楼层 ${contextScopeIndices.join('、')} 上选中表的 checkpoint 与增量；将在全部重填成功后提交完整单表 checkpoint。`);

            // 手动重填临时根前置：全范围 + 全选表清理会删除范围内唯一整库 full checkpoint，
            // 此后任何 bucket 写入都会命中 persist 层 usesImplicitMigrationCheckpoint 守卫
            // （storage-frame-v2-persist.ts:2208-2215），导致重填永久失败。
            // 在清理后、任何 bucket 写入前，用冻结模板建立 manual_refill_template_root
            // 临时根，让后续写入有合法锚点。末尾 commitManualRefillSheetSnapshotInRangeAtomic_ACU
            // 检测到已有唯一根后走 perSheetCheckpoints rebase 路径，不再重复建根。
            // 若清理后仍有 full checkpoint（部分选表/范围未覆盖），本函数内部判定为 no-op。
            if (manualRefillEnabled && frozenManualRefillTemplateData) {
                const rootEstablish = await establishManualRefillTemplateRoot_ACU({
                    isolationKey: currentIsolationKey,
                    targetSheetKeys: targetKeys,
                    targetMessageIndices: contextScopeIndices,
                    templateData: frozenManualRefillTemplateData,
                });
                if (!rootEstablish.success) {
                    logError_ACU('[Manual Refill] 清理后建立模板临时根失败:', rootEstablish.error);
                    return await failManualRefillSession(rootEstablish.error || '手动重填清理后建立模板临时根失败。');
                }
                if (rootEstablish.changed) {
                    logDebug_ACU(`[Manual Refill] 已在 AI 楼层 #${rootEstablish.targetMessageIndex} 建立模板临时根，后续 bucket 写入将有合法锚点。`);
                }
            }

            try {
                const reloadResult = await reloadStorageProvider();
                if (!reloadResult.ok) {
                    throw new Error(`SQLite runtime 重载未完成: ${reloadResult.failureCode || 'unknown'}${reloadResult.error ? ` (${reloadResult.error})` : ''}`);
                }
            } catch (error: any) {
                logError_ACU('[Manual Refill] 清理后刷新运行时快照失败:', error);
                const failureError = error?.message || '手动重填清理后刷新运行时快照失败。';
                return { success: false, error: failureError };
            }

        }

        // 最终准入（复检）：重填分支内已跨过 ensureStorageProviderReady_ACU / reloadStorageProvider
        // 异步边界，普通路径也跨过 planning 与分组构建；紧邻 AI 调用与 bucket 写入再次核对，
        // 覆盖“首次复检通过 → 所有异步边界 → AI 调用”之间的窗口。显式提供快照即要求保护，
        // 无论是否重填路径，都必须在调用 AI 前 fail-closed。
        // 注意：重填路径执行到这里时，破坏性清理与 reload 已经发生。若 runtime 在此间变化，
        // 直接 return 会绕过 failManualRefillSession，导致“旧数据已清、新数据未写”的净损失。
        // 因此重填路径必须走 failManualRefillSession（不回滚、保留删除，按已提交事实对齐运行时）。
        if (options.executionSnapshot !== undefined) {
            if (!runtimeSheetKeysMatchSnapshot_ACU(manualUpdateSnapshotKeys)) {
                logWarn_ACU('[Manual Update] runtime 在 AI 调用前一刻变化，已阻止手动更新（快照未匹配）。');
                if (manualRefillEnabled) {
                    return await failManualRefillSession('表格运行时在确认期间发生变化，已取消本次手动填表；已清理的数据不可恢复，请确认后重试。');
                }
                return { success: false, error: '表格运行时在确认期间发生变化，已取消本次手动填表，请确认后重试。' };
            }
        }

        _set_isAutoUpdatingCard_ACU(true);
        const maxConcurrentGroups = Math.max(1, Number(settings_ACU.maxConcurrentGroups) || 1);
        const totalChunks = Math.max(1, Math.ceil(groupKeys.length / maxConcurrentGroups));
        const failedGroups: Array<{ key: string; error?: string }> = [];

        logDebug_ACU(`[Manual Update] 分组计划：选中 ${targetKeys.length} 张表，生成 ${groupKeys.length} 个组，最大并发组数 ${maxConcurrentGroups}。`);

        for (let start = 0; start < groupKeys.length; start += maxConcurrentGroups) {
            const chunkIndex = Math.floor(start / maxConcurrentGroups) + 1;
            const chunkKeys = groupKeys.slice(start, start + maxConcurrentGroups);
            const groupedChunk: GroupedRuntimeUpdateGroup_ACU[] = chunkKeys.map((gKey): GroupedRuntimeUpdateGroup_ACU => {
                const group = updateGroups[gKey];
                return {
                    key: gKey,
                    groupId: group.groupId,
                    indices: group.indices,
                    batchSize: group.batchSize,
                    sheetKeys: group.sheetKeys,
                    requestOptions: group.requestOptions,
                };
            });
            logDebug_ACU(`[Manual Update] 并发处理第 ${chunkIndex}/${totalChunks} 批，当前 ${groupedChunk.length} 组：${groupedChunk.map(formatGroupReference_ACU).join('; ')}`);
            options.onProgress?.({
                phase: 'preparing',
                message: `并发处理第 ${chunkIndex}/${totalChunks} 批，当前 ${groupedChunk.length} 组。`,
            });
            try {
                await loadAllChatMessages_ACU();
                if (!manualRefillEnabled && shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()) {
                    const boundaryCheckpoint = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
                    if (!boundaryCheckpoint.success) {
                        failedGroups.push({
                            key: chunkKeys[0] || 'manual_boundary_checkpoint',
                            error: boundaryCheckpoint.error || 'AI 楼层边界 checkpoint 建立失败，已停止手动更新以避免跳楼推进。',
                        });
                        break;
                    }
                }
            } catch (checkpointError: any) {
                logError_ACU('[Manual Update] 继续下一批前同步聊天并建立 AI 楼层边界 checkpoint 异常详情:', checkpointError);
                failedGroups.push({
                    key: chunkKeys[0] || 'manual_boundary_checkpoint',
                    error: checkpointError?.message || 'AI 楼层边界 checkpoint 建立异常，已停止手动更新以避免跳楼推进。',
                });
                break;
            }
            // Task 4 二次准入（boundary checkpoint 后，仅普通手动更新路径）：
            // loadAllChatMessages_ACU 与 ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ save: true }) 可能已把
            // replay root 推进到 bucket 目标之后（现场 target=1/root=69 时序）。这里的
            // bucket 目标由 planning 时的 prompt index 派生，不能直接假定等于刷新后 live
            // chat 的物理索引。必须用「最新」聊天重新解析 root 并对 chunk 内全部目标索引
            // 再次准入；任一目标早于新 root 时，在 AI 调用前结构化阻断（零 token 消耗），
            // 返回 stale_bucket_after_boundary_checkpoint 要求重新 planning。
            // 例外：重填路径（clearBeforeUpdate）不做此处准入——其清理前目标由 refillAdmission
            // （清理前对范围末尾楼层）校验，清理后范围末尾成为新根、bucket 目标天然合法，
            // bucket 内逐 job 准入（processGroupedRuntimeChunkCore_ACU）已不再豁免。
            if (!manualRefillEnabled) {
                const liveChatAfterBoundary = getChatArray_ACU() || [];
                const chunkTargetIndices = [
                    ...new Set(groupedChunk.flatMap(group => group.indices || [])),
                ];
                let staleTarget: number | null = null;
                let staleReason = '';
                for (const targetIndex of chunkTargetIndices) {
                    const admission = assertWriteTargetNotBeforeReplayRoot_ACU({
                        chat: liveChatAfterBoundary,
                        isolationKey: getCurrentIsolationKey_ACU(),
                        targetMessageIndex: targetIndex,
                    });
                    if (!admission.allow) {
                        staleTarget = targetIndex;
                        staleReason = admission.reason;
                        break;
                    }
                }
                if (staleTarget !== null) {
                    logWarn_ACU(`[Manual Update] 边界 checkpoint 后写目标已陈旧，已阻止第 ${chunkIndex} 批 AI 调用：target=${staleTarget}, ${staleReason}`);
                    return {
                        success: false,
                        error: `手动更新在边界 checkpoint 后写目标陈旧，请重新发起更新：${staleReason}`,
                        diagnosticCode: 'stale_bucket_after_boundary_checkpoint',
                    };
                }
            }
            // 最终复检（每个 chunk 紧邻 AI 调用）：loadAllChatMessages_ACU 与
            // ensureV2BoundaryCheckpointForRetainedBuffer_ACU 都是异步边界，等待期间
            // runtime 可能被 purge/表集合变化。必须在 processGroupedRuntimeChunk_ACU
            // 之前最后一次核对确认前快照，否则会把 stale target 带入 AI/持久化链路。
            // 重填路径：破坏性清理已发生，失败必须走 failManualRefillSession
            // （零提交恢复 snapshot，已保留成果并刷新），不得裸返回。
            // 普通路径：结构化失败返回。
            if (options.executionSnapshot !== undefined) {
                if (!runtimeSheetKeysMatchSnapshot_ACU(manualUpdateSnapshotKeys)) {
                    logWarn_ACU(`[Manual Update] runtime 在第 ${chunkIndex} 批 AI 调用前一刻变化，已阻止该批执行（快照未匹配）。`);
                    if (manualRefillEnabled) {
                        return await failManualRefillSession('表格运行时在确认期间发生变化，已取消本次手动填表；已清理的数据不可恢复，请确认后重试。');
                    }
                    return { success: false, error: '表格运行时在确认期间发生变化，已取消本次手动填表，请确认后重试。' };
                }
            }
            try {
                // 非跨根或未启用 staging：普通逐组执行（与旧路径完全一致）。
                if (!manualRefillEnabled || !boundaryPlan || !stagingRun) {
                    const chunkResult = await processGroupedRuntimeChunk_ACU(groupedChunk, 'manual_independent', {
                        onProgress: options.onProgress,
                        // 重填路径：中间 bucket 目标早于清理后保留的旧 full checkpoint 是预期，
                        // 由清理前 refillAdmission 与末尾原子完整 checkpoint 契约保证安全。
                        skipWriteTargetAdmission: manualRefillEnabled,
                        // 范围内旧增量已在预清理中删除，提交时无需再做增量替换。
                        replaceExistingIncremental: false,
                    });
                    committedBucketCount += chunkResult.committedBucketCount;
                    if (!chunkResult.success) {
                        chunkResult.failedGroups.forEach(key => {
                            failedGroups.push({ key, error: chunkResult.error || '手动更新失败或被终止。' });
                        });
                        if (chunkResult.failedGroups.length === 0) {
                            failedGroups.push({ key: chunkKeys[0] || 'manual_refill', error: chunkResult.error || '手动更新已终止。' });
                        }
                    }
                } else {
                    // 跨根 staging：组内索引按原 full 边界拆段，pre 段 stage_only、边界汇合、post 段 persist。
                    for (const group of groupedChunk) {
                        let groupFailed = false;
                        const groupIndices = [...(group.indices || [])].sort((a, b) => a - b);
                        const segments = splitMessageIndicesAtBoundary_ACU(groupIndices, boundaryPlan.scope.originalFullIndex);
                        const preSegments = segments.filter(segment => segment.indices.length > 0 && segment.indices[0] < boundaryPlan!.scope.originalFullIndex!);
                        const postSegments = segments.filter(segment => segment.indices.length > 0 && segment.indices[0] >= boundaryPlan!.scope.originalFullIndex!);

                        for (const preSegment of preSegments) {
                            const preGroups: GroupedRuntimeUpdateGroup_ACU[] = [{
                                ...group,
                                indices: [...preSegment.indices],
                                mergeBaseMaxMessageIndex: preSegment.mergeBaseMaxMessageIndex,
                            }];
                            const preResult = await processGroupedRuntimeChunk_ACU(preGroups, 'manual_independent', {
                                onProgress: options.onProgress,
                                skipWriteTargetAdmission: true,
                                replaceExistingIncremental: false,
                                commitMode: 'stage_only',
                                stagingSession: stagingSession || undefined,
                                syncAfterCommit: false,
                            });
                            committedBucketCount += preResult.committedBucketCount;
                            if (!preResult.success) {
                                failedGroups.push({ key: group.key, error: preResult.error || '边界前 staging 提交失败。' });
                                groupFailed = true;
                                break;
                            }
                        }

                        // 首个 post 段提交前收敛 staging：边界前累计快照原子折叠回原根。
                        // pre 段已失败时不得继续 settle 或写入 post 段（该组整体失败）。
                        if (!groupFailed && postSegments.length > 0) {
                            const settleResult = await settleStagingBoundary();
                            if (!settleResult.ok) {
                                failedGroups.push({ key: group.key, error: `跨根 staging 汇合失败：${(settleResult as { ok: false; error: string }).error}` });
                                groupFailed = true;
                                break;
                            }
                        }

                        for (const postSegment of groupFailed ? [] : postSegments) {
                            const postGroups: GroupedRuntimeUpdateGroup_ACU[] = [{
                                ...group,
                                indices: [...postSegment.indices],
                                mergeBaseMaxMessageIndex: postSegment.mergeBaseMaxMessageIndex,
                            }];
                            const postResult = await processGroupedRuntimeChunk_ACU(postGroups, 'manual_independent', {
                                onProgress: options.onProgress,
                                skipWriteTargetAdmission: true,
                                replaceExistingIncremental: false,
                            });
                            committedBucketCount += postResult.committedBucketCount;
                            if (!postResult.success) {
                                failedGroups.push({ key: group.key, error: postResult.error || '边界后提交失败。' });
                                break;
                            }
                        }
                        if (failedGroups.length > 0) break;
                    }
                }

                // 并发组内禁止每组单独刷新；填表保存后 currentJsonTableData_ACU 已由本轮 workingTableData 更新。
                // 这里只同步聊天数组，避免刚保存完又通过 refreshData 触发历史回放/重建。
                await loadAllChatMessages_ACU();
            } catch (error: any) {
                const failureError = error?.message || String(error || '手动重填分组执行异常。');
                logError_ACU('[Manual Refill] 分组执行或同步聊天失败:', error);
                return await failManualRefillSession(failureError);
            }

            if (failedGroups.length > 0) {
                break;
            }
        }

        // 跨根 staging 收尾：若所有目标都早于原 full 边界（未触发循环内汇合），
        // 正常完成时仍须把已提交 staging 成果原子汇合回原根；零 staging 则丢弃。
        // 这是 run 的正常终态，staging 只是内存状态，不会遗留持久化改写。
        if (manualRefillEnabled && boundaryPlan && stagingRun && !boundaryCommitted) {
            const settleResult = await settleStagingBoundary();
            if (!settleResult.ok) {
                logError_ACU(`[Manual Refill] 跨根 staging 收尾汇合失败: ${(settleResult as { ok: false; error: string }).error}`);
                failedGroups.push({ key: 'manual_refill_staging_settle', error: `跨根 staging 汇合失败：${(settleResult as { ok: false; error: string }).error}` });
            } else {
                logDebug_ACU(`[Manual Refill] 跨根 staging 收尾${boundaryCommitted ? '汇合' : '丢弃'}完成：originalFull=${boundaryPlan.scope.originalFullIndex}。`);
            }
        }

        _set_isAutoUpdatingCard_ACU(false);

        if (failedGroups.length > 0) {
            const firstFailure = failedGroups[0];
            const failureError = firstFailure.error || '手动更新失败或被终止。';
            return await failManualRefillSession(failureError);
        }

        if (wasStoppedByUser_ACU) {
            return await failManualRefillSession('手动更新已终止。');
        }

        if (manualRefillEnabled) {
            const completedData = getRuntimeTableDataSnapshot_ACU();
            if (!completedData) {
                return await failManualRefillSession('手动重填已完成，但无法从运行时导出完整恢复快照；已拒绝写入不完整 checkpoint。');
            }
            try {
                const isolationKey = getCurrentIsolationKey_ACU();
                const snapshotResult = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
                    isolationKey,
                    targetMessageIndices: contextScopeIndices,
                    targetSheetKeys: targetKeys,
                    snapshotData: completedData,
                    templateData: frozenManualRefillTemplateData || undefined,
                });
                if (!snapshotResult.success) {
                    logError_ACU('[Manual Refill] 重填完成后提交完整单表 checkpoint 失败:', snapshotResult.error);
                    return await failManualRefillSession(snapshotResult.error || '手动重填完成后提交完整单表 checkpoint 失败。');
                }
            } catch (error: any) {
                const failureError = error?.message || String(error || '手动重填完成后提交完整单表 checkpoint 异常。');
                logError_ACU('[Manual Refill] 重填完成后提交完整单表 checkpoint 异常:', error);
                return await failManualRefillSession(failureError);
            }
        }

        let checkpointWarning: string | undefined;
        try {
            await loadAllChatMessages_ACU();
            const boundaryCheckpoint = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
            if (!boundaryCheckpoint.success) {
                checkpointWarning = boundaryCheckpoint.error || '边界 checkpoint 建立失败。';
                logWarn_ACU(`[Manual Update] 手动填表完成，但边界 checkpoint 建立失败: ${checkpointWarning}`);
            }
        } catch (error: any) {
            checkpointWarning = error?.message || String(error || '边界 checkpoint 建立异常。');
            logWarn_ACU(`[Manual Update] 手动填表完成，但边界 checkpoint 建立异常: ${checkpointWarning}`);
            logError_ACU('[Manual Update] 边界 checkpoint 建立异常详情:', error);
        }

        // 【已封存】自动合并纪要功能已遗弃：checkAutoMergeTrigger_ACU 恒返回不触发，
        // 本块永不进入合并流程，保留为存档（原因见 service/summary/merge-logic.ts 文件头）。
        let autoMergeTriggered = false;
        let autoMergeSuccess = false;
        try {
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

        return { success: true, autoMergeTriggered, autoMergeSuccess, checkpointWarning };
    } catch (error: any) {
        // 破坏性清理尚未开始：异常原样抛出（可能是普通路径的配置/准入错误，或
        // 发生在清理之前的规划错误），不吞掉，由上层按既有方式处理。
        if (!refillCleanupStarted) {
            throw error;
        }
        const failureError = error?.message || String(error || '手动更新执行异常。');
        logError_ACU('[Manual Update] 执行过程中发生未处理异常:', error);
        // 清理已开始：不可逆，不回滚、不恢复已删数据；失败按已提交事实对齐运行时。
        return await failManualRefillSession(failureError);
    } finally {
        _set_manualExtraHint_ACU('');
        _set_isAutoUpdatingCard_ACU(false);
    }
}
