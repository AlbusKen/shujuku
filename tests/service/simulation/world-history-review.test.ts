import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import {
  buildWorldHistoryReviewMaterials_ACU, extractWorldHistoryReply_ACU, halveWorldHistoryReviewMaterials_ACU,
  hasWorldHistoryReviewWork_ACU, normalizeWorldHistoryWrites_ACU, resolveWorldHistoryRecordings_ACU,
} from '../../../src/service/simulation/world-history-review';
import { getDefaultWorldRoundPromptSegments_ACU } from '../../../src/service/simulation/agent/world-round-prompt-defaults';
import type { WorldActor_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU } from '../../../src/service/simulation/model';

const actor = (id: string, extra: Partial<WorldActor_ACU> = {}): WorldActor_ACU => ({ id, name: `名-${id}`, interests: [], location: '', locationRef: null, life: 'alive',
  diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
  currentAction: null, longTermAction: null, shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1, ...extra });
const fact = (id: string, extra: Partial<WorldFact_ACU> = {}): WorldFact_ACU => ({ id, summary: `事实 ${id}`, temporalKind: 'occurrence', happenedAt: { day: 2, slot: '' },
  validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked', revealGate: null,
  nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...extra });
const history = (id: string, day = 1, extra: Partial<WorldHistoryMilestone_ACU> = {}): WorldHistoryMilestone_ACU => ({ id, summary: `历史 ${id}`, happenedAt: { day, slot: '' },
  actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2, category: '行动', visibility: 'internal', revision: 1, legacyRefs: [], ...extra });

function ledgerWithHistory() {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.clock = { ...ledger.clock, day: 2, slot: '晨' };
  ledger.actors = [actor('a0'), actor('a1')];
  ledger.facts = [fact('f1', { actorIds: ['a0'] })];
  ledger.factArchive = [fact('cold-fact')];
  ledger.worldEvents = [{ id: 'e1', title: '集市', state: '进行', status: 'active', actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null,
    nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
  ledger.historyMilestones = [history('h-hot', 3), history('h-old', 1)];
  ledger.historyArchive = [history('h-cold', 2, { narrativeRecord: { status: 'recorded', recordedAt: { day: 2, slot: '' }, anchorDigest: 'a'.repeat(64), deliveryQuote: 'x', evidenceQuote: 'y' } })];
  return ledger;
}
const context = (ledger = ledgerWithHistory()) => ({ ledger, base: ledger, candidateClock: { ...ledger.clock } });

describe('buildWorldHistoryReviewMaterials_ACU', () => {
  it('收集本轮变化（事实、人物结果与事务、事件状态变化），目录按新到旧并含冷层，标记资料只含未记录的历史且有投送文本才给出', () => {
    const base = ledgerWithHistory();
    const afterActor = actor('a0', { revision: 2, previousActionResult: '谈妥了价钱', shortTermAction: { text: '谈判', expectedDuration: '一天', startedAtDay: 1, startedAt: '',
      status: 'done', outcome: '成交' } });
    const ledger = { ...structuredClone(base), actors: [afterActor, base.actors[1]] };
    const candidate = {
      factWrites: [{ value: fact('new-fact', { actorIds: ['a0'], worldEventIds: ['e1'] }), expectedRevision: 0 }],
      actorWrites: [{ value: afterActor, expectedRevision: 1 }, { value: actor('a1', { revision: 2, goals: ['只改目标'] }), expectedRevision: 1 }],
      worldEventWrites: [{ value: { ...base.worldEvents[0], status: 'resolved' as const, state: '集市结束', revision: 2 }, expectedRevision: 1 },
        { value: { ...base.worldEvents[0], id: 'same', revision: 1 }, expectedRevision: 0 }],
    };
    const withDelivery = buildWorldHistoryReviewMaterials_ACU(base, ledger, candidate, '投送文本');
    expect(withDelivery.changes.facts.map(item => item.id)).toEqual(['new-fact']);
    expect(withDelivery.changes.actors).toEqual([{ id: 'a0', name: '名-a0', previousActionResult: '谈妥了价钱',
      completedAffair: { text: '谈判', status: 'done', outcome: '成交' } }]);
    expect(withDelivery.changes.events.map(item => [item.id, item.status, item.previousStatus])).toEqual([['e1', 'resolved', 'active'], ['same', 'active', undefined]]);
    expect(withDelivery.catalog.map(item => item.id)).toEqual(['h-hot', 'h-cold', 'h-old']);
    expect(withDelivery.recordingMaterials.map(item => item.id)).toEqual(['h-hot', 'h-old']);
    expect(withDelivery.deliveryText).toBe('投送文本');
    expect(hasWorldHistoryReviewWork_ACU(withDelivery)).toBe(true);
    const noDelivery = buildWorldHistoryReviewMaterials_ACU(base, ledger, candidate, '  ');
    expect(noDelivery.recordingMaterials).toEqual([]);
    expect(noDelivery.deliveryText).toBe('');
    // 没有变化也没有标记资料时只有目录，不构成历史职责，目录也不给。
    const none = buildWorldHistoryReviewMaterials_ACU(base, base, { factWrites: [], actorWrites: [], worldEventWrites: [] }, '');
    expect(none.catalog).toEqual([]);
    expect(hasWorldHistoryReviewWork_ACU(none)).toBe(false);
    expect(hasWorldHistoryReviewWork_ACU(undefined)).toBe(false);
  });

  it('折半同时作用于变化、目录和标记资料；标记资料折空时投送文本一并去掉', () => {
    const base = ledgerWithHistory();
    const materials = buildWorldHistoryReviewMaterials_ACU(base, base, { actorWrites: [], worldEventWrites: [],
      factWrites: ['a', 'b', 'c', 'd'].map(id => ({ value: fact(`n-${id}`), expectedRevision: 0 })) }, '文本');
    const half = halveWorldHistoryReviewMaterials_ACU(materials);
    expect(half.changes.facts).toHaveLength(2);
    expect(half.catalog).toHaveLength(1);
    expect(half.recordingMaterials).toHaveLength(1);
    const quarter = halveWorldHistoryReviewMaterials_ACU(halveWorldHistoryReviewMaterials_ACU(half));
    expect(quarter.changes.facts).toHaveLength(0);
    expect(quarter.recordingMaterials).toEqual([]);
    expect(quarter.deliveryText).toBe('');
    expect(quarter.catalog).toEqual([]);
    expect(hasWorldHistoryReviewWork_ACU(quarter)).toBe(false);
  });
});

describe('extractWorldHistoryReply_ACU', () => {
  it('接受别名与大小写、单对象或数组；缺失为空；形状无法使用时标记 malformed 而不抛错', () => {
    expect(extractWorldHistoryReply_ACU({ History_Milestone_Writes: [{ a: 1 }], 'recording candidates': { historyId: 'h' } }))
      .toEqual({ milestones: [{ a: 1 }], recordings: [{ historyId: 'h' }], malformed: false });
    expect(extractWorldHistoryReply_ACU({ milestones: { id: 'x' } }).milestones).toEqual([{ id: 'x' }]);
    expect(extractWorldHistoryReply_ACU({ pruneFactIds: [] })).toEqual({ milestones: [], recordings: [], malformed: false });
    expect(extractWorldHistoryReply_ACU({ historyMilestoneWrites: '文字', historyRecordingCandidates: 3 })).toEqual({ milestones: [], recordings: [], malformed: true });
    expect(extractWorldHistoryReply_ACU(null)).toEqual({ milestones: [], recordings: [], malformed: false });
  });
});

describe('normalizeWorldHistoryWrites_ACU', () => {
  it('宽容归一：别名、缺省、多余字段、键序、ID 大小写与按名称引用人物都被接受，只新建且去掉 narrativeRecord', () => {
    const { writes, skipped } = normalizeWorldHistoryWrites_ACU([
      { expectedRevision: 9, value: { category: '承诺', importance: 99, id: 'n1', 额外: 1, summary: '  达成约定  ', happenedAt: { day: '2', slot: '晨' }, actorIds: ['名-a0', 'A1'],
        sourceFactIds: ['F1', 'cold-fact'], worldEventIds: 'e1', locationRef: { region: '临安', place: '茶馆' }, narrativeRecord: { status: 'recorded' } } },
      { Text: '只有摘要', Participants: 'a0' },
    ], context());
    expect(skipped).toEqual([]);
    expect(writes[0]).toEqual({ expectedRevision: 0, value: { id: 'n1', summary: '达成约定', happenedAt: { day: 2, slot: '晨' }, actorIds: ['a0', 'a1'],
      worldEventIds: ['e1'], locationRef: { region: '临安', place: '茶馆' }, sourceFactIds: ['f1', 'cold-fact'], importance: 5, category: '承诺',
      visibility: 'internal', revision: 1, legacyRefs: [] } });
    expect(writes[1].value).toMatchObject({ summary: '只有摘要', actorIds: ['a0'], sourceFactIds: [], importance: 3, category: '经历', locationRef: null });
    expect(writes[1].value.id).toMatch(/^history-[0-9a-f]{24}$/);
  });

  it('时间缺省取候选时钟，未来日期夹到候选时钟；没有“人物必须在本批、每人须经来源事实关联”的语义门槛', () => {
    const { writes } = normalizeWorldHistoryWrites_ACU([
      { id: 'future', summary: '未来', happenedAt: { day: 50 }, actorIds: ['a0', 'a1'], sourceFactIds: ['f1'] },
      { id: 'no-time', summary: '无时间', actorIds: ['a1'], sourceFactIds: [] },
    ], context());
    expect(writes.map(item => item.value.happenedAt)).toEqual([{ day: 2, slot: '' }, { day: 2, slot: '晨' }]);
    expect(writes[0].value.actorIds).toEqual(['a0', 'a1']);
  });

  it('只保留结构完整性检查：未知人物、事件、事实、与已有历史冲突、同批重复、空摘要、非对象都单条跳过，其余照常', () => {
    const { writes, skipped } = normalizeWorldHistoryWrites_ACU([
      { id: 'ok', summary: '合法' },
      { id: 'bad-actor', summary: 'x', actorIds: ['ghost'] },
      { id: 'bad-event', summary: 'x', worldEventIds: ['ghost'] },
      { id: 'bad-fact', summary: 'x', sourceFactIds: ['ghost'] },
      { id: 'h-old', summary: '与热层冲突' },
      { id: 'H-COLD', summary: '大小写不同视为新 ID' },
      { id: 'h-cold', summary: '与冷层冲突' },
      { id: 'ok', summary: '同批重复' },
      { id: 'no-summary' },
      42,
    ], context());
    expect(writes.map(item => item.value.id)).toEqual(['ok', 'H-COLD']);
    expect(skipped).toEqual([
      { id: 'bad-actor', reason: 'unknown-actor' }, { id: 'bad-event', reason: 'unknown-event' }, { id: 'bad-fact', reason: 'unknown-fact' },
      { id: 'h-old', reason: 'id-conflict' }, { id: 'h-cold', reason: 'id-conflict' }, { id: 'ok', reason: 'id-conflict' },
      { id: 'no-summary', reason: 'missing-summary' }, { reason: 'invalid-item' }]);
  });
});

describe('resolveWorldHistoryRecordings_ACU', () => {
  const materials = [history('h-a'), history('h-b')];
  const input = { deliveryText: '资料：钟楼的门，昨夜修好。', anchorText: '守卫说钟楼的门昨夜修好了。', candidateClock: { day: 2, slot: '晨', storyTime: '', precision: 'unknown' as const, evidenceRefs: [] } };

  it('宽容别名与 ID 大小写、空白标点差异；返回正文中的原文片段与锚点摘要；同一历史只取第一条', () => {
    const result = resolveWorldHistoryRecordings_ACU([
      { Delivered_Quote: '钟楼的门 昨夜修好', evidence_quote: '钟楼的门昨夜修好', id: ' H-A ', extra: 1 },
      { historyId: 'h-a', deliveryQuote: '钟楼的门，昨夜修好', evidenceQuote: '钟楼的门昨夜修好' },
    ], materials, input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ historyId: 'h-a', expectedRevision: 1, record: { status: 'recorded', recordedAt: { day: 2, slot: '晨' },
      deliveryQuote: '钟楼的门，昨夜修好', evidenceQuote: '钟楼的门昨夜修好' } });
    expect(result[0].record.anchorDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('目录外历史、投送引文不在投送资料、证据引文不在正文、非对象逐条跳过', () => {
    expect(resolveWorldHistoryRecordings_ACU([
      { historyId: 'ghost', deliveryQuote: '钟楼的门', evidenceQuote: '钟楼的门' },
      { historyId: 'h-a', deliveryQuote: '没投送过', evidenceQuote: '钟楼的门' },
      { historyId: 'h-b', deliveryQuote: '钟楼的门', evidenceQuote: '正文里没有' },
      'x', null,
    ], materials, input)).toEqual([]);
  });
});

describe('默认提示词归属', () => {
  const text = (role: string) => getDefaultWorldRoundPromptSegments_ACU(role).map(segment => segment.content).join('\n');
  it('人物专员默认稿不再负责写重要历史，只保留读取用途；联合审查默认稿承担历史总结与正文记录标记', () => {
    const actorText = text('actor-simulator');
    expect(actorText).not.toContain('historyRecordingCandidates');
    expect(actorText).not.toContain('historyRecordingMaterials');
    expect(actorText).not.toContain('形成重要人生节点时，再提交历史候选');
    expect(actorText).toContain('联合审查专员');
    expect(actorText).toContain('记得过去');
    const review = text('joint-reviewer');
    for (const keyword of ['historyChanges', 'historyCatalog', 'historyMilestoneWrites', 'historyRecordingMaterials', 'historyRecordingCandidates', '普通进餐']) {
      expect(review).toContain(keyword);
    }
    expect(review).toContain('不再重复新建');
    expect(review).toContain('世界事件');
  });
});
