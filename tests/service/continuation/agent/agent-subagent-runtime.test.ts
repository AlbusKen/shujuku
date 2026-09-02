import { describe, expect, it } from 'vitest';

import { AgentSubagentRuntime_ACU, renderStoryArcVolumePlanInstruction_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import type { AiUsageMetadata_ACU } from '../../../../src/service/continuation/internal-ai-call';

const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test' } as any;
const readReply_ACU = '{"action":"read","reads":["$TABLE:角色表"]}';
const finalReply_ACU = JSON.stringify({ summary: '结算完成', delta: {} });

function input_ACU(): Parameters<AgentSubagentRuntime_ACU['run']>[0] {
  const settings = buildDefaultContinuationSettings_ACU();
  settings.promptCacheEnabled = true;
  return {
    delegation: { agentName: 'hook-cognition-maintainer', prompt: '结算', reads: [] },
    settings,
    resolveContext: {
      chat: [
        { mes: '继续', is_user: true },
        { mes: '守门人挡在门后。', is_user: false },
      ],
      moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 0,
      execution: {
        envelope: {}, task: { taskId: 't', stages: [] }, stage: null,
        revision: null, node: null, turn: null,
        turnNumber: null, nodeTurnNumber: null,
      } as any,
      originInstruction: '推进剧情',
      recentTurnCount: 2,
      tableData: { s1: { name: '角色表', content: [['姓名'], ['林瑶']] } },
    },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 1, maxReads: 8, maxExtraReads: 1 },
    preset: preset_ACU,
    createIdentity: (_name, attempt) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
    isCurrent: () => true,
  };
}


async function runWithUsageSequence_ACU(sequence: Array<AiUsageMetadata_ACU | null>) {
  const usages = [...sequence];
  const replies = [readReply_ACU, finalReply_ACU];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async (_messages, _preset, _identity, _signal, options) => {
      const usage = usages.shift();
      if (usage) options?.onUsage?.(usage);
      return replies.shift() ?? finalReply_ACU;
    },
  });
  return runtime.run(input_ACU());
}

describe('AgentSubagentRuntime_ACU usage 累计', () => {
  it('renders the configured story-arc volume plans without conflating them with stage size', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.stageSize = 'short';

    const medium = renderStoryArcVolumePlanInstruction_ACU(settings);
    expect(medium).toContain('中线：新建或全量重构总纲时规划 10–14 卷');
    expect(medium).toContain('targetStageRange 是解释性容量锚');
    expect(medium).toContain('约 500–750 轮的数量级检查');
    expect(medium).toContain('不承诺固定字数或章节数');
    settings.storyArcVolumePlan = 'short';
    expect(renderStoryArcVolumePlanInstruction_ACU(settings)).toContain('短线：新建或全量重构总纲时规划 7–8 卷');
    settings.storyArcVolumePlan = 'long';
    const long = renderStoryArcVolumePlanInstruction_ACU(settings);
    expect(long).toContain('长线：新建或全量重构总纲时规划 20 卷');
    expect(long).toContain('约 500–750 轮的数量级检查');
    expect(long).not.toContain('100 章');
    settings.storyArcVolumePlan = 'custom';
    settings.customStoryArcVolumeCount = 16;
    expect(renderStoryArcVolumePlanInstruction_ACU(settings)).toContain('自定义：新建或全量重构总纲时规划 16 卷');
  });

  it('维护类派工固定写入 hooks/infoGap/chronology，提示词注入年代学账本现状', async () => {
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return finalReply_ACU;
      },
    });

    const result = await runtime.run(input_ACU());

    expect(result.writes).toEqual(['hooks', 'infoGap', 'chronology']);
    const rendered = calls[0].map(message => message.content).join('\n');
    expect(rendered).toContain('【故事年代学账本现状】');
    expect(rendered).toContain('没有已结算的故事时间记录');
    expect(rendered).toContain('$CHRONOLOGY 故事年代学账本');
    expect(rendered).toContain('【故事时间结算契约】');
  });

  it('renders fixed user intent and the complete current-stage outline from one resolve context', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '根据本轮任务校准总纲', reads: [] };
    // 总纲已建立：本用例只验证渲染，不触发“总纲为空时空写入需补条目”的门禁。
    input.resolveContext.moduleSnapshot = {
      ...input.resolveContext.moduleSnapshot,
      storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
    } as any;
    input.settings.agentPrompts.arcArchitect = [{
      role: 'user',
      content: '【初始要求】\n$USER_INTENT\n【完整大纲】\n$OUTLINE_WINDOW\n【任务】\n$AGENT_TASK',
      enabled: true,
      deletable: true,
    }];
    input.resolveContext.execution = {
      envelope: {},
      task: { taskId: 't', stages: [] },
      stage: { stageNumber: 2, status: 'running' },
      revision: { outline: { title: '禁区试探', goal: '确认入口代价', tempo: 'mixed', totalTurns: 2 } },
      node: {
        id: 'node-1',
        title: '入口试探',
        goal: '确认守门人意图',
        turns: [
          { id: 'turn-1', pacing: 'setup', goal: '观察守门人' },
          { id: 'turn-2', pacing: 'pressure', goal: '支付试探代价' },
        ],
      },
      turn: { id: 'turn-1', pacing: 'setup', goal: '观察守门人' },
      turnNumber: 1,
      nodeTurnNumber: 1,
    } as any;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return finalReply_ACU;
      },
    });

    await runtime.run(input);
    const rendered = calls[0].map(message => message.content).join('\n');
    expect(rendered).toContain('推进剧情');
    expect(rendered).toContain('阶段 2：禁区试探');
    expect(rendered).toContain('观察守门人');
    expect(rendered).toContain('支付试探代价');
    expect(rendered).toContain('根据本轮任务校准总纲');
  });

  it('keeps the arc-architect volume plan ahead of the trailing prefill so the prefill stays the last message', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    input.resolveContext.moduleSnapshot = {
      ...input.resolveContext.moduleSnapshot,
      storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
    } as any;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return finalReply_ACU;
      },
    });

    await runtime.run(input);

    const messages = calls[0];
    const last = messages[messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('{\n  "summary": "');
    expect(messages[messages.length - 2].role).toBe('user');
    expect(messages[messages.length - 2].content).toContain('【总纲卷数计划】');
    // 任务段（含全部固定资料注入）必须在卷数计划之前、预填充之前完整送达。
    expect(messages[messages.length - 3].content).toContain('【本次任务】\n立总纲');
    expect(messages[messages.length - 3].content).toContain('【故事总纲现状】');
  });

  it('runs final review through its own channel, evidence gate, and read-only tool loop', async () => {
    const base = input_ACU();
    base.settings.finalReview = { enabled: true, readTokenBudget: '50%', maxExtraReads: 1 };
    base.settings.agentReadTokenBudget = 1;
    base.resolveContext.worldbook = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '晶屑不能带离铁门。', tokens: 8 }],
    };
    const roles: string[] = [];
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const replies = [
      '{"action":"read","reads":["$TABLE:角色表"]}',
      JSON.stringify({ verdict: 'revise', summary: '晶屑去向需要遵守设定', emotionFindings: [], worldFindings: ['晶屑不能带离铁门'], logicFindings: [], requiredFixes: ['保留铁门限制'], preserve: ['守门人边界'] }),
    ];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      resolveAgentApiPreset: ((_settings: unknown, role: string) => { roles.push(role); return preset_ACU; }) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return replies.shift() ?? null;
      },
    });

    const result = await runtime.runFinalReview({
      settings: base.settings,
      resolveContext: base.resolveContext,
      candidateInstruction: '主角拿起晶屑走出铁门。',
      currentUserInput: '让主角观察晶屑。',
      planningSummary: '主线建议主角试探守门人。',
      createIdentity: (_name, attempt) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `final-${attempt}`, source: 'agent_subagent' }) as any,
      isCurrent: () => true,
    });

    expect(roles).toEqual(['finalReviewer']);
    expect(result.output).toMatchObject({ verdict: 'revise', worldFindings: ['晶屑不能带离铁门'] });
    expect(result.expandedReads).toEqual(['$TABLE:角色表']);
    expect(result.toolRounds).toBe(1);
    expect(result.readTokens).toBeGreaterThan(0);
    expect(result.iterations).toBe(2);
    expect(calls[0].map(message => message.content).join('\n')).toContain('晶屑不能带离铁门。');
    expect(calls[1].map(message => message.content).join('\n')).toContain('角色表');
  });

  it('所有调用均报告字段时逐字段求和，并保留明确 0', async () => {
    const result = await runWithUsageSequence_ACU([
      { promptTokens: 10, completionTokens: 2, cachedTokens: 0, cacheWriteTokens: 3 },
      { promptTokens: 5, completionTokens: 4, cachedTokens: 7, cacheWriteTokens: 1 },
    ]);

    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 6,
      cachedTokens: 7,
      cacheWriteTokens: 4,
    });
  });

  it('任一次已观测调用缺字段时，该累计字段保持 undefined', async () => {
    const result = await runWithUsageSequence_ACU([
      { promptTokens: 10, cachedTokens: 2, cacheWriteTokens: 1 },
      { promptTokens: 5, completionTokens: 3, cacheWriteTokens: 4 },
    ]);

    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: undefined,
      cachedTokens: undefined,
      cacheWriteTokens: 5,
    });
  });

  it('全部调用都没有 usage 回调时保持 null', async () => {
    const result = await runWithUsageSequence_ACU([null, null]);

    expect(result.usage).toBeNull();
  });
});
