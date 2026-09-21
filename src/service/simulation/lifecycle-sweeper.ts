import { WORLD_PLAYER_REGION_VISITS_CAP_ACU, type WorldChronicleOverviewRow_ACU, type WorldSimulationLedger_ACU, type WorldSimulationSettings_ACU } from './model';

function clone_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function factRegistered_ACU(
  ledger: WorldSimulationLedger_ACU,
  needles: readonly string[],
): boolean {
  const haystack = [
    ...ledger.chronicle.map(entry => `${entry.summary}\n${entry.relatedIds.join('\n')}`),
    ...ledger.chronicleOverview.map((row: WorldChronicleOverviewRow_ACU) => `${row.oneLine}\n${row.fingerprint}\n${row.archiveRef}`),
  ].join('\n').toLowerCase();
  return needles.some(needle => {
    const token = needle.trim().toLowerCase();
    return !!token && haystack.includes(token);
  });
}

export interface WorldLifecycleSweepResult_ACU {
  ledger: WorldSimulationLedger_ACU;
  droppedRumorIds: string[];
  droppedSeedIds: string[];
  droppedActorIds: string[];
  compressedRegionVisits: boolean;
  skipped: Array<{ kind: 'rumor' | 'seed' | 'actor'; id: string; reason: string }>;
}

export function sweepWorldLifecycle_ACU(
  ledger: WorldSimulationLedger_ACU,
  settings: WorldSimulationSettings_ACU,
): WorldLifecycleSweepResult_ACU {
  const next = clone_ACU(ledger);
  const ttl = settings.dynamics.rumorTTLDays;
  const day = next.clock.day;
  const droppedRumorIds: string[] = [];
  const droppedSeedIds: string[] = [];
  const droppedActorIds: string[] = [];
  const skipped: WorldLifecycleSweepResult_ACU['skipped'] = [];

  next.rumors = next.rumors.filter(rumor => {
    if (rumor.status !== 'revealed' || rumor.revealedAtDay === null || day - rumor.revealedAtDay <= ttl) return true;
    if (!factRegistered_ACU(next, [rumor.id, rumor.fact])) {
      skipped.push({ kind: 'rumor', id: rumor.id, reason: 'revealed rumor 缺少 chronicle/overview 事实登记' });
      return true;
    }
    droppedRumorIds.push(rumor.id);
    return false;
  });

  next.seeds = next.seeds.filter(seed => {
    const expired = seed.expiresAtDay !== null && seed.expiresAtDay < day;
    if (!(seed.status === 'resolved' || seed.status === 'retired') || !expired) return true;
    if (!factRegistered_ACU(next, [seed.id, seed.title, seed.missedOutcome ?? '', seed.retiredReason ?? ''])) {
      skipped.push({ kind: 'seed', id: seed.id, reason: '到期种子缺少 chronicle/overview 事实登记' });
      return true;
    }
    droppedSeedIds.push(seed.id);
    return false;
  });

  next.actors = next.actors.filter(actor => {
    if (actor.life !== 'dead' || actor.diedAtDay === null || day - actor.diedAtDay <= ttl * 2) return true;
    if (!factRegistered_ACU(next, [actor.id, actor.name, actor.deathSummary ?? ''])) {
      skipped.push({ kind: 'actor', id: actor.id, reason: '死亡行动者缺少 chronicle/overview 事实登记' });
      return true;
    }
    droppedActorIds.push(actor.id);
    return false;
  });

  const droppedActors = new Set(droppedActorIds);
  const droppedSeeds = new Set(droppedSeedIds);
  if (droppedActors.size) {
    next.rumors = next.rumors.map(rumor => ({
      ...rumor,
      relatedActorIds: rumor.relatedActorIds.filter(id => !droppedActors.has(id)),
    }));
    next.seeds = next.seeds.map(seed => ({
      ...seed,
      actorIds: seed.actorIds.filter(id => !droppedActors.has(id)),
    }));
  }
  if (droppedActors.size || droppedSeeds.size) {
    next.chronicle = next.chronicle.map(entry => ({
      ...entry,
      relatedIds: entry.relatedIds.filter(id => !droppedActors.has(id) && !droppedSeeds.has(id)),
    }));
  }

  let compressedRegionVisits = false;
  const visits = next.player.regionVisits;
  if (visits.length >= WORLD_PLAYER_REGION_VISITS_CAP_ACU - 1) {
    let end = 0;
    while (end + 1 < visits.length && visits[end + 1].region === visits[0].region) end += 1;
    if (end >= 1) {
      next.player.regionVisits = [{ region: visits[0].region, day: visits[0].day }, ...visits.slice(end + 1)];
      compressedRegionVisits = true;
    }
  }

  return { ledger: next, droppedRumorIds, droppedSeedIds, droppedActorIds, compressedRegionVisits, skipped };
}
