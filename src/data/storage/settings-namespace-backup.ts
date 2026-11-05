/**
 * 插件在酒馆设置中的命名空间快照。
 *
 * 宿主未确认落盘时，内存里的命名空间是唯一的最新配置；这里按原样复制它，供导出与保全副本使用。
 */
import { TAVERN_SETTINGS_NAMESPACE_ACU, getTavernSettingsNamespace_ACU } from './tavern-storage';
import { getSettingsPersistenceSnapshot_ACU, type SettingsPersistenceState_ACU } from './settings-save-confirm';

export const SETTINGS_NAMESPACE_BACKUP_FORMAT_ACU = 'acu-settings-namespace-backup';
export const SETTINGS_NAMESPACE_BACKUP_VERSION_ACU = 1;

export type SettingsNamespaceBackup_ACU = {
    format: typeof SETTINGS_NAMESPACE_BACKUP_FORMAT_ACU;
    version: typeof SETTINGS_NAMESPACE_BACKUP_VERSION_ACU;
    namespace: string;
    createdAt: number;
    persistence: SettingsPersistenceState_ACU;
    latestWriteSeq: number;
    confirmedWriteSeq: number;
    entries: Record<string, unknown>;
};

/** 酒馆设置不可用时返回 null。 */
export function buildSettingsNamespaceBackup_ACU(now: number = Date.now()): SettingsNamespaceBackup_ACU | null {
    const ns = getTavernSettingsNamespace_ACU();
    if (!ns || typeof ns !== 'object') return null;
    const entries = JSON.parse(JSON.stringify(ns)) as Record<string, unknown>;
    const persistence = getSettingsPersistenceSnapshot_ACU();
    return {
        format: SETTINGS_NAMESPACE_BACKUP_FORMAT_ACU,
        version: SETTINGS_NAMESPACE_BACKUP_VERSION_ACU,
        namespace: TAVERN_SETTINGS_NAMESPACE_ACU,
        createdAt: now,
        persistence: persistence.state,
        latestWriteSeq: persistence.latestWriteSeq,
        confirmedWriteSeq: persistence.confirmedWriteSeq,
        entries,
    };
}
