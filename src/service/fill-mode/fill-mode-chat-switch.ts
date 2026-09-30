/**
 * 对话级填表模式记录（写入侧）：切换当前对话模式、为未记录的对话补记模式。
 *
 * 经典表格模式与飞行模式合并为同一个开关：切入经典即启用飞行模式，切出经典即停用；
 * 飞行模式状态是经典模式的权威来源，模式记录只在切换成功后写入。
 * 非经典模式的对话不能切回经典表格模式：非经典模式下纪要表持续累积，切回后会超出经典模式的纪要窗口。
 * 尚无表格数据的新对话不受此限制；记录无法识别时拒绝切回经典（fail-closed）。
 */
import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import {
  getActiveChatStorageIdentity_ACU,
  normalizeChatScopedConfigContainer_ACU,
  peekChatScopedConfigContainer_ACU,
  setChatScopedConfigContainer_ACU,
} from '../../data/storage/chat-history';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
  disableFlightMode_ACU,
  enableFlightMode_ACU,
  type FlightModeTransitionResult_ACU,
} from '../flight-mode/flight-mode-transition';
import { isLegacyCrossfireEnabled_ACU, type FillMode_ACU } from './fill-mode-preferences';
import {
  CHAT_FILL_MODE_FIELD_ACU,
  isClassicModeActiveForCurrentChat_ACU,
  resolveCurrentChatFillMode_ACU,
} from './fill-mode-chat-record';
import { hasExistingTableDataForCurrentChat_ACU } from './fill-mode-gate';

export interface SetChatFillModeOptions_ACU {
  /** 用户已确认：切出经典时按启用前归档恢复模板，覆盖启用后对模板的修改。 */
  confirmTemplateScopeChange?: boolean;
}

export type SetChatFillModeResult_ACU =
  | { ok: true; mode: FillMode_ACU; changed: boolean }
  | {
    ok: false;
    reason: 'no_active_chat' | 'classic_locked' | 'record_invalid' | 'save_failed'
      | 'classic_enable_failed' | 'classic_disable_failed' | 'template_scope_changed';
    currentMode: FillMode_ACU;
    error?: string;
  };

export type EnsureChatFillModeResult_ACU =
  | { recorded: true; mode: FillMode_ACU }
  | {
    recorded: false;
    reason: 'no_active_chat' | 'already_recorded' | 'record_invalid' | 'legacy_default' | 'save_failed';
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
  const records = next[CHAT_FILL_MODE_FIELD_ACU];
  next[CHAT_FILL_MODE_FIELD_ACU] = {
    ...(records && typeof records === 'object' && !Array.isArray(records) ? records : {}),
    [String(getCurrentIsolationKey_ACU() ?? '')]: { mode, recordedAt: Date.now() },
  };
  setChatScopedConfigContainer_ACU(chat, next);
  try {
    await saveChatToHost_ACU();
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
  if (mode === currentMode && current.recordStatus === 'recorded') return { ok: true, mode, changed: false };
  if (mode === 'classic' && hasExistingTableDataForCurrentChat_ACU()) {
    if (current.recordStatus === 'invalid') return { ok: false, reason: 'record_invalid', currentMode };
    if (currentMode !== 'classic') return { ok: false, reason: 'classic_locked', currentMode };
  }
  // 先切换飞行模式：失败则整次切换拒绝，记录保持不变。
  const classicActive = isClassicModeActiveForCurrentChat_ACU();
  if (mode === 'classic' && !classicActive) {
    const enabled = await enableFlightMode_ACU();
    if (!enabled.ok) {
      return { ok: false, reason: 'classic_enable_failed', currentMode, error: describeClassicTransitionFailure_ACU(enabled) };
    }
  } else if (mode !== 'classic' && classicActive) {
    const disabled = await disableFlightMode_ACU({ confirmTemplateScopeChange: options.confirmTemplateScopeChange === true });
    if (!disabled.ok) {
      if (disabled.reason === 'template_scope_changed') return { ok: false, reason: 'template_scope_changed', currentMode };
      return { ok: false, reason: 'classic_disable_failed', currentMode, error: describeClassicTransitionFailure_ACU(disabled) };
    }
  }
  const written = await writeCurrentChatFillMode_ACU(mode);
  if ('reason' in written) {
    return { ok: false, reason: written.reason, currentMode, ...(written.error ? { error: written.error } : {}) };
  }
  return { ok: true, mode, changed: mode !== currentMode };
}

/**
 * 打开对话时为未记录的对话补记模式：新对话按偏好模式；旧对话按它一直沿用的偏好模式固定下来。
 * 从未保存过偏好时，旧对话与旧交火开关保持升级前的推导，不落记录。
 */
export async function ensureCurrentChatFillModeRecorded_ACU(): Promise<EnsureChatFillModeResult_ACU> {
  const current = resolveCurrentChatFillMode_ACU();
  if (current.recordStatus === 'no_chat') return { recorded: false, reason: 'no_active_chat' };
  if (current.recordStatus === 'recorded') return { recorded: false, reason: 'already_recorded' };
  if (current.recordStatus === 'invalid') return { recorded: false, reason: 'record_invalid' };
  if (current.source === 'default' && (hasExistingTableDataForCurrentChat_ACU() || isLegacyCrossfireEnabled_ACU())) {
    return { recorded: false, reason: 'legacy_default' };
  }
  const written = await writeCurrentChatFillMode_ACU(current.mode);
  if ('reason' in written) return { recorded: false, reason: written.reason, ...(written.error ? { error: written.error } : {}) };
  return { recorded: true, mode: current.mode };
}
