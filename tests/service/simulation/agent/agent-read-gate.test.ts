import { describe, expect, it } from 'vitest';
import { createWorldSimulationReadGateState_ACU, gateWorldSimulationReadBatch_ACU, resolveWorldSimulationReadBudget_ACU } from '../../../../src/service/simulation/agent/agent-read-gate';

describe('推演读取预算百分比解析', () => {
  const config = { historyTokenBudget: 1000, readTokenBudget: '60%', fallbackTokens: 50 };

  it('完整合法百分比按历史阈值折算', () => {
    expect(resolveWorldSimulationReadBudget_ACU(config).effectiveMaxReadTokens).toBe(600);
  });

  it('损坏百分比不能利用 parseFloat 前缀扩大额度', () => {
    expect(resolveWorldSimulationReadBudget_ACU({ ...config, readTokenBudget: '60garbage%' }).effectiveMaxReadTokens).toBe(200);
  });
});

it('推演读取超额批次整批拒绝且不消耗后续小批次额度', async () => {
  const state = createWorldSimulationReadGateState_ACU();
  const config = { historyTokenBudget: 1000, readTokenBudget: 100, fallbackTokens: 50 };
  const count = async (text: string) => text.length;
  const rejected = await gateWorldSimulationReadBatch_ACU([
    { label: '$A', text: 'secret-A'.repeat(10) },
    { label: '$B', text: 'secret-B'.repeat(10) },
  ], state, config, 0, count);
  expect(rejected).toMatchObject({ allowed: false, reason: 'read-batch-too-large' });
  expect(rejected.report).not.toContain('secret-A');
  expect(state.grantedTokens).toBe(0);
  expect((await gateWorldSimulationReadBatch_ACU([{ label: '$A', text: 'ok' }], state, config, 0, count)).allowed).toBe(true);
});
