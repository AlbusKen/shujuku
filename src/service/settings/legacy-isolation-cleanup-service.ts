/**
 * 退役隔离标签的全局 Profile 清理编排。
 *
 * 只清理全局隔离登记及对应 Profile（设置/表格模板），不删除聊天正文，也不改写
 * 各聊天消息中已经持久化的历史表格数据。
 */
import { normalizeIsolationCode_ACU } from '../../shared/data-constants';
import { logWarn_ACU } from '../../shared/utils';
import { deleteProfileFromStorage_ACU, globalMeta_ACU, saveGlobalMeta_ACU } from '../../data/repositories/profile-repo';
import { getDataIsolationHistory_ACU } from '../../data/repositories/isolation-repo';
import { settings_ACU } from '../runtime/state-manager';
import { saveSettings_ACU, switchIsolationProfile_ACU } from './settings-service';

export interface LegacyIsolationCleanupFailure_ACU {
  code: string;
  error: string;
}

export interface LegacyIsolationCleanupResult_ACU {
  removedCodes: string[];
  failedCodes: LegacyIsolationCleanupFailure_ACU[];
  switchedToDefault: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

/**
 * 清理全部旧隔离标签。
 *
 * 先切回默认槽，再逐个删除 Profile。单个删除失败时保留该标签的历史登记，
 * 便于用户重试；成功项则从登记中移除。
 */
export async function cleanupLegacyIsolationProfiles_ACU(): Promise<LegacyIsolationCleanupResult_ACU> {
  const activeCode = normalizeIsolationCode_ACU(
    settings_ACU?.dataIsolationCode || globalMeta_ACU?.activeIsolationCode || '',
  );
  const switchedToDefault = !!activeCode;
  if (switchedToDefault) {
    await switchIsolationProfile_ACU('');
  }

  const codes = [...new Set(
    [activeCode, ...getDataIsolationHistory_ACU()]
      .map(code => normalizeIsolationCode_ACU(code))
      .filter(Boolean),
  )];

  if (codes.length === 0) {
    return { removedCodes: [], failedCodes: [], switchedToDefault };
  }

  const removedCodes: string[] = [];
  const failedCodes: LegacyIsolationCleanupFailure_ACU[] = [];
  for (const code of codes) {
    try {
      deleteProfileFromStorage_ACU(code);
      removedCodes.push(code);
    } catch (error) {
      const message = errorMessage(error);
      failedCodes.push({ code, error: message });
      logWarn_ACU(`[旧隔离清理] 删除 Profile 失败: ${code}`, error);
    }
  }

  globalMeta_ACU.activeIsolationCode = '';
  globalMeta_ACU.isolationCodeList = failedCodes.map(item => item.code);
  settings_ACU.dataIsolationCode = '';
  settings_ACU.dataIsolationEnabled = false;
  settings_ACU.dataIsolationHistory = [];

  if (!saveGlobalMeta_ACU()) {
    throw new Error('旧隔离标签登记保存失败，请检查存储状态后重试。');
  }
  const saveResult = saveSettings_ACU();
  if (!saveResult.saved) {
    throw new Error(saveResult.warning || saveResult.error || '默认设置保存失败。');
  }

  return { removedCodes, failedCodes, switchedToDefault };
}
