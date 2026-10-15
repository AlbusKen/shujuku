/** 配置读取失败保留分类与键名，不携带可能包含密钥的原文或解析器错误。 */
export class ConfigStorageReadError_ACU extends Error {
    readonly code = 'CONFIG_STORAGE_READ_FAILED';
    constructor(readonly key: string, readonly reason: 'corrupt' | 'read_failed') {
        super(`配置读取${reason === 'corrupt' ? '发现损坏' : '失败'}，已停止覆盖写入，请恢复原始配置后重新加载。`);
        this.name = 'ConfigStorageReadError_ACU';
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
