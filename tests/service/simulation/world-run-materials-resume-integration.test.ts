import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorldRoundPayload_ACU } from '../../helpers/world-round-payload';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { prepareWorldRoundRun_ACU } from '../../../src/service/simulation/agent/world-round-prepare';
import { commitWorldSimulationRound_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { WorldSimulationOrchestrator_ACU, resetWorldSimulationOrchestratorStateForTests_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import { FirstFloorWorldSimulationStore_ACU, assertWorldSimulationAnchorCurrent_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { buildWorldRunMaterials_ACU, sameWorldRunMaterials_ACU } from '../../../src/service/simulation/world-run-materials';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import type { WorldSimulationAgentName_ACU } from '../../../src/service/simulation/agent/agent-catalog';
import type { WorldSimulationRunIdentity_ACU } from '../../../src/service/simulation/model';
import type { AgentWorldbookSnapshot_ACU } from '../../../src/service/continuation/agent/agent-worldbook-read';
import type { WorldSimulationUserRequirementsSnapshot_ACU } from '../../../src/service/simulation/agent/agent-model';

function actor(id: string) {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: ['待命'], constraints: [],
    informationSources: [], knownFacts: [], visibility: 'hidden' as const, currentAction: null,
    shortTermAction: null, longTermAction: null, simulationStatus: 'active' as const,
    loreRefs: [], experiences: [], revision: 1 };
}

function payload(messages: readonly { content: string }[]): Record<string, unknown> {
  return readWorldRoundPayload_ACU(messages);
}

function responseForStage(data: Record<string, unknown>): string {
  if (data.stage === 'world-narrative-review-v1') {
    return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
  }
  if (data.stage === 'clock-candidate') {
    return JSON.stringify({ candidateClock: { day: 2, slot: '夜', storyTime: '第二日夜', precision: 'exact', evidenceRefs: [] } });
  }
  if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [] });
  if (data.stage === 'recall-selection') {
    const actorIds = (data.directory as { actorIds: string[] }).actorIds;
    return JSON.stringify({
      selections: actorIds.map(actorId => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '无额外资料', priority: 5, scope: 'actor' })),
      worldSelection: { worldEventIds: [], factIds: [], reason: '无额外资料', priority: 5, scope: 'world' },
    });
  }
  if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [], factWrites: [] });
  const actorId = (data.actorIds as string[])[0];
  return JSON.stringify({
    actorWrites: [{ value: { ...actor(actorId), goals: ['巡查钟楼'], revision: 2 }, expectedRevision: 1 }],
    actorCompletions: [{ actorId, completion: 'changed', expectedRevision: 1 }],
    factWrites: [{ value: { id: `fact-${actorId}`, summary: `${actorId} 已开始巡查钟楼`, temporalKind: 'occurrence',
      happenedAt: { day: 2, slot: '夜' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [actorId], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }, expectedRevision: 0 }],
    historyMilestoneWrites: [],
  });
}

function snapshot(content = '钟楼地窖藏着未熄的蓝火。'): AgentWorldbookSnapshot_ACU {
  return { available: true, entries: [{
    bookName: '钟楼秘闻', uid: 'blue-fire', title: '蓝火', keys: ['钟楼', '蓝火'], constant: false,
    content, tokens: 12,
  }] };
}

function requirements(lines = ['不要提前揭示蓝火的来源']): WorldSimulationUserRequirementsSnapshot_ACU {
  return { schemaVersion: 1, requirements: lines, updatedAt: 17 };
}

function fixture() {
  let chatIdentity = 'world-materials-resume-host';
  const chat: any[] = [{}, {
    message_id: 71, is_user: false, mes: '钟楼下的风停了一瞬。', message: '钟楼下的风停了一瞬。', swipe_id: 0,
    swipes: ['钟楼下的风停了一瞬。'],
  }];
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(chat); });
  _set_SillyTavern_API_ACU({ chat, chatId: chatIdentity, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'world-materials-resume.png', name: '资料恢复测试角色' }], getCurrentChatId: () => chatIdentity, saveChat } as any);
  const fetchChat = vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] }));
  vi.stubGlobal('fetch', fetchChat);

  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = 'layered';
  envelope.ledger.actors = [actor('actor-1')];
  chat[0]._qrf_world_simulation = envelope;
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  let currentSnapshot = snapshot();
  let currentRequirements = requirements();
  let id = 0;
  let holdClock = true;
  let hasEnteredClock = false;
  let releaseClock: (() => void) | undefined;
  const clockEntered = new Promise<void>(resolve => { releaseClock = resolve; });
  const invoke = vi.fn(async (_role: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[]) => {
    const data = payload(messages);
    if (data.stage === 'clock-candidate' && holdClock) {
      hasEnteredClock = true;
      await clockEntered;
    }
    return responseForStage(data);
  });
  const appendUserMessage = vi.fn(async () => undefined);
  const prepare = vi.fn(async (input: { identity: WorldSimulationRunIdentity_ACU; anchor: typeof anchor; instruction: string; envelope: NonNullable<ReturnType<FirstFloorWorldSimulationStore_ACU['read']>>; signal: AbortSignal }) => {
    const store = new FirstFloorWorldSimulationStore_ACU();
    const materials = buildWorldRunMaterials_ACU({
      instruction: input.envelope.task!.originInstruction,
      userRequirements: currentRequirements,
      worldbookSnapshot: currentSnapshot,
      workflowMode: input.identity.workflowMode,
      deliveryTarget: input.identity.deliveryTarget,
      worldRoundPrompts: input.envelope.settings.worldRoundPrompts,
    });
    if (!input.envelope.task!.runMaterials) {
      await store.updateAtomically(current => ({ ...current!, task: { ...current!.task!, runMaterials: materials, updatedAt: ++id }, updatedAt: id }), {
        chatIdentity: input.identity.chatIdentity, taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision,
      });
    }
    return prepareWorldRoundRun_ACU({
      identity: input.identity, envelope: store.read()!, anchor: input.anchor, anchorBody: chat[1].mes,
      instruction: store.read()!.task!.originInstruction, userRequirements: currentRequirements, worldbookSnapshot: currentSnapshot,
      runMaterials: store.read()!.task!.runMaterials, signal: input.signal, invoke, readCurrent: () => store.read(),
      assertAnchorCurrent: () => { assertWorldSimulationAnchorCurrent_ACU(input.anchor, chat); }, hasLegacyWrites: false, now: 1,
    });
  });
  const checkResumeMaterials = vi.fn(async (identity: WorldSimulationRunIdentity_ACU, _anchor: typeof anchor, current: NonNullable<ReturnType<FirstFloorWorldSimulationStore_ACU['read']>>) => {
    const frozen = current.task?.runMaterials;
    if (!frozen) throw new Error('WORLD_RUN_MATERIALS_MISSING');
    const actual = buildWorldRunMaterials_ACU({ instruction: current.task!.originInstruction, userRequirements: currentRequirements, worldbookSnapshot: currentSnapshot,
      workflowMode: identity.workflowMode, deliveryTarget: identity.deliveryTarget, worldRoundPrompts: current.settings.worldRoundPrompts });
    if (!sameWorldRunMaterials_ACU(frozen, actual)) throw new Error(`WORLD_RUN_MATERIALS_CHANGED:${identity.runId}`);
  });
  const commitRound = vi.fn(async (input: any) => commitWorldSimulationRound_ACU({ ...input,
    commitCandidate: { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId,
      stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision,
      summary: input.summary, acceptedCandidates: [], evidenceRefs: [] },
  }));

  const createOrchestrator = () => new WorldSimulationOrchestrator_ACU({
    store: new FirstFloorWorldSimulationStore_ACU(), now: () => ++id, allocateId: kind => `${kind}-${++id}`,
    workflowProtocol: 'world-round-v1', prepare, checkResumeMaterials,
    assertAnchorCurrent: current => { assertWorldSimulationAnchorCurrent_ACU(current, chat); },
    appendUserMessage, commitRound, commitProjection: vi.fn(),
  });
  let orchestrator = createOrchestrator();
  const start = () => orchestrator.start({ triggerKind: 'assistant_completed', anchor, instruction: '推进钟楼外的世界' });
  const pause = async () => {
    const running = start();
    await vi.waitFor(() => expect(hasEnteredClock).toBe(true));
    expect(orchestrator.cancel(anchor.chatIdentity)).toBe(true);
    holdClock = false;
    releaseClock?.();
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(new FirstFloorWorldSimulationStore_ACU().read()!.task).toMatchObject({ status: 'paused' });
  };
  return {
    chat, anchor, invoke, saveChat, fetchChat, prepare, checkResumeMaterials, appendUserMessage, commitRound,
    store: () => new FirstFloorWorldSimulationStore_ACU(), remote: () => structuredClone(remote), pause,
    reload: () => { orchestrator = createOrchestrator(); },
    resume: (instruction?: string) => orchestrator.resume({ anchor, ...(instruction === undefined ? {} : { instruction }) }),
    setSnapshot: (value: AgentWorldbookSnapshot_ACU) => { currentSnapshot = value; },
    setRequirements: (value: WorldSimulationUserRequirementsSnapshot_ACU) => { currentRequirements = value; },
    setChatIdentity: (value: string) => { chatIdentity = value; },
  };
}

function expectPausedUntouched(f: ReturnType<typeof fixture>, before: unknown) {
  expect(f.store().read()).toEqual(before);
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.appendUserMessage).not.toHaveBeenCalled();
  expect(f.commitRound).not.toHaveBeenCalled();
  expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
}

describe('world-round 宿主资料冻结恢复整合', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorldSimulationOrchestratorStateForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetWorldSimulationOrchestratorStateForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('首次暂停持久化资料与有效提示词哈希；重建普通宿主后以“继续”同 runId 和冻结 mode 完成 ledger-only', async () => {
    const f = fixture();
    await f.pause();
    const paused = f.store().read()!;
    const frozenRun = paused.task!.activeRun!;
    expect(Object.keys(paused.task!.runMaterials!).sort()).toEqual(['instructionHash', 'promptsHash', 'requirementsHash', 'schemaVersion', 'worldbookHash']);
    expect(JSON.stringify(paused.task!.runMaterials)).not.toContain('蓝火');
    expect(JSON.stringify(paused.task!.runMaterials)).not.toContain('不要提前揭示');
    expect(f.saveChat).toHaveBeenCalled();

    f.reload();
    const resumed = await f.resume('继续');
    expect(resumed).toMatchObject({ status: 'completed', identity: { runId: frozenRun.runId, workflowMode: 'layered', workflowProtocol: 'world-round-v1' }, result: { outcome: 'world_round', finalProjection: { content: null, deliverable: false } } });

    const completed = f.store().read()!;
    expect(completed.ledger).toMatchObject({ revision: 1, clock: { day: 2, slot: '夜' }, actors: [{ id: 'actor-1', goals: ['巡查钟楼'] }] });
    expect(completed.task).toMatchObject({ status: 'completed', activeRun: null, completedRun: {
      runId: frozenRun.runId, workflowMode: 'layered', workflowProtocol: 'world-round-v1', deliveryTarget: 'body',
    }, runMaterials: paused.task!.runMaterials });
    expect(f.store().read()).toEqual(f.chat[0]._qrf_world_simulation);
    expect(f.remote()[0]._qrf_world_simulation).toEqual(f.chat[0]._qrf_world_simulation);
    expect(f.fetchChat).not.toHaveBeenCalled();
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
  });

  it.each([
    ['等长正文改写', (f: ReturnType<typeof fixture>) => f.setSnapshot(snapshot('钟楼地窖藏着已经熄灭的红火。'))],
    ['已启用世界书条目增删', (f: ReturnType<typeof fixture>) => f.setSnapshot({ ...snapshot(), entries: [...snapshot().entries, { ...snapshot().entries[0], uid: 'new-entry', title: '新条目' }] })],
    ['用户要求变化', (f: ReturnType<typeof fixture>) => f.setRequirements(requirements(['禁止描写任何火焰']))],
    ['世界书读取不可用', (f: ReturnType<typeof fixture>) => f.setSnapshot({ available: false, entries: [] })],
  ])('%s 时在 prepare、模型与会话追加前拒绝恢复', async (_name, mutate) => {
    const f = fixture();
    await f.pause();
    const before = structuredClone(f.store().read());
    const callsBeforeResume = f.invoke.mock.calls.length;
    f.reload();
    mutate(f);

    await expect(f.resume('继续')).rejects.toThrow();
    expectPausedUntouched(f, before);
    expect(f.checkResumeMaterials).toHaveBeenCalledOnce();
    expect(f.invoke).toHaveBeenCalledTimes(callsBeforeResume);
  });

  it('缺少旧进度资料时以新运行重新推演，已保存人物和设置不丢失', async () => {
    const f = fixture();
    await f.pause();
    await f.store().updateAtomically(current => ({ ...current!, task: { ...current!.task!, runMaterials: undefined } }));
    const before = structuredClone(f.store().read()!);
    f.reload();

    const result = await f.resume('继续');
    expect(result).toMatchObject({ status: 'completed' });
    if (result.status !== 'completed') throw new Error('应重新开始并完成推演');
    expect(result.identity.runId).not.toBe(before.task!.activeRun!.runId);
    expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.checkResumeMaterials).not.toHaveBeenCalled();
    const saved = f.store().read()!;
    expect(saved.settings).toEqual(before.settings);
    expect(saved.ledger.actors.map(item => item.id)).toEqual(before.ledger.actors.map(item => item.id));
    expect(saved.ledger.revision).toBe(before.ledger.revision + 1);
    expect(saved.task?.runMaterials).toBeDefined();
    expect(f.remote()[0]._qrf_world_simulation).toEqual(f.chat[0]._qrf_world_simulation);
    expect(f.chat[1].mes).toBe('钟楼下的风停了一瞬。');
  });

  it('非机械新指令在资料读取、appendUserMessage 和 prepare 前拒绝', async () => {
    const f = fixture();
    await f.pause();
    const before = structuredClone(f.store().read());
    f.reload();

    await expect(f.resume('改成让蓝火吞没钟楼')).rejects.toThrow('仅接受继续指令');
    expectPausedUntouched(f, before);
    expect(f.checkResumeMaterials).not.toHaveBeenCalled();
  });

  it.each(['普通 chat 切换', 'scoped 锚点重生成'] as const)('%s时不接受旧暂停运行恢复', async kind => {
    const f = fixture();
    await f.pause();
    const before = structuredClone(f.store().read());
    f.reload();
    const badAnchor = kind === '普通 chat 切换'
      ? { ...f.anchor, chatIdentity: 'another-chat' }
      : { ...f.anchor, messageKey: 'number:regenerated-scope' };

    await expect((new WorldSimulationOrchestrator_ACU({
      store: f.store(), now: () => 1, allocateId: () => 'unused', workflowProtocol: 'world-round-v1',
      prepare: f.prepare, checkResumeMaterials: f.checkResumeMaterials, appendUserMessage: f.appendUserMessage,
      assertAnchorCurrent: () => undefined, commitRound: f.commitRound, commitProjection: vi.fn(),
    })).resume({ anchor: badAnchor as typeof f.anchor, instruction: '继续' })).resolves.toEqual({ status: 'skipped', reason: 'duplicate' });
    expectPausedUntouched(f, before);
  });
});
