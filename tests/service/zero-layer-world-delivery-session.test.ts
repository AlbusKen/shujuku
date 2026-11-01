import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));

const { mockCallAIWithResolvedPreset_ACU, mockCountWorldSimulationTokens_ACU } = vi.hoisted(() => ({
  mockCallAIWithResolvedPreset_ACU: vi.fn(),
  mockCountWorldSimulationTokens_ACU: vi.fn(async (text: string) => Math.max(1, Math.ceil(String(text).length / 4))),
}));

vi.mock('../../src/service/ai/api-call', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/ai/api-call')>(),
  callAIWithResolvedPreset_ACU: mockCallAIWithResolvedPreset_ACU,
}));
vi.mock('../../src/service/simulation/agent/agent-token-budget', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/simulation/agent/agent-token-budget')>(),
  countWorldSimulationTokens_ACU: mockCountWorldSimulationTokens_ACU,
}));
// 世界书发现不属于此会话投递验收范围，避免宿主世界书状态干扰冻结请求。
vi.mock('../../src/service/agent/agent-worldbook-skill-meta', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/agent/agent-worldbook-skill-meta')>(),
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => ({ available: false, control: null })),
}));

import { _set_currentChatFileIdentifier_ACU, settings_ACU } from '../../src/service/runtime/state-manager';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerSession_ACU, type ZeroLayerResponseSettlement_ACU } from '../../src/service/zero-layer/session';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { ZeroLayerError_ACU } from '../../src/service/zero-layer/model';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../src/shared/sha256-sync';
import { buildChatTemplateScopeStateFromCurrent_ACU, setCurrentChatTemplateScopeState_ACU } from '../../src/service/template/chat-scope';

const ANCHOR_BODY = '主角站在钟楼广场，遇到了守卫。';
const SAFE_FACT = '钟楼广场的守卫确认城门已经关闭。';
const LOCKED_FACT = 'LOCKED_SCENE_SECRET_钟楼守卫携带密钥。';
const INTERNAL_FACT = 'INTERNAL_FACT_SECRET_钟楼的暗门已经打开。';
const OTHER_PLACE_FACT = 'OTHER_PLACE_FACT_SECRET_港口仓库已被封锁。';
const PUBLIC_PLOT = '<plot>公开剧情继续推进。</plot>';
const RESPONSE_BODY = `守卫郑重确认：${SAFE_FACT}`;
const CLOCK_SQUARE = { region: '城区', place: '钟楼广场' };
const DOCK = { region: '港区', place: '港口仓库' };
const WINDOW = globalThis as typeof globalThis & { window?: typeof globalThis };

type AiCall = { messages: Array<{ role: string; content: string }> };

function actor(id: string) {
  return { id, name: '守卫', interests: [], location: '', locationRef: CLOCK_SQUARE, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1 };
}

function fact(id: string, summary: string, locationRef: typeof CLOCK_SQUARE,
  projectionPolicy: 'scene' | 'internal', revealState: 'locked' | 'unlocked') {
  return { id, summary, temporalKind: 'occurrence' as const, happenedAt: { day: 2, slot: '' },
    validFrom: null, validUntil: null, locationRef, actorIds: ['actor-1'], worldEventIds: [],
    projectionPolicy, revealState, revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [],
    supersedesFactIds: [], revision: 1 };
}

function tableTemplate() {
  return {
    mate: { type: 'chatSheets', version: 2 },
    sheet_0: { uid: 'sheet_0', name: '会话表', sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
      content: [['row_id', '值']], updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1 },
      exportConfig: { enabled: false, splitByRow: false, entryName: '', entryType: '', keywords: '', preventRecursion: false,
        injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: '', extraIndexColumns: [], extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '', entryPlacement: { position: 'before_character_definition', depth: 0, order: 0 },
        extraIndexPlacement: { position: 'before_character_definition', depth: 0, order: 0 },
        fixedEntryPlacement: { position: 'before_character_definition', depth: 0, order: 0 },
        fixedIndexPlacement: { position: 'before_character_definition', depth: 0, order: 0 } }, orderNo: 0 },
  };
}

function causalTasks() {
  return [
    { id: 'internal-causal', name: '内部因果选择', stage: 1, order: 1, maxRetries: 1, internalCausalRead: true,
      promptGroup: [{ role: 'user', content: '仅做内部因果选择。' }] },
    { id: 'public-task', name: '公开正文', stage: 2, order: 1, maxRetries: 1, extractTags: 'plot',
      promptGroup: [{ role: 'user', content: '仅输出公开剧情。' }] },
  ];
}

function isInternalCall(call: AiCall): boolean { return call.messages.some(message => message.content.includes('selectedFactIds')); }
function isSceneReviewCall(call: AiCall): boolean { return call.messages.some(message => message.content.includes('world-narrative-review')); }

function makeSettlement(store: ZeroLayerStore_ACU): ZeroLayerResponseSettlement_ACU {
  return async (_envelope, turnId, attemptId) => {
    let current = await store.read();
    const turn = current!.turns.find(item => item.turnId === turnId && item.attemptId === attemptId)!;
    const table = { floorId: turn.assistantFloor.floorId, tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [] };
    current = await store.commit({ type: 'record-effect', turnId, attemptId,
      receipt: { effectId: `${turnId}:${attemptId}:table`, kind: 'table', status: 'durable', fingerprint: getTableDataFingerprint_ACU(table) },
      assistantData: { table } }, current!.revision);
    current = await store.commit({ type: 'transition-turn', turnId, attemptId, phase: 'effects-durable' }, current.revision);
    await store.commit({ type: 'transition-turn', turnId, attemptId, phase: 'published' }, current.revision);
  };
}

async function buildSessionFixture(scope: string) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文只允许公开内容', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({ chat, chatId: `chat-${scope}`, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => `chat-${scope}`,
    saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  _set_currentChatFileIdentifier_ACU(`session-${scope}`);
  settings_ACU.dataIsolationEnabled = true;
  settings_ACU.dataIsolationCode = scope;
  settings_ACU.autoUpdateEnabled = false;
  const template = tableTemplate();
  const templateState = buildChatTemplateScopeStateFromCurrent_ACU({ isolationKey: scope, templateSource: JSON.stringify(template), guideData: template });
  expect(templateState).not.toBeNull();
  setCurrentChatTemplateScopeState_ACU(templateState!, { isolationKey: scope, reason: 'session-delivery-test' });

  const store = new ZeroLayerStore_ACU();
  const reviewed = vi.fn(async ({ facts, successorText }: { facts: ReadonlyArray<{ id: string; summary: string }>; successorText: string;
    apiPresetName: string; signal: AbortSignal }) => ({
    results: facts.map(item => ({ factId: item.id, adopted: true, evidenceQuotes: [successorText] })),
  }));
  const session = new ZeroLayerSession_ACU(store, makeSettlement(store));
  await session.setEnabled(true, 'causal-session-test');

  let source = await store.read();
  const parentTurnId = `parent-${scope}`;
  const parentAttemptId = `parent-attempt-${scope}`;
  source = await store.commit({ type: 'prepare-turn', turnId: parentTurnId, attemptId: parentAttemptId, input: '继续', requiredEffects: [],
    tableInput: { chatKey: `session-${scope}`, isolationKey: scope, storageMode: 'native', tableData: { mate: {} }, templateData: { mate: {} },
      completedAiFloorBySheetKey: {}, autoUpdateEnabled: false } }, source!.revision);
  source = await store.commit({ type: 'transition-turn', turnId: parentTurnId, attemptId: parentAttemptId, phase: 'dispatching' }, source.revision);
  source = await store.commit({ type: 'transition-turn', turnId: parentTurnId, attemptId: parentAttemptId, phase: 'response-durable',
    changes: { body: ANCHOR_BODY, errorCode: null } }, source.revision);

  const simulationStore = new ZeroLayerSimulationStore_ACU(store);
  await simulationStore.updateState(state => {
    state.envelope = buildDefaultWorldSimulationEnvelope_ACU();
    state.envelope.ledger.actors = [actor('actor-1')];
    state.envelope.ledger.player.location = CLOCK_SQUARE;
    state.fields = seedLedgerFieldView_ACU(state.envelope.ledger, 1);
    state.envelope.task = { taskId: `task-${scope}`, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1,
      activeRun: null, stopReason: null };
    state.envelope.activeStageId = `stage-${scope}`;
    state.envelope.stages = [{ stageId: `stage-${scope}`, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [],
          expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  });
  const anchor = simulationStore.anchorForTurn(parentTurnId);
  const identity: WorldSimulationRunIdentity_ACU = { runId: `run-${scope}`, chatIdentity: simulationStore.getChatIdentity(), triggerKind: 'assistant_completed',
    triggerConversationMessageId: null, kind: 'logical', logicalRef: anchor.logicalRef, anchorContentDigest: anchor.contentDigest,
    baseLedgerRevision: 0, taskId: `task-${scope}`, stageId: `stage-${scope}`, stageRevision: 1, deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1' };
  await simulationStore.updateState(state => { state.envelope!.task!.activeRun = identity; });
  const candidate: WorldRoundCandidate_ACU = { baseRevision: 0, candidateClock: { ...simulationStore.read()!.ledger.clock, day: 2 },
    worldEventWrites: [], actorWrites: [], factWrites: [
      { value: fact('scene-unlocked-local', SAFE_FACT, CLOCK_SQUARE, 'scene', 'unlocked'), expectedRevision: 0 },
      { value: fact('scene-locked-local', LOCKED_FACT, CLOCK_SQUARE, 'scene', 'locked'), expectedRevision: 0 },
      { value: fact('internal-unlocked-local', INTERNAL_FACT, CLOCK_SQUARE, 'internal', 'unlocked'), expectedRevision: 0 },
      { value: fact('scene-unlocked-other', OTHER_PLACE_FACT, DOCK, 'scene', 'unlocked'), expectedRevision: 0 },
    ], historyMilestoneWrites: [], actorCompletions: [{ actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 }],
    projection: { anchor: null, deliveries: [] }, completion: 'changed' };
  await commitZeroLayerSimulationRound_ACU(simulationStore, { identity, anchor, roundCandidate: candidate, completedAt: 10,
    timelineId: `timeline-${scope}`, summary: '账本结算' });

  source = await store.read();
  const parent = source!.turns.find(item => item.turnId === parentTurnId)!;
  const parentTable = { floorId: parent.assistantFloor.floorId, tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [] };
  source = await store.commit({ type: 'record-effect', turnId: parentTurnId, attemptId: parentAttemptId,
    receipt: { effectId: `${parentTurnId}:table`, kind: 'table', status: 'durable', fingerprint: getTableDataFingerprint_ACU(parentTable) },
    assistantData: { table: parentTable } }, source!.revision);
  source = await store.commit({ type: 'transition-turn', turnId: parentTurnId, attemptId: parentAttemptId, phase: 'effects-durable' }, source.revision);
  await store.commit({ type: 'transition-turn', turnId: parentTurnId, attemptId: parentAttemptId, phase: 'published' }, source.revision);

  return { session, store, chat, carrier, saveChat, reviewed, parentTurnId };
}

function bindAndClaim(session: ZeroLayerSession_ACU, invocation: Awaited<ReturnType<ZeroLayerSession_ACU['prepare']>>) {
  const messages: Array<{ role: string; content: string }> = [{ role: 'user', content: `宿主前缀\n${invocation.quietPrompt}\n宿主后缀` }];
  session.bindPrompt({ chat: messages });
  const request: Record<string, unknown> = { messages };
  session.bindSettings(request);
  const bodyText = JSON.stringify(request);
  const lease = session.claim({ bodyText, readPayload: async () => JSON.parse(bodyText), signal: new AbortController().signal } as any);
  expect(lease).not.toBeNull();
  return { lease: lease!, request };
}

let originalSettings: Record<string, unknown>;
let originalEjsTemplate: unknown;

beforeEach(() => {
  WINDOW.window = globalThis;
  originalEjsTemplate = (globalThis as any).EjsTemplate;
  (globalThis as any).EjsTemplate = { evalTemplate: vi.fn(async (text: string) => text) };
  originalSettings = structuredClone(settings_ACU);
  settings_ACU.plotSettings = { enabled: true, lastUsedPresetName: 'causal-session-test', contextTurnCount: 0,
    plotWorldbookConfig: { source: 'manual', manualSelection: [] }, plotTasks: causalTasks() };
  settings_ACU.apiPresets = [{ name: 'causal-session-test', apiMode: 'custom', tavernProfile: '', apiConfig: {
    url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key', useMainApi: false,
    sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' } }];
  settings_ACU.plotApiPreset = 'causal-session-test';
  settings_ACU.streamingEnabled = false;
  settings_ACU.plotTaskApiPresetOverridesById = {};
  mockCallAIWithResolvedPreset_ACU.mockReset();
  mockCountWorldSimulationTokens_ACU.mockReset();
  mockCountWorldSimulationTokens_ACU.mockImplementation(async (text: string) => Math.max(1, Math.ceil(String(text).length / 4)));
});

afterEach(() => {
  Object.assign(settings_ACU, originalSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
  _set_currentChatFileIdentifier_ACU('unknown_chat_init');
  delete WINDOW.window;
  if (originalEjsTemplate === undefined) delete (globalThis as any).EjsTemplate;
  else (globalThis as any).EjsTemplate = originalEjsTemplate;
});

describe('零层会话因果投递', () => {
  it('真实 session 在已保存 dispatch 后才发送，并持久化首后继而不自动认定采用', async () => {
    const fixture = await buildSessionFixture(`delivery-${crypto.randomUUID()}`);
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages: AiCall['messages']) => {
      const call = { messages: structuredClone(messages) };
      calls.push(call);
      if (isInternalCall(call)) return JSON.stringify({ selectedFactIds: ['scene-unlocked-local', 'scene-locked-local', 'internal-unlocked-local', 'scene-unlocked-other'] });
      if (isSceneReviewCall(call)) return JSON.stringify({ locationRef: CLOCK_SQUARE, contactedActorIds: ['actor-1'], evidence: [
        { kind: 'location', actorId: null, quote: '主角站在钟楼广场' }, { kind: 'contact', actorId: 'actor-1', quote: '遇到了守卫' },
      ], reviews: [] });
      return PUBLIC_PLOT;
    });

    const prepared = await fixture.session.prepare('下一步', []);
    expect(calls).toHaveLength(3);
    const { lease, request } = bindAndClaim(fixture.session, prepared);
    const savesBeforeDispatch = fixture.saveChat.mock.calls.length;
    await lease.beforeDispatch();
    const dispatched = await fixture.store.read();
    const dispatchTurn = dispatched!.turns.find(item => item.attemptId === prepared.logicalRef.attemptId)!;
    const attempted = dispatchTurn.worldDelivery!.records[0];
    expect(fixture.saveChat.mock.calls.length).toBeGreaterThan(savesBeforeDispatch);
    expect(dispatchTurn.phase).toBe('dispatching');
    expect(attempted.status).toBe('attempted');
    expect(JSON.stringify(request.messages)).toContain(SAFE_FACT);
    expect(JSON.stringify(request.messages)).not.toContain(LOCKED_FACT);
    expect(JSON.stringify(request.messages)).not.toContain(INTERNAL_FACT);
    expect(JSON.stringify(request.messages)).not.toContain(OTHER_PLACE_FACT);
    expect(() => fixture.session.claim({ bodyText: JSON.stringify(request), readPayload: async () => request } as any))
      .toThrow(/已经认领/);
    await expect(lease.beforeDispatch()).rejects.toThrow('PLOT_CAUSAL_DELIVERY_INVALID');

    await lease.commitReply(RESPONSE_BODY);
    const settled = await fixture.session.finish();
    const turn = settled.turns.find(item => item.attemptId === prepared.logicalRef.attemptId)!;
    const delivery = turn.worldDelivery!.records[0];
    expect(turn.phase).toBe('published');
    expect(turn.body).toBe(RESPONSE_BODY);
    expect(delivery.status).toBe('response-durable');
    expect(delivery.adoptedFactIds).toBeNull();
    expect(() => fixture.store.commit({ type: 'record-world-delivery-adoption', turnId: turn.turnId,
      attemptId: turn.attemptId, receipt: {} as any }, settled.revision)).toThrow(/不透明审查回执/);
    expect(delivery.source).toEqual(expect.objectContaining({ kind: 'logical', logicalRef: expect.objectContaining({ turnId: fixture.parentTurnId }) }));
    expect(delivery.successor).toEqual(expect.objectContaining({ contentDigest: sha256HexSync_ACU(RESPONSE_BODY), logicalRef: expect.objectContaining({ turnId: turn.turnId }) }));
    expect(fixture.reviewed).not.toHaveBeenCalled();
    expect(fixture.chat[0].mes).toBe('物理正文只允许公开内容');
    expect(settled.turns.find(item => item.turnId === fixture.parentTurnId)!.body).toBe(ANCHOR_BODY);
    const ledger = settled.branches.find(branch => branch.branchId === settled.activeBranchId)!.simulation!.envelope!.ledger;
    expect(ledger.facts.find(item => item.id === 'scene-locked-local')!.revealState).toBe('locked');
    expect(JSON.stringify(ledger.projection)).not.toContain(SAFE_FACT);
  });

  it('已持久化 attempted 的失败被标为 unknown；显式恢复不得重发，随后只能取消', async () => {
    const fixture = await buildSessionFixture(`unknown-${crypto.randomUUID()}`);
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages: AiCall['messages']) => {
      const call = { messages: structuredClone(messages) };
      if (isInternalCall(call)) return JSON.stringify({ selectedFactIds: ['scene-unlocked-local'] });
      if (isSceneReviewCall(call)) return JSON.stringify({ locationRef: CLOCK_SQUARE, contactedActorIds: ['actor-1'], evidence: [
        { kind: 'location', actorId: null, quote: '主角站在钟楼广场' }, { kind: 'contact', actorId: 'actor-1', quote: '遇到了守卫' },
      ], reviews: [] });
      return PUBLIC_PLOT;
    });
    const prepared = await fixture.session.prepare('下一步', []);
    const { lease } = bindAndClaim(fixture.session, prepared);
    await lease.beforeDispatch();
    await lease.fail(new Error('传输结果未知'));
    await expect(fixture.session.finish()).rejects.toMatchObject({ code: 'pending-turn' });
    const unknown = await fixture.store.read();
    const turn = unknown!.turns.find(item => item.attemptId === prepared.logicalRef.attemptId)!;
    expect(turn.phase).toBe('delivery-unknown');
    expect(turn.worldDelivery!.records[0].status).toBe('unknown');
    const callCount = mockCallAIWithResolvedPreset_ACU.mock.calls.length;
    await expect(fixture.session.recoverPrepared(turn.turnId, turn.attemptId)).rejects.toMatchObject({ code: 'invalid-transition' });
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledTimes(callCount);
    const cancelled = await fixture.session.abandonPending(turn.turnId, turn.attemptId);
    expect(cancelled.turns.find(item => item.turnId === turn.turnId)!.phase).toBe('cancelled');
  });
});
