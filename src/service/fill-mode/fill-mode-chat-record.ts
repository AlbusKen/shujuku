/**
 * 对话级填表模式记录（读取侧）。
 *
 * 唯一权威：当前聊天 scoped container 的 fillModeByIsolationKey[isolationKey].mode。
 * 没有有效记录时（写入记录前的过渡期，以及决定补记写入哪个值），按 resolveUnrecordedChatFillMode_ACU 推导：
 * 飞行开关已开 → classic；有已加载的旧表格数据 → 有效向量为 crossfire，否则 llm；其余 → 五角星偏好。
 * 读取只做归一化，不回写；记录无法识别时保留原值。
 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU, peekChatScopedConfigField_ACU } from '../../data/storage/chat-history';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { getCurrentFlightModeState_ACU } from '../flight-mode/flight-mode-state';
import { hasLegacyFillModeTableData_ACU, hasLegacyVectorHistoryForCurrentChat_ACU, hasSummaryVectorDataForCurrentChat_ACU } from './fill-mode-chat-evidence';
import {
  isFillMode_ACU,
  readFillModePreferences_ACU,
  type FillMode_ACU,
  type FillModePreferences_ACU,
  type FillModePreferencesRead_ACU,
} from './fill-mode-preferences';

import { CHAT_FILL_MODE_FIELD_ACU, type ChatFillModeRecord_ACU } from './fill-mode-chat-record-fields';
export { CHAT_FILL_MODE_FIELD_ACU, stageChatFillModeRecord_ACU, type ChatFillModeRecord_ACU } from './fill-mode-chat-record-fields';

/** no_chat：未打开对话；absent：尚未记录；invalid：记录无法识别。 */
export type ChatFillModeRecordStatus_ACU = 'recorded' | 'absent' | 'invalid' | 'no_chat';
/** chat：对话记录；legacy：按旧会话数据（飞行开关或旧表格）推导；preferred：五角星偏好。 */
export type ChatFillModeSource_ACU = 'chat' | 'legacy' | 'preferred';

export interface CurrentChatFillMode_ACU {
  mode: FillMode_ACU;
  source: ChatFillModeSource_ACU;
  recordStatus: ChatFillModeRecordStatus_ACU;
  preferences: FillModePreferencesRead_ACU;
}

export interface UnrecordedChatFillModeInput_ACU {
  flightModeActive: boolean;
  /** 已加载且属于旧模式兼容范围的表格数据或旧向量索引历史。 */
  hasLegacyData: boolean;
  /** 同步可读的有效向量；只在 hasLegacyData 时参与判定。 */
  hasSummaryVectorData: boolean;
  preferredMode: FillMode_ACU;
}

export interface UnrecordedChatFillMode_ACU {
  mode: FillMode_ACU;
  source: Exclude<ChatFillModeSource_ACU, 'chat'>;
  /** 推导依据：flight 为飞行开关；legacy_table 为旧表格/向量证据，补记前须异步核验向量。 */
  basis: 'flight' | 'legacy_table' | 'preferred';
}

/** 无记录时的模式推导（纯函数）：过渡期判定与补记共用。 */
export function resolveUnrecordedChatFillMode_ACU(input: UnrecordedChatFillModeInput_ACU): UnrecordedChatFillMode_ACU {
  if (input.flightModeActive) return { mode: 'classic', source: 'legacy', basis: 'flight' };
  if (input.hasLegacyData) {
    return { mode: input.hasSummaryVectorData ? 'crossfire' : 'llm', source: 'legacy', basis: 'legacy_table' };
  }
  return { mode: input.preferredMode, source: 'preferred', basis: 'preferred' };
}

function readRecordSlot_ACU(): { status: ChatFillModeRecordStatus_ACU; record: ChatFillModeRecord_ACU | null } {
  const chat = getChatArray_ACU();
  if (!getActiveChatStorageIdentity_ACU(chat)) return { status: 'no_chat', record: null };
  const records = peekChatScopedConfigField_ACU(chat, CHAT_FILL_MODE_FIELD_ACU);
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

/** 经典方案内部数据：飞行开关是否已启用（隐藏行、大总结、归档）。不参与模式判定。 */
export function isClassicModeActiveForCurrentChat_ACU(): boolean {
  try {
    return getCurrentFlightModeState_ACU().enabled === true;
  } catch (_) {
    return false;
  }
}

/** 按当前聊天的同步证据推导无记录时的模式。 */
export function resolveUnrecordedChatFillModeForCurrentChat_ACU(preferredMode: FillMode_ACU): UnrecordedChatFillMode_ACU {
  const flightModeActive = isClassicModeActiveForCurrentChat_ACU();
  const hasLegacyData = !flightModeActive && (hasLegacyFillModeTableData_ACU() || hasLegacyVectorHistoryForCurrentChat_ACU());
  return resolveUnrecordedChatFillMode_ACU({
    flightModeActive,
    hasLegacyData,
    hasSummaryVectorData: hasLegacyData && hasSummaryVectorDataForCurrentChat_ACU(),
    preferredMode,
  });
}

export function resolveCurrentChatFillMode_ACU(): CurrentChatFillMode_ACU {
  const preferences = readFillModePreferences_ACU();
  const slot = readRecordSlot_ACU();
  if (slot.record) return { mode: slot.record.mode, source: 'chat', recordStatus: 'recorded', preferences };
  if (slot.status === 'no_chat') {
    return { mode: preferences.preferences.selectedMode, source: 'preferred', recordStatus: 'no_chat', preferences };
  }
  const unrecorded = resolveUnrecordedChatFillModeForCurrentChat_ACU(preferences.preferences.selectedMode);
  return { mode: unrecorded.mode, source: unrecorded.source, recordStatus: slot.status, preferences };
}

/** 以当前对话的模式替换 selectedMode，供 resolver 推导运行计划。 */
export function withFillMode_ACU(preferences: FillModePreferences_ACU, mode: FillMode_ACU): FillModePreferences_ACU {
  return mode === preferences.selectedMode ? preferences : { ...preferences, selectedMode: mode };
}
