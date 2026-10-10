import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  autoFillTimer: null as ReturnType<typeof setTimeout> | null,
  setAutoFillTimer: vi.fn((timer: ReturnType<typeof setTimeout>) => { m.autoFillTimer = timer; }),
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  get contentOptimizationDebounceTimer_ACU() { return m.autoFillTimer; },
  _set_contentOptimizationDebounceTimer_ACU: m.setAutoFillTimer,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
  generationGate_ACU: { activeGenerations: [] },
  isQuietLikeGeneration_ACU: vi.fn(() => false),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  m.autoFillTimer = null;
});

describe('handleContentOptimizationEvent_ACU 防抖隔离', () => {
  it('仅写入正文优化专用 timer 槽', async () => {
    vi.useFakeTimers();
    const { handleContentOptimizationEvent_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    await handleContentOptimizationEvent_ACU('GENERATION_ENDED');

    expect(m.setAutoFillTimer).toHaveBeenCalledOnce();
    expect(m.autoFillTimer).not.toBeNull();
  });

  it('取消使已捕获的通知作用域失效，新通知不受旧取消影响', async () => {
    vi.useFakeTimers();
    const { captureContentOptimizationEventScope_ACU, cancelPendingContentOptimizationEvent_ACU, handleContentOptimizationEvent_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');
    await handleContentOptimizationEvent_ACU('GENERATION_ENDED');
    const isOldEventCurrent = captureContentOptimizationEventScope_ACU();
    expect(isOldEventCurrent()).toBe(true);

    cancelPendingContentOptimizationEvent_ACU();
    expect(isOldEventCurrent()).toBe(false);
    expect(m.autoFillTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(captureContentOptimizationEventScope_ACU()()).toBe(true);
  });
});
