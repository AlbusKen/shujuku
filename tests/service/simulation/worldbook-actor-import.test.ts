import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanWorldbookActors_ACU } from '../../../src/service/simulation/worldbook-actor-import';
import type { WorldActor_ACU, WorldSimulationLedger_ACU, WorldSimulationSettings_ACU } from '../../../src/service/simulation/model';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { getLorebookEntriesRequired_ACU, listLorebooks_ACU } from '../../../src/data/gateways/worldbook-gateway';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../../src/data/gateways/character-gateway';

vi.mock('../../../src/data/gateways/worldbook-gateway', async original => ({
  ...await original<typeof import('../../../src/data/gateways/worldbook-gateway')>(),
  listLorebooks_ACU: vi.fn(), getLorebookEntriesRequired_ACU: vi.fn(),
}));
vi.mock('../../../src/data/gateways/character-gateway', async original => ({
  ...await original<typeof import('../../../src/data/gateways/character-gateway')>(),
  getCurrentCharacterWorldbookBinding_ACU: vi.fn(),
}));
const list = vi.mocked(listLorebooks_ACU);
const binding = vi.mocked(getCurrentCharacterWorldbookBinding_ACU);
const get = vi.mocked(getLorebookEntriesRequired_ACU);
function bind(primary: string | null, additional: string[] = []) {
  binding.mockResolvedValue({ primary, additional, orderedNames: [...new Set([primary, ...additional].filter((name): name is string => !!name))], apiSource: 'getCharWorldbookNames' });
}
const settings = { agentHistoryTokenBudget: 6000, agentReadTokenBudget: 2500, agentReadFallbackTokens: 500 } as WorldSimulationSettings_ACU;
const run = (invoke: (messages: readonly { role: string; content: string }[]) => Promise<string>, actors: WorldActor_ACU[] = [], custom = settings, ledger?: WorldSimulationLedger_ACU) =>
  scanWorldbookActors_ACU({ settings: custom, actors, ledger, signal: new AbortController().signal, isCurrent: () => true, invoke });
function material(messages: readonly { content: string }[], key: string): any {
  const block = messages.map(item => { try { return JSON.parse(item.content); } catch { return null; } })
    .find(item => item && Object.prototype.hasOwnProperty.call(item, key));
  if (!block) throw new Error(`缺少 ${key} 资料`);
  return block[key];
}

beforeEach(() => { vi.resetAllMocks(); list.mockImplementation(() => { throw new Error('禁止全库扫描'); }); });
describe('世界书人物手动扫描', () => {
  it('只扫描当前卡绑定的主书与附加书全部条目（含禁用），单书失败继续，限制来源并以账本时钟记录合理行动', async () => {
    bind('主书', ['不可读', '附加书']);
    get.mockImplementation(async name => {
      if (name === '不可读') throw new Error('host failed');
      // 宿主中还存在“无关书”，但只有当前卡绑定的书允许进入扫描。
      if (name === '无关书') return [{ uid: 7, content: '无关人物' }];
      return [{ uid: 7, comment: '人物', enabled: false, content: `${name}：青禾` }];
    });
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock = { day: 6, slot: '暮', storyTime: '第六日暮', precision: 'exact', evidenceRefs: ['clock-ref'] };
    const invoke = vi.fn(async messages => {
      const context = material(messages, 'WORLD_RUNTIME_CONTEXT');
      expect(context.stage).toBe('worldbook-actor-scan');
      expect(context.ledger).toEqual(ledger);
      expect(material(messages, 'WORLDBOOK_HITS')).toEqual([
        expect.objectContaining({ bookName: '主书', uid: '7', content: '主书：青禾' }),
        expect.objectContaining({ bookName: '附加书', uid: '7', content: '附加书：青禾' }),
      ]);
      return '结果如下\n```json\n{"actors":{"name":"青禾","interests":"读书","knownFacts":["未来秘密"],"experiences":[{"text":"伪造经历"}],"currentAction":{"text":"在书房整理手稿","expectedDuration":"一晚","startedAtDay":999,"startedAt":"伪造时间"},"shortTermAction":{"text":"次日拜访藏书阁","expectedDuration":"一天","status":"ongoing","startedAtDay":999,"startedAt":"伪造时间"},"longTermAction":{"text":"次日拜访藏书阁","expectedDuration":"一天","status":"ongoing","startedAtDay":999,"startedAt":"伪造时间"},"goals":["编纂地方志"],"loreRefs":["主书#7","附加书#7","无关书#7","伪造#1"]}}\n```';
    });
    const result = await run(invoke, [], settings, ledger);
    expect(binding).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
    expect(get.mock.calls.map(([name]) => name)).toEqual(['主书', '不可读', '附加书']);
    expect(get).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.bookCount).toBe(2);
    expect(result.failedBookNames).toEqual(['不可读']);
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0]).toMatchObject({ name: '青禾', loreRefs: ['主书#7', '附加书#7'], knownFacts: [], experiences: [], interests: ['读书'], resources: [], visibility: 'hidden', revision: 1 });
    expect(result.actors[0].currentAction).toMatchObject({ text: '在书房整理手稿', expectedDuration: '一晚', startedAtDay: 6, startedAt: '第六日暮' });
    expect(result.actors[0].shortTermAction).toMatchObject({ text: '次日拜访藏书阁', expectedDuration: '一天', status: 'ongoing', startedAtDay: 6, startedAt: '第六日暮' });
    expect(result.actors[0].longTermAction).toMatchObject({ text: '次日拜访藏书阁', expectedDuration: '一天', status: 'ongoing', startedAtDay: 6, startedAt: '第六日暮' });
    expect(result.actors[0].goals).toEqual(['编纂地方志']);
    expect(result.actors[0]).not.toHaveProperty('previousActionResult');
  });
  it('重复扫描稳定跳过已有来源，缺日期的已故人物不虚构死亡日', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 2, content: '甲与乙' }]);
    const invoke = vi.fn(async () => '{"actors":[{"name":"甲","life":"dead","diedAtDay":12,"loreRefs":["书#2"]},{"name":"乙","life":"dead","loreRefs":["书#2"]}]}');
    const first = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(first.actors).toEqual([expect.objectContaining({ name: '甲', life: 'dead', diedAtDay: 12, deathSummary: '世界书记载已故', simulationStatus: 'archived' })]);
    const second = await run(invoke, first.actors);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(second.actors).toEqual([]);
  });
  it('混合已有人物、坏项与新人只返回新人，归一姓名与模型 ID 宽容匹配', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 1, content: '甲乙丙' }]);
    const existing = [
      { id: '42', name: 'Ａ 甲', loreRefs: ['书#1'], interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null, simulationStatus: 'active', experiences: [], revision: 1 },
      { id: 'old', name: '乙', loreRefs: ['其他#3'], interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null, simulationStatus: 'active', experiences: [], revision: 1 },
    ] as WorldActor_ACU[];
    const invoke = vi.fn(async messages => {
      expect(material(messages, 'WORLD_RUNTIME_CONTEXT').existingActors).toEqual(existing);
      return '{"actors":[{"name":"A 甲","loreRefs":["书#1"]},{"name":"乙","existingActorId":42,"loreRefs":["书#1"]},{"name":null,"loreRefs":["书#1"]},{"name":"丙","loreRefs":["书#1"]}]}';
    });
    const result = await run(invoke, existing);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors.map(actor => actor.name)).toEqual(['丙']);
  });
  it.each([
    ['井号', '书#4', ['书#4']],
    ['斜杠', '书/4', ['书#4']],
    ['全角斜杠', '书／4', ['书#4']],
    ['全角井号', '书＃4', ['书#4']],
    ['半角冒号', '书:4', ['书#4']],
    ['全角冒号', '书：4', ['书#4']],
    ['分隔符周边空格', ' 书  /  4 ', ['书#4']],
    ['对象书名在前', { bookName: '书', uid: 4 }, ['书#4']],
    ['对象 UID 在前', { uid: 4, bookName: '书' }, ['书#4']],
    ['单书数字 UID', 4, ['书#4']],
    ['单书纯数字字符串', '4', ['书#4']],
    ['无法匹配的引用但标题对应姓名', '不存在/4', ['书#4']],
    ['空引用但标题对应姓名', null, ['书#4']],
  ] as const)('来源引用归一：%s', async (_label, ref, expectedRefs) => {
    bind('书'); get.mockResolvedValue([{ uid: 4, comment: '青禾', content: '青禾在书房整理手稿' }]);
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock = { day: 6, slot: '暮', storyTime: '第六日暮', precision: 'exact', evidenceRefs: [] };
    const original = structuredClone(ledger);
    const invoke = vi.fn(async () => JSON.stringify({ actors: [{ name: '青禾', loreRefs: ref,
      currentAction: { text: '整理手稿', startedAtDay: 999, startedAt: '伪造时间' } }] }));
    const result = await run(invoke, [], settings, ledger);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0]).toMatchObject({ name: '青禾', loreRefs: expectedRefs, life: 'alive', simulationStatus: 'active',
      currentAction: { text: '整理手稿', startedAtDay: 6, startedAt: '第六日暮' } });
    expect(ledger).toEqual(original);
    expect(list).not.toHaveBeenCalled();
  });
  it('多书纯 UID 仅在唯一可匹配时补齐来源；歧义不猜书名也不丢有效新人', async () => {
    bind('主书', ['附加书']);
    get.mockImplementation(async book => book === '主书'
      ? [{ uid: 4, content: '主书人物' }, { uid: 5, content: '共享编号' }]
      : [{ uid: 5, content: '共享编号' }]);
    const invoke = vi.fn(async () => JSON.stringify({ actors: [
      { name: '甲', loreRefs: 4 }, { name: '乙', loreRefs: '5' },
    ] }));
    const result = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors.map(actor => [actor.name, actor.loreRefs])).toEqual([['甲', ['主书#4']], ['乙', []]]);
  });
  it.each([
    ['单条引用字符串', { name: '青禾', loreRefs: '书/4' }, ['书#4']],
    ['显式 null 引用', { name: '青禾', loreRefs: null }, ['书#4']],
    ['缺失引用', { name: '青禾' }, ['书#4']],
    ['混合无效和有效引用', { name: '青禾', loreRefs: ['未知书/4', '书/4'] }, ['书#4']],
  ] as const)('有效姓名不因来源缺失或噪声被整行丢弃：%s', async (_label, candidate, expectedRefs) => {
    bind('书'); get.mockResolvedValue([{ uid: 4, comment: '青禾', content: '青禾在场' }]);
    const invoke = vi.fn(async () => JSON.stringify({ actors: [candidate] }));
    const result = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0].name).toBe('青禾');
    expect(result.actors[0].loreRefs).toEqual(expectedRefs);
  });
  it.each([
    ['标题不对应姓名', [{ uid: 4, comment: '风土', content: '青禾在场' }]],
    ['多个同名标题有歧义', [{ uid: 4, comment: '青禾', content: '青禾在场' }, { uid: 5, comment: '青禾', content: '青禾也在场' }]],
  ] as const)('无可信来源时保留有姓名新人但不猜引用：%s', async (_label, entries) => {
    bind('书'); get.mockResolvedValue([...entries]);
    const invoke = vi.fn(async () => JSON.stringify({ actors: [{ name: '青禾', loreRefs: ['未知书/4'] }] }));
    const result = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0]).toMatchObject({ name: '青禾', loreRefs: [] });
  });
  it.each([
    ['标准对象包数组', (row: unknown) => ({ actors: [row] })],
    ['actors 单对象', (row: unknown) => ({ actors: row })],
    ['顶层数组', (row: unknown) => [row]],
    ['登记包装对象', (row: unknown) => ({ actorRegistrations: [{ value: row }] })],
    ['snake_case 与英文姓名别名', () => ({ actors: [{ characterName: '青禾', lore_refs: ['书/4'], current_action: '整理手稿' }] })],
    ['中文姓名别名', () => ({ actors: [{ 姓名: '青禾', loreRefs: ['书/4'] }] })],
  ] as const)('模型返回包装与字段别名：%s', async (_label, wrap) => {
    bind('书'); get.mockResolvedValue([{ uid: 4, comment: '青禾', content: '青禾在场' }]);
    const invoke = vi.fn(async () => JSON.stringify(wrap({ name: '青禾', loreRefs: ['书/4'] })));
    const result = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0]).toMatchObject({ name: '青禾', loreRefs: ['书#4'] });
  });
  it('坏行、重复在册 ID 不妨碍同批新人；仅共享明确来源且同名才去重', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 4, content: '甲乙丙是不同人物' }]);
    const existing = { id: 'already-here', name: '旧友', loreRefs: ['书#4'], interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [],
      knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
      simulationStatus: 'active', experiences: [], revision: 1 } as WorldActor_ACU;
    const invoke = vi.fn(async () => JSON.stringify({ actors: [
      null, { name: null }, { name: '伪造死亡日', life: 'dead', loreRefs: '书/4' },
      { id: 'already-here', name: '冒用 ID', loreRefs: '书/4' },
      { name: '旧友', existingActorId: 'already-here', loreRefs: '书/4' },
      { name: '甲', loreRefs: '书/4' }, { name: '乙', loreRefs: '书/4' },
      { name: '丙', loreRefs: ['无关书/4'] },
    ] }));
    const result = await run(invoke, [existing]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors.map(actor => [actor.name, actor.loreRefs])).toEqual([
      ['甲', ['书#4']], ['乙', ['书#4']], ['丙', []],
    ]);
  });
  it('唯一请求携带完整账本、所有长条目且不分段截断', async () => {
    bind('书');
    const texts = ['甲'.repeat(1500) + '首条后半标记' + '乙'.repeat(1500), '丙'.repeat(1400) + '次条后半标记' + '丁'.repeat(1400)];
    get.mockResolvedValue(texts.map((content, index) => ({ uid: index + 1, content })));
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock = { day: 8, slot: '夜', storyTime: '第八日夜', precision: 'exact', evidenceRefs: ['clock-ref'] };
    ledger.worldEvents = [{ id: 'event-1', title: '灯会', state: '筹办中', status: 'active', actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 8, slot: '夜' }, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1 }];
    ledger.facts = [{ id: 'fact-1', summary: '灯会场地已定', temporalKind: 'condition', happenedAt: null, validFrom: { day: 8, slot: '夜' }, validUntil: null, locationRef: null, actorIds: [], worldEventIds: ['event-1'], projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    ledger.historyMilestones = [{ id: 'history-1', summary: '旧时灯会', happenedAt: { day: 2, slot: '昼' }, actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const invoke = vi.fn(async messages => {
      const context = material(messages, 'WORLD_RUNTIME_CONTEXT');
      expect(context).toEqual({ stage: 'worldbook-actor-scan', ledger, existingActors: [] });
      const hits = material(messages, 'WORLDBOOK_HITS');
      expect(hits).toHaveLength(2);
      expect(hits.map((hit: { content: string }) => hit.content)).toEqual(texts);
      expect(hits.every((hit: Record<string, unknown>) => !Object.hasOwn(hit, 'part'))).toBe(true);
      return '{"actors":[]}';
    });
    const result = await run(invoke, [], { ...settings, agentHistoryTokenBudget: 2000, agentReadTokenBudget: 900 }, ledger);
    expect(result).toEqual({ actors: [], bookCount: 1, failedBookNames: [] });
    expect(invoke).toHaveBeenCalledOnce();
  });
  it('模型返回空候选时一次调用且不登记', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 5, content: '甲' }]);
    const invoke = vi.fn(async () => '{"actors":[]}');
    const result = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors).toEqual([]);
  });
  it('当前卡绑定的世界书全部读取失败显式抛错', async () => {
    bind('坏书'); get.mockRejectedValue(new Error('cannot read'));
    await expect(run(async () => '{"actors":[]}')).rejects.toThrow('所有世界书读取失败');
  });
  it('同名且共享来源才程序去重，不因同名合并不同身份', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 1, content: '同名两人' }, { uid: 2, content: '另一人' }]);
    const invoke = vi.fn(async () => '{"actors":[{"name":"青禾","loreRefs":["书#1"]},{"name":"青禾","loreRefs":["书#2"]},{"name":"青禾","loreRefs":["书#1"]}]}');
    const result = await run(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.actors.map(actor => actor.loreRefs)).toEqual([['书#1'], ['书#2']]);
  });
  it('绑定书读取成功但无有效非空条目时不调用模型', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 1, content: '  ' }, { uid: 2, content: '' }]);
    const invoke = vi.fn();
    expect(await run(invoke)).toEqual({ actors: [], bookCount: 1, failedBookNames: [] });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('模型标注已在册 ID 时不重登，取消时不调用模型', async () => {
    bind('书'); get.mockResolvedValue([{ uid: 1, content: '人物甲' }]);
    const existing = { id: 'person-1', name: '人物甲', loreRefs: ['书#1'] } as WorldActor_ACU;
    const result = await run(async () => '{"actors":[{"name":"人物甲","existingActorId":"person-1","loreRefs":["书#1"]}]}', [existing]);
    expect(result.actors).toEqual([]);
    const invoke = vi.fn();
    await expect(scanWorldbookActors_ACU({ settings, actors: [], signal: AbortSignal.abort(), isCurrent: () => true, invoke })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('未绑定世界书时不读全库、不调用模型', async () => {
    bind(null);
    const invoke = vi.fn();
    expect(await run(invoke)).toEqual({ actors: [], bookCount: 0, failedBookNames: [] });
    expect(binding).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('绑定读取失败时传播异常，不回退全库', async () => {
    binding.mockRejectedValue(new Error('binding unavailable'));
    const invoke = vi.fn();
    await expect(run(invoke)).rejects.toThrow('binding unavailable');
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('主书与附加书同名时只读取一次', async () => {
    bind('书', ['书', '附加书', '附加书']);
    get.mockResolvedValue([]);
    const invoke = vi.fn();
    const result = await run(invoke);
    expect(result.bookCount).toBe(2);
    expect(get.mock.calls.map(([name]) => name)).toEqual(['书', '附加书']);
    expect(list).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
