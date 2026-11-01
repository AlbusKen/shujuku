import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallAIWithResolvedPreset_ACU } = vi.hoisted(() => ({
  mockCallAIWithResolvedPreset_ACU: vi.fn(),
}));

vi.mock('../../src/service/ai/api-call', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/ai/api-call')>(),
  callAIWithResolvedPreset_ACU: mockCallAIWithResolvedPreset_ACU,
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { PLOT_SIMULATION_SCENE_TOKEN_ACU } from '../../src/service/runtime/plot-runtime/plot-simulation-scene';
import { runPlotTasksRuntime_ACU } from '../../src/service/runtime/plot-runtime/plot-task-engine';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { prepareZeroLayerPlot_ACU } from '../../src/service/zero-layer/plot-preparation';
import { readPreparedSimulationCausalView_ACU } from '../../src/service/zero-layer/prepared-simulation-causal-view';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU, _set_TavernHelper_API_ACU } from '../../src/shared/host-api';

const PUBLIC_SUMMARY = '公开场景摘要：钟楼已经敲响。';
const GATED_SECRET = '门控锁定秘密：守卫携带密钥。';
const INTERNAL_SECRET = '内部锁定秘密：密道已经封闭。';
const KNOWN_FACTS_METADATA = 'ACTOR_KNOWN_FACTS_METADATA_SECRET';
const MODEL_REPLY = '<plot>模型生成的候选剧情</plot>';
const WINDOW = globalThis as typeof globalThis & { window?: typeof globalThis };

function actor(id: string) {
  return {
    id, name: '守卫', interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: [KNOWN_FACTS_METADATA], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1,
  };
}

function sceneFact(
  id: string, summary: string, projectionPolicy: 'scene' | 'gated' | 'internal', revealState: 'locked' | 'unlocked',
) {
  return {
    id, summary, temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null,
    locationRef: { region: '城区', place: '钟楼广场' }, actorIds: ['actor-1'],
    worldEventIds: [], projectionPolicy, revealState, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

async function buildPreparedSource(publicSummary = PUBLIC_SUMMARY) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
  const transportMessages: Array<Array<{ role: string; content: string }>> = [];
  const ejsInputs: unknown[] = [];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulation.envelope.ledger.actors = [actor('actor-1')];
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{
      turnId: 'parent-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'parent-attempt', input: '继续',
      body: '已发布逻辑正文', phase: 'response-durable', createdAt: 1, updatedAt: 1,
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
    getTokenCountAsync: vi.fn(async (text: string) => Math.ceil(text.length / 1.5)),
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
  } as any);
  _set_TavernHelper_API_ACU({
    getCharWorldbookNames: vi.fn(async () => ({ primary: null, additional: [] })),
  } as any);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/chats/')) {
      return new Response(JSON.stringify([{}, ...structuredClone(remote)]), { status: 200 });
    }
    if (url.startsWith('http://127.0.0.1:43111/')) {
      const body = JSON.parse(String(init?.body || '{}'));
      transportMessages.push(body.messages);
      return new Response(JSON.stringify({ choices: [{ message: { content: MODEL_REPLY } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`测试不允许访问外网：${url}`);
  }));
  (globalThis as any).EjsTemplate = {
    evalTemplate: vi.fn(async (text: string, context: unknown) => {
      ejsInputs.push(structuredClone(context));
      return text;
    }),
  };

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
  const facts = [
    sceneFact('scene-public', publicSummary, 'scene', 'unlocked'),
    sceneFact('gated-locked', GATED_SECRET, 'gated', 'locked'),
    sceneFact('internal-locked', INTERNAL_SECRET, 'internal', 'locked'),
  ];
  const roundCandidate: WorldRoundCandidate_ACU = {
    baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: facts.map(value => ({ value, expectedRevision: 0 })), historyMilestoneWrites: [],
    actorCompletions: [{ actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 }],
    projection: { anchor: null, deliveries: [] }, completion: 'changed',
  };
  await commitZeroLayerSimulationRound_ACU(store, {
    identity, anchor, roundCandidate, completedAt: 10, timelineId: 'timeline-1', summary: '账本结算',
  });

  const zeroStore = new ZeroLayerStore_ACU();
  const settled = await zeroStore.commit({
    type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'effects-durable',
  }, store.readSource().revision);
  const published = await zeroStore.commit({
    type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'published',
  }, settled.revision);
  const prepared = await zeroStore.commit({
    type: 'prepare-turn', turnId: 'prepared-2', attemptId: 'prepared-attempt', input: '下一步', requiredEffects: [],
    tableInput: {
      chatKey: 'chat-1', isolationKey: 'scene-facts-test', storageMode: 'native', tableData: { mate: {} },
      templateData: { mate: {} }, completedAiFloorBySheetKey: {}, autoUpdateEnabled: false,
    },
  }, published.revision);
  return { prepared, transportMessages, ejsInputs };
}

function tokenTask() {
  return {
    id: 'task-1', name: '场景事实任务', enabled: true, stage: 1, order: 1, maxRetries: 1, extractTags: 'plot',
    promptGroup: [
      { role: 'system', content: `系统提示词：${PLOT_SIMULATION_SCENE_TOKEN_ACU}` },
      { role: 'user', content: `用户提示词：${PLOT_SIMULATION_SCENE_TOKEN_ACU}` },
    ],
  };
}

function noTokenTask() {
  return {
    id: 'task-no-token', name: '旧任务', enabled: true, stage: 1, order: 1, maxRetries: 1, extractTags: 'plot',
    promptGroup: [{ role: 'user', content: '只发送普通旧提示词' }],
  };
}

function plotSettings(tasks: unknown[]) {
  return {
    enabled: true, lastUsedPresetName: 'scene-test', plotWorldbookConfig: { source: 'manual', manualSelection: [] },
    plotTasks: tasks,
  };
}

let originalSettings: Pick<typeof settings_ACU, 'plotSettings' | 'apiPresets' | 'plotApiPreset' | 'streamingEnabled' | 'plotTaskApiPresetOverridesById'>;
let originalEjsTemplate: unknown;

beforeEach(() => {
  WINDOW.window = globalThis;
  _set_TavernHelper_API_ACU({
    getCharWorldbookNames: vi.fn(async () => ({ primary: null, additional: [] })),
  } as any);
  originalSettings = structuredClone({
    plotSettings: settings_ACU.plotSettings, apiPresets: settings_ACU.apiPresets, plotApiPreset: settings_ACU.plotApiPreset,
    streamingEnabled: settings_ACU.streamingEnabled, plotTaskApiPresetOverridesById: settings_ACU.plotTaskApiPresetOverridesById,
  });
  originalEjsTemplate = (globalThis as any).EjsTemplate;
  settings_ACU.plotSettings = plotSettings([tokenTask()]);
  settings_ACU.apiPresets = [{
    name: 'scene-test', apiMode: 'custom', tavernProfile: '',
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key',
      useMainApi: false, sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' },
  }];
  settings_ACU.plotApiPreset = 'scene-test';
  settings_ACU.streamingEnabled = false;
  settings_ACU.plotTaskApiPresetOverridesById = {};
  mockCallAIWithResolvedPreset_ACU.mockReset();
  mockCallAIWithResolvedPreset_ACU.mockResolvedValue(JSON.stringify({ selectedFactIds: [] }));
});

afterEach(() => {
  Object.assign(settings_ACU, originalSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
  _set_TavernHelper_API_ACU(undefined);
  delete WINDOW.window;
  if (originalEjsTemplate === undefined) delete (globalThis as any).EjsTemplate;
  else (globalThis as any).EjsTemplate = originalEjsTemplate;
});

describe('零层剧情推演场景事实注入', () => {
  it('真实准备缺少可信场景时仍显式拒绝；此前自动私有选择可合法返回空 IDs，显式隔离时空下真实引擎仅发送解锁 scene 摘要', async () => {
    const { prepared, transportMessages, ejsInputs } = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    const before = structuredClone(prepared);
    const causalView = readPreparedSimulationCausalView_ACU(prepared, turn.turnId, turn.attemptId)!;
    expect(causalView.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scene-public', summary: PUBLIC_SUMMARY, revealState: 'unlocked' }),
      expect.objectContaining({ id: 'gated-locked', summary: GATED_SECRET, revealState: 'locked' }),
      expect.objectContaining({ id: 'internal-locked', summary: INTERNAL_SECRET, revealState: 'locked' }),
    ]));

    await expect(prepareZeroLayerPlot_ACU(
      turn, [{ is_user: true, mes: '历史正文' }], new AbortController().signal, vi.fn(), prepared,
    )).rejects.toThrow('剧情场景上下文无效');
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledOnce();
    const automaticPrivateCall = mockCallAIWithResolvedPreset_ACU.mock.calls[0];
    expect(automaticPrivateCall[4]).toMatchObject({
      streaming: false, requireDirectTransport: true, suppressPayloadLogging: true,
    });
    expect(transportMessages).toHaveLength(0);
    const transport = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      transportMessages.push(structuredClone(messages));
      return MODEL_REPLY;
    });
    const result = await runPlotTasksRuntime_ACU(plotSettings([tokenTask()]), turn.input, {
      requestContext: {
        history: [], tableData: { mate: {} }, presetName: 'scene-test', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        simulationScene: { time: { day: 2, slot: '' }, location: { region: '城区', place: '钟楼广场' } },
        readSimulationCausalView: () => structuredClone(causalView), resolveTaskApiPreset: () => 'scene-test', callApi: transport,
      },
    });

    expect(transportMessages).toHaveLength(1);
    expect(transportMessages[0]).toHaveLength(2);
    for (const message of transportMessages[0]) {
      expect(message.content).toContain(PUBLIC_SUMMARY);
      expect(message.content).not.toContain(PLOT_SIMULATION_SCENE_TOKEN_ACU);
      expect(message.content).not.toContain(GATED_SECRET);
      expect(message.content).not.toContain(INTERNAL_SECRET);
      expect(message.content).not.toContain(KNOWN_FACTS_METADATA);
      expect(message.content).not.toContain('knownFacts');
      expect(message.content).not.toContain('worldEvents');
    }
    expect(transportMessages[0].map(message => message.role)).toEqual(['system', 'user']);
    expect(ejsInputs.length).toBeGreaterThan(0);
    for (const context of ejsInputs) {
      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain(PUBLIC_SUMMARY);
      expect(serialized).not.toContain(GATED_SECRET);
      expect(serialized).not.toContain(INTERNAL_SECRET);
      expect(serialized).not.toContain(KNOWN_FACTS_METADATA);
      expect(serialized).not.toContain('simulationCausalView');
      expect(serialized).not.toContain('knownFacts');
    }

    expect(result.failedResults).toEqual([]);
    expect(result.saveContent).toBe(MODEL_REPLY);
    expect(result.successfulResults[0].rawResponse).toBe(MODEL_REPLY);
    expect(result.finalMessage).toContain(MODEL_REPLY);
    const candidateText = JSON.stringify(result);
    expect(candidateText).not.toContain(PUBLIC_SUMMARY);
    expect(candidateText).not.toContain(PLOT_SIMULATION_SCENE_TOKEN_ACU);
    expect(candidateText).not.toContain(GATED_SECRET);
    expect(candidateText).not.toContain(INTERNAL_SECRET);
    expect(candidateText).not.toContain(KNOWN_FACTS_METADATA);
    expect(prepared.branches[0].simulation!.envelope!.ledger).toEqual(before.branches[0].simulation!.envelope!.ledger);
    expect(prepared.branches[0].simulation!.envelope!.ledger.actors[0].knownFacts).toEqual([KNOWN_FACTS_METADATA]);
    expect(prepared.branches[0].simulation!.envelope!.ledger.facts.map(fact => fact.revealState)).toEqual(['unlocked', 'locked', 'locked']);
    expect(prepared.turns[0].body).toBe('已发布逻辑正文');
  });

  it('没有 token 时维持旧提示词，并且引擎不读取因果 reader', async () => {
    const readSimulationCausalView = vi.fn(() => {
      throw new Error('不应读取因果视图');
    });
    const callApi = vi.fn(async () => MODEL_REPLY);
    const result = await runPlotTasksRuntime_ACU(plotSettings([noTokenTask()]), '当前输入', {
      requestContext: {
        history: [], tableData: { mate: {} }, presetName: 'scene-test', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(), readSimulationCausalView,
        resolveTaskApiPreset: () => 'scene-test', callApi,
      },
    });

    expect(readSimulationCausalView).not.toHaveBeenCalled();
    expect(callApi).toHaveBeenCalledWith([{ role: 'user', content: '只发送普通旧提示词' }], 'scene-test');
    expect(result.successfulResults).toHaveLength(1);
  });

  it('显式 token 缺少 prepared baseline 时拒绝，且不发送传输请求', async () => {
    const { prepared, transportMessages } = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;

    await expect(prepareZeroLayerPlot_ACU(
      turn, [], new AbortController().signal, vi.fn(), undefined,
    )).rejects.toThrow();
    expect(transportMessages).toHaveLength(0);
  });

  it('显式 token 没有可用 reader 时由真实引擎拒绝，不能降级为未注入请求', async () => {
    const callApi = vi.fn(async () => MODEL_REPLY);
    await expect(runPlotTasksRuntime_ACU(plotSettings([tokenTask()]), '当前输入', {
      requestContext: {
        history: [], tableData: { mate: {} }, presetName: 'scene-test', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        resolveTaskApiPreset: () => 'scene-test', callApi,
      },
    })).rejects.toThrow();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('场景事实超过 4096 token 预算时在传输前拒绝', async () => {
    const tooLargeSummary = '公开场景摘要'.repeat(7000);
    const { prepared, transportMessages } = await buildPreparedSource(tooLargeSummary);
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;

    const view = readPreparedSimulationCausalView_ACU(prepared, turn.turnId, turn.attemptId)!;
    const callApi = vi.fn();
    await expect(runPlotTasksRuntime_ACU(plotSettings([tokenTask()]), turn.input, {
      requestContext: {
        history: [], tableData: { mate: {} }, presetName: 'scene-test', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        simulationScene: { time: { day: 2, slot: '' }, location: { region: '城区', place: '钟楼广场' } },
        readSimulationCausalView: () => structuredClone(view), resolveTaskApiPreset: () => 'scene-test', callApi,
      },
    })).rejects.toThrow(/令牌预算/);
    expect(callApi).not.toHaveBeenCalled();
    expect(transportMessages).toHaveLength(0);
  });
});
