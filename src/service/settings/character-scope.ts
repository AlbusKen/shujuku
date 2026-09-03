/**
 * service/settings/character-scope.ts — 角色卡级配置作用域键
 *
 * 填表世界书配置（characterSettings[key].worldbookConfig）与剧情推进世界书配置
 * （plotWorldbookConfigByCharacter[key]）都以"角色卡"为单位持久化：
 * 同一张角色卡下切换/新建聊天，世界书来源与手动选择保持不变。
 *
 * 键的解析交给 host-state-gateway；取不到角色卡/群组时退回聊天文件名，
 * 与旧版"按聊天存储"的行为保持一致，避免在宿主状态未就绪时产生错误归属。
 */
import { getCurrentCharacterCardKey_ACU } from '../../data/gateways/host-state-gateway';
import { currentChatFileIdentifier_ACU } from '../runtime/state-manager';

export const CHARACTER_SCOPE_DEFAULT_KEY_ACU = 'default';

export interface CharacterScope_ACU {
  key: string;
  /** true 表示键来自宿主的角色卡/群组标识；false 表示退回了聊天级键。 */
  reliable: boolean;
}

/** 旧版按聊天文件名的键（仅用于迁移历史数据 / 不可靠时回退）。 */
export function getLegacyChatScopeKey_ACU(): string {
  return currentChatFileIdentifier_ACU || CHARACTER_SCOPE_DEFAULT_KEY_ACU;
}

export function resolveCurrentCharacterScope_ACU(): CharacterScope_ACU {
  const cardKey = getCurrentCharacterCardKey_ACU();
  if (cardKey) return { key: cardKey, reliable: true };
  return { key: getLegacyChatScopeKey_ACU(), reliable: false };
}

/** 当前角色卡作用域键：角色卡/群组优先，取不到时退回聊天级键。 */
export function getCurrentCharacterScopeKey_ACU(): string {
  return resolveCurrentCharacterScope_ACU().key;
}
