import { describe, expect, it } from 'vitest';

import { AgentSubagentRuntime_ACU, renderStoryArcVolumePlanInstruction_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { renderMainSessionReadAppendix_ACU, omitSnapshotSectionsForSubagent_ACU } from '../../../../src/service/continuation/agent/agent-shared-materials';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import type { AiUsageMetadata_ACU } from '../../../../src/service/continuation/internal-ai-call';

const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test' } as any;
type SentMessage_ACU = { role: string; content: string; tool_call_id?: string };
const toolContent_ACU = (messages: readonly SentMessage_ACU[], id: string): string =>
  messages.find(message => message.role === 'tool' && message.tool_call_id === id)?.content ?? '';
const nativeToolTurn_ACU = (name: 'read' | 'write_sql', args: Record<string, unknown>, id: string) => ({
  content: '',
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

it('主会话已读到的全文会附在快照后面，重复调阅提示不带上', () => {
  const text = renderMainSessionReadAppendix_ACU([
    { id: 1, kind: 'tool', text: '### 顾雨涵\n人设全文', digest: 'read', turnKey: 't', at: 1, readKey: '$WORLDBOOK:书:2' },
    { id: 2, kind: 'tool', text: '不再重注', digest: 'read', turnKey: 't', at: 1, readKey: '$WORLDBOOK:书:2' },
    { id: 3, kind: 'tool', text: '{"outcome":"deliver"}', digest: '工作流状态回执', turnKey: 't', at: 1 },
  ] as any);
  expect(text).toContain('人设全文');
  expect(text).toContain('不要再对同一地址调用 read');
  expect(text).not.toContain('不再重注');
  expect(text).not.toContain('deliver');
});
it('已读附录只剔除任务已注入的完整地址，保留按 ID 细读和其他资料', () => {
  const snapshot = [
    '【故事总纲状态】', '总纲概况',
    '【主会话已调阅】',
    '下面是主会话本轮已读到的全文。',
    `### 故事总纲（$STORY_ARC）
完整总纲`,
    `### 故事总纲条目（$STORY_ARC:VOL-01）
细读本卷`,
    `### 当前大纲（$OUTLINE_WINDOW）
完整大纲`,
    `### 伏笔（$HOOKS_LEDGER）
另一个账本`,
  ].join(String.fromCharCode(10, 10));
  const filtered = omitSnapshotSectionsForSubagent_ACU(snapshot, new Set(['$STORY_ARC', '$OUTLINE_WINDOW']));
  expect(filtered).not.toContain('完整总纲');
  expect(filtered).not.toContain('完整大纲');
  expect(filtered).not.toContain('总纲概况');
  expect(filtered).toContain('细读本卷');
  expect(filtered).toContain('另一个账本');
});

it('附录正文中的空行和伪标题不会误删按 ID 调阅内容', () => {
  const appendix = renderMainSessionReadAppendix_ACU([
    { id: 1, kind: 'tool', text: `### 故事总纲（$STORY_ARC）\n完整总纲`, digest: 'read', readKey: '$STORY_ARC' },
    { id: 2, kind: 'tool', text: `### 本卷（$STORY_ARC:VOL-01）\n细读开头\n\n### 误作标题（$STORY_ARC）\n这行仍属本卷正文\n\n细读结尾`, digest: 'read', readKey: '$STORY_ARC:VOL-01' },
  ] as any);
  const filtered = omitSnapshotSectionsForSubagent_ACU(`【故事总纲状态】\n状态\n\n${appendix}`, new Set(['$STORY_ARC']));
  expect(filtered).not.toContain('完整总纲');
  expect(filtered).toContain('细读开头');
  expect(filtered).toContain('### 误作标题（$STORY_ARC）');
  expect(filtered).toContain('细读结尾');
});

const readReply_ACU = nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'call-table-read');
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
    expect(last.role).toBe('user');
    expect(last.content).toContain('"role": "assistant"');
    // 读取预算状态是运行时信息，紧贴预填充注入，是模型看到的最后一条 user 消息。
    const budgetMessage = messages.find(message => message.content.includes('【读取预算状态】'));
    expect(budgetMessage).toMatchObject({ role: 'user' });
    const runtimeSnapshot = messages.find(message => message.content.includes('【本回合运行时数据】'));
    expect(runtimeSnapshot).toMatchObject({ role: 'user' });
    const volumePlan = messages.find(message => message.content.includes('【总纲卷数计划】'));
    expect(volumePlan).toBeDefined();
    expect(messages.indexOf(volumePlan!)).toBeLessThan(messages.length - 1);
    // 总纲保留正文、总纲和全部已启用世界书目录，自行查阅；快照不再重复目录，也不注入命中全文。
    const taskSnapshot = messages.find(message => message.content.includes('【本次任务】\n立总纲') && message.content.includes('【故事总纲现状】'));
    expect(taskSnapshot).toMatchObject({ role: 'user' });
    expect(taskSnapshot?.content).toContain('【故事总纲现状】');
    expect(taskSnapshot?.content).toContain('追查真相');
    expect(taskSnapshot?.content).toContain('【完整当前阶段大纲】');
    expect(taskSnapshot?.content).toContain('【事件概览】');
    expect(taskSnapshot?.content).toContain('【最近正文】');
    expect(taskSnapshot?.content).toContain('【已启用世界书目录】');
    expect(taskSnapshot?.content).toContain('不是命中清单');
    expect(taskSnapshot?.content).toContain('总纲不注入命中条目全文');
    expect(taskSnapshot?.content).toContain('请用已启用世界书目录自行选择 read');
    const runtimeContent = runtimeSnapshot?.content ?? '';
    const taskMaterialStart = runtimeContent.indexOf('以下是用户对任务曾经提过的要求：');
    expect(taskMaterialStart).toBeGreaterThan(0);
    const runtimePrefix = runtimeContent.slice(0, taskMaterialStart);
    expect(runtimePrefix).not.toContain('【已启用世界书目录】');
    expect(runtimePrefix).not.toContain('【故事总纲状态】');
    expect(runtimePrefix).not.toContain('【当前故事总纲】');
    expect(runtimePrefix).not.toContain('追查真相');
    expect(runtimePrefix).not.toContain('【完整当前阶段大纲】');
    expect(runtimePrefix).not.toContain('【当前启用的阶段大纲】');
    expect(runtimePrefix).not.toContain('【本轮语境命中的世界书条目】');
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
      nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'call-review-table-read'),
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
    const firstCall = calls[0].map(message => message.content).join('\n');
    const secondCall = calls[1].map(message => message.content).join('\n');
    expect(firstCall).toContain('【本回合运行时数据】');
    expect(firstCall).toContain('主角拿起晶屑走出铁门。');
    expect(firstCall).toContain('【读取预算状态】');
    expect(firstCall).toContain('工具轮次剩余 1 / 1');
    expect(secondCall).toContain('角色表');
    expect(secondCall).toContain('工具轮次剩余 0 / 1');
  });

  it('首轮注入读取预算状态，并随工具批次刷新剩余轮次与遥测', async () => {
    const input = input_ACU();
    input.settings.agentReadTokenBudget = 300;
    input.settings.agentReadFallbackTokens = 50;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const replies = [readReply_ACU, finalReply_ACU];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return replies.shift() ?? finalReply_ACU;
      },
    });

    const result = await runtime.run(input);

    expect(result.expandedReads).toEqual(['$TABLE:角色表']);
    const firstCall = calls[0].map(message => message.content).join('\n');
    expect(firstCall).toContain('【读取预算状态】单批次读取上限约 300 tokens');
    expect(firstCall).toContain('不超过 50 tokens 的精读批次');
    expect(firstCall).toContain('工具轮次剩余 1 / 1');
    const secondCall = calls[1].map(message => message.content).join('\n');
    expect(secondCall).toContain('【工具结果】');
    expect(secondCall).toContain('工具轮次剩余 0 / 1');
    expect(secondCall).toContain('仅遥测、不扣减后续批次额度');
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

describe('子代理逐栏工具会话', () => {
  it('连续真实请求只补缺栏，保存回读后才发 accepted；下一次派工不继承 transcript', async () => {
    const { vi } = await import('vitest');
    const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
    const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
    const { readAgentModuleFieldSnapshot_ACU, readAgentModuleSnapshot_ACU } = await import('../../../../src/service/continuation/agent/agent-module-store');
    const input = input_ACU();
    input.budget.maxExtraReads = 1;
    const { AGENT_MODULE_FIELD_ACU } = await import('../../../../src/service/continuation/agent/agent-model');
    input.resolveContext.chat[0] = { mes: '既有正文', is_user: false, [AGENT_MODULE_FIELD_ACU]: { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 } };
    input.resolveContext.moduleSnapshot = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 };
    const chat = input.resolveContext.chat;
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    input.writeSql = ({ role, sql, resolvePage }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql, resolvePage });
    const firstSql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '门后信件', 0)";
    const restSql = "UPDATE hooks SET status = 'planted', importance = 'mid', planted_index = 1, planned_payoff = '' WHERE id = 'H1' AND expected_revision = 1";
    const replies = [
      nativeToolTurn_ACU('write_sql', { sql: firstSql }, 'call-first-write'),
      nativeToolTurn_ACU('read', { reads: ['$FIELD:hooks:H1'] }, 'call-hooks-read'),
      nativeToolTurn_ACU('write_sql', { sql: restSql }, 'call-second-write'),
      finalReply_ACU,
    ];
    const messages: Array<readonly SentMessage_ACU[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => { messages.push(value); return replies.shift() ?? finalReply_ACU; },
    });
    try {
      const result = await runtime.run(input);
      expect(result.usedFieldWrites).toBe(true);
      expect(result.iterations).toBe(4);
      expect(messages.slice(0, 4).every(request => request.some(item => item.content.startsWith('{')))).toBe(true);
      expect(toolContent_ACU(messages[1], 'call-first-write')).not.toBe('');
      expect(saveChat).toHaveBeenCalledTimes(2);
      expect(messages[1].map(item => item.content).join('\n')).toContain('"status":"committed"');
      expect(messages[1].map(item => item.content).join('\n')).toContain('"field":"summary","revision":1');
      expect(messages[2].map(item => item.content).join('\n')).toContain('"missingFields"');
      expect(messages[3].map(item => item.content).join('\n')).toContain('"field":"status"');
      expect(messages[2].some(item => item.content.includes('write_sql 轮次剩余 3 / 4'))).toBe(true);
      expect(messages[3].some(item => item.content.includes('"remainingToolRounds":0,"remainingWriteRounds":2'))).toBe(true);
      expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('complete');
      expect(readAgentModuleSnapshot_ACU(chat).hooks).toHaveLength(1);
      messages.length = 0;
      await runtime.run({ ...input, budget: { ...input.budget, maxExtraReads: 0 } });
      expect(messages[0].map(item => item.content).join('\n')).not.toContain('"action":"write_sql","status":"committed"');
    } finally { _set_SillyTavern_API_ACU(null as any); }
  });

  it('逐栏提交仅有部分栏目时最终空写集不能宣称合格，回报精确缺栏', async () => {
    const { vi } = await import('vitest');
    const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
    const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
    const input = input_ACU();
    const chat = input.resolveContext.chat;
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    const sql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)";
    const replies = [nativeToolTurn_ACU('write_sql', { sql }, 'call-partial-write'), finalReply_ACU];
    const runtime = new AgentSubagentRuntime_ACU({ resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async () => replies.shift() ?? finalReply_ACU });
    input.writeSql = ({ role, sql: statement, isCurrent }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql: statement, isCurrent });
    try {
      const result = await runtime.run(input);
      expect(saveChat).toHaveBeenCalledOnce();
      expect(result.completion).toBe('failed');
      expect(result.unresolvedIssues).toEqual(expect.arrayContaining([expect.objectContaining({ module: 'hooks', id: 'H1', path: 'hooks#H1.status' })]));
      expect(result.acceptedKeys).toContain('hooks:H1:summary');
    } finally { _set_SillyTavern_API_ACU(null as any); }
  });

  it('无效 write_sql 动作只回灌协议拒绝，修正后才进入生产保存', async () => {
    const { vi } = await import('vitest');
    const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
    const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
    const input = input_ACU();
    const chat = input.resolveContext.chat;
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    const sql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)";
    const replies = [nativeToolTurn_ACU('write_sql', { sql, extra: 'forbidden' }, 'call-invalid-write'),
      nativeToolTurn_ACU('write_sql', { sql }, 'call-valid-write'), finalReply_ACU];
    const sent: Array<readonly SentMessage_ACU[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
    });
    input.writeSql = ({ role, sql: statement, isCurrent }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql: statement, isCurrent });
    try {
      const result = await runtime.run(input);
      expect(result.iterations).toBe(3);
      expect(saveChat).toHaveBeenCalledOnce();
      expect(toolContent_ACU(sent[1], 'call-invalid-write')).toContain('工具动作未执行');
      expect(toolContent_ACU(sent[1], 'call-invalid-write')).not.toContain('"status":"committed"');
      expect(toolContent_ACU(sent[2], 'call-valid-write')).toContain('"status":"committed"');
    } finally { _set_SillyTavern_API_ACU(null as any); }
  });

  it('只有合法 ID 的栏目拒绝可给权威读取地址，不确定状态不提供旧地址', async () => {
    const input = input_ACU();
    const sql = "UPDATE hooks SET status = 'invalid' WHERE id = 'H1' AND expected_revision = 0";
    const replies = [nativeToolTurn_ACU('write_sql', { sql }, 'call-rejected-write'), finalReply_ACU];
    const sent: Array<readonly SentMessage_ACU[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({ resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; } });
    input.writeSql = async () => ({ status: 'rejected', accepted: [], rejected: [{ path: 'hooks#H1.status', reason: 'invalid status' },
      { path: 'sql[0].hooks.unknown', reason: 'invalid column' }, { path: 'host', reason: 'not an ID' }],
    partials: [], revisions: buildEmptyAgentModuleSnapshot_ACU().revisions, constraintProposals: [] });
    await runtime.run(input);
    expect(toolContent_ACU(sent[1], 'call-rejected-write')).toContain('"readAddresses":["$FIELD:hooks:H1"]');
    expect(toolContent_ACU(sent[1], 'call-rejected-write')).not.toContain('$FIELD:hooks:host');

    sent.length = 0;
    replies.push(nativeToolTurn_ACU('write_sql', { sql }, 'call-readback-write'), finalReply_ACU);
    input.writeSql = async () => ({ status: 'readback_failed', accepted: [], rejected: [{ path: 'hooks#H1.status', reason: 'readback' }],
      partials: null, revisions: null, constraintProposals: [], recovery: 'unavailable' });
    await runtime.run(input);
    expect(toolContent_ACU(sent[1], 'call-readback-write')).toContain('"readAddresses":[]');
  });

  it('提交端口抛出上下文失效时回执标明状态未知与剩余额度，不伪造权威缺栏', async () => {
    const input = input_ACU();
    const sql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)";
    input.writeSql = async () => { throw new Error('聊天锚点已变化'); };
    const replies = [nativeToolTurn_ACU('write_sql', { sql }, 'call-stale-write'), finalReply_ACU];
    const sent: Array<readonly SentMessage_ACU[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({ resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; } });
    const result = await runtime.run(input);
    const receipt = JSON.parse(toolContent_ACU(sent[1], 'call-stale-write').match(/\{.*"action":"write_sql".*\}/)?.[0] ?? '{}');
    expect(receipt).toMatchObject({ status: 'rejected', accepted: [], partials: null, revisions: null,
      readAddresses: [], remainingToolRounds: 1, remainingWriteRounds: 3 });
    expect(receipt.reason).toContain('聊天锚点已变化');
    expect(toolContent_ACU(sent[1], 'call-stale-write')).toContain('先 read 对应 $FIELD:模块:ID 权威帧');
    expect(result.usedFieldWrites).toBe(false);
  });

  it('损坏资料帧的字段读取显式失败且不缓存为已放行；修复后可重读', async () => {
    const { AGENT_MODULE_FIELD_ACU } = await import('../../../../src/service/continuation/agent/agent-model');
    const input = input_ACU();
    input.budget.maxExtraReads = 2;
    input.resolveContext.chat[1][AGENT_MODULE_FIELD_ACU] = { schemaVersion: 4, invalid: true };
    const replies = [
      nativeToolTurn_ACU('read', { reads: ['$FIELD:hooks:H1'] }, 'call-damaged-read-1'),
      nativeToolTurn_ACU('read', { reads: ['$FIELD:hooks:H1'] }, 'call-damaged-read-2'),
      finalReply_ACU,
    ];
    const sent: Array<readonly SentMessage_ACU[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        sent.push(messages);
        if (sent.length === 2) delete input.resolveContext.chat[1][AGENT_MODULE_FIELD_ACU];
        return replies.shift() ?? finalReply_ACU;
      },
    });
    await runtime.run(input);
    expect(toolContent_ACU(sent[1], 'call-damaged-read-1')).toContain('"status":"failed"');
    expect(toolContent_ACU(sent[1], 'call-damaged-read-1')).toContain('资料帧校验失败');
    expect(toolContent_ACU(sent[2], 'call-damaged-read-2')).toContain('"status":"unwritten"');
    expect(toolContent_ACU(sent[2], 'call-damaged-read-2')).not.toContain('已放行');
    expect(sent[2].some(message => message.content.includes('"summary"'))).toBe(true);
  });

  it('损坏资料帧的派工种子读取立即失败，不发送模型请求', async () => {
    const { AGENT_MODULE_FIELD_ACU } = await import('../../../../src/service/continuation/agent/agent-model');
    const input = input_ACU();
    input.delegation.reads = ['$FIELD:hooks:H1'];
    input.resolveContext.chat[1][AGENT_MODULE_FIELD_ACU] = { schemaVersion: 4, invalid: true };
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async () => { throw new Error('不得发送'); },
    });
    await expect(runtime.run(input)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SUBAGENT_FAILED' } });
  });

  it('补偿失败回执不提供过时缺栏，下次派工不继承失败历史', async () => {
    const { vi } = await import('vitest');
    const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
    const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
    const input = input_ACU();
    const chat = input.resolveContext.chat;
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockRejectedValueOnce(new Error('rollback failed'));
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    input.writeSql = ({ role, sql, isCurrent }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql, isCurrent });
    const replies = [nativeToolTurn_ACU('write_sql', { sql: "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)" }, 'call-recovery-write'), finalReply_ACU];
    const messages: Array<readonly { role: string; content: string }[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({ resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => { messages.push(value); return replies.shift() ?? finalReply_ACU; } });
    try {
      await runtime.run(input);
      const feedback = messages[1].find(message => message.role === 'tool' && message.tool_call_id === 'call-recovery-write')?.content ?? '';
      expect(feedback).toContain('"recovery":"failed"');
      expect(feedback).toContain('"partials":null');
      expect(feedback).toContain('"revisions":null');
      expect(feedback).toContain('"readAddresses":[]');
      expect(feedback).toContain('保存或恢复状态不确定');
      expect(feedback).not.toContain('仅补缺栏范例：UPDATE');
      messages.length = 0;
      await runtime.run({ ...input, writeSql: undefined });
      expect(messages[0].some(message => message.content.includes('"recovery":"failed"'))).toBe(false);
    } finally { _set_SillyTavern_API_ACU(null as any); }
  });

  it('拒绝或保存失败不标记已提交，回执只留本次会话', async () => {
    const { vi } = await import('vitest');
    const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
    const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
    const input = input_ACU();
    input.budget.maxExtraReads = 2;
    const chat = input.resolveContext.chat;
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    input.writeSql = ({ role, sql }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql });
    const sql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)";
    const replies = [nativeToolTurn_ACU('write_sql', { sql }, 'call-persist-failed-1'), nativeToolTurn_ACU('write_sql', { sql }, 'call-persist-failed-2'), finalReply_ACU];
    const messages: Array<readonly { role: string; content: string }[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => { messages.push(value); return replies.shift() ?? finalReply_ACU; },
    });
    try {
      const result = await runtime.run(input);
      expect(result.usedFieldWrites).toBe(true);
      const failed = messages[1].map(item => item.content).join('\n');
      expect(failed).toContain('"status":"persist_failed"');
      expect(failed).toContain('"accepted":[]');
      expect(failed).toContain('"recovery":"saved"');
      const accepted = messages[2].map(item => item.content).join('\n');
      expect(accepted).toContain('"status":"committed"');
      expect(accepted).toContain('"field":"summary","revision":1');
    } finally { _set_SillyTavern_API_ACU(null as any); }
  });

  it('契约 SQL 先按栏目写入，缺栏只要求补写，不把新行收成 patch', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    const seen: string[] = [];
    input.writeSql = async ({ sql }) => {
      seen.push(sql);
      if (seen.length === 1) {
        return {
          status: 'committed',
          accepted: [{ module: 'storyArc', id: 'VOL-01', field: 'title', revision: 1 }],
          rejected: [{ path: 'storyArc#VOL-01.sustainingThreads', reason: '必须是非空字符串数组' }],
          partials: [{ module: 'storyArc', id: 'VOL-01', missingFields: ['withheld'] }],
          revisions: input.resolveContext.moduleSnapshot.revisions,
          constraintProposals: [],
        } as any;
      }
      return {
        status: 'committed', accepted: [{ module: 'storyArc', id: 'VOL-01', field: 'withheld', revision: 2 }],
        rejected: [], partials: [], revisions: input.resolveContext.moduleSnapshot.revisions, constraintProposals: [],
      } as any;
    };
    const messages: Array<readonly { role: string; content: string }[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => {
        messages.push(value);
        return messages.length === 1
          ? nativeToolTurn_ACU('write_sql', { sql: "INSERT INTO story_arc (id, scope, title, direction, escalation, status, expected_revision, sustaining_threads) VALUES ('VOL-01', 'volume', '入府', '进入明府', '身份落下', 'active', 0, '一句经营线')" }, 'call-volume-insert')
          : messages.length === 2
            ? nativeToolTurn_ACU('write_sql', { sql: "UPDATE story_arc SET withheld = '名器未激活' WHERE id = 'VOL-01' AND expected_revision = 0" }, 'call-volume-repair')
            : finalReply_ACU;
      },
    });
    const result = await runtime.run(input);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('INSERT INTO story_arc');
    expect(seen[1]).toContain('UPDATE story_arc');
    const follow = messages[1].map(item => item.content).join('\n');
    expect(follow).toContain('调用 write_sql');
    expect(follow).toContain('sustainingThreads');
    expect(follow).toContain('withheld');
    expect(follow).toContain("仅补缺栏范例：UPDATE story_arc SET withheld = '晶屑真正用途' WHERE id = 'VOL-01' AND expected_revision = 0;");
    expect(follow).not.toContain('UPDATE story_arc SET title =');
    expect(follow).not.toContain('纠错范例：INSERT INTO story_arc');
    expect(follow).not.toContain('delta 里各数组');
    expect(result.usedFieldWrites).toBe(true);
  });

  it('总纲空交付改为要求一条 SQL，不再索要 delta.storyArc', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    const seen: string[] = [];
    input.writeSql = async ({ sql }) => {
      seen.push(sql);
      return {
        status: 'committed',
        accepted: [{ module: 'storyArc', id: 'STORY-01', field: 'title', revision: 1 }],
        rejected: [],
        partials: [],
        revisions: input.resolveContext.moduleSnapshot.revisions,
        constraintProposals: [],
      } as any;
    };
    const messages: Array<readonly { role: string; content: string }[]> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => {
        messages.push(value);
        return messages.length === 1
          ? '{"summary":"资料已充分，直接交付总纲契约"}'
          : messages.length === 2
            ? nativeToolTurn_ACU('write_sql', { sql: "INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('STORY-01', 'story', '题', '方向', '台阶', '底牌', 'active', 0)" }, 'call-arc-bootstrap')
            : finalReply_ACU;
      },
    });
    const result = await runtime.run(input);
    const follow = messages[1].map(item => item.content).join('\n');
    expect(follow).toContain('调用 write_sql');
    expect(follow).toContain('["经营线"]');
    expect(follow).toContain('新行 INSERT 的 expected_revision 固定写 0');
    expect(follow).not.toContain('delta.storyArc');
    expect(seen).toEqual(["INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('STORY-01', 'story', '题', '方向', '台阶', '底牌', 'active', 0)"]);
    expect(result.usedFieldWrites).toBe(true);
  });
});

it('原生批量调阅按各项地址去重，保留细读正文中的连续空行与伪标题', () => {
  const full = '### 总纲（$STORY_ARC）\n总纲全文';
  const detail = '### 本卷（$STORY_ARC:VOL-01）\n第一段\n\n\n### 伪标题（$STORY_ARC）\n仍属正文\n\n';
  const joined = `${full}\n\n${detail}`;
  const appendix = renderMainSessionReadAppendix_ACU([
    { id: 1, kind: 'tool', text: joined, digest: 'read', readSpans: [
      { key: '$STORY_ARC', start: 0, length: full.length },
      { key: '$STORY_ARC:VOL-01', start: full.length + 2, length: detail.length },
    ] },
  ] as any);
  const filtered = omitSnapshotSectionsForSubagent_ACU(`【故事总纲状态】\n状态\n\n${appendix}`, new Set(['$STORY_ARC']));
  expect(filtered).not.toContain('总纲全文');
  expect(filtered).not.toContain('【故事总纲状态】');
  expect(filtered).toContain(detail);
  expect(filtered).toContain('【调阅项 "$STORY_ARC:VOL-01"');
  expect(filtered).not.toContain('【调阅项 "$STORY_ARC"');
});
