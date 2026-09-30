import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import {
  getChatScopedConfigContainer_ACU,
  normalizeChatScopedConfigContainer_ACU,
  setChatScopedConfigContainer_ACU,
} from '../../data/storage/chat-history';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
  FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
  type FlightModeEnableCheck_ACU,
  type FlightModeState_ACU,
} from '../../shared/models/flight-mode-model';
import { getClassicRecentChronicleRows_ACU } from '../fill-mode/fill-mode-preferences';

function normalizeHiddenRowIds_ACU(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  value.forEach((raw) => {
    const id = String(raw ?? '').trim();
    if (id) ids.add(id);
  });
  return [...ids];
}

export function normalizeFlightModeState_ACU(value: unknown): FlightModeState_ACU {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: raw.enabled === true,
    enabledAt: Number.isFinite(raw.enabledAt) ? Math.max(0, Math.trunc(raw.enabledAt as number)) : 0,
    hiddenRowIds: normalizeHiddenRowIds_ACU(raw.hiddenRowIds),
    bigSummarySheetKey: String(raw.bigSummarySheetKey || FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU),
    ...(raw.archive && typeof raw.archive === 'object' && !Array.isArray(raw.archive) ? { archive: raw.archive as FlightModeState_ACU['archive'] } : {}),
  };
}

export function getCurrentFlightModeState_ACU(): FlightModeState_ACU {
  const container = getChatScopedConfigContainer_ACU(getChatArray_ACU());
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  const states = container?.flightModeByIsolationKey;
  if (states && typeof states === 'object' && !Array.isArray(states)) {
    return normalizeFlightModeState_ACU((states as Record<string, unknown>)[isolationKey]);
  }
  return normalizeFlightModeState_ACU(null);
}

/**
 * 将隐藏行状态暂存到当前聊天 scoped container，并返回可在同一提交失败时调用的回滚函数。
 * 调用方必须把此操作放在表格快照写入聊天前，不能在持久化成功后另起一次 saveChat。
 */
export function stageFlightModeHiddenRowIds_ACU(hiddenRowIds: string[]): (() => void) | null {
  const chat = getChatArray_ACU();
  const previousContainer = getChatScopedConfigContainer_ACU(chat);
  const currentState = getCurrentFlightModeState_ACU();
  if (!currentState.enabled) return null;

  const previousSnapshot = previousContainer ? JSON.parse(JSON.stringify(previousContainer)) : null;
  const nextContainer = normalizeChatScopedConfigContainer_ACU(previousContainer);
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  const states = nextContainer.flightModeByIsolationKey;
  nextContainer.flightModeByIsolationKey = {
    ...(states && typeof states === 'object' && !Array.isArray(states) ? states : {}),
    [isolationKey]: normalizeFlightModeState_ACU({ ...currentState, hiddenRowIds }),
  };
  setChatScopedConfigContainer_ACU(chat, nextContainer);

  return () => setChatScopedConfigContainer_ACU(chat, previousSnapshot);
}

export function setCurrentFlightModeState_ACU(next: FlightModeState_ACU): FlightModeState_ACU {
  const chat = getChatArray_ACU();
  const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  const states = container.flightModeByIsolationKey;
  container.flightModeByIsolationKey = {
    ...(states && typeof states === 'object' && !Array.isArray(states) ? states : {}),
    [isolationKey]: normalizeFlightModeState_ACU(next),
  };
  setChatScopedConfigContainer_ACU(chat, container);
  return getCurrentFlightModeState_ACU();
}

export function isFlightModeActive_ACU(): boolean {
  return getCurrentFlightModeState_ACU().enabled;
}

function getChronicleSheet_ACU(tableData: any): any | null {
  if (!tableData || typeof tableData !== 'object') return null;
  return Object.values(tableData).find((sheet: any) => sheet?.name === '纪要表') || null;
}

export function countVisibleChronicleRows_ACU(tableData: any = currentJsonTableData_ACU): number {
  const chronicle = getChronicleSheet_ACU(tableData);
  if (!Array.isArray(chronicle?.content)) return 0;
  const hidden = new Set(getCurrentFlightModeState_ACU().hiddenRowIds);
  return chronicle.content.slice(1).filter((row: any) => Array.isArray(row) && !hidden.has(String(row[0] ?? '').trim())).length;
}

/** 启用门槛与大总结提示词中的条数共用经典模式 recentChronicleRows。 */
export function canEnableFlightMode_ACU(
  tableData: any = currentJsonTableData_ACU,
  maxVisibleRows: number = getClassicRecentChronicleRows_ACU(),
): FlightModeEnableCheck_ACU {
  if (!getChronicleSheet_ACU(tableData)) {
    return { canEnable: false, visibleChronicleRowCount: 0, reason: 'chronicle_not_found' };
  }
  const visibleChronicleRowCount = countVisibleChronicleRows_ACU(tableData);
  if (visibleChronicleRowCount > maxVisibleRows) {
    return { canEnable: false, visibleChronicleRowCount, reason: 'too_many_visible_chronicle_rows' };
  }
  return { canEnable: true, visibleChronicleRowCount };
}
