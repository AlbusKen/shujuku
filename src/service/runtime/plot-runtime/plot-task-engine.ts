/**
 * service/runtime/plot-runtime/plot-task-engine.ts
 * 剧情推进 — Task 执行引擎（排序/分组/上下文构建/单任务执行/运行时调度）+ 世界书内容获取
 * 从 helpers-plot-runtime.ts 拆出（L532-L1023 + L1513-L1618）
 */
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../../shared/defaults-json.js';
import { callApi_ACU, callApiWithPlotPreset_ACU, getApiConfigByPreset_ACU } from '../../ai/api-call';
import { abortController_ACU, currentChatFileIdentifier_ACU, currentJsonTableData_ACU, planningGuard_ACU, settings_ACU, tempPlotToSave_ACU, _set_tempPlotToSave_ACU, _set_currentJsonTableData_ACU, _set_pendingFinalGenerationGreenlights_ACU } from '../state-manager';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../../data/gateways/character-gateway';
import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { getPersonaDescription_ACU, getCharDescription_ACU } from '../../../data/gateways/host-state-gateway';
import { capturePlotRuntimeScope_ACU, isSamePlotRuntimeScope_ACU, isTransientLorebookNotFoundError_ACU, summarizePlotRuntimeError_ACU, summarizePlotRuntimeScope_ACU } from './plot-runtime-scope';
import { buildCombinedWorldbookContentByStrategy_ACU, collectCombinedWorldbookEntriesByStrategy_ACU, createStrictLorebookReadError_ACU, formatCombinedWorldbookEntries_ACU, getLorebookEntriesStrict_ACU, isStrictLorebookReadError_ACU, summarizeStrictLorebookReadError_ACU, type StrictLorebookReadContext_ACU } from '../../worldbook/pipeline';
import { createPlotWorldbookReadContext_ACU, type PlotWorldbookReadContext_ACU } from './plot-worldbook-read-context';
import { isDatabaseGeneratedLorebookEntry_ACU, resolveGeneratedEntriesForTable_ACU } from '../../worldbook/worldbook-placeholder-classification';
import { PlotStageError_ACU } from './plot-runtime-phase';
import { escapeRegExp_ACU, hashUserInput_ACU, isEntryBlocked_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU } from '../../../shared/utils';
import { ensurePlotTasksCompat_ACU, getPlotPromptContentByIdFromSettings_ACU, normalizePlotTask_ACU, normalizePlotTasks_ACU } from '../../plot/plot-logic';
import { parseRandomTags_ACU, replaceRandomVariables_ACU, getLatestAIMessageContent_ACU, getLatestUserMessageContent_ACU, composeSeedMatchContent_ACU, replaceDbSqlVariables } from '../template-vars';
import { applyContextTagFilters_ACU, applyExcludeRulesToText_ACU } from '../helpers-context-tags';
import { mergeAllIndependentTables_ACU } from '../helpers-data-merge';
import { formatTableDataForLLM_ACU, formatOutlineTableForPlot_ACU, formatSummaryIndexForPlot_ACU, getSummaryIndexContentForPlot_ACU } from './plot-data-format';
import { getNormalizedPlotMessageRole_ACU, tryRenderPlotTemplateWithEjs_ACU, renderPlotTaskContentWithIsolatedVariables_ACU, extractPlotTagsFromResponse_ACU, getPlotPlaceholderTagNames_ACU, buildPlotTagMapFromText_ACU, replacePlotTagPlaceholders_ACU, buildTaskWorldbookTriggerText_ACU, sortPlotTaskResults_ACU, aggregatePlotTaskTags_ACU, buildPlotSaveContentFromTaskResults_ACU, buildFinalPlotInjectionMessage_ACU } from './plot-tag-utils';
import { flushPlotPendingSave_ACU, getPlotFromHistory_ACU, savePlotToLatestMessage_ACU } from './plot-history-preset';
import { abortableDelay } from '../../../shared/abortable-delay';
import { runAgentDecisionForPlot_ACU, type AgentDecisionResult_ACU, type AgentWorldbookRef_ACU } from '../../agent/agent-decision-engine';
import { normalizeAgentContextSettings_ACU } from '../../agent/agent-prompt-template';
import { getWorldbookEntryKeywordsForSkillify_ACU, isDatabaseGeneratedWorldbookEntryForAgent_ACU } from '../../agent/agent-skillify-service';
import { clearFinalGenerationGreenlights_ACU, resolvePreTakeoverWorldbookSnapshot_ACU, writeFinalGenerationGreenlights_ACU } from '../../agent/agent-worldbook-takeover';
import { hasUsableWorldbookSkillMeta_ACU, resolveAgentWorldbookFilterAvailability_ACU } from '../../agent/agent-worldbook-skill-meta';
import { WorldSimulationHiddenContextProvider_ACU } from '../../simulation/injection-provider';

  type PlotWorldbookAgentMode_ACU = 'normal' | 'agent-controlled';

  const CHARACTER_LOREBOOK_RETRY_DELAY_MS_ACU = 300;

  class CharacterLorebookScopeChangedError_ACU extends Error {
    constructor() {
      super('CharacterLorebookScopeChanged');
      this.name = 'CharacterLorebookScopeChangedError_ACU';
    }
  }

  type PlotWorldbookContentOptions_ACU = AgentWorldbookRef_ACU[] | {
    agentGreenlights?: AgentWorldbookRef_ACU[];
    agentMode?: PlotWorldbookAgentMode_ACU;
    excludeEntry?: (entry: any) => boolean;
    entryScope?: (entry: any) => boolean;
    includeGeneratedEntries?: boolean;
    readContext?: PlotWorldbookReadContext_ACU;
    entriesByBook?: Record<string, any[]>;
  };

  function hasPlotTaskAgentSkill_ACU(task: Record<string, any> | null | undefined): boolean {
    return !!String(task?.description || '').trim() || !!String(task?.triggerWhen || '').trim();
  }

  function isAgentControlledFinalPromptWorldbookEntry_ACU(entry: Record<string, any>): boolean {
    if (!entry) return false;
    if (String(entry.type || '').trim().toLowerCase() === 'constant') return false;
    if (isDatabaseGeneratedWorldbookEntryForAgent_ACU(entry)) return false;
    return getWorldbookEntryKeywordsForSkillify_ACU(entry).length > 0;
  }

  function isAgentControlledWorldbookEntryForPlot_ACU(entry: Record<string, any>): boolean {
    if (!entry || isDatabaseGeneratedWorldbookEntryForAgent_ACU(entry)) return false;
    return hasUsableWorldbookSkillMeta_ACU(entry?.comment || entry?.rawComment || entry?.name);
  }

  function shouldUseAgentWorldbookForPlotTask_ACU(task: Record<string, any>, agentDecision: AgentDecisionResult_ACU | null | undefined): boolean {
    return agentDecision?.active === true && task?.agentControl?.selectable !== false && hasPlotTaskAgentSkill_ACU(task);
  }

  function normalizePlotWorldbookContentOptions_ACU(options: PlotWorldbookContentOptions_ACU = []) {
    if (Array.isArray(options)) {
      return { agentGreenlights: options, agentMode: (options.length > 0 ? 'agent-controlled' : 'normal') as PlotWorldbookAgentMode_ACU };
    }
    const agentMode = options?.agentMode === 'agent-controlled' ? 'agent-controlled' : 'normal';
    return {
      agentGreenlights: Array.isArray(options?.agentGreenlights) ? options.agentGreenlights : [],
      agentMode,
      excludeEntry: typeof options?.excludeEntry === 'function' ? options.excludeEntry : undefined,
      entryScope: typeof options?.entryScope === 'function' ? options.entryScope : undefined,
      includeGeneratedEntries: options?.includeGeneratedEntries === true,
      readContext: options?.readContext,
      entriesByBook: options?.entriesByBook && typeof options.entriesByBook === 'object' ? options.entriesByBook : undefined,
    };
  }

  function checkPlotAbortRequested_ACU() {
    if (abortController_ACU && abortController_ACU.signal.aborted) {
      throw new Error('TaskAbortedByUser');
    }
  }

  function getPlotTaskApiPresetOverrides_ACU(): Record<string, string> {
    if (!settings_ACU.plotTaskApiPresetOverridesById || typeof settings_ACU.plotTaskApiPresetOverridesById !== 'object' || Array.isArray(settings_ACU.plotTaskApiPresetOverridesById)) {
      settings_ACU.plotTaskApiPresetOverridesById = {};
    }
    return settings_ACU.plotTaskApiPresetOverridesById;
  }

  function resolvePlotTaskApiPreset_ACU(task: any): string {
    const taskId = String(task?.id || '').trim();
    if (taskId) {
      const mappedPreset = String(getPlotTaskApiPresetOverrides_ACU()[taskId] || '').trim();
      if (mappedPreset) return mappedPreset;
    }
    const legacyTaskPreset = String(task?.taskApiPreset || '').trim();
    if (legacyTaskPreset) return legacyTaskPreset;
    return String(settings_ACU.plotApiPreset || '').trim();
  }

  export function willPlotUseMainApiGenerateRaw_ACU(taskApiPreset: string = '') {
    try {
      const effectivePreset = String(taskApiPreset || '').trim() || String(settings_ACU.plotApiPreset || '').trim();
      const apiPresetConfig: any = getApiConfigByPreset_ACU(effectivePreset) || {};
      const effectiveApiMode = apiPresetConfig.apiMode ?? settings_ACU.apiMode;
      const effectiveApiConfig = apiPresetConfig.apiConfig || settings_ACU.apiConfig || {};
      return effectiveApiMode !== 'tavern' && !!effectiveApiConfig.useMainApi;
    } catch (e) {
      return settings_ACU.apiMode !== 'tavern' && !!settings_ACU.useMainApi;
    }
  }

  function sortPlotTasksForRuntime_ACU(tasks: any[]) {
    return (Array.isArray(tasks) ? [...tasks] : [])
      .filter(Boolean)
      .sort((a, b) => (normalizePositiveInteger_ACU(a?.stage, 1) - normalizePositiveInteger_ACU(b?.stage, 1)) || ((a?.order ?? 0) - (b?.order ?? 0)));
  }

  function groupPlotTasksByStage_ACU(tasks: any[]) {
    const stageGroups: { stage: number; tasks: any[] }[] = [];
    sortPlotTasksForRuntime_ACU(tasks).forEach((task: any) => {
      const stageNo = normalizePositiveInteger_ACU(task?.stage, 1);
      let currentGroup = stageGroups[stageGroups.length - 1];
      if (!currentGroup || currentGroup.stage !== stageNo) {
        currentGroup = { stage: stageNo, tasks: [] };
        stageGroups.push(currentGroup);
      }
      currentGroup.tasks.push(task);
    });
    return stageGroups;
  }

  function getEnabledPlotTasks_ACU(plotSettings: Record<string, any>) {
    return sortPlotTasksForRuntime_ACU(
      normalizePlotTasks_ACU(plotSettings)
        .filter((task: any) => task && task.enabled !== false),
    );
  }

  async function buildPlotSharedContext_ACU(plotSettings: Record<string, any>, userMessage: string, runtimeOptions: any = {}) {
    const readContext: PlotWorldbookReadContext_ACU | undefined = runtimeOptions.readContext;
    const chat = getChatArray_ACU();
    const contextTurnCount = plotSettings.contextTurnCount ?? 1;
    let slicedContext: { role: string; content: string }[] = [];
    let contextEndIndex = (chat?.length || 0) - 1;
    if (contextEndIndex >= 0 && chat[contextEndIndex] && chat[contextEndIndex].is_user) {
      if (String(chat[contextEndIndex].mes || '') === String(userMessage || '')) {
        contextEndIndex -= 1;
      }
    }
    const agentContextMessages = contextEndIndex >= 0 ? chat.slice(0, contextEndIndex + 1) : [];

    if (contextTurnCount > 0) {
      let aiCount = 0;
      const extracted: { role: string; content: string }[] = [];

      for (let i = contextEndIndex; i >= 0 && aiCount < contextTurnCount; i--) {
        const msg = chat[i];
        if (!msg) continue;
        if (msg.is_user) continue;
        if (msg._qrf_from_planning) continue;

        let content = msg.mes;
        const extractTags = (plotSettings.contextExtractTags || '').trim();
        const extractRules = normalizeExtractRules_ACU(plotSettings.contextExtractRules, extractTags);
        const excludeTags = (plotSettings.contextExcludeTags || '').trim();
        const excludeRules = normalizeExcludeRules_ACU(plotSettings.contextExcludeRules, excludeTags);
        if (extractTags || extractRules.length > 0 || excludeTags || excludeRules.length > 0) {
          content = applyContextTagFilters_ACU(content, { extractTags, extractRules, excludeTags, excludeRules });
        }

        extracted.unshift({ role: 'assistant', content });
        aiCount++;
      }

      slicedContext = extracted;
    }

    const historyAnchorText = String(runtimeOptions.inputForHash ?? userMessage ?? '');
    const historyLookupOptions = runtimeOptions.hasExistingUserMessage && historyAnchorText.trim()
      ? {
        beforeUserInputHash: hashUserInput_ACU(historyAnchorText),
        beforeUserInputText: historyAnchorText,
      }
      : {};
    const lastPlotContent = getPlotFromHistory_ACU(historyLookupOptions);
    logDebug_ACU('[剧情推进] $6 上轮规划数据:', lastPlotContent ? `长度=${lastPlotContent.length}` : '(空)');

    // 世界书内容不再在此处用整段 lastPlotContent 预计算，
    // 而是延迟到 executeSinglePlotTask_ACU 中按任务实际 {{tag}} 注入内容按需计算。
    let worldbookContent = '';
    logDebug_ACU('[剧情推进] $1 世界书内容: 延迟到任务级计算');

    let outlineTableContent = '';
    try {
      if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') {
        try {
          const merged = await mergeAllIndependentTables_ACU();
          if (merged && typeof merged === 'object') {
            _set_currentJsonTableData_ACU(merged);
          }
        } catch (e) { logWarn_ACU('[剧情任务] 合并表格数据失败, 剧情推进可能使用过时数据:', e); }
      }

      const summaryIndexWorldbookContent = await getSummaryIndexContentForPlot_ACU(plotSettings);
      if (typeof summaryIndexWorldbookContent === 'string' && summaryIndexWorldbookContent.trim()) {
        outlineTableContent = summaryIndexWorldbookContent;
        logDebug_ACU('[剧情推进] $5 使用世界书纪要索引条目内容');
      } else if (currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object') {
        const summaryIndexResult = formatSummaryIndexForPlot_ACU(currentJsonTableData_ACU);
        if (summaryIndexResult.success) {
          outlineTableContent = summaryIndexResult.content;
          logDebug_ACU('[剧情推进] $5 未找到世界书纪要索引条目，使用纪要表的概要和编码索引列');
        } else {
          logDebug_ACU('[剧情推进] $5 纪要表读取失败，回退使用总体大纲表。原因:', summaryIndexResult.content);
          outlineTableContent = formatOutlineTableForPlot_ACU(currentJsonTableData_ACU);
          logDebug_ACU('[剧情推进] $5 回退使用总体大纲表内容');
        }
      } else {
        outlineTableContent = '纪要索引：当前未加载到数据库数据。';
      }
    } catch (error) {
      logError_ACU('[剧情推进] 生成纪要索引($5)时出错:', error);
      outlineTableContent = '{"error": "加载表格数据时发生错误"}';
    }

    const plotExcludeTags = (plotSettings.contextExcludeTags || '').trim();
    const plotExcludeRules = normalizeExcludeRules_ACU(plotSettings.contextExcludeRules, plotExcludeTags);
    const filterPlotInjectedContent = (value: any, placeholderKey: string = '') => {
      const text = value !== undefined && value !== null ? String(value) : '';
      if (!['$1', '$5', '$6', '$7', '$8', '$9', '$U', '$C'].includes(placeholderKey)) return text;
      return applyExcludeRulesToText_ACU(text, { excludeRules: plotExcludeRules, excludeTags: plotExcludeTags });
    };

    const isUniqueCurrentTableName = (tableName: string, tableData: Record<string, any>) => {
      const normalizedTableName = String(tableName || '').trim();
      if (!normalizedTableName || !tableData || typeof tableData !== 'object') return false;
      return Object.values(tableData).filter((table: any) => (
        table
        && typeof table === 'object'
        && String(table.name || '').trim() === normalizedTableName
      )).length === 1;
    };

    const wrapWorldbookContext = (content: any, placeholderKey: string) => {
      const filteredContent = filterPlotInjectedContent(content, placeholderKey);
      return filteredContent ? `\n<worldbook_context>\n${filteredContent}\n</worldbook_context>\n` : '';
    };

    const resolveTableWorldbookContent = async (
      tableName: string,
      extraBaseText: string = '',
      worldbookOptions: PlotWorldbookContentOptions_ACU = [],
    ): Promise<string | null> => {
      const normalizedTableName = String(tableName || '').trim();
      const tableData = currentJsonTableData_ACU;
      const validIdentity = isUniqueCurrentTableName(normalizedTableName, tableData);
      if (!validIdentity) {
        logDebug_ACU('[剧情推进][世界书] 表名占位符观测', { phase: 'table_token', tokenCount: 1, validIdentityCount: 0, candidateBookCount: 0, indexBuildCount: readContext?.tableIndexBuildCount ?? 0 });
        return null;
      }
      try {
        if (!readContext) throw new Error('StrictLorebookRead:missing_context');
        const [index, scopedKeys] = await Promise.all([
          readContext.tableWorldbookIndexPromise,
          readContext.getTableWorldbookScopedKeys(normalizedTableName, tableData),
        ]);
        logDebug_ACU('[剧情推进][世界书] 表名占位符观测', {
          phase: 'table_token',
          tokenCount: 1,
          validIdentityCount: 1,
          candidateBookCount: Object.keys(index?.entriesByBook || {}).length,
          indexBuildCount: readContext?.tableIndexBuildCount ?? 0,
        });
        if (scopedKeys.size === 0) return '';
        const content = await getWorldbookContentForPlot_ACU(plotSettings, userMessage, extraBaseText, {
          ...worldbookOptions,
          includeGeneratedEntries: true,
          entryScope: (entry: any) => scopedKeys.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`),
          readContext,
          entriesByBook: index.entriesByBook,
        });
        return wrapWorldbookContext(content, '$1');
      } catch (error) {
        if (String((error as any)?.message || '').startsWith('StrictLorebookRead:')) throw error;
        logWarn_ACU('[剧情推进][世界书] 表名占位符解析失败，保留原 token。', {
          phase: 'table_token',
          scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
          error: summarizePlotRuntimeError_ACU(error),
        });
        return null;
      }
    };

    const resolveTableWorldbookTokens = async (
      text: string,
      extraBaseText: string = '',
      worldbookOptions: PlotWorldbookContentOptions_ACU = [],
    ) => {
      if (!text || !text.includes('{{')) return text;
      const resolvedByToken = new Map<string, string | null>();
      const tokens = [...text.matchAll(/\{\{([^{}]+)\}\}/g)];
      for (const token of tokens) {
        const rawToken = token[0];
        if (resolvedByToken.has(rawToken)) continue;
        resolvedByToken.set(rawToken, await resolveTableWorldbookContent(token[1], extraBaseText, worldbookOptions));
      }
      return text.replace(/\{\{([^{}]+)\}\}/g, (rawToken) => resolvedByToken.get(rawToken) ?? rawToken);
    };

    const sanitizeHtml = (htmlString: string): string => {
      if (!htmlString) return '';
      return String(htmlString)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
    };

    const formattedHistory = (slicedContext && Array.isArray(slicedContext) ? slicedContext : [])
      .map(msg => `assistant："${sanitizeHtml(msg.content)}"`)
      .join(' \n ');

    const contextInjectionText = formattedHistory && formattedHistory.trim()
      ? `以下是前文的故事发展（AI输出），给你用作参考：\n ${formattedHistory}`
      : '';

    let userInfoContent_Plot = '';
    try {
      userInfoContent_Plot = getPersonaDescription_ACU();
      logDebug_ACU(`[剧情推进] $U (persona_description) 获取结果: ${userInfoContent_Plot ? '成功' : '为空'}`);
    } catch (e) {
      logWarn_ACU('[剧情推进] 获取用户设定描述时出错:', e);
      userInfoContent_Plot = '';
    }

    let charInfoContent_Plot = '';
    try {
      charInfoContent_Plot = getCharDescription_ACU();
      logDebug_ACU(`[剧情推进] $C (char_description) 获取结果: ${charInfoContent_Plot ? '成功，长度=' + charInfoContent_Plot.length : '为空'}`);
    } catch (e) {
      logWarn_ACU('[剧情推进] 获取角色描述时出错:', e);
      charInfoContent_Plot = '';
    }

    const hiddenSystemContext = new WorldSimulationHiddenContextProvider_ACU().render({ plotEnabled: plotSettings.enabled === true });
    const replacements: Record<string, any> = {
      sulv1: plotSettings.rateMain,
      sulv2: plotSettings.ratePersonal,
      sulv3: plotSettings.rateErotic,
      sulv4: plotSettings.rateCuckold,
      zhaohui: plotSettings.recallCount,
      $5: outlineTableContent,
      $6: lastPlotContent,
      $7: contextInjectionText,
      $8: userMessage,
      $9: '',
      $U: userInfoContent_Plot,
      $C: charInfoContent_Plot,
    };

    const performReplacements = (text: string, taskOverrides: Record<string, any> = {}) => {
      if (!text) return '';
      let processed = text;

      // 任务级世界书内容优先；若未提供则使用共享预计算值（当前为空）
      const effectiveWorldbookContent = taskOverrides.$1 !== undefined
        ? String(taskOverrides.$1)
        : worldbookContent;
      processed = processed.replace(/(?<!\\)\$1/g, wrapWorldbookContext(effectiveWorldbookContent, '$1'));

      const effectiveDatabaseExcludedWorldbookContent = taskOverrides.$9 !== undefined
        ? String(taskOverrides.$9)
        : String(replacements.$9 || '');
      processed = processed.replace(/(?<!\\)\$9/g, wrapWorldbookContext(effectiveDatabaseExcludedWorldbookContent, '$9'));

      for (const key in replacements) {
        if (key === '$9') continue;
        const value = taskOverrides[key] !== undefined ? taskOverrides[key] : replacements[key];
        const regex = new RegExp(escapeRegExp_ACU(key), 'g');
        const filteredValue = filterPlotInjectedContent(value, key);
        processed = processed.replace(regex, () => filteredValue);
      }
      return processed;
    };

    // 世界书后处理已在任务级逻辑中完成；共享阶段不再做后处理

    const defaultDirective = '[SYSTEM_DIRECTIVE: You are a storyteller. The following <plot> block is your absolute script for this turn. You MUST follow the <directive> within it to generate the story.]';
    let finalSystemDirectiveContent = defaultDirective;
    let rawFinal = getPlotPromptContentByIdFromSettings_ACU(plotSettings, 'finalSystemDirective')
      || plotSettings.finalSystemDirective
      || '';
    rawFinal = await resolveTableWorldbookTokens(rawFinal);
    rawFinal = await tryRenderPlotTemplateWithEjs_ACU(rawFinal);
    const plotFinalDirective = performReplacements(rawFinal);
    let finalWithRandom = parseRandomTags_ACU(plotFinalDirective);
    finalWithRandom = replaceRandomVariables_ACU(finalWithRandom);
    // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下）
    finalWithRandom = replaceDbSqlVariables(finalWithRandom);
    if (finalWithRandom && finalWithRandom.trim()) {
      finalSystemDirectiveContent = finalWithRandom.trim();
    }

    let seedContentForConditional = '';
    try {
      seedContentForConditional = composeSeedMatchContent_ACU(
        getLatestUserMessageContent_ACU(),
        getLatestAIMessageContent_ACU(),
      );
      logDebug_ACU('[剧情推进] 条件模板检测内容长度:', seedContentForConditional.length);
    } catch (e) {
      logWarn_ACU('[剧情推进] 准备条件模板检测内容时出错:', e);
    }

    return {
      plotSettings,
      userMessage,
      lastPlotContent,
      performReplacements,
      resolveTableWorldbookTokens,
      finalSystemDirectiveContent,
      hiddenSystemContext,
      seedContentForConditional,
      recentContextMessages: Array.isArray(agentContextMessages) ? agentContextMessages : [],
      allTablesJson: currentJsonTableData_ACU,
    };
  }

  async function renderPlotTaskMessages_ACU(task: Record<string, any>, sharedContext: Record<string, any>, runtimeOptions: any = {}) {
    const promptGroup = JSON.parse(JSON.stringify(task?.promptGroup || []));
    const messagesToUse = Array.isArray(promptGroup) ? promptGroup : [];
    const historyTagMap = runtimeOptions.historyTagMap instanceof Map
      ? runtimeOptions.historyTagMap
      : buildPlotTagMapFromText_ACU(sharedContext.lastPlotContent, null);
    const relayTagMap = runtimeOptions.relayTagMap instanceof Map ? runtimeOptions.relayTagMap : new Map();

    // 构建 $1 的任务级覆盖值（任务级世界书内容）
    const replacementOverrides: Record<string, any> = {};
    if (sharedContext.taskWorldbookContent !== undefined) {
      replacementOverrides.$1 = sharedContext.taskWorldbookContent;
    }
    if (sharedContext.taskWorldbookDatabaseExcludedContent !== undefined) {
      replacementOverrides.$9 = sharedContext.taskWorldbookDatabaseExcludedContent;
    }

    for (const seg of messagesToUse) {
      if (!seg || typeof seg.content !== 'string') continue;
      let c = seg.content;
      if (typeof sharedContext.resolveTaskTableWorldbookTokens === 'function') {
        c = await sharedContext.resolveTaskTableWorldbookTokens(c);
      }
      c = await tryRenderPlotTemplateWithEjs_ACU(c);
      c = sharedContext.performReplacements(c, replacementOverrides);
      c = replacePlotTagPlaceholders_ACU(c, relayTagMap, historyTagMap);
      c = renderPlotTaskContentWithIsolatedVariables_ACU(c, sharedContext);
      seg.__renderedContent = c;
    }

    const rendered = messagesToUse
      .filter(seg => seg && typeof seg.__renderedContent === 'string' && seg.__renderedContent.trim().length > 0)
      .map(seg => ({ role: getNormalizedPlotMessageRole_ACU(seg.role), content: seg.__renderedContent }));
    const hiddenSystemContext = typeof sharedContext.hiddenSystemContext === 'string' ? sharedContext.hiddenSystemContext.trim() : '';
    if (hiddenSystemContext) rendered.push({ role: 'system', content: hiddenSystemContext });
    return rendered;
  }

  function getPlotPromptGroupForWorldbookTrigger_ACU(promptGroup: any[]): any[] {
    const tableNameCounts = new Map<string, number>();
    for (const table of Object.values(currentJsonTableData_ACU || {})) {
      const tableName = String((table as any)?.name || '').trim();
      if (tableName) tableNameCounts.set(tableName, (tableNameCounts.get(tableName) || 0) + 1);
    }
    const uniqueTableNames = new Set([...tableNameCounts]
      .filter(([, count]) => count === 1)
      .map(([tableName]) => tableName));
    if (uniqueTableNames.size === 0) return Array.isArray(promptGroup) ? promptGroup : [];

    return (Array.isArray(promptGroup) ? promptGroup : []).map(segment => {
      if (!segment || typeof segment.content !== 'string') return segment;
      return {
        ...segment,
        content: segment.content.replace(/\{\{([^{}]+)\}\}/g, (token: string, tableName: string) => (
          uniqueTableNames.has(String(tableName || '').trim()) ? '' : token
        )),
      };
    });
  }

  async function executeSinglePlotTask_ACU(task: Record<string, any>, sharedContext: Record<string, any>, runtimeOptions: any = {}) {
    const normalizedTask = normalizePlotTask_ACU(task, { index: task?.order ?? 0, fallbackTask: task || null });
    const taskLabel = normalizedTask.name || normalizedTask.id || '未命名任务';
    const taskStage = normalizePositiveInteger_ACU(normalizedTask.stage, 1);
    const maxRetries = normalizePositiveInteger_ACU(
      normalizedTask.maxRetries,
      sharedContext?.plotSettings?.loopSettings?.maxRetries ?? DEFAULT_PLOT_SETTINGS_ACU.loopSettings?.maxRetries ?? 3,
    );
    const minLength = normalizeNonNegativeInteger_ACU(normalizedTask.minLength, 0);

    // 任务级世界书计算：基于当前任务实际使用的 {{tag}} 注入内容 + 本轮上下文触发，
    // 而不是固定使用整段上一轮剧情内容。
    // 标签来源与 renderPlotTaskMessages_ACU 一致：
    // - 若本轮已完成任务产出目标标签：优先用本轮 relayTagMap
    // - 否则回退到 historyTagMap / lastPlotContent（上一轮历史）
    let taskWorldbookContent = '';
    let taskWorldbookDatabaseExcludedContent = '';
    let resolveTaskTableWorldbookTokens: ((text: string) => Promise<string>) | undefined;
    try {
      const taskPlotContent = String(sharedContext.lastPlotContent || '');
      const effectiveRelayTagMap = runtimeOptions.relayTagMap instanceof Map
        ? runtimeOptions.relayTagMap
        : undefined;
      // 从任务 prompt 中提取 {{tag}}，按实际标签来源取对应内容，构造触发文本
      const triggerPromptGroup = getPlotPromptGroupForWorldbookTrigger_ACU(normalizedTask.promptGroup);
      const worldbookTriggerText = buildTaskWorldbookTriggerText_ACU(triggerPromptGroup, taskPlotContent, effectiveRelayTagMap, runtimeOptions.historyTagMap);
      if (worldbookTriggerText) {
        logDebug_ACU(`[剧情推进] [任务:${taskLabel}] 基于 {{tag}} 注入内容构造世界书触发文本，长度: ${worldbookTriggerText.length}`);
      } else {
        logDebug_ACU(`[剧情推进] [任务:${taskLabel}] 无 {{tag}} 注入内容，世界书仅基于本轮上下文触发`);
      }
      const forceNormalWorldbook = sharedContext.forceNormalWorldbook === true;
      const usesAgentWorldbook = !forceNormalWorldbook && shouldUseAgentWorldbookForPlotTask_ACU(normalizedTask, sharedContext.agentDecision);
      const taskAgentGreenlights = usesAgentWorldbook
        ? (sharedContext.agentDecision?.plotGreenlights?.[String(normalizedTask.id || '').trim()] || [])
        : [];
      const taskPromptGroup = Array.isArray(normalizedTask.promptGroup) ? normalizedTask.promptGroup : [];
      const needsDatabaseExcludedWorldbook = taskPromptGroup.some((segment: any) => /(?<!\\)\$9/.test(String(segment?.content || '')));
      const taskWorldbookOptions = {
        agentMode: usesAgentWorldbook && !forceNormalWorldbook ? 'agent-controlled' : 'normal',
        agentGreenlights: taskAgentGreenlights,
        readContext: sharedContext.worldbookReadContext,
      } as const;
      const worldbookContents = await Promise.all([
        getWorldbookContentForPlot_ACU(sharedContext.plotSettings, sharedContext.userMessage, worldbookTriggerText, taskWorldbookOptions),
        needsDatabaseExcludedWorldbook
          ? getWorldbookContentForPlot_ACU(sharedContext.plotSettings, sharedContext.userMessage, worldbookTriggerText, {
          ...taskWorldbookOptions,
          excludeEntry: isDatabaseGeneratedLorebookEntry_ACU,
          })
          : Promise.resolve(''),
      ]);
      [taskWorldbookContent, taskWorldbookDatabaseExcludedContent] = worldbookContents;
      if (taskWorldbookContent) {
        // 对任务级世界书内容执行与共享管线相同的后处理
        taskWorldbookContent = await tryRenderPlotTemplateWithEjs_ACU(taskWorldbookContent);
        taskWorldbookContent = parseRandomTags_ACU(taskWorldbookContent);
        taskWorldbookContent = replaceRandomVariables_ACU(taskWorldbookContent);
        taskWorldbookContent = replaceDbSqlVariables(taskWorldbookContent);
        logDebug_ACU(`[剧情推进] [任务:${taskLabel}] 任务级世界书内容长度: ${taskWorldbookContent.length}`);
      }
      if (taskWorldbookDatabaseExcludedContent) {
        taskWorldbookDatabaseExcludedContent = await tryRenderPlotTemplateWithEjs_ACU(taskWorldbookDatabaseExcludedContent);
        taskWorldbookDatabaseExcludedContent = parseRandomTags_ACU(taskWorldbookDatabaseExcludedContent);
        taskWorldbookDatabaseExcludedContent = replaceRandomVariables_ACU(taskWorldbookDatabaseExcludedContent);
        taskWorldbookDatabaseExcludedContent = replaceDbSqlVariables(taskWorldbookDatabaseExcludedContent);
      }

      resolveTaskTableWorldbookTokens = (text: string) => sharedContext.resolveTableWorldbookTokens(
        text,
        worldbookTriggerText,
        taskWorldbookOptions,
      );
    } catch (wbError) {
      if (wbError?.message === 'TaskAbortedByUser' || wbError?.name === 'AbortError' || String(wbError?.message || '').toLowerCase().includes('aborted')) {
        throw wbError;
      }
      logWarn_ACU(`[剧情推进] [任务:${taskLabel}] 严格世界书读取失败，已阻断 AI 调用。`, {
        phase: 'strict_worldbook_read',
        runId: sharedContext.worldbookReadContext?.runId || '',
        error: summarizeStrictLorebookReadError_ACU(wbError) || summarizePlotRuntimeError_ACU(wbError),
      });
      return {
        taskId: normalizedTask.id,
        taskName: taskLabel,
        success: false,
        rawResponse: '',
        extractedTags: {},
        injectedFragments: [],
        error: '必需世界书读取失败，已阻断任务 AI 调用。',
        stage: taskStage,
        order: normalizedTask.order ?? 0,
      };
    }

    // 构建任务级共享上下文：覆盖 $1/$9 替换值，并在 EJS 前解析表名占位符。
    const taskSharedContext = {
      ...sharedContext,
      taskWorldbookContent,
      taskWorldbookDatabaseExcludedContent,
      resolveTaskTableWorldbookTokens,
    };

    try {
      checkPlotAbortRequested_ACU();
      const messages = await renderPlotTaskMessages_ACU(normalizedTask, taskSharedContext, runtimeOptions);
      checkPlotAbortRequested_ACU();

      if (!messages.length) {
        return {
          taskId: normalizedTask.id,
          taskName: taskLabel,
          success: false,
          rawResponse: '',
          extractedTags: {},
          injectedFragments: [],
          error: '任务未生成任何有效提示词消息。',
          stage: taskStage,
          order: normalizedTask.order ?? 0,
        };
      }

      let rawResponse = '';
      let lastErrorMessage = '';
      let acceptedTagExtraction: ReturnType<typeof extractPlotTagsFromResponse_ACU> | null = null;

      for (let attemptIndex = 0; attemptIndex < maxRetries; attemptIndex++) {
        checkPlotAbortRequested_ACU();

        const effectivePlotApiPreset = resolvePlotTaskApiPreset_ACU(normalizedTask);
        if (willPlotUseMainApiGenerateRaw_ACU(effectivePlotApiPreset)) {
          planningGuard_ACU.ignoreNextGenerationEndedCount++;
        }

        let tempMessage = null;
        let apiError = null;
        try {
          logDebug_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 使用任务级API预设: ${effectivePlotApiPreset || '当前配置'}`);
          tempMessage = await callApiWithPlotPreset_ACU(messages, effectivePlotApiPreset, abortController_ACU?.signal || null);
        } catch (apiCallError) {
          if (apiCallError?.name === 'AbortError' || String(apiCallError?.message || '').toLowerCase().includes('aborted')) {
            throw apiCallError;
          }
          apiError = apiCallError;
          lastErrorMessage = apiCallError?.message || 'API调用失败';
          logWarn_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 第 ${attemptIndex + 1} 次API调用失败:`, lastErrorMessage);
        }

        checkPlotAbortRequested_ACU();

        if (!apiError && tempMessage) {
          if (minLength > 0 && tempMessage.length < minLength) {
            lastErrorMessage = `回复长度不足（${tempMessage.length}/${minLength}）`;
            logWarn_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 第 ${attemptIndex + 1} 次回复过短: ${tempMessage.length}/${minLength}`);
          } else {
            const candidateTagExtraction = extractPlotTagsFromResponse_ACU(
              tempMessage,
              normalizedTask.extractTags,
              normalizedTask.extractInjectTags,
            );
            if (candidateTagExtraction.tagNames.length > 0 && Object.keys(candidateTagExtraction.extractedTags).length === 0) {
              const expectedTagNames = candidateTagExtraction.tagNames.join(', ');
              lastErrorMessage = `未提取到任何配置标签（${expectedTagNames}）`;
              logWarn_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 第 ${attemptIndex + 1} 次回复未包含任何配置标签: ${expectedTagNames}`);
            } else {
              rawResponse = tempMessage;
              acceptedTagExtraction = candidateTagExtraction;
              logDebug_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 在第 ${attemptIndex + 1} 次尝试中成功完成。`);
              break;
            }
          }
        }

        if (attemptIndex < maxRetries - 1) {
          // 可被 abort 信号中断的等待，避免用户点中止后还要等 5 秒
          await abortableDelay(5000, abortController_ACU?.signal);
        }
      }

      if (!rawResponse || !acceptedTagExtraction) {
        return {
          taskId: normalizedTask.id,
          taskName: taskLabel,
          success: false,
          rawResponse: '',
          extractedTags: {},
          injectedFragments: [],
          error: lastErrorMessage || '任务在最大重试次数后仍未返回有效结果。',
          stage: taskStage,
          order: normalizedTask.order ?? 0,
        };
      }

      const { tagNames, extractedTags, injectedFragments, injectOnlyTags, injectOnlyFragments, injectOnlyTagNames } = acceptedTagExtraction;
      if (tagNames.length > 0 && Object.keys(extractedTags).length > 0) {
        logDebug_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 成功摘取标签: ${Object.keys(extractedTags).join(', ')}`);
      }

      return {
        taskId: normalizedTask.id,
        taskName: taskLabel,
        success: true,
        rawResponse,
        extractedTags,
        injectedFragments,
        injectOnlyTags,
        injectOnlyFragments,
        injectOnlyTagNames,
        error: null as string | null,
        stage: taskStage,
        order: normalizedTask.order ?? 0,
      };
    } catch (error) {
      if (error?.message === 'TaskAbortedByUser' || error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted')) {
        throw error;
      }
      if (isStrictLorebookReadError_ACU(error) || String((error as any)?.message || '').startsWith('StrictLorebookRead:')) {
        logWarn_ACU(`[剧情推进] [任务:${taskLabel}] 严格世界书读取失败，已阻断 AI 调用。`, {
          phase: 'strict_worldbook_read',
          runId: sharedContext.worldbookReadContext?.runId || '',
          error: summarizeStrictLorebookReadError_ACU(error) || summarizePlotRuntimeError_ACU(error),
        });
        return {
          taskId: normalizedTask.id, taskName: taskLabel, success: false, rawResponse: '',
          extractedTags: {}, injectedFragments: [], error: '必需世界书读取失败，已阻断任务 AI 调用。',
          stage: taskStage, order: normalizedTask.order ?? 0,
        };
      }
      logError_ACU(`[剧情推进] [阶段:${taskStage}] [任务:${taskLabel}] 执行失败:`, error);
      return {
        taskId: normalizedTask.id,
        taskName: taskLabel,
        success: false,
        rawResponse: '',
        extractedTags: {},
        injectedFragments: [] as any[],
        error: error?.message || '任务执行失败。',
        stage: taskStage,
        order: normalizedTask.order ?? 0,
      };
    }
  }

  export async function runPlotTasksRuntime_ACU(plotSettings: Record<string, any>, userMessage: string, runtimeOptions: any = {}) {
    const { inputForHash = userMessage, hasExistingUserMessage = false } = runtimeOptions;

    // ── P4-T4.1: 入口 flush 上一轮残留 pending ──
    // 下一轮开始意味着用户已发送新消息，上一轮目标用户消息必然已在 chat 中，
    // 因此这里只做一次同步查找 + 写入 + 提交，不起定时器。
    // flush 失败不阻断本轮推进（T4.2）。
    if (tempPlotToSave_ACU) {
      try {
        const flushOutcome = await flushPlotPendingSave_ACU();
        if (flushOutcome?.status === 'committed') {
          logDebug_ACU(`[剧情推进] [Plot] flush 补写上一轮残留 pending 成功（目标索引 ${flushOutcome.targetIndex}）`);
        } else if (flushOutcome?.status === 'failed') {
          logWarn_ACU('[剧情推进] [Plot] flush 补写上一轮残留 pending 失败，将在本轮结束后再次重试:', flushOutcome.reason);
        } else if (flushOutcome?.status === 'superseded') {
          logWarn_ACU(`[剧情推进] [Plot] flush 放弃残留 pending（原因: ${flushOutcome.reason}）`);
        }
      } catch (error) {
        logWarn_ACU('[剧情推进] [Plot] flush 补写上一轮残留 pending 时发生异常，跳过:', error);
      }
    }

    const worldbookReadContext = createPlotWorldbookReadContext_ACU(
      {
        resolveCharacterLorebookNames: () => resolveCharacterLorebookNamesStable_ACU(),
        // 表名占位符候选作用域：与剧情世界书实际来源一致（manual 选择或角色绑定），
        // 避免为解析 {{表名}} 隐式枚举全部世界书。
        resolveTableCandidates: async () => {
          const plotCfg = plotSettings?.plotWorldbookConfig;
          const worldbookSource = plotCfg?.source || plotSettings?.worldbookSource || 'character';
          if (worldbookSource === 'manual') {
            return Array.isArray(plotCfg?.manualSelection) ? plotCfg.manualSelection : (plotSettings?.selectedWorldbooks || []);
          }
          return resolveCharacterLorebookNamesStable_ACU();
        },
        signal: abortController_ACU?.signal,
      },
    );
    try {
      _set_pendingFinalGenerationGreenlights_ACU([]);
      const clearGreenlightsOutcome = await clearFinalGenerationGreenlights_ACU(worldbookReadContext);
      if (clearGreenlightsOutcome.status === 'failed') {
        // 直接把安全摘要对象作为 cause，避免二次压缩为 {category, phase} 丢失 subphase/strict 字段。
        // category='aborted' 由 plot-entry 恢复为取消语义；其余错误失败关闭。
        const cause = clearGreenlightsOutcome.error || { category: 'unknown', phase: 'clear_final_generation_greenlights' };
        throw new PlotStageError_ACU('clear_final_generation_greenlights', 'worldbook preflight failed', cause);
      }
      if (clearGreenlightsOutcome.status === 'isolated_stale' && clearGreenlightsOutcome.staleBookNames.length > 0) {
        logWarn_ACU('[剧情推进] 部分世界书已失效（可能被删除/改名），已隔离，其余世界书继续工作。', {
          phase: 'clear_final_generation_greenlights',
          staleBookNames: clearGreenlightsOutcome.staleBookNames,
        });
      }

      ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: true });

      let enabledTasks = getEnabledPlotTasks_ACU(plotSettings);
      if (!enabledTasks.length) {
        logWarn_ACU('[剧情推进] 当前没有可执行的启用任务。');
        return {
          finalMessage: null,
          successfulResults: [],
          failedResults: [],
          aggregatedTags: new Map(),
          enabledTaskCount: 0,
        };
      }

      const sharedContext: Record<string, any> = await buildPlotSharedContext_ACU(plotSettings, userMessage, {
        inputForHash,
        hasExistingUserMessage,
        readContext: worldbookReadContext,
      });
      sharedContext.worldbookReadContext = worldbookReadContext;
    checkPlotAbortRequested_ACU();

    const agentAvailability = await resolveAgentWorldbookFilterAvailability_ACU(worldbookReadContext);
    const agentWorldbookControl = agentAvailability.available ? agentAvailability.control : null;
    const effectivePlotSettings = agentWorldbookControl
      ? { ...plotSettings, agentWorldbookControl }
      : plotSettings;
    sharedContext.plotSettings = effectivePlotSettings;
    sharedContext.agentWorldbookAvailability = agentAvailability;
    if (agentWorldbookControl) sharedContext.agentWorldbookControl = agentWorldbookControl;

    const agentExecutionMode = agentWorldbookControl?.agentPlotExecutionMode === 'concurrent'
      ? 'concurrent'
      : 'sequential';
    let agentDecisionPromise: Promise<AgentDecisionResult_ACU> | null = null;

    async function applyAgentFinalGreenlights_ACU(agentDecision: AgentDecisionResult_ACU): Promise<void> {
      const finalGenerationGreenlights = agentDecision.active === true && Array.isArray(agentDecision.finalGenerationGreenlights)
        ? agentDecision.finalGenerationGreenlights
        : [];
      _set_pendingFinalGenerationGreenlights_ACU(finalGenerationGreenlights);
      if (agentDecision.active === true) {
        const written = await writeFinalGenerationGreenlights_ACU(finalGenerationGreenlights);
        if (!written && finalGenerationGreenlights.length > 0) {
          // 写入未生效时放行条目在世界书里仍是禁用态，原生注入不会包含它们；
          // 生成不阻断（缺内容比漏内容安全），但必须可观测。
          logWarn_ACU('[剧情推进] Agent 正文绿灯写入未生效，放行条目可能缺失于正文提示词。', {
            greenlights: finalGenerationGreenlights.map(ref => `${ref?.bookName ?? ''}#${ref?.uid ?? ''}`),
          });
        }
      }
    }

    if (agentWorldbookControl && agentExecutionMode === 'concurrent') {
      sharedContext.forceNormalWorldbook = true;
      agentDecisionPromise = runAgentDecisionForPlot_ACU({
        plotSettings: effectivePlotSettings,
        agentWorldbookControl,
        userMessage,
        sharedContext,
        enabledTasks,
        requireTaskPlan: false,
      });
    } else if (agentWorldbookControl) {
      const agentDecision: AgentDecisionResult_ACU = await runAgentDecisionForPlot_ACU({
        plotSettings: effectivePlotSettings,
        agentWorldbookControl,
        userMessage,
        sharedContext,
        enabledTasks,
      });
      sharedContext.agentDecision = agentDecision;
      await applyAgentFinalGreenlights_ACU(agentDecision);
      if (agentDecision.active === true) {
        enabledTasks = Array.isArray(agentDecision.effectiveTasks) ? agentDecision.effectiveTasks : [];
      }
    }

    if (!enabledTasks.length) {
      logDebug_ACU('[剧情推进] Agent 决策本轮不执行任何推进任务。');
      return {
        finalMessage: null,
        successfulResults: [],
        failedResults: [],
        aggregatedTags: new Map(),
        enabledTaskCount: 0,
      };
    }

    const stageGroups = groupPlotTasksByStage_ACU(enabledTasks);
    const historyTagMap = buildPlotTagMapFromText_ACU(sharedContext.lastPlotContent || '', null);

    // 构建历史检索选项，供任务级历史回溯使用
    const historyAnchorText = String(inputForHash ?? userMessage ?? '');
    const historyLookupOptions = hasExistingUserMessage && historyAnchorText.trim()
      ? {
          beforeUserInputHash: hashUserInput_ACU(historyAnchorText),
          beforeUserInputText: historyAnchorText,
        }
      : {};

    const successfulResults: any[] = [];
    const failedResults: any[] = [];
    let aggregatedTags = new Map();
    let completedSuccessfulResults: any[] = [];
    let aggregatedInjectOnlyTagNames = new Set<string>();

    for (let stageIndex = 0; stageIndex < stageGroups.length; stageIndex++) {
      const stageGroup = stageGroups[stageIndex];

      let stageEffectivePreset = String(settings_ACU.plotApiPreset || '').trim();
      for (const stageTask of stageGroup.tasks) {
        const taskId = String(stageTask?.id || '').trim();
        const mappedPreset = taskId ? String(getPlotTaskApiPresetOverrides_ACU()[taskId] || '').trim() : '';
        const legacyTaskPreset = String(stageTask?.taskApiPreset || '').trim();
        const explicitTaskPreset = mappedPreset || legacyTaskPreset;
        if (explicitTaskPreset) {
          stageEffectivePreset = explicitTaskPreset;
          break;
        }
      }

      logDebug_ACU(`[剧情推进] 阶段 ${stageGroup.stage} 开始执行，任务级API预设将按各任务独立决议。`);

      const stageRelayTagMap = new Map(aggregatedTags);
      const stageResults: any[] = await Promise.all(stageGroup.tasks.map((task: any) => {
        const stageTask = stageEffectivePreset
          ? { ...task, taskApiPreset: stageEffectivePreset }
          : task;
        return executeSinglePlotTask_ACU(stageTask, sharedContext, {
          relayTagMap: stageRelayTagMap,
          historyTagMap,
          historyLookupOptions,
        });
      }));
      checkPlotAbortRequested_ACU();

      const stageSuccessfulResults = stageResults.filter((result: any) => result?.success);
      const stageFailedResults = stageResults.filter((result: any) => result && !result.success);
      successfulResults.push(...stageSuccessfulResults);
      failedResults.push(...stageFailedResults);
      completedSuccessfulResults = [...successfulResults];

      if (stageFailedResults.length > 0) {
        stageFailedResults.forEach((result: any) => {
          logWarn_ACU(
            `[剧情推进] [阶段:${result.stage ?? stageGroup.stage}] [任务:${result.taskName || result.taskId || '未命名任务'}] 未产出有效结果: ${result.error || '未知错误'}`,
          );
        });
        const failedTaskNames = stageFailedResults.map((result: any) => result.taskName || result.taskId || '未命名任务').join('、');
        if (agentDecisionPromise) {
          await agentDecisionPromise;
        }
        return {
          finalMessage: null as string | null,
          successfulResults,
          failedResults,
          aggregatedTags,
          enabledTaskCount: enabledTasks.length,
          abortedByStageFailure: true,
          failedStage: stageGroup.stage,
          errorMessage: `剧情任务阶段 ${stageGroup.stage} 执行失败（${failedTaskNames}），后续阶段已停止。`,
        };
      }

      const { aggregated: stageAggregated, injectOnlyTagNames: stageInjectOnly } = aggregatePlotTaskTags_ACU(completedSuccessfulResults);
      aggregatedTags = stageAggregated;
      stageInjectOnly.forEach((name: string) => aggregatedInjectOnlyTagNames.add(name));
      logDebug_ACU(`[剧情推进] 阶段 ${stageGroup.stage} 已完成，成功任务数: ${stageSuccessfulResults.length}`);
    }

    if (!successfulResults.length) {
      if (agentDecisionPromise) {
        await agentDecisionPromise;
      }
      return {
        finalMessage: null as string | null,
        successfulResults,
        failedResults,
        aggregatedTags: new Map(),
        enabledTaskCount: enabledTasks.length,
      };
    }

    if (agentDecisionPromise) {
      const agentDecision = await agentDecisionPromise;
      checkPlotAbortRequested_ACU();
      await applyAgentFinalGreenlights_ACU(agentDecision);
    }

    const finalMessage = buildFinalPlotInjectionMessage_ACU(
      sharedContext.finalSystemDirectiveContent,
      successfulResults,
      aggregatedTags,
      aggregatedInjectOnlyTagNames,
    );
    const saveContent = buildPlotSaveContentFromTaskResults_ACU(successfulResults);
    const userInputHash = hashUserInput_ACU(inputForHash);
    const finalMessageHash = hashUserInput_ACU(finalMessage);
    const roundId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const chatId = currentChatFileIdentifier_ACU || '';
    _set_tempPlotToSave_ACU({
      content: saveContent,
      userInputHash,
      userInputText: inputForHash,
      finalMessageHash,
      roundId,
      taskResults: successfulResults,
      // P1-T1.1: 绑定当前聊天标识，供 flush/延迟路径跨聊天校验
      chatId,
    });
    // 对象引用仅用于识别旧延迟回调是否被新 pending 取代；roundId 才是消息持久化身份。
    logDebug_ACU('[剧情推进] [Plot] 已暂存plot数据，roundId:', roundId, '，用户输入哈希:', userInputHash, '，原始文本长度:', inputForHash?.length || 0);

    const saveOutcome = await savePlotToLatestMessage_ACU(true);
    if (saveOutcome?.status === 'committed') {
      logDebug_ACU(`[剧情推进] [Plot] 已写入并提交到目标消息索引 ${saveOutcome.targetIndex}`);
    } else if (saveOutcome?.status === 'deferred') {
      logDebug_ACU('[剧情推进] [Plot] 目标消息尚未出现，已转入延迟提交，不阻塞本轮推进');
    } else if (saveOutcome?.status === 'failed') {
      logWarn_ACU(`[剧情推进] [Plot] 本轮 Plot 提交失败（${saveOutcome.reason}），pending 已保留待重试`);
    } else if (saveOutcome?.status === 'superseded') {
      logWarn_ACU(`[剧情推进] [Plot] 本轮 Plot 被取代（${saveOutcome.reason}），未写入`);
    }

    return {
      finalMessage,
      successfulResults,
      failedResults,
      aggregatedTags,
      enabledTaskCount: enabledTasks.length,
    };
    } finally {
      worldbookReadContext.dispose();
    }
  }

  // ═══ 世界书内容获取 ═══

  export async function resolveCharacterLorebookNamesStable_ACU(): Promise<string[]> {
    const initialScope = capturePlotRuntimeScope_ACU();

    const readOnce = async (attempt: number): Promise<string[]> => {
      checkPlotAbortRequested_ACU();
      const beforeScope = capturePlotRuntimeScope_ACU();
      if (initialScope.reliable && !isSamePlotRuntimeScope_ACU(initialScope, beforeScope)) {
        logWarn_ACU('[剧情推进][世界书] 角色绑定解析取消：读取前作用域已变化。', {
          phase: 'resolve_character',
          attempt,
          initialScope: summarizePlotRuntimeScope_ACU(initialScope),
          currentScope: summarizePlotRuntimeScope_ACU(beforeScope),
        });
        throw new CharacterLorebookScopeChangedError_ACU();
      }

      const charLorebooks = await getCurrentCharacterWorldbookBinding_ACU();
      const afterScope = capturePlotRuntimeScope_ACU();
      if (initialScope.reliable && !isSamePlotRuntimeScope_ACU(initialScope, afterScope)) {
        logWarn_ACU('[剧情推进][世界书] 角色绑定解析取消：读取后作用域已变化。', {
          phase: 'resolve_character',
          attempt,
          initialScope: summarizePlotRuntimeScope_ACU(initialScope),
          currentScope: summarizePlotRuntimeScope_ACU(afterScope),
        });
        throw new CharacterLorebookScopeChangedError_ACU();
      }

      return charLorebooks.orderedNames;
    };

    try {
      const names = await readOnce(1);
      return names;
    } catch (error) {
      if (!isTransientLorebookNotFoundError_ACU(error)) throw error;
      if (!initialScope.reliable) {
        logWarn_ACU('[剧情推进][世界书] 角色绑定首次读取失败：作用域不可靠，已禁用重试。', {
          phase: 'resolve_character',
          attempt: 1,
          scope: summarizePlotRuntimeScope_ACU(initialScope),
          error: summarizePlotRuntimeError_ACU(error),
        });
        throw error;
      }

      await abortableDelay(CHARACTER_LOREBOOK_RETRY_DELAY_MS_ACU, abortController_ACU?.signal);
      checkPlotAbortRequested_ACU();
      const retryScope = capturePlotRuntimeScope_ACU();
      if (!isSamePlotRuntimeScope_ACU(initialScope, retryScope)) {
        logWarn_ACU('[剧情推进][世界书] 角色绑定重试取消：等待期间作用域已变化。', {
          phase: 'resolve_character',
          attempt: 1,
          initialScope: summarizePlotRuntimeScope_ACU(initialScope),
          currentScope: summarizePlotRuntimeScope_ACU(retryScope),
        });
        throw new CharacterLorebookScopeChangedError_ACU();
      }

      try {
        const names = await readOnce(2);
        logDebug_ACU('[剧情推进][世界书] 角色绑定世界书在第 2 次读取后恢复。');
        return names;
      } catch (retryError) {
        logWarn_ACU('[剧情推进][世界书] 角色绑定世界书读取失败，已达到重试上限。', {
          phase: 'resolve_character',
          attempt: 2,
          scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
          error: summarizePlotRuntimeError_ACU(retryError),
        });
        throw retryError;
      }
    }
  }

  /** 获取剧情推进功能的世界书内容（默认开启，无需检查 worldbookEnabled） */
  export async function getWorldbookContentForPlot_ACU(apiSettings: Record<string, any>, userMessage: string, extraBaseText: string = '', options: PlotWorldbookContentOptions_ACU = []) {
    if (!apiSettings) {
      logWarn_ACU('[剧情推进] apiSettings 为空，无法获取世界书');
      return '';
    }

    logDebug_ACU('[剧情推进] Starting to get combined worldbook content with shared placeholder pipeline...');

    try {
      let bookNames: string[] = [];

      const plotCfg = (apiSettings && apiSettings.plotWorldbookConfig) ? apiSettings.plotWorldbookConfig : null;
      const worldbookSource = plotCfg?.source || apiSettings.worldbookSource || 'character';
      const worldbookOptions = normalizePlotWorldbookContentOptions_ACU(options);
      logDebug_ACU('[剧情推进] 世界书来源模式:', worldbookSource);

      if (worldbookSource === 'manual') {
        bookNames = plotCfg?.manualSelection || apiSettings.selectedWorldbooks || [];
        logDebug_ACU('[剧情推进] 手动选择的世界书:', bookNames);
      } else {
        logDebug_ACU('[剧情推进] 使用角色绑定的世界书模式');
        try {
          if (worldbookOptions.readContext) {
            bookNames = await worldbookOptions.readContext.characterLorebookNamesPromise;
          } else {
            bookNames = await resolveCharacterLorebookNamesStable_ACU();
          }
        } catch (error) {
          if (error?.message === 'TaskAbortedByUser' || error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted')) {
            throw error;
          }
          logError_ACU('[剧情推进] 获取角色世界书失败:', {
            phase: 'resolve_character',
            scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
            error: summarizePlotRuntimeError_ACU(error),
          });
          throw createStrictLorebookReadError_ACU({
            status: error instanceof CharacterLorebookScopeChangedError_ACU ? 'scope_changed' : 'read_failed',
            source: 'plot_runtime',
            validationPolicy: 'trusted_direct',
            runId: worldbookOptions.readContext?.runId || '',
            entriesByBook: {},
            invalidBookNames: [],
            failedBookNames: [],
            failedBooks: [],
            staleBookNames: [],
          });
        }
      }

      bookNames = [...new Set((Array.isArray(bookNames) ? bookNames : []).filter(Boolean))];
      logDebug_ACU('[剧情推进] 世界书扫描目标已解析。', {
        source: worldbookSource,
        bookCount: bookNames.length,
      });
      if (bookNames.length === 0) {
        logWarn_ACU('[剧情推进] 没有找到任何世界书，$1 将为空');
        return '';
      }

      const hasAgentScanLimit = apiSettings?.agentWorldbookControl?.contextSettingsConfigured === true;
      const rawAgentScanLimit = apiSettings?.agentWorldbookControl?.contextSettings?.plotWorldbookScanMessageLimit;
      const agentContextSettings = hasAgentScanLimit && Number.isFinite(Number(rawAgentScanLimit))
        ? normalizeAgentContextSettings_ACU(apiSettings?.agentWorldbookControl?.contextSettings)
        : null;
      const historyLimit = agentContextSettings
        ? agentContextSettings.plotWorldbookScanMessageLimit
        : (Number.isFinite(apiSettings.contextTurnCount) ? Math.max(1, Math.trunc(apiSettings.contextTurnCount)) : 3);
      const chatArray = getChatArray_ACU();
      const recentMessages = historyLimit > 0 ? chatArray.slice(-historyLimit) : chatArray;
      const historyAndUserText = `${recentMessages.map((message: any) => message.mes || '').join('\n')}\n${userMessage || ''}`;
      const enabledMap = plotCfg?.enabledEntries;
      const hasAnySelection = enabledMap && typeof enabledMap === 'object' && Object.keys(enabledMap).length > 0;
      let entriesByBook = worldbookOptions.entriesByBook;
      if (worldbookOptions.readContext && !entriesByBook) {
        const strictRead = await getLorebookEntriesStrict_ACU(bookNames, {
          source: worldbookSource === 'manual' ? 'manual_validation' : 'plot_runtime',
          validationPolicy: worldbookSource === 'manual' ? 'validate_list' : 'trusted_direct',
          runId: worldbookOptions.readContext.runId,
          context: worldbookOptions.readContext,
        });
        if (strictRead.status !== 'success') throw createStrictLorebookReadError_ACU(strictRead);
        entriesByBook = strictRead.entriesByBook;
      }
      const agentGreenlightKeySet = new Set(worldbookOptions.agentGreenlights
        .map(ref => `${String(ref?.bookName || '').trim()}\u0000${String(ref?.uid || '').trim()}`)
        .filter(key => !key.startsWith('\u0000') && !key.endsWith('\u0000')));
      const isAgentControlledWorldbook = worldbookOptions.agentMode === 'agent-controlled';
      const entryStateView = isAgentControlledWorldbook ? 'live' : 'pre_takeover';
      let entryStateSnapshot;
      let entryStateSnapshotSignature = '';
      if (entryStateView === 'pre_takeover') {
        try {
          const resolvedSnapshot = await resolvePreTakeoverWorldbookSnapshot_ACU(worldbookOptions.readContext);
          entryStateSnapshot = resolvedSnapshot.snapshot;
          entryStateSnapshotSignature = resolvedSnapshot.expectedSignature;
        } catch (error) {
          logWarn_ACU('[剧情推进] 无法读取 Agent 世界书接管快照，普通剧情世界书将使用 live 状态。', {
            phase: 'read_pre_takeover_snapshot',
            scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
            error: summarizePlotRuntimeError_ACU(error),
          });
        }
      }

      return await buildCombinedWorldbookContentByStrategy_ACU({
        logPrefix: '[剧情推进]',
        bookNames,
        formatEntry: (entry: any) => String(entry?.content || '').trim(),
        baseScanText: [historyAndUserText, extraBaseText || ''].filter(Boolean).join('\n'),
        includeConstantEntriesInBaseScan: true,
        entryStateView,
        entryStateSnapshot,
        entryStateSnapshotSignature,
        excludeEntry: worldbookOptions.excludeEntry,
        entryScope: worldbookOptions.entryScope,
        entriesByBook,
        includeGeneratedEntries: worldbookOptions.includeGeneratedEntries,
        includeEntry: (entry: any) => {
          const normalizedComment = entry.normalizedComment || '';
          const isAgentGreenlight = agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
          if (isAgentGreenlight) return true;
          const isOutlineEntry = normalizedComment.startsWith('TavernDB-ACU-OutlineTable');
          const isSummaryIndexEntry = normalizedComment.startsWith('TavernDB-ACU-CustomExport-纪要索引');
          if (isOutlineEntry || isSummaryIndexEntry) {
            return false;
          }

          const isDbGenerated =
            normalizedComment.startsWith('TavernDB-ACU-') ||
            normalizedComment.startsWith('总结条目') ||
            normalizedComment.startsWith('小总结条目') ||
            normalizedComment.startsWith('重要人物条目');
          if (!isDbGenerated && isEntryBlocked_ACU(entry)) {
            logDebug_ACU(`[剧情推进] 条目被屏蔽: "${entry.rawComment || entry.comment || entry.name || ''}"`);
            return false;
          }
          return true;
        },
        isSelected: (entry: any) => {
          const normalizedComment = entry.normalizedComment || '';
          const isDbGenerated =
            normalizedComment.startsWith('TavernDB-ACU-') ||
            normalizedComment.startsWith('总结条目') ||
            normalizedComment.startsWith('小总结条目') ||
            normalizedComment.startsWith('重要人物条目');
          const isAgentGreenlight = agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
          if (isAgentGreenlight) return true;
          if (isAgentControlledWorldbook && isAgentControlledWorldbookEntryForPlot_ACU(entry)) return false;
          if (!isAgentControlledWorldbook && entry?._acuPreTakeoverSnapshotHit === true && entry.enabled !== false) return true;
          if (!hasAnySelection) return true;
          if (isDbGenerated) return true;
          const list = enabledMap?.[entry.bookName];
          if (typeof list === 'undefined') return true;
          if (!Array.isArray(list)) return true;
          return list.includes(entry.uid);
        },
        forceIncludeEntry: (entry: any) => {
          return agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
        },
        onEntriesFiltered: (entries: any[]) => {
          logDebug_ACU('[剧情推进] 过滤后的条目总数:', entries.length);
        },
        onSelectedEntries: (entries: any[]) => {
          logDebug_ACU('[剧情推进] SillyTavern中启用的条目数量:', entries.length);
        },
      });
    } catch (error) {
      if (error?.message === 'TaskAbortedByUser' || error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted')) {
        throw error;
      }
      if (String(error?.message || '').startsWith('StrictLorebookRead:')) throw error;
      logError_ACU('[剧情推进] 处理世界书内容时发生错误:', {
        phase: 'process_worldbook_content',
        scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
        error: summarizePlotRuntimeError_ACU(error),
      });
      return '';
    }
  }

  async function resolveAgentFinalPromptWorldbookNames_ACU(apiSettings: Record<string, any>): Promise<string[]> {
    let bookNames: string[] = [];
    const plotCfg = (apiSettings && apiSettings.plotWorldbookConfig) ? apiSettings.plotWorldbookConfig : null;
    const worldbookSource = plotCfg?.source || apiSettings.worldbookSource || 'character';

    if (worldbookSource === 'manual') {
      bookNames = plotCfg?.manualSelection || apiSettings.selectedWorldbooks || [];
    } else {
      bookNames = await resolveCharacterLorebookNamesStable_ACU();
    }

    return [...new Set((Array.isArray(bookNames) ? bookNames : []).filter(Boolean).map(name => String(name).trim()).filter(Boolean))];
  }

  /**
   * 获取 Agent 正文生成接管范围内的所有结构化世界书 skill 条目。
   *
   * 这个入口服务最终正文 hook 的原生世界书残留过滤：
   * - 返回 Agent 控制范围内所有可 skillify 的世界书条目；
   * - 不依赖本轮 finalGenerationGreenlights allowlist；
   * - 不依赖关键词触发，避免漏掉“未放行但被 SillyTavern 原生触发”的条目；
   * - 保留 content/comment/position/depth/role/order，供过滤阶段构造删除候选。
   */
  export async function getAgentControlledWorldbookEntriesForFinalPrompt_ACU(apiSettings: Record<string, any>) {
    if (!apiSettings) {
      logWarn_ACU('[剧情推进] apiSettings 为空，无法获取 Agent 控制范围正文世界书条目');
      return [];
    }

    try {
      let bookNames: string[] = [];
      try {
        bookNames = await resolveAgentFinalPromptWorldbookNames_ACU(apiSettings);
      } catch (error) {
        logError_ACU('[剧情推进] 获取角色世界书失败，无法收集 Agent 控制范围正文世界书条目:', {
          phase: 'resolve_agent_final_prompt_character',
          scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
          error: summarizePlotRuntimeError_ACU(error),
        });
        return [];
      }

      if (bookNames.length === 0) return [];

      return await collectCombinedWorldbookEntriesByStrategy_ACU({
        logPrefix: '[剧情推进][Agent正文绿灯过滤目录]',
        bookNames,
        baseScanText: '',
        includeConstantEntriesInBaseScan: false,
        includeEntry: (entry: any) => isAgentControlledFinalPromptWorldbookEntry_ACU(entry),
        isSelected: () => true,
        forceIncludeEntry: () => true,
        onEntriesFiltered: (entries: any[]) => {
          logDebug_ACU('[剧情推进][Agent正文绿灯过滤目录] Agent 控制范围 skill 条目候选数量:', entries.length);
        },
      });
    } catch (error) {
      logError_ACU('[剧情推进] 处理 Agent 控制范围正文世界书条目时发生错误:', {
        phase: 'process_agent_controlled_entries',
        scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
        error: summarizePlotRuntimeError_ACU(error),
      });
      return [];
    }
  }

  /**
   * 获取 Agent 正文生成放行的结构化世界书条目。
   *
   * 这个入口只服务 finalGenerationGreenlights：
   * - 不修改酒馆世界书条目状态；
   * - 不依赖关键词触发；
   * - 不混入未被 Agent 放行的普通世界书条目；
   * - 保留 position/depth/role/order，用于正文生成时按原世界书位置注入。
   */
  export async function getAgentGreenlightWorldbookEntriesForPlot_ACU(apiSettings: Record<string, any>, agentGreenlights: AgentWorldbookRef_ACU[] = []) {
    if (!apiSettings) {
      logWarn_ACU('[剧情推进] apiSettings 为空，无法获取 Agent 正文世界书绿灯');
      return [];
    }

    const agentGreenlightKeySet = new Set((Array.isArray(agentGreenlights) ? agentGreenlights : [])
      .map(ref => `${String(ref?.bookName || '').trim()}\u0000${String(ref?.uid || '').trim()}`)
      .filter(key => !key.startsWith('\u0000') && !key.endsWith('\u0000')));
    if (agentGreenlightKeySet.size === 0) return [];

    try {
      let bookNames: string[] = [];
      try {
        bookNames = await resolveAgentFinalPromptWorldbookNames_ACU(apiSettings);
      } catch (error) {
        logError_ACU('[剧情推进] 获取角色世界书失败，无法注入 Agent 正文世界书绿灯:', {
          phase: 'resolve_agent_greenlight_character',
          scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
          error: summarizePlotRuntimeError_ACU(error),
        });
        return [];
      }

      if (bookNames.length === 0) return [];

      return await collectCombinedWorldbookEntriesByStrategy_ACU({
        logPrefix: '[剧情推进][Agent正文绿灯]',
        bookNames,
        baseScanText: '',
        includeConstantEntriesInBaseScan: false,
        includeEntry: (entry: any) => {
          return agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
        },
        isSelected: (entry: any) => {
          return agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
        },
        forceIncludeEntry: (entry: any) => {
          return agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
        },
        onEntriesFiltered: (entries: any[]) => {
          logDebug_ACU('[剧情推进][Agent正文绿灯] Agent 放行条目候选数量:', entries.length);
        },
        onSelectedEntries: (entries: any[]) => {
          logDebug_ACU('[剧情推进][Agent正文绿灯] Agent 放行条目启用数量:', entries.length);
        },
      });
    } catch (error) {
      logError_ACU('[剧情推进] 处理 Agent 正文世界书绿灯时发生错误:', {
        phase: 'process_agent_greenlight_entries',
        scope: summarizePlotRuntimeScope_ACU(capturePlotRuntimeScope_ACU()),
        error: summarizePlotRuntimeError_ACU(error),
      });
      return [];
    }
  }

  /**
   * 获取 Agent 正文生成放行的世界书内容。
   *
   * 保留字符串入口用于既有调用方；正文生成位置敏感场景应优先使用
   * getAgentGreenlightWorldbookEntriesForPlot_ACU 以保留 depth/order/role。
   */
  export async function getAgentGreenlightWorldbookContentForPlot_ACU(apiSettings: Record<string, any>, agentGreenlights: AgentWorldbookRef_ACU[] = []) {
    const finalEntries = await getAgentGreenlightWorldbookEntriesForPlot_ACU(apiSettings, agentGreenlights);
    const combinedContent = formatCombinedWorldbookEntries_ACU(finalEntries, (entry: any) => String(entry?.content || '').trim());
    if (combinedContent) {
      logDebug_ACU('[剧情推进][Agent正文绿灯] Agent 正文世界书绿灯内容已生成，长度:', combinedContent.length);
    }
    return combinedContent;
  }
