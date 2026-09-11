/**
 * 全局旧隔离标签清理服务单元测试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    dataIsolationCode: 'old-a',
    dataIsolationEnabled: true,
    dataIsolationHistory: ['legacy-setting-history'],
  } as any,
  globalMeta: {
    activeIsolationCode: 'old-a',
    isolationCodeList: ['old-a', 'old-b'],
  } as any,
  switchIsolationProfile: vi.fn(async (code: string) => {
    mocks.settings.dataIsolationCode = code;
    mocks.settings.dataIsolationEnabled = !!code;
    if (!code) mocks.globalMeta.activeIsolationCode = '';
  }),
  saveSettings: vi.fn(() => ({ saved: true, storageType: 'memory' as const })),
  deleteProfile: vi.fn(),
  saveGlobalMeta: vi.fn(() => true),
}));

vi.mock('../../../src/shared/data-constants', () => ({
  normalizeIsolationCode_ACU: (code: unknown) => String(code || '').trim(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mocks.settings,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  switchIsolationProfile_ACU: mocks.switchIsolationProfile,
  saveSettings_ACU: mocks.saveSettings,
}));

vi.mock('../../../src/data/repositories/isolation-repo', () => ({
  getDataIsolationHistory_ACU: () => [...mocks.globalMeta.isolationCodeList],
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: mocks.globalMeta,
  saveGlobalMeta_ACU: mocks.saveGlobalMeta,
  deleteProfileFromStorage_ACU: mocks.deleteProfile,
}));

import { cleanupLegacyIsolationProfiles_ACU } from '../../../src/service/settings/legacy-isolation-cleanup-service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.dataIsolationCode = 'old-a';
  mocks.settings.dataIsolationEnabled = true;
  mocks.settings.dataIsolationHistory = ['legacy-setting-history'];
  mocks.globalMeta.activeIsolationCode = 'old-a';
  mocks.globalMeta.isolationCodeList = ['old-a', 'old-b'];
  mocks.saveGlobalMeta.mockReturnValue(true);
  mocks.saveSettings.mockReturnValue({ saved: true, storageType: 'memory' });
});

describe('cleanupLegacyIsolationProfiles_ACU', () => {
  it('切回默认槽并删除全部历史隔离标签的 Profile', async () => {
    const result = await cleanupLegacyIsolationProfiles_ACU();

    expect(mocks.switchIsolationProfile).toHaveBeenCalledOnce();
    expect(mocks.switchIsolationProfile).toHaveBeenCalledWith('');
    expect(mocks.deleteProfile).toHaveBeenCalledTimes(2);
    expect(mocks.deleteProfile).toHaveBeenNthCalledWith(1, 'old-a');
    expect(mocks.deleteProfile).toHaveBeenNthCalledWith(2, 'old-b');
    expect(mocks.globalMeta.activeIsolationCode).toBe('');
    expect(mocks.globalMeta.isolationCodeList).toEqual([]);
    expect(mocks.settings.dataIsolationCode).toBe('');
    expect(mocks.settings.dataIsolationEnabled).toBe(false);
    expect(mocks.settings.dataIsolationHistory).toEqual([]);
    expect(mocks.saveGlobalMeta).toHaveBeenCalledOnce();
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
    expect(result).toEqual({
      removedCodes: ['old-a', 'old-b'],
      failedCodes: [],
      switchedToDefault: true,
    });
  });

  it('激活标签即使未进入历史列表也会被清理', async () => {
    mocks.globalMeta.isolationCodeList = ['old-b'];

    const result = await cleanupLegacyIsolationProfiles_ACU();

    expect(mocks.deleteProfile).toHaveBeenCalledWith('old-a');
    expect(mocks.deleteProfile).toHaveBeenCalledWith('old-b');
    expect(result.removedCodes).toEqual(['old-a', 'old-b']);
  });

  it('单个 Profile 删除失败时保留失败标签供重试，不中断其他清理', async () => {
    mocks.deleteProfile.mockImplementation((code: string) => {
      if (code === 'old-b') throw new Error('remove failed');
    });

    const result = await cleanupLegacyIsolationProfiles_ACU();

    expect(result.removedCodes).toEqual(['old-a']);
    expect(result.failedCodes).toEqual([{ code: 'old-b', error: 'remove failed' }]);
    expect(mocks.globalMeta.activeIsolationCode).toBe('');
    expect(mocks.globalMeta.isolationCodeList).toEqual(['old-b']);
    expect(mocks.saveGlobalMeta).toHaveBeenCalledOnce();
  });

  it('切回默认槽失败时中止清理，不删除任何 Profile', async () => {
    mocks.switchIsolationProfile.mockRejectedValueOnce(new Error('switch failed'));

    await expect(cleanupLegacyIsolationProfiles_ACU()).rejects.toThrow('switch failed');
    expect(mocks.deleteProfile).not.toHaveBeenCalled();
    expect(mocks.saveGlobalMeta).not.toHaveBeenCalled();
  });
});
