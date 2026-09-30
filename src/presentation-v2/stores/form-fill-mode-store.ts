/**
 * form-fill-mode-store — 填表工作台的模式选择视图。
 *
 * 模式与经典/向量/LLM 参数的权威来源是 globalMeta.formFillPreferencesGlobal（service 层）。
 * 交火参数由填表工作台的交火面板经 useVectorIndexConfig 读写 vectorMemoryConfigGlobal。
 * 本 store 只做读写代理，不另存副本；保存失败时回读权威存储并暴露 saveError。
 */
import { defineStore } from 'pinia';
import {
  readFillModePreferences_ACU,
  saveFillModePreferences_ACU,
  type FillMode_ACU,
  type FillModePreferences_ACU,
} from '../../service/fill-mode/fill-mode-preferences';

export type FillMode = FillMode_ACU;

export interface FormFillProfiles {
  classic: FillModePreferences_ACU['classic'];
  vector: FillModePreferences_ACU['vector'];
  llm: FillModePreferences_ACU['llm'];
}

interface FormFillModeState {
  selectedMode: FillMode;
  profiles: FormFillProfiles;
  saveError: string | null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function readState(): FormFillModeState {
  const { preferences } = readFillModePreferences_ACU();
  return {
    selectedMode: preferences.selectedMode,
    profiles: {
      classic: { ...preferences.classic },
      vector: { ...preferences.vector },
      llm: { ...preferences.llm },
    },
    saveError: null,
  };
}

export const useFormFillModeStore = defineStore('acu-v2-form-fill-mode', {
  state: (): FormFillModeState => readState(),
  actions: {
    selectMode(mode: FillMode): void {
      if (mode === this.selectedMode) return;
      this.selectedMode = mode;
      this.persistPreferences();
    },
    setClassicRecentChronicleRows(value: number): void {
      this.profiles.classic.recentChronicleRows = clampInteger(value, 15, 1, 200);
      this.persistPreferences();
    },
    setVectorResultCount(value: number): void {
      this.profiles.vector.resultCount = clampInteger(value, 200, 1, 1000);
      this.persistPreferences();
    },
    setLlmApiPresetName(value: string): void {
      this.profiles.llm.apiPresetName = String(value || '').trim();
      this.persistPreferences();
    },
    persistPreferences(): void {
      const result = saveFillModePreferences_ACU({
        schemaVersion: 1,
        selectedMode: this.selectedMode,
        classic: { ...this.profiles.classic },
        vector: { ...this.profiles.vector },
        llm: { ...this.profiles.llm },
      });
      if (!('error' in result)) {
        this.saveError = null;
        return;
      }
      const next = readState();
      this.selectedMode = next.selectedMode;
      this.profiles = next.profiles;
      this.saveError = result.error;
    },
    refresh(): void {
      const next = readState();
      this.selectedMode = next.selectedMode;
      this.profiles = next.profiles;
    },
  },
});

export const FORM_FILL_MODE_OPTIONS: Array<{ value: FillMode; label: string }> = [
  { value: 'classic', label: '经典表格' },
  { value: 'vector', label: '向量表格' },
  { value: 'llm', label: 'LLM 逻辑召回' },
  { value: 'crossfire', label: '交火模式' },
];
