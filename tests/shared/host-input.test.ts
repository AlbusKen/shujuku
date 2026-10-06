// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ jquery: vi.fn(), hostDocument: undefined as Document | undefined }));

vi.mock('../../src/shared/host-api', () => ({
  get jQuery_API_ACU() { return h.jquery; },
}));
vi.mock('../../src/shared/runtime-env', () => ({
  getHostWindow: () => ({ document: h.hostDocument }),
}));

import {
  clickSendButton_ACU,
  getSendTextareaValue_ACU,
  setSendTextareaValue_ACU,
} from '../../src/shared/host-input';
import { SillyTavernHostTurnAdapter_ACU } from '../../src/service/continuation/host-turn-adapter';

describe('host input helpers', () => {
  const textarea = { val: vi.fn(), trigger: vi.fn() };
  const sendButton = { click: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    h.hostDocument = document.implementation.createHTMLDocument('宿主');
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

    expect(h.jquery).toHaveBeenCalledWith('#send_but', h.hostDocument);
    expect(sendButton.click).toHaveBeenCalledTimes(1);

    const empty = { length: 0, click: vi.fn() };
    h.jquery.mockReturnValue(empty);
    expect(clickSendButton_ACU()).toBe(false);
    expect(empty.click).not.toHaveBeenCalled();
  });

  it('iframe 的 jQuery 必须在宿主文档写入指导并触发宿主发送', () => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea"></textarea><button id="send_but"></button>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const button = doc.querySelector<HTMLButtonElement>('#send_but')!;
    const onInput = vi.fn();
    const onSend = vi.fn(() => { expect(input.value).toBe('最终写作指导\n开始正文'); });
    input.addEventListener('input', onInput);
    button.addEventListener('click', onSend);
    h.jquery.mockImplementation((selector: string, context: Document = document) => {
      const element = context.querySelector(selector);
      return {
        0: element, length: element ? 1 : 0,
        val: (text?: string) => {
          if (text !== undefined && element) (element as HTMLTextAreaElement).value = text;
          return (element as HTMLTextAreaElement | null)?.value;
        },
        trigger: vi.fn(), click: () => (element as HTMLElement | null)?.click(),
      };
    });
    expect(new SillyTavernHostTurnAdapter_ACU().send('最终写作指导\r\n开始正文')).toBe(true);
    expect(getSendTextareaValue_ACU()).toBe('最终写作指导\n开始正文');
    expect(onInput).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('宿主 jQuery 不可用时安全降级', () => {
    h.jquery.mockImplementation(() => { throw new Error('host unavailable'); });

    expect(getSendTextareaValue_ACU()).toBe('');
    expect(setSendTextareaValue_ACU('ignored')).toBe(false);
    expect(clickSendButton_ACU()).toBe(false);
  });
});
