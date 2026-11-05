/**
 * Profile 与 GlobalMeta 管理
 *
 * 全局元信息（跨标识共享）+ Profile 化存储（按标识代码分组的设置/模板）
 */

import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../shared/json-helpers';
import { logWarn_ACU } from '../../shared/utils';
import { STORAGE_KEY_GLOBAL_META_ACU, STORAGE_KEY_PROFILE_PREFIX_ACU, DEFAULT_ISOLATION_SLOT_ACU, normalizeIsolationCode_ACU, getProfileSettingsKey_ACU, getProfileTemplateKey_ACU } from '../../shared/data-constants';
import { getConfigStorage_ACU } from '../storage/tavern-storage';
import { TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';
import { ConfigStorageReadError_ACU, readConfigObject_ACU, writeConfigItem_ACU } from '../storage/config-read';
import { setTakeoverRuntimeEnabled_ACU } from '../../shared/takeover-control';

function readStoredObject_ACU(key: string): Record<string, any> | null {
    try {
        return readConfigObject_ACU(getConfigStorage_ACU(), key);
    } catch (error) {
        if (error instanceof ConfigStorageReadError_ACU) throw error;
        throw new ConfigStorageReadError_ACU(key, 'read_failed');
    }
}

function readGlobalMetaObject_ACU(): Record<string, any> | null {
    const value = readStoredObject_ACU(STORAGE_KEY_GLOBAL_META_ACU);
    if (value && (
        ('takeoverEnabledGlobal' in value && typeof value.takeoverEnabledGlobal !== 'boolean') ||
        ('activeIsolationCode' in value && typeof value.activeIsolationCode !== 'string') ||
        ('isolationCodeList' in value && (!Array.isArray(value.isolationCodeList) || value.isolationCodeList.some((code: unknown) => typeof code !== 'string'))) ||
        ('vectorMemoryConfigGlobal' in value && value.vectorMemoryConfigGlobal !== null &&
            (typeof value.vectorMemoryConfigGlobal !== 'object' || Array.isArray(value.vectorMemoryConfigGlobal)))
    )) throw new ConfigStorageReadError_ACU(STORAGE_KEY_GLOBAL_META_ACU, 'corrupt');
    return value;
}

export let globalMeta_ACU: any = {
    version: 1,
    activeIsolationCode: '',
    isolationCodeList: [] as string[],
    migratedLegacySingleStore: false,
    zeroTkOccupyModeGlobal: false,
    summaryVectorIndexModeGlobal: false,
    plotEnabledGlobal: true,
    takeoverEnabledGlobal: true,
    vectorMemoryConfigGlobal: null,
};

export function buildDefaultGlobalMeta_ACU(): any {
    return {
        version: 1,
        activeIsolationCode: '',
        isolationCodeList: [],
        migratedLegacySingleStore: false,
        zeroTkOccupyModeGlobal: false,
        summaryVectorIndexModeGlobal: false,
        plotEnabledGlobal: true,
        takeoverEnabledGlobal: true,
        vectorMemoryConfigGlobal: null,
    };
}

let globalMetaMissingOnLoad_ACU = false;
let globalMetaWriteSuspended_ACU = false;

/** 最近一次 loadGlobalMeta_ACU 是否读到键缺失；损坏与读取失败会抛错，不计入缺失。 */
export function wasGlobalMetaMissingOnLoad_ACU(): boolean {
    return globalMetaMissingOnLoad_ACU;
}

/** 配置档待用户选择时暂停写入 GlobalMeta，避免把缺失状态固化为空隔离码。 */
export function setGlobalMetaWriteSuspended_ACU(suspended: boolean): void {
    globalMetaWriteSuspended_ACU = suspended;
}

export function isGlobalMetaWriteSuspended_ACU(): boolean {
    return globalMetaWriteSuspended_ACU;
}

/** 列出存储中已有设置或模板的配置档标识，默认槽为 ''；存储不支持枚举时返回 null。 */
export function listStoredProfileCodes_ACU(): string[] | null {
    const store = getConfigStorage_ACU();
    if (typeof store?.keys !== 'function') return null;
    const prefix = `${STORAGE_KEY_PROFILE_PREFIX_ACU}__`;
    const codes = new Set<string>();
    for (const key of store.keys()) {
        if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
        const match = /^(.+)__(settings|template)$/.exec(key.slice(prefix.length));
        if (!match) continue;
        if (match[1] === DEFAULT_ISOLATION_SLOT_ACU) {
            codes.add('');
            continue;
        }
        try {
            const code = normalizeIsolationCode_ACU(decodeURIComponent(match[1]));
            if (code) codes.add(code);
        } catch {
            // 无法解码的槽位不是本插件写入的配置档。
        }
    }
    return [...codes];
}

export function loadGlobalMeta_ACU(): any {
    const parsed = readGlobalMetaObject_ACU();
    globalMetaMissingOnLoad_ACU = parsed === null;
    if (parsed === null) {
        globalMeta_ACU = buildDefaultGlobalMeta_ACU();
        setTakeoverRuntimeEnabled_ACU(true);
        return globalMeta_ACU;
    }
    globalMeta_ACU = { ...buildDefaultGlobalMeta_ACU(), ...parsed };
    setTakeoverRuntimeEnabled_ACU(globalMeta_ACU.takeoverEnabledGlobal !== false);
    globalMeta_ACU.activeIsolationCode = normalizeIsolationCode_ACU(globalMeta_ACU.activeIsolationCode);
    if (!Array.isArray(globalMeta_ACU.isolationCodeList)) globalMeta_ACU.isolationCodeList = [];
    return globalMeta_ACU;
}

export function saveGlobalMeta_ACU(): boolean {
    if (globalMetaWriteSuspended_ACU) {
        logWarn_ACU('[GlobalMeta] 配置档待选择，暂停写入全局元信息。');
        return false;
    }
    try {
        // 每次写入前重读，保护启动之外的直接保存路径和外部发生的损坏。
        readGlobalMetaObject_ACU();
        const store = getConfigStorage_ACU();
        const payload = safeJsonStringify_ACU(globalMeta_ACU, '{}');
        writeConfigItem_ACU(store, STORAGE_KEY_GLOBAL_META_ACU, payload);
        return true;
    } catch (e) {
        logWarn_ACU('[GlobalMeta] Failed to save:', e);
        return false;
    }
}

export function readProfileSettingsFromStorage_ACU(code: string): any {
    return readStoredObject_ACU(getProfileSettingsKey_ACU(code));
}

export function writeProfileSettingsToStorage_ACU(code: string, settingsObj: any): void {
    readProfileSettingsFromStorage_ACU(code);
    const store = getConfigStorage_ACU();
    writeConfigItem_ACU(store, getProfileSettingsKey_ACU(code), safeJsonStringify_ACU(settingsObj, '{}'));
}

export function readProfileTemplateFromStorage_ACU(code: string): string | null {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(getProfileTemplateKey_ACU(code));
    return (typeof raw === 'string' && raw.trim()) ? raw : null;
}

export function writeProfileTemplateToStorage_ACU(code: string, templateStr: string): void {
    const store = getConfigStorage_ACU();
    writeConfigItem_ACU(store, getProfileTemplateKey_ACU(code), String(templateStr || ''));
}

/**
 * 删除非默认隔离标签对应的设置与表格模板。
 *
 * 空标识代表默认 Profile，必须保留；调用方只应传入待退役的旧隔离码。
 */
export function deleteProfileFromStorage_ACU(code: string): void {
    const normalizedCode = normalizeIsolationCode_ACU(code);
    if (!normalizedCode) {
        throw new Error('不能删除默认 Profile。');
    }
    const store = getConfigStorage_ACU();
    if (!store || typeof store.removeItem !== 'function') {
        throw new Error('当前配置存储不支持删除 Profile。');
    }
    store.removeItem(getProfileSettingsKey_ACU(normalizedCode));
    store.removeItem(getProfileTemplateKey_ACU(normalizedCode));
}
export function saveCurrentProfileTemplate_ACU(templateStr?: string, settings?: any): void {
    const tpl = templateStr !== undefined ? templateStr : TABLE_TEMPLATE_ACU;
    const code = normalizeIsolationCode_ACU(settings?.dataIsolationCode || '');
    writeProfileTemplateToStorage_ACU(code, String(tpl || ''));
}

export function sanitizeSettingsForProfileSave_ACU(settingsObj: any): any {
    const cloned = safeJsonParse_ACU(safeJsonStringify_ACU(settingsObj, '{}'), {});
    delete cloned.dataIsolationHistory;
    delete cloned.dataIsolationEnabled;
    // 交火/向量模型 API 配置是全局配置，权威副本存放在 globalMeta.vectorMemoryConfigGlobal。
    // profile payload 中继续保存会导致切换隔离标识后旧值反向污染全局配置。
    delete cloned.vectorMemoryConfig;
    return cloned;
}
