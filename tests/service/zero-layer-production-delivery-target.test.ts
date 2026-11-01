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
vi.mock('../../src/service/agent/agent-worldbook-skill-meta', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/agent/agent-worldbook-skill-meta')>(),
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => ({ available: false, control: null })),
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { prepareZeroLayerPlot_ACU } from '../../src/service/zero-layer/plot-preparation';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';

const CLOCK_SQUARE = { region: '城区', place: '钟楼广场' };
const DOCK = { region: '港区', place: '港口仓库' };
const SAFE_SCENE = 'SAFE_SCENE_FACT_钟楼广场的守卫确认城门已经关闭。';
const GATED_LOCKED = 'GATED_LOCKED_SECRET_守卫仍未交出的密钥。';
const GATED_UNLOCKED = 'GATED_UNLOCKED_FACT_守卫已公开城门通行口令。';
const INTERNAL_SECRET = 'INTERNAL_SECRET_钟楼暗门已经打开。';
const OTHER_PLACE = 'OTHER_PLACE_SECRET_港口仓库已被封锁。';
const PUBLIC_RESULT = '<plot>普通用户任务生成的公开剧情。</plot>';
const WINDOW = globalThis as typeof globalThis & { window?: typeof globalThis };

type AiCall = { messages: Array<{ role: string; content: string }>; extras: unknown };

function actor(id: string) {
  return {
    id, name: '守卫', interests: [], location: '', locationRef: CLOCK_SQUARE, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1,
  };
}

function fact(id: string, summary: string, locationRef: typeof CLOCK_SQUARE, projectionPolicy: 'scene' | 'gated' | 'internal', revealState: 'locked' | 'unlocked') {
  return {
    id, summary, temporalKind: 'occurrence' as const, happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null,
    locationRef, actorIds: ['actor-1'], worldEventIds: [], projectionPolicy, revealState,
    // 此为账本中已持久化的结构化条件，不是测试伪造的 reveal proof。
    revealGate: projectionPolicy === 'gated' ? {
      actorIds: ['actor-1'], locationRef: CLOCK_SQUARE, notBefore: { day: 2, slot: '' }, semanticCondition: '守卫已在当前场景明确说出口令。',
    } : null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

async function buildConfirmedPreparedFixture(deliveryTarget: 'body' | 'plot') {
  const carrier: Record<string, unknown> = { is_user: false, mes: '主角站在钟楼广场，遇到了守卫。', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  // 目标偏好在真实 parent round 之前写入权威 simulation settings，供 prepare-turn 冻结。
  simulation.envelope.settings.deliveryTarget = deliveryTarget;
  simulation.envelope.ledger.actors = [actor('actor-1')];
  simulation.envelope.ledger.player.location = CLOCK_SQUARE;
  // 模拟历史已通过正式揭示流程持久化的事实；本轮 round candidate 不自行解锁 gated fact。
  simulation.envelope.ledger.facts = [fact('gated-unlocked', GATED_UNLOCKED, CLOCK_SQUARE, 'gated', 'unlocked')];
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: String(carrier.mes),
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{
      turnId: 'parent-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'parent-attempt', input: '继续',
      body: String(carrier.mes), phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'parent-user', role: 'user', data: {} },
      assistantFloor: { floorId: 'parent-floor', role: 'assistant', data: { table: {
        floorId: 'parent-floor', tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [],
      } } },
      simulationDeliveryTarget: deliveryTarget, requiredEffects: ['simulation'], effectReceipts: [], errorCode: null,
    }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  remote = structuredClone(chat);
  _set_SillyTavern_API_ACU({
    chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1',
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
  } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));

  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('parent-1');
  const identity: WorldSimulationRunIdentity_ACU = {
    runId: 'run-1', chatIdentity: store.getChatIdentity(), triggerKind: 'assistant_completed', triggerConversationMessageId: null,
    kind: 'logical', logicalRef: anchor.logicalRef, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, deliveryTarget, workflowMode: 'layered', workflowProtocol: 'world-round-v1',
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
  const roundCandidate: WorldRoundCandidate_ACU = {
    baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [
      { value: fact('scene-safe', SAFE_SCENE, CLOCK_SQUARE, 'scene', 'unlocked'), expectedRevision: 0 },
      { value: fact('gated-locked', GATED_LOCKED, CLOCK_SQUARE, 'gated', 'locked'), expectedRevision: 0 },
      { value: fact('internal-unlocked', INTERNAL_SECRET, CLOCK_SQUARE, 'internal', 'unlocked'), expectedRevision: 0 },
      { value: fact('scene-other', OTHER_PLACE, DOCK, 'scene', 'unlocked'), expectedRevision: 0 },
    ],
    historyMilestoneWrites: [], actorCompletions: [{ actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 }],
    projection: { anchor: null, deliveries: [] }, completion: 'changed',
  };
  await commitZeroLayerSimulationRound_ACU(store, { identity, anchor, roundCandidate, completedAt: 10, timelineId: 'timeline-1', summary: '真实账本结算' });

  const zeroStore = new ZeroLayerStore_ACU();
  const settled = await zeroStore.commit({ type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'effects-durable' }, store.readSource().revision);
  const published = await zeroStore.commit({ type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'published' }, settled.revision);
  const prepared = await zeroStore.commit({
    type: 'prepare-turn', turnId: 'prepared-2', attemptId: 'prepared-attempt', input: '普通用户请求：继续前进。', requiredEffects: [],
    tableInput: { chatKey: 'chat-1', isolationKey: 'production-delivery-target', storageMode: 'native', tableData: { mate: {} },
      templateData: { mate: {} }, completedAiFloorBySheetKey: {}, autoUpdateEnabled: false },
  }, published.revision);
  return { prepared, turn: prepared.turns.find(turn => turn.turnId === 'prepared-2')! };
}

function setPlotSettings(enabled: boolean) {
  settings_ACU.plotSettings = {
    enabled, lastUsedPresetName: 'production-delivery-target', contextTurnCount: 0,
    plotWorldbookConfig: { source: 'manual', manualSelection: [] },
    // 普通推进任务直接接收格林资料，不要求内部选择任务。
    plotTasks: [{ id: 'ordinary-user-task', name: '普通用户任务', stage: 1, order: 1, maxRetries: 1, extractTags: 'plot',
      promptGroup: [{ role: 'user', content: '只输出公开剧情。' }] }],
  } as any;
}

function isAutomaticCausalCall(call: AiCall) { return call.messages.some(message => message.content.includes('selectedFactIds')); }
function isSceneReviewCall(call: AiCall) { return call.messages.some(message => message.content.includes('world-narrative-review')); }
function sceneReviewResponse() {
  return JSON.stringify({ locationRef: CLOCK_SQUARE, contactedActorIds: ['actor-1'], evidence: [
    { kind: 'location', actorId: null, quote: '主角站在钟楼广场' },
    { kind: 'contact', actorId: 'actor-1', quote: '遇到了守卫' },
  ], reviews: [] });
}

let originalSettings: Pick<typeof settings_ACU, 'plotSettings' | 'apiPresets' | 'plotApiPreset' | 'streamingEnabled' | 'plotTaskApiPresetOverridesById'>;
let originalEjsTemplate: unknown;

beforeEach(() => {
  WINDOW.window = globalThis;
  originalEjsTemplate = (globalThis as any).EjsTemplate;
  (globalThis as any).EjsTemplate = { evalTemplate: vi.fn(async (text: string) => text) };
  originalSettings = structuredClone({
    plotSettings: settings_ACU.plotSettings, apiPresets: settings_ACU.apiPresets, plotApiPreset: settings_ACU.plotApiPreset,
    streamingEnabled: settings_ACU.streamingEnabled, plotTaskApiPresetOverridesById: settings_ACU.plotTaskApiPresetOverridesById,
  });
  setPlotSettings(true);
  settings_ACU.apiPresets = [{ name: 'production-delivery-target', apiMode: 'custom', tavernProfile: '',
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key', useMainApi: false,
      sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' } }];
  settings_ACU.plotApiPreset = 'production-delivery-target';
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
  delete WINDOW.window;
  if (originalEjsTemplate === undefined) delete (globalThis as any).EjsTemplate;
  else (globalThis as any).EjsTemplate = originalEjsTemplate;
});

describe('零层正式 body / plot 投送目标', () => {
  it('plot 默认任务直接读取完整幕后资料，由任务输出供正文使用，不自动选择或过滤', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture('plot');
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isAutomaticCausalCall(call)) return JSON.stringify({ selectedFactIds: ['scene-safe', 'gated-locked', 'gated-unlocked', 'internal-unlocked', 'scene-other'] });
      if (isSceneReviewCall(call)) return sceneReviewResponse();
      return PUBLIC_RESULT;
    });

    expect(turn.simulationDeliveryTarget).toBe('plot');
    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);

    expect(calls).toHaveLength(1);
    expect(calls.filter(isAutomaticCausalCall)).toHaveLength(0);
    expect(calls.filter(isSceneReviewCall)).toHaveLength(0);
    const planningInput = calls[0];
    for (const fact of [SAFE_SCENE, GATED_UNLOCKED, GATED_LOCKED, INTERNAL_SECRET, OTHER_PLACE]) {
      expect(JSON.stringify(planningInput.messages)).toContain(fact);
      expect(candidate.finalMessage).not.toContain(fact);
    }
    expect(planningInput.extras).not.toHaveProperty('suppressPayloadLogging');
    expect(candidate.finalMessage).toContain(PUBLIC_RESULT);
    expect(candidate.causalDelivery).toBeUndefined();
  });

  it('body 目标在 plot disabled 时仍仅通过安全 bridge 选择事实，绝不调用用户剧情任务', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture('body');
    setPlotSettings(false);
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isAutomaticCausalCall(call)) return JSON.stringify({ selectedFactIds: ['scene-safe', 'gated-unlocked'] });
      if (isSceneReviewCall(call)) return sceneReviewResponse();
      throw new Error('plot disabled 时不得调用普通用户剧情任务');
    });

    expect(turn.simulationDeliveryTarget).toBe('body');
    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);

    expect(calls).toHaveLength(2);
    expect(calls.filter(isAutomaticCausalCall)).toHaveLength(1);
    expect(calls.filter(isSceneReviewCall)).toHaveLength(1);
    expect(calls.some(call => call.messages.some(message => message.content === '只输出公开剧情。'))).toBe(false);
    expect(candidate.finalMessage).toContain(SAFE_SCENE);
    expect(candidate.finalMessage).toContain(GATED_UNLOCKED);
    expect(candidate.finalMessage).not.toContain(GATED_LOCKED);
    expect(candidate.content).toContain(SAFE_SCENE);
  });

  it('plot 任务能理解尚未揭露的事实，但读取不会改账本或原样追加到正文', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture('plot');
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      const call = { messages, extras: null };
      if (isAutomaticCausalCall(call)) return JSON.stringify({ selectedFactIds: ['gated-locked', 'gated-unlocked'] });
      if (isSceneReviewCall(call)) return sceneReviewResponse();
      return PUBLIC_RESULT;
    });

    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);

    expect(candidate.causalDelivery).toBeUndefined();
    expect(candidate.finalMessage).toContain(PUBLIC_RESULT);
    expect(candidate.finalMessage).not.toContain(GATED_UNLOCKED);
    expect(candidate.finalMessage).not.toContain(GATED_LOCKED);
    expect(JSON.stringify(candidate)).not.toContain(GATED_LOCKED);
    const planningMessages = mockCallAIWithResolvedPreset_ACU.mock.calls[0][0];
    expect(JSON.stringify(planningMessages)).toContain(GATED_LOCKED);
    expect(prepared.branches[0].simulation!.envelope!.ledger.facts.find(fact => fact.id === 'gated-locked')!.revealState).toBe('locked');
  });

  it('plot disabled 对冻结 plot 目标不自启既有 plot；之后偏好变化也不改已冻结 target', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture('plot');
    setPlotSettings(false);
    // 运行后的当前设置即使改为 body，prepared turn 的投送目标也不得追随修改。
    prepared.branches[0].simulation!.envelope!.settings.deliveryTarget = 'body';
    mockCallAIWithResolvedPreset_ACU.mockRejectedValue(new Error('冻结 plot 且 disabled 时不应调用模型'));

    expect(turn.simulationDeliveryTarget).toBe('plot');
    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);

    expect(mockCallAIWithResolvedPreset_ACU).not.toHaveBeenCalled();
    expect(candidate).toMatchObject({ outcome: 'disabled', finalMessage: null, content: '', taskContents: {} });
    expect(turn.simulationDeliveryTarget).toBe('plot');
  });
});
