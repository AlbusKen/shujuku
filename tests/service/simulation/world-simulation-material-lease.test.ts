import { describe, expect, it } from 'vitest';
import { createAgentWorldbookGrantSource_ACU } from '../../../src/service/continuation/agent/agent-worldbook-read';
import { captureWorldSimulationMaterialLease_ACU, rebindWorldSimulationMaterialLeaseGrants_ACU, sameWorldSimulationMaterialLease_ACU } from '../../../src/service/simulation/world-simulation-material-lease';

const context = (patch: any = {}) => ({ feature: 'world-simulation' as const, runId: 'run-1', chatIdentity: 'chat-1', branchIdentity: 'branch-1', sourceRevision: 'anchor:5;settled:2', sourceDigest: 'story-d1', profile: 'world-director' as const, overview: { state: 'ready' as const, text: '概览正文', digest: 'overview-d1', diagnostic: '' }, pending: { text: '新增正文', digest: 'pending-d1' }, bridge: { text: '', digest: 'bridge-d1' }, catalog: { text: '目录', digest: 'catalog-d1' }, ...patch });
const requirements = (revision = 2) => ({ feature: 'world-simulation' as const, revision, lastAppliedUserMessageId: null, requirements: [] });
const entry = (content = '港口封锁') => ({ bookName: '港口', uid: '1', title: '宵禁', keys: ['港口'], constant: false, content, tokens: 2 });

function grant(content = '港口封锁') {
  const source = createAgentWorldbookGrantSource_ACU(entry(content));
  return { grantId: 'W1', source, content };
}

describe('WorldSimulationMaterialLease_ACU', () => {
  it('captures only stable identities and treats requirements/overview/story changes as stale', () => {
    const lease = captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot: requirements(), storyContext: context(), settledThroughIndex: 2, grants: [grant()] });
    expect(lease).toEqual(expect.objectContaining({ requirementsRevision: 2, overviewDigest: 'overview-d1', storySourceDigest: 'story-d1', storySourceRevision: 'anchor:5;settled:2', settledThroughIndex: 2 }));
    expect(JSON.stringify(lease)).not.toContain('概览正文');
    expect(JSON.stringify(lease)).not.toContain('港口封锁');
    expect(sameWorldSimulationMaterialLease_ACU(lease, captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot: requirements(), storyContext: context(), settledThroughIndex: 2, grants: [grant()] }))).toBe(true);
    expect(sameWorldSimulationMaterialLease_ACU(lease, captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot: requirements(3), storyContext: context(), settledThroughIndex: 2, grants: [grant()] }))).toBe(false);
    expect(sameWorldSimulationMaterialLease_ACU(lease, captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot: requirements(), storyContext: context({ sourceDigest: 'story-d2' }), settledThroughIndex: 2, grants: [grant()] }))).toBe(false);
    expect(sameWorldSimulationMaterialLease_ACU(lease, captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot: requirements(), storyContext: context({ overview: { ...context().overview, digest: 'overview-d2' } }), settledThroughIndex: 2, grants: [grant()] }))).toBe(false);
  });

  it('rebinds granted sources against a fresh frozen worldbook and rejects changed or missing entries', () => {
    const lease = captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot: requirements(), storyContext: context(), settledThroughIndex: 2, grants: [grant()] });
    expect(sameWorldSimulationMaterialLease_ACU(lease, rebindWorldSimulationMaterialLeaseGrants_ACU(lease, { available: true, entries: [entry()] }))).toBe(true);
    expect(sameWorldSimulationMaterialLease_ACU(lease, rebindWorldSimulationMaterialLeaseGrants_ACU(lease, { available: true, entries: [entry('港口已解除封锁')] }))).toBe(false);
    expect(sameWorldSimulationMaterialLease_ACU(lease, rebindWorldSimulationMaterialLeaseGrants_ACU(lease, { available: true, entries: [] }))).toBe(false);
  });
});
