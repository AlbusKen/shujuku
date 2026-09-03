// ═══════════════════════════════════════════════════════════════
// service/settings/settings-service.ts — 设置加载/保存编排
// 从 04_shared_helpers.js 迁入
//
// 这两个函数混合了数据读写 + UI 同步 + 运行时状态操作，
// 属于 service 层（业务编排），不是纯 data 层。
// ═══════════════════════════════════════════════════════════════

import { STORAGE_KEY_ALL_SETTINGS_ACU, STORAGE_KEY_CUSTOM_TEMPLATE_ACU, normalizeIsolationCode_ACU } from '../../shared/data-constants';
import { DEFAULT_BUILTIN_PLOT_PRESETS_ACU, DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU, DEFAULT_MERGE_SUMMARY_PROMPT_ACU, DEFAULT_PLOT_SETTINGS_ACU, DEFAULT_TABLE_TEMPLATE_ACU, ORIGINAL_DEFAULT_TABLE_TEMPLATE_ACU, TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';
import { DEFAULT_AUTO_UPDATE_FREQUENCY_ACU, DEFAULT_AUTO_UPDATE_THRESHOLD_ACU, DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU, STRICT_JSON_TABLE_FILL_FORCE_DISABLE_VERSION_ACU, SUMMARY_INDEX_V2_WRITER_FORCE_ENABLE_VERSION_ACU, TABLE_FILL_PROMPT_FORCE_DEFAULT_VERSION_ACU, TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU, TEMPLATE_ASSISTANT_PROMPT_FORCE_DEFAULT_VERSION_ACU, VECTOR_MEMORY_DEFAULTS_REFRESH_VERSION_ACU, VECTOR_MEMORY_LEGACY_MIN_SCORE_DEFAULTS_ACU, VECTOR_MEMORY_RECALL_PARAM_KEYS_ACU, VECTOR_MEMORY_RECALL_PARAMS_FORCE_OVERRIDE_VERSION_ACU, VECTOR_MEMORY_SOURCE_TEXT_UPGRADE_VERSION_ACU, buildDefaultAgentWorldbookControl_ACU, buildDefaultAgentWorldbookPromptTemplates_ACU, buildDefaultPlotWorldbookConfig_ACU, buildDefaultContentOptimizationPromptGroup_ACU, defaultWorldbookConfig_ACU, defaultVectorMemoryConfig_ACU } from '../../shared/defaults';
import { addDataIsolationHistory_ACU, ensureProfileExists_ACU, normalizeDataIsolationHistory_ACU } from '../../data/repositories/isolation-repo';
import { globalMeta_ACU, loadGlobalMeta_ACU, readProfileSettingsFromStorage_ACU, readProfileTemplateFromStorage_ACU, sanitizeSettingsForProfileSave_ACU, saveGlobalMeta_ACU, writeProfileSettingsToStorage_ACU, writeProfileTemplateToStorage_ACU } from '../../data/repositories/profile-repo';
import { getCurrentTemplatePresetName_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../shared/template-preset-utils';
import { persistSettingsToStorage_ACU } from '../../data/storage/config-storage';
import { getCurrentVectorMemoryConfig_ACU } from '../vector/vector-memory-config';
import { isIndexedDbAvailable_ACU } from '../../shared/idb-import-temp';
import { configIdbCacheLoaded_ACU, ensureConfigIdbCacheLoaded_ACU, getConfigStorage_ACU, initTavernSettingsBridge_ACU, migrateKeyToTavernStorageIfNeeded_ACU, pendingSettingsReloadFromIdb_ACU, _set_pendingSettingsReloadFromIdb_ACU} from '../../data/storage/tavern-storage';
import { ensureTagRulesCompat_ACU } from '../plot/plot-logic';
import { getDefaultTemplateSnapshot_ACU, getTemplatePreset_ACU } from '../template/template-preset-service';
import { getCurrentIsolationKey_ACU, settings_ACU, _set_settings_ACU} from '../runtime/state-manager';
import { getCurrentCharSettings_ACU, getCurrentWorldbookConfig_ACU } from './settings-readers';
import { getCurrentCharacterScopeKey_ACU, resolveCurrentCharacterScope_ACU } from './character-scope';
import { reconcileApiBindingForCurrentChat_ACU } from './api-preset-service';
import { getCurrentChatTemplateScopeState_ACU, getGlobalTemplateSnapshotForCurrentProfile_ACU, migrateLegacyTemplateScopeForCurrentChat_ACU, normalizeTemplateScopeIsolationKey_ACU, sanitizeChatSheetsObject_ACU, sanitizeTemplateSnapshotForChat_ACU } from '../template/chat-scope';
import { safeJsonParse_ACU } from '../../shared/json-helpers';
import { deepMerge_ACU, ensureSheetOrderNumbers_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeEditablePromptSegments_ACU } from '../agent/agent-prompt-template';

export type SaveSettingsResult_ACU = {
  saved: boolean;
  storageType: 'tavern' | 'indexeddb' | 'memory';
  warning?: string;
  error?: string;
  code?: 'settings_loading' | 'tavern_unavailable' | 'storage_error';
};

let settingsStorageReadyForSave_ACU = false;
export const _set_settingsStorageReadyForSave_ACU = (val: boolean) => { settingsStorageReadyForSave_ACU = val; };
let settingsReloadAfterIdbScheduled_ACU = false;

function scheduleSettingsReloadAfterIdbReady_ACU(reason: string): void {
  if (settingsReloadAfterIdbScheduled_ACU) return;
  settingsReloadAfterIdbScheduled_ACU = true;
  _set_pendingSettingsReloadFromIdb_ACU(true);
  logDebug_ACU(`[设置加载] IndexedDB 配置缓存尚未就绪，暂停本轮加载并等待重载：${reason}`);
  void ensureConfigIdbCacheLoaded_ACU().then(() => {
      settingsReloadAfterIdbScheduled_ACU = false;
      if (pendingSettingsReloadFromIdb_ACU) {
          _set_pendingSettingsReloadFromIdb_ACU(false);
          loadSettings_ACU();
      }
  });
}

function applyGlobalPlotEnabledSetting_ACU(): boolean {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) {
    settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
  }

  if (typeof globalMeta_ACU.plotEnabledGlobal !== 'boolean') {
    globalMeta_ACU.plotEnabledGlobal = settings_ACU.plotSettings.enabled === false ? false : true;
    saveGlobalMeta_ACU();
  }

  settings_ACU.plotSettings.enabled = globalMeta_ACU.plotEnabledGlobal === true;
  return settings_ACU.plotSettings.enabled;
}

function cloneDefaultValue_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function hasNonEmptyPromptSegments_ACU(value: unknown): boolean {
  return Array.isArray(value)
    && value.some(segment => segment && typeof segment === 'object' && typeof (segment as any).content === 'string' && (segment as any).content.trim());
}

function ensureAgentPromptTemplateDefaults_ACU(): boolean {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) {
    settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
  }
  const defaults = buildDefaultAgentWorldbookPromptTemplates_ACU();
  const current = settings_ACU.plotSettings.agentPromptTemplates;
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    settings_ACU.plotSettings.agentPromptTemplates = cloneDefaultValue_ACU(defaults);
    return true;
  }
  const normalized = {
    agentDecisionPromptSegments: normalizeEditablePromptSegments_ACU(
      (current as any).agentDecisionPromptSegments,
      defaults.agentDecisionPromptSegments,
    ),
    agentSkillifyPromptSegments: normalizeEditablePromptSegments_ACU(
      (current as any).agentSkillifyPromptSegments,
      defaults.agentSkillifyPromptSegments,
    ),
  };
  const changed = JSON.stringify(current) !== JSON.stringify(normalized);
  settings_ACU.plotSettings.agentPromptTemplates = normalized;
  return changed;
}

function ensureAgentWorldbookControlDefaults_ACU(): boolean {
  // Legacy/template compatibility only: card-level Agent worldbook control is
  // stored in TavernDB-ACU-AgentWorldbookConfig entries. Do not treat this
  // settings field as the current character card's configuration source.
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) {
    settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
  }
  const defaults = buildDefaultAgentWorldbookControl_ACU();
  const current = settings_ACU.plotSettings.agentWorldbookControl;
  let changed = false;
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    settings_ACU.plotSettings.agentWorldbookControl = cloneDefaultValue_ACU(defaults);
    return true;
  }
  const merged = deepMerge_ACU(cloneDefaultValue_ACU(defaults), current);
  if (!hasNonEmptyPromptSegments_ACU((merged as any).agentDecisionPromptSegments)) {
    (merged as any).agentDecisionPromptSegments = cloneDefaultValue_ACU(defaults.agentDecisionPromptSegments);
  }
  if (!hasNonEmptyPromptSegments_ACU((merged as any).agentSkillifyPromptSegments)) {
    (merged as any).agentSkillifyPromptSegments = cloneDefaultValue_ACU(defaults.agentSkillifyPromptSegments);
  }
  changed = JSON.stringify(current) !== JSON.stringify(merged);
  settings_ACU.plotSettings.agentWorldbookControl = merged;
  return changed;
}

function ensureBuiltinPlotPresets_ACU(): boolean {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) {
    settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
  }
  if (!Array.isArray(settings_ACU.plotSettings.promptPresets)) {
    settings_ACU.plotSettings.promptPresets = [];
  }
  if (!Array.isArray(DEFAULT_BUILTIN_PLOT_PRESETS_ACU)) return false;

  let changed = false;
  for (const builtinPreset of DEFAULT_BUILTIN_PLOT_PRESETS_ACU) {
    const name = String((builtinPreset as any)?.name || '').trim();
    if (!name) continue;
    const idx = settings_ACU.plotSettings.promptPresets.findIndex((preset: any) => String(preset?.name || '').trim() === name);
    const cloned = JSON.parse(JSON.stringify(builtinPreset));
    if (idx < 0) {
      settings_ACU.plotSettings.promptPresets.push(cloned);
      changed = true;
      continue;
    }
    const current = settings_ACU.plotSettings.promptPresets[idx];
    if (
      current?._acuBuiltinPresetId === cloned._acuBuiltinPresetId
      && current?._acuBuiltinPresetVersion !== cloned._acuBuiltinPresetVersion
    ) {
      settings_ACU.plotSettings.promptPresets[idx] = cloned;
      changed = true;
    }
  }
  return changed;
}

function parseTableTemplateObjectFromString_ACU(templateStr: any): any {
  if (!templateStr) return null;
  const first = typeof templateStr === 'string' ? safeJsonParse_ACU(templateStr, null) : templateStr;
  return typeof first === 'string' ? safeJsonParse_ACU(first, null) : first;
}

function buildTemplateSignatureSet_ACU(templateObj: any): Set<string> {
  const signatures = new Set<string>();
  if (!templateObj || typeof templateObj !== 'object' || Array.isArray(templateObj)) return signatures;
  Object.keys(templateObj).forEach((key) => {
    const sheet = templateObj[key];
    if (!sheet?.name || !Array.isArray(sheet.content?.[0])) return;
    signatures.add(`${sheet.name}::${JSON.stringify(sheet.content[0])}`);
  });
  return signatures;
}

function setsEqual_ACU(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function isDefaultTableTemplateCandidate_ACU(templateStr: any): boolean {
  const templateObj = parseTableTemplateObjectFromString_ACU(templateStr);
  const candidateSignatures = buildTemplateSignatureSet_ACU(templateObj);
  if (candidateSignatures.size === 0) return false;
  const defaultCandidates = [DEFAULT_TABLE_TEMPLATE_ACU, ORIGINAL_DEFAULT_TABLE_TEMPLATE_ACU]
    .map(parseTableTemplateObjectFromString_ACU)
    .map(buildTemplateSignatureSet_ACU)
    .filter((signatures) => signatures.size > 0);
  return defaultCandidates.some((signatures) => setsEqual_ACU(candidateSignatures, signatures));
}

function relaxStoredOriginalDefaultDdls_ACU(templateObj: any): boolean {
  if (!templateObj || typeof templateObj !== 'object' || Array.isArray(templateObj)) return false;
  const parseDefaultTemplate_ACU = () => {
    const first = safeJsonParse_ACU(ORIGINAL_DEFAULT_TABLE_TEMPLATE_ACU, null);
    return typeof first === 'string' ? safeJsonParse_ACU(first, null) : first;
  };
  const relaxedDefault = parseDefaultTemplate_ACU();
  if (!relaxedDefault || typeof relaxedDefault !== 'object') return false;

  const signatureToDdl = new Map<string, string>();
  Object.keys(relaxedDefault).forEach((key) => {
    const sheet = relaxedDefault[key];
    if (!sheet?.name || !Array.isArray(sheet.content?.[0]) || typeof sheet.sourceData?.ddl !== 'string') return;
    signatureToDdl.set(`${sheet.name}::${JSON.stringify(sheet.content[0])}`, sheet.sourceData.ddl);
  });

  let changed = false;
  Object.keys(templateObj).forEach((key) => {
    const sheet = templateObj[key];
    if (!sheet?.name || !Array.isArray(sheet.content?.[0]) || !sheet.sourceData || typeof sheet.sourceData !== 'object') return;
    const relaxedDdl = signatureToDdl.get(`${sheet.name}::${JSON.stringify(sheet.content[0])}`);
    if (!relaxedDdl || sheet.sourceData.ddl === relaxedDdl) return;
    sheet.sourceData.ddl = relaxedDdl;
    changed = true;
  });
  return changed;
}

// ═══════════════════════════════════════════════════════════════
// [剧情推进] 世界书选择以角色卡为单位持久化
//
// 权威副本：settings_ACU.plotWorldbookConfigByCharacter[<角色卡键>]
// 运行时投影：settings_ACU.plotSettings.plotWorldbookConfig（剧情引擎 / Agent / UI 一律读写这里）
//
// 加载设置、切换聊天时把当前角色卡的选择投影到运行时字段；保存设置时把运行时字段回写到
// 当前投影所属的角色卡槽位。这样同一张卡下切换/新建聊天，来源与手动选择保持不变，
// 且所有既有读取方无需改动。
// ═══════════════════════════════════════════════════════════════

type PlotWorldbookConfigShape_ACU = {
  source: 'character' | 'manual';
  manualSelection: string[];
  enabledEntries: Record<string, unknown>;
};

/** 当前 plotSettings.plotWorldbookConfig 投影所属的角色卡键；回写时优先使用，避免宿主状态漂移导致写错槽位。 */
let projectedPlotWorldbookScopeKey_ACU = '';

function ensurePlotSettingsObject_ACU(): Record<string, any> {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) {
      settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
  }
  return settings_ACU.plotSettings as Record<string, any>;
}

function normalizePlotWorldbookConfig_ACU(raw: unknown): PlotWorldbookConfigShape_ACU {
  const normalized: PlotWorldbookConfigShape_ACU = buildDefaultPlotWorldbookConfig_ACU();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalized;
  const source = raw as Record<string, any>;
  normalized.source = source.source === 'manual' ? 'manual' : 'character';
  if (Array.isArray(source.manualSelection)) {
      for (const name of source.manualSelection) {
          const trimmed = String(name || '').trim();
          if (trimmed && !normalized.manualSelection.includes(trimmed)) normalized.manualSelection.push(trimmed);
      }
  }
  if (source.enabledEntries && typeof source.enabledEntries === 'object' && !Array.isArray(source.enabledEntries)) {
      normalized.enabledEntries = JSON.parse(JSON.stringify(source.enabledEntries));
  }
  return normalized;
}

function getPlotWorldbookConfigStore_ACU(): Record<string, PlotWorldbookConfigShape_ACU> | null {
  const store = settings_ACU.plotWorldbookConfigByCharacter;
  return store && typeof store === 'object' && !Array.isArray(store) ? store : null;
}

function ensurePlotWorldbookConfigStore_ACU(): Record<string, PlotWorldbookConfigShape_ACU> {
  const existing = getPlotWorldbookConfigStore_ACU();
  if (existing) return existing;
  settings_ACU.plotWorldbookConfigByCharacter = {};
  return settings_ACU.plotWorldbookConfigByCharacter;
}

export type PlotWorldbookSelectionApplyResult_ACU = {
  scopeKey: string;
  /** restored：恢复了该角色卡已保存的选择；migrated：升级后首次把现有全局选择归入当前卡；
   *  default：新角色卡从默认值开始；deferred：宿主角色状态未就绪且尚未建立按卡存储，本次保持旧全局行为。 */
  outcome: 'restored' | 'migrated' | 'default' | 'deferred';
};

/**
 * 把当前角色卡保存的剧情世界书选择投影到 plotSettings.plotWorldbookConfig。
 *
 * - 已有该角色卡的记录：恢复它（不再像旧逻辑那样强制打回"角色卡绑定世界书"）。
 * - 升级后首次遇到可靠的角色卡键（按卡存储尚不存在）：把现有全局选择作为该卡的初始值，避免升级后丢失用户选择。
 *   若此时宿主还取不到角色卡（启动早期），先不建立按卡存储，等 CHAT_CHANGED 再迁移，避免把选择归入错误的键。
 * - 之后新遇到的角色卡：从默认值（角色卡绑定世界书）开始。
 */
export function applyPlotWorldbookSelectionForCurrentCharacter_ACU(): PlotWorldbookSelectionApplyResult_ACU {
  const plotSettings = ensurePlotSettingsObject_ACU();
  const scope = resolveCurrentCharacterScope_ACU();
  const existingStore = getPlotWorldbookConfigStore_ACU();

  if (!existingStore && !scope.reliable) {
      plotSettings.plotWorldbookConfig = normalizePlotWorldbookConfig_ACU(plotSettings.plotWorldbookConfig);
      projectedPlotWorldbookScopeKey_ACU = '';
      return { scopeKey: '', outcome: 'deferred' };
  }

  const store = ensurePlotWorldbookConfigStore_ACU();
  const saved = store[scope.key];
  if (saved && typeof saved === 'object') {
      plotSettings.plotWorldbookConfig = normalizePlotWorldbookConfig_ACU(saved);
      store[scope.key] = normalizePlotWorldbookConfig_ACU(plotSettings.plotWorldbookConfig);
      projectedPlotWorldbookScopeKey_ACU = scope.key;
      return { scopeKey: scope.key, outcome: 'restored' };
  }

  const outcome = existingStore ? 'default' : 'migrated';
  plotSettings.plotWorldbookConfig = outcome === 'migrated'
      ? normalizePlotWorldbookConfig_ACU(plotSettings.plotWorldbookConfig)
      : buildDefaultPlotWorldbookConfig_ACU();
  store[scope.key] = normalizePlotWorldbookConfig_ACU(plotSettings.plotWorldbookConfig);
  projectedPlotWorldbookScopeKey_ACU = scope.key;
  logDebug_ACU(`[剧情推进] 角色卡 "${scope.key}" 尚无世界书选择记录，已${outcome === 'migrated' ? '沿用现有全局选择' : '使用默认值'}初始化。`);
  return { scopeKey: scope.key, outcome };
}

/**
 * 把运行时投影回写到其所属角色卡槽位（保存设置前调用）。
 * 尚未完成任何投影（deferred）时不回写，避免把内容归入错误的键。
 */
export function syncPlotWorldbookSelectionToCharacterStore_ACU(): string {
  if (!projectedPlotWorldbookScopeKey_ACU) return '';
  const plotSettings = settings_ACU.plotSettings;
  const cfg = plotSettings && typeof plotSettings === 'object' ? plotSettings.plotWorldbookConfig : null;
  if (!cfg || typeof cfg !== 'object') return '';
  ensurePlotWorldbookConfigStore_ACU()[projectedPlotWorldbookScopeKey_ACU] = normalizePlotWorldbookConfig_ACU(cfg);
  return projectedPlotWorldbookScopeKey_ACU;
}

/** 仅供测试重置模块级投影状态。 */
export const _reset_projectedPlotWorldbookScopeKey_ACU = () => { projectedPlotWorldbookScopeKey_ACU = ''; };

export function saveSettings_ACU(): SaveSettingsResult_ACU {
  if (!settingsStorageReadyForSave_ACU) {
      if (isIndexedDbAvailable_ACU() && !configIdbCacheLoaded_ACU) {
          scheduleSettingsReloadAfterIdbReady_ACU('save_before_config_cache_ready');
      } else {
          void initTavernSettingsBridge_ACU();
      }
      logWarn_ACU('[设置保存] 设置尚未完成可靠加载，已拒绝本次保存以避免默认配置覆盖真实配置。');
      return {
          saved: false,
          storageType: 'memory',
          code: 'settings_loading',
          warning: '设置仍在加载中，本次保存已被阻止以避免覆盖原配置。请稍后重试。',
      };
  }

  // [剧情推进] 运行时世界书选择回写到当前角色卡槽位
  syncPlotWorldbookSelectionToCharacterStore_ACU();

  // 业务编排：同步隔离码到 globalMeta + 持久化
  const code = normalizeIsolationCode_ACU(settings_ACU?.dataIsolationCode || globalMeta_ACU?.activeIsolationCode || '');
  if (globalMeta_ACU && typeof globalMeta_ACU === 'object') {
    globalMeta_ACU.activeIsolationCode = code;
    if (code) addDataIsolationHistory_ACU(code, { save: false });
    normalizeDataIsolationHistory_ACU(globalMeta_ACU.isolationCodeList);
    saveGlobalMeta_ACU();
  }

  // 数据层：纯存储持久化
  persistSettingsToStorage_ACU(settings_ACU, code);

  try {
      const store = (getConfigStorage_ACU)();
      if (store && !store._isTavern) {
          if ((isIndexedDbAvailable_ACU)()) {
              void (initTavernSettingsBridge_ACU)();
              return { saved: true, storageType: 'indexeddb', code: 'tavern_unavailable', warning: '当前未连接酒馆设置：已保存到 IndexedDB（仅本浏览器可用）。' };
          } else {
              void (initTavernSettingsBridge_ACU)();
              return { saved: true, storageType: 'memory', code: 'tavern_unavailable', warning: '⚠️ 当前未连接酒馆设置且 IndexedDB 不可用，本次修改刷新后会丢失。' };
          }
      }
      return { saved: true, storageType: 'tavern' };
  } catch (error) {
      logError_ACU('Failed to save settings:', error);
      return { saved: false, storageType: 'memory', code: 'storage_error', error: '保存设置时发生浏览器存储错误。' };
  }
}


export   function loadSettings_ACU() {
      // 确保酒馆设置桥接已就绪（best-effort，不阻塞）
      void initTavernSettingsBridge_ACU();
      if (!configIdbCacheLoaded_ACU && isIndexedDbAvailable_ACU()) {
          scheduleSettingsReloadAfterIdbReady_ACU('load_before_config_cache_ready');
          return;
      }
      _set_pendingSettingsReloadFromIdb_ACU(false);

      // 可选迁移：把旧 localStorage 的设置/模板搬迁到酒馆设置（迁移开关默认为 false）
      migrateKeyToTavernStorageIfNeeded_ACU(STORAGE_KEY_ALL_SETTINGS_ACU);
      migrateKeyToTavernStorageIfNeeded_ACU(STORAGE_KEY_CUSTOM_TEMPLATE_ACU);

      // 1) 读取全局元信息（跨标识共享：标识列表/当前标识）
      loadGlobalMeta_ACU();

      const store = getConfigStorage_ACU();
      const legacySettingsJson = store?.getItem?.(STORAGE_KEY_ALL_SETTINGS_ACU);
      const legacySettingsObj = legacySettingsJson ? safeJsonParse_ACU(legacySettingsJson, null) : null;
      const legacyCode = normalizeIsolationCode_ACU(legacySettingsObj?.dataIsolationCode || '');

      // 2) 一次性迁移：旧版"单份设置/单份模板" -> 当前标识对应 profile
      if (!globalMeta_ACU.migratedLegacySingleStore && (legacySettingsObj || store?.getItem?.(STORAGE_KEY_CUSTOM_TEMPLATE_ACU))) {
          const targetCode = legacyCode; // 旧版 code 就是当时的隔离标识
          const hasProfileSettings = !!readProfileSettingsFromStorage_ACU(targetCode);
          const hasProfileTemplate = !!readProfileTemplateFromStorage_ACU(targetCode);
          try {
              if (!hasProfileSettings && legacySettingsObj) {
                  const toSave = sanitizeSettingsForProfileSave_ACU(legacySettingsObj);
                  toSave.dataIsolationCode = targetCode;
                  writeProfileSettingsToStorage_ACU(targetCode, toSave);
              }
              if (!hasProfileTemplate) {
                  const legacyTemplate = store?.getItem?.(STORAGE_KEY_CUSTOM_TEMPLATE_ACU);
                  if (legacyTemplate && String(legacyTemplate).trim()) {
                      writeProfileTemplateToStorage_ACU(targetCode, legacyTemplate);
                  }
              }
              // 同步迁移"标识列表"到 globalMeta（跨标识共享）
              if (Array.isArray(legacySettingsObj?.dataIsolationHistory)) {
                  globalMeta_ACU.isolationCodeList = legacySettingsObj.dataIsolationHistory;
              }
              if (targetCode) {
                  globalMeta_ACU.activeIsolationCode = targetCode;
                  // 确保 active 在列表里
                  globalMeta_ACU.isolationCodeList = [targetCode, ...(globalMeta_ACU.isolationCodeList || [])];
              }
              normalizeDataIsolationHistory_ACU(globalMeta_ACU.isolationCodeList);
              globalMeta_ACU.migratedLegacySingleStore = true;
              saveGlobalMeta_ACU();
              // 迁移完成后移除 legacy 键，避免后续反复读取造成混乱
              try { store?.removeItem?.(STORAGE_KEY_ALL_SETTINGS_ACU); } catch (e) {}
              try { store?.removeItem?.(STORAGE_KEY_CUSTOM_TEMPLATE_ACU); } catch (e) {}
              logDebug_ACU(`[Profile] Migrated legacy single-store -> profile: ${targetCode || '(default)'}`);
          } catch (e) {
              logWarn_ACU('[Profile] Legacy migration failed (will keep legacy keys):', e);
          }
      }

      // 3) 决定本次启动要加载的标识 code（优先 globalMeta.active，其次 legacyCode）
      const activeCode = normalizeIsolationCode_ACU(globalMeta_ACU.activeIsolationCode || legacyCode || '');
      globalMeta_ACU.activeIsolationCode = activeCode;
      if (activeCode) addDataIsolationHistory_ACU(activeCode, { save: false });
      normalizeDataIsolationHistory_ACU(globalMeta_ACU.isolationCodeList);
      saveGlobalMeta_ACU();

      // 4) 加载模板（按标识 profile）
      loadTemplateFromStorage_ACU(activeCode);

      // 5) 加载设置（按标识 profile）
      const defaultSettings = buildDefaultSettings_ACU();
      let shouldPersistSettingsAfterLoad_ACU = false;

      try {
          const savedSettings = readProfileSettingsFromStorage_ACU(activeCode);
          if (savedSettings) {

              // [迁移逻辑] 检查旧的顶层 worldbookConfig
              if (savedSettings.worldbookConfig) {
                  logDebug_ACU('Migrating legacy worldbookConfig to character-specific settings.');
                  // 如果存在，并且没有 characterSettings，则创建一个
                  if (!savedSettings.characterSettings) {
                      savedSettings.characterSettings = {};
                  }
                  // 将旧配置迁移到当前角色卡键下，以便初次加载时使用
                  // 这里我们假设它应该成为所有未配置角色的基础，但为了简单起见，我们只处理当前角色
                  const charId = getCurrentCharacterScopeKey_ACU();
                  if (!savedSettings.characterSettings[charId]) {
                       savedSettings.characterSettings[charId] = { worldbookConfig: savedSettings.worldbookConfig };
                  }
                  // 删除顶层配置
                  delete savedSettings.worldbookConfig;
              }
              
              // Deep merge saved settings into defaults to ensure new properties are added
              _set_settings_ACU(deepMerge_ACU(defaultSettings, savedSettings));

              // [剧情推进] 迁移/兜底：确保 plotWorldbookConfig 存在且结构完整
              if (!settings_ACU.plotSettings) settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
              if (!settings_ACU.plotSettings.plotWorldbookConfig) {
                  // 兼容旧字段迁移：worldbookSource/selectedWorldbooks -> plotWorldbookConfig
                  const legacySource = settings_ACU.plotSettings.worldbookSource || 'character';
                  const legacyBooks = Array.isArray(settings_ACU.plotSettings.selectedWorldbooks) ? settings_ACU.plotSettings.selectedWorldbooks : [];
                  settings_ACU.plotSettings.plotWorldbookConfig = buildDefaultPlotWorldbookConfig_ACU();
                  settings_ACU.plotSettings.plotWorldbookConfig.source = (legacySource === 'manual') ? 'manual' : 'character';
                  settings_ACU.plotSettings.plotWorldbookConfig.manualSelection = legacyBooks;
              }
              applyGlobalPlotEnabledSetting_ACU();
              if (!settings_ACU.plotPresetBindings || typeof settings_ACU.plotPresetBindings !== 'object' || Array.isArray(settings_ACU.plotPresetBindings)) {
                  settings_ACU.plotPresetBindings = {};
              }
              if (!settings_ACU.plotTaskApiPresetOverridesById || typeof settings_ACU.plotTaskApiPresetOverridesById !== 'object' || Array.isArray(settings_ACU.plotTaskApiPresetOverridesById)) {
                  settings_ACU.plotTaskApiPresetOverridesById = {};
              }
              settings_ACU.currentTemplatePresetName = normalizeTemplatePresetSelectionValue_ACU(settings_ACU.currentTemplatePresetName || '');
              if (typeof settings_ACU.plotSettings.lastUsedPresetName !== 'string') {
                  settings_ACU.plotSettings.lastUsedPresetName = '';
              }

              // [Profile] 强制以 globalMeta.activeIsolationCode 作为当前标识
              settings_ACU.dataIsolationCode = activeCode;
              settings_ACU.dataIsolationEnabled = (activeCode !== '');

              // 0TK / 纪要向量索引全局偏好：两者独立读取、独立写入，不再互斥投影
              if (typeof globalMeta_ACU.zeroTkOccupyModeGlobal === 'boolean') {
                  settings_ACU.zeroTkOccupyModeDefault = (globalMeta_ACU.zeroTkOccupyModeGlobal === true);
              } else {
                  globalMeta_ACU.zeroTkOccupyModeGlobal = (settings_ACU.zeroTkOccupyModeDefault === true);
                  saveGlobalMeta_ACU();
              }
              if (typeof globalMeta_ACU.summaryVectorIndexModeGlobal === 'boolean') {
                  settings_ACU.summaryVectorIndexModeDefault = (globalMeta_ACU.summaryVectorIndexModeGlobal === true);
              } else {
                  globalMeta_ACU.summaryVectorIndexModeGlobal = (settings_ACU.summaryVectorIndexModeDefault === true);
                  saveGlobalMeta_ACU();
              }

              // 确保当前角色有配置
              getCurrentCharSettings_ACU();
              if (!settings_ACU.characterSettings || typeof settings_ACU.characterSettings !== 'object') {
                  settings_ACU.characterSettings = {};
              }
              const defaultWorldbookConfig = JSON.parse(JSON.stringify(defaultWorldbookConfig_ACU));
              Object.keys(settings_ACU.characterSettings).forEach((charId) => {
                  const charSettings = settings_ACU.characterSettings[charId];
                  if (!charSettings || typeof charSettings !== 'object') return;
                  const worldbookConfig = charSettings.worldbookConfig;
                  if (!worldbookConfig || typeof worldbookConfig !== 'object' || Array.isArray(worldbookConfig)) {
                      charSettings.worldbookConfig = JSON.parse(JSON.stringify(defaultWorldbookConfig));
                      return;
                  }
                  charSettings.worldbookConfig = deepMerge_ACU(
                      JSON.parse(JSON.stringify(defaultWorldbookConfig)),
                      worldbookConfig,
                  );
              });
              
          } else {
              // No saved settings, use the defaults
              _set_settings_ACU(defaultSettings);
              // [剧情推进] 默认兜底
              if (!settings_ACU.plotSettings.plotWorldbookConfig) {
                  settings_ACU.plotSettings.plotWorldbookConfig = buildDefaultPlotWorldbookConfig_ACU();
              }
              applyGlobalPlotEnabledSetting_ACU();
              // [Profile] 强制以 globalMeta.activeIsolationCode 作为当前标识
              settings_ACU.dataIsolationCode = activeCode;
              settings_ACU.dataIsolationEnabled = (activeCode !== '');
              if (typeof globalMeta_ACU.zeroTkOccupyModeGlobal === 'boolean') {
                  settings_ACU.zeroTkOccupyModeDefault = (globalMeta_ACU.zeroTkOccupyModeGlobal === true);
              } else {
                  globalMeta_ACU.zeroTkOccupyModeGlobal = (settings_ACU.zeroTkOccupyModeDefault === true);
                  saveGlobalMeta_ACU();
              }
              if (typeof globalMeta_ACU.summaryVectorIndexModeGlobal === 'boolean') {
                  settings_ACU.summaryVectorIndexModeDefault = (globalMeta_ACU.summaryVectorIndexModeGlobal === true);
              } else {
                  globalMeta_ACU.summaryVectorIndexModeGlobal = (settings_ACU.summaryVectorIndexModeDefault === true);
                  saveGlobalMeta_ACU();
              }
          }
      } catch (error) {
          logError_ACU('Failed to load or parse settings, using defaults:', error);
          _set_settings_ACU(buildDefaultSettings_ACU());
          settings_ACU.dataIsolationCode = activeCode;
          settings_ACU.dataIsolationEnabled = (activeCode !== '');
      }

      // [剧情推进] 世界书选择以角色卡为单位：把当前角色卡的记录投影到运行时字段。
      // 必须在本函数内任何 saveSettings_ACU 调用之前完成，否则会把上一张卡的选择回写进当前卡槽位。
      applyPlotWorldbookSelectionForCurrentCharacter_ACU();

      if (ensureAgentWorldbookControlDefaults_ACU()) {
          shouldPersistSettingsAfterLoad_ACU = true;
      }
      if (ensureAgentPromptTemplateDefaults_ACU()) {
          shouldPersistSettingsAfterLoad_ACU = true;
      }
      // [兼容] 旧标签排除字段自动迁移为新规则组结构
      ensureTagRulesCompat_ACU(settings_ACU);
      if (ensureBuiltinPlotPresets_ACU()) {
          shouldPersistSettingsAfterLoad_ACU = true;
          logDebug_ACU('[剧情推进预设] 已补齐内置预设：时间召回');
      }

      settingsStorageReadyForSave_ACU = true;

      // [交火模式配置] 权威配置存放在 globalMeta.vectorMemoryConfigGlobal（跨 profile 全局）。
      // settings_ACU.vectorMemoryConfig 只保留为运行时投影，兼容旧调用方。
      if (!globalMeta_ACU.vectorMemoryConfigGlobal || typeof globalMeta_ACU.vectorMemoryConfigGlobal !== 'object' || Array.isArray(globalMeta_ACU.vectorMemoryConfigGlobal)) {
          let bestSource: any = null;
          if (settings_ACU.vectorMemoryConfig && typeof settings_ACU.vectorMemoryConfig === 'object' && !Array.isArray(settings_ACU.vectorMemoryConfig)) {
              bestSource = settings_ACU.vectorMemoryConfig;
          }
          const charSettings = settings_ACU.characterSettings;
          if (!bestSource && charSettings && typeof charSettings === 'object') {
              for (const charId of Object.keys(charSettings)) {
                  const vm = charSettings[charId]?.worldbookConfig?.vectorMemory;
                  if (vm && typeof vm === 'object' && !Array.isArray(vm)) {
                      // 优先选择 enabled=true 的配置
                      if (vm.enabled === true) {
                          bestSource = vm;
                          break;
                      }
                      // 其次选择第一个非空配置
                      if (!bestSource) {
                          bestSource = vm;
                      }
                  }
              }
          }
          globalMeta_ACU.vectorMemoryConfigGlobal = bestSource
              ? JSON.parse(JSON.stringify(bestSource))
              : JSON.parse(JSON.stringify(defaultVectorMemoryConfig_ACU));
          saveGlobalMeta_ACU();
          logDebug_ACU(bestSource
              ? '[交火模式配置] 已从旧 profile/角色配置迁移到全局 globalMeta.vectorMemoryConfigGlobal'
              : '[交火模式配置] 已初始化全局 globalMeta.vectorMemoryConfigGlobal');
      }
      settings_ACU.vectorMemoryConfig = globalMeta_ACU.vectorMemoryConfigGlobal;

      // [交火模式] 一次性补齐默认归档/召回/关键词提示词参数。
      // 只能补缺失字段，绝不能在版本刷新时覆盖用户已经填写的模型、API、召回参数或提示词。
      if (globalMeta_ACU.vectorMemoryConfigGlobal && typeof globalMeta_ACU.vectorMemoryConfigGlobal === 'object' && !Array.isArray(globalMeta_ACU.vectorMemoryConfigGlobal)) {
          const vectorConfig = globalMeta_ACU.vectorMemoryConfigGlobal as any;
          const cloneDefaultValue_ACU = (value: any) => JSON.parse(JSON.stringify(value));
          const fillMissing_ACU = (key: string, value: any) => {
              if (typeof vectorConfig[key] === 'undefined' || vectorConfig[key] === null || vectorConfig[key] === '') {
                  vectorConfig[key] = cloneDefaultValue_ACU(value);
                  shouldPersistSettingsAfterLoad_ACU = true;
              }
          };
          // Rollout 闸门迁移：默认值已切换到 true。
          // 1) 缺字段的用户由 fillMissing 补为 true。
          // 2) 独立的 SUMMARY_INDEX_V2_WRITER_FORCE_ENABLE_VERSION marker 用于一次性强制反转
          //    此前显式保存过 false 的用户；marker 写入后用户手动再关会被永久保留。
          fillMissing_ACU('summaryIndexV2WriteEnabled', (defaultVectorMemoryConfig_ACU as any).summaryIndexV2WriteEnabled === true);
          if (vectorConfig.summaryIndexV2WriteForceEnableVersion !== SUMMARY_INDEX_V2_WRITER_FORCE_ENABLE_VERSION_ACU) {
              if (vectorConfig.summaryIndexV2WriteEnabled !== true) {
                  vectorConfig.summaryIndexV2WriteEnabled = true;
                  shouldPersistSettingsAfterLoad_ACU = true;
                  logDebug_ACU(`[交火模式配置] 一次性强制开启 V2 writer: ${SUMMARY_INDEX_V2_WRITER_FORCE_ENABLE_VERSION_ACU}`);
              }
              vectorConfig.summaryIndexV2WriteForceEnableVersion = SUMMARY_INDEX_V2_WRITER_FORCE_ENABLE_VERSION_ACU;
              shouldPersistSettingsAfterLoad_ACU = true;
          }
          fillMissing_ACU('summaryIndexV2WriteScopeAllowlist', (defaultVectorMemoryConfig_ACU as any).summaryIndexV2WriteScopeAllowlist || []);
          // P4 内容寻址 pack 写入：默认关闭。**不加**强制开启 marker（V2 writer 曾用一次性强制反转，
          // 但 pack 写入属于灰度能力，只允许显式开启，绝不自动打开）。
          fillMissing_ACU('summaryIndexContentPackWriteEnabled', (defaultVectorMemoryConfig_ACU as any).summaryIndexContentPackWriteEnabled === true);
          fillMissing_ACU('summaryIndexContentPackWriteScopeAllowlist', (defaultVectorMemoryConfig_ACU as any).summaryIndexContentPackWriteScopeAllowlist || []);
          if (vectorConfig.defaultsRefreshVersion !== VECTOR_MEMORY_DEFAULTS_REFRESH_VERSION_ACU) {
              const fillMissingPromptGroup_ACU = (key: string, value: any[]) => {
                  if (!Array.isArray(vectorConfig[key]) || vectorConfig[key].length === 0) {
                      vectorConfig[key] = cloneDefaultValue_ACU(value || []);
                      shouldPersistSettingsAfterLoad_ACU = true;
                  }
              };
              const fillMissingOrLegacyDefault_ACU = (key: string, value: any, legacyValues: any[]) => {
                  const currentValue = vectorConfig[key];
                  const isMissing = typeof currentValue === 'undefined' || currentValue === null || currentValue === '';
                  const isLegacyDefault = legacyValues.some((legacyValue) => currentValue === legacyValue);
                  if (isMissing || isLegacyDefault) {
                      vectorConfig[key] = cloneDefaultValue_ACU(value);
                      shouldPersistSettingsAfterLoad_ACU = true;
                  }
              };

              fillMissing_ACU('archiveTriggerCount', defaultVectorMemoryConfig_ACU.archiveTriggerCount);
              fillMissing_ACU('archiveBatchSize', defaultVectorMemoryConfig_ACU.archiveBatchSize);
              fillMissing_ACU('archiveMaxConcurrency', defaultVectorMemoryConfig_ACU.archiveMaxConcurrency);
              fillMissing_ACU('summaryIndexArchiveMaxConcurrency', (defaultVectorMemoryConfig_ACU as any).summaryIndexArchiveMaxConcurrency || 30);
              // [spv3.5.21] 一次性覆盖：topK / recallCandidateLimit / summaryIndexKeywordMinRows 强制更新到新默认值
              const forceOverride_ACU = (key: string, newValue: any, legacyValues: any[]) => {
                  const current = vectorConfig[key];
                  const isLegacy = legacyValues.some((v) => current === v);
                  if (isLegacy) {
                      vectorConfig[key] = cloneDefaultValue_ACU(newValue);
                      shouldPersistSettingsAfterLoad_ACU = true;
                  }
              };
              fillMissingOrLegacyDefault_ACU('topK', defaultVectorMemoryConfig_ACU.topK, [10, 100]);
              forceOverride_ACU('topK', defaultVectorMemoryConfig_ACU.topK, [100]);
              fillMissingOrLegacyDefault_ACU('minScore', defaultVectorMemoryConfig_ACU.minScore, [0.4, 0.6]);
              fillMissingOrLegacyDefault_ACU('recallCandidateLimit', defaultVectorMemoryConfig_ACU.recallCandidateLimit, [100]);
              forceOverride_ACU('recallCandidateLimit', defaultVectorMemoryConfig_ACU.recallCandidateLimit, [100, 500]);
              fillMissingOrLegacyDefault_ACU('summaryIndexKeywordMinRows', (defaultVectorMemoryConfig_ACU as any).summaryIndexKeywordMinRows, [100]);
              forceOverride_ACU('summaryIndexKeywordMinRows', (defaultVectorMemoryConfig_ACU as any).summaryIndexKeywordMinRows, [100]);
              fillMissing_ACU('recentFixedInjectCount', (defaultVectorMemoryConfig_ACU as any).recentFixedInjectCount || 50);
              fillMissing_ACU('summaryIndexRollingDeltaEnabled', (defaultVectorMemoryConfig_ACU as any).summaryIndexRollingDeltaEnabled === true);
              fillMissing_ACU('summaryIndexRollingDeltaFoldThreshold', (defaultVectorMemoryConfig_ACU as any).summaryIndexRollingDeltaFoldThreshold || 15);
              fillMissing_ACU('hybridRetrievalEnabled', (defaultVectorMemoryConfig_ACU as any).hybridRetrievalEnabled !== false);
              fillMissing_ACU('bm25CandidateLimit', (defaultVectorMemoryConfig_ACU as any).bm25CandidateLimit || defaultVectorMemoryConfig_ACU.recallCandidateLimit || 1000);
              fillMissing_ACU('rrfK', (defaultVectorMemoryConfig_ACU as any).rrfK || 60);
              fillMissingPromptGroup_ACU('summaryPromptGroup', defaultVectorMemoryConfig_ACU.summaryPromptGroup || []);
              // [spv3.6.3] 关键词提示词：版本变更时无条件覆盖为最新默认值
              // 不做签名匹配——签名匹配在用户微调过提示词后必然失效，导致覆盖永远不触发
              vectorConfig.keywordPromptGroup = cloneDefaultValue_ACU(defaultVectorMemoryConfig_ACU.keywordPromptGroup || []);
              shouldPersistSettingsAfterLoad_ACU = true;
              logDebug_ACU('[交火模式配置] 已一次性覆盖关键词生成提示词为最新默认版本');
              fillMissing_ACU('keywordGenerationMaxAttempts', (defaultVectorMemoryConfig_ACU as any).keywordGenerationMaxAttempts || 3);
              vectorConfig.defaultsRefreshVersion = VECTOR_MEMORY_DEFAULTS_REFRESH_VERSION_ACU;
              shouldPersistSettingsAfterLoad_ACU = true;
              logDebug_ACU(`[交火模式配置] 已补齐缺失默认参数并记录版本: ${VECTOR_MEMORY_DEFAULTS_REFRESH_VERSION_ACU}`);
          }
          // [spv9.2] 源文本升级：embedding/BM25 改用"概览 + 纪要正文"。独立 marker，
          // 不复用 defaultsRefreshVersion——那条分支会无条件覆盖关键词提示词，不能因 minScore 迁移误触发。
          fillMissing_ACU('keywordGenerationEnabled', (defaultVectorMemoryConfig_ACU as any).keywordGenerationEnabled !== false);
          fillMissing_ACU('rerankBatchSize', (defaultVectorMemoryConfig_ACU as any).rerankBatchSize || 300);
          fillMissing_ACU('summaryIndexChunkChronicleBySentence', (defaultVectorMemoryConfig_ACU as any).summaryIndexChunkChronicleBySentence === true);
          if (vectorConfig.sourceTextUpgradeVersion !== VECTOR_MEMORY_SOURCE_TEXT_UPGRADE_VERSION_ACU) {
              const currentMinScore = Number(vectorConfig.minScore);
              const isLegacyDefault = !Number.isFinite(currentMinScore)
                  || VECTOR_MEMORY_LEGACY_MIN_SCORE_DEFAULTS_ACU.some((legacy) => Math.abs(currentMinScore - legacy) < 1e-9);
              if (isLegacyDefault) {
                  vectorConfig.minScore = defaultVectorMemoryConfig_ACU.minScore;
                  logDebug_ACU(`[交火模式配置] 源文本升级：minScore 从旧默认值迁移为 ${defaultVectorMemoryConfig_ACU.minScore}`);
              }
              vectorConfig.sourceTextUpgradeVersion = VECTOR_MEMORY_SOURCE_TEXT_UPGRADE_VERSION_ACU;
              shouldPersistSettingsAfterLoad_ACU = true;
          }
          // [spv9.2] 召回参数一次性强制覆盖为新默认值：源文本升级后旧的阈值/TopK/候选上限/固定写入
          // 已不适配。只覆盖 VECTOR_MEMORY_RECALL_PARAM_KEYS_ACU 列出的召回参数；
          // API 地址、密钥、模型名、提示词、命名空间一律不动。marker 写入后用户再改会被永久保留。
          if (vectorConfig.recallParamsForceOverrideVersion !== VECTOR_MEMORY_RECALL_PARAMS_FORCE_OVERRIDE_VERSION_ACU) {
              const changed: string[] = [];
              for (const key of VECTOR_MEMORY_RECALL_PARAM_KEYS_ACU) {
                  const nextValue = (defaultVectorMemoryConfig_ACU as any)[key];
                  if (typeof nextValue === 'undefined') continue;
                  if (vectorConfig[key] !== nextValue) {
                      vectorConfig[key] = cloneDefaultValue_ACU(nextValue);
                      changed.push(`${key}=${String(nextValue)}`);
                  }
              }
              vectorConfig.recallParamsForceOverrideVersion = VECTOR_MEMORY_RECALL_PARAMS_FORCE_OVERRIDE_VERSION_ACU;
              shouldPersistSettingsAfterLoad_ACU = true;
              logDebug_ACU(`[交火模式配置] 已一次性覆盖召回参数为 spv9.2 默认值${changed.length ? `：${changed.join(', ')}` : '（无变化）'}`);
          }
      }

      settings_ACU.vectorMemoryConfig = globalMeta_ACU.vectorMemoryConfigGlobal;

      settingsStorageReadyForSave_ACU = true;
      refreshDefaultTableTemplateOnce_ACU(activeCode);
      forceDisableStrictJsonTableFillOnce_ACU();
      forceDefaultTableFillPromptsOnce_ACU();
      forceDefaultTemplateAssistantPromptOnce_ACU();

      if (shouldPersistSettingsAfterLoad_ACU) {
          saveGlobalMeta_ACU();
          persistSettingsToStorage_ACU(settings_ACU, activeCode);
          logDebug_ACU(`[设置加载] 已持久化加载期默认值补齐，交火配置版本: ${VECTOR_MEMORY_DEFAULTS_REFRESH_VERSION_ACU}`);
      }

      if (!Number.isFinite(settings_ACU.maxConcurrentGroups) || settings_ACU.maxConcurrentGroups < 1) {
          settings_ACU.maxConcurrentGroups = 1;
      }

      // [API 绑定 reconcile] 存储重载后把当前聊天绑定重新投影到 apiMode/apiConfig/tavernProfile。
      // 覆盖三条路径：CHAT_CHANGED（resetScriptStateForNewChat）、profile 切换（switchIsolationProfile）、
      // IDB 延迟重载（scheduleSettingsReloadAfterIdbReady 内部重入 loadSettings）。
      // 修复 A→B→A 后运行时仍使用 profile 最后保存配置的缺陷（主计划 §4.1）。
      const bound = reconcileApiBindingForCurrentChat_ACU();
      if (bound.applied) {
          persistSettingsToStorage_ACU(settings_ACU, activeCode);
          logDebug_ACU(`[API绑定] 已把当前聊天绑定投影到运行配置: ${bound.presetName}`);
      }
      logDebug_ACU('Settings loaded:', settings_ACU);
  }

  // loadSettingsAndRefreshUI_ACU 已搬到 presentation/components/settings-ui-helpers.ts


export   function loadTemplateFromStorage_ACU(codeOverride: any = null) {
      const code = normalizeIsolationCode_ACU(
          (codeOverride !== null && typeof codeOverride !== 'undefined')
              ? codeOverride
              : (settings_ACU?.dataIsolationCode || globalMeta_ACU?.activeIsolationCode || ''),
      );

      // [更新参数哨兵迁移] 旧版本：0 表示"沿用UI"；新版本：-1 表示"沿用UI"，0 表示"禁用/不参与"（仅 updateFrequency 参与禁用语义）
      function migrateTemplateUpdateConfigSentinel_ACU(templateObj: any) {
          if (!templateObj || typeof templateObj !== 'object') return { changed: false, obj: templateObj };

          const mate = (templateObj.mate && typeof templateObj.mate === 'object') ? templateObj.mate : null;
          const alreadyMigrated = !!(mate && mate.updateConfigUiSentinel === -1);
          if (alreadyMigrated) return { changed: false, obj: templateObj };

          let changed = false;
          const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
          for (const k of sheetKeys) {
              const sheet = templateObj[k];
              if (!sheet || typeof sheet !== 'object') continue;
              const uc = sheet.updateConfig;
              if (!uc || typeof uc !== 'object') continue;
              // sheet 级标记：用于聊天记录里的表格对象（没有 mate）也能识别新语义
              if (uc.uiSentinel !== -1) { uc.uiSentinel = -1; changed = true; }
              for (const field of ['contextDepth', 'updateFrequency', 'batchSize', 'skipFloors']) {
                  if (Object.prototype.hasOwnProperty.call(uc, field) && uc[field] === 0) {
                      uc[field] = -1;
                      changed = true;
                  }
              }
          }

          // 写入标记，避免后续把用户显式设置的 0(禁用) 再次误迁移
          if (!templateObj.mate || typeof templateObj.mate !== 'object') {
              templateObj.mate = { type: 'chatSheets', version: 1 };
              changed = true;
          } else {
              if (!templateObj.mate.type) templateObj.mate.type = 'chatSheets';
              if (!templateObj.mate.version) templateObj.mate.version = 1;
          }
          if (templateObj.mate.updateConfigUiSentinel !== -1) {
              templateObj.mate.updateConfigUiSentinel = -1;
              changed = true;
          }
          return { changed, obj: templateObj };
      }

      try {
          const savedTemplate = readProfileTemplateFromStorage_ACU(code);
          if (savedTemplate) {
              // [修复] 使用 safeJsonParse_ACU 静默处理解析失败，避免误报错误提示
              const parsedTemplate = safeJsonParse_ACU(savedTemplate, null);
              if (parsedTemplate && parsedTemplate.mate && Object.keys(parsedTemplate).some(k => k.startsWith('sheet_'))) {
                  // [迁移] 0(沿用UI) -> -1(沿用UI)，并写入标记
                  migrateTemplateUpdateConfigSentinel_ACU(parsedTemplate);
                  // [迁移] 对已保存的原默认表仅放宽 DDL 约束，不替换为新的恋爱特化默认表。
                  relaxStoredOriginalDefaultDdls_ACU(parsedTemplate);
                  // [Profile] 模板载入时先补齐/修复顺序编号，并回写（编号可随导出/导入迁移）
                  const sheetKeys = Object.keys(parsedTemplate).filter(k => k.startsWith('sheet_'));
                  ensureSheetOrderNumbers_ACU(parsedTemplate, { baseOrderKeys: sheetKeys, forceRebuild: false });
                  // [瘦身] 无论是否 changed，都清洗模板（去掉 domain/type/enable/triggerSend*/config/customStyles 等冗余字段）
                  const sanitizedTemplate = sanitizeChatSheetsObject_ACU(parsedTemplate, { ensureMate: true });
                  _set_TABLE_TEMPLATE_ACU(JSON.stringify(sanitizedTemplate));
                  writeProfileTemplateToStorage_ACU(code, TABLE_TEMPLATE_ACU);
                  logDebug_ACU(`[Profile] Template loaded for code: ${code || '(default)'}`);
                  return;
              } else if (parsedTemplate) {
                  // 解析成功但格式不正确，静默回退到默认模板
                  logDebug_ACU(`[Profile] Template format invalid for code: ${code || '(default)'}, using default.`);
              }
              // parsedTemplate 为 null 时表示解析失败，静默跳过（可能是旧的/其他标识的损坏数据）
          }
      } catch (error) {
          // 静默处理异常，避免误报错误提示困扰用户
          logDebug_ACU('[Profile] Template load skipped due to error, using default.', error?.message || error);
      }

      // No valid template found -> default
      _set_TABLE_TEMPLATE_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
      // [新机制] 默认模板也补齐一次编号（仅写入当前 profile，不改源码常量）
      try {
          const obj = JSON.parse(TABLE_TEMPLATE_ACU);
          // 默认模板也写入哨兵标记（便于后续识别新语义）
          try { migrateTemplateUpdateConfigSentinel_ACU(obj); } catch (e) {}
          const sheetKeys = Object.keys(obj).filter(k => k.startsWith('sheet_'));
          if (ensureSheetOrderNumbers_ACU(obj, { baseOrderKeys: sheetKeys, forceRebuild: false })) {
              const sanitizedTemplate = sanitizeChatSheetsObject_ACU(obj, { ensureMate: true });
              _set_TABLE_TEMPLATE_ACU(JSON.stringify(sanitizedTemplate));
          }
      } catch (e) {
          // ignore
      }
      try { writeProfileTemplateToStorage_ACU(code, TABLE_TEMPLATE_ACU); } catch (e) {}
      logDebug_ACU(`[Profile] No valid template found, default persisted for code: ${code || '(default)'}`);
  }


function refreshDefaultTableTemplateOnce_ACU(activeCode: string) {
      try {
          if (!settings_ACU || typeof settings_ACU !== 'object') return;
          if (settings_ACU.tableTemplateDefaultsRefreshVersion === TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU) return;

          const currentPresetName = normalizeTemplatePresetSelectionValue_ACU(settings_ACU.currentTemplatePresetName || '');
          if (currentPresetName) {
              settings_ACU.tableTemplateDefaultsRefreshVersion = TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU;
              saveSettings_ACU();
              logDebug_ACU(`[模板默认值] 当前全局模板使用命名预设，跳过默认模板刷新并记录版本: ${TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU}`);
              return;
          }

          const code = normalizeIsolationCode_ACU(activeCode || settings_ACU.dataIsolationCode || globalMeta_ACU?.activeIsolationCode || '');
          const existingTemplate = readProfileTemplateFromStorage_ACU(code);
          const defaultSnapshot = getDefaultTemplateSnapshot_ACU();
          if (!defaultSnapshot?.templateStr) {
              logWarn_ACU('[模板默认值] 默认表格模板快照无效，跳过一次性刷新。');
              return;
          }

          if (existingTemplate && existingTemplate.trim() && !isDefaultTableTemplateCandidate_ACU(existingTemplate)) {
              settings_ACU.tableTemplateDefaultsRefreshVersion = TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU;
              saveSettings_ACU();
              logDebug_ACU(`[模板默认值] 当前 profile 已有用户自定义模板，保留并记录版本: ${TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU}`);
              return;
          }

          _set_TABLE_TEMPLATE_ACU(defaultSnapshot.templateStr);
          writeProfileTemplateToStorage_ACU(code, defaultSnapshot.templateStr);
          settings_ACU.tableTemplateDefaultsRefreshVersion = TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU;
          saveSettings_ACU();
          logDebug_ACU(`[模板默认值] 已强制刷新当前 profile 默认表格模板: ${TABLE_TEMPLATE_DEFAULTS_REFRESH_VERSION_ACU}`);
      } catch (error) {
          logWarn_ACU('[模板默认值] 默认表格模板一次性刷新失败:', error);
      }
  }

/**
 * 一次性将历史用户保留的严格 JSON 填表开关关闭。
 * marker 写入后不再执行，用户仍可在高级设置中重新开启。
 */
function forceDisableStrictJsonTableFillOnce_ACU() {
      try {
          if (!settings_ACU || typeof settings_ACU !== 'object') return;
          if (settings_ACU.strictJsonTableFillForceDisableVersion === STRICT_JSON_TABLE_FILL_FORCE_DISABLE_VERSION_ACU) return;

          settings_ACU.strictJsonTableFillEnabled = false;
          settings_ACU.strictJsonTableFillForceDisableVersion = STRICT_JSON_TABLE_FILL_FORCE_DISABLE_VERSION_ACU;
          saveSettings_ACU();
          logDebug_ACU(`[严格 JSON 填表] 已一次性关闭并记录版本: ${STRICT_JSON_TABLE_FILL_FORCE_DISABLE_VERSION_ACU}`);
      } catch (error) {
          logWarn_ACU('[严格 JSON 填表] 一次性关闭失败:', error);
      }
  }

/**
 * [spv8.9.2] 一次性强制恢复全部填表提示词为当前版本默认值。
 * marker 写入后不再执行，用户后续仍可正常自定义。
 */
function forceDefaultTableFillPromptsOnce_ACU() {
      try {
          if (!settings_ACU || typeof settings_ACU !== 'object') return;
          if (settings_ACU.tableFillPromptForceDefaultVersion === TABLE_FILL_PROMPT_FORCE_DEFAULT_VERSION_ACU) return;

          settings_ACU.charCardPrompt = cloneDefaultValue_ACU(
              settings_ACU.storageMode === 'sqlite' ? DEFAULT_CHAR_CARD_PROMPT_SQL_ACU : DEFAULT_CHAR_CARD_PROMPT_ACU,
          );
          settings_ACU.strictJsonCharCardPrompt = cloneDefaultValue_ACU(DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU);
          settings_ACU.strictJsonSqlCharCardPrompt = cloneDefaultValue_ACU(DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU);
          settings_ACU.tableFillPromptForceDefaultVersion = TABLE_FILL_PROMPT_FORCE_DEFAULT_VERSION_ACU;
          saveSettings_ACU();
          logDebug_ACU(`[填表提示词] 已一次性强制恢复默认提示词并记录版本: ${TABLE_FILL_PROMPT_FORCE_DEFAULT_VERSION_ACU}`);
      } catch (error) {
          logWarn_ACU('[填表提示词] 一次性强制恢复默认提示词失败:', error);
      }
  }

/**
 * 一次性清除历史 AI 改表助手的自定义提示词，恢复内置伪 role 默认提示词。
 * marker 按 profile 持久化；写入后不再执行，用户随后保存的自定义提示词必须保留。
 */
function forceDefaultTemplateAssistantPromptOnce_ACU() {
      try {
          if (!settings_ACU || typeof settings_ACU !== 'object') return;
          if (settings_ACU.templateAssistantPromptForceDefaultVersion === TEMPLATE_ASSISTANT_PROMPT_FORCE_DEFAULT_VERSION_ACU) return;

          // 空数组是既有运行时契约：buildTemplateAssistantMessages_ACU 回退到内置默认提示词。
          settings_ACU.templateAssistantPromptSegments = [];
          settings_ACU.templateAssistantPromptForceDefaultVersion = TEMPLATE_ASSISTANT_PROMPT_FORCE_DEFAULT_VERSION_ACU;
          saveSettings_ACU();
          logDebug_ACU(`[AI 改表助手] 已一次性恢复内置默认提示词并记录版本: ${TEMPLATE_ASSISTANT_PROMPT_FORCE_DEFAULT_VERSION_ACU}`);
      } catch (error) {
          logWarn_ACU('[AI 改表助手] 一次性恢复默认提示词失败:', error);
      }
  }


export   function buildDefaultSettings_ACU() {
      return {
          apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1.0, promptPostProcessing: 'strict' },
          apiMode: 'custom',
          tavernProfile: '',
          streamingEnabled: false, // [新增] 流式传输开关（默认关闭）
          apiPresets: [] as any[],
          defaultApiPresetName: '',
          apiPresetBindingsByChat: {},
          tableApiPreset: '',
          plotApiPreset: '',
          strictJsonTableFillEnabled: false,
          discardUnauthorizedTableEditsEnabled: true,
          // [剧情推进] 按剧情任务ID保存的任务级 API 预设覆盖（key=taskId, value=presetName）
          // 不保存入聊天记录或剧情推进预设，只写进插件全局设置。
          plotTaskApiPresetOverridesById: {} as Record<string, string>,
          // [新增] 按表格名称保存的表级 API 预设覆盖（key=标准化表名, value=presetName）
          // 不保存入模板，只写进数据库插件设置；同名表跨模板复用
          tableApiPresetOverridesByName: {} as Record<string, string>,
          charCardPrompt: DEFAULT_CHAR_CARD_PROMPT_ACU,
          strictJsonCharCardPrompt: DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
          strictJsonSqlCharCardPrompt: DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
          // [AI 改表助手] 可编辑提示词卡片段（空数组 = 使用默认硬编码提示词）
          templateAssistantPromptSegments: [] as any[],
          autoUpdateThreshold: DEFAULT_AUTO_UPDATE_THRESHOLD_ACU,
          autoUpdateFrequency: DEFAULT_AUTO_UPDATE_FREQUENCY_ACU,
          autoUpdateTokenThreshold: DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU,
          updateBatchSize: 3,
          maxConcurrentGroups: 1,
          autoUpdateEnabled: true,
          standardizedTableFillEnabled: true, // [新增] 规范填表功能
          toastMuteEnabled: false,
          // [剧情推进] 设置
          plotSettings: JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU)),
          plotPresetBindings: {}, // [剧情推进] 按聊天记录绑定剧情推进预设
          currentTemplatePresetName: '', // [模板预设] 当前模板预设名，空表示默认预设
          tableTemplateDefaultsRefreshVersion: '', // [模板预设] 默认表格模板一次性刷新版本
          tableFillPromptForceDefaultVersion: '', // [填表提示词] 一次性强制恢复默认提示词版本
          templateAssistantPromptForceDefaultVersion: '', // [AI 改表助手] 一次性强制恢复默认提示词版本
          strictJsonTableFillForceDisableVersion: '', // [填表功能] 一次性关闭严格 JSON 填表版本
          // [填表功能] 正文标签提取，从上下文中提取指定标签的内容发送给AI，User回复不受影响
          tableContextExtractTags: '',
          tableContextExtractRules: [] as any[],
          // [填表功能] 正文标签排除：将指定标签内容从上下文中移除
          tableContextExcludeTags: '',
          tableContextExcludeRules: [] as any[],
          // [填表功能] 仅识别最后一对 <tableEdit> 标签
          tableEditLastPairOnly: true,
          removeTags: '',
          importSplitSize: 10000,
          importPromptExcludeImportedWorldbookEntries: true, // [新增] 仅外部导入时，填表提示词中的世界书占位符屏蔽所有带"外部导入-"标签的条目
          skipUpdateFloors: 0, // 跳过更新楼层（全局）
          retainRecentLayers: 100, // [新增] 保留最近N层本地数据 (0或空=全部保留)
          manualSelectedTables: [] as any[],
          // [新增] 表格更新锁定（按聊天+隔离标签存储；仅对 updateRow 生效）
          tableUpdateLocks: {},
          // [新增] 总结表/总体大纲"编码索引列"特殊锁定（默认锁定）
          specialIndexLocks: {},
          // [新增] 0TK占用模式全局默认值：新对话会继承这个值
          zeroTkOccupyModeDefault: false,
          // [新增] 向量混合增强交火方案全局默认值：新对话会继承这个值
          summaryVectorIndexModeDefault: false,
          // [Profile] dataIsolationEnabled/code 由当前 profile 决定；history 走 globalMeta
          dataIsolationCode: '',
          dataIsolationHistory: [] as any[], // legacy 字段保留但不再持久化
          characterSettings: {}, // Start with an empty object
          knownCustomEntryNames: [] as any[], // [新增] 记录已创建的自定义条目名称，用于清理
          mergeSummaryPrompt: DEFAULT_MERGE_SUMMARY_PROMPT_ACU, // [新增] 合并总结提示词
          mergeTargetCount: 1, // [新增] 合并目标条数
          mergeBatchSize: 5, // [新增] 合并批次大小
          mergeStartIndex: 1, // [新增] 合并起始条数
          mergeEndIndex: null as number | null, // [新增] 合并终止条数
          autoMergeEnabled: false, // [新增] 是否开启自动合并总结
          autoMergeThreshold: 20, // [新增] 自动合并总结楼层数
          autoMergeReserve: 0, // [新增] 保留固定楼层数
          deleteStartFloor: null as number | null, // [新增] 删除起始楼层 (null表示从头开始)
          deleteEndFloor: null as number | null, // [新增] 删除终止楼层 (null表示到末尾)
          // [新增] 酒馆提示词模板功能
          promptTemplateSettings: {
            enabled: true,           // 总开关
            maxNestingDepth: 10,     // 最大嵌套深度
            debugMode: false         // 调试模式
          },
          // [新增] 存储模式（默认原生模式，用户可切换到 SQLite）
          storageMode: 'native' as const,
          // [新增] 正文优化功能
          contentOptimizationSettings: {
            enabled: false,                    // 是否启用正文优化
            apiPreset: '',                     // 优化使用的API预设（为空则使用当前配置）
            seamlessMode: true,                // 无感替换模式：显示遮罩，优化完成后直接显示结果
            autoApply: true,                   // 是否自动应用优化结果（关闭时显示对比让用户选择）
            showDiff: true,                    // 是否显示优化对比（非无感模式下有效）
            parallelMode: false,               // 填表与正文替换并行执行（默认关闭）
            minLength: 100,                    // 最小优化长度阈值
            maxOptimizations: 10,              // 单次最大优化项数
            loopCount: 1,                      // 循环优化次数
            retryCount: 3,                     // 自动重试次数（API调用失败时自动重试，默认3次）
            extractTags: '',                   // 正文标签提取（从正文中提取指定标签内容进行优化）
            extractRules: [] as any[],                  // 正文标签提取规则（结构化）
            excludeTags: '',                   // 标签排除（优化时排除指定标签内容）
            excludeRules: [] as any[],                  // 标签排除规则（结构化）
            promptGroup: buildDefaultContentOptimizationPromptGroup_ACU(), // 提示词组（段落编辑器）
            promptPresets: [] as any[],                 // 提示词组预设列表
          },
          // [向量记忆] 全局配置，跟随数据库设置而非角色/对话
          vectorMemoryConfig: null as any,
      };
  }


export   function applyTemplateScopeForCurrentChat_ACU({ isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const migratedScopeState = migrateLegacyTemplateScopeForCurrentChat_ACU({ isolationKey: normalizedKey });
      const scopeState = getCurrentChatTemplateScopeState_ACU({ isolationKey: normalizedKey }) || migratedScopeState;
      const selectedPresetName = normalizeTemplatePresetSelectionValue_ACU(scopeState?.presetName || '');
      let targetSnapshot = null;

      if (scopeState?.mode === 'chat_override' && scopeState?.templateStr) {
          targetSnapshot = sanitizeTemplateSnapshotForChat_ACU(scopeState.templateStr);
      } else if (scopeState?.mode === 'preset_link') {
          if (selectedPresetName) {
              targetSnapshot = sanitizeTemplateSnapshotForChat_ACU(getTemplatePreset_ACU(selectedPresetName)?.templateStr || null);
          } else {
              targetSnapshot = getDefaultTemplateSnapshot_ACU();
          }
      }

      if (!targetSnapshot?.templateStr) {
          targetSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
      }
      if (!targetSnapshot?.templateStr) return null;

      _set_TABLE_TEMPLATE_ACU(targetSnapshot.templateStr);
      if (scopeState?.mode === 'chat_override' && scopeState?.templateStr) {
          logDebug_ACU(`[TemplateScope] Applied chat template override for key [${normalizedKey || '默认'}].`);
          return {
              mode: 'chat_override',
              isolationKey: normalizedKey,
              presetName: scopeState.presetName || '',
          };
      }
      if (scopeState?.mode === 'preset_link') {
          logDebug_ACU(`[TemplateScope] Applied legacy preset_link fallback for key [${normalizedKey || '默认'}]: ${selectedPresetName || '默认预设'}.`);
          return {
              mode: 'chat_override',
              isolationKey: normalizedKey,
              presetName: selectedPresetName,
          };
      }

      logDebug_ACU(`[TemplateScope] Applied global template for key [${normalizedKey || '默认'}].`);
      return {
          mode: 'inherit_global',
          isolationKey: normalizedKey,
          presetName: getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false }),
      };
  }

// [从 data/repositories/isolation-repo.ts 移入] 切换隔离 Profile（业务编排，不属于 data 层）
export async function switchIsolationProfile_ACU(newCodeRaw: string): Promise<void> {
    const newCode = normalizeIsolationCode_ACU(newCodeRaw);
    const oldCode = normalizeIsolationCode_ACU(settings_ACU?.dataIsolationCode || '');

    persistSettingsToStorage_ACU(settings_ACU, oldCode);

    loadGlobalMeta_ACU();
    if (oldCode) addDataIsolationHistory_ACU(oldCode, { save: false });
    if (newCode) addDataIsolationHistory_ACU(newCode, { save: false });
    globalMeta_ACU.activeIsolationCode = newCode;
    normalizeDataIsolationHistory_ACU(globalMeta_ACU.isolationCodeList);
    saveGlobalMeta_ACU();

    ensureProfileExists_ACU(newCode, { seedFromCurrent: true, settings: settings_ACU });

    loadSettings_ACU();
    applyTemplateScopeForCurrentChat_ACU({ isolationKey: newCode });
}

// [从 data/repositories/template-preset-repo.ts 移入] 修改当前模板预设名 + 可选持久化
export function persistCurrentTemplatePresetName_ACU(settingsObj: any, presetName: any, { save = true } = {}): string {
    if (!settingsObj || typeof settingsObj !== 'object') return '';
    const normalizedPresetName = normalizeTemplatePresetSelectionValue_ACU(presetName);
    settingsObj.currentTemplatePresetName = normalizedPresetName;
    if (save) {
        const code = normalizeIsolationCode_ACU(settingsObj?.dataIsolationCode || globalMeta_ACU?.activeIsolationCode || '');
        persistSettingsToStorage_ACU(settingsObj, code);
    }
    return normalizedPresetName;
}

// getCurrentCharSettings_ACU 和 getCurrentWorldbookConfig_ACU 已移至 settings-readers.ts
export function setGlobalPlotEnabled_ACU(modeEnabled: boolean): boolean {
    const enabled = !!modeEnabled;
    if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object' || Array.isArray(settings_ACU.plotSettings)) {
        settings_ACU.plotSettings = JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU));
    }

    settings_ACU.plotSettings.enabled = enabled;
    globalMeta_ACU.plotEnabledGlobal = enabled;
    saveGlobalMeta_ACU();
    return enabled;
}

// [从 popup-bindings.ts / api-registry.ts 提取] 切换 0TK 占用模式的完整业务流程
export function setZeroTkOccupyMode_ACU(modeEnabled: boolean) {
    const enabled = !!modeEnabled;
    settings_ACU.zeroTkOccupyModeDefault = enabled;
    globalMeta_ACU.zeroTkOccupyModeGlobal = enabled;

    // 0TK 只控制大纲注入条目本身，不再强制关闭交火模式。
    const cfg = getCurrentWorldbookConfig_ACU();
    cfg.zeroTkOccupyMode = enabled;
    cfg.outlineEntryEnabled = !enabled;
    saveGlobalMeta_ACU();
    saveSettings_ACU();
}

export function setSummaryVectorIndexMode_ACU(modeEnabled: boolean) {
    const enabled = !!modeEnabled;
    settings_ACU.summaryVectorIndexModeDefault = enabled;
    globalMeta_ACU.summaryVectorIndexModeGlobal = enabled;

    // 向量混合增强交火方案会复用普通向量模型/API/rerank 配置；启停交火时必须同步启停普通向量开关。
    // 这里只改 enabled，不覆盖模型、API、rerank、namespace 等用户配置。
    const vectorMemoryConfig = getCurrentVectorMemoryConfig_ACU();
    vectorMemoryConfig.enabled = enabled;

    // 交火模式只控制纪要索引条目本身，不再强制关闭 0TK。
    const cfg = getCurrentWorldbookConfig_ACU();
    cfg.summaryVectorIndexModeEnabled = enabled;
    cfg.outlineEntryEnabled = !cfg.zeroTkOccupyMode;
    saveGlobalMeta_ACU();
    saveSettings_ACU();
}

// ============================================================
// 合并配置导入
// ============================================================

/**
 * 导入合并配置中的 settings 字段
 * 纯业务逻辑：将 combinedData 中的各字段赋值到 settings 对象
 * 不涉及 UI（toast、DOM 更新由 presentation 层负责）
 * 事务语义：先快照，保存失败回滚全部字段后抛出错误，避免导入污染 settings。
 * 
 * @returns 被修改的字段名列表（供 presentation 层更新对应的 UI 元素）
 */
function normalizeAssistantPromptRoleForImport_ACU(raw: unknown): string {
    const role = String(raw || 'SYSTEM').trim();
    if (role === 'assistant') return 'assistant';
    if (role.toUpperCase() === 'SYSTEM') return 'SYSTEM';
    if (role.toUpperCase() === 'USER') return 'USER';
    if (role.toUpperCase() === 'ASSISTANT') return 'assistant';
    return 'SYSTEM';
}

/**
 * 归一化 AI 改表助手提示词段（与 template-assistant service 的 normalize 语义保持一致）
 * 避免导入的脏数据直接进 settings；空内容段会被过滤。
 */
function normalizeAssistantPromptSegmentsForImport_ACU(input: unknown): Array<{ role: string; content: string; deletable: boolean; pinned: boolean }> {
    if (!Array.isArray(input)) return [];
    return input
        .map((item: any) => ({
            role: normalizeAssistantPromptRoleForImport_ACU(item?.role),
            content: String(item?.content ?? ''),
            deletable: item?.deletable !== false,
            pinned: item?.pinned === true,
        }))
        .filter((seg) => !!seg.content.trim());
}

export function applyCombinedSettingsImport_ACU(combinedData: any): string[] {
    const modifiedFields: string[] = [];
    const FIELDS = [
        'charCardPrompt',
        'mergeSummaryPrompt',
        'templateAssistantPromptSegments',
        'mergeTargetCount',
        'mergeBatchSize',
        'mergeStartIndex',
        'mergeEndIndex',
        'autoMergeEnabled',
        'autoMergeThreshold',
        'autoMergeReserve',
        'deleteStartFloor',
        'deleteEndFloor',
    ];
    const snapshot: Record<string, unknown> = {};
    for (const field of FIELDS) {
        const value = (settings_ACU as Record<string, unknown>)[field];
        snapshot[field] = value && typeof value === 'object'
            ? JSON.parse(JSON.stringify(value))
            : value;
    }

    // 导入提示词
    if (Array.isArray(combinedData.prompt)) {
        settings_ACU.charCardPrompt = combinedData.prompt;
        modifiedFields.push('charCardPrompt');
    }

    // 导入合并提示词
    if (combinedData.mergeSummaryPrompt) {
        settings_ACU.mergeSummaryPrompt = combinedData.mergeSummaryPrompt;
        modifiedFields.push('mergeSummaryPrompt');
    }

    // 导入 AI 改表助手提示词段（须归一化后再入库，避免脏数据进 settings）
    if (Array.isArray(combinedData.templateAssistantPromptSegments)) {
        settings_ACU.templateAssistantPromptSegments =
            normalizeAssistantPromptSegmentsForImport_ACU(combinedData.templateAssistantPromptSegments);
        modifiedFields.push('templateAssistantPromptSegments');
    }

    // 导入合并设置
    if (typeof combinedData.mergeSummaryPrompt !== 'undefined' ||
        typeof combinedData.autoMergeEnabled !== 'undefined') {

        // 手动合并设置
        settings_ACU.mergeTargetCount = combinedData.mergeTargetCount || 1;
        settings_ACU.mergeBatchSize = combinedData.mergeBatchSize || 5;
        settings_ACU.mergeStartIndex = combinedData.mergeStartIndex || 1;
        settings_ACU.mergeEndIndex = combinedData.mergeEndIndex || null;
        modifiedFields.push('mergeTargetCount', 'mergeBatchSize', 'mergeStartIndex', 'mergeEndIndex');

        // 自动合并设置
        settings_ACU.autoMergeEnabled = combinedData.autoMergeEnabled || false;
        settings_ACU.autoMergeThreshold = combinedData.autoMergeThreshold || 20;
        settings_ACU.autoMergeReserve = combinedData.autoMergeReserve || 0;
        modifiedFields.push('autoMergeEnabled', 'autoMergeThreshold', 'autoMergeReserve');

        // 删除楼层范围设置
        settings_ACU.deleteStartFloor = combinedData.deleteStartFloor || null;
        settings_ACU.deleteEndFloor = combinedData.deleteEndFloor || null;
        modifiedFields.push('deleteStartFloor', 'deleteEndFloor');
    }

    let saveResult;
    try {
        saveResult = saveSettings_ACU();
    } catch (error) {
        // 保存过程抛异常同样视为失败：回滚后抛出
        for (const field of FIELDS) {
            (settings_ACU as Record<string, unknown>)[field] = snapshot[field];
        }
        logError_ACU('[合并配置导入] 保存异常，已回滚全部导入字段。', error);
        throw new Error('合并配置保存失败，已回滚。');
    }
    if (!saveResult.saved) {
        // 回滚全部已修改字段，避免导入失败污染 settings
        for (const field of FIELDS) {
            (settings_ACU as Record<string, unknown>)[field] = snapshot[field];
        }
        logError_ACU('[合并配置导入] 保存失败，已回滚全部导入字段。', saveResult.error || saveResult.warning || '');
        throw new Error(saveResult.warning || saveResult.error || '合并配置保存失败，已回滚。');
    }
    return modifiedFields;
}

// re-export data 层基础设施（供 presentation 层通过 service 层访问，避免 presentation→data 直接依赖）
export { getConfigStorage_ACU, persistTavernSettings_ACU } from '../../data/storage/tavern-storage';
export { saveCurrentProfileTemplate_ACU } from '../../data/repositories/profile-repo';
export { getDataIsolationHistory_ACU, removeDataIsolationHistory_ACU } from '../../data/repositories/isolation-repo';
