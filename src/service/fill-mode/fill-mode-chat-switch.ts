/**
 * 对话级填表模式记录（写入侧）：切换当前对话模式、为未记录的对话补记模式。
 *
 * 经典表格模式与飞行模式合并为同一个开关：切入经典即启用飞行模式，切出经典即停用；
 * 飞行模式状态是经典模式的权威来源，模式记录只在切换成功后写入。
 * 纪要总行数低于大总结阈值时可往返切换；达到阈值后从经典切出须显式确认，且不能切回。
 * 表格尚未加载时不放宽限制；记录无法识别时拒绝切回经典（fail-closed）。
 */
import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { notifyChatConfigurationChanged_ACU } from '../../shared/chat-configuration-change';
import {
  getActiveChatStorageIdentity_ACU,
  normalizeChatScopedConfigContainer_ACU,
  peekChatScopedConfigContainer_ACU,
  setChatScopedConfigContainer_ACU,
} from '../../data/storage/chat-history';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
  disableFlightMode_ACU,
  enableFlightMode_ACU,
  type FlightModeTransitionResult_ACU,
} from '../flight-mode/flight-mode-transition';
import { type FillMode_ACU } from './fill-mode-preferences';
import { isChronicleBelowClassicThreshold_ACU } from '../flight-mode/flight-mode-state';
import {
  isClassicModeActiveForCurrentChat_ACU,
  resolveCurrentChatFillMode_ACU,
} from './fill-mode-chat-record';
import { stageChatFillModeRecord_ACU } from './fill-mode-chat-record-fields';
import { hasExistingTableDataForCurrentChat_ACU, inspectSummaryVectorDataForCurrentChat_ACU } from './fill-mode-chat-evidence';

export interface SetChatFillModeOptions_ACU {
  /** 用户已在显式弹窗中确认达到纪要阈值后的不可逆切换。 */
  confirmIrreversibleChange?: boolean;
  /** 用户已确认：切出经典时按启用前归档恢复模板，覆盖启用后对模板的修改。 */
  confirmTemplateScopeChange?: boolean;
}

export type SetChatFillModeResult_ACU =
  | { ok: true; mode: FillMode_ACU; changed: boolean }
  | {
    ok: false;
    reason: 'no_active_chat' | 'classic_locked' | 'record_invalid' | 'save_failed'
      | 'classic_enable_failed' | 'classic_disable_failed' | 'template_scope_changed'
      | 'irreversible_confirmation_required';
    currentMode: FillMode_ACU;
    error?: string;
  };

export type EnsureChatFillModeResult_ACU =
  | { recorded: true; mode: FillMode_ACU }
  | {
    recorded: false;
    reason: 'no_active_chat' | 'already_recorded' | 'record_invalid' | 'legacy_default' | 'save_failed' | 'evidence_unavailable' | 'chat_changed';
    error?: string;
  };

type WriteResult_ACU = { ok: true } | { ok: false; reason: 'no_active_chat' | 'save_failed'; error?: string };

function describeClassicTransitionFailure_ACU(result: FlightModeTransitionResult_ACU): string {
  if (result.reason === 'too_many_visible_chronicle_rows') {
    return `当前可见纪要 ${result.visibleChronicleRowCount ?? '?'} 条，超过经典表格模式的纪要窗口。`;
  }
  if (result.reason === 'chronicle_not_found') return '当前表格模板没有纪要表。';
  if (result.reason === 'template_unavailable') return '当前对话的表格模板不可用。';
  return result.error || (result.blockers?.length ? result.blockers.join('；') : '') || result.reason || '未知原因';
}

async function writeCurrentChatFillMode_ACU(mode: FillMode_ACU): Promise<WriteResult_ACU> {
  const chat = getChatArray_ACU();
  const identity = getActiveChatStorageIdentity_ACU(chat);
  if (!identity) return { ok: false, reason: 'no_active_chat' };
  const previous = peekChatScopedConfigContainer_ACU(chat);
  const snapshot = previous ? JSON.parse(JSON.stringify(previous)) : null;
  const next = normalizeChatScopedConfigContainer_ACU(previous);
  stageChatFillModeRecord_ACU(next, String(getCurrentIsolationKey_ACU() ?? ''), mode);
  setChatScopedConfigContainer_ACU(chat, next);
  try {
    await saveChatToHostStrict_ACU();
    notifyChatConfigurationChanged_ACU('fill-mode');
    return { ok: true };
  } catch (error: any) {
    // 只在仍是同一对话时回滚，避免把旧快照写进切换后的对话。
    if (getActiveChatStorageIdentity_ACU(getChatArray_ACU()) === identity) setChatScopedConfigContainer_ACU(chat, snapshot);
    return { ok: false, reason: 'save_failed', error: String(error?.message || error || '聊天保存失败') };
  }
}

/** 切换当前对话的填表模式。拒绝时不写入，调用方负责提示。 */
export async function setCurrentChatFillMode_ACU(
  mode: FillMode_ACU,
  options: SetChatFillModeOptions_ACU = {},
): Promise<SetChatFillModeResult_ACU> {
  const current = resolveCurrentChatFillMode_ACU();
  const currentMode = current.mode;
  if (current.recordStatus === 'no_chat') return { ok: false, reason: 'no_active_chat', currentMode };
  if (mode === currentMode && current.recordStatus === 'recorded'
    && (mode !== 'classic' || isClassicModeActiveForCurrentChat_ACU())) return { ok: true, mode, changed: false };
  if (mode === 'classic' && hasExistingTableDataForCurrentChat_ACU()) {
    if (current.recordStatus === 'invalid') return { ok: false, reason: 'record_invalid', currentMode };
    if (currentMode !== 'classic' && !isChronicleBelowClassicThreshold_ACU()) {
      return { ok: false, reason: 'classic_locked', currentMode };
    }
  }
  // 先切换飞行模式：失败则整次切换拒绝，记录保持不变。
  const classicActive = isClassicModeActiveForCurrentChat_ACU();
  if (mode === 'classic' && !classicActive) {
    const enabled = await enableFlightMode_ACU();
    if (!enabled.ok) {
      return { ok: false, reason: 'classic_enable_failed', currentMode, error: describeClassicTransitionFailure_ACU(enabled) };
    }
    return { ok: true, mode, changed: mode !== currentMode };
  } else if (mode !== 'classic' && classicActive) {
    if (!isChronicleBelowClassicThreshold_ACU() && !options.confirmIrreversibleChange) {
      return { ok: false, reason: 'irreversible_confirmation_required', currentMode };
    }
    const disabled = await disableFlightMode_ACU({ confirmTemplateScopeChange: options.confirmTemplateScopeChange === true, fillMode: mode });
    if (!disabled.ok) {
      if (disabled.reason === 'template_scope_changed') return { ok: false, reason: 'template_scope_changed', currentMode };
      return { ok: false, reason: 'classic_disable_failed', currentMode, error: describeClassicTransitionFailure_ACU(disabled) };
    }
    return { ok: true, mode, changed: mode !== currentMode };
  }
  const written = await writeCurrentChatFillMode_ACU(mode);
  if ('reason' in written) {
    return { ok: false, reason: written.reason, currentMode, ...(written.error ? { error: written.error } : {}) };
  }
  return { ok: true, mode, changed: mode !== currentMode };
}

/**
 * 打开对话时为未记录的对话补记模式：新对话按偏好，旧对话按已识别的数据证据。
 * 只在表格可靠加载后补记；已有标记不再按历史数据重新推断。
 */
export async function ensureCurrentChatFillModeRecorded_ACU(): Promise<EnsureChatFillModeResult_ACU> {
  const current = resolveCurrentChatFillMode_ACU();
  if (current.recordStatus === 'no_chat') return { recorded: false, reason: 'no_active_chat' };
  if (current.recordStatus === 'recorded') return { recorded: false, reason: 'already_recorded' };
  if (current.recordStatus === 'invalid') return { recorded: false, reason: 'record_invalid' };
  if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') {
    return { recorded: false, reason: 'legacy_default' };
  }
  const chat = getChatArray_ACU();
  const identity = getActiveChatStorageIdentity_ACU(chat);
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  const tableData = currentJsonTableData_ACU;
  const tableSnapshot = JSON.stringify(tableData);
  const chatSnapshot = JSON.stringify(chat);
  let mode = current.mode;
  if (current.source === 'legacy') {
    const evidence = await inspectSummaryVectorDataForCurrentChat_ACU();
    if (evidence.status === 'unknown') return { recorded: false, reason: 'evidence_unavailable', error: evidence.error };
    mode = evidence.status === 'present' ? 'crossfire' : 'llm';
  }
  if (getActiveChatStorageIdentity_ACU(getChatArray_ACU()) !== identity
    || String(getCurrentIsolationKey_ACU() ?? '') !== isolationKey
    || currentJsonTableData_ACU !== tableData || JSON.stringify(tableData) !== tableSnapshot
    || JSON.stringify(getChatArray_ACU()) !== chatSnapshot) return { recorded: false, reason: 'chat_changed' };
  const latest = resolveCurrentChatFillMode_ACU();
  if (latest.recordStatus === 'recorded') return { recorded: false, reason: 'already_recorded' };
  if (latest.recordStatus === 'invalid') return { recorded: false, reason: 'record_invalid' };
  if (isClassicModeActiveForCurrentChat_ACU()) mode = 'classic';
  const written = await writeCurrentChatFillMode_ACU(mode);
  if ('reason' in written) return { recorded: false, reason: written.reason, ...(written.error ? { error: written.error } : {}) };
  return { recorded: true, mode };
}
