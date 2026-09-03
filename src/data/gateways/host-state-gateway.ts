/**
 * data/gateways/host-state-gateway.ts — 宿主运行时状态访问网关
 *
 * 封装 SillyTavern_API_ACU 上的只读运行时属性访问：
 *   - 用户名 (name1)
 *   - 用户人设描述 (persona_description)
 *   - 当前角色数据 (characters[this_chid]) 的 fallback 链
 *
 * service 层通过本模块访问宿主运行时状态，不再直接读取 SillyTavern_API_ACU 的属性。
 * 所有方法内置空值防御，宿主 API 不可用时返回安全默认值。
 */

import { SillyTavern_API_ACU } from '../../shared/host-api';
import { topLevelWindow_ACU } from '../../shared/env';
import { getCurrentCharData_ACU } from './character-gateway';

/**
 * 获取当前用户名
 * 优先级：SillyTavern_API_ACU.name1 → 默认值 '用户'
 * @returns 用户名字符串
 */
export function getUserName_ACU(): string {
    return SillyTavern_API_ACU?.name1 || '用户';
}

/**
 * 获取当前角色的宿主稳定索引。
 *
 * 该值只用于运行时作用域比较，不能使用角色显示名代替；显示名可重复或被编辑。
 * API 未完成初始化时返回 null，调用方必须将其视为不可靠作用域。
 */
function normalizeCharacterId_ACU(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
        return null;
    }
    return normalized;
}

export function getCurrentCharacterId_ACU(win?: any): string | null {
    try {
        const directId = normalizeCharacterId_ACU(SillyTavern_API_ACU?.this_chid);
        if (directId !== null) return directId;

        const w = win || topLevelWindow_ACU || window;
        const contextId = normalizeCharacterId_ACU((w as any)?.SillyTavern?.getContext?.()?.characterId);
        if (contextId !== null) return contextId;

        return normalizeCharacterId_ACU((w as any)?.this_chid);
    } catch {
        return null;
    }
}

/**
 * 获取当前角色卡的稳定作用域键（用于"以角色卡为单位"持久化配置）。
 *
 * 优先级：
 *   1. 群聊：`group:<groupId>`
 *   2. 角色卡：`char:<avatar 文件名>`（avatar 是酒馆内角色卡的唯一稳定标识，改名/排序不受影响；
 *      this_chid 只是列表索引，增删角色后会漂移，不能用作持久化键）
 *   3. 无 avatar 时退回 `charname:<角色名>`
 *
 * 无法识别当前角色/群组时返回 null，调用方需自行回退到聊天级键。
 */
export function getCurrentCharacterCardKey_ACU(win?: any): string | null {
    try {
        const w = win || topLevelWindow_ACU || window;
        const stContext = (w as any)?.SillyTavern?.getContext?.();
        const groupId = normalizeCharacterId_ACU((SillyTavern_API_ACU as any)?.groupId ?? stContext?.groupId);
        if (groupId !== null) return `group:${groupId}`;

        const character = getCurrentCharacterFallback_ACU(win);
        const avatar = String(character?.avatar || '').trim();
        if (avatar) return `char:${avatar}`;

        const name = String(character?.name || character?.data?.name || '').trim();
        if (name) return `charname:${name}`;
        return null;
    } catch {
        return null;
    }
}

/**
 * 获取用户人设描述 (persona_description)
 * 按优先级尝试多个来源：
 *   1. SillyTavern.getContext().powerUserSettings.persona_description
 *   2. window.power_user.persona_description
 *   3. SillyTavern_API_ACU.powerUserSettings.persona_description
 * @param win 可选，指定查找 SillyTavern.getContext() 的 window 对象（支持 iframe 场景）
 * @returns 人设描述字符串，不可用时返回 ''
 */
export function getPersonaDescription_ACU(win?: any): string {
    try {
        const w = win || topLevelWindow_ACU || window;
        const stContext = (w as any)?.SillyTavern?.getContext?.();
        return stContext?.powerUserSettings?.persona_description
            || (w as any)?.power_user?.persona_description
            || SillyTavern_API_ACU?.powerUserSettings?.persona_description
            || '';
    } catch {
        return '';
    }
}

/**
 * 获取当前角色数据（带完整 fallback 链）
 * 按优先级尝试多个来源：
 *   1. TavernHelper.getCharData('current')（通过 character-gateway）
 *   2. SillyTavern_API_ACU.characters[this_chid]
 *   3. SillyTavern.getContext().characters[characterId]
 *   4. window.characters[window.this_chid]（全局变量 fallback）
 * @param win 可选，指定查找全局变量的 window 对象（支持 iframe 场景）
 * @returns 角色数据对象，不可用时返回 null
 */
export function getCurrentCharacterFallback_ACU(win?: any): any | null {
    try {
        // 优先使用 TavernHelper.getCharData('current')
        const charData = getCurrentCharData_ACU();
        if (charData) {
            return getCurrentCharData_ACU('current') || charData;
        }

        const w = win || topLevelWindow_ACU || window;
        const stContext = (w as any)?.SillyTavern?.getContext?.();

        return SillyTavern_API_ACU?.characters?.[SillyTavern_API_ACU?.this_chid]
            || stContext?.characters?.[stContext?.characterId]
            || (typeof (w as any)?.characters !== 'undefined' && typeof (w as any)?.this_chid !== 'undefined'
                ? (w as any).characters[(w as any).this_chid]
                : null);
    } catch {
        return null;
    }
}

/**
 * 获取当前角色描述文本
 * 在 getCurrentCharacterFallback_ACU 基础上提取描述字段，
 * 并额外尝试 stContext.name2_description 作为最终 fallback。
 * @param win 可选，指定查找的 window 对象
 * @returns 角色描述字符串，不可用时返回 ''
 */
export function getCharDescription_ACU(win?: any): string {
    try {
        const character = getCurrentCharacterFallback_ACU(win);
        if (character?.description || character?.data?.description) {
            return character.description || character.data.description;
        }

        // 最终 fallback：stContext.name2_description
        const w = win || topLevelWindow_ACU || window;
        const stContext = (w as any)?.SillyTavern?.getContext?.();
        return stContext?.name2_description || '';
    } catch {
        return '';
    }
}
