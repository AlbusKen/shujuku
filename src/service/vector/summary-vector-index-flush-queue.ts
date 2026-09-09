import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import {
    deleteSummaryVectorFlushTask_ACU,
    deleteSummaryVectorFlushTaskStrict_ACU,
    getSummaryVectorFlushTask_ACU,
    getSummaryVectorFlushTaskStrict_ACU,
    invalidateSummaryVectorFlushTaskStrict_ACU,
    listSummaryVectorFlushTasks_ACU,
    reconcileLegacySummaryVectorFlushTaskStrict_ACU,
    markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU,
    SummaryVectorFlushGenerationInvalidatedError_ACU,
    upsertSummaryVectorFlushTask_ACU,
    type SummaryVectorIndexFlushTaskMode_ACU,
    type SummaryVectorIndexFlushTaskRecord_ACU,
} from '../../data/storage/vector-index-hot-cache';
import {
    buildSummaryVectorIndexArchiveScopeKey_ACU,
    findSummaryTable_ACU,
    runSummaryVectorIndexArchiveScopeMutationExclusive_ACU,
    type SummaryVectorIndexArchiveResult_ACU,
} from './summary-vector-index-archive-service';
import {
    findTouchedSummarySheetKey_ACU,
    flushSummaryVectorMirrorNow_ACU,
    type SummaryVectorMirrorFlushResult_ACU,
} from './summary-vector-mirror-writer';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import type { TableMutationWriteSetV2_ACU } from '../table/storage-frame-v2-types';
import { hasActiveProvisionalBridgeAnywhere_ACU } from '../table/manual-catch-up-provisional-bridge';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { clearSummaryVectorIndexDirtyForRealign_ACU } from './summary-vector-index-realign-state';
import { runScopedRetentionGcAfterFlush_ACU } from './summary-vector-index-chat-deletion-gc';
import { logSummaryVectorIndexIdentityEvent_ACU } from './summary-vector-index-storage-service';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import { getEffectiveSummaryVectorIndexConfig_ACU } from './vector-memory-config';
import { hashUserInput_ACU } from '../../shared/utils';

const SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU = 2500;
const SUMMARY_VECTOR_INDEX_FLUSHING_STALE_MS_ACU = 60_000;
/**
 * P1：claim 后可重试失败的自动重排上限与退避上界。
 * attemptCount 在 claim（status→flushing）时由 hot-cache 层自增，因此只有真正
 * 走到归档执行的失败才会消耗尝试次数；claim 前失败（上下文不匹配等）不重排，
 * 由 CHAT_CHANGED restore 兜底，避免 attemptCount 不增导致的无限重试循环。
 */
const SUMMARY_VECTOR_INDEX_FLUSH_MAX_ATTEMPTS_ACU = 5;
const SUMMARY_VECTOR_INDEX_FLUSH_RETRY_BACKOFF_MAX_MS_ACU = 5 * 60_000;

/** attemptCount=1 → 2.5s，2 → 5s，3 → 10s…上限 5 分钟。 */
function computeFlushRetryBackoffMs_ACU(attemptCount: number): number {
    const attempts = Math.max(1, Math.floor(Number(attemptCount) || 1));
    const backoff = SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU * Math.pow(2, attempts - 1);
    return Math.min(backoff, SUMMARY_VECTOR_INDEX_FLUSH_RETRY_BACKOFF_MAX_MS_ACU);
}
/** T4：credential cooldown 默认时长（毫秒）。403/401 后同凭据在其他 scope 也停止重试。 */
const SUMMARY_VECTOR_INDEX_CREDENTIAL_COOLDOWN_MS_ACU = 30 * 60_000;
const summaryVectorFlushTimers_ACU = new Map<string, ReturnType<typeof setTimeout>>();
const summaryVectorFlushRunning_ACU = new Set<string>();
/** T4：credential 指纹 → cooldown 截止时间。仅存哈希不存明文 apiKey。 */
const summaryVectorCredentialCooldowns_ACU = new Map<string, { until: number; reason: string }>();

export interface SummaryVectorIndexFlushQueueOptions_ACU {
    targetMessageIndex?: number;
    mode?: SummaryVectorIndexFlushTaskMode_ACU;
    debounceMs?: number;
    reason?: string;
    isolationKey?: string;
    sourceTableKey?: string;
}

export interface SummaryVectorIndexFlushQueueResult_ACU {
    queued: boolean;
    skipped?: boolean;
    reason?: string;
    scopeKey?: string;
    debounceUntil?: number;
}

export interface SummaryVectorIndexFlushNowResult_ACU {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    result?: SummaryVectorIndexArchiveResult_ACU | SummaryVectorMirrorFlushResult_ACU;
    error?: string;
}

export function scheduleSummaryVectorMirrorFlushAfterPersist_ACU(options: {
    changedSheetKeys?: string[];
    writeSet?: TableMutationWriteSetV2_ACU;
    reason: string;
}): void {
    try {
        const worldbook = getCurrentWorldbookConfig_ACU();
        if (worldbook.summaryVectorIndexModeEnabled !== true || worldbook.summaryVectorMirrorEnabled === false) return;
        const sourceTableKey = findTouchedSummarySheetKey_ACU({
            changedSheetKeys: options.changedSheetKeys,
            writeSet: options.writeSet,
        });
        if (!sourceTableKey) return;
        void enqueueSummaryVectorIndexFlush_ACU({
            sourceTableKey,
            reason: options.reason,
        }).catch((error: any) => {
            logWarn_ACU('[向量镜像] persist 后入队失败（不影响表格保存）:', error?.message || error);
        });
    } catch (error: any) {
        logWarn_ACU('[向量镜像] persist 后入队检查失败（不影响表格保存）:', error?.message || error);
    }
}

/** 与 archive lock、realign state 复用同一三元 canonical scope。 */
export function buildSummaryVectorIndexFlushScopeKey_ACU(
    chatKey: string,
    isolationKey: string,
    sourceTableKey: string,
): string {
    return buildSummaryVectorIndexArchiveScopeKey_ACU(
        normalizeSummaryVectorIndexScope_ACU({ chatKey, isolationKey, sourceTableKey }),
    );
}

function normalizeErrorMessage_ACU(error: unknown): string {
    if (error instanceof Error) return error.message || error.name || '未知错误';
    if (typeof error === 'string') return error;
    try {
        const text = JSON.stringify(error);
        return text && text !== '{}' ? text : String(error || '未知错误');
    } catch {
        return String(error || '未知错误');
    }
}

function isLegacyDefaultFlushTask_ACU(
    task: SummaryVectorIndexFlushTaskRecord_ACU,
    scope: { chatKey: string; isolationKey: string; sourceTableKey: string },
    canonicalScopeKey: string,
): boolean {
    return !String(task.isolationKey || '').trim()
        && task.chatKey === scope.chatKey
        && task.sourceTableKey === scope.sourceTableKey
        && scope.isolationKey === 'default';
}

async function reconcileLegacyDefaultFlushTask_ACU(
    task: SummaryVectorIndexFlushTaskRecord_ACU,
    scope: { chatKey: string; isolationKey: string; sourceTableKey: string },
    canonicalScopeKey: string,
): Promise<SummaryVectorIndexFlushTaskRecord_ACU | null> {
    clearFlushTimer_ACU(task.scopeKey);
    const reconciliation = await reconcileLegacySummaryVectorFlushTaskStrict_ACU({
        legacyScopeKey: task.scopeKey,
        canonicalScopeKey,
        ...scope,
    });
    logSummaryVectorIndexIdentityEvent_ACU(
        reconciliation.outcome === 'quarantined' ? 'warn' : 'debug',
        'flush',
        reconciliation.outcome === 'quarantined' ? 'legacy_scope_conflict_quarantined' : 'legacy_scope_migrated',
        {
            scopeFingerprint: canonicalScopeKey,
            error: `legacy=${task.scopeKey}; outcome=${reconciliation.outcome}`,
        },
    );
    return reconciliation.task;
}

function shouldClearSummaryVectorIndexDirtyAfterFlush_ACU(
    result: SummaryVectorIndexArchiveResult_ACU | SummaryVectorMirrorFlushResult_ACU,
): boolean {
    if (!result.success) return false;
    if (result.skipped && result.reason === 'summary_table_not_found') {
        return false;
    }
    return true;
}

function clearFlushTimer_ACU(scopeKey: string): void {
    const timer = summaryVectorFlushTimers_ACU.get(scopeKey);
    if (timer) clearTimeout(timer);
    summaryVectorFlushTimers_ACU.delete(scopeKey);
}

async function markFlushTaskFailure_ACU(
    task: SummaryVectorIndexFlushTaskRecord_ACU,
    error: string,
    terminal = false,
    options: { scheduleRetry?: boolean } = {},
): Promise<void> {
    // P1：claim 后失败（attemptCount 已自增）达到上限时升级为 terminal，
    // 防止确定性失败（如坏文本导致 provider 持续缺向量）无限扣费。
    const attemptCount = Math.max(0, Number(task.attemptCount) || 0);
    const attemptsExhausted = !terminal
        && options.scheduleRetry === true
        && attemptCount >= SUMMARY_VECTOR_INDEX_FLUSH_MAX_ATTEMPTS_ACU;
    const finalTerminal = terminal || attemptsExhausted;
    const finalError = attemptsExhausted
        ? `${error}（已连续失败 ${attemptCount} 次，达到自动重试上限，可通过“立即重建”手动恢复）`
        : error;
    const retryDelayMs = finalTerminal
        ? SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU
        : computeFlushRetryBackoffMs_ACU(attemptCount);
    const updated = await upsertSummaryVectorFlushTask_ACU({
        scopeKey: task.scopeKey,
        chatKey: task.chatKey,
        isolationKey: task.isolationKey,
        sourceTableKey: task.sourceTableKey,
        targetMessageIndex: task.targetMessageIndex,
        generation: task.generation,
        mode: task.mode,
        status: finalTerminal ? 'failed_terminal' : 'failed_retryable',
        requestedAt: task.requestedAt,
        debounceUntil: Date.now() + retryDelayMs,
        lastError: finalError,
    });
    logSummaryVectorIndexIdentityEvent_ACU(finalTerminal ? 'warn' : 'debug', 'flush', finalTerminal ? 'failed_terminal' : 'failed_retryable', {
        scopeFingerprint: task.scopeKey,
        error: finalError,
    });
    // P1：只有 claim 后失败才自动重排定时器。upsert 可能因新代次入队而返回更高
    // generation 的记录，此时不重排（新代次已有自己的定时器/接力）。
    if (!finalTerminal
        && options.scheduleRetry === true
        && updated
        && updated.generation === task.generation
        && updated.status === 'failed_retryable') {
        scheduleFlushTaskTimer_ACU(updated);
        logDebug_ACU(`[交火向量索引] flush 失败已自动重排：scope=${task.scopeKey}, attempt=${attemptCount}, delayMs=${retryDelayMs}`);
    }
}


function scheduleFlushTaskTimer_ACU(task: SummaryVectorIndexFlushTaskRecord_ACU): void {
    clearFlushTimer_ACU(task.scopeKey);

    const delay = Math.max(0, Math.min(Math.max(0, task.debounceUntil - Date.now()), 2_147_483_647));
    logDebug_ACU(`[交火向量索引] 防抖定时器已设置：scope=${task.scopeKey}, delay=${delay}ms, mode=${task.mode}`);
    const timer = setTimeout(() => {
        logDebug_ACU(`[交火向量索引] 防抖定时器触发：scope=${task.scopeKey}, 开始执行 flush`);
        summaryVectorFlushTimers_ACU.delete(task.scopeKey);
        void flushSummaryVectorIndexTaskNow_ACU(task.scopeKey);
    }, delay);
    summaryVectorFlushTimers_ACU.set(task.scopeKey, timer);
}

/** T4：查询 credential cooldown 是否仍生效。命中返回 reason，否则返回 null。 */
function getActiveCredentialCooldown_ACU(credentialFingerprint: string): { until: number; reason: string } | null {
    if (!credentialFingerprint) return null;
    const entry = summaryVectorCredentialCooldowns_ACU.get(credentialFingerprint);
    if (!entry) return null;
    if (Date.now() >= entry.until) {
        summaryVectorCredentialCooldowns_ACU.delete(credentialFingerprint);
        return null;
    }
    return entry;
}

/** T4：记录 credential cooldown（仅存指纹，不存明文）。换 key（指纹变化）自动失效。 */
function recordCredentialCooldown_ACU(credentialFingerprint: string, reason: string): void {
    if (!credentialFingerprint) return;
    summaryVectorCredentialCooldowns_ACU.set(credentialFingerprint, {
        until: Date.now() + SUMMARY_VECTOR_INDEX_CREDENTIAL_COOLDOWN_MS_ACU,
        reason,
    });
    logSummaryVectorIndexIdentityEvent_ACU('warn', 'flush', 'credential_cooldown_armed', {
        scopeFingerprint: 'credential-fingerprint',
        error: reason,
    });
}

/** T4：显式解除全部 credential cooldown（手动重建成功 / 用户换 key 后）。 */
export function clearSummaryVectorIndexCredentialCooldowns_ACU(): void {
    summaryVectorCredentialCooldowns_ACU.clear();
    logSummaryVectorIndexIdentityEvent_ACU('debug', 'flush', 'credential_cooldown_cleared', {
        scopeFingerprint: 'credential-fingerprint',
        error: 'manual rebuild or credential change cleared cooldowns',
    });
}


async function resumeQueuedFlushTaskAfterRunner_ACU(scopeKey: string, completedGeneration: number): Promise<void> {
    const current = await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
    if (!current
        || current.generation === completedGeneration
        || current.status === 'invalidated'
        || current.status === 'ready'
        || current.status === 'failed_terminal'
        || current.status === 'blocked_needs_rebuild') {
        return;
    }
    if (current.status === 'queued' || current.status === 'dirty' || current.status === 'failed_retryable') {
        scheduleFlushTaskTimer_ACU(current);
        logDebug_ACU(`[交火向量索引] 旧 flush 完成后已接力调度新 generation：scope=${scopeKey}, generation=${current.generation}`);
    }
}

export async function enqueueSummaryVectorIndexFlush_ACU(options: SummaryVectorIndexFlushQueueOptions_ACU = {}): Promise<SummaryVectorIndexFlushQueueResult_ACU> {
    if (getCurrentWorldbookConfig_ACU().summaryVectorMirrorEnabled === false) {
        return { queued: false, skipped: true, reason: 'summary_vector_mirror_disabled' };
    }
    const selectedSummary = findSummaryTable_ACU();
    const rawChatKey = String(currentChatFileIdentifier_ACU || '').trim();
    if (!rawChatKey) {
        return { queued: false, skipped: true, reason: 'flush_scope_unresolved' };
    }
    const activeScope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: rawChatKey,
        isolationKey: getCurrentIsolationKey_ACU(),
        sourceTableKey: selectedSummary?.summaryKey,
    });
    const scope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: rawChatKey,
        isolationKey: options.isolationKey ?? getCurrentIsolationKey_ACU(),
        sourceTableKey: options.sourceTableKey ?? selectedSummary?.summaryKey,
    });
    if (!selectedSummary?.summaryKey || scope.sourceTableKey !== activeScope.sourceTableKey) {
        return { queued: false, skipped: true, reason: 'summary_table_not_found' };
    }
    const { chatKey, isolationKey, sourceTableKey } = scope;

    const now = Date.now();
    const rawDebounceMs = options.debounceMs == null
        ? SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU
        : Number(options.debounceMs);
    const debounceMs = Number.isFinite(rawDebounceMs)
        ? Math.max(0, rawDebounceMs)
        : SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU;
    const scopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(chatKey, isolationKey, sourceTableKey);
    return runSummaryVectorIndexArchiveScopeMutationExclusive_ACU(scopeKey, async () => {
        const existingTask = await getSummaryVectorFlushTaskStrict_ACU(scopeKey);
        // flushing 表示旧 runner 已捕获当前 generation。新的写入必须进入下一代，
        // 否则旧 runner 成功收尾会与新任务共享 generation，无法安全区分归属。
        const generation = existingTask?.status === 'invalidated' || existingTask?.status === 'flushing'
            ? existingTask.generation + 1
            : existingTask?.generation;
        const task = await upsertSummaryVectorFlushTask_ACU({
            scopeKey,
            chatKey,
            isolationKey,
            sourceTableKey,
            generation,
            mode: 'sync',
            status: 'queued',
            requestedAt: now,
            debounceUntil: now + debounceMs,
        });
        if (!task) {
            return { queued: false, skipped: true, reason: 'flush_task_persist_failed', scopeKey };
        }
        scheduleFlushTaskTimer_ACU(task);
        logDebug_ACU(`[交火向量索引] 已加入防抖 flush 队列：scope=${scopeKey}, mode=${task.mode}, debounceMs=${debounceMs}, reason=${options.reason || ''}`);
        return { queued: true, scopeKey, debounceUntil: task.debounceUntil };
    });
}

export async function flushSummaryVectorIndexTaskNow_ACU(scopeKey: string): Promise<SummaryVectorIndexFlushNowResult_ACU> {
    let task = await getSummaryVectorFlushTask_ACU(scopeKey);
    if (!task) return { success: true, skipped: true, reason: 'flush_task_not_found' };
    if (task.status === 'invalidated') return { success: true, skipped: true, reason: 'flush_scope_invalidated' };
    let expectedGeneration = Math.max(0, Number(task.generation) || 0);
    if (summaryVectorFlushRunning_ACU.has(task.scopeKey)) {
        return { success: true, skipped: true, reason: 'flush_already_running' };
    }

    const activeScope = normalizeSummaryVectorIndexScope_ACU({
        chatKey: currentChatFileIdentifier_ACU,
        isolationKey: getCurrentIsolationKey_ACU(),
        sourceTableKey: findSummaryTable_ACU()?.summaryKey,
    });
    const activeChatKey = activeScope.chatKey;
    if (task.chatKey !== activeChatKey) {
        const message = `flush scope 与当前聊天上下文不一致：task=${task.chatKey}, active=${activeChatKey}`;
        await markFlushTaskFailure_ACU(task, message, false);
        logWarn_ACU('[交火向量索引] 跳过防抖 flush，当前上下文不匹配:', message);
        return { success: false, reason: 'flush_scope_mismatch', error: message };
    }
    const taskScope = normalizeSummaryVectorIndexScope_ACU(task);
    const expectedScopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(taskScope.chatKey, taskScope.isolationKey, taskScope.sourceTableKey);
    const canonicalActiveScopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(
        activeScope.chatKey,
        activeScope.isolationKey,
        activeScope.sourceTableKey,
    );
    if (isLegacyDefaultFlushTask_ACU(task, activeScope, canonicalActiveScopeKey)) {
        const reconciled = await reconcileLegacyDefaultFlushTask_ACU(task, activeScope, canonicalActiveScopeKey);
        if (!reconciled || reconciled.status === 'failed_terminal') {
            return { success: true, skipped: true, reason: 'flush_legacy_scope_quarantined' };
        }
        return flushSummaryVectorIndexTaskNow_ACU(canonicalActiveScopeKey);
    }
    if (task.chatKey !== taskScope.chatKey
        || task.isolationKey !== taskScope.isolationKey
        || task.sourceTableKey !== taskScope.sourceTableKey
        || task.scopeKey !== expectedScopeKey) {
        // 除了可安全派生的默认空槽 task 外，其他旧格式没有足够身份字段可证明归属。
        const message = `旧版 flush task 缺少可验证三元 scope，已从队列中清理：task=${task.scopeKey}`;
        clearFlushTimer_ACU(task.scopeKey);
        await deleteSummaryVectorFlushTask_ACU(task.scopeKey);
        logSummaryVectorIndexIdentityEvent_ACU('debug', 'flush', 'legacy_scope_purged', {
            scopeFingerprint: task.scopeKey,
            error: message,
        });
        logDebug_ACU('[交火向量索引] 已清理身份不完整的旧版 flush task:', message);
        return { success: true, skipped: true, reason: 'flush_legacy_scope_purged' };
    }
    const activeIsolationKey = activeScope.isolationKey;
    if (task.isolationKey !== activeIsolationKey) {
        const message = `flush isolation 与当前上下文不一致：task=${task.isolationKey}, active=${activeIsolationKey}`;
        await markFlushTaskFailure_ACU(task, message, false);
        return { success: false, reason: 'flush_scope_mismatch', error: message };
    }

    const selectedSummary = findSummaryTable_ACU();
    if (!selectedSummary?.summaryKey || normalizeSummaryVectorIndexScope_ACU({ sourceTableKey: selectedSummary.summaryKey }).sourceTableKey !== task.sourceTableKey) {
        const message = `flush scope 对应纪要表不可用：sourceTableKey=${task.sourceTableKey}`;
        await markFlushTaskFailure_ACU(task, message, false);
        logWarn_ACU('[交火向量索引] 跳过防抖 flush，纪要表不可用:', message);
        return { success: false, reason: 'summary_table_not_found_for_flush', error: message };
    }

    // claim 必须和 enqueue 使用同一 scope 边界；否则 enqueue 可在读取 queued 和
    // durable 写入 flushing 之间插入，两个请求共享 generation 后旧 runner 会吞掉新写入。
    const claimedTask = await runSummaryVectorIndexArchiveScopeMutationExclusive_ACU(task.scopeKey, async () => {
        const current = await getSummaryVectorFlushTaskStrict_ACU(task.scopeKey);
        const currentGeneration = Math.max(0, Number(current?.generation) || 0);
        if (!current
            || currentGeneration !== expectedGeneration
            || (current.status !== 'queued' && current.status !== 'dirty' && current.status !== 'failed_retryable')) {
            return null;
        }
        return upsertSummaryVectorFlushTask_ACU({
            scopeKey: current.scopeKey,
            chatKey: current.chatKey,
            isolationKey: current.isolationKey,
            sourceTableKey: current.sourceTableKey,
            targetMessageIndex: current.targetMessageIndex,
            mode: current.mode,
            status: 'flushing',
            generation: currentGeneration,
            requestedAt: current.requestedAt,
            debounceUntil: current.debounceUntil,
        });
    });
    if (!claimedTask) return { success: true, skipped: true, reason: 'flush_claim_superseded' };
    task = claimedTask;
    expectedGeneration = task.generation;
    summaryVectorFlushRunning_ACU.add(task.scopeKey);
    clearFlushTimer_ACU(task.scopeKey);
    try {
        // T4：credential cooldown 检查——同一凭据（endpoint+model+apiKey 指纹）近期
        // 401/403 后，其他 scope 的 flush 也不再发起 embedding 请求，避免重复扣费。
        try {
            const cooldownConfig = getEffectiveSummaryVectorIndexConfig_ACU();
            const cooldownFingerprint = hashUserInput_ACU([
                String(cooldownConfig.embeddingEndpoint || '').trim(),
                String(cooldownConfig.embeddingModel || '').trim(),
                String(cooldownConfig.embeddingApiKey || '').trim(),
            ].join('|'));
            const activeCooldown = getActiveCredentialCooldown_ACU(cooldownFingerprint);
            if (activeCooldown) {
                const cooldownError = `凭据冷却中（${activeCooldown.reason}），停止重复扣费重试。`;
                logWarn_ACU(`[交火向量索引] 防抖 flush 因 credential cooldown 跳过：scope=${task.scopeKey}`);
                await markFlushTaskFailure_ACU(task, cooldownError, true);
                return { success: false, reason: 'credential_cooldown', result: undefined, error: cooldownError };
            }
        } catch (_cooldownConfigError) {
            // config 不可用时不做 cooldown 检查，退回原路径（cooldown 是防重复扣费的增强，不阻断正常 flush）。
        }
        if (hasActiveProvisionalBridgeAnywhere_ACU(getChatArray_ACU())) {
            await upsertSummaryVectorFlushTask_ACU({
                scopeKey: task.scopeKey,
                chatKey: task.chatKey,
                isolationKey: task.isolationKey,
                sourceTableKey: task.sourceTableKey,
                generation: expectedGeneration,
                mode: 'sync',
                status: 'queued',
                requestedAt: task.requestedAt,
                debounceUntil: Date.now() + SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU,
            });
            return { success: true, skipped: true, reason: 'bridge_active' };
        }
        const result = await flushSummaryVectorMirrorNow_ACU({
            isolationKey: task.isolationKey,
            sourceTableKey: task.sourceTableKey,
            expectedFlushScopeKey: task.scopeKey,
            expectedFlushGeneration: expectedGeneration,
        });
        if (result.reason === 'bridge_active') {
            await upsertSummaryVectorFlushTask_ACU({
                scopeKey: task.scopeKey,
                chatKey: task.chatKey,
                isolationKey: task.isolationKey,
                sourceTableKey: task.sourceTableKey,
                generation: expectedGeneration,
                mode: 'sync',
                status: 'queued',
                requestedAt: task.requestedAt,
                debounceUntil: Date.now() + SUMMARY_VECTOR_INDEX_FLUSH_DEBOUNCE_MS_ACU,
            });
            return { success: true, skipped: true, reason: 'bridge_active', result };
        }
        if (result.needsRebuild) {
            const rebuildError = result.errors.join('; ') || result.reason || 'blocked_needs_rebuild';
            await upsertSummaryVectorFlushTask_ACU({
                scopeKey: task.scopeKey,
                chatKey: task.chatKey,
                isolationKey: task.isolationKey,
                sourceTableKey: task.sourceTableKey,
                generation: expectedGeneration,
                mode: 'sync',
                status: 'blocked_needs_rebuild',
                requestedAt: task.requestedAt,
                debounceUntil: task.debounceUntil,
                lastError: rebuildError,
            });
            return { success: false, reason: result.reason, result, error: rebuildError };
        }
        if (result.skipped && result.reason === 'flush_scope_invalidated') {
            return { success: true, skipped: true, reason: 'flush_scope_invalidated', result };
        }
        if (result.success) {
            const completed = await markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU(task.scopeKey, expectedGeneration);
            if (completed && shouldClearSummaryVectorIndexDirtyAfterFlush_ACU(result)) {
                clearSummaryVectorIndexDirtyForRealign_ACU(task.scopeKey);
            }
            // P7：归档成功后按 scope 节流回收无楼层引用且过 grace 的旧代快照，
            // 防止活跃聊天的外置存档随归档次数无界增长。fire-and-forget，失败不影响 flush 结果。
            void runScopedRetentionGcAfterFlush_ACU({
                chatKey: task.chatKey,
                isolationKey: task.isolationKey,
                sourceTableKey: task.sourceTableKey,
            }).catch((error: any) => {
                logWarn_ACU('[交火向量索引] retention GC 执行失败（不影响归档结果）:', error?.message || error);
            });
            logDebug_ACU(`[交火向量索引] 防抖 flush 完成：scope=${task.scopeKey}, skipped=${result.skipped}, reason=${result.reason || ''}`);
            return { success: true, skipped: result.skipped, reason: result.reason, result };
        }
        const error = result.errors?.join('; ') || result.reason || 'summary_vector_index_flush_failed';
        // T4：credential 类失败（401/403）记录跨 scope cooldown，
        // 同一凭据在其他聊天（scope）也停止立即重试，避免重复扣费。
        if (result.credentialFingerprint) {
            recordCredentialCooldown_ACU(result.credentialFingerprint, error);
        }
        // T0c：优先采用 archive 返回的结构化重试性分类（如路径超长 → terminal），
        // 保留既有 reason 硬编码作为兜底，避免 T4 结构化失败落地前遗漏。
        const isTerminalFailure = result.retryability === 'terminal'
            || result.reason === 'summary_vector_index_config_invalid'
            || result.reason === 'target_message_invalid'
            || result.reason === 'target_message_not_found';
        await markFlushTaskFailure_ACU(task, error, isTerminalFailure, { scheduleRetry: true });
        logWarn_ACU('[交火向量索引] 防抖 flush 失败:', error);
        return { success: false, reason: result.reason, result, error };
    } catch (error) {
        const message = normalizeErrorMessage_ACU(error);
        if (error instanceof SummaryVectorFlushGenerationInvalidatedError_ACU) return { success: true, skipped: true, reason: 'flush_scope_invalidated' };
        await markFlushTaskFailure_ACU(task, message, false, { scheduleRetry: true });
        logWarn_ACU('[交火向量索引] 防抖 flush 异常:', message);
        return { success: false, reason: 'flush_exception', error: message };
    } finally {
        summaryVectorFlushRunning_ACU.delete(task.scopeKey);
        await resumeQueuedFlushTaskAfterRunner_ACU(task.scopeKey, expectedGeneration);
    }
}

/**
 * 持久化失效当前 scope 的 flush task，并同步取消内存定时器。公开入口自行获取
 * scope mutation lock，避免未来调用方绕过 publish/invalidation 串行协议。
 * 墓碑携带单调 generation；旧 runner 在真正发布聊天 pointer 前必须校验代次。
 */
export async function clearSummaryVectorIndexFlushQueueForCurrentScope_ACU(params: {
    isolationKey: string;
    sourceTableKey: string;
}): Promise<number> {
    const scope = resolveCurrentSummaryVectorFlushScope_ACU(params);
    return runSummaryVectorIndexArchiveScopeMutationExclusive_ACU(
        scope.scopeKey,
        () => clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU(scope),
    );
}

/** 仅供已持有同一 scope mutation lock 的恢复路径调用。 */
export async function clearSummaryVectorIndexFlushQueueForCurrentScopeUnlocked_ACU(scope: {
    scopeKey: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): Promise<number> {
    clearFlushTimer_ACU(scope.scopeKey);
    const tombstone = await invalidateSummaryVectorFlushTaskStrict_ACU(scope);
    logDebug_ACU(`[交火向量索引] 已持久化 flush 失效墓碑：scope=${scope.scopeKey}, generation=${tombstone.generation}`);
    return 1;
}

export function resolveCurrentSummaryVectorFlushScope_ACU(params: {
    isolationKey: string;
    sourceTableKey: string;
}): {
    scopeKey: string;
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
} {
    const rawChatKey = String(currentChatFileIdentifier_ACU || '').trim();
    const rawSourceTableKey = String(params.sourceTableKey || '').trim();
    if (!rawChatKey) throw new Error('清理交火向量 flush 队列失败：当前聊天标识为空');
    if (!rawSourceTableKey) throw new Error('清理交火向量 flush 队列失败：纪要表标识为空');
    const { chatKey, isolationKey, sourceTableKey } = normalizeSummaryVectorIndexScope_ACU({
        chatKey: rawChatKey,
        isolationKey: params.isolationKey,
        sourceTableKey: rawSourceTableKey,
    });

    const scopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(chatKey, isolationKey, sourceTableKey);
    return { scopeKey, chatKey, isolationKey, sourceTableKey };
}

export async function restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU(): Promise<number> {
    const rawChatKey = String(currentChatFileIdentifier_ACU || '').trim();
    if (!rawChatKey) return 0;
    const selectedSummary = findSummaryTable_ACU();
    const rawSourceTableKey = String(selectedSummary?.summaryKey || '').trim();
    if (!rawSourceTableKey) return 0;
    const { chatKey, isolationKey, sourceTableKey } = normalizeSummaryVectorIndexScope_ACU({
        chatKey: rawChatKey,
        isolationKey: getCurrentIsolationKey_ACU(),
        sourceTableKey: rawSourceTableKey,
    });
    const tasks = await listSummaryVectorFlushTasks_ACU({
        chatKey,
        isolationKey,
        sourceTableKey,
    });
    const activeScopeKey = buildSummaryVectorIndexFlushScopeKey_ACU(chatKey, isolationKey, sourceTableKey);
    let restored = 0;
    let purgedLegacy = 0;
    const scheduledScopeKeys = new Set<string>();
    const now = Date.now();
    for (const task of tasks) {
        if (task.status === 'invalidated') continue;
        if (isLegacyDefaultFlushTask_ACU(task, { chatKey, isolationKey, sourceTableKey }, activeScopeKey)) {
            const reconciled = await reconcileLegacyDefaultFlushTask_ACU(task, { chatKey, isolationKey, sourceTableKey }, activeScopeKey);
            if (!reconciled || reconciled.status === 'failed_terminal' || reconciled.status === 'invalidated') continue;
            if (scheduledScopeKeys.has(reconciled.scopeKey)) continue;
            if (reconciled.status === 'ready') {
                scheduledScopeKeys.add(reconciled.scopeKey);
                continue;
            }
            scheduleFlushTaskTimer_ACU(reconciled);
            scheduledScopeKeys.add(reconciled.scopeKey);
            restored += 1;
            continue;
        }
        // isolationKey==='' 是未开隔离的合法默认槽；不能用真值判断当 legacy 清掉。
        if (typeof task.isolationKey !== 'string' || task.scopeKey !== activeScopeKey) {
            clearFlushTimer_ACU(task.scopeKey);
            await deleteSummaryVectorFlushTask_ACU(task.scopeKey);
            logSummaryVectorIndexIdentityEvent_ACU('debug', 'flush', 'legacy_scope_purged', {
                scopeFingerprint: task.scopeKey,
                error: `restore 时发现身份不完整的旧版 flush task：task=${task.scopeKey}`,
            });
            purgedLegacy += 1;
            continue;
        }
        if (task.status === 'ready' || task.status === 'failed_terminal') continue;
        if (task.status === 'flushing' && now - task.updatedAt > SUMMARY_VECTOR_INDEX_FLUSHING_STALE_MS_ACU) {
            await markFlushTaskFailure_ACU(task, '上次 flush 在执行中断后超时，已重新排队。', false);
            const refreshed = await getSummaryVectorFlushTask_ACU(task.scopeKey);
            if (refreshed) {
                scheduleFlushTaskTimer_ACU(refreshed);
                restored += 1;
            }
            continue;
        }
        if (scheduledScopeKeys.has(task.scopeKey)) continue;
        scheduleFlushTaskTimer_ACU(task);
        scheduledScopeKeys.add(task.scopeKey);
        restored += 1;
    }
    if (restored > 0) {
        logDebug_ACU(`[交火向量索引] 已恢复当前 scope 防抖 flush 队列：scope=${activeScopeKey}, count=${restored}`);
    }
    if (purgedLegacy > 0) {
        logDebug_ACU(`[交火向量索引] 启动期清理身份不完整的旧版 flush task：count=${purgedLegacy}`);
    }
    return restored;
}
