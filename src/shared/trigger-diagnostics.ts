import { logDebug_ACU, logWarn_ACU } from './utils';

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
  | 'no_tables_due';

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

function logTriggerSkip_ACU(
  source: string,
  reason: AutoFillSkipReason_ACU,
  context: AutoFillSkipContext_ACU,
): void {
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
  } = context;
  const log = AUTO_FILL_SKIP_WARN_REASONS_ACU.has(reason) ? logWarn_ACU : logDebug_ACU;
  log(`${source} Trigger skipped`, {
    reason,
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
  });
}
