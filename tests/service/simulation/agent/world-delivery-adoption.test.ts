import { describe, expect, it } from 'vitest';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { reviewWorldDeliveryAdoption_ACU, claimWorldDeliveryAdoption_ACU, readWorldDeliveryAdoption_ACU } from '../../../../src/service/simulation/agent/world-delivery-adoption';
import { applyWorldDeliveryAdoption_ACU } from '../../../../src/service/simulation/world-delivery-lifecycle';
import { validateWorldSimulationLedger_ACU } from '../../../../src/service/simulation/simulation-store';

const hash = (value: string) => sha256HexSync_ACU(value);
const source = { chatIdentity: 'chat', messageKey: 'number:1', swipeId: '0', contentDigest: hash('source') } as const;
const successorText = '叙事中确实写出了可见事实。';
const successor = { chatIdentity: 'chat', messageKey: 'number:2', swipeId: '0', contentDigest: hash(successorText) } as const;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);

function input() {
  const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.revision = 2;
  ledger.facts = [{ id: 'fact', summary: '可见事实', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
  return { delivery: { deliveryId: 'delivery', target: 'body' as const, source, ledgerRevision: 2, ledgerFingerprint: hash(canonical(ledger)), factIds: ['fact'], requestFingerprint: hash('request'), createdAt: 1, status: 'response-durable' as const, successor, adoptedFactIds: null, reviewSource: null }, ledger, source, successor, successorText, requestFingerprint: hash('request') };
}
function lifecycle(value: ReturnType<typeof input>) {
  return { schemaVersion: 1 as const, revision: 0, records: [structuredClone(value.delivery)] };
}

function refreshLedgerBinding(value: ReturnType<typeof input>) {
  validateWorldSimulationLedger_ACU(value.ledger, 'agent_persist');
  value.delivery.ledgerFingerprint = hash(canonical(value.ledger));
  value.delivery.ledgerRevision = value.ledger.revision;
}

function reviewFalse() {
  return async (_facts?: unknown, _successorText?: string) => ({ results: [{ factId: 'fact', adopted: false, evidenceQuotes: [] }] });
}

describe('world delivery adoption', () => {


  it('opaque receipt 只能用原 binding 领取一次，且正例引文必须真实存在', async () => {
    const value = input();
    const { receipt } = await reviewWorldDeliveryAdoption_ACU({ ...value, signal: new AbortController().signal, assertCurrent: () => undefined, review: async () => ({ results: [{ factId: 'fact', adopted: true, evidenceQuotes: ['可见事实'] }] }) });
    const metadata = readWorldDeliveryAdoption_ACU(receipt);
    expect(metadata).toEqual({ deliveryId: 'delivery' });
    expect(claimWorldDeliveryAdoption_ACU(receipt, { ...value, signal: new AbortController().signal, assertCurrent: () => undefined })).toMatchObject({ deliveryId: 'delivery', results: [{ adopted: true }] });
    expect(() => readWorldDeliveryAdoption_ACU(receipt)).toThrow('已消费');
    const controller = new AbortController();
    await expect(reviewWorldDeliveryAdoption_ACU({ ...input(), signal: controller.signal, assertCurrent: () => undefined, review: async () => ({ results: [{ factId: 'fact', adopted: true, evidenceQuotes: ['完全不存在'] }] }) })).rejects.toThrow('精确引文');
    let current = true;
    await expect(reviewWorldDeliveryAdoption_ACU({ ...input(), signal: new AbortController().signal, assertCurrent: () => { if (!current) throw new Error('stale'); }, review: async () => { current = false; return { results: [{ factId: 'fact', adopted: false, evidenceQuotes: [] }] }; } })).rejects.toThrow('WORLD_DELIVERY_ADOPTION_REVIEW_FAILED');
    controller.abort();
    await expect(reviewWorldDeliveryAdoption_ACU({ ...input(), signal: controller.signal, assertCurrent: () => undefined, review: async () => ({ results: [{ factId: 'fact', adopted: false, evidenceQuotes: [] }] }) })).rejects.toThrow('取消');
  });
  it('拒绝同 revision 的权威账本漂移及错误后继摘要绑定', async () => {
    const drifted = input();
    drifted.ledger.facts[0].summary = '同 revision 的不同事实';
    await expect(reviewWorldDeliveryAdoption_ACU({ ...drifted, signal: new AbortController().signal, assertCurrent: () => undefined, review: reviewFalse() }))
      .rejects.toThrow('fingerprint');

    const badSuccessor = input();
    badSuccessor.successor = { ...badSuccessor.successor, contentDigest: hash('不同正文') };
    badSuccessor.delivery.successor = badSuccessor.successor;
    await expect(reviewWorldDeliveryAdoption_ACU({ ...badSuccessor, signal: new AbortController().signal, assertCurrent: () => undefined, review: reviewFalse() }))
      .rejects.toThrow('严格绑定');
  });

  it.each(['ledger', 'name', 'text'] as const)('review await 期间输入 %s 漂移时拒绝', async target => {
    const value = input();
    const controller = new AbortController();
    let request: any;
    request = {
      ...value, signal: controller.signal, assertCurrent: () => undefined,
      review: async () => {
        if (target === 'ledger') request.ledger.facts[0].summary = '已漂移';
        if (target === 'name') request.source = { ...request.source, messageKey: 'number:99' };
        if (target === 'text') request.successorText = '已漂移正文';
        return { results: [{ factId: 'fact', adopted: false, evidenceQuotes: [] }] };
      },
    };
    await expect(reviewWorldDeliveryAdoption_ACU(request)).rejects.toThrow('WORLD_DELIVERY_ADOPTION_REVIEW_FAILED');
  });

  it('取消、非法 token 计数、联合超预算和 counter 原文异常均 fail-closed', async () => {
    const cancelled = input();
    const controller = new AbortController(); controller.abort();
    await expect(reviewWorldDeliveryAdoption_ACU({ ...cancelled, signal: controller.signal, assertCurrent: () => undefined, review: reviewFalse() }))
      .rejects.toThrow('取消');

    for (const count of [NaN, Infinity, 0]) {
      await expect(reviewWorldDeliveryAdoption_ACU({ ...input(), signal: new AbortController().signal, assertCurrent: () => undefined, countTokens: async () => count, review: reviewFalse() }))
        .rejects.toThrow('预算');
    }
    let calls = 0;
    await expect(reviewWorldDeliveryAdoption_ACU({ ...input(), signal: new AbortController().signal, assertCurrent: () => undefined,
      countTokens: async () => (++calls === 1 ? 8192 : 1), review: reviewFalse(),
    })).rejects.toThrow('总 token');
    const secret = 'COUNTER_INTERNAL_SECRET';
    await expect(reviewWorldDeliveryAdoption_ACU({ ...input(), signal: new AbortController().signal, assertCurrent: () => undefined,
      countTokens: async () => { throw new Error(secret); }, review: reviewFalse(),
    })).rejects.not.toThrow(secret);
  });

  it('伪造、跨请求及已消费 receipt 都不可采用，all-false 可应用为 reviewed 空采用集', async () => {
    const value = input();
    const reviewInput = { ...value, signal: new AbortController().signal, assertCurrent: () => undefined, review: reviewFalse() };
    const { receipt } = await reviewWorldDeliveryAdoption_ACU(reviewInput);
    expect(() => claimWorldDeliveryAdoption_ACU({}, { ...value, signal: new AbortController().signal, assertCurrent: () => undefined })).toThrow('伪造');

    const crossRequest = input(); crossRequest.requestFingerprint = hash('other-request');
    expect(() => claimWorldDeliveryAdoption_ACU(receipt, { ...crossRequest, signal: new AbortController().signal, assertCurrent: () => undefined })).toThrow('已变化');

    const fresh = input();
    const { receipt: applicable } = await reviewWorldDeliveryAdoption_ACU({ ...fresh, signal: new AbortController().signal, assertCurrent: () => undefined, review: reviewFalse() });
    const dto = claimWorldDeliveryAdoption_ACU(applicable, { ...fresh, signal: new AbortController().signal, assertCurrent: () => undefined });
    expect(dto.results).toEqual([{ factId: 'fact', adopted: false, evidenceQuotes: [] }]);
    const adopted = applyWorldDeliveryAdoption_ACU(lifecycle(fresh), dto);
    expect(adopted.records[0]).toMatchObject({ status: 'reviewed', adoptedFactIds: [], reviewSource: 'narrative-review' });
    expect(() => claimWorldDeliveryAdoption_ACU(applicable, { ...fresh, signal: new AbortController().signal, assertCurrent: () => undefined })).toThrow('已消费');
  });
  it('自定义 adoption-review 提示词按完整消息计量，禁用段不发送且超预算不调用', async () => {
    const value = input();
    const received: Array<{ role: string; content: string }[]> = [];
    await reviewWorldDeliveryAdoption_ACU({ ...value, signal: new AbortController().signal, assertCurrent: () => undefined,
      settings: { worldRoundPrompts: { 'adoption-review': [
        { role: 'system', content: 'ADOPTION_REVIEW_CUSTOM_MARKER', enabled: true, deletable: true, pinned: false },
        { role: 'user', content: 'ADOPTION_REVIEW_DISABLED_MARKER', enabled: false, deletable: true, pinned: false },
      ] } },
      reviewWithMessages: async messages => {
        received.push([...messages]);
        return { results: [{ factId: 'fact', adopted: false, evidenceQuotes: [] }] };
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0][1]).toEqual({ role: 'system', content: 'ADOPTION_REVIEW_CUSTOM_MARKER' });
    expect(JSON.stringify(received)).not.toContain('ADOPTION_REVIEW_DISABLED_MARKER');

    const overflow = input();
    let reviewCalls = 0;
    const review = async () => { reviewCalls += 1; return { results: [{ factId: 'fact', adopted: false, evidenceQuotes: [] }] }; };
    await expect(reviewWorldDeliveryAdoption_ACU({ ...overflow, signal: new AbortController().signal, assertCurrent: () => undefined,
      settings: { worldRoundPrompts: { 'adoption-review': [{ role: 'system', content: 'ADOPTION_REVIEW_OVERFLOW', enabled: true, deletable: true, pinned: false }] } },
      countTokens: async () => 8193, reviewWithMessages: review,
    })).rejects.toThrow(/预算/);
    expect(reviewCalls).toBe(0);
  });
});
