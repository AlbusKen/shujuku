/**
 * tests/service/ai/api-call.test.ts
 * AI 调用编排 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from 'yaml';

const { mockSettings, mockIsGenerateRawAvailable, mockGenerateRaw, mockSendConnectionManager, mockGetHeaders, mockHandleApiResponse, mockGetProfiles, mockTriggerSlash } = vi.hoisted(() => ({
  mockSettings: {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 },
    tavernProfile: 'default',
    plotApiPreset: '',
    streamingEnabled: false,
    apiPresets: [] as any[],
  } as any,
  mockIsGenerateRawAvailable: vi.fn(() => true),
  mockGenerateRaw: vi.fn(),
  mockSendConnectionManager: vi.fn(),
  mockGetHeaders: vi.fn(() => ({ 'X-Custom': 'test' })),
  mockHandleApiResponse: vi.fn(),
  mockGetProfiles: vi.fn(() => [] as any[]),
  mockTriggerSlash: vi.fn(async () => ''),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: mockHandleApiResponse,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  isGenerateRawAvailable_ACU: mockIsGenerateRawAvailable,
  generateRaw_ACU: mockGenerateRaw,
  sendConnectionManagerRequest_ACU: mockSendConnectionManager,
  getHostRequestHeaders_ACU: mockGetHeaders,
  getConnectionManagerProfiles_ACU: mockGetProfiles,
  triggerSlash_ACU: mockTriggerSlash,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

// mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  callApi_ACU,
  callApiWithPlotPreset_ACU,
  callAIWithResolvedPreset_ACU,
  getApiConfigByPreset_ACU,
  callAIWithPreset_ACU,
  callCustomOpenAI_ACU_Direct,
  buildCustomApiRequestBody_ACU,
} from '../../../src/service/ai/api-call';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.apiMode = 'custom';
  mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 4096 };
  mockSettings.tavernProfile = 'default';
  mockSettings.plotApiPreset = '';
  mockSettings.streamingEnabled = false;
  mockSettings.apiPresets = [];
  mockGetProfiles.mockReturnValue([]);
  mockTriggerSlash.mockResolvedValue('');
});

// ═══ getApiConfigByPreset_ACU ═══
describe('getApiConfigByPreset_ACU', () => {
  it('空预设名返回当前配置', () => {
    const config = getApiConfigByPreset_ACU('');
    expect(config.apiMode).toBe('custom');
    expect(config.apiConfig).toBe(mockSettings.apiConfig);
  });

  it('找到预设时返回预设配置', () => {
    mockSettings.apiPresets = [
      { name: '预设A', apiMode: 'tavern', apiConfig: { url: 'http://a.com' }, tavernProfile: 'profileA' },
    ];
    const config = getApiConfigByPreset_ACU('预设A');
    expect(config.apiMode).toBe('tavern');
    expect(config.tavernProfile).toBe('profileA');
  });

  it('预设不存在时回退到当前配置', () => {
    mockSettings.apiPresets = [];
    const config = getApiConfigByPreset_ACU('不存在');
    expect(config.apiMode).toBe('custom');
  });
});

// ═══ callApi_ACU ═══
describe('callApi_ACU', () => {
  it('tavern 模式使用 generateRaw', async () => {
    mockSettings.plotApiPreset = '';
    mockSettings.apiConfig = { useMainApi: true };
    mockGenerateRaw.mockResolvedValue('AI 回复');
    const result = await callApi_ACU([{ role: 'user', content: '你好' }], {});
    expect(result).toBe('AI 回复');
    expect(mockGenerateRaw).toHaveBeenCalled();
  });

  it('generateRaw 不可用时抛错', async () => {
    mockSettings.apiConfig = { useMainApi: true };
    mockIsGenerateRawAvailable.mockReturnValue(false);
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('generateRaw');
  });

  it('自定义 API 模式使用 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('response') });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const result = await callApi_ACU([{ role: 'user', content: '你好' }], {});
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalled();
  });

  it('自定义 API 未配置 URL 时抛错', async () => {
    mockSettings.apiConfig = { url: '', model: 'gpt-4' };
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('URL或模型未配置');
  });

  it('fetch 返回非 ok 时抛错', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4' };
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Internal Error') });
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('500');
  });

  it('handleApiResponse 返回 null 时抛错', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue(null);
    await expect(callApi_ACU([{ role: 'user', content: '你好' }], {})).rejects.toThrow('无效响应');
  });
});

// ═══ callAIWithPreset_ACU ═══
describe('callAIWithPreset_ACU', () => {
  it('空消息数组返回 null', async () => {
    const result = await callAIWithPreset_ACU([]);
    expect(result).toBeNull();
  });

  it('非数组返回 null', async () => {
    const result = await callAIWithPreset_ACU(null as any);
    expect(result).toBeNull();
  });

  it('tavern 模式调用 sendConnectionManagerRequest', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: 'AI 回复' } }] },
    });
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('tavern 模式返回无效响应时返回 null', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({});
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBeNull();
  });

  it('useMainApi 模式使用 generateRaw', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { useMainApi: true };
    mockIsGenerateRawAvailable.mockReturnValue(true);
    mockGenerateRaw.mockResolvedValue('AI 回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('自定义 API 模式使用 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    expect(result).toBe('AI 回复');
  });

  it('指定预设名使用对应预设', async () => {
    mockSettings.apiPresets = [
      { name: '预设B', apiMode: 'tavern', apiConfig: {}, tavernProfile: 'profileB' },
    ];
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: '预设B回复' } }] },
    });
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '预设B');
    expect(result).toBe('预设B回复');
  });

  it('自定义 API 模式把 signal 传给 fetch', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const controller = new AbortController();
    const result = await callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal);
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  });

  it('custom 分支 signal 已 abort 时仍先发请求，handleApiResponse 拒绝中断', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' };
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(
      callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal),
    ).rejects.toThrow();
  });

  it('tavern 分支在 signal 已 abort 且返回后抛 AbortError', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: 'AI 回复' } }] },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      callAIWithPreset_ACU([{ role: 'user', content: '你好' }], '', undefined, controller.signal),
    ).rejects.toThrow('请求已取消');
  });

});

// ═══ callCustomOpenAI_ACU_Direct ═══
describe('callCustomOpenAI_ACU_Direct', () => {
  it('tavern 模式直接发送消息', async () => {
    mockSettings.apiMode = 'tavern';
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: '直接回复' } }] },
    });
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('直接回复');
    expect(mockSendConnectionManager).toHaveBeenCalled();
  });

  it('tavern 模式 max_tokens=0 透传给 sendConnectionManagerRequest', async () => {
    mockSettings.apiMode = 'tavern';
    mockSettings.apiConfig.max_tokens = 0;
    mockSendConnectionManager.mockResolvedValue({
      result: { choices: [{ message: { content: '直接回复' } }] },
    });
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('直接回复');
    expect(mockSendConnectionManager).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      0,
    );
  });
  it('custom 模式且 useMainApi 时使用 generateRaw', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig.useMainApi = true;
    mockGenerateRaw.mockResolvedValue('generateRaw回复');
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('generateRaw回复');
  });
  it('custom 模式且非 useMainApi 时使用 fetch', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig.useMainApi = false;
    mockHandleApiResponse.mockResolvedValue('fetch回复');
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await callCustomOpenAI_ACU_Direct([{ role: 'user', content: '测试' }]);
    expect(result).toBe('fetch回复');
  });
});

// ═══ buildCustomApiRequestBody_ACU ═══
describe('buildCustomApiRequestBody_ACU', () => {
  it('custom_api_format 缺省回退 openai_compat，预设值白名单透传', () => {
    const defaultBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(defaultBody.chat_completion_source).toBe('custom');
    expect(defaultBody.custom_api_format).toBe('openai_compat');

    const claudeBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', customApiFormat: 'claude_messages' as any },
    );
    expect(claudeBody.custom_api_format).toBe('claude_messages');

    const invalidBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', customApiFormat: 'unknown_format' as any },
    );
    expect(invalidBody.custom_api_format).toBe('openai_compat');
  });

  it('max_tokens=0 不被回退为 20000', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 },
    );
    expect(body.max_tokens).toBe(0);
  });

  it('maxTokens 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', maxTokens: 1234 },
    );
    expect(body.max_tokens).toBe(1234);
  });

  it('temperature=0 不被回退为 1.0', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 0 },
    );
    expect(body.temperature).toBe(0);
  });

  it('top_p=0 进入 body.top_p', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', top_p: 0 },
    );
    expect(body.top_p).toBe(0);
  });

  it('topP 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', topP: 0.5 },
    );
    expect(body.top_p).toBe(0.5);
  });

  it('topP=0 驼峰别名生效', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', topP: 0 },
    );
    expect(body.top_p).toBe(0);
  });

  it('bodyParams 作为 SillyTavern custom_include_body 透传给最终 provider', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, top_p: 0.95, max_tokens: 20000, bodyParams: 'temperature:0.3\ntop_p:0.5\nmax_tokens:100' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    expect(body.max_tokens).toBe(20000);
    expect(body.custom_include_body).toBe('temperature:0.3\ntop_p:0.5\nmax_tokens:100');
  });

  it('bodyParams 保留 YAML 对象值给 SillyTavern 解析', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'response_format:\n  type: json_object\nmetadata:\n  source: acu' },
    );
    expect(body.custom_include_body).toBe('response_format:\n  type: json_object\nmetadata:\n  source: acu');
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('metadata');
  });

  it('bodyParams 保留数组和布尔 YAML 给 SillyTavern 解析', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'stop:\n  - </json>\nparallel_tool_calls: false' },
    );
    expect(body.custom_include_body).toBe('stop:\n  - </json>\nparallel_tool_calls: false');
    expect(body).not.toHaveProperty('parallel_tool_calls');
  });

  it('overrides.responseFormat 作为结构化对象注入 custom_include_body', () => {
    const responseFormat = {
      type: 'json_schema',
      json_schema: { name: 'table_edit_ops_response', strict: true, schema: { type: 'object' } },
    };
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
      { responseFormat },
    );
    expect(parse(body.custom_include_body)).toEqual({ response_format: responseFormat });
    // response_format 只走 custom_include_body 合并，不直接挂在请求体顶层。
    expect(body).not.toHaveProperty('response_format');
  });

  it('overrides.responseFormat 与 YAML mapping 共存时按对象语义合并', () => {
    const responseFormat = { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } };
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: 'temperature: 0.3' },
      { responseFormat },
    );
    expect(parse(body.custom_include_body)).toEqual({ temperature: 0.3, response_format: responseFormat });
  });

  it('bodyParams 为 JSON 对象时仍注入插件字段，并保留用户 stream_options 子字段', () => {
    mockSettings.streamingEnabled = true;
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: '{"stop":["</json>"],"stream_options":{"trace":true}}' },
      { promptCacheKey: 'cache-key', includeStreamUsage: true },
    );
    expect(parse(body.custom_include_body)).toEqual({
      stop: ['</json>'],
      stream_options: { trace: true, include_usage: true },
      prompt_cache_key: 'cache-key',
    });
  });

  it('YAML sequence 按 SillyTavern 顺序浅合并对象项，忽略非对象项', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: '- {temperature: 0.2, metadata: {source: first}}\n- ignored\n- {temperature: 0.4, top_p: 0.6}' },
      { promptCacheKey: 'cache-key' },
    );
    expect(parse(body.custom_include_body)).toEqual({
      temperature: 0.4,
      metadata: { source: 'first' },
      top_p: 0.6,
      prompt_cache_key: 'cache-key',
    });
  });

  it('非法 YAML 或标量根节点保留用户原文并跳过插件字段', () => {
    const invalid = 'metadata: [';
    const invalidBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: invalid },
      { promptCacheKey: 'cache-key' },
    );
    const scalar = 'plain scalar';
    const scalarBody = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', bodyParams: scalar },
      { promptCacheKey: 'cache-key' },
    );
    expect(invalidBody.custom_include_body).toBe(invalid);
    expect(scalarBody.custom_include_body).toBe(scalar);
  });

  it('excludeBodyParams 作为 SillyTavern custom_exclude_body 透传', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, excludeBodyParams: 'temperature,top_p' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
    expect(body.custom_exclude_body).toBe('- temperature\n- top_p');
    expect(body).toHaveProperty('max_tokens');
  });

  it('bodyParams 与 excludeBodyParams 分别透传给 SillyTavern 合并与排除', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', temperature: 1.0, bodyParams: 'temperature:0.3', excludeBodyParams: 'temperature' },
    );
    expect(body.temperature).toBe(1.0);
    expect(body.custom_include_body).toBe('temperature:0.3');
    expect(body.custom_exclude_body).toBe('- temperature');
  });



  it('overrides.maxTokens 优先于 effectiveApiConfig', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 9999 },
      { maxTokens: 100 },
    );
    expect(body.max_tokens).toBe(100);
  });

  it('无配置时使用默认值', () => {
    const body = buildCustomApiRequestBody_ACU(
      [{ role: 'user', content: 'test' }],
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.max_tokens).toBe(20000);
    expect(body.temperature).toBe(1.0);
    expect(body.top_p).toBe(0.95);
  });

  it('messages 的 role 以大写 SYSTEM/USER 传入时归一为小写', () => {
    // 回归点：改表助手伪 role 提示词组（buildPseudoRoleTemplateAssistantPromptSegments_ACU）
    // 产出 role 为大写 SYSTEM / USER，自定义 chat-completions 后端只接受小写 role。
    // 此前 messages 被原样透传导致 `unknown variant SYSTEM`。
    const before = [
      { role: 'SYSTEM', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'USER', content: '请改表。' },
    ];
    const body = buildCustomApiRequestBody_ACU(
      before,
      { url: 'https://api.example.com', model: 'gpt-4' },
    );
    expect(body.messages).toEqual([
      { role: 'system', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '请改表。' },
    ]);
    // 不原地修改调用方原始数组与对象
    expect(before).toEqual([
      { role: 'SYSTEM', content: '你是改表助手。' },
      { role: 'assistant', content: '收到。' },
      { role: 'USER', content: '请改表。' },
    ]);
    expect(body.messages).not.toBe(before);
    expect(body.messages[0]).not.toBe(before[0]);
  });

  it('messages 的 role 已为小写时不改变内容，也不改动调用方数组', () => {
    const original = [{ role: 'user', content: '你好' }];
    const body = buildCustomApiRequestBody_ACU(original, { url: 'https://api.example.com', model: 'gpt-4' });
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(original).toEqual([{ role: 'user', content: '你好' }]);
    expect(body.messages).not.toBe(original);
    expect(body.messages[0]).not.toBe(original[0]);
  });

  it('缺失或非字符串 role、数组/原始值等异常消息原样保留，不静默改造成 undefined', () => {
    const input = [
      { content: '缺 role' },
      { role: null, content: 'role 为 null' },
      { role: 123, content: 'role 为数字' },
      ['x'],
      'raw string',
      null,
    ] as any[];
    const body = buildCustomApiRequestBody_ACU(input, { url: 'https://api.example.com', model: 'gpt-4' });
    // 边界契约：仅字符串 role 归一化；缺失/非字符串/数组/原始值原样保留，交由后端校验
    expect(body.messages).toEqual([
      { content: '缺 role' },
      { role: null, content: 'role 为 null' },
      { role: 123, content: 'role 为数字' },
      ['x'],
      'raw string',
      null,
    ]);
  });
});

// ═══ callAIWithPreset_ACU 自定义模式最终发送 body 层面：role 小写化回归 ═══
describe('callAIWithPreset_ACU 自定义模式 role 归一化', () => {
  it('改表助手大写的 SYSTEM/USER 消息在最终 fetch body 中归一为小写', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    const messages = [
      { role: 'SYSTEM', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'USER', content: '以下是全局表格结构：$3' },
    ];
    const result = await callAIWithPreset_ACU(messages, '');
    expect(result).toBe('AI 回复');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.messages).toEqual([
      { role: 'system', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'user', content: '以下是全局表格结构：$3' },
    ]);
    // 调用方原始数组未被原地修改
    expect(messages).toEqual([
      { role: 'SYSTEM', content: '你是 visualizer 内的模板改表助手。' },
      { role: 'USER', content: '以下是全局表格结构：$3' },
    ]);
  });
});

// ═══ callApi_ACU 温度透传 ═══
describe('callApi_ACU 温度透传', () => {
  it('custom 模式 fetch body 使用配置温度，不是 0.7', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0.3, top_p: 0.8, max_tokens: 2048 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApi_ACU([{ role: 'user', content: '你好' }], {});
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.3);
    expect(fetchBody.top_p).toBe(0.8);
    expect(fetchBody.max_tokens).toBe(2048);
  });

  it('custom 模式 temperature=0 进入 fetch body', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApi_ACU([{ role: 'user', content: '你好' }], {});
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0);
  });
});

// ═══ callApiWithPlotPreset_ACU 温度透传 ═══
describe('callApiWithPlotPreset_ACU 温度透传', () => {
  it('custom 模式 fetch body 使用配置温度', async () => {
    mockSettings.plotApiPreset = '';
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0.5, top_p: 0.7 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApiWithPlotPreset_ACU([{ role: 'user', content: '你好' }], '');
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.5);
    expect(fetchBody.top_p).toBe(0.7);
  });

  it('custom 模式指定预设温度进入 fetch body', async () => {
    mockSettings.plotApiPreset = '预设C';
    mockSettings.apiPresets = [
      { name: '预设C', apiMode: 'custom', apiConfig: { url: 'https://api.example.com', model: 'gpt-4', temperature: 0.2, top_p: 0.6 }, tavernProfile: '' },
    ];
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callApiWithPlotPreset_ACU([{ role: 'user', content: '你好' }], '预设C');
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.2);
    expect(fetchBody.top_p).toBe(0.6);
  });
});

describe('callAIWithResolvedPreset_ACU', () => {
  it('uses the supplied custom configuration without resolving a preset again', async () => {
    mockHandleApiResponse.mockResolvedValue('明确配置回复');
    mockFetch.mockResolvedValue({ ok: true });

    await expect(callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: '仅使用候选配置' }],
      { apiMode: 'custom', apiConfig: { url: 'https://resolved.example', apiKey: '', model: 'resolved-model', useMainApi: false, max_tokens: 222, temperature: 0, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: '' },
    )).resolves.toBe('明确配置回复');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('resolved-model');
    expect(body.max_tokens).toBe(222);
    expect(body.temperature).toBe(0);
  });

  it('将合成缓存键、usage 订阅与用户 stream_options 合并后发送给宿主', async () => {
    mockSettings.streamingEnabled = true;
    mockHandleApiResponse.mockResolvedValue('宿主边界回复');
    mockFetch.mockResolvedValue({ ok: true });
    const onUsage = vi.fn();

    await expect(callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: '合成宿主边界验证' }],
      {
        apiMode: 'custom',
        apiConfig: {
          url: 'https://resolved.example', apiKey: '', model: 'resolved-model', useMainApi: false,
          max_tokens: 222, temperature: 0,
          bodyParams: '{"metadata":{"source":"synthetic"},"stream_options":{"trace":true}}',
          excludeBodyParams: '', requestHeaders: '',
        },
        tavernProfile: '',
      },
      undefined,
      { onUsage },
      { promptCacheKey: 'acu-cont-v2-12345678-abcdef01-deadbeef' },
    )).resolves.toBe('宿主边界回复');

    expect(mockFetch).toHaveBeenCalledWith('/api/backends/chat-completions/generate', expect.objectContaining({
      method: 'POST', body: expect.any(String),
    }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parse(body.custom_include_body)).toEqual({
      metadata: { source: 'synthetic' },
      stream_options: { trace: true, include_usage: true },
      prompt_cache_key: 'acu-cont-v2-12345678-abcdef01-deadbeef',
    });
  });

  it('uses the supplied Tavern profile rather than current global settings', async () => {
    mockSettings.tavernProfile = 'global-profile';
    mockGetProfiles.mockReturnValue([{ id: 'resolved-profile', name: '续写渠道', api: 'openai' }]);
    // 有状态的 /profile 替身：查询返回当前活动名，切换命令更新它。
    let activeProfile = '全局渠道';
    mockTriggerSlash.mockImplementation(async (command: string) => {
      if (command === '/profile') return activeProfile;
      const matched = command.match(/^\/profile await=true "(.+)"$/);
      if (matched) activeProfile = matched[1];
      return '';
    });
    mockSendConnectionManager.mockResolvedValue({ result: { choices: [{ message: { content: 'profile reply' } }] } });

    await expect(callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: 'profile request' }],
      { apiMode: 'tavern', apiConfig: { url: '', apiKey: '', model: '', useMainApi: false, max_tokens: 17, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: 'resolved-profile' },
    )).resolves.toBe('profile reply');

    expect(mockSendConnectionManager).toHaveBeenCalledWith('resolved-profile', expect.any(Array), 17);
    // 发送前切换到目标渠道，发送后恢复原渠道，与填表链路行为对齐。
    const slashCommands = mockTriggerSlash.mock.calls.map(call => call[0]);
    expect(slashCommands).toContain('/profile await=true "续写渠道"');
    expect(activeProfile).toBe('全局渠道');
    const switchOrder = mockTriggerSlash.mock.invocationCallOrder[slashCommands.indexOf('/profile await=true "续写渠道"')];
    expect(switchOrder).toBeLessThan(mockSendConnectionManager.mock.invocationCallOrder[0]);
  });

  it('target profile already active: sends without switching, and missing profile fails fast', async () => {
    mockGetProfiles.mockReturnValue([{ id: 'resolved-profile', name: '续写渠道', api: 'openai' }]);
    mockTriggerSlash.mockResolvedValue('续写渠道');
    mockSendConnectionManager.mockResolvedValue({ result: { choices: [{ message: { content: 'profile reply' } }] } });
    const resolved = { apiMode: 'tavern' as const, apiConfig: { url: '', apiKey: '', model: '', useMainApi: false, max_tokens: 17, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: 'resolved-profile' };

    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: 'profile request' }], resolved)).resolves.toBe('profile reply');
    expect(mockTriggerSlash.mock.calls.map(call => call[0]).filter(command => command.startsWith('/profile await=true'))).toHaveLength(0);

    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: 'profile request' }], { ...resolved, tavernProfile: 'ghost-profile' }))
      .rejects.toThrow('无法找到 ID 为 "ghost-profile" 的连接预设');
    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: 'profile request' }], { ...resolved, tavernProfile: '' }))
      .rejects.toThrow('未选择连接预设');
  });

  it('uses generateRaw only when the supplied resolved configuration selects the main API', async () => {
    mockGenerateRaw.mockResolvedValue('main-api reply');

    await expect(callAIWithResolvedPreset_ACU(
      [{ role: 'user', content: 'main API request' }],
      { apiMode: 'custom', apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 33, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: '' },
    )).resolves.toBe('main-api reply');

    expect(mockGenerateRaw).toHaveBeenCalledWith(expect.objectContaining({
      ordered_prompts: [{ role: 'user', content: 'main API request' }],
      max_tokens: 33,
    }));
  });

  it('opens and closes the main-API attribution window around generateRaw, including failures', async () => {
    const beforeMainApiCall = vi.fn();
    const afterMainApiCall = vi.fn();
    mockGenerateRaw.mockResolvedValueOnce('main-api reply').mockRejectedValueOnce(new Error('offline'));
    const resolved = { apiMode: 'custom' as const, apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 33, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' }, tavernProfile: '' };

    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: 'main API request' }], resolved, undefined, { beforeMainApiCall, afterMainApiCall })).resolves.toBe('main-api reply');
    await expect(callAIWithResolvedPreset_ACU([{ role: 'user', content: 'main API request' }], resolved, undefined, { beforeMainApiCall, afterMainApiCall })).rejects.toThrow('offline');

    expect(beforeMainApiCall).toHaveBeenCalledTimes(2);
    expect(afterMainApiCall).toHaveBeenCalledTimes(2);
    expect(beforeMainApiCall.mock.invocationCallOrder[0]).toBeLessThan(mockGenerateRaw.mock.invocationCallOrder[0]);
    expect(afterMainApiCall.mock.invocationCallOrder[1]).toBeGreaterThan(mockGenerateRaw.mock.invocationCallOrder[1]);
  });
});

// ═══ callAIWithPreset_ACU 参数透传 ═══
describe('callAIWithPreset_ACU 参数透传', () => {
  it('custom 分支 fetch body temperature=0 不被回退', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', temperature: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0);
  });

  it('custom 分支 fetch body topP 驼峰别名生效', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', topP: 0.3 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.top_p).toBe(0.3);
  });

  it('custom 分支 fetch body max_tokens=0 不被回退', async () => {
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', max_tokens: 0 };
    mockFetch.mockResolvedValue({ ok: true });
    mockHandleApiResponse.mockResolvedValue('AI 回复');
    await callAIWithPreset_ACU([{ role: 'user', content: '你好' }]);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.max_tokens).toBe(0);
  });
});
