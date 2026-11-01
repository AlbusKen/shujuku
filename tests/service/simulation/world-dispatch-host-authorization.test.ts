import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatArray_ACU } from '../../../src/data/gateways/chat-gateway';
import type { InterceptedHostRequest_ACU } from '../../../src/data/gateways/host-generation-interceptor';
import { buildDefaultWorldSimulationEnvelope_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { prepareWorldDispatchAuthorization_ACU } from '../../../src/service/simulation/world-dispatch-authorization';
import { createWorldDispatchHostObserver_ACU } from '../../../src/service/simulation/world-dispatch-host-authorization';
import { runWorldProjectionStage_ACU } from '../../../src/service/simulation/agent/world-projection-stage';
import { WORLD_SIMULATION_STATE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { WORLD_DISPATCH_JOURNAL_FIELD_ACU } from '../../../src/service/simulation/world-dispatch-host-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

let fixtureNumber = 0;

function sceneFact() {
  return {
    id: 'scene-fact', summary: '广场的钟声已停。', temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '夜' }, validFrom: null, validUntil: null,
    locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
    projectionPolicy: 'scene' as const, revealState: 'unlocked' as const, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

function request(payload: Record<string, unknown>, signal: AbortSignal | null = null): InterceptedHostRequest_ACU {
  return { url: 'http://localhost/api/backends/chat-completions/generate', signal, bodyText: JSON.stringify(payload),
    readPayload: async () => structuredClone(payload) };
}

function delayedRequest(
  payload: Record<string, unknown>,
  beforeResolve: () => void,
): InterceptedHostRequest_ACU {
  return { url: 'http://localhost/api/backends/chat-completions/generate', signal: null, bodyText: JSON.stringify(payload),
    readPayload: async () => {
      beforeResolve();
      return structuredClone(payload);
    } };
}

async function fixture(options: { completed?: boolean; frame?: boolean; saveChat?: () => Promise<void> } = {}) {
  const chat: Array<Record<string, unknown>> = [
    {},
    { message_id: 9, is_user: false, swipe_id: 0, mes: '钟楼下的风停了一瞬。', swipes: ['钟楼下的风停了一瞬。'] },
  ];
  const saveChat = vi.fn(options.saveChat ?? (async () => undefined));
  const chatIdentity = `dispatch-host-auth-${++fixtureNumber}`;
  _set_SillyTavern_API_ACU({ chat, chatId: chatIdentity, groupId: `group-${chatIdentity}`,
    getCurrentChatId: () => chatIdentity, saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => structuredClone(chat) })));
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.revision = 4;
  ledger.clock = { ...ledger.clock, day: 2, slot: '夜' };
  ledger.player = { ...ledger.player, location: { region: '上海', place: '广场' } };
  ledger.facts = [sceneFact()];
  if (options.frame !== false) {
    chat[1][WORLD_SIMULATION_STATE_FIELD_ACU] = { schemaVersion: 1, entries: {
      [buildWorldSimulationBucketKey_ACU(anchor)]: {
        anchor: structuredClone(anchor),
        value: { schemaVersion: 2, checkpoint: structuredClone(ledger), deltas: [] }, updatedAt: 1,
      },
    } };
  }
  const identity = {
    runId: 'run-host-auth', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
    anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: ledger.revision,
    taskId: 'task-host-auth', stageId: 'stage-host-auth', stageRevision: 1,
    workflowProtocol: 'world-round-v1' as const, deliveryTarget: 'body' as const, workflowMode: 'single' as const,
  };
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger = structuredClone(ledger);
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: options.completed === false ? 'running' : 'completed',
    activeRevision: identity.stageRevision, revisions: [{ revision: identity.stageRevision, createdAt: 1, reason: 'initial',
      replanInstruction: '', frozen: true, plan: { schemaVersion: 1, title: '投送', objective: '投送', impactScope: [], factsToVerify: [],
        plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '完成' } }] }];
  envelope.activeStageId = options.completed === false ? identity.stageId : null;
  envelope.task = { taskId: identity.taskId, originInstruction: '投送场景事实', status: options.completed === false ? 'running' : 'completed',
    createdAt: 1, updatedAt: 1, activeRun: options.completed === false ? identity : null, stopReason: null,
    ...(options.completed === false ? {} : { completedAutoAnchor: {
      chatIdentity: anchor.chatIdentity, messageKey: anchor.messageKey, swipeId: anchor.swipeId, contentDigest: anchor.contentDigest,
    } }),
  };
  envelope.timeline = options.completed === false ? [] : [{
    id: 'timeline-host-auth', at: 1, kind: 'committed', taskId: identity.taskId,
    stageId: identity.stageId, revision: identity.stageRevision, runId: identity.runId, message: '投送完成',
  }];
  chat[0]._qrf_world_simulation = envelope;
  const signal = new AbortController();
  const stage = await runWorldProjectionStage_ACU({ ledger, identity, targetAnchor: anchor, anchorText: chat[1].mes as string,
    sceneLocation: { region: '上海', place: '广场' }, settings: envelope.settings, signal: signal.signal,
    isCurrent: () => true, invoke: async () => { throw new Error('scene fact does not need semantic review'); }, countTokens: async () => 1 });
  const prepared = await prepareWorldDispatchAuthorization_ACU({ receipt: stage.receipt, ledger, identity, targetAnchor: anchor,
    anchorText: chat[1].mes as string, clock: ledger.clock, sceneLocation: { region: '上海', place: '广场' },
    settings: envelope.settings, signal: signal.signal, isCurrent: () => true, countTokens: async () => 1 });
  const observer = createWorldDispatchHostObserver_ACU({ authorization: prepared.authorization, sourceAnchor: anchor,
    deliveryId: 'delivery-host-auth', createdAt: 100 });
  return { chat, anchor, ledger, envelope, prepared, observer, saveChat, signal };
}

describe('WorldDispatchHostAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _set_SillyTavern_API_ACU(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('使用当前 source 的真实折叠账本，严格保存 scene + unlocked 事实的 intent', async () => {
    const f = await fixture();
    await f.observer(request({ messages: [f.prepared.message] }));

    const journal = f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU] as { entries: Record<string, { value: { records: Array<Record<string, unknown>> } }> };
    const record = Object.values(journal.entries)[0].value.records[0];
    expect(record).toMatchObject({ deliveryId: 'delivery-host-auth', source: f.prepared.source,
      ledgerRevision: 4, ledgerFingerprint: f.prepared.ledgerFingerprint, factIds: ['scene-fact'], successor: null });
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(getChatArray_ACU()).toBe(f.chat);
  });

  it('source 无合法 frame 时拒绝，首楼缓存不能替代权威 fold', async () => {
    const f = await fixture({ frame: false });
    await expect(f.observer(request({ messages: [f.prepared.message] }))).rejects.toThrow('没有贡献到真实折叠账本');
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('未完成 task、错误最终 payload 与已取消授权均零保存', async () => {
    const unfinished = await fixture({ completed: false });
    await expect(unfinished.observer(request({ messages: [unfinished.prepared.message] }))).rejects.toThrow('completed');
    expect(unfinished.saveChat).not.toHaveBeenCalled();

    const wrong = await fixture();
    await expect(wrong.observer(request({ messages: [{ role: 'system', content: '篡改 payload' }] }))).rejects.toThrow('prepared message');
    expect(wrong.saveChat).not.toHaveBeenCalled();

    const cancelled = await fixture();
    cancelled.signal.abort();
    await expect(cancelled.observer(request({ messages: [cancelled.prepared.message] }))).rejects.toThrow('运行已取消');
    expect(cancelled.saveChat).not.toHaveBeenCalled();
  });

  it('同 revision 但内容漂移时拒绝，不能只比较 revision', async () => {
    const f = await fixture();
    const state = f.chat[1][WORLD_SIMULATION_STATE_FIELD_ACU] as {
      entries: Record<string, { value: { checkpoint: { facts: Array<{ summary: string }> } } }>;
    };
    Object.values(state.entries)[0].value.checkpoint.facts[0].summary = '内容已经漂移';
    f.envelope.ledger.facts[0].summary = '内容已经漂移';

    await expect(f.observer(request({ messages: [f.prepared.message] }))).rejects.toThrow('canonical fingerprint');
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('权威冷层中已成立的替代者会阻止此前热层授权事实保存 intent', async () => {
    const f = await fixture();
    const state = f.chat[1][WORLD_SIMULATION_STATE_FIELD_ACU] as {
      entries: Record<string, { value: { checkpoint: { factArchive?: Array<Record<string, unknown>> } } }>;
    };
    const replacement = { ...sceneFact(), id: 'cold-replacement', projectionPolicy: 'internal' as const,
      revealState: 'locked' as const, locationRef: null, supersedesFactIds: ['scene-fact'] };
    Object.values(state.entries)[0].value.checkpoint.factArchive = [replacement];
    f.envelope.ledger.factArchive = [structuredClone(replacement)];
    await expect(f.observer(request({ messages: [f.prepared.message] }))).rejects.toThrow('canonical fingerprint');
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('保存期间权威账本漂移时在严格保存后拒绝，且不执行网络转发', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture({ saveChat: async () => {
      const state = f.chat[1][WORLD_SIMULATION_STATE_FIELD_ACU] as {
        entries: Record<string, { value: { checkpoint: { facts: Array<{ summary: string }> } } }>;
      };
      Object.values(state.entries)[0].value.checkpoint.facts[0].summary = '保存中漂移';
      f.envelope.ledger.facts[0].summary = '保存中漂移';
    } });

    await expect(f.observer(request({ messages: [f.prepared.message] }))).rejects.toThrow('canonical fingerprint');
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]).toBeDefined();
  });

  it('保存响应丢失时保留 strict store 的 unknown，观察器不自动恢复或重试', async () => {
    const f = await fixture({ saveChat: async () => { throw new Error('SAVE_RESPONSE_LOST_BEFORE_REMOTE_CONFIRMATION'); } });
    await expect(f.observer(request({ messages: [f.prepared.message] }))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]).toBeDefined();
  });

  it('readPayload 等待期间同 chatId 替换为克隆聊天数组时拒绝且零保存', async () => {
    const f = await fixture();
    await expect(f.observer(delayedRequest({ messages: [f.prepared.message] }, () => {
      const cloned = structuredClone(f.chat);
      _set_SillyTavern_API_ACU({ chat: cloned, chatId: f.anchor.chatIdentity, groupId: 'group-dispatch-host-auth',
        getCurrentChatId: () => f.anchor.chatIdentity, saveChat: f.saveChat } as any);
    }))).rejects.toThrow('聊天数组已替换');
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('缺失或错误的 completed provenance 均不能领取本次授权', async () => {
    const missingCommitted = await fixture();
    missingCommitted.envelope.timeline = [];
    await expect(missingCommitted.observer(request({ messages: [missingCommitted.prepared.message] }))).rejects.toThrow();
    expect(missingCommitted.saveChat).not.toHaveBeenCalled();

    const duplicateCommitted = await fixture();
    duplicateCommitted.envelope.timeline.push({ ...duplicateCommitted.envelope.timeline[0], id: 'another-commit' });
    await expect(duplicateCommitted.observer(request({ messages: [duplicateCommitted.prepared.message] }))).rejects.toThrow('唯一');
    expect(duplicateCommitted.saveChat).not.toHaveBeenCalled();

    const missingCommittedRun = await fixture();
    delete missingCommittedRun.envelope.timeline[0].runId;
    await expect(missingCommittedRun.observer(request({ messages: [missingCommittedRun.prepared.message] }))).rejects.toThrow('committed');
    expect(missingCommittedRun.saveChat).not.toHaveBeenCalled();

    const differentRunSameTaskStage = await fixture();
    differentRunSameTaskStage.envelope.timeline[0].runId = 'other-run';
    await expect(differentRunSameTaskStage.observer(request({ messages: [differentRunSameTaskStage.prepared.message] }))).rejects.toThrow('committed');
    expect(differentRunSameTaskStage.saveChat).not.toHaveBeenCalled();

    const missingAutoAnchor = await fixture();
    delete missingAutoAnchor.envelope.task!.completedAutoAnchor;
    await expect(missingAutoAnchor.observer(request({ messages: [missingAutoAnchor.prepared.message] }))).rejects.toThrow();
    expect(missingAutoAnchor.saveChat).not.toHaveBeenCalled();

    const wrongAutoAnchor = await fixture();
    wrongAutoAnchor.envelope.task!.completedAutoAnchor!.contentDigest = 'other-assistant-digest';
    await expect(wrongAutoAnchor.observer(request({ messages: [wrongAutoAnchor.prepared.message] }))).rejects.toThrow();
    expect(wrongAutoAnchor.saveChat).not.toHaveBeenCalled();
  });

  it('其它 completed task 或错误 stage 完成态不能领取本次授权', async () => {
    const otherTask = await fixture();
    otherTask.envelope.task!.taskId = 'other-task';
    await expect(otherTask.observer(request({ messages: [otherTask.prepared.message] }))).rejects.toThrow('task/stage');
    expect(otherTask.saveChat).not.toHaveBeenCalled();

    const wrongStage = await fixture();
    wrongStage.envelope.stages[0].status = 'running';
    await expect(wrongStage.observer(request({ messages: [wrongStage.prepared.message] }))).rejects.toThrow('task/stage');
    expect(wrongStage.saveChat).not.toHaveBeenCalled();

    const wrongRevision = await fixture();
    wrongRevision.envelope.stages[0].activeRevision = 2;
    await expect(wrongRevision.observer(request({ messages: [wrongRevision.prepared.message] }))).rejects.toThrow();
    expect(wrongRevision.saveChat).not.toHaveBeenCalled();
  });

  it('source 楼层索引移动但原对象仍在同一 chat 时可严格保存', async () => {
    const f = await fixture();
    const source = f.chat[1];
    f.chat.splice(1, 0, { is_user: true, mes: '插入楼层' });
    await f.observer(request({ messages: [f.prepared.message] }));
    expect(f.chat[2]).toBe(source);
    expect(f.saveChat).toHaveBeenCalledOnce();
  });

  it('logical anchor 在工厂入口被拒绝，未知保存能力不会写入或转发', async () => {
    const f = await fixture();
    expect(() => createWorldDispatchHostObserver_ACU({ authorization: f.prepared.authorization,
      sourceAnchor: { kind: 'logical', chatIdentity: f.anchor.chatIdentity,
        logicalRef: { sessionId: 's', branchId: 'b', turnId: 't', attemptId: 'a', floorId: 'f' }, contentDigest: f.anchor.contentDigest } as any,
      deliveryId: 'logical', createdAt: 100 })).toThrow();

    const unavailable = await fixture();
    _set_SillyTavern_API_ACU({ chat: unavailable.chat, chatId: unavailable.anchor.chatIdentity,
      getCurrentChatId: () => unavailable.anchor.chatIdentity } as any);
    await expect(unavailable.observer(request({ messages: [unavailable.prepared.message] }))).rejects.toThrow();
    expect(unavailable.chat[1]).not.toHaveProperty(WORLD_DISPATCH_JOURNAL_FIELD_ACU);
  });
});
