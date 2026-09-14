import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import type { WorldSimulationSettings_ACU } from '../../../src/service/simulation/model';
import type { WorldSimulationLeaseSnapshot_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import {
  WorldSimulationRuntime_ACU,
  isWorldSimulationSettings_ACU,
  type WorldSimulationOrchestratorPort_ACU,
  type WorldSimulationRuntimeDependencies_ACU,
} from '../../../src/service/simulation/simulation-runtime';
import { readWorldSimulationStoryBranchIdentity_ACU } from '../../../src/service/simulation/world-simulation-story-context';

function enabledSettings(overrides: Partial<WorldSimulationSettings_ACU> = {}): WorldSimulationSettings_ACU {
  return { ...buildDefaultWorldSimulationSettings_ACU(), enabled: true, ...overrides };
}

function lease(anchorMessageIndex: number): WorldSimulationLeaseSnapshot_ACU {
  return {
    chatIdentity: 'chat-a',
    lineageKey: 'ledger:empty',
    anchorMessageIndex,
    replayDigest: null,
    revisions: { entities: 0, events: 0, threads: 0 },
  };
}

function createPort(overrides: Partial<WorldSimulationOrchestratorPort_ACU> = {}): WorldSimulationOrchestratorPort_ACU {
  return {
    getPhase: () => 'idle',
    getSettlementPromise: () => null,
    abandonSettlement: vi.fn(() => true),
    discardFlight: vi.fn(() => true),
    discardFlightsExcept: vi.fn(() => 0),
    getSettledTip: () => null,
    trigger: vi.fn(async () => { throw new Error('trigger must not be called'); }),
    ...overrides,
  };
}

function createRuntime(overrides: Partial<WorldSimulationRuntimeDependencies_ACU> = {}) {
  const runOwnedAi = vi.fn(async () => null);
  const dependencies: WorldSimulationRuntimeDependencies_ACU = {
    getChat: () => [],
    getChatIdentity: () => 'chat-a',
    readSettings: () => enabledSettings({ joinWaitMs: 0 }),
    readLeaseSnapshot: () => lease(0),
    createRunId: () => 'run-a',
    countTokens: async () => 1,
    isFlightModeActive: () => false,
    runOwnedAi,
    store: { read: () => null } as any,
    ...overrides,
  };
  return { runtime: new WorldSimulationRuntime_ACU(dependencies), dependencies, runOwnedAi };
}

async function flush(): Promise<void> { for (let index = 0; index < 50; index += 1) await Promise.resolve(); }

afterEach(() => { vi.useRealTimers(); });

describe('isWorldSimulationSettings_ACU', () => {
  it('accepts the default shape and rejects malformed or out-of-range fields', () => {
    expect(isWorldSimulationSettings_ACU(buildDefaultWorldSimulationSettings_ACU())).toBe(true);
    expect(isWorldSimulationSettings_ACU(enabledSettings())).toBe(true);
    expect(isWorldSimulationSettings_ACU(null)).toBe(false);
    expect(isWorldSimulationSettings_ACU([])).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), enabled: 'yes' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), joinWaitMs: -1 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), joinWaitMs: 30_001 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), joinWaitMs: 1.5 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), minFloorGap: 0 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), visibilityPolicy: 'sometimes' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), showHiddenInUi: 'true' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), budgets: { light: { maxMasterModelTurns: 0, maxSpecialistModelTurns: 1, maxDelegations: 0, legacyReadCount: null, readTokenBudget: 'low' } } })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), apiPresetMode: 'other' })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), fixedApiPresetName: 123 })).toBe(false);
    expect(isWorldSimulationSettings_ACU({ ...enabledSettings(), apiPresetMode: 'fixed', fixedApiPresetName: '预设A' })).toBe(true);
  });
});

function intent(eventMessageId: number, capturedChatLength: number, capturedAiFloorCount: number) {
  return { eventMessageId, chatKey: 'chat-a', isolationKey: '', capturedAt: 0, capturedChatLength, capturedAiFloorCount };
}

const aiChat = () => [{ is_user: true, mes: 'u' }, { is_user: false, message_id: 1, mes: 'a' }];

function gateReply(anchorMessageIndex: number): string {
  return JSON.stringify({
    storyTime: { anchorText: '第1日', elapsedSinceLastRun: '3小时', precision: 'approximate', evidenceIndexes: [anchorMessageIndex] },
    worthUpdating: true,
    reason: '故事时间已推进到小时级',
    focusHints: [],
    scale: 'light',
  });
}

describe('WorldSimulationRuntime_ACU.onAiFloorCompleted', () => {
  it('pays for nothing when settings are missing, disabled or invalid', async () => {
    for (const settings of [null, enabledSettings({ enabled: false })]) {
      const { runtime, runOwnedAi } = createRuntime({ getChat: aiChat, readSettings: () => settings });
      await runtime.onAiFloorCompleted(intent(1, 2, 1));
      await flush();
      expect(runOwnedAi).not.toHaveBeenCalled();
    }
  });

  it('runs exactly one gate call, then starts the main flight for a uniquely resolved AI floor', async () => {
    const trigger = vi.fn(async () => ({}));
    const owned = vi.fn(async () => gateReply(1));
    const { runtime } = createRuntime({
      getChat: aiChat,
      runOwnedAi: owned,
      orchestrator: createPort({ trigger }),
    });

    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();

    expect(owned).toHaveBeenCalledTimes(1);
    expect(owned.mock.calls[0]![0]).toMatchObject({ source: 'world-sim-gate', chatIdentity: 'chat-a' });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0]![0]).toBe(1);
  });

  it('continues the automatic gate after a queued manual request completes with no_change', async () => {
    const trigger = vi.fn(async () => ({}));
    const runPendingForAnchor = vi.fn(async () => 'no_change');
    const owned = vi.fn(async () => gateReply(1));
    const { runtime } = createRuntime({
      getChat: aiChat,
      runOwnedAi: owned,
      orchestrator: createPort({ trigger }),
      agentSession: { isRunning: () => false, runPendingForAnchor } as any,
    });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();
    expect(runPendingForAnchor).toHaveBeenCalledWith(1, expect.any(Array));
    expect(owned).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('continues FIFO drain when a session settles while its current drain is still active', async () => {
    let calls = 0;
    let runtime!: WorldSimulationRuntime_ACU;
    const agentSession = {
      isRunning: () => false,
      hasPendingRequest: () => calls < 2,
      runPendingForAnchor: vi.fn(async () => {
        calls += 1;
        if (calls === 1) runtime.requestPendingAgentDrain();
        return 'no_change';
      }),
    };
    ({ runtime } = createRuntime({ getChat: aiChat, agentSession: agentSession as any }));
    runtime.requestPendingAgentDrain();
    await flush();
    expect(agentSession.runPendingForAnchor).toHaveBeenCalledTimes(2);
  });

  it('drains a second pending request before resuming the automatic gate after the first no_change', async () => {
    let pending = 2;
    const trigger = vi.fn(async () => ({}));
    const owned = vi.fn(async () => gateReply(1));
    const agentSession = {
      isRunning: () => false,
      hasPendingRequest: () => pending > 0,
      runPendingForAnchor: vi.fn(async () => {
        if (!pending) return 'not_run';
        pending -= 1;
        return 'no_change';
      }),
    };
    const { runtime } = createRuntime({ getChat: aiChat, runOwnedAi: owned, agentSession: agentSession as any, orchestrator: createPort({ trigger }) });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();
    expect(agentSession.runPendingForAnchor).toHaveBeenCalledTimes(2);
    expect(owned).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('interrupts an automatic cancellable gate, queues maintenance, and drains it after the flight exits', async () => {
    let entered: (() => void) | undefined;
    let signal: AbortSignal | null | undefined;
    const gate = new Promise<string>((_resolve, reject) => {
      entered = () => undefined;
      void reject;
    });
    const owned = vi.fn(async (request: any) => {
      if (request.source !== 'world-sim-gate') return null;
      signal = request.signal;
      entered?.();
      return new Promise<string>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    });
    const agentSession = { isRunning: () => false, isCommitting: () => false, submit: vi.fn(async () => 'queued'), stop: vi.fn(() => 'idle'), runPendingForAnchor: vi.fn(async () => 'not_run') };
    const { runtime } = createRuntime({ getChat: aiChat, runOwnedAi: owned, agentSession: agentSession as any, orchestrator: createPort() });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    for (let index = 0; index < 20 && !signal; index += 1) await Promise.resolve();
    const result = await runtime.interruptAndMaintain({ action: 'interrupt_and_maintain', instruction: '先停止并维护' });
    expect(result).toBe('queued_after_flight');
    expect(agentSession.submit).toHaveBeenCalledWith('先停止并维护', { forceQueue: true });
    expect(signal?.aborted).toBe(true);
    await flush();
    expect(agentSession.runPendingForAnchor).toHaveBeenCalledWith(1, expect.any(Array));
  });

  it('queues explicit maintenance behind a committing automatic flight without attempting cancellation', async () => {
    const discardFlight = vi.fn(() => true);
    const agentSession = { isRunning: () => false, isCommitting: () => false, submit: vi.fn(async () => 'queued'), stop: vi.fn(() => 'idle'), runPendingForAnchor: vi.fn(async () => 'not_run') };
    const { runtime } = createRuntime({ getChat: aiChat, agentSession: agentSession as any, orchestrator: createPort({ getPhase: () => 'committing', discardFlight }) });
    await expect(runtime.interruptAndMaintain({ action: 'interrupt_and_maintain', instruction: '保存后维护' })).resolves.toBe('queued_after_commit');
    expect(discardFlight).not.toHaveBeenCalled();
  });

  it('never calls the gate for a pending or ambiguous floor resolution', async () => {
    const onlyUser = [{ is_user: true, mes: 'u' }];
    const { runtime, runOwnedAi } = createRuntime({ getChat: () => onlyUser });
    await runtime.onAiFloorCompleted(intent(1, 1, 0));
    await flush();
    expect(runOwnedAi).not.toHaveBeenCalled();
  });

  it('ignores an already settled anchor', async () => {
    const owned = vi.fn(async () => gateReply(1));
    const { runtime } = createRuntime({
      getChat: aiChat,
      runOwnedAi: owned,
      orchestrator: createPort({ getSettledTip: () => 1 }),
    });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();
    expect(owned).not.toHaveBeenCalled();
  });

  it('folds a newer floor into an existing flight instead of paying for a second gate', async () => {
    const trigger = vi.fn(async () => ({}));
    const owned = vi.fn(async () => gateReply(1));
    const { runtime } = createRuntime({
      getChat: aiChat,
      runOwnedAi: owned,
      orchestrator: createPort({ getPhase: () => 'candidate_pending', trigger }),
    });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();
    expect(owned).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the chat identity cannot be resolved', async () => {
    const owned = vi.fn(async () => gateReply(1));
    const { runtime } = createRuntime({ getChat: aiChat, getChatIdentity: () => '  ', runOwnedAi: owned });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();
    expect(owned).not.toHaveBeenCalled();
  });

  it('routes a uniquely hinted light floor directly to one specialist without a world-director call', async () => {
    const state = { anchorMessageIndex: 0, storyClock: { anchorText: '第1日', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 }, entities: [{ id: 'ent-1', kind: 'character', name: '密探', importance: 'active', situation: '观察', agenda: '等待', lastMovedIndex: 0, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
    const gate = JSON.stringify({ storyTime: { anchorText: '第1日', elapsedSinceLastRun: '3小时', precision: 'approximate', evidenceIndexes: [1] }, worthUpdating: true, reason: '实体焦点', focusHints: ['ent-1'], scale: 'light' });
    const transaction = JSON.stringify({ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: { ...state.entities[0], situation: '已移动', updatedIndex: 0 } }], events: [], threads: [] });
    const candidate = JSON.stringify({ ...JSON.parse(transaction), evidenceRefs: ['$WORLD_STATE'], summary: '密探移动', uncertainties: [] });
    let specialistCalls = 0;
    const owned = vi.fn(async (request: any) => request.source === 'world-sim-gate'
      ? gate
      : ++specialistCalls === 1 ? '{"thought":"核对当前状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}' : candidate);
    const trigger = vi.fn(async (_anchor: number, runner: any) => runner({ runId: 'run-light', isCurrent: () => true, getMetadata: () => ({ initialAnchorMessageIndex: 1 }) }));
    const storyContext: any = { feature: 'world-simulation', runId: 'run-light', chatIdentity: 'chat-a', branchIdentity: readWorldSimulationStoryBranchIdentity_ACU(aiChat(), 1), sourceRevision: 'r1', sourceDigest: 'd1', profile: 'world-director', overview: { state: 'ready', text: '概览', digest: 'o1', diagnostic: '' }, pending: { text: '正文', digest: 'p1' }, bridge: { text: '', digest: 'b1' }, catalog: { text: '1', digest: 'c1' } };
    const { runtime } = createRuntime({
      getChat: aiChat, runOwnedAi: owned, orchestrator: createPort({ trigger }),
      store: { read: () => ({ state, deltaMessageIndices: [], checkpointMessageIndex: -1 }) } as any,
      buildStoryContext: async () => storyContext,
    });
    await runtime.onAiFloorCompleted(intent(1, 2, 1)); await flush();
    expect(owned.mock.calls.map(call => call[0].source)).toEqual(['world-sim-gate', 'world-sim-agent:entity-movement', 'world-sim-agent:entity-movement']);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('clears an automatic light empty C5 candidate without calling the settler or commitProjection', async () => {
    const state = { anchorMessageIndex: 0, storyClock: { anchorText: '第1日', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 }, entities: [{ id: 'ent-1', kind: 'character', name: '密探', importance: 'active', situation: '观察', agenda: '等待', lastMovedIndex: 0, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
    const gate = JSON.stringify({ storyTime: { anchorText: '第1日', elapsedSinceLastRun: '3小时', precision: 'approximate', evidenceIndexes: [1] }, worthUpdating: true, reason: '实体焦点', focusHints: ['ent-1'], scale: 'light' });
    const emptyCandidate = '{"expectedRevisions":{},"entities":[],"events":[],"threads":[],"evidenceRefs":[],"summary":"当前没有安全变化","uncertainties":["暂无新增事实"]}';
    const owned = vi.fn(async (request: any) => request.source === 'world-sim-gate' ? gate : emptyCandidate);
    const commitProjection = vi.fn(async () => ({}));
    const { WorldSimulationOrchestrator_ACU } = await import('../../../src/service/simulation/simulation-orchestrator');
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => lease(1), createRunId: () => 'empty-light' });
    const storyContext: any = { feature: 'world-simulation', runId: 'empty-light', chatIdentity: 'chat-a', branchIdentity: readWorldSimulationStoryBranchIdentity_ACU(aiChat(), 1), sourceRevision: 'r1', sourceDigest: 'd1', profile: 'world-director', overview: { state: 'ready', text: '概览', digest: 'o1', diagnostic: '' }, pending: { text: '正文', digest: 'p1' }, bridge: { text: '', digest: 'b1' }, catalog: { text: '1', digest: 'c1' } };
    const { runtime } = createRuntime({
      getChat: aiChat, runOwnedAi: owned, orchestrator, readLeaseSnapshot: () => lease(1),
      store: { read: () => ({ state, deltaMessageIndices: [], checkpointMessageIndex: -1 }), commitProjection } as any,
      buildStoryContext: async () => storyContext,
    });
    await runtime.onAiFloorCompleted(intent(1, 2, 1));
    await flush();
    expect(owned.mock.calls.map(call => call[0].source)).toEqual(['world-sim-gate', 'world-sim-agent:entity-movement']);
    expect(orchestrator.getPhase('chat-a')).toBe('idle');
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('rejects an automatic candidate when frozen requirements change before settlement', async () => {
    const state = { anchorMessageIndex: 0, storyClock: { anchorText: '第1日', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 }, entities: [{ id: 'ent-1', kind: 'character', name: '密探', importance: 'active', situation: '观察', agenda: '等待', lastMovedIndex: 0, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
    const gate = JSON.stringify({ storyTime: { anchorText: '第1日', elapsedSinceLastRun: '3小时', precision: 'approximate', evidenceIndexes: [1] }, worthUpdating: true, reason: '实体焦点', focusHints: ['ent-1'], scale: 'light' });
    const transaction = JSON.stringify({ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: { ...state.entities[0], situation: '已移动', updatedIndex: 0 } }], events: [], threads: [] });
    const candidate = JSON.stringify({ ...JSON.parse(transaction), evidenceRefs: ['$WORLD_STATE'], summary: '密探移动', uncertainties: [] });
    let requirementRevision = 0;
    const requirementsStore: any = { read: () => ({ feature: 'world-simulation' as const, revision: requirementRevision, lastAppliedUserMessageId: null, requirements: [] }), userSourceIds: () => [], pendingSourceIds: () => [], replace: vi.fn() };
    let specialistCalls = 0;
    const owned = vi.fn(async (request: any) => {
      if (request.source === 'world-sim-gate') return gate;
      specialistCalls += 1;
      if (specialistCalls === 1) return '{"thought":"核对状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}';
      requirementRevision = 1;
      return candidate;
    });
    const commitProjection = vi.fn(async () => ({}));
    const { WorldSimulationOrchestrator_ACU } = await import('../../../src/service/simulation/simulation-orchestrator');
    const orchestrator = new WorldSimulationOrchestrator_ACU({ readLeaseSnapshot: () => lease(1), createRunId: () => 'material-stale' });
    const storyContext: any = { feature: 'world-simulation', runId: 'material-stale', chatIdentity: 'chat-a', branchIdentity: readWorldSimulationStoryBranchIdentity_ACU(aiChat(), 1), sourceRevision: 'r1', sourceDigest: 'd1', profile: 'world-director', overview: { state: 'ready', text: '概览', digest: 'o1', diagnostic: '' }, pending: { text: '正文', digest: 'p1' }, bridge: { text: '', digest: 'b1' }, catalog: { text: '1', digest: 'c1' } };
    const { runtime } = createRuntime({ getChat: aiChat, runOwnedAi: owned, orchestrator, readLeaseSnapshot: () => lease(1), requirementsStore, loadWorldbook: async () => ({ available: true, entries: [] }), store: { read: () => ({ state, deltaMessageIndices: [], checkpointMessageIndex: -1 }), commitProjection } as any, buildStoryContext: async () => storyContext });
    await runtime.onAiFloorCompleted(intent(1, 2, 1)); await flush();
    expect(orchestrator.getPhase('chat-a')).toBe('idle');
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('passes a normal director delegation seed read to its selected automatic specialist', async () => {
    const state = { anchorMessageIndex: 0, storyClock: { anchorText: '第1日', elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: 0 }, entities: [{ id: 'ent-1', kind: 'character', name: '密探', importance: 'active', situation: '观察', agenda: '等待', lastMovedIndex: 0, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
    const gate = JSON.stringify({ storyTime: { anchorText: '第2日', elapsedSinceLastRun: '一日', precision: 'approximate', evidenceIndexes: [1] }, worthUpdating: true, reason: '需要核验实体', focusHints: [], scale: 'normal' });
    const transaction = JSON.stringify({ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: { ...state.entities[0], situation: '已移动', updatedIndex: 0 } }], events: [], threads: [] });
    const candidate = JSON.stringify({ ...JSON.parse(transaction), evidenceRefs: ['$WORLD_STATE'], summary: '密探移动', uncertainties: [] });
    let masterCalls = 0;
    let specialistCalls = 0;
    const owned = vi.fn(async (request: any) => {
      if (request.source === 'world-sim-gate') return gate;
      if (request.source === 'world-sim-master') {
        masterCalls += 1;
        return masterCalls === 1
          ? '{"action":"delegate","thought":"补证后核验","delegations":[{"agentName":"entity-movement","task":"核验密探位置","materialGrants":[],"reads":["$STORY_PENDING"]}]}'
          : '{"action":"finalize","thought":"采用候选","decision":"commit","acceptedAgents":["entity-movement"],"summary":"可提交","unresolved":[]}';
      }
      specialistCalls += 1;
      return specialistCalls === 1
        ? '{"thought":"读取当前状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}'
        : candidate;
    });
    const trigger = vi.fn(async (_anchor: number, runner: any) => runner({ runId: 'run-normal', isCurrent: () => true, getMetadata: () => ({ initialAnchorMessageIndex: 1 }) }));
    const storyContext: any = { feature: 'world-simulation', runId: 'run-normal', chatIdentity: 'chat-a', branchIdentity: readWorldSimulationStoryBranchIdentity_ACU(aiChat(), 1), sourceRevision: 'r1', sourceDigest: 'd1', profile: 'world-director', overview: { state: 'ready', text: '概览', digest: 'o1', diagnostic: '' }, pending: { text: '正文', digest: 'p1' }, bridge: { text: '', digest: 'b1' }, catalog: { text: '1', digest: 'c1' } };
    const { runtime } = createRuntime({ getChat: aiChat, runOwnedAi: owned, orchestrator: createPort({ trigger }), store: { read: () => ({ state, deltaMessageIndices: [], checkpointMessageIndex: -1 }) } as any, buildStoryContext: async () => storyContext });

    await runtime.onAiFloorCompleted(intent(1, 2, 1)); await flush();
    const specialistCallsForAgent = owned.mock.calls.filter(call => call[0].source === 'world-sim-agent:entity-movement');
    const specialist = specialistCallsForAgent[0]![0];
    const seedRead = specialist.messages.find((message: any) => message.content.includes('<UNTRUSTED_READ_MATERIAL>'));
    expect(seedRead).toMatchObject({ role: 'user' });
    expect(seedRead.content).toContain('### $STORY_PENDING');
    const toolResults = specialistCallsForAgent[1]![0].messages.find((message: any) => message.content.includes('<UNTRUSTED_TOOL_RESULTS>'));
    expect(toolResults).toMatchObject({ role: 'user' });
    expect(toolResults.content).toContain('### $WORLD_STATE');
    expect(owned.mock.calls.map(call => call[0].source)).toEqual(['world-sim-gate', 'world-sim-master', 'world-sim-agent:entity-movement', 'world-sim-agent:entity-movement', 'world-sim-master']);
  });


});

describe('WorldSimulationRuntime_ACU.awaitBeforePlotStart', () => {
  const pendingSettlement = () => new Promise<void>(() => undefined);

  it('skips when disabled, idle, simulating, or without a settlement promise', async () => {
    const disabled = createRuntime({ readSettings: () => enabledSettings({ enabled: false }) });
    expect(await disabled.runtime.awaitBeforePlotStart()).toEqual({ kind: 'skipped' });

    // Only a fully idle or still-simulating chat short-circuits regardless of settlement state;
    // candidate_pending/checking/committing are exactly the phases the join gate exists for.
    for (const phase of ['idle', 'simulating'] as const) {
      const abandon = vi.fn(() => true);
      const { runtime } = createRuntime({
        orchestrator: createPort({ getPhase: () => phase, getSettlementPromise: () => pendingSettlement(), abandonSettlement: abandon }),
      });
      expect(await runtime.awaitBeforePlotStart()).toEqual({ kind: 'skipped' });
      expect(abandon).not.toHaveBeenCalled();
    }

    // A settlement-candidate phase without any in-flight promise has nothing to join.
    for (const phase of ['candidate_pending', 'checking', 'committing'] as const) {
      const noSettlement = createRuntime({ orchestrator: createPort({ getPhase: () => phase }) });
      expect(await noSettlement.runtime.awaitBeforePlotStart()).toEqual({ kind: 'skipped' });
    }
  });

  it('with joinWaitMs=0 passes through synchronously, creates no timer, and revokes the old target', async () => {
    vi.useFakeTimers();
    const abandon = vi.fn(() => true);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 0 }),
      orchestrator: createPort({ getPhase: () => 'checking', getSettlementPromise: () => pendingSettlement(), abandonSettlement: abandon }),
    });

    const result = await runtime.awaitBeforePlotStart();

    expect(result).toEqual({ kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: true });
    expect(abandon).toHaveBeenCalledWith('chat-a');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('joins when the in-flight settlement completes inside the window', async () => {
    const abandon = vi.fn(() => true);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 1_000 }),
      orchestrator: createPort({
        getPhase: () => 'checking',
        getSettlementPromise: () => Promise.resolve(),
        abandonSettlement: abandon,
      }),
    });

    expect(await runtime.awaitBeforePlotStart()).toEqual({ kind: 'joined' });
    expect(abandon).not.toHaveBeenCalled();
  });

  it('abandons the old target exactly once on timeout and never fakes a save timeout', async () => {
    const abandon = vi.fn(() => true);
    const waitForSettlement = vi.fn(async () => ({ kind: 'timeout' as const }));
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 500 }),
      waitForSettlement,
      orchestrator: createPort({ getPhase: () => 'checking', getSettlementPromise: () => pendingSettlement(), abandonSettlement: abandon }),
    });

    expect(await runtime.awaitBeforePlotStart()).toEqual({ kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: true });
    expect(waitForSettlement).toHaveBeenCalledTimes(1);
    expect(waitForSettlement.mock.calls[0]![1]).toBe(500);
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('窗口耗尽且已进入 committing 时，等到联合提交真实跑完再放行', async () => {
    let release!: () => void;
    const settlement = new Promise<void>(resolve => { release = resolve; });
    let settledBeforeReturn = false;
    const abandon = vi.fn(() => false);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 1_000 }),
      waitForSettlement: vi.fn(async () => ({ kind: 'timeout' as const })),
      orchestrator: createPort({
        getPhase: () => 'committing',
        getSettlementPromise: () => settlement.then(() => { settledBeforeReturn = true; }),
        abandonSettlement: abandon,
      }),
    });

    // committing 之后的宿主保存不可取消，而本轮 r6 结论（compatible 直接提交 / adjust 修改后提交）
    // 已经决定写入：这里必须等它跑完，而不是谎称零提交。
    const pending = runtime.awaitBeforePlotStart();
    release();
    expect(await pending).toEqual({
      kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: false,
    });
    expect(settledBeforeReturn).toBe(true);
    // 已进入不可撤销提交：不得再调用取消/回滚接口。
    expect(abandon).not.toHaveBeenCalled();
  });

  it('窗口耗尽且 committing 提交失败时，把失败结果带出而不是谎报成功放行', async () => {
    let rejectSettlement!: (error: unknown) => void;
    const failure = new Error('WORLD_SIM_PERSIST_FAILED: 联合保存失败');
    const settlement = new Promise<void>((_resolve, reject) => { rejectSettlement = reject; });
    const abandon = vi.fn(() => false);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 1_000 }),
      waitForSettlement: vi.fn(async () => ({ kind: 'timeout' as const })),
      orchestrator: createPort({
        getPhase: () => 'committing',
        getSettlementPromise: () => settlement,
        abandonSettlement: abandon,
      }),
    });

    const pending = runtime.awaitBeforePlotStart();
    rejectSettlement(failure);

    // 宿主保存不可取消：失败也必须等它真实结束后才放行，但结果必须可区分于成功。
    expect(await pending).toEqual({
      kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: false,
      settlementFailure: { error: failure },
    });
    expect(abandon).not.toHaveBeenCalled();
  });

  it('窗口内 settlement reject 返回 failed，而不是伪装成 joined', async () => {
    const failure = new Error('WORLD_SIM_PERSIST_FAILED: 联合保存失败');
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 1_000 }),
      orchestrator: createPort({
        getPhase: () => 'checking',
        getSettlementPromise: () => Promise.reject(failure),
      }),
    });

    await expect(runtime.awaitBeforePlotStart()).resolves.toEqual({
      kind: 'failed', settlementFailure: { error: failure },
    });
  });

  it('真实 orchestrator 的 committing 保存失败会传到 join gate', async () => {
    let leaseSnapshot = lease(11);
    const failure = new Error('WORLD_SIM_PERSIST_FAILED: host save rejected');
    const { WorldSimulationOrchestrator_ACU } = await import('../../../src/service/simulation/simulation-orchestrator');
    const orchestrator = new WorldSimulationOrchestrator_ACU({
      readLeaseSnapshot: () => leaseSnapshot,
      createRunId: () => 'runtime-combination',
    });
    const runner = async () => ({
      sourceAnchorMessageIndex: 11,
      state: {
        anchorMessageIndex: 11,
        storyClock: { anchorText: '第11日', elapsedSinceLastRun: '一日', precision: 'approximate' as const, evidenceIndexes: [11], updatedIndex: 11 },
        entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 },
      },
      sourceTransactions: [],
    });
    const completion = orchestrator.trigger(11, runner, async input => {
      input.lease.beginCommit();
      throw failure;
    });
    void completion.catch(() => undefined);
    await flush();
    leaseSnapshot = lease(12);
    orchestrator.trigger(12, runner, async () => { throw new Error('existing settler must be retained'); });
    await flush();

    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 1_000 }),
      readLeaseSnapshot: () => leaseSnapshot,
      orchestrator,
    });
    await expect(runtime.awaitBeforePlotStart()).resolves.toEqual({
      kind: 'failed', settlementFailure: { error: failure },
    });
  });

  it('等待期间飞行离场后，绝不 await 残留结算：有界 join 不得退化成无界阻塞', async () => {
    // 等待期间 swipe/删楼整体丢弃了飞行：settlement 引用已在等待前取得，但 settler 仍在跑，
    // 该 promise 可能很久都不 settle。此时若 await 它，剧情推进会被无界阻塞。
    let phase: 'checking' | 'idle' = 'checking';
    const abandon = vi.fn(() => false);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 1_000 }),
      waitForSettlement: vi.fn(async () => { phase = 'idle'; return { kind: 'timeout' as const }; }),
      orchestrator: createPort({
        getPhase: () => phase,
        getSettlementPromise: () => pendingSettlement(),
        abandonSettlement: abandon,
      }),
    });

    // 永不 settle 的 settlement 仍必须让本函数返回：测试能跑完本身即是有界性证据。
    expect(await runtime.awaitBeforePlotStart()).toEqual({
      kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: false,
    });
    // 离场后已无租约可撤销，abandon 如实返回 false，不得谎报成零提交。
    expect(abandon).toHaveBeenCalledWith('chat-a');
  });

  it('仍可撤销的阶段窗口耗尽后作废旧目标，零提交并留给下一楼层重试', async () => {
    const abandon = vi.fn(() => true);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 500 }),
      waitForSettlement: vi.fn(async () => ({ kind: 'timeout' as const })),
      orchestrator: createPort({
        getPhase: () => 'checking',
        getSettlementPromise: () => pendingSettlement(),
        abandonSettlement: abandon,
      }),
    });

    expect(await runtime.awaitBeforePlotStart()).toEqual({
      kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: true,
    });
    expect(abandon).toHaveBeenCalledWith('chat-a');
  });

  it('等待期间从 checking 推进到 committing 时，按放行瞬间的真实阶段处理', async () => {
    let phase: 'checking' | 'committing' = 'checking';
    const abandon = vi.fn(() => false);
    const { runtime } = createRuntime({
      readSettings: () => enabledSettings({ joinWaitMs: 500 }),
      waitForSettlement: vi.fn(async () => { phase = 'committing'; return { kind: 'timeout' as const }; }),
      orchestrator: createPort({
        getPhase: () => phase,
        getSettlementPromise: () => Promise.resolve(),
        abandonSettlement: abandon,
      }),
    });

    expect(await runtime.awaitBeforePlotStart()).toEqual({
      kind: 'timeout', code: 'WORLD_SIM_JOIN_TIMEOUT', windowElapsed: true, revoked: false,
    });
    expect(abandon).not.toHaveBeenCalled();
  });

  it('丢弃当前聊天在飞候选，供分支改写入口调用', () => {
    const discardFlight = vi.fn(() => true);
    const { runtime } = createRuntime({ orchestrator: createPort({ discardFlight }) });
    expect(runtime.discardInFlightSettlementForCurrentChat()).toBe(true);
    expect(discardFlight).toHaveBeenCalledWith('chat-a');

    const noIdentity = createRuntime({ getChatIdentity: () => '', orchestrator: createPort({ discardFlight }) });
    expect(noIdentity.runtime.discardInFlightSettlementForCurrentChat()).toBe(false);
  });
});

describe('WorldSimulationRuntime_ACU 有界物化等待', () => {
  it('早到的 GENERATION_ENDED 在楼层物化后恰好触发一次 gate', async () => {
    let chat: any[] = [{ is_user: true, mes: 'u' }];
    const owned = vi.fn(async () => gateReply(1));
    const trigger = vi.fn(async () => ({}));
    const wait = vi.fn(async () => { chat = aiChat(); });
    const { runtime } = createRuntime({ getChat: () => chat, runOwnedAi: owned, wait, orchestrator: createPort({ trigger }) });

    await runtime.onAiFloorCompleted(intent(1, 1, 0));
    await flush();

    expect(wait).toHaveBeenCalledTimes(1);
    expect(owned).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('始终未物化时有界放弃：零 AI 调用、零触发', async () => {
    const owned = vi.fn(async () => gateReply(1));
    const trigger = vi.fn(async () => ({}));
    const wait = vi.fn(async () => undefined);
    const { runtime } = createRuntime({
      getChat: () => [{ is_user: true, mes: 'u' }],
      runOwnedAi: owned,
      wait,
      orchestrator: createPort({ trigger }),
    });

    await runtime.onAiFloorCompleted(intent(1, 1, 0));
    await flush();

    expect(wait).toHaveBeenCalledTimes(3);
    expect(owned).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('等待期间切换到其他聊天则放弃触发，绝不在别的分支上推演', async () => {
    let identity = 'chat-a';
    const owned = vi.fn(async () => gateReply(1));
    const wait = vi.fn(async () => { identity = 'chat-b'; });
    const { runtime } = createRuntime({
      getChat: () => [{ is_user: true, mes: 'u' }],
      getChatIdentity: () => identity,
      runOwnedAi: owned,
      wait,
    });

    await runtime.onAiFloorCompleted(intent(1, 1, 0));
    await flush();

    expect(owned).not.toHaveBeenCalled();
  });
});
