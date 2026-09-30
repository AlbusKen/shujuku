import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import {
  getChatScopedConfigContainer_ACU,
  normalizeChatScopedConfigContainer_ACU,
  setChatScopedConfigContainer_ACU,
} from '../../data/storage/chat-history';
import {
  FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
  FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
  type FlightModeArchive_ACU,
  type FlightModeState_ACU,
} from '../../shared/models/flight-mode-model';
import type { Sheet_ACU } from '../../shared/models/table-data';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { deleteTableLocksForSheet_ACU, setSpecialIndexLockEnabled_ACU } from '../runtime/helpers-table-lock';
import { applyChatTemplateSnapshotWithReconciliation_ACU } from '../template/template-preset-service';
import {
  getCurrentChatTemplateScopeState_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU,
} from '../template/chat-scope/chat-scope-template';
import { buildFlightModeBigSummarySheet_ACU } from './big-summary-sheet-def';
import {
  canEnableFlightMode_ACU,
  getCurrentFlightModeState_ACU,
  normalizeFlightModeState_ACU,
} from './flight-mode-state';

export type FlightModeTransitionResult_ACU = {
  ok: boolean;
  reason?: 'already_enabled' | 'already_disabled' | 'recovered_pending_enable' | 'chronicle_not_found' | 'too_many_visible_chronicle_rows' | 'template_unavailable' | 'big_summary_sheet_key_conflict' | 'restore_archive_missing' | 'template_scope_changed' | 'commit_failed' | 'big_summary_sheet_key_unresolved' | 'state_persist_failed';
  visibleChronicleRowCount?: number;
  /** 提交层的原始拒绝原因，直接透传给 UI，不改写不省略。 */
  error?: string;
  blockers?: string[];
};

export interface DisableFlightModeOptions_ACU {
  /** 用户已明确确认：停用将按 archive 恢复模板，并覆盖启用后对该会话模板的修改。 */
  confirmTemplateScopeChange?: boolean;
}

function cloneValue_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findSheetByName_ACU(data: Record<string, any> | null | undefined, name: string): { key: string; sheet: Sheet_ACU } | null {
  if (!data || typeof data !== 'object') return null;
  for (const [key, sheet] of Object.entries(data)) {
    if (!key.startsWith('sheet_')) continue;
    if ((sheet as any)?.name === name) return { key, sheet: sheet as Sheet_ACU };
  }
  return null;
}

function getEffectiveTemplateScope_ACU() {
  return getCurrentChatTemplateScopeState_ACU({ isolationKey: getCurrentIsolationKey_ACU() })
    || getGlobalTemplateSnapshotForCurrentProfile_ACU();
}

function parseTemplateScope_ACU(scope: { templateStr?: string } | null | undefined): Record<string, any> | null {
  if (!scope?.templateStr) return null;
  try {
    const parsed = JSON.parse(scope.templateStr);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function recoverRestoreTemplateFromEnabledScope_ACU(
  currentState: FlightModeState_ACU,
): { template: Record<string, any>; presetName: string } | null {
  const archive = currentState.archive;
  if (!archive?.templateScopeWasAbsent || !archive.chronicleExportConfig) return null;
  const effectiveScope = getEffectiveTemplateScope_ACU();
  const template = parseTemplateScope_ACU(effectiveScope);
  if (!template) return null;

  const summaryKeys = Object.entries(template)
    .filter(([key, sheet]) => key === currentState.bigSummarySheetKey || (key.startsWith('sheet_') && (sheet as any)?.name === FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU))
    .map(([key]) => key);
  if (summaryKeys.length === 0) return null;
  summaryKeys.forEach(key => delete template[key]);

  const chronicle = findSheetByName_ACU(template, '纪要表');
  if (!chronicle) return null;
  chronicle.sheet.exportConfig = cloneValue_ACU(archive.chronicleExportConfig);
  return { template, presetName: String((effectiveScope as any)?.presetName || '') };
}

function parseEffectiveTemplate_ACU(): Record<string, any> | null {
  return parseTemplateScope_ACU(getEffectiveTemplateScope_ACU());
}

function getCurrentEffectiveTemplateText_ACU(): string | null {
  return getEffectiveTemplateScope_ACU()?.templateStr || null;
}

/**
 * flightMode 与模板 scope 是同一个 scoped container 的兄弟键，而模板提交在内部
 * peek 一份 container 作为回滚快照。因此状态只能在提交成功后单独写入：反序会让
 * 提交失败的回滚还原模板、却保留 flightMode 状态，产生开关与模板不一致的脏态。
 * 启用前另存一份“待完成归档”：模板已提交而状态保存失败时，下次启用据此补完，
 * 不会因大总结表已存在而被 big_summary_sheet_key_conflict 永久卡住。
 */
const PENDING_ENABLE_FIELD_ACU = 'flightModePendingEnableByIsolationKey';

interface FlightModePendingEnable_ACU {
  archive: FlightModeArchive_ACU;
  startedAt: number;
}

function isPlainObject_ACU(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function describeError_ACU(error: any): string {
  return String(error?.message || error || '未知错误');
}

function readPendingEnable_ACU(): FlightModePendingEnable_ACU | null {
  const slots = getChatScopedConfigContainer_ACU(getChatArray_ACU())?.[PENDING_ENABLE_FIELD_ACU];
  if (!isPlainObject_ACU(slots)) return null;
  const raw = slots[String(getCurrentIsolationKey_ACU() ?? '')];
  return isPlainObject_ACU(raw) && isPlainObject_ACU(raw.archive) ? raw as FlightModePendingEnable_ACU : null;
}

function setPendingEnableSlot_ACU(container: Record<string, any>, value: FlightModePendingEnable_ACU | null): void {
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  const slots: Record<string, any> = isPlainObject_ACU(container[PENDING_ENABLE_FIELD_ACU]) ? { ...container[PENDING_ENABLE_FIELD_ACU] } : {};
  if (value) slots[isolationKey] = value;
  else delete slots[isolationKey];
  if (Object.keys(slots).length > 0) container[PENDING_ENABLE_FIELD_ACU] = slots;
  else delete container[PENDING_ENABLE_FIELD_ACU];
}

function updateScopedContainer_ACU(mutate: (container: Record<string, any>) => void): void {
  const chat = getChatArray_ACU();
  const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
  mutate(container);
  setChatScopedConfigContainer_ACU(chat, container);
}

async function persistFlightModeState_ACU(next: FlightModeState_ACU): Promise<void> {
  updateScopedContainer_ACU(container => {
    const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
    const states = container.flightModeByIsolationKey;
    container.flightModeByIsolationKey = {
      ...(isPlainObject_ACU(states) ? states : {}),
      [isolationKey]: normalizeFlightModeState_ACU(next),
    };
    setPendingEnableSlot_ACU(container, null);
  });
  // 严格保存：宿主不可用时必须报错，不能让模板与开关状态静默脱节。
  await saveChatToHostStrict_ACU();
}

async function clearPendingEnableBestEffort_ACU(): Promise<void> {
  if (!readPendingEnable_ACU()) return;
  updateScopedContainer_ACU(container => setPendingEnableSlot_ACU(container, null));
  try {
    await saveChatToHostStrict_ACU();
  } catch (_) {
    // 残留的待完成归档只在大总结表已存在时才会被使用，保存失败无害。
  }
}

/** 当前对话是否存在“模板已提交、开关状态未落盘”的半完成启用。 */
export function hasPendingFlightModeEnable_ACU(): boolean {
  try {
    return readPendingEnable_ACU() !== null;
  } catch (_) {
    return false;
  }
}

export async function enableFlightMode_ACU(): Promise<FlightModeTransitionResult_ACU> {
  const currentState = getCurrentFlightModeState_ACU();
  if (currentState.enabled) return { ok: true, reason: 'already_enabled' };

  const check = canEnableFlightMode_ACU(currentJsonTableData_ACU);
  const template = parseEffectiveTemplate_ACU();

  // 上次启用已提交模板、但开关状态没能落盘：按待完成归档补完，不重复提交模板。
  if (template && findSheetByName_ACU(template, FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU)) {
    const pending = readPendingEnable_ACU();
    const existing = findSheetByName_ACU(currentJsonTableData_ACU, FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU);
    if (pending && existing) {
      try {
        await persistFlightModeState_ACU({
          enabled: true,
          enabledAt: Date.now(),
          hiddenRowIds: [],
          bigSummarySheetKey: existing.key,
          archive: { ...pending.archive, enabledTemplateStr: getCurrentEffectiveTemplateText_ACU() || undefined },
        });
      } catch (error: any) {
        return { ok: false, reason: 'state_persist_failed', error: `经典表格模式开关状态保存失败：${describeError_ACU(error)}` };
      }
      setSpecialIndexLockEnabled_ACU(existing.key, false);
      return { ok: true, reason: 'recovered_pending_enable', visibleChronicleRowCount: check.visibleChronicleRowCount };
    }
  }

  if (!check.canEnable) return { ok: false, reason: check.reason, visibleChronicleRowCount: check.visibleChronicleRowCount };
  if (!template) return { ok: false, reason: 'template_unavailable' };

  const chronicleEntry = findSheetByName_ACU(template, '纪要表');
  if (!chronicleEntry) return { ok: false, reason: 'chronicle_not_found', visibleChronicleRowCount: check.visibleChronicleRowCount };
  if (findSheetByName_ACU(template, FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU)) {
    return { ok: false, reason: 'big_summary_sheet_key_conflict', visibleChronicleRowCount: check.visibleChronicleRowCount };
  }

  // 目标模板：改写纪要表导出配置 + 追加大总结表。key 只是占位，协调层会按显示名重派生。
  const nextTemplate = cloneValue_ACU(template);
  const nextChronicle = findSheetByName_ACU(nextTemplate, '纪要表')!.sheet;
  const originalExportConfig = cloneValue_ACU(nextChronicle.exportConfig);
  nextChronicle.exportConfig = {
    ...nextChronicle.exportConfig,
    entryType: 'constant',
    extraIndexEnabled: false,
  };
  nextTemplate[FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU] = buildFlightModeBigSummarySheet_ACU(nextChronicle, nextTemplate);

  const scopeBeforeEnable = getCurrentChatTemplateScopeState_ACU({ isolationKey: getCurrentIsolationKey_ACU() });
  const effectiveScopeBeforeEnable = getEffectiveTemplateScope_ACU();
  const archive: FlightModeArchive_ACU = {
    chronicleExportConfig: originalExportConfig,
    templateScope: effectiveScopeBeforeEnable === null ? undefined : cloneValue_ACU(effectiveScopeBeforeEnable),
    templateScopeWasAbsent: scopeBeforeEnable === null,
  };
  try {
    updateScopedContainer_ACU(container => setPendingEnableSlot_ACU(container, { archive: cloneValue_ACU(archive), startedAt: Date.now() }));
    await saveChatToHostStrict_ACU();
  } catch (error: any) {
    updateScopedContainer_ACU(container => setPendingEnableSlot_ACU(container, null));
    return { ok: false, reason: 'commit_failed', error: `启用前归档保存失败：${describeError_ACU(error)}` };
  }

  const committed: any = await applyChatTemplateSnapshotWithReconciliation_ACU(nextTemplate, {
    source: 'flight_mode_enable',
    presetName: getEffectiveTemplateScope_ACU()?.presetName || '',
  });
  if (!committed?.saved) {
    await clearPendingEnableBestEffort_ACU();
    return {
      ok: false,
      reason: 'commit_failed',
      visibleChronicleRowCount: check.visibleChronicleRowCount,
      ...(committed?.error ? { error: committed.error } : {}),
      ...(committed?.blockers?.length ? { blockers: committed.blockers } : {}),
    };
  }

  // 协调层按显示名派生真实 key（大总结 → sheet_da_zong_jie），提交后必须重新解析。
  const resolved = findSheetByName_ACU(currentJsonTableData_ACU, FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU);
  // 模板已提交但解析不到大总结表：保留待完成归档，下次启用可补完。
  if (!resolved) return { ok: false, reason: 'big_summary_sheet_key_unresolved', visibleChronicleRowCount: check.visibleChronicleRowCount };

  try {
    await persistFlightModeState_ACU({
      enabled: true,
      enabledAt: Date.now(),
      hiddenRowIds: [],
      bigSummarySheetKey: resolved.key,
      // 必须记录正式提交后的作用域文本，而不是 nextTemplate：协调层会重派 key 并规范化结构。
      archive: { ...archive, enabledTemplateStr: getCurrentEffectiveTemplateText_ACU() || undefined },
    });
  } catch (error: any) {
    return {
      ok: false,
      reason: 'state_persist_failed',
      visibleChronicleRowCount: check.visibleChronicleRowCount,
      error: `大总结表已写入，但经典表格模式开关状态保存失败：${describeError_ACU(error)}。下次打开对话会自动补完。`,
    };
  }
  setSpecialIndexLockEnabled_ACU(resolved.key, false);
  return { ok: true, visibleChronicleRowCount: check.visibleChronicleRowCount };
}

export async function disableFlightMode_ACU(options: DisableFlightModeOptions_ACU = {}): Promise<FlightModeTransitionResult_ACU> {
  const currentState = getCurrentFlightModeState_ACU();
  if (!currentState.enabled) return { ok: true, reason: 'already_disabled' };

  const archive = currentState.archive;
  const archivedScope = archive?.templateScope as { templateStr?: string; presetName?: string } | undefined;
  let restoreTemplate = parseTemplateScope_ACU(archivedScope);
  let restorePresetName = String(archivedScope?.presetName || '');
  if (!restoreTemplate) {
    // 旧版本在启用前没有聊天级 scope 时只记录了 templateScopeWasAbsent，遗漏了实际生效的全局模板。
    // 此时从当前启用态模板中精确移除大总结，并恢复已归档的纪要导出配置，避免用户永久无法关闭。
    const recovered = recoverRestoreTemplateFromEnabledScope_ACU(currentState);
    restoreTemplate = recovered?.template || null;
    restorePresetName = recovered?.presetName || '';
  }
  if (!restoreTemplate) {
    return {
      ok: false,
      reason: 'restore_archive_missing',
      error: '飞行模式缺少可验证的启用前模板归档，无法安全恢复纪要配置并删除大总结表。',
    };
  }

  const enabledTemplateStr = String(archive?.enabledTemplateStr || '');
  const currentTemplateStr = getCurrentEffectiveTemplateText_ACU();
  if (enabledTemplateStr && currentTemplateStr && enabledTemplateStr !== currentTemplateStr && !options.confirmTemplateScopeChange) {
    return { ok: false, reason: 'template_scope_changed' };
  }

  const bigSummaryKey = currentState.bigSummarySheetKey;
  // 大总结内容只是被隐藏纪要行的摘要。停用会把那些纪要行全部恢复可见，摘要随即失去意义，
  // 因此这里显式硬删而非隐藏保留；hardDeleteMissingSheets 必须与破坏性确认成对出现。
  const committed: any = await applyChatTemplateSnapshotWithReconciliation_ACU(restoreTemplate, {
    source: 'flight_mode_disable',
    presetName: restorePresetName,
    hardDeleteMissingSheets: true,
    destructiveChangeConfirmed: true,
  });
  if (!committed?.saved) {
    return {
      ok: false,
      reason: 'commit_failed',
      ...(committed?.error ? { error: committed.error } : {}),
      ...(committed?.blockers?.length ? { blockers: committed.blockers } : {}),
    };
  }

  try {
    await persistFlightModeState_ACU({
      enabled: false,
      enabledAt: 0,
      hiddenRowIds: [],
      bigSummarySheetKey: bigSummaryKey,
    });
  } catch (error: any) {
    return { ok: false, reason: 'state_persist_failed', error: `模板已恢复，但经典表格模式开关状态保存失败：${describeError_ACU(error)}` };
  }
  deleteTableLocksForSheet_ACU(bigSummaryKey);
  return { ok: true };
}
