/**
 * API preset draft helpers — 面板内新建/编辑表单的数据转换
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  apiPresetDraftFromPreset,
  apiPresetFromDraft,
  applyConnectionMode,
  connectionModeFromDraft,
  createEmptyApiPresetDraft,
} from '../../../src/presentation-v2/composables/useApiPresetManagement';

describe('api preset draft helpers', () => {
  it('从空白草稿开始新建预设', () => {
    const draft = createEmptyApiPresetDraft();

    expect(draft.name).toBe('');
    expect(draft.apiMode).toBe('custom');
    expect(draft.useMainApi).toBe(true);
    expect(connectionModeFromDraft(draft)).toBe('main');
  });

  it('把预设转换为可编辑草稿', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'preset-a',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://a.test',
        apiKey: 'k',
        model: 'gpt-4',
        useMainApi: false,
        max_tokens: 4096,
        temperature: 0.7,
      },
      tavernProfile: '',
    });

    expect(draft.name).toBe('preset-a');
    expect(draft.url).toBe('https://a.test');
    expect(draft.model).toBe('gpt-4');
    expect(connectionModeFromDraft(draft)).toBe('custom');
  });

  it('连接方式切换会写回草稿字段', () => {
    const draft = createEmptyApiPresetDraft();

    applyConnectionMode(draft, 'tavern');
    expect(draft.apiMode).toBe('tavern');
    expect(draft.useMainApi).toBe(false);
    expect(connectionModeFromDraft(draft)).toBe('tavern');

    applyConnectionMode(draft, 'custom');
    expect(draft.apiMode).toBe('custom');
    expect(draft.useMainApi).toBe(false);
    expect(connectionModeFromDraft(draft)).toBe('custom');
  });

  it('保存前归一化名称、端点、模型和数字参数', () => {
    const preset = apiPresetFromDraft({
      ...createEmptyApiPresetDraft(),
      name: '  preset-b  ',
      useMainApi: false,
      url: '  https://b.test/v1  ',
      model: '  model-b  ',
      max_tokens: 128.8,
      temperature: Number.NaN,
    });

    expect(preset.name).toBe('preset-b');
    expect(preset.apiConfig.url).toBe('https://b.test/v1');
    expect(preset.apiConfig.model).toBe('model-b');
    expect(preset.apiConfig.max_tokens).toBe(128);
    expect(preset.apiConfig.temperature).toBe(1);
  });

  it('三个附加参数字段在 draft 转换中保留', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'extra',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://x.test',
        apiKey: 'k',
        model: 'm',
        useMainApi: false,
        max_tokens: 1000,
        temperature: 1,
        bodyParams: 'top_k: 50',
        excludeBodyParams: 'top_p',
        requestHeaders: 'X-Custom: val',
      },
      tavernProfile: '',
    });

    expect(draft.bodyParams).toBe('top_k: 50');
    expect(draft.excludeBodyParams).toBe('top_p');
    expect(draft.requestHeaders).toBe('X-Custom: val');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.bodyParams).toBe('top_k: 50');
    expect(preset.apiConfig.excludeBodyParams).toBe('top_p');
    expect(preset.apiConfig.requestHeaders).toBe('X-Custom: val');
  });

  it('旧预设缺失附加参数字段时归一为空字符串', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'old',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://old.test',
        apiKey: '',
        model: 'old-model',
        useMainApi: false,
        max_tokens: 2000,
        temperature: 0.5,
      } as any,
      tavernProfile: '',
    });

    expect(draft.bodyParams).toBe('');
    expect(draft.excludeBodyParams).toBe('');
    expect(draft.requestHeaders).toBe('');
  });

  it('旧预设缺失 promptPostProcessing / customApiFormat 时草稿归一为运行时默认值，而不是「未选择」', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'legacy',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://old.test',
        apiKey: '',
        model: 'old-model',
        useMainApi: false,
        max_tokens: 2000,
        temperature: 0.5,
      } as any,
      tavernProfile: '',
    });

    // 运行时请求体对缺失字段按 strict 发送；草稿若显示「未选择」，用户直接保存就会把行为静默改成 none。
    expect(draft.promptPostProcessing).toBe('strict');
    expect(draft.customApiFormat).toBe('openai_compat');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.promptPostProcessing).toBe('strict');
    expect(preset.apiConfig.customApiFormat).toBe('openai_compat');
  });

  it('提示词后处理与接口协议在草稿转换中往返保留，显式「未选择」（空串）不被改写', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'protocol',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://api.anthropic.com',
        apiKey: 'k',
        model: 'claude',
        useMainApi: false,
        max_tokens: 1000,
        temperature: 1,
        promptPostProcessing: '',
        customApiFormat: 'claude_messages',
      } as any,
      tavernProfile: '',
    });

    expect(draft.promptPostProcessing).toBe('');
    expect(draft.customApiFormat).toBe('claude_messages');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.promptPostProcessing).toBe('');
    expect(preset.apiConfig.customApiFormat).toBe('claude_messages');
  });

  it('草稿中的非法提示词后处理 / 接口协议值保存时回退默认，不写入预设', () => {
    const preset = apiPresetFromDraft({
      ...createEmptyApiPresetDraft(),
      name: 'invalid',
      useMainApi: false,
      url: 'https://x.test',
      model: 'm',
      promptPostProcessing: 'fake-mode' as any,
      customApiFormat: 'unknown_format' as any,
    });

    expect(preset.apiConfig.promptPostProcessing).toBe('strict');
    expect(preset.apiConfig.customApiFormat).toBe('openai_compat');
  });

  it('空白草稿默认 strict 后处理与兼容 OpenAI 协议', () => {
    const draft = createEmptyApiPresetDraft();

    expect(draft.promptPostProcessing).toBe('strict');
    expect(draft.customApiFormat).toBe('openai_compat');
  });
});
