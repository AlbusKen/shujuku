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

// Agent 世界书发现不属于本测试的因果读取边界；避免宿主世界书服务影响独立请求验收。
vi.mock('../../src/service/agent/agent-worldbook-skill-meta', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/agent/agent-worldbook-skill-meta')>(),
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => ({ available: false, control: null })),
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { normalizePlotTask_ACU } from '../../src/service/plot/plot-logic';
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
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import { _resetForTesting, getAllLogs, setApiLogEnabled, setDebugLogEnabled, setWarnLogEnabled } from '../../src/shared/log-buffer';

const lockedSecret = 'INTERNAL_LOCKED_SECRET_ECHO_9c4f';
const internalResponseSecret = 'INTERNAL_MODEL_REPLY_ECHO_6a72';
const WINDOW = globalThis as typeof globalThis & { window?: typeof globalThis };

function actor(id: string) {
  return {
    id, name: '守卫', interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
    knownFacts: ['locked-fact'], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1,
  };
}

async function buildConfirmedPreparedFixture() {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文只允许公开内容', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulation.envelope.ledger.actors = [actor('actor-1')];
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文只允许公开内容',
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
  const event = {
    id: 'event-1', title: '秘密巡逻调整', state: lockedSecret, status: 'active' as const,
    actorIds: ['actor-1'], organizationIds: [], locationRefs: [], startedAt: { day: 2, slot: '' }, deadline: null,
    nextCheck: { day: 3, slot: '', reason: '等待下一次秘密巡逻' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null,
  };
  const fact = {
    id: 'locked-fact', summary: lockedSecret, temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds: ['actor-1'],
    worldEventIds: ['event-1'], projectionPolicy: 'internal' as const, revealState: 'locked' as const,
    revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
  const milestone = {
    id: 'milestone-1', summary: `里程碑:${lockedSecret}`, happenedAt: { day: 2, slot: '' }, actorIds: ['actor-1'],
    worldEventIds: ['event-1'], locationRef: null, sourceFactIds: ['locked-fact'], importance: 1, category: '行动',
    visibility: 'internal' as const, revision: 1, legacyRefs: [],
  };
  const roundCandidate: WorldRoundCandidate_ACU = {
    baseRevision: 0, candidateClock: { ...store.read()!.ledger.clock, day: 2 },
    worldEventWrites: [{ value: event, expectedRevision: 0 }], actorWrites: [],
    factWrites: [{ value: fact, expectedRevision: 0 }], historyMilestoneWrites: [{ value: milestone, expectedRevision: 0 }],
    actorCompletions: [{ actorId: 'actor-1', completion: 'no_change', expectedRevision: 1 }],
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
    tableInput: { chatKey: 'chat-1', isolationKey: 'internal-causal-test', storageMode: 'native', tableData: { mate: {} },
      templateData: { mate: {} }, completedAiFloorBySheetKey: {}, autoUpdateEnabled: false },
  }, published.revision);
  const turn = prepared.turns.find(item => item.turnId === 'prepared-2')!;
  const view = readPreparedSimulationCausalView_ACU(prepared, turn.turnId, turn.attemptId)!;
  return { prepared, turn, view };
}

let originalSettings: Pick<typeof settings_ACU, 'plotSettings' | 'apiPresets' | 'plotApiPreset' | 'streamingEnabled' | 'plotTaskApiPresetOverridesById'>;
let originalEjsTemplate: unknown;
let ejsContexts: unknown[];

beforeEach(() => {
  WINDOW.window = globalThis;
  originalEjsTemplate = (globalThis as any).EjsTemplate;
  ejsContexts = [];
  (globalThis as any).EjsTemplate = {
    evalTemplate: vi.fn(async (text: string, context: unknown) => {
      ejsContexts.push(structuredClone(context));
      return text;
    }),
  };
  originalSettings = structuredClone({
    plotSettings: settings_ACU.plotSettings, apiPresets: settings_ACU.apiPresets, plotApiPreset: settings_ACU.plotApiPreset,
    streamingEnabled: settings_ACU.streamingEnabled, plotTaskApiPresetOverridesById: settings_ACU.plotTaskApiPresetOverridesById,
  });
  settings_ACU.plotSettings = {
    enabled: true, lastUsedPresetName: 'internal-causal-test', contextTurnCount: 0,
    plotWorldbookConfig: { source: 'manual', manualSelection: [] },
    plotTasks: [
      { id: 'internal-causal', name: '内部因果任务', stage: 1, order: 1, maxRetries: 1, internalCausalRead: true,
        promptGroup: [{ role: 'user', content: '仅在内部核对因果一致性。' }] },
      { id: 'public-task', name: '公开任务', stage: 2, order: 1, maxRetries: 1,
        promptGroup: [{ role: 'user', content: '仅输出公开剧情。' }] },
    ],
  } as any;
  settings_ACU.apiPresets = [{
    name: 'internal-causal-test', apiMode: 'custom', tavernProfile: '',
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key',
      useMainApi: false, sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' },
  }];
  settings_ACU.plotApiPreset = 'internal-causal-test';
  settings_ACU.streamingEnabled = true;
  settings_ACU.plotTaskApiPresetOverridesById = {};
  mockCallAIWithResolvedPreset_ACU.mockReset();
  mockCountWorldSimulationTokens_ACU.mockReset();
  mockCountWorldSimulationTokens_ACU.mockImplementation(async (text: string) => Math.max(1, Math.ceil(String(text).length / 4)));
  _resetForTesting();
  setApiLogEnabled(true);
  setDebugLogEnabled(true);
  setWarnLogEnabled(true);
});

afterEach(() => {
  Object.assign(settings_ACU, originalSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
  delete WINDOW.window;
  if (originalEjsTemplate === undefined) delete (globalThis as any).EjsTemplate;
  else (globalThis as any).EjsTemplate = originalEjsTemplate;
  _resetForTesting();
});

describe('零层剧情内部因果任务端到端隔离', () => {
  it('真实 prepare、normalizer 与 engine 只将完整 locked 账本送到内部严格端口，公开链路不含秘密', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    const ledgerBefore = structuredClone(prepared.branches[0].simulation!.envelope!.ledger);
    const calls: Array<{ messages: Array<{ role: string; content: string }>; resolved: any; extras: any }> = [];
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages, resolved, _signal, _lifecycle, extras) => {
      calls.push({ messages: structuredClone(messages), resolved: structuredClone(resolved), extras: structuredClone(extras) });
      const internal = messages.some((message: any) => message.role === 'system' && message.content.includes(lockedSecret));
    return internal ? JSON.stringify({ selectedFactIds: [] }) : '<plot>PUBLIC_MODEL_RESULT</plot>';
    });

    expect(normalizePlotTask_ACU(settings_ACU.plotSettings.plotTasks[0], { index: 0 }).internalCausalRead).toBe(true);
    expect(normalizePlotTask_ACU(settings_ACU.plotSettings.plotTasks[1], { index: 1 }).internalCausalRead).toBe(false);

    const candidate = await prepareZeroLayerPlot_ACU(
      turn, [{ is_user: false, mes: '已公开的前文' }], new AbortController().signal, vi.fn(), prepared,
    );

    expect(calls).toHaveLength(2);
    const internalCall = calls.find(call => call.messages.some(message => message.content.includes(lockedSecret)))!;
    const publicCall = calls.find(call => !call.messages.some(message => message.content.includes(lockedSecret)))!;
    expect(internalCall.messages.at(-1)).toMatchObject({ role: 'system' });
    expect(internalCall.messages.at(-1)?.content).toContain(lockedSecret);
    expect(internalCall.messages.at(-1)?.content).toContain('秘密巡逻调整');
    expect(internalCall.messages.at(-1)?.content).toContain('里程碑:');
    expect(internalCall.messages.at(-1)?.content).toContain('"revealState":"locked"');
    expect(internalCall.resolved.apiConfig.useMainApi).toBe(false);
    expect(internalCall.extras).toMatchObject({
      streaming: false, requireDirectTransport: true, suppressPayloadLogging: true,
    });
    expect(JSON.stringify(publicCall.messages)).not.toContain(lockedSecret);
    expect(JSON.stringify(publicCall.messages)).not.toContain(internalResponseSecret);
    expect(JSON.stringify(ejsContexts)).not.toContain(lockedSecret);
    expect(JSON.stringify(ejsContexts)).not.toContain(internalResponseSecret);
    expect(JSON.stringify(candidate.finalPrompts)).not.toContain(lockedSecret);
    expect(JSON.stringify(candidate.taskContents)).not.toContain(lockedSecret);
    expect(JSON.stringify(candidate)).not.toContain(internalResponseSecret);
    expect(JSON.stringify(candidate)).not.toContain(lockedSecret);
    expect(ejsContexts.length).toBeGreaterThan(0);
    expect(candidate.taskContents).toEqual({ 'public-task': '<plot>PUBLIC_MODEL_RESULT</plot>' });
    expect(candidate.content).toContain('PUBLIC_MODEL_RESULT');
    expect(candidate.finalMessage).toContain('PUBLIC_MODEL_RESULT');
    expect(getAllLogs().length).toBeGreaterThan(0);
    expect(JSON.stringify(getAllLogs())).not.toContain(lockedSecret);
    expect(JSON.stringify(getAllLogs())).not.toContain(internalResponseSecret);
    expect(prepared.branches[0].simulation!.envelope!.ledger).toEqual(ledgerBefore);
    expect(prepared.branches[0].simulation!.envelope!.ledger.actors[0].knownFacts).toEqual(['locked-fact']);
    expect(prepared.branches[0].simulation!.envelope!.ledger.facts[0].revealState).toBe('locked');
  });

  it('真实 prepare 仅有内部任务时不产生正文候选或保存原始回复', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    settings_ACU.plotSettings.plotTasks = [settings_ACU.plotSettings.plotTasks[0]];
    mockCallAIWithResolvedPreset_ACU.mockResolvedValue(JSON.stringify({ selectedFactIds: [] }));
    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledOnce();
    expect(candidate).toMatchObject({ outcome: 'no-tasks', finalMessage: null, content: '', taskContents: {}, finalPrompts: [] });
    expect(JSON.stringify(candidate)).not.toContain(internalResponseSecret);
    expect(JSON.stringify(candidate)).not.toContain(lockedSecret);
  });

  it('内部任务无 reader 时在调用任何模型前 fail-closed', async () => {
    const callApi = vi.fn();
    const callInternalApi = vi.fn();
    await expect(runPlotTasksRuntime_ACU({
      contextTurnCount: 0, plotWorldbookConfig: { source: 'manual', manualSelection: [] },
      plotTasks: [{ id: 'internal-only', name: '内部', stage: 1, order: 1, internalCausalRead: true,
        maxRetries: 1, promptGroup: [{ role: 'user', content: '内部提示' }] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        resolveTaskApiPreset: () => '', callApi, callInternalApi,
      },
    } as any)).rejects.toThrow('需要已配置的因果视图读取器');
    expect(callApi).not.toHaveBeenCalled();
    expect(callInternalApi).not.toHaveBeenCalled();
  });

  it('引擎将内部成功独立计数，不携带回复并保持公开结果可用', async () => {
    const { view } = await buildConfirmedPreparedFixture();
    const internalCalls: Array<Array<{ role: string; content: string }>> = [];
    const callApi = vi.fn(async () => '<plot>公开结果</plot>');
    const result = await runPlotTasksRuntime_ACU({
      contextTurnCount: 0, plotWorldbookConfig: { source: 'manual', manualSelection: [] },
      plotTasks: [
        { id: 'internal', name: '内部', stage: 1, order: 1, internalCausalRead: true, maxRetries: 1,
          promptGroup: [{ role: 'user', content: '内部提示' }] },
        { id: 'public', name: '公开', stage: 2, order: 1, maxRetries: 1,
          promptGroup: [{ role: 'user', content: '公开提示' }], extractTags: 'plot' },
      ],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        readSimulationCausalView: () => structuredClone(view), resolveTaskApiPreset: () => '', callApi,
        callInternalApi: async messages => {
          internalCalls.push(structuredClone(messages));
          return JSON.stringify({ selectedFactIds: [] });
        },
      },
    } as any);

    expect(result.internalTaskCount).toBe(1);
    expect(result.successfulResults).toEqual([
      expect.objectContaining({ taskId: 'public', rawResponse: '<plot>公开结果</plot>' }),
    ]);
    expect(JSON.stringify(result)).not.toContain(internalResponseSecret);
    expect(internalCalls).toHaveLength(1);
    expect(JSON.stringify(internalCalls)).toContain(lockedSecret);
    expect(callApi).toHaveBeenCalledWith([{ role: 'user', content: '公开提示' }], '');
  });

  it('真实 prepare 的普通 scene token 在自动私有选择返回空 IDs 后仍拒绝不可信时空，且不发送公开模型请求', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    settings_ACU.plotSettings.plotTasks = [{
      id: 'ordinary-scene', name: '普通场景任务', stage: 1, order: 1, maxRetries: 1,
      promptGroup: [{ role: 'user', content: '场景：$SIMULATION_SCENE_FACTS' }],
    }];
    mockCallAIWithResolvedPreset_ACU.mockResolvedValue(JSON.stringify({ selectedFactIds: [] }));

    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared))
      .rejects.toThrow('剧情场景上下文无效');
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledOnce();
    expect(JSON.stringify(mockCallAIWithResolvedPreset_ACU.mock.calls)).toContain(lockedSecret);
  });

  it('因果资料超出 8192 token 预算时拒绝内部请求，且不将它误当公开任务结果', async () => {
    const { view } = await buildConfirmedPreparedFixture();
    mockCountWorldSimulationTokens_ACU.mockResolvedValue(8193);
    const callInternalApi = vi.fn();
    const result = await runPlotTasksRuntime_ACU({
      contextTurnCount: 0, plotWorldbookConfig: { source: 'manual', manualSelection: [] },
      plotTasks: [{ id: 'budget-internal', name: '预算内部', stage: 1, order: 1, internalCausalRead: true,
        maxRetries: 1, promptGroup: [{ role: 'user', content: '内部提示' }] }],
    }, '当前输入', {
      requestContext: {
        history: [], tableData: {}, presetName: '', signal: new AbortController().signal,
        sqlReadContext: null, ejsContext: {}, finalPromptEntries: [], assertCurrent: vi.fn(),
        readSimulationCausalView: () => structuredClone(view), resolveTaskApiPreset: () => '', callApi: vi.fn(), callInternalApi,
      },
    } as any);

    expect(callInternalApi).not.toHaveBeenCalled();
    expect(result.successfulResults).toEqual([]);
    expect(result.failedResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'budget-internal', internalCausalRead: true }),
    ]));
  });

  it('内部请求途中取消会拒绝整个 prepare，且后续公开任务永不发送', async () => {
    const { prepared, turn } = await buildConfirmedPreparedFixture();
    const controller = new AbortController();
    mockCallAIWithResolvedPreset_ACU.mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      if (messages.some(message => message.content.includes(lockedSecret))) {
        controller.abort();
        return JSON.stringify({ selectedFactIds: [] });
      }
      return 'PUBLIC_MODEL_RESULT';
    });

    await expect(prepareZeroLayerPlot_ACU(turn, [], controller.signal, vi.fn(), prepared))
      .rejects.toMatchObject({ code: 'scope-changed' });
    expect(mockCallAIWithResolvedPreset_ACU).toHaveBeenCalledTimes(1);
  });
});
