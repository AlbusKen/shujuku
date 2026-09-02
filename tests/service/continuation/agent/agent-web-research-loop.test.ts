import { beforeEach, describe, expect, it } from 'vitest';

import { ContinuationAgentTurnPlanner_ACU } from '../../../../src/service/continuation/agent/agent-main-loop';
import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';
import { buildEmptyAgentWorldbookSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { readAgentSessionLog_ACU, resetAgentSessionLogForTests_ACU } from '../../../../src/service/continuation/agent/agent-session-log';
import { resetAgentRunCacheForTests_ACU } from '../../../../src/service/continuation/agent/agent-run-cache';
import type { AgentWebClient_ACU, AgentFetchedPage_ACU } from '../../../../src/service/continuation/agent/agent-web-client';
import type { AgentConversationMessage_ACU, AgentConversationSnapshot_ACU, AgentModuleSnapshot_ACU, ContinuationAgentTurnPlanRequest_ACU } from '../../../../src/service/continuation/agent/agent-model';

const preset_ACU = { presetName: 'p1', source: 'settings' as const, reason: 'test' };

beforeEach(() => { resetAgentSessionLogForTests_ACU(); resetAgentRunCacheForTests_ACU(); });

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

function harness_ACU(options: { mainReplies: string[]; subReplies: string[]; enabled: boolean; context?: () => any; snapshot?: AgentModuleSnapshot_ACU }) {
  const mainReplies = [...options.mainReplies];
  const subReplies = [...options.subReplies];
  const mainCalls: Array<Array<{ role: string; content: string }>> = [];
  const subCalls: Array<Array<{ role: string; content: string }>> = [];
  const webLog: string[] = [];
  const written: AgentModuleSnapshot_ACU[] = [];
  const presetRoles: string[] = [];
  let snapshot = options.snapshot ?? { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0 };
  let conversation: AgentConversationSnapshot_ACU = buildEmptyAgentConversation_ACU();
  const chat = chat_ACU();

  const subagentRuntime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    resolveAgentApiPreset: (() => preset_ACU) as any,
    callInternalAi: async messages => { subCalls.push(messages); return subReplies.shift() ?? '{"summary":"没有更多回复","delta":{"webRefs":[]}}'; },
    webClient: fakeWebClient_ACU(webLog),
    hostOrigin: () => 'http://127.0.0.1:8000',
  });
  const planner = new ContinuationAgentTurnPlanner_ACU({
    resolveApiPreset: ((_settings: unknown, role: string) => { presetRoles.push(role); return preset_ACU; }) as any,
    callInternalAi: async messages => { mainCalls.push(messages); return mainReplies.shift() ?? '{"action":"block","reason":"脚本没有更多回复"}'; },
    subagentRuntime,
    readChat: () => chat,
    readModuleSnapshot: () => snapshot,
    writeModuleSnapshot: async (_chat, _index, next) => { written.push(next); snapshot = next; },
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
  return { planner, request, mainCalls, subCalls, webLog, written, presetRoles, snapshot: () => snapshot, conversation: () => conversation };
}

const RESEARCH_REPLIES_ACU = [
  '{"action":"encyclopedia_search","query":"鲁迪乌斯·格雷拉特","sources":["moegirl"]}',
  '{"action":"encyclopedia_read","source":"moegirl","title":"鲁迪乌斯·格雷拉特"}',
  '{"summary":"入库 1 条","delta":{"expectedRevisions":{"webRefs":0},"webRefs":[{"action":"upsert","pageRef":"P1","name":"鲁迪乌斯·格雷拉特","brief":"《无职转生》主角，转生的前尼特魔术师。","tags":["人物"],"detail":"身份：布耶纳村贵族长男。能力：帝级土系魔术。"}]}}',
];

describe('开场百科检索', () => {
  it('功能开启且新任务资料库为空时，先跑 web-researcher 写入资料库，主 Agent 第一次调用就能在运行时快照里看到预览', async () => {
    const h = harness_ACU({ enabled: true, mainReplies: ['{"action":"block","reason":"测试到此为止"}'], subReplies: RESEARCH_REPLIES_ACU });
    await expect(h.planner.plan(h.request)).rejects.toBeInstanceOf(Error);

    // 子代理三次调用：搜 → 读 → 契约；出网工具走假客户端。
    expect(h.subCalls).toHaveLength(3);
    expect(h.webLog).toEqual(['search:moegirl:鲁迪乌斯·格雷拉特', 'read:鲁迪乌斯·格雷拉特']);
    expect(h.presetRoles).toContain('webResearcher');
    // 首轮提示词带出网工具说明与开场任务；第二轮工具结果带候选与精读指令；第三轮带页面句柄。
    const first = h.subCalls[0].map(message => message.content).join('\n');
    expect(first).toContain('encyclopedia_search');
    expect(first).toContain('开场检索');
    expect(first).toContain('本次派工最多 3 页');
    const second = h.subCalls[1].map(message => message.content).join('\n');
    expect(second).toContain('百科检索「鲁迪乌斯·格雷拉特」');
    expect(second).toContain('"action":"encyclopedia_read"');
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
    expect(second).toContain('派工：已用 0 / 6');
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
    expect(second).toContain('派工：已用 1 / 6');
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
        '{"action":"encyclopedia_read","source":"moegirl","title":"鲁迪乌斯·格雷拉特"}',
        '{"action":"encyclopedia_read","source":"moegirl","title":"洛琪希","notes":["P1：鲁迪乌斯是《无职转生》主角，擅长土系魔术。"]}',
        '{"summary":"入库两条","delta":{"webRefs":[{"pageRef":"P1","name":"鲁迪乌斯","brief":"主角","detail":"擅长土系魔术。"},{"pageRef":"P2","name":"洛琪希","brief":"教师","detail":"魔术教师。"}]}}',
      ],
    });
    await expect(h.planner.plan(h.request)).rejects.toBeInstanceOf(Error);

    // 第二次调用临时看到 P1 原文；第三次调用只保留 P1 的 notes，同时临时看到 P2 原文。
    const second = h.subCalls[1].map(message => message.content).join('\n');
    expect(second).toContain('鲁迪乌斯·格雷拉特，本作主人公。');
    const third = h.subCalls[2].map(message => message.content).join('\n');
    expect(third).toContain('P1：鲁迪乌斯是《无职转生》主角，擅长土系魔术。');
    expect(third).toContain('【本次临时网页检索结果】');
    // P1 的网页全文没有进入第三次调用历史；唯一保留的是模型写的 notes。
    expect(third).not.toContain('泥沼：土系魔术，限制敌人行动。');
    expect(h.snapshot().webRefs).toHaveLength(2);
    expect(h.snapshot().webRefs.every(ref => !Object.prototype.hasOwnProperty.call(ref, 'extract'))).toBe(true);
  });
});
