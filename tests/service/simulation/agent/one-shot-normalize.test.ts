import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { normalizeOneShotSpecialistPayload_ACU } from '../../../../src/service/simulation/agent/agent-protocol';

const context = () => ({
  agentName: 'undercurrent-analyst',
  writableModules: ['clock', 'dimensions', 'seeds'] as const,
  givenLedger: buildEmptyWorldSimulationLedger_ACU(),
  baseLedgerRevision: 0,
  anchorEvidenceRef: 'anchor-ref',
  authorizedRefs: new Set(['anchor-ref']),
});

describe('一次性候选 SQL 归一化', () => {
  it('接管单例修订号，并为缺省证据绑定锚点而非接受越权顶层引用', () => {
    const result = normalizeOneShotSpecialistPayload_ACU({
      status: 'candidate', agentName: 'undercurrent-analyst', evidenceRefs: ['unauthorized'],
      sql: 'UPDATE clock SET days = 1 WHERE expected_revision = 999',
    }, context());
    expect(result.payload).toMatchObject({ status: 'candidate', evidenceRefs: ['anchor-ref'],
      patch: { clock: { days: 1, expectedRevision: 0, evidenceRefs: ['anchor-ref'] } } });
    expect(result.issues).toEqual([]);
  });

  it('越权表语句隔离为 issue，保留同一输出中的合法语句', () => {
    const result = normalizeOneShotSpecialistPayload_ACU({ status: 'candidate',
      sql: "UPDATE player SET contact = 'open' WHERE expected_revision = 0; UPDATE clock SET days = 1 WHERE expected_revision = 0",
    }, context());
    expect(result.payload.status).toBe('candidate');
    expect((result.payload.patch as Record<string, unknown>)).toHaveProperty('clock');
    expect((result.payload.patch as Record<string, unknown>)).not.toHaveProperty('player');
    expect(result.issues).toEqual([expect.objectContaining({ source: 'contract_rejected', path: '$.sql[0]' })]);
  });

  it('数组行 UPDATE 不存在的 id 不会凭模型给出的 revision 创建行', () => {
    const result = normalizeOneShotSpecialistPayload_ACU({ status: 'candidate',
      sql: "UPDATE seeds SET status = 'active' WHERE id = 'missing' AND expected_revision = 999",
    }, context());
    expect(result.payload.status).toBe('failed');
    expect(result.issues[0].message).toContain('not_found');
  });
});
