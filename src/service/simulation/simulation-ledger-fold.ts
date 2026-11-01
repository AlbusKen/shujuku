/**
 * service/simulation/simulation-ledger-fold.ts — 格林推演账本的楼层增量折叠
 *
 * STATE 分桶的当前 swipe 条目从全量账本改为 checkpoint + delta。
 * 读取按楼层顺序叠加；首楼 envelope.ledger 只是可重建缓存。
 * 编年归档用同一模式。会话分段已经按楼层增量存储，不在这里改写。
 */

import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  type WorldChronicleArchiveSnapshot_ACU,
  type WorldSimulationAnchorIdentity_ACU,
} from './agent/agent-model';
import {
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU,
  WORLD_SIMULATION_SINGLETON_ID_ACU,
  WorldSimulationValidationError_ACU,
  createWorldSimulationError_ACU,
  type WorldClock_ACU,
  type WorldFact_ACU,
  type WorldGuidance_ACU,
  type WorldHistoryMilestone_ACU,
  type WorldPlayer_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationLedgerFieldRecord_ACU,
  type WorldSimulationLedgerFieldSnapshot_ACU,
  type WorldSimulationLedgerFieldUpserts_ACU,
  type WorldSimulationLedgerFieldValue_ACU,
  type WorldSimulationLedgerFieldWrite_ACU,
  type WorldSimulationLedgerModule_ACU,
  type WorldSimulationPendingFix_ACU,
} from './model';
import { findLatestTableFullCheckpointIndex_ACU } from '../chat/material-checkpoint-sync';
import {
  buildWorldSimulationBucketEntries_ACU,
  resolveWorldSimulationBucketEntry_ACU,
  registerWorldSimulationLedgerOverlay_ACU,
  resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationChronicleArchiveSnapshot_ACU,
  validateWorldSimulationLedger_ACU,
} from './simulation-store';
import { validateWorldSimulationFieldSnapshot_ACU } from './simulation-field-snapshot';
import type { WorldSimulationEnvelope_ACU } from './model';

export const WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU = 2 as const;

const ARRAY_MODULES_ACU = [
  ['dimensions', 'id'],
  ['seeds', 'id'],
  ['actors', 'id'],
  ['worldEvents', 'id'],
  ['facts', 'id'],
  ['historyMilestones', 'id'],
  ['chronicle', 'id'],
  ['rumors', 'id'],
  ['chronicleOverview', 'fingerprint'],
] as const;

type ArrayModule_ACU = typeof ARRAY_MODULES_ACU[number][0];

export interface WorldSimulationLedgerDelta_ACU {
  seq: number;
  revision: number;
  upserts: Partial<Record<ArrayModule_ACU, Array<Record<string, unknown>>>>;
  removedIds: Partial<Record<ArrayModule_ACU, string[]>>;
  /** 逐栏增量写入：模块 → ID → 栏目。单例模块用固定 ID '_'；折叠先叠整条再叠逐栏。 */
  fieldUpserts?: WorldSimulationLedgerFieldUpserts_ACU;
  clock?: WorldClock_ACU;
  player?: WorldPlayer_ACU;
  guidance?: WorldGuidance_ACU;
  projection?: WorldSimulationLedger_ACU['projection'];
  /** 冷事实层与热层同属账本，必须随 delta 显式透传。 */
  factArchive?: WorldFact_ACU[];
  /** 保存轮次及冷事实入档轮次，空归档时仍要保留已推进计数。 */
  factArchiveRetention?: WorldSimulationLedger_ACU['factArchiveRetention'];
  /** 历史纪要冷层与热层同属账本，必须随 delta 显式透传。 */
  historyArchive?: WorldHistoryMilestone_ACU[];
  legacyMigration?: WorldSimulationLedger_ACU['legacyMigration'];
  materialCompletion?: WorldSimulationLedger_ACU['materialCompletion'];
  pendingFixes?: WorldSimulationPendingFix_ACU[];
  evidenceRefs?: string[];
  updatedAt: number;
}

export interface WorldSimulationLedgerFrame_ACU {
  schemaVersion: typeof WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU;
  checkpoint?: WorldSimulationLedger_ACU;
  /** 基线时刻的 partial 草稿栏目（只含值写入）。基线重建会越过其前的 delta，草稿必须随基线保存。 */
  checkpointPartials?: WorldSimulationLedgerFieldUpserts_ACU;
  /** 无损迁移基线；旧帧缺失时仍沿用既有分栏重建。 */
  checkpointFields?: WorldSimulationLedgerFieldSnapshot_ACU;
  /** 基线已包含的最大增量序号；序号不大于它的增量（含后续楼层上的）读取时不再重放。 */
  checkpointSeq?: number;
  deltas: WorldSimulationLedgerDelta_ACU[];
}

interface ArchiveDelta_ACU {
  seq: number;
  records: WorldChronicleArchiveSnapshot_ACU['records'];
}

interface ArchiveFrame_ACU {
  schemaVersion: typeof WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU;
  checkpoint?: WorldChronicleArchiveSnapshot_ACU;
  deltas: ArchiveDelta_ACU[];
}

export interface WorldSimulationLedgerFold_ACU {
  ledger: WorldSimulationLedger_ACU;
  /** 折叠派生的分栏视图（只读，绝不写回持久帧）。partial 记录只出现在这里，不并入完整账本。 */
  fields: WorldSimulationLedgerFieldSnapshot_ACU;
  evidenceRefs: string[];
  updatedAt: number;
  checkpointIndex: number | null;
  foldedDeltaCount: number;
  lastContributedIndex: number | null;
  contributedIndexes: number[];
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 键序无关的 JSON 文本，用于比较栏目值是否真的变化。 */
function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
}

const LEDGER_FIELD_MODULES_ACU = Object.keys(WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU) as WorldSimulationLedgerModule_ACU[];

function isLedgerFieldModule_ACU(value: string): value is WorldSimulationLedgerModule_ACU {
  return (LEDGER_FIELD_MODULES_ACU as readonly string[]).includes(value);
}

function isLedgerFieldWrite_ACU(value: unknown): value is WorldSimulationLedgerFieldWrite_ACU {
  return isRecord_ACU(value) && (value.unset === true || Object.prototype.hasOwnProperty.call(value, 'value'));
}

/**
 * 解析推演逐栏写集（持久化 delta、基线草稿或调用方输入）。结构损坏返回 null；未知模块或栏目名只忽略。
 * 单例模块的 ID 一律归一为固定 ID。
 */
export function parseWorldSimulationLedgerFieldUpserts_ACU(raw: unknown): WorldSimulationLedgerFieldUpserts_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const parsed: WorldSimulationLedgerFieldUpserts_ACU = {};
  for (const [moduleKey, moduleUpserts] of Object.entries(raw)) {
    if (!isRecord_ACU(moduleUpserts)) return null;
    if (!isLedgerFieldModule_ACU(moduleKey)) continue;
    const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[moduleKey];
    const kept: Record<string, Record<string, WorldSimulationLedgerFieldWrite_ACU>> = {};
    for (const [rawId, writes] of Object.entries(moduleUpserts)) {
      if (!isRecord_ACU(writes)) return null;
      const id = SINGLETON_MODULES_ACU.has(moduleKey) ? WORLD_SIMULATION_SINGLETON_ID_ACU : rawId.trim();
      if (!id) return null;
      const keptFields: Record<string, WorldSimulationLedgerFieldWrite_ACU> = {};
      for (const [field, write] of Object.entries(writes)) {
        if (!isLedgerFieldWrite_ACU(write)) return null;
        if (!matrix.fields.includes(field)) continue;
        keptFields[field] = write.unset === true ? { unset: true } : { value: cloneJson_ACU(write.value) };
      }
      if (Object.keys(keptFields).length) kept[id] = { ...(kept[id] ?? {}), ...keptFields };
    }
    if (Object.keys(kept).length) parsed[moduleKey] = kept;
  }
  return parsed;
}

function hasLedgerFieldUpserts_ACU(upserts: WorldSimulationLedgerFieldUpserts_ACU | null | undefined): upserts is WorldSimulationLedgerFieldUpserts_ACU {
  return !!upserts && Object.values(upserts).some(bucket => !!bucket && Object.keys(bucket).length > 0);
}

/** 折叠遇到结构损坏的逐栏写集时 fail-closed：与账本本体损坏一样抛结构化错误，不静默丢草稿。 */
function requireLedgerFieldUpserts_ACU(raw: unknown, path: string): WorldSimulationLedgerFieldUpserts_ACU {
  const parsed = parseWorldSimulationLedgerFieldUpserts_ACU(raw);
  if (!parsed) {
    throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${path} 逐栏写集结构损坏`, false, { path }));
  }
  return parsed;
}

function isAssistant_ACU(message: unknown): boolean {
  return isRecord_ACU(message) && message.is_user !== true && message.is_system !== true;
}

function invalidFloorValue_ACU(path: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${path} 结构损坏`, false, { path }));
}

function isStrictFoldField_ACU(field: string): boolean {
  return field === WORLD_SIMULATION_STATE_FIELD_ACU || field === WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU;
}

function bucketEntries_ACU(message: Record<string, unknown>, field: string): Record<string, { anchor?: WorldSimulationAnchorIdentity_ACU; value?: unknown }> {
  const raw = message[field];
  if (raw === undefined) return {};
  if (!isRecord_ACU(raw) || raw.schemaVersion !== 1 || !isRecord_ACU(raw.entries)) {
    if (isStrictFoldField_ACU(field)) invalidFloorValue_ACU(field);
    return {};
  }
  return raw.entries as Record<string, { anchor?: WorldSimulationAnchorIdentity_ACU; value?: unknown }>;
}

function entryValue_ACU(message: unknown, field: string, anchor: WorldSimulationAnchorIdentity_ACU): unknown {
  if (!isRecord_ACU(message)) return undefined;
  const entry = resolveWorldSimulationBucketEntry_ACU<unknown>(bucketEntries_ACU(message, field), anchor, field);
  if (entry === undefined) return undefined;
  return entry.value;
}

function writeEntry_ACU(message: Record<string, unknown>, field: string, anchor: WorldSimulationAnchorIdentity_ACU, value: unknown, updatedAt: number): void {
  const previous = message[field];
  const entries = isRecord_ACU(previous) && previous.schemaVersion === 1 && isRecord_ACU(previous.entries)
    ? { ...previous.entries }
    : {};
  message[field] = { schemaVersion: 1,
    entries: buildWorldSimulationBucketEntries_ACU(entries, anchor, value, updatedAt) };
}

function isLedgerValue_ACU(value: unknown): value is WorldSimulationLedger_ACU {
  return isRecord_ACU(value) && Number.isInteger(value.schemaVersion)
    && (value.schemaVersion as number) >= 1 && (value.schemaVersion as number) <= WORLD_LEDGER_SCHEMA_VERSION_ACU
    && isRecord_ACU(value.clock) && Array.isArray(value.dimensions) && Array.isArray(value.seeds)
    && Array.isArray(value.actors) && Array.isArray(value.chronicle) && isRecord_ACU(value.guidance);
}

function isLedgerFrame_ACU(value: unknown): value is WorldSimulationLedgerFrame_ACU {
  return isRecord_ACU(value) && value.schemaVersion === WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU && Array.isArray(value.deltas);
}

function evidenceFromMaterials_ACU(message: unknown, anchor: WorldSimulationAnchorIdentity_ACU): string[] | null {
  const value = entryValue_ACU(message, WORLD_SIMULATION_MATERIALS_FIELD_ACU, anchor);
  if (!isRecord_ACU(value) || !Array.isArray(value.evidenceRefs)) return null;
  if (value.evidenceRefs.some(item => typeof item !== 'string' || !item.trim())) return null;
  return [...value.evidenceRefs] as string[];
}

function itemId_ACU(item: Record<string, unknown>, idKey: string): string {
  const id = item[idKey];
  return typeof id === 'string' ? id : '';
}

function applyArrayModule_ACU(
  current: readonly Record<string, unknown>[],
  upserts: readonly Record<string, unknown>[] | undefined,
  removed: readonly string[] | undefined,
  idKey: string,
): Record<string, unknown>[] {
  const removedIds = new Set(removed ?? []);
  const replacements = new Map<string, Record<string, unknown>>();
  for (const item of upserts ?? []) {
    const id = itemId_ACU(item, idKey);
    if (id) replacements.set(id, item);
  }
  const next: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const id = itemId_ACU(item, idKey);
    if (!id || removedIds.has(id)) continue;
    if (replacements.has(id)) {
      next.push(cloneJson_ACU(replacements.get(id)!));
      seen.add(id);
    } else next.push(cloneJson_ACU(item));
  }
  for (const [id, item] of replacements) {
    if (!seen.has(id) && !removedIds.has(id)) next.push(cloneJson_ACU(item));
  }
  return next;
}

const SINGLETON_MODULES_ACU: ReadonlySet<string> = new Set(['clock', 'player', 'guidance']);

function emptyLedgerFieldView_ACU(): WorldSimulationLedgerFieldSnapshot_ACU {
  return { records: {} };
}

/** 账本里的条目按 ID 取出：单例模块（clock/player/guidance）固定 ID。 */
function domainLedgerEntriesOf_ACU(ledger: WorldSimulationLedger_ACU, module: WorldSimulationLedgerModule_ACU): Map<string, Record<string, unknown>> {
  const entries = new Map<string, Record<string, unknown>>();
  const value = (ledger as unknown as Record<string, unknown>)[module];
  if (SINGLETON_MODULES_ACU.has(module)) {
    if (isRecord_ACU(value)) entries.set(WORLD_SIMULATION_SINGLETON_ID_ACU, value);
    return entries;
  }
  if (!Array.isArray(value)) return entries;
  for (const item of value) {
    if (!isRecord_ACU(item)) continue;
    const id = itemId_ACU(item, 'id');
    if (id) entries.set(id, item);
  }
  return entries;
}

/** 从账本条目重建栏目：值未变的栏目沿用原 revision，变化或新出现的栏目 revision +1（基线为 0）。 */
function domainLedgerRecordFields_ACU(
  module: WorldSimulationLedgerModule_ACU,
  item: Record<string, unknown>,
  previous: WorldSimulationLedgerFieldRecord_ACU | undefined,
  updatedAt: number,
  baseline: boolean,
): { fields: Record<string, WorldSimulationLedgerFieldValue_ACU>; changed: boolean } {
  const fields: Record<string, WorldSimulationLedgerFieldValue_ACU> = {};
  let changed = !previous;
  for (const key of WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module].fields) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
    // 与续写侧同一纪律：归一化校验留下的显式 undefined 在 JSON 语义下就是缺席，跳过而不是拿去 clone。
    if (item[key] === undefined) continue;
    const value = cloneJson_ACU(item[key]);
    const prior = previous?.fields[key];
    if (prior && canonicalJson_ACU(prior.value) === canonicalJson_ACU(value)) {
      fields[key] = { value, revision: prior.revision, updatedAt: prior.updatedAt };
      continue;
    }
    fields[key] = { value, revision: baseline ? 0 : (prior?.revision ?? 0) + 1, updatedAt };
    changed = true;
  }
  if (previous && Object.keys(previous.fields).some(key => !Object.prototype.hasOwnProperty.call(fields, key))) changed = true;
  return { fields, changed };
}

/** 基线时刻的账本条目：栏目 revision 从 0 起算，记为 legacy_unknown。 */
export function seedLedgerFieldView_ACU(ledger: WorldSimulationLedger_ACU, updatedAt: number): WorldSimulationLedgerFieldSnapshot_ACU {
  const view = emptyLedgerFieldView_ACU();
  reconcileLedgerFieldViewWithLedger_ACU(view, ledger, updatedAt, true);
  return view;
}

/** 视图里的 partial 草稿栏目，按逐栏写集形态导出（只含值写入）。基线重建时随基线保存。 */
export function extractWorldSimulationPartialFields_ACU(view: WorldSimulationLedgerFieldSnapshot_ACU): WorldSimulationLedgerFieldUpserts_ACU {
  const partials: WorldSimulationLedgerFieldUpserts_ACU = {};
  for (const module of LEDGER_FIELD_MODULES_ACU) {
    const bucket = view.records[module];
    if (!bucket) continue;
    const kept: Record<string, Record<string, WorldSimulationLedgerFieldWrite_ACU>> = {};
    for (const [id, record] of Object.entries(bucket)) {
      if (record.status !== 'partial' || !Object.keys(record.fields).length) continue;
      kept[id] = Object.fromEntries(Object.entries(record.fields).map(([field, entry]) => [field, { value: cloneJson_ACU(entry.value) }]));
    }
    if (Object.keys(kept).length) partials[module] = kept;
  }
  return partials;
}

/** 草稿记录不在账本中，恒为 partial；缺栏按模型必填栏计算。 */
function recomputeLedgerPartialRecord_ACU(record: WorldSimulationLedgerFieldRecord_ACU): void {
  const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[record.module];
  record.missingFields = matrix.required.filter(key => !Object.prototype.hasOwnProperty.call(record.fields, key));
  record.status = 'partial';
}

/**
 * 把逐栏写集叠到视图上。被写到的记录先一律按草稿重算，随后的账本对账再把在账本里的 ID
 * 改回完整状态；值未变的重复写入不推进栏目 revision。
 */
export function applyLedgerFieldUpsertsToView_ACU(
  view: WorldSimulationLedgerFieldSnapshot_ACU,
  upserts: WorldSimulationLedgerFieldUpserts_ACU,
  updatedAt: number,
): WorldSimulationLedgerFieldSnapshot_ACU {
  const next: WorldSimulationLedgerFieldSnapshot_ACU = { records: {} };
  for (const module of LEDGER_FIELD_MODULES_ACU) {
    const bucket = view.records[module];
    if (bucket) next.records[module] = cloneJson_ACU(bucket) as Record<string, WorldSimulationLedgerFieldRecord_ACU>;
  }
  for (const module of LEDGER_FIELD_MODULES_ACU) {
    const moduleUpserts = upserts[module];
    if (!moduleUpserts) continue;
    const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module];
    const bucket = (next.records[module] ??= {});
    for (const [rawId, fieldWrites] of Object.entries(moduleUpserts)) {
      const stableId = SINGLETON_MODULES_ACU.has(module) ? WORLD_SIMULATION_SINGLETON_ID_ACU : String(rawId ?? '').trim();
      if (!stableId || !isRecord_ACU(fieldWrites)) continue;
      const record = (bucket[stableId] ??= { module, id: stableId, status: 'partial', fields: {}, missingFields: [], updatedAt: 0 });
      for (const [field, write] of Object.entries(fieldWrites as Record<string, WorldSimulationLedgerFieldWrite_ACU>)) {
        if (!matrix.fields.includes(field) || !isLedgerFieldWrite_ACU(write)) continue;
        if (write.unset === true) {
          delete record.fields[field];
          continue;
        }
        const previous = record.fields[field];
        const value = cloneJson_ACU(write.value);
        if (previous && canonicalJson_ACU(previous.value) === canonicalJson_ACU(value)) continue;
        record.fields[field] = { value, revision: (previous?.revision ?? 0) + 1, updatedAt };
      }
      record.updatedAt = updatedAt;
      recomputeLedgerPartialRecord_ACU(record);
    }
  }
  return next;
}

/**
 * 每条 delta 后的按 ID 对账。账本是完整条目的唯一来源：在账本里的 ID 按账本值重建栏目，此前经逐栏写入
 * （partial/complete）的记为 complete，其余记为 legacy_unknown；不在账本里的记录只保留仍有栏目的 partial 草稿。
 */
export function reconcileLedgerFieldViewWithLedger_ACU(
  view: WorldSimulationLedgerFieldSnapshot_ACU,
  ledger: WorldSimulationLedger_ACU,
  updatedAt: number,
  baseline = false,
): void {
  for (const module of LEDGER_FIELD_MODULES_ACU) {
    const bucket = (view.records[module] ??= {});
    const domain = domainLedgerEntriesOf_ACU(ledger, module);
    for (const [id, item] of domain) {
      const previous = bucket[id];
      const lineage = previous?.status === 'partial' || previous?.status === 'complete';
      const rebuilt = domainLedgerRecordFields_ACU(module, item, previous, updatedAt, baseline);
      bucket[id] = {
        module,
        id,
        status: lineage ? 'complete' : 'legacy_unknown',
        fields: rebuilt.fields,
        missingFields: [],
        updatedAt: rebuilt.changed || !previous ? updatedAt : previous.updatedAt,
      };
    }
    for (const id of Object.keys(bucket)) {
      if (domain.has(id)) continue;
      const record = bucket[id];
      if (record.status !== 'partial' || !Object.keys(record.fields).length) delete bucket[id];
    }
  }
}

/** 增量是否改动账本本身（区别于只写分栏草稿的 fieldUpserts 增量）。 */
function deltaChangesLedger_ACU(delta: WorldSimulationLedgerDelta_ACU): boolean {
  return Object.values(delta.upserts).some(items => Array.isArray(items) && items.length > 0)
    || Object.values(delta.removedIds).some(ids => Array.isArray(ids) && ids.length > 0)
    || (['clock', 'player', 'guidance', 'projection', 'factArchive', 'factArchiveRetention', 'historyArchive',
      'legacyMigration', 'materialCompletion', 'pendingFixes'] as const).some(key => delta[key] !== undefined);
}

function applyLedgerDelta_ACU(ledger: WorldSimulationLedger_ACU, delta: WorldSimulationLedgerDelta_ACU): WorldSimulationLedger_ACU {
  const next = cloneJson_ACU(ledger);
  for (const [moduleName, idKey] of ARRAY_MODULES_ACU) {
    const current = next[moduleName] as unknown as Record<string, unknown>[];
    next[moduleName] = applyArrayModule_ACU(current, delta.upserts[moduleName], delta.removedIds[moduleName], idKey) as never;
  }
  if (delta.clock) next.clock = cloneJson_ACU(delta.clock);
  if (delta.player) next.player = cloneJson_ACU(delta.player);
  if (delta.guidance) next.guidance = cloneJson_ACU(delta.guidance);
  if (delta.projection) next.projection = cloneJson_ACU(delta.projection);
  if (delta.factArchive !== undefined) next.factArchive = cloneJson_ACU(delta.factArchive);
  if (delta.factArchiveRetention !== undefined) next.factArchiveRetention = cloneJson_ACU(delta.factArchiveRetention);
  if (delta.historyArchive !== undefined) next.historyArchive = cloneJson_ACU(delta.historyArchive);
  if (delta.legacyMigration) next.legacyMigration = cloneJson_ACU(delta.legacyMigration);
  if (delta.materialCompletion) next.materialCompletion = cloneJson_ACU(delta.materialCompletion);
  if (delta.pendingFixes) next.pendingFixes = cloneJson_ACU(delta.pendingFixes);
  next.revision = delta.revision;
  return next;
}

export function diffWorldSimulationLedger_ACU(
  before: WorldSimulationLedger_ACU,
  after: WorldSimulationLedger_ACU,
  evidenceRefs: readonly string[] | undefined,
  updatedAt: number,
  seq: number,
): WorldSimulationLedgerDelta_ACU | null {
  const upserts: WorldSimulationLedgerDelta_ACU['upserts'] = {};
  const removedIds: WorldSimulationLedgerDelta_ACU['removedIds'] = {};
  let changed = before.revision !== after.revision;
  for (const [moduleName, idKey] of ARRAY_MODULES_ACU) {
    const previous = before[moduleName] as unknown as Record<string, unknown>[];
    const nextItems = after[moduleName] as unknown as Record<string, unknown>[];
    const previousById = new Map(previous.map(item => [itemId_ACU(item, idKey), item]));
    const nextIds = new Set(nextItems.map(item => itemId_ACU(item, idKey)));
    const moduleUpserts = nextItems.filter(item => {
      const id = itemId_ACU(item, idKey);
      const prior = previousById.get(id);
      return !prior || canonicalJson_ACU(prior) !== canonicalJson_ACU(item);
    });
    const moduleRemoved = previous.map(item => itemId_ACU(item, idKey)).filter(id => id && !nextIds.has(id));
    if (moduleUpserts.length) {
      upserts[moduleName] = cloneJson_ACU(moduleUpserts);
      changed = true;
    }
    if (moduleRemoved.length) {
      removedIds[moduleName] = moduleRemoved;
      changed = true;
    }
  }
  const delta: WorldSimulationLedgerDelta_ACU = { seq, revision: after.revision, upserts, removedIds, updatedAt };
  if (canonicalJson_ACU(before.clock) !== canonicalJson_ACU(after.clock)) {
    delta.clock = cloneJson_ACU(after.clock);
    changed = true;
  }
  if (canonicalJson_ACU(before.player) !== canonicalJson_ACU(after.player)) {
    delta.player = cloneJson_ACU(after.player);
    changed = true;
  }
  if (canonicalJson_ACU(before.guidance) !== canonicalJson_ACU(after.guidance)) {
    delta.guidance = cloneJson_ACU(after.guidance);
    changed = true;
  }
  if (canonicalJson_ACU(before.projection) !== canonicalJson_ACU(after.projection)) {
    delta.projection = cloneJson_ACU(after.projection);
    changed = true;
  }
  if (canonicalJson_ACU(before.factArchive) !== canonicalJson_ACU(after.factArchive)) {
    delta.factArchive = cloneJson_ACU(after.factArchive ?? []);
    changed = true;
  }
  if (canonicalJson_ACU(before.factArchiveRetention) !== canonicalJson_ACU(after.factArchiveRetention)) {
    if (after.factArchiveRetention !== undefined) delta.factArchiveRetention = cloneJson_ACU(after.factArchiveRetention);
    changed = true;
  }
  if (canonicalJson_ACU(before.historyArchive) !== canonicalJson_ACU(after.historyArchive)) {
    delta.historyArchive = cloneJson_ACU(after.historyArchive ?? []);
    changed = true;
  }
  if (canonicalJson_ACU(before.legacyMigration) !== canonicalJson_ACU(after.legacyMigration)) {
    delta.legacyMigration = cloneJson_ACU(after.legacyMigration);
    changed = true;
  }
  if (canonicalJson_ACU(before.materialCompletion) !== canonicalJson_ACU(after.materialCompletion)) {
    delta.materialCompletion = cloneJson_ACU(after.materialCompletion);
    changed = true;
  }
  if (canonicalJson_ACU(before.pendingFixes) !== canonicalJson_ACU(after.pendingFixes)) {
    delta.pendingFixes = cloneJson_ACU(after.pendingFixes);
    changed = true;
  }
  if (evidenceRefs) {
    delta.evidenceRefs = [...evidenceRefs];
    changed = true;
  }
  return changed ? delta : null;
}

function maxLedgerSeq_ACU(chat: readonly unknown[], throughIndex = chat.length - 1): number {
  let max = 0;
  for (const message of chat.slice(0, throughIndex + 1)) {
    if (!isRecord_ACU(message)) continue;
    for (const entry of Object.values(bucketEntries_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU))) {
      if (!isLedgerFrame_ACU(entry.value)) continue;
      for (const delta of entry.value.deltas) max = Math.max(max, delta.seq);
    }
  }
  return max;
}

export function foldWorldSimulationLedger_ACU(chat: readonly unknown[], throughIndex = chat.length - 1): WorldSimulationLedgerFold_ACU | null {
  let ledger: WorldSimulationLedger_ACU | null = null;
  let evidenceRefs: string[] = [];
  let updatedAt = 0;
  let checkpointIndex: number | null = null;
  let foldedDeltaCount = 0;
  let lastContributedIndex: number | null = null;
  const contributedIndexes: number[] = [];
  const end = Math.min(throughIndex, chat.length - 1);
  let view = emptyLedgerFieldView_ACU();
  // 基线可能被改写为包含后续楼层增量的状态；这些增量已在基线里，重放会把移入冷层的条目带回热层。
  let checkpointSeq: number | null = null;
  let checkpointRevision: number | null = null;
  const incorporated = (delta: WorldSimulationLedgerDelta_ACU): boolean => {
    if (checkpointSeq !== null) return delta.seq <= checkpointSeq;
    if (checkpointRevision === null) return false;
    return delta.revision < checkpointRevision || (delta.revision === checkpointRevision && deltaChangesLedger_ACU(delta));
  };

  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message)) continue;
    if (!Object.prototype.hasOwnProperty.call(message, WORLD_SIMULATION_STATE_FIELD_ACU)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
    if (isLedgerValue_ACU(value)) {
      ledger = validateWorldSimulationLedger_ACU(value, 'load');
      view = seedLedgerFieldView_ACU(ledger, updatedAt);
      checkpointSeq = null;
      checkpointRevision = ledger.revision;
      checkpointIndex = index;
      foldedDeltaCount = 0;
      lastContributedIndex = index;
      contributedIndexes.push(index);
      const materialsEvidence = evidenceFromMaterials_ACU(message, anchor);
      if (materialsEvidence) evidenceRefs = materialsEvidence;
      continue;
    }
    if (value === undefined) continue;
    if (!isLedgerFrame_ACU(value)) invalidFloorValue_ACU(`楼层 ${index} 账本帧`);
    let touched = false;
    if (value.checkpoint) {
      ledger = validateWorldSimulationLedger_ACU(value.checkpoint, 'load');
      view = seedLedgerFieldView_ACU(ledger, updatedAt);
      checkpointSeq = Number.isSafeInteger(value.checkpointSeq) ? value.checkpointSeq! : null;
      checkpointRevision = ledger.revision;
      if (value.checkpointPartials !== undefined) {
        view = applyLedgerFieldUpsertsToView_ACU(view, requireLedgerFieldUpserts_ACU(value.checkpointPartials, `楼层 ${index} checkpointPartials`), updatedAt);
        reconcileLedgerFieldViewWithLedger_ACU(view, ledger, updatedAt);
      }
      if (value.checkpointFields !== undefined) {
        view = validateWorldSimulationFieldSnapshot_ACU(value.checkpointFields);
        // 完整条目以账本为准；旧分栏基线只提供栏目修订及仍在草稿中的值。
        // 对账仅修改读取副本，不回写旧楼层。
        reconcileLedgerFieldViewWithLedger_ACU(view, ledger, updatedAt);
      }
      checkpointIndex = index;
      foldedDeltaCount = 0;
      touched = true;
    }
    for (const delta of [...value.deltas].sort((left, right) => left.seq - right.seq)) {
      if (!isRecord_ACU(delta) || !Number.isInteger(delta.seq) || !Number.isInteger(delta.revision)
        || !Number.isFinite(delta.updatedAt) || !isRecord_ACU(delta.upserts) || !isRecord_ACU(delta.removedIds)) {
        invalidFloorValue_ACU(`楼层 ${index} 账本 delta`);
      }
      if (!ledger) continue;
      if (incorporated(delta)) {
        touched = true;
        if (delta.evidenceRefs) evidenceRefs = [...delta.evidenceRefs];
        updatedAt = Math.max(updatedAt, delta.updatedAt);
        continue;
      }
      ledger = validateWorldSimulationLedger_ACU(applyLedgerDelta_ACU(ledger, delta), 'load');
      if (delta.fieldUpserts !== undefined) {
        view = applyLedgerFieldUpsertsToView_ACU(view, requireLedgerFieldUpserts_ACU(delta.fieldUpserts, `楼层 ${index} delta#${delta.seq}.fieldUpserts`), delta.updatedAt);
      }
      reconcileLedgerFieldViewWithLedger_ACU(view, ledger, delta.updatedAt);
      foldedDeltaCount += 1;
      touched = true;
      if (delta.evidenceRefs) evidenceRefs = [...delta.evidenceRefs];
      updatedAt = delta.updatedAt;
    }
    if (touched) {
      lastContributedIndex = index;
      contributedIndexes.push(index);
    }
  }
  if (!ledger) return null;
  return { ledger, fields: view, evidenceRefs, updatedAt, checkpointIndex, foldedDeltaCount, lastContributedIndex, contributedIndexes };
}

function isArchiveSnapshot_ACU(value: unknown): value is WorldChronicleArchiveSnapshot_ACU {
  return isRecord_ACU(value) && value.schemaVersion === 1 && isRecord_ACU(value.records);
}

function isArchiveFrame_ACU(value: unknown): value is ArchiveFrame_ACU {
  return isRecord_ACU(value) && value.schemaVersion === WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU && Array.isArray(value.deltas);
}

export function foldWorldSimulationArchive_ACU(chat: readonly unknown[], throughIndex = chat.length - 1): { snapshot: WorldChronicleArchiveSnapshot_ACU; checkpointIndex: number | null } {
  let records: WorldChronicleArchiveSnapshot_ACU['records'] = {};
  let checkpointIndex: number | null = null;
  const end = Math.min(throughIndex, chat.length - 1);
  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message)) continue;
    if (!Object.prototype.hasOwnProperty.call(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, anchor);
    if (isArchiveSnapshot_ACU(value)) {
      records = { ...validateWorldSimulationChronicleArchiveSnapshot_ACU(value, 'load').records };
      checkpointIndex = index;
      continue;
    }
    if (value === undefined) continue;
    if (!isArchiveFrame_ACU(value)) invalidFloorValue_ACU(`楼层 ${index} 归档帧`);
    if (value.checkpoint) {
      records = { ...validateWorldSimulationChronicleArchiveSnapshot_ACU(value.checkpoint, 'load').records };
      checkpointIndex = index;
    }
    for (const delta of [...value.deltas].sort((left, right) => left.seq - right.seq)) {
      if (!isRecord_ACU(delta) || !Number.isInteger(delta.seq) || !isRecord_ACU(delta.records)) invalidFloorValue_ACU(`楼层 ${index} 归档 delta`);
      records = { ...records, ...validateWorldSimulationChronicleArchiveSnapshot_ACU({ schemaVersion: 1, records: delta.records }, 'load').records };
    }
  }
  return { snapshot: { schemaVersion: 1, records }, checkpointIndex };
}

function clearActiveLedgerCheckpoints_ACU(chat: unknown[]): void {
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message) || !isRecord_ACU(message)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
    if (!isLedgerFrame_ACU(value) || !value.checkpoint) continue;
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      deltas: value.deltas,
    }, Date.now());
  }
}

/** 在楼层现有 STATE 帧后追加一条 delta，保留该帧的基线与基线草稿；旧整条账本值先转为基线。 */
function frameWithAppendedDelta_ACU(current: unknown, delta: WorldSimulationLedgerDelta_ACU): WorldSimulationLedgerFrame_ACU {
  if (isLedgerFrame_ACU(current)) {
    return {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      ...(current.checkpoint ? { checkpoint: current.checkpoint } : {}),
      ...(current.checkpointPartials ? { checkpointPartials: current.checkpointPartials } : {}),
      ...(current.checkpointFields ? { checkpointFields: current.checkpointFields } : {}),
      deltas: [...current.deltas, delta],
    };
  }
  if (isLedgerValue_ACU(current)) {
    return { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, checkpoint: cloneJson_ACU(current), deltas: [delta] };
  }
  return { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, deltas: [delta] };
}

/** 构造带基线的 STATE 帧；草稿为空时不写 checkpointPartials 键。 */
function checkpointFrame_ACU(
  checkpoint: WorldSimulationLedger_ACU,
  partials: WorldSimulationLedgerFieldUpserts_ACU,
  deltas: WorldSimulationLedgerDelta_ACU[],
): WorldSimulationLedgerFrame_ACU {
  const frame: WorldSimulationLedgerFrame_ACU = {
    schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
    checkpoint: cloneJson_ACU(checkpoint),
    deltas,
  };
  if (hasLedgerFieldUpserts_ACU(partials)) frame.checkpointPartials = cloneJson_ACU(partials);
  return frame;
}

/**
 * 提交链：按需把基线重建为提交前的完整账本（连同草稿），再在锚点楼追加本次提交的 delta。
 * beforePartials 与 beforeFields 使用提交前的同一账本快照，避免提交期间重新折叠造成基线漂移；
 * 调用方未提供时在改动聊天前自行折叠。
 */
export function appendWorldSimulationCommitChain_ACU(input: {
  chat: unknown[];
  messageIndex: number;
  anchor: WorldSimulationAnchorIdentity_ACU;
  beforeLedger: WorldSimulationLedger_ACU;
  nextLedger: WorldSimulationLedger_ACU;
  evidenceRefs: readonly string[];
  updatedAt: number;
  checkpointIndex: number | null;
  beforeArchive: WorldChronicleArchiveSnapshot_ACU;
  nextArchive: WorldChronicleArchiveSnapshot_ACU;
  beforePartials?: WorldSimulationLedgerFieldUpserts_ACU;
  /** 提交前捕获的分栏快照，与 beforeLedger 保持同一基线。 */
  beforeFields?: WorldSimulationLedgerFieldSnapshot_ACU;
}): void {
  const message = input.chat[input.messageIndex];
  if (!isRecord_ACU(message)) return;
  // 只读提交目标及之前的活跃 swipe；未来楼层或非活跃分桶不能充当提交前状态。
  const foldedBefore = input.beforeFields ? null : foldWorldSimulationLedger_ACU(input.chat, input.messageIndex);
  let activeCheckpointFields: WorldSimulationLedgerFieldSnapshot_ACU | undefined;
  for (let index = 0; index <= input.messageIndex; index += 1) {
    const floor = input.chat[index];
    if (!isAssistant_ACU(floor)) continue;
    let activeAnchor: WorldSimulationAnchorIdentity_ACU;
    try {
      activeAnchor = resolveWorldSimulationAnchor_ACU(index, input.chat as any[]);
    } catch {
      continue;
    }
    const activeValue = entryValue_ACU(floor, WORLD_SIMULATION_STATE_FIELD_ACU, activeAnchor);
    if (isLedgerValue_ACU(activeValue)) activeCheckpointFields = undefined;
    else if (isLedgerFrame_ACU(activeValue) && activeValue.checkpoint) {
      activeCheckpointFields = activeValue.checkpointFields === undefined
        ? undefined : validateWorldSimulationFieldSnapshot_ACU(activeValue.checkpointFields);
    }
  }
  const sourceFields = input.beforeFields !== undefined
    ? validateWorldSimulationFieldSnapshot_ACU(input.beforeFields)
    : foldedBefore?.fields !== undefined
      ? validateWorldSimulationFieldSnapshot_ACU(foldedBefore.fields)
      : activeCheckpointFields;
  const beforeFields = sourceFields ? cloneJson_ACU(sourceFields) : undefined;
  if (beforeFields) reconcileLedgerFieldViewWithLedger_ACU(beforeFields, input.beforeLedger, input.updatedAt);
  const partials = input.beforePartials !== undefined
    ? requireLedgerFieldUpserts_ACU(input.beforePartials, '提交前草稿')
    : sourceFields ? extractWorldSimulationPartialFields_ACU(sourceFields) : {};
  const seq = maxLedgerSeq_ACU(input.chat) + 1;
  // beforeLedger 已折叠到目标楼层为止的全部增量；写入的基线据此标记，避免读取时再重放这些增量。
  const incorporatedSeq = maxLedgerSeq_ACU(input.chat, input.messageIndex);
  const delta = diffWorldSimulationLedger_ACU(input.beforeLedger, input.nextLedger, input.evidenceRefs, input.updatedAt, seq);
  const baselineFloorCandidate = input.checkpointIndex ?? ensureWorldSimulationBaselineFloor_ACU(input.chat, input.messageIndex);
  const baselineFloor = baselineFloorCandidate !== null && baselineFloorCandidate <= input.messageIndex ? baselineFloorCandidate : null;
  let baselineAnchor: WorldSimulationAnchorIdentity_ACU | null = null;
  if (baselineFloor !== null && baselineFloor !== input.messageIndex && isRecord_ACU(input.chat[baselineFloor])) {
    try {
      baselineAnchor = resolveWorldSimulationAnchor_ACU(baselineFloor, input.chat as any[]);
    } catch {
      baselineAnchor = null;
    }
  }
  const installCheckpoint = baselineAnchor === null;
  // 已校验的分栏快照按当前账本对账，合法过时的完整栏目不构成结构损坏。
  // 没有分栏基线时仍随 checkpointPartials 保存真实草稿。
  if (baselineAnchor && baselineFloor !== null) {
    const baselineMessage = input.chat[baselineFloor] as Record<string, unknown>;
    const frame = checkpointFrame_ACU(input.beforeLedger, partials, []);
    if (beforeFields) frame.checkpointFields = beforeFields;
    frame.checkpointSeq = incorporatedSeq;
    writeEntry_ACU(baselineMessage, WORLD_SIMULATION_STATE_FIELD_ACU, baselineAnchor, frame, input.updatedAt);
    writeEntry_ACU(baselineMessage, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, baselineAnchor, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: cloneJson_ACU(input.beforeArchive),
      deltas: [],
    }, input.updatedAt);
  }
  if (installCheckpoint) {
    clearActiveLedgerCheckpoints_ACU(input.chat);
    const frame = checkpointFrame_ACU(delta ? input.beforeLedger : input.nextLedger, partials, delta ? [delta] : []);
    if (beforeFields) frame.checkpointFields = beforeFields;
    frame.checkpointSeq = incorporatedSeq;
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor, frame, input.updatedAt);
  } else if (delta) {
    const current = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor);
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor, frameWithAppendedDelta_ACU(current, delta), input.updatedAt);
  }

  const changedRecords: WorldChronicleArchiveSnapshot_ACU['records'] = {};
  for (const [archiveRef, record] of Object.entries(input.nextArchive.records)) {
    if (canonicalJson_ACU(input.beforeArchive.records[archiveRef]) !== canonicalJson_ACU(record)) changedRecords[archiveRef] = record;
  }
  const archiveValue = entryValue_ACU(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, input.anchor);
  const archiveFrame: ArchiveFrame_ACU = isArchiveFrame_ACU(archiveValue)
    ? {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      ...(archiveValue.checkpoint ? { checkpoint: archiveValue.checkpoint } : {}),
      deltas: [...archiveValue.deltas],
    }
    : { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, deltas: [] };
  if (installCheckpoint) {
    archiveFrame.checkpoint = cloneJson_ACU(Object.keys(changedRecords).length ? input.beforeArchive : input.nextArchive);
    archiveFrame.deltas = Object.keys(changedRecords).length ? [{ seq, records: changedRecords }] : [];
  } else if (Object.keys(changedRecords).length) {
    archiveFrame.deltas = [...archiveFrame.deltas, { seq, records: changedRecords }];
  } else {
    return;
  }
  writeEntry_ACU(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, input.anchor, archiveFrame, input.updatedAt);
}

export function relocateWorldSimulationCheckpoint_ACU(chat: unknown[], anchorIndex: number): boolean {
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || !isAssistant_ACU(chat[anchorIndex])) return false;
  const folded = foldWorldSimulationLedger_ACU(chat, anchorIndex);
  if (!folded) return false;
  let anchor: WorldSimulationAnchorIdentity_ACU;
  try {
    anchor = resolveWorldSimulationAnchor_ACU(anchorIndex, chat as any[]);
  } catch {
    return false;
  }
  for (let index = 0; index <= anchorIndex; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message) || !isRecord_ACU(message)) continue;
    let current: WorldSimulationAnchorIdentity_ACU;
    try {
      current = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, current);
    if (!isLedgerFrame_ACU(value)) continue;
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, current, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      deltas: index < anchorIndex ? [] : value.deltas,
    }, Date.now());
  }
  writeEntry_ACU(
    chat[anchorIndex] as Record<string, unknown>,
    WORLD_SIMULATION_STATE_FIELD_ACU,
    anchor,
    { ...checkpointFrame_ACU(folded.ledger, extractWorldSimulationPartialFields_ACU(folded.fields), []),
      checkpointFields: cloneJson_ACU(folded.fields) },
    folded.updatedAt || Date.now(),
  );
  return true;
}

export function readFoldedWorldSimulationLedgerForEnvelope_ACU(envelope: WorldSimulationEnvelope_ACU, chat: readonly unknown[]): WorldSimulationEnvelope_ACU {
  const folded = foldWorldSimulationLedger_ACU(chat);
  if (!folded) return envelope;
  return { ...envelope, ledger: folded.ledger };
}

/** 删楼守卫嫁接用的基线制品：账本基线连同基线草稿。 */
export interface WorldSimulationLedgerCheckpointArtifact_ACU {
  anchor: WorldSimulationAnchorIdentity_ACU;
  ledger: WorldSimulationLedger_ACU;
  partials?: WorldSimulationLedgerFieldUpserts_ACU;
  fields?: WorldSimulationLedgerFieldSnapshot_ACU;
}

export function simulationLedgerCheckpointArtifact_ACU(message: unknown): WorldSimulationLedgerCheckpointArtifact_ACU | null {
  if (!isRecord_ACU(message)) return null;
  for (const entry of Object.values(bucketEntries_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU))) {
    if (!entry.anchor) continue;
    if (isLedgerFrame_ACU(entry.value) && entry.value.checkpoint) {
      const artifact: WorldSimulationLedgerCheckpointArtifact_ACU = { anchor: cloneJson_ACU(entry.anchor), ledger: cloneJson_ACU(entry.value.checkpoint) };
      if (entry.value.checkpointPartials) artifact.partials = cloneJson_ACU(entry.value.checkpointPartials);
      if (entry.value.checkpointFields) artifact.fields = validateWorldSimulationFieldSnapshot_ACU(entry.value.checkpointFields);
      return artifact;
    }
    if (isLedgerValue_ACU(entry.value)) {
      return { anchor: cloneJson_ACU(entry.anchor), ledger: cloneJson_ACU(entry.value) };
    }
  }
  return null;
}

export function graftSimulationLedgerCheckpoint_ACU(
  chat: unknown[],
  message: unknown,
  artifact: WorldSimulationLedgerCheckpointArtifact_ACU,
): boolean {
  if (!isRecord_ACU(message)) return false;
  const index = chat.indexOf(message);
  if (index < 0) return false;
  let anchor: WorldSimulationAnchorIdentity_ACU;
  try {
    anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
  } catch {
    return false;
  }
  const current = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
  if ((isLedgerFrame_ACU(current) && current.checkpoint) || isLedgerValue_ACU(current)) return false;
  const frame = checkpointFrame_ACU(artifact.ledger, artifact.partials ?? {}, isLedgerFrame_ACU(current) ? current.deltas : []);
  if (artifact.fields) frame.checkpointFields = validateWorldSimulationFieldSnapshot_ACU(artifact.fields);
  writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor, frame, Date.now());
  return true;
}

export function assertSingleActiveSimulationCheckpoint_ACU(chat: readonly unknown[]): string | null {
  let seen: number | null = null;
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
    const active = (isLedgerFrame_ACU(value) && !!value.checkpoint) || isLedgerValue_ACU(value);
    if (!active) continue;
    if (seen !== null) return `格林推演账本存在多个活跃基线：楼层 ${seen} 与 ${index}`;
    seen = index;
  }
  return null;
}

export function ensureWorldSimulationBaselineFloor_ACU(chat: readonly unknown[], latestAiIndex: number): number | null {
  const tableAnchor = findLatestTableFullCheckpointIndex_ACU(chat);
  if (tableAnchor !== null && isAssistant_ACU(chat[tableAnchor])) return tableAnchor;
  if (latestAiIndex >= 0 && isAssistant_ACU(chat[latestAiIndex])) return latestAiIndex;
  return null;
}

/**
 * 把逐栏写集作为一条 fieldUpserts delta 追加到目标楼层的 STATE 帧。
 * 不产生 checkpoint、不触碰账本数组；缺栏记录经折叠只进入受控分栏视图。
 * 目标楼当前还是整条账本值时先转为基线再挂 delta，避免覆盖丢基线；
 * 折叠不到任何账本（无基线）时 fail-closed 返回 false，不伪称已写入。
 */
export function appendWorldSimulationFieldDeltaChain_ACU(input: {
 chat: unknown[];
  messageIndex: number;
  anchor: WorldSimulationAnchorIdentity_ACU;
  fieldUpserts: WorldSimulationLedgerFieldUpserts_ACU;
  updatedAt: number;
}): boolean {
  const message = input.chat[input.messageIndex];
  if (!isRecord_ACU(message)) return false;
  const folded = foldWorldSimulationLedger_ACU(input.chat, input.messageIndex);
  if (!folded) return false;
  const cleaned = parseWorldSimulationLedgerFieldUpserts_ACU(input.fieldUpserts);
  if (!hasLedgerFieldUpserts_ACU(cleaned)) return false;
  const delta: WorldSimulationLedgerDelta_ACU = {
    seq: maxLedgerSeq_ACU(input.chat) + 1,
    revision: folded.ledger.revision,
    upserts: {},
    removedIds: {},
    fieldUpserts: cleaned,
    updatedAt: input.updatedAt,
  };
  const current = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor);
  writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor, frameWithAppendedDelta_ACU(current, delta), input.updatedAt);
  return true;
}

/** 读取推演账本的分栏视图（模块 → ID → 栏目）。没有任何账本时返回空视图。 */
export function readWorldSimulationLedgerFieldSnapshot_ACU(chat: readonly unknown[]): WorldSimulationLedgerFieldSnapshot_ACU {
  const folded = foldWorldSimulationLedger_ACU(chat);
  return folded ? folded.fields : emptyLedgerFieldView_ACU();
}


registerWorldSimulationLedgerOverlay_ACU((envelope, chat) => readFoldedWorldSimulationLedgerForEnvelope_ACU(envelope, chat as unknown[]));
