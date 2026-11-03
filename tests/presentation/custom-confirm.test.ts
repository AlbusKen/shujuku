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

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: topLevelWindowMock_ACU,
}));

import { showCustomConfirm_ACU } from '../../src/presentation/theme/custom-confirm';

describe('custom confirm', () => {
  beforeEach(() => {
    const doc = document.implementation.createHTMLDocument('acu-confirm-test');
    Object.defineProperty(doc, 'defaultView', { value: topLevelWindowMock_ACU, configurable: true });
    topLevelWindowMock_ACU.document = doc;
    topLevelWindowMock_ACU.document.body.innerHTML = '';
    topLevelWindowMock_ACU.innerWidth = 1280;
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
});
