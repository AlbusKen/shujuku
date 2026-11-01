import { resolveWorldSimulationAgentApiPreset_ACU } from '../api-preset';
import { readWorldNarrativeScene_ACU, readWorldNarrativeSemanticReviews_ACU, type WorldNarrativeSceneReceipt_ACU } from './world-scene-review';
import { worldModelReplyText_ACU } from './model-reply-text';
import { sameWorldSimulationTargetRef_ACU, worldSimulationRunTargetRef_ACU, worldSimulationTargetRef_ACU } from '../simulation-identity';
import { checkWorldFactRevealGate_ACU, isWorldFactEstablishedAt_ACU } from '../world-fact-gate';
import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { appendWorldRoundPromptMessages_ACU } from './world-round-prompts';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { createWorldSimulationReadGateState_ACU, gateWorldSimulationReadBatch_ACU } from './agent-read-gate';
import type { WorldSimulationAgentInvoker_ACU } from './agent-subagent-runtime';
import type { WorldClock_ACU, WorldFact_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU, WorldSimulationRunIdentity_ACU, WorldSimulationSettings_ACU, WorldTime_ACU } from '../model';
import type { WorldSimulationTargetAnchor_ACU } from './agent-model';

const WORLD_PROJECTION_PAGE_SIZE_ACU = 16;
const WORLD_PROJECTION_QUOTE_MAX_CHARS_ACU = 320;
const WORLD_PROJECTION_QUOTE_MAX_COUNT_ACU = 8;

export type WorldProjectionReviewReceipt_ACU = object;
/** 仅代表本轮受限读取后的程序许可；不蕴含宿主 contact 或模型引文的可信性。 */
export type WorldFactRevealProof_ACU = object;
export type WorldBodyProjectionProof_ACU = object;
export interface WorldProjectionStageResult_ACU { factIds: string[]; revealFactIds: string[]; receipt: WorldProjectionReviewReceipt_ACU; summary: string; }
export interface WorldProjectionStageInput_ACU {
  ledger: WorldSimulationLedger_ACU;
  identity: WorldSimulationRunIdentity_ACU;
  targetAnchor: WorldSimulationTargetAnchor_ACU;
  anchorText: string;
  sceneLocation: WorldLocationRef_ACU | null;
  contactedActorIds?: readonly string[];
  /** 仅 narrative receipt wrapper 可开启：正文受审场景可校准尚未写回的玩家位置。 */
  trustedNarrativeScene?: boolean;
  /** 已签发的联合正文审查回执。提供时只消费其中 opaque 语义结果，禁止第二次模型调用。 */
  narrativeReviewReceipt?: WorldNarrativeSceneReceipt_ACU;
  settings: WorldSimulationSettings_ACU;
  signal: AbortSignal;
  invoke: WorldSimulationAgentInvoker_ACU;
  countTokens?: WorldSimulationTokenCounter_ACU;
  isCurrent(): boolean;
}
export interface ReadReviewedWorldProjectionFactsInput_ACU {
  receipt: WorldProjectionReviewReceipt_ACU;
  ledger: WorldSimulationLedger_ACU;
  identity: WorldSimulationRunIdentity_ACU;
  targetAnchor: WorldSimulationTargetAnchor_ACU;
  anchorText: string;
  clock: WorldClock_ACU;
  sceneLocation: WorldLocationRef_ACU | null;
  contactedActorIds?: readonly string[];
  settings: WorldSimulationSettings_ACU;
  signal: AbortSignal;
  countTokens?: WorldSimulationTokenCounter_ACU;
  isCurrent(): boolean;
}
export interface ReviewedWorldProjectionFactSet_ACU { facts: WorldFact_ACU[]; factIds: string[]; revealFactIds: string[]; summary: string; }

type ReceiptBinding_ACU = {
  ledgerFingerprint: string; identityFingerprint: string; anchorFingerprint: string; anchorTextFingerprint: string;
  clockFingerprint: string; sceneFingerprint: string; sceneLocation: WorldLocationRef_ACU | null; contactFingerprint: string; configFingerprint: string;
  factIds: string[]; revealFactIds: string[]; claimed: boolean;
};
type RevealProofBinding_ACU = {
  ledgerFingerprint: string; identityFingerprint: string; anchorFingerprint: string; anchorTextFingerprint: string;
  clockFingerprint: string; sceneFingerprint: string; sceneLocation: WorldLocationRef_ACU; contactFingerprint: string; configFingerprint: string;
  contacts: string[]; factIds: string[]; claimed: boolean;
};
type BodyProofBinding_ACU = {
  ledgerFingerprint: string; identityFingerprint: string; anchorFingerprint: string;
  factIds: string[]; claimed: boolean;
};
type StageSnapshot_ACU = {
  ledger: WorldSimulationLedger_ACU; identity: WorldSimulationRunIdentity_ACU; targetAnchor: WorldSimulationTargetAnchor_ACU;
  anchorText: string; sceneLocation: WorldLocationRef_ACU | null; contacts: string[]; trustedNarrativeScene: boolean; narrativeReviewReceipt?: WorldNarrativeSceneReceipt_ACU; settings: WorldSimulationSettings_ACU;
  readClock?: WorldClock_ACU;
  fingerprints: Record<string, string>;
};

const receiptBindings_ACU = new WeakMap<object, ReceiptBinding_ACU>();
const revealProofBindings_ACU = new WeakMap<object, RevealProofBinding_ACU>();
const bodyProofBindings_ACU = new WeakMap<object, BodyProofBinding_ACU>();
function fail_ACU(reason: string): never { throw new Error(`WORLD_PROJECTION_STAGE_INVALID:${reason}`); }
function isRecord_ACU(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function canonicalize_ACU(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize_ACU);
  if (isRecord_ACU(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize_ACU(value[key])]));
  return value;
}
function fingerprint_ACU(value: unknown): string { return sha256HexSync_ACU(JSON.stringify(canonicalize_ACU(value))); }
function bodyLedgerFingerprint_ACU(ledger: WorldSimulationLedger_ACU): string {
  return fingerprint_ACU({ ...ledger, facts: [...ledger.facts].sort((left, right) => left.id.localeCompare(right.id)) });
}
function identityFingerprint_ACU(identity: WorldSimulationRunIdentity_ACU): string {
  if (!identity || typeof identity !== 'object') fail_ACU('缺少运行身份');
  const { anchorContentDigest: _digest, ...floorIdentity } = identity;
  return fingerprint_ACU(floorIdentity);
}
function anchorFingerprint_ACU(anchor: WorldSimulationTargetAnchor_ACU): string {
  const { contentDigest: _digest, ...floorAnchor } = anchor;
  return fingerprint_ACU(floorAnchor);
}
function sameTargetFloor_ACU(identity: WorldSimulationRunIdentity_ACU, anchor: WorldSimulationTargetAnchor_ACU): boolean {
  const run = worldSimulationRunTargetRef_ACU(identity);
  const target = worldSimulationTargetRef_ACU(anchor);
  return sameWorldSimulationTargetRef_ACU({ ...run, contentDigest: '' }, { ...target, contentDigest: '' });
}
function nonEmptyText_ACU(value: unknown, reason: string): string { if (typeof value !== 'string' || !value.trim()) fail_ACU(reason); return value; }
function stableIds_ACU(ids: readonly string[] | undefined, reason: string): string[] {
  const values = ids ?? [];
  if (values.some(id => typeof id !== 'string' || !id.trim()) || new Set(values).size !== values.length) fail_ACU(reason);
  return [...values].sort();
}
function exactLocation_ACU(location: WorldLocationRef_ACU | null): WorldLocationRef_ACU | null {
  if (!location || typeof location.region !== 'string' || !location.region.trim() || typeof location.place !== 'string' || !location.place.trim()) return null;
  return { region: location.region, place: location.place };
}
function sameLocation_ACU(left: WorldLocationRef_ACU, right: WorldLocationRef_ACU): boolean { return left.region === right.region && left.place === right.place; }
function candidateTime_ACU(clock: WorldClock_ACU): WorldTime_ACU { return { day: clock.day, slot: clock.slot }; }
function readConfig_ACU(settings: WorldSimulationSettings_ACU): Record<string, unknown> {
  return { agentHistoryTokenBudget: settings.agentHistoryTokenBudget, agentReadTokenBudget: settings.agentReadTokenBudget, agentReadFallbackTokens: settings.agentReadFallbackTokens };
}
function requireProtocol_ACU(identity: WorldSimulationRunIdentity_ACU): void {
  if (identity.workflowProtocol !== 'world-round-v1' || identity.deliveryTarget !== 'body' || !['single', 'layered'].includes(identity.workflowMode ?? '')) {
    fail_ACU('仅 body + world-round-v1 的冻结 single/layered 身份可进入投影阶段');
  }
}
function assertAnchorIntegrity_ACU(identity: WorldSimulationRunIdentity_ACU, target: WorldSimulationTargetAnchor_ACU): void {
  if (!sameTargetFloor_ACU(identity, target)) fail_ACU('锚点楼层身份不一致');
}
function isSuperseded_ACU(fact: WorldFact_ACU, allFacts: readonly WorldFact_ACU[], clock: WorldTime_ACU): boolean {
  return allFacts.some(next => next.supersedesFactIds.includes(fact.id) && isWorldFactEstablishedAt_ACU(next, clock));
}
function matchesSceneFact_ACU(fact: WorldFact_ACU, clock: WorldTime_ACU, scene: WorldLocationRef_ACU, allFacts: readonly WorldFact_ACU[]): boolean {
  if (fact.projectionPolicy !== 'scene' || fact.revealState !== 'unlocked' || !fact.locationRef
    || !sameLocation_ACU(fact.locationRef, scene) || !isWorldFactEstablishedAt_ACU(fact, clock) || isSuperseded_ACU(fact, allFacts, clock)) return false;
  return fact.temporalKind !== 'occurrence' || !!fact.happenedAt && fact.happenedAt.day === clock.day
    && (fact.happenedAt.slot === '' || clock.slot !== '' && fact.happenedAt.slot === clock.slot);
}
function matchesPersistedGatedFact_ACU(fact: WorldFact_ACU, clock: WorldTime_ACU, scene: WorldLocationRef_ACU, allFacts: readonly WorldFact_ACU[]): boolean {
  return fact.projectionPolicy === 'gated' && fact.revealState === 'unlocked' && !!fact.locationRef
    && sameLocation_ACU(fact.locationRef, scene) && isWorldFactEstablishedAt_ACU(fact, clock) && !isSuperseded_ACU(fact, allFacts, clock);
}
function chunks_ACU<T>(items: readonly T[]): T[][] { const pages: T[][] = []; for (let offset = 0; offset < items.length; offset += WORLD_PROJECTION_PAGE_SIZE_ACU) pages.push([...items.slice(offset, offset + WORLD_PROJECTION_PAGE_SIZE_ACU)]); return pages; }
function modelText_ACU(value: unknown): string {
  const text = worldModelReplyText_ACU(value);
  if (text === null) fail_ACU('投影语义审查缺少 content');
  return text;
}
function parseSemanticReviews_ACU(raw: string, expectedIds: readonly string[], anchorText: string): Set<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { fail_ACU('投影语义审查未返回严格 JSON'); }
  if (!isRecord_ACU(parsed) || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.reviews)) fail_ACU('投影语义审查 JSON 顶层非法');
  const actualIds: string[] = []; const approved = new Set<string>();
  for (const review of parsed.reviews) {
    if (!isRecord_ACU(review) || Object.keys(review).length !== 3 || Object.keys(review).some(key => !['factId', 'triggered', 'evidence'].includes(key))
      || typeof review.factId !== 'string' || typeof review.triggered !== 'boolean' || !Array.isArray(review.evidence)) fail_ACU('投影语义审查条目非法');
    actualIds.push(review.factId);
    if (review.evidence.length > WORLD_PROJECTION_QUOTE_MAX_COUNT_ACU || review.evidence.some(item => !isRecord_ACU(item) || Object.keys(item).length !== 1 || typeof item.quote !== 'string')) fail_ACU('投影语义审查证据非法');
    const quotes = review.evidence.map(item => (item as { quote: string }).quote);
    if (review.triggered !== (quotes.length > 0) || new Set(quotes).size !== quotes.length) fail_ACU('triggered 与引文集合不一致');
    for (const quote of quotes) if (!quote.trim() || quote.length > WORLD_PROJECTION_QUOTE_MAX_CHARS_ACU || !anchorText.includes(quote)) fail_ACU('语义引文必须是冻结正文中的精确非空匹配');
    if (review.triggered) approved.add(review.factId);
  }
  if (actualIds.length !== expectedIds.length || new Set(actualIds).size !== actualIds.length || actualIds.some(id => !expectedIds.includes(id))) fail_ACU('投影语义审查必须恰好覆盖本页每个候选 ID');
  return approved;
}
function validateReadConfig_ACU(settings: WorldSimulationSettings_ACU): void {
  if (!Number.isFinite(settings.agentHistoryTokenBudget) || settings.agentHistoryTokenBudget <= 0
    || !Number.isFinite(settings.agentReadFallbackTokens) || settings.agentReadFallbackTokens <= 0) fail_ACU('读取预算配置非法');
  const configured = settings.agentReadTokenBudget;
  const validFixed = typeof configured === 'number' && Number.isFinite(configured) && configured >= 1;
  const percent = typeof configured === 'string' && /^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(configured.trim()) ? Number(configured.trim().slice(0, -1)) : NaN;
  if (!validFixed && !(Number.isFinite(percent) && percent >= 1 && percent <= 100)) fail_ACU('读取预算配置非法');
}
function snapshotStage_ACU(input: Pick<WorldProjectionStageInput_ACU, 'ledger' | 'identity' | 'targetAnchor' | 'anchorText' | 'sceneLocation' | 'contactedActorIds' | 'trustedNarrativeScene' | 'narrativeReviewReceipt' | 'settings'>): StageSnapshot_ACU {
  const contacts = stableIds_ACU(input.contactedActorIds, 'contactedActorIds 必须为不重复非空 ID');
  const trustedNarrativeScene = input.trustedNarrativeScene === true;
  const fingerprints = { ledger: fingerprint_ACU(input.ledger), identity: identityFingerprint_ACU(input.identity), targetAnchor: anchorFingerprint_ACU(input.targetAnchor), anchorText: fingerprint_ACU(input.anchorText), scene: fingerprint_ACU(input.sceneLocation), contacts: fingerprint_ACU(contacts), settings: fingerprint_ACU(input.settings) };
  return { ledger: structuredClone(input.ledger), identity: structuredClone(input.identity), targetAnchor: structuredClone(input.targetAnchor), anchorText: input.anchorText, sceneLocation: structuredClone(input.sceneLocation), contacts, trustedNarrativeScene, narrativeReviewReceipt: input.narrativeReviewReceipt, settings: structuredClone(input.settings), fingerprints };
}
function assertLiveStage_ACU(input: Pick<WorldProjectionStageInput_ACU, 'ledger' | 'identity' | 'targetAnchor' | 'anchorText' | 'sceneLocation' | 'contactedActorIds' | 'trustedNarrativeScene' | 'narrativeReviewReceipt' | 'settings' | 'signal' | 'isCurrent'>, snapshot: StageSnapshot_ACU): void {
  if (input.signal.aborted || !input.isCurrent()) fail_ACU('运行已取消或租约失效');
  const contacts = stableIds_ACU(input.contactedActorIds, 'contactedActorIds 已变化');
  if (fingerprint_ACU(input.ledger) !== snapshot.fingerprints.ledger || identityFingerprint_ACU(input.identity) !== snapshot.fingerprints.identity
    || anchorFingerprint_ACU(input.targetAnchor) !== snapshot.fingerprints.targetAnchor || fingerprint_ACU(input.anchorText) !== snapshot.fingerprints.anchorText
    || fingerprint_ACU(input.sceneLocation) !== snapshot.fingerprints.scene || fingerprint_ACU(contacts) !== snapshot.fingerprints.contacts
    || (input.trustedNarrativeScene === true) !== snapshot.trustedNarrativeScene
    || input.narrativeReviewReceipt !== snapshot.narrativeReviewReceipt
    || fingerprint_ACU(input.settings) !== snapshot.fingerprints.settings) fail_ACU('异步期间输入快照已变化');
}
async function gateIds_ACU(ids: readonly string[], snapshot: StageSnapshot_ACU, input: WorldProjectionStageInput_ACU, count: WorldSimulationTokenCounter_ACU): Promise<void> {
  validateReadConfig_ACU(snapshot.settings);
  const decision = await gateWorldSimulationReadBatch_ACU([{ label: 'world-projection-fact-ids', text: JSON.stringify({ factIds: ids }) }], createWorldSimulationReadGateState_ACU(), {
    historyTokenBudget: snapshot.settings.agentHistoryTokenBudget, readTokenBudget: snapshot.settings.agentReadTokenBudget, fallbackTokens: snapshot.settings.agentReadFallbackTokens,
  }, 0, count);
  assertLiveStage_ACU(input, snapshot);
  if (!decision.allowed) fail_ACU(`投影 ID 预算拒绝:${decision.reason}`);
}

export async function runWorldProjectionStage_ACU(input: WorldProjectionStageInput_ACU): Promise<WorldProjectionStageResult_ACU> {
  const snapshot = snapshotStage_ACU(input);
  assertLiveStage_ACU(input, snapshot);
  requireProtocol_ACU(snapshot.identity);
  nonEmptyText_ACU(snapshot.anchorText, 'anchorText 不能为空');
  assertAnchorIntegrity_ACU(snapshot.identity, snapshot.targetAnchor);
  const scene = exactLocation_ACU(snapshot.sceneLocation);
  const player = exactLocation_ACU(snapshot.ledger.player.location);
  if (!scene) return issueReceipt_ACU(snapshot, [], []);
  if (!snapshot.trustedNarrativeScene && (!player || !sameLocation_ACU(scene, player))) {
    fail_ACU('sceneLocation 必须与 ledger.player.location 精确一致');
  }
  let jointSemanticReviews: ReadonlyMap<string, boolean> | undefined;
  if (snapshot.narrativeReviewReceipt) {
    const reviewedScene = readWorldNarrativeScene_ACU(snapshot.narrativeReviewReceipt, {
      ledger: input.ledger, anchor: input.targetAnchor, anchorText: input.anchorText, signal: input.signal,
      assertCurrent: () => { if (!input.isCurrent()) throw new Error('WORLD_PROJECTION_STAGE_INVALID:运行租约已失效'); },
    });
    if (!reviewedScene.sceneLocation || !sameLocation_ACU(scene, reviewedScene.sceneLocation)
      || fingerprint_ACU(snapshot.contacts) !== fingerprint_ACU([...reviewedScene.contactedActorIds].sort())) {
      fail_ACU('联合审查回执的场景或实际接触与投影输入不一致');
    }
    jointSemanticReviews = readWorldNarrativeSemanticReviews_ACU(snapshot.narrativeReviewReceipt, {
      ledger: input.ledger, anchor: input.targetAnchor, anchorText: input.anchorText, signal: input.signal,
      assertCurrent: () => { if (!input.isCurrent()) throw new Error('WORLD_PROJECTION_STAGE_INVALID:运行租约已失效'); },
    });
  }
  const time = { day: snapshot.ledger.clock.day, slot: snapshot.ledger.clock.slot };
  const facts = structuredClone(snapshot.ledger.facts).sort((left, right) => left.id.localeCompare(right.id));
  const allFacts = [...facts, ...(snapshot.ledger.factArchive ?? [])];
  const sceneFactIds = facts.filter(fact => matchesSceneFact_ACU(fact, time, scene, allFacts)).map(fact => fact.id);
  // 已持久化的 gated 解锁事实必须重新以当前完整账本、场景和正文链签发 receipt；不复用 locked 时的 receipt。
  const persistedGatedFactIds = facts.filter(fact => matchesPersistedGatedFact_ACU(fact, time, scene, allFacts)).map(fact => fact.id);
  const semanticCandidates = facts.flatMap(fact => {
    if (fact.projectionPolicy !== 'gated' || fact.revealState !== 'locked'
      || !isWorldFactEstablishedAt_ACU(fact, time) || isSuperseded_ACU(fact, allFacts, time)) return [];
    const gate = checkWorldFactRevealGate_ACU(snapshot.ledger, fact.id, time, scene, snapshot.contacts);
    return gate.status === 'semantic-review-required' ? [{ factId: gate.factId, semanticCondition: gate.semanticCondition, structuralConditions: { gateVerified: true, exactSceneVerified: true, candidateTimeVerified: true } }] : [];
  });
  const countBase = input.countTokens ?? countWorldSimulationTokens_ACU;
  const count: WorldSimulationTokenCounter_ACU = async text => {
    assertLiveStage_ACU(input, snapshot);
    const result = await countBase(text);
    assertLiveStage_ACU(input, snapshot);
    if (!Number.isFinite(result) || result <= 0) fail_ACU('令牌计数结果非法');
    return result;
  };
  const reviewed = new Set<string>();
  if (jointSemanticReviews) {
    for (const candidate of semanticCandidates) {
      if (!jointSemanticReviews.has(candidate.factId)) fail_ACU('联合语义审查未覆盖当前结构候选 ID');
      if (jointSemanticReviews.get(candidate.factId)) reviewed.add(candidate.factId);
    }
  } else {
    const role = snapshot.identity.workflowMode === 'single' ? 'undercurrent-analyst' : 'guidance-composer';
    const preset = resolveWorldSimulationAgentApiPreset_ACU(snapshot.settings, role, 'agent_loop');
    for (const page of chunks_ACU(semanticCandidates)) {
      assertLiveStage_ACU(input, snapshot);
      const messages = appendWorldRoundPromptMessages_ACU([
        { role: 'system', content: `你是格林推演 ${role}，执行只读正文投影语义审查。只返回严格 JSON：{"reviews":[{"factId":string,"triggered":boolean,"evidence":[{"quote":string}]}]}。reviews 必须恰好覆盖 candidates 每个 ID 一次，不得附加字段或调用工具。只有 anchorText 真正满足 semanticCondition 才可 triggered=true；地点或接触不自动证明，任何不确定一律 false。true 的 quote 必须是正文精确连续非空片段，false 的 evidence 必须为空；引文只证明出现，不能替代语义判断。` },
        { role: 'user', content: JSON.stringify({ stage: 'world-projection-semantic-review-v1', clock: time, scene, anchorText: snapshot.anchorText, candidates: page }) },
      ], snapshot.settings, 'projection-review');
      const sent = await executeWorldSimulationFinalRequest_ACU({ messages, historyBudgetTokens: snapshot.settings.agentHistoryTokenBudget, inputLimitTokens: snapshot.settings.agentHistoryTokenBudget, tools: [], count,
        invoke: async requestMessages => {
          assertLiveStage_ACU(input, snapshot);
          const response = await input.invoke(role, requestMessages, preset, { tools: [], cacheTools: ['world-projection-semantic-review-v1'] });
          assertLiveStage_ACU(input, snapshot);
          return response;
        },
      });
      assertLiveStage_ACU(input, snapshot);
      if (sent.status === 'rejected') fail_ACU(`语义审查预算拒绝:${sent.reason}`);
      for (const id of parseSemanticReviews_ACU(modelText_ACU(sent.response), page.map(item => item.factId), snapshot.anchorText)) reviewed.add(id);
    }
  }
  const revealFactIds = [...reviewed].sort();
  const factIds = stableIds_ACU([...sceneFactIds, ...persistedGatedFactIds, ...revealFactIds], '投影事实 ID 重复');
  await gateIds_ACU(factIds, snapshot, input, count);
  return issueReceipt_ACU(snapshot, factIds, revealFactIds);
}
function issueReceipt_ACU(snapshot: StageSnapshot_ACU, factIds: string[], revealFactIds: string[]): WorldProjectionStageResult_ACU {
  const receipt: WorldProjectionReviewReceipt_ACU = Object.freeze({});
  receiptBindings_ACU.set(receipt, {
    ledgerFingerprint: fingerprint_ACU(snapshot.ledger), identityFingerprint: identityFingerprint_ACU(snapshot.identity), anchorFingerprint: anchorFingerprint_ACU(snapshot.targetAnchor), anchorTextFingerprint: fingerprint_ACU(snapshot.anchorText),
    clockFingerprint: fingerprint_ACU(snapshot.ledger.clock), sceneFingerprint: fingerprint_ACU(snapshot.sceneLocation), sceneLocation: exactLocation_ACU(snapshot.sceneLocation), contactFingerprint: fingerprint_ACU(snapshot.contacts), configFingerprint: fingerprint_ACU(readConfig_ACU(snapshot.settings)), factIds: [...factIds], revealFactIds: [...revealFactIds], claimed: false,
  });
  return { factIds: [...factIds], revealFactIds: [...revealFactIds], receipt, summary: `已完成 ${factIds.length} 条受限投影选择；未记录投送或采用。` };
}

function snapshotRead_ACU(input: ReadReviewedWorldProjectionFactsInput_ACU): StageSnapshot_ACU {
  const snapshot = snapshotStage_ACU(input);
  snapshot.readClock = structuredClone(input.clock);
  snapshot.fingerprints.clock = fingerprint_ACU(input.clock);
  return snapshot;
}
function assertLiveRead_ACU(input: ReadReviewedWorldProjectionFactsInput_ACU, snapshot: StageSnapshot_ACU): void {
  assertLiveStage_ACU(input, snapshot);
  if (fingerprint_ACU(input.clock) !== snapshot.fingerprints.clock) fail_ACU('异步期间读取 clock 已变化');
}

async function readReviewedWorldProjectionFactsInternal_ACU(input: ReadReviewedWorldProjectionFactsInput_ACU, allowEmptyScene = false): Promise<ReviewedWorldProjectionFactSet_ACU> {
  if (!input.receipt || typeof input.receipt !== 'object') fail_ACU('回执类型非法');
  const binding = receiptBindings_ACU.get(input.receipt);
  if (!binding || binding.claimed) fail_ACU('回执并非本阶段签发、已失效或已领取');
  const snapshot = snapshotRead_ACU(input);
  assertLiveRead_ACU(input, snapshot);
  requireProtocol_ACU(snapshot.identity);
  nonEmptyText_ACU(snapshot.anchorText, '读取 anchorText 不能为空');
  assertAnchorIntegrity_ACU(snapshot.identity, snapshot.targetAnchor);
  const scene = exactLocation_ACU(snapshot.sceneLocation);
  if (!scene && !(allowEmptyScene && binding.factIds.length === 0 && binding.revealFactIds.length === 0 && binding.sceneLocation === null)) fail_ACU('读取缺少可信精确场景地点');
  if (fingerprint_ACU(snapshot.readClock) !== fingerprint_ACU(snapshot.ledger.clock)) fail_ACU('读取 clock 不是物化账本时钟');
  if (binding.ledgerFingerprint !== fingerprint_ACU(snapshot.ledger) || binding.identityFingerprint !== identityFingerprint_ACU(snapshot.identity)
    || binding.anchorFingerprint !== anchorFingerprint_ACU(snapshot.targetAnchor) || binding.anchorTextFingerprint !== fingerprint_ACU(snapshot.anchorText)
    || binding.clockFingerprint !== fingerprint_ACU(snapshot.ledger.clock) || binding.sceneFingerprint !== fingerprint_ACU(snapshot.sceneLocation)
    || binding.contactFingerprint !== fingerprint_ACU(snapshot.contacts) || binding.configFingerprint !== fingerprint_ACU(readConfig_ACU(snapshot.settings))) fail_ACU('回执绑定已变化，拒绝读取');
  const byId = new Map(snapshot.ledger.facts.map(fact => [fact.id, fact]));
  const facts = binding.factIds.map(id => byId.get(id)).filter((fact): fact is WorldFact_ACU => !!fact);
  if (facts.length !== binding.factIds.length) fail_ACU('回执事实不在当前物化账本中');
  validateReadConfig_ACU(snapshot.settings);
  binding.claimed = true;
  const countBase = input.countTokens ?? countWorldSimulationTokens_ACU;
  const count: WorldSimulationTokenCounter_ACU = async text => {
    assertLiveRead_ACU(input, snapshot);
    const result = await countBase(text);
    assertLiveRead_ACU(input, snapshot);
    if (!Number.isFinite(result) || result <= 0) fail_ACU('正文读取令牌计数非法');
    return result;
  };
  const decision = await gateWorldSimulationReadBatch_ACU([{ label: 'reviewed-world-projection-facts', text: JSON.stringify({ facts }) }], createWorldSimulationReadGateState_ACU(), {
    historyTokenBudget: snapshot.settings.agentHistoryTokenBudget, readTokenBudget: snapshot.settings.agentReadTokenBudget, fallbackTokens: snapshot.settings.agentReadFallbackTokens,
  }, 0, count);
  assertLiveRead_ACU(input, snapshot);
  if (!decision.allowed) fail_ACU(`正文读取超过整包预算:${decision.reason}`);
  return { facts: structuredClone(facts), factIds: [...binding.factIds], revealFactIds: [...binding.revealFactIds], summary: `已在完整读取预算内返回 ${facts.length} 条确定事实；未写 projection、delivery 或 revealState。` };
}

export function readReviewedWorldProjectionFacts_ACU(input: ReadReviewedWorldProjectionFactsInput_ACU): Promise<ReviewedWorldProjectionFactSet_ACU> {
  return readReviewedWorldProjectionFactsInternal_ACU(input);
}

/**
 * 将已完成的受限全文读取收窄为只可被后续候选消费一次的事实 ID 授权。
 * proof 不含事实正文、摘要或任何可序列化的签名字段。
 */
function issueRevealProof_ACU(
  input: ReadReviewedWorldProjectionFactsInput_ACU, snapshot: StageSnapshot_ACU, reviewed: ReviewedWorldProjectionFactSet_ACU,
): { proof: WorldFactRevealProof_ACU; factIds: string[] } {
  const factIds = stableIds_ACU(reviewed.revealFactIds, '揭示事实 ID 必须为不重复非空 ID');
  if (!factIds.length) fail_ACU('没有已审核的 gated 揭示事实可签发 proof');
  const returnedIds = new Set(reviewed.facts.map(fact => fact.id));
  const scene = exactLocation_ACU(snapshot.sceneLocation);
  if (!scene) fail_ACU('proof 缺少可信精确场景地点');
  if (fingerprint_ACU(snapshot.readClock) !== fingerprint_ACU(snapshot.ledger.clock)) fail_ACU('proof clock 不是物化账本时钟');
  for (const id of factIds) {
    const fact = snapshot.ledger.facts.find(item => item.id === id);
    if (!fact || !returnedIds.has(id) || fact.projectionPolicy !== 'gated' || fact.revealState !== 'locked'
      || checkWorldFactRevealGate_ACU(snapshot.ledger, id, candidateTime_ACU(snapshot.ledger.clock), scene, snapshot.contacts).status !== 'semantic-review-required') {
      fail_ACU('proof 事实不再是当前时地有效的 locked gated 审核事实');
    }
  }
  assertLiveRead_ACU(input, snapshot);
  const proof: WorldFactRevealProof_ACU = Object.freeze({});
  revealProofBindings_ACU.set(proof, {
    ledgerFingerprint: fingerprint_ACU(snapshot.ledger), identityFingerprint: identityFingerprint_ACU(snapshot.identity), anchorFingerprint: anchorFingerprint_ACU(snapshot.targetAnchor), anchorTextFingerprint: fingerprint_ACU(snapshot.anchorText),
    clockFingerprint: fingerprint_ACU(snapshot.ledger.clock), sceneFingerprint: fingerprint_ACU(scene), sceneLocation: structuredClone(scene), contactFingerprint: fingerprint_ACU(snapshot.contacts), configFingerprint: fingerprint_ACU(readConfig_ACU(snapshot.settings)),
    contacts: [...snapshot.contacts], factIds, claimed: false,
  });
  return { proof, factIds: [...factIds] };
}

export async function prepareWorldFactRevealProof_ACU(input: ReadReviewedWorldProjectionFactsInput_ACU): Promise<{ proof: WorldFactRevealProof_ACU; factIds: string[] }> {
  const snapshot = snapshotRead_ACU(input);
  assertLiveRead_ACU(input, snapshot);
  const reviewed = await readReviewedWorldProjectionFacts_ACU(input);
  assertLiveRead_ACU(input, snapshot);
  return issueRevealProof_ACU(input, snapshot, reviewed);
}

export async function prepareWorldBodyProjection_ACU(input: ReadReviewedWorldProjectionFactsInput_ACU): Promise<{
  proof: WorldBodyProjectionProof_ACU; factIds: string[]; reveal?: { proof: WorldFactRevealProof_ACU; factIds: string[] };
}> {
  const snapshot = snapshotRead_ACU(input);
  assertLiveRead_ACU(input, snapshot);
  const reviewed = await readReviewedWorldProjectionFactsInternal_ACU(input, true);
  assertLiveRead_ACU(input, snapshot);
  const factIds = stableIds_ACU(reviewed.factIds, '正文事实 ID 必须为不重复非空 ID');
  const returnedIds = stableIds_ACU(reviewed.facts.map(fact => fact.id), '已读取事实 ID 必须为不重复非空 ID');
  if (factIds.length !== returnedIds.length || factIds.some((id, index) => id !== returnedIds[index])) fail_ACU('正文事实未完整读取');
  const reveal = reviewed.revealFactIds.length ? issueRevealProof_ACU(input, snapshot, reviewed) : undefined;
  assertLiveRead_ACU(input, snapshot);
  const proof: WorldBodyProjectionProof_ACU = Object.freeze({});
  bodyProofBindings_ACU.set(proof, {
    ledgerFingerprint: bodyLedgerFingerprint_ACU(snapshot.ledger), identityFingerprint: identityFingerprint_ACU(snapshot.identity),
    anchorFingerprint: anchorFingerprint_ACU(snapshot.targetAnchor), factIds, claimed: false,
  });
  return { proof, factIds: [...factIds], ...(reveal ? { reveal } : {}) };
}

export function claimWorldBodyProjection_ACU(
  proof: WorldBodyProjectionProof_ACU, previewLedger: WorldSimulationLedger_ACU,
  identity: WorldSimulationRunIdentity_ACU, targetAnchor: WorldSimulationTargetAnchor_ACU,
): string[] {
  if (!proof || typeof proof !== 'object') fail_ACU('body proof 类型非法');
  const binding = bodyProofBindings_ACU.get(proof);
  if (!binding || binding.claimed) fail_ACU('body proof 并非本阶段签发、已失效或已领取');
  try {
    if (binding.identityFingerprint !== identityFingerprint_ACU(identity) || binding.anchorFingerprint !== anchorFingerprint_ACU(targetAnchor)
      || !sameTargetFloor_ACU(identity, targetAnchor)) {
      fail_ACU('body proof 身份或锚点绑定不一致');
    }
    if (binding.ledgerFingerprint !== bodyLedgerFingerprint_ACU(previewLedger)) fail_ACU('body proof 账本预览已变化');
    const ids = stableIds_ACU(previewLedger.facts.map(fact => fact.id), '预览事实 ID 必须为不重复非空 ID');
    if (binding.factIds.some(id => !ids.includes(id))) fail_ACU('body proof 事实 ID 已变化');
    return [...binding.factIds];
  } finally {
    binding.claimed = true;
  }
}

/**
 * 领取纯内存 proof。该许可不证明宿主 contact 来源可信，也不将模型引文提升为程序语义真值。
 */
export function claimWorldFactRevealProof_ACU(
  proof: WorldFactRevealProof_ACU,
  previewLedger: WorldSimulationLedger_ACU,
  factIds: readonly string[],
  identity: WorldSimulationRunIdentity_ACU,
  targetAnchor: WorldSimulationTargetAnchor_ACU,
): void {
  if (!proof || typeof proof !== 'object') fail_ACU('proof 类型非法');
  const binding = revealProofBindings_ACU.get(proof);
  if (!binding || binding.claimed) fail_ACU('proof 并非本阶段签发、已失效或已领取');
  // 真 proof 的首次领取尝试（包括身份不匹配）均在返回前消耗；伪造 proof 则没有可消耗的绑定。
  try {
    if (binding.identityFingerprint !== identityFingerprint_ACU(identity) || binding.anchorFingerprint !== anchorFingerprint_ACU(targetAnchor)
      || !sameTargetFloor_ACU(identity, targetAnchor)) {
      fail_ACU('proof 身份或锚点绑定不一致');
    }
    const claimedIds = stableIds_ACU(factIds, '领取事实 ID 必须为不重复非空 ID');
    if (claimedIds.length !== binding.factIds.length || claimedIds.some((id, index) => id !== binding.factIds[index])) fail_ACU('proof 事实 ID 不一致');
    if (binding.ledgerFingerprint !== fingerprint_ACU(previewLedger)) fail_ACU('proof 账本预览已变化');
    const scene = binding.sceneLocation;
    if (binding.clockFingerprint !== fingerprint_ACU(previewLedger.clock)) {
      fail_ACU('proof 候选时钟或场景已变化');
    }
    for (const id of binding.factIds) {
      const fact = previewLedger.facts.find(item => item.id === id);
      if (!fact || fact.projectionPolicy !== 'gated' || fact.revealState !== 'locked'
        || checkWorldFactRevealGate_ACU(previewLedger, id, candidateTime_ACU(previewLedger.clock), scene, binding.contacts).status !== 'semantic-review-required') {
        fail_ACU('proof 事实不再是当前时地有效的 locked gated 事实');
      }
    }
  } finally {
    binding.claimed = true;
  }
}
