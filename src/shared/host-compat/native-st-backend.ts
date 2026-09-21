/**
 * shared/host-compat/native-st-backend.ts — SillyTavern 原生后端
 *
 * 在无酒馆助手（TavernHelper）的插件独立运行模式下，用 SillyTavern.getContext()
 * 暴露的原生接口实现代码库依赖的旧版扁平 API 面。
 *
 * 能力来源（以 SillyTavern 1.13.x st-context.js 为准）：
 * - 世界书读写：ctx.loadWorldInfo / ctx.saveWorldInfo
 * - 聊天与角色：ctx.chat / ctx.characters / ctx.characterId
 * - Slash 命令：ctx.executeSlashCommandsWithOptions
 * - 世界书名称列表与角色附加书（charLore）不在 context 中，
 *   经 POST /api/settings/get 获取（带 TTL 缓存）。
 *
 * generateRaw 在原生 context 中不存在，本后端不提供（保持"方法缺失"语义，
 * 让调用方既有的可用性检查与降级路径自然生效）。
 */

import { logDebug_ACU, logWarn_ACU } from '../utils';
import { isLorebookReadNotFoundError_ACU } from '../lorebook-read-error';
import {
    buildNativeEntryDefaults_ACU,
    nativeToOldEntry_ACU,
    oldPatchToNativePatch_ACU,
    type OldFlatLorebookEntry_ACU,
} from './entry-format';

/** 返回 SillyTavern context 对象（插件模式下为 getContext() 的 Proxy 快照） */
export type GetStApi_ACU = () => any;

const SETTINGS_SNAPSHOT_TTL_MS_ACU = 8000;

interface StSettingsSnapshot_ACU {
    worldNames: string[];
    /** charLore: [{ name: 角色头像文件基名, extraBooks: string[] }] */
    charLore: Array<{ name: string; extraBooks: string[] }>;
}

export interface NativeStBackend_ACU {
    getLorebooks: (options?: { forceRefresh?: boolean }) => Promise<string[]>;
    getLorebookEntries: (bookName: string) => Promise<OldFlatLorebookEntry_ACU[]>;
    setLorebookEntries: (bookName: string, entries: Array<Record<string, any>>) => Promise<void>;
    createLorebookEntries: (bookName: string, entries: Array<Record<string, any>>) => Promise<{ entries: OldFlatLorebookEntry_ACU[]; new_uids: number[] }>;
    deleteLorebookEntries: (bookName: string, uids: number[]) => Promise<{ entries: OldFlatLorebookEntry_ACU[]; delete_occurred: boolean }>;
    getCharWorldbookNames: (characterName?: string) => Promise<{ primary: string | null; additional: string[] }>;
    getCharLorebooks: (options?: { name?: string; type?: 'all' | 'primary' | 'additional' }) => Promise<{ primary: string | null; additional: string[] }>;
    getCurrentCharPrimaryLorebook: () => Promise<string | null>;
    getChatMessages: (range?: string | number, options?: { role?: string; hide_state?: string; include_swipes?: boolean }) => Promise<any[]>;
    getLastMessageId: () => number;
    triggerSlash: (command: string) => Promise<string>;
    getCharData: (target?: string) => any | null;
    /** 判定原生后端的最低可用条件（loadWorldInfo/saveWorldInfo/chat 可达） */
    isUsable: () => boolean;
    /** 供测试与写后失效使用 */
    invalidateSettingsSnapshot: () => void;
}

export function createNativeStBackend_ACU(getStApi: GetStApi_ACU): NativeStBackend_ACU {
    let settingsSnapshot: StSettingsSnapshot_ACU | null = null;
    let settingsSnapshotAt = 0;

    function ctx(): any {
        try {
            return getStApi() ?? null;
        } catch {
            return null;
        }
    }

    function invalidateSettingsSnapshot(): void {
        settingsSnapshot = null;
        settingsSnapshotAt = 0;
    }

    async function fetchSettingsSnapshot(forceRefresh = false): Promise<StSettingsSnapshot_ACU | null> {
        if (forceRefresh) invalidateSettingsSnapshot();
        const now = Date.now();
        if (settingsSnapshot && now - settingsSnapshotAt < SETTINGS_SNAPSHOT_TTL_MS_ACU) {
            return settingsSnapshot;
        }
        const api = ctx();
        try {
            const headers: Record<string, string> = typeof api?.getRequestHeaders === 'function'
                ? api.getRequestHeaders()
                : { 'Content-Type': 'application/json' };
            const res = await fetch('/api/settings/get', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) {
                logWarn_ACU(`[NativeStBackend] /api/settings/get 返回 ${res.status}，世界书列表暂不可用`);
                return null;
            }
            const payload = await res.json();
            const worldNames = Array.isArray(payload?.world_names)
                ? payload.world_names.map((n: unknown) => String(n))
                : [];
            let charLore: Array<{ name: string; extraBooks: string[] }> = [];
            try {
                const parsed = typeof payload?.settings === 'string' ? JSON.parse(payload.settings) : payload?.settings;
                const rawCharLore = parsed?.world_info?.charLore;
                if (Array.isArray(rawCharLore)) {
                    charLore = rawCharLore
                        .filter((item: any) => item && typeof item.name === 'string')
                        .map((item: any) => ({
                            name: item.name,
                            extraBooks: Array.isArray(item.extraBooks) ? item.extraBooks.map((b: unknown) => String(b)) : [],
                        }));
                }
            } catch (e) {
                logWarn_ACU('[NativeStBackend] 解析 settings.world_info.charLore 失败，附加世界书降级为空', e);
            }
            settingsSnapshot = { worldNames, charLore };
            settingsSnapshotAt = now;
            return settingsSnapshot;
        } catch (e) {
            logWarn_ACU('[NativeStBackend] 获取 /api/settings/get 失败', e);
            return null;
        }
    }

    // ═══ 世界书条目 CRUD ═══

    async function loadBookOrThrow(bookName: string): Promise<any> {
        const api = ctx();
        if (!api || typeof api.loadWorldInfo !== 'function') {
            throw new Error('SillyTavern loadWorldInfo 接口不可用');
        }
        try {
            const data = await api.loadWorldInfo(bookName);
            // 不存在时的文案必须匹配 classifyLorebookReadError_ACU 的中文 not-found 正则
            if (!data || typeof data !== 'object' || !data.entries) {
                invalidateSettingsSnapshot();
                throw new Error(`世界书 "${bookName}" 不存在`);
            }
            return data;
        } catch (error) {
            if (isLorebookReadNotFoundError_ACU(error)) {
                invalidateSettingsSnapshot();
            }
            throw error;
        }
    }

    async function saveBook(bookName: string, data: any): Promise<void> {
        const api = ctx();
        if (!api || typeof api.saveWorldInfo !== 'function') {
            throw new Error('SillyTavern saveWorldInfo 接口不可用');
        }
        await api.saveWorldInfo(bookName, data, true);
    }

    function entriesDictToOldArray(data: any): OldFlatLorebookEntry_ACU[] {
        const dict = data?.entries ?? {};
        return Object.keys(dict).map(uid => nativeToOldEntry_ACU(dict[uid]));
    }

    async function getLorebookEntries(bookName: string): Promise<OldFlatLorebookEntry_ACU[]> {
        const data = await loadBookOrThrow(bookName);
        return entriesDictToOldArray(data);
    }

    async function setLorebookEntries(bookName: string, entries: Array<Record<string, any>>): Promise<void> {
        if (!Array.isArray(entries) || entries.length === 0) return;
        const data = await loadBookOrThrow(bookName);
        let changed = false;
        for (const patch of entries) {
            const uid = patch?.uid;
            if (uid === null || uid === undefined || !data.entries[uid]) {
                logWarn_ACU(`[NativeStBackend] setLorebookEntries: 世界书 "${bookName}" 中不存在 uid=${String(uid)} 的条目，已跳过`);
                continue;
            }
            Object.assign(data.entries[uid], oldPatchToNativePatch_ACU(patch));
            changed = true;
        }
        if (changed) await saveBook(bookName, data);
    }

    async function createLorebookEntries(
        bookName: string,
        entries: Array<Record<string, any>>,
    ): Promise<{ entries: OldFlatLorebookEntry_ACU[]; new_uids: number[] }> {
        const data = await loadBookOrThrow(bookName);
        const existingUids = Object.keys(data.entries).map(Number).filter(Number.isFinite);
        let nextUid = existingUids.length > 0 ? Math.max(...existingUids) + 1 : 0;
        const newUids: number[] = [];
        for (const patch of Array.isArray(entries) ? entries : []) {
            const uid = nextUid++;
            data.entries[uid] = {
                uid,
                ...buildNativeEntryDefaults_ACU(),
                ...oldPatchToNativePatch_ACU(patch ?? {}),
                displayIndex: uid,
            };
            newUids.push(uid);
        }
        if (newUids.length > 0) await saveBook(bookName, data);
        return { entries: entriesDictToOldArray(data), new_uids: newUids };
    }

    async function deleteLorebookEntries(
        bookName: string,
        uids: number[],
    ): Promise<{ entries: OldFlatLorebookEntry_ACU[]; delete_occurred: boolean }> {
        const data = await loadBookOrThrow(bookName);
        let deleteOccurred = false;
        for (const uid of Array.isArray(uids) ? uids : []) {
            if (data.entries[uid]) {
                delete data.entries[uid];
                deleteOccurred = true;
            }
        }
        if (deleteOccurred) await saveBook(bookName, data);
        return { entries: entriesDictToOldArray(data), delete_occurred: deleteOccurred };
    }

    // ═══ 世界书列表与角色绑定 ═══

    async function getLorebooks(options?: { forceRefresh?: boolean }): Promise<string[]> {
        const snapshot = await fetchSettingsSnapshot(!!options?.forceRefresh);
        return snapshot?.worldNames ?? [];
    }

    function resolveCharacter(characterName?: string): any | null {
        const api = ctx();
        const characters = api?.characters;
        if (!Array.isArray(characters)) return null;
        if (!characterName || characterName === 'current') {
            const chid = api?.characterId ?? api?.this_chid;
            if (chid === undefined || chid === null || chid === '') return null;
            return characters[Number(chid)] ?? null;
        }
        return characters.find((c: any) => c?.name === characterName || c?.avatar === characterName) ?? null;
    }

    async function getCharWorldbookNames(characterName?: string): Promise<{ primary: string | null; additional: string[] }> {
        const character = resolveCharacter(characterName);
        if (!character) return { primary: null, additional: [] };
        const primary = typeof character?.data?.extensions?.world === 'string' && character.data.extensions.world
            ? character.data.extensions.world
            : null;
        let additional: string[] = [];
        const avatar = typeof character?.avatar === 'string' ? character.avatar : '';
        if (avatar) {
            const avatarBase = avatar.replace(/\.[^.]+$/, '');
            const snapshot = await fetchSettingsSnapshot();
            const loreEntry = snapshot?.charLore?.find(item => item.name === avatarBase);
            additional = loreEntry?.extraBooks ?? [];
        }
        return { primary, additional };
    }

    async function getCharLorebooks(
        options: { name?: string; type?: 'all' | 'primary' | 'additional' } = {},
    ): Promise<{ primary: string | null; additional: string[] }> {
        const binding = await getCharWorldbookNames(options.name ?? 'current');
        const type = options.type ?? 'all';
        if (type === 'primary') return { primary: binding.primary, additional: [] };
        if (type === 'additional') return { primary: null, additional: binding.additional };
        return binding;
    }

    async function getCurrentCharPrimaryLorebook(): Promise<string | null> {
        return (await getCharWorldbookNames('current')).primary;
    }

    // ═══ 聊天消息 ═══

    function getChatArray(): any[] {
        const api = ctx();
        return Array.isArray(api?.chat) ? api.chat : [];
    }

    function getLastMessageId(): number {
        return getChatArray().length - 1;
    }

    function mapChatMessage(msg: any, index: number, includeSwipes: boolean): any {
        const isUser = msg?.is_user === true;
        const isSystem = msg?.is_system === true;
        const swipeId = typeof msg?.swipe_id === 'number' ? msg.swipe_id : 0;
        const base: Record<string, any> = {
            message_id: index,
            name: typeof msg?.name === 'string' ? msg.name : '',
            role: isUser ? 'user' : isSystem ? 'system' : 'assistant',
            is_user: isUser,
            is_system: isSystem,
            is_hidden: isSystem,
            message: typeof msg?.mes === 'string' ? msg.mes : '',
            data: (Array.isArray(msg?.variables) ? msg.variables[swipeId] : msg?.variables) ?? {},
            extra: msg?.extra ?? {},
        };
        if (includeSwipes) {
            base.swipe_id = swipeId;
            base.swipes = Array.isArray(msg?.swipes) ? msg.swipes : [base.message];
            base.swipes_data = Array.isArray(msg?.variables) ? msg.variables : [];
            base.swipes_info = Array.isArray(msg?.swipe_info) ? msg.swipe_info : [];
        }
        return base;
    }

    function parseRange(range: string | number | undefined, lastId: number): [number, number] | null {
        if (range === undefined || range === null || range === '') return [0, lastId];
        const normalize = (value: number): number => (value < 0 ? lastId + 1 + value : value);
        if (typeof range === 'number') {
            const idx = normalize(range);
            return [idx, idx];
        }
        const text = String(range).replace(/\{\{lastMessageId\}\}/gi, String(lastId)).trim();
        // 允许负数端点：匹配 "a-b"（a、b 可带负号）
        const rangeMatch = text.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
        if (rangeMatch) {
            return [normalize(Number(rangeMatch[1])), normalize(Number(rangeMatch[2]))];
        }
        const single = Number(text);
        if (Number.isFinite(single)) {
            const idx = normalize(single);
            return [idx, idx];
        }
        return null;
    }

    async function getChatMessages(
        range?: string | number,
        options: { role?: string; hide_state?: string; include_swipes?: boolean } = {},
    ): Promise<any[]> {
        const chatArray = getChatArray();
        const lastId = chatArray.length - 1;
        if (lastId < 0) return [];
        const parsed = parseRange(range, lastId);
        if (!parsed) {
            logWarn_ACU(`[NativeStBackend] getChatMessages: 无法解析 range "${String(range)}"，返回空数组`);
            return [];
        }
        const [start, end] = parsed;
        const from = Math.max(0, Math.min(start, end));
        const to = Math.min(lastId, Math.max(start, end));
        const includeSwipes = options.include_swipes === true;
        const result: any[] = [];
        for (let i = from; i <= to; i++) {
            const mapped = mapChatMessage(chatArray[i], i, includeSwipes);
            if (options.role && options.role !== 'all' && mapped.role !== options.role) continue;
            if (options.hide_state === 'hidden' && !mapped.is_hidden) continue;
            if (options.hide_state === 'unhidden' && mapped.is_hidden) continue;
            result.push(mapped);
        }
        return result;
    }

    // ═══ 其他 ═══

    async function triggerSlash(command: string): Promise<string> {
        const api = ctx();
        if (!api || typeof api.executeSlashCommandsWithOptions !== 'function') {
            throw new Error('SillyTavern executeSlashCommandsWithOptions 接口不可用');
        }
        const result = await api.executeSlashCommandsWithOptions(command);
        return typeof result?.pipe === 'string' ? result.pipe : '';
    }

    function getCharData(target: string = 'current'): any | null {
        return resolveCharacter(target);
    }

    function isUsable(): boolean {
        const api = ctx();
        return !!(api
            && typeof api.loadWorldInfo === 'function'
            && typeof api.saveWorldInfo === 'function'
            && typeof api.executeSlashCommandsWithOptions === 'function');
    }

    logDebug_ACU('[NativeStBackend] 原生 SillyTavern 后端已创建');

    return {
        getLorebooks,
        getLorebookEntries,
        setLorebookEntries,
        createLorebookEntries,
        deleteLorebookEntries,
        getCharWorldbookNames,
        getCharLorebooks,
        getCurrentCharPrimaryLorebook,
        getChatMessages,
        getLastMessageId,
        triggerSlash,
        getCharData,
        isUsable,
        invalidateSettingsSnapshot,
    };
}
