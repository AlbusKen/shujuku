import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// 世界书发现不属于因果桥验收边界；禁止其读取宿主状态干扰冻结请求。
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

const ANCHOR_BODY = '主角站在钟楼广场，遇到了守卫。';
const SAFE_SCENE_FACT = '钟楼广场的守卫确认城门已经关闭。';
const LOCKED_SCENE_FACT = 'LOCKED_SCENE_SECRET_钟楼守卫携带密钥。';
const INTERNAL_SCENE_FACT = 'INTERNAL_FACT_SECRET_钟楼的暗门已经打开。';
const OTHER_PLACE_FACT = 'OTHER_PLACE_FACT_SECRET_港口仓库已被封锁。';
const PUBLIC_RESULT = '<plot>公开剧情继续推进。</plot>';
const CLOCK_SQUARE = { region: '城区', place: '钟楼广场' };
const DOCK = { region: '港区', place: '港口仓库' };
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

function fact(
  id: string, summary: string, locationRef: typeof CLOCK_SQUARE,
  projectionPolicy: 'scene' | 'internal', revealState: 'locked' | 'unlocked',
) {
  return {
    id, summary, temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef, actorIds: ['actor-1'],
    worldEventIds: [], projectionPolicy, revealState, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

async function buildConfirmedPreparedFixture() {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文只允许公开内容', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulation.envelope.ledger.actors = [actor('actor-1')];
  simulation.envelope.ledger.player.location = CLOCK_SQUARE;
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文只允许公开内容',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{
      turnId: 'parent-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'parent-attempt', input: '继续',
      body: ANCHOR_BODY, phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'parent-user', role: 'user', data: {} },
      assistantFloor: { floorId: 'parent-floor', role: 'assistant', data: { table: {
        floorId: 'parent-floor', tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [],
      } } },
      simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [], errorCode: null,
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
    runId: 'run-1', chatIdentity: store.getChatIdentity(), triggerKind: 'assistant_completed',
    triggerConversationMessageId: null, kind: 'logical', logicalRef: anchor.logicalRef,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task-1', stageId: 'stage-1',
    stageRevision: 1, deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1',
  };
  await store.updateState(state => {
    state.envelope!.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1,
      updatedAt: 1, activeRun: identity, stopReason: null };
    state.envelope!.activeStageId = identity.stageId;
    state.envelope!.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [],
          completedSteps: [], nextStep: '' } }] }];
  });
  const roundCandidate: WorldRoundCandidate_ACU = {
    baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [
      { value: fact('scene-unlocked-local', SAFE_SCENE_FACT, CLOCK_SQUARE, 'scene', 'unlocked'), expectedRevision: 0 },
      { value: fact('scene-locked-local', LOCKED_SCENE_FACT, CLOCK_SQUARE, 'scene', 'locked'), expectedRevision: 0 },
      { value: fact('internal-unlocked-local', INTERNAL_SCENE_FACT, CLOCK_SQUARE, 'internal', 'unlocked'), expectedRevision: 0 },
      { value: fact('scene-unlocked-other', OTHER_PLACE_FACT, DOCK, 'scene', 'unlocked'), expectedRevision: 0 },
    ],
    historyMilestoneWrites: [], actorCompletions: [{ actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 }],
    projection: { anchor: null, deliveries: [] }, completion: 'changed',
  };
  await commitZeroLayerSimulationRound_ACU(store, {
    identity, anchor, roundCandidate, completedAt: 10, timelineId: 'timeline-1', summary: '账本结算',
  });

  const zeroStore = new ZeroLayerStore_ACU();
  const settled = await zeroStore.commit({ type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'effects-durable' }, store.readSource().revision);
  const published = await zeroStore.commit({ type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'published' }, settled.revision);
  const prepared = await zeroStore.commit({
    type: 'prepare-turn', turnId: 'prepared-2', attemptId: 'prepared-attempt', input: '下一步', requiredEffects: [],
    tableInput: { chatKey: 'chat-1', isolationKey: 'causal-bridge-test', storageMode: 'native', tableData: { mate: {} },
      templateData: { mate: {} }, completedAiFloorBySheetKey: {}, autoUpdateEnabled: false },
  }, published.revision);
  return { prepared, turn: prepared.turns.find(item => item.turnId === 'prepared-2')! };
}

function setTasks(tasks: unknown[]) {
  settings_ACU.plotSettings = {
    enabled: true, lastUsedPresetName: 'causal-bridge-test', contextTurnCount: 0,
    plotWorldbookConfig: { source: 'manual', manualSelection: [] }, plotTasks: tasks,
  } as any;
}

function causalTasks() {
  return [
    { id: 'internal-causal', name: '内部因果选择', stage: 1, order: 1, maxRetries: 1, internalCausalRead: true,
      promptGroup: [{ role: 'user', content: '仅做内部因果选择。' }] },
    { id: 'public-task', name: '公开正文', stage: 2, order: 1, maxRetries: 1, extractTags: 'plot',
      promptGroup: [{ role: 'user', content: '仅输出公开剧情。' }] },
  ];
}

function allFactIds() {
  return ['scene-unlocked-local', 'scene-locked-local', 'internal-unlocked-local', 'scene-unlocked-other'];
}

function isInternalCausalCall(call: AiCall): boolean {
  return call.messages.some(message => message.content.includes('selectedFactIds'));
}

function isSceneReviewCall(call: AiCall): boolean {
  return call.messages.some(message => message.content.includes('world-narrative-review'));
}

function sceneReviewResponse(location: typeof CLOCK_SQUARE | null) {
  return JSON.stringify(location === null
    ? { locationRef: null, contactedActorIds: [], evidence: [], reviews: [] }
    : {
      locationRef: location,
      contactedActorIds: ['actor-1'],
      evidence: [
        { kind: 'location', actorId: null, quote: '主角站在钟楼广场' },
        { kind: 'contact', actorId: 'actor-1', quote: '遇到了守卫' },
      ],
      reviews: [],
    });
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
  setTasks(causalTasks());
  settings_ACU.apiPresets = [{
    name: 'causal-bridge-test', apiMode: 'custom', tavernProfile: '',
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key',
      useMainApi: false, sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' },
  }];
  settings_ACU.plotApiPreset = 'causal-bridge-test';
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

describe('零层剧情内部因果到公开安全桥', () => {
  it('真实 carrier 提交、发布和 prepare 仅将选择的同地解锁 scene 事实写入安全块，并保存不含秘密的可核验 manifest', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isInternalCausalCall(call)) return JSON.stringify({ selectedFactIds: allFactIds() });
      if (isSceneReviewCall(call)) return sceneReviewResponse(CLOCK_SQUARE);
      return PUBLIC_RESULT;
    });

    const candidate = await prepareZeroLayerPlot_ACU(turn, [{ is_user: false, mes: '公开历史' }], new AbortController().signal, vi.fn(), prepared);
    const serialised = JSON.stringify(candidate);
    const bridge = (candidate as any).causalDelivery;

    expect(calls).toHaveLength(3);
    expect(calls.filter(isInternalCausalCall)).toHaveLength(1);
    expect(calls.filter(isSceneReviewCall)).toHaveLength(1);
    expect(calls.find(isSceneReviewCall)!.messages.map(message => message.content).join('\n')).toContain(ANCHOR_BODY);
    expect(candidate.finalMessage).toContain(PUBLIC_RESULT);
    expect(candidate.finalMessage).toContain(SAFE_SCENE_FACT);
    expect(candidate.finalMessage).not.toContain(LOCKED_SCENE_FACT);
    expect(candidate.finalMessage).not.toContain(INTERNAL_SCENE_FACT);
    expect(candidate.finalMessage).not.toContain(OTHER_PLACE_FACT);
    expect(serialised).not.toContain(LOCKED_SCENE_FACT);
    expect(serialised).not.toContain(INTERNAL_SCENE_FACT);
    expect(serialised).not.toContain(OTHER_PLACE_FACT);
    expect(serialised).not.toContain('selectedFactIds');
    expect(bridge).toEqual(expect.objectContaining({
      schemaVersion: 1, factIds: ['scene-unlocked-local'], sceneLocation: CLOCK_SQUARE,
      time: { day: 2, slot: '' }, ledgerRevision: expect.any(Number), ledgerFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      marker: expect.stringMatching(/^\[\[ACU_PLOT_CAUSAL_FACTS:[a-f0-9-]{36}\]\]$/),
      messageFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceAnchor: expect.any(Object), targetAnchor: expect.any(Object),
    }));
    expect(Object.keys(bridge).sort()).toEqual([
      'factIds', 'ledgerFingerprint', 'ledgerRevision', 'marker', 'messageFingerprint', 'sceneLocation', 'schemaVersion',
      'sourceAnchor', 'targetAnchor', 'time',
    ]);
    expect(candidate.finalMessage!.split(bridge.marker)).toHaveLength(2);
    expect(JSON.stringify(bridge)).not.toContain(LOCKED_SCENE_FACT);
    expect(JSON.stringify(bridge)).not.toContain(INTERNAL_SCENE_FACT);
    expect(JSON.stringify(bridge)).not.toContain(OTHER_PLACE_FACT);
  });

  it('场景审查为 null 时不注入任何安全事实块，也不伪造地点 manifest', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      const call = { messages, extras: null };
      if (isInternalCausalCall(call)) return JSON.stringify({ selectedFactIds: ['scene-unlocked-local'] });
      if (isSceneReviewCall(call)) return sceneReviewResponse(null);
      return PUBLIC_RESULT;
    });

    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledTimes(3);
    expect(candidate.finalMessage).toContain(PUBLIC_RESULT);
    expect(candidate.finalMessage).not.toContain(SAFE_SCENE_FACT);
    expect((candidate as any).causalDelivery).toBeUndefined();
  });

  it('scope cancel 后不运行场景审查或公开阶段，因而不产生 bridge', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    const controller = new AbortController();
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isInternalCausalCall(call)) {
        controller.abort();
        return JSON.stringify({ selectedFactIds: ['scene-unlocked-local'] });
      }
      throw new Error('取消后不应调用场景审查或公开任务');
    });

    await expect(prepareZeroLayerPlot_ACU(turn, [], controller.signal, vi.fn(), prepared)).rejects.toMatchObject({ code: 'scope-changed' });
    expect(calls).toHaveLength(1);
    expect(calls.some(isSceneReviewCall)).toBe(false);
  });

  it('后续公开 stage 失败时不会审查场景或生成 bridge', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isInternalCausalCall(call)) return JSON.stringify({ selectedFactIds: ['scene-unlocked-local'] });
      if (isSceneReviewCall(call)) throw new Error('任务失败前不应审查场景');
      return '没有闭合 plot 标签的失败正文';
    });

    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared))
      .rejects.toThrow('剧情任务未全部完成');
    expect(calls).toHaveLength(2);
    expect(calls.some(isSceneReviewCall)).toBe(false);
  });

  it('内部任务返回任意非严格 JSON 文本时拒绝，且不会泄漏原始回复、调用场景审查或公开阶段', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    const calls: AiCall[] = [];
    const rawInternalText = 'INTERNAL_RAW_TEXT_MUST_NOT_ESCAPE';
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isInternalCausalCall(call)) return rawInternalText;
      throw new Error('内部响应无效后不应继续调用其他模型');
    });

    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared))
      .rejects.toThrow('剧情任务未全部完成');
    expect(calls).toHaveLength(1);
    expect(calls.some(isSceneReviewCall)).toBe(false);
    expect(JSON.stringify(calls.filter(call => !isInternalCausalCall(call)))).not.toContain(rawInternalText);
  });

  it('默认自动选择仅经私有通道，普通公开模型不接收冻结秘密', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    setTasks([{ id: 'legacy-public', name: '旧公开任务', stage: 1, order: 1, maxRetries: 1, extractTags: 'plot',
      promptGroup: [{ role: 'user', content: '旧公开提示词。' }] }]);
    const calls: AiCall[] = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, _resolved, _signal, _lifecycle, extras) => {
      const call = { messages: structuredClone(messages), extras: structuredClone(extras) };
      calls.push(call);
      if (isInternalCausalCall(call)) return JSON.stringify({ selectedFactIds: [] });
      return PUBLIC_RESULT;
    });

    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    expect(calls).toHaveLength(2);
    const automaticPrivateCall = calls.find(isInternalCausalCall)!;
    const publicCall = calls.find(call => !isInternalCausalCall(call))!;
    expect(automaticPrivateCall.extras).toMatchObject({
      streaming: false, requireDirectTransport: true, suppressPayloadLogging: true,
    });
    expect(JSON.stringify(automaticPrivateCall.messages)).toContain(INTERNAL_SCENE_FACT);
    expect(JSON.stringify(publicCall.messages)).not.toContain(LOCKED_SCENE_FACT);
    expect(JSON.stringify(publicCall.messages)).not.toContain(INTERNAL_SCENE_FACT);
    expect(JSON.stringify(publicCall.messages)).not.toContain(OTHER_PLACE_FACT);
    expect(calls.some(isSceneReviewCall)).toBe(false);
    expect(candidate.finalMessage).toContain(PUBLIC_RESULT);
    expect((candidate as any).causalDelivery).toBeUndefined();
  });
});
