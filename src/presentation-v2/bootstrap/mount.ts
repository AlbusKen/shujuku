/**
 * mount — 把 Vue + Pinia 应用挂载到 host document 的 #acu-app-v2 容器（D15 / D15.1 / D16）
 *
 * 设计要点：
 * - 容器物理隔离于旧 popup（id=acu-app-v2，不复用 #popup）
 * - 容器、所有 SFC <style>、未来主题节点都注入同一个 host document
 * - 应用生命周期：首次打开惰性创建 + mount，后续打开/关闭只切换 display；
 *   根 Vue app 与 Pinia 保留，当前页面组件在重开时由 MainArea key remount。
 */
import type { App as VueApp } from 'vue';
import { createPinia, type Pinia } from 'pinia';
import { logDebug_ACU } from '../../shared/utils';
import { setSfcStyleHost } from '../build/sfc-style-runtime';
import App from '../App.vue';
import { useAppearanceStore } from '../stores/appearance-store';
import { useRootShellStore } from '../stores/root-shell-store';
import { useThemeStore } from '../stores/theme-store';
import { applyAppearance, __resetAppearanceInjectorForTests } from '../theme/appearance-injector';
import { applyTheme } from '../theme/theme-injector';
import { __resetUiCloseGuardsForTests } from '../composables/useUiCloseGuard';
import { __resetToastStoreForTests } from '../stores/toast-store';
import {
  __resetHostDocumentCacheForTests,
  getAcuHostDocument,
  getAcuHostSource,
  getAcuHostWindow,
} from './host-document';
import { createHostDocumentApp, __resetHostRendererForTests } from './host-renderer';

const ROOT_ID = 'acu-app-v2';

interface MountedState {
  vueApp: VueApp;
  pinia: Pinia;
  root: HTMLElement;
}

let state: MountedState | null = null;

function ensureMounted(): MountedState {
  if (state) return state;
  const doc = getAcuHostDocument();
  const hostWindow = getAcuHostWindow();
  const source = getAcuHostSource();
  const hostWidth = Math.round(
    hostWindow.visualViewport?.width ||
      hostWindow.innerWidth ||
      doc.documentElement?.clientWidth ||
      0,
  );

  setSfcStyleHost({ document: doc });

  let root = doc.getElementById(ROOT_ID) as HTMLElement | null;
  if (!root) {
    root = doc.createElement('div');
    root.id = ROOT_ID;
    root.style.display = 'none';
    doc.body.appendChild(root);
  }
  root.setAttribute('data-acu-host-source', source);
  root.setAttribute('data-acu-host-width', String(hostWidth));
  if (hostWidth > 0 && hostWidth <= 240) {
    logDebug_ACU(`[ACU-V2] narrow host detected: source=${source}, width=${hostWidth}px`);
  }

  const pinia = createPinia();
  root.textContent = '';
  // 主题与外观：先应用一次，避免首帧缺少 root token；订阅后续变更。
  const themeStore = useThemeStore(pinia);
  applyTheme(themeStore.activeTheme);
  themeStore.$subscribe(() => applyTheme(themeStore.activeTheme));

  const appearanceStore = useAppearanceStore(pinia);
  applyAppearance(appearanceStore.uiScaleOption);
  appearanceStore.$subscribe(() => applyAppearance(appearanceStore.uiScaleOption));

  const vueApp = createHostDocumentApp(App, {
    onClose: () => closeAcuV2App(),
  }, doc);
  vueApp.use(pinia);
  vueApp.mount(root);
  root.removeAttribute('v-cloak');
  root.setAttribute('data-v-app', '');

  state = { vueApp, pinia, root };
  logDebug_ACU(`[ACU-V2] app mounted into ${source} (id=#${ROOT_ID}, width=${hostWidth}px)`);
  return state;
}

/** 打开新 UI：首次调用执行 mount，后续只切 display + 标记 isOpen。 */
export async function openAcuV2App(): Promise<void> {
  const wasMounted = state !== null;
  const s = ensureMounted();
  s.root.style.display = '';
  const store = useRootShellStore(s.pinia);
  const wasOpen = store.isOpen;
  store.setOpen(true);
  if (wasMounted && !wasOpen) store.requestOpenRefresh();
}

/** 挂载根应用但不打开 shell。聊天页浮卡需要 Vue 根节点存在，即使设置面板仍关闭。 */
export function ensureAcuV2AppMounted(): void {
  ensureMounted();
}

/** Bridge 层在 Vue 组件外访问现有 Pinia；不会主动创建应用。 */
export function getAcuV2PiniaForBridge(): Pinia | null {
  return state?.pinia ?? null;
}

/**
 * 关闭新 UI：保留根 DOM 与 Pinia 状态，仅隐藏容器并请求滚动重置（P0-6 修订）。
 * - 路由：activePageId 留在 store + localStorage，重开后回到原页
 * - 页面：重开后当前页面 remount；用户明确编辑过且需要保留的草稿必须进入 store / settings
 * - 滚动：通过 scrollResetTick 通知 MainArea / 各页 scroll 容器
 */
export function closeAcuV2App(): void {
  if (!state) return;
  state.root.style.display = 'none';
  const store = useRootShellStore(state.pinia);
  store.setOpen(false);
  store.requestScrollReset();
}

/** 仅供测试使用：销毁应用并重置内部状态。 */
export function __resetAcuV2MountForTests(): void {
  if (state) {
    try {
      state.vueApp.unmount();
    } catch {
      /* swallow */
    }
    state.root.parentNode?.removeChild(state.root);
    state = null;
  }
  __resetUiCloseGuardsForTests();
  __resetToastStoreForTests();
  __resetAppearanceInjectorForTests();
  __resetHostDocumentCacheForTests();
  __resetHostRendererForTests();
}
