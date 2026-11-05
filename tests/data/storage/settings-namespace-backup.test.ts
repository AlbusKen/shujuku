import { describe, expect, it, vi, beforeEach } from 'vitest';

const harness = vi.hoisted(() => ({ ns: null as any }));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  TAVERN_SETTINGS_NAMESPACE_ACU: 'ACU__userscript_settings_v1',
  getTavernSettingsNamespace_ACU: () => harness.ns,
}));
vi.mock('../../../src/data/storage/settings-save-confirm', () => ({
  getSettingsPersistenceSnapshot_ACU: () => ({
    state: 'unsaved', latestWriteSeq: 5, confirmedWriteSeq: 3, lastFailedWriteSeq: 0, lastWriteAt: 0,
  }),
}));

import { buildSettingsNamespaceBackup_ACU } from '../../../src/data/storage/settings-namespace-backup';

beforeEach(() => { harness.ns = null; });

describe('buildSettingsNamespaceBackup_ACU', () => {
  it('酒馆设置不可用时返回 null', () => {
    expect(buildSettingsNamespaceBackup_ACU()).toBeNull();
  });

  it('按原样复制命名空间并附带落盘状态与写入序号', () => {
    harness.ns = { profile_a: '{"x":1}', globalMeta: '{"activeIsolationCode":"a"}' };
    const backup = buildSettingsNamespaceBackup_ACU(123)!;
    expect(backup).toEqual({
      format: 'acu-settings-namespace-backup',
      version: 1,
      namespace: 'ACU__userscript_settings_v1',
      createdAt: 123,
      persistence: 'unsaved',
      latestWriteSeq: 5,
      confirmedWriteSeq: 3,
      entries: { profile_a: '{"x":1}', globalMeta: '{"activeIsolationCode":"a"}' },
    });
    harness.ns.profile_a = 'changed';
    expect(backup.entries.profile_a).toBe('{"x":1}');
  });
});
