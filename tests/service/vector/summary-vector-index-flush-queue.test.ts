import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  GenerationInvalidatedError: class SummaryVectorFlushGenerationInvalidatedError_ACU extends Error {},
  chatKey: 'chat-a',
  isolationKey: 'iso-a',
  summaryKey: 'summary-a',
  task: null as any,
  upsert: vi.fn(),
  get: vi.fn(),
  getStrict: vi.fn(),
  markReadyIfGenerationMatches: vi.fn(),
  list: vi.fn(),
  reconcileLegacy: vi.fn(),
  invalidate: vi.fn(),
  remove: vi.fn(),
  removeStrict: vi.fn(),
  archive: vi.fn(),
  rebuild: vi.fn(),
  logIdentityEvent: vi.fn(),
  runScopeMutation: vi.fn(),
  retentionGc: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return h.chatKey; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  // T4：cooldown 指纹用稳定哈希，保证 flush 侧与 archive mock 的 credentialFingerprint 一致。
  hashUserInput_ACU: (text: string) => `hash:${text}`,
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  SummaryVectorFlushGenerationInvalidatedError_ACU: h.GenerationInvalidatedError,
  deleteSummaryVectorFlushTask_ACU: (...args: any[]) => h.remove(...args),
  markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU: (...args: any[]) => h.markReadyIfGenerationMatches(...args),
  deleteSummaryVectorFlushTaskStrict_ACU: (...args: any[]) => h.removeStrict(...args),
  getSummaryVectorFlushTask_ACU: (...args: any[]) => h.get(...args),
  getSummaryVectorFlushTaskStrict_ACU: (...args: any[]) => h.getStrict(...args),
  listSummaryVectorFlushTasks_ACU: (...args: any[]) => h.list(...args),
  reconcileLegacySummaryVectorFlushTaskStrict_ACU: (...args: any[]) => h.reconcileLegacy(...args),
  invalidateSummaryVectorFlushTaskStrict_ACU: (...args: any[]) => h.invalidate(...args),
  upsertSummaryVectorFlushTask_ACU: (...args: any[]) => h.upsert(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  buildSummaryVectorIndexArchiveScopeKey_ACU: (parts: any) => JSON.stringify([parts.chatKey || 'current-chat', parts.isolationKey || 'default', parts.sourceTableKey || 'summary']),
  findSummaryTable_ACU: () => h.summaryKey ? { summaryKey: h.summaryKey, table: {} } : null,
  archiveSummaryVectorIndexNow_ACU: (...args: any[]) => h.archive(...args),
  runSummaryVectorIndexArchiveScopeMutationExclusive_ACU: (...args: any[]) => h.runScopeMutation(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-writer', () => ({
  flushSummaryVectorMirrorNow_ACU: (...args: any[]) => h.archive(...args),
  findTouchedSummarySheetKey_ACU: () => h.summaryKey || null,
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-rebuild', () => ({
  rebuildSummaryVectorMirror_ACU: (...args: any[]) => h.rebuild(...args),
}));
vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: () => ({ summaryVectorIndexModeEnabled: true }),
}));
vi.mock('../../../src/service/table/manual-catch-up-provisional-bridge', () => ({
  hasActiveProvisionalBridgeAnywhere_ACU: () => false,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => [],
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  logSummaryVectorIndexIdentityEvent_ACU: (...args: any[]) => h.logIdentityEvent(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-deletion-gc', () => ({
  runScopedRetentionGcAfterFlush_ACU: (...args: any[]) => h.retentionGc(...args),
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({
    embeddingEndpoint: 'https://embedding.test',
    embeddingModel: 'test-model',
    embeddingApiKey: 'test-key',
  }),
}));

import {
  buildSummaryVectorIndexFlushScopeKey_ACU,
  clearSummaryVectorIndexCredentialCooldowns_ACU,
  clearSummaryVectorIndexFlushQueueForCurrentScope_ACU,
  enqueueSummaryVectorIndexFlush_ACU,
  flushSummaryVectorIndexTaskNow_ACU,
  restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU,
} from '../../../src/service/vector/summary-vector-index-flush-queue';
import {
  clearSummaryVectorIndexDirtyForRealign_ACU,
  isSummaryVectorIndexDirtyForRealign_ACU,
  markSummaryVectorIndexDirtyForRealign_ACU,
} from '../../../src/service/vector/summary-vector-index-realign-state';
import { hashUserInput_ACU } from '../../../src/shared/utils';

function task(scopeKey: string, overrides: any = {}) {
  return { scopeKey, chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary-a', targetMessageIndex: 3, mode: 'sync', status: 'queued', requestedAt: 1, debounceUntil: Date.now(), attemptCount: 0, updatedAt: Date.now(), ...overrides };
}

describe('summary-vector-index flush queue scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    h.chatKey = 'chat-a'; h.isolationKey = 'iso-a'; h.summaryKey = 'summary-a';
    h.get.mockImplementation(async () => h.task);
    h.getStrict.mockImplementation(async () => h.task);
    clearSummaryVectorIndexCredentialCooldowns_ACU();
    h.upsert.mockImplementation(async (input: any) => ({ ...input, attemptCount: 0, updatedAt: Date.now() }));
    h.list.mockResolvedValue([]); h.remove.mockResolvedValue(undefined); h.markReadyIfGenerationMatches.mockResolvedValue(true); h.removeStrict.mockResolvedValue(undefined);
    h.reconcileLegacy.mockResolvedValue({ outcome: 'migrated', task: null });
    h.invalidate.mockImplementation(async (input: any) => ({ ...task(input.scopeKey), ...input, status: 'invalidated', generation: 1 }));
    h.archive.mockResolvedValue({ success: true, skipped: false, errors: [] });
    h.rebuild.mockResolvedValue({
      success: true,
      skipped: false,
      indexedRowCount: 1,
      skippedRowCount: 0,
      chunkCount: 1,
      errors: [],
    });
    h.runScopeMutation.mockImplementation(async (_scopeKey: string, operation: () => Promise<any>) => operation());
    h.retentionGc.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('三元 scope 彼此独立，成功 flush 只清理自身 dirty state', async () => {
    const scopeA = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    const scopeB = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-b', 'summary-a');
    expect(scopeA).not.toBe(scopeB);
    markSummaryVectorIndexDirtyForRealign_ACU(scopeA, 'runtime_stale_rows');
    markSummaryVectorIndexDirtyForRealign_ACU(scopeB, 'runtime_stale_rows');
    h.task = task(scopeA);

    await expect(flushSummaryVectorIndexTaskNow_ACU(scopeA)).resolves.toMatchObject({ success: true });
    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({ isolationKey: 'iso-a', sourceTableKey: 'summary-a' }));
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeA)).toBe(false);
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeB)).toBe(true);
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeB);
  });

  it('scope key 对分隔符输入无碰撞，防止任务与 dirty state 串扰', () => {
    const scopeA = buildSummaryVectorIndexFlushScopeKey_ACU('a::b', 'c', 'd');
    const scopeB = buildSummaryVectorIndexFlushScopeKey_ACU('a', 'b::c', 'd');
    expect(scopeA).not.toBe(scopeB);
    markSummaryVectorIndexDirtyForRealign_ACU(scopeA, 'runtime_stale_rows');
    markSummaryVectorIndexDirtyForRealign_ACU(scopeB, 'runtime_stale_rows');
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeA);
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scopeB)).toBe(true);
    clearSummaryVectorIndexDirtyForRealign_ACU(scopeB);
  });

  it('默认空槽 legacy task 迁移到 canonical scope 后继续执行，不静默丢失 dirty state', async () => {
    h.isolationKey = '';
    h.task = task('flush::chat-a', { isolationKey: '' });
    const canonicalScope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'default', 'summary-a');
    h.reconcileLegacy.mockResolvedValueOnce({ outcome: 'migrated', task: task(canonicalScope, { isolationKey: 'default' }) });
    h.get.mockImplementation(async (scopeKey: string) => scopeKey === canonicalScope
      ? task(canonicalScope, { isolationKey: 'default' })
      : h.task);
    h.getStrict.mockImplementation(async (scopeKey: string) => scopeKey === canonicalScope ? task(canonicalScope, { isolationKey: 'default' }) : h.task);

    await expect(flushSummaryVectorIndexTaskNow_ACU('flush::chat-a')).resolves.toMatchObject({
      success: true,
    });
    expect(h.reconcileLegacy).toHaveBeenCalledWith(expect.objectContaining({
      legacyScopeKey: 'flush::chat-a',
      canonicalScopeKey: canonicalScope,
      isolationKey: 'default',
    }));
    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({ isolationKey: 'default' }));
    expect(h.logIdentityEvent).toHaveBeenCalledWith(
      'debug',
      'flush',
      'legacy_scope_migrated',
      expect.objectContaining({ scopeFingerprint: canonicalScope }),
    );
  });

  it('canonical scopeKey 但 isolation 字段为空的 legacy task 原地迁移，保留待归档状态', async () => {
    h.isolationKey = '';
    const canonicalScope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'default', 'summary-a');
    h.task = task(canonicalScope, { isolationKey: '', status: 'queued', generation: 8 });
    let readCount = 0;
    h.get.mockImplementation(async () => {
      readCount += 1;
      return readCount === 1
        ? h.task
        : task(canonicalScope, { isolationKey: 'default', status: 'queued', generation: 8 });
    });
    h.reconcileLegacy.mockResolvedValueOnce({
      outcome: 'migrated',
      task: task(canonicalScope, { isolationKey: 'default', status: 'queued', generation: 8 }),
    });
    h.getStrict.mockImplementation(async () => task(canonicalScope, { isolationKey: 'default', status: 'queued', generation: 8 }));

    await expect(flushSummaryVectorIndexTaskNow_ACU(canonicalScope)).resolves.toMatchObject({ success: true });

    expect(h.reconcileLegacy).toHaveBeenCalledWith(expect.objectContaining({
      legacyScopeKey: canonicalScope,
      canonicalScopeKey: canonicalScope,
      isolationKey: 'default',
    }));
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({ isolationKey: 'default', expectedFlushGeneration: 8 }));
  });

  it('执行时 active isolation 漂移会拒绝任务，不执行 archive', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-b', 'summary-a');
    h.task = task(scope, { isolationKey: 'iso-b' });
    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ reason: 'flush_scope_mismatch' });
    expect(h.archive).not.toHaveBeenCalled();
  });

  it('不可恢复的 flush 失败记录 terminal identity event', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({ success: false, reason: 'target_message_invalid', errors: ['target invalid'] });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'target_message_invalid',
    });

    expect(h.logIdentityEvent).toHaveBeenCalledWith(
      'warn',
      'flush',
      'failed_terminal',
      expect.objectContaining({ scopeFingerprint: scope, error: 'target invalid' }),
    );
  });

  it('即时重建前持久化当前 scope 的失效墓碑，后续 restore 不会重复调度', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.list.mockResolvedValue([]);

    await expect(clearSummaryVectorIndexFlushQueueForCurrentScope_ACU({
      isolationKey: 'iso-a',
      sourceTableKey: 'summary-a',
    })).resolves.toBe(1);

    expect(h.invalidate).toHaveBeenCalledWith({ scopeKey: scope, chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
    await expect(restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU()).resolves.toBe(0);
  });

  it('archive 返回 generation 取消结果时不标记 retryable failure', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({ success: false, skipped: true, reason: 'flush_scope_invalidated', errors: [] });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ success: true, skipped: true, reason: 'flush_scope_invalidated' });
    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({ expectedFlushScopeKey: scope, expectedFlushGeneration: 0 }));
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it('默认 isolation 只失效 canonical default scope，并将 task 字段写为 default', async () => {
    const defaultScope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', '', 'summary-a');
    await clearSummaryVectorIndexFlushQueueForCurrentScope_ACU({ isolationKey: '', sourceTableKey: 'summary-a' });

    expect(h.invalidate).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: defaultScope, isolationKey: 'default' }));
    expect(h.list).not.toHaveBeenCalled();
    expect(h.removeStrict).not.toHaveBeenCalled();
  });

  it('恢复只查询当前 active 三元 scope', async () => {
    await expect(restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU()).resolves.toBe(0);
    expect(h.list).toHaveBeenCalledWith({ chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
  });

  it('restore 遇到 legacy 空槽与 canonical task 并存时按裁决结果只调度一个 canonical task', async () => {
    h.isolationKey = '';
    const canonicalScope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'default', 'summary-a');
    const legacyTask = task('flush::chat-a', { isolationKey: '', generation: 4 });
    const canonicalTask = task(canonicalScope, { isolationKey: 'default', generation: 5 });
    h.list.mockResolvedValue([legacyTask, canonicalTask]);
    h.reconcileLegacy.mockResolvedValueOnce({ outcome: 'canonical_retained', task: canonicalTask });

    await expect(restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU()).resolves.toBe(1);

    expect(h.reconcileLegacy).toHaveBeenCalledWith(expect.objectContaining({
      legacyScopeKey: 'flush::chat-a', canonicalScopeKey: canonicalScope,
    }));
    expect(h.archive).not.toHaveBeenCalled();
  });

  it('双 flushing legacy/canonical 冲突进入 quarantine，不执行任一 archive', async () => {
    h.isolationKey = '';
    const canonicalScope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'default', 'summary-a');
    h.task = task('flush::chat-a', { isolationKey: '', status: 'flushing' });
    h.reconcileLegacy.mockResolvedValueOnce({ outcome: 'quarantined', task: task(canonicalScope, { isolationKey: 'default', status: 'failed_terminal' }) });

    await expect(flushSummaryVectorIndexTaskNow_ACU('flush::chat-a')).resolves.toMatchObject({ reason: 'flush_legacy_scope_quarantined' });
    expect(h.archive).not.toHaveBeenCalled();
  });

  it('新 enqueue 仅以更高 generation 替换墓碑，不能复活旧 runner', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.getStrict.mockResolvedValue(task(scope, { status: 'invalidated', generation: 4 }));
    h.upsert.mockImplementation(async (input: any) => ({ ...task(scope), ...input, generation: input.generation, status: 'queued' }));

    await expect(enqueueSummaryVectorIndexFlush_ACU({ debounceMs: 100, isolationKey: 'iso-a', sourceTableKey: 'summary-a' }))
      .resolves.toMatchObject({ queued: true, scopeKey: scope });

    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: scope, generation: 5, status: 'queued' }));
  });

  it('旧 runner 已进入 flushing 时新 enqueue 使用下一 generation，避免共享收尾归属', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.getStrict.mockResolvedValue(task(scope, { status: 'flushing', generation: 4 }));
    h.upsert.mockImplementation(async (input: any) => ({ ...task(scope), ...input, generation: input.generation, status: 'queued' }));

    await expect(enqueueSummaryVectorIndexFlush_ACU({ debounceMs: 100, isolationKey: 'iso-a', sourceTableKey: 'summary-a' }))
      .resolves.toMatchObject({ queued: true, scopeKey: scope });

    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: scope, generation: 5, status: 'queued' }));
  });

  it('真实 timer 触发后在 archive 发布前校验捕获的 generation', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope, { generation: 0, debounceUntil: Date.now() + 100 });
    h.upsert.mockImplementation(async (input: any) => {
      h.task = { ...h.task, ...input, generation: input.generation ?? h.task?.generation ?? 0, attemptCount: 0, updatedAt: Date.now() };
      return h.task;
    });
    h.get.mockImplementation(async () => h.task);

    await enqueueSummaryVectorIndexFlush_ACU({ debounceMs: 100, isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
    await vi.advanceTimersByTimeAsync(100);

    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({
      expectedFlushScopeKey: scope,
      expectedFlushGeneration: 0,
    }));
    expect(h.markReadyIfGenerationMatches).toHaveBeenCalledWith(scope, 0);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('旧 runner 成功收尾不会覆盖新 generation 的任务或墓碑', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope, { generation: 0 });
    h.archive.mockResolvedValueOnce({ success: true, skipped: false, errors: [] });
    h.markReadyIfGenerationMatches.mockResolvedValueOnce(false);

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ success: true });
    expect(h.markReadyIfGenerationMatches).toHaveBeenCalledWith(scope, 0);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('新 generation timer 在旧 runner 期间命中 running 时，旧 runner 结束后会接力重调度', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    const oldTask = task(scope, { generation: 0, status: 'queued' });
    const nextTask = task(scope, { generation: 1, status: 'queued', debounceUntil: Date.now() });
    h.task = oldTask;
    let releaseOldArchive!: () => void;
    h.archive
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseOldArchive = resolve; }))
      .mockResolvedValueOnce({ success: true, skipped: false, errors: [] });
    h.getStrict.mockImplementation(async () => h.task);
    h.upsert.mockImplementation(async (input: any) => {
      if (input.status === 'queued' && input.generation === 1) h.task = { ...nextTask, ...input };
      else if (input.status === 'flushing' && input.generation === 0) h.task = { ...oldTask, ...input };
      return { ...h.task, ...input, attemptCount: 0, updatedAt: Date.now() };
    });
    h.markReadyIfGenerationMatches
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const oldRunner = flushSummaryVectorIndexTaskNow_ACU(scope);
    for (let attempt = 0; attempt < 10 && !releaseOldArchive; attempt += 1) await Promise.resolve();
    expect(releaseOldArchive).toBeTypeOf('function');

    await enqueueSummaryVectorIndexFlush_ACU({ debounceMs: 0, isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.archive).toHaveBeenCalledTimes(1);

    releaseOldArchive();
    await oldRunner;
    await vi.advanceTimersByTimeAsync(0);

    expect(h.archive).toHaveBeenCalledTimes(2);
    expect(h.archive.mock.calls[1][0]).toMatchObject({ expectedFlushScopeKey: scope, expectedFlushGeneration: 1 });
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scope)).toBe(false);
  });

  it('timer 已触发后会把捕获 generation 传入 archive 的发布前校验', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope, { generation: 0, debounceUntil: Date.now() + 100 });
    h.upsert.mockImplementation(async (input: any) => ({ ...h.task, ...input, generation: 0 }));
    await enqueueSummaryVectorIndexFlush_ACU({ debounceMs: 100, isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
    await vi.advanceTimersByTimeAsync(100);
    await clearSummaryVectorIndexFlushQueueForCurrentScope_ACU({ isolationKey: 'iso-a', sourceTableKey: 'summary-a' });
    expect(h.archive).toHaveBeenCalledWith(expect.objectContaining({ expectedFlushScopeKey: scope, expectedFlushGeneration: 0 }));
  });

  it('T0c：路径超长（retryability=terminal）时 flush task 置 failed_terminal，restore 不重挂定时器', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      indexedRowCount: 0,
      skippedRowCount: 0,
      chunkCount: 0,
      errors: ['V2 快照对象路径超长: length=247, max=240'],
      reason: 'vector_index_path_too_long',
      retryability: 'terminal',
    });
    const capturedUpserts: any[] = [];
    h.upsert.mockImplementation(async (input: any) => {
      capturedUpserts.push(input);
      return { ...input, attemptCount: 0, updatedAt: Date.now() };
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'vector_index_path_too_long',
    });

    expect(capturedUpserts.at(-1)).toMatchObject({ scopeKey: scope, status: 'failed_terminal' });
    expect(h.logIdentityEvent).toHaveBeenCalledWith(
      'warn',
      'flush',
      'failed_terminal',
      expect.objectContaining({ scopeFingerprint: scope }),
    );
    // 已 failed_terminal 的 task 在 restore 时不会重挂定时器
    h.list.mockResolvedValue([capturedUpserts.at(-1)]);
    await expect(restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU()).resolves.toBe(0);
  });

  it('T4：credential 403（retryability=terminal + credentialFingerprint）→ failed_terminal，restore 不重挂，且同凭据 cooldown 拦截后续 scope', async () => {
    const scopeA = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scopeA);
    const fingerprint = hashUserInput_ACU('https://embedding.test|test-model|test-key');
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      indexedRowCount: 0,
      skippedRowCount: 0,
      chunkCount: 0,
      errors: ['Embedding 请求失败（credential, HTTP 403）: insufficient balance'],
      reason: 'embedding_request_failed',
      retryability: 'terminal',
      credentialFingerprint: fingerprint,
    });
    const capturedUpserts: any[] = [];
    h.upsert.mockImplementation(async (input: any) => {
      capturedUpserts.push(input);
      return { ...input, attemptCount: 0, updatedAt: Date.now() };
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scopeA)).resolves.toMatchObject({
      success: false,
      reason: 'embedding_request_failed',
    });

    expect(capturedUpserts.at(-1)).toMatchObject({ scopeKey: scopeA, status: 'failed_terminal' });
    expect(h.logIdentityEvent).toHaveBeenCalledWith(
      'warn', 'flush', 'credential_cooldown_armed',
      expect.objectContaining({ scopeFingerprint: 'credential-fingerprint' }),
    );
    // 同凭据但不同 scope：cooldown 生效，不再发起 archive（避免重复扣费）。
    // 切到另一个聊天（chat-b）：其 scope 独立，但同凭据 cooldown 拦截。
    h.chatKey = 'chat-b';
    const scopeB = buildSummaryVectorIndexFlushScopeKey_ACU('chat-b', 'iso-a', 'summary-a');
    h.task = task(scopeB, { chatKey: 'chat-b' });
    h.archive.mockClear();
    const cooldownUpserts: any[] = [];
    h.upsert.mockImplementation(async (input: any) => {
      cooldownUpserts.push(input);
      return { ...input, attemptCount: 0, updatedAt: Date.now() };
    });
    await expect(flushSummaryVectorIndexTaskNow_ACU(scopeB)).resolves.toMatchObject({
      success: false,
      reason: 'credential_cooldown',
    });
    expect(h.archive).not.toHaveBeenCalled();
    expect(cooldownUpserts.at(-1)).toMatchObject({ scopeKey: scopeB, status: 'failed_terminal' });
  });

  it('P1：claim 后 retryable 失败自动重排定时器，到期后重新执行 flush', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    const capturedUpserts: any[] = [];
    // 模拟 hot-cache 层语义：claim（status→flushing）时 attemptCount 自增，
    // 其余 upsert 保留 attemptCount 并同步 h.task 供下一次 get 读取。
    h.upsert.mockImplementation(async (input: any) => {
      const previousAttempts = Number(h.task?.attemptCount) || 0;
      const next = {
        ...h.task,
        ...input,
        attemptCount: input.status === 'flushing' ? previousAttempts + 1 : previousAttempts,
        updatedAt: Date.now(),
      };
      capturedUpserts.push(next);
      h.task = next;
      return next;
    });
    h.archive
      .mockResolvedValueOnce({ success: false, skipped: false, reason: 'embedding_request_failed', retryability: 'retryable', errors: ['HTTP 500'] })
      .mockResolvedValueOnce({ success: true, skipped: false, errors: [] });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'embedding_request_failed',
    });
    const failureRecord = capturedUpserts.find((record) => record.status === 'failed_retryable');
    expect(failureRecord).toBeTruthy();
    // attemptCount=1 → 退避 2.5s；定时器到期后自动重试并成功。
    expect(h.archive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.archive).toHaveBeenCalledTimes(2);
    expect(h.markReadyIfGenerationMatches).toHaveBeenCalled();
  });

  it('P1：attemptCount 达上限的 retryable 失败升级为 failed_terminal，不再重排', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope, { attemptCount: 4 });
    const capturedUpserts: any[] = [];
    h.upsert.mockImplementation(async (input: any) => {
      const previousAttempts = Number(h.task?.attemptCount) || 0;
      const next = {
        ...h.task,
        ...input,
        attemptCount: input.status === 'flushing' ? previousAttempts + 1 : previousAttempts,
        updatedAt: Date.now(),
      };
      capturedUpserts.push(next);
      h.task = next;
      return next;
    });
    h.archive.mockResolvedValue({ success: false, skipped: false, reason: 'embedding_request_failed', retryability: 'retryable', errors: ['HTTP 500'] });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ success: false });
    const finalRecord = capturedUpserts.at(-1);
    expect(finalRecord).toMatchObject({ status: 'failed_terminal' });
    expect(String(finalRecord.lastError || '')).toContain('自动重试上限');
    // failed_terminal 不重排：推进任意时间不再触发 archive。
    expect(h.archive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.archive).toHaveBeenCalledTimes(1);
  });

  it('P1：claim 前失败（上下文不匹配）不自动重排，避免无 attemptCount 上限的循环', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.chatKey = 'chat-b';
    h.task = task(scope);

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ reason: 'flush_scope_mismatch' });
    expect(h.archive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.archive).not.toHaveBeenCalled();
  });

  it('no_mirror 时自动 initial 重建，填表后首轮归档不再 blocked', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    markSummaryVectorIndexDirtyForRealign_ACU(scope, 'runtime_stale_rows');
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'no_mirror',
      errors: ['向量镜像需要重建：no_mirror'],
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: true,
      reason: 'initial',
    });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'initial' });
    expect(h.markReadyIfGenerationMatches).toHaveBeenCalledWith(scope, 0);
    expect(isSummaryVectorIndexDirtyForRealign_ACU(scope)).toBe(false);
    expect(h.upsert.mock.calls.some((call: any[]) => call[0]?.status === 'blocked_needs_rebuild')).toBe(false);
    expect(h.retentionGc).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'iso-a',
      sourceTableKey: 'summary-a',
    }));
  });

  it('chain_conflict 时自动 rebuild_repair，不弹确认', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'chain_conflict',
      errors: ['向量镜像链冲突，需要自动修复重建。'],
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: true,
      reason: 'rebuild_repair',
    });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'rebuild_repair' });
    expect(h.markReadyIfGenerationMatches).toHaveBeenCalledWith(scope, 0);
  });

  it('embedding_identity_changed 仍 blocked，不自动重建', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'embedding_identity_changed',
      errors: ['向量镜像需要重建：embedding_identity_changed'],
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'embedding_identity_changed',
    });
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      scopeKey: scope,
      status: 'blocked_needs_rebuild',
    }));
    expect(h.markReadyIfGenerationMatches).not.toHaveBeenCalled();
  });

  it('source_table_changed 仍 blocked，不自动重建', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'source_table_changed',
      errors: ['向量镜像需要重建：source_table_changed'],
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'source_table_changed',
    });
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'blocked_needs_rebuild',
    }));
  });

  it('checkpoint_mismatch 与 manifest_unavailable 走 rebuild_repair', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'checkpoint_mismatch',
      errors: ['向量镜像需要重建：checkpoint_mismatch'],
    });
    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: true,
      reason: 'rebuild_repair',
    });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'rebuild_repair' });

    h.rebuild.mockClear();
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'manifest_unavailable',
      errors: ['向量镜像需要重建：manifest_unavailable'],
    });
    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: true,
      reason: 'rebuild_repair',
    });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'rebuild_repair' });
  });

  it('自动重建失败按配置类原因记 terminal，不标 ready', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      needsRebuild: true,
      reason: 'no_mirror',
      errors: ['向量镜像需要重建：no_mirror'],
    });
    h.rebuild.mockResolvedValueOnce({
      success: false,
      skipped: false,
      indexedRowCount: 0,
      skippedRowCount: 0,
      chunkCount: 0,
      reason: 'summary_vector_index_config_invalid',
      errors: ['embedding endpoint 无效'],
    });

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({
      success: false,
      reason: 'summary_vector_index_config_invalid',
    });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'initial' });
    expect(h.markReadyIfGenerationMatches).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed_terminal',
      lastError: 'embedding endpoint 无效',
    }));
  });

  it('P7：flush 成功后触发按 scope 的 retention GC', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);

    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ success: true });
    expect(h.retentionGc).toHaveBeenCalledWith(expect.objectContaining({
      chatKey: 'chat-a',
      isolationKey: 'iso-a',
      sourceTableKey: 'summary-a',
    }));
  });

  it('T4：手动重建成功清除 cooldown 后，同凭据后续 flush 恢复正常', async () => {
    const scope = buildSummaryVectorIndexFlushScopeKey_ACU('chat-a', 'iso-a', 'summary-a');
    h.task = task(scope);
    const fingerprint = hashUserInput_ACU('https://embedding.test|test-model|test-key');
    h.archive.mockResolvedValueOnce({
      success: false,
      skipped: false,
      indexedRowCount: 0,
      skippedRowCount: 0,
      chunkCount: 0,
      errors: ['Embedding 请求失败（credential, HTTP 401）: bad key'],
      reason: 'embedding_request_failed',
      retryability: 'terminal',
      credentialFingerprint: fingerprint,
    });
    h.upsert.mockImplementation(async (input: any) => ({ ...input, attemptCount: 0, updatedAt: Date.now() }));
    await flushSummaryVectorIndexTaskNow_ACU(scope);

    // 手动重建成功（rebuild-service 调用 clearSummaryVectorIndexCredentialCooldowns_ACU）。
    clearSummaryVectorIndexCredentialCooldowns_ACU();

    // 同凭据重新 flush：cooldown 已清除，archive 正常执行。
    h.archive.mockClear();
    h.archive.mockResolvedValueOnce({ success: true, skipped: false, errors: [] });
    h.task = task(scope);
    await expect(flushSummaryVectorIndexTaskNow_ACU(scope)).resolves.toMatchObject({ success: true });
    expect(h.archive).toHaveBeenCalledTimes(1);
  });

});
