import { describe, expect, it } from 'vitest';

import { USER_PREFILL_CONTENT_ACU } from '../../../../src/shared/user-prefill.js';
import {
  buildDefaultContinuationAgentPrompts_ACU,
  buildV39ContinuationAgentPrompts_ACU,
  buildV40ContinuationAgentPrompts_ACU,
  withV40RoleSelfNarration_ACU,
} from '../../../../src/service/continuation/agent/agent-defaults';
import { validateContinuationSettings_ACU } from '../../../../src/service/continuation/continuation-store';
import { buildDefaultContinuationSettings_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V44_ACU } from '../../../../src/service/continuation/defaults';

const TARGETS_ACU = [
  ['arcArchitect', '【卷级容量、时间与长期经营契约】'],
  ['maintainer', '【故事年代学账本现状】'],
  ['finalReviewer', '【故事时间一致性审查】'],
  ['instructionComposer', '你是写作指令编排代理 instruction-composer。'],
] as const;

describe('V40 子代理自述段', () => {
  const defaults = buildDefaultContinuationAgentPrompts_ACU();
  // 段位与「不重复补段」断言针对 V40 冻结组；V41 又在任务段前加了执行流程问答。
  const v40 = buildV40ContinuationAgentPrompts_ACU();

  it.each(TARGETS_ACU)('%s 的目标段后紧跟自述，且全部位于任务段与预填充之前', (role, anchor) => {
    const segments = v40[role];
    const target = segments.findIndex(segment => segment.content.startsWith(anchor));
    expect(target).toBeGreaterThanOrEqual(0);
    const task = segments.findIndex(segment => segment.content.includes('$AGENT_TASK'));
    const narration = segments.slice(target + 1, task).filter(segment => segment.role === 'assistant');
    expect(narration).toHaveLength(1);
    // 自述不能被当成任务段或槽位段，也不能带占位符。
    expect(narration[0].content).not.toMatch(/\$[A-Z]/);
    expect(segments.at(-1)).toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
    expect(segments.filter(segment => segment.content.includes('$AGENT_TASK'))).toHaveLength(1);
  });

  it('instructionComposer 补的是一组完整问答，提问在前、自述在后', () => {
    const segments = v40.instructionComposer;
    expect(segments[1].role).toBe('user');
    expect(segments[2].role).toBe('assistant');
    expect(segments[1].content).not.toContain('$');
  });

  it('其余已有问答的角色不重复补段', () => {
    const previous = buildV39ContinuationAgentPrompts_ACU();
    for (const role of ['main', 'mainlinePlanner', 'beatPlanner', 'reviewer', 'webResearcher'] as const) {
      expect(v40[role]).toEqual(previous[role]);
    }
  });

  it('用户改写过目标段时不补自述；重复调用不重复插入', () => {
    const previous = buildV39ContinuationAgentPrompts_ACU().maintainer;
    const customized = previous.map(segment => segment.content.startsWith('【故事年代学账本现状】')
      ? { ...segment, content: `${segment.content}\n用户补充` } : segment);
    expect(withV40RoleSelfNarration_ACU('maintainer', customized)).toEqual(customized);
    const once = withV40RoleSelfNarration_ACU('maintainer', previous);
    expect(withV40RoleSelfNarration_ACU('maintainer', once)).toEqual(once);
  });

  it('V39 存量配置迁移到 V40 后与当前默认组一致，用户改写的角色原样保留', () => {
    const settings = buildDefaultContinuationSettings_ACU() as any;
    settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU;
    settings.agentPrompts = buildV39ContinuationAgentPrompts_ACU();
    const custom = [{ role: 'user', content: '用户自定义终审提示词', enabled: true, deletable: true }];
    settings.agentPrompts.finalReviewer = custom;
    const loaded = validateContinuationSettings_ACU(settings);
    expect(loaded.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V44_ACU);
    expect(loaded.agentPrompts.arcArchitect).toEqual(defaults.arcArchitect);
    expect(loaded.agentPrompts.maintainer).toEqual(defaults.maintainer);
    expect(loaded.agentPrompts.instructionComposer).toEqual(defaults.instructionComposer);
    expect(loaded.agentPrompts.finalReviewer).toEqual(custom);
  });
});
