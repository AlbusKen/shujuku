/**
 * mount.test — D15.1 自动验证：两种 jsdom 场景下挂载点和样式注入位置正确
 *
 * 场景 1（当前文档）：window.parent === window，根节点与样式在当前 document
 * 场景 2（父文档）：mock window.parent 指向另一个 JSDOM，根节点与样式必须
 *                  出现在父 document，且子 document 不残留可见根节点
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { nextTick } from 'vue';

const ROOT_ID = 'acu-app-v2';
const STYLE_DATA_ATTR = 'data-acu-v2-sfc';
const STORAGE_KEY = 'acu_v2_ui_state';
const APPEARANCE_STYLE_NODE_ID = 'acu-v2-appearance';

type MountModule = typeof import('../../../src/presentation-v2/bootstrap/mount');
type HostModule = typeof import('../../../src/presentation-v2/bootstrap/host-document');
type StyleRuntimeModule = typeof import('../../../src/presentation-v2/build/sfc-style-runtime');

async function freshImport(): Promise<{
  mount: MountModule;
  host: HostModule;
  styleRuntime: StyleRuntimeModule;
}> {
  vi.resetModules();
  const [mount, host, styleRuntime] = await Promise.all([
    import('../../../src/presentation-v2/bootstrap/mount'),
    import('../../../src/presentation-v2/bootstrap/host-document'),
    import('../../../src/presentation-v2/build/sfc-style-runtime'),
  ]);
  return { mount, host, styleRuntime };
}

function setParent(parent: any) {
  Object.defineProperty(window, 'parent', {
    value: parent,
    writable: true,
    configurable: true,
  });
}

function persistAdvancedMode(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiMode: { mode: 'advanced' } }));
}

afterEach(() => {
  // jsdom 默认 window.parent === window；测试结束恢复
  setParent(window);
});

describe('mount — 当前文档场景', () => {
  beforeEach(() => {
    setParent(window);
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('window.parent === window 时，根节点和 SFC 样式都注入当前 document', async () => {
    persistAdvancedMode();
    const { mount, host, styleRuntime } = await freshImport();
    expect(host.getAcuHostSource()).toBe('current-document');

    await mount.openAcuV2App();

    const root = document.getElementById(ROOT_ID);
    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);

    // 直接驱动样式运行时，验证 host document 路由（vitest 的 vite 接入会把
    // SFC 真实 <style> 块走 vite 自己的 CSS 管线，绕过 sfc-style-injector，
    // 所以测试在生产路径之外手动触发一次 injectSfcStyle）
    styleRuntime.injectSfcStyle('.acu-v2-test{color:red}', 'mount-test#current');
    const styles = document.head.querySelectorAll(`style[${STYLE_DATA_ATTR}]`);
    expect(styles.length).toBeGreaterThan(0);

    const text = root!.textContent || '';
    expect(text).toContain('SP·数据库 IX');
    // 高手模式默认页是 dashboard，sidebar 有"概览/配置/功能/工具"四组标题
    expect(text).toContain('仪表盘');
    expect(text).toContain('概览');
    expect(text).toContain('配置');
    expect(text).toContain('功能');
    expect(text).toContain('工具');

    mount.__resetAcuV2MountForTests();
  });

  it('打开后再关闭，根节点保留但 display 变 none', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();
    mount.closeAcuV2App();

    const root = document.getElementById(ROOT_ID);
    expect(root).not.toBeNull();
    expect(root!.style.display).toBe('none');

    mount.__resetAcuV2MountForTests();
  });

  it('ensureAcuV2AppMounted 挂载根节点但不打开 shell', async () => {
    persistAdvancedMode();
    const { mount } = await freshImport();
    mount.ensureAcuV2AppMounted();
    const root = document.getElementById(ROOT_ID);
    expect(root).not.toBeNull();
    expect(root!.style.display).toBe('none');
    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    const { useRootShellStore } = await import('../../../src/presentation-v2/stores/root-shell-store');
    expect(useRootShellStore(pinia!).isOpen).toBe(false);
    mount.__resetAcuV2MountForTests();
  });

  it('主题按钮可以打开主题菜单，并在外部点击后关闭', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const themeButton = document.querySelector('.acu-v2-app__theme-btn') as HTMLButtonElement | null;
    expect(themeButton).not.toBeNull();
    expect(themeButton!.classList.contains('acu-icon-btn')).toBe(true);

    themeButton!.click();
    await Promise.resolve();

    const menu = document.querySelector('.acu-v2-app__theme-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain('浅色');
    expect(menu!.textContent).toContain('地雷色');
    expect(menu!.textContent).toContain('界面缩放');
    expect(menu!.querySelector('[title^="内置主题不可删除"]')).toBeNull();

    document.body.click();
    await Promise.resolve();

    expect(menu!.classList.contains('is-closing')).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('外观菜单可以切换界面缩放，并持久化到 appearance section', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const root = document.getElementById(ROOT_ID);
    const style = document.getElementById(APPEARANCE_STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(root).not.toBeNull();
    expect(style).not.toBeNull();
    expect(root!.getAttribute('data-acu-ui-scale')).toBe('100');
    expect(style!.textContent).toContain('--acu-ui-scale: 1;');

    const themeButton = document.querySelector('.acu-v2-app__theme-btn') as HTMLButtonElement | null;
    expect(themeButton).not.toBeNull();
    themeButton!.click();
    await Promise.resolve();

    const menu = document.querySelector('.acu-v2-app__theme-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();
    const scaleButtons = Array.from(
      menu!.querySelectorAll<HTMLButtonElement>('.acu-v2-app__scale-control .acu-segmented__item'),
    );
    const option125 = scaleButtons.find(button => button.textContent?.trim() === '125%');
    expect(option125).not.toBeNull();

    option125!.click();
    await Promise.resolve();

    expect(root!.getAttribute('data-acu-ui-scale')).toBe('125');
    expect(style!.textContent).toContain('--acu-ui-scale: 1.25;');
    expect(style!.textContent).toContain('--acu-font-size-body: 15px;');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      appearance: { uiScale: '125' },
    });
    expect(menu!.textContent).toContain('125%');

    mount.__resetAcuV2MountForTests();
  });

  it('toast layer is teleported to the app root instead of staying inside the shell', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    useToastStore(pinia!).info('手动填表开始。', { durationMs: 0, muteable: false });
    await nextTick();

    const root = document.getElementById(ROOT_ID);
    const shell = document.querySelector<HTMLElement>('.acu-v2-app__shell');
    const viewport = document.querySelector<HTMLElement>('.acu-toast-viewport');
    const list = document.querySelector<HTMLElement>('.acu-toast-viewport__list');

    expect(root).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(list).not.toBeNull();
    expect(viewport!.parentElement).toBe(root);
    expect(shell!.contains(viewport!)).toBe(false);
    expect(viewport!.style.zIndex).toBe('9410');

    mount.__resetAcuV2MountForTests();
  });

  it('汉堡按钮打开移动端导航抽屉，点击页面项后关闭抽屉并切换页面', async () => {
    persistAdvancedMode();
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const menuButton = document.querySelector('.acu-v2-app__menu') as HTMLButtonElement | null;
    expect(menuButton).not.toBeNull();
    expect(menuButton!.classList.contains('acu-icon-btn')).toBe(true);
    expect(menuButton!.getAttribute('aria-expanded')).toBe('false');

    menuButton!.click();
    await Promise.resolve();

    const drawer = document.querySelector<HTMLElement>('.acu-v2-app__mobile-nav');
    expect(drawer).not.toBeNull();
    expect(menuButton!.getAttribute('aria-expanded')).toBe('true');
    expect(drawer!.querySelector('.acu-v2-app__mobile-nav-header')).toBeNull();
    expect(drawer!.textContent).toContain('SP·数据库 IX');
    expect(drawer!.getAttribute('data-acu-mobile-nav-width')).toBe('var(--acu-mobile-nav-width)');
    expect(drawer!.style.width).toBe('var(--acu-mobile-nav-width)');
    expect(drawer!.style.maxWidth).toBe('calc(100% - var(--acu-mobile-nav-edge-gap))');
    expect(drawer!.style.flex).toBe('0 0 var(--acu-mobile-nav-width)');

    const formFillButton = drawer!.querySelector('[data-page-id="form-fill"]') as HTMLButtonElement | null;
    expect(formFillButton).not.toBeNull();
    formFillButton!.click();
    await Promise.resolve();

    const layer = document.querySelector('.acu-v2-app__mobile-nav-layer');
    expect(layer?.classList.contains('is-closing')).toBe(true);
    expect(menuButton!.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent?.trim()).toBe('填表工作台');

    mount.__resetAcuV2MountForTests();
  });

  it('移动端导航抽屉通过遮罩 click 关闭并避免穿透底层控件', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const menuButton = document.querySelector('.acu-v2-app__menu') as HTMLButtonElement | null;
    expect(menuButton).not.toBeNull();

    menuButton!.click();
    await Promise.resolve();

    const layer = document.querySelector('.acu-v2-app__mobile-nav-layer') as HTMLElement | null;
    expect(layer).not.toBeNull();
    expect(menuButton!.getAttribute('aria-expanded')).toBe('true');

    layer!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(menuButton!.getAttribute('aria-expanded')).toBe('false');
    expect(layer!.classList.contains('is-closing')).toBe(true);

    mount.__resetAcuV2MountForTests();
  });
});

describe('mount — 父文档场景（iframe 模拟）', () => {
  let parentDom: JSDOM;

  beforeEach(() => {
    parentDom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    setParent(parentDom.window);
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => {
    parentDom.window.close();
  });

  it('window.parent !== window 且可访问 parent.document 时，根节点出现在父文档', async () => {
    const { mount, host, styleRuntime } = await freshImport();
    expect(host.getAcuHostSource()).toBe('parent-document');
    expect(host.getAcuHostDocument()).toBe(parentDom.window.document);

    await mount.openAcuV2App();

    const parentRoot = parentDom.window.document.getElementById(ROOT_ID);
    expect(parentRoot).not.toBeNull();
    expect(parentRoot!.parentElement).toBe(parentDom.window.document.body);
    expect(parentRoot!.getAttribute('data-acu-host-source')).toBe('parent-document');

    const childRoot = document.getElementById(ROOT_ID);
    expect(childRoot).toBeNull();

    // 模拟 SFC <style> 通过运行时注入，验证落点是父文档而不是子文档
    styleRuntime.injectSfcStyle('.acu-v2-test{color:blue}', 'mount-test#parent');
    const parentStyles = parentDom.window.document.head.querySelectorAll(
      `style[${STYLE_DATA_ATTR}]`,
    );
    expect(parentStyles.length).toBeGreaterThan(0);
    const childStyles = document.head.querySelectorAll(
      `style[${STYLE_DATA_ATTR}]`,
    );
    expect(childStyles.length).toBe(0);

    mount.__resetAcuV2MountForTests();
  });

  it('嵌套 iframe 时选择可访问链路中最外层宿主文档', async () => {
    const narrowParent = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    const wideTop = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    Object.defineProperty(narrowParent.window, 'innerWidth', { value: 184, configurable: true });
    Object.defineProperty(narrowParent.window, 'innerHeight', { value: 720, configurable: true });
    Object.defineProperty(wideTop.window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(wideTop.window, 'innerHeight', { value: 768, configurable: true });
    Object.defineProperty(narrowParent.window, 'parent', {
      value: wideTop.window,
      configurable: true,
    });
    setParent(narrowParent.window);

    const { mount, host } = await freshImport();
    expect(host.getAcuHostSource()).toBe('parent-document');
    expect(host.getAcuHostDocument()).toBe(wideTop.window.document);

    await mount.openAcuV2App();

    expect(wideTop.window.document.getElementById(ROOT_ID)).not.toBeNull();
    expect(narrowParent.window.document.getElementById(ROOT_ID)).toBeNull();
    expect(document.getElementById(ROOT_ID)).toBeNull();

    mount.__resetAcuV2MountForTests();
    narrowParent.window.close();
    wideTop.window.close();
  });

  it('嵌套 iframe 时即使最外层视口指标为 0，也选择最外层可访问文档', async () => {
    const narrowParent = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    const outerTop = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    Object.defineProperty(narrowParent.window, 'innerWidth', { value: 184, configurable: true });
    Object.defineProperty(narrowParent.window, 'innerHeight', { value: 720, configurable: true });
    Object.defineProperty(outerTop.window, 'innerWidth', { value: 0, configurable: true });
    Object.defineProperty(outerTop.window, 'innerHeight', { value: 0, configurable: true });
    Object.defineProperty(narrowParent.window, 'parent', {
      value: outerTop.window,
      configurable: true,
    });
    setParent(narrowParent.window);

    const { mount, host } = await freshImport();
    expect(host.getAcuHostDocument()).toBe(outerTop.window.document);

    await mount.openAcuV2App();

    expect(outerTop.window.document.getElementById(ROOT_ID)).not.toBeNull();
    expect(narrowParent.window.document.getElementById(ROOT_ID)).toBeNull();

    mount.__resetAcuV2MountForTests();
    narrowParent.window.close();
    outerTop.window.close();
  });

  it('父文档挂载时，Vue 创建的表单控件属于父文档 realm', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      uiMode: { mode: 'advanced' },
      router: { activePageId: 'api' },
    }));

    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    void useDialogStore(pinia!).prompt({
      title: '测试输入框',
      message: '用于确认父文档挂载节点的 realm。',
      label: '名称',
      requireNonEmpty: false,
    });
    await nextTick();

    const parentDoc = parentDom.window.document;
    const input = parentDoc.querySelector('input.acu-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.ownerDocument).toBe(parentDoc);
    expect(input!).toBeInstanceOf(parentDom.window.HTMLInputElement);
    expect(input!).not.toBeInstanceOf(window.HTMLInputElement);

    mount.__resetAcuV2MountForTests();
  });

  it('父文档挂载时，主题菜单响应父文档外部点击关闭', async () => {
    const { mount } = await freshImport();

    await mount.openAcuV2App();

    const parentDoc = parentDom.window.document;
    const themeButton = parentDoc.querySelector('.acu-v2-app__theme-btn') as HTMLButtonElement | null;
    expect(themeButton).not.toBeNull();

    themeButton!.click();
    await Promise.resolve();

    const menu = parentDoc.querySelector('.acu-v2-app__theme-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();

    parentDoc.body.dispatchEvent(new parentDom.window.Event('pointerdown', { bubbles: true }));
    await Promise.resolve();

    expect(menu!.classList.contains('is-closing')).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('父文档不可访问时降级到当前文档（getter 抛错）', async () => {
    setParent({
      get document() {
        throw new Error('SecurityError: cross-origin');
      },
    });

    const { mount, host } = await freshImport();
    expect(host.getAcuHostSource()).toBe('current-document');

    await mount.openAcuV2App();

    expect(document.getElementById(ROOT_ID)).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });
});
