import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  data: { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } } as any,
  load: vi.fn(),
  rebuild: vi.fn(),
  updateLorebook: vi.fn(),
  clearCooldown: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.data; },
}));
vi.mock('../../../src/service/table/table-service', () => ({ loadOrCreateJsonTableFromChatHistory_ACU: h.load }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ updateReadableLorebookEntry_ACU: h.updateLorebook }));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  clearSummaryVectorIndexCredentialCooldowns_ACU: h.clearCooldown,
}));
vi.mock('../../../src/service/vector/summary-vector-mirror-rebuild', () => ({
  rebuildSummaryVectorMirror_ACU: (...args: any[]) => h.rebuild(...args),
}));

import { rebuildCurrentSummaryVectorIndexNow_ACU } from '../../../src/service/vector/summary-vector-index-rebuild-service';

describe('rebuildCurrentSummaryVectorIndexNow_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.data = { sheet_summary: { name: '纪要表', content: [['row_id', '纪要'], ['1', '内容']] } };
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
