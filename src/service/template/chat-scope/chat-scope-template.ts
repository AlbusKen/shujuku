/**
 * service/template/chat-scope/chat-scope-template.ts
 * Template Scope 管理 + Global Template（B+C 组）
 */
import { DEFAULT_TABLE_TEMPLATE_ACU, TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU} from '../../../shared/defaults-json.js';
import { readProfileTemplateFromStorage_ACU, saveCurrentProfileTemplate_ACU } from '../../../data/repositories/profile-repo';
import { DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU, deriveTemplatePresetNameForImport_ACU, getCurrentTemplatePresetName_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../../shared/template-preset-utils';
import { CHAT_SCOPED_CONFIG_FIELD_ACU, CHAT_SHEET_GUIDE_FIELD_ACU, CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU, CHAT_SHEET_GUIDE_VERSION_ACU, CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU, LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU, MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU, getChatScopedConfigContainer_ACU, peekChatScopedConfigContainer_ACU, getChatSheetGuideContainer_ACU, normalizeChatScopedConfigContainer_ACU, setChatScopedConfigContainer_ACU } from '../../../data/storage/chat-history';
import { getDefaultTemplateSnapshot_ACU, getTemplatePreset_ACU } from '../template-preset-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../../runtime/state-manager';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../../data/gateways/chat-gateway';
import { TABLE_ORDER_FIELD_ACU } from '../../../shared/constants';
import { applyTemplateScopeForCurrentChat_ACU } from '../../settings/settings-service';
import { refreshMergedDataAndNotify_ACU } from '../../worldbook/pipeline';
import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../../shared/json-helpers';
import { applySheetOrderNumbers_ACU, cloneScopedConfigData_ACU, ensureSheetOrderNumbers_ACU, getChatFirstLayerMessage_ACU, hashUserInput_ACU, isSummaryOrOutlineTable_ACU, logDebug_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../../shared/utils';

import { getTemplatePresetDisplayName_ACU, persistTemplateScopeSelectionState_ACU, upsertTemplatePreset_ACU } from '../template-preset-service';
import { formatPlotScopeUpdatedAt_ACU } from '../../../shared/utils';
import { ensureExportConfigDefaults_ACU, ensureGlobalInjectionConfigDefaults_ACU } from '../../worldbook/injection-engine';
import { readIsolatedTagData_ACU, readLegacyIndependentData_ACU, readLegacyStandardData_ACU, readLegacySummaryData_ACU, isLegacyMatchForIsolation_ACU } from '../../../data/repositories/chat-message-data-repo';
import { normalizeChatScopedConfigSource_ACU, normalizeGuideData_ACU, parseReadableSheetSource_ACU } from './chat-scope-base';
// 循环 import — 运行时安全（无模块级立即执行代码）
import { migrateLegacyTemplateScopeForCurrentChat_ACU, clearChatSheetGuideDataForIsolationKey_ACU, getChatSheetGuideDataForIsolationKey_ACU, buildChatSheetGuideDataFromTemplateObj_ACU, setChatSheetGuideDataForIsolationKey_ACU } from './chat-scope-guide';
import { sanitizeChatSheetsObject_ACU } from './chat-scope-sheet';
import { normalizeIsolationCode_ACU } from '../../../shared/data-constants';

  export function normalizeTemplateScopeMode_ACU(mode: string) {
      if (mode === 'chat_override') return 'chat_override';
      if (mode === 'preset_link') return 'preset_link';
      return 'inherit_global';
  }

  export function normalizeTemplateScopeIsolationKey_ACU(isolationKey = getCurrentIsolationKey_ACU()) {
      return String(isolationKey ?? '');
  }

  export function sanitizeTemplateSnapshotForChat_ACU(templateSource: any) {
      let templateObj = null;
      if (typeof templateSource === 'string') {
          templateObj = safeJsonParse_ACU(templateSource, null);
      } else if (templateSource && typeof templateSource === 'object' && !Array.isArray(templateSource)) {
          templateObj = cloneScopedConfigData_ACU(templateSource, null);
      }

      if (!templateObj || typeof templateObj !== 'object' || Array.isArray(templateObj)) return null;

      try {
          const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
          ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: sheetKeys, forceRebuild: false });
      } catch (e) { logWarn_ACU('[模板作用域] sanitizeTemplateSnapshot: 排序号处理失败:', e); }

      const sanitized = sanitizeChatSheetsObject_ACU(templateObj, { ensureMate: true });
      const templateStr = safeJsonStringify_ACU(sanitized, '');
      if (!templateStr) return null;

      return {
          templateStr,
          templateObj: safeJsonParse_ACU(templateStr, null),
      };
  }

  export function normalizeChatTemplateScopeState_ACU(rawState: any, { isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const state = (rawState && typeof rawState === 'object' && !Array.isArray(rawState)) ? rawState : {};
      const templateSnapshot = sanitizeTemplateSnapshotForChat_ACU(state.templateStr || state.templateObj || state.template || null);
      const guideData = normalizeGuideData_ACU(state.guideData);
      return {
          mode: normalizeTemplateScopeMode_ACU(state.mode),
          isolationKey: normalizeTemplateScopeIsolationKey_ACU(state.isolationKey ?? isolationKey),
          presetName: normalizeTemplatePresetSelectionValue_ACU(state.presetName || ''),
          templateStr: templateSnapshot?.templateStr || '',
          guideData,
          originGlobalName: normalizeTemplatePresetSelectionValue_ACU(state.originGlobalName || ''),
          originGlobalRevision: Number.isFinite(state.originGlobalRevision) ? Math.max(0, Math.trunc(state.originGlobalRevision)) : 0,
          updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
          source: normalizeChatScopedConfigSource_ACU(state.source, 'inherit'),
      };
  }

  function buildChatTemplatePresetSlotKey_ACU(presetName: string) {
      return normalizeTemplatePresetSelectionValue_ACU(presetName) || DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU;
  }

  export function listChatTemplatePresetEntries_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const entryMap = new Map();
      getChatTemplateArchiveEntries_ACU({ chat, isolationKey: normalizedKey }).forEach((entry: any) => {
          const slotKey = buildChatTemplatePresetSlotKey_ACU(entry?.presetName || '');
          const previousEntry = entryMap.get(slotKey);
          const currentTs = Number(entry?.updatedAt) || Number(entry?.archivedAt) || 0;
          const previousTs = Number(previousEntry?.updatedAt) || Number(previousEntry?.archivedAt) || 0;
          if (!previousEntry || currentTs >= previousTs) {
              entryMap.set(slotKey, entry);
          }
      });
      return Array.from(entryMap.values()).sort((a: any, b: any) => {
          const ta = Number(a?.updatedAt) || Number(a?.archivedAt) || 0;
          const tb = Number(b?.updatedAt) || Number(b?.archivedAt) || 0;
          return tb - ta;
      });
  }

  function findChatTemplatePresetEntry_ACU(presetName: string, { chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const slotKey = buildChatTemplatePresetSlotKey_ACU(presetName);
      return listChatTemplatePresetEntries_ACU({ chat, isolationKey }).find(entry => buildChatTemplatePresetSlotKey_ACU(entry?.presetName || '') === slotKey) || null;
  }

  function archiveTemplateStateIntoContainer_ACU(
      container: Record<string, any>,
      templateState: Record<string, any> | null | undefined,
      { isolationKey = getCurrentIsolationKey_ACU(), nextTemplateState = null as Record<string, any> | null, reason = '' } = {},
  ) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const normalizedState = normalizeChatTemplateScopeState_ACU(templateState, { isolationKey: normalizedKey });
      if (normalizedState.mode !== 'chat_override' || !normalizedState.templateStr) return false;

      const archiveKey = buildChatTemplateArchiveFingerprint_ACU(normalizedState, { isolationKey: normalizedKey });
      if (!archiveKey) return false;

      const normalizedNextState = nextTemplateState
          ? normalizeChatTemplateScopeState_ACU(nextTemplateState, { isolationKey: normalizedKey })
          : null;
      const nextArchiveKey = normalizedNextState?.mode === 'chat_override' && normalizedNextState.templateStr
          ? buildChatTemplateArchiveFingerprint_ACU(normalizedNextState, { isolationKey: normalizedKey })
          : '';
      if (nextArchiveKey && archiveKey === nextArchiveKey) return false;

      const archivedAt = Date.now();
      const rawEntries = container.templateArchives && typeof container.templateArchives === 'object' && !Array.isArray(container.templateArchives)
          ? (container.templateArchives as Record<string, any>)[normalizedKey]
          : [];
      const previousEntries = Array.isArray(rawEntries) ? rawEntries : [];
      const nextEntries = [
          {
              ...normalizedState,
              archiveKey,
              archivedAt,
              updatedAt: normalizedState.updatedAt || archivedAt,
              source: normalizedState.source || normalizeChatScopedConfigSource_ACU(reason, 'inherit'),
          },
          ...previousEntries
              .map((entry: any) => normalizeChatTemplateArchiveEntry_ACU(entry, { isolationKey: normalizedKey }))
              .filter(Boolean)
              .filter((entry: any) => entry.archiveKey !== archiveKey),
      ].slice(0, MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU);

      if (!container.templateArchives || typeof container.templateArchives !== 'object' || Array.isArray(container.templateArchives)) {
          container.templateArchives = {} as Record<string, any>;
      }
      (container.templateArchives as Record<string, any>)[normalizedKey] = nextEntries;
      return true;
  }

  export function upsertChatTemplatePresetEntry_ACU(templateState: Record<string, any>, { chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const normalizedState = normalizeChatTemplateScopeState_ACU(templateState, { isolationKey: normalizedKey });
      if (normalizedState.mode !== 'chat_override' || !normalizedState.templateStr) return null;

      const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
      archiveTemplateStateIntoContainer_ACU(container, normalizedState, { isolationKey: normalizedKey });
      setChatScopedConfigContainer_ACU(chat, container);
      return findChatTemplatePresetEntry_ACU(normalizedState.presetName || '', { chat, isolationKey: normalizedKey });
  }

  function ensureCurrentChatTemplatePresetEntry_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const currentState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey: normalizedKey }) || migrateLegacyTemplateScopeForCurrentChat_ACU({ chat, isolationKey: normalizedKey });
      const normalizedState = normalizeChatTemplateScopeState_ACU(currentState, { isolationKey: normalizedKey });
      if (normalizedState.mode !== 'chat_override' || !normalizedState.templateStr) return null;

      const existingEntry = findChatTemplatePresetEntry_ACU(normalizedState.presetName || '', { chat, isolationKey: normalizedKey });
      const currentFingerprint = buildChatTemplateArchiveFingerprint_ACU(normalizedState, { isolationKey: normalizedKey });
      const existingFingerprint = existingEntry ? buildChatTemplateArchiveFingerprint_ACU(existingEntry, { isolationKey: normalizedKey }) : '';
      if (existingEntry && currentFingerprint && existingFingerprint === currentFingerprint) {
          return existingEntry;
      }
      return upsertChatTemplatePresetEntry_ACU(normalizedState, { chat, isolationKey: normalizedKey });
  }

  export function buildChatTemplatePresetLinkState_ACU({ isolationKey = getCurrentIsolationKey_ACU(), presetName = '', source = 'ui', originGlobalName = '', originGlobalRevision = 0, updatedAt = Date.now() } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      return normalizeChatTemplateScopeState_ACU({
          mode: 'preset_link',
          isolationKey: normalizedKey,
          presetName,
          originGlobalName,
          originGlobalRevision,
          updatedAt,
          source,
      }, { isolationKey: normalizedKey });
  }

  export async function activateChatTemplatePresetSelection_ACU(presetName: string, { source = 'ui_chat_select', save = true } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(getCurrentIsolationKey_ACU());
      const normalizedPresetName = normalizeTemplatePresetSelectionValue_ACU(presetName);
      const localEntry = findChatTemplatePresetEntry_ACU(normalizedPresetName, { isolationKey: normalizedKey });
      const hasGlobalPreset = !normalizedPresetName || !!getTemplatePreset_ACU(normalizedPresetName)?.templateStr;

      let appliedFromLocalSnapshot = false;
      if (localEntry?.templateStr) {
          persistTemplateScopeSelectionState_ACU(normalizedPresetName, {
              source,
              updateGlobal: false,
              save: false,
              persistChatScope: true,
              templateSource: localEntry.templateStr,
              guideData: localEntry.guideData,
              scopeMode: 'chat_override',
              registerChatPresetEntry: false,
          });
          if (localEntry.guideData) {
              setChatSheetGuideDataForIsolationKey_ACU(normalizedKey, localEntry.guideData, {
                  reason: `template_scope_${source}`,
                  syncTemplateScope: false,
              });
          }
          appliedFromLocalSnapshot = true;
      } else {
          if (!hasGlobalPreset) return false;
          const snapshot = !normalizedPresetName
              ? getDefaultTemplateSnapshot_ACU()
              : sanitizeTemplateSnapshotForChat_ACU(getTemplatePreset_ACU(normalizedPresetName)?.templateStr || null);
          if (!snapshot?.templateStr || !snapshot?.templateObj) return false;
          const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(snapshot.templateObj, { stripSeedRows: false });
          const templateState = buildChatTemplateScopeStateFromCurrent_ACU({
              isolationKey: normalizedKey,
              presetName: normalizedPresetName,
              source,
              originGlobalName: getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false }),
              originGlobalRevision: 0,
              updatedAt: Date.now(),
              templateSource: snapshot.templateStr,
              guideData,
          });
          if (!templateState) return false;
          setCurrentChatTemplateScopeState_ACU(templateState, {
              isolationKey: normalizedKey,
              reason: `template_scope_${source}`,
          });
          if (guideData) {
              setChatSheetGuideDataForIsolationKey_ACU(normalizedKey, guideData, {
                  reason: `template_scope_${source}`,
                  syncTemplateScope: false,
              });
          }
      }
      if (save) {
          try {
              await saveChatToHost_ACU();
          } catch (error) {
              logWarn_ACU('[TemplateScope] 保存聊天级模板预设快照失败:', error);
          }
      }

      applyTemplateScopeForCurrentChat_ACU({ isolationKey: normalizedKey });
      try { await refreshMergedDataAndNotify_ACU(); } catch (e) {}
      return {
          presetName: normalizedPresetName,
          mode: 'chat_override',
          fromLocalSnapshot: appliedFromLocalSnapshot,
      };
  }

  function buildChatTemplateArchiveFingerprint_ACU(templateState: Record<string, any>, { isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const normalizedState = normalizeChatTemplateScopeState_ACU(templateState, { isolationKey });
      if (normalizedState.mode !== 'chat_override' || !normalizedState.templateStr) return '';
      const raw = safeJsonStringify_ACU({
          presetName: normalizedState.presetName || '',
          templateStr: normalizedState.templateStr || '',
          guideData: normalizeGuideData_ACU(normalizedState.guideData),
      }, '');
      return raw ? hashUserInput_ACU(raw) : '';
  }

  function getChatTemplateArchiveBaseLabel_ACU(templateState: Record<string, any>, { fallback = '聊天模板快照' } = {}) {
      const normalizedState = normalizeChatTemplateScopeState_ACU(templateState);
      if (normalizedState.source === 'legacy_history_frozen') return '旧对话历史模板快照';
      if (normalizedState.source === 'legacy_header_frozen') return '旧版表头冻结模板';
      if (normalizedState.source === 'legacy_frozen') return '旧版聊天冻结模板';
      const presetName = normalizeTemplatePresetSelectionValue_ACU(normalizedState.presetName || '');
      return presetName ? getTemplatePresetDisplayName_ACU(presetName) : fallback;
  }

  function normalizeChatTemplateArchiveEntry_ACU(rawEntry: any, { isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const normalizedState = normalizeChatTemplateScopeState_ACU(rawEntry, { isolationKey });
      if (normalizedState.mode !== 'chat_override' || !normalizedState.templateStr) return null;
      const archiveKey = String(rawEntry?.archiveKey || buildChatTemplateArchiveFingerprint_ACU(normalizedState, { isolationKey: normalizedState.isolationKey }) || '').trim();
      if (!archiveKey) return null;
      return {
          archiveKey,
          isolationKey: normalizedState.isolationKey,
          presetName: normalizedState.presetName,
          templateStr: normalizedState.templateStr,
          guideData: normalizedState.guideData,
          originGlobalName: normalizedState.originGlobalName,
          originGlobalRevision: normalizedState.originGlobalRevision,
          updatedAt: normalizedState.updatedAt,
          archivedAt: Number.isFinite(rawEntry?.archivedAt) ? rawEntry.archivedAt : Date.now(),
          source: normalizedState.source,
          mode: 'chat_override',
      };
  }

  function getChatTemplateArchiveEntries_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const container = getChatScopedConfigContainer_ACU(chat);
      const rawSlots = container?.templateArchives;
      if (!rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) return [];
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const rawEntries = Array.isArray((rawSlots as Record<string, any>)[normalizedKey]) ? (rawSlots as Record<string, any>)[normalizedKey] : [];
      return rawEntries
          .map((entry: any) => normalizeChatTemplateArchiveEntry_ACU(entry, { isolationKey: normalizedKey }))
          .filter(Boolean)
          .sort((a: any, b: any) => (Number(b.archivedAt) || 0) - (Number(a.archivedAt) || 0));
  }

  function setChatTemplateArchiveEntries_ACU(entries: any[], { chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const first = getChatFirstLayerMessage_ACU(chat);
      if (!first) return [];
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
      const normalizedEntries = (Array.isArray(entries) ? entries : [])
          .map(entry => normalizeChatTemplateArchiveEntry_ACU(entry, { isolationKey: normalizedKey }))
          .filter(Boolean)
          .sort((a: any, b: any) => (Number(b.archivedAt) || 0) - (Number(a.archivedAt) || 0))
          .slice(0, MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU);

      if (normalizedEntries.length > 0) {
          if (!container.templateArchives || typeof container.templateArchives !== 'object' || Array.isArray(container.templateArchives)) {
              container.templateArchives = {} as Record<string, any>;
          }
          (container.templateArchives as Record<string, any>)[normalizedKey] = normalizedEntries;
      } else if (container.templateArchives && typeof container.templateArchives === 'object' && !Array.isArray(container.templateArchives)) {
          delete (container.templateArchives as Record<string, any>)[normalizedKey];
          if (Object.keys(container.templateArchives).length === 0) delete container.templateArchives;
      }

      const hasPayload = Object.keys(container).some(key => key !== 'version');
      setChatScopedConfigContainer_ACU(chat, hasPayload ? container : null);

      return getChatTemplateArchiveEntries_ACU({ chat, isolationKey: normalizedKey });
  }

  function archiveCurrentChatTemplateScopeState_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), nextTemplateState = null as any, reason = '' } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const currentState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey: normalizedKey }) || migrateLegacyTemplateScopeForCurrentChat_ACU({ chat, isolationKey: normalizedKey });
      const normalizedCurrentState = normalizeChatTemplateScopeState_ACU(currentState, { isolationKey: normalizedKey });
      if (normalizedCurrentState.mode !== 'chat_override' || !normalizedCurrentState.templateStr) return false;

      const currentArchiveKey = buildChatTemplateArchiveFingerprint_ACU(normalizedCurrentState, { isolationKey: normalizedKey });
      if (!currentArchiveKey) return false;

      const normalizedNextState = nextTemplateState
          ? normalizeChatTemplateScopeState_ACU(nextTemplateState, { isolationKey: normalizedKey })
          : null;
      const nextArchiveKey = normalizedNextState?.templateStr
          ? buildChatTemplateArchiveFingerprint_ACU(normalizedNextState, { isolationKey: normalizedKey })
          : '';
      if (nextArchiveKey && currentArchiveKey === nextArchiveKey) return false;

      const archivedAt = Date.now();
      const nextEntries = [
          {
              ...normalizedCurrentState,
              archiveKey: currentArchiveKey,
              archivedAt,
              updatedAt: normalizedCurrentState.updatedAt || archivedAt,
              source: normalizedCurrentState.source || normalizeChatScopedConfigSource_ACU(reason, 'inherit'),
          },
          ...getChatTemplateArchiveEntries_ACU({ chat, isolationKey: normalizedKey }).filter((entry: any) => entry.archiveKey !== currentArchiveKey),
      ];
      setChatTemplateArchiveEntries_ACU(nextEntries, { chat, isolationKey: normalizedKey });
      return true;
  }

  function buildChatTemplateArchiveOptionValue_ACU(archiveKey: string) {
      const normalizedKey = String(archiveKey || '').trim();
      return normalizedKey ? `${CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU}${normalizedKey}` : '';
  }

  function isChatTemplateArchiveOptionValue_ACU(value: any) {
      return typeof value === 'string' && value.startsWith(CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU);
  }

  function parseChatTemplateArchiveOptionValue_ACU(value: string) {
      return isChatTemplateArchiveOptionValue_ACU(value)
          ? String(value.slice(CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU.length)).trim()
          : '';
  }

  export function getChatTemplateArchiveOptionLabel_ACU(entry: Record<string, any>) {
      const normalizedEntry = normalizeChatTemplateArchiveEntry_ACU(entry);
      if (!normalizedEntry) return '聊天历史模板快照';
      const baseLabel = getChatTemplateArchiveBaseLabel_ACU(normalizedEntry);
      const archivedAtText = (typeof formatPlotScopeUpdatedAt_ACU === 'function') ? formatPlotScopeUpdatedAt_ACU(normalizedEntry.archivedAt || normalizedEntry.updatedAt) : '';
      return archivedAtText
          ? `${baseLabel}（聊天历史快照，${archivedAtText}）`
          : `${baseLabel}（聊天历史快照）`;
  }

  export function listChatTemplateArchiveEntries_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      return getChatTemplateArchiveEntries_ACU({ chat, isolationKey }).map((entry: any) => ({
          ...entry,
          optionValue: buildChatTemplateArchiveOptionValue_ACU(entry.archiveKey),
          label: getChatTemplateArchiveOptionLabel_ACU(entry),
      }));
  }


  export function getCurrentChatTemplateScopeState_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), readOnly = false } = {}): any | null {
      const container = readOnly ? peekChatScopedConfigContainer_ACU(chat, { strict: true }) : getChatScopedConfigContainer_ACU(chat);
      const rawSlots = container?.template;
      if (!rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) return null;

      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      let rawState = (rawSlots as Record<string, any>)[normalizedKey];
      if (readOnly && Object.prototype.hasOwnProperty.call(rawSlots, normalizedKey)) {
          if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)
              || rawState.mode !== undefined && !['inherit_global', 'chat_override', 'preset_link'].includes(rawState.mode)
              || rawState.isolationKey !== undefined && rawState.isolationKey !== normalizedKey) {
              throw new Error('只读模板作用域损坏或隔离身份不匹配，禁止回退全局模板。');
          }
          rawState = { ...rawState };
          if (rawState.mode === 'chat_override') {
              const source = rawState.templateStr ?? rawState.templateObj ?? rawState.template;
              rawState.templateObj = parseReadableSheetSource_ACU(source);
              rawState.templateStr = JSON.stringify(rawState.templateObj);
          }
          if (rawState.guideData != null) {
              rawState.guideData = parseReadableSheetSource_ACU(rawState.guideData);
          }
          if (rawState.mode === 'preset_link' && rawState.presetName !== undefined
              && typeof rawState.presetName !== 'string') {
              throw new Error('只读预设链接身份损坏，禁止使用默认预设。');
          }
      }
      if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null;

      const normalizedState = normalizeChatTemplateScopeState_ACU(rawState, { isolationKey: normalizedKey });
      if (normalizedState.mode === 'preset_link') {
          const migrated: any | null = materializePresetLinkScopeState_ACU(normalizedState, { isolationKey: normalizedKey, readOnly });
          return migrated || normalizedState;
      }
      if (normalizedState.mode !== 'chat_override' || !normalizedState.templateStr) {
          return null;
      }
      return normalizedState;
  }

  function resolveSnapshotForPresetName_ACU(presetName: string, { readOnly = false } = {}) {
      const normalizedPresetName = normalizeTemplatePresetSelectionValue_ACU(presetName || '');
      if (readOnly) {
          const source = normalizedPresetName
              ? getTemplatePreset_ACU(normalizedPresetName)?.templateStr
              : DEFAULT_TABLE_TEMPLATE_ACU;
          const templateObj = parseReadableSheetSource_ACU(source);
          return sanitizeTemplateSnapshotForChat_ACU(templateObj);
      }
      if (normalizedPresetName) {
          const presetSnapshot = sanitizeTemplateSnapshotForChat_ACU(getTemplatePreset_ACU(normalizedPresetName)?.templateStr || null);
          if (presetSnapshot?.templateStr && presetSnapshot?.templateObj) return presetSnapshot;
      }
      return getDefaultTemplateSnapshot_ACU();
  }

  function materializePresetLinkScopeState_ACU(scopeState: Record<string, any>, { isolationKey = getCurrentIsolationKey_ACU(), readOnly = false } = {}): any | null {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const normalizedState = normalizeChatTemplateScopeState_ACU(scopeState, { isolationKey: normalizedKey });
      if (normalizedState.mode !== 'preset_link') return null;
      const linkedPresetName = normalizeTemplatePresetSelectionValue_ACU(normalizedState.presetName || '');
      const snapshot = resolveSnapshotForPresetName_ACU(linkedPresetName, { readOnly });
      if (!snapshot?.templateStr || !snapshot?.templateObj) return null;
      const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(snapshot.templateObj, { stripSeedRows: false });
      const templateState = buildChatTemplateScopeStateFromCurrent_ACU({
          isolationKey: normalizedKey,
          presetName: linkedPresetName,
          source: normalizeChatScopedConfigSource_ACU(normalizedState.source, 'preset_link_migration'),
          originGlobalName: normalizeTemplatePresetSelectionValue_ACU(normalizedState.originGlobalName || linkedPresetName),
          originGlobalRevision: Number.isFinite(normalizedState.originGlobalRevision) ? normalizedState.originGlobalRevision : 0,
          updatedAt: Date.now(),
          templateSource: snapshot.templateStr,
          guideData,
      });
      if (!templateState) return null;
      if (readOnly) return templateState;
      return setCurrentChatTemplateScopeState_ACU(templateState, {
          isolationKey: normalizedKey,
          reason: 'materialize_preset_link',
      });
  }

  export function buildChatTemplateScopeStateFromCurrent_ACU(options: any = {}) {
      const {
          isolationKey = getCurrentIsolationKey_ACU(),
          presetName = '',
          source = 'ui',
          originGlobalName = '',
          originGlobalRevision = 0,
          updatedAt = Date.now(),
          templateSource = null,
          guideData = null,
      } = options || {};
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      if (!Object.prototype.hasOwnProperty.call(options || {}, 'templateSource')) {
          logWarn_ACU('[TemplateScope] buildChatTemplateScopeStateFromCurrent_ACU 缺少 templateSource，已拒绝隐式使用运行时模板。');
          return null;
      }
      const templateSnapshot = sanitizeTemplateSnapshotForChat_ACU(templateSource);
      if (!templateSnapshot?.templateStr) return null;

      const resolvedGuideData = normalizeGuideData_ACU(guideData || getChatSheetGuideDataForIsolationKey_ACU(normalizedKey));
      return normalizeChatTemplateScopeState_ACU({
          mode: 'chat_override',
          isolationKey: normalizedKey,
          presetName,
          templateStr: templateSnapshot.templateStr,
          guideData: resolvedGuideData,
          originGlobalName,
          originGlobalRevision,
          updatedAt,
          source,
      }, { isolationKey: normalizedKey });
  }

  export function setCurrentChatTemplateScopeState_ACU(templateState: Record<string, any>, { isolationKey = getCurrentIsolationKey_ACU(), reason = '' } = {}): any | null {
      const chat = getChatArray_ACU();
      const first = getChatFirstLayerMessage_ACU(chat);
      if (!first) return null;

      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
      let normalizedState = normalizeChatTemplateScopeState_ACU(templateState, { isolationKey: normalizedKey });
      if (normalizedState.mode === 'preset_link') {
          const linkedPresetName = normalizeTemplatePresetSelectionValue_ACU(normalizedState.presetName || '');
          const snapshot = resolveSnapshotForPresetName_ACU(linkedPresetName);
          const guideData = snapshot?.templateObj
              ? buildChatSheetGuideDataFromTemplateObj_ACU(snapshot.templateObj, { stripSeedRows: false })
              : null;
          const materializedState = snapshot?.templateStr
              ? buildChatTemplateScopeStateFromCurrent_ACU({
                  isolationKey: normalizedKey,
                  presetName: linkedPresetName,
                  source: normalizeChatScopedConfigSource_ACU(normalizedState.source, 'preset_link_materialized'),
                  originGlobalName: normalizeTemplatePresetSelectionValue_ACU(normalizedState.originGlobalName || linkedPresetName),
                  originGlobalRevision: Number.isFinite(normalizedState.originGlobalRevision) ? normalizedState.originGlobalRevision : 0,
                  updatedAt: normalizedState.updatedAt || Date.now(),
                  templateSource: snapshot.templateStr,
                  guideData,
              })
              : null;
          normalizedState = materializedState
              ? normalizeChatTemplateScopeState_ACU(materializedState, { isolationKey: normalizedKey })
              : normalizeChatTemplateScopeState_ACU({ mode: 'inherit_global' }, { isolationKey: normalizedKey });
      }
      const currentRawState = container.template && typeof container.template === 'object' && !Array.isArray(container.template)
          ? (container.template as Record<string, any>)[normalizedKey]
          : null;

      archiveTemplateStateIntoContainer_ACU(container, currentRawState, {
          isolationKey: normalizedKey,
          nextTemplateState: normalizedState,
          reason,
      });

      if (!container.template || typeof container.template !== 'object' || Array.isArray(container.template)) {
          container.template = {} as Record<string, any>;
      }

      if (normalizedState.mode === 'chat_override' && normalizedState.templateStr) {
          (container.template as Record<string, any>)[normalizedKey] = {
              ...normalizedState,
              reason: String(reason || ''),
          };
      } else {
          delete (container.template as Record<string, any>)[normalizedKey];
          if (Object.keys(container.template).length === 0) {
              delete container.template;
          }
      }

      const hasPayload = Object.keys(container).some(key => key !== 'version');
      setChatScopedConfigContainer_ACU(chat, hasPayload ? container : null);

      return getCurrentChatTemplateScopeState_ACU({ chat, isolationKey: normalizedKey });
  }

  function clearLegacyHeaderGuideForIsolationKey_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const first = getChatFirstLayerMessage_ACU(chat);
      if (!first) return false;

      const raw = first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU];
      if (!raw) return false;

      const legacyObj = typeof raw === 'string'
          ? safeJsonParse_ACU(raw, null)
          : cloneScopedConfigData_ACU(raw, null);
      if (!legacyObj || typeof legacyObj !== 'object' || Array.isArray(legacyObj)) return false;

      const tags = legacyObj.tags;
      if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return false;

      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      if (!Object.prototype.hasOwnProperty.call(tags, normalizedKey)) return false;

      delete tags[normalizedKey];
      if (Object.keys(tags).length === 0) {
          delete first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU];
          return true;
      }

      legacyObj.tags = tags;
      if (typeof raw === 'string') {
          const nextRaw = safeJsonStringify_ACU(legacyObj, '');
          if (nextRaw) {
              first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU] = nextRaw;
          } else {
              delete first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU];
          }
      } else {
          first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU] = legacyObj;
      }
      return true;
  }

  export async function clearCurrentChatTemplateSnapshots_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), clearCurrentOverride = true, clearArchives = true, clearGuide = true, clearLegacyGuide = true, save = true } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const first = getChatFirstLayerMessage_ACU(chat);
      const result = {
          isolationKey: normalizedKey,
          removedCurrentScope: false,
          removedArchives: 0,
          removedGuide: false,
          removedLegacyGuide: false,
          changed: false,
      };

      if (!first) return result;

      const hadScopedConfigField = !!getChatScopedConfigContainer_ACU(chat);
      const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
      let scopedConfigChanged = false;

      if (clearCurrentOverride) {
          if (container.template && typeof container.template === 'object' && !Array.isArray(container.template)) {
              const slots = container.template as Record<string, any>;
              if (Object.prototype.hasOwnProperty.call(slots, normalizedKey)) {
                  delete slots[normalizedKey];
                  result.removedCurrentScope = true;
                  result.changed = true;
                  scopedConfigChanged = true;
              }
              if (Object.keys(slots).length === 0) delete container.template;
          } else if (container.template !== undefined) {
              delete container.template;
              result.removedCurrentScope = true;
              result.changed = true;
              scopedConfigChanged = true;
          }
      }

      if (clearArchives) {
          if (container.templateArchives && typeof container.templateArchives === 'object' && !Array.isArray(container.templateArchives)) {
              const archiveSlots = container.templateArchives as Record<string, any>;
              if (Object.prototype.hasOwnProperty.call(archiveSlots, normalizedKey)) {
                  const rawEntries = archiveSlots[normalizedKey];
                  result.removedArchives = Array.isArray(rawEntries) ? rawEntries.length : 1;
                  delete archiveSlots[normalizedKey];
                  result.changed = true;
                  scopedConfigChanged = true;
              }
              if (Object.keys(archiveSlots).length === 0) delete container.templateArchives;
          } else if (container.templateArchives !== undefined) {
              delete container.templateArchives;
              result.removedArchives = 1;
              result.changed = true;
              scopedConfigChanged = true;
          }
      }

      const hasScopedPayload = Object.keys(container).some(key => key !== 'version');
      if (scopedConfigChanged && hasScopedPayload) {
          setChatScopedConfigContainer_ACU(chat, container);
      } else if (!hasScopedPayload && hadScopedConfigField) {
          setChatScopedConfigContainer_ACU(chat, null);
          result.changed = true;
      }

      if (clearGuide) {
          try {
              result.removedGuide = !!clearChatSheetGuideDataForIsolationKey_ACU({ chat, isolationKey: normalizedKey });
              result.changed = result.changed || result.removedGuide;
          } catch (e) { logWarn_ACU('[模板作用域] clearChatSheetGuide 失败:', e); }
      }

      if (clearLegacyGuide) {
          try {
              result.removedLegacyGuide = clearLegacyHeaderGuideForIsolationKey_ACU({ chat, isolationKey: normalizedKey });
              result.changed = result.changed || result.removedLegacyGuide;
          } catch (e) { logWarn_ACU('[模板作用域] clearLegacyHeaderGuide 失败:', e); }
      }

      if (save && result.changed) {
          try {
              await saveChatToHost_ACU();
          } catch (error) {
              logWarn_ACU('[TemplateScope] 保存聊天级模板快照清理失败:', error);
          }
      }

      return result;
  }

  function clearCurrentChatTemplateScopeState_ACU({ isolationKey = getCurrentIsolationKey_ACU(), clearGuide = true, archiveCurrent = true } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      if (archiveCurrent) {
          try {
              archiveCurrentChatTemplateScopeState_ACU({ isolationKey: normalizedKey, reason: 'clear_template_override' });
          } catch (e) { logWarn_ACU('[模板作用域] archiveTemplateScopeState 失败:', e); }
      }
      const result = setCurrentChatTemplateScopeState_ACU({ mode: 'inherit_global' }, {
          isolationKey: normalizedKey,
          reason: 'clear_template_override',
      });
      if (clearGuide) {
          try {
              clearChatSheetGuideDataForIsolationKey_ACU({ isolationKey: normalizedKey });
          } catch (e) { logWarn_ACU('[模板作用域] clearChatSheetGuide 失败:', e); }
      }
      return result;
  }

  export function getGlobalTemplateSnapshotForCurrentProfile_ACU({ readOnly = false } = {}) {
      const code = normalizeIsolationCode_ACU(settings_ACU?.dataIsolationCode || '');
      const previousTemplate = TABLE_TEMPLATE_ACU;
      const savedTemplate = readProfileTemplateFromStorage_ACU(code);
      const source = savedTemplate || DEFAULT_TABLE_TEMPLATE_ACU;
      let snapshot = sanitizeTemplateSnapshotForChat_ACU(readOnly
          ? parseReadableSheetSource_ACU(source)
          : source);
      if (snapshot?.templateStr) {
          return snapshot;
      }

      if (readOnly) {
          throw new Error('只读模板快照无法解析，拒绝修改运行时模板或以默认值替代损坏来源。');
      }
      try {
          _set_TABLE_TEMPLATE_ACU(savedTemplate || DEFAULT_TABLE_TEMPLATE_ACU);
          const parsedTemplate = parseTableTemplateJson_ACU({ stripSeedRows: false });
          snapshot = sanitizeTemplateSnapshotForChat_ACU(parsedTemplate);
      } catch (e) {
          snapshot = null;
      } finally {
          _set_TABLE_TEMPLATE_ACU(previousTemplate);
      }

      return snapshot || sanitizeTemplateSnapshotForChat_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
  }
