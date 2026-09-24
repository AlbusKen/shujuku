// T9 世界推演隔离 API replay：禁止真实网络与模型费用。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { WorldSimulationOrchestrator_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import { buildDirectorOwnedStageRevision_ACU } from '../../../src/service/simulation/simulation-stage-planner';
import { WorldSimulationStageExecutionEngine_ACU } from '../../../src/service/simulation/simulation-stage-execution-engine';
import { WorldSimulationMainLoop_ACU } from '../../../src/service/simulation/agent/agent-main-loop';
import { WorldSimulationSubagentRuntime_ACU } from '../../../src/service/simulation/agent/agent-subagent-runtime';
import { appendWorldSimulationSessionEvent_ACU, appendWorldSimulationUserInstruction_ACU, readWorldSimulationConversation_ACU, readWorldSimulationDirectorHistory_ACU } from '../../../src/service/simulation/agent/agent-conversation-store';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/agent/agent-session-log';
import { resetWorldSimulationRunCacheForTests_ACU } from '../../../src/service/simulation/agent/agent-run-cache';
import { commitWorldSimulationProjection_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { FirstFloorWorldSimulationStore_ACU, assertWorldSimulationAnchorCurrent_ACU, buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { createWorldSimulationCompletionIntent_ACU, restoreWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-trigger-adapter';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';
import type { WorldSimulationAgentName_ACU } from '../../../src/service/simulation/agent/agent-catalog';
import type { WorldSimulationRunIdentity_ACU } from '../../../src/service/simulation/model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

type ReplayMode = 'commit_partial' | 'no_change' | 'blocked';

const isolatedPreset = {
  resolvePreset: vi.fn(() => ({
    resolved: true,
    apiMode: 'custom' as const,
    apiConfig: { url: 'https://invalid.local', apiKey: '', model: 'isolated-replay' } as any,
    tavernProfile: '',
  })),
};

interface ReplayOptions {
  mode: ReplayMode;
  entry: 'assistant' | 'agent';
  trailingUser?: boolean;
  anchored?: boolean;
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
  const invocations: Array<{ role: WorldSimulationAgentName_ACU; response: string; messages: readonly { role: string; content: string }[] }> = [];

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
    const scripts = new Map<WorldSimulationAgentName_ACU, string[]>([
      ['world-director', [
        JSON.stringify({ action: 'read', reads: ['anchor:message'] }),
        ...(options.mode === 'blocked'
          ? [JSON.stringify({ action: 'block', reason: '证据不足，拒绝提交', unresolved: ['missing causal evidence'] })]
          : [JSON.stringify({
              action: 'open_round',
              summary: options.mode === 'no_change' ? '核验后没有幕后变化' : '锁定钟楼时间推进',
              focus: '世界时钟',
              dispatchChronicler: false,
            })]),
      ]],
      ['timekeeper', [options.mode === 'no_change'
        ? JSON.stringify({
            status: 'no_change',
            agentName: 'timekeeper',
            summary: '当前证据不足以支持状态变化',
            evidenceRefs: [initialEvidence],
            uncertainties: [],
          })
        : JSON.stringify({
            status: 'candidate',
            agentName: 'timekeeper',
            patch: clockPatch,
            summary: clockSummary,
            evidenceRefs: [initialEvidence],
            uncertainties: [],
          })]],
      ['undercurrent-analyst', [JSON.stringify({
        status: 'no_change', agentName: 'undercurrent-analyst', summary: '暗流没有变化', evidenceRefs: [initialEvidence], uncertainties: [],
      })]],
      ['dramatis-keeper', [JSON.stringify({
        status: 'no_change', agentName: 'dramatis-keeper', summary: '人物没有变化', evidenceRefs: [initialEvidence], uncertainties: [],
      })]],
      ['guidance-composer', [JSON.stringify({
        status: 'candidate',
        agentName: 'guidance-composer',
        patch: { guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' }] } },
        summary: '远处钟声可以进入投影',
        evidenceRefs: [initialEvidence],
        uncertainties: [],
      })]],
    ]);
    const invoke = vi.fn(async (role: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[]) => {
      const queue = scripts.get(role);
      const response = queue?.shift();
      if (!response) throw new Error(`UNEXPECTED_MODEL_INVOCATION:${role}`);
      invocations.push({ role, response, messages });
      return response;
    });
    const countTokens = async () => 1;
    const plannedRevision = buildDirectorOwnedStageRevision_ACU({
      instruction: input.instruction,
      collisions: { playerRegion: null, playerContact: 'open', secludedNote: null, collidedSeeds: [], ripeRumors: [] },
      now: ++clock,
    });
    expect(plannedRevision.plan.plannedSpecialists).not.toContain('chronicler');
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
      worldStagePlan: plannedRevision.plan,
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
      revision: plannedRevision,
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
            ...(options.anchored ? {
              anchor: input.anchor,
              chat,
              persistSessionEvent: (eventKey: string, event: import('../../../src/service/simulation/agent/agent-session-log').WorldSimulationSessionInput_ACU) =>
                appendWorldSimulationSessionEvent_ACU({ anchor: input.anchor, runId: identity.runId, taskId: identity.taskId,
                  stageId: identity.stageId, stageRevision: identity.stageRevision, eventKey, event }, chat),
            } : {}),
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
    ...(options.anchored ? { persistCompletion: async ({ identity, anchor, outcome, summary }) => {
      await appendWorldSimulationSessionEvent_ACU({ anchor, runId: identity.runId, taskId: identity.taskId,
        stageId: identity.stageId, stageRevision: identity.stageRevision, eventKey: `run-completed-${outcome}`,
        event: { kind: 'run_completed', title: outcome === 'commit' ? '世界推演已提交' : '世界推演无变化', detail: summary, agentName: 'world-director' } }, chat);
    } } : {}),
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
      ['timekeeper', 'candidate', undefined],
      ['undercurrent-analyst', 'no_change', undefined],
      ['dramatis-keeper', 'no_change', undefined],
      ['guidance-composer', 'candidate', undefined],
    ]);
    expect(result.result.commitCandidate.acceptedCandidates.map(item => item.agentName)).toEqual(['timekeeper', 'guidance-composer']);
    expect(replay.store.read()).toMatchObject({ ledger: { revision: 1, clock: { day: 2, storyTime: '1h' }, guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient' }] } }, task: { status: 'completed', activeRun: null } });
    expect(replay.commitProjection).toHaveBeenCalledOnce();
    expect(replay.saveChat).toHaveBeenCalledTimes(3);
    expect(replay.toolRead).toHaveBeenCalledWith('anchor:message');
    expect(replay.toolSearch).not.toHaveBeenCalled();
    expect(replay.invocations.map(item => item.role)).not.toContain('world-stage-planner');
    expect(replay.invocations.map(item => item.role)).not.toContain('chronicler');
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

    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'no_change', outcomes: [{ status: 'no_change' }, { status: 'no_change' }, { status: 'no_change' }] } });
    expect(replay.store.read()).toMatchObject({ ledger: { revision: 0 }, task: { status: 'completed', activeRun: null }, stages: [{ status: 'completed' }] });
    expect(replay.commitProjection).not.toHaveBeenCalled();
    expect(replay.saveChat).toHaveBeenCalledTimes(3);
    expect(readWorldSimulationSessionLog_ACU('chat-replay')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'main_action', title: '主 Agent 动作：open_round', ok: true }),
      expect.objectContaining({ kind: 'run_completed', title: '世界推演无变化', ok: true }),
    ]));
  });

  it('锚定导演仅在投影提交后公告完成，正文 D1 中保留原始动作与反馈', async () => {
    const replay = buildReplay({ mode: 'commit_partial', entry: 'assistant', anchored: true });
    replay.commitProjection.mockImplementationOnce(async input => {
      const pending = readWorldSimulationConversation_ACU(replay.chat).messages;
      expect(pending.filter(item => item.eventKind === 'run_completed')).toHaveLength(0);
      expect(readWorldSimulationSessionLog_ACU('chat-replay').some(item => item.kind === 'run_completed')).toBe(false);
      expect(pending.filter(item => item.kind === 'model_agent').length).toBeGreaterThan(0);
      return commitWorldSimulationProjection_ACU(input);
    });

    const result = await replay.run();

    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'commit' } });
    const currentAnchor = resolveWorldSimulationAnchor_ACU(0, replay.chat);
    expect(currentAnchor.contentDigest).not.toBe(replay.initialAnchor.contentDigest);
    const messages = readWorldSimulationConversation_ACU(replay.chat).messages;
    expect(messages.filter(item => item.eventKind === 'run_completed')).toMatchObject([{ title: '世界推演已提交' }]);
    expect(messages.filter(item => item.kind === 'model_agent')).toHaveLength(messages.filter(item => item.kind === 'model_feedback').length);
    const director = replay.invocations.filter(item => item.role === 'world-director');
    expect(director[1].messages.filter(item => item.content === director[0].response)).toHaveLength(1);
    expect(readWorldSimulationDirectorHistory_ACU(replay.chat).filter(item => item.content === director[0].response)).toHaveLength(1);
    expect(readWorldSimulationDirectorHistory_ACU(replay.chat).at(-1)?.content).toContain('prepared');
    const duplicate = await replay.runtime.handleAssistantCompletion(createWorldSimulationCompletionIntent_ACU(42, 'chat-replay', '', replay.chat, 1));
    expect(duplicate).toEqual({ status: 'skipped', reason: 'duplicate' });
    expect(replay.commitProjection).toHaveBeenCalledOnce();
    expect(readWorldSimulationConversation_ACU(replay.chat).messages.filter(item => item.eventKind === 'run_completed')).toHaveLength(1);
  });

  it('锚定导演 no_change 权威保存后仅有一次完成通告，blocked 不伪装完成', async () => {
    const replay = buildReplay({ mode: 'no_change', entry: 'assistant', anchored: true });
    const result = await replay.run();
    expect(result).toMatchObject({ status: 'completed', result: { outcome: 'no_change' } });
    expect(readWorldSimulationConversation_ACU(replay.chat).messages.filter(item => item.eventKind === 'run_completed'))
      .toMatchObject([{ title: '世界推演无变化' }]);
    expect(readWorldSimulationDirectorHistory_ACU(replay.chat).at(-1)?.content).toContain('prepared');
    expect(await replay.runtime.handleAssistantCompletion(createWorldSimulationCompletionIntent_ACU(42, 'chat-replay', '', replay.chat, 1)))
      .toEqual({ status: 'skipped', reason: 'duplicate' });
    expect(readWorldSimulationConversation_ACU(replay.chat).messages.filter(item => item.eventKind === 'run_completed')).toHaveLength(1);

    const blocked = buildReplay({ mode: 'blocked', entry: 'assistant', anchored: true });
    expect(await blocked.run()).toMatchObject({ status: 'completed', result: { outcome: 'blocked' } });
    expect(readWorldSimulationConversation_ACU(blocked.chat).messages.filter(item => item.eventKind === 'run_completed')).toHaveLength(0);
  });

  it('投影提交失败时不发完成通告；独立通告保存失败不回滚已经提交的正文', async () => {
    const failed = buildReplay({ mode: 'commit_partial', entry: 'assistant', anchored: true });
    failed.commitProjection.mockImplementationOnce(async () => { throw new Error('PRIMARY_COMMIT_FAILED'); });
    const result = await failed.run();
    expect(result).toMatchObject({ status: 'failed' });
    expect(readWorldSimulationConversation_ACU(failed.chat).messages.filter(item => item.eventKind === 'run_completed')).toHaveLength(0);
    expect(readWorldSimulationSessionLog_ACU('chat-replay').filter(item => item.kind === 'run_completed')).toHaveLength(0);

    resetWorldSimulationSessionLogForTests_ACU();
    const receiptFailed = buildReplay({ mode: 'commit_partial', entry: 'assistant', anchored: true });
    let committedContent = '';
    receiptFailed.saveChat.mockImplementation(async () => {
      if (readWorldSimulationConversation_ACU(receiptFailed.chat).messages.some(item => item.eventKind === 'run_completed')) {
        committedContent = receiptFailed.chat[0].mes;
        throw new Error('RECEIPT_SAVE_FAILED');
      }
    });
    const completed = await receiptFailed.run();
    expect(completed).toMatchObject({ status: 'completed', result: { outcome: 'commit' } });
    expect(receiptFailed.chat[0].mes).toBe(committedContent);
    expect(receiptFailed.store.read()?.task?.status).toBe('completed');
    expect(readWorldSimulationConversation_ACU(receiptFailed.chat).messages.filter(item => item.eventKind === 'run_completed')).toHaveLength(0);
    expect(readWorldSimulationSessionLog_ACU('chat-replay')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'run_completed' }), expect.objectContaining({ title: '完成通告保存失败', ok: false }),
    ]));
  });

  it('投影保存和补偿保存都失败时不公告完成，并保留双重失败诊断', async () => {
    const replay = buildReplay({ mode: 'commit_partial', entry: 'assistant', anchored: true });
    replay.commitProjection.mockImplementationOnce(async input => {
      replay.saveChat.mockRejectedValueOnce(new Error('PRIMARY_COMMIT_FAILED'))
        .mockRejectedValueOnce(new Error('ROLLBACK_SAVE_FAILED'));
      return commitWorldSimulationProjection_ACU(input);
    });
    const result = await replay.run();
    expect(result).toMatchObject({ status: 'failed', error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });
    if (result?.status !== 'failed') throw new Error('expected failed commit');
    expect(result.error.details).toMatchObject({ primaryMessage: 'PRIMARY_COMMIT_FAILED', rollbackMessage: 'ROLLBACK_SAVE_FAILED' });
    expect(replay.commitProjection).toHaveBeenCalledOnce();
    expect(readWorldSimulationConversation_ACU(replay.chat).messages.filter(item => item.eventKind === 'run_completed')).toHaveLength(0);
    expect(readWorldSimulationSessionLog_ACU('chat-replay').filter(item => item.kind === 'run_completed')).toHaveLength(0);
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
