import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings_ACU } from '../../../../src/service/runtime/state-manager';
import { nativeAgentReply_ACU } from '../../../helpers/agent-mode-fixture';

import { ContinuationAgentTurnPlanner_ACU } from '../../../../src/service/continuation/agent/agent-main-loop';
import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleSnapshot_ACU, writeAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { DEFAULT_AGENT_RUN_BUDGET_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';
import { buildEmptyAgentWorldbookSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { readAgentSessionLog_ACU, resetAgentSessionLogForTests_ACU } from '../../../../src/service/continuation/agent/agent-session-log';
import { resetAgentRunCacheForTests_ACU } from '../../../../src/service/continuation/agent/agent-run-cache';
import type { AgentWebClient_ACU, AgentFetchedPage_ACU } from '../../../../src/service/continuation/agent/agent-web-client';
import type { AgentConversationMessage_ACU, AgentConversationSnapshot_ACU, AgentModuleSnapshot_ACU, ContinuationAgentTurnPlanRequest_ACU } from '../../../../src/service/continuation/agent/agent-model';

const preset_ACU = { presetName: 'p1', source: 'settings' as const, reason: 'test', apiMode: 'custom' as const, apiConfig: { useMainApi: false, max_tokens: 60000 }, tavernProfile: '' };

const previousToolEnabled_ACU = settings_ACU.continuationNativeToolEnabled;
beforeEach(() => { settings_ACU.continuationNativeToolEnabled = true; resetAgentSessionLogForTests_ACU(); resetAgentRunCacheForTests_ACU(); });
afterEach(() => { settings_ACU.continuationNativeToolEnabled = previousToolEnabled_ACU; });

const chat_ACU = () => ([
  { mes: '写一篇无职转生同人，主角是鲁迪乌斯', is_user: true },
  { mes: '鲁迪乌斯推开教室门。', is_user: false },
]);

/** 新任务第一次规划：没有任何阶段与大纲。 */
const preOutlineContext_ACU = () => ({
  envelope: {} as any,
  task: { taskId: 'task-1', originInstruction: '写一篇无职转生同人，主角是鲁迪乌斯', stages: [] } as any,
  stage: null, revision: null, node: null, turn: null, turnNumber: null, nodeTurnNumber: null,
});

const runningContext_ACU = () => ({
  envelope: {} as any,
  task: { taskId: 'task-1', originInstruction: '写一篇无职转生同人', stages: [{ stageId: 'stage-1', stageNumber: 1, status: 'running' }] } as any,
  stage: { stageId: 'stage-1', stageNumber: 1, status: 'running' } as any,
  revision: { outline: { title: '开篇', goal: '入学', totalTurns: 6 } } as any,
  node: { id: 'node-1', title: '入学', goal: '入学', turns: [{ id: 'turn-1', goal: '推门' }] } as any,
  turn: { id: 'turn-1', goal: '推门' } as any,
  turnNumber: 1, nodeTurnNumber: 1,
});

const page_ACU = (title: string, text: string): AgentFetchedPage_ACU => ({ source: 'moegirl', title, url: `https://zh.moegirl.org.cn/${encodeURIComponent(title)}`, text, status: 'ok', note: '' });

const nativeWebToolTurn_ACU = (
  name: 'encyclopedia_search' | 'encyclopedia_read',
  args: Record<string, unknown>,
  id: string,
) => ({ content: '', toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

const nativeWriteSqlTurn_ACU = (sql: string, id: string) => ({
  content: '',
  toolCalls: [{ id, name: 'write_sql', arguments: JSON.stringify({ sql }) }],
});

function fakeWebClient_ACU(log: string[]): AgentWebClient_ACU {
  return {
    async searchEncyclopedia(source: string, query: string) {
      log.push(`search:${source}:${query}`);
      return { candidates: [{ source, title: '鲁迪乌斯·格雷拉特', url: 'https://zh.moegirl.org.cn/x', snippet: '' }], note: '' };
    },
    async readEncyclopedia(_source: string, title: string) {
      log.push(`read:${title}`);
      return page_ACU(
        title,
        title === '洛琪希'
          ? '洛琪希是鲁迪乌斯的家庭教师。\n擅长水系魔术。'
          : '鲁迪乌斯·格雷拉特，本作主人公。\n泥沼：土系魔术，限制敌人行动。',
      );
    },
    async webSearch(query: string) { log.push(`web:${query}`); return { hits: [], note: '' }; },
    async webRead(url: string) { log.push(`visit:${url}`); return { source: 'web', title: 'x', url, text: '', status: 'unavailable', note: 'nope' }; },
  } as unknown as AgentWebClient_ACU;
}

function harness_ACU(options: { mainReplies: string[]; subReplies: string[]; enabled: boolean; context?: () => any; snapshot?: AgentModuleSnapshot_ACU; toolMode?: 'json' | 'tools' }) {
  const nativeTools = options.toolMode !== 'json';
  settings_ACU.continuationNativeToolEnabled = nativeTools;
  const mainReplies = [...options.mainReplies];
  const subReplies = [...options.subReplies];
  const mainCalls: Array<Array<{ role: string; content: string }>> = [];
  const subCalls: Array<Array<{ role: string; content: string }>> = [];
  const mainToolOptions: Array<{ tools: string[]; cacheTools: string[] }> = [];
  const subToolOptions: Array<{ tools: string[]; cacheTools: string[] }> = [];
  const webLog: string[] = [];
  const written: AgentModuleSnapshot_ACU[] = [];
  const presetRoles: string[] = [];
  let conversation: AgentConversationSnapshot_ACU = buildEmptyAgentConversation_ACU();
  const chat = chat_ACU();
  _set_SillyTavern_API_ACU({ chat, saveChat: async () => { written.push(readAgentModuleSnapshot_ACU(chat)); } } as any);
  // SQL 逐栏提交从宿主 chat 帧折叠基线；不能只把种子放在测试的局部变量里。
  const ready = options.snapshot
    ? writeAgentModuleSnapshot_ACU(chat, chat.length - 1, options.snapshot).then(() => { written.length = 0; })
    : Promise.resolve();

  const subagentRuntime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    resolveAgentApiPreset: (() => preset_ACU) as any,
    callInternalAi: async (messages, _preset, _identity, _signal, callOptions) => {
      subCalls.push(messages);
      subToolOptions.push({ tools: callOptions?.tools?.map(tool => tool.function.name) ?? [], cacheTools: callOptions?.cacheTools ?? [] });
      // 显式模式用例在运行中翻转设置，主循环及子代理仍须使用起点协议。
      if (options.toolMode) settings_ACU.continuationNativeToolEnabled = !nativeTools;
      const reply = subReplies.shift() ?? '{"summary":"没有更多回复","delta":{"webRefs":[]}}';
      return nativeTools ? nativeAgentReply_ACU(reply) : reply;
    },
    webClient: fakeWebClient_ACU(webLog),
    hostOrigin: () => 'http://127.0.0.1:8000',
  });
  const plannerImpl = new ContinuationAgentTurnPlanner_ACU({
    resolveApiPreset: ((_settings: unknown, role: string) => { presetRoles.push(role); return preset_ACU; }) as any,
    callInternalAi: async (messages, _preset, _identity, _signal, callOptions) => {
      mainCalls.push(messages);
      mainToolOptions.push({ tools: callOptions?.tools?.map(tool => tool.function.name) ?? [], cacheTools: callOptions?.cacheTools ?? [] });
      const reply = mainReplies.shift() ?? '{"action":"block","reason":"脚本没有更多回复"}';
      return nativeTools ? nativeAgentReply_ACU(reply) : reply;
    },
    subagentRuntime,
    readChat: () => chat,
    readModuleSnapshot: readAgentModuleSnapshot_ACU,
    writeModuleSnapshot: writeAgentModuleSnapshot_ACU,
    readConversation: () => conversation,
    appendConversationMessages: async (_chat, prepared: readonly AgentConversationMessage_ACU[]) => {
      const existing = new Set(conversation.messages.map(message => message.id));
      const fresh = prepared.filter(message => !existing.has(message.id));
      if (!fresh.length) return false;
      const highest = fresh.reduce((max, message) => Math.max(max, message.id), conversation.nextId - 1);
      conversation = { ...conversation, nextId: highest + 1, messages: [...conversation.messages, ...fresh] };
      return true;
    },
    readCompactionMark: () => null,
    writeCompactionMark: async () => true,
    loadWorldbook: async () => buildEmptyAgentWorldbookSnapshot_ACU(true),
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 },
  });

  const settings = buildDefaultContinuationSettings_ACU();
  settings.internalAiRetryLimit = 1;
  settings.apiPresetMode = 'fixed';
  settings.fixedApiPresetName = 'p1';
  settings.webResearch.enabled = options.enabled;
  settings.webResearch.maxPages = 3;
  const request: ContinuationAgentTurnPlanRequest_ACU = {
    settings,
    readContext: options.context ?? preOutlineContext_ACU,
    createInternalRequestIdentity: attempt => ({ taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-1', attemptId: `a-${attempt}`, source: 'turn_instruction' }) as any,
    isInternalRequestCurrent: () => true,
    applyOutline: async () => ({ op: 'create', requiresReview: false, stopped: null, summary: '已创建大纲' }),
  };
  const planner = { plan: async (input: ContinuationAgentTurnPlanRequest_ACU) => { await ready; return plannerImpl.plan(input); } };
  return { planner, request, ready, mainCalls, subCalls, mainToolOptions, subToolOptions, webLog, written, presetRoles, snapshot: () => readAgentModuleSnapshot_ACU(chat), conversation: () => conversation };
}

const RESEARCH_REPLIES_ACU = [
  nativeWebToolTurn_ACU('encyclopedia_search', { query: '鲁迪乌斯·格雷拉特', sources: ['moegirl'] }, 'call-search-rudy'),
  nativeWebToolTurn_ACU('encyclopedia_read', { source: 'moegirl', title: '鲁迪乌斯·格雷拉特' }, 'call-read-rudy'),
  '{"summary":"入库 1 条","delta":{"expectedRevisions":{"webRefs":0},"webRefs":[{"action":"upsert","pageRef":"P1","name":"鲁迪乌斯·格雷拉特","brief":"《无职转生》主角，转生的前尼特魔术师。","tags":["人物"],"detail":"身份：布耶纳村贵族长男。能力：帝级土系魔术。"}]}}',
];

describe('开场百科检索', () => {
  it.each(['json', 'tools'] as const)('%s 开场检索写入资料库，主 Agent 首请求看到预览且沿用起点模式', async toolMode => {
    const sql = "INSERT INTO web_refs (page_ref, name, brief, tags, detail, expected_revision) VALUES ('P1', '鲁迪乌斯·格雷拉特', '《无职转生》主角，转生的前尼特魔术师。', '[\"人物\"]', '身份：布耶纳村贵族长男。能力：帝级土系魔术。', 0);";
    const h = harness_ACU({ enabled: true, toolMode, mainReplies: ['{"action":"block","reason":"测试到此为止"}'], subReplies: [
      JSON.stringify({ action: 'encyclopedia_search', query: '鲁迪乌斯·格雷拉特', sources: ['moegirl'] }),
      JSON.stringify({ action: 'encyclopedia_read', source: 'moegirl', title: '鲁迪乌斯·格雷拉特' }),
      JSON.stringify({ action: 'write_sql', sql }),
      '{"summary":"入库 1 条"}',
    ] });
    await expect(h.planner.plan(h.request)).rejects.toBeInstanceOf(Error);

    // 搜 → 读 → write_sql → 回执后的独立交付。
    expect(h.subCalls).toHaveLength(4);
    expect(h.webLog).toEqual(['search:moegirl:鲁迪乌斯·格雷拉特', 'read:鲁迪乌斯·格雷拉特']);
    expect(h.presetRoles).toContain('webResearcher');
    // 首轮提示词带出网工具说明与开场任务；第二轮工具结果带候选与精读指令；第三轮带页面句柄。
    const first = h.subCalls[0].map(message => message.content).join('\n');
    expect(first).toContain('encyclopedia_search');
    expect(first).toContain('INSERT INTO web_refs');
    expect(first).toContain('开场检索');
    expect(first).toContain('本次派工最多 3 页');
    const second = h.subCalls[1].map(message => message.content).join('\n');
    expect(second).toContain('百科检索「鲁迪乌斯·格雷拉特」');
    expect(second).toContain('调用 encyclopedia_read');
    const third = h.subCalls[2].map(message => message.content).join('\n');
    expect(third).toContain('[页面句柄 P1]');
    expect(third).toContain('泥沼：土系魔术');

    // 资料库落盘：url / 原文由运行时按 pageRef 回填，id 自动分配，不推进结算水位。
    expect(h.written).toHaveLength(1);
    const ref = h.written[0].webRefs[0];
    expect(ref).toMatchObject({ id: 'WR-001', title: '鲁迪乌斯·格雷拉特', brief: '《无职转生》主角，转生的前尼特魔术师。', source: 'moegirl', sourceStatus: 'ok' });
    expect(ref.url).toContain('zh.moegirl.org.cn');
    expect(ref).not.toHaveProperty('extract');
    expect(h.written[0].revisions.webRefs).toBe(1);
    expect(h.written[0].settledThroughIndex).toBe(0);

    // 主 Agent 的第一次调用：运行时快照里有预览行（名称 + 简介），没有详情与原文；目录里出现 web-researcher。
    expect(h.mainCalls).toHaveLength(1);
    const mainText = h.mainCalls[0].map(message => message.content).join('\n');
    expect(mainText).toContain('[WR-001]「鲁迪乌斯·格雷拉特」《无职转生》主角，转生的前尼特魔术师。');
    expect(mainText).not.toContain('布耶纳村贵族长男');
    expect(mainText).not.toContain('泥沼：土系魔术');
    expect(mainText).toContain('name: web-researcher');
    expect(mainText).toContain('web-researcher｜成功');
    expect(mainText).toContain('$WEB_REFS:ID');

    for (const [calls, captured] of [[h.subCalls, h.subToolOptions], [h.mainCalls, h.mainToolOptions]] as const) {
      calls.forEach((messages, index) => {
        const text = messages.map(message => message.content).join('\n');
        expect(text).not.toMatch(/\{"summary":"[^"]*","sql":/);
        if (toolMode === 'json') {
          expect(captured[index].tools).toEqual([]);
          expect(captured[index].cacheTools).toContain('mode:json');
          expect(text).not.toMatch(/函数调用|submit|原生 write_sql/);
          expect(messages.some(message => message.role === 'tool' || message.tool_calls || message.tool_call_id)).toBe(false);
        } else {
          expect(captured[index].tools).not.toEqual([]);
          expect(captured[index].cacheTools).not.toContain('mode:json');
          expect(text).not.toContain('我的最终交付是一个 JSON 对象');
        }
      });
    }
    expect(h.subToolOptions[0].tools).toEqual(toolMode === 'json' ? [] : ['read', 'search', 'encyclopedia_search', 'encyclopedia_read', 'web_search', 'web_read', 'write_sql', 'submit']);
    expect(h.subCalls[3].map(message => message.content).join('\n')).toContain('"status":"committed"');
    const log = readAgentSessionLog_ACU();
    expect(log.some(entry => entry.title.includes('开场百科检索完成'))).toBe(true);
  });

  it('功能关闭时不跑开场检索，目录里也没有 web-researcher；主 Agent 硬派它会被拒绝且不消耗派工额度', async () => {
    const h = harness_ACU({
      enabled: false,
      context: runningContext_ACU,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"web-researcher","prompt":"查设定","reads":[]}]}',
        '{"action":"finalize","instruction":"本轮指导","summary":"ok"}',
      ],
      subReplies: [],
    });
    const result = await h.planner.plan(h.request);
    expect(result.instruction).toBe('本轮指导');
    expect(h.subCalls).toHaveLength(0);
    expect(h.written).toHaveLength(0);
    const mainText = h.mainCalls[0].map(message => message.content).join('\n');
    expect(mainText).not.toContain('name: web-researcher');
    expect(mainText).toContain('百科资料库为空（网页检索功能未启用）');
    const second = h.mainCalls[1].map(message => message.content).join('\n');
    expect(second).toContain('网页检索功能未启用');
    expect(second).toContain(`派工：已用 0 / ${DEFAULT_AGENT_RUN_BUDGET_ACU.maxDelegations}`);
  });

  it('资料库已有条目或任务已有阶段时不重复开场检索；主 Agent 中途派工按普通派工落库', async () => {
    const seeded: AgentModuleSnapshot_ACU = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0 };
    const h = harness_ACU({
      enabled: true,
      context: runningContext_ACU,
      snapshot: seeded,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"web-researcher","prompt":"补查洛琪希","reads":[]}]}',
        '{"action":"finalize","instruction":"本轮指导","summary":"ok"}',
      ],
      subReplies: RESEARCH_REPLIES_ACU,
    });
    await h.planner.plan(h.request);
    // 有阶段 → 没有开场检索；只有主 Agent 那一次派工。
    expect(h.presetRoles.filter(role => role === 'webResearcher')).toHaveLength(1);
    expect(h.subCalls).toHaveLength(3);
    expect(h.written).toHaveLength(1);
    expect(h.written[0].webRefs).toHaveLength(1);
    const second = h.mainCalls[1].map(message => message.content).join('\n');
    expect(second).toContain('百科资料库：新增/更新 1 条');
    expect(second).toContain(`派工：已用 1 / ${DEFAULT_AGENT_RUN_BUDGET_ACU.maxDelegations}`);
  });

  it('web-researcher 的 SQL DELETE 经派工和领域事务退役已有百科条目', async () => {
    const seeded: AgentModuleSnapshot_ACU = {
      ...buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 0,
      webRefs: [{
        id: 'WR-001', title: '旧资料', source: 'web', url: 'https://example.com/entry',
        query: '', tags: [], brief: '旧资料', summary: '需要退役', sourceStatus: 'ok',
        fetchedAt: 1, retired: false, retiredReason: '',
      }],
    };
    const h = harness_ACU({
      enabled: true,
      context: runningContext_ACU,
      snapshot: seeded,
      mainReplies: [
        '{"action":"delegate","delegations":[{"agentName":"web-researcher","prompt":"退役失效资料","reads":[]}]}',
        '{"action":"finalize","instruction":"继续推进","summary":"ok"}',
      ],
      subReplies: [nativeWriteSqlTurn_ACU("DELETE FROM web_refs WHERE id = 'WR-001' AND reason = '来源失效' AND expected_revision = 0;", 'call-delete-webref')],
    });
    await h.planner.plan(h.request);
    expect(h.written).toHaveLength(1);
    expect(h.snapshot().webRefs[0]).toMatchObject({ id: 'WR-001', retired: true, retiredReason: '来源失效' });
    expect(h.snapshot().revisions.webRefs).toBe(1);
  });

  it('SQL UPDATE 仅修订简介时不要求重抓页面，未提供的来源与名称保持原样', async () => {
    const seeded: AgentModuleSnapshot_ACU = {
      ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0,
      webRefs: [{ id: 'WR-001', title: '旧资料', source: 'web', url: 'https://example.com/entry', query: '旧', tags: [], brief: '旧简介', summary: '旧详情', sourceStatus: 'ok', fetchedAt: 1, retired: false, retiredReason: '' }],
    };
    const h = harness_ACU({
      enabled: true, context: runningContext_ACU, snapshot: seeded,
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"web-researcher","prompt":"更新简介","reads":[]}] }', '{"action":"finalize","instruction":"继续推进","summary":"ok"}'],
      subReplies: [nativeWriteSqlTurn_ACU("UPDATE web_refs SET brief = '更新后的简介' WHERE id = 'WR-001' AND expected_revision = 0;", 'call-update-brief'), '{"summary":"更新简介","delta":{"webRefs":[]}}'],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(2);
    expect(h.webLog).toEqual([]);
    expect(h.written).toHaveLength(1);
    expect(h.snapshot().webRefs[0]).toMatchObject({ title: '旧资料', url: 'https://example.com/entry', brief: '更新后的简介', fetchedAt: 1 });
    expect(h.mainCalls[1].map(message => message.content).join('\n')).toContain('逐栏写入已独立保存');
  });

  it('SQL UPDATE 换源只接受本次抓取成功的页面句柄', async () => {
    const seeded: AgentModuleSnapshot_ACU = {
      ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0,
      webRefs: [{ id: 'WR-001', title: '旧资料', source: 'web', url: 'https://example.com/entry', query: '旧', tags: [], brief: '旧简介', summary: '', sourceStatus: 'ok', fetchedAt: 1, retired: false, retiredReason: '' }],
    };
    const h = harness_ACU({
      enabled: true, context: runningContext_ACU, snapshot: seeded,
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"web-researcher","prompt":"换来源","reads":[]}]}', '{"action":"finalize","instruction":"继续推进","summary":"ok"}'],
      subReplies: [
        nativeWebToolTurn_ACU('encyclopedia_read', { source: 'moegirl', title: '洛琪希' }, 'call-read-roxy'),
        nativeWriteSqlTurn_ACU("UPDATE web_refs SET page_ref = 'P1', name = '洛琪希', brief = '家庭教师' WHERE id = 'WR-001' AND expected_revision = 0;", 'call-update-source'),
        '{"summary":"换来源","delta":{"webRefs":[]}}',
      ],
    });
    await h.planner.plan(h.request);
    expect(h.webLog).toEqual(['read:洛琪希']);
    expect(h.written).toHaveLength(1);
    expect(h.snapshot().webRefs[0]).toMatchObject({ title: '洛琪希', source: 'moegirl', brief: '家庭教师', fetchedAt: expect.any(Number) });
    expect(h.snapshot().webRefs[0].url).toContain('zh.moegirl.org.cn');
  });

  it('SQL DELETE 声明的 revision 与派工读取快照不符时不退役资料', async () => {
    const seeded: AgentModuleSnapshot_ACU = {
      ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0,
      webRefs: [{ id: 'WR-001', title: '旧资料', source: 'web', url: 'https://example.com/entry', query: '', tags: [], brief: '旧资料', summary: '待核验', sourceStatus: 'ok', fetchedAt: 1, retired: false, retiredReason: '' }],
    };
    const h = harness_ACU({
      enabled: true, context: runningContext_ACU, snapshot: seeded,
      mainReplies: ['{"action":"delegate","delegations":[{"agentName":"web-researcher","prompt":"退役失效资料","reads":[]}]}', '{"action":"finalize","instruction":"继续推进","summary":"ok"}'],
      subReplies: [nativeWriteSqlTurn_ACU("DELETE FROM web_refs WHERE id = 'WR-001' AND reason = '来源失效' AND expected_revision = 1;", 'call-delete-stale-webref')],
    });
    await h.planner.plan(h.request);
    expect(h.subCalls).toHaveLength(2);
    expect(h.subCalls[1].map(message => message.content).join('\n')).toContain('revision_conflict');
    expect(h.written).toHaveLength(0);
    expect(h.snapshot().webRefs[0]).toMatchObject({ id: 'WR-001', retired: false });
  });

  it('契约引用了不存在的页面句柄时回灌可用句柄清单让子代理修正', async () => {
    const h = harness_ACU({
      enabled: true,
      mainReplies: ['{"action":"block","reason":"到此为止"}'],
      subReplies: [
        RESEARCH_REPLIES_ACU[0],
        RESEARCH_REPLIES_ACU[1],
        '{"summary":"x","delta":{"webRefs":[{"action":"upsert","pageRef":"P9","name":"鲁迪","brief":"主角"}]}}',
        RESEARCH_REPLIES_ACU[2],
      ],
    });
    await expect(h.planner.plan(h.request)).rejects.toBeInstanceOf(Error);
    expect(h.subCalls).toHaveLength(4);
    const correction = h.subCalls[3].map(message => message.content).join('\n');
    expect(correction).toContain('pageRef「P9」不在本次派工的工具结果里');
    expect(correction).toContain('可用句柄：P1');
    expect(h.written).toHaveLength(1);
  });

  it('网页正文只临时注入下一次调用：继续检索时只保留 notes，不把上一页正文带进子代理历史', async () => {
    const h = harness_ACU({
      enabled: true,
      mainReplies: ['{"action":"block","reason":"到此为止"}'],
      subReplies: [
        nativeWebToolTurn_ACU('encyclopedia_read', { source: 'moegirl', title: '鲁迪乌斯·格雷拉特' }, 'call-read-rudy-notes'),
        nativeWebToolTurn_ACU('encyclopedia_read', { source: 'moegirl', title: '洛琪希', notes: ['P1：鲁迪乌斯是《无职转生》主角，擅长土系魔术。'] }, 'call-read-roxy-notes'),
        '{"summary":"入库两条","delta":{"webRefs":[{"pageRef":"P1","name":"鲁迪乌斯","brief":"主角","detail":"擅长土系魔术。"},{"pageRef":"P2","name":"洛琪希","brief":"教师","detail":"魔术教师。"}]}}',
      ],
    });
    await expect(h.planner.plan(h.request)).rejects.toBeInstanceOf(Error);

    // 第一次网页读取的正文只进入紧接着的第二次请求；处理第二次工具调用时，
    // P1 正文被压缩为 notes，第三次请求只保留 notes 并临时看到 P2 正文。
    expect(h.subCalls).toHaveLength(3);
    const second = h.subCalls[1].map(message => message.content).join('\n');
    expect(second).toContain('鲁迪乌斯·格雷拉特，本作主人公。');
    const third = h.subCalls[2].map(message => message.content).join('\n');
    expect(third).toContain('P1：鲁迪乌斯是《无职转生》主角，擅长土系魔术。');
    expect(third).toContain('【网页工作笔记】');
    expect(third).toContain('洛琪希是鲁迪乌斯的家庭教师。');
    expect(third).not.toContain('泥沼：土系魔术，限制敌人行动。');
    expect(h.snapshot().webRefs).toHaveLength(2);
    expect(h.snapshot().webRefs.every(ref => !Object.prototype.hasOwnProperty.call(ref, 'extract'))).toBe(true);
  });
});
