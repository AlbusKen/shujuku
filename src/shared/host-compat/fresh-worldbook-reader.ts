/** 世界书权威读取：不经过 loadWorldInfo/酒馆助手的内容缓存，不保留跨操作快照。 */
import { getHostWindow } from '../runtime-env';
import { nativeToOldEntry_ACU } from './entry-format';
import { classifyLorebookReadError_ACU } from '../lorebook-read-error';
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
    const context = () => {
        try { return host()?.SillyTavern?.getContext?.() ?? getStApi(); }
        catch { return null; }
    };
    function getCapabilities() {
        try {
            const win = host();
            const api = context();
            return {
                entries: typeof api?.getRequestHeaders === 'function' && typeof win?.fetch === 'function',
                bindings: Array.isArray(api?.characters) && (!!loadWorldInfoModule
                    || (typeof win?.document?.createElement === 'function' && !!win?.location?.href)),
            };
        } catch { return { entries: false, bindings: false }; }
    }
    let modulePromise: Promise<WorldInfoModule_ACU> | undefined;
    let loadedModule: WorldInfoModule_ACU | undefined;
    const loadModule = () => {
        if (loadWorldInfoModule) return loadWorldInfoModule().then(module => (loadedModule = module));
        if (!getCapabilities().bindings) return Promise.reject(new WorldbookReadError_ACU('api_unavailable', 'bindings'));
        // 绝对宿主 URL 避免 iframe/扩展 bundle 的相对模块路径；仅缓存模块，不缓存绑定值。
        const url = new URL('/scripts/world-info.js', host().location.href).href;
        // 在主窗口执行 import，避免 iframe 创建另一份 world-info 模块状态。
        modulePromise ??= new Promise<WorldInfoModule_ACU>((resolve, reject) => {
            const win = host();
            const key = `__ACU_WI_MODULE_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const script = win.document.createElement('script');
            const cleanup = () => { clearTimeout(timer); delete win[key]; script.remove(); };
            const fail = () => { cleanup(); reject(new WorldbookReadError_ACU('api_unavailable', 'bindings')); };
            const timer = setTimeout(fail, 15000);
            win[key] = { resolve: (module: WorldInfoModule_ACU) => { cleanup(); loadedModule = module; resolve(module); }, reject: fail };
            script.type = 'module';
            script.onerror = fail;
            script.textContent = `import(${JSON.stringify(url)}).then(m => window[${JSON.stringify(key)}]?.resolve(m), () => window[${JSON.stringify(key)}]?.reject());`;
            try { (win.document.head || win.document.documentElement).appendChild(script); }
            catch { fail(); }
        }).catch(() => {
            modulePromise = undefined;
            throw new WorldbookReadError_ACU('api_unavailable', 'bindings');
        });
        return modulePromise;
    };
    async function post(path: string, body: object): Promise<any> {
        const api = context();
        if (typeof api?.getRequestHeaders !== 'function') throw new WorldbookReadError_ACU('api_unavailable', path);
        const win = host();
        if (typeof win?.fetch !== 'function') throw new WorldbookReadError_ACU('api_unavailable', path);
        const fetcher = win.fetch.bind(win);
        const url = win?.location?.origin && win.location.origin !== 'null' ? new URL(path, win.location.origin).href : path;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetcher(url, { method: 'POST', headers: { ...api.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) throw new WorldbookReadError_ACU('unknown', path);
            return await response.json();
        } catch (error) {
            if (error instanceof WorldbookReadError_ACU) throw error;
            if (!controller.signal.aborted && classifyLorebookReadError_ACU(error) === 'aborted') throw error;
            // 本地超时是读取失败，不是用户取消；不携带宿主响应正文。
            throw new WorldbookReadError_ACU('unknown', path);
        } finally { clearTimeout(timer); }
    }
    async function getLorebooks(): Promise<string[]> {
        const payload = await post('/api/settings/get', {});
        if (!Array.isArray(payload?.world_names) || payload.world_names.some((name: unknown) => typeof name !== 'string')) {
            throw new WorldbookReadError_ACU('unknown', 'catalog');
        }
        return [...new Set<string>(payload.world_names)];
    }

    /** 操作级租约只保留身份，不保留正文；缓存命中交付时仍复核绑定和目录。 */
    async function createReadGuard() {
        const before = captureScope(false);
        const api = context();
        const id = api?.characterId ?? api?.this_chid;
        if (id !== undefined && id !== null && id !== '' && api?.characters?.[Number(id)]) await loadModule();
        if (captureScope(false) !== before) throw new WorldbookReadError_ACU('scope_changed', 'scope');
        const scope = captureScope();
        return async (bookNames: string[] = []) => {
            const assertScope = () => {
                if (captureScope() !== scope) throw new WorldbookReadError_ACU('scope_changed', 'scope');
            };
            assertScope();
            if (bookNames.length > 0) {
                const catalog = await getLorebooks();
                assertScope();
                if (bookNames.some(name => !catalog.includes(name))) throw new WorldbookReadError_ACU('lorebook_not_found', 'scope');
            }
        };
    }
    async function getLorebookEntries(bookName: string) {
        const assertCurrent = await createReadGuard();
        await assertCurrent([bookName]);
        const data = await post('/api/worldinfo/get', { name: bookName });
        if (!data || typeof data.entries !== 'object' || data.entries === null || Array.isArray(data.entries)) {
            throw new WorldbookReadError_ACU('unknown', 'entries');
        }
        // /get 对已删除文件也返回空字典，复核目录以区分合法空书与删除竞态。
        await assertCurrent([bookName]);
        return Object.values(data.entries).map(nativeToOldEntry_ACU);
    }
    function captureScope(includeBindings = true): string {
        const api = context();
        const id = api?.characterId ?? api?.this_chid;
        const character = api?.characters?.[Number(id)];
        return JSON.stringify([id, api?.groupId, api?.chatId, api?.getCurrentChatId?.(),
            character?.avatar, character?.data?.extensions?.world,
            includeBindings ? loadedModule?.world_info?.charLore : undefined]);
    }

    async function getCharWorldbookNames(characterName = 'current') {
        // 首次加载模块本身不属于绑定变化；先取得同一宿主模块再建立比较基线。
        const initialScope = captureScope();
        const hadModule = !!loadedModule;
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
        if (characterName === 'current' && captureScope(hadModule) !== initialScope) {
            throw new WorldbookReadError_ACU('scope_changed', 'bindings');
        }
        if (characterName === 'current' && (current.characterId ?? current.this_chid) !== id) {
            throw new WorldbookReadError_ACU('scope_changed', 'bindings');
        }
        if (!module?.world_info || typeof avatar !== 'string') throw new WorldbookReadError_ACU('api_unavailable', 'bindings');
        const latest = characterName === 'current' ? current?.characters?.[Number(id)] : character;
        if (latest?.avatar !== avatar) throw new WorldbookReadError_ACU('scope_changed', 'bindings');
        const raw = module.world_info.charLore;
        if (raw !== undefined && !Array.isArray(raw)) throw new WorldbookReadError_ACU('unknown', 'bindings');
        const additional = raw?.find(item => item?.name === avatar.replace(/\.[^/.]+$/, ''))?.extraBooks ?? [];
        if (!Array.isArray(additional) || additional.some(name => typeof name !== 'string')) throw new WorldbookReadError_ACU('unknown', 'bindings');
        const primary = latest?.data?.extensions?.world;
        return { primary: typeof primary === 'string' && primary ? primary : null, additional: [...additional] };
    }
    return { getCapabilities, getLorebooks, getLorebookEntries, getCharWorldbookNames, createReadGuard };
}
