/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, shallowRef } from 'vue';
import WorldSimulationMaterialsPanel from '../../src/presentation-v2/components/WorldSimulationMaterialsPanel.vue';
import { buildEmptyWorldSimulationLedger_ACU } from '../../src/service/simulation/defaults';
import type { WorldSimulationLedger_ACU } from '../../src/service/simulation/model';

const mounted: Array<() => void> = [];
afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); });

function mountPanel(ledger: WorldSimulationLedger_ACU | null, onClear = vi.fn(), onDeleteActor = vi.fn(), onScanWorldbooks = vi.fn(), onDeleteWorldEvent = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const panel = ref<InstanceType<typeof WorldSimulationMaterialsPanel> | null>(null);
  const currentLedger = shallowRef(ledger);
  const busy = ref(false);
  const app = createApp({
    setup: () => () => h(WorldSimulationMaterialsPanel, {
      ref: panel, fieldSnapshot: { records: {} }, ledger: currentLedger.value, busy: busy.value, onClear, onDeleteActor, onScanWorldbooks, onDeleteWorldEvent,
    }),
  });
  app.mount(host);
  mounted.push(() => { app.unmount(); host.remove(); });
  return { host, panel, currentLedger, busy };
}

function button(host: Element, label: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes(label))!;
}

describe('世界推演 v7 资料面板', () => {
  it('世界事件逐条删除：取消不触发、忙碌禁用、失败保留确认、成功刷新只移除目标事件', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const event = (id: string, title: string): typeof ledger.worldEvents[number] => ({
      id, title, state: '', status: 'active', actorIds: [], organizationIds: [], locationRefs: [],
      startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null,
    });
    ledger.worldEvents = [event('event-a', '夜市开张'), event('event-b', '春日集市')];
    const onDeleteWorldEvent = vi.fn();
    const { host, currentLedger, busy } = mountPanel(ledger, vi.fn(), vi.fn(), vi.fn(), onDeleteWorldEvent);
    const card = () => Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__entry'))
      .find(item => item.querySelector('summary')?.textContent?.includes('夜市开张'));
    expect(card()?.querySelector('summary button')).toBeNull();
    button(card()!, '删除').click();
    await nextTick();
    expect(card()?.textContent).toContain('只删除此事件及结构引用，事实、历史和正文保留；不保证后续推演不会再次生成。');
    button(card()!, '取消').click();
    await nextTick();
    expect(onDeleteWorldEvent).not.toHaveBeenCalled();
    busy.value = true;
    await nextTick();
    expect(button(card()!, '删除').disabled).toBe(true);
    busy.value = false;
    await nextTick();
    button(card()!, '删除').click();
    await nextTick();
    button(card()!, '确认删除').click();
    expect(onDeleteWorldEvent).toHaveBeenCalledExactlyOnceWith('event-a');
    busy.value = true;
    await nextTick();
    expect(button(card()!, '确认删除').disabled).toBe(true);
    expect(button(card()!, '取消').disabled).toBe(true);
    button(card()!, '确认删除').click();
    expect(onDeleteWorldEvent).toHaveBeenCalledOnce();
    busy.value = false;
    await nextTick();
    expect(card()?.textContent).toContain('确认删除');
    currentLedger.value = { ...ledger, worldEvents: [ledger.worldEvents[1]] };
    await nextTick();
    expect(card()).toBeUndefined();
    expect(host.textContent).toContain('春日集市');
    expect(host.textContent).not.toContain('确认删除');
  });

  it('人物详情删除需确认，取消不触发，忙碌禁用，失败保留确认而成功刷新只移除目标人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const actor = (id: string, name: string): WorldSimulationLedger_ACU['actors'][number] => ({
      id, name, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: '',
      resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'public',
      currentAction: null, shortTermAction: null, longTermAction: null, simulationStatus: 'active', experiences: [], revision: 1,
    });
    ledger.actors = [actor('actor-a', '阿岚'), actor('actor-b', '小川')];
    ledger.worldEvents = [{ id: 'event-a', title: '夜市开张', state: '', status: 'active', actorIds: ['actor-a'], organizationIds: [], locationRefs: [], startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
    const onDeleteActor = vi.fn();
    const { host, currentLedger, busy } = mountPanel(ledger, vi.fn(), onDeleteActor);
    const cards = () => Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__entry'));
    const target = cards().find(item => item.querySelector('summary')?.textContent?.includes('阿岚'))!;
    expect(target.open).toBe(false);
    expect(target.querySelector('summary button')).toBeNull();
    expect(target.querySelector('button')).not.toBeNull();
    target.open = true;
    button(target, '删除').click();
    await nextTick();
    expect(target.textContent).toContain('删除阿岚？只删除此人物及关联引用，事件、事实、历史和正文保留。正文再次出现时可能重新登记。');
    expect(onDeleteActor).not.toHaveBeenCalled();
    button(target, '取消').click();
    await nextTick();
    expect(onDeleteActor).not.toHaveBeenCalled();
    expect(target.textContent).not.toContain('确认删除');
    busy.value = true;
    await nextTick();
    expect(button(target, '删除').disabled).toBe(true);
    busy.value = false;
    await nextTick();
    button(target, '删除').click();
    await nextTick();
    button(target, '确认删除').click();
    await nextTick();
    expect(onDeleteActor).toHaveBeenCalledExactlyOnceWith('actor-a');
    expect(target.textContent).toContain('确认删除');
    busy.value = true;
    await nextTick();
    expect(button(target, '确认删除').disabled).toBe(true);
    expect(button(target, '取消').disabled).toBe(true);
    button(target, '确认删除').click();
    expect(onDeleteActor).toHaveBeenCalledOnce();
    busy.value = false;
    await nextTick();
    expect(target.textContent).toContain('确认删除');
    currentLedger.value = { ...ledger, actors: [ledger.actors[1]] };
    await nextTick();
    expect(host.textContent).not.toContain('阿岚');
    expect(host.textContent).toContain('小川');
    expect(host.textContent).toContain('夜市开张');
    expect(host.textContent).not.toContain('确认删除');
  });

  it('人物谱摘要展示上一轮结果，旧档缺值与空白回退为无，长文本原样换行且不执行 HTML', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const actor = (id: string, name: string): WorldSimulationLedger_ACU['actors'][number] => ({
      id, name, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: '',
      resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'public',
      currentAction: null, shortTermAction: null, longTermAction: null, simulationStatus: 'active', experiences: [], revision: 1,
    });
    const longResult = `已经完成清点，记录如下：\n${'未分隔的长条目'.repeat(40)}<img src=x onerror=alert(1)>`;
    ledger.actors = [
      Object.assign(actor('with-result', '有进展'), { previousActionResult: longResult }),
      actor('legacy', '旧档缺值'),
      Object.assign(actor('blank', '空白结果'), { previousActionResult: '  \n\t  ' }),
    ];
    const { host, currentLedger } = mountPanel(ledger);
    await nextTick();
    const resultFor = (name: string) => Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__entry'))
      .find(item => item.querySelector('summary')?.textContent?.includes(name))!
      .querySelector<HTMLElement>('.acu-v2-ws-materials__entry-result')!;
    expect(resultFor('有进展').textContent).toBe(`上一轮行动的结果：${longResult}`);
    expect(resultFor('有进展').querySelector('img')).toBeNull();
    expect(resultFor('旧档缺值').textContent).toBe('上一轮行动的结果：无');
    expect(resultFor('空白结果').textContent).toBe('上一轮行动的结果：无');
    currentLedger.value = { ...ledger, actors: [Object.assign(actor('with-result', '有进展'), { previousActionResult: '已确认现场。' })] };
    await nextTick();
    expect(resultFor('有进展').textContent).toBe('上一轮行动的结果：已确认现场。');
  });

  it('行动没有预计时长时只显示行动本身，不补“未定”', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const base: WorldSimulationLedger_ACU['actors'][number] = {
      id: 'no-duration', name: '无时长', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: '',
      resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'public',
      currentAction: { text: '在图书馆查资料', expectedDuration: '  ', startedAtDay: 1, startedAt: '' },
      shortTermAction: null, longTermAction: null, simulationStatus: 'active', experiences: [], revision: 1,
    };
    ledger.actors = [base];
    const { host } = mountPanel(ledger);
    await nextTick();
    const summary = host.querySelector<HTMLDetailsElement>('.acu-v2-ws-materials__entry')!.querySelector('summary')!.textContent!;
    expect(summary).toContain('当前动作：在图书馆查资料');
    expect(summary).not.toContain('未定');
    expect(summary).not.toContain('预计');
  });

  it('展示正式 v7 领域、空态与由 actorIds 派生的个人历史，保留 dead 与 archived 人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [{ id: 'event-1', title: '北境巡演', state: '正在搭台', status: 'active', actorIds: ['actor-dead'], organizationIds: [], locationRefs: [{ region: '北境', place: '广场' }], startedAt: { day: 3, slot: '晨' }, deadline: null, nextCheck: { day: 4, slot: '晨', reason: '核对进度' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
    ledger.actors = [{ id: 'actor-dead', name: '已故档案员', interests: [], location: '北境', locationRef: { region: '北境' }, life: 'dead', diedAtDay: 2, deathSummary: '旧字段', resources: ['旧档案'], goals: ['守住档案'], constraints: ['体力不足'], informationSources: ['地方信件'], knownFacts: ['北境近况'], visibility: 'hidden', currentAction: { text: '整理遗稿', expectedDuration: '一小时', startedAtDay: 1, startedAt: '第1天' }, shortTermAction: { text: '完成目录校对', expectedDuration: '三日', startedAtDay: 1, startedAt: '第1天', status: 'ongoing', outcome: null }, longTermAction: null, simulationStatus: 'archived', experiences: [], revision: 1 }];
    ledger.facts = [{ id: 'fact-public', summary: '广场正在搭台', temporalKind: 'condition', happenedAt: null, validFrom: { day: 3, slot: '晨' }, validUntil: null, locationRef: { region: '北境' }, actorIds: ['actor-dead'], worldEventIds: ['event-1'], projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    ledger.historyMilestones = [{ id: 'history-current', summary: '接管北境档案', happenedAt: { day: 2, slot: '夜' }, actorIds: ['actor-dead'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2, category: '身份', visibility: 'internal', revision: 1, legacyRefs: [] }];
    (ledger as WorldSimulationLedger_ACU & { historyArchive?: typeof ledger.historyMilestones }).historyArchive = [{ id: 'history-archive', summary: '旧档案迁移完成', happenedAt: { day: 1, slot: '' }, actorIds: ['actor-dead'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '迁移', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const { host } = mountPanel(ledger);
    await nextTick();

    const text = host.textContent ?? '';
    expect(text).toContain('世界事件');
    expect(text).toContain('故事时间');
    expect(host.querySelector('.acu-v2-ws-materials__tabs')).toBeNull();
    expect(Array.from(host.querySelectorAll('.acu-v2-ws-materials > details > summary > span')).map(item => item.textContent?.trim())).toEqual([
      '世界事件', '人物谱', '确定事实', '内部管理事实',
      '过期事件', '重要历史', '投送事件', '逐栏记录',
    ]);
    expect(text).not.toContain('暂无基线');
    expect(text).not.toContain('基线楼层');
    expect(text).not.toContain('冻结锚点');
    expect(text).not.toContain('账本修订');
    expect(text).not.toContain('v7 运行资料');
    expect(text).not.toContain('候选轨迹');
    expect(text).not.toContain('读取诊断');
    expect(text).toContain('人物谱');
    expect(text).toContain('确定事实');
    expect(text).toContain('重要历史');
    expect(text).toContain('已故档案员');
    expect(text).toContain('已归档');
    expect(text).toContain('已故');
    const event = host.querySelector<HTMLDetailsElement>('.acu-v2-ws-materials__block .acu-v2-ws-materials__entry')!;
    expect(event.open).toBe(false);
    expect(event.querySelector('summary')?.textContent).toContain('北境巡演');
    expect(event.querySelector('summary')?.textContent).toContain('进行中');
    expect(event.querySelector('summary')?.textContent).toContain('正在搭台');
    expect(event.querySelector('summary')?.textContent).not.toContain('参与者：');
    event.open = true;
    const eventFields = Array.from(event.querySelectorAll(':scope > .acu-v2-ws-materials__entry-detail > p')).map(item => item.textContent?.trim());
    expect(eventFields).toEqual(['参与者：actor-dead', '地点：北境／广场', '下次检查：第 4 天 · 晨（核对进度）']);
    const actor = Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__entry')).find(item => item.querySelector('summary')?.textContent?.includes('已故档案员'))!;
    expect(actor.open).toBe(false);
    expect(actor.querySelector('summary')?.textContent).toContain('位置：北境');
    const summaryLines = Array.from(actor.querySelectorAll(':scope > summary > span')).map(item => item.textContent?.trim());
    expect(summaryLines.slice(-3)).toEqual(['当前动作：整理遗稿（预计 一小时）', '上一轮行动的结果：无', '位置：北境']);
    expect(actor.querySelector('summary')?.textContent).not.toContain('短期目标：');
    actor.open = true;
    const actorFields = Array.from(actor.querySelectorAll(':scope > .acu-v2-ws-materials__entry-detail > p')).map(item => item.textContent?.trim());
    expect(actorFields).toEqual(['短期目标：完成目录校对（预计 三日）', '长期目标：守住档案', '资源：旧档案', '限制：体力不足']);
    const cognition = actor.querySelector<HTMLDetailsElement>('.acu-v2-ws-materials__timeline')!;
    expect(Array.from(cognition.querySelectorAll('p')).map(item => item.textContent?.trim())).toEqual(['信息渠道：地方信件', '已知事实：北境近况']);
    expect(text).toContain('个人重要历史');
    expect(text).toContain('接管北境档案');
    expect(text).toContain('旧档案迁移完成');
    expect(text).not.toContain('当前 1 条 · 归档 1 条');
    expect(host.querySelector('.acu-v2-ws-materials__overview')?.textContent).toContain('故事时间');
    expect(text).not.toContain('按 actorIds 派生');
    expect(text).not.toContain('事实是否进入正文');
  });

  it('锁定、gated 和内部事实摘要默认不进入 DOM，展开内部详情后才显示', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [{ id: 'fact-locked', summary: '默认不得出现的锁定摘要', temporalKind: 'condition', happenedAt: null, validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked', revealGate: { semanticCondition: '不得出现' }, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    const { host } = mountPanel(ledger);
    await nextTick();
    expect(host.textContent).not.toContain('默认不得出现的锁定摘要');
    expect(host.textContent).not.toContain('不得出现');
    const details = host.querySelector<HTMLDetailsElement>('.acu-v2-ws-materials__protected-facts')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();
    expect(host.textContent).toContain('默认不得出现的锁定摘要');
    expect(host.textContent).toContain('状态 锁定');
    expect(host.textContent).not.toContain('展开操作不会投送');
  });

  it('冷事实只在管理展开后显示，冷层独占账本不误报空且不恢复投送', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.factArchive = [{ id: 'cold-secret', summary: '冷层秘密原文', temporalKind: 'condition', happenedAt: null,
      validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' }, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'gated', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: ['原始来源'], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    const before = structuredClone(ledger);
    const { host } = mountPanel(ledger);
    await nextTick();
    expect(host.textContent).toContain('过期事件');
    expect(host.textContent).not.toContain('暂无运行资料');
    expect(host.textContent).not.toContain('冷层秘密原文');
    const details = host.querySelector<HTMLDetailsElement>('.acu-v2-ws-materials__archived-facts')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();
    expect(host.textContent).toContain('冷层秘密原文');
    expect(host.textContent).toContain('原始来源');
    expect(host.textContent).toContain('仍锁定');
    expect(ledger).toEqual(before);
  });

  it('投送事件与世界事件、人物谱同级展开，保留锚点、事实、次数和状态', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.projection = { anchor: 'anchor-1', deliveries: [{ factId: 'fact-1', status: 'acknowledged', attempts: 1 }] };
    const { host } = mountPanel(ledger);
    await nextTick();
    const summaries = Array.from(host.querySelectorAll('.acu-v2-ws-materials > details > summary > span'));
    expect(summaries.map(item => item.textContent?.trim()).slice(0, 3)).toEqual(['世界事件', '人物谱', '确定事实']);
    expect(summaries.map(item => item.textContent?.trim())).toContain('投送事件');
    expect(host.textContent).not.toContain('暂无运行资料');
    const text = host.textContent ?? '';
    expect(text).toContain('当前投送锚点：anchor-1');
    expect(text).toContain('事实 fact-1');
    expect(text).toContain('投送尝试 1 次');
    expect(text).toContain('已记录后继核对');
    expect(text).not.toContain('ledger.projection');
    expect(text).not.toContain('正文采用');
    expect(text).not.toContain('场外信号');
  });

  it('人物谱扫描按钮位于 summary 外，忙碌时禁用，空谱也能扫描', async () => {
    const onScanWorldbooks = vi.fn();
    const { host, busy } = mountPanel(buildEmptyWorldSimulationLedger_ACU(), vi.fn(), vi.fn(), onScanWorldbooks);
    const section = Array.from(host.querySelectorAll<HTMLDetailsElement>('.acu-v2-ws-materials__block'))
      .find(item => item.querySelector(':scope > summary')?.textContent?.includes('人物谱'))!;
    expect(section.querySelector('summary button')).toBeNull();
    expect(section.querySelector('button')?.textContent).toContain('扫描世界书');
    button(section, '扫描世界书').click();
    expect(onScanWorldbooks).toHaveBeenCalledOnce();
    busy.value = true;
    await nextTick();
    expect(button(section, '扫描世界书').disabled).toBe(true);
    button(section, '扫描世界书').click();
    expect(onScanWorldbooks).toHaveBeenCalledOnce();
  });

  it('空态与清空确认只显示必要文案，通过公开入口触发而无需顶部按钮', async () => {
    const onClear = vi.fn();
    const { host, panel } = mountPanel(null, onClear);
    await nextTick();
    expect(host.textContent).toContain('暂无运行资料');
    expect(host.textContent).not.toContain('首轮完成后');
    expect(host.textContent).not.toContain('用户要求');
    expect(host.textContent).not.toContain('暂无基线');
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(button(host, '扫描世界书')).toBeDefined();
    panel.value!.requestClear();
    await nextTick();
    expect(host.textContent).toContain('清空推演任务、世界账本、会话记录及资料快照；小说正文不变。');
    expect(host.textContent).toContain('确认清空');
    expect(host.textContent).not.toContain('清空后下一次');
    button(host, '取消').click();
    await nextTick();
    expect(onClear).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('确认清空');
    panel.value!.requestClear();
    await nextTick();
    button(host, '确认清空').click();
    await nextTick();
    expect(onClear).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain('确认清空');
  });

  it('不再展示旧兼容资料和迁移诊断，但读取不修改旧账本', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.dimensions = [{ id: 'dimension-1', name: '旧局势', kind: 'pressure', value: 2, trend: 'rising', rationale: '旧依据', evidenceRefs: [], revision: 1 }];
    ledger.legacyMigration.issues = [{ source: 'seed', sourceId: 'legacy-1', reason: 'missing_evidence' }];
    const before = structuredClone(ledger);
    const { host } = mountPanel(ledger);
    await nextTick();
    expect(host.textContent).not.toContain('旧兼容资料');
    expect(host.textContent).not.toContain('旧账本迁移诊断');
    expect(host.textContent).not.toContain('旧局势');
    expect(host.textContent).not.toContain('legacy-1');
    expect(host.textContent).toContain('世界事件');
    expect(ledger).toEqual(before);
  });
});
