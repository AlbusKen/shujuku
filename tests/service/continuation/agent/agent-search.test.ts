import { describe, expect, it } from 'vitest';

import { createAgentMatchSnippet_ACU, runAgentSearch_ACU } from '../../../../src/service/continuation/agent/agent-search';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentResolveContext_ACU } from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import type { AgentSearchCall_ACU } from '../../../../src/service/continuation/agent/agent-model';

function context_ACU(): AgentResolveContext_ACU {
  const moduleSnapshot = buildEmptyAgentModuleSnapshot_ACU();
  moduleSnapshot.storyArc = [{
    id: 'VOL-01', scope: 'volume', title: '禁区立足', direction: '在禁区边缘建立稳定据点', escalation: '收在据点获得自治权', withheld: '禁区核心真相', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '',
    narrativeRole: 'development',
    targetStageRange: { min: 4, max: 6 },
    targetTimeSpan: '三个月',
    progressCeiling: '只确认核心入口存在',
    sustainingThreads: ['经营据点与当地人的互信'],
    payoffTargets: ['兑现主角获得安全落脚点的期待'],
  }];
  moduleSnapshot.hooks = [
    { id: 'H1', summary: '守门人手中的黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3, plannedPayoff: '', retired: false } as any,
    { id: 'H2', summary: '铁门后的低语', status: 'planted', importance: 'mid', plantedIndex: 1, plannedPayoff: '', retired: true } as any,
  ];
  return {
    chat: [
      { mes: '我要进禁区', is_user: true },
      { mes: '主角推开铁门，黑色晶屑散落一地。' },
      { mes: '守门人挡在门后。\n他右手攥着黑色晶屑。' },
    ],
    moduleSnapshot,
    settledThroughIndex: 0,
    execution: {
      envelope: {} as any,
      task: { taskId: 't', originInstruction: '推进剧情' } as any,
      stage: { stageNumber: 1 } as any,
      revision: { outline: {
        title: '禁区试探',
        goal: '摸清晶屑来历',
        tempo: 'mixed',
        role: 'development',
        timeSpanGoal: '三日',
        totalTurns: 4,
        nodes: [{
          id: 'node-1',
          title: '试探',
          goal: '不揭穿',
          turns: [{
            id: 'turn-1', goal: '观察黑色晶屑的反应', pacing: 'setup', function: 'daily_world', mainlineDelta: 'hold', timeAdvance: 'days', timeAnchor: '第三日清晨',
          }],
        }],
      } } as any,
      node: null,
      turn: null,
      turnNumber: null,
      nodeTurnNumber: null,
    } as any,
    originInstruction: '推进剧情',
    recentTurnCount: 2,
    storyWindowFloors: 10,
    tableData: { s1: { name: '角色表', content: [['姓名', '状态'], ['林瑶', '右臂有伤，随身带黑色晶屑']] } },
    worldbook: {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '黑色晶屑是禁区核心的碎片。\n接触过久会侵蚀心智。', tokens: 20 }],
    },
  };
}

function call_ACU(overrides: Partial<AgentSearchCall_ACU> = {}): AgentSearchCall_ACU {
  return { kind: 'search', query: '黑色晶屑', scope: ['story', 'tables', 'modules', 'outline', 'worldbook'], isRegex: false, maxResults: 20, ...overrides };
}

describe('五域搜索', () => {
  it('每条命中附带可直接复制进 read 的读取地址', () => {
    const result = runAgentSearch_ACU(call_ACU(), context_ACU());
    expect(result).toContain('读取地址 $STORY_RANGE:1-1');
    expect(result).toContain('读取地址 $STORY_RANGE:2-2');
    expect(result).toContain('读取地址 $TABLE:角色表:1-1');
    expect(result).toContain('读取地址 $HOOKS_LEDGER:H1');
    expect(result).toContain('读取地址 $OUTLINE_WINDOW');
    expect(result).toContain('读取地址 $WORLDBOOK:设定集:7');
    // 用户楼层不是正文，不进搜索。
    expect(result).not.toContain('我要进禁区');
  });

  it('大纲搜索把阶段职责、叙事功能、主线增量与时间元数据纳入可检索文本', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: 'daily_world', scope: ['outline'] }), context_ACU());
    expect(result).toContain('function=daily_world');
    expect(result).toContain('mainline=hold');
    expect(result).toContain('time=days');
    expect(result).toContain('anchor=第三日清晨');
  });

  it('模块搜索纳入卷级容量、时间、进度上限、持续经营线与兑现目标', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '经营据点', scope: ['modules'] }), context_ACU());
    expect(result).toContain('$STORY_ARC:VOL-01');
    expect(result).toContain('经营据点与当地人的互信');
    expect(runAgentSearch_ACU(call_ACU({ query: 'targetStageRange=4-6', scope: ['modules'] }), context_ACU())).toContain('$STORY_ARC:VOL-01');
    expect(runAgentSearch_ACU(call_ACU({ query: '只确认核心入口存在', scope: ['modules'] }), context_ACU())).toContain('$STORY_ARC:VOL-01');
  });

  it('年代学账本可按锚、经过时间、转换与退休原因检索，命中地址为 $CHRONOLOGY:ID', () => {
    const context = context_ACU();
    context.moduleSnapshot.chronology = [
      { id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [1, 2], updatedIndex: 2, retired: false, retiredReason: '' },
      { id: 'T0', anchor: '误登记的锚', elapsed: '未知', precision: 'unknown', transition: '误登记', evidenceIndexes: [1], updatedIndex: 1, retired: true, retiredReason: '证据被删除' },
    ];

    const byAnchor = runAgentSearch_ACU(call_ACU({ query: '入城后的第七天', scope: ['modules'] }), context);
    expect(byAnchor).toContain('$CHRONOLOGY:T1');
    expect(runAgentSearch_ACU(call_ACU({ query: '约十七日', scope: ['modules'] }), context)).toContain('$CHRONOLOGY:T1');
    expect(runAgentSearch_ACU(call_ACU({ query: '休整七日', scope: ['modules'] }), context)).toContain('$CHRONOLOGY:T1');
    expect(runAgentSearch_ACU(call_ACU({ query: '证据楼层=1、2', scope: ['modules'] }), context)).toContain('$CHRONOLOGY:T1');
    const retired = runAgentSearch_ACU(call_ACU({ query: '证据被删除', scope: ['modules'] }), context);
    expect(retired).toContain('[T0]（已作废）');
    expect(retired).toContain('$CHRONOLOGY:T0');
  });

  it('退休模块条目也可被搜到并标注状态', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '低语', scope: ['modules'] }), context_ACU());
    expect(result).toContain('[H2]（已退休）');
    expect(result).toContain('$HOOKS_LEDGER:H2');
  });

  it('正文只搜可读窗口内的楼层，窗口外不命中', () => {
    const context = { ...context_ACU(), storyWindowFloors: 1 };
    const result = runAgentSearch_ACU(call_ACU({ scope: ['story'] }), context);
    expect(result).toContain('$STORY_RANGE:2-2');
    expect(result).not.toContain('$STORY_RANGE:1-1');
  });

  it('默认按字面关键词匹配（正则元字符被转义），isRegex 打开后按正则', () => {
    const literal = runAgentSearch_ACU(call_ACU({ query: '晶屑.', scope: ['story'] }), context_ACU());
    expect(literal).toContain('没有命中');
    const regex = runAgentSearch_ACU(call_ACU({ query: '晶屑.', scope: ['story'], isRegex: true }), context_ACU());
    expect(regex).toContain('命中');
  });

  it('非法正则返回可修正的编译失败说明而不是抛错', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '([未闭合', isRegex: true }), context_ACU());
    expect(result).toContain('编译失败');
    expect(result).toContain('去掉 isRegex');
  });

  it('无命中时给出可执行的调整建议', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '不存在的词汇' }), context_ACU());
    expect(result).toContain('没有命中');
    // 无命中指引：更早剧情走事件概览与纪要表行区间，不再有独立的纪要域。
    expect(result).toContain('事件概览');
    expect(result).toContain('$TABLE:纪要表');
  });

  it('达到条数上限时停止收集并如实标注截断', () => {
    const result = runAgentSearch_ACU(call_ACU({ maxResults: 2 }), context_ACU());
    expect(result).toContain('命中 2 处');
    expect(result).toContain('结果已截断');
  });
});

describe('命中行片段截断', () => {
  it('短行原样返回，长行以匹配词居中开窗并加省略号', () => {
    expect(createAgentMatchSnippet_ACU('短行', 0, 2)).toBe('短行');
    const long = `${'前'.repeat(200)}关键词${'后'.repeat(200)}`;
    const snippet = createAgentMatchSnippet_ACU(long, 200, 3, 100);
    expect(snippet.length).toBeLessThanOrEqual(102);
    expect(snippet).toContain('关键词');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
