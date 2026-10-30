import { isTakeoverEnabled_ACU } from '../../shared/takeover-control';
/**
 * presentation/triggers/auto-loop.ts — 自动化循环 UI 壳（presentation 层）
 * 业务逻辑委托给 service/loop/loop-controller.ts。
 * 本文件只负责 UI 操作：写输入框、点发送按钮、更新定时器显示、toast 通知。
 */

import { showToastr_ACU } from '../theme/toast';
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { TavernHelper_API_ACU } from '../../shared/host-api';
import { loopState_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { clickSendButton_ACU, setSendTextareaValue_ACU } from '../../shared/host-input';
import { updateLoopTimerDisplay_ACU, updateLoopUIStatus_ACU } from './settings-ui-sync';
import {
    validateLoopStartParams_ACU,
    initLoopState_ACU,
    stopLoopState_ACU,
    getNextLoopPrompt_ACU,
    handleRetryLogic_ACU,
    evaluateLoopEnd_ACU,
} from '../../service/loop/loop-controller';

export async function startAutoLoop_ACU() {
    // [重构] 调用 service 层校验
    const validationError = validateLoopStartParams_ACU();
    if (validationError) {
        showToastr_ACU('error', validationError, '无法启动循环');
        stopAutoLoop_ACU();
        return;
    }

    // [重构] 调用 service 层初始化状态
    initLoopState_ACU();

    // UI 更新
    updateLoopUIStatus_ACU(true);

    // 定时器 tick（UI 层负责显示）
    loopState_ACU.tickInterval = setInterval(() => {
        const elapsed = Date.now() - loopState_ACU.startTime;
        const remaining = Math.max(0, loopState_ACU.totalDuration - elapsed);
        if (remaining <= 0) {
            stopAutoLoop_ACU();
            showToastr_ACU('info', '总倒计时结束，自动化循环已停止。', '循环结束');
            return;
        }
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        updateLoopTimerDisplay_ACU(formatted);
    }, 1000);

    triggerLoopGeneration_ACU();
}

export function stopAutoLoop_ACU() {
    // [重构] 调用 service 层停止状态
    stopLoopState_ACU();
    // UI 更新
    updateLoopUIStatus_ACU(false);
}

async function triggerLoopGeneration_ACU() {
    if (!isTakeoverEnabled_ACU()) { stopAutoLoop_ACU(); return; }
    // [重构] 调用 service 层获取下一个提示词
    const prompt = getNextLoopPrompt_ACU();
    if (prompt === null) {
        stopAutoLoop_ACU();
        return;
    }

    // UI 操作：写入输入框并点击发送
    setSendTextareaValue_ACU(prompt);
    setTimeout(() => {
        if (loopState_ACU.isLooping && isTakeoverEnabled_ACU()) {
            if (typeof clickSendButton_ACU === 'function') clickSendButton_ACU();
        }
    }, 100);
}

async function triggerDirectRegenerateForLoop_ACU(loopSettings: any) {
    loopState_ACU.awaitingReply = true;
    if ((window as any).TavernHelper?.triggerSlash) {
        await (window as any).TavernHelper.triggerSlash('/trigger await=true');
        return;
    }
    // host-compat 适配层：无酒馆助手时 triggerSlash 由 SillyTavern 原生 slash 执行器兜底
    if (typeof TavernHelper_API_ACU?.triggerSlash === 'function') {
        await TavernHelper_API_ACU.triggerSlash('/trigger await=true');
        return;
    }
    if ((window as any).original_TavernHelper_generate) {
        (window as any).original_TavernHelper_generate({ user_input: '' });
        return;
    }
    (window as any).TavernHelper?.generate?.({ user_input: '' });
}

export async function enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply }: any) {
    // [重构] 调用 service 层重试逻辑
    const canRetry = await handleRetryLogic_ACU(shouldDeleteAiReply);
    if (!canRetry) {
        const maxRetries = loopSettings.maxRetries ?? 3;
        showToastr_ACU('error', `连续失败超过 ${maxRetries} 次，自动化循环已停止。`, '循环中止');
        stopAutoLoop_ACU();
        return;
    }

    // UI 操作：延迟后触发重新生成
    loopState_ACU.timerId = setTimeout(async () => {
        let busyWait = 0;
        while ((window as any).SillyTavern?.generating && busyWait < 20) {
            await new Promise(r => setTimeout(r, 500));
            busyWait++;
        }
        try {
            await triggerDirectRegenerateForLoop_ACU(loopSettings);
        } catch (err) {
            logError_ACU('[剧情推进] [重试] 触发生成失败:', err);
            if (loopState_ACU.isLooping && isTakeoverEnabled_ACU()) {
                await enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply: false });
            }
        }
    }, (loopSettings.retryDelay || 3) * 1000);
}

export async function onLoopGenerationEnded_ACU() {
    // [重构] 调用 service 层评估
    const result = await evaluateLoopEnd_ACU();
    const loopSettings = settings_ACU.plotSettings.loopSettings || DEFAULT_PLOT_SETTINGS_ACU.loopSettings;

    switch (result.action) {
        case 'ignore':
            return;

        case 'continue':
            loopState_ACU.timerId = setTimeout(() => {
                triggerLoopGeneration_ACU();
            }, result.loopDelay || 5000);
            return;

        case 'retry_delete':
            await enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply: true });
            return;

        case 'retry_no_delete':
            await enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply: false });
            return;

        case 'wait_retry':
            await enterLoopRetryFlow_ACU({ loopSettings, shouldDeleteAiReply: false });
            return;
    }
}
