import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { runWorldSimulationOneShotWorkflow_ACU } from '../../../../src/service/simulation/agent/agent-workflow';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../../src/service/simulation/agent/agent-session-log';
import { WorldSimulationSubagentRuntime_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
import { buildDefaultWorldSimulationAgentPrompts_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';
import type { WorldSimulationSubagentOutcome_ACU } from '../../../../src/service/simulation/agent/agent-model';
import { USER_PREFILL_CONTENT_ACU } from '../../../../src/shared/user-prefill.js';
import { nativeAgentReply_ACU } from '../../../helpers/agent-mode-fixture';


const noChange = (agentName: string): WorldSimulationSubagentOutcome_ACU => ({ agentName, status: 'no_change', summary: '无变化', evidenceRefs: [], uncertainties: [] });
const submitTurn = (status: 'candidate' | 'no_change' | 'failed', agentName = 'undercurrent-analyst', summary = '确认交付', evidenceRefs: string[] = []) =>
  nativeAgentReply_ACU(JSON.stringify(status === 'failed'
    ? { status, agentName, reasonCode: 'UNABLE_TO_COMPLETE', message: summary }
    : { status, agentName, summary, evidenceRefs, uncertainties: [] }))!;
// 模拟 provider 原生函数调用回包：有变化时 SQL 只能放在 write_sql 的 sql 参数里。
const sqlTurn = (payload: { sql: string; [key: string]: unknown }, id = 'call-sql') =>
  ({ content: '', toolCalls: [{ id, name: 'write_sql', arguments: JSON.stringify({ sql: payload.sql }) }] });
function setup() {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  const registry = createWorldSimulationEvidenceRegistry_ACU('one-shot-workflow');
  const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'anchor:message', status: 'ok', summary: '正文', exact: true }).evidenceRef!;
  const identity = { runId: 'one-shot-workflow', chatIdentity: 'one-shot-workflow', triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0',
    anchorContentDigest: 'digest', baseLedgerRevision: ledger.revision, taskId: 'task', stageId: 'stage', stageRevision: 1 };
  const promptContext = { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '',
    worldState: ledger, anchorMessage: '锚点正文', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [],
    worldCollisions: { playerRegion: null, playerContact: 'open' as const, secludedNote: null, collidedSeeds: [], ripeRumors: [] },
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} };
  const settings = buildDefaultWorldSimulationSettings_ACU();
  const tools = { read: vi.fn(), search: vi.fn() };
  const run = (runOneShot: (input: any) => Promise<WorldSimulationSubagentOutcome_ACU>) =>
    runWorldSimulationOneShotWorkflow_ACU({ identity, settings, promptContext, registry, tools,
      opening: { summary: '开局', focus: '锚点', dispatchChronicler: false, skipModules: [] }, subagents: { runOneShot } });
  return { ledger, ref, run };
}

describe('两批一次性格林推演工作流', () => {
  it('第一批同一轮并发启动，全部无变化时仍运行第二批并提交场外信号', async () => {
    const env = setup();
    const entered: string[] = [];
    const waits: Array<() => void> = [];
    const runOneShot = vi.fn((input: any) => new Promise<WorldSimulationSubagentOutcome_ACU>(resolve => {
      entered.push(input.agentName);
      if (input.agentName === 'guidance-composer') {
        resolve({ agentName: input.agentName, status: 'candidate', summary: '投影钟声', evidenceRefs: [env.ref], uncertainties: [],
          candidate: { candidateId: 'guidance-2', agentName: input.agentName,
            patch: { guidance: { signals: [{ text: '远处传来钟声', voice: 'ambient', sourceId: 'clock' }],
              expectedRevision: input.baseLedgerRevision, evidenceRefs: [env.ref] } },
            summary: '投影钟声', evidenceRefs: [env.ref], uncertainties: [], writableModules: ['guidance'] } } as WorldSimulationSubagentOutcome_ACU);
        return;
      }
      waits.push(() => resolve(noChange(input.agentName)));
    }));
    const pending = env.run(runOneShot);
    expect(entered).toEqual(['undercurrent-analyst', 'dramatis-keeper']);
    waits.forEach(release => release());
    const result = await pending;
    expect(entered).toEqual(['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer']);
    expect(result.outcome).toBe('commit');
    expect(result.commitCandidate?.acceptedCandidates.map(item => item.candidateId)).toEqual(['guidance-2']);
  });

  it('全部派工失败时阻断而不升级导演', async () => {
    const env = setup();
    const runOneShot = vi.fn(async () => { throw new Error('传输失败'); });
    const result = await env.run(runOneShot);
    expect(result.outcome).toBe('blocked');
    expect(result.escalated).toBe(false);
    expect(result.commitCandidate).toBeUndefined();
    expect(runOneShot).toHaveBeenCalledTimes(3);
  });

  it('第二批等待并发的第一批结束，按相同 base 重放并保留被接受的候选', async () => {
    const env = setup();
    const entered: string[] = [];
    const release: Array<() => void> = [];
    const clock = { candidateId: 'one-shot-workflow:undercurrent-analyst:1', agentName: 'undercurrent-analyst',
      summary: '推进一天', patch: { clock: { days: 1, expectedRevision: 0, evidenceRefs: [env.ref] } },
      evidenceRefs: [env.ref], uncertainties: [], writableModules: ['clock'] };
    const runOneShot = vi.fn((input: any) => new Promise<WorldSimulationSubagentOutcome_ACU>(resolve => {
      entered.push(input.agentName);
      if (input.agentName === 'guidance-composer') {
        expect(input.givenLedger.clock.day).toBe(env.ledger.clock.day + 1);
        expect(input.baseLedgerRevision).toBe(env.ledger.revision);
        resolve(noChange(input.agentName));
      } else release.push(() => resolve(input.agentName === 'undercurrent-analyst'
        ? { agentName: input.agentName, status: 'candidate', summary: '推进一天', candidate: clock,
          evidenceRefs: [env.ref], uncertainties: [] } as WorldSimulationSubagentOutcome_ACU
        : noChange(input.agentName)));
    }));
    const pending = env.run(runOneShot);
    expect(entered).toEqual(['undercurrent-analyst', 'dramatis-keeper']);
    release[0]();
    await Promise.resolve();
    expect(entered).toHaveLength(2);
    release[1]();
    const result = await pending;
    expect(entered.slice(0, 3)).toEqual(['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer']);
    expect(entered.filter(name => name === 'guidance-composer')).toHaveLength(3);
    expect(result.outcome).toBe('commit');
    expect(result.commitCandidate?.acceptedCandidates.map(item => item.candidateId)).toEqual([clock.candidateId]);
  });

  it('第二批 guidance 使用运行 base 修订号并与第一批一次性重放', async () => {
    const env = setup();
    const calls: string[] = [];
    const runOneShot = vi.fn(async (input: any): Promise<WorldSimulationSubagentOutcome_ACU> => {
      calls.push(input.agentName);
      if (input.agentName === 'undercurrent-analyst') return {
        agentName: input.agentName, status: 'candidate', summary: '推进一天', evidenceRefs: [env.ref], uncertainties: [],
        candidate: { candidateId: 'clock-1', agentName: input.agentName,
          patch: { clock: { days: 1, expectedRevision: env.ledger.revision, evidenceRefs: [env.ref] } },
          summary: '推进一天', evidenceRefs: [env.ref], uncertainties: [], writableModules: ['clock'] },
      };
      if (input.agentName === 'guidance-composer') {
        expect(input.givenLedger.revision).toBeGreaterThan(env.ledger.revision);
        return { agentName: input.agentName, status: 'candidate', summary: '投影钟声', evidenceRefs: [env.ref], uncertainties: [],
          candidate: { candidateId: 'guidance-2', agentName: input.agentName,
            patch: { guidance: { signals: [{ text: '远处传来钟声', voice: 'ambient', sourceId: 'clock' }],
              expectedRevision: input.baseLedgerRevision, evidenceRefs: [env.ref] } },
            summary: '投影钟声', evidenceRefs: [env.ref], uncertainties: [], writableModules: ['guidance'] } };
      }
      return noChange(input.agentName);
    });
    const result = await env.run(runOneShot);
    expect(calls).toEqual(['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer']);
    expect(result.outcome).toBe('commit');
    expect(result.commitCandidate?.acceptedCandidates.map(item => item.candidateId)).toEqual(['clock-1', 'guidance-2']);
    expect(result.pendingFixes).toEqual([]);
  });

  it('人物死亡与伴生传闻同候选可落账；遗漏传闻则拒绝该候选而保留另一批次一候选', async () => {
    for (const withRumor of [true, false]) {
      resetWorldSimulationSessionLogForTests_ACU();
      const env = setup();
      const dead = { id: 'actor-dead', name: '死者', interests: [], location: '', locationRef: null,
        life: 'dead', diedAtDay: 1, deathSummary: '战死', resources: [], goals: [], constraints: [],
        informationSources: [], knownFacts: [], visibility: 'hidden', expectedRevision: 0 };
      const rumor = { id: 'rumor-death', fact: '有人战死', originDay: 1, earliestRevealDay: 1,
        channels: ['north'], relatedActorIds: ['actor-dead'], status: 'latent', revealedAtDay: null, expectedRevision: 0 };
      const runOneShot = vi.fn(async (input: any): Promise<WorldSimulationSubagentOutcome_ACU> => {
        if (input.agentName === 'guidance-composer') return noChange(input.agentName);
        const candidate = input.agentName === 'undercurrent-analyst'
          ? { candidateId: 'clock', agentName: input.agentName, patch: { clock: { days: 1, evidenceRefs: [env.ref], expectedRevision: 0 } },
            summary: '推进一天', evidenceRefs: [env.ref], uncertainties: [], writableModules: ['clock'] }
          : { candidateId: 'death', agentName: input.agentName,
            patch: { actors: { upsert: [dead] }, ...(withRumor ? { rumors: { upsert: [rumor] } } : {}) },
            summary: '人物死亡', evidenceRefs: [env.ref], uncertainties: [], writableModules: ['actors', 'rumors'] };
        return { agentName: input.agentName, status: 'candidate', summary: candidate.summary,
          evidenceRefs: [env.ref], uncertainties: [], candidate } as WorldSimulationSubagentOutcome_ACU;
      });
      const result = await env.run(runOneShot);
      expect(result.outcome).toBe('commit');
      expect(result.commitCandidate?.acceptedCandidates.map(item => item.candidateId)).toEqual(withRumor ? ['clock', 'death'] : ['clock']);
      if (withRumor) {
        expect(result.ledger.actors[0].life).toBe('dead');
        expect(result.ledger.rumors[0].relatedActorIds).toContain('actor-dead');
      } else {
        expect(result.ledger.actors).toEqual([]);
        expect(result.pendingFixes).toEqual(expect.arrayContaining([expect.objectContaining({ module: 'actors' })]));
        const entries = readWorldSimulationSessionLog_ACU('one-shot-workflow');
        expect(entries.find(item => item.agentName === 'dramatis-keeper' && item.kind === 'delegation'))
          .toMatchObject({ status: 'failed', ok: false, title: expect.stringContaining('事务校验失败') });
        expect(entries.find(item => item.agentName === 'undercurrent-analyst' && item.kind === 'delegation'))
          .toMatchObject({ status: 'done', ok: true, title: expect.stringContaining('已通过事务校验') });
      }
    }
  });

  it('一次性运行时对非法回复仅修正一次，原生 write_sql 候选可恢复，持续非法返回失败', async () => {
    const env = setup();
    const registry = createWorldSimulationEvidenceRegistry_ACU('runtime-repair');
    const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'anchor:message', status: 'ok', summary: '锚点', exact: true }).evidenceRef!;
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const input = { agentName: 'undercurrent-analyst' as const, toolMode: 'tools' as const, settings, registry, tools: { read: vi.fn(), search: vi.fn() },
      promptContext: { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '',
        worldState: env.ledger, anchorMessage: '锚点正文', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [],
        worldCollisions: { playerRegion: null, playerContact: 'open' as const, secludedNote: null, collidedSeeds: [], ripeRumors: [] },
        evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} },
      runId: 'runtime-repair', candidateSeq: 1, focus: '锚点', anchorEvidenceRef: ref, givenLedger: env.ledger,
      baseLedgerRevision: env.ledger.revision, injectWorldbook: false };
    const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as const, apiConfig: { max_tokens: 4096 }, tavernProfile: '' }) };
    const invoke = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(submitTurn('no_change'));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    expect((await runtime.runOneShot(input)).status).toBe('no_change');
    expect(invoke).toHaveBeenCalledTimes(2);
    const empty = vi.fn().mockResolvedValueOnce({ content: '', toolCalls: [] })
      .mockResolvedValueOnce(submitTurn('no_change', input.agentName, '无可证实变化'));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: empty, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('no_change');
    const jsonFeedback = JSON.stringify(empty.mock.calls[1][1]);
    expect(jsonFeedback).toContain('WORLD_SIMULATION_ONE_SHOT_TOOL_REQUIRED');
    expect(jsonFeedback).toContain('只重新调用一次 write_sql');
    expect(jsonFeedback).toContain('不得将空回复视为无变化');
    const noJson = vi.fn(async () => ({ content: '', toolCalls: [] }));
    const noJsonResult = await new WorldSimulationSubagentRuntime_ACU({ invoke: noJson, apiPreset,
      countTokens: async () => 1 }).runOneShot(input);
    expect(noJsonResult.status).toBe('failed');
    expect(noJsonResult.candidate).toBeUndefined();
    expect(noJsonResult.unresolvedIssues).toEqual([]);
    expect(noJson).toHaveBeenCalledTimes(2);
    const timeAnchor = '昨日出城，今日已过一昼夜；昨日之前的路程不再计入。';
    const withTime = { ...input, promptContext: { ...input.promptContext, anchorMessage: timeAnchor } };
    const timeInvoke = vi.fn(async (name: string) => submitTurn('no_change', name));
    const timeRuntime = new WorldSimulationSubagentRuntime_ACU({ invoke: timeInvoke, apiPreset,
      countTokens: async () => 1 });
    await Promise.all([timeRuntime.runOneShot(withTime), timeRuntime.runOneShot({ ...withTime, agentName: 'dramatis-keeper' })]);
    expect(timeInvoke).toHaveBeenCalledTimes(2);
    for (const [, messages] of timeInvoke.mock.calls) {
      const body = JSON.stringify(messages);
      expect(body).toContain(timeAnchor);
      expect(body).toContain('共同时间基准');
      expect(body).toContain('当前已提交日为 1');
      expect(body).toContain('不把回忆或既已计入的旅程重复累加');
    }
    expect(timeInvoke.mock.calls.map(([, messages]) => JSON.stringify(messages).match(/本轮共享的明确经过天数为 (\d+)/)?.[1])).toEqual(['1', '1']);
    expect(JSON.stringify(timeInvoke.mock.calls[1][1])).toContain('dramatis-keeper 不写 clock');
    const invalid = vi.fn(async () => 'not json');
    const failed = await new WorldSimulationSubagentRuntime_ACU({ invoke: invalid, apiPreset, countTokens: async () => 1 }).runOneShot(input);
    expect(failed.status).toBe('failed');
    expect(invalid).toHaveBeenCalledTimes(2);
    const forbidden = vi.fn().mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'write-1', name: 'write_sql', arguments: '{}' }] })
      .mockResolvedValueOnce(submitTurn('no_change'));
    // 非法 write_sql 之后不能用 NO_CHANGE 掩盖；纠错回执以 role=tool 绑定原调用 id。
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: forbidden, apiPreset, countTokens: async () => 1 }).runOneShot(input)).status).toBe('failed');
    expect(forbidden).toHaveBeenCalledTimes(2);
    expect(forbidden.mock.calls[0][3].tools.map(tool => tool.function.name)).toContain('write_sql');
    expect((forbidden.mock.calls[1][1] as Array<{ role: string; tool_call_id?: string }>).some(message => message.role === 'tool' && message.tool_call_id === 'write-1')).toBe(true);
    expect(input.tools.read).not.toHaveBeenCalled();
    // 思考正文不代替交付；合法终态来自独立 submit 参数。
    const thinking = vi.fn(async () => ({ ...submitTurn('no_change') as any, content: '<think>已核对完毕</think>' }));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: thinking, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('no_change');
    expect(thinking).toHaveBeenCalledTimes(1);
    const firstRequest = thinking.mock.calls[0][1] as Array<{ role: string; content: unknown }>;
    // 提示词末尾的 user 段按用户设置原样发送：它必须是请求最后一条，且只出现一次；
    // 不能被换成 assistant <think> 预填充，否则请求以 model turn 结尾，Gemini 会直接 400。
    expect(firstRequest.at(-1)).toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
    expect(firstRequest.filter(message => message.content === USER_PREFILL_CONTENT_ACU)).toHaveLength(1);
    expect(firstRequest.some(message => message.role === 'assistant' && String(message.content).trim() === '<think>')).toBe(false);
    expect(JSON.stringify(firstRequest)).not.toMatch(/reads\\?":\[\\?"ledger:current/);
    const thinkingFailed = vi.fn(async () => submitTurn('failed', input.agentName, '无法完成'));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: thinkingFailed, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('failed');
    expect(thinkingFailed).toHaveBeenCalledTimes(1);
    const unclosed = vi.fn(async () => '<think>思考被截断 NO_CHANGE');
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: unclosed, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('failed');
    expect(unclosed).toHaveBeenCalledTimes(2);
    const trailing = vi.fn(async () => '<think>ok</think>\nNO_CHANGE\n补充解释');
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: trailing, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('failed');

    const previewLedger = { ...env.ledger, revision: env.ledger.revision + 1 };
    const guidanceInput = { ...input, agentName: 'guidance-composer' as const,
      givenLedger: previewLedger, promptContext: { ...input.promptContext, worldState: previewLedger } };
    const guidanceReply = sqlTurn({ agentName: 'guidance-composer',
      sql: "UPDATE guidance SET signals = '[]', excluded_facts = '[]' WHERE expected_revision = 999" });
    const guidanceInvoke = vi.fn().mockResolvedValueOnce(guidanceReply).mockResolvedValueOnce(submitTurn('candidate', 'guidance-composer', '确认交付', [ref]));
    const guidanceResult = await new WorldSimulationSubagentRuntime_ACU({ invoke: guidanceInvoke, apiPreset,
      countTokens: async () => 1 }).runOneShot(guidanceInput);
    expect(guidanceResult.status).toBe('candidate');
    expect(guidanceResult.candidate?.patch.guidance).toMatchObject({ expectedRevision: env.ledger.revision });
    expect(guidanceInvoke).toHaveBeenCalledTimes(2);
    // 批次二串行读取批次一预览：直接采用已推进的 clock，不再按“已提交日 + 经过天数”叠加。
    const guidanceSent = JSON.stringify(guidanceInvoke.mock.calls[0][1]);
    expect(guidanceSent).toContain('不再叠加经过天数');
    expect(guidanceSent).not.toContain('当前已提交日为');
    const invalidEnum = sqlTurn({ agentName: 'undercurrent-analyst',
      sql: "INSERT INTO dimensions (name, kind, value, trend, rationale) VALUES ('戒备', '政治', 40, 'rising', '盘查加剧'); INSERT INTO seeds (title, visibility) VALUES ('暗流', '公开')" });
    const correctEnum = sqlTurn({ agentName: 'undercurrent-analyst',
      sql: "INSERT INTO dimensions (name, kind, value, trend, rationale) VALUES ('戒备', 'pressure', 40, 'rising', '盘查加剧')" });
    const corrected = vi.fn().mockResolvedValueOnce(invalidEnum).mockResolvedValueOnce(correctEnum).mockResolvedValueOnce(submitTurn('candidate', 'undercurrent-analyst', '确认交付', [ref]));
    const correctedOutcome = await new WorldSimulationSubagentRuntime_ACU({ invoke: corrected, apiPreset, countTokens: async () => 1 }).runOneShot(input);
    expect(correctedOutcome.status).toBe('candidate');
    expect(corrected).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(corrected.mock.calls[1][1])).toContain('patch.dimensions.upsert[0].kind');
    const twiceInvalid = vi.fn(async () => invalidEnum);
    const rejected = await new WorldSimulationSubagentRuntime_ACU({ invoke: twiceInvalid, apiPreset, countTokens: async () => 1 }).runOneShot(input);
    expect(rejected.status).toBe('failed');
    expect(rejected.summary).toContain('patch.seeds.upsert[0].visibility');
    expect(twiceInvalid).toHaveBeenCalledTimes(2);
    const playerInput = { ...input, agentName: 'dramatis-keeper' as const };
    const illegalPlayer = sqlTurn({ agentName: 'dramatis-keeper',
      sql: "UPDATE player SET location_updated_at_day = 1 WHERE expected_revision = 0" });
    const playerReplies = vi.fn().mockResolvedValueOnce(illegalPlayer).mockResolvedValueOnce(sqlTurn({
      status: 'candidate', agentName: 'dramatis-keeper', sql: "UPDATE player SET contact = 'open' WHERE expected_revision = 0" })).mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: playerReplies, apiPreset, countTokens: async () => 1 }).runOneShot(playerInput)).status).toBe('candidate');
    expect(JSON.stringify(playerReplies.mock.calls[1][1])).toContain('SQL_COLUMN_FORBIDDEN');
    // 越列回执须带出该表合法列，纠错轮才能改对而非再猜一次。
    expect(JSON.stringify(playerReplies.mock.calls[1][1])).toContain('player(location, contact, evidence_refs)');
    expect(JSON.stringify(playerReplies.mock.calls[1][1])).toContain('whitelisted column: location, contact');
    // actors.location 写成 JSON 时，纠错回执须以 role=tool 绑定原调用，并指明改用 location_ref。
    const actorJson = { content: '', toolCalls: [{ id: 'actor-sql-1', name: 'write_sql', arguments: JSON.stringify({ sql: "INSERT INTO actors (name, interests, location, goals, information_sources, known_facts) VALUES ('陈默', '[\"查案\"]', '{\"region\":\"上阳城\"}', '[\"查明鬼船\"]', '[\"亲历\"]', '[\"奉命南下\"]')" }) }] };
    const actorFixed = { content: '', toolCalls: [{ id: 'actor-sql-2', name: 'write_sql', arguments: JSON.stringify({ sql: "INSERT INTO actors (name, interests, location, location_ref, goals, information_sources, known_facts) VALUES ('陈默', '[\"查案\"]', '上阳城·大理寺', '{\"region\":\"上阳城\"}', '[\"查明鬼船\"]', '[\"亲历\"]', '[\"奉命南下\"]')" }) }] };
    const actorReplies = vi.fn().mockResolvedValueOnce(actorJson).mockResolvedValueOnce(actorFixed).mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: actorReplies, apiPreset, countTokens: async () => 1 }).runOneShot(playerInput)).status).toBe('candidate');
    const actorRetry = actorReplies.mock.calls[1][1] as Array<{ role: string; tool_call_id?: string; content: string }>;
    const actorReceipt = actorRetry.find(message => message.role === 'tool' && message.tool_call_id === 'actor-sql-1');
    expect(actorReceipt?.content).toContain('actors.location 是地名纯文本');
    expect(actorRetry.some(message => message.role === 'user' && message.content.startsWith('上一次提交未被采纳'))).toBe(false);
    // read 超额的拒绝原因可辨认，不再只有裸错误码。
    const doubleRead = vi.fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'r1', name: 'read', arguments: '{"reads":["actors:missing"]}' }] })
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'r2', name: 'read', arguments: '{"reads":["actors:missing"]}' }] })
      .mockResolvedValueOnce(submitTurn('no_change', 'dramatis-keeper'));
    const readSettings = { ...settings, agentRunBudget: { ...settings.agentRunBudget, maxExtraReads: 1 } };
    // 独立的 read 桩，避免污染后续“从未读取”的断言。
    const isolatedTools = { read: vi.fn(async () => ({ found: false })), search: vi.fn() };
    const readResult = await new WorldSimulationSubagentRuntime_ACU({ invoke: doubleRead, apiPreset, countTokens: async () => 1 }).runOneShot({ ...playerInput, settings: readSettings, tools: isolatedTools as typeof playerInput.tools });
    // 额度拒绝可能以 role=tool 回执给模型，也可能在纠错次数用完时成为失败摘要；两处都必须带出可辨认的原因。
    const thirdRequest = doubleRead.mock.calls[2]?.[1] as Array<{ role: string; tool_call_id?: string; content: string }> | undefined;
    const readReason = thirdRequest ? thirdRequest.find(message => message.tool_call_id === 'r2')?.content : readResult.summary;
    expect(readReason).toContain('read 额度');
    // 共享工具目录历史上宣传过 evidenceRefs：收到就忽略，不能判成「多余参数」失败。
    const withEvidenceRefs = vi.fn().mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'ev-1', name: 'write_sql',
      arguments: JSON.stringify({ sql: "UPDATE player SET contact = 'open' WHERE expected_revision = 0", evidenceRefs: ['evidence:run-1:1'] }) }] }).mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    const evidenceOutcome = await new WorldSimulationSubagentRuntime_ACU({ invoke: withEvidenceRefs, apiPreset, countTokens: async () => 1 }).runOneShot(playerInput);
    expect(evidenceOutcome.status).toBe('candidate');
    expect(withEvidenceRefs).toHaveBeenCalledTimes(2);
    // 首轮建账只写了 clock：候选独立交付，未覆盖模块留待下一轮补录。
    const clockOnly = vi.fn().mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'cov-1', name: 'write_sql',
      arguments: JSON.stringify({ sql: "UPDATE clock SET days = 1 WHERE expected_revision = 0" }) }] }).mockResolvedValueOnce(submitTurn('candidate', 'undercurrent-analyst', '确认交付', [ref]));
    const coverage = await new WorldSimulationSubagentRuntime_ACU({ invoke: clockOnly, apiPreset, countTokens: async () => 1 }).runOneShot(input);
    expect(clockOnly).toHaveBeenCalledTimes(2);
    expect(coverage.status).toBe('candidate');
    expect(coverage.candidate?.patch.clock).toBeDefined();
    expect(coverage.summary).toContain('留待下一轮补录');
    expect(coverage.unresolvedIssues?.map(item => item.module).sort()).toEqual(['dimensions', 'seeds']);
    expect(JSON.stringify(coverage.unresolvedIssues)).toContain('首轮建账未覆盖');

    // write_sql 的函数声明只暴露 sql，避免模型照着目录填 evidenceRefs 再被拒。
    const writeTool = withEvidenceRefs.mock.calls[0][3].tools.find(tool => tool.function.name === 'write_sql');
    expect(writeTool?.function.parameters.properties).toEqual({ sql: { type: 'string' } });
    expect(writeTool?.function.parameters.additionalProperties).toBe(false);
    // 子代理的读取与被拒提交必须进会话流，和智能续写主循环一致。
    resetWorldSimulationSessionLogForTests_ACU();
    const loggedReplies = vi.fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'log-1', name: 'read', arguments: '{"reads":["actors:missing"]}' }] })
      .mockResolvedValueOnce(sqlTurn({ agentName: 'dramatis-keeper', sql: "UPDATE player SET location_updated_at_day = 1 WHERE expected_revision = 0" }, 'log-2'))
      .mockResolvedValueOnce(sqlTurn({ agentName: 'dramatis-keeper', sql: "UPDATE player SET contact = 'open' WHERE expected_revision = 0" }, 'log-3'))
      .mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    await new WorldSimulationSubagentRuntime_ACU({ invoke: loggedReplies, apiPreset, countTokens: async () => 1 }).runOneShot({
      ...playerInput, settings: readSettings, sessionChatIdentity: 'one-shot-session',
      tools: { read: vi.fn(async () => ({ found: false })), search: vi.fn() } as typeof playerInput.tools });
    const feed = readWorldSimulationSessionLog_ACU('one-shot-session');
    expect(feed.map(item => item.kind)).toEqual(expect.arrayContaining(['tool_read', 'write_sql', 'protocol_retry']));
    expect(feed.every(item => item.agentName === 'dramatis-keeper')).toBe(true);
    // 提交的 SQL 原文由 write_sql 条目完整承载；被拒的那条回写为失败，成功的那条标已通过校验。
    const writeEntries = feed.filter(item => item.kind === 'write_sql');
    expect(writeEntries).toHaveLength(2);
    expect(writeEntries[0].detail).toContain("UPDATE player SET location_updated_at_day = 1");
    expect(writeEntries[0].ok).toBe(false);
    expect(writeEntries[0].title).toContain('提交被拒');
    expect(writeEntries[1].detail).toContain("UPDATE player SET contact = 'open'");
    expect(writeEntries[1].ok).toBe(true);
    const retryEntry = feed.find(item => item.kind === 'protocol_retry');
    expect(retryEntry?.detail).toContain('SQL_COLUMN_FORBIDDEN');
    expect(retryEntry?.ok).toBe(false);
    // 宽容格式：合法语句先落账，非法语句在回执一轮后仍未修好时留给下一轮补录，不整批丢弃。
    const mixedSql = "UPDATE player SET contact = 'open' WHERE expected_revision = 0; UPDATE player SET location_updated_at_day = 1 WHERE expected_revision = 0";
    const mixedReplies = vi.fn().mockResolvedValueOnce(sqlTurn({ sql: mixedSql }, 'mix-1'))
      .mockResolvedValueOnce(sqlTurn({ sql: mixedSql }, 'mix-2')).mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    const partial = await new WorldSimulationSubagentRuntime_ACU({ invoke: mixedReplies, apiPreset, countTokens: async () => 1 }).runOneShot(playerInput);
    // 第一轮先回执要求修正，第二轮仍未修好才部分落账。
    expect(mixedReplies).toHaveBeenCalledTimes(3);
    expect(partial.status).toBe('candidate');
    expect(partial.candidate?.patch.player).toMatchObject({ contact: 'open' });
    expect(partial.summary).toContain('留待下一轮补录');
    expect(JSON.stringify(partial.unresolvedIssues)).toContain('SQL_COLUMN_FORBIDDEN');
    // 残余包含被拒的 SQL，以及首轮建账尚未覆盖的 actors。
    expect(partial.unresolvedIssues?.map(item => item.module).sort()).toEqual(['actors', 'player']);
    // 首轮已有合法语句、纠错轮整批失效时，落账首轮那部分，不退回全失败。
    const salvageReplies = vi.fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'sal-1', name: 'write_sql', arguments: JSON.stringify({ sql: mixedSql }) }] })
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'sal-2', name: 'write_sql', arguments: JSON.stringify({ sql: "UPDATE player SET region_visits = '[]' WHERE expected_revision = 0" }) }] })
      .mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    const salvaged = await new WorldSimulationSubagentRuntime_ACU({ invoke: salvageReplies, apiPreset, countTokens: async () => 1 }).runOneShot(playerInput);
    expect(salvageReplies).toHaveBeenCalledTimes(3);
    expect(salvaged.status).toBe('candidate');
    expect(salvaged.candidate?.patch.player).toMatchObject({ contact: 'open' });
    expect(salvaged.summary).toContain('留待下一轮补录');
    expect(salvaged.unresolvedIssues?.map(item => item.module).sort()).toEqual(['actors', 'player']);
    // 全部语句非法时仍然失败，不能凭空产出候选。
    const allBad = vi.fn(async () => ({ content: '', toolCalls: [{ id: 'bad-1', name: 'write_sql', arguments: JSON.stringify({ sql: "UPDATE player SET location_updated_at_day = 1 WHERE expected_revision = 0" }) }] }));
    const allBadOutcome = await new WorldSimulationSubagentRuntime_ACU({ invoke: allBad, apiPreset, countTokens: async () => 1 }).runOneShot(playerInput);
    expect(allBadOutcome.status).toBe('failed');
    expect(allBad).toHaveBeenCalledTimes(2);
    const badSeed = sqlTurn({ agentName: 'undercurrent-analyst',
      sql: "INSERT INTO seeds (title, status, actor_ids) VALUES ('暗流', 'incubating', '[{\"id\":\"actor-1\"}]')" });
    const fixedSeed = sqlTurn({ agentName: 'undercurrent-analyst',
      sql: "INSERT INTO seeds (title, status) VALUES ('暗流', 'incubating')" });
    const seedReplies = vi.fn().mockResolvedValueOnce(badSeed).mockResolvedValueOnce(fixedSeed).mockResolvedValueOnce(submitTurn('candidate', 'undercurrent-analyst', '确认交付', [ref]));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: seedReplies, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('candidate');
    expect(JSON.stringify(seedReplies.mock.calls[1][1])).toContain('actorIds');
    const badPlayer = sqlTurn({ agentName: 'dramatis-keeper',
      sql: "UPDATE player SET location = '江南府', contact = 'open'" });
    const correctedPlayer = sqlTurn({ agentName: 'dramatis-keeper',
      sql: "UPDATE player SET location = '{\"region\":\"江南府\"}', contact = 'open' WHERE expected_revision = 0" });
    const playerRepair = vi.fn().mockResolvedValueOnce(badPlayer).mockResolvedValueOnce(correctedPlayer).mockResolvedValueOnce(submitTurn('candidate', 'dramatis-keeper', '确认交付', [ref]));
    const repaired = await new WorldSimulationSubagentRuntime_ACU({ invoke: playerRepair, apiPreset,
      countTokens: async () => 1 }).runOneShot(playerInput);
    expect(repaired.status).toBe('candidate');
    expect(JSON.stringify(playerRepair.mock.calls[1][1])).toContain('location');
    const unrepaired = vi.fn(async () => badPlayer);
    const failedPlayer = await new WorldSimulationSubagentRuntime_ACU({ invoke: unrepaired, apiPreset,
      countTokens: async () => 1 }).runOneShot(playerInput);
    expect(failedPlayer.status).toBe('failed');
    expect(unrepaired).toHaveBeenCalledTimes(2);
    const badLocation = sqlTurn({ agentName: 'undercurrent-analyst',
      sql: "INSERT INTO seeds (title, status, location) VALUES ('暗流', 'incubating', '江南府')" });
    const locationInvoke = vi.fn(async () => badLocation);
    const locationFailure = await new WorldSimulationSubagentRuntime_ACU({ invoke: locationInvoke, apiPreset,
      countTokens: async () => 1 }).runOneShot(input);
    expect(locationInvoke).toHaveBeenCalledTimes(2);
    expect(locationFailure.unresolvedIssues).toEqual([expect.objectContaining({
      module: 'seeds', path: 'patch.seeds.upsert[0].location', source: 'transaction_rejected',
    })]);
    const validLocation = sqlTurn({ agentName: 'undercurrent-analyst',
      sql: "INSERT INTO seeds (title, status, location) VALUES ('暗流', 'incubating', '{\"region\":\"江南府\"}')" });
    const locationRepair = vi.fn().mockResolvedValueOnce(badLocation).mockResolvedValueOnce(validLocation).mockResolvedValueOnce(submitTurn('candidate', 'undercurrent-analyst', '确认交付', [ref]));
    expect((await new WorldSimulationSubagentRuntime_ACU({ invoke: locationRepair, apiPreset,
      countTokens: async () => 1 }).runOneShot(input)).status).toBe('candidate');
    expect(JSON.stringify(locationRepair.mock.calls[1][1])).toContain('patch.seeds.upsert[0].location');
    const addressInvoke = vi.fn(async () => ({ content: '', toolCalls: [{ id: 'read-1', name: 'read', arguments: '{"reads":["$.reads"]}' }] }));
    const addressFailure = await new WorldSimulationSubagentRuntime_ACU({ invoke: addressInvoke, apiPreset,
      countTokens: async () => 1 }).runOneShot(playerInput);
    expect(addressFailure.status).toBe('failed');
    expect(addressFailure.summary).toContain('INVALID_TOOL_ADDRESS');
    expect(addressFailure.unresolvedIssues).toEqual([]);
    expect(playerInput.tools.read).not.toHaveBeenCalled();
    const locationWorkflow = await env.run(async (call: any) => call.agentName === 'undercurrent-analyst' ? locationFailure : noChange(call.agentName));
    // 场外信号每轮必写：composer 持续无变化时修正轮耗尽，guidance 以模块缺口显式落账。
    expect(locationWorkflow.pendingFixes.map(item => item.module)).toEqual(['seeds', 'guidance']);
    expect(locationWorkflow.summary).toContain('patch.seeds.upsert[0].location');
    const addressWorkflow = await env.run(async (call: any) => call.agentName === 'dramatis-keeper' ? addressFailure : noChange(call.agentName));
    expect(addressWorkflow.outcome).toBe('blocked');
    // 协议错误不伪造模块缺口；只有未提交的场外信号记为 guidance 缺口。
    expect(addressWorkflow.pendingFixes.map(item => item.module)).toEqual(['guidance']);
    expect(addressWorkflow.summary).toContain('INVALID_TOOL_ADDRESS');
  });

  it('四条种子的 actor_ids 对象数组逐条定位并一次修正；持续非法不落账', async () => {
    const env = setup();
    const registry = createWorldSimulationEvidenceRegistry_ACU('actor-ids-repair');
    const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'anchor:message', status: 'ok', summary: '锚点', exact: true }).evidenceRef!;
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const input = { agentName: 'undercurrent-analyst' as const, toolMode: 'tools' as const, settings, registry, tools: { read: vi.fn(), search: vi.fn() },
      promptContext: { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '',
        worldState: env.ledger, anchorMessage: '锚点正文', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [],
        worldCollisions: { playerRegion: null, playerContact: 'open' as const, secludedNote: null, collidedSeeds: [], ripeRumors: [] },
        evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} },
      runId: 'actor-ids-repair', candidateSeq: 1, focus: '锚点', anchorEvidenceRef: ref, givenLedger: env.ledger,
      baseLedgerRevision: env.ledger.revision, injectWorldbook: false };
    const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as const, apiConfig: { max_tokens: 4096 }, tavernProfile: '' }) };
    const sql = (actorIds: string) => [0, 1, 2, 3].map(index =>
      `INSERT INTO seeds (title, status, actor_ids) VALUES ('暗流${index}', 'incubating', '${actorIds}')`).join('; ');
    const bad = sqlTurn({ sql: sql('[{"id":"actor-1"}]') });
    const valid = sqlTurn({ sql: [0, 1, 2, 3].map(index =>
      `INSERT INTO seeds (title, status) VALUES ('暗流${index}', 'incubating')`).join('; ') });
    const invoke = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(valid).mockResolvedValueOnce(submitTurn('candidate', 'undercurrent-analyst', '确认交付', [ref]));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const repaired = await runtime.runOneShot(input);
    expect(repaired.status).toBe('candidate');
    const rows = (repaired.candidate?.patch.seeds as { upsert: Array<{ actorIds?: unknown }> }).upsert;
    expect(rows).toHaveLength(4);
    expect(rows.every(row => row.actorIds === undefined)).toBe(true);
    const feedback = JSON.stringify(invoke.mock.calls[1][1]);
    for (let index = 0; index < 4; index++) expect(feedback).toContain(`patch.seeds.upsert[${index}].actorIds`);
    expect(feedback).toContain('省略 actor_ids');
    const rejected = await new WorldSimulationSubagentRuntime_ACU({ invoke: vi.fn(async () => bad), apiPreset, countTokens: async () => 1 }).runOneShot(input);
    expect(rejected.status).toBe('failed');
    expect(rejected.unresolvedIssues?.map(issue => issue.module)).toEqual(['seeds', 'seeds', 'seeds', 'seeds']);
    expect(rejected.candidate).toBeUndefined();
  });
});
