import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { buildDefaultWorldSimulationAgentPrompts_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WorldSimulationSubagentRuntime_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
import { WorldSimulationMainLoop_ACU } from '../../../../src/service/simulation/agent/agent-main-loop';
import { resetWorldSimulationRunCacheForTests_ACU } from '../../../../src/service/simulation/agent/agent-run-cache';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../../src/service/simulation/agent/agent-session-log';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) };
const tools = { read: vi.fn(async () => ({ status: 'empty' as const, summary: 'empty' })), search: vi.fn(async () => ({ status: 'empty' as const, hits: [], summary: 'empty' })) };
const settings = () => ({ ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU(), agentRunBudget: { maxIterations: 3, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 } });
const guidanceNoChange = () => ({ agentName: 'guidance-reviewer', status: 'no_change' as const, summary: '无需公开投影', evidenceRefs: [], uncertainties: [] });
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
    const invoke = vi.fn(async () => JSON.stringify({ status: 'candidate', agentName: 'macro-dynamics-analyst', patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence], uncertainties: [] }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const result = await runtime.run({ delegation: { agentName: 'macro-dynamics-analyst', instruction: '分析时间', reads: [] }, settings: settings(), promptContext, registry, tools });
    expect(result.status).toBe('candidate');
    expect(result.candidate).toMatchObject({ agentName: 'macro-dynamics-analyst', writableModules: ['clock', 'dimensions', 'chronicle'] });
    expect(result.candidate?.candidateId).toMatch(/^candidate:/);
  });

  it('specialist 协议重试回灌明确枚举、角色、写入范围与合法 JSON 模板', async () => {
    const { registry, promptContext } = fixture('specialist-repair');
    const responses = [
      JSON.stringify({ status: 'successful', agentName: 'macro-dynamics-analyst', summary: '非法状态', evidenceRefs: [], uncertainties: [] }),
      JSON.stringify({ status: 'no_change', agentName: 'macro-dynamics-analyst', summary: '无需修改', evidenceRefs: [], uncertainties: [] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    await expect(runtime.run({
      delegation: { agentName: 'macro-dynamics-analyst', instruction: '分析时间', reads: [] },
      settings: settings(), promptContext, registry, tools,
    })).resolves.toMatchObject({ status: 'no_change', summary: '无需修改' });
    expect(invoke).toHaveBeenCalledTimes(2);
    const retryMessages = invoke.mock.calls[1][1] as readonly { role: string; content: string }[];
    const rejection = retryMessages.find(message => message.role === 'user' && message.content.includes('INVALID_SPECIALIST_STATUS'))?.content ?? '';
    expect(rejection).toContain('status 必须精确为 candidate、no_change、failed、blocked');
    expect(rejection).toContain('agentName 必须精确为 macro-dynamics-analyst');
    expect(rejection).toContain('patch 顶层只能使用：clock | dimensions | chronicle');
    expect(rejection).toContain('"status":"candidate"');
  });

  it('并行派工部分失败时仍可由 reviewer 部分采用成功候选', async () => {
    const { registry, evidence, promptContext } = fixture('partial');
    const candidate = {
      candidateId: 'candidate:accepted', agentName: 'macro-dynamics-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async ({ delegation }: any) => {
        if (delegation.agentName === 'seed-lifecycle-analyst') throw new Error('seed failed');
        return { agentName: delegation.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] };
      }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '采用可信候选', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
      runGuidanceReviewer: vi.fn(async () => guidanceNoChange()),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [
        { agentName: 'macro-dynamics-analyst', instruction: '分析时间', reads: [] },
        { agentName: 'seed-lifecycle-analyst', instruction: '分析暗流', reads: [] },
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
    expect(result.outcomes.map(item => item.status)).toEqual(['candidate', 'failed', 'no_change']);
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    expect(subagents.runGuidanceReviewer).toHaveBeenCalledOnce();
  });

  it('同一 specialist 后续成功结果替换旧失败，不让历史协议错误永久污染收敛', async () => {
    const { registry, evidence, promptContext } = fixture('latest-outcome-wins');
    const candidate = {
      candidateId: 'candidate:latest', agentName: 'macro-dynamics-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '重试后形成候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'chronicle'],
    };
    const subagents = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error('INVALID_SPECIALIST_STATUS: $.status'))
        .mockResolvedValueOnce({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '采用最新候选', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
      runGuidanceReviewer: vi.fn(async () => guidanceNoChange()),
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
      expect.objectContaining({ agentName: 'guidance-reviewer', status: 'no_change' }),
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
      runGuidanceReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'macro-dynamics-analyst', instruction: '分析', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'no_change', summary: '无变化', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'block', reason: '证据不足', unresolved: ['specialist failed'] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-block', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '证据不足' });
    expect(subagents.runReviewer).not.toHaveBeenCalled();
    expect(subagents.runGuidanceReviewer).not.toHaveBeenCalled();
  });

  it('主 Agent 协议错误只做有限修正并可在下一轮收敛', async () => {
    const { registry, promptContext } = fixture('director-repair');
    const subagents = { run: vi.fn(), runReviewer: vi.fn(), runGuidanceReviewer: vi.fn() };
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

  it('主 Agent 响应未返回时立即显示 running 卡片，完成后原位更新', async () => {
    const { registry, promptContext } = fixture('director-live');
    const subagents = { run: vi.fn(), runReviewer: vi.fn(), runGuidanceReviewer: vi.fn() };
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
    const subagents = { run: vi.fn(), runReviewer: vi.fn(), runGuidanceReviewer: vi.fn() };
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
      candidateId: 'candidate:revise', agentName: 'macro-dynamics-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'chronicle'],
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
      runGuidanceReviewer: vi.fn(async () => guidanceNoChange()),
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
    expect(subagents.runGuidanceReviewer).toHaveBeenCalledOnce();
  });

  it('同一 task/stage identity 恢复候选且不重复派工', async () => {
    const { registry, evidence, promptContext } = fixture('resume-same-identity');
    const candidate = {
      candidateId: 'candidate:resume', agentName: 'macro-dynamics-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
      runGuidanceReviewer: vi.fn(async () => guidanceNoChange()),
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
    expect(subagents.runGuidanceReviewer).toHaveBeenCalledOnce();
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
      candidateId: 'candidate:stale-cursor', agentName: 'macro-dynamics-analyst',
      patch: { clock: { elapsed: '1h' } }, summary: '旧 cursor 候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock', 'dimensions', 'chronicle'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(),
      runGuidanceReviewer: vi.fn(),
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
    expect(subagents.runGuidanceReviewer).not.toHaveBeenCalled();
  });
});
