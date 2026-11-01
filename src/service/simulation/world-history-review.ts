import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type {
  WorldActor_ACU, WorldClock_ACU, WorldHistoryMilestone_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU, WorldTime_ACU,
} from './model';
import type { WorldRoundCandidate_ACU } from './world-candidate';

/** 联合审查一次最多看到的“本轮变化”条数与“已有重要历史目录”“可标记正文记录”条数；超预算时由调用方继续折半。 */
export const WORLD_HISTORY_REVIEW_FACT_LIMIT_ACU = 40;
export const WORLD_HISTORY_REVIEW_ACTOR_LIMIT_ACU = 24;
export const WORLD_HISTORY_REVIEW_EVENT_LIMIT_ACU = 24;
export const WORLD_HISTORY_REVIEW_CATALOG_LIMIT_ACU = 60;
export const WORLD_HISTORY_REVIEW_RECORDING_LIMIT_ACU = 24;
const TEXT_LIMIT_ACU = 300;
const LINK_LIMIT_ACU = 4;
const EXPERIENCE_LIMIT_ACU = 3;

export interface WorldHistoryReviewFactChange_ACU {
  id: string; summary: string; happenedAt?: WorldTime_ACU; actorIds?: string[]; worldEventIds?: string[];
}
export interface WorldHistoryReviewActorChange_ACU {
  id: string; name: string; isNew?: boolean; previousActionResult?: string;
  completedAffair?: { text: string; status: string; outcome: string | null };
  newExperiences?: Array<{ text: string; status: string; outcome: string | null; endedAtDay: number }>;
  life?: string; deathSummary?: string;
}
export interface WorldHistoryReviewEventChange_ACU {
  id: string; title: string; status: string; previousStatus?: string; state: string; actorIds?: string[];
}
export interface WorldHistoryCatalogRow_ACU {
  id: string; summary: string; happenedAt: WorldTime_ACU; actorIds: string[]; worldEventIds: string[];
}

/** 联合审查在同一次请求里顺带处理的“重要历史”职责所需的紧凑资料。 */
export interface WorldHistoryReviewMaterials_ACU {
  /** 本轮变化：新写或改写的事实、人物完成的事务与上一轮行动结果、世界事件的状态变化。 */
  changes: {
    facts: WorldHistoryReviewFactChange_ACU[];
    actors: WorldHistoryReviewActorChange_ACU[];
    events: WorldHistoryReviewEventChange_ACU[];
  };
  /** 已有重要历史的紧凑目录，仅用于去重。 */
  catalog: WorldHistoryCatalogRow_ACU[];
  /** 提交前已存在、尚未被正文记录的重要历史（完整条目）；仅在本轮有投送资料时给出。 */
  recordingMaterials: WorldHistoryMilestone_ACU[];
  /** 与目标正文同轮实际送达的投送资料。 */
  deliveryText: string;
}

export function hasWorldHistoryChanges_ACU(materials: Pick<WorldHistoryReviewMaterials_ACU, 'changes'>): boolean {
  return materials.changes.facts.length + materials.changes.actors.length + materials.changes.events.length > 0;
}

/** 只有变化或可标记正文记录的历史存在时才有历史职责；仅有目录不构成职责。 */
export function hasWorldHistoryReviewWork_ACU(materials: WorldHistoryReviewMaterials_ACU | undefined): boolean {
  return !!materials && (hasWorldHistoryChanges_ACU(materials) || materials.recordingMaterials.length > 0);
}

/** 预算不足时各列表一起折半；返回新对象。 */
export function halveWorldHistoryReviewMaterials_ACU(materials: WorldHistoryReviewMaterials_ACU): WorldHistoryReviewMaterials_ACU {
  const half = <T>(items: readonly T[]): T[] => items.slice(0, Math.floor(items.length / 2));
  const recordingMaterials = half(materials.recordingMaterials);
  const changes = { facts: half(materials.changes.facts), actors: half(materials.changes.actors), events: half(materials.changes.events) };
  const next: WorldHistoryReviewMaterials_ACU = {
    changes, catalog: half(materials.catalog), recordingMaterials, deliveryText: recordingMaterials.length ? materials.deliveryText : '',
  };
  return hasWorldHistoryChanges_ACU(next) ? next : { ...next, catalog: [] };
}

export function worldHistoryReviewItemCount_ACU(materials: WorldHistoryReviewMaterials_ACU | undefined): number {
  return !materials ? 0 : materials.changes.facts.length + materials.changes.actors.length + materials.changes.events.length
    + materials.catalog.length + materials.recordingMaterials.length;
}

function clip_ACU(text: string): string { return text.length > TEXT_LIMIT_ACU ? `${text.slice(0, TEXT_LIMIT_ACU)}…` : text; }
function dayOfHistory_ACU(item: Pick<WorldHistoryMilestone_ACU, 'happenedAt'>): number { return item.happenedAt.day; }
function newestFirst_ACU(left: WorldHistoryMilestone_ACU, right: WorldHistoryMilestone_ACU): number {
  return dayOfHistory_ACU(right) - dayOfHistory_ACU(left) || left.id.localeCompare(right.id);
}

/**
 * 构建联合审查的历史资料。base 是提交前账本，ledger 是已物化的本轮账本（用于读取盖过时钟的人物最终状态），
 * candidate 是本轮候选（用于判定哪些事实、人物、事件是本轮写入的）。
 */
export function buildWorldHistoryReviewMaterials_ACU(
  base: WorldSimulationLedger_ACU, ledger: WorldSimulationLedger_ACU,
  candidate: Pick<WorldRoundCandidate_ACU, 'factWrites' | 'actorWrites' | 'worldEventWrites'>, deliveryText: string,
): WorldHistoryReviewMaterials_ACU {
  const facts = candidate.factWrites.slice(0, WORLD_HISTORY_REVIEW_FACT_LIMIT_ACU).map(({ value }): WorldHistoryReviewFactChange_ACU => {
    const at = value.temporalKind === 'occurrence' ? value.happenedAt : value.validFrom;
    return { id: value.id, summary: clip_ACU(value.summary), ...(at ? { happenedAt: { ...at } } : {}),
      ...(value.actorIds.length ? { actorIds: value.actorIds.slice(0, LINK_LIMIT_ACU) } : {}),
      ...(value.worldEventIds.length ? { worldEventIds: value.worldEventIds.slice(0, LINK_LIMIT_ACU) } : {}) };
  });
  const actors: WorldHistoryReviewActorChange_ACU[] = [];
  for (const write of candidate.actorWrites) {
    if (actors.length >= WORLD_HISTORY_REVIEW_ACTOR_LIMIT_ACU) break;
    const after: WorldActor_ACU = ledger.actors.find(actor => actor.id === write.value.id) ?? write.value;
    const before = base.actors.find(actor => actor.id === write.value.id);
    const row: WorldHistoryReviewActorChange_ACU = { id: after.id, name: after.name };
    if (!before) row.isNew = true;
    const result = after.previousActionResult;
    if (typeof result === 'string' && result.trim() && result !== '无' && result !== before?.previousActionResult) {
      row.previousActionResult = clip_ACU(result);
    }
    const task = after.shortTermAction ?? after.longTermAction;
    const beforeTask = before?.shortTermAction ?? before?.longTermAction;
    if (task && (task.status === 'done' || task.status === 'abandoned')) {
      row.completedAffair = { text: clip_ACU(task.text), status: task.status, outcome: task.outcome };
    } else if (beforeTask && (beforeTask.status === 'done' || beforeTask.status === 'abandoned') && task === null) {
      row.completedAffair = { text: clip_ACU(beforeTask.text), status: beforeTask.status, outcome: beforeTask.outcome };
    }
    const added = after.experiences.slice(before?.experiences.length ?? 0).slice(-EXPERIENCE_LIMIT_ACU);
    if (added.length) row.newExperiences = added.map(item => ({ text: clip_ACU(item.text), status: item.status, outcome: item.outcome, endedAtDay: item.endedAtDay }));
    if (before && after.life !== before.life) {
      row.life = after.life;
      if (after.deathSummary) row.deathSummary = clip_ACU(after.deathSummary);
    }
    if (row.isNew || row.previousActionResult || row.completedAffair || row.newExperiences || row.life) actors.push(row);
  }
  const events: WorldHistoryReviewEventChange_ACU[] = [];
  for (const write of candidate.worldEventWrites) {
    if (events.length >= WORLD_HISTORY_REVIEW_EVENT_LIMIT_ACU) break;
    const before = base.worldEvents.find(event => event.id === write.value.id);
    if (before && before.status === write.value.status && before.state === write.value.state) continue;
    events.push({ id: write.value.id, title: write.value.title, status: write.value.status,
      ...(before && before.status !== write.value.status ? { previousStatus: before.status } : {}),
      state: clip_ACU(write.value.state),
      ...(write.value.actorIds.length ? { actorIds: write.value.actorIds.slice(0, LINK_LIMIT_ACU) } : {}) });
  }
  const allHistory = [...base.historyMilestones, ...(base.historyArchive ?? [])];
  const catalog = [...allHistory].sort(newestFirst_ACU).slice(0, WORLD_HISTORY_REVIEW_CATALOG_LIMIT_ACU).map((item): WorldHistoryCatalogRow_ACU => ({
    id: item.id, summary: clip_ACU(item.summary), happenedAt: { ...item.happenedAt },
    actorIds: item.actorIds.slice(0, LINK_LIMIT_ACU), worldEventIds: item.worldEventIds.slice(0, LINK_LIMIT_ACU),
  }));
  const recordingMaterials = deliveryText.trim()
    ? allHistory.filter(item => !item.narrativeRecord).sort(newestFirst_ACU)
      .slice(0, WORLD_HISTORY_REVIEW_RECORDING_LIMIT_ACU).map(item => structuredClone(item)) : [];
  const changes = { facts, actors, events };
  const materials: WorldHistoryReviewMaterials_ACU = {
    changes, catalog, recordingMaterials, deliveryText: recordingMaterials.length ? deliveryText : '',
  };
  return hasWorldHistoryChanges_ACU(materials) ? materials : { ...materials, catalog: [] };
}

/** 放进 WORLD_RUNTIME_CONTEXT 的字段；没有的一类不出现。 */
export function worldHistoryReviewRuntimeContext_ACU(materials: WorldHistoryReviewMaterials_ACU | undefined): Record<string, unknown> {
  if (!materials) return {};
  return {
    ...(hasWorldHistoryChanges_ACU(materials) ? { historyChanges: materials.changes, historyCatalog: materials.catalog } : {}),
    ...(materials.recordingMaterials.length ? {
      historyRecordingMaterials: materials.recordingMaterials, historyDeliveryText: materials.deliveryText,
    } : {}),
  };
}

/** 联合审查固定协议中追加的重要历史职责说明（body 与仅审查两种请求共用；资料不存在的一类直接忽略）。 */
export function worldHistoryReviewDuty_ACU(materials: WorldHistoryReviewMaterials_ACU | undefined): string {
  if (!materials) return '';
  const parts: string[] = [];
  if (hasWorldHistoryChanges_ACU(materials)) {
    parts.push('其一，historyChanges 是本轮变化（本轮新写或改写的事实、人物完成的事务与上一轮行动结果、世界事件的状态变化），historyCatalog 是已有重要历史的紧凑目录，只用来避免重复。仅当变化已经构成人生节点时，才在 historyMilestoneWrites 新建重要历史：身份与关系的重大变化、重大得失、重要承诺与冲突的结果、伤病与死亡，以及足以改变人物之后处境或选择的遭遇；日常琐事、普通进餐、重复通勤和没有特殊结果的闲谈不记。每条形如 {"value":{"id":新ID,"summary":字符串,"happenedAt":{"day":整数,"slot":字符串},"actorIds":人物ID数组,"worldEventIds":事件ID数组,"locationRef":{"region":字符串,"place":字符串}或null,"sourceFactIds":来源事实ID数组,"importance":1至5整数,"category":字符串},"expectedRevision":0}。依据只能是 historyChanges 里的内容，来源事实、人物和事件只能使用真实 ID；不得重复 historyCatalog 已有的内容，不得改写既有历史；同一件事涉及多人时只建一条共享节点；没有值得记录的变化返回 []。');
  }
  if (materials.recordingMaterials.length) {
    parts.push('其二，historyRecordingMaterials 是已有的重要历史，historyDeliveryText 是本轮实际送达的投送资料。逐条对比这些历史、投送资料和冻结正文（ANCHOR_MESSAGE），只有同一件事已经投送、而且正文确实叙述了它的经过或结果，才在 historyRecordingCandidates 报告，每条形如 {"historyId":已有历史ID,"deliveryQuote":投送资料中的精确引文,"evidenceQuote":冻结正文中的精确引文}；仅出现姓名、计划、假设、否定，或投送了但正文没有采用，都不算。不改历史摘要，不自填 narrativeRecord，程序按本轮时钟和锚点标记“已被正文记录”并归档；没有可报告的返回 []。');
  }
  return parts.length ? `另有重要历史职责，只处理 WORLD_RUNTIME_CONTEXT 中实际出现的资料。${parts.join('')}历史判断不得影响场景、接触与语义审查结论。` : '';
}

/** 协议里 JSON 形状需要追加的字段声明。 */
export function worldHistoryReviewFields_ACU(materials: WorldHistoryReviewMaterials_ACU | undefined): string[] {
  if (!materials) return [];
  return [
    ...(hasWorldHistoryChanges_ACU(materials) ? ['"historyMilestoneWrites":[{"value":WorldHistoryMilestone对象,"expectedRevision":0}]'] : []),
    ...(materials.recordingMaterials.length ? ['"historyRecordingCandidates":[{"historyId":字符串,"deliveryQuote":字符串,"evidenceQuote":字符串}]'] : []),
  ];
}

/** WORLD_TASK 里的任务短语（不带标点）。 */
export function worldHistoryReviewTaskItems_ACU(materials: WorldHistoryReviewMaterials_ACU | undefined): string[] {
  if (!materials) return [];
  return [
    ...(hasWorldHistoryChanges_ACU(materials) ? ['依据 historyChanges 总结本轮形成的重要历史，在 historyMilestoneWrites 新建'] : []),
    ...(materials.recordingMaterials.length ? ['核对 historyRecordingMaterials 是否已被正文记录，在 historyRecordingCandidates 报告'] : []),
  ];
}

// ---------- 回复解析（宽容：别名、单对象、缺省、多余字段都不导致整批丢弃） ----------

function normalizeKey_ACU(key: string): string { return key.normalize('NFKC').replace(/[\s_-]/g, '').toLowerCase(); }
function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function pick_ACU(item: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const [key, value] of Object.entries(item)) if (aliases.includes(normalizeKey_ACU(key))) return value;
  return undefined;
}

const MILESTONE_LIST_KEYS_ACU = ['historymilestonewrites', 'historymilestones', 'historywrites', 'milestonewrites', 'milestones', 'newhistory', 'historyadditions'];
const RECORDING_LIST_KEYS_ACU = ['historyrecordingcandidates', 'historyrecordings', 'recordingcandidates', 'recordings', 'narrativerecords', 'recordedhistory'];

export interface WorldHistoryReply_ACU {
  milestones: unknown[];
  recordings: unknown[];
  /** 回复里出现了历史字段但形状无法使用（既不是数组也不是对象）。 */
  malformed: boolean;
}

/** 从已解析的审查回复里取出历史部分；永不抛错，缺失即空。 */
export function extractWorldHistoryReply_ACU(parsed: unknown): WorldHistoryReply_ACU {
  const result: WorldHistoryReply_ACU = { milestones: [], recordings: [], malformed: false };
  if (!isRecord_ACU(parsed)) return result;
  const take = (aliases: readonly string[]): unknown[] => {
    const entry = Object.entries(parsed).find(([key]) => aliases.includes(normalizeKey_ACU(key)));
    if (!entry || entry[1] == null) return [];
    if (Array.isArray(entry[1])) return entry[1];
    if (isRecord_ACU(entry[1])) return [entry[1]];
    result.malformed = true;
    return [];
  };
  result.milestones = take(MILESTONE_LIST_KEYS_ACU);
  result.recordings = take(RECORDING_LIST_KEYS_ACU);
  return result;
}

// ---------- 新建历史：宽容归一 + 结构完整性检查 ----------

export interface WorldHistoryNormalizeContext_ACU {
  /** 最终物化账本：被引用的人物、事件、事实 ID 必须存在于其中。 */
  ledger: WorldSimulationLedger_ACU;
  /** 提交前账本：与其已有历史 ID 冲突的跳过。 */
  base: WorldSimulationLedger_ACU;
  candidateClock: WorldClock_ACU;
}
export interface WorldHistorySkip_ACU { id?: string; reason: 'invalid-item' | 'id-conflict' | 'missing-summary' | 'unknown-actor' | 'unknown-event' | 'unknown-fact' }
type HistoryWrite_ACU = { value: WorldHistoryMilestone_ACU; expectedRevision: number };

const ID_PATTERN_ACU = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function textValue_ACU(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function resolveId_ACU(value: unknown, allowed: readonly string[], names?: ReadonlyMap<string, string>): string | undefined {
  const text = textValue_ACU(value);
  if (text === undefined) return undefined;
  if (allowed.includes(text)) return text;
  const lower = text.toLowerCase();
  const byId = allowed.filter(id => id.toLowerCase() === lower);
  if (byId.length === 1) return byId[0];
  if (names) {
    const byName = [...names].filter(([, name]) => name.trim().toLowerCase() === lower);
    if (byName.length === 1) return byName[0][0];
  }
  return undefined;
}

function list_ACU(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveRefs_ACU(
  value: unknown, allowed: readonly string[], names?: ReadonlyMap<string, string>,
): { ids: string[]; unresolved: boolean } {
  const ids: string[] = [];
  let unresolved = false;
  for (const raw of list_ACU(value)) {
    const id = resolveId_ACU(raw, allowed, names);
    if (id === undefined) unresolved = true;
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unresolved };
}

function dayValue_ACU(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const match = /\d+/.exec(value);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function happenedAt_ACU(raw: unknown, clock: WorldClock_ACU): WorldTime_ACU {
  let day: number | undefined;
  let slot = '';
  if (isRecord_ACU(raw)) {
    day = dayValue_ACU(pick_ACU(raw, ['day', 'days', 'dayno']));
    slot = textValue_ACU(pick_ACU(raw, ['slot', 'timeslot', 'period'])) ?? '';
  } else day = dayValue_ACU(raw);
  if (day === undefined || day < 1) return { day: clock.day, slot: slot || clock.slot };
  return { day: Math.min(day, clock.day), slot };
}

function location_ACU(raw: unknown): WorldLocationRef_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const region = textValue_ACU(pick_ACU(raw, ['region', 'area', 'zone']));
  if (!region) return null;
  const place = textValue_ACU(pick_ACU(raw, ['place', 'location', 'spot']));
  return place === undefined ? { region } : { region, place };
}

/**
 * 把联合审查回复里的 historyMilestoneWrites 归一为可保存的新建写入。宽容：接受 {value:{…}} 与裸对象、字段别名、缺省与多余字段、
 * 任意键序；一律只新建（expectedRevision 0、revision 1、visibility internal），不接受 narrativeRecord。
 * 只保留结构完整性检查：引用的人物、事件、事实必须存在于最终账本，ID 不得与已有历史或同批其他条目冲突。
 * 单条不满足的条目跳过并记入 skipped，不影响同批其他条目。
 */
export function normalizeWorldHistoryWrites_ACU(
  raws: readonly unknown[], context: WorldHistoryNormalizeContext_ACU,
): { writes: HistoryWrite_ACU[]; skipped: WorldHistorySkip_ACU[] } {
  const { ledger, base, candidateClock } = context;
  const existingHistoryIds = new Set([
    ...base.historyMilestones, ...(base.historyArchive ?? []), ...ledger.historyMilestones, ...(ledger.historyArchive ?? []),
  ].map(item => item.id));
  const actorIds = ledger.actors.map(actor => actor.id);
  const actorNames = new Map(ledger.actors.map(actor => [actor.id, actor.name] as const));
  const eventIds = ledger.worldEvents.map(event => event.id);
  const factIds = [...ledger.facts, ...(ledger.factArchive ?? [])].map(fact => fact.id);
  const writes: HistoryWrite_ACU[] = [];
  const skipped: WorldHistorySkip_ACU[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    if (!isRecord_ACU(raw)) { skipped.push({ reason: 'invalid-item' }); continue; }
    const wrapped = pick_ACU(raw, ['value', 'milestone', 'history']);
    const item = isRecord_ACU(wrapped) ? wrapped : raw;
    const summary = textValue_ACU(pick_ACU(item, ['summary', 'text', 'content', 'description', 'title']));
    const happenedAt = happenedAt_ACU(pick_ACU(item, ['happenedat', 'time', 'at', 'when']), candidateClock);
    let id = textValue_ACU(pick_ACU(item, ['id', 'historyid', 'milestoneid']));
    if (!summary) { skipped.push({ ...(id ? { id } : {}), reason: 'missing-summary' }); continue; }
    if (id === undefined || !ID_PATTERN_ACU.test(id)) id = `history-${sha256HexSync_ACU(`${summary}\n${happenedAt.day}`).slice(0, 24)}`;
    if (existingHistoryIds.has(id) || seen.has(id)) { skipped.push({ id, reason: 'id-conflict' }); continue; }
    const actors = resolveRefs_ACU(pick_ACU(item, ['actorids', 'actors', 'actorid', 'characters', 'participants']), actorIds, actorNames);
    if (actors.unresolved) { skipped.push({ id, reason: 'unknown-actor' }); continue; }
    const events = resolveRefs_ACU(pick_ACU(item, ['worldeventids', 'eventids', 'events', 'worldevents']), eventIds);
    if (events.unresolved) { skipped.push({ id, reason: 'unknown-event' }); continue; }
    const facts = resolveRefs_ACU(pick_ACU(item, ['sourcefactids', 'factids', 'sources', 'sourcefacts', 'facts']), factIds);
    if (facts.unresolved) { skipped.push({ id, reason: 'unknown-fact' }); continue; }
    const importanceRaw = pick_ACU(item, ['importance', 'level', 'weight']);
    const importanceNumber = typeof importanceRaw === 'string' ? Number(importanceRaw) : importanceRaw;
    const importance = typeof importanceNumber === 'number' && Number.isFinite(importanceNumber)
      ? Math.min(5, Math.max(1, Math.round(importanceNumber))) : 3;
    seen.add(id);
    writes.push({
      expectedRevision: 0,
      value: {
        id, summary, happenedAt, actorIds: actors.ids, worldEventIds: events.ids,
        locationRef: location_ACU(pick_ACU(item, ['locationref', 'location', 'place'])),
        sourceFactIds: facts.ids, importance,
        category: textValue_ACU(pick_ACU(item, ['category', 'type', 'kind'])) ?? '经历',
        visibility: 'internal', revision: 1, legacyRefs: [],
      },
    });
  }
  return { writes, skipped };
}

// ---------- 正文记录标记：引文核对（规则沿用原人物批） ----------

function historyQuote_ACU(value: unknown, source: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (source.includes(value)) return value;
  const normalize = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
  const quote = normalize(value);
  if (!quote) return undefined;
  let text = '';
  const positions: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const character of source) {
    const normalized = normalize(character);
    text += normalized;
    for (let index = 0; index < normalized.length; index++) positions.push({ start: offset, end: offset + character.length });
    offset += character.length;
  }
  const index = text.indexOf(quote);
  return index < 0 ? undefined : source.slice(positions[index].start, positions[index + quote.length - 1].end);
}

export type WorldHistoryRecording_ACU = NonNullable<WorldRoundCandidate_ACU['historyRecordings']>[number];

/**
 * 把 historyRecordingCandidates 按引文核对成待探测的记载：历史必须在提供的资料内，投送引文必须出自投送资料、
 * 证据引文必须出自冻结正文（空白与标点宽容）；同一历史只取第一条。是否能物化由调用方逐条探测。
 */
export function resolveWorldHistoryRecordings_ACU(
  raws: readonly unknown[], materials: readonly WorldHistoryMilestone_ACU[],
  input: { deliveryText: string; anchorText: string; candidateClock: WorldClock_ACU },
): WorldHistoryRecording_ACU[] {
  const allowed = materials.map(row => row.id);
  const result: WorldHistoryRecording_ACU[] = [];
  for (const raw of raws) {
    if (!isRecord_ACU(raw)) continue;
    const historyId = resolveId_ACU(pick_ACU(raw, ['historyid', 'id', 'milestoneid']), allowed);
    const history = materials.find(row => row.id === historyId);
    const deliveryQuote = historyQuote_ACU(pick_ACU(raw, ['deliveryquote', 'deliveredquote', 'deliverytext']), input.deliveryText);
    const evidenceQuote = historyQuote_ACU(pick_ACU(raw, ['evidencequote', 'narrativequote', 'bodyquote']), input.anchorText);
    if (!history || result.some(row => row.historyId === history.id) || !deliveryQuote || !evidenceQuote) continue;
    result.push({ historyId: history.id, expectedRevision: history.revision,
      record: { status: 'recorded', recordedAt: { day: input.candidateClock.day, slot: input.candidateClock.slot },
        anchorDigest: sha256HexSync_ACU(input.anchorText), deliveryQuote, evidenceQuote } });
  }
  return result;
}
