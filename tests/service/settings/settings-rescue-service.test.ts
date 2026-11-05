import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loaded: 100 as number | null,
  read: vi.fn(),
  select: vi.fn(),
  update: vi.fn(async () => undefined),
  apply: vi.fn(() => 1),
  load: vi.fn(),
  state: 'pending',
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({ getLoadedTavernSettingsWrittenAt_ACU: () => h.loaded }));
vi.mock('../../../src/data/storage/settings-rescue', () => ({
  readSettingsRescue_ACU: h.read,
  selectSettingsRescueCandidates_ACU: h.select,
  updateSettingsRescue_ACU: h.update,
  applySettingsRescueEntries_ACU: h.apply,
}));
vi.mock('../../../src/data/storage/settings-save-confirm', () => ({ getSettingsPersistenceState_ACU: () => h.state }));
vi.mock('../../../src/service/settings/settings-service', () => ({ loadSettings_ACU: h.load }));

import {
  declineSettingsRescue_ACU,
  findSettingsRescueCandidate_ACU,
  restoreSettingsRescue_ACU,
} from '../../../src/service/settings/settings-rescue-service';

const stored = (writtenAt: number, backend = 'indexeddb') => ({
  backend,
  record: { writtenAt, declinedWrittenAt: null, backup: { entries: { profile: `p${writtenAt}` } } },
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.loaded = 100;
  h.state = 'pending';
  h.read.mockResolvedValue({ records: [], failures: [] });
  h.select.mockReturnValue([]);
});

describe('findSettingsRescueCandidate_ACU', () => {
  it('酒馆设置不可用时返回未就绪，不读副本', async () => {
    h.loaded = null;
    await expect(findSettingsRescueCandidate_ACU()).resolves.toEqual({ ready: false, candidate: null, failures: [] });
    expect(h.read).not.toHaveBeenCalled();
  });

  it('按宿主加载标记筛选，最新副本作为候选，读取失败如实返回', async () => {
    const records = [stored(300), stored(200, 'tauritavern-store')];
    h.read.mockResolvedValue({ records, failures: [{ backend: 'indexeddb', message: 'blocked' }] });
    h.select.mockReturnValue(records);
    const result = await findSettingsRescueCandidate_ACU();
    expect(h.select).toHaveBeenCalledWith(records, 100);
    expect(result).toEqual({ ready: true, candidate: { latest: records[0], pending: records }, failures: ['indexeddb：blocked'] });
  });

  it('没有新于宿主的副本时无候选', async () => {
    await expect(findSettingsRescueCandidate_ACU()).resolves.toEqual({ ready: true, candidate: null, failures: [] });
  });
});

describe('restoreSettingsRescue_ACU', () => {
  const candidate = { latest: stored(300), pending: [stored(300)] };

  it('写回最新副本后重新加载设置', () => {
    expect(restoreSettingsRescue_ACU(candidate)).toEqual({ ok: true, persistence: 'pending' });
    expect(h.apply).toHaveBeenCalledWith({ profile: 'p300' });
    expect(h.load).toHaveBeenCalledOnce();
  });

  it('写回失败时不重新加载', () => {
    h.apply.mockImplementationOnce(() => { throw new Error('酒馆设置不可用'); });
    expect(restoreSettingsRescue_ACU(candidate)).toEqual({ ok: false, error: '酒馆设置不可用' });
    expect(h.load).not.toHaveBeenCalled();
  });

  it('重新加载失败时如实报告', () => {
    h.load.mockImplementationOnce(() => { throw new Error('corrupt'); });
    expect(restoreSettingsRescue_ACU(candidate)).toEqual({ ok: false, error: '配置副本已写入，但重新加载设置失败：corrupt' });
  });
});

describe('declineSettingsRescue_ACU', () => {
  it('把全部待提示副本标记为已忽略并保留在原后端', async () => {
    const pending = [stored(300), stored(200, 'tauritavern-store')];
    await expect(declineSettingsRescue_ACU({ latest: pending[0], pending })).resolves.toEqual({ ok: true, persistence: 'pending' });
    expect(h.update.mock.calls.map((call: any[]) => [call[0].backend, call[0].record.declinedWrittenAt])).toEqual([
      ['indexeddb', 300], ['tauritavern-store', 200],
    ]);
  });

  it('写回失败时返回错误', async () => {
    h.update.mockRejectedValueOnce(new Error('denied'));
    await expect(declineSettingsRescue_ACU({ latest: stored(300), pending: [stored(300)] })).resolves.toEqual({ ok: false, error: '记录忽略失败：denied' });
  });
});
