import { computed, shallowRef } from 'vue';
import {
  declineSettingsRescue_ACU,
  findSettingsRescueCandidate_ACU,
  restoreSettingsRescue_ACU,
  type SettingsRescueCandidate_ACU,
} from '../../service/settings/settings-rescue-service';
import { notify_ACU } from '../../shared/notice-hub';
import { logWarn_ACU } from '../../shared/utils';

export type { SettingsRescueCandidate_ACU };

/** 本会话检查到的可恢复副本；每个会话只检查一次。 */
export const settingsRescueCandidate_ACU = shallowRef<SettingsRescueCandidate_ACU | null>(null);
const busy_ACU = shallowRef(false);
let checked_ACU = false;
let checking_ACU: Promise<void> | null = null;

export function isSettingsRescueChecked_ACU(): boolean {
  return checked_ACU;
}

export function formatSettingsRescueTime_ACU(candidate: SettingsRescueCandidate_ACU): string {
  return new Date(candidate.latest.record.savedAt).toLocaleString();
}

/** 酒馆设置可用后检查一次保全副本；尚不可用时保持未检查，等待下一次设置加载。 */
export function refreshSettingsRescueCandidate_ACU(): Promise<void> {
  if (checked_ACU) return Promise.resolve();
  if (checking_ACU) return checking_ACU;
  checking_ACU = (async () => {
    try {
      const result = await findSettingsRescueCandidate_ACU();
      if (!result.ready) return;
      checked_ACU = true;
      settingsRescueCandidate_ACU.value = result.candidate;
      if (result.failures.length) notify_ACU('warning', `配置保全副本读取失败：${result.failures.join('；')}`);
    } catch (error) {
      logWarn_ACU('[配置保全] 检查保全副本失败:', error);
    } finally {
      checking_ACU = null;
    }
  })();
  return checking_ACU;
}

async function restore_ACU(): Promise<boolean> {
  const candidate = settingsRescueCandidate_ACU.value;
  if (!candidate || busy_ACU.value) return false;
  busy_ACU.value = true;
  try {
    const result = restoreSettingsRescue_ACU(candidate);
    if ('error' in result) {
      notify_ACU('error', result.error);
      return false;
    }
    settingsRescueCandidate_ACU.value = null;
    notify_ACU(result.persistence === 'unsaved' ? 'warning' : 'success',
      result.persistence === 'unsaved' ? '配置副本已恢复，但酒馆仍未写入磁盘。' : '配置副本已恢复。');
    return true;
  } finally {
    busy_ACU.value = false;
  }
}

async function decline_ACU(): Promise<boolean> {
  const candidate = settingsRescueCandidate_ACU.value;
  if (!candidate || busy_ACU.value) return false;
  busy_ACU.value = true;
  try {
    const result = await declineSettingsRescue_ACU(candidate);
    if ('error' in result) {
      notify_ACU('error', result.error);
      return false;
    }
    settingsRescueCandidate_ACU.value = null;
    return true;
  } finally {
    busy_ACU.value = false;
  }
}

export function useSettingsRescue() {
  const candidateTime = computed(() => settingsRescueCandidate_ACU.value ? formatSettingsRescueTime_ACU(settingsRescueCandidate_ACU.value) : '');
  return { candidate: settingsRescueCandidate_ACU, candidateTime, busy: busy_ACU, restore: restore_ACU, decline: decline_ACU };
}

/** 测试用：重置模块级状态。 */
export function _resetSettingsRescueState_ACU(): void {
  settingsRescueCandidate_ACU.value = null;
  busy_ACU.value = false;
  checked_ACU = false;
  checking_ACU = null;
}
