import { describe, expect, it } from 'vitest';

import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_STATE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import {
  appendWorldSimulationCommitChain_ACU,
  appendWorldSimulationFieldDeltaChain_ACU,
  foldWorldSimulationLedger_ACU,
  readWorldSimulationLedgerFieldSnapshot_ACU,
} from '../../../src/service/simulation/simulation-ledger-fold';
import { buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import type { WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

function assistant(mes: string, swipeId = 0) {
  return { is_user: false, message_id: mes, mes, swipe_id: swipeId };
}

describe('世界推演账本折叠', () => {
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

describe('世界推演逐栏写入与分栏视图', () => {
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
    expect(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.actors?.['actor-a1']?.status).toBe('legacy_unknown');
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
});
