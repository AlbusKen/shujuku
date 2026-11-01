import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { binding, listBooks, readEntries, model, confirm } = vi.hoisted(() => ({
  binding: vi.fn(), listBooks: vi.fn(), readEntries: vi.fn(), model: vi.fn(), confirm: vi.fn(),
}));
vi.mock('../../../src/data/gateways/character-gateway', async original => ({
  ...await original<typeof import('../../../src/data/gateways/character-gateway')>(),
  getCurrentCharacterWorldbookBinding_ACU: binding,
}));
vi.mock('../../../src/data/gateways/worldbook-gateway', async original => ({
  ...await original<typeof import('../../../src/data/gateways/worldbook-gateway')>(),
  listLorebooks_ACU: listBooks, getLorebookEntriesRequired_ACU: readEntries,
}));
vi.mock('../../../src/service/ai/api-call', async original => ({
  ...await original<typeof import('../../../src/service/ai/api-call')>(),
  callAIChatTurn_ACU: model,
}));
vi.mock('../../../src/presentation/theme/confirm-actor-registration', () => ({
  confirmWorldActorRegistration_ACU: confirm,
}));

import { WorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { foldWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { settings_ACU } from '../../../src/service/runtime/state-manager';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import type { WorldActor_ACU } from '../../../src/service/simulation/model';

const oldActor: WorldActor_ACU = {
  id: 'already-here', name: '旧友', loreRefs: ['旧书#1'], interests: ['茶'], location: '老街', locationRef: null,
  life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
  informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null,
  simulationStatus: 'active', experiences: [], revision: 4,
};
const newActors = [
  { name: '青禾', aliases: ['阿禾'], loreRefs: ['山海志#7'], interests: ['读书'], goals: ['编纂游记'], currentAction: { text: '整理旧书', expectedDuration: '一晚', startedAtDay: 999, startedAt: '伪造时间' }, shortTermAction: { text: '拜访书商', expectedDuration: '一天', status: 'ongoing', startedAtDay: 999, startedAt: '伪造时间' }, longTermAction: { text: '拜访书商', expectedDuration: '一天', status: 'ongoing', startedAtDay: 999, startedAt: '伪造时间' } },
  { name: '白露', aliases: [], loreRefs: ['旧都录#8'], resources: ['钥匙'] },
];
const existingCandidate = { name: '旧友', existingActorId: 'already-here', aliases: [], loreRefs: ['山海志#9'] };
const originalPresets = structuredClone(settings_ACU.apiPresets);
const orchestrator = {
  isInFlight: vi.fn(() => false), deriveEnvelopeView: vi.fn((envelope: unknown) => envelope),
  start: vi.fn(), resume: vi.fn(), cancel: vi.fn(), interrupt: vi.fn(),
} as unknown as ConstructorParameters<typeof WorldSimulationRuntime_ACU>[0];

function fixture() {
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger.actors = [structuredClone(oldActor)];
  envelope.ledger.clock = { day: 6, slot: '暮', storyTime: '第六日', precision: 'exact', evidenceRefs: ['old-clock'] };
  envelope.ledger.historyMilestones = [{ id: 'history-1', summary: '旧时灯会', happenedAt: { day: 2, slot: '昼' }, actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] }];
  envelope.ledger.worldEvents = [{ id: 'event-1', title: '灯会', state: '筹办中', status: 'active', actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 6, slot: '暮' }, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
  envelope.ledger.facts = [{ id: 'fact-1', summary: '灯会场地已定', temporalKind: 'condition', happenedAt: null, validFrom: { day: 6, slot: '暮' }, validUntil: null, locationRef: null, actorIds: [], worldEventIds: ['event-1'], projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: { day: 7, slot: '暮', reason: '复核灯会场地' }, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
  envelope.settings.apiPresetMode = 'fixed';
  envelope.settings.fixedApiPresetName = 'worldbook-runtime-test';
  settings_ACU.apiPresets = [{ name: 'worldbook-runtime-test', apiMode: 'custom', tavernProfile: '', apiConfig: {
    url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test', apiKey: 'test', useMainApi: false,
    sendViaTavern: false, max_tokens: 128, temperature: 0.1, customApiFormat: 'openai_compat',
  } }];
  const chat: any[] = [
    { message_id: 0, is_user: true, mes: '开场', _qrf_world_simulation: envelope },
    { message_id: 1, is_user: false, swipe_id: 0, mes: '原始正文', message: '原始正文' },
  ];
  let activeChat = chat;
  let activeId = 'worldbook-runtime-chat';
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(activeChat); });
  const host = () => ({ chat: activeChat, chatId: activeId, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'worldbook-runtime.png', name: '角色' }],
    getCurrentChatId: () => activeId, saveChat });
  _set_SillyTavern_API_ACU(host() as any);
  const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => activeChat);
  const switchChat = () => {
    activeChat = structuredClone(chat);
    activeId = 'another-chat';
    _set_SillyTavern_API_ACU(host() as any);
  };
  return { chat, envelope, runtime, saveChat, switchChat, remote: () => remote };
}

function material(messages: readonly { content: string }[], key: string): any {
  const block = messages.map(item => { try { return JSON.parse(item.content); } catch { return null; } })
    .find(item => item && Object.prototype.hasOwnProperty.call(item, key));
  if (!block) throw new Error(`缺少 ${key} 资料`);
  return block[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orchestrator!.isInFlight).mockReturnValue(false);
  binding.mockResolvedValue({ primary: '山海志', additional: ['旧都录'], orderedNames: ['山海志', '旧都录'], apiSource: 'getCharWorldbookNames' });
  listBooks.mockImplementation(() => { throw new Error('禁止全库扫描'); });
  readEntries.mockImplementation(async (book: string) => book === '山海志'
    ? [{ uid: 7, comment: '青禾', content: '重要人物青禾' }, { uid: 9, comment: '旧友', content: '重要人物旧友' }]
    : [{ uid: 8, enabled: false, comment: '白露', content: '重要人物白露（已禁用条目）' }]);
  confirm.mockResolvedValue(true);
  model.mockImplementation(async (messages: readonly { content: string }[]) => {
    const context = material(messages, 'WORLD_RUNTIME_CONTEXT');
    expect(context.stage).toBe('worldbook-actor-scan');
    expect(context.ledger).toEqual(expect.objectContaining({
      clock: { day: 6, slot: '暮', storyTime: '第六日', precision: 'exact', evidenceRefs: ['old-clock'] },
      worldEvents: expect.arrayContaining([expect.objectContaining({ id: 'event-1' })]),
      facts: expect.arrayContaining([expect.objectContaining({ id: 'fact-1' })]),
      historyMilestones: expect.arrayContaining([expect.objectContaining({ id: 'history-1' })]),
    }));
    expect(context.existingActors).toContainEqual(oldActor);
    const hits = material(messages, 'WORLDBOOK_HITS') as Array<{ bookName: string; uid: string; content: string; part?: number }>;
    expect(hits.map(hit => [hit.bookName, hit.uid, hit.content])).toEqual([
      ['山海志', '7', '重要人物青禾'], ['山海志', '9', '重要人物旧友'], ['旧都录', '8', '重要人物白露（已禁用条目）'],
    ]);
    expect(hits.every(hit => !Object.hasOwn(hit, 'part'))).toBe(true);
    return { content: JSON.stringify({ actors: [...newActors, existingCandidate] }), toolCalls: [] };
  });
});

afterEach(() => {
  settings_ACU.apiPresets = structuredClone(originalPresets);
  _set_SillyTavern_API_ACU(undefined);
});

describe('生产 runtime 世界书角色登记：真实扫描、归一化与普通宿主追加', () => {
  it('当前卡主书与附加书跨书读取禁用条目，逐人批准后仅变更 actors/revision 和派生帧，不运行普通轮次', async () => {
    const f = fixture();
    confirm.mockImplementation(async (actor: WorldActor_ACU) => actor.name === '青禾');
    const before = structuredClone(f.chat);
    const result = await f.runtime.scanWorldbookActors();
    expect(result).toEqual({ addedCount: 1, bookCount: 2, failedBookNames: [] });
    expect(binding).toHaveBeenCalledOnce();
    expect(listBooks).not.toHaveBeenCalled();
    expect(readEntries.mock.calls.map(([name]) => name)).toEqual(['山海志', '旧都录']);
    expect(model).toHaveBeenCalledOnce();
    expect(model.mock.calls.every(([, , , , options]) => options?.tools?.length === 0)).toBe(true);
    expect(confirm.mock.calls.map(([actor]) => actor.name)).toEqual(['青禾', '白露']);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      currentAction: { text: '整理旧书', expectedDuration: '一晚', startedAtDay: 6, startedAt: '第六日' },
      shortTermAction: { text: '拜访书商', expectedDuration: '一天', status: 'ongoing', startedAtDay: 6, startedAt: '第六日' },
      longTermAction: { text: '拜访书商', expectedDuration: '一天', status: 'ongoing', startedAtDay: 6, startedAt: '第六日' },
      goals: ['编纂游记'], knownFacts: [], experiences: [],
    });
    expect(f.saveChat).toHaveBeenCalledTimes(1);
    expect(f.remote()).toEqual(f.chat);
    const ledger = foldWorldSimulationLedger_ACU(f.chat, 1)!.ledger;
    expect(ledger.actors.map(actor => actor.name)).toEqual(['旧友', '青禾']);
    expect(ledger.actors[0]).toEqual(oldActor);
    expect(ledger.actors[1]).toMatchObject({ loreRefs: ['山海志#7'], interests: ['读书'], revision: 1,
      currentAction: { text: '整理旧书', startedAtDay: 6, startedAt: '第六日' },
      shortTermAction: { text: '拜访书商', startedAtDay: 6, startedAt: '第六日' },
      longTermAction: { text: '拜访书商', startedAtDay: 6, startedAt: '第六日' },
      goals: ['编纂游记'], knownFacts: [], experiences: [],
    });
    expect(ledger.revision).toBe(before[0]._qrf_world_simulation.ledger.revision + 1);
    for (const key of Object.keys(ledger) as Array<keyof typeof ledger>) {
      if (key !== 'actors' && key !== 'revision') expect(ledger[key]).toEqual(before[0]._qrf_world_simulation.ledger[key]);
    }
    expect(f.chat[0]._qrf_world_simulation.task).toEqual(before[0]._qrf_world_simulation.task);
    expect(f.chat[0]._qrf_world_simulation.timeline).toEqual(before[0]._qrf_world_simulation.timeline);
    expect(f.chat[1].mes).toBe(before[1].mes);
    expect(f.chat[1].message).toBe(before[1].message);
    expect(f.chat[1]._qrf_world_simulation_state).toBeDefined();
    expect((orchestrator as any).start).not.toHaveBeenCalled();
    expect((orchestrator as any).resume).not.toHaveBeenCalled();
    // 同一本书、同样候选再次点击，真实 append 判重，不覆写既有角色或再保存。
    const persisted = structuredClone(f.chat);
    expect(await f.runtime.scanWorldbookActors()).toEqual({ addedCount: 0, bookCount: 2, failedBookNames: [] });
    expect(model).toHaveBeenCalledTimes(2);
    expect(f.chat).toEqual(persisted);
    expect(f.saveChat).toHaveBeenCalledTimes(1);
  });

  it('真实扫描一次模型请求返回四位斜杠来源新人，逐人确认并追加到远端且不改变世界其余状态', async () => {
    const f = fixture();
    const before = structuredClone(f.chat);
    readEntries.mockImplementation(async (book: string) => book === '山海志'
      ? [{ uid: 7, comment: '青禾', content: '青禾在书房' }, { uid: 9, comment: '林溪', content: '林溪在河边' }]
      : [{ uid: 8, comment: '白露', content: '白露在渡口' }, { uid: 10, comment: '南枝', content: '南枝在集市' }]);
    const expected = [
      ['青禾', '山海志#7'], ['林溪', '山海志#9'],
      ['白露', '旧都录#8'], ['南枝', '旧都录#10'],
    ];
    model.mockImplementationOnce(async (messages: readonly { content: string }[]) => {
      expect(material(messages, 'WORLD_RUNTIME_CONTEXT').ledger).toEqual(before[0]._qrf_world_simulation.ledger);
      expect(material(messages, 'WORLDBOOK_HITS').map((hit: { bookName: string; uid: string }) => `${hit.bookName}#${hit.uid}`))
        .toEqual(expected.map(([, ref]) => ref));
      return { content: JSON.stringify({ actors: expected.map(([name, ref]) => ({
        name, loreRefs: [ref.replace('#', '/')], currentAction: { text: '处理眼前事务' },
      })) }), toolCalls: [] };
    });
    confirm.mockResolvedValue(true);
    const result = await f.runtime.scanWorldbookActors();
    expect(result).toEqual({ addedCount: 4, bookCount: 2, failedBookNames: [] });
    expect(model).toHaveBeenCalledOnce();
    expect(model.mock.calls[0][4]?.tools).toHaveLength(0);
    expect(confirm).toHaveBeenCalledTimes(4);
    expect(confirm.mock.calls.map(([actor]) => [actor.name, actor.loreRefs])).toEqual(expected.map(([name, ref]) => [name, [ref]]));
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.remote()).toEqual(f.chat);
    const ledger = foldWorldSimulationLedger_ACU(f.remote(), 1)!.ledger;
    expect(ledger.actors[0]).toEqual(oldActor);
    expect(ledger.actors.slice(1).map(actor => [actor.name, actor.loreRefs, actor.currentAction?.startedAtDay]))
      .toEqual(expected.map(([name, ref]) => [name, [ref], 6]));
    expect(ledger.revision).toBe(before[0]._qrf_world_simulation.ledger.revision + 1);
    for (const key of Object.keys(ledger) as Array<keyof typeof ledger>) {
      if (key !== 'actors' && key !== 'revision') expect(ledger[key]).toEqual(before[0]._qrf_world_simulation.ledger[key]);
    }
    expect(f.chat[0]._qrf_world_simulation.task).toEqual(before[0]._qrf_world_simulation.task);
    expect(f.chat[0]._qrf_world_simulation.timeline).toEqual(before[0]._qrf_world_simulation.timeline);
    expect(f.chat[1].mes).toBe(before[1].mes);
    expect(f.chat[1].message).toBe(before[1].message);
    expect((orchestrator as any).start).not.toHaveBeenCalled();
    expect((orchestrator as any).resume).not.toHaveBeenCalled();
  });

  it('所有新角色被拒绝时完全不触发宿主保存', async () => {
    const f = fixture();
    const before = structuredClone(f.chat);
    confirm.mockResolvedValue(false);
    expect(await f.runtime.scanWorldbookActors()).toEqual({ addedCount: 0, bookCount: 2, failedBookNames: [] });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(model).toHaveBeenCalledOnce();
    expect(f.chat).toEqual(before);
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('等待确认时停止中止且不保存；重复点击在途时直接拒绝', async () => {
    const f = fixture();
    let waiting!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { waiting = resolve; });
    confirm.mockImplementation(() => pending);
    const scan = f.runtime.scanWorldbookActors();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(f.runtime.isInFlight()).toBe(true);
    await expect(f.runtime.scanWorldbookActors()).rejects.toThrow('正在运行');
    const stop = f.runtime.stop();
    waiting(true);
    expect(await stop).toBe(true);
    expect(await scan).toBeNull();
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.chat[0]._qrf_world_simulation.ledger.actors).toEqual([oldActor]);
  });

  it('主页面确认等待期间切换聊天会立即取消，结束后移除事件监听', async () => {
    const f = fixture();
    const listeners = new Set<() => void>();
    const eventSource = { on: vi.fn((_event, callback) => listeners.add(callback)),
      removeListener: vi.fn((_event, callback) => listeners.delete(callback)) };
    _set_SillyTavern_API_ACU({ chat: f.chat, getCurrentChatId: () => 'worldbook-runtime-chat',
      saveChat: f.saveChat, eventSource, eventTypes: { CHAT_CHANGED: 'chat-changed' } } as any);
    confirm.mockImplementation((_actor, signal: AbortSignal) => new Promise<boolean>(resolve => {
      signal.addEventListener('abort', () => resolve(false), { once: true });
    }));
    const scan = f.runtime.scanWorldbookActors();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    for (const listener of listeners) listener();
    await expect(scan).resolves.toBeNull();
    expect(listeners.size).toBe(0);
    expect(eventSource.removeListener).toHaveBeenCalledOnce();
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('普通推演已有在途任务时拒绝启动扫描，不读取世界书或保存', async () => {
    const f = fixture();
    vi.mocked(orchestrator!.isInFlight).mockReturnValueOnce(true);
    await expect(f.runtime.scanWorldbookActors()).rejects.toThrow('正在运行');
    expect(binding).not.toHaveBeenCalled();
    expect(listBooks).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('世界书读取期间切换聊天，旧任务返回 null，不对任何聊天保存', async () => {
    const f = fixture();
    const before = structuredClone(f.chat);
    let release!: (entries: unknown[]) => void;
    readEntries.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const scan = f.runtime.scanWorldbookActors();
    await vi.waitFor(() => expect(readEntries).toHaveBeenCalledOnce());
    f.switchChat();
    release([{ uid: 7, content: '青禾' }]);
    expect(await scan).toBeNull();
    expect(model).not.toHaveBeenCalled();
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.chat).toEqual(before);
  });
});
