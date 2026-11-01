import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallAIWithResolvedPreset_ACU, mockCallApiWithPlotPreset_ACU, mockCountWorldSimulationTokens_ACU } = vi.hoisted(() => ({
  mockCallAIWithResolvedPreset_ACU: vi.fn(),
  mockCallApiWithPlotPreset_ACU: vi.fn(),
  mockCountWorldSimulationTokens_ACU: vi.fn(async (text: string) => Math.max(1, Math.ceil(String(text).length / 4))),
}));

vi.mock('../../src/service/ai/api-call', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/ai/api-call')>(),
  callAIWithResolvedPreset_ACU: mockCallAIWithResolvedPreset_ACU,
  callApiWithPlotPreset_ACU: mockCallApiWithPlotPreset_ACU,
}));
vi.mock('../../src/service/simulation/agent/agent-token-budget', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/simulation/agent/agent-token-budget')>(),
  countWorldSimulationTokens_ACU: mockCountWorldSimulationTokens_ACU,
}));
// 世界书 Agent 发现不属于普通剧情因果桥的验收边界；其余 store/parser/scene/bridge 均使用真实实现。
vi.mock('../../src/service/agent/agent-worldbook-takeover', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/agent/agent-worldbook-takeover')>(),
  clearFinalGenerationGreenlights_ACU: vi.fn(async () => ({ status: 'cleared', patched: 0, staleBookNames: [] })),
  writeFinalGenerationGreenlights_ACU: vi.fn(async () => true),
}));
vi.mock('../../src/service/agent/agent-worldbook-skill-meta', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/service/agent/agent-worldbook-skill-meta')>(),
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => ({ available: false, control: null })),
}));

import { settings_ACU } from '../../src/service/runtime/state-manager';
import { runPlotTasksRuntime_ACU } from '../../src/service/runtime/plot-runtime/plot-task-engine';
import { buildDefaultWorldSimulationEnvelope_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../src/service/simulation/defaults';
import { appendWorldSimulationCommitChain_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { FirstFloorWorldSimulationStore_ACU, resolveWorldSimulationAnchor_ACU } from '../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import { clearLogs, getAllLogs, isApiLogEnabled, setApiLogEnabled } from '../../src/shared/log-buffer';

const PLACE = { region: '城区', place: '钟楼广场' } as const;
const SOURCE_TEXT = '主角站在钟楼广场。';
const SAFE_FACT = 'SAFE_FACT_城门已经关闭。';
const LOCKED_FACT = 'LOCKED_FACT_SECRET_守卫持有暗门密钥。';
const INTERNAL_FACT = 'INTERNAL_FACT_SECRET_钟楼地下暗门已打开。';
const PUBLIC_RESULT = '<plot>公开剧情继续推进。</plot>';
const WINDOW = globalThis as typeof globalThis & { window?: typeof globalThis };

type AiCall = { messages: Array<{ role: string; content: string }>; extras: unknown };

function fact(id: string, summary: string, projectionPolicy: 'scene' | 'internal', revealState: 'unlocked' | 'locked') {
  return {
    id, summary, temporalKind: 'occurrence' as const,
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: { ...PLACE }, actorIds: [], worldEventIds: [],
    projectionPolicy, revealState, revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

function completedRun(anchor: ReturnType<typeof resolveWorldSimulationAnchor_ACU>) {
  return {
    kind: 'host' as const, runId: 'ordinary-plot-run', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0, taskId: 'ordinary-plot-task',
    stageId: 'ordinary-plot-stage', stageRevision: 1, deliveryTarget: 'plot' as const, workflowMode: 'single' as const,
    workflowProtocol: 'world-round-v1' as const, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
  };
}

function installCompletedHostFixture() {
  const chat: any[] = [{}, { is_user: true, mes: '继续前进', message_id: 1 },
    { is_user: false, mes: SOURCE_TEXT, message_id: 2, swipe_id: 0 }];
  const chatId = 'ordinary-plot-production';
  let remote = structuredClone(chat);
  const api: any = {
    chat, chatId, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'ordinary-plot-card.png', name: '测试角色' }], getCurrentChatId: () => chatId,
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
  };
  _set_SillyTavern_API_ACU(api);
  const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
  const before = buildEmptyWorldSimulationLedger_ACU();
  before.player.location = { ...PLACE };
  const ledger = structuredClone(before);
  ledger.revision = 1;
  ledger.facts = [
    fact('safe-scene', SAFE_FACT, 'scene', 'unlocked'),
    fact('locked-scene', LOCKED_FACT, 'scene', 'locked'),
    fact('internal-scene', INTERNAL_FACT, 'internal', 'unlocked'),
  ];
  ledger.historyArchive = [{ id: 'cold-history', summary: 'COLD_HISTORY_SECRET_昔日钟楼密约', happenedAt: { day: 1, slot: '' },
    actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 4, category: '重大事件',
    visibility: 'internal', revision: 1, legacyRefs: [] }];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger = structuredClone(ledger);
  const identity = completedRun(anchor);
  envelope.task = {
    taskId: identity.taskId, originInstruction: '推进', status: 'completed', createdAt: 1, updatedAt: 2,
    activeRun: null, completedRun: identity, stopReason: null,
    completedAutoAnchor: { chatIdentity: chatId, messageKey: anchor.messageKey, swipeId: anchor.swipeId, contentDigest: anchor.contentDigest },
  };
  envelope.timeline = [{ id: 'ordinary-plot-timeline', at: 2, kind: 'committed', taskId: identity.taskId,
    stageId: identity.stageId, revision: 1, runId: identity.runId, message: '已提交' }];
  envelope.activeStageId = identity.stageId;
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'completed', activeRevision: 1, revisions: [{
    revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
    plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
      plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' },
  }] }];
  chat[0]._qrf_world_simulation = envelope;
  appendWorldSimulationCommitChain_ACU({
    chat, messageIndex: anchor.messageIndex, anchor, beforeLedger: before, nextLedger: ledger, evidenceRefs: [], updatedAt: 2,
    checkpointIndex: null, beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
  });
  remote = structuredClone(chat);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1:43111')) {
      const rawBody = typeof (init as RequestInit | undefined)?.body === 'string' ? (init as RequestInit).body : '';
      const messages = JSON.parse(rawBody || '{"messages":[]}').messages as Array<{ content?: string }>;
      const privateText = messages.map(message => String(message.content || '')).join('\n');
      const content = privateText.includes('selectedFactIds')
        ? JSON.stringify({ selectedFactIds: ['safe-scene', 'locked-scene', 'internal-scene'] })
        : privateText.includes('world-narrative-review-v1')
          ? JSON.stringify({ locationRef: PLACE, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '钟楼广场' }], reviews: [] })
          : PUBLIC_RESULT;
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([{}, ...structuredClone(remote)]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { chat, anchor, ledger, api, fetchMock };
}

function setOrdinaryPlotSettings(enabled = true) {
  settings_ACU.plotSettings = {
    enabled, lastUsedPresetName: 'ordinary-plot-production', contextTurnCount: 0,
    plotWorldbookConfig: { source: 'manual', manualSelection: [] },
    // 普通任务直接读取完整格林背景，由模型决定推进内容。
    plotTasks: [{ id: 'ordinary-public-task', name: '普通公开任务', stage: 1, order: 1, maxRetries: 1, extractTags: 'plot',
      promptGroup: [{ role: 'user', content: '只输出公开剧情。' }] }],
  } as any;
}

function isPrivateSelection(call: AiCall): boolean {
  return call.messages.some(message => message.content.includes('selectedFactIds'));
}

function isSceneReview(call: AiCall): boolean {
  return call.messages.some(message => message.content.includes('world-narrative-review'));
}

let originalSettings: Pick<typeof settings_ACU, 'plotSettings' | 'apiPresets' | 'plotApiPreset' | 'streamingEnabled' | 'plotTaskApiPresetOverridesById'>;
let originalEjsTemplate: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  WINDOW.window = globalThis;
  originalEjsTemplate = (globalThis as any).EjsTemplate;
  (globalThis as any).EjsTemplate = { prepareContext: vi.fn(async () => ({})), evalTemplate: vi.fn(async (text: string) => text) };
  originalSettings = structuredClone({
    plotSettings: settings_ACU.plotSettings, apiPresets: settings_ACU.apiPresets, plotApiPreset: settings_ACU.plotApiPreset,
    streamingEnabled: settings_ACU.streamingEnabled, plotTaskApiPresetOverridesById: settings_ACU.plotTaskApiPresetOverridesById,
  });
  setOrdinaryPlotSettings(true);
  settings_ACU.apiPresets = [{ name: 'ordinary-plot-production', apiMode: 'custom', tavernProfile: '',
    // 本文件按原始请求体核对背景消息；上游默认的「API工具调用」会把首条之后的消息改写为 turn_ 函数，这里关闭。
    apiConfig: { url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test-model', apiKey: 'test-key', useMainApi: false,
      sendViaTavern: false, max_tokens: 64, temperature: 0.1, customApiFormat: 'openai_compat', contextToolTransportEnabled: false } }];
  settings_ACU.plotApiPreset = 'ordinary-plot-production';
  settings_ACU.streamingEnabled = false;
  settings_ACU.plotTaskApiPresetOverridesById = {};
  mockCallAIWithResolvedPreset_ACU.mockReset();
  mockCallApiWithPlotPreset_ACU.mockReset();
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

describe('普通剧情正式因果投送', () => {
  it('真实 host 折叠账本直接交给推进任务，包含完整幕后资料且不触发自动选择或场景审查', async () => {
    const fixture = installCompletedHostFixture();
    const before = structuredClone(fixture.chat);
    const result = await runPlotTasksRuntime_ACU(settings_ACU.plotSettings as any, '继续前进');
    const transportCalls = fixture.fetchMock.mock.calls
      .filter((call: any[]) => String(call[0]).includes('127.0.0.1:43111'))
      .map((call: any[]) => ({
        messages: JSON.parse(String(call[1]?.body || '{"messages":[]}')).messages as Array<{ role: string; content: string }>,
        extras: null,
      }));
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls.filter(isPrivateSelection)).toHaveLength(0);
    expect(transportCalls.filter(isSceneReview)).toHaveLength(0);
    const background = transportCalls[0].messages.find(message => message.content.includes('[[ACU_WORLD_SIMULATION_CONTEXT]]'))!;
    expect(background.role).toBe('system');
    const context = JSON.parse(background.content.split('\n').at(-1)!);
    expect(Object.keys(context)).toEqual(['clock', 'round', 'worldEvents', 'actors', 'facts', 'historyMilestones']);
    expect(context.round.comparison).toBe('available');
    expect(context.round.facts.added).toHaveLength(3);
    for (const fact of [SAFE_FACT, LOCKED_FACT, INTERNAL_FACT, 'COLD_HISTORY_SECRET_昔日钟楼密约']) {
      expect(background.content).toContain(fact);
      expect(result.finalMessage).not.toContain(fact);
    }
    const ejsInputs = ((globalThis as any).EjsTemplate.evalTemplate as ReturnType<typeof vi.fn>).mock.calls.map((call: any[]) => String(call[0])).join('\n');
    expect(ejsInputs).not.toContain(LOCKED_FACT);
    expect(result.finalMessage).toContain(PUBLIC_RESULT);
    expect(fixture.chat).toEqual(before);
  });

  it('任务原文使用 $WORLD_SIMULATION 时单次请求携带完整资料，不依赖已完成运行元数据', async () => {
    const fixture = installCompletedHostFixture();
    fixture.chat[0]._qrf_world_simulation.task = null;
    fixture.chat[0]._qrf_world_simulation.stages = [];
    fixture.chat[0]._qrf_world_simulation.activeStageId = null;
    (settings_ACU.plotSettings as any).plotTasks[0].promptGroup[0].content = '参考 $WORLD_SIMULATION，只输出公开剧情。';

    const result = await runPlotTasksRuntime_ACU(settings_ACU.plotSettings as any, '继续前进');
    const transportCalls = fixture.fetchMock.mock.calls.filter((call: any[]) => String(call[0]).includes('127.0.0.1:43111'));
    expect(transportCalls).toHaveLength(1);
    const messages = JSON.parse(String(transportCalls[0][1]?.body || '{"messages":[]}')).messages as Array<{ role: string; content: string }>;
    const contextMessages = messages.filter(message => message.content.includes('[[ACU_WORLD_SIMULATION_CONTEXT]]')
      || message.content.includes('"historyMilestones"'));
    expect(contextMessages).toHaveLength(1);
    const allContent = messages.map(message => message.content).join('\n');
    for (const fact of [SAFE_FACT, LOCKED_FACT, INTERNAL_FACT, 'COLD_HISTORY_SECRET_昔日钟楼密约']) {
      expect(allContent).toContain(fact);
      expect(result.finalMessage).not.toContain(fact);
    }
    expect(allContent).toContain('"worldEvents"');
    expect(allContent).toContain('"actors"');
    expect(allContent).toContain('"historyMilestones"');
  });

  it('第二、三普通任务经真实 transport 将完整世界资料请求与公开回复写入高级工具 API 日志，关闭采集后不写入', async () => {
    const originalApiLogEnabled = isApiLogEnabled();
    clearLogs();
    try {
      const fixture = installCompletedHostFixture();
      (settings_ACU.plotSettings as any).plotTasks = [2, 3].map(stage => ({
        id: `ordinary-public-task-${stage}`, name: `普通公开任务${stage}`, stage, order: 1, maxRetries: 1, extractTags: 'plot',
        promptGroup: [{ role: 'user', content: `任务${stage}：参考 $WORLD_SIMULATION，只输出公开剧情。` }],
      }));
      setApiLogEnabled(true);

      const result = await runPlotTasksRuntime_ACU(settings_ACU.plotSettings as any, '继续前进');
      const transportCalls = fixture.fetchMock.mock.calls.filter((call: any[]) => String(call[0]).includes('127.0.0.1:43111'));
      expect(transportCalls).toHaveLength(2);
      const apiLogs = getAllLogs().filter(entry => entry.level === 'api' && entry.tag === 'API直连');
      expect(apiLogs).toHaveLength(4);
      for (const [index, stage] of [2, 3].entries()) {
        const sentMessages = JSON.parse(String(transportCalls[index][1]?.body || '{"messages":[]}')).messages as Array<{ content: string }>;
        const sentText = sentMessages.map(message => message.content).join('\n');
        const requestLog = apiLogs[index * 2].message;
        const replyLog = apiLogs[index * 2 + 1].message;
        expect(sentText).toContain(`任务${stage}：参考`);
        expect(requestLog).toContain(`任务${stage}：参考`);
        for (const background of [SAFE_FACT, LOCKED_FACT, INTERNAL_FACT, 'COLD_HISTORY_SECRET_昔日钟楼密约']) {
          expect(sentText).toContain(background);
          expect(requestLog).toContain(background);
        }
        expect(replyLog).toContain('回复 HTTP 200');
        expect(replyLog).toContain(PUBLIC_RESULT);
      }
      expect(JSON.stringify(getAllLogs())).not.toContain('test-key');
      expect(result.finalMessage).toContain('公开剧情继续推进。');

      clearLogs();
      setApiLogEnabled(false);
      const disabledResult = await runPlotTasksRuntime_ACU(settings_ACU.plotSettings as any, '继续前进');
      expect(fixture.fetchMock.mock.calls.filter((call: any[]) => String(call[0]).includes('127.0.0.1:43111'))).toHaveLength(4);
      expect(disabledResult.finalMessage).toEqual(result.finalMessage);
      expect(getAllLogs().filter(entry => entry.level === 'api')).toEqual([]);
    } finally {
      setApiLogEnabled(originalApiLogEnabled);
      clearLogs();
    }
  });

  it('普通剧情关闭时不触发任何私有、场景审查或公开任务 AI 调用', async () => {
    const fixture = installCompletedHostFixture();
    setOrdinaryPlotSettings(false);

    const result = await runPlotTasksRuntime_ACU(settings_ACU.plotSettings as any, '继续前进');

    const apiCalls = fixture.fetchMock.mock.calls.filter((call: any[]) => String(call[0]).includes('127.0.0.1:43111'));
    expect(result).toEqual({
      finalMessage: null, successfulResults: [], failedResults: [], aggregatedTags: new Map(), enabledTaskCount: 0, internalTaskCount: 0,
    });
    expect(apiCalls).toHaveLength(0);
  });
});
