import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { callAI } = vi.hoisted(() => ({ callAI: vi.fn() }));
vi.mock('../../src/service/ai/api-call', async original => ({
  ...await original<typeof import('../../src/service/ai/api-call')>(), callAIWithResolvedPreset_ACU: callAI,
}));
vi.mock('../../src/service/agent/agent-worldbook-skill-meta', async original => ({
  ...await original<typeof import('../../src/service/agent/agent-worldbook-skill-meta')>(),
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => ({ available: false, control: null })),
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { WORLD_CHRONICLE_HOT_WINDOW_ACU, type WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { prepareZeroLayerPlot_ACU } from '../../src/service/zero-layer/plot-preparation';
import { PLOT_WORLD_SIMULATION_TOKEN_ACU } from '../../src/service/runtime/plot-runtime/plot-world-context';
import { commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';

const marker = '[[ACU_WORLD_SIMULATION_CONTEXT]]';
const location = { region: '城区', place: '钟楼' };
const distant = { region: '港区', place: '密室' };
const plotOutput = '<plot>模型生成的推进结果</plot>';
const globalWindow = globalThis as typeof globalThis & { window?: typeof globalThis };

function fact(id: string, summary: string, where = location, revealState: 'locked' | 'unlocked' = 'locked') {
  return { id, summary, temporalKind: 'occurrence' as const, happenedAt: { day: 2, slot: '' }, validFrom: null,
    validUntil: null, locationRef: where, actorIds: [], worldEventIds: [], projectionPolicy: 'gated' as const,
    revealState, revealGate: { semanticCondition: '未来剧情适时揭示' }, nextCheck: null,
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
}
function milestone(id: string, summary: string) {
  return { id, summary, happenedAt: { day: 2, slot: '' }, actorIds: [], worldEventIds: [],
    locationRef: distant, sourceFactIds: [], importance: 3, category: '历史', visibility: 'internal' as const,
    revision: 1, legacyRefs: [] };
}

async function confirmedFixture(target: 'plot' | 'body', withPrevious = true) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '主角站在钟楼。', swipe_id: 0 };
  const chat = [carrier];
  let remote: unknown[] = [];
  const simulation = emptyZeroLayerSimulation_ACU();
  simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
  simulation.envelope.settings.deliveryTarget = target;
  simulation.envelope.ledger.player.location = location;
  simulation.envelope.ledger.factArchive = [fact('cold-secret', 'COLD_SECRET_旧闻密报', distant)];
  simulation.envelope.ledger.historyArchive = Array.from({ length: WORLD_CHRONICLE_HOT_WINDOW_ACU }, (_, index) =>
    milestone(`cold-history-${index}`, `历史记录${index}`));
  simulation.envelope.ledger.historyArchive[WORLD_CHRONICLE_HOT_WINDOW_ACU - 1] =
    milestone('cold-history-old', 'COLD_HISTORY_旧时战役');
  simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, 1);
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: String(carrier.mes),
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{ turnId: 'parent-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'parent-attempt',
      input: '继续', body: String(carrier.mes), phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'parent-user', role: 'user', data: {} },
      assistantFloor: { floorId: 'parent-floor', role: 'assistant', data: { table: {
        floorId: 'parent-floor', tableData: { mate: {} }, completedAiFloorBySheetKey: {}, filledSheetKeys: [],
      } } },
      ...(withPrevious ? { materialBaseline: { simulation: structuredClone(simulation), continuation: null } } : {}),
      simulationDeliveryTarget: target, requiredEffects: ['simulation'], effectReceipts: [], errorCode: null }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);
  remote = structuredClone(chat);
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1',
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }) } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  const store = new ZeroLayerSimulationStore_ACU();
  const anchor = store.anchorForTurn('parent-1');
  const identity: WorldSimulationRunIdentity_ACU = { runId: 'run-1', chatIdentity: store.getChatIdentity(),
    triggerKind: 'assistant_completed', triggerConversationMessageId: null, kind: 'logical',
    logicalRef: anchor.logicalRef, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, deliveryTarget: target,
    workflowMode: 'layered', workflowProtocol: 'world-round-v1' };
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
  const roundCandidate: WorldRoundCandidate_ACU = { baseRevision: 0,
    candidateClock: { ...store.read()!.ledger.clock, day: 3 }, worldEventWrites: [], actorWrites: [],
    factWrites: [{ value: fact('far-locked', 'FAR_LOCKED_SECRET_港区秘密', distant), expectedRevision: 0 }],
    historyMilestoneWrites: [{ value: { ...milestone('new-history', 'NEW_HISTORY_已发生的里程碑'), happenedAt: { day: 3, slot: '' } }, expectedRevision: 0 }],
    actorCompletions: [], projection: { anchor: null, deliveries: [] }, completion: 'changed' };
  await commitZeroLayerSimulationRound_ACU(store, { identity, anchor, roundCandidate,
    completedAt: 10, timelineId: 'timeline-1', summary: 'ROUND_SUMMARY_已确认本轮变化' });
  const zero = new ZeroLayerStore_ACU();
  const settled = await zero.commit({ type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'effects-durable' }, store.readSource().revision);
  const published = await zero.commit({ type: 'transition-turn', turnId: 'parent-1', attemptId: 'parent-attempt', phase: 'published' }, settled.revision);
  const prepared = await zero.commit({ type: 'prepare-turn', turnId: 'prepared-2', attemptId: 'prepared-attempt',
    input: '继续前进', requiredEffects: [], tableInput: { chatKey: 'chat-1', isolationKey: 'context-test',
      storageMode: 'native', tableData: { mate: {} }, templateData: { mate: {} },
      completedAiFloorBySheetKey: {}, autoUpdateEnabled: false } }, published.revision);
  return { prepared, turn: prepared.turns.find(item => item.turnId === 'prepared-2')! };
}

let originalSettings: Record<string, unknown>;
let originalEjs: unknown;
beforeEach(() => {
  globalWindow.window = globalThis;
  originalEjs = (globalThis as any).EjsTemplate;
  (globalThis as any).EjsTemplate = { evalTemplate: vi.fn(async (text: string) => text) };
  originalSettings = structuredClone({ plotSettings: settings_ACU.plotSettings, apiPresets: settings_ACU.apiPresets,
    plotApiPreset: settings_ACU.plotApiPreset, streamingEnabled: settings_ACU.streamingEnabled,
    plotTaskApiPresetOverridesById: settings_ACU.plotTaskApiPresetOverridesById });
  settings_ACU.plotSettings = { enabled: true, lastUsedPresetName: 'context-test', contextTurnCount: 0,
    plotWorldbookConfig: { source: 'manual', manualSelection: [] }, plotTasks: [{ id: 'plot-task', name: '推进',
      stage: 1, order: 1, maxRetries: 1, extractTags: 'plot', promptGroup: [{ role: 'user', content: '推进剧情' }] }] } as any;
  settings_ACU.apiPresets = [{ name: 'context-test', apiMode: 'custom', tavernProfile: '',
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key',
      useMainApi: false, sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat' } }];
  settings_ACU.plotApiPreset = 'context-test';
  settings_ACU.streamingEnabled = false;
  settings_ACU.plotTaskApiPresetOverridesById = {};
  callAI.mockReset().mockResolvedValue(plotOutput);
});
afterEach(() => {
  Object.assign(settings_ACU, originalSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
  delete globalWindow.window;
  if (originalEjs === undefined) delete (globalThis as any).EjsTemplate;
  else (globalThis as any).EjsTemplate = originalEjs;
});

describe('冻结的已确认世界背景直达剧情任务', () => {
  it('plot 仅调用一次任务 API，六类资料含远处 locked/冷热历史，最终不拼接原始背景', async () => {
    const { turn, prepared } = await confirmedFixture('plot');
    const original = structuredClone(prepared);
    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    expect(callAI).toHaveBeenCalledTimes(1);
    const [messages, , , , options] = callAI.mock.calls[0];
    expect(options.suppressPayloadLogging).toBeUndefined();
    const background = messages.filter((message: { content: string }) => message.content.includes(marker));
    expect(background).toHaveLength(1);
    expect(background[0].role).toBe('system');
    const context = JSON.parse(background[0].content.slice(background[0].content.indexOf('\n', background[0].content.indexOf('\n') + 1) + 1));
    expect(Object.keys(context).sort()).toEqual(['actors', 'clock', 'facts', 'historyMilestones', 'round', 'worldEvents']);
    expect(context.clock.day).toBe(3);
    expect(context.round.comparison).toBe('available');
    expect(context.round.summary).toBe('ROUND_SUMMARY_已确认本轮变化');
    expect(context.round.facts.added.some((item: { id: string }) => item.id === 'far-locked')).toBe(true);
    expect(context.facts.hot.some((item: { id: string; revealState: string }) => item.id === 'far-locked' && item.revealState === 'locked')).toBe(true);
    expect(context.facts.cold.some((item: { id: string }) => item.id === 'cold-secret')).toBe(true);
    expect([...context.historyMilestones.hot, ...context.historyMilestones.cold].some((item: { id: string }) => item.id === 'new-history')).toBe(true);
    expect(context.historyMilestones.cold.some((item: { id: string }) => item.id === 'cold-history-old')).toBe(true);
    expect(candidate.outcome).toBe('generated');
    expect(candidate.finalMessage).toContain(plotOutput);
    expect(candidate.causalDelivery).toBeUndefined();
    expect(JSON.stringify(candidate)).not.toContain('FAR_LOCKED_SECRET_');
    expect(prepared).toEqual(original);
  });

  it.each(['plot', 'body'] as const)('任意预设原始任务 token 可读取 %s 目标的完整冻结资料，且请求只投送一份', async target => {
    settings_ACU.plotSettings.lastUsedPresetName = '任意自定义预设';
    settings_ACU.plotSettings.plotTasks = [{ id: 'custom-task', name: '任意任务', stage: 1, order: 1,
      maxRetries: 1, extractTags: 'plot', promptGroup: [{ role: 'user', content: `世界背景：${PLOT_WORLD_SIMULATION_TOKEN_ACU}` }] }] as any;
    const { turn, prepared } = await confirmedFixture(target);
    callAI.mockImplementation(async messages => JSON.stringify(messages).includes('selectedFactIds')
      ? JSON.stringify({ selectedFactIds: [] }) : plotOutput);
    const candidate = await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    const taskCall = callAI.mock.calls.find(([messages]) => messages.some((message: { content: string }) =>
      message.content.includes('世界背景：')));
    expect(taskCall).toBeDefined();
    const [messages, , , , options] = taskCall!;
    expect(options.suppressPayloadLogging).toBeUndefined();
    expect(JSON.stringify(messages).split(marker)).toHaveLength(2);
    expect(JSON.stringify(messages)).toContain('FAR_LOCKED_SECRET_港区秘密');
    expect(JSON.stringify(messages)).toContain('COLD_SECRET_旧闻密报');
    expect(JSON.stringify(messages)).toContain('COLD_HISTORY_旧时战役');
    expect(JSON.stringify(messages)).not.toContain(PLOT_WORLD_SIMULATION_TOKEN_ACU);
    expect(JSON.stringify(candidate)).not.toContain(marker);
    expect(JSON.stringify(candidate)).not.toContain('FAR_LOCKED_SECRET_');
  });

  it('显式 token 没有已确认回执时仍读取当前冻结账本，变化不可比较', async () => {
    settings_ACU.plotSettings.plotTasks[0].promptGroup = [{ role: 'user', content: PLOT_WORLD_SIMULATION_TOKEN_ACU }];
    const { turn, prepared } = await confirmedFixture('body');
    turn.materialBaseline!.simulation!.confirmed = [];
    prepared.turns.find(item => item.turnId === turn.turnId)!.materialBaseline!.simulation!.confirmed = [];
    await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    const messages = callAI.mock.calls[0][0];
    const world = messages.find((message: { content: string }) => message.content.includes(marker));
    expect(world).toBeDefined();
    const context = JSON.parse(world.content.split('\n').slice(2).join('\n'));
    expect(context.round.comparison).toBe('unavailable');
    expect(JSON.stringify(context)).toContain('COLD_SECRET_旧闻密报');
  });

  it('显式 token 不读取冻结回合之后的分支工作状态，也不接受跨分支 prepared 回合', async () => {
    settings_ACU.plotSettings.plotTasks[0].promptGroup = [{ role: 'user', content: PLOT_WORLD_SIMULATION_TOKEN_ACU }];
    const { turn, prepared } = await confirmedFixture('plot');
    const branch = prepared.branches.find(item => item.branchId === prepared.activeBranchId)!;
    branch.simulation!.envelope!.ledger.factArchive.push(fact('future', 'FUTURE_BRANCH_SECRET'));
    branch.simulation!.fields = seedLedgerFieldView_ACU(branch.simulation!.envelope!.ledger, 1);
    await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    expect(JSON.stringify(callAI.mock.calls)).not.toContain('FUTURE_BRANCH_SECRET');
    callAI.mockClear();
    const foreign = structuredClone(turn);
    foreign.branchId = 'different-branch';
    await expect(prepareZeroLayerPlot_ACU(foreign, [], new AbortController().signal, vi.fn(), prepared)).rejects.toThrow();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('无冻结模拟账本时显式 token 不生成背景', async () => {
    settings_ACU.plotSettings.plotTasks[0].promptGroup = [{ role: 'user', content: `资料：${PLOT_WORLD_SIMULATION_TOKEN_ACU}` }];
    const { turn, prepared } = await confirmedFixture('body');
    turn.materialBaseline!.simulation = null;
    prepared.turns.find(item => item.turnId === turn.turnId)!.materialBaseline!.simulation = null;
    await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    expect(JSON.stringify(callAI.mock.calls)).not.toContain(marker);
  });

  it('缺少可信前序基底时不猜变化，仍传完整当前快照', async () => {
    const { turn, prepared } = await confirmedFixture('plot', false);
    await prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared);
    const background = callAI.mock.calls[0][0].find((message: { content: string }) => message.content.includes(marker));
    const context = JSON.parse(background.content.split('\n').slice(2).join('\n'));
    expect(context.round.comparison).toBe('unavailable');
    expect(JSON.stringify(context)).toContain('FAR_LOCKED_SECRET_');
  });

  it('失败、取消与非 plot 目标不错误生成或投送背景', async () => {
    const { turn, prepared } = await confirmedFixture('plot');
    callAI.mockRejectedValueOnce(new Error('API unavailable'));
    await expect(prepareZeroLayerPlot_ACU(turn, [], new AbortController().signal, vi.fn(), prepared)).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(prepareZeroLayerPlot_ACU(turn, [], controller.signal, vi.fn(), prepared)).rejects.toThrow();
    expect(callAI).toHaveBeenCalledTimes(1);
    const body = await confirmedFixture('body');
    callAI.mockReset().mockImplementation(async messages => JSON.stringify(messages).includes('selectedFactIds')
      ? JSON.stringify({ selectedFactIds: [] }) : plotOutput);
    await prepareZeroLayerPlot_ACU(body.turn, [], new AbortController().signal, vi.fn(), body.prepared);
    expect(callAI.mock.calls.every(([messages]) => !JSON.stringify(messages).includes(marker))).toBe(true);
  });
});
