/**
 * tests/data/sqlite/sqlite-engine.test.ts
 * SqliteEngine 单元测试 — 使用真实 sql.js 实例
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import { SqliteEngine } from '../../../src/data/sqlite/sqlite-engine';
import { logError_ACU } from '../../../src/shared/utils';

describe('SqliteEngine', () => {
  let engine: SqliteEngine;

  beforeEach(async () => {
    engine = new SqliteEngine();
    await engine.init();
    vi.mocked(logError_ACU).mockClear();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ═══════════════════════════════════════════════════════════════
  // 初始化与生命周期
  // ═══════════════════════════════════════════════════════════════
  describe('初始化与生命周期', () => {
    it('init 后 isReady 为 true', () => {
      expect(engine.isReady).toBe(true);
    });

    it('dispose 后 isReady 为 false', () => {
      engine.dispose();
      expect(engine.isReady).toBe(false);
    });

    it('重复 init 不报错（销毁旧实例再重建）', async () => {
      await engine.init();
      expect(engine.isReady).toBe(true);
    });

    it('未初始化时调用 query 抛出错误', () => {
      const freshEngine = new SqliteEngine();
      expect(() => freshEngine.query('SELECT 1')).toThrow('未初始化');
    });

    it('未初始化时调用 run 抛出错误', () => {
      const freshEngine = new SqliteEngine();
      expect(() => freshEngine.run('SELECT 1')).toThrow('未初始化');
    });

    it('未初始化时调用 runBatch 抛出错误', () => {
      const freshEngine = new SqliteEngine();
      expect(() => freshEngine.runBatch(['SELECT 1'])).toThrow('未初始化');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // query
  // ═══════════════════════════════════════════════════════════════
  describe('query', () => {
    it('执行 SELECT 返回列名和值', () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");
      const result = engine.query('SELECT * FROM test;');
      expect(result.columns).toEqual(['id', 'name']);
      expect(result.values).toEqual([[1, '张三']]);
    });

    it('空结果返回空 columns 和 values', () => {
      engine.run('CREATE TABLE test (id INTEGER);');
      const result = engine.query('SELECT * FROM test;');
      expect(result.columns).toEqual([]);
      expect(result.values).toEqual([]);
    });

    it('支持参数绑定', () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");
      engine.run("INSERT INTO test VALUES (2, '李四');");
      const result = engine.query('SELECT * FROM test WHERE id = ?;', [2]);
      expect(result.values).toEqual([[2, '李四']]);
    });

    it('SQL 语法错误默认记录查询诊断并抛出异常', () => {
      const sql = 'SELEC sensitive_default_log FROM nonexistent;';
      expect(() => engine.query(sql)).toThrow();

      const logs = vi.mocked(logError_ACU).mock.calls.flat().map(value => String(value)).join('\n');
      expect(logs).toContain('query 执行失败');
      expect(logs).toContain('sensitive_default_log');
    });

    it('可显式抑制 SQL 查询错误日志', () => {
      const sql = 'SELEC sensitive_suppressed_log FROM nonexistent;';
      expect(() => engine.query(sql, undefined, { suppressErrorLog: true })).toThrow();

      const logs = vi.mocked(logError_ACU).mock.calls.flat().map(value => String(value)).join('\n');
      expect(logs).not.toContain('sensitive_suppressed_log');
      expect(logError_ACU).not.toHaveBeenCalled();
    });

    it('重复 query 不泄漏 sql.js 栈（成功与报错路径）', () => {
      const runtime = (engine as any).sqlJs;
      expect(typeof runtime?.stackSave).toBe('function');
      engine.run('CREATE TABLE test (id INTEGER);');
      const before = runtime.stackSave();
      for (let i = 0; i < 1000; i += 1) engine.query('SELECT COUNT(*) FROM test;');
      expect(runtime.stackSave()).toBe(before);
      for (let i = 0; i < 1000; i += 1) {
        expect(() => engine.query('SELEC broken;', undefined, { suppressErrorLog: true })).toThrow();
      }
      expect(runtime.stackSave()).toBe(before);
    });

  });

  // ═══════════════════════════════════════════════════════════════
  // run
  // ═══════════════════════════════════════════════════════════════
  describe('run', () => {
    it('CREATE TABLE 成功', () => {
      const result = engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);');
      expect(result.changes).toBeDefined();
    });

    it('INSERT 返回受影响行数', () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      const result = engine.run("INSERT INTO test VALUES (1, '张三');");
      expect(result.changes).toBe(1);
    });

    it('UPDATE 返回受影响行数', () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");
      engine.run("INSERT INTO test VALUES (2, '李四');");
      const result = engine.run("UPDATE test SET name = '王五' WHERE id = 1;");
      expect(result.changes).toBe(1);
    });

    it('DELETE 返回受影响行数', () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");
      const result = engine.run('DELETE FROM test WHERE id = 1;');
      expect(result.changes).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // runBatch
  // ═══════════════════════════════════════════════════════════════
  describe('runBatch', () => {
    it('空数组返回 totalChanges 0', () => {
      const result = engine.runBatch([]);
      expect(result.totalChanges).toBe(0);
    });

    it('批量执行多条语句', () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      const result = engine.runBatch([
        "INSERT INTO test VALUES (1, '张三');",
        "INSERT INTO test VALUES (2, '李四');",
        "INSERT INTO test VALUES (3, '王五');",
      ]);
      expect(result.totalChanges).toBe(3);
      const query = engine.query('SELECT COUNT(*) FROM test;');
      expect(query.values[0][0]).toBe(3);
    });

    it('中间语句失败时 ROLLBACK 整个事务', () => {
      engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");

      // 第二条 INSERT 会因为主键冲突失败
      expect(() => engine.runBatch([
        "INSERT INTO test VALUES (2, '李四');",
        "INSERT INTO test VALUES (1, '重复');",  // 主键冲突
        "INSERT INTO test VALUES (3, '王五');",
      ])).toThrow('第 2 条语句失败');

      // 事务回滚，只有最初的张三
      const query = engine.query('SELECT COUNT(*) FROM test;');
      expect(query.values[0][0]).toBe(1);
    });

    it('错误信息包含失败的 SQL 语句', () => {
      engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY);');
      try {
        engine.runBatch([
          'INSERT INTO test VALUES (1);',
          'INSERT INTO nonexistent_table VALUES (2);',
        ]);
        expect.unreachable('应该抛出错误');
      } catch (e: any) {
        expect(e.message).toContain('第 2 条语句失败');
        expect(e.message).toContain('nonexistent_table');
      }
    });

    it('跳过空字符串语句', () => {
      engine.run('CREATE TABLE test (id INTEGER);');
      const result = engine.runBatch([
        'INSERT INTO test VALUES (1);',
        '',
        '   ',
        'INSERT INTO test VALUES (2);',
      ]);
      expect(result.totalChanges).toBe(2);
    });

    it('finalize 可读取未提交数据并将结果随提交返回', () => {
      engine.run('CREATE TABLE test (id INTEGER);');

      const result = engine.runBatchWithFinalize(
        ['INSERT INTO test VALUES (1);'],
        undefined,
        () => engine.query('SELECT COUNT(*) FROM test;').values[0][0],
      );

      expect(result.totalChanges).toBe(1);
      expect(result.finalizeResult).toBe(1);
      expect(engine.query('SELECT COUNT(*) FROM test;').values[0][0]).toBe(1);
    });

    it('finalize 失败时回滚已执行但尚未提交的整批语句', () => {
      engine.run('CREATE TABLE test (id INTEGER);');

      expect(() => engine.runBatchWithFinalize(
        ['INSERT INTO test VALUES (1);'],
        undefined,
        () => {
          expect(engine.query('SELECT COUNT(*) FROM test;').values[0][0]).toBe(1);
          throw new Error('finalize failed');
        },
      )).toThrow('finalize failed');

      expect(engine.query('SELECT COUNT(*) FROM test;').values[0][0]).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getTableNames
  // ═══════════════════════════════════════════════════════════════
  describe('getTableNames', () => {
    it('返回用户表名', () => {
      engine.run('CREATE TABLE alpha (id INTEGER);');
      engine.run('CREATE TABLE beta (id INTEGER);');
      const names = engine.getTableNames();
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
    });

    it('排除 _acu_ 前缀的系统表', () => {
      engine.run('CREATE TABLE user_table (id INTEGER);');
      engine.run('CREATE TABLE _acu_meta (id INTEGER);');
      const names = engine.getTableNames();
      expect(names).toContain('user_table');
      expect(names).not.toContain('_acu_meta');
    });

    it('空数据库返回空数组', () => {
      expect(engine.getTableNames()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getAllTableNames
  // ═══════════════════════════════════════════════════════════════
  describe('getAllTableNames', () => {
    it('包含 _acu_ 前缀的系统表', () => {
      engine.run('CREATE TABLE user_table (id INTEGER);');
      engine.run('CREATE TABLE _acu_meta (id INTEGER);');
      const names = engine.getAllTableNames();
      expect(names).toContain('user_table');
      expect(names).toContain('_acu_meta');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getTableInfo
  // ═══════════════════════════════════════════════════════════════
  describe('getTableInfo', () => {
    it('返回列信息', () => {
      engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER DEFAULT 0);');
      const info = engine.getTableInfo('test');
      expect(info).toHaveLength(3);

      expect(info[0].name).toBe('id');
      expect(info[0].pk).toBe(true);

      expect(info[1].name).toBe('name');
      expect(info[1].notnull).toBe(true);

      expect(info[2].name).toBe('age');
      expect(info[2].dflt_value).toBe('0');
    });

    it('非法表名抛出错误', () => {
      expect(() => engine.getTableInfo('DROP TABLE; --')).toThrow('非法表名');
    });

    it('不存在的表返回空数组', () => {
      expect(engine.getTableInfo('nonexistent')).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getTableDDL
  // ═══════════════════════════════════════════════════════════════
  describe('getTableDDL', () => {
    it('返回建表 DDL', () => {
      engine.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);');
      const ddl = engine.getTableDDL('test');
      expect(ddl).toContain('CREATE TABLE');
      expect(ddl).toContain('test');
      expect(ddl).toContain('id');
      expect(ddl).toContain('name');
    });

    it('不存在的表返回 null', () => {
      expect(engine.getTableDDL('nonexistent')).toBeNull();
    });

    it('非法表名抛出错误', () => {
      expect(() => engine.getTableDDL('1invalid')).toThrow('非法表名');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // exportBinary / loadFromBinary
  // ═══════════════════════════════════════════════════════════════
  describe('exportBinary / loadFromBinary', () => {
    it('导出并恢复数据库', async () => {
      engine.run('CREATE TABLE test (id INTEGER, name TEXT);');
      engine.run("INSERT INTO test VALUES (1, '张三');");

      const binary = engine.exportBinary();
      expect(binary).toBeInstanceOf(Uint8Array);
      expect(binary.length).toBeGreaterThan(0);

      // 恢复到新引擎
      const engine2 = new SqliteEngine();
      await engine2.loadFromBinary(binary);
      const result = engine2.query('SELECT * FROM test;');
      expect(result.values).toEqual([[1, '张三']]);
      engine2.dispose();
    });
  });
});
