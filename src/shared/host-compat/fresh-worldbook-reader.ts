/** 世界书权威读取：不经过 loadWorldInfo/酒馆助手的内容缓存，不保留跨操作快照。 */
import { getHostWindow } from '../runtime-env';
import { nativeToOldEntry_ACU } from './entry-format';
import type { GetStApi_ACU } from './native-st-backend';

export class WorldbookReadError_ACU extends Error {
    constructor(readonly category: 'lorebook_not_found' | 'api_unavailable' | 'scope_changed' | 'unknown', readonly operation: string) {
        super(`世界书读取失败（${operation} / ${category}）`);
        this.name = 'WorldbookReadError_ACU';
    }
}

type WorldInfoModule_ACU = { world_info: { charLore?: Array<{ name: string; extraBooks: string[] }> } };

export function createFreshWorldbookReader_ACU(getStApi: GetStApi_ACU, loadWorldInfoModule?: () => Promise<WorldInfoModule_ACU>) {
    const host = () => getHostWindow() as any;
    const context = () => host()?.SillyTavern?.getContext?.() ?? getStApi();
    let modulePromise: Promise<WorldInfoModule_ACU> | undefined;
    const loadModule = () => {
        if (loadWorldInfoModule) return loadWorldInfoModule();
        // 绝对宿主 URL 避免 iframe/扩展 bundle 的相对模块路径；仅缓存模块，不缓存绑定值。
        const url = new URL('/scripts/world-info.js', host().location.href).href;
        modulePromise ??= import(/* @vite-ignore */ url).catch(() => {
            modulePromise = undefined;
            throw new WorldbookReadError_ACU('api_unavailable', 'bindings');
        });
        return modulePromise;
    };
    async function post(path: string, body: object): Promise<any> {
        const api = context();
        if (typeof api?.getRequestHeaders !== 'function') throw new WorldbookReadError_ACU('api_unavailable', path);
        const win = host();
        const fetcher = typeof win?.fetch === 'function' ? win.fetch.bind(win) : globalThis.fetch;
        const url = win?.location?.origin && win.location.origin !== 'null' ? new URL(path, win.location.origin).href : path;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetcher(url, { method: 'POST', headers: api.getRequestHeaders(),
                body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) throw new WorldbookReadError_ACU('unknown', path);
            return await response.json();
        } finally { clearTimeout(timer); }
    }
    async function getLorebooks(): Promise<string[]> {
        const payload = await post('/api/settings/get', {});
        if (!Array.isArray(payload?.world_names) || payload.world_names.some((name: unknown) => typeof name !== 'string')) {
            throw new WorldbookReadError_ACU('unknown', 'catalog');
        }
        return [...new Set<string>(payload.world_names)];
    }

    async function getLorebookEntries(bookName: string) {
        if (!(await getLorebooks()).includes(bookName)) throw new WorldbookReadError_ACU('lorebook_not_found', 'entries');
        const data = await post('/api/worldinfo/get', { name: bookName });
        if (!data || typeof data.entries !== 'object' || data.entries === null || Array.isArray(data.entries)) {
            throw new WorldbookReadError_ACU('unknown', 'entries');
        }
        // /get 对已删除文件也返回空字典，复核目录以区分合法空书与删除竞态。
        if (!(await getLorebooks()).includes(bookName)) throw new WorldbookReadError_ACU('lorebook_not_found', 'entries');
        return Object.values(data.entries).map(nativeToOldEntry_ACU);
    }
    async function getCharWorldbookNames(characterName = 'current') {
        const api = context();
        if (!Array.isArray(api?.characters)) throw new WorldbookReadError_ACU('api_unavailable', 'bindings');
        const id = api.characterId ?? api.this_chid;
        const character = characterName === 'current'
            ? (id === undefined || id === null || id === '' ? null : api.characters[Number(id)])
            : api.characters.find((item: any) => item?.avatar === characterName || item?.name === characterName);
        if (!character) return { primary: null, additional: [] };
        const avatar = character.avatar;
        const module = await loadModule();
        const current = context();
        if (characterName === 'current' && (current.characterId ?? current.this_chid) !== id) {
            throw new WorldbookReadError_ACU('scope_changed', 'bindings');
        }
        if (!module?.world_info || typeof avatar !== 'string') throw new WorldbookReadError_ACU('api_unavailable', 'bindings');
        const latest = characterName === 'current' ? current.characters[Number(id)] : character;
        if (latest?.avatar !== avatar) throw new WorldbookReadError_ACU('scope_changed', 'bindings');
        const raw = module.world_info.charLore;
        if (raw !== undefined && !Array.isArray(raw)) throw new WorldbookReadError_ACU('unknown', 'bindings');
        const additional = raw?.find(item => item.name === avatar.replace(/\.[^.]+$/, ''))?.extraBooks ?? [];
        if (!Array.isArray(additional) || additional.some(name => typeof name !== 'string')) throw new WorldbookReadError_ACU('unknown', 'bindings');
        const primary = latest?.data?.extensions?.world;
        return { primary: typeof primary === 'string' && primary ? primary : null, additional: [...additional] };
    }
    return { getLorebooks, getLorebookEntries, getCharWorldbookNames };
}
