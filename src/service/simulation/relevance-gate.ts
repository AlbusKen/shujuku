import { normalizeWorldRegionName_ACU, type WorldCollisionReport_ACU, type WorldSimulationLedger_ACU } from './model';

export interface WorldRelevanceReport_ACU extends WorldCollisionReport_ACU {
  collided: string[];
  reachable: string[];
  semantic: string[];
  unrelated: { seeds: string[]; rumors: string[]; actors: string[] };
}

function region_ACU(value?: string | null): string | null {
  if (!value) return null;
  const region = normalizeWorldRegionName_ACU(value);
  return region || null;
}

function storyEntities_ACU(ledger: WorldSimulationLedger_ACU, storyText: string): Set<string> {
  const text = storyText.toLowerCase();
  const hits = new Set<string>();
  if (!text.trim()) return hits;
  for (const actor of ledger.actors) {
    if (text.includes(actor.id.toLowerCase()) || text.includes(actor.name.toLowerCase())) hits.add(actor.id);
  }
  for (const seed of ledger.seeds) {
    if (text.includes(seed.id.toLowerCase()) || text.includes(seed.title.toLowerCase())) hits.add(seed.id);
    for (const actorId of seed.actorIds) if (hits.has(actorId)) hits.add(seed.id);
  }
  for (const rumor of ledger.rumors) {
    if (text.includes(rumor.id.toLowerCase()) || text.includes(rumor.fact.toLowerCase())) hits.add(rumor.id);
    if (rumor.relatedActorIds.some(id => hits.has(id))) hits.add(rumor.id);
  }
  return hits;
}

export function relevanceGate_ACU(ledger: WorldSimulationLedger_ACU, storyText = ''): WorldRelevanceReport_ACU {
  const playerRegion = region_ACU(ledger.player.location?.region);
  const playerContact = ledger.player.contact;
  const secluded = playerContact === 'secluded';
  const day = ledger.clock.day;
  const entities = storyEntities_ACU(ledger, storyText);

  const collided = playerRegion
    ? ledger.seeds.filter(seed => {
      const seedRegion = region_ACU(seed.location?.region);
      return !!seedRegion && seedRegion === playerRegion
        && (seed.status === 'active' || seed.status === 'converging')
        && (seed.expiresAtDay === null || seed.expiresAtDay >= day);
    }).map(seed => seed.id)
    : [];

  const reachable = secluded || !playerRegion
    ? []
    : ledger.rumors.filter(rumor => rumor.status === 'ripe' && rumor.channels.some(channel => region_ACU(channel) === playerRegion)).map(rumor => rumor.id);

  const semanticSeeds = ledger.seeds.filter(seed => !collided.includes(seed.id) && (
    entities.has(seed.id) || seed.actorIds.some(id => entities.has(id))
  )).map(seed => seed.id);
  const semanticRumors = ledger.rumors.filter(rumor => !reachable.includes(rumor.id) && entities.has(rumor.id)).map(rumor => rumor.id);
  const semanticActors = ledger.actors.filter(actor => entities.has(actor.id)).map(actor => actor.id);
  const semantic = [...new Set([...semanticSeeds, ...semanticRumors, ...semanticActors])];

  const related = new Set([...collided, ...reachable, ...semantic]);
  const unrelated = {
    seeds: ledger.seeds.filter(seed => !related.has(seed.id)).map(seed => seed.id),
    rumors: ledger.rumors.filter(rumor => !related.has(rumor.id)).map(rumor => rumor.id),
    actors: ledger.actors.filter(actor => !related.has(actor.id)).map(actor => actor.id),
  };

  return {
    playerRegion,
    playerContact,
    secludedNote: secluded ? '闭关/隔绝中，传闻渠道不可用' : null,
    collidedSeeds: collided,
    ripeRumors: reachable,
    collided,
    reachable,
    semantic,
    unrelated,
  };
}
