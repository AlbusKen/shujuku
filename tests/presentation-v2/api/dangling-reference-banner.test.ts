/**
 * DanglingReferenceBanner — 失效引用标记与一键清除
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';

const { mockCollectApi, mockCollectWorldbook, mockClear } = vi.hoisted(() => ({
  mockCollectApi: vi.fn(() => [] as any[]),
  mockCollectWorldbook: vi.fn(async () => [] as any[]),
  mockClear: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../../src/service/settings/dangling-reference-audit-service', () => ({
  collectDanglingApiPresetReferences_ACU: mockCollectApi,
  collectDanglingWorldbookReferences_ACU: mockCollectWorldbook,
  clearDanglingReference_ACU: mockClear,
}));

import DanglingReferenceBanner from '../../../src/presentation-v2/components/DanglingReferenceBanner.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

async function mountBanner(scope: 'api' | 'worldbook'): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(DanglingReferenceBanner, { scope });
  app.mount(el);
  apps.push({ app, el });
  await nextTick();
  await Promise.resolve();
  await nextTick();
  return el;
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectApi.mockReturnValue([]);
  mockCollectWorldbook.mockResolvedValue([]);
  mockClear.mockResolvedValue({ ok: true });
});

describe('DanglingReferenceBanner', () => {
  it('无失效引用时不渲染提示', async () => {
    const el = await mountBanner('api');
    expect(el.querySelector('.acu-message')).toBeNull();
    expect(el.textContent || '').not.toContain('已不存在');
  });

  it('API 范围展示预设失效项，点击清除后走显式 clear 并刷新', async () => {
    const item = {
      id: 'table',
      kind: 'api_preset' as const,
      label: '填表 API 预设',
      name: 'ghost',
      clearKey: 'table',
    };
    mockCollectApi.mockReturnValueOnce([item]).mockReturnValueOnce([]);
    const el = await mountBanner('api');
    expect(el.textContent).toContain('API 预设');
    expect(el.textContent).toContain('填表 API 预设「ghost」已不存在');
    expect(el.textContent).toContain('不会自动改写已保存的设置');

    const button = Array.from(el.querySelectorAll('button')).find(btn => btn.textContent?.includes('清除引用'));
    expect(button).toBeTruthy();
    button!.click();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(mockClear).toHaveBeenCalledWith(item);
    expect(mockCollectApi).toHaveBeenCalledTimes(2);
    expect(el.textContent || '').not.toContain('ghost');
  });

  it('世界书范围使用世界书文案并调用异步收集', async () => {
    mockCollectWorldbook.mockResolvedValue([{
      id: 'injection-target',
      kind: 'worldbook',
      label: '填表写入目标世界书',
      name: '失踪书',
      clearKey: 'worldbook_injection',
    }]);
    const el = await mountBanner('worldbook');
    expect(mockCollectWorldbook).toHaveBeenCalled();
    expect(mockCollectApi).not.toHaveBeenCalled();
    expect(el.textContent).toContain('世界书');
    expect(el.textContent).toContain('填表写入目标世界书「失踪书」已不存在');
  });
});
