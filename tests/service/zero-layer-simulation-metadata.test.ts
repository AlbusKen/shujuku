import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { validateWorldSimulationEnvelope_ACU } from '../../src/service/simulation/simulation-store';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { sha256HexSync_ACU } from '../../src/shared/sha256-sync';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';

async function createFixture() {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = envelope;
  simulation.fields = seedLedgerFieldView_ACU(envelope.ledger, 0);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation }], turns: [],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({
    chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1', saveChat,
  } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  return { carrier, store: new ZeroLayerSimulationStore_ACU(), saveChat };
}

function fact(id: string) {
  return {
    id, summary: '已确认事实', temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' },
    validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [],
    projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

function reordered<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('零层推演元数据写口', () => {
  it('同一逻辑楼层正文新增内容后继续接受原锚点，尝试或楼层身份变化仍拒绝', async () => {
    const { carrier, store, saveChat } = await createFixture();
    const source = carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU;
    source.turns.push({ turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1',
      input: '继续', body: '原正文', phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} },
      assistantFloor: { floorId: 'assistant-1', role: 'assistant', data: {} },
      requiredEffects: ['simulation'], effectReceipts: [], errorCode: null });
    const anchor = store.anchorForTurn('turn-1');
    source.turns[0].body = '原正文，新加了一段叙述';
    expect(store.anchorForTurn('turn-1').contentDigest).toBe(sha256HexSync_ACU(source.turns[0].body!));
    expect(() => store.assertAnchor(anchor)).not.toThrow();
    expect(() => store.assertAnchor({ ...anchor, logicalRef: { ...anchor.logicalRef, attemptId: 'other' } }))
      .toThrow(/推演逻辑锚点已变化/);
    expect(() => store.assertAnchor({ ...anchor, logicalRef: { ...anchor.logicalRef, floorId: 'other' } }))
      .toThrow(/推演逻辑锚点已变化/);
    expect(saveChat).not.toHaveBeenCalled();
    expect(carrier.mes).toBe('物理正文');
  });

  it('校验器重排默认账本键时，仅更新元数据并原样保留已持久账本', async () => {
    const { store, saveChat } = await createFixture();
    const before = store.read()!.ledger;
    const beforeJson = JSON.stringify(before);
    const validated = validateWorldSimulationEnvelope_ACU({ ...store.read()!, updatedAt: 1 }, 'persist').ledger;
    expect(JSON.stringify(validated)).not.toBe(beforeJson);

    await store.updateAtomically(current => ({ ...current!, task: null, updatedAt: 1 }));

    expect(JSON.stringify(store.read()!.ledger)).toBe(beforeJson);
    expect(store.read()!.updatedAt).toBe(1);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['clock', (ledger: any) => { ledger.clock.day += 1; }],
    ['facts', (ledger: any) => { ledger.facts.push(fact('fact-1')); }],
    ['revision', (ledger: any) => { ledger.revision += 1; }],
  ])('账本 %s 值变化仍拒绝且不保存', async (_name, change) => {
    const { store, saveChat } = await createFixture();
    await expect(store.updateAtomically(current => {
      const next = structuredClone(current!);
      change(next.ledger);
      return next;
    })).rejects.toMatchObject({ code: 'invalid-transition' });
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('嵌套对象键重排语义相同可保存，数组顺序改变仍拒绝', async () => {
    const { store, saveChat } = await createFixture();
    await store.updateAtomically(current => {
      const next = structuredClone(current!);
      next.ledger.clock = reordered(next.ledger.clock);
      next.updatedAt = 1;
      return next;
    });
    expect(saveChat).toHaveBeenCalledTimes(1);

    await store.updateState(state => {
      state.envelope!.ledger.guidance.excludedFacts = ['a', 'b'];
      state.fields = seedLedgerFieldView_ACU(state.envelope!.ledger, state.envelope!.updatedAt);
    });
    expect(saveChat).toHaveBeenCalledTimes(2);
    await expect(store.updateAtomically(current => {
      const next = structuredClone(current!);
      next.ledger.guidance.excludedFacts.reverse();
      return next;
    })).rejects.toMatchObject({ code: 'invalid-transition' });
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('损坏既有账本不会降级为空状态', async () => {
    const { carrier, store, saveChat } = await createFixture();
    const payload = carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU;
    const state = payload.branches[0].simulation!;
    (state.envelope!.ledger as any).clock = {};

    expect(() => store.read()).toThrow(/ledger\.clock 缺少必填字段/);
    await expect(store.updateAtomically(current => ({ ...current!, updatedAt: 1 })))
      .rejects.toBeDefined();
    expect((payload.branches[0].simulation!.envelope!.ledger as any).clock).toEqual({});
    expect(saveChat).not.toHaveBeenCalled();
  });
});
