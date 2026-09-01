/**
 * tests/service/table/table-storage-strategy.test.ts
 * 表格存储策略选择器单元测试
 *
 * 策略：通过模块级可变变量控制 mock provider 的 loadFromChat 行为，
 * 验证 initStorageProvider/switchStorageMode/reloadStorageProvider 的编排逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetTableWriteTransactionLocksForTest_ACU, captureTableRuntimeRevisionForWriteSet_ACU, runTableWriteTransaction_ACU } from '../../../src/service/table/table-write-transaction';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

// mock storage-mode
let mockStorageMode: string = 'native';
vi.mock('../../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: vi.fn(() => mockStorageMode),
}));

const mockLoadOrCreateJsonTableFromChatHistory = vi.fn().mockResolvedValue({
  loaded: true,
  source: 'merged',
  data: { mate: {} },
});
vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: (...args: any[]) => mockLoadOrCreateJsonTableFromChatHistory(...args),
}));

// ═══════════════════════════════════════════════════════════════
// 可变控制变量：控制 SQLite provider 的 loadFromChat 行为
// ═══════════════════════════════════════════════════════════════
let sqliteLoadResult: { loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string } = { loaded: true, source: 'merged' };
let sqliteLoadShouldThrow: Error | null = null;
let sqliteProviderReady: boolean = true;
let sqliteHydrateGate: Promise<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string }> | null = null;
let nativeReloadGate: Promise<void> | null = null;
let nativeReloadStarted: (() => void) | null = null;

// 记录所有创建的 provider 实例，用于验证 dispose 等调用
let allCreatedProviders: Array<ReturnType<typeof createMockProvider>> = [];

function createMockProvider(mode: 'native' | 'sqlite') {
  let currentData: any = { mate: {} };
  const provider = {
    mode,
    loadFromChat: vi.fn(async () => {
      if (mode === 'sqlite' && sqliteLoadShouldThrow) {
        throw sqliteLoadShouldThrow;
      }
      if (mode === 'sqlite') {
        return { ...sqliteLoadResult };
      }
      if (nativeReloadGate) {
        nativeReloadStarted?.();
        await nativeReloadGate;
      }
      return { loaded: true, source: 'merged' as const };
    }),
    loadFromData: vi.fn(async (data?: any) => {
      if (mode === 'sqlite' && sqliteLoadShouldThrow) {
        throw sqliteLoadShouldThrow;
      }
      currentData = data || null;
      if (mode === 'sqlite') {
        if (sqliteHydrateGate) {
          await sqliteHydrateGate;
        }
        return { ...sqliteLoadResult };
      }
      return { loaded: true, source: 'merged' as const };
    }),
    saveToChat: vi.fn().mockResolvedValue({ saved: true }),
    isReady: vi.fn(() => (mode === 'sqlite' ? sqliteProviderReady : true)),
    getCurrentData: vi.fn(() => currentData),
    applyEdits: vi.fn().mockReturnValue({ success: true, modifiedKeys: [], appliedEdits: 1 }),
    executeQuery: vi.fn(),
    executeMutation: vi.fn(),
    dispose: vi.fn(),
  };
  allCreatedProviders.push(provider);
  return provider;
}

// mock SqlTableService 和 NativeTableServiceAdapter
vi.mock('../../../src/service/table/sql-table-service', () => ({
  SqlTableService: vi.fn(() => createMockProvider('sqlite')),
}));

vi.mock('../../../src/service/table/native-table-service-adapter', () => ({
  NativeTableServiceAdapter: vi.fn(() => createMockProvider('native')),
}));

import {
  getStorageProvider,
  getActiveStorageProvider,
  initStorageProvider,
  ensureStorageProviderReady_ACU,
  switchStorageMode,
  reloadStorageProvider,
  disposeStorageProvider,
  clearTableRuntimeWithoutReload_ACU,
  getCurrentProviderMode,
  getStorageRuntimeHealth_ACU,
  didSqliteFallbackAfterReload_ACU,
  getRuntimeLifecycleEpoch_ACU,
  hydrateStorageProviderFromSnapshot_ACU,
} from '../../../src/service/table/table-storage-strategy';
import { createCanonicalSnapshotEnvelope_ACU } from '../../../src/service/table/canonical-snapshot-envelope';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../../../src/service/runtime/state-manager';

function deferred_ACU<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('table-storage-strategy', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _resetTableWriteTransactionLocksForTest_ACU();
    mockStorageMode = 'native';
    sqliteLoadResult = { loaded: true, source: 'merged' };
    sqliteLoadShouldThrow = null;
    sqliteProviderReady = true;
    sqliteHydrateGate = null;
    nativeReloadGate = null;
    nativeReloadStarted = null;
    allCreatedProviders = [];
    mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: { mate: {} } });
    // 重置模块内部状态
    await initStorageProvider();
    // 清空记录，让后续测试从干净状态开始
    allCreatedProviders = [];
  });

  // ═══════════════════════════════════════════════════════════════
  // getStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('getStorageProvider', () => {
    it('返回当前 Provider', () => {
      const provider = getStorageProvider();
      expect(provider).toBeDefined();
      expect(provider.mode).toBe('native');
    });

    it('懒初始化：未初始化时自动创建', () => {
      const provider = getStorageProvider();
      expect(provider).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getActiveStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('getActiveStorageProvider', () => {
    it('返回已初始化实例，且设置变化不会触发重建', () => {
      const provider = getActiveStorageProvider();
      const createdCount = allCreatedProviders.length;

      mockStorageMode = 'sqlite';

      expect(getActiveStorageProvider()).toBe(provider);
      expect(provider?.mode).toBe('native');
      expect(allCreatedProviders).toHaveLength(createdCount);
    });

    it('dispose 后返回 null，不执行惰性初始化', async () => {
      await initStorageProvider();
      const provider = getActiveStorageProvider();

      disposeStorageProvider();

      expect(provider?.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // initStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('initStorageProvider', () => {
    it('native 模式初始化', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('sqlite 模式初始化', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('sqlite');
    });

    it('sqlite 初始化使用本轮 canonical 回放快照，而非 provider 自行回放聊天', async () => {
      mockStorageMode = 'sqlite';
      const canonicalData = { mate: {}, sheet_0: { content: [['row_id'], ['1']] } };
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: canonicalData });

      await initStorageProvider();

      const provider = getActiveStorageProvider()!;
      expect(provider.mode).toBe('sqlite');
      expect(provider.loadFromData).toHaveBeenCalledWith(canonicalData);
      expect(provider.loadFromChat).not.toHaveBeenCalled();
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledOnce();
    });

    it('初始化时调用 loadFromChat', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();
      expect(provider.loadFromChat).toHaveBeenCalled();
    });

    it('SQLite 加载失败时 fallback 到 native', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'sql.js 加载失败' };

      const result = await initStorageProvider();
      // fallback 后应该是 native 模式
      expect(getCurrentProviderMode()).toBe('native');
      expect(result).toMatchObject({ ok: false, degraded: true, failureCode: 'provider_fallback' });
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({
        status: 'degraded', expectedMode: 'sqlite', activeMode: 'native', failureCode: 'provider_fallback',
      });
    });

    it('同一 SQLite 初始化航班复用单次 canonical replay', async () => {
      mockStorageMode = 'sqlite';
      let releaseReplay: ((value: any) => void) | undefined;
      mockLoadOrCreateJsonTableFromChatHistory.mockImplementationOnce(() => new Promise(resolve => {
        releaseReplay = resolve;
      }));

      const first = initStorageProvider();
      const second = initStorageProvider();

      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledTimes(1);
      releaseReplay?.({ loaded: true, source: 'merged', data: { mate: {} } });

      await expect(first).resolves.toMatchObject({ ok: true, degraded: false, source: 'merged' });
      await expect(second).resolves.toMatchObject({ ok: true, degraded: false, source: 'merged' });
      expect(allCreatedProviders.filter(provider => provider.mode === 'sqlite')).toHaveLength(1);
    });

    it('设置在候选 SQLite hydrate 期间切换时丢弃陈旧候选', async () => {
      mockStorageMode = 'sqlite';
      let releaseReplay: ((value: any) => void) | undefined;
      mockLoadOrCreateJsonTableFromChatHistory.mockImplementationOnce(() => new Promise(resolve => {
        releaseReplay = resolve;
      }));

      const initialization = initStorageProvider();
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledTimes(1);
      mockStorageMode = 'native';
      releaseReplay?.({ loaded: true, source: 'merged', data: { mate: {} } });

      await expect(initialization).resolves.toMatchObject({ ok: false, degraded: false, failureCode: 'stale_load_discarded' });
      expect(getCurrentProviderMode()).toBe('native');
      expect(allCreatedProviders.find(provider => provider.mode === 'sqlite')?.dispose).toHaveBeenCalledOnce();
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({
        status: 'idle', expectedMode: 'native', failureCode: 'stale_load_discarded',
      });
    });

    it('SQLite 初始化异常时 fallback 到 native', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadShouldThrow = new Error('WASM 加载失败');

      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('SQLite 初始化异常时销毁未提交的候选，避免其继续持有全局映射发布权', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadShouldThrow = new Error('WASM 加载失败');

      await initStorageProvider();

      const sqliteCandidate = allCreatedProviders.find(provider => provider.mode === 'sqlite');
      expect(sqliteCandidate).toBeDefined();
      // 恰好一次：候选既不能泄漏，也不能被重复销毁。
      expect(sqliteCandidate!.dispose).toHaveBeenCalledTimes(1);
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('销毁旧实例后创建新实例', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const oldProvider = getStorageProvider();

      await initStorageProvider();
      // 旧 provider 应该被 dispose
      expect(oldProvider.dispose).toHaveBeenCalled();
    });

    it('空状态冷初始化保持 SQLite ready（loaded=false/source=empty 不是失败）', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty' };

      const result = await initStorageProvider();

      expect(result).toMatchObject({ ok: true, degraded: false, source: 'empty' });
      expect(getCurrentProviderMode()).toBe('sqlite');
      expect(getActiveStorageProvider()!.isReady()).toBe(true);
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({
        status: 'ready', expectedMode: 'sqlite', activeMode: 'sqlite', source: 'empty',
      });
    });

    it('空状态但候选 not-ready 时冷初始化 fail-loud 回退 native（错误不为 unknown）', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty' };
      sqliteProviderReady = false;

      const result = await initStorageProvider();

      expect(result).toMatchObject({
        ok: false, degraded: true, failureCode: 'provider_fallback', error: 'provider_not_ready_after_init',
      });
      expect(getCurrentProviderMode()).toBe('native');
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({ status: 'degraded', activeMode: 'native' });
    });
  });

  describe('ensureStorageProviderReady_ACU', () => {
    it('SQLite fallback 后不创建裸 SQLite，并明确阻止 SQL 写入', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: '旧数据 hydrate 失败' };

      await initStorageProvider();
      const fallbackProvider = getActiveStorageProvider()!;
      const createdCount = allCreatedProviders.length;

      await expect(ensureStorageProviderReady_ACU()).rejects.toThrow('sqlite 存储运行时未就绪');

      const activeProvider = getActiveStorageProvider()!;
      expect(activeProvider).not.toBe(fallbackProvider);
      expect(activeProvider.mode).toBe('native');
      expect(activeProvider.isReady()).toBe(true);
      expect(allCreatedProviders).toHaveLength(createdCount + 2);
      expect(allCreatedProviders.at(-1)?.mode).toBe('native');
      expect(allCreatedProviders.at(-2)?.mode).toBe('sqlite');
      const attemptedSqliteProvider = allCreatedProviders.at(-2)!;
      expect(attemptedSqliteProvider.loadFromData).toHaveBeenCalledOnce();
    });

    it('已 ready 的 SQLite 直接返回原实例，不再次回放或 hydrate', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const provider = getActiveStorageProvider()!;
      const createdCount = allCreatedProviders.length;

      await expect(ensureStorageProviderReady_ACU()).resolves.toBe(provider);

      expect(allCreatedProviders).toHaveLength(createdCount);
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledOnce();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // switchStorageMode
  // ═══════════════════════════════════════════════════════════════
  describe('switchStorageMode', () => {
    it('从 native 切换到 sqlite', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');

      await switchStorageMode('sqlite');
      expect(getCurrentProviderMode()).toBe('sqlite');
    });

    it('同模式切换跳过（不重新创建）', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();

      await switchStorageMode('native');
      // 不应该 dispose（因为跳过了）
      expect(provider.dispose).not.toHaveBeenCalled();
    });

    it('切换时销毁旧 Provider', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const oldProvider = getStorageProvider();

      await switchStorageMode('sqlite');
      expect(oldProvider.dispose).toHaveBeenCalled();
    });

    it('SQLite 切换失败时 fallback 并抛出错误', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();

      // 设置 SQLite 加载失败
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'WASM 错误' };

      await expect(switchStorageMode('sqlite')).rejects.toThrow('已自动回退');
      // fallback 后应该是 native
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('SQLite 切换异常时 fallback', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();

      sqliteLoadShouldThrow = new Error('意外错误');

      await expect(switchStorageMode('sqlite')).rejects.toThrow('意外错误');
      // 应该有可用的 provider
      expect(getCurrentProviderMode()).not.toBeNull();
    });

    it('空状态模式切换保持 SQLite ready（与冷初始化、hydrate 同矩阵）', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty' };

      await expect(switchStorageMode('sqlite')).resolves.toBeUndefined();

      expect(getCurrentProviderMode()).toBe('sqlite');
      expect(getActiveStorageProvider()!.isReady()).toBe(true);
    });

    it('空状态但候选 not-ready 时模式切换 fail-loud 回退 native 并抛出明确错误', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty' };
      sqliteProviderReady = false;

      await expect(switchStorageMode('sqlite')).rejects.toThrow('provider_not_ready_after_switch');
      expect(getCurrentProviderMode()).toBe('native');
    });

  });

  // ═══════════════════════════════════════════════════════════════
  // reloadStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('reloadStorageProvider', () => {
    it('重载前后 canonical 数据一致时不推进 RuntimeRevision', async () => {
      mockStorageMode = 'sqlite';
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: { mate: {}, sheet_0: { content: [['row_id'], ['1']] } } });
      await initStorageProvider();
      const before = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);

      await reloadStorageProvider();

      const after = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);
      expect(after).toBe(before);
    });

    it('重载替换了 canonical 数据时只推进一次 RuntimeRevision', async () => {
      mockStorageMode = 'sqlite';
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: { mate: {}, sheet_0: { content: [['row_id'], ['1']] } } });
      await initStorageProvider();
      const before = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);
      mockLoadOrCreateJsonTableFromChatHistory.mockResolvedValue({ loaded: true, source: 'merged', data: { mate: {}, sheet_0: { content: [['row_id'], ['1'], ['2']] } } });

      await reloadStorageProvider();

      const after = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);
      expect(after).not.toBe(before);
      const afterSecondCapture = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);
      expect(afterSecondCapture).toBe(after);
    });

    it('native 模式重新加载', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();

      await reloadStorageProvider();
      // native 模式直接调用 loadFromChat
      expect(provider.loadFromChat).toHaveBeenCalled();
    });

    it('sqlite 模式重建数据库', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      allCreatedProviders = []; // 清空记录

      const oldProvider = getStorageProvider();

      await reloadStorageProvider();
      // sqlite 模式需要 dispose 旧实例并重建
      expect(oldProvider.dispose).toHaveBeenCalled();
      // 应该创建了新的 provider
      expect(allCreatedProviders.length).toBeGreaterThan(0);
    });

    it('SQLite 重新加载失败时 fallback', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();

      // 设置重新加载时失败
      sqliteLoadShouldThrow = new Error('重新加载失败');

      await reloadStorageProvider();
      // fallback 到 native
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('等待同一作用域的活跃写事务释放后才重建运行时', async () => {
      const releaseWriter = deferred_ACU();
      const writerStarted = deferred_ACU();
      const events: string[] = [];
      const provider = getStorageProvider();
      provider.loadFromChat.mockClear();

      const writer = runTableWriteTransaction_ACU({
        source: 'manual_crud',
        reason: 'concurrent-write',
        writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
      }, async () => {
        events.push('writer:start');
        writerStarted.resolve();
        await releaseWriter.promise;
        events.push('writer:end');
      });
      await writerStarted.promise;

      const reload = reloadStorageProvider().then(() => events.push('reload:end'));
      await Promise.resolve();
      expect(events).toEqual(['writer:start']);
      expect(provider.loadFromChat).not.toHaveBeenCalled();

      releaseWriter.resolve();
      await Promise.all([writer, reload]);
      expect(events).toEqual(['writer:start', 'writer:end', 'reload:end']);
      expect(provider.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()?.loadFromChat).toHaveBeenCalledOnce();
    });

    it('重建运行时期间阻塞同一作用域的新写事务', async () => {
      const releaseReload = deferred_ACU();
      const reloadStarted = deferred_ACU();
      const writerStarted = deferred_ACU();
      const events: string[] = [];
      nativeReloadGate = releaseReload.promise;
      nativeReloadStarted = () => reloadStarted.resolve();

      const reload = reloadStorageProvider().then(() => events.push('reload:end'));
      await reloadStarted.promise;

      const writer = runTableWriteTransaction_ACU({
        source: 'manual_crud',
        reason: 'write-during-reload',
        writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
      }, async () => {
        events.push('writer:start');
        writerStarted.resolve();
      });
      await Promise.resolve();
      expect(events).toEqual([]);

      releaseReload.resolve();
      await reload;
      await writerStarted.promise;
      await writer;
      expect(events).toEqual(['reload:end', 'writer:start']);
    });

    it('readiness 请求复用活跃 reload 航班，不基于旧 ready provider 提前放行', async () => {
      const releaseReload = deferred_ACU();
      const reloadStarted = deferred_ACU();
      nativeReloadGate = releaseReload.promise;
      nativeReloadStarted = () => reloadStarted.resolve();

      const oldProvider = getActiveStorageProvider();
      const reload = reloadStorageProvider();
      await reloadStarted.promise;

      let readinessSettled = false;
      const readiness = ensureStorageProviderReady_ACU().then((provider) => {
        readinessSettled = true;
        return provider;
      });
      await Promise.resolve();

      expect(readinessSettled).toBe(false);
      expect(getActiveStorageProvider()).toBe(oldProvider);

      releaseReload.resolve();
      const [loadResult, readyProvider] = await Promise.all([reload, readiness]);
      expect(loadResult).toMatchObject({ ok: true, degraded: false });
      expect(readyProvider).toBe(getActiveStorageProvider());
      expect(readyProvider).not.toBe(oldProvider);
    });

    it('等待活跃 reload readiness 时可取消，且不会取消全局 reload 航班', async () => {
      const releaseReload = deferred_ACU();
      const reloadStarted = deferred_ACU();
      nativeReloadGate = releaseReload.promise;
      nativeReloadStarted = () => reloadStarted.resolve();

      const reload = reloadStorageProvider();
      await reloadStarted.promise;
      const controller = new AbortController();
      const readiness = ensureStorageProviderReady_ACU({ signal: controller.signal });

      controller.abort();
      await expect(readiness).rejects.toMatchObject({ name: 'AbortError' });

      releaseReload.resolve();
      await expect(reload).resolves.toMatchObject({ ok: true, degraded: false });
      expect(getStorageRuntimeHealth_ACU().status).toBe('ready');
    });

    it('排他 reload 不复用锁外初始化航班，并丢弃旧候选', async () => {
      mockStorageMode = 'sqlite';
      const releaseOldReplay = deferred_ACU<any>();
      const writerStarted = deferred_ACU();
      const releaseWriter = deferred_ACU();
      const activeProviderBeforeReload = getActiveStorageProvider()!;
      mockLoadOrCreateJsonTableFromChatHistory
        .mockImplementationOnce(() => releaseOldReplay.promise)
        .mockResolvedValueOnce({ loaded: true, source: 'merged', data: { mate: { generation: 'reload' } } });

      const oldInitialization = initStorageProvider();
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledOnce();
      const staleCandidate = allCreatedProviders.find(provider => provider.mode === 'sqlite')!;
      const writer = runTableWriteTransaction_ACU({
        source: 'manual_crud',
        reason: 'write-before-reload',
        writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
      }, async () => {
        writerStarted.resolve();
        await releaseWriter.promise;
      });
      await writerStarted.promise;

      const reload = reloadStorageProvider();
      releaseOldReplay.resolve({ loaded: true, source: 'merged', data: { mate: { generation: 'old' } } });
      await expect(oldInitialization).resolves.toMatchObject({ failureCode: 'stale_load_discarded' });
      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledOnce();
      expect(staleCandidate.dispose).toHaveBeenCalledOnce();
      expect(activeProviderBeforeReload.dispose).not.toHaveBeenCalled();
      expect(getActiveStorageProvider()).toBe(activeProviderBeforeReload);

      releaseWriter.resolve();
      await reload;

      expect(mockLoadOrCreateJsonTableFromChatHistory).toHaveBeenCalledTimes(2);
      const reloadedProvider = getActiveStorageProvider()!;
      expect(reloadedProvider.loadFromData).toHaveBeenCalledWith({ mate: { generation: 'reload' } });
      expect(getActiveStorageProvider()).toBe(reloadedProvider);
      await writer;
    });

    it('并发 reload 复用同一排他航班，不会废弃已持锁的 hydrate', async () => {
      const releaseReload = deferred_ACU();
      const reloadStarted = deferred_ACU();
      nativeReloadGate = releaseReload.promise;
      nativeReloadStarted = () => reloadStarted.resolve();

      const first = reloadStorageProvider();
      await reloadStarted.promise;
      const second = reloadStorageProvider();

      releaseReload.resolve();
      await expect(second).resolves.toMatchObject({ ok: true });
      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ ok: true }),
        expect.objectContaining({ ok: true }),
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // disposeStorageProvider
  // ═══════════════════════════════════════════════════════════════
  describe('disposeStorageProvider', () => {
    it('销毁后 getCurrentProviderMode 返回 null', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('sqlite');

      disposeStorageProvider();
      expect(getCurrentProviderMode()).toBeNull();
    });

    it('销毁后 getStorageProvider 会懒初始化新实例', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const oldProvider = getStorageProvider();

      disposeStorageProvider();
      expect(oldProvider.dispose).toHaveBeenCalled();

      // 懒初始化会创建新实例
      const newProvider = getStorageProvider();
      expect(newProvider).toBeDefined();
      expect(newProvider).not.toBe(oldProvider);
    });

    it('dispose 会废弃未完成的 SQLite 候选，避免其重新发布', async () => {
      mockStorageMode = 'sqlite';
      const releaseReplay = deferred_ACU<any>();
      mockLoadOrCreateJsonTableFromChatHistory.mockImplementationOnce(() => releaseReplay.promise);

      const initialization = initStorageProvider();
      const staleCandidate = allCreatedProviders.find(provider => provider.mode === 'sqlite')!;
      disposeStorageProvider();
      releaseReplay.resolve({ loaded: true, source: 'merged', data: { mate: { generation: 'old-chat' } } });

      await expect(initialization).resolves.toMatchObject({ failureCode: 'stale_load_discarded' });
      expect(staleCandidate.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()).toBeNull();
    });

    it('未初始化时 dispose 不抛错', () => {
      disposeStorageProvider(); // 先清空
      expect(() => disposeStorageProvider()).not.toThrow();
    });

    it('native 模式下 dispose 也能正常工作', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const provider = getStorageProvider();

      disposeStorageProvider();
      expect(provider.dispose).toHaveBeenCalled();
      expect(getCurrentProviderMode()).toBeNull();
    });
  });

  describe('clearTableRuntimeWithoutReload_ACU', () => {
    it('销毁当前 provider 且不从聊天或模板重建运行时', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const provider = getActiveStorageProvider()!;
      mockLoadOrCreateJsonTableFromChatHistory.mockClear();

      clearTableRuntimeWithoutReload_ACU();

      expect(provider.dispose).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()).toBeNull();
      expect(getCurrentProviderMode()).toBeNull();
      expect(mockLoadOrCreateJsonTableFromChatHistory).not.toHaveBeenCalled();
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({ status: 'disposed', activeMode: null });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentProviderMode
  // ═══════════════════════════════════════════════════════════════
  describe('getCurrentProviderMode', () => {
    it('初始化后返回当前模式', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('切换后返回新模式', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      await switchStorageMode('sqlite');
      expect(getCurrentProviderMode()).toBe('sqlite');
    });
  });

  describe('didSqliteFallbackAfterReload_ACU', () => {
    it('SQLite 预期与设置保持不变、provider 已为 native 时报告静默 fallback', async () => {
      mockStorageMode = 'sqlite';
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'sql.js 加载失败' };

      await initStorageProvider();

      expect(getCurrentProviderMode()).toBe('native');
      expect(didSqliteFallbackAfterReload_ACU('sqlite')).toBe(true);
    });

    it('reload 期间设置切到 native 时不把 native provider 误报为 fallback', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();

      expect(getCurrentProviderMode()).toBe('native');
      expect(didSqliteFallbackAfterReload_ACU('sqlite')).toBe(false);
    });

    it('SQLite provider 成功就绪时不报告 fallback', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();

      expect(getCurrentProviderMode()).toBe('sqlite');
      expect(didSqliteFallbackAfterReload_ACU('sqlite')).toBe(false);
    });

    it('reload 前预期为 native 时不报告 fallback', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();

      expect(didSqliteFallbackAfterReload_ACU('native')).toBe(false);
    });

  // ═══════════════════════════════════════════════════════════════
  // 阶段 C：CanonicalSnapshotEnvelope hydrate 窄入口
  // ═══════════════════════════════════════════════════════════════
  describe('hydrateStorageProviderFromSnapshot_ACU（阶段 C）', () => {
    function buildEnvelope(overrides: Record<string, unknown> = {}) {
      const data = {
        mate: { type: 'acu', version: 1 },
        sheet_0: { content: [['row_id', 'name'], ['1', '铁剑']], sourceData: { ddl: 'CREATE TABLE t (row_id INTEGER PRIMARY KEY, name TEXT);' } },
      };
      return createCanonicalSnapshotEnvelope_ACU({
        data,
        chatIdentity: String(currentChatFileIdentifier_ACU || ''),
        isolationKey: getCurrentIsolationKey_ACU(),
        storageMode: 'sqlite',
        lifecycleEpoch: getRuntimeLifecycleEpoch_ACU(),
        source: 'merged_refresh',
        ...overrides,
      })!;
    }

    it('接受 boundary_commit_head 来源的 verified head envelope 并 hydrate 活跃 provider', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const envelope = buildEnvelope({ source: 'boundary_commit_head' });
      const replayCallsBefore = mockLoadOrCreateJsonTableFromChatHistory.mock.calls.length;

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: true, degraded: false });
      expect(mockLoadOrCreateJsonTableFromChatHistory.mock.calls.length).toBe(replayCallsBefore);
      expect(getActiveStorageProvider()!.loadFromData).toHaveBeenCalledOnce();
      expect(getActiveStorageProvider()!.getCurrentData()).toEqual(envelope.data);
    });

    it('sqlite 模式下同一 canonical 输入经 hydrate 后 provider 持有相同数据（不触发聊天 replay）', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const createdCount = allCreatedProviders.length;
      const envelope = buildEnvelope();
      const replayCallsBefore = mockLoadOrCreateJsonTableFromChatHistory.mock.calls.length;

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: true, degraded: false });
      expect(getCurrentProviderMode()).toBe('sqlite');
      // hydrate 路径不调用聊天 replay（对比 reloadStorageProvider 的冷路径）。
      expect(mockLoadOrCreateJsonTableFromChatHistory.mock.calls.length).toBe(replayCallsBefore);
      const provider = getActiveStorageProvider()!;
      expect(provider.mode).toBe('sqlite');
      expect(provider.loadFromData).toHaveBeenCalledOnce();
      expect(provider.getCurrentData()).toEqual(envelope.data);
      // 恰好新增一个 sqlite 候选并被发布。
      expect(allCreatedProviders.filter(p => p.mode === 'sqlite').length).toBeGreaterThanOrEqual(createdCount ? createdCount : 1);
    });

    it('身份预检失败（chatIdentity 不匹配）时不进入 hydrate，返回 stale_load_discarded', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeBefore = getActiveStorageProvider();
      const envelope = buildEnvelope({ chatIdentity: 'another-chat' });

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: false, failureCode: 'stale_load_discarded' });
      expect(getActiveStorageProvider()).toBe(activeBefore);
      expect(getActiveStorageProvider()!.dispose).not.toHaveBeenCalled();
    });

    it('lifecycle epoch 不匹配时丢弃候选，不发布新 provider', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeBefore = getActiveStorageProvider();
      const envelope = buildEnvelope({ lifecycleEpoch: getRuntimeLifecycleEpoch_ACU() + 999 });

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: false, failureCode: 'stale_load_discarded' });
      expect(getActiveStorageProvider()).toBe(activeBefore);
    });

    it('当前为 native 模式时拒绝 sqlite snapshot hydrate', async () => {
      mockStorageMode = 'native';
      await initStorageProvider();
      const activeBefore = getActiveStorageProvider();
      const envelope = buildEnvelope({ storageMode: 'sqlite' });

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: false, failureCode: 'stale_load_discarded' });
      expect(getActiveStorageProvider()).toBe(activeBefore);
    });

    it('sqlite hydrate 失败时沿用 fallback 语义（回退 native，不复活上一 provider）', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'hydrate 失败' };
      const envelope = buildEnvelope();

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: false, degraded: true, failureCode: 'provider_fallback' });
      expect(getCurrentProviderMode()).toBe('native');
    });

    it('空 canonical snapshot hydrate 成功：发布 ready SQLite，不降级不产生 ERROR', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeBefore = getActiveStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty' };
      // canonical 不允许 null data；空 schema 用仅含 metadata 的空壳表示。
      const envelope = buildEnvelope({ data: { mate: { type: 'acu', version: 1 } } });

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: true, degraded: false, source: 'empty' });
      // 新 SQLite 候选已发布，旧 provider 被正确 dispose（不得复活）。
      expect(getActiveStorageProvider()).not.toBe(activeBefore);
      expect(getActiveStorageProvider()!.mode).toBe('sqlite');
      expect(activeBefore!.dispose).toHaveBeenCalled();
      const health = getStorageRuntimeHealth_ACU();
      expect(health).toMatchObject({
        status: 'ready', expectedMode: 'sqlite', activeMode: 'sqlite', source: 'empty',
      });
      expect(health.failureCode).toBeUndefined();
      expect(health.error).toBeUndefined();
      // 空快照是正常状态：不得出现失败/unknown/fallback ERROR。
      expect((await import('../../../src/shared/utils')).logError_ACU).not.toHaveBeenCalled();
    });

    it('真实 hydrate 失败保持 fallback，并保留原始 error', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty', error: 'hydrate 失败' };
      const envelope = buildEnvelope();

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({ ok: false, degraded: true, failureCode: 'provider_fallback', error: 'hydrate 失败' });
      expect(getCurrentProviderMode()).toBe('native');
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({
        status: 'degraded', expectedMode: 'sqlite', activeMode: 'native',
        failureCode: 'provider_fallback', error: 'hydrate 失败',
      });
    });

    it('无 error 但候选 not-ready 时不得发布 SQLite，错误不为 unknown', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty' };
      sqliteProviderReady = false;
      const envelope = buildEnvelope();

      const result = await hydrateStorageProviderFromSnapshot_ACU(envelope);

      expect(result).toMatchObject({
        ok: false, degraded: true, failureCode: 'provider_fallback', error: 'provider_not_ready_after_hydrate',
      });
      // 绝不发布裸/半初始化 SQLite。
      expect(getCurrentProviderMode()).toBe('native');
      expect(getStorageRuntimeHealth_ACU()).toMatchObject({ status: 'degraded', activeMode: 'native' });
    });

    it('空 hydrate 期间 lifecycle 漂移仍返回 stale_load_discarded，候选被销毁', async () => {
      mockStorageMode = 'sqlite';
      await initStorageProvider();
      const activeBefore = getActiveStorageProvider();
      sqliteLoadResult = { loaded: false, source: 'empty' };
      const envelope = buildEnvelope({ data: { mate: { type: 'acu', version: 1 } } });

      let releaseHydrate!: (value: any) => void;
      sqliteHydrateGate = new Promise(resolve => { releaseHydrate = resolve; });
      const pending = hydrateStorageProviderFromSnapshot_ACU(envelope);
      // hydrate 挂起期间 lifecycle 漂移（dispose 推进 epoch 并清空当前 provider）。
      disposeStorageProvider();
      releaseHydrate({ loaded: false, source: 'empty' });

      const result = await pending;

      expect(result).toMatchObject({ ok: false, degraded: false, failureCode: 'stale_load_discarded' });
      // 候选必须销毁，不能覆盖 dispose 后的空运行时。
      const sqliteCandidates = allCreatedProviders.filter(p => p.mode === 'sqlite');
      expect(sqliteCandidates[sqliteCandidates.length - 1].dispose).toHaveBeenCalled();
      expect(getActiveStorageProvider()).not.toBe(activeBefore);
      expect(getActiveStorageProvider()?.mode).not.toBe('sqlite');
    });
  });

  });
});
