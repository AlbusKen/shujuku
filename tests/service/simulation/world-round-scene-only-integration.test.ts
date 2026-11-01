import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorldRoundPayload_ACU } from '../../helpers/world-round-payload';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { runWorldRound_ACU } from '../../../src/service/simulation/agent/world-round-runner';
import { materializeWorldRoundCandidate_ACU } from '../../../src/service/simulation/world-candidate';
import { commitWorldSimulationRound_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { commitZeroLayerSimulationRound_ACU } from '../../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../../src/service/zero-layer/simulation-store';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../../src/service/zero-layer/model';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../../src/service/zero-layer/carrier-context';
import { seedLedgerFieldView_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import type { WorldFact_ACU, WorldSimulationRunIdentity_ACU } from '../../../src/service/simulation/model';

type Mode = 'single' | 'layered';
type Scenario = { mode?: Mode; anchorText?: string; playerLocation?: { region: string; place: string } | null; targetAnchor?: boolean; badDigest?: boolean; cancelAtActor?: boolean; rejectSceneBudget?: boolean; semanticReveal?: boolean };

const place = { region: '临江城', place: '北门广场' } as const;
const anchorText = '我站在北门广场，风从城墙外吹来。';

function actor() {
  return { id: 'guard-1', name: '林守卫', interests: [], location: '北门广场', locationRef: place, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: ['值守'], constraints: [], informationSources: [], knownFacts: [],
    visibility: 'hidden' as const, currentAction: null, shortTermAction: null, longTermAction: null, simulationStatus: 'active' as const,
    loreRefs: [], experiences: [], revision: 1 };
}

function fact(id: string, overrides: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return { id, summary: `绝不应泄露的摘要:${id}`, temporalKind: 'occurrence', happenedAt: { day: 2, slot: '午' }, validFrom: null,
    validUntil: null, locationRef: place, actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked',
    revealGate: null, nextCheck: null, sourceRefs: ['private'], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...overrides };
}

function reserved(identity: WorldSimulationRunIdentity_ACU) {
  return {
    task: { taskId: identity.taskId, originInstruction: '仅结算账本', status: 'running' as const, createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null },
    activeStageId: identity.stageId,
    stages: [{ stageId: identity.stageId, stageNumber: 1, status: 'running' as const, activeRevision: identity.stageRevision,
      revisions: [{ revision: identity.stageRevision, createdAt: 1, reason: 'initial' as const, replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '场景候选诊断', objective: '仅账本提交', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }],
  };
}

function stagePayload(messages: readonly { content: string }[]) {
  return readWorldRoundPayload_ACU(messages) as Record<string, any>;
}

function runnerScenario(options: Scenario = {}) {
  const mode = options.mode ?? 'layered';
  const body = options.anchorText ?? anchorText;
  const digest = sha256HexSync_ACU(body);
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = mode;
  envelope.ledger.clock = { day: 2, slot: '午', storyTime: '第二日午', precision: 'exact', evidenceRefs: [] };
  envelope.ledger.player.location = options.playerLocation === undefined ? { ...place } : options.playerLocation;
  envelope.ledger.player.contact = 'open';
  envelope.ledger.actors = [actor()];
  envelope.ledger.facts = [
    fact('scene-local'),
    fact('gated-local', { projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '主动询问密信', locationRef: place } }),
    fact('scene-remote', { locationRef: { region: '临江城', place: '南码头' } }),
  ];
  const identity: WorldSimulationRunIdentity_ACU = {
    kind: 'host', runId: `scene-${mode}`, chatIdentity: 'scene-host', triggerKind: 'assistant_completed', triggerConversationMessageId: null,
    anchorContentDigest: options.badDigest ? sha256HexSync_ACU('forged') : digest, baseLedgerRevision: 0, taskId: `task-${mode}`,
    stageId: `stage-${mode}`, stageRevision: 1, deliveryTarget: 'body', workflowMode: mode, workflowProtocol: 'world-round-v1',
    anchorMessageId: '71', anchorMessageKey: 'string:71', anchorSwipeId: '0',
  };
  const controller = new AbortController();
  const invoke = vi.fn(async (_role: string, messages: readonly { content: string }[]) => {
    const data = stagePayload(messages);
    if (data.stage === 'world-narrative-review-v1') {
      return JSON.stringify({ locationRef: { ...place }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '北门广场' }],
        reviews: data.candidates.map((candidate: { factId: string }) => ({ factId: candidate.factId,
          triggered: options.semanticReveal === true && candidate.factId === 'gated-local',
          evidence: options.semanticReveal === true && candidate.factId === 'gated-local' ? [{ quote: '主动询问密信' }] : [],
        })),
      });
    }
    if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: envelope.ledger.clock });
    if (data.stage === 'recall-selection') return JSON.stringify({
      selections: data.directory.actorIds.map((actorId: string) => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'actor' })),
      worldSelection: { worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'world' },
    });
    if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [], factWrites: [] });
    if (data.stage === 'actor-batch') {
      if (options.cancelAtActor) controller.abort();
      return JSON.stringify({ actorWrites: [], actorCompletions: data.actorIds.map((actorId: string) => ({ actorId, completion: 'no_change', expectedRevision: 1 })), factWrites: [], historyMilestoneWrites: [] });
    }
    throw new Error(`不应调用 projection semantic:${String(data.stage)}`);
  });
  const countTokens = async (text: string) => options.rejectSceneBudget && text === JSON.stringify({ factIds: ['scene-local'] }) ? 1_000_000 : 1;
  const targetAnchor = { chatIdentity: 'scene-host', messageIndex: 1, messageId: '71', messageKey: 'string:71', swipeId: '0', contentDigest: digest } as const;
  return { envelope, identity, body, invoke, targetAnchor, input: {
    identity, settings: envelope.settings, ledger: envelope.ledger, anchorText: body, ...(options.targetAnchor === false ? {} : { targetAnchor }),
    signal: controller.signal, invoke, countTokens, isCurrent: () => true,
  } };
}

function commitCandidate(identity: WorldSimulationRunIdentity_ACU, summary: string) {
  return { runId: identity.runId, taskId: identity.taskId, stageId: identity.stageId, stageRevision: identity.stageRevision,
    baseLedgerRevision: identity.baseLedgerRevision, summary, acceptedCandidates: [], evidenceRefs: [] };
}

async function zeroFixture(mode: Mode) {
  const source = runnerScenario({ mode });
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理层正文不应被改写', swipe_id: 0 };
  const chat = [carrier];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = structuredClone(source.envelope);
  simulation.fields = seedLedgerFieldView_ACU(source.envelope.ledger, 1);
  const logical: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'scene-session', scope: { chatId: 'scene-chat', characterKey: 'char:scene.png' }, carrierId: 'scene-carrier',
    carrierSwipeId: 0, seedBody: '物理层正文不应被改写', activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'scene-branch',
    branches: [{ branchId: 'scene-branch', headTurnId: null, simulation }],
    turns: [{ turnId: 'scene-turn', branchId: 'scene-branch', parentTurnId: null, attemptId: 'scene-attempt', input: '继续', body: source.body,
      phase: 'response-durable', createdAt: 1, updatedAt: 1, userFloor: { floorId: 'user', role: 'user', data: {} },
      assistantFloor: { floorId: 'floor', role: 'assistant', data: {} }, simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [], errorCode: null }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = logical;
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({ chat, chatId: 'scene-chat', characterId: 0, this_chid: 0, characters: [{ avatar: 'scene.png', name: '测试' }],
    getCurrentChatId: () => 'scene-chat', saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('scene-turn');
  const identity: WorldSimulationRunIdentity_ACU = { ...source.identity, kind: 'logical', chatIdentity: store.getChatIdentity(),
    logicalRef: anchor.logicalRef, anchorContentDigest: anchor.contentDigest, runId: `zero-${mode}`, taskId: `zero-task-${mode}`, stageId: `zero-stage-${mode}` };
  delete (identity as Partial<WorldSimulationRunIdentity_ACU>).anchorMessageId;
  delete (identity as Partial<WorldSimulationRunIdentity_ACU>).anchorMessageKey;
  delete (identity as Partial<WorldSimulationRunIdentity_ACU>).anchorSwipeId;
  await store.updateState(state => { const running = reserved(identity); state.envelope!.task = running.task; state.envelope!.activeStageId = running.activeStageId; state.envelope!.stages = running.stages; });
  return { source, store, anchor, identity, carrier };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _set_SillyTavern_API_ACU(undefined); });

describe('world-round scene-only 真实集成', () => {
  it.each<Mode>(['single', 'layered'])('%s 仅返回同地 unlocked scene ID；同名人物、自然语言和 open contact 不会解锁 gated', async mode => {
    const f = runnerScenario({ mode, anchorText: '我见到林守卫，和他站在北门广场。' });
    const result = await runWorldRound_ACU(f.input);

    expect(result.sceneCandidateIds).toEqual(['scene-local']);
    expect(result.roundCandidate.projection).toEqual({ anchor: null, deliveries: [] });
    expect(result.ledger.facts.find(item => item.id === 'gated-local')?.revealState).toBe('locked');
    expect(result.ledger.actors[0].knownFacts).toEqual([]);
    expect(JSON.stringify(result.sceneCandidateIds)).not.toContain('绝不应泄露');
    expect(f.invoke.mock.calls.some(([, messages]) => messages.some((item: { content: string }) => item.content.includes('world-narrative-review-v1')))).toBe(true);
    expect(materializeWorldRoundCandidate_ACU(f.envelope.ledger, result.roundCandidate).facts.find(item => item.id === 'gated-local')?.revealState).toBe('locked');
  });

  it('同轮新 scene 业务事实与既有 gated reveal proof 同时返回，且候选状态为 changed', async () => {
    const f = runnerScenario({ anchorText: '我在北门广场主动询问密信。', semanticReveal: true });
    f.envelope.ledger.facts.push(fact('new-scene', { summary: '同轮新场景事实' }));
    const result = await runWorldRound_ACU(f.input);
    expect(result.reviewedReveal?.factIds).toEqual(['gated-local']);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(result.ledger.facts.find(item => item.id === 'new-scene')?.revealState).toBe('unlocked');
    expect(result.ledger.facts.find(item => item.id === 'gated-local')?.revealState).toBe('locked');
  });

  it('普通宿主真实提交保持 ledger-only，候选 ID 不进入 projection 或正文', async () => {
    const f = runnerScenario({ mode: 'single' });
    const chat: any[] = [{}, { message_id: 71, is_user: false, mes: f.body, message: f.body, swipe_id: 0, swipes: [f.body] }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'scene-host', getCurrentChatId: () => 'scene-host' } as any);
    f.targetAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    f.input.targetAnchor = f.targetAnchor;
    f.identity = { ...f.identity, chatIdentity: f.targetAnchor.chatIdentity, anchorMessageId: f.targetAnchor.messageId, anchorMessageKey: f.targetAnchor.messageKey,
      anchorSwipeId: f.targetAnchor.swipeId, anchorContentDigest: f.targetAnchor.contentDigest };
    f.input.identity = f.identity;
    expect(f.identity.chatIdentity).toBe(f.targetAnchor.chatIdentity);
    expect(f.identity.anchorContentDigest).toBe(sha256HexSync_ACU(f.body));
    expect(f.targetAnchor.contentDigest).toBe(sha256HexSync_ACU(f.body));
    expect(f.identity.anchorMessageKey).toBe(f.targetAnchor.messageKey);
    const running = reserved(f.identity);
    f.envelope.task = running.task; f.envelope.activeStageId = running.activeStageId; f.envelope.stages = running.stages;
    chat[0]._qrf_world_simulation = f.envelope;
    let remote = structuredClone(chat);
    const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
    _set_SillyTavern_API_ACU({ chat, chatId: 'scene-host', characterId: 0, this_chid: 0, characters: [{ avatar: 'scene.png', name: '测试' }], getCurrentChatId: () => 'scene-host', saveChat } as any);
    expect(f.identity.chatIdentity).toBe('scene-host');
    const fetchChat = vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] }));
    vi.stubGlobal('fetch', fetchChat);
    const result = await runWorldRound_ACU(f.input);
    await commitWorldSimulationRound_ACU({ identity: f.identity, anchor: f.targetAnchor, roundCandidate: result.roundCandidate,
      completedAt: 2, timelineId: 'scene-host-commit', commitCandidate: commitCandidate(f.identity, result.summary) });

    expect(result.sceneCandidateIds).toEqual(['scene-local']);
    expect(fetchChat).not.toHaveBeenCalled();
    expect(chat[1].mes).toBe(f.body);
    expect(chat[0]._qrf_world_simulation.ledger.projection).toEqual({ anchor: null, deliveries: [] });
    expect(remote[0]._qrf_world_simulation.ledger.projection).toEqual({ anchor: null, deliveries: [] });
    expect(remote[0]._qrf_world_simulation.ledger.facts.find((item: WorldFact_ACU) => item.id === 'gated-local').revealState).toBe('locked');
    expect(chat[0]._qrf_world_simulation.ledger.facts.find((item: WorldFact_ACU) => item.id === 'gated-local').revealState).toBe('locked');
  });

  it.each<Mode>(['single', 'layered'])('%s 零层真实 carrier 提交同样仅落账本，不投送场景候选', async mode => {
    const f = await zeroFixture(mode);
    const result = await runWorldRound_ACU({ ...f.source.input, identity: f.identity, ledger: f.store.read()!.ledger,
      settings: f.store.read()!.settings, anchorText: f.source.body, targetAnchor: f.anchor });
    await commitZeroLayerSimulationRound_ACU(f.store, { identity: f.identity, anchor: f.anchor, roundCandidate: result.roundCandidate,
      completedAt: 2, timelineId: `zero-scene-${mode}`, summary: result.summary });

    expect(result.sceneCandidateIds).toEqual(['scene-local']);
    expect(f.store.readState().envelope!.ledger.projection).toEqual({ anchor: null, deliveries: [] });
    expect(f.store.readSource().turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'ledger-only', projection: null });
    expect(f.store.readState().envelope!.ledger.facts.find(item => item.id === 'gated-local')?.revealState).toBe('locked');
  });

  it('缺 targetAnchor 时跳过；正文审查可在旧址或空 player 账本上校准场景候选', async () => {
    await expect(runWorldRound_ACU(runnerScenario({ targetAnchor: false }).input)).resolves.toMatchObject({ sceneCandidateIds: [] });
    const distant = runnerScenario({ playerLocation: { region: '临江城', place: '南码头' } });
    distant.envelope.ledger.facts = distant.envelope.ledger.facts.filter(item => item.id !== 'scene-remote');
    await expect(runWorldRound_ACU(distant.input)).resolves.toMatchObject({ sceneCandidateIds: ['scene-local'] });
    await expect(runWorldRound_ACU(runnerScenario({ playerLocation: null }).input)).resolves.toMatchObject({ sceneCandidateIds: ['scene-local'] });
  });

  it('同楼层正文摘要变化仍可取得投送，取消或真实预算超限仍停止', async () => {
    const badDigest = runnerScenario({ badDigest: true });
    await expect(runWorldRound_ACU(badDigest.input)).resolves.toMatchObject({ sceneCandidateIds: ['scene-local'], bodyProjection: { proof: expect.any(Object) } });
    expect(badDigest.invoke.mock.calls.some(([, messages]) => messages.some((item: { content: string }) => item.content.includes('world-narrative-review-v1')))).toBe(true);

    const cancelled = runnerScenario({ cancelAtActor: true });
    await expect(runWorldRound_ACU(cancelled.input)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(cancelled.invoke.mock.calls.some(([, messages]) => messages.some((item: { content: string }) => item.content.includes('world-narrative-review-v1')))).toBe(false);

    const budget = runnerScenario({ rejectSceneBudget: true });
    await expect(runWorldRound_ACU(budget.input)).rejects.toThrow(/投影 ID 预算拒绝/);
    expect(budget.invoke.mock.calls.some(([, messages]) => messages.some((item: { content: string }) => item.content.includes('world-narrative-review-v1')))).toBe(true);
  });
});
