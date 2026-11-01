import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallAIChatTurn_ACU, mockWorldbookSnapshot_ACU, confirmRegistration, sceneTokenCounter, sceneTokenCounterEnabled } = vi.hoisted(() => ({
  mockCallAIChatTurn_ACU: vi.fn(),
  mockWorldbookSnapshot_ACU: vi.fn(async () => ({ available: true as const, entries: [] })),
  confirmRegistration: vi.fn(async () => true),
  sceneTokenCounter: vi.fn<(text: string) => Promise<number>>(),
  sceneTokenCounterEnabled: { value: false },
}));
vi.mock('../../../src/service/simulation/agent/agent-token-budget', async importOriginal => {
  const original = await importOriginal<typeof import('../../../src/service/simulation/agent/agent-token-budget')>();
  return { ...original, countWorldSimulationTokens_ACU: (text: string) => sceneTokenCounterEnabled.value
    ? sceneTokenCounter(text) : original.countWorldSimulationTokens_ACU(text) };
});
vi.mock('../../../src/presentation/theme/confirm-actor-registration', () => ({
  confirmWorldActorRegistration_ACU: confirmRegistration,
}));

vi.mock('../../../src/service/ai/api-call', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/service/ai/api-call')>(),
  callAIChatTurn_ACU: mockCallAIChatTurn_ACU,
}));
vi.mock('../../../src/service/continuation/agent/agent-worldbook-read', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/service/continuation/agent/agent-worldbook-read')>(),
  loadAgentWorldbookSnapshot_ACU: mockWorldbookSnapshot_ACU,
}));

import { getWorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { _set_currentJsonTableData_ACU, currentJsonTableData_ACU } from '../../../src/service/runtime/state-manager';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { prepareWorldExecutionRecall_ACU, readWorldExecutionRecall_ACU } from '../../../src/service/simulation/world-execution-recall';
import { readWorldRoundPayload_ACU } from '../../helpers/world-round-payload';
import { readWorldSimulationConversation_ACU } from '../../../src/service/simulation/agent/agent-conversation-store';
import { WORLD_SIMULATION_PROJECTION_MARKERS_ACU } from '../../../src/service/simulation/simulation-projection';

function actor() {
  return { id: 'guard', name: '守卫', interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: ['待命'], constraints: [], informationSources: [],
    knownFacts: [], visibility: 'hidden' as const, currentAction: null, shortTermAction: null, longTermAction: null,
    simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1 };
}

function seedRetainedColdFact(envelope: ReturnType<typeof buildDefaultWorldSimulationEnvelope_ACU>) {
  envelope.ledger.factArchive = [{ id: 'old-cold', summary: '已冷藏的封街事实', temporalKind: 'condition', happenedAt: null,
    validFrom: { day: 1, slot: '' }, validUntil: { day: 1, slot: '' }, locationRef: null, actorIds: [], worldEventIds: [],
    projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: ['旧来源'], evidenceRefs: [],
    supersedesFactIds: [], revision: 1 }];
  envelope.ledger.factArchiveRetention = { completedRounds: 10, enteredAtRound: { 'old-cold': 0 } };
  envelope.ledger.facts = [{ ...envelope.ledger.factArchive[0], id: 'current-secret', summary: '仍有效的秘密', temporalKind: 'occurrence',
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, projectionPolicy: 'gated', supersedesFactIds: ['old-cold'] }];
  envelope.ledger.historyMilestones = [{ id: 'old-history', summary: '旧封街留下的历史', happenedAt: { day: 1, slot: '' },
    actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: ['old-cold'], importance: 3, category: '历史',
    visibility: 'internal', revision: 1, legacyRefs: [] }];
}

function protocolInput(messages: readonly { content: string }[]): Record<string, any> {
  return readWorldRoundPayload_ACU(messages);
}

function deliveredTables(messages: readonly { content: string }[]): unknown {
  const blocks = messages.flatMap(message => {
    try { return [JSON.parse(message.content) as Record<string, unknown>]; } catch { return []; }
  });
  return blocks.find(block => Object.prototype.hasOwnProperty.call(block, 'WORLD_TABLES'))?.WORLD_TABLES;
}

function worldTableData() {
  const sheet = (uid: string, name: string, content: string[][], orderNo: number) => ({
    uid, name, content, sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo,
  });
  return {
    mate: { type: 'acu', version: 1 },
    sheet_0: sheet('world_state', '全局表', [['row_id', '日期', '位置'], ['1', '第一日', '钟楼']], 0),
    sheet_1: sheet('people', '人物表', [['row_id', '姓名', '目标'], ['1', '守卫', '巡查钟楼']], 1),
    sheet_2: sheet('chronicle', '纪要表', [['row_id', '事件', '说明'], ['1', '北门关闭', '{{danger}}/$WORLD_TASK 保留原文']], 2),
  };
}

function worldTableRows(data: ReturnType<typeof worldTableData>) {
  return Object.entries(data).filter(([key]) => key.startsWith('sheet_')).map(([sheetKey, sheet]) => ({
    sheetKey, name: sheet.name, content: sheet.content,
  }));
}

function responseFor(data: Record<string, any>): string {
  if (data.stage === 'world-narrative-review-v1') return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
  if (data.stage === 'world-review-maintenance-v1') return JSON.stringify({});
  if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: { day: 2, slot: '', storyTime: '第二日', precision: 'exact', evidenceRefs: [] } });
  if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [] });
  if (data.stage === 'recall-selection') {
    return JSON.stringify({ selections: (data.directory.actorIds as string[]).map(actorId => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'actor' })),
      worldSelection: { worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'world' } });
  }
  if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [], factWrites: [] });
  if (data.stage === 'actor-batch') {
    return JSON.stringify({ actorWrites: [{ value: { ...actor(), revision: 2,
      currentAction: { text: '巡查钟楼', expectedDuration: '片刻', startedAtDay: 999, startedAt: '模型自填时间' },
    }, expectedRevision: 1 }], factWrites: [], historyMilestoneWrites: [],
      actorCompletions: (data.actorIds as string[]).map(actorId => ({ actorId, completion: 'changed', expectedRevision: 1 })) });
  }
  throw new Error(`未知生产 runner stage: ${data.stage}`);
}

const previousWorldTableCache = currentJsonTableData_ACU;

describe('production world delivery factory', () => {
  beforeEach(() => {
    mockCallAIChatTurn_ACU.mockReset();
    sceneTokenCounter.mockReset();
    sceneTokenCounterEnabled.value = false;
    mockWorldbookSnapshot_ACU.mockClear();
    confirmRegistration.mockReset();
    confirmRegistration.mockResolvedValue(true);
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => ({
      content: responseFor(protocolInput(messages)), toolCalls: [],
    }));
  });
  afterEach(() => {
    sceneTokenCounterEnabled.value = false;
    _set_currentJsonTableData_ACU(previousWorldTableCache);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _set_SillyTavern_API_ACU(undefined);
  });

  it.each([false, true])('正式 runtime.deleteActor 已存在人物，保存失败=%s 保留权威快照与事件历史', async failSave => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.actors = [actor(), { ...actor(), id: 'lamplighter', name: '巡灯人' }];
    envelope.ledger.facts = [{ id: 'shared-fact', summary: '守卫与巡灯人曾同行', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: ['guard', 'lamplighter'], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    envelope.ledger.historyMilestones = [{ id: 'old-history', summary: '两人曾同行', happenedAt: { day: 1, slot: '' },
      actorIds: ['guard', 'lamplighter'], worldEventIds: [], locationRef: null, sourceFactIds: ['shared-fact'],
      importance: 2, category: '同行', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const body = '守卫与巡灯人曾在钟楼同行。';
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 75, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => {
      if (failSave && chat[0]._qrf_world_simulation.ledger.actors.length === 1) throw new Error('delete save failed');
      remote = structuredClone(chat);
    });
    _set_SillyTavern_API_ACU({ chat, chatId: `delete-actor-${failSave}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'delete.png', name: '测试角色' }], getCurrentChatId: () => `delete-actor-${failSave}`,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const runtime = getWorldSimulationRuntime_ACU();
    const before = structuredClone(runtime.readUiSnapshot());
    if (failSave) await expect(runtime.deleteActor('guard')).rejects.toThrow();
    else await runtime.deleteActor('guard');
    expect(save).toHaveBeenCalled();
    if (failSave) {
      expect(remote[0]._qrf_world_simulation.ledger).toEqual(envelope.ledger);
      expect(runtime.readUiSnapshot().envelope!.ledger).toEqual(before.envelope!.ledger);
    } else {
      const current = runtime.readUiSnapshot();
      expect(current.envelope!.ledger.actors.map(item => item.id)).toEqual(['lamplighter']);
      expect(current.envelope!.ledger.facts).toMatchObject([{ id: 'shared-fact', actorIds: ['lamplighter'] }]);
      expect(current.envelope!.ledger.historyMilestones).toMatchObject([{ id: 'old-history', actorIds: ['lamplighter'] }]);
      expect(remote[0]._qrf_world_simulation.ledger).toEqual(current.envelope!.ledger);
      expect(remote[1].mes).toBe(body);
    }
    expect(confirmRegistration).not.toHaveBeenCalled();
  });

  it.each([false, true])('正式 runtime.deleteWorldEvent 保存失败=%s 保留旧快照与正文', async failSave => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.worldEvents = [{ id: 'old-event', title: '旧事', state: '进行中', status: 'active',
      actorIds: [], organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null,
      relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null },
    { id: 'next-event', title: '另一件事', state: '待办', status: 'scheduled', actorIds: [], organizationIds: [],
      locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: ['old-event'],
      loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
    envelope.ledger.facts = [{ id: 'fact', summary: '原文仍存', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: ['old-event'], projectionPolicy: 'gated', revealState: 'locked',
      revealGate: { worldEventIds: ['old-event'], semanticCondition: '保密' }, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    envelope.ledger.historyMilestones = [{ id: 'history', summary: '发生过的历史', happenedAt: { day: 1, slot: '' },
      actorIds: [], worldEventIds: ['old-event'], locationRef: null, sourceFactIds: ['fact'], importance: 1,
      category: '事件', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const body = '已经发生的故事正文';
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 76, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => {
      if (failSave && chat[0]._qrf_world_simulation.ledger.worldEvents.length === 1) throw new Error('save failed');
      remote = structuredClone(chat);
    });
    _set_SillyTavern_API_ACU({ chat, chatId: `delete-event-${failSave}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'event.png', name: '测试角色' }], getCurrentChatId: () => `delete-event-${failSave}`,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {} } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const runtime = getWorldSimulationRuntime_ACU();
    const before = structuredClone(runtime.readUiSnapshot().envelope!.ledger);
    if (failSave) await expect(runtime.deleteWorldEvent('old-event')).rejects.toThrow();
    else await runtime.deleteWorldEvent('old-event');
    const current = runtime.readUiSnapshot().envelope!.ledger;
    expect(save).toHaveBeenCalled();
    if (failSave) {
      expect(current).toEqual(before);
      expect(remote[0]._qrf_world_simulation.ledger).toEqual(before);
    } else {
      expect(current.worldEvents).toMatchObject([{ id: 'next-event', relatedEventIds: [] }]);
      expect(current.facts[0]).toMatchObject({ summary: '原文仍存', worldEventIds: [], revealState: 'locked',
        revealGate: null });
      expect(current.historyMilestones[0]).toMatchObject({ summary: '发生过的历史', worldEventIds: [] });
      expect(remote[0]._qrf_world_simulation.ledger).toEqual(current);
    }
    expect(remote[1].mes).toBe(body);
  });

  it.each([false, true])('正式 runtime.deleteWorldHistory 保存失败=%s 保留旧快照与正文；成功只删这条历史，冷层记录同样可删', async failSave => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const history = (id: string, extra: Record<string, unknown> = {}) => ({ id, summary: `${id} 原文`, happenedAt: { day: 1, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2, category: '事件',
      visibility: 'internal' as const, revision: 1, legacyRefs: [], ...extra });
    envelope.ledger.historyMilestones = [history('hot-history'), history('other-history')];
    envelope.ledger.historyArchive = [history('cold-history', { narrativeRecord: { status: 'recorded', recordedAt: { day: 1, slot: '' },
      anchorDigest: 'b'.repeat(64), deliveryQuote: '投送', evidenceQuote: '正文' } })];
    const body = '已经发生的故事正文';
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 77, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    let failing = failSave;
    const save = vi.fn(async () => {
      if (failing && chat[0]._qrf_world_simulation.ledger.historyMilestones.length === 1) throw new Error('save failed');
      remote = structuredClone(chat);
    });
    _set_SillyTavern_API_ACU({ chat, chatId: `delete-history-${failSave}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'history.png', name: '测试角色' }], getCurrentChatId: () => `delete-history-${failSave}`,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {} } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const runtime = getWorldSimulationRuntime_ACU();
    const before = structuredClone(runtime.readUiSnapshot().envelope!.ledger);
    if (failSave) {
      await expect(runtime.deleteWorldHistory('hot-history')).rejects.toThrow();
      expect(runtime.readUiSnapshot().envelope!.ledger).toEqual(before);
      expect(remote[0]._qrf_world_simulation.ledger).toEqual(before);
      failing = false;
    }
    await runtime.deleteWorldHistory('hot-history');
    let current = runtime.readUiSnapshot().envelope!.ledger;
    expect(current.historyMilestones.map(item => item.id)).toEqual(['other-history']);
    expect(current.historyMilestones[0]).toEqual(before.historyMilestones[1]);
    expect(current.historyArchive).toEqual(before.historyArchive);
    expect(remote[0]._qrf_world_simulation.ledger).toEqual(current);
    await runtime.deleteWorldHistory('cold-history');
    current = runtime.readUiSnapshot().envelope!.ledger;
    expect(current.historyArchive).toEqual([]);
    expect(current.historyMilestones.map(item => item.id)).toEqual(['other-history']);
    expect(remote[0]._qrf_world_simulation.ledger).toEqual(current);
    expect(remote[1].mes).toBe(body);
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 锚点 V2 checkpoint 全表逐阶段投送，不读取未来楼层或旧缓存', async (workflowMode, deliveryTarget) => {
    const original = worldTableData();
    const frame = { version: 2, headRevision: 'checkpoint:world-tables', checkpoint: {
      kind: 'full', createdAt: 1, reason: 'init', data: structuredClone(original),
      event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
    }, logEntries: [] };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.settings.worldRoundPrompts = Object.fromEntries([
      'clock-recaller', 'world-simulator', 'world-event-analyst', 'actor-simulator',
    ].map(role => [role, [{ role: 'system', content: `NO_TOKEN_CUSTOM_${role}`, enabled: true,
      deletable: true, pinned: false }]]));
    envelope.ledger.actors = [actor()];
    mockWorldbookSnapshot_ACU.mockResolvedValueOnce({ available: true, entries: [{
      bookName: '钟楼设定', uid: 'guard-entry', title: '守卫职责', keys: ['钟楼'], constant: false,
      preventRecursion: false, excludeRecursion: false, content: '守卫负责钟楼巡查。', tokens: 12,
    }] });
    const chat: any[] = [{ _qrf_world_simulation: envelope,
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame } } },
      { is_user: false, message_id: 631, mes: '守卫在钟楼下待命。', swipe_id: 0 }];
    const future = worldTableData();
    future.sheet_0.content[1][2] = '未来位置不能进入上一楼层';
    chat.push({ is_user: true, message_id: 632, mes: '未来消息。', swipe_id: 0,
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: {
        version: 2, headRevision: 'checkpoint:future', checkpoint: { kind: 'full', createdAt: 2,
          reason: 'init', data: future, event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] } }, logEntries: [],
      } } } });
    const cache = worldTableData();
    cache.sheet_1.content[1][2] = '旧缓存目标不能送给格林';
    _set_currentJsonTableData_ACU(cache);
    const originalFrame = structuredClone(chat[0].TavernDB_ACU_IsolatedData);
    let remote = structuredClone(chat);
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    const chatId = `table-context-${workflowMode}-${deliveryTarget}`;
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'table-context.png', name: '表格角色' }], getCurrentChatId: () => chatId,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('根据钟楼实况推进', 'table-context');
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed' });
    const expected = worldTableRows(original);
    const requests = mockCallAIChatTurn_ACU.mock.calls.map(([messages]) => messages as Array<{ content: string }>);
    expect(new Set(requests.map(messages => protocolInput(messages).stage))).toEqual(new Set([
      ...(deliveryTarget === 'body' ? ['world-narrative-review-v1'] : []),
      'clock-candidate', 'worldbook-selection', 'recall-selection', 'world-page', 'actor-batch',
    ]));
    for (const messages of requests) {
      if (protocolInput(messages).stage !== 'world-narrative-review-v1') expect(deliveredTables(messages)).toEqual(expected);
      expect(JSON.stringify(messages)).not.toContain('旧缓存目标不能送给格林');
      expect(JSON.stringify(messages)).not.toContain('未来位置不能进入上一楼层');
    }
    expect(chat[0].TavernDB_ACU_IsolatedData).toEqual(originalFrame);
    expect(remote[0].TavernDB_ACU_IsolatedData).toEqual(originalFrame);
    expect(chat[0]._qrf_world_simulation.ledger).toMatchObject({ clock: { day: 2 }, actors: [{ id: 'guard', revision: 2 }] });
    expect(save).toHaveBeenCalled();
    expect(chat[1].mes).toBe('守卫在钟楼下待命。');
  });

  it.each(['single', 'layered'] as const)('%s/body 正式工厂长正文联合审查输入超过旧上限仍按冻结配置调用并远端保存', async workflowMode => {
    const anchorMarker = 'SCENE_LONG_ANCHOR_BOUNDARY';
    const promptMarker = 'SCENE_CUSTOM_JOINT_BOUNDARY';
    const body = `${anchorMarker}守卫在钟楼记录巡查。${'钟楼的灯火尚未熄灭。'.repeat(1400)}`;
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = 'body';
    envelope.settings.agentHistoryTokenBudget = 30000;
    envelope.settings.agentReadTokenBudget = 20000;
    envelope.settings.worldRoundPrompts = { 'joint-reviewer': [{ role: 'system',
      content: `${promptMarker}仅依据已冻结正文判断接触。${'请保留场景证据。'.repeat(900)} $ANCHOR_MESSAGE $READ_BUDGET`,
      enabled: true, deletable: true, pinned: false }] };
    envelope.ledger.actors = [actor()];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 912, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    const chatId = `scene-long-budget-${workflowMode}`;
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'scene-long.png', name: '测试角色' }], getCurrentChatId: () => chatId,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    sceneTokenCounterEnabled.value = true;
    const validSceneReply = JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
    sceneTokenCounter.mockImplementation(async text => text.includes(anchorMarker) && text.includes(promptMarker)
      ? 9000 : text === validSceneReply ? 29000 : 1);
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', 'long-scene-budget');
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed', identity: { workflowMode, deliveryTarget: 'body' } });
    const sceneRequests = mockCallAIChatTurn_ACU.mock.calls
      .map(([messages]) => messages as Array<{ content: string }>)
      .filter(messages => protocolInput(messages).stage === 'world-narrative-review-v1');
    expect(sceneRequests).toHaveLength(1);
    for (const messages of sceneRequests) {
      const payloadText = JSON.stringify(messages);
      expect(payloadText).toContain(anchorMarker);
      expect(payloadText).toContain(promptMarker);
      expect(payloadText.length).toBeGreaterThan(8192);
      const budgetBlock = messages.map(message => {
        try { return JSON.parse(message.content).READ_BUDGET; } catch { return undefined; }
      }).find(Boolean);
      expect(budgetBlock).toMatchObject({ inputTokenBudget: 30000 });
    }
    expect(sceneTokenCounter.mock.calls.filter(([text]) => text.includes(anchorMarker) && text.includes(promptMarker))).not.toHaveLength(0);
    expect(save).toHaveBeenCalled();
    expect(remote[0]._qrf_world_simulation.task.status).toBe('completed');
    expect(remote[0]._qrf_world_simulation.ledger.actors).toMatchObject([{ id: 'guard', revision: 2 }]);
    expect(remote[0]._qrf_world_simulation.settings.agentHistoryTokenBudget).toBe(30000);
    expect(remote[1].mes).toBe(body);
  });

  it('正式工厂 scene 输入超过用户配置时在模型调用前明确拒绝，不提交业务账本', async () => {
    const anchorMarker = 'SCENE_OVER_CONFIG_ANCHOR';
    const promptMarker = 'SCENE_OVER_CONFIG_PROMPT';
    const body = `${anchorMarker}${'守卫在钟楼巡查。'.repeat(1200)}`;
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = 'single';
    envelope.settings.deliveryTarget = 'body';
    envelope.settings.agentHistoryTokenBudget = 8000;
    envelope.settings.agentReadTokenBudget = 20000;
    envelope.settings.worldRoundPrompts = { 'joint-reviewer': [{ role: 'system', content: `${promptMarker} $ANCHOR_MESSAGE`,
      enabled: true, deletable: true, pinned: false }] };
    envelope.ledger.actors = [actor()];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 913, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, getCurrentChatId: () => 'scene-over-config',
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    sceneTokenCounterEnabled.value = true;
    sceneTokenCounter.mockImplementation(async text => text.includes(anchorMarker) && text.includes(promptMarker) ? 9000 : 1);
    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进', 'scene-over-config');
    expect(result).toMatchObject({ status: 'failed' });
    expect(mockCallAIChatTurn_ACU.mock.calls.some(([messages]) => protocolInput(messages).stage === 'world-narrative-review-v1')).toBe(false);
    expect(sceneTokenCounter.mock.calls.some(([text]) => text.includes(anchorMarker) && text.includes(promptMarker))).toBe(true);
    expect(remote[0]._qrf_world_simulation.ledger.revision).toBe(0);
    expect(remote[0]._qrf_world_simulation.ledger.actors).toMatchObject([{ id: 'guard', revision: 1 }]);
    expect(remote[1].mes).toBe(body);
  });

  function pruneFixture(deliveryTarget: 'body' | 'plot', chatId: string, withEvents = false) {
    const body = '主角在钟楼广场看见守卫关闭城门。';
    const place = { region: '城区', place: '钟楼广场' };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = 'layered';
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.player.location = place;
    const fact = (id: string, summary: string, projectionPolicy: 'scene' | 'internal' | 'gated', revealState: 'locked' | 'unlocked', extra: Record<string, unknown> = {}) => ({
      id, summary, temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
      locationRef: place, actorIds: [], worldEventIds: [], projectionPolicy, revealState,
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...extra,
    });
    envelope.ledger.facts = [
      fact('visible-gate', '钟楼广场的城门已经关闭。', 'scene', 'unlocked', { happenedAt: { day: 2, slot: '' } }),
      fact('stale-note', '旧的内部过程记录。', 'internal', 'locked', { locationRef: null }),
      fact('live-secret', '守卫藏有密信。', 'gated', 'locked', { locationRef: null, revealGate: { semanticCondition: '主角询问密信' } }),
    ];
    if (withEvents) {
      const event = (id: string, status: 'active' | 'paused' | 'scheduled' | 'resolved' | 'cancelled', extra: Record<string, unknown> = {}) => ({
        id, title: `事件 ${id}`, state: `状态 ${id}`, status, actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' },
        deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 2, legacy: null, ...extra });
      envelope.ledger.worldEvents = [
        event('ended-gone', 'resolved'), event('ended-held', 'cancelled'), event('still-active', 'active', { relatedEventIds: ['ended-gone'] }),
        event('still-paused', 'paused'), event('still-planned', 'scheduled'),
      ];
      envelope.ledger.facts[0] = { ...envelope.ledger.facts[0], worldEventIds: ['ended-gone'] };
      envelope.ledger.facts[2] = { ...envelope.ledger.facts[2], revealGate: { requiredEventIds: ['ended-held'], semanticCondition: '主角询问密信' } };
    }
    envelope.ledger.historyMilestones = [{ id: 'old-history', summary: '历史原文保持不变', happenedAt: { day: 1, slot: '' },
      actorIds: [], worldEventIds: withEvents ? ['ended-gone', 'still-active'] : [], locationRef: null, sourceFactIds: ['stale-note', 'live-secret'], importance: 3, category: '历史',
      visibility: 'internal', revision: 1, legacyRefs: [] }];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 301, mes: body, message: body, swipe_id: 0, swipes: [body] }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'prune.png', name: '测试角色' }], getCurrentChatId: () => chatId,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    return { chat, getRemote: () => remote, place, body };
  }
  const stageRequests = (stage: string) => mockCallAIChatTurn_ACU.mock.calls.filter(([messages]) => protocolInput(messages).stage === stage);

  it.each(['body', 'plot'] as const)('%s 投送：联合审查专员判定的无用内部管理事实经正式提交真正删除并清引用，其他类别保持不变', async deliveryTarget => {
    const f = pruneFixture(deliveryTarget, `prune-${deliveryTarget}`);
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      const prune = ['stale-note', 'visible-gate', 'ghost'];
      if (data.stage === 'world-narrative-review-v1') return { content: JSON.stringify({ locationRef: f.place, contactedActorIds: [],
        evidence: [{ kind: 'location', actorId: null, quote: '钟楼广场' }], reviews: [], pruneFactIds: prune }), toolCalls: [] };
      if (data.stage === 'world-review-maintenance-v1') return { content: JSON.stringify({ pruneFactIds: prune }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', `prune-turn-${deliveryTarget}`);
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed', identity: { deliveryTarget } });
    const persisted = f.getRemote()[0]._qrf_world_simulation.ledger;
    expect(persisted).toEqual(f.chat[0]._qrf_world_simulation.ledger);
    expect(persisted.facts.map((item: { id: string }) => item.id)).toEqual(['visible-gate', 'live-secret']);
    expect(persisted.historyMilestones).toMatchObject([{ id: 'old-history', summary: '历史原文保持不变', sourceFactIds: ['live-secret'], revision: 2 }]);
    expect(stageRequests('world-narrative-review-v1')).toHaveLength(deliveryTarget === 'body' ? 1 : 0);
    expect(stageRequests('world-review-maintenance-v1')).toHaveLength(deliveryTarget === 'body' ? 0 : 1);
    const candidates = (protocolInput((deliveryTarget === 'body' ? stageRequests('world-narrative-review-v1') : stageRequests('world-review-maintenance-v1'))[0][0]).pruneCandidates as Array<{ id: string }>);
    expect(candidates.map(item => item.id)).toEqual(['live-secret', 'stale-note']);
    if (deliveryTarget === 'body') {
      expect(f.getRemote()[1].mes.startsWith(f.body)).toBe(true);
      expect(f.getRemote()[1].mes).toContain('钟楼广场的城门已经关闭。');
      expect(f.getRemote()[1].mes).not.toContain('旧的内部过程记录');
    } else {
      expect(f.getRemote()[1].mes).toBe(f.body);
    }
  });

  it.each(['body', 'plot'] as const)('%s 投送：联合审查专员判定的已结束事件经正式提交真正删除并清引用，进行中事件、被锁定秘密引用的事件与事实历史文字保持不变', async deliveryTarget => {
    const f = pruneFixture(deliveryTarget, `prune-event-${deliveryTarget}`, true);
    const prune = ['ended-gone', 'ended-held', 'still-active', 'still-paused', 'still-planned', 'ghost'];
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'world-narrative-review-v1') return { content: JSON.stringify({ locationRef: f.place, contactedActorIds: [],
        evidence: [{ kind: 'location', actorId: null, quote: '钟楼广场' }], reviews: [], pruneEventIds: prune }), toolCalls: [] };
      if (data.stage === 'world-review-maintenance-v1') return { content: JSON.stringify({ pruneEventIds: prune }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', `prune-event-turn-${deliveryTarget}`);
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed', identity: { deliveryTarget } });
    const persisted = f.getRemote()[0]._qrf_world_simulation.ledger;
    expect(persisted).toEqual(f.chat[0]._qrf_world_simulation.ledger);
    expect(persisted.worldEvents.map((item: { id: string }) => item.id)).toEqual(['ended-held', 'still-active', 'still-paused', 'still-planned']);
    expect(persisted.worldEvents.find((item: { id: string }) => item.id === 'still-active')).toMatchObject({ relatedEventIds: [], state: '状态 still-active', revision: 3 });
    expect(persisted.facts.map((item: { id: string }) => item.id)).toEqual(['visible-gate', 'stale-note', 'live-secret']);
    expect(persisted.facts[0]).toMatchObject({ summary: '钟楼广场的城门已经关闭。', worldEventIds: [], revision: 2 });
    expect(persisted.facts[2].revealGate).toEqual({ requiredEventIds: ['ended-held'], semanticCondition: '主角询问密信' });
    expect(persisted.historyMilestones).toMatchObject([{ id: 'old-history', summary: '历史原文保持不变', worldEventIds: ['still-active'], sourceFactIds: ['stale-note', 'live-secret'], revision: 2 }]);
    const request = (deliveryTarget === 'body' ? stageRequests('world-narrative-review-v1') : stageRequests('world-review-maintenance-v1'))[0][0];
    expect((protocolInput(request).pruneEventCandidates as Array<{ id: string }>).map(item => item.id)).toEqual(['ended-gone']);
    expect(stageRequests('world-narrative-review-v1')).toHaveLength(deliveryTarget === 'body' ? 1 : 0);
    expect(stageRequests('world-review-maintenance-v1')).toHaveLength(deliveryTarget === 'body' ? 0 : 1);
  });

  it.each(['body', 'plot'] as const)('%s 投送：联合审查专员返回的重要历史经正式提交真正保存，引用不存在的事实跳过，历史回复畸形时整轮照常保存', async deliveryTarget => {
    for (const malformed of [false, true]) {
      mockCallAIChatTurn_ACU.mockReset();
      const f = pruneFixture(deliveryTarget, `history-${deliveryTarget}-${malformed}`);
      const worldFact = { id: 'gate-closed', summary: '守卫在钟楼广场关闭了城门', temporalKind: 'occurrence', happenedAt: { day: 2, slot: '' }, validFrom: null,
        validUntil: null, locationRef: f.place, actorIds: [], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
        revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
      const history = malformed ? '垃圾文字' : [
        { value: { id: 'gate-history', summary: '城门被关闭', happenedAt: { day: 2, slot: '' }, actorIds: [], worldEventIds: [], locationRef: null,
          sourceFactIds: ['gate-closed'], importance: 3, category: '事件' }, expectedRevision: 0 },
        { value: { id: 'ghost-history', summary: '来源不存在', actorIds: [], sourceFactIds: ['no-such-fact'] }, expectedRevision: 0 },
      ];
      mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
        const data = protocolInput(messages);
        if (data.stage === 'world-page') return { content: JSON.stringify({ worldEventWrites: [], factWrites: [{ value: worldFact, expectedRevision: 0 }] }), toolCalls: [] };
        if (data.stage === 'world-narrative-review-v1') return { content: JSON.stringify({ locationRef: f.place, contactedActorIds: [],
          evidence: [{ kind: 'location', actorId: null, quote: '钟楼广场' }], reviews: [], historyMilestoneWrites: history }), toolCalls: [] };
        if (data.stage === 'world-review-maintenance-v1') return { content: JSON.stringify({ historyMilestoneWrites: history }), toolCalls: [] };
        return { content: responseFor(data), toolCalls: [] };
      });
      const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', `history-turn-${deliveryTarget}-${malformed}`);
      if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
      expect(outcome).toMatchObject({ status: 'completed', identity: { deliveryTarget } });
      const persisted = f.getRemote()[0]._qrf_world_simulation.ledger;
      expect(persisted).toEqual(f.chat[0]._qrf_world_simulation.ledger);
      expect(persisted.facts.map((item: { id: string }) => item.id)).toContain('gate-closed');
      const ids = persisted.historyMilestones.map((item: { id: string }) => item.id).sort();
      expect(ids).toEqual(malformed ? ['old-history'] : ['gate-history', 'old-history']);
      if (!malformed) {
        expect(persisted.historyMilestones.find((item: { id: string }) => item.id === 'gate-history')).toMatchObject({
          summary: '城门被关闭', sourceFactIds: ['gate-closed'], visibility: 'internal', revision: 1 });
      }
      const reviewStage = deliveryTarget === 'body' ? 'world-narrative-review-v1' : 'world-review-maintenance-v1';
      expect(stageRequests(reviewStage)).toHaveLength(1);
      expect(stageRequests(deliveryTarget === 'body' ? 'world-review-maintenance-v1' : 'world-narrative-review-v1')).toHaveLength(0);
      const request = protocolInput(stageRequests(reviewStage)[0][0]);
      expect((request.historyChanges as { facts: Array<{ id: string }> }).facts.map(item => item.id)).toEqual(['gate-closed']);
      expect((request.historyCatalog as Array<{ id: string }>).map(item => item.id)).toEqual(['old-history']);
    }
  });

  it('plot 投送事件清理回复无法解析时整轮仍正常保存，事件原样保留', async () => {
    const f = pruneFixture('plot', 'prune-event-unparsable', true);
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'world-review-maintenance-v1') return { content: '这不是 JSON', toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', 'prune-event-turn-unparsable');
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(stageRequests('world-review-maintenance-v1')).toHaveLength(1);
    const persisted = f.getRemote()[0]._qrf_world_simulation.ledger;
    expect(persisted.worldEvents.map((item: { id: string }) => item.id)).toEqual(['ended-gone', 'ended-held', 'still-active', 'still-paused', 'still-planned']);
    expect(persisted).toEqual(f.chat[0]._qrf_world_simulation.ledger);
  });

  it('plot 投送清理回复无法解析时整轮仍正常保存，事实原样保留', async () => {
    const f = pruneFixture('plot', 'prune-unparsable');
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'world-review-maintenance-v1') return { content: '这不是 JSON', toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', 'prune-turn-unparsable');
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(stageRequests('world-review-maintenance-v1')).toHaveLength(1);
    const persisted = f.getRemote()[0]._qrf_world_simulation.ledger;
    expect(persisted.facts.map((item: { id: string }) => item.id)).toEqual(['visible-gate', 'stale-note', 'live-secret']);
    expect(persisted.historyMilestones[0].sourceFactIds).toEqual(['stale-note', 'live-secret']);
    expect(persisted).toEqual(f.chat[0]._qrf_world_simulation.ledger);
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 正式 runner 联合审查后仅把已授权 scene 事实随账本保存到宿主正文', async (workflowMode, deliveryTarget) => {
    const body = '主角在钟楼广场看见守卫关闭城门。';
    const sceneSummary = '钟楼广场的城门已经关闭。';
    const lockedSummary = '守卫在城门下藏有密信原件。';
    const internalSummary = '远方仓库正在暗中转移物资。';
    const place = { region: '城区', place: '钟楼广场' };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.player.location = place;
    const fact = (id: string, summary: string, projectionPolicy: 'scene' | 'internal' | 'gated', revealState: 'locked' | 'unlocked') => ({
      id, summary, temporalKind: 'occurrence' as const, happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null,
      locationRef: place, actorIds: [], worldEventIds: [], projectionPolicy, revealState,
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    });
    envelope.ledger.facts = [fact('visible-gate', sceneSummary, 'scene', 'unlocked'),
      fact('locked-letter', lockedSummary, 'gated', 'locked'), fact('internal-transfer', internalSummary, 'internal', 'unlocked')];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 212, mes: body,
      message: body, swipe_id: 0, swipes: [body] }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    const chatId = `reviewed-scene-${workflowMode}-${deliveryTarget}`;
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'scene.png', name: '测试角色' }], getCurrentChatId: () => chatId,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'world-narrative-review-v1') return { content: JSON.stringify({ locationRef: place,
        contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '钟楼广场' }], reviews: [],
      }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼', 'reviewed-scene');
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed', identity: { workflowMode, deliveryTarget } });
    expect(save).toHaveBeenCalled();
    expect(remote[0]._qrf_world_simulation.task.status).toBe('completed');
    expect(remote[0]._qrf_world_simulation.ledger).toEqual(chat[0]._qrf_world_simulation.ledger);
    expect(remote[0]._qrf_world_simulation.ledger.facts).toMatchObject([
      { id: 'visible-gate', revealState: 'unlocked' }, { id: 'locked-letter', revealState: 'locked' },
      { id: 'internal-transfer', revealState: 'unlocked' },
    ]);
    if (deliveryTarget === 'body') {
      expect(remote[1].mes.startsWith(body)).toBe(true);
      expect(remote[1].mes).toContain(WORLD_SIMULATION_PROJECTION_MARKERS_ACU.start);
      expect(remote[1].mes).toContain('<div hidden');
      expect(remote[1].mes).toContain('<与此同时>');
      expect(remote[1].mes).toContain(sceneSummary);
      expect(remote[1].message).toBe(remote[1].mes);
      expect(remote[1].swipes[0]).toBe(remote[1].mes);
      expect(chat[1].mes).toBe(remote[1].mes);
    } else {
      expect(remote[1].mes).toBe(body);
      expect(remote[1].message).toBe(body);
      expect(remote[1].swipes).toEqual([body]);
    }
    expect(remote[1].mes).not.toContain(lockedSummary);
    expect(remote[1].mes).not.toContain(internalSummary);
    expect(mockCallAIChatTurn_ACU.mock.calls.filter(([messages]) => protocolInput(messages).stage === 'world-narrative-review-v1'))
      .toHaveLength(deliveryTarget === 'body' ? 1 : 0);
  });

  it.each([
    ['single', 'body'],
    ['single', 'plot'],
    ['layered', 'body'],
    ['layered', 'plot'],
  ] as const)('工厂 runtime 在 %s/%s 仅使用当前聊天与数据库保存接口，不依赖角色文件字段', async (workflowMode, deliveryTarget) => {
    const chat: any[] = [{}, { is_user: false, message_id: 41, mes: '守卫在钟楼下待命。', swipe_id: 0 }];
    let remote = structuredClone(chat);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.settings.worldRoundPrompts = Object.fromEntries([
      'clock-recaller', 'world-simulator', 'world-event-analyst', 'actor-simulator', 'joint-reviewer',
    ].map(role => [role, [{ role: 'system', content: `USER_CUSTOM_${role}`, enabled: true, deletable: true, pinned: false },
      { role: 'user', content: `DISABLED_CUSTOM_${role}`, enabled: false, deletable: true, pinned: false }]]));
    envelope.ledger.actors = [actor()];
    seedRetainedColdFact(envelope);
    chat[0]._qrf_world_simulation = envelope;
    _set_SillyTavern_API_ACU({ chat, getCurrentChatId: () => `production-factory-${workflowMode}-${deliveryTarget}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
      getRequestHeaders: () => ({}),
      extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    const fetchChat = vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] }));
    vi.stubGlobal('fetch', fetchChat);

    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进钟楼外的世界', 'factory-turn');

    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed', identity: { workflowProtocol: 'world-round-v1', workflowMode, deliveryTarget } });
    expect(mockWorldbookSnapshot_ACU).toHaveBeenCalledOnce();
    expect(mockCallAIChatTurn_ACU).toHaveBeenCalled();
    expect(fetchChat).not.toHaveBeenCalled();
    const requests = mockCallAIChatTurn_ACU.mock.calls.map(([messages]) => messages as Array<{ content: string }>);
    const actorRequest = requests.find(messages => protocolInput(messages).stage === 'actor-batch');
    expect(actorRequest).toBeDefined();
    expect(actorRequest![0].content).toContain(workflowMode === 'single' ? 'world-simulator' : 'actor-simulator');
    expect(actorRequest![0].content).toContain('动作起止时间由程序按 candidateClock 盖戳');
    expect(actorRequest![0].content).toContain('不手动追加 experiences');
    const actorRole = workflowMode === 'single' ? 'world-simulator' : 'actor-simulator';
    expect(actorRequest!.map(message => message.content)).toContain(`USER_CUSTOM_${actorRole}`);
    const clockRequest = requests.find(messages => protocolInput(messages).stage === 'clock-candidate')!;
    expect(clockRequest.map(message => message.content)).toContain('USER_CUSTOM_clock-recaller');
    if (deliveryTarget === 'body') {
      const jointRequest = requests.find(messages => protocolInput(messages).stage === 'world-narrative-review-v1')!;
      expect(jointRequest.map(message => message.content)).toContain('USER_CUSTOM_joint-reviewer');
    }
    expect(JSON.stringify(clockRequest)).not.toContain('USER_CUSTOM_actor-simulator');
    expect(JSON.stringify(requests)).not.toContain('DISABLED_CUSTOM_');
    expect(chat[0]._qrf_world_simulation.task.runMaterials.promptsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(remote[0]._qrf_world_simulation.settings.worldRoundPrompts).toEqual(envelope.settings.worldRoundPrompts);
    expect(requests.filter(messages => protocolInput(messages).stage === 'world-narrative-review-v1'))
      .toHaveLength(deliveryTarget === 'body' ? 1 : 0);
    expect(chat[0]._qrf_world_simulation).toMatchObject({ task: { status: 'completed', completedRun: {
      workflowProtocol: 'world-round-v1', workflowMode, deliveryTarget,
    } }, ledger: { revision: 1, clock: { day: 2 }, actors: [{ id: 'guard', revision: 2,
      currentAction: { text: '巡查钟楼', startedAtDay: 2, startedAt: '第二日' },
    }] } });
    expect(remote[0]._qrf_world_simulation.ledger.actors[0].currentAction).toEqual(chat[0]._qrf_world_simulation.ledger.actors[0].currentAction);
    const persisted = remote[0]._qrf_world_simulation.ledger;
    expect(persisted.factArchive).toEqual([]);
    expect(persisted.factArchiveRetention).toEqual({ completedRounds: 11, enteredAtRound: {} });
    expect(persisted.facts).toMatchObject([{ id: 'current-secret', revealState: 'locked', supersedesFactIds: [] }]);
    expect(persisted.historyMilestones).toMatchObject([{ id: 'old-history', sourceFactIds: [] }]);
    expect(chat[0]._qrf_world_simulation.ledger).toEqual(persisted);
    expect(chat[1].mes).toBe('守卫在钟楼下待命。');
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 世界日期与字符串地点归一后同轮补登正文人物，远端事实与正文完整保存', async (workflowMode, deliveryTarget) => {
    const body = '守卫与巡灯人一同查看钟楼告示。';
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.clock = { ...envelope.ledger.clock, day: 5, storyTime: '2025-04-10', precision: 'exact' };
    envelope.ledger.actors = [actor()];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 214, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const chatId = `world-normalization-${workflowMode}-${deliveryTarget}`;
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'normalization.png', name: '测试角色' }], getCurrentChatId: () => chatId,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let checkedOverlay = false;
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'clock-candidate') return { content: JSON.stringify({ candidateClock: {
        ...envelope.ledger.clock, day: 6, storyTime: '2025-04-11',
      } }), toolCalls: [] };
      if (data.stage === 'world-page') return { content: JSON.stringify({
        worldEventWrites: [{ expectedRevision: 0, value: {
          id: 'bell-notice', title: '钟楼告示', state: '守卫准备张贴告示', status: 'active',
          actorIds: [], organizationIds: null, locationRefs: ['钟楼'],
          startedAt: '2025-04-11T09:00:00+08:00', deadline: '2025-04-13T09:00:00+08:00',
          nextCheck: { day: 7, slot: '' }, relatedEventIds: null, loreRefs: null,
          evidenceRefs: null, tags: null, revision: 0, legacy: false,
        } }],
        factWrites: [{ expectedRevision: 0, value: {
          id: 'notice-posted', summary: '钟楼告示已经备妥', temporalKind: 'condition',
          happenedAt: '2025-04-11T09:00:00+08:00', validFrom: '2025-04-11T09:00:00+08:00',
          validUntil: '2025-04-13T09:00:00+08:00', locationRef: '钟楼', actorIds: null,
          worldEventIds: ['bell-notice'], projectionPolicy: 'internal', revealState: 'locked',
          revealGate: null, nextCheck: { day: 7, slot: '' }, sourceRefs: null,
          evidenceRefs: null, supersedesFactIds: null, revision: 0,
        } }],
      }), toolCalls: [] };
      if (data.stage === 'actor-batch') {
        expect(data.allowActorRegistrations).toBe(true);
        expect(data.registrationRoster).toEqual([{ id: 'guard', name: '守卫', simulationStatus: 'active' }]);
        expect(data.worldOverlay).toMatchObject({
          worldEvents: [{ id: 'bell-notice', startedAt: { day: 6, slot: '09:00:00' },
            deadline: { day: 8 }, locationRefs: [{ region: '钟楼' }], legacy: null,
            nextCheck: { day: 7, reason: expect.any(String) }, revision: 1 }],
          facts: [{ id: 'notice-posted', temporalKind: 'condition', happenedAt: null,
            validFrom: { day: 6, slot: '09:00:00' }, validUntil: { day: 8 },
            locationRef: { region: '钟楼' }, nextCheck: { day: 7, reason: expect.any(String) }, revision: 1 }],
        });
        checkedOverlay = true;
        return { content: JSON.stringify({ actorWrites: [], actorCompletions: [{ actorId: 'guard', completion: 'no_change', expectedRevision: 1 }],
          actorRegistrations: [{ expectedRevision: 0, evidenceQuote: '巡灯人一同查看钟楼告示',
            value: { ...actor(), id: 'lamplighter', name: '巡灯人', goals: ['协助张贴告示'], revision: 0 } }],
          factWrites: [], historyMilestoneWrites: [],
        }), toolCalls: [] };
      }
      return { content: responseFor(data), toolCalls: [] };
    });

    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('继续钟楼值守', 'world-normalized');
    if (result?.status === 'failed') throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({ status: 'completed' });
    expect(checkedOverlay).toBe(true);
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(confirmRegistration.mock.calls[0][0]).toMatchObject({ id: 'lamplighter', name: '巡灯人' });
    expect(confirmRegistration.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(save).toHaveBeenCalled();
    const ledger = remote[0]._qrf_world_simulation.ledger;
    expect(ledger).toEqual(chat[0]._qrf_world_simulation.ledger);
    expect(ledger.worldEvents).toMatchObject([{ id: 'bell-notice', revision: 1, legacy: null,
      startedAt: { day: 6, slot: '09:00:00' }, deadline: { day: 8 }, locationRefs: [{ region: '钟楼' }] }]);
    expect(ledger.facts).toMatchObject([{ id: 'notice-posted', revision: 1, happenedAt: null,
      validFrom: { day: 6 }, validUntil: { day: 8 }, locationRef: { region: '钟楼' }, worldEventIds: ['bell-notice'] }]);
    expect(ledger.actors).toContainEqual(expect.objectContaining({ id: 'lamplighter', name: '巡灯人', revision: 1 }));
    expect(remote[1].mes).toBe(body);
    expect(chat[1].mes).toBe(body);
  });

  it.each(['body', 'plot'] as const)('%s 实际日志形状：省略空写集的登记与宿主元数据变化仍成功保存', async deliveryTarget => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.deliveryTarget = deliveryTarget;
    const body = '守卫来到钟楼。';
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 213, mes: body,
      swipe_id: 0, swipes: ['旧的展示副本'], extra: { local: true } }];
    let remote = structuredClone(chat);
    const chatId = `tolerant-production-${deliveryTarget}`;
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'tolerant.png', name: '测试角色' }], getCurrentChatId: () => chatId,
      saveChat: vi.fn(async () => {
        remote = JSON.parse(JSON.stringify(chat));
        if (remote[0]._qrf_world_simulation?.ledger.actors.length) {
          remote[0]._qrf_world_simulation = Object.fromEntries(Object.entries(remote[0]._qrf_world_simulation).reverse());
          remote[0]._qrf_world_simulation.ledger = Object.fromEntries(Object.entries(remote[0]._qrf_world_simulation.ledger).reverse());
        }
        for (const message of remote) {
          message.send_date = '宿主维护字段';
          delete message.extra;
          if (message.message_id !== undefined) message.message_id = String(message.message_id);
        }
      }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ chat_metadata: {} }, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [],
        actorRegistrations: [{ value: { ...actor(), name: '守卫', deathSummary: '', resources: '钥匙',
          currentAction: '在钟楼值守', revision: 1 }, expectedRevision: 0, evidenceQuote: body }],
      }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('继续', 'tolerant-registration');
    if (result?.status === 'failed') throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({ status: 'completed' });
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(confirmRegistration.mock.calls[0][0]).toMatchObject({ id: 'guard', name: '守卫' });
    expect(remote[0]._qrf_world_simulation.task.status).toBe('completed');
    expect(remote[0]._qrf_world_simulation.ledger.actors).toMatchObject([{ name: '守卫', deathSummary: null, resources: ['钥匙'],
      currentAction: { text: '在钟楼值守' } }]);
    expect(chat[1].mes).toBe(body);
    expect(chat[1].swipes).toEqual(['旧的展示副本']);
    expect(remote[1].mes).toBe(body);
  });

  it.each(['single', 'layered'] as const)('%s 正式会话在模型等待时实时显示阶段，完成后保存通过记录而不改正文', async workflowMode => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = 'body';
    envelope.ledger.actors = [actor()];
    const baseline = structuredClone(envelope.ledger);
    const body = '守卫在钟楼下待命。';
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 43, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const chatId = `live-progress-${workflowMode}`;
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'progress.png', name: '进度角色' }], getCurrentChatId: () => chatId,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') { entered = true; await held; }
      return { content: responseFor(data), toolCalls: [] };
    });
    const runtime = getWorldSimulationRuntime_ACU();
    const operation = runtime.sendAgentMessage('推进', 'live-progress');
    await vi.waitFor(() => expect(entered).toBe(true));
    const pending = runtime.readUiSnapshot();
    expect(pending.session.running).toBe(true);
    expect(pending.session.entries).toContainEqual(expect.objectContaining({ kind: 'delegation', status: 'running',
      agentName: workflowMode === 'single' ? 'undercurrent-analyst' : 'dramatis-keeper' }));
    expect(pending.session.entries).toContainEqual(expect.objectContaining({ kind: 'delegation', status: 'done', agentName: 'timekeeper' }));
    expect(chat[0]._qrf_world_simulation.ledger).toEqual(baseline);
    release();
    await expect(operation).resolves.toMatchObject({ status: 'completed' });
    const finished = runtime.readUiSnapshot();
    expect(finished.session.running).toBe(false);
    expect(finished.session.entries.filter(entry => entry.status === 'running')).toEqual([]);
    expect(finished.session.entries).toContainEqual(expect.objectContaining({ kind: 'finalize', title: '整轮结果已保存', status: 'done' }));
    expect(finished.session.entries).toContainEqual(expect.objectContaining({ kind: 'delegation', status: 'done', agentName: 'guidance-composer' }));
    const events = readWorldSimulationConversation_ACU(remote).messages.filter(message => message.eventKind === 'delegation');
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.every(event => event.status === 'done')).toBe(true);
    expect(chat[1].mes).toBe(body);
  });

  it('正式会话人物覆盖列表缺失时按无变化处理，保存其余有效结果', async () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.actors = [actor()];
    seedRetainedColdFact(envelope);
    const baseline = structuredClone(envelope.ledger);
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 44, mes: '守卫待命。', swipe_id: 0 }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: 'progress-failure', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'progress-failure.png', name: '进度角色' }], getCurrentChatId: () => 'progress-failure',
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      return { content: data.stage === 'actor-batch' ? JSON.stringify({ actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [] }) : responseFor(data), toolCalls: [] };
    });
    const runtime = getWorldSimulationRuntime_ACU();
    await expect(runtime.sendAgentMessage('推进', 'progress-failure')).resolves.toMatchObject({ status: 'completed' });
    const snapshot = runtime.readUiSnapshot();
    expect(snapshot.session.running).toBe(false);
    expect(snapshot.session.entries).toContainEqual(expect.objectContaining({ kind: 'delegation', agentName: 'dramatis-keeper', status: 'done', ok: true }));
    expect(snapshot.session.entries.some(entry => entry.kind === 'run_completed')).toBe(true);
    expect(snapshot.session.entries.filter(entry => entry.status === 'running')).toEqual([]);
    expect(remote[0]._qrf_world_simulation.ledger.actors).toEqual(baseline.actors);
    expect(remote[0]._qrf_world_simulation.ledger.clock.day).toBe(2);
    expect(remote[0]._qrf_world_simulation.ledger.factArchiveRetention).toEqual({ completedRounds: 11, enteredAtRound: {} });
    expect(readWorldSimulationConversation_ACU(remote).messages).toContainEqual(expect.objectContaining({ eventKind: 'delegation', status: 'done', agentName: 'dramatis-keeper' }));
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 短期事务完成不另交事实，上一轮结果保存、次轮可见且无进展清无', async (workflowMode, deliveryTarget) => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    const action = { text: '查验密信', expectedDuration: '两日', startedAtDay: 1, startedAt: '第一日', status: 'ongoing' as const, outcome: null };
    const guard = { ...actor(), shortTermAction: action, longTermAction: { ...action } };
    const actionResult = '查明密信封口完好，递送人是巡灯人。';
    envelope.ledger.actors = [guard];
    const baseline = structuredClone(envelope.ledger);
    const firstBody = '第三日，守卫结束查验。';
    const secondBody = '第四日，守卫暂未取得新线索。';
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 48, swipe_id: 0, mes: firstBody }];
    let remote = structuredClone(chat);
    const chatId = `action-result-${workflowMode}-${deliveryTarget}`;
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'action-result.png', name: '事务角色' }], getCurrentChatId: () => chatId,
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let turn = 1;
    let observedSecondRoundResult = false;
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'clock-candidate') return { content: JSON.stringify({ candidateClock: {
        ...baseline.clock, day: turn === 1 ? 3 : 4, storyTime: turn === 1 ? '第三日' : '第四日',
      } }), toolCalls: [] };
      if (data.stage === 'actor-batch') {
        if (turn === 2) {
          expect(data.actorMaterials.actors).toContainEqual(expect.objectContaining({ id: 'guard', previousActionResult: actionResult }));
          observedSecondRoundResult = true;
          return { content: JSON.stringify({ actorWrites: [], actorCompletions: [
            { actorId: 'guard', completion: 'no_change', expectedRevision: 2 },
          ], factWrites: [], historyMilestoneWrites: [] }), toolCalls: [] };
        }
        const finished = { ...action, status: 'done', outcome: '查验结束' };
        return { content: JSON.stringify({ actorWrites: [{ expectedRevision: 1,
          value: { ...guard, previousActionResult: actionResult, shortTermAction: finished, longTermAction: { ...finished }, revision: 2 } }],
          actorCompletions: [{ actorId: 'guard', completion: 'changed', expectedRevision: 1 }],
          historyMilestoneWrites: [], factWrites: [],
        }), toolCalls: [] };
      }
      return { content: responseFor(data), toolCalls: [] };
    });
    const runtime = getWorldSimulationRuntime_ACU();
    const first = await runtime.sendAgentMessage('结算查验', 'action-result-first');
    if (first?.status === 'failed') throw new Error(JSON.stringify(first.error));
    expect(first).toMatchObject({ status: 'completed' });
    const firstSaved = remote[0]._qrf_world_simulation.ledger;
    expect(firstSaved).toMatchObject({ clock: { day: 3 }, actors: [{ previousActionResult: actionResult,
      shortTermAction: null, longTermAction: null, experiences: [{ status: 'done', endedAtDay: 3 }] }] });
    expect(firstSaved.facts).toEqual([]);
    expect(firstSaved.actors[0]).not.toEqual(baseline.actors[0]);
    expect(chat[0]._qrf_world_simulation.ledger).toEqual(firstSaved);
    expect(chat[1].mes).toBe(firstBody);

    turn = 2;
    chat.push({ is_user: false, message_id: 49, swipe_id: 0, mes: secondBody });
    remote = structuredClone(chat);
    const second = await runtime.sendAgentMessage('继续查验', 'action-result-second');
    if (second?.status === 'failed') throw new Error(JSON.stringify(second.error));
    expect(second).toMatchObject({ status: 'completed' });
    expect(observedSecondRoundResult).toBe(true);
    const secondSaved = remote[0]._qrf_world_simulation.ledger;
    expect(secondSaved.actors[0]).toMatchObject({ previousActionResult: '无', shortTermAction: null,
      experiences: [{ status: 'done', endedAtDay: 3 }] });
    expect(secondSaved.facts).toEqual([]);
    expect(secondSaved.actors[0].revision).toBeGreaterThan(firstSaved.actors[0].revision);
    expect(chat[0]._qrf_world_simulation.ledger).toEqual(secondSaved);
    expect(chat[1].mes).toBe(firstBody);
    expect(chat[2].mes).toBe(secondBody);
    expect(save).toHaveBeenCalled();
  });

  it.each(['body', 'plot'] as const)('%s 第一次准备资料前中断后，再发送会重新开始且保留人物与设置', async deliveryTarget => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.actors = [actor()];
    const baseline = structuredClone(envelope.ledger);
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 58, swipe_id: 0, mes: '守卫在钟楼待命。' }];
    let remote = structuredClone(chat);
    const chatId = `missing-progress-${deliveryTarget}`;
    _set_SillyTavern_API_ACU({ chat, chatId, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'missing-progress.png', name: '测试角色' }], getCurrentChatId: () => chatId,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let release!: () => void;
    let entered = false;
    mockWorldbookSnapshot_ACU.mockImplementationOnce(async () => {
      entered = true;
      await new Promise<void>(resolve => { release = resolve; });
      return { available: true as const, entries: [] };
    });
    const runtime = getWorldSimulationRuntime_ACU();
    const first = runtime.sendAgentMessage('推进钟楼', 'missing-progress-first');
    await vi.waitFor(() => expect(entered).toBe(true));
    const stopping = runtime.stop();
    release();
    await stopping;
    await expect(first).resolves.toMatchObject({ status: 'cancelled' });
    const paused = runtime.readUiSnapshot().envelope!;
    expect(paused.task!.status).toBe('paused');
    expect(paused.task!.runMaterials).toBeUndefined();
    expect(paused.ledger).toEqual(baseline);
    const oldRunId = paused.task!.activeRun!.runId;
    const next = await runtime.sendAgentMessage('继续', 'missing-progress-next');
    if (next?.status === 'failed') throw new Error(JSON.stringify(next.error));
    expect(next).toMatchObject({ status: 'completed' });
    expect(next && 'identity' in next && next.identity.runId).not.toBe(oldRunId);
    expect(remote[0]._qrf_world_simulation.settings.deliveryTarget).toBe(deliveryTarget);
    expect(remote[0]._qrf_world_simulation.ledger.actors[0].id).toBe('guard');
    expect(remote[0]._qrf_world_simulation.ledger.revision).toBe(1);
    expect(chat[1].mes).toBe('守卫在钟楼待命。');
  });

  it('正式运行暂停后更改启用的业务提示词，恢复拒绝换稿且保留暂停账本', async () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.worldRoundPrompts = { 'clock-recaller': [{ role: 'system', content: 'CUSTOM_BEFORE_PAUSE', enabled: true, deletable: true, pinned: false }] };
    envelope.ledger.actors = [actor()];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 59, swipe_id: 0, mes: '守卫在钟楼待命。' }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: 'prompt-pause', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'prompt-pause.png', name: '提示词恢复角色' }], getCurrentChatId: () => 'prompt-pause',
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'clock-candidate') { entered = true; await held; }
      return { content: responseFor(data), toolCalls: [] };
    });
    const runtime = getWorldSimulationRuntime_ACU();
    const running = runtime.sendAgentMessage('推进', 'prompt-pause');
    await vi.waitFor(() => expect(entered).toBe(true));
    const stopping = runtime.stop();
    release();
    await stopping;
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    const paused = runtime.readUiSnapshot().envelope!;
    expect(paused.task!.status).toBe('paused');
    const changed = structuredClone(paused.settings);
    changed.worldRoundPrompts!['clock-recaller']![0].content = 'CUSTOM_AFTER_PAUSE';
    await runtime.saveSettings(changed);
    const calls = mockCallAIChatTurn_ACU.mock.calls.length;
    await expect(runtime.resume()).rejects.toBeTruthy();
    expect(mockCallAIChatTurn_ACU).toHaveBeenCalledTimes(calls);
    expect(runtime.readUiSnapshot().envelope!.task!.status).toBe('paused');
    expect(remote[0]._qrf_world_simulation.ledger).toEqual(paused.ledger);
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 正式认知更新经既有渠道与正文证据保存，不自动解锁秘密', async (workflowMode, deliveryTarget) => {
    const body = '守卫在钟楼广场亲耳听到信使宣告城门关闭。';
    const place = { region: '城区', place: '钟楼广场' };
    const sourceActor = { ...actor(), locationRef: place, informationSources: ['亲耳听闻'], knownFacts: ['钟楼每天报时'] };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.actors = [sourceActor];
    envelope.ledger.facts = [{ id: 'secret', summary: '城门地下有密道', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: place,
      actorIds: ['guard'], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 61, swipe_id: 0, mes: body }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: `knowledge-${workflowMode}-${deliveryTarget}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'knowledge.png', name: '认知角色' }], getCurrentChatId: () => `knowledge-${workflowMode}-${deliveryTarget}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') return { content: JSON.stringify({
        actorWrites: [{ value: { ...sourceActor, knownFacts: [...sourceActor.knownFacts, '城门已关闭'], revision: 2 }, expectedRevision: 1 }],
        actorCompletions: [{ actorId: 'guard', completion: 'changed', expectedRevision: 1 }],
        factWrites: [], historyMilestoneWrites: [], knowledgeAcquisitions: [{ actorId: 'guard', knowledge: '城门已关闭',
          channel: '亲耳听闻', evidenceQuote: body, acquiredAt: { day: 2, slot: '' }, locationRef: place }],
      }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });

    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('按实际渠道更新人物认知', 'knowledge-first');
    expect(result).toMatchObject({ status: 'completed' });
    expect(chat[0]._qrf_world_simulation.ledger.actors[0].knownFacts).toEqual(['钟楼每天报时', '城门已关闭']);
    expect(remote[0]._qrf_world_simulation.ledger.actors).toEqual(chat[0]._qrf_world_simulation.ledger.actors);
    expect(remote[0]._qrf_world_simulation.ledger.facts).toMatchObject([{ id: 'secret', revealState: 'locked', revision: 1 }]);
    expect(remote[0]._qrf_world_simulation.ledger.actors[0].knownFacts).not.toContain('城门地下有密道');
    expect(chat[1].mes).toBe(body);
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 空人物账本可从正文登记人物并严格保存，下一轮自动覆盖', async (workflowMode, deliveryTarget) => {
    const chat: any[] = [{}, { is_user: false, message_id: 71, mes: '守卫来到钟楼，开始巡查。', swipe_id: 0 }];
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    chat[0]._qrf_world_simulation = envelope;
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: `registration-${workflowMode}-${deliveryTarget}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'registration.png', name: '登记角色' }],
      getCurrentChatId: () => `registration-${workflowMode}-${deliveryTarget}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
      getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const actorPages: string[][] = [];
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') {
        actorPages.push(data.actorIds);
        if (!data.actorIds.length) return { content: JSON.stringify({
          actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [],
          actorRegistrations: [{ expectedRevision: 0, evidenceQuote: '守卫来到钟楼，开始巡查。',
            value: { ...actor(), goals: [], currentAction: { text: '巡查钟楼', expectedDuration: '片刻', startedAtDay: 999, startedAt: '模型时间' } },
          }],
        }), toolCalls: [] };
      }
      return { content: responseFor(data), toolCalls: [] };
    });

    const runtime = getWorldSimulationRuntime_ACU();
    const first = await runtime.sendAgentMessage('推进', 'registration-first');
    expect(first).toMatchObject({ status: 'completed' });
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(confirmRegistration.mock.calls[0][0]).toMatchObject({ id: 'guard', name: '守卫' });
    expect(actorPages).toEqual([[]]);
    expect(chat[0]._qrf_world_simulation.ledger.actors).toMatchObject([{ id: 'guard', revision: 1,
      simulationStatus: 'active', knownFacts: [], experiences: [],
      currentAction: { startedAtDay: 2, startedAt: '第二日' },
    }]);
    expect(remote[0]._qrf_world_simulation.ledger.actors).toEqual(chat[0]._qrf_world_simulation.ledger.actors);

    chat.push({ is_user: false, message_id: 72, mes: '守卫继续巡查钟楼。', swipe_id: 0 });
    remote = structuredClone(chat);
    const second = await runtime.sendAgentMessage('继续推进', 'registration-second');
    expect(second).toMatchObject({ status: 'completed' });
    expect(actorPages).toEqual([[], ['guard']]);
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(remote[0]._qrf_world_simulation.ledger.actors).toEqual(chat[0]._qrf_world_simulation.ledger.actors);
    expect(remote[0]._qrf_world_simulation.ledger.actors[0].revision).toBe(2);
    expect(chat[1].mes).toBe('守卫来到钟楼，开始巡查。');
    expect(chat[2].mes).toBe('守卫继续巡查钟楼。');
  });

  it('正式入口逐人审批：拒绝首位登记后仍保存第二位及其它有效世界结果', async () => {
    const body = '守卫与巡灯人来到钟楼。';
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 73, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    _set_SillyTavern_API_ACU({ chat, chatId: 'partial-approval', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'partial.png', name: '测试角色' }], getCurrentChatId: () => 'partial-approval',
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    confirmRegistration.mockImplementation(async (candidate: { id: string }) => candidate.id !== 'guard');
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [],
        actorRegistrations: [
          { value: actor(), expectedRevision: 0, evidenceQuote: '守卫与巡灯人来到钟楼' },
          { value: { ...actor(), id: 'lamplighter', name: '巡灯人' }, expectedRevision: 0, evidenceQuote: '巡灯人来到钟楼' },
        ], factWrites: [], historyMilestoneWrites: [],
      }), toolCalls: [] };
      if (data.stage === 'world-page') return { content: JSON.stringify({ worldEventWrites: [], factWrites: [{
        expectedRevision: 0, value: { id: 'tower-bell', summary: '钟楼传出钟声', temporalKind: 'occurrence',
          happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null, actorIds: [],
          worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null,
          sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 },
      }] }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进', 'partial-approval');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(confirmRegistration.mock.calls.map(([candidate]) => candidate.id)).toEqual(['guard', 'lamplighter']);
    expect(confirmRegistration.mock.calls.every(([, signal]) => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(remote[0]._qrf_world_simulation.ledger.actors.map((candidate: { id: string }) => candidate.id)).toEqual(['lamplighter']);
    expect(remote[0]._qrf_world_simulation.ledger.facts).toContainEqual(expect.objectContaining({ id: 'tower-bell' }));
    expect(remote[0]._qrf_world_simulation.ledger).toEqual(chat[0]._qrf_world_simulation.ledger);
    expect(remote[1].mes).toBe(body);
  });

  it('正式入口确认等待时停止，signal 取消不提交登记或整轮候选', async () => {
    const body = '守卫来到钟楼。';
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 74, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    _set_SillyTavern_API_ACU({ chat, chatId: 'registration-aborted', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'aborted.png', name: '测试角色' }], getCurrentChatId: () => 'registration-aborted',
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [],
        actorRegistrations: [{ value: actor(), expectedRevision: 0, evidenceQuote: body }],
        factWrites: [], historyMilestoneWrites: [],
      }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    let release!: (approved: boolean) => void;
    const pending = new Promise<boolean>(resolve => { release = resolve; });
    confirmRegistration.mockImplementation(async () => pending);
    const runtime = getWorldSimulationRuntime_ACU();
    const operation = runtime.sendAgentMessage('推进', 'registration-aborted');
    await vi.waitFor(() => expect(confirmRegistration).toHaveBeenCalledOnce());
    const approvalSignal = confirmRegistration.mock.calls[0][1] as AbortSignal;
    expect(approvalSignal.aborted).toBe(false);
    const stopping = runtime.stop();
    expect(approvalSignal.aborted).toBe(true);
    release(true);
    await stopping;
    await expect(operation).resolves.toMatchObject({ status: 'cancelled' });
    expect(chat[0]._qrf_world_simulation.ledger.actors).toEqual([]);
    expect(remote[0]._qrf_world_simulation.ledger.actors).toEqual([]);
    expect(remote[0]._qrf_world_simulation.ledger.revision).toBe(0);
    expect(chat[1].mes).toBe(body);
    expect(save).toHaveBeenCalled(); // 允许预留任务元数据，禁止落业务账本。
  });

  it('正式工厂将超过热窗口的历史同次保存到冷层，旧史仍能按本人地点召回精读', async () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.clock.day = 40;
    envelope.ledger.actors = [{ ...actor(), locationRef: { region: '北京', place: '钟楼' } }];
    envelope.ledger.historyMilestones = Array.from({ length: 33 }, (_, index) => ({ id: `history-${index}`, summary: `重要历史-${index}`,
      happenedAt: { day: index + 1, slot: '' }, actorIds: ['guard'], worldEventIds: [], locationRef: { region: index === 0 ? '北京' : '上海' },
      sourceFactIds: [], importance: 3, category: '人生节点', visibility: 'internal' as const, revision: 1, legacyRefs: [] }));
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 65, swipe_id: 0, mes: '守卫继续巡查钟楼。' }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: 'history-production', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'history.png', name: '历史角色' }], getCurrentChatId: () => 'history-production',
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'clock-candidate') return { content: JSON.stringify({ candidateClock: { ...envelope.ledger.clock, day: 41 } }), toolCalls: [] };
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [],
        actorCompletions: [{ actorId: 'guard', completion: 'no_change', expectedRevision: 1 }], factWrites: [], historyMilestoneWrites: [] }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });

    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进历史', 'history-first');
    expect(result).toMatchObject({ status: 'completed' });
    const persisted = remote[0]._qrf_world_simulation.ledger;
    expect(persisted.historyMilestones).toHaveLength(32);
    expect(persisted.historyArchive).toMatchObject([{ id: 'history-0', summary: '重要历史-0' }]);
    expect(persisted).toEqual(chat[0]._qrf_world_simulation.ledger);
    const config = { limits: { actorsPerPage: 24, recentHistoryPerActor: 3, relatedHistoryPerActor: 2, eventsPerPage: 16, factsPerPage: 16 },
      read: { historyTokenBudget: 10000, readTokenBudget: 2000, fallbackTokens: 2000 } };
    const ready = await prepareWorldExecutionRecall_ACU(persisted, persisted.clock, null, config, async () => 1);
    if (!ready.allowed) throw new Error(ready.reason);
    expect(ready.manifests[0].actors[0].relatedHistoryIds).toEqual(['history-0']);
    const material = await readWorldExecutionRecall_ACU(ready.receipt, persisted, persisted.clock, null, config,
      { kind: 'actor', batchIndex: 0, historyByActor: { guard: ['history-0'] }, worldEventIds: [], factIds: [] }, undefined, async () => 1);
    expect(material).toMatchObject({ allowed: true, materials: { historyMilestones: [{ id: 'history-0', summary: '重要历史-0' }] } });
    expect(chat[1].mes).toBe('守卫继续巡查钟楼。');
  });

  it('正式登记保存失败时不留下半个人物，原正文和远端账本不变', async () => {
    const chat: any[] = [{}, { is_user: false, message_id: 91, mes: '守卫来到钟楼。', swipe_id: 0 }];
    chat[0]._qrf_world_simulation = buildDefaultWorldSimulationEnvelope_ACU();
    seedRetainedColdFact(chat[0]._qrf_world_simulation);
    const baseline = structuredClone(chat[0]._qrf_world_simulation.ledger);
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: 'registration-failed', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'registration-failed.png', name: '登记失败角色' }], getCurrentChatId: () => 'registration-failed',
      saveChat: vi.fn(async () => {
        if (chat[0]._qrf_world_simulation.ledger.actors.length) throw new Error('登记保存失败');
        remote = structuredClone(chat);
      }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [],
        factWrites: [], historyMilestoneWrites: [], actorRegistrations: [{ value: actor(), expectedRevision: 0, evidenceQuote: '守卫来到钟楼。' }],
      }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });

    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进', 'registration-failed');
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'failed' });
    const failedSession = getWorldSimulationRuntime_ACU().readUiSnapshot().session;
    expect(failedSession.running).toBe(false);
    expect(failedSession.entries).toContainEqual(expect.objectContaining({ kind: 'finalize', title: '整轮保存未确认', status: 'failed',
      detail: expect.stringContaining('登记保存失败') }));
    expect(failedSession.entries.some(entry => entry.kind === 'run_completed')).toBe(false);
    expect(failedSession.entries.filter(entry => entry.status === 'running')).toEqual([]);
    expect(chat[0]._qrf_world_simulation.ledger).toEqual(baseline);
    expect(remote[0]._qrf_world_simulation.ledger).toEqual(baseline);
    expect(baseline.factArchiveRetention).toEqual({ completedRounds: 10, enteredAtRound: { 'old-cold': 0 } });
    expect(chat[1].mes).toBe('守卫来到钟楼。');
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 已提交的幕后传播支持认知更新，不依赖主角正文，也不解锁来源', async (workflowMode, deliveryTarget) => {
    const place = { region: '北境', place: '钟楼' };
    const summary = '信使通过当面告知向守卫说明北门关闭。';
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    const receiver = { ...actor(), locationRef: place, informationSources: ['当面告知'] };
    const sender = { ...actor(), id: 'messenger', name: '信使', locationRef: place, knownFacts: ['北门关闭'] };
    envelope.ledger.actors = [receiver, sender];
    envelope.ledger.player.location = { region: '南城', place: '客栈' };
    envelope.ledger.facts = [{ id: 'communication', summary, temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' },
      validFrom: null, validUntil: null, locationRef: place, actorIds: ['guard', 'messenger'], worldEventIds: [],
      projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: ['已提交的传信记录'], supersedesFactIds: [], revision: 1 }];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 97, swipe_id: 0, mes: '主角在南城客栈休息。' }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: `propagation-${workflowMode}-${deliveryTarget}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'propagation.png', name: '传播角色' }], getCurrentChatId: () => `propagation-${workflowMode}-${deliveryTarget}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'recall-selection') {
        expect(data.directory.dueFactIds).toContain('communication');
        return { content: JSON.stringify({ selections: data.directory.actorIds.map((actorId: string) => ({ actorId,
          historyMilestoneIds: [], worldEventIds: [], factIds: ['communication'], reason: '核对传信记录', priority: 1, scope: 'actor' })),
          worldSelection: { worldEventIds: [], factIds: ['communication'], reason: '已提交的传信', priority: 1, scope: 'world' } }), toolCalls: [] };
      }
      if (data.stage === 'actor-batch') {
        expect(data.knowledgeSources).toEqual([{ actorId: 'guard', sourceActorId: 'messenger', sourceFactId: 'communication',
          knowledge: '北门关闭', channel: '当面告知', locationRef: place }]);
        return { content: JSON.stringify({ actorWrites: [{ value: { ...receiver, knownFacts: ['北门关闭'], revision: 2 }, expectedRevision: 1 }],
          actorCompletions: [{ actorId: 'guard', completion: 'changed', expectedRevision: 1 }, { actorId: 'messenger', completion: 'no_change', expectedRevision: 1 }],
          knowledgeAcquisitions: [{ actorId: 'guard', sourceActorId: 'messenger', sourceFactId: 'communication', knowledge: '北门关闭', channel: '当面告知',
            evidenceQuote: summary, acquiredAt: { day: 2, slot: '' }, locationRef: place }], factWrites: [], historyMilestoneWrites: [] }), toolCalls: [] };
      }
      return { content: responseFor(data), toolCalls: [] };
    });
    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进幕后人物', 'propagation');
    if (result?.status === 'failed') throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({ status: 'completed' });
    const persisted = remote[0]._qrf_world_simulation.ledger;
    expect(persisted.actors.find((item: { id: string }) => item.id === 'guard').knownFacts).toEqual(['北门关闭']);
    expect(persisted.facts).toMatchObject([{ id: 'communication', revealState: 'locked', revision: 1 }]);
    expect(persisted).toEqual(chat[0]._qrf_world_simulation.ledger);
    expect(chat[1].mes).toBe('主角在南城客栈休息。');
  });

  it.each(['single', 'layered'] as const)('%s 正式提交将过期事实无损冷藏，仍锁定的有效秘密保持热层', async workflowMode => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.ledger.facts = [
      { id: 'expired', summary: '昨日短期封街', temporalKind: 'condition', happenedAt: null,
        validFrom: { day: 1, slot: '' }, validUntil: { day: 1, slot: '' }, locationRef: null, actorIds: [], worldEventIds: [],
        projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null, sourceRefs: ['旧封街记录'], evidenceRefs: [], supersedesFactIds: [], revision: 1 },
      { id: 'secret', summary: '仍须等接触才揭示的旧秘密', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' },
        validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
        revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 },
    ];
    envelope.ledger.historyMilestones = [{ id: 'milestone', summary: '封街影响的重要历史', happenedAt: { day: 1, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: ['expired'], importance: 3, category: '重大事件', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 96, swipe_id: 0, mes: '第二日，街道恢复平静。' }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: `fact-archive-${workflowMode}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'fact-archive.png', name: '事实归档角色' }], getCurrentChatId: () => `fact-archive-${workflowMode}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [] }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进', 'fact-archive');
    if (result?.status === 'failed') throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({ status: 'completed' });
    const persisted = remote[0]._qrf_world_simulation.ledger;
    expect(persisted.facts).toMatchObject([{ id: 'secret', revealState: 'locked' }]);
    expect(persisted.factArchive).toMatchObject([{ id: 'expired', summary: '昨日短期封街', sourceRefs: ['旧封街记录'] }]);
    expect(persisted.factArchiveRetention).toEqual({ completedRounds: 1, enteredAtRound: { expired: 1 } });
    expect(persisted.historyMilestones[0].sourceFactIds).toEqual(['expired']);
    expect(persisted).toEqual(chat[0]._qrf_world_simulation.ledger);
    expect(chat[1].mes).toBe('第二日，街道恢复平静。');
  });

  it('已存 v7 从正式 runtime 预览确认补迁后，新事件进入下一轮真实 runner', async () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.seeds = [{ id: 'v7-festival', title: '旧庆典筹备', status: 'active', level: 2,
      catalyst: '筹备继续', visibility: 'hidden', actorIds: [], location: null, expiresAtDay: null,
      missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: null, revision: 3 }];
    envelope.ledger.legacyMigration.issues = [{ source: 'seed', sourceId: 'v7-festival', reason: 'requires_review' }];
    const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 95, swipe_id: 0, mes: '庆典正在筹备。' }];
    let remote = structuredClone(chat);
    const save = vi.fn(async () => { remote = structuredClone(chat); });
    _set_SillyTavern_API_ACU({ chat, chatId: 'v7-backfill-production', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'v7-backfill.png', name: '补迁角色' }], getCurrentChatId: () => 'v7-backfill-production',
      saveChat: save, getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const runtime = getWorldSimulationRuntime_ACU();
    const preview = runtime.previewLegacyBackfill();
    expect(preview.changed).toBe(true);
    expect(preview.addedEventIds).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(chat[0]._qrf_world_simulation.ledger.worldEvents).toEqual([]);
    const migrated = await runtime.applyLegacyBackfill();
    expect(migrated.addedEventIds).toEqual(preview.addedEventIds);
    expect(remote[0]._qrf_world_simulation.ledger.worldEvents).toMatchObject([{ title: '旧庆典筹备', revision: 3 }]);
    const savedCount = save.mock.calls.length;
    expect(runtime.previewLegacyBackfill().changed).toBe(false);
    expect((await runtime.applyLegacyBackfill()).changed).toBe(false);
    expect(save).toHaveBeenCalledTimes(savedCount);
    const seen: string[] = [];
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'recall-selection') return { content: JSON.stringify({ selections: [], worldSelection: {
        worldEventIds: data.directory.dueEventIds, factIds: [], reason: '复查补迁事件', priority: 1, scope: 'world',
      } }), toolCalls: [] };
      if (data.stage === 'world-page') {
        const events = Object.entries(data.worldMaterials).filter(([key]) => key.startsWith('worldEvents:')).map(([, value]) => value as any);
        seen.push(...events.map(event => event.id));
        return { content: JSON.stringify({ worldEventWrites: events.map(event => ({ expectedRevision: event.revision,
          value: { ...event, revision: event.revision + 1, nextCheck: { day: 3, slot: '', reason: '继续复查' } },
        })), factWrites: [] }), toolCalls: [] };
      }
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [] }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    expect(await runtime.sendAgentMessage('继续推演', 'after-v7-backfill')).toMatchObject({ status: 'completed' });
    expect(seen).toEqual(preview.addedEventIds);
    expect(remote[0]._qrf_world_simulation.ledger.worldEvents).toMatchObject([{ revision: 4 }]);
    expect(chat[1].mes).toBe('庆典正在筹备。');
  });

  it.each([
    ['single', 'body'], ['single', 'plot'], ['layered', 'body'], ['layered', 'plot'],
  ] as const)('%s/%s 已投送且正文已写的旧史经正式工厂保存入 cold；下一次世界上下文仍保留原文及标记', async (workflowMode, deliveryTarget) => {
    const summary = '守卫曾在暴雨夜关闭北门';
    const deliveryQuote = '北门在暴雨夜关闭';
    const evidenceQuote = '守卫回想起暴雨夜关闭北门的经历';
    const body = `夜色降临。${evidenceQuote}，随即走向钟楼。`;
    const delivered = `<personnel>人物\n视界之外发生的重要事件：${deliveryQuote}</personnel>`;
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = workflowMode;
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.actors = [actor()];
    envelope.ledger.historyMilestones = [{ id: 'delivered-history', summary, happenedAt: { day: 1, slot: '' }, actorIds: ['guard'],
      worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 3, category: '旧事', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const chat: any[] = [{ _qrf_world_simulation: envelope },
      { is_user: true, mes: '请续写。', qrf_plot: '<physio_state>模型原始任务，不等于投送</physio_state>',
        _qrf_plot_final_message: delivered },
      { is_user: false, message_id: 901, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: `recorded-${workflowMode}-${deliveryTarget}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'recorded.png', name: '测试角色' }], getCurrentChatId: () => `recorded-${workflowMode}-${deliveryTarget}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let inspected = false;
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'recall-selection') return { content: JSON.stringify({
        selections: data.directory.actorIds.map((actorId: string) => ({ actorId, historyMilestoneIds: ['delivered-history'],
          worldEventIds: [], factIds: [], reason: '回忆旧事', priority: 1, scope: 'actor' })),
        worldSelection: { worldEventIds: [], factIds: [], reason: '无变化', priority: 1, scope: 'world' },
      }), toolCalls: [] };
      if (data.stage === 'actor-batch') {
        // 历史标记已移交联合审查专员：人物批不再收到标记资料，即便仍返回候选也被静默忽略。
        expect(data.historyRecordingMaterials).toBeUndefined();
        expect(data.historyDeliveryText).toBeUndefined();
        return { content: JSON.stringify({ actorWrites: [], actorCompletions: [{ actorId: 'guard', completion: 'no_change', expectedRevision: 1 }],
          factWrites: [], historyMilestoneWrites: [], historyRecordingCandidates: [{ historyId: 'delivered-history', deliveryQuote: '不存在的投送', evidenceQuote }] }), toolCalls: [] };
      }
      if (data.stage === 'world-narrative-review-v1' || data.stage === 'world-review-maintenance-v1') {
        expect(data.historyRecordingMaterials).toMatchObject([{ id: 'delivered-history', summary }]);
        expect(data.historyDeliveryText).toContain(delivered);
        inspected = true;
        const recording = { historyRecordingCandidates: [{ historyId: 'delivered-history', deliveryQuote, evidenceQuote }] };
        return { content: data.stage === 'world-narrative-review-v1'
          ? JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [], ...recording }) : JSON.stringify(recording), toolCalls: [] };
      }
      return { content: responseFor(data), toolCalls: [] };
    });
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('继续推进', 'recorded-first');
    if (outcome?.status === 'failed') throw new Error(JSON.stringify(outcome.error));
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(inspected).toBe(true);
    expect(mockCallAIChatTurn_ACU.mock.calls.filter(([messages]) => ['world-narrative-review-v1', 'world-review-maintenance-v1']
      .includes(protocolInput(messages).stage))).toHaveLength(1);
    const persisted = remote[0]._qrf_world_simulation.ledger;
    expect(persisted.historyMilestones).toEqual([]);
    expect(persisted.historyArchive).toMatchObject([{ id: 'delivered-history', summary, revision: 2,
      narrativeRecord: { status: 'recorded', recordedAt: { day: 2 }, anchorDigest: expect.stringMatching(/^[a-f0-9]{64}$/), deliveryQuote, evidenceQuote } }]);
    expect(remote[2].mes).toBe(body);
    expect(chat[2].mes).toBe(body);
    expect(chat[0]._qrf_world_simulation.ledger).toEqual(persisted);
    const { buildPlotWorldContext_ACU, renderPlotWorldContextMessage_ACU } = await import('../../../src/service/runtime/plot-runtime/plot-world-context');
    const nextContext = renderPlotWorldContextMessage_ACU(buildPlotWorldContext_ACU({ ledger: persisted, previousLedger: null, summary: '' }));
    expect(nextContext.content).toContain('"cold"');
    expect(nextContext.content).toContain(summary);
    expect(nextContext.content).toContain('"narrativeRecord"');
    expect(nextContext.content).toContain(evidenceQuote);
    expect(nextContext.content).toContain(deliveryQuote);
  });

  it.each([
    ['body', false], ['plot', false], ['plot', true],
  ] as const)('%s 历史先新建入热层、再记录移入冷层后，后续轮次保存不再把旧增量重放回热层（旧存档无基线序号=%s）', async (deliveryTarget, legacy) => {
    const summary = '守卫在暴雨夜关闭北门';
    const deliveryQuote = '北门在暴雨夜关闭';
    const evidenceQuote = '守卫回想起暴雨夜关闭北门的经历';
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.workflowMode = 'layered';
    envelope.settings.deliveryTarget = deliveryTarget;
    envelope.ledger.actors = [actor()];
    const chat: any[] = [{ _qrf_world_simulation: envelope },
      { is_user: true, mes: '开始。', qrf_plot: '<physio_state>原始</physio_state>', _qrf_plot_final_message: '<personnel>人物</personnel>' },
      { is_user: false, message_id: 901, mes: '守卫站岗。', swipe_id: 0 }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: `probe-${deliveryTarget}`, characterId: 0, this_chid: 0,
      characters: [{ avatar: 'probe.png', name: '测试角色' }], getCurrentChatId: () => `probe-${deliveryTarget}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    let round = 1;
    const fact = (id: string, day: number) => ({ expectedRevision: 0, value: { id, summary: '守卫值守', temporalKind: 'occurrence', happenedAt: { day, slot: '' },
      validFrom: null, validUntil: null, locationRef: null, actorIds: ['guard'], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 } });
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'clock-candidate') return { content: JSON.stringify({ candidateClock: { day: round + 1, slot: '', storyTime: `第${round + 1}日`, precision: 'exact', evidenceRefs: [] } }), toolCalls: [] };
      if (data.stage === 'recall-selection') return { content: JSON.stringify({
        selections: data.directory.actorIds.map((actorId: string) => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '无', priority: 1, scope: 'actor' })),
        worldSelection: { worldEventIds: [], factIds: [], reason: '无', priority: 1, scope: 'world' } }), toolCalls: [] };
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [],
        actorCompletions: [{ actorId: 'guard', completion: 'no_change', expectedRevision: 1 }], factWrites: [fact(`fact-${round}`, round + 1)] }), toolCalls: [] };
      if (data.stage === 'world-narrative-review-v1' || data.stage === 'world-review-maintenance-v1') {
        const payload = round === 2
          ? { historyMilestoneWrites: [{ expectedRevision: 0, value: { id: 'x-history', summary, happenedAt: { day: 3, slot: '' }, actorIds: ['guard'],
            worldEventIds: [], locationRef: null, sourceFactIds: ['fact-2'], importance: 3, category: '旧事' } }] }
          : round === 3 ? { historyRecordingCandidates: [{ historyId: 'x-history', deliveryQuote, evidenceQuote }] } : {};
        return { content: JSON.stringify(data.stage === 'world-narrative-review-v1'
          ? { locationRef: null, contactedActorIds: [], evidence: [], reviews: [], ...payload } : payload), toolCalls: [] };
      }
      return { content: responseFor(data), toolCalls: [] };
    });
    const layers = () => { const l = remote[0]._qrf_world_simulation.ledger; return `热层 ${JSON.stringify(l.historyMilestones.map((h: any) => h.id))} 冷层 ${JSON.stringify((l.historyArchive ?? []).map((h: any) => h.id))}`; };
    const bodies = ['守卫站岗。', '守卫巡逻。', `夜色降临。${evidenceQuote}，随即走向钟楼。`, '第四天守卫休假。'];
    for (round = 1; round <= 4; round += 1) {
      if (round > 1) {
        chat.push({ is_user: true, mes: `第${round}轮。`, qrf_plot: '<physio_state>原始</physio_state>',
          _qrf_plot_final_message: round === 3 ? `<personnel>人物\n视界之外发生的重要事件：${deliveryQuote}</personnel>` : '<personnel>人物</personnel>' },
        { is_user: false, message_id: 900 + round, mes: bodies[round - 1], swipe_id: 0 });
        remote = structuredClone(chat);
      }
      const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('继续推进', `probe-${round}`);
      if (outcome?.status === 'failed') throw new Error(`第${round}轮：${JSON.stringify(outcome.error)}`);
      expect(outcome).toMatchObject({ status: 'completed' });
      if (round === 2) expect(layers()).toBe('热层 ["x-history"] 冷层 []');
      if (round >= 3) expect(layers()).toBe('热层 [] 冷层 ["x-history"]');
      // 旧存档的基线没有序号标记，按账本版本判断已包含的增量。
      if (legacy && round === 3) for (const message of chat) for (const entry of Object.values(message?._qrf_world_simulation_state?.entries ?? {}) as any[]) delete entry?.value?.checkpointSeq;
      if (legacy && round === 3) remote = structuredClone(chat);
    }
    const { foldWorldSimulationLedger_ACU } = await import('../../../src/service/simulation/simulation-ledger-fold');
    const folded = foldWorldSimulationLedger_ACU(chat)!.ledger;
    expect(folded.historyMilestones.map(item => item.id)).toEqual([]);
    expect((folded.historyArchive ?? []).map(item => item.id)).toEqual(['x-history']);
  });

  it.each(['no-delivery', 'not-written'] as const)('%s 时正式工厂不得因模型自称已记载而归档历史', async missing => {
    const deliveryQuote = '暴雨夜关闭北门';
    const evidenceQuote = '守卫回想起暴雨夜关闭北门';
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.actors = [actor()];
    envelope.ledger.historyMilestones = [{ id: 'unrecorded', summary: deliveryQuote, happenedAt: { day: 1, slot: '' },
      actorIds: ['guard'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 3,
      category: '旧事', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const body = missing === 'not-written' ? '守卫继续巡查钟楼。' : `${evidenceQuote}，继续巡查。`;
    const chat: any[] = [{ _qrf_world_simulation: envelope },
      { is_user: true, mes: missing === 'no-delivery' ? '请续写。' : `<personnel>人物\n视界之外发生的重要事件：${deliveryQuote}</personnel>`,
        qrf_plot: missing === 'no-delivery' ? `<physio_state>${deliveryQuote}</physio_state>`
          : `<personnel>人物\n视界之外发生的重要事件：${deliveryQuote}</personnel>` },
      { is_user: false, message_id: 902, mes: body, swipe_id: 0 }];
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, getCurrentChatId: () => `not-recorded-${missing}`,
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'recall-selection') return { content: JSON.stringify({ selections: [{ actorId: 'guard',
        historyMilestoneIds: ['unrecorded'], worldEventIds: [], factIds: [], reason: '回忆旧事', priority: 1, scope: 'actor' }],
        worldSelection: { worldEventIds: [], factIds: [], reason: '无变化', priority: 1, scope: 'world' } }), toolCalls: [] };
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [],
        actorCompletions: [{ actorId: 'guard', completion: 'no_change', expectedRevision: 1 }], factWrites: [], historyMilestoneWrites: [],
        historyRecordingCandidates: [{ historyId: 'unrecorded', deliveryQuote, evidenceQuote }] }), toolCalls: [] };
      if (data.stage === 'world-review-maintenance-v1') return { content: JSON.stringify({
        historyRecordingCandidates: [{ historyId: 'unrecorded', deliveryQuote, evidenceQuote }] }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });
    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('继续', `negative-${missing}`);
    expect(result).toMatchObject({ status: 'completed' });
    expect(remote[0]._qrf_world_simulation.ledger.historyMilestones).toMatchObject([{ id: 'unrecorded', revision: 1 }]);
    expect(remote[0]._qrf_world_simulation.ledger.historyMilestones[0].narrativeRecord).toBeUndefined();
    expect(remote[0]._qrf_world_simulation.ledger.historyArchive ?? []).toEqual([]);
    expect(remote[2].mes).toBe(body);
  });

  it('旧 v6 引信迁入新事件后，正式工厂能召回、复查并严格保存，不伪造结果事实', async () => {
    const envelope: any = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete envelope.ledger[key];
    envelope.ledger.seeds = [{ id: 'old-festival', title: '钟楼庆典筹备', status: 'active', level: 2,
      catalyst: '工匠已到场', visibility: 'hidden', actorIds: [], location: { region: '城区', place: '钟楼' },
      expiresAtDay: 5, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: null, revision: 3 }];
    const chat: any[] = [{}, { is_user: false, message_id: 81, mes: '钟楼广场一切照常。', swipe_id: 0 }];
    chat[0]._qrf_world_simulation = envelope;
    let remote = structuredClone(chat);
    _set_SillyTavern_API_ACU({ chat, chatId: 'migration-production', characterId: 0, this_chid: 0,
      characters: [{ avatar: 'migration.png', name: '迁移角色' }], getCurrentChatId: () => 'migration-production',
      saveChat: vi.fn(async () => { remote = structuredClone(chat); }), getRequestHeaders: () => ({}), extensionSettings: {},
    } as any);
    vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
    const reviewedEvents: any[] = [];
    mockCallAIChatTurn_ACU.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = protocolInput(messages);
      if (data.stage === 'recall-selection') return { content: JSON.stringify({ selections: [], worldSelection: {
        worldEventIds: data.directory.dueEventIds, factIds: [], reason: '复查旧庆典', priority: 1, scope: 'world',
      } }), toolCalls: [] };
      if (data.stage === 'world-page') {
        const events = Object.entries(data.worldMaterials).filter(([key]) => key.startsWith('worldEvents:')).map(([, value]) => value as any);
        reviewedEvents.push(...events);
        return { content: JSON.stringify({ worldEventWrites: events.map(event => ({ expectedRevision: event.revision,
          value: { ...event, revision: event.revision + 1, nextCheck: { day: 3, slot: '', reason: '继续检查庆典筹备' } },
        })), factWrites: [] }), toolCalls: [] };
      }
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [] }), toolCalls: [] };
      return { content: responseFor(data), toolCalls: [] };
    });

    const result = await getWorldSimulationRuntime_ACU().sendAgentMessage('复查庆典', 'migration-first');
    expect(result).toMatchObject({ status: 'completed' });
    expect(reviewedEvents).toHaveLength(1);
    expect(reviewedEvents[0]).toMatchObject({ title: '钟楼庆典筹备', status: 'active', revision: 3, deadline: { day: 5, slot: '' } });
    const persisted = remote[0]._qrf_world_simulation.ledger;
    expect(persisted.worldEvents).toMatchObject([{ id: reviewedEvents[0].id, revision: 4, nextCheck: { day: 3 } }]);
    expect(persisted.facts).toEqual([]);
    expect(persisted.seeds).toEqual(envelope.ledger.seeds);
    expect(persisted).toEqual(chat[0]._qrf_world_simulation.ledger);
    expect(chat[1].mes).toBe('钟楼广场一切照常。');
  });
});
