import { afterEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { appendWorldSimulationCommitChain_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { buildDefaultWorldSimulationEnvelope_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { runWorldProjectionStage_ACU } from '../../../src/service/simulation/agent/world-projection-stage';
import { prepareWorldDispatchAuthorization_ACU } from '../../../src/service/simulation/world-dispatch-authorization';
import { reviewWorldDeliveryAdoption_ACU } from '../../../src/service/simulation/agent/world-delivery-adoption';
import { queryWorldDeliveryRedeliveryCandidates_ACU } from '../../../src/service/simulation/world-delivery-lifecycle';
import { WorldDeliveryHostStore_ACU } from '../../../src/service/simulation/world-delivery-host-store';

const PLACE = { region: '城区', place: '钟楼广场' } as const;
const SOURCE_TEXT = '主角站在钟楼广场。';
const SUCCESSOR_TEXT = '守卫点头，城门确已关闭。';
let sequence = 0;

function response(value: unknown): Response { return { ok: true, json: async () => structuredClone(value) } as Response; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fixture(options: { save?: (api: any, setRemote: (chat: any[]) => void) => Promise<void> } = {}) {
  const chatId = `delivery-host-${++sequence}`;
  const chat: any[] = [{}, { is_user: true, mes: '继续', message_id: 1 },
    { is_user: false, mes: SOURCE_TEXT, message_id: 2, swipe_id: 0 }];
  const api: any = { chat, chatId, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'delivery-card.png', name: '测试角色' }], getCurrentChatId: () => chatId };
  _set_SillyTavern_API_ACU(api);
  const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
  const before = buildEmptyWorldSimulationLedger_ACU();
  before.player.location = { ...PLACE };
  const ledger = structuredClone(before);
  ledger.revision = 1;
  ledger.facts = [{ id: 'safe-fact', summary: '城门已经关闭。', temporalKind: 'occurrence' as const,
    happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: { ...PLACE }, actorIds: [], worldEventIds: [],
    projectionPolicy: 'scene' as const, revealState: 'unlocked' as const, revealGate: null, nextCheck: null,
    sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger = structuredClone(ledger);
  envelope.task = { taskId: 'task', originInstruction: '推进', status: 'completed', createdAt: 1, updatedAt: 2, activeRun: null, stopReason: null,
    completedAutoAnchor: { chatIdentity: chatId, messageKey: anchor.messageKey, swipeId: anchor.swipeId, contentDigest: anchor.contentDigest } };
  envelope.timeline = [{ id: 'timeline', at: 2, kind: 'committed', taskId: 'task', stageId: 'stage', revision: 1, runId: 'run', message: '已提交' }];
  envelope.activeStageId = 'stage';
  envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'completed', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
    plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  chat[0]._qrf_world_simulation = envelope;
  appendWorldSimulationCommitChain_ACU({ chat, messageIndex: anchor.messageIndex, anchor, beforeLedger: before, nextLedger: ledger, evidenceRefs: [], updatedAt: 2,
    checkpointIndex: null, beforeArchive: { schemaVersion: 1, records: {} }, nextArchive: { schemaVersion: 1, records: {} } });
  let remote = structuredClone(chat);
  const setRemote = (value: any[]) => { remote = structuredClone(value); };
  api.saveChat = vi.fn(async () => options.save ? options.save(api, setRemote) : setRemote(api.chat));
  _set_SillyTavern_API_ACU(api);
  vi.stubGlobal('fetch', vi.fn(async () => response([{}, ...structuredClone(remote)])));
  return { api, anchor, ledger, store: new WorldDeliveryHostStore_ACU(anchor), setRemote };
}

function identity(f: ReturnType<typeof fixture>) {
  return { kind: 'host' as const, runId: 'run', chatIdentity: f.anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorContentDigest: f.anchor.contentDigest, baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
    deliveryTarget: 'body' as const, workflowMode: 'single' as const, workflowProtocol: 'world-round-v1' as const,
    anchorMessageId: f.anchor.messageId, anchorMessageKey: f.anchor.messageKey, anchorSwipeId: f.anchor.swipeId };
}

async function authorize(f: ReturnType<typeof fixture>) {
  const common = { ledger: f.ledger, identity: identity(f), targetAnchor: f.anchor, anchorText: SOURCE_TEXT, clock: f.ledger.clock,
    sceneLocation: { ...PLACE }, settings: buildDefaultWorldSimulationEnvelope_ACU().settings, signal: new AbortController().signal,
    isCurrent: () => true, countTokens: async () => 1 };
  const stage = await runWorldProjectionStage_ACU({ ...common, receipt: {}, invoke: async () => { throw new Error('scene only'); } });
  return prepareWorldDispatchAuthorization_ACU({ ...common, receipt: stage.receipt });
}

function intent(f: ReturnType<typeof fixture>, prepared: Awaited<ReturnType<typeof authorize>>, id = 'delivery') {
  return { deliveryId: id, target: 'body' as const, source: { chatIdentity: f.anchor.chatIdentity, messageKey: f.anchor.messageKey, swipeId: f.anchor.swipeId, contentDigest: f.anchor.contentDigest },
    ledgerRevision: prepared.ledgerRevision, ledgerFingerprint: prepared.ledgerFingerprint, factIds: prepared.factIds,
    requestFingerprint: '', createdAt: 10 };
}

function payload(prepared: Awaited<ReturnType<typeof authorize>>) {
  return { messages: [{ role: 'system', content: '既有规则' }, prepared.message] };
}

async function attempted(f: ReturnType<typeof fixture>, prepared: Awaited<ReturnType<typeof authorize>>) {
  const body = payload(prepared);
  const actual = { ...intent(f, prepared), requestFingerprint: '' };
  // claim computes the canonical messages fingerprint, so mirror it from the real payload shape.
  actual.requestFingerprint = (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU(canonical(body.messages));
  await f.store.runAttempt(actual, prepared.authorization, body, async () => {
    f.api.chat.push({ is_user: false, mes: SUCCESSOR_TEXT, message_id: 3, swipe_id: 0 });
    return 'sent';
  });
  await f.store.recordDurableSuccessor(actual.deliveryId);
  return actual;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _set_SillyTavern_API_ACU(undefined); });

describe('world delivery host integration', () => {
  it('真实 folded ledger/provenance 授权后，intent→attempt→首后继 durable→opaque adoption→apply，并只返回未采用的可重投事实', async () => {
    const f = fixture(); const prepared = await authorize(f); const actual = await attempted(f, prepared);
    const durable = f.store.read().records[0];
    expect(durable).toMatchObject({ deliveryId: actual.deliveryId, status: 'response-durable', successor: { messageKey: 'number:3' } });
    const { receipt } = await reviewWorldDeliveryAdoption_ACU({ delivery: durable, ledger: f.ledger, source: durable.source, successor: durable.successor!, successorText: SUCCESSOR_TEXT,
      requestFingerprint: durable.requestFingerprint, signal: new AbortController().signal, assertCurrent: () => undefined,
      review: async () => ({ results: [{ factId: 'safe-fact', adopted: false, evidenceQuotes: [] }] }) });
    await f.store.applyAdoption(receipt, { delivery: durable, ledger: f.ledger, source: durable.source, successor: durable.successor!, successorText: SUCCESSOR_TEXT,
      requestFingerprint: durable.requestFingerprint, signal: new AbortController().signal, assertCurrent: () => undefined });
    const lifecycle = f.store.read();
    expect(lifecycle.records[0]).toMatchObject({ status: 'reviewed', adoptedFactIds: [], reviewSource: 'narrative-review' });
    expect(queryWorldDeliveryRedeliveryCandidates_ACU(lifecycle, f.ledger, PLACE, f.ledger.clock)).toEqual([
      expect.objectContaining({ factIds: ['safe-fact'] }),
    ]);
    const later = new WorldDeliveryHostStore_ACU(resolveWorldSimulationAnchor_ACU(3, f.api.chat));
    expect(later.readHistory().records).toEqual(lifecycle.records);
    await later.recordIntent({ ...actual, deliveryId: 'second', source: {
      chatIdentity: f.anchor.chatIdentity, messageKey: 'number:3', swipeId: '0',
      contentDigest: f.store.read().records[0].successor!.contentDigest,
    }, requestFingerprint: (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU('second-request') });
    await expect(later.recordIntent({ ...actual, deliveryId: 'third', source: {
      chatIdentity: f.anchor.chatIdentity, messageKey: 'number:3', swipeId: '0',
      contentDigest: f.store.read().records[0].successor!.contentDigest,
    }, requestFingerprint: (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU('third-request') }))
      .rejects.toThrow(/未审查|最多投送两次/);
  });

  it('同一真实 authorization 只能跑一次；并发同 delivery 最多一次 dispatch', async () => {
    const f = fixture(); const first = await authorize(f); const second = await authorize(f);
    const firstPayload = payload(first); const secondPayload = payload(second);
    const firstIntent = { ...intent(f, first), requestFingerprint: (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU(canonical(firstPayload.messages)) };
    const secondIntent = { ...intent(f, second), requestFingerprint: (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU(canonical(secondPayload.messages)) };
    let release!: () => void; const dispatch = vi.fn(() => new Promise<string>(resolve => { release = () => resolve('sent'); }));
    const one = f.store.runAttempt(firstIntent, first.authorization, firstPayload, dispatch);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    await expect(f.store.runAttempt(secondIntent, second.authorization, secondPayload, dispatch)).rejects.toThrow(/deliveryId|已尝试|重复 dispatch/);
    release(); await expect(one).resolves.toBe('sent');
    await expect(f.store.runAttempt(firstIntent, first.authorization, firstPayload, dispatch)).rejects.toThrow();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('保存未知后 recover 不自动重发；同 revision ledger 或首后继变化均 fail closed', async () => {
    const unknown = fixture({ save: async (api, setRemote) => { setRemote(api.chat); throw new Error('lost after save'); } });
    const prepared = await authorize(unknown); const body = payload(prepared);
    const actual = { ...intent(unknown, prepared), requestFingerprint: (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU(canonical(body.messages)) };
    const dispatch = vi.fn(async () => 'must-not-send');
    await expect(unknown.store.runAttempt(actual, prepared.authorization, body, dispatch)).rejects.toThrow('PERSIST_UNKNOWN');
    expect(dispatch).not.toHaveBeenCalled();
    await unknown.store.recover();
    expect(dispatch).not.toHaveBeenCalled();

    const drift = fixture(); const driftPrepared = await authorize(drift); const driftBody = payload(driftPrepared);
    const driftIntent = { ...intent(drift, driftPrepared), requestFingerprint: (await import('../../../src/shared/sha256-sync')).sha256HexSync_ACU(canonical(driftBody.messages)) };
    drift.ledger.facts[0].summary = '同 revision 漂移';
    await expect(drift.store.runAttempt(driftIntent, driftPrepared.authorization, driftBody, async () => 'no')).rejects.toThrow();

    const successor = fixture(); const successorPrepared = await authorize(successor); const successorIntent = await attempted(successor, successorPrepared);
    successor.api.chat[3].mes = '首后继被替换';
    await expect(successor.store.recordDurableSuccessor(successorIntent.deliveryId)).rejects.toThrow(/successor|后继|STALE/i);
  });
});
