import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationAgentPrompts_ACU, buildV21WorldSimulationAgentPrompt_ACU, buildV22WorldSimulationAgentPrompt_ACU, buildV23WorldSimulationAgentPrompt_ACU, buildV24WorldSimulationAgentPrompt_ACU, buildV25WorldSimulationAgentPrompt_ACU, buildV26WorldSimulationAgentPrompt_ACU, migrateWorldSimulationAgentPromptsDetailed_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROMPT_VERSION_V21_ACU, WORLD_SIMULATION_PROMPT_VERSION_V22_ACU, WORLD_SIMULATION_PROMPT_VERSION_V23_ACU, WORLD_SIMULATION_PROMPT_VERSION_V24_ACU, WORLD_SIMULATION_PROMPT_VERSION_V25_ACU, WORLD_SIMULATION_PROMPT_VERSION_V26_ACU, WORLD_SIMULATION_PROMPT_VERSION_V27_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { oneShotBootstrapNotice_ACU, worldSimulationOneShotProtocol_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
import { validateWorldSimulationPromptSegments_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { stripWritingAnnotations_ACU } from '../../../../src/service/simulation/simulation-projection';

const roles = ['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'] as const;

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
      expect(body).toContain('【推演步骤】');
      expect(body).toContain('【职责清单】');
      expect(body).toContain('【覆盖义务】');
      expect(body).toContain('【收口自检】');
      expect(body).toContain('全模块核查不等于全模块强制写入');
      expect(body).toContain('【情境范例（仅演示推演，不是本轮事实）】');
    }
    const guidanceBody = prompts['guidance-composer'].map(item => item.content).join('\\n');
    expect(guidanceBody).toContain('chronicle_overview');
    expect(guidanceBody).toContain('不能把 summary 或 related_ids 写入 chronicle_overview');
    expect(guidanceBody).toContain('不能编造 rumors:1 等伪 ID');
    const protocol = worldSimulationOneShotProtocol_ACU('guidance-composer', ['chronicle', 'rumors', 'guidance']);
    expect(protocol).toContain('原生 write_sql');
    expect(protocol).not.toContain('"status":"candidate"');
    expect(protocol).toContain('chronicle_overview=(fingerprint, day, one_line, archive_ref)');
    expect(protocol).toContain('不能写 rumors:1');
    expect(protocol).not.toContain('"reads":["ledger:current"]');
    expect(protocol).toContain('ledger:current 并非普通角色可读地址');
    expect(protocol).toContain('闭合于 <think> 标签中');
    expect(protocol).toContain('【可写列白名单】');
    expect(protocol).toContain('guidance(signals, excluded_facts, evidence_refs)');
    const clockProtocol = worldSimulationOneShotProtocol_ACU('undercurrent-analyst', ['clock', 'dimensions', 'seeds']);
    expect(clockProtocol).toContain('clock(days, story_time, slot, evidence_refs)');
    expect(clockProtocol).not.toMatch(/clock\([^)]*\bday\b/);
    expect(clockProtocol).not.toMatch(/dimensions\([^)]*visibility/);
  });

  it('v26 把列名与修订号写法落到具体 SQL，无变化不再被说成失败', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => prompts[role].find(segment => segment.content.includes('【推演步骤】'))!.content;
    for (const role of roles) {
      expect(workflow(role)).toContain('【可写列白名单】');
      expect(workflow(role)).toContain('修订号只出现在 WHERE');
      expect(workflow(role)).toContain('不要把“无需写入”说成失败');
      expect(workflow(role)).not.toContain('其余行各用自身 revision');
    }
    expect(workflow('undercurrent-analyst')).toContain('clock 只写推进量 days，没有 day 列');
    expect(workflow('undercurrent-analyst')).toContain('dimensions 没有 visibility 列');
    expect(workflow('dramatis-keeper')).toContain('WHERE expected_revision = 运行时“单例修订号”');
    expect(workflow('dramatis-keeper')).toContain('这属于无变化，不是失败');
  });

  it('范例解释各角色证据判断与反例，不把示例 ID 当成真实账本条目', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => prompts[role].find(segment => segment.content.includes('【推演步骤】'))!.content;
    expect(workflow('undercurrent-analyst')).toContain('若锚点只是回忆昨日，则不写 clock');
    expect(workflow('dramatis-keeper')).toContain('没有获知封城的渠道，就不给他写这条认知');
    expect(workflow('guidance-composer')).toContain('本候选新建的风声或纪要不能充当本候选信号来源');
    for (const role of roles) {
      expect(workflow(role)).toContain('expected_revision');
      expect(workflow(role)).toContain('仅演示推演，不是本轮事实');
    }
  });

  it('三个角色分别覆盖所有职责并在单次交付前交叉复核，冻结的 v24/v26 正文不被 v27 改写', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const checks = {
      'undercurrent-analyst': ['clock 时序', 'dimensions 局势刻度', 'seeds 伏线', '第二步·局势刻度', '第三步·存量伏线', '第四步·期限', '第五步·埋设新伏线', '第六步·交叉复核'],
      'dramatis-keeper': ['player 玩家所在', 'actors 人物谱', 'rumors 仅死亡伴生', '第二步·玩家', '第三步·点名', '第四步·在册人物', '第五步·认知边界', '第六步·生死'],
      'guidance-composer': ['chronicle 幕后纪要', 'rumors 风声', 'guidance 场外信号', '第二步·幕后纪要', '第三步·归档', '第四步·风声', '第五步·场外信号选题', '第六步·旧信号清理'],
    } as const;
    for (const role of roles) {
      const workflow = prompts[role].find(segment => segment.content.includes('【推演步骤】'))!.content;
      for (const check of checks[role]) expect(workflow).toContain(check);
      expect(workflow).toContain('同一次原生 write_sql');
      const old = buildV24WorldSimulationAgentPrompt_ACU(role);
      expect(old.find(segment => segment.content.includes('【推演步骤】'))!.content).not.toContain('【职责清单】');
      expect(old.find(segment => segment.content.includes('【推演步骤】'))!.content).not.toBe(workflow);
      const v26 = buildV26WorldSimulationAgentPrompt_ACU(role).find(segment => segment.content.includes('【推演步骤】'))!.content;
      expect(v26).not.toContain('【首轮建账】');
      expect(v26).not.toBe(workflow);
    }
  });

  it('v27 各角色写明首轮建账，去掉新建条数硬上限，且只用格林推演自己的术语', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    for (const role of roles) {
      const body = prompts[role].map(item => item.content).join('\n');
      expect(body).toContain('【首轮建账】');
      expect(body).toContain('空表不是“无变化”的理由');
      expect(body).toContain('格林推演系统');
      expect(body).not.toMatch(/暗流|种子|行动者|编年|传闻|投影|世界推演/);
      expect(body).not.toContain('本轮最多新建 3 条');
      expect(body).not.toContain('本轮最多新增 3 人');
      expect(body).toContain('INSERT 新行不写 revision 或 expected_revision');
    }
    const dramatis = prompts['dramatis-keeper'].map(item => item.content).join('\n');
    expect(dramatis).toContain('锚点里的具名人物全部建档');
    expect(dramatis).toContain('未建档的，只要不是一次性路人，本轮就建档');
    const undercurrent = prompts['undercurrent-analyst'].map(item => item.content).join('\n');
    expect(undercurrent).toContain('埋设 3-6 条伏线');
    expect(undercurrent).toContain('提炼 2-5 个局势刻度');
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
    expect(result.prompts['guidance-composer'][3]).toEqual(defaults['guidance-composer'][3]);
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
    expect(result.prompts['guidance-composer'][3]).toEqual(defaults['guidance-composer'][3]);
  });

  it.each([
    [WORLD_SIMULATION_PROMPT_VERSION_V23_ACU, buildV23WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V24_ACU, buildV24WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V25_ACU, buildV25WorldSimulationAgentPrompt_ACU],
    [WORLD_SIMULATION_PROMPT_VERSION_V26_ACU, buildV26WorldSimulationAgentPrompt_ACU],
  ] as const)('%s 默认段升级为完整职责核查，用户修改与附加段不被覆盖', (version, buildPrevious) => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = Object.fromEntries(roles.map(role => [role, buildPrevious(role)]));
    const current = structuredClone(previous);
    current['dramatis-keeper'][4].content += '\n用户补充：严格核实人物渠道';
    current['guidance-composer'].push({ role: 'user', content: '用户追加说明', enabled: true, deletable: true, pinned: false });
    const result = migrateWorldSimulationAgentPromptsDetailed_ACU(current, {}, version);
    expect(result.forcedRoles).toEqual([]);
    expect(result.prompts['undercurrent-analyst']).toEqual(defaults['undercurrent-analyst']);
    expect(result.prompts['dramatis-keeper'][3]).toEqual(defaults['dramatis-keeper'][3]);
    expect(result.prompts['dramatis-keeper'][4]).toEqual(current['dramatis-keeper'][4]);
    expect(result.prompts['guidance-composer'][3]).toEqual(defaults['guidance-composer'][3]);
    expect(result.prompts['guidance-composer'].at(-1)).toEqual(current['guidance-composer'].at(-1));
  });

  it('非时钟角色推演第一步先分析本轮时间跨度，批次二直接采用批次一维护的 clock', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => prompts[role].find(segment => segment.content.includes('【推演步骤】'))!.content;
    expect(workflow('dramatis-keeper')).toContain('【推演步骤】第一步·时间跨度');
    expect(workflow('dramatis-keeper')).toContain('本角色不写 clock');
    expect(workflow('guidance-composer')).toContain('【推演步骤】第一步·时间');
    expect(workflow('guidance-composer')).toContain('不再叠加经过天数');
    expect(workflow('guidance-composer')).not.toContain('仅加上锚点明确发生的时间推进');
    expect(workflow('undercurrent-analyst')).toContain('仅加上锚点明确发生的时间推进');
  });

  it('锚点仅为提示词剥离写作注释，原始文本保持不变', () => {
    const anchor = '正文甲<!-- segment_plan: 内部写作笔记 -->\n\n\n正文乙';
    expect(stripWritingAnnotations_ACU(anchor)).toBe('正文甲\n\n正文乙');
    expect(anchor).toContain('segment_plan');
  });

  it('旧版角色键及自定义旧协议提示词能归一化到当前版本', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe(WORLD_SIMULATION_PROMPT_VERSION_V27_ACU);
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
