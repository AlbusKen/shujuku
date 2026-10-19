/** 世界书原生读取：沿用 SillyTavern 模块与编辑状态，本插件不保留跨操作正文快照。 */
import { getHostWindow } from '../runtime-env';
import { nativeToOldEntry_ACU } from './entry-format';
import type { GetStApi_ACU } from './native-st-backend';

type WorldbookReadFailureReason_ACU = 'http' | 'network' | 'timeout' | 'invalid_json' | 'invalid_payload' | 'host_origin' | 'request_headers';

export class WorldbookReadError_ACU extends Error {
    readonly reason?: WorldbookReadFailureReason_ACU;
    readonly httpStatus?: number;

    constructor(readonly category: 'lorebook_not_found' | 'api_unavailable' | 'scope_changed' | 'unknown', readonly operation: string,
        details: { reason?: WorldbookReadFailureReason_ACU; httpStatus?: number } = {}) {
        const status = Number.isInteger(details.httpStatus) && details.httpStatus! >= 100 && details.httpStatus! <= 599
            ? details.httpStatus : undefined;
        super(`世界书读取失败（${operation} / ${category}${details.reason ? ` / ${details.reason}` : ''}${status ? ` / HTTP ${status}` : ''}）`);
        this.name = 'WorldbookReadError_ACU';
        this.reason = details.reason;
        this.httpStatus = status;
    }
}

type WorldInfoModule_ACU = {
    world_info: { charLore?: Array<{ name: string; extraBooks: string[] }> };
    world_names?: string[];
    loadWorldInfo?: (name: string) => Promise<unknown>;
};

export function createFreshWorldbookReader_ACU(getStApi: GetStApi_ACU, loadWorldInfoModule?: () => Promise<WorldInfoModule_ACU>) {
    const host = () => getHostWindow() as any;
    const context = () => {
        try { return host()?.SillyTavern?.getContext?.() ?? getStApi(); }
        catch { return null; }
    };
    function getCapabilities() {
        try {
            const api = context();
            const moduleAvailable = !!api && canLoadModule();
            return {
                entries: moduleAvailable,
                bindings: Array.isArray(api?.characters) && moduleAvailable,
            };
        } catch { return { entries: false, bindings: false }; }
    }
    function canLoadModule(): boolean {
        try {
            return !!loadWorldInfoModule || (typeof host()?.document?.createElement === 'function' && !!getWorldInfoModuleUrl());
        } catch { return false; }
    }
    let modulePromise: Promise<WorldInfoModule_ACU> | undefined;
    let loadedModule: WorldInfoModule_ACU | undefined;
    const loadModule = () => {
        if (loadWorldInfoModule) return loadWorldInfoModule().then(module => (loadedModule = module));
        // 绝对宿主 URL 避免 iframe/扩展 bundle 的相对模块路径；仅缓存模块，不缓存绑定值。
        const url = getWorldInfoModuleUrl();
        if (!url || !canLoadModule()) return Promise.reject(new WorldbookReadError_ACU('api_unavailable', 'module'));
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
    function getWorldInfoModuleUrl(): string | null {
        try {
            const url = new URL(host()?.location?.href);
            // Tauri 应用地址的 URL.origin 为 "null"，但仍能解析同一宿主的原生模块。
            const supported = url.protocol === 'http:' || url.protocol === 'https:'
                || (url.protocol === 'tauri:' && url.hostname === 'localhost');
            return supported ? new URL('/scripts/world-info.js', url).href : null;
        } catch { return null; }
    }
    async function getLorebooks(): Promise<string[]> {
        const module = await loadModule();
        const names = module.world_names;
        if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !name.trim())) {
            throw new WorldbookReadError_ACU('unknown', 'catalog', { reason: 'invalid_payload' });
        }
        // 与原生选择页读取同一个 live binding；每次返回副本，不保存目录快照。
        return [...new Set<string>(names)];
    }

    /** 操作级租约只保留身份，不保留正文；缓存命中交付时仍复核绑定和目录。 */
    async function createReadGuard() {
        const before = captureScope(false);
        await loadModule();
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
        const api = context();
        const module = loadedModule!;
        const loader = typeof module.loadWorldInfo === 'function' ? module.loadWorldInfo.bind(module)
            : typeof api?.loadWorldInfo === 'function' ? api.loadWorldInfo.bind(api) : null;
        if (!loader) throw new WorldbookReadError_ACU('api_unavailable', 'loadWorldInfo');
        // 原生保存先更新缓存、再延迟落盘；读取必须保留宿主尚未落盘的编辑。
        // 不清缓存、不自行写回，也不另建条目 HTTP 通道。
        const data: any = await loader(bookName);
        await assertCurrent([bookName]);
        if (!data || typeof data.entries !== 'object' || data.entries === null || Array.isArray(data.entries)) {
            throw new WorldbookReadError_ACU('unknown', 'entries', { reason: 'invalid_payload' });
        }
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
