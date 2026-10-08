// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ jquery: vi.fn(), generate: vi.fn(), markSendIntent: vi.fn(), hostDocument: undefined as Document | undefined }));

vi.mock('../../src/shared/host-api', () => ({
  get jQuery_API_ACU() { return h.jquery; },
  SillyTavern_API_ACU: { generate: h.generate },
}));
vi.mock('../../src/service/runtime/state-manager', () => ({
  markUserSendIntent_ACU: () => h.markSendIntent(),
}));
vi.mock('../../src/shared/runtime-env', () => ({
  getHostWindow: () => ({ document: h.hostDocument }),
}));

import {
  clickSendButton_ACU,
  getSendTextareaValue_ACU,
  triggerHostGenerate_ACU,
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
    const reportFailure = vi.fn();
    expect(setSendTextareaValue_ACU('推进提示词', reportFailure)).toBe(false);
    expect(reportFailure).toHaveBeenLastCalledWith({
      reason: 'input_changed_value', phase: 'verify', access: 'jquery',
      expectedLength: 5, assignedLength: 5, actualLength: 4,
    });
    expect(getSendTextareaValue_ACU()).toBe('原始输入');
    // 空 jQuery 集合即使提供 val/trigger 也不代表存在发送框。
    h.jquery.mockReturnValue({ length: 0, val: vi.fn(), trigger: vi.fn() });
    expect(setSendTextareaValue_ACU('推进提示词', reportFailure)).toBe(false);
    expect(reportFailure).toHaveBeenLastCalledWith({
      reason: 'control_unavailable', phase: 'lookup', access: 'jquery', expectedLength: 5,
    });
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

  it.each(['unchanged', 'rewritten', 'replaced'])('每轮写作指导经宿主 input %s 后，直接生成并消费完整文本', mode => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea"></textarea><button id="send_but"></button>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const button = doc.querySelector<HTMLButtonElement>('#send_but')!;
    const onInput = vi.fn(() => {
      if (mode === 'rewritten') input.value = input.value.slice(0, -2);
      if (mode === 'replaced') input.replaceWith(input.cloneNode() as HTMLTextAreaElement);
    });
    const onSend = vi.fn();
    h.generate.mockImplementation(type => { expect(type).toBe('normal'); expect(input.value).toBe('最终写作指导\n开始正文'); });
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
    expect(new SillyTavernHostTurnAdapter_ACU().send('最终写作指导\r\n开始正文')).toBe(mode !== 'replaced');
    if (mode !== 'replaced') expect(getSendTextareaValue_ACU()).toBe('最终写作指导\n开始正文');
    expect(onInput).toHaveBeenCalledOnce();
    expect(h.generate).toHaveBeenCalledTimes(mode === 'replaced' ? 0 : 1);
    expect(h.markSendIntent).toHaveBeenCalledTimes(mode === 'replaced' ? 0 : 1);
    if (mode !== 'replaced') expect(h.markSendIntent).toHaveBeenCalledBefore(h.generate);
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each(['empty', 'throwing'])('宿主原生输入框在 jQuery %s 时仍能读写并通知原生监听器', mode => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea">原始输入</textarea>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    h.jquery.mockImplementation(() => {
      if (mode === 'throwing') throw new Error('jquery unavailable');
      return { length: 0, val: vi.fn(), trigger: vi.fn() };
    });

    expect(getSendTextareaValue_ACU()).toBe('原始输入');
    expect(setSendTextareaValue_ACU('')).toBe(true);
    expect(input.value).toBe('');
    expect(setSendTextareaValue_ACU('最终指导\r\n开始正文')).toBe(true);
    expect(getSendTextareaValue_ACU()).toBe('最终指导\n开始正文');
    expect(onInput).toHaveBeenCalledTimes(2);
    expect(h.jquery).not.toHaveBeenCalled();
  });

  it.each(['rewritten', 'replaced'])('原生 input 监听使最终指令 %s 时拒绝交接', mode => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea">原始输入</textarea>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    input.addEventListener('input', () => {
      if (mode === 'rewritten') input.value = '其他内容';
      else {
        const replacement = doc.createElement('textarea');
        replacement.id = 'send_textarea';
        replacement.value = '其他内容';
        input.replaceWith(replacement);
      }
    });

    const reportFailure = vi.fn();
    expect(setSendTextareaValue_ACU('最终指令', reportFailure)).toBe(false);
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
      reason: mode === 'rewritten' ? 'input_changed_value' : 'control_replaced',
      phase: 'verify', access: 'native', expectedLength: 4, assignedLength: 4,
      ...(mode === 'rewritten' ? { actualLength: 4 } : {}),
    });
    expect(JSON.stringify(reportFailure.mock.calls)).not.toContain('最终指令');
    expect(JSON.stringify(reportFailure.mock.calls)).not.toContain('其他内容');
    expect(getSendTextareaValue_ACU()).toBe('其他内容');
  });

  it('最终指令恢复675→673的同步input改写，仅通知一次并交接完整文本', () => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea"></textarea>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const finalMessage = `<plot>${'x'.repeat(662)}</plot>`;
    const notify = vi.fn(() => { input.value = input.value.slice(0, -2); });
    input.addEventListener('input', notify);
    const reportFailure = vi.fn();

    expect(finalMessage).toHaveLength(675);
    expect(setSendTextareaValue_ACU(finalMessage, reportFailure)).toBe(false);
    expect(input.value).toHaveLength(673);
    notify.mockClear();
    reportFailure.mockClear();
    expect(setSendTextareaValue_ACU(finalMessage, reportFailure, { restoreAfterInput: true })).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(getSendTextareaValue_ACU()).toBe(finalMessage);
    // 与宿主一致，从真实控件读取而不是只检查写入器返回值。
    const consumed = input.value;
    input.value = '';
    expect(consumed).toBe(finalMessage);
  });

  it.each(['unchanged', 'replaced'])('最终指令模式仍拒绝初次赋值失败或控件替换（%s）', cause => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea">原始输入</textarea>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const setter = cause === 'unchanged'
      ? vi.spyOn(input, 'value', 'set').mockImplementation(() => {}) : undefined;
    if (cause === 'replaced') input.addEventListener('input', () => {
      const replacement = doc.createElement('textarea');
      replacement.id = 'send_textarea';
      replacement.value = '其他内容';
      input.replaceWith(replacement);
    });
    const reportFailure = vi.fn();
    try {
      expect(setSendTextareaValue_ACU('最终指令', reportFailure, { restoreAfterInput: true })).toBe(false);
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
        reason: cause === 'unchanged' ? 'assignment_mismatch' : 'control_replaced',
        phase: 'verify', access: 'native', expectedLength: 4, assignedLength: 4,
        ...(cause === 'unchanged' ? { actualLength: 4 } : {}),
      });
      if (setter) expect(setter).toHaveBeenCalledOnce();
    } finally {
      setter?.mockRestore();
    }
  });

  it.each(['ignored', 'exception', 'replaced'])('一次恢复%s时仍拒绝交接，不循环通知或放宽内容校验', cause => {
    const doc = h.hostDocument!;
    doc.body.innerHTML = '<textarea id="send_textarea"></textarea>';
    const input = doc.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const nativeSet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
    let writes = 0;
    const setter = vi.spyOn(input, 'value', 'set').mockImplementation(value => {
      writes++;
      if (writes === 2) {
        if (cause === 'exception') throw new TypeError('敏感最终指令');
        if (cause === 'replaced') {
          const replacement = doc.createElement('textarea');
          replacement.id = 'send_textarea';
          input.replaceWith(replacement);
        }
        return;
      }
      nativeSet.call(input, value);
    });
    const notify = vi.fn(() => { nativeSet.call(input, '改写后文本'); });
    input.addEventListener('input', notify);
    const reportFailure = vi.fn();
    try {
      expect(setSendTextareaValue_ACU('最终指令', reportFailure, { restoreAfterInput: true })).toBe(false);
      expect(writes).toBe(2);
      expect(notify).toHaveBeenCalledOnce();
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
        reason: cause === 'exception' ? 'exception' : cause === 'replaced' ? 'control_replaced' : 'input_changed_value',
        phase: cause === 'exception' ? 'restore' : 'verify', access: 'native',
        expectedLength: 4, assignedLength: 4,
        ...(cause === 'ignored' ? { actualLength: 5 } : {}),
        ...(cause === 'exception' ? { errorType: 'TypeError' } : {}),
      });
      expect(JSON.stringify(reportFailure.mock.calls)).not.toContain('敏感最终指令');
    } finally {
      setter.mockRestore();
    }
  });

  it.each(['native', 'jquery'])('%s 赋值未生效时报告不一致，不把同长度文本当作成功', mode => {
    const reportFailure = vi.fn();
    let restore: (() => void) | undefined;
    if (mode === 'native') {
      h.hostDocument!.body.innerHTML = '<textarea id="send_textarea">原始输入</textarea>';
      const input = h.hostDocument!.querySelector<HTMLTextAreaElement>('#send_textarea')!;
      const setter = vi.spyOn(input, 'value', 'set').mockImplementation(() => {});
      restore = () => setter.mockRestore();
    } else {
      textarea.val.mockImplementation(() => '原始输入');
    }
    try {
      expect(setSendTextareaValue_ACU('最终指令', reportFailure)).toBe(false);
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
        reason: 'assignment_mismatch', phase: 'verify', access: mode,
        expectedLength: 4, assignedLength: 4, actualLength: 4,
      });
      expect(getSendTextareaValue_ACU()).toBe('原始输入');
    } finally {
      restore?.();
    }
  });

  it.each(['assign', 'notify'])('原生 %s 抛错时报告固定阶段，不泄露异常正文', phase => {
    h.hostDocument!.body.innerHTML = '<textarea id="send_textarea">原始输入</textarea>';
    const input = h.hostDocument!.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    const failure = () => { throw new TypeError('敏感异常载荷：最终指令'); };
    const operation = phase === 'assign'
      ? vi.spyOn(input, 'value', 'set').mockImplementation(failure)
      : vi.spyOn(input, 'dispatchEvent').mockImplementation(failure);
    const reportFailure = vi.fn();
    try {
      expect(setSendTextareaValue_ACU('最终指令', reportFailure)).toBe(false);
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
        reason: 'exception', phase, access: 'native', expectedLength: 4,
        ...(phase === 'notify' ? { assignedLength: 4 } : {}), errorType: 'TypeError',
      });
      expect(JSON.stringify(reportFailure.mock.calls)).not.toContain('敏感异常载荷');
      expect(JSON.stringify(reportFailure.mock.calls)).not.toContain('最终指令');
    } finally {
      operation.mockRestore();
    }
  });

  it('jQuery 通知异常及诊断回调异常均保持失败契约，成功调用不继承上次诊断', () => {
    let value = '原始输入';
    textarea.val.mockImplementation((next?: string) => {
      if (next !== undefined) value = next;
      return value;
    });
    textarea.trigger.mockImplementationOnce(() => { throw new TypeError('敏感正文'); });
    const reportFailure = vi.fn(() => { throw new Error('接收方错误'); });
    expect(setSendTextareaValue_ACU('最终指令', reportFailure)).toBe(false);
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
      reason: 'exception', phase: 'notify', access: 'jquery',
      expectedLength: 4, assignedLength: 4, errorType: 'TypeError',
    });
    const nextReporter = vi.fn();
    expect(setSendTextareaValue_ACU('下一条消息', nextReporter)).toBe(true);
    expect(nextReporter).not.toHaveBeenCalled();
    expect(getSendTextareaValue_ACU()).toBe('下一条消息');
  });

  it('宿主 jQuery 不可用时安全降级', () => {
    h.jquery.mockImplementation(() => { throw new Error('host unavailable'); });

    expect(getSendTextareaValue_ACU()).toBe('');
    const reportFailure = vi.fn();
    expect(setSendTextareaValue_ACU('ignored', reportFailure)).toBe(false);
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
      reason: 'exception', phase: 'lookup', access: 'jquery', expectedLength: 7, errorType: 'Error',
    });
    expect(clickSendButton_ACU()).toBe(false);
  });

describe('宿主生成调用诊断', () => {
  it('区分发出调用与异步失败，不输出异常正文，诊断回调异常不影响布尔契约', async () => {
    const report = vi.fn();
    h.generate.mockImplementationOnce(() => Promise.reject(new TypeError('敏感正文和 API 密钥')));
    expect(triggerHostGenerate_ACU('normal', report)).toBe(true);
    expect(report.mock.calls.map(([event]) => event.stage)).toEqual(['calling', 'dispatched']);
    await Promise.resolve();
    expect(report).toHaveBeenLastCalledWith({ stage: 'rejected', source: 'api', errorType: 'TypeError' });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/敏感正文|密钥/);

    h.generate.mockImplementationOnce(() => { throw new RangeError('私有载荷'); });
    expect(triggerHostGenerate_ACU('normal', report)).toBe(false);
    expect(report).toHaveBeenLastCalledWith({ stage: 'rejected', source: 'api', errorType: 'RangeError' });

    h.generate.mockImplementationOnce(() => Promise.resolve());
    const broken = vi.fn(() => { throw new Error('观察失败'); });
    expect(triggerHostGenerate_ACU('normal', broken)).toBe(true);
    await Promise.resolve();
    expect(broken).toHaveBeenCalledTimes(3);
  });

  it('生成 Promise 正常结束也只报告 resolved，不宣称正文完成', async () => {
    const report = vi.fn();
    h.generate.mockImplementationOnce(() => Promise.resolve());
    expect(triggerHostGenerate_ACU('normal', report)).toBe(true);
    await Promise.resolve();
    expect(report.mock.calls.map(([event]) => event.stage)).toEqual(['calling', 'dispatched', 'resolved']);

    // 无诊断调用保持原契约，不读取或消费宿主返回的 thenable。
    const then = vi.fn();
    h.generate.mockImplementationOnce(() => ({ then }));
    expect(triggerHostGenerate_ACU('normal')).toBe(true);
    await Promise.resolve();
    expect(then).not.toHaveBeenCalled();
  });
});
});
