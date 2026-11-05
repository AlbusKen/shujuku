/**
 * 设置未落盘时在通知汇流口登记常驻任务；气泡挂在设置外壳之外，新旧界面都可见。
 * 宿主重新确认落盘后结束任务。设置加载后检查一次保全副本，有可恢复副本时登记提示。
 */
import { watch } from 'vue';
import {
  getSettingsPersistenceState_ACU,
  subscribeSettingsPersistence_ACU,
  type SettingsPersistenceState_ACU,
} from '../../service/settings/settings-persistence-status';
import { beginNoticeTask_ACU, getNoticeHubSnapshot_ACU, subscribeNoticeHub_ACU, type NoticeTaskHandle_ACU } from '../../shared/notice-hub';
import { getProfileRecoveryCodes_ACU, subscribeProfileRecovery_ACU } from '../../service/settings/profile-recovery-state';
import { SETTINGS_UNSAVED_TEXT_ACU, exportSettingsNamespaceBackup_ACU } from '../composables/useSettingsPersistence';
import {
  formatSettingsRescueTime_ACU,
  isSettingsRescueChecked_ACU,
  refreshSettingsRescueCandidate_ACU,
  settingsRescueCandidate_ACU,
  type SettingsRescueCandidate_ACU,
} from '../composables/useSettingsRescue';

export type SettingsPersistenceNoticeOptions_ACU = { openShell?: () => unknown };

let handle_ACU: NoticeTaskHandle_ACU | null = null;
let rescueHandle_ACU: NoticeTaskHandle_ACU | null = null;
let recoveryHandle_ACU: NoticeTaskHandle_ACU | null = null;
let cleanups_ACU: Array<() => void> | null = null;

function sync_ACU(state: SettingsPersistenceState_ACU): void {
  if (state === 'unsaved') {
    if (handle_ACU && !handle_ACU.ended) return;
    handle_ACU = beginNoticeTask_ACU('配置保存', {
      detail: SETTINGS_UNSAVED_TEXT_ACU,
      kind: 'error',
      busy: false,
      dismissible: false,
      action: { label: '导出当前配置', run: () => { exportSettingsNamespaceBackup_ACU(); } },
    });
    return;
  }
  if (!handle_ACU) return;
  const current = handle_ACU;
  handle_ACU = null;
  current.end(state === 'confirmed' ? { kind: 'success', text: '配置已重新写入磁盘。' } : undefined);
}

function syncRescue_ACU(candidate: SettingsRescueCandidate_ACU | null, openShell?: () => unknown): void {
  rescueHandle_ACU?.end();
  rescueHandle_ACU = null;
  if (!candidate) return;
  rescueHandle_ACU = beginNoticeTask_ACU('配置保全', {
    detail: `发现 ${formatSettingsRescueTime_ACU(candidate)} 的未写入配置副本，比当前酒馆设置更新。`,
    kind: 'warning',
    busy: false,
    dismissible: true,
    action: openShell ? { label: '查看', run: () => { void openShell(); } } : null,
  });
}

function syncRecovery_ACU(codes: string[] | null, openShell?: () => unknown): void {
  recoveryHandle_ACU?.end();
  recoveryHandle_ACU = null;
  if (!codes) return;
  recoveryHandle_ACU = beginNoticeTask_ACU('配置档', {
    detail: `未找到全局配置记录，存储中仍有配置档：${codes.join('、')}。请在数据管理中选择配置档，选择前不会写入全局配置。`,
    kind: 'warning',
    busy: false,
    dismissible: false,
    action: openShell ? { label: '查看', run: () => { void openShell(); } } : null,
  });
}

export function installSettingsPersistenceNotice_ACU(options: SettingsPersistenceNoticeOptions_ACU = {}): void {
  if (cleanups_ACU) return;
  const cleanups: Array<() => void> = [];
  cleanups_ACU = cleanups;
  cleanups.push(subscribeSettingsPersistence_ACU(sync_ACU));
  cleanups.push(watch(settingsRescueCandidate_ACU, candidate => syncRescue_ACU(candidate, options.openShell), { flush: 'sync' }));
  cleanups.push(subscribeProfileRecovery_ACU(codes => syncRecovery_ACU(codes, options.openShell)));
  let settingsVersion = getNoticeHubSnapshot_ACU().settingsVersion;
  const stopHub = subscribeNoticeHub_ACU(() => {
    if (isSettingsRescueChecked_ACU()) { stopHub(); return; }
    const next = getNoticeHubSnapshot_ACU().settingsVersion;
    if (next === settingsVersion) return;
    settingsVersion = next;
    void refreshSettingsRescueCandidate_ACU();
  });
  cleanups.push(stopHub);
  sync_ACU(getSettingsPersistenceState_ACU());
  syncRescue_ACU(settingsRescueCandidate_ACU.value, options.openShell);
  syncRecovery_ACU(getProfileRecoveryCodes_ACU(), options.openShell);
  void refreshSettingsRescueCandidate_ACU();
}

/** 测试用：卸载订阅并结束任务。 */
export function _resetSettingsPersistenceNotice_ACU(): void {
  cleanups_ACU?.forEach(cleanup => cleanup());
  cleanups_ACU = null;
  handle_ACU?.end();
  handle_ACU = null;
  rescueHandle_ACU?.end();
  rescueHandle_ACU = null;
  recoveryHandle_ACU?.end();
  recoveryHandle_ACU = null;
}
