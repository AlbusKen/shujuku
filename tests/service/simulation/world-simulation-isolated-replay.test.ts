// T9 世界推演隔离 API replay：禁止真实网络与模型费用。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { WorldSimulationOrchestrator_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import { WorldSimulationStagePlanner_ACU } from '../../../src/service/simulation/simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from '../../../src/service/simulation/simulation-stage-execution-engine';
import { WorldSimulationMainLoop_ACU } from '../../../src/service/simulation/agent/agent-main-loop';
import { WorldSimulationSubagentRuntime_ACU } from '../../../src/service/simulation/agent/agent-subagent-runtime';
import { appendWorldSimulationUserInstruction_ACU, readWorldSimulationConversation_ACU } from '../../../src/service/simulation/agent/agent-conversation-store';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';
import { resetWorldSimulationRunCacheForTests_ACU } from '../../../src/service/simulation/agent/agent-run-cache';
import { commitWorldSimulationProjection_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { FirstFloorWorldSimulationStore_ACU, assertWorldSimulationAnchorCurrent_ACU, buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { createWorldSimulationCompletionIntent_ACU, restoreWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-trigger-adapter';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';
import type { WorldSimulationAgentName_ACU } from '../../../src/service/simulation/agent/agent-catalog';
import type { WorldSimulationRunIdentity_ACU } from '../../../src/service/simulation/model';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

type ReplayMode = 'commit_partial' | 'no_change' | 'blocked';

const plan = {
  schemaVersion: 1 as const,
  title: '隔离回放阶段',
  objective: '核验世界状态并安全收敛',
  impactScope: ['world'],
  factsToVerify: ['冻结锚点仍有效'],
  plannedTools: ['anchor:message'],
  plannedSpecialists: ['world-analyst', 'lore-researcher'],
  expectedLedgerChanges: ['clock', 'guidance'] as const,
  convergenceConditions: ['形成可审计终局'],
  blockingConditions: ['证据不足'],
  completedSteps: [],
  nextStep: '执行隔离 API 脚本',
};

const isolatedPreset = {
  resolvePreset: vi.fn(() => ({
    resolved: true,
    apiMode: 'custom' as const,
    apiConfig: { url: 'https://invalid.local', apiKey: '', model: 'isolated-replay' } as any,
    tavernProfile: '',
  })),
};

const candidateId = (agentName: string, patch: object, evidenceRefs: string[], summary: string): string =>
  `candidate:${sha256HexSync_ACU(JSON.stringify([agentName, patch, evidenceRefs, summary])).slice(0, 24)}`;

interface ReplayOptions {
  mode: ReplayMode;
  entry: 'assistant' | 'agent';
  trailingUser?: boolean;
}

function buildReplay(options: ReplayOptions) {
  const saveChat = vi.fn().mockResolvedValue(undefined);
  const assistant = {
    is_user: false,
    message_id: 42,
    mes: '钟楼下的风停了一瞬。',
    message: '钟楼下的风停了一瞬。',
    swipe_id: 0,
    swipes: ['钟楼下的风停了一瞬。'],
  };
  const chat: any[] = [assistant];
  if (options.trailingUser) chat.push({ is_user: true, message_id: 43, mes: '继续观察钟楼。' });
  _set_SillyTavern_API_ACU({
    chat,
    chatId: 'chat-replay',
    getCurrentChatId: () => 'chat-replay',
    saveChat,
  } as any);

  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.agentRunBudget = {
    maxIterations: 6,
    maxDelegations: 4,
    maxSameAgent: 2,
    maxConcurrent: 2,
    maxReads: 4,
    maxExtraReads: 1,
  };
  chat[0]._qrf_world_simulation = envelope;

  const store = new FirstFloorWorldSimulationStore_ACU();
  const commitProjection = vi.fn(commitWorldSimulationProjection_ACU);
  const toolRead = vi.fn(async (address: string) => {
    if (address !== 'anchor:message') throw new Error(`UNEXPECTED_TOOL_READ:${address}`);
    return { status: 'ok' as const, content: assistant.mes, summary: '冻结 assistant 锚点正文', exact: true };
  });
  const toolSearch = vi.fn(async () => {
    throw new Error('UNEXPECTED_WEB_SEARCH');
  });
  let sequence = 0;
  let clock = 1000;
  const invocations: Array<{ role: WorldSimulationAgentName_ACU; response: string }> = [];

  const prepare = async (input: {
    identity: WorldSimulationRunIdentity_ACU;
    anchor: ReturnType<typeof resolveWorldSimulationAnchor_ACU>;
    instruction: string;
    envelope: ReturnType<FirstFloorWorldSimulationStore_ACU['read']>;
  }) => {
    if (!input.envelope) throw new Error('REPLAY_ENVELOPE_REQUIRED');
    const registry = createWorldSimulationEvidenceRegistry_ACU(input.identity.runId);
    const initialEvidence = recordWorldSimulationEvidence_ACU(registry, {
      operation: 'initial',
      address: 'anchor:message',
      status: 'ok',
      summary: '冻结 assistant 锚点正文',
      exact: true,
    }).evidenceRef!;
    const clockPatch = {
      clock: { days: 1, storyTime: '1h', evidenceRefs: [initialEvidence] },
    };
    const clockSummary = '钟楼事件使世界时间推进一小时';
    const clockCandidateId = candidateId('world-analyst', clockPatch, [initialEvidence], clockSummary);
    const scripts = new Map<WorldSimulationAgentName_ACU, string[]>([
      ['world-stage-planner', [JSON.stringify({ action: 'plan', summary: '隔离阶段计划已冻结', plan })]],
      ['world-director', [
        JSON.stringify({ action: 'read', reads: ['anchor:message'] }),
        ...(options.mode === 'blocked'
          ? [JSON.stringify({ action: 'block', reason: '证据不足，拒绝提交', unresolved: ['missing causal evidence'] })]
          : [
              JSON.stringify({
                action: 'delegate',
                delegations: options.mode === 'commit_partial'
                  ? [
                      { agentName: 'world-analyst', instruction: '分析时间推进', reads: [] },
                      { agentName: 'lore-researcher', instruction: '分析暗流变化', reads: [] },
                    ]
                  : [{ agentName: 'world-analyst', instruction: '核验是否变化', reads: [] }],
              }),
              JSON.stringify({
                action: 'finalize',
                outcome: options.mode === 'no_change' ? 'no_change' : 'commit',
                summary: options.mode === 'no_change' ? '证据显示世界状态无变化' : '提交部分成功候选',
                evidenceRefs: [initialEvidence],
              }),
            ]),
      ]],
      ['world-analyst', [options.mode === 'no_change'
        ? JSON.stringify({
            status: 'no_change',
            agentName: 'world-analyst',
            summary: '当前证据不足以支持状态变化',
            evidenceRefs: [initialEvidence],
            uncertainties: [],
          })
        : JSON.stringify({
            status: 'candidate',
            agentName: 'world-analyst',
            patch: clockPatch,
            summary: clockSummary,
            evidenceRefs: [initialEvidence],
            uncertainties: [],
          })]],
      ['lore-researcher', [JSON.stringify({
        status: 'failed',
        agentName: 'lore-researcher',
        reasonCode: 'SEED_EVIDENCE_MISSING',
        message: '暗流证据不足',
      })]],
      ['causality-reviewer', [JSON.stringify({
        verdict: 'accept',
        summary: '仅采用证据完整的时间候选',
        findings: [],
        acceptedCandidateIds: [clockCandidateId],
        guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient' }], excludedFacts: [] },
      })]],
    ]);
    const invoke = vi.fn(async (role: WorldSimulationAgentName_ACU) => {
      const queue = scripts.get(role);
      const response = queue?.shift();
      if (!response) throw new Error(`UNEXPECTED_MODEL_INVOCATION:${role}`);
      invocations.push({ role, response });
      return response;
    });
    const countTokens = async () => 1;
    const planner = new WorldSimulationStagePlanner_ACU({ invoke: (messages, preset) => invoke('world-stage-planner', messages, preset), apiPreset: isolatedPreset, countTokens });
    const planned = await planner.plan({
      settings: input.envelope.settings,
      promptContext: {
        task: input.envelope.task,
        history: readWorldSimulationConversation_ACU(chat),
        runtimeContext: { triggerKind: input.identity.triggerKind, instruction: input.instruction },
        agentCatalog: [],
        toolCatalog: ['anchor:message'],
        evidence: snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries,
        userGuidance: input.instruction,
        worldState: input.envelope.ledger,
        anchorMessage: assistant.mes,
        anchorIdentity: input.anchor,
        worldStagePlan: {},
        worldChronicle: input.envelope.ledger.chronicle,
        worldCandidates: [],
        worldCollisions: { playerRegion: null, playerContact: 'open', secludedNote: null, collidedSeeds: [], ripeRumors: [] },
        evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry),
        projectionPreview: {},
      },
      now: ++clock,
    });
    const promptContext = {
      task: input.envelope.task,
      history: readWorldSimulationConversation_ACU(chat),
      runtimeContext: { triggerKind: input.identity.triggerKind, instruction: input.instruction },
      agentCatalog: [],
      toolCatalog: ['anchor:message'],
      evidence: snapshotWorldSimulationEvidenceRegistry_ACU(registry).entries,
      userGuidance: input.instruction,
      worldState: input.envelope.ledger,
      anchorMessage: assistant.mes,
      anchorIdentity: input.anchor,
      worldStagePlan: planned.revision.plan,
      worldChronicle: input.envelope.ledger.chronicle,
      worldCandidates: [],
      worldCollisions: { playerRegion: null, playerContact: 'open', secludedNote: null, collidedSeeds: [], ripeRumors: [] },
      evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry),
      projectionPreview: {},
    };
    const tools = { read: toolRead, search: toolSearch };
    const subagents = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset: isolatedPreset, countTokens });
    const mainLoop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset: isolatedPreset, countTokens });
    return {
      revision: planned.revision,
      execute: async (identity: WorldSimulationRunIdentity_ACU) => {
        const engine = new WorldSimulationStageExecutionEngine_ACU({
          readEnvelope: () => store.read(),
          getChatIdentity: () => 'chat-replay',
          assertAnchorCurrent: current => {
            const restored = restoreWorldSimulationAnchor_ACU(current, chat);
            assertWorldSimulationAnchorCurrent_ACU(restored, chat);
          },
          runMainLoop: () => mainLoop.run({
            identity,
            settings: store.read()!.settings,
            promptContext: { ...promptContext, task: store.read()!.task },
            registry,
            tools,
          }),
        });
        return engine.run({ identity });
      },
    };
  };

  const orchestrator = new WorldSimulationOrchestrator_ACU({
    store,
    now: () => ++clock,
    allocateId: kind => `${kind}-replay-${++sequence}`,
    prepare,
    assertAnchorCurrent: anchor => { assertWorldSimulationAnchorCurrent_ACU(anchor, chat); },
    appendUserMessage: async ({ identity, anchor, text, idempotent }) => {
      await appendWorldSimulationUserInstruction_ACU({
        anchor,
        runId: identity.runId,
        taskId: identity.taskId,
        stageId: identity.stageId,
        stageRevision: identity.stageRevision,
        triggerConversationMessageId: identity.triggerConversationMessageId,
        text,
        idempotent,
      }, chat);
    },
    commitProjection,
  });
  const runtime = new WorldSimulationRuntime_ACU(orchestrator, () => chat);
  const initialAnchor = resolveWorldSimulationAnchor_ACU(0, chat);

  const run = async () => {
    if (options.entry === 'assistant') {
      const intent = createWorldSimulationCompletionIntent_ACU(42, 'chat-replay', '', chat, 1);
      return runtime.handleAssistantCompletion(intent);
    }
    return runtime.sendAgentMessage('手动推进钟楼世界状态', 'turn-replay-1');
  };

  return {
    chat,
    runtime,
    run,
    store,
    saveChat,
    commitProjection,
    toolRead,
    toolSearch,
    invocations,
    initialAnchor,
  };
}

describe('T9 世界推演隔离 API replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorldSimulationRunCacheForTests_ACU();
    resetWorldSimulationSessionLogForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
  });

  afterEach(() => {
    _set_SillyTavern_API_ACU(undefined);
  });

  it('assistant 自动触发冻结稳定锚点，部分失败派工只提交审核通过的候选', async () => {
    const replay = buildReplay({ mode: 'commit_partial', entry: 'assistant' });

    const result = await replay.run();

    expect(result).toMatchObject({
      status: 'completed',
      identity: {
        triggerKind: 'assistant_completed',
        triggerConversationMessageId: null,
        anchorMessageId: 42,
        anchorMessageKey: 'number:42',
        anchorSwipeId: '0',
        anchorContentDigest: replay.initialAnchor.contentDigest,
      },
      result: { outcome: 'commit' },
    });
    if (!result || result.status !== 'completed' || result.result.outcome !== 'commit') throw new Error('expected committed replay');
    expect(result.result.outcomes.map(item => [item.agentName, item.status, item.reasonCode])).toEqual([
      ['world-analyst', 'candidate', undefined],
      ['lore-researcher', 'failed', 'SEED_EVIDENCE_MISSING'],
    ]);
    expect(result.result.commitCandidate.acceptedCandidates.map(item => item.agentName)).toEqual(['world-analyst', 'causality-reviewer']);
    expect(replay.store.read()).toMatchObject({ ledger: { revision: 1, clock: { day: 2, storyTime: '1h' }, guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient' }] } }, task: { status: 'completed', activeRun: null } });
    expect(replay.commitProjection).toHaveBeenCalledOnce();
    expect(replay.saveChat).toHaveBeenCalledTimes(3);
    expect(replay.toolRead).toHaveBeenCalledWith('anchor:message');
    expect(replay.toolSearch).not.toHaveBeenCalled();
    expect(readWorldSimulationSessionLog_ACU('chat-replay').map(item => item.kind)).toEqual(expect.arrayContaining(['run_started', 'tool_read', 'delegation', 'run_completed']));
  });

  it('Agent 手动发送在 strict commit 后保留 D0，并把会话 segment 迁移到当前 D1', async () => {
    const replay = buildReplay({ mode: 'commit_partial', entry: 'agent' });
    const oldKey = buildWorldSimulationBucketKey_ACU(replay.initialAnchor);

    const result = await replay.run();

    expect(result).toMatchObject({ status: 'completed', identity: { triggerKind: 'agent_chat_message', triggerConversationMessageId: 'turn-replay-1' }, result: { outcome: 'commit' } });
    const currentAnchor = resolveWorldSimulationAnchor_ACU(0, replay.chat);
    const newKey = buildWorldSimulationBucketKey_ACU(currentAnchor);
    const bucket = replay.chat[0][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    expect(currentAnchor.contentDigest).not.toBe(replay.initialAnchor.contentDigest);
    expect(newKey).not.toBe(oldKey);
    expect(bucket.entries[oldKey]).toBeDefined();
    expect(bucket.entries[newKey]).toMatchObject({ anchor: currentAnchor, value: { segments: [{ segmentId: expect.stringMatching(/^user:run-replay-/) }] } });
    expect(readWorldSimulationConversation_ACU(replay.chat)).toMatchObject({
      diagnostics: [],
      messages: [{ kind: 'user', text: '手动推进钟楼世界状态', turnKey: 'turn-replay-1' }],
    });
    expect(replay.commitProjection).toHaveBeenCalledOnce();
    expect(replay.saveChat).toHaveBeenCalledTimes(4);
  });

  it('末楼为 user 时，手动入口向上冻结最近 assistant 且 no_change 不进入 strict commit', async () => {
    const replay = buildReplay({ mode: 'no_change', entry: 'agent', trailingUser: true });

    const result = await replay.run();

    expect(result).toMatchObject({
      status: 'completed',
      identity: { triggerKind: 'agent_chat_message', anchorMessageId: 42, anchorMessageKey: 'number:42', anchorContentDigest: replay.initialAnchor.contentDigest },
      result: { outcome: 'no_change' },
    });
    expect(replay.chat[1]).toMatchObject({ is_user: true, message_id: 43, mes: '继续观察钟楼。' });
    expect(readWorldSimulationConversation_ACU(replay.chat).messages).toMatchObject([{ kind: 'user', text: '手动推进钟楼世界状态' }]);
    expect(replay.store.read()).toMatchObject({ ledger: { revision: 0 }, task: { status: 'completed', activeRun: null }, timeline: expect.arrayContaining([expect.objectContaining({ kind: 'no_change' })]) });
    expect(replay.commitProjection).not.toHaveBeenCalled();
    expect(replay.saveChat).toHaveBeenCalledTimes(4);
  });

  it('有授权证据且全部派工均为 no_change 时零 strict commit 收敛', async () => {
    const replay = buildReplay({ mode: 'no_change', entry: 'assistant' });

    const result = await replay.run();

    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'no_change', outcomes: [{ status: 'no_change' }] } });
    expect(replay.store.read()).toMatchObject({ ledger: { revision: 0 }, task: { status: 'completed', activeRun: null }, stages: [{ status: 'completed' }] });
    expect(replay.commitProjection).not.toHaveBeenCalled();
    expect(replay.saveChat).toHaveBeenCalledTimes(3);
    expect(readWorldSimulationSessionLog_ACU('chat-replay')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'main_action', title: '主 Agent 动作：finalize', ok: true }),
      expect.objectContaining({ kind: 'run_completed', title: '世界推演无变化', ok: true }),
    ]));
  });

  it('blocked 终局保留活动租约供恢复，但零 strict commit、零账本变更', async () => {
    const replay = buildReplay({ mode: 'blocked', entry: 'assistant' });

    const result = await replay.run();

    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'blocked', summary: '证据不足，拒绝提交', unresolved: ['missing causal evidence'] } });
    expect(replay.store.read()).toMatchObject({
      ledger: { revision: 0 },
      task: { status: 'paused', activeRun: { anchorMessageId: 42 }, stopReason: '证据不足，拒绝提交' },
      stages: [{ status: 'failed' }],
      timeline: expect.arrayContaining([expect.objectContaining({ kind: 'blocked', message: '证据不足，拒绝提交' })]),
    });
    expect(replay.commitProjection).not.toHaveBeenCalled();
    expect(replay.saveChat).toHaveBeenCalledTimes(3);
    expect(readWorldSimulationSessionLog_ACU('chat-replay')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'block', title: '证据不足，拒绝提交', ok: false }),
    ]));
    expect(replay.invocations.every(item => !item.response.includes('https://'))).toBe(true);
    expect(replay.toolSearch).not.toHaveBeenCalled();
  });
});
