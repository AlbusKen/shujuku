/**
 * usePromptPreview composable 测试
 *
 * 门控（禁用文案/fail-closed）、openTableFillPreview 的 scenario/targetSheetKeys 透传、
 * selectScenario 重新生成、剧情模式的按钮驱动生成、结构化错误、过期响应丢弃。
 *
 * service 层用 vi.doMock 工厂替换（与 useManualUpdate 测试范式一致）。
 * 注意：composable 静态 import 服务契约模块，需服务文件存在才能被 vite transform；
 * 服务层并行开发落地后本文件即可运行。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const evaluateGate = vi.fn();
const previewTableFill = vi.fn();
const previewPlot = vi.fn();

async function loadComposable() {
  vi.resetModules();
  vi.doMock('../../../src/service/preview/prompt-preview-gate', () => ({
    evaluatePromptPreviewGate_ACU: evaluateGate,
  }));
  vi.doMock('../../../src/service/preview/table-fill-prompt-preview', () => ({
    previewTableFillPrompt_ACU: previewTableFill,
  }));
  vi.doMock('../../../src/service/preview/plot-prompt-preview', () => ({
    previewPlotPrompts_ACU: previewPlot,
  }));
  return import('../../../src/presentation-v2/composables/usePromptPreview');
}

const GATE_OK = {
  tableFill: { available: true, blockers: [] },
  plot: { available: true, blockers: [] },
};

function makeTableFill(totalTokens: number) {
  return {
    segments: [{ role: 'system', content: '段', tokens: totalTokens }],
    requestBody: { model: 'm' },
    totalTokens,
    meta: {
      fillMode: '增量更新',
      scenario: 'auto',
      storageMode: 'json',
      updateMode: 'merge',
      targetSheetKeys: null,
      presetName: '默认预设',
    },
  } as any;
}

const PLOT_SAMPLE = {
  tasks: [
    { taskId: 't1', taskName: '主线推进', stage: 1, presetName: '剧情预设', segments: [], totalTokens: 42 },
  ],
  truncatedToFirstStage: false,
  meta: { virtualInput: '模拟输入', hasExistingUserMessage: false as const },
} as any;

beforeEach(() => {
  setActivePinia(createPinia());
  evaluateGate.mockReset();
  previewTableFill.mockReset();
  previewPlot.mockReset();
});

describe('usePromptPreview 门控', () => {
  it('可用时 available=true，blockerText 为兜底文案', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();
    state.refreshGate();

    expect(state.tableFillAvailable.value).toBe(true);
    expect(state.plotAvailable.value).toBe(true);
    expect(state.tableFillBlockerText.value).toBe('当前配置下不可用');
    expect(state.plotBlockerText.value).toBe('当前配置下不可用');
  });

  it('禁用时拼接 blockers 的 reason（；分隔）', async () => {
    evaluateGate.mockReturnValue({
      tableFill: {
        available: false,
        blockers: [
          { feature: 'api', reason: '未配置 API 预设' },
          { feature: 'preset', reason: '未选择填表预设' },
        ],
      },
      plot: { available: false, blockers: [{ feature: 'mode', reason: '仅 LLM 模式可用' }] },
    });
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();
    state.refreshGate();

    expect(state.tableFillAvailable.value).toBe(false);
    expect(state.tableFillBlockerText.value).toBe('未配置 API 预设；未选择填表预设');
    expect(state.plotAvailable.value).toBe(false);
    expect(state.plotBlockerText.value).toBe('仅 LLM 模式可用');
  });

  it('门控抛错时 fail-closed 并展示评估失败文案', async () => {
    evaluateGate.mockImplementation(() => {
      throw new Error('宿主环境未就绪');
    });
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();
    state.refreshGate();

    expect(state.tableFillAvailable.value).toBe(false);
    expect(state.plotAvailable.value).toBe(false);
    expect(state.tableFillBlockerText.value).toContain('门控评估失败：宿主环境未就绪');
    expect(state.plotBlockerText.value).toContain('门控评估失败：宿主环境未就绪');
  });
});

describe('usePromptPreview 填表模式', () => {
  it('openTableFillPreview 默认 auto，打开抽屉并调 service（不带 targetSheetKeys 键）', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    const sample = makeTableFill(10);
    previewTableFill.mockResolvedValue(sample);
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openTableFillPreview();
    expect(state.drawerOpen.value).toBe(true);
    expect(state.mode.value).toBe('table-fill');
    expect(state.loading.value).toBe(true);

    await vi.waitFor(() => expect(state.loading.value).toBe(false));
    expect(previewTableFill).toHaveBeenCalledWith({ scenario: 'auto' });
    expect(state.tableFillPreview.value).toEqual(sample);
    expect(state.error.value).toBeNull();
    expect(evaluateGate).toHaveBeenCalled();
  });

  it('openTableFillPreview 透传 scenario 与 targetSheetKeys', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    previewTableFill.mockResolvedValue(makeTableFill(1));
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openTableFillPreview('catch_up', ['人物卡']);
    await vi.waitFor(() => expect(state.loading.value).toBe(false));

    expect(previewTableFill).toHaveBeenCalledWith({
      scenario: 'catch_up',
      targetSheetKeys: ['人物卡'],
    });
  });

  it('selectScenario 切换管线重新生成并沿用最近的 targetSheetKeys', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    previewTableFill.mockResolvedValue(makeTableFill(1));
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openTableFillPreview('manual_refill', ['事件表']);
    await vi.waitFor(() => expect(state.loading.value).toBe(false));

    state.selectScenario('catch_up');
    expect(state.scenario.value).toBe('catch_up');
    await vi.waitFor(() => expect(previewTableFill).toHaveBeenCalledTimes(2));

    expect(previewTableFill).toHaveBeenLastCalledWith({
      scenario: 'catch_up',
      targetSheetKeys: ['事件表'],
    });
  });

  it('结构化错误：message + detail，loading 复位，预览保持 null', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    previewTableFill.mockRejectedValue(
      Object.assign(new Error('配置缺失'), { detail: 'apiPreset 为空，请先选择预设' }),
    );
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openTableFillPreview();
    await vi.waitFor(() => expect(state.loading.value).toBe(false));

    expect(state.error.value).toEqual({
      message: '配置缺失',
      detail: 'apiPreset 为空，请先选择预设',
    });
    expect(state.tableFillPreview.value).toBeNull();
  });

  it('过期响应被丢弃：只认最新一次生成结果', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    const stale = makeTableFill(10);
    const fresh = makeTableFill(20);
    let resolveStale!: (value: unknown) => void;
    previewTableFill
      .mockReturnValueOnce(new Promise(resolve => { resolveStale = resolve; }))
      .mockReturnValueOnce(Promise.resolve(fresh));
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openTableFillPreview('auto');
    state.selectScenario('catch_up');
    await vi.waitFor(() => expect(state.tableFillPreview.value).toEqual(fresh));

    resolveStale(stale);
    await new Promise(resolve => setTimeout(resolve, 0));
    // 过期响应（tokens=10）不得覆盖最新结果（tokens=20）
    expect(state.tableFillPreview.value).toEqual(fresh);
    expect(state.tableFillPreview.value?.totalTokens).toBe(20);
    expect(state.loading.value).toBe(false);
  });
});

describe('usePromptPreview 剧情模式', () => {
  it('打开抽屉不自动生成；生成时传入草稿文本；草稿跨开关保留', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    previewPlot.mockResolvedValue(PLOT_SAMPLE);
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openPlotPreview();
    expect(state.drawerOpen.value).toBe(true);
    expect(state.mode.value).toBe('plot');
    expect(previewPlot).not.toHaveBeenCalled();

    state.setPlotVirtualInput('模拟输入');
    await state.generatePlotPreview();
    expect(previewPlot).toHaveBeenCalledWith('模拟输入');
    expect(state.plotPreview.value).toEqual(PLOT_SAMPLE);

    state.closeDrawer();
    state.openPlotPreview();
    // 重开：草稿保留、上次预览清空、不自动生成
    expect(state.plotVirtualInput.value).toBe('模拟输入');
    expect(state.plotPreview.value).toBeNull();
    expect(previewPlot).toHaveBeenCalledTimes(1);
  });

  it('生成失败时结构化错误展示', async () => {
    evaluateGate.mockReturnValue(GATE_OK);
    previewPlot.mockRejectedValue(new Error('剧情预设缺失'));
    const { usePromptPreview } = await loadComposable();
    const state = usePromptPreview();

    state.openPlotPreview();
    await state.generatePlotPreview();

    expect(state.error.value).toEqual({ message: '剧情预设缺失' });
    expect(state.loading.value).toBe(false);
  });
});
