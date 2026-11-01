/** 配置读取失败保留分类与键名，不携带可能包含密钥的原文或解析器错误。 */
export class ConfigStorageReadError_ACU extends Error {
    readonly code = 'CONFIG_STORAGE_READ_FAILED';
    constructor(readonly key: string, readonly reason: 'corrupt' | 'read_failed') {
        super(`配置读取${reason === 'corrupt' ? '发现损坏' : '失败'}，已停止覆盖写入，请恢复原始配置后重新加载。`);
        this.name = 'ConfigStorageReadError_ACU';
    }
}

/**
 * 已连接酒馆设置，但内存中的配置来自本浏览器本地副本（IndexedDB）。
 * 此时写入会用本地副本覆盖酒馆设置中的真实配置，因此拒绝写入，等待从酒馆设置重新加载。
 */
export class ConfigStorageWriteBlockedError_ACU extends Error {
    readonly code = 'CONFIG_STORAGE_WRITE_BLOCKED';
    constructor(readonly key: string) {
        super('已连接酒馆设置，但当前配置来自本浏览器的本地副本，已阻止写入以免覆盖酒馆中的配置；正在从酒馆设置重新加载。');
        this.name = 'ConfigStorageWriteBlockedError_ACU';
    }
}

/** null 仅表示键确实不存在；有效值必须是 JSON 对象。 */
export function readConfigObject_ACU(store: any, key: string): Record<string, any> | null {
    let raw: unknown;
    try {
        if (!store || typeof store.getItem !== 'function') throw new Error();
        raw = store.getItem(key);
    } catch {
        throw new ConfigStorageReadError_ACU(key, 'read_failed');
    }
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') throw new ConfigStorageReadError_ACU(key, 'corrupt');
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new ConfigStorageReadError_ACU(key, 'corrupt'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ConfigStorageReadError_ACU(key, 'corrupt');
    }
    return value as Record<string, any>;
}
