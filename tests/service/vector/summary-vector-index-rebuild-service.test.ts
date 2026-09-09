import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  data: { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } } as any,
  isolationKey: '',
  chat: [] as any[],
  worldbook: { summaryVectorIndexModeEnabled: true, summaryVectorMirrorEnabled: true } as any,
  hasMirror: false,
  load: vi.fn(),
  rebuild: vi.fn(),
  snapshot: vi.fn(),
  publish: vi.fn(),
  updateLorebook: vi.fn(),
  clearCooldown: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.data; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
}));
vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: () => h.worldbook,
}));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));
vi.mock('../../../src/service/table/table-service', () => ({ loadOrCreateJsonTableFromChatHistory_ACU: h.load }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ updateReadableLorebookEntry_ACU: h.updateLorebook }));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  clearSummaryVectorIndexCredentialCooldowns_ACU: h.clearCooldown,
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-rebuild', () => ({
  rebuildSummaryVectorMirror_ACU: (...args: any[]) => h.rebuild(...args),
  snapshotSummaryVectorMirrorExcludingRows_ACU: (...args: any[]) => h.snapshot(...args),
  publishSummaryVectorMirrorRowRemovalSnapshot_ACU: (...args: any[]) => h.publish(...args),
  currentEnvironmentHasSummaryVectorMirror_ACU: () => h.hasMirror,
}));

import {
  ensureSummaryVectorMirrorAfterTableFill_ACU,
  publishSummaryVectorMirrorRowRemovalSnapshotNow_ACU,
  rebuildCurrentSummaryVectorIndexNow_ACU,
  snapshotSummaryVectorMirrorExcludingRowsNow_ACU,
} from '../../../src/service/vector/summary-vector-index-rebuild-service';

describe('rebuildCurrentSummaryVectorIndexNow_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.data = { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } };
    h.isolationKey = '';
    h.chat = [];
    h.worldbook = { summaryVectorIndexModeEnabled: true, summaryVectorMirrorEnabled: true };
    h.hasMirror = false;
    h.rebuild.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 1, skippedRowCount: 0, chunkCount: 1, errors: [] });
    h.updateLorebook.mockResolvedValue(true);
  });

  it('委托镜像重建并在成功后清 cooldown、刷新世界书', async () => {
    const result = await rebuildCurrentSummaryVectorIndexNow_ACU();
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'rebuild_user' });
    expect(h.clearCooldown).toHaveBeenCalled();
    expect(h.updateLorebook).toHaveBeenCalledWith(true);
    expect(result).toMatchObject({ success: true, skipped: false, indexedRowCount: 1 });
  });

  it('可指定 initial / rebuild_repair', async () => {
    await rebuildCurrentSummaryVectorIndexNow_ACU({ reason: 'initial' });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'initial' });
    h.rebuild.mockClear();
    await rebuildCurrentSummaryVectorIndexNow_ACU({ reason: 'rebuild_repair' });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'rebuild_repair' });
  });

  it('数据库未加载时先尝试载入，仍无数据则抛错', async () => {
    h.data = null;
    await expect(rebuildCurrentSummaryVectorIndexNow_ACU()).rejects.toThrow('数据库未加载');
    expect(h.load).toHaveBeenCalled();
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('镜像跳过或失败时不刷新世界书', async () => {
    h.rebuild.mockResolvedValue({ success: false, skipped: false, indexedRowCount: 0, skippedRowCount: 0, chunkCount: 0, reason: 'unsupported_replay_base', errors: ['表格基底不是 full checkpoint。'] });
    const result = await rebuildCurrentSummaryVectorIndexNow_ACU();
    expect(result.success).toBe(false);
    expect(h.clearCooldown).not.toHaveBeenCalled();
    expect(h.updateLorebook).not.toHaveBeenCalled();
  });
});

describe('snapshot / publish remaining rows after refill clear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.snapshot.mockResolvedValue({ kind: 'ready', sourceTableKey: 'sheet_summary', rows: [], packRefs: [] });
    h.publish.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 1, skippedRowCount: 0, chunkCount: 1, errors: [] });
    h.updateLorebook.mockResolvedValue(true);
  });

  it('snapshot 直接委托给镜像层', async () => {
    await snapshotSummaryVectorMirrorExcludingRowsNow_ACU({ excludedRowIds: ['1', '2'], sourceTableKey: 'sheet_summary' });
    expect(h.snapshot).toHaveBeenCalledWith({ excludedRowIds: ['1', '2'], sourceTableKey: 'sheet_summary' });
  });

  it('publish 成功后清 cooldown 并刷新世界书', async () => {
    const snapshot = {
      kind: 'ready' as const,
      sourceTableKey: 'sheet_summary',
      rows: [],
      packRefs: [],
      embedding: { endpointFingerprint: 'ep', model: 'm', dimension: 4, sourceTextVersion: 2 },
    };
    const result = await publishSummaryVectorMirrorRowRemovalSnapshotNow_ACU(snapshot);
    expect(h.publish).toHaveBeenCalledWith(snapshot);
    expect(h.clearCooldown).toHaveBeenCalled();
    expect(h.updateLorebook).toHaveBeenCalledWith(true);
    expect(result.success).toBe(true);
  });

  it('publish 跳过时不刷新世界书', async () => {
    h.publish.mockResolvedValue({ success: true, skipped: true, indexedRowCount: 0, skippedRowCount: 0, chunkCount: 0, errors: [], reason: 'no_mirror' });
    await publishSummaryVectorMirrorRowRemovalSnapshotNow_ACU({ kind: 'none' });
    expect(h.clearCooldown).not.toHaveBeenCalled();
    expect(h.updateLorebook).not.toHaveBeenCalled();
  });
});

describe('ensureSummaryVectorMirrorAfterTableFill_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.data = { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } };
    h.isolationKey = '';
    h.chat = [];
    h.worldbook = { summaryVectorIndexModeEnabled: true, summaryVectorMirrorEnabled: true };
    h.hasMirror = false;
    h.rebuild.mockResolvedValue({ success: true, skipped: false, indexedRowCount: 1, skippedRowCount: 0, chunkCount: 1, errors: [] });
    h.updateLorebook.mockResolvedValue(true);
  });

  it('功能未开启时不重建', async () => {
    h.worldbook.summaryVectorIndexModeEnabled = false;
    await expect(ensureSummaryVectorMirrorAfterTableFill_ACU()).resolves.toMatchObject({
      attempted: false,
      skipped: true,
      reason: 'feature_disabled',
    });
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('镜像开关显式关闭时不重建', async () => {
    h.worldbook.summaryVectorMirrorEnabled = false;
    await expect(ensureSummaryVectorMirrorAfterTableFill_ACU()).resolves.toMatchObject({
      attempted: false,
      skipped: true,
      reason: 'mirror_disabled',
    });
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('当前环境已有向量镜像时不重建', async () => {
    h.hasMirror = true;
    await expect(ensureSummaryVectorMirrorAfterTableFill_ACU()).resolves.toMatchObject({
      attempted: false,
      skipped: true,
      reason: 'vector_data_present',
    });
    expect(h.rebuild).not.toHaveBeenCalled();
  });

  it('功能开启且当前环境无向量数据时立刻 initial 重建', async () => {
    await expect(ensureSummaryVectorMirrorAfterTableFill_ACU()).resolves.toMatchObject({
      attempted: true,
      skipped: false,
      reason: 'initial',
    });
    expect(h.rebuild).toHaveBeenCalledWith({ reason: 'initial' });
    expect(h.clearCooldown).toHaveBeenCalled();
  });

  it('rebuild 失败只返回结果，不抛给填表主流程', async () => {
    h.rebuild.mockResolvedValue({
      success: false,
      skipped: false,
      indexedRowCount: 0,
      skippedRowCount: 0,
      chunkCount: 0,
      reason: 'unsupported_replay_base',
      errors: ['表格基底不是 full checkpoint。'],
    });
    await expect(ensureSummaryVectorMirrorAfterTableFill_ACU()).resolves.toMatchObject({
      attempted: true,
      skipped: false,
      reason: 'unsupported_replay_base',
    });
  });

  it('rebuild 抛错时返回 rebuild_exception，不抛出', async () => {
    h.data = null;
    await expect(ensureSummaryVectorMirrorAfterTableFill_ACU()).resolves.toMatchObject({
      attempted: true,
      skipped: false,
      reason: 'rebuild_exception',
    });
  });
});
