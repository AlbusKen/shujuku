/**
 * service/runtime/template-vars/sql-query-var.ts
 * SQL 查询模板变量 — ORM 风格查询构建器 + 原生 SQL 兜底 + 值替换
 *
 * ORM 风格语法：
 *   {[db.表名.where("列名", "值").get("列名")]}
 *   {[db.表名.where("列名", ">", 数值).count()]}
 *   {[db.表名.all()]}
 *
 * 原生 SQL 兜底：
 *   {[sql "SELECT 列名 FROM 表名 WHERE 条件"]}
 */

import { getStorageProvider, getStorageRuntimeHealth_ACU, isStorageRuntimeReadyForSyncRead_ACU } from '../../table/table-storage-strategy';
import { currentJsonTableData_ACU } from '../state-manager';
import { getGlobalNameMapperStatus_ACU, getNameMapper } from './name-mapper';
import { isSqliteMode } from '../../table/storage-mode';
import { logDebug_ACU, logWarn_ACU, logError_ACU } from '../../../shared/utils';
import { resolveReadQuerySql_ACU } from '../../../shared/sql-read-resolver';
import { resolveCurrentRuntimeReadSql_ACU } from '../read-query-resolver';
import type { ITableStorageProvider } from '../../../shared/table-storage-provider';
import type { TableDataObject_ACU } from '../../../shared/models/table-data';
import type { NameMapper } from './name-mapper';

/** 请求内只读查询能力；不发布 provider、mapper 或全局表格数据。 */
export interface SqlTemplateReadContext_ACU {
  provider: Pick<ITableStorageProvider, 'isReady' | 'executeQuery'>;
  mapper: NameMapper;
  tableData: TableDataObject_ACU;
}
let scopedReadContext_ACU: SqlTemplateReadContext_ACU | null | undefined;

/** 仅同步解析；undefined 沿用现有作用域，null 明确禁用 SQL，不回退全局 provider。 */
export function withSqlTemplateReadContext_ACU<T>(context: SqlTemplateReadContext_ACU | null | undefined, run: () => T): T {
  if (context === undefined) return run();
  if (context && !context.provider.isReady()) throw new Error('isolated_sql_runtime_not_ready');
  const previousContext = scopedReadContext_ACU;
  const previousVars = _dbSqlVars;
  scopedReadContext_ACU = context;
  _dbSqlVars = {};
  try {
    const result = run();
    if (result && typeof (result as any).then === 'function') {
      throw new Error('sql_template_scope_must_be_synchronous');
    }
    return result;
  } finally {
    scopedReadContext_ACU = previousContext;
    _dbSqlVars = previousVars;
  }
}

function queryMapper_ACU() {
  if (scopedReadContext_ACU === null) throw new Error('isolated_sql_disabled');
  return scopedReadContext_ACU?.mapper ?? getNameMapper();
}
function queryProvider_ACU() {
  if (scopedReadContext_ACU === null) throw new Error('isolated_sql_disabled');
  return scopedReadContext_ACU?.provider ?? getStorageProvider();
}
function querySqliteMode_ACU() { return scopedReadContext_ACU === null ? false : scopedReadContext_ACU !== undefined || isSqliteMode(); }

// ═══════════════════════════════════════════════════════════════
// 变量系统 — 存储 {[db...as X]} / {[sql...as X]} 的结果
// ═══════════════════════════════════════════════════════════════

/** 模块级变量存储（每次 replaceDbSqlVariables 调用时重置） */
let _dbSqlVars: Record<string, string | number> = {};
let lastBlockedQueryKey_ACU = '';

function resolveTemplateReadSql_ACU(sql: string): string {
  const mapper = queryMapper_ACU();
  return resolveReadQuerySql_ACU(sql, scopedReadContext_ACU?.tableData ?? currentJsonTableData_ACU,
    mapper.translateSql.bind(mapper)).sql;
}

/**
 * 模板渲染是同步路径，绝不能为了一个 SELECT 在这里创建未 hydrate 的 SQLite provider。
 * 未就绪时 fail-closed，避免中文展示名被空 NameMapper 原样下发给 SQLite。
 */
function isTemplateQueryRuntimeReady_ACU(source: string): boolean {
  if (scopedReadContext_ACU === null) return false;
  if (scopedReadContext_ACU) return scopedReadContext_ACU.provider.isReady();
  if (!isStorageRuntimeReadyForSyncRead_ACU()) {
    const health = getStorageRuntimeHealth_ACU();
    const key = `${health.loadToken}:${health.status}:${source}`;
    if (lastBlockedQueryKey_ACU !== key) {
      lastBlockedQueryKey_ACU = key;
      logWarn_ACU(`[SQL][readiness] 运行时未就绪，已跳过${source}查询: status=${health.status}, expected=${health.expectedMode}, active=${health.activeMode || 'none'}, code=${health.failureCode || 'none'}`);
    }
    return false;
  }
  const mapperStatus = getGlobalNameMapperStatus_ACU();
  if (!mapperStatus.ready) {
    const health = getStorageRuntimeHealth_ACU();
    const key = `${health.loadToken}:mapper:${mapperStatus.binding}:${source}`;
    if (lastBlockedQueryKey_ACU !== key) {
      lastBlockedQueryKey_ACU = key;
      if (mapperStatus.binding === 'empty_schema') {
        // 新聊天首次填表前 runtime 就是空的，没有表可查。这是预期状态，
        // 不能按异常反复 WARN，否则会掩盖真正的 mapper 丢失。
        logDebug_ACU(`[SQL][readiness] 运行时尚无表结构，已跳过${source}查询。`);
      } else {
        logWarn_ACU(`[SQL][readiness] NameMapper 未就绪，已跳过${source}查询。`);
      }
    }
    return false;
  }
  return true;
}

/** 获取变量值（供外部条件求值使用） */
export function getDbSqlVariable(name: string): string | number | null {
  if (_dbSqlVars.hasOwnProperty(name)) return _dbSqlVars[name];
  return null;
}

/** 清空变量存储（每轮处理开始时调用） */
export function clearDbSqlVariables(): void {
  _dbSqlVars = {};
}

/** 获取所有变量的快照（调试用） */
export function getDbSqlVariableSnapshot(): Record<string, string | number> {
  return { ..._dbSqlVars };
}

// ═══════════════════════════════════════════════════════════════
// ORM 查询构建器
// ═══════════════════════════════════════════════════════════════

interface WhereClause {
  column: string;
  operator: string;
  value: any;
}

/**
 * ORM 查询构建器
 * 链式 API，内部拼 SQL 然后调 engine.query()
 */
export interface TableQueryBuilderOptions_ACU {
  throwOnQueryError?: boolean;
  suppressQueryErrorLog?: boolean;
}

export class TableQueryBuilder {
  private tableName: string;
  private conditions: WhereClause[] = [];
  private _orGroups: WhereClause[][] = [];
  private _orderBy: string | null = null;
  private _limit: number | null = null;
  private _groupBy: string | null = null;
  private _having: string | null = null;
  private _distinct: boolean = false;
  private _offset: number | null = null;
  private readonly options: TableQueryBuilderOptions_ACU;

  constructor(tableName: string, options: TableQueryBuilderOptions_ACU = {}) {
    // 通过 NameMapper 解析表名（中文→英文）
    const mapper = queryMapper_ACU();
    this.tableName = mapper.resolveTableName(tableName);
    this.options = options;
  }

  /**
   * 添加 WHERE 条件
   * 支持两种调用方式：
   *   where("列名", "值")        → 列名 = '值'
   *   where("列名", ">", 数值)   → 列名 > 数值
   */
  where(column: string, valueOrOperator: any, value?: any): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);

    if (value !== undefined) {
      // 三参数形式：where("列名", ">", 数值)
      this.conditions.push({ column: resolvedColumn, operator: String(valueOrOperator), value });
    } else {
      // 两参数形式：where("列名", "值")
      this.conditions.push({ column: resolvedColumn, operator: '=', value: valueOrOperator });
    }
    return this;
  }

  /**
   * 添加 OR WHERE 条件组
   * 将当前 AND 条件组保存，开始新的 OR 分支
   *   orWhere("列名", "值")        → OR 列名 = '值'
   *   orWhere("列名", ">", 数值)   → OR 列名 > 数值
   */
  orWhere(column: string, valueOrOperator: any, value?: any): TableQueryBuilder {
    // 将当前 AND 条件组保存为一个 OR 分支
    if (this.conditions.length > 0) {
      this._orGroups.push([...this.conditions]);
      this.conditions = [];
    }
    // 添加新条件到新的 AND 组
    return this.where(column, valueOrOperator, value);
  }

  /**
   * IN 查询
   *   whereIn("列名", [值1, 值2, 值3])  → 列名 IN ('值1', '值2', '值3')
   */
  whereIn(column: string, values: any[]): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    if (!values || values.length === 0) {
      // 空数组：永假条件
      this.conditions.push({ column: '1', operator: '=', value: 0 });
    } else {
      const escaped = values.map(v => escapeParam(v)).join(', ');
      // 用特殊 operator 标记 IN 查询，_buildSelect 中特殊处理
      this.conditions.push({ column: resolvedColumn, operator: '__IN__', value: escaped });
    }
    return this;
  }

  /**
   * BETWEEN 查询
   *   whereBetween("列名", 10, 50)  → 列名 BETWEEN 10 AND 50
   */
  whereBetween(column: string, min: any, max: any): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    // min > max 时自动交换
    const actualMin = (typeof min === 'number' && typeof max === 'number' && min > max) ? max : min;
    const actualMax = (typeof min === 'number' && typeof max === 'number' && min > max) ? min : max;
    this.conditions.push({ column: resolvedColumn, operator: '__BETWEEN__', value: { min: actualMin, max: actualMax } });
    return this;
  }

  /**
   * 分组
   */
  groupBy(column: string): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    this._groupBy = resolvedColumn;
    return this;
  }

  /**
   * 去重
   */
  distinct(): TableQueryBuilder {
    this._distinct = true;
    return this;
  }

  /**
   * NOT IN 查询
   *   whereNotIn("列名", [值1, 值2])  → 列名 NOT IN ('值1', '值2')
   */
  whereNotIn(column: string, values: any[]): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    if (!values || values.length === 0) {
      // 空数组：不添加条件（返回所有行）
      return this;
    }
    const escaped = values.map(v => escapeParam(v)).join(', ');
    this.conditions.push({ column: resolvedColumn, operator: '__NOT_IN__', value: escaped });
    return this;
  }

  /**
   * IS NULL 条件
   */
  whereNull(column: string): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    this.conditions.push({ column: resolvedColumn, operator: '=', value: null });
    return this;
  }

  /**
   * IS NOT NULL 条件
   */
  whereNotNull(column: string): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    this.conditions.push({ column: resolvedColumn, operator: '!=', value: null });
    return this;
  }

  /**
   * LIKE 模糊匹配
   *   whereLike("列名", "%关键词%")  → 列名 LIKE '%关键词%'
   */
  whereLike(column: string, pattern: string): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    this.conditions.push({ column: resolvedColumn, operator: '__LIKE__', value: pattern });
    return this;
  }

  /**
   * HAVING 子句（配合 groupBy 使用）
   *   having("COUNT(*) > 1")  → HAVING COUNT(*) > 1
   */
  having(expression: string): TableQueryBuilder {
    this._having = expression;
    return this;
  }

  /**
   * 偏移量（配合 limit 使用，用于分页）
   */
  offset(n: number): TableQueryBuilder {
    this._offset = (typeof n === 'number' && n >= 0) ? n : 0;
    return this;
  }

  /**
   * 排序
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): TableQueryBuilder {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    this._orderBy = `${resolvedColumn} ${direction}`;
    return this;
  }

  /**
   * 限制返回行数
   */
  limit(n: number): TableQueryBuilder {
    this._limit = n;
    return this;
  }

  /**
   * 获取单个值（第一行指定列）
   */
  get(column: string): string | number | null {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    const sql = this._buildSelect(resolvedColumn);
    const result = this._executeQuery(sql + ' LIMIT 1');
    if (result.values.length === 0) return null;
    return result.values[0][0] as string | number | null;
  }

  /**
   * 获取单行（所有列）
   */
  first(): Record<string, any> | null {
    const sql = this._buildSelect('*') + ' LIMIT 1';
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return null;
    const row: Record<string, any> = {};
    for (let i = 0; i < result.columns.length; i++) {
      row[result.columns[i]] = result.values[0][i];
    }
    return row;
  }

  /**
   * 获取某列的值列表
   */
  list(column: string): (string | number)[] {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    const sql = this._buildSelect(resolvedColumn);
    const result = this._executeQuery(sql);
    return result.values.map(row => row[0] as string | number);
  }

  /**
   * 获取所有行
   */
  all(): Record<string, any>[] {
    const sql = this._buildSelect('*');
    const result = this._executeQuery(sql);
    return result.values.map(row => {
      const obj: Record<string, any> = {};
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i];
      }
      return obj;
    });
  }

  /**
   * 计数
   */
  count(): number {
    const sql = this._buildSelect('COUNT(*)');
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return 0;
    return Number(result.values[0][0]) || 0;
  }

  /**
   * 求和
   */
  sum(column: string): number {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    const sql = this._buildSelect(`SUM(${resolvedColumn})`);
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return 0;
    return Number(result.values[0][0]) || 0;
  }

  /**
   * 求平均值
   */
  avg(column: string): number {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    const sql = this._buildSelect(`AVG(${resolvedColumn})`);
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return 0;
    return Number(result.values[0][0]) || 0;
  }

  /**
   * 求最大值
   */
  max(column: string): number {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    const sql = this._buildSelect(`MAX(${resolvedColumn})`);
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return 0;
    return Number(result.values[0][0]) || 0;
  }

  /**
   * 求最小值
   */
  min(column: string): number {
    const mapper = queryMapper_ACU();
    const resolvedColumn = mapper.resolveColumnName(this.tableName, column);
    const sql = this._buildSelect(`MIN(${resolvedColumn})`);
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return 0;
    return Number(result.values[0][0]) || 0;
  }

  /**
   * 自定义 SELECT 表达式（在查询上下文中执行任意 SQL 表达式）
   * 语法：db.背包物品表.where('类别', '武器').value("SUM(数量) * 2")
   */
  value(expression: string): string | number | null {
    const translatedExpr = resolveTemplateReadSql_ACU(expression);
    const sql = this._buildSelect(translatedExpr);
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return null;
    const raw = result.values[0][0];
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return raw;
    return String(raw);
  }

  /**
   * 判断是否存在
   */
  exists(): boolean {
    const sql = `SELECT EXISTS(${this._buildSelect('1')}) AS e`;
    const result = this._executeQuery(sql);
    if (result.values.length === 0) return false;
    return result.values[0][0] === 1;
  }

  /**
   * 生成 SQL（调试用）
   */
  toSQL(): string {
    return this._buildSelect('*');
  }

  // ═══ 内部方法 ═══

  private _buildSelect(selectExpr: string): string {
    const selectKeyword = this._distinct ? 'SELECT DISTINCT' : 'SELECT';
    let sql = `${selectKeyword} ${selectExpr} FROM ${this.tableName}`;

    // 构建 WHERE 子句（支持 OR 分组）
    const buildAndGroup = (clauses: WhereClause[]): string => {
      return clauses.map(c => {
        if (c.operator === '__IN__') {
          return `${c.column} IN (${c.value})`;
        }
        if (c.operator === '__NOT_IN__') {
          return `${c.column} NOT IN (${c.value})`;
        }
        if (c.operator === '__LIKE__') {
          return `${c.column} LIKE ${escapeParam(c.value)}`;
        }
        if (c.operator === '__BETWEEN__') {
          return `${c.column} BETWEEN ${escapeParam(c.value.min)} AND ${escapeParam(c.value.max)}`;
        }
        if (c.value === null) {
          return c.operator === '=' ? `${c.column} IS NULL` : `${c.column} IS NOT NULL`;
        }
        return `${c.column} ${c.operator} ${escapeParam(c.value)}`;
      }).join(' AND ');
    };

    // 收集所有 OR 分组
    const allGroups: WhereClause[][] = [];
    if (this._orGroups.length > 0) {
      allGroups.push(...this._orGroups);
    }
    if (this.conditions.length > 0) {
      allGroups.push(this.conditions);
    }

    if (allGroups.length > 0) {
      if (allGroups.length === 1) {
        sql += ` WHERE ${buildAndGroup(allGroups[0])}`;
      } else {
        const orParts = allGroups.map(g => `(${buildAndGroup(g)})`);
        sql += ` WHERE ${orParts.join(' OR ')}`;
      }
    }

    if (this._groupBy) {
      sql += ` GROUP BY ${this._groupBy}`;
    }

    if (this._having) {
      sql += ` HAVING ${this._having}`;
    }

    if (this._orderBy) {
      sql += ` ORDER BY ${this._orderBy}`;
    }

    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    } else if (this._offset !== null) {
      // SQLite 要求有 LIMIT 才能用 OFFSET，用 -1 表示无限制
      sql += ` LIMIT -1`;
    }

    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return sql;
  }

  private _executeQuery(sql: string): { columns: string[]; values: any[][] } {
    if (!isTemplateQueryRuntimeReady_ACU('ORM')) {
      if (this.options.throwOnQueryError === true) throw new Error('orm_runtime_not_ready');
      return { columns: [], values: [] };
    }
    try {
      const provider = queryProvider_ACU();
      const executableSql = scopedReadContext_ACU ? resolveTemplateReadSql_ACU(sql) : resolveCurrentRuntimeReadSql_ACU(sql).sql;
      const result = provider.executeQuery(executableSql, undefined, {
        suppressErrorLog: this.options.suppressQueryErrorLog === true,
      });
      return { columns: result.columns, values: result.values };
    } catch (e: any) {
      if (this.options.throwOnQueryError === true) throw new Error('orm_query_execution_failed');
      logWarn_ACU('[ORM] 查询执行失败: orm_query_execution_failed');
      return { columns: [], values: [] };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ORM 表达式解析
// ═══════════════════════════════════════════════════════════════

/**
 * 创建 db Proxy 对象
 * 访问 db.xxx 时自动创建 TableQueryBuilder(xxx)
 * 特殊属性名 expr/rand/calc 返回对应的静态方法
 * 让 JS 引擎原生处理链式调用、括号嵌套、引号转义
 */
function createDbProxy(): Record<string, any> {
  return new Proxy({} as Record<string, any>, {
    get(_target, propName: string) {
      // 静态方法：db.expr("SQL表达式") — 执行任意 SQL 表达式
      if (propName === 'expr') return execExpr;
      // 静态方法：db.rand(min, max) — 生成随机整数
      if (propName === 'rand') return execRand;
      // 静态方法：db.calc("算术表达式") — 执行含 $v: 变量引用的算术表达式
      if (propName === 'calc') return execCalc;
      // 静态方法：db.max(值1, 值2, ...) — 取多个值中的最大值
      if (propName === 'max') return execMax;
      // 静态方法：db.min(值1, 值2, ...) — 取多个值中的最小值
      if (propName === 'min') return execMin;
      // 默认：创建 TableQueryBuilder
      return new TableQueryBuilder(propName);
    }
  });
}

/**
 * db.expr("SQL表达式") — 执行任意 SQL 表达式并返回结果
 * 支持中文表名/列名翻译、子查询、算术运算
 * 示例：
 *   db.expr("3 + 5 * 2")  → 13
 *   db.expr("(SELECT 数量 FROM 背包物品表 WHERE 物品名称='铁剑') * 2")  → 6
 */
function execExpr(expression: string): string | number | null {
  try {
    if (!expression || typeof expression !== 'string' || !expression.trim()) {
      logWarn_ACU('[db.expr] 空表达式');
      return null;
    }
    if (!isTemplateQueryRuntimeReady_ACU('db.expr')) return null;
    const translatedExpr = resolveTemplateReadSql_ACU(expression.trim());
    const sql = `SELECT ${translatedExpr}`;
    const provider = queryProvider_ACU();
    const result = provider.executeQuery(sql);
    if (result.values.length === 0) return null;
    const val = result.values[0][0];
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    return String(val);
  } catch (e: any) {
    logError_ACU(`[db.expr] 表达式执行失败: ${expression} → ${e?.message}`);
    return null;
  }
}

/**
 * db.rand(min, max) — 生成 min 到 max 之间的随机整数（含两端）
 * 使用 SQLite 的 RANDOM() 函数
 * min > max 时自动交换
 */
function execRand(min: number, max: number): number {
  try {
    let lo = typeof min === 'number' ? min : parseInt(String(min), 10);
    let hi = typeof max === 'number' ? max : parseInt(String(max), 10);
    if (isNaN(lo) || isNaN(hi)) {
      logWarn_ACU(`[db.rand] 参数无效: min=${min}, max=${max}`);
      return 0;
    }
    if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; }
    if (!isTemplateQueryRuntimeReady_ACU('db.rand')) return 0;
    const range = hi - lo + 1;
    const provider = queryProvider_ACU();
    const result = provider.executeQuery(`SELECT ABS(RANDOM()) % ${range} + ${lo}`);
    if (result.values.length === 0) return lo;
    return Number(result.values[0][0]) || lo;
  } catch (e: any) {
    logError_ACU(`[db.rand] 随机数生成失败: ${min}-${max} → ${e?.message}`);
    return 0;
  }
}

/**
 * db.calc("算术表达式") — 执行含 $v: 变量引用的算术表达式
 * 先替换 $v: 引用为实际值，再通过 SQLite SELECT 执行计算
 * 示例：
 *   db.calc("$v:sword_count + $v:shield_count * 2")
 *   db.calc("($v:attack - $v:defense) * $v:dice")
 */
function execCalc(expression: string): number | null {
  try {
    if (!expression || typeof expression !== 'string' || !expression.trim()) {
      logWarn_ACU('[db.calc] 空表达式');
      return null;
    }
    // 替换 $v: 变量引用
    let processed = expression.trim().replace(/\$v:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (_m: string, refName: string) => {
      if (_dbSqlVars.hasOwnProperty(refName)) {
        return String(_dbSqlVars[refName]);
      }
      logWarn_ACU(`[db.calc] 引用的变量不存在: ${refName}`);
      return 'NULL';
    });
    // 包含 NULL 说明有变量未找到
    if (processed.includes('NULL')) {
      logWarn_ACU(`[db.calc] 表达式包含未定义变量: ${expression}`);
      return null;
    }
    if (!isTemplateQueryRuntimeReady_ACU('db.calc')) return null;
    const provider = queryProvider_ACU();
    const result = provider.executeQuery(`SELECT ${processed}`);
    if (result.values.length === 0) return null;
    const val = Number(result.values[0][0]);
    if (isNaN(val) || !isFinite(val)) {
      logWarn_ACU(`[db.calc] 计算结果无效: ${expression} → ${result.values[0][0]}`);
      return null;
    }
    return val;
  } catch (e: any) {
    logError_ACU(`[db.calc] 表达式执行失败: ${expression} → ${e?.message}`);
    return null;
  }
}

/**
 * db.max(值1, 值2, ...) — 取多个值中的最大值
 * 支持 $v: 变量引用和纯数字
 * 示例：
 *   db.max(3, 7, 1)  → 7
 *   db.max($v:a, $v:b, $v:c)  → 最大值
 *   注意：在 new Function 执行时，$v: 已经被替换为实际值（如果在 {[db...]} 中使用）
 *   但如果直接调用，需要传入数字
 */
function execMax(...values: any[]): number | null {
  try {
    // 展平数组参数（支持 db.max([1,2,3]) 和 db.max(1,2,3) 两种形式）
    const flat = values.flat(Infinity);
    if (flat.length === 0) {
      logWarn_ACU('[db.max] 参数为空');
      return null;
    }
    const nums = flat.map(v => {
      if (typeof v === 'number') return v;
      const n = Number(v);
      return isNaN(n) ? null : n;
    }).filter((v): v is number => v !== null);
    if (nums.length === 0) {
      logWarn_ACU(`[db.max] 无有效数值参数: ${JSON.stringify(values)}`);
      return null;
    }
    return Math.max(...nums);
  } catch (e: any) {
    logError_ACU(`[db.max] 执行失败: ${e?.message}`);
    return null;
  }
}

/**
 * db.min(值1, 值2, ...) — 取多个值中的最小值
 * 支持 $v: 变量引用和纯数字
 */
function execMin(...values: any[]): number | null {
  try {
    const flat = values.flat(Infinity);
    if (flat.length === 0) {
      logWarn_ACU('[db.min] 参数为空');
      return null;
    }
    const nums = flat.map(v => {
      if (typeof v === 'number') return v;
      const n = Number(v);
      return isNaN(n) ? null : n;
    }).filter((v): v is number => v !== null);
    if (nums.length === 0) {
      logWarn_ACU(`[db.min] 无有效数值参数: ${JSON.stringify(values)}`);
      return null;
    }
    return Math.min(...nums);
  } catch (e: any) {
    logError_ACU(`[db.min] 执行失败: ${e?.message}`);
    return null;
  }
}

/**
 * 解析并执行 ORM 表达式
 * 输入: "db.重要人物表.where('姓名', '角色A').get('状态')"
 * 输出: 执行结果字符串
 *
 * 通过 Proxy + new Function 让 JS 引擎直接执行链式调用，
 * 不再手动用正则解析方法链。
 */
export function evaluateOrmExpression(expr: string): string {
  try {
    const trimmed = expr.trim();
    if (!trimmed) return '';
    if (!isTemplateQueryRuntimeReady_ACU('ORM')) return '';

    // 确保表达式以 db. 开头
    const fullExpr = trimmed.startsWith('db.') ? trimmed : 'db.' + trimmed;

    const db = createDbProxy();
    const fn = new Function('db', `return ${fullExpr}`);
    const result = fn(db);
    return formatResult(result);
  } catch (e: any) {
    logError_ACU(`[ORM] 表达式执行失败: ${expr} → ${e?.message}`);
    return '';
  }
}

/**
 * 解析并执行原生 SQL 表达式
 * 输入: 'sql "SELECT 状态 FROM 重要人物表 WHERE 姓名=\'角色A\'"'
 * 输出: 执行结果字符串
 */
export interface RawSqlEvaluationOptions_ACU {
  throwOnError?: boolean;
  suppressQueryErrorLog?: boolean;
}

export function evaluateRawSqlExpression(expr: string, options: RawSqlEvaluationOptions_ACU = {}): string {
  try {
    let trimmed = expr.trim();

    // 去掉 "sql " 前缀
    if (trimmed.startsWith('sql ')) {
      trimmed = trimmed.substring(4).trim();
    }

    // 去掉外层引号
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      trimmed = trimmed.substring(1, trimmed.length - 1);
    }

    if (!trimmed) {
      logWarn_ACU('[SQL] 空的 SQL 表达式');
      return '';
    }
    if (!isTemplateQueryRuntimeReady_ACU('SQL')) {
      if (options.throwOnError === true) throw new Error('sql_runtime_not_ready');
      return '';
    }

    // 通过 NameMapper 翻译中文名
    const translatedSql = resolveTemplateReadSql_ACU(trimmed);

    // 执行查询
    const provider = queryProvider_ACU();
    const result = provider.executeQuery(translatedSql, undefined, {
      suppressErrorLog: options.suppressQueryErrorLog === true,
    });

    // 格式化结果
    if (result.values.length === 0) return '';
    if (result.values.length === 1 && result.columns.length === 1) {
      // 单值：直接返回
      return String(result.values[0][0] ?? '');
    }
    // 多行多列：返回表格格式
    return formatQueryResultAsText(result.columns, result.values);
  } catch (e: any) {
    if (options.throwOnError === true) throw new Error('sql_query_execution_failed');
    const message = e?.message || String(e);
    // 未建表属于预期时序（首次填表前模板 SELECT 先行），降级为 debug，避免刷 ERROR。
    if (/no such table/i.test(message)) {
      logDebug_ACU(`[SQL] 查询命中未建表（预期时序）: ${expr} → ${message}`);
    } else {
      logError_ACU(`[SQL] 表达式执行失败: ${expr} → ${message}`);
    }
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// {[db...]} / {[sql...]} 值替换
// ═══════════════════════════════════════════════════════════════

/**
 * 替换文本中的 {[db...]} 和 {[sql...]} 模板变量
 * 在 Random/Calc 替换之后、<if> 之前执行
 *
 * @param content 待处理的文本
 * @returns 替换后的文本
 */
export function replaceDbSqlVariables(content: string): string {
  if (!content || typeof content !== 'string') return content || '';
  if (!querySqliteMode_ACU()) return content;

  if (!isTemplateQueryRuntimeReady_ACU('模板变量')) return content;

  // 每轮处理开始时重置变量存储
  clearDbSqlVariables();

  let result = content;

  // [P1] {[db.xxx.xxx(...) as 变量名]} / {[db.xxx.xxx(...)]} — ORM 风格（含 db.expr/db.rand/db.calc/db.max/db.min 静态方法）
  result = replaceDbExpressions(result);

  // [P2] {[sql "..." as 变量名]} / {[sql "..."]} — 原生 SQL
  result = replaceSqlExpressions(result);

  // [P3] $v:变量名 — 变量引用替换
  result = replaceVarReferences(result);

  return result;
}

// ═══════════════════════════════════════════════════════════════
// <if db="..."> / <if sql="..."> 条件求值
// ═══════════════════════════════════════════════════════════════

/**
 * 求值 <if db="..."> 条件
 * 返回布尔值：结果非零/非空/非false = true
 *
 * 通过 Proxy + new Function 直接执行整个表达式（含比较运算），
 * 例如 db.重要人物表.where('阵营','敌方').count() > 3 直接返回布尔值。
 * 纯 ORM 表达式（无比较运算）则对结果做 truthy 判断。
 */
export function evaluateDbCondition(expression: string): boolean {
  if (!querySqliteMode_ACU()) return false;
  if (!isTemplateQueryRuntimeReady_ACU('<if db>')) return false;

  try {
    const trimmed = expression.trim();
    if (!trimmed) return false;

    const fullExpr = trimmed.startsWith('db.') ? trimmed : 'db.' + trimmed;

    const db = createDbProxy();
    const fn = new Function('db', `return ${fullExpr}`);
    const result = fn(db);

    // 如果表达式本身包含比较运算（如 > 3），result 已经是布尔值
    if (typeof result === 'boolean') return result;
    // 否则做 truthy 判断
    return isTruthy(result);
  } catch (e: any) {
    logWarn_ACU(`[<if db>] 条件求值失败: ${expression} → ${e?.message}`);
    return false;
  }
}

/**
 * 求值 <if sql="..."> 条件
 * 返回布尔值：结果非零/非空 = true
 */
export function evaluateSqlCondition(expression: string): boolean {
  if (!querySqliteMode_ACU()) return false;
  if (!isTemplateQueryRuntimeReady_ACU('<if sql>')) return false;

  try {
    // 直接传入 SQL 表达式，不需要包引号
    // evaluateRawSqlExpression 内部会处理 "sql " 前缀和引号剥离
    // 但这里的 expression 来自 <if sql="...">，本身就是纯 SQL，直接执行即可
    const translatedSql = resolveTemplateReadSql_ACU(expression.trim());
    const provider = queryProvider_ACU();
    const result = provider.executeQuery(translatedSql);
    if (result.values.length === 0) return false;
    return isTruthy(result.values[0][0]);
  } catch (e: any) {
    logWarn_ACU(`[<if sql>] 条件求值失败: ${expression} → ${e?.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * SQL 参数转义
 */
function escapeParam(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  // 字符串：单引号转义
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 格式化查询结果为文本
 */
function formatQueryResultAsText(columns: string[], values: any[][]): string {
  if (values.length === 0) return '';
  if (values.length === 1 && columns.length === 1) {
    return String(values[0][0] ?? '');
  }

  // 多行单列：每条记录一行，避免单元格内容里的逗号造成歧义。
  if (columns.length === 1) {
    return values.map(row => String(row[0] ?? '')).join('\n');
  }

  // 多列：用表格格式
  const lines: string[] = [];
  for (const row of values) {
    const parts = columns.map((col, i) => `${col}: ${row[i] ?? ''}`);
    lines.push(parts.join(', '));
  }
  return lines.join('\n');
}

/**
 * 格式化 ORM 结果为字符串
 */
function formatResult(result: any): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'boolean') return result ? 'true' : 'false';
  if (typeof result === 'number') return String(result);
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    if (result.length === 0) return '';
    if (typeof result[0] === 'object') {
      // Record 数组：格式化为表格
      return result.map(obj => {
        return Object.entries(obj).map(([k, v]) => `${k}: ${v ?? ''}`).join(', ');
      }).join('\n');
    }
    return result.map(String).join(', ');
  }
  if (typeof result === 'object') {
    return Object.entries(result).map(([k, v]) => `${k}: ${v ?? ''}`).join(', ');
  }
  return String(result);
}

/**
 * 判断值是否为"真"（用于 <if> 条件判断）
 * 非零/非空/非false = true
 */
function isTruthy(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (value === 'false' || value === '0') return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'boolean') return value;
  return true;
}

/**
 * 内联替换表达式中的 $v:变量名 引用（在 ORM 表达式执行前调用）
 * 让 db.max($v:a, $v:b) 在执行前变成 db.max(3, 5)
 */
function inlineVarReplace(expr: string): string {
  return expr.replace(/\$v:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (_match, varName) => {
    if (_dbSqlVars.hasOwnProperty(varName)) {
      return String(_dbSqlVars[varName]);
    }
    logWarn_ACU(`[变量系统] 内联替换未找到变量: ${varName}`);
    return _match;
  });
}

/**
 * 手动解析并替换文本中的 {[db.xxx]} ORM 模板变量
 * 支持 {[db.xxx.xxx(...) as 变量名]} 语法：结果存入变量，标签替换为空字符串
 * 使用括号深度跟踪替代正则，以正确处理嵌套方括号（如 whereIn(['值1', '值2'])）
 */
function replaceDbExpressions(content: string): string {
  const marker = '{[db.';
  let result = '';
  let i = 0;

  while (i < content.length) {
    const markerIndex = content.indexOf(marker, i);
    if (markerIndex === -1) {
      result += content.slice(i);
      break;
    }

    // 添加 marker 之前的文本
    result += content.slice(i, markerIndex);

    // 从 {[ 之后开始，跟踪括号深度找到匹配的 ]}
    const exprStart = markerIndex + 2; // 跳过 {[
    let bracketDepth = 1; // 已经有一个 [
    let parenDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let j = exprStart;
    let found = false;

    while (j < content.length) {
      const ch = content[j];

      // 处理引号状态（引号内的括号不计入深度）
      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        j++;
        continue;
      }
      if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        j++;
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote) {
        if (ch === '[') {
          bracketDepth++;
        } else if (ch === ']') {
          bracketDepth--;
          if (bracketDepth === 0) {
            if (j + 1 < content.length && content[j + 1] === '}') {
              // 找到了匹配的 ]}
              const fullExpr = content.slice(exprStart, j); // db.xxx.xxx(...) 或 db.xxx.xxx(...) as varName
              const endPos = j + 2; // 跳过 ]}

              // 检查是否有 "as 变量名" 后缀
              const asMatch = fullExpr.match(/^(.+?)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);

              try {
                if (asMatch) {
                  // 有 as：执行表达式，存入变量，标签替换为空
                  const ormExpr = inlineVarReplace(asMatch[1].trim());
                  const varName = asMatch[2];
                  const value = evaluateOrmExpression(ormExpr);
                  _dbSqlVars[varName] = isNaN(Number(value)) ? value : Number(value);
                  logDebug_ACU(`[变量系统] db as: ${varName} = ${value}`);
                  // 不输出任何内容（标签被移除）
                } else {
                  // 无 as：正常替换为查询结果
                  const replacement = evaluateOrmExpression(inlineVarReplace(fullExpr));
                  result += replacement;
                }
              } catch (e: any) {
                logWarn_ACU(`[模板变量] ORM 表达式执行失败: ${fullExpr} → ${e?.message}`);
              }

              i = endPos;
              found = true;
              break;
            } else {
              // ] 后面不是 }，这个 ] 不是结束标记，恢复深度
              bracketDepth++;
            }
          }
        } else if (ch === '(') {
          parenDepth++;
        } else if (ch === ')') {
          parenDepth--;
        }
      }

      j++;
    }

    if (!found) {
      // 没有找到匹配的 ]}，原样输出 marker
      result += marker;
      i = markerIndex + marker.length;
    }
  }

  return result;
}

/**
 * 替换 {[sql "..."]} 和 {[sql "..." as 变量名]} 模板变量
 * 支持 as 语法：结果存入变量，标签替换为空字符串
 */
function replaceSqlExpressions(content: string): string {
  // 匹配 {[sql "..."]} 或 {[sql '...']}，可选 as 变量名
  return content.replace(/\{\[sql\s+(["'])(.*?)\1(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?\s*\]\}/gs, (_match, _quote, sqlContent, varName) => {
    try {
      const value = evaluateRawSqlExpression('sql "' + sqlContent + '"');
      if (varName) {
        // 有 as：存入变量，标签替换为空
        _dbSqlVars[varName] = isNaN(Number(value)) || value === '' ? value : Number(value);
        logDebug_ACU(`[变量系统] sql as: ${varName} = ${value}`);
        return '';
      }
      // 无 as：正常替换为查询结果
      return value;
    } catch (e: any) {
      logWarn_ACU(`[模板变量] SQL 表达式执行失败: ${sqlContent} → ${e?.message}`);
      return '';
    }
  });
}

/**
 * 替换文本中的 $v:变量名 引用
 * 在所有标签解析完成后执行
 * 也供 if-block-parser 在选中分支内容中替换 $v: 引用
 */
export function replaceVarReferences(content: string): string {
  return content.replace(/\$v:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, varName) => {
    if (_dbSqlVars.hasOwnProperty(varName)) {
      return String(_dbSqlVars[varName]);
    }
    logWarn_ACU(`[变量系统] 未找到变量: ${varName}`);
    return match;
  });
}
