import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { logError_ACU } from '../../shared/utils';
import { activeWorldActorRoster_ACU } from './actor-completions';
import { gateWorldSimulationReadBatch_ACU, resolveWorldSimulationReadBudget_ACU, type WorldSimulationReadGateConfig_ACU } from './agent/agent-read-gate';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';
import { materializeWorldRoundCandidate_ACU, type WorldRoundCandidate_ACU } from './world-candidate';
import { buildWorldRecallIndex_ACU, queryWorldRecallManifestPage_ACU } from './world-recall-index';
import type { WorldRecallLimits_ACU, WorldRecallManifestPage_ACU } from './world-recall-manifest';
import type { WorldClock_ACU, WorldEvent_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU } from './model';
import { allWorldFacts_ACU } from './fact-archive';

export interface WorldExecutionRecallConfig_ACU { limits: WorldRecallLimits_ACU; read: WorldSimulationReadGateConfig_ACU; actorBatchSize?: number; }
export type WorldExecutionReceipt_ACU = { readonly __worldExecutionReceipt: unique symbol };
export type WorldExecutionOverlayReceipt_ACU = { readonly __worldExecutionOverlayReceipt: unique symbol };
export type WorldExecutionRequest_ACU =
  | { kind: 'world'; pageIndex: number; worldEventIds: readonly string[]; factIds: readonly string[] }
  | { kind: 'actor'; batchIndex: number; historyByActor: Readonly<Record<string, readonly string[]>>; worldEventIds: readonly string[]; factIds: readonly string[] }
  /** 仅供 clock-recaller 在目录后决定最终选择；不占用 world/actor 的业务精读许可，也不能接收 overlay。 */
  | { kind: 'preview'; pageIndex: number; requestKey: string; historyByActor: Readonly<Record<string, readonly string[]>>; worldEventIds: readonly string[]; factIds: readonly string[] };
type Materials_ACU = { actors: WorldSimulationLedger_ACU['actors']; worldEvents: WorldEvent_ACU[]; facts: WorldFact_ACU[]; historyMilestones: WorldHistoryMilestone_ACU[] };
type Failure_ACU = { code: string; reason: string; pageIndex?: number; batchIndex?: number; actorId?: string; eventId?: string; factId?: string; relatedFactId?: string; historyId?: string; snapshot?: 'ledger' | 'clock' | 'location' | 'config' | 'roster'; batch?: number; limit?: number };
export type WorldExecutionReadResult_ACU = { allowed: true; materials: Materials_ACU; tokens: number } | { allowed: false; reason: string; tokens: number; diagnostic?: Failure_ACU };
export type WorldExecutionPrepareResult_ACU = { allowed: true; receipt: WorldExecutionReceipt_ACU; manifests: WorldRecallManifestPage_ACU[]; totalDirectoryTokens: number; peakDirectoryTokens: number } | ({ allowed: false; reason: string; diagnostic: Failure_ACU });
type Frozen_ACU = { fingerprint: string; clock: string; config: string; roster: string[]; actorBatchSize: number; manifests: WorldRecallManifestPage_ACU[]; consumed: Map<string, string | 'claimed'>; successfulWorldReads: Map<string, { eventIds: string[]; factIds: string[] }> };
type Overlay_ACU = { fingerprint: string; clock: string; worldEvents: WorldEvent_ACU[]; facts: WorldFact_ACU[] };
const receipts_ACU = new WeakMap<WorldExecutionReceipt_ACU, Frozen_ACU>();
const overlays_ACU = new WeakMap<WorldExecutionOverlayReceipt_ACU, Overlay_ACU>();
const json_ACU = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const scope_ACU = (clock: WorldClock_ACU, location: WorldLocationRef_ACU | null) => json_ACU([clock.day, clock.slot, clock.storyTime, clock.precision, clock.evidenceRefs, location]);
const fingerprint_ACU = (ledger: WorldSimulationLedger_ACU) => sha256HexSync_ACU(json_ACU(ledger));
const size_ACU = (config: WorldExecutionRecallConfig_ACU) => config.actorBatchSize ?? 24;
const configKey_ACU = (config: WorldExecutionRecallConfig_ACU) => json_ACU([config.limits, config.read, size_ACU(config)]);
const ids_ACU = (ids: readonly string[]) => [...new Set(ids)].sort();
const same_ACU = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id, index) => id === right[index]);
const validIndex_ACU = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validDecision_ACU = (decision: { batchTokens: number; itemTokens: number[] }) => Number.isFinite(decision.batchTokens) && decision.batchTokens > 0 && decision.itemTokens.every(value => Number.isFinite(value) && value >= 0);
const checkedCount_ACU = (count: WorldSimulationTokenCounter_ACU): WorldSimulationTokenCounter_ACU => async text => {
  const value = await count(text);
  if (!Number.isFinite(value) || value < 0) throw new Error('WORLD_EXECUTION_RECALL_TOKEN_COUNT_INVALID');
  return value;
};
function snapshotChange_ACU(frozen: Frozen_ACU, ledger: WorldSimulationLedger_ACU, clock: WorldClock_ACU, location: WorldLocationRef_ACU | null, config: WorldExecutionRecallConfig_ACU): Failure_ACU['snapshot'] | null {
  if (!same_ACU(activeWorldActorRoster_ACU(ledger.actors), frozen.roster)) return 'roster';
  if (fingerprint_ACU(ledger) !== frozen.fingerprint) return 'ledger';
  const previousScope = JSON.parse(frozen.clock) as unknown[];
  const currentScope = JSON.parse(scope_ACU(clock, location)) as unknown[];
  if (json_ACU(previousScope.slice(0, -1)) !== json_ACU(currentScope.slice(0, -1))) return 'clock';
  if (json_ACU(previousScope[previousScope.length - 1]) !== json_ACU(currentScope[currentScope.length - 1])) return 'location';
  if (configKey_ACU(config) !== frozen.config) return 'config';
  return null;
}
function fail_ACU(code: string, reason: string, context: Omit<Failure_ACU, 'code' | 'reason'> = {}): Failure_ACU {
  const details = Object.entries(context).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`).join('，');
  const diagnostic = { code, reason: `${reason}（${code}${details ? `，${details}` : ''}）`, ...context };
  logError_ACU('[执行召回]', diagnostic);
  return diagnostic;
}
function readDenied_ACU(failure: Failure_ACU, tokens = 0): WorldExecutionReadResult_ACU {
  return { allowed: false, reason: failure.reason, tokens, diagnostic: failure };
}
function overlayDenied_ACU(code: string, reason: string, context: Omit<Failure_ACU, 'code' | 'reason'> = {}): never {
  const failure = fail_ACU(code, reason, context);
  throw new Error(`${failure.reason} [${failure.code}]`);
}

/** 每页目录使用独立 gate state；任一页拒绝时不颁发任何 receipt 或公开部分目录。 */
export async function prepareWorldExecutionRecall_ACU(ledger: WorldSimulationLedger_ACU, clock: WorldClock_ACU, location: WorldLocationRef_ACU | null, config: WorldExecutionRecallConfig_ACU, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU): Promise<WorldExecutionPrepareResult_ACU> {
  const actorBatchSize = size_ACU(config);
  if (!Number.isSafeInteger(actorBatchSize) || actorBatchSize < 1 || actorBatchSize > 64) { const diagnostic = fail_ACU('EXEC_PREPARE_BATCH_SIZE_INVALID', '执行人物批次大小非法', { batch: actorBatchSize, limit: 64 }); return { allowed: false, reason: diagnostic.reason, diagnostic }; }
  const frozen: Frozen_ACU = { fingerprint: fingerprint_ACU(ledger), clock: scope_ACU(clock, location), config: configKey_ACU(config), roster: activeWorldActorRoster_ACU(ledger.actors), actorBatchSize, manifests: [], consumed: new Map(), successfulWorldReads: new Map() };
  const index = buildWorldRecallIndex_ACU(ledger); let cursor: string | null = null; let total = 0; let peak = 0;
  do {
    const pageIndex = frozen.manifests.length;
    let page: { manifest: WorldRecallManifestPage_ACU; nextCursor: string | null };
    try { page = queryWorldRecallManifestPage_ACU(index, ledger.actors, clock, location, config.limits, cursor); }
    catch { const diagnostic = fail_ACU('EXEC_DIRECTORY_BUILD_FAILED', '执行目录构造失败', { pageIndex }); return { allowed: false, reason: diagnostic.reason, diagnostic }; }
    let decision: Awaited<ReturnType<typeof gateWorldSimulationReadBatch_ACU>>;
    try { decision = await gateWorldSimulationReadBatch_ACU([{ label: 'execution-recall-directory', text: JSON.stringify(page.manifest) }], { grantedTokens: 0 }, config.read, 0, checkedCount_ACU(count)); }
    catch { const diagnostic = fail_ACU('EXEC_DIRECTORY_COUNT_INVALID', '执行目录页计数非法', { pageIndex }); return { allowed: false, reason: diagnostic.reason, diagnostic }; }
    if (!validDecision_ACU(decision)) { const diagnostic = fail_ACU('EXEC_DIRECTORY_COUNT_INVALID', '执行目录页计数非法', { pageIndex, batch: decision.batchTokens }); return { allowed: false, reason: diagnostic.reason, diagnostic }; }
    const changed = snapshotChange_ACU(frozen, ledger, clock, location, config);
    if (changed) { const diagnostic = fail_ACU('EXEC_DIRECTORY_SNAPSHOT_CHANGED', `执行召回期间快照已变化：${changed}`, { pageIndex, snapshot: changed }); return { allowed: false, reason: diagnostic.reason, diagnostic }; }
    if (!decision.allowed) { const diagnostic = fail_ACU('EXEC_DIRECTORY_BUDGET_REJECTED', `执行目录页被预算拒绝：${decision.reason}`, { pageIndex, batch: decision.batchTokens, limit: decision.reason === 'near-compaction-overflow' ? resolveWorldSimulationReadBudget_ACU(config.read).effectiveFallbackTokens : resolveWorldSimulationReadBudget_ACU(config.read).effectiveMaxReadTokens }); return { allowed: false, reason: diagnostic.reason, diagnostic }; }
    total += decision.batchTokens; peak = Math.max(peak, decision.batchTokens); frozen.manifests.push(structuredClone(page.manifest)); cursor = page.nextCursor;
  } while (cursor !== null);
  const receipt = {} as WorldExecutionReceipt_ACU; receipts_ACU.set(receipt, frozen);
  return { allowed: true, receipt, manifests: structuredClone(frozen.manifests), totalDirectoryTokens: total, peakDirectoryTokens: peak };
}

/** 仅接收同一执行 receipt 已成功精读的纯世界阶段候选。 */
export function issueWorldExecutionOverlayReceipt_ACU(executionReceipt: WorldExecutionReceipt_ACU, base: WorldSimulationLedger_ACU, candidate: WorldRoundCandidate_ACU): WorldExecutionOverlayReceipt_ACU {
  const frozen = receipts_ACU.get(executionReceipt);
  if (!frozen) overlayDenied_ACU('EXEC_OVERLAY_RECEIPT_INVALID', '执行 overlay 缺少匹配的召回快照');
  if (frozen.fingerprint !== fingerprint_ACU(base)) overlayDenied_ACU('EXEC_OVERLAY_LEDGER_CHANGED', '执行 overlay 缺少匹配的召回快照：ledger', { snapshot: 'ledger' });
  if (frozen.clock !== scope_ACU(candidate.candidateClock, base.player.location)) {
    const before = JSON.parse(frozen.clock) as unknown[]; const after = JSON.parse(scope_ACU(candidate.candidateClock, base.player.location)) as unknown[];
    const snapshot = json_ACU(before.slice(0, -1)) === json_ACU(after.slice(0, -1)) ? 'location' : 'clock';
    overlayDenied_ACU('EXEC_OVERLAY_SCOPE_CHANGED', `执行 overlay 缺少匹配的召回快照：${snapshot}`, { snapshot });
  }
  if (candidate.actorWrites.length) overlayDenied_ACU('EXEC_OVERLAY_ACTOR_WRITE', '执行 overlay 只能来自纯世界阶段候选：人物写入', { actorId: candidate.actorWrites[0].value.id });
  if (candidate.historyMilestoneWrites.length) overlayDenied_ACU('EXEC_OVERLAY_HISTORY_WRITE', '执行 overlay 只能来自纯世界阶段候选：历史写入', { historyId: candidate.historyMilestoneWrites[0].value.id });
  if (candidate.historyRecordings?.length) overlayDenied_ACU('EXEC_OVERLAY_HISTORY_RECORDING', '执行 overlay 只能来自纯世界阶段候选：历史记录', { historyId: candidate.historyRecordings[0].historyId });
  const changedCompletion = candidate.actorCompletions.find(item => item.completion !== 'no_change');
  if (changedCompletion) overlayDenied_ACU('EXEC_OVERLAY_ACTOR_COMPLETION', '执行 overlay 只能来自纯世界阶段候选：人物完成状态', { actorId: changedCompletion.actorId });
  if (json_ACU(candidate.projection) !== json_ACU(base.projection)) overlayDenied_ACU('EXEC_OVERLAY_PROJECTION_CHANGED', '执行 overlay 只能来自纯世界阶段候选：投影变更');
  const readEvents = new Set([...frozen.successfulWorldReads.values()].flatMap(item => item.eventIds));
  const readFacts = new Set([...frozen.successfulWorldReads.values()].flatMap(item => item.factIds));
  const newEvents = new Set(candidate.worldEventWrites.filter(write => write.expectedRevision === 0).map(write => write.value.id));
  for (const write of candidate.worldEventWrites) {
    const before = base.worldEvents.find(row => row.id === write.value.id);
    if (before && !readEvents.has(write.value.id)) overlayDenied_ACU('EXEC_OVERLAY_EVENT_UNREAD', '执行 overlay 世界事件未成功精读', { eventId: write.value.id });
    if (before && json_ACU({ ...before, revision: 0 }) === json_ACU({ ...write.value, revision: 0 })) continue;
  }
  for (const write of candidate.factWrites) {
    const unreadEvent = write.value.worldEventIds.find(id => !readEvents.has(id) && !newEvents.has(id));
    if (unreadEvent) overlayDenied_ACU('EXEC_OVERLAY_FACT_EVENT_UNREAD', '执行 overlay 事实引用未成功精读资料：世界事件', { factId: write.value.id, eventId: unreadEvent });
    const unreadFact = write.value.supersedesFactIds.find(id => !readFacts.has(id));
    if (unreadFact) overlayDenied_ACU('EXEC_OVERLAY_FACT_SUPERSEDES_UNREAD', '执行 overlay 事实引用未成功精读资料：被取代事实', { factId: write.value.id, relatedFactId: unreadFact });
  }
  const materialized = materializeWorldRoundCandidate_ACU(base, candidate);
  const receipt = {} as WorldExecutionOverlayReceipt_ACU;
  overlays_ACU.set(receipt, { fingerprint: fingerprint_ACU(base), clock: frozen.clock,
    worldEvents: materialized.worldEvents.filter(row => readEvents.has(row.id) || candidate.worldEventWrites.some(write => write.value.id === row.id)),
    facts: allWorldFacts_ACU(materialized).filter(row => readFacts.has(row.id) || candidate.factWrites.some(write => write.value.id === row.id)), });
  return receipt;
}
function requestKey_ACU(request: WorldExecutionRequest_ACU): string {
  if (request.kind === 'world') return `world:${request.pageIndex}`;
  if (request.kind === 'actor') return `actor:${request.batchIndex}`;
  return `preview:${request.pageIndex}:${request.requestKey}`;
}
type Selection_ACU<T> = { ok: true; value: T } | { ok: false; failure: Failure_ACU };
function baseline_ACU(frozen: Frozen_ACU, ledger: WorldSimulationLedger_ACU, request: WorldExecutionRequest_ACU): Selection_ACU<Materials_ACU> {
  const position = request.kind === 'actor' ? { batchIndex: request.batchIndex } : { pageIndex: request.pageIndex };
  const reject = (code: string, reason: string, ids: Omit<Failure_ACU, 'code' | 'reason'> = {}): Selection_ACU<Materials_ACU> => ({ ok: false, failure: fail_ACU(code, reason, { ...position, ...ids }) });
  if (request.kind === 'world') {
    if (!validIndex_ACU(request.pageIndex)) return reject('EXEC_BASELINE_INDEX_INVALID', '执行精读世界页索引非法');
    const page = frozen.manifests[request.pageIndex]; if (!page) return reject('EXEC_BASELINE_PAGE_MISSING', '执行精读世界目录页不存在');
    const eventIds = ids_ACU(request.worldEventIds); const factIds = ids_ACU(request.factIds);
    const unlistedEvent = eventIds.find(id => !page.dueEventIds.includes(id));
    if (unlistedEvent) return reject('EXEC_BASELINE_EVENT_UNLISTED', '执行精读世界事件不在当页目录', { eventId: unlistedEvent });
    const unlistedFact = factIds.find(id => !page.dueFactIds.includes(id));
    if (unlistedFact) return reject('EXEC_BASELINE_FACT_UNLISTED', '执行精读事实不在当页目录', { factId: unlistedFact });
    const events = ledger.worldEvents.filter(row => eventIds.includes(row.id)); const facts = allWorldFacts_ACU(ledger).filter(row => factIds.includes(row.id));
    const missingEvent = eventIds.find(id => !events.some(row => row.id === id));
    if (missingEvent) return reject('EXEC_BASELINE_EVENT_MISSING', '执行精读世界事件在账本中缺失', { eventId: missingEvent });
    const missingFact = factIds.find(id => !facts.some(row => row.id === id));
    if (missingFact) return reject('EXEC_BASELINE_FACT_MISSING', '执行精读事实在账本中缺失', { factId: missingFact });
    return { ok: true, value: { actors: [], worldEvents: structuredClone(events), facts: structuredClone(facts), historyMilestones: [] } };
  }
  const pageIndex = request.kind === 'actor' ? request.batchIndex : request.pageIndex;
  if (!validIndex_ACU(pageIndex)) return reject('EXEC_BASELINE_INDEX_INVALID', '执行精读目录索引非法');
  const preview = request.kind === 'preview';
  const expectedActors = preview
    ? frozen.manifests[pageIndex]?.actorIds ?? []
    : frozen.roster.slice(pageIndex * frozen.actorBatchSize, (pageIndex + 1) * frozen.actorBatchSize);
  if (!preview && !expectedActors.length) return reject('EXEC_BASELINE_BATCH_EMPTY', '执行精读人物批次不存在');
  const unexpectedActor = Object.keys(request.historyByActor).find(id => !expectedActors.includes(id));
  if (unexpectedActor) return reject('EXEC_BASELINE_ACTOR_OUT_OF_BATCH', '执行精读人物不在本批次', { actorId: unexpectedActor });
  const actorPages = preview ? [frozen.manifests[pageIndex]] : frozen.manifests.filter(page => page.actorIds.some(id => expectedActors.includes(id)));
  if (actorPages.some(page => !page)) return reject('EXEC_BASELINE_PAGE_MISSING', '执行精读预览目录页不存在');
  const missingPageActor = expectedActors.find(actorId => !actorPages.some(page => page!.actorIds.includes(actorId)));
  if (missingPageActor) return reject('EXEC_BASELINE_ACTOR_UNLISTED', '执行精读人物未列入目录', { actorId: missingPageActor });
  const histories = new Set<string>();
  for (const actorId of expectedActors) {
    const row = actorPages.find(page => page!.actorIds.includes(actorId))!.actors.find(item => item.actorId === actorId)!;
    const selected = ids_ACU(request.historyByActor[actorId] ?? []);
    const unlistedHistory = selected.find(id => ![...row.recentHistoryIds, ...row.relatedHistoryIds].includes(id));
    if (unlistedHistory) return reject('EXEC_BASELINE_HISTORY_UNLISTED', '执行精读历史不在人物目录', { actorId, historyId: unlistedHistory });
    selected.forEach(id => histories.add(id));
  }
  const eventIds = ids_ACU(request.worldEventIds); const factIds = ids_ACU(request.factIds);
  const allowedEvents = new Set(actorPages.flatMap(page => page!.dueEventIds)); const allowedFacts = new Set(actorPages.flatMap(page => page!.dueFactIds));
  const unlistedEvent = eventIds.find(id => !allowedEvents.has(id));
  if (unlistedEvent) return reject('EXEC_BASELINE_EVENT_UNLISTED', '执行精读世界事件不在人物目录', { eventId: unlistedEvent });
  const unlistedFact = factIds.find(id => !allowedFacts.has(id));
  if (unlistedFact) return reject('EXEC_BASELINE_FACT_UNLISTED', '执行精读事实不在人物目录', { factId: unlistedFact });
  const events = ledger.worldEvents.filter(row => eventIds.includes(row.id));
  const facts = allWorldFacts_ACU(ledger).filter(row => factIds.includes(row.id));
  const actorIdsForMaterials = preview ? Object.keys(request.historyByActor) : expectedActors;
  const actors = actorIdsForMaterials.map(id => ledger.actors.find(row => row.id === id)).filter((row): row is WorldSimulationLedger_ACU['actors'][number] => !!row);
  const missingEvent = eventIds.find(id => !events.some(row => row.id === id));
  if (missingEvent) return reject('EXEC_BASELINE_EVENT_MISSING', '执行精读世界事件在账本中缺失', { eventId: missingEvent });
  const missingFact = factIds.find(id => !facts.some(row => row.id === id));
  if (missingFact) return reject('EXEC_BASELINE_FACT_MISSING', '执行精读事实在账本中缺失', { factId: missingFact });
  const missingActor = actorIdsForMaterials.find(id => !actors.some(row => row.id === id));
  if (missingActor) return reject('EXEC_BASELINE_ACTOR_MISSING', '执行精读人物在账本中缺失', { actorId: missingActor });
  return { ok: true, value: { actors: structuredClone(actors), worldEvents: structuredClone(events), facts: structuredClone(facts), historyMilestones: structuredClone([...ledger.historyMilestones, ...(ledger.historyArchive ?? [])].filter(row => histories.has(row.id))) } };
}
function overlay_ACU(receipt: WorldExecutionOverlayReceipt_ACU | undefined, frozen: Frozen_ACU, request: WorldExecutionRequest_ACU): Selection_ACU<{ worldEvents: WorldEvent_ACU[]; facts: WorldFact_ACU[] }> {
  if (!receipt) return { ok: true, value: { worldEvents: [], facts: [] } };
  const position = request.kind === 'actor' ? { batchIndex: request.batchIndex } : { pageIndex: request.pageIndex };
  if (request.kind === 'preview') return { ok: false, failure: fail_ACU('EXEC_OVERLAY_REQUEST_KIND_INVALID', '召回预览不能读取执行阶段结果', position) };
  const saved = overlays_ACU.get(receipt);
  if (!saved) return { ok: false, failure: fail_ACU('EXEC_OVERLAY_RECEIPT_INVALID', '执行精读 overlay 凭证无效', position) };
  if (saved.fingerprint !== frozen.fingerprint) return { ok: false, failure: fail_ACU('EXEC_OVERLAY_LEDGER_CHANGED', '执行精读 overlay 账本快照不匹配', { ...position, snapshot: 'ledger' }) };
  if (saved.clock !== frozen.clock) {
    const before = JSON.parse(saved.clock) as unknown[]; const after = JSON.parse(frozen.clock) as unknown[];
    const snapshot = json_ACU(before.slice(0, -1)) === json_ACU(after.slice(0, -1)) ? 'location' : 'clock';
    return { ok: false, failure: fail_ACU('EXEC_OVERLAY_SCOPE_CHANGED', `执行精读 overlay 时钟或地点不匹配：${snapshot}`, { ...position, snapshot }) };
  }
  return { ok: true, value: { worldEvents: structuredClone(saved.worldEvents), facts: structuredClone(saved.facts) } };
}
/** 只读、一次性、整包精读；任何局部或预算失败均不返回正文。 */
export async function readWorldExecutionRecall_ACU(receipt: WorldExecutionReceipt_ACU, ledger: WorldSimulationLedger_ACU, clock: WorldClock_ACU, location: WorldLocationRef_ACU | null, config: WorldExecutionRecallConfig_ACU, request: WorldExecutionRequest_ACU, overlayReceipt?: WorldExecutionOverlayReceipt_ACU, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU): Promise<WorldExecutionReadResult_ACU> {
  const frozen = receipt && typeof receipt === 'object' ? receipts_ACU.get(receipt) : undefined;
  if (!frozen) return readDenied_ACU(fail_ACU('EXEC_RECEIPT_INVALID', '执行 receipt 无效或快照已变化：凭证无效'));
  const position = request.kind === 'actor' ? { batchIndex: request.batchIndex } : { pageIndex: request.pageIndex };
  const changedAtStart = snapshotChange_ACU(frozen, ledger, clock, location, config);
  if (changedAtStart) return readDenied_ACU(fail_ACU('EXEC_SNAPSHOT_CHANGED', `执行 receipt 无效或快照已变化：${changedAtStart}`, { ...position, snapshot: changedAtStart }));
  if ((request.kind === 'world' && !validIndex_ACU(request.pageIndex))
    || (request.kind === 'actor' && !validIndex_ACU(request.batchIndex))
    || (request.kind === 'preview' && (!validIndex_ACU(request.pageIndex) || typeof request.requestKey !== 'string' || !request.requestKey))) {
    return readDenied_ACU(fail_ACU('EXEC_READ_INDEX_INVALID', '执行精读索引非法', position));
  }
  const frozenRequest = structuredClone(request);
  const frozenOverlay = overlayReceipt;
  const key = requestKey_ACU(frozenRequest); const signature = json_ACU(frozenRequest); const prior = frozen.consumed.get(key);
  if (prior !== undefined) return readDenied_ACU(fail_ACU(prior === signature ? 'EXEC_READ_CONSUMED' : 'EXEC_READ_SELECTION_CHANGED', prior === signature ? '执行精读请求已消费' : '执行精读请求不得变更选择', position));
  frozen.consumed.set(key, 'claimed');
  const selected = baseline_ACU(frozen, ledger, frozenRequest);
  if (selected.ok === false) { frozen.consumed.set(key, signature); return readDenied_ACU(selected.failure); }
  const overlay = overlay_ACU(frozenOverlay, frozen, frozenRequest);
  if (overlay.ok === false) { frozen.consumed.set(key, signature); return readDenied_ACU(overlay.failure); }
  const merge = <T extends { id: string }>(base: readonly T[], extra: readonly T[]) => [...new Map([...base, ...extra].map(row => [row.id, row])).values()];
  const materials: Materials_ACU = { actors: selected.value.actors, worldEvents: merge(selected.value.worldEvents, overlay.value.worldEvents), facts: merge(selected.value.facts, overlay.value.facts), historyMilestones: selected.value.historyMilestones };
  let decision: Awaited<ReturnType<typeof gateWorldSimulationReadBatch_ACU>>;
  try { decision = await gateWorldSimulationReadBatch_ACU([{ label: `execution-${key}`, text: JSON.stringify(materials) }], { grantedTokens: 0 }, config.read, 0, checkedCount_ACU(count)); }
  catch { frozen.consumed.set(key, signature); return readDenied_ACU(fail_ACU('EXEC_READ_COUNT_INVALID', '执行精读计数非法', position)); }
  frozen.consumed.set(key, signature);
  if (!validDecision_ACU(decision)) return readDenied_ACU(fail_ACU('EXEC_READ_COUNT_INVALID', '执行精读计数非法', { ...position, batch: decision.batchTokens }));
  const changedDuringCount = snapshotChange_ACU(frozen, ledger, clock, location, config);
  if (changedDuringCount) return readDenied_ACU(fail_ACU('EXEC_READ_SNAPSHOT_CHANGED', `执行精读计数期间快照已变化：${changedDuringCount}`, { ...position, snapshot: changedDuringCount }));
  if (!decision.allowed) return readDenied_ACU(fail_ACU('EXEC_READ_BUDGET_REJECTED', `执行精读被预算拒绝：${decision.reason}`, { ...position, batch: decision.batchTokens, limit: decision.reason === 'near-compaction-overflow' ? resolveWorldSimulationReadBudget_ACU(config.read).effectiveFallbackTokens : resolveWorldSimulationReadBudget_ACU(config.read).effectiveMaxReadTokens }), decision.batchTokens);
  if (frozenRequest.kind === 'world') frozen.successfulWorldReads.set(key, { eventIds: ids_ACU(frozenRequest.worldEventIds), factIds: ids_ACU(frozenRequest.factIds) });
  return { allowed: true, materials: structuredClone(materials), tokens: decision.batchTokens };
}
