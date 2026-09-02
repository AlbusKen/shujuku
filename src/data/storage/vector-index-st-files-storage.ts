import { SillyTavern_API_ACU } from '../../shared/host-api';
import { logWarn_ACU } from '../../shared/utils';
import { sha256Base64UrlSync_ACU } from '../../shared/sha256-sync';
import {
    normalizeSummaryVectorIndexScope_ACU,
    serializeSummaryVectorIndexScope_ACU,
} from '../../shared/summary-vector-index-scope';
import type { SummaryVectorIndexCanonicalScope_ACU } from '../../shared/summary-vector-index-scope';
import type {
    SummaryVectorIndexExternalFileRef_ACU,
    SummaryVectorIndexExternalFileRole_ACU,
    SummaryVectorIndexRegistryFile_ACU,
} from '../../service/vector/summary-vector-index-types';
import { SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU } from '../../service/vector/summary-vector-index-types';

export interface VectorIndexFileWriteResult_ACU {
    ok: boolean;
    ref?: SummaryVectorIndexExternalFileRef_ACU;
    error?: string;
}

export interface VectorIndexFileDeleteResult_ACU {
    ok: boolean;
    path: string;
    error?: string;
}

function getRequestHeaders_ACU(): Record<string, string> {
    const contextHeaders = (SillyTavern_API_ACU as any)?.getRequestHeaders?.();
    const headers: Record<string, string> = {
        ...(contextHeaders && typeof contextHeaders === 'object' ? contextHeaders : {}),
    };
    if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

function normalizeError_ACU(error: any): string {
    return String(error?.message || error || '未知错误');
}

const VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU = 240;

function normalizeFileNamePart_ACU(value: string): string {
    return String(value || 'default')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96) || 'default';
}

function normalizePathSegment_ACU(value: string): string {
    return normalizeFileNamePart_ACU(value);
}

/**
 * [spv3.6.12] 角色名路径段规范化
 * SillyTavern 文件上传 API 仅接受 [a-zA-Z0-9_-]，
 * 因此必须使用 ASCII-only 规范化（与 normalizeFileNamePart_ACU 同策略）。
 * 非 ASCII 角色名（中文、日文等）清洗后为空则返回空字符串，
 * 调用方据此降级到无角色名格式（spv3.6.7 格式）。
 */
function normalizeChatNameSegment_ACU(value: string): string {
    return String(value || '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || '';
}

export function buildVectorIndexFileName_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    indexId: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    shardId?: string;
}): string {
    const scope = normalizeSummaryVectorIndexScope_ACU(parts);
    const chatKey = normalizeFileNamePart_ACU(scope.chatKey);
    const isolationKey = normalizeFileNamePart_ACU(scope.isolationKey);
    const indexId = normalizeFileNamePart_ACU(parts.indexId);
    const role = normalizeFileNamePart_ACU(parts.role);
    const shardId = parts.shardId ? `_${normalizeFileNamePart_ACU(parts.shardId)}` : '';
    return `TavernDB_ACU_vector_${chatKey}_${isolationKey}_${indexId}_${role}${shardId}`;
}

export function buildVectorIndexStableDirectory_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    const scope = normalizeSummaryVectorIndexScope_ACU(parts);
    return [
        'TavernDB_ACU_vector',
        normalizePathSegment_ACU(scope.chatKey),
        normalizePathSegment_ACU(scope.isolationKey),
        normalizePathSegment_ACU(scope.sourceTableKey),
    ].join('_');
}

export function buildVectorIndexStableFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    shardId?: string;
}): string {
    const scope = buildVectorIndexStableDirectory_ACU(parts);
    const role = normalizePathSegment_ACU(parts.role || 'manifest');
    if (parts.role === 'base_shard' || parts.role === 'delta_shard' || parts.role === 'vector_pack') {
        const shardName = normalizePathSegment_ACU(parts.shardId || (parts.role === 'vector_pack' ? 'pack_0001' : 'shard_0001'));
        return `${scope}_${role}_${shardName}`;
    }
    return `${scope}_${role}`;
}

export function buildVectorIndexSnapshotFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    shardId?: string;
}): string {
    const scope = buildVectorIndexStableDirectory_ACU(parts);
    const indexId = normalizePathSegment_ACU(parts.indexId || 'snapshot');
    const role = normalizePathSegment_ACU(parts.role || 'manifest');
    if (parts.role === 'base_shard' || parts.role === 'delta_shard' || parts.role === 'vector_pack') {
        const shardName = normalizePathSegment_ACU(parts.shardId || (parts.role === 'vector_pack' ? 'pack_0001' : 'shard_0001'));
        return `${scope}_${indexId}_${role}_${shardName}`;
    }
    return `${scope}_${indexId}_${role}`;
}

export const VECTOR_INDEX_SNAPSHOT_PATH_V2_PREFIX_ACU = 'TavernDB_ACU_vector_v2_';
export const VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU = 'TavernDB_ACU_vector_v2pack_';

/** SHA-256 base64url（无 padding）恒为 43 字符；路径解析与预算断言都依赖这个定长。 */
export const VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU = 43;

const scopeFingerprintMemo_ACU = new Map<string, string>();

/**
 * V2 单文件快照必须是 immutable object path。角色名只是展示信息，绝不能参与寻址；
 * 否则改名会把同一逻辑 scope 分裂成不同文件。
 *
 * scope token 是 canonical 三元组 JSON 的 SHA-256（base64url，定长 43 字符）。
 * 它只是定位器：完整三元组同时保存在 registry 条目（`scope`）与 blob 内部
 * （`chatKey / isolationKey / sourceTableKey`），读取与 GC 都以这两处为身份依据，
 * 路径不再需要可逆。之前把三元组无损 base64 进文件名，导致路径长度随聊天名线性增长，
 * 中文聊天名稍长就撞上宿主文件名上限而无法建索引。
 */
export function buildVectorIndexSingleSnapshotV2ScopeToken_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    const serialized = serializeSummaryVectorIndexScope_ACU(parts);
    const cached = scopeFingerprintMemo_ACU.get(serialized);
    if (cached) return cached;
    const fingerprint = sha256Base64UrlSync_ACU(serialized);
    scopeFingerprintMemo_ACU.set(serialized, fingerprint);
    return fingerprint;
}

/**
 * 旧版（无损）scope token：三元组 JSON 的 UTF-8 base64url。
 * 仅用于识别 / 回收升级前写出的对象，新写入一律走 SHA-256 指纹。
 */
export function buildLegacyVectorIndexLosslessScopeTokenV2_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    const bytes = new TextEncoder().encode(serializeSummaryVectorIndexScope_ACU(parts));
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

export function buildVectorIndexSingleSnapshotV2FilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    indexId: string;
    writeGeneration: string;
    /** 仅为调用端兼容；V2 path 不使用该字段。 */
    chatName?: string;
}): string {
    const scopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(parts);
    const indexId = normalizePathSegment_ACU(parts.indexId || 'snapshot');
    const writeGeneration = normalizePathSegment_ACU(parts.writeGeneration || 'write');
    const path = `${VECTOR_INDEX_SNAPSHOT_PATH_V2_PREFIX_ACU}${scopeToken}_${indexId}_${writeGeneration}_snapshot`;
    if (path.length > VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU) {
        // scopeToken 已定长，只有 indexId / writeGeneration 被放宽才可能触发；这是编程错误而非用户数据问题。
        throw new Error(
            `[纪要向量索引] V2 快照对象路径超长: length=${path.length}, max=${VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU}，`
            + `scopeToken 占用 ${scopeToken.length} 字符，indexId 占用 ${indexId.length} 字符，writeGeneration 占用 ${writeGeneration.length} 字符。`
            + '禁止截断任何路径段后继续写入。',
        );
    }
    return path;
}

/**
 * P4 内容寻址 pack 路径（T10）。
 * 用 V2 scope 指纹替代 buildVectorPackPath_ACU 走的 buildVectorIndexStableDirectory_ACU
 * —— 后者会把中文 chatKey 清成 default，导致不同聊天共享路径。
 * 路径刻意不含 indexId/revision，这是跨 revision 复用 pack 的前提。
 * 前缀用 v2pack_ 而非 v2_，避免与 snapshot 前缀 TavernDB_ACU_vector_v2_ 互相误判。
 */
export function buildVectorIndexContentPackPathV2_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    packKey: string;
}): string {
    const scopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(parts);
    const packKey = normalizePathSegment_ACU(parts.packKey || 'pack_unknown');
    const path = `${VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU}${scopeToken}_${packKey}`;
    if (path.length > VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU) {
        throw new Error(
            `[纪要向量索引] 内容寻址 pack 对象路径超长: length=${path.length}, max=${VECTOR_INDEX_OBJECT_PATH_MAX_LENGTH_ACU}，`
            + `scopeToken 占用 ${scopeToken.length} 字符，packKey 占用 ${packKey.length} 字符。`
            + '禁止截断任何路径段后继续写入。',
        );
    }
    return path;
}

/** 判断路径是否为 P4 内容寻址 pack 路径（前缀判断，不解析内容）。 */
export function isVectorIndexContentPackPathV2_ACU(path: string): boolean {
    return String(path || '').startsWith(VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU);
}

export interface VectorIndexDecodedScope_ACU {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}

/**
 * 尝试把旧版无损 base64url token 解码回 [chatKey, isolationKey, sourceTableKey] 三元组。
 * 解码失败或形状不符（非长度 3 的字符串数组）返回 null。
 * SHA-256 指纹的 32 个随机字节不可能解析成 JSON 字符串三元组，因此对新 token 恒为 null。
 */
function tryDecodeVectorIndexScopeToken_ACU(token: string): VectorIndexDecodedScope_ACU | null {
    if (!token || /[^A-Za-z0-9_-]/.test(token)) return null;
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    try {
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((item) => typeof item === 'string')) {
            return { chatKey: parsed[0], isolationKey: parsed[1], sourceTableKey: parsed[2] };
        }
    } catch (_error) {
        // 候选分割点不是完整 token 时解码/JSON 解析必然失败，继续尝试下一个。
    }
    return null;
}

function stripVectorIndexV2PathPrefix_ACU(path: string): string | null {
    const normalized = String(path || '');
    // pack 前缀是 snapshot 前缀的超集（v2pack_ 以 v2 开头），必须先判 pack。
    for (const prefix of [VECTOR_INDEX_CONTENT_PACK_PATH_V2_PREFIX_ACU, VECTOR_INDEX_SNAPSHOT_PATH_V2_PREFIX_ACU]) {
        if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    }
    return null;
}

/**
 * 从 V2 快照 / v2pack 对象路径反解 canonical scope。
 * 只对升级前写出的旧版无损 token 有效；新路径里的 SHA-256 指纹不可逆，恒返回 null，
 * 调用方应改用 resolveVectorIndexRegistryFileScope_ACU 从 registry 条目取身份。
 * 注意：base64url 字母表包含 `_`，不能用"首个下划线"切分；这里逐个 `_` 候选分割点
 * （含全串）尝试解码，只有 JSON 三元组解析成功才算命中。
 */
export function decodeVectorIndexScopeFromPath_ACU(path: string): VectorIndexDecodedScope_ACU | null {
    const remainder = stripVectorIndexV2PathPrefix_ACU(path);
    if (remainder === null) return null;
    for (let index = 0; index <= remainder.length; index += 1) {
        if (index < remainder.length && remainder[index] !== '_') continue;
        const decoded = tryDecodeVectorIndexScopeToken_ACU(remainder.slice(0, index));
        if (decoded) return decoded;
    }
    return null;
}

/** 路径是否携带升级前的无损 base64 scope token（可反解出三元组）。 */
export function isLegacyLosslessVectorIndexV2Path_ACU(path: string): boolean {
    return decodeVectorIndexScopeFromPath_ACU(path) !== null;
}

/**
 * 从 V2 快照 / v2pack 路径提取 scope token（不解码）。
 * 新格式 token 定长 43 且紧跟 `_`；旧格式退回到"能解码出三元组的最短前缀"。
 */
export function extractVectorIndexV2ScopeTokenFromPath_ACU(path: string): string | null {
    const remainder = stripVectorIndexV2PathPrefix_ACU(path);
    if (remainder === null) return null;
    const fixed = remainder.slice(0, VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU);
    if (fixed.length === VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU
        && remainder[VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU] === '_'
        && !/[^A-Za-z0-9_-]/.test(fixed)
        && tryDecodeVectorIndexScopeToken_ACU(fixed) === null) {
        return fixed;
    }
    for (let index = 0; index <= remainder.length; index += 1) {
        if (index < remainder.length && remainder[index] !== '_') continue;
        const candidate = remainder.slice(0, index);
        if (tryDecodeVectorIndexScopeToken_ACU(candidate)) return candidate;
    }
    return null;
}

export function extractVectorIndexContentPackScopeTokenFromPath_ACU(path: string): string | null {
    if (!isVectorIndexContentPackPathV2_ACU(path)) return null;
    return extractVectorIndexV2ScopeTokenFromPath_ACU(path);
}

/**
 * 解析 registry 条目所属的 canonical scope。
 * 新条目直接携带 `scope`；升级前的旧条目退回到从无损路径 token 反解。
 * 两者都没有（legacy 分片布局等）返回 null，调用方按"身份不可验证"处理。
 */
export function resolveVectorIndexRegistryFileScope_ACU(
    file: Pick<SummaryVectorIndexExternalFileRef_ACU, 'path' | 'scope'> | null | undefined,
): SummaryVectorIndexCanonicalScope_ACU | null {
    const scope = file?.scope;
    if (scope && typeof scope === 'object'
        && String(scope.chatKey || '').trim()
        && String(scope.isolationKey || '').trim()
        && String(scope.sourceTableKey || '').trim()) {
        return normalizeSummaryVectorIndexScope_ACU(scope);
    }
    const decoded = decodeVectorIndexScopeFromPath_ACU(String(file?.path || ''));
    return decoded ? normalizeSummaryVectorIndexScope_ACU(decoded) : null;
}

export function buildVectorIndexSingleSnapshotFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
    /** [spv3.6.8] 可选角色名前缀，用于提高文件可读性。为空时降级到 chatKey-only 格式 */
    chatName?: string;
}): string {
    const chatKey = normalizePathSegment_ACU(parts.chatKey);
    // [spv3.6.8] 角色名前缀：清洗后非空则加入路径，提高文件可识别性
    const chatName = normalizeChatNameSegment_ACU(parts.chatName || '');
    if (chatName) {
        return `TavernDB_ACU_vector_${chatName}_${chatKey}_snapshot`;
    }
    // [spv3.6.7] 无角色名时降级到只用 chatKey 的格式
    return `TavernDB_ACU_vector_${chatKey}_snapshot`;
}

/**
 * [spv3.6.7] 构建旧版外置快照路径（含 isolationKey + sourceTableKey）
 * 仅用于向后兼容：读取旧版文件时回退尝试
 */
export function buildLegacyVectorIndexSingleSnapshotFilePath_ACU(parts: {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}): string {
    return `${buildVectorIndexStableDirectory_ACU(parts)}_snapshot`;
}

function encodeUserFilePath_ACU(path: string): string {
    return String(path || '')
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function getUserFileUrl_ACU(path: string): string {
    return `/user/files/${encodeUserFilePath_ACU(path)}?t=${Date.now()}`;
}

async function encodeBase64_ACU(text: string): Promise<string> {
    const blob = new Blob([text], { type: 'application/json' });
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
        };
        reader.onerror = () => reject(new Error('Base64 encoding failed'));
        reader.readAsDataURL(blob);
    });
}

export async function sha256Text_ACU(text: string): Promise<string> {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle) {
        const data = new TextEncoder().encode(text);
        const digest = await cryptoApi.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    for (let index = 0; index < text.length; index++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(index);
        hash |= 0;
    }
    return `fallback-${Math.abs(hash)}`;
}

export async function uploadVectorIndexJsonFile_ACU(params: {
    path: string;
    role: SummaryVectorIndexExternalFileRole_ACU;
    data: any;
    shardId?: string;
    chunkCount?: number;
    rowCount?: number;
    status?: SummaryVectorIndexExternalFileRef_ACU['status'];
}): Promise<VectorIndexFileWriteResult_ACU> {
    try {
        const json = JSON.stringify(params.data);
        const checksum = await sha256Text_ACU(json);
        const base64Data = await encodeBase64_ACU(json);
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders_ACU(),
            body: JSON.stringify({
                name: params.path,
                data: base64Data,
            }),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => response.statusText);
            return { ok: false, error: `上传失败 ${response.status}: ${detail}` };
        }
        const now = new Date().toISOString();
        return {
            ok: true,
            ref: {
                role: params.role,
                path: params.path,
                shardId: params.shardId,
                byteSize: new Blob([json]).size,
                checksum,
                chunkCount: params.chunkCount,
                rowCount: params.rowCount,
                createdAt: now,
                updatedAt: now,
                status: params.status || 'ready',
            },
        };
    } catch (error) {
        return { ok: false, error: normalizeError_ACU(error) };
    }
}

export async function readVectorIndexJsonFile_ACU<T = any>(path: string): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
    try {
        const response = await fetch(getUserFileUrl_ACU(path));
        if (!response.ok) {
            return { ok: false, status: response.status, error: `读取失败 ${response.status}: ${response.statusText}` };
        }
        return { ok: true, data: await response.json() as T };
    } catch (error) {
        return { ok: false, error: normalizeError_ACU(error) };
    }
}

interface VectorIndexFileDeleteRequestCandidate_ACU {
    label: string;
    body: Record<string, string>;
}

let preferredDeletePrefixLabel_ACU: string | null = null;

function normalizeDeletePathInput_ACU(path: string): string {
    return String(path || '')
        .trim()
        .replace(/^\/+/, '')
        .replace(/^user\/files\//, '')
        .replace(/^files\//, '');
}

function buildDeleteRequestCandidates_ACU(path: string): VectorIndexFileDeleteRequestCandidate_ACU[] {
    const fileName = normalizeDeletePathInput_ACU(path);
    const candidates: VectorIndexFileDeleteRequestCandidate_ACU[] = [];
    const seen = new Set<string>();
    const addCandidate = (label: string, body: Record<string, string>): void => {
        const key = JSON.stringify(body);
        if ((body.path || body.name) && !seen.has(key)) {
            seen.add(key);
            candidates.push({ label, body });
        }
    };

    // SillyTavern exposes uploaded files as /user/files/<name>. Different builds have accepted
    // different relative roots for /api/files/delete, so keep candidates explicit and verify after
    // a 404 instead of pretending the delete succeeded. 能跑不等于能删干净。
    addCandidate('path:user-files-prefix', { path: `user/files/${fileName}` });
    addCandidate('path:absolute-user-files-prefix', { path: `/user/files/${fileName}` });
    addCandidate('path:files-prefix', { path: `files/${fileName}` });
    addCandidate('path:filename', { path: fileName });

    if (!preferredDeletePrefixLabel_ACU) return candidates;
    const preferred = candidates.find((candidate) => candidate.label === preferredDeletePrefixLabel_ACU);
    if (!preferred) return candidates;
    return [preferred, ...candidates.filter((candidate) => candidate.label !== preferredDeletePrefixLabel_ACU)];
}

async function vectorIndexFileExists_ACU(path: string): Promise<boolean> {
    try {
        const response = await fetch(getUserFileUrl_ACU(path), { method: 'GET' });
        if (response.status === 404) return false;
        return response.ok;
    } catch (_) {
        return false;
    }
}

export async function deleteVectorIndexFile_ACU(path: string): Promise<VectorIndexFileDeleteResult_ACU> {
    const normalizedPath = normalizeDeletePathInput_ACU(path);
    if (!normalizedPath) {
        return { ok: false, path, error: '删除失败：文件路径为空' };
    }

    const attempts: string[] = [];
    let notFoundSeen = false;
    for (const candidate of buildDeleteRequestCandidates_ACU(normalizedPath)) {
        try {
            const response = await fetch('/api/files/delete', {
                method: 'POST',
                headers: getRequestHeaders_ACU(),
                body: JSON.stringify(candidate.body),
            });
            if (response.ok) {
                preferredDeletePrefixLabel_ACU = candidate.label;
                return { ok: true, path: normalizedPath };
            }
            const detail = await response.text().catch(() => response.statusText);
            if (response.status === 404) {
                notFoundSeen = true;
            }
            attempts.push(`${candidate.label} -> ${response.status}: ${detail || response.statusText}`);
        } catch (error) {
            attempts.push(`${candidate.label} -> ${normalizeError_ACU(error)}`);
        }
    }

    if (notFoundSeen && !(await vectorIndexFileExists_ACU(normalizedPath))) {
        return { ok: true, path: normalizedPath };
    }

    return {
        ok: false,
        path: normalizedPath,
        error: `删除失败，已尝试 ${attempts.length} 种 path 请求体: ${attempts.join('；')}`,
    };
}

export async function loadVectorIndexRegistry_ACU(): Promise<SummaryVectorIndexRegistryFile_ACU> {
    const loaded = await readVectorIndexJsonFile_ACU<SummaryVectorIndexRegistryFile_ACU>(SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU);
    if (!loaded.ok || !loaded.data || typeof loaded.data !== 'object') {
        return { version: 1, updatedAt: new Date().toISOString(), files: [] };
    }
    return {
        version: 1,
        updatedAt: String(loaded.data.updatedAt || new Date().toISOString()),
        files: Array.isArray(loaded.data.files) ? loaded.data.files : [],
    };
}

export async function saveVectorIndexRegistry_ACU(registry: SummaryVectorIndexRegistryFile_ACU): Promise<void> {
    const next: SummaryVectorIndexRegistryFile_ACU = {
        version: 1,
        updatedAt: new Date().toISOString(),
        files: Array.isArray(registry.files) ? registry.files : [],
    };
    const saved = await uploadVectorIndexJsonFile_ACU({
        path: SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU,
        role: 'registry',
        data: next,
        status: 'ready',
    });
    if (!saved.ok) {
        const detail = saved.error || '未知上传失败';
        logWarn_ACU('[交火向量索引] registry 保存失败:', detail);
        throw new Error(`[交火向量索引] registry 保存失败: path=${SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU}; error=${detail}`);
    }
}

export async function registerVectorIndexFiles_ACU(files: SummaryVectorIndexExternalFileRef_ACU[]): Promise<void> {
    if (!Array.isArray(files) || files.length === 0) return;
    const registry = await loadVectorIndexRegistry_ACU();
    const byPath = new Map(registry.files.map((file) => [file.path, file]));
    files.forEach((file) => {
        // 路径不可逆后 registry 里的 scope 是 GC 唯一的身份来源；
        // 后续 prepared → published 等状态更新若未带 scope，不能把已有的擦掉。
        const existing = byPath.get(file.path);
        const scope = file.scope ?? existing?.scope;
        byPath.set(file.path, scope ? { ...file, scope } : file);
    });
    registry.files = Array.from(byPath.values());
    await saveVectorIndexRegistry_ACU(registry);
}

export async function unregisterVectorIndexFiles_ACU(paths: string[]): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const pathSet = new Set(paths);
    const registry = await loadVectorIndexRegistry_ACU();
    registry.files = registry.files.filter((file) => !pathSet.has(file.path));
    await saveVectorIndexRegistry_ACU(registry);
}

export async function deleteRegisteredVectorIndexFilesWhere_ACU(
    predicate: (file: SummaryVectorIndexExternalFileRef_ACU) => boolean,
): Promise<string[]> {
    const registry = await loadVectorIndexRegistry_ACU();
    const removableFiles = registry.files.filter((file) => file?.path && predicate(file));
    const removablePaths = Array.from(new Set(removableFiles.map((file) => file.path).filter(Boolean)));
    if (removablePaths.length === 0) return [];

    const deletedPaths: string[] = [];
    for (const path of removablePaths) {
        const result = await deleteVectorIndexFile_ACU(path);
        if (result.ok) {
            deletedPaths.push(result.path);
        } else {
            logWarn_ACU('[交火向量索引] registry 作用域清理外置文件失败:', path, result.error);
        }
    }
    await unregisterVectorIndexFiles_ACU(deletedPaths);
    return deletedPaths;
}
