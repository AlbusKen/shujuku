/**
 * data/storage/chat-history.ts — 聊天消息自定义字段读写
 *
 * 从 src/core/04_shared_helpers.js 迁移而来。
 * 提供对聊天消息 chat[0] 上挂载的 TavernDB_ACU_* 自定义字段的底层 CRUD。
 * 纯数据层：不包含业务逻辑（作用域归一化/快照清洗等在 service/ 层）。
 */

// ── 字段名常量 ──

/** 聊天级作用域配置的字段名（挂载在 chat[0] 上） */
import { safeJsonParse_ACU } from '../../shared/json-helpers';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { cloneScopedConfigData_ACU } from '../../shared/utils';

export const CHAT_SCOPED_CONFIG_FIELD_ACU = 'TavernDB_ACU_ScopedConfig';

/** 聊天级作用域配置版本号 */
export const CHAT_SCOPED_CONFIG_VERSION_ACU = 1;

/** Sheet Guide（空白指导表）的字段名 */
export const CHAT_SHEET_GUIDE_FIELD_ACU = 'TavernDB_ACU_InternalSheetGuide';

/** Sheet Guide 版本号（v2 新增 seedRows） */
export const CHAT_SHEET_GUIDE_VERSION_ACU = 2;

/** 旧版"表头清单"字段名（兼容迁移用） */
export const LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU = 'TavernDB_ACU_TableHeaderGuide';

/** Sheet Guide 中 seedRows 子字段名 */
export const CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU = 'seedRows';

/** 聊天模板归档选项值前缀 */
export const CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU = '__acu_chat_archive__:';

/** 每个隔离标签下最大归档数 */
export const MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU = 8;

// ── 底层容器读取函数 ──

function getChatFirstLayerMessageLocal_ACU(chat: unknown[]): Record<string, unknown> | null {
    return Array.isArray(chat) && chat.length > 0 && chat[0] && typeof chat[0] === 'object'
        ? chat[0] as Record<string, unknown>
        : null;
}

function getActiveChatId_ACU(): string {
    const api = SillyTavern_API_ACU as any;
    try {
        if (typeof api?.getCurrentChatId === 'function') {
            const id = String(api.getCurrentChatId() ?? '').trim();
            return id && id !== 'null' ? id : '';
        }
        if (api && Object.prototype.hasOwnProperty.call(api, 'chatId')) {
            const id = String(api.chatId ?? '').trim();
            return id && id !== 'null' ? id : '';
        }
    } catch (_) {
        return '';
    }
    return '';
}

export function getActiveChatStorageIdentity_ACU(chat: unknown[]): string {
    if (!getChatFirstLayerMessageLocal_ACU(chat)) return '';
    const api = SillyTavern_API_ACU as any;
    if (api && (typeof api.getCurrentChatId === 'function' || Object.prototype.hasOwnProperty.call(api, 'chatId'))) {
        return getActiveChatId_ACU();
    }
    return '__host_without_chat_id__';
}

function hasActiveChatContext_ACU(chat: unknown[]): boolean {
    return !!getActiveChatStorageIdentity_ACU(chat);
}

function getChatMetadataOwnerField_ACU(field: string): string {
    return `${field}__chatId`;
}

function getChatMetadataOwner_ACU(field: string): string {
    const metadata = getChatMetadata_ACU();
    return String(metadata?.[getChatMetadataOwnerField_ACU(field)] ?? '').trim();
}

function shouldUseChatMetadataContainer_ACU(field: string, metadataContainer: Record<string, unknown> | null, legacyContainer: Record<string, unknown> | null): boolean {
    if (!metadataContainer) return false;
    const activeChatId = getActiveChatId_ACU();
    if (!activeChatId) return true;
    const owner = getChatMetadataOwner_ACU(field);
    if (owner) return owner === activeChatId;
    return true;
}

function cloneContainer_ACU(container: Record<string, unknown>): Record<string, unknown> {
    return cloneScopedConfigData_ACU(container, {}) as Record<string, unknown>;
}

function getChatMetadata_ACU(): Record<string, unknown> | null {
    const metadata = (SillyTavern_API_ACU as any)?.chatMetadata;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : null;
}

function readContainer_ACU(raw: unknown, strict = false): Record<string, unknown> | null {
    if (raw == null || !strict && !raw) return null;
    const obj = (typeof raw === 'string') ? safeJsonParse_ACU(raw, null) : raw;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    if (strict) throw new Error('只读聊天配置容器损坏，禁止以缺失来源继续桥接。');
    return null;
}

/** 聊天 metadata 字段精确快照（包含 owner 字段），供跨字段严格保存事务回滚使用。 */
export type ChatMetadataFieldsSnapshot_ACU = {
    metadata: Record<string, unknown> | null;
    fields: Array<{
        field: string;
        ownerField: string;
        fieldExisted: boolean;
        fieldValue: unknown;
        ownerExisted: boolean;
        ownerValue: unknown;
    }>;
};

/**
 * 精确快照指定 metadata 容器及其 owner 字段；不读写、不触发宿主同步。
 * 空 metadata 也显式记录，避免回滚时凭空创建容器。
 */
export function snapshotChatMetadataFields_ACU(fields: readonly string[]): ChatMetadataFieldsSnapshot_ACU {
    const metadata = getChatMetadata_ACU();
    return {
        metadata,
        fields: fields.map(field => {
            const ownerField = getChatMetadataOwnerField_ACU(field);
            return {
                field,
                ownerField,
                fieldExisted: !!metadata && Object.prototype.hasOwnProperty.call(metadata, field),
                fieldValue: metadata?.[field],
                ownerExisted: !!metadata && Object.prototype.hasOwnProperty.call(metadata, ownerField),
                ownerValue: metadata?.[ownerField],
            };
        }),
    };
}

/**
 * 按精确快照恢复 metadata 容器及 owner 字段，并同步宿主缓存。
 * 仅用于严格保存失败或身份切换中止后的回滚，调用方必须持有对应聊天写事务。
 */
export function restoreChatMetadataFields_ACU(snapshot: ChatMetadataFieldsSnapshot_ACU): void {
    const metadata = snapshot.metadata;
    if (!metadata) return;
    const hostPayload: Record<string, unknown> = {};
    for (const entry of snapshot.fields) {
        if (entry.fieldExisted) metadata[entry.field] = entry.fieldValue;
        else delete metadata[entry.field];
        if (entry.ownerExisted) metadata[entry.ownerField] = entry.ownerValue;
        else delete metadata[entry.ownerField];
        hostPayload[entry.field] = entry.fieldExisted ? entry.fieldValue : undefined;
        hostPayload[entry.ownerField] = entry.ownerExisted ? entry.ownerValue : undefined;
    }
    try {
        const updater = (SillyTavern_API_ACU as any)?.updateChatMetadata;
        if (typeof updater === 'function') updater(hostPayload, false);
    } catch (_) {}
}

function writeChatMetadataField_ACU(field: string, value: Record<string, unknown> | null): void {
    const metadata = getChatMetadata_ACU();
    if (!metadata) return;
    const ownerField = getChatMetadataOwnerField_ACU(field);
    const activeChatId = getActiveChatId_ACU();
    const ownerValue = value && Object.keys(value).length > 0 && activeChatId ? activeChatId : undefined;
    if (value && Object.keys(value).length > 0) {
        metadata[field] = value;
        if (ownerValue) metadata[ownerField] = ownerValue;
        else delete metadata[ownerField];
    } else {
        delete metadata[field];
        delete metadata[ownerField];
    }
    try {
        const updater = (SillyTavern_API_ACU as any)?.updateChatMetadata;
        if (typeof updater === 'function') updater({ [field]: value || undefined, [ownerField]: ownerValue }, false);
    } catch (_) {}
}

function mergeObjectSlots_ACU(target: Record<string, unknown>, fallback: Record<string, unknown>): boolean {
    let changed = false;
    Object.entries(fallback).forEach(([key, value]) => {
        if (!Object.prototype.hasOwnProperty.call(target, key)) {
            target[key] = cloneScopedConfigData_ACU(value, value as any) as unknown;
            changed = true;
        }
    });
    return changed;
}

function mergeLegacyScopedConfigIntoMetadata_ACU(metadataContainer: Record<string, unknown> | null, legacyContainer: Record<string, unknown> | null): { container: Record<string, unknown> | null; changed: boolean } {
    if (!metadataContainer && !legacyContainer) return { container: null, changed: false };
    if (!metadataContainer) return { container: cloneContainer_ACU(legacyContainer as Record<string, unknown>), changed: true };
    if (!legacyContainer) return { container: cloneContainer_ACU(metadataContainer), changed: false };

    const merged = cloneContainer_ACU(metadataContainer);
    let changed = false;
    Object.entries(legacyContainer).forEach(([key, value]) => {
        if (key === 'version') return;
        const targetValue = merged[key];
        if (
            value && typeof value === 'object' && !Array.isArray(value)
            && targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)
        ) {
            changed = mergeObjectSlots_ACU(targetValue as Record<string, unknown>, value as Record<string, unknown>) || changed;
        } else if (!Object.prototype.hasOwnProperty.call(merged, key)) {
            merged[key] = cloneScopedConfigData_ACU(value, value as any) as unknown;
            changed = true;
        }
    });
    return { container: merged, changed };
}

function mergeLegacyGuideIntoMetadata_ACU(metadataContainer: Record<string, unknown> | null, legacyContainer: Record<string, unknown> | null): { container: Record<string, unknown> | null; changed: boolean } {
    if (!metadataContainer && !legacyContainer) return { container: null, changed: false };
    if (!metadataContainer) return { container: cloneContainer_ACU(legacyContainer as Record<string, unknown>), changed: true };
    if (!legacyContainer) return { container: cloneContainer_ACU(metadataContainer), changed: false };

    const merged = cloneContainer_ACU(metadataContainer);
    const legacyTags = legacyContainer.tags;
    if (legacyTags && typeof legacyTags === 'object' && !Array.isArray(legacyTags)) {
        if (!merged.tags || typeof merged.tags !== 'object' || Array.isArray(merged.tags)) merged.tags = {};
        const changed = mergeObjectSlots_ACU(merged.tags as Record<string, unknown>, legacyTags as Record<string, unknown>);
        return { container: merged, changed };
    }
    return { container: merged, changed: false };
}

/**
 * 读取作用域配置容器；chat_metadata 为权威源，chat[0] 只补齐 metadata 缺失的旧槽位。
 * @param chat SillyTavern 聊天数组
 * @returns 解析后的配置对象，或 null
 */
function readChatScopedConfigContainer_ACU(chat: unknown[], persistLegacyMerge: boolean, strict = false): Record<string, unknown> | null {
    if (!hasActiveChatContext_ACU(chat)) return null;
    const owner = getChatMetadataOwner_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU);
    const activeChatId = getActiveChatId_ACU();
    const metadataApplies = !activeChatId || !owner || owner === activeChatId;
    const rawMetadataContainer = readContainer_ACU(metadataApplies || !strict
        ? getChatMetadata_ACU()?.[CHAT_SCOPED_CONFIG_FIELD_ACU] : null, strict);
    const first = getChatFirstLayerMessageLocal_ACU(chat);
    const legacyContainer = first ? readContainer_ACU(first[CHAT_SCOPED_CONFIG_FIELD_ACU], strict) : null;
    const metadataContainer = shouldUseChatMetadataContainer_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU, rawMetadataContainer, legacyContainer)
        ? rawMetadataContainer
        : null;
    if (strict) for (const container of [metadataContainer, legacyContainer]) {
        const slots = container?.template;
        if (slots !== undefined && (!slots || typeof slots !== 'object' || Array.isArray(slots))) {
            throw new Error('只读模板槽位容器损坏，禁止合并或回退默认模板。');
        }
    }
    const merged = mergeLegacyScopedConfigIntoMetadata_ACU(metadataContainer, legacyContainer);
    if (persistLegacyMerge && merged.changed && merged.container) writeChatMetadataField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU, merged.container);
    return merged.container;
}

export function getChatScopedConfigContainer_ACU(chat: unknown[]): Record<string, unknown> | null {
    return readChatScopedConfigContainer_ACU(chat, true);
}

/** 事务快照专用纯读取：合并 legacy 槽位但绝不回写 chatMetadata。 */
export function peekChatScopedConfigContainer_ACU(chat: unknown[], { strict = false } = {}): Record<string, unknown> | null {
    return readChatScopedConfigContainer_ACU(chat, false, strict);
}

/**
 * 规范化作用域配置容器（确保 version 字段存在且合法）
 * @param container 原始容器对象
 * @returns 规范化后的容器对象
 */
export function normalizeChatScopedConfigContainer_ACU(container: unknown): Record<string, unknown> {
    const cloned = cloneScopedConfigData_ACU(container, {});
    const normalized: Record<string, unknown> = (cloned && typeof cloned === 'object' && !Array.isArray(cloned))
        ? cloned as Record<string, unknown>
        : {};
    const ver = normalized.version as number;
    normalized.version = Number.isFinite(ver)
        ? Math.max(CHAT_SCOPED_CONFIG_VERSION_ACU, Math.trunc(ver))
        : CHAT_SCOPED_CONFIG_VERSION_ACU;
    return normalized;
}

/**
 * 读取 Sheet Guide 容器；chat_metadata 为权威源，chat[0] 只补齐 metadata 缺失的旧标签槽位。
 * @param chat SillyTavern 聊天数组
 * @returns 解析后的 guide 对象，或 null
 */
function readChatSheetGuideContainer_ACU(chat: unknown[], persistLegacyMerge: boolean, strict = false): Record<string, unknown> | null {
    if (!hasActiveChatContext_ACU(chat)) return null;
    const owner = getChatMetadataOwner_ACU(CHAT_SHEET_GUIDE_FIELD_ACU);
    const activeChatId = getActiveChatId_ACU();
    const metadataApplies = !activeChatId || !owner || owner === activeChatId;
    const rawMetadataContainer = readContainer_ACU(metadataApplies || !strict
        ? getChatMetadata_ACU()?.[CHAT_SHEET_GUIDE_FIELD_ACU] : null, strict);
    const first = getChatFirstLayerMessageLocal_ACU(chat);
    const legacyContainer = first ? readContainer_ACU(first[CHAT_SHEET_GUIDE_FIELD_ACU], strict) : null;
    const metadataContainer = shouldUseChatMetadataContainer_ACU(CHAT_SHEET_GUIDE_FIELD_ACU, rawMetadataContainer, legacyContainer)
        ? rawMetadataContainer
        : null;
    if (strict) for (const container of [metadataContainer, legacyContainer]) {
        const tags = container?.tags;
        if (tags !== undefined && (!tags || typeof tags !== 'object' || Array.isArray(tags))) {
            throw new Error('只读 guide 标签容器损坏，禁止合并或回退默认模板。');
        }
    }
    const merged = mergeLegacyGuideIntoMetadata_ACU(metadataContainer, legacyContainer);
    if (persistLegacyMerge && merged.changed && merged.container) writeChatMetadataField_ACU(CHAT_SHEET_GUIDE_FIELD_ACU, merged.container);
    return merged.container;
}

export function getChatSheetGuideContainer_ACU(chat: unknown[]): Record<string, unknown> | null {
    return readChatSheetGuideContainer_ACU(chat, true);
}

/** 事务快照专用纯读取：合并 legacy 槽位但绝不回写 chatMetadata。 */
export function peekChatSheetGuideContainer_ACU(chat: unknown[], { strict = false } = {}): Record<string, unknown> | null {
    return readChatSheetGuideContainer_ACU(chat, false, strict);
}

export function setChatScopedConfigContainer_ACU(chat: unknown[], container: Record<string, unknown> | null): void {
    if (!hasActiveChatContext_ACU(chat)) return;
    const first = getChatFirstLayerMessageLocal_ACU(chat);
    if (!first) return;
    writeChatMetadataField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU, container);
    if (container && Object.keys(container).length > 0) {
        (first as Record<string, unknown>)[CHAT_SCOPED_CONFIG_FIELD_ACU] = container;
    } else {
        delete (first as Record<string, unknown>)[CHAT_SCOPED_CONFIG_FIELD_ACU];
    }
}

export function setChatSheetGuideContainer_ACU(chat: unknown[], container: Record<string, unknown> | null): void {
    if (!hasActiveChatContext_ACU(chat)) return;
    const first = getChatFirstLayerMessageLocal_ACU(chat);
    if (!first) return;
    writeChatMetadataField_ACU(CHAT_SHEET_GUIDE_FIELD_ACU, container);
    if (container && Object.keys(container).length > 0) {
        (first as Record<string, unknown>)[CHAT_SHEET_GUIDE_FIELD_ACU] = container;
    } else {
        delete (first as Record<string, unknown>)[CHAT_SHEET_GUIDE_FIELD_ACU];
    }
}
