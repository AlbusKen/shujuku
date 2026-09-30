/**
 * presentation/pages/main-popup-styles.ts
 * 主弹窗样式定义
 * 从 main-popup.ts 拆出的 CSS 模板字符串
 */
import { POPUP_ID_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

export const MAIN_POPUP_CSS_ACU = `
                    /* ═══════════════════════════════════════════════════════════════
                       龙血玄黄·数据库 UI 设计系统（仅影响插件自身）
                       目标：大气、简约、高级；超窄屏也能舒服用
                       ═══════════════════════════════════════════════════════════════ */

                    /* 基础隔离：尽量不吃外部样式（但不使用 all: initial，避免破坏第三方组件） */
                    #${POPUP_ID_ACU}, #${POPUP_ID_ACU} * { box-sizing: border-box; }
                    #${POPUP_ID_ACU} { color-scheme: light; }

                    #${POPUP_ID_ACU} {
                        /* 主题色：浅色管理台 + 蓝色主强调（细边框、弱阴影、卡片化） */
                        --acu-bg-0: #f5f7fa;
                        --acu-bg-1: #ffffff;
                        --acu-bg-2: rgba(0, 0, 0, 0.03);
                        --acu-bg-3: rgba(0, 0, 0, 0.05);
                        --acu-border: #e0e4ea;
                        --acu-border-2: #c8cdd5;

                        --acu-text-1: #1a2332;
                        --acu-text-2: #4a5568;
                        --acu-text-3: #8896a8;

                        --acu-accent: #2563eb;
                        --acu-accent-2: #3b82f6;
                        --acu-accent-glow: rgba(37, 99, 235, 0.12);
                        --acu-accent-glow-2: rgba(59, 130, 246, 0.10);

                        --acu-success: #10b981;
                        --acu-warning: #f59e0b;
                        --acu-danger: #ef4444;

                        --acu-radius-lg: 10px;
                        --acu-radius-md: 8px;
                        --acu-radius-sm: 6px;

                        --acu-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);

                        /* 兼容旧 inline style 里使用的变量名（避免依赖外部主题） */
                        --bg-primary: var(--acu-bg-0);
                        --bg-secondary: var(--acu-bg-1);
                        --background_light: rgba(0, 0, 0, 0.02);
                        --background_default: #ffffff;
                        --background-color-light: rgba(0, 0, 0, 0.02);
                        --input-background: #ffffff;
                        --input-text-color: var(--acu-text-1);
                        --text-main: var(--acu-text-1);
                        --text_primary: var(--acu-text-1);
                        --text_secondary: var(--acu-text-2);
                        --text_tertiary: var(--acu-text-3);
                        --text-color: var(--acu-text-1);
                        --text-color-dimmed: var(--acu-text-3);
                        --border_color: var(--acu-border);
                        --border_color_light: var(--acu-border);
                        --border-normal: var(--acu-border-2);
                        --warning-color: var(--acu-warning);
                        --error-color: var(--acu-danger);
                        --button-background: #ffffff;
                        --button-secondary-background: #f8f9fb;
                        --green: var(--acu-success);
                        --orange: var(--acu-warning);
                        --red: var(--acu-danger);
                        --accent-primary: var(--acu-accent);

                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "HarmonyOS Sans SC", "MiSans", Roboto, Helvetica, Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.6;
                        color: var(--acu-text-1);
                        width: 100%;
                        max-width: 100vw;
                        height: 100%;
                        box-sizing: border-box;
                        overflow-x: hidden;
                        overflow-y: auto;
                        padding: 14px;
                        padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
                        background: var(--acu-bg-0);
                    }

                    /* 防横向溢出兜底：任何子元素都不应把容器撑出屏幕 */
                    #${POPUP_ID_ACU} * { max-width: 100%; }
                    #${POPUP_ID_ACU} .acu-layout,
                    #${POPUP_ID_ACU} .acu-main,
                    #${POPUP_ID_ACU} .acu-tab-content,
                    #${POPUP_ID_ACU} .acu-card,
                    #${POPUP_ID_ACU} .acu-tabs-nav { min-width: 0; }

                    /* 顶部标题条 */
                    #${POPUP_ID_ACU} .acu-header {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 12px;
                        padding: 14px 18px;
                        border: 1px solid var(--acu-border);
                        border-radius: 8px;
                        background: linear-gradient(135deg, var(--acu-bg-1) 0%, var(--acu-bg-0) 100%);
                        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
                    }
                    /* 顶部标题块居中（宽屏/窄屏一致） */
                    #${POPUP_ID_ACU} .acu-header > div {
                        width: 100%;
                        text-align: center;
                    }

                    #${POPUP_ID_ACU} h2#updater-main-title-acu {
                        margin: 0;
                        padding: 0;
                        border: none;
                        font-size: 15px;
                        line-height: 1.4;
                        font-weight: 600;
                        letter-spacing: 0.5px;
                        color: var(--acu-text-1);
                        text-align: center;
                        width: 100%;
                    }

                    #${POPUP_ID_ACU} .acu-header-sub {
                        margin-top: 4px;
                        font-size: 12px;
                        color: var(--acu-text-3);
                        text-align: center;
                    }

                    #${POPUP_ID_ACU} .acu-layout {
                        display: grid;
                        grid-template-columns: 200px minmax(0, 1fr);
                        gap: 14px;
                        margin-top: 14px;
                        min-height: 0;
                    }

                    /* ═══ 导航：精致侧边栏 ═══ */
                    #${POPUP_ID_ACU} .acu-tabs-nav {
                        border: 1px solid var(--acu-border);
                        border-radius: 8px;
                        background: var(--acu-bg-1);
                        padding: 8px;
                        display: flex;
                        flex-direction: column;
                        gap: 2px;
                        position: sticky;
                        top: 0;
                        align-self: start;
                        max-height: calc(100vh - 180px);
                        overflow: auto;
                        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
                    }

                    #${POPUP_ID_ACU} .acu-nav-section-title {
                        padding: 8px 10px 3px 10px;
                        color: var(--acu-text-3);
                        font-size: 10px;
                        letter-spacing: 1px;
                        text-transform: uppercase;
                        user-select: none;
                        font-weight: 600;
                    }

                    #${POPUP_ID_ACU} .acu-tab-button {
                        width: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        padding: 8px 10px;
                        border: 1px solid transparent;
                        border-radius: 6px;
                        background: transparent;
                        color: var(--acu-text-3);
                        font-size: 12.5px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.15s ease;
                    }
                    #${POPUP_ID_ACU} .acu-tab-button:hover {
                        background: var(--acu-bg-2);
                        border-color: var(--acu-border);
                        color: var(--acu-text-1);
                    }
                    #${POPUP_ID_ACU} .acu-tab-button.active {
                        background: var(--acu-accent-glow);
                        border-color: var(--acu-accent);
                        color: var(--acu-accent);
                        font-weight: 600;
                        box-shadow: inset 0 0 0 0.5px var(--acu-accent-glow-2);
                    }
                    #${POPUP_ID_ACU} .acu-tab-button::after {
                        content: "›";
                        opacity: 0;
                        font-weight: 700;
                        transition: opacity 0.15s ease;
                    }
                    #${POPUP_ID_ACU} .acu-tab-button:hover::after { opacity: 0.4; }
                    #${POPUP_ID_ACU} .acu-tab-button.active::after { opacity: 0.8; color: var(--acu-accent); }

                    /* 内容区 */
                    #${POPUP_ID_ACU} .acu-main {
                        min-width: 0;
                        min-height: 0; /* 允许在flex布局中收缩 */
                        overflow: visible; /* 让滚动在父容器处理 */
                    }

                    #${POPUP_ID_ACU} .acu-tab-content { display: none; }
                    #${POPUP_ID_ACU} .acu-tab-content.active { display: block; animation: acuFadeUp 160ms ease-out; }
                    @keyframes acuFadeUp {
                        from { opacity: 0; transform: translateY(6px); }
                        to { opacity: 1; transform: translateY(0); }
                    }

                    /* ═══ 卡片：典雅轻薄 ═══ */
                    #${POPUP_ID_ACU} .acu-card {
                        border: 1px solid var(--acu-border);
                        border-radius: 8px;
                        background: var(--acu-bg-1);
                        padding: 16px;
                        margin-bottom: 14px;
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
                    }
                    #${POPUP_ID_ACU} .acu-card h3 {
                        margin: 0 0 12px 0;
                        padding: 0 0 10px 0;
                        border-bottom: 1px solid var(--acu-border);
                        font-size: 13px;
                        letter-spacing: 0.3px;
                        font-weight: 600;
                        color: var(--acu-text-1);
                    }

                    /* 网格 */
                    #${POPUP_ID_ACU} .acu-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
                    #${POPUP_ID_ACU} .acu-grid-2x2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

                    /* 表单 */
                    #${POPUP_ID_ACU} label {
                        display: block;
                        margin-bottom: 6px;
                        color: var(--acu-text-2);
                        font-size: 12px;
                        font-weight: 500;
                    }
                    #${POPUP_ID_ACU} input,
                    #${POPUP_ID_ACU} select,
                    #${POPUP_ID_ACU} textarea {
                        width: 100% !important;
                        padding: 8px 12px !important;
                        border-radius: 6px !important;
                        border: 1px solid var(--acu-border-2) !important;
                        background: var(--acu-control-bg, var(--input-background, var(--acu-bg-1))) !important;
                        color: var(--acu-control-text, var(--input-text-color, var(--acu-text-1))) !important;
                        font-size: 14px !important;
                        font-family: inherit !important;
                        outline: none !important;
                        line-height: 1.5 !important;
                        box-shadow: none !important;
                        transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
                    }
                    #${POPUP_ID_ACU} select {
                        appearance: none !important;
                        -webkit-appearance: none !important;
                        background-image:
                            linear-gradient(45deg, transparent 50%, var(--acu-select-arrow, var(--acu-text-2)) 50%),
                            linear-gradient(135deg, var(--acu-select-arrow, var(--acu-text-2)) 50%, transparent 50%) !important;
                        background-position:
                            calc(100% - 16px) calc(50% - 2px),
                            calc(100% - 10px) calc(50% - 2px) !important;
                        background-size: 6px 6px, 6px 6px !important;
                        background-repeat: no-repeat !important;
                        padding-right: 34px !important;
                    }
                    #${POPUP_ID_ACU} input:focus,
                    #${POPUP_ID_ACU} select:focus,
                    #${POPUP_ID_ACU} textarea:focus {
                        border-color: var(--acu-accent) !important;
                        box-shadow: 0 0 0 3px var(--acu-accent-glow) !important;
                        outline: none !important;
                    }
                    #${POPUP_ID_ACU} textarea { min-height: 92px; resize: vertical; line-height: 1.55; }
                    #${POPUP_ID_ACU} input::placeholder, #${POPUP_ID_ACU} textarea::placeholder { color: var(--acu-text-3); }

                    /* iOS：阻止输入框聚焦缩放 */
                    @media (max-width: 480px) {
                        #${POPUP_ID_ACU} input, #${POPUP_ID_ACU} select, #${POPUP_ID_ACU} textarea { font-size: 16px; }
                    }

                    /* ═══ 按钮体系：典雅肃静 ═══ */
                    #${POPUP_ID_ACU} button, #${POPUP_ID_ACU} .button {
                        padding: 8px 14px !important;
                        border-radius: 6px !important;
                        border: 1px solid var(--acu-border-2) !important;
                        background: var(--acu-bg-1) !important;
                        color: var(--acu-text-2) !important;
                        cursor: pointer !important;
                        font-weight: 500 !important;
                        font-family: inherit !important;
                        font-size: 13px !important;
                        line-height: 1.3 !important;
                        min-height: 34px !important;
                        transition: all 0.18s ease !important;
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) !important;
                    }
                    #${POPUP_ID_ACU} button:hover, #${POPUP_ID_ACU} .button:hover {
                        background: var(--acu-bg-2) !important;
                        color: var(--acu-text-1) !important;
                        border-color: var(--acu-border) !important;
                        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.07) !important;
                        transform: translateY(-0.5px) !important;
                    }
                    #${POPUP_ID_ACU} button:active, #${POPUP_ID_ACU} .button:active {
                        transform: translateY(0) !important;
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) !important;
                    }
                    #${POPUP_ID_ACU} button:disabled, #${POPUP_ID_ACU} .button:disabled,
                    #${POPUP_ID_ACU} button.acu-manual-update-vector-soft-disabled {
                        opacity: 0.45 !important;
                        cursor: not-allowed !important;
                        transform: none !important;
                        box-shadow: none !important;
                    }

                    /* 主按钮：强调色填充 */
                    #${POPUP_ID_ACU} button.primary, #${POPUP_ID_ACU} .button.primary {
                        background: var(--acu-accent) !important;
                        border-color: var(--acu-accent) !important;
                        color: var(--acu-checkbox-checked-icon, #ffffff) !important;
                        font-weight: 600 !important;
                        box-shadow: 0 1px 3px var(--acu-accent-glow) !important;
                    }
                    #${POPUP_ID_ACU} button.primary:hover, #${POPUP_ID_ACU} .button.primary:hover {
                        filter: brightness(1.08) !important;
                        box-shadow: 0 3px 10px var(--acu-accent-glow-2) !important;
                        border-color: var(--acu-accent) !important;
                        color: var(--acu-checkbox-checked-icon, #ffffff) !important;
                    }

                    /* 警告/危险 */
                    #${POPUP_ID_ACU} .btn-warning {
                        background: rgba(245, 158, 11, 0.08);
                        border-color: rgba(245, 158, 11, 0.25);
                        color: #b45309;
                    }
                    #${POPUP_ID_ACU} .btn-danger {
                        background: rgba(239, 68, 68, 0.08);
                        border-color: rgba(239, 68, 68, 0.25);
                        color: #dc2626;
                    }

                    /* 小按钮样式 - 用于全选/全不选等辅助按钮 */
                    #${POPUP_ID_ACU} .acu-btn-small, #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-manual-table-select-all, #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-manual-table-select-none {
                        padding: 4px 8px;
                        font-size: 0.8em;
                        font-weight: 600;
                        border-radius: 6px;
                        min-width: auto;
                        height: 28px;
                        line-height: 20px;
                    }

                    /* 中等按钮样式 - 用于主要操作按钮但需要控制大小的情况 */
                    #${POPUP_ID_ACU} .acu-btn-medium, #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-open-new-visualizer {
                        padding: 8px 12px;
                        font-size: 0.95em;
                        font-weight: 600;
                        border-radius: 10px;
                        min-width: auto;
                        height: 40px;
                    }

                    /* 数据管理按钮组：flex-wrap 自然宽度，按内容适配 */
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons {
                        display: flex !important;
                        flex-wrap: wrap !important;
                        gap: 10px !important;
                        align-items: center;
                        justify-content: center;
                        margin-top: 0;
                        min-width: 0;
                    }

                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                        width: auto !important;
                        min-width: fit-content !important;
                        height: auto !important;
                        min-height: 36px !important;
                        padding: 8px 16px !important;
                        border-radius: 6px !important;
                        font-size: 0.92em !important;
                        font-weight: 500 !important;
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        white-space: nowrap !important;
                        background: var(--acu-bg-1) !important;
                        border: 1px solid var(--acu-border-2) !important;
                        color: var(--acu-text-2) !important;
                        box-shadow: none !important;
                    }
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button:hover,
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button:hover {
                        background: var(--acu-bg-2) !important;
                        border-color: var(--acu-border) !important;
                        color: var(--acu-text-1) !important;
                    }
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons.acu-cols-2 {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons.acu-cols-3 {
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                    }

                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                        width: 100% !important;
                        min-width: 0 !important;
                        height: auto !important;
                        min-height: 38px !important;
                        padding: 8px 14px !important;
                        border-radius: 6px !important;
                        font-size: 0.92em !important;
                        font-weight: 500 !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        white-space: nowrap !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        background: var(--acu-bg-1) !important;
                        border: 1px solid var(--acu-border-2) !important;
                        color: var(--acu-text-2) !important;
                        box-shadow: none;
                    }
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button:hover,
                    #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button:hover {
                        background: var(--acu-bg-2) !important;
                        border-color: var(--acu-border) !important;
                        color: var(--acu-text-1) !important;
                    }

                    #${POPUP_ID_ACU} .button-group {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 10px;
                        justify-content: center;
                        margin-top: 14px;
                    }
                    /* 让 card 内连续 checkbox-group 之间有间距 */
                    #${POPUP_ID_ACU} .acu-card > div:has(> .checkbox-group) + div:has(> .checkbox-group),
                    #${POPUP_ID_ACU} .acu-card > .checkbox-group + .checkbox-group {
                        margin-top: 4px;
                    }
                    /* checkbox-group 网格容器：当 card 内有多组 checkbox-group 时自动网格排列 */
                    #${POPUP_ID_ACU} .acu-card > div[style*="flex-direction: column"]:has(> .checkbox-group:nth-child(2)) {
                        display: grid !important;
                        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                        gap: 6px !important;
                    }

                    /* ═══ 勾选条目：轻量化设计 ═══ */
                    #${POPUP_ID_ACU} .checkbox-group {
                        display: flex !important;
                        align-items: center !important;
                        gap: 8px !important;
                        padding: 7px 10px !important;
                        border-radius: 6px !important;
                        border: 1px solid transparent !important;
                        background: transparent !important;
                        margin-bottom: 2px !important;
                        transition: background 0.15s ease, border-color 0.15s ease !important;
                    }
                    #${POPUP_ID_ACU} .checkbox-group:hover {
                        background: var(--acu-bg-2) !important;
                        border-color: var(--acu-border) !important;
                    }

                    /* 兼容旧类名：保证“只来自插件自身”的统一观感 */
                    #${POPUP_ID_ACU} .menu_button {
                        border-radius: 12px !important;
                        border: 1px solid var(--acu-border-2) !important;
                    }

                    #${POPUP_ID_ACU} hr {
                        border: none;
                        border-top: 1px solid var(--acu-border);
                        margin: 14px 0;
                    }

                    /* 通用布局小组件 */
                    #${POPUP_ID_ACU} .flex-center { display: flex; justify-content: center; align-items: center; }
                    #${POPUP_ID_ACU} .input-group { display: flex; gap: 10px; align-items: center; }
                    #${POPUP_ID_ACU} .input-group input { flex: 1; min-width: 0; }

                    #${POPUP_ID_ACU} .checkbox-group {
                        display: flex;
                        align-items: flex-start;
                        gap: 10px;
                        padding: 10px 14px;
                        border-radius: var(--acu-radius-md);
                        border: 1px solid var(--acu-border);
                        background: var(--acu-bg-2);
                        margin-bottom: 6px;
                    }

                    /* ═══ 复选框：精致典雅风格 ═══ */
                    #${POPUP_ID_ACU} input[type="checkbox"] {
                        -webkit-appearance: none !important;
                        appearance: none !important;
                        accent-color: initial !important;
                        width: 18px !important;
                        height: 18px !important;
                        min-width: 18px !important;
                        min-height: 18px !important;
                        border-radius: 5px !important;
                        border: 1.5px solid var(--acu-border-2) !important;
                        background-color: var(--acu-checkbox-bg, var(--acu-control-bg, var(--acu-bg-1))) !important;
                        background-image: none !important;
                        box-shadow: none !important;
                        margin: 0 !important;
                        cursor: pointer !important;
                        vertical-align: middle !important;
                        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
                        position: relative !important;
                        flex-shrink: 0 !important;
                    }
                    /* 关键：禁用外部/浏览器可能注入的伪元素勾选样式 */
                    #${POPUP_ID_ACU} input[type="checkbox"]::before,
                    #${POPUP_ID_ACU} input[type="checkbox"]::after {
                        content: none !important;
                        display: none !important;
                    }
                    #${POPUP_ID_ACU} input[type="checkbox"]:checked::before {
                        content: "" !important;
                        display: block !important;
                        position: absolute !important;
                        top: 50% !important;
                        left: 50% !important;
                        transform: translate(-50%, -50%) !important;
                        width: 12px !important;
                        height: 10px !important;
                        background-color: var(--acu-checkbox-checked-icon, #ffffff) !important;
                        -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 10'%3E%3Cpath fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M1 5l3 3 7-7'/%3E%3C/svg%3E") !important;
                        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 10'%3E%3Cpath fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M1 5l3 3 7-7'/%3E%3C/svg%3E") !important;
                        -webkit-mask-repeat: no-repeat !important;
                        mask-repeat: no-repeat !important;
                        -webkit-mask-position: center !important;
                        mask-position: center !important;
                        -webkit-mask-size: 12px 10px !important;
                        mask-size: 12px 10px !important;
                        transition: transform 0.15s ease !important;
                    }
                    /* 勾选状态：主题背景 + 微缩放反馈 */
                    #${POPUP_ID_ACU} input[type="checkbox"]:checked {
                        border-color: var(--acu-checkbox-checked-border, var(--acu-accent)) !important;
                        background-color: var(--acu-checkbox-checked-bg, var(--acu-accent)) !important;
                        transform: scale(1.05) !important;
                    }
                    /* 点击瞬间的微缩放 */
                    #${POPUP_ID_ACU} input[type="checkbox"]:active {
                        transform: scale(0.92) !important;
                    }
                    #${POPUP_ID_ACU} input[type="checkbox"]:disabled {
                        opacity: 0.45 !important;
                        cursor: not-allowed !important;
                    }
                    #${POPUP_ID_ACU} input[type="checkbox"]:focus-visible {
                        outline: 2px solid var(--acu-accent) !important;
                        outline-offset: 2px !important;
                    }
                    /* 位置微调（不改变外观规则） */
                    #${POPUP_ID_ACU} .checkbox-group input[type="checkbox"] { margin-top: 0 !important; }
                    #${POPUP_ID_ACU} .checkbox-group label { margin: 0 !important; color: var(--acu-text-2) !important; font-size: 13px !important; font-weight: 500 !important; cursor: pointer !important; line-height: 1.4 !important; }
                    #${POPUP_ID_ACU} .checkbox-group:hover label { color: var(--acu-text-1) !important; }

                    /* Toggle switch（剧情推进） */
                    #${POPUP_ID_ACU} .toggle-switch { position: relative; display: inline-block; width: 46px; height: 26px; flex-shrink: 0; }
                    /* 关键：滑动开关内部的 checkbox 必须保持“隐藏输入”形态，避免被上面的复选框样式接管 */
                    #${POPUP_ID_ACU} .toggle-switch input[type="checkbox"] {
                        -webkit-appearance: auto !important;
                        appearance: auto !important;
                        background: transparent !important;
                        border: 0 !important;
                        box-shadow: none !important;
                        width: 0 !important;
                        height: 0 !important;
                        min-width: 0 !important;
                        min-height: 0 !important;
                        opacity: 0 !important;
                        margin: 0 !important;
                        cursor: pointer !important;
                    }
                    #${POPUP_ID_ACU} .slider {
                        position: absolute; cursor: pointer; inset: 0;
                        background: rgba(255, 255, 255, 0.16);
                        border: 1px solid rgba(255, 255, 255, 0.14);
                        transition: 0.18s ease;
                        border-radius: 999px;
                    }
                    #${POPUP_ID_ACU} .slider:before {
                        content: ""; position: absolute;
                        height: 20px; width: 20px; left: 3px; top: 50%;
                        transform: translateY(-50%);
                        background: rgba(255, 255, 255, 0.92);
                        transition: 0.18s ease;
                        border-radius: 999px;
                    }
                    #${POPUP_ID_ACU} .toggle-switch input:checked + .slider {
                        background: linear-gradient(135deg, rgba(123, 183, 255, 0.55), rgba(155, 123, 255, 0.45));
                        border-color: rgba(123, 183, 255, 0.45);
                    }
                    #${POPUP_ID_ACU} .toggle-switch input:checked + .slider:before { transform: translateY(-50%) translateX(20px); }

                    /* 提示词编辑器 */
                    #${POPUP_ID_ACU} .prompt-segment {
                        margin-bottom: 12px;
                        border: 1px solid var(--acu-border);
                        background: var(--acu-bg-2);
                        padding: 12px;
                        border-radius: var(--acu-radius-md);
                    }
                    #${POPUP_ID_ACU} .prompt-segment-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
                    #${POPUP_ID_ACU} .prompt-segment-role { width: 120px !important; flex-grow: 0; }
                    #${POPUP_ID_ACU} .prompt-segment-delete-btn {
                        width: 28px; height: 28px; padding: 0;
                        border-radius: 999px;
                        border: 1px solid rgba(255, 107, 107, 0.35);
                        background: rgba(255, 107, 107, 0.18);
                        color: var(--acu-text-1);
                        font-weight: 800;
                        line-height: 28px;
                    }
                    #${POPUP_ID_ACU} .${SCRIPT_ID_PREFIX_ACU}-add-prompt-segment-btn {
                        height: 32px;
                        padding: 0 14px;
                        border-radius: 999px;
                        border-color: rgba(74, 209, 159, 0.35) !important;
                        background: rgba(74, 209, 159, 0.20) !important;
                        color: var(--acu-text-1) !important;
                    }
                    /* 剧情推进独立提示词组编辑器（避免与“数据库更新预设”事件冲突，使用独立 class） */
                    #${POPUP_ID_ACU} .plot-prompt-segment {
                        margin-bottom: 12px;
                        border: 1px solid var(--acu-border);
                        background: var(--acu-bg-2);
                        padding: 12px;
                        border-radius: var(--acu-radius-md);
                    }
                    #${POPUP_ID_ACU} .plot-prompt-segment-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
                    #${POPUP_ID_ACU} .plot-prompt-segment-role { width: 120px !important; flex-grow: 0; }
                    #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-header-row,
                    #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-scope-grid,
                    #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-task-layout {
                        min-width: 0;
                    }
                    #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-scope-grid > *,
                    #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-task-layout > * {
                        min-width: 0;
                    }
                    #${POPUP_ID_ACU} .plot-prompt-segment-delete-btn {
                        width: 28px; height: 28px; padding: 0;
                        border-radius: 999px;
                        border: 1px solid rgba(255, 107, 107, 0.35);
                        background: rgba(255, 107, 107, 0.18);
                        color: var(--acu-text-1);
                        font-weight: 800;
                        line-height: 28px;
                    }
                    #${POPUP_ID_ACU} .${SCRIPT_ID_PREFIX_ACU}-plot-add-prompt-segment-btn {
                        height: 32px;
                        padding: 0 14px;
                        border-radius: 999px;
                        border-color: rgba(74, 209, 159, 0.35) !important;
                        background: rgba(74, 209, 159, 0.20) !important;
                        color: var(--acu-text-1) !important;
                    }

                    /* 世界书 */
                    #${POPUP_ID_ACU} .qrf_radio_group {
                        display: flex;
                        flex-wrap: wrap;
                        justify-content: center;
                        gap: 10px 16px;
                        padding: 10px;
                        border-radius: var(--acu-radius-md);
                        border: 1px solid var(--acu-border);
                        background: var(--acu-bg-2);
                    }
                    #${POPUP_ID_ACU} .qrf_radio_group input[type="radio"] {
                        width: auto !important;
                        margin: 0 !important;
                        accent-color: var(--acu-radio-accent, var(--acu-accent)) !important;
                        background: var(--acu-radio-bg, var(--acu-control-bg, var(--acu-bg-1))) !important;
                        cursor: pointer !important;
                    }
                    #${POPUP_ID_ACU} .qrf_radio_group label { margin: 0 !important; color: var(--acu-text-2); font-weight: 500; }
                    #${POPUP_ID_ACU} .qrf_worldbook_list, #${POPUP_ID_ACU} .qrf_worldbook_entry_list {
                        border: 1px solid var(--acu-border);
                        border-radius: var(--acu-radius-md);
                        background: var(--acu-bg-1);
                        padding: 8px;
                        max-height: 220px;
                        overflow: auto;
                    }
                    #${POPUP_ID_ACU} .qrf_worldbook_list_item {
                        padding: 8px 10px;
                        border-radius: 6px;
                        cursor: pointer;
                        user-select: none;
                        color: var(--acu-text-2);
                        transition: background 0.12s ease, color 0.12s ease;
                        margin-bottom: 4px;
                        border: 1px solid transparent;
                    }
                    #${POPUP_ID_ACU} .qrf_worldbook_list_item:hover { background: var(--acu-bg-2); color: var(--acu-text-1); }
                    #${POPUP_ID_ACU} .qrf_worldbook_list_item.selected {
                        background: rgba(37, 99, 235, 0.08);
                        border-color: rgba(37, 99, 235, 0.25);
                        color: var(--acu-accent);
                    }
                    #${POPUP_ID_ACU} .qrf_worldbook_entry_item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 6px; }
                    #${POPUP_ID_ACU} .qrf_worldbook_entry_item input[type="checkbox"] { margin: 1px 0 0 0 !important; }
                    #${POPUP_ID_ACU} .qrf_worldbook_entry_item label { margin: 0; font-weight: 600; font-size: 13px; color: var(--acu-text-2); }

                    /* notes/辅助文字 */
                    #${POPUP_ID_ACU} .notes, #${POPUP_ID_ACU} small.notes {
                        display: block;
                        margin-top: 10px;
                        font-size: 12px;
                        line-height: 1.55;
                        color: var(--acu-text-3);
                        text-align: left;
                    }

                    /* 底部状态栏：独立成条，居中不“歪” */
                    #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-status-message {
                        margin: 12px 0 0 0;
                        padding: 10px 12px;
                            width: 100%;
                        text-align: center;
                        border-radius: var(--acu-radius-md);
                        border: 1px solid var(--acu-border);
                        background: var(--acu-bg-2);
                        color: var(--acu-text-2);
                        }

                    /* 状态显示 */
                        #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-card-update-status-display {
                        padding: 10px 12px;
                        border-radius: var(--acu-radius-md);
                        border: 1px dashed var(--acu-border-2);
                        background: var(--acu-bg-2);
                        color: var(--acu-text-2);
                        }
                    #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-total-messages-display { color: var(--acu-text-3); font-size: 12px; }

                    /* 表格 */
                    #${POPUP_ID_ACU} table { width: 100%; border-collapse: collapse; }
                    #${POPUP_ID_ACU} table th { color: var(--acu-text-3); font-weight: 600; font-size: 12px; }
                    #${POPUP_ID_ACU} table td { color: var(--acu-text-2); }
                    #${POPUP_ID_ACU} table tr:hover { background: rgba(37, 99, 235, 0.04); }

                    /* 滚动条（浅色） */
                    #${POPUP_ID_ACU} ::-webkit-scrollbar { width: 6px; height: 6px; }
                    #${POPUP_ID_ACU} ::-webkit-scrollbar-track { background: transparent; border-radius: 999px; }
                    #${POPUP_ID_ACU} ::-webkit-scrollbar-thumb { background: var(--acu-border-2); border-radius: 999px; }
                    #${POPUP_ID_ACU} ::-webkit-scrollbar-thumb:hover { background: var(--acu-text-3); }

                    /* Toast 终止按钮（剧情推进） */
                    #toast-container .qrf-abort-btn {
                        margin-left: 8px;
                        padding: 4px 10px;
                        border-radius: 999px;
                        border: 1px solid rgba(255, 107, 107, 0.35) !important;
                        background: rgba(255, 107, 107, 0.20) !important;
                        color: #fff !important;
                        cursor: pointer;
                        font-weight: 650;
                        white-space: nowrap;
                        box-shadow: none !important;
                    }

                    /* ═══════════════════════════════════════════════════════════════
                       工具类系统 — 替代 200+ 处 inline style
                       ═══════════════════════════════════════════════════════════════ */

                    /* 布局 */
                    #${POPUP_ID_ACU} .acu-row { display: flex; align-items: center; gap: 10px; }
                    #${POPUP_ID_ACU} .acu-row-wrap { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
                    #${POPUP_ID_ACU} .acu-row-between { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
                    #${POPUP_ID_ACU} .acu-col { display: flex; flex-direction: column; gap: 8px; }
                    #${POPUP_ID_ACU} .acu-col-sm { display: flex; flex-direction: column; gap: 6px; }
                    #${POPUP_ID_ACU} .acu-grid-auto { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }

                    /* 子区块（替代 settings-section 的 inline style） */
                    #${POPUP_ID_ACU} .acu-section {
                        padding: 16px;
                        border-radius: 8px;
                        background: var(--acu-bg-2);
                        border: 1px solid var(--acu-border);
                        margin-bottom: 16px;
                    }
                    #${POPUP_ID_ACU} .acu-section:last-child { margin-bottom: 0; }
                    #${POPUP_ID_ACU} .acu-section-title {
                        margin: 0 0 12px 0;
                        color: var(--acu-text-1);
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        font-size: 13px;
                        font-weight: 600;
                    }

                    /* 分隔线 */
                    #${POPUP_ID_ACU} .acu-divider {
                        border: none;
                        border-top: 1px solid var(--acu-border);
                        margin: 14px 0;
                    }
                    #${POPUP_ID_ACU} .acu-divider-dashed {
                        border: none;
                        border-top: 1px dashed var(--acu-border);
                        margin: 12px 0;
                    }

                    /* 按钮 */
                    #${POPUP_ID_ACU} .acu-btn-full { width: 100%; }
                    #${POPUP_ID_ACU} .acu-btn-icon {
                        width: 32px; height: 32px; padding: 0;
                        display: inline-flex; align-items: center; justify-content: center;
                        border-radius: 6px; border: 1px solid var(--acu-border-2);
                        background: var(--acu-bg-1); color: var(--acu-text-3);
                        cursor: pointer; transition: all 0.15s ease;
                    }
                    #${POPUP_ID_ACU} .acu-btn-icon:hover {
                        background: var(--acu-bg-2); color: var(--acu-text-1);
                        border-color: var(--acu-border);
                    }

                    /* 徽章 */
                    #${POPUP_ID_ACU} .acu-badge {
                        padding: 2px 8px;
                        border-radius: 999px;
                        font-size: 0.75em;
                        font-weight: 600;
                        white-space: nowrap;
                    }
                    #${POPUP_ID_ACU} .acu-badge-accent {
                        background: var(--acu-accent-glow);
                        color: var(--acu-accent);
                        border: 1px solid var(--acu-accent);
                    }

                    /* 信息面板（占位符说明等） */
                    #${POPUP_ID_ACU} .acu-info-panel {
                        padding: 10px 12px;
                        background: var(--acu-bg-2);
                        border-radius: 6px;
                        border-left: 3px solid var(--acu-text-3);
                        margin-bottom: 12px;
                    }
                    #${POPUP_ID_ACU} .acu-info-panel code {
                        background: var(--acu-bg-3);
                        padding: 1px 4px;
                        border-radius: 3px;
                        font-size: 0.9em;
                    }

                    /* 结果面板 */
                    #${POPUP_ID_ACU} .acu-result-panel {
                        padding: 12px;
                        background: var(--acu-bg-2);
                        border-radius: 6px;
                        border: 1px solid var(--acu-border);
                        max-height: 300px;
                        overflow-y: auto;
                        white-space: pre-wrap;
                        font-size: 0.9em;
                    }

                    /* 表格 */
                    #${POPUP_ID_ACU} .acu-table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 0.9em;
                    }
                    #${POPUP_ID_ACU} .acu-table th {
                        text-align: left;
                        padding: 6px 8px;
                        border-bottom: 1px solid var(--acu-border);
                        color: var(--acu-text-3);
                        font-weight: 600;
                        font-size: 0.9em;
                    }
                    #${POPUP_ID_ACU} .acu-table td {
                        padding: 6px 8px;
                        border-bottom: 1px solid var(--acu-bg-3);
                    }
                    #${POPUP_ID_ACU} .acu-table th:not(:first-child),
                    #${POPUP_ID_ACU} .acu-table td:not(:first-child) {
                        text-align: center;
                    }

                    /* 标签（inline label） */
                    #${POPUP_ID_ACU} .acu-label {
                        font-weight: 500;
                        font-size: 0.9em;
                        margin-bottom: 4px;
                        display: block;
                        color: var(--acu-text-2);
                    }

                    /* 顶部标题行（替代 optimization/plot 的 flex+border-bottom） */
                    #${POPUP_ID_ACU} .acu-card-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        margin-bottom: 16px;
                        padding-bottom: 12px;
                        border-bottom: 1px solid var(--acu-border);
                    }
                    #${POPUP_ID_ACU} .acu-card-header h3 { margin: 0; color: var(--acu-text-1); }
                    #${POPUP_ID_ACU} .acu-card-header .notes { margin: 4px 0 0 0; }

                    /* ═══ 响应式 ≤1100px：导航变横向胶囊 ═══ */
                    @media screen and (max-width: 1100px) {
                        #${POPUP_ID_ACU} .acu-layout {
                            grid-template-columns: 1fr;
                            min-height: 0;
                        }
                        #${POPUP_ID_ACU} .acu-tabs-nav {
                            position: sticky;
                            top: 0;
                            z-index: 10;
                            flex-direction: row;
                            align-items: center;
                            overflow-x: auto;
                            overflow-y: hidden;
                            gap: 4px;
                            padding: 6px;
                            max-height: none;
                            flex-shrink: 0;
                            -webkit-overflow-scrolling: touch;
                            background: var(--acu-bg-1);
                            border-color: var(--acu-border);
                            border-radius: 8px;
                        }
                        #${POPUP_ID_ACU} .acu-nav-section-title { display: none; }
                        #${POPUP_ID_ACU} .acu-tab-button {
                            width: auto !important;
                            white-space: nowrap !important;
                            padding: 6px 12px !important;
                            font-size: 12px !important;
                            border-radius: 20px !important;
                        }
                        #${POPUP_ID_ACU} .acu-tab-button::after { display: none !important; }
                        #${POPUP_ID_ACU} .acu-tab-button.active {
                            background: var(--acu-accent) !important;
                            border-color: var(--acu-accent) !important;
                            color: var(--acu-checkbox-checked-icon, #ffffff) !important;
                            box-shadow: none !important;
                        }
                        #${POPUP_ID_ACU} .acu-main { min-height: 0; }
                        /* 窄屏下 checkbox-group 容器使用2列网格 */
                        #${POPUP_ID_ACU} .acu-card > div[style*="flex-direction: column"]:has(> .checkbox-group:nth-child(2)) {
                            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) !important;
                            gap: 2px !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-table .acu-data-template-grid {
                            grid-template-columns: 1fr !important;
                            gap: 12px !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-table .acu-data-template-grid > * {
                            min-width: 0;
                        }
                        #${POPUP_ID_ACU} #acu-tab-table .acu-template-preset-left,
                        #${POPUP_ID_ACU} #acu-tab-table .acu-template-preset-actions {
                            width: 100%;
                            flex-wrap: wrap;
                        }
                        #${POPUP_ID_ACU} #acu-tab-table .acu-template-preset-left .acu-mini-btn,
                        #${POPUP_ID_ACU} #acu-tab-table .acu-template-preset-actions .acu-mini-btn {
                            flex: 1 1 140px;
                            min-width: 0;
                            justify-content: center;
                        }
                        #${POPUP_ID_ACU} #acu-tab-datamgmt .acu-data-isolation-row {
                            flex-direction: column;
                            align-items: stretch !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-datamgmt .acu-data-isolation-row > button {
                            width: 100%;
                        }
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                            height: auto !important;
                            min-height: 34px !important;
                            padding: 6px 10px !important;
                            white-space: normal !important;
                            line-height: 1.35 !important;
                        }
                    }

                    /* ═══ 手机横屏/小平板 (≤768px) ═══ */
                    @media screen and (max-width: 768px) {
                        #${POPUP_ID_ACU} {
                            padding: 8px;
                            padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
                            max-width: 100vw;
                            overflow-x: hidden;
                            overflow-y: auto;
                            box-sizing: border-box;
                            max-height: 100%;
                        }
                        #${POPUP_ID_ACU} .acu-layout {
                            gap: 8px;
                            margin-top: 8px;
                            min-height: 0;
                        }
                        #${POPUP_ID_ACU} .acu-header { padding: 8px 10px; gap: 6px; flex-shrink: 0; border-radius: 6px; }
                        #${POPUP_ID_ACU} h2#updater-main-title-acu { font-size: 13px; }
                        #${POPUP_ID_ACU} .acu-card { padding: 10px; margin-bottom: 8px; border-radius: 6px; }
                        #${POPUP_ID_ACU} .acu-card h3 { font-size: 12px; margin-bottom: 8px; padding-bottom: 6px; }
                        #${POPUP_ID_ACU} .acu-tabs-nav {
                            padding: 4px;
                            gap: 3px;
                            flex-shrink: 0;
                            max-height: none;
                            background: var(--acu-bg-1);
                            border-color: var(--acu-border);
                            border-radius: 20px;
                        }
                        #${POPUP_ID_ACU} .acu-tab-button {
                            padding: 5px 10px !important;
                            font-size: 11px !important;
                        }
                        /* 768px以下 checkbox-group 更紧凑 */
                        #${POPUP_ID_ACU} .checkbox-group {
                            padding: 5px 8px !important;
                            gap: 6px !important;
                        }
                        #${POPUP_ID_ACU} .checkbox-group label { font-size: 12px !important; }
                        /* checkbox 网格更窄 */
                        #${POPUP_ID_ACU} .acu-card > div[style*="flex-direction: column"]:has(> .checkbox-group:nth-child(2)) {
                            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-header-row {
                            flex-wrap: wrap;
                            align-items: flex-start !important;
                            gap: 8px !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-header-row > div:last-child {
                            width: 100%;
                            justify-content: flex-start !important;
                        }
                    }

                    /* ═══ 手机竖屏 (≤520px) ═══ */
                    @media screen and (max-width: 520px) {
                        #${POPUP_ID_ACU} {
                            padding: 6px;
                            padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
                        }
                        #${POPUP_ID_ACU} .acu-layout { gap: 6px; margin-top: 6px; min-height: 0; }
                        #${POPUP_ID_ACU} .acu-main { min-height: 0; }
                        #${POPUP_ID_ACU} .acu-grid, #${POPUP_ID_ACU} .acu-grid-2x2 { grid-template-columns: 1fr; gap: 6px; }
                        #${POPUP_ID_ACU} .acu-card[style*="grid-column: span 2"] { grid-column: auto !important; }
                        #${POPUP_ID_ACU} .input-group { flex-direction: column; align-items: stretch; gap: 4px; }
                        #${POPUP_ID_ACU} .input-group button { width: 100%; }
                        #${POPUP_ID_ACU} .button-group { flex-wrap: wrap; gap: 4px; }
                        #${POPUP_ID_ACU} .button-group button { flex: 1 1 auto; min-height: 32px; padding: 6px 8px; }
                        #${POPUP_ID_ACU} table { display: block; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; font-size: 12px; }
                        #${POPUP_ID_ACU} table th, #${POPUP_ID_ACU} table td { padding: 3px 5px !important; }
                        /* 极窄 checkbox：2列网格 + 紧凑行高 */
                        #${POPUP_ID_ACU} .checkbox-group {
                            padding: 4px 6px !important;
                            gap: 5px !important;
                        }
                        #${POPUP_ID_ACU} .checkbox-group label { font-size: 11px !important; line-height: 1.3 !important; }
                        #${POPUP_ID_ACU} .acu-card > div[style*="flex-direction: column"]:has(> .checkbox-group:nth-child(2)) {
                            grid-template-columns: 1fr 1fr !important;
                            gap: 1px !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-scope-grid,
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-task-layout {
                            grid-template-columns: 1fr !important;
                            gap: 10px !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .plot-prompt-segment-toolbar {
                            flex-direction: column;
                            align-items: stretch;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .plot-prompt-segment-toolbar > div {
                            width: 100%;
                            justify-content: space-between;
                            flex-wrap: wrap;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .plot-prompt-segment-role {
                            width: 100% !important;
                        }

                        /* 剧情推进：预设下拉框单独占一行（更适合窄屏） */
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-preset-wrapper {
                            width: 100%;
                            flex-wrap: wrap;
                            align-items: stretch !important;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-preset-wrapper select {
                            flex: 1 1 100% !important;
                            width: 100% !important;
                            order: 1;
                        }
                        #${POPUP_ID_ACU} #acu-tab-corefunc .acu-plot-preset-wrapper button {
                            order: 2;
                            flex: 1 1 44px;
                            min-width: 44px;
                            padding: 8px 10px !important;
                        }

                        /* 小按钮在移动端保持紧凑 */
                        #${POPUP_ID_ACU} .acu-btn-small, #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-manual-table-select-all, #${POPUP_ID_ACU} #${SCRIPT_ID_PREFIX_ACU}-manual-table-select-none {
                            padding: 3px 6px;
                            font-size: 0.75em;
                            height: 26px;
                            min-width: 50px;
                            line-height: 18px;
                        }

                        /* 中等按钮在移动端适当缩小 */
                        #${POPUP_ID_ACU} .acu-btn-medium {
                            padding: 6px 10px;
                            font-size: 0.9em;
                            height: 36px;
                        }

                        /* 移动端：按钮自然宽度flex-wrap */
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                            min-height: 36px !important;
                            font-size: 0.9em !important;
                            padding: 6px 12px !important;
                        }
                    }

                    /* ═══ 极窄屏 (≤420px) ═══ */
                    @media screen and (max-width: 420px) {
                        #${POPUP_ID_ACU} {
                            padding: 4px;
                            padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
                        }
                        #${POPUP_ID_ACU} .acu-layout { gap: 4px; margin-top: 4px; min-height: 0; }
                        #${POPUP_ID_ACU} .acu-main { min-height: 0; }
                        #${POPUP_ID_ACU} .acu-header { padding: 6px 8px; flex-shrink: 0; border-radius: 6px; }
                        #${POPUP_ID_ACU} h2#updater-main-title-acu { font-size: 12px; line-height: 1.3; }
                        #${POPUP_ID_ACU} .acu-card { padding: 8px; margin-bottom: 6px; border-radius: 6px; }
                        #${POPUP_ID_ACU} .acu-card h3 { font-size: 11px; margin-bottom: 6px; padding-bottom: 4px; }
                        #${POPUP_ID_ACU} .acu-tabs-nav { padding: 3px; gap: 2px; flex-shrink: 0; border-radius: 16px; }
                        #${POPUP_ID_ACU} .acu-tab-button { padding: 4px 8px !important; font-size: 10px !important; }
                        #${POPUP_ID_ACU} label { font-size: 10px; margin-bottom: 3px; }
                        #${POPUP_ID_ACU} input, #${POPUP_ID_ACU} select, #${POPUP_ID_ACU} textarea {
                            padding: 6px 8px !important;
                            border-radius: 6px !important;
                        }
                        #${POPUP_ID_ACU} button, #${POPUP_ID_ACU} .button {
                            padding: 5px 8px !important;
                            min-height: 28px !important;
                            font-size: 11px !important;
                            border-radius: 6px !important;
                        }
                        #${POPUP_ID_ACU} .checkbox-group {
                            padding: 3px 5px !important;
                            gap: 4px !important;
                        }
                        #${POPUP_ID_ACU} .checkbox-group label { font-size: 10px !important; line-height: 1.25 !important; }
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                            min-height: 30px !important;
                            font-size: 0.8em !important;
                            padding: 4px 8px !important;
                            border-radius: 6px !important;
                        }
                    }

                    /* ═══ 超小屏 (≤360px) ═══ */
                    @media screen and (max-width: 360px) {
                        #${POPUP_ID_ACU} {
                            padding: 3px;
                            padding-bottom: calc(3px + env(safe-area-inset-bottom, 0px));
                        }
                        #${POPUP_ID_ACU} .acu-layout { gap: 3px; margin-top: 3px; min-height: 0; }
                        #${POPUP_ID_ACU} .acu-main { min-height: 0; }
                        #${POPUP_ID_ACU} .acu-header { padding: 5px 6px; border-radius: 6px; flex-shrink: 0; }
                        #${POPUP_ID_ACU} h2#updater-main-title-acu { font-size: 11px; }
                        #${POPUP_ID_ACU} .acu-header-sub { font-size: 9px; margin-top: 2px; }
                        #${POPUP_ID_ACU} .acu-card { padding: 6px; margin-bottom: 4px; border-radius: 6px; }
                        #${POPUP_ID_ACU} .acu-card h3 { font-size: 10px; margin-bottom: 4px; padding-bottom: 3px; }
                        #${POPUP_ID_ACU} .acu-tabs-nav { padding: 3px; gap: 2px; border-radius: 14px; flex-shrink: 0; }
                        #${POPUP_ID_ACU} .acu-tab-button { padding: 3px 6px !important; font-size: 10px !important; border-radius: 12px !important; }
                        #${POPUP_ID_ACU} .acu-tab-button::after { display: none !important; }
                        #${POPUP_ID_ACU} label { font-size: 9px; }
                        #${POPUP_ID_ACU} input, #${POPUP_ID_ACU} select, #${POPUP_ID_ACU} textarea {
                            padding: 5px 6px !important;
                            font-size: 14px !important;
                            border-radius: 5px !important;
                        }
                        #${POPUP_ID_ACU} button, #${POPUP_ID_ACU} .button {
                            padding: 4px 6px !important;
                            min-height: 26px !important;
                            font-size: 10px !important;
                            border-radius: 5px !important;
                        }
                        #${POPUP_ID_ACU} .checkbox-group {
                            padding: 2px 4px !important;
                            gap: 3px !important;
                        }
                        #${POPUP_ID_ACU} .checkbox-group label { font-size: 9px !important; line-height: 1.2 !important; }
                        #${POPUP_ID_ACU} input[type="checkbox"] {
                            width: 15px !important;
                            height: 15px !important;
                            min-width: 15px !important;
                            min-height: 15px !important;
                        }
                        #${POPUP_ID_ACU} table { font-size: 10px; }
                        #${POPUP_ID_ACU} table th, #${POPUP_ID_ACU} table td { padding: 2px 3px !important; }
                        #${POPUP_ID_ACU} .button-group { gap: 3px; }
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons { gap: 4px !important; }
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                            min-height: 28px !important;
                            font-size: 0.75em !important;
                            padding: 3px 6px !important;
                            border-radius: 5px !important;
                        }
                        #${POPUP_ID_ACU} hr { margin: 6px 0; }
                        #${POPUP_ID_ACU} .notes { font-size: 9px !important; line-height: 1.3; }
                    }

                    /* 表格模板预设 */
                    #${POPUP_ID_ACU} .acu-template-presets {
                        border: 1px solid var(--acu-border);
                        background: var(--acu-bg-1);
                        box-shadow: var(--acu-shadow);
                    }
                    #${POPUP_ID_ACU} .acu-template-preset-toolbar {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        flex-wrap: wrap;
                    }
                    #${POPUP_ID_ACU} .acu-template-preset-toolbar .acu-template-preset-left {
                        display: flex;
                        gap: 8px;
                        align-items: center;
                        flex: 1;
                        min-width: 240px;
                    }
                    #${POPUP_ID_ACU} .acu-template-preset-toolbar .acu-template-preset-actions {
                        display: flex;
                        gap: 8px;
                        align-items: center;
                        flex-wrap: wrap;
                        justify-content: flex-end;
                    }
                    #${POPUP_ID_ACU} .acu-mini-btn {
                        height: 32px;
                        padding: 0 10px;
                        border-radius: 6px;
                        border: 1px solid var(--acu-border-2);
                        background: var(--acu-bg-1);
                        color: var(--acu-text-2);
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        font-size: 12px;
                        font-weight: 500;
                        transition: background 0.15s ease, border-color 0.15s ease;
                        white-space: nowrap;
                    }
                    #${POPUP_ID_ACU} .acu-mini-btn:hover {
                        background: var(--acu-bg-2);
                        border-color: var(--acu-border);
                    }
                    #${POPUP_ID_ACU} .acu-mini-btn:active {
                        transform: none;
                    }
                    #${POPUP_ID_ACU} .acu-mini-btn.primary {
                        border-color: rgba(37, 99, 235, 0.30);
                        background: rgba(37, 99, 235, 0.08);
                        color: var(--acu-accent);
                    }
                    #${POPUP_ID_ACU} .acu-mini-btn.danger {
                        border-color: rgba(239, 68, 68, 0.25);
                        background: rgba(239, 68, 68, 0.06);
                        color: #dc2626;
                    }
                    #${POPUP_ID_ACU} .acu-mini-btn .fa-solid { opacity: 0.92; }

                    /* 超极小屏幕 (≤320px) */
                    @media screen and (max-width: 320px) {
                        #${POPUP_ID_ACU} {
                            padding: 2px;
                            padding-bottom: calc(2px + env(safe-area-inset-bottom, 0px));
                        }
                        #${POPUP_ID_ACU} .acu-layout { gap: 2px; margin-top: 2px; min-height: 0; }
                        #${POPUP_ID_ACU} .acu-main { min-height: 0; }
                        #${POPUP_ID_ACU} .acu-header { padding: 4px; flex-shrink: 0; }
                        #${POPUP_ID_ACU} h2#updater-main-title-acu { font-size: 11px; }
                        #${POPUP_ID_ACU} .acu-card { padding: 6px; margin-bottom: 4px; }
                        #${POPUP_ID_ACU} .acu-card h3 { font-size: 10px; margin-bottom: 4px; }
                        #${POPUP_ID_ACU} .acu-tabs-nav { padding: 3px; flex-shrink: 0; }
                        #${POPUP_ID_ACU} .acu-tab-button { padding: 5px 6px; font-size: 10px; }
                        #${POPUP_ID_ACU} .checkbox-group label { font-size: 10px; }
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons button,
                        #${POPUP_ID_ACU} .button-group.acu-data-mgmt-buttons .button {
                            min-height: 26px !important;
                            font-size: 0.75em !important;
                        }
                    }

                    /* ═══════════════════════════════════════════════════════════════
                        主题系统：古典主题已迁移到 theme/builtins/ 模块
                        不再在此硬编码，由 theme-registry 动态注入
                        ═══════════════════════════════════════════════════════════════ */

                    /* ═══════════════════════════════════════════════════════════════
                        高级工具子页面切换样式
                        ═══════════════════════════════════════════════════════════════ */
                    #${POPUP_ID_ACU} .acu-subtabs-nav {
                        display: flex;
                        gap: 4px;
                        margin-bottom: 14px;
                        padding: 4px;
                        border-radius: var(--acu-radius-md);
                        background: var(--acu-bg-2);
                        border: 1px solid var(--acu-border);
                    }
                    #${POPUP_ID_ACU} .acu-subtab-button {
                        flex: 1;
                        padding: 7px 12px;
                        border: 1px solid transparent;
                        border-radius: calc(var(--acu-radius-md) - 2px);
                        background: transparent;
                        color: var(--acu-text-2);
                        font-size: 12px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: background 0.15s ease, color 0.15s ease;
                    }
                    #${POPUP_ID_ACU} .acu-subtab-button:hover {
                        background: var(--acu-bg-1);
                        color: var(--acu-text-1);
                    }
                    #${POPUP_ID_ACU} .acu-subtab-button.active {
                        background: var(--acu-bg-1);
                        border-color: var(--acu-accent);
                        color: var(--acu-accent);
                        font-weight: 600;
                    }
                    #${POPUP_ID_ACU} .acu-subtab-content { display: none; }
                    #${POPUP_ID_ACU} .acu-subtab-content.active { display: block; }
`;
