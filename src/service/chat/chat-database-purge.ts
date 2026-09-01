/**
 * service/chat/chat-database-purge.ts — 当前聊天级原子硬清空
 *
 * 职责：清除当前聊天在数据库中的全部本地持久化痕迹（消息字段、chatMetadata
 * scope/Guide 容器、旧版表头清单镜像）。成功后运行时回落为当前全局模板的
 * header-only 空结构（S1-1：pristine 语义——重建的是空结构不是旧数据，
 * 不写任何 checkpoint/frame/锚点，首次填表提交才建回放根），避免清空后
 * UI 显示"无可用表格"且填表判定失效。
 *
 * 与 deleteLocalDataInChatCore_ACU('all', range) 的区别：
 * - 旧 API 按 AI 楼层遍历，且全范围删除会保留每个隔离域最早的 init header-only
 *   checkpoint（collectInitialCheckpointSlotsForFullDeletion_ACU）；
 * - 本服务清空全部消息（含用户首条消息）的全部本地表字段、chat[0] 上的 scope/
 *   Guide 镜像与 chatMetadata 容器，不保留任何 checkpoint/frame/锚点。
 *
 * 原子性边界：
 * - 消息字段、chatMetadata 容器、chat[0] 镜像在同一事务内快照、清空、严格保存，
 *   保存失败则按快照回滚；
 * - 外置向量资源与数据库派生世界书条目无法与聊天保存同事务，只在本服务内于严格
 *   保存成功后再清理，失败仅写入 cleanupWarnings，不回滚已提交的聊天数据。
 *
 * 保留范围（绝不删除）：
 * - 聊天正文（mes）、角色卡、全局模板/预设、全局提示词、用户配置；
 * - 独立业务字段 qrf_plot* ；
 * - 受 import stable prefix 保护的外部导入世界书条目（由世界书清理层保证）。
 */

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import {
    clearAllTableFields_ACU,
    scanResidualTableFields_ACU,
    scanResidualFirstMessageScopeFields_ACU,
    MESSAGE_TABLE_FIELDS_ACU,
    FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU,
} from '../../data/repositories/chat-message-data-repo';
import {
    setChatScopedConfigContainer_ACU,
    setChatSheetGuideContainer_ACU,
    peekChatScopedConfigContainer_ACU,
    peekChatSheetGuideContainer_ACU,
    snapshotChatMetadataFields_ACU,
    restoreChatMetadataFields_ACU,
    CHAT_SCOPED_CONFIG_FIELD_ACU,
    CHAT_SHEET_GUIDE_FIELD_ACU,
    getActiveChatStorageIdentity_ACU,
} from '../../data/storage/chat-history';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import {
    cleanupUnreachableSummaryVectorIndexFiles_ACU,
    deleteSummaryVectorIndexExternal_ACU,
} from '../vector/summary-vector-index-storage-service';
import {
    clearSummaryVectorFlushTasksByScope_ACU,
    deleteSummaryVectorHotCacheByScope_ACU,
} from '../../data/storage/vector-index-hot-cache';
import { clearTableRuntimeWithoutReload_ACU, reloadStorageProvider } from '../table/table-storage-strategy';
import { loadOrCreateJsonTableFromChatHistory_ACU } from '../table/table-service';
import { isSqliteMode } from '../table/storage-mode';
import { notifyTemplateRuntimeCommitted_ACU } from '../../shared/template-runtime-change';
import type { ChatSummaryVectorIndexManifest_ACU, SummaryVectorIndexSafeGcScopeHint_ACU } from '../vector/summary-vector-index-types';
import { getImportStablePrefix_ACU } from '../../shared/constants';
import {
    getLorebookEntries_ACU,
    deleteLorebookEntries_ACU,
    isWorldbookApiAvailable_ACU,
} from '../worldbook/worldbook-service';
import { getInjectionTargetLorebook_ACU } from '../worldbook/injection-engine';

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

/** 硬清空结果的结构化契约 */
export type ChatDatabasePurgeResult_ACU = {
    /** 聊天数据是否已原子严格保存（派生资源清理失败不影响该标记） */
    saved: boolean;
    /** 被清空字段的消息条数（含用户首条消息；空会话为 0） */
    clearedMessageCount: number;
    /** 已从 chatMetadata 与 chat[0] 移除的 scope/Guide 容器名列表 */
    removedMetadata: string[];
    /** 严格保存成功后派生资源清理的警告（无则省略） */
    cleanupWarnings?: string[];
    /** 失败原因（saved=false 时存在） */
    error?: string;
};

// ════════════════════════════════════════════════════════════════
// 内部工具
// ════════════════════════════════════════════════════════════════

function cloneValue_ACU<T>(value: T): T {
    if (value === undefined) return value as T;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

/** 消息字段级快照（含存在性标记），用于保存失败回滚。 */
type MessageFieldSnapshot_ACU = {
    msg: any;
    fields: Array<{ field: string; existed: boolean; value: unknown }>;
};

function snapshotMessages_ACU(chat: any[]): MessageFieldSnapshot_ACU[] {
    return chat
        .filter((msg): msg is Record<string, unknown> => !!msg && typeof msg === 'object')
        .map(msg => ({
            msg,
            fields: MESSAGE_TABLE_FIELDS_ACU.map(field => ({
                field,
                existed: Object.prototype.hasOwnProperty.call(msg, field),
                value: cloneValue_ACU((msg as Record<string, unknown>)[field]),
            })),
        }));
}

function restoreMessages_ACU(snapshots: MessageFieldSnapshot_ACU[]): void {
    for (const snapshot of snapshots) {
        for (const entry of snapshot.fields) {
            if (entry.existed) {
                snapshot.msg[entry.field] = entry.value;
            } else {
                delete snapshot.msg[entry.field];
            }
        }
    }
}

/** chat[0] 上的 scope/Guide 镜像快照。 */
type FirstMessageScopeSnapshot_ACU = {
    first: Record<string, unknown> | null;
    fields: Array<{ field: string; existed: boolean; value: unknown }>;
};

function snapshotFirstMessageScope_ACU(chat: any[]): FirstMessageScopeSnapshot_ACU {
    const first = Array.isArray(chat) && chat.length > 0 && chat[0] && typeof chat[0] === 'object'
        ? chat[0] as Record<string, unknown>
        : null;
    return {
        first,
        fields: FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU.map(field => ({
            field,
            existed: first ? Object.prototype.hasOwnProperty.call(first, field) : false,
            value: first ? cloneValue_ACU(first[field]) : undefined,
        })),
    };
}

function restoreFirstMessageScope_ACU(snapshot: FirstMessageScopeSnapshot_ACU): void {
    if (!snapshot.first) return;
    for (const entry of snapshot.fields) {
        if (entry.existed) {
            snapshot.first[entry.field] = entry.value;
        } else {
            delete snapshot.first[entry.field];
        }
    }
}

/** 当前聊天在清理前后的身份标识（事务内自证归属；与 assertFresh 的版本校验互为双保险，覆盖聊天切换这一版本快照不感知的维度）。 */
function captureChatIdentity_ACU(): string {
    return getActiveChatStorageIdentity_ACU(getChatArray_ACU());
}

function describeChatIdentityChange_ACU(before: string, after: string): string {
    return `当前聊天标识在硬清空期间发生变化（before=${before || '<空>'}，after=${after || '<空>'}），已中止并回滚。`;
}

/**
 * 恢复内存快照并严格保存回滚结果。
 * 原始严格保存失败后，如果回滚保存也失败，必须把双重故障暴露给调用方；静默吞掉
 * 回滚失败会让宿主磁盘状态和内存状态不可判断，事故复盘毫无意义。
 */
async function restoreAndPersistRollback_ACU(
    messageSnapshots: MessageFieldSnapshot_ACU[],
    scopeSnapshot: FirstMessageScopeSnapshot_ACU,
    metadataSnapshot: Parameters<typeof restoreChatMetadataFields_ACU>[0],
): Promise<string | null> {
    restoreMessages_ACU(messageSnapshots);
    restoreFirstMessageScope_ACU(scopeSnapshot);
    restoreChatMetadataFields_ACU(metadataSnapshot);
    try {
        await saveChatToHostStrict_ACU();
        return null;
    } catch (error: any) {
        return error?.message || String(error || '未知错误');
    }
}

// ════════════════════════════════════════════════════════════════
// 派生资源清理（严格保存成功后调用；失败仅收集警告）
// ════════════════════════════════════════════════════════════════

/**
 * 从已清空的消息字段中收集外置向量 manifest 并删除外置资源。
 * 在消息清空后调用（manifest 仍可从快照中恢复，用于定位外置文件）。
 */
async function cleanupVectorManifestsFromSnapshots_ACU(
    snapshots: MessageFieldSnapshot_ACU[],
): Promise<string[]> {
    const warnings: string[] = [];
    const seen = new Set<string>();
    const manifests: ChatSummaryVectorIndexManifest_ACU[] = [];
    const scopeHints = new Map<string, SummaryVectorIndexSafeGcScopeHint_ACU>();

    for (const snapshot of snapshots) {
        for (const entry of snapshot.fields) {
            if (entry.field !== 'TavernDB_ACU_IsolatedData' || !entry.existed) continue;
            let isolated = entry.value as Record<string, any> | null;
            if (typeof isolated === 'string') {
                try {
                    const parsed = JSON.parse(isolated);
                    isolated = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
                } catch {
                    isolated = null;
                }
            }
            if (!isolated || typeof isolated !== 'object' || Array.isArray(isolated)) continue;
            for (const tagData of Object.values(isolated)) {
                if (!tagData || typeof tagData !== 'object') continue;
                const manifest = tagData.summaryVectorIndexManifest || tagData.summaryVectorIndexState?.manifest || null;
                if (!manifest || typeof manifest !== 'object') continue;
                const key = String(manifest.indexId ?? JSON.stringify(manifest));
                if (seen.has(key)) continue;
                seen.add(key);
                manifests.push(manifest);
                const isolationKey = String(manifest.isolationKey ?? '').trim();
                const sourceTableKey = String(manifest.sourceTableKey ?? '').trim();
                const chatKey = String(manifest.chatKey ?? '').trim();
                // Safe GC 要求 isolation/sourceTable 双方可证明；不完整 manifest 只删其
                // 明确引用的资源，不根据文件名猜测 scope。
                if (isolationKey && sourceTableKey) {
                    const hint = { chatKey, isolationKey, sourceTableKey };
                    scopeHints.set(`${chatKey}\n${isolationKey}\n${sourceTableKey}`, hint);
                }
            }
        }
    }

    for (const manifest of manifests) {
        try {
            await deleteSummaryVectorIndexExternal_ACU(manifest);
        } catch (error: any) {
            const warning = `外置向量索引资源清理失败：${error?.message || String(error || '未知错误')}`;
            warnings.push(warning);
            logWarn_ACU(`[硬清空] ${warning}`, error);
        }
    }

    for (const hint of scopeHints.values()) {
        try {
            await deleteSummaryVectorHotCacheByScope_ACU(hint);
            await clearSummaryVectorFlushTasksByScope_ACU(hint);
        } catch (error: any) {
            const warning = `向量热缓存或 flush 任务清理失败（${hint.isolationKey}/${hint.sourceTableKey}）：${error?.message || String(error || '未知错误')}`;
            warnings.push(warning);
            logWarn_ACU(`[硬清空] ${warning}`, error);
        }
    }

    if (scopeHints.size > 0) {
        try {
            const gc = await cleanupUnreachableSummaryVectorIndexFiles_ACU({ scopeHints: [...scopeHints.values()] });
            gc.failedDeletes.forEach(item => warnings.push(`向量安全 GC 删除失败（${item.path}）：${item.error}`));
        } catch (error: any) {
            const warning = `向量安全 GC 执行失败：${error?.message || String(error || '未知错误')}`;
            warnings.push(warning);
            logWarn_ACU(`[硬清空] ${warning}`, error);
        }
    }
    return warnings;
}

/**
 * 清理数据库生成的 Wrapper / PersonsHeader / Memory 世界书条目（全部隔离前缀 + 无前缀）。
 * 保留受 import stable prefix 保护的外部导入条目。
 */
async function cleanupDatabaseGeneratedWorldbookEntries_ACU(): Promise<string[]> {
    const warnings: string[] = [];
    const importPrefix = getImportStablePrefix_ACU();
    const commentTargets = [
        'TavernDB-ACU-WrapperStart',
        'TavernDB-ACU-WrapperEnd',
        'TavernDB-ACU-PersonsHeader',
        'TavernDB-ACU-MemoryStart',
        'TavernDB-ACU-MemoryEnd',
    ];

    if (!isWorldbookApiAvailable_ACU()) return warnings;

    const lorebookNames = new Set<string>();
    try {
        const target = await getInjectionTargetLorebook_ACU();
        if (target) lorebookNames.add(target);
    } catch (error: any) {
        warnings.push(`无法获取注入目标世界书：${error?.message || String(error || '未知错误')}`);
        logWarn_ACU('[硬清空] 无法获取注入目标世界书，跳过数据库派生条目清理。', error);
        return warnings;
    }

    for (const lorebookName of lorebookNames) {
        try {
            const entries = await getLorebookEntries_ACU(lorebookName);
            const uids = entries
                .filter(entry => {
                    if (isImportProtectedComment_ACU(entry.comment, importPrefix)) return false;
                    const comment = String(entry.comment || '');
                    return commentTargets.some(target =>
                        comment === target || new RegExp(`^ACU-\\[[^\\]]+\\]-${target}$`).test(comment),
                    );
                })
                .map(entry => entry.uid);
            if (uids.length > 0) {
                await deleteLorebookEntries_ACU(lorebookName, uids);
                logDebug_ACU(`[硬清空] 已清理数据库生成的世界书条目：${uids.length}`);
            }
        } catch (error: any) {
            const warning = `数据库派生世界书条目清理失败（${lorebookName}）：${error?.message || String(error || '未知错误')}`;
            warnings.push(warning);
            logWarn_ACU(`[硬清空] ${warning}`, error);
        }
    }
    return warnings;
}

function isImportProtectedComment_ACU(comment: unknown, importPrefix: string): boolean {
    const rawComment = String(comment || '');
    return rawComment.startsWith(importPrefix) || rawComment.includes(importPrefix);
}


// ════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════════

/**
 * 原子硬清空当前聊天的全部本地数据库持久化痕迹。
 *
 * 流程：
 * 1. 在独占表写事务内快照全部消息字段与 chat[0] scope/Guide 镜像，并记录
 *    清理前聊天身份标识；
 * 2. 清空全部消息字段与 chat[0] scope/Guide 镜像（chatMetadata 容器经
 *    setChatScopedConfigContainer_ACU / setChatSheetGuideContainer_ACU 同步清空）；
 * 3. 清理前/后复核聊天身份标识一致（assertFresh 校验的是表版本，不感知聊天
 *    切换，purge 必须自证归属），不一致则回滚并中止；
 * 4. 残留扫描：仍存在任一本地字段/镜像则拒绝严格保存（fail-closed）；
 * 5. saveChatToHostStrict_ACU 严格保存；失败按快照回滚并返回 error；
 * 6. 保存成功后复核残留为空；再清理外置向量资源与数据库派生世界书条目，
 *    失败只收集 cleanupWarnings，不回滚已提交的聊天数据。
 *
 * 不调用 collectInitialCheckpointSlotsForFullDeletion_ACU，不保留任何
 * init/boundary frame；保留 qrf_plot* 与受 import stable prefix 保护的条目。
 */
/**
 * purge 成功后的回落：runtime 从当前全局模板重建 header-only 空结构（S1-1）。
 *
 * - 必须在 purge 独占事务之外执行：loadOrCreate/reloadStorageProvider 链路
 *   自带事务与 Guide 保存，事务内调用会嵌套死锁。
 * - loadOrCreateJsonTableFromChatHistory_ACU 内部先 applyTemplateScopeForCurrentChat
 *   （scope override 已被清除 → 回落全局模板，名称/内存对齐），聊天无表数据时
 *   从模板初始化 header-only 结构到内存（不写聊天记录，pristine 保持）。
 * - 失败降级为警告，不推翻已成功的 purge。
 */
async function rebuildEmptyRuntimeFromGlobalTemplateAfterPurge_ACU(): Promise<string[]> {
    try {
        const loadResult = await loadOrCreateJsonTableFromChatHistory_ACU();
        if (isSqliteMode()) {
            await reloadStorageProvider();
        }
        if (!loadResult.loaded) {
            return [`硬清空已完成，但回落全局模板空结构失败：${loadResult.error || '模板初始化未完成'}。`];
        }
        logDebug_ACU('[硬清空] 运行时已回落为当前全局模板的 header-only 空结构（pristine）。');
        // S1-2：回落即模板运行时变更，广播给模板面板刷新名称/徽标/下拉（回落失败不广播）。
        notifyTemplateRuntimeCommitted_ACU();
        return [];
    } catch (error: any) {
        const message = error?.message || String(error || '未知错误');
        logWarn_ACU(`[硬清空] 回落全局模板空结构失败：${message}`, error);
        return [`硬清空已完成，但回落全局模板空结构失败：${message}。`];
    }
}

export async function purgeCurrentChatDatabaseState_ACU(): Promise<ChatDatabasePurgeResult_ACU> {
    const result = await purgeCurrentChatDatabaseStateCore_ACU();
    if (!result.saved) return result;
    const rebuildWarnings = await rebuildEmptyRuntimeFromGlobalTemplateAfterPurge_ACU();
    if (rebuildWarnings.length === 0) return result;
    return {
        ...result,
        cleanupWarnings: [...(result.cleanupWarnings || []), ...rebuildWarnings],
    };
}

async function purgeCurrentChatDatabaseStateCore_ACU(): Promise<ChatDatabasePurgeResult_ACU> {
    const emptyResult: ChatDatabasePurgeResult_ACU = { saved: false, clearedMessageCount: 0, removedMetadata: [], error: '当前聊天记录为空。' };
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
        return emptyResult;
    }

    const identityBefore = captureChatIdentity_ACU();

    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'purgeCurrentChatDatabaseState',
        isolationKey: '',
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
    }, async (): Promise<ChatDatabasePurgeResult_ACU> => {
        const liveChat = getChatArray_ACU();
        if (!Array.isArray(liveChat) || liveChat.length === 0) {
            return { ...emptyResult, error: '硬清空期间聊天记录变为空，已中止。' };
        }

        // ── 快照 ──
        const messageSnapshots = snapshotMessages_ACU(liveChat);
        const scopeSnapshot = snapshotFirstMessageScope_ACU(liveChat);
        const metadataSnapshot = snapshotChatMetadataFields_ACU([
            CHAT_SCOPED_CONFIG_FIELD_ACU,
            CHAT_SHEET_GUIDE_FIELD_ACU,
        ]);
        const removedMetadata: string[] = [];

        // ── 清空消息字段 ──
        let clearedMessageCount = 0;
        for (const msg of liveChat) {
            if (!msg || typeof msg !== 'object') continue;
            const hadField = scanResidualTableFields_ACU(msg).length > 0;
            clearAllTableFields_ACU(msg);
            if (hadField) clearedMessageCount += 1;
        }

        // ── 清空 chat[0] scope/Guide 镜像与 chatMetadata 容器 ──
        const hadScope = peekChatScopedConfigContainer_ACU(liveChat) !== null
            || scanResidualFirstMessageScopeFields_ACU(liveChat).includes('TavernDB_ACU_ScopedConfig');
        const hadGuide = peekChatSheetGuideContainer_ACU(liveChat) !== null
            || scanResidualFirstMessageScopeFields_ACU(liveChat).includes('TavernDB_ACU_InternalSheetGuide');
        const hadLegacyGuide = scanResidualFirstMessageScopeFields_ACU(liveChat).includes('TavernDB_ACU_TableHeaderGuide');

        setChatScopedConfigContainer_ACU(liveChat, null);
        setChatSheetGuideContainer_ACU(liveChat, null);
        const first = Array.isArray(liveChat) && liveChat.length > 0 ? liveChat[0] : null;
        if (first && typeof first === 'object') {
            delete (first as Record<string, unknown>)['TavernDB_ACU_TableHeaderGuide'];
        }

        if (hadScope) removedMetadata.push('TavernDB_ACU_ScopedConfig');
        if (hadGuide) removedMetadata.push('TavernDB_ACU_InternalSheetGuide');
        if (hadLegacyGuide) removedMetadata.push('TavernDB_ACU_TableHeaderGuide');

        // ── 身份复核（事务内自证归属） ──
        const identityAfter = captureChatIdentity_ACU();
        if (identityBefore !== identityAfter) {
            restoreMessages_ACU(messageSnapshots);
            restoreFirstMessageScope_ACU(scopeSnapshot);
            restoreChatMetadataFields_ACU(metadataSnapshot);
            return { ...emptyResult, error: describeChatIdentityChange_ACU(identityBefore, identityAfter) };
        }

        // ── 残留扫描（fail-closed：任一残留都拒绝严格保存） ──
        const residualMessages: Array<{ index: number; fields: string[] }> = [];
        for (let index = 0; index < liveChat.length; index += 1) {
            const residual = scanResidualTableFields_ACU(liveChat[index]);
            if (residual.length > 0) residualMessages.push({ index, fields: residual });
        }
        const residualScopeFields = scanResidualFirstMessageScopeFields_ACU(liveChat);
        if (residualMessages.length > 0 || residualScopeFields.length > 0) {
            restoreMessages_ACU(messageSnapshots);
            restoreFirstMessageScope_ACU(scopeSnapshot);
            restoreChatMetadataFields_ACU(metadataSnapshot);
            return {
                ...emptyResult,
                error: `硬清空残留扫描未通过（消息残留=${residualMessages.map(item => `#${item.index}:${item.fields.join(',')}`).join('；') || '无'}；首条镜像残留=${residualScopeFields.join(',') || '无'}），已回滚。`,
            };
        }

        // ── 严格保存 ──
        try {
            await saveChatToHostStrict_ACU();
        } catch (error: any) {
            const rollbackError = await restoreAndPersistRollback_ACU(messageSnapshots, scopeSnapshot, metadataSnapshot);
            const saveError = error?.message || String(error || '未知错误');
            return {
                ...emptyResult,
                error: rollbackError
                    ? `硬清空严格保存失败（${saveError}）；内存已回滚，但回滚严格保存也失败（${rollbackError}）。`
                    : `硬清空严格保存失败，已回滚并严格保存恢复状态：${saveError}`,
            };
        }

        // ── 保存后复核（post-condition） ──
        const postResidualMessages: Array<{ index: number; fields: string[] }> = [];
        for (let index = 0; index < liveChat.length; index += 1) {
            const residual = scanResidualTableFields_ACU(liveChat[index]);
            if (residual.length > 0) postResidualMessages.push({ index, fields: residual });
        }
        const postResidualScopeFields = scanResidualFirstMessageScopeFields_ACU(liveChat);
        const postScopedConfig = peekChatScopedConfigContainer_ACU(liveChat);
        const postSheetGuide = peekChatSheetGuideContainer_ACU(liveChat);
        if (postResidualMessages.length > 0 || postResidualScopeFields.length > 0 || postScopedConfig !== null || postSheetGuide !== null) {
            return {
                saved: true,
                clearedMessageCount,
                removedMetadata,
                cleanupWarnings: [`硬清空已保存，但保存后残留扫描发现未清空状态（消息残留=${postResidualMessages.map(item => `#${item.index}:${item.fields.join(',')}`).join('；') || '无'}；首条镜像残留=${postResidualScopeFields.join(',') || '无'}；ScopedConfig=${postScopedConfig === null ? '无' : '存在'}；SheetGuide=${postSheetGuide === null ? '无' : '存在'}），请人工检查。`],
            };
        }

        // 严格保存与 post-condition 均已成立，才允许将当前运行时置为空态。
        // 事务内不做任何重建（reload 链路自带事务，嵌套会死锁）；事务结束后由
        // rebuildEmptyRuntimeFromGlobalTemplateAfterPurge_ACU 回落为当前全局模板的
        // header-only 空结构（S1-1，pristine：重建的是空结构不是旧数据）。
        clearTableRuntimeWithoutReload_ACU();

        // ── 派生资源清理（保存成功后；失败仅警告） ──
        const cleanupWarnings: string[] = [];
        cleanupWarnings.push(...await cleanupVectorManifestsFromSnapshots_ACU(messageSnapshots));
        cleanupWarnings.push(...await cleanupDatabaseGeneratedWorldbookEntries_ACU());

        logDebug_ACU(`[硬清空] 已完成当前聊天数据库状态硬清空：清空 ${clearedMessageCount} 条消息，移除 ${removedMetadata.join(', ') || '无'}。`);
        return {
            saved: true,
            clearedMessageCount,
            removedMetadata,
            ...(cleanupWarnings.length > 0 ? { cleanupWarnings } : {}),
        };
    });
}
