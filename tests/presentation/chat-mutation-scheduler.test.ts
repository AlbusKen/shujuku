// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  reload: vi.fn(),
  isSqlite: vi.fn(),
  refreshUI: vi.fn(),
  findTable: vi.fn(),
  buildScope: vi.fn(),
  markDirty: vi.fn(),
  enqueueFlush: vi.fn(),
  recoverDeleted: vi.fn(),
  latestState: null as any,
  timer: { value: null as any },
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get chatMutationDebounceTimer_ACU() { return h.timer.value; },
  _set_chatMutationDebounceTimer_ACU: (v: any) => { h.timer.value = v; },
  currentChatFileIdentifier_ACU: 'chat-1',
  getCurrentIsolationKey_ACU: () => 'iso-1',
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: h.reload,
}));
vi.mock('../../src/service/chat/checkpoint-delete-guard', () => ({
  recoverLostCheckpointsAfterMessageDeletion_ACU: h.recoverDeleted,
}));
vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: h.isSqlite,
}));
vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: h.refreshUI,
}));
vi.mock('../../src/service/vector/summary-vector-index-archive-service', () => ({
  findSummaryTable_ACU: h.findTable,
  buildSummaryVectorIndexArchiveScopeKey_ACU: h.buildScope,
}));
vi.mock('../../src/service/vector/summary-vector-index-realign-state', () => ({
  markSummaryVectorIndexDirtyForRealign_ACU: h.markDirty,
}));
vi.mock('../../src/service/vector/summary-vector-index-flush-queue', () => ({
  enqueueSummaryVectorIndexFlush_ACU: (...args: any[]) => h.enqueueFlush(...args),
}));
vi.mock('../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: () => h.latestState,
}));
vi.mock('../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: { summaryVectorIndexModeGlobal: true },
}));
vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));

import {
  scheduleChatMutationRefresh_ACU,
  cancelPendingChatMutationRefresh_ACU,
  __resetChatMutationSchedulerForTests_ACU,
} from '../../src/presentation/bootstrap/chat-mutation-scheduler';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetChatMutationSchedulerForTests_ACU();
  h.timer.value = null;
  h.isSqlite.mockReturnValue(false);
  h.reload.mockResolvedValue(undefined);
  h.refreshUI.mockResolvedValue({ ok: true });
  h.findTable.mockReturnValue({ summaryKey: 'summary-1' });
  h.buildScope.mockReturnValue('scope-1');
  h.markDirty.mockResolvedValue(undefined);
  h.enqueueFlush.mockResolvedValue({ queued: true, scopeKey: 'scope-1' });
  h.recoverDeleted.mockResolvedValue({ recovered: false, graftedCount: 0 });
  h.latestState = null;
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushAll() {
  await vi.runAllTicks();
  await vi.advanceTimersByTimeAsync(5000);
  await vi.runAllTicks();
}

describe('chat mutation scheduler', () => {
  it('连续 5 次事件在 1200ms 内只执行 1 轮', async () => {
    for (let i = 0; i < 5; i++) {
      scheduleChatMutationRefresh_ACU('chat_modified_swiped');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(h.refreshUI).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1200);
    expect(h.refreshUI).toHaveBeenCalledTimes(1);
  });

  it('每 1000ms 触发一次共 4 次，第 3000ms 处必须已强制执行', async () => {
    for (let i = 0; i < 4; i++) {
      scheduleChatMutationRefresh_ACU('chat_modified_swiped');
      await vi.advanceTimersByTimeAsync(1000);
    }
    // 第 3 次触发时（now=3000）应满足 MAX_WAIT_MS 强制立即执行
    expect(h.refreshUI).toHaveBeenCalledTimes(1);
  });

  it('执行中再次触发 → 结束后再跑 1 轮且不重叠', async () => {
    let resolveRefresh!: (v: any) => void;
    h.refreshUI.mockImplementationOnce(() => new Promise(res => { resolveRefresh = res; }));
    h.refreshUI.mockResolvedValue({ ok: true });

    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    await vi.advanceTimersByTimeAsync(1200);
    // 第一轮开始执行（refreshUI 挂起中）
    expect(h.refreshUI).toHaveBeenCalledTimes(1);

    // 执行中触发新事件
    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    // 第二轮还在排队（running 为 true，不并发）
    expect(h.refreshUI).toHaveBeenCalledTimes(1);

    resolveRefresh!({ ok: true });
    await vi.advanceTimersByTimeAsync(1300);
    // 第一轮结束后再跑第二轮
    expect(h.refreshUI).toHaveBeenCalledTimes(2);
  });

  it('refreshUI 抛错时 markDirty 仍被调用', async () => {
    h.refreshUI.mockRejectedValue(new Error('ui boom'));
    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.markDirty).toHaveBeenCalledTimes(1);
    expect(h.markDirty).toHaveBeenCalledWith('scope-1', 'chat_modified_deleted');
  });

  it('P2：已有索引时 mark dirty 后立即入队重新归档', async () => {
    h.latestState = { summaryVectorIndexState: { manifest: { indexId: 'idx' } } };
    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.markDirty).toHaveBeenCalledWith('scope-1', 'chat_modified_deleted');
    expect(h.enqueueFlush).toHaveBeenCalledWith(expect.objectContaining({ reason: 'chat_modified_deleted', mode: 'sync' }));
  });

  it('P2：尚无索引的聊天只标记 dirty，不入队（避免凭空首次建索引扣费）', async () => {
    h.latestState = null;
    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.markDirty).toHaveBeenCalledTimes(1);
    expect(h.enqueueFlush).not.toHaveBeenCalled();
  });

  it('聊天切换取消待执行调度', async () => {
    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    cancelPendingChatMutationRefresh_ACU();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.refreshUI).not.toHaveBeenCalled();
  });

  it('SQLite 模式重建内存数据库后再刷新', async () => {
    h.isSqlite.mockReturnValue(true);
    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.refreshUI).toHaveBeenCalledTimes(1);
  });

  it('S0-4：删楼轮次在冷回放之前先执行 checkpoint 前移恢复', async () => {
    h.isSqlite.mockReturnValue(true);
    const order: string[] = [];
    h.recoverDeleted.mockImplementation(async () => { order.push('recover'); return { recovered: true, graftedCount: 1 }; });
    h.reload.mockImplementation(async () => { order.push('reload'); });
    h.refreshUI.mockImplementation(async () => { order.push('refresh'); return { ok: true }; });

    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();

    expect(h.recoverDeleted).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['recover', 'reload', 'refresh']);
  });

  it('S0-4：滑动轮次不执行删楼恢复；恢复失败不阻断冷回放', async () => {
    scheduleChatMutationRefresh_ACU('chat_modified_swiped');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.recoverDeleted).not.toHaveBeenCalled();

    h.recoverDeleted.mockRejectedValueOnce(new Error('recover boom'));
    scheduleChatMutationRefresh_ACU('chat_modified_deleted');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.runAllTicks();
    expect(h.recoverDeleted).toHaveBeenCalledTimes(1);
    expect(h.refreshUI).toHaveBeenCalledTimes(2);
  });
});
