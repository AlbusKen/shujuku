import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationAgentPrompts_ACU, buildV21WorldSimulationAgentPrompt_ACU, buildV22WorldSimulationAgentPrompt_ACU, buildV23WorldSimulationAgentPrompt_ACU, buildV24WorldSimulationAgentPrompt_ACU, buildV25WorldSimulationAgentPrompt_ACU, buildV26WorldSimulationAgentPrompt_ACU, buildV27WorldSimulationAgentPrompt_ACU, migrateWorldSimulationAgentPromptsDetailed_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROMPT_VERSION_V21_ACU, WORLD_SIMULATION_PROMPT_VERSION_V22_ACU, WORLD_SIMULATION_PROMPT_VERSION_V23_ACU, WORLD_SIMULATION_PROMPT_VERSION_V24_ACU, WORLD_SIMULATION_PROMPT_VERSION_V25_ACU, WORLD_SIMULATION_PROMPT_VERSION_V26_ACU, WORLD_SIMULATION_PROMPT_VERSION_V27_ACU, WORLD_SIMULATION_PROMPT_VERSION_V28_ACU, WORLD_SIMULATION_PROMPT_VERSION_V29_ACU, WORLD_SIMULATION_PROMPT_VERSION_V30_ACU, WORLD_SIMULATION_PROMPT_VERSION_V31_ACU, WORLD_SIMULATION_PROMPT_VERSION_V32_ACU, WORLD_SIMULATION_PROMPT_VERSION_V33_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { oneShotBootstrapNotice_ACU, worldSimulationOneShotProtocol_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
import { validateWorldSimulationPromptSegments_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { stripWritingAnnotations_ACU } from '../../../../src/service/simulation/simulation-projection';

const roles = ['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'] as const;
/** v28 把运行逻辑拆进多组问答，推演细则不再集中在单个 WORKFLOW 段，断言按整份提示词检查。 */
const fullBody = (segments: readonly { content: string }[]): string => segments.map(item => item.content).join('\n');
/**
 * 按 seam 标记取段。v28 的段序与段数都与 v21-v27 不同（guidance 前移、WORKFLOW 变成问答首问、
 * HISTORY 已删除），迁移结果只能按语义定位，不能再按下标比对。
 */
const bySeam = (segments: readonly { content: string }[], seam: string) =>
  segments.find(item => item.content.startsWith(`<WORLD_SIMULATION_ENGINE_SEAM:${seam}>`));

describe('一次性资料角色默认提示词', () => {
  it('三个角色的 seam 均合法，变更通过原生工具交候选', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    for (const role of roles) {
      expect(() => validateWorldSimulationPromptSegments_ACU(prompts[role], role)).not.toThrow();
      const body = prompts[role].map(item => item.content).join('\n');
      expect(body).toContain('原生 write_sql');
      expect(body).not.toContain('timekeeper');
      expect(body).not.toContain('chronicler');
      expect(body).not.toContain('【输出协议】');
      expect(body).not.toContain('最终只交协议 JSON');
      expect(body).not.toContain('交 no_change');
      // v28 的运行逻辑以问答自述承载：system 只剩身份、边界与协议。
      expect(body).toContain('我每轮都要查三项');
      expect(body).toContain('提交前我逐项对照职责清单');
      expect(body).toContain('同一次 write_sql');
    }
    const guidanceBody = prompts['guidance-composer'].map(item => item.content).join('\\n');
    expect(guidanceBody).toContain('chronicle_overview');
    expect(guidanceBody).toContain('不能把 summary 或 related_ids 写入 chronicle_overview');
    expect(guidanceBody).toContain('不能编造 rumors:1 等伪 ID');
    const protocol = worldSimulationOneShotProtocol_ACU('guidance-composer', ['chronicle', 'rumors', 'guidance']);
    expect(protocol).toContain('先调用 write_sql');
    expect(protocol).toContain('下一次回复单独调用 submit');
    expect(protocol).toContain('空回复和裸状态行均不是交付');
    expect(protocol).not.toContain('"status":"candidate"');
    expect(protocol).toContain('chronicle_overview=(fingerprint, day, one_line, archive_ref)');
    expect(protocol).toContain('不能写 rumors:1');
    expect(protocol).not.toContain('"reads":["ledger:current"]');
    expect(protocol).toContain('ledger:current 并非普通角色可读地址');
    expect(protocol).toContain('交付不带 sql 或 patch');
    expect(protocol).toContain('【可写列白名单】');
    expect(protocol).toContain('guidance(signals, excluded_facts, evidence_refs)');
    const clockProtocol = worldSimulationOneShotProtocol_ACU('undercurrent-analyst', ['clock', 'dimensions', 'seeds']);
    expect(clockProtocol).toContain('clock(days, story_time, slot, evidence_refs)');
    expect(clockProtocol).not.toMatch(/clock\([^)]*\bday\b/);
    expect(clockProtocol).not.toMatch(/dimensions\([^)]*visibility/);
  });

  it('v28 写法纪律落到具体 SQL，无变化不再被说成失败', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => fullBody(prompts[role]);
    for (const role of roles) {
      expect(workflow(role)).toContain('【可写列白名单】');
      expect(workflow(role)).toContain('INSERT 新行不写 revision 或 expected_revision');
      expect(workflow(role)).not.toContain('其余行各用自身 revision');
    }
    expect(workflow('undercurrent-analyst')).toContain('clock.days 是本轮推进量，不是绝对日');
    expect(workflow('dramatis-keeper')).toContain('WHERE expected_revision = 运行时“单例修订号”');
    expect(workflow('dramatis-keeper')).toContain('这属于无变化，不是失败');
  });

  it('各角色自述里写明证据判断与反例', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => fullBody(prompts[role]);
    expect(workflow('undercurrent-analyst')).toContain('没有明确推进就不写 clock');
    expect(workflow('dramatis-keeper')).toContain('答不上就不写，宁可让他继续误判');
    expect(workflow('guidance-composer')).toContain('本候选新建的风声或纪要不能当来源');
    for (const role of roles) {
      expect(workflow(role)).toContain('expected_revision');
      expect(workflow(role)).toContain('“可能发生”绝不写成“已经发生”');
    }
  });

  it('三个角色分别覆盖所有职责并在单次交付前交叉复核，冻结的 v24/v26/v27 正文不被 v28 改写', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const checks = {
      'undercurrent-analyst': ['clock 时序', 'dimensions 局势刻度', 'seeds 伏线', '局势刻度：', '存量伏线：', '期限：', '埋新线：', '交叉复核：'],
      'dramatis-keeper': ['player 玩家所在与对外联络', 'actors 人物谱', '死亡伴生风声', '玩家：', '点名：', '在册人物逐个更新：', '认知：', '生死：'],

      'guidance-composer': ['chronicle 幕后纪要与成对归档', 'rumors 风声', 'guidance 场外信号', '幕后纪要：', '归档：', '风声：', '场外信号选题：', '旧信号清理：'],
    } as const;
    for (const role of roles) {
      const workflow = fullBody(prompts[role]);
      for (const check of checks[role]) expect(workflow).toContain(check);
      expect(workflow).toContain('同一次 write_sql');
      const old = buildV24WorldSimulationAgentPrompt_ACU(role);
      expect(old.find(segment => segment.content.includes('【推演步骤】'))!.content).not.toContain('【职责清单】');
      const v26 = buildV26WorldSimulationAgentPrompt_ACU(role).find(segment => segment.content.includes('【推演步骤】'))!.content;
      expect(v26).not.toContain('【首轮建账】');
      // v27 仍是集中在 WORKFLOW 段的旧结构，v28 已改为问答组。
      const v27 = buildV27WorldSimulationAgentPrompt_ACU(role);
      expect(v27.find(segment => segment.content.includes('【推演步骤】'))!.content).toContain('【首轮建账】');
      expect(fullBody(v27)).not.toBe(workflow);
    }
  });

  it('v28 各角色写明首轮建账，去掉新建条数硬上限，且只用格林推演自己的术语', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    for (const role of roles) {
      const body = fullBody(prompts[role]);
      expect(body).toContain('首轮建账：');
      expect(body).toContain('格林推演系统');
      expect(body).not.toMatch(/暗流|种子|行动者|编年|传闻|投影|世界推演/);
      expect(body).not.toContain('本轮最多新建 3 条');
      expect(body).not.toContain('本轮最多新增 3 人');
      expect(body).toContain('INSERT 新行不写 revision 或 expected_revision');
    }
    const dramatis = fullBody(prompts['dramatis-keeper']);
    expect(dramatis).toContain('锚点里的具名人物全部建档');
    expect(dramatis).toContain('只要不是一次性路人，本轮就建档');
    const undercurrent = fullBody(prompts['undercurrent-analyst']);
    expect(undercurrent).toContain('埋 3-6 条伏线');
    expect(undercurrent).toContain('提炼 2-5 个局势刻度');
  });

  it('v28 结构：system 只讲身份与任务，运行逻辑由多组 user 提问与 assistant 自述承载', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    for (const role of roles) {
      const segments = prompts[role];
      expect(() => validateWorldSimulationPromptSegments_ACU(segments, role)).not.toThrow();
      // system 段只有身份、写入边界、交付协议与用户要求占位，不再承载推演细则。
      const systems = segments.filter(item => item.role === 'system');
      expect(systems).toHaveLength(4);
      for (const item of systems) expect(item.content).not.toContain('我每轮都要查三项');
      // 至少 3 组问答，且每个 assistant 自述都紧跟在一个 user 提问之后。
      const pairs = segments.filter((item, index) => item.role === 'assistant' && segments[index - 1]?.role === 'user');
      expect(pairs.length).toBeGreaterThanOrEqual(3);
      expect(segments.filter(item => item.role === 'assistant').length).toBe(pairs.length);
      // 角色专属那一组问答在共享问答之间，确保角色细则也以自述出现。
      expect(pairs.some(item => item.content.includes('我每轮都要查三项'))).toBe(true);
    }
    const dramatis = fullBody(prompts['dramatis-keeper']);
    // v30：行为拆成短期/长期并各带预计持续时间，只有显式 done/abandoned 才归档经历；认知为与当前剧情相关的覆盖式快照。
    expect(dramatis).toContain('current_action');
    expect(dramatis).toContain('long_term_action');
    expect(dramatis).toContain('预计持续时间');
    expect(dramatis).toContain('只有显式写了 done 或 abandoned');
    expect(dramatis).toContain('known_facts 是覆盖式快照');
    expect(dramatis).not.toContain('保留仍成立的旧认知');
    expect(dramatis).toContain('读者知道的不等于人物知道');
    expect(fullBody(prompts['undercurrent-analyst'])).toContain('正文往哪走，我的推演就往哪走');
  });

  it('运行时对空账本与空模块给出首轮建账标记，非空时不打扰', () => {
    const empty = { clock: { day: 1 }, dimensions: [], seeds: [], actors: [], rumors: [], chronicle: [] } as any;
    expect(oneShotBootstrapNotice_ACU(0, ['clock', 'dimensions', 'seeds'], empty)[0]).toContain('【首轮建账】账本尚未建立');
    expect(oneShotBootstrapNotice_ACU(0, ['clock', 'dimensions', 'seeds'], empty)[0]).toContain('dimensions、seeds');
    expect(oneShotBootstrapNotice_ACU(3, ['actors', 'player', 'rumors'], empty)[0]).toContain('【空模块】你负责的 actors、rumors 当前为空');
    const filled = { ...empty, actors: [{ id: 'a' }], rumors: [{ id: 'r' }] };
    expect(oneShotBootstrapNotice_ACU(3, ['actors', 'player', 'rumors'], filled)).toEqual([]);
  });

  it('v21 默认段定向升级，用户改写与追加段、元数据保持原样', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = Object.fromEntries(roles.map(role => [role, buildV21WorldSimulationAgentPrompt_ACU(role)]));
    const current = structuredClone(previous);
    current['dramatis-keeper'][3].content += '\n用户改写工作流：保持人物信息边界';
    current['guidance-composer'][4].content += '\n用户附加说明';
    const extra = { role: 'user' as const, content: '用户追加的独立段', enabled: true, deletable: true, pinned: false };
    current['guidance-composer'].push(extra);
    const result = migrateWorldSimulationAgentPromptsDetailed_ACU(current, {}, WORLD_SIMULATION_PROMPT_VERSION_V21_ACU);
    expect(result.forcedRoles).toEqual([]);
    expect(result.prompts['undercurrent-analyst']).toEqual(defaults['undercurrent-analyst']);
    expect(result.prompts['dramatis-keeper'][3]).toEqual(current['dramatis-keeper'][3]);
    expect(result.prompts['guidance-composer'][4]).toEqual(current['guidance-composer'][4]);
    expect(result.prompts['guidance-composer'].at(-1)).toEqual(extra);
    // 未改写的默认段升级到 v28 同 seam 段；HISTORY 在 v28 已删除，迁移后不应残留。
    expect(bySeam(result.prompts['guidance-composer'], 'WORKFLOW')).toEqual(bySeam(defaults['guidance-composer'], 'WORKFLOW'));
    expect(bySeam(result.prompts['guidance-composer'], 'HISTORY')).toBeUndefined();
    expect(bySeam(result.prompts['dramatis-keeper'], 'HISTORY')).toBeUndefined();
  });

  it('v22 默认段升级工具协议，用户修改与附加段不被覆盖', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = Object.fromEntries(roles.map(role => [role, buildV22WorldSimulationAgentPrompt_ACU(role)]));
    const current = structuredClone(previous);
    current['dramatis-keeper'][4].content += '\n用户补充：严格核实人物渠道';
    current['guidance-composer'].push({ role: 'user', content: '用户追加说明', enabled: true, deletable: true, pinned: false });
    const result = migrateWorldSimulationAgentPromptsDetailed_ACU(current, {}, WORLD_SIMULATION_PROMPT_VERSION_V22_ACU);
    expect(result.forcedRoles).toEqual([]);
    expect(result.prompts['undercurrent-analyst']).toEqual(defaults['undercurrent-analyst']);
    expect(result.prompts['dramatis-keeper'][4]).toEqual(current['dramatis-keeper'][4]);
    expect(result.prompts['guidance-composer'].at(-1)).toEqual(current['guidance-composer'].at(-1));
    expect(bySeam(result.prompts['guidance-composer'], 'WORKFLOW')).toEqual(bySeam(defaults['guidance-composer'], 'WORKFLOW'));
    expect(bySeam(result.prompts['guidance-composer'], 'HISTORY')).toBeUndefined();
  });

  it.each([
    [WORLD_SIMULATION_PROMPT_VERSION_V23_ACU, buildV23WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V24_ACU, buildV24WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V25_ACU, buildV25WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V26_ACU, buildV26WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V27_ACU, buildV27WorldSimulationAgentPrompt_ACU],
  ] as const)('%s 默认段升级为完整职责核查，用户修改与附加段不被覆盖', (version, buildPrevious) => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = Object.fromEntries(roles.map(role => [role, buildPrevious(role)]));
    const current = structuredClone(previous);
    current['dramatis-keeper'][4].content += '\n用户补充：严格核实人物渠道';
    current['guidance-composer'].push({ role: 'user', content: '用户追加说明', enabled: true, deletable: true, pinned: false });
    const result = migrateWorldSimulationAgentPromptsDetailed_ACU(current, {}, version);
    expect(result.forcedRoles).toEqual([]);
    expect(result.prompts['undercurrent-analyst']).toEqual(defaults['undercurrent-analyst']);
    expect(bySeam(result.prompts['dramatis-keeper'], 'WORKFLOW')).toEqual(bySeam(defaults['dramatis-keeper'], 'WORKFLOW'));
    expect(result.prompts['dramatis-keeper'][4]).toEqual(current['dramatis-keeper'][4]);
    expect(bySeam(result.prompts['guidance-composer'], 'WORKFLOW')).toEqual(bySeam(defaults['guidance-composer'], 'WORKFLOW'));
    // 各历史版本迁移后都不再带 HISTORY 段。
    for (const role of roles) expect(bySeam(result.prompts[role], 'HISTORY')).toBeUndefined();
    expect(result.prompts['guidance-composer'].at(-1)).toEqual(current['guidance-composer'].at(-1));
  });

  it('非时钟角色先算本轮时间跨度，批次二直接采用批次一维护的 clock', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => fullBody(prompts[role]);
    expect(workflow('dramatis-keeper')).toContain('本轮的时间跨度怎么算');
    expect(workflow('dramatis-keeper')).toContain('本角色不写 clock');
    expect(workflow('guidance-composer')).toContain('不再叠加经过天数');
    expect(workflow('undercurrent-analyst')).toContain('只算锚点里明确发生的推进');
  });

  it('锚点仅为提示词剥离写作注释，原始文本保持不变', () => {
    const anchor = '正文甲<!-- segment_plan: 内部写作笔记 -->\n\n\n正文乙';
    expect(stripWritingAnnotations_ACU(anchor)).toBe('正文甲\n\n正文乙');
    expect(anchor).toContain('segment_plan');
  });

  it('旧版角色键及自定义旧协议提示词能归一化到当前版本', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe(WORLD_SIMULATION_PROMPT_VERSION_V33_ACU);
    const custom = structuredClone(defaults) as Record<string, typeof defaults[typeof roles[number]]>;
    custom['undercurrent-analyst'][0].content += '\n旧版自定义逐栏 write_sql';
    custom.timekeeper = structuredClone(defaults['undercurrent-analyst']);
    custom.chronicler = structuredClone(defaults['guidance-composer']);
    const migrated = migrateWorldSimulationAgentPromptsDetailed_ACU(custom, {});
    expect(Object.keys(migrated.prompts)).not.toContain('timekeeper');
    expect(Object.keys(migrated.prompts)).not.toContain('chronicler');
    expect(migrated.prompts['undercurrent-analyst']).toEqual(defaults['undercurrent-analyst']);
    expect(migrated.forcedRoles).toContain('undercurrent-analyst');
  });
});
