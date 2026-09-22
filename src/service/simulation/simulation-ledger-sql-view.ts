/**
 * service/simulation/simulation-ledger-sql-view.ts — 世界推演账本的 SQL 易失视图
 *
 * 与续写 agent-module-sql-view 同形态、独立实例：账本六数组模块（dimensions/seeds/
 * actors/chronicle/rumors/chronicleOverview）一模块一表行级维护，clock/player/guidance
 * 单行替换，编年归档按 archiveRef 行级 upsert/remove。revision 乐观锁在 SQL 层完成；
 * 变更行追踪后导出为 WorldSimulationLedgerDelta_ACU 的输入形态。库为纯易失视图：
 * 不写回二进制、不改持久化载体；任何物化或执行失败抛结构化错误，由调用方
 * fail-closed 回退现有 JSON 校验链。
 */

import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import {
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  type WorldClock_ACU,
  type WorldGuidance_ACU,
  type WorldPlayer_ACU,
  type WorldSimulationLedger_ACU,
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

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
}

/** 单行模块（clock/player/guidance）的整行替换。 */
export interface WorldSimulationSqlSingletonWrite_ACU {
  module: WorldSimulationSqlSingleton_ACU;
  value: WorldClock_ACU | WorldPlayer_ACU | WorldGuidance_ACU;
  expectedRevision: number;
}

/** 编年归档的一次行级写：按 archiveRef upsert/remove。 */
export interface WorldSimulationSqlArchiveWrite_ACU {
  upserts?: readonly WorldChronicleArchiveDetail_ACU[];
  removedRefs?: readonly string[];
}

/** 一次行级写应用后导出的变更行形态，与 diffWorldSimulationLedger_ACU 的输出同构。 */
export interface WorldSimulationSqlExportDelta_ACU {
  revision: number;
  upserts: Partial<Record<WorldSimulationSqlArrayModule_ACU, Array<Record<string, unknown>>>>;
  removedIds: Partial<Record<WorldSimulationSqlArrayModule_ACU, string[]>>;
  clock?: WorldClock_ACU;
  player?: WorldPlayer_ACU;
  guidance?: WorldGuidance_ACU;
}

export interface WorldSimulationLedgerSqlView_ACU {
  readonly engine: SqliteEngine;
  hasChanges(): boolean;
  applyArrayWrite(input: WorldSimulationSqlArrayWrite_ACU): number;
  applySingletonWrite(input: WorldSimulationSqlSingletonWrite_ACU): number;
  applyArchiveWrite(input: WorldSimulationSqlArchiveWrite_ACU): void;
  exportDelta(): WorldSimulationSqlExportDelta_ACU;
  exportArchiveRecords(): Record<string, WorldChronicleArchiveDetail_ACU>;
  readLedger(): WorldSimulationLedger_ACU;
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
    }
    for (const item of input.upserts ?? []) {
      const key = itemKey_ACU(item, idKey);
      engine.run(`INSERT INTO ${table} (row_key, payload) VALUES (?, ?) ON CONFLICT(row_key) DO UPDATE SET payload = excluded.payload`, [key, JSON.stringify(item)]);
      recordChange_ACU(engine, module, key, 'upsert', JSON.stringify(item));
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
    const next = current + 1;
    writeRevision_ACU(engine, next);
    engine.run('COMMIT');
    return next;
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
 * 把折叠后的推演账本（可选编年归档）物化进独立内存库并返回行级视图。
 * 引擎初始化、建表或条目装载失败抛结构化错误；调用方负责 fail-closed 回退 JSON 校验链。
 */
export async function materializeWorldSimulationLedgerSqlView_ACU(
  ledger: WorldSimulationLedger_ACU,
  archive?: WorldChronicleArchiveSnapshot_ACU,
  engine?: SqliteEngine,
): Promise<WorldSimulationLedgerSqlView_ACU> {
  const db = engine ?? new SqliteEngine();
  try {
    await db.init();
    createSchema_ACU(db);
    loadLedger_ACU(db, cloneJson_ACU(ledger));
    loadArchive_ACU(db, archive ? cloneJson_ACU(archive) : undefined);
  } catch (error) {
    db.dispose();
    if (error instanceof WorldSimulationSqlViewError_ACU) throw error;
    throw new WorldSimulationSqlViewError_ACU(`推演账本 SQL 视物化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hasLedgerChanges = (): boolean => Number(db.query(`SELECT COUNT(*) FROM ${CHANGES_TABLE_ACU}`).values[0]?.[0] ?? 0) > 0;
  const hasArchiveChanges = (): boolean => Number(db.query(`SELECT COUNT(*) FROM ${ARCHIVE_CHANGES_TABLE_ACU}`).values[0]?.[0] ?? 0) > 0;
  return {
    engine: db,
    hasChanges: () => hasLedgerChanges() || hasArchiveChanges(),
    applyArrayWrite: input => applyArrayWrite_ACU(db, input),
    applySingletonWrite: input => applySingletonWrite_ACU(db, input),
    applyArchiveWrite: input => applyArchiveWrite_ACU(db, input),
    exportDelta: () => exportDelta_ACU(db),
    exportArchiveRecords: () => exportArchiveRecords_ACU(db),
    readLedger: () => readLedger_ACU(db),
    dispose: () => db.dispose(),
  };
}
