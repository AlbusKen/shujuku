import { describe, expect, it } from 'vitest';
import { validateContinuationTakeoverAssessment_ACU } from '../../../src/service/continuation/continuation-takeover';

describe('ContinuationTakeoverAssessment_ACU', () => {
  it('accepts only the closed assessment shape', () => {
    expect(validateContinuationTakeoverAssessment_ACU({
      targetMessageIndex: 8,
      disposition: 'continue_current_stage',
      satisfiedTurnIds: ['turn-2'],
      evidenceMessageIndexes: [6, 8],
      requiresStoryArcRevision: false,
      reason: '第六至第八楼完整推进了第二轮目标。',
    })).toMatchObject({ targetMessageIndex: 8, satisfiedTurnIds: ['turn-2'] });
  });

  it('rejects floor-count inference shapes, future evidence and unknown fields', () => {
    const base = { targetMessageIndex: 8, disposition: 'continue_current_stage', satisfiedTurnIds: ['turn-2'], evidenceMessageIndexes: [6], requiresStoryArcRevision: false, reason: '有正文证据' };
    expect(() => validateContinuationTakeoverAssessment_ACU({ ...base, completedTurns: 3 })).toThrow(/未知字段/);
    expect(() => validateContinuationTakeoverAssessment_ACU({ ...base, evidenceMessageIndexes: [9] })).toThrow(/不得晚于目标楼/);
    expect(() => validateContinuationTakeoverAssessment_ACU({ ...base, satisfiedTurnIds: [] })).toThrow(/至少必须认领一个连续轮次/);
  });
});
