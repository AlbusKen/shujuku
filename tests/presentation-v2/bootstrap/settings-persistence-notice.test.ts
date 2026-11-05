import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  state: 'confirmed' as string,
  listeners: new Set<(state: string) => void>(),
  exportBackup: vi.fn(() => true),
  rescueChecked: false,
  refreshRescue: vi.fn(async () => undefined),
}));

vi.mock('../../../src/service/settings/settings-persistence-status', () => ({
  getSettingsPersistenceState_ACU: () => harness.state,
  subscribeSettingsPersistence_ACU: (listener: (state: string) => void) => {
    harness.listeners.add(listener);
    return () => { harness.listeners.delete(listener); };
  },
}));
vi.mock('../../../src/presentation-v2/composables/useSettingsPersistence', () => ({
  SETTINGS_UNSAVED_TEXT_ACU: '配置未写入磁盘。',
  exportSettingsNamespaceBackup_ACU: harness.exportBackup,
}));
vi.mock('../../../src/presentation-v2/composables/useSettingsRescue', async () => {
  const { shallowRef } = await import('vue');
  return {
    settingsRescueCandidate_ACU: shallowRef(null),
    formatSettingsRescueTime_ACU: () => '2026/1/1 00:00:00',
    isSettingsRescueChecked_ACU: () => harness.rescueChecked,
    refreshSettingsRescueCandidate_ACU: harness.refreshRescue,
  };
});

import { __resetNoticeHubForTests_ACU, getNoticeHubSnapshot_ACU, notifyNoticeSettingsChanged_ACU, runNoticeTaskAction_ACU } from '../../../src/shared/notice-hub';
import { settingsRescueCandidate_ACU } from '../../../src/presentation-v2/composables/useSettingsRescue';
import { _resetProfileRecoveryState_ACU, setProfileRecoveryCodes_ACU } from '../../../src/service/settings/profile-recovery-state';
import {
  installSettingsPersistenceNotice_ACU,
  _resetSettingsPersistenceNotice_ACU,
} from '../../../src/presentation-v2/bootstrap/settings-persistence-notice';

const setState = (next: string) => {
  harness.state = next;
  for (const listener of [...harness.listeners]) listener(next);
};

beforeEach(() => {
  __resetNoticeHubForTests_ACU();
  harness.state = 'confirmed';
  harness.exportBackup.mockClear();
  harness.rescueChecked = false;
  harness.refreshRescue.mockClear();
});

afterEach(() => {
  _resetSettingsPersistenceNotice_ACU();
  _resetProfileRecoveryState_ACU();
  harness.listeners.clear();
  (settingsRescueCandidate_ACU as any).value = null;
});

describe('settings-persistence-notice', () => {
  it('已确认时不登记任务', () => {
    installSettingsPersistenceNotice_ACU();
    expect(getNoticeHubSnapshot_ACU().tasks).toHaveLength(0);
  });

  it('进入未落盘时登记一条不可关闭、带导出按钮的常驻错误任务，重复状态不重复登记', async () => {
    installSettingsPersistenceNotice_ACU();
    setState('unsaved');
    setState('unsaved');
    const tasks = getNoticeHubSnapshot_ACU().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ feature: '配置保存', kind: 'error', busy: false, dismissible: false });
    expect(tasks[0].action?.label).toBe('导出当前配置');
    await runNoticeTaskAction_ACU(tasks[0].id);
    expect(harness.exportBackup).toHaveBeenCalledOnce();
  });

  it('安装时已是未落盘也立即登记', () => {
    harness.state = 'unsaved';
    installSettingsPersistenceNotice_ACU();
    expect(getNoticeHubSnapshot_ACU().tasks).toHaveLength(1);
  });

  it('重新确认后结束任务并发出成功消息', () => {
    installSettingsPersistenceNotice_ACU();
    setState('unsaved');
    setState('confirmed');
    const snapshot = getNoticeHubSnapshot_ACU();
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.notices.map(notice => notice.kind)).toEqual(['success']);
  });

  it('离开未落盘但未确认时结束任务，不发成功消息', () => {
    installSettingsPersistenceNotice_ACU();
    setState('unsaved');
    setState('unconfirmable');
    const snapshot = getNoticeHubSnapshot_ACU();
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.notices).toHaveLength(0);
  });

  it('有可恢复副本时登记可关闭的提示，查看按钮打开面板，副本处理后结束提示', async () => {
    const openShell = vi.fn();
    installSettingsPersistenceNotice_ACU({ openShell });
    (settingsRescueCandidate_ACU as any).value = { latest: {}, pending: [] };
    const tasks = getNoticeHubSnapshot_ACU().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ feature: '配置保全', kind: 'warning', busy: false, dismissible: true });
    await runNoticeTaskAction_ACU(tasks[0].id);
    expect(openShell).toHaveBeenCalledOnce();
    (settingsRescueCandidate_ACU as any).value = null;
    expect(getNoticeHubSnapshot_ACU().tasks).toHaveLength(0);
  });

  it('安装时检查一次副本，设置重新加载后在未检查完成前重查', () => {
    installSettingsPersistenceNotice_ACU();
    expect(harness.refreshRescue).toHaveBeenCalledTimes(1);
    notifyNoticeSettingsChanged_ACU();
    expect(harness.refreshRescue).toHaveBeenCalledTimes(2);
    harness.rescueChecked = true;
    notifyNoticeSettingsChanged_ACU();
    notifyNoticeSettingsChanged_ACU();
    expect(harness.refreshRescue).toHaveBeenCalledTimes(2);
  });

  it('配置档待选择时登记不可关闭的提示，查看按钮打开面板，选择后结束', async () => {
    const openShell = vi.fn();
    installSettingsPersistenceNotice_ACU({ openShell });
    setProfileRecoveryCodes_ACU(['alpha']);
    const tasks = getNoticeHubSnapshot_ACU().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ feature: '配置档', kind: 'warning', busy: false, dismissible: false });
    await runNoticeTaskAction_ACU(tasks[0].id);
    expect(openShell).toHaveBeenCalledOnce();
    setProfileRecoveryCodes_ACU(null);
    expect(getNoticeHubSnapshot_ACU().tasks).toHaveLength(0);
  });
});
