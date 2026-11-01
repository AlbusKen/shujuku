import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { legacyBackfillFingerprint_ACU } from '../../src/service/simulation/world-legacy-backfill';
import { readPreparedSimulationCausalView_ACU } from '../../src/service/zero-layer/prepared-simulation-causal-view';
import { commitZeroLayerLegacyBackfill_ACU, readZeroLayerLegacyBackfillSource_ACU } from '../../src/service/zero-layer/simulation-legacy-backfill';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import { WorldSimulationRuntime_ACU } from '../../src/service/simulation/simulation-runtime';

async function fixture() {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.task = { taskId: 'task-0', originInstruction: '旧结算', status: 'completed', createdAt: 1, updatedAt: 1, activeRun: null, stopReason: null };
  envelope.ledger.schemaVersion = 7;
  envelope.ledger.dimensions = [{ id: 'pressure-1', name: '城门戒严', kind: 'pressure', value: 80, trend: 'rising', rationale: '守卫增援', evidenceRefs: [], revision: 1 }];
  envelope.ledger.seeds = [{ id: 'seed-1', title: '失踪商队', status: 'active', level: 3, catalyst: '三日未归', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: null, revision: 1 }];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = envelope;
  simulation.fields = seedLedgerFieldView_ACU(envelope.ledger, 1);
  const ref = { sessionId: 'session-1', branchId: 'branch-1', turnId: 'turn-1', attemptId: 'attempt-1', floorId: 'floor-1' };
  const simulationResult = { schemaVersion: 1, ref, outcome: 'commit' as const, summary: '旧结算', ledger: structuredClone(envelope.ledger), fields: structuredClone(simulation.fields), archive: structuredClone(simulation.archive), projection: null, delivery: 'ledger-only' as const };
  simulation.confirmed = [{ ref, ledgerRevision: envelope.ledger.revision }];
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: 'turn-1', simulation }],
    turns: [{ turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1', input: '继续', body: '已发布正文', phase: 'published', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} }, assistantFloor: { floorId: 'floor-1', role: 'assistant', data: { table: { floorId: 'floor-1', tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [] }, simulation: simulationResult } },
      requiredEffects: ['simulation'], effectReceipts: [{ effectId: '["session-1","branch-1","turn-1","simulation"]', kind: 'simulation', status: 'durable', fingerprint: getTableDataFingerprint_ACU(simulationResult) }], errorCode: null }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-1', characterId: 0, this_chid: 0, characters: [{ avatar: 'card.png', name: '测试' }], getCurrentChatId: () => 'chat-1', saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  const store = new ZeroLayerSimulationStore_ACU();
  return { store, carrier, chat, saveChat, remote: () => remote };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _set_SillyTavern_API_ACU(undefined); });

describe('零层旧账本补迁', () => {
  it('正式 runtime 预览确认走零层端口，清空后不残留维护来源', async () => {
    const f = await fixture();
    const runtime = new WorldSimulationRuntime_ACU(undefined, () => f.chat, f.store);
    expect(runtime.previewLegacyBackfill().changed).toBe(true);
    expect(f.saveChat).not.toHaveBeenCalled();
    expect((await runtime.applyLegacyBackfill()).changed).toBe(true);
    expect(f.store.readState().legacyBackfill).toBeDefined();
    await runtime.clearData();
    expect(f.store.readState().legacyBackfill).toBeUndefined();
    expect(f.store.readState().envelope!.ledger.worldEvents).toEqual([]);
    expect(f.store.readSource().turns[0].body).toBe('已发布正文');
  });

  it('保存未知时保留旧载体并阻止盲重试，回读旧版本后可重新预览', async () => {
    const f = await fixture();
    const before = f.store.readSource();
    const source = readZeroLayerLegacyBackfillSource_ACU(f.store);
    const fingerprint = legacyBackfillFingerprint_ACU(source.ledger, source.archive);
    f.saveChat.mockRejectedValueOnce(new Error('保存中断'));
    await expect(commitZeroLayerLegacyBackfill_ACU(f.store, fingerprint)).rejects.toMatchObject({ code: 'persist-unknown' });
    await expect(commitZeroLayerLegacyBackfill_ACU(f.store, fingerprint)).rejects.toMatchObject({ code: 'persist-unknown' });
    expect(f.saveChat).toHaveBeenCalledOnce();
    await f.store.store.recover();
    expect(f.store.readSource()).toEqual(before);
    await commitZeroLayerLegacyBackfill_ACU(f.store, fingerprint);
    expect(f.store.readState().envelope!.ledger.worldEvents).toHaveLength(2);
  });

  it('维护来源绑定旧回执与新账本，篡改任一端均拒绝读取', async () => {
    const f = await fixture();
    const source = readZeroLayerLegacyBackfillSource_ACU(f.store);
    await commitZeroLayerLegacyBackfill_ACU(f.store, legacyBackfillFingerprint_ACU(source.ledger, source.archive));
    const migrated = f.store.readSource();
    const brokenOrigin = structuredClone(migrated);
    brokenOrigin.branches[0].simulation!.legacyBackfill!.baseLedgerFingerprint = '0'.repeat(64);
    expect(() => validateZeroLayerEnvelope_ACU(brokenOrigin)).toThrow();
    const brokenCurrent = structuredClone(migrated);
    brokenCurrent.branches[0].simulation!.envelope!.ledger.worldEvents[0].state = '被篡改';
    expect(() => validateZeroLayerEnvelope_ACU(brokenCurrent)).toThrow();
  });

  it('preview 零保存，严格保存新账本且旧 published 回执、confirmed 不变；未来 prepare 读取维护后的基底', async () => {
    const f = await fixture();
    const before = structuredClone(f.store.readSource());
    const source = readZeroLayerLegacyBackfillSource_ACU(f.store);
    expect(f.saveChat).not.toHaveBeenCalled();
    const result = await commitZeroLayerLegacyBackfill_ACU(f.store, legacyBackfillFingerprint_ACU(source.ledger, source.archive));
    expect(result.changed).toBe(true);
    expect(f.saveChat).toHaveBeenCalledOnce();
    const current = f.store.readSource();
    const state = f.store.readState();
    expect(state.envelope!.ledger.worldEvents.map(item => item.id)).toEqual(expect.arrayContaining(['legacy-dimension-66d8ceddcd240b8a845da108f7f0b0b3', 'legacy-seed-0eb026731d9ea3f870511f8c18daeb81']));
    expect(current.turns[0]).toEqual(before.turns[0]);
    expect(state.confirmed).toEqual(before.branches[0].simulation!.confirmed);
    expect(state.legacyBackfill).toMatchObject({ sourceRef: state.confirmed[0].ref, baseLedgerRevision: 0, ledgerRevision: 1 });
    const remote = validateZeroLayerEnvelope_ACU((f.remote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(state.envelope!.ledger);

    await commitZeroLayerLegacyBackfill_ACU(f.store, legacyBackfillFingerprint_ACU(state.envelope!.ledger, state.archive));
    expect(f.saveChat).toHaveBeenCalledOnce(); // 无变化补迁零保存。

    const zero = new ZeroLayerStore_ACU();
    const prepared = await zero.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2', input: '下一步', requiredEffects: [] }, current.revision);
    expect(prepared.turns.find(turn => turn.turnId === 'turn-2')!.materialBaseline!.simulation!.envelope!.ledger.worldEvents).toEqual(state.envelope!.ledger.worldEvents);
    expect(readPreparedSimulationCausalView_ACU(prepared, 'turn-2', 'attempt-2')!.worldEvents).toEqual(state.envelope!.ledger.worldEvents);
  });

  it('指纹改变与在途回合均在保存前拒绝', async () => {
    const f = await fixture();
    const source = readZeroLayerLegacyBackfillSource_ACU(f.store);
    await expect(commitZeroLayerLegacyBackfill_ACU(f.store, '0'.repeat(64))).rejects.toMatchObject({ code: 'revision-conflict' });
    expect(f.saveChat).not.toHaveBeenCalled();
    const zero = new ZeroLayerStore_ACU();
    await zero.commit({ type: 'prepare-turn', turnId: 'turn-2', attemptId: 'attempt-2', input: '下一步', requiredEffects: [] }, f.store.readSource().revision);
    await expect(commitZeroLayerLegacyBackfill_ACU(f.store, legacyBackfillFingerprint_ACU(source.ledger, source.archive))).rejects.toMatchObject({ code: 'pending-turn' });
  });
});
