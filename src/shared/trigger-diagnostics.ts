import { logDebug_ACU, logWarn_ACU } from './utils';
import { pushLog } from './log-buffer';

const AUTO_FILL_SKIP_WARN_REASONS_ACU = new Set<AutoFillSkipReason_ACU>([
  'ambiguous_generated_ai_message',
  'generated_ai_message_not_materialized',
  'resolved_message_not_ai',
]);

export type AutoFillSkipReason_ACU =
  | 'quiet_or_background_generation'
  | 'user_aborted'
  | 'core_apis_not_ready'
  | 'empty_chat'
  | 'last_message_not_ai'
  | 'generated_ai_message_not_materialized'
  | 'ambiguous_generated_ai_message'
  | 'resolved_message_not_ai'
  | 'different_character'
  | 'message_evaluation_skipped'
  | 'chat_changed'
  | 'auto_update_coalesced'
  | 'preconditions_failed'
  | 'initial_chat_message'
  | 'untracked_generation'
  | 'no_tables_due'
  | 'reply_below_threshold'
  | 'execution_failed'
  | 'request_failed'
  | 'input_preparation_failed'
  | 'commit_failed'
  | 'staging_runner_unavailable'
  | 'refresh_failed';

export interface AutoFillSkipContext_ACU {
  eventType?: string;
  messageId?: unknown;
  /** 事件锚点楼层号（宿主 GENERATION_ENDED 参数，不承诺是 AI 楼层） */
  eventMessageId?: unknown;
  chatKey?: string;
  isolationKey?: string;
  /** 防抖回调执行时的当前隔离键（用于区分“捕获时”与“执行时”） */
  liveIsolationKey?: string;
  lastGenerationType?: unknown;
  aiFloorCount?: number;
  /** 捕获时聊天数组长度 */
  capturedChatLength?: number;
  /** 捕获时 AI 楼层数 */
  capturedAiFloorCount?: number;
  /** 防抖回调执行时的聊天数组长度 */
  liveChatLength?: number;
  /** 防抖回调执行时的 AI 楼层数 */
  liveAiFloorCount?: number;
  /** 最终解析出的本轮 AI 楼层索引 */
  resolvedMessageIndex?: number;
  /** 解析阶段的候选楼层索引 */
  candidateIndexes?: number[];
  inFlight?: boolean;
  /** 前置检查失败分支的稳定原因码（来自 checkAutoUpdatePreConditions_ACU） */
  preconditionReason?: string;
  runId?: string;
  queueId?: number;
  stage?: string;
  groupCount?: number;
  sheetCount?: number;
  failedGroupCount?: number;
  batchNumber?: number;
  attempt?: number;
  replyLength?: number;
  threshold?: number;
  diagnosticCode?: string;
  errorCategory?: string;
  apiMode?: string;
  apiSource?: 'current' | 'fixed' | 'snapshot';
  success?: boolean;
}

export function logAutoFillSkip_ACU(
  reason: AutoFillSkipReason_ACU,
  context: AutoFillSkipContext_ACU = {},
): void {
  logTriggerSkip_ACU('[AutoFill]', reason, context);
}

export function logContentOptimizationSkip_ACU(
  reason: AutoFillSkipReason_ACU,
  context: AutoFillSkipContext_ACU = {},
): void {
  logTriggerSkip_ACU('[ContentOptimization]', reason, context);
}

/** 详细过程遵从 Debug 开关；仅挑选诊断字段，不序列化业务载荷。 */
export function logAutoFillStage_ACU(stage: string, context: AutoFillSkipContext_ACU = {}): void {
  logDebug_ACU('[AutoFill] Stage', { ...pickTriggerContext_ACU(context), stage });
}

function logTriggerSkip_ACU(
  source: string,
  reason: AutoFillSkipReason_ACU,
  context: AutoFillSkipContext_ACU,
): void {
  const detail = { reason, ...pickTriggerContext_ACU(context) };
  if (source === '[AutoFill]') {
    pushLog('debug', ['[ACU]', `${source} Trigger skipped`, detail]);
    return;
  }
  const log = AUTO_FILL_SKIP_WARN_REASONS_ACU.has(reason) ? logWarn_ACU : logDebug_ACU;
  log(`${source} Trigger skipped`, detail);
}

function pickTriggerContext_ACU(context: AutoFillSkipContext_ACU): AutoFillSkipContext_ACU {
  const {
    eventType,
    messageId,
    eventMessageId,
    chatKey,
    isolationKey,
    liveIsolationKey,
    lastGenerationType,
    aiFloorCount,
    capturedChatLength,
    capturedAiFloorCount,
    liveChatLength,
    liveAiFloorCount,
    resolvedMessageIndex,
    candidateIndexes,
    inFlight,
    preconditionReason,
    runId, queueId, stage, groupCount, sheetCount, failedGroupCount,
    batchNumber, attempt, replyLength, threshold, diagnosticCode,
    errorCategory, apiMode, apiSource, success,
  } = context;
  return {
    eventType,
    messageId,
    eventMessageId,
    chatKey,
    isolationKey,
    liveIsolationKey,
    lastGenerationType,
    aiFloorCount,
    capturedChatLength,
    capturedAiFloorCount,
    liveChatLength,
    liveAiFloorCount,
    resolvedMessageIndex,
    candidateIndexes,
    inFlight,
    preconditionReason,
    runId, queueId, stage, groupCount, sheetCount, failedGroupCount,
    batchNumber, attempt, replyLength, threshold, diagnosticCode,
    errorCategory, apiMode, apiSource, success,
  };
}
