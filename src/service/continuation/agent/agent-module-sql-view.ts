/**
 * service/continuation/agent/agent-module-sql-view.ts — 续写资料快照的 SQL 易失视图
 *
 * 把折叠后的楼层快照物化进独立 SqliteEngine 内存库：一模块一表，条目 id 为主键，
 * 模块 revision 入 module_meta 表。行级 upsert/remove 与 revision 校验在 SQL 层完成，
 * 变更行经 module_changes 追踪后导出为 AgentModuleFloorDelta_ACU 的 writes/removedIds/revisions
 * 形态，交给既有 diff/帧写回链。库为纯易失视图：不写回二进制、不改持久化载体；
 * 任何物化或执行失败抛结构化错误，由调用方 fail-closed 回退现有 JSON 校验链。
 *
 * (module,id,field) 逐栏层：field_records/field_values 物化折叠派生的分栏视图，
 * applyFieldBatch 把一次逐栏提交（接受的栏目写入 + 合并/提升后的领域整行 + 草稿丢弃）
 * 作为单批次复算——乐观锁、栏名白名单、领域行同步与状态推导（complete/partial/legacy_unknown）
 * 与折叠语义同序（先领域整行、后栏目写入、再按领域对账）；field_changes 追踪后由 exportDelta
 * 追加导出 fieldUpserts。栏目值比较一律用键序无关的规范化 JSON。
 */

import { SqliteEngine } from '../../../data/sqlite/sqlite-engine';
import {
  AGENT_MODULE_FIELD_MATRIX_ACU,
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentModuleFieldRecord_ACU,
  type AgentModuleFieldSnapshot_ACU,
  type AgentModuleFieldStatus_ACU,
  type AgentModuleFieldUpserts_ACU,
  type AgentModuleFieldValue_ACU,
  type AgentModuleFieldWrite_ACU,
  type AgentModuleFloorDelta_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';

/** userRequirements 是 string[] 整表替换，没有条目 id；变更追踪用固定哨兵。 */
const USER_REQUIREMENTS_CHANGE_KEY_ACU = '__all__';

const MODULE_TABLE_PREFIX_ACU = 'mod_';
const BASE_TABLE_ACU = 'snapshot_base';
const META_TABLE_ACU = 'module_meta';
const CHANGES_TABLE_ACU = 'module_changes';
const FIELD_RECORDS_TABLE_ACU = 'field_records';
const FIELD_VALUES_TABLE_ACU = 'field_values';
const FIELD_CHANGES_TABLE_ACU = 'field_changes';

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

function entryId_ACU(item: unknown): string {
  if (!isRecord_ACU(item) || typeof item.id !== 'string' || !item.id.trim()) return '';
  return item.id;
}

function isWritableModule_ACU(value: unknown): value is AgentWritableModule_ACU {
  return typeof value === 'string' && (AGENT_WRITABLE_MODULES_ACU as readonly string[]).includes(value);
}

function moduleTable_ACU(module: AgentWritableModule_ACU): string {
  return `${MODULE_TABLE_PREFIX_ACU}${module}`;
}

/** SQL 视图层结构化失败：消息含模块与期望/实际 revision，供 fail-closed 诊断。 */
export class AgentModuleSqlViewError_ACU extends Error {
  readonly module?: string;
  readonly expected?: number;
  readonly actual?: number;
  constructor(message: string, detail?: { module?: string; expected?: number; actual?: number }) {
    super(message);
    this.name = 'AgentModuleSqlViewError_ACU';
    this.module = detail?.module;
    this.expected = detail?.expected;
    this.actual = detail?.actual;
  }
}

/** 一次行级写：按 id upsert/remove；userRequirements 整表替换（upserts 为 string[]）。 */
export interface AgentModuleSqlRowWrite_ACU {
  module: AgentWritableModule_ACU;
  upserts?: readonly unknown[];
  removedIds?: readonly string[];
  /** 模块当前 revision 的乐观锁期望值；不匹配即在 SQL 层拒绝。 */
  expectedRevision: number;
  /** 只用于分栏层同步的栏目时间戳；缺省 0（行写复算路径不消费分栏层）。 */
  updatedAt?: number;
}

/**
 * 一次逐栏提交批次。与折叠语义同序复算：先落领域整行、再叠栏目写入、最后按领域对账
 * （领域里的 ID 重建栏目并按血统记 complete/legacy_unknown，领域外记录恒为 partial，
 * 无任何栏目的草稿删除）。一批一次乐观锁、模块 revision 只推进一次。
 */
export interface AgentModuleSqlFieldBatch_ACU {
  module: AgentWritableModule_ACU;
  expectedRevision: number;
  /** 写进栏目与记录的时间戳；必须与随后落盘 delta 的 updatedAt 一致。 */
  updatedAt: number;
  /** 接受的逐栏写入：ID → 栏目 → 写入值。userRequirements 只认固定 ID '_'。 */
  fieldWrites?: Record<string, Record<string, AgentModuleFieldWrite_ACU>>;
  /** 合并/提升后变化的领域整行：ID → 完整条目；userRequirements 用 '_' → string[] 整表。 */
  domainUpserts?: Record<string, unknown>;
  /** 丢弃的 partial 草稿 ID；完整条目按草稿丢弃即抛错（fail-closed）。 */
  discardPartialIds?: readonly string[];
}

export interface AgentModuleSqlView_ACU {
  readonly engine: SqliteEngine;
  /** 是否有尚未导出的变更行（含逐栏变更）。 */
  hasChanges(): boolean;
  /** 行写并推进模块 revision；冲突或非法输入抛 AgentModuleSqlViewError_ACU。 */
  applyRowWrite(input: AgentModuleSqlRowWrite_ACU): number;
  /** 逐栏提交批次复算：一批一次乐观锁、一次 revision 推进；非法输入抛 AgentModuleSqlViewError_ACU。 */
  applyFieldBatch(input: AgentModuleSqlFieldBatch_ACU): number;
  /** 导出变更行为既有楼层 delta 输入形态（含逐栏 fieldUpserts）；导出后清空变更追踪。 */
  exportDelta(): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions' | 'fieldUpserts'>;
  /** 从库读回完整快照（标量字段沿用物化时的基线值）。 */
  readSnapshot(): AgentModuleSnapshot_ACU;
  /** 读单条分栏记录（partial 的缺栏按模型必填栏推导）；不存在返回 null。 */
  readFieldRecord(module: AgentWritableModule_ACU, id: string): AgentModuleFieldRecord_ACU | null;
  /** 读全部（或单模块）partial 草稿记录。 */
  readPartialRecords(module?: AgentWritableModule_ACU): AgentModuleFieldRecord_ACU[];
  dispose(): void;
}


function createSchema_ACU(engine: SqliteEngine): void {
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    engine.run(`CREATE TABLE ${moduleTable_ACU(module)} (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  }
  engine.run(`CREATE TABLE ${META_TABLE_ACU} (module TEXT PRIMARY KEY, revision INTEGER NOT NULL)`);
  engine.run(`CREATE TABLE ${CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, change_key TEXT NOT NULL, change_kind TEXT NOT NULL, payload TEXT)`);
  engine.run(`CREATE TABLE ${BASE_TABLE_ACU} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  engine.run(`CREATE TABLE ${FIELD_RECORDS_TABLE_ACU} (module TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (module, id))`);
  engine.run(`CREATE TABLE ${FIELD_VALUES_TABLE_ACU} (module TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (module, id, field))`);
  engine.run(`CREATE TABLE ${FIELD_CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL)`);
}

function readRevision_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU): number {
  const rows = engine.query(`SELECT revision FROM ${META_TABLE_ACU} WHERE module = ?`, [module]).values;
  if (!rows.length) return 0;
  const value = Number(rows[0][0]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function recordChange_ACU(engine: SqliteEngine, module: string, key: string, kind: 'upsert' | 'remove' | 'replace', payload: string | null): void {
  engine.run(`INSERT INTO ${CHANGES_TABLE_ACU} (module, change_key, change_kind, payload) VALUES (?, ?, ?, ?)`, [module, key, kind, payload]);
}

/** userRequirements 是整表单例：任何输入 ID 都归一为固定 ID；其余模块取非空 trimmed id。 */
function normalizeFieldRecordId_ACU(module: AgentWritableModule_ACU, rawId: unknown): string {
  if (module === 'userRequirements') return AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU;
  return typeof rawId === 'string' ? rawId.trim() : '';
}

/** 领域条目的当前整行：userRequirements 归一为 {value: string[]}；不在领域里返回 null。 */
function readDomainItem_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU, id: string): Record<string, unknown> | null {
  if (module === 'userRequirements') {
    if (id !== AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU) return null;
    const rows = engine.query(`SELECT payload FROM ${moduleTable_ACU(module)} ORDER BY rowid`).values;
    return { value: rows.map(row => JSON.parse(String(row[0]))) };
  }
  const rows = engine.query(`SELECT payload FROM ${moduleTable_ACU(module)} WHERE id = ?`, [id]).values;
  if (!rows.length) return null;
  const item = JSON.parse(String(rows[0][0]));
  return isRecord_ACU(item) ? item : null;
}

interface FieldRecordRow_ACU {
  status: AgentModuleFieldStatus_ACU;
  updatedAt: number;
}

function readFieldRecordRow_ACU(engine: SqliteEngine, module: string, id: string): FieldRecordRow_ACU | null {
  const rows = engine.query(`SELECT status, updated_at FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
  if (!rows.length) return null;
  return { status: String(rows[0][0]) as AgentModuleFieldStatus_ACU, updatedAt: Number(rows[0][1]) };
}

interface FieldValueRow_ACU {
  canonical: string;
  revision: number;
  updatedAt: number;
}

function readFieldValueRows_ACU(engine: SqliteEngine, module: string, id: string): Map<string, FieldValueRow_ACU> {
  const rows = engine.query(`SELECT field, value, revision, updated_at FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
  const map = new Map<string, FieldValueRow_ACU>();
  for (const row of rows) {
    map.set(String(row[0]), { canonical: String(row[1]), revision: Number(row[2]), updatedAt: Number(row[3]) });
  }
  return map;
}

function recordFieldChange_ACU(engine: SqliteEngine, module: string, id: string, field: string): void {
  engine.run(`INSERT INTO ${FIELD_CHANGES_TABLE_ACU} (module, id, field) VALUES (?, ?, ?)`, [module, id, field]);
}

/**
 * 领域整行驱动的分栏层同步（与折叠的领域对账同语义）：此前经逐栏写入或本批被点名的记录
 * 记为 complete，否则 legacy_unknown；值未变的栏目沿用原 revision，变化或新出现的栏目 +1
 * （baseline 播种一律 0）。整行驱动，不记 field_changes。
 */
function syncDomainRecordToFieldLayer_ACU(
  engine: SqliteEngine,
  module: AgentWritableModule_ACU,
  id: string,
  item: Record<string, unknown>,
  updatedAt: number,
  namedInBatch: boolean,
  baseline = false,
): void {
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  const previous = readFieldRecordRow_ACU(engine, module, id);
  const previousValues = readFieldValueRows_ACU(engine, module, id);
  const lineage = namedInBatch || previous?.status === 'partial' || previous?.status === 'complete';
  const nextValues = new Map<string, FieldValueRow_ACU>();
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
function pruneFieldRecordAfterDomainRemoval_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU, id: string): void {
  const row = readFieldRecordRow_ACU(engine, module, id);
  if (!row || row.status === 'partial') return;
  engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
  engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
}

/**
 * 物化分栏视图：提供折叠派生视图时按原样装载（无栏目的记录不装）；未提供时按领域条目播种，
 * 栏目 revision 从 0 起算、记为 legacy_unknown（与 seedFieldViewFromSnapshot_ACU 一致）。
 */
function loadFieldView_ACU(engine: SqliteEngine, snapshot: AgentModuleSnapshot_ACU, fields: AgentModuleFieldSnapshot_ACU | undefined): void {
  if (fields) {
    for (const module of AGENT_WRITABLE_MODULES_ACU) {
      const bucket = fields.records[module];
      if (!bucket) continue;
      const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
      for (const [rawId, record] of Object.entries(bucket)) {
        const id = normalizeFieldRecordId_ACU(module, record.id || rawId);
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
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    if (module === 'userRequirements') {
      syncDomainRecordToFieldLayer_ACU(engine, module, AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU, { value: [...snapshot.userRequirements] }, snapshot.updatedAt, false, true);
      continue;
    }
    for (const entry of snapshot[module] as readonly unknown[]) {
      if (!isRecord_ACU(entry)) continue;
      const id = entryId_ACU(entry);
      if (!id) continue;
      syncDomainRecordToFieldLayer_ACU(engine, module, id, entry, snapshot.updatedAt, false, true);
    }
  }
}

function buildFieldRecord_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU, id: string, row: FieldRecordRow_ACU): AgentModuleFieldRecord_ACU {
  const values = readFieldValueRows_ACU(engine, module, id);
  const fields: Record<string, AgentModuleFieldValue_ACU> = {};
  for (const [field, entry] of values) {
    fields[field] = { value: JSON.parse(entry.canonical), revision: entry.revision, updatedAt: entry.updatedAt };
  }
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  return {
    module,
    id,
    status: row.status,
    fields,
    missingFields: row.status === 'partial' ? matrix.required.filter(field => !Object.prototype.hasOwnProperty.call(fields, field)) : [],
    updatedAt: row.updatedAt,
  };
}

function readFieldRecord_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU, id: string): AgentModuleFieldRecord_ACU | null {
  if (!isWritableModule_ACU(module)) throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String(module)}`);
  const normalized = normalizeFieldRecordId_ACU(module, id);
  const row = readFieldRecordRow_ACU(engine, module, normalized);
  if (!row) return null;
  return buildFieldRecord_ACU(engine, module, normalized, row);
}

function readPartialRecords_ACU(engine: SqliteEngine, module?: AgentWritableModule_ACU): AgentModuleFieldRecord_ACU[] {
  if (module !== undefined && !isWritableModule_ACU(module)) throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String(module)}`);
  const records: AgentModuleFieldRecord_ACU[] = [];
  for (const key of module ? [module] : AGENT_WRITABLE_MODULES_ACU) {
    const rows = engine.query(`SELECT id, updated_at FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND status = 'partial' ORDER BY id`, [key]).values;
    for (const row of rows) {
      records.push(buildFieldRecord_ACU(engine, key, String(row[0]), { status: 'partial', updatedAt: Number(row[1]) }));
    }
  }
  return records;
}

function loadSnapshot_ACU(engine: SqliteEngine, snapshot: AgentModuleSnapshot_ACU): void {
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    const table = moduleTable_ACU(module);
    if (module === 'userRequirements') {
      snapshot.userRequirements.forEach((line, index) => {
        engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?)`, [String(index), JSON.stringify(line)]);
      });
    } else {
      for (const entry of snapshot[module] as readonly unknown[]) {
        const id = entryId_ACU(entry);
        if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 存在无 id 条目，无法物化进 SQL 视图`, { module });
        engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?)`, [id, JSON.stringify(entry)]);
      }
    }
    engine.run(`INSERT INTO ${META_TABLE_ACU} (module, revision) VALUES (?, ?)`, [module, snapshot.revisions[module]]);
  }
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('settledThroughIndex', ?)`, [String(snapshot.settledThroughIndex)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('updatedAt', ?)`, [String(snapshot.updatedAt)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('materialCompletion', ?)`, [JSON.stringify(snapshot.materialCompletion)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('pendingFixes', ?)`, [JSON.stringify(snapshot.pendingFixes)]);
}


function applyRowWrite_ACU(engine: SqliteEngine, input: AgentModuleSqlRowWrite_ACU): number {
  if (!isWritableModule_ACU(input.module)) {
    throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String(input.module)}`);
  }
  const module = input.module;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  if (module === 'userRequirements') {
    if (!Array.isArray(input.upserts) || !input.upserts.every(line => typeof line === 'string')) {
      throw new AgentModuleSqlViewError_ACU('userRequirements 只接受 string[] 整表替换', { module });
    }
  } else {
    for (const item of input.upserts ?? []) {
      if (!entryId_ACU(item)) throw new AgentModuleSqlViewError_ACU(`模块 ${module} upsert 条目缺少合法 id`, { module });
    }
    for (const id of input.removedIds ?? []) {
      if (typeof id !== 'string' || !id.trim()) throw new AgentModuleSqlViewError_ACU(`模块 ${module} removedIds 含非法 id`, { module });
    }
  }
  const table = moduleTable_ACU(module);
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine, module);
    if (current !== input.expectedRevision) {
      throw new AgentModuleSqlViewError_ACU(`模块 ${module} revision 冲突：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    if (module === 'userRequirements') {
      const lines = input.upserts as readonly string[];
      engine.run(`DELETE FROM ${table}`);
      lines.forEach((line, index) => {
        engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?)`, [String(index), JSON.stringify(line)]);
      });
      recordChange_ACU(engine, module, USER_REQUIREMENTS_CHANGE_KEY_ACU, 'replace', JSON.stringify([...lines]));
      syncDomainRecordToFieldLayer_ACU(engine, module, AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU, { value: [...lines] }, input.updatedAt ?? 0, false);
    } else {
      for (const id of input.removedIds ?? []) {
        engine.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
        recordChange_ACU(engine, module, id, 'remove', null);
        pruneFieldRecordAfterDomainRemoval_ACU(engine, module, id);
      }
      for (const item of input.upserts ?? []) {
        const id = entryId_ACU(item);
        engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, [id, JSON.stringify(item)]);
        recordChange_ACU(engine, module, id, 'upsert', JSON.stringify(item));
        if (isRecord_ACU(item)) syncDomainRecordToFieldLayer_ACU(engine, module, id, item, input.updatedAt ?? 0, false);
      }
    }
    const next = current + 1;
    engine.run(`UPDATE ${META_TABLE_ACU} SET revision = ? WHERE module = ?`, [next, module]);
    engine.run('COMMIT');
    return next;
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}


function applyFieldBatch_ACU(engine: SqliteEngine, input: AgentModuleSqlFieldBatch_ACU): number {
  if (!isWritableModule_ACU(input.module)) {
    throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String(input.module)}`);
  }
  const module = input.module;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  if (!Number.isFinite(input.updatedAt) || input.updatedAt < 0) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的 updatedAt 非法: ${String(input.updatedAt)}`, { module });
  }
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  const writeIds = new Map<string, Record<string, AgentModuleFieldWrite_ACU>>();
  for (const [rawId, writes] of Object.entries(input.fieldWrites ?? {})) {
    const id = normalizeFieldRecordId_ACU(module, rawId);
    if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 逐栏写入含非法 id`, { module });
    if (!isRecord_ACU(writes)) throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的栏目写集必须是对象`, { module });
    const merged = writeIds.get(id) ?? {};
    for (const [field, write] of Object.entries(writes)) {
      if (!matrix.fields.includes(field)) {
        throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的栏目 ${field} 不在栏目矩阵`, { module });
      }
      if (!isRecord_ACU(write) || (write.unset !== true && !Object.prototype.hasOwnProperty.call(write, 'value'))) {
        throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的栏目 ${field} 写入必须给 value 或 unset`, { module });
      }
      merged[field] = write;
    }
    writeIds.set(id, merged);
  }
  const upsertIds = new Map<string, Record<string, unknown>>();
  for (const [rawId, payload] of Object.entries(input.domainUpserts ?? {})) {
    const id = normalizeFieldRecordId_ACU(module, rawId);
    if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 领域写含非法 id`, { module });
    if (module === 'userRequirements') {
      if (!Array.isArray(payload) || !payload.every(line => typeof line === 'string')) {
        throw new AgentModuleSqlViewError_ACU('userRequirements 领域写只接受 string[] 整表', { module });
      }
      upsertIds.set(id, { value: [...payload] });
      continue;
    }
    if (!isRecord_ACU(payload)) throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的领域写必须是对象`, { module });
    if (entryId_ACU(payload) !== id) {
      throw new AgentModuleSqlViewError_ACU(`模块 ${module} 领域写 id 不一致：键 ${id}，条目 ${entryId_ACU(payload) || '(无 id)'}`, { module });
    }
    upsertIds.set(id, payload);
  }
  const discardIds = new Set<string>();
  for (const rawId of input.discardPartialIds ?? []) {
    const id = normalizeFieldRecordId_ACU(module, rawId);
    if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 草稿丢弃含非法 id`, { module });
    discardIds.add(id);
  }
  if (!writeIds.size && !upsertIds.size && !discardIds.size) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的逐栏批次为空`, { module });
  }
  const table = moduleTable_ACU(module);
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine, module);
    if (current !== input.expectedRevision) {
      throw new AgentModuleSqlViewError_ACU(`模块 ${module} revision 冲突：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    // 被点名即产生血统语义（complete/partial 翻转），需要回放进折叠并推进模块 revision
    let changed = upsertIds.size > 0;
    // 1) 领域整行先行（与折叠 applyDelta→fieldUpserts→reconcile 的写侧同序）
    for (const [id, item] of upsertIds) {
      if (module === 'userRequirements') {
        const lines = item.value as readonly string[];
        engine.run(`DELETE FROM ${table}`);
        lines.forEach((line, index) => {
          engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?)`, [String(index), JSON.stringify(line)]);
        });
        recordChange_ACU(engine, module, USER_REQUIREMENTS_CHANGE_KEY_ACU, 'replace', JSON.stringify([...lines]));
      } else {
        engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, [id, JSON.stringify(item)]);
        recordChange_ACU(engine, module, id, 'upsert', JSON.stringify(item));
      }
    }
    // 2) 栏目写入：值未变不推进栏目 revision；unset 只适用于草稿
    for (const [id, writes] of writeIds) {
      const inDomain = readDomainItem_ACU(engine, module, id) !== null;
      engine.run(
        `INSERT INTO ${FIELD_RECORDS_TABLE_ACU} (module, id, status, updated_at) VALUES (?, ?, 'partial', ?) ON CONFLICT(module, id) DO NOTHING`,
        [module, id, input.updatedAt],
      );
      for (const [field, write] of Object.entries(writes)) {
        const rows = engine.query(`SELECT value, revision FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]).values;
        if (write.unset === true) {
          if (inDomain) {
            throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 是完整条目，栏目 ${field} 不能按草稿撤销`, { module });
          }
          if (rows.length) {
            engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]);
          }
          recordFieldChange_ACU(engine, module, id, field);
          changed = true;
          continue;
        }
        const canonical = canonicalJson_ACU(write.value);
        if (rows.length && String(rows[0][0]) === canonical) {
          // 值未变不推进栏目 revision，但被点名的血统变化仍须可回放
          recordFieldChange_ACU(engine, module, id, field);
          changed = true;
          continue;
        }
        const revision = rows.length ? Number(rows[0][1]) + 1 : 1;
        engine.run(
          `INSERT INTO ${FIELD_VALUES_TABLE_ACU} (module, id, field, value, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(module, id, field) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
          [module, id, field, canonical, revision, input.updatedAt],
        );
        recordFieldChange_ACU(engine, module, id, field);
        changed = true;
      }
      engine.run(`UPDATE ${FIELD_RECORDS_TABLE_ACU} SET updated_at = ? WHERE module = ? AND id = ?`, [input.updatedAt, module, id]);
    }
    // 3) 丢弃草稿：完整条目按草稿丢弃即失败（fail-closed）
    for (const id of discardIds) {
      if (readDomainItem_ACU(engine, module, id) !== null) {
        throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 是完整条目，不能按草稿丢弃`, { module });
      }
      const values = readFieldValueRows_ACU(engine, module, id);
      for (const field of values.keys()) recordFieldChange_ACU(engine, module, id, field);
      if (values.size) changed = true;
      engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
      engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
    }
    // 4) 领域对账：领域里的 ID 重建栏目并按血统记状态；领域外恒 partial，无栏目草稿删除
    const touched = new Set<string>([...writeIds.keys(), ...upsertIds.keys()]);
    for (const id of touched) {
      const item = readDomainItem_ACU(engine, module, id);
      if (item !== null) {
        syncDomainRecordToFieldLayer_ACU(engine, module, id, item, input.updatedAt, writeIds.has(id));
        continue;
      }
      const remaining = engine.query(`SELECT COUNT(*) FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
      if (Number(remaining[0]?.[0] ?? 0) === 0) {
        engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
      } else {
        engine.run(`UPDATE ${FIELD_RECORDS_TABLE_ACU} SET status = 'partial' WHERE module = ? AND id = ?`, [module, id]);
      }
    }
    const next = changed ? current + 1 : current;
    if (changed) {
      engine.run(`UPDATE ${META_TABLE_ACU} SET revision = ? WHERE module = ?`, [next, module]);
    }
    engine.run('COMMIT');
    return next;
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}

interface ChangeState_ACU {
  kind: 'upsert' | 'remove' | 'replace';
  payload: string | null;
}

/** 逐栏变更导出：同一 (module,id,field) 多次变更只导出最终状态；栏目行已不在则导出 unset。 */
function exportFieldUpserts_ACU(engine: SqliteEngine): AgentModuleFieldUpserts_ACU | undefined {
  const rows = engine.query(`SELECT module, id, field FROM ${FIELD_CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const seen = new Map<string, { module: string; id: string; field: string }>();
  for (const row of rows) {
    const module = String(row[0]);
    const id = String(row[1]);
    const field = String(row[2]);
    const key = `${module} ${id} ${field}`;
    if (!seen.has(key)) seen.set(key, { module, id, field });
  }
  const upserts: AgentModuleFieldUpserts_ACU = {};
  let touched = false;
  for (const { module, id, field } of seen.values()) {
    if (!isWritableModule_ACU(module)) continue;
    const valueRows = engine.query(`SELECT value FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]).values;
    const write: AgentModuleFieldWrite_ACU = valueRows.length ? { value: JSON.parse(String(valueRows[0][0])) } : { unset: true };
    const bucket = (upserts[module] ??= {});
    const record = (bucket[id] ??= {});
    record[field] = write;
    touched = true;
  }
  engine.run(`DELETE FROM ${FIELD_CHANGES_TABLE_ACU}`);
  return touched ? upserts : undefined;
}

function exportDelta_ACU(engine: SqliteEngine): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions' | 'fieldUpserts'> {
  const rows = engine.query(`SELECT module, change_key, change_kind, payload FROM ${CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const byModule = new Map<string, Map<string, ChangeState_ACU>>();
  for (const row of rows) {
    const module = String(row[0]);
    let bucket = byModule.get(module);
    if (!bucket) {
      bucket = new Map();
      byModule.set(module, bucket);
    }
    bucket.set(String(row[1]), { kind: row[2] as ChangeState_ACU['kind'], payload: row[3] === null || row[3] === undefined ? null : String(row[3]) });
  }
  const writes: Record<string, unknown> = {};
  const removedIds: Record<string, string[]> = {};
  const revisions: Partial<AgentModuleRevisions_ACU> = {};
  for (const [module, bucket] of byModule) {
    if (!isWritableModule_ACU(module)) continue;
    if (module === 'userRequirements') {
      const last = bucket.get(USER_REQUIREMENTS_CHANGE_KEY_ACU);
      if (last?.kind === 'replace' && last.payload !== null) writes.userRequirements = JSON.parse(last.payload);
    } else {
      const upserts: unknown[] = [];
      const removed: string[] = [];
      for (const [key, state] of bucket) {
        if (state.kind === 'upsert' && state.payload !== null) upserts.push(JSON.parse(state.payload));
        if (state.kind === 'remove') removed.push(key);
      }
      if (upserts.length) writes[module] = upserts;
      if (removed.length) removedIds[module] = removed;
    }
    revisions[module] = readRevision_ACU(engine, module);
  }
  // 纯逐栏批次没有领域变更行，revision 推进随 fieldUpserts 一并导出，保证折叠回读一致
  for (const row of engine.query(`SELECT DISTINCT module FROM ${FIELD_CHANGES_TABLE_ACU}`).values) {
    const module = String(row[0]);
    if (!isWritableModule_ACU(module)) continue;
    if (revisions[module] === undefined) revisions[module] = readRevision_ACU(engine, module);
  }
  engine.run(`DELETE FROM ${CHANGES_TABLE_ACU}`);
  const delta: Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions' | 'fieldUpserts'> = {
    writes: writes as AgentModuleFloorDelta_ACU['writes'],
    revisions,
  };
  if (Object.keys(removedIds).length) delta.removedIds = removedIds as NonNullable<AgentModuleFloorDelta_ACU['removedIds']>;
  const fieldUpserts = exportFieldUpserts_ACU(engine);
  if (fieldUpserts) delta.fieldUpserts = fieldUpserts;
  return delta;
}


function readSnapshot_ACU(engine: SqliteEngine): AgentModuleSnapshot_ACU {
  const base = new Map(engine.query(`SELECT key, value FROM ${BASE_TABLE_ACU}`).values.map(row => [String(row[0]), String(row[1])]));
  const snapshot = {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: Number(base.get('settledThroughIndex') ?? '0'),
    updatedAt: Number(base.get('updatedAt') ?? '0'),
    revisions: {} as AgentModuleRevisions_ACU,
    hooks: [],
    infoGap: [],
    constraints: [],
    storyArc: [],
    chronology: [],
    webRefs: [],
    userRequirements: [],
    materialCompletion: JSON.parse(base.get('materialCompletion') ?? 'null'),
    pendingFixes: JSON.parse(base.get('pendingFixes') ?? '[]'),
  } as unknown as AgentModuleSnapshot_ACU;
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    const rows = engine.query(`SELECT payload FROM ${moduleTable_ACU(module)} ORDER BY rowid`).values;
    const items = rows.map(row => JSON.parse(String(row[0])));
    (snapshot as unknown as Record<string, unknown>)[module] = items;
    (snapshot.revisions as unknown as Record<string, number>)[module] = readRevision_ACU(engine, module);
  }
  return snapshot;
}

/**
 * 把折叠后的快照物化进独立内存库并返回行级视图。提供折叠派生的分栏视图（fields）时按原样
 * 装载逐栏层；缺省时按领域条目播种（栏目 revision 从 0 起算、记为 legacy_unknown）。
 * 引擎初始化、建表或条目装载失败抛结构化错误；调用方负责 fail-closed 回退 JSON 校验链。
 */
export async function materializeAgentModuleSqlView_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  fields?: AgentModuleFieldSnapshot_ACU,
  engine?: SqliteEngine,
): Promise<AgentModuleSqlView_ACU> {
  const db = engine ?? new SqliteEngine();
  try {
    await db.init();
    createSchema_ACU(db);
    loadSnapshot_ACU(db, cloneJson_ACU(snapshot));
    loadFieldView_ACU(db, snapshot, fields ? cloneJson_ACU(fields) : undefined);
  } catch (error) {
    db.dispose();
    if (error instanceof AgentModuleSqlViewError_ACU) throw error;
    throw new AgentModuleSqlViewError_ACU(`续写资料 SQL 视物化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    engine: db,
    hasChanges: () => Number(db.query(`SELECT (SELECT COUNT(*) FROM ${CHANGES_TABLE_ACU}) + (SELECT COUNT(*) FROM ${FIELD_CHANGES_TABLE_ACU})`).values[0]?.[0] ?? 0) > 0,
    applyRowWrite: input => applyRowWrite_ACU(db, input),
    applyFieldBatch: input => applyFieldBatch_ACU(db, input),
    exportDelta: () => exportDelta_ACU(db),
    readSnapshot: () => readSnapshot_ACU(db),
    readFieldRecord: (module, id) => readFieldRecord_ACU(db, module, id),
    readPartialRecords: module => readPartialRecords_ACU(db, module),
    dispose: () => db.dispose(),
  };
}
