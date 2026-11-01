import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { buildConfirmedSimulationCausalView_ACU } from '../../src/service/zero-layer/simulation-causal-view';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';

const logicalBody = '逻辑正文：角色在广场等待，推演不得改写正文。';

function actor(id: string) {
  return {
    id, name: id === 'actor-1' ? '守卫' : '巡逻员', interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null, shortTermAction: null,
    simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1,
  };
}

async function setup(withArchive = false) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文：不得改写', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger.actors = [actor('actor-1'), actor('actor-2')];
  if (withArchive) {
    envelope.ledger.clock.day = 2;
    envelope.ledger.historyMilestones = Array.from({ length: 31 }, (_, index) => ({ id: `initial-${index}`, summary: '近期重要历史',
      happenedAt: { day: 2, slot: '' }, actorIds: ['actor-1'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 3,
      category: '人生节点', visibility: 'internal' as const, revision: 1, legacyRefs: [] }));
    envelope.ledger.historyArchive = [{ id: 'cold-history', summary: '冷层完整因果历史', happenedAt: { day: 1, slot: '' },
      actorIds: ['actor-1', 'actor-2'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 3,
      category: '重大关系变化', visibility: 'internal', revision: 1, legacyRefs: [] }];
  }
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = envelope;
  simulation.fields = seedLedgerFieldView_ACU(envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: String(carrier.mes),
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation }],
    turns: [{
      turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1', input: '继续',
      body: logicalBody, phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} },
      assistantFloor: { floorId: 'floor-1', role: 'assistant', data: {} },
      simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [], errorCode: null,
    }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({
    chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1', saveChat,
  } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));

  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('turn-1');
  const identity: WorldSimulationRunIdentity_ACU = {
    runId: 'run-1', chatIdentity: store.getChatIdentity(), triggerKind: 'assistant_completed', triggerConversationMessageId: null,
    kind: 'logical', logicalRef: anchor.logicalRef, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1',
  };
  await store.updateState(state => {
    state.envelope!.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1,
      updatedAt: 1, activeRun: identity, stopReason: null };
    state.envelope!.activeStageId = identity.stageId;
    state.envelope!.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  });
  const fact = {
    id: 'locked-fact', summary: '守卫在幕后更换了巡逻路线', temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds: ['actor-1'], worldEventIds: [],
    projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null, nextCheck: null,
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
  const roundCandidate: WorldRoundCandidate_ACU = {
    baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [{ value: fact, expectedRevision: 0 }], historyMilestoneWrites: [{ expectedRevision: 0, value: {
      id: 'history-1', summary: '守卫完成幕后巡逻调整', happenedAt: { day: 2, slot: '' }, actorIds: ['actor-1'],
      worldEventIds: [], locationRef: null, sourceFactIds: [fact.id], importance: 1, category: '行动',
      visibility: 'internal', revision: 1, legacyRefs: [],
    } }], actorCompletions: [
      { actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 },
      { actorId: 'actor-2', completion: 'no_change', expectedRevision: 1 },
    ], projection: { anchor: null, deliveries: [] }, completion: 'changed',
  };
  await commitZeroLayerSimulationRound_ACU(store, {
    identity, anchor, roundCandidate, completedAt: 10, timelineId: 'timeline-1', summary: '账本结算',
  });
  return { store, anchor, saveChat, getRemote: () => structuredClone(remote) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('已确认推演内部因果视图', () => {
  it('真实 carrier 冷历史进入完整因果视图且参与指纹，不重复共享节点', async () => {
    const { store, anchor, getRemote } = await setup(true);
    const state = store.readState();
    const view = buildConfirmedSimulationCausalView_ACU(state, anchor.logicalRef, 1);
    expect(view.historyMilestones).toHaveLength(33);
    const cold = view.historyMilestones.filter(item => item.id === 'cold-history');
    expect(cold).toHaveLength(1);
    expect(cold[0].actorIds).toEqual(['actor-1', 'actor-2']);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU].branches[0].simulation.envelope.ledger.historyArchive)
      .toEqual(state.envelope!.ledger.historyArchive);
    const changed = structuredClone(state);
    changed.envelope!.ledger.historyArchive![0].summary = '冷层历史变更';
    expect(buildConfirmedSimulationCausalView_ACU(changed, anchor.logicalRef, 1).fingerprint).not.toBe(view.fingerprint);
    cold[0].summary = '外部修改';
    expect(state.envelope!.ledger.historyArchive![0].summary).toBe('冷层完整因果历史');
  });

  it('事实冷层进入完整因果视图及指纹，但不修改热层投影账本', async () => {
    const { store, anchor } = await setup();
    const state = store.readState();
    state.envelope!.ledger.factArchive = [{ ...structuredClone(state.envelope!.ledger.facts[0]), id: 'cold-fact', summary: '冷层完整因果事实' }];
    const view = buildConfirmedSimulationCausalView_ACU(state, anchor.logicalRef, 1);
    expect(view.facts.map(item => item.id)).toEqual(expect.arrayContaining(['locked-fact', 'cold-fact']));
    const changed = structuredClone(state);
    changed.envelope!.ledger.factArchive![0].summary = '冷层事实被篡改';
    expect(buildConfirmedSimulationCausalView_ACU(changed, anchor.logicalRef, 1).fingerprint).not.toBe(view.fingerprint);
    view.facts.find(item => item.id === 'cold-fact')!.summary = '外部修改';
    expect(state.envelope!.ledger.factArchive![0].summary).toBe('冷层完整因果事实');
  });

  it('只从真实 carrier 已确认 ledger 深拷贝读取 locked 因果事实，不影响正文或投影', async () => {
    const { store, anchor, saveChat, getRemote } = await setup();
    const state = store.readState();
    const view = buildConfirmedSimulationCausalView_ACU(state, anchor.logicalRef, 1);

    expect(saveChat).toHaveBeenCalledTimes(2);
    expect((getRemote()[0] as Record<string, any>)[ZERO_LAYER_CARRIER_FIELD_ACU].branches[0].simulation.confirmed)
      .toMatchObject([{ ref: anchor.logicalRef, ledgerRevision: 1 }]);
    expect(view.revision).toBe(1);
    expect(view.source).toEqual(anchor.logicalRef);
    expect(view.actors).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'actor-1' })]));
    expect(view.facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'locked-fact', revealState: 'locked' })]));
    expect(view.historyMilestones).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'history-1' })]));
    expect(view.worldEvents).toEqual([]);
    expect(view.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(buildConfirmedSimulationCausalView_ACU(state, anchor.logicalRef, 1).fingerprint).toBe(view.fingerprint);
    const source = store.readSource();
    expect(source.turns[0].body).toBe(logicalBody);
    expect(state.envelope!.ledger.projection).toEqual({ anchor: null, deliveries: [] });
    expect(source.turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'ledger-only', projection: null });

    view.source.sessionId = 'mutated';
    view.facts[0].summary = 'mutated';
    view.actors[0].knownFacts.push('mutated');
    expect(state.confirmed[0].ref.sessionId).toBe('session-1');
    expect(state.envelope!.ledger.facts[0].summary).toBe('守卫在幕后更换了巡逻路线');
    expect(state.envelope!.ledger.actors[0].knownFacts).toEqual([]);
  });

  it('canonical fingerprint 忽略对象键序但保留数组顺序', async () => {
    const { store, anchor } = await setup();
    const state = store.readState();
    const baseline = buildConfirmedSimulationCausalView_ACU(state, anchor.logicalRef, 1);
    const reorderedKeys = structuredClone(state);
    reorderedKeys.envelope!.ledger.facts[0] = Object.fromEntries(Object.entries(reorderedKeys.envelope!.ledger.facts[0]).reverse()) as any;
    expect(buildConfirmedSimulationCausalView_ACU(reorderedKeys, anchor.logicalRef, 1).fingerprint).toBe(baseline.fingerprint);
    const reorderedArray = structuredClone(state);
    reorderedArray.envelope!.ledger.actors.reverse();
    expect(buildConfirmedSimulationCausalView_ACU(reorderedArray, anchor.logicalRef, 1).fingerprint).not.toBe(baseline.fingerprint);
  });

  it('对确认损坏、旧 schema、revision 漂移、篡改引用、未完成任务和损坏账本 fail-closed', async () => {
    const { store, anchor } = await setup();
    const state = store.readState();
    const invalid = structuredClone(state);
    invalid.confirmed.push(structuredClone(invalid.confirmed[0]));
    expect(() => buildConfirmedSimulationCausalView_ACU(invalid, anchor.logicalRef, 1)).toThrow();

    const unmatchedBad = structuredClone(state) as any;
    unmatchedBad.confirmed.push({ ref: { ...anchor.logicalRef }, ledgerRevision: 1, extra: true });
    expect(() => buildConfirmedSimulationCausalView_ACU(unmatchedBad, anchor.logicalRef, 1)).toThrow();
    const sameTurnConflict = structuredClone(state);
    sameTurnConflict.confirmed.push({ ref: { ...anchor.logicalRef, branchId: 'other-branch' }, ledgerRevision: 1 });
    expect(() => buildConfirmedSimulationCausalView_ACU(sameTurnConflict, anchor.logicalRef, 1)).toThrow();

    const oldSchema = structuredClone(state);
    oldSchema.envelope!.ledger.schemaVersion = 6 as any;
    expect(() => buildConfirmedSimulationCausalView_ACU(oldSchema, anchor.logicalRef, 1)).toThrow();
    const drifted = structuredClone(state);
    drifted.confirmed[0].ledgerRevision = 0;
    expect(() => buildConfirmedSimulationCausalView_ACU(drifted, anchor.logicalRef, 0)).toThrow();
    expect(() => buildConfirmedSimulationCausalView_ACU(state, { ...anchor.logicalRef, branchId: 'other-branch' }, 1)).toThrow();
    const future = structuredClone(state);
    future.envelope!.ledger.revision = 2;
    expect(() => buildConfirmedSimulationCausalView_ACU(future, anchor.logicalRef, 1)).toThrow();
    const incomplete = structuredClone(state);
    incomplete.envelope!.task!.status = 'running';
    expect(() => buildConfirmedSimulationCausalView_ACU(incomplete, anchor.logicalRef, 1)).toThrow();
    const corrupt = structuredClone(state);
    corrupt.envelope!.ledger.facts = [{ id: 'invalid' }] as any;
    expect(() => buildConfirmedSimulationCausalView_ACU(corrupt, anchor.logicalRef, 1)).toThrow();
  });
});
