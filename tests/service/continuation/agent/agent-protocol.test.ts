import { describe, expect, it } from 'vitest';

import {
  compactAgentProtocolError_ACU,
  extractFirstJsonObject_ACU,
  parseAgentJsonPayload_ACU,
  parseAgentMainAction_ACU,
  parseAgentMainOutput_ACU,
  parseAgentMaintainerOutput_ACU,
  parseAgentPlannerOutput_ACU,
  parseAgentReviewerOutput_ACU,
  parseAgentSubagentToolCalls_ACU,
} from '../../../../src/service/continuation/agent/agent-protocol';
import { AGENT_PREFILLS_ACU } from '../../../../src/service/continuation/agent/agent-defaults';

describe('Agent 文本协议 JSON 提取', () => {
  it('剥掉 Markdown 围栏与前后解释文本', () => {
    const raw = '好的，我的决策如下：\n```json\n{"action":"finalize","instruction":"写下去"}\n```\n以上。';
    expect(extractFirstJsonObject_ACU(raw)).toBe('{"action":"finalize","instruction":"写下去"}');
  });

  it('不会被字符串内的花括号与转义引号骗过', () => {
    const raw = '{"instruction":"他说 \\"进来 {吧}\\"","action":"finalize"}';
    expect(JSON.parse(extractFirstJsonObject_ACU(raw)!)).toMatchObject({ action: 'finalize' });
  });

  it('没有配平对象时返回 null', () => {
    expect(extractFirstJsonObject_ACU('{"action":"finalize"')).toBeNull();
    expect(extractFirstJsonObject_ACU('没有任何 JSON')).toBeNull();
  });

  it('同时容忍完整重新输出与仅续写预填充两种形态', () => {
    const full = parseAgentJsonPayload_ACU('{"thought":"够了","action":"finalize","instruction":"写"}', AGENT_PREFILLS_ACU.main);
    expect(full).toMatchObject({ action: 'finalize' });

    const continued = parseAgentJsonPayload_ACU('够了",\n  "action": "finalize",\n  "instruction": "写"\n}', AGENT_PREFILLS_ACU.main);
    expect(continued).toMatchObject({ thought: '够了', action: 'finalize', instruction: '写' });
  });

  it('续写形态里 delegations 的嵌套对象不会被误选为协议对象', () => {
    // 真实回归场景（gemini 返回）：thought 正文续写在前，delegations 数组里嵌着代理对象。
    const raw = '大纲窗口显示尚无可执行的大纲轮次，必须先派工 outline-architect 创建首个阶段大纲。",\n'
      + '  "action": "delegate",\n'
      + '  "delegations": [\n'
      + '    {\n      "agentName": "outline-architect",\n      "prompt": "基于目前的开头创建本故事第一个阶段大纲",\n      "reads": [],\n      "writes": []\n    }\n'
      + '  ]\n}';
    const payload = parseAgentJsonPayload_ACU(raw, AGENT_PREFILLS_ACU.main, ['action']);
    expect(payload.action).toBe('delegate');
    expect(payload.thought).toContain('必须先派工 outline-architect');
    expect(Array.isArray(payload.delegations)).toBe(true);
  });

  it('模型在 JSON 前后写自然语言时按判别键挑出动作对象', () => {
    const raw = '我先梳理一下思路：当前需要交付。{无关的花括号碎片\n'
      + '```json\n{"thought":"证据足够","action":"finalize","instruction":"按第一轮写"}\n```\n以上就是我的决定。';
    const payload = parseAgentJsonPayload_ACU(raw, AGENT_PREFILLS_ACU.main, ['action']);
    expect(payload).toMatchObject({ action: 'finalize', instruction: '按第一轮写' });
  });

  it('无判别键命中时退回首个可解析对象，交由上层契约给出字段级报错', () => {
    const payload = parseAgentJsonPayload_ACU('{"foo":"bar"}', AGENT_PREFILLS_ACU.main, ['action']);
    expect(payload).toEqual({ foo: 'bar' });
  });

  it('完全无 JSON 时报错并附模型原文片段', () => {
    expect(() => parseAgentJsonPayload_ACU('我拒绝输出任何结构化内容', AGENT_PREFILLS_ACU.main, ['action']))
      .toThrowError(/模型返回片段：我拒绝输出任何结构化内容/);
  });

  it('空返回与无 JSON 返回都按协议错误处理', () => {
    expect(() => parseAgentJsonPayload_ACU('   ')).toThrowError(/返回为空/);
    expect(() => parseAgentJsonPayload_ACU('我拒绝输出 JSON')).toThrowError(/不包含可解析的 JSON/);
  });
});

describe('主 Agent 动作解析', () => {
  it('delegate 需要非空派工列表，且每项都要有代理名与任务', () => {
    const action = parseAgentMainAction_ACU({ action: 'delegate', thought: '先结算', delegations: [{ agentName: 'hook-cognition-maintainer', prompt: '结算未处理正文', reads: ['$HISTORY_UNSETTLED'], writes: ['$HOOKS_LEDGER'] }] }, true);
    expect(action).toMatchObject({ kind: 'delegate' });

    expect(() => parseAgentMainAction_ACU({ action: 'delegate', delegations: [] }, true)).toThrowError(/非空的 delegations/);
    expect(() => parseAgentMainAction_ACU({ action: 'delegate', delegations: [{ prompt: '干活' }] }, true)).toThrowError(/agentName 不能为空/);
  });

  it('预算最后一轮禁用 delegate', () => {
    expect(() => parseAgentMainAction_ACU({ action: 'delegate', delegations: [{ agentName: 'mainline-planner', prompt: '策划' }] }, false)).toThrowError(/预算最后一轮/);
  });

  it('finalize 必须给出 instruction，constraints 缺省为 null', () => {
    expect(parseAgentMainAction_ACU({ action: 'finalize', instruction: '本轮指导', summary: '要点' }, true)).toMatchObject({ kind: 'finalize', constraints: null });
    expect(parseAgentMainAction_ACU({ action: 'finalize', instruction: '本轮指导', constraints: { add: ['红线一'], retire: ['C01-1'] } }, true))
      .toMatchObject({ constraints: { add: ['红线一'], retire: ['C01-1'] } });
    expect(() => parseAgentMainAction_ACU({ action: 'finalize' }, true)).toThrowError(/非空 instruction/);
  });

  it('finalize 的 constraints 兼容旧全量键：current 并入 add、retired 并入 retire，空对象归一为 null', () => {
    expect(parseAgentMainAction_ACU({ action: 'finalize', instruction: '指导', constraints: { current: ['红线一', '红线二'], retired: ['旧约束'] } }, true))
      .toMatchObject({ constraints: { add: ['红线一', '红线二'], retire: ['旧约束'] } });
    expect(parseAgentMainAction_ACU({ action: 'finalize', instruction: '指导', constraints: { add: ['红线一'], current: ['红线一'] } }, true))
      .toMatchObject({ constraints: { add: ['红线一'], retire: [] } });
    expect(parseAgentMainAction_ACU({ action: 'finalize', instruction: '指导', constraints: {} }, true)).toMatchObject({ constraints: null });
  });

  it('edit_outline 已从主 Agent 协议退役，要求委派 outline-architect', () => {
    expect(() => parseAgentMainAction_ACU({
      action: 'edit_outline',
      edits: [{ op: 'set_turn_goal', turnId: 'turn-3', goal: '让守门人先露破绽' }],
    }, true)).toThrowError(/大纲调整请派工 outline-architect/);
  });

  it('维护类的 patch 只收显式字段，至少要带一个可改字段', () => {
    const output = parseAgentMaintainerOutput_ACU({
      summary: '微调',
      delta: {
        hooks: [{ action: 'patch', id: 'H1', summary: '新句子' }],
        infoGap: [{ action: 'patch', id: 'E1', revealStatus: 'partial', revealIndex: 5 }],
      },
    });
    expect(output.delta.hookPatches).toEqual([{ id: 'H1', summary: '新句子' }]);
    expect(output.delta.infoGapPatches).toEqual([{ id: 'E1', revealStatus: 'partial', revealIndex: 5 }]);
    expect(output.delta.hooks).toHaveLength(0);

    expect(() => parseAgentMaintainerOutput_ACU({ delta: { hooks: [{ action: 'patch', id: 'H1' }] } })).toThrowError(/至少要带一个要修改的字段/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { hooks: [{ action: 'patch', summary: '缺 id' }] } })).toThrowError(/patch 需要 id/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { infoGap: [{ action: 'patch', id: 'E1', revealStatus: '瞎写' }] } })).toThrowError(/revealStatus 非法/);
  });

  it('总纲写集保留卷完成依据与续卷依据，并拒绝非法完成阶段编号', () => {
    const output = parseAgentMaintainerOutput_ACU({
      summary: '第一卷已收束并扩充第二卷',
      delta: {
        storyArc: [
          { action: 'patch', id: 'VOL-01', status: 'done', completionStageNumber: 3, completionState: '印信回归，第三方签名浮出水面', completionRationale: '三阶段内完成全部兑现' },
          {
            action: 'upsert', id: 'VOL-02', scope: 'volume', title: '追查签名', direction: '追查第三方势力', escalation: '收在幕后势力主动灭口', withheld: '幕后首脑身份', status: 'active', stageNumbers: [], continuationRationale: '第一卷留下的第三方签名将商行争夺推向幕后势力',
            narrativeRole: 'development', targetStageRange: { min: 4, max: 6 }, targetTimeSpan: '两个月', progressCeiling: '只查明幕后势力的外围组织', sustainingThreads: ['主角与账房的互信'], payoffTargets: ['兑现第三方签名的来源'],
          },
        ],
      },
    });

    expect(output.delta.storyArcPatches).toEqual([{ id: 'VOL-01', status: 'done', completionStageNumber: 3, completionState: '印信回归，第三方签名浮出水面', completionRationale: '三阶段内完成全部兑现' }]);
    expect(output.delta.storyArc[0]).toMatchObject({
      id: 'VOL-02', narrativeRole: 'development', targetStageRange: { min: 4, max: 6 }, targetTimeSpan: '两个月', progressCeiling: '只查明幕后势力的外围组织', sustainingThreads: ['主角与账房的互信'], payoffTargets: ['兑现第三方签名的来源'],
      continuationRationale: '第一卷留下的第三方签名将商行争夺推向幕后势力', completionStageNumber: null, completionState: '',
    });
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { storyArc: [{ action: 'patch', id: 'VOL-01', completionStageNumber: 0 }] } })).toThrowError(/completionStageNumber 必须是从 1 起的整数或 null/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { storyArc: [{ action: 'patch', id: 'VOL-01', targetStageRange: { min: 6, max: 4 } }] } })).toThrowError(/min 不能大于 max/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { storyArc: [{ action: 'patch', id: 'VOL-01', sustainingThreads: [''] }] } })).toThrowError(/必须是非空字符串/);
  });

  it('block 必须带明确理由', () => {
    expect(parseAgentMainAction_ACU({ action: 'block', reason: '关键资料缺失', unresolved: ['缺角色表'] }, true)).toMatchObject({ kind: 'block', unresolved: ['缺角色表'] });
    expect(() => parseAgentMainAction_ACU({ action: 'block' }, true)).toThrowError(/必须提供 reason/);
  });

  it('未知动作和已退役的大纲动作直接拒绝', () => {
    expect(() => parseAgentMainAction_ACU({ action: 'write_story' }, true)).toThrowError(/action 必须是/);
    expect(() => parseAgentMainAction_ACU({ action: 'revise_outline', replanInstruction: '改' }, true)).toThrowError(/action 必须是 read \/ search \/ delegate \/ finalize \/ block/);
  });
});

describe('工具批次解析', () => {
  it('输出里出现任意 read/search 对象即视为工具并发批次，混入的决策动作被忽略', () => {
    const raw = '先查资料。\n{"action":"read","reads":["$STORY_RANGE:3-4","$HOOKS_LEDGER:H001"]}\n'
      + '{"action":"search","query":"黑色晶屑","scope":["story","modules"],"maxResults":10}\n'
      + '{"action":"finalize","instruction":"顺便交付"}';
    const action = parseAgentMainOutput_ACU(raw, AGENT_PREFILLS_ACU.main, true);
    expect(action.kind).toBe('tools');
    const calls = (action as any).calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ kind: 'read', reads: ['$STORY_RANGE:3-4', '$HOOKS_LEDGER:H001'] });
    expect(calls[1]).toMatchObject({ kind: 'search', query: '黑色晶屑', scope: ['story', 'modules'], isRegex: false, maxResults: 10 });
  });

  it('没有工具对象时按单动作解析', () => {
    const action = parseAgentMainOutput_ACU('{"thought":"够了","action":"finalize","instruction":"写","summary":"要点"}', AGENT_PREFILLS_ACU.main, true);
    expect(action.kind).toBe('finalize');
  });

  it('read 需要非空 reads，search 需要非空 query', () => {
    expect(() => parseAgentMainOutput_ACU('{"action":"read","reads":[]}', AGENT_PREFILLS_ACU.main, true)).toThrowError(/reads/);
    expect(() => parseAgentMainOutput_ACU('{"action":"search","query":""}', AGENT_PREFILLS_ACU.main, true)).toThrowError(/query/);
  });

  it('子代理输出里的工具批次被提取；纯契约输出返回 null', () => {
    const calls = parseAgentSubagentToolCalls_ACU('{"action":"read","reads":["$INFO_GAP"]}', AGENT_PREFILLS_ACU.maintainer);
    expect(calls).toHaveLength(1);
    expect(calls![0]).toMatchObject({ kind: 'read', reads: ['$INFO_GAP'] });
    expect(parseAgentSubagentToolCalls_ACU('{"summary":"结算完成","delta":{}}', AGENT_PREFILLS_ACU.maintainer)).toBeNull();
  });
});

describe('子代理输出解析', () => {
  it('维护类输出保留写集事务并把非法枚举收敛到安全默认值', () => {
    const output = parseAgentMaintainerOutput_ACU({
      summary: '结算完成',
      delta: {
        expectedRevisions: { hooks: 2, infoGap: '坏值' },
        hooks: [{ action: 'upsert', id: 'H1', summary: '内容', status: '瞎写', importance: '瞎写', plantedIndex: -3 }],
        infoGap: [{ action: 'upsert', id: 'E1', topic: '主题', revealStatus: '瞎写', revealIndex: 4, characterKnowledge: [{ name: '林瑶', knows: '不知' }, { knows: '缺名字' }] }],
        constraintProposals: ['建议登记红线', ''],
      },
    });

    expect(output.delta.expectedRevisions).toEqual({ hooks: 2 });
    expect(output.delta.hooks[0]).toMatchObject({ status: 'planted', importance: 'mid', plantedIndex: -1 });
    expect(output.delta.infoGap[0].revealStatus).toBe('unrevealed');
    expect(output.delta.infoGap[0].characterKnowledge).toEqual([{ name: '林瑶', knows: '不知' }]);
    expect(output.delta.constraintProposals).toEqual(['建议登记红线']);
  });

  it('维护类的非法 action 与非数组 delta 都被拒绝', () => {
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { hooks: [{ action: 'delete', id: 'H1' }] } })).toThrowError(/upsert \/ patch \/ retire/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { infoGap: '不是数组' } })).toThrowError(/必须是数组/);
  });

  it('年代学写集正向解析：证据楼层去重升序，expectedRevisions 纳入 chronology', () => {
    const output = parseAgentMaintainerOutput_ACU({
      summary: '结算了一次时间跳跃',
      delta: {
        expectedRevisions: { chronology: 3 },
        chronology: [
          { action: 'upsert', id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [5, 4, 5] },
          { action: 'retire', id: 'T0', reason: '证据楼层已被删除' },
        ],
      },
    });

    expect(output.delta.expectedRevisions).toEqual({ chronology: 3 });
    expect(output.delta.chronology[0]).toMatchObject({ action: 'upsert', id: 'T1', anchor: '入城后的第七天', precision: 'approximate', evidenceIndexes: [4, 5] });
    expect(output.delta.chronology[1]).toMatchObject({ action: 'retire', id: 'T0', reason: '证据楼层已被删除' });
  });

  it('年代学写集的非法 action、precision、空证据与非整数证据全部拒绝', () => {
    const item = { action: 'upsert', id: 'T1', anchor: '入城后的第七天', elapsed: '约十七日', precision: 'approximate', transition: '休整七日', evidenceIndexes: [4] };
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, action: 'patch' }] } })).toThrowError(/action 必须是 upsert \/ retire/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, precision: '大概吧' }] } })).toThrowError(/precision 必须是 exact \/ approximate \/ unknown/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, evidenceIndexes: [] }] } })).toThrowError(/evidenceIndexes 必须是非空数组/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, evidenceIndexes: [1.5] }] } })).toThrowError(/必须是非负整数楼层号/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, evidenceIndexes: ['5'] }] } })).toThrowError(/必须是非负整数楼层号/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, anchor: '' }] } })).toThrowError(/anchor 不能为空/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, elapsed: ' ' }] } })).toThrowError(/elapsed 不能为空/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, transition: '' }] } })).toThrowError(/transition 不能为空/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: [{ ...item, id: '' }] } })).toThrowError(/需要非空 id/);
    expect(() => parseAgentMaintainerOutput_ACU({ delta: { chronology: '不是数组' } })).toThrowError(/delta\.chronology 必须是数组/);
  });

  it('策划类必须给出 recommendation，资料不足应改走工具调用', () => {
    expect(parseAgentPlannerOutput_ACU({ summary: '要点', recommendation: '这样推进', mustPreserve: ['林瑶有伤'], risks: ['提前回收'] }))
      .toMatchObject({ recommendation: '这样推进', mustPreserve: ['林瑶有伤'] });
    expect(() => parseAgentPlannerOutput_ACU({ summary: '只有摘要' })).toThrowError(/必须给出 recommendation/);
  });

  it('审查类判词非法时直接拒绝，由重试机制纠正', () => {
    expect(parseAgentReviewerOutput_ACU({ verdict: 'revise', reason: '与 H1 冲突', fixes: ['改为部分回收'] }))
      .toMatchObject({ verdict: 'revise', fixes: ['改为部分回收'] });
    expect(() => parseAgentReviewerOutput_ACU({ verdict: '说不清' })).toThrowError(/verdict 必须是/);
  });
});

describe('协议错误压缩', () => {
  it('把校验错误压成带错误码的单行原因串', () => {
    try {
      parseAgentMainAction_ACU({ action: 'write_story' }, true);
    } catch (error) {
      expect(compactAgentProtocolError_ACU(error)).toContain('CONTINUATION_AGENT_PROTOCOL_INVALID');
    }
    expect(compactAgentProtocolError_ACU(new Error('普通错误'))).toBe('普通错误');
  });
});
