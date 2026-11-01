import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { validateWorldSimulationLedger_ACU } from '../simulation-store';
import { buildDefaultWorldSimulationSettings_ACU } from '../defaults';
import { checkWorldFactRevealGate_ACU, isWorldFactEstablishedAt_ACU } from '../world-fact-gate';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import type { WorldFact_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU, WorldSimulationSettings_ACU, WorldTime_ACU } from '../model';
import { appendWorldRoundPromptMessages_ACU } from './world-round-prompts';
import type { WorldSimulationTargetAnchor_ACU } from './agent-model';
import {
  WORLD_FACT_PRUNE_DUTY_ACU, parseWorldEventPruneIds_ACU, parseWorldFactPruneIds_ACU,
  type WorldEventPruneCandidate_ACU, type WorldFactPruneCandidate_ACU,
} from '../world-fact-prune';
import {
  extractWorldHistoryReply_ACU, halveWorldHistoryReviewMaterials_ACU, hasWorldHistoryChanges_ACU, hasWorldHistoryReviewWork_ACU,
  worldHistoryReviewDuty_ACU, worldHistoryReviewFields_ACU, worldHistoryReviewItemCount_ACU, worldHistoryReviewRuntimeContext_ACU,
  worldHistoryReviewTaskItems_ACU, type WorldHistoryReply_ACU, type WorldHistoryReviewMaterials_ACU,
} from '../world-history-review';

const WORLD_NARRATIVE_SCENE_REVIEW_DIRECTORY_LIMIT_ACU = 64;
const WORLD_NARRATIVE_SCENE_REVIEW_QUOTE_LIMIT_ACU = 320;
const WORLD_NARRATIVE_SCENE_REVIEW_EVIDENCE_LIMIT_ACU = 8;

export type WorldNarrativeSceneReceipt_ACU = object;

export interface ReviewWorldNarrativeSceneInput_ACU {
  ledger: WorldSimulationLedger_ACU;
  anchor: WorldSimulationTargetAnchor_ACU;
  anchorText: string;
  /** 可选且仅绑定本次审查的冻结整轮角色提示词；不从全局设置读取。 */
  settings?: Pick<WorldSimulationSettings_ACU, 'worldRoundPrompts'> & Partial<Pick<WorldSimulationSettings_ACU, 'agentHistoryTokenBudget'>>;
  signal: AbortSignal;
  assertCurrent(): void;
  invoke(messages: readonly { role: string; content: string }[]): Promise<string>;
  countTokens?: (text: string) => Promise<number>;
  /** scene-only 调用可显式关闭 gated semantic 审查；默认保留联合审查。 */
  needsSemanticReview?: boolean;
  /** 联合审查顺带判断的“内部管理事实”可清理候选；为空或缺省时请求与协议保持原样。 */
  pruneCandidates?: readonly WorldFactPruneCandidate_ACU[];
  /** 联合审查顺带判断的“已结束世界事件”可清理候选；与事实目录共享输入预算。 */
  pruneEventCandidates?: readonly WorldEventPruneCandidate_ACU[];
  /** 联合审查顺带处理的重要历史资料（本轮变化、已有历史目录、可标记正文记录的历史）；与清理目录共享输入预算。 */
  history?: WorldHistoryReviewMaterials_ACU;
}

/** 联合审查回复里的历史部分（尚未结构校验）以及实际提供给模型的资料（折半后）。 */
export interface WorldHistoryReviewOutcome_ACU {
  reply: WorldHistoryReply_ACU;
  offered: WorldHistoryReviewMaterials_ACU;
}

export interface ReadWorldNarrativeSceneInput_ACU {
  ledger: WorldSimulationLedger_ACU;
  anchor: WorldSimulationTargetAnchor_ACU;
  anchorText: string;
  signal: AbortSignal;
  assertCurrent(): void;
}

type SceneReviewSnapshot_ACU = {
  ledger: WorldSimulationLedger_ACU;
  anchor: WorldSimulationTargetAnchor_ACU;
  anchorText: string;
  settings?: Pick<WorldSimulationSettings_ACU, 'worldRoundPrompts'> & Partial<Pick<WorldSimulationSettings_ACU, 'agentHistoryTokenBudget'>>;
  fingerprints: { ledger: string; anchor: string; anchorText: string; settings: string };
};
type SceneReviewBinding_ACU = SceneReviewSnapshot_ACU & {
  sceneLocation: WorldLocationRef_ACU | null;
  contactedActorIds: string[];
  time: WorldTime_ACU;
  /** 仅可从本模块签发回执读取，绝不接受 caller 自带 reviews。 */
  semanticReviews: ReadonlyMap<string, boolean>;
};
type SceneReviewEvidence_ACU = {
  kind: 'location' | 'contact';
  actorId: string | null;
  quote: string;
};

const sceneReviewBindings_ACU = new WeakMap<object, SceneReviewBinding_ACU>();

function fail_ACU(reason: string): never {
  throw new Error(`WORLD_NARRATIVE_SCENE_REVIEW_INVALID:${reason}`);
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize_ACU(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize_ACU);
  if (isRecord_ACU(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize_ACU(value[key])]));
  return value;
}

function fingerprint_ACU(value: unknown): string {
  return sha256HexSync_ACU(JSON.stringify(canonicalize_ACU(value)));
}
function anchorFingerprint_ACU(anchor: WorldSimulationTargetAnchor_ACU): string {
  const { contentDigest: _digest, ...floorAnchor } = anchor;
  return fingerprint_ACU(floorAnchor);
}

function deepFreeze_ACU<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze_ACU(child);
  }
  return value;
}

function assertLive_ACU(input: Pick<ReviewWorldNarrativeSceneInput_ACU, 'signal' | 'assertCurrent'>): void {
  if (input.signal.aborted) fail_ACU('运行已取消');
  try { input.assertCurrent(); } catch { fail_ACU('运行租约已失效'); }
  if (input.signal.aborted) fail_ACU('运行已取消');
}

function validateLedger_ACU(raw: WorldSimulationLedger_ACU): WorldSimulationLedger_ACU {
  try { return validateWorldSimulationLedger_ACU(raw, 'load'); } catch { fail_ACU('账本结构非法'); }
}

function snapshot_ACU(input: Pick<ReviewWorldNarrativeSceneInput_ACU, 'ledger' | 'anchor' | 'anchorText' | 'settings'>): SceneReviewSnapshot_ACU {
  if (typeof input.anchorText !== 'string' || !input.anchorText.trim()) fail_ACU('冻结正文不能为空');
  const ledger = structuredClone(validateLedger_ACU(input.ledger));
  const anchor = structuredClone(input.anchor);
  const settings = input.settings === undefined ? undefined : deepFreeze_ACU(structuredClone(input.settings));
  return {
    ledger,
    anchor,
    anchorText: input.anchorText,
    settings,
    fingerprints: {
      ledger: fingerprint_ACU(ledger),
      anchor: anchorFingerprint_ACU(anchor),
      anchorText: fingerprint_ACU(input.anchorText),
      settings: fingerprint_ACU(settings),
    },
  };
}

function assertSnapshotUnchanged_ACU(
  input: Pick<ReviewWorldNarrativeSceneInput_ACU, 'ledger' | 'anchor' | 'anchorText' | 'settings' | 'signal' | 'assertCurrent'>,
  snapshot: SceneReviewSnapshot_ACU,
): void {
  assertLive_ACU(input);
  if (fingerprint_ACU(input.ledger) !== snapshot.fingerprints.ledger
    || anchorFingerprint_ACU(input.anchor) !== snapshot.fingerprints.anchor
    || fingerprint_ACU(input.anchorText) !== snapshot.fingerprints.anchorText
    || fingerprint_ACU(input.settings) !== snapshot.fingerprints.settings) {
    fail_ACU('异步期间完整账本、锚点、冻结正文或审查提示词已变化');
  }
}

function validLocation_ACU(value: unknown): WorldLocationRef_ACU | null {
  if (!isRecord_ACU(value)
    || typeof value.region !== 'string' || typeof value.place !== 'string'
    || !value.region.trim() || !value.place.trim()
    || value.region.length > 160 || value.place.length > 160
    || value.region.length + value.place.length > 160) return null;
  return { region: value.region, place: value.place };
}

function locationKey_ACU(location: WorldLocationRef_ACU): string {
  return JSON.stringify([location.region, location.place]);
}

function directoryLocations_ACU(ledger: WorldSimulationLedger_ACU, anchorText: string): WorldLocationRef_ACU[] {
  const candidates: Array<WorldLocationRef_ACU | null | undefined> = [ledger.player.location];
  const includeIfNarrated = (location: WorldLocationRef_ACU | null | undefined): void => {
    const valid = validLocation_ACU(location);
    if (valid && (anchorText.includes(valid.region) || anchorText.includes(valid.place))) candidates.push(valid);
  };
  for (const actor of ledger.actors) includeIfNarrated(actor.locationRef);
  for (const seed of ledger.seeds) includeIfNarrated(seed.location);
  for (const event of ledger.worldEvents) for (const location of event.locationRefs) includeIfNarrated(location);
  for (const fact of ledger.facts) includeIfNarrated(fact.locationRef);
  const seen = new Set<string>();
  const result: WorldLocationRef_ACU[] = [];
  for (const candidate of candidates) {
    const location = validLocation_ACU(candidate);
    if (!location || seen.has(locationKey_ACU(location))) continue;
    seen.add(locationKey_ACU(location));
    result.push(location);
  }
  return result.slice(0, WORLD_NARRATIVE_SCENE_REVIEW_DIRECTORY_LIMIT_ACU);
}

function directoryActors_ACU(ledger: WorldSimulationLedger_ACU, anchorText: string): Array<{ id: string; name: string }> {
  const playerLocation = validLocation_ACU(ledger.player.location);
  const candidates = ledger.actors
    .filter(actor => typeof actor.id === 'string' && actor.id.trim() && typeof actor.name === 'string' && actor.name.trim())
    .map(actor => ({
      id: actor.id,
      name: actor.name,
      mentioned: anchorText.includes(actor.name),
      atPlayerLocation: !!playerLocation && !!validLocation_ACU(actor.locationRef)
        && locationKey_ACU(playerLocation) === locationKey_ACU(validLocation_ACU(actor.locationRef)!),
    }))
    .sort((left, right) => Number(right.mentioned) - Number(left.mentioned)
      || Number(right.atPlayerLocation) - Number(left.atPlayerLocation)
      || left.id.localeCompare(right.id));
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string }> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    result.push({ id: candidate.id, name: candidate.name });
    if (result.length === WORLD_NARRATIVE_SCENE_REVIEW_DIRECTORY_LIMIT_ACU) break;
  }
  return result;
}

function validateTime_ACU(ledger: WorldSimulationLedger_ACU): WorldTime_ACU {
  if (!Number.isSafeInteger(ledger.clock.day) || ledger.clock.day < 1 || typeof ledger.clock.slot !== 'string') fail_ACU('账本时钟非法');
  return { day: ledger.clock.day, slot: ledger.clock.slot };
}

async function safelyAwait_ACU<T>(
  operation: () => Promise<T>, input: ReviewWorldNarrativeSceneInput_ACU, snapshot: SceneReviewSnapshot_ACU, failure: string,
): Promise<T> {
  assertSnapshotUnchanged_ACU(input, snapshot);
  try {
    const result = await operation();
    assertSnapshotUnchanged_ACU(input, snapshot);
    return result;
  } catch {
    assertSnapshotUnchanged_ACU(input, snapshot);
    fail_ACU(failure);
  }
}

async function countPositiveTokens_ACU(
  text: string,
  input: ReviewWorldNarrativeSceneInput_ACU,
  snapshot: SceneReviewSnapshot_ACU,
  count: WorldSimulationTokenCounter_ACU,
): Promise<number> {
  assertSnapshotUnchanged_ACU(input, snapshot);
  const tokens = await safelyAwait_ACU(() => count(text), input, snapshot, '令牌计数调用失败');
  if (!Number.isFinite(tokens) || tokens <= 0) fail_ACU('令牌计数必须为正的有限数');
  return Math.ceil(tokens);
}

type SafeSemanticCandidate_ACU = {
  factId: string;
  semanticCondition: string;
  structuralConditions: Record<string, unknown>;
};

function isSuperseded_ACU(fact: WorldFact_ACU, facts: readonly WorldFact_ACU[], time: WorldTime_ACU): boolean {
  return facts.some(next => next.supersedesFactIds.includes(fact.id) && isWorldFactEstablishedAt_ACU(next, time));
}

/**
 * 场景未知时不以旧 player 地点预拒绝。仅把 gate 自身声明的地点/人物作为潜在结构输入，
 * 复用正式 gate 完成时间、事件及引用事实过滤；联合场景返回后仍由 projection 以实际输入重核。
 */
function safeSemanticCandidates_ACU(ledger: WorldSimulationLedger_ACU, time: WorldTime_ACU): SafeSemanticCandidate_ACU[] {
  const allFacts = [...ledger.facts, ...(ledger.factArchive ?? [])];
  return ledger.facts.flatMap(fact => {
    if (fact.projectionPolicy !== 'gated' || fact.revealState !== 'locked'
      || !isWorldFactEstablishedAt_ACU(fact, time) || isSuperseded_ACU(fact, allFacts, time)
      || !isRecord_ACU(fact.revealGate) || typeof fact.revealGate.semanticCondition !== 'string'
      || !fact.revealGate.semanticCondition.trim()) return [];
    const gate = fact.revealGate as Record<string, unknown>;
    const potentialScene = validLocation_ACU(gate.locationRef) ?? null;
    const potentialContacts = Array.isArray(gate.actorIds) && gate.actorIds.every(id => typeof id === 'string')
      ? gate.actorIds : [];
    if (checkWorldFactRevealGate_ACU(ledger, fact.id, time, potentialScene, potentialContacts).status !== 'semantic-review-required') return [];
    const structuralConditions = Object.fromEntries(Object.entries(gate)
      .filter(([key]) => key !== 'semanticCondition')
      .map(([key, value]) => [key, structuredClone(value)]));
    return [{ factId: fact.id, semanticCondition: String(gate.semanticCondition), structuralConditions }];
  }).sort((left, right) => left.factId.localeCompare(right.factId));
}

/** body 联合审查固定协议中追加的清理与历史字段说明；各类资料都不存在时不追加任何内容。 */
function pruneProtocol_ACU(
  facts: readonly WorldFactPruneCandidate_ACU[], events: readonly WorldEventPruneCandidate_ACU[],
  history?: WorldHistoryReviewMaterials_ACU,
): string {
  const historyDuty = worldHistoryReviewDuty_ACU(hasWorldHistoryReviewWork_ACU(history) ? history : undefined);
  if (!facts.length && !events.length && !historyDuty) return '';
  const fields = [...(facts.length ? ['"pruneFactIds":string[]'] : []), ...(events.length ? ['"pruneEventIds":string[]'] : []),
    ...worldHistoryReviewFields_ACU(history)];
  const sources = [...(facts.length ? ['pruneCandidates'] : []), ...(events.length ? ['pruneEventCandidates'] : []),
    ...(history && hasWorldHistoryChanges_ACU(history) ? ['historyChanges'] : []),
    ...(history?.recordingMaterials.length ? ['historyRecordingMaterials'] : [])];
  return ` WORLD_RUNTIME_CONTEXT 含 ${sources.join('、')} 时，同一 JSON 另加 ${fields.join('、')}。${facts.length || events.length ? WORLD_FACT_PRUNE_DUTY_ACU : ''}${historyDuty}`;
}

function pruneTask_ACU(
  facts: readonly WorldFactPruneCandidate_ACU[], events: readonly WorldEventPruneCandidate_ACU[],
  history?: WorldHistoryReviewMaterials_ACU,
): string {
  return (facts.length ? '同时审核 pruneCandidates 中已经无用的内部管理事实，在 pruneFactIds 返回应清理的 id。' : '')
    + (events.length ? '同时审核 pruneEventCandidates 中已经无用的已结束世界事件，在 pruneEventIds 返回应清理的 id。' : '')
    + worldHistoryReviewTaskItems_ACU(history).map(item => `同时${item}。`).join('');
}

function reviewMessages_ACU(
  snapshot: SceneReviewSnapshot_ACU, time: WorldTime_ACU, needsSemanticReview: boolean, inputTokenBudget: number,
  pruneCandidates: readonly WorldFactPruneCandidate_ACU[] = [],
  pruneEventCandidates: readonly WorldEventPruneCandidate_ACU[] = [],
  history?: WorldHistoryReviewMaterials_ACU,
): readonly { role: string; content: string }[] {
  const actors = directoryActors_ACU(snapshot.ledger, snapshot.anchorText);
  const locations = directoryLocations_ACU(snapshot.ledger, snapshot.anchorText);
  const candidates = needsSemanticReview ? safeSemanticCandidates_ACU(snapshot.ledger, time) : [];
  const messages = [{
    role: 'system',
    content: '你执行只读联合正文审查。只能依据冻结正文的明确语义判断地点、实际接触及候选语义条件；目录出现不表示在场或接触。禁止推断目录外事实、调用工具、改写时钟或以模型自报替代结构门槛。只返回严格 JSON：{"locationRef":null|{"region":string,"place":string},"contactedActorIds":string[],"evidence":[{"kind":"location"|"contact","actorId":null|string,"quote":string}],"reviews":[{"factId":string,"triggered":boolean,"evidence":[{"quote":string}]}]}。场景 evidence 与 reviews evidence 都须为冻结正文内精确连续非空片段；每个 candidate 恰好一个 review，true 必有引文，false 必为空。'
      + pruneProtocol_ACU(pruneCandidates, pruneEventCandidates, history),
  }] as const;
  return appendWorldRoundPromptMessages_ACU(messages, { ...snapshot.settings, workflowMode: 'single' }, 'joint-reviewer', {
    stage: 'world-narrative-review-v1',
    materials: {
      WORLD_TASK: {
        stage: 'world-narrative-review-v1',
        task: '联合审查冻结正文中的场景、实际接触与 gated 语义条件；结构门槛由程序在返回后复验。'
          + pruneTask_ACU(pruneCandidates, pruneEventCandidates, history),
      },
      ANCHOR_MESSAGE: snapshot.anchorText,
      WORLD_RUNTIME_CONTEXT: {
        safeActorDirectory: actors, locationDirectory: locations, candidates,
        ...(pruneCandidates.length ? { pruneCandidates } : {}),
        ...(pruneEventCandidates.length ? { pruneEventCandidates } : {}),
        ...worldHistoryReviewRuntimeContext_ACU(history),
      },
      READ_BUDGET: { inputTokenBudget },
    },
  });
}

function parseSingleObject_ACU(raw: string): Record<string, unknown> {
  try {
    const direct: unknown = JSON.parse(raw.trim());
    if (isRecord_ACU(direct)) return direct;
    fail_ACU('模型 JSON 顶层非法');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WORLD_NARRATIVE_SCENE_REVIEW_INVALID:')) throw error;
  }
  // 解释文字或 Markdown fence 可以包裹 JSON，但不能从多个对象中擅选一个。
  const objects: Record<string, unknown>[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (depth > 0 && inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' && depth > 0) { inString = true; continue; }
    if (char === '{') { if (depth++ === 0) start = i; }
    else if (char === '}' && depth > 0 && --depth === 0) {
      try {
        const value: unknown = JSON.parse(raw.slice(start, i + 1));
        if (isRecord_ACU(value)) objects.push(value);
      } catch { /* 非 JSON 的说明文字不能成为审查结果。 */ }
    }
  }
  if (objects.length !== 1) fail_ACU('模型未返回唯一可解析 JSON 对象');
  return objects[0];
}

function groundedQuote_ACU(quote: unknown, anchorText: string): string | null {
  if (typeof quote !== 'string' || !quote.trim() || quote.length > WORLD_NARRATIVE_SCENE_REVIEW_QUOTE_LIMIT_ACU) return null;
  if (anchorText.includes(quote)) return quote;
  // 仅允许空白数量或位置变化；返回冻结正文中的连续原文，不放宽任何非空白字符。
  const characters = Array.from(quote.replace(/\s+/gu, ''));
  if (!characters.length) return null;
  const pattern = characters.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const match = new RegExp(pattern, 'u').exec(anchorText);
  return match?.[0] ?? null;
}

function parseReview_ACU(
  raw: string, anchorText: string, permittedActors: readonly { id: string; name: string }[], candidates: readonly SafeSemanticCandidate_ACU[],
  offeredPruneIds: readonly string[] = [], offeredPruneEventIds: readonly string[] = [],
  offeredHistory?: WorldHistoryReviewMaterials_ACU,
): {
  sceneLocation: WorldLocationRef_ACU | null; contactedActorIds: string[]; semanticReviews: Map<string, boolean>;
  pruneFactIds: string[]; pruneEventIds: string[]; history?: WorldHistoryReviewOutcome_ACU;
} {
  const parsed = parseSingleObject_ACU(raw);
  const normalize = (text: string): string => text.trim().toLocaleLowerCase();
  const ids = new Set(permittedActors.map(actor => actor.id));
  const resolveActor = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (ids.has(value)) return value;
    const byId = permittedActors.filter(actor => normalize(actor.id) === normalize(value));
    if (byId.length === 1) return byId[0].id;
    if (byId.length > 1) return null;
    const byName = permittedActors.filter(actor => normalize(actor.name) === normalize(value));
    return byName.length === 1 ? byName[0].id : null;
  };
  const claimedContacts = new Set((Array.isArray(parsed.contactedActorIds) ? parsed.contactedActorIds : [])
    .map(resolveActor).filter((id): id is string => id !== null));
  const evidence: SceneReviewEvidence_ACU[] = [];
  for (const item of Array.isArray(parsed.evidence) ? parsed.evidence : []) {
    if (!isRecord_ACU(item) || (item.kind !== 'location' && item.kind !== 'contact')) continue;
    const quote = groundedQuote_ACU(item.quote, anchorText);
    if (!quote) continue;
    if (item.kind === 'location') evidence.push({ kind: 'location', actorId: null, quote });
    else {
      const actorId = resolveActor(item.actorId);
      if (actorId) evidence.push({ kind: 'contact', actorId, quote });
    }
  }
  const location = validLocation_ACU(parsed.locationRef);
  const sceneLocation = location && evidence.some(item => item.kind === 'location') ? location : null;
  const contactedActorIds = [...claimedContacts].filter(id => evidence.some(item => item.kind === 'contact' && item.actorId === id));
  const semanticReviews = new Map<string, boolean>(candidates.map(candidate => [candidate.factId, false]));
  for (const review of Array.isArray(parsed.reviews) ? parsed.reviews : []) {
    if (!isRecord_ACU(review) || typeof review.factId !== 'string' || !semanticReviews.has(review.factId)) continue;
    const grounded = Array.isArray(review.evidence) && review.evidence.some(item => isRecord_ACU(item) && groundedQuote_ACU(item.quote, anchorText));
    if (review.triggered === true && grounded) semanticReviews.set(review.factId, true);
  }
  return { sceneLocation, contactedActorIds, semanticReviews, pruneFactIds: parseWorldFactPruneIds_ACU(parsed, offeredPruneIds),
    pruneEventIds: parseWorldEventPruneIds_ACU(parsed, offeredPruneEventIds),
    ...(offeredHistory && hasWorldHistoryReviewWork_ACU(offeredHistory)
      ? { history: { reply: extractWorldHistoryReply_ACU(parsed), offered: offeredHistory } } : {}) };
}

/** 冻结正文场景线索仅形成无宿主证明力的模型语义结论；时钟始终取冻结账本，且不读取秘密内容。 */
export async function reviewWorldNarrativeScene_ACU(input: ReviewWorldNarrativeSceneInput_ACU): Promise<{
  receipt: object;
  sceneLocation: WorldLocationRef_ACU | null;
  contactedActorIds: string[];
  time: WorldTime_ACU;
  source: 'narrative-review';
  /** 联合审查建议清理的内部管理事实 ID（仅限本次提供的目录内），尚未经过程序结构过滤。 */
  pruneFactIds: string[];
  /** 联合审查建议清理的已结束世界事件 ID（仅限本次提供的目录内），尚未经过程序结构过滤。 */
  pruneEventIds: string[];
  /** 联合审查的重要历史回复（未经结构校验）与折半后实际提供的资料；未提供历史职责时缺省。 */
  history?: WorldHistoryReviewOutcome_ACU;
}> {
  const snapshot = snapshot_ACU(input);
  assertSnapshotUnchanged_ACU(input, snapshot);
  const time = validateTime_ACU(snapshot.ledger);
  const needsSemanticReview = input.needsSemanticReview !== false;
  const candidates = needsSemanticReview ? safeSemanticCandidates_ACU(snapshot.ledger, time) : [];
  const inputTokenBudget = snapshot.settings?.agentHistoryTokenBudget ?? buildDefaultWorldSimulationSettings_ACU().agentHistoryTokenBudget;
  let offeredPrune = (input.pruneCandidates ?? []).map(item => structuredClone(item));
  let offeredEvents = (input.pruneEventCandidates ?? []).map(item => structuredClone(item));
  let offeredHistory = input.history === undefined ? undefined : structuredClone(input.history);
  let messages = reviewMessages_ACU(snapshot, time, needsSemanticReview, inputTokenBudget, offeredPrune, offeredEvents, offeredHistory);
  const count = input.countTokens ?? countWorldSimulationTokens_ACU;
  let inputTokens = await countPositiveTokens_ACU(JSON.stringify(messages), input, snapshot, count);
  // 清理与历史目录只是附带职责：超预算时事实、已结束事件、历史资料一起折半，直到场景审查本身能放入预算。
  while (inputTokens > inputTokenBudget
    && (offeredPrune.length || offeredEvents.length || worldHistoryReviewItemCount_ACU(offeredHistory))) {
    offeredPrune = offeredPrune.slice(0, Math.floor(offeredPrune.length / 2));
    offeredEvents = offeredEvents.slice(0, Math.floor(offeredEvents.length / 2));
    if (offeredHistory) offeredHistory = halveWorldHistoryReviewMaterials_ACU(offeredHistory);
    messages = reviewMessages_ACU(snapshot, time, needsSemanticReview, inputTokenBudget, offeredPrune, offeredEvents, offeredHistory);
    inputTokens = await countPositiveTokens_ACU(JSON.stringify(messages), input, snapshot, count);
  }
  if (inputTokens > inputTokenBudget) fail_ACU(`场景审查输入 ${inputTokens} 令牌超过配置的 ${inputTokenBudget} 令牌预算`);
  assertSnapshotUnchanged_ACU(input, snapshot);
  const response = await safelyAwait_ACU(() => input.invoke(messages), input, snapshot, '模型调用失败');
  if (typeof response !== 'string') fail_ACU('模型响应必须是字符串');
  const permittedActors = directoryActors_ACU(snapshot.ledger, snapshot.anchorText);
  const reviewed = parseReview_ACU(response, snapshot.anchorText, permittedActors, candidates,
    offeredPrune.map(item => item.id), offeredEvents.map(item => item.id), offeredHistory);
  assertSnapshotUnchanged_ACU(input, snapshot);
  const receipt: WorldNarrativeSceneReceipt_ACU = Object.freeze({});
  sceneReviewBindings_ACU.set(receipt, {
    ...snapshot,
    sceneLocation: structuredClone(reviewed.sceneLocation),
    contactedActorIds: [...reviewed.contactedActorIds],
    time: structuredClone(time),
    semanticReviews: new Map(reviewed.semanticReviews),
  });
  return {
    receipt,
    sceneLocation: structuredClone(reviewed.sceneLocation),
    contactedActorIds: [...reviewed.contactedActorIds],
    time: structuredClone(time),
    source: 'narrative-review',
    pruneFactIds: [...reviewed.pruneFactIds],
    pruneEventIds: [...reviewed.pruneEventIds],
    ...(reviewed.history ? { history: reviewed.history } : {}),
  };
}

/**
 * 程序在结构过滤后删除内部管理事实、得到新账本时，把已签发回执改绑到新账本。
 * 先以旧账本完整复验回执；新账本必须不含被删事实且时钟不变。语义审查映射随之收缩，
 * 新账本里因删除而重新出现的候选按未触发处理。
 */
export function rebindWorldNarrativeSceneReceipt_ACU(
  receipt: WorldNarrativeSceneReceipt_ACU,
  input: ReadWorldNarrativeSceneInput_ACU & {
    prunedLedger: WorldSimulationLedger_ACU; removedFactIds: readonly string[]; removedEventIds?: readonly string[];
  },
): void {
  readWorldNarrativeScene_ACU(receipt, input);
  const binding = sceneReviewBindings_ACU.get(receipt)!;
  const next = structuredClone(validateLedger_ACU(input.prunedLedger));
  const removed = new Set(input.removedFactIds);
  if (next.facts.some(fact => removed.has(fact.id))) fail_ACU('清理后的账本仍含被删事实');
  const removedEvents = new Set(input.removedEventIds ?? []);
  if (next.worldEvents.some(event => removedEvents.has(event.id))) fail_ACU('清理后的账本仍含被删事件');
  if (fingerprint_ACU(next.clock) !== fingerprint_ACU(binding.ledger.clock)) fail_ACU('清理后的账本时钟已变化');
  const semanticReviews = new Map<string, boolean>();
  for (const candidate of safeSemanticCandidates_ACU(next, binding.time)) {
    semanticReviews.set(candidate.factId, binding.semanticReviews.get(candidate.factId) ?? false);
  }
  sceneReviewBindings_ACU.set(receipt, {
    ...binding, ledger: next, semanticReviews,
    fingerprints: { ...binding.fingerprints, ledger: fingerprint_ACU(next) },
  });
}

export interface ReviewWorldFactPruneInput_ACU {
  candidates: readonly WorldFactPruneCandidate_ACU[];
  /** 已结束世界事件的可清理候选；与事实目录共享预算。 */
  eventCandidates?: readonly WorldEventPruneCandidate_ACU[];
  /** 重要历史资料（本轮变化、已有历史目录、可标记正文记录的历史）；与清理目录共享预算。 */
  history?: WorldHistoryReviewMaterials_ACU;
  /** 冻结正文：判断事实是否仍有意义，并作为正文记录标记与历史总结的依据。 */
  anchorText?: string;
  settings?: Pick<WorldSimulationSettings_ACU, 'worldRoundPrompts'> & Partial<Pick<WorldSimulationSettings_ACU, 'agentHistoryTokenBudget'>>;
  signal: AbortSignal;
  assertCurrent(): void;
  invoke(messages: readonly { role: string; content: string }[]): Promise<string>;
  countTokens?: (text: string) => Promise<number>;
}

/** 仅审查（清理与重要历史）请求使用的阶段名；剧情推进或无目标锚点时单独发起。 */
export const WORLD_REVIEW_MAINTENANCE_STAGE_ACU = 'world-review-maintenance-v1';

function pruneOnlyMessages_ACU(
  input: ReviewWorldFactPruneInput_ACU, candidates: readonly WorldFactPruneCandidate_ACU[],
  events: readonly WorldEventPruneCandidate_ACU[], history: WorldHistoryReviewMaterials_ACU | undefined, inputTokenBudget: number,
): readonly { role: string; content: string }[] {
  const historyDuty = worldHistoryReviewDuty_ACU(hasWorldHistoryReviewWork_ACU(history) ? history : undefined);
  const shape = `{${[...(candidates.length ? ['"pruneFactIds":string[]'] : []), ...(events.length ? ['"pruneEventIds":string[]'] : []),
    ...worldHistoryReviewFields_ACU(history)].join(',')}}`;
  const scope = [...(candidates.length || events.length ? [`内部管理事实清理审查${events.length ? '（含已结束世界事件）' : ''}`] : []),
    ...(historyDuty ? ['重要历史审查'] : [])].join('与');
  const messages = [{
    role: 'system',
    content: `你执行只读的${scope}，本次不审查场景、接触或语义触发条件。禁止调用工具、改写账本或输出解释文字。只返回严格 JSON：${shape}。${candidates.length || events.length ? WORLD_FACT_PRUNE_DUTY_ACU : ''}${historyDuty}`,
  }] as const;
  const anchorText = typeof input.anchorText === 'string' && input.anchorText.trim() ? input.anchorText : undefined;
  return appendWorldRoundPromptMessages_ACU(messages, { ...input.settings, workflowMode: 'single' }, 'joint-reviewer', {
    stage: WORLD_REVIEW_MAINTENANCE_STAGE_ACU,
    materials: {
      WORLD_TASK: { stage: WORLD_REVIEW_MAINTENANCE_STAGE_ACU, task: `只${[
        ...(candidates.length ? ['审核 pruneCandidates 中已经无用的内部管理事实，在 pruneFactIds 返回应清理的 id'] : []),
        ...(events.length ? ['审核 pruneEventCandidates 中已经无用的已结束世界事件，在 pruneEventIds 返回应清理的 id'] : []),
        ...worldHistoryReviewTaskItems_ACU(history),
      ].join('；')}；不做场景与接触审查。` },
      ...(anchorText === undefined ? {} : { ANCHOR_MESSAGE: anchorText }),
      WORLD_RUNTIME_CONTEXT: {
        ...(candidates.length ? { pruneCandidates: candidates } : {}),
        ...(events.length ? { pruneEventCandidates: events } : {}),
        ...worldHistoryReviewRuntimeContext_ACU(history),
      },
      READ_BUDGET: { inputTokenBudget },
    },
  });
}

/**
 * 仅审查的联合审查请求（剧情推进或无目标锚点时使用）：内部事实清理、已结束事件清理、重要历史总结与正文记录标记。
 * 各类目录都空时不发请求。返回目录内的建议 ID 与历史回复；请求失败或回复无法解析时抛错，由调用方决定跳过。
 */
export async function reviewWorldFactPrune_ACU(input: ReviewWorldFactPruneInput_ACU): Promise<{
  pruneFactIds: string[]; pruneEventIds: string[]; offered: number; offeredEvents: number; history?: WorldHistoryReviewOutcome_ACU;
}> {
  if (!input.candidates.length && !input.eventCandidates?.length && !hasWorldHistoryReviewWork_ACU(input.history)) {
    return { pruneFactIds: [], pruneEventIds: [], offered: 0, offeredEvents: 0 };
  }
  assertLive_ACU(input);
  const budget = input.settings?.agentHistoryTokenBudget ?? buildDefaultWorldSimulationSettings_ACU().agentHistoryTokenBudget;
  const count = input.countTokens ?? countWorldSimulationTokens_ACU;
  let offered = input.candidates.map(item => structuredClone(item));
  let offeredEvents = (input.eventCandidates ?? []).map(item => structuredClone(item));
  let offeredHistory = input.history === undefined ? undefined : structuredClone(input.history);
  const measure = async (messages: readonly { role: string; content: string }[]): Promise<number> => {
    assertLive_ACU(input);
    const tokens = await count(JSON.stringify(messages));
    assertLive_ACU(input);
    if (!Number.isFinite(tokens) || tokens <= 0) fail_ACU('令牌计数必须为正的有限数');
    return Math.ceil(tokens);
  };
  const total = (): number => offered.length + offeredEvents.length + worldHistoryReviewItemCount_ACU(offeredHistory);
  let messages = pruneOnlyMessages_ACU(input, offered, offeredEvents, offeredHistory, budget);
  let tokens = await measure(messages);
  while (tokens > budget && total() > 1) {
    // 各类资料共享预算，一起折半；某一类折空后不再出现在请求里。
    offered = offered.slice(0, Math.floor(offered.length / 2));
    offeredEvents = offeredEvents.slice(0, Math.floor(offeredEvents.length / 2));
    if (offeredHistory) offeredHistory = halveWorldHistoryReviewMaterials_ACU(offeredHistory);
    if (!offered.length && !offeredEvents.length && !hasWorldHistoryReviewWork_ACU(offeredHistory)) break;
    messages = pruneOnlyMessages_ACU(input, offered, offeredEvents, offeredHistory, budget);
    tokens = await measure(messages);
  }
  if (tokens > budget) fail_ACU(`审查输入 ${tokens} 令牌超过配置的 ${budget} 令牌预算`);
  const response = await input.invoke(messages);
  assertLive_ACU(input);
  if (typeof response !== 'string') fail_ACU('模型响应必须是字符串');
  const parsed = parseSingleObject_ACU(response);
  return {
    pruneFactIds: parseWorldFactPruneIds_ACU(parsed, offered.map(item => item.id)),
    pruneEventIds: parseWorldEventPruneIds_ACU(parsed, offeredEvents.map(item => item.id)),
    offered: offered.length, offeredEvents: offeredEvents.length,
    ...(offeredHistory && hasWorldHistoryReviewWork_ACU(offeredHistory)
      ? { history: { reply: extractWorldHistoryReply_ACU(parsed), offered: offeredHistory } } : {}),
  };
}

export function readWorldNarrativeSemanticReviews_ACU(
  receipt: WorldNarrativeSceneReceipt_ACU,
  input: ReadWorldNarrativeSceneInput_ACU,
): ReadonlyMap<string, boolean> {
  readWorldNarrativeScene_ACU(receipt, input);
  const binding = sceneReviewBindings_ACU.get(receipt);
  if (!binding) fail_ACU('场景回执并非本审查签发');
  return new Map(binding.semanticReviews);
}

/** 读取签发回执的深拷贝冻结结论，caller 无法借由修改返回值或伪造回执提升权限。 */
export function readWorldNarrativeScene_ACU(
  receipt: WorldNarrativeSceneReceipt_ACU,
  input: ReadWorldNarrativeSceneInput_ACU,
): { sceneLocation: WorldLocationRef_ACU | null; contactedActorIds: string[]; time: WorldTime_ACU; source: 'narrative-review' } {
  if (!receipt || typeof receipt !== 'object') fail_ACU('场景回执类型非法');
  const binding = sceneReviewBindings_ACU.get(receipt);
  if (!binding) fail_ACU('场景回执并非本审查签发');
  assertLive_ACU(input);
  const ledger = validateLedger_ACU(input.ledger);
  if (fingerprint_ACU(ledger) !== binding.fingerprints.ledger
    || anchorFingerprint_ACU(input.anchor) !== binding.fingerprints.anchor
    || fingerprint_ACU(input.anchorText) !== binding.fingerprints.anchorText) fail_ACU('场景回执绑定的完整账本、锚点或冻结正文已变化');
  return {
    sceneLocation: structuredClone(binding.sceneLocation),
    contactedActorIds: [...binding.contactedActorIds],
    time: structuredClone(binding.time),
    source: 'narrative-review',
  };
}
