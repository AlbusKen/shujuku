// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const topLevelWindowMock_ACU = vi.hoisted(() => {
  return {
    document: null as unknown as Document,
    innerWidth: 1280,
  } as Window & typeof globalThis;
});

vi.mock('../../src/shared/constants', () => ({
  SCRIPT_ID_PREFIX_ACU: 'acu-test',
}));

const wrongEnvWindowMock_ACU = vi.hoisted(() => ({
  document: null as unknown as Document,
  innerWidth: 390,
} as Window & typeof globalThis));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: wrongEnvWindowMock_ACU,
}));

vi.mock('../../src/presentation-v2/bootstrap/host-document', () => ({
  getAcuHostDocument: vi.fn(() => topLevelWindowMock_ACU.document),
  getAcuHostWindow: vi.fn(() => topLevelWindowMock_ACU),
}));

import { getAcuHostDocument, getAcuHostWindow } from '../../src/presentation-v2/bootstrap/host-document';
import { showCustomConfirm_ACU } from '../../src/presentation/theme/custom-confirm';

describe('custom confirm', () => {
  beforeEach(() => {
    const doc = document.implementation.createHTMLDocument('acu-confirm-test');
    Object.defineProperty(doc, 'defaultView', { value: topLevelWindowMock_ACU, configurable: true });
    topLevelWindowMock_ACU.document = doc;
    topLevelWindowMock_ACU.document.body.innerHTML = '';
    topLevelWindowMock_ACU.innerWidth = 1280;
    wrongEnvWindowMock_ACU.document = document.implementation.createHTMLDocument('wrong-iframe');
    vi.mocked(getAcuHostDocument).mockClear();
    vi.mocked(getAcuHostWindow).mockClear();
  });

  it('通用确认框不继承人物登记专属浅色配色', async () => {
    const doc = topLevelWindowMock_ACU.document;
    const pending = showCustomConfirm_ACU('普通确认', '保持既有主题');
    const overlay = doc.getElementById('acu-test-custom-confirm-overlay') as HTMLElement;
    expect(overlay.classList.contains('acu-custom-confirm-overlay--actor-registration-light')).toBe(false);
    expect(overlay.style.getPropertyValue('--acu-confirm-bg')).toBe('');
    expect(overlay.style.getPropertyValue('--acu-confirm-ok-bg')).toBe('');
    expect(doc.getElementById('acu-test-custom-confirm-ok')?.getAttribute('style')).toContain('var(--acu-confirm-ok-bg, rgba(37, 99, 235, 0.08))');
    (doc.getElementById('acu-test-custom-confirm-cancel') as HTMLButtonElement).click();
    await expect(pending).resolves.toBe(false);
  });

  it('通过showModal进入浏览器顶层，而不是仅提高普通遮罩层级', async () => {
    const doc = topLevelWindowMock_ACU.document;
    const prototype = HTMLDialogElement.prototype;
    const previousShow = Object.getOwnPropertyDescriptor(prototype, 'showModal');
    const previousClose = Object.getOwnPropertyDescriptor(prototype, 'close');
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
    Object.defineProperty(prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(prototype, 'close', { configurable: true, value: close });
    try {
      const pending = showCustomConfirm_ACU('确认', '高层iframe不能遮挡');
      const overlay = doc.getElementById('acu-test-custom-confirm-overlay') as HTMLDialogElement;
      expect(overlay.tagName).toBe('DIALOG');
      expect(showModal).toHaveBeenCalledOnce();
      expect(overlay.open).toBe(true);
      overlay.dispatchEvent(new Event('cancel', { cancelable: true }));
      await expect(pending).resolves.toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(overlay.isConnected).toBe(false);
    } finally {
      if (previousShow) Object.defineProperty(prototype, 'showModal', previousShow); else Reflect.deleteProperty(prototype, 'showModal');
      if (previousClose) Object.defineProperty(prototype, 'close', previousClose); else Reflect.deleteProperty(prototype, 'close');
    }
  });

  it('浏览器直接关闭dialog时结束等待，显示失败时抛错而不伪装用户拒绝', async () => {
    const doc = topLevelWindowMock_ACU.document;
    const closed = showCustomConfirm_ACU('确认', '外部关闭');
    doc.getElementById('acu-test-custom-confirm-overlay')!.dispatchEvent(new Event('close'));
    await expect(closed).resolves.toBe(false);
    const prototype = HTMLDialogElement.prototype;
    const previousShow = Object.getOwnPropertyDescriptor(prototype, 'showModal');
    Object.defineProperty(prototype, 'showModal', { configurable: true, value: () => { throw new Error('MODAL_SHOW_FAILED'); } });
    try {
      await expect(showCustomConfirm_ACU('确认', '失败')).rejects.toThrow('MODAL_SHOW_FAILED');
      expect(doc.getElementById('acu-test-custom-confirm-overlay')).toBeNull();
    } finally {
      if (previousShow) Object.defineProperty(prototype, 'showModal', previousShow); else Reflect.deleteProperty(prototype, 'showModal');
    }
  });

  it('无既有遮罩 CSS 时仍在 resolver 的 host body 挂载可见固定遮罩，不误挂旧 env iframe', async () => {
    const promise = showCustomConfirm_ACU('确认', '宿主页面');
    const hostDoc = topLevelWindowMock_ACU.document;
    const overlay = hostDoc.getElementById('acu-test-custom-confirm-overlay') as HTMLElement;

    expect(getAcuHostDocument).toHaveBeenCalled();
    expect(overlay.parentElement).toBe(hostDoc.body);
    expect(wrongEnvWindowMock_ACU.document.getElementById(overlay.id)).toBeNull();
    expect(document.getElementById(overlay.id)).toBeNull();
    expect(overlay.classList.contains('acu-custom-confirm-overlay')).toBe(true);
    expect(overlay.style.position).toBe('fixed');
    expect(overlay.style.inset).toBe('0px');
    expect(overlay.style.display).toBe('block');
    expect(overlay.style.opacity).toBe('1');
    expect(overlay.style.visibility).toBe('visible');
    expect(overlay.style.pointerEvents).toBe('auto');
    expect(overlay.getAttribute('style')).toContain('background: var(--acu-overlay-bg, rgba(0, 0, 0, 0.24))');
    expect(overlay.style.zIndex).toBe('2147483000');

    (hostDoc.getElementById('acu-test-custom-confirm-cancel') as HTMLButtonElement).click();
    await expect(promise).resolves.toBe(false);
  });

  it('host document 无 defaultView 时使用 host-window resolver 而不是旧 env 判断宽度', async () => {
    Object.defineProperty(topLevelWindowMock_ACU.document, 'defaultView', { value: null, configurable: true });
    topLevelWindowMock_ACU.innerWidth = 768;
    const promise = showCustomConfirm_ACU('确认', '宿主宽度');
    const dialog = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm') as HTMLElement;

    expect(getAcuHostWindow).toHaveBeenCalled();
    expect(dialog.getAttribute('style') || '').toContain('12svh');
    (topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok') as HTMLButtonElement).click();
    await expect(promise).resolves.toBe(true);
  });

  it('窄屏模式下确认框会下移并限制高度，按钮纵向堆叠', () => {
    topLevelWindowMock_ACU.innerWidth = 768;

    void showCustomConfirm_ACU('手动填表确认', '第一行\n第二行');

    const dialog = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm') as HTMLElement;
    const buttons = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok')?.parentElement as HTMLElement;
    const message = buttons.previousElementSibling as HTMLElement;

    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('style') || '').toContain('top: max(calc(env(safe-area-inset-top, 0px) + 72px), 12svh)');
    expect(dialog.getAttribute('style') || '').toContain('transform: translate(-50%, 0)');
    expect(dialog.getAttribute('style') || '').toContain('max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 88px)');
    expect(message.getAttribute('style') || '').toContain('overflow-y: auto');
    expect(buttons.getAttribute('style') || '').toContain('flex-direction: column-reverse');
    expect((topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok') as HTMLElement).getAttribute('style') || '').toContain('width: 100%');
  });

  it('桌面模式下确认框保持居中布局与横向按钮', () => {
    topLevelWindowMock_ACU.innerWidth = 1280;

    void showCustomConfirm_ACU('删除确认', '保持桌面模式');

    const dialog = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm') as HTMLElement;
    const buttons = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok')?.parentElement as HTMLElement;

    expect(dialog.getAttribute('style') || '').toContain('top: 50%');
    expect(dialog.getAttribute('style') || '').toContain('transform: translate(-50%, -50%)');
    expect(dialog.getAttribute('style') || '').toContain('max-height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 40px)');
    expect(buttons.getAttribute('style') || '').toContain('justify-content: flex-end');
    expect(buttons.getAttribute('style') || '').toContain('flex-direction: row');
    expect((topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok') as HTMLElement).getAttribute('style') || '').toContain('width: auto');
  });

  it('点击确认后会 resolve true 并清理 DOM', async () => {
    const promise = showCustomConfirm_ACU('确认', '继续执行');

    (topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok') as HTMLButtonElement).click();

    await expect(promise).resolves.toBe(true);
    expect(topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-overlay')).toBeNull();
  });

  it('取消按钮、遮罩和 Escape 都会拒绝', async () => {
    const doc = topLevelWindowMock_ACU.document;
    const cancel = showCustomConfirm_ACU('确认', '取消');
    (doc.getElementById('acu-test-custom-confirm-cancel') as HTMLButtonElement).click();
    await expect(cancel).resolves.toBe(false);

    const overlay = showCustomConfirm_ACU('确认', '遮罩');
    (doc.getElementById('acu-test-custom-confirm-overlay') as HTMLElement).click();
    await expect(overlay).resolves.toBe(false);

    const escape = showCustomConfirm_ACU('确认', '退出');
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(escape).resolves.toBe(false);
    expect(doc.getElementById('acu-test-custom-confirm-overlay')).toBeNull();
  });

  it('已取消的 signal 不插入弹窗；等待期间取消仅移除所属弹窗', async () => {
    const doc = topLevelWindowMock_ACU.document;
    const aborted = new AbortController();
    aborted.abort();
    await expect(showCustomConfirm_ACU('标题', '正文', { signal: aborted.signal })).resolves.toBe(false);
    expect(doc.getElementById('acu-test-custom-confirm-overlay')).toBeNull();

    const controller = new AbortController();
    const pending = showCustomConfirm_ACU('标题', '正文', { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toBe(false);
    expect(doc.getElementById('acu-test-custom-confirm-overlay')).toBeNull();

    const next = showCustomConfirm_ACU('另一个', '不会被前一个 signal 清除');
    controller.abort();
    expect(doc.getElementById('acu-test-custom-confirm-overlay')).not.toBeNull();
    (doc.getElementById('acu-test-custom-confirm-ok') as HTMLButtonElement).click();
    await expect(next).resolves.toBe(true);
  });

  it('新弹窗替换旧弹窗时旧 promise 拒绝，旧 signal 不影响新弹窗', async () => {
    const doc = topLevelWindowMock_ACU.document;
    const controller = new AbortController();
    const old = showCustomConfirm_ACU('旧', '等待中', { signal: controller.signal });
    const next = showCustomConfirm_ACU('新', '继续');
    await expect(old).resolves.toBe(false);
    controller.abort();
    expect(doc.getElementById('acu-test-custom-confirm')?.textContent).toContain('新');
    (doc.getElementById('acu-test-custom-confirm-ok') as HTMLButtonElement).click();
    await expect(next).resolves.toBe(true);
  });
});
