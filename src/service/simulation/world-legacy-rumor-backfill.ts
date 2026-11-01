import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { WorldFact_ACU, WorldSimulationLedger_ACU } from './model';
import { allWorldFacts_ACU } from './fact-archive';

export function planLegacyRumorFacts_ACU(ledger: WorldSimulationLedger_ACU): WorldFact_ACU[] {
  const facts: WorldFact_ACU[] = [];
  for (const rumor of ledger.rumors) {
    const sourceRef = `legacy:rumors:${rumor.id}`;
    if (rumor.status === 'dead' || allWorldFacts_ACU(ledger).some(fact => fact.sourceRefs.includes(sourceRef))) continue;
    if (!rumor.channels.length || rumor.channels.some(channel => !channel.trim())
      || rumor.originDay > ledger.clock.day || rumor.earliestRevealDay < rumor.originDay) continue;
    const sources = ledger.chronicle.filter(entry => {
      const match = entry.at.match(/^(?:第([1-9]\d*)日|d([1-9]\d*))$/);
      return !!match && match[0] === entry.at && Number(match[1] ?? match[2]) === rumor.originDay
        && entry.summary === rumor.fact && !!entry.missedNote?.trim() && entry.evidenceRefs.length > 0
        && rumor.relatedActorIds.every(id => entry.relatedIds.includes(id));
    });
    if (!sources.length) continue;
    const relatedIds = new Set(sources.flatMap(entry => entry.relatedIds));
    const locations = ledger.seeds.filter(seed => relatedIds.has(seed.id) && seed.location?.place
      && rumor.channels.some(channel => channel === seed.location!.region || channel === seed.location!.place))
      .map(seed => seed.location!);
    const places = new Map(locations.map(location => [JSON.stringify([location.region, location.place]), location]));
    if (places.size !== 1) continue;
    const locationRef = [...places.values()][0];
    facts.push({
      id: `legacy-rumor-${sha256HexSync_ACU(rumor.id).slice(0, 32)}`,
      summary: rumor.fact, temporalKind: 'occurrence', happenedAt: { day: rumor.originDay, slot: '' },
      validFrom: null, validUntil: null, locationRef: structuredClone(locationRef), actorIds: [...rumor.relatedActorIds],
      worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
      revealGate: { locationRef: structuredClone(locationRef), notBefore: { day: rumor.earliestRevealDay, slot: '' },
        semanticCondition: `正文明确经由既有渠道“${rumor.channels.join('、')}”接触并核实这条旧风声，而非仅提及地点或人物。` },
      nextCheck: { day: rumor.earliestRevealDay, slot: '', reason: '旧风声已由纪要互证，复查实际接触条件' },
      sourceRefs: [sourceRef, ...sources.map(entry => `legacy:chronicle:${entry.id}`)],
      evidenceRefs: [...new Set(sources.flatMap(entry => entry.evidenceRefs))], supersedesFactIds: [], revision: 1,
    });
  }
  return facts;
}
