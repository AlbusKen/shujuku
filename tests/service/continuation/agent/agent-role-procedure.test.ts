import { describe, expect, it } from 'vitest';

import { USER_PREFILL_CONTENT_ACU } from '../../../../src/shared/user-prefill.js';
import {
  buildDefaultContinuationAgentPrompts_ACU,
  buildV40ContinuationAgentPrompts_ACU,
  buildV41ContinuationAgentPrompts_ACU,
  withV41RoleProcedure_ACU,
} from '../../../../src/service/continuation/agent/agent-defaults';
import { validateContinuationSettings_ACU } from '../../../../src/service/continuation/continuation-store';
import { buildDefaultContinuationSettings_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V40_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V44_ACU } from '../../../../src/service/continuation/defaults';

const ROLES_ACU = ['arcArchitect', 'maintainer', 'mainlinePlanner', 'beatPlanner', 'reviewer', 'finalReviewer', 'webResearcher', 'instructionComposer'] as const;

describe('V41 子代理执行流程问答', () => {
  const defaults = buildDefaultContinuationAgentPrompts_ACU();
  const v40 = buildV40ContinuationAgentPrompts_ACU();

  it.each(ROLES_ACU)('%s 在任务段正前方多一组流程问答，预填充仍是最后一条', role => {
    const segments = defaults[role];
    const task = segments.findIndex(segment => segment.content.includes('$AGENT_TASK'));
    expect(segments.length).toBe(v40[role].length + 2);
    expect(segments[task - 2].role).toBe('user');
    expect(segments[task - 1].role).toBe('assistant');
    // 流程自述要写到可执行粒度，而不是一句概括。
    expect(segments[task - 1].content).toMatch(/第一步[\s\S]*第四步/);
    expect(segments[task - 1].content).not.toMatch(/\$[A-Z]/);
    expect(segments.filter(segment => segment.content.includes('$AGENT_TASK'))).toHaveLength(1);
    expect(segments.at(-1)).toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
  });

  it('V41 不改主 Agent', () => {
    expect(buildV41ContinuationAgentPrompts_ACU().main).toEqual(v40.main);
  });

  it('任务段前一段被用户改写时不插入；重复调用不重复插入', () => {
    const base = v40.reviewer;
    const task = base.findIndex(segment => segment.content.includes('$AGENT_TASK'));
    const customized = base.map((segment, index) => index === task - 1 ? { ...segment, content: `${segment.content}\n用户补充` } : segment);
    expect(withV41RoleProcedure_ACU('reviewer', customized)).toEqual(customized);
    const once = withV41RoleProcedure_ACU('reviewer', base);
    expect(withV41RoleProcedure_ACU('reviewer', once)).toEqual(once);
  });

  it('V40 存量配置迁移到 V41 后与当前默认组一致，整组自定义的角色原样保留', () => {
    const settings = buildDefaultContinuationSettings_ACU() as any;
    settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V40_ACU;
    settings.agentPrompts = buildV40ContinuationAgentPrompts_ACU();
    const custom = [{ role: 'user', content: '用户自定义策划提示词', enabled: true, deletable: true }];
    settings.agentPrompts.beatPlanner = custom;
    const loaded = validateContinuationSettings_ACU(settings);
    expect(loaded.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V44_ACU);
    for (const role of ROLES_ACU.filter(item => item !== 'beatPlanner')) expect(loaded.agentPrompts[role]).toEqual(defaults[role]);
    expect(loaded.agentPrompts.beatPlanner).toEqual(custom);
  });
});
