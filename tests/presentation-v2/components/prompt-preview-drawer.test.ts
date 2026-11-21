/**
 * PromptPreviewDrawer 组件测试
 *
 * 只读预览抽屉的纯展示行为：
 * - 填表模式：管线三分段控件、meta（管线/存储模式/预设/目标表/合计 tokens）、
 *   分段列表（role/content/tokens）、可折叠"请求体预览（已脱敏）"。
 * - 剧情模式：模拟用户输入 + 生成按钮、按任务独立分组（不硬编码类型名）、
 *   truncatedToFirstStage 的黄色截断提示。
 * - loading / error（结构化 message+detail）状态。
 *
 * 组件只做 props/emits 展示，不依赖 service 层实现，可在服务层落地前独立运行。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import PromptPreviewDrawer from '../../../src/presentation-v2/components/PromptPreviewDrawer.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountDrawer(props: Record<string, unknown>): {
  el: HTMLElement;
  emitted: Array<{ event: string; args: unknown[] }>;
} {
  const emitted: Array<{ event: string; args: unknown[] }> = [];
  const wrapper = defineComponent({
    setup() {
      return () =>
        h(PromptPreviewDrawer as any, {
          ...props,
          onClose: () => emitted.push({ event: 'close', args: [] }),
          'onUpdate:scenario': (value: string) =>
            emitted.push({ event: 'update:scenario', args: [value] }),
          'onUpdate:plotVirtualInput': (value: string) =>
            emitted.push({ event: 'update:plotVirtualInput', args: [value] }),
          onGeneratePlot: () => emitted.push({ event: 'generate-plot', args: [] }),
        });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return { el, emitted };
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

const TABLE_FILL_PREVIEW = {
  segments: [
    { role: 'system', content: '你是数据库填表助手', tokens: 120 },
    { role: 'user', content: '人物卡当前内容如下…', tokens: 340 },
  ],
  requestBody: {
    model: 'mock-model',
    temperature: 0.2,
    messages: [{ role: 'system', content: '[已脱敏]系统段' }],
  },
  totalTokens: 460,
  meta: {
    fillMode: '增量更新',
    scenario: 'auto',
    storageMode: 'json',
    updateMode: 'merge',
    targetSheetKeys: ['人物卡', '事件表'],
    presetName: '默认预设',
  },
};

function makePlotPreview(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [
      {
        taskId: 'task-main',
        taskName: '主线推进',
        stage: 1,
        presetName: '剧情预设A',
        segments: [{ role: 'system', content: '主线系统段', tokens: 50 }],
        totalTokens: 50,
      },
      {
        taskId: 'task-memory',
        taskName: '回忆补全',
        stage: 2,
        presetName: '剧情预设B',
        segments: [
          { role: 'user', content: '回忆用户段', tokens: 70 },
          { role: 'assistant', content: '回忆助手段', tokens: 90 },
        ],
        totalTokens: 160,
      },
    ],
    truncatedToFirstStage: true,
    meta: { virtualInput: '你好', hasExistingUserMessage: false as const },
    ...overrides,
  };
}

describe('PromptPreviewDrawer 填表模式', () => {
  it('渲染管线三分段、meta 概要与分段列表', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      scenario: 'auto',
      tableFillPreview: TABLE_FILL_PREVIEW,
    });
    await nextTick();

    // 三个管线 tab，当前 auto 高亮
    const items = Array.from(el.querySelectorAll('.acu-segmented__item'));
    expect(items.map((i) => i.textContent?.trim())).toEqual(['自动填表', '手动重填', '一键追平']);
    expect(el.querySelector('.acu-segmented__item--active')?.textContent?.trim()).toBe('自动填表');

    // meta 概要：管线/存储模式/API 预设/目标表/合计 tokens
    const meta = el.querySelector('.acu-v2-prompt-preview-drawer__meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain('自动填表');
    expect(meta!.textContent).toContain('JSON 原生');
    expect(meta!.textContent).toContain('默认预设');
    expect(meta!.textContent).toContain('人物卡、事件表');
    expect(meta!.textContent).toContain('460');

    // 分段列表：role 徽标 + tokens + content
    const segments = el.querySelectorAll('.acu-v2-prompt-preview-drawer__segment');
    expect(segments).toHaveLength(2);
    expect(el.textContent).toContain('你是数据库填表助手');
    expect(el.textContent).toContain('人物卡当前内容如下…');
    expect(el.textContent).toContain('340 tokens');
  });

  it('点击管线 tab 发出 update:scenario', async () => {
    const { el, emitted } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      scenario: 'auto',
      tableFillPreview: TABLE_FILL_PREVIEW,
    });
    await nextTick();

    const catchUp = Array.from(el.querySelectorAll('.acu-segmented__item')).find(
      (i) => i.textContent?.trim() === '一键追平',
    );
    expect(catchUp).toBeDefined();
    (catchUp as HTMLElement).click();
    await nextTick();

    expect(emitted).toContainEqual({ event: 'update:scenario', args: ['catch_up'] });
  });

  it('请求体默认折叠，展开后展示脱敏 JSON', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      scenario: 'auto',
      tableFillPreview: TABLE_FILL_PREVIEW,
    });
    await nextTick();

    // bodyMode=if：折叠时不渲染 pre
    expect(el.querySelector('.acu-v2-prompt-preview-drawer__request-body-json')).toBeNull();

    const header = el.querySelector('.acu-disclosure-group__header') as HTMLElement | null;
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('请求体预览（已脱敏）');
    header!.click();
    await nextTick();

    const pre = el.querySelector('.acu-v2-prompt-preview-drawer__request-body-json');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('"model"');
    expect(pre!.textContent).toContain('[已脱敏]系统段');
  });

  it('meta.storageMode=sqlite 时展示 SQLite 标签', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      scenario: 'catch_up',
      tableFillPreview: {
        ...TABLE_FILL_PREVIEW,
        meta: { ...TABLE_FILL_PREVIEW.meta, storageMode: 'sqlite', scenario: 'catch_up', targetSheetKeys: null },
      },
    });
    await nextTick();

    const meta = el.querySelector('.acu-v2-prompt-preview-drawer__meta')!;
    expect(meta.textContent).toContain('SQLite');
    expect(meta.textContent).toContain('未限定');
    expect(el.querySelector('.acu-segmented__item--active')?.textContent?.trim()).toBe('一键追平');
  });
});

describe('PromptPreviewDrawer 剧情模式', () => {
  it('渲染模拟输入占位文案与生成按钮，事件透传', async () => {
    const { el, emitted } = mountDrawer({
      isOpen: true,
      mode: 'plot',
      plotVirtualInput: '',
      plotPreview: null,
    });
    await nextTick();

    const textarea = el.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea!.getAttribute('placeholder')).toBe('模拟输入框文本，留空则 $7/$8 为空');

    const generate = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '生成预览',
    );
    expect(generate).toBeDefined();
    (generate as HTMLElement).click();
    await nextTick();
    expect(emitted).toContainEqual({ event: 'generate-plot', args: [] });

    textarea!.value = '模拟输入';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(emitted).toContainEqual({ event: 'update:plotVirtualInput', args: ['模拟输入'] });
  });

  it('按任务独立分组展示（任务名/阶段/预设/tokens），不硬编码类型名', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      mode: 'plot',
      plotPreview: makePlotPreview(),
    });
    await nextTick();

    const groups = el.querySelectorAll('.acu-v2-prompt-preview-drawer__plot-task');
    expect(groups).toHaveLength(2);

    expect(groups[0]!.textContent).toContain('主线推进');
    expect(groups[0]!.textContent).toContain('第 1 阶段');
    expect(groups[0]!.textContent).toContain('剧情预设A');
    expect(groups[0]!.textContent).toContain('50 tokens');

    expect(groups[1]!.textContent).toContain('回忆补全');
    expect(groups[1]!.textContent).toContain('第 2 阶段');
    expect(groups[1]!.textContent).toContain('160 tokens');
    // 第二个任务的两个分段都渲染
    expect(groups[1]!.querySelectorAll('.acu-v2-prompt-preview-drawer__segment')).toHaveLength(2);
  });

  it('truncatedToFirstStage=true 时显示黄色截断提示，false 时不显示', async () => {
    const truncated = mountDrawer({
      isOpen: true,
      mode: 'plot',
      plotPreview: makePlotPreview({ truncatedToFirstStage: true }),
    });
    await nextTick();
    const note = truncated.el.querySelector('.acu-v2-prompt-preview-drawer__truncated-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('为避免真实请求，仅展示第一阶段任务的提示词，后续阶段未执行');

    const full = mountDrawer({
      isOpen: true,
      mode: 'plot',
      plotPreview: makePlotPreview({ truncatedToFirstStage: false }),
    });
    await nextTick();
    expect(full.el.querySelector('.acu-v2-prompt-preview-drawer__truncated-note')).toBeNull();
  });
});

describe('PromptPreviewDrawer 状态', () => {
  it('loading 时不渲染内容，展示加载提示', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      loading: true,
      tableFillPreview: TABLE_FILL_PREVIEW,
    });
    await nextTick();

    const loading = el.querySelector('.acu-v2-prompt-preview-drawer__loading');
    expect(loading).not.toBeNull();
    expect(loading!.textContent).toContain('正在生成提示词预览');
    expect(el.querySelector('.acu-v2-prompt-preview-drawer__segment')).toBeNull();
  });

  it('error 态展示结构化 message 与 detail', async () => {
    const { el } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      loading: false,
      error: { message: '未配置 API 预设', detail: 'settings.apiPreset 为空，请先在设置页选择预设' },
    });
    await nextTick();

    const error = el.querySelector('.acu-v2-prompt-preview-drawer__error');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('生成提示词预览失败');
    expect(error!.textContent).toContain('未配置 API 预设');
    expect(error!.textContent).toContain('settings.apiPreset 为空，请先在设置页选择预设');
  });
});

describe('PromptPreviewDrawer 抽屉骨架', () => {
  it('关闭按钮发出 close 事件', async () => {
    const { el, emitted } = mountDrawer({
      isOpen: true,
      mode: 'table-fill',
      tableFillPreview: TABLE_FILL_PREVIEW,
    });
    await nextTick();

    const close = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '关闭',
    );
    expect(close).toBeDefined();
    (close as HTMLElement).click();
    await nextTick();
    expect(emitted).toContainEqual({ event: 'close', args: [] });
  });
});

// pinia：与项目组件测试范式保持一致（本组件未用 store，但保持同构环境）
beforeEach(() => {
  setActivePinia(createPinia());
});
