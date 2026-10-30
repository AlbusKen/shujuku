import {
  DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU,
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU,
  DEFAULT_PLOT_PROMPT_GROUP_ACU, DEFAULT_TIME_RECALL_PLOT_PRESET_ACU,
} from '../../shared/defaults-json.js';
import { buildDefaultAgentWorldbookPromptTemplates_ACU, buildDefaultContentOptimizationPromptGroup_ACU } from '../../shared/defaults';

export const CONTENT_SAFETY_PROFILE_PROMPT_KEYS_ACU = [
  'charCardPrompt', 'strictJsonCharCardPrompt', 'strictJsonSqlCharCardPrompt',
  'plotSettings', 'contentOptimizationSettings', 'mergeSummaryPrompt',
  'templateAssistantPromptSegments',
] as const;

function clone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRecord_ACU(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resetPlotHolder_ACU(holder: Record<string, any>): Record<string, any> {
  const recall = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU as Record<string, any>;
  const isRecall = (typeof recall._acuBuiltinPresetId === 'string' && holder._acuBuiltinPresetId === recall._acuBuiltinPresetId)
    || holder.name === recall.name || holder.lastUsedPresetName === recall.name;
  const group = isRecall ? recall.promptGroup : DEFAULT_PLOT_PROMPT_GROUP_ACU;
  const taskGroup = isRecall ? recall.plotTasks[0].promptGroup : group;
  const next: Record<string, any> = { ...holder, promptGroup: clone_ACU(group) };
  if (Array.isArray(holder.plotTasks)) {
    next.plotTasks = holder.plotTasks.map(task => isRecord_ACU(task)
      ? { ...task, promptGroup: clone_ACU(taskGroup) } : task);
  }
  const templates = buildDefaultAgentWorldbookPromptTemplates_ACU();
  for (const key of ['agentPromptTemplates', 'agentWorldbookControl']) {
    if (isRecord_ACU(holder[key])) next[key] = { ...holder[key], ...clone_ACU(templates) };
  }
  return next;
}

/** 强制刷新提示词正文，保留任务、预设、渠道及开关；调用方负责备份和一次性版本标记。 */
export function applyContentSafetyProfileDefaults_ACU(settings: Record<string, any>): void {
  const sql = settings.storageMode === 'sqlite';
  settings.charCardPrompt = clone_ACU(sql ? DEFAULT_CHAR_CARD_PROMPT_SQL_ACU : DEFAULT_CHAR_CARD_PROMPT_ACU);
  settings.strictJsonCharCardPrompt = clone_ACU(DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU);
  settings.strictJsonSqlCharCardPrompt = clone_ACU(DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU);
  settings.mergeSummaryPrompt = sql ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU;
  settings.templateAssistantPromptSegments = [];

  const plot = isRecord_ACU(settings.plotSettings) ? settings.plotSettings : {};
  const nextPlot = resetPlotHolder_ACU(plot);
  nextPlot.agentPromptTemplates = clone_ACU(buildDefaultAgentWorldbookPromptTemplates_ACU());
  if (Array.isArray(plot.promptPresets)) {
    nextPlot.promptPresets = plot.promptPresets.map(preset => isRecord_ACU(preset) ? resetPlotHolder_ACU(preset) : preset);
  }
  settings.plotSettings = nextPlot;

  const optimization = isRecord_ACU(settings.contentOptimizationSettings) ? settings.contentOptimizationSettings : {};
  settings.contentOptimizationSettings = {
    ...optimization,
    promptGroup: buildDefaultContentOptimizationPromptGroup_ACU(),
    ...(Array.isArray(optimization.promptPresets) ? {
      promptPresets: optimization.promptPresets.map(preset => isRecord_ACU(preset)
        ? { ...preset, promptGroup: buildDefaultContentOptimizationPromptGroup_ACU() } : preset),
    } : {}),
  };
}
