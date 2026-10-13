import { describe, expect, it } from 'vitest';

import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationErrorCode_ACU } from '../../../src/service/continuation/model';
import { classifyContinuationError_ACU, isAutoRecoverEnabled_ACU } from '../../../src/service/continuation/recovery-policy';

function err_ACU(code: ContinuationErrorCode_ACU): ContinuationValidationError_ACU {
  return new ContinuationValidationError_ACU(createContinuationError_ACU(code, 'agent_loop', code));
}

describe('续写错误自愈分类', () => {
  it.each<ContinuationErrorCode_ACU>([
    'CONTINUATION_INTERNAL_AI_REQUEST_FAILED',
    'CONTINUATION_API_PRESET_MISSING',
    'CONTINUATION_GENERATION_FAILED',
  ])('%s 归为上游故障', code => {
    expect(classifyContinuationError_ACU(err_ACU(code))).toBe('upstream');
  });

  it.each<ContinuationErrorCode_ACU>([
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
    'CONTINUATION_PROMPT_INVALID',
    'CONTINUATION_PROMPT_EMPTY',
    'CONTINUATION_ORIGIN_INSTRUCTION_EMPTY',
    'CONTINUATION_TASK_NOT_FOUND',
    'CONTINUATION_OPERATION_BUSY',
  ])('%s 归为数据安全类，不自愈', code => {
    expect(classifyContinuationError_ACU(err_ACU(code))).toBe('unsafe');
  });

  it('INTERNAL_REQUEST_STALE 归为用户中断', () => {
    expect(classifyContinuationError_ACU(err_ACU('CONTINUATION_INTERNAL_REQUEST_STALE'))).toBe('interrupt');
  });

  it.each<ContinuationErrorCode_ACU>([
    'CONTINUATION_AGENT_PROTOCOL_INVALID',
    'CONTINUATION_AGENT_ITERATIONS_EXHAUSTED',
    'CONTINUATION_AGENT_BLOCKED',
    'CONTINUATION_AGENT_SUBAGENT_FAILED',
    'CONTINUATION_AGENT_WRITE_REJECTED',
    'CONTINUATION_TURN_INSTRUCTION_EMPTY',
    'CONTINUATION_TURN_INSTRUCTION_RETRY_EXHAUSTED',
    'CONTINUATION_OUTLINE_JSON_INVALID',
    'CONTINUATION_OUTLINE_RETRY_EXHAUSTED',
    'CONTINUATION_GENERATION_TAGS_MISSING',
    'CONTINUATION_GENERATION_TOO_SHORT',
    'CONTINUATION_TASK_STATE_INVALID',
  ])('%s 归为可自愈', code => {
    expect(classifyContinuationError_ACU(err_ACU(code))).toBe('recoverable');
  });

  it('结构化错误对象（非异常实例）同样可分类', () => {
    expect(classifyContinuationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_BLOCKED', 'agent_loop', 'x'))).toBe('recoverable');
  });

  it('普通异常一律按上游处理（宁停勿烧）', () => {
    expect(classifyContinuationError_ACU(new Error('boom'))).toBe('upstream');
    expect(classifyContinuationError_ACU('boom')).toBe('upstream');
    expect(classifyContinuationError_ACU(undefined)).toBe('upstream');
  });

  it('autoRecoverLimit 为 0 时关闭自动模式', () => {
    expect(isAutoRecoverEnabled_ACU({ autoRecoverLimit: 0 })).toBe(false);
    expect(isAutoRecoverEnabled_ACU({ autoRecoverLimit: 3 })).toBe(true);
  });
});
