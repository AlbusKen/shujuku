import { beforeEach, describe, expect, it } from 'vitest';
import { compareWorldSimulationPromptMessages_ACU, resetWorldSimulationPromptDrift_ACU, trackWorldSimulationPromptDrift_ACU } from '../../../../src/service/simulation/agent/agent-prompt-drift';

describe('世界推演提示词漂移诊断', () => {
  beforeEach(() => resetWorldSimulationPromptDrift_ACU());

  it('区分基线、相同提示词和首个漂移消息', () => {
    const first = [{ role: 'system', content: 'A' }, { role: 'user', content: 'B' }];
    expect(trackWorldSimulationPromptDrift_ACU('main', first)).toMatchObject({ baseline: true, identical: false });
    expect(trackWorldSimulationPromptDrift_ACU('main', first)).toMatchObject({ baseline: false, identical: true, sharedMessages: 2 });
    expect(trackWorldSimulationPromptDrift_ACU('main', [{ role: 'system', content: 'A' }, { role: 'assistant', content: 'C' }])).toMatchObject({ identical: false, divergedMessageIndex: 1, previousRole: 'user', currentRole: 'assistant' });
  });

  it('比较函数不修改输入', () => {
    const previous = [{ role: 'system', content: 'A' }];
    const current = [{ role: 'system', content: 'B' }];
    expect(compareWorldSimulationPromptMessages_ACU(previous, current)).toMatchObject({ sharedMessages: 0 });
    expect(previous[0].content).toBe('A');
  });
});
