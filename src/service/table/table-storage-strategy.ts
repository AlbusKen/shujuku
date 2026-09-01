/**
 * service/table/table-storage-strategy.ts — 表格存储策略选择器
 *
 * 根据用户设置选择 native 或 sqlite 模式的 Provider。
 * 提供全局单例访问点，是上层代码获取 Provider 的唯一入口。
 */

import type { ITableStorageProvider, StorageMode } from '../../shared/table-storage-provider';
import { getCurrentStorageMode } from './storage-mode';
import { NativeTableServiceAdapter } from './native-table-service-adapter';
import { SqlTableService } from './sql-table-service';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { loadOrCreateJsonTableFromChatHistory_ACU } from './table-service';
import { _set_currentJsonTableData_ACU, _set_independentTableStates_ACU, currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { invalidateTableRuntimeRevision_ACU, runTableWriteTransaction_ACU } from './table-write-transaction';
import { type CanonicalSnapshotEnvelope_ACU, isCanonicalSnapshotEnvelope_ACU } from './canonical-snapshot-envelope';

/** 当前活跃的 Provider 实例 */
let currentProvider: ITableStorageProvider | null = null;

export type StorageRuntimeStatus_ACU = 'idle' | 'loading' | 'ready' | 'degraded' | 'failed' | 'disposed';

export interface StorageRuntimeHealth_ACU {
  status: StorageRuntimeStatus_ACU;
  expectedMode: StorageMode;
  activeMode: StorageMode | null;
  loadToken: number;
  source?: 'merged' | 'initialized' | 'empty';
  failureCode?: 'provider_fallback' | 'provider_load_failed' | 'provider_init_failed' | 'stale_load_discarded';
  error?: string;
}

export interface StorageRuntimeLoadResult_ACU {
  ok: boolean;
  degraded: boolean;
  source?: 'merged' | 'initialized' | 'empty';
  failureCode?: StorageRuntimeHealth_ACU['failureCode'];
  error?: string;
}

let runtimeHealth: StorageRuntimeHealth_ACU = {
  status: 'idle',
  expectedMode: 'native',
  activeMode: null,
  loadToken: 0,
};
let activeInitialization: { mode: StorageMode; promise: Promise<StorageRuntimeLoadResult_ACU> } | null = null;
let initializationEpoch_ACU = 0;
let activeReload_ACU: Promise<StorageRuntimeLoadResult_ACU> | null = null;
let runtimeLifecycleEpoch_ACU = 0;

/**
 * 当前存储 runtime 生命周期 epoch（只读）。阶段 D/E 编排层用它构造
 * CanonicalSnapshotEnvelope 并在 hydrate 前后复核身份；模块内其余路径
 * 仍直接访问私有 runtimeLifecycleEpoch_ACU，不经过本 getter。
 */
export function getRuntimeLifecycleEpoch_ACU(): number {
  return runtimeLifecycleEpoch_ACU;
}


function canonicalRuntimeData_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRuntimeData_ACU).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalRuntimeData_ACU(record[key])}`)
    .join(',')}}`;
}

function captureRuntimeIdentity_ACU(provider: ITableStorageProvider | null): { mode: StorageMode; data: string } | null {
  if (!provider) return null;
  try {
    return {
      mode: provider.mode,
      data: canonicalRuntimeData_ACU(provider.getCurrentData()),
    };
  } catch (_) {
    return null;
  }
}

function runtimeIdentityChanged_ACU(
  before: { mode: StorageMode; data: string } | null,
  after: { mode: StorageMode; data: string } | null,
): boolean {
  return !before || !after || before.mode !== after.mode || before.data !== after.data;
}

function setRuntimeHealth_ACU(next: Omit<StorageRuntimeHealth_ACU, 'loadToken'>): void {
  runtimeHealth = { ...next, loadToken: runtimeHealth.loadToken + 1 };
}

/** 只读健康快照；绝不触发 provider 懒初始化。 */
export function getStorageRuntimeHealth_ACU(): StorageRuntimeHealth_ACU {
  return { ...runtimeHealth };
}

/** 同步读路径门禁。模板渲染不能在这里异步 hydrate 或创建裸 SQLite provider。 */
export function isStorageRuntimeReadyForSyncRead_ACU(): boolean {
  const expectedMode = getCurrentStorageMode();
  return runtimeHealth.status === 'ready'
    && runtimeHealth.expectedMode === expectedMode
    && currentProvider?.mode === expectedMode
    && currentProvider.isReady();
}

/**
 * 获取当前存储提供者
 * 如果尚未初始化，会根据当前设置自动创建
 */
export function getStorageProvider(): ITableStorageProvider {
  const mode = getCurrentStorageMode();
  if (!currentProvider || currentProvider.mode !== mode) {
    if (currentProvider) {
      logDebug_ACU(`[StorageStrategy] Provider 模式变化，重建: ${currentProvider.mode} → ${mode}`);
      currentProvider.dispose();
    }
    // 懒初始化：根据当前模式创建 Provider
    currentProvider = createProvider(mode);
    logDebug_ACU(`[StorageStrategy] 懒初始化 Provider: ${mode}`);
  }
  return currentProvider;
}

/**
 * 获取当前已激活的 Provider，不会按设置懒初始化或重建实例。
 * 用于需要观察 SQLite fallback 后实际运行时状态的恢复与诊断流程。
 */
export function getActiveStorageProvider(): ITableStorageProvider | null {
  return currentProvider;
}

function createStorageWaitAbortError_ACU(): Error {
  const error = new Error('Storage runtime readiness wait aborted.');
  error.name = 'AbortError';
  return error;
}

async function awaitStorageFlight_ACU<T>(
  promise: Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  const { signal, timeoutMs } = options;
  if (signal?.aborted) throw createStorageWaitAbortError_ACU();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (task: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      task();
    };
    const onAbort = () => finish(() => reject(createStorageWaitAbortError_ACU()));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (Number.isFinite(timeoutMs) && Number(timeoutMs) >= 0) {
      timeout = setTimeout(() => finish(() => reject(new Error('Storage runtime readiness wait timed out.'))), Number(timeoutMs));
    }
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

export async function ensureStorageProviderReady_ACU(
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ITableStorageProvider> {
  const expectedMode = getCurrentStorageMode();
  let activeProvider = getActiveStorageProvider();

  // A reload owns the authoritative current-chat hydrate flight. Joining it is
  // materially different from polling or starting a competing initialization:
  // only the reload may publish the post-transition runtime.
  let loadResult: StorageRuntimeLoadResult_ACU;
  if (activeReload_ACU) {
    loadResult = await awaitStorageFlight_ACU(activeReload_ACU, options);
    activeProvider = getActiveStorageProvider();
    if (activeProvider?.mode === expectedMode && activeProvider.isReady() && runtimeHealth.status === 'ready') return activeProvider;
  } else {
    if (activeProvider?.mode === expectedMode && activeProvider.isReady() && runtimeHealth.status === 'ready') return activeProvider;
    loadResult = await awaitStorageFlight_ACU(initStorageProvider(), options);
  }
  const initializedProvider = getActiveStorageProvider();
  if (!initializedProvider || initializedProvider.mode !== expectedMode || !initializedProvider.isReady()) {
    const reason = loadResult.failureCode || runtimeHealth.failureCode || 'unknown';
    throw new Error(`[StorageStrategy] ${expectedMode} 存储运行时未就绪（${reason}），已阻止 SQL 写入。`);
  }
  return initializedProvider;
}

/**
 * 初始化存储提供者（应用启动时调用）
 * 根据当前设置创建 Provider 并执行 loadFromChat
 */
export async function initStorageProvider(options: { forceNewFlight?: boolean } = {}): Promise<StorageRuntimeLoadResult_ACU> {
  const mode = getCurrentStorageMode();
  if (!options.forceNewFlight && activeInitialization?.mode === mode) return activeInitialization.promise;

  const epoch = ++initializationEpoch_ACU;
  const promise = initializeStorageProvider_ACU(mode, epoch);
  activeInitialization = { mode, promise };
  try {
    return await promise;
  } finally {
    if (activeInitialization?.promise === promise) activeInitialization = null;
  }
}

async function initializeStorageProvider_ACU(mode: StorageMode, epoch: number): Promise<StorageRuntimeLoadResult_ACU> {
  setRuntimeHealth_ACU({ status: 'loading', expectedMode: mode, activeMode: currentProvider?.mode ?? null });
  logDebug_ACU(`[StorageStrategy] 初始化 Provider: ${mode}`);

  let result: { loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string };
  let nextProvider: ITableStorageProvider | null = null;
  try {
    nextProvider = createProvider(mode);
    result = await loadProviderForCurrentChat_ACU(nextProvider, mode);
    logDebug_ACU(`[StorageStrategy] 数据加载完成: loaded=${result.loaded}, source=${result.source}`);

    if (epoch !== initializationEpoch_ACU) {
      nextProvider.dispose();
      return { ok: false, degraded: false, source: result.source, failureCode: 'stale_load_discarded' };
    }

    // 设置在 hydrate 期间被切换时，旧候选不得覆盖新的运行时。
    if (getCurrentStorageMode() !== mode) {
      nextProvider.dispose();
      setRuntimeHealth_ACU({
        status: 'idle', expectedMode: getCurrentStorageMode(), activeMode: currentProvider?.mode ?? null,
        failureCode: 'stale_load_discarded', error: '存储模式在初始化期间发生变化，已丢弃旧候选运行时。',
      });
      return { ok: false, degraded: false, source: result.source, failureCode: 'stale_load_discarded' };
    }

    if (mode === 'sqlite') {
      const failure = evaluateProviderPublishFailure_ACU(result, nextProvider, 'provider_not_ready_after_init');
      if (failure) {
        logError_ACU(`[StorageStrategy] SQLite 加载失败，自动 fallback 到原生模式: ${failure}`);
        nextProvider.dispose();
        replaceActiveProvider_ACU(createProvider('native'));
        setRuntimeHealth_ACU({
          status: 'degraded', expectedMode: mode, activeMode: 'native', source: result.source,
          failureCode: 'provider_fallback', error: failure,
        });
        return { ok: false, degraded: true, source: result.source, failureCode: 'provider_fallback', error: failure };
      }
    }
    replaceActiveProvider_ACU(nextProvider);
    setRuntimeHealth_ACU({ status: 'ready', expectedMode: mode, activeMode: mode, source: result.source });
    return { ok: true, degraded: false, source: result.source };
  } catch (e: any) {
    const error = e?.message || String(e);
    if (epoch !== initializationEpoch_ACU) {
      nextProvider?.dispose();
      return { ok: false, degraded: false, failureCode: 'stale_load_discarded' };
    }
    logError_ACU(`[StorageStrategy] 初始化失败: ${error}`);
    if (mode === 'sqlite') {
      logError_ACU('[StorageStrategy] SQLite 初始化异常，fallback 到原生模式');
      // 未被提交为 active 的候选必须销毁：它可能已持有全局 NameMapper 发布权，
      // 不释放会让 fallback 后的映射仍归属一个不再存在的 SQLite runtime。
      nextProvider?.dispose();
      replaceActiveProvider_ACU(createProvider('native'));
      setRuntimeHealth_ACU({ status: 'degraded', expectedMode: mode, activeMode: 'native', failureCode: 'provider_fallback', error });
      return { ok: false, degraded: true, failureCode: 'provider_fallback', error };
    }
    setRuntimeHealth_ACU({ status: 'failed', expectedMode: mode, activeMode: currentProvider?.mode ?? null, failureCode: 'provider_init_failed', error });
    throw e;
  }
}

/**
 * 切换存储模式（用户在设置中切换时调用）
 * 1. 销毁旧 Provider
 * 2. 创建新 Provider
 * 3. 重新加载数据
 *
 * @param mode 目标模式
 */
export async function switchStorageMode(mode: StorageMode): Promise<void> {
  const currentMode = currentProvider?.mode;
  if (currentMode === mode) {
    logDebug_ACU(`[StorageStrategy] 已经是 ${mode} 模式，无需切换`);
    return;
  }

  logDebug_ACU(`[StorageStrategy] 切换模式: ${currentMode || 'none'} → ${mode}`);

  try {
    const nextProvider = createProvider(mode);
    const result = await loadProviderForCurrentChat_ACU(nextProvider, mode);
    logDebug_ACU(`[StorageStrategy] 切换完成: loaded=${result.loaded}, source=${result.source}`);

    if (mode === 'sqlite') {
      const failure = evaluateProviderPublishFailure_ACU(result, nextProvider, 'provider_not_ready_after_switch');
      if (failure) {
        logError_ACU(`[StorageStrategy] SQLite 切换失败，fallback 到原生模式: ${failure}`);
        nextProvider.dispose();
        replaceActiveProvider_ACU(createProvider('native'));
        throw new Error(`SQLite 模式切换失败: ${failure}。已自动回退到原生模式。`);
      }
    }
    replaceActiveProvider_ACU(nextProvider);
  } catch (e: any) {
    if (e.message?.includes('已自动回退')) throw e;

    logError_ACU(`[StorageStrategy] 切换异常: ${e?.message}`);
    if (mode === 'sqlite') {
      replaceActiveProvider_ACU(createProvider('native'));
    }
    throw e;
  }
}

/**
 * 立即销毁当前 Provider 实例，释放内存数据库资源
 * 用于换卡/换聊天时在状态重置之前立即清理旧数据库，
 * 避免 1200ms 延迟窗口内的数据不一致问题。
 *
 * 销毁后 getStorageProvider() 会触发懒初始化创建新实例。
 * 调用方应在适当时机调用 reloadStorageProvider() 重建并加载数据。
 */
export function disposeStorageProvider(): void {
  // chat 切换可能发生在候选 hydrate 未完成时；旧候选绝不能在 dispose 后重新发布。
  invalidateInFlightInitialization_ACU();
  runtimeLifecycleEpoch_ACU += 1;
  activeInitialization = null;
  activeReload_ACU = null;
  if (currentProvider) {
    logDebug_ACU(`[StorageStrategy] 销毁当前 Provider: ${currentProvider.mode}`);
    currentProvider.dispose();
    currentProvider = null;
  }
  setRuntimeHealth_ACU({ status: 'disposed', expectedMode: getCurrentStorageMode(), activeMode: null });
}

/**
 * 受控清空当前表格运行时，专用于“当前聊天级硬清空”成功后的收尾。
 *
 * 此函数只清运行时：canonical JSON、独立表状态、活跃 Native/SQLite provider 与
 * provider 持有的 NameMapper，并推进当前 scope 的 runtime revision；它绝不读取聊天、
 * 绝不解析模板/Guide、更不会通过 getStorageProvider() 懒创建新实例。
 *
 * 调用方必须已完成聊天严格保存。若保存未成功就清 runtime，会制造“内存是空、磁盘仍有
 * 数据”的假状态，因此该顺序不允许被颠倒。
 */
export function clearTableRuntimeWithoutReload_ACU(): void {
  _set_currentJsonTableData_ACU(null);
  _set_independentTableStates_ACU({});
  disposeStorageProvider();
  invalidateTableRuntimeRevision_ACU({ reason: 'database_purged' });
  logDebug_ACU('[StorageStrategy] 当前聊天表格运行时已受控清空，未触发 reload。');
}

/** 让已在锁外启动的初始化候选失去发布资格，避免其覆盖排队中的受控重载。 */
function invalidateInFlightInitialization_ACU(): void {
  initializationEpoch_ACU += 1;
}

/**
 * 重新加载数据（楼层删除、回滚等场景）
 * 不切换模式，只重新从聊天消息加载。
 *
 * 进入当前 chat/isolation 的排他维护锁，避免 hydrate 候选与并发写事务互相覆盖。
 * 持有表写事务的调用方必须在其事务释放后再调用本函数，禁止嵌套获取同一维护锁。
 */
export async function reloadStorageProvider(): Promise<StorageRuntimeLoadResult_ACU> {
  // 多个重载请求描述同一个当前 chat/isolation 的目标状态；合并它们，不能让后到请求废弃已持锁航班。
  if (activeReload_ACU) return activeReload_ACU;
  const lifecycleEpoch = runtimeLifecycleEpoch_ACU;

  // 排他锁可能需要等待已有写事务。先废弃锁外航班，禁止它在等待窗口发布并置换活跃 provider。
  invalidateInFlightInitialization_ACU();
  const promise = runTableWriteTransaction_ACU({
    source: 'system_reload',
    reason: 'reloadStorageProvider',
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
  }, async () => {
    if (lifecycleEpoch !== runtimeLifecycleEpoch_ACU) {
      return { ok: false, degraded: false, failureCode: 'stale_load_discarded' as const };
    }
    const beforeIdentity = captureRuntimeIdentity_ACU(currentProvider);
    const mode = getCurrentStorageMode();
    logDebug_ACU(`[StorageStrategy] 重新加载数据: ${mode}`);
    const result = await initStorageProvider({ forceNewFlight: true });
    const afterIdentity = captureRuntimeIdentity_ACU(currentProvider);
    if (runtimeIdentityChanged_ACU(beforeIdentity, afterIdentity)) {
      invalidateTableRuntimeRevision_ACU({ reason: 'reloadStorageProvider:data_changed' });
    } else {
      logDebug_ACU('[StorageStrategy] 重载前后运行时数据一致，不推进 RuntimeRevision。');
    }
    return result;
  });
  activeReload_ACU = promise;
  try {
    return await promise;
  } finally {
    if (activeReload_ACU === promise) activeReload_ACU = null;
  }
}

/**
 * 阶段 C：经身份复核的 canonical snapshot hydrate 窄入口。
 *
 * 与 reloadStorageProvider 的区别：不重新 replay 聊天，直接用调用链刚完成的
 * canonical snapshot（CanonicalSnapshotEnvelope_ACU）hydrate 候选 provider。
 *
 * 安全边界（计划 §3.3）：
 * - 调用开始捕获 chat/isolation/mode/lifecycle token；
 * - hydrate 前、后各校验一次 envelope 身份；仅两次校验均通过才原子发布；
 * - stale 候选立即 dispose，返回结构化 stale_load_discarded；
 * - hydrate 失败沿用现有 fallback/health 语义，不复活上一聊天 provider；
 * - 仅接受 sqlite 模式（native 不创建 SQLite provider，直接返回 ok）。
 * - envelope 不是缓存：本函数消费后立即失效，调用方不得复用同一 envelope 重复发布。
 */
export async function hydrateStorageProviderFromSnapshot_ACU(
  envelope: CanonicalSnapshotEnvelope_ACU,
): Promise<StorageRuntimeLoadResult_ACU> {
  if (!isCanonicalSnapshotEnvelope_ACU(envelope)) {
    return { ok: false, degraded: false, failureCode: 'provider_load_failed', error: '[StorageStrategy] 非法 canonical snapshot envelope。' };
  }
  const lifecycleEpoch = runtimeLifecycleEpoch_ACU;
  const mode = getCurrentStorageMode();
  const chatIdentity = String(currentChatFileIdentifier_ACU || '');
  const isolationKey = getCurrentIsolationKey_ACU();

  // 身份预检：envelope 与当前运行时目标不一致时直接丢弃，不得进入 hydrate。
  if (mode !== envelope.storageMode
    || lifecycleEpoch !== envelope.lifecycleEpoch
    || chatIdentity !== envelope.chatIdentity
    || isolationKey !== envelope.isolationKey) {
    logDebug_ACU('[StorageStrategy] snapshot hydrate 身份预检失败，丢弃候选（stale_load_discarded）。');
    return { ok: false, degraded: false, failureCode: 'stale_load_discarded' };
  }
  if (mode !== 'sqlite') {
    // native 模式不创建 SQLite provider；调用方不应在 native 下请求 hydrate。
    return { ok: true, degraded: false, source: 'merged' };
  }

  const nextProvider = createProvider('sqlite');
  try {
    const result = await nextProvider.loadFromData(envelope.data);
    const failure = evaluateProviderPublishFailure_ACU(result, nextProvider, 'provider_not_ready_after_hydrate');
    if (failure) {
      nextProvider.dispose();
      logError_ACU(`[StorageStrategy] snapshot hydrate 失败: ${failure}`);
      // 沿用现有 fallback 语义：SQLite hydrate 失败回退 native。
      replaceActiveProvider_ACU(createProvider('native'));
      setRuntimeHealth_ACU({
        status: 'degraded', expectedMode: 'sqlite', activeMode: 'native', source: result.source,
        failureCode: 'provider_fallback', error: failure,
      });
      return { ok: false, degraded: true, source: result.source, failureCode: 'provider_fallback', error: failure };
    }

    // 身份复检：hydrate 期间 chat/isolation/mode/lifecycle 变化则丢弃候选。
    if (lifecycleEpoch !== runtimeLifecycleEpoch_ACU
      || getCurrentStorageMode() !== mode
      || String(currentChatFileIdentifier_ACU || '') !== chatIdentity
      || getCurrentIsolationKey_ACU() !== isolationKey) {
      nextProvider.dispose();
      logDebug_ACU('[StorageStrategy] snapshot hydrate 复检失败（stale_load_discarded），候选已销毁。');
      return { ok: false, degraded: false, source: result.source, failureCode: 'stale_load_discarded' };
    }

    replaceActiveProvider_ACU(nextProvider);
    setRuntimeHealth_ACU({ status: 'ready', expectedMode: 'sqlite', activeMode: 'sqlite', source: result.source });
    if (result.source === 'empty') {
      // 空 schema 是正常状态，只允许 debug 级记录，不输出“失败”或 fallback ERROR。
      logDebug_ACU('[StorageStrategy] SQLite 空 schema 已就绪（normal empty snapshot），无降级。');
    }
    return { ok: true, degraded: false, source: result.source };
  } catch (error: any) {
    const message = error?.message || String(error);
    if (lifecycleEpoch !== runtimeLifecycleEpoch_ACU) {
      nextProvider.dispose();
      return { ok: false, degraded: false, failureCode: 'stale_load_discarded' };
    }
    nextProvider.dispose();
    logError_ACU(`[StorageStrategy] snapshot hydrate 异常，fallback 到原生模式: ${message}`);
    replaceActiveProvider_ACU(createProvider('native'));
    setRuntimeHealth_ACU({ status: 'degraded', expectedMode: 'sqlite', activeMode: 'native', failureCode: 'provider_fallback', error: message });
    return { ok: false, degraded: true, failureCode: 'provider_fallback', error: message };
  }
}


/**
 * 获取当前 Provider 的模式
 * 如果未初始化返回 null
 */
export function getCurrentProviderMode(): StorageMode | null {
  return currentProvider?.mode ?? null;
}

/**
 * Reports a completed SQLite reload that silently degraded to the native runtime.
 * A concurrent settings change to native is intentional and must not be reported.
 */
export function didSqliteFallbackAfterReload_ACU(expectedModeBeforeReload: StorageMode): boolean {
  return expectedModeBeforeReload === 'sqlite'
    && getCurrentStorageMode() === 'sqlite'
    && getCurrentProviderMode() === 'native';
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/** 创建不发布到活跃 runtime 的 SQLite provider，仅供 run-scoped staging 使用。 */
export function createDetachedSqlTableService_ACU(): SqlTableService {
  return new SqlTableService({ isolatedRuntime: true });
}

/** 根据模式创建 Provider 实例 */
function createProvider(mode: StorageMode): ITableStorageProvider {
  switch (mode) {
    case 'sqlite':
      return new SqlTableService();
    case 'native':
    default:
      return new NativeTableServiceAdapter();
  }
}

async function loadProviderForCurrentChat_ACU(
  provider: ITableStorageProvider,
  mode: StorageMode,
): Promise<{ loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string }> {
  if (mode !== 'sqlite') return provider.loadFromChat();

  const replay = await loadOrCreateJsonTableFromChatHistory_ACU();
  if (typeof provider.loadFromData !== 'function') {
    throw new Error('[StorageStrategy] SQLite provider 未实现 canonical snapshot hydrate。');
  }
  return provider.loadFromData(replay.data || null);
}

/**
 * 阶段 A：统一加载结果发布判定（冷初始化、模式切换、snapshot hydrate 共用）。
 *
 * 失败 = `result.error` 存在（优先保留 Provider 原始错误），或 Provider 未通过
 * `isReady()` 后置条件（生成稳定错误码，禁止发布裸/半初始化 SQLite，杜绝 `unknown`）。
 * 空状态（`loaded=false/source=empty` 且无 error）不是失败：只要 Provider ready，
 * 无论 `loaded` 为 true/false 都可以发布。
 *
 * @param notReadyCode 无 error 但 Provider not-ready 时使用的稳定错误码（区分调用路径）。
 * @returns 失败信息（非空则不得发布候选）；可发布时返回 null。
 */
function evaluateProviderPublishFailure_ACU(
  result: { loaded: boolean; source: 'merged' | 'initialized' | 'empty'; error?: string },
  provider: ITableStorageProvider,
  notReadyCode: string,
): string | null {
  if (result.error) return result.error;
  if (!provider.isReady()) return notReadyCode;
  return null;
}

function replaceActiveProvider_ACU(nextProvider: ITableStorageProvider): void {
  const previousProvider = currentProvider;
  currentProvider = nextProvider;
  previousProvider?.dispose();
}
