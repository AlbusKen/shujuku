/**
 * v2-ui-state — 新 UI localStorage 根状态的共享常量。
 */
export const ACU_V2_STORAGE_KEY = 'acu_v2_ui_state';
export const ACU_V2_DEV_OPTIONS_SECTION_KEY = 'devOptions';
export const LEGACY_UI_MENU_VISIBLE_KEY = 'legacyUiMenuVisible';
export const WARN_LOG_ENABLED_KEY = 'warnLogEnabled';
export const API_LOG_ENABLED_KEY = 'apiLogEnabled';

/**
 * 在 Vue/Pinia 尚未挂载时读取日志开关，保证启动阶段也遵守持久化设置。
 */
export function readWarnLogEnabled(): boolean {
  return readLogEnabled(WARN_LOG_ENABLED_KEY);
}

export function readApiLogEnabled(): boolean {
  return readLogEnabled(API_LOG_ENABLED_KEY);
}

function readLogEnabled(key: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const raw = window.localStorage.getItem(ACU_V2_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const devOptions = (parsed as Record<string, unknown>)[ACU_V2_DEV_OPTIONS_SECTION_KEY];
    if (!devOptions || typeof devOptions !== 'object') return false;
    return (devOptions as Record<string, unknown>)[key] === true;
  } catch {
    return false;
  }
}
