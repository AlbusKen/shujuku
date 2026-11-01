import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import type { InterceptedHostRequest_ACU } from '../../data/gateways/host-generation-interceptor';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import {
  assertWorldDispatchAuthorizationCurrent_ACU,
  claimWorldDispatchAuthorization_ACU,
  type WorldDispatchAuthorization_ACU,
  type WorldDispatchAuthorizationClaim_ACU,
} from './world-dispatch-authorization';
import { readWorldSimulationLedgerAtAnchor_ACU } from './agent/agent-module-store';
import type { WorldSimulationAnchorIdentity_ACU } from './agent/agent-model';
import { requireWorldSimulationHostAnchor_ACU, sameWorldSimulationTargetRef_ACU, worldSimulationRunTargetRef_ACU } from './simulation-identity';
import {
  FirstFloorWorldSimulationStore_ACU,
  resolveCurrentWorldSimulationAnchor_ACU,
} from './simulation-store';
import { WorldDispatchHostStore_ACU } from './world-dispatch-host-store';
import { isWorldFactEstablishedAt_ACU } from './world-fact-gate';
import type { WorldDispatchSource_ACU } from './world-dispatch-journal';
import type { WorldSimulationLedger_ACU } from './model';

export type WorldDispatchHostObserverInput_ACU = {
  authorization: WorldDispatchAuthorization_ACU;
  sourceAnchor: WorldSimulationAnchorIdentity_ACU;
  deliveryId: string;
  createdAt: number;
};

type CapturedSourceLease_ACU = {
  chat: unknown[];
  message: Record<string, unknown>;
};

type FrozenObserverInput_ACU = {
  authorization: WorldDispatchAuthorization_ACU;
  sourceAnchor: WorldSimulationAnchorIdentity_ACU;
  source: WorldDispatchSource_ACU;
  lease: CapturedSourceLease_ACU;
  deliveryId: string;
  createdAt: number;
};

function clone_ACU<T>(value: T): T {
  return structuredClone(value);
}

/** 与授权模块的账本、请求指纹算法完全一致：对象键排序，数组保序。 */
function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ledgerFingerprint_ACU(ledger: WorldSimulationLedger_ACU): string {
  return sha256HexSync_ACU(canonicalJson_ACU(ledger));
}

function sourceForAnchor_ACU(anchor: WorldSimulationAnchorIdentity_ACU): WorldDispatchSource_ACU {
  return {
    chatIdentity: anchor.chatIdentity,
    messageKey: anchor.messageKey,
    swipeId: anchor.swipeId,
    contentDigest: anchor.contentDigest,
  };
}

function sameSource_ACU(left: WorldDispatchSource_ACU, right: WorldDispatchSource_ACU): boolean {
  return left.chatIdentity === right.chatIdentity
    && left.messageKey === right.messageKey
    && left.swipeId === right.swipeId
    && left.contentDigest === right.contentDigest;
}

function fail_ACU(reason: string): never {
  throw new Error(`WORLD_DISPATCH_HOST_AUTHORIZATION_INVALID:${reason}`);
}

function assertCapturedLease_ACU(frozen: FrozenObserverInput_ACU): WorldSimulationAnchorIdentity_ACU {
  const chat = getChatArray_ACU();
  if (chat !== frozen.lease.chat) fail_ACU('当前聊天数组已替换');
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(frozen.sourceAnchor, chat);
  if (!sameSource_ACU(sourceForAnchor_ACU(currentAnchor), frozen.source)
    || chat[currentAnchor.messageIndex] !== frozen.lease.message) {
    fail_ACU('当前 source 的身份、正文、消息对象或聊天数组已变化');
  }
  return currentAnchor;
}

function assertClaimSource_ACU(claim: WorldDispatchAuthorizationClaim_ACU, frozen: FrozenObserverInput_ACU): void {
  if (claim.identity.chatIdentity !== claim.source.chatIdentity
    || claim.identity.anchorMessageKey !== claim.source.messageKey
    || claim.identity.anchorSwipeId !== claim.source.swipeId
    || claim.identity.anchorContentDigest !== claim.source.contentDigest) {
    fail_ACU('claim identity 与冻结 source 不一致');
  }
  if (!sameSource_ACU(claim.source, frozen.source)) {
    fail_ACU('claim source 与冻结宿主锚点四字段不一致');
  }
}

function assertClaimFacts_ACU(claim: WorldDispatchAuthorizationClaim_ACU, ledger: WorldSimulationLedger_ACU): void {
  if (!claim.factIds.length || new Set(claim.factIds).size !== claim.factIds.length) {
    fail_ACU('claim factIds 必须是非空且不重复的列表');
  }
  if (ledger.revision !== claim.ledgerRevision || ledgerFingerprint_ACU(ledger) !== claim.ledgerFingerprint) {
    fail_ACU('当前折叠账本 revision 或 canonical fingerprint 与 claim 不一致');
  }
  const facts = new Map(ledger.facts.map(fact => [fact.id, fact]));
  const allFacts = [...ledger.facts, ...(ledger.factArchive ?? [])];
  for (const factId of claim.factIds) {
    const fact = facts.get(factId);
    if (!fact || fact.projectionPolicy === 'internal' || fact.revealState !== 'unlocked'
      || allFacts.some(next => next.supersedesFactIds.includes(factId) && isWorldFactEstablishedAt_ACU(next, ledger.clock))) {
      fail_ACU('claim factIds 必须仍指向权威账本中已解锁的可投送事实');
    }
  }
}

/**
 * 从真实当前 chat 重新解析 source，并同时确认首楼完成态与当前 source 的 fold 权威账本。
 * 首楼缓存、其它 run 的候选或仅 revision 相同的账本均不能替代这一步。
 */
function readAuthoritativeLedger_ACU(
  frozen: FrozenObserverInput_ACU,
  claim: WorldDispatchAuthorizationClaim_ACU,
): WorldSimulationLedger_ACU {
  const chat = frozen.lease.chat;
  const currentAnchor = assertCapturedLease_ACU(frozen);
  const ledger = readWorldSimulationLedgerAtAnchor_ACU(currentAnchor, chat);
  if (!ledger) fail_ACU('当前 source 没有贡献到真实折叠账本，拒绝使用首楼缓存或其它 run 候选');
  const fingerprint = ledgerFingerprint_ACU(ledger);
  const envelope = new FirstFloorWorldSimulationStore_ACU().read();
  if (!envelope || !envelope.task || envelope.task.status !== 'completed' || envelope.task.activeRun !== null) {
    fail_ACU('首楼任务不是 completed + activeRun null，不能投送');
  }
  const stage = envelope.stages.find(candidate => candidate.stageId === claim.identity.stageId);
  if (envelope.task.taskId !== claim.identity.taskId || !stage
    || stage.status !== 'completed' || stage.activeRevision !== claim.identity.stageRevision) {
    fail_ACU('首楼已完成 task/stage 与本次 claim identity 不一致');
  }
  const matches = envelope.timeline.filter(item => item.kind === 'committed'
    && item.runId === claim.identity.runId && item.taskId === claim.identity.taskId
    && item.stageId === claim.identity.stageId && item.revision === claim.identity.stageRevision);
  if (matches.length !== 1) fail_ACU('首楼缺少唯一的本次 claim run 权威 committed 记录');
  if (claim.identity.triggerKind === 'assistant_completed') {
    const completed = envelope.task.completedAutoAnchor;
    if (!completed || !sameWorldSimulationTargetRef_ACU(completed, worldSimulationRunTargetRef_ACU(claim.identity))
      || completed.contentDigest !== claim.source.contentDigest) {
      fail_ACU('首楼完成锚点与本次 claim source 不一致');
    }
  }
  if (envelope.ledger.revision !== ledger.revision || ledgerFingerprint_ACU(envelope.ledger) !== fingerprint) {
    fail_ACU('首楼物化账本与当前 source 的折叠权威账本不一致');
  }
  return ledger;
}

export function assertWorldDispatchHostClaim_ACU(
  sourceAnchor: WorldSimulationAnchorIdentity_ACU, claim: WorldDispatchAuthorizationClaim_ACU,
): void {
  const anchor = requireWorldSimulationHostAnchor_ACU(sourceAnchor);
  const chat = getChatArray_ACU();
  const current = resolveCurrentWorldSimulationAnchor_ACU(anchor, chat);
  const frozen: FrozenObserverInput_ACU = { authorization: {}, sourceAnchor: clone_ACU(anchor),
    source: sourceForAnchor_ACU(anchor), lease: { chat, message: chat[current.messageIndex] }, deliveryId: '', createdAt: 0 };
  assertCapturedLease_ACU(frozen);
  assertClaimSource_ACU(claim, frozen);
  assertClaimFacts_ACU(claim, readAuthoritativeLedger_ACU(frozen, claim));
}

/**
 * 仅供测试和外部显式装配的发送前观察器。它只记录持久化 intent，绝不接管或转发网络请求。
 */
export function createWorldDispatchHostObserver_ACU(
  input: WorldDispatchHostObserverInput_ACU,
): (request: InterceptedHostRequest_ACU) => Promise<void> {
  const sourceAnchor = requireWorldSimulationHostAnchor_ACU(input.sourceAnchor);
  const chat = getChatArray_ACU();
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(sourceAnchor, chat);
  const source = sourceForAnchor_ACU(sourceAnchor);
  if (!sameSource_ACU(sourceForAnchor_ACU(currentAnchor), source)) {
    fail_ACU('factory sourceAnchor 的正文摘要或四字段不是当前实际 source');
  }
  const message = chat[currentAnchor.messageIndex];
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    fail_ACU('factory 无法捕获当前 source 的唯一消息对象');
  }
  const frozen: FrozenObserverInput_ACU = Object.freeze({
    authorization: input.authorization,
    sourceAnchor: clone_ACU(currentAnchor),
    source,
    lease: { chat, message },
    deliveryId: String(input.deliveryId),
    createdAt: input.createdAt,
  });

  return async (request: InterceptedHostRequest_ACU): Promise<void> => {
    assertCapturedLease_ACU(frozen);
    assertWorldDispatchAuthorizationCurrent_ACU(frozen.authorization);
    assertCapturedLease_ACU(frozen);
    if (request.signal?.aborted) fail_ACU('读取请求前 signal 已取消');
    const payload = await request.readPayload();
    assertCapturedLease_ACU(frozen);
    assertWorldDispatchAuthorizationCurrent_ACU(frozen.authorization);
    assertCapturedLease_ACU(frozen);
    if (request.signal?.aborted) fail_ACU('读取请求后 signal 已取消');

    const claim = claimWorldDispatchAuthorization_ACU(frozen.authorization, payload);
    assertCapturedLease_ACU(frozen);
    assertClaimSource_ACU(claim, frozen);
    const before = readAuthoritativeLedger_ACU(frozen, claim);
    assertClaimFacts_ACU(claim, before);
    assertWorldDispatchAuthorizationCurrent_ACU(frozen.authorization);
    assertCapturedLease_ACU(frozen);
    if (request.signal?.aborted) fail_ACU('保存前 signal 已取消');

    const store = new WorldDispatchHostStore_ACU(frozen.sourceAnchor);
    await store.recordIntent({
      deliveryId: frozen.deliveryId,
      source: clone_ACU(claim.source),
      ledgerRevision: claim.ledgerRevision,
      ledgerFingerprint: claim.ledgerFingerprint,
      factIds: [...claim.factIds],
      requestFingerprint: claim.requestFingerprint,
      createdAt: frozen.createdAt,
    });

    assertCapturedLease_ACU(frozen);
    assertWorldDispatchAuthorizationCurrent_ACU(frozen.authorization);
    assertCapturedLease_ACU(frozen);
    if (request.signal?.aborted) fail_ACU('保存后 signal 已取消');
    const after = readAuthoritativeLedger_ACU(frozen, claim);
    assertClaimFacts_ACU(claim, after);
    if (ledgerFingerprint_ACU(before) !== ledgerFingerprint_ACU(after)) {
      fail_ACU('保存期间权威账本已变化');
    }
  };
}
