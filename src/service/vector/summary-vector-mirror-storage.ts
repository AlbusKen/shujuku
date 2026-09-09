/**
 * service/vector/summary-vector-mirror-storage.ts — 镜像 pack / checkpoint manifest 的 content-addressed 读写
 *
 * pack 路径沿用现有族：TavernDB_ACU_vector_v2pack_<scopeToken>_<packKey>
 * checkpoint manifest 新路径：TavernDB_ACU_vector_v2vcp_<scopeToken>_<sha256>
 * 文件名保留 scope token，供 GC 按 scope 前缀筛选。写入走 prepared → published。
 */

import {
    buildVectorIndexContentPackPathV2_ACU,
    buildVectorIndexMirrorManifestPathV2_ACU,
    buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
    readVectorIndexJsonFile_ACU,
    registerVectorIndexFiles_ACU,
    sha256Text_ACU,
    uploadVectorIndexJsonFile_ACU,
} from '../../data/storage/vector-index-st-files-storage';
import { normalizeSummaryVectorIndexScope_ACU } from '../../shared/summary-vector-index-scope';
import type { SummaryVectorManifestRef_ACU, SummaryVectorPackRef_ACU } from '../table/storage-frame-v2-types';
import {
    buildContentPackBlob_ACU,
    serializeContentPackForHash_ACU,
} from './summary-vector-index-content-pack';
import type {
    SummaryVectorIndexContentPackBlob_ACU,
    SummaryVectorIndexContentPackChunk_ACU,
    SummaryVectorIndexExternalFileRef_ACU,
    SummaryVectorMirrorManifestRows_ACU,
} from './summary-vector-index-types';
import { SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU } from './summary-vector-index-types';

export interface PersistSummaryVectorMirrorPackParams_ACU {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    embeddingModel: string;
    dimension: number;
    chunks: SummaryVectorIndexContentPackChunk_ACU[];
}

export interface PersistSummaryVectorMirrorFileResult_ACU<TRef> {
    ref: TRef;
    file: SummaryVectorIndexExternalFileRef_ACU;
}

function encodeVectorToF32B64_ACU(vector: number[]): string {
    const bytes = new Uint8Array(vector.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < vector.length; index += 1) {
        const numeric = Number(vector[index]);
        if (!Number.isFinite(numeric)) {
            throw new Error(`镜像向量包含非有限数值，拒绝编码: index=${index}`);
        }
        view.setFloat32(index * 4, numeric, true);
    }
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 1) {
        binary += String.fromCharCode(bytes[offset]);
    }
    if (typeof globalThis.btoa !== 'function') throw new Error('当前环境缺少 btoa，无法编码镜像向量。');
    return globalThis.btoa(binary);
}

export function encodeSummaryVectorMirrorVector_ACU(vector: number[]): string {
    return encodeVectorToF32B64_ACU(vector);
}

export function decodeSummaryVectorMirrorVector_ACU(encoded: string): Float32Array {
    if (typeof globalThis.atob !== 'function') throw new Error('当前环境缺少 atob，无法解码镜像向量。');
    const binary = globalThis.atob(String(encoded || ''));
    if (binary.length % 4 !== 0) {
        throw new Error(`镜像向量 f32b64 字节长度非法: bytes=${binary.length}`);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    const view = new DataView(bytes.buffer);
    const vector = new Float32Array(bytes.length / 4);
    for (let offset = 0; offset < bytes.length; offset += 4) {
        vector[offset / 4] = view.getFloat32(offset, true);
    }
    return vector;
}

async function registerPrepared_ACU(file: SummaryVectorIndexExternalFileRef_ACU): Promise<void> {
    await registerVectorIndexFiles_ACU([{ ...file, publicationState: 'prepared' }]);
}

export async function finalizeSummaryVectorMirrorFiles_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<void> {
    const published = files
        .filter((file) => !!file?.path)
        .map((file) => ({ ...file, publicationState: 'published' as const }));
    if (published.length === 0) return;
    await registerVectorIndexFiles_ACU(published);
}

export async function persistSummaryVectorMirrorPackPrepared_ACU(
    params: PersistSummaryVectorMirrorPackParams_ACU,
): Promise<PersistSummaryVectorMirrorFileResult_ACU<SummaryVectorPackRef_ACU>> {
    const scope = normalizeSummaryVectorIndexScope_ACU(params);
    const packScope = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
    const blobDraft = buildContentPackBlob_ACU({
        packKey: '',
        packScope,
        embeddingModel: params.embeddingModel,
        dimension: params.dimension,
        chunks: params.chunks,
    });
    const packHash = await sha256Text_ACU(serializeContentPackForHash_ACU(blobDraft));
    const path = buildVectorIndexContentPackPathV2_ACU({
        ...scope,
        packKey: packHash,
    });
    const blob = buildContentPackBlob_ACU({
        packKey: packHash,
        packScope,
        embeddingModel: params.embeddingModel,
        dimension: params.dimension,
        chunks: params.chunks,
    });
    const existing = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(path);
    if (existing.ok && existing.data) {
        if (existing.data.schema !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU || String(existing.data.packKey || '') !== packHash) {
            throw new Error(`镜像 pack 路径冲突：path=${path} 已存在但内容与 packHash=${packHash} 不一致。`);
        }
        const json = JSON.stringify(existing.data);
        const file: SummaryVectorIndexExternalFileRef_ACU = {
            role: 'vector_pack',
            path,
            byteSize: json.length,
            checksum: await sha256Text_ACU(json),
            chunkCount: blob.chunks.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'ready',
            scope,
            publicationState: 'prepared',
        };
        await registerPrepared_ACU(file);
        return {
            ref: { packHash, path, chunkCount: blob.chunks.length, byteLength: json.length },
            file,
        };
    }
    const uploaded = await uploadVectorIndexJsonFile_ACU({
        path,
        role: 'vector_pack',
        data: blob,
        chunkCount: blob.chunks.length,
        rowCount: blob.chunks.length,
        status: 'ready',
    });
    if (!uploaded.ok || !uploaded.ref) {
        throw new Error(uploaded.error || `镜像 pack 上传失败: ${path}`);
    }
    uploaded.ref.scope = scope;
    uploaded.ref.publicationState = 'prepared';
    await registerPrepared_ACU(uploaded.ref);
    return {
        ref: {
            packHash,
            path,
            chunkCount: blob.chunks.length,
            byteLength: Number(uploaded.ref.byteSize) || JSON.stringify(blob).length,
        },
        file: uploaded.ref,
    };
}

export async function persistSummaryVectorMirrorManifestPrepared_ACU(params: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    rows: SummaryVectorMirrorManifestRows_ACU;
}): Promise<PersistSummaryVectorMirrorFileResult_ACU<SummaryVectorManifestRef_ACU>> {
    const scope = normalizeSummaryVectorIndexScope_ACU(params);
    const payload: SummaryVectorMirrorManifestRows_ACU = {
        schema: 'summary_vector_mirror_manifest',
        version: 1,
        sourceTableKey: scope.sourceTableKey,
        rows: Array.isArray(params.rows.rows) ? params.rows.rows : [],
    };
    const manifestHash = await sha256Text_ACU(JSON.stringify(payload));
    const path = buildVectorIndexMirrorManifestPathV2_ACU({
        ...scope,
        manifestHash,
    });
    const uploaded = await uploadVectorIndexJsonFile_ACU({
        path,
        role: 'manifest',
        data: payload,
        rowCount: payload.rows.length,
        status: 'ready',
    });
    if (!uploaded.ok || !uploaded.ref) {
        throw new Error(uploaded.error || `镜像 checkpoint manifest 上传失败: ${path}`);
    }
    uploaded.ref.scope = scope;
    uploaded.ref.publicationState = 'prepared';
    await registerPrepared_ACU(uploaded.ref);
    return {
        ref: {
            manifestHash,
            path,
            byteLength: Number(uploaded.ref.byteSize) || JSON.stringify(payload).length,
        },
        file: uploaded.ref,
    };
}

export async function loadSummaryVectorMirrorPack_ACU(
    ref: SummaryVectorPackRef_ACU,
): Promise<SummaryVectorIndexContentPackBlob_ACU | null> {
    if (!ref?.path) return null;
    const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexContentPackBlob_ACU>(ref.path);
    if (!loaded.ok || !loaded.data) return null;
    if (loaded.data.schema !== SUMMARY_VECTOR_INDEX_CONTENT_PACK_SCHEMA_ACU || !Array.isArray(loaded.data.chunks)) {
        return null;
    }
    if (ref.packHash && String(loaded.data.packKey || '') !== ref.packHash) return null;
    return loaded.data;
}

export async function loadSummaryVectorMirrorManifest_ACU(
    ref: SummaryVectorManifestRef_ACU,
): Promise<SummaryVectorMirrorManifestRows_ACU | null> {
    if (!ref?.path) return null;
    const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorMirrorManifestRows_ACU>(ref.path);
    if (!loaded.ok || !loaded.data) return null;
    if (loaded.data.schema !== 'summary_vector_mirror_manifest' || !Array.isArray(loaded.data.rows)) return null;
    if (ref.manifestHash) {
        const actualHash = await sha256Text_ACU(JSON.stringify({
            schema: loaded.data.schema,
            version: loaded.data.version,
            sourceTableKey: loaded.data.sourceTableKey,
            rows: loaded.data.rows,
        }));
        if (actualHash !== ref.manifestHash) return null;
    }
    return loaded.data;
}
