/**
 * 酒馆设置存储桥接（Tavern Settings Bridge）
 *
 * 负责在 SillyTavern 的 extensionSettings 中读写脚本设置。
 */

import { topLevelWindow_ACU, FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU, ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU, legacyLocalStorage_ACU, storage_ACU } from '../../shared/env';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { isExtensionMode } from '../../shared/runtime-env';

// ── 常量 ──
import { idbRequestToPromise_ACU, isIndexedDbAvailable_ACU } from '../../shared/idb-import-temp';

export const USE_TAVERN_SETTINGS_STORAGE_ACU = true;
export const TAVERN_SETTINGS_NAMESPACE_ACU = `${SCRIPT_ID_PREFIX_ACU}__userscript_settings_v1`;
export let tavernSaveSettingsFn_ACU: any = null;
export let tavernExtensionSettingsRoot_ACU: any = null;
export const TAVERN_BRIDGE_GLOBAL_KEY_ACU = '__ACU_USERSCRIPT_BRIDGE__';
export const TAVERN_BRIDGE_INJECTED_FLAG_ACU = '__ACU_USERSCRIPT_BRIDGE_INJECTED__';
export const sleep_ACU = (ms: number) => new Promise(r => setTimeout(r, ms));
export let tavernBridgeErrorReported_ACU = false;

// ── userscript 路径专用状态（插件路径不使用这些变量）──
/** userscript 模式下 bridge 初始化是否已完成（无论成功或失败） */
let _tavernBridgeInitCompleted_ACU = false;
/** userscript 模式下是否已报告过"根对象不可用"（防止重复刷屏） */
let _tavernRootUnavailableWarnReported_ACU = false;

// ── 桥接函数 ──
export function tryReadBridgeFromTop_ACU(): boolean {
    try {
        const bridge = (topLevelWindow_ACU as any)?.[TAVERN_BRIDGE_GLOBAL_KEY_ACU];
        if (bridge && typeof bridge === 'object') {
            if (bridge.error && !tavernBridgeErrorReported_ACU) {
                tavernBridgeErrorReported_ACU = true;
                console.warn(`[${SCRIPT_ID_PREFIX_ACU}] Tavern bridge 初始化失败：`, bridge.error);
            }
            if (bridge.extension_settings && !tavernExtensionSettingsRoot_ACU) tavernExtensionSettingsRoot_ACU = bridge.extension_settings;
            if (!tavernSaveSettingsFn_ACU) tavernSaveSettingsFn_ACU = bridge.saveSettingsDebounced || bridge.saveSettings || null;
            return !!(tavernExtensionSettingsRoot_ACU);
        }
    } catch (e) { /* ignore */ }
    return false;
}

export async function injectTavernBridgeIntoTopWindow_ACU(): Promise<boolean> {
    try {
        if ((topLevelWindow_ACU as any)?.[TAVERN_BRIDGE_INJECTED_FLAG_ACU]) return true;
        (topLevelWindow_ACU as any)[TAVERN_BRIDGE_INJECTED_FLAG_ACU] = true;

        const doc = (topLevelWindow_ACU as any).document;
        if (!doc || !doc.createElement) return false;

        const s = doc.createElement('script');
        s.type = 'module';
        s.textContent = `
            (async () => {
                try {
                    const ext = await import('/scripts/extensions.js');
                    const main = await import('/script.js');
                    window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'] = window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'] || {};
                    window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'].extension_settings = ext?.extension_settings || null;
                    window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'].saveSettingsDebounced = main?.saveSettingsDebounced || null;
                    window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'].saveSettings = main?.saveSettings || null;
                } catch (e) {
                    window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'] = window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'] || {};
                    window['${TAVERN_BRIDGE_GLOBAL_KEY_ACU}'].error = String(e && (e.message || e));
                }
            })();
        `;
        (doc.head || doc.documentElement || doc.body).appendChild(s);
        return true;
    } catch (e) {
        return false;
    }
}

export async function initTavernSettingsBridge_ACU(): Promise<boolean> {
    if (!USE_TAVERN_SETTINGS_STORAGE_ACU) return false;
    logDebug_ACU('[TavernStorage] 开始初始化酒馆设置桥接...');

    // ── 插件模式快速路径 ──
    // 插件运行在酒馆主窗口中。主窗口的 window.SillyTavern 只有 {libs, getContext}，
    // 所有真正的 API 都必须通过 SillyTavern.getContext() 这个函数调用来获取。
    // 酒馆源码证实：extensionSettings 和 saveSettingsDebounced 都在 getContext() 返回值中。
    if (isExtensionMode()) {
        logDebug_ACU('[TavernStorage] 插件模式：通过 SillyTavern.getContext() 获取设置对象...');

        try {
            const st = (window as any).SillyTavern;
            if (st && typeof st.getContext === 'function') {
                const ctx = st.getContext();
                if (ctx) {
                    if (ctx.extensionSettings) {
                        tavernExtensionSettingsRoot_ACU = ctx.extensionSettings;
                        logDebug_ACU('[TavernStorage] 插件模式：extensionSettings 获取成功');
                    } else {
                        logWarn_ACU('[TavernStorage] 插件模式：getContext().extensionSettings 为空');
                    }
                    if (typeof ctx.saveSettingsDebounced === 'function') {
                        tavernSaveSettingsFn_ACU = ctx.saveSettingsDebounced;
                        logDebug_ACU('[TavernStorage] 插件模式：saveSettingsDebounced 获取成功');
                    } else {
                        logWarn_ACU('[TavernStorage] 插件模式：getContext().saveSettingsDebounced 不是函数');
                    }
                } else {
                    logWarn_ACU('[TavernStorage] 插件模式：getContext() 返回空值');
                }
            } else {
                logWarn_ACU('[TavernStorage] 插件模式：SillyTavern.getContext 不可用');
            }
        } catch (e) {
            logError_ACU('[TavernStorage] 插件模式：调用 getContext() 失败:', e);
        }

        logDebug_ACU(`[TavernStorage] 插件模式初始化完成: settings=${!!tavernExtensionSettingsRoot_ACU}, save=${!!tavernSaveSettingsFn_ACU}`);
        return !!tavernExtensionSettingsRoot_ACU;
    }

    // ── 油猴脚本模式（原有逻辑）──
    tryReadBridgeFromTop_ACU();
    try {
        if (typeof (topLevelWindow_ACU as any).saveSettingsDebounced === 'function') tavernSaveSettingsFn_ACU = (topLevelWindow_ACU as any).saveSettingsDebounced;
        else if (typeof (window as any).saveSettingsDebounced === 'function') tavernSaveSettingsFn_ACU = (window as any).saveSettingsDebounced;
        else if (typeof (topLevelWindow_ACU as any).saveSettings === 'function') tavernSaveSettingsFn_ACU = (topLevelWindow_ACU as any).saveSettings;
        else if (typeof (window as any).saveSettings === 'function') tavernSaveSettingsFn_ACU = (window as any).saveSettings;
    } catch (e) { /* ignore */ }

    tryReadBridgeFromTop_ACU();
    if (!tavernExtensionSettingsRoot_ACU) {
        await injectTavernBridgeIntoTopWindow_ACU();
        for (let i = 0; i < 40 && !tavernExtensionSettingsRoot_ACU; i++) {
            tryReadBridgeFromTop_ACU();
            if (tavernExtensionSettingsRoot_ACU) break;
            await sleep_ACU(50);
        }
    }

    try {
        const mod = await import('./script.js' as any);
        if (mod) {
            if (typeof mod.saveSettingsDebounced === 'function') tavernSaveSettingsFn_ACU = mod.saveSettingsDebounced;
            else if (typeof mod.saveSettings === 'function') tavernSaveSettingsFn_ACU = mod.saveSettings;
        }
    } catch (e) { /* ignore */ }
    try {
        const ext = await import('./scripts/extensions.js' as any);
        if (ext && ext.extension_settings) {
            tavernExtensionSettingsRoot_ACU = ext.extension_settings;
        }
    } catch (e) { /* ignore */ }
    // ── userscript 路径：标记 bridge 初始化已完成（无论是否成功获取 root）──
    _tavernBridgeInitCompleted_ACU = true;
    return !!tavernExtensionSettingsRoot_ACU;
}

export function getTavernSettingsNamespace_ACU(): any {
    tryReadBridgeFromTop_ACU();
    const root = tavernExtensionSettingsRoot_ACU;
    if (!root) {
        // ── 插件模式：保持原有行为（bridge 在 waitForTavernHelper 中已确保就绪）──
        if (isExtensionMode()) {
            logWarn_ACU('[TavernStorage] 酒馆设置根对象不可用, 返回 null');
            return null;
        }
        // ── userscript 模式：bridge 初始化未完成时安静降级，完成后只告警一次 ──
        if (!_tavernBridgeInitCompleted_ACU) {
            // bridge 还在初始化中，不打印任何告警，安静返回 null 让调用方走 IndexedDB/localStorage 回退
            return null;
        }
        // bridge 初始化已完成但仍拿不到 root → 只告警一次
        if (!_tavernRootUnavailableWarnReported_ACU) {
            _tavernRootUnavailableWarnReported_ACU = true;
            logWarn_ACU('[TavernStorage] 酒馆设置根对象不可用, 返回 null（后续将使用 IndexedDB/localStorage 降级存储）');
        }
        return null;
    }
    // root 可用 → 如果之前标记过不可用，清除标记以便后续状态变化能重新报告
    if (_tavernRootUnavailableWarnReported_ACU) {
        _tavernRootUnavailableWarnReported_ACU = false;
        logDebug_ACU('[TavernStorage] 酒馆设置根对象已恢复可用');
    }
    if (!root.__userscripts) root.__userscripts = {};
    if (!root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU]) root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU] = {};
    return root.__userscripts[TAVERN_SETTINGS_NAMESPACE_ACU];
}

export function persistTavernSettings_ACU(): void {
    try {
        tryReadBridgeFromTop_ACU();
        if (typeof tavernSaveSettingsFn_ACU === 'function') {
            tavernSaveSettingsFn_ACU();
            return;
        }
        if (typeof (topLevelWindow_ACU as any).saveSettingsDebounced === 'function') { (topLevelWindow_ACU as any).saveSettingsDebounced(); return; }
        if (typeof (window as any).saveSettingsDebounced === 'function') { (window as any).saveSettingsDebounced(); return; }
        if (typeof (topLevelWindow_ACU as any).saveSettings === 'function') (topLevelWindow_ACU as any).saveSettings();
        else if (typeof (window as any).saveSettings === 'function') (window as any).saveSettings();
        else logWarn_ACU('[TavernStorage] 找不到任何可用的 saveSettings 函数');
    } catch (e) {
        logWarn_ACU('[TavernStorage] 持久化到酒馆设置失败, 回退到内存模式:', e);
    }
}

// ── IndexedDB 配置缓存 ──
export const CONFIG_IDB_DB_NAME_ACU = `${SCRIPT_ID_PREFIX_ACU}_config_v1`;
export const CONFIG_IDB_STORE_NAME_ACU = 'kv';
export let configIdbPromise_ACU: Promise<any> | null = null;
export const configIdbCache_ACU = new Map<string, any>();
export const configIdbDeletedKeys_ACU = new Set<string>();
export let configIdbCacheLoaded_ACU = false;
export let configIdbCacheLoadingPromise_ACU: Promise<void> | null = null;
export let configIdbCacheLoadFailed_ACU = false;
export let pendingSettingsReloadFromIdb_ACU = false;

export function openConfigDb_ACU(): Promise<any> {
    if (!isIndexedDbAvailable_ACU()) return Promise.resolve(null);
    if (configIdbPromise_ACU) return configIdbPromise_ACU;
    configIdbPromise_ACU = new Promise((resolve, reject) => {
        try {
            const req = (topLevelWindow_ACU as any).indexedDB.open(CONFIG_IDB_DB_NAME_ACU, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(CONFIG_IDB_STORE_NAME_ACU)) {
                    db.createObjectStore(CONFIG_IDB_STORE_NAME_ACU);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        } catch (e) {
            reject(e);
        }
    });
    return configIdbPromise_ACU;
}

export function loadConfigIdbCache_ACU(): Promise<void> {
    if (configIdbCacheLoaded_ACU || configIdbCacheLoadFailed_ACU) return Promise.resolve();
    if (configIdbCacheLoadingPromise_ACU) return configIdbCacheLoadingPromise_ACU;
    if (!isIndexedDbAvailable_ACU()) {
        configIdbCacheLoaded_ACU = true;
        return Promise.resolve();
    }
    configIdbCacheLoadingPromise_ACU = new Promise(async (resolve) => {
        try {
            const db = await openConfigDb_ACU();
            if (!db) {
                configIdbCacheLoaded_ACU = true;
                resolve();
                return;
            }
            const tx = db.transaction(CONFIG_IDB_STORE_NAME_ACU, 'readonly');
            const store = tx.objectStore(CONFIG_IDB_STORE_NAME_ACU);
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    const key = cursor.key as string;
                    if (!configIdbDeletedKeys_ACU.has(key) && !configIdbCache_ACU.has(key)) {
                        configIdbCache_ACU.set(key, cursor.value);
                    }
                    cursor.continue();
                } else {
                    configIdbCacheLoaded_ACU = true;
                    resolve();
                }
            };
            req.onerror = () => {
                logWarn_ACU('[TavernStorage] IndexedDB 配置缓存加载失败:', req.error);
                configIdbCacheLoadFailed_ACU = true;
                configIdbCacheLoaded_ACU = true;
                resolve();
            };
        } catch (e) {
            logWarn_ACU('[TavernStorage] IndexedDB 配置缓存加载失败:', e);
            configIdbCacheLoadFailed_ACU = true;
            configIdbCacheLoaded_ACU = true;
            resolve();
        }
    });
    return configIdbCacheLoadingPromise_ACU;
}

export function ensureConfigIdbCacheLoaded_ACU(): Promise<void> {
    return loadConfigIdbCache_ACU();
}

export function configIdbGetCached_ACU(key: string): any {
    return configIdbCache_ACU.has(key) ? configIdbCache_ACU.get(key) : null;
}

export async function configIdbSetCached_ACU(key: string, value: any): Promise<void> {
    configIdbCache_ACU.set(key, value);
    configIdbDeletedKeys_ACU.delete(key);
    try {
        if (!isIndexedDbAvailable_ACU()) return;
        const db = await openConfigDb_ACU();
        if (!db) return;
        const tx = db.transaction(CONFIG_IDB_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(CONFIG_IDB_STORE_NAME_ACU);
        await idbRequestToPromise_ACU(store.put(value, key));
    } catch (e) {
        logWarn_ACU('[TavernStorage] IndexedDB 配置 set 失败:', e);
    }
}

export async function configIdbRemoveCached_ACU(key: string): Promise<void> {
    configIdbCache_ACU.delete(key);
    configIdbDeletedKeys_ACU.add(key);
    try {
        if (!isIndexedDbAvailable_ACU()) return;
        const db = await openConfigDb_ACU();
        if (!db) return;
        const tx = db.transaction(CONFIG_IDB_STORE_NAME_ACU, 'readwrite');
        const store = tx.objectStore(CONFIG_IDB_STORE_NAME_ACU);
        await idbRequestToPromise_ACU(store.delete(key));
    } catch (e) {
        logWarn_ACU('[TavernStorage] IndexedDB 配置 delete 失败:', e);
    }
}

export function getConfigStorage_ACU(): any {
    const ns = USE_TAVERN_SETTINGS_STORAGE_ACU ? getTavernSettingsNamespace_ACU() : null;
    const hasTavern = !!ns;
    return {
        getItem: (key: string) => {
            if (hasTavern && Object.prototype.hasOwnProperty.call(ns, key)) return ns[key];
            const cached = configIdbGetCached_ACU(key);
            if (cached !== null && typeof cached !== 'undefined') return cached;
            if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU && storage_ACU?.getItem) return storage_ACU.getItem(key);
            return null;
        },
        setItem: (key: string, value: any) => {
            const v = String(value);
            if (hasTavern) {
                ns[key] = v;
                persistTavernSettings_ACU();
            } else if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU && storage_ACU?.setItem) {
                storage_ACU.setItem(key, v);
            }
            void configIdbSetCached_ACU(key, v);
        },
        removeItem: (key: string) => {
            if (hasTavern) {
                delete ns[key];
                persistTavernSettings_ACU();
            } else if (!FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU && storage_ACU?.removeItem) {
                storage_ACU.removeItem(key);
            }
            void configIdbRemoveCached_ACU(key);
        },
        _isTavern: hasTavern,
    };
}

export function migrateKeyToTavernStorageIfNeeded_ACU(key: string): boolean {
    const store = getConfigStorage_ACU();
    if (!store || !store._isTavern) return false;
    const cur = store.getItem(key);
    if (cur !== null && typeof cur !== 'undefined') return false;
    if (!ALLOW_LEGACY_LOCALSTORAGE_MIGRATION_ACU || !legacyLocalStorage_ACU) return false;
    const legacy = legacyLocalStorage_ACU.getItem(key);
    if (legacy !== null && typeof legacy !== 'undefined') {
        store.setItem(key, legacy);
        try { legacyLocalStorage_ACU.removeItem(key); } catch (e) { /* ignore */ }
        return true;
    }
    return false;
}

export function _set_pendingSettingsReloadFromIdb_ACU(v: any) { pendingSettingsReloadFromIdb_ACU = v; }

/** 测试用：重置模块级状态变量 */
export function _resetTavernStorageState_ACU(): void {
    tavernExtensionSettingsRoot_ACU = null;
    tavernSaveSettingsFn_ACU = null;
    tavernBridgeErrorReported_ACU = false;
    _tavernBridgeInitCompleted_ACU = false;
    _tavernRootUnavailableWarnReported_ACU = false;
}