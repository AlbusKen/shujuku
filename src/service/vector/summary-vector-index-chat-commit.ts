// ════════════════════════════════════════════════════════════════
// 向量 metadata 事务提交 helper（统一 patch + rollback + strict save 语义）
// ════════════════════════════════════════════════════════════════

import { patchIsolatedTagMetadata_ACU } from '../../data/repositories/chat-message-data-repo';
import { saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import type { IsolationTagData_ACU } from '../../data/models/chat-message-data';

/**
 * 在提交时捕获消息上将被事务修改的字段（存在性 + 原值，保留字符串容器原格式）。
 */
export function captureVectorCommitMessageState_ACU(
    message: any,
    fields: readonly string[],
): Map<string, { exists: boolean; value: unknown }> {
    return new Map(fields.map((field) => [
        field,
        { exists: Object.prototype.hasOwnProperty.call(message, field), value: message[field] },
    ]));
}

/**
 * 恢复消息字段到捕获状态；保留原值类型（含字符串形式的 isolated container）。
 */
export function restoreVectorCommitMessageState_ACU(
    message: any,
    snapshot: Map<string, { exists: boolean; value: unknown }>,
): void {
    snapshot.forEach(({ exists, value }, field) => {
        if (exists) message[field] = value;
        else delete message[field];
    });
}

/**
 * 单消息向量 metadata 事务提交。
 *
 * 语义：
 * - 通过仓储 metadata patch 边界提交，只允许修改批准字段；
 * - 提交时从最新消息重新读取槽，支持 expectedIndexId CAS；
 * - strict save 失败时回滚消息字段（存在性、值、类型）；
 * - 返回 changed/no-op；不吞掉 programmer error。
 *
 * @param message 目标消息
 * @param isolationKey 隔离标签键名
 * @param patch 批准字段增量修改（undefined=不修改，null=删除）
 * @param options.expectedIndexId 可选 CAS 条件
 * @param options.additionalMutate 可选额外消息级 mutation（identity/anchor），在 patch 后、save 前执行，随事务回滚
 * @returns changed 是否发生变化（false 表示 no-op 或消息为空）
 */
export async function commitVectorMetadataPatch_ACU(
    message: any,
    isolationKey: string,
    patch: Partial<Pick<IsolationTagData_ACU, 'summaryVectorIndexState' | 'summaryVectorIndexManifest'>>,
    options?: {
        expectedIndexId?: string;
        additionalMutate?: (message: any) => void;
    },
): Promise<boolean> {
    if (!message) return false;

    const snapshot = captureVectorCommitMessageState_ACU(message, [
        'TavernDB_ACU_IsolatedData',
        'TavernDB_ACU_Identity',
        'TavernDB_ACU_IndependentData',
        'TavernDB_ACU_ModifiedKeys',
        'TavernDB_ACU_UpdateGroupKeys',
        '_acu_remote_memory_snapshot_anchor',
    ]);

    try {
        const result = patchIsolatedTagMetadata_ACU(message, isolationKey, patch, {
            expectedIndexId: options?.expectedIndexId,
        });
        if (!result.changed) return false;

        options?.additionalMutate?.(message);
        await saveChatToHostStrict_ACU();
        return true;
    } catch (error) {
        restoreVectorCommitMessageState_ACU(message, snapshot);
        throw error;
    }
}

/**
 * 批量向量 metadata 事务提交：逐消息执行内存 patch，全部成功后只 strict save 一次。
 *
 * 语义：
 * - 每层通过仓储 metadata patch 边界提交，只允许修改批准字段；
 * - 任一层 patch 失败、CAS 冲突或 strict save 失败时，回滚所有已修改消息的字段
 *   （存在性、值、类型），不留下前半批成功、后半批失败的内存态；
 * - 成功时只调用一次宿主严格保存；保存成功后才可继续外置文件清理。
 *
 * @param entries 待提交的消息列表（含 isolationKey 与 patch）
 * @param options.additionalMutate 可选每层额外 mutation，在 patch 后执行，随事务回滚。
 * 返回 true 表示该 mutation 本身构成一次需要 strict save 的变更（例如只清 V2 镜像帧）。
 * @returns 是否发生任何变化（false 表示全部 no-op 或空列表）
 */
export async function commitVectorMetadataPatchesBatch_ACU(
    entries: Array<{
        message: any;
        isolationKey: string;
        patch: Partial<Pick<IsolationTagData_ACU, 'summaryVectorIndexState' | 'summaryVectorIndexManifest'>>;
        expectedIndexId?: string;
    }>,
    options?: {
        additionalMutate?: (message: any) => void | boolean;
    },
): Promise<boolean> {
    if (!Array.isArray(entries) || entries.length === 0) return false;

    // 先对全部消息捕获快照（batch 开始时）。
    const snapshots = new Map<any, Map<string, { exists: boolean; value: unknown }>>();
    for (const entry of entries) {
        if (!entry.message) continue;
        snapshots.set(entry.message, captureVectorCommitMessageState_ACU(entry.message, [
            'TavernDB_ACU_IsolatedData',
            'TavernDB_ACU_Identity',
            'TavernDB_ACU_IndependentData',
            'TavernDB_ACU_ModifiedKeys',
            'TavernDB_ACU_UpdateGroupKeys',
            '_acu_remote_memory_snapshot_anchor',
        ]));
    }

    const rollbackAll = (): void => {
        snapshots.forEach((snapshot, message) => restoreVectorCommitMessageState_ACU(message, snapshot));
    };

    try {
        let changed = false;
        for (const entry of entries) {
            if (!entry.message) continue;
            const result = patchIsolatedTagMetadata_ACU(entry.message, entry.isolationKey, entry.patch, {
                expectedIndexId: entry.expectedIndexId,
            });
            if (result.changed) changed = true;
            if (options?.additionalMutate?.(entry.message) === true) changed = true;
        }
        if (!changed) {
            rollbackAll();
            return false;
        }
        await saveChatToHostStrict_ACU();
        return true;
    } catch (error) {
        rollbackAll();
        throw error;
    }
}
