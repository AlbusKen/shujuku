import { countWorldSimulationTokens_ACU } from './agent-token-budget';
import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import type { WorldSimulationCompletedAnchor_ACU, WorldSimulationLedger_ACU, WorldSimulationSettings_ACU } from '../model';
import { appendWorldRoundPromptMessages_ACU } from './world-round-prompts';
import { validateWorldSimulationLedger_ACU } from '../simulation-store';
import { validateWorldDeliveryLifecycle_ACU, type WorldDeliveryAdoptionReceipt_ACU, type WorldDeliveryAttempt_ACU } from '../world-delivery-lifecycle';

export type WorldDeliveryAdoptionReviewInput_ACU = {
  delivery: WorldDeliveryAttempt_ACU;
  ledger: WorldSimulationLedger_ACU;
  source: WorldSimulationCompletedAnchor_ACU;
  successor: WorldSimulationCompletedAnchor_ACU;
  successorText: string;
  requestFingerprint: string;
  /** 可选且冻结的本轮提示词设置；不得从全局运行态读取。 */
  settings?: Pick<WorldSimulationSettings_ACU, 'worldRoundPrompts'>;
  signal: AbortSignal;
  assertCurrent: () => void;
  countTokens?: (text: string) => Promise<number>;
  review?: (facts: ReadonlyArray<{ id: string; summary: string }>, successorText: string) => Promise<unknown>;
  /** 使用完整原始消息的生产审查路径；有自定义提示词时必须提供。 */
  reviewWithMessages?: (messages: readonly { role: string; content: string }[], facts: ReadonlyArray<{ id: string; summary: string }>, successorText: string) => Promise<unknown>;
};

export type WorldDeliveryAdoptionClaimInput_ACU = Omit<WorldDeliveryAdoptionReviewInput_ACU, 'review'>;
type OpaqueReceipt_ACU = object;
type ReceiptMetadata_ACU = { deliveryId: string };
type Binding_ACU = { receipt: WorldDeliveryAdoptionReceipt_ACU; fingerprint: string; consumed: boolean };
const bindings_ACU = new WeakMap<object, Binding_ACU>();
const HASH_ACU = /^[a-f0-9]{64}$/;

function fail_ACU(message: string): never { throw new Error(`WORLD_DELIVERY_ADOPTION_INVALID: ${message}`); }
function genericReviewFailure_ACU(): never { throw new Error('WORLD_DELIVERY_ADOPTION_REVIEW_FAILED'); }
function isRecord_ACU(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function clone_ACU<T>(value: T): T { return structuredClone(value); }
function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sameAnchor_ACU(left: WorldSimulationCompletedAnchor_ACU, right: WorldSimulationCompletedAnchor_ACU): boolean {
  if (left.kind === 'logical' || right.kind === 'logical') return left.kind === 'logical' && right.kind === 'logical' && left.chatIdentity === right.chatIdentity && left.contentDigest === right.contentDigest && left.logicalRef.sessionId === right.logicalRef.sessionId && left.logicalRef.branchId === right.logicalRef.branchId && left.logicalRef.turnId === right.logicalRef.turnId && left.logicalRef.attemptId === right.logicalRef.attemptId && left.logicalRef.floorId === right.logicalRef.floorId;
  return left.chatIdentity === right.chatIdentity && left.messageKey === right.messageKey && left.swipeId === right.swipeId && left.contentDigest === right.contentDigest;
}
function fingerprintInput_ACU(input: WorldDeliveryAdoptionClaimInput_ACU): string {
  return sha256HexSync_ACU(canonical_ACU({ delivery: input.delivery, ledger: input.ledger, source: input.source, successor: input.successor, successorText: input.successorText, requestFingerprint: input.requestFingerprint }));
}
function fingerprintReviewSettings_ACU(input: Pick<WorldDeliveryAdoptionReviewInput_ACU, 'settings'>): string {
  return sha256HexSync_ACU(canonical_ACU(input.settings));
}
function assertReviewLive_ACU(input: WorldDeliveryAdoptionReviewInput_ACU, expected: string, settingsFingerprint: string): void {
  assertLive_ACU(input, expected);
  if (fingerprintReviewSettings_ACU(input) !== settingsFingerprint) fail_ACU('审查提示词设置已变化');
}
function assertLive_ACU(input: WorldDeliveryAdoptionClaimInput_ACU, expected: string): void {
  if (input.signal.aborted) fail_ACU('审查已取消'); input.assertCurrent();
  if (fingerprintInput_ACU(input) !== expected) fail_ACU('ledger/source/successor/request 或正文已变化');
}
function parseReview_ACU(raw: unknown, factIds: readonly string[], text: string): WorldDeliveryAdoptionReceipt_ACU['results'] {
  if (!isRecord_ACU(raw) || Object.keys(raw).length !== 1 || !Array.isArray(raw.results) || raw.results.length !== factIds.length || JSON.stringify(raw).length > 32_768) fail_ACU('审查输出必须是逐项覆盖 facts 的严格 JSON');
  const seen = new Set<string>();
  return raw.results.map((value, index) => {
    if (!isRecord_ACU(value) || Object.keys(value).length !== 3 || typeof value.factId !== 'string' || typeof value.adopted !== 'boolean' || !Array.isArray(value.evidenceQuotes) || value.evidenceQuotes.length > 8 || value.evidenceQuotes.some(quote => typeof quote !== 'string' || !quote.trim() || quote.length > 320)) fail_ACU(`results[${index}] 非法`);
    if (!factIds.includes(value.factId) || seen.has(value.factId)) fail_ACU('审查结果含未授权或重复 fact'); seen.add(value.factId);
    if (value.adopted && (!value.evidenceQuotes.length || value.evidenceQuotes.some(quote => !text.includes(quote)))) fail_ACU('adopted=true 必须含 successor 正文的精确引文');
    return { factId: value.factId, adopted: value.adopted, evidenceQuotes: [...value.evidenceQuotes] as string[] };
  });
}

/** 仅传入已授权事实摘要和真实首后继正文；receipt 是 WeakMap opaque capability，不能反序列化伪造。 */
export async function reviewWorldDeliveryAdoption_ACU(input: WorldDeliveryAdoptionReviewInput_ACU): Promise<{ receipt: OpaqueReceipt_ACU }> {
  validateWorldSimulationLedger_ACU(input.ledger, 'agent_persist');
  validateWorldDeliveryLifecycle_ACU({ schemaVersion: 1, revision: 0, records: [input.delivery] });
  if (!input.review && !input.reviewWithMessages) fail_ACU('审查回调缺失');
  const frozen: WorldDeliveryAdoptionReviewInput_ACU = {
    ...input,
    delivery: clone_ACU(input.delivery), ledger: clone_ACU(input.ledger), source: clone_ACU(input.source),
    successor: clone_ACU(input.successor), successorText: input.successorText,
    requestFingerprint: input.requestFingerprint,
    ...(input.settings === undefined ? {} : { settings: clone_ACU(input.settings) }),
  };
  if (frozen.delivery.status !== 'response-durable' || !frozen.delivery.successor || frozen.delivery.adoptedFactIds !== null || frozen.delivery.reviewSource !== null || !HASH_ACU.test(frozen.requestFingerprint)) fail_ACU('delivery 不是未审查的 response-durable');
  if (!sameAnchor_ACU(frozen.delivery.source, frozen.source) || !sameAnchor_ACU(frozen.delivery.successor, frozen.successor) || frozen.delivery.requestFingerprint !== frozen.requestFingerprint || sha256HexSync_ACU(frozen.successorText) !== frozen.successor.contentDigest) fail_ACU('delivery/source/successor/request/正文未严格绑定');
  if (sha256HexSync_ACU(canonical_ACU(frozen.ledger)) !== frozen.delivery.ledgerFingerprint || frozen.ledger.revision !== frozen.delivery.ledgerRevision) fail_ACU('权威账本完整 fingerprint 或 revision 不匹配');
  const expected = fingerprintInput_ACU(input);
  const settingsFingerprint = fingerprintReviewSettings_ACU(input);
  assertReviewLive_ACU(input, expected, settingsFingerprint);
  const facts = new Map(frozen.ledger.facts.map(fact => [fact.id, fact]));
  const authorized = frozen.delivery.factIds.map(id => { const fact = facts.get(id); if (!fact || fact.projectionPolicy === 'internal' || fact.revealState !== 'unlocked') fail_ACU('只允许已授权 scene + unlocked facts'); return { id, summary: fact.summary }; });
  const reviewMessages = frozen.settings !== undefined || frozen.reviewWithMessages
    ? appendWorldRoundPromptMessages_ACU([
      { role: 'system', content: '你是正文事实采用审查器。仅输出严格 JSON：{"results":[{"factId":"string","adopted":boolean,"evidenceQuotes":["正文精确原文"]}]}。每个事实必须恰好一项；仅在正文实际包含该事实且给出精确引文时 adopted=true。' },
      { role: 'user', content: JSON.stringify({ facts: authorized, successorText: frozen.successorText }) },
    ], frozen.settings ?? {}, 'adoption-review')
    : null;
  let reviewed: unknown;
  const count = input.countTokens ?? countWorldSimulationTokens_ACU;
  try {
    assertReviewLive_ACU(input, expected, settingsFingerprint);
    const inputTokens = await count(JSON.stringify(reviewMessages ?? { facts: authorized, successorText: frozen.successorText }));
    assertReviewLive_ACU(input, expected, settingsFingerprint);
    if (!Number.isFinite(inputTokens) || inputTokens <= 0 || inputTokens > 8192) fail_ACU('审查输入 token 预算非法或超限');
    reviewed = reviewMessages && frozen.reviewWithMessages
      ? await frozen.reviewWithMessages(reviewMessages, Object.freeze(authorized.map(clone_ACU)), frozen.successorText)
      : frozen.review
        ? await frozen.review(Object.freeze(authorized.map(clone_ACU)), frozen.successorText)
        : genericReviewFailure_ACU();
    assertReviewLive_ACU(input, expected, settingsFingerprint);
    const outputTokens = await count(JSON.stringify(reviewed));
    assertReviewLive_ACU(input, expected, settingsFingerprint);
    if (!Number.isFinite(outputTokens) || outputTokens <= 0 || inputTokens + outputTokens > 8192) fail_ACU('审查总 token 预算非法或超限');
  } catch (error) {
    try { assertReviewLive_ACU(input, expected, settingsFingerprint); } catch { genericReviewFailure_ACU(); }
    if (error instanceof Error && error.message.startsWith('WORLD_DELIVERY_ADOPTION_INVALID:')) throw error;
    genericReviewFailure_ACU();
  }
  const results = parseReview_ACU(reviewed, frozen.delivery.factIds, frozen.successorText);
  const dto: WorldDeliveryAdoptionReceipt_ACU = { schemaVersion: 1, deliveryId: frozen.delivery.deliveryId, ledgerRevision: frozen.delivery.ledgerRevision, ledgerFingerprint: frozen.delivery.ledgerFingerprint, source: clone_ACU(frozen.source), successor: clone_ACU(frozen.successor), requestFingerprint: frozen.requestFingerprint, reviewSource: 'narrative-review', results };
  const receipt = Object.freeze({}); bindings_ACU.set(receipt, { receipt: dto, fingerprint: expected, consumed: false }); return { receipt };
}

/** 只读 metadata 不提供可授权 binding 或 adopted IDs。 */
export function readWorldDeliveryAdoption_ACU(receipt: object): ReceiptMetadata_ACU {
  const entry = bindings_ACU.get(receipt); if (!entry || entry.consumed) fail_ACU('receipt 伪造或已消费'); return { deliveryId: entry.receipt.deliveryId };
}

/** 先消费再用当前实物输入逐项复核，防止跨 request/fake receipt/二次采用。 */
export function claimWorldDeliveryAdoption_ACU(receipt: object, input: WorldDeliveryAdoptionClaimInput_ACU): WorldDeliveryAdoptionReceipt_ACU {
  const entry = bindings_ACU.get(receipt); if (!entry || entry.consumed) fail_ACU('receipt 伪造或已消费'); entry.consumed = true;
  const expected = entry.fingerprint; assertLive_ACU(input, expected); return clone_ACU(entry.receipt);
}
