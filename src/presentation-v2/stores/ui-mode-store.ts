/**
 * ui-mode-store — 新 UI 的功能档位。
 *
 * 档位只控制页面与配置项显隐，不参与填表模式或运行时召回。
 */
import { defineStore } from 'pinia';
import { readSection, writeSection } from './persistence';

const TIER_SECTION_KEY = 'uiTier';
const LEGACY_MODE_SECTION_KEY = 'uiMode';
const ROUTER_SECTION_KEY = 'router';
/** 旧二态版本中基础模式唯一可见的页面；持久化路由停在其他页面即证明旧用户处于高手模式。 */
const LEGACY_BASIC_PAGE_ID = 'basic-config';


export type AcuUiTier = 'low' | 'medium' | 'high';
export type AcuV2UiMode = AcuUiTier;

interface PersistedTier {
  tier?: unknown;
}

interface PersistedLegacyMode {
  mode?: unknown;
}

export const ACU_UI_TIER_LABELS: Record<AcuUiTier, string> = {
  low: '基础模式',
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
  if (value === 'high' || value === 'advanced') return 'high';
  return 'low';
}

function loadFromStorage(): AcuUiTier {
  const persisted = readSection<PersistedTier>(TIER_SECTION_KEY);
  if (persisted?.tier !== undefined) return normalizeUiTier(persisted.tier);

  const legacy = readSection<PersistedLegacyMode>(LEGACY_MODE_SECTION_KEY);
  if (legacy?.mode !== undefined) return normalizeUiTier(legacy.mode);

  const router = readSection<{ activePageId?: unknown }>(ROUTER_SECTION_KEY);
  const pageId = typeof router?.activePageId === 'string' ? router.activePageId : '';
  if (pageId && pageId !== LEGACY_BASIC_PAGE_ID) return 'high';
  return 'low';
}

function persistTier(tier: AcuUiTier): void {
  writeSection(TIER_SECTION_KEY, { tier });
}

export const useUiModeStore = defineStore('acu-v2-ui-mode', {
  state: () => {
    const hasStoredTier = readSection<PersistedTier>(TIER_SECTION_KEY)?.tier !== undefined;
    const tier = loadFromStorage();
    // 首次加载即固化推导出的档位：之后新版路由写入不会再被误读为旧版高手模式证据。
    if (!hasStoredTier) persistTier(tier);
    return { tier: tier as AcuUiTier };
  },
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
