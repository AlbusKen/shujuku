import { ContinuationValidationError_ACU, type ContinuationError_ACU, type ContinuationErrorCode_ACU, type ContinuationSettings_ACU } from './model';

/**
 * 续写失败的自愈分类。
 * - upstream：上游 API / 宿主生成失败，继续重试只会烧钱，停下等用户。
 * - unsafe：聊天身份、持久化或配置层面的错误，自动续跑可能写坏数据，必须停。
 * - interrupt：用户主动停止或请求已过期，不算失败。
 * - recoverable：Agent 协议、契约、规划类失败，可以由流水线自行恢复。
 */
export type ContinuationRecoveryClass_ACU = 'upstream' | 'unsafe' | 'interrupt' | 'recoverable';

const UPSTREAM_CODES_ACU: ReadonlySet<ContinuationErrorCode_ACU> = new Set<ContinuationErrorCode_ACU>([
  'CONTINUATION_INTERNAL_AI_REQUEST_FAILED',
  'CONTINUATION_API_PRESET_MISSING',
  'CONTINUATION_GENERATION_FAILED',
]);

const UNSAFE_CODES_ACU: ReadonlySet<ContinuationErrorCode_ACU> = new Set<ContinuationErrorCode_ACU>([
  'CONTINUATION_CHAT_CHANGED',
  'CONTINUATION_CHAT_UNAVAILABLE',
  'CONTINUATION_WRITE_GUARD_MISMATCH',
  'CONTINUATION_PERSIST_FAILED',
  'CONTINUATION_ENVELOPE_INVALID',
  'CONTINUATION_MIGRATION_INVALID',
  'CONTINUATION_AGENT_SNAPSHOT_INVALID',
  'CONTINUATION_HOST_INPUT_UNAVAILABLE',
  'CONTINUATION_CONFIG_MISSING',
  'CONTINUATION_CONFIG_NOT_INTEGER',
  'CONTINUATION_CONFIG_OUT_OF_RANGE',
  'CONTINUATION_STAGE_SIZE_INVALID',
  'CONTINUATION_CUSTOM_RANGE_INVALID',
  'CONTINUATION_PROMPT_INVALID',
  'CONTINUATION_PROMPT_EMPTY',
  'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY',
  'CONTINUATION_TASK_NOT_FOUND',
  'CONTINUATION_OPERATION_BUSY',
  'CONTINUATION_REVISION_FROZEN',
]);

function readContinuationError_ACU(error: unknown): ContinuationError_ACU | null {
  if (error instanceof ContinuationValidationError_ACU) return error.error;
  if (error && typeof error === 'object' && 'code' in error && 'phase' in error && typeof (error as { code: unknown }).code === 'string') {
    return error as ContinuationError_ACU;
  }
  return null;
}

export function classifyContinuationError_ACU(error: unknown): ContinuationRecoveryClass_ACU {
  const structured = readContinuationError_ACU(error);
  // 无法识别的异常按上游处理：宁可停下，也不在未知故障上反复烧调用。
  if (!structured) return 'upstream';
  if (structured.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') return 'interrupt';
  if (UPSTREAM_CODES_ACU.has(structured.code)) return 'upstream';
  if (UNSAFE_CODES_ACU.has(structured.code)) return 'unsafe';
  return 'recoverable';
}

/** autoRecoverLimit=0 时整套自愈关闭，行为与改造前一致。 */
export function isAutoRecoverEnabled_ACU(settings: Pick<ContinuationSettings_ACU, 'autoRecoverLimit'>): boolean {
  return Number.isInteger(settings.autoRecoverLimit) && settings.autoRecoverLimit > 0;
}
