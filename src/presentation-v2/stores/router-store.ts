/**
 * router-store — 一级页路由（D18 / P0-3 / P0-6）
 *
 * 设计要点：
 * - 不引 vue-router；activePageId 直接驱动主区 <component :is>
 * - sidebar 数据驱动：`visiblePages` 按可见性过滤注册表
 * - P0-6：activePageId 持久化到 acu_v2_ui_state.router；关闭后再开保留页面
 *   抽屉 / 滚动是页面内部状态，不在路由层处理（关闭/重开不持久化）
 * - 崩溃哨兵：即将渲染一页时写入 bootPending=true；首帧绘制完成后清掉。
 *   下次启动若仍为 true，视为上次卡死，回退到默认可见页，避免重页死循环。
 */
import { defineStore } from 'pinia';
import { logWarn_ACU } from '../../shared/utils';
import {
  ACU_V2_BASIC_PAGE_ID,
  ACU_V2_DEFAULT_PAGE_ID,
  ACU_V2_PAGE_REGISTRY,
  FEATURE_GATE_CONTENT_REPLACE,
  FEATURE_GATE_CONTINUATION,
  FEATURE_GATE_WORLD_SIMULATION,
  FEATURE_GATE_IMPORT,
  FEATURE_GATE_PLOT,
  FEATURE_GATE_VECTOR_INDEX,
} from '../router/page-registry';
import type { AcuV2Page, AcuV2PageGroup } from '../router/page-types';
import { ACU_V2_PAGE_GROUPS } from '../router/page-types';
import { readSection, writeSection } from './persistence';
import { settings_ACU } from '../../service/runtime/state-manager';
import { useUiModeStore } from './ui-mode-store';
import { setContentReplaceEnabledBySettings, syncContentReplaceAvailability } from './content-replace-gate';

const SECTION_KEY = 'router';
const LEGACY_PAGE_ID_ALIASES: Record<string, string> = {
  'sql-console': 'advanced-tools',
  'log-viewer': 'advanced-tools',
};

interface PersistedRouter {
  activePageId: string;
  /** true 表示该页尚未完成一次事件循环切片上的绘制。 */
  bootPending?: boolean;
}

interface RouterState {
  activePageId: string;
  isSqliteMode: boolean;
  /** D7 / 4.1 中"默认隐藏 / 受控开启"feature gate 的开关表。 */
  featureGates: Record<string, boolean>;
  /** 内存代次：过期的 rAF complete 不得清掉后一页的哨兵。 */
  bootGeneration: number;
}

function normalizePageId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  return LEGACY_PAGE_ID_ALIASES[id] || id;
}

function isKnownPage(id: unknown): id is string {
  const normalized = normalizePageId(id);
  return Boolean(normalized && ACU_V2_PAGE_REGISTRY.some(p => p.id === normalized));
}

function readInitialFeatureGates(): Record<string, boolean> {
  return {
    [FEATURE_GATE_CONTENT_REPLACE]: syncContentReplaceAvailability(),
    [FEATURE_GATE_PLOT]: settings_ACU?.plotSettings?.enabled === true,
    [FEATURE_GATE_CONTINUATION]: settings_ACU?.continuationPageEnabled !== false,
    [FEATURE_GATE_WORLD_SIMULATION]: settings_ACU?.worldSimulationPageEnabled === true,
    [FEATURE_GATE_IMPORT]: settings_ACU?.externalImportPageEnabled !== false,
    [FEATURE_GATE_VECTOR_INDEX]: settings_ACU?.summaryVectorIndexModeDefault === true,
  };
}

function readInitialSqliteMode(): boolean {
  return settings_ACU?.storageMode === 'sqlite';
}

function readInitialActiveId(featureGates: Record<string, boolean>, isSqliteMode: boolean): string {
  const persisted = readSection<PersistedRouter>(SECTION_KEY);
  if (persisted?.bootPending === true) {
    logWarn_ACU('[ACU-V2] previous page paint did not complete; falling back to the default page.');
    return defaultVisiblePageId();
  }
  if (persisted && isKnownPage(persisted.activePageId)) {
    const activePageId = normalizePageId(persisted.activePageId) || persisted.activePageId;
    const page = ACU_V2_PAGE_REGISTRY.find(p => p.id === activePageId);
    const initialState: RouterState = {
      activePageId,
      isSqliteMode,
      featureGates,
      bootGeneration: 0,
    };
    if (page && isPageVisible(page, initialState)) return activePageId;
  }
  return defaultVisiblePageId();
}

function persistRouterArmed_ACU(activePageId: string): void {
  writeSection(SECTION_KEY, { activePageId, bootPending: true } satisfies PersistedRouter);
}

function isPageVisible(page: AcuV2Page, state: RouterState): boolean {
  const uiMode = useUiModeStore();
  if (uiMode.isBasicMode) return page.id === ACU_V2_BASIC_PAGE_ID;
  if (page.id === ACU_V2_BASIC_PAGE_ID) return false;
  if (page.requiresSqlite && !state.isSqliteMode) return false;
  if (page.featureGate && !state.featureGates[page.featureGate]) return false;
  if (page.visibleWhen && !page.visibleWhen()) return false;
  return true;
}

function defaultVisiblePageId(): string {
  return useUiModeStore().isBasicMode ? ACU_V2_BASIC_PAGE_ID : ACU_V2_DEFAULT_PAGE_ID;
}

export const useRouterStore = defineStore('acu-v2-router', {
  state: (): RouterState => {
    const featureGates = readInitialFeatureGates();
    const isSqliteMode = readInitialSqliteMode();
    const activePageId = readInitialActiveId(featureGates, isSqliteMode);
    persistRouterArmed_ACU(activePageId);
    return {
      activePageId,
      isSqliteMode,
      featureGates,
      bootGeneration: 1,
    };
  },
  getters: {
    pageRegistry: (): readonly AcuV2Page[] => ACU_V2_PAGE_REGISTRY,
    groups: (): typeof ACU_V2_PAGE_GROUPS => ACU_V2_PAGE_GROUPS,
    visiblePages(state): AcuV2Page[] {
      return ACU_V2_PAGE_REGISTRY.filter(p => isPageVisible(p, state));
    },
    visiblePagesByGroup(): Record<AcuV2PageGroup, AcuV2Page[]> {
      const out: Record<AcuV2PageGroup, AcuV2Page[]> = {
        overview: [],
        config: [],
        feature: [],
        tool: [],
        developer: [],
      };
      for (const page of this.visiblePages) {
        out[page.group].push(page);
      }
      return out;
    },
    activePage(state): AcuV2Page | null {
      return ACU_V2_PAGE_REGISTRY.find(p => p.id === state.activePageId) ?? null;
    },
  },
  actions: {
    setActivePage(id: string): void {
      const normalizedId = normalizePageId(id);
      if (!normalizedId) return;
      const target = ACU_V2_PAGE_REGISTRY.find(p => p.id === normalizedId);
      if (!target) return;
      // 切到当前不可见的页（如功能 gate 关闭后又试图回到对应页）
      // 时拒绝切换，让 sidebar 保持一致状态
      if (!isPageVisible(target, this)) return;
      if (this.activePageId === normalizedId) return;
      this.activePageId = normalizedId;
      this.armBootPending();
    },
    setSqliteMode(on: boolean): void {
      this.isSqliteMode = on;
      this.ensureActiveVisible();
    },
    setFeatureGate(key: string, on: boolean): void {
      const next = key === FEATURE_GATE_CONTENT_REPLACE
        ? setContentReplaceEnabledBySettings(on)
        : on;
      this.featureGates = { ...this.featureGates, [key]: next };
      this.ensureActiveVisible();
    },
    syncFeatureGate(key: string, on: boolean): void {
      this.featureGates = { ...this.featureGates, [key]: on };
      this.ensureActiveVisible();
    },
    /** 当前页变成不可见时回退到默认页。 */
    ensureActiveVisible(): void {
      const current = this.activePage;
      if (current && isPageVisible(current, this)) return;
      this.activePageId = defaultVisiblePageId();
      this.armBootPending();
    },
    /** 即将渲染当前页：武装哨兵并推进代次。 */
    armBootPending(): number {
      this.bootGeneration += 1;
      persistRouterArmed_ACU(this.activePageId);
      return this.bootGeneration;
    },
    /** 当前页已交出一次事件循环切片。代次不匹配时忽略。 */
    markBootComplete(generation: number): void {
      if (generation !== this.bootGeneration) return;
      writeSection(SECTION_KEY, { activePageId: this.activePageId, bootPending: false } satisfies PersistedRouter);
    },
  },
});

/** 双 rAF：setup/onMounted 卡死时回调不会执行，哨兵保持 true。 */
export function scheduleRouterBootComplete_ACU(onComplete: () => void): void {
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
  if (!raf) {
    onComplete();
    return;
  }
  raf(() => {
    raf(() => {
      onComplete();
    });
  });
}
