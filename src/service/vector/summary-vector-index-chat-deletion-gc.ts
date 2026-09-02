/**
 * service/vector/summary-vector-index-chat-deletion-gc.ts — 聊天删除向量清理与存储治理
 *
 * 解决向量外置存档"只增不减"的三个来源：
 *   1. 聊天被删除后其向量文件/IDB 缓存/flush 任务成为永久孤儿 → 事件驱动即时清理；
 *   2. 插件未加载期间发生的删除无事件可听 → 启动期节流孤儿清扫兜底；
 *   3. 活跃聊天每次归档产生新一代快照、旧代无人回收 → flush 成功后按 scope 节流 Safe GC
 *      （可达性来自当前聊天全部楼层 manifest，被任何楼层引用的历史快照天然受保护，
 *      只回收无引用且过 grace 的旧代对象，不破坏回退旧楼层的恢复能力）。
 *
 * 删除安全边界（缺一不可）：
 *   - 聊天文件名不含角色作用域，跨角色可重名；删除前必须枚举全酒馆聊天确认无同名存活，
 *     枚举不完整（返回 null）时 fail-safe 跳过；
 *   - 实际文件删除全部走 cleanupUnreachableSummaryVectorIndexFiles_ACU 的既有防护
 *     （scope 前缀匹配 + blob canonical 身份回读校验 + grace 窗口 + prepared/pending 保护）。
 */

import { listAllHostChatNames_ACU } from '../../data/gateways/chat-gateway';
import {
    clearSummaryVectorFlushTasksByScope_ACU,
    deleteSummaryVectorHotCacheByScope_ACU,
} from '../../data/storage/vector-index-hot-cache';
import {
    loadVectorIndexRegistry_ACU,
    resolveVectorIndexRegistryFileScope_ACU,
} from '../../data/storage/vector-index-st-files-storage';
import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { cleanChatName_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import {
    normalizeSummaryVectorIndexScope_ACU,
    serializeSummaryVectorIndexScope_ACU,
    type SummaryVectorIndexCanonicalScope_ACU,
} from '../../shared/summary-vector-index-scope';
import { cleanupUnreachableSummaryVectorIndexFiles_ACU } from './summary-vector-index-storage-service';

const SUMMARY_VECTOR_ORPHAN_SWEEP_THROTTLE_KEY_ACU = 'TavernDB_ACU_vector_orphan_sweep_last_run';
const SUMMARY_VECTOR_ORPHAN_SWEEP_INTERVAL_MS_ACU = 24 * 60 * 60_000;
const SUMMARY_VECTOR_RETENTION_GC_INTERVAL_MS_ACU = 30 * 60_000;

/** flush 成功后 retention GC 的 per-scope 节流时钟（内存态即可，重载后重来无害）。 */
const retentionGcLastRunByScope_ACU = new Map<string, number>();

export interface SummaryVectorChatDeletionCleanupResult_ACU {
    performed: boolean;
    reason?: string;
    scopeCount: number;
    deletedFileCount: number;
}

function getCurrentChatKey_ACU(): string {
    return String(currentChatFileIdentifier_ACU || '').trim();
}

/**
 * 从 registry 收集属于指定 chatKey 集合的全部唯一 scope。
 * 身份来源：新条目自带的 `scope` 字段；升级前旧条目退回到无损路径 token 反解。
 * 两者都没有的 legacy 分片路径没有可验证身份，维持 Safe GC 的 quarantine 策略，不参与删除。
 */
async function collectRegistryScopesByChatKeys_ACU(
    matchChatKey: (chatKey: string) => boolean,
): Promise<SummaryVectorIndexCanonicalScope_ACU[]> {
    const registry = await loadVectorIndexRegistry_ACU();
    const byToken = new Map<string, SummaryVectorIndexCanonicalScope_ACU>();
    for (const file of registry.files) {
        if (!String(file?.path || '').trim()) continue;
        const resolved = resolveVectorIndexRegistryFileScope_ACU(file);
        if (!resolved || !matchChatKey(resolved.chatKey)) continue;
        const scope = normalizeSummaryVectorIndexScope_ACU(resolved);
        byToken.set(serializeSummaryVectorIndexScope_ACU(scope), scope);
    }
    return Array.from(byToken.values());
}

async function cleanupScopesEverywhere_ACU(
    scopes: SummaryVectorIndexCanonicalScope_ACU[],
    chatKeys: string[],
): Promise<number> {
    // IDB 清理支持 partial scope：只传 chatKey 即可清空该聊天全部热缓存与 flush 任务，
    // 覆盖 registry 里已无文件但 IDB 仍有残留的情况。
    for (const chatKey of chatKeys) {
        await deleteSummaryVectorHotCacheByScope_ACU({ chatKey, isolationKey: '', sourceTableKey: '' });
        await clearSummaryVectorFlushTasksByScope_ACU({ chatKey, isolationKey: '', sourceTableKey: '' });
    }
    if (scopes.length === 0) return 0;
    const gcResult = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: scopes });
    return Array.isArray(gcResult?.deletedPaths) ? gcResult.deletedPaths.length : 0;
}

/**
 * CHAT_DELETED / GROUP_CHAT_DELETED 事件入口：清理被删聊天的向量数据。
 */
export async function cleanupSummaryVectorIndexForDeletedChat_ACU(
    deletedChatName: string,
): Promise<SummaryVectorChatDeletionCleanupResult_ACU> {
    const chatKey = cleanChatName_ACU(String(deletedChatName || ''));
    if (!chatKey) {
        return { performed: false, reason: 'empty_chat_name', scopeCount: 0, deletedFileCount: 0 };
    }
    if (chatKey === getCurrentChatKey_ACU()) {
        // 防御性守卫：删除事件不应指向当前打开的聊天；若指向则宁可留垃圾也不动。
        logWarn_ACU(`[交火向量索引] 聊天删除清理跳过：目标即当前聊天 ${chatKey}`);
        return { performed: false, reason: 'target_is_current_chat', scopeCount: 0, deletedFileCount: 0 };
    }
    const aliveChatNames = await listAllHostChatNames_ACU();
    if (aliveChatNames === null) {
        logWarn_ACU('[交火向量索引] 聊天删除清理跳过：无法完整枚举存活聊天（fail-safe）');
        return { performed: false, reason: 'chat_enumeration_unavailable', scopeCount: 0, deletedFileCount: 0 };
    }
    if (aliveChatNames.has(chatKey)) {
        // 跨角色同名聊天仍存活，其向量数据与被删聊天共用 scope，不能删。
        logDebug_ACU(`[交火向量索引] 聊天删除清理跳过：仍存在同名存活聊天 ${chatKey}`);
        return { performed: false, reason: 'same_name_chat_alive', scopeCount: 0, deletedFileCount: 0 };
    }
    const scopes = await collectRegistryScopesByChatKeys_ACU((candidate) => candidate === chatKey);
    const deletedFileCount = await cleanupScopesEverywhere_ACU(scopes, [chatKey]);
    logDebug_ACU(`[交火向量索引] 聊天删除清理完成：chatKey=${chatKey}, scopes=${scopes.length}, deletedFiles=${deletedFileCount}`);
    return { performed: true, scopeCount: scopes.length, deletedFileCount };
}

/**
 * 启动期孤儿清扫：兜住插件未加载期间被删除的聊天。localStorage 节流 24 小时。
 */
export async function sweepOrphanSummaryVectorIndexFiles_ACU(): Promise<SummaryVectorChatDeletionCleanupResult_ACU> {
    try {
        const lastRun = Number(globalThis.localStorage?.getItem(SUMMARY_VECTOR_ORPHAN_SWEEP_THROTTLE_KEY_ACU) || 0);
        if (Number.isFinite(lastRun) && Date.now() - lastRun < SUMMARY_VECTOR_ORPHAN_SWEEP_INTERVAL_MS_ACU) {
            return { performed: false, reason: 'throttled', scopeCount: 0, deletedFileCount: 0 };
        }
    } catch (_error) {
        // localStorage 不可用时不节流，清扫本身幂等。
    }
    const aliveChatNames = await listAllHostChatNames_ACU();
    if (aliveChatNames === null) {
        logWarn_ACU('[交火向量索引] 孤儿清扫跳过：无法完整枚举存活聊天（fail-safe）');
        return { performed: false, reason: 'chat_enumeration_unavailable', scopeCount: 0, deletedFileCount: 0 };
    }
    const currentChatKey = getCurrentChatKey_ACU();
    const scopes = await collectRegistryScopesByChatKeys_ACU((candidate) => (
        !!candidate && candidate !== currentChatKey && !aliveChatNames.has(candidate)
    ));
    const orphanChatKeys = Array.from(new Set(scopes.map((scope) => scope.chatKey)));
    const deletedFileCount = await cleanupScopesEverywhere_ACU(scopes, orphanChatKeys);
    try {
        globalThis.localStorage?.setItem(SUMMARY_VECTOR_ORPHAN_SWEEP_THROTTLE_KEY_ACU, String(Date.now()));
    } catch (_error) {
        // 忽略：无法记录节流时间戳只意味着下次启动会再扫一遍。
    }
    if (scopes.length > 0) {
        logDebug_ACU(`[交火向量索引] 孤儿清扫完成：orphanChats=${orphanChatKeys.length}, scopes=${scopes.length}, deletedFiles=${deletedFileCount}`);
    }
    return { performed: true, scopeCount: scopes.length, deletedFileCount };
}

/**
 * flush 成功后的活跃聊天 retention GC：回收当前 scope 无楼层引用且过 grace 的旧代快照。
 * per-scope 节流 30 分钟，避免每次归档都全量扫 registry。
 */
export async function runScopedRetentionGcAfterFlush_ACU(scope: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): Promise<void> {
    const canonical = normalizeSummaryVectorIndexScope_ACU(scope);
    const scopeKey = serializeSummaryVectorIndexScope_ACU(canonical);
    const lastRun = retentionGcLastRunByScope_ACU.get(scopeKey) || 0;
    if (Date.now() - lastRun < SUMMARY_VECTOR_RETENTION_GC_INTERVAL_MS_ACU) return;
    retentionGcLastRunByScope_ACU.set(scopeKey, Date.now());
    const gcResult = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [canonical] });
    const deletedCount = Array.isArray(gcResult?.deletedPaths) ? gcResult.deletedPaths.length : 0;
    if (deletedCount > 0) {
        logDebug_ACU(`[交火向量索引] retention GC 回收旧代快照：scope=${scopeKey}, deletedFiles=${deletedCount}`);
    }
}
