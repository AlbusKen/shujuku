/**
 * dev-options-store — 仪表盘"启用开发者选项"总开关 + 各开发者 gated 字段的共享 store
 *
 * 字段：
 * - developerOptionsEnabled：仪表盘"高级设置"中的总开关。**仅**控制 sidebar 是否显示
 *   "开发者"一级页（plan §D24）。不联动任何 gated 字段的真假状态。
 * - plotAdvanced：编辑剧情推进预设抽屉中的"匹配替换"字段（sulv1-4 / zhaohui）
 *   是否显示。开关 UI 在开发者一级页内；与总开关相互独立。
 * - vectorIndexAdvanced：历史字段，仅保留持久化兼容；交火参数面板已并入填表工作台且不再受其控制。
 * - legacyUiMenuVisible：SillyTavern 扩展菜单中的旧 UI 入口是否显示，默认隐藏。
 * - warnLogEnabled：WARN 日志是否输出并写入运行日志，默认关闭。
 *
 * 新 UI 自有持久化，物理隔离于 settings_ACU。
 */
import { defineStore } from 'pinia';
import { applyLegacyUiMenuVisibility } from '../../shared/legacy-ui-menu-entry';
import { setWarnLogEnabled as applyWarnLogEnabled } from '../../shared/log-buffer';
import { readSection, writeSection } from './persistence';

const SECTION_KEY = 'devOptions';

export interface DevOptionsState {
  /** 总开关：仅控制 sidebar 是否显示"开发者"一级页（plan §D24）。 */
  developerOptionsEnabled: boolean;
  /** 编辑剧情推进预设抽屉中的"匹配替换"字段是否显示。与 developerOptionsEnabled 相互独立。 */
  plotAdvanced: boolean;
  /** 历史字段，仅保留持久化兼容；与 developerOptionsEnabled 相互独立。 */
  vectorIndexAdvanced: boolean;
  /** SillyTavern 扩展菜单中的旧 UI 入口是否显示。默认隐藏。 */
  legacyUiMenuVisible: boolean;
  /** WARN 日志是否输出并写入运行日志。默认关闭。 */
  warnLogEnabled: boolean;
}

interface PersistedShape {
  developerOptionsEnabled?: unknown;
  plotAdvanced?: unknown;
  vectorIndexAdvanced?: unknown;
  legacyUiMenuVisible?: unknown;
  warnLogEnabled?: unknown;
}

function loadFromStorage(): DevOptionsState {
  const raw = readSection<PersistedShape>(SECTION_KEY) ?? {};
  return {
    developerOptionsEnabled: raw.developerOptionsEnabled === true,
    plotAdvanced: raw.plotAdvanced === true,
    vectorIndexAdvanced: raw.vectorIndexAdvanced === true,
    legacyUiMenuVisible: raw.legacyUiMenuVisible === true,
    warnLogEnabled: raw.warnLogEnabled === true,
  };
}

function persist(state: DevOptionsState): void {
  writeSection(SECTION_KEY, {
    developerOptionsEnabled: state.developerOptionsEnabled,
    plotAdvanced: state.plotAdvanced,
    vectorIndexAdvanced: state.vectorIndexAdvanced,
    legacyUiMenuVisible: state.legacyUiMenuVisible,
    warnLogEnabled: state.warnLogEnabled,
  });
}

export const useDevOptionsStore = defineStore('acu-v2-dev-options', {
  state: (): DevOptionsState => {
    const state = loadFromStorage();
    applyWarnLogEnabled(state.warnLogEnabled);
    return state;
  },
  actions: {
    setDeveloperOptionsEnabled(enabled: boolean): void {
      this.developerOptionsEnabled = !!enabled;
      persist(this.$state);
    },
    setPlotAdvanced(enabled: boolean): void {
      this.plotAdvanced = !!enabled;
      persist(this.$state);
    },
    setVectorIndexAdvanced(enabled: boolean): void {
      this.vectorIndexAdvanced = !!enabled;
      persist(this.$state);
    },
    setLegacyUiMenuVisible(enabled: boolean): void {
      this.legacyUiMenuVisible = !!enabled;
      persist(this.$state);
      applyLegacyUiMenuVisibility(this.legacyUiMenuVisible);
    },
    setWarnLogEnabled(enabled: boolean): void {
      this.warnLogEnabled = !!enabled;
      applyWarnLogEnabled(this.warnLogEnabled);
      persist(this.$state);
    },
    refresh(): void {
      const next = loadFromStorage();
      this.developerOptionsEnabled = next.developerOptionsEnabled;
      this.plotAdvanced = next.plotAdvanced;
      this.vectorIndexAdvanced = next.vectorIndexAdvanced;
      this.legacyUiMenuVisible = next.legacyUiMenuVisible;
      this.warnLogEnabled = next.warnLogEnabled;
      applyLegacyUiMenuVisibility(this.legacyUiMenuVisible);
      applyWarnLogEnabled(this.warnLogEnabled);
    },
  },
});
