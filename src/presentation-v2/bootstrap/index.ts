/**
 * presentation-v2/bootstrap — 新 UI 启动入口
 *
 * 由 src/index.ts / src/entry-extension.ts / src/entry-extension-plus-assistantembedded.ts
 * 在旧 UI 启动之后调用。
 *
 * 注册"打开新 UI"菜单按钮；点击时惰性挂载 Vue 应用。
 */
import { registerUiSurface_ACU, type UiToastPayload_ACU } from '../../shared/ui-surface-registry';
import { notify_ACU } from '../../shared/notice-hub';
import { logWarn_ACU } from '../../shared/utils';
import { registerAcuV2MenuButton } from './menu-button';
import { ensureAcuV2AppMounted } from './mount';
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
 * showToast 实现：统一交给通知汇流口，由常驻浮动气泡呈现（设置面板关闭时同样可见），
 * 可携带"打开数据管理"等 action。绝不抛错——提示通道不允许反向破坏调用方（加载/合并）流程。
 */
function showAcuV2Toast_ACU(payload: UiToastPayload_ACU): void {
  try {
    notify_ACU(payload.kind, payload.text, payload.action
      ? { actions: [{ label: payload.action.label, run: payload.action.onClick }] }
      : {});
  } catch (error) {
    logWarn_ACU(`[ACU toast:${payload.kind}] ${payload.text}`, error);
  }
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
