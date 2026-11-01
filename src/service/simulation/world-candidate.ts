import { validateWorldActorCompletions_ACU, type WorldActorCompletion_ACU } from './actor-completions';
import { stampWorldActorTimelines_ACU } from './actor-timeline';
import { claimWorldFactRevealProof_ACU, type WorldFactRevealProof_ACU } from './agent/world-projection-stage';
import { validateWorldSimulationLedger_ACU } from './simulation-store';
import { normalizeWorldHistoryArchive_ACU } from './history-archive';
import { normalizeWorldFactArchive_ACU } from './fact-archive';
import { removeWorldFactsFromLedgerParts_ACU, selectRemovableWorldEventIds_ACU, selectRemovableWorldFactIds_ACU } from './world-fact-prune';
import { removeWorldEventsFromLedgerParts_ACU } from './world-event-removal';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU,
  type WorldActor_ACU, type WorldClock_ACU, type WorldEvent_ACU, type WorldFact_ACU,
  type WorldHistoryMilestone_ACU, type WorldProjection_ACU, type WorldSimulationLedger_ACU,
  type WorldSimulationRunIdentity_ACU } from './model';
import type { WorldSimulationTargetAnchor_ACU } from './agent/agent-model';

type Write_ACU<T> = { value: T; expectedRevision: number };

/** 两种新工作流共用的内存候选；旧 Agent 的 SQL 候选不进入此入口。 */
export interface WorldRoundCandidate_ACU {
  baseRevision: number;
  candidateClock: WorldClock_ACU;
  worldEventWrites: Write_ACU<WorldEvent_ACU>[];
  actorWrites: Write_ACU<WorldActor_ACU>[];
  factWrites: Write_ACU<WorldFact_ACU>[];
  historyMilestoneWrites: Write_ACU<WorldHistoryMilestone_ACU>[];
  /** 仅为既有热/冷历史追加正文记载元数据；不允许改写纪要业务字段。 */
  historyRecordings?: Array<{
    historyId: string;
    expectedRevision: number;
    record: NonNullable<WorldHistoryMilestone_ACU['narrativeRecord']>;
  }>;
  actorCompletions: WorldActorCompletion_ACU[];
  /**
   * 联合审查专员判定已无用的“内部管理事实”ID（独立于 factWrites）。物化时仅接受提交前存在、属于内部管理事实、
   * 且不是本轮写入的事实，其余静默跳过；并清理其他实体对这些事实的结构化 ID 引用。
   */
  factRemovals?: string[];
  /**
   * 联合审查专员判定已无用的已结束世界事件 ID（独立于 worldEventWrites）。物化时仅接受提交前已是
   * resolved/cancelled、非本轮写入、且未被未解锁揭示条件引用的事件，其余静默跳过；只删事件条目与别处对它的 ID 引用。
   */
  eventRemovals?: string[];
  projection: WorldProjection_ACU;
  completion: 'changed' | 'no_change';
}

function fail_ACU(message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_persist', message, false));
}

function canonical_ACU(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical_ACU);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key =>
      [key, canonical_ACU((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function same_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical_ACU(left)) === JSON.stringify(canonical_ACU(right));
}

function applyWrites_ACU<T extends { id: string; revision: number }>(
  current: readonly T[], writes: readonly Write_ACU<T>[], kind: string,
): T[] {
  const result = structuredClone(current) as T[];
  const byId = new Map(result.map((item, index) => [item.id, index]));
  const seen = new Set<string>();
  for (const write of writes) {
    const id = write.value?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) fail_ACU(`${kind} 写入 ID 为空或重复`);
    seen.add(id);
    const index = byId.get(id);
    const previous = index === undefined ? null : result[index];
    if (!Number.isSafeInteger(write.expectedRevision) || write.expectedRevision !== (previous?.revision ?? 0)) {
      fail_ACU(`${kind} ${id} expectedRevision 冲突`);
    }
    if (write.value.revision !== write.expectedRevision + 1) fail_ACU(`${kind} ${id} 新 revision 非法`);
    if (index === undefined) {
      byId.set(id, result.length);
      result.push(structuredClone(write.value));
    } else result[index] = structuredClone(write.value);
  }
  return result;
}

/** 仅在副本上追加记录。重复提交相同元数据接受当前或紧邻旧版本，但不重复加版本。 */
function applyHistoryRecordings_ACU(
  previous: WorldSimulationLedger_ACU, milestones: WorldHistoryMilestone_ACU[],
  recordings: WorldRoundCandidate_ACU['historyRecordings'], candidateClock: WorldClock_ACU,
): { milestones: WorldHistoryMilestone_ACU[]; archive?: WorldHistoryMilestone_ACU[] } {
  const archive = previous.historyArchive === undefined ? undefined : structuredClone(previous.historyArchive);
  if (recordings === undefined) return { milestones, archive };
  if (!Array.isArray(recordings)) fail_ACU('historyRecordings 必须是数组');
  const seen = new Set<string>();
  for (const item of recordings) {
    const id = item?.historyId;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) fail_ACU('historyRecordings ID 为空或重复');
    seen.add(id);
    const record = item.record;
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).sort().join(',') !== 'anchorDigest,deliveryQuote,evidenceQuote,recordedAt,status'
      || record.status !== 'recorded'
      || !record.recordedAt || typeof record.recordedAt !== 'object' || Array.isArray(record.recordedAt)
      || Object.keys(record.recordedAt).sort().join(',') !== 'day,slot'
      || !Number.isSafeInteger(record.recordedAt.day) || record.recordedAt.day < 1
      || record.recordedAt.day > candidateClock.day || typeof record.recordedAt.slot !== 'string'
      || typeof record.anchorDigest !== 'string' || !/^[0-9a-f]{64}$/.test(record.anchorDigest)
      || typeof record.deliveryQuote !== 'string' || !record.deliveryQuote.trim()
      || typeof record.evidenceQuote !== 'string' || !record.evidenceQuote.trim()) {
      fail_ACU(`历史记载 ${id} 结构或时间非法`);
    }
    const hotIndex = previous.historyMilestones.findIndex(history => history.id === id);
    const coldIndex = previous.historyArchive?.findIndex(history => history.id === id) ?? -1;
    if (hotIndex < 0 && coldIndex < 0) fail_ACU(`历史记载 ${id} 不存在既有历史节点`);
    const target = hotIndex >= 0 ? milestones : archive!;
    const index = hotIndex >= 0 ? hotIndex : coldIndex;
    const history = target[index];
    const sameRecord = history.narrativeRecord !== undefined
      && record.status === history.narrativeRecord.status
      && record.recordedAt.day === history.narrativeRecord.recordedAt.day
      && record.recordedAt.slot === history.narrativeRecord.recordedAt.slot
      && record.anchorDigest === history.narrativeRecord.anchorDigest
      && record.deliveryQuote === history.narrativeRecord.deliveryQuote
      && record.evidenceQuote === history.narrativeRecord.evidenceQuote;
    if (!Number.isSafeInteger(item.expectedRevision)
      || (item.expectedRevision !== history.revision && !(sameRecord && item.expectedRevision === history.revision - 1))) {
      fail_ACU(`历史记载 ${id} expectedRevision 冲突`);
    }
    if (history.narrativeRecord !== undefined) {
      if (!sameRecord) fail_ACU(`历史记载 ${id} 已存在，不能改写`);
      continue;
    }
    target[index] = { ...history, revision: history.revision + 1, narrativeRecord: structuredClone(record) };
  }
  return { milestones, archive };
}

/** 校验全部人物批次和引用后才返回完整账本；本函数没有任何持久化副作用。 */
export function materializeWorldRoundCandidate_ACU(
  base: WorldSimulationLedger_ACU, candidate: WorldRoundCandidate_ACU,
): WorldSimulationLedger_ACU {
  const previous = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  if (candidate.baseRevision !== previous.revision) fail_ACU('本轮基础账本 revision 冲突');
  const rawActors = applyWrites_ACU(previous.actors, candidate.actorWrites, 'actor');
  const writtenActorIds = new Set(candidate.actorWrites.map(write => write.value.id));
  for (const actor of rawActors) {
    const original = previous.actors.find(item => item.id === actor.id);
    if (!original && (actor.simulationStatus !== 'active' || actor.shortTermAction === undefined || actor.loreRefs === undefined)) {
      fail_ACU(`新人物 ${actor.id} 缺少完整 active 初始状态`);
    }
  }
  // 先核验模型提交的原始业务写集，再只为本轮实际写入的人物盖提交时钟。
  const rawActorErrors = validateWorldActorCompletions_ACU(previous.actors, rawActors, candidate.actorCompletions);
  if (rawActorErrors.length) fail_ACU(rawActorErrors.join('；'));
  const stampedWrites = stampWorldActorTimelines_ACU(
    previous.actors.filter(actor => writtenActorIds.has(actor.id)).map(actor => ({
      ...actor, longTermAction: actor.shortTermAction === undefined ? actor.longTermAction : actor.shortTermAction,
    })),
    rawActors.filter(actor => writtenActorIds.has(actor.id)).map(actor => ({
      ...actor, longTermAction: actor.shortTermAction === undefined ? actor.longTermAction : actor.shortTermAction,
    })),
    candidate.candidateClock,
  );
  const stampedById = new Map(stampedWrites.map(actor => [actor.id, actor]));
  const actors = rawActors.map(actor => stampedById.get(actor.id) ?? actor);
  const actorErrors = validateWorldActorCompletions_ACU(previous.actors, actors, candidate.actorCompletions);
  if (actorErrors.length) fail_ACU(actorErrors.join('；'));
  for (const write of candidate.actorWrites) {
    if (previous.actors.find(actor => actor.id === write.value.id)?.simulationStatus === 'archived') {
      fail_ACU(`归档人物 ${write.value.id} 不能进入本轮写集`);
    }
  }
  for (const entry of candidate.actorCompletions) {
    if (entry.completion === 'changed' && !writtenActorIds.has(entry.actorId)) fail_ACU(`人物 ${entry.actorId} 标记 changed 却缺少写入`);
    if (entry.completion === 'no_change' && writtenActorIds.has(entry.actorId)) fail_ACU(`人物 ${entry.actorId} 标记 no_change 却提供写入`);
  }
  const events = applyWrites_ACU(previous.worldEvents, candidate.worldEventWrites, 'worldEvent');
  for (const write of candidate.worldEventWrites) {
    const before = previous.worldEvents.find(event => event.id === write.value.id);
    const after = write.value;
    const unchanged = before && same_ACU({ ...before, nextCheck: null, revision: 0 }, { ...after, nextCheck: null, revision: 0 });
    const produced = candidate.factWrites.some(fact => fact.value.worldEventIds.includes(after.id));
    if (unchanged && produced) fail_ACU(`世界事件 ${after.id} 仅复查不能制造结果事实`);
    if ((!before || !unchanged) && !produced) fail_ACU(`世界事件 ${after.id} 发生变化却缺少确定结果事实`);
  }
  const facts = applyWrites_ACU(previous.facts, candidate.factWrites, 'fact');
  const coldFactIds = new Set(previous.factArchive?.map(item => item.id) ?? []);
  for (const write of candidate.factWrites) {
    if (coldFactIds.has(write.value.id)) fail_ACU(`冷归档事实 ${write.value.id} 不能原位改写`);
  }
  for (const write of candidate.factWrites) {
    if (previous.facts.some(item => item.id === write.value.id)) fail_ACU(`正式事实 ${write.value.id} 不能原位改写`);
  }
  for (const write of candidate.factWrites) {
    if (write.value.revealState === 'unlocked' && write.value.projectionPolicy === 'gated') {
      fail_ACU(`新 gated fact ${write.value.id} 不能绕过触发流程直接解锁`);
    }
  }
  const coldMilestoneIds = new Set(previous.historyArchive?.map(item => item.id) ?? []);
  for (const write of candidate.historyMilestoneWrites) {
    if (coldMilestoneIds.has(write.value.id)) fail_ACU(`历史纪要 ${write.value.id} 不能原位改写`);
    if (write.value?.narrativeRecord !== undefined) fail_ACU(`历史纪要 ${write.value.id} 不能自行声明正文记载`);
  }
  const writtenMilestones = applyWrites_ACU(previous.historyMilestones, candidate.historyMilestoneWrites, 'historyMilestone');
  for (const write of candidate.historyMilestoneWrites) {
    if (previous.historyMilestones.some(item => item.id === write.value.id)) fail_ACU(`历史纪要 ${write.value.id} 不能原位改写`);
  }
  const { milestones, archive: historyArchive } = applyHistoryRecordings_ACU(
    previous, writtenMilestones, candidate.historyRecordings, candidate.candidateClock,
  );
  if (!candidate.candidateClock || !Number.isSafeInteger(candidate.candidateClock.day)
    || candidate.candidateClock.day < previous.clock.day) fail_ACU('候选时钟不能倒退');
  for (const write of candidate.factWrites) {
    const fact = write.value;
    const at = fact.temporalKind === 'occurrence' ? fact.happenedAt : fact.validFrom;
    if (!at || at.day > candidate.candidateClock.day) fail_ACU(`事实 ${fact.id} 尚未在候选时间成立`);
  }
  for (const write of candidate.historyMilestoneWrites) {
    if (write.value.happenedAt.day > candidate.candidateClock.day) fail_ACU(`历史节点 ${write.value.id} 尚未发生`);
  }
  for (const write of candidate.worldEventWrites) {
    if (write.value.startedAt && write.value.startedAt.day > candidate.candidateClock.day) {
      fail_ACU(`世界事件 ${write.value.id} 的起点尚未发生`);
    }
    if ((write.value.status === 'resolved' || write.value.status === 'cancelled')
      && !candidate.factWrites.some(fact => fact.value.worldEventIds.includes(write.value.id)
        && fact.value.temporalKind === 'occurrence' && fact.value.happenedAt
        && fact.value.happenedAt.day >= previous.clock.day
        && fact.value.happenedAt.day <= candidate.candidateClock.day)) {
      fail_ACU(`世界事件 ${write.value.id} 收束时缺少本轮确定结果`);
    }
  }
  // 投送状态由独立回执链更新，模型候选不能自报已发送或已采用。
  if (!same_ACU(candidate.projection, previous.projection)) {
    fail_ACU('正文投送状态必须由独立回执更新，候选不能自行改写 projection');
  }
  if (candidate.factRemovals !== undefined && !Array.isArray(candidate.factRemovals)) fail_ACU('factRemovals 必须是数组');
  const removedFactIds = new Set(selectRemovableWorldFactIds_ACU(previous, candidate.factWrites, candidate.factRemovals));
  const pruned = removedFactIds.size ? removeWorldFactsFromLedgerParts_ACU(previous, {
    facts, ...(previous.factArchive === undefined ? {} : { factArchive: previous.factArchive }),
    historyMilestones: milestones, ...(historyArchive === undefined ? {} : { historyArchive }),
    projection: structuredClone(candidate.projection),
  }, removedFactIds) : null;
  if (candidate.eventRemovals !== undefined && !Array.isArray(candidate.eventRemovals)) fail_ACU('eventRemovals 必须是数组');
  const removedEventIds = new Set(selectRemovableWorldEventIds_ACU(
    previous, candidate.worldEventWrites, candidate.factWrites, candidate.eventRemovals));
  const afterFacts = pruned?.facts ?? facts;
  const afterFactArchive = pruned?.factArchive ?? previous.factArchive;
  const afterHistory = pruned?.historyMilestones ?? milestones;
  const afterHistoryArchive = pruned?.historyArchive ?? historyArchive;
  const eventPruned = removedEventIds.size ? removeWorldEventsFromLedgerParts_ACU(previous, {
    worldEvents: events, facts: afterFacts, ...(afterFactArchive === undefined ? {} : { factArchive: afterFactArchive }),
    historyMilestones: afterHistory, ...(afterHistoryArchive === undefined ? {} : { historyArchive: afterHistoryArchive }),
    chronicle: previous.chronicle,
  }, removedEventIds) : null;
  const finalFactArchive = eventPruned?.factArchive ?? afterFactArchive;
  const finalHistoryArchive = eventPruned?.historyArchive ?? afterHistoryArchive;
  const ledger = validateWorldSimulationLedger_ACU({
    ...previous, revision: previous.revision + 1, clock: structuredClone(candidate.candidateClock),
    actors, worldEvents: eventPruned?.worldEvents ?? events, facts: eventPruned?.facts ?? afterFacts,
    historyMilestones: eventPruned?.historyMilestones ?? afterHistory,
    ...(finalHistoryArchive === undefined ? {} : { historyArchive: finalHistoryArchive }),
    ...(finalFactArchive === undefined ? {} : { factArchive: finalFactArchive }),
    ...(eventPruned ? { chronicle: eventPruned.chronicle } : {}),
    projection: pruned?.projection ?? structuredClone(candidate.projection),
  }, 'agent_persist');
  const changed = !same_ACU(previous.clock, ledger.clock)
    || !same_ACU(previous.actors, ledger.actors)
    || !same_ACU(previous.worldEvents, ledger.worldEvents)
    || !same_ACU(previous.facts, ledger.facts)
    || !same_ACU(previous.historyMilestones, ledger.historyMilestones)
    || !same_ACU(previous.historyArchive, ledger.historyArchive)
    || !same_ACU(previous.projection, ledger.projection);
  if (candidate.completion !== (changed ? 'changed' : 'no_change')) fail_ACU('整轮完成状态与候选变化不一致');
  // 先判定模型候选本身是否有业务变化；冷热分层是同一提交内的程序性整理，不能反向伪造 changed。
  return validateWorldSimulationLedger_ACU(normalizeWorldFactArchive_ACU(normalizeWorldHistoryArchive_ACU(ledger)), 'agent_persist');
}

/**
 * 只在已签发的一次性 reveal proof 授权下，将既有 locked gated fact 物化为 unlocked。
 * 这是纯内存入口；不连接投送、提交或运行器。
 */
export function materializeReviewedWorldRoundCandidate_ACU(
  base: WorldSimulationLedger_ACU, candidate: WorldRoundCandidate_ACU,
  authorization: {
    proof: WorldFactRevealProof_ACU;
    factIds: readonly string[];
    identity: WorldSimulationRunIdentity_ACU;
    targetAnchor: WorldSimulationTargetAnchor_ACU;
  },
): WorldSimulationLedger_ACU {
  const previous = validateWorldSimulationLedger_ACU(base, 'agent_persist');
  const requestedFactIds = reviewedFactIds_ACU(authorization?.factIds);
  if (candidate.completion !== 'changed') fail_ACU('揭示既有事实后整轮完成状态必须为 changed');
  // 普通候选可继续创建本轮新事实；旧入口已禁止现有事实原位改写。
  // proof 仅能改变 preview 中既有的 locked gated 事实，不能授权新事实直接解锁。

  // 先按旧入口完成未解锁预览：它承担全部人物覆盖、时钟、事件、引用和 projection 校验。
  const previewCandidate = { ...candidate, completion: previewCompletion_ACU(previous, candidate) };
  const preview = materializeWorldRoundCandidate_ACU(previous, previewCandidate);
  claimWorldFactRevealProof_ACU(
    authorization?.proof, preview, requestedFactIds, authorization?.identity, authorization?.targetAnchor,
  );

  const byId = new Map(preview.facts.map((fact, index) => [fact.id, index]));
  const facts = structuredClone(preview.facts);
  for (const id of requestedFactIds) {
    const index = byId.get(id);
    const prior = index === undefined ? undefined : facts[index];
    if (!prior || prior.projectionPolicy !== 'gated' || prior.revealState !== 'locked') {
      fail_ACU(`受审事实 ${id} 不是既有 locked gated fact`);
    }
    facts[index] = { ...prior, revealState: 'unlocked', revision: prior.revision + 1 };
  }
  const next = validateWorldSimulationLedger_ACU({ ...preview, facts }, 'agent_persist');
  if (!worldRoundDomainChanged_ACU(previous, next) || candidate.completion !== 'changed') {
    fail_ACU('揭示既有事实后整轮完成状态必须为 changed');
  }
  return next;
}

function reviewedFactIds_ACU(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.some(id => typeof id !== 'string' || !id.trim())
    || new Set(raw).size !== raw.length) fail_ACU('受审事实 ID 必须为非空且不重复集合');
  return [...raw].sort();
}

/** 与旧入口相同的领域深比较，但不将本入口专有的 reveal 变更预先计入。 */
export function materializeWorldRoundPreview_ACU(previous: WorldSimulationLedger_ACU, candidate: WorldRoundCandidate_ACU): WorldSimulationLedger_ACU {
  return materializeWorldRoundCandidate_ACU(previous, { ...candidate, completion: previewCompletion_ACU(previous, candidate) });
}

function previewCompletion_ACU(previous: WorldSimulationLedger_ACU, candidate: WorldRoundCandidate_ACU): 'changed' | 'no_change' {
  const clockChanged = !same_ACU(previous.clock, candidate.candidateClock);
  const writesChanged = candidate.actorWrites.length > 0 || candidate.worldEventWrites.length > 0
    || candidate.factWrites.length > 0 || candidate.historyMilestoneWrites.length > 0
    || selectRemovableWorldFactIds_ACU(previous, candidate.factWrites, candidate.factRemovals).length > 0
    || selectRemovableWorldEventIds_ACU(previous, candidate.worldEventWrites, candidate.factWrites, candidate.eventRemovals).length > 0
    || (candidate.historyRecordings?.some(item => {
      const history = [...previous.historyMilestones, ...(previous.historyArchive ?? [])]
        .find(row => row.id === item?.historyId);
      return !history?.narrativeRecord || !same_ACU(history.narrativeRecord, item.record);
    }) ?? false);
  return clockChanged || writesChanged ? 'changed' : 'no_change';
}

function worldRoundDomainChanged_ACU(previous: WorldSimulationLedger_ACU, next: WorldSimulationLedger_ACU): boolean {
  return !same_ACU(previous.clock, next.clock)
    || !same_ACU(previous.actors, next.actors)
    || !same_ACU(previous.worldEvents, next.worldEvents)
    || !same_ACU(previous.facts, next.facts)
    || !same_ACU(previous.historyMilestones, next.historyMilestones)
    || !same_ACU(previous.historyArchive, next.historyArchive)
    || !same_ACU(previous.projection, next.projection);
}
