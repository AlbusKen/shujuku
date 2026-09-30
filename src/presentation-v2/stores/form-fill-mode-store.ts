/**
 * form-fill-mode-store — 填表工作台的模式选择视图。
 *
 * 模式与经典/向量/LLM 参数的权威来源是 globalMeta.formFillPreferencesGlobal（service 层），
 * 交火参数的权威来源是 vectorMemoryConfigGlobal；本 store 只做读写代理，不另存副本。
 * 保存失败时回读权威存储并暴露 saveError，不把未落盘的值显示成已保存。
 */
import { defineStore } from 'pinia';
import {
  readFillModePreferences_ACU,
  saveFillModePreferences_ACU,
  type FillMode_ACU,
  type FillModePreferences_ACU,
} from '../../service/fill-mode/fill-mode-preferences';
import {
  getCurrentVectorMemoryConfig_ACU,
  updateGlobalVectorMemoryConfigFields_ACU,
} from '../../service/vector/vector-memory-config';

export type FillMode = FillMode_ACU;

export interface CrossfireFillProfile {
  keywordGenerationEnabled: boolean;
  hybridRetrievalEnabled: boolean;
  topK: number;
  recentFixedInjectCount: number;
}

export interface FormFillProfiles {
  classic: FillModePreferences_ACU['classic'];
  vector: FillModePreferences_ACU['vector'];
  llm: FillModePreferences_ACU['llm'];
  crossfire: CrossfireFillProfile;
}

interface FormFillModeState {
  selectedMode: FillMode;
  profiles: FormFillProfiles;
  saveError: string | null;
  crossfireLoadError: string | null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function readCrossfire(): { profile: CrossfireFillProfile; error: string | null } {
  try {
    const config: any = getCurrentVectorMemoryConfig_ACU();
    return {
      profile: {
        keywordGenerationEnabled: config.keywordGenerationEnabled !== false,
        hybridRetrievalEnabled: config.hybridRetrievalEnabled !== false,
        topK: clampInteger(config.topK, 200, 1, 1000),
        recentFixedInjectCount: clampInteger(config.recentFixedInjectCount, 50, 1, 1000),
      },
      error: null,
    };
  } catch (error) {
    return {
      profile: { keywordGenerationEnabled: true, hybridRetrievalEnabled: true, topK: 200, recentFixedInjectCount: 50 },
      error: `交火配置读取失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readState(): FormFillModeState {
  const { preferences } = readFillModePreferences_ACU();
  const crossfire = readCrossfire();
  return {
    selectedMode: preferences.selectedMode,
    profiles: {
      classic: { ...preferences.classic },
      vector: { ...preferences.vector },
      llm: { ...preferences.llm },
      crossfire: crossfire.profile,
    },
    saveError: null,
    crossfireLoadError: crossfire.error,
  };
}

export const useFormFillModeStore = defineStore('acu-v2-form-fill-mode', {
  state: (): FormFillModeState => readState(),
  getters: {
    selectedProfile: (state): FormFillProfiles[FillMode] => state.profiles[state.selectedMode],
  },
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
    setCrossfireField(field: keyof CrossfireFillProfile, value: boolean | number): void {
      const patch: Record<string, boolean | number> = {};
      if (field === 'keywordGenerationEnabled' || field === 'hybridRetrievalEnabled') {
        patch[field] = value === true;
      } else if (field === 'topK') {
        patch.topK = clampInteger(value, 200, 1, 1000);
      } else if (field === 'recentFixedInjectCount') {
        patch.recentFixedInjectCount = clampInteger(value, 50, 1, 1000);
      } else {
        return;
      }
      const result = updateGlobalVectorMemoryConfigFields_ACU(patch as any);
      this.saveError = result.ok ? null : (result.message || '交火配置保存失败，已回滚。');
      const crossfire = readCrossfire();
      this.profiles.crossfire = crossfire.profile;
      this.crossfireLoadError = crossfire.error;
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
      this.profiles.classic = next.profiles.classic;
      this.profiles.vector = next.profiles.vector;
      this.profiles.llm = next.profiles.llm;
      this.saveError = result.error;
    },
    refresh(): void {
      const next = readState();
      this.selectedMode = next.selectedMode;
      this.profiles = next.profiles;
      this.crossfireLoadError = next.crossfireLoadError;
    },
  },
});

export const FORM_FILL_MODE_OPTIONS = [
  { value: 'classic', label: '经典表格' },
  { value: 'vector', label: '向量表格' },
  { value: 'llm', label: 'LLM 逻辑召回' },
  { value: 'crossfire', label: '交火模式' },
] as const;
