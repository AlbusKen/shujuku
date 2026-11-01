// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldActor_ACU } from '../../src/service/simulation/model';

const topLevelWindowMock_ACU = vi.hoisted(() => ({
  document: null as unknown as Document,
  innerWidth: 1280,
} as Window & typeof globalThis));

const wrongEnvWindowMock_ACU = vi.hoisted(() => ({
  document: null as unknown as Document,
  innerWidth: 390,
} as Window & typeof globalThis));

vi.mock('../../src/shared/constants', () => ({ SCRIPT_ID_PREFIX_ACU: 'acu-test' }));
vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: wrongEnvWindowMock_ACU }));
vi.mock('../../src/presentation-v2/bootstrap/host-document', () => ({
  getAcuHostDocument: vi.fn(() => topLevelWindowMock_ACU.document),
  getAcuHostWindow: vi.fn(() => topLevelWindowMock_ACU),
}));

import { getAcuHostDocument } from '../../src/presentation-v2/bootstrap/host-document';
import { confirmWorldActorRegistration_ACU } from '../../src/presentation/theme/confirm-actor-registration';
import { THEME_DEFAULT_LIGHT } from '../../src/presentation-v2/theme/builtin-themes';

const actor = {
  name: '<img src=x onerror=alert(1)>',
  location: '<script>private</script>',
  currentAction: { text: '正在巡查', expectedDuration: '今日', startedAtDay: null, startedAt: '' },
  resources: ['不能泄露的资源'],
  knownFacts: ['不能泄露的事实'],
} as WorldActor_ACU;

describe('新增人物谱角色确认', () => {
  beforeEach(() => {
    const doc = document.implementation.createHTMLDocument('host');
    Object.defineProperty(doc, 'defaultView', { value: topLevelWindowMock_ACU, configurable: true });
    topLevelWindowMock_ACU.document = doc;
    topLevelWindowMock_ACU.innerWidth = 1280;
    wrongEnvWindowMock_ACU.document = document.implementation.createHTMLDocument('wrong-iframe');
    vi.mocked(getAcuHostDocument).mockClear();
  });

  it('无需挂载面板即在主文档显示安全摘要，允许同意', async () => {
    const promise = confirmWorldActorRegistration_ACU(actor, new AbortController().signal);
    const doc = topLevelWindowMock_ACU.document;
    const dialog = doc.getElementById('acu-test-custom-confirm') as HTMLElement;
    expect(getAcuHostDocument).toHaveBeenCalled();
    expect(dialog).not.toBeNull();
    expect(doc.getElementById('acu-test-custom-confirm-overlay')?.parentElement).toBe(doc.body);
    expect(wrongEnvWindowMock_ACU.document.getElementById('acu-test-custom-confirm')).toBeNull();
    expect(document.getElementById('acu-test-custom-confirm')).toBeNull();
    expect(dialog.textContent).toContain('新增人物谱角色');
    expect(dialog.textContent).toContain(actor.name);
    expect(dialog.textContent).toContain(actor.location);
    expect(dialog.textContent).toContain('正在巡查');
    expect(dialog.textContent).not.toContain('不能泄露');
    expect(dialog.querySelector('img, script')).toBeNull();
    const overlay = doc.getElementById('acu-test-custom-confirm-overlay') as HTMLDialogElement;
    expect(overlay.classList.contains('acu-custom-confirm-overlay--actor-registration-light')).toBe(true);
    expect(overlay.style.getPropertyValue('--acu-confirm-bg').trim()).toBe(THEME_DEFAULT_LIGHT.tokens.bg1);
    expect(overlay.style.getPropertyValue('--acu-confirm-border').trim()).toBe(THEME_DEFAULT_LIGHT.tokens.border2);
    expect(overlay.style.getPropertyValue('--acu-confirm-ok-bg').trim()).toBe(THEME_DEFAULT_LIGHT.tokens.bg2);
    expect(overlay.style.getPropertyValue('--acu-confirm-ok-text').trim()).toBe(THEME_DEFAULT_LIGHT.tokens.text1);
    expect(overlay.style.getPropertyValue('--acu-confirm-ok-hover-bg').trim()).toBe(THEME_DEFAULT_LIGHT.tokens.sidebarBg);
    expect(overlay.style.getPropertyValue('--acu-confirm-ok-hover-border').trim()).toBe(THEME_DEFAULT_LIGHT.tokens.text3);
    expect(doc.getElementById('acu-test-custom-confirm-ok')?.textContent).toBe('同意新增');
    expect(doc.getElementById('acu-test-custom-confirm-cancel')?.textContent).toBe('不新增');
    (doc.getElementById('acu-test-custom-confirm-ok') as HTMLButtonElement).click();
    await expect(promise).resolves.toBe(true);
  });

  it('拒绝新增并适配 390 像素窗口', async () => {
    topLevelWindowMock_ACU.innerWidth = 390;
    const promise = confirmWorldActorRegistration_ACU(actor, new AbortController().signal);
    const doc = topLevelWindowMock_ACU.document;
    const dialog = doc.getElementById('acu-test-custom-confirm') as HTMLElement;
    expect(dialog.getAttribute('style')).toContain('width: min(420px, calc(100vw - 24px))');
    expect((doc.getElementById('acu-test-custom-confirm-ok') as HTMLElement).style.width).toBe('100%');
    (doc.getElementById('acu-test-custom-confirm-cancel') as HTMLButtonElement).click();
    await expect(promise).resolves.toBe(false);
  });

  it('运行被取消时关闭提示，不会自动同意', async () => {
    const controller = new AbortController();
    const promise = confirmWorldActorRegistration_ACU(actor, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBe(false);
    expect(topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-overlay')).toBeNull();
  });
});
