/**
 * 打开对话时的填表模式协调：补记模式 → 经典模式补完飞行开关 → 登记经典就绪状态。
 * 就绪状态按 chatKey + isolationKey 存于内存，不持久化，下次打开对话重新评估。
 * 经典启用失败不改写模式记录：记录仍为 classic，剧情与向量门禁照常按模式跳过。
 */
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { notifyChatConfigurationChanged_ACU } from '../../shared/chat-configuration-change';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import {
  enableFlightMode_ACU,
  hasPendingFlightModeEnable_ACU,
  type FlightModeTransitionResult_ACU,
} from '../flight-mode/flight-mode-transition';
import { isClassicModeActiveForCurrentChat_ACU, resolveCurrentChatFillMode_ACU } from './fill-mode-chat-record';
import {
  describeClassicTransitionFailure_ACU,
  ensureCurrentChatFillModeRecorded_ACU,
  type EnsureChatFillModeResult_ACU,
} from './fill-mode-chat-switch';

export type ClassicReadinessFailure_ACU =
  | NonNullable<FlightModeTransitionResult_ACU['reason']>
  | 'record_invalid'
  | 'enable_exception';

export type ClassicReadiness_ACU =
  | { status: 'not_classic' }
  | { status: 'ready' }
  | { status: 'pending'; reason: 'table_not_loaded' | 'not_reconciled' | 'chat_changed' }
  | { status: 'failed'; reason: ClassicReadinessFailure_ACU; error: string };

export interface ReconcileFillModeOptions_ACU {
  /** 表格数据已可靠加载（刷新未降级）。未加载时不补记也不补完。 */
  tableLoaded: boolean;
}

export interface ReconcileFillModeResult_ACU {
  record: EnsureChatFillModeResult_ACU | null;
  readiness: ClassicReadiness_ACU;
}

const readinessByScope_ACU = new Map<string, ClassicReadiness_ACU>();
const inFlightByScope_ACU = new Map<string, Promise<ReconcileFillModeResult_ACU>>();

function currentScopeKey_ACU(): string {
  return `${String(currentChatFileIdentifier_ACU || '')}\u0000${String(getCurrentIsolationKey_ACU() ?? '')}`;
}

function isClassicReady_ACU(): boolean {
  return isClassicModeActiveForCurrentChat_ACU() && !hasPendingFlightModeEnable_ACU();
}

function setReadiness_ACU(scopeKey: string, readiness: ClassicReadiness_ACU): void {
  const previous = readinessByScope_ACU.get(scopeKey);
  readinessByScope_ACU.set(scopeKey, readiness);
  if (JSON.stringify(previous) !== JSON.stringify(readiness)) notifyChatConfigurationChanged_ACU('fill-mode');
}

/** 当前对话的经典就绪状态；非经典模式返回 not_classic。 */
export function getClassicReadinessForCurrentChat_ACU(): ClassicReadiness_ACU {
  const current = resolveCurrentChatFillMode_ACU();
  if (current.recordStatus === 'no_chat' || current.mode !== 'classic') return { status: 'not_classic' };
  if (isClassicReady_ACU()) return { status: 'ready' };
  const stored = readinessByScope_ACU.get(currentScopeKey_ACU());
  if (!stored || stored.status === 'ready' || stored.status === 'not_classic') return { status: 'pending', reason: 'not_reconciled' };
  return stored;
}

async function runReconcile_ACU(scopeKey: string, options: ReconcileFillModeOptions_ACU): Promise<ReconcileFillModeResult_ACU> {
  if (resolveCurrentChatFillMode_ACU().recordStatus === 'no_chat') return { record: null, readiness: { status: 'not_classic' } };
  if (!options.tableLoaded) {
    setReadiness_ACU(scopeKey, { status: 'pending', reason: 'table_not_loaded' });
    return { record: null, readiness: getClassicReadinessForCurrentChat_ACU() };
  }

  let record: EnsureChatFillModeResult_ACU | null = null;
  try {
    record = await ensureCurrentChatFillModeRecorded_ACU();
  } catch (error) {
    logWarn_ACU('[填表模式] 对话填表模式补记异常:', error);
  }
  if (currentScopeKey_ACU() !== scopeKey) return { record, readiness: { status: 'pending', reason: 'chat_changed' } };

  const current = resolveCurrentChatFillMode_ACU();
  if (current.mode !== 'classic') {
    readinessByScope_ACU.delete(scopeKey);
    return { record, readiness: { status: 'not_classic' } };
  }
  if (isClassicReady_ACU()) {
    setReadiness_ACU(scopeKey, { status: 'ready' });
    return { record, readiness: { status: 'ready' } };
  }
  if (current.recordStatus === 'invalid') {
    const readiness: ClassicReadiness_ACU = { status: 'failed', reason: 'record_invalid', error: '对话填表模式记录无法识别，未启用经典表格。' };
    setReadiness_ACU(scopeKey, readiness);
    return { record, readiness };
  }

  let readiness: ClassicReadiness_ACU;
  try {
    const result = await enableFlightMode_ACU();
    if (result.ok) {
      readiness = { status: 'ready' };
      logDebug_ACU(`[填表模式] 经典表格已启用：scope=${scopeKey.replace('\u0000', '/')}, reason=${result.reason || 'enabled'}`);
    } else {
      readiness = { status: 'failed', reason: result.reason || 'commit_failed', error: describeClassicTransitionFailure_ACU(result) };
      logWarn_ACU(`[填表模式] 经典表格启用失败：scope=${scopeKey.replace('\u0000', '/')}, reason=${readiness.reason}, error=${readiness.error}`);
    }
  } catch (error: any) {
    readiness = { status: 'failed', reason: 'enable_exception', error: String(error?.message || error || '未知错误') };
    logWarn_ACU('[填表模式] 经典表格启用异常:', error);
  }
  setReadiness_ACU(scopeKey, readiness);
  return { record, readiness };
}

/** 打开对话的唯一协调入口；同一对话并发调用复用同一次执行。 */
export function reconcileCurrentChatFillModeOnOpen_ACU(options: ReconcileFillModeOptions_ACU): Promise<ReconcileFillModeResult_ACU> {
  const scopeKey = currentScopeKey_ACU();
  const existing = inFlightByScope_ACU.get(scopeKey);
  if (existing) return existing;
  const task = runReconcile_ACU(scopeKey, options).finally(() => {
    if (inFlightByScope_ACU.get(scopeKey) === task) inFlightByScope_ACU.delete(scopeKey);
  });
  inFlightByScope_ACU.set(scopeKey, task);
  return task;
}

/** 手动重新启用经典表格：经同一协调入口补记与补完。 */
export async function retryClassicEnableForCurrentChat_ACU(): Promise<ClassicReadiness_ACU> {
  const tableLoaded = !!currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object';
  return (await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded })).readiness;
}

/** 仅供测试：清空就绪状态与并发标记。 */
export function __resetFillModeReconcileForTests_ACU(): void {
  readinessByScope_ACU.clear();
  inFlightByScope_ACU.clear();
}
