/**
 * data/sqlite/sqlite-engine.ts — SQLite 运行时引擎
 *
 * 管理 sql.js 的 Database 实例生命周期。
 * 职责：
 * - 初始化 sql.js（从 npm 包本地引入）
 * - 创建/销毁内存数据库
 * - 提供 query/run/runBatch 的薄封装
 * - 不涉及业务逻辑（业务逻辑在 sync-bridge.ts 和 schema-mapper.ts）
 */

// 引擎选择由构建开关 ACU_SQLITE_ENGINE 决定（rollup 把占位符替换为具体模块）：
//   wasm（默认）：sql.js/dist/sql-wasm.js + sql-wasm.wasm 以 base64 内联进单文件产物，
//                运行时解码为 wasmBinary 交给 emscripten（无外部 wasm fetch）；
//   asm（回滚）：sql.js/dist/sql-asm-memory-growth.js（纯 JS，无 wasm）。
import initSqlJs from '__ACU_SQLITE_ENGINE_IMPORT__';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { resolveSqlWasmUrl_ACU } from './sql-wasm-locator';

/** 列信息（PRAGMA table_info 返回的结构） */
export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

/** SELECT 查询结果 */
export interface QueryResult {
  columns: string[];
  values: SqlJsValueType[][];
}

/** 查询执行诊断选项 */
export interface SqliteQueryOptions_ACU {
  suppressErrorLog?: boolean;
}

/** INSERT/UPDATE/DELETE 执行结果 */
export interface MutationResult {
  changes: number;
}

/** 批量执行结果 */
export interface BatchResult<T = void> {
  totalChanges: number;
  finalizeResult?: T;
}

/**
 * SQLite 运行时（sql.js/wasm）不可用。
 * 语义边界：只表示「引擎起不来」，不表示 DDL/数据非法。
 * 上层据此分类与降级（如 T5 preflight、T6 改表助手环境失败），
 * 绝不能用文案匹配替代本类型判定。
 * 范式参考 sheet-identity.ts:48 PhysicalTableNameCollisionError_ACU。
 */
export class SqliteRuntimeUnavailableError_ACU extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SqliteRuntimeUnavailableError_ACU';
    this.cause = cause;
  }
}

/**
 * 模块级 sql.js 运行时单例。
 * 每次回放都会 new SqliteEngine()；若运行时只挂在实例上，每个实例都会重新解码
 * 内联 wasm base64 并重新走 initSqlJs。运行时本身无状态（Database 才有状态），
 * 因此全进程共享一份：成功后永久复用，失败时清空 Promise 以便下次重试。
 */
let sharedSqlJsRuntime_ACU: SqlJsStatic | null = null;
let sharedSqlJsInitPromise_ACU: Promise<SqlJsStatic> | null = null;

/** 仅供测试隔离：清空模块级运行时缓存。 */
export function resetSqliteRuntimeCacheForTests_ACU(): void {
  sharedSqlJsRuntime_ACU = null;
  sharedSqlJsInitPromise_ACU = null;
}

export class SqliteEngine {
  private db: SqlJsDatabase | null = null;
  private sqlJs: SqlJsStatic | null = null;

  /** 是否已初始化 */
  get isReady(): boolean {
    return this.db !== null;
  }

  /**
   * 构造 initSqlJs 配置。
   * - wasm 引擎：构建期把 sql-wasm.wasm 编码为 base64 内联进单文件产物
   *   （globalThis.__ACU_SQLITE_WASM_BASE64__，由 rollup replace 注入），
   *   此处解码为 wasmBinary 交给 emscripten——emscripten 优先使用 wasmBinary，
   *   不再发起外部 locateFile fetch，避免单文件 CDN 下 sql-wasm.wasm 404
   *   （test28 事故根因：both async and sync fetching of the wasm failed）。
   * - wasm 引擎但常量缺失/解码失败：抛 SqliteRuntimeUnavailableError_ACU（fail loud）。
   *   单文件 CDN 下内联 wasm 是唯一正确来源，缺失=构建配置错误，静默退回 locateFile
   *   会复现 test28 的 404 事故路径，绝不能静默。
   * - asm 引擎：纯 JS 无 wasm，不要求内联常量，走 locateFile 兜底（不会命中 fetch）。
   */
  private buildInitConfig_ACU(): Parameters<typeof initSqlJs>[0] {
    const config: Parameters<typeof initSqlJs>[0] = {
      locateFile: (file: string) => resolveSqlWasmUrl_ACU(file),
    };
    // 注意：此处必须是字面量成员访问，rollup replace 才能精确替换并注入 base64。
    const inlineBase64 = (globalThis as any).__ACU_SQLITE_WASM_BASE64__;
    if (typeof inlineBase64 === 'string' && inlineBase64.length > 0) {
      try {
        config.wasmBinary = decodeInlineWasmBase64_ACU(inlineBase64);
        logDebug_ACU(`[SQLite引擎] 使用内联 wasmBinary (${config.wasmBinary.byteLength} bytes)`);
      } catch (e: any) {
        throw new SqliteRuntimeUnavailableError_ACU(
          `内联 wasm base64 解码失败: ${e?.message || String(e)}`,
          e,
        );
      }
      return config;
    }
    // 无内联常量：只有 asm 引擎（纯 JS）允许走 locateFile；wasm 引擎必须内联。
    const engineName = String((globalThis as any).__ACU_SQLITE_ENGINE__ ?? '').toLowerCase();
    if (engineName === 'wasm') {
      throw new SqliteRuntimeUnavailableError_ACU(
        'wasm 引擎缺少内联 wasm（globalThis.__ACU_SQLITE_WASM_BASE64__ 未注入）。' +
        '单文件产物必须由构建期注入 base64 wasm；请检查 rollup replace 配置。',
      );
    }
    return config;
  }


  /**
   * 初始化 sql.js 运行时（单一入口，init/loadFromBinary 共用）。
   * - 本实例或模块级已有运行时直接返回；
   * - 否则复用/创建模块级初始化 Promise，跨实例并发调用只初始化一次；
   * - 失败时把模块级 Promise 置 null 后重抛，保证下次可重试。
   */
  private async initializeRuntime(): Promise<SqlJsStatic> {
    if (this.sqlJs) return this.sqlJs;
    if (sharedSqlJsRuntime_ACU) {
      this.sqlJs = sharedSqlJsRuntime_ACU;
      return this.sqlJs;
    }

    // [6.7.2] 检测 sql.js 是否可用（CDN @require 可能加载失败）
    if (typeof initSqlJs !== 'function') {
      throw new SqliteRuntimeUnavailableError_ACU(
        'sql.js 引擎未加载：initSqlJs 函数不存在。' +
        '请检查构建产物是否正确打包 sql-wasm.js 与内联 wasm（base64），' +
        '或 CDN 是否可达。'
      );
    }

    if (!sharedSqlJsInitPromise_ACU) {
      sharedSqlJsInitPromise_ACU = (async () => {
        try {
          logDebug_ACU('[SQLite引擎] 正在初始化 sql.js...');
          const runtime = await initSqlJs(this.buildInitConfig_ACU());
          logDebug_ACU('[SQLite引擎] sql.js 初始化成功');
          return runtime;
        } catch (e: any) {
          logError_ACU('[SQLite引擎] sql.js 初始化失败:', e?.message || String(e));
          // 仅「引擎起不来」抛结构化类型；SQL 语义错误（_ensureDb/query/run 抛出的）
          // 不得改类，仍按普通 Error 传播（语义边界见 SqliteRuntimeUnavailableError_ACU）。
          throw new SqliteRuntimeUnavailableError_ACU(
            `sql.js 初始化失败: ${e?.message || String(e)}`,
            e,
          );
        }
      })();
    }

    const pending = sharedSqlJsInitPromise_ACU;
    try {
      const runtime = await pending;
      sharedSqlJsRuntime_ACU = runtime;
      this.sqlJs = runtime;
    } catch (error) {
      // 只清理本次失败的 Promise；若期间已被重置/替换，不覆盖新的初始化。
      if (sharedSqlJsInitPromise_ACU === pending) sharedSqlJsInitPromise_ACU = null;
      throw error;
    }
    return this.sqlJs;
  }

  /**
   * 初始化 sql.js 并创建空的内存数据库
   * 如果已经初始化过，会先销毁旧实例再重建
   */
  async init(): Promise<void> {
    // 销毁旧实例（如果有）
    this.dispose();

    // 统一走单一运行时初始化入口（并发安全 + 失败可重试，见 initializeRuntime）
    this.sqlJs = await this.initializeRuntime();

    // 创建空的内存数据库
    this.db = new this.sqlJs.Database();
    logDebug_ACU('[SQLite引擎] 内存数据库已创建');

    // 启用 WAL 模式（内存数据库下无实际效果，但保持语义一致）
    // 启用外键约束
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  /**
   * 执行 SELECT 查询，返回列名 + 结果集
   * @param sql SELECT 语句
   * @param params 参数绑定（可选）
   * @returns 查询结果（columns + values）
   * @throws 数据库未初始化或 SQL 语法错误时抛出
   */
  query(sql: string, params?: SqlJsBindParams, options: SqliteQueryOptions_ACU = {}): QueryResult {
    this._ensureDb();
    try {
      const results = this.db!.exec(sql, params);
      if (results.length === 0) {
        return { columns: [], values: [] };
      }
      // exec 可能返回多个结果集（多条 SELECT），只取第一个
      return {
        columns: results[0].columns,
        values: results[0].values,
      };
    } catch (e: any) {
      if (options.suppressErrorLog !== true) {
        const message = e?.message || String(e);
        // “no such table” 属于预期时序：新开卡/首次填表前，模板 SELECT 会先于建表执行
        // （建表仅在写操作触发，见 sql-table-service.ts executeMutation）。
        // 这类情况降级为 debug，避免刷 ERROR 噪音；语法错误、no such column 等仍按 ERROR 上报。
        if (/no such table/i.test(message)) {
          logDebug_ACU('[SQLite引擎] query 命中未建表（预期时序）:', sql.substring(0, 200), '| 错误:', message);
        } else {
          logError_ACU('[SQLite引擎] query 执行失败:', sql.substring(0, 200), '| 错误:', message);
        }
      }
      throw e;
    }
  }

  /**
   * 执行单条 INSERT/UPDATE/DELETE/CREATE TABLE 等语句
   * @param sql SQL 语句
   * @param params 参数绑定（可选）
   * @returns 受影响的行数
   * @throws 数据库未初始化或 SQL 语法错误时抛出
   */
  run(sql: string, params?: SqlJsBindParams): MutationResult {
    this._ensureDb();
    try {
      this.db!.run(sql, params);
      return { changes: this.db!.getRowsModified() };
    } catch (e: any) {
      logError_ACU('[SQLite引擎] run 执行失败:', sql.substring(0, 200), '| 错误:', e?.message || String(e));
      throw e;
    }
  }

  /**
   * 批量执行多条 SQL（整批事务，原子性）
   * 任何一条失败 → ROLLBACK 整个事务 → 抛出包含详细报错的 Error
   * 报错信息格式："第 N 条语句失败: [原始SQL] → [SQLite错误信息]"
   * 上层重试循环捕获后，将报错注入 AI prompt 触发重写
   *
   * @param statements SQL 语句数组
   * @returns 所有语句的总受影响行数
   * @throws 任何一条语句失败时抛出，包含详细的错误定位信息
   */
  runBatch(statements: string[], paramsList?: (SqlJsBindParams | undefined)[]): BatchResult {
    this._ensureDb();
    if (statements.length === 0) return { totalChanges: 0 };
    logDebug_ACU(`[SQLite引擎] runBatch: 执行 ${statements.length} 条语句`);

    let totalChanges = 0;
    this.db!.run('BEGIN TRANSACTION;');
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i].trim();
        if (!stmt) continue;
        try {
          this.db!.run(stmt, paramsList?.[i]);
          totalChanges += this.db!.getRowsModified();
        } catch (e: any) {
          // 回滚事务
          try { this.db!.run('ROLLBACK;'); } catch (_) { /* 忽略回滚失败 */ }
          const errMsg = e?.message || String(e);
          throw new Error(`第 ${i + 1} 条语句失败: ${stmt} → ${errMsg}`);
        }
      }
      this.db!.run('COMMIT;');
      logDebug_ACU(`[SQLite引擎] runBatch: 事务提交成功, 共影响 ${totalChanges} 行`);
      return { totalChanges };
    } catch (e: any) {
      // 如果是我们自己抛出的格式化错误，直接重新抛出
      if (e.message && e.message.startsWith('第 ')) throw e;
      // 其他意外错误（如 COMMIT 失败）
      try { this.db!.run('ROLLBACK;'); } catch (_) { /* 忽略 */ }
      throw e;
    }
  }

  /**
   * 批量执行并在 COMMIT 前运行同步 finalize。
   * finalize 可读取同一连接内尚未提交的数据；其抛错会回滚整个批次。
   */
  runBatchWithFinalize<T>(
    statements: string[],
    paramsList: (SqlJsBindParams | undefined)[] | undefined,
    finalize: () => T,
  ): BatchResult<T> {
    this._ensureDb();
    if (statements.length === 0) {
      return { totalChanges: 0, finalizeResult: finalize() };
    }
    logDebug_ACU(`[SQLite引擎] runBatchWithFinalize: 执行 ${statements.length} 条语句`);

    let totalChanges = 0;
    this.db!.run('BEGIN TRANSACTION;');
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i].trim();
        if (!stmt) continue;
        try {
          this.db!.run(stmt, paramsList?.[i]);
          totalChanges += this.db!.getRowsModified();
        } catch (e: any) {
          const errMsg = e?.message || String(e);
          // [阶段 E] 解析 UNIQUE 冲突，附冲突键、可能来源与建议动作，
          // 避免只返回“第 N 条语句失败”而无法定位根因。
          const uniqueMatch = errMsg.match(/UNIQUE constraint failed:\s*(.+)/i);
          if (uniqueMatch) {
            const conflictedColumns = uniqueMatch[1].trim();
            throw new Error(
              `第 ${i + 1} 条语句失败: ${stmt} → ${errMsg}；` +
              `冲突来源：本批次前序语句或 seedRows reseed 与 AI INSERT 命中同一 UNIQUE 键（${conflictedColumns}）。` +
              `建议：检查是否重复初始化同一业务键；若为 AI 初始化请改为 UPDATE 既有行，若为系统 seed 请确认提交链 dataMode（replace/merge 不应 reseed）。`,
            );
          }
          throw new Error(`第 ${i + 1} 条语句失败: ${stmt} → ${errMsg}`);
        }
      }

      const finalizeResult = finalize();
      this.db!.run('COMMIT;');
      logDebug_ACU(`[SQLite引擎] runBatchWithFinalize: 事务提交成功, 共影响 ${totalChanges} 行`);
      return { totalChanges, finalizeResult };
    } catch (e: any) {
      try { this.db!.run('ROLLBACK;'); } catch (_) { /* 忽略回滚失败 */ }
      throw e;
    }
  }

  /**
   * 获取所有用户表名（排除 sqlite 内部表和 _acu_ 前缀的系统表）
   * @returns 用户表名数组
   */
  getTableNames(): string[] {
    this._ensureDb();
    const result = this.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;"
    );
    return result.values.map(row => String(row[0]));
  }

  /**
   * 获取所有表名（包括 _acu_ 系统表，排除 sqlite 内部表）
   * @returns 所有表名数组
   */
  getAllTableNames(): string[] {
    this._ensureDb();
    const result = this.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    );
    return result.values.map(row => String(row[0]));
  }

  /**
   * 获取指定表的列信息（PRAGMA table_info）
   * @param tableName 表名
   * @returns 列信息数组
   * @throws 表不存在时返回空数组（不抛出）
   */
  getTableInfo(tableName: string): ColumnInfo[] {
    this._ensureDb();
    // 防止 SQL 注入：表名只允许字母、数字、下划线
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`非法表名: ${tableName}`);
    }
    const result = this.query(`PRAGMA table_info(${tableName});`);
    return result.values.map(row => ({
      cid: Number(row[0]),
      name: String(row[1]),
      type: String(row[2]),
      notnull: row[3] === 1,
      dflt_value: row[4] != null ? String(row[4]) : null,
      pk: row[5] === 1,
    }));
  }

  /**
   * 获取指定表的建表 DDL（从 sqlite_master 读取）
   * @param tableName 表名
   * @returns CREATE TABLE 语句，表不存在时返回 null
   */
  getTableDDL(tableName: string): string | null {
    this._ensureDb();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`非法表名: ${tableName}`);
    }
    const result = this.query(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?;",
      [tableName]
    );
    if (result.values.length === 0) return null;
    return String(result.values[0][0]);
  }

  /**
   * 销毁数据库实例，释放内存
   * 销毁后 isReady 变为 false，需要重新 init() 才能使用
   * 注意：不销毁 sql.js 运行时本身——运行时初始化代价高且可复用，
   * 只有 db 实例随聊天切换销毁重建（复用运行时是有意行为）。
   */
  dispose(): void {
    if (this.db) {
      logDebug_ACU('[SQLite引擎] 正在销毁数据库实例...');
      try { this.db.close(); } catch (_) { /* 忽略关闭错误 */ }
      this.db = null;
    }
  }

  /**
   * 将整个数据库导出为二进制数据（用于持久化或调试）
   * @returns Uint8Array 格式的 SQLite 数据库文件
   */
  exportBinary(): Uint8Array {
    this._ensureDb();
    return this.db!.export();
  }

  /**
   * 从二进制数据恢复数据库（用于从持久化数据恢复）
   * @param data Uint8Array 格式的 SQLite 数据库文件
   */
  async loadFromBinary(data: Uint8Array): Promise<void> {
    logDebug_ACU(`[SQLite引擎] 从二进制数据恢复数据库 (${data.byteLength} bytes)`);
    // 统一走单一运行时初始化入口（T5：消除 loadFromBinary 独立 initSqlJs 旁路，
    // 确保与 init() 共用同一运行时与失败重试语义）
    this.sqlJs = await this.initializeRuntime();
    this.dispose();
    this.db = new this.sqlJs.Database(data);
    this.db.run('PRAGMA foreign_keys = ON;');
    logDebug_ACU('[SQLite引擎] 数据库恢复完成');
  }

  /** 内部方法：确保数据库已初始化 */
  private _ensureDb(): void {
    if (!this.db) {
      throw new Error('SqliteEngine 未初始化，请先调用 init()');
    }
  }
}

/**
 * 将 base64 字符串解码为 Uint8Array。
 * 优先使用全局 atob（浏览器/现代 Node）；缺失时用纯 JS 手动解码
 * （不依赖 Buffer，避免 tsconfig 未配 node 类型导致 tsc 报错）。
 * 一次性初始化调用，659KB 二进制解码为毫秒级，可接受。
 */
function decodeInlineWasmBase64_ACU(base64: string): Uint8Array {
  const globalAtob = (globalThis as any).atob as ((input: string) => string) | undefined;
  if (typeof globalAtob === 'function') {
    const binary = globalAtob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // 纯 JS 手动解码（atob 缺失时）
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Map<string, number>();
  for (let i = 0; i < chars.length; i++) lookup.set(chars[i], i);
  const clean = base64.replace(/=+$/, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup.get(clean[i]) ?? 0;
    const b = lookup.get(clean[i + 1]) ?? 0;
    const c = lookup.get(clean[i + 2]) ?? 0;
    const d = lookup.get(clean[i + 3]) ?? 0;
    bytes.push((a << 2) | (b >> 4));
    if (i + 2 < clean.length) bytes.push(((b & 15) << 4) | (c >> 2));
    if (i + 3 < clean.length) bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}

