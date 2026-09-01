/**
 * service/template/template-preset-service.ts — 模板预设业务逻辑
 *
 * 从 presentation/components/template-preset-ui.ts 真正搬入的纯数据/逻辑函数。
 * 不操作 DOM，不引用 $popupInstance_ACU / jQuery_API_ACU 等 UI 对象。
 */

import { STORAGE_KEY_TEMPLATE_PRESETS_ACU } from '../../shared/data-constants';
import { DEFAULT_TABLE_TEMPLATE_ACU, TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';
import { DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU, getCurrentTemplatePresetName_ACU, isDefaultTemplatePresetSelection_ACU, normalizeTemplatePresetSelectionValue_ACU } from '../../shared/template-preset-utils';
import { getConfigStorage_ACU } from '../../data/storage/tavern-storage';
import { saveCurrentProfileTemplate_ACU } from '../../data/repositories/profile-repo';
import { persistCurrentTemplatePresetName_ACU, saveSettings_ACU } from '../settings/settings-service';
import { applyTemplateScopeForCurrentChat_ACU } from '../settings/settings-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { buildChatSheetGuideDataFromData_ACU, buildChatSheetGuideDataFromTemplateObj_ACU, buildChatTemplateScopeStateFromCurrent_ACU, clearChatSheetGuideDataForIsolationKey_ACU, getChatSheetGuideDataForIsolationKey_ACU, getCurrentChatTemplateScopeState_ACU, getGlobalTemplateSnapshotForCurrentProfile_ACU, listChatTemplatePresetEntries_ACU, migrateLegacyTemplateScopeForCurrentChat_ACU, normalizeTemplateScopeIsolationKey_ACU, normalizeTemplateScopeMode_ACU, sanitizeChatSheetsObject_ACU, sanitizeTemplateSnapshotForChat_ACU, setCurrentChatTemplateScopeState_ACU } from '../template/chat-scope';
import { refreshMergedDataAndNotify_ACU } from '../worldbook/pipeline';
import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../shared/json-helpers';
import { ensureSheetOrderNumbers_ACU, logDebug_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { buildDefaultExportConfig_ACU, ensureExportConfigDefaults_ACU } from '../worldbook/injection-engine';
import {
    detectDisplayNameTranslationHazards_ACU,
    TemplateImportValidationError_ACU,
    type TemplateImportDiagnostic_ACU,
    validateImportedTemplateObject_ACU,
} from './template-import-validator';
import { allocateStableSheetKeys_ACU } from '../../shared/sheet-identity';
import { reconcileChatTemplate_ACU } from './chat-template-reconciler';
import { commitCurrentFloorTemplateChanges_ACU, commitCurrentFloorTemplateScopeOnly_ACU } from '../table/storage-frame-v2-persist';
import { deriveSheetLifecycleFromFramesV2_ACU, hasStructuralReplayCompatibilityRepairs_ACU, loadTableStateFromFramesV2Detailed_ACU, V2ReplayAbortedError_ACU } from '../table/storage-frame-v2-replay';
import type { TableSheetLifecycleProjectionV2_ACU } from '../table/storage-frame-v2-types';
import { resolveTableStorageStrategy_ACU } from '../table/storage-strategy-resolver';
import { resolveTemplateSwitchMode_ACU } from '../table/template-switch-mode-resolver';
import { captureTableRuntimeRevisionForWriteSet_ACU } from '../table/table-write-transaction';
import { getCurrentStorageMode, isSqliteMode } from '../table/storage-mode';
import { didSqliteFallbackAfterReload_ACU, reloadStorageProvider } from '../table/table-storage-strategy';
import { normalizeTemplateRowIds_ACU } from './template-row-id-normalizer';
import { abortableDelay } from '../../shared/abortable-delay';
import { notifyTemplateRuntimeCommitted_ACU } from '../../shared/template-runtime-change';
import {
  normalizeTemplateConflictPolicy_ACU,
  resolveDefaultTemplateDataMode_ACU,
  type TemplateDataMode_ACU,
  type TemplateImportDataOptions_ACU,
  type TemplateMergeConflictPolicy_ACU,
} from '../../shared/template-data-mode';
import { preflightTemplateDataImport_ACU } from './template-data-preflight';

// ═══ 预设存储 CRUD（内部辅助） ═══

function buildDefaultTemplatePresetsStore_ACU() {
    return { version: 1, presets: {} };
}

function loadTemplatePresetsStore_ACU() {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(STORAGE_KEY_TEMPLATE_PRESETS_ACU);
    const parsed = raw ? safeJsonParse_ACU(raw, null) : null;
    const base = buildDefaultTemplatePresetsStore_ACU();
    if (!parsed || typeof parsed !== 'object') return base;
    const out = { ...base, ...parsed };
    if (!out.presets || typeof out.presets !== 'object') out.presets = {};
    return out;
}

function saveTemplatePresetsStore_ACU(obj: any) {
    try {
        const store = getConfigStorage_ACU();
        store?.setItem?.(STORAGE_KEY_TEMPLATE_PRESETS_ACU, safeJsonStringify_ACU(obj, '{}'));
        return true;
    } catch (e) {
        logWarn_ACU('[TemplatePresets] Failed to save:', e);
        return false;
    }
}

// ═══ 预设 CRUD 导出函数 ═══

export function listTemplatePresetNames_ACU() {
    const s = loadTemplatePresetsStore_ACU();
    return Object.keys(s.presets || {}).sort((a, b) => String(a).localeCompare(String(b)));
}

export function getTemplatePreset_ACU(name: string) {
    const s = loadTemplatePresetsStore_ACU();
    const p = s?.presets?.[String(name || '')];
    return p && typeof p === 'object' ? p : null;
}

export function upsertTemplatePreset_ACU(nameRaw: string, templateStr: string) {
    const name = String(nameRaw || '').trim();
    if (!name) return false;
    const s = loadTemplatePresetsStore_ACU();
    s.presets = s.presets && typeof s.presets === 'object' ? s.presets : {};
    s.presets[name] = { templateStr: String(templateStr || ''), updatedAt: Date.now() };
    return saveTemplatePresetsStore_ACU(s);
}

export function deleteTemplatePreset_ACU(nameRaw: string) {
    const name = String(nameRaw || '').trim();
    if (!name) return false;
    const s = loadTemplatePresetsStore_ACU();
    if (!s.presets || typeof s.presets !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(s.presets, name)) return false;
    delete s.presets[name];
    return saveTemplatePresetsStore_ACU(s);
}

// ═══ 纯逻辑工具函数 ═══

export function getTemplatePresetDisplayName_ACU(presetName: string) {
    const normalizedName = normalizeTemplatePresetSelectionValue_ACU(presetName);
    return normalizedName || '默认预设';
}

export function resolveActiveTemplatePresetName_ACU({ fallbackToGlobal = true, isolationKey = getCurrentIsolationKey_ACU() } = {}) {
    const normalizedKey = String(isolationKey ?? '');
    const chatScopeState = getCurrentChatTemplateScopeState_ACU({ isolationKey: normalizedKey }) || migrateLegacyTemplateScopeForCurrentChat_ACU({ isolationKey: normalizedKey });
    const mode = normalizeTemplateScopeMode_ACU(chatScopeState?.mode);

    // chat_override / preset_link 一旦存在就拥有名称解析权：空 presetName 并不表示
    // “未选择”，而是聊天快照明确选择默认模板。若在此处按 truthiness 回退全局，
    // 下拉框、导出和可视化标签会把当前聊天误显示为旧全局命名预设。
    if (chatScopeState && (mode === 'chat_override' || mode === 'preset_link')) {
        return normalizeTemplatePresetSelectionValue_ACU(chatScopeState.presetName ?? '');
    }

    if (!fallbackToGlobal) return '';
    return getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false });
}

export function getActiveTemplatePresetMeta_ACU({ isolationKey = getCurrentIsolationKey_ACU() } = {}) {
    const normalizedKey = String(isolationKey ?? '');
    const chatScopeState = getCurrentChatTemplateScopeState_ACU({ isolationKey: normalizedKey }) || migrateLegacyTemplateScopeForCurrentChat_ACU({ isolationKey: normalizedKey });
    const normalizedMode = normalizeTemplateScopeMode_ACU(chatScopeState?.mode);
    const effectivePresetName = normalizeTemplatePresetSelectionValue_ACU(
        resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey: normalizedKey }),
    );
    const scope = (normalizedMode === 'chat_override' || normalizedMode === 'preset_link') ? 'chat' : 'global';
    return {
        presetName: effectivePresetName,
        displayName: getTemplatePresetDisplayName_ACU(effectivePresetName),
        mode: normalizedMode,
        scope,
        scopeLabel: scope === 'chat' ? '当前聊天' : '全局',
    };
}

export function ensureUniqueTemplatePresetName_ACU(baseNameRaw: string) {
    const baseName = String(baseNameRaw || '').trim();
    if (!baseName) return '';
    const names = new Set(listTemplatePresetNames_ACU().map(n => String(n)));
    if (!names.has(baseName)) return baseName;
    for (let i = 2; i <= 99; i++) {
        const candidate = `${baseName} (${i})`;
        if (!names.has(candidate)) return candidate;
    }
    return `${baseName} (${Date.now()})`;
}

export function normalizeTemplateOperationScope_ACU(scope: string) {
    return scope === 'chat' ? 'chat' : 'global';
}

export function normalizeTemplateForPresetSave_ACU() {
    const obj = parseTableTemplateJson_ACU({ stripSeedRows: false });
    if (!obj || typeof obj !== 'object') return null;
    try {
        const sheetKeys = Object.keys(obj).filter(k => k.startsWith('sheet_'));
        ensureSheetOrderNumbers_ACU(obj, { baseOrderKeys: sheetKeys, forceRebuild: false });
    } catch (e) { logWarn_ACU('[模板预设] normalizeTemplateForPresetSave: 排序号处理失败:', e); }
    const sanitized = sanitizeChatSheetsObject_ACU(obj, { ensureMate: true });
    const str = safeJsonStringify_ACU(sanitized, '');
    if (!str) return null;
    return { templateObj: sanitized, templateStr: str };
}

export function getDefaultTemplateSnapshot_ACU() {
    const previousTemplate = TABLE_TEMPLATE_ACU;
    let snapshot = sanitizeTemplateSnapshotForChat_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
    if (snapshot?.templateStr) {
        return snapshot;
    }

    try {
        _set_TABLE_TEMPLATE_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
        const parsedTemplate = parseTableTemplateJson_ACU({ stripSeedRows: false });
        snapshot = sanitizeTemplateSnapshotForChat_ACU(parsedTemplate);
    } catch (e) {
        snapshot = null;
    } finally {
        _set_TABLE_TEMPLATE_ACU(previousTemplate);
    }

    return snapshot || sanitizeTemplateSnapshotForChat_ACU(previousTemplate);
}

/**
 * 解析当前内存运行时模板（TABLE_TEMPLATE_ACU）为可导出的快照。
 *
 * 与「保存」路径 normalizeTemplateForPresetSave_ACU 对齐：parse → 补顺序号 → sanitize。
 * 解析失败返回 null，绝不静默回落到默认模板——否则会把「运行时损坏」伪装成「运行时正常」。
 * 纯函数：不写任何存储，不触发 notifyTemplateRuntimeCommitted_ACU。
 */
export function getRuntimeTemplateSnapshot_ACU() {
    const obj = parseTableTemplateJson_ACU({ stripSeedRows: false });
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    try {
        const sheetKeys = Object.keys(obj).filter(k => k.startsWith('sheet_'));
        ensureSheetOrderNumbers_ACU(obj, { baseOrderKeys: sheetKeys, forceRebuild: false });
    } catch (e) { logWarn_ACU('[模板预设] getRuntimeTemplateSnapshot: 排序号处理失败:', e); }
    const sanitized = sanitizeTemplateSnapshotForChat_ACU(obj);
    if (!sanitized?.templateStr || !sanitized?.templateObj) return null;
    return sanitized;
}

/**
 * 推导模板携带数据语义：
 * - 显式 dataMode 优先；
 * - 未显式指定时按模板是否带数据、目标 runtime 是否已有数据推导（兼容旧调用）。
 */
function resolveImportDataMode_ACU(templateData: any, options: TemplateImportDataOptions_ACU | undefined): {
    dataMode: TemplateDataMode_ACU;
    conflictPolicy: TemplateMergeConflictPolicy_ACU;
} {
    const conflictPolicy = normalizeTemplateConflictPolicy_ACU(options?.conflictPolicy);
    const explicitMode = options?.dataMode;
    if (explicitMode === 'replace' || explicitMode === 'merge' || explicitMode === 'seed') {
        return { dataMode: explicitMode, conflictPolicy };
    }
    const sheetKeys = Object.keys(templateData || {}).filter(k => k.startsWith('sheet_'));
    const templateHasData = sheetKeys.some(key => {
        const sheet = templateData?.[key];
        const content = Array.isArray(sheet?.content) ? sheet.content : [];
        const seedRows = Array.isArray(sheet?.seedRows) ? sheet.seedRows : [];
        return content.length > 1 || seedRows.length > 0;
    });
    const dataMode = resolveDefaultTemplateDataMode_ACU({
        templateHasData,
        runtimeHasData: false, // 解析阶段不读 runtime；实际 runtime 语义由提交链在 D 阶段判定
    });
    return { dataMode, conflictPolicy };
}

export function parseImportedTemplateData_ACU(templateData: any, importOptions?: TemplateImportDataOptions_ACU) {
    let jsonData;

    if (typeof templateData === 'string') {
        try {
            jsonData = JSON.parse(templateData);
        } catch (parseError) {
            throw new Error(`JSON解析错误: ${parseError.message}`);
        }
    } else if (typeof templateData === 'object' && templateData !== null) {
        jsonData = JSON.parse(JSON.stringify(templateData));
    } else {
        throw new Error('无效的模板数据：必须是 JSON 对象或 JSON 字符串');
    }

    if (!jsonData.mate || !jsonData.mate.type || jsonData.mate.type !== 'chatSheets') {
        throw new Error('缺少 "mate" 对象或 "type" 属性不正确。模板必须包含 `"mate": {"type": "chatSheets", ...}`。');
    }

    const sheetKeys = Object.keys(jsonData).filter(k => k.startsWith('sheet_'));
    if (sheetKeys.length === 0) {
        throw new Error('模板中未找到任何表格数据 (缺少 "sheet_..." 键)。');
    }

    // 在结构校验通过后推导数据模式（模板带数据与否此时才可证明）
    const { dataMode, conflictPolicy } = resolveImportDataMode_ACU(jsonData, importOptions);

    for (const key of sheetKeys) {
        const sheet = jsonData[key];
        if (!sheet.name || !sheet.content || !sheet.sourceData || !Array.isArray(sheet.content)) {
            throw new Error(`表格 "${key}" 结构不完整，缺少 "name"、"content" 或 "sourceData" 关键属性。`);
        }
    }

    const normalization = normalizeTemplateRowIds_ACU(jsonData, {
        syncDdl: getCurrentStorageMode() === 'sqlite',
        // 外部模板导入：content 与 seedRows 完全相同的行自动去重（content 优先），
        // 使截图对应的早期入口在抛 TemplateImportValidationError_ACU 前完成安全过滤。
        deduplicateIdenticalCrossSourceRows: true,
    });
    if (normalization.blockers.length > 0) {
        const diagnostics: TemplateImportDiagnostic_ACU[] = normalization.blockers.map(issue => ({
            code: issue.code === 'misplaced_row_id' ? 'misplaced_row_id' : 'invalid_header_row',
            sheetKey: issue.sheetKey, sheetName: issue.sheetName, message: issue.message,
            columnIndex: issue.columnIndex,
        }));
        throw new TemplateImportValidationError_ACU(diagnostics);
    }
    jsonData = normalization.templateData;
    const importDiagnostics = validateImportedTemplateObject_ACU(jsonData);
    if (importDiagnostics.length > 0) {
        throw new TemplateImportValidationError_ACU(importDiagnostics);
    }
    const translationWarnings = detectDisplayNameTranslationHazards_ACU(jsonData);
    for (const warning of translationWarnings) {
        logWarn_ACU(`[模板预设] SQL 展示名翻译风险：${warning.message}`);
    }

    try {
        if (!jsonData.mate || typeof jsonData.mate !== 'object') jsonData.mate = { type: 'chatSheets', version: 1 };
        if (jsonData.mate.updateConfigUiSentinel !== -1) {
            const sheetKeys2 = Object.keys(jsonData).filter(k => k.startsWith('sheet_'));
            for (const k of sheetKeys2) {
                const s = jsonData[k];
                const uc = s && typeof s === 'object' ? s.updateConfig : null;
                if (!uc || typeof uc !== 'object') continue;
                if (uc.uiSentinel !== -1) uc.uiSentinel = -1;
                for (const field of ['contextDepth', 'updateFrequency', 'batchSize', 'skipFloors']) {
                    if (Object.prototype.hasOwnProperty.call(uc, field) && uc[field] === 0) uc[field] = -1;
                }
            }
            jsonData.mate.updateConfigUiSentinel = -1;
        }
    } catch (e) { logWarn_ACU('[模板预设] applyTemplatePreset: updateConfig 迁移失败:', e); }

    ensureSheetOrderNumbers_ACU(jsonData, { baseOrderKeys: sheetKeys, forceRebuild: false });
    const sanitized = sanitizeChatSheetsObject_ACU(jsonData, { ensureMate: true });
    const snapshot = sanitizeTemplateSnapshotForChat_ACU(sanitized);
    if (!snapshot?.templateStr || !snapshot?.templateObj) {
        throw new Error('模板结构无效，无法生成模板快照。');
    }

    const deduplication = normalization.audits
        .filter(audit => audit.deduplicatedSeedRows.length > 0)
        .map(audit => ({
            sheetKey: audit.sheetKey,
            sheetName: audit.sheetName,
            removedCount: audit.deduplicatedSeedRows.length,
            rowIds: audit.deduplicatedSeedRows.map(item => item.rowId),
        }));

    return {
        snapshot,
        templateObj: snapshot.templateObj,
        templateStr: snapshot.templateStr,
        dataMode,
        conflictPolicy,
        // 跨 content/seedRows 完全重复去重审计（content 优先），供导入结果与日志追踪。
        deduplication,
    };
}

/**
 * merge 模式：把 preflight 的显式合并计划应用到协调后的 candidateData。
 * - insertRowIds：模板新增行追加到候选表（业务键未命中既有行）。
 * - overrideRowIds：conflictPolicy=template-wins 时，模板行覆盖既有行（业务键命中但值取模板）。
 * - matchedRowIds（keep-current）：保留 runtime 行，不写模板行。
 * 所有追加行都保留模板行原样（row_id 已由规范化器分配，业务值取模板）。
 */
function applyMergePlanToCandidate_ACU(
    candidateData: Record<string, any>,
    templateData: Record<string, any>,
    mergePlan: Record<string, import('./template-data-preflight').TemplateSheetMergePlan_ACU>,
): void {
    for (const [sheetKey, plan] of Object.entries(mergePlan)) {
        const candidateSheet = candidateData?.[sheetKey];
        const templateSheet = templateData?.[sheetKey];
        if (!candidateSheet || typeof candidateSheet !== 'object' || !templateSheet || typeof templateSheet !== 'object') continue;
        const candidateContent = Array.isArray(candidateSheet.content) ? candidateSheet.content : [];
        const templateContent = Array.isArray(templateSheet.content) ? templateSheet.content : [];
        if (candidateContent.length === 0 || templateContent.length === 0) continue;
        const headerWidth = Array.isArray(candidateContent[0]) ? candidateContent[0].length : 0;
        const templateRowByRowId = new Map<string, unknown[]>();
        for (const row of templateContent.slice(1)) {
            if (!Array.isArray(row)) continue;
            const rowId = String(row[0] ?? '').trim();
            if (rowId) templateRowByRowId.set(rowId, row);
        }
        // 插入行：业务键未命中 → 追加模板行（补齐到表头宽度）
        for (const rowId of plan.insertRowIds) {
            const templateRow = templateRowByRowId.get(rowId);
            if (!templateRow) continue;
            const cells = [...templateRow];
            while (cells.length < headerWidth) cells.push(null);
            candidateContent.push(cells);
        }
        // 覆盖行：template-wins → 用模板行替换既有行（按 row_id 匹配）
        if (plan.overrideRowIds.length > 0) {
            const candidateRowIndexById = new Map<string, number>();
            for (let index = 1; index < candidateContent.length; index += 1) {
                const row = candidateContent[index];
                if (!Array.isArray(row)) continue;
                const rowId = String(row[0] ?? '').trim();
                if (rowId) candidateRowIndexById.set(rowId, index);
            }
            for (const rowId of plan.overrideRowIds) {
                const templateRow = templateRowByRowId.get(rowId);
                if (!templateRow) continue;
                const index = candidateRowIndexById.get(rowId);
                if (index === undefined) continue; // 既有行不存在则不覆盖
                const cells = [...templateRow];
                while (cells.length < headerWidth) cells.push(null);
                candidateContent[index] = cells;
            }
        }
    }
}

// ═══ 模板作用域持久化（纯数据操作） ═══

export function persistTemplateScopeSelectionState_ACU(presetName: string, { source = 'ui', updateGlobal = false, save = true, persistChatScope = undefined as boolean | undefined, templateSource = null as any, guideData = null as any, archivePreviousChatScope = false, scopeMode = undefined as string | undefined, registerChatPresetEntry = undefined as boolean | undefined } = {}) {
    const _persistChatScope = persistChatScope ?? !updateGlobal;
    const _scopeMode = scopeMode ?? (_persistChatScope ? 'chat_override' : 'inherit_global');
    void archivePreviousChatScope;
    void registerChatPresetEntry;
    const normalizedPresetName = normalizeTemplatePresetSelectionValue_ACU(presetName);
    let shouldSaveSettings = false;
    let shouldSaveChat = false;

    if (updateGlobal) {
        persistCurrentTemplatePresetName_ACU(settings_ACU, normalizedPresetName, { save: false });
        shouldSaveSettings = true;
    } else if (_persistChatScope) {
        const normalizedKey = normalizeTemplateScopeIsolationKey_ACU(getCurrentIsolationKey_ACU());
        const normalizedScopeMode = normalizeTemplateScopeMode_ACU(_scopeMode);
        let templateState = null;

        if (normalizedScopeMode === 'chat_override' || normalizedScopeMode === 'preset_link') {
            const presetSnapshot = normalizedPresetName
                ? sanitizeTemplateSnapshotForChat_ACU(getTemplatePreset_ACU(normalizedPresetName)?.templateStr || null)
                : getDefaultTemplateSnapshot_ACU();
            const resolvedTemplateSource = templateSource || presetSnapshot?.templateStr || getGlobalTemplateSnapshotForCurrentProfile_ACU()?.templateStr || DEFAULT_TABLE_TEMPLATE_ACU;
            templateState = buildChatTemplateScopeStateFromCurrent_ACU({
                isolationKey: normalizedKey,
                presetName: normalizedPresetName,
                source,
                originGlobalName: getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false }),
                originGlobalRevision: 0,
                updatedAt: Date.now(),
                templateSource: resolvedTemplateSource,
                guideData,
            });
        } else {
            templateState = { mode: 'inherit_global' };
        }

        if (templateState) {
            setCurrentChatTemplateScopeState_ACU(templateState, {
                isolationKey: normalizedKey,
                reason: `template_scope_${source}`,
            });
            try {
                clearChatSheetGuideDataForIsolationKey_ACU({ isolationKey: normalizedKey });
            } catch (e) {}
            shouldSaveChat = true;
        }
    }

    if (save) {
        if (shouldSaveSettings) {
            saveSettings_ACU();
        }
        if (shouldSaveChat) {
            Promise.resolve()
                .then(() => saveChatToHost_ACU())
                .catch(error => logWarn_ACU('[TemplateScope] 保存聊天级模板状态失败:', error));
        }
    }

    return normalizedPresetName;
}

// ═══ 模板应用（纯业务逻辑，不做 UI 刷新） ═══

/**
 * 协调提交固定写 chat_override 快照；"跟随全局"类语义要求提交成功后把 scope
 * 翻回 inherit_global。刻意不走 persistTemplateScopeSelectionState_ACU 的
 * inherit_global 分支——那条路会顺带清除协调刚写入的聊天指导表。
 * saveChatToHost 失败只降级为警告：容器已在内存更新，将随下次保存落盘。
 */
async function flipCurrentChatScopeToInheritGlobal_ACU(reason: string): Promise<void> {
    setCurrentChatTemplateScopeState_ACU({ mode: 'inherit_global' }, {
        isolationKey: normalizeTemplateScopeIsolationKey_ACU(getCurrentIsolationKey_ACU()),
        reason,
    });
    try {
        await saveChatToHost_ACU();
    } catch (error) {
        logWarn_ACU('[TemplateScope] scope 翻转 inherit_global 后保存聊天失败（容器已在内存更新，将随下次保存落盘）:', error);
    }
}

export async function applyTemplateSnapshotToScope_ACU(templateSource: any, { scope = 'global', source = 'ui', presetName = '', save = true, persistChatScope = null as boolean | null, registerChatPresetEntry = null as boolean | null, destructiveChangeConfirmed = false, signal = undefined as AbortSignal | undefined } = {}) {
    const normalizedScope = normalizeTemplateOperationScope_ACU(scope);
    const snapshot = sanitizeTemplateSnapshotForChat_ACU(templateSource);
    if (!snapshot?.templateStr || !snapshot?.templateObj) return false;

    if (normalizedScope === 'chat') {
        return applyChatTemplateSnapshotWithReconciliation_ACU(snapshot.templateObj, {
            source,
            presetName,
            destructiveChangeConfirmed,
            signal,
        });
    }

    const normalizedPresetName = normalizeTemplatePresetSelectionValue_ACU(presetName);
    const updateGlobal = normalizedScope === 'global';
    const effectivePersistChatScope = persistChatScope === null ? !updateGlobal : !!persistChatScope;
    void registerChatPresetEntry;

    // ═══ S1-3：全局切换若影响当前聊天生效模板，强制走协调器 ═══
    // 当前聊天无 chat scope 状态（inherit_global 生效中）且聊天非空时，全局模板
    // 就是当前聊天的生效模板；直接替换 TABLE_TEMPLATE 会绕过 hide checkpoint、
    // 列级隐藏与破坏性确认，导致运行时结构与 V2 历史脱节。此处先经协调器提交
    // 当前聊天，失败（含 blockers）则原样返回且不碰任何全局状态（fail-closed）；
    // 空聊天或存在 chat_override/preset_link 的聊天不受全局切换影响，走轻路径。
    let reconciledForGlobalSwitch: any = null;
    if (updateGlobal) {
        const chatForGlobalSwitch = getChatArray_ACU();
        const globalAffectsCurrentChat = Array.isArray(chatForGlobalSwitch)
            && chatForGlobalSwitch.length > 0
            && !getCurrentChatTemplateScopeState_ACU();
        if (globalAffectsCurrentChat) {
            reconciledForGlobalSwitch = await applyChatTemplateSnapshotWithReconciliation_ACU(snapshot.templateObj, {
                source,
                presetName: normalizedPresetName,
                destructiveChangeConfirmed,
                signal,
            });
            if (!reconciledForGlobalSwitch || reconciledForGlobalSwitch.saved !== true) {
                return reconciledForGlobalSwitch || false;
            }
        }
    }

    _set_TABLE_TEMPLATE_ACU(snapshot.templateStr);
    if (updateGlobal) {
        saveCurrentProfileTemplate_ACU(TABLE_TEMPLATE_ACU, settings_ACU);
    }
    if (reconciledForGlobalSwitch) {
        // 协调提交写了 chat_override；全局切换语义下当前聊天仍应跟随全局。
        await flipCurrentChatScopeToInheritGlobal_ACU('template_scope_global_switch_reconcile');
    }

    const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(snapshot.templateObj, { stripSeedRows: false });
    persistTemplateScopeSelectionState_ACU(normalizedPresetName, {
        source,
        updateGlobal,
        save,
        persistChatScope: effectivePersistChatScope,
        templateSource: snapshot.templateStr,
        guideData,
        scopeMode: effectivePersistChatScope ? 'chat_override' : 'inherit_global',
        registerChatPresetEntry: false,
    });
    applyTemplateScopeForCurrentChat_ACU();

    try { await refreshMergedDataAndNotify_ACU(); } catch (e) {}
    notifyTemplateRuntimeCommitted_ACU();
    return {
        saved: true as const,
        scope: normalizedScope,
        presetName: normalizedPresetName,
        templateStr: snapshot.templateStr,
        templateObj: snapshot.templateObj,
        ...(reconciledForGlobalSwitch ? {
            reconciledCurrentChat: true,
            ...('runtimeReady' in reconciledForGlobalSwitch ? { runtimeReady: reconciledForGlobalSwitch.runtimeReady } : {}),
            ...(typeof reconciledForGlobalSwitch.postCommitWarning === 'string' && reconciledForGlobalSwitch.postCommitWarning
                ? { postCommitWarning: reconciledForGlobalSwitch.postCommitWarning }
                : {}),
        } : {}),
    };
}

type ChatStorageWaitResult_ACU =
    | { status: 'ready'; identity: string }
    | { status: 'switched' }
    | { status: 'aborted' }
    | { status: 'timeout' };

function getChatContextSnapshot_ACU() {
    const chat = getChatArray_ACU();
    return {
        chat,
        firstMessage: Array.isArray(chat) ? chat[0] : undefined,
        identity: getActiveChatStorageIdentity_ACU(chat),
    };
}

function chatContextMatches_ACU(expectedIdentity: string, expectedFirstMessage: unknown): boolean {
    const current = getChatContextSnapshot_ACU();
    if (expectedFirstMessage && current.firstMessage !== expectedFirstMessage) return false;
    return !expectedIdentity || current.identity === expectedIdentity;
}

async function waitForActiveChatStorageContext_ACU({
    expectedIdentity,
    expectedFirstMessage,
    signal,
    timeoutMs = 3000,
    pollIntervalMs = 100,
}: {
    expectedIdentity: string;
    expectedFirstMessage: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
    pollIntervalMs?: number;
}): Promise<ChatStorageWaitResult_ACU> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (signal?.aborted) return { status: 'aborted' };
        const current = getChatContextSnapshot_ACU();
        if (expectedFirstMessage && current.firstMessage !== expectedFirstMessage) return { status: 'switched' };
        if (expectedIdentity && current.identity && current.identity !== expectedIdentity) return { status: 'switched' };
        if (current.identity) return { status: 'ready', identity: current.identity };
        await abortableDelay(pollIntervalMs, signal);
    }
    if (signal?.aborted) return { status: 'aborted' };
    const current = getChatContextSnapshot_ACU();
    if (expectedFirstMessage && current.firstMessage !== expectedFirstMessage) return { status: 'switched' };
    if (expectedIdentity && current.identity && current.identity !== expectedIdentity) return { status: 'switched' };
    return current.identity ? { status: 'ready', identity: current.identity } : { status: 'timeout' };
}

/**
 * A pristine chat has no persisted sheet identity to preserve. Rebuild every sheet key from
 * its display name before the first checkpoint so legacy/random template keys do not become
 * permanent identities for a newly created or fully-cleared chat.
 */
function rekeyTemplateForPristineChat_ACU(templateData: Record<string, any>): Record<string, any> {
    const sheetEntries = Object.entries(templateData).filter(([key]) => key.startsWith('sheet_'));
    const malformedSheetKey = sheetEntries.find(([, sheet]) => !sheet || typeof sheet !== 'object' || Array.isArray(sheet))?.[0];
    if (malformedSheetKey) {
        throw new Error(`无法为无数据聊天重新分配稳定表 key：模板表结构无效：${malformedSheetKey}`);
    }
    const allocation = allocateStableSheetKeys_ACU(sheetEntries.map(([, sheet]: [string, any]) => sheet.name));
    if (allocation.diagnostics.length > 0 || allocation.keys.some(key => !key)) {
        const details = allocation.diagnostics.map(item => `${item.code}: ${item.originalName || '(空表名)'}`).join('；');
        throw new Error(`无法为无数据聊天重新分配稳定表 key${details ? `：${details}` : '。'}`);
    }

    const keyMap = new Map<string, string>();
    sheetEntries.forEach(([oldKey], index) => keyMap.set(oldKey, allocation.keys[index]!));
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(templateData)) {
        if (!key.startsWith('sheet_')) {
            result[key] = JSON.parse(JSON.stringify(value));
            continue;
        }
        const nextKey = keyMap.get(key);
        if (!nextKey) continue;
        const nextSheet = JSON.parse(JSON.stringify(value));
        nextSheet.uid = nextKey;
        result[nextKey] = nextSheet;
    }
    return result;
}

/**
 * Applies a chat template through the only V2 template commit entrypoint.  Do not
 * replace this with scope-only writes: doing so discards the replay/transaction
 * contract and silently bypasses schema migration and destructive-change checks.
 */
const activeChatTemplateReconciliations_ACU = new Map<string, Promise<unknown>>();
let templateReconciliationSequence_ACU = 0;

function createTemplateReconciliationRequestId_ACU(): string {
    templateReconciliationSequence_ACU += 1;
    return `template-reconcile-${Date.now().toString(36)}-${templateReconciliationSequence_ACU.toString(36)}`;
}

async function loadConsistentTemplateBaseline_ACU(isolationKey: string, signal?: AbortSignal): Promise<{
    baselineData: any;
    baseRevision: string;
    lifecycle: TableSheetLifecycleProjectionV2_ACU | null;
} | { error: string }> {
    // 结构协调的 snapshot 与提交 revision 必须来自同一逻辑时点。
    // 旧实现先 replay、协调，最后才取 revision；期间发生的写入会让旧计划伪装成新计划。
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (signal?.aborted) return { error: '模板提交已取消。' };
        const beforeRevision = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }], { isolationKey });
        // 阶段 I：把 signal 交给 replay 本身。长历史冷回放需数秒，此前只能在
        // replay 前后检查取消，期间用户切聊天/取消只能干等；现在可在 frame/entry
        // 边界中断。abort 必须转换成既有 { error } 契约上报，不得向上抛——本函数
        // 的调用方按返回值分支处理，抛出会绕过它们的取消提示与状态复位。
        let replay: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>>;
        try {
            replay = await loadTableStateFromFramesV2Detailed_ACU(undefined, isolationKey, {
                updateRuntimeState: false,
                ...(signal ? { signal } : {}),
            });
        } catch (error) {
            if (error instanceof V2ReplayAbortedError_ACU) return { error: '模板提交已取消。' };
            throw error;
        }
        if (signal?.aborted) return { error: '模板提交已取消。' };
        if (hasStructuralReplayCompatibilityRepairs_ACU(replay?.compatibilityRepairs)) {
            const affectedSheetKeys = [...new Set((replay.compatibilityRepairs || []).map(item => item.sheetKey))];
            return { error: `当前 V2 历史存在结构性兼容修复（${affectedSheetKeys.join('、') || '未知 Sheet'}）；请先在数据管理中完成 V2 恢复，再切换模板。` };
        }
        // provisional temporary_sheet_anchor 将由 commitCurrentFloorTemplateChanges_ACU
        // 与本次模板变更在同一候选提交内收敛，不能在读取入口提前阻断。
        const baselineData = replay?.data ?? null;
        const afterRevision = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }], { isolationKey });
        if (beforeRevision === afterRevision) {
            // 同一逻辑时点派生只读生命周期投影：hidden/active/indeterminate 供协调层显式消费。
            // 生命周期派生失败（chat 不可用等）时返回 null，协调层退回基线猜测兼容路径。
            let lifecycle: TableSheetLifecycleProjectionV2_ACU | null = null;
            try {
                const chat = getChatArray_ACU();
                if (Array.isArray(chat)) lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, isolationKey);
            } catch { lifecycle = null; }
            return { baselineData, baseRevision: beforeRevision, lifecycle };
        }
    }
    return { error: '当前表格状态在读取模板基线时发生变化，请稍后重试。' };
}

async function applyChatTemplateSnapshotWithReconciliationInternal_ACU(templateData: any, {
    source = 'ui',
    presetName = '',
    dataMode,
    conflictPolicy,
    destructiveChangeConfirmed = false,
    hardDeleteMissingSheets = false,
    signal,
    requestId = createTemplateReconciliationRequestId_ACU(),
}: {
    source?: string;
    presetName?: string;
    dataMode?: TemplateDataMode_ACU;
    conflictPolicy?: TemplateMergeConflictPolicy_ACU;
    destructiveChangeConfirmed?: boolean;
    /**
     * 目标模板缺失的既有表默认隐藏保留。仅当调用方确实要跨全历史硬删该表数据时才置 true，
     * 且必须同时提供 destructiveChangeConfirmed，否则协调层会以 blocker 拒绝。
     */
    hardDeleteMissingSheets?: boolean;
    signal?: AbortSignal;
    requestId?: string;
} = {}) {
    const snapshot = sanitizeTemplateSnapshotForChat_ACU(templateData);
    if (!snapshot?.templateObj) return { saved: false, error: '模板结构无效，无法生成聊天模板提交。' };

    const entryContext = getChatContextSnapshot_ACU();
    if (!entryContext.firstMessage) {
        return { saved: false, error: '当前没有可绑定的目标聊天，已取消模板提交。' };
    }
    const chatStorageWait = await waitForActiveChatStorageContext_ACU({ expectedIdentity: entryContext.identity, expectedFirstMessage: entryContext.firstMessage, signal });
    if (chatStorageWait.status === 'switched') return { saved: false, error: '目标聊天已切换，已取消模板提交。' };
    if (chatStorageWait.status === 'aborted') return { saved: false, error: '模板提交已取消。' };
    if (chatStorageWait.status === 'timeout') return { saved: false, error: '当前聊天元数据尚未就绪，请等待聊天加载完成后重试。' };
    const targetChatIdentity = chatStorageWait.identity;
    const readyContext = getChatContextSnapshot_ACU();
    if (readyContext.firstMessage !== entryContext.firstMessage || readyContext.identity !== targetChatIdentity) {
        return { saved: false, error: '目标聊天已切换，已取消模板提交。' };
    }

    const isolationKey = getCurrentIsolationKey_ACU();
    const storageStrategy = resolveTableStorageStrategy_ACU(readyContext.chat, isolationKey, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
    });
    let targetTemplateData = snapshot.templateObj;
    let pristineChat = false;
    const switchMode = resolveTemplateSwitchMode_ACU(readyContext.chat, isolationKey);
    if (switchMode.mode === 'blocked') {
        return { saved: false, error: switchMode.reason };
    }
    if (switchMode.mode === 'pristine') {
        try {
            targetTemplateData = rekeyTemplateForPristineChat_ACU(snapshot.templateObj);
            pristineChat = true;
        } catch (error) {
            return { saved: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    let baselineData: any;
    let baseRevision: string | null = null;
    let lifecycle: TableSheetLifecycleProjectionV2_ACU | null | undefined;
    if (!chatContextMatches_ACU(targetChatIdentity, entryContext.firstMessage)) {
        return { saved: false, error: '目标聊天已切换，已取消模板提交。' };
    }
    try {
        const baselineSnapshot = await loadConsistentTemplateBaseline_ACU(isolationKey, signal);
        if ('error' in baselineSnapshot) return { saved: false, error: baselineSnapshot.error };
        baselineData = baselineSnapshot.baselineData;
        baseRevision = baselineSnapshot.baseRevision;
        lifecycle = baselineSnapshot.lifecycle;
        logDebug_ACU(`[TemplateScope] 模板协调基线已读取: requestId=${requestId}, source=v2_replay, baseRevision=${baseRevision}, isolationKey=${isolationKey}`);
    } catch (error) {
        return { saved: false, error: `无法读取当前聊天 V2 replay 基线：${error instanceof Error ? error.message : String(error)}` };
    }
    if (pristineChat) {
        baselineData = { mate: JSON.parse(JSON.stringify(targetTemplateData.mate || { type: 'chatSheets', version: 1 })) };
    } else if (!baselineData || typeof baselineData !== 'object') {
        if (storageStrategy.mode === 'v2') {
            return { saved: false, error: '当前聊天 V2 replay 基线不可用，已拒绝基于运行时缓存执行结构性模板切换。请先完成恢复诊断后重试。' };
        }
        // legacy 迁移分支仍由提交层作最终 fail-closed 判定；此处只保留既有迁移入口，
        // 不允许 V2 聊天把非权威 runtime 缓存当作结构协调基线。
        baselineData = currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object'
            ? JSON.parse(JSON.stringify(currentJsonTableData_ACU))
            : { mate: { type: 'chatSheets', version: 1 } };
    }

    // ═══ 阶段 D：seed 模式下，模板 content 数据行不得进入 candidateData（runtime 保持空），
    // 数据只落到 guide seedRows 作为待初始化种子（计划 D3）。
    // 因此把模板数据行从 content 剥离到 seedRows 字段，再交给协调层：
    // introduced 表因此是 header-only，matched 表在"旧表无数据"时也不采用模板行。
    const effectiveDataMode = dataMode === 'replace' || dataMode === 'merge' || dataMode === 'seed'
        ? dataMode
        : 'seed';
    let reconcileTemplateData = targetTemplateData;
    if (effectiveDataMode === 'seed' && targetTemplateData && typeof targetTemplateData === 'object') {
        reconcileTemplateData = JSON.parse(JSON.stringify(targetTemplateData));
        for (const sheetKey of Object.keys(reconcileTemplateData).filter(k => k.startsWith('sheet_'))) {
            const sheet = reconcileTemplateData[sheetKey];
            if (!sheet || typeof sheet !== 'object') continue;
            const content = Array.isArray(sheet.content) ? sheet.content : [];
            if (content.length > 1) {
                const headerRow = content[0];
                const dataRows = content.slice(1);
                const existingSeedRows = Array.isArray(sheet.seedRows) ? sheet.seedRows : [];
                sheet.seedRows = [...existingSeedRows, ...dataRows];
                sheet.content = [headerRow];
            }
        }
    }

    const storageMode = getCurrentStorageMode();
    let plan;
    try {
        plan = await reconcileChatTemplate_ACU({
            baselineData,
            templateData: reconcileTemplateData,
            destructiveChangeConfirmed,
            hardDeleteMissingSheets,
            lifecycle: lifecycle ?? undefined,
            storageMode,
        });
    } catch (error) {
        return { saved: false, error: `模板协调失败：${error instanceof Error ? error.message : String(error)}` };
    }
    if (plan.blockers.length > 0) {
        return { saved: false, blockers: plan.blockers, error: plan.blockers.join('；') };
    }
    // ═══ 阶段 D：merge 模式显式合并（计划 D2）═══
    // 使用 replay 基线生成候选后，按 DDL UNIQUE 业务键把模板行合并进 candidateData：
    // 未命中 → 插入；命中且 template-wins → 覆盖；命中且 keep-current → 保留 runtime；
    // 命中且 reject → preflight 已返回 blocker，直接拒绝提交。
    if (effectiveDataMode === 'merge') {
        const preflight = preflightTemplateDataImport_ACU({
            templateData: targetTemplateData,
            runtimeData: baselineData,
            dataMode: 'merge',
            conflictPolicy,
        });
        if (!preflight.ok) {
            return {
                saved: false,
                blockers: preflight.blockers.map(item => item.message),
                error: preflight.blockers.map(item => item.message).join('；'),
                importAudit: preflight.audits,
            };
        }
        if (preflight.mergePlan && Object.keys(preflight.mergePlan).length > 0) {
            // introduced 表的模板数据已由 reconcile 带入 candidateData（asIntroducedSheet_ACU），
            // 若再按 mergePlan 追加会重复 INSERT 同一 UNIQUE 键。只对 matched 表应用合并。
            const introducedKeys = new Set(
                plan.audit
                    .filter(item => item.match === 'introduced')
                    .map(item => item.resolvedSheetKey),
            );
            const matchedMergePlan: Record<string, import('./template-data-preflight').TemplateSheetMergePlan_ACU> = {};
            for (const [sheetKey, sheetPlan] of Object.entries(preflight.mergePlan)) {
                if (!introducedKeys.has(sheetKey)) matchedMergePlan[sheetKey] = sheetPlan;
            }
            applyMergePlanToCandidate_ACU(
                plan.candidateData,
                targetTemplateData,
                matchedMergePlan,
            );
        }
    }
    logDebug_ACU(`[TemplateScope] 模板协调计划已生成: requestId=${requestId}, baseRevision=${baseRevision}, changes=${plan.sheetChanges.map(change => `${change.kind}:${change.sheetKey}`).join(',') || 'none'}, deleted=${plan.deletedSheetKeys.join(',') || 'none'}`);
    logDebug_ACU(`[TemplateScope] 模板 Sheet identity 已解析: requestId=${requestId}, mappings=${plan.audit
        .filter(item => item.templateSheetKey)
        .map(item => `${item.templateSheetKey}->${item.resolvedSheetKey}`).join(',') || 'none'}`);
    // ═══ 阶段 D：guide seedRows 语义由 dataMode 显式决定，禁止隐式分支（计划 D4）═══
    // - replace/merge：模板数据已物化进 candidateData/checkpoint，guide 只做视图投影，
    //   不得把模板数据再次写入 seedRows（否则 SQLite reseed 会重复 INSERT 同一 UNIQUE 键）。
    // - seed：模板数据保留在 guide seedRows，作为待初始化的种子数据。
    const guideData = buildChatSheetGuideDataFromData_ACU(plan.candidateData, {
        preserveSeedRowsFromGuideData:
            effectiveDataMode === 'seed' && !pristineChat
                ? getChatSheetGuideDataForIsolationKey_ACU(isolationKey)
                : null,
        seedRowsFromTemplateObj: effectiveDataMode === 'seed' ? targetTemplateData : null,
    });
    if (!guideData) return { saved: false, error: '无法为协调后的模板生成聊天指导表。' };

    if (signal?.aborted) return { saved: false, error: '模板提交已取消。' };
    if (!chatContextMatches_ACU(targetChatIdentity, entryContext.firstMessage)) {
        return { saved: false, error: '目标聊天已切换，已取消模板提交。' };
    }
    const hasStructuralChanges = plan.sheetChanges.length > 0 || plan.deletedSheetKeys.length > 0;
    let committed;
    if (pristineChat) {
        // pristine 会话没有任何数据帧，模板结构只需落到聊天级 guide + scope 容器。
        // 刻意不调用 commitCurrentFloorTemplateChanges_ACU：不产生 checkpoint / logEntry，
        // 也不读取任何残留 guide 的 seedRows（避免旧宽度污染新结构）。
        // pristine 会话无既有数据：replace/merge 的数据已进入 candidateData，guide 只留表头；
        // seed 模式保留模板数据作为初始化种子。
        const pristineGuideData = buildChatSheetGuideDataFromTemplateObj_ACU(targetTemplateData, { stripSeedRows: effectiveDataMode !== 'seed' });
        if (!pristineGuideData) {
            return { saved: false, error: '目标模板不包含任何表，已取消提交。' };
        }
        committed = await commitCurrentFloorTemplateScopeOnly_ACU({
            isolationKey,
            baselineData,
            candidateData: plan.candidateData,
            guideData: pristineGuideData,
            templateSource: plan.candidateData,
            presetName: normalizeTemplatePresetSelectionValue_ACU(presetName),
            source,
            reason: 'chat_template_pristine_switch',
            pristineOverride: true,
            expectedChatIdentity: targetChatIdentity,
            expectedFirstMessage: entryContext.firstMessage,
            signal,
        });
    } else if (hasStructuralChanges) {
        // 必须使用读取 replay baseline 时一并验证的 revision；此处重新捕获会掩盖 stale plan。
        const commitBaseRevision = hasStructuralChanges ? baseRevision : null;
        committed = await commitCurrentFloorTemplateChanges_ACU({
            isolationKey,
            sheetChanges: plan.sheetChanges,
            deletedSheetKeys: plan.deletedSheetKeys,
            guideData,
            syncTemplateScope: true,
            templateSource: plan.candidateData,
            presetName: normalizeTemplatePresetSelectionValue_ACU(presetName),
            // 休眠溯源（S3-4）：此刻 scope 尚未被本次提交改写，取到的是切换前的活跃预设名，
            // 即本次被 hide 的表在休眠前所属的模板。
            hideSourcePresetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey }) || undefined,
            source,
            reason: 'chat_template_reconciliation',
            baseRevision: commitBaseRevision,
            requestId,
            expectedChatIdentity: targetChatIdentity,
            expectedFirstMessage: entryContext.firstMessage,
            storageMode,
            signal,
        });
    } else {
        committed = await commitCurrentFloorTemplateScopeOnly_ACU({
            isolationKey,
            baselineData,
            candidateData: plan.candidateData,
            guideData,
            templateSource: plan.candidateData,
            presetName: normalizeTemplatePresetSelectionValue_ACU(presetName),
            source,
            reason: 'chat_template_reconciliation',
            expectedChatIdentity: targetChatIdentity,
            expectedFirstMessage: entryContext.firstMessage,
            signal,
        });
    }
    if (!committed.saved) return { ...committed, blockers: plan.blockers, audit: plan.audit };

    _set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(plan.candidateData)));
    applyTemplateScopeForCurrentChat_ACU();
    notifyTemplateRuntimeCommitted_ACU();
    // checkpoint 已落盘，但 SQLite runtime 仍是切换前的旧快照。
    // 必须按 checkpoint 重建 runtime，否则新引入表自带的数据在编辑器/查询里读不到（显示 0 行）。
    const postCommitWarnings: string[] = [];
    if (isSqliteMode()) {
        try {
            await reloadStorageProvider();
            if (didSqliteFallbackAfterReload_ACU('sqlite')) {
                throw new Error('SQLite 运行时重载后已回退到原生模式。');
            }
        } catch (error) {
            postCommitWarnings.push(`模板已保存，但 SQLite 运行时重建失败：${error instanceof Error ? error.message : String(error)}`);
            logWarn_ACU('[TemplateScope] 聊天模板提交成功，但 SQLite 运行时重建失败:', error);
        }
    }
    try {
        await refreshMergedDataAndNotify_ACU();
    } catch (error) {
        postCommitWarnings.push(`模板已保存，但运行时数据刷新失败：${error instanceof Error ? error.message : String(error)}`);
        logWarn_ACU('[TemplateScope] 聊天模板提交成功，但运行时刷新失败:', error);
    }
    const postCommitWarning = postCommitWarnings.join('；');
    return {
        ...committed,
        audit: plan.audit,
        dataMode: effectiveDataMode,
        conflictPolicy: normalizeTemplateConflictPolicy_ACU(conflictPolicy),
        ...(postCommitWarning ? { runtimeReady: false, postCommitWarning } : { runtimeReady: true }),
    };
}

/**
 * 同一聊天/隔离域一次只允许一个模板协调进入 read-plan-commit 链路。
 * 这不是数据正确性的唯一保障（事务 revision 仍是最终边界），而是避免旧入口
 * 与可视化入口并发生成两份互相过期的结构计划。
 */
export async function applyChatTemplateSnapshotWithReconciliation_ACU(templateData: any, options: {
    source?: string;
    presetName?: string;
    dataMode?: TemplateDataMode_ACU;
    conflictPolicy?: TemplateMergeConflictPolicy_ACU;
    destructiveChangeConfirmed?: boolean;
    /**
     * 目标模板缺失的既有表默认隐藏保留（数据留在 V2 历史）。置 true 才跨全历史硬删，
     * 且必须同时提供 destructiveChangeConfirmed。
     */
    hardDeleteMissingSheets?: boolean;
    signal?: AbortSignal;
    requestId?: string;
} = {}) {
    const chat = getChatArray_ACU();
    const firstMessage = Array.isArray(chat) ? chat[0] : null;
    const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
    const scopeKey = `${chatIdentity || 'unresolved-chat'}::${getCurrentIsolationKey_ACU()}::${firstMessage ? 'bound' : 'unbound'}`;
    if (activeChatTemplateReconciliations_ACU.has(scopeKey)) {
        return { saved: false, error: '当前聊天的模板切换正在进行中，请等待其完成后再试。' };
    }
    const operation = applyChatTemplateSnapshotWithReconciliationInternal_ACU(templateData, options);
    activeChatTemplateReconciliations_ACU.set(scopeKey, operation);
    try {
        return await operation;
    } finally {
        if (activeChatTemplateReconciliations_ACU.get(scopeKey) === operation) {
            activeChatTemplateReconciliations_ACU.delete(scopeKey);
        }
    }
}

export async function applyTemplatePresetToCurrent_ACU(presetName: string, { source = 'ui', updateGlobal = true, save = true, persistChatScope = undefined as boolean | undefined, chatSelectionSource = 'auto' as 'auto' | 'snapshot' | 'global', destructiveChangeConfirmed = false, signal = undefined as AbortSignal | undefined } = {}) {
    const _persistChatScope = persistChatScope ?? !updateGlobal;
    const name = normalizeTemplatePresetSelectionValue_ACU(presetName);
    const isDefaultPreset = isDefaultTemplatePresetSelection_ACU(name);

    if (!updateGlobal) {
        const localSnapshot = chatSelectionSource === 'global'
            ? null
            : listChatTemplatePresetEntries_ACU().find((entry: any) => normalizeTemplatePresetSelectionValue_ACU(entry?.presetName || '') === name);
        const snapshotSource = localSnapshot?.templateStr || (isDefaultPreset
            ? getDefaultTemplateSnapshot_ACU()?.templateStr
            : getTemplatePreset_ACU(name)?.templateStr);
        if (!snapshotSource) return false;
        const applied = await applyTemplateSnapshotToScope_ACU(snapshotSource, {
            scope: 'chat',
            source,
            save,
            persistChatScope: true,
            presetName: name,
            registerChatPresetEntry: false,
            destructiveChangeConfirmed,
            signal,
        });
        if (!applied || typeof applied !== 'object' || !('saved' in applied) || !applied.saved) return applied || false;
        return {
            ...applied,
            presetName: name,
            mode: 'chat_override',
            fromGlobalPreset: !localSnapshot,
            fromLocalSnapshot: !!localSnapshot,
            isDefault: isDefaultPreset,
        };
    }

    let snapshot = null;
    if (isDefaultPreset) {
        snapshot = getDefaultTemplateSnapshot_ACU();
    } else {
        const preset = getTemplatePreset_ACU(name);
        const raw = preset?.templateStr;
        if (!raw) return false;
        snapshot = sanitizeTemplateSnapshotForChat_ACU(raw);
    }

    const applied = await applyTemplateSnapshotToScope_ACU(snapshot?.templateStr, {
        scope: 'global',
        source,
        presetName: name,
        save,
        persistChatScope: _persistChatScope,
        destructiveChangeConfirmed,
        signal,
    });
    if (!applied) return false;

    // S1-3：全局切换经协调器失败时（saved:false，含 blockers/error），原样透传给
    // 调用方做破坏性确认重试或错误展示，不得伪装成成功。
    if (typeof applied === 'object' && 'saved' in applied && applied.saved === false) return applied;

    return { ...applied, isDefault: isDefaultPreset };
}

/**
 * 跟随全局：清除当前聊天的模板覆盖，让当前聊天回到 inherit_global（S1-2）。
 *
 * 语义：先经协调器把当前聊天切到当前全局模板（保留休眠/隐藏语义、破坏性确认、
 * V2 原子提交），提交成功后再把 scope 翻成 {mode:'inherit_global'}。协调提交
 * 固定写 chat_override 快照，因此翻转必须在提交之后单独执行；刻意不走
 * persistTemplateScopeSelectionState_ACU 的 inherit_global 分支——那条路会顺带
 * 清除协调刚写入的聊天指导表。
 */
export async function followGlobalTemplateForCurrentChat_ACU({
    source = 'follow_global',
    destructiveChangeConfirmed = false,
    signal = undefined as AbortSignal | undefined,
} = {}) {
    const isolationKey = normalizeTemplateScopeIsolationKey_ACU(getCurrentIsolationKey_ACU());
    const globalPresetName = normalizeTemplatePresetSelectionValue_ACU(
        getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false }),
    );
    const scopeState = getCurrentChatTemplateScopeState_ACU({ isolationKey });
    if (!scopeState) {
        return { saved: true, alreadyFollowing: true, mode: 'inherit_global' as const, presetName: globalPresetName };
    }
    const globalSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
    if (!globalSnapshot?.templateStr || !globalSnapshot?.templateObj) {
        return { saved: false, error: '无法解析当前全局模板，已取消跟随全局。' };
    }
    const result = await applyChatTemplateSnapshotWithReconciliation_ACU(globalSnapshot.templateObj, {
        source,
        presetName: globalPresetName,
        destructiveChangeConfirmed,
        signal,
    });
    if (!result || result.saved !== true) return result;

    await flipCurrentChatScopeToInheritGlobal_ACU('template_scope_follow_global');
    applyTemplateScopeForCurrentChat_ACU();
    notifyTemplateRuntimeCommitted_ACU();
    return { ...result, mode: 'inherit_global' as const, presetName: globalPresetName };
}

/**
 * 解析指定 scope 的模板数据用于导出
 * 纯业务逻辑：不涉及 UI（文件下载由 presentation 层负责）
 * 
 * @param scope - 'global' | 'chat'
 * @param selectedPresetName - 当前选中的预设名（由 UI 层传入）
 * @param options.allowRuntimeFallback - 仅影响 global 分支：传了名字但解析失败时，
 *   是否允许继续回落全局快照。默认 false，保持既有 4 个调用方行为完全不变。
 * @returns { jsonData, fromPresetName } 或 null（解析失败）
 */
export function resolveTemplateForExport_ACU(
    scope: string,
    selectedPresetName?: string,
    options?: { allowRuntimeFallback?: boolean }
): { jsonData: Record<string, any>; fromPresetName: string } | null {
    const allowRuntimeFallback = !!options?.allowRuntimeFallback;
    let fromPresetName = '';
    let jsonData: Record<string, any> | null = null;

    // runtime scope 必须在 normalizeTemplateOperationScope_ACU 之前分流：
    // 该函数把一切非 'chat' 折叠成 'global'，直接给它加 runtime 会改变所有调用方语义。
    if (scope === 'runtime') {
        const runtimeSnapshot = getRuntimeTemplateSnapshot_ACU();
        if (!runtimeSnapshot?.templateObj || typeof runtimeSnapshot.templateObj !== 'object') return null;
        jsonData = JSON.parse(JSON.stringify(runtimeSnapshot.templateObj));
        fromPresetName = normalizeTemplatePresetSelectionValue_ACU(
            resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true }),
        );
    } else if (normalizeTemplateOperationScope_ACU(scope) === 'global') {
        // 优先从选中的预设加载
        if (selectedPresetName) {
            try {
                const selected = normalizeTemplatePresetSelectionValue_ACU(selectedPresetName);
                if (selected) {
                    const preset = getTemplatePreset_ACU(selected);
                    const obj = preset?.templateStr ? safeJsonParse_ACU(preset.templateStr, null) : null;
                    if (obj && typeof obj === 'object') {
                        jsonData = JSON.parse(JSON.stringify(obj));
                        fromPresetName = selected;
                    }
                }
            } catch (e) { logWarn_ACU('[模板预设] resolveTemplateData: 从预设加载模板失败:', e); }
        }

        if (!jsonData || typeof jsonData !== 'object') {
            if (selectedPresetName && !allowRuntimeFallback) return null;
            const globalSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
            if (globalSnapshot?.templateObj && typeof globalSnapshot.templateObj === 'object') {
                jsonData = JSON.parse(JSON.stringify(globalSnapshot.templateObj));
                fromPresetName = normalizeTemplatePresetSelectionValue_ACU(getCurrentTemplatePresetName_ACU(settings_ACU, { requireExisting: false }));
            }
        }
    } else {
        // chat scope
        const chatScopeState = getCurrentChatTemplateScopeState_ACU() || migrateLegacyTemplateScopeForCurrentChat_ACU();
        const effectivePresetName = normalizeTemplatePresetSelectionValue_ACU(resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true }));
        let chatSnapshot = null as ReturnType<typeof sanitizeTemplateSnapshotForChat_ACU> | null;
        if (chatScopeState?.mode === 'chat_override' && chatScopeState?.templateStr) {
            chatSnapshot = sanitizeTemplateSnapshotForChat_ACU(chatScopeState.templateStr);
        } else if (chatScopeState?.mode === 'preset_link') {
            const linkedPresetName = normalizeTemplatePresetSelectionValue_ACU(chatScopeState.presetName || '');
            chatSnapshot = linkedPresetName
                ? sanitizeTemplateSnapshotForChat_ACU(getTemplatePreset_ACU(linkedPresetName)?.templateStr || null)
                : getDefaultTemplateSnapshot_ACU();
        } else {
            chatSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
        }
        if (chatSnapshot?.templateObj && typeof chatSnapshot.templateObj === 'object') {
            jsonData = JSON.parse(JSON.stringify(chatSnapshot.templateObj));
            fromPresetName = normalizeTemplatePresetSelectionValue_ACU(chatScopeState?.presetName || effectivePresetName);
        }
    }

    if (!jsonData || typeof jsonData !== 'object') {
        return null;
    }

    // 确保顺序编号
    const sheetKeys0 = Object.keys(jsonData).filter(k => k.startsWith('sheet_'));
    ensureSheetOrderNumbers_ACU(jsonData, { baseOrderKeys: sheetKeys0, forceRebuild: false });

    // 确保每个 sheet 都有 exportConfig
    const sheetKeysForExport = Object.keys(jsonData).filter(k => k.startsWith('sheet_'));
    sheetKeysForExport.forEach(key => {
        const sheet = jsonData[key];
        if (!sheet) return;
        if (!sheet.exportConfig) {
            sheet.exportConfig = buildDefaultExportConfig_ACU(sheet.name);
        } else {
            sheet.exportConfig = ensureExportConfigDefaults_ACU(sheet.exportConfig, sheet.name);
        }
    });

    return { jsonData, fromPresetName };
}
