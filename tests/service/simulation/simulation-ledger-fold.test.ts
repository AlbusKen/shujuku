import { describe, expect, it } from 'vitest';

import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, WORLD_SIMULATION_STATE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU } from '../../../src/service/simulation/model';
import {
  appendWorldSimulationCommitChain_ACU,
  appendWorldSimulationFieldDeltaChain_ACU,
  diffWorldSimulationLedger_ACU,
  foldWorldSimulationLedger_ACU,
  readWorldSimulationLedgerFieldSnapshot_ACU,
  seedLedgerFieldView_ACU,
} from '../../../src/service/simulation/simulation-ledger-fold';
import { buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import type { WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

function assistant(mes: string, swipeId = 0) {
  return { is_user: false, message_id: mes, mes, swipe_id: swipeId };
}

describe('格林推演账本折叠', () => {
  it('正文记载标记与完整历史经过 delta 归档，撤回楼层恢复未记载热史', () => {
    const chat = [{}, assistant('历史基线'), assistant('正文记载')];
    const before = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const history = { id: 'history-1', summary: '北门暴雨夜关闭的完整历史', happenedAt: { day: 1, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 3,
      category: '旧事', visibility: 'internal' as const, revision: 1, legacyRefs: [] };
    before.historyMilestones = [history];
    const next: WorldSimulationLedger_ACU = { ...before, revision: 1, historyMilestones: [],
      historyArchive: [{ ...history, revision: 2, narrativeRecord: { status: 'recorded', recordedAt: { day: 1, slot: '' },
        anchorDigest: 'a'.repeat(64), deliveryQuote: '北门暴雨夜关闭', evidenceQuote: '守卫回忆北门暴雨夜关闭' } }] };
    const baseline = resolveWorldSimulationAnchor_ACU(1, chat);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 1, anchor: baseline, beforeLedger: before, nextLedger: before,
      evidenceRefs: [], updatedAt: 1, checkpointIndex: null, beforeArchive: { schemaVersion: 1, records: {} },
      nextArchive: { schemaVersion: 1, records: {} } });
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 2, anchor: resolveWorldSimulationAnchor_ACU(2, chat),
      beforeLedger: before, nextLedger: next, evidenceRefs: [], updatedAt: 2, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(next);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.historyArchive?.[0].summary).toBe(history.summary);
    chat.pop();
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(before);
  });

  it('独立轮次元数据经过 delta 和 checkpoint 持久折叠，空冷归档仍保留计数', () => {
    const chat = [{}, assistant('基线'), assistant('计数更新'), assistant('清空冷层')];
    const base = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const cold = { id: 'cold-1', summary: '旧事实', temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' },
      validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    const initial: WorldSimulationLedger_ACU = { ...base, factArchive: [cold],
      factArchiveRetention: { completedRounds: 10, enteredAtRound: { 'cold-1': 2 } } };
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 1, anchor: resolveWorldSimulationAnchor_ACU(1, chat),
      beforeLedger: initial, nextLedger: initial, evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(initial);
    const advanced: WorldSimulationLedger_ACU = { ...initial, revision: 1,
      factArchiveRetention: { completedRounds: 11, enteredAtRound: { 'cold-1': 2 } } };
    expect(diffWorldSimulationLedger_ACU(initial, advanced, undefined, 2, 1)?.factArchiveRetention).toEqual(advanced.factArchiveRetention);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 2, anchor: resolveWorldSimulationAnchor_ACU(2, chat),
      beforeLedger: initial, nextLedger: advanced, evidenceRefs: [], updatedAt: 2, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.factArchiveRetention).toEqual(advanced.factArchiveRetention);
    const cleared: WorldSimulationLedger_ACU = { ...advanced, revision: 2, factArchive: [],
      factArchiveRetention: { completedRounds: 12, enteredAtRound: {} } };
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 3, anchor: resolveWorldSimulationAnchor_ACU(3, chat),
      beforeLedger: advanced, nextLedger: cleared, evidenceRefs: [], updatedAt: 3, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(cleared);
    chat.pop();
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(advanced);
  });

  it('旧基线不自动创建轮次元数据，增量加入后可继续无冷层推进', () => {
    const chat = [assistant('旧基线'), assistant('首轮'), assistant('次轮')];
    const old = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 0, anchor: resolveWorldSimulationAnchor_ACU(0, chat),
      beforeLedger: old, nextLedger: old, evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.factArchiveRetention).toBeUndefined();
    const first = { ...old, factArchiveRetention: { completedRounds: 1, enteredAtRound: {} } };
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 1, anchor: resolveWorldSimulationAnchor_ACU(1, chat),
      beforeLedger: old, nextLedger: first, evidenceRefs: [], updatedAt: 2, checkpointIndex: 0,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.factArchiveRetention).toEqual(first.factArchiveRetention);
    const second = { ...first, factArchiveRetention: { completedRounds: 2, enteredAtRound: {} } };
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 2, anchor: resolveWorldSimulationAnchor_ACU(2, chat),
      beforeLedger: first, nextLedger: second, evidenceRefs: [], updatedAt: 3, checkpointIndex: 0,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.factArchiveRetention).toEqual(second.factArchiveRetention);
  });

  it('冷热事实随 checkpoint 与 delta 无损保存，删除新楼层后回到未归档基线', () => {
    const chat = [{}, assistant('事实基线'), assistant('归档楼')];
    const before = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const fact = { id: 'expired', summary: '旧事实完整原文', temporalKind: 'condition' as const, happenedAt: null,
      validFrom: { day: 1, slot: '' }, validUntil: { day: 1, slot: '' }, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null, nextCheck: null,
      sourceRefs: ['原来源'], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    before.facts = [fact];
    const next = { ...before, revision: 1, clock: { ...before.clock, day: 2 }, facts: [], factArchive: [fact] };
    const baselineAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 1, anchor: baselineAnchor, beforeLedger: before, nextLedger: before,
      evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 2, anchor, beforeLedger: before, nextLedger: next,
      evidenceRefs: [], updatedAt: 10, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)!.ledger).toEqual(next);
    chat.pop();
    expect(foldWorldSimulationLedger_ACU(chat)!.ledger.facts).toEqual([fact]);
    expect(foldWorldSimulationLedger_ACU(chat)!.ledger.factArchive).toBeUndefined();
  });

  it('提交 delta 叠加后等于新账本，删掉锚点楼后回到基线', () => {
    const chat = [{}, assistant('第一楼'), assistant('第二楼')];
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const before = envelope.ledger;
    const next: WorldSimulationLedger_ACU = {
      ...before,
      revision: before.revision + 1,
      clock: { ...before.clock, day: before.clock.day + 1, storyTime: '次日' },
    };
    const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
    appendWorldSimulationCommitChain_ACU({
      chat,
      messageIndex: 2,
      anchor,
      beforeLedger: before,
      nextLedger: next,
      evidenceRefs: ['e1'],
      updatedAt: 10,
      checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} },
      nextArchive: { schemaVersion: 1, records: { arc: { archiveRef: 'arc', day: 1, oneLine: '北岭塌方已归档', fingerprint: 'fp', detail: '' } as never } },
    });

    const folded = foldWorldSimulationLedger_ACU(chat);
    expect(folded?.ledger.revision).toBe(next.revision);
    expect(folded?.ledger.clock.storyTime).toBe('次日');
    expect(folded?.evidenceRefs).toEqual(['e1']);
    expect(JSON.stringify(chat[2])).toContain('北岭塌方已归档');

    const withoutTail = chat.slice(0, 2);
    expect(foldWorldSimulationLedger_ACU(withoutTail)).toBeNull();
  });

  it('historyArchive 通过普通 delta 与 checkpoint 折叠，完整节点不丢失', () => {
    const chat = [{}, assistant('第一楼'), assistant('第二楼')];
    const before = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const cold = {
      id: 'history-cold', summary: '早期大事', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [],
      locationRef: null, sourceFactIds: [], importance: 1, category: '事件', visibility: 'internal' as const, revision: 1, legacyRefs: [],
    };
    const next: WorldSimulationLedger_ACU = { ...before, revision: 1, historyArchive: [cold] };
    appendWorldSimulationCommitChain_ACU({
      chat, messageIndex: 1, anchor: resolveWorldSimulationAnchor_ACU(1, chat), beforeLedger: before, nextLedger: next,
      evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
    });
    const later: WorldSimulationLedger_ACU = { ...next, revision: 2, clock: { ...next.clock, day: 2 } };
    appendWorldSimulationCommitChain_ACU({
      chat, messageIndex: 2, anchor: resolveWorldSimulationAnchor_ACU(2, chat), beforeLedger: next, nextLedger: later,
      evidenceRefs: [], updatedAt: 2, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
    });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(later);
  });

  it('v7 新领域数据经楼层 delta 折叠不丢失', () => {
    const chat = [{}, assistant('第一楼'), assistant('第二楼')];
    const before = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const next: WorldSimulationLedger_ACU = {
      ...before, revision: 1,
      worldEvents: [{
        id: 'event-1', title: '音乐节', state: '筹备中', status: 'active', actorIds: [], organizationIds: [],
        locationRefs: [], startedAt: { day: 1, slot: '上午' }, deadline: null,
        nextCheck: { day: 2, slot: '上午', reason: '场地检查' }, relatedEventIds: [], loreRefs: [],
        evidenceRefs: [], tags: [], revision: 1, legacy: null,
      }],
      facts: [{
        id: 'fact-1', summary: '场地合同已签署', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '上午' },
        validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: ['event-1'],
        projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null,
        sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
      }],
      historyMilestones: [{
        id: 'milestone-1', summary: '音乐节确定举办', happenedAt: { day: 1, slot: '上午' },
        actorIds: [], worldEventIds: ['event-1'], locationRef: null, sourceFactIds: ['fact-1'],
        importance: 3, category: '世界事件', visibility: 'internal', revision: 1, legacyRefs: [],
      }],
    };
    appendWorldSimulationCommitChain_ACU({
      chat, messageIndex: 1, anchor: resolveWorldSimulationAnchor_ACU(1, chat),
      beforeLedger: before, nextLedger: next, evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
    });
    const later: WorldSimulationLedger_ACU = { ...next, revision: 2, projection: { anchor: 'scene-2', deliveries: [] },
      legacyMigration: { issues: [{ source: 'chronicle', sourceId: 'legacy-1', reason: 'unparseable_time' }] } };
    appendWorldSimulationCommitChain_ACU({
      chat, messageIndex: 2, anchor: resolveWorldSimulationAnchor_ACU(2, chat),
      beforeLedger: next, nextLedger: later, evidenceRefs: [], updatedAt: 2, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
    });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(later);
  });

  it('旧 v6 checkpoint 加旧格式 delta 时在内存迁移，且不修改原楼层', () => {
    const chat = [assistant('旧楼'), assistant('后续增量')];
    const old: any = structuredClone(buildDefaultWorldSimulationEnvelope_ACU().ledger);
    old.schemaVersion = 6;
    delete old.worldEvents;
    delete old.facts;
    delete old.historyMilestones;
    delete old.projection;
      delete old.legacyMigration;
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = {
      schemaVersion: 1, entries: { [buildWorldSimulationBucketKey_ACU(anchor)]: {
        anchor, value: { schemaVersion: 2, checkpoint: old, deltas: [] }, updatedAt: 1,
      } },
    };
    const laterAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    chat[1][WORLD_SIMULATION_STATE_FIELD_ACU] = {
      schemaVersion: 1, entries: { [buildWorldSimulationBucketKey_ACU(laterAnchor)]: {
        anchor: laterAnchor, value: { schemaVersion: 2, deltas: [{
          seq: 1, revision: 1, upserts: {}, removedIds: {},
          clock: { ...old.clock, day: 2, storyTime: '第二日' }, updatedAt: 2,
        }] }, updatedAt: 2,
      } },
    };
    const snapshot = structuredClone(chat);
    const folded = foldWorldSimulationLedger_ACU(chat);
    expect(folded?.ledger).toMatchObject({ schemaVersion: 7, revision: 1, clock: { day: 2 },
      worldEvents: [], facts: [], historyMilestones: [], projection: { anchor: null, deliveries: [] } });
    expect(chat).toEqual(snapshot);
  });

  it('另一 swipe 的分桶不进入当前折叠', () => {
    const chat = [assistant('正文', 0)];
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const other = { ...anchor, swipeId: '1' };
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = {
      schemaVersion: 1,
      entries: {
        [buildWorldSimulationBucketKey_ACU(other)]: {
          anchor: other,
          value: { ...envelope.ledger, revision: 9 },
          updatedAt: 1,
        },
      },
    };
    expect(foldWorldSimulationLedger_ACU(chat)).toBeNull();
  });

  it('v1–v4 旧全量账本在楼层分桶折叠时只归一化，不改写原数据', () => {
    for (const version of [1, 2, 3, 4]) {
      const chat = [assistant(`旧楼 v${version}`)];
      const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
      const old: any = { ...buildDefaultWorldSimulationEnvelope_ACU().ledger, schemaVersion: version };
      delete old.worldEvents;
      delete old.facts;
      delete old.historyMilestones;
      delete old.projection;
      delete old.legacyMigration;
      if (version < 5) delete old.materialCompletion;
      if (version < 4) delete old.pendingFixes;
      if (version < 3) delete old.chronicleOverview;
      if (version === 1) {
        old.clock = { storyTime: '第三日黄昏', elapsed: '3日', precision: 'approximate', evidenceRefs: [] };
        old.guidance = { signals: ['风声'], excludedFacts: [], evidenceRefs: [] };
        delete old.rumors;
        delete old.player;
      }
      const snapshot = structuredClone(old);
      chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = {
        schemaVersion: 1,
        entries: { [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor, value: old, updatedAt: 1 } },
      };
      const folded = foldWorldSimulationLedger_ACU(chat);
      expect(folded?.ledger.schemaVersion).toBe(buildDefaultWorldSimulationEnvelope_ACU().ledger.schemaVersion);
      expect(folded?.ledger.materialCompletion.state).toBe('legacy_unknown');
      if (version === 1) expect(folded?.ledger.clock.day).toBe(3);
      expect(old).toEqual(snapshot);
    }
  });

  it('旧的全量账本在读取时当成基线', () => {
    const chat = [assistant('旧楼')];
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = {
      schemaVersion: 1,
      entries: { [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor, value: ledger, updatedAt: 1 } },
    };
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.revision).toBe(ledger.revision);
    expect(chat[0][WORLD_SIMULATION_STATE_FIELD_ACU].entries[buildWorldSimulationBucketKey_ACU(anchor)].value.schemaVersion).toBe(ledger.schemaVersion);
  });
});

describe('格林推演逐栏写入与分栏视图', () => {
  function committedChat(): { chat: ReturnType<typeof assistant>[]; ledger: WorldSimulationLedger_ACU } {
    const chat = [{}, assistant('第一楼')];
    const before = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    appendWorldSimulationCommitChain_ACU({
      chat,
      messageIndex: 1,
      anchor: resolveWorldSimulationAnchor_ACU(1, chat),
      beforeLedger: before,
      nextLedger: before,
      evidenceRefs: [],
      updatedAt: 1,
      checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} },
      nextArchive: { schemaVersion: 1, records: {} },
    });
    return { chat, ledger: before };
  }

  it('同一人物分两次写不同栏目合并为一条 partial 记录，不进入账本数组', () => {
    const { chat } = committedChat();
    chat.push(assistant('第二楼'));
    const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
    expect(appendWorldSimulationFieldDeltaChain_ACU({
      chat, messageIndex: 2, anchor, updatedAt: 20,
      fieldUpserts: { actors: { 张三: { name: { value: '张三' }, life: { value: 'alive' } } } },
    })).toBe(true);
    expect(appendWorldSimulationFieldDeltaChain_ACU({
      chat, messageIndex: 2, anchor, updatedAt: 21,
      fieldUpserts: { actors: { 张三: { interests: { value: ['打铁'] } } } },
    })).toBe(true);

    const record = readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors?.['张三'];
    expect(record?.status).toBe('partial');
    expect(record?.fields.name.value).toBe('张三');
    expect(record?.fields.life.value).toBe('alive');
    expect(record?.fields.interests.value).toEqual(['打铁']);
    expect(record?.missingFields).toContain('goals');
    // 中间态不并入完整账本
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.actors).toEqual([]);
  });

  it('整条提交覆盖同名 partial 记录并并入账本', () => {
    const { chat, ledger } = committedChat();
    chat.push(assistant('第二楼'));
    const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
    appendWorldSimulationFieldDeltaChain_ACU({
      chat, messageIndex: 2, anchor, updatedAt: 30,
      fieldUpserts: { actors: { 'actor-a1': { name: { value: '张三' } } } },
    });
    expect(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors?.['actor-a1']?.status).toBe('partial');

    const actor = { id: 'actor-a1', name: '张三', interests: [], location: '北岭', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: ['活下去'], constraints: [], informationSources: [], knownFacts: [], visibility: 'public', revision: 1 } as never;
    const next: WorldSimulationLedger_ACU = { ...ledger, revision: ledger.revision + 1, actors: [actor] };
    appendWorldSimulationCommitChain_ACU({
      chat, messageIndex: 2, anchor, beforeLedger: foldWorldSimulationLedger_ACU(chat)!.ledger, nextLedger: next,
      evidenceRefs: [], updatedAt: 31, checkpointIndex: 1,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
    });
    expect(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors?.['actor-a1']?.status).toBe('complete');
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.actors.map(item => item.id)).toEqual(['actor-a1']);
  });

  it('没有账本基线时逐栏写入 fail-closed，不伪称已写入', () => {
    const chat = [assistant('空楼')];
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    expect(appendWorldSimulationFieldDeltaChain_ACU({
      chat, messageIndex: 0, anchor, updatedAt: 40,
      fieldUpserts: { actors: { 张三: { name: { value: '张三' } } } },
    })).toBe(false);
    expect(chat[0][WORLD_SIMULATION_STATE_FIELD_ACU]).toBeUndefined();
  });

  it('swipe 切走后逐栏 delta 不进入折叠，切回后恢复', () => {
    const { chat } = committedChat();
    chat.push(assistant('第二楼', 0));
    const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
    appendWorldSimulationFieldDeltaChain_ACU({
      chat, messageIndex: 2, anchor, updatedAt: 50,
      fieldUpserts: { actors: { 张三: { name: { value: '张三' } } } },
    });
    expect(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors?.['张三']?.status).toBe('partial');
    chat[2].swipe_id = 1;
    expect(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors ?? {}).toEqual({});
    chat[2].swipe_id = 0;
    expect(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors?.['张三']?.fields.name.value).toBe('张三');
  });

  it('过时完整基线按有效账本派生对账，真实 partial 的来源、时间与缺栏不丢，读取不隐写', () => {
    const chat = [assistant('基线')];
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const before = { ...ledger, clock: { ...ledger.clock, day: 2 } };
    const fields = seedLedgerFieldView_ACU(ledger, 11);
    fields.records.actors = { draft: { module: 'actors', id: 'draft', status: 'partial', updatedAt: 19,
      fields: { name: { value: '真实草稿', revision: 3, updatedAt: 18 } },
      missingFields: [], } };
    fields.records.actors.draft.missingFields = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU.actors.required.filter(key => !(key in fields.records.actors!.draft.fields));
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = { schemaVersion: 1, entries: {
      [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor, updatedAt: 20,
        value: { schemaVersion: 2, checkpoint: before, checkpointFields: fields, deltas: [] } },
    } };
    const original = structuredClone(chat);
    const folded = foldWorldSimulationLedger_ACU(chat)!;
    expect(folded.fields.records.clock?._?.fields.day.value).toBe(2);
    expect(folded.fields.records.actors?.draft).toEqual(fields.records.actors.draft);
    expect(chat).toEqual(original);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 0, anchor, beforeLedger: before,
      nextLedger: { ...before, revision: 1 }, evidenceRefs: [], updatedAt: 30, checkpointIndex: 0,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.actors?.draft).toEqual(fields.records.actors.draft);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.revision).toBe(1);
  });

  it('提交只取目标楼及以前活跃 swipe，未来楼层的完整字段不污染前楼并可回退', () => {
    const chat = [assistant('首楼'), assistant('目标楼', 2), assistant('未来楼')];
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const first = resolveWorldSimulationAnchor_ACU(0, chat);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 0, anchor: first, beforeLedger: ledger,
      nextLedger: ledger, evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    const futureAnchor = resolveWorldSimulationAnchor_ACU(2, chat);
    const futureFields = seedLedgerFieldView_ACU(ledger, 50);
    futureFields.records.actors = { future: { module: 'actors', id: 'future', status: 'partial',
      fields: { name: { value: '未来草稿', revision: 1, updatedAt: 50 } }, missingFields: [], updatedAt: 50 } };
    futureFields.records.actors.future.missingFields = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU.actors.required.filter(key => !(key in futureFields.records.actors!.future.fields));
    chat[2][WORLD_SIMULATION_STATE_FIELD_ACU] = { schemaVersion: 1, entries: {
      [buildWorldSimulationBucketKey_ACU(futureAnchor)]: { anchor: futureAnchor, updatedAt: 50,
        value: { schemaVersion: 2, checkpoint: ledger, checkpointFields: futureFields, deltas: [] } },
    } };
    const second = resolveWorldSimulationAnchor_ACU(1, chat);
    const next = { ...ledger, revision: 1, clock: { ...ledger.clock, day: 2 } };
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 1, anchor: second, beforeLedger: ledger,
      nextLedger: next, evidenceRefs: [], updatedAt: 2, checkpointIndex: 0,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    expect(foldWorldSimulationLedger_ACU(chat, 1)?.ledger).toEqual(next);
    expect(foldWorldSimulationLedger_ACU(chat, 1)?.fields.records.actors?.future).toBeUndefined();
    chat.pop();
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(next);
    chat.pop();
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(ledger);
  });

  it('已补账本默认覆盖旧完整栏，显式提交前快照同步后保留 partial 修订', () => {
    const chat = [assistant('基线'), assistant('追加楼')];
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const oldFields = seedLedgerFieldView_ACU(ledger, 4);
    oldFields.records.clock!._.fields.day.value = 99;
    oldFields.records.actors = { pending: { module: 'actors', id: 'pending', status: 'partial',
      fields: { name: { value: '待完成的人', revision: 2, updatedAt: 5 } },
      missingFields: [], updatedAt: 5 } };
    oldFields.records.actors.pending.missingFields = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU.actors.required.filter(key => !(key in oldFields.records.actors!.pending.fields));
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = { schemaVersion: 1, entries: {
      [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor, updatedAt: 4,
        value: { schemaVersion: 2, checkpoint: ledger, checkpointFields: oldFields, deltas: [] } },
    } };
    const next = { ...ledger, revision: 1, clock: { ...ledger.clock, day: 2 } };
    const explicit = structuredClone(oldFields);
    const second = resolveWorldSimulationAnchor_ACU(1, chat);
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 1, anchor: second, beforeLedger: ledger,
      nextLedger: next, evidenceRefs: [], updatedAt: 7, checkpointIndex: 0, beforeFields: explicit,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
    const saved = (chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] as any).entries[buildWorldSimulationBucketKey_ACU(anchor)].value.checkpointFields;
    expect(saved.records.clock._.fields.day.value).toBe(ledger.clock.day);
    expect(saved.records.actors.pending).toEqual(oldFields.records.actors.pending);
    expect(explicit).toEqual(oldFields);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toEqual(next);
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.actors?.pending).toEqual(oldFields.records.actors.pending);
  });

  it('真实损坏的完整基线仍以结构化错误失败，不伪装成空分栏', () => {
    const chat = [assistant('损坏楼')];
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = { schemaVersion: 1, entries: {
      [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor, updatedAt: 1,
        value: { schemaVersion: 2, checkpoint: ledger, checkpointFields: { records: { actors: { damaged: { status: 'partial' } } } }, deltas: [] } },
    } };
    expect(() => foldWorldSimulationLedger_ACU(chat)).toThrowError(expect.objectContaining({
      error: expect.objectContaining({ code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' }),
    }));
  });

  it('键序不影响 delta 及归档比较，但数组顺序变化仍生成 delta', () => {
    const before = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const a = { id: 'a', name: '甲', interests: ['a', 'b'] } as never;
    const original = { ...before, actors: [a] };
    const reordered = { ...original, actors: [{ interests: ['a', 'b'], name: '甲', id: 'a' } as never] };
    expect(diffWorldSimulationLedger_ACU(original, reordered, undefined, 2, 1)).toBeNull();
    expect(diffWorldSimulationLedger_ACU(original, { ...original, actors: [{ ...a, interests: ['b', 'a'] }] }, undefined, 2, 1)?.upserts.actors).toHaveLength(1);
    const chat = [assistant('归档楼')];
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const record = { archiveRef: 'x', day: 1, oneLine: '记载', fingerprint: 'f', detail: '' };
    appendWorldSimulationCommitChain_ACU({ chat, messageIndex: 0, anchor, beforeLedger: before,
      nextLedger: before, evidenceRefs: [], updatedAt: 1, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: { x: record as never } },
      nextArchive: { schemaVersion: 1, records: { x: { fingerprint: 'f', detail: '', oneLine: '记载', day: 1, archiveRef: 'x' } as never } } });
    expect((chat[0][WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU] as any).entries[buildWorldSimulationBucketKey_ACU(anchor)].value.deltas).toEqual([]);
  });
});
