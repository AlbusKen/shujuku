import {
  DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU,
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU,
  DEFAULT_PLOT_PROMPT_GROUP_ACU, DEFAULT_TIME_RECALL_PLOT_PRESET_ACU, CREATIVE_IDENTITY_LEGACY_PROMPTS_ACU,
} from '../../shared/defaults-json.js';
import { CONTENT_SAFETY_CLAUSE_ACU } from '../../shared/content-safety.js';
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

function stripContentSafetyClause_ACU(content: unknown): string {
  return typeof content === 'string' ? content.split(CONTENT_SAFETY_CLAUSE_ACU).join('') : '';
}

function builtinPlotPromptGroups_ACU(): unknown[][] {
  const recall = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU as Record<string, any>;
  const legacy = CREATIVE_IDENTITY_LEGACY_PROMPTS_ACU as Record<string, any>;
  return [
    DEFAULT_PLOT_PROMPT_GROUP_ACU, recall.promptGroup, recall.plotTasks?.[0]?.promptGroup,
    legacy.plotGroup, legacy.timeRecallTask, legacy.timeRecallGroup,
  ].filter(Array.isArray);
}

/** 去掉内容禁令后逐段比较 role 与正文，识别仍是内置默认（含声明前、禁令前版本）的剧情提示词组。 */
export function isBuiltinPlotPromptGroup_ACU(group: unknown): boolean {
  if (!Array.isArray(group) || group.length === 0) return false;
  return builtinPlotPromptGroups_ACU().some(reference => reference.length === group.length
    && reference.every((segment: any, index: number) => {
      const target = group[index];
      return String(target?.role || '').toLowerCase() === String(segment?.role || '').toLowerCase()
        && stripContentSafetyClause_ACU(target?.content) === stripContentSafetyClause_ACU(segment?.content);
    }));
}

/** 缺失或仍为内置默认的组才刷新；用户自定义正文保留。 */
function shouldRefreshPlotPromptGroup_ACU(group: unknown): boolean {
  return !Array.isArray(group) || group.length === 0 || isBuiltinPlotPromptGroup_ACU(group);
}

function resetPlotHolder_ACU(holder: Record<string, any>): Record<string, any> {
  const recall = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU as Record<string, any>;
  const isRecall = (typeof recall._acuBuiltinPresetId === 'string' && holder._acuBuiltinPresetId === recall._acuBuiltinPresetId)
    || holder.name === recall.name || holder.lastUsedPresetName === recall.name;
  const group = isRecall ? recall.promptGroup : DEFAULT_PLOT_PROMPT_GROUP_ACU;
  const taskGroup = isRecall ? recall.plotTasks[0].promptGroup : group;
  const next: Record<string, any> = shouldRefreshPlotPromptGroup_ACU(holder.promptGroup)
    ? { ...holder, promptGroup: clone_ACU(group) } : { ...holder };
  if (Array.isArray(holder.plotTasks)) {
    next.plotTasks = holder.plotTasks.map(task => isRecord_ACU(task) && shouldRefreshPlotPromptGroup_ACU(task.promptGroup)
      ? { ...task, promptGroup: clone_ACU(taskGroup) } : task);
  }
  const templates = buildDefaultAgentWorldbookPromptTemplates_ACU();
  for (const key of ['agentPromptTemplates', 'agentWorldbookControl']) {
    if (isRecord_ACU(holder[key])) next[key] = { ...holder[key], ...clone_ACU(templates) };
  }
  return next;
}

/** 强制刷新默认提示词正文（剧情提示词组只刷新仍为内置默认的组），保留任务、预设、渠道及开关；调用方负责备份和一次性版本标记。 */
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

type PlotRestoreCounter_ACU = { count: number };

/** 当前组仍为迁移写入的内置默认、备份组为用户自定义时返回备份副本；其余情况不恢复。 */
function pickRestoredPlotPromptGroup_ACU(current: unknown, backup: unknown): unknown[] | null {
  if (!isBuiltinPlotPromptGroup_ACU(current)) return null;
  if (!Array.isArray(backup) || backup.length === 0 || isBuiltinPlotPromptGroup_ACU(backup)) return null;
  return clone_ACU(backup);
}

function restorePlotPresetHolder_ACU(current: Record<string, any>, backup: Record<string, any>, counter: PlotRestoreCounter_ACU): Record<string, any> {
  const next: Record<string, any> = { ...current };
  const rootGroup = pickRestoredPlotPromptGroup_ACU(current.promptGroup, backup.promptGroup);
  if (rootGroup) {
    next.promptGroup = rootGroup;
    counter.count += 1;
  }
  if (Array.isArray(current.plotTasks) && Array.isArray(backup.plotTasks)) {
    const backupTasks = new Map<string, Record<string, any>>();
    for (const task of backup.plotTasks) {
      if (isRecord_ACU(task) && typeof task.id === 'string' && task.id && !backupTasks.has(task.id)) backupTasks.set(task.id, task);
    }
    next.plotTasks = current.plotTasks.map((task: unknown) => {
      if (!isRecord_ACU(task) || typeof task.id !== 'string') return task;
      const group = pickRestoredPlotPromptGroup_ACU(task.promptGroup, backupTasks.get(task.id)?.promptGroup);
      if (!group) return task;
      counter.count += 1;
      return { ...task, promptGroup: group };
    });
  }
  return next;
}

/**
 * 从内容声明迁移备份恢复被整组覆盖的剧情预设提示词：按预设名与任务 id 对应，
 * 只恢复当前仍为内置默认、备份为用户自定义的组。根级运行设置由聊天加载时重新套用预设生成，不在此恢复。
 */
export function restoreCustomPlotPromptGroups_ACU(current: Record<string, any>, backup: Record<string, any>): { plotSettings: Record<string, any>; restoredCount: number } {
  if (!Array.isArray(current.promptPresets) || !Array.isArray(backup.promptPresets)) return { plotSettings: current, restoredCount: 0 };
  const backupPresets = new Map<string, Record<string, any>>();
  for (const preset of backup.promptPresets) {
    if (isRecord_ACU(preset) && typeof preset.name === 'string' && !backupPresets.has(preset.name)) backupPresets.set(preset.name, preset);
  }
  const counter: PlotRestoreCounter_ACU = { count: 0 };
  const promptPresets = current.promptPresets.map((preset: unknown) => {
    if (!isRecord_ACU(preset)) return preset;
    const source = typeof preset.name === 'string' ? backupPresets.get(preset.name) : undefined;
    return source ? restorePlotPresetHolder_ACU(preset, source, counter) : preset;
  });
  return counter.count > 0
    ? { plotSettings: { ...current, promptPresets }, restoredCount: counter.count }
    : { plotSettings: current, restoredCount: 0 };
}
