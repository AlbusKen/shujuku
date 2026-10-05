import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  autoFillTimer: null as ReturnType<typeof setTimeout> | null,
  setAutoFillTimer: vi.fn((timer: ReturnType<typeof setTimeout>) => { m.autoFillTimer = timer; }),
}));

vi.mock('../../../src/presentation/components/plot-editors', () => ({
  contentOptimizationDebounceTimer_ACU: m.autoFillTimer,
  _set_contentOptimizationDebounceTimer_ACU: m.setAutoFillTimer,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  NEW_MESSAGE_DEBOUNCE_DELAY_ACU: 500,
  AI_MATERIALIZATION_MAX_RETRIES_ACU: 3,
  AI_MATERIALIZATION_RETRY_DELAY_MS_ACU: 100,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  m.autoFillTimer = null;
});

describe('handleContentOptimizationEvent_ACU 防抖隔离', () => {
  it('仅写入自动填表专用 timer 槽', async () => {
    vi.useFakeTimers();
    const { handleContentOptimizationEvent_ACU } = await import('../../../src/presentation/triggers/settings-ui-sync/settings-ui-connect');

    await handleContentOptimizationEvent_ACU('GENERATION_ENDED');

    expect(m.setAutoFillTimer).toHaveBeenCalledOnce();
    expect(m.autoFillTimer).not.toBeNull();
  });
});
