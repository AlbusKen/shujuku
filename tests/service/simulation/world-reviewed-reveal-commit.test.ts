import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorldRoundPayload_ACU } from '../../helpers/world-round-payload';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { runWorldRound_ACU } from '../../../src/service/simulation/agent/world-round-runner';
import { prepareWorldFactRevealProof_ACU, runWorldProjectionStage_ACU } from '../../../src/service/simulation/agent/world-projection-stage';
import {
  commitReviewedWorldSimulationRound_ACU,
  commitWorldSimulationRound_ACU,
} from '../../../src/service/simulation/simulation-commit-adapter';
import { materializeWorldRoundCandidate_ACU } from '../../../src/service/simulation/world-candidate';
import { FirstFloorWorldSimulationStore_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import {
  commitZeroLayerReviewedSimulationRound_ACU,
  commitZeroLayerSimulationRound_ACU,
} from '../../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../../src/service/zero-layer/simulation-store';
import { seedLedgerFieldView_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const place = { region: '上海', place: '钟楼' };
const anchorText = '我主动向守卫询问那封密信，并在钟楼下等待答复。';
const secretSummary = '机密摘要：守卫持有钟楼密信的原件。';

type RoundHostFixture = ReturnType<typeof createRoundHostFixture>;
type ZeroLayerFixture = Awaited<ReturnType<typeof createZeroLayerFixture>>;

function actor(id = 'guard-1') {
  return {
    id, name: '守卫', interests: [], location: '钟楼', locationRef: { ...place }, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: ['守卫钟楼'], constraints: [],
    informationSources: [], knownFacts: [], visibility: 'hidden' as const, currentAction: null,
    shortTermAction: null, longTermAction: null, simulationStatus: 'active' as const,
    loreRefs: [], experiences: [], revision: 1,
  };
}

function lockedGatedFact() {
  return {
    id: 'fact-locked-letter', summary: secretSummary, temporalKind: 'occurrence' as const,
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: { ...place },
    actorIds: ['guard-1'], worldEventIds: [], projectionPolicy: 'gated' as const, revealState: 'locked' as const,
    revealGate: {
      actorIds: ['guard-1'], locationRef: { ...place }, notBefore: { day: 2, slot: '' },
      semanticCondition: '正文中必须明确向守卫询问密信。',
    },
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

function frozenStage(identity: any) {
  return [{
    stageId: identity.stageId, stageNumber: 1, status: 'running' as const, activeRevision: identity.stageRevision,
    revisions: [{
      revision: identity.stageRevision, createdAt: 1, reason: 'initial' as const, replanInstruction: '', frozen: true,
      plan: {
        schemaVersion: 1, title: '受限揭示提交', objective: '只结算已审核揭示', impactScope: [], factsToVerify: [],
        plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [],
        blockingConditions: [], completedSteps: [], nextStep: '提交',
      },
    }],
  }];
}

function payload(messages: readonly { content: string }[]) {
  return readWorldRoundPayload_ACU(messages) as Record<string, any>;
}

function roundInvoker() {
  return vi.fn(async (_role: string, messages: readonly { content: string }[]) => {
    const input = payload(messages);
    if (input.stage === 'clock-candidate') {
      return JSON.stringify({ candidateClock: { day: 2, slot: '', storyTime: '第二日', precision: 'exact', evidenceRefs: [] } });
    }
    if (input.stage === 'recall-selection') {
      return JSON.stringify({
        selections: input.directory.actorIds.map((actorId: string) => ({
          actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '本轮无额外资料', priority: 1, scope: 'actor',
        })),
        worldSelection: { worldEventIds: [], factIds: [], reason: '本轮无额外资料', priority: 1, scope: 'world' },
      });
    }
    if (input.stage === 'world-page') return JSON.stringify({ worldEventWrites: [], factWrites: [] });
    return JSON.stringify({
      actorWrites: [],
      actorCompletions: (input.actorIds as string[]).map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })),
      factWrites: [], historyMilestoneWrites: [],
    });
  });
}

async function reviewedRound(fixture: {
  identity: any; anchor: any; envelope: any; readLedger(): any;
}) {
  const raw = await runWorldRound_ACU({
    identity: fixture.identity, settings: fixture.envelope.settings, ledger: fixture.readLedger(), anchorText,
    signal: new AbortController().signal, invoke: roundInvoker(), countTokens: async () => 1, isCurrent: () => true,
  });
  // proof 必须绑定 raw candidate 物化后的 base+1 预览账本，而非旧 base。
  const preview = materializeWorldRoundCandidate_ACU(fixture.readLedger(), raw.roundCandidate);
  const stage = await runWorldProjectionStage_ACU({
    ledger: preview, identity: fixture.identity, targetAnchor: fixture.anchor, anchorText,
    sceneLocation: { ...place }, contactedActorIds: ['guard-1'], settings: fixture.envelope.settings,
    signal: new AbortController().signal, countTokens: async () => 1, isCurrent: () => true,
    invoke: async () => JSON.stringify({ reviews: [{ factId: 'fact-locked-letter', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }] }),
  });
  const reviewed = await prepareWorldFactRevealProof_ACU({
    receipt: stage.receipt, ledger: preview, identity: fixture.identity, targetAnchor: fixture.anchor, anchorText,
    clock: preview.clock, sceneLocation: { ...place }, contactedActorIds: ['guard-1'], settings: fixture.envelope.settings,
    signal: new AbortController().signal, countTokens: async () => 1, isCurrent: () => true,
  });
  return { raw: raw.roundCandidate, preview, ...reviewed };
}

function createRoundHostFixture() {
  const chat: any[] = [{}, { message_id: 71, is_user: false, mes: anchorText, message: anchorText, swipe_id: 0, swipes: [anchorText] }];
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({
    chat, chatId: 'reviewed-round-host', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'reviewed-card.png', name: '测试角色' }], getCurrentChatId: () => 'reviewed-round-host', saveChat,
  } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = 'single';
  envelope.ledger.player = { ...envelope.ledger.player, location: { ...place } };
  envelope.ledger.actors = [actor()];
  envelope.ledger.facts = [lockedGatedFact()];
  const identity = {
    runId: 'reviewed-host-run', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
    anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'reviewed-host-task', stageId: 'reviewed-host-stage', stageRevision: 1,
    workflowProtocol: 'world-round-v1' as const, deliveryTarget: 'body' as const, workflowMode: 'single' as const,
  };
  envelope.task = { taskId: identity.taskId, originInstruction: '仅测试显式提交边界', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
  envelope.activeStageId = identity.stageId;
  envelope.stages = frozenStage(identity);
  chat[0]._qrf_world_simulation = envelope;
  const store = new FirstFloorWorldSimulationStore_ACU();
  return { chat, remote: () => remote, saveChat, anchor, identity, envelope, store, readLedger: () => store.read()!.ledger };
}

let zeroLayerFixtureId = 0;
async function createZeroLayerFixture() {
  const fixtureId = ++zeroLayerFixtureId;
  const chatId = `reviewed-zero-chat-${fixtureId}`;
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文不应被本测试改写。', swipe_id: 0 };
  const chat = [carrier];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = 'single';
  envelope.ledger.player = { ...envelope.ledger.player, location: { ...place } };
  envelope.ledger.actors = [actor()];
  envelope.ledger.facts = [lockedGatedFact()];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = envelope;
  simulation.fields = seedLedgerFieldView_ACU(envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: `reviewed-zero-session-${fixtureId}`, scope: { chatId, characterKey: 'char:reviewed-card.png' },
    carrierId: `reviewed-zero-carrier-${fixtureId}`, carrierSwipeId: 0, seedBody: carrier.mes as string,
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)), activationMessageCount: 1,
    enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation }],
    turns: [{
      turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1', input: '继续', body: anchorText,
      phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} }, assistantFloor: { floorId: 'floor-1', role: 'assistant', data: {} },
      simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [], errorCode: null,
    }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({
    chat, chatId, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'reviewed-card.png', name: '测试角色' }], getCurrentChatId: () => chatId, saveChat,
  } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('turn-1');
  const identity = {
    runId: 'reviewed-zero-run', chatIdentity: store.getChatIdentity(), triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, kind: 'logical' as const, logicalRef: anchor.logicalRef,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'reviewed-zero-task',
    stageId: 'reviewed-zero-stage', stageRevision: 1, deliveryTarget: 'body' as const,
    workflowProtocol: 'world-round-v1' as const, workflowMode: 'single' as const,
  };
  await store.updateState(state => {
    state.envelope!.task = { taskId: identity.taskId, originInstruction: '仅测试显式提交边界', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    state.envelope!.activeStageId = identity.stageId;
    state.envelope!.stages = frozenStage(identity);
  });
  return { carrier, chat, remote: () => remote, saveChat, store, anchor, identity, envelope, readLedger: () => store.read()!.ledger };
}

async function expectRejectedWithoutSecret(operation: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(String(caught)).not.toContain(secretSummary);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('reviewed reveal 显式提交边界', () => {
  it('普通宿主：同一保存严格服务器回读后才同时推进 clock、reveal；外部正文与 projection 不变', async () => {
    const f = createRoundHostFixture();
    const reviewed = await reviewedRound(f);
    expect(reviewed.preview).toMatchObject({ revision: 1, clock: { day: 2 }, facts: [{ id: 'fact-locked-letter', revealState: 'locked' }] });

    await commitReviewedWorldSimulationRound_ACU({
      identity: f.identity, anchor: f.anchor, completedAt: 10, timelineId: 'reviewed-host-timeline',
      commitCandidate: { runId: f.identity.runId, taskId: f.identity.taskId, stageId: f.identity.stageId,
        stageRevision: f.identity.stageRevision, baseLedgerRevision: 0, summary: '仅结算审核许可', acceptedCandidates: [], evidenceRefs: [] },
      roundCandidate: reviewed.raw, proof: reviewed.proof, factIds: reviewed.factIds,
    } as any);

    const saved = f.store.read()!.ledger;
    expect(saved).toMatchObject({ revision: 1, clock: { day: 2 }, facts: [{ id: 'fact-locked-letter', revealState: 'unlocked', revision: 2 }] });
    expect(f.chat[1].mes).toBe(anchorText);
    expect(saved.projection).toEqual(f.envelope.ledger.projection);
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.remote()[0]._qrf_world_simulation.ledger).toMatchObject({ revision: 1, clock: { day: 2 }, facts: [{ revealState: 'unlocked' }] });
  });

  it('普通宿主保存失败会补偿，旧入口携 proof 或将既有 gated fact 直接改 unlocked 都不能越过显式边界', async () => {
    const f = createRoundHostFixture();
    const reviewed = await reviewedRound(f);
    f.saveChat.mockRejectedValueOnce(new Error('HOST_SAVE_FAILED'));
    await expectRejectedWithoutSecret(() => commitReviewedWorldSimulationRound_ACU({
      identity: f.identity, anchor: f.anchor, completedAt: 10, timelineId: 'reviewed-host-failed',
      commitCandidate: { runId: f.identity.runId, taskId: f.identity.taskId, stageId: f.identity.stageId,
        stageRevision: f.identity.stageRevision, baseLedgerRevision: 0, summary: '审核失败', acceptedCandidates: [], evidenceRefs: [] },
      roundCandidate: reviewed.raw, proof: reviewed.proof, factIds: reviewed.factIds,
    } as any));
    expect(f.store.read()!.ledger).toMatchObject({ revision: 0, clock: { day: 1 }, facts: [{ revealState: 'locked' }] });

    const incomplete = createRoundHostFixture();
    const incompleteReviewed = await reviewedRound(incomplete);
    const missingCompletion = structuredClone(incompleteReviewed.raw);
    missingCompletion.actorCompletions = [];
    await expectRejectedWithoutSecret(() => commitReviewedWorldSimulationRound_ACU({
      identity: incomplete.identity, anchor: incomplete.anchor, completedAt: 10, timelineId: 'reviewed-host-incomplete',
      commitCandidate: { runId: incomplete.identity.runId, taskId: incomplete.identity.taskId, stageId: incomplete.identity.stageId,
        stageRevision: incomplete.identity.stageRevision, baseLedgerRevision: 0, summary: '缺失人物覆盖', acceptedCandidates: [], evidenceRefs: [] },
      roundCandidate: missingCompletion, proof: incompleteReviewed.proof, factIds: incompleteReviewed.factIds,
    } as any));
    expect(incomplete.store.read()!.ledger).toMatchObject({ revision: 0, clock: { day: 1 }, facts: [{ revealState: 'locked' }] });

    const legacy = createRoundHostFixture();
    const legacyReviewed = await reviewedRound(legacy);
    await expectRejectedWithoutSecret(() => commitWorldSimulationRound_ACU({
      identity: legacy.identity, anchor: legacy.anchor, completedAt: 10, timelineId: 'legacy-proof',
      commitCandidate: { runId: legacy.identity.runId, taskId: legacy.identity.taskId, stageId: legacy.identity.stageId,
        stageRevision: legacy.identity.stageRevision, baseLedgerRevision: 0, summary: '拒绝旧入口', acceptedCandidates: [], evidenceRefs: [] },
      roundCandidate: legacyReviewed.raw, proof: legacyReviewed.proof, factIds: legacyReviewed.factIds,
    } as any));
    const forged = structuredClone(legacyReviewed.raw);
    forged.factWrites = [{ value: { ...lockedGatedFact(), revealState: 'unlocked', revision: 2 }, expectedRevision: 1 }];
    await expectRejectedWithoutSecret(() => commitWorldSimulationRound_ACU({
      identity: legacy.identity, anchor: legacy.anchor, completedAt: 10, timelineId: 'legacy-forged',
      commitCandidate: { runId: legacy.identity.runId, taskId: legacy.identity.taskId, stageId: legacy.identity.stageId,
        stageRevision: legacy.identity.stageRevision, baseLedgerRevision: 0, summary: '拒绝伪造', acceptedCandidates: [], evidenceRefs: [] },
      roundCandidate: forged,
    } as any));
    expect(legacy.store.read()!.ledger).toMatchObject({ revision: 0, facts: [{ revealState: 'locked' }] });
  });

  it('零层：response-durable carrier 同次保存 reveal、confirmed 与回执，逻辑和物理正文及 projection 均不改写', async () => {
    const f = await createZeroLayerFixture();
    const reviewed = await reviewedRound(f);

    await commitZeroLayerReviewedSimulationRound_ACU(f.store, {
      identity: f.identity, anchor: f.anchor, roundCandidate: reviewed.raw, completedAt: 10,
      timelineId: 'reviewed-zero-success', summary: '仅结算审核许可', proof: reviewed.proof, factIds: reviewed.factIds,
    } as any);

    const source = f.store.readSource();
    const state = f.store.readState();
    expect(state.envelope!.ledger).toMatchObject({ revision: 1, clock: { day: 2 }, facts: [{ id: 'fact-locked-letter', revealState: 'unlocked', revision: 2 }] });
    expect(state.confirmed).toMatchObject([{ ref: f.anchor.logicalRef, ledgerRevision: 1 }]);
    expect(source.turns[0]).toMatchObject({ phase: 'response-durable', body: anchorText, effectReceipts: [{ kind: 'simulation' }] });
    expect(f.carrier.mes).toBe('物理正文不应被本测试改写。');
    expect(state.envelope!.ledger.projection).toEqual(f.envelope.ledger.projection);
    expect(f.saveChat).toHaveBeenCalledTimes(2); // 预留与同次业务 carrier 保存。
  });

  it('零层：保存结果未知时保留 locked 且不盲重试，旧入口仍拒绝 proof', async () => {
    const f = await createZeroLayerFixture();
    const reviewed = await reviewedRound(f);
    f.saveChat.mockRejectedValueOnce(new Error('CARRIER_SAVE_UNKNOWN'));
    const input = {
      identity: f.identity, anchor: f.anchor, roundCandidate: reviewed.raw, completedAt: 10,
      timelineId: 'reviewed-zero-timeline', summary: '仅结算审核许可', proof: reviewed.proof, factIds: reviewed.factIds,
    };
    await expectRejectedWithoutSecret(() => commitZeroLayerReviewedSimulationRound_ACU(f.store, input as any));
    await expectRejectedWithoutSecret(() => commitZeroLayerReviewedSimulationRound_ACU(f.store, input as any));
    expect(f.saveChat).toHaveBeenCalledTimes(2); // 预留后仅有一次业务保存；第二次提交未重发。
    const original = f.remote()[0][ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU;
    expect(original.branches[0].simulation!.envelope!.ledger).toMatchObject({ revision: 0, facts: [{ revealState: 'locked' }] });
    expect(original.turns[0].effectReceipts).toEqual([]);

    const legacy = await createZeroLayerFixture();
    const legacyReviewed = await reviewedRound(legacy);
    await expectRejectedWithoutSecret(() => commitZeroLayerSimulationRound_ACU(legacy.store, {
      identity: legacy.identity, anchor: legacy.anchor, roundCandidate: legacyReviewed.raw, completedAt: 10,
      timelineId: 'legacy-zero-proof', summary: '拒绝旧入口', proof: legacyReviewed.proof, factIds: legacyReviewed.factIds,
    } as any));
    expect(legacy.store.read()!.ledger).toMatchObject({ revision: 0, facts: [{ revealState: 'locked' }] });
  });
});
