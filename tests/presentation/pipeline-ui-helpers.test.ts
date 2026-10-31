// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  refreshMerged: vi.fn(),
  surface: {
    refreshVisualizer: vi.fn(),
    isVisualizerActive: vi.fn(),
  },
  registeredSurface: { value: null as any },
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: vi.fn() } },
}));
vi.mock('../../src/shared/ui-surface-registry', () => ({
  getUiSurface_ACU: () => h.registeredSurface.value,
}));
vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: vi.fn() }));
vi.mock('../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: h.refreshMerged,
}));
vi.mock('../../src/presentation/state/ui-refs', () => ({
  $manualTableSelector_ACU: null,
  $importTableSelector_ACU: null,
}));
vi.mock('../../src/presentation/components/table-selector', () => ({
  renderManualTableSelector_ACU: vi.fn(),
  renderImportTableSelector_ACU: vi.fn(),
}));
vi.mock('../../src/presentation/components/update-status-display', () => ({
  updateCardUpdateStatusDisplay_ACU: vi.fn(),
}));
vi.mock('../../src/presentation/components/template-preset-ui', () => ({
  loadTemplatePresetSelect_ACU: vi.fn(),
}));
vi.mock('../../src/presentation/pages/popup-helpers', () => ({
  loadPlotSettingsToUI_ACU: vi.fn(),
}));

import { refreshMergedDataAndNotifyWithUI_ACU } from '../../src/presentation/components/pipeline-ui-helpers';
import { topLevelWindow_ACU } from '../../src/shared/env';

const notify = (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate as ReturnType<typeof vi.fn>;

function registerSurface(isActive: boolean | undefined) {
  h.registeredSurface.value = {
    refreshVisualizer: h.surface.refreshVisualizer,
    ...(typeof isActive === 'boolean' ? { isVisualizerActive: () => isActive } : {}),
  };
}

async function runWithTimers(operation: Promise<unknown>, ms = 800) {
  await vi.runAllTicks();
  await vi.advanceTimersByTimeAsync(ms);
  return operation;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.registeredSurface.value = null;
  h.refreshMerged.mockResolvedValue({ ok: true });
  h.surface.refreshVisualizer.mockResolvedValue(undefined);
  h.surface.isVisualizerActive.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('refreshMergedDataAndNotifyWithUI_ACU UI 可见性裁剪', () => {
  it('surface 未注册时不安排可视化刷新', async () => {
    await runWithTimers(refreshMergedDataAndNotifyWithUI_ACU());
    expect(h.surface.refreshVisualizer).not.toHaveBeenCalled();
  });

  it('surface 已注册但未提供 isVisualizerActive 时不安排可视化刷新', async () => {
    registerSurface(undefined);
    await runWithTimers(refreshMergedDataAndNotifyWithUI_ACU());
    expect(h.surface.refreshVisualizer).not.toHaveBeenCalled();
  });

  it('isVisualizerActive 返回 false 时不安排可视化刷新', async () => {
    registerSurface(false);
    await runWithTimers(refreshMergedDataAndNotifyWithUI_ACU());
    expect(h.surface.refreshVisualizer).not.toHaveBeenCalled();
  });

  it('isVisualizerActive 返回 true 时安排一次可视化刷新', async () => {
    registerSurface(true);
    const operation = refreshMergedDataAndNotifyWithUI_ACU();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.surface.refreshVisualizer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    await operation;
  });

  it('skipNotify: true 时不产生 800ms 回读等待', async () => {
    let settled = false;
    const operation = refreshMergedDataAndNotifyWithUI_ACU({ skipNotify: true });
    operation.finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1000);
    await operation;
    expect(settled).toBe(true);
  });

  it('skipNotify: false 且存在前端 API 时产生 800ms 回读等待', async () => {
    let settled = false;
    const operation = refreshMergedDataAndNotifyWithUI_ACU().finally(() => { settled = true; });
    await vi.runAllTicks();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(799);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await operation;
    expect(settled).toBe(true);
  });

  it('refreshVisualizer 被拒绝时不使外层函数 reject', async () => {
    registerSurface(true);
    h.surface.refreshVisualizer.mockRejectedValue(new Error('boom'));
    const operation = refreshMergedDataAndNotifyWithUI_ACU();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(800);
    await expect(operation).resolves.toMatchObject({ ok: true });
  });

  it('updateCardUpdateStatusDisplay_ACU 抛错不影响外层函数', async () => {
    const { updateCardUpdateStatusDisplay_ACU } = await import('../../src/presentation/components/update-status-display');
    (updateCardUpdateStatusDisplay_ACU as any).mockImplementation(() => { throw new Error('status boom'); });
    await runWithTimers(refreshMergedDataAndNotifyWithUI_ACU());
  });

  it('通知前端后调用 _notifyTableUpdate 一次', async () => {
    await runWithTimers(refreshMergedDataAndNotifyWithUI_ACU());
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('awaitFrontendReadback: false 时照常通知前端但不等待回读窗口', async () => {
    let settled = false;
    const operation = refreshMergedDataAndNotifyWithUI_ACU({ awaitFrontendReadback: false }).finally(() => { settled = true; });
    await vi.runAllTicks();
    await operation;
    expect(settled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

});
