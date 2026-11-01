import { describe, expect, it } from 'vitest';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import {
  buildEmptyWorldDispatchJournal_ACU,
  observeWorldDispatchSuccessor_ACU,
  recordWorldDispatchIntent_ACU,
  validateWorldDispatchJournal_ACU,
  type WorldDispatchRecord_ACU,
  type WorldDispatchSource_ACU,
} from '../../../src/service/simulation/world-dispatch-journal';

const hash = (value: string): string => sha256HexSync_ACU(value);
const source = (suffix = 'origin'): WorldDispatchSource_ACU => ({
  chatIdentity: 'chat-a',
  messageKey: `message-${suffix}`,
  swipeId: '0',
  contentDigest: hash(`content-${suffix}`),
});
const intent = (suffix = 'one'): Omit<WorldDispatchRecord_ACU, 'successor'> => ({
  deliveryId: `delivery-${suffix}`,
  source: source(`origin-${suffix}`),
  ledgerRevision: 4,
  ledgerFingerprint: hash(`ledger-${suffix}`),
  factIds: [`fact-${suffix}`],
  requestFingerprint: hash(`request-${suffix}`),
  createdAt: 100,
});

function journalWithOne(): ReturnType<typeof recordWorldDispatchIntent_ACU> {
  return recordWorldDispatchIntent_ACU(buildEmptyWorldDispatchJournal_ACU(), intent());
}

describe('世界推演投送意图记录', () => {
  it('构建空记录，严格校验并深克隆，不保存请求文本或事实正文', () => {
    const empty = buildEmptyWorldDispatchJournal_ACU();
    expect(empty).toEqual({ schemaVersion: 1, revision: 0, records: [] });
    const recorded = journalWithOne();
    const validated = validateWorldDispatchJournal_ACU(recorded);
    validated.records[0].factIds[0] = 'changed';
    validated.records[0].source.chatIdentity = 'other-chat';
    expect(recorded.records[0].factIds).toEqual(['fact-one']);
    expect(recorded.records[0].source.chatIdentity).toBe('chat-a');
    expect(Object.keys(recorded.records[0]).sort()).toEqual([
      'createdAt', 'deliveryId', 'factIds', 'ledgerFingerprint', 'ledgerRevision', 'requestFingerprint', 'source', 'successor',
    ]);
  });

  it('拒绝 journal、record、source、successor 每层的未知字段', () => {
    const valid = journalWithOne();
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, extra: true })).toThrow(/严格/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], extra: true }] })).toThrow(/严格/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], source: { ...valid.records[0].source, extra: true } }] })).toThrow(/严格/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], successor: { anchor: { ...source('next'), extra: true }, observedAt: 101 } }] })).toThrow(/严格/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], successor: { anchor: source('next'), observedAt: 101, extra: true } }] })).toThrow(/严格/);
  });

  it('拒绝坏摘要、非法数字、重复 ID 和重复事实', () => {
    const valid = journalWithOne();
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, revision: 1.5 })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, revision: -1 })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, revision: Number.NaN })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, revision: Number.POSITIVE_INFINITY })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], createdAt: -1 }] })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], createdAt: Number.NaN }] })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], successor: { anchor: source('next'), observedAt: Number.POSITIVE_INFINITY } }] })).toThrow(/安全整数/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], ledgerFingerprint: hash('x').toUpperCase() }] })).toThrow(/SHA-256/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], source: { ...valid.records[0].source, contentDigest: 'bad' } }] })).toThrow(/SHA-256/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], factIds: [] }] })).toThrow(/1 至/);
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [valid.records[0], structuredClone(valid.records[0])] }))
      .toThrow('journal.records.deliveryId 不能重复');
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [valid.records[0], {
      ...valid.records[0], requestFingerprint: hash('different-request'),
    }] })).toThrow('journal.records.deliveryId 不能重复');
    expect(() => validateWorldDispatchJournal_ACU({ ...valid, records: [{ ...valid.records[0], factIds: ['fact-one', 'fact-one'] }] }))
      .toThrow('factIds 不能重复');
  });

  it('首次记录意图递增 revision、保持输入不变，并对同 deliveryId 重试幂等', () => {
    const empty = buildEmptyWorldDispatchJournal_ACU();
    const input = intent();
    const first = recordWorldDispatchIntent_ACU(empty, input);
    expect(first.revision).toBe(1);
    expect(first.records[0].successor).toBeNull();
    expect(empty).toEqual(buildEmptyWorldDispatchJournal_ACU());
    input.factIds[0] = 'changed-after-call';
    expect(first.records[0].factIds).toEqual(['fact-one']);
    const retried = recordWorldDispatchIntent_ACU(first, intent());
    expect(retried).toEqual(first);
    expect(retried).not.toBe(first);
  });

  it('拒绝同 deliveryId 的不同意图、持久化伪重投以及同来源同请求的伪重投', () => {
    const first = journalWithOne();
    expect(() => recordWorldDispatchIntent_ACU(first, { ...intent(), ledgerRevision: 5 })).toThrow(/不能变更/);
    expect(() => validateWorldDispatchJournal_ACU({
      ...first,
      records: [first.records[0], { ...first.records[0], deliveryId: 'delivery-manual' }],
    })).toThrow(/不同 deliveryId/);
    expect(() => recordWorldDispatchIntent_ACU(first, { ...intent('second'), source: source('origin-one'), requestFingerprint: hash('request-one') })).toThrow(/不同 deliveryId/);
  });

  it('拒绝跨聊天、同来源 swipe 与仅摘要不同原消息的后继锚点', () => {
    const first = journalWithOne();
    expect(() => observeWorldDispatchSuccessor_ACU(first, 'delivery-one', { ...source('next'), chatIdentity: 'chat-b' }, 101)).toThrow(/同一聊天/);
    expect(() => observeWorldDispatchSuccessor_ACU(first, 'delivery-one', { ...source('origin-one'), contentDigest: hash('changed-only-digest') }, 101)).toThrow(/仅摘要不同/);
    expect(() => observeWorldDispatchSuccessor_ACU(first, 'missing', source('next'), 101)).toThrow(/已存在/);
  });

  it('观察有效后继只证明显式观察，重复观察幂等且冲突后继被拒绝', () => {
    const first = journalWithOne();
    const next = source('next');
    const observed = observeWorldDispatchSuccessor_ACU(first, 'delivery-one', next, 101);
    expect(observed.revision).toBe(2);
    expect(observed.records[0].successor).toEqual({ anchor: next, observedAt: 101 });
    expect(first.records[0].successor).toBeNull();
    const repeated = observeWorldDispatchSuccessor_ACU(observed, 'delivery-one', next, 999);
    expect(repeated).toEqual(observed);
    const retriedIntent = recordWorldDispatchIntent_ACU(observed, intent());
    expect(retriedIntent).toEqual(observed);
    expect(retriedIntent.records[0].successor).toEqual({ anchor: next, observedAt: 101 });
    expect(repeated.records[0].successor?.observedAt).toBe(101);
    expect(() => observeWorldDispatchSuccessor_ACU(observed, 'delivery-one', source('other-next'), 102)).toThrow(/不能替换/);
    expect(() => observeWorldDispatchSuccessor_ACU(first, 'delivery-one', next, 99)).toThrow(/不能早于/);
  });

  it('达到 256 条容量或安全 revision 上限后拒绝新增和观察', () => {
    let journal = buildEmptyWorldDispatchJournal_ACU();
    for (let index = 0; index < 256; index += 1) journal = recordWorldDispatchIntent_ACU(journal, intent(String(index)));
    expect(journal.records).toHaveLength(256);
    expect(() => recordWorldDispatchIntent_ACU(journal, intent('overflow'))).toThrow(/上限/);
    const maxRevision = { ...journalWithOne(), revision: Number.MAX_SAFE_INTEGER };
    expect(() => recordWorldDispatchIntent_ACU(maxRevision, intent('new'))).toThrow(/上限/);
    expect(() => observeWorldDispatchSuccessor_ACU(maxRevision, 'delivery-one', source('next'), 101)).toThrow(/上限/);
  });
});
