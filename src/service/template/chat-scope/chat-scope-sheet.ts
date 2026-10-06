/**
 * service/template/chat-scope/chat-scope-sheet.ts
 * Sheet 排序和清洗（E 组）
 */
import { DEFAULT_TABLE_TEMPLATE_ACU, TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU} from '../../../shared/defaults-json.js';
import { readProfileTemplateFromStorage_ACU, saveCurrentProfileTemplate_ACU } from '../../../data/repositories/profile-repo';
import { DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU, deriveTemplatePresetNameForImport_ACU, getCurrentTemplatePresetName_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../../shared/template-preset-utils';
import { CHAT_SCOPED_CONFIG_FIELD_ACU, CHAT_SHEET_GUIDE_FIELD_ACU, CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU, CHAT_SHEET_GUIDE_VERSION_ACU, CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU, LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU, MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU, getChatScopedConfigContainer_ACU, getChatSheetGuideContainer_ACU, normalizeChatScopedConfigContainer_ACU } from '../../../data/storage/chat-history';
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
import { normalizeGuideData_ACU } from './chat-scope-base';
import { normalizeSheetGuideRowIds_ACU } from './sheet-guide-row-id-normalizer';
import { getCurrentChatTemplateScopeState_ACU, buildChatTemplateScopeStateFromCurrent_ACU, setCurrentChatTemplateScopeState_ACU } from './chat-scope-template';
import { migrateLegacyTemplateScopeForCurrentChat_ACU, getChatSheetGuideDataForIsolationKey_ACU, buildChatSheetGuideDataFromTemplateObj_ACU } from './chat-scope-guide';

  export function getSortedSheetKeys_ACU(dataObj: any, { ignoreChatGuide = false, includeMissingFromGuide = false, templateSnapshot }:
      { ignoreChatGuide?: boolean; includeMissingFromGuide?: boolean; templateSnapshot?: Record<string, any> | null } = {}) {
      if (!dataObj || typeof dataObj !== 'object') return [];
      const existingKeys = Object.keys(dataObj).filter(k => k.startsWith('sheet_'));
      if (existingKeys.length === 0) return [];

      // [新增] 聊天级空白指导表：一旦存在，则该聊天不再按模板顺序合并/显示，而是按此指导表作为总指导
      if (!ignoreChatGuide) {
          try {
              const isolationKey = (typeof getCurrentIsolationKey_ACU === 'function') ? getCurrentIsolationKey_ACU() : '';
              const guideData = getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
              if (guideData && typeof guideData === 'object') {
                  const guideKeys = Object.keys(guideData).filter(k => k.startsWith('sheet_'));
                  if (guideKeys.length > 0) {
                      const sorted = guideKeys.sort((a, b) => {
                          const ao = Number.isFinite(guideData?.[a]?.[TABLE_ORDER_FIELD_ACU]) ? Math.trunc(guideData[a][TABLE_ORDER_FIELD_ACU]) : Infinity;
                          const bo = Number.isFinite(guideData?.[b]?.[TABLE_ORDER_FIELD_ACU]) ? Math.trunc(guideData[b][TABLE_ORDER_FIELD_ACU]) : Infinity;
                          if (ao !== bo) return ao - bo;
                          return String(a).localeCompare(String(b));
                      });
                      return includeMissingFromGuide ? sorted : sorted.filter(k => dataObj[k]);
                  }
              }
          } catch (e) {
              // ignore guide failures; fallback to legacy ordering
          }
      }

      // 尝试拿模板做兜底（比如老数据/导入数据缺编号）
      const templateObj = templateSnapshot === undefined
          ? parseTableTemplateJson_ACU({ stripSeedRows: false }) : templateSnapshot;

      // 先对 dataObj 补齐缺失编号（仅在确实缺失/重复时重建）
      // baseOrderKeys 的优先级：模板顺序 > 当前对象键顺序（保证"载入模板编好号"后的稳定性）
      const baseKeys = (() => {
          const tk = templateObj && typeof templateObj === 'object'
              ? Object.keys(templateObj).filter(k => k.startsWith('sheet_'))
              : [];
          return tk.length ? tk : existingKeys;
      })();
      ensureSheetOrderNumbers_ACU(dataObj, { baseOrderKeys: baseKeys, forceRebuild: false });

      const orderValueOf = (k: string) => {
          const v = dataObj?.[k]?.[TABLE_ORDER_FIELD_ACU];
          if (Number.isFinite(v)) return Math.trunc(v);
          const tv = templateObj?.[k]?.[TABLE_ORDER_FIELD_ACU];
          if (Number.isFinite(tv)) return Math.trunc(tv);
          return Infinity;
      };

      return existingKeys.sort((a, b) => {
          const ao = orderValueOf(a);
          const bo = orderValueOf(b);
          if (ao !== bo) return ao - bo;
          // 稳定排序：同编号时按名称/键
          const an = String(dataObj?.[a]?.name || templateObj?.[a]?.name || a);
          const bn = String(dataObj?.[b]?.name || templateObj?.[b]?.name || b);
          const c = an.localeCompare(bn);
          if (c !== 0) return c;
          return String(a).localeCompare(String(b));
      });
  }

  // [新增] 基于"空白指导表"构建可合并的骨架数据（深拷贝，避免后续修改污染原对象）
  export function buildGuidedBaseDataFromSheetGuide_ACU(guideData: any) {
      if (!guideData) return { mate: { type: 'chatSheets', version: 1 } };
      const identityNormalized = normalizeSheetGuideRowIds_ACU(guideData);
      if (identityNormalized.blockers.length > 0) {
          throw new Error(`Sheet Guide row_id 结构无效：${identityNormalized.blockers.join('；')}`);
      }
      const normalized = normalizeGuideData_ACU(identityNormalized.guideData);
      if (!normalized) return { mate: { type: 'chatSheets', version: 1 } };
      try { return JSON.parse(JSON.stringify(normalized)); } catch (e) { return normalized; }
  }

  // [修复] 按指定顺序重建对象键，避免 Object.keys()/合并/深拷贝导致的顺序漂移
  export function reorderDataBySheetKeys_ACU(dataObj: any, orderedSheetKeys: string[]) {
      if (!dataObj || typeof dataObj !== 'object') return dataObj;
      const out: any = {};
      // 先保留非 sheet_ 键（mate 等）
      Object.keys(dataObj).forEach(k => {
          if (!k.startsWith('sheet_')) out[k] = dataObj[k];
      });
      // 再按顺序插入 sheet_ 键
      const keys = Array.isArray(orderedSheetKeys) ? orderedSheetKeys : getSortedSheetKeys_ACU(dataObj);
      keys.forEach(k => {
          if (dataObj[k]) out[k] = dataObj[k];
      });
      return out;
  }

  // =========================
  // [瘦身/兼容] ChatSheets 表格对象清洗（用于：导出、写入聊天记录、持久化模板）
  // 目标：
  // - 与旧模板/旧存档兼容：导入时允许存在冗余字段
  // - 从现在开始：导出/保存时不再携带历史遗留冗余字段，降低体积
  // =========================
  const SHEET_KEEP_KEYS_ACU = new Set([
      'uid',
      'name',
      'sourceData',
      'content',
      // [重要] 可视化编辑器/表格配置（更新频率、上下文深度等）依赖该字段
      'updateConfig',
      'exportConfig',
      TABLE_ORDER_FIELD_ACU, // orderNo
  ]);

  export function sanitizeSheetForStorage_ACU(sheet: any) {
      if (!sheet || typeof sheet !== 'object') return sheet;
      const out: any = {};
      SHEET_KEEP_KEYS_ACU.forEach(k => {
          if (sheet[k] !== undefined) out[k] = sheet[k];
      });
      // 兜底：保证结构可被模板导入验证通过
      if (!out.name && sheet.name) out.name = sheet.name;
      if (!out.content && Array.isArray(sheet.content)) out.content = sheet.content;
      if (!out.sourceData && sheet.sourceData) out.sourceData = sheet.sourceData;
      out.exportConfig = ensureExportConfigDefaults_ACU(out.exportConfig, out.name || sheet.name || sheet.uid || '');
      return out;
  }

  export function sanitizeChatSheetsObject_ACU(dataObj: any, { ensureMate = false } = {}) {
      if (!dataObj || typeof dataObj !== 'object') return dataObj;
      const out: any = {};
      Object.keys(dataObj).forEach(k => {
          if (k.startsWith('sheet_')) {
              out[k] = sanitizeSheetForStorage_ACU(dataObj[k]);
          } else if (k === 'mate') {
              out.mate = dataObj.mate;
          } else {
              // 其它顶层键：为兼容保留
              out[k] = dataObj[k];
          }
      });
      if (ensureMate) {
          if (!out.mate || typeof out.mate !== 'object') out.mate = { type: 'chatSheets', version: 1 };
          if (!out.mate.type) out.mate.type = 'chatSheets';
          if (!out.mate.version) out.mate.version = 1;
      }
      return out;
  }



  // [新增] 辅助函数：从上下文中提取指定标签的内容（正文标签提取）

// 从 shared/utils.ts 搬来（原函数依赖 service/data 层，不适合放在 shared 层）
export function getTemplateSheetKeys_ACU() {
    const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: false });
    if (!templateObj || typeof templateObj !== 'object') return [];

    const keys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
    if (keys.length === 0) return [];

    const changed = ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: keys, forceRebuild: false });
    if (changed) {
        try {
            const normalizedTemplateStr = JSON.stringify(templateObj);
            _set_TABLE_TEMPLATE_ACU(normalizedTemplateStr);
            const currentChatTemplateScope = getCurrentChatTemplateScopeState_ACU() || migrateLegacyTemplateScopeForCurrentChat_ACU();
            if (currentChatTemplateScope?.templateStr) {
                const updatedGuideData = buildChatSheetGuideDataFromTemplateObj_ACU(templateObj, { stripSeedRows: false });
                const nextState = buildChatTemplateScopeStateFromCurrent_ACU({
                    isolationKey: currentChatTemplateScope.isolationKey,
                    presetName: currentChatTemplateScope.presetName,
                    source: currentChatTemplateScope.source || 'inherit',
                    originGlobalName: currentChatTemplateScope.originGlobalName,
                    originGlobalRevision: currentChatTemplateScope.originGlobalRevision,
                    updatedAt: currentChatTemplateScope.updatedAt || Date.now(),
                    templateSource: normalizedTemplateStr,
                    guideData: updatedGuideData || currentChatTemplateScope.guideData,
                });
                if (nextState) {
                    setCurrentChatTemplateScopeState_ACU(nextState, {
                        isolationKey: currentChatTemplateScope.isolationKey,
                        reason: 'template_scope_order_no_init',
                    });
                }
                logDebug_ACU('[OrderNo] Chat template order numbers initialized and persisted to current chat scope.');
            } else {
                saveCurrentProfileTemplate_ACU(TABLE_TEMPLATE_ACU, settings_ACU);
                logDebug_ACU('[OrderNo] Global template order numbers initialized and persisted.');
            }
        } catch (e) {
            logWarn_ACU('[OrderNo] Failed to persist initialized template order numbers:', e);
        }
    }

    return keys.sort((a, b) => {
        const ao = Number.isFinite(templateObj[a]?.[TABLE_ORDER_FIELD_ACU]) ? templateObj[a][TABLE_ORDER_FIELD_ACU] : Infinity;
        const bo = Number.isFinite(templateObj[b]?.[TABLE_ORDER_FIELD_ACU]) ? templateObj[b][TABLE_ORDER_FIELD_ACU] : Infinity;
        if (ao !== bo) return ao - bo;
        return String(templateObj[a]?.name || a).localeCompare(String(templateObj[b]?.name || b));
    });
}
