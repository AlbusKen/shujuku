import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { removeWorldHistoryMilestone_ACU } from '../../../src/service/simulation/world-history-removal';
import { normalizeWorldHistoryArchive_ACU } from '../../../src/service/simulation/history-archive';
import { validateWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-store';

function fixture() {
  const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
  const history = (id: string, extra: Record<string, unknown> = {}) => ({ id, summary: `${id} 的原文`, happenedAt: { day: 2, slot: '' },
    actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2, category: '行动',
    visibility: 'internal' as const, revision: 1, legacyRefs: [], ...extra });
  ledger.historyMilestones = [history('hot-a'), history('hot-b')];
  ledger.historyArchive = [history('cold-a', { narrativeRecord: { status: 'recorded', recordedAt: { day: 3, slot: '' },
    anchorDigest: 'a'.repeat(64), deliveryQuote: '投送引文', evidenceQuote: '正文引文' } }), history('cold-b')];
  return ledger;
}

describe('removeWorldHistoryMilestone_ACU', () => {
  it('从热层删除一条历史，其余历史、事实、事件、人物与时钟原样不动，账本 revision +1', () => {
    const before = fixture();
    const next = removeWorldHistoryMilestone_ACU(before, 'hot-a');
    expect(next.revision).toBe(before.revision + 1);
    expect(next.historyMilestones.map(item => item.id)).toEqual(['hot-b']);
    expect(next.historyMilestones[0]).toBe(before.historyMilestones[1]);
    expect(next.historyArchive).toBe(before.historyArchive);
    expect(next.facts).toBe(before.facts);
    expect(next.worldEvents).toBe(before.worldEvents);
    expect(next.actors).toBe(before.actors);
    expect(next.clock).toBe(before.clock);
    expect(before.historyMilestones.map(item => item.id)).toEqual(['hot-a', 'hot-b']);
    expect(() => validateWorldSimulationLedger_ACU(next, 'persist')).not.toThrow();
  });

  it('从冷层删除已被正文记录的历史：标记随条目一起消失，热层不变', () => {
    const before = fixture();
    const next = removeWorldHistoryMilestone_ACU(before, 'cold-a');
    expect(next.historyArchive!.map(item => item.id)).toEqual(['cold-b']);
    expect(next.historyMilestones).toBe(before.historyMilestones);
    expect(JSON.stringify(next)).not.toContain('投送引文');
    // 冷热重新整理后已删除的历史不会复活，也不会改动其余条目文字。
    const normalized = normalizeWorldHistoryArchive_ACU(next);
    expect([...normalized.historyMilestones, ...(normalized.historyArchive ?? [])].map(item => item.id).sort()).toEqual(['cold-b', 'hot-a', 'hot-b']);
    expect([...normalized.historyMilestones, ...(normalized.historyArchive ?? [])].find(item => item.id === 'cold-b')!.summary).toBe('cold-b 的原文');
  });

  it('不存在时返回原对象；没有冷层的账本也可删除热层条目', () => {
    const before = fixture();
    expect(removeWorldHistoryMilestone_ACU(before, 'missing')).toBe(before);
    const noCold = { ...before }; delete noCold.historyArchive;
    const next = removeWorldHistoryMilestone_ACU(noCold, 'hot-b');
    expect(next.historyMilestones.map(item => item.id)).toEqual(['hot-a']);
    expect('historyArchive' in next).toBe(false);
  });
});
