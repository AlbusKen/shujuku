/**
 * service/continuation/agent/agent-module-sql-view.ts — 续写资料快照的 SQL 易失视图
 *
 * 把折叠后的楼层快照物化进独立 SqliteEngine 内存库：一模块一表，条目 id 为主键，
 * 模块 revision 入 module_meta 表。行级 upsert/remove 与 revision 校验在 SQL 层完成，
 * 变更行经 module_changes 追踪后导出为 AgentModuleFloorDelta_ACU 的 writes/removedIds/revisions
 * 形态，交给既有 diff/帧写回链。库为纯易失视图：不写回二进制、不改持久化载体；
 * 任何物化或执行失败抛结构化错误，由调用方 fail-closed 回退现有 JSON 校验链。
 */

import { SqliteEngine } from '../../../data/sqlite/sqlite-engine';
import {
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_WRITABLE_MODULES_ACU,
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

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
}

export interface AgentModuleSqlView_ACU {
  readonly engine: SqliteEngine;
  /** 是否有尚未导出的变更行。 */
  hasChanges(): boolean;
  /** 行写并推进模块 revision；冲突或非法输入抛 AgentModuleSqlViewError_ACU。 */
  applyRowWrite(input: AgentModuleSqlRowWrite_ACU): number;
  /** 导出变更行为既有楼层 delta 输入形态；导出后清空变更追踪。 */
  exportDelta(): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions'>;
  /** 从库读回完整快照（标量字段沿用物化时的基线值）。 */
  readSnapshot(): AgentModuleSnapshot_ACU;
  dispose(): void;
}


function createSchema_ACU(engine: SqliteEngine): void {
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    engine.run(`CREATE TABLE ${moduleTable_ACU(module)} (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  }
  engine.run(`CREATE TABLE ${META_TABLE_ACU} (module TEXT PRIMARY KEY, revision INTEGER NOT NULL)`);
  engine.run(`CREATE TABLE ${CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, change_key TEXT NOT NULL, change_kind TEXT NOT NULL, payload TEXT)`);
  engine.run(`CREATE TABLE ${BASE_TABLE_ACU} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
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
    } else {
      for (const id of input.removedIds ?? []) {
        engine.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
        recordChange_ACU(engine, module, id, 'remove', null);
      }
      for (const item of input.upserts ?? []) {
        const id = entryId_ACU(item);
        engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, [id, JSON.stringify(item)]);
        recordChange_ACU(engine, module, id, 'upsert', JSON.stringify(item));
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


interface ChangeState_ACU {
  kind: 'upsert' | 'remove' | 'replace';
  payload: string | null;
}

function exportDelta_ACU(engine: SqliteEngine): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions'> {
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
  engine.run(`DELETE FROM ${CHANGES_TABLE_ACU}`);
  const delta: Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions'> = {
    writes: writes as AgentModuleFloorDelta_ACU['writes'],
    revisions,
  };
  if (Object.keys(removedIds).length) delta.removedIds = removedIds as NonNullable<AgentModuleFloorDelta_ACU['removedIds']>;
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
 * 把折叠后的快照物化进独立内存库并返回行级视图。
 * 引擎初始化、建表或条目装载失败抛结构化错误；调用方负责 fail-closed 回退 JSON 校验链。
 */
export async function materializeAgentModuleSqlView_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  engine?: SqliteEngine,
): Promise<AgentModuleSqlView_ACU> {
  const db = engine ?? new SqliteEngine();
  try {
    await db.init();
    createSchema_ACU(db);
    loadSnapshot_ACU(db, cloneJson_ACU(snapshot));
  } catch (error) {
    db.dispose();
    if (error instanceof AgentModuleSqlViewError_ACU) throw error;
    throw new AgentModuleSqlViewError_ACU(`续写资料 SQL 视物化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    engine: db,
    hasChanges: () => Number(db.query(`SELECT COUNT(*) FROM ${CHANGES_TABLE_ACU}`).values[0]?.[0] ?? 0) > 0,
    applyRowWrite: input => applyRowWrite_ACU(db, input),
    exportDelta: () => exportDelta_ACU(db),
    readSnapshot: () => readSnapshot_ACU(db),
    dispose: () => db.dispose(),
  };
}
