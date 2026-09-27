import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationAgentPrompts_ACU, buildV21WorldSimulationAgentPrompt_ACU, buildV22WorldSimulationAgentPrompt_ACU, buildV23WorldSimulationAgentPrompt_ACU, migrateWorldSimulationAgentPromptsDetailed_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROMPT_VERSION_V21_ACU, WORLD_SIMULATION_PROMPT_VERSION_V22_ACU, WORLD_SIMULATION_PROMPT_VERSION_V23_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { worldSimulationOneShotProtocol_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
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

  });

  it('范例解释各角色证据判断与反例，不把示例 ID 当成真实账本条目', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const workflow = (role: typeof roles[number]) => prompts[role].find(segment => segment.content.includes('【推演步骤】'))!.content;
    expect(workflow('undercurrent-analyst')).toContain('若锚点只是回忆昨日，则不写 clock');
    expect(workflow('dramatis-keeper')).toContain('没有其获知渠道，则不写 known_facts');
    expect(workflow('guidance-composer')).toContain('本候选新建的传闻或编年不能充当本候选信号来源');
    for (const role of roles) {
      expect(workflow(role)).toContain('expected_revision');
      expect(workflow(role)).toContain('仅演示推演，不是本轮事实');
    }
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

  it('v23 默认段升级为时间先行推演，用户修改与附加段不被覆盖', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = Object.fromEntries(roles.map(role => [role, buildV23WorldSimulationAgentPrompt_ACU(role)]));
    const current = structuredClone(previous);
    current['dramatis-keeper'][4].content += '\n用户补充：严格核实人物渠道';
    current['guidance-composer'].push({ role: 'user', content: '用户追加说明', enabled: true, deletable: true, pinned: false });
    const result = migrateWorldSimulationAgentPromptsDetailed_ACU(current, {}, WORLD_SIMULATION_PROMPT_VERSION_V23_ACU);
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
    expect(workflow('dramatis-keeper')).toContain('【推演步骤】第一步分析本轮经过的时间');
    expect(workflow('dramatis-keeper')).toContain('本角色不写 clock');
    expect(workflow('guidance-composer')).toContain('【推演步骤】第一步分析本轮时间跨度');
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
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe('world-simulation-v24');
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
