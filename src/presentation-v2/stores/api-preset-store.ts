/**
 * api-preset-store — API 页状态边界（阶段 1 / D17，阶段 B 重构）
 *
 * Vue 组件只读写本 store；本 store 是 service 的薄包装。
 * 所有写操作委托 service/api-preset-service，不再直接改 settings_ACU。
 * 保存失败时 service 已回滚内存，store 同步恢复快照并传播失败结果。
 */
import { defineStore } from 'pinia';
import { settings_ACU } from '../../service/runtime/state-manager';
import {
  ensureApiSettingsShape_ACU,
  findPresetByName_ACU,
  getActiveApiPresetName_ACU,
  getCurrentChatKey_ACU,
  normalizeApiMode_ACU,
  normalizeApiConfig_ACU,
  saveApiPreset_ACU,
  saveCurrentConfigAsPreset_ACU,
  deleteApiPreset_ACU,
  setActivePresetForCurrentChat_ACU,
  setDefaultApiPreset_ACU,
  setStreamingEnabled_ACU,
  type ApiPreset_ACU,
  type ApiPresetApiConfig_ACU,
  type ApiPresetApiMode_ACU,
  type ApiPresetBinding_ACU,
  type ApiPresetWriteResult_ACU,
} from '../../service/settings/api-preset-service';
import { fetchAvailableModels_ACU, getConnectionManagerProfiles_ACU } from '../../service/ai/ai-service';

export type AcuV2ApiMode = ApiPresetApiMode_ACU;

export interface AcuV2ApiConfig extends ApiPresetApiConfig_ACU {}

export interface AcuV2ApiPreset extends ApiPreset_ACU {}

export interface AcuV2ApiPresetBinding extends ApiPresetBinding_ACU {}

interface ApiPresetState {
  presets: AcuV2ApiPreset[];
  defaultApiPresetName: string;
  activePresetName: string;
  currentConfigReady: boolean;
  currentConfigLabel: string;
  currentChatKey: string;
  streamingEnabled: boolean;
  tavernProfiles: Array<{ id: string; name: string }>;
  modelOptions: string[];
  modelLoadStatus: 'idle' | 'loading' | 'success' | 'error';
  modelLoadError: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function resolveCurrentConfigStatus(): { ready: boolean; label: string } {
  ensureApiSettingsShape_ACU();
  const mode = normalizeApiMode_ACU(settings_ACU.apiMode);
  const config = normalizeApiConfig_ACU(settings_ACU.apiConfig);
  const tavernProfile = typeof settings_ACU.tavernProfile === 'string'
    ? settings_ACU.tavernProfile.trim()
    : '';

  if (mode === 'tavern') {
    return tavernProfile
      ? { ready: true, label: `酒馆连接预设 ${tavernProfile}` }
      : { ready: false, label: '未选择酒馆连接预设' };
  }

  if (config.useMainApi) {
    return { ready: true, label: '酒馆主 API' };
  }

  if (config.url.trim() && config.model.trim()) {
    return { ready: true, label: config.model.trim() };
  }

  return { ready: false, label: '当前 API 配置不完整' };
}

export const useApiPresetStore = defineStore('acu-v2-api-presets', {
  state: (): ApiPresetState => ({
    presets: [],
    defaultApiPresetName: '',
    activePresetName: '',
    currentConfigReady: false,
    currentConfigLabel: '当前 API 配置不完整',
    currentChatKey: getCurrentChatKey_ACU(),
    streamingEnabled: false,
    tavernProfiles: [],
    modelOptions: [],
    modelLoadStatus: 'idle',
    modelLoadError: '',
  }),
  getters: {
    defaultPreset(state): AcuV2ApiPreset | null {
      return findPresetByName_ACU(state.presets, state.defaultApiPresetName);
    },
    activePreset(state): AcuV2ApiPreset | null {
      return findPresetByName_ACU(state.presets, state.activePresetName);
    },
    hasPresets(state): boolean {
      return state.presets.length > 0;
    },
  },
  actions: {
    /**
     * 仅刷新展示用状态。只读消费 service 快照，不写回运行配置。
     * 聊天切换后的运行配置投影由 service 层 reconcile（loadSettings_ACU 末尾）完成。
     */
    refreshFromSettings(): void {
      ensureApiSettingsShape_ACU();
      this.currentChatKey = getCurrentChatKey_ACU();
      this.presets = clone(settings_ACU.apiPresets);
      const defaultName = findPresetByName_ACU(this.presets, settings_ACU.defaultApiPresetName)
        ? settings_ACU.defaultApiPresetName
        : '';
      this.defaultApiPresetName = defaultName;

      this.activePresetName = getActiveApiPresetName_ACU(this.currentChatKey);
      const currentConfig = resolveCurrentConfigStatus();
      this.currentConfigReady = currentConfig.ready;
      this.currentConfigLabel = currentConfig.label;
      this.streamingEnabled = settings_ACU.streamingEnabled === true;
    },
    /** 应用写操作结果：成功与失败都同步展示态（失败时 service 已回滚内存）；返回 boolean 保持旧契约。 */
    applyWriteResult(result: ApiPresetWriteResult_ACU): boolean {
      this.refreshFromSettings();
      return result.ok === true;
    },
    setStreamingEnabled(enabled: boolean): boolean {
      return this.applyWriteResult(setStreamingEnabled_ACU(enabled));
    },
    setDefaultPreset(name: string): boolean {
      return this.applyWriteResult(setDefaultApiPreset_ACU(name));
    },
    setActivePresetForCurrentChat(name: string): boolean {
      return this.applyWriteResult(setActivePresetForCurrentChat_ACU(name));
    },
    savePreset(presetInput: AcuV2ApiPreset, originalName = ''): boolean {
      return this.applyWriteResult(saveApiPreset_ACU(presetInput, originalName));
    },
    saveCurrentConfigAsPreset(name: string): boolean {
      return this.applyWriteResult(saveCurrentConfigAsPreset_ACU(name));
    },
    deletePreset(name: string): boolean {
      return this.applyWriteResult(deleteApiPreset_ACU(name));
    },
    refreshTavernProfiles(): void {
      try {
        const profiles = getConnectionManagerProfiles_ACU() || [];
        this.tavernProfiles = profiles
          .filter((profile: any) => profile?.id)
          .map((profile: any) => ({ id: String(profile.id), name: String(profile.name || profile.id) }));
      } catch {
        this.tavernProfiles = [];
      }
    },
    async loadModelsForConfig(apiConfig: Partial<AcuV2ApiConfig>): Promise<boolean> {
      this.modelLoadStatus = 'loading';
      this.modelLoadError = '';
      const result = await fetchAvailableModels_ACU(String(apiConfig.url || ''), String(apiConfig.apiKey || ''), apiConfig);
      if (!result.success) {
        this.modelOptions = [];
        this.modelLoadStatus = 'error';
        this.modelLoadError = result.error || '模型列表加载失败';
        return false;
      }
      this.modelOptions = result.models || [];
      this.modelLoadStatus = 'success';
      return true;
    },
  },
});
