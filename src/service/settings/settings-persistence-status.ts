/**
 * 设置落盘状态、命名空间快照与保全副本写入器的 service 门面，供界面层订阅与导出。
 */
export {
    getSettingsPersistenceState_ACU,
    subscribeSettingsPersistence_ACU,
    type SettingsPersistenceState_ACU,
} from '../../data/storage/settings-save-confirm';
export {
    buildSettingsNamespaceBackup_ACU,
    type SettingsNamespaceBackup_ACU,
} from '../../data/storage/settings-namespace-backup';
export { installSettingsRescueWriter_ACU } from '../../data/storage/settings-rescue';
