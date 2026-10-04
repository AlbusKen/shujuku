// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ jquery: vi.fn() }));

vi.mock('../../src/shared/host-api', () => ({
  get jQuery_API_ACU() { return h.jquery; },
}));

import {
  clickSendButton_ACU,
  getSendTextareaValue_ACU,
  setSendTextareaValue_ACU,
} from '../../src/shared/host-input';

describe('host input helpers', () => {
  const textarea = { val: vi.fn(), trigger: vi.fn() };
  const sendButton = { click: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    h.jquery.mockImplementation((selector: string) => selector === '#send_textarea' ? textarea : sendButton);
  });

  it('读取、写入宿主发送框并触发 input', () => {
    let value = '原始输入';
    textarea.val.mockImplementation((next?: string) => {
      if (next !== undefined) value = next.replace(/\r\n?/g, '\n');
      return value;
    });

    expect(getSendTextareaValue_ACU()).toBe('原始输入');
    expect(setSendTextareaValue_ACU('下一条消息')).toBe(true);

    expect(textarea.val).toHaveBeenCalledWith('下一条消息');
    expect(textarea.trigger).toHaveBeenCalledWith('input');
    expect(setSendTextareaValue_ACU('多行\r\n提示词')).toBe(true);
    expect(getSendTextareaValue_ACU()).toBe('多行\n提示词');

    // input 监听改回原文时，必须如实报告写回失败。
    textarea.trigger.mockImplementationOnce(() => { value = '原始输入'; });
    expect(setSendTextareaValue_ACU('推进提示词')).toBe(false);
    expect(getSendTextareaValue_ACU()).toBe('原始输入');
    // 空 jQuery 集合即使提供 val/trigger 也不代表存在发送框。
    h.jquery.mockReturnValue({ length: 0, val: vi.fn(), trigger: vi.fn() });
    expect(setSendTextareaValue_ACU('推进提示词')).toBe(false);
  });

  it('点击宿主发送按钮', () => {
    expect(clickSendButton_ACU()).toBe(true);

    expect(h.jquery).toHaveBeenCalledWith('#send_but');
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('宿主 jQuery 不可用时安全降级', () => {
    h.jquery.mockImplementation(() => { throw new Error('host unavailable'); });

    expect(getSendTextareaValue_ACU()).toBe('');
    expect(setSendTextareaValue_ACU('ignored')).toBe(false);
    expect(clickSendButton_ACU()).toBe(false);
  });
});
