/**
 * presentation-v2/bootstrap — 新 UI 启动入口
 *
 * 由 src/index.ts / src/entry-extension.ts / src/entry-extension-plus-assistantembedded.ts
 * 在旧 UI 启动之后调用。
 *
 * 注册"打开新 UI"菜单按钮；点击时惰性挂载 Vue 应用。
 */
import { registerUiSurface_ACU, type UiToastPayload_ACU } from '../../shared/ui-surface-registry';
import { topLevelWindow_ACU } from '../../shared/env';
import { logWarn_ACU } from '../../shared/utils';
import { registerAcuV2MenuButton } from './menu-button';
import { ensureAcuV2AppMounted, getAcuV2PiniaForBridge } from './mount';
import { useRootShellStore } from '../stores/root-shell-store';
import { useToastStore } from '../stores/toast-store';
import {
  installAutoCardUpdaterV2Api_ACU,
  openAcuV2Shell_ACU,
  openVisualizerSurface_ACU,
  requestVisualizerExternalRefresh_ACU,
  isVisualizerSurfaceActive_ACU,
} from '../surfaces/visualizer/open-visualizer-surface';

export { openAcuV2App, closeAcuV2App, ensureAcuV2AppMounted } from './mount';
export { openVisualizerSurface_ACU } from '../surfaces/visualizer/open-visualizer-surface';

/**
 * showToast 实现：V2 shell 已挂载且打开时走 Pinia toast-store（可携带
 * "打开数据管理"等 action）；否则回退宿主 toastr；再不可用只记日志。
 * 绝不抛错——toast 通道不允许反向破坏调用方（加载/合并）流程。
 */
function showAcuV2Toast_ACU(payload: UiToastPayload_ACU): void {
  try {
    const pinia = getAcuV2PiniaForBridge();
    if (pinia) {
      const shell = useRootShellStore(pinia);
      if (shell.isOpen) {
        useToastStore(pinia).notify(payload.kind, payload.text, {
          muteable: false,
          ...(payload.action ? {
            action: {
              label: payload.action.label,
              onClick: payload.action.onClick,
            },
          } : {}),
        });
        return;
      }
    }
  } catch (error) {
    logWarn_ACU('[ACU-V2] toast-store 通道不可用，回退宿主 toastr:', error);
  }
  try {
    const toastr = (topLevelWindow_ACU as any)?.toastr;
    if (toastr && typeof toastr[payload.kind] === 'function') {
      toastr[payload.kind](payload.text, undefined, payload.action
        ? { onclick: () => { void payload.action!.onClick(); } }
        : undefined);
      return;
    }
  } catch (_) {
    // 宿主 toastr 不可用时落到下方日志。
  }
  logWarn_ACU(`[ACU toast:${payload.kind}] ${payload.text}`);
}

export function bootstrapAcuV2(): void {
  registerUiSurface_ACU({
    openSettings: openAcuV2Shell_ACU,
    openVisualizer: () => openVisualizerSurface_ACU({ source: 'external-api' }),
    refreshVisualizer: requestVisualizerExternalRefresh_ACU,
    isVisualizerActive: isVisualizerSurfaceActive_ACU,
    showToast: showAcuV2Toast_ACU,
  });
  installAutoCardUpdaterV2Api_ACU();
  registerAcuV2MenuButton();
  ensureAcuV2AppMounted();
}
