import { describe, expect, it } from 'vitest';
import { ContinuationValidationError_ACU, type StageOutline_ACU } from '../../../src/service/continuation/model';
import { applyOutlineFixes_ACU, buildStageOutlineFromTags_ACU, parseOutlineFixes_ACU, parseOutlineTags_ACU, spliceOutlineWithCompletedPrefix_ACU } from '../../../src/service/continuation/outline-tags';

function allocator_ACU() {
  let counter = 0;
  return (prefix: string) => `${prefix}-${++counter}`;
}

function tagText_ACU(): string {
  return [
    '<stage_title>初入江南</stage_title>',
    '<stage_goal>接管鬼船案调查权</stage_goal>',
    '<stage_tempo>buildup</stage_tempo>',
    '<stage_role>setup</stage_role>',
    '<stage_time_span>十日</stage_time_span>',
    '<node>',
    '<node_title>抵达江南府</node_title>',
    '<node_goal>宣示接管权力</node_goal>',
    '<turn pacing="setup" function="transition" mainline="hold" time="same_day">钦差抵达，宣读圣旨</turn>',
    '</node>',
    '<node>',
    '<node_title>现场勘验</node_title>',
    '<node_goal>寻找关键物证</node_goal>',
    '<turn pacing="pressure" function="conflict" mainline="step" time="continuous">登船勘验，发现符箓气息</turn>',
    '<turn>义庄闹鬼，稳住仵作问话</turn>',
    '</node>',
  ].join('\n');
}

function previousOutline_ACU(): StageOutline_ACU {
  return {
    schemaVersion: 1,
    title: '旧阶段标题',
    goal: '旧阶段目标',
    tempo: 'aftermath',
    role: 'aftermath',
    totalTurns: 4,
    nodes: [
      { id: 'node-a', title: '节点A', goal: '目标A', suggestedTurns: 3, turns: [{ id: 'turn-a1', goal: '轮A1', pacing: 'setup' as const, function: 'daily_bond' as const, mainlineDelta: 'hold' as const, timeAdvance: 'same_day' as const }, { id: 'turn-a2', goal: '轮A2', pacing: 'pressure' as const, function: 'conflict' as const, mainlineDelta: 'step' as const, timeAdvance: 'continuous' as const }, { id: 'turn-a3', goal: '轮A3', pacing: 'cooldown' as const, function: 'recovery' as const, mainlineDelta: 'hold' as const, timeAdvance: 'days' as const }] },
      { id: 'node-b', title: '节点B', goal: '目标B', suggestedTurns: 1, turns: [{ id: 'turn-b1', goal: '轮B1', pacing: 'pressure' as const }] },
    ],
  };
}

async function expectParseFailure_ACU(raw: string, fragment: string) {
  try {
    parseOutlineTags_ACU(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    const validation = error as ContinuationValidationError_ACU;
    expect(validation.error.code).toBe('CONTINUATION_OUTLINE_JSON_INVALID');
    expect(validation.error.phase).toBe('outline_parse');
    expect(validation.error.retryable).toBe(true);
    expect(validation.error.message).toContain(fragment);
    return;
  }
  throw new Error('Expected parse failure');
}

describe('parseOutlineTags_ACU', () => {
  it('extracts stage, nodes and turns from clean tag output', () => {
    const parsed = parseOutlineTags_ACU(tagText_ACU());
    expect(parsed.title).toBe('初入江南');
    expect(parsed.goal).toBe('接管鬼船案调查权');
    expect(parsed.tempo).toBe('buildup');
    expect(parsed.role).toBe('setup');
    expect(parsed.timeSpanGoal).toBe('十日');
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]).toMatchObject({ title: '抵达江南府', goal: '宣示接管权力', turns: [{ goal: '钦差抵达，宣读圣旨', pacing: 'setup', function: 'transition', mainlineDelta: 'hold', timeAdvance: 'same_day', timeAnchor: null }] });
    // 解析层保留缺失状态；是否兼容归一化或严格拒绝由 schema 边界决定。
    expect(parsed.nodes[1].turns).toEqual([
      { goal: '登船勘验，发现符箓气息', pacing: 'pressure', function: 'conflict', mainlineDelta: 'step', timeAdvance: 'continuous', timeAnchor: null },
      { goal: '义庄闹鬼，稳住仵作问话', pacing: null, function: null, mainlineDelta: null, timeAdvance: null, timeAnchor: null },
    ]);
  });

  it('解析 turn 属性时保留合法值、非法原文与缺失状态', () => {
    const raw = [
      '<node>',
      '<node_title>节点</node_title>',
      '<node_goal>目标</node_goal>',
      '<turn pacing="cooldown" function="recovery" mainline="hold" time="days">余波</turn>',
      "<turn pacing='turn' function='reveal' mainline='milestone' time='overnight' anchor='次日清晨'>反转</turn>",
      '<turn pacing="fast">非法值</turn>',
      '<turn>没写</turn>',
      '</node>',
    ].join('\n');
    expect(parseOutlineTags_ACU(raw).nodes[0].turns).toEqual([
      { goal: '余波', pacing: 'cooldown', function: 'recovery', mainlineDelta: 'hold', timeAdvance: 'days', timeAnchor: null },
      { goal: '反转', pacing: 'turn', function: 'reveal', mainlineDelta: 'milestone', timeAdvance: 'overnight', timeAnchor: '次日清晨' },
      { goal: '非法值', pacing: 'fast', function: null, mainlineDelta: null, timeAdvance: null, timeAnchor: null },
      { goal: '没写', pacing: null, function: null, mainlineDelta: null, timeAdvance: null, timeAnchor: null },
    ]);
  });

  it('接受带空格的引号 anchor、中英文别名与全角引号', () => {
    const raw = [
      '<node><node_goal>目标</node_goal>',
      '<turn pacing="铺垫日常" function="关系日常" mainline="不推进" time="数日" anchor="抵达临川城后 第三周">目标一</turn>',
      "<turn pacing='Cool-Down' function='疗伤' mainline='Step' time='next day' anchor='day 7 after arrival'>目标二</turn>",
      '<turn pacing=“pressure” function=“对抗” mainline=“推进一步” time=“紧接”>目标三</turn>',
      '</node>',
    ].join('\n');
    expect(parseOutlineTags_ACU(raw).nodes[0].turns).toEqual([
      { goal: '目标一', pacing: 'setup', function: 'daily_bond', mainlineDelta: 'hold', timeAdvance: 'days', timeAnchor: '抵达临川城后 第三周' },
      { goal: '目标二', pacing: 'cooldown', function: 'recovery', mainlineDelta: 'step', timeAdvance: 'overnight', timeAnchor: 'day 7 after arrival' },
      { goal: '目标三', pacing: 'pressure', function: 'conflict', mainlineDelta: 'step', timeAdvance: 'continuous', timeAnchor: null },
    ]);
  });

  it('接受子标签与方括号前缀两种标记形态，并剥掉推理块', () => {
    const raw = [
      '<think>先想想节奏……{"draft": 1}</think>',
      '<node><node_goal>目标</node_goal>',
      '<turn><pacing>setup</pacing><function>training</function><mainline>hold</mainline><time>weeks</time><anchor>入门后第二个月</anchor>在铁匠铺打下手</turn>',
      '<turn>[turn|reveal|step|continuous]信物的真正主人露面</turn>',
      '<turn>[pacing=cooldown; time=overnight]【回忆】夜里两人各自失眠</turn>',
      '<turn>【回忆】这个方括号只是正文</turn>',
      '</node>',
    ].join('\n');
    expect(parseOutlineTags_ACU(raw).nodes[0].turns).toEqual([
      { goal: '在铁匠铺打下手', pacing: 'setup', function: 'training', mainlineDelta: 'hold', timeAdvance: 'weeks', timeAnchor: '入门后第二个月' },
      { goal: '信物的真正主人露面', pacing: 'turn', function: 'reveal', mainlineDelta: 'step', timeAdvance: 'continuous', timeAnchor: null },
      { goal: '【回忆】夜里两人各自失眠', pacing: 'cooldown', function: null, mainlineDelta: null, timeAdvance: 'overnight', timeAnchor: null },
      { goal: '【回忆】这个方括号只是正文', pacing: null, function: null, mainlineDelta: null, timeAdvance: null, timeAnchor: null },
    ]);
  });

  it('解析与应用 <fix> 修补：按位置合并，非法值忽略', () => {
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU('<node><node_goal>目标</node_goal><turn pacing="setup">一</turn><turn>二</turn></node><node><node_goal>目标2</node_goal><turn pacing="pressure">三</turn></node>'), allocator_ACU());
    const fixes = parseOutlineFixes_ACU([
      '<think>补</think>',
      '<fix node="1" turn="1" function="关系日常" time="overnight"/>',
      '<fix node="1" turn="2" pacing="pressure" mainline="step" function="不存在的功能">',
      '<fix node=2 turn=1 anchor="围城第五日" time="days"></fix>',
      '<fix stage tempo="起伏型" role="development" time_span="十日"/>',
      '<fix node="9" turn="1" function="conflict"/>',
    ].join('\n'));
    expect(fixes).toHaveLength(5);
    const fixed = applyOutlineFixes_ACU(planned, fixes);
    expect(fixed.nodes[0].turns[0]).toMatchObject({ pacing: 'setup', function: 'daily_bond', timeAdvance: 'overnight' });
    expect(fixed.nodes[0].turns[1]).toMatchObject({ pacing: 'pressure', mainlineDelta: 'step' });
    expect(fixed.nodes[0].turns[1].function).toBeUndefined();
    expect(fixed.nodes[1].turns[0]).toMatchObject({ timeAnchor: '围城第五日', timeAdvance: 'days' });
    expect(fixed).toMatchObject({ tempo: 'mixed', role: 'development', timeSpanGoal: '十日' });
    expect(applyOutlineFixes_ACU(planned, [])).toBe(planned);
    expect(parseOutlineFixes_ACU('没有任何修补')).toEqual([]);
  });

  it('解析阶段枚举时仅规范大小写，不吞掉非法原文', () => {
    const body = '<node><node_goal>目标</node_goal><turn>一轮</turn></node>';
    expect(parseOutlineTags_ACU(`<stage_tempo>SURGE</stage_tempo>${body}`).tempo).toBe('surge');
    expect(parseOutlineTags_ACU(`<stage_tempo>激烈</stage_tempo>${body}`).tempo).toBe('激烈');
    expect(parseOutlineTags_ACU(body).tempo).toBeNull();
  });

  it('带属性的 node 正则不会吃掉 node_title', () => {
    const raw = '<node data-x="1"><node_title>真标题</node_title><node_goal>目标</node_goal><turn>一轮</turn></node>';
    const parsed = parseOutlineTags_ACU(raw);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].title).toBe('真标题');
    expect(parsed.nodes[0].goal).toBe('目标');
  });

  it('ignores prose, markdown fences and stray JSON around the tags', () => {
    const noisy = `先梳理一下思路：{"draft": true} 前半段做铺垫。\n\n\`\`\`xml\n${tagText_ACU()}\n\`\`\`\n\n以上就是我的规划说明。`;
    const parsed = parseOutlineTags_ACU(noisy);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[1].turns).toHaveLength(2);
  });

  it('tolerates uppercase tags and surrounding whitespace inside tags', () => {
    const upper = '<STAGE_TITLE>  标题  </STAGE_TITLE><NODE><NODE_GOAL>目标</NODE_GOAL><TURN>  第一轮  </TURN></NODE>';
    const parsed = parseOutlineTags_ACU(upper);
    expect(parsed.title).toBe('标题');
    expect(parsed.nodes[0].goal).toBe('目标');
    expect(parsed.nodes[0].turns).toEqual([{ goal: '第一轮', pacing: null, function: null, mainlineDelta: null, timeAdvance: null, timeAnchor: null }]);
  });

  it('fails with a raw snippet when no node tag exists', async () => {
    await expectParseFailure_ACU('这是一段没有任何标签的散文，模型忘记了输出格式。', '模型返回片段：这是一段没有任何标签的散文');
    await expectParseFailure_ACU('', '大纲返回为空');
  });

  it('fails when a node has no non-empty turn', async () => {
    await expectParseFailure_ACU('<node><node_goal>目标</node_goal><turn>   </turn></node>', '没有任何非空 <turn>');
  });
});

describe('buildStageOutlineFromTags_ACU', () => {
  it('generates ids and derives all counts at runtime', () => {
    const outline = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(tagText_ACU()), allocator_ACU());
    expect(outline.schemaVersion).toBe(1);
    expect(outline.totalTurns).toBe(3);
    expect(outline.nodes.map(node => node.id)).toEqual(['node-1', 'node-3']);
    expect(outline.nodes[0]).toMatchObject({ suggestedTurns: 1 });
    expect(outline.nodes[1]).toMatchObject({ suggestedTurns: 2 });
    expect(outline.nodes[1].turns.map(turn => turn.id)).toEqual(['turn-4', 'turn-5']);
  });

  it('falls back to positional node titles and previous stage title/goal', () => {
    const parsed = parseOutlineTags_ACU('<node><node_goal>目标</node_goal><turn>第一轮</turn></node>');
    const outline = buildStageOutlineFromTags_ACU(parsed, allocator_ACU(), { title: '沿用标题', goal: '沿用目标', tempo: 'surge' });
    expect(outline.title).toBe('沿用标题');
    expect(outline.goal).toBe('沿用目标');
    // 重规划时模型可以不重述阶段字段，此时沿用旧大纲；首次生成缺失则留给严格校验拒绝。
    expect(outline.tempo).toBe('surge');
    expect(outline.nodes[0].title).toBe('节点1');
    expect(buildStageOutlineFromTags_ACU(parsed, allocator_ACU()).tempo).toBeUndefined();
  });

  it('模型写了形态就以模型的为准，不被旧大纲的形态覆盖', () => {
    const parsed = parseOutlineTags_ACU('<stage_tempo>aftermath</stage_tempo><node><node_goal>目标</node_goal><turn>第一轮</turn></node>');
    expect(buildStageOutlineFromTags_ACU(parsed, allocator_ACU(), { tempo: 'surge' }).tempo).toBe('aftermath');
  });
});

describe('spliceOutlineWithCompletedPrefix_ACU', () => {
  it('keeps completed prefix ids verbatim and appends the newly planned nodes', () => {
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(tagText_ACU()), allocator_ACU());
    const spliced = spliceOutlineWithCompletedPrefix_ACU(previousOutline_ACU(), 2, planned);
    expect(spliced.nodes).toHaveLength(3);
    expect(spliced.nodes[0]).toMatchObject({ id: 'node-a', suggestedTurns: 2 });
    expect(spliced.nodes[0].turns.map(turn => turn.id)).toEqual(['turn-a1', 'turn-a2']);
    // 已完成前缀的全部节奏、功能、主线和时间元数据必须原样带过来。
    expect(spliced.nodes[0].turns.map(turn => turn.pacing)).toEqual(['setup', 'pressure']);
    expect(spliced.nodes[0].turns[0]).toMatchObject({ function: 'daily_bond', mainlineDelta: 'hold', timeAdvance: 'same_day' });
    expect(spliced.nodes[1].id).toBe('node-1');
    expect(spliced.totalTurns).toBe(5);
    expect(spliced.title).toBe('初入江南');
    // 形态属于本次规划的决定，拼接后取新大纲的而不是旧的。
    expect(spliced.tempo).toBe('buildup');
  });

  it('keeps previous stage title and goal when the replan omits them', () => {
    // 重规划链路总是把旧大纲作为 fallback 传入；此时漏写的标题/目标不走节点兜底，交给拼接沿用旧值。
    const previous = previousOutline_ACU();
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU('<node><node_goal>目标</node_goal><turn>新的一轮</turn></node>'), allocator_ACU(), { title: previous.title, goal: previous.goal, tempo: previous.tempo, role: previous.role });
    const spliced = spliceOutlineWithCompletedPrefix_ACU(previousOutline_ACU(), 4, planned);
    expect(spliced.title).toBe('旧阶段标题');
    expect(spliced.goal).toBe('旧阶段目标');
    expect(spliced.nodes).toHaveLength(3);
    expect(spliced.nodes[1]).toMatchObject({ id: 'node-b', suggestedTurns: 1 });
    expect(spliced.totalTurns).toBe(5);
  });

  it('returns the planned outline unchanged when nothing is completed', () => {
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(tagText_ACU()), allocator_ACU());
    expect(spliceOutlineWithCompletedPrefix_ACU(previousOutline_ACU(), 0, planned)).toBe(planned);
  });
});
