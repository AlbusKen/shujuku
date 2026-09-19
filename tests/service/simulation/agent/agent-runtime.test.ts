import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { buildDefaultWorldSimulationAgentPrompts_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WorldSimulationSubagentRuntime_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
import { WorldSimulationMainLoop_ACU } from '../../../../src/service/simulation/agent/agent-main-loop';
import { readWorldSimulationRunState_ACU, resetWorldSimulationRunCacheForTests_ACU } from '../../../../src/service/simulation/agent/agent-run-cache';
import { resolveWorldSimulationAnchor_ACU } from '../../../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../../src/service/simulation/agent/agent-session-log';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) };
const tools = { read: vi.fn(async () => ({ status: 'empty' as const, summary: 'empty' })), search: vi.fn(async () => ({ status: 'empty' as const, hits: [], summary: 'empty' })) };
const settings = () => ({ ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU(), agentRunBudget: { maxIterations: 3, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 } });
function fixture(runId = 'runtime') {
  const registry = createWorldSimulationEvidenceRegistry_ACU(runId);
  const evidence = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'anchor:message', status: 'ok', summary: '锚点', exact: true }).evidenceRef!;
  const promptContext = { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '', worldState: buildEmptyWorldSimulationLedger_ACU(), anchorMessage: '正文', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} };
  return { registry, evidence, promptContext };
}

describe('世界推演 Agent runtime', () => {
  beforeEach(() => { resetWorldSimulationRunCacheForTests_ACU(); resetWorldSimulationSessionLogForTests_ACU(); vi.clearAllMocks(); });

  it('specialist 只能在 catalog 声明的 ledger modules 内产出候选', async () => {
    const { registry, evidence, promptContext } = fixture('specialist');
    const invoke = vi.fn(async () => JSON.stringify({ status: 'candidate', agentName: 'world-analyst', patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence], uncertainties: [] }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const result = await runtime.run({ delegation: { agentName: 'world-analyst', instruction: '分析时间', reads: [] }, settings: settings(), promptContext, registry, tools });
    expect(result.status).toBe('candidate');
    expect(result.candidate).toMatchObject({ agentName: 'world-analyst', writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'] });
    expect(result.candidate?.candidateId).toMatch(/^candidate:/);
  });

  it('specialist 省略绑定身份时由运行时补齐 agentName', async () => {
    const { registry, promptContext } = fixture('specialist-bound-identity');
    const invoke = vi.fn(async () => JSON.stringify({ status: 'no_change', summary: '无需修改', evidenceRefs: [], uncertainties: [] }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });

    await expect(runtime.run({
      delegation: { agentName: 'lore-researcher', instruction: '核对行动者信息', reads: [] },
      settings: settings(), promptContext, registry, tools,
    })).resolves.toMatchObject({ agentName: 'lore-researcher', status: 'no_change', summary: '无需修改' });
  });

  it('specialist 显式伪造不同身份时仍 fail-closed', async () => {
    const { registry, promptContext } = fixture('specialist-forged-identity');
    const invoke = vi.fn(async () => JSON.stringify({
      status: 'no_change', agentName: 'world-analyst', summary: '伪造身份', evidenceRefs: [], uncertainties: [],
    }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1, protocolRetries: 0 });

    await expect(runtime.run({
      delegation: { agentName: 'lore-researcher', instruction: '核对行动者信息', reads: [] },
      settings: settings(), promptContext, registry, tools,
    })).rejects.toThrow('WORLD_SIMULATION_AGENT_IDENTITY_MISMATCH');
  });

  it('causality reviewer 对非法 verdict 回灌完整协议并在重试后收敛', async () => {
    const { registry, evidence, promptContext } = fixture('reviewer-protocol-repair');
    const candidate = {
      candidateId: 'candidate:reviewer-repair',
      agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } },
      summary: '时间推进',
      evidenceRefs: [evidence],
      uncertainties: [],
      writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const responses = [
      JSON.stringify({ verdict: 'approved', summary: '错误别名', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
      JSON.stringify({ verdict: 'accept', summary: '审核通过', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });

    await expect(runtime.runReviewer({ candidates: [candidate], settings: settings(), promptContext, registry, tools }))
      .resolves.toMatchObject({ verdict: 'accept', summary: '审核通过', acceptedCandidateIds: [candidate.candidateId] });
    expect(invoke).toHaveBeenCalledTimes(2);
    const initialMessages = invoke.mock.calls[0][1] as readonly { role: string; content: string }[];
    expect(initialMessages.some(message => message.role === 'system' && message.content.includes('verdict 必须精确为 accept、revise、reject'))).toBe(true);
    const retryMessages = invoke.mock.calls[1][1] as readonly { role: string; content: string }[];
    const rejection = retryMessages.find(message => message.role === 'user' && message.content.includes('INVALID_REVIEW_VERDICT'))?.content ?? '';
    expect(rejection).toContain('"verdict":"accept"');
    expect(rejection).toContain('"verdict":"revise"');
    expect(rejection).toContain('"verdict":"reject"');
  });

  it('specialist 协议重试回灌明确枚举、角色、写入范围与合法 JSON 模板', async () => {
    const { registry, promptContext } = fixture('specialist-repair');
    const responses = [
      JSON.stringify({ status: 'successful', agentName: 'world-analyst', summary: '非法状态', evidenceRefs: [], uncertainties: [] }),
      JSON.stringify({ status: 'no_change', agentName: 'world-analyst', summary: '无需修改', evidenceRefs: [], uncertainties: [] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    await expect(runtime.run({
      delegation: { agentName: 'world-analyst', instruction: '分析时间', reads: [] },
      settings: settings(), promptContext, registry, tools,
    })).resolves.toMatchObject({ status: 'no_change', summary: '无需修改' });
    expect(invoke).toHaveBeenCalledTimes(2);
    const retryMessages = invoke.mock.calls[1][1] as readonly { role: string; content: string }[];
    const rejection = retryMessages.find(message => message.role === 'user' && message.content.includes('INVALID_SPECIALIST_STATUS'))?.content ?? '';
    expect(rejection).toContain('status 必须精确为 candidate、no_change、failed、blocked');
    expect(rejection).toContain('agentName 必须精确为 world-analyst');
    expect(rejection).toContain('patch 顶层只能使用：clock | dimensions | seeds | actors | chronicle');
    expect(rejection).toContain('"status":"candidate"');
  });

  it('并行派工部分失败时仍可由 reviewer 部分采用成功候选', async () => {
    const { registry, evidence, promptContext } = fixture('partial');
    const candidate = {
      candidateId: 'candidate:accepted', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async ({ delegation }: any) => {
        if (delegation.agentName === 'lore-researcher') throw new Error('seed failed');
        return { agentName: delegation.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] };
      }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '采用可信候选', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [
        { agentName: 'world-analyst', instruction: '分析时间', reads: [] },
        { agentName: 'lore-researcher', instruction: '分析暗流', reads: [] },
      ] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交部分成功结果', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-partial', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([candidate]);
    expect(result.outcomes.map(item => item.status)).toEqual(['candidate', 'failed']);
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
  });

  it('同一 specialist 后续成功结果替换旧失败，不让历史协议错误永久污染收敛', async () => {
    const { registry, evidence, promptContext } = fixture('latest-outcome-wins');
    const candidate = {
      candidateId: 'candidate:latest', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '重试后形成候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error('INVALID_SPECIALIST_STATUS: $.status'))
        .mockResolvedValueOnce({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '采用最新候选', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '首次分析', reads: [] }] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '按协议重试', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交最新结果', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-latest', chatIdentity: 'chat-latest', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-latest', stageId: 'stage-latest', stageRevision: 1 };

    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });

    expect(result.outcome).toBe('commit');
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: candidate.agentName, status: 'candidate' }),
    ]));
    expect(result.outcomes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: candidate.agentName, status: 'failed' }),
    ]));
    expect(subagents.run).toHaveBeenCalledTimes(2);
  });

  it('存在失败派工时不允许伪装 no_change', async () => {
    const { registry, evidence, promptContext } = fixture('no-change-gate');
    const subagents = {
      run: vi.fn(async () => { throw new Error('all failed'); }),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'world-analyst', instruction: '分析', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'no_change', summary: '无变化', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'block', reason: '证据不足', unresolved: ['specialist failed'] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-block', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '证据不足' });
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('主 Agent 协议错误只做有限修正并可在下一轮收敛', async () => {
    const { registry, promptContext } = fixture('director-repair');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const responses = [
      JSON.stringify({ action: 'unknown' }),
      JSON.stringify({ action: 'block', reason: '修正后阻断', unresolved: ['missing evidence'] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-repair', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '修正后阻断' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(subagents.run).not.toHaveBeenCalled();
  });

  it('主 Agent 可连续修正不同 finalize 机械错误且重复指纹门禁不变', async () => {
    const { registry, promptContext } = fixture('director-sequential-repair');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const responses = [
      JSON.stringify({ action: 'finalize', summary: '缺少 outcome', evidenceRefs: [] }),
      JSON.stringify({ action: 'finalize', outcome: 'no_change', candidateId: 'candidate:wrong', summary: '混入审核字段', evidenceRefs: [] }),
      JSON.stringify({ action: 'finalize', outcome: 'done', summary: '非法别名', evidenceRefs: [] }),
      JSON.stringify({ action: 'block', reason: '协议已修正但证据不足', unresolved: ['missing evidence'] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-sequential-repair', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '协议已修正但证据不足' });
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(subagents.run).not.toHaveBeenCalled();
  });

  it('主 Agent 响应未返回时立即显示 running 卡片，完成后原位更新', async () => {
    const { registry, promptContext } = fixture('director-live');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    let resolveInvoke!: (value: string) => void;
    const invoke = vi.fn(() => new Promise<string>(resolve => { resolveInvoke = resolve; }));
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-director-live', chatIdentity: 'chat-director-live', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };

    const pending = loop.run({ identity, settings: settings(), promptContext, registry, tools });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const running = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const runningCard = running.find(item => item.kind === 'main_action');
    expect(runningCard).toMatchObject({ title: '主 Agent 第 1 轮正在工作', status: 'running', agentName: 'world-director' });

    resolveInvoke(JSON.stringify({ action: 'block', reason: '等待外部证据', unresolved: ['missing'] }));
    await expect(pending).resolves.toMatchObject({ outcome: 'blocked' });

    const completed = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const completedCard = completed.find(item => item.id === runningCard?.id);
    expect(completedCard).toMatchObject({ title: '主 Agent 动作：block', status: 'done', ok: true });
    expect(completed.filter(item => item.kind === 'main_action')).toHaveLength(1);
  });

  it('工具读取未返回时立即显示 running 卡片，完成后原位更新', async () => {
    const { registry, promptContext } = fixture('tool-live');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const responses = [
      JSON.stringify({ action: 'read', reads: ['ledger:current'] }),
      JSON.stringify({ action: 'block', reason: '取证完成后暂停', unresolved: ['next'] }),
    ];
    let resolveRead!: (value: { status: 'empty'; summary: string }) => void;
    const liveTools = {
      read: vi.fn(() => new Promise<{ status: 'empty'; summary: string }>(resolve => { resolveRead = resolve; })),
      search: vi.fn(async () => ({ status: 'empty' as const, hits: [], summary: 'empty' })),
    };
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-tool-live', chatIdentity: 'chat-tool-live', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };

    const pending = loop.run({ identity, settings: settings(), promptContext, registry, tools: liveTools });
    await vi.waitFor(() => expect(liveTools.read).toHaveBeenCalledOnce());
    const running = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const runningCard = running.find(item => item.kind === 'tool_read');
    expect(runningCard).toMatchObject({ title: '主 Agent 正在读取资料', status: 'running', agentName: 'world-director' });

    resolveRead({ status: 'empty', summary: '当前账本为空' });
    await expect(pending).resolves.toMatchObject({ outcome: 'blocked' });

    const completed = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const completedCard = completed.find(item => item.id === runningCard?.id);
    expect(completedCard).toMatchObject({ title: '资料读取完成（1 项）', status: 'done', ok: true });
    expect(completed.filter(item => item.kind === 'tool_read')).toHaveLength(1);
  });

  it('reviewer 要求 revise 时返回主循环修正而不是误提交', async () => {
    const { registry, evidence, promptContext } = fixture('review-revise');
    const candidate = {
      candidateId: 'candidate:revise', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({
          verdict: 'revise' as const,
          summary: '需要补充因果说明',
          findings: [{ severity: 'major' as const, reasonCode: 'CAUSE_GAP', path: '$.clock', expected: 'causal rationale', actual: 'missing' }],
          acceptedCandidateIds: [candidate.candidateId],
        })
        .mockResolvedValueOnce({ verdict: 'accept' as const, summary: '修订后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次提交', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '修订后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-revise', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.summary).toBe('修订后提交');
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
  });

  it('reviewer 驳回候选后主 Agent 重新派工修订而不是结束任务', async () => {
    const { registry, evidence, promptContext } = fixture('review-reject-redelegate');
    const rejectedCandidate = {
      candidateId: 'candidate:rejected', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } },
      summary: '缺少锚点证据的时间候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const revisedCandidate = {
      ...rejectedCandidate,
      candidateId: 'candidate:revised',
      patch: { clock: { elapsed: '30m' } },
      summary: '按审核意见修正后的时间候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: rejectedCandidate.agentName, status: 'candidate' as const, summary: rejectedCandidate.summary, candidate: rejectedCandidate, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: revisedCandidate.agentName, status: 'candidate' as const, summary: revisedCandidate.summary, candidate: revisedCandidate, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({
          verdict: 'reject' as const,
          summary: '候选时间跨度缺少锚点证据',
          findings: [{ severity: 'blocking' as const, reasonCode: 'EVIDENCE_GAP', path: '$.clock.elapsed', expected: '时间跨度由锚点证据支持', actual: '1h 缺少直接依据' }],
          acceptedCandidateIds: [],
        })
        .mockResolvedValueOnce({ verdict: 'accept' as const, summary: '修订候选通过', findings: [], acceptedCandidateIds: [revisedCandidate.candidateId] }),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: rejectedCandidate.agentName, instruction: '分析时间推进', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次送审', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: rejectedCandidate.agentName, instruction: '根据 EVIDENCE_GAP 修正候选', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订候选', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-reject-redelegate', chatIdentity: 'chat-reject-redelegate', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-reject-redelegate', stageId: 'stage-reject-redelegate', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '提交修订候选' });
    expect(subagents.run).toHaveBeenCalledTimes(2);
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
    expect(subagents.run.mock.calls[1][0].delegation.instruction).toContain('EVIDENCE_GAP');
  });

  it('同一 specialist 对同一逻辑条目的修订候选替换旧候选', async () => {
    const { registry, evidence, promptContext } = fixture('replace-revised-candidate');
    const baseEntry = {
      id: 'dimension-1', name: '边境压力', kind: 'pressure', value: 1, trend: 'rising',
      rationale: '锚点证据', evidenceRefs: [evidence], expectedRevision: 0,
    };
    const original = {
      candidateId: 'candidate:dimension-original', agentName: 'world-analyst',
      patch: { dimensions: { upsert: [baseEntry] } }, summary: '初版维度候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const revised = {
      ...original,
      candidateId: 'candidate:dimension-revised',
      patch: { dimensions: { upsert: [{ ...baseEntry, value: 2, rationale: '修订后的锚点解释' }] } },
      summary: '修订维度候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: original.agentName, status: 'candidate' as const, summary: original.summary, candidate: original, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: revised.agentName, status: 'candidate' as const, summary: revised.summary, candidate: revised, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '修订候选通过', findings: [], acceptedCandidateIds: candidates.map((candidate: any) => candidate.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: original.agentName, instruction: '生成初版维度', reads: [] }] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: revised.agentName, instruction: '修订同一维度', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订维度', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-replace-revised', chatIdentity: 'chat-replace-revised', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-replace-revised', stageId: 'stage-replace-revised', stageRevision: 1 };

    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit' });
    expect(subagents.runReviewer.mock.calls[0][0].candidates).toEqual([revised]);
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([revised]);
  });

  it('候选事务失败后回灌错误并重新派工修正', async () => {
    const { registry, evidence, promptContext } = fixture('transaction-redelegate');
    const entry = {
      id: 'dimension-transaction', name: '事务维度', kind: 'pressure', value: 1, trend: 'rising',
      rationale: '锚点证据', evidenceRefs: [evidence],
    };
    const stale = {
      candidateId: 'candidate:stale-revision', agentName: 'world-analyst',
      patch: { dimensions: { upsert: [{ ...entry, expectedRevision: 1 }] } }, summary: '错误 revision 候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const corrected = {
      ...stale,
      candidateId: 'candidate:corrected-revision',
      patch: { dimensions: { upsert: [{ ...entry, expectedRevision: 0 }] } },
      summary: '修正 revision 候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: stale.agentName, status: 'candidate' as const, summary: stale.summary, candidate: stale, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: corrected.agentName, status: 'candidate' as const, summary: corrected.summary, candidate: corrected, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '候选通过', findings: [], acceptedCandidateIds: candidates.map((candidate: any) => candidate.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: stale.agentName, instruction: '生成候选', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次提交', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: corrected.agentName, instruction: '根据事务错误修订', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订候选', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-transaction-redelegate', chatIdentity: 'chat-transaction-redelegate', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-transaction-redelegate', stageId: 'stage-transaction-redelegate', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '提交修订候选' });
    expect(JSON.stringify(invoke.mock.calls)).toContain('revision 冲突');
    expect(JSON.stringify(invoke.mock.calls)).toContain('重新派工');
    expect(subagents.run).toHaveBeenCalledTimes(2);
    expect(subagents.runReviewer).toHaveBeenCalledTimes(1);
    expect(subagents.runReviewer.mock.calls[0][0].candidates).toEqual([corrected]);
  });

  it('候选事务因字段缺失失败时回灌完整必填字段模板', async () => {
    const { registry, evidence, promptContext } = fixture('transaction-missing-fields');
    const incomplete = {
      candidateId: 'candidate:missing-fields', agentName: 'world-analyst',
      patch: { dimensions: { upsert: [{ id: 'pressure', name: '压力', expectedRevision: 0, rationale: '', evidenceRefs: [evidence] }] } },
      summary: '缺字段候选', evidenceRefs: [evidence], uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const complete = {
      ...incomplete,
      candidateId: 'candidate:complete-fields',
      patch: { dimensions: { upsert: [{ id: 'pressure', name: '压力', kind: 'pressure', value: 1, trend: 'rising', rationale: '', evidenceRefs: [evidence], expectedRevision: 0 }] } },
      summary: '补齐字段候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: incomplete.agentName, status: 'candidate' as const, summary: incomplete.summary, candidate: incomplete, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: complete.agentName, status: 'candidate' as const, summary: complete.summary, candidate: complete, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '候选通过', findings: [], acceptedCandidateIds: candidates.map((candidate: any) => candidate.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: incomplete.agentName, instruction: '生成候选', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次提交', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: complete.agentName, instruction: '根据事务错误修订', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订候选', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-transaction-missing-fields', chatIdentity: 'chat-transaction-missing-fields', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-transaction-missing-fields', stageId: 'stage-transaction-missing-fields', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '提交修订候选' });
    const feedback = JSON.stringify(invoke.mock.calls[2][1]);
    expect(feedback).toContain('缺少必填字段：kind,value,trend');
    expect(feedback).toContain('完整必填字段模板');
    expect(feedback).toContain('dimensions: id,name,kind,value,trend,rationale,evidenceRefs,revision');
    expect(feedback).toContain('clock: storyTime,elapsed,precision,evidenceRefs');
    expect(feedback).toContain('seeds:');
    expect(feedback).toContain('actors:');
    expect(feedback).toContain('chronicle:');
    expect(feedback).toContain('guidance:');
  });

  it('显式 block 后保留同一 task/cursor 的候选并在恢复时避免重复派工', async () => {
    const { registry, evidence, promptContext } = fixture('resume-after-block');
    const candidate = {
      candidateId: 'candidate:block-resume', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '阻断前候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '恢复后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-block-resume', chatIdentity: 'chat-block-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 4,
      taskId: 'task-block-resume', stageId: 'stage-block-resume', stageRevision: 2,
    };
    const runSettings = settings();

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    expect(readWorldSimulationRunState_ACU(
      identity.chatIdentity,
      identity.taskId,
      `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`,
    )).toMatchObject({ candidates: [candidate], nextIteration: 3 });

    const resumedRegistry = createWorldSimulationEvidenceRegistry_ACU(registry.runId);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries).toHaveLength(0);
    const resumed = await loop.run({ identity, settings: runSettings, promptContext, registry: resumedRegistry, tools });
    expect(resumed.outcome).toBe('commit');
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries.some(entry => entry.evidenceRef === evidence)).toBe(true);
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
  });

  it('同一 task/stage identity 恢复候选且不重复派工', async () => {
    const { registry, evidence, promptContext } = fixture('resume-same-identity');
    const candidate = {
      candidateId: 'candidate:resume', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '恢复后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-resume', chatIdentity: 'chat-resume', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 7,
      taskId: 'task-resume', stageId: 'stage-resume', stageRevision: 3,
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 1;

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked', unresolved: ['iteration budget exhausted'] });
    const resumed = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(resumed.outcome).toBe('commit');
    if (resumed.outcome !== 'commit') throw new Error('expected resumed commit');
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    expect(resumed.commitCandidate).toMatchObject({
      runId: identity.runId,
      taskId: identity.taskId,
      stageId: identity.stageId,
      stageRevision: identity.stageRevision,
      baseLedgerRevision: identity.baseLedgerRevision,
      acceptedCandidates: [candidate],
    });
  });

  it('stage cursor 改变后不复用旧候选', async () => {
    const { registry, evidence, promptContext } = fixture('resume-cursor-isolation');
    const candidate = {
      candidateId: 'candidate:stale-cursor', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '旧 cursor 候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '不得提交旧候选', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-cursor', chatIdentity: 'chat-cursor', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 2,
      taskId: 'task-cursor', stageId: 'stage-cursor', stageRevision: 1,
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 1;

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked' });
    const changedCursor = { ...identity, runId: 'run-cursor-next', stageRevision: 2 };
    const result = await loop.run({ identity: changedCursor, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'blocked', unresolved: ['iteration budget exhausted'] });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('重启后内存清空，从锚点楼层恢复候选与证据直接提交', async () => {
    const { registry, evidence, promptContext } = fixture('floor-resume');
    const chat: any[] = [{ message_id: 1, mes: '锚点正文', swipe_id: 0, is_user: false, is_system: false }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-floor-resume', getCurrentChatId: () => 'chat-floor-resume', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const candidate = {
      candidateId: 'candidate:floor-resume', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '楼层恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '楼层恢复后通过', findings: [], acceptedCandidateIds: candidates.map((item: any) => item.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-floor-resume', chatIdentity: 'chat-floor-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 4,
      taskId: 'task-floor-resume', stageId: 'stage-floor-resume', stageRevision: 2,
    };
    const runSettings = settings();

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    // 等楼层持久化（fire-and-forget）完成后模拟重启：清空内存缓存与证据注册表。
    await new Promise(resolve => setTimeout(resolve, 0));
    resetWorldSimulationRunCacheForTests_ACU();
    const resumedRegistry = createWorldSimulationEvidenceRegistry_ACU(registry.runId);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries).toHaveLength(0);

    const resumedLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '楼层恢复后提交', evidenceRefs: [evidence] })), subagents, apiPreset, countTokens: async () => 1 });
    const result = await resumedLoop.run({ identity, settings: runSettings, promptContext, registry: resumedRegistry, tools, anchor, chat });

    expect(result).toMatchObject({ outcome: 'commit', summary: '楼层恢复后提交' });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries.some(entry => entry.evidenceRef === evidence)).toBe(true);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('预算耗尽后继续时重置迭代与派工窗口并保留候选', async () => {
    const { registry, evidence, promptContext } = fixture('budget-reset-resume');
    const chat: any[] = [{ message_id: 1, mes: '锚点正文', swipe_id: 0, is_user: false, is_system: false }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-budget-resume', getCurrentChatId: () => 'chat-budget-resume', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const candidate = {
      candidateId: 'candidate:budget-resume', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '预算重置候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '预算重置后通过', findings: [], acceptedCandidateIds: candidates.map((item: any) => item.candidateId) })),
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 2;
    const identity = {
      runId: 'run-budget-resume', chatIdentity: 'chat-budget-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 6,
      taskId: 'task-budget-resume', stageId: 'stage-budget-resume', stageRevision: 3,
    };

    // 第一段：仅做一次读取即耗尽迭代预算，形成 'iteration budget exhausted' 恢复标记。
    const firstLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action:'read', reads: ['$CLOCK'] })), subagents, apiPreset, countTokens: async () => 1 });
    await expect(firstLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '世界推演主循环迭代预算耗尽' });
    await new Promise(resolve => setTimeout(resolve, 0));
    resetWorldSimulationRunCacheForTests_ACU();

    // 第二段：模拟重启后恢复，预算窗口重置、候选与证据保留，可以继续派工直至提交。
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '继续推进', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '预算重置后提交', evidenceRefs: [evidence] }),
    ];
    const resumedLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const result = await resumedLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat });

    expect(result).toMatchObject({ outcome: 'commit', summary: '预算重置后提交' });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('重启恢复后主 Agent 对话 transcript 从楼层回填，审核意见不丢失', async () => {
    const { registry, evidence, promptContext } = fixture('transcript-floor-resume');
    const chat: any[] = [{ message_id: 1, mes: '锚点正文', swipe_id: 0, is_user: false, is_system: false }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-transcript-resume', getCurrentChatId: () => 'chat-transcript-resume', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const candidate = {
      candidateId: 'candidate:transcript-resume', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '对话恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({ verdict: 'reject' as const, summary: '候选缺少时间证据', findings: [{ severity: 'blocking' as const, reasonCode: 'EVIDENCE_GAP', path: '$.clock.elapsed', expected: '锚点支持', actual: '缺失' }], acceptedCandidateIds: [] })
        .mockResolvedValueOnce({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
    };
    const runSettings = settings();
    const identity = {
      runId: 'run-transcript-resume', chatIdentity: 'chat-transcript-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 5,
      taskId: 'task-transcript-resume', stageId: 'stage-transcript-resume', stageRevision: 2,
    };

    // 第一段：派工 -> 审核驳回（意见写入 transcript）-> block，形成可恢复现场。
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次送审', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
    ];
    const firstLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    await expect(firstLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    await new Promise(resolve => setTimeout(resolve, 0));
    resetWorldSimulationRunCacheForTests_ACU();

    // 第二段：模拟重启后恢复；Director 首轮请求应携带楼层回填的审核意见。
    const resumedLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '对话恢复后提交', evidenceRefs: [evidence] })), subagents, apiPreset, countTokens: async () => 1 });
    const result = await resumedLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat });

    expect(result).toMatchObject({ outcome: 'commit', summary: '对话恢复后提交' });
    const resumedInvoke = (resumedLoop as unknown as { dependencies: { invoke: { mock: { calls: unknown[][] } } } })['dependencies']['invoke'] as unknown as { mock: { calls: Array<[string, Array<{ role: string; content: string }>, unknown]> } };
    expect(resumedInvoke.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(resumedInvoke.mock.calls[0][1])).toContain('reviewer 驳回或要求修订候选');
    expect(JSON.stringify(resumedInvoke.mock.calls[0][1])).toContain('EVIDENCE_GAP');
    _set_SillyTavern_API_ACU(undefined);
  });

  it('候选入库预检失败时不入库并回灌全部违规', async () => {
    const { registry, evidence, promptContext } = fixture('preflight-reject');
    const badCandidate = {
      candidateId: 'candidate:preflight-bad', agentName: 'world-analyst',
      patch: { dimensions: { upsert: [{ id: 'pressure', name: '压力', expectedRevision: 0, rationale: '', evidenceRefs: [evidence] }] } },
      summary: '缺字段维度', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: badCandidate.agentName, status: 'candidate' as const, summary: badCandidate.summary, candidate: badCandidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'world-analyst', instruction: '分析维度', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待修正', unresolved: ['preflight'] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-preflight', chatIdentity: 'chat-preflight', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-preflight', stageId: 'stage-preflight', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '等待修正' });
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: 'world-analyst', status: 'failed', reasonCode: 'WORLD_SIMULATION_CANDIDATE_PREFLIGHT_FAILED' }),
    ]));
    expect(subagents.runReviewer).not.toHaveBeenCalled();
    expect(JSON.stringify(invoke.mock.calls)).toContain('候选入库预检拒绝');
    expect(JSON.stringify(invoke.mock.calls)).toContain('缺少必填字段');
  });

  it('causality-reviewer accept 时可把 guidance 合入最终候选', async () => {
    const { registry, evidence, promptContext } = fixture('reviewer-guidance');
    const candidate = {
      candidateId: 'candidate:guidance-source', agentName: 'world-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'seeds', 'actors', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({
        verdict: 'accept' as const, summary: '审核通过并压缩感知', findings: [],
        acceptedCandidateIds: [candidate.candidateId],
        guidance: { signals: ['远处钟声响起'], excludedFacts: ['幕后真相'] },
      })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交含 guidance', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-guidance', chatIdentity: 'chat-guidance', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-guidance', stageId: 'stage-guidance', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([
      candidate,
      expect.objectContaining({
        agentName: 'causality-reviewer',
        writableModules: ['guidance'],
        patch: { guidance: expect.objectContaining({ signals: ['远处钟声响起'], excludedFacts: ['幕后真相'] }) },
      }),
    ]);
  });

});
