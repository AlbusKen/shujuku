/**
 * data/gateways/character-gateway.ts — 角色数据读取网关
 *
 * 封装 TavernHelper_API_ACU 的角色数据相关方法。
 * service 层通过本模块访问角色数据，不再直接调用宿主 API。
 *
 * 所有方法内置存在性检查，宿主 API 不可用时返回安全默认值。
 */

import { TavernHelper_API_ACU } from '../../shared/host-api';
import { logWarn_ACU } from '../../shared/utils';

/**
 * 获取当前角色的完整数据
 * @param target 目标标识，通常为 'current'
 * @returns 角色数据对象，不可用时返回 null
 */
export function getCurrentCharData_ACU(target: string = 'current'): any | null {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getCharData !== 'function') {
        return null;
    }
    return TavernHelper_API_ACU.getCharData(target);
}

export type CharacterWorldbookBindingApiSource_ACU = 'getCharWorldbookNames';

export interface CharacterWorldbookBinding_ACU {
    primary: string | null;
    additional: string[];
    orderedNames: string[];
    apiSource: CharacterWorldbookBindingApiSource_ACU;
}

export class CharacterWorldbookBindingError_ACU extends Error {
    constructor(name: 'CharacterWorldbookApiUnavailableError_ACU' | 'CharacterWorldbookBindingContractError_ACU') {
        super(name);
        this.name = name;
    }
}

function normalizeCharacterWorldbookBinding_ACU(raw: unknown, apiSource: CharacterWorldbookBindingApiSource_ACU): CharacterWorldbookBinding_ACU {
    if (!raw || typeof raw !== 'object') {
        throw new CharacterWorldbookBindingError_ACU('CharacterWorldbookBindingContractError_ACU');
    }
    const { primary, additional } = raw as { primary?: unknown; additional?: unknown };
    if (primary !== null && primary !== undefined && typeof primary !== 'string') {
        throw new CharacterWorldbookBindingError_ACU('CharacterWorldbookBindingContractError_ACU');
    }
    if (!Array.isArray(additional) || additional.some(name => typeof name !== 'string')) {
        throw new CharacterWorldbookBindingError_ACU('CharacterWorldbookBindingContractError_ACU');
    }
    const normalizedPrimary = typeof primary === 'string' && primary.trim() ? primary : null;
    const normalizedAdditional = additional
        .filter(name => name.trim());
    const orderedNames = [...new Set([normalizedPrimary, ...normalizedAdditional].filter((name): name is string => !!name))];
    return { primary: normalizedPrimary, additional: [...new Set(normalizedAdditional)], orderedNames, apiSource };
}

/**
 * 返回当前角色的规范化绑定集合。
 */
export async function getCurrentCharacterWorldbookBinding_ACU(): Promise<CharacterWorldbookBinding_ACU> {
    if (TavernHelper_API_ACU && typeof TavernHelper_API_ACU.getCharWorldbookNames === 'function') {
        return normalizeCharacterWorldbookBinding_ACU(await TavernHelper_API_ACU.getCharWorldbookNames('current'), 'getCharWorldbookNames');
    }
    logWarn_ACU('[CharacterGateway] 当前角色世界书 API 不可用。', { phase: 'character_worldbook_binding' });
    throw new CharacterWorldbookBindingError_ACU('CharacterWorldbookApiUnavailableError_ACU');
}

/**
 * 获取当前角色绑定的所有世界书列表
 * @param options 查询选项，默认 { type: 'all' }
 * @returns 角色世界书结构，不可用时返回空结构
 */
export async function getCharLorebooks_ACU(options: { type?: 'all' | 'primary' | 'additional' } = { type: 'all' }): Promise<any> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getCharLorebooks !== 'function') {
        logWarn_ACU('[CharacterGateway] getCharLorebooks 不可用，返回空对象');
        return { primary: '', additional: [] };
    }
    return await TavernHelper_API_ACU.getCharLorebooks(options);
}

/**
 * 获取聊天消息（通过 TavernHelper API）
 * @param range 消息范围
 * @param options 查询选项
 * @returns 消息数组，不可用时返回 []
 */
export async function getChatMessages_ACU(range?: any, options?: any): Promise<any[]> {
    if (!TavernHelper_API_ACU || typeof TavernHelper_API_ACU.getChatMessages !== 'function') {
        logWarn_ACU('[CharacterGateway] getChatMessages 不可用，返回空数组');
        return [];
    }
    return await TavernHelper_API_ACU.getChatMessages(range, options);
}
