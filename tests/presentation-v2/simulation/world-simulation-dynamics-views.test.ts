import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import type { WorldRumor_ACU, WorldSeed_ACU, WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';
import {
  buildWorldChronicleContrast_ACU,
  buildWorldMissedList_ACU,
  buildWorldRumorQueue_ACU,
} from '../../../src/presentation-v2/simulation/world-simulation-dynamics-views';

const ledger = (patch: Partial<WorldSimulationLedger_ACU> = {}): WorldSimulationLedger_ACU => ({
  ...buildEmptyWorldSimulationLedger_ACU(),
  ...patch,
});
const rumor = (patch: Partial<WorldRumor_ACU> = {}): WorldRumor_ACU => ({
  id: 'rumor-tax', fact: '铁匠死在北岭', originDay: 12, earliestRevealDay: 17, channels: ['客栈'],
  relatedActorIds: [], status: 'revealed', revealedAtDay: 47, revision: 1, ...patch,
});
const seed = (patch: Partial<WorldSeed_ACU> = {}): WorldSeed_ACU => ({
  id: 'seed-miss', title: '矿洞时限', status: 'retired', level: 1, catalyst: '限期未至', visibility: 'hidden',
  actorIds: [], location: { region: '北岭' }, expiresAtDay: 10, missedOutcome: '矿洞塌了',
  exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: 'missed', revision: 1, ...patch,
});

describe('world simulation dynamics views', () => {
  it('编年对照并列发生日、得知日与滞后天数', () => {
    const rows = buildWorldChronicleContrast_ACU(ledger({
      chronicle: [{ id: 'death-north', at: '第12日', summary: '铁匠死于北岭', relatedIds: ['rumor-tax'], evidenceRefs: [] }],
      rumors: [rumor()],
    }));
    expect(rows[0]).toMatchObject({
      id: 'death-north', occurredDay: 12, revealedAtDay: 47, lagDays: 35, relatedRumorId: 'rumor-tax',
    });
  });

  it('错过清单只列维护 AI 标注 missedNote 的幕后纪要，不列清扫动作或退役种子', () => {
    const items = buildWorldMissedList_ACU(ledger({
      seeds: [seed()],
      chronicle: [
        { id: 'sweep:seed-miss:11', at: '第11日', summary: '[错过] 矿洞塌了', relatedIds: ['seed-miss'], evidenceRefs: [], missedNote: null },
        { id: 'chr-11-1', at: '第11日', summary: '北岭矿洞塌方', relatedIds: ['seed-miss'], evidenceRefs: [], missedNote: '主角远在客栈，错过了救出矿工的最后机会' },
        { id: 'chr-11-2', at: '第11日', summary: '商会换了掌柜', relatedIds: [], evidenceRefs: [], missedNote: '  ' },
      ],
    }));
    expect(items.map(item => item.id)).toEqual(['chr-11-1']);
    expect(items[0]).toMatchObject({ title: '北岭矿洞塌方', detail: '主角远在客栈，错过了救出矿工的最后机会', at: '第11日', relatedIds: ['seed-miss'] });
  });

  it('传闻队列按 status 分组：latent 倒计时，ripe 区分开放命中与闭关延迟', () => {
    const clock = { day: 47, slot: '', storyTime: '第47日', precision: 'exact' as const, evidenceRefs: [] };
    const visits = [{ region: '客栈', day: 22 }];
    const open = buildWorldRumorQueue_ACU(ledger({
      clock,
      player: { location: { region: '客栈' }, locationUpdatedAtDay: 47, regionVisits: visits, contact: 'open', evidenceRefs: [] },
      rumors: [
        rumor({ id: 'latent', status: 'latent', earliestRevealDay: 50, revealedAtDay: null, fact: '矿脉异动' }),
        rumor({ id: 'ripe', status: 'ripe', revealedAtDay: null, fact: '客栈有人打听' }),
        rumor({ id: 'ripe-wait', status: 'ripe', channels: ['青阳城'], revealedAtDay: null, fact: '远方风声' }),
        rumor(),
        rumor({ id: 'dead', status: 'dead', revealedAtDay: null, fact: '过时' }),
      ],
    }));
    expect(open.contact).toBe('open');
    expect(open.latent[0].countdownDays).toBe(3);
    expect(open.ripe.find(item => item.id === 'ripe')?.hitState).toBe('open-hit');
    expect(open.ripe.find(item => item.id === 'ripe-wait')?.hitState).toBe('waiting');
    expect(open.revealed.map(item => item.id)).toEqual(['rumor-tax']);
    expect(open.dead.map(item => item.id)).toEqual(['dead']);
    const secluded = buildWorldRumorQueue_ACU(ledger({
      clock,
      player: { location: { region: '客栈' }, locationUpdatedAtDay: 47, regionVisits: visits, contact: 'secluded', evidenceRefs: [] },
      rumors: [rumor({ id: 'ripe', status: 'ripe', revealedAtDay: null })],
    }));
    expect(secluded.ripe[0].hitState).toBe('secluded-delay');
  });
});
