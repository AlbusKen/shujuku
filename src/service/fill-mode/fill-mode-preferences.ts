/**
 * 填表模式偏好：全局持久化于 globalMeta.formFillPreferencesGlobal（跨设备一致）。
 * 读时归一化，非法值 fail-closed 回退默认并保留诊断；只有保存成功才写回。
 * 交火参数的权威来源仍是 vectorMemoryConfigGlobal，这里不复制；
 * 向量表格的召回参数独立保存在 vector 下，运行时不读取交火的召回参数。
 */
import { globalMeta_ACU, saveGlobalMeta_ACU } from '../../data/repositories/profile-repo';

export type FillMode_ACU = 'classic' | 'vector' | 'llm' | 'crossfire';
export const FILL_MODES_ACU: readonly FillMode_ACU[] = ['classic', 'vector', 'llm', 'crossfire'];
export const FILL_MODE_PREFERENCES_KEY_ACU = 'formFillPreferencesGlobal';
export const CLASSIC_RECENT_CHRONICLE_ROWS_DEFAULT_ACU = 15;
export const VECTOR_RESULT_COUNT_DEFAULT_ACU = 30;
export const VECTOR_MIN_SCORE_DEFAULT_ACU = 0.35;
export const VECTOR_CANDIDATE_LIMIT_DEFAULT_ACU = 200;

export interface FillModePreferences_ACU {
  schemaVersion: 1;
  selectedMode: FillMode_ACU;
  classic: { recentChronicleRows: number };
  vector: {
    /** 保留相关纪要条数：rerank 后从高到低保留的行数，选中行本轮切为蓝灯条目；纪要有效行数少于此数时不触发召回。 */
    resultCount: number;
    /** 预筛最低分：embedding 余弦分低于此值不进入候选。 */
    minScore: number;
    /** 候选上限：送入 rerank 的候选分片上限，运行时不小于 resultCount。 */
    candidateLimit: number;
  };
}

export interface FillModePreferencesRead_ACU {
  preferences: FillModePreferences_ACU;
  source: 'stored' | 'migrated' | 'default';
  diagnostics: string[];
}

export function isFillMode_ACU(value: unknown): value is FillMode_ACU {
  return typeof value === 'string' && (FILL_MODES_ACU as readonly string[]).includes(value);
}

function readInt_ACU(value: unknown, fallback: number, min: number, max: number, field: string, diagnostics: string[]): number {
  if (value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    diagnostics.push(`${field} 非法（${String(value)}），已回退为 ${fallback}`);
    return fallback;
  }
  return num;
}

function readScore_ACU(value: unknown, fallback: number, field: string, diagnostics: string[]): number {
  if (value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    diagnostics.push(`${field} 非法（${String(value)}），已回退为 ${fallback}`);
    return fallback;
  }
  return num;
}

export function normalizeFillModePreferences_ACU(
  raw: unknown,
  fallbackMode: FillMode_ACU = 'classic',
): { preferences: FillModePreferences_ACU; diagnostics: string[] } {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, any>;
  const diagnostics: string[] = [];
  let selectedMode = fallbackMode;
  if (source.selectedMode !== undefined) {
    if (isFillMode_ACU(source.selectedMode)) selectedMode = source.selectedMode;
    else diagnostics.push(`selectedMode 非法（${String(source.selectedMode)}），已回退为 ${fallbackMode}`);
  }
  // 旧 llm 偏好不参与请求；读时忽略，下次成功保存仅写回有效字段。
  return {
    preferences: {
      schemaVersion: 1,
      selectedMode,
      classic: {
        recentChronicleRows: readInt_ACU(source.classic?.recentChronicleRows, CLASSIC_RECENT_CHRONICLE_ROWS_DEFAULT_ACU, 1, 200, 'classic.recentChronicleRows', diagnostics),
      },
      vector: {
        resultCount: readInt_ACU(source.vector?.resultCount, VECTOR_RESULT_COUNT_DEFAULT_ACU, 1, 1000, 'vector.resultCount', diagnostics),
        minScore: readScore_ACU(source.vector?.minScore, VECTOR_MIN_SCORE_DEFAULT_ACU, 'vector.minScore', diagnostics),
        candidateLimit: readInt_ACU(source.vector?.candidateLimit, VECTOR_CANDIDATE_LIMIT_DEFAULT_ACU, 1, 5000, 'vector.candidateLimit', diagnostics),
      },
    },
    diagnostics,
  };
}

/**
 * 读取全局填表偏好。缺失时不写回：默认 classic，旧对话由 resolver 按旧默认方案临时运行，
 * 旧交火全局开关只作为 resolver 的输入，不在这里改写用户选择。
 */
export function readFillModePreferences_ACU(): FillModePreferencesRead_ACU {
  const raw = globalMeta_ACU?.[FILL_MODE_PREFERENCES_KEY_ACU];
  if (raw === undefined || raw === null) {
    return { preferences: normalizeFillModePreferences_ACU({}).preferences, source: 'default', diagnostics: [] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    const { preferences } = normalizeFillModePreferences_ACU({});
    return { preferences, source: 'default', diagnostics: ['formFillPreferencesGlobal 结构非法，已使用默认值且未覆盖原值'] };
  }
  const { preferences, diagnostics } = normalizeFillModePreferences_ACU(raw);
  return { preferences, source: 'stored', diagnostics };
}

export function isLegacyCrossfireEnabled_ACU(): boolean {
  return globalMeta_ACU?.summaryVectorIndexModeGlobal === true;
}

/** 经典模式近期纪要条数占位符：大总结表规则写占位符，提示词装配时按同一快照解析。 */
export const RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU = '$RECENT_CHRONICLE_ROWS';
const SOURCE_DATA_TEXT_FIELDS_ACU = ['note', 'initNode', 'insertNode', 'updateNode', 'deleteNode'] as const;

export function getClassicRecentChronicleRows_ACU(): number {
  return readFillModePreferences_ACU().preferences.classic.recentChronicleRows;
}

export function resolveRecentChronicleRowsPlaceholder_ACU(text: string, recentChronicleRows: number): string {
  return String(text).split(RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU).join(String(recentChronicleRows));
}

/**
 * 返回解析占位符后的表副本；不含占位符时原样返回同一对象。
 * 绝不改写传入对象，避免把本次请求的数值写回运行时表格或持久化模板。
 */
export function resolveSheetSourceDataPlaceholders_ACU<T extends { sourceData?: any }>(sheet: T, recentChronicleRows: number): T {
  const sourceData = sheet?.sourceData;
  if (!sourceData || typeof sourceData !== 'object') return sheet;
  const hasPlaceholder = SOURCE_DATA_TEXT_FIELDS_ACU.some(field =>
    typeof sourceData[field] === 'string' && sourceData[field].includes(RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU));
  if (!hasPlaceholder) return sheet;
  const nextSourceData = { ...sourceData };
  for (const field of SOURCE_DATA_TEXT_FIELDS_ACU) {
    if (typeof nextSourceData[field] === 'string') {
      nextSourceData[field] = resolveRecentChronicleRowsPlaceholder_ACU(nextSourceData[field], recentChronicleRows);
    }
  }
  return { ...sheet, sourceData: nextSourceData };
}

/** 保存全局填表偏好：写入失败时回滚内存值并返回结构化错误。 */
export function saveFillModePreferences_ACU(
  next: FillModePreferences_ACU,
): { ok: true; preferences: FillModePreferences_ACU } | { ok: false; error: string } {
  const { preferences, diagnostics } = normalizeFillModePreferences_ACU(next);
  if (diagnostics.length) return { ok: false, error: diagnostics.join('；') };
  const hadKey = Object.prototype.hasOwnProperty.call(globalMeta_ACU, FILL_MODE_PREFERENCES_KEY_ACU);
  const previous = globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];
  globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU] = preferences;
  if (!saveGlobalMeta_ACU()) {
    if (hadKey) globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU] = previous;
    else delete globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];
    return { ok: false, error: '全局配置保存失败，已保留原填表模式。' };
  }
  return { ok: true, preferences };
}
