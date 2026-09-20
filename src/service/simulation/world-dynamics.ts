import { WORLD_PLAYER_REGION_VISITS_CAP_ACU, normalizeWorldRegionName_ACU, type WorldCollisionReport_ACU, type WorldGuidance_ACU, type WorldSimulationLedger_ACU, type WorldSimulationSettings_ACU } from './model';

export type { WorldCollisionReport_ACU };
function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function region_ACU(value?: string | null): string | null {
  if (!value) return null;
  const region = normalizeWorldRegionName_ACU(value);
  return region || null;
}
function playerRegion_ACU(ledger: WorldSimulationLedger_ACU): string | null { return region_ACU(ledger.player.location?.region); }

export interface WorldSweepResult_ACU { ledger: WorldSimulationLedger_ACU; sweptSeedIds: string[]; deadRumorIds: string[]; chronicleAppended: number; }
export interface WorldRumorFilterResult_ACU { guidance: WorldGuidance_ACU; strippedRumorIds: string[]; }

export function maintainWorldPlayer_ACU(ledger: WorldSimulationLedger_ACU, previous: WorldSimulationLedger_ACU['player']): WorldSimulationLedger_ACU {
  const next = clone_ACU(ledger);
  const previousRegion = region_ACU(previous.location?.region);
  const nextRegion = playerRegion_ACU(next);
  next.player.locationUpdatedAtDay = nextRegion !== previousRegion ? next.clock.day : previous.locationUpdatedAtDay;
  next.player.regionVisits = clone_ACU(previous.regionVisits);
  if (next.player.contact === 'open' && nextRegion && !next.player.regionVisits.some(item => item.region === nextRegion && item.day === next.clock.day)) {
    next.player.regionVisits.push({ region: nextRegion, day: next.clock.day });
    if (next.player.regionVisits.length > WORLD_PLAYER_REGION_VISITS_CAP_ACU) next.player.regionVisits.splice(0, next.player.regionVisits.length - WORLD_PLAYER_REGION_VISITS_CAP_ACU);
  }
  return next;
}
export function sweepWorldLedger_ACU(ledger: WorldSimulationLedger_ACU, settings: WorldSimulationSettings_ACU): WorldSweepResult_ACU {
  if (!settings.dynamics.missedSweepEnabled) return { ledger: clone_ACU(ledger), sweptSeedIds: [], deadRumorIds: [], chronicleAppended: 0 };
  const next = clone_ACU(ledger);
  const sweptSeedIds: string[] = [];
  const deadRumorIds: string[] = [];
  const day = next.clock.day;
  for (const seed of next.seeds) {
    if (seed.expiresAtDay === null || seed.expiresAtDay >= day || seed.status === 'resolved' || seed.status === 'retired') continue;
    seed.status = 'retired';
    seed.retiredReason = 'missed';
    seed.revision += 1;
    next.chronicle.push({ id: `sweep:${seed.id}:${day}`, at: next.clock.storyTime, summary: `[错过] ${seed.missedOutcome ?? ''}`, relatedIds: [seed.id], evidenceRefs: [] });
    sweptSeedIds.push(seed.id);
  }
  for (const rumor of next.rumors) {
    if (rumor.status !== 'latent' || day - rumor.earliestRevealDay <= settings.dynamics.rumorTTLDays) continue;
    rumor.status = 'dead';
    rumor.revision += 1;
    deadRumorIds.push(rumor.id);
  }
  return { ledger: next, sweptSeedIds, deadRumorIds, chronicleAppended: sweptSeedIds.length };
}

export function filterUnreachableRumorSignals_ACU(guidance: WorldGuidance_ACU, ledger: WorldSimulationLedger_ACU): WorldRumorFilterResult_ACU {
  const playerRegion = playerRegion_ACU(ledger);
  const rumors = new Map(ledger.rumors.map(item => [item.id, item]));
  const strippedRumorIds: string[] = [];
  const signals = guidance.signals.filter(signal => {
    if (signal.voice !== 'rumor') return true;
    const rumor = signal.sourceId ? rumors.get(signal.sourceId) : undefined;
    const reachable = ledger.player.contact === 'open' && playerRegion !== null && !!rumor && rumor.channels.some(channel => region_ACU(channel) === playerRegion);
    if (reachable) return true;
    if (signal.sourceId) strippedRumorIds.push(signal.sourceId);
    return false;
  });
  return { guidance: { ...clone_ACU(guidance), signals }, strippedRumorIds };
}


export function refreshWorldRumors_ACU(ledger: WorldSimulationLedger_ACU, adoptedRumorIds: readonly string[], settings: WorldSimulationSettings_ACU): WorldSimulationLedger_ACU {
  const next = clone_ACU(ledger);
  const adopted = new Set(adoptedRumorIds);
  const ttl = settings.dynamics.rumorTTLDays;
  const day = next.clock.day;
  for (const rumor of next.rumors) {
    let status = rumor.status;
    if (status === 'latent' && day >= rumor.earliestRevealDay) status = 'ripe';
    if (status === 'ripe') {
      if (adopted.has(rumor.id)) {
        rumor.revealedAtDay = day;
        status = 'revealed';
      } else {
        const visitedChannel = rumor.channels.some(channel => {
          const region = region_ACU(channel);
          return !!region && next.player.regionVisits.some(visit => visit.region === region && visit.day >= rumor.earliestRevealDay);
        });
        if ((visitedChannel && day - rumor.earliestRevealDay > ttl) || day - rumor.originDay > ttl * 2) status = 'dead';
      }
    }
    if (status !== rumor.status) {
      rumor.status = status;
      rumor.revision += 1;
    }
  }
  return next;
}

export function detectWorldCollisions_ACU(ledger: WorldSimulationLedger_ACU): WorldCollisionReport_ACU {
  const playerRegion = playerRegion_ACU(ledger);
  const playerContact = ledger.player.contact;
  const secluded = playerContact === 'secluded';
  const collidedSeeds = playerRegion
    ? ledger.seeds.filter(seed => {
      const seedRegion = region_ACU(seed.location?.region);
      return !!seedRegion && seedRegion === playerRegion
        && (seed.status === 'active' || seed.status === 'converging')
        && (seed.expiresAtDay === null || seed.expiresAtDay >= ledger.clock.day);
    }).map(seed => seed.id)
    : [];
  const ripeRumors = secluded || !playerRegion
    ? []
    : ledger.rumors.filter(rumor => rumor.status === 'ripe' && rumor.channels.some(channel => region_ACU(channel) === playerRegion)).map(rumor => rumor.id);
  return {
    playerRegion,
    playerContact,
    secludedNote: secluded ? '闭关/隔绝中，传闻渠道不可用' : null,
    collidedSeeds,
    ripeRumors,
  };
}

function normalizeFact_ACU(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function assertCollisionFulfillment_ACU(report: WorldCollisionReport_ACU, guidance: WorldGuidance_ACU, ledger: WorldSimulationLedger_ACU): string[] {
  const violations: string[] = [];
  const seeds = new Map(ledger.seeds.map(item => [item.id, item]));
  for (const seedId of report.collidedSeeds) {
    const seed = seeds.get(seedId);
    if (!seed || seed.exposePolicy !== 'on_collision') continue;
    if (!guidance.signals.some(signal => signal.voice === 'encounter' && signal.sourceId === seedId)) {
      violations.push(`碰撞种子 ${seedId} 缺少 encounter 信号`);
    }
  }
  const blocked = ledger.rumors.filter(item => item.status === 'latent' || item.status === 'dead');
  for (const signal of guidance.signals) {
    for (const rumor of blocked) {
      const fact = normalizeFact_ACU(rumor.fact);
      if (signal.sourceId === rumor.id || (fact && normalizeFact_ACU(signal.text).includes(fact))) {
        violations.push(`信号泄露了 ${rumor.status} 传闻 ${rumor.id}`);
      }
    }
  }
  return violations;
}
