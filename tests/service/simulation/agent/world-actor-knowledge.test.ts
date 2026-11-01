import { describe, expect, it } from 'vitest';
import type { WorldActor_ACU, WorldClock_ACU, WorldFact_ACU } from '../../../../src/service/simulation/model';
import {
  buildWorldActorKnowledgeSources_ACU,
  validateWorldActorKnowledgeAcquisitions_ACU,
} from '../../../../src/service/simulation/agent/world-actor-knowledge';

const clock: WorldClock_ACU = { day: 1, slot: '晨', storyTime: '', precision: 'exact', evidenceRefs: [] };
const location = { region: '城区', place: '钟楼' };
const summary = '阿甲通过钟楼电台向阿乙说明港口已封锁。';

function actor(id: string, patch: Partial<WorldActor_ACU> = {}): WorldActor_ACU {
  return {
    id,
    name: id === 'sender' ? '阿甲' : id === 'recipient' ? '阿乙' : id,
    interests: [], location: '', locationRef: location, life: 'alive', diedAtDay: null, deathSummary: null,
    resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
    currentAction: null, shortTermAction: null, longTermAction: null, loreRefs: [], experiences: [], revision: 1,
    ...patch,
  };
}

function fact(patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return {
    id: 'source-fact', summary, temporalKind: 'occurrence', happenedAt: { day: 1, slot: '晨' }, validFrom: null, validUntil: null,
    locationRef: location, actorIds: ['sender', 'recipient'], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
    revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    ...patch,
  };
}

function fail(message: string): never { throw new Error(message); }

function sourceAcquisition(patch: Record<string, unknown> = {}) {
  return {
    actorId: 'recipient', sourceActorId: 'sender', sourceFactId: 'source-fact', knowledge: '港口已封锁', channel: '钟楼电台',
    evidenceQuote: summary, acquiredAt: { day: 1, slot: '晨' }, locationRef: location,
    ...patch,
  };
}

function validate(input: {
  actors?: WorldActor_ACU[];
  visibleFacts?: WorldFact_ACU[];
  acquisitions?: unknown[];
  actorIds?: string[];
  anchorText?: string;
}) {
  const actors = input.actors ?? [
    actor('sender', { knownFacts: ['港口已封锁'] }),
    actor('recipient', { informationSources: ['钟楼电台'] }),
  ];
  return validateWorldActorKnowledgeAcquisitions_ACU({
    acquisitions: input.acquisitions ?? [sourceAcquisition()],
    actorWrites: [{ value: { ...actors.find(actor => actor.id === 'recipient')!, knownFacts: [...actors.find(actor => actor.id === 'recipient')!.knownFacts, '港口已封锁'], revision: 2 }, expectedRevision: 1 }],
    actorIds: input.actorIds ?? ['recipient'], baseActors: actors, candidateClock: clock, anchorText: input.anchorText ?? '正文旧路径',
    visibleFacts: input.visibleFacts ?? [fact()], fail,
  });
}

describe('人物认知已提交事实传播', () => {
  it('同地、发送者原已知且事实已成立时，构造并接受传播候选', () => {
    const actors = [actor('sender', { knownFacts: ['港口已封锁'] }), actor('recipient', { informationSources: ['钟楼电台'] })];
    expect(buildWorldActorKnowledgeSources_ACU({ actorIds: ['recipient'], baseActors: actors, visibleFacts: [fact()], candidateClock: clock }))
      .toEqual([{ actorId: 'recipient', sourceActorId: 'sender', sourceFactId: 'source-fact', knowledge: '港口已封锁', channel: '钟楼电台', locationRef: location }]);
    expect(() => validate({ actors })).not.toThrow();
  });

  it.each([
    ['无来源引文', { evidenceQuote: '阿甲向阿乙说明港口已封锁。' }, '来源事实精确子串'],
    ['空引文', { evidenceQuote: '' }, '知识获取记录缺少非空字段'],
    ['引文不含知识', { evidenceQuote: '阿甲通过钟楼电台向阿乙说明。' }, '来源事实精确子串'],
    ['来源不匹配', { sourceFactId: 'other-fact' }, '可验证候选'],
  ])('拒绝%s', (_label, patch, message) => {
    expect(() => validate({ acquisitions: [sourceAcquisition(patch)] })).toThrow(message);
  });

  it('接收者没有提交前既有渠道时拒绝', () => {
    expect(() => validate({ actors: [actor('sender', { knownFacts: ['港口已封锁'] }), actor('recipient')] }))
      .toThrow('提交前 informationSources');
  });

  it.each([
    ['不同地点', [actor('sender', { knownFacts: ['港口已封锁'] }), actor('recipient', { informationSources: ['钟楼电台'], locationRef: { region: '城区', place: '码头' } })], [fact()], '提交前人物结构化 locationRef'],
    ['发送者未知道', [actor('sender'), actor('recipient', { informationSources: ['钟楼电台'] })], [fact()], '可验证候选'],
    ['未来同日自由 slot', [actor('sender', { knownFacts: ['港口已封锁'] }), actor('recipient', { informationSources: ['钟楼电台'] })], [fact({ happenedAt: { day: 1, slot: '夜' } })], '可验证候选'],
    ['同轮新事实来源', [actor('sender', { knownFacts: ['港口已封锁'] }), actor('recipient', { informationSources: ['钟楼电台'] })], [], '可验证候选'],
  ])('拒绝%s的来源', (_label, actors, visibleFacts, message) => {
    expect(() => validate({ actors, visibleFacts })).toThrow(message);
  });

  it('页外接收者不构造候选，页外发送者仅输出关联知识', () => {
    const sender = actor('sender', { knownFacts: ['港口已封锁', '页外私密'] });
    const recipient = actor('recipient', { informationSources: ['钟楼电台'] });
    expect(buildWorldActorKnowledgeSources_ACU({ actorIds: [], baseActors: [sender, recipient], visibleFacts: [fact()], candidateClock: clock })).toEqual([]);
    expect(buildWorldActorKnowledgeSources_ACU({ actorIds: ['recipient'], baseActors: [sender, recipient], visibleFacts: [fact()], candidateClock: clock }))
      .toEqual([expect.objectContaining({ actorId: 'recipient', sourceActorId: 'sender', knowledge: '港口已封锁' })]);
  });

  it('保留没有来源字段的原正文获取兼容路径', () => {
    const receiver = actor('recipient', { informationSources: ['钟楼电台'] });
    expect(() => validate({
      actors: [receiver], visibleFacts: [], anchorText: '阿乙通过钟楼电台获知港口已封锁。',
      acquisitions: [{ actorId: 'recipient', knowledge: '港口已封锁', channel: '钟楼电台', evidenceQuote: '阿乙通过钟楼电台获知港口已封锁。', acquiredAt: { day: 1, slot: '晨' }, locationRef: location }],
    })).not.toThrow();
  });

  it('来源字段必须成对', () => {
    expect(() => validate({ acquisitions: [sourceAcquisition({ sourceActorId: undefined })] })).toThrow('必须成对');
  });
});
