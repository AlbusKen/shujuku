/**
 * presentation/components/optimization-ui/optimization-ui-diff.ts
 * 优化 Diff 对话框
 */
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../../shared/defaults-json.js';
import { activePlotEditorSettings_ACU, buildDefaultPlotPromptGroup_ACU, currentEditablePlotPresetState_ACU, currentPlotTaskEditorId_ACU, ensurePlotPromptGroup_ACU , _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU} from '../../../service/plot/plot-state';
import { showToastr_ACU } from '../../theme/toast';
import { getChatArray_ACU, saveChatToHost_ACU, setChatMessages_ACU, emitMessageUpdated_ACU } from '../../../service/chat/chat-service';
import { jQuery_API_ACU } from '../../dom-utils';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../settings-ui-helpers';
import { buildChatPlotScopeStateFromSettings_ACU, clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, setCurrentChatPlotScopeState_ACU } from '../../../service/template/chat-scope';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU } from '../../../shared/html-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../../shared/utils';
import { cancelContentOptimization_ACU, contentOptimizationAbortRequested_ACU, ensureOptimizationNotCancelled_ACU, getLastOptimizationBase_ACU, optimizationProgressToast_ACU, performContentOptimization_ACU, setLastOptimizationBase_ACU, _set_optimizationProgressToast_ACU, _set_contentOptimizationAbortRequested_ACU } from '../../../service/optimization/content-optimization';
import { applyContextTagFilters_ACU } from '../../../service/runtime/helpers-remaining';
import { getActivePlotEditorSettings_ACU, getPlotPromptContentByIdFromSettings_ACU, setPlotPromptContentByIdForSettings_ACU } from '../../../service/plot/plot-logic';

// 循环 import — 运行时安全
import { getOriginalContent_ACU, reoptimizeMessage_ACU, replaceChatMessage_ACU } from './optimization-ui-exec';

  export function showOptimizationDiffDialogForLoop_ACU(messageIndex: number, result: any, callback: Function) {
    const isLastLoop = result.currentLoop >= result.totalLoops;
    const applyButtonText = isLastLoop ? '应用并完成' : '应用并继续';
    const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
    
    const dialogHtml = `
      <div class="acu-optimization-dialog acu-dialog-classic" style="
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--acu-bg-0, #24221f);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
        border: 1px solid var(--acu-border, #36332e);
        border-radius: 2px;
        padding: 20px;
        max-width: 800px;
        width: calc(100% - 20px);
        max-height: calc(90vh - 20px);
        overflow-y: auto;
        z-index: 100000;
        color: var(--acu-text, #c1b9ad);
        font-family: "Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif;
        box-sizing: border-box;
      ">
        <h3 style="margin: 0 0 8px 0; color: var(--acu-accent, #7d4940); font-size: 1.1em; letter-spacing: 1px;">正文替换建议</h3>
        <p style="margin: 0 0 12px 0; color: var(--acu-text-dim, #8a8075);">${result.summary}</p>
        ${result.totalLoops > 1 ? `<p style="margin: 0 0 12px 0; color: var(--acu-text-mute, #6a6055); font-size: 12px;">进度: 第 ${result.currentLoop}/${result.totalLoops} 轮</p>` : ''}
        <div class="optimization-list" style="margin-bottom: 16px; max-height: 400px; overflow-y: auto;">
          ${result.optimizations.map((opt: any, i: number) => `
            <div class="optimization-item" style="
              background: rgba(0, 0, 0, 0.2);
              border-radius: 1px;
              padding: 12px;
              margin-bottom: 8px;
              border-left: 2px solid var(--acu-border, #36332e);
            ">
              <div style="color: var(--acu-text-dim, #8a8075); margin-bottom: 8px; text-decoration: line-through; opacity: 0.7;">
                <strong>原文：</strong>${escapeHtml_ACU(opt.original.substring(0, 200))}${opt.original.length > 200 ? '...' : ''}
              </div>
              <div style="color: var(--acu-text, #c1b9ad); font-size: 12px; margin-bottom: 8px; padding: 8px; background: rgba(125, 73, 64, 0.1); border-radius: 1px; border-left: 2px solid var(--acu-accent, #7d4940);">
                <strong>修改方案：</strong>${escapeHtml_ACU(opt.plan || opt.reason || '未说明')}
              </div>
              <div style="color: #6a8a6a;">
                <strong>优化：</strong>${escapeHtml_ACU(opt.optimized.substring(0, 200))}${opt.optimized.length > 200 ? '...' : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; padding-bottom: 10px;">
          <button id="acu-opt-cancel" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-border, #36332e);
            background: transparent;
            color: var(--acu-text-dim, #8a8075);
            border-radius: 1px;
            cursor: pointer;
            min-width: 80px;
            flex-shrink: 0;
            font-family: inherit;
          ">取消优化</button>
          ${!isLastLoop ? `
          <button id="acu-opt-skip" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-border, #36332e);
            background: transparent;
            color: var(--acu-text-dim, #8a8075);
            border-radius: 1px;
            cursor: pointer;
            min-width: 80px;
            flex-shrink: 0;
            font-family: inherit;
          ">跳过本轮</button>
          ` : ''}
          <button id="acu-opt-reoptimize" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-accent, #7d4940);
            background: transparent;
            color: var(--acu-accent, #7d4940);
            border-radius: 1px;
            cursor: pointer;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">🔄 重新优化</button>
          <button id="acu-opt-apply" style="
            padding: 8px 16px;
            border: none;
            background: var(--acu-accent, #7d4940);
            color: var(--acu-bg-0, #24221f);
            border-radius: 1px;
            cursor: pointer;
            font-weight: 600;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">${applyButtonText}</button>
        </div>
      </div>
      <div id="acu-opt-backdrop" style="
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 99999;
      "></div>
    `;
    
    jQuery_API_ACU('body').append(dialogHtml);
    
    // 绑定取消事件
    jQuery_API_ACU('#acu-opt-cancel, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('cancel');
    });
    
    // 绑定跳过事件（仅非最后一轮显示）
    jQuery_API_ACU('#acu-opt-skip').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('skip');
    });
    
    // 绑定重新优化事件
    jQuery_API_ACU('#acu-opt-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      
      // 关闭当前对话框
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      
      // 获取原始内容并重新优化
      const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
      
      logDebug_ACU(`[正文优化] 用户点击重新优化，messageIndex=${messageIndex}`);
      
      // 重新优化
      await reoptimizeMessage_ACU(messageIndex);
      
      // 触发回调，结束当前优化流程
      callback('cancel');
    });
    
    // 绑定应用事件
    jQuery_API_ACU('#acu-opt-apply').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('处理中...');
      
      logDebug_ACU(`[正文优化] 用户点击应用，isLastLoop=${isLastLoop}, messageIndex=${messageIndex}`);
      logDebug_ACU(`[正文优化] optimizedContent长度: ${result.optimizedContent?.length || 0}`);
      
      // 如果是最后一轮，先应用优化
      if (isLastLoop) {
        logDebug_ACU(`[正文优化] 准备调用 replaceChatMessage_ACU...`);
        const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, { originalContent: getOriginalContent_ACU(messageIndex) || originalContent });
        logDebug_ACU(`[正文优化] replaceChatMessage_ACU 返回: ${success}`);
        if (!success) {
          jQuery_API_ACU(this).prop('disabled', false).text(applyButtonText);
          showToastr_ACU('error', '应用失败');
          return;
        }
      } else {
        logDebug_ACU(`[正文优化] 非最后一轮，跳过应用，直接回调`);
      }
      
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('apply');
    });
  }
  
  /**
   * 显示优化对比对话框
   */
  export function showOptimizationDiffDialog_ACU(messageIndex: number, result: any) {
    const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
    const dialogHtml = `
      <div class="acu-optimization-dialog acu-dialog-classic" style="
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--acu-bg-0, #24221f);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
        border: 1px solid var(--acu-border, #36332e);
        border-radius: 2px;
        padding: 20px;
        max-width: 800px;
        width: calc(100% - 20px);
        max-height: calc(90vh - 20px);
        overflow-y: auto;
        z-index: 100000;
        color: var(--acu-text, #c1b9ad);
        font-family: "Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif;
        box-sizing: border-box;
      ">
        <h3 style="margin: 0 0 16px 0; color: var(--acu-accent, #7d4940); font-size: 1.1em; letter-spacing: 1px;">正文替换建议</h3>
        <p style="margin: 0 0 12px 0; color: var(--acu-text-dim, #8a8075);">${result.summary || `共 ${result.optimizations.length} 处替换建议`}</p>
        <div class="optimization-list" style="margin-bottom: 16px;">
          ${result.optimizations.map((opt: any, i: number) => `
            <div class="optimization-item" style="
              background: rgba(0, 0, 0, 0.2);
              border-radius: 1px;
              padding: 12px;
              margin-bottom: 8px;
              border-left: 2px solid var(--acu-border, #36332e);
            ">
              <div style="color: var(--acu-text-dim, #8a8075); margin-bottom: 8px; text-decoration: line-through; opacity: 0.7;">
                <strong>原文：</strong>${escapeHtml_ACU(opt.original.substring(0, 200))}${opt.original.length > 200 ? '...' : ''}
              </div>
              <div style="color: var(--acu-text, #c1b9ad); font-size: 12px; margin-bottom: 8px; padding: 8px; background: rgba(125, 73, 64, 0.1); border-radius: 1px; border-left: 2px solid var(--acu-accent, #7d4940);">
                <strong>修改方案：</strong>${escapeHtml_ACU(opt.plan || opt.reason || '未说明')}
              </div>
              <div style="color: #6a8a6a;">
                <strong>优化：</strong>${escapeHtml_ACU(opt.optimized.substring(0, 200))}${opt.optimized.length > 200 ? '...' : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; padding-bottom: 10px;">
          <button id="acu-opt-cancel" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-border, #36332e);
            background: transparent;
            color: var(--acu-text-dim, #8a8075);
            border-radius: 1px;
            cursor: pointer;
            min-width: 80px;
            flex-shrink: 0;
            font-family: inherit;
          ">取消</button>
          <button id="acu-opt-reoptimize" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-accent, #7d4940);
            background: transparent;
            color: var(--acu-accent, #7d4940);
            border-radius: 1px;
            cursor: pointer;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">🔄 重新优化</button>
          <button id="acu-opt-apply" style="
            padding: 8px 16px;
            border: none;
            background: var(--acu-accent, #7d4940);
            color: var(--acu-bg-0, #24221f);
            border-radius: 1px;
            cursor: pointer;
            font-weight: 600;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">应用优化</button>
        </div>
      </div>
      <div id="acu-opt-backdrop" style="
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 99999;
      "></div>
    `;
    
    jQuery_API_ACU('body').append(dialogHtml);
    
    // 绑定事件
    jQuery_API_ACU('#acu-opt-cancel, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    });
    
    // 绑定重新优化事件
    jQuery_API_ACU('#acu-opt-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      
      // 关闭当前对话框
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      
      logDebug_ACU(`[正文优化] 用户点击重新优化，messageIndex=${messageIndex}`);
      
      // 重新优化
      await reoptimizeMessage_ACU(messageIndex);
    });
    
    jQuery_API_ACU('#acu-opt-apply').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('应用中...');
      
      const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, { originalContent: getOriginalContent_ACU(messageIndex) || originalContent });
      
      if (success) {
        jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
        showToastr_ACU('success', '优化已应用');
      } else {
        jQuery_API_ACU(this).prop('disabled', false).text('应用优化');
        showToastr_ACU('error', '应用失败');
      }
    });
    
    // 取消只结束正文优化。
    jQuery_API_ACU('#acu-opt-cancel').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      logDebug_ACU('[正文优化] 用户取消优化。');
    });
  }
  
  /**
   * 显示优化结果摘要
   */
  export function showOptimizationDiff_ACU(messageIndex: number, result: any) {
    const message = `正文替换完成，共 ${result.optimizations.length} 处改进`;
    showToastr_ACU('success', result.summary ? `${message}\n${result.summary}` : message, {
      acuActions: [{
        label: '重新优化',
        run: async () => {
          await reoptimizeMessage_ACU(messageIndex);
        },
      }],
    });
  }
  
  /**
   * HTML转义
   */

  // === 以下为 presentation 层独有的 UI 函数（DOM 操作/渲染）===

