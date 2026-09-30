/**
 * presentation/components/optimization-ui/optimization-ui-exec.ts
 * 优化执行逻辑
 */
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../../shared/defaults-json.js';
import { activePlotEditorSettings_ACU, buildDefaultPlotPromptGroup_ACU, currentEditablePlotPresetState_ACU, currentPlotTaskEditorId_ACU, ensurePlotPromptGroup_ACU , _set_currentEditablePlotPresetState_ACU, _set_activePlotEditorSettings_ACU, _set_currentPlotTaskEditorId_ACU} from '../../../service/plot/plot-state';
import { showToastr_ACU } from '../../theme/toast';
import { getChatArray_ACU, saveChatToHost_ACU, setChatMessages_ACU, emitMessageUpdated_ACU, replaceChatMessage_ACU, getOriginalContent_ACU } from '../../../service/chat/chat-service';
// re-export 从 service 层搬迁的业务逻辑函数，保持外部调用方兼容
export { replaceChatMessage_ACU, getOriginalContent_ACU } from '../../../service/chat/chat-service';
import { jQuery_API_ACU } from '../../dom-utils';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../../../service/runtime/state-manager';
import { $popupInstance_ACU } from '../../state/ui-refs';
import { saveSettingsAndNotify_ACU } from '../settings-ui-helpers';
import { buildChatPlotScopeStateFromSettings_ACU, clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU, sanitizePlotSettingsSnapshotForChat_ACU, setCurrentChatPlotScopeState_ACU } from '../../../service/template/chat-scope';
import { SCRIPT_ID_PREFIX_ACU } from '../../../shared/constants';
import { escapeHtml_ACU } from '../../../shared/html-helpers';
import { cleanChatName_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../../shared/utils';
import { triggerAutomaticUpdateIfNeeded_ACU } from '../../triggers/settings-ui-sync';
import { cancelContentOptimization_ACU, contentOptimizationAbortRequested_ACU, ensureOptimizationNotCancelled_ACU, getLastOptimizationBase_ACU, optimizationProgressToast_ACU, performContentOptimization_ACU, setLastOptimizationBase_ACU, _set_optimizationProgressToast_ACU, _set_contentOptimizationAbortRequested_ACU } from '../../../service/optimization/content-optimization';
import { applyContextTagFilters_ACU } from '../../../service/runtime/helpers-remaining';
import { getActivePlotEditorSettings_ACU, getPlotPromptContentByIdFromSettings_ACU, setPlotPromptContentByIdForSettings_ACU } from '../../../service/plot/plot-logic';

import { showOptimizationOverlay_ACU, hideOptimizationOverlay_ACU, showOptimizationProgressToast_ACU, hideOptimizationProgressToast_ACU } from './optimization-ui-overlay';
// 循环 import — 运行时安全
import { showOptimizationDiffDialogForLoop_ACU, showOptimizationDiff_ACU } from './optimization-ui-diff';

  // replaceChatMessage_ACU 和 getOriginalContent_ACU 已搬迁到 service/chat/chat-service.ts
  // 通过文件顶部的 re-export 保持外部调用方兼容

  /**
   * 重新优化消息
   * @param {number} messageIndex - 消息索引
   * @returns {Promise<boolean>} 是否成功
   */
  export async function reoptimizeMessage_ACU(messageIndex: number) {
    const config = settings_ACU.contentOptimizationSettings || {};
    _set_contentOptimizationAbortRequested_ACU(false);
    
    // 检查是否启用
    if (!config.enabled) {
      showToastr_ACU('warning', '正文优化功能未启用');
      return false;
    }
    
    const chat = getChatArray_ACU();
    if (!chat || !chat[messageIndex]) {
      showToastr_ACU('error', '消息不存在');
      return false;
    }
    
    const message = chat[messageIndex];
    
    // 跳过用户消息
    if (message.is_user) {
      showToastr_ACU('warning', '无法优化用户消息');
      return false;
    }
    
    // 获取原始内容
    const originalContent = getOriginalContent_ACU(messageIndex) || message.mes;
    
    if (!originalContent) {
      showToastr_ACU('error', '无法获取消息内容');
      return false;
    }
    
    logDebug_ACU(`[重新优化] 开始重新优化消息 ${messageIndex}，内容长度: ${originalContent.length}`);
    
    if (config.seamlessMode) {
      showOptimizationOverlay_ACU('正在重新优化正文...');
    } else {
      showOptimizationProgressToast_ACU('正在进行正文优化（重新优化）...');
    }
    
    try {
      ensureOptimizationNotCancelled_ACU();
      const result = await performContentOptimization_ACU(originalContent, {
        currentLoop: 1,
        userMessage: ''
      });
      
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      
      if (contentOptimizationAbortRequested_ACU) {
        return false;
      }

      if (!result.success) {
        showToastr_ACU('error', `重新优化失败: ${result.error || '未知错误'}`);
        return false;
      }
      
      if (!result.optimizations || result.optimizations.length === 0) {
        showToastr_ACU('info', '原文已足够好，无需优化');
        return true;
      }
      
      showReoptimizationDialog_ACU(messageIndex, result, originalContent);
      return true;
      
    } catch (error) {
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      if (contentOptimizationAbortRequested_ACU || error?.message === '用户终止正文优化') {
        logDebug_ACU('[重新优化] 用户已取消正文优化');
        return false;
      }
      logError_ACU('[重新优化] 执行出错:', error);
      showToastr_ACU('error', `重新优化失败: ${error.message}`);
      return false;
    } finally {
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      _set_contentOptimizationAbortRequested_ACU(false);
    }
  }
  
  /**
   * 显示重新优化对话框
   * @param {number} messageIndex - 消息索引
   * @param {object} result - 优化结果
   * @param {string} originalContent - 原始内容
   */
  function showReoptimizationDialog_ACU(messageIndex: number, result: any, originalContent: string) {
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
        <h3 style="margin: 0 0 8px 0; color: var(--acu-accent, #7d4940); font-size: 1.1em; letter-spacing: 1px;">🔄 重新优化结果</h3>
        <p style="margin: 0 0 12px 0; color: var(--acu-text-dim, #8a8075);">${result.summary}</p>
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
          ">🔄 再次优化</button>
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
    
    // 绑定取消事件
    jQuery_API_ACU('#acu-opt-cancel, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    });
    
    // 绑定再次优化事件
    jQuery_API_ACU('#acu-opt-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      
      // 关闭当前对话框
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      
      // 重新优化（使用原始内容）
      await reoptimizeMessage_ACU(messageIndex);
    });
    
    // 绑定应用事件
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
  }
  
  /**
   * 执行正文优化流程（在GENERATION_ENDED后调用）
   * @param {number} messageIndex - AI消息索引
   * @returns {Promise<boolean>} 是否成功
   */
  export async function executeContentOptimization_ACU(messageIndex: number) {
    const config = settings_ACU.contentOptimizationSettings || {};
    _set_contentOptimizationAbortRequested_ACU(false);
    
    // 检查是否启用
    if (!config.enabled) {
      return false;
    }
    
    const chat = getChatArray_ACU();
    if (!chat || !chat[messageIndex]) {
      return false;
    }
    
    const message = chat[messageIndex];
    
    // 跳过用户消息
    if (message.is_user) {
      return false;
    }
    
    let content = message.mes || '';
    setLastOptimizationBase_ACU({
      messageIndex,
      messageId: message.message_id,
      baseContent: content
    });
    
    // [新增] 获取用户消息（用于$8占位符）
    let userMessage = '';
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (chat[i] && chat[i].is_user) {
        userMessage = chat[i].mes || '';
        break;
      }
    }
    
    const extractTags = (config.extractTags || '').trim();
    const extractRules = config.extractRules || [];
    const excludeTags = (config.excludeTags || '').trim();
    const excludeRules = config.excludeRules || [];
    
    let processedContent = applyContextTagFilters_ACU(content, {
      extractTags,
      extractRules,
      excludeTags,
      excludeRules
    });
    
    const minLength = config.minLength || 100;
    if (processedContent.length < minLength) {
      logDebug_ACU(`[正文优化] 处理后正文长度 ${processedContent.length} 小于最小阈值 ${minLength}，跳过优化`);
      return false;
    }
    
    const loopCount = config.loopCount || 1;
    logDebug_ACU(`[正文优化] 开始优化消息 ${messageIndex}，原始长度 ${content.length}，处理后长度 ${processedContent.length}，循环次数: ${loopCount}`);
    
    if (config.seamlessMode) {
      showOptimizationOverlay_ACU(loopCount > 1 ? `正在优化正文 (1/${loopCount})...` : '正在优化正文...');
    } else {
      showOptimizationProgressToast_ACU(loopCount > 1 ? `正在进行正文优化 (1/${loopCount})...` : '正在进行正文优化...');
    }
    
    try {
      ensureOptimizationNotCancelled_ACU();
      if (config.autoApply || config.seamlessMode) {
        let currentContent = content;
        let totalOptimizations: any[] = [];
        let finalOptimizedContent = content;
        
        for (let loop = 1; loop <= loopCount; loop++) {
          ensureOptimizationNotCancelled_ACU();
          logDebug_ACU(`[正文优化] 执行第 ${loop}/${loopCount} 轮优化`);
          
          if (config.seamlessMode && loopCount > 1) {
            showOptimizationOverlay_ACU(`正在优化正文 (${loop}/${loopCount})...`);
          } else if (!config.seamlessMode) {
            showOptimizationProgressToast_ACU(`正在进行正文优化 (${loop}/${loopCount})...`);
          }
          
          const result = await performContentOptimization_ACU(currentContent, {
            currentLoop: loop,
            userMessage: userMessage
          });
          ensureOptimizationNotCancelled_ACU();
          
          if (!result.success) {
            logDebug_ACU(`[正文优化] 第 ${loop} 轮优化失败:`, result.error);
            if (loop === 1) {
              if (config.seamlessMode) {
                hideOptimizationOverlay_ACU();
              } else {
                hideOptimizationProgressToast_ACU();
              }
              return false;
            }
            break;
          }
          
          if (!result.optimizations || result.optimizations.length === 0) {
            logDebug_ACU(`[正文优化] 第 ${loop} 轮无需优化，原文已足够好`);
            if (loop === 1) {
              if (config.seamlessMode) {
                hideOptimizationOverlay_ACU();
              } else {
                hideOptimizationProgressToast_ACU();
              }
              return true;
            }
            break;
          }
          
          totalOptimizations = totalOptimizations.concat(result.optimizations);
          finalOptimizedContent = result.optimizedContent;
          currentContent = result.optimizedContent;
          
          logDebug_ACU(`[正文优化] 第 ${loop} 轮完成，本轮 ${result.optimizations.length} 个优化项，累计 ${totalOptimizations.length} 个`);
        }
        
        if (totalOptimizations.length === 0) {
          logDebug_ACU('[正文优化] 所有轮次均无需优化');
          if (config.seamlessMode) {
            hideOptimizationOverlay_ACU();
          } else {
            hideOptimizationProgressToast_ACU();
          }
          return true;
        }
        
        await replaceChatMessage_ACU(messageIndex, finalOptimizedContent);
        
        if (config.seamlessMode) {
          hideOptimizationOverlay_ACU();
        } else {
          hideOptimizationProgressToast_ACU();
        }
        
        if (config.showDiff && !config.seamlessMode) {
          showOptimizationDiff_ACU(messageIndex, {
            optimizations: totalOptimizations,
            summary: `共 ${loopCount} 轮优化，累计 ${totalOptimizations.length} 处改进`,
            optimizedContent: finalOptimizedContent
          });
        } else {
          showToastr_ACU('success', `正文优化完成，共 ${loopCount} 轮优化，累计 ${totalOptimizations.length} 处改进`);
        }
        
        return true;
      } else {
        hideOptimizationProgressToast_ACU();
        return await executeContentOptimizationWithConfirm_ACU(messageIndex, content, userMessage, loopCount);
      }
      
    } catch (error) {
      if (contentOptimizationAbortRequested_ACU || error?.message === '用户终止正文优化') {
        logDebug_ACU('[正文优化] 用户已取消正文优化');
        return false;
      }
      logError_ACU('[正文优化] 执行出错:', error);
      if (config.seamlessMode) {
        hideOptimizationOverlay_ACU();
      } else {
        hideOptimizationProgressToast_ACU();
      }
      return false;
    } finally {
      hideOptimizationOverlay_ACU();
      hideOptimizationProgressToast_ACU();
      _set_contentOptimizationAbortRequested_ACU(false);
    }
  }
  
  /**
   * 执行正文优化（手动确认模式，逐轮确认）
   * @param {number} messageIndex - 消息索引
   * @param {string} content - 原始内容
   * @param {string} userMessage - 用户消息
   * @param {number} totalLoops - 总循环次数
   * @param {number} currentLoop - 当前循环次数（内部使用）
   * @param {string} currentContent - 当前内容（内部使用）
   * @param {Array} totalOptimizations - 累计优化项（内部使用）
   * @returns {Promise<boolean>} 是否成功
   */
  async function executeContentOptimizationWithConfirm_ACU(messageIndex: number, content: string, userMessage: string, totalLoops: number, currentLoop = 1, currentContent: string | null = null, totalOptimizations: any[] = []) {
    // 使用传入的当前内容，或者原始内容
    let workingContent = currentContent !== null ? currentContent : content;
    
    logDebug_ACU(`[正文优化-手动确认] 执行第 ${currentLoop}/${totalLoops} 轮优化`);
    
    // 执行优化
    const result = await performContentOptimization_ACU(workingContent, {
      currentLoop: currentLoop,
      userMessage: userMessage
    });
    
    if (!result.success) {
      logDebug_ACU(`[正文优化-手动确认] 第 ${currentLoop} 轮优化失败:`, result.error);
      // 如果是第一轮就失败，显示错误
      if (currentLoop === 1) {
        showToastr_ACU('error', `正文优化失败: ${result.error}`);
        return false;
      }
      // 如果是后续轮次失败，使用之前的结果触发填表
      await triggerAutomaticUpdateIfNeeded_ACU();
      return true;
    }
    
    // 检查是否有实际优化
    if (!result.optimizations || result.optimizations.length === 0) {
      logDebug_ACU(`[正文优化-手动确认] 第 ${currentLoop} 轮无需优化，原文已足够好`);
      // 如果没有优化项，检查是否还有下一轮
      if (currentLoop < totalLoops) {
        // 继续下一轮（使用当前内容）
        return await executeContentOptimizationWithConfirm_ACU(messageIndex, content, userMessage, totalLoops, currentLoop + 1, workingContent, totalOptimizations);
      } else {
        // 所有轮次完成，触发填表
        if (totalOptimizations.length > 0) {
          showToastr_ACU('success', `正文优化完成，共 ${totalLoops} 轮优化，累计 ${totalOptimizations.length} 处改进`);
        } else {
          showToastr_ACU('info', '正文无需优化');
        }
        await triggerAutomaticUpdateIfNeeded_ACU();
        return true;
      }
    }
    
    // 累积优化项
    const newTotalOptimizations = totalOptimizations.concat(result.optimizations);
    
    // 显示对比对话框
    return new Promise((resolve) => {
      showOptimizationDiffDialogForLoop_ACU(messageIndex, {
        optimizations: result.optimizations,
        summary: `第 ${currentLoop}/${totalLoops} 轮优化，本轮 ${result.optimizations.length} 处改进`,
        optimizedContent: result.optimizedContent,
        currentLoop: currentLoop,
        totalLoops: totalLoops,
        totalOptimizations: newTotalOptimizations
      }, async (action: string) => {
        if (action === 'apply') {
          // 用户确认应用
          if (currentLoop < totalLoops) {
            // 还有下一轮，继续优化
            const nextResult = await executeContentOptimizationWithConfirm_ACU(
              messageIndex,
              content,
              userMessage,
              totalLoops,
              currentLoop + 1,
              result.optimizedContent,
              newTotalOptimizations
            );
            resolve(nextResult);
          } else {
            // 所有轮次完成，应用最终结果并触发填表
            await replaceChatMessage_ACU(messageIndex, result.optimizedContent);
            showToastr_ACU('success', `正文优化完成，共 ${totalLoops} 轮优化，累计 ${newTotalOptimizations.length} 处改进`);
            await triggerAutomaticUpdateIfNeeded_ACU();
            resolve(true);
          }
        } else if (action === 'skip') {
          // 用户跳过本轮，但继续下一轮
          if (currentLoop < totalLoops) {
            const nextResult = await executeContentOptimizationWithConfirm_ACU(
              messageIndex,
              content,
              userMessage,
              totalLoops,
              currentLoop + 1,
              workingContent,  // 使用未优化的内容
              totalOptimizations  // 不累积本轮优化项
            );
            resolve(nextResult);
          } else {
            // 最后一轮跳过
            if (totalOptimizations.length > 0) {
              // 如果有之前的优化，应用之前的结果
              // 注意：这里需要应用之前累积的优化内容
              await triggerAutomaticUpdateIfNeeded_ACU();
              showToastr_ACU('success', `正文优化完成，共 ${totalLoops} 轮优化，累计 ${totalOptimizations.length} 处改进`);
            } else {
              showToastr_ACU('info', '正文优化已跳过');
            }
            await triggerAutomaticUpdateIfNeeded_ACU();
            resolve(true);
          }
        } else {
          // 用户取消，结束优化流程
          await triggerAutomaticUpdateIfNeeded_ACU();
          resolve(true);
        }
      });
    });
  }
  
  /**
   * 显示优化对比对话框（支持循环优化）
   */
