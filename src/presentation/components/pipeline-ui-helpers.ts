/**
 * presentation/components/pipeline-ui-helpers.ts
 * 包装 service 层的 pipeline 函数，在调用后自动刷新 UI
 *
 * 同时提供统一的预设切换后 UI 同步入口 refreshPresetUIAfterSwitch_ACU，
 * 供模板预设 / 剧情推进预设的手工切换与 API 切换复用。
 */
import { refreshMergedDataAndNotify_ACU } from '../../service/worldbook/pipeline';
import { $manualTableSelector_ACU, $importTableSelector_ACU } from '../state/ui-refs';
import { renderManualTableSelector_ACU, renderImportTableSelector_ACU } from './table-selector';
import { updateCardUpdateStatusDisplay_ACU } from './update-status-display';
import { topLevelWindow_ACU } from '../../shared/env';
import { getUiSurface_ACU } from '../../shared/ui-surface-registry';
import { logDebug_ACU } from '../../shared/utils';
import { loadTemplatePresetSelect_ACU } from './template-preset-ui';
import { loadPlotSettingsToUI_ACU } from '../pages/popup-helpers';

/**
 * 刷新合并数据后自动通知前端 + 刷新可视化编辑器 + 刷新 UI 选择器和状态面板
 * presentation 层唯一入口：所有需要"刷新数据+刷新UI"的地方都调这个。
 */
/** 通知前端后等待其完成数据读取的窗口；仅在确实发出通知时才等待。 */
const FRONTEND_READBACK_WAIT_MS_ACU = 800;

/** awaitFrontendReadback=false：照常通知前端，但不等待回读窗口（宿主正在等待本次刷新时使用）。 */
export async function refreshMergedDataAndNotifyWithUI_ACU(
    { skipNotify = false, notifyMeta, awaitFrontendReadback = true }: { skipNotify?: boolean; notifyMeta?: { persisted?: boolean }; awaitFrontendReadback?: boolean } = {},
) {
    const result = await refreshMergedDataAndNotify_ACU();

    // 1. 通知前端 (iframe context)；notifyMeta.persisted=false 表示本次更新未写入聊天持久化（S2-1）
    let didNotifyFrontend = false;
    try {
        if (!skipNotify && (topLevelWindow_ACU as any).AutoCardUpdaterAPI) {
            (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate(notifyMeta);
            didNotifyFrontend = true;
            logDebug_ACU('Notified frontend to refresh UI after data merge.');
        } else if (skipNotify) {
            logDebug_ACU('Skipped frontend table update notification after data merge.');
        }
    } catch (_) {}

    // 2. 刷新已注册的 V2 可视化界面
    const visualizerActive = getUiSurface_ACU()?.isVisualizerActive?.() === true;
    if (visualizerActive) {
        setTimeout(() => {
            try {
                const surface = getUiSurface_ACU();
                if (surface) {
                    void surface.refreshVisualizer().catch((error: unknown) => {
                        logDebug_ACU('V2 visualizer refresh rejected:', error);
                    });
                }
            } catch (error) {
                logDebug_ACU('Failed to request V2 visualizer refresh:', error);
            }
        }, 200);
    } else {
        logDebug_ACU('Skipped V2 visualizer refresh: surface inactive or not registered.');
    }

    // 3. UI 选择器刷新
    if ($manualTableSelector_ACU) {
        try { renderManualTableSelector_ACU(); } catch (_) {}
    }
    if ($importTableSelector_ACU) {
        try { renderImportTableSelector_ACU(); } catch (_) {}
    }
    if (typeof updateCardUpdateStatusDisplay_ACU === 'function') {
        try { updateCardUpdateStatusDisplay_ACU(); } catch (error) {
            logDebug_ACU('Failed to refresh card update status display:', error);
        }
    }

    // 4. 仅当本次确实通知了前端读取方且调用方需要时才等待回读窗口，避免无读取方时白等
    if (didNotifyFrontend && awaitFrontendReadback) {
        await new Promise(resolve => setTimeout(resolve, FRONTEND_READBACK_WAIT_MS_ACU));
    }

    return result;
}

/**
 * 预设切换后统一刷新当前已挂载的 UI
 *
 * 在模板预设或剧情推进预设切换成功后调用，确保所有已打开的界面立即同步：
 *   1. 模板预设下拉框与状态文案
 *   2. 剧情推进编辑区全量重载（任务列表、任务参数、提示词、速率、循环设置、排除规则、预设选择器）
 *   3. 数据库状态卡片（含"当前生效模板预设"）
 *   4. 独立数据库编辑器窗口（顶部模板标识 + 编辑区数据）
 *
 * 各子刷新函数内部已做 DOM 存在性检查，弹窗/窗口未打开时静默跳过，
 * 不会因 DOM 缺失而抛错中断后续刷新。
 *
 * @param options.templateGlobalSelectName 传入则覆盖模板全局 select 选中值；null 则按当前运行态自动解析
 * @param options.keepTemplateGlobalValue   为 true 时保留模板全局 select 当前选中值不变
 */
export function refreshPresetUIAfterSwitch_ACU(
    { templateGlobalSelectName = null as string | null, keepTemplateGlobalValue = false } = {},
) {
    // 1. 模板预设 UI（全局/当前聊天下拉框 + 各类状态文案）
    try {
        loadTemplatePresetSelect_ACU({
            globalSelectName: templateGlobalSelectName,
            keepGlobalValue: keepTemplateGlobalValue,
        });
    } catch (e) {
        logDebug_ACU('[refreshPresetUI] 模板预设 UI 刷新失败:', e);
    }

    // 2. 剧情推进编辑区全量重载（任务列表 + 参数 + 提示词 + 速率 + 循环 + 排除规则 + 预设选择器）
    //    loadPlotSettingsToUI_ACU 内部会调用 loadPlotPresetSelect_ACU，无需再单独调
    try {
        loadPlotSettingsToUI_ACU();
    } catch (e) {
        logDebug_ACU('[refreshPresetUI] 剧情推进编辑区刷新失败:', e);
    }

    // 3. 数据库状态卡片（含"当前生效模板预设"显示）
    try {
        updateCardUpdateStatusDisplay_ACU();
    } catch (e) {
        logDebug_ACU('[refreshPresetUI] 数据库状态卡片刷新失败:', e);
    }

    // 4. V2 数据库编辑器
    try {
        const surface = getUiSurface_ACU();
        if (surface) {
            void surface.refreshVisualizer().catch((error: unknown) => {
                logDebug_ACU('[refreshPresetUI] V2 可视化编辑器刷新被拒绝:', error);
            });
        }
    } catch (error) {
        logDebug_ACU('[refreshPresetUI] V2 可视化编辑器刷新失败:', error);
    }
}
