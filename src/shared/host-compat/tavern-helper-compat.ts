/**
 * shared/host-compat/tavern-helper-compat.ts — TavernHelper 兼容适配器
 *
 * 对外暴露代码库消费的旧版扁平方法面（getLorebookEntries 等 13 个方法），
 * 内部逐方法按三级择优解析后端：
 * - passthrough：宿主对象上存在同名函数（旧版酒馆助手 iframe 全量 API，
 *   或新旧共用名如 getChatMessages/triggerSlash），直接透传——油猴模式行为零变化。
 * - mapped：宿主对象只有新版改名 API（getWorldbook/replaceWorldbook 系），
 *   包装参数与条目格式转换后调用。
 * - native：宿主完全没有酒馆助手，落到 SillyTavern 原生后端。
 *
 * generateRaw 没有原生等价实现：两级不中则不挂载该方法，
 * 保持"方法缺失"语义，让 isGenerateRawAvailable_ACU 等既有检查自然生效。
 */

import { logDebug_ACU } from '../utils';
import {
    newToOldEntry_ACU,
    oldPatchToNewPatch_ACU,
    type OldFlatLorebookEntry_ACU,
} from './entry-format';
import { createNativeStBackend_ACU, type GetStApi_ACU, type NativeStBackend_ACU } from './native-st-backend';

export type HostCapabilityBackend_ACU = 'passthrough' | 'mapped' | 'native' | 'missing';

export type HostCapabilityMap_ACU = Record<string, HostCapabilityBackend_ACU>;

export interface TavernHelperCompatResult_ACU {
    api: any;
    capabilities: HostCapabilityMap_ACU;
}

/** 最近一次构建的能力表，供初始化失败分支输出诊断 */
let lastCapabilities_ACU: HostCapabilityMap_ACU | null = null;

export function getLastHostCapabilities_ACU(): HostCapabilityMap_ACU | null {
    return lastCapabilities_ACU;
}

/** 生成人类可读的能力诊断文本（缺失项排前） */
export function formatHostCapabilities_ACU(capabilities: HostCapabilityMap_ACU | null): string {
    if (!capabilities) return '（能力表尚未生成）';
    const missing = Object.entries(capabilities).filter(([, backend]) => backend === 'missing').map(([name]) => name);
    const resolved = Object.entries(capabilities)
        .filter(([, backend]) => backend !== 'missing')
        .map(([name, backend]) => `${name}=${backend}`);
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`缺失: ${missing.join(', ')}`);
    if (resolved.length > 0) parts.push(`已解析: ${resolved.join(', ')}`);
    return parts.join('；') || '（空能力表）';
}

function hasFn_ACU(obj: any, name: string): boolean {
    return !!obj && typeof obj[name] === 'function';
}

/** 把新版嵌套 partial patch 合并进新版完整条目（保持未指定字段不变） */
function mergeNewEntryPatch_ACU(entry: any, patch: Record<string, any>): any {
    const merged: any = { ...entry };
    for (const [key, value] of Object.entries(patch)) {
        if (key === 'strategy' || key === 'position' || key === 'recursion' || key === 'effect') {
            const sub = { ...(entry?.[key] ?? {}), ...(value as Record<string, any>) };
            if (key === 'strategy' && (value as any)?.keys_secondary) {
                sub.keys_secondary = { ...(entry?.strategy?.keys_secondary ?? {}), ...(value as any).keys_secondary };
            }
            merged[key] = sub;
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

interface WorldbookHostBackend_ACU {
    getLorebookEntries?: (bookName: string) => Promise<OldFlatLorebookEntry_ACU[]>;
    setLorebookEntries?: (bookName: string, entries: Array<Record<string, any>>) => Promise<void>;
    createLorebookEntries?: (bookName: string, entries: Array<Record<string, any>>) => Promise<{ entries: OldFlatLorebookEntry_ACU[]; new_uids: number[] }>;
    deleteLorebookEntries?: (bookName: string, uids: number[]) => Promise<{ entries: OldFlatLorebookEntry_ACU[]; delete_occurred: boolean }>;
    getLorebooks?: () => Promise<string[]>;
    getCharWorldbookNames?: (characterName?: string) => Promise<{ primary: string | null; additional: string[] }>;
}

type WorldbookBackendMethodName_ACU = keyof WorldbookHostBackend_ACU;

function createRawTavernHelperWorldbookBackend_ACU(rawTH: any): {
    backend: WorldbookHostBackend_ACU;
    capabilities: Partial<Record<WorldbookBackendMethodName_ACU, HostCapabilityBackend_ACU>>;
} {
    const backend: WorldbookHostBackend_ACU = {};
    const capabilities: Partial<Record<WorldbookBackendMethodName_ACU, HostCapabilityBackend_ACU>> = {};
    const mount = (name: WorldbookBackendMethodName_ACU, implementation: any, capability: HostCapabilityBackend_ACU): void => {
        backend[name] = implementation;
        capabilities[name] = capability;
    };

    if (hasFn_ACU(rawTH, 'getLorebookEntries')) {
        mount('getLorebookEntries', rawTH.getLorebookEntries.bind(rawTH), 'passthrough');
    } else if (hasFn_ACU(rawTH, 'getWorldbook')) {
        mount('getLorebookEntries', async (bookName: string): Promise<OldFlatLorebookEntry_ACU[]> => {
            const worldbook = await rawTH.getWorldbook(bookName);
            return (Array.isArray(worldbook) ? worldbook : []).map((entry: any, index: number) => newToOldEntry_ACU(entry, index));
        }, 'mapped');
    }

    if (hasFn_ACU(rawTH, 'setLorebookEntries')) {
        mount('setLorebookEntries', rawTH.setLorebookEntries.bind(rawTH), 'passthrough');
    } else if (hasFn_ACU(rawTH, 'updateWorldbookWith')) {
        mount('setLorebookEntries', async (bookName: string, entries: Array<Record<string, any>>): Promise<void> => {
            if (!Array.isArray(entries) || entries.length === 0) return;
            const patchByUid = new Map<number, Record<string, any>>();
            for (const patch of entries) {
                if (patch && patch.uid !== undefined && patch.uid !== null) patchByUid.set(Number(patch.uid), oldPatchToNewPatch_ACU(patch));
            }
            await rawTH.updateWorldbookWith(bookName, (worldbook: any[]) => worldbook.map(entry => {
                const patch = patchByUid.get(Number(entry?.uid));
                return patch ? mergeNewEntryPatch_ACU(entry, patch) : entry;
            }));
        }, 'mapped');
    }

    if (hasFn_ACU(rawTH, 'createLorebookEntries')) {
        mount('createLorebookEntries', rawTH.createLorebookEntries.bind(rawTH), 'passthrough');
    } else if (hasFn_ACU(rawTH, 'createWorldbookEntries')) {
        mount('createLorebookEntries', async (bookName: string, entries: Array<Record<string, any>>) => {
            const result = await rawTH.createWorldbookEntries(bookName, (Array.isArray(entries) ? entries : []).map((patch: any) => oldPatchToNewPatch_ACU(patch ?? {})));
            const worldbook = Array.isArray(result?.worldbook) ? result.worldbook : [];
            const newEntries = Array.isArray(result?.new_entries) ? result.new_entries : [];
            return { entries: worldbook.map((entry: any, index: number) => newToOldEntry_ACU(entry, index)), new_uids: newEntries.map((entry: any) => Number(entry?.uid)).filter(Number.isFinite) };
        }, 'mapped');
    }

    if (hasFn_ACU(rawTH, 'deleteLorebookEntries')) {
        mount('deleteLorebookEntries', rawTH.deleteLorebookEntries.bind(rawTH), 'passthrough');
    } else if (hasFn_ACU(rawTH, 'deleteWorldbookEntries')) {
        mount('deleteLorebookEntries', async (bookName: string, uids: number[]) => {
            const uidSet = new Set((Array.isArray(uids) ? uids : []).map(Number));
            const result = await rawTH.deleteWorldbookEntries(bookName, (entry: any) => uidSet.has(Number(entry?.uid)));
            const worldbook = Array.isArray(result?.worldbook) ? result.worldbook : [];
            const deleted = Array.isArray(result?.deleted_entries) ? result.deleted_entries : [];
            return { entries: worldbook.map((entry: any, index: number) => newToOldEntry_ACU(entry, index)), delete_occurred: deleted.length > 0 };
        }, 'mapped');
    }

    if (hasFn_ACU(rawTH, 'getLorebooks')) mount('getLorebooks', rawTH.getLorebooks.bind(rawTH), 'passthrough');
    else if (hasFn_ACU(rawTH, 'getWorldbookNames')) mount('getLorebooks', rawTH.getWorldbookNames.bind(rawTH), 'mapped');

    if (hasFn_ACU(rawTH, 'getCharWorldbookNames')) {
        mount('getCharWorldbookNames', rawTH.getCharWorldbookNames.bind(rawTH), 'passthrough');
    } else if (hasFn_ACU(rawTH, 'getCharLorebooks')) {
        mount('getCharWorldbookNames', async (characterName: string = 'current') => {
            const options = characterName !== 'current' ? { name: characterName, type: 'all' as const } : { type: 'all' as const };
            const binding = await rawTH.getCharLorebooks(options);
            return {
                primary: typeof binding?.primary === 'string' && binding.primary ? binding.primary : null,
                additional: Array.isArray(binding?.additional) ? binding.additional : [],
            };
        }, 'mapped');
    }

    return { backend, capabilities };
}

/**
 * 构建 TavernHelper 兼容适配器。
 * @param rawTH 宿主环境探测到的原始 TavernHelper 对象（可能为 undefined）
 * @param getStApi 返回 SillyTavern context 的闭包（原生后端使用）
 */
export function buildTavernHelperCompat_ACU(rawTH: any, getStApi: GetStApi_ACU): TavernHelperCompatResult_ACU {
    const native: NativeStBackend_ACU = createNativeStBackend_ACU(getStApi);
    const nativeUsable = native.isUsable();
    const capabilities: HostCapabilityMap_ACU = {};

    // 先透传原始对象的全部属性（未在下方显式适配的方法保持原样）
    const api: any = { ...(rawTH && typeof rawTH === 'object' ? rawTH : {}) };

    /** 按 passthrough → mapped → native 择优挂载一个方法 */
    function resolve(
        name: string,
        mappedImpl: (() => (...args: any[]) => any) | null,
        nativeImpl: ((...args: any[]) => any) | null,
    ): void {
        if (hasFn_ACU(rawTH, name)) {
            api[name] = rawTH[name].bind(rawTH);
            capabilities[name] = 'passthrough';
            return;
        }
        if (mappedImpl) {
            const impl = mappedImpl();
            if (impl) {
                api[name] = impl;
                capabilities[name] = 'mapped';
                return;
            }
        }
        if (nativeImpl && nativeUsable) {
            api[name] = nativeImpl;
            capabilities[name] = 'native';
            return;
        }
        capabilities[name] = 'missing';
        delete api[name];
    }

    // ═══ 世界书后端组：只在初始化时选择一次来源 ═══
    const rawWorldbook = rawTH && typeof rawTH === 'object' ? createRawTavernHelperWorldbookBackend_ACU(rawTH) : null;
    const worldbookBackend: WorldbookHostBackend_ACU | null = rawWorldbook?.backend ?? (nativeUsable ? native : null);
    const worldbookCapabilities = rawWorldbook?.capabilities ?? {};
    const mountWorldbook = (name: WorldbookBackendMethodName_ACU): void => {
        const implementation = worldbookBackend?.[name];
        if (typeof implementation !== 'function') {
            capabilities[name] = 'missing';
            delete api[name];
            return;
        }
        api[name] = implementation;
        capabilities[name] = rawWorldbook ? (worldbookCapabilities[name] ?? 'missing') : 'native';
    };
    for (const name of ['getLorebookEntries', 'setLorebookEntries', 'createLorebookEntries', 'deleteLorebookEntries', 'getLorebooks', 'getCharWorldbookNames'] as WorldbookBackendMethodName_ACU[]) {
        mountWorldbook(name);
    }
    if (typeof worldbookBackend?.getCharWorldbookNames === 'function') {
        api.getCurrentCharPrimaryLorebook = async (): Promise<string | null> => {
            const binding = await worldbookBackend.getCharWorldbookNames!('current');
            return typeof binding?.primary === 'string' && binding.primary ? binding.primary : null;
        };
        api.getCharLorebooks = async (options: { name?: string; type?: 'all' | 'primary' | 'additional' } = {}): Promise<{ primary: string | null; additional: string[] }> => {
            const binding = await worldbookBackend.getCharWorldbookNames!(options.name ?? 'current');
            const primary = typeof binding?.primary === 'string' && binding.primary ? binding.primary : null;
            const additional = Array.isArray(binding?.additional) ? binding.additional : [];
            if ((options.type ?? 'all') === 'primary') return { primary, additional: [] };
            if (options.type === 'additional') return { primary: null, additional };
            return { primary, additional };
        };
        capabilities.getCurrentCharPrimaryLorebook = rawWorldbook ? 'mapped' : 'native';
        capabilities.getCharLorebooks = rawWorldbook ? 'mapped' : 'native';
    } else {
        capabilities.getCurrentCharPrimaryLorebook = 'missing';
        capabilities.getCharLorebooks = 'missing';
        delete api.getCurrentCharPrimaryLorebook;
        delete api.getCharLorebooks;
    }

    // ═══ 聊天 / Slash / 角色数据（新旧酒馆助手同名，直接透传或原生兜底） ═══

    resolve('getChatMessages', null, (range?: string | number, options?: any) => native.getChatMessages(range, options));
    resolve('getLastMessageId', null, () => native.getLastMessageId());
    resolve('triggerSlash', null, (command: string) => native.triggerSlash(command));
    resolve('getCharData', null, (target?: string) => native.getCharData(target));

    // generateRaw：原生 context 无等价实现，仅透传，缺失时保持缺失语义
    resolve('generateRaw', null, null);

    lastCapabilities_ACU = capabilities;
    api.invalidateLorebookListSnapshot = () => native.invalidateSettingsSnapshot();
    logDebug_ACU(`[HostCompat] TavernHelper 兼容适配器已构建：${formatHostCapabilities_ACU(capabilities)}`);
    return { api, capabilities };
}
