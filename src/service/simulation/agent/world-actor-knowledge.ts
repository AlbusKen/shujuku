import type { WorldActor_ACU, WorldClock_ACU, WorldFact_ACU } from '../model';
import { isWorldFactEstablishedAt_ACU } from '../world-fact-gate';
import type { WorldRoundCandidate_ACU } from '../world-candidate';

export interface WorldActorKnowledgeAcquisition_ACU {
  actorId: string;
  knowledge: string;
  channel: string;
  evidenceQuote: string;
  acquiredAt: { day: number; slot: string };
  locationRef: { region: string; place: string };
  sourceFactId?: string;
  sourceActorId?: string;
}

/** 已提交事实可支持的人物间认知传播候选；最终预算由 runner 负责。 */
export interface WorldActorKnowledgeSource_ACU {
  actorId: string;
  sourceActorId: string;
  sourceFactId: string;
  knowledge: string;
  channel: string;
  locationRef: { region: string; place: string };
}

type CompleteLocation_ACU = { region: string; place: string };

function completeLocation_ACU(value: unknown): CompleteLocation_ACU | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.region !== 'string' || !item.region.trim() || typeof item.place !== 'string' || !item.place.trim()) return null;
  return { region: item.region, place: item.place };
}

function sameLocation_ACU(left: unknown, right: unknown): boolean {
  const leftLocation = completeLocation_ACU(left);
  const rightLocation = completeLocation_ACU(right);
  return !!leftLocation && !!rightLocation
    && leftLocation.region === rightLocation.region && leftLocation.place === rightLocation.place;
}

/** WHY: 仅由提交前人物与本批显式可见的既有事实构造候选，不读取同轮 actor/fact 写入；候选只提供可验证来源，是否确已完成传播仍由人物模型语义判断。 */
export function buildWorldActorKnowledgeSources_ACU(input: {
  actorIds: readonly string[];
  baseActors: readonly WorldActor_ACU[];
  visibleFacts: readonly WorldFact_ACU[];
  candidateClock: WorldClock_ACU;
}): WorldActorKnowledgeSource_ACU[] {
  const actorsById = new Map(input.baseActors.map(actor => [actor.id, actor]));
  const establishedFacts = input.visibleFacts.filter(fact => isWorldFactEstablishedAt_ACU(fact, input.candidateClock));
  const establishedOccurrenceFacts = establishedFacts.filter(fact => fact.temporalKind === 'occurrence');
  const supersededFactIds = new Set(establishedFacts.flatMap(fact => fact.supersedesFactIds));
  const sources: WorldActorKnowledgeSource_ACU[] = [];
  const seen = new Set<string>();

  for (const receiverId of input.actorIds) {
    const receiver = actorsById.get(receiverId);
    if (!receiver) continue;
    const receiverLocation = completeLocation_ACU(receiver.locationRef);
    if (!receiverLocation || !Array.isArray(receiver.informationSources) || !Array.isArray(receiver.knownFacts)) continue;

    for (const fact of establishedOccurrenceFacts) {
      if (supersededFactIds.has(fact.id) || !Array.isArray(fact.actorIds)) continue;
      const factLocation = completeLocation_ACU(fact.locationRef);
      if (!factLocation || !sameLocation_ACU(receiverLocation, factLocation)) continue;

      if (!fact.actorIds.includes(receiver.id)) continue;
      for (const senderId of fact.actorIds) {
        const sender = actorsById.get(senderId);
        if (!sender || sender.id === receiver.id) continue;
        const senderLocation = completeLocation_ACU(sender.locationRef);
        if (!senderLocation || !sameLocation_ACU(senderLocation, factLocation) || !Array.isArray(sender.knownFacts)) continue;

        for (const knowledge of sender.knownFacts) {
          if (typeof knowledge !== 'string' || !knowledge.trim() || receiver.knownFacts.includes(knowledge)) continue;
          if (!fact.summary.includes(knowledge) || !fact.summary.includes(sender.name) || !fact.summary.includes(receiver.name)) continue;

          for (const channel of receiver.informationSources) {
            if (typeof channel !== 'string' || !channel.trim() || !fact.summary.includes(channel)) continue;
            const source: WorldActorKnowledgeSource_ACU = {
              actorId: receiver.id,
              sourceActorId: sender.id,
              sourceFactId: fact.id,
              knowledge,
              channel,
              locationRef: factLocation,
            };
            const key = JSON.stringify(source);
            if (!seen.has(key)) {
              seen.add(key);
              sources.push(source);
            }
          }
        }
      }
    }
  }
  return sources;
}

function parseAcquisition_ACU(value: unknown, fail: (message: string) => never): WorldActorKnowledgeAcquisition_ACU {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('知识获取记录必须是对象');
  const item = value as Record<string, unknown>;
  const allowed = ['actorId', 'knowledge', 'channel', 'evidenceQuote', 'acquiredAt', 'locationRef', 'sourceFactId', 'sourceActorId'];
  if (Object.keys(item).some(key => !allowed.includes(key))) fail('知识获取记录含未授权字段');
  if (typeof item.actorId !== 'string' || !item.actorId
    || typeof item.knowledge !== 'string' || !item.knowledge.trim()
    || typeof item.channel !== 'string' || !item.channel
    || typeof item.evidenceQuote !== 'string' || !item.evidenceQuote) {
    fail('知识获取记录缺少非空字段');
  }
  const hasSourceFactId = item.sourceFactId !== undefined;
  const hasSourceActorId = item.sourceActorId !== undefined;
  if (hasSourceFactId !== hasSourceActorId
    || (hasSourceFactId && (typeof item.sourceFactId !== 'string' || !item.sourceFactId
      || typeof item.sourceActorId !== 'string' || !item.sourceActorId))) {
    fail('已提交传播事实来源字段必须成对且非空');
  }
  if (!item.acquiredAt || typeof item.acquiredAt !== 'object' || Array.isArray(item.acquiredAt)) fail('知识获取记录 acquiredAt 非法');
  if (!item.locationRef || typeof item.locationRef !== 'object' || Array.isArray(item.locationRef)) fail('知识获取记录 locationRef 非法');
  const acquiredAt = item.acquiredAt as Record<string, unknown>;
  const locationRef = item.locationRef as Record<string, unknown>;
  if (Object.keys(acquiredAt).some(key => !['day', 'slot'].includes(key))
    || !Number.isSafeInteger(acquiredAt.day) || typeof acquiredAt.slot !== 'string') fail('知识获取记录 acquiredAt 非法');
  if (Object.keys(locationRef).some(key => !['region', 'place'].includes(key))
    || typeof locationRef.region !== 'string' || !locationRef.region
    || typeof locationRef.place !== 'string' || !locationRef.place) fail('知识获取记录 locationRef 非法');
  return {
    actorId: item.actorId,
    knowledge: item.knowledge,
    channel: item.channel,
    evidenceQuote: item.evidenceQuote,
    acquiredAt: { day: acquiredAt.day as number, slot: acquiredAt.slot as string },
    locationRef: { region: locationRef.region as string, place: locationRef.place as string },
    ...(hasSourceFactId ? { sourceFactId: item.sourceFactId as string, sourceActorId: item.sourceActorId as string } : {}),
  };
}

// 程序只核验引文、既有渠道和时空；获知语义及传播是否完成由人物模型判断。
export function validateWorldActorKnowledgeAcquisitions_ACU(input: {
  acquisitions: unknown[];
  actorWrites: WorldRoundCandidate_ACU['actorWrites'];
  actorIds: readonly string[];
  baseActors: readonly WorldActor_ACU[];
  candidateClock: WorldClock_ACU;
  anchorText: string;
  /** 本人物批已获选的提交前事实；缺省时保留原正文获取路径。 */
  visibleFacts?: readonly WorldFact_ACU[];
  fail(message: string): never;
}): void {
  const pageActorIds = new Set(input.actorIds);
  const baseById = new Map(input.baseActors.map(actor => [actor.id, actor]));
  const writeById = new Map<string, WorldActor_ACU>();
  for (const write of input.actorWrites) {
    if (!write?.value || typeof write.value.id !== 'string') continue;
    writeById.set(write.value.id, write.value);
  }

  const additionsByActor = new Map<string, string[]>();
  for (const [actorId, after] of writeById) {
    const before = baseById.get(actorId);
    if (!before) continue;
    if (!Array.isArray(after.knownFacts)) input.fail('knownFacts 必须是数组');
    const beforeFacts = before.knownFacts;
    const afterFacts = after.knownFacts;
    if (afterFacts.length < beforeFacts.length || beforeFacts.some((fact, index) => afterFacts[index] !== fact)) {
      input.fail('knownFacts 原有认知不得删除或改写');
    }
    const additions = afterFacts.slice(beforeFacts.length);
    if (additions.some(fact => typeof fact !== 'string' || !fact.trim())
      || new Set(additions).size !== additions.length
      || additions.some(fact => beforeFacts.includes(fact))) {
      input.fail('knownFacts 新增认知不得重复');
    }
    if (additions.length) additionsByActor.set(actorId, additions);
  }

  const acquisitions = input.acquisitions.map(value => parseAcquisition_ACU(value, input.fail));
  const sourceCandidates = buildWorldActorKnowledgeSources_ACU({
    actorIds: input.actorIds,
    baseActors: input.baseActors,
    visibleFacts: input.visibleFacts ?? [],
    candidateClock: input.candidateClock,
  });
  const acquisitionsByActor = new Map<string, WorldActorKnowledgeAcquisition_ACU[]>();
  const acquisitionKeys = new Set<string>();
  for (const acquisition of acquisitions) {
    if (!pageActorIds.has(acquisition.actorId)) input.fail('知识获取记录写入了页外人物');
    const before = baseById.get(acquisition.actorId);
    const after = writeById.get(acquisition.actorId);
    if (!before || !after) input.fail('知识获取记录缺少对应 actorWrite');
    const key = JSON.stringify([acquisition.actorId, acquisition.knowledge]);
    if (acquisitionKeys.has(key)) input.fail('知识获取记录含重复知识');
    acquisitionKeys.add(key);
    if (!before.informationSources.includes(acquisition.channel)) input.fail('知识获取渠道必须在提交前 informationSources 中精确存在');
    if (acquisition.acquiredAt.day !== input.candidateClock.day || acquisition.acquiredAt.slot !== input.candidateClock.slot) {
      input.fail('知识获取时间必须与 candidateClock 一致');
    }
    if (!before.locationRef || !sameLocation_ACU(before.locationRef, acquisition.locationRef)) {
      input.fail('知识获取地点必须与提交前人物结构化 locationRef 一致');
    }

    if (acquisition.sourceFactId !== undefined) {
      const source = sourceCandidates.find(candidate => candidate.actorId === acquisition.actorId
        && candidate.sourceActorId === acquisition.sourceActorId
        && candidate.sourceFactId === acquisition.sourceFactId
        && candidate.knowledge === acquisition.knowledge
        && candidate.channel === acquisition.channel
        && sameLocation_ACU(candidate.locationRef, acquisition.locationRef));
      if (!source) input.fail('已提交传播事实来源不在本批可验证候选中');
      const fact = (input.visibleFacts ?? []).find(item => item.id === acquisition.sourceFactId);
      const sender = baseById.get(acquisition.sourceActorId!);
      if (!fact || !sender || !fact.summary.includes(acquisition.evidenceQuote)
        || !acquisition.evidenceQuote.includes(sender.name) || !acquisition.evidenceQuote.includes(before.name)
        || !acquisition.evidenceQuote.includes(acquisition.knowledge) || !acquisition.evidenceQuote.includes(acquisition.channel)) {
        input.fail('已提交传播事实引文必须是含双方姓名、知识和渠道的来源事实精确子串');
      }
    } else if (!input.anchorText.includes(acquisition.evidenceQuote) || !acquisition.evidenceQuote.includes(before.name)) {
      input.fail('知识获取引文必须是含人物姓名的冻结正文精确子串');
    }
    const rows = acquisitionsByActor.get(acquisition.actorId) ?? [];
    rows.push(acquisition);
    acquisitionsByActor.set(acquisition.actorId, rows);
  }

  if (!acquisitions.length && additionsByActor.size) {
    input.fail('本受限链未提供已验证信息渠道证据，knownFacts 必须保持不变');
  }
  for (const actorId of new Set([...additionsByActor.keys(), ...acquisitionsByActor.keys()])) {
    const additions = additionsByActor.get(actorId) ?? [];
    const acquired = acquisitionsByActor.get(actorId)?.map(item => item.knowledge) ?? [];
    if (additions.length !== acquired.length || additions.some(knowledge => !acquired.includes(knowledge))) {
      input.fail('knowledgeAcquisitions 必须恰好覆盖该人物新增 knownFacts');
    }
  }
}
