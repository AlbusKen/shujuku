/**
 * data/gateways/worldbook-gateway.ts — 世界书 CRUD 操作网关
 *
 * 封装 TavernHelper_API_ACU / SillyTavern_API_ACU 的世界书相关方法。
 * service 层通过本模块访问世界书，不再直接调用宿主 API。
 *
 * 所有方法内置存在性检查，宿主 API 不可用时返回安全默认值。
 */

import { TavernHelper_API_ACU } from '../../shared/host-api';
import { getCharLorebooks_ACU, getCurrentCharacterWorldbookBinding_ACU } from './character-gateway';
import { logWarn_ACU } from '../../shared/utils';
import { classifyLorebookReadError_ACU } from '../../shared/lorebook-read-error';

// ═══ 可用性检查 ═══

/**
 * 检查 TavernHelper 世界书 API 是否可用
 */
export function isWorldbookApiAvailable_ACU(): boolean {
    return !!(TavernHelper_API_ACU && typeof TavernHelper_API_ACU.getLorebookEntries === 'function');
}

/**
 * 检查 TavernHelper 世界书条目读取与更新 API 是否同时可用。
 */
export function isWorldbookEntryUpdateApiAvailable_ACU(): boolean {
    return !!(TavernHelper_API_ACU && typeof TavernHelper_API_ACU.getLorebookEntries === 'function' && typeof TavernHelper_API_ACU.setLorebookEntries === 'function');
}

// ═══ 条目 CRUD ═══

// 不可见格式字符：零宽/方向控制/连接符/BOM + 变体选择器（U+FE00–U+FE0F）
// 与补充变体选择器（U+E0100–U+E01EF，UTF-16 下为 \uDB40\uDD00–\uDB40\uDDEF）。
const LOREBOOK_NAME_IGNORABLE_CHARS_ACU =
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uFE00-\uFE0F]|\uDB40[\uDD00-\uDDEF]/g;

/**
 * 仅用于世界书名称比对，不可替代宿主保存的原始名称。
 * 兼容复制粘贴常见的全角字符、组合字符、不可见控制字符与异常空白。
 */
export function normalizeLorebookNameForMatch_ACU(value: unknown): string {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(LOREBOOK_NAME_IGNORABLE_CHARS_ACU, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getLorebookListItemRawName_ACU(item: unknown): string {
    if (item && typeof item === 'object') return String((item as any).name ?? '');
    return String(item ?? '');
}

/**
 * 将配置/绑定中的名称解析为宿主列表里的真实名称。
 *
 * 必须返回宿主列表中的原始名称（不 trim、不归一化）：宿主按原始名索引世界书，
 * 名称带首尾空格或不可见字符时，返回 trim 结果会导致后续宿主调用 not-found。
 * trim/归一化只用于构造匹配键。多个名称在同一匹配通道冲突时拒绝猜测，
 * 避免读写到错误世界书。
 */
export function resolveLorebookNameFromList_ACU(requestedName: unknown, bookList: unknown): string | null {
    const requestedRaw = String(requestedName ?? '');
    const requested = requestedRaw.trim();
    if (!requested || !Array.isArray(bookList)) return null;
    const availableNames = bookList.map(getLorebookListItemRawName_ACU).filter(name => name.trim());
    // 字节级精确命中：请求本身就是宿主列表里的原始名
    if (availableNames.includes(requestedRaw)) return requestedRaw;
    // trim 精确命中：返回宿主原始名；trim 后同名的多本书属于歧义，拒绝猜测
    const trimmedMatches = availableNames.filter(name => name.trim() === requested);
    if (trimmedMatches.length === 1) return trimmedMatches[0];
    if (trimmedMatches.length > 1) return null;

    const matchKey = normalizeLorebookNameForMatch_ACU(requested);
    if (!matchKey) return null;
    const normalizedMatches = availableNames.filter(name => normalizeLorebookNameForMatch_ACU(name) === matchKey);
    return normalizedMatches.length === 1 ? normalizedMatches[0] : null;
}

function normalizeLorebookEntryTextField_ACU(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * 归一化宿主读取到的世界书条目文本字段。
 *
 * 宿主数据属于不受信输入：非字符串 comment/name 必须按既有 agent 元数据逻辑
 * 收敛为空串，而不是 String(value)。后者会让读取侧的异常值进入后续写回路径。
 * 仅在实际需要修正时浅拷贝，避免修改宿主可能复用的原始对象。
 */
export function normalizeLorebookEntriesForRead_ACU(entries: unknown, bookName = ''): any[] {
    if (!Array.isArray(entries)) return [];
    const normalizedFields: Array<{ uid: unknown; field: 'comment' | 'name'; sourceType: string }> = [];
    const normalizedEntries = entries.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const source = entry as Record<string, any>;
        const patch: Record<string, string> = {};
        for (const field of ['comment', 'name'] as const) {
            if (!(field in source) || typeof source[field] === 'string') continue;
            patch[field] = normalizeLorebookEntryTextField_ACU(source[field]);
            normalizedFields.push({ uid: source.uid, field, sourceType: typeof source[field] });
        }
        return Object.keys(patch).length > 0 ? { ...source, ...patch } : entry;
    });

    if (normalizedFields.length > 0) {
        logWarn_ACU('[WorldbookGateway] 已归一化宿主返回的非字符串世界书条目文本字段。', {
            phase: 'normalize_entry_text_field',
            bookName,
            normalizedFields,
        });
    }
    return normalizedEntries;
}

/**
 * 获取指定世界书的所有条目
 * @param bookName 世界书名称
 * @returns 条目数组，API 不可用时返回 []
 */
export async function getLorebookEntries_ACU(bookName: string): Promise<any[]> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] getLorebookEntries 不可用，返回空数组');
        return [];
    }
    return normalizeLorebookEntriesForRead_ACU(await TavernHelper_API_ACU.getLorebookEntries(bookName), bookName);
}

export function isLorebookNotFoundError_ACU(error: unknown): boolean {
    return classifyLorebookReadError_ACU(error) === 'lorebook_not_found';
}

/**
 * 关键路径（strict/preflight）专用：宿主 API 缺失时必须失败关闭，不允许静默成功。
 * 仅 strict pipeline 与清绿灯预检使用；不改变现有宽松 CRUD 语义。
 */
export class WorldbookHostApiUnavailableError_ACU extends Error {
    readonly operation: 'get_entries' | 'set_entries' | 'delete_entries';
    constructor(operation: 'get_entries' | 'set_entries' | 'delete_entries') {
        super(`WorldbookHostApiUnavailable:${operation}`);
        this.name = 'WorldbookHostApiUnavailableError_ACU';
        this.operation = operation;
    }
}

function requireTavernHelperApi_ACU(operation: 'get_entries' | 'set_entries' | 'delete_entries', method: 'getLorebookEntries' | 'setLorebookEntries' | 'deleteLorebookEntries'): void {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU[method] !== 'function') {
        throw new WorldbookHostApiUnavailableError_ACU(operation);
    }
}

/**
 * required read：宿主 API 缺失抛命名错误，宿主读取错误原样传播。
 */
export async function getLorebookEntriesRequired_ACU(bookName: string): Promise<any[]> {
    requireTavernHelperApi_ACU('get_entries', 'getLorebookEntries');
    return normalizeLorebookEntriesForRead_ACU(await TavernHelper_API_ACU.getLorebookEntries(bookName), bookName);
}

/**
 * required set/delete：宿主 API 缺失抛命名错误，不允许静默成功。
 */
export async function setLorebookEntriesRequired_ACU(bookName: string, entries: any[]): Promise<void> {
    requireTavernHelperApi_ACU('set_entries', 'setLorebookEntries');
    await TavernHelper_API_ACU.setLorebookEntries(bookName, entries);
}

export async function deleteLorebookEntriesRequired_ACU(bookName: string, uids: any[]): Promise<void> {
    requireTavernHelperApi_ACU('delete_entries', 'deleteLorebookEntries');
    await TavernHelper_API_ACU.deleteLorebookEntries(bookName, uids);
}

/**
 * 更新指定世界书中的条目
 * @param bookName 世界书名称
 * @param entries 要更新的条目数组（需包含 uid）
 */
export async function setLorebookEntries_ACU(bookName: string, entries: any[]): Promise<void> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.setLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] setLorebookEntries 不可用，跳过');
        return;
    }
    await TavernHelper_API_ACU.setLorebookEntries(bookName, entries);
}

/**
 * 在指定世界书中创建新条目
 * @param bookName 世界书名称
 * @param entries 要创建的条目数组
 */
export async function createLorebookEntries_ACU(bookName: string, entries: any[]): Promise<void> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.createLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] createLorebookEntries 不可用，跳过');
        return;
    }
    await TavernHelper_API_ACU.createLorebookEntries(bookName, entries);
}

/**
 * 删除指定世界书中的条目
 * @param bookName 世界书名称
 * @param uids 要删除的条目 UID 数组
 */
export async function deleteLorebookEntries_ACU(bookName: string, uids: any[]): Promise<void> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.deleteLorebookEntries !== 'function') {
        logWarn_ACU('[WorldbookGateway] deleteLorebookEntries 不可用，跳过');
        return;
    }
    await TavernHelper_API_ACU.deleteLorebookEntries(bookName, uids);
}

// ═══ 世界书列表 ═══

export function invalidateLorebookListSnapshot_ACU(): void {
    const api = TavernHelper_API_ACU as { invalidateLorebookListSnapshot?: () => void; invalidateSettingsSnapshot?: () => void } | undefined;
    if (typeof api?.invalidateLorebookListSnapshot === 'function') {
        api.invalidateLorebookListSnapshot();
        return;
    }
    if (typeof api?.invalidateSettingsSnapshot === 'function') {
        api.invalidateSettingsSnapshot();
    }
}

/**
 * 获取所有可用的世界书列表
 * 兼容层在初始化时已锁定世界书后端来源。
 * @returns 世界书名称数组，不可用时返回 []
 */
export async function listLorebooks_ACU(options?: { forceRefresh?: boolean }): Promise<string[]> {
    if (options?.forceRefresh) invalidateLorebookListSnapshot_ACU();
    const getLorebooks = (TavernHelper_API_ACU as unknown as { getLorebooks?: (opts?: { forceRefresh?: boolean }) => Promise<string[]> | string[] } | undefined)?.getLorebooks;
    if (typeof getLorebooks === 'function') {
        return await getLorebooks(options);
    }
    logWarn_ACU('[WorldbookGateway] listLorebooks 不可用，返回空数组');
    return [];
}

/**
 * 获取所有可用的世界书列表。
 */
export async function getWorldBooks_ACU(): Promise<string[]> {
    return listLorebooks_ACU();
}

// ═══ 角色绑定世界书 ═══

/**
 * 获取当前角色的主绑定世界书名称
 * @returns 世界书名称，不可用时返回 null
 */
export async function getCurrentCharPrimaryLorebook_ACU(): Promise<string | null> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getCurrentCharPrimaryLorebook !== 'function') {
        logWarn_ACU('[WorldbookGateway] getCurrentCharPrimaryLorebook 不可用，返回 null');
        return null;
    }
    return await TavernHelper_API_ACU.getCurrentCharPrimaryLorebook();
}

/**
 * 获取角色关联的世界书列表
 * @param options 查询选项（如 { type: 'all' }）
 * @returns 角色世界书结构，不可用时返回空结构
 */
export { getCharLorebooks_ACU, getCurrentCharacterWorldbookBinding_ACU };
