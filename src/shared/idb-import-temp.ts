/**
 * IndexedDB 导入临时存储 + 通用 IDB 工具
 *
 * 仅"外部导入"的暂存数据（分块内容、断点状态）使用 IndexedDB。
 */

import { topLevelWindow_ACU } from './env';
import { SCRIPT_ID_PREFIX_ACU } from './constants';
import { logWarn_ACU } from './utils';

// ── 通用 IDB 工具 ──
export function isIndexedDbAvailable_ACU(): boolean {
    return !!(topLevelWindow_ACU && (topLevelWindow_ACU as any).indexedDB);
}

export function idbRequestToPromise_ACU(req: any): Promise<any> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
}

/** 等待事务真正提交；请求成功不代表事务已提交，abort/error 均视为写入失败。 */
export function idbTransactionDone_ACU(tx: any): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    });
}

/** 写入/删除请求：同时等待请求成功与所属事务 complete。 */
export async function idbWriteRequest_ACU(tx: any, createRequest: (tx: any) => any): Promise<any> {
    const done = idbTransactionDone_ACU(tx);
    try {
        const [result] = await Promise.all([idbRequestToPromise_ACU(createRequest(tx)), done]);
        return result;
    } catch (error) {
        done.catch((): void => {});
        throw error;
    }
}

// ── 导入临时存储常量 ──
export const IMPORT_TEMP_DB_NAME_ACU = `${SCRIPT_ID_PREFIX_ACU}_importTemp_v1`;
export const IMPORT_TEMP_STORE_NAME_ACU = 'kv';
export let importTempDbPromise_ACU: Promise<any> | null = null;
export const importTempMem_ACU = new Map<string, any>();

export function openImportTempDb_ACU(): Promise<any> {
    if (!isIndexedDbAvailable_ACU()) return Promise.resolve(null);
    if (importTempDbPromise_ACU) return importTempDbPromise_ACU;
    importTempDbPromise_ACU = new Promise((resolve, reject) => {
        try {
            const req = (topLevelWindow_ACU as any).indexedDB.open(IMPORT_TEMP_DB_NAME_ACU, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IMPORT_TEMP_STORE_NAME_ACU)) {
                    db.createObjectStore(IMPORT_TEMP_STORE_NAME_ACU);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        } catch (e) {
            reject(e);
        }
    });
    return importTempDbPromise_ACU;
}

export async function idbGet_ACU(key: string): Promise<any> {
    const db = await openImportTempDb_ACU();
    if (!db) return undefined;
    const tx = db.transaction(IMPORT_TEMP_STORE_NAME_ACU, 'readonly');
    const store = tx.objectStore(IMPORT_TEMP_STORE_NAME_ACU);
    return await idbRequestToPromise_ACU(store.get(key));
}

export async function idbSet_ACU(key: string, value: any): Promise<void> {
    const db = await openImportTempDb_ACU();
    if (!db) return;
    const tx = db.transaction(IMPORT_TEMP_STORE_NAME_ACU, 'readwrite');
    await idbWriteRequest_ACU(tx, t => t.objectStore(IMPORT_TEMP_STORE_NAME_ACU).put(value, key));
}

export async function idbDel_ACU(key: string): Promise<void> {
    const db = await openImportTempDb_ACU();
    if (!db) return;
    const tx = db.transaction(IMPORT_TEMP_STORE_NAME_ACU, 'readwrite');
    await idbWriteRequest_ACU(tx, t => t.objectStore(IMPORT_TEMP_STORE_NAME_ACU).delete(key));
}

export async function importTempGet_ACU(key: string): Promise<any> {
    try {
        if (isIndexedDbAvailable_ACU()) {
            const v = await idbGet_ACU(key);
            if (typeof v !== 'undefined') return v;
        }
    } catch (e) {
        logWarn_ACU('[外部导入] IndexedDB get 失败，将回退到"仅内存暂存"(不落盘):', e);
    }
    return importTempMem_ACU.has(key) ? importTempMem_ACU.get(key) : null;
}

export async function importTempSet_ACU(key: string, value: any): Promise<void> {
    try {
        if (isIndexedDbAvailable_ACU()) {
            await idbSet_ACU(key, value);
            return;
        }
    } catch (e) {
        logWarn_ACU('[外部导入] IndexedDB set 失败，将回退到"仅内存暂存"(不落盘):', e);
    }
    importTempMem_ACU.set(key, value);
}

export async function importTempRemove_ACU(key: string): Promise<void> {
    try {
        if (isIndexedDbAvailable_ACU()) {
            await idbDel_ACU(key);
        }
    } catch (e) {
        logWarn_ACU('[外部导入] IndexedDB delete 失败，将继续清理"仅内存暂存":', e);
    }
    importTempMem_ACU.delete(key);
}
