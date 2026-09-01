/**
 * service/runtime/helpers-remaining.ts — 辅助函数集入口文件
 * 原 4,263 行代码已按职责拆分为以下子模块：
 *   - helpers-context-tags.ts    — 上下文标签提取/过滤
 *   - helpers-table-lock.ts      — 表格锁定与索引
 *   - helpers-data-merge.ts      — 数据合并/格式化/首楼初始化/阈值
 *   - helpers-template-vars.ts   — 模板变量系统（random/calc/max/min/seed/cell/cond/if）
 *   - helpers-plot-runtime.ts    — 剧情推进运行时（task执行/历史/规划/世界书内容）
 *
 * 本文件保留 handleChatCompletionReady_ACU（依赖多个子模块，不适合放入任何单一子模块），
 * 并 re-export 所有子模块的公开 API。
 */
import { currentJsonTableData_ACU, pendingFinalGenerationGreenlights_ACU, settings_ACU } from './state-manager';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { parseRandomTags_ACU, replaceRandomVariables_ACU, parseCalcTags_ACU, parseMaxTags_ACU, parseMinTags_ACU, replaceCalcVariables_ACU, replaceMaxVariables_ACU, replaceMinVariables_ACU, parseIfBlockRecursive_ACU, getLatestAIMessageContent_ACU, getLatestUserMessageContent_ACU, composeSeedMatchContent_ACU, replaceDbSqlVariables } from './template-vars';
import { getPlotFromHistory_ACU, getWorldbookContentForPlot_ACU, getAgentControlledWorldbookEntriesForFinalPrompt_ACU } from './plot-runtime';
import { ensurePlotAgentWorldbookSnapshotHydrated_ACU, isWorldbookTakeoverActive_ACU } from '../agent/agent-worldbook-takeover';

// ═══ 上下文标签提取/过滤 ═══
export {
    getDefaultPlotContextExtractRules_ACU,
    getDefaultPlotContextExcludeRules_ACU,
    applyExcludeRulesToText_ACU,
    applyContextTagFilters_ACU,
} from './helpers-context-tags';

// ═══ 表格锁定与索引 ═══
export {
    getTableLocksForSheet_ACU,
    getTableLockIdentitiesForSheet_ACU,
    makeCellLockKey_ACU,
    saveTableLocksForSheet_ACU,
    deleteTableLocksForSheet_ACU,
    toggleRowLock_ACU,
    toggleColLock_ACU,
    toggleCellLock_ACU,
    isSpecialIndexLockEnabled_ACU,
    setSpecialIndexLockEnabled_ACU,
    getSummaryIndexColumnIndex_ACU,
    formatSummaryIndexCode_ACU,
    applySummaryIndexSequenceToTable_ACU,
    applySpecialIndexSequenceToSummaryTables_ACU,
} from './helpers-table-lock';

// ═══ 数据合并/格式化/首楼初始化/阈值 ═══
export {
    mergeAllIndependentTables_ACU,
    mergeAllIndependentTablesLegacyV1_ACU,
    consumeLastMergeQuarantinedSheetKeys_ACU,
    consumeLastMergeWarnings_ACU,
    consumeLastMergeSourceInventory_ACU,
    formatJsonToReadable_ACU,
    shouldSuppressWorldbookInjection_ACU,
    maybeLiftWorldbookSuppression_ACU,
    fillFirstLayerWithTemplateData_ACU,
    getEffectiveAutoUpdateThreshold_ACU,
    isNewChatGreetingStage_ACU,
    isSingleAiNoUserChat_ACU,
    buildTemplateBaseStateDataForLocalStorage_ACU,
    ensureInitialSeedCheckpoint_ACU,
    seedGreetingLocalDataFromTemplate_ACU,
    parseReadableToJson_ACU,
    GREETING_LOCAL_BASE_STATE_MARKER_ACU,
} from './helpers-data-merge';

// ═══ 模板变量系统 ═══
export {
    parseRandomTags_ACU,
    replaceRandomVariables_ACU,
    parseCalcTags_ACU,
    parseMaxTags_ACU,
    parseMinTags_ACU,
    replaceCalcVariables_ACU,
    replaceMaxVariables_ACU,
    replaceMinVariables_ACU,
    parseIfBlockRecursive_ACU,
    parseIfBlocksInContent_ACU,
    getLatestAIMessageContent_ACU,
    getLatestUserMessageContent_ACU,
    composeSeedMatchContent_ACU,
} from './template-vars';

// ═══ 剧情推进运行时 ═══
export {
    formatOutlineTableForPlot_ACU,
    formatSummaryIndexForPlot_ACU,
    loadPresetAndCleanCharacterData_ACU,
    getPlotFromHistory_ACU,
    runOptimizationLogic_ACU,
    getWorldbookContentForPlot_ACU,
} from './plot-runtime';

// ═══ 保留在入口文件中的函数（依赖多个子模块） ═══

  function escapeAgentWorldbookRegExp_ACU(value: string) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeAgentWorldbookFilteredText_ACU(value: string) {
    return String(value || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function buildNativeWorldbookGreenlightRemovalCandidates_ACU(entry: any) {
    const content = String(entry?.content || '').trim();
    if (!content) return [];
    const comment = String(entry?.comment || entry?.rawComment || entry?.name || '').trim();
    const candidates: { text: string; requiresComment: boolean }[] = [];
    const addCandidate = (text: string, requiresComment: boolean) => {
      const normalized = String(text || '').trim();
      if (!normalized) return;
      if (candidates.some(candidate => candidate.text === normalized)) return;
      candidates.push({ text: normalized, requiresComment });
    };

    if (comment) {
      addCandidate(`# ${comment}\n${content}`, true);
      addCandidate(`[ACU Agent Greenlight: ${comment}]\n${content}`, true);
    }
    addCandidate(content, false);

    return candidates.sort((a, b) => b.text.length - a.text.length);
  }

  function isNativeWorldbookPromptMessage_ACU(message: any) {
    if (!message || typeof message !== 'object') return false;
    if (message.identifier === 'worldInfoBefore' || message.identifier === 'worldInfoAfter') return true;
    if (message.id === 'worldInfoBefore' || message.id === 'worldInfoAfter') return true;
    if (message.name === 'worldInfoBefore' || message.name === 'worldInfoAfter') return true;
    return false;
  }

  function shouldFilterNativeWorldbookMessage_ACU(message: any) {
    if (!message || typeof message !== 'object') return false;
    if (message.injected === true) return false;
    if (isNativeWorldbookPromptMessage_ACU(message)) return true;
    return String(message.role || '').trim().toLowerCase() === 'system';
  }

  function removeNativeWorldbookGreenlightText_ACU(text: string, entries: any[], allowRawContentOnly: boolean) {
    let result = String(text || '');
    let removedCount = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const comment = String(entry?.comment || entry?.rawComment || entry?.name || '').trim();
      const candidates = buildNativeWorldbookGreenlightRemovalCandidates_ACU(entry);
      for (const candidate of candidates) {
        if (!allowRawContentOnly && !candidate.requiresComment) continue;
        if (candidate.requiresComment && comment && !result.includes(comment)) continue;
        const pattern = new RegExp(`(?:\\n{0,2})${escapeAgentWorldbookRegExp_ACU(candidate.text)}(?:\\n{0,2})`, 'g');
        const before = result;
        result = result.replace(pattern, '\n\n');
        if (result !== before) removedCount++;
      }
    }
    return {
      text: removedCount > 0 ? normalizeAgentWorldbookFilteredText_ACU(result) : text,
      removedCount,
    };
  }

  function filterNativeWorldbookGreenlightsFromMessages_ACU(messages: any[], entries: any[]) {
    if (!Array.isArray(messages) || !Array.isArray(entries) || entries.length === 0) return 0;
    let totalRemoved = 0;
    for (const message of messages) {
      if (!shouldFilterNativeWorldbookMessage_ACU(message)) continue;
      const allowRawContentOnly = isNativeWorldbookPromptMessage_ACU(message);
      if (typeof message.content === 'string') {
        const result = removeNativeWorldbookGreenlightText_ACU(message.content, entries, allowRawContentOnly);
        message.content = result.text;
        totalRemoved += result.removedCount;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (!part || part.type !== 'text' || typeof part.text !== 'string') continue;
          const result = removeNativeWorldbookGreenlightText_ACU(part.text, entries, allowRawContentOnly);
          part.text = result.text;
          totalRemoved += result.removedCount;
        }
      }
    }
    return totalRemoved;
  }

  function buildAgentWorldbookRefKeySet_ACU(refs: any[]) {
    const keySet = new Set<string>();
    for (const ref of Array.isArray(refs) ? refs : []) {
      const bookName = String(ref?.bookName || '').trim();
      const uid = ref?.uid;
      if (!bookName || uid === null || uid === undefined || String(uid).trim() === '') continue;
      keySet.add(`${bookName}\u0000${String(uid).trim()}`);
    }
    return keySet;
  }

  function isAgentWorldbookEntryAllowed_ACU(entry: any, allowedKeySet: Set<string>) {
    if (allowedKeySet.size === 0) return false;
    const bookName = String(entry?.bookName || '').trim();
    const uid = entry?.uid;
    if (!bookName || uid === null || uid === undefined || String(uid).trim() === '') return false;
    return allowedKeySet.has(`${bookName}\u0000${String(uid).trim()}`);
  }

  function getTableDataForPrompt_ACU() {
    return currentJsonTableData_ACU || {};
  }

  export async function handleChatCompletionReady_ACU(data: any) {
    logDebug_ACU('[提示词模板] handleChatCompletionReady_ACU 被调用');
    logDebug_ACU('[提示词模板] settings_ACU?.promptTemplateSettings:', settings_ACU?.promptTemplateSettings);
    if (!settings_ACU?.promptTemplateSettings?.enabled) {
      logDebug_ACU('[提示词模板] 功能未启用，跳过处理');
      return;
    }
    if (!data || !data.messages || !Array.isArray(data.messages)) {
      return;
    }
    const finalGenerationGreenlights = Array.isArray(pendingFinalGenerationGreenlights_ACU) ? [...pendingFinalGenerationGreenlights_ACU] : [];
    let shouldHandleAgentWorldbookFinalPrompt = isWorldbookTakeoverActive_ACU() || finalGenerationGreenlights.length > 0;
    if (!shouldHandleAgentWorldbookFinalPrompt) {
      // 页面刷新后内存快照为空，接管可能仍在持久账本中活跃；水合一次后复判，
      // 否则冷启动首轮生成会跳过接管条目过滤。水合失败按未接管处理（内部已告警）。
      await ensurePlotAgentWorldbookSnapshotHydrated_ACU();
      shouldHandleAgentWorldbookFinalPrompt = isWorldbookTakeoverActive_ACU();
    }
    const startTime = Date.now();
    logDebug_ACU('[提示词模板] 开始处理酒馆提示词...');
    if (shouldHandleAgentWorldbookFinalPrompt) {
      try {
        const allAgentSkillWorldbookEntries = await getAgentControlledWorldbookEntriesForFinalPrompt_ACU(
          settings_ACU?.plotSettings || {},
        );
        const allowedFinalGreenlightKeySet = buildAgentWorldbookRefKeySet_ACU(finalGenerationGreenlights);
        const entriesToFilter = (Array.isArray(allAgentSkillWorldbookEntries) ? allAgentSkillWorldbookEntries : [])
          .filter(entry => !isAgentWorldbookEntryAllowed_ACU(entry, allowedFinalGreenlightKeySet));
        const filteredNativeCount = filterNativeWorldbookGreenlightsFromMessages_ACU(data.messages, entriesToFilter);
        if (filteredNativeCount > 0) {
          logDebug_ACU('[提示词模板] 已过滤酒馆原生正文世界书绿灯片段，数量:', filteredNativeCount);
        }
      } catch (e) {
        // 过滤失败意味着未放行的接管条目可能残留在最终提示词里，方向与接管语义相反，必须用 error 级可见。
        logError_ACU('[提示词模板] 运行时 Agent 正文世界书绿灯过滤失败，未放行条目可能残留在本轮提示词中:', e);
      }
    }
    const lastPlotContent = getPlotFromHistory_ACU();
    logDebug_ACU('[提示词模板] $6 最新一层推进数据:', lastPlotContent ? `长度=${lastPlotContent.length}` : '(空)');
    const context = {
      seedContent: composeSeedMatchContent_ACU(getLatestUserMessageContent_ACU(), getLatestAIMessageContent_ACU()),
      allTablesJson: getTableDataForPrompt_ACU(),
      plotContent: lastPlotContent
    };
    const processPromptTemplateContent_ACU = (content: any) => {
      if (typeof content !== 'string' || !content) {
        return typeof content === 'string' ? content : '';
      }
      let processedContent = content;
      processedContent = parseRandomTags_ACU(processedContent);
      processedContent = replaceRandomVariables_ACU(processedContent);
      const contextForCalc = { allTablesJson: context.allTablesJson };
      processedContent = parseCalcTags_ACU(processedContent, contextForCalc);
      processedContent = parseMaxTags_ACU(processedContent, contextForCalc);
      processedContent = parseMinTags_ACU(processedContent, contextForCalc);
      processedContent = replaceCalcVariables_ACU(processedContent);
      processedContent = replaceMaxVariables_ACU(processedContent);
      processedContent = replaceMinVariables_ACU(processedContent);
      // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
      processedContent = replaceDbSqlVariables(processedContent);
      processedContent = parseIfBlockRecursive_ACU(processedContent, context, 0);
      return processedContent;
    };
    let processedCount = 0;
    for (const message of data.messages) {
      if (typeof message.content === 'string') {
        const originalContent = message.content;
        message.content = processPromptTemplateContent_ACU(message.content);
        if (message.content !== originalContent) processedCount++;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            const originalText = part.text;
            part.text = processPromptTemplateContent_ACU(part.text);
            if (part.text !== originalText) processedCount++;
          }
        }
      }
    }
    const endTime = Date.now();
    logDebug_ACU(`[提示词模板] 处理完成，共处理 ${processedCount} 个消息块，耗时 ${endTime - startTime}ms`);
  }
