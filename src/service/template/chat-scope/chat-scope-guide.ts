/**
 * service/template/chat-scope/chat-scope-guide.ts
 * Sheet Guide 数据操作（D 组）
 */
import { DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU, deriveTemplatePresetNameForImport_ACU, getCurrentTemplatePresetName_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../../shared/template-preset-utils';
import { CHAT_SCOPED_CONFIG_FIELD_ACU, CHAT_SHEET_GUIDE_FIELD_ACU, CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU, CHAT_SHEET_GUIDE_VERSION_ACU, CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU, LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU, MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU, getChatScopedConfigContainer_ACU, getChatSheetGuideContainer_ACU, peekChatScopedConfigContainer_ACU, peekChatSheetGuideContainer_ACU, normalizeChatScopedConfigContainer_ACU, setChatSheetGuideContainer_ACU } from '../../../data/storage/chat-history';
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
import { normalizeChatScopedConfigSource_ACU, normalizeGuideData_ACU, assertReadableSheetSource_ACU, parseReadableSheetSource_ACU } from './chat-scope-base';
import { normalizeSheetGuideRowIds_ACU } from './sheet-guide-row-id-normalizer';
// 循环 import — 运行时安全
import { normalizeTemplateScopeMode_ACU, normalizeTemplateScopeIsolationKey_ACU, sanitizeTemplateSnapshotForChat_ACU, getCurrentChatTemplateScopeState_ACU, setCurrentChatTemplateScopeState_ACU, buildChatTemplateScopeStateFromCurrent_ACU, getGlobalTemplateSnapshotForCurrentProfile_ACU, normalizeChatTemplateScopeState_ACU } from './chat-scope-template';
import { getSortedSheetKeys_ACU } from './chat-scope-sheet';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../../shared/stable-row-id-allocator';

function cloneTableRows_ACU(rows: any[] | null | undefined) {
    return Array.isArray(rows) ? JSON.parse(JSON.stringify(rows)) : [];
}

function normalizeSeedRow_ACU(row: any) {
    return Array.isArray(row) ? [...row] : [];
}

function assignMissingStableRowIds_ACU(rows: any[][]) {
    const reservedIds = createStableRowIdReservation_ACU(rows);

    rows.forEach(row => {
        const rowId = row[0];
        const normalizedId = rowId == null ? '' : String(rowId).trim();
        if (!normalizedId) row[0] = allocateStableRowId_ACU(reservedIds);
        else row[0] = normalizedId;
    });

    return rows;
}

function normalizeGuideRowIdentitiesForUse_ACU(guideData: Record<string, any> | null) {
    if (!guideData) return null;
    // 必须先审计原始 guide。若先经过 normalizeGuideData_ACU，缺失 content
    // 会被伪造为 [null]，从而把损坏结构误判成可安全插入 row_id 的空表。
    const result = normalizeSheetGuideRowIds_ACU(guideData);
    if (result.blockers.length > 0) {
        throw new Error(`Sheet Guide row_id 结构无效：${result.blockers.join('；')}`);
    }
    return normalizeGuideData_ACU(result.guideData);
}

export function ensureStableRowIdsForSeedRows_ACU(seedRows: any[] | null | undefined) {
    const normalizedRows = cloneTableRows_ACU(seedRows).map(normalizeSeedRow_ACU);
    return assignMissingStableRowIds_ACU(normalizedRows);
}

export function ensureStableRowIdsForSheetContent_ACU(content: any[] | null | undefined) {
    if (!Array.isArray(content) || content.length === 0) return [];
    const clonedContent = cloneTableRows_ACU(content);
    const headerRow = Array.isArray(clonedContent[0]) ? [...clonedContent[0]] : ['row_id'];
    if (clonedContent.length === 1) return [headerRow];

    const normalizedRows = clonedContent.slice(1).map(normalizeSeedRow_ACU);
    return [headerRow, ...assignMissingStableRowIds_ACU(normalizedRows)];
}

function messageHasTableData_ACU(message: any, isolationKey: string) {
    try {
        if (!message || message.is_user) return false;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        if (tagData?.independentData && Object.keys(tagData.independentData).some(k => k.startsWith('sheet_'))) return true;
        if (isLegacyMatchForIsolation_ACU(message, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode })) {
            const legacyIndependent = readLegacyIndependentData_ACU(message);
            if (legacyIndependent && Object.keys(legacyIndependent).some(k => k.startsWith('sheet_'))) return true;
            const legacyStandard = readLegacyStandardData_ACU(message);
            if (legacyStandard && Object.keys(legacyStandard).some(k => k.startsWith('sheet_'))) return true;
            const legacySummary = readLegacySummaryData_ACU(message);
            if (legacySummary && Object.keys(legacySummary).some(k => k.startsWith('sheet_'))) return true;
        }
    } catch (_) {}
    return false;
}

export function shouldUseInitialSeedRows_ACU(): boolean {
    try {
        const chat = getChatArray_ACU();
        if (!Array.isArray(chat) || chat.length === 0) return false;
        const userCount = chat.filter(m => m && m.is_user).length;
        if (userCount !== 1) return false;
        const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
        return !chat.some(message => messageHasTableData_ACU(message, isolationKey));
    } catch (_) {
        return false;
    }
}

export function shouldUseOpeningSeedRows_ACU(): boolean {
    return shouldUseInitialSeedRows_ACU();
}

  export function materializeDataFromSheetGuide_ACU(guideData: Record<string, any> | null, { includeSeedRows = true } = {}) {
      const normalized = normalizeGuideRowIdentitiesForUse_ACU(guideData);
      if (!normalized) return { mate: { type: 'chatSheets', version: 1 } };
      const out: Record<string, any> = { mate: normalized.mate || { type: 'chatSheets', version: 1 } };
      Object.keys(normalized).forEach((k: string) => {
          if (!k.startsWith('sheet_')) return;
          const s = normalized[k];
          const headerRow = Array.isArray(s?.content?.[0]) ? JSON.parse(JSON.stringify(s.content[0])) : ["row_id"];
          const next = JSON.parse(JSON.stringify(s));
          // content: header + (可选) seedRows
          const seedRows = includeSeedRows && Array.isArray(s?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU])
              ? ensureStableRowIdsForSeedRows_ACU(s[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU])
              : [];
          next.content = [headerRow, ...seedRows];
          if (Array.isArray(next[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU])) next[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = ensureStableRowIdsForSeedRows_ACU(next[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU]);
          // 保留 seedRows 字段本身（便于后续再次写回/二次处理），但不会影响表格使用者（他们只看 content）
          out[k] = next;
      });
      return out;
  }

  function getLegacyHeaderGuideDataForIsolationKey_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), readOnly = false } = {}) {
      const normalizedKey = String(isolationKey ?? '');
      try {
          const first = getChatFirstLayerMessage_ACU(chat);
          const legacyRaw = first ? first[LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU] : null;
          const legacyObj = legacyRaw ? ((typeof legacyRaw === 'string') ? safeJsonParse_ACU(legacyRaw, null) : legacyRaw) : null;
          if (readOnly && legacyRaw != null && (!legacyObj || typeof legacyObj !== 'object' || Array.isArray(legacyObj))) {
              throw new Error('只读旧表头来源损坏，禁止建立桥接模板。');
          }
          const legacyTags = legacyObj?.tags;
          if (readOnly && legacyTags !== undefined
              && (!legacyTags || typeof legacyTags !== 'object' || Array.isArray(legacyTags))) {
              throw new Error('只读旧表头标签容器损坏，禁止回退默认模板。');
          }
          const legacySlot = (legacyTags && typeof legacyTags === 'object') ? legacyTags[normalizedKey] : null;
          const legacyHeaders = Array.isArray(legacySlot?.headers) ? legacySlot.headers : null;
          if (readOnly && legacySlot != null && (!legacyHeaders || Array.isArray(legacySlot)
              || typeof legacySlot !== 'object')) {
              throw new Error('只读旧表头槽位损坏，禁止以缺失模板替代。');
          }
          if (!legacyHeaders || legacyHeaders.length === 0) return null;

          const orderedUids = legacyHeaders
              .map((h: any) => h?.uid)
              .filter((uid: any) => typeof uid === 'string' && uid.startsWith('sheet_'));
          if (readOnly && (orderedUids.length !== legacyHeaders.length
              || new Set(orderedUids).size !== orderedUids.length)) {
              throw new Error('只读旧表头身份缺失或重复，禁止丢弃损坏映射。');
          }
          if (orderedUids.length === 0) return null;

          const templateObj = readOnly
              ? getGlobalTemplateSnapshotForCurrentProfile_ACU({ readOnly: true })?.templateObj
              : parseTableTemplateJson_ACU({ stripSeedRows: false });
          const out: any = { mate: { type: 'chatSheets', version: CHAT_SHEET_GUIDE_VERSION_ACU } };
          orderedUids.forEach((uid: string, idx: number) => {
              if (readOnly && !templateObj?.[uid]) {
                  throw new Error('只读旧表头缺少对应模板结构，不能伪造桥接基线。');
              }
              const base = (templateObj && templateObj[uid])
                  ? JSON.parse(JSON.stringify(templateObj[uid]))
                  : { uid, name: uid, content: [["row_id"]], sourceData: {}, updateConfig: {}, exportConfig: {} };
              if (Array.isArray(base.content) && base.content.length > 1) {
                  base[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = JSON.parse(JSON.stringify(base.content.slice(1)));
                  base.content = [base.content[0]];
              }
              if (!Array.isArray(base.content) || base.content.length === 0) base.content = [["row_id"]];
              base.uid = uid;
              if (!Number.isFinite(base[TABLE_ORDER_FIELD_ACU])) base[TABLE_ORDER_FIELD_ACU] = idx;
              out[uid] = base;
          });
          return normalizeGuideData_ACU(out);
      } catch (e) {
          if (readOnly) throw e;
          return null;
      }
  }

  function getHistoricalTemplateGuideDataForIsolationKey_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), readOnly = false } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      if (!Array.isArray(chat) || chat.length === 0) return null;

      const historicalData: Record<string, any> = { mate: { type: 'chatSheets', version: 1 } };
      const encounteredKeys: string[] = [];
      const encounteredSet = new Set();
      const appendTables = (dataObj: Record<string, any> | null, { summaryOnly = null as boolean | null } = {}) => {
          if (readOnly && dataObj != null && (typeof dataObj !== 'object' || Array.isArray(dataObj))) {
              throw new Error('只读历史模板来源损坏，禁止忽略后继续桥接。');
          }
          if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) return;
          Object.keys(dataObj).forEach(key => {
              if (!key.startsWith('sheet_')) return;
              const sheet = dataObj[key];
              if (readOnly) assertReadableSheetSource_ACU({ [key]: sheet });
              if (encounteredSet.has(key)) return;
              if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return;
              const isSummary = !!sheet.name && isSummaryOrOutlineTable_ACU(sheet.name);
              if (summaryOnly === true && !isSummary) return;
              if (summaryOnly === false && isSummary) return;
              historicalData[key] = JSON.parse(JSON.stringify(sheet));
              encounteredKeys.push(key);
              encounteredSet.add(key);
          });
      };

      for (let i = chat.length - 1; i >= 0; i--) {
          const message = chat[i];
          if (!message || message.is_user) continue;

          const isolatedTagData = readIsolatedTagData_ACU(message, normalizedKey);
          appendTables(isolatedTagData?.independentData);

          const isLegacyMatch = isLegacyMatchForIsolation_ACU(message, {
              enabled: settings_ACU.dataIsolationEnabled,
              code: settings_ACU.dataIsolationCode,
          });
          if (!isLegacyMatch) continue;

          appendTables(readLegacyIndependentData_ACU(message));
          appendTables(readLegacyStandardData_ACU(message), { summaryOnly: false });
          appendTables(readLegacySummaryData_ACU(message), { summaryOnly: true });
      }

      if (encounteredKeys.length === 0) return null;

      const orderedKeys = encounteredKeys
          .map((key, index) => ({
              key,
              index,
              order: Number.isFinite(historicalData?.[key]?.[TABLE_ORDER_FIELD_ACU])
                  ? Math.trunc(historicalData[key][TABLE_ORDER_FIELD_ACU])
                  : null,
          }))
          .sort((a, b) => {
              if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
              if (a.order !== null && b.order === null) return -1;
              if (a.order === null && b.order !== null) return 1;
              return a.index - b.index;
          })
          .map(item => item.key);

      applySheetOrderNumbers_ACU(historicalData, orderedKeys);
      return buildChatSheetGuideDataFromData_ACU(historicalData, {
          preserveSeedRowsFromGuideData: null,
          seedRowsFromTemplateObj: null,
          orderedKeys,
      });
  }

  function getLegacyTemplateSnapshotLabel_ACU(source = 'legacy_frozen') {
      if (source === 'legacy_history_frozen') return '旧对话历史模板快照';
      if (source === 'legacy_header_frozen') return '旧版表头冻结模板';
      return '旧版聊天冻结模板';
  }

  function buildChatTemplateScopeStateFromGuideData_ACU({ isolationKey = getCurrentIsolationKey_ACU(), presetName = '', source = 'legacy_frozen', originGlobalName = '', originGlobalRevision = 0, updatedAt = Date.now(), guideData = null as Record<string, any> | null } = {}) {
      const normalizedGuideData = normalizeGuideData_ACU(guideData);
      if (!normalizedGuideData || !Object.keys(normalizedGuideData).some(k => k.startsWith('sheet_'))) return null;
      const templateObj = materializeDataFromSheetGuide_ACU(normalizedGuideData, { includeSeedRows: true });
      return buildChatTemplateScopeStateFromCurrent_ACU({
          isolationKey,
          presetName,
          source,
          originGlobalName,
          originGlobalRevision,
          updatedAt,
          templateSource: templateObj,
          guideData: normalizedGuideData,
      });
  }

  export function migrateLegacyTemplateScopeForCurrentChat_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), readOnly = false } = {}) {
      const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(isolationKey);
      const existingScopeState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey: normalizedKey, readOnly });
      if (existingScopeState) return existingScopeState;

      const persistMigratedState = (guideData: Record<string, any> | null, { source = 'legacy_frozen', updatedAt = Date.now() } = {}) => {
          const templateState = buildChatTemplateScopeStateFromGuideData_ACU({
              isolationKey: normalizedKey,
              presetName: getLegacyTemplateSnapshotLabel_ACU(source),
              source,
              originGlobalName: '',
              originGlobalRevision: 0,
              updatedAt,
              guideData,
          });
          if (!templateState) return null;
          if (readOnly) return templateState;
          return setCurrentChatTemplateScopeState_ACU(templateState, {
              isolationKey: normalizedKey,
              reason: `template_scope_${source}`,
          });
      };

      const container = readOnly ? peekChatSheetGuideContainer_ACU(chat, { strict: true }) : getChatSheetGuideContainer_ACU(chat);
      const legacySlot = (container?.tags as Record<string, any> | undefined)?.[normalizedKey];
      if (readOnly && container?.tags && Object.prototype.hasOwnProperty.call(container.tags, normalizedKey)
          && (!legacySlot || typeof legacySlot !== 'object' || Array.isArray(legacySlot)
              || legacySlot.templateScopeMode !== undefined
                  && !['inherit_global', 'chat_override', 'preset_link'].includes(legacySlot.templateScopeMode))) {
          throw new Error('只读旧 guide 槽位或作用域损坏，禁止回退其它模板。');
      }
      const hasExplicitLegacyScopeMode = typeof legacySlot?.templateScopeMode === 'string' && legacySlot.templateScopeMode.trim() !== '';
      const legacySlotMode = hasExplicitLegacyScopeMode
          ? normalizeTemplateScopeMode_ACU(legacySlot.templateScopeMode)
          : 'chat_override';
      const legacyGuideSource = readOnly && legacySlotMode === 'chat_override' && legacySlot !== undefined
          ? parseReadableSheetSource_ACU(legacySlot.data)
          : legacySlot?.data;
      const legacyGuideData = normalizeGuideData_ACU(legacyGuideSource);
      if (legacySlotMode === 'chat_override' && legacyGuideData && Object.keys(legacyGuideData).some(k => k.startsWith('sheet_'))) {
          return persistMigratedState(legacyGuideData, {
              source: 'legacy_frozen',
              updatedAt: Number(legacySlot?.updatedAt) || Date.now(),
          });
      }

      const historicalGuideData = getHistoricalTemplateGuideDataForIsolationKey_ACU({ chat, isolationKey: normalizedKey, readOnly });
      if (historicalGuideData && Object.keys(historicalGuideData).some(k => k.startsWith('sheet_'))) {
          return persistMigratedState(historicalGuideData, {
              source: 'legacy_history_frozen',
              updatedAt: Date.now(),
          });
      }

      const legacyHeaderGuideData = getLegacyHeaderGuideDataForIsolationKey_ACU({ chat, isolationKey: normalizedKey, readOnly });
      if (legacyHeaderGuideData && Object.keys(legacyHeaderGuideData).some(k => k.startsWith('sheet_'))) {
          return persistMigratedState(legacyHeaderGuideData, {
              source: 'legacy_header_frozen',
              updatedAt: Date.now(),
          });
      }

      return null;
  }

  export function clearChatSheetGuideDataForIsolationKey_ACU({ chat = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU() } = {}) {
      const first = getChatFirstLayerMessage_ACU(chat);
      if (!first) return false;

      const container = getChatSheetGuideContainer_ACU(chat);
      if (!container || typeof container !== 'object' || !container.tags || typeof container.tags !== 'object') return false;

      const normalizedKey = String(isolationKey ?? '');
      if (!Object.prototype.hasOwnProperty.call(container.tags, normalizedKey)) return false;

      const nextContainer = cloneScopedConfigData_ACU(container, null) || { version: CHAT_SHEET_GUIDE_VERSION_ACU, tags: {} };
      if (!nextContainer.tags || typeof nextContainer.tags !== 'object') nextContainer.tags = {};
      delete nextContainer.tags[normalizedKey];

      if (Object.keys(nextContainer.tags).length === 0) {
          setChatSheetGuideContainer_ACU(chat, null);
      } else {
          nextContainer.version = CHAT_SHEET_GUIDE_VERSION_ACU;
          setChatSheetGuideContainer_ACU(chat, nextContainer);
      }
      return true;
  }

  // 读写容器不对称是有意的，不要"修复"成让 getter 直接读 guide 容器：
  // setter 把数据写进 guide 容器（container.tags[key]），只有 shouldSyncTemplateScope
  // 为真时才同步 template scope；而本 getter 读的是 template scope 的 guideData，
  // inherit_global 下 getCurrentChatTemplateScopeState_ACU 返回 null
  // （chat-scope-template.ts:423-425），因此会一路回退到全局模板快照。
  //
  // 结构真相不依赖这条读回路径：填表基底优先取 V2 checkpoint 回放，
  // guide 仅在无 checkpoint 时充当结构源（buildBatchMergeBase_ACU 的分支顺序，
  // update-orchestrator.ts:747-804）。让 getter 读 guide 容器会使未显式覆盖模板的
  // 聊天被隐式写入悄悄改变视图，反而破坏"跟随全局模板"的语义。
  export function getChatSheetGuideDataForIsolationKey_ACU(isolationKey: string,
      snapshot?: { chat: any[] }) {
      const chat = snapshot ? snapshot.chat : getChatArray_ACU();
      const normalizedKey = String(isolationKey ?? '');
      const scopedTemplateState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey: normalizedKey, readOnly: !!snapshot })
          || migrateLegacyTemplateScopeForCurrentChat_ACU({ chat, isolationKey: normalizedKey, readOnly: !!snapshot });
      const scopedGuideData = normalizeGuideRowIdentitiesForUse_ACU(scopedTemplateState?.guideData);
      if (scopedGuideData && Object.keys(scopedGuideData).some(k => k.startsWith('sheet_'))) {
          return scopedGuideData;
      }

      const buildGuideDataFromTemplateSource_ACU = (templateSource: any) => {
          const templateSnapshot = sanitizeTemplateSnapshotForChat_ACU(snapshot
              ? parseReadableSheetSource_ACU(templateSource)
              : templateSource);
          const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(templateSnapshot?.templateObj, { stripSeedRows: false });
          const normalizedGuideData = normalizeGuideRowIdentitiesForUse_ACU(guideData);
          return (normalizedGuideData && Object.keys(normalizedGuideData).some(k => k.startsWith('sheet_'))) ? normalizedGuideData : null;
      };

      if (scopedTemplateState?.mode === 'chat_override' && scopedTemplateState?.templateStr) {
          const overrideGuideData = buildGuideDataFromTemplateSource_ACU(scopedTemplateState.templateStr);
          if (overrideGuideData) {
              return overrideGuideData;
          }
      }

      if (scopedTemplateState?.mode === 'preset_link') {
          const linkedPresetName = normalizeTemplatePresetSelectionValue_ACU(scopedTemplateState?.presetName || '');
          const linkedTemplateSource = linkedPresetName
              ? (getTemplatePreset_ACU(linkedPresetName)?.templateStr || null)
              : getDefaultTemplateSnapshot_ACU()?.templateStr;
          const linkedGuideData = buildGuideDataFromTemplateSource_ACU(linkedTemplateSource);
          if (linkedGuideData) {
              return linkedGuideData;
          }
      }

      const globalSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU({ readOnly: !!snapshot });
      const globalGuideData = buildChatSheetGuideDataFromTemplateObj_ACU(globalSnapshot?.templateObj, { stripSeedRows: false });
      const normalizedGlobalGuideData = normalizeGuideRowIdentitiesForUse_ACU(globalGuideData);
      if (normalizedGlobalGuideData && Object.keys(normalizedGlobalGuideData).some(k => k.startsWith('sheet_'))) {
          return normalizedGlobalGuideData;
      }

      return null;
  }

  export function setChatSheetGuideDataForIsolationKey_ACU(isolationKey: string, guideData: Record<string, any> | null, { reason = '', syncTemplateScope = false, templateSource = null as any, presetName = '', source = '', updatedAt = Date.now() } = {}) {
      const chat = getChatArray_ACU();
      const first = getChatFirstLayerMessage_ACU(chat);
      if (!first) return false;

      let normalized: Record<string, any> | null;
      try {
          normalized = normalizeGuideRowIdentitiesForUse_ACU(guideData);
      } catch (error) {
          logWarn_ACU('[SheetGuide] 拒绝写入非 canonical row_id 结构：', error);
          return false;
      }
      if (!normalized || !Object.keys(normalized).some(k => k.startsWith('sheet_'))) return false;

      const normalizedKey = String(isolationKey ?? '');
      const existingTemplateScopeState = getCurrentChatTemplateScopeState_ACU({ chat, isolationKey: normalizedKey });
      const normalizedScopeMode = normalizeTemplateScopeMode_ACU(existingTemplateScopeState?.mode);
      const shouldSyncTemplateScope = !!syncTemplateScope || normalizedScopeMode === 'chat_override' || normalizedScopeMode === 'preset_link';
      const container: Record<string, any> = getChatSheetGuideContainer_ACU(chat) || { version: CHAT_SHEET_GUIDE_VERSION_ACU, tags: {} as Record<string, any> };
      if (!container.tags || typeof container.tags !== 'object') container.tags = {} as Record<string, any>;
      container.version = CHAT_SHEET_GUIDE_VERSION_ACU;
      container.tags[normalizedKey] = {
          data: normalized,
          updatedAt,
          reason: String(reason || ''),
          templateScopeMode: shouldSyncTemplateScope ? 'chat_override' : 'inherit_global',
      };
      setChatSheetGuideContainer_ACU(chat, container);
      if (shouldSyncTemplateScope) {
          const fallbackTemplateSource = existingTemplateScopeState?.templateStr || materializeDataFromSheetGuide_ACU(normalized, { includeSeedRows: true });
          const resolvedTemplateSource = templateSource || fallbackTemplateSource;
          const currentGlobalPresetName = normalizeTemplatePresetSelectionValue_ACU(getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false }));
          const resolvedPresetName = normalizeTemplatePresetSelectionValue_ACU(
              presetName || existingTemplateScopeState?.presetName || currentGlobalPresetName,
          );
          const resolvedSource = normalizeChatScopedConfigSource_ACU(
              source,
              existingTemplateScopeState?.source || (syncTemplateScope ? 'ui' : 'inherit'),
          );
          const templateState = buildChatTemplateScopeStateFromCurrent_ACU({
              isolationKey: normalizedKey,
              presetName: resolvedPresetName,
              source: resolvedSource,
              originGlobalName: normalizeTemplatePresetSelectionValue_ACU(
                  existingTemplateScopeState?.originGlobalName || currentGlobalPresetName,
              ),
              originGlobalRevision: Number.isFinite(existingTemplateScopeState?.originGlobalRevision)
                  ? existingTemplateScopeState.originGlobalRevision
                  : 0,
              updatedAt,
              templateSource: resolvedTemplateSource,
              guideData: normalized,
          });
          if (!templateState) return false;
          const scopeUpdated = setCurrentChatTemplateScopeState_ACU(templateState, {
              isolationKey: normalizedKey,
              reason: String(reason || `template_scope_${resolvedSource}`),
          });
          if (!scopeUpdated) return false;
      }
      return true;
  }

  // =========================
  // [新增] seedRows 解析/兜底：用于 $0 注入与"无数据初始化"场景
  // 目标：
  // - 新对话首次填表时，即使 currentJsonTableData_ACU 仅有表结构，也能从"内部指导表/模板"取到 seedRows
  // - 支持隔离标签切换或初始化早期 chat 尚未加载导致的"指导表未命中"情况
  // 注意：这里只把 seedRows 挂在表对象字段上，不会写入 content（不把模板基础数据当作真实聊天数据）
  // =========================
  let _seedRowsTemplateCacheStr_ACU: string | null = null;
  let _seedRowsTemplateCacheObj_ACU: Record<string, any> | null = null;

  function getTemplateObjForSeedRows_ACU() {
      try {
          const snapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
          if (snapshot?.templateStr && _seedRowsTemplateCacheStr_ACU === snapshot.templateStr && _seedRowsTemplateCacheObj_ACU) return _seedRowsTemplateCacheObj_ACU;
          if (snapshot?.templateObj) {
              _seedRowsTemplateCacheStr_ACU = snapshot.templateStr || '';
              _seedRowsTemplateCacheObj_ACU = JSON.parse(JSON.stringify(snapshot.templateObj));
              return _seedRowsTemplateCacheObj_ACU;
          }
          const obj = parseTableTemplateJson_ACU({ stripSeedRows: false });
          _seedRowsTemplateCacheStr_ACU = JSON.stringify(obj || {});
          _seedRowsTemplateCacheObj_ACU = obj;
          return obj;
      } catch (e) {
          return null;
      }
  }

  export async function ensureChatSheetGuideSeeded_ACU({ reason = 'auto_seed_seedRows', force = false } = {}) {
      try {
          const isolationKey = getCurrentIsolationKey_ACU();
          const existing = getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
          const hasExisting = !!(existing && typeof existing === 'object' && Object.keys(existing).some(k => k.startsWith('sheet_')));
          if (hasExisting && !force) return existing;

          const chat = getChatArray_ACU();
          if (!chat || !Array.isArray(chat) || chat.length === 0) return existing || null;

          const templateObj = getTemplateObjForSeedRows_ACU();
          if (!templateObj) return existing || null;

          // 用模板构建指导表（content 保留表头；seedRows 写入字段）
          const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(templateObj, { stripSeedRows: true });
          if (!guideData) return existing || null;

          const ok = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, guideData, { reason });
          if (ok) {
              try { await saveChatToHost_ACU(); } catch (e) { logWarn_ACU('[Guide] saveChatToHost 失败:', e); }
              logDebug_ACU(`[SheetGuide] Auto-seeded chat sheet guide for tag [${isolationKey || '无标签'}], reason=${reason}`);
          }
          return guideData;
      } catch (e) {
          return null;
      }
  }

  function pickAnyGuideSeedRowsSlot_ACU(sheetKey: string) {
      try {
          const chat = getChatArray_ACU();
          let best: { ts: number; seedRows: any[] } | null = null;
          const applyCandidate = (ts: number, data: Record<string, any> | null) => {
              const sr = data?.[sheetKey]?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU];
              if (!Array.isArray(sr) || sr.length === 0) return;
              if (!best || ts > best.ts) {
                  best = { ts, seedRows: sr };
              }
          };

          const scopedContainer = peekChatScopedConfigContainer_ACU(chat);
          const scopedTemplateSlots = scopedContainer?.template;
          if (scopedTemplateSlots && typeof scopedTemplateSlots === 'object' && !Array.isArray(scopedTemplateSlots)) {
              Object.keys(scopedTemplateSlots).forEach((tagKey: string) => {
                  const slotState = normalizeChatTemplateScopeState_ACU((scopedTemplateSlots as Record<string, any>)[tagKey], { isolationKey: tagKey });
                  if (slotState.mode !== 'chat_override') return;
                  applyCandidate(Number(slotState.updatedAt) || 0, normalizeGuideData_ACU(slotState.guideData));
              });
          }
          if (best) {
              return JSON.parse(JSON.stringify(best.seedRows));
          }

          const container = peekChatSheetGuideContainer_ACU(chat);
          const tags = container?.tags;
          if (!tags || typeof tags !== 'object') return null;
          Object.keys(tags).forEach((tagKey: string) => {
              const slot = (tags as Record<string, any>)[tagKey];
              const ts = Number(slot?.updatedAt) || 0;
              applyCandidate(ts, normalizeGuideData_ACU(slot?.data));
          });
          return best ? JSON.parse(JSON.stringify(best.seedRows)) : null;
      } catch (e) {
          return null;
      }
  }

  export function getEffectiveSeedRowsForSheet_ACU(sheetKey: string, { guideData = null as Record<string, any> | null, allowTemplateFallback = true } = {}) {
      try {
          if (!sheetKey || !String(sheetKey).startsWith('sheet_')) return [];
          if (!shouldUseInitialSeedRows_ACU()) return [];
          const direct = currentJsonTableData_ACU?.[sheetKey]?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU];
          if (Array.isArray(direct) && direct.length > 0) return ensureStableRowIdsForSeedRows_ACU(direct);

          const g = guideData || (() => {
              const isolationKey = getCurrentIsolationKey_ACU();
              return getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
          })();
          const sr1 = g?.[sheetKey]?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU];
          if (Array.isArray(sr1) && sr1.length > 0) return ensureStableRowIdsForSeedRows_ACU(sr1);

          const any = pickAnyGuideSeedRowsSlot_ACU(sheetKey);
          if (Array.isArray(any) && any.length > 0) return ensureStableRowIdsForSeedRows_ACU(any);

          if (!allowTemplateFallback) return [];
          const templateObj = getTemplateObjForSeedRows_ACU();
          const tplRows = templateObj?.[sheetKey]?.content;
          if (Array.isArray(tplRows) && tplRows.length > 1) return ensureStableRowIdsForSeedRows_ACU(tplRows.slice(1));
          return [];
      } catch (e) {
          return [];
      }
  }

  export function attachSeedRowsToCurrentDataFromGuide_ACU(guideData: Record<string, any> | null) {
      try {
          if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') return false;
          const g = normalizeGuideData_ACU(guideData);
          if (!g) return false;
          let changed = false;
          Object.keys(currentJsonTableData_ACU).forEach(k => {
              if (!k.startsWith('sheet_')) return;
              const table = currentJsonTableData_ACU[k];
              if (!table || typeof table !== 'object') return;
              const existing = table?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU];
              if (Array.isArray(existing) && existing.length > 0) return;
              const sr = g?.[k]?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU];
              if (Array.isArray(sr) && sr.length > 0) {
                  table[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = ensureStableRowIdsForSeedRows_ACU(sr);
                  changed = true;
              }
          });
          return changed;
      } catch (e) {
          return false;
      }
  }

  // [新增] 用"当前数据"构建空白指导表：只保留表头行 + 参数（顺序由 getSortedSheetKeys_ACU 的旧逻辑决定，避免递归）
  export function buildChatSheetGuideDataFromData_ACU(dataObj: Record<string, any> | null, { preserveSeedRowsFromGuideData = null as Record<string, any> | null, seedRowsFromTemplateObj = null as Record<string, any> | null, orderedKeys = null as string[] | null } = {}) {
      if (!dataObj || typeof dataObj !== 'object') return null;
      const keys = Array.isArray(orderedKeys) && orderedKeys.length
          ? orderedKeys.filter(k => typeof k === 'string' && k.startsWith('sheet_') && dataObj[k])
          : getSortedSheetKeys_ACU(dataObj, { ignoreChatGuide: true });
      const out: any = { mate: { type: 'chatSheets', version: CHAT_SHEET_GUIDE_VERSION_ACU } };
      if (dataObj.mate && typeof dataObj.mate === 'object') {
          out.mate = JSON.parse(JSON.stringify(dataObj.mate));
      }
      out.mate.globalInjectionConfig = ensureGlobalInjectionConfigDefaults_ACU(out.mate.globalInjectionConfig);
      keys.forEach((k: string) => {
          const s = dataObj[k];
          if (!s) return;
          const headerRow = Array.isArray(s.content) && Array.isArray(s.content[0]) ? JSON.parse(JSON.stringify(s.content[0])) : ["row_id"];
          const blank: Record<string, any> = {
              uid: s.uid || k,
              name: s.name || k,
              sourceData: s.sourceData ? JSON.parse(JSON.stringify(s.sourceData)) : { note: '', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
              content: [headerRow],
              updateConfig: s.updateConfig ? JSON.parse(JSON.stringify(s.updateConfig)) : { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1, sendRowsSqlTemplate: '' },
              exportConfig: ensureExportConfigDefaults_ACU(
                  s.exportConfig ? JSON.parse(JSON.stringify(s.exportConfig)) : null,
                  s.name || k
              ),
          };
          // 需求4：结构/表名/参数变更时，仅更新指导表元信息，不修改"基础数据(seedRows)"
          const preserved = preserveSeedRowsFromGuideData?.[k]?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU];
          if (Array.isArray(preserved)) {
              blank[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = ensureStableRowIdsForSeedRows_ACU(preserved);
          } else {
              // 需求1：首次生成指导表时，把模板预置数据写入 seedRows（仅在未能从既有指导表继承时）
              const tplRows = seedRowsFromTemplateObj?.[k]?.content;
              if (Array.isArray(tplRows) && tplRows.length > 1) {
                  blank[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = ensureStableRowIdsForSeedRows_ACU(tplRows.slice(1));
              }
          }
          if (Number.isFinite(s?.[TABLE_ORDER_FIELD_ACU])) blank[TABLE_ORDER_FIELD_ACU] = Math.trunc(s[TABLE_ORDER_FIELD_ACU]);
          out[k] = blank;
      });
      return normalizeGuideData_ACU(out);
  }

  // [新增] 用"模板对象"构建空白指导表：只保留表头行 + 参数（模板已有顺序编号）
  export function buildChatSheetGuideDataFromTemplateObj_ACU(templateObj: Record<string, any> | null, { stripSeedRows = true } = {}) {
      if (!templateObj || typeof templateObj !== 'object') return null;
      const keys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
      if (keys.length === 0) return null;
      // 确保模板编号稳定（缺失则补齐）
      try { ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: keys, forceRebuild: false }); } catch (e) { logWarn_ACU('[Guide] ensureSheetOrderNumbers 失败:', e); }
      const sorted = keys.sort((a, b) => {
          const ao = Number.isFinite(templateObj?.[a]?.[TABLE_ORDER_FIELD_ACU]) ? Math.trunc(templateObj[a][TABLE_ORDER_FIELD_ACU]) : Infinity;
          const bo = Number.isFinite(templateObj?.[b]?.[TABLE_ORDER_FIELD_ACU]) ? Math.trunc(templateObj[b][TABLE_ORDER_FIELD_ACU]) : Infinity;
          if (ao !== bo) return ao - bo;
          return String(a).localeCompare(String(b));
      });
      const out: any = { mate: { type: 'chatSheets', version: CHAT_SHEET_GUIDE_VERSION_ACU } };
      if (templateObj.mate && typeof templateObj.mate === 'object') {
          out.mate = JSON.parse(JSON.stringify(templateObj.mate));
      }
      out.mate.globalInjectionConfig = ensureGlobalInjectionConfigDefaults_ACU(out.mate.globalInjectionConfig);
      sorted.forEach((k: string, idx: number) => {
          const base = JSON.parse(JSON.stringify(templateObj[k] || {}));
          base.uid = base.uid || k;
          base.name = base.name || k;
          if (!Array.isArray(base.content) || base.content.length === 0) base.content = [["row_id"]];
          // v2: 保存模板预置数据为 seedRows，但指导表本体 content 仍只保留表头
          if (Array.isArray(base.content) && base.content.length > 1) {
              base[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU] = ensureStableRowIdsForSeedRows_ACU(base.content.slice(1));
          }
          if (stripSeedRows && Array.isArray(base.content) && base.content.length > 1) base.content = [base.content[0]];
          if (!Number.isFinite(base[TABLE_ORDER_FIELD_ACU])) base[TABLE_ORDER_FIELD_ACU] = idx;
          out[k] = base;
      });
      return normalizeGuideData_ACU(out);
  }

  // [新增] 覆盖式更新：用模板写入当前聊天第一层"空白指导表"
  export async function overwriteChatSheetGuideFromTemplate_ACU(templateObj: Record<string, any> | null, { reason = 'template_changed', stripSeedRows = true, presetName = '', source = 'ui', syncTemplateScope = false, registerPreset = false } = {}) {
      const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(templateObj, { stripSeedRows });
      if (!guideData) return false;
      const isolationKey = getCurrentIsolationKey_ACU();
      const templateSnapshot = sanitizeTemplateSnapshotForChat_ACU(templateObj);
      const normalizedPresetName = deriveTemplatePresetNameForImport_ACU({ presetName });
      if (registerPreset && normalizedPresetName && templateSnapshot?.templateStr) {
          try {
              const savePresetOk = upsertTemplatePreset_ACU(normalizedPresetName, templateSnapshot.templateStr);
              if (!savePresetOk) {
                  logWarn_ACU(`[TemplateScope] 保存模板预设失败：${normalizedPresetName}`);
              }
          } catch (e) {
              logWarn_ACU('[TemplateScope] 保存模板预设失败:', e);
          }
      }
      const ok = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, guideData, {
          reason,
          syncTemplateScope,
          templateSource: templateSnapshot?.templateStr || templateObj,
          presetName: normalizedPresetName,
          source,
      });
      if (!ok) return false;
      if (syncTemplateScope) {
          try { applyTemplateScopeForCurrentChat_ACU(); } catch (e) { logWarn_ACU('[Guide] applyTemplateScope 失败:', e); }
      }
      try { await saveChatToHost_ACU(); } catch (e) { logWarn_ACU('[Guide] saveChatToHost 失败:', e); }
      try { await refreshMergedDataAndNotify_ACU(); } catch (e) {}
      return true;
  }

  // [表格顺序新机制] 获取表格 keys：
  // - 若当前聊天已存在"空白指导表"：优先按指导表的 orderNo 顺序（可过滤不在指导表里的表）
  // - 否则：按"编号(orderNo)从小到大"排序；缺编号则回退到模板编号/模板顺序
