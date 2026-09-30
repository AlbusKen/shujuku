// main-popup.ts
// 从 05_main_popup.js 整体迁入
// UI 重构：7个一级导航 — 仪表盘/更新/API/表格/核心功能/数据管理/高级工具

import { showToastr_ACU } from '../theme/toast';
import { coreApisAreReady_ACU, currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import { $popupInstance_ACU, _set_$popupInstance_ACU } from '../state/ui-refs';
import { loadSettingsAndRefreshUI_ACU } from '../components/settings-ui-helpers';
import { POPUP_ID_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { bindPopupEvents_ACU } from './popup-bindings';
import { loadPlotSettingsToUI_ACU } from './popup-helpers';
import { createACUWindow } from '../window/window-system';
import { ACU_PRODUCT_NAME_ACU } from '../../shared/product-brand';

// 标签页 HTML 生成模块
import { generateDashboardTabHTML } from './main-popup-status';
import { generateUpdateTabHTML } from './main-popup-update';
import { generateApiTabHTML } from './main-popup-api';
import { generateTableTabHTML } from './main-popup-table';
import { generateCoreFuncTabHTML } from './main-popup-plot';
import { generateDataMgmtTabHTML } from './main-popup-datamgmt';
import { generateAdvancedTabHTML } from './main-popup-advanced';
import { isSqliteMode } from '../../service/table/storage-mode';

import { MAIN_POPUP_CSS_ACU } from './main-popup-styles';
import { generateThemeSelectorHTML, bindThemeSelectorEvents } from '../theme/theme-selector';
import { applyTheme, loadCustomThemes, getAllThemes, getActiveThemeId, getThemeCSS_ACU } from '../theme/theme-registry';
import { BUILTIN_THEME_IDS } from '../theme/theme-registry';

/**
 * 生成窗口 chrome 头部用的主题选择器 HTML
 * 复用新主题系统的选择器，替换旧的"素纱"切换按钮
 */
function generateThemeSelectorHTMLForChrome(): string {
    const currentId = getActiveThemeId();
    const themes = getAllThemes();
    const options = themes.map(t => {
        const selected = t.id === currentId ? 'selected' : '';
        const builtin = BUILTIN_THEME_IDS.has(t.id) ? '' : ' *';
        return `<option value="${t.id}" ${selected}>${t.name}${builtin}</option>`;
    }).join('');
    return `<div class="acu-chrome-theme-selector" style="display: flex; align-items: center; gap: 4px;">
        <select id="${SCRIPT_ID_PREFIX_ACU}-chrome-theme-select" style="padding: 2px 6px !important; border-radius: 6px !important; border: 1px solid var(--acu-panel-border, #e0e4ea) !important; background: var(--acu-panel-bg, #f5f7fa) !important; color: var(--acu-panel-text, #1a2332) !important; font-size: 11px !important; cursor: pointer !important; max-width: 120px !important; height: 26px !important; font-family: inherit !important;">
            ${options}
        </select>
        <button id="${SCRIPT_ID_PREFIX_ACU}-chrome-theme-delete" style="width: 26px; height: 26px; padding: 0; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--acu-panel-text-mute, #8896a8); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px;${BUILTIN_THEME_IDS.has(currentId) ? ' opacity: 0.3; pointer-events: none;' : ''}" title="${BUILTIN_THEME_IDS.has(currentId) ? '内置主题不可删除' : '删除当前自定义主题'}">
            <i class="fa-solid fa-trash" style="font-size: 10px;"></i>
        </button>
        <button id="${SCRIPT_ID_PREFIX_ACU}-chrome-theme-import" style="width: 26px; height: 26px; padding: 0; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--acu-panel-text-mute, #8896a8); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px;" title="导入自定义主题">
            <i class="fa-solid fa-upload" style="font-size: 11px;"></i>
        </button>
        <button id="${SCRIPT_ID_PREFIX_ACU}-chrome-theme-export" style="width: 26px; height: 26px; padding: 0; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--acu-panel-text-mute, #8896a8); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px;" title="导出当前主题模板（完整可编辑版）">
            <i class="fa-solid fa-download" style="font-size: 11px;"></i>
        </button>
    </div>`;
}

  export async function openAutoCardPopup_ACU() {
    if (!coreApisAreReady_ACU) {
      showToastr_ACU('error', '核心API未就绪。');
      return;
    }
    showToastr_ACU('info', '正在准备数据库更新工具...', { timeOut: 1000 });
    // The state is managed by background event listeners. The popup should only display the current state.
    // Calling reset here could cause race conditions or incorrect state wipes.
    loadSettingsAndRefreshUI_ACU(); // Load latest settings into UI

    // ═══ 关键：在创建窗口前预加载自定义主题并生成主题CSS ═══
    // 这样主题CSS可以嵌入popupHtml，消除首帧闪变（FOUC）
    loadCustomThemes();
    const prebuiltThemeCSS = getThemeCSS_ACU();

    const popupHtml = `
            <div id="${POPUP_ID_ACU}" class="auto-card-updater-popup">
                <style>${MAIN_POPUP_CSS_ACU}</style>
                <style id="acu-theme-override">${prebuiltThemeCSS}</style>

                <div class="acu-header">
                    <h2 id="updater-main-title-acu">当前聊天：${escapeHtml_ACU(
                          currentChatFileIdentifier_ACU || '未知',
                        )}</h2>
                </div>

                <div class="acu-layout">
                    <!-- 导航（分组分页） -->
                    <div class="acu-tabs-nav" aria-label="数据库工具导航">
                        <div class="acu-nav-section-title">概览</div>
                    <button class="acu-tab-button active" data-tab="dashboard">仪表盘</button>
                        <div class="acu-nav-section-title">配置</div>
                    <button class="acu-tab-button" data-tab="update">更新</button>
                    <button class="acu-tab-button" data-tab="api">API</button>
                    <button class="acu-tab-button" data-tab="table">表格</button>
                        <div class="acu-nav-section-title">功能</div>
                    <button class="acu-tab-button" data-tab="corefunc">核心功能</button>
                    <button class="acu-tab-button" data-tab="datamgmt">数据管理</button>
                        <div class="acu-nav-section-title">工具</div>
                    <button class="acu-tab-button" data-tab="advanced">高级工具</button>
                </div>

                    <div class="acu-main">
                <!-- Tab内容（由独立模块生成） -->
                ${generateDashboardTabHTML()}
                ${generateUpdateTabHTML()}
                ${generateApiTabHTML()}
                ${generateTableTabHTML()}
                ${generateCoreFuncTabHTML()}
                ${generateDataMgmtTabHTML()}
                ${generateAdvancedTabHTML()}

                <p id="${SCRIPT_ID_PREFIX_ACU}-status-message" class="notes">准备就绪</p>
                    </div>
                </div>
            </div>`;
    
    // ═══ 使用独立窗口系统代替酒馆弹窗 ═══
    const windowId = `${SCRIPT_ID_PREFIX_ACU}-main-window`;
    
    createACUWindow({
      id: windowId,
      title: ACU_PRODUCT_NAME_ACU,
      content: popupHtml,
      width: 1400,  // 基础宽度
      height: 900,  // 基础高度
      modal: false, // 非模态，允许多窗口操作
      resizable: true,
      maximizable: true,
      startMaximized: false, // 由 rememberState 自动管理，首次打开时不全屏
      onClose: () => {
        logDebug_ACU('ACU Window closed');
        // 清理日志查看器订阅，防止幽灵 DOM 操作和内存泄漏
        // 注意：cleanupLogViewer_ACU 在 advanced tab 的 log-viewer 子模块中
        // 由 popup-bindings 导入并调用
        _set_$popupInstance_ACU(null);
      },
      onReady: async ($window: any) => {
        // 从窗口body中找到实际内容
        const $body = $window.find('.acu-window-body');
        const curDlgCnt = $body.find(`#${POPUP_ID_ACU}`);
        
        if (!curDlgCnt || curDlgCnt.length === 0) {
          logError_ACU('Cannot find ACU popup DOM in window');
          showToastr_ACU('error', 'UI初始化失败');
          return;
        }
        _set_$popupInstance_ACU(curDlgCnt);

        // 将窗口chrome中的旧主题切换按钮替换为主题选择器
        const $oldThemeBtn = $window.find('.acu-window-btn.theme-toggle');
        if ($oldThemeBtn.length) {
          $oldThemeBtn.replaceWith(generateThemeSelectorHTMLForChrome());
        }

        // 主题已在创建窗口前预加载（loadCustomThemes + getThemeCSS_ACU），
        // 此处仅调用 applyTheme 确保 DOM 中 <style> 元素位置正确（用于后续动态切换）
        applyTheme();
        bindThemeSelectorEvents();

        $popupInstance_ACU.off('acu_plot_settings_refresh').on('acu_plot_settings_refresh', function(_event, plotSettingsOverride = null) {
          try {
            loadPlotSettingsToUI_ACU(plotSettingsOverride);
          } catch (error) {
            logWarn_ACU('[剧情推进] Plot settings UI refresh handler failed:', error);
          }
        });

        // 事件绑定（已拆分到 popup-bindings.ts）
        await bindPopupEvents_ACU();

      showToastr_ACU('success', '数据库更新工具已加载。');
      }
    });


  }
