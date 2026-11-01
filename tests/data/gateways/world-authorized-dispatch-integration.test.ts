import { afterEach, describe, expect, it, vi } from 'vitest';
import { installHostGenerationInterceptor_ACU, HostGenerationInterceptedError_ACU } from '../../../src/data/gateways/host-generation-interceptor';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import { appendWorldSimulationCommitChain_ACU, foldWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { buildDefaultWorldSimulationEnvelope_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { runWorldProjectionStage_ACU } from '../../../src/service/simulation/agent/world-projection-stage';
import { prepareWorldDispatchAuthorization_ACU } from '../../../src/service/simulation/world-dispatch-authorization';
import { createWorldDispatchHostObserver_ACU } from '../../../src/service/simulation/world-dispatch-host-authorization';
import { WorldDispatchHostStore_ACU } from '../../../src/service/simulation/world-dispatch-host-store';

const endpoint = '/api/backends/chat-completions/generate';
const sourceBody = '钟楼下的风停了一瞬。';
const place = { region: '上海', place: '钟楼' } as const;
let fixtureSequence = 0;

type Fixture = ReturnType<typeof createFixture>;

function sceneFact(id = 'scene-fact') {
  return {
    id, summary: '钟楼下的风停了一瞬。', temporalKind: 'occurrence' as const,
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: { ...place },
    actorIds: [], worldEventIds: [], projectionPolicy: 'scene' as const, revealState: 'unlocked' as const,
    revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

function createFixture(options: { contributed?: boolean; fact?: ReturnType<typeof sceneFact>; active?: boolean } = {}) {
  const chatId = `authorized-dispatch-chat-${++fixtureSequence}`;
  const chat: any[] = [
    {},
    { is_user: true, mes: '继续钟楼附近的故事。', message_id: 70 },
    { is_user: false, mes: sourceBody, message: sourceBody, swipe_id: 0, message_id: 71 },
  ];
  _set_SillyTavern_API_ACU({ chat, chatId, getCurrentChatId: () => chatId } as any);
  const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
  const before = buildEmptyWorldSimulationLedger_ACU();
  before.player.location = { ...place };
  const next = structuredClone(before);
  next.revision = 1;
  next.facts = [options.fact ?? sceneFact()];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger = structuredClone(next);
  envelope.task = {
    taskId: 'task-1', originInstruction: '推进钟楼外的世界', status: 'completed', createdAt: 1, updatedAt: 2,
    activeRun: null, stopReason: null,
    completedAutoAnchor: {
      chatIdentity: chatId, messageKey: anchor.messageKey, swipeId: anchor.swipeId, contentDigest: anchor.contentDigest,
    },
  };
  envelope.timeline = [{
    id: 'timeline-1', at: 2, kind: 'committed', taskId: 'task-1', stageId: 'stage-1', revision: 1,
    runId: 'run-1', message: '钟楼投影完成',
  }];
  envelope.activeStageId = 'stage-1';
  envelope.stages = [{
    stageId: 'stage-1', stageNumber: 1, status: 'completed', activeRevision: 1,
    revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
      plan: { schemaVersion: 1, title: '钟楼投影', objective: '推进钟楼外的世界', impactScope: [], factsToVerify: [],
        plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [],
        completedSteps: [], nextStep: '' } }],
  }];
  chat[0]._qrf_world_simulation = envelope;
  if (options.contributed !== false) {
    appendWorldSimulationCommitChain_ACU({
      chat, messageIndex: anchor.messageIndex, anchor, beforeLedger: before, nextLedger: next,
      evidenceRefs: [], updatedAt: 2, checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} },
    });
  }
  const api: any = {
    chat, chatId, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => chatId,
  };
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(api.chat); });
  api.saveChat = saveChat;
  _set_SillyTavern_API_ACU(api);
  const remoteFetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/chats/get');
    expect(init?.method).toBe('POST');
    return { ok: true, status: 200, json: async () => [{}, ...structuredClone(remote)] } as Response;
  });
  vi.stubGlobal('fetch', remoteFetch);
  const network = vi.fn(async () => new Response('original response', { status: 200 }));
  const host: any = { location: { href: 'https://tavern.test/', origin: 'https://tavern.test' }, fetch: network };
  let active = options.active ?? true;
  return {
    chat, api, anchor, next, host, network, saveChat, remoteFetch,
    store: new WorldDispatchHostStore_ACU(anchor),
    setRemote: (value: any[]) => { remote = structuredClone(value); },
    setActive: (value: boolean) => { active = value; }, isActive: () => active,
  };
}

function projectionInput(f: Fixture, receipt: object) {
  return {
    receipt, ledger: f.next, identity: {
      kind: 'host' as const, runId: 'run-1', chatIdentity: f.anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorContentDigest: f.anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, deliveryTarget: 'body' as const,
      workflowMode: 'single' as const, workflowProtocol: 'world-round-v1' as const,
      anchorMessageId: f.anchor.messageId, anchorMessageKey: f.anchor.messageKey, anchorSwipeId: f.anchor.swipeId,
    },
    targetAnchor: f.anchor, anchorText: sourceBody, clock: f.next.clock, sceneLocation: { ...place },
    settings: chatSettings(), signal: new AbortController().signal, isCurrent: () => true, countTokens: async () => 1,
  };
}

function chatSettings() {
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const settings = envelope.settings;
  settings.workflowMode = 'single';
  settings.agentHistoryTokenBudget = 1000;
  settings.agentReadTokenBudget = 1000;
  settings.agentReadFallbackTokens = 1000;
  return settings;
}

async function authorize(f: Fixture) {
  const stageInput = { ...projectionInput(f, {}), ledger: f.next, invoke: async () => { throw new Error('scene-only 不应调用语义审查'); } };
  const stage = await runWorldProjectionStage_ACU(stageInput);
  return prepareWorldDispatchAuthorization_ACU(projectionInput(f, stage.receipt));
}

type PreparedAuthorization = Awaited<ReturnType<typeof authorize>>;

function normalHostMessages(prepared: PreparedAuthorization): unknown[] {
  return [{ role: 'system', content: '宿主原有系统提示。' }, prepared.message];
}

function requestBody(prepared: PreparedAuthorization, messages: unknown[] = normalHostMessages(prepared)) {
  return JSON.stringify({ messages });
}

function install(f: Fixture, prepared: PreparedAuthorization, deliveryId = 'delivery-1') {
  const observer = createWorldDispatchHostObserver_ACU({
    authorization: prepared.authorization, sourceAnchor: f.anchor, deliveryId, createdAt: 100,
  });
  return installHostGenerationInterceptor_ACU({
    isActive: f.isActive,
    claim: () => null,
    beforeDispatchObserver: observer,
  }, f.host);
}

async function expectBlocked(request: Promise<Response>) {
  await expect(request).rejects.toBeInstanceOf(HostGenerationInterceptedError_ACU);
}

function dispatch(f: Fixture, prepared: PreparedAuthorization, body = requestBody(prepared), init: RequestInit = {}) {
  return f.host.fetch(endpoint, { method: 'POST', body, ...init });
}

function journal(f: Fixture) {
  return f.store.read();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('world authorized dispatch integration', () => {
  it('真实 scene-only receipt 授权后，宿主保存完成前不发送，随后原网络只发送一次 intent 且不回读聊天', async () => {
    const f = createFixture();
    expect(foldWorldSimulationLedger_ACU(f.chat)?.lastContributedIndex).toBe(f.anchor.messageIndex);
    const prepared = await authorize(f);
    let releaseSave!: () => void;
    f.api.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseSave = resolve; });
      f.setRemote(structuredClone(f.chat));
    });
    const dispose = install(f, prepared);
    try {
      const pending = dispatch(f, prepared);
      await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledOnce());
      expect(f.network).not.toHaveBeenCalled();
      expect(f.remoteFetch).not.toHaveBeenCalled();
      releaseSave();
      expect(await (await pending).text()).toBe('original response');
    } finally { dispose(); }
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.remoteFetch).not.toHaveBeenCalled();
    const saved = journal(f);
    expect(saved.records).toEqual([expect.objectContaining({ deliveryId: 'delivery-1', source: {
      chatIdentity: f.anchor.chatIdentity, messageKey: f.anchor.messageKey,
      swipeId: f.anchor.swipeId, contentDigest: f.anchor.contentDigest,
    }, factIds: ['scene-fact'], requestFingerprint: sha256HexSync_ACU(JSON.stringify([
      { content: '宿主原有系统提示。', role: 'system' },
      { content: prepared.message.content, role: prepared.message.role },
    ])), successor: null })]);
    expect(JSON.stringify(saved)).not.toContain(prepared.message.content);
    expect(JSON.stringify(saved)).not.toContain('钟楼下的风停了一瞬。');
    expect(f.chat[2].mes).toBe(sourceBody);
  });

  it.each(['篡改最终消息', '重复授权标记', '删除授权块', '错误 role'] as const)('%s 时拒绝且零保存零发送', async label => {
    const f = createFixture();
    const prepared = await authorize(f);
    const messages = label === '篡改最终消息'
      ? [{ ...prepared.message, content: `${prepared.message.content} 篡改` }]
      : label === '重复授权标记'
        ? [prepared.message, prepared.message]
        : label === '删除授权块'
          ? [{ role: 'user', content: '继续故事' }]
          : [{ ...prepared.message, role: 'user' }];
    const dispose = install(f, prepared);
    try { await expectBlocked(dispatch(f, prepared, requestBody(prepared, messages))); } finally { dispose(); }
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it('无真实 contributed frame 或只在首楼缓存账本时拒绝，不保存也不发送', async () => {
    const f = createFixture({ contributed: false });
    expect(foldWorldSimulationLedger_ACU(f.chat)).toBeNull();
    const prepared = await authorize(f);
    const dispose = install(f, prepared);
    try { await expectBlocked(dispatch(f, prepared)); } finally { dispose(); }
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it('已完成 provenance 缺失或与当前 assistant source 不一致时拒绝且零保存零发送', async () => {
    const missingCommitted = createFixture();
    missingCommitted.chat[0]._qrf_world_simulation.timeline = [];
    const missingCommittedPrepared = await authorize(missingCommitted);
    const missingCommittedDispose = install(missingCommitted, missingCommittedPrepared);
    try { await expectBlocked(dispatch(missingCommitted, missingCommittedPrepared)); } finally { missingCommittedDispose(); }
    expect(missingCommitted.saveChat).not.toHaveBeenCalled();
    expect(missingCommitted.network).not.toHaveBeenCalled();

    const missingCommittedRun = createFixture();
    delete missingCommittedRun.chat[0]._qrf_world_simulation.timeline[0].runId;
    const missingCommittedRunPrepared = await authorize(missingCommittedRun);
    const missingCommittedRunDispose = install(missingCommittedRun, missingCommittedRunPrepared);
    try { await expectBlocked(dispatch(missingCommittedRun, missingCommittedRunPrepared)); } finally { missingCommittedRunDispose(); }
    expect(missingCommittedRun.saveChat).not.toHaveBeenCalled();
    expect(missingCommittedRun.network).not.toHaveBeenCalled();

    const differentRunSameTaskStage = createFixture();
    differentRunSameTaskStage.chat[0]._qrf_world_simulation.timeline[0].runId = 'other-run';
    const differentRunSameTaskStagePrepared = await authorize(differentRunSameTaskStage);
    const differentRunSameTaskStageDispose = install(differentRunSameTaskStage, differentRunSameTaskStagePrepared);
    try { await expectBlocked(dispatch(differentRunSameTaskStage, differentRunSameTaskStagePrepared)); } finally { differentRunSameTaskStageDispose(); }
    expect(differentRunSameTaskStage.saveChat).not.toHaveBeenCalled();
    expect(differentRunSameTaskStage.network).not.toHaveBeenCalled();

    const missingAutoAnchor = createFixture();
    delete missingAutoAnchor.chat[0]._qrf_world_simulation.task.completedAutoAnchor;
    const missingAutoAnchorPrepared = await authorize(missingAutoAnchor);
    const missingAutoAnchorDispose = install(missingAutoAnchor, missingAutoAnchorPrepared);
    try { await expectBlocked(dispatch(missingAutoAnchor, missingAutoAnchorPrepared)); } finally { missingAutoAnchorDispose(); }
    expect(missingAutoAnchor.saveChat).not.toHaveBeenCalled();
    expect(missingAutoAnchor.network).not.toHaveBeenCalled();

    const wrongAutoAnchor = createFixture();
    wrongAutoAnchor.chat[0]._qrf_world_simulation.task.completedAutoAnchor.contentDigest = 'other-assistant-digest';
    const wrongAutoAnchorPrepared = await authorize(wrongAutoAnchor);
    const wrongAutoAnchorDispose = install(wrongAutoAnchor, wrongAutoAnchorPrepared);
    try { await expectBlocked(dispatch(wrongAutoAnchor, wrongAutoAnchorPrepared)); } finally { wrongAutoAnchorDispose(); }
    expect(wrongAutoAnchor.saveChat).not.toHaveBeenCalled();
    expect(wrongAutoAnchor.network).not.toHaveBeenCalled();
  });

  it('伪造 authorization 对象不能进入保存或网络', async () => {
    const f = createFixture();
    const valid = await authorize(f);
    const fake = { ...valid, authorization: {} };
    const dispose = install(f, fake as typeof valid);
    try { await expectBlocked(dispatch(f, fake)); } finally { dispose(); }
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it('授权后的 ledger fingerprint 漂移会在保存前阻断', async () => {
    const f = createFixture();
    const prepared = await authorize(f);
    f.next.facts[0].summary = '授权后篡改的摘要';
    const dispose = install(f, prepared);
    try { await expectBlocked(dispatch(f, prepared)); } finally { dispose(); }
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it('gated/locked 即使语义审查 true 也不会获得可发送授权', async () => {
    const f = createFixture({ fact: { ...sceneFact('locked-fact'), projectionPolicy: 'gated', revealState: 'locked',
      revealGate: { semanticCondition: '钟楼下的风停了一瞬', locationRef: { ...place } } } as any });
    const reviewed = await runWorldProjectionStage_ACU({
      ...projectionInput(f, {}), ledger: f.next, contactedActorIds: [],
      invoke: async () => JSON.stringify({ reviews: [{ factId: 'locked-fact', triggered: true, evidence: [{ quote: sourceBody }] }] }),
    });
    await expect(prepareWorldDispatchAuthorization_ACU(projectionInput(f, reviewed.receipt))).rejects.toThrow(/locked|gated|scene/);
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'source-digest'] as const)('严格保存等待期间发生 %s 时阻断网络', async change => {
    const f = createFixture();
    const prepared = await authorize(f);
    let release!: () => void;
    f.api.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      f.setRemote(structuredClone(f.chat));
    });
    const dispose = install(f, prepared);
    try {
      const controller = new AbortController();
      const pending = dispatch(f, prepared, requestBody(prepared), { signal: controller.signal });
      await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledOnce());
      if (change === 'cancel') controller.abort();
      if (change === 'source-digest') f.chat[2].mes = '被改写的 source';
      release();
      await expectBlocked(pending);
    } finally { dispose(); }
    expect(f.network).not.toHaveBeenCalled();
  });

  it('保存前同 revision ledger 漂移会阻断网络', async () => {
    const f = createFixture();
    const prepared = await authorize(f);
    const dispose = install(f, prepared);
    const entry = f.chat[2]._qrf_world_simulation_state.entries[Object.keys(f.chat[2]._qrf_world_simulation_state.entries)[0]];
    entry.value.deltas[0].upserts.facts[0].summary = '同 revision 外部账本漂移';
    try { await expectBlocked(dispatch(f, prepared)); } finally { dispose(); }
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it('严格保存后同 revision ledger 漂移会在 bridge 后置校验阻断网络', async () => {
    const f = createFixture();
    const prepared = await authorize(f);
    let release!: () => void;
    f.api.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      f.setRemote(structuredClone(f.chat));
    });
    const dispose = install(f, prepared);
    try {
      const pending = dispatch(f, prepared);
      await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledOnce());
      const entry = f.chat[2]._qrf_world_simulation_state.entries[Object.keys(f.chat[2]._qrf_world_simulation_state.entries)[0]];
      entry.value.deltas[0].upserts.facts[0].summary = '保存后同 revision 外部账本漂移';
      f.chat[0]._qrf_world_simulation.ledger.facts[0].summary = '保存后同 revision 外部账本漂移';
      f.setRemote(structuredClone(f.chat));
      release();
      await expectBlocked(pending);
    } finally { dispose(); }
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.network).not.toHaveBeenCalled();
    expect(journal(f).records).toHaveLength(1);
  });
  it('新聊天切换会在请求前阻断且不写入新聊天', async () => {
    const f = createFixture();
    const prepared = await authorize(f);
    const dispose = install(f, prepared);
    f.api.chat = [{ is_user: false, mes: '新聊天不得写入', message_id: 91, swipe_id: 0 }];
    f.api.chatId = 'new-chat';
    f.api.getCurrentChatId = () => 'new-chat';
    try { await expectBlocked(dispatch(f, prepared)); } finally { dispose(); }
    expect(f.api.chat[0]).not.toHaveProperty('_qrf_world_projection_dispatch');
    expect(f.network).not.toHaveBeenCalled();
  });
  it('同一 authorization 只可 claim 一次；领域幂等不替代一次性授权', async () => {
    const f = createFixture();
    const prepared = await authorize(f);
    const dispose = install(f, prepared);
    try {
      await dispatch(f, prepared);
      await expectBlocked(dispatch(f, prepared));
    } finally { dispose(); }
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(journal(f).records).toHaveLength(1);
  });

  it('跨聊天 source 不能复用 authorization', async () => {
    const first = createFixture();
    const prepared = await authorize(first);
    const second = createFixture();
    const dispose = install(second, prepared);
    try { await expectBlocked(dispatch(second, prepared)); } finally { dispose(); }
    expect(second.saveChat).not.toHaveBeenCalled();
    expect(second.network).not.toHaveBeenCalled();
  });

  it('保存结果未知时拒绝，显式 recover 只恢复状态而不会自动转发', async () => {
    const f = createFixture();
    f.api.saveChat.mockImplementationOnce(async () => { throw new Error('save outcome unknown'); });
    const prepared = await authorize(f);
    const dispose = install(f, prepared);
    try {
      await expectBlocked(dispatch(f, prepared));
      expect(f.network).not.toHaveBeenCalled();
      await expect(f.store.recover()).resolves.toMatchObject({ status: 'previous' });
      expect(f.network).not.toHaveBeenCalled();
    } finally { dispose(); }
  });
});
