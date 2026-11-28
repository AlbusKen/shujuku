/**
 * service/preview/plot-prompt-preview.ts — 剧情任务提示词只读预览
 *
 * 通过 runPlotTasksRuntime_ACU 的 requestContext 干跑通道枚举将发给剧情模型的提示词：
 * callApi 记录渲染完成的 messages 后抛 TaskAbortedByUser，引擎按手动中止语义
 * 逐层 rethrow（plot-task-engine.ts:737-743 / :819-820 / :1114-1117），外层据此
 * 把捕获结果当作正常产出。同阶段并发任务的 messages 全部捕获，后续阶段不执行。
 * requestContext 形状对齐 src/service/zero-layer/plot-preparation.ts:45-65。
 */
import { settings_ACU, currentJsonTableData_ACU } from '../runtime/state-manager';
import { getChatArray_ACU } from '../chat/chat-service';
import { runPlotTasksRuntime_ACU } from '../runtime/plot-runtime/plot-task-engine';
import { isSqliteMode } from '../table/storage-mode';
import { getStorageProvider, isStorageRuntimeReadyForSyncRead_ACU } from '../table/table-storage-strategy';
import { getGlobalNameMapperStatus_ACU, getNameMapper } from '../runtime/template-vars/name-mapper';
import type { SqlTemplateReadContext_ACU } from '../runtime/template-vars/sql-query-var';
import { estimateTextTk_ACU } from '../../shared/token-estimate';
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { evaluatePromptPreviewGate_ACU } from './prompt-preview-gate';
import {
    PromptPreviewGateBlockedError_ACU,
    PromptPreviewPrepareError_ACU,
    type PlotPromptPreview_ACU,
    type PlotTaskPromptPreview_ACU,
    type PromptPreviewSegment_ACU,
} from './prompt-preview-types';

// UI 组合层（usePromptPreview.ts）直接从本文件取类型：对外 re-export 契约类型。
export type { PlotPromptPreview_ACU, PlotTaskPromptPreview_ACU, PromptPreviewSegment_ACU } from './prompt-preview-types';

export async function previewPlotPrompts_ACU(virtualInput: string): Promise<PlotPromptPreview_ACU> {
    const gate = evaluatePromptPreviewGate_ACU();
    if (!gate.plot.available) {
        throw new PromptPreviewGateBlockedError_ACU('plot', gate.plot.blockers);
    }
    const input = String(virtualInput ?? '');

    const history = structuredClone(getChatArray_ACU() || []);
    let tableData = structuredClone(currentJsonTableData_ACU || {});
    let sqlReadContext: SqlTemplateReadContext_ACU | undefined;
    if (isSqliteMode()) {
        if (!isStorageRuntimeReadyForSyncRead_ACU()) {
            throw new PromptPreviewPrepareError_ACU('SQLite 运行时未就绪，暂不支持剧情提示词预览', 'sqlite_runtime_not_ready', true);
        }
        const provider = getStorageProvider();
        if (!provider || provider.mode !== 'sqlite' || !provider.isReady()) {
            throw new PromptPreviewPrepareError_ACU('SQLite 运行时未就绪，暂不支持剧情提示词预览', 'sqlite_runtime_not_ready', true);
        }
        const mapperStatus = getGlobalNameMapperStatus_ACU();
        if (mapperStatus.binding === 'unbound') {
            throw new PromptPreviewPrepareError_ACU('SQLite 名称映射未就绪，暂不支持剧情提示词预览', 'sqlite_mapper_not_ready', true);
        }
        const liveSqliteData = provider.getCurrentData?.();
        if (liveSqliteData && typeof liveSqliteData === 'object') {
            tableData = structuredClone(liveSqliteData);
        }
        if (mapperStatus.ready) {
            sqlReadContext = { provider, mapper: getNameMapper(), tableData };
        }
    }
    // ensurePlotTasksCompat_ACU 会写入传入对象（plot-task-engine.ts:905），必须传克隆。
    const plotSettings = { ...DEFAULT_PLOT_SETTINGS_ACU, ...structuredClone((settings_ACU as any).plotSettings || {}) };

    const captured: { task: any; presetName: string; messages: { role: string; content: string }[] }[] = [];
    const overrides = structuredClone((settings_ACU as any).plotTaskApiPresetOverridesById || {});
    const defaultPreset = String((settings_ACU as any).plotApiPreset || '').trim();

    const requestContext = {
        history,
        tableData,
        presetName: String(plotSettings.lastUsedPresetName || ''),
        signal: new AbortController().signal,
        ...(sqlReadContext ? { sqlReadContext } : {}),
        ejsContext: {
            chat: structuredClone(history),
            allTablesJson: structuredClone(tableData),
            userMessage: input,
        },
        finalPromptEntries: [],
        assertCurrent: () => { /* 预览无执行资格校验 */ },
        resolveTaskApiPreset: (task: any) => {
            return String(overrides[String(task?.id || '')] || task?.taskApiPreset || defaultPreset).trim();
        },
        async callApi(messages: { role: string; content: string }[], presetName: string): Promise<string | null> {
            const task = (requestContext as any).__currentTask || null;
            captured.push({ task, presetName: String(presetName || ''), messages: messages.map((m) => ({ role: String(m.role), content: String(m.content ?? '') })) });
            throw new Error('TaskAbortedByUser');
        },
    } as any;
    // executeSinglePlotTask_ACU 在 callApi 之前经 resolveTaskApiPreset 拿到 normalizedTask，
    // 用它同步记录当前任务，供 callApi 捕获时关联任务元数据。
    const rawResolve = requestContext.resolveTaskApiPreset.bind(requestContext);
    requestContext.resolveTaskApiPreset = (task: any) => {
        (requestContext as any).__currentTask = task;
        return rawResolve(task);
    };

    let truncatedToFirstStage = false;
    try {
        await runPlotTasksRuntime_ACU(plotSettings, input, {
            requestContext,
            inputForHash: input,
            hasExistingUserMessage: false,
        });
    } catch (error: any) {
        const message = String(error?.message || '');
        if (message === 'TaskAbortedByUser' || (error && typeof error === 'object' && error.name === 'AbortError')) {
            truncatedToFirstStage = true;
        } else {
            throw error;
        }
    }

    const tasks: PlotTaskPromptPreview_ACU[] = captured.map(({ task, presetName, messages }) => {
        const taskId = String(task?.id || '');
        const taskName = String(task?.name || taskId || '未命名任务');
        const stage = Math.max(1, Math.trunc(Number(task?.stage) || 1) || 1);
        const segments: PromptPreviewSegment_ACU[] = messages.map((message) => ({
            role: String(message.role),
            content: String(message.content ?? ''),
            tokens: estimateTextTk_ACU(String(message.content ?? '')),
        }));
        return {
            taskId,
            taskName,
            stage,
            presetName,
            segments,
            totalTokens: segments.reduce((sum, segment) => sum + segment.tokens, 0),
        };
    });

    return {
        tasks,
        truncatedToFirstStage,
        meta: {
            virtualInput: input,
            hasExistingUserMessage: false,
        },
    };
}
