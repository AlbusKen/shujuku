import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue';
import {
  buildSettingsNamespaceBackup_ACU,
  getSettingsPersistenceState_ACU,
  subscribeSettingsPersistence_ACU,
  type SettingsPersistenceState_ACU,
} from '../../service/settings/settings-persistence-status';
import { notify_ACU } from '../../shared/notice-hub';
import { logError_ACU } from '../../shared/utils';
import { getAcuHostDocument } from '../bootstrap/host-document';

export const SETTINGS_UNSAVED_TEXT_ACU = '配置未写入磁盘。请先导出当前配置，再重载页面。';

function backupFilename_ACU(createdAt: number): string {
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  return `TavernDB_Settings_Backup_${stamp}.json`;
}

/** 把插件在酒馆设置中的命名空间原样导出为 JSON 文件；酒馆设置不可用或下载失败时返回 false。 */
export function exportSettingsNamespaceBackup_ACU(): boolean {
  try {
    const backup = buildSettingsNamespaceBackup_ACU();
    if (!backup) {
      notify_ACU('error', '酒馆设置不可用，无法导出当前配置。');
      return false;
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const doc = getAcuHostDocument();
    const a = doc.createElement('a');
    a.href = url;
    a.download = backupFilename_ACU(backup.createdAt);
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    logError_ACU('导出当前配置失败:', error);
    notify_ACU('error', '导出当前配置失败，请检查控制台获取详情。');
    return false;
  }
}

/** 设置落盘状态的响应式投影。 */
export function useSettingsPersistence() {
  const state = shallowRef<SettingsPersistenceState_ACU>(getSettingsPersistenceState_ACU());
  const unsubscribe = subscribeSettingsPersistence_ACU(next => { state.value = next; });
  if (getCurrentScope()) onScopeDispose(unsubscribe);
  const unsaved = computed(() => state.value === 'unsaved');
  return { state, unsaved, exportBackup: exportSettingsNamespaceBackup_ACU };
}
