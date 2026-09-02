import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContinuationAgentTurnPlanner_ACU, evaluateArcArchitectDispatch_ACU, renderAgentBudget_ACU } from '../../../../src/service/continuation/agent/agent-main-loop';
import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { appendAgentConversation_ACU, buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';
import { buildEmptyAgentWorldbookSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, type ContinuationInternalAiRequestIdentity_ACU } from '../../../../src/service/continuation/model';
import { readAgentSessionLog_ACU, resetAgentSessionLogForTests_ACU } from '../../../../src/service/continuation/agent/agent-session-log';
import { readAgentRunState_ACU, resetAgentRunCacheForTests_ACU } from '../../../../src/service/continuation/agent/agent-run-cache';
import type { AgentConversationCompactionMark_ACU, AgentConversationCompactionMarkV2_ACU, AgentConversationMessage_ACU, AgentConversationSnapshot_ACU, AgentModuleSnapshot_ACU, AgentOutlineOpResult_ACU, AgentRunBudget_ACU, ContinuationAgentTurnPlanRequest_ACU } from '../../../../src/service/continuation/agent/agent-model';

const preset_ACU = { presetName: 'p1', source: 'settings' as const, reason: 'test' };

beforeEach(() => { resetAgentSessionLogForTests_ACU(); resetAgentRunCacheForTests_ACU(); });

const chat_ACU = () => ([
  { mes: '我要进禁区', is_user: true },
  { mes: '主角推开铁门。', is_user: false },
  { mes: '继续', is_user: true },
  { mes: '守门人挡在门后，右手藏着黑色晶屑。', is_user: false },
]);

const preOutlineContext_ACU = () => ({
  envelope: {} as any,
  task: { taskId: 'task-1', originInstruction: '推进主角进入禁区', stages: [] } as any,
  stage: null,
  revision: null,
  node: null,
  turn: null,
  turnNumber: null,
  nodeTurnNumber: null,
});

const execution_ACU = () => ({
  envelope: {} as any,
  task: { taskId: 'task-1', originInstruction: '推进主角进入禁区', stages: [{ stageId: 'stage-1', stageNumber: 2, status: 'running' }] } as any,
  stage: { stageId: 'stage-1', stageNumber: 2, status: 'running' } as any,
  revision: { outline: { title: '禁区试探', goal: '进入禁区', totalTurns: 6 } } as any,
  node: { id: 'node-1', title: '试探守门人', goal: '试探而不揭穿', turns: [{ id: 'turn-1', goal: '推门' }, { id: 'turn-2', goal: '试探' }] } as any,
  turn: { id: 'turn-2', goal: '试探' } as any,
  turnNumber: 2,
  nodeTurnNumber: 2,
});

/** 游标已经推进到下一轮：用来构造「上一轮已结束」的轮次边界。 */
const nextTurnContext_ACU = () => {
  const base = execution_ACU();
  base.node.turns = [...base.node.turns, { id: 'turn-3', goal: '收网' }];
  return { ...base, turn: { id: 'turn-3', goal: '收网' } as any, turnNumber: 3, nodeTurnNumber: 3 };
};

/** 已立总纲的快照：outline-architect 的派工门禁要求总纲非空，绝大多数用例都处于这个常态。 */
const snapshotWithArc_ACU = (): AgentModuleSnapshot_ACU => {
  const snapshot = buildEmptyAgentModuleSnapshot_ACU();
  snapshot.storyArc = [
    { id: 'A1', scope: 'story', title: '禁区真相', direction: '主角查明禁区吞人的真相', escalation: '从个人求生抬到与守门人体系对抗', withheld: '守门人是主角失踪的兄长', status: 'active', stageNumbers: [1], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' },
    { id: 'A2', scope: 'volume', title: '第一卷·试探', direction: '摸清禁区门禁规则', escalation: '收在主角第一次被守门人识破', withheld: '晶屑的真实来源', status: 'active', stageNumbers: [1, 2], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' },
  ];
  snapshot.revisions.storyArc = 1;
  return snapshot;
};

/**
 * 只统计「守门人」出现次数的确定性计数器（每次出现记 2 tokens）。
 * 阈值口径是完整上下文（提示词骨架也计入），预算用例若走真实估算会依赖默认提示词的长度，
 * 提示词一改测试就碎；用它把开销钉在近似 0，只让填充词决定总量。
 */
const fillerTokens_ACU = async (text: string): Promise<number> => (text.match(/守门人/g)?.length ?? 0) * 2;

/**
 * 构造一份超出预算的两轮会话：turn-1 是可丢弃的旧轮次，turn-2 是最后通告的轮次。
 * 最近一轮永远完整保留，所以必须有两个轮次分组才谈得上压缩。
 */
const overBudgetConversation_ACU = (filler: string): AgentConversationSnapshot_ACU => appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
  { kind: 'turn', text: '开始新的一轮规划：第 1 阶段 · 第 1/6 轮', digest: '第 1 阶段 · 第 1/6 轮', turnKey: 'stage-1#0#turn-1' },
  { kind: 'agent', text: filler, digest: '交付写作指导', turnKey: 'stage-1#0#turn-1' },
  { kind: 'turn', text: '开始新的一轮规划：第 2 阶段 · 第 2/6 轮', digest: '第 2 阶段 · 第 2/6 轮', turnKey: 'stage-1#0#turn-2' },
]);

interface Harness_ACU {
  planner: ContinuationAgentTurnPlanner_ACU;
  request: ContinuationAgentTurnPlanRequest_ACU;
  mainCalls: Array<Array<{ role: string; content: string }>>;
  handoffCalls: Array<Array<{ role: string; content: string }>>;
  subCalls: Array<Array<{ role: string; content: string }>>;
  written: Array<{ index: number; snapshot: AgentModuleSnapshot_ACU }>;
  outlineCalls: string[];
  presetRoles: string[];
  setContext: (factory: () => any) => void;
  /** 当前内存态的持久会话，用来断言迭代输出与工具结果是否被真的记进会话。 */
  conversation: () => AgentConversationSnapshot_ACU;
  conversationWrites: AgentConversationSnapshot_ACU[];
}

function harness_ACU(options: {
  mainReplies: string[];
  subReplies?: string[];
  handoffReplies?: string[];
  compactionWrite?: 'success' | 'false' | 'throw';
  mutatePersistedCompactionMark?: (mark: AgentConversationCompactionMarkV2_ACU) => AgentConversationCompactionMark_ACU | null;
  budget?: Partial<AgentRunBudget_ACU>;
  snapshot?: AgentModuleSnapshot_ACU;
  isCurrent?: (identity: ContinuationInternalAiRequestIdentity_ACU) => boolean;
  context?: () => any;
  worldbook?: any;
  applyOutline?: (instruction: string) => Promise<AgentOutlineOpResult_ACU> | AgentOutlineOpResult_ACU;
  withoutApplyOutline?: boolean;
  conversation?: AgentConversationSnapshot_ACU;
  historyTokenBudget?: number;
  countTokens?: (text: string) => Promise<number>;
  apiPresetMode?: 'current' | 'fixed';
  agentApiPresets?: Partial<Record<'main' | 'outline' | 'maintainer' | 'mainlinePlanner' | 'beatPlanner' | 'reviewer' | 'finalReviewer', { mode: 'inherit' | 'current' | 'fixed'; presetName: string }>>;
  taskId?: string;
}): Harness_ACU {
  const mainReplies = [...options.mainReplies];
  const subReplies = [...(options.subReplies ?? [])];
  const handoffReplies = [...(options.handoffReplies ?? [])];
  const mainCalls: Array<Array<{ role: string; content: string }>> = [];
  const handoffCalls: Array<Array<{ role: string; content: string }>> = [];
  const subCalls: Array<Array<{ role: string; content: string }>> = [];
  const written: Array<{ index: number; snapshot: AgentModuleSnapshot_ACU }> = [];
  const outlineCalls: string[] = [];
  const presetRoles: string[] = [];
  const chat = chat_ACU();
  let snapshot = options.snapshot ?? snapshotWithArc_ACU();
  let conversation = options.conversation ?? buildEmptyAgentConversation_ACU();
  let persistedCompactionMark: AgentConversationCompactionMark_ACU | null = null;
  const conversationWrites: AgentConversationSnapshot_ACU[] = [];
  let contextFactory = options.context ?? execution_ACU;

  const subagentRuntime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    resolveAgentApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { subCalls.push(messages); return subReplies.shift() ?? '{"summary":"空","recommendation":"随便推进"}'; },
  });

  const planner = new ContinuationAgentTurnPlanner_ACU({
    resolveApiPreset: ((_settings: unknown, role: string) => { presetRoles.push(role); return preset_ACU; }) as any,
    callInternalAi: async (messages, _preset, identity) => {
      if (identity.source === 'handoff_summary') {
        handoffCalls.push(messages);
        return handoffReplies.shift() ?? null;
      }
      mainCalls.push(messages);
      return mainReplies.shift() ?? '{"action":"block","reason":"脚本没有更多回复"}';
    },
    subagentRuntime,
    readChat: () => chat,
    readModuleSnapshot: () => snapshot,
    writeModuleSnapshot: async (_chat, index, next) => { written.push({ index, snapshot: next }); snapshot = next; },
    readConversation: () => conversation,
    // 分段落盘的内存替身：把新消息接到会话尾部，与真实实现同样按 id 去重。
    appendConversationMessages: async (_chat, prepared: readonly AgentConversationMessage_ACU[]) => {
      const existing = new Set(conversation.messages.map(message => message.id));
      const fresh = prepared.filter(message => !existing.has(message.id));
      if (!fresh.length) return false;
      const highest = fresh.reduce((max, message) => Math.max(max, message.id), conversation.nextId - 1);
      conversation = { ...conversation, nextId: highest + 1, messages: [...conversation.messages, ...fresh] };
      conversationWrites.push(conversation);
      return true;
    },
    readCompactionMark: () => persistedCompactionMark,
    // 压缩标记的内存替身：保存权威 V2 mark，并应用与 readAgentConversation_ACU 相同的投影。
    writeCompactionMark: async (_chat, mark) => {
      if (options.compactionWrite === 'throw') throw new Error('simulated compaction write failure');
      if (options.compactionWrite === 'false') return false;
      persistedCompactionMark = options.mutatePersistedCompactionMark?.(mark as AgentConversationCompactionMarkV2_ACU) ?? mark;
      const handoff: AgentConversationMessage_ACU = { id: mark.compactedThroughId, kind: 'handoff', text: mark.report, digest: '早期会话交接报告', turnKey: '', at: mark.at };
      conversation = { ...conversation, messages: [handoff, ...conversation.messages.filter(message => message.id > mark.compactedThroughId)] };
      conversationWrites.push(conversation);
      return true;
    },
    loadWorldbook: async () => options.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(true),
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1, ...options.budget },
    countTokens: options.countTokens,
  });

  const settings = buildDefaultContinuationSettings_ACU();
  settings.internalAiRetryLimit = 1;
  // 运行预算已开放为 UI 设置，规划器以 settings.agentRunBudget 为准；测试注入的预算同步到这里。
  settings.agentRunBudget = { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1, ...options.budget };
  settings.apiPresetMode = options.apiPresetMode ?? 'fixed';
  settings.fixedApiPresetName = 'p1';
  if (options.historyTokenBudget !== undefined) settings.agentHistoryTokenBudget = options.historyTokenBudget;
  if (options.agentApiPresets) settings.agentApiPresets = { ...settings.agentApiPresets, ...options.agentApiPresets };

  const request: ContinuationAgentTurnPlanRequest_ACU = {
    settings,
    readContext: () => contextFactory(),
    createInternalRequestIdentity: attempt => ({ taskId: options.taskId ?? 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `a-${attempt}`, source: 'turn_instruction' }) as any,
    isInternalRequestCurrent: options.isCurrent ?? (() => true),
    applyOutline: options.withoutApplyOutline
      ? undefined
      : async instruction => {
          outlineCalls.push(instruction);
          const handler = options.applyOutline ?? (() => ({ op: 'revise' as const, requiresReview: false, stopped: null, summary: '已改写大纲' }));
          return handler(instruction);
        },
  };

  return {
    planner,
    request,
    mainCalls,
    handoffCalls,
    subCalls,
    written,
    outlineCalls,
    presetRoles,
    setContext: factory => { contextFactory = factory; },
    conversation: () => conversation,
    conversationWrites,
  };
}

function lastMessage_ACU(messages: Array<{ role: string; content: string }>): { role: string; content: string } {
  return messages[messages.length - 1];
}

function findIndex_ACU(messages: Array<{ role: string; content: string }>, needle: string): number {
  return messages.findIndex(message => message.content.includes(needle));
}

describe('小说正文目录', () => {
  it('$STORY_CATALOG 只收录 AI 楼层，用户楼层不进上下文；尾部楼层直接带全文', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"本轮指导"}'] });
    await h.planner.plan(h.request);

    const joined = h.mainCalls[0].map(message => message.content).join('\n');
    // 默认尾部全文楼数为 2，两个 AI 楼层都落在尾部全文里。
    expect(joined).toContain('主角推开铁门。');
    expect(joined).toContain('守门人挡在门后，右手藏着黑色晶屑。');
    // 用户在酒馆里输入的楼层不是小说正文，不该被当成上下文喂回去。
    expect(joined).not.toContain('我要进禁区');
    expect(joined).not.toContain('【楼层 2】');
  });
});

describe('主 Agent 会话记录', () => {
  it('换轮通告、迭代原始输出与工具结果按真实 role 累积落库，下一次迭代读得到', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","thought":"先要主线","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"按主线要点写"}',
      ],
      subReplies: ['{"summary":"主线要点","recommendation":"先试探"}'],
    });
    await h.planner.plan(h.request);

    const kinds = h.conversation().messages.map(message => message.kind);
    expect(kinds).toEqual(['turn', 'runtime', 'agent', 'tool', 'runtime', 'agent']);
    const [announcement, firstSnapshot, firstAction, toolResult] = h.conversation().messages;
    expect(firstSnapshot.kind).toBe('runtime');
    expect(firstSnapshot.text).toContain('本轮预算状态');
    expect(announcement.text).toContain('开始新的一轮规划：第 2 阶段 · 第 2/6 轮');
    expect(firstAction.digest).toBe('派工 1 项');
    expect(firstAction.text).toContain('mainline-planner');
    expect(toolResult.text).toContain('主线要点');
    // 每条消息都带上本轮游标，压缩时才能按轮次成组丢弃。
    expect(new Set(h.conversation().messages.map(message => message.turnKey))).toEqual(new Set([h.conversation().messages[0].turnKey]));
    expect(h.conversation().messages[0].turnKey).toBe('stage-1#0#turn-2');
    expect(h.conversationWrites.length).toBeGreaterThan(0);

    // 第二次迭代看到的是自己上一次的原始输出（assistant）与回灌的工具结果（user）。
    const second = h.mainCalls[1];
    const actionIndex = findIndex_ACU(second, '"agentName":"mainline-planner"');
    expect(second[actionIndex].role).toBe('assistant');
    const toolIndex = findIndex_ACU(second, '【工具结果】');
    expect(second[toolIndex].role).toBe('user');
    expect(toolIndex).toBeGreaterThan(actionIndex);
  });

  it('已有会话在同一轮内恢复时不重复通告，用户消息排在换轮通告之前', async () => {
    const conversation = appendAgentConversation_ACU(buildEmptyAgentConversation_ACU(), [
      { kind: 'user', text: '这一轮别急着揭穿守门人', digest: '你的消息', turnKey: '' },
      { kind: 'turn', text: '开始新的一轮规划：第 2 阶段 · 第 2/6 轮', digest: '第 2 阶段 · 第 2/6 轮', turnKey: 'stage-1#0#turn-2' },
    ]);
    const h = harness_ACU({ conversation, mainReplies: ['{"action":"finalize","instruction":"依旧含糊其辞"}'] });
    await h.planner.plan(h.request);

    expect(h.conversation().messages.filter(message => message.kind === 'turn')).toHaveLength(1);
    const first = h.mainCalls[0];
    const userIndex = findIndex_ACU(first, '这一轮别急着揭穿守门人');
    expect(first[userIndex].role).toBe('user');
    expect(first[userIndex].content.startsWith('【用户】')).toBe(true);
    // 运行时快照追加在会话尾部，用户消息仍按发生顺序排在换轮通告之前。
    expect(userIndex).toBeLessThan(findIndex_ACU(first, '本轮预算状态'));
    expect(userIndex).toBeLessThan(findIndex_ACU(first, '开始新的一轮规划'));
  });

  it('新一轮开始时把超出预算的早期轮次浓缩成交接报告', async () => {
    const filler = '守门人'.repeat(400);
    // 会话最后通告的是 turn-2，本次运行的游标是 turn-3：上一轮已结束，正处在轮次边界。
    const h = harness_ACU({
      conversation: overBudgetConversation_ACU(filler),
      historyTokenBudget: 200,
      countTokens: fillerTokens_ACU,
      mainReplies: ['{"action":"finalize","instruction":"接着写"}'],
      context: nextTurnContext_ACU,
    });
    await expect(h.planner.plan(h.request)).resolves.toMatchObject({ instruction: '接着写' });
    expect(h.mainCalls).toHaveLength(1);

    const messages = h.conversation().messages;
    expect(messages[0].kind).toBe('handoff');
    expect(h.handoffCalls).toHaveLength(2);
    expect(messages[0].text).toContain('第 1 阶段 · 第 1/6 轮');
    expect(messages[0].text).toContain('交付写作指导');
    expect(messages.some(message => message.text === filler)).toBe(false);
    // 刚结束的那一轮完整保留，主 Agent 不会忘记自己从哪儿接上。
    expect(messages.some(message => message.kind === 'turn' && message.turnKey === 'stage-1#0#turn-2')).toBe(true);
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('会话历史已压缩'))).toBe(true);
    // 交接报告正文作为独立条目插进会话流，用户在界面上直接看到 AI 可见性边界。
    const handoffEntry = readAgentSessionLog_ACU().find(entry => entry.kind === 'handoff');
    expect(handoffEntry?.title).toContain('此前内容对当前 AI 不可见');
    expect(handoffEntry?.detail).toBe(messages[0].text);
    expect(h.handoffCalls).toHaveLength(2);
  });

  it('同一轮内到达阈值只登记不压缩，留到下一轮开始时再做', async () => {
    const filler = '守门人'.repeat(400);
    // 最后通告的就是本次运行的游标 turn-2：这一轮还没走完（中断恢复或同游标重跑）。
    // 填充词计数下总量约 800 tokens（加上正文里的零星出现），预算取 600：超出但没到两倍，
    // 因此走登记而非越界压缩。
    const h = harness_ACU({
      conversation: overBudgetConversation_ACU(filler),
      historyTokenBudget: 600,
      countTokens: fillerTokens_ACU,
      mainReplies: ['{"action":"finalize","instruction":"接着写"}'],
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SNAPSHOT_INVALID' } });
    expect(h.mainCalls).toHaveLength(0);

    const messages = h.conversation().messages;
    // 历史没有被重塑：既没有交接报告，早期消息也仍在原处。
    expect(messages.some(message => message.kind === 'handoff')).toBe(false);
    expect(messages.some(message => message.text === filler)).toBe(true);
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('会话历史已压缩'))).toBe(false);
    // 阈值到了要如实告诉用户，只是执行时机推迟。
    const deferred = readAgentSessionLog_ACU().find(entry => entry.title.includes('已到 token 阈值'));
    expect(deferred?.detail).toContain('下一轮开始前');

    // 同一份会话在游标推进到 turn-3 后再跑，这时才真正压缩。
    const next = harness_ACU({
      conversation: h.conversation(),
      historyTokenBudget: 600,
      countTokens: fillerTokens_ACU,
      mainReplies: ['{"action":"finalize","instruction":"下一轮"}'],
      context: nextTurnContext_ACU,
    });
    await next.planner.plan(next.request);
    expect(next.conversation().messages[0].kind).toBe('handoff');
    expect(next.conversation().messages.some(message => message.text === filler)).toBe(false);
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('会话历史已压缩'))).toBe(true);
  });

  it('同一轮内历史涨到预算两倍时提前压缩，避免请求因超长必然失败', async () => {
    const h = harness_ACU({
      conversation: overBudgetConversation_ACU('守门人'.repeat(4000)),
      historyTokenBudget: 200,
      countTokens: fillerTokens_ACU,
      mainReplies: ['{"action":"finalize","instruction":"接着写"}'],
    });
    await expect(h.planner.plan(h.request)).resolves.toMatchObject({ instruction: '接着写' });
    expect(h.mainCalls).toHaveLength(1);

    expect(h.conversation().messages[0].kind).toBe('handoff');
    expect(h.handoffCalls).toHaveLength(2);
    const compacted = readAgentSessionLog_ACU().find(entry => entry.title.includes('会话历史已压缩'));
    // 越界压缩必须自报原因，不能让用户以为轮次边界规则失效了。
    expect(compacted?.detail).toContain('本轮尚未结束');
  });

  it('阈值统计的是实际读取的完整上下文：提示词骨架也计入，会话很小时同样触发压缩', async () => {
    const snapshot = overBudgetConversation_ACU('这一轮只有寥寥数语');
    const known = new Set(snapshot.messages.map(message => message.text));
    // 会话消息每条记 1 token，其余文本（即渲染出的提示词骨架）按长度计——骨架远超阈值 50。
    const h = harness_ACU({
      conversation: snapshot,
      historyTokenBudget: 50,
      countTokens: async text => (known.has(text) ? 1 : Math.ceil(text.length / 10)),
      mainReplies: ['{"action":"finalize","instruction":"接着写"}'],
      context: nextTurnContext_ACU,
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SNAPSHOT_INVALID' } });
    expect(h.mainCalls).toHaveLength(0);

    // 会话本身只有 3 tokens，交接报告会更大；压缩无进展时必须保留旧投影，
    // 由最终完整请求预检阻断，而不是伪造一份更长的 handoff。
    expect(h.conversation().messages[0].kind).toBe('turn');
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('会话历史已压缩'))).toBe(false);
  });

  it.each([
    ['写入返回 false', { compactionWrite: 'false' as const }],
    ['写入抛出异常', { compactionWrite: 'throw' as const }],
    ['回读报告与候选不一致', { mutatePersistedCompactionMark: (mark: AgentConversationCompactionMarkV2_ACU) => ({ ...mark, report: '被篡改的交接报告' }) }],
  ])('压缩%s时保留旧会话投影并阻断超限主请求', async (_label, overrides) => {
    const filler = '守门人'.repeat(400);
    const h = harness_ACU({
      conversation: overBudgetConversation_ACU(filler),
      historyTokenBudget: 200,
      countTokens: fillerTokens_ACU,
      mainReplies: ['{"action":"finalize","instruction":"不应发送"}'],
      context: nextTurnContext_ACU,
      ...overrides,
    });

    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SNAPSHOT_INVALID' } });

    expect(h.mainCalls).toHaveLength(0);
    expect(h.conversation().messages.some(message => message.kind === 'handoff')).toBe(overrides.compactionWrite !== 'false' && overrides.compactionWrite !== 'throw');
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('会话历史已压缩'))).toBe(false);
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('会话历史压缩未提交'))).toBe(true);
  });
});

describe('主 Agent read/search 工具批次', () => {
  it('调阅结果作为带 readKey 的工具消息回灌，重复调阅只回提示不重注内容', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"read","reads":["$HOOKS_LEDGER"]}',
        '{"action":"read","reads":["$HOOKS_LEDGER"]}',
        '{"action":"finalize","instruction":"查完了"}',
      ],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('查完了');

    const toolMessages = h.conversation().messages.filter(message => message.kind === 'tool');
    expect(toolMessages[0].readKey).toBe('$HOOKS_LEDGER');
    expect(toolMessages[0].text).toContain('伏笔账本');
    expect(toolMessages[1].text).toContain('不再重注');
    expect(toolMessages.every(message => !message.text.includes('最新快照'))).toBe(true);
    // 第二次迭代读到第一次的调阅内容。
    expect(h.mainCalls[1].some(message => message.content.includes('伏笔账本'))).toBe(true);
  });

  it('资料变化后重读同一地址时，只在新工具消息自身标记最新快照', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"read","reads":["$OUTLINE_WINDOW"]}',
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"将当前轮目标调整为守门人先露破绽"}]}',
        '{"action":"read","reads":["$OUTLINE_WINDOW"]}',
        '{"action":"finalize","instruction":"按最新快照写"}',
      ],
      applyOutline: () => ({ op: 'revise', requiresReview: false, stopped: null, summary: '大纲已由架构师维护' }),
    });

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按最新快照写');

    const reads = h.conversation().messages.filter(
      message => message.kind === 'tool' && message.readKey === '$OUTLINE_WINDOW',
    );
    expect(reads).toHaveLength(2);
    expect(reads[0].text).not.toContain('最新快照');
    expect(reads[1].text).toContain('最新快照');
  });

  it('工具批次超过 maxReads 上限时回灌用尽提示，不再执行读取', async () => {
    const h = harness_ACU({
      budget: { maxReads: 1 },
      mainReplies: [
        '{"action":"read","reads":["$HOOKS_LEDGER"]}',
        '{"action":"read","reads":["$INFO_GAP"]}',
        '{"action":"finalize","instruction":"停止调阅"}',
      ],
    });
    await h.planner.plan(h.request);
    expect(h.mainCalls[2].map(message => message.content).join('\n')).toContain('工具批次已用尽');
  });

  it('读取批次被门禁打回时回灌结构化报告，循环不中断', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"read","reads":["$HISTORY_UNSETTLED"]}',
        '{"action":"finalize","instruction":"不读了"}',
      ],
    });
    (h.request.settings as any).agentReadTokenBudget = 1;
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('不读了');
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('读取被门禁打回');
    expect(feedback).toContain('修正协议');
  });
});

describe('预算渲染', () => {
  const budget_ACU: AgentRunBudget_ACU = { maxIterations: 3, maxDelegations: 6, maxSameAgent: 2, maxConcurrent: 3, maxReads: 8, maxExtraReads: 1 };

  it('最后一轮明确宣告 FINAL_ITERATION 并禁用派工', () => {
    const ledger = { delegationsUsed: 2, perAgent: new Map(), outcomes: [] };
    expect(renderAgentBudget_ACU(budget_ACU, 3, ledger as any, 3)).toContain('FINAL_ITERATION');
    expect(renderAgentBudget_ACU(budget_ACU, 1, ledger as any, 3)).toContain('预算充足');
  });

  it('传入工具用量时同步报出批次与累计放行 token', () => {
    const ledger = { delegationsUsed: 0, perAgent: new Map(), outcomes: [] };
    const text = renderAgentBudget_ACU(budget_ACU, 1, ledger as any, 3, { batchesUsed: 2, grantedTokens: 1200, maxReadTokens: 36000 });
    expect(text).toContain('已用 2 / 8 个工具批次');
    expect(text).toContain('1200 / 36000 tokens');
  });
});

describe('主 Agent 提示词装配', () => {
  it('小说正文在前、自己的会话记录在锚点位置、运行时快照落在历史里、预填充收尾', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"本轮指导"}'] });
    await h.planner.plan(h.request);

    const messages = h.mainCalls[0];
    const storyIndex = findIndex_ACU(messages, '已经发生的小说正文');
    const runtimeIndex = findIndex_ACU(messages, '本轮预算状态');
    const historyIndex = findIndex_ACU(messages, '开始新的一轮规划');
    expect(messages[0].role).toBe('system');
    expect(storyIndex).toBeGreaterThan(0);
    expect(historyIndex).toBeGreaterThan(storyIndex);
    // 运行时快照是会话消息：排在历史通告之后、预填充之前，骨架本身不再重算这段。
    expect(runtimeIndex).toBeGreaterThan(historyIndex);
    expect(messages[runtimeIndex].content).toContain('【完整当前阶段大纲】');
    expect(messages[runtimeIndex].content).toContain('阶段 2：禁区试探');
    expect(messages[runtimeIndex].content).toContain('大纲是计划，不是已经发生的事实');
    expect(messages[runtimeIndex].content.startsWith('【运行时快照】')).toBe(true);
    expect(lastMessage_ACU(messages).role).toBe('assistant');
    expect(lastMessage_ACU(messages).content.endsWith('"thought": "')).toBe(true);
    expect(messages.some(message => message.content.includes('$HISTORY_ANCHOR'))).toBe(false);
  });

  it('相邻迭代只追加不改写已发出的前缀', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"read","reads":["$OUTLINE_WINDOW"]}',
        '{"action":"finalize","instruction":"本轮指导"}',
      ],
    });
    await h.planner.plan(h.request);
    expect(h.mainCalls.length).toBeGreaterThanOrEqual(2);
    const first = h.mainCalls[0];
    const second = h.mainCalls[1];
    const firstPrefix = first.slice(0, -1);
    expect(second.slice(0, firstPrefix.length)).toEqual(firstPrefix);
    expect(second.filter(message => message.content.includes('【本回合运行时数据】')).length).toBeGreaterThanOrEqual(2);
  });

  it('运行时证据带上未结算区间、子代理目录与资料模块目录', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"本轮指导"}'] });
    await h.planner.plan(h.request);

    const runtime = h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content;
    expect(runtime).toContain('未结算楼层区间：0 到 3');
    expect(runtime).toContain('hook-cognition-maintainer');
    expect(runtime).toContain('$HOOKS_LEDGER');
    // 区间只报范围不带正文：正文已由 $STORY_TEXT 独立摘取，重复注入等于白烧 token。
    expect(runtime).not.toContain('守门人挡在门后，右手藏着黑色晶屑。');
  });
});

describe('主 Agent 循环收敛', () => {
  it('finalize 直接交付指导并回报尝试次数', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"从守门人的回避写起","summary":"试探"}'] });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('从守门人的回避写起');
    expect(result.attempts).toBe(1);
    expect(result.apiPreset.presetName).toBe('p1');
    expect(h.written).toHaveLength(0);
  });

  it('finalize 携带约束登记时落盘长期约束（旧 current/retired 键兼容为增量）', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"指导","constraints":{"current":["不得提前揭穿守门人"],"retired":[]}}'] });
    await h.planner.plan(h.request);
    expect(h.written).toHaveLength(1);
    expect(h.written[0].index).toBe(3);
    expect(h.written[0].snapshot.constraints).toEqual([
      { id: 'C01-1', text: '不得提前揭穿守门人', reason: '主 Agent 本轮裁决登记', createdIndex: 3 },
    ]);
    expect(h.written[0].snapshot.revisions.constraints).toBe(1);
  });

  it('增量登记漏写既有条目不再拒绝：add 只追加新增，既有条目原样保留', async () => {
    const withConstraint = buildEmptyAgentModuleSnapshot_ACU();
    withConstraint.constraints = [{ id: 'C01-1', text: '既有约束', reason: '早前登记', createdIndex: 1 }];
    withConstraint.revisions.constraints = 1;
    const h = harness_ACU({
      snapshot: withConstraint,
      mainReplies: ['{"action":"finalize","instruction":"指导","constraints":{"add":["新约束"],"retire":[]}}'],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('指导');
    expect(h.mainCalls).toHaveLength(1);
    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.constraints.map(item => item.text)).toEqual(['既有约束', '新约束']);
  });

  it('retire 未知条目时拒绝回灌并回显活跃清单，主 Agent 修正后同循环内交付', async () => {
    const withConstraint = buildEmptyAgentModuleSnapshot_ACU();
    withConstraint.constraints = [{ id: 'C01-1', text: '既有约束', reason: '早前登记', createdIndex: 1 }];
    withConstraint.revisions.constraints = 1;
    const h = harness_ACU({
      snapshot: withConstraint,
      mainReplies: [
        '{"action":"finalize","instruction":"指导","constraints":{"add":[],"retire":["写错的约束"]}}',
        '{"action":"finalize","instruction":"修正后交付","constraints":{"add":[],"retire":["C01-1"]}}',
      ],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('修正后交付');
    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.constraints).toHaveLength(0);
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('retire 的约束不存在');
    expect(feedback).toContain('C01-1：既有约束');
    expect(feedback).toContain('finalize 未被采纳');
  });

  it('最后一轮迭代约束登记被拒时降级为警告并照常交付，不再烧掉交付机会', async () => {
    const withConstraint = buildEmptyAgentModuleSnapshot_ACU();
    withConstraint.constraints = [{ id: 'C01-1', text: '既有约束', reason: '早前登记', createdIndex: 1 }];
    withConstraint.revisions.constraints = 1;
    const h = harness_ACU({
      snapshot: withConstraint,
      budget: { maxIterations: 1 },
      mainReplies: ['{"action":"finalize","instruction":"终局交付","constraints":{"add":[],"retire":["写错的约束"]}}'],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('终局交付');
    // 登记被跳过：快照未落盘，既有约束原样保留。
    expect(h.written).toHaveLength(0);
  });

  it('循环失败后再次运行从中断点恢复，已完成的派工结论保留不重做', async () => {
    const identity = (attempt: number) => ({ chatIdentity: 'chat-resume', taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `a-${attempt}`, source: 'turn_instruction' }) as any;
    const first = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]}]}',
        '协议非法输出一',
        '协议非法输出二',
      ],
      subReplies: ['{"summary":"主线要点","recommendation":"先试探"}'],
    });
    first.request.createInternalRequestIdentity = identity;
    await expect(first.planner.plan(first.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID' } });

    // 会话是楼层锚定持久化的，第二次运行读到的是同一份；这里显式传入以模拟同一个聊天。
    const second = harness_ACU({ conversation: first.conversation(), mainReplies: ['{"action":"finalize","instruction":"恢复后交付"}'] });
    second.request.createInternalRequestIdentity = identity;
    const result = await second.planner.plan(second.request);
    expect(result.instruction).toBe('恢复后交付');
    // 派工结论从缓存恢复进账本，不再重跑子代理；结论本身在持久会话里，仍看得见。
    expect(second.subCalls).toHaveLength(0);
    expect(second.mainCalls[0].map(message => message.content).join('\n')).toContain('主线要点');
    // 同一轮内恢复不重复通告换轮。
    expect(second.conversation().messages.filter(message => message.kind === 'turn')).toHaveLength(1);
    // 会话续写而非清空：能看到恢复分隔条目。
    expect(readAgentSessionLog_ACU().some(entry => entry.kind === 'run_resumed')).toBe(true);
    // 成功交付后缓存清除，下一轮全新开始。
    expect(readAgentRunState_ACU('chat-resume', 'task-1', 'stage-1#0#turn-2')).toBeNull();
  });

  it('终审关闭时 finalize 沿用原交付路径，不调用 final-reviewer', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"不审查直接交付"}'] });
    h.request.settings.finalReview.enabled = false;

    const result = await h.planner.plan(h.request);

    expect(result.instruction).toBe('不审查直接交付');
    expect(h.subCalls).toHaveLength(0);
    expect(h.conversation().messages.some(message => message.digest === '发送前终审反馈')).toBe(false);
  });

  it('首次 finalize 回灌终审结论，终审后裁决的 finalize 直接交付且不递归审查', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"finalize","instruction":"主角带着晶屑离开铁门"}',
        '{"action":"finalize","instruction":"主角只在铁门前观察晶屑"}',
      ],
      subReplies: [JSON.stringify({
        verdict: 'revise',
        summary: '晶屑不能带离铁门。',
        emotionFindings: [],
        worldFindings: ['晶屑不能带离铁门。'],
        logicFindings: [],
        requiredFixes: ['保留铁门限制。'],
        preserve: ['守门人的认知边界。'],
      })],
      worldbook: {
        available: true,
        entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '晶屑不能带离铁门。', tokens: 8 }],
      },
    });
    h.request.settings.finalReview.enabled = true;

    const result = await h.planner.plan(h.request);

    expect(result.instruction).toBe('主角只在铁门前观察晶屑');
    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls).toHaveLength(2);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('发送前终审反馈');
    expect(h.conversation().messages.some(message => message.digest === '发送前终审反馈' && message.text.includes('晶屑不能带离铁门。'))).toBe(true);
    const telemetry = readAgentSessionLog_ACU().find(entry => entry.title.includes('发送前终审遥测'));
    expect(telemetry?.detail).toContain('初始世界书命中：1 条（设定集:7）');
    expect(telemetry?.detail).toContain('独立读取：');
    expect(telemetry?.detail).toContain('工具轮：0');
    expect(telemetry?.detail).not.toContain('晶屑不能带离铁门。');
    expect(readAgentSessionLog_ACU().some(entry => entry.title.includes('终审反馈后的主 Agent 动作') && entry.detail.includes('协议动作：finalize'))).toBe(true);
  });

  it('终审调用失败时回灌诊断并保留裁决机会，不静默放行首次候选', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"finalize","instruction":"未经验证的候选"}',
        '{"action":"finalize","instruction":"终审失败后仍需显式裁决的指导"}',
      ],
      subReplies: ['{}', '{}'],
    });
    h.request.settings.finalReview.enabled = true;

    const result = await h.planner.plan(h.request);

    expect(result.instruction).toBe('终审失败后仍需显式裁决的指导');
    expect(h.subCalls.length).toBeGreaterThan(0);
    expect(h.conversation().messages.some(message => message.digest === '发送前终审反馈' && message.text.includes('终审调用失败'))).toBe(true);
    expect(h.mainCalls).toHaveLength(2);
  });

  it('终审反馈已就绪时中断恢复不重复调用，恢复后的裁决 finalize 直接交付', async () => {
    const identity = (attempt: number) => ({ chatIdentity: 'chat-final-review-resume', taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `final-${attempt}`, source: 'turn_instruction' }) as any;
    const first = harness_ACU({
      mainReplies: [
        '{"action":"finalize","instruction":"第一次候选"}',
        '协议非法输出一',
        '协议非法输出二',
      ],
      subReplies: [JSON.stringify({ verdict: 'revise', summary: '需要修订', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: ['修订候选'], preserve: [] })],
    });
    first.request.settings.finalReview.enabled = true;
    first.request.createInternalRequestIdentity = identity;
    await expect(first.planner.plan(first.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID' } });
    expect(first.subCalls).toHaveLength(1);

    // 模拟页面重载：进程内运行缓存清空，只能依赖聊天会话里的终审状态与反馈恢复。
    resetAgentRunCacheForTests_ACU();
    const second = harness_ACU({ conversation: first.conversation(), mainReplies: ['{"action":"finalize","instruction":"恢复后裁决指导"}'] });
    second.request.settings.finalReview.enabled = true;
    second.request.createInternalRequestIdentity = identity;
    const result = await second.planner.plan(second.request);

    expect(result.instruction).toBe('恢复后裁决指导');
    expect(second.subCalls).toHaveLength(0);
    expect(second.mainCalls[0].map(message => message.content).join('\n')).toContain('发送前终审反馈');
  });

  it('相同游标的新任务不继承旧任务的终审状态', async () => {
    const oldIdentity = (attempt: number) => ({ chatIdentity: 'chat-final-review-task-boundary', taskId: 'task-old', stageId: 'stage-1', turnId: 'turn-2', attemptId: `old-${attempt}`, source: 'turn_instruction' }) as any;
    const first = harness_ACU({
      mainReplies: [
        '{"action":"finalize","instruction":"旧任务候选"}',
        '协议非法输出一',
        '协议非法输出二',
      ],
      subReplies: [JSON.stringify({ verdict: 'revise', summary: '旧任务需要修订', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: ['修订旧候选'], preserve: [] })],
    });
    first.request.settings.finalReview.enabled = true;
    first.request.createInternalRequestIdentity = oldIdentity;
    await expect(first.planner.plan(first.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID' } });
    expect(first.subCalls).toHaveLength(1);

    resetAgentRunCacheForTests_ACU();
    const newIdentity = (attempt: number) => ({ chatIdentity: 'chat-final-review-task-boundary', taskId: 'task-new', stageId: 'stage-1', turnId: 'turn-2', attemptId: `new-${attempt}`, source: 'turn_instruction' }) as any;
    const second = harness_ACU({
      conversation: first.conversation(),
      mainReplies: [
        '{"action":"finalize","instruction":"新任务候选"}',
        '{"action":"finalize","instruction":"新任务裁决后的指导"}',
      ],
      subReplies: [JSON.stringify({ verdict: 'pass', summary: '新任务已审查', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] })],
    });
    second.request.settings.finalReview.enabled = true;
    second.request.createInternalRequestIdentity = newIdentity;
    const result = await second.planner.plan(second.request);

    expect(result.instruction).toBe('新任务裁决后的指导');
    expect(second.subCalls).toHaveLength(1);
    expect(second.conversation().messages.some(message => message.digest === '发送前终审反馈' && message.text.includes('新任务已审查'))).toBe(true);
  });

  it('终审租约失效时不把过期结果回灌为普通失败，恢复后不重付费并回灌中断诊断', async () => {
    const identity = (attempt: number) => ({ chatIdentity: 'chat-final-review-stale', taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `stale-${attempt}`, source: 'turn_instruction' }) as any;
    const first = harness_ACU({
      mainReplies: ['{\"action\":\"finalize\",\"instruction\":\"会过期的候选\"}'],
      subReplies: [JSON.stringify({ verdict: 'revise', summary: '不应采纳', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] })],
      isCurrent: identityValue => identityValue.source !== 'agent_subagent',
    });
    first.request.settings.finalReview.enabled = true;
    first.request.createInternalRequestIdentity = identity;

    await expect(first.planner.plan(first.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    expect(first.conversation().messages.some(message => message.digest === '发送前终审反馈')).toBe(false);

    const second = harness_ACU({ conversation: first.conversation(), mainReplies: ['{\"action\":\"finalize\",\"instruction\":\"恢复后的显式裁决\"}'] });
    second.request.settings.finalReview.enabled = true;
    second.request.createInternalRequestIdentity = identity;
    const result = await second.planner.plan(second.request);

    expect(result.instruction).toBe('恢复后的显式裁决');
    expect(second.subCalls).toHaveLength(0);
    expect(second.conversation().messages.some(message => message.digest === '发送前终审中断' && message.text.includes('未将其视为通过'))).toBe(true);
  });

  it('协议非法时按重试上限重试，重试仍失败则以不可重试错误终止', async () => {
    const h = harness_ACU({ mainReplies: ['我不想输出 JSON', '{"action":"write_story"}'] });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID', retryable: false } });
    expect(h.mainCalls).toHaveLength(2);
    // 拒绝原因与被拒的原文都进了会话：模型必须看到自己上一次到底写了什么。
    expect(h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '没有被采纳')].content).toContain('不包含带 action 字段的 JSON 对象');
    expect(h.mainCalls[1].some(message => message.role === 'assistant' && message.content.includes('我不想输出 JSON'))).toBe(true);
  });

  it('预算走到尽头仍不肯交付时终止，不做任何兜底', async () => {
    const h = harness_ACU({
      budget: { maxIterations: 2, maxConcurrent: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"策划","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"beat-planner","prompt":"还要派工","reads":["$OUTLINE_WINDOW"]}]}',
      ],
      subReplies: ['{"summary":"要点","recommendation":"先试探"}'],
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_PROTOCOL_INVALID', retryable: false } });
    expect(h.subCalls).toHaveLength(1);
  });

  it('最后一轮 delegate 被协议层拒绝，理由回灌后 finalize', async () => {
    const h = harness_ACU({
      budget: { maxIterations: 1 },
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"策划"}]}', '{"action":"finalize","instruction":"就这样写"}'],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('就这样写');
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('FINAL_ITERATION');
    expect(h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '没有被采纳')].content).toContain('预算最后一轮');
  });

  it('末轮无可执行大纲且常规配额锁死时，outline-architect 可使用一次保留容量后收敛交付', async () => {
    const h = harness_ACU({
      context: preOutlineContext_ACU,
      snapshot: snapshotWithArc_ACU(),
      budget: { maxIterations: 1, maxDelegations: 0, maxSameAgent: 0 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"根据当前卷台阶创建首个阶段大纲"}]}',
        '{"action":"finalize","instruction":"按新阶段大纲推进"}',
      ],
      applyOutline: () => ({ op: 'create', requiresReview: false, stopped: null, summary: '已创建首个阶段大纲' }),
    });
    const original = h.request.applyOutline!;
    h.request.applyOutline = async instruction => { const result = await original(instruction); h.setContext(execution_ACU); return result; };

    const result = await h.planner.plan(h.request);

    expect(result.instruction).toBe('按新阶段大纲推进');
    expect(h.outlineCalls).toEqual(['根据当前卷台阶创建首个阶段大纲']);
    expect(h.mainCalls).toHaveLength(2);
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('FINAL_MAINTENANCE_RESERVE');
    const latestBudget = h.mainCalls[1].filter(message => message.content.includes('本轮预算状态')).at(-1)?.content ?? '';
    expect(latestBudget).toContain('CONVERGENCE_ONLY');
  });

  it('同一权威游标的末轮保留容量不能执行第二个 outline-architect 或普通代理', async () => {
    const h = harness_ACU({
      context: preOutlineContext_ACU,
      snapshot: snapshotWithArc_ACU(),
      budget: { maxIterations: 1, maxDelegations: 0, maxSameAgent: 0 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"创建阶段大纲"},{"agentName":"outline-architect","prompt":"再次改写阶段大纲"},{"agentName":"mainline-planner","prompt":"不应执行的策划"}]}',
        '{"action":"finalize","instruction":"仅按首份大纲推进"}',
      ],
      applyOutline: () => ({ op: 'create', requiresReview: false, stopped: null, summary: '已创建首个阶段大纲' }),
    });
    const original = h.request.applyOutline!;
    h.request.applyOutline = async instruction => { const result = await original(instruction); h.setContext(execution_ACU); return result; };

    const result = await h.planner.plan(h.request);

    expect(result.instruction).toBe('仅按首份大纲推进');
    expect(h.outlineCalls).toEqual(['创建阶段大纲']);
    expect(h.subCalls).toHaveLength(0);
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('派工总数已达上限 0 次');
    expect(feedback).toContain('末轮保留容量只允许 outline-architect');
  });

  it('总纲版本或结算水位变化后切换权威游标，不受旧派工账本锁定', async () => {
    const arcChanged = harness_ACU({
      snapshot: snapshotWithArc_ACU(),
      budget: { maxDelegations: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"arc-architect","prompt":"依据新证据修订卷台阶"}]}',
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"按新卷台阶维护阶段大纲"}]}',
        '{"action":"finalize","instruction":"按更新后的阶段大纲推进"}',
      ],
      subReplies: [JSON.stringify({ summary: '已更新卷台阶', delta: { storyArc: [{ action: 'patch', id: 'A2', escalation: '把试探升级为公开对抗' }] } })],
      applyOutline: () => ({ op: 'revise', requiresReview: false, stopped: null, summary: '已按新卷台阶维护阶段大纲' }),
    });
    const arcResult = await arcChanged.planner.plan(arcChanged.request);
    expect(arcResult.instruction).toBe('按更新后的阶段大纲推进');
    expect(arcChanged.outlineCalls).toEqual(['按新卷台阶维护阶段大纲']);

    const settledChanged = harness_ACU({
      budget: { maxDelegations: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算未结算历史","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"基于已结算事实策划"}]}',
        '{"action":"finalize","instruction":"按结算后的证据推进"}',
      ],
      subReplies: [
        JSON.stringify({ summary: '已结算历史', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }] } }),
        JSON.stringify({ summary: '主线建议', recommendation: '先验证晶屑来源', mustPreserve: [], risks: [] }),
      ],
    });
    const settledResult = await settledChanged.planner.plan(settledChanged.request);
    expect(settledResult.instruction).toBe('按结算后的证据推进');
    expect(settledChanged.subCalls).toHaveLength(2);
  });

  it('总纲已建立且无结构事件时，惯性派工 arc-architect 被门禁拒绝且不消耗额度；写明事由与依据才放行', async () => {
    const context = { moduleSnapshot: snapshotWithArc_ACU(), execution: execution_ACU() } as any;
    const habitual = evaluateArcArchitectDispatch_ACU(context, '更新故事总纲');
    expect(habitual.allowed).toBe(false);
    expect(habitual.reason).toContain('不消耗派工额度');
    expect(evaluateArcArchitectDispatch_ACU(context, '楼层 12-14 主角提前翻出身世，VOL-01 的 withheld 底牌需要更新').allowed).toBe(true);
    // 结构性事件直接放行：总纲为空 / 有已完成但未登记的阶段 / 当前阶段刚完成。
    expect(evaluateArcArchitectDispatch_ACU({ moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(), execution: execution_ACU() } as any, '立总纲').allowed).toBe(true);
    const completedContext = { moduleSnapshot: snapshotWithArc_ACU(), execution: { ...execution_ACU(), task: { taskId: 'task-1', originInstruction: '', stages: [{ stageId: 'stage-1', stageNumber: 3, status: 'completed' }] } } } as any;
    expect(evaluateArcArchitectDispatch_ACU(completedContext, '回写').allowed).toBe(true);

    // 走完整主循环：被拒的派工不占派工总数，主 Agent 在下一次迭代仍能正常派工并交付。
    const h = harness_ACU({
      snapshot: snapshotWithArc_ACU(),
      budget: { maxDelegations: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"arc-architect","prompt":"更新故事总纲"}]}',
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"策划本轮"}]}',
        '{"action":"finalize","instruction":"按策划推进"}',
      ],
      subReplies: [JSON.stringify({ summary: '主线建议', recommendation: '先验证晶屑来源', mustPreserve: [], risks: [] })],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按策划推进');
    expect(h.subCalls).toHaveLength(1);
  });

  it('block 以专用错误码终止，并带上未解决项', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"block","reason":"角色表缺失","unresolved":["林瑶当前状态未知"]}'] });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({
      error: { code: 'CONTINUATION_AGENT_BLOCKED', retryable: false, details: { unresolved: ['林瑶当前状态未知'] } },
    });
  });

  it('轮次已失效时立刻停止，不消耗任何 AI 调用', async () => {
    const h = harness_ACU({ mainReplies: ['{"action":"finalize","instruction":"指导"}'], isCurrent: () => false });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    expect(h.mainCalls).toHaveLength(0);
  });
});

describe('故事总纲门禁', () => {
  it('总纲为空时派工 outline-architect 被拒且不消耗额度，改派 arc-architect 立完总纲后同轮即可排大纲', async () => {
    const h = harness_ACU({
      snapshot: buildEmptyAgentModuleSnapshot_ACU(),
      context: preOutlineContext_ACU,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"先排第一阶段"}]}',
        '{"action":"delegate","delegations":[{"agentName":"arc-architect","prompt":"立总纲"}]}',
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"围绕第一卷台阶排阶段"}]}',
        '{"action":"finalize","instruction":"按新大纲写"}',
      ],
      subReplies: ['{"summary":"已立全书方向与第一卷台阶","delta":{"storyArc":[{"action":"upsert","id":"A1","scope":"story","title":"禁区真相","direction":"主角查明禁区吞人的真相","escalation":"从个人求生抬到与守门人体系对抗","withheld":"守门人是主角失踪的兄长","status":"active"},{"action":"upsert","id":"VOL-01","scope":"volume","title":"第一卷·试探","direction":"摸清禁区门禁规则","escalation":"收在主角第一次被守门人识破","withheld":"晶屑的真实来源","status":"active","narrativeRole":"setup","targetStageRange":{"min":2,"max":4},"targetTimeSpan":"约两周","progressCeiling":"只确认门禁规则与守门人的警觉，不揭示晶屑来源","sustainingThreads":["主角与守门人的试探性信任"],"payoffTargets":["兑现主角获得首次入门机会的期待"]}]}}'],
      applyOutline: () => ({ op: 'create', requiresReview: false, stopped: null, summary: '已创建第 1 阶段大纲「禁区试探」（共 6 轮）' }),
    });
    const original = h.request.applyOutline!;
    h.request.applyOutline = async instruction => { const result = await original(instruction); h.setContext(execution_ACU); return result; };

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按新大纲写');
    // 被门禁拦下的那次没有真的调用大纲运行时。
    expect(h.outlineCalls).toEqual(['围绕第一卷台阶排阶段']);
    const rejection = h.mainCalls[1].map(message => message.content).join('\n');
    expect(rejection).toContain('故事总纲还是空的');
    expect(rejection).toContain('本次未消耗派工额度');
    // 门禁不吃额度：三次派工里只有两次记账，maxDelegations=4 时仍够用。
    expect(h.mainCalls[3].map(message => message.content).join('\n')).toContain('已创建第 1 阶段大纲');
  });

  it('既有卷全部完成时拒绝 outline-architect，必须先由 arc-architect 扩充 active 卷', async () => {
    const snapshot = snapshotWithArc_ACU();
    snapshot.storyArc[1] = {
      ...snapshot.storyArc[1],
      status: 'done',
      completionStageNumber: 1,
      completionState: '第一卷冲突已收束，守门人身份留下后续线索',
    };
    const h = harness_ACU({
      snapshot,
      context: preOutlineContext_ACU,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"直接创建下一阶段"}]}',
        '{"action":"block","reason":"需要先扩充总纲卷","unresolved":["没有 active 卷"]}',
      ],
    });

    await expect(h.planner.plan(h.request)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_BLOCKED' } });
    expect(h.outlineCalls).toEqual([]);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('既有卷已全部完成');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('本次未消耗派工额度');
  });

  it('arc-architect 的写入只换总纲快照，不推进结算水位', async () => {
    const h = harness_ACU({
      snapshot: buildEmptyAgentModuleSnapshot_ACU(),
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"arc-architect","prompt":"立总纲"}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"已立全书方向","delta":{"storyArc":[{"action":"upsert","id":"A1","scope":"story","title":"禁区真相","direction":"主角查明禁区吞人的真相","escalation":"抬到与守门人体系对抗","withheld":"守门人是主角失踪的兄长","status":"active","stageNumbers":[1]}]}}'],
    });
    const result = await h.planner.plan(h.request);

    expect(result.instruction).toBe('指导');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('总纲已更新');
    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.storyArc.map(item => item.title)).toEqual(['禁区真相']);
    expect(h.written[0].snapshot.revisions.storyArc).toBe(1);
    // 结算水位归 hook-cognition-maintainer 管：立总纲不代表未结算正文已经进账本。
    expect(h.written[0].snapshot.settledThroughIndex).toBe(buildEmptyAgentModuleSnapshot_ACU().settledThroughIndex);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('总纲已更新');
  });

  it('总纲状态段报告缺失与阶段进度未登记两种情形', async () => {
    const missing = harness_ACU({ snapshot: buildEmptyAgentModuleSnapshot_ACU(), mainReplies: ['{"action":"finalize","instruction":"指导"}'] });
    await missing.planner.plan(missing.request);
    expect(missing.mainCalls[0].map(message => message.content).join('\n')).toContain('故事总纲：尚未建立');

    // 快照里的卷台阶只登记到第 2 阶段，第 3 阶段虽已完成却没进任何卷台阶。
    const stale = harness_ACU({
      mainReplies: ['{"action":"finalize","instruction":"指导"}'],
      context: () => {
        const base = execution_ACU();
        base.task.stages = [{ stageNumber: 2, status: 'completed' }, { stageNumber: 3, status: 'completed' }];
        return base;
      },
    });
    await stale.planner.plan(stale.request);
    const evidence = stale.mainCalls[0].map(message => message.content).join('\n');
    expect(evidence).toContain('第 3 阶段已完成但没有登记');
    expect(evidence).toContain('派工 arc-architect 回写进度');
  });
});

describe('大纲子代理派工', () => {
  it('无大纲时 finalize 被拒绝；派工 outline-architect 创建成功后同循环内继续并交付', async () => {
    const h = harness_ACU({
      context: preOutlineContext_ACU,
      mainReplies: [
        '{"action":"finalize","instruction":"直接写"}',
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"围绕禁区试探创建首个阶段"}]}',
        '{"action":"finalize","instruction":"按新大纲第一轮写"}',
      ],
      applyOutline: () => ({ op: 'create', requiresReview: false, stopped: null, summary: '已创建第 1 阶段大纲「禁区试探」（共 6 轮）' }),
    });
    // create 成功后运行时读到的上下文切换为有大纲状态。
    const original = h.request.applyOutline!;
    h.request.applyOutline = async instruction => { const result = await original(instruction); h.setContext(execution_ACU); return result; };

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按新大纲第一轮写');
    expect(h.outlineCalls).toEqual(['围绕禁区试探创建首个阶段']);
    // 第一次 finalize 因无大纲被协议层拒绝并回灌。
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('不能 finalize');
    // 大纲操作结果回灌给下一次迭代。
    expect(h.mainCalls[2].map(message => message.content).join('\n')).toContain('已创建第 1 阶段大纲');
  });

  it('大纲操作产出待确认的新大纲时以重规划信号中止', async () => {
    const h = harness_ACU({
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"节奏放慢"}]}'],
      applyOutline: () => ({ op: 'revise', requiresReview: true, stopped: null, summary: '新大纲待确认' }),
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({
      error: { code: 'CONTINUATION_AGENT_OUTLINE_REPLANNED', retryable: false, message: expect.stringContaining('确认') },
    });
    expect(h.outlineCalls).toEqual(['节奏放慢']);
  });

  it('继续大纲遇到阶段上限时任务已停止，循环立即中止', async () => {
    const h = harness_ACU({
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"继续下一阶段"}]}'],
      applyOutline: () => ({ op: 'continue', requiresReview: false, stopped: 'stage_limit_reached', summary: '阶段数已达上限，任务已停止，不再创建下一阶段' }),
    });
    await expect(h.planner.plan(h.request)).rejects.toMatchObject({
      error: { code: 'CONTINUATION_TASK_STATE_INVALID', details: { stopped: 'stage_limit_reached' } },
    });
  });

  it('正文重试轮次不允许改写大纲，拒绝原因回灌后仍可正常交付', async () => {
    const h = harness_ACU({
      withoutApplyOutline: true,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"改大纲"}]}',
        '{"action":"finalize","instruction":"基于现有大纲交付"}',
      ],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('基于现有大纲交付');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('正文重试轮次不允许改写大纲');
  });

  it('edit_outline 被拒后回灌原因，并通过 outline-architect 维护大纲', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"edit_outline","thought":"只需微调","edits":[{"op":"set_turn_goal","turnId":"turn-2","goal":"守门人先露破绽"}]}',
        '{"action":"delegate","delegations":[{"agentName":"outline-architect","prompt":"将当前轮目标调整为守门人先露破绽"}]}',
        '{"action":"finalize","instruction":"按维护后的大纲写"}',
      ],
      applyOutline: () => ({ op: 'revise', requiresReview: false, stopped: null, summary: '大纲已由架构师维护' }),
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('按维护后的大纲写');
    expect(h.outlineCalls).toEqual(['将当前轮目标调整为守门人先露破绽']);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('大纲调整请派工 outline-architect');
  });

  it('大纲操作先于同波次其他派工执行，普通派工照常并发', async () => {
    const order: string[] = [];
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"outline-architect","prompt":"先修大纲"}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
      applyOutline: () => { order.push('outline'); return { op: 'revise', requiresReview: false, stopped: null, summary: '已改写大纲' }; },
    });
    const planner = h.request;
    const originalIsCurrent = planner.isInternalRequestCurrent;
    planner.isInternalRequestCurrent = identity => { if (identity.source === 'agent_subagent') order.push('subagent'); return originalIsCurrent(identity); };

    await h.planner.plan(h.request);
    expect(order[0]).toBe('outline');
    expect(order).toContain('subagent');
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('已改写大纲');
    expect(feedback).toContain('mainline-planner');
  });
});

describe('派工与写集落盘', () => {
  it('维护类子代理的 delta 串行落盘，结果与约束提议回灌给主 Agent', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算最近正文","reads":["$HISTORY_UNSETTLED","$HOOKS_LEDGER"],"writes":["$HOOKS_LEDGER","$INFO_GAP"]}]}',
        '{"action":"finalize","instruction":"最终指导"}',
      ],
      subReplies: [JSON.stringify({
        summary: '结算了黑色晶屑',
        delta: {
          hooks: [{ action: 'upsert', id: 'H1', summary: '守门人手中的黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }],
          infoGap: [{ action: 'upsert', id: 'E1', topic: '守门人身份', revealStatus: 'unrevealed', characterKnowledge: [{ name: '主角', knows: '只看到晶屑' }] }],
          constraintProposals: ['本阶段不得确认守门人身份'],
        },
      })],
    });

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('最终指导');

    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.hooks).toHaveLength(1);
    expect(h.written[0].snapshot.infoGap).toHaveLength(1);
    expect(h.written[0].snapshot.revisions).toMatchObject({ hooks: 1, infoGap: 1 });
    expect(h.written[0].snapshot.settledThroughIndex).toBe(3);

    const feedback = h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '结果 1')].content;
    expect(feedback).toContain('hook-cognition-maintainer｜成功');
    expect(feedback).toContain('伏笔 1 条、信息差 1 条');
    expect(feedback).toContain('约束提议（需你裁决后登记）：本阶段不得确认守门人身份');
  });

  it('维护代理一次结算 hooks/infoGap/chronology 并落进同一份快照', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算最近正文与时间流逝","reads":["$HISTORY_UNSETTLED","$CHRONOLOGY"]}]}',
        '{"action":"finalize","instruction":"最终指导"}',
      ],
      subReplies: [JSON.stringify({
        summary: '结算了晶屑与三日行程',
        delta: {
          hooks: [{ action: 'upsert', id: 'H1', summary: '守门人手中的黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }],
          chronology: [{ action: 'upsert', id: 'T1', anchor: '抵达禁区外围的第三日', elapsed: '自开篇约三日', precision: 'approximate', transition: '主角一行赶路三日抵达禁区外围', evidenceIndexes: [2, 3] }],
        },
      })],
    });

    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('最终指导');

    // chronology 与 hooks 在同一事务、同一份快照里生效，水位一并推进。
    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.hooks).toHaveLength(1);
    expect(h.written[0].snapshot.chronology).toHaveLength(1);
    expect(h.written[0].snapshot.chronology[0]).toMatchObject({ id: 'T1', anchor: '抵达禁区外围的第三日', evidenceIndexes: [2, 3], updatedIndex: 3 });
    expect(h.written[0].snapshot.revisions).toMatchObject({ hooks: 1, chronology: 1 });
    expect(h.written[0].snapshot.settledThroughIndex).toBe(3);

    const feedback = h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '结果 1')].content;
    expect(feedback).toContain('伏笔 1 条、信息差 0 条、故事时间 1 条');
  });

  it('第二次迭代读到的资料是落盘后的新快照', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"delegate","delegations":[{"agentName":"continuity-reviewer","prompt":"审查","reads":["$HOOKS_LEDGER"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: [
        JSON.stringify({ summary: '埋设', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }] } }),
        '{"verdict":"pass","reason":"没有冲突"}',
      ],
    });
    await h.planner.plan(h.request);

    const reviewerMaterials = h.subCalls[1].map(message => message.content).join('\n');
    expect(reviewerMaterials).toContain('黑色晶屑');
    // 每一批派工结果是一条独立的工具消息，编号在批内从 1 起算。
    const secondBatch = h.mainCalls[2][findIndex_ACU(h.mainCalls[2], 'continuity-reviewer｜成功')].content;
    expect(secondBatch).toContain('判词：pass');
    expect(secondBatch).not.toContain('hook-cognition-maintainer');
  });

  it('同波次两次写同一模块时，后者按读取时刻的修订号被判过期并如实回灌', async () => {
    const h = harness_ACU({
      budget: { maxSameAgent: 2, maxConcurrent: 2 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算前半段","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]},{"agentName":"hook-cognition-maintainer","prompt":"结算后半段","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: [
        JSON.stringify({ summary: '前半段', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑', status: 'planted', importance: 'high', plantedIndex: 3 }] } }),
        JSON.stringify({ summary: '后半段', delta: { hooks: [{ action: 'upsert', id: 'H2', summary: '铁门', status: 'planted', importance: 'mid', plantedIndex: 1 }] } }),
      ],
    });
    await h.planner.plan(h.request);

    expect(h.written).toHaveLength(1);
    expect(h.written[0].snapshot.hooks.map(hook => hook.id)).toEqual(['H1']);
    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('hooks 的 revision 已变化');
  });

  it('修订号过期的 delta 整体拒绝，快照不被污染', async () => {
    const stale = buildEmptyAgentModuleSnapshot_ACU();
    stale.revisions.hooks = 5;
    const h = harness_ACU({
      snapshot: stale,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算","reads":["$HISTORY_UNSETTLED"],"writes":["$HOOKS_LEDGER"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: [JSON.stringify({ summary: '基于旧版本', delta: { expectedRevisions: { hooks: 2 }, hooks: [{ action: 'upsert', id: 'H1', summary: '内容' }] } })],
    });
    await h.planner.plan(h.request);
    expect(h.written).toHaveLength(0);
    expect(h.mainCalls[1][findIndex_ACU(h.mainCalls[1], '结果 1')].content).toContain('未采用');
  });

  it('种子读集超预算的派工被拒绝，但不影响同波次其他子代理', async () => {
    const h = harness_ACU({
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"读太多","reads":["$HISTORY_UNSETTLED","$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"正常策划","reads":[]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"节拍","recommendation":"三拍推进","mustPreserve":["林瑶有伤"]}'],
    });
    // 读取预算钉在 1 token：任何非空种子材料都会超预算；空种子派工不受影响。
    (h.request.settings as any).agentReadTokenBudget = 1;
    await h.planner.plan(h.request);

    const feedback = h.mainCalls[1].map(message => message.content).join('\n');
    expect(feedback).toContain('mainline-planner｜失败');
    expect(feedback).toContain('种子读集超出读取预算');
    expect(feedback).toContain('beat-planner｜成功');
    expect(feedback).toContain('必须保留：林瑶有伤');
    expect(h.subCalls).toHaveLength(1);
  });

  it('超出并发上限的派工不执行但如实回灌，可在下一次迭代重派', async () => {
    const h = harness_ACU({
      budget: { maxConcurrent: 1 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('同一波次并发上限为 1 个');
  });

  it('跟随当前活动 API 时同波次强制串行，预算文本同步宣告上限为 1', async () => {
    const h = harness_ACU({
      apiPresetMode: 'current',
      budget: { maxConcurrent: 3 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
    });
    await h.planner.plan(h.request);

    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('同一波次最多 1 个子代理');
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('当前跟随活动 API，同一波次只能派工 1 个子代理');
  });

  it('全局跟随当前 API 但子代理角色全部固定渠道时，波次恢复并发且按角色解析渠道', async () => {
    const fixedChannel = { mode: 'fixed' as const, presetName: 'p2' };
    const h = harness_ACU({
      apiPresetMode: 'current',
      budget: { maxConcurrent: 2 },
      agentApiPresets: { maintainer: fixedChannel, mainlinePlanner: fixedChannel, beatPlanner: fixedChannel, reviewer: fixedChannel },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"主线","reads":["$OUTLINE_WINDOW"]},{"agentName":"beat-planner","prompt":"节拍","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}', '{"summary":"节拍","recommendation":"三拍"}'],
    });
    await h.planner.plan(h.request);

    expect(h.subCalls).toHaveLength(2);
    expect(h.mainCalls[0][findIndex_ACU(h.mainCalls[0], '本轮预算状态')].content).toContain('同一波次最多 2 个子代理');
    expect(h.presetRoles).toEqual(['main', 'mainlinePlanner', 'beatPlanner']);
  });

  it('同一代理超过次数上限后被拒绝', async () => {
    const h = harness_ACU({
      budget: { maxSameAgent: 1, maxConcurrent: 2 },
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"mainline-planner","prompt":"第一次","reads":["$OUTLINE_WINDOW"]},{"agentName":"mainline-planner","prompt":"第二次","reads":["$OUTLINE_WINDOW"]}]}',
        '{"action":"finalize","instruction":"指导"}',
      ],
      subReplies: ['{"summary":"主线","recommendation":"推进"}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(1);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('同一代理最多派工 1 次');
  });

  it('目录里不存在的代理名被拒绝，不发起任何子代理调用', async () => {
    const h = harness_ACU({
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"story-god","prompt":"全都交给你"}]}', '{"action":"finalize","instruction":"指导"}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(0);
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('目录里没有名为 story-god 的子代理');
  });
});

describe('子代理运行时', () => {
  let runtime: AgentSubagentRuntime_ACU;
  let calls: Array<Array<{ role: string; content: string }>>;
  let replies: string[];

  const input_ACU = (overrides: Partial<Parameters<AgentSubagentRuntime_ACU['run']>[0]> = {}) => ({
    delegation: { agentName: 'hook-cognition-maintainer', prompt: '结算未处理正文', reads: ['$HISTORY_UNSETTLED'] },
    settings: buildDefaultContinuationSettings_ACU(),
    resolveContext: {
      chat: chat_ACU(),
      moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 1,
      execution: execution_ACU(),
      originInstruction: '推进主角进入禁区',
      recentTurnCount: 2,
      tableData: { s1: { name: '角色表', content: [['姓名', '状态'], ['林瑶', '右臂有伤']] } },
    },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 },
    preset: preset_ACU,
    createIdentity: (_name: string, attempt: number) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
    isCurrent: () => true,
    ...overrides,
  }) as Parameters<AgentSubagentRuntime_ACU['run']>[0];

  beforeEach(() => {
    calls = [];
    replies = [];
    runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { calls.push(messages); return replies.shift() ?? '{}'; },
    });
  });

  it('注入种子读集解析后的材料与固定写集说明，不注入主 Agent 历史', async () => {
    replies = [JSON.stringify({ summary: '结算完成', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑' }] } })];
    const result = await runtime.run(input_ACU());

    const text = calls[0].map(message => message.content).join('\n');
    // 正文永不含用户楼层：未结算历史只列 AI 楼层（水位 1 之后即楼层 3），用户插话不进上下文。
    expect(text).toContain('【楼层 3】');
    expect(text).not.toContain('【楼层 2】');
    expect(text).toContain('$HOOKS_LEDGER 伏笔账本');
    expect(text).toContain('结算未处理正文');
    expect(text).not.toContain('【楼层 0】');
    // 写入范围由职责固定：maintain 类固定写 hooks + infoGap + chronology，不再经派工写集协商。
    expect(result.writes).toEqual(['hooks', 'infoGap', 'chronology']);
    expect(result.maintainer?.delta.hooks).toHaveLength(1);
  });

  it('子代理输出 read 工具批次时执行调阅并把结果回灌，随后继续小循环', async () => {
    replies = [
      '{"action":"read","reads":["$TABLE:角色表"]}',
      JSON.stringify({ summary: '补齐后结算', delta: { hooks: [{ action: 'upsert', id: 'H1', summary: '晶屑' }] } }),
    ];
    const result = await runtime.run(input_ACU());
    expect(calls).toHaveLength(2);
    // 第二次调用能看到自己上一次的工具请求（assistant）与回灌的工具结果（user）。
    const second = calls[1];
    expect(second.some(message => message.role === 'assistant' && message.content.includes('$TABLE:角色表'))).toBe(true);
    expect(second.some(message => message.role === 'user' && message.content.includes('林瑶'))).toBe(true);
    expect(result.expandedReads).toEqual(['$TABLE:角色表']);
    expect(result.iterations).toBe(2);
  });

  it('工具轮次用尽后回灌最后通牒，子代理必须基于已有资料交付', async () => {
    replies = [
      '{"action":"read","reads":["$HOOKS_LEDGER"]}',
      JSON.stringify({ summary: '就这样结算', delta: {} }),
    ];
    const result = await runtime.run(input_ACU({ budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 0 } } as any));
    expect(calls).toHaveLength(2);
    expect(calls[1].map(message => message.content).join('\n')).toContain('轮次已用尽');
    expect(result.expandedReads).toEqual([]);
  });

  it('种子读集超出读取预算时整次派工被拒，不发起 AI 调用', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    (settings as any).agentReadTokenBudget = 1;
    await expect(runtime.run(input_ACU({ settings } as any))).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_WRITE_REJECTED' } });
    expect(calls).toHaveLength(0);
  });

  it('读集对所有子代理开放，包括动态表名', async () => {
    replies = ['{"verdict":"pass","reason":"无冲突"}'];
    const result = await runtime.run(input_ACU({ delegation: { agentName: 'continuity-reviewer', prompt: '审查', reads: ['$TABLE:角色表'] } } as any));
    expect(calls[0].map(message => message.content).join('\n')).toContain('右臂有伤');
    expect(result.reviewer?.verdict).toBe('pass');
  });

  it('连续返回不符合契约时抛出子代理失败，且把拒绝理由喂回下一次尝试', async () => {
    replies = ['不是 JSON', '{"delta":{"hooks":[{"action":"delete","id":"H1"}]}}'];
    const settings = buildDefaultContinuationSettings_ACU();
    settings.internalAiRetryLimit = 1;
    // 第 2 次回复结构合法但 H1 非法：进入条目修补轮（2 轮），模型始终不重发 H1 修正版 → 失败。
    await expect(runtime.run(input_ACU({ settings } as any))).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SUBAGENT_FAILED', details: { rejected: [{ module: 'hooks', id: 'H1' }] } } });
    expect(calls).toHaveLength(4);
    expect(calls[1].map(message => message.content).join('\n')).toContain('没有被采纳');
    const repair = calls[2].map(message => message.content).join('\n');
    expect(repair).toContain('需要修正的条目');
    expect(repair).toContain('hooks[0]（id=H1）');
    expect(repair).toContain('upsert / patch / retire');
  });

  it('输出被截断时抢救完整条目并只索要剩余条目，按 id 合并后一次交付', async () => {
    const truncated = '{"summary":"结算完成","delta":{"hooks":[{"action":"upsert","id":"H1","summary":"晶屑"},{"action":"upsert","id":"H2","summary":"信物"},{"action":"upsert","id":"H3","summ';
    const rest = '{"delta":{"hooks":[{"action":"upsert","id":"H3","summary":"残图"}],"infoGap":[{"action":"upsert","id":"E1","topic":"守门人身份"}]}}';
    replies = [truncated, rest];
    const result = await runtime.run(input_ACU());
    expect(calls).toHaveLength(2);
    const continuation = calls[1].map(message => message.content).join('\n');
    expect(continuation).toContain('被截断');
    expect(continuation).toContain('已收下的条目：伏笔：H1、H2');
    expect(result.maintainer?.summary).toBe('结算完成');
    expect(result.maintainer?.delta.hooks.map(item => item.id)).toEqual(['H1', 'H2', 'H3']);
    expect(result.maintainer?.delta.infoGap.map(item => item.id)).toEqual(['E1']);
  });

  it('总纲为空时 arc-architect 交回空 delta 不算完成：先索要真正的条目；卷写在 delta.volumes 或以 id 为键的对象里也能收下', async () => {
    const story = { action: 'upsert', id: 'ARC-STORY', scope: 'story', title: '全书', direction: '主角追查禁区真相，对抗守门人体系', escalation: '', withheld: '兄长身份', status: 'active' };
    const volume = { scope: 'volume', title: '第一卷', direction: '摸清门禁规则', escalation: '收在第一次被识破', withheld: '晶屑来源', status: 'active', narrativeRole: 'setup', targetStageRange: { min: 2, max: 4 }, targetTimeSpan: '一月', progressCeiling: '不揭示幕后', sustainingThreads: ['与账房建立信任'], payoffTargets: ['拿回印信'] };
    replies = [
      '{"summary":"已确认长线 20 卷架构与卷级容量，总纲无需变更","delta":{"storyArc":[]}}',
      JSON.stringify({ summary: '立总纲', delta: { volumes: { 'VOL-01': volume }, storyArc: [story] } }),
    ];
    const result = await runtime.run(input_ACU({ delegation: { agentName: 'arc-architect', prompt: '立总纲', reads: [] } } as any));
    expect(calls).toHaveLength(2);
    expect(calls[1].map(message => message.content).join('\n')).toContain('summary 里的文字不会写入任何东西');
    expect(result.arc?.delta.storyArc.map(item => item.id)).toEqual(['ARC-STORY', 'VOL-01']);
    expect(result.arc?.delta.storyArc[1]).toMatchObject({ action: 'upsert', scope: 'volume', narrativeRole: 'setup' });
  });

  it('个别条目非法时收下其余条目，只让模型重发修正版并按 id 覆盖', async () => {
    replies = [
      '{"summary":"结算","delta":{"hooks":[{"action":"upsert","id":"H1","summary":"晶屑"}],"chronology":[{"action":"upsert","id":"T1","anchor":"入城第三日","elapsed":"三日","precision":"精确","transition":"过了两天","evidenceIndexes":[3]}]}}',
      '{"delta":{"chronology":[{"action":"upsert","id":"T1","anchor":"入城第三日","elapsed":"三日","precision":"exact","transition":"过了两天","evidenceIndexes":[3]}]}}',
    ];
    const result = await runtime.run(input_ACU());
    expect(calls).toHaveLength(2);
    expect(calls[1].map(message => message.content).join('\n')).toContain('chronology[0]（id=T1）');
    expect(result.maintainer?.delta.hooks).toHaveLength(1);
    expect(result.maintainer?.delta.chronology).toEqual([expect.objectContaining({ id: 'T1', precision: 'exact', evidenceIndexes: [3] })]);
  });

  it('派工中途轮次失效时立刻停止', async () => {
    const isCurrent = vi.fn().mockReturnValue(false);
    await expect(runtime.run(input_ACU({ isCurrent } as any))).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });
    expect(calls).toHaveLength(0);
  });
});
