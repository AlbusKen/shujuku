/**
 * tests/data/storage/config-storage.test.ts
 * 统一配置存储门面 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetConfigStorage,
  mockSanitizeSettingsForProfileSave,
  mockGetProfileSettingsKey,
  mockLogError,
} = vi.hoisted(() => ({
  mockGetConfigStorage: vi.fn(),
  mockSanitizeSettingsForProfileSave: vi.fn((obj: any) => ({ ...obj })),
  mockGetProfileSettingsKey: vi.fn((code: string) => `profile_${code}`),
  mockLogError: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: mockLogError,
}));

vi.mock('../../../src/shared/data-constants', () => ({
  getProfileSettingsKey_ACU: mockGetProfileSettingsKey,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  sanitizeSettingsForProfileSave_ACU: mockSanitizeSettingsForProfileSave,
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: mockGetConfigStorage,
}));

import { persistSettingsToStorage_ACU } from '../../../src/data/storage/config-storage';

let mockStore: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockStore = { getItem: vi.fn(() => null), setItem: vi.fn() };
  mockGetConfigStorage.mockReturnValue(mockStore);
});

describe('persistSettingsToStorage_ACU', () => {
  it('settingsObj 为 undefined 时不执行任何操作', () => {
    persistSettingsToStorage_ACU(undefined, 'code');
    expect(mockGetConfigStorage).not.toHaveBeenCalled();
    expect(mockStore.setItem).not.toHaveBeenCalled();
  });

  it('settingsObj 为 null 时不执行任何操作', () => {
    persistSettingsToStorage_ACU(null, 'code');
    expect(mockGetConfigStorage).not.toHaveBeenCalled();
  });

  it('正常写入存储', () => {
    const settings = { apiConfig: { url: 'http://test' } };
    persistSettingsToStorage_ACU(settings, 'iso_code');

    expect(mockGetConfigStorage).toHaveBeenCalled();
    expect(mockSanitizeSettingsForProfileSave).toHaveBeenCalledWith(settings);
    expect(mockGetProfileSettingsKey).toHaveBeenCalledWith('iso_code');
    expect(mockStore.setItem).toHaveBeenCalledWith(
      'profile_iso_code',
      expect.any(String),
    );

    // 验证写入的 JSON 包含 dataIsolationCode
    const writtenJson = mockStore.setItem.mock.calls[0][1];
    const parsed = JSON.parse(writtenJson);
    expect(parsed.dataIsolationCode).toBe('iso_code');
  });

  it('isolationCode 为 undefined 时使用空字符串', () => {
    persistSettingsToStorage_ACU({ key: 'value' });

    const writtenJson = mockStore.setItem.mock.calls[0][1];
    const parsed = JSON.parse(writtenJson);
    expect(parsed.dataIsolationCode).toBe('');
    expect(mockGetProfileSettingsKey).toHaveBeenCalledWith('');
  });

  it('sanitize 后的对象被序列化', () => {
    mockSanitizeSettingsForProfileSave.mockReturnValue({ sanitized: true });
    persistSettingsToStorage_ACU({ raw: true }, 'code');

    const writtenJson = mockStore.setItem.mock.calls[0][1];
    const parsed = JSON.parse(writtenJson);
    expect(parsed.sanitized).toBe(true);
    expect(parsed.dataIsolationCode).toBe('code');
  });

  it.each(['{broken', '[]', 'null', ''])('目标配置损坏时拒绝覆盖：%s', raw => {
    mockStore.getItem.mockReturnValue(raw);
    expect(persistSettingsToStorage_ACU({ model: 'new' }, 'code')).toBe(false);
    expect(mockStore.setItem).not.toHaveBeenCalled();
  });

  it('目标读取失败时拒绝覆盖，恢复后允许保存', () => {
    mockStore.getItem.mockImplementationOnce(() => { throw new Error('offline'); });
    expect(persistSettingsToStorage_ACU({}, 'code')).toBe(false);
    expect(mockStore.setItem).not.toHaveBeenCalled();
    mockStore.getItem.mockReturnValue('{}');
    expect(persistSettingsToStorage_ACU({}, 'code')).toBe(true);
    expect(mockStore.setItem).toHaveBeenCalledOnce();
  });

  it('存储抛错时记录错误日志', () => {
    mockGetConfigStorage.mockImplementation(() => {
      throw new Error('storage error');
    });
    persistSettingsToStorage_ACU({ key: 'value' }, 'code');

    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to persist settings to storage:',
      expect.any(Error),
    );
  });

  it('setItem 抛错时记录错误日志', () => {
    mockStore.setItem.mockImplementation(() => {
      throw new Error('write error');
    });
    persistSettingsToStorage_ACU({ key: 'value' }, 'code');

    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to persist settings to storage:',
      expect.any(Error),
    );
  });
});
