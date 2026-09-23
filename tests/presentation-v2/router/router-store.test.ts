/**
 * router-store.test — pageRegistry 行为、可见性过滤、持久化、close 行为
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

type RouterStoreModule = typeof import('../../../src/presentation-v2/stores/router-store');
type PageRegistryModule = typeof import('../../../src/presentation-v2/router/page-registry');
type RootShellModule = typeof import('../../../src/presentation-v2/stores/root-shell-store');
type PiniaModule = typeof import('pinia');

async function freshImport(): Promise<{
  router: RouterStoreModule;
  registry: PageRegistryModule;
  rootShell: RootShellModule;
  pinia: PiniaModule;
}> {
  vi.resetModules();
  const pinia = await import('pinia');
  const router = await import('../../../src/presentation-v2/stores/router-store');
  const registry = await import('../../../src/presentation-v2/router/page-registry');
  const rootShell = await import('../../../src/presentation-v2/stores/root-shell-store');
  return { router, registry, rootShell, pinia };
}

function persistAdvancedMode(activePageId?: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    uiMode: { mode: 'advanced' },
    ...(activePageId ? { router: { activePageId } } : {}),
  }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('router-store · pageRegistry 基线', () => {
  it('注册表恰好 15 项，分布于 5 分组', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.pageRegistry.length).toBe(15);
    const byGroup = r.pageRegistry.reduce<Record<string, number>>((acc, p) => {
      acc[p.group] = (acc[p.group] || 0) + 1;
      return acc;
    }, {});
    expect(byGroup).toEqual({
      overview: 2,
      config: 5,
      feature: 5,
      tool: 2,
      developer: 1,
    });
  });

  it('一级页名称与分组顺序符合手动触发 / 配置归属', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();

    expect(r.pageRegistry.map(p => [p.id, p.title, p.group])).toEqual([
      ['basic-config', '基础配置', 'overview'],
      ['dashboard', '仪表盘', 'overview'],
      ['form-fill', '填表工作台', 'config'],
      ['table', '填表规则', 'config'],
      ['plot', '剧情推进', 'config'],
      ['agent', 'Agent', 'config'],
      ['api', 'API', 'config'],
      ['continuation', '智能续写', 'feature'],
      ['world-simulation', '世界推演', 'feature'],
      ['import', '外部导入', 'feature'],
      ['vector-index', '交火模式', 'feature'],
      ['content-replace', '正文替换', 'feature'],
      ['data-mgmt', '数据管理', 'tool'],
      ['advanced-tools', '高级工具', 'tool'],
      ['developer', '开发者选项', 'developer'],
    ]);
  });
});

describe('router-store · 基础模式默认可见性', () => {
  it('未持久化时默认进入基础配置页，sidebar 只显示基础配置', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('basic-config');
    expect(r.visiblePages.map(p => p.id)).toEqual(['basic-config']);
    expect(r.visiblePagesByGroup.overview.map(p => p.id)).toEqual(['basic-config']);
  });

  it('基础模式拒绝切到高手模式页面', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    r.setActivePage('api');
    expect(r.activePageId).toBe('basic-config');
  });
});

describe('router-store · 高手模式可见性', () => {
  it('正文替换默认隐藏（featureGate 未开）', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    const ids = r.visiblePages.map(p => p.id);
    expect(ids).not.toContain('basic-config');
    expect(ids).not.toContain('content-replace');
  });

  it('高级工具始终可见，SQL 可用性由页内面板处理', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.visiblePages.map(p => p.id)).toContain('advanced-tools');
    expect(r.visiblePages.map(p => p.id)).not.toContain('sql-console');
    expect(r.visiblePages.map(p => p.id)).not.toContain('log-viewer');
    r.setSqliteMode(true);
    expect(r.visiblePages.map(p => p.id)).toContain('advanced-tools');
    r.setSqliteMode(false);
    expect(r.visiblePages.map(p => p.id)).toContain('advanced-tools');
  });

  it('初始化时从当前 settings 读取 SQLite 模式，但不再影响高级工具可见性', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({ ...state.settings_ACU, storageMode: 'sqlite' });
    m.pinia.setActivePinia(m.pinia.createPinia());

    const r = m.router.useRouterStore();

    expect(r.isSqliteMode).toBe(true);
    expect(r.visiblePages.map(p => p.id)).toContain('advanced-tools');
  });

  it('正文替换 featureGate 打开后出现在可见列表', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const state = await import('../../../src/service/runtime/state-manager');
    const r = m.router.useRouterStore();
    r.setFeatureGate(m.registry.FEATURE_GATE_CONTENT_REPLACE, true);
    expect(r.visiblePages.map(p => p.id)).toContain('content-replace');
    expect(state.settings_ACU.contentOptimizationSettings?.enabled).toBe(true);
  });

  it('初始化时正文替换开关未开则隐藏正文替换页', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({
      ...state.settings_ACU,
      contentOptimizationSettings: {
        ...(state.settings_ACU.contentOptimizationSettings || {}),
        enabled: false,
      },
    });
    m.pinia.setActivePinia(m.pinia.createPinia());

    const r = m.router.useRouterStore();

    expect(r.visiblePages.map(p => p.id)).not.toContain('content-replace');
    expect(state.settings_ACU.contentOptimizationSettings?.enabled).toBe(false);
  });

  it('初始化时正文替换用户偏好为开，显示正文替换页', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({
      ...state.settings_ACU,
      contentOptimizationSettings: {
        ...(state.settings_ACU.contentOptimizationSettings || {}),
        enabled: true,
        enabledSwitchTouched: true,
        enabledPreference: true,
      },
    });
    m.pinia.setActivePinia(m.pinia.createPinia());

    const r = m.router.useRouterStore();

    expect(r.visiblePages.map(p => p.id)).toContain('content-replace');
    expect(state.settings_ACU.contentOptimizationSettings?.enabled).toBe(true);
  });

  it('初始化时旧 enabled=true 但未登记偏好，按 legacy 值保持启用并显示页面', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({
      ...state.settings_ACU,
      contentOptimizationSettings: {
        ...(state.settings_ACU.contentOptimizationSettings || {}),
        enabled: true,
      },
    });
    m.pinia.setActivePinia(m.pinia.createPinia());

    const r = m.router.useRouterStore();

    expect(r.visiblePages.map(p => p.id)).toContain('content-replace');
    expect(state.settings_ACU.contentOptimizationSettings?.enabled).toBe(true);
  });

  it('高手模式世界推演默认隐藏：overview=1 / config=5 / feature=2 / tool=2 / developer=0', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.visiblePagesByGroup.overview.length).toBe(1);
    expect(r.visiblePagesByGroup.config.length).toBe(5);
    expect(r.visiblePagesByGroup.feature.length).toBe(2);
    expect(r.visiblePages.map(p => p.id)).not.toContain('world-simulation');
    expect(r.visiblePagesByGroup.tool.length).toBe(2); // 数据管理 + 高级工具
    expect(r.visiblePagesByGroup.developer.length).toBe(0); // 默认 developerOptionsEnabled=false
  });

  it('已有配置显式开启世界推演时初始化显示页面，关闭门禁后隐藏', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({ ...state.settings_ACU, worldSimulationPageEnabled: true });
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();

    expect(r.visiblePages.map(p => p.id)).toContain('world-simulation');
    r.setActivePage('world-simulation');
    expect(r.activePageId).toBe('world-simulation');
    r.setFeatureGate(m.registry.FEATURE_GATE_WORLD_SIMULATION, false);
    expect(r.visiblePages.map(p => p.id)).not.toContain('world-simulation');
    expect(r.activePageId).toBe('dashboard');
  });

  it('智能续写、世界推演、外部导入、交火模式都关闭时功能分组为空', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({
      ...state.settings_ACU,
      continuationPageEnabled: false,
      worldSimulationPageEnabled: false,
      externalImportPageEnabled: false,
      summaryVectorIndexModeDefault: false,
      plotSettings: {
        ...(state.settings_ACU.plotSettings || {}),
        loopSettings: {
          ...(state.settings_ACU.plotSettings?.loopSettings || {}),
          maxRetries: 3,
        },
      },
      contentOptimizationSettings: {
        ...(state.settings_ACU.contentOptimizationSettings || {}),
        enabled: false,
      },
    });
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();

    expect(r.visiblePagesByGroup.feature).toEqual([]);
    expect(r.visiblePages.map(p => p.id)).not.toContain('continuation');
    expect(r.visiblePages.map(p => p.id)).not.toContain('world-simulation');
    expect(r.visiblePages.map(p => p.id)).not.toContain('import');
    expect(r.visiblePages.map(p => p.id)).not.toContain('vector-index');
  });

  it('developer 一级页随 developerOptionsEnabled 切换可见性（plan §D24）', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    const devOptions = (await import('../../../src/presentation-v2/stores/dev-options-store')).useDevOptionsStore();

    expect(r.visiblePages.map(p => p.id)).not.toContain('developer');
    devOptions.setDeveloperOptionsEnabled(true);
    expect(r.visiblePages.map(p => p.id)).toContain('developer');
    devOptions.setDeveloperOptionsEnabled(false);
    expect(r.visiblePages.map(p => p.id)).not.toContain('developer');
  });
});

describe('router-store · 切页 + 持久化', () => {
  it('未持久化时默认页是 basic-config', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('basic-config');
  });

  it('高手模式未持久化路由时默认页是 dashboard', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('dashboard');
  });

  it('localStorage 中已有合法 id 时使用持久化值', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiMode: { mode: 'advanced' }, router: { activePageId: 'plot' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('plot');
  });

  it('旧 SQL 控制台持久化路由会迁移到高级工具', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiMode: { mode: 'advanced' }, router: { activePageId: 'sql-console' } }));
    const m = await freshImport();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_settings_ACU({ ...state.settings_ACU, storageMode: 'sqlite' });
    m.pinia.setActivePinia(m.pinia.createPinia());

    const r = m.router.useRouterStore();

    expect(r.activePageId).toBe('advanced-tools');
  });

  it('旧运行日志持久化路由会迁移到高级工具', async () => {
    persistAdvancedMode('log-viewer');
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('advanced-tools');
  });

  it('未知 id 落回默认页', async () => {
    persistAdvancedMode('no-such-page');
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('dashboard');
  });

  it('setActivePage 写入 localStorage', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    r.setActivePage('continuation');
    expect(r.activePageId).toBe('continuation');
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.router.activePageId).toBe('continuation');
    expect(persisted.router.bootPending).toBe(true);
  });

  it('剧情推进、智能续写、世界推演、外部导入与交火模式按功能开关控制一级页可见性', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();

    expect(r.visiblePagesByGroup.config.map(p => p.id)).toContain('plot');
    expect(r.visiblePagesByGroup.feature.map(p => p.id)[0]).toBe('continuation');
    expect(r.visiblePagesByGroup.feature.map(p => p.id)).not.toContain('world-simulation');
    r.setFeatureGate(m.registry.FEATURE_GATE_WORLD_SIMULATION, true);
    expect(r.visiblePagesByGroup.feature.map(p => p.id)).toContain('world-simulation');
    expect(r.visiblePagesByGroup.feature.map(p => p.id)).toContain('import');
    expect(r.visiblePages.map(p => p.id)).not.toContain('vector-index');

    r.setFeatureGate(m.registry.FEATURE_GATE_PLOT, false);
    expect(r.visiblePages.map(p => p.id)).not.toContain('plot');
    r.setActivePage('plot');
    expect(r.activePageId).toBe('dashboard');

    r.setFeatureGate(m.registry.FEATURE_GATE_CONTINUATION, false);
    r.setFeatureGate(m.registry.FEATURE_GATE_WORLD_SIMULATION, false);
    r.setFeatureGate(m.registry.FEATURE_GATE_IMPORT, false);
    expect(r.visiblePages.map(p => p.id)).not.toContain('continuation');
    expect(r.visiblePages.map(p => p.id)).not.toContain('world-simulation');
    expect(r.visiblePages.map(p => p.id)).not.toContain('import');

    r.setFeatureGate(m.registry.FEATURE_GATE_VECTOR_INDEX, true);
    expect(r.visiblePages.map(p => p.id)).toContain('vector-index');
  });

  it('setActivePage 拒绝切到不可见页', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    r.setActivePage('advanced-tools');
    expect(r.activePageId).toBe('advanced-tools');
    r.setActivePage('sql-console');
    expect(r.activePageId).toBe('advanced-tools'); // 旧 id 兼容迁移
  });

  it('切换 SQLite 模式不会让高级工具页变成不可见', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    r.setSqliteMode(true);
    r.setActivePage('advanced-tools');
    expect(r.activePageId).toBe('advanced-tools');
    r.setSqliteMode(false);
    expect(r.activePageId).toBe('advanced-tools');
  });

});

describe('router-store · 崩溃哨兵', () => {
  it('旧存档没有 bootPending 时仍恢复上次页面，并立即武装本轮哨兵', async () => {
    persistAdvancedMode('continuation');
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('continuation');
    expect(r.bootGeneration).toBe(1);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.router.activePageId).toBe('continuation');
    expect(persisted.router.bootPending).toBe(true);
  });

  it('上次页面未完成绘制时高手模式回退到 dashboard，不恢复 continuation', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      uiMode: { mode: 'advanced' },
      router: { activePageId: 'continuation', bootPending: true },
    }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('dashboard');
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.router.activePageId).toBe('dashboard');
    expect(persisted.router.bootPending).toBe(true);
  });

  it('上次页面未完成绘制时基础模式回退到 basic-config', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      uiMode: { mode: 'basic' },
      router: { activePageId: 'basic-config', bootPending: true },
    }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    expect(r.activePageId).toBe('basic-config');
  });

  it('markBootComplete 仅在 generation 匹配时清除 bootPending', async () => {
    persistAdvancedMode('plot');
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    const generation = r.bootGeneration;
    r.markBootComplete(generation - 1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).router.bootPending).toBe(true);
    r.markBootComplete(generation);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!).router;
    expect(persisted.bootPending).toBe(false);
    expect(persisted.activePageId).toBe('plot');
  });

  it('armBootPending 递增 generation，过期 complete 不能清掉新哨兵', async () => {
    persistAdvancedMode();
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const r = m.router.useRouterStore();
    const first = r.bootGeneration;
    r.markBootComplete(first);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).router.bootPending).toBe(false);

    const next = r.armBootPending();
    expect(next).toBe(first + 1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).router.bootPending).toBe(true);
    r.markBootComplete(first);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).router.bootPending).toBe(true);
    r.markBootComplete(next);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).router.bootPending).toBe(false);
  });

  it('scheduleRouterBootComplete_ACU 在双 rAF 之后才调用 complete', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const m = await freshImport();
    const onComplete = vi.fn();
    m.router.scheduleRouterBootComplete_ACU(onComplete);
    expect(onComplete).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(onComplete).not.toHaveBeenCalled();
    expect(frames).toHaveLength(2);
    frames[1](0);
    expect(onComplete).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('scheduleRouterBootComplete_ACU 在没有 rAF 时同步 complete', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const m = await freshImport();
    const onComplete = vi.fn();
    m.router.scheduleRouterBootComplete_ACU(onComplete);
    expect(onComplete).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('root-shell-store · close 行为（P0-6）', () => {
  it('requestOpenRefresh 累加打开刷新 tick', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const shell = m.rootShell.useRootShellStore();
    expect(shell.openRefreshTick).toBe(0);
    shell.requestOpenRefresh();
    shell.requestOpenRefresh();
    expect(shell.openRefreshTick).toBe(2);
  });

  it('requestScrollReset 累加 tick', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const shell = m.rootShell.useRootShellStore();
    expect(shell.scrollResetTick).toBe(0);
    shell.requestScrollReset();
    shell.requestScrollReset();
    expect(shell.scrollResetTick).toBe(2);
  });
});
