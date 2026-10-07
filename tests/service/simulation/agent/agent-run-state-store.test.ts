import { describe, expect, it } from 'vitest';
import { WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU } from '../../../../src/service/simulation/agent/agent-model';
import { validateWorldSimulationRunStateRecord_ACU } from '../../../../src/service/simulation/agent/agent-run-state-store';

const record = (subagentOutcomes: unknown[]) => ({
  schemaVersion: WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU,
  taskId: 'task-1',
  cursorKey: 'cursor-1',
  updatedAt: 1,
  state: {
    taskId: 'task-1', cursorKey: 'cursor-1', nextIteration: 2, delegationsUsed: 0, perAgent: {}, outcomes: [],
    candidateFingerprint: 'fp', candidateSummary: '', reviewerFeedback: '', subagentOutcomes,
  },
});

describe('格林推演 run 恢复状态校验', () => {
  it('子代理结果带材料完成度字段时照常通过并原样保留', () => {
    const outcome = {
      agentName: 'guidance-composer', status: 'candidate', summary: '已提交', evidenceRefs: [], uncertainties: [],
      completion: 'partial',
      moduleCompletion: { guidance: 'complete_changed', rumors: 'failed' },
      unresolvedIssues: [{ module: 'rumors', source: 'contract_rejected', path: 'rumors[0].channels', message: '渠道缺失' }],
      acceptedKeys: ['guidance'],
    };
    const validated = validateWorldSimulationRunStateRecord_ACU(record([outcome]));
    expect(validated.state.subagentOutcomes).toEqual([outcome]);
  });

  it('完成度取值非法或出现真正未知的字段时仍拒绝', () => {
    const base = { agentName: 'dramatis-keeper', status: 'no_change', summary: '无变化', evidenceRefs: [], uncertainties: [] };
    expect(() => validateWorldSimulationRunStateRecord_ACU(record([{ ...base, completion: 'legacy_unknown' }]))).toThrow('completion 枚举非法');
    expect(() => validateWorldSimulationRunStateRecord_ACU(record([{ ...base, moduleCompletion: { stage: 'failed' } }]))).toThrow('moduleCompletion.stage 枚举非法');
    expect(() => validateWorldSimulationRunStateRecord_ACU(record([{ ...base, unexpected: true }]))).toThrow('unexpected 是未知字段');
  });
});
