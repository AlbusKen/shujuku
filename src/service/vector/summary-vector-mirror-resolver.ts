/**
 * service/vector/summary-vector-mirror-resolver.ts — 纪要向量镜像的唯一读取入口
 *
 * 向量镜像与表格 V2 使用相同的楼层语义：
 *   vector head = Vector checkpoint @ C（表格 full checkpoint 楼层，表示 C 层 logEntries 之前的状态）
 *              + 按楼层序、frame 内按 seq 应用 C..H 全部 Vector delta（row_add / row_remove）
 *
 * 基底判定必须与 storage-frame-v2-replay.ts 的 replay 基底选择完全一致（含过渡根优先级），
 * 否则 resolver 认为 C 在某层而 replay 用另一层做基底，vector head 与表格 head 静默错位。
 *
 * 一致性规则（设计文档 R2 / R6 / D17）：
 * - delta 与来源 table entry 同生共死：sourceTableEntry.entryId 不在同 frame logEntries 中的 delta 是
 *   orphan，直接丢弃并标记 stale；
 * - delta 之间不维护 revision 链：删中间楼层会合法地移除一条 delta；
 * - row_add 的 rowId 已在 head、或 row_remove 的 rowId 不在 head → 链冲突，整条 delta 丢弃，
 *   由 rebuild_repair 修复；
 * - resolver 不读实时纪要表；dirty 判定（head rowId 集合 vs 实时表 rowId 集合）由调用方完成。
 *
 * 外置 manifest 的读取通过 loadManifest 注入，本模块不依赖存储层。
 */

import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { sha256Base64UrlSync_ACU } from '../../shared/sha256-sync';
import { toChatIsolationSlotKey_ACU } from '../../shared/summary-vector-index-scope';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { findLatestTransitionCheckpoint_ACU } from '../table/compat-transition-checkpoint';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import type {
    SummaryVectorChunkRef_ACU,
    SummaryVectorEmbeddingIdentity_ACU,
    SummaryVectorIndexMirrorCheckpointV2_ACU,
    SummaryVectorIndexMirrorFrameV2_ACU,
    SummaryVectorIndexMirrorLogEntryV2_ACU,
    SummaryVectorIndexMirrorOperationV2_ACU,
    SummaryVectorManifestRef_ACU,
    SummaryVectorPackRef_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';
import type {
    SummaryVectorMirrorDiagnostic_ACU,
    SummaryVectorMirrorHeadResult_ACU,
    SummaryVectorMirrorHeadStatus_ACU,
    SummaryVectorMirrorManifestRows_ACU,
} from './summary-vector-index-types';

export interface SummaryVectorMirrorFrameRef_ACU {
    messageIndex: number;
    frame: TableStorageFrameV2_ACU;
}

export type SummaryVectorMirrorManifestLoader_ACU = (
    ref: SummaryVectorManifestRef_ACU,
    checkpoint: SummaryVectorIndexMirrorCheckpointV2_ACU,
) => Promise<SummaryVectorMirrorManifestRows_ACU | null>;

export interface ResolveSummaryVectorMirrorHeadOptions_ACU {
    chat: any[] | null | undefined;
    isolationKey: string;
    sourceTableKey: string;
    loadManifest: SummaryVectorMirrorManifestLoader_ACU;
    /** 当前 embedding 配置身份；传入时与 checkpoint 不一致返回 embedding_identity_changed。 */
    embedding?: SummaryVectorEmbeddingIdentity_ACU;
    /** 只应用楼层 < 该值的 frame（compaction fold 用：新锚点自身的 delta 属于新 checkpoint 之后）。 */
    maxMessageIndexExclusive?: number;
}

// ─── frame 枚举与基底定位 ────────────────────────────────────────────────

/** 与 replay 的 getV2FrameRefs_ACU 一致：只看 AI 消息、按 chat 数组位置枚举。 */
export function collectSummaryVectorMirrorFrameRefs_ACU(
    chat: any[] | null | undefined,
    isolationKey: string,
    maxMessageIndexExclusive?: number,
): SummaryVectorMirrorFrameRef_ACU[] {
    const refs: SummaryVectorMirrorFrameRef_ACU[] = [];
    if (!Array.isArray(chat)) return refs;
    const slotKey = toChatIsolationSlotKey_ACU(isolationKey, getCurrentIsolationKey_ACU());
    const upperExclusive = maxMessageIndexExclusive === undefined
        ? chat.length
        : Math.max(0, Math.min(chat.length, Math.floor(maxMessageIndexExclusive)));
    for (let i = 0; i < upperExclusive; i += 1) {
        const message = chat[i];
        if (!message || message.is_user) continue;
        const tagData = readIsolatedTagData_ACU(message, slotKey);
        if (isV2TagData_ACU(tagData)) {
            refs.push({ messageIndex: i, frame: tagData.storageFrame });
        }
    }
    return refs;
}

/**
 * 定位表格 replay 的 full checkpoint 基底。返回 null 表示基底不是 full checkpoint
 * （过渡根接管 / 无 full → replacement anchor 或 temporary baseline），镜像不支持。
 *
 * 表达式与 storage-frame-v2-replay.ts:2375-2380 保持一致。
 */
export function locateSummaryVectorMirrorBase_ACU(
    chat: any[] | null | undefined,
    isolationKey: string,
    maxMessageIndexExclusive?: number,
): SummaryVectorMirrorFrameRef_ACU | null {
    const slotKey = toChatIsolationSlotKey_ACU(isolationKey, getCurrentIsolationKey_ACU());
    const refs = collectSummaryVectorMirrorFrameRefs_ACU(chat, slotKey, maxMessageIndexExclusive);
    const checkpointRef = [...refs].reverse().find((ref) => ref.frame.checkpoint?.kind === 'full') ?? null;
    const replayMaxInclusive = maxMessageIndexExclusive === undefined ? undefined : maxMessageIndexExclusive - 1;
    const transition = findLatestTransitionCheckpoint_ACU(chat, slotKey, replayMaxInclusive);
    if (transition && (!checkpointRef || checkpointRef.messageIndex <= transition.checkpoint.cutoff.messageIndex)) {
        return null;
    }
    return checkpointRef;
}

// ─── revision 计算（writer 与 resolver 共用同一公式）───────────────────────

function serializeChunkRefs_ACU(chunks: SummaryVectorChunkRef_ACU[]): string {
    return chunks.map((chunk) => `${chunk.packHash}#${chunk.chunkIndex}`).join(',');
}

/** checkpoint.vectorRevision：对 rowId 排序后连同 chunk 引用做 sha256。 */
export function computeSummaryVectorMirrorCheckpointRevision_ACU(
    rows: Iterable<{ rowId: string; chunks: SummaryVectorChunkRef_ACU[] }>,
): string {
    const lines = Array.from(rows)
        .map((row) => `${row.rowId}\t${serializeChunkRefs_ACU(row.chunks)}`)
        .sort();
    return sha256Base64UrlSync_ACU(lines.join('\n'));
}

/** head vectorRevision：只由 checkpoint revision 与按序 applied delta entryId 决定，对 messageIndex 位移不敏感。 */
export function computeSummaryVectorMirrorHeadRevision_ACU(
    checkpointRevision: string,
    appliedDeltaEntryIds: readonly string[],
): string {
    return sha256Base64UrlSync_ACU([checkpointRevision, ...appliedDeltaEntryIds].join('\n'));
}

// ─── 结构校验 ────────────────────────────────────────────────────────────

function isNonEmptyString_ACU(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isPlainObject_ACU(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSummaryVectorEmbeddingIdentity_ACU(value: unknown): value is SummaryVectorEmbeddingIdentity_ACU {
    return isPlainObject_ACU(value)
        && typeof value.endpointFingerprint === 'string'
        && isNonEmptyString_ACU(value.model)
        && Number.isInteger(value.dimension) && value.dimension > 0
        && Number.isInteger(value.sourceTextVersion);
}

export function summaryVectorEmbeddingIdentityEquals_ACU(
    left: SummaryVectorEmbeddingIdentity_ACU,
    right: SummaryVectorEmbeddingIdentity_ACU,
): boolean {
    if (left.endpointFingerprint !== right.endpointFingerprint
        || left.model !== right.model
        || left.sourceTextVersion !== right.sourceTextVersion) {
        return false;
    }
    // dimension=0 表示配置尚未观测到向量长度（settings 没有 embeddingDimension）。
    // 落盘 checkpoint/delta 要求 dimension>0；发送前用 0 去比真实维度会把每次归档后的楼层误判成换模型。
    if (left.dimension > 0 && right.dimension > 0 && left.dimension !== right.dimension) {
        return false;
    }
    return true;
}

function isPackRef_ACU(value: unknown): value is SummaryVectorPackRef_ACU {
    return isPlainObject_ACU(value)
        && isNonEmptyString_ACU(value.packHash)
        && isNonEmptyString_ACU(value.path)
        && Number.isInteger(value.chunkCount) && value.chunkCount >= 0
        && Number.isFinite(value.byteLength) && value.byteLength >= 0;
}

function isChunkRef_ACU(value: unknown): value is SummaryVectorChunkRef_ACU {
    return isPlainObject_ACU(value)
        && isNonEmptyString_ACU(value.packHash)
        && Number.isInteger(value.chunkIndex) && value.chunkIndex >= 0;
}

function isManifestRef_ACU(value: unknown): value is SummaryVectorManifestRef_ACU {
    return isPlainObject_ACU(value)
        && isNonEmptyString_ACU(value.manifestHash)
        && isNonEmptyString_ACU(value.path)
        && Number.isFinite(value.byteLength) && value.byteLength >= 0;
}

export function isSummaryVectorMirrorCheckpoint_ACU(value: unknown): value is SummaryVectorIndexMirrorCheckpointV2_ACU {
    return isPlainObject_ACU(value)
        && value.kind === 'vector_full'
        && Number.isFinite(value.createdAt)
        && isNonEmptyString_ACU(value.reason)
        && isNonEmptyString_ACU(value.sourceTableKey)
        && typeof value.tableCheckpointFingerprint === 'string'
        && isSummaryVectorEmbeddingIdentity_ACU(value.embedding)
        && Number.isInteger(value.rowCount) && value.rowCount >= 0
        && isNonEmptyString_ACU(value.vectorRevision)
        && isManifestRef_ACU(value.manifestRef)
        && Array.isArray(value.packRefs) && value.packRefs.every(isPackRef_ACU);
}

/**
 * delta 结构校验：operations 非空；row_add 必须带非空 chunks，且引用的 packHash 全部出现在
 * 本 delta 的 packRefs 中（每条 delta 对 GC 自包含）。
 * 返回 null 表示合法，否则返回原因。
 */
export function validateSummaryVectorMirrorDelta_ACU(value: unknown): string | null {
    if (!isPlainObject_ACU(value)) return 'delta 不是对象';
    if (!Number.isFinite(value.seq)) return 'seq 不是有限数';
    if (!isNonEmptyString_ACU(value.entryId)) return 'entryId 为空';
    if (!Number.isFinite(value.createdAt)) return 'createdAt 不是有限数';
    const source = value.sourceTableEntry;
    if (!isPlainObject_ACU(source) || !isNonEmptyString_ACU(source.entryId)) return 'sourceTableEntry.entryId 为空';
    if (source.commitRevision !== null && typeof source.commitRevision !== 'string') return 'sourceTableEntry.commitRevision 类型非法';
    if (!isSummaryVectorEmbeddingIdentity_ACU(value.embedding)) return 'embedding 身份非法';
    if (!Array.isArray(value.packRefs) || !value.packRefs.every(isPackRef_ACU)) return 'packRefs 非法';
    if (!Array.isArray(value.operations) || value.operations.length === 0) return 'operations 为空';
    const ownPackHashes = new Set<string>((value.packRefs as SummaryVectorPackRef_ACU[]).map((ref) => ref.packHash));
    for (const operation of value.operations as unknown[]) {
        if (!isPlainObject_ACU(operation)) return 'operation 不是对象';
        if (!isNonEmptyString_ACU(operation.rowId)) return 'operation.rowId 为空';
        if (operation.kind === 'row_remove') continue;
        if (operation.kind !== 'row_add') return `未知 operation kind=${String(operation.kind)}`;
        if (!Array.isArray(operation.chunks) || operation.chunks.length === 0) return `row_add rowId=${operation.rowId} 缺少 chunks`;
        if (!operation.chunks.every(isChunkRef_ACU)) return `row_add rowId=${operation.rowId} 的 chunk 引用非法`;
        if (typeof operation.vectorSourceHash !== 'string') return `row_add rowId=${operation.rowId} 缺少 vectorSourceHash`;
        for (const chunk of operation.chunks as SummaryVectorChunkRef_ACU[]) {
            if (!ownPackHashes.has(chunk.packHash)) {
                return `row_add rowId=${operation.rowId} 引用的 pack ${chunk.packHash} 不在本 delta 的 packRefs 中`;
            }
        }
    }
    return null;
}

export function isSummaryVectorMirrorFrame_ACU(value: unknown): value is SummaryVectorIndexMirrorFrameV2_ACU {
    return isPlainObject_ACU(value)
        && value.version === 3
        && isNonEmptyString_ACU(value.sourceTableKey)
        && Array.isArray(value.logEntries)
        && (value.checkpoint === undefined || isSummaryVectorMirrorCheckpoint_ACU(value.checkpoint));
}

/**
 * frame 级不变量断言（写入方在 strict save 前调用；与 assertSingleActiveFullCheckpointV2_ACU 同风格）：
 * - 镜像 frame 结构合法；
 * - vector checkpoint 只允许出现在表格 full checkpoint 所在 frame；
 * - 同一隔离键至多一个 vector checkpoint；
 * - 每条 delta 结构合法，同 frame 内 delta entryId 唯一。
 * 命中不变量返回 null，否则返回可直接写入日志的违规描述。
 */
export function assertSummaryVectorMirrorFrameInvariantsV2_ACU(
    chat: any[] | null | undefined,
    isolationKey: string,
    context: string,
): string | null {
    const refs = collectSummaryVectorMirrorFrameRefs_ACU(chat, isolationKey);
    const checkpointFrames: number[] = [];
    for (const ref of refs) {
        const mirror: unknown = ref.frame.summaryVectorIndexFrame;
        if (mirror === undefined) continue;
        if (!isSummaryVectorMirrorFrame_ACU(mirror)) {
            return `V2 ${context} 违反向量镜像不变量：楼层 #${ref.messageIndex} 的 summaryVectorIndexFrame 结构非法。`;
        }
        if (mirror.checkpoint) {
            if (ref.frame.checkpoint?.kind !== 'full') {
                return `V2 ${context} 违反向量镜像不变量：楼层 #${ref.messageIndex} 没有表格 full checkpoint 却存在 vector checkpoint。`;
            }
            checkpointFrames.push(ref.messageIndex);
        }
        const seenEntryIds = new Set<string>();
        for (const delta of mirror.logEntries) {
            const reason = validateSummaryVectorMirrorDelta_ACU(delta);
            if (reason) {
                return `V2 ${context} 违反向量镜像不变量：楼层 #${ref.messageIndex} 的 vector delta 非法（${reason}）。`;
            }
            if (seenEntryIds.has(delta.entryId)) {
                return `V2 ${context} 违反向量镜像不变量：楼层 #${ref.messageIndex} 存在重复的 vector delta entryId=${delta.entryId}。`;
            }
            seenEntryIds.add(delta.entryId);
        }
    }
    if (checkpointFrames.length > 1) {
        return `V2 ${context} 违反向量镜像不变量：同一隔离键下存在 ${checkpointFrames.length} 个 vector checkpoint（${checkpointFrames.map((index) => `#${index}`).join('、')}）。`;
    }
    return null;
}

// ─── head 解析 ───────────────────────────────────────────────────────────

function buildEmptyResult_ACU(
    status: SummaryVectorMirrorHeadStatus_ACU,
    sourceTableKey: string,
    checkpointMessageIndex: number | null,
    checkpoint: SummaryVectorIndexMirrorCheckpointV2_ACU | null,
    diagnostics: SummaryVectorMirrorDiagnostic_ACU[],
): SummaryVectorMirrorHeadResult_ACU {
    return {
        status,
        sourceTableKey,
        checkpointMessageIndex,
        checkpoint,
        head: new Map(),
        vectorRevision: '',
        packRefs: [],
        appliedDeltaEntryIds: [],
        appliedTableEntryIds: [],
        stale: false,
        chainConflict: false,
        diagnostics,
    };
}

function sortDeltasBySeq_ACU(
    deltas: SummaryVectorIndexMirrorLogEntryV2_ACU[],
    messageIndex: number,
    diagnostics: SummaryVectorMirrorDiagnostic_ACU[],
): SummaryVectorIndexMirrorLogEntryV2_ACU[] {
    const indexed = deltas.map((delta, index) => ({ delta, index }));
    indexed.sort((left, right) => {
        const seqDiff = Number(left.delta?.seq) - Number(right.delta?.seq);
        if (Number.isFinite(seqDiff) && seqDiff !== 0) return seqDiff;
        return left.index - right.index;
    });
    const seenSeq = new Set<number>();
    for (const { delta } of indexed) {
        const seq = Number(delta?.seq);
        if (!Number.isFinite(seq)) continue;
        if (seenSeq.has(seq)) {
            diagnostics.push({
                code: 'duplicate_delta_seq',
                messageIndex,
                entryId: typeof delta?.entryId === 'string' ? delta.entryId : undefined,
                detail: `楼层 #${messageIndex} 存在重复的 vector delta seq=${seq}，按数组顺序应用。`,
            });
        }
        seenSeq.add(seq);
    }
    return indexed.map((item) => item.delta);
}

/**
 * 对单条 delta 做链一致性预检（R6）：
 * - 同一 delta 内同 rowId 不得出现两次；
 * - row_add 的 rowId 不得已在 head；row_remove 的 rowId 必须在 head。
 * 返回 null 表示可应用，否则返回冲突描述与 rowId。
 */
function checkDeltaChainConsistency_ACU(
    operations: SummaryVectorIndexMirrorOperationV2_ACU[],
    head: ReadonlyMap<string, SummaryVectorChunkRef_ACU[]>,
): { rowId: string; detail: string } | null {
    const seen = new Set<string>();
    for (const operation of operations) {
        if (seen.has(operation.rowId)) {
            return { rowId: operation.rowId, detail: `同一 delta 内 rowId=${operation.rowId} 出现多次` };
        }
        seen.add(operation.rowId);
        if (operation.kind === 'row_add' && head.has(operation.rowId)) {
            return { rowId: operation.rowId, detail: `row_add 的 rowId=${operation.rowId} 已存在于 head（中间没有 row_remove）` };
        }
        if (operation.kind === 'row_remove' && !head.has(operation.rowId)) {
            return { rowId: operation.rowId, detail: `row_remove 的 rowId=${operation.rowId} 不在 head 中` };
        }
    }
    return null;
}

export async function resolveSummaryVectorMirrorHead_ACU(
    options: ResolveSummaryVectorMirrorHeadOptions_ACU,
): Promise<SummaryVectorMirrorHeadResult_ACU> {
    const { chat, isolationKey, sourceTableKey, loadManifest, embedding, maxMessageIndexExclusive } = options;
    const diagnostics: SummaryVectorMirrorDiagnostic_ACU[] = [];

    const base = locateSummaryVectorMirrorBase_ACU(chat, isolationKey, maxMessageIndexExclusive);
    if (!base || !base.frame.checkpoint) {
        return buildEmptyResult_ACU('unsupported_replay_base', sourceTableKey, null, null, diagnostics);
    }

    const baseMirror: unknown = base.frame.summaryVectorIndexFrame;
    if (!isSummaryVectorMirrorFrame_ACU(baseMirror) || !baseMirror.checkpoint) {
        return buildEmptyResult_ACU('no_mirror', sourceTableKey, base.messageIndex, null, diagnostics);
    }
    const checkpoint = baseMirror.checkpoint;
    if (baseMirror.sourceTableKey !== sourceTableKey || checkpoint.sourceTableKey !== sourceTableKey) {
        return buildEmptyResult_ACU('source_table_changed', sourceTableKey, base.messageIndex, checkpoint, diagnostics);
    }
    const actualFingerprint = getTableDataFingerprint_ACU(base.frame.checkpoint.data);
    if (checkpoint.tableCheckpointFingerprint !== actualFingerprint) {
        return buildEmptyResult_ACU('checkpoint_mismatch', sourceTableKey, base.messageIndex, checkpoint, diagnostics);
    }
    if (embedding && !summaryVectorEmbeddingIdentityEquals_ACU(embedding, checkpoint.embedding)) {
        return buildEmptyResult_ACU('embedding_identity_changed', sourceTableKey, base.messageIndex, checkpoint, diagnostics);
    }

    let manifest: SummaryVectorMirrorManifestRows_ACU | null = null;
    try {
        manifest = await loadManifest(checkpoint.manifestRef, checkpoint);
    } catch (error: any) {
        diagnostics.push({
            code: 'manifest_load_failed',
            messageIndex: base.messageIndex,
            detail: `读取 checkpoint manifest 失败：${error?.message || String(error || '未知错误')}`,
        });
        manifest = null;
    }
    if (!manifest || manifest.schema !== 'summary_vector_mirror_manifest' || !Array.isArray(manifest.rows)) {
        if (manifest) {
            diagnostics.push({
                code: 'manifest_load_failed',
                messageIndex: base.messageIndex,
                detail: 'checkpoint manifest 结构非法。',
            });
        }
        return buildEmptyResult_ACU('manifest_unavailable', sourceTableKey, base.messageIndex, checkpoint, diagnostics);
    }

    const head = new Map<string, SummaryVectorChunkRef_ACU[]>();
    for (const row of manifest.rows) {
        if (!isPlainObject_ACU(row) || !isNonEmptyString_ACU(row.rowId) || !Array.isArray(row.chunks)) continue;
        if (head.has(row.rowId)) {
            diagnostics.push({
                code: 'manifest_duplicate_row_id',
                messageIndex: base.messageIndex,
                rowId: row.rowId,
                detail: `checkpoint manifest 中 rowId=${row.rowId} 重复，后者覆盖前者。`,
            });
        }
        head.set(row.rowId, (row.chunks as SummaryVectorChunkRef_ACU[]).filter(isChunkRef_ACU).map((chunk) => ({ ...chunk })));
    }

    const packRefsByHash = new Map<string, SummaryVectorPackRef_ACU>();
    checkpoint.packRefs.forEach((ref) => packRefsByHash.set(ref.packHash, { ...ref }));
    const appliedDeltaEntryIds: string[] = [];
    const appliedTableEntryIds: string[] = [];
    let stale = false;
    let chainConflict = false;

    const refs = collectSummaryVectorMirrorFrameRefs_ACU(chat, isolationKey, maxMessageIndexExclusive);
    for (const ref of refs) {
        if (ref.messageIndex < base.messageIndex) continue;
        const mirror: unknown = ref.frame.summaryVectorIndexFrame;
        if (mirror === undefined) continue;
        if (!isSummaryVectorMirrorFrame_ACU(mirror)) {
            diagnostics.push({
                code: 'invalid_delta',
                messageIndex: ref.messageIndex,
                detail: `楼层 #${ref.messageIndex} 的 summaryVectorIndexFrame 结构非法，本层 delta 全部跳过。`,
            });
            stale = true;
            continue;
        }
        // 基底是最后一个 full checkpoint，之后的 frame 不可能再有 full checkpoint，
        // 因此这里出现的 vector checkpoint 一定缺少表格锚点。
        if (ref.messageIndex !== base.messageIndex && mirror.checkpoint) {
            diagnostics.push({
                code: 'misplaced_checkpoint',
                messageIndex: ref.messageIndex,
                detail: `楼层 #${ref.messageIndex} 没有表格 full checkpoint 却存在 vector checkpoint，已忽略；只认基底楼层 #${base.messageIndex}。`,
            });
        }
        if (mirror.sourceTableKey !== sourceTableKey) {
            diagnostics.push({
                code: 'invalid_delta',
                messageIndex: ref.messageIndex,
                detail: `楼层 #${ref.messageIndex} 的镜像 sourceTableKey=${mirror.sourceTableKey} 与当前纪要表 ${sourceTableKey} 不一致，本层 delta 全部跳过。`,
            });
            stale = true;
            continue;
        }

        const tableEntryIds = new Set<string>(
            (Array.isArray(ref.frame.logEntries) ? ref.frame.logEntries : [])
                .map((entry) => entry?.entryId)
                .filter((entryId): entryId is string => typeof entryId === 'string' && entryId.length > 0),
        );
        const deltas = sortDeltasBySeq_ACU(mirror.logEntries, ref.messageIndex, diagnostics);
        for (const delta of deltas) {
            const invalidReason = validateSummaryVectorMirrorDelta_ACU(delta);
            if (invalidReason) {
                diagnostics.push({
                    code: 'invalid_delta',
                    messageIndex: ref.messageIndex,
                    entryId: typeof delta?.entryId === 'string' ? delta.entryId : undefined,
                    detail: `楼层 #${ref.messageIndex} 的 vector delta 结构非法（${invalidReason}），已丢弃。`,
                });
                stale = true;
                continue;
            }
            if (!tableEntryIds.has(delta.sourceTableEntry.entryId)) {
                diagnostics.push({
                    code: 'orphan_delta',
                    messageIndex: ref.messageIndex,
                    entryId: delta.entryId,
                    detail: `楼层 #${ref.messageIndex} 的 vector delta 来源 table entry ${delta.sourceTableEntry.entryId} 已不存在，已丢弃。`,
                });
                stale = true;
                continue;
            }
            if (!summaryVectorEmbeddingIdentityEquals_ACU(delta.embedding, checkpoint.embedding)) {
                diagnostics.push({
                    code: 'delta_embedding_mismatch',
                    messageIndex: ref.messageIndex,
                    entryId: delta.entryId,
                    detail: `楼层 #${ref.messageIndex} 的 vector delta embedding 身份（${delta.embedding.model}/${delta.embedding.dimension}）与 checkpoint（${checkpoint.embedding.model}/${checkpoint.embedding.dimension}）不一致，已丢弃。`,
                });
                stale = true;
                continue;
            }
            const conflict = checkDeltaChainConsistency_ACU(delta.operations, head);
            if (conflict) {
                diagnostics.push({
                    code: 'chain_conflict',
                    messageIndex: ref.messageIndex,
                    entryId: delta.entryId,
                    rowId: conflict.rowId,
                    detail: `楼层 #${ref.messageIndex} 的 vector delta 链冲突：${conflict.detail}，整条 delta 已丢弃。`,
                });
                chainConflict = true;
                stale = true;
                continue;
            }
            for (const operation of delta.operations) {
                if (operation.kind === 'row_add') {
                    head.set(operation.rowId, operation.chunks.map((chunk) => ({ ...chunk })));
                } else {
                    head.delete(operation.rowId);
                }
            }
            delta.packRefs.forEach((packRef) => {
                if (!packRefsByHash.has(packRef.packHash)) packRefsByHash.set(packRef.packHash, { ...packRef });
            });
            appliedDeltaEntryIds.push(delta.entryId);
            appliedTableEntryIds.push(delta.sourceTableEntry.entryId);
        }
    }

    return {
        status: 'ok',
        sourceTableKey,
        checkpointMessageIndex: base.messageIndex,
        checkpoint,
        head,
        vectorRevision: computeSummaryVectorMirrorHeadRevision_ACU(checkpoint.vectorRevision, appliedDeltaEntryIds),
        packRefs: Array.from(packRefsByHash.values()),
        appliedDeltaEntryIds,
        appliedTableEntryIds,
        stale,
        chainConflict,
        diagnostics,
    };
}
