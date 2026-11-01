import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));

const { mockRunPlotTasksRuntime, mockCallAIWithResolvedPreset_ACU, observeContext } = vi.hoisted(() => ({
  mockRunPlotTasksRuntime: vi.fn(),
  mockCallAIWithResolvedPreset_ACU: vi.fn(),
  observeContext: { current: null as any },
}));

vi.mock('../../src/service/ai/api-call', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/ai/api-call')>(),
  callAIWithResolvedPreset_ACU: mockCallAIWithResolvedPreset_ACU,
}));

vi.mock('../../src/service/runtime/plot-runtime/plot-task-engine', () => ({
  runPlotTasksRuntime_ACU: mockRunPlotTasksRuntime,
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
import { readPreparedSimulationCausalView_ACU } from '../../src/service/zero-layer/prepared-simulation-causal-view';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';

function actor(id: string) {
  return {
    id, name: '守卫', interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: ['locked-fact'], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1,
  };
}

async function buildPreparedSource() {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
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
  const fact = {
    id: 'locked-fact', summary: '守卫更换巡逻路线', temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds: ['actor-1'],
    worldEventIds: [], projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
  const roundCandidate: WorldRoundCandidate_ACU = {
    baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 }, worldEventWrites: [], actorWrites: [],
    factWrites: [{ value: fact, expectedRevision: 0 }], historyMilestoneWrites: [],
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
  return zeroStore.commit({
    type: 'prepare-turn', turnId: 'prepared-2', attemptId: 'prepared-attempt', input: '下一步', requiredEffects: [],
    tableInput: {
      chatKey: 'chat-1', isolationKey: 'causal-test', storageMode: 'native', tableData: { mate: {} },
      templateData: { mate: {} }, completedAiFloorBySheetKey: {}, autoUpdateEnabled: false,
    },
  }, published.revision);
}

function runtimeResult() {
  return {
    successfulResults: [{ taskId: 'task-1', rawResponse: '普通任务结果' }], failedResults: [],
    finalMessage: '普通最终剧情', saveContent: '普通保存剧情', agentActive: false,
  } as any;
}

let originalSettings: Pick<typeof settings_ACU, 'plotSettings' | 'apiPresets' | 'plotApiPreset' | 'streamingEnabled' | 'plotTaskApiPresetOverridesById'>;

beforeEach(() => {
  originalSettings = structuredClone({
    plotSettings: settings_ACU.plotSettings, apiPresets: settings_ACU.apiPresets, plotApiPreset: settings_ACU.plotApiPreset,
    streamingEnabled: settings_ACU.streamingEnabled, plotTaskApiPresetOverridesById: settings_ACU.plotTaskApiPresetOverridesById,
  });
  settings_ACU.plotSettings = {
    enabled: true, lastUsedPresetName: 'causal-test',
    tasks: [{ id: 'task-1', name: '最小任务', stage: 1, order: 1, maxRetries: 1,
      promptGroup: [{ role: 'user', content: '只发送普通任务提示词' }] }],
  };
  settings_ACU.apiPresets = [{
    name: 'causal-test', apiMode: 'custom', tavernProfile: '',
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key',
      useMainApi: false, sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' },
  }];
  settings_ACU.plotApiPreset = 'causal-test';
  settings_ACU.streamingEnabled = false;
  settings_ACU.plotTaskApiPresetOverridesById = {};
  observeContext.current = null;
  mockRunPlotTasksRuntime.mockReset();
  mockCallAIWithResolvedPreset_ACU.mockReset();
  mockCallAIWithResolvedPreset_ACU.mockResolvedValue(JSON.stringify({ selectedFactIds: [] }));
  mockRunPlotTasksRuntime.mockImplementation(async (_settings, _input, options) => {
    observeContext.current = options.requestContext;
    return runtimeResult();
  });
});

afterEach(() => {
  Object.assign(settings_ACU, originalSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('零层剧情推演因果隔离', () => {
  it('真实冻结推演仅经内部 reader 深拷贝可读，且不泄漏到历史、EJS、正文候选', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    const before = structuredClone(prepared);
    const expected = readPreparedSimulationCausalView_ACU(prepared, turn.turnId, turn.attemptId)!;

    const candidate = await prepareZeroLayerPlot_ACU(turn, [{ is_user: true, mes: '历史正文' }], new AbortController().signal,
      vi.fn(), prepared);

    const context = observeContext.current;
    expect(context.readSimulationCausalView).toEqual(expect.any(Function));
    const first = context.readSimulationCausalView();
    expect(first).toEqual(expected);
    expect(first.facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'locked-fact', revealState: 'locked' })]));
    first.facts[0].summary = '调用方篡改';
    expect(context.readSimulationCausalView().facts[0].summary).toBe('守卫更换巡逻路线');
    const lockedText = '守卫更换巡逻路线';
    expect(JSON.stringify(context.history)).not.toContain(lockedText);
    expect(JSON.stringify(context.ejsContext)).not.toContain(lockedText);
    expect(JSON.stringify(context.finalPromptEntries)).not.toContain(lockedText);
    expect(candidate.content).not.toContain(lockedText);
    expect(candidate.finalMessage).not.toContain(lockedText);
    expect(JSON.stringify(candidate.finalPrompts)).not.toContain(lockedText);
    expect(prepared.branches[0].simulation!.envelope!.ledger).toEqual(before.branches[0].simulation!.envelope!.ledger);
    expect(prepared.branches[0].simulation!.envelope!.ledger.actors[0].knownFacts).toEqual(['locked-fact']);
    expect(prepared.turns[0].body).toBe('已发布逻辑正文');
  });

  it('reader 在 assertCurrent 拒绝后中止，不暴露冻结资料', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    mockRunPlotTasksRuntime.mockImplementation(async (_settings, _input, options) => {
      expect(() => options.requestContext.readSimulationCausalView()).toThrow('已取消');
      return runtimeResult();
    });
    let calls = 0;
    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, () => {
      calls += 1;
      if (calls >= 2) throw new Error('已取消');
    }, prepared)).rejects.toThrow('已取消');
  });

  it('拒绝与当前 prepared 身份不一致的 source', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    const mismatched = structuredClone(prepared);
    mismatched.turns.find(item => item.turnId === 'prepared-2')!.attemptId = 'other-attempt';
    mockRunPlotTasksRuntime.mockImplementation(async (_settings, _input, options) => {
      options.requestContext.readSimulationCausalView();
      return runtimeResult();
    });

    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), mismatched)).rejects.toThrow();
  });

  it('未传 simulation source 时保持兼容且不提供 reader', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn());
    expect(observeContext.current.readSimulationCausalView).toBeUndefined();
  });

  it('显式 null source 立即拒绝且不启动剧情引擎', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), null as any)).rejects.toThrow();
    expect(mockRunPlotTasksRuntime).not.toHaveBeenCalled();
  });

  it('纯 AbortController 取消时自动私有选择后以真实 scope-changed 中止，reader 不返回 locked 全文', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    const controller = new AbortController();
    let readerRejected = false;
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async () => {
      controller.abort();
      return JSON.stringify({ selectedFactIds: [] });
    });
    mockRunPlotTasksRuntime.mockImplementation(async (_settings, _input, options) => {
      try {
        options.requestContext.readSimulationCausalView();
      } catch {
        readerRejected = true;
      }
      return runtimeResult();
    });

    await expect(prepareZeroLayerPlot_ACU(turn, [], controller.signal, vi.fn(), prepared)).rejects.toMatchObject({ code: 'scope-changed' });
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledOnce();
    expect(mockRunPlotTasksRuntime).not.toHaveBeenCalled();
    expect(readerRejected).toBe(false);
  });

  it('引擎 await 期间外部篡改输入不会污染冻结 reader、history 或结果', async () => {
    const prepared = await buildPreparedSource();
    const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
    const history = [{ is_user: true, mes: '冻结前历史' }];
    let release!: () => void;
    mockRunPlotTasksRuntime.mockImplementation((_settings, _input, options) => new Promise(resolve => {
      observeContext.current = options.requestContext;
      release = () => resolve(runtimeResult());
    }));

    const pending = prepareZeroLayerPlot_ACU(turn, history, new AbortController().signal, vi.fn(), prepared);
    await vi.waitFor(() => expect(observeContext.current).not.toBeNull());
    turn.input = '外部篡改输入';
    history[0].mes = '外部篡改历史';
    prepared.branches[0].simulation!.envelope!.ledger.facts[0].summary = '外部篡改 locked 全文';
    expect(observeContext.current.history[0].mes).toBe('冻结前历史');
    expect(observeContext.current.ejsContext.userMessage).toBe('下一步');
    expect(observeContext.current.readSimulationCausalView().facts[0].summary).toBe('守卫更换巡逻路线');

    release();
    const candidate = await pending;
    expect(candidate.content).toBe('普通保存剧情');
    expect(candidate.finalMessage).toBe('普通最终剧情');
    expect(JSON.stringify(candidate)).not.toContain('外部篡改');
  });
});
