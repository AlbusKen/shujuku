// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  process: vi.fn(),
  rebuild: vi.fn(),
  toast: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  snapshot: null as any,
  outdated: false,
  configValid: true,
  globalMeta: { summaryVectorIndexModeGlobal: true } as any,
}));

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

vi.mock('../../../src/shared/host-api', () => ({ toastr_API_ACU: { clear: h.clear } }));
vi.mock('../../../src/shared/constants', () => ({ ACU_TOAST_CATEGORY_ACU: { PLANNING: 'planning', PLAN_OK: 'plan_ok' } }));
vi.mock('../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn() }));
vi.mock('../../../src/service/vector/summary-vector-index-runtime', () => ({
  processSummaryVectorIndexBeforeGeneration_ACU: h.process,
}));
vi.mock('../../../src/service/vector/summary-vector-index-rebuild-service', () => ({
  rebuildCurrentSummaryVectorIndexNow_ACU: h.rebuild,
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  isSummaryVectorIndexSourceTextOutdated_ACU: () => h.outdated,
}));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({
  getLatestSummaryVectorIndexSnapshotState_ACU: () => h.snapshot,
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: h.configValid, errors: h.configValid ? [] : ['缺少 embeddingEndpoint'] }),
}));
vi.mock('../../../src/data/repositories/profile-repo', () => ({
  get globalMeta_ACU() { return h.globalMeta; },
}));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: h.toast }));

import {
  processSummaryVectorIndexBeforeGenerationWithUI_ACU,
  rebuildOutdatedSummaryVectorIndexInBackground_ACU,
} from '../../../src/presentation/components/summary-vector-index-ui';

describe('summary vector index UI recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.toast.mockReturnValue({ closest: () => ({ remove: h.remove }) });
    h.process.mockResolvedValue({ success: false, skipped: true, reason: 'external_vector_files_missing_rebuild_required' });
    h.rebuild.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 6, chunkCount: 3, errors: [] });
  });

  it('失效指针删除后弹出进度提示并走立即构建的普通重建入口', async () => {
    await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.rebuild).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith('info', '正在重建交火索引快照...', expect.objectContaining({ timeOut: 0 }));
    expect(h.toast).toHaveBeenCalledWith('success', '交火索引快照重建完成：6 行，3 个 chunks。', expect.any(Object));
    expect(h.clear).toHaveBeenCalledTimes(2);
    expect(h.remove).toHaveBeenCalledTimes(2);
  });

  it('重建进行中保留进度提示，失败后清理提示且不阻断原始生成', async () => {
    const pending = deferred<any>();
    h.rebuild.mockReturnValue(pending.promise);

    const operation = processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });
    await Promise.resolve();
    await Promise.resolve();

    expect(h.rebuild).toHaveBeenCalledTimes(1);
    expect(h.clear).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledTimes(1);

    pending.reject(new Error('rebuild failed'));
    await expect(operation).resolves.toMatchObject({ reason: 'external_vector_files_missing_rebuild_required' });
    expect(h.toast).toHaveBeenCalledWith('error', '交火索引快照重建失败：rebuild failed');
    expect(h.clear).toHaveBeenCalledTimes(2);
    expect(h.remove).toHaveBeenCalledTimes(2);
  });


  it('身份无效快照已安全删除时同样触发一次普通重建', async () => {
    h.process.mockResolvedValue({ success: false, skipped: true, reason: 'external_vector_identity_invalid_rebuild_required' });

    await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.rebuild).toHaveBeenCalledTimes(1);
  });

  it('缓存预热返回身份无效重建原因时识别为立即构建入口', async () => {
    h.process.mockResolvedValue({ success: false, skipped: true, reason: 'external_files_identity_invalid_rebuild_required' });

    await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.rebuild).toHaveBeenCalledTimes(1);
  });

  it('运行时发现实时纪要表漂移时走立即构建普通重建入口', async () => {
    h.process.mockResolvedValue({ success: false, skipped: true, reason: 'runtime_stale_rows_rebuild_required' });

    await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.rebuild).toHaveBeenCalledTimes(1);
  });

  it('普通跳过原因不触发重建', async () => {
    h.process.mockResolvedValue({ success: false, skipped: true, reason: 'below_min_rows' });

    await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('自愈重建成功后在同一次发送里绕过去重补跑一次召回，并返回补跑结果', async () => {
    h.process
      .mockResolvedValueOnce({ success: false, skipped: true, reason: 'runtime_stale_rows_rebuild_required' })
      .mockResolvedValueOnce({ success: true, injectedCount: 42, keywordCount: 3 });

    const result = await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.rebuild).toHaveBeenCalledTimes(1);
    expect(h.process).toHaveBeenCalledTimes(2);
    expect(h.process.mock.calls[1][0]).toMatchObject({ userInput: '继续', source: 'test', bypassDedupe: true });
    expect(result).toMatchObject({ success: true, injectedCount: 42 });
    expect(h.toast).toHaveBeenCalledWith('success', expect.stringContaining('已重建并完成召回'), '交火召回完成', expect.any(Object));
  });

  it('自愈重建失败或被跳过时不补跑召回，沿用首轮结果', async () => {
    h.process.mockResolvedValue({ success: false, skipped: true, reason: 'runtime_stale_rows_rebuild_required' });
    h.rebuild.mockResolvedValue({ success: true, skipped: true, indexedRowCount: 0, chunkCount: 0, errors: [] });

    const result = await processSummaryVectorIndexBeforeGenerationWithUI_ACU({ userInput: '继续', source: 'test' });

    expect(h.process).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ reason: 'runtime_stale_rows_rebuild_required' });
  });
});

describe('rebuildOutdatedSummaryVectorIndexInBackground_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.toast.mockReturnValue({ closest: () => ({ remove: h.remove }) });
    h.rebuild.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 120, chunkCount: 120, errors: [] });
    h.globalMeta = { summaryVectorIndexModeGlobal: true };
    h.configValid = true;
    h.outdated = true;
    h.snapshot = {
      summaryVectorIndexState: {
        rows: [{ rowKey: 'r1', status: 'active' }, { rowKey: 'r2', status: 'active' }, { rowKey: 'r3', status: 'removed' }],
        manifest: { status: 'ready', indexId: 'idx' },
      },
      layers: [],
    };
  });

  it('索引仍是旧源文本格式时触发后台重建并提示', async () => {
    const triggered = await rebuildOutdatedSummaryVectorIndexInBackground_ACU();

    expect(triggered).toBe(true);
    expect(h.rebuild).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith('info', expect.stringContaining('概览 + 纪要正文'), expect.any(Object));
    expect(h.toast.mock.calls[0][1]).toContain('（2 行）');
    expect(h.toast).toHaveBeenCalledWith('success', expect.stringContaining('120 行'), '交火索引升级完成', expect.any(Object));
  });

  it('索引已是新格式时不重建', async () => {
    h.outdated = false;

    expect(await rebuildOutdatedSummaryVectorIndexInBackground_ACU()).toBe(false);
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('交火全局开关关闭或无索引时不重建', async () => {
    h.globalMeta = { summaryVectorIndexModeGlobal: false };
    expect(await rebuildOutdatedSummaryVectorIndexInBackground_ACU()).toBe(false);

    h.globalMeta = { summaryVectorIndexModeGlobal: true };
    h.snapshot = null;
    expect(await rebuildOutdatedSummaryVectorIndexInBackground_ACU()).toBe(false);
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('向量配置无效时不盲目重建（发送时仍有自愈兜底）', async () => {
    h.configValid = false;

    expect(await rebuildOutdatedSummaryVectorIndexInBackground_ACU()).toBe(false);
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('重建抛错时吞掉异常并返回已触发，避免打断 CHAT_CHANGED', async () => {
    h.rebuild.mockRejectedValue(new Error('embedding down'));

    await expect(rebuildOutdatedSummaryVectorIndexInBackground_ACU()).resolves.toBe(true);
  });
});
