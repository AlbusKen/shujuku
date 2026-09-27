import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationAgentPrompts_ACU, migrateWorldSimulationAgentPromptsDetailed_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { validateWorldSimulationPromptSegments_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { stripWritingAnnotations_ACU } from '../../../../src/service/simulation/simulation-projection';

const roles = ['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'] as const;

describe('一次性资料角色默认提示词', () => {
  it('三个角色的 seam 均合法，正文不重复输出协议或旧逐栏写入指令', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    for (const role of roles) {
      expect(() => validateWorldSimulationPromptSegments_ACU(prompts[role], role)).not.toThrow();
      const body = prompts[role].map(item => item.content).join('\n');
      expect(body).not.toContain('write_sql');
      expect(body).not.toContain('timekeeper');
      expect(body).not.toContain('chronicler');
      expect(body).not.toContain('【输出协议】'); // 协议仅由一次性运行时的首条 system 消息注入。
    }
  });

  it('锚点仅为提示词剥离写作注释，原始文本保持不变', () => {
    const anchor = '正文甲<!-- segment_plan: 内部写作笔记 -->\n\n\n正文乙';
    expect(stripWritingAnnotations_ACU(anchor)).toBe('正文甲\n\n正文乙');
    expect(anchor).toContain('segment_plan');
  });

  it('旧版角色键及自定义旧协议提示词能归一化到当前版本', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe('world-simulation-v21');
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
