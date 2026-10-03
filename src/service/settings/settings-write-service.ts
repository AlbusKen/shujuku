// ═══════════════════════════════════════════════════════════
// service/settings/settings-write-service.ts — 通用重要配置写边界
//
// 统一事务式写入原语：校验 → 快照 → 改内存 → saveSettings_ACU → 失败回滚。
// 按字段簇提供语义 setter（storage/update/prompt/preset-reference）。
// vector 配置权威在 service/vector/vector-memory-config.ts，此处不重复。
// ═══════════════════════════════════════════════════════════════

import { settings_ACU } from '../runtime/state-manager';
import { saveSettings_ACU, type SaveSettingsResult_ACU } from './settings-service';
import { getCurrentStorageMode } from '../table/storage-mode';
import { buildTableFillDefaultPromptSegments_ACU } from '../ai/prompt-builder/table-fill-tools';
import {
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU,
} from '../../shared/defaults-json.js';
import { DEFAULT_AUTO_UPDATE_FREQUENCY_ACU, DEFAULT_AUTO_UPDATE_THRESHOLD_ACU, DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU } from '../../shared/defaults';
import { normalizeExcludeRules_ACU, normalizeExtractRules_ACU, normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU } from '../../shared/utils';

// ═══ 统一写结果 ═══

export interface SettingsWriteResult_ACU {
  ok: boolean;
  code: 'ok' | 'invalid_input' | 'save_failed' | 'settings_loading';
  changed: boolean;
  saveResult?: SaveSettingsResult_ACU;
  message?: string;
}

// ═══ 事务式原语 ═══

export type SettingsSnapshot_ACU = Record<string, unknown>;

/** 读取字段快照（深拷贝） */
export function snapshotSettingsFields_ACU(fields: string[]): SettingsSnapshot_ACU {
  const snapshot: SettingsSnapshot_ACU = {};
  for (const field of fields) {
    const value = (settings_ACU as Record<string, unknown>)[field];
    snapshot[field] =
      value && typeof value === 'object'
        ? JSON.parse(JSON.stringify(value))
        : value;
  }
  return snapshot;
}

/** 恢复字段快照 */
export function restoreSettingsFields_ACU(snapshot: SettingsSnapshot_ACU): void {
  for (const [field, value] of Object.entries(snapshot)) {
    (settings_ACU as Record<string, unknown>)[field] =
      value && typeof value === 'object'
        ? JSON.parse(JSON.stringify(value))
        : value;
  }
}

/** 执行写事务：mutate 内直接修改 settings_ACU；保存失败自动回滚 */
export function withSettingsWrite_ACU(
  fields: string[],
  mutate: () => void,
  options: { message?: string } = {},
): SettingsWriteResult_ACU {
  const snapshot = snapshotSettingsFields_ACU(fields);
  let mutated = false;
  try {
    mutate();
    mutated = true;
  } catch (e) {
    restoreSettingsFields_ACU(snapshot);
    return {
      ok: false,
      code: 'invalid_input',
      changed: false,
      message: options.message || '设置写入失败：输入无效。',
    };
  }
  const saveResult = saveSettings_ACU();
  if (!saveResult.saved) {
    restoreSettingsFields_ACU(snapshot);
    return {
      ok: false,
      code: saveResult.code === 'settings_loading' ? 'settings_loading' : 'save_failed',
      changed: mutated,
      saveResult,
      message: saveResult.warning || saveResult.error || '保存失败，已回滚。',
    };
  }
  return { ok: true, code: 'ok', changed: mutated, saveResult };
}

// ═══ storage 字段簇 ═══

/** 切换 storageMode + 重置填表提示词（与 provider 切换解耦；provider 失败由调用方回滚） */
export function setStorageMode_ACU(mode: 'native' | 'sqlite'): SettingsWriteResult_ACU {
  if (mode !== 'native' && mode !== 'sqlite') {
    return { ok: false, code: 'invalid_input', changed: false, message: '存储模式无效。' };
  }
  if (getCurrentStorageMode() === mode) {
    return { ok: true, code: 'ok', changed: false };
  }
  return withSettingsWrite_ACU(
    ['storageMode', 'charCardPrompt', 'strictJsonCharCardPrompt', 'strictJsonSqlCharCardPrompt'],
    () => {
      settings_ACU.storageMode = mode;
      settings_ACU.charCardPrompt = currentTableFillDefaultPrompt_ACU(mode);
      settings_ACU.strictJsonCharCardPrompt = JSON.parse(JSON.stringify(DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU));
      settings_ACU.strictJsonSqlCharCardPrompt = JSON.parse(JSON.stringify(DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU));
    },
  );
}

// ═══ update 字段簇 ═══

export type UpdateNumberSettingKey_ACU =
  | 'autoUpdateThreshold'
  | 'autoUpdateFrequency'
  | 'autoUpdateTokenThreshold'
  | 'updateBatchSize'
  | 'maxConcurrentGroups'
  | 'skipUpdateFloors'
  | 'retainRecentLayers'
  | 'importSplitSize'
  | 'tableMaxRetries';

const UPDATE_NUMBER_DEFAULTS_ACU: Record<UpdateNumberSettingKey_ACU, number> = {
  autoUpdateThreshold: DEFAULT_AUTO_UPDATE_THRESHOLD_ACU,
  autoUpdateFrequency: DEFAULT_AUTO_UPDATE_FREQUENCY_ACU,
  autoUpdateTokenThreshold: DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU,
  updateBatchSize: 3,
  maxConcurrentGroups: 1,
  skipUpdateFloors: 0,
  retainRecentLayers: 100,
  importSplitSize: 10000,
  tableMaxRetries: 3,
};

function normalizeUpdateNumber_ACU(key: UpdateNumberSettingKey_ACU, value: unknown): number | null {
  const fallback = UPDATE_NUMBER_DEFAULTS_ACU[key];
  const min = key === 'importSplitSize'
    ? 100
    : (key === 'autoUpdateThreshold' || key === 'autoUpdateTokenThreshold' || key === 'skipUpdateFloors' || key === 'retainRecentLayers' ? 0 : 1);
  const normalized = min > 0
    ? normalizePositiveInteger_ACU(value, fallback)
    : normalizeNonNegativeInteger_ACU(value, fallback);
  return Math.max(min, normalized);
}

/** 更新自动更新数值字段（批量原子写） */
export function setUpdateNumberFields_ACU(
  patch: Partial<Record<UpdateNumberSettingKey_ACU, number | string>>,
): SettingsWriteResult_ACU {
  const keys = Object.keys(patch) as UpdateNumberSettingKey_ACU[];
  if (keys.length === 0) {
    return { ok: true, code: 'ok', changed: false };
  }
  const normalizedMap: Partial<Record<UpdateNumberSettingKey_ACU, number>> = {};
  for (const key of keys) {
    const normalized = normalizeUpdateNumber_ACU(key, patch[key]);
    if (normalized === null) {
      return { ok: false, code: 'invalid_input', changed: false, message: `字段 ${key} 数值无效。` };
    }
    normalizedMap[key] = normalized;
  }
  return withSettingsWrite_ACU(
    [...keys],
    () => {
      for (const [key, value] of Object.entries(normalizedMap) as Array<[UpdateNumberSettingKey_ACU, number]>) {
        settings_ACU[key] = value;
      }
    },
  );
}

/** 自动更新总开关 */
export function setAutoUpdateEnabled_ACU(enabled: boolean): SettingsWriteResult_ACU {
  return withSettingsWrite_ACU(['autoUpdateEnabled'], () => {
    settings_ACU.autoUpdateEnabled = !!enabled;
  });
}

// ═══ prompt 字段簇 ═══

export function setCharCardPrompt_ACU(prompt: unknown): SettingsWriteResult_ACU {
  return withSettingsWrite_ACU(['charCardPrompt'], () => {
    settings_ACU.charCardPrompt = prompt && typeof prompt === 'object'
      ? JSON.parse(JSON.stringify(prompt))
      : prompt;
  });
}

/**
 * 当前填表默认提示词（非 strictJson 分支）：按填表工具开关在正文版/工具版默认之间选择，
 * 避免工具关闭时写入要求调用工具的默认提示词。
 */
function currentTableFillDefaultPrompt_ACU(mode: 'native' | 'sqlite'): any[] {
  return buildTableFillDefaultPromptSegments_ACU(
    mode === 'sqlite',
    settings_ACU.tableFillNativeToolEnabled === true,
  );
}

/** 解析当前填表提示词应写入的字段名（与 V1 getCurrentPromptSettingKey_ACU 语义一致） */
function resolveCurrentPromptKey_ACU(mode: 'native' | 'sqlite' = getCurrentStorageMode()): string {
  if (settings_ACU.strictJsonTableFillEnabled === true) {
    return mode === 'sqlite' ? 'strictJsonSqlCharCardPrompt' : 'strictJsonCharCardPrompt';
  }
  return 'charCardPrompt';
}

/** 按当前填表模式 + strictJson 分支保存提示词（V1 语义收敛到 service） */
export function setCurrentPromptSegments_ACU(prompt: unknown): SettingsWriteResult_ACU {
  const key = resolveCurrentPromptKey_ACU();
  return withSettingsWrite_ACU([key], () => {
    (settings_ACU as Record<string, unknown>)[key] = prompt && typeof prompt === 'object'
      ? JSON.parse(JSON.stringify(prompt))
      : prompt;
  });
}

/** 按当前填表模式 + strictJson 分支恢复默认提示词（V1 语义收敛到 service） */
export function resetCurrentPromptToDefault_ACU(): SettingsWriteResult_ACU {
  const mode = getCurrentStorageMode();
  const key = resolveCurrentPromptKey_ACU(mode);
  const defaultValue = settings_ACU.strictJsonTableFillEnabled === true
    ? JSON.parse(JSON.stringify(mode === 'sqlite' ? DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU : DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU))
    : currentTableFillDefaultPrompt_ACU(mode);
  return withSettingsWrite_ACU([key], () => {
    (settings_ACU as Record<string, unknown>)[key] = defaultValue;
  });
}

/** 按指定模式恢复默认填表提示词（applyModeDefaultCharCardPrompt_ACU 语义收敛） */
export function applyDefaultCharCardPrompt_ACU(mode: 'native' | 'sqlite'): SettingsWriteResult_ACU {
  const key = resolveCurrentPromptKey_ACU(mode);
  const defaultValue = settings_ACU.strictJsonTableFillEnabled === true
    ? JSON.parse(JSON.stringify(mode === 'sqlite' ? DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU : DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU))
    : currentTableFillDefaultPrompt_ACU(mode);
  return withSettingsWrite_ACU([key], () => {
    (settings_ACU as Record<string, unknown>)[key] = defaultValue;
  });
}

/** 恢复默认填表提示词（按当前存储模式） */
export function resetFormFillPromptsToDefault_ACU(): SettingsWriteResult_ACU {
  return withSettingsWrite_ACU(
    ['charCardPrompt', 'strictJsonCharCardPrompt', 'strictJsonSqlCharCardPrompt'],
    () => {
      const mode = getCurrentStorageMode();
      settings_ACU.charCardPrompt = currentTableFillDefaultPrompt_ACU(mode);
      settings_ACU.strictJsonCharCardPrompt = JSON.parse(JSON.stringify(DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU));
      settings_ACU.strictJsonSqlCharCardPrompt = JSON.parse(JSON.stringify(DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU));
    },
  );
}

/**
 * 一次性恢复默认填表提示词与合并纪要提示词（resetAllToDefaults 语义收敛）。
 *
 * 原 V1 行为：无条件写 `charCardPrompt` 与 `mergeSummaryPrompt`（不区分 strictJson 分支），
 * 按当前存储模式选择 native/sqlite 默认值。此 API 保持该语义，且两字段原子写入：
 * 任一保存失败则整体回滚。
 *
 * `save: false` 供编排场景使用（调用方自行统一保存，例如 V2 resetAllDefaults
 * 在应用模板后一次性 `saveSettings_ACU()`，避免中间多次保存引入部分失败窗口）。
 */
export function resetAllPromptsToDefault_ACU(
  mode: 'native' | 'sqlite' = getCurrentStorageMode(),
  options: { save?: boolean } = {},
): SettingsWriteResult_ACU {
  if (mode !== 'native' && mode !== 'sqlite') {
    return { ok: false, code: 'invalid_input', changed: false, message: '存储模式无效。' };
  }
  const applyDefaults = () => {
    settings_ACU.charCardPrompt = currentTableFillDefaultPrompt_ACU(mode);
    settings_ACU.mergeSummaryPrompt = JSON.parse(JSON.stringify(
      mode === 'sqlite' ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU,
    ));
  };
  if (options.save === false) {
    try {
      applyDefaults();
      return { ok: true, code: 'ok', changed: true };
    } catch (e) {
      return { ok: false, code: 'invalid_input', changed: false, message: '恢复默认提示词失败：输入无效。' };
    }
  }
  return withSettingsWrite_ACU(['charCardPrompt', 'mergeSummaryPrompt'], applyDefaults);
}

export function setMergeSummaryPrompt_ACU(prompt: unknown): SettingsWriteResult_ACU {
  return withSettingsWrite_ACU(['mergeSummaryPrompt'], () => {
    settings_ACU.mergeSummaryPrompt = prompt && typeof prompt === 'object'
      ? JSON.parse(JSON.stringify(prompt))
      : prompt;
  });
}

export function resetMergeSummaryPrompt_ACU(mode: 'native' | 'sqlite' = getCurrentStorageMode()): SettingsWriteResult_ACU {
  if (mode !== 'native' && mode !== 'sqlite') {
    return { ok: false, code: 'invalid_input', changed: false, message: '存储模式无效。' };
  }
  return withSettingsWrite_ACU(['mergeSummaryPrompt'], () => {
    settings_ACU.mergeSummaryPrompt = JSON.parse(JSON.stringify(
      mode === 'sqlite' ? DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU : DEFAULT_MERGE_SUMMARY_PROMPT_ACU,
    ));
  });
}

/** 表格标签提取/排除规则 */
export function setTableContextRules_ACU(
  kind: 'extract' | 'exclude',
  rules: Array<{ start: string; end: string }>,
): SettingsWriteResult_ACU {
  const field = kind === 'extract' ? 'tableContextExtractRules' : 'tableContextExcludeRules';
  const tagField = kind === 'extract' ? 'tableContextExtractTags' : 'tableContextExcludeTags';
  const normalized = (kind === 'extract'
    ? normalizeExtractRules_ACU(rules, '')
    : normalizeExcludeRules_ACU(rules, ''));
  return withSettingsWrite_ACU([field, tagField], () => {
    settings_ACU[field] = JSON.parse(JSON.stringify(normalized));
    settings_ACU[tagField] = '';
  });
}
