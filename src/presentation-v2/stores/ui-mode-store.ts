/**
 * ui-mode-store — 新 UI 的功能档位。
 *
 * 轻量 / 进阶 / 高级三档单选，弹窗中三档同时可选，不需要逐级解锁。
 * 档位只控制页面与配置项显隐，不参与填表模式或运行时召回。
 *
 * 持久化使用独立 section `uiTierV2`。旧版 `uiTier` / `uiMode` section 不再读取：
 * 本次更新后所有用户一次性回到轻量模式，之后按新 section 记忆各自的选择。
 */
import { defineStore } from 'pinia';
import { readSection, writeSection } from './persistence';

const TIER_SECTION_KEY = 'uiTierV2';

export type AcuUiTier = 'low' | 'medium' | 'high';
export type AcuV2UiMode = AcuUiTier;

interface PersistedTier {
  tier?: unknown;
}

export const ACU_UI_TIER_LABELS: Record<AcuUiTier, string> = {
  low: '轻量模式',
  medium: '进阶模式',
  high: '高级模式',
};

export const ACU_UI_TIER_RANK: Record<AcuUiTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function normalizeUiTier(value: unknown): AcuUiTier {
  if (value === 'medium') return 'medium';
  if (value === 'high') return 'high';
  return 'low';
}

function loadFromStorage(): AcuUiTier {
  return normalizeUiTier(readSection<PersistedTier>(TIER_SECTION_KEY)?.tier);
}

function persistTier(tier: AcuUiTier): void {
  writeSection(TIER_SECTION_KEY, { tier });
}

export const useUiModeStore = defineStore('acu-v2-ui-mode', {
  state: () => ({ tier: loadFromStorage() as AcuUiTier }),
  getters: {
    mode: (state): AcuUiTier => state.tier,
    label: (state): string => ACU_UI_TIER_LABELS[state.tier],
    modeLabel: (state): string => ACU_UI_TIER_LABELS[state.tier],
    isBasicMode: (state): boolean => state.tier === 'low',
    isAdvancedMode: (state): boolean => state.tier === 'high',
  },
  actions: {
    setTier(tier: AcuUiTier): void {
      this.tier = normalizeUiTier(tier);
      persistTier(this.tier);
    },
    setMode(tier: AcuUiTier): void {
      this.setTier(tier);
    },
    refresh(): void {
      this.tier = loadFromStorage();
    },
  },
});
