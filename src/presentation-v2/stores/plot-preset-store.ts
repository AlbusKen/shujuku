/**
 * plot-preset-store — 剧情推进页状态边界（D23）
 *
 * Vue 组件只读写本 store；旧 settings_ACU 与 service 调用集中在这里。
 * 与 api-preset-store 一致：单下拉、当前活动 / 全局默认、抽屉里增删改。
 */
import { defineStore } from 'pinia';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU, setGlobalPlotEnabled_ACU } from '../../service/settings/settings-service';
import { setFeatureApiPreset_ACU } from '../../service/settings/feature-preset-reference-service';
import { DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import {
  applyGlobalPlotPresetSelectionForEditor_ACU,
  applyPlotPresetToSettings_ACU,
  clearPlotPresetBindingForChat_ACU,
  ensurePlotTasksCompat_ACU,
  getCurrentRuntimePlotPresetName_ACU,
  getPlotPresetBindingForChat_ACU,
  isDefaultPlotPresetSelection_ACU,
  normalizePlotPresetExcludeRules_ACU,
  normalizePlotPresetSelectionValue_ACU,
  persistPlotPresetSelectionState_ACU,
  resetPlotSettingsToDefault_ACU,
  stripPlotPresetWorldbookEntrySelectionForExport_ACU,
  switchCurrentChatPlotPreset_ACU,
} from '../../service/plot/plot-logic';

/** 剧情推进预设的 v2 视图。绝大多数字段透明转发，仅取一个 name 做唯一键。 */
export interface AcuV2PlotPreset {
  name: string;
  /** 完整的 normalized preset 数据，供抽屉编辑 / 导出 / 直接 apply。 */
  raw: Record<string, any>;
}

interface PlotPresetState {
  /** 启用开关（绑定 settings_ACU.plotSettings.enabled）。 */
  enabled: boolean;
  /** 等待期解除发送伪装；独立全局设置，不随预设切换。 */
  sendDisguiseDisabled: boolean;
  /** 已注册全局预设。 */
  presets: AcuV2PlotPreset[];
  /** 全局默认预设名（用于"新聊天默认继承"）。 */
  defaultPresetName: string;
  /** 当前聊天实际生效的预设名。空串 = 跟随全局。 */
  activePresetName: string;
  /** 当前页生效的剧情推进 API 预设名（D23.4 第二层）。空串 = 跟随当前活动 API。 */
  pageApiPresetName: string;
  /** 任务 API 单独选择表：taskId -> presetName。 */
  taskApiOverrides: Record<string, string>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function ensureSettingsShape(): void {
  if (!settings_ACU || typeof settings_ACU !== 'object') return;
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object') {
    settings_ACU.plotSettings = {};
  }
  const plot = settings_ACU.plotSettings as Record<string, any>;
  if (!Array.isArray(plot.promptPresets)) plot.promptPresets = [];
  if (typeof plot.lastUsedPresetName !== 'string') plot.lastUsedPresetName = '';
  plot.enabled = plot.enabled === true;
  ensurePlotTasksCompat_ACU(plot, { syncLegacy: true });

  if (typeof settings_ACU.plotApiPreset !== 'string') settings_ACU.plotApiPreset = '';
  if (
    !settings_ACU.plotTaskApiPresetOverridesById ||
    typeof settings_ACU.plotTaskApiPresetOverridesById !== 'object' ||
    Array.isArray(settings_ACU.plotTaskApiPresetOverridesById)
  ) {
    settings_ACU.plotTaskApiPresetOverridesById = {};
  }
}

function readPresetList(): AcuV2PlotPreset[] {
  ensureSettingsShape();
  const rawList = (settings_ACU.plotSettings as Record<string, any>).promptPresets as any[];
  if (!Array.isArray(rawList)) return [];
  const seen = new Set<string>();
  const out: AcuV2PlotPreset[] = [];
  for (const raw of rawList) {
    const normalized = normalizePlotPresetExcludeRules_ACU(raw);
    if (!normalized || typeof normalized !== 'object') continue;
    const name = String(normalized.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, raw: clone(normalized) });
  }
  return out;
}

function findPresetIndex(presets: AcuV2PlotPreset[], name: string): number {
  const normalized = String(name || '').trim();
  if (!normalized) return -1;
  return presets.findIndex(p => p.name === normalized);
}

export const PLOT_RATE_FIELDS = ['rateMain', 'ratePersonal', 'rateErotic', 'rateCuckold', 'recallCount'] as const;
export type PlotRateField = (typeof PLOT_RATE_FIELDS)[number];

export function getDefaultPlotRateValueForV2(field: PlotRateField): number {
  const n = Number((DEFAULT_PLOT_SETTINGS_ACU as Record<string, any>)[field]);
  return Number.isFinite(n) ? n : 0;
}

function coercePlotRateForExport(field: PlotRateField, value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : getDefaultPlotRateValueForV2(field);
}

function stripDefaultPlotRatesForV2Export(target: Record<string, any>): void {
  if (!target || typeof target !== 'object') return;
  for (const field of PLOT_RATE_FIELDS) {
    if (coercePlotRateForExport(field, target[field]) === getDefaultPlotRateValueForV2(field)) {
      delete target[field];
    }
  }
}

function normalizeImportedPresetPayloads(parsed: unknown): Record<string, any>[] {
  if (!Array.isArray(parsed)) return [];
  const out: Record<string, any>[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const name = String((candidate as Record<string, any>).name || '').trim();
    if (!name) continue;
    const normalized = normalizePlotPresetExcludeRules_ACU({ ...(candidate as Record<string, any>), name });
    if (normalized && typeof normalized === 'object') out.push(normalized);
  }
  return out;
}

export function getDefaultPlotPresetRawForV2(): Record<string, any> {
  const normalized = normalizePlotPresetExcludeRules_ACU({
    ...clone(DEFAULT_PLOT_SETTINGS_ACU),
    name: '',
  });
  return clone(normalized && typeof normalized === 'object' ? normalized : { name: '', plotTasks: [] });
}

export const usePlotPresetStore = defineStore('acu-v2-plot-presets', {
  state: (): PlotPresetState => ({
    enabled: false,
    sendDisguiseDisabled: false,
    presets: [],
    defaultPresetName: '',
    activePresetName: '',
    pageApiPresetName: '',
    taskApiOverrides: {},
  }),
  getters: {
    activePreset(state): AcuV2PlotPreset | null {
      const idx = findPresetIndex(state.presets, state.activePresetName);
      return idx >= 0 ? state.presets[idx] : null;
    },
    defaultPreset(state): AcuV2PlotPreset | null {
      const idx = findPresetIndex(state.presets, state.defaultPresetName);
      return idx >= 0 ? state.presets[idx] : null;
    },
    defaultPresetTaskCount(): number {
      const raw = getDefaultPlotPresetRawForV2();
      return Array.isArray(raw.plotTasks) ? raw.plotTasks.length : 0;
    },
    /** 当前聊天选择是否偏离全局默认（与跟随全局相反）。 */
    isChatOverridden(state): boolean {
      return normalizePlotPresetSelectionValue_ACU(state.activePresetName) !== normalizePlotPresetSelectionValue_ACU(state.defaultPresetName);
    },
    hasPresets(state): boolean {
      return state.presets.length > 0;
    },
  },
  actions: {
    refreshFromSettings(): void {
      ensureSettingsShape();
      const plot = settings_ACU.plotSettings as Record<string, any>;
      this.enabled = plot.enabled === true;
      this.sendDisguiseDisabled = settings_ACU.plotSendDisguiseDisabled === true;
      this.presets = readPresetList();
      const defaultName = normalizePlotPresetSelectionValue_ACU(plot.lastUsedPresetName || '');
      this.defaultPresetName = findPresetIndex(this.presets, defaultName) >= 0 ? defaultName : '';
      this.activePresetName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
      this.pageApiPresetName = String(settings_ACU.plotApiPreset || '');
      const overrides = (settings_ACU.plotTaskApiPresetOverridesById || {}) as Record<string, any>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === 'string' && v.trim()) cleaned[k] = v.trim();
      }
      this.taskApiOverrides = cleaned;
    },

    /** 设置剧情推进总开关。 */
    setEnabled(enabled: boolean): void {
      const next = !!enabled;
      this.enabled = next;
      try {
        setGlobalPlotEnabled_ACU(next);
      } catch {
        if (settings_ACU.plotSettings) (settings_ACU.plotSettings as Record<string, any>).enabled = next;
      }
      saveSettings_ACU();
    },

    setSendDisguiseDisabled(disabled: boolean): void {
      const previous = settings_ACU.plotSendDisguiseDisabled === true;
      settings_ACU.plotSendDisguiseDisabled = disabled === true;
      try {
        const result = saveSettings_ACU();
        if (result?.saved === false) settings_ACU.plotSendDisguiseDisabled = previous;
      } catch {
        settings_ACU.plotSendDisguiseDisabled = previous;
      }
      this.sendDisguiseDisabled = settings_ACU.plotSendDisguiseDisabled === true;
    },

    /** D23.2：切换"当前聊天使用"——即 PresetDropdown 主操作。 */
    setActivePresetForCurrentChat(name: string): boolean {
      const normalized = normalizePlotPresetSelectionValue_ACU(name);
      const result = switchCurrentChatPlotPreset_ACU(normalized, { source: 'ui_v2', save: true });
      if (!result) return false;
      this.refreshFromSettings();
      return true;
    },

    /** 清除当前聊天 binding，回退到跟随全局。 */
    clearChatOverride(): void {
      clearPlotPresetBindingForChat_ACU();
      saveSettings_ACU();
      this.refreshFromSettings();
    },

    /** D23.2：标记某预设为全局默认。 */
    setDefaultPreset(name: string): boolean {
      if (isDefaultPlotPresetSelection_ACU(name)) {
        const result = applyGlobalPlotPresetSelectionForEditor_ACU('', {
          source: 'ui_v2_set_default',
          save: true,
        });
        if (!result) return false;
        this.refreshFromSettings();
        return true;
      }
      const idx = findPresetIndex(this.presets, name);
      if (idx < 0) return false;
      const result = applyGlobalPlotPresetSelectionForEditor_ACU(this.presets[idx].name, {
        source: 'ui_v2_set_default',
        save: true,
      });
      if (!result) return false;
      this.refreshFromSettings();
      return true;
    },

    /** D23.4 第二层：页面级"剧情推进 API 预设"。空串 = 跟随当前活动 API。 */
    setPageApiPreset(name: string): void {
      const next = String(name || '').trim();
      const result = setFeatureApiPreset_ACU('plot', next);
      if (!result.ok) {
        return; // 校验失败（预设不存在）或保存失败；store 保持原值
      }
      this.pageApiPresetName = next;
    },

    /** D23.4 第一层：任务 API 单独选择。空串清除单独选择。 */
    setTaskApiOverride(taskId: string, presetName: string): void {
      const id = String(taskId || '').trim();
      if (!id) return;
      const next = String(presetName || '').trim();
      const result = setFeatureApiPreset_ACU('plot_task', next, { taskId: id });
      if (!result.ok) {
        return;
      }
      const overrides = (settings_ACU.plotTaskApiPresetOverridesById || {}) as Record<string, any>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === 'string' && v.trim()) cleaned[k] = v.trim();
      }
      this.taskApiOverrides = cleaned;
    },

    /** 创建/覆盖一个全局预设。`originalName` 用于重命名场景。 */
    savePreset(preset: AcuV2PlotPreset, originalName = ''): boolean {
      const newName = String(preset.name || '').trim();
      if (!newName) return false;
      const normalized = normalizePlotPresetExcludeRules_ACU({ ...preset.raw, name: newName });
      if (!normalized) return false;
      ensureSettingsShape();
      const plot = settings_ACU.plotSettings as Record<string, any>;
      const list = (plot.promptPresets as any[]) || [];
      const oldName = String(originalName || '').trim();
      const idxByNew = list.findIndex((p: any) => p?.name === newName);
      const idxByOld = oldName ? list.findIndex((p: any) => p?.name === oldName) : -1;

      if (oldName && oldName !== newName && idxByOld >= 0 && idxByNew < 0) {
        list[idxByOld] = normalized;
      } else if (idxByNew >= 0) {
        list[idxByNew] = normalized;
      } else if (idxByOld >= 0) {
        list[idxByOld] = normalized;
      } else {
        list.push(normalized);
      }

      // 默认预设 / 当前 binding 的重命名同步
      if (oldName && oldName !== newName) {
        if (plot.lastUsedPresetName === oldName) plot.lastUsedPresetName = newName;
        const binding = getPlotPresetBindingForChat_ACU();
        if (binding && binding.presetName === oldName) {
          persistPlotPresetSelectionState_ACU(newName, {
            source: 'ui_v2_rename',
            updateGlobal: false,
            save: false,
            persistChatScope: true,
          });
        }
      }

      // 如果当前活动预设就是被改的这个，把改动 apply 到运行时
      const activeName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
      if (activeName === newName || activeName === oldName) {
        applyPlotPresetToSettings_ACU(plot, normalized);
      }

      saveSettings_ACU();
      this.refreshFromSettings();
      return true;
    },

    /** 删除指定预设。 */
    deletePreset(name: string): boolean {
      const target = String(name || '').trim();
      if (!target) return false;
      ensureSettingsShape();
      const plot = settings_ACU.plotSettings as Record<string, any>;
      const list = (plot.promptPresets as any[]) || [];
      const before = list.length;
      plot.promptPresets = list.filter((p: any) => p?.name !== target);
      if (plot.promptPresets.length === before) return false;
      if (plot.lastUsedPresetName === target) plot.lastUsedPresetName = '';
      const binding = getPlotPresetBindingForChat_ACU();
      if (binding && binding.presetName === target) {
        clearPlotPresetBindingForChat_ACU();
      }
      saveSettings_ACU();
      this.refreshFromSettings();
      return true;
    },

    /** 重置当前 plotSettings 到 defaults（仅运行时，不动 promptPresets）。 */
    resetCurrentToDefaults(): void {
      ensureSettingsShape();
      const plot = settings_ACU.plotSettings as Record<string, any>;
      resetPlotSettingsToDefault_ACU(plot);
      saveSettings_ACU();
      this.refreshFromSettings();
    },

    /** 从旧 UI JSON 文件格式导入预设数组；同名覆盖。返回第一个有效预设名或 null。 */
    importPresetFromJson(json: string): string | null {
      let parsed: any;
      try {
        parsed = JSON.parse(json);
      } catch {
        return null;
      }
      const presetPayloads = normalizeImportedPresetPayloads(parsed);
      if (presetPayloads.length === 0) return null;

      ensureSettingsShape();
      const plot = settings_ACU.plotSettings as Record<string, any>;
      const list = (plot.promptPresets as any[]) || [];
      let firstImportedName = '';

      for (const presetPayload of presetPayloads) {
        const name = String(presetPayload.name || '').trim();
        if (!name) continue;
        const existingIndex = list.findIndex((preset: any) => preset?.name === name);
        if (existingIndex >= 0) {
          list[existingIndex] = presetPayload;
        } else {
          list.push(presetPayload);
        }
        if (!firstImportedName) firstImportedName = name;
      }

      if (!firstImportedName) return null;
      plot.promptPresets = list;
      saveSettings_ACU();
      this.refreshFromSettings();
      return firstImportedName;
    },

    /** 导出指定预设为 JSON。返回 string 或 null（找不到时）。 */
    exportPresetAsJson(name: string): string | null {
      const idx = findPresetIndex(this.presets, name);
      if (idx < 0) return null;
      const exportable = stripPlotPresetWorldbookEntrySelectionForExport_ACU(this.presets[idx].raw);
      stripDefaultPlotRatesForV2Export(exportable);
      return JSON.stringify([exportable], null, 2);
    },
  },
});
