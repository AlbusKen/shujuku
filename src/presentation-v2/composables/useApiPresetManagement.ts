import {
  API_PROMPT_POST_PROCESSING_DEFAULT_ACU,
  CUSTOM_API_FORMAT_DEFAULT_ACU,
  normalizeCustomApiFormat_ACU,
  normalizePromptPostProcessing_ACU,
  type ApiPromptPostProcessingValue_ACU,
  type CustomApiFormat_ACU,
} from '../../service/settings/api-preset-service';
import type { AcuV2ApiMode, AcuV2ApiPreset } from '../stores/api-preset-store';

export interface ApiPresetDraft {
  name: string;
  apiMode: AcuV2ApiMode;
  useMainApi: boolean;
  url: string;
  apiKey: string;
  model: string;
  max_tokens: number;
  temperature: number;
  tavernProfile: string;
  bodyParams: string;
  excludeBodyParams: string;
  requestHeaders: string;
  promptPostProcessing: ApiPromptPostProcessingValue_ACU;
  /** 接口协议（预设级）：openai_compat / openai_responses / claude_messages / gemini_interactions */
  customApiFormat: CustomApiFormat_ACU;
}

/** Effective connection mode — flattens apiMode + useMainApi into 3 user-visible states. */
export type ConnectionMode = 'main' | 'custom' | 'tavern';

export function connectionModeFromDraft(draft: ApiPresetDraft): ConnectionMode {
  if (draft.apiMode === 'tavern') return 'tavern';
  return draft.useMainApi ? 'main' : 'custom';
}

export function applyConnectionMode(draft: ApiPresetDraft, mode: ConnectionMode): void {
  if (mode === 'tavern') {
    draft.apiMode = 'tavern';
    draft.useMainApi = false;
  } else if (mode === 'main') {
    draft.apiMode = 'custom';
    draft.useMainApi = true;
  } else {
    draft.apiMode = 'custom';
    draft.useMainApi = false;
  }
}

export function createEmptyApiPresetDraft(): ApiPresetDraft {
  return {
    name: '',
    apiMode: 'custom',
    useMainApi: true,
    url: '',
    apiKey: '',
    model: '',
    max_tokens: 60000,
    temperature: 1,
    tavernProfile: '',
    bodyParams: '',
    excludeBodyParams: '',
    requestHeaders: '',
    promptPostProcessing: API_PROMPT_POST_PROCESSING_DEFAULT_ACU,
    customApiFormat: CUSTOM_API_FORMAT_DEFAULT_ACU,
  };
}

export function apiPresetDraftFromPreset(preset: AcuV2ApiPreset): ApiPresetDraft {
  return {
    name: preset.name,
    apiMode: preset.apiMode,
    useMainApi: preset.apiConfig.useMainApi !== false,
    url: preset.apiConfig.url || '',
    apiKey: preset.apiConfig.apiKey || '',
    model: preset.apiConfig.model || '',
    max_tokens: Number(preset.apiConfig.max_tokens || 60000),
    temperature: Number(preset.apiConfig.temperature ?? 1),
    tavernProfile: preset.tavernProfile || '',
    bodyParams: preset.apiConfig.bodyParams || '',
    excludeBodyParams: preset.apiConfig.excludeBodyParams || '',
    requestHeaders: preset.apiConfig.requestHeaders || '',
    // 草稿与请求体必须用同一套归一化：旧预设缺失该字段时运行时按 strict 发送，
    // 草稿若显示为「未选择」，用户直接保存就会把行为静默改成 none。
    promptPostProcessing: normalizePromptPostProcessing_ACU(preset.apiConfig.promptPostProcessing),
    customApiFormat: normalizeCustomApiFormat_ACU(preset.apiConfig.customApiFormat),
  };
}

export function apiPresetFromDraft(draft: ApiPresetDraft): AcuV2ApiPreset {
  return {
    name: draft.name.trim(),
    apiMode: draft.apiMode,
    tavernProfile: draft.tavernProfile.trim(),
    apiConfig: {
      url: draft.url.trim(),
      apiKey: draft.apiKey,
      model: draft.model.trim(),
      useMainApi: draft.useMainApi,
      max_tokens: Math.max(1, Math.floor(Number(draft.max_tokens) || 60000)),
      temperature: Number.isFinite(Number(draft.temperature)) ? Number(draft.temperature) : 1,
      bodyParams: draft.bodyParams || '',
      excludeBodyParams: draft.excludeBodyParams || '',
      requestHeaders: draft.requestHeaders || '',
      promptPostProcessing: normalizePromptPostProcessing_ACU(draft.promptPostProcessing),
      customApiFormat: normalizeCustomApiFormat_ACU(draft.customApiFormat),
    },
  };
}
