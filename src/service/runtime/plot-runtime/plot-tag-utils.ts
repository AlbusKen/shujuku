/**
 * service/runtime/plot-runtime/plot-tag-utils.ts
 * 剧情推进 — 模板变量隔离/渲染 + XML 标签提取/占位符 + task 结果排序/聚合/构建
 * 从 helpers-plot-runtime.ts 拆出（L222-L531）
 */
import { logWarn_ACU } from '../../../shared/utils';
import { normalizePositiveInteger_ACU } from '../../../shared/utils';
import type { PlotRequestContext_ACU } from './plot-request-context';
import { withSqlTemplateReadContext_ACU } from '../template-vars/sql-query-var';
import { getTemplateVariableStores_ACU, setTemplateVariableStores_ACU, parseRandomTags_ACU, replaceRandomVariables_ACU, parseCalcTags_ACU, parseMaxTags_ACU, parseMinTags_ACU, replaceCalcVariables_ACU, replaceMaxVariables_ACU, replaceMinVariables_ACU, parseIfBlockRecursive_ACU, replaceDbSqlVariables } from '../template-vars';

  export function getNormalizedPlotMessageRole_ACU(role: string | null) {
    const ru = String(role || '').toUpperCase();
    if (ru === 'AI' || ru === 'ASSISTANT') return 'assistant';
    if (ru === 'SYSTEM') return 'system';
    if (ru === 'USER') return 'user';
    return String(role || 'user').toLowerCase();
  }

  export async function tryRenderPlotTemplateWithEjs_ACU(content: string, requestContext?: PlotRequestContext_ACU) {
    if (!content) return '';
    if (requestContext) {
      requestContext.assertCurrent();
      if (!(window as any).EjsTemplate?.evalTemplate) return content;
      const rendered = await (window as any).EjsTemplate.evalTemplate(content, structuredClone(requestContext.ejsContext));
      requestContext.assertCurrent();
      return rendered;
    }
    if ((window as any).EjsTemplate && typeof (window as any).EjsTemplate.evalTemplate === 'function') {
      try {
        const context = await (window as any).EjsTemplate.prepareContext();
        if (typeof (window as any).Mvu !== 'undefined' && (window as any).Mvu.getMvuData) {
          try {
            const mvuObj = (window as any).Mvu.getMvuData({ type: 'message', message_id: 'latest' });
            if (mvuObj && mvuObj.stat_data) {
              context.mvu = mvuObj.stat_data;
            }
          } catch (e) {
            logWarn_ACU('[剧情推进] 获取 MVU 数据失败:', e);
          }
        }
        return await (window as any).EjsTemplate.evalTemplate(content, context);
      } catch (e) {
        logWarn_ACU('[剧情推进] 提示词模板渲染失败，将使用原始文本:', e);
        return content;
      }
    }
    return content;
  }

  function clonePlotTemplateVariableMap_ACU(store: Record<string, any> | null) {
    return store && typeof store === 'object' ? { ...store } : {};
  }

  function capturePlotTemplateVariables_ACU() {
    const stores = getTemplateVariableStores_ACU();
    return {
      randomVariables: clonePlotTemplateVariableMap_ACU(stores.randomVariables_ACU),
      calcVariables: clonePlotTemplateVariableMap_ACU(stores.calcVariables_ACU),
      maxVariables: clonePlotTemplateVariableMap_ACU(stores.maxVariables_ACU),
      minVariables: clonePlotTemplateVariableMap_ACU(stores.minVariables_ACU),
    };
  }

  function restorePlotTemplateVariables_ACU(snapshot: Record<string, any> | null) {
    setTemplateVariableStores_ACU({
      randomVariables_ACU: clonePlotTemplateVariableMap_ACU(snapshot?.randomVariables),
      calcVariables_ACU: clonePlotTemplateVariableMap_ACU(snapshot?.calcVariables),
      maxVariables_ACU: clonePlotTemplateVariableMap_ACU(snapshot?.maxVariables),
      minVariables_ACU: clonePlotTemplateVariableMap_ACU(snapshot?.minVariables),
    });
  }

  function runWithIsolatedPlotTemplateVariables_ACU(callback: () => any) {
    const previousSnapshot = capturePlotTemplateVariables_ACU();
    restorePlotTemplateVariables_ACU(null);
    try {
      return callback();
    } finally {
      restorePlotTemplateVariables_ACU(previousSnapshot);
    }
  }

  export function renderPlotTaskContentWithIsolatedVariables_ACU(content: string, sharedContext: Record<string, any>) {
    const contextForCalc = { allTablesJson: sharedContext.allTablesJson };
    const contextForIf = {
      seedContent: sharedContext.seedContentForConditional,
      allTablesJson: sharedContext.allTablesJson,
      plotContent: sharedContext.taskPlotContent || sharedContext.lastPlotContent || '',
      chatSnapshot: sharedContext.requestContext?.history,
    };

    return withSqlTemplateReadContext_ACU(sharedContext.requestContext?.sqlReadContext, () => runWithIsolatedPlotTemplateVariables_ACU(() => {
      let renderedContent = content;
      renderedContent = parseRandomTags_ACU(renderedContent);
      renderedContent = replaceRandomVariables_ACU(renderedContent);
      renderedContent = parseCalcTags_ACU(renderedContent, contextForCalc);
      renderedContent = parseMaxTags_ACU(renderedContent, contextForCalc);
      renderedContent = parseMinTags_ACU(renderedContent, contextForCalc);
      renderedContent = replaceCalcVariables_ACU(renderedContent);
      renderedContent = replaceMaxVariables_ACU(renderedContent);
      renderedContent = replaceMinVariables_ACU(renderedContent);
      // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
      renderedContent = replaceDbSqlVariables(renderedContent);
      return parseIfBlockRecursive_ACU(renderedContent, contextForIf, 0);
    }));
  }

  // ═══ XML 标签提取与占位符 ═══

  export function extractLastTagContent_ACU(text: string, rawTagName: string) {
    if (!text || !rawTagName) return null;
    const tagName = String(rawTagName).trim();
    if (!tagName) return null;

    const lower = String(text).toLowerCase();
    const open = `<${tagName.toLowerCase()}>`;
    const close = `</${tagName.toLowerCase()}>`;

    const closeIdx = lower.lastIndexOf(close);
    if (closeIdx === -1) return null;

    const openIdx = lower.lastIndexOf(open, closeIdx);
    if (openIdx === -1) return null;

    const contentStart = openIdx + open.length;
    return String(text).slice(contentStart, closeIdx);
  }

  export function extractPlotTagsFromResponse_ACU(text: string, extractTags: string, extractInjectTags: string = '') {
    const injectTagNames = String(extractInjectTags || '')
      .split(',')
      .map((tag: string) => tag.trim())
      .filter(Boolean);

    const normalTagNames = String(extractTags || '')
      .split(',')
      .map((tag: string) => tag.trim())
      .filter(Boolean);

    // 构建注入标签集合（优先级高）
    const injectTagNameSet = new Set(injectTagNames.map((t: string) => t.toLowerCase()));

    const extractedTags: Record<string, string> = {};
    const injectedFragments: string[] = [];
    // 新增：注入标签专用集合（不参与尾追加）
    const injectOnlyTags: Record<string, string> = {};
    const injectOnlyFragments: string[] = [];
    // 标记哪些 tagName 来自 extractInjectTags
    const injectOnlyTagNames: string[] = [];

    // 先提取 extractInjectTags 的标签
    injectTagNames.forEach((tagName: string) => {
      const content = extractLastTagContent_ACU(text, tagName);
      if (content !== null) {
        injectOnlyTags[tagName] = content;
        injectOnlyFragments.push(`<${tagName}>${content}</${tagName}>`);
        injectOnlyTagNames.push(tagName);
        // 同时放入 extractedTags 以支持跨任务传递和占位替换
        extractedTags[tagName] = content;
        injectedFragments.push(`<${tagName}>${content}</${tagName}>`);
      }
    });

    // 再提取 extractTags 的标签（同名标签被 extractInjectTags 覆盖，不重复提取）
    normalTagNames.forEach((tagName: string) => {
      if (injectTagNameSet.has(tagName.toLowerCase())) {
        // 同名标签已被 extractInjectTags 处理，跳过
        return;
      }
      const content = extractLastTagContent_ACU(text, tagName);
      if (content !== null) {
        extractedTags[tagName] = content;
        injectedFragments.push(`<${tagName}>${content}</${tagName}>`);
      }
    });

    return {
      tagNames: [...injectTagNames, ...normalTagNames],
      extractedTags,
      injectedFragments,
      injectOnlyTags,
      injectOnlyFragments,
      injectOnlyTagNames,
    };
  }

  export function extractAllTagContents_ACU(text: string, rawTagName: string) {
    if (!text || !rawTagName) return [];
    const tagName = String(rawTagName).trim();
    if (!tagName) return [];

    const source = String(text);
    const lower = source.toLowerCase();
    const open = `<${tagName.toLowerCase()}>`;
    const close = `</${tagName.toLowerCase()}>`;
    const contents = [];
    let searchIndex = 0;

    while (searchIndex < lower.length) {
      const openIdx = lower.indexOf(open, searchIndex);
      if (openIdx === -1) break;
      const contentStart = openIdx + open.length;
      const closeIdx = lower.indexOf(close, contentStart);
      if (closeIdx === -1) break;
      contents.push(source.slice(contentStart, closeIdx));
      searchIndex = closeIdx + close.length;
    }

    return contents;
  }

  export function getPlotPlaceholderTagNames_ACU(text: string) {
    const placeholderPattern = /\{\{(\w+)\}\}/g;
    const names: string[] = [];
    let match;

    while ((match = placeholderPattern.exec(String(text || ''))) !== null) {
      const tagName = String(match[1] || '').trim();
      if (tagName) names.push(tagName);
    }

    return [...new Set(names)];
  }

  export function buildPlotTagMapFromText_ACU(text: string, requestedTagNames: string[] | null = null) {
    const sourceText = String(text || '');
    const tagMap = new Map();
    if (!sourceText.trim()) return tagMap;

    if (Array.isArray(requestedTagNames) && requestedTagNames.length > 0) {
      [...new Set(requestedTagNames.map((tagName: string) => String(tagName || '').trim()).filter(Boolean))].forEach((tagName: string) => {
        const contents = extractAllTagContents_ACU(sourceText, tagName);
        if (contents.length > 0) {
          tagMap.set(tagName, contents);
        }
      });
      return tagMap;
    }

    const tagPattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = tagPattern.exec(sourceText)) !== null) {
      const tagName = String(match[1] || '').trim();
      if (!tagName) continue;
      if (!tagMap.has(tagName)) tagMap.set(tagName, []);
      tagMap.get(tagName).push(match[2] ?? '');
    }

    return tagMap;
  }

  export function buildPlotTagBlock_ACU(tagName: string, contents: any) {
    const normalizedTagName = String(tagName || '').trim();
    if (!normalizedTagName) return '';
    const normalizedContents = (Array.isArray(contents) ? contents : [contents]).map((content: any) => content ?? '');
    if (!normalizedContents.length) return '';
    return `<${normalizedTagName}>${normalizedContents.join('\n\n')}</${normalizedTagName}>`;
  }

  function hasMeaningfulTagContents_ACU(contents: any) {
    if (Array.isArray(contents)) {
      return contents.some((content: any) => String(content ?? '').trim() !== '');
    }
    return String(contents ?? '').trim() !== '';
  }

  export function getPlotTagMapValue_ACU(tagSourceMap: Map<string, any>, rawTagName: string) {
    const normalizedTagName = String(rawTagName || '').trim();
    if (!(tagSourceMap instanceof Map) || !normalizedTagName) {
      return { found: false, value: undefined, actualTagName: '' };
    }

    if (tagSourceMap.has(normalizedTagName)) {
      return {
        found: true,
        value: tagSourceMap.get(normalizedTagName),
        actualTagName: normalizedTagName,
      };
    }

    const loweredTagName = normalizedTagName.toLowerCase();
    for (const [candidateTagName, candidateValue] of tagSourceMap.entries()) {
      if (String(candidateTagName || '').trim().toLowerCase() === loweredTagName) {
        return {
          found: true,
          value: candidateValue,
          actualTagName: String(candidateTagName || '').trim(),
        };
      }
    }

    return { found: false, value: undefined, actualTagName: '' };
  }

  function resolvePlotTagValueWithFallback_ACU(primaryTagMap: Map<string, any>, fallbackTagMap: Map<string, any>, rawTagName: string) {
    const primaryValue = getPlotTagMapValue_ACU(primaryTagMap, rawTagName);
    if (primaryValue.found && hasMeaningfulTagContents_ACU(primaryValue.value)) {
      return primaryValue;
    }
    return getPlotTagMapValue_ACU(fallbackTagMap, rawTagName);
  }

  export function replacePlotTagPlaceholders_ACU(text: string, tagSourceMap: Map<string, any>, fallbackTagSourceMap: Map<string, any> = new Map()) {
    const sourceText = String(text || '');
    if (!sourceText) return '';
    const placeholderPattern = /\{\{(\w+)\}\}/g;

    return sourceText.replace(placeholderPattern, (placeholder, tagName) => {
      const resolvedValue = resolvePlotTagValueWithFallback_ACU(tagSourceMap, fallbackTagSourceMap, tagName);
      return buildPlotTagBlock_ACU(tagName, resolvedValue.value);
    });
  }

  // ═══ 任务级世界书触发文本构造 ═══

  /**
   * 基于当前任务 prompt 中实际使用的 {{tag}} 占位符，提取对应标签文本，
   * 拼接为变量世界书的触发扫描文本。
   *
   * 标签内容来源优先级：
   * 1. 若提供了 relayTagMap（本轮先前阶段的聚合结果），优先从中取标签内容
   * 2. 否则从 plotContent（上轮剧情历史）中按 tagName 提取 XML 标签内容
   *
   * 这保证世界书触发依据与 renderPlotTaskMessages_ACU 中的 {{tag}} 注入来源一致：
   * - 第一阶段（useHistoryRelay=true）：relayTagMap 为空，走 plotContent（上一轮历史）
   * - 后续阶段（useHistoryRelay=false）：relayTagMap 含本轮先前阶段结果，从中取标签
   *
   * @param taskPromptGroup - 当前任务的 promptGroup（数组，每项有 content 字段）
   * @param plotContent - 上轮剧情历史内容（lastPlotContent）
   * @param relayTagMap - 本轮先前阶段的聚合标签结果（Map<string, string[]>），可选
   * @returns 拼接后的世界书触发文本；无匹配标签时返回空字符串
   */
  export function buildTaskWorldbookTriggerText_ACU(taskPromptGroup: any[], plotContent: string, relayTagMap?: Map<string, any>, fallbackTagMap?: Map<string, any>): string {
    const messages = Array.isArray(taskPromptGroup) ? taskPromptGroup : [];
    const sourcePlotContent = String(plotContent || '');

    if (!messages.length) return '';

    // 1. 从所有 prompt segment 中汇总 {{tag}} 名称
    const allTagNames: string[] = [];
    const seenTagNames = new Set<string>();
    for (const seg of messages) {
      if (!seg || typeof seg.content !== 'string') continue;
      const names = getPlotPlaceholderTagNames_ACU(seg.content);
      for (const name of names) {
        if (!seenTagNames.has(name)) {
          seenTagNames.add(name);
          allTagNames.push(name);
        }
      }
    }

    if (!allTagNames.length) return '';

    // 2. 确定标签内容来源：优先使用 relayTagMap（本轮先前阶段结果），
    //    否则从上轮剧情历史文本中提取
    const blocks: string[] = [];

    const historyTagMap = fallbackTagMap instanceof Map
      ? fallbackTagMap
      : buildPlotTagMapFromText_ACU(sourcePlotContent, allTagNames);

    for (const tagName of allTagNames) {
      const resolvedValue = resolvePlotTagValueWithFallback_ACU(relayTagMap instanceof Map ? relayTagMap : new Map(), historyTagMap, tagName);
      if (!resolvedValue.found || !hasMeaningfulTagContents_ACU(resolvedValue.value)) continue;
      const block = buildPlotTagBlock_ACU(tagName, resolvedValue.value);
      if (block) blocks.push(block);
    }

    return blocks.join('\n');
  }

  // ═══ Task 结果排序/聚合/构建 ═══

  export function sortPlotTaskResults_ACU(results: any[]) {
    return (Array.isArray(results) ? [...results] : [])
      .filter(Boolean)
      .sort((a, b) => (normalizePositiveInteger_ACU(a?.stage, 1) - normalizePositiveInteger_ACU(b?.stage, 1)) || ((a?.order ?? 0) - (b?.order ?? 0)));
  }

  export function aggregatePlotTaskTags_ACU(taskResults: any[]) {
    const aggregated = new Map();
    // 新增：记录哪些 tagName 来自 extractInjectTags（不参与尾追加）
    const injectOnlyTagNames = new Set<string>();
    const sortedResults = sortPlotTaskResults_ACU(taskResults);

    sortedResults.forEach((result: Record<string, any>) => {
      if (!result?.success || !result.extractedTags || typeof result.extractedTags !== 'object') return;
      Object.entries(result.extractedTags).forEach(([tagName, content]: [string, any]) => {
        if (!aggregated.has(tagName)) aggregated.set(tagName, []);
        aggregated.get(tagName).push(content ?? '');
      });
      // 收集 injectOnly 标签名
      if (Array.isArray(result.injectOnlyTagNames)) {
        result.injectOnlyTagNames.forEach((name: string) => injectOnlyTagNames.add(name));
      }
    });

    return { aggregated, injectOnlyTagNames };
  }

  export function buildAggregatedPlotTagBlocks_ACU(aggregatedTags: Map<string, any>) {
    if (!(aggregatedTags instanceof Map) || aggregatedTags.size === 0) return '';
    const blocks: string[] = [];
    aggregatedTags.forEach((contents, tagName) => {
      const block = buildPlotTagBlock_ACU(tagName, contents);
      if (block) blocks.push(block);
    });
    return blocks.join('\n\n');
  }

  export function buildPlotRawFallbackText_ACU(taskResults: any[]) {
    const successfulResults = sortPlotTaskResults_ACU(taskResults)
      .filter(result => result?.success && typeof result.rawResponse === 'string' && result.rawResponse.trim());

    if (successfulResults.length === 0) return '';
    if (successfulResults.length === 1) {
      return successfulResults[0].rawResponse.trim();
    }

    return successfulResults
      .map(result => `【剧情任务：${result.taskName || result.taskId || '未命名任务'}】\n${result.rawResponse.trim()}`)
      .join('\n\n');
  }

  export function buildPlotSaveContentFromTaskResults_ACU(taskResults: any[]) {
    return buildPlotRawFallbackText_ACU(taskResults);
  }

  export function buildFinalPlotInjectionMessage_ACU(finalSystemDirectiveContent: string, taskResults: any[], aggregatedTags: Map<string, any>, injectOnlyTagNames: Set<string> = new Set()) {
    const defaultDirective = '[SYSTEM_DIRECTIVE: You are a storyteller. The following <plot> block is your absolute script for this turn. You MUST follow the <directive> within it to generate the story.]';
    const baseDirective = String(finalSystemDirectiveContent || '').trim() || defaultDirective;
    const rawFallbackText = buildPlotRawFallbackText_ACU(taskResults);
    const placeholderPattern = /\{\{(\w+)\}\}/g;
    const placeholderNames = [];
    let match;

    while ((match = placeholderPattern.exec(baseDirective)) !== null) {
      placeholderNames.push(match[1]);
    }

    if (aggregatedTags instanceof Map && aggregatedTags.size > 0) {
      if (placeholderNames.length > 0) {
        const matchedTags = new Set();
        const injectOnlyTagNamesLower = new Set(Array.from(injectOnlyTagNames).map((name: string) => String(name || '').toLowerCase()));
        const finalDirectiveWithTags = baseDirective.replace(placeholderPattern, (placeholder, tagName) => {
          const resolvedValue = getPlotTagMapValue_ACU(aggregatedTags, tagName);
          matchedTags.add(String(tagName || '').toLowerCase());
          if (resolvedValue.found) {
            matchedTags.add(String(resolvedValue.actualTagName || '').toLowerCase());
          }
          const contents = resolvedValue.value;
          if (hasMeaningfulTagContents_ACU(contents)) {
            return `<${tagName}>${(Array.isArray(contents) ? contents : [contents]).map(content => content ?? '').join('\n\n')}</${tagName}>`;
          }
          return '';
        });

        const unusedTagBlocks: string[] = [];
        aggregatedTags.forEach((contents, tagName) => {
          const loweredTagName = String(tagName || '').toLowerCase();
          if (matchedTags.has(loweredTagName)) return;
          // injectOnly 标签（extractInjectTags 提取的）即使未使用也不追加到末尾
          if (injectOnlyTagNamesLower.has(loweredTagName)) return;
          if (!hasMeaningfulTagContents_ACU(contents)) return;
          unusedTagBlocks.push(`<${tagName}>${(Array.isArray(contents) ? contents : [contents]).map(content => content ?? '').join('\n\n')}</${tagName}>`);
        });

        return [finalDirectiveWithTags.trim(), unusedTagBlocks.join('\n\n').trim()]
          .filter(Boolean)
          .join('\n');
      }

      // 没有占位符时：只追加非 injectOnly 的标签块
      const filteredTags = new Map();
      const injectOnlyTagNamesLower = new Set(Array.from(injectOnlyTagNames).map((name: string) => String(name || '').toLowerCase()));
      aggregatedTags.forEach((contents, tagName) => {
        if (!injectOnlyTagNamesLower.has(String(tagName || '').toLowerCase()) && hasMeaningfulTagContents_ACU(contents)) {
          filteredTags.set(tagName, contents);
        }
      });
      const aggregatedTagBlocks = buildAggregatedPlotTagBlocks_ACU(filteredTags);
      return [baseDirective, aggregatedTagBlocks].filter(Boolean).join('\n');
    }

    if (placeholderNames.length > 0) {
      const finalDirectiveWithoutTags = baseDirective.replace(placeholderPattern, '');
      return [finalDirectiveWithoutTags.trim(), rawFallbackText].filter(Boolean).join('\n');
    }

    return [baseDirective, rawFallbackText].filter(Boolean).join('\n');
  }
