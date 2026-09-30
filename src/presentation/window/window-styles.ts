/**
 * presentation/window/window-styles.ts — 窗口样式注入 + 主题切换
 * 从 window-system.ts 拆出
 * 
 * 注意：旧版 ink/silk 主题切换已迁移到 theme/theme-registry.ts
 * 此文件保留窗口chrome样式和旧接口兼容
 */
import { getConfigStorage_ACU } from '../../service/settings/settings-service';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';

  const ACU_WINDOW_STYLES_INJECTED_FLAG = `${SCRIPT_ID_PREFIX_ACU}_window_styles_injected`;
  const ACU_UI_THEME_STORAGE_KEY = `${SCRIPT_ID_PREFIX_ACU}_ui_theme_v1`;

  /**
   * 获取当前主题（兼容旧接口）
   * 现在读取新主题系统的设置
   */
  export function getACUTheme_ACU() {
    try {
      const store = getConfigStorage_ACU();
      const savedTheme = String(store?.getItem?.(ACU_UI_THEME_STORAGE_KEY) || '').trim();
      // 支持旧版 ink/silk 值，也支持新主题 ID
      if (savedTheme === 'silk' || savedTheme === 'classical-silk') return 'silk';
      if (savedTheme === 'ink' || savedTheme === 'classical-ink') return 'ink';
      if (savedTheme === 'default-dark') return 'ink';
      // 默认浅色
      return 'silk';
    } catch (e) {
      return 'silk';
    }
  }

  export function setACUTheme_ACU(theme: string) {
    const normalizedTheme = theme === 'silk' ? 'silk' : 'ink';
    try {
      const store = getConfigStorage_ACU();
      store?.setItem?.(ACU_UI_THEME_STORAGE_KEY, normalizedTheme);
    } catch (e) {
      console.warn('[ACU] Failed to persist UI theme:', e);
    }
    return normalizedTheme;
  }

  export function applyACUThemeToDocument_ACU(targetDoc: Document | null, theme: string | null = null) {
    const doc = targetDoc || (topLevelWindow_ACU?.document || document);
    // 不再通过 body class 切换主题，主题变量已通过 theme-registry 注入到 #popup
    const body = doc?.body;
    if (!body || !body.classList) return getACUTheme_ACU();
    return getACUTheme_ACU();
  }

  export function syncACUThemeButtons_ACU(targetDoc: Document | null) {
    // 窗口chrome的主题切换按钮已被新的 theme-selector 替代
    // 此函数保留空实现以兼容旧调用点
    return getACUTheme_ACU();
  }

  export function toggleACUTheme_ACU(targetDoc: Document | null) {
    // 旧版切换逻辑保留但不再影响弹窗内容
    const nextTheme = getACUTheme_ACU() === 'silk' ? 'ink' : 'silk';
    setACUTheme_ACU(nextTheme);
    return nextTheme;
  }

  export function injectACUWindowStyles() {
    // 始终往酒馆主窗口注入样式
    const targetWin = topLevelWindow_ACU || window;
    const targetDoc = targetWin.document;
    
    if ((targetWin as any)[ACU_WINDOW_STYLES_INJECTED_FLAG]) return;
    (targetWin as any)[ACU_WINDOW_STYLES_INJECTED_FLAG] = true;
    
    const css = `
      /* ═══════════════════════════════════════════════════════════════
         龙血玄黄·数据库 独立窗口系统
         古卷双主题：墨色 / 素纱
         ═══════════════════════════════════════════════════════════════ */
      
      .acu-window-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: var(--acu-overlay-bg, rgba(0, 0, 0, 0.16));
        backdrop-filter: blur(var(--acu-overlay-backdrop-blur, 3px));
        -webkit-backdrop-filter: blur(var(--acu-overlay-backdrop-blur, 3px));
        z-index: 9999;
        animation: acuOverlayFadeIn 0.24s ease-out;
      }
      @keyframes acuOverlayFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .acu-window {
        --acu-panel-bg: var(--acu-bg-0, #f5f7fa);
        --acu-panel-border: var(--acu-border, #e0e4ea);
        --acu-panel-text: var(--acu-text-1, #1a2332);
        --acu-panel-text-dim: var(--acu-text-2, #4a5568);
        --acu-panel-text-mute: var(--acu-text-3, #8896a8);
        --acu-panel-accent: var(--acu-accent, #2563eb);
        --acu-panel-hover: var(--acu-bg-2, rgba(0, 0, 0, 0.03));
        --acu-panel-shadow: var(--acu-shadow, 0 1px 3px rgba(0, 0, 0, 0.06));
        --acu-panel-close-hover-bg: var(--acu-danger-soft-bg, rgba(239, 68, 68, 0.08));
        --acu-panel-close-hover-border: var(--acu-danger-soft-border, rgba(239, 68, 68, 0.25));
        --acu-panel-close-hover-text: var(--acu-danger, #ef4444);
        position: fixed;
        display: flex;
        flex-direction: column;
        background-color: var(--acu-panel-bg);
        border: 1px solid var(--acu-panel-border);
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        overflow: hidden;
        min-width: 400px;
        min-height: 300px;
        animation: acuWindowSlideIn 0.22s ease-out;
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-weight: 500;
        color: var(--acu-panel-text);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
      }
      @keyframes acuWindowSlideIn {
        from { opacity: 0; transform: scale(0.97) translateY(-14px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      
      .acu-window.maximized {
        top: 10px !important;
        left: 10px !important;
        width: calc(100vw - 20px) !important;
        height: calc(100vh - 20px) !important;
        border-radius: 12px;
      }
      
      /* 窄屏模式下全屏时减小边距，确保头部完全可见 */
      @media screen and (max-width: 1100px) {
        .acu-window.maximized {
          top: 5px !important;
          left: 5px !important;
          width: calc(100vw - 10px) !important;
          height: calc(100vh - 10px) !important;
          border-radius: 8px;
        }
        .acu-window-header {
          padding: 10px 12px;
        }
        .acu-window-controls {
          gap: 6px;
          margin-right: 0; /* 窄屏模式下关闭按钮靠右 */
        }
        .acu-window-btn {
          width: 32px;
          height: 32px;
        }
        .acu-window {
          min-width: 320px; /* 窄屏下允许更小的最小宽度 */
        }
      }
      
      /* 超窄屏模式下全屏时进一步优化 */
      @media screen and (max-width: 768px) {
        .acu-window.acu-window-phone-fullscreen,
        .acu-window.acu-window-phone-fullscreen.maximized {
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          width: 100dvw !important;
          height: 100vh !important;
          height: 100dvh !important;
          min-width: 100vw !important;
          min-width: 100dvw !important;
          min-height: 100vh !important;
          min-height: 100dvh !important;
          max-width: 100vw !important;
          max-width: 100dvw !important;
          max-height: 100vh !important;
          max-height: 100dvh !important;
          border-radius: 0 !important;
          border: none !important;
          box-shadow: none !important;
        }
        .acu-window {
          min-width: min(320px, calc(100vw - 12px)) !important; /* 手机端保留边距，避免遮挡底层界面 */
          min-height: min(360px, calc(100dvh - 12px)) !important;
          max-width: calc(100vw - 12px) !important;
          max-height: calc(100vh - 12px) !important;
          max-height: calc(100dvh - 12px) !important; /* 使用动态视口高度，避免移动浏览器地址栏问题 */
        }
        .acu-window.maximized {
          top: 6px !important;
          left: 6px !important;
          width: calc(100vw - 12px) !important;
          height: calc(100vh - 12px) !important;
          height: calc(100dvh - 12px) !important; /* 优先使用动态视口高度 */
          max-width: calc(100vw - 12px) !important;
          max-height: calc(100vh - 12px) !important;
          max-height: calc(100dvh - 12px) !important;
          border-radius: 10px;
          border: 1px solid var(--acu-panel-border);
        }
        .acu-window-header {
          padding: 8px 10px;
          min-height: 44px; /* 确保头部高度足够 */
          flex-shrink: 0;
        }
        .acu-window-controls {
          margin-right: 0; /* 超窄屏模式下关闭按钮靠右 */
        }
        .acu-window-title {
          font-size: 13px;
        }
        .acu-window-btn {
          width: 36px;
          height: 36px;
          font-size: 16px;
        }
        .acu-window-body {
          max-width: 100vw;
          overflow-x: hidden;
          overflow-y: auto;
          /* 确保body能正确滚动，使用flex布局撑满剩余空间 */
          flex: 1 1 0;
          min-height: 0; /* 关键：允许flex子元素收缩 */
        }
        .acu-window.acu-window-phone-fullscreen .acu-window-body {
          flex: 1 1 auto;
          min-height: 0;
          height: auto;
          max-height: none;
          overflow-x: hidden;
          overflow-y: auto;
        }
      }
      
      /* 极窄屏模式（≤480px）进一步压缩 */
      @media screen and (max-width: 480px) {
        .acu-window-header {
          padding: 6px 8px;
          min-height: 40px;
        }
        .acu-window-title {
          font-size: 12px;
          gap: 6px;
        }
        .acu-window-title i {
          font-size: 14px;
        }
        .acu-window-btn {
          width: 32px;
          height: 32px;
          font-size: 14px;
        }
        .acu-window-controls {
          gap: 4px;
          margin-right: 0; /* 极窄屏模式下关闭按钮靠右 */
        }
      }
      
      /* 超小屏模式（≤360px）最小化头部占用 */
      @media screen and (max-width: 360px) {
        .acu-window-header {
          padding: 4px 6px;
          min-height: 36px;
        }
        .acu-window-title {
          font-size: 11px;
          gap: 4px;
        }
        .acu-window-title i {
          font-size: 12px;
        }
        .acu-window-btn {
          width: 28px;
          height: 28px;
          font-size: 12px;
          border-radius: 6px;
        }
        .acu-window-controls {
          margin-right: 0; /* 超小屏模式下关闭按钮靠右 */
        }
      }
      
      .acu-window-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: transparent;
        border-bottom: 1px solid var(--acu-panel-border);
        cursor: move;
        user-select: none;
        flex-shrink: 0;
      }
      
      .acu-window-title {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.5px;
        color: var(--acu-panel-text);
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      .acu-window-title i {
        color: var(--acu-panel-accent);
        flex-shrink: 0;
      }
      .acu-window-title span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .acu-window-controls {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
        margin-left: 8px;
      }
      
      .acu-window-btn {
        width: 28px;
        height: 28px;
        border: 1px solid transparent !important;
        border-radius: 6px;
        background: transparent !important;
        color: var(--acu-panel-text-mute);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        box-shadow: none !important;
      }
      .acu-window-btn:hover {
        background: var(--acu-panel-hover) !important;
        border-color: var(--acu-panel-border) !important;
        color: var(--acu-panel-text);
        box-shadow: none !important;
      }
      .acu-window-btn.maximize:hover {
        color: var(--acu-panel-accent);
      }
      .acu-window-btn.close:hover {
        background: var(--acu-panel-close-hover-bg) !important;
        border-color: var(--acu-panel-close-hover-border) !important;
        color: var(--acu-panel-close-hover-text);
        box-shadow: none !important;
      }
      .acu-window-btn.theme-toggle {
        width: auto;
        min-width: 58px;
        padding: 0 10px;
        font-size: 11px;
        letter-spacing: 1px;
      }
      .acu-theme-toggle-text {
        display: inline-block;
        line-height: 1;
        transform: translateY(-0.5px);
      }
      
      .acu-window-body {
        flex: 1 1 0;
        min-height: 0; /* 关键：允许flex子元素收缩到小于内容高度 */
        overflow: auto;
        overflow-x: hidden;
        padding: 0;
        /* 确保内容不会撑破容器 */
        display: flex;
        flex-direction: column;
      }
      
      /* 窗口body内的内容容器 */
      .acu-window-body > * {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        box-sizing: border-box;
      }
      
      /* 窗口大小调整手柄 */
      .acu-window-resize-handle {
        position: absolute;
        background: transparent;
      }
      .acu-window-resize-handle.se {
        right: 0; bottom: 0;
        width: 20px; height: 20px;
        cursor: se-resize;
      }
      .acu-window-resize-handle.se::after {
        content: '';
        position: absolute;
        right: 4px; bottom: 4px;
        width: 10px; height: 10px;
        border-right: 2px solid var(--acu-panel-border);
        border-bottom: 2px solid var(--acu-panel-border);
        opacity: 0.72;
      }
      .acu-window-resize-handle.e {
        right: 0; top: 40px; bottom: 20px;
        width: 6px;
        cursor: e-resize;
      }
      .acu-window-resize-handle.s {
        left: 20px; right: 20px; bottom: 0;
        height: 6px;
        cursor: s-resize;
      }
      .acu-window-resize-handle.w {
        left: 0; top: 40px; bottom: 20px;
        width: 6px;
        cursor: w-resize;
      }
      .acu-window-resize-handle.n {
        left: 20px; right: 20px; top: 0;
        height: 6px;
        cursor: n-resize;
      }
      .acu-window-resize-handle.nw {
        left: 0; top: 0;
        width: 20px; height: 20px;
        cursor: nw-resize;
      }
      .acu-window-resize-handle.ne {
        right: 0; top: 0;
        width: 20px; height: 20px;
        cursor: ne-resize;
      }
      .acu-window-resize-handle.sw {
        left: 0; bottom: 0;
        width: 20px; height: 20px;
        cursor: sw-resize;
      }
    `;
    
    const style = targetDoc.createElement('style');
    style.id = `${SCRIPT_ID_PREFIX_ACU}-window-styles`;
    style.textContent = css;
    (targetDoc.head || targetDoc.documentElement).appendChild(style);
  }
