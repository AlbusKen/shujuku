import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { planLegacyRumorFacts_ACU } from '../../../src/service/simulation/world-legacy-rumor-backfill';
import { validateWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-store';
import { checkWorldFactRevealGate_ACU } from '../../../src/service/simulation/world-fact-gate';

function fixture() {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.clock.day = 4;
  ledger.seeds = [{ id: 'seed', title: '合约谈判', status: 'active', level: 1, catalyst: '已有谈判', visibility: 'hidden',
    actorIds: [], location: { region: '城区', place: '钟楼' }, expiresAtDay: null, missedOutcome: null,
    exposePolicy: 'on_collision', evidenceRefs: ['e1'], retiredReason: null, revision: 1 }];
  ledger.rumors = [{ id: 'rumor', fact: '钟楼密约已经签订', originDay: 2, earliestRevealDay: 3, channels: ['钟楼'],
    relatedActorIds: [], status: 'latent', revealedAtDay: null, revision: 1 }];
  ledger.chronicle = [{ id: 'chronicle', at: '第2日', summary: '钟楼密约已经签订', relatedIds: ['seed'],
    evidenceRefs: ['e1'], missedNote: '主角错过签约' }];
  return validateWorldSimulationLedger_ACU(ledger);
}

describe('旧风声的确定性互证补迁', () => {
  it('只将严格同文纪要与唯一地点互证的旧风声迁成锁定 gated fact，保留来源与原文', () => {
    const ledger = fixture();
    const before = structuredClone(ledger);
    const facts = planLegacyRumorFacts_ACU(ledger);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ summary: '钟楼密约已经签订', happenedAt: { day: 2, slot: '' },
      projectionPolicy: 'gated', revealState: 'locked', locationRef: { region: '城区', place: '钟楼' },
      sourceRefs: ['legacy:rumors:rumor', 'legacy:chronicle:chronicle'], evidenceRefs: ['e1'],
      revealGate: { notBefore: { day: 3, slot: '' } } });
    const migrated = validateWorldSimulationLedger_ACU({ ...ledger, facts });
    expect(checkWorldFactRevealGate_ACU(migrated, facts[0].id, { day: 2, slot: '' }, { region: '城区', place: '钟楼' }, []))
      .toMatchObject({ status: 'blocked' });
    expect(checkWorldFactRevealGate_ACU(migrated, facts[0].id, { day: 4, slot: '' }, { region: '城区', place: '钟楼' }, []))
      .toMatchObject({ status: 'semantic-review-required' });
    expect(planLegacyRumorFacts_ACU(migrated)).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it('冷层中已互证的旧风声不再生成重复热事实', () => {
    const ledger = fixture();
    const migrated = planLegacyRumorFacts_ACU(ledger);
    const archived = validateWorldSimulationLedger_ACU({ ...ledger, facts: [], factArchive: migrated });

    expect(planLegacyRumorFacts_ACU(archived)).toEqual([]);
  });

  it.each(['无证据', '非同文', '无重要标记', '日期不明', '日期尾换行', '渠道不匹配', '来源未来', '已失效', '地点歧义'])(
    '%s 时保留旧风声，不伪造确定事实', kind => {
      const ledger = fixture();
      if (kind === '无证据') ledger.chronicle[0].evidenceRefs = [];
      if (kind === '非同文') ledger.chronicle[0].summary = '听说可能签约';
      if (kind === '无重要标记') ledger.chronicle[0].missedNote = null;
      if (kind === '日期不明') ledger.chronicle[0].at = '很久以前';
      if (kind === '日期尾换行') ledger.chronicle[0].at = '第2日\n';
      if (kind === '渠道不匹配') ledger.rumors[0].channels = ['港口'];
      if (kind === '来源未来') ledger.rumors[0].originDay = 5;
      if (kind === '已失效') ledger.rumors[0].status = 'dead';
      if (kind === '地点歧义') {
        ledger.seeds.push({ ...ledger.seeds[0], id: 'other-seed', location: { region: '别城', place: '钟楼' } });
        ledger.chronicle[0].relatedIds.push('other-seed');
      }
      const before = structuredClone(ledger);
      expect(planLegacyRumorFacts_ACU(ledger)).toEqual([]);
      expect(ledger).toEqual(before);
    },
  );
});
