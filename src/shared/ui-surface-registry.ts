import { notify_ACU } from './notice-hub';

export interface UiToastAction_ACU {
    label: string;
    onClick: () => void | Promise<void>;
}

export interface UiToastPayload_ACU {
    kind: 'info' | 'success' | 'warning' | 'error';
    text: string;
    action?: UiToastAction_ACU;
}

export interface UiSurfaceHandlers_ACU {
    openSettings: () => Promise<boolean>;
    openVisualizer: () => Promise<boolean>;
    refreshVisualizer: () => Promise<void>;
    isVisualizerActive?: () => boolean;
    /** 可选 toast 通道：非 Vue 上下文（service/legacy presentation）经此向用户可见化提示。 */
    showToast?: (payload: UiToastPayload_ACU) => void;
}

let registeredUiSurface_ACU: UiSurfaceHandlers_ACU | null = null;

export function registerUiSurface_ACU(handlers: UiSurfaceHandlers_ACU): void {
    registeredUiSurface_ACU = handlers;
}

export function getUiSurface_ACU(): UiSurfaceHandlers_ACU | null {
    return registeredUiSurface_ACU;
}

/**
 * 统一 toast 入口：优先走已注册 UI surface 的 showToast；未注册或抛错时
 * 直接交给通知汇流口（浮动气泡）。绝不抛错。
 */
export function showUiSurfaceToast_ACU(payload: UiToastPayload_ACU): void {
    try {
        const handler = registeredUiSurface_ACU?.showToast;
        if (handler) {
            handler(payload);
            return;
        }
    } catch (_) {
        // 已注册 handler 抛错时继续走汇流口。
    }
    try {
        notify_ACU(payload.kind, payload.text, payload.action
            ? { actions: [{ label: payload.action.label, run: payload.action.onClick }] }
            : {});
    } catch (_) {
        // 提示通道不可用：静默，不让提示通道反过来破坏调用方流程。
    }
}

export function resetUiSurfaceRegistryForTests_ACU(): void {
    registeredUiSurface_ACU = null;
}
