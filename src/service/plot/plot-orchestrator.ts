/**
 * service/plot/plot-orchestrator.ts — 剧情推进编排逻辑（service 层：纯业务决策）
 * 从 presentation/bootstrap/init.ts 的 GENERATION_AFTER_COMMANDS 回调提取。
 * 
 * 负责：判断是否应该进行剧情规划、调用规划逻辑、返回规划结果。
 * 不负责：写回消息、清空输入框、停止生成等 UI 操作。
 */

import { isProcessing_Plot_ACU, loopState_ACU, settings_ACU, _set_isProcessing_Plot_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logError_ACU, logWarn_ACU, hashUserInput_ACU } from '../../shared/utils';
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { isFlightModeActive_ACU } from '../flight-mode/flight-mode-state';
import { isPlotSuppressedByFillModeForCurrentChat_ACU } from '../fill-mode/fill-mode-gate';

// ============================================================
// 类型定义
// ============================================================

export interface PlotOrchestrationResult {
    /** 规划后的最终消息文本 */
    finalMessage: string | null;
    /** 是否被跳过（重复触发） */
    skipped: boolean;
    /** 是否被用户中止 */
    aborted: boolean;
    /** 是否是手动中止 */
    manual: boolean;
    /** 需要恢复的文本（中止时） */
    restoreText?: string;
    /** 原始输入的哈希 */
    originalInputHash?: string;
}

// ============================================================
// 核心业务函数
// ============================================================

/**
 * 判断 TavernHelper.generate 钩子是否应该进行剧情规划
 * 纯业务逻辑
 */
export function shouldProcessTavernHelperHook_ACU(options: any): boolean {
    if (!settings_ACU.plotSettings.enabled || isFlightModeActive_ACU() || isProcessing_Plot_ACU || loopState_ACU.isRetrying || options.should_stream) {
        return false;
    }
    // 向量表格模式只做向量召回，不触发剧情推进。
    if (isPlotSuppressedByFillModeForCurrentChat_ACU()) return false;
    return true;
}

/**
 * 从 TavernHelper.generate 的 options 中提取用户消息
 * 纯业务逻辑
 */
export function extractUserMessageFromOptions_ACU(options: any): string | null {
    let userMessage = options.user_input || options.prompt;
    // injects 是附加提示词，不能覆盖本次真实用户输入；仅兼容旧的 inject-only 调用。
    if (!userMessage && options.injects?.[0]?.content) {
        userMessage = options.injects[0].content;
    }
    return userMessage || null;
}

/**
 * 处理规划结果并决定如何写回 TavernHelper.generate 的 options
 * 纯业务逻辑：返回应该写回的位置和内容
 */
export function applyPlanningResultToOptions_ACU(
    options: any,
    finalMessage: string
): { target: 'injects' | 'prompt' | 'user_input'; value: string } {
    if (options.user_input) {
        return { target: 'user_input', value: finalMessage };
    } else if (options.prompt) {
        return { target: 'prompt', value: finalMessage };
    } else if (options.injects?.[0]?.content) {
        return { target: 'injects', value: finalMessage };
    } else {
        return { target: 'user_input', value: finalMessage };
    }
}

/**
 * 处理循环模式下规划失败的情况
 * 纯业务逻辑
 * @returns true 表示应该进入重试流程
 */
export function shouldEnterLoopRetryOnPlanningFailure_ACU(finalMessage: any): boolean {
    return (
        loopState_ACU.isLooping &&
        loopState_ACU.awaitingReply &&
        (!finalMessage || typeof finalMessage !== 'string')
    );
}

/**
 * 为策略1（已有用户消息）准备规划上下文
 * 纯业务逻辑
 */
export function prepareStrategy1Context_ACU(lastMessage: any): {
    messageToProcess: string;
    originalInputHash: string;
} | null {
    if (!lastMessage || !lastMessage.is_user || lastMessage._plot_processed) {
        return null;
    }

    const messageToProcess = lastMessage.mes;
    if (!messageToProcess || !messageToProcess.trim()) {
        return null;
    }

    lastMessage._plot_processed = true;
    const originalInputHash = hashUserInput_ACU(messageToProcess);
    lastMessage._qrf_plot_pending_hash = originalInputHash;
    logDebug_ACU('[剧情推进] [Plot] 在消息对象上保存原始输入哈希:', originalInputHash);

    return { messageToProcess, originalInputHash };
}

// ============================================================
// 编排函数类型定义
// ============================================================

/**
 * 规划函数类型：由 presentation 层传入，负责调用 AI 规划并处理 UI 反馈（toast、中止按钮等）
 * 返回值与 runOptimizationLogicWithUI_ACU 兼容
 */
export type PlanningFn = (userMessage: string, options: any) => Promise<string | null | { skipped?: boolean; reason?: string; aborted?: boolean; manual?: boolean; restoreText?: string }>;

/** 只有明确的未启用/模式不适用/重试跳过允许普通发送；忙碌或未知跳过不能透传原文。 */
function isPlanningNotRequired_ACU(result: Awaited<ReturnType<PlanningFn>>): boolean {
    return !!result && typeof result === 'object' && result.skipped === true
        && (result.reason === 'disabled' || result.reason === 'fill_mode_vector' || result.reason === 'retrying');
}


/**
 * TavernHelper hook 编排结果
 */
export interface TavernHelperHookResult {
    /** 'passthrough' = 不处理直接透传, 'planned' = 规划成功, 'aborted' = 用户中止, 'skipped' = 跳过, 'loop_retry' = 需要循环重试 */
    action: 'passthrough' | 'planned' | 'aborted' | 'skipped' | 'loop_retry' | 'failed';
    /** 规划后的最终消息（action='planned' 时有值） */
    finalMessage?: string;
    /** 写回目标 */
    writeBack?: { target: 'injects' | 'prompt' | 'user_input'; value: string };
}

/**
 * GENERATION_AFTER_COMMANDS 策略1编排结果
 */
export interface Strategy1Result {
    /** 'no_match' = 不匹配策略1, 'passthrough' = 无需规划, 'skipped' = 忙碌/未知跳过，其余为规划结果 */
    action: 'no_match' | 'passthrough' | 'planned' | 'aborted' | 'skipped' | 'loop_retry' | 'failed';
    /** 规划后的最终消息 */
    finalMessage?: string;
    /** 是否是手动中止（需要停止生成、删除消息、恢复输入框） */
    manual?: boolean;
    /** 需要恢复的文本 */
    restoreText?: string;
    /** 原始用户消息（用于比对和恢复） */
    originalMessage?: string;
    /** 最后一条消息的索引 */
    lastMessageIndex?: number;
}

/**
 * GENERATION_AFTER_COMMANDS 策略2编排结果
 */
export interface Strategy2Result {
    /** 'skip' = 不处理, 'planned' = 规划成功, 'aborted' = 用户中止 */
    action: 'skip' | 'planned' | 'aborted' | 'failed';
    /** 规划后的最终消息 */
    finalMessage?: string;
    /** 是否是手动中止 */
    manual?: boolean;
}

// ============================================================
// TavernHelper.generate hook 编排
// ============================================================

/**
 * TavernHelper.generate hook 的完整业务编排
 * 
 * 职责：判断是否处理 → 提取用户消息 → 标记拦截 → 调用规划 → 判断循环重试 → 决定写回位置
 * 不负责：修改 options 对象、调用原始 generate 函数（这些由 presentation 层做）
 */
export async function orchestrateTavernHelperHook_ACU(
    options: any,
    runPlanning: PlanningFn
): Promise<TavernHelperHookResult> {
    // 1. 判断是否应该处理
    if (isProcessing_Plot_ACU && settings_ACU.plotSettings.enabled
        && !isFlightModeActive_ACU() && !isPlotSuppressedByFillModeForCurrentChat_ACU()
        && !loopState_ACU.isRetrying && !options.should_stream) {
        return { action: 'skipped' };
    }
    if (!shouldProcessTavernHelperHook_ACU(options)) {
        return { action: 'passthrough' };
    }

    // 2. 提取用户消息
    const userMessage = extractUserMessageFromOptions_ACU(options);
    if (!userMessage) {
        return { action: 'passthrough' };
    }

    // 4. 调用规划
    _set_isProcessing_Plot_ACU(true);
    try {
        const finalMessage = await runPlanning(userMessage, {
            originalUserInput: userMessage,
            hasExistingUserMessage: false,
        });

        // 5. 处理跳过
        if (finalMessage && (finalMessage as any).skipped) {
            if (isPlanningNotRequired_ACU(finalMessage)) return { action: 'passthrough' };
            logDebug_ACU('[剧情推进] Planning skipped in TavernHelper.generate hook (duplicate).');
            return { action: 'skipped' };
        }

        // 6. 处理中止
        if (finalMessage && (finalMessage as any).aborted) {
            logDebug_ACU('[剧情推进] Generation aborted by user.');
            return { action: 'aborted' };
        }

        // 7. 判断循环模式下规划失败
        if (shouldEnterLoopRetryOnPlanningFailure_ACU(finalMessage)) {
            logWarn_ACU('[剧情推进] [Loop] 规划未产生有效回复，按循环重试规则重试。');
            return { action: 'loop_retry' };
        }

        // 8. 规划成功，决定写回位置
        if (typeof finalMessage === 'string' && finalMessage.trim()) {
            const writeBack = applyPlanningResultToOptions_ACU(options, finalMessage);
            return { action: 'planned', finalMessage, writeBack };
        }

        // 已进入规划却没有最终提示词，不能静默退回用户原文。
        return { action: 'failed' };
    } catch (error) {
        logError_ACU('[剧情推进] Error in TavernHelper.generate hook orchestration:', error);
        return { action: 'failed' };
    } finally {
        _set_isProcessing_Plot_ACU(false);
    }
}

// ============================================================
// GENERATION_AFTER_COMMANDS 策略1编排
// ============================================================

/**
 * 策略1：处理已存在的用户消息（/send 等命令先创建消息再触发生成）
 * 
 * 职责：准备上下文 → 标记循环 → 调用规划 → 判断循环重试 → 返回结果
 * 不负责：写回 params.prompt、更新消息、清空输入框、停止生成、删除消息（这些由 presentation 层做）
 */
export async function orchestrateAfterCommandsStrategy1_ACU(
    lastMessage: any,
    lastMessageIndex: number,
    runPlanning: PlanningFn
): Promise<Strategy1Result> {
    // 1. 准备策略1上下文
    const context = prepareStrategy1Context_ACU(lastMessage);
    if (!context) {
        return { action: 'no_match' };
    }

    const { messageToProcess, originalInputHash } = context;

    // 2. 标记循环模式
    const isLoopTriggered = loopState_ACU.isLooping && loopState_ACU.awaitingReply;
    if (isLoopTriggered) {
        lastMessage._qrf_from_planning = true;
        logDebug_ACU('[剧情推进] [Loop] 标记规划层消息: _qrf_from_planning=true');
    }

    // 3. 调用规划
    _set_isProcessing_Plot_ACU(true);
    try {
        const finalMessage = await runPlanning(messageToProcess, {
            originalUserInput: messageToProcess,
            hasExistingUserMessage: true,
        });

        // 4. 处理跳过
        if (finalMessage && (finalMessage as any).skipped) {
            if (isPlanningNotRequired_ACU(finalMessage)) return { action: 'passthrough' };
            logDebug_ACU('[剧情推进] Planning skipped in Strategy 1 (duplicate).');
            return { action: 'skipped' };
        }

        // 5. 处理中止
        if (finalMessage && (finalMessage as any).aborted) {
            logDebug_ACU('[剧情推进] Generation aborted by user in Strategy 1.');
            return {
                action: 'aborted',
                manual: (finalMessage as any).manual,
                restoreText: (finalMessage as any).restoreText ?? messageToProcess,
                originalMessage: messageToProcess,
                lastMessageIndex,
            };
        }

        // 6. 判断循环模式下规划失败
        if (shouldEnterLoopRetryOnPlanningFailure_ACU(finalMessage)) {
            logWarn_ACU('[剧情推进] [Loop] 规划未产生有效回复，按循环重试规则重试。');
            return { action: 'loop_retry' };
        }

        // 7. 规划成功
        if (typeof finalMessage === 'string' && finalMessage.trim()) {
            return {
                action: 'planned',
                finalMessage,
                originalMessage: messageToProcess,
                lastMessageIndex,
            };
        }

        // no_match 只表示未选择该路径，不得表示已经执行的规划失败。
        return { action: 'failed', originalMessage: messageToProcess, lastMessageIndex };
    } catch (error) {
        logError_ACU('[剧情推进] Error processing last chat message:', error);
        return { action: 'failed', originalMessage: messageToProcess, lastMessageIndex };
    } finally {
        // 只有最终提示词真正写回楼层后，调用方才登记已处理。
        delete lastMessage._plot_processed;
        _set_isProcessing_Plot_ACU(false);
    }
}

// ============================================================
// GENERATION_AFTER_COMMANDS 策略2编排
// ============================================================

/**
 * 策略2：处理输入框中的文本（正常发送路径，用户楼层还未写入 chat）
 * 
 * 职责：调用规划 → 返回结果
 * 不负责：读取/写回输入框、停止生成（这些由 presentation 层做）
 */
export async function orchestrateAfterCommandsStrategy2_ACU(
    textInBox: string,
    runPlanning: PlanningFn
): Promise<Strategy2Result> {
    if (!textInBox || !String(textInBox).trim()) {
        return { action: 'skip' };
    }

    const originalInputText = String(textInBox);

    _set_isProcessing_Plot_ACU(true);
    try {
        const finalMessage = await runPlanning(originalInputText, {
            originalUserInput: originalInputText,
            hasExistingUserMessage: false,
        });

        // 处理跳过
        if (finalMessage && (finalMessage as any).skipped) {
            if (isPlanningNotRequired_ACU(finalMessage)) return { action: 'skip' };
            logDebug_ACU('[剧情推进] Planning skipped in Strategy 2 (duplicate).');
            return { action: 'failed' };
        }

        // 处理中止
        if (finalMessage && (finalMessage as any).aborted) {
            logDebug_ACU('[剧情推进] Generation aborted by user in Strategy 2.');
            return { action: 'aborted', manual: (finalMessage as any).manual };
        }

        // 规划成功
        if (typeof finalMessage === 'string' && finalMessage.trim()) {
            return { action: 'planned', finalMessage };
        }

        return { action: 'failed' };
    } catch (error) {
        logError_ACU('[剧情推进] Error processing textarea input (Strategy 2):', error);
        return { action: 'failed' };
    } finally {
        _set_isProcessing_Plot_ACU(false);
        // 消费掉本次发送意图，避免同一次生成链路重复触发
        // 注意：generationGate 的重置由 presentation 层负责（因为它涉及 UI 状态）
    }
}
