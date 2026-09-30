/**
 * 对话级填表模式记录（读取侧）。
 *
 * 权威存储：当前聊天 scoped container 的 fillModeByIsolationKey[isolationKey]（独立字段）。
 * 已记录的对话按记录运行；未记录时回落全局偏好模式 formFillPreferencesGlobal.selectedMode（五角星）。
 * 读取只做归一化，不回写；记录无法识别时保留原值，按偏好模式运行。
 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU, peekChatScopedConfigContainer_ACU } from '../../data/storage/chat-history';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { getCurrentFlightModeState_ACU } from '../flight-mode/flight-mode-state';
import {
  isFillMode_ACU,
  readFillModePreferences_ACU,
  type FillMode_ACU,
  type FillModePreferences_ACU,
  type FillModePreferencesRead_ACU,
} from './fill-mode-preferences';

export const CHAT_FILL_MODE_FIELD_ACU = 'fillModeByIsolationKey';

export interface ChatFillModeRecord_ACU {
  mode: FillMode_ACU;
  recordedAt: number;
}

/** no_chat：未打开对话；absent：尚未记录；invalid：记录无法识别。 */
export type ChatFillModeRecordStatus_ACU = 'recorded' | 'absent' | 'invalid' | 'no_chat';
/** chat：对话记录；preferred：沿用已保存的偏好；default：偏好也从未保存。 */
export type ChatFillModeSource_ACU = 'chat' | 'preferred' | 'default';

export interface CurrentChatFillMode_ACU {
  mode: FillMode_ACU;
  source: ChatFillModeSource_ACU;
  recordStatus: ChatFillModeRecordStatus_ACU;
  preferences: FillModePreferencesRead_ACU;
}

function readRecordSlot_ACU(): { status: ChatFillModeRecordStatus_ACU; record: ChatFillModeRecord_ACU | null } {
  const chat = getChatArray_ACU();
  if (!getActiveChatStorageIdentity_ACU(chat)) return { status: 'no_chat', record: null };
  const records = peekChatScopedConfigContainer_ACU(chat)?.[CHAT_FILL_MODE_FIELD_ACU];
  if (records === undefined || records === null) return { status: 'absent', record: null };
  if (typeof records !== 'object' || Array.isArray(records)) return { status: 'invalid', record: null };
  const raw = (records as Record<string, unknown>)[String(getCurrentIsolationKey_ACU() ?? '')];
  if (raw === undefined || raw === null) return { status: 'absent', record: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { status: 'invalid', record: null };
  const slot = raw as Record<string, unknown>;
  const mode = slot.mode;
  if (!isFillMode_ACU(mode)) return { status: 'invalid', record: null };
  const recordedAt = Number(slot.recordedAt);
  return { status: 'recorded', record: { mode, recordedAt: Number.isFinite(recordedAt) ? Math.max(0, Math.trunc(recordedAt)) : 0 } };
}

/** 经典表格模式与飞行模式是同一个开关：飞行模式启用即为经典模式。 */
export function isClassicModeActiveForCurrentChat_ACU(): boolean {
  try {
    return getCurrentFlightModeState_ACU().enabled === true;
  } catch (_) {
    return false;
  }
}

export function resolveCurrentChatFillMode_ACU(): CurrentChatFillMode_ACU {
  const preferences = readFillModePreferences_ACU();
  if (isClassicModeActiveForCurrentChat_ACU()) {
    return { mode: 'classic', source: 'chat', recordStatus: 'recorded', preferences };
  }
  const slot = readRecordSlot_ACU();
  if (slot.record) return { mode: slot.record.mode, source: 'chat', recordStatus: 'recorded', preferences };
  return {
    mode: preferences.preferences.selectedMode,
    source: preferences.source === 'default' ? 'default' : 'preferred',
    recordStatus: slot.status,
    preferences,
  };
}

/** 以当前对话的模式替换 selectedMode，供 resolver 推导运行计划。 */
export function withFillMode_ACU(preferences: FillModePreferences_ACU, mode: FillMode_ACU): FillModePreferences_ACU {
  return mode === preferences.selectedMode ? preferences : { ...preferences, selectedMode: mode };
}
