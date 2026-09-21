/**
 * service/chat/chat-branch-sync.ts — 酒馆「创建分支 / 检查点」时把截止楼层的 ACU 数据落到新聊天
 *
 * 宿主 createBranch / createNewBookmark 会 structuredClone 前缀消息另存为新文件，并把
 * 当前 chat_metadata 整份拷进新文件头（含 main_chat）。这带来两处断层：
 *
 * 1. 模板/指导表挂在 chat_metadata 上，owner 字段 `__chatId` 仍是父聊天 id。新聊天加载后
 *    shouldUseChatMetadataContainer 因 owner 不匹配而丢掉 chat_override，看起来像「表空了」。
 * 2. IsolatedData 虽已随消息克隆，但父聊天若已 compaction，前缀可能只剩 data_replace 日志。
 *    在新文件最后一条 AI 楼上写入截止该楼层的 full checkpoint（空 logEntries），让新分支
 *    不依赖父聊天后续 compaction，也能独立回放到分支点状态。
 *
 * 拦截点：酒馆 saveChat / saveGroupBookmarkChat 走 topLevelWindow.fetch，且不经过
 * getContext().saveChat，因此必须包一层 POST /api/chats/save 与 /api/chats/group/save。
 * gzip 请求体（酒馆 compressRequest 的产物）先解压、改写、再重压缩后放行；环境缺少
 * DecompressionStream/CompressionStream 或数据损坏时回退为不拦截，由 CHAT_CHANGED 重绑 owner 兜底。
 *
 * 禁止调用 writeV2BoundaryCheckpointBeforePurge：那条路径会按当前聊天身份折叠向量镜像。
 */

import { CHAT_SCOPED_CONFIG_FIELD_ACU, CHAT_SHEET_GUIDE_FIELD_ACU } from '../../data/storage/chat-history';
import { readIsolatedTagData_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import { settings_ACU } from '../runtime/state-manager';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { topLevelWindow_ACU } from '../../shared/env';
import { cleanChatName_ACU, logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { buildCanonicalFullCheckpoint_ACU, buildCanonicalSheetCheckpoint_ACU } from '../table/canonical-checkpoint-builder';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import {
    collectScheduleSummaryFromFramesV2_ACU,
    deriveSheetLifecycleFromFramesV2_ACU,
    loadTableStateFromFramesV2Detailed_ACU,
} from '../table/storage-frame-v2-replay';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import type { TableSheetCheckpointV2_ACU, TableStorageFrameV2_ACU } from '../table/storage-frame-v2-types';

const BRANCH_CHECKPOINT_REASON_ACU = 'integrity_repair' as const;
const FETCH_PATCH_FLAG_ACU = '__acuChatBranchSyncFetchPatched';

const ACU_METADATA_OWNER_SOURCE_FIELDS_ACU = [
    CHAT_SCOPED_CONFIG_FIELD_ACU,
    CHAT_SHEET_GUIDE_FIELD_ACU,
] as const;

export function getAcuChatMetadataOwnerField_ACU(field: string): string {
    return `${field}__chatId`;
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasEntries_ACU(record: Record<string, unknown> | null | undefined): boolean {
    return isRecord_ACU(record) && Object.keys(record).length > 0;
}

function normalizeChatFileId_ACU(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') return '';
    const cleaned = cleanChatName_ACU(raw);
    return !cleaned || cleaned === 'unknown_chat_source' ? '' : cleaned;
}

function getActiveHostChatId_ACU(): string {
    const api = SillyTavern_API_ACU as any;
    try {
        if (typeof api?.getCurrentChatId === 'function') {
            return normalizeChatFileId_ACU(api.getCurrentChatId());
        }
        if (api && Object.prototype.hasOwnProperty.call(api, 'chatId')) {
            return normalizeChatFileId_ACU(api.chatId);
        }
    } catch {
        return '';
    }
    return '';
}

function getChatMetadataObject_ACU(): Record<string, unknown> | null {
    const metadata = (SillyTavern_API_ACU as any)?.chatMetadata;
    return isRecord_ACU(metadata) ? metadata : null;
}

/**
 * 把拷贝来的 ACU metadata 容器归属改写到目标聊天。
 * 仅在 owner 已填写且与 dest 不同时改写；空 owner 本就会被当作当前聊天可用。
 */
export function rebindAcuChatMetadataOwners_ACU(
    metadata: Record<string, unknown> | null | undefined,
    destChatId: string,
): boolean {
    if (!isRecord_ACU(metadata)) return false;
    const dest = normalizeChatFileId_ACU(destChatId);
    if (!dest) return false;
    let changed = false;
    for (const field of ACU_METADATA_OWNER_SOURCE_FIELDS_ACU) {
        if (!hasEntries_ACU(metadata[field] as Record<string, unknown> | null)) continue;
        const ownerField = getAcuChatMetadataOwnerField_ACU(field);
        const owner = String(metadata[ownerField] ?? '').trim();
        if (!owner || owner === dest) continue;
        metadata[ownerField] = dest;
        changed = true;
    }
    return changed;
}

/** 切到新分支后、applyTemplateScope 之前调用：认领父聊天拷过来的 scoped config / guide。 */
export function adoptCopiedChatMetadataOwnersForCurrentChat_ACU(chatFileName?: string): boolean {
    const dest = normalizeChatFileId_ACU(chatFileName) || getActiveHostChatId_ACU();
    const metadata = getChatMetadataObject_ACU();
    if (!dest || !metadata) return false;
    const changed = rebindAcuChatMetadataOwners_ACU(metadata, dest);
    if (!changed) return false;
    const hostPayload: Record<string, unknown> = {};
    for (const field of ACU_METADATA_OWNER_SOURCE_FIELDS_ACU) {
        const ownerField = getAcuChatMetadataOwnerField_ACU(field);
        if (metadata[ownerField] === dest) hostPayload[ownerField] = dest;
    }
    try {
        const updater = (SillyTavern_API_ACU as any)?.updateChatMetadata;
        if (typeof updater === 'function') updater(hostPayload, false);
    } catch (error: any) {
        logWarn_ACU('[分支同步] 同步宿主 chatMetadata owner 失败:', error?.message || error);
    }
    logDebug_ACU(`[分支同步] 已将 ACU metadata owner 重绑到当前聊天 "${dest}"。`);
    return true;
}

export function isHostChatSaveUrl_ACU(url: string): boolean {
    if (!url) return false;
    try {
        const path = new URL(url, 'http://sillytavern.local').pathname.replace(/\/+$/, '');
        return path.endsWith('/api/chats/save') || path.endsWith('/api/chats/group/save');
    } catch {
        return /\/api\/chats\/(?:group\/)?save(?:\/|$|\?)/.test(url);
    }
}

export function isHostChatGroupSaveUrl_ACU(url: string): boolean {
    if (!url) return false;
    try {
        const path = new URL(url, 'http://sillytavern.local').pathname.replace(/\/+$/, '');
        return path.endsWith('/api/chats/group/save');
    } catch {
        return /\/api\/chats\/group\/save(?:\/|$|\?)/.test(url);
    }
}

function isChatFileHeader_ACU(entry: unknown): entry is Record<string, unknown> {
    return isRecord_ACU(entry) && Object.prototype.hasOwnProperty.call(entry, 'chat_metadata');
}

export interface HostChatSavePayloadSplit_ACU {
    header: Record<string, unknown> | null;
    messages: any[];
    metadata: Record<string, unknown> | null;
}

/** 酒馆 JSONL 存档：chat[0] 是带 chat_metadata 的文件头，其后才是消息。 */
export function splitHostChatSavePayload_ACU(body: Record<string, unknown> | null | undefined): HostChatSavePayloadSplit_ACU {
    const chat = Array.isArray(body?.chat) ? body!.chat : [];
    if (chat.length > 0 && isChatFileHeader_ACU(chat[0])) {
        const header = chat[0];
        const metadata = isRecord_ACU(header.chat_metadata) ? header.chat_metadata : null;
        return { header, messages: chat.slice(1), metadata };
    }
    const metadata = isRecord_ACU(body?.chat_metadata) ? body!.chat_metadata as Record<string, unknown> : null;
    return { header: null, messages: chat, metadata };
}

export function resolveHostChatSaveDestId_ACU(body: Record<string, unknown> | null | undefined, url = ''): string {
    if (!isRecord_ACU(body)) return '';
    if (isHostChatGroupSaveUrl_ACU(url)) {
        return normalizeChatFileId_ACU(body.id ?? body.file_name ?? body.chat_id);
    }
    return normalizeChatFileId_ACU(body.file_name ?? body.id ?? body.chat_id);
}

export function isHostChatBranchOrCheckpointSave_ACU(
    body: Record<string, unknown> | null | undefined,
    currentChatId: string,
    url = '',
): boolean {
    const dest = resolveHostChatSaveDestId_ACU(body, url);
    const current = normalizeChatFileId_ACU(currentChatId);
    if (!dest || !current || dest === current) return false;
    const { metadata } = splitHostChatSavePayload_ACU(body);
    // 宿主 createBranch / createNewBookmark 先存后切：真正的分支另存，main_chat 必为
    // 保存发生时的当前聊天。不等则说明是切换窗口期里上一聊天（本身是分支）的在途保存，
    // 放过它，避免对普通保存做未预期的 replay 与 frame 改写。
    const mainChat = normalizeChatFileId_ACU(metadata?.main_chat);
    return !!mainChat && mainChat === current;
}

function findLastAiMessageIndex_ACU(messages: any[]): number {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i] && !messages[i].is_user) return i;
    }
    return -1;
}

function collectIsolationKeysWithV2Frames_ACU(chat: any[], maxMessageIndex: number): string[] {
    const keys = new Set<string>();
    for (let i = 0; i < chat.length && i <= maxMessageIndex; i += 1) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        const isolatedData = msg.TavernDB_ACU_IsolatedData;
        if (!isRecord_ACU(isolatedData)) continue;
        for (const [isolationKey, tagData] of Object.entries(isolatedData)) {
            if (isV2TagData_ACU(tagData)) keys.add(isolationKey);
        }
    }
    return [...keys];
}

function ensureIsolatedTagContainer_ACU(message: any, isolationKey: string): Record<string, any> {
    if (!isRecord_ACU(message.TavernDB_ACU_IsolatedData)) {
        message.TavernDB_ACU_IsolatedData = {};
    }
    const container = message.TavernDB_ACU_IsolatedData;
    if (!isRecord_ACU(container[isolationKey])) {
        container[isolationKey] = {};
    }
    return container[isolationKey];
}

function existingTipAlreadyMatches_ACU(tagData: unknown, replayFingerprint: string): boolean {
    if (!isV2TagData_ACU(tagData)) return false;
    const frame = tagData.storageFrame;
    if (frame.checkpoint?.kind !== 'full') return false;
    if (!Array.isArray(frame.logEntries) || frame.logEntries.length > 0) return false;
    return getTableDataFingerprint_ACU(frame.checkpoint.data) === replayFingerprint;
}

function migrateHiddenSheetCheckpoints_ACU(
    messages: any[],
    isolationKey: string,
    lastAiIndex: number,
): Record<string, TableSheetCheckpointV2_ACU> {
    const migrated: Record<string, TableSheetCheckpointV2_ACU> = {};
    const lifecycle = deriveSheetLifecycleFromFramesV2_ACU(messages, isolationKey, {
        maxMessageIndex: messages.length - 1,
    });
    for (const hiddenSheetKey of lifecycle.hiddenSheetKeys) {
        const restoreData = lifecycle.statusBySheetKey[hiddenSheetKey]?.restoreSourceData;
        if (!restoreData) {
            logWarn_ACU(`[分支同步] 隐藏表 ${hiddenSheetKey} 缺少可迁移数据，isolationKey=[${isolationKey || '无标签'}]，已跳过。`);
            continue;
        }
        const built = buildCanonicalSheetCheckpoint_ACU({
            createdAt: Date.now(),
            reason: BRANCH_CHECKPOINT_REASON_ACU,
            sheetKey: hiddenSheetKey,
            data: JSON.parse(JSON.stringify(restoreData)),
            context: { messageIndex: lastAiIndex, isolationKey, reason: BRANCH_CHECKPOINT_REASON_ACU },
        });
        if (!built.checkpoint) {
            logWarn_ACU(`[分支同步] 隐藏表 ${hiddenSheetKey} 迁移 checkpoint 不合法：${built.error}`);
            continue;
        }
        migrated[hiddenSheetKey] = {
            ...built.checkpoint,
            timeline: {
                kind: 'sheet_hide',
                activateAtMessageIndex: lastAiIndex,
                afterSeq: 0,
            },
        };
    }
    return migrated;
}

/**
 * 把截止 snapshot 末楼的表格状态写成新分支最后一条 AI 楼上的独立 full 根。
 * 只改传入的 messages（宿主存档 payload），不得碰当前打开的聊天数组。
 */
export async function injectBranchTableCheckpointIntoMessages_ACU(
    messages: any[],
): Promise<{ changed: boolean; injectedKeys: string[] }> {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { changed: false, injectedKeys: [] };
    }
    const lastAiIndex = findLastAiMessageIndex_ACU(messages);
    if (lastAiIndex < 0) return { changed: false, injectedKeys: [] };

    const isolationKeys = collectIsolationKeysWithV2Frames_ACU(messages, messages.length - 1);
    const injectedKeys: string[] = [];
    const anchorMsg = messages[lastAiIndex];

    for (const isolationKey of isolationKeys) {
        try {
            const replay = await loadTableStateFromFramesV2Detailed_ACU(messages, isolationKey, {
                maxMessageIndex: messages.length - 1,
                updateRuntimeState: false,
            });
            if (!replay?.data) continue;

            const replayFingerprint = getTableDataFingerprint_ACU(replay.data);
            const existingTagData = readIsolatedTagData_ACU(anchorMsg, isolationKey);
            const hiddenCheckpoints = migrateHiddenSheetCheckpoints_ACU(messages, isolationKey, lastAiIndex);
            if (existingTipAlreadyMatches_ACU(existingTagData, replayFingerprint)
                && Object.keys(hiddenCheckpoints).length === 0) {
                continue;
            }

            const built = buildCanonicalFullCheckpoint_ACU({
                createdAt: Date.now(),
                reason: BRANCH_CHECKPOINT_REASON_ACU,
                data: replay.data,
                scheduleSummary: collectScheduleSummaryFromFramesV2_ACU(messages, isolationKey, {
                    maxMessageIndex: messages.length - 1,
                }),
                context: { messageIndex: lastAiIndex, isolationKey, reason: BRANCH_CHECKPOINT_REASON_ACU },
            });
            if (!built.checkpoint) {
                logWarn_ACU(`[分支同步] isolationKey=[${isolationKey || '无标签'}] 截止 checkpoint 不合法：${built.error}`);
                continue;
            }

            const frame: TableStorageFrameV2_ACU = {
                version: 2,
                checkpoint: built.checkpoint,
                logEntries: [],
                ...(Object.keys(hiddenCheckpoints).length > 0 ? { perSheetCheckpoints: hiddenCheckpoints } : {}),
            };
            const tagData = ensureIsolatedTagContainer_ACU(anchorMsg, isolationKey);
            tagData.storageFrame = frame;
            tagData._acu_storage_version = 2;
            delete tagData.spv79TransitionCheckpoint;
            delete tagData.compatTransitionCheckpoint;
            injectedKeys.push(isolationKey);
        } catch (error: any) {
            logWarn_ACU(
                `[分支同步] isolationKey=[${isolationKey || '无标签'}] 截止数据注入失败:`,
                error?.message || error,
            );
        }
    }

    if (injectedKeys.length > 0) {
        // 与代码库所有 IsolatedData 写路径保持一致：改写后补写消息隔离身份。
        writeMessageIdentity_ACU(anchorMsg, {
            enabled: settings_ACU.dataIsolationEnabled,
            code: settings_ACU.dataIsolationCode,
        });
    }

    return { changed: injectedKeys.length > 0, injectedKeys };
}

export async function prepareHostChatBranchSaveBody_ACU(
    body: Record<string, unknown>,
    destChatId: string,
): Promise<{ changed: boolean; reboundOwners: boolean; injectedKeys: string[] }> {
    const dest = normalizeChatFileId_ACU(destChatId);
    const split = splitHostChatSavePayload_ACU(body);
    const reboundOwners = dest ? rebindAcuChatMetadataOwners_ACU(split.metadata, dest) : false;
    const injectResult = await injectBranchTableCheckpointIntoMessages_ACU(split.messages);
    return {
        changed: reboundOwners || injectResult.changed,
        reboundOwners,
        injectedKeys: injectResult.injectedKeys,
    };
}

function readHeaderValue_ACU(headers: unknown, name: string): string {
    if (!headers) return '';
    try {
        if (typeof (headers as Headers).get === 'function') {
            return String((headers as Headers).get(name) || '');
        }
        if (isRecord_ACU(headers)) {
            const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers['Content-Encoding'];
            return String(direct ?? '');
        }
    } catch {
        return '';
    }
    return '';
}

function isCompressedBody_ACU(headers: unknown, body: unknown): boolean {
    const encoding = readHeaderValue_ACU(headers, 'Content-Encoding');
    if (/gzip|br|deflate/i.test(encoding)) return true;
    if (body == null) return false;
    if (typeof body === 'string') return false;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
    if (typeof Uint8Array !== 'undefined' && body instanceof Uint8Array) return true;
    return typeof body === 'object' && !isRecord_ACU(body);
}

/** gzip 字节流解压为文本；环境不支持或数据损坏时返回 null（调用方按原样放行）。 */
async function decompressGzipText_ACU(bytes: Uint8Array): Promise<string | null> {
    if (typeof DecompressionStream !== 'function') return null;
    try {
        // TS 的 BodyInit 不接受 Uint8Array<ArrayBufferLike> 泛型形态；运行时是标准 BufferSource。
        const source = new Response(bytes as unknown as BodyInit).body;
        if (!source) return null;
        return await new Response(source.pipeThrough(new DecompressionStream('gzip'))).text();
    } catch {
        return null;
    }
}

/** 文本重新 gzip 压缩；环境不支持时返回 null（调用方回退为不拦截）。 */
async function compressTextToGzip_ACU(text: string): Promise<Uint8Array | null> {
    if (typeof CompressionStream !== 'function') return null;
    try {
        const source = new Response(text).body;
        if (!source) return null;
        const buffer = await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        return new Uint8Array(buffer);
    } catch {
        return null;
    }
}

function resolveFetchUrl_ACU(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url || '');
    return '';
}

function resolveFetchMethod_ACU(input: RequestInfo | URL, init?: RequestInit): string {
    const fromInit = String(init?.method || '').toUpperCase();
    if (fromInit) return fromInit;
    if (input && typeof input === 'object' && 'method' in input) {
        return String((input as Request).method || 'GET').toUpperCase();
    }
    return 'GET';
}

async function readJsonFetchBody_ACU(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<{ body: Record<string, unknown>; headers: unknown; gzip: boolean } | null> {
    const request = (typeof Request !== 'undefined' && input instanceof Request) ? input : null;
    const headers = init?.headers ?? request?.headers;
    const rawBody = init?.body ?? null;
    const contentEncoding = readHeaderValue_ACU(headers, 'Content-Encoding');

    let text = '';
    let gzip = false;
    if (typeof rawBody === 'string') {
        // 字符串 body 却声明了压缩编码：无法对应原始字节，按原逻辑跳过。
        if (/gzip|br|deflate/i.test(contentEncoding)) return null;
        text = rawBody;
    } else if (rawBody != null) {
        // 二进制 body：仅处理酒馆 compressRequest 的 gzip 产物（解压→改写→重压缩），
        // 其余编码（br/deflate）或形态（Blob/Stream/FormData）无法无损改写，跳过。
        if (!/gzip/i.test(contentEncoding)) return null;
        const bytes = rawBody instanceof Uint8Array
            ? rawBody
            : (typeof ArrayBuffer !== 'undefined' && rawBody instanceof ArrayBuffer ? new Uint8Array(rawBody) : null);
        if (!bytes) return null;
        const decoded = await decompressGzipText_ACU(bytes);
        if (decoded === null) return null;
        text = decoded;
        gzip = true;
    } else if (request) {
        if (isCompressedBody_ACU(request.headers, null)) return null;
        try {
            text = await request.clone().text();
        } catch {
            return null;
        }
    } else {
        return null;
    }

    // 廉价门槛：分支/检查点存档的 metadata 必含 main_chat；普通保存直接跳过完整 JSON.parse。
    if (!text.includes('"main_chat"')) return null;

    try {
        const parsed = JSON.parse(text);
        return isRecord_ACU(parsed) ? { body: parsed, headers, gzip } : null;
    } catch {
        return null;
    }
}

async function rebuildFetchCall_ACU(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    body: Record<string, unknown>,
    options: { gzip?: boolean } = {},
): Promise<{ input: RequestInfo | URL; init: RequestInit } | null> {
    const serialized = JSON.stringify(body);
    let payload: BodyInit = serialized;
    if (options.gzip) {
        // 原请求是 gzip 压缩的：改写后必须重压缩并保持 Content-Encoding，否则服务端无法解码。
        // 环境不支持重压缩时返回 null，调用方回退为原始请求（等价于旧版直接跳过拦截）。
        const compressed = await compressTextToGzip_ACU(serialized);
        if (!compressed) return null;
        payload = compressed as unknown as BodyInit;
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
        const headers = new Headers(init?.headers || input.headers);
        headers.delete('content-length');
        headers.delete('Content-Length');
        return {
            input: input.url,
            init: {
                method: init?.method || input.method,
                headers,
                body: payload,
                cache: init?.cache || input.cache,
                credentials: init?.credentials || input.credentials,
                integrity: init?.integrity || input.integrity,
                keepalive: init?.keepalive ?? input.keepalive,
                mode: init?.mode || input.mode,
                redirect: init?.redirect || input.redirect,
                referrer: init?.referrer || input.referrer,
                referrerPolicy: init?.referrerPolicy || input.referrerPolicy,
                signal: init?.signal || input.signal,
            },
        };
    }
    if (!options.gzip) {
        return {
            input,
            init: {
                ...(init || {}),
                body: payload,
            },
        };
    }
    // gzip 改写后原 content-length（若存在）必然过期，必须丢弃。
    const headers = new Headers(init?.headers);
    headers.delete('content-length');
    headers.delete('Content-Length');
    return {
        input,
        init: {
            ...(init || {}),
            headers,
            body: payload,
        },
    };
}

export async function rewriteHostChatBranchSaveRequest_ACU(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<{ input: RequestInfo | URL; init: RequestInit } | null> {
    const url = resolveFetchUrl_ACU(input);
    if (!isHostChatSaveUrl_ACU(url)) return null;
    if (resolveFetchMethod_ACU(input, init) !== 'POST') return null;

    const parsed = await readJsonFetchBody_ACU(input, init);
    if (!parsed) return null;

    const currentChatId = getActiveHostChatId_ACU();
    if (!isHostChatBranchOrCheckpointSave_ACU(parsed.body, currentChatId, url)) return null;

    const dest = resolveHostChatSaveDestId_ACU(parsed.body, url);
    const result = await prepareHostChatBranchSaveBody_ACU(parsed.body, dest);
    if (!result.changed) return null;

    const rebuilt = await rebuildFetchCall_ACU(input, init, parsed.body, { gzip: parsed.gzip });
    if (!rebuilt) return null;

    logDebug_ACU(
        `[分支同步] 已把截止楼层数据写入新聊天 "${dest}"：owners=${result.reboundOwners}, keys=[${result.injectedKeys.join(',') || '无'}]`,
    );
    return rebuilt;
}

let installed_ACU = false;
const wrappedFetchTargets_ACU: Array<{ target: any; original: typeof fetch }> = [];

function wrapFetchOnTarget_ACU(target: any): void {
    if (!target || typeof target.fetch !== 'function') return;
    if (target.fetch[FETCH_PATCH_FLAG_ACU] || target[FETCH_PATCH_FLAG_ACU]) return;
    const originalFetch = target.fetch as typeof fetch;
    const boundOriginal = originalFetch.bind(target);
    const patched = async function acuChatBranchSyncFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        try {
            const rewritten = await rewriteHostChatBranchSaveRequest_ACU(input, init);
            if (rewritten) return boundOriginal(rewritten.input as any, rewritten.init);
        } catch (error: any) {
            logWarn_ACU('[分支同步] 拦截宿主存档失败，回退原始保存:', error?.message || error);
        }
        return boundOriginal(input as any, init);
    };
    (patched as any)[FETCH_PATCH_FLAG_ACU] = true;
    target[FETCH_PATCH_FLAG_ACU] = true;
    target.fetch = patched;
    wrappedFetchTargets_ACU.push({ target, original: originalFetch });
}

/** 包一层酒馆主窗口 fetch。幂等。 */
export function installChatBranchSync_ACU(): void {
    if (installed_ACU) return;
    wrapFetchOnTarget_ACU(topLevelWindow_ACU);
    if (typeof window !== 'undefined' && window !== topLevelWindow_ACU) {
        wrapFetchOnTarget_ACU(window);
    }
    // 一个目标都没包上（异常环境）时不置位，允许下次调用重试。
    installed_ACU = wrappedFetchTargets_ACU.length > 0;
}

/** 测试清理：还原 fetch 并允许重新安装。 */
export function __resetChatBranchSyncForTests_ACU(): void {
    for (const { target, original } of wrappedFetchTargets_ACU) {
        try {
            target.fetch = original;
            delete target[FETCH_PATCH_FLAG_ACU];
        } catch {
            // ignore
        }
    }
    wrappedFetchTargets_ACU.length = 0;
    installed_ACU = false;
}
