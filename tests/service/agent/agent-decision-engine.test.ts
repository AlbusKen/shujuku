import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockCallAIWithPreset,
  mockGetLorebookEntries,
  mockGetLorebookEntriesStrict,
  mockRefreshPlotAgentWorldbookSnapshot,
} = vi.hoisted(() => ({
  mockCallAIWithPreset: vi.fn(),
  mockGetLorebookEntries: vi.fn(),
  mockGetLorebookEntriesStrict: vi.fn(),
  mockRefreshPlotAgentWorldbookSnapshot: vi.fn(),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: mockCallAIWithPreset,
  isRetryableAiRequestError_ACU: (error: any) => {
    const status = Number(error?.status);
    if (String(error?.name || '') === 'AbortError') return false;
    if (Number.isFinite(status)) return status === 429 || (status >= 500 && status <= 599);
    return error instanceof TypeError || /network|timeout/i.test(String(error?.message || ''));
  },
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: mockGetLorebookEntries,
}));

vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({
  refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: mockRefreshPlotAgentWorldbookSnapshot,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesStrict_ACU: mockGetLorebookEntriesStrict,
}));

vi.mock('../../../src/service/agent/agent-skillify-service', () => ({
  collectWorldbookSkillifyCandidates_ACU: vi.fn(async () => []),
  getWorldbookEntryKeywordsForSkillify_ACU: vi.fn((entry: any) => Array.isArray(entry?.keys) ? entry.keys : []),
}));

vi.mock('../../../src/service/agent/agent-worldbook-config-meta', () => ({
  resolveAgentWorldbookScopeBookNames_ACU: vi.fn(async () => []),
}));

import { runAgentDecisionForPlot_ACU } from '../../../src/service/agent/agent-decision-engine';

describe('runAgentDecisionForPlot_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const skillMetaBlock = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"陈默人物 Skill 描述","triggerWhen":"陈默触发条件","updatedAt":1,"updatedBy":"agent-skillify"}\nACU_SKILL_META_END -->';
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValue({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 12, previousEnabled: true }] },
    });
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 12, comment: `陈默人物档案\n\n${skillMetaBlock}`, keys: ['陈默'], content: '陈默内容', enabled: true },
    ]);
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {
        剧情书: [{ uid: 12, comment: `陈默人物档案\n\n${skillMetaBlock}`, keys: ['陈默'], content: '陈默内容', enabled: true }],
      },
      invalidBookNames: [],
      failedBookNames: [],
    });
  });

  it('keeps plot greenlights keyed by normalized task id', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {
        task_id: [{ entries: [1], reason: '人物模板' }],
      },
      finalGenerationGreenlights: [{ entries: [1], reason: '最终生成' }],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    expect(mockRefreshPlotAgentWorldbookSnapshot).toHaveBeenCalledTimes(1);
    expect(result.taskPlan).toHaveLength(1);
    expect(result.effectiveTasks[0].id).toBe('task_id');
    expect(result.plotGreenlights.task_id).toEqual([
      { bookName: '剧情书', uid: 12, reason: '人物模板' },
    ]);
    expect(result.finalGenerationGreenlights).toEqual([
      { bookName: '剧情书', uid: 12, reason: '最终生成' },
    ]);
  });

  it('通过 sharedContext 的 request context 读取 Agent 快照条目', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: { task_id: [{ entries: [1], reason: '人物模板' }] },
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));
    const readContext = { runId: 'plot-agent-test', bookEntriesPromises: new Map() };

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: { worldbookReadContext: readContext },
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    expect(mockGetLorebookEntries).not.toHaveBeenCalled();
    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['剧情书'], expect.objectContaining({
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'plot-agent-test', context: readContext,
    }));
  });

  it('renders decision context by AI layers with paired user turns and selectable task filtering', async () => {
    const longWorldbookContent = '书'.repeat(250);
    mockGetLorebookEntries.mockResolvedValueOnce([
      { uid: 12, comment: `陈默人物档案\n\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"陈默人物 Skill 描述","triggerWhen":"陈默触发条件","updatedAt":1,"updatedBy":"agent-skillify"}\nACU_SKILL_META_END -->`, keys: ['陈默'], content: longWorldbookContent, enabled: true },
    ]);
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'selectable_task', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          contextSettings: {
            decisionRecentContextCharLimit: 1,
          },
          agentDecisionPromptSegments: [
            { role: 'user', deletable: true, content: 'P={{agent.previousPlot}}\nR={{agent.recentContext}}\nT={{agent.tasksJson}}\nW={{agent.worldbookEntriesJson}}\nB={{agent.greenlightTkBudgetJson}}' },
          ],
        },
      },
      userMessage: '敲门',
      sharedContext: {
        lastPlotContent: '旧剧情兜底不应使用',
        seedContentForConditional: '旧最近上下文兜底不应使用',
        recentContextMessages: [
          { is_user: true, name: '用户', mes: '第一层用户输入', qrf_plot: '第一层剧情规划' },
          { is_user: false, name: '角色', mes: '第一层AI回复' },
          { is_user: true, name: '用户', mes: '第二层用户输入', qrf_plot: '第二层剧情规划' },
          { is_user: false, name: '角色', mes: '第二层AI回复' },
        ],
      },
      enabledTasks: [
        { id: 'selectable task', name: '可选任务', description: '需要 Agent 判断', enabled: true, promptGroup: { messages: [] } },
        { id: 'blocked task', name: '不可选任务', enabled: true, agentControl: { selectable: false }, promptGroup: { messages: [] } },
      ],
    });

    expect(result.active).toBe(true);
    expect(result.effectiveTasks).toHaveLength(1);
    expect(result.effectiveTasks[0].id).toBe('selectable_task');
    const messages = mockCallAIWithPreset.mock.calls[0][0];
    expect(messages[0].content).toContain('P=【最近上下文 AI层 1】');
    expect(messages[0].content).toContain('用户: 第二层用户输入');
    expect(messages[0].content).toContain('剧情推进记录: 第二层剧情规划');
    expect(messages[0].content).toContain('R=【最近上下文 AI层 1】');
    expect(messages[0].content).toContain('角色: 第二层AI回复');
    expect(messages[0].content).not.toContain('第一层用户输入');
    expect(messages[0].content).not.toContain('第一层AI回复');
    expect(messages[0].content).not.toContain('已截断');
    expect(messages[0].content).not.toContain('旧最近上下文兜底不应使用');
    expect(messages[0].content).toContain('"bookName": "剧情书"');
    expect(messages[0].content).toContain('"uid": 12');
    expect(messages[0].content).toContain('"index": 1');
    expect(messages[0].content).toContain('"tk": 167');
    expect(messages[0].content).toContain('"tokenEstimate": 167');
    expect(messages[0].content).toContain('预计消耗 167 Token');
    expect(messages[0].content).toContain('"description": "陈默人物 Skill 描述"');
    expect(messages[0].content).toContain('"triggerWhen": "陈默触发条件"');
    expect(messages[0].content).toContain('"unit": "Token"');
    expect(messages[0].content).toContain('"max": 80000');
    expect(messages[0].content).toContain('相关条目足够时尽可能超过 min');
    expect(messages[0].content).not.toContain('陈默人物档案');
    expect(messages[0].content).not.toContain('ACU_SKILL_META_START');
    expect(messages[0].content).not.toContain('"keys"');
    expect(messages[0].content).not.toContain('"contentPreview"');
    expect(messages[0].content).not.toContain(longWorldbookContent);
    expect(messages[0].content).toContain('selectable_task');
    expect(messages[0].content).not.toContain('blocked_task');
  });

  it('uses active snapshot entries without Skill metadata as fallback decision candidates', async () => {
    mockGetLorebookEntries.mockResolvedValueOnce([
      { uid: 12, comment: '陈默人物档案', keys: ['陈默'], content: '陈默内容', enabled: true },
    ]);
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [{ entries: [1], reason: '最终生成' }],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    expect(result.finalGenerationGreenlights).toEqual([{ bookName: '剧情书', uid: 12, reason: '最终生成' }]);
    const promptText = mockCallAIWithPreset.mock.calls[0][0].map((message: any) => String(message.content || '')).join('\n');
    expect(promptText).toContain('陈默人物档案');
    expect(promptText).toContain('关键词：陈默');
  });

  it('uses snapshot entries with empty Skill metadata as fallback decision candidates', async () => {
    const emptySkillMetaBlock = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"","triggerWhen":"","updatedAt":1,"updatedBy":"agent-skillify"}\nACU_SKILL_META_END -->';
    mockGetLorebookEntries.mockResolvedValueOnce([
      { uid: 12, comment: `陈默人物档案\n\n${emptySkillMetaBlock}`, keys: ['陈默'], content: '陈默内容', enabled: true },
    ]);
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [{ entries: [1], reason: '最终生成' }],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    expect(result.finalGenerationGreenlights).toEqual([{ bookName: '剧情书', uid: 12, reason: '最终生成' }]);
    const promptText = mockCallAIWithPreset.mock.calls[0][0].map((message: any) => String(message.content || '')).join('\n');
    expect(promptText).toContain('陈默人物档案');
    expect(promptText).toContain('关键词：陈默');
    expect(promptText).not.toContain('ACU_SKILL_META_START');
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
  });

  it('fallback 摘要剥离 takeover meta，不把接管元数据泄漏进提示词', async () => {
    const takeoverBlock = '<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"version":1,"kind":"agent_worldbook_takeover","selectionSignature":"sig","createdAt":1,"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockGetLorebookEntries.mockResolvedValueOnce([
      { uid: 12, comment: `陈默人物档案\n\n${takeoverBlock}`, keys: ['陈默'], content: '陈默内容', enabled: true },
    ]);
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [{ entries: [1], reason: '最终生成' }],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    expect(result.finalGenerationGreenlights).toEqual([{ bookName: '剧情书', uid: 12, reason: '最终生成' }]);
    const promptText = mockCallAIWithPreset.mock.calls[0][0].map((message: any) => String(message.content || '')).join('\n');
    expect(promptText).toContain('陈默人物档案');
    expect(promptText).toContain('关键词：陈默');
    expect(promptText).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META');
    expect(promptText).not.toContain('agent_worldbook_takeover');
    expect(promptText).not.toContain('"version":1');
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
  });

  it('uses user-layer plot records from recent context instead of independent plot context messages', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'selectable_task', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          contextSettings: {
            decisionRecentContextCharLimit: 1,
          },
          agentDecisionPromptSegments: [
            { role: 'user', deletable: true, content: 'P={{agent.previousPlot}}\nR={{agent.recentContext}}' },
          ],
        },
      },
      userMessage: '继续',
      sharedContext: {
        recentContextMessages: [
          { is_user: true, name: '用户', mes: '第一层用户输入', qrf_plot: '第一层剧情规划' },
          { is_user: false, name: '角色', mes: '第一层AI回复' },
          { is_user: true, name: '用户', mes: '第二层用户输入', qrf_plot_tasks: { main: '第二层任务剧情规划' } },
          { is_user: false, name: '角色', mes: '第二层AI回复' },
        ],
      },
      enabledTasks: [{ id: 'selectable task', name: '可选任务', description: '需要 Agent 判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    const messages = mockCallAIWithPreset.mock.calls[0][0];
    expect(messages[0].content).toContain('P=【最近上下文 AI层 1】');
    expect(messages[0].content).toContain('用户: 第二层用户输入');
    expect(messages[0].content).toContain('剧情推进记录: 【main】\n第二层任务剧情规划');
    expect(messages[0].content).toContain('R=【最近上下文 AI层 1】');
    expect(messages[0].content).not.toContain('第一层剧情规划');
    expect(messages[0].content).not.toContain('第一层用户输入');
  });

  it('uses two recent AI layers by default when context limit is not configured', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'selectable_task', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          agentDecisionPromptSegments: [
            { role: 'user', deletable: true, content: 'R={{agent.recentContext}}' },
          ],
        },
      },
      userMessage: '继续',
      sharedContext: {
        recentContextMessages: [
          { is_user: true, name: '用户', mes: '第一层用户输入' },
          { is_user: false, name: '角色', mes: '第一层AI回复' },
          { is_user: true, name: '用户', mes: '第二层用户输入' },
          { is_user: false, name: '角色', mes: '第二层AI回复' },
          { is_user: true, name: '用户', mes: '第三层用户输入' },
          { is_user: false, name: '角色', mes: '第三层AI回复' },
        ],
      },
      enabledTasks: [{ id: 'selectable task', name: '可选任务', description: '需要 Agent 判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    const messages = mockCallAIWithPreset.mock.calls[0][0];
    expect(messages[0].content).toContain('【最近上下文 AI层 1】');
    expect(messages[0].content).not.toContain('第二层用户输入');
    expect(messages[0].content).toContain('第二层AI回复');
    expect(messages[0].content).toContain('【最近上下文 AI层 2】');
    expect(messages[0].content).toContain('第三层用户输入');
    expect(messages[0].content).toContain('第三层AI回复');
    expect(messages[0].content).not.toContain('第一层用户输入');
    expect(messages[0].content).not.toContain('第一层AI回复');
  });



  it('does not execute taskPlan items for tasks marked as not selectable', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'blocked_task', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: { blocked_task: [{ bookName: '剧情书', uid: 12, reason: '不应生效' }] },
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'blocked task', name: '不可选任务', enabled: true, agentControl: { selectable: false }, promptGroup: { messages: [] } }],
    });

    expect(result.active).toBe(true);
    expect(result.taskPlan).toEqual([]);
    expect(result.effectiveTasks).toEqual([]);
    expect(result.plotGreenlights).toEqual({});
  });

  it('accepts legacy bookName uid greenlight protocol', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: { task_id: [{ bookName: '剧情书', uid: 12, reason: '旧协议' }] },
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.plotGreenlights.task_id).toEqual([{ bookName: '剧情书', uid: 12, reason: '旧协议' }]);
  });

  it('keeps dual-empty tasks out of tasksJson but merges them into effectiveTasks by stage and order', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'agent_task', run: true, effectiveStage: 2, effectiveOrder: 1 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          agentDecisionPromptSegments: [{ role: 'user', deletable: true, content: 'T={{agent.tasksJson}}' }],
        },
      },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [
        { id: 'agent task', name: '需判断', description: '有描述', triggerWhen: '', stage: 1, order: 0, enabled: true, promptGroup: { messages: [] } },
        { id: 'empty late', name: '空任务后', description: '', triggerWhen: '', stage: 2, order: 0, enabled: true, promptGroup: { messages: [] } },
        { id: 'empty early', name: '空任务前', description: '', triggerWhen: '', stage: 1, order: 1, enabled: true, promptGroup: { messages: [] } },
      ],
    });

    const prompt = mockCallAIWithPreset.mock.calls[0][0][0].content;
    expect(prompt).toContain('agent_task');
    expect(prompt).not.toContain('empty_late');
    expect(prompt).not.toContain('empty_early');
    expect(result.effectiveTasks.map(task => task.id)).toEqual(['empty_early', 'empty_late', 'agent_task']);
    expect(result.effectiveTasks[2].__agentEffective).toBe(true);
  });

  it('does not apply taskPlan to effectiveTasks when requireTaskPlan is false', async () => {
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: false, effectiveStage: 9, effectiveOrder: 9 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));
    const originalTask = { id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } };

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '填表',
      sharedContext: {},
      enabledTasks: [originalTask],
      requireTaskPlan: false,
    });

    expect(result.effectiveTasks).toEqual([originalTask]);
    expect(result.taskPlan).toEqual([]);
  });

  it('retries empty Agent AI decision responses beyond the former retry limit', async () => {
    let attempts = 0;
    mockCallAIWithPreset.mockImplementation(async () => {
      attempts += 1;
      return attempts === 11 ? JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
        plotGreenlights: {},
        finalGenerationGreenlights: [],
        fallbackMode: false,
        reason: 'ok',
      }) : '';
    });

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          contextSettings: { agentAiMaxRetries: 11 },
        },
      },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(11);
    expect(result.active).toBe(true);
    expect(result.effectiveTasks[0].id).toBe('task_id');
  });

  it('shards takeover candidates concurrently, splits min and max tk budgets, and merges local greenlights deterministically', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }, { uid: 2 }, { uid: 3 }, { uid: 4 }] },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '分片触发', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2, 3, 4].map(uid => ({
      uid,
      comment: `条目${uid}\n\n${skillMetaBlock(`Skill${uid}`)}`,
      keys: [`关键词${uid}`],
      content: `内容${uid}`,
      enabled: true,
    })));
    mockCallAIWithPreset
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: false, effectiveStage: 9, effectiveOrder: 9 }],
        plotGreenlights: { task_id: [{ entries: [1, 2], reason: '首片' }] },
        finalGenerationGreenlights: [{ entries: [1], reason: '首片正文' }],
        fallbackMode: false,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
        plotGreenlights: { task_id: [{ entries: [1, 2], reason: '次片' }] },
        finalGenerationGreenlights: [{ entries: [1], reason: '次片正文' }],
        fallbackMode: false,
      }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          agentDecisionConcurrency: 2,
          contextSettings: { decisionWorldbookCandidateLimit: 3, greenlightMinTkBudget: 101, greenlightMaxTkBudget: 999 },
          maxEntriesPerChannel: { plot: 20, finalGeneration: 20 },
          agentDecisionPromptSegments: [{ role: 'user', deletable: true, content: 'W={{agent.worldbookEntriesJson}}\nB={{agent.greenlightTkBudgetJson}}\nS={{agent.shard.index}}/{{agent.shard.count}}' }],
        },
      },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
    const prompts = mockCallAIWithPreset.mock.calls.map(([messages]) => messages[0].content);
    expect(prompts[0]).toContain('"uid": 1');
    expect(prompts[0]).toContain('"uid": 2');
    expect(prompts[0]).not.toContain('"uid": 3');
    expect(prompts[0]).toContain('"min": 51');
    expect(prompts[0]).toContain('"max": 500');
    expect(prompts[1]).toContain('"uid": 3');
    expect(prompts[1]).not.toContain('"uid": 4');
    expect(prompts[1]).toContain('"min": 50');
    expect(prompts[1]).toContain('"max": 499');
    expect(result.effectiveTasks).toEqual([]);
    expect(result.plotGreenlights.task_id.map(ref => ref.uid)).toEqual([1, 2, 3]);
    expect(result.finalGenerationGreenlights.map(ref => ref.uid)).toEqual([1, 3]);
  });

  it('要求完整决策时任一分片失败都拒绝返回部分选择', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true, selectionSignature: 'scope', createdAt: 1,
      books: { 剧情书: [{ uid: 1 }, { uid: 2 }] },
    });
    const skillMeta = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"分片候选","triggerWhen":"继续剧情","tk":12}\nACU_SKILL_META_END -->';
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2].map(uid => ({
      uid, enabled: true, comment: `条目${uid}\n${skillMeta}`, keys: [`关键词${uid}`], content: `内容${uid}`,
    })));
    mockCallAIWithPreset
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [], plotGreenlights: {},
        finalGenerationGreenlights: [{ entries: [1], reason: '成功分片选择' }], fallbackMode: false,
      }))
      .mockRejectedValueOnce(new Error('分片请求失败'));

    await expect(runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: {
        enabled: true, mode: 'agent', agentDecisionConcurrency: 2,
        contextSettings: { agentAiMaxRetries: 1, decisionWorldbookCandidateLimit: 2 },
      } },
      userMessage: '继续', sharedContext: {}, enabledTasks: [],
      requireTaskPlan: false, requireCompleteDecision: true,
    })).rejects.toThrow('agent_decision_shard_2_failed');
    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
  });

  it('uses configured concurrency above the former limit while avoiding empty decision shards', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [1, 2, 3, 4, 5, 6].map(uid => ({ uid })) },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '预算触发', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2, 3, 4, 5, 6].map(uid => ({
      uid,
      comment: `条目${uid}\n\n${skillMetaBlock(`Skill${uid}`)}`,
      keys: [`关键词${uid}`],
      content: `内容${uid}`,
      enabled: true,
    })));
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
    }));

    await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          agentDecisionConcurrency: 9,
          contextSettings: { greenlightMinTkBudget: 3, greenlightMaxTkBudget: 11 },
          agentDecisionPromptSegments: [{ role: 'user', deletable: true, content: 'W={{agent.worldbookEntriesJson}}\nB={{agent.greenlightTkBudgetJson}}\nS={{agent.shard.index}}/{{agent.shard.count}}' }],
        },
      },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(6);
    const prompts = mockCallAIWithPreset.mock.calls.map(([messages]) => messages[0].content);
    expect(prompts[0]).toContain('S=1/6');
    expect(prompts[5]).toContain('S=6/6');
  });

  it('keeps the full min and max tk budgets when configured concurrency collapses to one non-empty shard', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }] },
    });
    const skillMetaBlock = `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description: '单片 Skill', triggerWhen: '单片触发', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([{
      uid: 1,
      comment: `单片条目\n\n${skillMetaBlock}`,
      keys: ['单片'],
      content: '单片内容',
      enabled: true,
    }]);
    mockCallAIWithPreset.mockResolvedValueOnce(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
    }));

    await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          agentDecisionConcurrency: 5,
          contextSettings: { greenlightMinTkBudget: 101, greenlightMaxTkBudget: 999 },
          agentDecisionPromptSegments: [{ role: 'user', deletable: true, content: 'B={{agent.greenlightTkBudgetJson}}\nS={{agent.shard.index}}/{{agent.shard.count}}' }],
        },
      },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(1);
    const prompt = mockCallAIWithPreset.mock.calls[0][0][0].content;
    expect(prompt).toContain('S=1/1');
    expect(prompt).toContain('"min": 101');
    expect(prompt).toContain('"max": 999');
  });

  it('preserves zero max tk budgets when the global max is smaller than the actual shard count', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }, { uid: 2 }, { uid: 3 }] },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '零预算触发', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2, 3].map(uid => ({
      uid,
      comment: `条目${uid}\n\n${skillMetaBlock(`Skill${uid}`)}`,
      keys: [`关键词${uid}`],
      content: `内容${uid}`,
      enabled: true,
    })));
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [],
      fallbackMode: false,
    }));

    await runAgentDecisionForPlot_ACU({
      plotSettings: {
        agentWorldbookControl: {
          enabled: true,
          mode: 'agent',
          agentDecisionConcurrency: 3,
          contextSettings: { greenlightMinTkBudget: 0, greenlightMaxTkBudget: 1 },
          agentDecisionPromptSegments: [{ role: 'user', deletable: true, content: 'B={{agent.greenlightTkBudgetJson}}\nS={{agent.shard.index}}/{{agent.shard.count}}' }],
        },
      },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(3);
    const prompts = mockCallAIWithPreset.mock.calls.map(([messages]) => messages[0].content);
    expect(prompts[0]).toContain('S=1/3');
    expect(prompts[0]).toContain('"max": 1');
    expect(prompts[1]).toContain('S=2/3');
    expect(prompts[1]).toContain('"max": 0');
    expect(prompts[2]).toContain('S=3/3');
    expect(prompts[2]).toContain('"max": 0');
  });

  it('keeps successful shard greenlights when the task-plan authority shard fails', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }, { uid: 2 }] },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '降级触发', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2].map(uid => ({
      uid,
      comment: `条目${uid}\n\n${skillMetaBlock(`Skill${uid}`)}`,
      keys: [`关键词${uid}`],
      content: `内容${uid}`,
      enabled: true,
    })));
    mockCallAIWithPreset
      .mockRejectedValueOnce(new Error('authority request failed'))
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: false, effectiveStage: 9, effectiveOrder: 9 }],
        plotGreenlights: { task_id: [{ entries: [1], reason: '次片可用' }] },
        finalGenerationGreenlights: [{ entries: [1], reason: '次片正文' }],
        fallbackMode: false,
      }));
    const originalTask = { id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } };

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent', agentDecisionConcurrency: 2, contextSettings: { agentAiMaxRetries: 1 } } },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [originalTask],
    });

    expect(result.active).toBe(true);
    expect(result.taskPlan).toEqual([]);
    expect(result.effectiveTasks).toEqual([originalTask]);
    expect(result.plotGreenlights.task_id).toEqual([{ bookName: '剧情书', uid: 2, reason: '次片可用' }]);
    expect(result.finalGenerationGreenlights).toEqual([{ bookName: '剧情书', uid: 2, reason: '次片正文' }]);
  });

  it('retries a rejected Agent request within the same shard before falling back', async () => {
    mockCallAIWithPreset
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
        plotGreenlights: {},
        finalGenerationGreenlights: [],
        fallbackMode: false,
      }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent', contextSettings: { agentAiMaxRetries: 2 } } },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
    expect(result.active).toBe(true);
    expect(result.effectiveTasks[0].id).toBe('task_id');
  });

  it('only applies plot tk limits after merging shards so later local refs can fill the global budget', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }, { uid: 2 }, { uid: 3 }] },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '预算补位', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([
      { uid: 1, comment: `一号\n\n${skillMetaBlock('一号')}`, keys: ['一'], content: 'A'.repeat(30), enabled: true },
      { uid: 2, comment: `二号\n\n${skillMetaBlock('二号')}`, keys: ['二'], content: 'B'.repeat(150), enabled: true },
      { uid: 3, comment: `三号\n\n${skillMetaBlock('三号')}`, keys: ['三'], content: 'C'.repeat(30), enabled: true },
    ]);
    mockCallAIWithPreset
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
        plotGreenlights: { task_id: [{ entries: [1], reason: '首片低预算' }] },
        finalGenerationGreenlights: [],
        fallbackMode: false,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        plotGreenlights: { task_id: [{ entries: [1, 2], reason: '次片先高后低' }] },
        finalGenerationGreenlights: [],
        fallbackMode: false,
      }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent', agentDecisionConcurrency: 2, contextSettings: { greenlightMaxTkBudget: 100 } } },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.plotGreenlights.task_id.map(ref => ref.uid)).toEqual([1, 3]);
  });

  it('preserves the legacy inactive fallback when the authority task plan is invalid', async () => {
    mockCallAIWithPreset.mockResolvedValueOnce(JSON.stringify({
      taskPlan: [{ taskId: 'unknown_task', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: {},
      finalGenerationGreenlights: [{ entries: [1], reason: '不应写入' }],
      fallbackMode: false,
    }));
    const originalTask = { id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } };

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent' } },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [originalTask],
    });

    expect(result).toMatchObject({ active: false, fallbackReason: 'no_valid_task_plan_items', effectiveTasks: [originalTask] });
    expect(result.finalGenerationGreenlights).toEqual([]);
  });

  it('falls back to the original task set when every decision shard fails', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }, { uid: 2 }] },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '全失败', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2].map(uid => ({
      uid,
      comment: `条目${uid}\n\n${skillMetaBlock(`Skill${uid}`)}`,
      keys: [`关键词${uid}`],
      content: `内容${uid}`,
      enabled: true,
    })));
    mockCallAIWithPreset.mockRejectedValue(new Error('provider unavailable'));
    const originalTask = { id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } };

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent', agentDecisionConcurrency: 2, contextSettings: { agentAiMaxRetries: 1 } } },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [originalTask],
    });

    expect(mockCallAIWithPreset).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ active: false, fallbackReason: 'agent_request_error', effectiveTasks: [originalTask] });
    expect(result.plotGreenlights).toEqual({});
    expect(result.finalGenerationGreenlights).toEqual([]);
  });

  it('rejects a direct worldbook reference that belongs to another shard', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({
      active: true,
      selectionSignature: 'scope',
      createdAt: 1,
      books: { '剧情书': [{ uid: 1 }, { uid: 2 }] },
    });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '跨片拒绝', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([1, 2].map(uid => ({
      uid,
      comment: `条目${uid}\n\n${skillMetaBlock(`Skill${uid}`)}`,
      keys: [`关键词${uid}`],
      content: `内容${uid}`,
      enabled: true,
    })));
    mockCallAIWithPreset
      .mockResolvedValueOnce(JSON.stringify({
        taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
        plotGreenlights: { task_id: [{ bookName: '剧情书', uid: 2, reason: '越界直引' }] },
        finalGenerationGreenlights: [{ bookName: '剧情书', uid: 2, reason: '越界直引' }],
        fallbackMode: false,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        plotGreenlights: {},
        finalGenerationGreenlights: [],
        fallbackMode: false,
      }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent', agentDecisionConcurrency: 2 } },
      userMessage: '继续',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.plotGreenlights).toEqual({});
    expect(result.finalGenerationGreenlights).toEqual([]);
  });

  it('clips greenlights by max tk budget after resolving entry indexes', async () => {
    mockRefreshPlotAgentWorldbookSnapshot.mockResolvedValueOnce({ active: true, selectionSignature: 'scope', createdAt: 1, books: { '剧情书': [{ uid: 1 }, { uid: 2 }, { uid: 3 }] } });
    const skillMetaBlock = (description: string) => `<!-- ACU_SKILL_META_START\n${JSON.stringify({ version: 1, description, triggerWhen: '预算测试触发', updatedAt: 1, updatedBy: 'agent-skillify' })}\nACU_SKILL_META_END -->`;
    mockGetLorebookEntries.mockResolvedValueOnce([
      { uid: 1, comment: `一号\n\n${skillMetaBlock('一号 Skill')}`, keys: ['一'], content: 'A'.repeat(100), enabled: true },
      { uid: 2, comment: `二号\n\n${skillMetaBlock('二号 Skill')}`, keys: ['二'], content: 'B'.repeat(100), enabled: true },
      { uid: 3, comment: `三号\n\n${skillMetaBlock('三号 Skill')}`, keys: ['三'], content: 'C'.repeat(10), enabled: true },
    ]);
    mockCallAIWithPreset.mockResolvedValue(JSON.stringify({
      taskPlan: [{ taskId: 'task_id', run: true, effectiveStage: 1, effectiveOrder: 0 }],
      plotGreenlights: { task_id: [{ entries: [1, 2, 3], reason: '预算裁剪' }] },
      finalGenerationGreenlights: [],
      fallbackMode: false,
      reason: 'ok',
    }));

    const result = await runAgentDecisionForPlot_ACU({
      plotSettings: { agentWorldbookControl: { enabled: true, mode: 'agent', contextSettings: { greenlightMaxTkBudget: 80 }, maxEntriesPerChannel: { plot: 3 } } },
      userMessage: '敲门',
      sharedContext: {},
      enabledTasks: [{ id: 'task id', name: '默认任务', description: '需要判断的剧情任务', enabled: true, promptGroup: { messages: [] } }],
    });

    expect(result.plotGreenlights.task_id).toEqual([{ bookName: '剧情书', uid: 1, reason: '预算裁剪' }, { bookName: '剧情书', uid: 3, reason: '预算裁剪' }]);
  });
});
