// ═══════════════════════════════════════════════════════════════
// service/settings/creative-identity-upgrade.ts — 创作身份声明一次性升级
//
// 只把与「声明前默认段」逐字相同的段换成当前默认段；用户改写的段、其余段与段元数据原样保留。
// 所有写入都替换为新数组/新对象，不原位修改，调用方可按顶层字段引用回滚。
// ═══════════════════════════════════════════════════════════════

import {
  CREATIVE_IDENTITY_LEGACY_PROMPTS_ACU,
  DEFAULT_CHAR_CARD_PROMPT_ACU,
  DEFAULT_CHAR_CARD_PROMPT_SQL_ACU,
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
  DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU,
  DEFAULT_PLOT_PROMPT_GROUP_ACU,
  DEFAULT_TIME_RECALL_PLOT_PRESET_ACU,
} from '../../shared/defaults-json.js';
import {
  CREATIVE_IDENTITY_LEGACY_SHARED_PROMPTS_ACU,
  buildDefaultAgentDecisionPromptSegments_ACU,
  buildDefaultAgentSkillifyPromptSegments_ACU,
  defaultVectorMemoryConfig_ACU,
} from '../../shared/defaults';

type ContentMap_ACU = Map<string, string>;

function isRecord_ACU(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 按段位配对旧默认与新默认，只登记正文确实变化的段。 */
function buildContentMap_ACU(...pairs: Array<[unknown, unknown]>): ContentMap_ACU {
  const map: ContentMap_ACU = new Map();
  for (const [legacy, current] of pairs) {
    if (!Array.isArray(legacy) || !Array.isArray(current)) continue;
    legacy.forEach((segment, index) => {
      const from = (segment as any)?.content;
      const to = (current[index] as any)?.content;
      if (typeof from === 'string' && typeof to === 'string' && from !== to) map.set(from, to);
    });
  }
  return map;
}

/** 逐字命中旧默认的段换成新正文；没有变化返回 null。 */
function replaceSegments_ACU(segments: unknown, map: ContentMap_ACU): unknown[] | null {
  if (!Array.isArray(segments) || map.size === 0) return null;
  let changed = false;
  const next = segments.map(segment => {
    if (!isRecord_ACU(segment) || typeof segment.content !== 'string') return segment;
    const content = map.get(segment.content);
    if (content === undefined) return segment;
    changed = true;
    return { ...segment, content };
  });
  return changed ? next : null;
}

function upgradeTaskList_ACU(tasks: unknown, map: ContentMap_ACU): unknown[] | null {
  if (!Array.isArray(tasks)) return null;
  let changed = false;
  const next = tasks.map(task => {
    if (!isRecord_ACU(task)) return task;
    const promptGroup = replaceSegments_ACU(task.promptGroup, map);
    if (!promptGroup) return task;
    changed = true;
    return { ...task, promptGroup };
  });
  return changed ? next : null;
}

/** 升级带 promptGroup / plotTasks 的容器（剧情推进设置、预设、正文优化设置）。 */
function upgradePromptHolder_ACU(holder: unknown, map: ContentMap_ACU): Record<string, any> | null {
  if (!isRecord_ACU(holder)) return null;
  const promptGroup = replaceSegments_ACU(holder.promptGroup, map);
  const plotTasks = upgradeTaskList_ACU(holder.plotTasks, map);
  if (!promptGroup && !plotTasks) return null;
  return { ...holder, ...(promptGroup ? { promptGroup } : {}), ...(plotTasks ? { plotTasks } : {}) };
}

function upgradePresetList_ACU(presets: unknown, map: ContentMap_ACU): unknown[] | null {
  if (!Array.isArray(presets)) return null;
  let changed = false;
  const next = presets.map(preset => {
    const upgraded = upgradePromptHolder_ACU(preset, map);
    if (!upgraded) return preset;
    changed = true;
    return upgraded;
  });
  return changed ? next : null;
}

function upgradeAgentSegments_ACU(holder: unknown, map: ContentMap_ACU): Record<string, any> | null {
  if (!isRecord_ACU(holder)) return null;
  const decision = replaceSegments_ACU(holder.agentDecisionPromptSegments, map);
  const skillify = replaceSegments_ACU(holder.agentSkillifyPromptSegments, map);
  if (!decision && !skillify) return null;
  return {
    ...holder,
    ...(decision ? { agentDecisionPromptSegments: decision } : {}),
    ...(skillify ? { agentSkillifyPromptSegments: skillify } : {}),
  };
}

function upgradePlotSettings_ACU(plotSettings: unknown, plotMap: ContentMap_ACU, agentMap: ContentMap_ACU): Record<string, any> | null {
  if (!isRecord_ACU(plotSettings)) return null;
  let next: Record<string, any> | null = upgradePromptHolder_ACU(plotSettings, plotMap);
  const presets = upgradePresetList_ACU(plotSettings.promptPresets, plotMap);
  if (presets) next = { ...(next || plotSettings), promptPresets: presets };
  for (const key of ['agentPromptTemplates', 'agentWorldbookControl'] as const) {
    const upgraded = upgradeAgentSegments_ACU(plotSettings[key], agentMap);
    if (upgraded) next = { ...(next || plotSettings), [key]: upgraded };
  }
  return next;
}

/**
 * profile 域：填表、剧情推进（含内置时间召回预设与前置控制 Agent 模板）、正文优化与合并纪要。
 * @returns 是否有任何段被替换
 */
export function applyCreativeIdentityProfileUpgrade_ACU(settings: Record<string, any>): boolean {
  const legacy = CREATIVE_IDENTITY_LEGACY_PROMPTS_ACU as Record<string, any>;
  const shared = CREATIVE_IDENTITY_LEGACY_SHARED_PROMPTS_ACU as Record<string, any>;
  const timeRecall = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU as Record<string, any>;
  const cardMap = buildContentMap_ACU(
    [legacy.charCard, DEFAULT_CHAR_CARD_PROMPT_ACU],
    [legacy.charCardSql, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU],
    [legacy.strictJson, DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU],
    [legacy.strictJsonSql, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU],
  );
  const plotMap = buildContentMap_ACU(
    [legacy.plotGroup, DEFAULT_PLOT_PROMPT_GROUP_ACU],
    [legacy.timeRecallTask, timeRecall.plotTasks?.[0]?.promptGroup],
    [legacy.timeRecallGroup, timeRecall.promptGroup],
  );
  const agentMap = buildContentMap_ACU(
    [shared.agentDecision, buildDefaultAgentDecisionPromptSegments_ACU()],
    [shared.agentSkillify, buildDefaultAgentSkillifyPromptSegments_ACU()],
  );
  const optimizationMap = buildContentMap_ACU([legacy.contentOptimization, DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU]);

  let changed = false;
  for (const key of ['charCardPrompt', 'strictJsonCharCardPrompt', 'strictJsonSqlCharCardPrompt'] as const) {
    const next = replaceSegments_ACU(settings[key], cardMap);
    if (next) { settings[key] = next; changed = true; }
  }
  const plotSettings = upgradePlotSettings_ACU(settings.plotSettings, plotMap, agentMap);
  if (plotSettings) { settings.plotSettings = plotSettings; changed = true; }
  const optimization = upgradePromptHolder_ACU(settings.contentOptimizationSettings, optimizationMap);
  const optimizationPresets = upgradePresetList_ACU(settings.contentOptimizationSettings?.promptPresets, optimizationMap);
  if (optimization || optimizationPresets) {
    settings.contentOptimizationSettings = {
      ...(optimization || settings.contentOptimizationSettings),
      ...(optimizationPresets ? { promptPresets: optimizationPresets } : {}),
    };
    changed = true;
  }
  if (settings.mergeSummaryPrompt === legacy.mergeSummary && legacy.mergeSummary !== DEFAULT_MERGE_SUMMARY_PROMPT_ACU) {
    settings.mergeSummaryPrompt = DEFAULT_MERGE_SUMMARY_PROMPT_ACU;
    changed = true;
  } else if (settings.mergeSummaryPrompt === legacy.mergeSummarySql && legacy.mergeSummarySql !== DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU) {
    settings.mergeSummaryPrompt = DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU;
    changed = true;
  }
  return changed;
}

/**
 * 交火全局配置：关键词生成与远记忆总结提示词组。
 * @returns 是否有任何段被替换
 */
export function applyCreativeIdentityVectorUpgrade_ACU(vectorConfig: Record<string, any>): boolean {
  const shared = CREATIVE_IDENTITY_LEGACY_SHARED_PROMPTS_ACU as Record<string, any>;
  const defaults = defaultVectorMemoryConfig_ACU as Record<string, any>;
  let changed = false;
  for (const key of ['keywordPromptGroup', 'summaryPromptGroup'] as const) {
    const next = replaceSegments_ACU(vectorConfig[key], buildContentMap_ACU([shared[key], defaults[key]]));
    if (next) { vectorConfig[key] = next; changed = true; }
  }
  return changed;
}
