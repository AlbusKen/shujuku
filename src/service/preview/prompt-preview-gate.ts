/**
 * service/preview/prompt-preview-gate.ts — 提示词预览门控（纯读、同步）
 *
 * 三个入口管线共享同一组互斥开关；任一开启即视为对应场景不可预览：
 *  1. agent 世界书接管（运行时优先，静态配置兼容字符串/对象双形态）
 *  2. 智能续写（页面开关 + 全局设置）
 *  3. 正文优化
 *  4. 格林推演
 * 填表场景额外要求当前聊天填表模式为 classic/llm；
 * 剧情场景额外要求 llm 且剧情任务总开关开启。
 */
import { settings_ACU } from '../runtime/state-manager';
import { resolveCurrentChatFillMode_ACU } from '../fill-mode/fill-mode-chat-record';
import { isAgentWorldbookRuntimeEnabled_ACU } from '../agent/agent-worldbook-runtime-state';
import type { PromptPreviewBlocker_ACU, PromptPreviewGateResult_ACU } from './prompt-preview-types';

// UI 组合层（usePromptPreview.ts）直接从本文件取类型：对外 re-export 契约类型。
export type { PromptPreviewGateResult_ACU, PromptPreviewScenarioGate_ACU, PromptPreviewBlocker_ACU } from './prompt-preview-types';

function readCurrentFillMode_ACU(): string {
  try {
    return String(resolveCurrentChatFillMode_ACU()?.mode || '');
  } catch (_) {
    return '';
  }
}

/** agent 世界书接管判定：运行时快照优先；未装载时回退 settings 静态配置。 */
function isAgentWorldbookTakeoverActive_ACU(): boolean {
  if (isAgentWorldbookRuntimeEnabled_ACU()) return true;
  const control: any = (settings_ACU as any)?.plotSettings?.agentWorldbookControl;
  if (typeof control === 'string') return control !== 'disabled';
  if (control && typeof control === 'object') {
    return control.enabled === true && String(control.mode || '') !== 'disabled';
  }
  return false;
}

function isContinuationActive_ACU(): boolean {
  // ContinuationSettings_ACU 无 enabled 字段（全局副本只承载参数）；
  // 「智能续写已开启」的用户可见语义即页面开关。
  return (settings_ACU as any)?.continuationPageEnabled === true;
}

function collectSharedBlockers_ACU(): PromptPreviewBlocker_ACU[] {
  const blockers: PromptPreviewBlocker_ACU[] = [];
  if (isAgentWorldbookTakeoverActive_ACU()) {
    blockers.push({
      feature: 'agent_worldbook',
      reason: 'Agent 世界书接管已开启，提示词由接管管线组装，与只读预览互斥',
    });
  }
  if (isContinuationActive_ACU()) {
    blockers.push({
      feature: 'continuation',
      reason: '智能续写已开启，与只读预览互斥',
    });
  }
  if ((settings_ACU as any)?.contentOptimizationSettings?.enabled === true) {
    blockers.push({
      feature: 'content_optimization',
      reason: '正文优化已开启，与只读预览互斥',
    });
  }
  if ((settings_ACU as any)?.worldSimulationPageEnabled === true) {
    blockers.push({
      feature: 'world_simulation',
      reason: '格林推演已开启，与只读预览互斥',
    });
  }
  return blockers;
}

export function evaluatePromptPreviewGate_ACU(): PromptPreviewGateResult_ACU {
  const fillMode = readCurrentFillMode_ACU();
  const sharedBlockers = collectSharedBlockers_ACU();

  const tableFillBlockers = [...sharedBlockers];
  if (fillMode !== 'classic' && fillMode !== 'llm') {
    tableFillBlockers.push({
      feature: 'fill_mode',
      reason: `当前聊天填表模式为「${fillMode || '未知'}」，仅经典表格/LLM 填表模式支持预览`,
    });
  }

  const plotBlockers = [...sharedBlockers];
  if (fillMode !== 'llm') {
    plotBlockers.push({
      feature: 'fill_mode',
      reason: `剧情任务预览要求 LLM 填表模式，当前为「${fillMode || '未知'}」`,
    });
  }
  if ((settings_ACU as any)?.plotSettings?.enabled !== true) {
    plotBlockers.push({
      feature: 'plot_tasks_disabled',
      reason: '剧情任务总开关未开启',
    });
  }

  return {
    tableFill: {
      available: tableFillBlockers.length === 0,
      blockers: tableFillBlockers,
    },
    plot: {
      available: plotBlockers.length === 0,
      blockers: plotBlockers,
    },
  };
}
