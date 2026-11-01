import { describe, expect, it } from 'vitest';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import {
  applyWorldDeliveryAdoption_ACU,
  buildEmptyWorldDeliveryLifecycle_ACU,
  createWorldDeliveryIntent_ACU,
  markWorldDeliveryAttempted_ACU,
  markWorldDeliveryUnknown_ACU,
  queryWorldDeliveryRedeliveryCandidates_ACU,
  recordWorldDeliveryDurableSuccessor_ACU,
  validateWorldDeliveryLifecycle_ACU,
} from '../../../src/service/simulation/world-delivery-lifecycle';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';

const hash = (value: string) => sha256HexSync_ACU(value);
const source = { chatIdentity: 'chat', messageKey: 'number:1', swipeId: '0', contentDigest: hash('source') } as const;
const successor = { chatIdentity: 'chat', messageKey: 'number:2', swipeId: '0', contentDigest: hash('successor') } as const;

function intent(id = 'delivery') {
  return { deliveryId: id, target: 'body' as const, source, ledgerRevision: 3, ledgerFingerprint: hash('ledger'), factIds: ['fact-a'], requestFingerprint: hash(`request-${id}`), createdAt: 10 };
}

function durable(id = 'delivery') {
  return recordWorldDeliveryDurableSuccessor_ACU(markWorldDeliveryAttempted_ACU(createWorldDeliveryIntent_ACU(buildEmptyWorldDeliveryLifecycle_ACU(), intent(id)), id), id, successor);
}

describe('world delivery lifecycle', () => {
  it('严格校验、不可变 phase 和幂等 intent', () => {
    const empty = buildEmptyWorldDeliveryLifecycle_ACU();
    const created = createWorldDeliveryIntent_ACU(empty, intent());
    expect(empty.records).toHaveLength(0);
    expect(created.records[0].status).toBe('intent');
    expect(createWorldDeliveryIntent_ACU(created, structuredClone(intent()))).toEqual(created);
    expect(() => createWorldDeliveryIntent_ACU(created, { ...intent(), factIds: ['other'] })).toThrow('不可变更');
    expect(() => validateWorldDeliveryLifecycle_ACU({ schemaVersion: 1, revision: 0, records: [], extra: true })).toThrow('字段必须严格');
  });

  it('未知状态不能再次投送且已完成态不可降级', () => {
    const unknown = markWorldDeliveryUnknown_ACU(markWorldDeliveryAttempted_ACU(createWorldDeliveryIntent_ACU(buildEmptyWorldDeliveryLifecycle_ACU(), intent()), 'delivery'), 'delivery');
    expect(markWorldDeliveryUnknown_ACU(unknown, 'delivery')).toEqual(unknown);
    expect(() => markWorldDeliveryAttempted_ACU(unknown, 'delivery')).toThrow('unknown');
    expect(() => markWorldDeliveryUnknown_ACU(durable(), 'delivery')).toThrow('response-durable');
  });

  it('仅采用绑定 receipt 的精确正例，并按 fact 跨来源累计最多两次重投', () => {
    let lifecycle = durable();
    lifecycle = applyWorldDeliveryAdoption_ACU(lifecycle, { schemaVersion: 1, deliveryId: 'delivery', ledgerRevision: 3, ledgerFingerprint: hash('ledger'), source, successor, requestFingerprint: hash('request-delivery'), reviewSource: 'narrative-review', results: [{ factId: 'fact-a', adopted: false, evidenceQuotes: [] }] });
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [{ id: 'fact-a', summary: '事实', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: { region: 'r', place: 'p' }, actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    expect(queryWorldDeliveryRedeliveryCandidates_ACU(lifecycle, ledger, { region: 'r', place: 'p' }, { day: 1, slot: '' })).toHaveLength(1);
    const second = { ...lifecycle.records[0], deliveryId: 'two', requestFingerprint: hash('another-request'), source: { ...source, messageKey: 'number:8', contentDigest: hash('source-2') } };
    const third = { ...second, deliveryId: 'three', requestFingerprint: hash('third-request'), source: { ...source, messageKey: 'number:9', contentDigest: hash('source-3') } };
    const capped = { schemaVersion: 1 as const, revision: 9, records: [lifecycle.records[0], second, third] };
    expect(queryWorldDeliveryRedeliveryCandidates_ACU(capped, ledger, { region: 'r', place: 'p' }, { day: 1, slot: '' })).toHaveLength(0);
    expect(() => createWorldDeliveryIntent_ACU({ schemaVersion: 1, revision: 9, records: [lifecycle.records[0], second] }, { ...intent('too-many'), source: { ...source, messageKey: 'number:10', contentDigest: hash('source-4') } })).toThrow('最多投送两次');
    expect(() => applyWorldDeliveryAdoption_ACU(durable(), { schemaVersion: 1, deliveryId: 'delivery', ledgerRevision: 3, ledgerFingerprint: hash('ledger'), source, successor, requestFingerprint: hash('request-delivery'), reviewSource: 'narrative-review', results: [{ factId: 'fact-a', adopted: true, evidenceQuotes: [] }] })).toThrow('精确引文');
  });
});
