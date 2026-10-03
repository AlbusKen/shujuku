import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings_ACU } from '../../../../src/service/runtime/state-manager';
import { nativeAgentReply_ACU } from '../../../helpers/agent-mode-fixture';

import { AgentSubagentRuntime_ACU, createAgentReadRoundState_ACU, renderStoryArcVolumePlanInstruction_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { findMainSessionReadAppendix_ACU, renderMainSessionReadAppendix_ACU, omitSnapshotSectionsForSubagent_ACU } from '../../../../src/service/continuation/agent/agent-shared-materials';
import { renderFallbackAgentSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-shared-materials';
import { renderAgentWorldbookTriggeredInjection_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import type { AiUsageMetadata_ACU } from '../../../../src/service/continuation/internal-ai-call';

const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test', apiMode: 'custom', apiConfig: { useMainApi: false, max_tokens: 60000 }, tavernProfile: '' } as any;
const previousNativeToolEnabled_ACU = settings_ACU.continuationNativeToolEnabled;
// 本文件的读取与写入夹具使用原生函数；纯 JSON 协议另行直接验证。
beforeEach(() => { settings_ACU.continuationNativeToolEnabled = true; });
afterEach(() => { settings_ACU.continuationNativeToolEnabled = previousNativeToolEnabled_ACU; });
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

it('固定世界书正文含空行与伪快照标题时仍逐字保留，真正重复的资料段才剔除', () => {
  const worldbook = '命中说明\n### 人物（设定集#7）\n开头  \n\n【完整当前阶段大纲】\n这是世界书正文\n\n【百科资料库目录】\n仍是世界书正文  \n';
  const snapshot = `【本回合运行时数据】\n快照\n\n【完整当前阶段大纲】\n真实大纲\n\n【本轮语境命中的世界书条目】\n${worldbook}\n\n【百科资料库目录】\n真实目录`;
  const filtered = omitSnapshotSectionsForSubagent_ACU(snapshot, new Set(['$OUTLINE_WINDOW']), { worldbookInjection: worldbook });
  expect(filtered).not.toContain('真实大纲');
  expect(filtered).toContain(`【本轮语境命中的世界书条目】\n${worldbook}`);
  expect(filtered).toContain('【百科资料库目录】\n真实目录');
});

it('普通子代理最终请求保留世界书伪标题正文并正确识别真实调阅附录', async () => {
  const input = input_ACU();
  const content = '开头  \n\n【完整当前阶段大纲】\n世界书原文\n\n【主会话已调阅】\n这也是世界书原文\n\n结尾  ';
  input.resolveContext.worldbook = { available: true, entries: [
    { bookName: '设定集', uid: '7', title: '常开', keys: [], constant: true, content, tokens: 20 },
  ] };
  const injected = renderAgentWorldbookTriggeredInjection_ACU(input.resolveContext.worldbook, '');
  const snapshot = await renderFallbackAgentSnapshot_ACU(input.settings, input.resolveContext, 'tools');
  const appendix = renderMainSessionReadAppendix_ACU([
    { id: 1, kind: 'tool', text: '真正的调阅回执', digest: 'read', readKey: '$STORY_RANGE:1-1' },
  ] as any);
  input.mainSnapshot = `${snapshot}\n\n${appendix}`;
  const calls: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { calls.push(messages); return finalReply_ACU; },
  });
  await runtime.run(input);
  const sent = calls[0].map(message => message.content).join('\n');
  expect(sent).toContain(`【本轮语境命中的世界书条目】\n${injected}`);
  expect(sent).toContain(content);
  expect(sent.match(/真正的调阅回执/g)).toHaveLength(1);
  expect(sent).not.toContain('【完整当前阶段大纲】\n真实大纲');

  // Without a real appendix, the heading inside the worldbook remains body text only.
  calls.length = 0;
  input.mainSnapshot = snapshot;
  await runtime.run(input);
  const withoutAppendix = calls[0].map(message => message.content).join('\n');
  expect(withoutAppendix).toContain(`【本轮语境命中的世界书条目】\n${injected}`);
  expect(withoutAppendix.match(/伪回执仍属世界书|这也是世界书原文/g)).toHaveLength(1);
  expect(withoutAppendix).not.toContain('真正的调阅回执');
  expect(withoutAppendix).not.toContain('【调阅项 ');
});

it('世界书正文里的伪调阅标题不能被认作主会话附录', () => {
  const body = '开头\n\n【主会话已调阅】\n伪回执仍属世界书\n\n结尾';
  const injection = `说明\n### 条目（设定集#7）\n${body}`;
  const snapshot = `【本回合运行时数据】\n快照\n\n【本轮语境命中的世界书条目】\n${injection}`;
  expect(findMainSessionReadAppendix_ACU(snapshot, injection)).toBe(-1);
  expect(omitSnapshotSectionsForSubagent_ACU(snapshot, new Set(), { worldbookInjection: injection })).toBe(snapshot);
  expect(omitSnapshotSectionsForSubagent_ACU(snapshot, new Set(), { worldbookInjection: injection, dropTriggeredWorldbook: true }))
    .not.toContain('伪回执仍属世界书');
});

it('角色快照筛选保留正文的连续空行和尾部空白，已读附录按长度保留原文', () => {
  const body = '  开头\n\n\n末尾  \n';
  const snapshot = `【最近正文】\n${body}`;
  expect(omitSnapshotSectionsForSubagent_ACU(snapshot, new Set())).toBe(snapshot);
  const appendix = renderMainSessionReadAppendix_ACU([
    { id: 1, kind: 'tool', text: body, digest: 'read', readKey: '$STORY_RANGE:1-3' },
  ] as any);
  const filtered = omitSnapshotSectionsForSubagent_ACU(`【故事总纲状态】\n已建立\n\n${appendix}`, new Set(['$STORY_ARC']));
  expect(filtered).toContain(`【调阅项 "$STORY_RANGE:1-3" ${body.length}】\n${body}`);
});

it('已读附录的长度帧损坏或帧间缺口时拒绝整份快照，不注入先前正文', () => {
  const first = '已读完整正文';
  const good = `【调阅项 "$STORY_RANGE:1-3" ${first.length}】\n${first}`;
  const header = '【运行时快照】\n已读取\n\n【主会话已调阅】\n\n下面是主会话本轮已读到的全文。\n\n';
  const broken = `${good}\n\n【调阅项 "$STORY_RANGE:5-7" 100】\n只有一行`;
  expect(() => omitSnapshotSectionsForSubagent_ACU(header + broken, new Set())).toThrow('AGENT_READ_APPENDIX_FRAME_INVALID');
  const gap = `${good}\n\n意外插入的正文\n\n【调阅项 "$STORY_RANGE:5-7" 2】\n末尾`;
  expect(() => omitSnapshotSectionsForSubagent_ACU(header + gap, new Set())).toThrow('AGENT_READ_APPENDIX_FRAME_INVALID');
  const malformed = `${good}\n\n【调阅项 "$STORY_RANGE:5-7" unknown】\n未验证正文`;
  expect(() => omitSnapshotSectionsForSubagent_ACU(header + malformed, new Set())).toThrow('AGENT_READ_APPENDIX_FRAME_INVALID');
  expect(() => omitSnapshotSectionsForSubagent_ACU(header + '【调阅项 "$STORY_RANGE:1-3" ?】\n残缺', new Set()))
    .toThrow('AGENT_READ_APPENDIX_FRAME_INVALID');
});

const readReply_ACU = nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'call-table-read');
const finalReply_ACU = nativeAgentReply_ACU(JSON.stringify({ summary: '结算完成', delta: {} }))!;
const readOnlyReviewReply_ACU = nativeAgentReply_ACU(JSON.stringify({ verdict: 'pass', reason: '读取回归完成', fixes: [] }))!;

function input_ACU(): Parameters<AgentSubagentRuntime_ACU['run']>[0] {
  const settings = buildDefaultContinuationSettings_ACU();
  settings.promptCacheEnabled = true;
  return {
    delegation: { agentName: 'hook-cognition-maintainer', prompt: '结算', reads: [] },
    roundId: 'stage-1#0#turn-1',
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


it.each(['json', 'tools'] as const)('%s 总纲请求在协议错误后允许检索与补读，保存后独立交付', async toolMode => {
  const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
  const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
  const { readAgentModuleSnapshot_ACU } = await import('../../../../src/service/continuation/agent/agent-module-store');
  const input = input_ACU();
  input.toolMode = toolMode;
  input.delegation = { agentName: 'arc-architect', prompt: '查清世界书设定后建立全书方向', reads: [] };
  input.settings.internalAiRetryLimit = 2;
  input.budget.maxExtraReads = 2;
  input.resolveContext.worldbook = { available: true, entries: [
    { bookName: '设定集', uid: '7', title: '禁区', keys: ['禁区'], constant: false, content: '禁区入口必须支付代价。', tokens: 20 },
  ] };
  const chat = input.resolveContext.chat;
  let saves = 0;
  _set_SillyTavern_API_ACU({ chat, saveChat: async () => { saves += 1; } } as any);
  input.writeSql = ({ role, sql, resolvePage }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql, resolvePage });
  const sql = "INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('STORY-01', 'story', '追查禁区', '查清入口代价', '从观察到进入', '禁区核心', 'active', 0);";
  const replies = [
    '<function_calls><invoke name="read"><parameter name="reads">["$WORLDBOOK:设定集:7"]</parameter></invoke></function_calls>',
    JSON.stringify({ action: 'search', query: '禁区', scope: ['worldbook'] }),
    JSON.stringify({ action: 'read', reads: ['$WORLDBOOK:设定集:7'] }),
    JSON.stringify({ action: 'write_sql', sql }),
    JSON.stringify({ summary: '全书方向已保存' }),
  ];
  const sent: Array<{ messages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }>; tools: string[]; cacheTools: string[] }> = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async (messages, _preset, _identity, _signal, options) => {
      sent.push({ messages, tools: options?.tools?.map(tool => tool.function.name) ?? [], cacheTools: options?.cacheTools ?? [] });
      // 运行中翻转全局开关，后续请求仍须沿用 input.toolMode。
      settings_ACU.continuationNativeToolEnabled = toolMode === 'json';
      const reply = replies.shift() ?? '{"summary":"全书方向已保存"}';
      return toolMode === 'tools' ? nativeAgentReply_ACU(reply) : reply;
    },
  });
  try {
    const result = await runtime.run(input);
    expect(sent).toHaveLength(5);
    expect(result.usedFieldWrites).toBe(true);
    expect(result.iterations).toBe(5);
    expect(saves).toBe(1);
    expect(readAgentModuleSnapshot_ACU(chat).storyArc[0]).toMatchObject({ id: 'STORY-01', title: '追查禁区', direction: '查清入口代价' });
    const texts = sent.map(request => request.messages.map(message => message.content).join('\n'));
    expect(texts[2]).toContain('$WORLDBOOK:设定集:7');
    expect(texts[3]).toContain('禁区入口必须支付代价。');
    expect(texts[4]).toContain('"status":"committed"');
    expect(texts[1]).not.toContain('调用一次 write_sql');
    for (const request of sent) {
      const text = request.messages.map(message => message.content).join('\n');
      expect(text).not.toMatch(/\{"summary":"[^"]*","sql":/);
      if (toolMode === 'json') {
        expect(request.tools).toEqual([]);
        expect(request.cacheTools).toContain('mode:json');
        expect(request.messages.some(message => message.role === 'tool' || message.tool_calls || message.tool_call_id)).toBe(false);
        expect(text).not.toMatch(/函数调用|submit|原生 write_sql/);
        expect(text).toContain('search 输出 JSON 动作');
      } else {
        expect(request.tools).toEqual(['read', 'search', 'write_sql', 'submit']);
        expect(request.cacheTools).not.toContain('mode:json');
        expect(text).toContain('search 使用函数调用');
        expect(text).not.toContain('我的最终交付是一个 JSON 对象');
      }
    }
    if (toolMode === 'tools') expect(sent[4].messages.some(message => message.role === 'tool')).toBe(true);
  } finally { _set_SillyTavern_API_ACU(null as any); }
});



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

it('各角色的最终工具集合与本地搜索执行权限一致', async () => {
  for (const [agentName, expected] of [
    ['hook-cognition-maintainer', ['read', 'submit']],
    ['arc-architect', ['read', 'search', 'submit']],
    ['web-researcher', ['read', 'search', 'encyclopedia_search', 'encyclopedia_read', 'web_search', 'web_read', 'submit']],
    ['instruction-composer', ['submit']],
  ] as const) {
    const input = input_ACU();
    input.delegation.agentName = agentName;
    input.settings.internalAiRetryLimit = 0;
    let tools: string[] | undefined;
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async (_messages, _preset, _identity, _signal, options) => {
        tools = options?.tools?.map(tool => tool.function.name);
        throw new Error('REQUEST_CAPTURED');
      },
    });
    await expect(runtime.run(input)).rejects.toThrow('REQUEST_CAPTURED');
    expect(tools, agentName).toEqual(expected);
  }
});

it('普通计划子代理只暴露 read，并拒绝未授权资料域', async () => {
  const input = input_ACU();
  input.delegation.agentName = 'mainline-planner';
  input.sharedMaterials = '【本轮已备资料】\n已注入强相关资料';
  input.budget.maxExtraReads = 1;
  const replies = [
    nativeToolTurn_ACU('read', { reads: ['$WEB_REFS:W1'] }, 'unauthorized-web-ref'),
    nativeAgentReply_ACU(JSON.stringify({ summary: '策划完成', recommendation: '依据已注入资料给出本轮策划建议', mustPreserve: [], risks: [] }))!,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(result.expandedReads).toEqual([]);
  expect(toolContent_ACU(sent[1], 'unauthorized-web-ref')).toContain('不在当前角色的授权读取范围');
});

it('普通角色伪造原生 search 时拒绝执行，保留工具回执', async () => {
  const input = input_ACU();
  const search = { content: '', toolCalls: [{ id: 'forged-search', name: 'search', arguments: JSON.stringify({ query: '秘密', scope: ['story'], isRegex: false, maxResults: 10 }) }] };
  const sent: SentMessage_ACU[][] = [];
  const replies = [search, finalReply_ACU];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(result.expandedReads).toEqual([]);
  // 原生工具调用统一由 profile 授权表拦下；「未授权本地搜索」只出现在旧 JSON 文本协议路径。
  expect(toolContent_ACU(sent[1], 'forged-search')).toContain('未获当前角色 profile 授权');
});


it('同轮多个原生 read 任一失败时整批不注入，修正后仍可读取', async () => {
  const { AGENT_MODULE_FIELD_ACU } = await import('../../../../src/service/continuation/agent/agent-model');
  const input = input_ACU();
  input.budget.maxExtraReads = 2;
  input.resolveContext.chat[1][AGENT_MODULE_FIELD_ACU] = { schemaVersion: 4, invalid: true };
  const first = {
    content: '',
    toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'batch-table').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$FIELD:hooks:H1'] }, 'batch-damaged').toolCalls,
    ],
  };
  const replies = [first, nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'retry-table'), finalReply_ACU];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(toolContent_ACU(sent[1], 'batch-table')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[1], 'batch-damaged')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[1], 'batch-table')).toContain('"status":"failed"');
  expect(toolContent_ACU(sent[2], 'retry-table')).toContain('林瑶');
  expect(result.expandedReads).toEqual(['$TABLE:角色表']);
});


it('同批重复地址的显式围栏不完整时整批失败，修正后可重读', async () => {
  const input = input_ACU();
  input.budget.maxExtraReads = 2;
  const replies = [
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'plain-table').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'], requestedFence: { lower: 2, upper: 2 } }, 'fenced-table').toolCalls,
    ] },
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'retry-plain-table'),
    finalReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(toolContent_ACU(sent[1], 'plain-table')).toContain('实际范围超出 requestedFence');
  expect(toolContent_ACU(sent[1], 'plain-table')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[1], 'fenced-table')).toContain('本逻辑读取批次已统一结算');
  expect(toolContent_ACU(sent[1], 'fenced-table')).not.toContain('fence-proof-missing');
  expect(toolContent_ACU(sent[2], 'retry-plain-table')).toContain('林瑶');
  expect(result.expandedReads).toEqual(['$TABLE:角色表']);
});


it('正文区间越界与其它地址同批时不泄漏部分正文，修正后可重试', async () => {
  const input = input_ACU();
  input.budget.maxExtraReads = 2;
  const replies = [
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'valid-table').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-99'] }, 'outside-window').toolCalls,
    ] },
    nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-1'] }, 'corrected-range'),
    finalReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  const firstReceipt = toolContent_ACU(sent[1], 'valid-table');
  expect(firstReceipt).toContain('"status":"failed"');
  expect(firstReceipt).not.toContain('林瑶');
  expect(firstReceipt).not.toContain('守门人挡在门后');
  expect(toolContent_ACU(sent[1], 'outside-window')).not.toContain('守门人挡在门后');
  expect(toolContent_ACU(sent[2], 'corrected-range')).toContain('守门人挡在门后');
  expect(result.expandedReads).toEqual(['$STORY_RANGE:1-1']);
});

it('表格区间越界时整批不注入，修正后可完整读取', async () => {
  const input = input_ACU();
  input.budget.maxExtraReads = 2;
  const replies = [
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'valid-table').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表:1-99'] }, 'outside-table').toolCalls,
    ] },
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表:1-1'] }, 'corrected-table'),
    finalReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(toolContent_ACU(sent[1], 'valid-table')).toContain('"status":"failed"');
  expect(toolContent_ACU(sent[1], 'valid-table')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[1], 'outside-table')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[2], 'corrected-table')).toContain('林瑶');
  expect(result.expandedReads).toEqual(['$TABLE:角色表:1-1']);
});

it('世界书部分 UID 缺失使同批读取失败，修正后完整返回', async () => {
  const input = input_ACU();
  input.delegation.agentName = 'arc-architect';
  input.budget.maxExtraReads = 2;
  input.resolveContext.worldbook = { available: true, entries: [
    { bookName: '设定', uid: '1', title: '人物', keys: [], constant: false, content: '独有世界书正文', tokens: 8 },
  ] };
  const replies = [
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'valid-table').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$WORLDBOOK:设定:1,missing'] }, 'missing-uid').toolCalls,
    ] },
    nativeToolTurn_ACU('read', { reads: ['$WORLDBOOK:设定:1'] }, 'valid-worldbook'),
    readOnlyReviewReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(toolContent_ACU(sent[1], 'valid-table')).toContain('"status":"failed"');
  expect(toolContent_ACU(sent[1], 'valid-table')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[1], 'missing-uid')).not.toContain('独有世界书正文');
  expect(toolContent_ACU(sent[2], 'valid-worldbook')).toContain('独有世界书正文');
  expect(result.expandedReads).toEqual(['$WORLDBOOK:设定:1']);
});

it('世界书地址含空 UID 时整批拒绝，修正后可完整读取', async () => {
  const input = input_ACU();
  input.delegation.agentName = 'arc-architect';
  input.budget.maxExtraReads = 2;
  input.resolveContext.worldbook = { available: true, entries: [
    { bookName: '设定', uid: '1', title: '人物', keys: [], constant: false, content: '独有世界书正文', tokens: 8 },
  ] };
  const replies = [
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'table-before-empty-uid').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$WORLDBOOK:设定:1,'] }, 'empty-uid').toolCalls,
    ] },
    nativeToolTurn_ACU('read', { reads: ['$WORLDBOOK:设定:1'] }, 'fixed-uid'),
    readOnlyReviewReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(toolContent_ACU(sent[1], 'table-before-empty-uid')).toContain('"status":"failed"');
  expect(toolContent_ACU(sent[1], 'table-before-empty-uid')).not.toContain('林瑶');
  expect(toolContent_ACU(sent[1], 'empty-uid')).not.toContain('独有世界书正文');
  expect(toolContent_ACU(sent[2], 'fixed-uid')).toContain('独有世界书正文');
  expect(result.expandedReads).toEqual(['$WORLDBOOK:设定:1']);
});

it('栏目地址非法或字段越权时整批不注入，修正后可读取', async () => {
  const input = input_ACU();
  input.delegation.agentName = 'arc-architect';
  input.budget.maxExtraReads = 3;
  const replies = [
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'table-before-invalid-field').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$FIELD:storyArc'] }, 'invalid-field-address').toolCalls,
    ] },
    { content: '', toolCalls: [
      ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'table-before-unknown-field').toolCalls,
      ...nativeToolTurn_ACU('read', { reads: ['$FIELD:storyArc:test:unknown'] }, 'unknown-field').toolCalls,
    ] },
    nativeToolTurn_ACU('read', { reads: ['$FIELD:storyArc:test'] }, 'corrected-field'),
    readOnlyReviewReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  for (const [index, tableId, fieldId] of [[1, 'table-before-invalid-field', 'invalid-field-address'], [2, 'table-before-unknown-field', 'unknown-field']] as const) {
    expect(toolContent_ACU(sent[index], tableId)).toContain('"status":"failed"');
    expect(toolContent_ACU(sent[index], tableId)).not.toContain('林瑶');
    expect(toolContent_ACU(sent[index], fieldId)).toContain('本逻辑读取批次已统一结算');
  }
  expect(toolContent_ACU(sent[3], 'corrected-field')).toContain('"module":"storyArc"');
  expect(result.expandedReads).toEqual(['$FIELD:storyArc:test']);
});

it('普通子代理一次成功 read 后不同地址也返回 read-once-exhausted', async () => {
  const input = input_ACU();
  input.budget.maxExtraReads = 2;
  const replies = [
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'first-read'),
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表:1-1'] }, 'second-read'),
    finalReply_ACU,
  ];
  const sent: SentMessage_ACU[][] = [];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });
  const result = await runtime.run(input);
  expect(toolContent_ACU(sent[2], 'second-read')).toContain('read-once-exhausted');
  expect(result.expandedReads).toEqual(['$TABLE:角色表']);
});

it('同一 agentName 与 roundId 的共享状态跨 runtime 只允许一次成功 read', async () => {
  const sharedReadRound = createAgentReadRoundState_ACU();
  const sent: SentMessage_ACU[][] = [];
  const replies = [
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'shared-first-read'),
    finalReply_ACU,
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表:1-1'] }, 'shared-second-read'),
    finalReply_ACU,
  ];
  const createRuntime = () => new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });

  const first = await createRuntime().run({ ...input_ACU(), readRoundState: sharedReadRound });
  const second = await createRuntime().run({ ...input_ACU(), readRoundState: sharedReadRound });
  const secondReadResult = sent.flatMap(messages => messages).find(message => message.tool_call_id === 'shared-second-read')?.content ?? '';

  expect(secondReadResult).toContain('read-once-exhausted');
  expect(first.expandedReads).toEqual(['$TABLE:角色表']);
  expect(second.expandedReads).toEqual([]);
  expect(sharedReadRound.successfulReadBatches.size).toBe(1);
});

it('不同 roundId 的同名子代理不共享成功 read 额度', async () => {
  const sharedReadRound = createAgentReadRoundState_ACU();
  const sent: SentMessage_ACU[][] = [];
  const replies = [
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'round-one-read'),
    finalReply_ACU,
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'round-two-read'),
    finalReply_ACU,
  ];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });

  const first = await runtime.run({ ...input_ACU(), readRoundState: sharedReadRound, roundId: 'stage-1#0#turn-1' });
  const second = await runtime.run({ ...input_ACU(), readRoundState: sharedReadRound, roundId: 'stage-1#0#turn-2' });
  const secondReadResult = sent.flatMap(messages => messages).find(message => message.tool_call_id === 'round-two-read')?.content ?? '';

  expect(secondReadResult).toContain('林瑶');
  expect(first.expandedReads).toEqual(['$TABLE:角色表']);
  expect(second.expandedReads).toEqual(['$TABLE:角色表']);
  expect(sharedReadRound.successfulReadBatches.size).toBe(2);
});

it('失败 read 批次不占共享额度，修正后可以成功重试', async () => {
  const sharedReadRound = createAgentReadRoundState_ACU();
  const sent: SentMessage_ACU[][] = [];
  const input = input_ACU();
  input.budget.maxExtraReads = 2;
  const replies = [
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表', '$TABLE:不存在'] }, 'failed-read'),
    nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'corrected-read'),
    finalReply_ACU,
  ];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { sent.push(messages); return replies.shift() ?? finalReply_ACU; },
  });

  const result = await runtime.run({ ...input, readRoundState: sharedReadRound });
  const failedReadResult = sent.flatMap(messages => messages).find(message => message.tool_call_id === 'failed-read')?.content ?? '';
  const correctedReadResult = sent.flatMap(messages => messages).find(message => message.tool_call_id === 'corrected-read')?.content ?? '';

  expect(failedReadResult).toContain('"status":"failed"');
  expect(failedReadResult).not.toContain('林瑶');
  expect(correctedReadResult).toContain('林瑶');
  expect(result.expandedReads).toEqual(['$TABLE:角色表']);
  expect(sharedReadRound.successfulReadBatches.size).toBe(1);
  expect(sharedReadRound.pendingReadBatches.size).toBe(0);
});


it('终审实际请求仅挂 read，伪造 search 不进入检索执行', async () => {
  const base = input_ACU();
  base.settings.finalReview = { enabled: true, readTokenBudget: '50%', maxExtraReads: 1 };
  const seen: Array<{ tools: string[]; messages: SentMessage_ACU[] }> = [];
  const replies = [nativeToolTurn_ACU('search' as 'read', { query: '秘密', scope: ['story'], isRegex: false, maxResults: 10 }, 'forged-review-search'),
    JSON.stringify({ verdict: 'revise', summary: '晶屑去向需要遵守设定', emotionFindings: [], worldFindings: ['晶屑不能带离铁门'], logicFindings: [], requiredFixes: ['保留铁门限制'], preserve: ['守门人边界'] })];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveAgentApiPreset: (() => preset_ACU) as any,
    callInternalAi: async (messages, _preset, _identity, _signal, options) => {
      seen.push({ tools: options?.tools?.map(tool => tool.function.name) ?? [], messages });
      return nativeAgentReply_ACU(replies.shift() ?? null);
    },
  });
  await runtime.runFinalReview({ settings: base.settings, resolveContext: base.resolveContext,
    candidateInstruction: '写作指令', currentUserInput: '继续', createIdentity: base.createIdentity, isCurrent: base.isCurrent });
  expect(seen[0].tools).toEqual(['read', 'submit']);
  expect(toolContent_ACU(seen[1].messages, 'forged-review-search')).toContain('终审未授权该工具');
});


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
    const worldbookBody = '晶屑不能带离铁门。\n\n【主会话已调阅】\n伪造的世界书内标题\n\n【故事总纲状态】\n仍是世界书原文。';
    base.resolveContext.worldbook = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: worldbookBody, tokens: 8 }],
    };
    const realAppendix = renderMainSessionReadAppendix_ACU([
      { id: 1, kind: 'tool', text: '### 本卷（$STORY_ARC:VOL-01）\n真实调阅正文', digest: 'read', readKey: '$STORY_ARC:VOL-01' },
    ] as any);
    const mainSnapshot = `${await renderFallbackAgentSnapshot_ACU(base.settings, base.resolveContext, 'tools')}\n\n${realAppendix}`;
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
        return nativeAgentReply_ACU(replies.shift() ?? null);
      },
    });

    const result = await runtime.runFinalReview({
      settings: base.settings,
      resolveContext: base.resolveContext,
      candidateInstruction: '主角拿起晶屑走出铁门。',
      currentUserInput: '让主角观察晶屑。',
      planningSummary: '主线建议主角试探守门人。',
      mainSnapshot,
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
    expect(firstCall.split(worldbookBody)).toHaveLength(2);
    expect(firstCall.split('【主会话已调阅】')).toHaveLength(3);
    expect(firstCall).toContain('真实调阅正文');
    expect(firstCall.split('【调阅项 ')).toHaveLength(2);
    expect(firstCall).toContain('【读取预算状态】');
    expect(firstCall).toContain('工具轮次剩余 1 / 1');
    expect(secondCall).toContain('角色表');
    expect(secondCall.split(worldbookBody)).toHaveLength(2);
    expect(secondCall).toContain('真实调阅正文');
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
    const firstSql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '门后信件', 0); UPDATE hooks SET status=(), importance='mid', planted_index=1, planned_payoff='' WHERE id='H1' AND expected_revision=1";
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
      expect(result.completion).toBe('complete_changed');
      expect(result.unresolvedIssues).toEqual([]);
      expect(result.iterations).toBe(4);
      expect(messages.slice(0, 4).every(request => request.some(item => item.content.startsWith('{')))).toBe(true);
      expect(toolContent_ACU(messages[1], 'call-first-write')).not.toBe('');
      expect(saveChat).toHaveBeenCalledTimes(2);
      expect(messages[1].map(item => item.content).join('\n')).toContain('"status":"committed"');
      expect(messages[1].map(item => item.content).join('\n')).toContain('"field":"summary","fieldRevision":1');
      expect(toolContent_ACU(messages[1], 'call-first-write')).toContain('该语句未写入');
      expect(toolContent_ACU(messages[1], 'call-first-write')).not.toContain('保存状态无法确认');
      expect(toolContent_ACU(messages[1], 'call-first-write')).toContain('字段修订号，不是模块修订号');
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
  it('提交的 SQL 原文进会话流，宿主异常时同一条目回写为失败', async () => {
    const { vi } = await import('vitest');
    const { _set_SillyTavern_API_ACU } = await import('../../../../src/shared/host-api');
    const { commitAgentModuleFieldWrites_ACU } = await import('../../../../src/service/continuation/agent/agent-module-field-commit');
    const { readAgentSessionLog_ACU, resetAgentSessionLogForTests_ACU } = await import('../../../../src/service/continuation/agent/agent-session-log');
    const sql = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)";

    // 真实提交：SQL 原文必须进会话流，用户才能看到这一轮究竟写了什么。
    resetAgentSessionLogForTests_ACU();
    const input = input_ACU();
    const chat = input.resolveContext.chat;
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const replies = [nativeToolTurn_ACU('write_sql', { sql }, 'call-log-write'), finalReply_ACU];
    input.writeSql = ({ role, sql: statement, isCurrent }) => commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role, sql: statement, isCurrent });
    try {
      await new AgentSubagentRuntime_ACU({ resolveApiPreset: (() => preset_ACU) as any,
        callInternalAi: async () => replies.shift() ?? finalReply_ACU }).run(input);
      const entry = readAgentSessionLog_ACU().find(item => item.kind === 'write_sql');
      expect(entry).toBeTruthy();
      expect(entry!.detail).toContain(sql);
      expect(entry!.agentName).not.toBe('');
      expect(entry!.status).not.toBe('running');
    } finally { _set_SillyTavern_API_ACU(null as any); }

    // 宿主异常：同一条目回写为失败并带上原因，不能只剩一个 running 条目悬着。
    resetAgentSessionLogForTests_ACU();
    const failing = input_ACU();
    _set_SillyTavern_API_ACU({ chat: failing.resolveContext.chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    failing.writeSql = async () => { throw new Error('宿主保存通道异常'); };
    const failingReplies = [nativeToolTurn_ACU('write_sql', { sql }, 'call-log-write-failed'), finalReply_ACU];
    try {
      await new AgentSubagentRuntime_ACU({ resolveApiPreset: (() => preset_ACU) as any,
        callInternalAi: async () => failingReplies.shift() ?? finalReply_ACU }).run(failing);
      const entry = readAgentSessionLog_ACU().find(item => item.kind === 'write_sql');
      expect(entry).toMatchObject({ ok: false, status: 'failed' });
      expect(entry!.detail).toContain(sql);
      expect(entry!.detail).toContain('宿主保存通道异常');
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
      expect(accepted).toContain('"field":"summary","fieldRevision":1');
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
          ? nativeAgentReply_ACU('{"summary":"资料已充分，直接交付总纲契约"}')
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

describe('子代理最终请求容量门禁与 60% 默认上围栏', () => {
  const floor_ACU = (index: number) => `楼层${index}独有正文${'丙'.repeat(200)}`;
  // 本组把本地输入限制设为 60000；输出 max_tokens 不参与输入围栏。
  const counter_ACU = (payload: number) => async (text: string) => (text.startsWith('{"messages"') ? payload : text.length);
  const storyInput_ACU = () => {
    const input = input_ACU();
    input.settings.agentHistoryTokenBudget = 60000;
    input.resolveContext.chat = Array.from({ length: 12 }, (_, index) => (index % 2 === 0
      ? { mes: `用户${index}`, is_user: true }
      : { mes: floor_ACU(index), is_user: false }));
    input.resolveContext.storyWindowFloors = 20;
    input.settings.internalAiRetryLimit = 0;
    return input;
  };
  const runtime_ACU = (payload: number, replies: unknown[], sent: SentMessage_ACU[][], options: { tools?: string[][] } = {}) => new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    countTokens: counter_ACU(payload),
    callInternalAi: async (messages, _preset, _identity, _signal, callOptions) => {
      sent.push(messages);
      options.tools?.push(callOptions?.tools?.map(tool => tool.function.name) ?? []);
      return (replies.shift() ?? finalReply_ACU) as any;
    },
  });

  it('专项子代理最终请求超出容量时不调用 provider，返回不可重试的 context-capacity-exceeded', async () => {
    const sent: SentMessage_ACU[][] = [];
    const error = await runtime_ACU(70000, [], sent).run(storyInput_ACU()).catch(caught => caught);
    expect(sent).toHaveLength(0);
    expect(error?.error).toMatchObject({
      code: 'CONTINUATION_AGENT_SUBAGENT_FAILED', retryable: false,
      details: { reason: 'context-capacity-exceeded', code: 'READ_FENCE_CAPACITY_EXHAUSTED', inputLimitTokens: 60000, agentName: 'hook-cognition-maintainer' },
    });
  });

  it('终审最终请求超出容量时不调用 provider', async () => {
    const base = storyInput_ACU();
    base.settings.finalReview = { enabled: true, readTokenBudget: '50%', maxExtraReads: 1 };
    const sent: SentMessage_ACU[][] = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveAgentApiPreset: (() => preset_ACU) as any,
      countTokens: counter_ACU(70000),
      callInternalAi: async messages => { sent.push(messages); return null; },
    });
    const error = await runtime.runFinalReview({ settings: base.settings, resolveContext: base.resolveContext,
      candidateInstruction: '写作指令', currentUserInput: '继续', createIdentity: base.createIdentity, isCurrent: base.isCurrent }).catch(caught => caught);
    expect(sent).toHaveLength(0);
    expect(error?.error?.details).toMatchObject({ reason: 'context-capacity-exceeded', code: 'READ_FENCE_CAPACITY_EXHAUSTED' });
  });

  it('未给上围栏的正文区间按默认上围栏收窄为可证明前缀，注入该子范围完整逐字正文', async () => {
    const sent: SentMessage_ACU[][] = [];
    // 预算 floor(0.6 × (60000 − 58833)) = 700：容得下 2 个 ~210 字楼层加标注，容不下 5 个。
    const input = storyInput_ACU();
    const result = await runtime_ACU(58833, [nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-9'] }, 'default-fenced'), finalReply_ACU], sent).run(input);
    const receipt = toolContent_ACU(sent[1], 'default-fenced');
    expect(receipt).toContain('【默认上围栏】原地址「$STORY_RANGE:1-9」');
    expect(receipt).toContain('默认上围栏预算 700 tokens');
    const address = /解析为「(\$STORY_RANGE:1-(\d+))」/.exec(receipt)!;
    const upper = Number(address[2]);
    expect(upper).toBeGreaterThanOrEqual(3);
    expect(upper).toBeLessThan(9);
    for (let floor = 1; floor <= 9; floor += 2) {
      if (floor <= upper) expect(receipt).toContain(floor_ACU(floor));
      else expect(receipt).not.toContain(floor_ACU(floor));
    }
    expect(result.expandedReads).toEqual([`${address[1]}（默认上围栏，原地址 $STORY_RANGE:1-9）`]);
  });

  it('默认上围栏连最小范围都放不下时整批不注入、不消耗额度，改用显式围栏后可重读', async () => {
    const sent: SentMessage_ACU[][] = [];
    const input = storyInput_ACU();
    input.budget.maxExtraReads = 2;
    // 预算 floor(0.6 × (60000 − 59808)) = 115：单个楼层（~210 字）也放不下。
    const replies = [
      { content: '', toolCalls: [
        ...nativeToolTurn_ACU('read', { reads: ['$TABLE:角色表'] }, 'table-sibling').toolCalls,
        ...nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-3'] }, 'too-small').toolCalls,
      ] },
      nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-3'], requestedFence: { lower: 1, upper: 3 } }, 'explicit-fence'),
      finalReply_ACU,
    ];
    const result = await runtime_ACU(59808, replies, sent).run(input);
    const failed = toolContent_ACU(sent[1], 'table-sibling') + toolContent_ACU(sent[1], 'too-small');
    expect(failed).toContain('default-fence-exhausted');
    expect(failed).not.toContain('林瑶');
    expect(failed).not.toContain(floor_ACU(1));
    const retried = toolContent_ACU(sent[2], 'explicit-fence');
    expect(retried).not.toContain('read-once-exhausted');
    expect(retried).toContain(floor_ACU(1));
    expect(retried).toContain(floor_ACU(3));
    expect(retried).not.toContain('【默认上围栏】');
    expect(result.expandedReads).toEqual(['$STORY_RANGE:1-3']);
  });

  it('每次模型请求前都重新计量容量：工具回执推高占用后第二次请求被拦截', async () => {
    const sent: SentMessage_ACU[][] = [];
    const input = storyInput_ACU();
    let payloadCalls = 0;
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      countTokens: async text => (text.startsWith('{"messages"') ? (payloadCalls += 1) === 1 ? 7025 : 60000 : text.length),
      callInternalAi: async messages => { sent.push(messages); return nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-1'] }, 'first-read') as any; },
    });
    const error = await runtime.run(input).catch(caught => caught);
    expect(sent).toHaveLength(1);
    expect(payloadCalls).toBe(2);
    expect(error?.error?.details).toMatchObject({ reason: 'context-capacity-exceeded', code: 'READ_FENCE_CAPACITY_EXHAUSTED' });
  });

  it('重复请求收窄前的原始宽地址时如实提示剩余范围，不重复注入正文、不重复登记放行', async () => {
    const sent: SentMessage_ACU[][] = [];
    const input = storyInput_ACU();
    input.budget.maxExtraReads = 2;
    // 预算 700：第一次宽地址被收窄；第二次重复同一宽地址不得再走分配、不得重注正文。
    const replies = [
      nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-9'] }, 'wide-first'),
      nativeToolTurn_ACU('read', { reads: ['$STORY_RANGE:1-9'] }, 'wide-repeat'),
      finalReply_ACU,
    ];
    const result = await runtime_ACU(58833, replies, sent).run(input);
    const first = toolContent_ACU(sent[1], 'wide-first');
    const parsed = /解析为「(\$STORY_RANGE:1-(\d+))」/.exec(first)!;
    const narrowedAddress = parsed[1];
    const upper = Number(parsed[2]);
    const repeated = toolContent_ACU(sent[2], 'wide-repeat');
    expect(repeated).toContain(`原地址「$STORY_RANGE:1-9」此前只提供了收窄子范围「${narrowedAddress}」的完整正文`);
    expect(repeated).toContain('未声称原地址已全部注入');
    // 坐标轴只含 AI 楼层（夹具中为奇数下标），剩余范围从 upper 之后的下一个 AI 楼层开始。
    expect(repeated).toContain(`请改读「$STORY_RANGE:${upper + 2}-9」`);
    expect(repeated).not.toContain('完整内容已提供');
    expect(repeated).not.toContain('【默认上围栏】');
    expect(repeated).not.toContain(floor_ACU(1));
    // 收窄子范围只登记一次放行；重复请求不产生新的 expandedReads。
    expect(result.expandedReads).toEqual([`${narrowedAddress}（默认上围栏，原地址 $STORY_RANGE:1-9）`]);
  });

});
