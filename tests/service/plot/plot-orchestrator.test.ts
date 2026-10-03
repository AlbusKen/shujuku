/**
 * tests/service/plot/plot-orchestrator.test.ts
 * 剧情推进编排逻辑 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { markPlotIntercept_ACU } from '../../../src/service/plot/plot-logic';

const { mockSettings, mockLoopState, mockIsProcessing, mockSetIsProcessing, mockFlightModeActive, mockRunOptimization } = vi.hoisted(() => ({
  mockSettings: { plotSettings: { enabled: true } } as any,
  mockLoopState: { isLooping: false, isRetrying: false, awaitingReply: false } as any,
  mockIsProcessing: false,
  mockSetIsProcessing: vi.fn(),
  mockFlightModeActive: vi.fn(() => false),
  mockRunOptimization: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  loopState_ACU: mockLoopState,
  get isProcessing_Plot_ACU() { return mockIsProcessing; },
  _set_isProcessing_Plot_ACU: mockSetIsProcessing,
  abortController_ACU: null,
}));

vi.mock('../../../src/service/plot/plot-logic', () => ({
  markPlotIntercept_ACU: vi.fn(),
  shouldSkipPlotIntercept_ACU: vi.fn(() => false),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => `hash_${text}`),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_PLOT_SETTINGS_ACU: { enabled: false },
}));

vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  isFlightModeActive_ACU: mockFlightModeActive,
}));

vi.mock('../../../src/service/fill-mode/fill-mode-gate', () => ({
  isPlotSuppressedByFillModeForCurrentChat_ACU: () => false,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  runOptimizationLogic_ACU: (...args: any[]) => mockRunOptimization(...args),
}));
vi.mock('../../../src/shared/notice-hub', () => ({
  beginNoticeTask_ACU: vi.fn(() => ({ end: vi.fn() })),
}));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));

import { runOptimizationLogicWithUI_ACU } from '../../../src/presentation/components/plot-planning-ui';

import {
  shouldProcessTavernHelperHook_ACU,
  extractUserMessageFromOptions_ACU,
  applyPlanningResultToOptions_ACU,
  shouldEnterLoopRetryOnPlanningFailure_ACU,
  prepareStrategy1Context_ACU,
  orchestrateTavernHelperHook_ACU,
  orchestrateAfterCommandsStrategy1_ACU,
  orchestrateAfterCommandsStrategy2_ACU,
} from '../../../src/service/plot/plot-orchestrator';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.plotSettings = { enabled: true };
  mockLoopState.isLooping = false;
  mockLoopState.isRetrying = false;
  mockLoopState.awaitingReply = false;
  mockFlightModeActive.mockReturnValue(false);
});

// ═══ shouldProcessTavernHelperHook_ACU ═══
describe('shouldProcessTavernHelperHook_ACU', () => {
  it('正常情况返回 true', () => {
    expect(shouldProcessTavernHelperHook_ACU({})).toBe(true);
  });
  it('未启用返回 false', () => {
    mockSettings.plotSettings.enabled = false;
    expect(shouldProcessTavernHelperHook_ACU({})).toBe(false);
  });
  it('飞行模式开启时返回 false', () => {
    mockFlightModeActive.mockReturnValue(true);
    expect(shouldProcessTavernHelperHook_ACU({})).toBe(false);
  });
  it('重试中返回 false', () => {
    mockLoopState.isRetrying = true;
    expect(shouldProcessTavernHelperHook_ACU({})).toBe(false);
  });
  it('should_stream 返回 false', () => {
    expect(shouldProcessTavernHelperHook_ACU({ should_stream: true })).toBe(false);
  });
});

// ═══ extractUserMessageFromOptions_ACU ═══
describe('extractUserMessageFromOptions_ACU', () => {
  it('从 user_input 提取', () => {
    expect(extractUserMessageFromOptions_ACU({ user_input: '你好' })).toBe('你好');
  });
  it('从 prompt 提取', () => {
    expect(extractUserMessageFromOptions_ACU({ prompt: '继续' })).toBe('继续');
  });
  it('优先真实用户输入，inject-only 保留兼容', () => {
    expect(extractUserMessageFromOptions_ACU({
      user_input: '你好',
      injects: [{ content: '注入内容' }],
    })).toBe('你好');
    expect(extractUserMessageFromOptions_ACU({ injects: [{ content: '注入内容' }] })).toBe('注入内容');
  });
  it('无消息返回 null', () => {
    expect(extractUserMessageFromOptions_ACU({})).toBeNull();
  });
});

// ═══ applyPlanningResultToOptions_ACU ═══
describe('applyPlanningResultToOptions_ACU', () => {
  it('有 injects 时写回 injects', () => {
    const result = applyPlanningResultToOptions_ACU({ injects: [{ content: '原始' }] }, '新内容');
    expect(result.target).toBe('injects');
    expect(result.value).toBe('新内容');
    expect(applyPlanningResultToOptions_ACU({ user_input: '原文', injects: [{ content: '附加提示' }] }, '新内容'))
      .toEqual({ target: 'user_input', value: '新内容' });
  });
  it('有 prompt 时写回 prompt', () => {
    const result = applyPlanningResultToOptions_ACU({ prompt: '原始' }, '新内容');
    expect(result.target).toBe('prompt');
  });
  it('默认写回 user_input', () => {
    const result = applyPlanningResultToOptions_ACU({}, '新内容');
    expect(result.target).toBe('user_input');
  });
});

// ═══ shouldEnterLoopRetryOnPlanningFailure_ACU ═══
describe('shouldEnterLoopRetryOnPlanningFailure_ACU', () => {
  it('循环模式下规划失败返回 true', () => {
    mockLoopState.isLooping = true;
    mockLoopState.awaitingReply = true;
    expect(shouldEnterLoopRetryOnPlanningFailure_ACU(null)).toBe(true);
  });
  it('非循环模式返回 false', () => {
    expect(shouldEnterLoopRetryOnPlanningFailure_ACU(null)).toBe(false);
  });
  it('有有效消息返回 false', () => {
    mockLoopState.isLooping = true;
    mockLoopState.awaitingReply = true;
    expect(shouldEnterLoopRetryOnPlanningFailure_ACU('有效消息')).toBe(false);
  });
});

// ═══ prepareStrategy1Context_ACU ═══
describe('prepareStrategy1Context_ACU', () => {
  it('正常用户消息返回上下文', () => {
    const msg = { is_user: true, mes: '你好' };
    const result = prepareStrategy1Context_ACU(msg);
    expect(result).not.toBeNull();
    expect(result!.messageToProcess).toBe('你好');
    expect(msg._plot_processed).toBe(true);
  });
  it('非用户消息返回 null', () => {
    expect(prepareStrategy1Context_ACU({ is_user: false, mes: '你好' })).toBeNull();
  });
  it('已处理消息返回 null', () => {
    expect(prepareStrategy1Context_ACU({ is_user: true, mes: '你好', _plot_processed: true })).toBeNull();
  });
  it('空消息返回 null', () => {
    expect(prepareStrategy1Context_ACU({ is_user: true, mes: '' })).toBeNull();
  });
  it('null 返回 null', () => {
    expect(prepareStrategy1Context_ACU(null)).toBeNull();
  });
});

// ═══ orchestrateTavernHelperHook_ACU ═══
describe('orchestrateTavernHelperHook_ACU', () => {
  it('规划成功返回 planned', async () => {
    const runPlanning = vi.fn().mockResolvedValue('规划结果');
    const result = await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runPlanning);
    expect(result.action).toBe('planned');
    expect(result.finalMessage).toBe('规划结果');
    // 编排成功尚不等于宿主已收到提示词，不能提前登记去重。
    expect(markPlotIntercept_ACU).not.toHaveBeenCalled();
  });
  it('未启用时透传', async () => {
    mockSettings.plotSettings.enabled = false;
    const result = await orchestrateTavernHelperHook_ACU({}, vi.fn());
    expect(result.action).toBe('passthrough');
  });
  it('无用户消息时透传', async () => {
    const result = await orchestrateTavernHelperHook_ACU({}, vi.fn());
    expect(result.action).toBe('passthrough');
  });
  it('规划跳过返回 skipped', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ skipped: true });
    const result = await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runPlanning);
    expect(result.action).toBe('skipped');
  });
  it('用户中止返回 aborted', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ aborted: true });
    const result = await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runPlanning);
    expect(result.action).toBe('aborted');
  });
  it('循环模式规划失败返回 loop_retry', async () => {
    mockLoopState.isLooping = true;
    mockLoopState.awaitingReply = true;
    const runPlanning = vi.fn().mockResolvedValue(null);
    const result = await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runPlanning);
    expect(result.action).toBe('loop_retry');
  });
  it('已进入规划后异常或没有最终提示词均返回 failed', async () => {
    for (const runPlanning of [vi.fn().mockRejectedValue(new Error('规划失败')),
      vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue('   ')]) {
      const result = await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runPlanning);
      expect(result.action).toBe('failed');
    }
  });
});

// ═══ orchestrateAfterCommandsStrategy1_ACU ═══
describe('orchestrateAfterCommandsStrategy1_ACU', () => {
  it('规划成功返回 planned', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue('规划结果');
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('planned');
    expect(result.finalMessage).toBe('规划结果');
    expect(result.lastMessageIndex).toBe(5);
  });
  it('非用户消息返回 no_match', async () => {
    const result = await orchestrateAfterCommandsStrategy1_ACU({ is_user: false }, 5, vi.fn());
    expect(result.action).toBe('no_match');
  });
  it('用户中止返回 aborted', async () => {
    const msg = { is_user: true, mes: '你好' };
    const runPlanning = vi.fn().mockResolvedValue({ aborted: true, manual: true, restoreText: '你好' });
    const result = await orchestrateAfterCommandsStrategy1_ACU(msg, 5, runPlanning);
    expect(result.action).toBe('aborted');
    expect(result.manual).toBe(true);
    expect((msg as any)._plot_processed).toBeUndefined();
    for (const run of [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error('失败'))]) {
      expect(await orchestrateAfterCommandsStrategy1_ACU(msg, 5, run)).toMatchObject({
        action: 'failed', originalMessage: '你好', lastMessageIndex: 5,
      });
      expect((msg as any)._plot_processed).toBeUndefined();
    }
  });
});

// ═══ orchestrateAfterCommandsStrategy2_ACU ═══
describe('orchestrateAfterCommandsStrategy2_ACU', () => {
  it('规划成功返回 planned', async () => {
    const runPlanning = vi.fn().mockResolvedValue('规划结果');
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('planned');
    expect(result.finalMessage).toBe('规划结果');
  });
  it('空文本返回 skip', async () => {
    const result = await orchestrateAfterCommandsStrategy2_ACU('', vi.fn());
    expect(result.action).toBe('skip');
  });
  it('真实 UI 保留跳过原因，仅无需规划透传，忙碌和未知跳过仍停止', async () => {
    for (const reason of ['disabled', 'fill_mode_vector', 'retrying']) {
      mockRunOptimization.mockResolvedValue({ success: false, skipped: true, reason });
      expect(await runOptimizationLogicWithUI_ACU('继续')).toEqual({ skipped: true, reason });
      expect(await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runOptimizationLogicWithUI_ACU))
        .toEqual({ action: 'passthrough' });
      expect(await orchestrateAfterCommandsStrategy1_ACU({ is_user: true, mes: '继续' }, 0, runOptimizationLogicWithUI_ACU))
        .toEqual({ action: 'passthrough' });
      expect(await orchestrateAfterCommandsStrategy2_ACU('继续', runOptimizationLogicWithUI_ACU))
        .toEqual({ action: 'skip' });
    }
    for (const reason of ['inflight', undefined]) {
      mockRunOptimization.mockResolvedValue({ success: false, skipped: true, reason });
      expect(await orchestrateAfterCommandsStrategy2_ACU('继续', runOptimizationLogicWithUI_ACU))
        .toEqual({ action: 'failed' });
      expect(await orchestrateTavernHelperHook_ACU({ user_input: '继续' }, runOptimizationLogicWithUI_ACU))
        .toEqual({ action: 'skipped' });
    }
  });
  it('用户中止返回 aborted', async () => {
    const runPlanning = vi.fn().mockResolvedValue({ aborted: true, manual: true });
    const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
    expect(result.action).toBe('aborted');
    expect(result.manual).toBe(true);
  });
  it('规划异常或没有最终提示词返回 failed', async () => {
    for (const runPlanning of [vi.fn().mockRejectedValue(new Error('失败')),
      vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue('   ')]) {
      const result = await orchestrateAfterCommandsStrategy2_ACU('继续', runPlanning);
      expect(result.action).toBe('failed');
    }
  });
});
