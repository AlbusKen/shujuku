/**
 * theme-store.test — 验证主题切换、持久化、注入
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STYLE_NODE_ID = 'acu-v2-theme';
const APP_ROOT_ID = 'acu-app-v2';
const STORAGE_KEY = 'acu_v2_ui_state';

type ThemeStoreModule = typeof import('../../../src/presentation-v2/stores/theme-store');
type InjectorModule = typeof import('../../../src/presentation-v2/theme/theme-injector');
type PersistenceModule = typeof import('../../../src/presentation-v2/stores/persistence');
type HostDocModule = typeof import('../../../src/presentation-v2/bootstrap/host-document');
type PiniaModule = typeof import('pinia');

const JIRAI_TOKENS = {
  bg0: '#2B2B2B',
  bg1: '#1F1F1F',
  bg2: 'rgba(255, 196, 212, 0.08)',
  sidebarBg: '#1F1F1F',
  hoverOverlay: 'rgba(255, 196, 212, 0.12)',
  border: 'transparent',
  border2: 'transparent',
  text1: '#FFFFFF',
  text2: 'rgba(255, 255, 255, 0.70)',
  text3: 'rgba(255, 255, 255, 0.50)',
  accent: '#FFC4D4',
  accent2: '#FFD9E4',
  onAccent: '#2B2B2B',
  accentGlow: 'rgba(255, 196, 212, 0.25)',
  success: '#E5A0B5',
  warning: '#FFB38B',
  danger: '#D96C6C',
  fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
  radiusLg: '18px',
  radiusMd: '16px',
  radiusSm: '12px',
  shadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
};

async function freshImport(): Promise<{
  themeStore: ThemeStoreModule;
  injector: InjectorModule;
  persistence: PersistenceModule;
  host: HostDocModule;
  pinia: PiniaModule;
}> {
  vi.resetModules();
  const [themeStore, injector, persistence, host, pinia] = await Promise.all([
    import('../../../src/presentation-v2/stores/theme-store'),
    import('../../../src/presentation-v2/theme/theme-injector'),
    import('../../../src/presentation-v2/stores/persistence'),
    import('../../../src/presentation-v2/bootstrap/host-document'),
    import('pinia'),
  ]);
  return { themeStore, injector, persistence, host, pinia };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('theme-store', () => {
  it('未持久化时使用奶龙主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('milk-dragon');
  });

  it('localStorage 中已有合法 id 时按持久化值初始化', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { migrationVersion: 1, activeId: 'creamy-minimal' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('creamy-minimal');
  });

  it('旧版本主题状态会一次性迁移到奶龙主题', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { activeId: 'strawberry-dragon' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('milk-dragon');
    expect(store.activeTheme.name).toBe('奶龙配色');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ theme: { activeId: 'strawberry-dragon' } });
  });

  it('已迁移状态中的非法 id 落回奶龙主题', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: { migrationVersion: 1, activeId: 'not-a-theme' } }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.activeId).toBe('milk-dragon');
  });

  it('setTheme 切换后 localStorage 被写入新 id', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    store.setTheme('default-light');
    expect(store.activeId).toBe('default-light');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ theme: { migrationVersion: 1, activeId: 'default-light' } });
  });

  it('setTheme 拒绝非法 id（不变更 state）', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const before = store.activeId;
    (store.setTheme as any)('definitely-not-a-theme');
    expect(store.activeId).toBe(before);
  });

  it('只暴露当前维护的五个内置主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    expect(store.themes.map(t => t.id)).toEqual([
      'default-light',
      'default-dark',
      'creamy-minimal',
      'jirai-kei',
      'milk-dragon',
    ]);
  });

  it('导入 v2 自定义主题后加入列表、切为活动主题并持久化', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;

    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '夜航主题',
        colorScheme: 'dark',
        tokens: {
          ...base.tokens,
          bg0: '#101820',
          accent: '#91D9F7',
        },
      },
    }));

    expect(imported.id).toBe('custom:theme');
    expect(imported.name).toBe('夜航主题');
    expect(store.activeId).toBe(imported.id);
    expect(store.activeTheme.tokens.bg0).toBe('#101820');
    expect(store.themes.map(t => t.id)).toEqual([
      'default-light',
      'default-dark',
      'creamy-minimal',
      'jirai-kei',
      'milk-dragon',
      'custom:theme',
    ]);

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.theme.activeId).toBe('custom:theme');
    expect(raw.theme.customThemes).toHaveLength(1);
    expect(raw.theme.customThemes[0]).toMatchObject({
      id: 'custom:theme',
      name: '夜航主题',
      colorScheme: 'dark',
    });
  });

  it('导入同名地雷色主题时使用内置主题并移除自定义主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();

    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:jirai-kei',
        name: '地雷色',
        colorScheme: 'dark',
        tokens: {
          ...JIRAI_TOKENS,
          bg0: '#000000',
        },
      },
    }));

    expect(imported.id).toBe('jirai-kei');
    expect(store.activeId).toBe('jirai-kei');
    expect(store.customThemes).toEqual([]);
    expect(store.themes.map(t => t.id)).toEqual([
      'default-light',
      'default-dark',
      'creamy-minimal',
      'jirai-kei',
      'milk-dragon',
    ]);
    expect(store.activeTheme.tokens.bg0).toBe('#2B2B2B');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { migrationVersion: 1, activeId: 'jirai-kei' },
    });
  });

  it('localStorage 中已有同名自定义地雷色时恢复为内置主题', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: {
        migrationVersion: 1,
        activeId: 'custom:jirai-kei',
        customThemes: [{
          id: 'custom:jirai-kei',
          name: '地雷色',
          colorScheme: 'dark',
          tokens: {
            ...JIRAI_TOKENS,
            bg0: '#000000',
          },
        }],
      },
    }));
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();

    expect(store.activeId).toBe('jirai-kei');
    expect(store.activeTheme.name).toBe('地雷色');
    expect(store.activeTheme.tokens.bg0).toBe('#2B2B2B');
    expect(store.customThemes).toEqual([]);
    expect(store.themes.filter(t => t.name === '地雷色')).toHaveLength(1);
  });

  it('localStorage 中已有自定义主题时可以恢复活动主题', async () => {
    const m1 = await freshImport();
    m1.pinia.setActivePinia(m1.pinia.createPinia());
    const store1 = m1.themeStore.useThemeStore();
    const base = store1.themes.find(t => t.id === 'default-light')!;
    store1.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:saved-theme',
        name: '保存主题',
        colorScheme: 'light',
        tokens: base.tokens,
      },
    }));

    const m2 = await freshImport();
    m2.pinia.setActivePinia(m2.pinia.createPinia());
    const store2 = m2.themeStore.useThemeStore();
    expect(store2.activeId).toBe('custom:saved-theme');
    expect(store2.activeTheme.name).toBe('保存主题');
  });

  it('删除当前自定义主题时回退默认主题，并拒绝删除内置主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;
    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:delete-me',
        name: '删除测试',
        colorScheme: 'dark',
        tokens: base.tokens,
      },
    }));

    expect(store.deleteCustomTheme('default-dark')).toBe(false);
    expect(store.deleteCustomTheme(imported.id)).toBe(true);
    expect(store.activeId).toBe('milk-dragon');
    expect(store.themes.some(t => t.id === imported.id)).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { migrationVersion: 1, activeId: 'milk-dragon' },
    });
  });

  it('导出主题使用 v2 自定义主题文件格式，内置主题不携带 custom id', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const baseFile = store.buildThemeFile('default-light');
    expect(baseFile).toMatchObject({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '浅色',
        colorScheme: 'light',
      },
    });
    expect(baseFile.theme.id).toBeUndefined();

    const imported = store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        id: 'custom:export-me',
        name: '导出测试',
        colorScheme: 'light',
        tokens: baseFile.theme.tokens,
      },
    }));
    expect(store.buildThemeFile(imported.id).theme.id).toBe('custom:export-me');
  });

  it('拒绝旧主题格式、缺失 token 与危险 CSS token', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const base = store.themes.find(t => t.id === 'default-dark')!;

    expect(() => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-theme',
      version: 1,
      theme: { name: '旧主题' },
    }))).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');

    expect(() => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '缺字段',
        colorScheme: 'dark',
        tokens: { bg0: '#000' },
      },
    }))).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');

    expect(() => store.importCustomThemeFromJsonText(JSON.stringify({
      kind: 'acu-v2-theme',
      version: 1,
      theme: {
        name: '危险主题',
        colorScheme: 'dark',
        tokens: {
          ...base.tokens,
          bg0: '#000; } body { color: red',
        },
      },
    }))).toThrow('主题文件缺少 v2 主题所需的颜色模式或 token。');
  });

  it('深色使用灰蓝底色与冷薄荷 accent', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const defaultDark = store.themes.find(t => t.id === 'default-dark');
    expect(defaultDark).toMatchObject({
      name: '深色',
      colorScheme: 'dark',
      tokens: {
        bg0: '#1F2428',
        bg1: '#24292E',
        bg2: '#2D343B',
        sidebarBg: '#1F2428',
        hoverOverlay: 'rgba(201, 209, 217, 0.08)',
        border: 'rgba(205, 217, 229, 0.08)',
        border2: 'rgba(205, 217, 229, 0.14)',
        text1: '#F0F3F6',
        text2: '#C9D1D9',
        text3: '#8B949E',
        accent: '#7FD6CA',
        accent2: '#69C7BC',
        onAccent: '#1F2428',
        accentGlow: 'rgba(127, 214, 202, 0.26)',
        success: '#8DBA9A',
        warning: '#C9A35E',
        danger: '#D07A74',
        shadow: '0 18px 48px rgba(1, 4, 9, 0.36)',
      },
    });
  });

  it('包含奶油风主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const creamyMinimal = store.themes.find(t => t.id === 'creamy-minimal');
    expect(creamyMinimal).toMatchObject({
      name: '奶油风',
      colorScheme: 'light',
      tokens: {
        bg0: '#F7F0E6',
        bg1: '#FCF8F1',
        bg2: '#EFE4D7',
        sidebarBg: '#F6ECDD',
        border: 'rgba(116, 91, 62, 0.12)',
        text1: '#514638',
        accent: '#85A76A',
        onAccent: '#FCF8F1',
        hoverOverlay: 'rgba(116, 91, 62, 0.08)',
        success: '#7F9B69',
        warning: '#AA8050',
        danger: '#A76561',
        radiusLg: '18px',
      },
    });

    store.setTheme('creamy-minimal');
    expect(store.activeId).toBe('creamy-minimal');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { migrationVersion: 1, activeId: 'creamy-minimal' },
    });
  });

  it('包含地雷色主题', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    const jiraiKei = store.themes.find(t => t.id === 'jirai-kei');
    expect(jiraiKei).toMatchObject({
      name: '地雷色',
      colorScheme: 'dark',
      tokens: {
        bg0: '#2B2B2B',
        bg1: '#1F1F1F',
        bg2: 'rgba(255, 196, 212, 0.08)',
        sidebarBg: '#1F1F1F',
        border: 'transparent',
        text1: '#FFFFFF',
        accent: '#FFC4D4',
        accent2: '#FFD9E4',
        onAccent: '#2B2B2B',
        hoverOverlay: 'rgba(255, 196, 212, 0.12)',
        success: '#E5A0B5',
        warning: '#FFB38B',
        danger: '#D96C6C',
        radiusLg: '18px',
      },
    });

    store.setTheme('jirai-kei');
    expect(store.activeId).toBe('jirai-kei');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      theme: { migrationVersion: 1, activeId: 'jirai-kei' },
    });
  });
});

describe('theme-injector', () => {
  it('applyTheme 把内置主题分别写入同一个 <style id="acu-v2-theme">', async () => {
    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();

    m.injector.applyTheme(store.activeTheme);
    const style1 = document.getElementById(STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(style1).not.toBeNull();
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} {`);
    expect(style1!.textContent).not.toContain(`#${APP_ROOT_ID} *`);
    expect(style1!.textContent).toContain('--acu-bg-0:');
    expect(style1!.textContent).toContain('--acu-sidebar-bg:');
    expect(style1!.textContent).not.toContain('--acu-bg-3:');
    expect(style1!.textContent).toContain('--acu-hover-overlay:');
    expect(style1!.textContent).toContain('--acu-accent:');
    expect(style1!.textContent).not.toContain('--acu-accent-glow-2:');
    expect(style1!.textContent).toContain('--acu-font-ui:');
    expect(style1!.textContent).toContain('--acu-font-mono:');
    expect(style1!.textContent).toContain('scrollbar-color: color-mix(in srgb, var(--acu-text-3) 55%, transparent) transparent;');
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} ::-webkit-scrollbar-thumb`);
    expect(style1!.textContent).toContain('background: color-mix(in srgb, var(--acu-accent) 62%, var(--acu-text-3));');
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} :is(.acu-input, .acu-textarea)::placeholder`);
    expect(style1!.textContent).toContain('-webkit-text-fill-color: var(--acu-text-3) !important;');
    expect(style1!.textContent).toContain('opacity: 1 !important;');
    expect(style1!.textContent).toContain(`#${APP_ROOT_ID} :is(.fa, .fas, .far, .fab, .fa-solid, .fa-regular, .fa-brands, [class^="fa-"], [class*=" fa-"])`);
    expect(style1!.textContent).toContain('color: var(--acu-icon-color, currentColor) !important;');

    store.setTheme('default-light');
    m.injector.applyTheme(store.activeTheme);
    const style2 = document.getElementById(STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(style2).toBe(style1); // 同一个节点，textContent 被替换
    expect(style2!.textContent).toContain('#f8f5ee'); // light 的 bg-0

    store.setTheme('creamy-minimal');
    m.injector.applyTheme(store.activeTheme);
    const style3 = document.getElementById(STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(style3).toBe(style1);
    expect(style3!.textContent).toContain('#F7F0E6'); // 奶油风的 bg-0
    expect(style3!.textContent).toContain('#85A76A'); // 奶油风的 accent
    expect(style3!.textContent).toContain('rgba(116, 91, 62, 0.08)'); // 奶油风的 hover overlay
  });

  it('applyTheme 设置根容器 colorScheme', async () => {
    const root = document.createElement('div');
    root.id = APP_ROOT_ID;
    document.body.appendChild(root);

    const m = await freshImport();
    m.pinia.setActivePinia(m.pinia.createPinia());
    const store = m.themeStore.useThemeStore();
    store.setTheme('default-light');
    m.injector.applyTheme(store.activeTheme);
    expect(root.style.colorScheme).toBe('light');

    store.setTheme('default-dark');
    m.injector.applyTheme(store.activeTheme);
    expect(root.style.colorScheme).toBe('dark');
  });
});
