// @vitest-environment node
/**
 * tests/data/sqlite/sqlite-engine-runtime.test.ts
 * 验证 T5 运行时初始化收敛：单一初始化 Promise、并发去重、失败可重试、
 * loadFromBinary 不再旁路独立 initSqlJs；T6 验证 base64 内联 wasmBinary。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({
  initSqlJs: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

// mock sql.js 引擎：initSqlJs 返回一个带 Database 构造器的运行时
vi.mock('sql.js/dist/sql-wasm.js', () => ({
  default: h.initSqlJs,
}));

import { resetSqliteRuntimeCacheForTests_ACU, SqliteEngine } from '../../../src/data/sqlite/sqlite-engine';

function fakeRuntime() {
  const dbInstances: any[] = [];
  const Database = vi.fn(function (this: any, data?: any) {
    this.export = () => new Uint8Array([1, 2, 3]);
    this.close = vi.fn();
    this.run = vi.fn();
    this.exec = vi.fn(() => []);
    dbInstances.push(this);
  }) as any;
  return { Database, dbInstances };
}

let runtime: ReturnType<typeof fakeRuntime>;

beforeEach(() => {
  vi.clearAllMocks();
  resetSqliteRuntimeCacheForTests_ACU();
  runtime = fakeRuntime();
  h.initSqlJs.mockResolvedValue(runtime);
  // 注入构建期常量：真实读取 node_modules wasm 编码为 base64，
  // 使 buildInitConfig_ACU 走内联 wasmBinary 路径（而非测试环境空兜底）。
  const wasm = readFileSync(join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
  (globalThis as any).__ACU_SQLITE_WASM_BASE64__ = wasm.toString('base64');
  (globalThis as any).__ACU_SQLITE_ENGINE__ = 'wasm';
});

afterEach(() => {
  delete (globalThis as any).__ACU_SQLITE_WASM_BASE64__;
  delete (globalThis as any).__ACU_SQLITE_ENGINE__;
  vi.restoreAllMocks();
});

describe('SqliteEngine T5 运行时初始化收敛', () => {
  it('并发 3 次 init() 只调用 initSqlJs 1 次', async () => {
    const engine = new SqliteEngine();
    await Promise.all([engine.init(), engine.init(), engine.init()]);
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);
    expect(engine.isReady).toBe(true);
    engine.dispose();
  });

  it('首次初始化失败后第二次 init() 会重新调用（Promise 不被永久缓存）', async () => {
    h.initSqlJs.mockRejectedValueOnce(new Error('engine load fail'));
    const engine = new SqliteEngine();

    await expect(engine.init()).rejects.toThrow('sql.js 初始化失败');
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);

    h.initSqlJs.mockResolvedValue(runtime);
    await expect(engine.init()).resolves.toBeUndefined();
    expect(h.initSqlJs).toHaveBeenCalledTimes(2);
    expect(engine.isReady).toBe(true);
    engine.dispose();
  });

  it('未 init() 直接 loadFromBinary() 也走同一初始化入口', async () => {
    const engine = new SqliteEngine();
    await engine.loadFromBinary(new Uint8Array([9, 9]));
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);
    expect(engine.isReady).toBe(true);
    engine.dispose();
  });

  it('T6：initSqlJs 收到 wasmBinary 配置（base64 内联 wasm）', async () => {
    const engine = new SqliteEngine();
    await engine.init();
    expect(h.initSqlJs).toHaveBeenCalledWith(
      expect.objectContaining({ wasmBinary: expect.any(Uint8Array) })
    );
    engine.dispose();
  });

  it('T6：wasmBinary 是合法 base64 解码出的 wasm 二进制', async () => {
    const engine = new SqliteEngine();
    await engine.init();
    const config = h.initSqlJs.mock.calls[0][0] as { wasmBinary?: Uint8Array };
    expect(config?.wasmBinary).toBeInstanceOf(Uint8Array);
    // 内联 wasm 以 magic \0asm 开头，且字节数非空
    expect(config!.wasmBinary!.byteLength).toBeGreaterThan(0);
    expect(Array.from(config!.wasmBinary!.slice(0, 4))).toEqual([0, 97, 115, 109]);
    engine.dispose();
  });

  it('dispose() 后 init() 不重复初始化运行时', async () => {
    const engine = new SqliteEngine();
    await engine.init();
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);

    engine.dispose();
    await engine.init();
    // 运行时（sqlJs）在 dispose 后保留，不重新初始化
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);
    expect(engine.isReady).toBe(true);
    engine.dispose();
  });

  it('init() 成功后再次 init()（未 dispose）仍只初始化一次运行时并重建 db', async () => {
    const engine = new SqliteEngine();
    await engine.init();
    await engine.init();
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);
    expect(runtime.dbInstances.length).toBe(2); // 两次 init 各建一个 db
    engine.dispose();
  });

  it('运行时为模块级单例：多个引擎实例只解码 wasm 并初始化 sql.js 一次', async () => {
    const engines = [new SqliteEngine(), new SqliteEngine(), new SqliteEngine()];
    await Promise.all(engines.map(engine => engine.init()));
    const later = new SqliteEngine();
    await later.loadFromBinary(new Uint8Array([7]));
    expect(h.initSqlJs).toHaveBeenCalledTimes(1);
    expect(runtime.dbInstances.length).toBe(4);
    [...engines, later].forEach(engine => engine.dispose());
  });

  it('模块级初始化失败后，新实例可以重试成功', async () => {
    h.initSqlJs.mockRejectedValueOnce(new Error('engine load fail'));
    await expect(new SqliteEngine().init()).rejects.toThrow('sql.js 初始化失败');
    h.initSqlJs.mockResolvedValue(runtime);
    const retry = new SqliteEngine();
    await expect(retry.init()).resolves.toBeUndefined();
    expect(h.initSqlJs).toHaveBeenCalledTimes(2);
    expect(retry.isReady).toBe(true);
    retry.dispose();
  });
});
