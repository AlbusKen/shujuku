/**
 * tests/service/preview/plot-prompt-preview.test.ts
 * 剧情任务提示词预览 — TaskAbortedByUser 干跑捕获语义
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockChat,
  mockCurrentJsonTableData,
  mockFillMode,
  mockEngineTasks,
  mockEngineError,
} = vi.hoisted(() => {
  return {
    mockSettings: {
      plotSettings: { enabled: true },
      plotApiPreset: 'default-preset',
      plotTaskApiPresetOverridesById: {} as Record<string, string>,
      continuationPageEnabled: false,
      contentOptimizationSettings: { enabled: false },
      worldSimulationPageEnabled: false,
    } as any,
    mockChat: { value: [{ is_user: true, mes: 'hi' }, { is_user: false, mes: 'plot' }] as any[] },
    mockCurrentJsonTableData: { sheet_0: { name: '表' } } as any,
    mockFillMode: { value: 'llm' as string },
    // 仿引擎任务集：[{id,name,stage,messages,presetOverride}]
    mockEngineTasks: { value: [] as any[] },
    mockEngineError: { value: null as any },
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: vi.fn(() => mockChat.value),
}));

vi.mock('../../../src/service/fill-mode/fill-mode-chat-record', () => ({
  resolveCurrentChatFillMode_ACU: vi.fn(() => ({ mode: mockFillMode.value, source: 'record' })),
}));

vi.mock('../../../src/service/agent/agent-worldbook-runtime-state', () => ({
  isAgentWorldbookRuntimeEnabled_ACU: vi.fn(() => false),
}));

// 仿 runPlotTasksRuntime_ACU 关键控制流：按 stage 分组逐阶段并发执行，
// 每任务先 resolveTaskApiPreset 再 callApi；callApi 抛错收集为 rejected，
// 任一阶段存在 rejected 即 throw 第一个 reason（plot-task-engine.ts:1114-1117），
// 后续阶段不执行。
vi.mock('../../../src/service/runtime/plot-runtime/plot-task-engine', () => ({
  runPlotTasksRuntime_ACU: vi.fn(async (_plotSettings: any, _userMessage: string, runtimeOptions: any) => {
    if (mockEngineError.value) throw mockEngineError.value;
    const requestContext = runtimeOptions.requestContext;
    const byStage = new Map<number, any[]>();
    for (const task of mockEngineTasks.value) {
      const stage = Math.max(1, Math.trunc(Number(task.stage) || 1) || 1);
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage)!.push(task);
    }
    const stages = [...byStage.keys()].sort((a, b) => a - b);
    for (const stage of stages) {
      const results = await Promise.allSettled(byStage.get(stage)!.map(async (task) => {
        const preset = requestContext.resolveTaskApiPreset(task);
        await requestContext.callApi(task.messages, preset);
      }));
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      if (rejected.length) throw rejected[0].reason;
    }
  }),
}));

import { previewPlotPrompts_ACU } from '../../../src/service/preview/plot-prompt-preview';
import { PromptPreviewGateBlockedError_ACU } from '../../../src/service/preview/prompt-preview-types';

function resetBase() {
  mockSettings.plotSettings = { enabled: true };
  mockSettings.plotApiPreset = 'default-preset';
  mockSettings.plotTaskApiPresetOverridesById = {};
  mockSettings.continuationPageEnabled = false;
  mockSettings.contentOptimizationSettings = { enabled: false };
  mockSettings.worldSimulationPageEnabled = false;
  mockFillMode.value = 'llm';
  mockEngineError.value = null;
  mockEngineTasks.value = [];
}

describe('previewPlotPrompts_ACU', () => {
  beforeEach(resetBase);

  it('捕获第一阶段全部任务的提示词，后续阶段不执行，truncatedToFirstStage=true', async () => {
    mockEngineTasks.value = [
      { id: 't1', name: '任务一', stage: 1, messages: [{ role: 'system', content: 'S1' }] },
      { id: 't2', name: '任务二', stage: 1, messages: [{ role: 'user', content: 'U2' }] },
      { id: 't3', name: '任务三', stage: 2, messages: [{ role: 'user', content: 'U3' }] },
    ];
    const preview = await previewPlotPrompts_ACU('推进剧情');
    expect(preview.truncatedToFirstStage).toBe(true);
    expect(preview.tasks.map((t) => t.taskId)).toEqual(['t1', 't2']);
    expect(preview.tasks.find((t) => t.taskId === 't3')).toBeUndefined();
    expect(preview.meta.virtualInput).toBe('推进剧情');
    expect(preview.meta.hasExistingUserMessage).toBe(false);
  });

  it('任务元数据与分段 tokens 汇总：taskId/taskName/stage/presetName/segments', async () => {
    mockEngineTasks.value = [
      { id: 't1', name: '任务一', stage: 3, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }] },
    ];
    const preview = await previewPlotPrompts_ACU('input');
    expect(preview.tasks[0].taskId).toBe('t1');
    expect(preview.tasks[0].taskName).toBe('任务一');
    expect(preview.tasks[0].stage).toBe(3);
    expect(preview.tasks[0].presetName).toBe('default-preset');
    expect(preview.tasks[0].segments.map((s) => s.role)).toEqual(['system', 'user']);
    expect(preview.tasks[0].totalTokens).toBe(preview.tasks[0].segments.reduce((s, x) => s + x.tokens, 0));
  });

  it('任务级预设解析优先级：overrides[task.id] > task.taskApiPreset > 默认 plotApiPreset', async () => {
    mockSettings.plotTaskApiPresetOverridesById = { t1: 'override-preset' };
    mockEngineTasks.value = [
      { id: 't1', name: 'A', stage: 1, messages: [{ role: 'user', content: 'x' }] },
      { id: 't2', name: 'B', stage: 1, taskApiPreset: 'task-preset', messages: [{ role: 'user', content: 'y' }] },
      { id: 't3', name: 'C', stage: 1, messages: [{ role: 'user', content: 'z' }] },
    ];
    const preview = await previewPlotPrompts_ACU('input');
    const byId = Object.fromEntries(preview.tasks.map((t) => [t.taskId, t.presetName]));
    expect(byId.t1).toBe('override-preset');
    expect(byId.t2).toBe('task-preset');
    expect(byId.t3).toBe('default-preset');
  });

  it('引擎抛出非中止错误时原样透出，不吞不换', async () => {
    mockEngineError.value = new Error('worldbook exploded');
    await expect(previewPlotPrompts_ACU('input')).rejects.toThrow('worldbook exploded');
  });

  it('门控阻断：剧情总开关未开时抛 PromptPreviewGateBlockedError_ACU', async () => {
    mockSettings.plotSettings = { enabled: false };
    await expect(previewPlotPrompts_ACU('input')).rejects.toMatchObject({
      name: 'PromptPreviewGateBlockedError_ACU',
      scenario: 'plot',
    });
  });

  it('门控阻断：classic 模式下剧情预览不可用（fill_mode blocker）', async () => {
    mockFillMode.value = 'classic';
    await expect(previewPlotPrompts_ACU('input')).rejects.toMatchObject({
      name: 'PromptPreviewGateBlockedError_ACU',
      scenario: 'plot',
      blockers: [expect.objectContaining({ feature: 'fill_mode' })],
    });
  });

  it('plotSettings 传入引擎前经默认值合并与克隆，不被引擎 compat 写入污染全局设置', async () => {
    mockEngineTasks.value = [{ id: 't1', name: 'A', stage: 1, messages: [{ role: 'user', content: 'x' }] }];
    await previewPlotPrompts_ACU('input');
    // ensurePlotTasksCompat_ACU 的写入（若发生）只作用于克隆对象；全局设置保持原引用形态。
    expect(mockSettings.plotSettings).toEqual({ enabled: true });
  });
});
