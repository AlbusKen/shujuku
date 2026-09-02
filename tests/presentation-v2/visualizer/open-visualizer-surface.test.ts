/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const STORAGE_KEY = 'acu_v2_ui_state';

function persistAdvancedMode(activePageId = 'dashboard'): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      uiMode: { mode: 'advanced' },
      router: { activePageId },
    }),
  );
}

async function resetMountedApp(): Promise<void> {
  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  mount.__resetAcuV2MountForTests();
}

function setParent(parent: any): void {
  Object.defineProperty(window, 'parent', {
    value: parent,
    writable: true,
    configurable: true,
  });
}

beforeEach(async () => {
  vi.resetModules();
  setParent(window);
  delete (window as any).AutoCardUpdaterV2API;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
  bridge.installAutoCardUpdaterV2Api_ACU();
});

describe('openVisualizerSurface_ACU', () => {
  it('外部调用会打开 v2 shell 并进入 visualizer surface，关闭后隐藏 shell', async () => {
    persistAdvancedMode();
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');

    const result = await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await Promise.resolve();

    expect(result).toBe(true);
    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('[data-acu-visualizer-surface]')).not.toBeNull();
    expect(document.querySelector('[data-acu-visualizer-surface]')?.textContent).toContain('数据库编辑器');
    expect(document.querySelector('[data-acu-visualizer-surface]')?.textContent).not.toContain('无法载入数据库');
    expect(document.querySelector('[data-acu-visualizer-surface]')?.textContent).not.toContain('VZ-4');

    (document.querySelector('.acu-visualizer-surface__close') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('acu-app-v2')?.style.display).toBe('none');
    await resetMountedApp();
  });

  it('v2 已打开时进入 visualizer，关闭后恢复进入前页面', async () => {
    persistAdvancedMode('dashboard');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    await mount.openAcuV2App();
    await Promise.resolve();
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent).toBe('仪表盘');

    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await Promise.resolve();
    expect(document.querySelector('[data-acu-visualizer-surface]')?.textContent).toContain('数据库编辑器');

    (document.querySelector('.acu-visualizer-surface__close') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));

    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent).toBe('仪表盘');
    mount.__resetAcuV2MountForTests();
  });

  it('安装独立 v2 全局接口：未打开时忽略，打开后记录刷新请求', async () => {
    persistAdvancedMode();
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    expect(typeof (window as any).AutoCardUpdaterV2API?.open).toBe('function');
    expect(typeof (window as any).AutoCardUpdaterV2API?.openVisualizer).toBe('function');
    expect(typeof (window as any).AutoCardUpdaterV2API?.refreshVisualizer).toBe('function');

    await (window as any).AutoCardUpdaterV2API.refreshVisualizer();
    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await (window as any).AutoCardUpdaterV2API.refreshVisualizer();
    await Promise.resolve();

    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    expect(useVisualizerStore(pinia!).externalRefreshTick).toBe(1);
    mount.__resetAcuV2MountForTests();
  });

  it('全局 v2 open 接口只打开新 UI shell，不进入数据库编辑器', async () => {
    persistAdvancedMode('api');
    await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');

    const result = await (window as any).AutoCardUpdaterV2API.open();
    await Promise.resolve();

    expect(result).toBe(true);
    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent).toBe('API');
    expect(document.querySelector('[data-acu-visualizer-surface]')).toBeNull();
    await resetMountedApp();
  });

  it('全局 v2 接口会同步挂到宿主 window', async () => {
    const parentDom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    setParent(parentDom.window);
    vi.resetModules();
    try {
      const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
      bridge.installAutoCardUpdaterV2Api_ACU();

      expect(typeof (window as any).AutoCardUpdaterV2API?.open).toBe('function');
      expect(typeof (parentDom.window as any).AutoCardUpdaterV2API?.open).toBe('function');

      const result = await (parentDom.window as any).AutoCardUpdaterV2API.open();
      await Promise.resolve();

      expect(result).toBe(true);
      expect(parentDom.window.document.getElementById('acu-app-v2')?.style.display).toBe('');
      expect(document.getElementById('acu-app-v2')).toBeNull();
      await resetMountedApp();
    } finally {
      parentDom.window.close();
      delete (window as any).AutoCardUpdaterV2API;
      setParent(window);
    }
  });

  it('载入当前数据后可编辑卡片并拦截 dirty 关闭', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名', '状态'], [null, 'A', '平静']],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
    expect(surface.textContent).toContain('角色状态');
    expect(surface.textContent).toContain('1 行 · 2 列');
    const topbarContext = surface.querySelector('.acu-visualizer-surface__topbar-context') as HTMLElement;
    expect(topbarContext.textContent).toContain('当前模板');
    expect(topbarContext.textContent).toContain('当前表');
    expect(topbarContext.textContent).toContain('角色状态');
    expect(topbarContext.textContent).not.toContain('已同步');
    const dataToolbar = surface.querySelector('.acu-visualizer-surface__data-toolbar') as HTMLElement;
    const dataAddButton = dataToolbar.querySelector('button') as HTMLButtonElement;
    const cardGrid = surface.querySelector('.acu-visualizer-surface__card-grid') as HTMLElement;
    expect(dataToolbar.textContent).toContain('新增行');
    expect(dataAddButton.classList.contains('acu-btn--primary')).toBe(true);
    expect(Boolean(cardGrid.compareDocumentPosition(dataToolbar) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(dataToolbar.textContent).not.toContain('角色状态');
    expect(dataToolbar.textContent).not.toContain('卡片视图会直接修改当前编辑草稿');

    const statusPreview = Array.from(surface.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(item => item.textContent?.trim() === '平静')!;
    statusPreview.click();
    await new Promise(r => setTimeout(r, 0));

    const textareas = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea'));
    const statusTextarea = textareas.find(item => item.value === '平静')!;
    statusTextarea.value = '紧张';
    statusTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const pinia = mount.getAcuV2PiniaForBridge();
    const visualizer = useVisualizerStore(pinia!);
    expect(visualizer.dirty).toBe(true);
    expect(visualizer.currentSheet.content[1][2]).toBe('紧张');

    (document.querySelector('.acu-visualizer-surface__close') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(document.body.textContent).toContain('关闭数据库编辑器');
    const cancelButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('取消关闭'));
    expect(cancelButton).not.toBeUndefined();
    cancelButton!.click();
    await Promise.resolve();

    expect(document.getElementById('acu-app-v2')?.style.display).toBe('');
    expect(document.querySelector('[data-acu-visualizer-surface]')).not.toBeNull();
    mount.__resetAcuV2MountForTests();
  });

  it('新增行后保留数据工作区滚动位置', async () => {
    persistAdvancedMode();
    const rows = Array.from({ length: 20 }, (_, index) => [
      null,
      `角色 ${index + 1}`,
      `状态 ${index + 1}`,
    ]);
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '滚动验证',
        orderNo: 0,
        content: [[null, '姓名', '状态'], ...rows],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const workspace = document.querySelector<HTMLElement>('.acu-visualizer-surface__workspace')!;
    workspace.scrollTop = 240;
    workspace.scrollLeft = 12;

    const addButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('新增行'))!;
    addButton.click();
    await new Promise(r => setTimeout(r, 0));

    expect(workspace.scrollTop).toBe(240);
    expect(workspace.scrollLeft).toBe(12);

    const pinia = mount.getAcuV2PiniaForBridge();
    const visualizer = useVisualizerStore(pinia!);
    expect(visualizer.currentSheet.content).toHaveLength(22);
    mount.__resetAcuV2MountForTests();
  });

  it('删除行确认弹层挂到 v2 根节点，确认后才修改草稿', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名'], [null, 'A'], [null, 'B']],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
    const firstDeleteButton = surface.querySelector<HTMLButtonElement>('button[title="删除这一行"]')!;
    firstDeleteButton.click();
    await Promise.resolve();

    let layer = document.querySelector<HTMLElement>('.acu-dialog-layer')!;
    expect(layer).not.toBeNull();
    expect(layer.parentElement?.id).toBe('acu-app-v2');
    expect(surface.contains(layer)).toBe(false);
    expect(layer.textContent).toContain('删除数据行');
    expect(layer.textContent).toContain('确定要删除第 1 行吗？');

    const cancelButton = Array.from(layer.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('取消'))!;
    cancelButton.click();
    await new Promise(r => setTimeout(r, 200));

    const pinia = mount.getAcuV2PiniaForBridge();
    const visualizer = useVisualizerStore(pinia!);
    expect(visualizer.currentSheet.content).toHaveLength(3);

    firstDeleteButton.click();
    await Promise.resolve();
    layer = document.querySelector<HTMLElement>('.acu-dialog-layer')!;
    const confirmButton = Array.from(layer.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('删除这一行'))!;
    confirmButton.click();
    await new Promise(r => setTimeout(r, 0));

    expect(visualizer.currentSheet.content).toEqual([[null, '姓名'], [null, 'B']]);
    mount.__resetAcuV2MountForTests();
  });

  it('数据卡片单元格输入跨布局阈值时保持 textarea 焦点', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名', '状态'], [null, 'A', '平静']],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
    const statusPreview = Array.from(surface.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(item => item.textContent?.trim() === '平静')!;
    statusPreview.click();
    await new Promise(r => setTimeout(r, 0));

    const statusTextarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .find(item => item.value === '平静')!;
    expect(document.activeElement).toBe(statusTextarea);

    statusTextarea.value = '这是一段超过二十四个字符的状态描述，用来触发布局切换';
    statusTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(document.activeElement).toBe(statusTextarea);
    expect(surface.contains(statusTextarea)).toBe(true);
    mount.__resetAcuV2MountForTests();
  });

  it('大表数据区只渲染当前页，单元格点击后才挂载 textarea', async () => {
    persistAdvancedMode();
    const pageSize = 30;
    const totalRows = 120;
    const rows = Array.from({ length: totalRows }, (_, index) => {
      const rowNo = index + 1;
      return [null, `A${rowNo}`, `状态 ${rowNo}`];
    });
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '大表验证',
        orderNo: 0,
        content: [[null, '姓名', '状态'], ...rows],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
    let cards = Array.from(surface.querySelectorAll<HTMLElement>('.acu-visualizer-surface__data-card'));
    expect(cards).toHaveLength(pageSize);
    expect(cards[0].textContent).toContain('#1');
    expect(cards[pageSize - 1].textContent).toContain(`#${pageSize}`);
    expect(surface.querySelectorAll('textarea')).toHaveLength(0);
    expect(surface.textContent).toContain(`第 1-${pageSize} 行 / 共 ${totalRows} 行`);
    expect(surface.textContent).not.toContain('上一页');
    expect(surface.textContent).not.toContain('下一页');

    const secondPageButton = Array.from(surface.querySelectorAll<HTMLButtonElement>('.acu-visualizer-surface__page-button'))
      .find(button => button.textContent?.trim() === '2')!;
    secondPageButton.click();
    await new Promise(r => setTimeout(r, 0));

    cards = Array.from(surface.querySelectorAll<HTMLElement>('.acu-visualizer-surface__data-card'));
    expect(cards).toHaveLength(pageSize);
    expect(cards[0].textContent).toContain(`#${pageSize + 1}`);
    expect(cards[pageSize - 1].textContent).toContain(`#${pageSize * 2}`);
    expect(surface.textContent).toContain(`第 ${pageSize + 1}-${pageSize * 2} 行 / 共 ${totalRows} 行`);
    expect(surface.querySelectorAll('textarea')).toHaveLength(0);

    const jumpInput = surface.querySelector<HTMLInputElement>('.acu-visualizer-surface__page-jump input')!;
    jumpInput.value = '3';
    jumpInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    cards = Array.from(surface.querySelectorAll<HTMLElement>('.acu-visualizer-surface__data-card'));
    expect(cards).toHaveLength(pageSize);
    expect(cards[0].textContent).toContain(`#${pageSize * 2 + 1}`);
    expect(cards[pageSize - 1].textContent).toContain(`#${pageSize * 3}`);
    expect(surface.textContent).toContain(`第 ${pageSize * 2 + 1}-${pageSize * 3} 行 / 共 ${totalRows} 行`);

    jumpInput.value = '2';
    jumpInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const statusPreview = Array.from(surface.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(item => item.textContent?.trim() === '状态 51')!;
    statusPreview.click();
    await new Promise(r => setTimeout(r, 0));

    const statusTextarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .find(item => item.value === '状态 51')!;
    expect(document.activeElement).toBe(statusTextarea);
    statusTextarea.value = '已更新';
    statusTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const pinia = mount.getAcuV2PiniaForBridge();
    const visualizer = useVisualizerStore(pinia!);
    expect(visualizer.currentSheet.content[51][2]).toBe('已更新');
    mount.__resetAcuV2MountForTests();
  });

  it('窄宽度分页只显示当前页相邻一页，保留跳转输入框在同一组', async () => {
    persistAdvancedMode();
    const originalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([
          {
            target,
            contentRect: { width: 390 } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver,
    });

    try {
      const pageSize = 30;
      const totalRows = 1050;
      const lastPage = Math.ceil(totalRows / pageSize);
      const rows = Array.from({ length: totalRows }, (_, index) => {
        const rowNo = index + 1;
        return [null, `A${rowNo}`, `状态 ${rowNo}`];
      });
      const state = await import('../../../src/service/runtime/state-manager');
      state._set_currentJsonTableData_ACU({
        mate: { type: 'chatSheets', version: 1 },
        sheet_a: {
          uid: 'sheet_a',
          name: '窄分页验证',
          orderNo: 0,
          content: [[null, '姓名', '状态'], ...rows],
        },
      });
      const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
      const mount = await import('../../../src/presentation-v2/bootstrap/mount');

      await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
      await new Promise(r => setTimeout(r, 0));

      const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
      const jumpInput = surface.querySelector<HTMLInputElement>('.acu-visualizer-surface__page-jump input')!;
      jumpInput.value = '5';
      jumpInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));

      const buttonLabels = Array.from(surface.querySelectorAll<HTMLButtonElement>('.acu-visualizer-surface__page-button'))
        .map(button => button.textContent?.trim());
      expect(buttonLabels).toEqual(['1', '...', '4', '5', '6', '...', String(lastPage)]);
      expect(jumpInput.value).toBe('5');

      const ellipsisButtons = Array.from(surface.querySelectorAll<HTMLButtonElement>('.acu-visualizer-surface__page-button'))
        .filter(button => button.textContent?.trim() === '...');
      ellipsisButtons[1].click();
      await new Promise(r => setTimeout(r, 0));

      const nextGroupLabels = Array.from(surface.querySelectorAll<HTMLButtonElement>('.acu-visualizer-surface__page-button'))
        .map(button => button.textContent?.trim());
      expect(nextGroupLabels).toEqual(['1', '...', '7', '8', '9', '...', String(lastPage)]);
      expect(jumpInput.value).toBe('8');

      mount.__resetAcuV2MountForTests();
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: originalResizeObserver,
      });
    }
  });

  it('数据卡片按表格字段顺序布局，仅连续两个短字段双列显示', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '布局验证表',
        orderNo: 0,
        content: [[null, '短A', '短B', '长C', '短D', '短E', '短F'], [
          null,
          'A',
          'B',
          'C',
          'D',
          'E',
          'F',
        ], [
          null,
          'AA',
          'BB',
          '这是一段超过二十四个字符的长内容，用来验证整列会独占整行。',
          'DD',
          'EE',
          'FF',
        ]],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const firstCard = document.querySelector<HTMLElement>('.acu-visualizer-surface__data-card')!;
    const fields = Array.from(firstCard.querySelectorAll<HTMLElement>(
      '.acu-visualizer-surface__field[data-acu-visualizer-field-layout]',
    ));
    expect(fields.map(field => field.querySelector('.acu-visualizer-surface__field-label')?.textContent?.trim()))
      .toEqual(['短A', '短B', '长C', '短D', '短E', '短F']);
    expect(fields.map(field => field.dataset.acuVisualizerFieldLayout))
      .toEqual(['half', 'half', 'wide', 'half', 'half', 'wide']);
    expect(Array.from(firstCard.querySelectorAll<HTMLElement>('[data-acu-visualizer-field-row-layout]'))
      .map(row => row.dataset.acuVisualizerFieldRowLayout))
      .toEqual(['half', 'wide', 'half', 'wide']);
    mount.__resetAcuV2MountForTests();
  });

  it('字段预览在 pointerdown 阶段保持不变，click 后才切换为聚焦的编辑框', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '编辑验证表',
        orderNo: 0,
        content: [[null, '姓名', '状态'], [null, '甲', '正常']],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
    const preview = Array.from(surface.querySelectorAll<HTMLElement>('.acu-visualizer-surface__field-preview'))
      .find(item => item.textContent?.trim() === '正常')!;

    // 浏览器会在 pointerdown 之后向同一目标派发 mousedown；若此时预览节点已被替换，
    // 默认焦点处理会清空焦点导致编辑框立即 blur。这里断言 pointerdown 不改动 DOM。
    preview.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(preview.isConnected).toBe(true);
    expect(surface.querySelectorAll('textarea')).toHaveLength(0);

    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    preview.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);

    preview.click();
    await new Promise(r => setTimeout(r, 0));

    const textarea = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('正常');
    expect(document.activeElement).toBe(textarea);

    // 编辑框自身的 focus 事件会再次进入 startDataCellEditing，不能把编辑框重建掉
    textarea.dispatchEvent(new FocusEvent('focus'));
    await new Promise(r => setTimeout(r, 0));
    expect(surface.querySelector('textarea')).toBe(textarea);
    expect(document.activeElement).toBe(textarea);

    textarea.value = '受伤';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    const visualizer = useVisualizerStore(mount.getAcuV2PiniaForBridge()!);
    expect(visualizer.currentSheet.content[1][2]).toBe('受伤');

    textarea.dispatchEvent(new FocusEvent('blur'));
    await new Promise(r => setTimeout(r, 0));
    expect(surface.querySelectorAll('textarea')).toHaveLength(0);
    expect(surface.textContent).toContain('受伤');
    mount.__resetAcuV2MountForTests();
  });

  it('可进入结构参数和数据库管理面板', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名', '状态'], [null, 'A', '平静']],
        sourceData: { note: '角色状态说明' },
        updateConfig: {},
        exportConfig: {},
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const configTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('结构/参数'));
    expect(configTab).not.toBeUndefined();
    configTab!.click();
    await Promise.resolve();

    const configPanel = document.querySelector('[data-acu-visualizer-config]') as HTMLElement;
    expect(configPanel?.textContent).toContain('自动化更新参数');
    expect(configPanel?.textContent).toContain('世界书注入配置');
    expect(configPanel?.textContent).toContain('启用独立导出');
    expect(configPanel?.textContent).not.toContain('条目名称');
    expect(configPanel?.textContent).not.toContain('主条目位置');

    const updateDepthInput = Array.from(configPanel.querySelectorAll<HTMLInputElement>('input[type="number"]'))[0];
    updateDepthInput.value = '9';
    updateDepthInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();

    const enableCustomExportButton = Array.from(configPanel.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'))
      .find(button => button.textContent?.includes('启用独立导出'));
    expect(enableCustomExportButton).not.toBeUndefined();
    enableCustomExportButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(configPanel?.textContent).toContain('条目名称');
    expect(configPanel?.textContent).toContain('条目类型');
    expect(configPanel?.textContent).toContain('主条目位置');

    const mainPlacement = Array.from(configPanel.querySelectorAll<HTMLElement>('.acu-viz-placement'))
      .find(item => item.textContent?.includes('主条目位置'))!;
    const [depthInput, orderInput] = Array.from(mainPlacement.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(depthInput.outerHTML).toContain('class="acu-input');
    depthInput.value = '7';
    depthInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    orderInput.value = '12345';
    orderInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const pinia = mount.getAcuV2PiniaForBridge();
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const visualizer = useVisualizerStore(pinia!);
    expect(visualizer.currentSheet.updateConfig.contextDepth).toBe(9);
    const placementAfterNumberInput = visualizer.currentSheet.exportConfig.entryPlacement;

    const addColumnButton = Array.from(configPanel.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('新增列'));
    expect(addColumnButton).not.toBeUndefined();
    expect(addColumnButton!.classList.contains('acu-btn--primary')).toBe(true);

    const firstHeaderInput = configPanel.querySelector<HTMLInputElement>('.acu-viz-config__column-row input')!;
    firstHeaderInput.focus();
    expect(document.activeElement).toBe(firstHeaderInput);
    firstHeaderInput.value = '姓';
    firstHeaderInput.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(visualizer.currentSheet.content[0][1]).toBe('姓');
    expect(placementAfterNumberInput).toEqual({
      position: 'at_depth_as_system',
      depth: 7,
      order: 12345,
    });
    expect(document.activeElement).toBe(firstHeaderInput);
    expect(configPanel.querySelector<HTMLInputElement>('.acu-viz-config__column-row input')).toBe(firstHeaderInput);

    const databaseManagementButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('数据库管理'));
    expect(databaseManagementButton).not.toBeUndefined();
    databaseManagementButton!.click();
    await Promise.resolve();

    expect(document.querySelector('[data-acu-visualizer-global]')?.textContent).toContain('可读数据条目位置');
    expect(document.querySelector('[data-acu-visualizer-global]')?.textContent)
      .not.toContain('保存到当前聊天会同步这份全局草稿');
    expect(document.querySelector('[data-acu-visualizer-table-management]')?.textContent).toContain('角色状态');
    expect(document.querySelector('[data-acu-visualizer-table-management]')?.textContent).toContain('新增表格');
    const addTableButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-acu-visualizer-table-management] button'))
      .find(button => button.textContent?.includes('新增表格'));
    expect(addTableButton).not.toBeUndefined();
    expect(addTableButton!.classList.contains('acu-btn--primary')).toBe(true);
    expect(document.querySelector('.acu-visualizer-surface__mode-tabs')).toBeNull();
    mount.__resetAcuV2MountForTests();
  });

  it('移动端数据库导航使用侧抽屉选择表并自动收起', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名'], [null, 'A']],
      },
      sheet_b: {
        uid: 'sheet_b',
        name: '事件记录',
        orderNo: 1,
        content: [[null, '事件'], [null, '初遇']],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const menuButton = document.querySelector<HTMLButtonElement>('.acu-visualizer-surface__mobile-menu');
    expect(menuButton).not.toBeNull();
    menuButton!.click();
    await Promise.resolve();

    const layer = document.querySelector<HTMLElement>('.acu-visualizer-surface__mobile-nav-layer');
    expect(layer).not.toBeNull();
    const drawer = layer!.querySelector<HTMLElement>('.acu-visualizer-surface__mobile-nav');
    expect(drawer).not.toBeNull();
    expect(drawer!.getAttribute('data-acu-mobile-nav-width')).toBe('360px');
    expect(drawer!.style.width).toBe('360px');
    expect(drawer!.style.maxWidth).toBe('calc(100% - 24px)');
    expect(drawer!.style.flex).toBe('0 0 360px');
    const sheetButton = Array.from(layer!.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('事件记录'));
    expect(sheetButton).not.toBeUndefined();
    sheetButton!.click();
    await Promise.resolve();

    const pinia = mount.getAcuV2PiniaForBridge();
    expect(useVisualizerStore(pinia!).currentSheetKey).toBe('sheet_b');
    expect(document.querySelector('.acu-visualizer-surface__mobile-nav-layer')?.classList.contains('is-closing')).toBe(true);
    await new Promise(r => setTimeout(r, 170));
    expect(document.querySelector('.acu-visualizer-surface__mobile-nav-layer')).toBeNull();
    mount.__resetAcuV2MountForTests();
  });

  it('可进入 AI 助手面板且不展示额外常驻提示', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名', '状态'], [null, 'A', '平静']],
        sourceData: { note: '角色状态说明' },
        updateConfig: {},
        exportConfig: {},
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const assistantTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('AI 助手'));
    expect(assistantTab).not.toBeUndefined();
    assistantTab!.click();
    await Promise.resolve();

    const panel = document.querySelector('[data-acu-visualizer-assistant]');
    expect(panel?.textContent).toContain('AI 改表助手');
    expect(panel?.textContent).not.toContain('当前锚点表：角色状态 (sheet_a)');
    expect(panel?.textContent).not.toContain('确认前不会应用到编辑器草稿');
    mount.__resetAcuV2MountForTests();
  });

  it('编码索引自动编号以可配置开关展示，但不禁用手动输入框', async () => {
    persistAdvancedMode();
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        uid: 'sheet_summary',
        name: '总结表',
        orderNo: 0,
        content: [[null, '事件', '编码索引'], [null, '初遇', 'AM0001']],
        sourceData: { note: '总结表说明' },
        updateConfig: {},
        exportConfig: {},
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));

    const surface = document.querySelector('[data-acu-visualizer-surface]') as HTMLElement;
    expect(surface.textContent).toContain('自动编号');
    const indexPreview = Array.from(surface.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(item => item.textContent?.trim() === 'AM0001')!;
    indexPreview.click();
    await new Promise(r => setTimeout(r, 0));

    const indexTextarea = Array.from(surface.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .find(item => item.value === 'AM0001');
    expect(indexTextarea?.disabled).toBe(false);

    const configTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('结构/参数'));
    configTab!.click();
    await Promise.resolve();

    const autoNumberSwitch = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'))
      .find(button => button.textContent?.includes('保存和 AI 更新时自动重排编码'));
    expect(autoNumberSwitch?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-acu-visualizer-config]')?.textContent).not.toContain('启用编码索引列特殊锁定');
    mount.__resetAcuV2MountForTests();
  });

  it('切换表格时会把当前导航项滚入可见区域', async () => {
    persistAdvancedMode();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const state = await import('../../../src/service/runtime/state-manager');
    state._set_currentJsonTableData_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '角色状态',
        orderNo: 0,
        content: [[null, '姓名'], [null, 'A']],
      },
      sheet_b: {
        uid: 'sheet_b',
        name: '事件记录',
        orderNo: 1,
        content: [[null, '事项'], [null, '旧值']],
      },
    });
    const bridge = await import('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface');
    const mount = await import('../../../src/presentation-v2/bootstrap/mount');

    await bridge.openVisualizerSurface_ACU({ source: 'external-api' });
    await new Promise(r => setTimeout(r, 0));
    scrollIntoView.mockClear();

    const sheetButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('事件记录'));
    expect(sheetButton).not.toBeUndefined();
    sheetButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
    mount.__resetAcuV2MountForTests();
  });

  it('VZ-5 响应式布局有桌面、平板、手机三档和 AI 非常驻结构', () => {
    const surfaceSource = readFileSync(
      join(process.cwd(), 'src/presentation-v2/surfaces/visualizer/VisualizerSurface.vue'),
      'utf8',
    );
    const assistantSource = readFileSync(
      join(process.cwd(), 'src/presentation-v2/surfaces/visualizer/VisualizerAssistantPanel.vue'),
      'utf8',
    );
    const configSource = readFileSync(
      join(process.cwd(), 'src/presentation-v2/surfaces/visualizer/VisualizerConfigPanels.vue'),
      'utf8',
    );
    const tableManagementSource = readFileSync(
      join(process.cwd(), 'src/presentation-v2/surfaces/visualizer/VisualizerTableManagementPanel.vue'),
      'utf8',
    );

    expect(surfaceSource).toContain('@media (max-width: 1024px)');
    expect(surfaceSource).toContain('@media (max-width: 767px)');
    expect(surfaceSource).toContain('@media (max-width: 480px)');
    expect(surfaceSource).toContain('acu-visualizer-surface__topbar-context');
    expect(surfaceSource).toContain('当前模板');
    expect(surfaceSource).not.toContain('>已同步</AcuBadge>');
    expect(surfaceSource).not.toContain('acu-visualizer-surface__mobile-current-sheet');
    expect(surfaceSource).toMatch(
      /\.acu-visualizer-surface__context-items\s*\{[\s\S]*?justify-content: flex-start;[\s\S]*?gap: 16px;/,
    );
    expect(surfaceSource).toMatch(
      /\.acu-visualizer-surface__context-item:first-child\s*\{[\s\S]*?flex: 0 1 auto;[\s\S]*?max-width: min\(560px, 42vw\);/,
    );
    expect(surfaceSource).toMatch(
      /\.acu-visualizer-surface__context-item:first-child strong\s*\{[\s\S]*?white-space: normal;[\s\S]*?word-break: break-word;/,
    );
    expect(surfaceSource).toContain('acu-visualizer-surface__mobile-nav-layer');
    expect(surfaceSource).toContain('visualizer-mobile-nav-drawer-in');
    expect(surfaceSource).not.toContain('acu-visualizer-surface__mobile-sheet');
    expect(surfaceSource).toContain('grid-template-columns: 1fr');
    expect(surfaceSource).toContain('table-management');
    expect(surfaceSource).toContain('grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr))');
    expect(surfaceSource).toContain('acu-visualizer-surface__footer-actions :deep(.acu-btn)');
    expect(assistantSource).toContain('AcuDisclosureGroup');
    expect(assistantSource).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.acu-viz-assistant__composer[\s\S]*flex-direction: column;[\s\S]*justify-content: flex-end;/,
    );
    expect(assistantSource).toMatch(
      /\.acu-viz-assistant__composer\s*\{[\s\S]*?border-top: 1px solid var\(--acu-border\);[\s\S]*?background: var\(--acu-bg-1\);/,
    );
    expect(assistantSource).toContain('@media (max-width: 480px)');
    expect(configSource).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.acu-viz-config__column-operation :deep\(\.acu-btn\)[\s\S]*width: 100%;/,
    );
    expect(tableManagementSource).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.acu-viz-table-management__operation :deep\(\.acu-btn\)[\s\S]*width: 100%;/,
    );
  });

  it('结构参数区的 AI 触发提示词和 DDL 输入框启用无最大高度自适应', () => {
    const configSource = readFileSync(
      join(process.cwd(), 'src/presentation-v2/surfaces/visualizer/VisualizerConfigPanels.vue'),
      'utf8',
    );

    const promptPanel = configSource.slice(
      configSource.indexOf('title="AI 触发提示词"'),
      configSource.indexOf('title="DDL 定义"'),
    );
    const ddlPanel = configSource.slice(
      configSource.indexOf('title="DDL 定义"'),
      configSource.indexOf('title="世界书注入配置"'),
    );

    expect((promptPanel.match(/auto-resize/g) || []).length).toBe(5);
    expect((promptPanel.match(/max-rows/g) || []).length).toBe(0);
    expect((ddlPanel.match(/auto-resize/g) || []).length).toBe(1);
    expect((ddlPanel.match(/max-rows/g) || []).length).toBe(0);
  });
});
