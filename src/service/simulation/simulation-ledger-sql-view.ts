/**
 * service/simulation/simulation-ledger-sql-view.ts — 世界推演账本的 SQL 易失视图
 *
 * 与续写 agent-module-sql-view 同形态、独立实例：账本六数组模块（dimensions/seeds/
 * actors/chronicle/rumors/chronicleOverview）一模块一表行级维护，clock/player/guidance
 * 单行替换，编年归档按 archiveRef 行级 upsert/remove。revision 乐观锁在 SQL 层完成；
 * 变更行追踪后导出为 WorldSimulationLedgerDelta_ACU 的输入形态。库为纯易失视图：
 * 不写回二进制、不改持久化载体；任何物化或执行失败抛结构化错误，由调用方
 * fail-closed 回退现有 JSON 校验链。
 *
 * (module,id,field) 逐栏层：field_records/field_values 物化折叠派生的分栏视图（单例
 * clock/player/guidance 固定 ID '_'，chronicleOverview 不进逐栏层），applyFieldBatch
 * 把一次逐栏提交（接受的栏目写入 + 合并/提升后的领域整行 + 草稿丢弃）作为单批次复算，
 * 与折叠语义同序（先领域整行、后栏目写入、再按领域对账）；账本 revision 仅在批次含领域
 * 整行变化时推进一次，纯草稿批次不推进。field_changes 追踪后由 exportDelta 追加导出
 * fieldUpserts。栏目值比较一律用键序无关的规范化 JSON。
 */

import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import {
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU,
  WORLD_SIMULATION_SINGLETON_ID_ACU,
  type WorldClock_ACU,
  type WorldGuidance_ACU,
  type WorldPlayer_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationLedgerFieldRecord_ACU,
  type WorldSimulationLedgerFieldSnapshot_ACU,
  type WorldSimulationLedgerFieldStatus_ACU,
  type WorldSimulationLedgerFieldUpserts_ACU,
  type WorldSimulationLedgerFieldValue_ACU,
  type WorldSimulationLedgerFieldWrite_ACU,
  type WorldSimulationLedgerModule_ACU,
} from './model';
import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU,
  type WorldChronicleArchiveDetail_ACU,
  type WorldChronicleArchiveSnapshot_ACU,
} from './agent/agent-model';

/** 六个按 id/fingerprint 行级维护的数组模块及其主键字段。 */
const ARRAY_MODULES_ACU = [
  ['dimensions', 'id'],
  ['seeds', 'id'],
  ['actors', 'id'],
  ['chronicle', 'id'],
  ['rumors', 'id'],
  ['chronicleOverview', 'fingerprint'],
] as const;

export type WorldSimulationSqlArrayModule_ACU = typeof ARRAY_MODULES_ACU[number][0];
export type WorldSimulationSqlSingleton_ACU = 'clock' | 'player' | 'guidance';

const MODULE_TABLE_PREFIX_ACU = 'mod_';
const SINGLETON_TABLE_ACU = 'ledger_singleton';
const META_TABLE_ACU = 'ledger_meta';
const BASE_TABLE_ACU = 'ledger_base';
const CHANGES_TABLE_ACU = 'ledger_changes';
const ARCHIVE_TABLE_ACU = 'chronicle_archive';
const ARCHIVE_CHANGES_TABLE_ACU = 'chronicle_archive_changes';
const FIELD_RECORDS_TABLE_ACU = 'field_records';
const FIELD_VALUES_TABLE_ACU = 'field_values';
const FIELD_CHANGES_TABLE_ACU = 'field_changes';

/** 逐栏层覆盖的模块即栏目矩阵键；chronicleOverview 不在矩阵中，不进逐栏层。 */
const LEDGER_FIELD_MODULES_ACU = Object.keys(WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU) as WorldSimulationLedgerModule_ACU[];
const SINGLETON_FIELD_MODULES_ACU: ReadonlySet<string> = new Set(['clock', 'player', 'guidance']);

function isLedgerFieldModule_ACU(value: unknown): value is WorldSimulationLedgerModule_ACU {
  return typeof value === 'string' && (LEDGER_FIELD_MODULES_ACU as readonly string[]).includes(value);
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

function isArrayModule_ACU(value: unknown): value is WorldSimulationSqlArrayModule_ACU {
  return typeof value === 'string' && (ARRAY_MODULES_ACU as readonly (readonly [string, string])[]).some(([name]) => name === value);
}

function isSingleton_ACU(value: unknown): value is WorldSimulationSqlSingleton_ACU {
  return value === 'clock' || value === 'player' || value === 'guidance';
}

function arrayModuleIdKey_ACU(module: WorldSimulationSqlArrayModule_ACU): string {
  const found = (ARRAY_MODULES_ACU as readonly (readonly [string, string])[]).find(([name]) => name === module);
  return found ? found[1] : 'id';
}

function moduleTable_ACU(module: WorldSimulationSqlArrayModule_ACU): string {
  return `${MODULE_TABLE_PREFIX_ACU}${module}`;
}

/** SQL 视图层结构化失败：消息含模块与期望/实际 revision，供 fail-closed 诊断。 */
export class WorldSimulationSqlViewError_ACU extends Error {
  readonly module?: string;
  readonly expected?: number;
  readonly actual?: number;
  constructor(message: string, detail?: { module?: string; expected?: number; actual?: number }) {
    super(message);
    this.name = 'WorldSimulationSqlViewError_ACU';
    this.module = detail?.module;
    this.expected = detail?.expected;
    this.actual = detail?.actual;
  }
}


/** 数组模块的一次行级写：按主键（id/fingerprint）upsert/remove。 */
export interface WorldSimulationSqlArrayWrite_ACU {
  module: WorldSimulationSqlArrayModule_ACU;
  upserts?: readonly Record<string, unknown>[];
  removedIds?: readonly string[];
  /** 账本当前 revision 的乐观锁期望值；不匹配即在 SQL 层拒绝。 */
  expectedRevision: number;
  /** 只用于分栏层同步的栏目时间戳；缺省 0（行写复算路径不消费分栏层）。 */
  updatedAt?: number;
}

/** 单行模块（clock/player/guidance）的整行替换。 */
export interface WorldSimulationSqlSingletonWrite_ACU {
  module: WorldSimulationSqlSingleton_ACU;
  value: WorldClock_ACU | WorldPlayer_ACU | WorldGuidance_ACU;
  expectedRevision: number;
  /** 只用于分栏层同步的栏目时间戳；缺省 0。 */
  updatedAt?: number;
}

/** 编年归档的一次行级写：按 archiveRef upsert/remove。 */
export interface WorldSimulationSqlArchiveWrite_ACU {
  upserts?: readonly WorldChronicleArchiveDetail_ACU[];
  removedRefs?: readonly string[];
}

/**
 * 一次逐栏提交批次。与折叠语义同序复算：先落领域整行、再叠栏目写入、最后按领域对账
 * （领域里的 ID 重建栏目并按血统记 complete/legacy_unknown，领域外记录恒为 partial，
 * 无任何栏目的草稿删除）。账本 revision 仅在批次含领域整行变化时推进一次；
 * 纯草稿批次只校验乐观锁，不推进 revision。
 */
export interface WorldSimulationSqlFieldBatch_ACU {
  module: WorldSimulationLedgerModule_ACU;
  /** 账本级乐观锁期望值。 */
  expectedRevision: number;
  /** 写进栏目与记录的时间戳；必须与随后落盘 delta 的 updatedAt 一致。 */
  updatedAt: number;
  /** 接受的逐栏写入：ID → 栏目 → 写入值。单例模块只认固定 ID '_'。 */
  fieldWrites?: Record<string, Record<string, WorldSimulationLedgerFieldWrite_ACU>>;
  /** 合并/提升后变化的领域整行：ID → 完整条目；单例模块用 '_' → 单例对象。 */
  domainUpserts?: Record<string, unknown>;
  /** 丢弃的 partial 草稿 ID；完整条目按草稿丢弃即抛错（fail-closed）。 */
  discardPartialIds?: readonly string[];
  /** 完整条目删除（chronicle/数组）；与 fieldWrites 合批校验。 */
  domainRemovedIds?: readonly string[];
  /** 多模块写入同一账本时，仅一个领域批次推进账本 revision。 */
  advanceRevision?: boolean;
}

/** 一次行级写应用后导出的变更行形态，与 diffWorldSimulationLedger_ACU 的输出同构。 */
export interface WorldSimulationSqlExportDelta_ACU {
  revision: number;
  upserts: Partial<Record<WorldSimulationSqlArrayModule_ACU, Array<Record<string, unknown>>>>;
  removedIds: Partial<Record<WorldSimulationSqlArrayModule_ACU, string[]>>;
  clock?: WorldClock_ACU;
  player?: WorldPlayer_ACU;
  guidance?: WorldGuidance_ACU;
  /** 逐栏变更（接受的栏目写入与草稿撤销）；仅 applyFieldBatch 产生。 */
  fieldUpserts?: WorldSimulationLedgerFieldUpserts_ACU;
}

export interface WorldSimulationLedgerSqlView_ACU {
  readonly engine: SqliteEngine;
  hasChanges(): boolean;
  applyArrayWrite(input: WorldSimulationSqlArrayWrite_ACU): number;
  applySingletonWrite(input: WorldSimulationSqlSingletonWrite_ACU): number;
  applyArchiveWrite(input: WorldSimulationSqlArchiveWrite_ACU): void;
  /** 逐栏提交批次复算：一次乐观锁；含领域整行变化时账本 revision 推进一次。 */
  applyFieldBatch(input: WorldSimulationSqlFieldBatch_ACU): number;
  exportDelta(): WorldSimulationSqlExportDelta_ACU;
  exportArchiveRecords(): Record<string, WorldChronicleArchiveDetail_ACU>;
  readLedger(): WorldSimulationLedger_ACU;
  /** 读单条分栏记录（partial 的缺栏按模型必填栏推导；单例模块 ID 归一为 '_'）；不存在返回 null。 */
  readFieldRecord(module: WorldSimulationLedgerModule_ACU, id: string): WorldSimulationLedgerFieldRecord_ACU | null;
  /** 读全部（或单模块）partial 草稿记录。 */
  readPartialRecords(module?: WorldSimulationLedgerModule_ACU): WorldSimulationLedgerFieldRecord_ACU[];
  dispose(): void;
}

function createSchema_ACU(engine: SqliteEngine): void {
  for (const [module] of ARRAY_MODULES_ACU) {
    engine.run(`CREATE TABLE ${moduleTable_ACU(module)} (row_key TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  }
  engine.run(`CREATE TABLE ${SINGLETON_TABLE_ACU} (module TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  engine.run(`CREATE TABLE ${META_TABLE_ACU} (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
  engine.run(`CREATE TABLE ${BASE_TABLE_ACU} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  engine.run(`CREATE TABLE ${CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, change_key TEXT NOT NULL, change_kind TEXT NOT NULL, payload TEXT)`);
  engine.run(`CREATE TABLE ${ARCHIVE_TABLE_ACU} (archive_ref TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  engine.run(`CREATE TABLE ${ARCHIVE_CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, archive_ref TEXT NOT NULL, change_kind TEXT NOT NULL, payload TEXT)`);
  engine.run(`CREATE TABLE ${FIELD_RECORDS_TABLE_ACU} (module TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (module, id))`);
  engine.run(`CREATE TABLE ${FIELD_VALUES_TABLE_ACU} (module TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (module, id, field))`);
  engine.run(`CREATE TABLE ${FIELD_CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL)`);
}


function readRevision_ACU(engine: SqliteEngine): number {
  const rows = engine.query(`SELECT value FROM ${META_TABLE_ACU} WHERE key = 'revision'`).values;
  if (!rows.length) return 0;
  const value = Number(rows[0][0]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function writeRevision_ACU(engine: SqliteEngine, revision: number): void {
  engine.run(`UPDATE ${META_TABLE_ACU} SET value = ? WHERE key = 'revision'`, [revision]);
}

function recordChange_ACU(engine: SqliteEngine, module: string, key: string, kind: 'upsert' | 'remove' | 'replace', payload: string | null): void {
  engine.run(`INSERT INTO ${CHANGES_TABLE_ACU} (module, change_key, change_kind, payload) VALUES (?, ?, ?, ?)`, [module, key, kind, payload]);
}

/** 单例模块（clock/player/guidance）任何输入 ID 都归一为固定 ID；数组模块取非空 trimmed id。 */
function normalizeLedgerFieldRecordId_ACU(module: WorldSimulationLedgerModule_ACU, rawId: unknown): string {
  if (SINGLETON_FIELD_MODULES_ACU.has(module)) return WORLD_SIMULATION_SINGLETON_ID_ACU;
  return typeof rawId === 'string' ? rawId.trim() : '';
}

/** 领域条目的当前整行：单例读 ledger_singleton，数组模块读模块表；不在领域里返回 null。 */
function readLedgerDomainItem_ACU(engine: SqliteEngine, module: WorldSimulationLedgerModule_ACU, id: string): Record<string, unknown> | null {
  if (SINGLETON_FIELD_MODULES_ACU.has(module)) {
    const rows = engine.query(`SELECT payload FROM ${SINGLETON_TABLE_ACU} WHERE module = ?`, [module]).values;
    if (!rows.length) return null;
    const item = JSON.parse(String(rows[0][0]));
    return isRecord_ACU(item) ? item : null;
  }
  const rows = engine.query(`SELECT payload FROM ${moduleTable_ACU(module as WorldSimulationSqlArrayModule_ACU)} WHERE row_key = ?`, [id]).values;
  if (!rows.length) return null;
  const item = JSON.parse(String(rows[0][0]));
  return isRecord_ACU(item) ? item : null;
}

interface LedgerFieldRecordRow_ACU {
  status: WorldSimulationLedgerFieldStatus_ACU;
  updatedAt: number;
}

function readLedgerFieldRecordRow_ACU(engine: SqliteEngine, module: string, id: string): LedgerFieldRecordRow_ACU | null {
  const rows = engine.query(`SELECT status, updated_at FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
  if (!rows.length) return null;
  return { status: String(rows[0][0]) as WorldSimulationLedgerFieldStatus_ACU, updatedAt: Number(rows[0][1]) };
}

interface LedgerFieldValueRow_ACU {
  canonical: string;
  revision: number;
  updatedAt: number;
}

function readLedgerFieldValueRows_ACU(engine: SqliteEngine, module: string, id: string): Map<string, LedgerFieldValueRow_ACU> {
  const rows = engine.query(`SELECT field, value, revision, updated_at FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
  const map = new Map<string, LedgerFieldValueRow_ACU>();
  for (const row of rows) {
    map.set(String(row[0]), { canonical: String(row[1]), revision: Number(row[2]), updatedAt: Number(row[3]) });
  }
  return map;
}

function recordLedgerFieldChange_ACU(engine: SqliteEngine, module: string, id: string, field: string): void {
  engine.run(`INSERT INTO ${FIELD_CHANGES_TABLE_ACU} (module, id, field) VALUES (?, ?, ?)`, [module, id, field]);
}

/**
 * 领域整行驱动的分栏层同步（与折叠的领域对账同语义）：此前经逐栏写入或本批被点名的记录
 * 记为 complete，否则 legacy_unknown；值未变的栏目沿用原 revision，变化或新出现的栏目 +1
 * （baseline 播种一律 0）。整行驱动，不记 field_changes。
 */
function syncLedgerDomainRecordToFieldLayer_ACU(
  engine: SqliteEngine,
  module: WorldSimulationLedgerModule_ACU,
  id: string,
  item: Record<string, unknown>,
  updatedAt: number,
  namedInBatch: boolean,
  baseline = false,
): void {
  const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module];
  const previous = readLedgerFieldRecordRow_ACU(engine, module, id);
  const previousValues = readLedgerFieldValueRows_ACU(engine, module, id);
  const lineage = namedInBatch || previous?.status === 'partial' || previous?.status === 'complete';
  const nextValues = new Map<string, LedgerFieldValueRow_ACU>();
  let changed = !previous;
  for (const field of matrix.fields) {
    if (!Object.prototype.hasOwnProperty.call(item, field)) continue;
    const canonical = canonicalJson_ACU(item[field]);
    const prior = previousValues.get(field);
    if (prior && prior.canonical === canonical) {
      nextValues.set(field, prior);
      continue;
    }
    nextValues.set(field, { canonical, revision: baseline ? 0 : (prior?.revision ?? 0) + 1, updatedAt });
    changed = true;
  }
  if (previous && [...previousValues.keys()].some(field => !nextValues.has(field))) changed = true;
  engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
  for (const [field, entry] of nextValues) {
    engine.run(
      `INSERT INTO ${FIELD_VALUES_TABLE_ACU} (module, id, field, value, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [module, id, field, entry.canonical, entry.revision, entry.updatedAt],
    );
  }
  const recordUpdatedAt = changed || !previous ? updatedAt : previous.updatedAt;
  engine.run(
    `INSERT INTO ${FIELD_RECORDS_TABLE_ACU} (module, id, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(module, id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    [module, id, lineage ? 'complete' : 'legacy_unknown', recordUpdatedAt],
  );
}

/** 整条删除后的分栏层清理：partial 草稿保留，完整/旧条目记录随领域删除（与折叠对账一致）。 */
function pruneLedgerFieldRecordAfterDomainRemoval_ACU(engine: SqliteEngine, module: WorldSimulationLedgerModule_ACU, id: string): void {
  const row = readLedgerFieldRecordRow_ACU(engine, module, id);
  if (!row || row.status === 'partial') return;
  engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
  engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
}

/**
 * 物化分栏视图：提供折叠派生视图时按原样装载（无栏目的记录不装）；未提供时按领域条目播种，
 * 栏目 revision 从 0 起算、记为 legacy_unknown（与 seedLedgerFieldView_ACU 一致）。
 */
function loadLedgerFieldView_ACU(engine: SqliteEngine, ledger: WorldSimulationLedger_ACU, fields: WorldSimulationLedgerFieldSnapshot_ACU | undefined): void {
  if (fields) {
    for (const module of LEDGER_FIELD_MODULES_ACU) {
      const bucket = fields.records[module];
      if (!bucket) continue;
      const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module];
      for (const [rawId, record] of Object.entries(bucket)) {
        const id = normalizeLedgerFieldRecordId_ACU(module, record.id || rawId);
        const entries = Object.entries(record.fields ?? {});
        if (!id || !entries.length) continue;
        engine.run(
          `INSERT INTO ${FIELD_RECORDS_TABLE_ACU} (module, id, status, updated_at) VALUES (?, ?, ?, ?)`,
          [module, id, record.status, record.updatedAt],
        );
        for (const [field, entry] of entries) {
          if (!matrix.fields.includes(field)) continue;
          engine.run(
            `INSERT INTO ${FIELD_VALUES_TABLE_ACU} (module, id, field, value, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [module, id, field, canonicalJson_ACU(entry.value), entry.revision, entry.updatedAt],
          );
        }
      }
    }
    return;
  }
  for (const module of LEDGER_FIELD_MODULES_ACU) {
    if (SINGLETON_FIELD_MODULES_ACU.has(module)) {
      const value = (ledger as unknown as Record<string, unknown>)[module];
      if (isRecord_ACU(value)) {
        syncLedgerDomainRecordToFieldLayer_ACU(engine, module, WORLD_SIMULATION_SINGLETON_ID_ACU, value, 0, false, true);
      }
      continue;
    }
    for (const entry of (ledger as unknown as Record<string, unknown>)[module] as readonly unknown[]) {
      if (!isRecord_ACU(entry)) continue;
      const id = itemKey_ACU(entry, 'id');
      if (!id) continue;
      syncLedgerDomainRecordToFieldLayer_ACU(engine, module, id, entry, 0, false, true);
    }
  }
}

function buildLedgerFieldRecord_ACU(engine: SqliteEngine, module: WorldSimulationLedgerModule_ACU, id: string, row: LedgerFieldRecordRow_ACU): WorldSimulationLedgerFieldRecord_ACU {
  const values = readLedgerFieldValueRows_ACU(engine, module, id);
  const fields: Record<string, WorldSimulationLedgerFieldValue_ACU> = {};
  for (const [field, entry] of values) {
    fields[field] = { value: JSON.parse(entry.canonical), revision: entry.revision, updatedAt: entry.updatedAt };
  }
  const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module];
  return {
    module,
    id,
    status: row.status,
    fields,
    missingFields: row.status === 'partial' ? matrix.required.filter(field => !Object.prototype.hasOwnProperty.call(fields, field)) : [],
    updatedAt: row.updatedAt,
  };
}

function readLedgerFieldRecord_ACU(engine: SqliteEngine, module: WorldSimulationLedgerModule_ACU, id: string): WorldSimulationLedgerFieldRecord_ACU | null {
  if (!isLedgerFieldModule_ACU(module)) throw new WorldSimulationSqlViewError_ACU(`未知账本栏目模块: ${String(module)}`);
  const normalized = normalizeLedgerFieldRecordId_ACU(module, id);
  const row = readLedgerFieldRecordRow_ACU(engine, module, normalized);
  if (!row) return null;
  return buildLedgerFieldRecord_ACU(engine, module, normalized, row);
}

function readLedgerPartialRecords_ACU(engine: SqliteEngine, module?: WorldSimulationLedgerModule_ACU): WorldSimulationLedgerFieldRecord_ACU[] {
  if (module !== undefined && !isLedgerFieldModule_ACU(module)) throw new WorldSimulationSqlViewError_ACU(`未知账本栏目模块: ${String(module)}`);
  const records: WorldSimulationLedgerFieldRecord_ACU[] = [];
  for (const key of module ? [module] : LEDGER_FIELD_MODULES_ACU) {
    const rows = engine.query(`SELECT id, updated_at FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND status = 'partial' ORDER BY id`, [key]).values;
    for (const row of rows) {
      records.push(buildLedgerFieldRecord_ACU(engine, key, String(row[0]), { status: 'partial', updatedAt: Number(row[1]) }));
    }
  }
  return records;
}

function itemKey_ACU(item: unknown, idKey: string): string {
  if (!isRecord_ACU(item)) return '';
  const value = item[idKey];
  return typeof value === 'string' && value.trim() ? value : '';
}

function loadLedger_ACU(engine: SqliteEngine, ledger: WorldSimulationLedger_ACU): void {
  for (const [module, idKey] of ARRAY_MODULES_ACU) {
    const table = moduleTable_ACU(module);
    for (const entry of ledger[module] as unknown as readonly Record<string, unknown>[]) {
      const key = itemKey_ACU(entry, idKey);
      if (!key) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 存在无 ${idKey} 条目，无法物化进 SQL 视图`, { module });
      engine.run(`INSERT INTO ${table} (row_key, payload) VALUES (?, ?)`, [key, JSON.stringify(entry)]);
    }
  }
  engine.run(`INSERT INTO ${SINGLETON_TABLE_ACU} (module, payload) VALUES ('clock', ?)`, [JSON.stringify(ledger.clock)]);
  engine.run(`INSERT INTO ${SINGLETON_TABLE_ACU} (module, payload) VALUES ('player', ?)`, [JSON.stringify(ledger.player)]);
  engine.run(`INSERT INTO ${SINGLETON_TABLE_ACU} (module, payload) VALUES ('guidance', ?)`, [JSON.stringify(ledger.guidance)]);
  engine.run(`INSERT INTO ${META_TABLE_ACU} (key, value) VALUES ('revision', ?)`, [ledger.revision]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('materialCompletion', ?)`, [JSON.stringify(ledger.materialCompletion)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('pendingFixes', ?)`, [JSON.stringify(ledger.pendingFixes)]);
}

function loadArchive_ACU(engine: SqliteEngine, snapshot: WorldChronicleArchiveSnapshot_ACU | undefined): void {
  if (!snapshot) return;
  for (const [ref, detail] of Object.entries(snapshot.records)) {
    if (!ref.trim()) throw new WorldSimulationSqlViewError_ACU('编年归档存在空 archiveRef 记录，无法物化进 SQL 视图', { module: 'chronicleArchive' });
    engine.run(`INSERT INTO ${ARCHIVE_TABLE_ACU} (archive_ref, payload) VALUES (?, ?)`, [ref, JSON.stringify(detail)]);
  }
}


function applyArrayWrite_ACU(engine: SqliteEngine, input: WorldSimulationSqlArrayWrite_ACU): number {
  if (!isArrayModule_ACU(input.module)) {
    throw new WorldSimulationSqlViewError_ACU(`未知账本模块: ${String(input.module)}`);
  }
  const module = input.module;
  const idKey = arrayModuleIdKey_ACU(module);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  for (const item of input.upserts ?? []) {
    if (!itemKey_ACU(item, idKey)) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} upsert 条目缺少合法 ${idKey}`, { module });
  }
  for (const id of input.removedIds ?? []) {
    if (typeof id !== 'string' || !id.trim()) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} removedIds 含非法 id`, { module });
  }
  const table = moduleTable_ACU(module);
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine);
    if (current !== input.expectedRevision) {
      throw new WorldSimulationSqlViewError_ACU(`账本 revision 冲突（模块 ${module}）：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    for (const id of input.removedIds ?? []) {
      engine.run(`DELETE FROM ${table} WHERE row_key = ?`, [id]);
      recordChange_ACU(engine, module, id, 'remove', null);
      if (isLedgerFieldModule_ACU(module)) pruneLedgerFieldRecordAfterDomainRemoval_ACU(engine, module, id);
    }
    for (const item of input.upserts ?? []) {
      const key = itemKey_ACU(item, idKey);
      engine.run(`INSERT INTO ${table} (row_key, payload) VALUES (?, ?) ON CONFLICT(row_key) DO UPDATE SET payload = excluded.payload`, [key, JSON.stringify(item)]);
      recordChange_ACU(engine, module, key, 'upsert', JSON.stringify(item));
      if (isLedgerFieldModule_ACU(module)) syncLedgerDomainRecordToFieldLayer_ACU(engine, module, key, item, input.updatedAt ?? 0, false);
    }
    const next = current + 1;
    writeRevision_ACU(engine, next);
    engine.run('COMMIT');
    return next;
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}

function applySingletonWrite_ACU(engine: SqliteEngine, input: WorldSimulationSqlSingletonWrite_ACU): number {
  if (!isSingleton_ACU(input.module)) {
    throw new WorldSimulationSqlViewError_ACU(`未知单行模块: ${String(input.module)}`);
  }
  const module = input.module;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  if (!isRecord_ACU(input.value)) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 的替换值必须是对象`, { module });
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine);
    if (current !== input.expectedRevision) {
      throw new WorldSimulationSqlViewError_ACU(`账本 revision 冲突（模块 ${module}）：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    engine.run(`UPDATE ${SINGLETON_TABLE_ACU} SET payload = ? WHERE module = ?`, [JSON.stringify(input.value), module]);
    recordChange_ACU(engine, module, module, 'replace', JSON.stringify(input.value));
    syncLedgerDomainRecordToFieldLayer_ACU(engine, module, WORLD_SIMULATION_SINGLETON_ID_ACU, input.value as unknown as Record<string, unknown>, input.updatedAt ?? 0, false);
    const next = current + 1;
    writeRevision_ACU(engine, next);
    engine.run('COMMIT');
    return next;
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}

function applyLedgerFieldBatch_ACU(engine: SqliteEngine, input: WorldSimulationSqlFieldBatch_ACU): number {
  if (!isLedgerFieldModule_ACU(input.module)) {
    throw new WorldSimulationSqlViewError_ACU(`未知账本栏目模块: ${String(input.module)}`);
  }
  const module = input.module;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  if (!Number.isFinite(input.updatedAt) || input.updatedAt < 0) {
    throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 的 updatedAt 非法: ${String(input.updatedAt)}`, { module });
  }
  const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module];
  const singleton = SINGLETON_FIELD_MODULES_ACU.has(module);
  const writeIds = new Map<string, Record<string, WorldSimulationLedgerFieldWrite_ACU>>();
  for (const [rawId, writes] of Object.entries(input.fieldWrites ?? {})) {
    const id = normalizeLedgerFieldRecordId_ACU(module, rawId);
    if (!id) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 逐栏写入含非法 id`, { module });
    if (!isRecord_ACU(writes)) throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 的栏目写集必须是对象`, { module });
    const merged = writeIds.get(id) ?? {};
    for (const [field, write] of Object.entries(writes)) {
      if (!matrix.fields.includes(field)) {
        throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 的栏目 ${field} 不在栏目矩阵`, { module });
      }
      if (!isRecord_ACU(write) || (write.unset !== true && !Object.prototype.hasOwnProperty.call(write, 'value'))) {
        throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 的栏目 ${field} 写入必须给 value 或 unset`, { module });
      }
      merged[field] = write;
    }
    writeIds.set(id, merged);
  }
  const upsertIds = new Map<string, Record<string, unknown>>();
  for (const [rawId, payload] of Object.entries(input.domainUpserts ?? {})) {
    const id = normalizeLedgerFieldRecordId_ACU(module, rawId);
    if (!id) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 领域写含非法 id`, { module });
    if (!isRecord_ACU(payload)) throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 的领域写必须是对象`, { module });
    if (!singleton && itemKey_ACU(payload, 'id') !== id) {
      throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 领域写 id 不一致：键 ${id}，条目 ${itemKey_ACU(payload, 'id') || '(无 id)'}`, { module });
    }
    upsertIds.set(id, payload);
  }
  const removedIds = new Set<string>();
  for (const rawId of input.domainRemovedIds ?? []) {
    const id = normalizeLedgerFieldRecordId_ACU(module, rawId);
    if (!id || singleton) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 领域删除含非法 id`, { module });
    removedIds.add(id);
  }
  const discardIds = new Set<string>();
  for (const rawId of input.discardPartialIds ?? []) {
    const id = normalizeLedgerFieldRecordId_ACU(module, rawId);
    if (!id) throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 草稿丢弃含非法 id`, { module });
    discardIds.add(id);
  }
  if (!writeIds.size && !upsertIds.size && !discardIds.size && !removedIds.size) {
    throw new WorldSimulationSqlViewError_ACU(`模块 ${module} 的逐栏批次为空`, { module });
  }
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine);
    if (current !== input.expectedRevision) {
      throw new WorldSimulationSqlViewError_ACU(`账本 revision 冲突（模块 ${module}）：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    // 1) 领域整行先行（与折叠 applyLedgerDelta→fieldUpserts→reconcile 的写侧同序）
    for (const id of removedIds) {
      if (readLedgerDomainItem_ACU(engine, module, id) === null) throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 不存在完整领域行`, { module });
      engine.run(`DELETE FROM ${moduleTable_ACU(module as WorldSimulationSqlArrayModule_ACU)} WHERE row_key = ?`, [id]);
      recordChange_ACU(engine, module, id, 'remove', null);
      pruneLedgerFieldRecordAfterDomainRemoval_ACU(engine, module, id);
    }
    for (const [id, item] of upsertIds) {
      if (singleton) {
        engine.run(`UPDATE ${SINGLETON_TABLE_ACU} SET payload = ? WHERE module = ?`, [JSON.stringify(item), module]);
        recordChange_ACU(engine, module, module, 'replace', JSON.stringify(item));
      } else {
        engine.run(
          `INSERT INTO ${moduleTable_ACU(module as WorldSimulationSqlArrayModule_ACU)} (row_key, payload) VALUES (?, ?) ON CONFLICT(row_key) DO UPDATE SET payload = excluded.payload`,
          [id, JSON.stringify(item)],
        );
        recordChange_ACU(engine, module, id, 'upsert', JSON.stringify(item));
      }
    }
    // 2) 栏目写入：值未变不推进栏目 revision；unset 只适用于草稿
    for (const [id, writes] of writeIds) {
      const inDomain = readLedgerDomainItem_ACU(engine, module, id) !== null;
      engine.run(
        `INSERT INTO ${FIELD_RECORDS_TABLE_ACU} (module, id, status, updated_at) VALUES (?, ?, 'partial', ?) ON CONFLICT(module, id) DO NOTHING`,
        [module, id, input.updatedAt],
      );
      for (const [field, write] of Object.entries(writes)) {
        const rows = engine.query(`SELECT value, revision FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]).values;
        if (write.unset === true) {
          if (inDomain) {
            throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 是完整条目，栏目 ${field} 不能按草稿撤销`, { module });
          }
          if (rows.length) {
            engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]);
          }
          recordLedgerFieldChange_ACU(engine, module, id, field);
          continue;
        }
        const canonical = canonicalJson_ACU(write.value);
        if (rows.length && String(rows[0][0]) === canonical) {
          // 值未变不推进栏目 revision，但被点名的血统变化仍须可回放
          recordLedgerFieldChange_ACU(engine, module, id, field);
          continue;
        }
        const revision = rows.length ? Number(rows[0][1]) + 1 : 1;
        engine.run(
          `INSERT INTO ${FIELD_VALUES_TABLE_ACU} (module, id, field, value, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(module, id, field) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
          [module, id, field, canonical, revision, input.updatedAt],
        );
        recordLedgerFieldChange_ACU(engine, module, id, field);
      }
      engine.run(`UPDATE ${FIELD_RECORDS_TABLE_ACU} SET updated_at = ? WHERE module = ? AND id = ?`, [input.updatedAt, module, id]);
    }
    // 3) 丢弃草稿：完整条目按草稿丢弃即失败（fail-closed）
    for (const id of discardIds) {
      if (readLedgerDomainItem_ACU(engine, module, id) !== null) {
        throw new WorldSimulationSqlViewError_ACU(`模块 ${module}#${id} 是完整条目，不能按草稿丢弃`, { module });
      }
      const values = readLedgerFieldValueRows_ACU(engine, module, id);
      for (const field of values.keys()) recordLedgerFieldChange_ACU(engine, module, id, field);
      engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
      engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
    }
    // 4) 领域对账：领域里的 ID 重建栏目并按血统记状态；领域外恒 partial，无栏目草稿删除
    const touched = new Set<string>([...writeIds.keys(), ...upsertIds.keys()]);
    for (const id of touched) {
      const item = readLedgerDomainItem_ACU(engine, module, id);
      if (item !== null) {
        syncLedgerDomainRecordToFieldLayer_ACU(engine, module, id, item, input.updatedAt, writeIds.has(id));
        continue;
      }
      const remaining = engine.query(`SELECT COUNT(*) FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
      if (Number(remaining[0]?.[0] ?? 0) === 0) {
        engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
      } else {
        engine.run(`UPDATE ${FIELD_RECORDS_TABLE_ACU} SET status = 'partial' WHERE module = ? AND id = ?`, [module, id]);
      }
    }
    // 账本 revision 仅在领域整行变化时推进一次；纯草稿批次不推进
    if ((upsertIds.size || removedIds.size) && input.advanceRevision !== false) {
      writeRevision_ACU(engine, current + 1);
    }
    engine.run('COMMIT');
    return readRevision_ACU(engine);
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}

function applyArchiveWrite_ACU(engine: SqliteEngine, input: WorldSimulationSqlArchiveWrite_ACU): void {
  for (const item of input.upserts ?? []) {
    if (!item.archiveRef?.trim()) throw new WorldSimulationSqlViewError_ACU('归档 upsert 记录缺少合法 archiveRef', { module: 'chronicleArchive' });
  }
  for (const ref of input.removedRefs ?? []) {
    if (typeof ref !== 'string' || !ref.trim()) throw new WorldSimulationSqlViewError_ACU('归档 removedRefs 含非法 archiveRef', { module: 'chronicleArchive' });
  }
  engine.run('BEGIN');
  try {
    for (const ref of input.removedRefs ?? []) {
      engine.run(`DELETE FROM ${ARCHIVE_TABLE_ACU} WHERE archive_ref = ?`, [ref]);
      engine.run(`INSERT INTO ${ARCHIVE_CHANGES_TABLE_ACU} (archive_ref, change_kind, payload) VALUES (?, 'remove', NULL)`, [ref]);
    }
    for (const item of input.upserts ?? []) {
      engine.run(`INSERT INTO ${ARCHIVE_TABLE_ACU} (archive_ref, payload) VALUES (?, ?) ON CONFLICT(archive_ref) DO UPDATE SET payload = excluded.payload`, [item.archiveRef, JSON.stringify(item)]);
      engine.run(`INSERT INTO ${ARCHIVE_CHANGES_TABLE_ACU} (archive_ref, change_kind, payload) VALUES (?, 'upsert', ?)`, [item.archiveRef, JSON.stringify(item)]);
    }
    engine.run('COMMIT');
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}


interface LedgerChangeState_ACU {
  kind: 'upsert' | 'remove' | 'replace';
  payload: string | null;
}

/** 逐栏变更导出：同一 (module,id,field) 多次变更只导出最终状态；栏目行已不在则导出 unset。 */
function exportLedgerFieldUpserts_ACU(engine: SqliteEngine): WorldSimulationLedgerFieldUpserts_ACU | undefined {
  const rows = engine.query(`SELECT module, id, field FROM ${FIELD_CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const seen = new Map<string, { module: string; id: string; field: string }>();
  for (const row of rows) {
    const module = String(row[0]);
    const id = String(row[1]);
    const field = String(row[2]);
    const key = `${module} ${id} ${field}`;
    if (!seen.has(key)) seen.set(key, { module, id, field });
  }
  const upserts: WorldSimulationLedgerFieldUpserts_ACU = {};
  let touched = false;
  for (const { module, id, field } of seen.values()) {
    if (!isLedgerFieldModule_ACU(module)) continue;
    const valueRows = engine.query(`SELECT value FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]).values;
    const write: WorldSimulationLedgerFieldWrite_ACU = valueRows.length ? { value: JSON.parse(String(valueRows[0][0])) } : { unset: true };
    const bucket = (upserts[module] ??= {});
    const record = (bucket[id] ??= {});
    record[field] = write;
    touched = true;
  }
  engine.run(`DELETE FROM ${FIELD_CHANGES_TABLE_ACU}`);
  return touched ? upserts : undefined;
}

function exportDelta_ACU(engine: SqliteEngine): WorldSimulationSqlExportDelta_ACU {
  const rows = engine.query(`SELECT module, change_key, change_kind, payload FROM ${CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const byModule = new Map<string, Map<string, LedgerChangeState_ACU>>();
  for (const row of rows) {
    const module = String(row[0]);
    let bucket = byModule.get(module);
    if (!bucket) {
      bucket = new Map();
      byModule.set(module, bucket);
    }
    bucket.set(String(row[1]), { kind: row[2] as LedgerChangeState_ACU['kind'], payload: row[3] === null || row[3] === undefined ? null : String(row[3]) });
  }
  const upserts: Partial<Record<WorldSimulationSqlArrayModule_ACU, Array<Record<string, unknown>>>> = {};
  const removedIds: Partial<Record<WorldSimulationSqlArrayModule_ACU, string[]>> = {};
  let clock: WorldClock_ACU | undefined;
  let player: WorldPlayer_ACU | undefined;
  let guidance: WorldGuidance_ACU | undefined;
  for (const [module, bucket] of byModule) {
    if (isArrayModule_ACU(module)) {
      const upsertItems: Array<Record<string, unknown>> = [];
      const removed: string[] = [];
      for (const [key, state] of bucket) {
        if (state.kind === 'upsert' && state.payload !== null) upsertItems.push(JSON.parse(state.payload) as Record<string, unknown>);
        if (state.kind === 'remove') removed.push(key);
      }
      if (upsertItems.length) upserts[module] = upsertItems;
      if (removed.length) removedIds[module] = removed;
    } else if (isSingleton_ACU(module)) {
      const last = bucket.get(module);
      if (last?.kind === 'replace' && last.payload !== null) {
        if (module === 'clock') clock = JSON.parse(last.payload) as WorldClock_ACU;
        if (module === 'player') player = JSON.parse(last.payload) as WorldPlayer_ACU;
        if (module === 'guidance') guidance = JSON.parse(last.payload) as WorldGuidance_ACU;
      }
    }
  }
  engine.run(`DELETE FROM ${CHANGES_TABLE_ACU}`);
  const delta: WorldSimulationSqlExportDelta_ACU = {
    revision: readRevision_ACU(engine),
    upserts,
    removedIds,
  };
  if (clock !== undefined) delta.clock = clock;
  if (player !== undefined) delta.player = player;
  if (guidance !== undefined) delta.guidance = guidance;
  const fieldUpserts = exportLedgerFieldUpserts_ACU(engine);
  if (fieldUpserts) delta.fieldUpserts = fieldUpserts;
  return delta;
}

function exportArchiveRecords_ACU(engine: SqliteEngine): Record<string, WorldChronicleArchiveDetail_ACU> {
  const rows = engine.query(`SELECT archive_ref, change_kind, payload FROM ${ARCHIVE_CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const byRef = new Map<string, LedgerChangeState_ACU>();
  for (const row of rows) {
    byRef.set(String(row[0]), { kind: row[1] as LedgerChangeState_ACU['kind'], payload: row[2] === null || row[2] === undefined ? null : String(row[2]) });
  }
  const records: Record<string, WorldChronicleArchiveDetail_ACU> = {};
  for (const [ref, state] of byRef) {
    if (state.kind === 'upsert' && state.payload !== null) records[ref] = JSON.parse(state.payload) as WorldChronicleArchiveDetail_ACU;
  }
  engine.run(`DELETE FROM ${ARCHIVE_CHANGES_TABLE_ACU}`);
  return records;
}


function readLedger_ACU(engine: SqliteEngine): WorldSimulationLedger_ACU {
  const base = new Map(engine.query(`SELECT key, value FROM ${BASE_TABLE_ACU}`).values.map(row => [String(row[0]), String(row[1])]));
  const singletons = new Map(engine.query(`SELECT module, payload FROM ${SINGLETON_TABLE_ACU}`).values.map(row => [String(row[0]), String(row[1])]));
  const ledger = {
    schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU,
    revision: readRevision_ACU(engine),
    clock: JSON.parse(singletons.get('clock') ?? 'null'),
    dimensions: [],
    seeds: [],
    actors: [],
    chronicle: [],
    rumors: [],
    player: JSON.parse(singletons.get('player') ?? 'null'),
    guidance: JSON.parse(singletons.get('guidance') ?? 'null'),
    chronicleOverview: [],
    materialCompletion: JSON.parse(base.get('materialCompletion') ?? 'null'),
    pendingFixes: JSON.parse(base.get('pendingFixes') ?? '[]'),
  } as unknown as WorldSimulationLedger_ACU;
  for (const [module] of ARRAY_MODULES_ACU) {
    const rows = engine.query(`SELECT payload FROM ${moduleTable_ACU(module)} ORDER BY rowid`).values;
    (ledger as unknown as Record<string, unknown>)[module] = rows.map(row => JSON.parse(String(row[0])));
  }
  return ledger;
}

/**
 * 把折叠后的推演账本（可选编年归档、可选折叠派生分栏视图）物化进独立内存库并返回行级视图。
 * 未提供分栏视图时逐栏层按领域条目播种（栏目 revision 从 0 起算、记为 legacy_unknown）。
 * 引擎初始化、建表或条目装载失败抛结构化错误；调用方负责 fail-closed 回退 JSON 校验链。
 */
export async function materializeWorldSimulationLedgerSqlView_ACU(
  ledger: WorldSimulationLedger_ACU,
  archive?: WorldChronicleArchiveSnapshot_ACU,
  fields?: WorldSimulationLedgerFieldSnapshot_ACU,
  engine?: SqliteEngine,
): Promise<WorldSimulationLedgerSqlView_ACU> {
  const db = engine ?? new SqliteEngine();
  try {
    await db.init();
    createSchema_ACU(db);
    loadLedger_ACU(db, cloneJson_ACU(ledger));
    loadArchive_ACU(db, archive ? cloneJson_ACU(archive) : undefined);
    loadLedgerFieldView_ACU(db, ledger, fields ? cloneJson_ACU(fields) : undefined);
  } catch (error) {
    db.dispose();
    if (error instanceof WorldSimulationSqlViewError_ACU) throw error;
    throw new WorldSimulationSqlViewError_ACU(`推演账本 SQL 视物化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hasLedgerChanges = (): boolean => Number(db.query(`SELECT (SELECT COUNT(*) FROM ${CHANGES_TABLE_ACU}) + (SELECT COUNT(*) FROM ${FIELD_CHANGES_TABLE_ACU})`).values[0]?.[0] ?? 0) > 0;
  const hasArchiveChanges = (): boolean => Number(db.query(`SELECT COUNT(*) FROM ${ARCHIVE_CHANGES_TABLE_ACU}`).values[0]?.[0] ?? 0) > 0;
  return {
    engine: db,
    hasChanges: () => hasLedgerChanges() || hasArchiveChanges(),
    applyArrayWrite: input => applyArrayWrite_ACU(db, input),
    applySingletonWrite: input => applySingletonWrite_ACU(db, input),
    applyArchiveWrite: input => applyArchiveWrite_ACU(db, input),
    applyFieldBatch: input => applyLedgerFieldBatch_ACU(db, input),
    exportDelta: () => exportDelta_ACU(db),
    exportArchiveRecords: () => exportArchiveRecords_ACU(db),
    readLedger: () => readLedger_ACU(db),
    readFieldRecord: (module, id) => readLedgerFieldRecord_ACU(db, module, id),
    readPartialRecords: module => readLedgerPartialRecords_ACU(db, module),
    dispose: () => db.dispose(),
  };
}
