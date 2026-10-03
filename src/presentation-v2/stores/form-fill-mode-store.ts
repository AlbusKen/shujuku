/**
 * form-fill-mode-store — 填表模式页的视图状态。
 *
 * selectedMode 是当前对话的模式：对话记录优先，未记录时回落偏好模式（service 层 fill-mode-chat-record）。
 * 偏好模式（五角星）与经典/向量参数的权威来源是 globalMeta.formFillPreferencesGlobal。
 * 本 store 只做读写代理，不另存副本；保存失败时回读权威存储并暴露 saveError。
 */
import { defineStore } from 'pinia';
import {
  saveFillModePreferences_ACU,
  VECTOR_CANDIDATE_LIMIT_DEFAULT_ACU,
  VECTOR_MIN_SCORE_DEFAULT_ACU,
  VECTOR_RESULT_COUNT_DEFAULT_ACU,
  type FillMode_ACU,
  type FillModePreferences_ACU,
} from '../../service/fill-mode/fill-mode-preferences';
import {
  resolveCurrentChatFillMode_ACU,
  type ChatFillModeSource_ACU,
} from '../../service/fill-mode/fill-mode-chat-record';
import {
  setCurrentChatFillMode_ACU,
  type SetChatFillModeOptions_ACU,
  type SetChatFillModeResult_ACU,
} from '../../service/fill-mode/fill-mode-chat-switch';
import { isClassicModeActiveForCurrentChat_ACU } from '../../service/fill-mode/fill-mode-chat-record';

export type FillMode = FillMode_ACU;

export interface FormFillProfiles {
  classic: FillModePreferences_ACU['classic'];
  vector: FillModePreferences_ACU['vector'];
}

interface FormFillModeState {
  selectedMode: FillMode;
  modeSource: ChatFillModeSource_ACU;
  /** 当前对话已按经典表格模式运行（大总结表存在）；切出时会删除大总结表。 */
  classicActive: boolean;
  preferredMode: FillMode;
  profiles: FormFillProfiles;
  saveError: string | null;
  switching: boolean;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function clampScore(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function readState(): Omit<FormFillModeState, 'switching' | 'saveError'> {
  const current = resolveCurrentChatFillMode_ACU();
  const { preferences } = current.preferences;
  return {
    selectedMode: current.mode,
    modeSource: current.source,
    classicActive: isClassicModeActiveForCurrentChat_ACU(),
    preferredMode: preferences.selectedMode,
    profiles: {
      classic: { ...preferences.classic },
      vector: { ...preferences.vector },
    },
  };
}


export const useFormFillModeStore = defineStore('acu-v2-form-fill-mode', {
  state: (): FormFillModeState => ({ ...readState(), saveError: null, switching: false }),
  actions: {
    /** 切换当前对话的模式；被拒绝时不改动视图，由调用方提示原因。 */
    async selectMode(mode: FillMode, options: SetChatFillModeOptions_ACU = {}): Promise<SetChatFillModeResult_ACU> {
      this.switching = true;
      try {
        const result = await setCurrentChatFillMode_ACU(mode, options);
        // 切换会改动飞行模式与模板，成功或失败都以权威存储回读。
        this.refresh();
        return result;
      } finally {
        this.switching = false;
      }
    },
    /** 五角星：设置新对话的偏好模式（全局保存），不改动当前对话已记录的模式。 */
    setPreferredMode(mode: FillMode): void {
      if (mode === this.preferredMode) return;
      this.preferredMode = mode;
      this.persistPreferences();
      if (this.modeSource !== 'chat') this.selectedMode = this.preferredMode;
    },
    setClassicRecentChronicleRows(value: number): void {
      this.profiles.classic.recentChronicleRows = clampInteger(value, 15, 1, 200);
      this.persistPreferences();
    },
    setVectorResultCount(value: number): void {
      this.profiles.vector.resultCount = clampInteger(value, VECTOR_RESULT_COUNT_DEFAULT_ACU, 1, 1000);
      this.persistPreferences();
    },
    setVectorMinScore(value: number): void {
      this.profiles.vector.minScore = clampScore(value, VECTOR_MIN_SCORE_DEFAULT_ACU);
      this.persistPreferences();
    },
    setVectorCandidateLimit(value: number): void {
      this.profiles.vector.candidateLimit = clampInteger(value, VECTOR_CANDIDATE_LIMIT_DEFAULT_ACU, 1, 5000);
      this.persistPreferences();
    },
    persistPreferences(): void {
      const result = saveFillModePreferences_ACU({
        schemaVersion: 1,
        selectedMode: this.preferredMode,
        classic: { ...this.profiles.classic },
        vector: { ...this.profiles.vector },
      });
      if (!('error' in result)) {
        this.saveError = null;
        return;
      }
      this.refresh();
      this.saveError = result.error;
    },
    refresh(): void {
      Object.assign(this, readState());
    },
  },
});

export const FORM_FILL_MODE_OPTIONS: Array<{ value: FillMode; label: string }> = [
  { value: 'classic', label: '经典表格模式' },
  { value: 'vector', label: '向量表格模式' },
  { value: 'llm', label: 'LLM模型逻辑召回模式' },
  { value: 'crossfire', label: '交火模式' },
];
