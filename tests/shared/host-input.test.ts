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
  protectSendTextareaValue_ACU,
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

  it('原生发送框在异步监听改写与提前清空后仍交付最终提示词，释放后恢复正常读写', async () => {
    const element = document.createElement('textarea');
    element.id = 'send_textarea';
    document.body.replaceChildren(element);
    element.value = '用户原文';
    const collection = {
      0: element, length: 1,
      val(next?: string) {
        if (next !== undefined) element.value = next;
        return element.value;
      },
      trigger: vi.fn(),
    };
    h.jquery.mockReturnValue(collection);
    const rewrite = () => { element.value = '监听器改回的原文'; };
    element.addEventListener('input', rewrite);
    const lease = protectSendTextareaValue_ACU('最终\r\n提示词');
    expect(lease).not.toBeNull();
    try {
      expect(element.readOnly).toBe(true);
      await Promise.resolve();
      collection.val('延迟改写');
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      expect(getSendTextareaValue_ACU()).toBe('最终\n提示词');
      expect(element.value).toBe('最终\n提示词');
      // 绕过自有 setter 的原生写入，普通宿主读取仍须得到本轮提示词。
      const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
      nativeValue.set!.call(element, '绕过写入');
      expect(collection.val()).toBe('最终\n提示词');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      expect(nativeValue.get!.call(element)).toBe('最终\n提示词');
      element.removeEventListener('input', rewrite);
      element.value = '下一轮草稿';
      expect(lease!.getDraft()).toBe('下一轮草稿');
      lease!.release('');
      expect(element.readOnly).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(element, 'value')).toBe(false);
      expect(element.value).toBe('');
      element.value = '释放后输入';
      lease!.release('不能重复释放');
      expect(element.value).toBe('释放后输入');
      Object.defineProperty(element, 'value', { configurable: true, value: '其它扩展的属性' });
      expect(protectSendTextareaValue_ACU('拒绝覆盖')).toBeNull();
      expect(element.value).toBe('其它扩展的属性');
    } finally {
      lease?.release('');
      document.body.replaceChildren();
    }
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
