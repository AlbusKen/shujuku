import { beforeEach, describe, expect, it } from 'vitest';

import {
  compareAgentPromptMessages_ACU,
  formatAgentPromptDriftReport_ACU,
  resetAgentPromptDrift_ACU,
  trackAgentPromptDrift_ACU,
} from '../../../../src/service/continuation/agent/agent-prompt-drift';

const skeleton = [
  { role: 'system', content: '静态根规则' },
  { role: 'user', content: '协议规范' },
  { role: 'assistant', content: '我确认协议' },
];

describe('compareAgentPromptMessages_ACU', () => {
  it('首次调用输出基线并统计 system 条数', () => {
    const report = compareAgentPromptMessages_ACU(null, [
      ...skeleton,
      { role: 'system', content: '多余的 system 段' },
    ]);
    expect(report).toMatchObject({ baseline: true, messageCount: 4, systemRoleCount: 2 });
    expect(formatAgentPromptDriftReport_ACU(report)).toContain('system 2 条');
  });

  it('完全一致的重试序列不误报分歧', () => {
    const messages = [...skeleton, { role: 'user', content: '运行时数据 v1' }];
    const report = compareAgentPromptMessages_ACU(messages, messages.map(message => ({ ...message })));
    expect(report).toMatchObject({ identical: true, sharedMessages: 4 });
    expect(formatAgentPromptDriftReport_ACU(report)).toContain('完全一致');
  });

  it('纯尾部追加报告前缀完整保留与新增条数', () => {
    const previous = [...skeleton];
    const current = [...skeleton, { role: 'assistant', content: '新动作' }, { role: 'user', content: '工具结果' }];
    const report = compareAgentPromptMessages_ACU(previous, current);
    expect(report).toMatchObject({ sharedMessages: 3, appendedMessages: 2 });
    expect(report.sharedChars).toBe(skeleton.reduce((sum, message) => sum + message.content.length, 0));
    expect(formatAgentPromptDriftReport_ACU(report)).toContain('前缀完整保留');
  });

  it('健康的尾部运行时分歧报出消息序号与字符偏移及摘录', () => {
    const previous = [...skeleton, { role: 'user', content: '运行时数据：预算 5 轮' }];
    const current = [...skeleton, { role: 'user', content: '运行时数据：预算 4 轮' }];
    const report = compareAgentPromptMessages_ACU(previous, current);
    expect(report).toMatchObject({ divergedMessageIndex: 3, divergedCharOffset: 9 });
    expect(report.previousExcerpt).toContain('预算 5 轮');
    expect(report.currentExcerpt).toContain('预算 4 轮');
  });

  it('头部 role 变化被识别为第 0 条分歧', () => {
    const previous = [{ role: 'system', content: '静态根规则' }, ...skeleton.slice(1)];
    const current = [{ role: 'user', content: '静态根规则' }, ...skeleton.slice(1)];
    const report = compareAgentPromptMessages_ACU(previous, current);
    expect(report).toMatchObject({ divergedMessageIndex: 0, previousRole: 'system', currentRole: 'user' });
    expect(report.divergedCharOffset).toBeUndefined();
    expect(formatAgentPromptDriftReport_ACU(report)).toContain('第 0 条');
  });

  it('超长内容的摘录截断在分歧点前后各 60 字符', () => {
    const sharedHead = '甲'.repeat(200);
    const previous = [{ role: 'user', content: `${sharedHead}旧尾巴` }];
    const current = [{ role: 'user', content: `${sharedHead}新尾巴` }];
    const report = compareAgentPromptMessages_ACU(previous, current);
    expect(report.divergedCharOffset).toBe(200);
    expect(report.currentExcerpt!.length).toBeLessThanOrEqual(60 + 63 + 2);
    expect(report.currentExcerpt).toContain('新尾巴');
    expect(report.currentExcerpt!.startsWith('…')).toBe(true);
  });
});

describe('trackAgentPromptDrift_ACU', () => {
  beforeEach(() => resetAgentPromptDrift_ACU());

  it('按 scope 记忆上次序列并在下次调用时对比', () => {
    const first = trackAgentPromptDrift_ACU('agent-main', skeleton);
    expect(first).toContain('基线建立');
    const second = trackAgentPromptDrift_ACU('agent-main', [...skeleton, { role: 'user', content: '追加' }]);
    expect(second).toContain('前缀完整保留');
  });

  it('不同 scope 互不干扰', () => {
    trackAgentPromptDrift_ACU('agent-main', skeleton);
    const other = trackAgentPromptDrift_ACU('outline', skeleton);
    expect(other).toContain('基线建立');
  });

  it('记忆的是深拷贝：外部改写不污染下次对比', () => {
    const mutable = skeleton.map(message => ({ ...message }));
    trackAgentPromptDrift_ACU('agent-main', mutable);
    mutable[0].content = '被外部改写';
    const report = trackAgentPromptDrift_ACU('agent-main', skeleton.map(message => ({ ...message })));
    expect(report).toContain('完全一致');
  });
});
