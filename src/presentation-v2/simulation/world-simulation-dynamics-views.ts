import { normalizeWorldRegionName_ACU, type WorldChronicleEntry_ACU, type WorldPlayerContact_ACU, type WorldRumor_ACU, type WorldRumorStatus_ACU, type WorldSimulationLedger_ACU, type WorldSimulationTimelineEntry_ACU } from '../../service/simulation/model';

export interface WorldChronicleContrastRow_ACU {
  id: string;
  at: string;
  summary: string;
  occurredDay: number | null;
  revealedAtDay: number | null;
  lagDays: number | null;
  relatedRumorId: string | null;
}

export interface WorldMissedItem_ACU {
  id: string;
  title: string;
  detail: string;
  missedOutcome: string | null;
  expiresAtDay: number | null;
  source: 'timeline' | 'seed';
}

export type WorldRipeHitState_ACU = 'open-hit' | 'secluded-delay' | 'waiting';

export interface WorldRumorQueueItem_ACU {
  id: string;
  fact: string;
  status: WorldRumorStatus_ACU;
  channels: string[];
  countdownDays: number | null;
  hitState: WorldRipeHitState_ACU | null;
  revealedAtDay: number | null;
}

export interface WorldRumorQueueView_ACU {
  contact: WorldPlayerContact_ACU;
  playerRegion: string | null;
  latent: WorldRumorQueueItem_ACU[];
  ripe: WorldRumorQueueItem_ACU[];
  revealed: WorldRumorQueueItem_ACU[];
  dead: WorldRumorQueueItem_ACU[];
}

function parseDay_ACU(value: string): number | null {
  const sweep = /^sweep:[^:]+:(\d+)$/.exec(value);
  if (sweep) return Number(sweep[1]);
  const story = /第\s*(\d+)\s*日/.exec(value);
  return story ? Number(story[1]) : null;
}

function relatedRumor_ACU(entry: WorldChronicleEntry_ACU, rumors: readonly WorldRumor_ACU[]): WorldRumor_ACU | undefined {
  const ids = new Set(entry.relatedIds);
  const matches = rumors.filter(item => ids.has(item.id) || item.relatedActorIds.some(id => ids.has(id)));
  return matches.find(item => item.status === 'revealed') ?? matches[0];
}

export function buildWorldChronicleContrast_ACU(ledger: WorldSimulationLedger_ACU): WorldChronicleContrastRow_ACU[] {
  return ledger.chronicle.map(entry => {
    const rumor = relatedRumor_ACU(entry, ledger.rumors);
    const occurredDay = parseDay_ACU(entry.id) ?? parseDay_ACU(entry.at) ?? rumor?.originDay ?? null;
    const revealedAtDay = rumor?.status === 'revealed' ? rumor.revealedAtDay : null;
    return {
      id: entry.id,
      at: entry.at,
      summary: entry.summary,
      occurredDay,
      revealedAtDay,
      lagDays: occurredDay !== null && revealedAtDay !== null ? revealedAtDay - occurredDay : null,
      relatedRumorId: rumor?.id ?? null,
    };
  });
}

export function buildWorldMissedList_ACU(ledger: WorldSimulationLedger_ACU, timeline: readonly WorldSimulationTimelineEntry_ACU[] = []): WorldMissedItem_ACU[] {
  const swept = timeline.filter(item => item.kind === 'swept').map((item): WorldMissedItem_ACU => ({
    id: item.id,
    title: item.message || '过期清扫',
    detail: String(item.at),
    missedOutcome: null as string | null,
    expiresAtDay: null as number | null,
    source: 'timeline',
  }));
  const missedSeeds = ledger.seeds.filter(item => item.status === 'retired' && item.retiredReason === 'missed').map((item): WorldMissedItem_ACU => ({
    id: item.id,
    title: item.title,
    detail: item.catalyst,
    missedOutcome: item.missedOutcome,
    expiresAtDay: item.expiresAtDay,
    source: 'seed',
  }));
  return [...swept, ...missedSeeds];
}

function ripeHitState_ACU(ledger: WorldSimulationLedger_ACU, rumor: WorldRumor_ACU): WorldRipeHitState_ACU {
  const visited = rumor.channels.some(channel => {
    const region = normalizeWorldRegionName_ACU(channel);
    return !!region && ledger.player.regionVisits.some(visit => visit.region === region && visit.day >= rumor.earliestRevealDay);
  });
  if (!visited) return 'waiting';
  return ledger.player.contact === 'secluded' ? 'secluded-delay' : 'open-hit';
}

export function buildWorldRumorQueue_ACU(ledger: WorldSimulationLedger_ACU): WorldRumorQueueView_ACU {
  const items: WorldRumorQueueItem_ACU[] = ledger.rumors.map(item => ({
    id: item.id,
    fact: item.fact,
    status: item.status,
    channels: item.channels,
    countdownDays: item.status === 'latent' ? item.earliestRevealDay - ledger.clock.day : null,
    hitState: item.status === 'ripe' ? ripeHitState_ACU(ledger, item) : null,
    revealedAtDay: item.revealedAtDay,
  }));
  return {
    contact: ledger.player.contact,
    playerRegion: ledger.player.location?.region ?? null,
    latent: items.filter(item => item.status === 'latent'),
    ripe: items.filter(item => item.status === 'ripe'),
    revealed: items.filter(item => item.status === 'revealed'),
    dead: items.filter(item => item.status === 'dead'),
  };
}
