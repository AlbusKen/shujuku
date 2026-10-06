/**
 * tests/data/gateways/ai-gateway.test.ts
 * AI 调用网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTavernHelper, mockSillyTavern, mockLogWarn, mockFetch } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockSillyTavern: {} as any,
  mockLogWarn: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/data/gateways/pristine-fetch', () => ({ pristineFetch_ACU: mockFetch }));
import { clearLogs, getAllLogs, setApiLogEnabled } from '../../../src/shared/log-buffer';
import { readFetchChatTurn_ACU } from '../../../src/service/ai/native-tool';
import { createApiRequestLog_ACU } from '../../../src/shared/api-request-log';

import {
  isGenerateRawAvailable_ACU,
  isConnectionManagerAvailable_ACU,
  isTriggerSlashAvailable_ACU,
  generateRaw_ACU,
  sendConnectionManagerRequest_ACU,
  triggerSlash_ACU,
  getConnectionManagerProfiles_ACU,
  getHostRequestHeaders_ACU,
  postChatCompletionDirect_ACU,
  sendMainApiChatCompletionRequest_ACU,
  sendProfileChatCompletionRequest_ACU,
} from '../../../src/data/gateways/ai-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  clearLogs();
  setApiLogEnabled(false);
  Object.keys(mockTavernHelper).forEach(k => delete mockTavernHelper[k]);
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('isGenerateRawAvailable_ACU', () => {
  it('不可用返回 false', () => {
    expect(isGenerateRawAvailable_ACU()).toBe(false);
  });

  it('可用返回 true', () => {
    mockTavernHelper.generateRaw = vi.fn();
    expect(isGenerateRawAvailable_ACU()).toBe(true);
  });
});

describe('isConnectionManagerAvailable_ACU', () => {
  it('不可用返回 false', () => {
    expect(isConnectionManagerAvailable_ACU()).toBe(false);
  });

  it('可用返回 true', () => {
    mockSillyTavern.ConnectionManagerRequestService = { sendRequest: vi.fn() };
    expect(isConnectionManagerAvailable_ACU()).toBe(true);
  });
});

describe('isTriggerSlashAvailable_ACU', () => {
  it('不可用返回 false', () => {
    expect(isTriggerSlashAvailable_ACU()).toBe(false);
  });

  it('可用返回 true', () => {
    mockTavernHelper.triggerSlash = vi.fn();
    expect(isTriggerSlashAvailable_ACU()).toBe(true);
  });
});

describe('generateRaw_ACU', () => {
  it('不可用时抛错', async () => {
    await expect(generateRaw_ACU({ ordered_prompts: [] })).rejects.toThrow('generateRaw');
  });

  it('可用时返回生成文本', async () => {
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue('生成的文本');
    const result = await generateRaw_ACU({ ordered_prompts: [{ role: 'user', content: '你好' }] });
    expect(result).toBe('生成的文本');
  });

  it('返回非字符串时转为字符串', async () => {
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue(123);
    const result = await generateRaw_ACU({ ordered_prompts: [] });
    expect(result).toBe('123');
  });

  it('返回 null 时转为空字符串', async () => {
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue(null);
    const result = await generateRaw_ACU({ ordered_prompts: [] });
    expect(result).toBe('');
  });
});

describe('sendConnectionManagerRequest_ACU', () => {
  it('不可用时抛错', async () => {
    await expect(sendConnectionManagerRequest_ACU('profile1', [], 100)).rejects.toThrow('ConnectionManagerRequestService');
  });

  it('可用时调用并返回结果', async () => {
    const response = { choices: [{ message: { content: '回复' } }] };
    mockSillyTavern.ConnectionManagerRequestService = {
      sendRequest: vi.fn().mockResolvedValue(response),
    };
    const result = await sendConnectionManagerRequest_ACU('profile1', [{ role: 'user', content: '你好' }], 100);
    expect(result).toEqual(response);
  });
});

describe('triggerSlash_ACU', () => {
  it('不可用时返回空字符串', async () => {
    expect(await triggerSlash_ACU('/help')).toBe('');
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时返回命令结果', async () => {
    mockTavernHelper.triggerSlash = vi.fn().mockResolvedValue('命令结果');
    expect(await triggerSlash_ACU('/help')).toBe('命令结果');
  });
});

describe('getConnectionManagerProfiles_ACU', () => {
  it('不可用时返回空数组', () => {
    expect(getConnectionManagerProfiles_ACU()).toEqual([]);
  });

  it('可用时返回配置列表', () => {
    mockSillyTavern.extensionSettings = {
      connectionManager: { profiles: [{ id: 'p1', name: '配置1' }] },
    };
    expect(getConnectionManagerProfiles_ACU()).toEqual([{ id: 'p1', name: '配置1' }]);
  });
});

describe('getHostRequestHeaders_ACU', () => {
  it('SillyTavern 不可用时返回空对象', () => {
    expect(getHostRequestHeaders_ACU()).toEqual({});
  });

  it('可用时返回请求头', () => {
    const headers = { 'X-CSRF-Token': 'abc123' };
    (globalThis as any).SillyTavern = { getContext: () => ({ getRequestHeaders: () => headers }) };
    expect(getHostRequestHeaders_ACU()).toEqual(headers);
    delete (globalThis as any).SillyTavern;
  });
});

describe('各酒馆渠道的 API 请求日志', () => {
  beforeEach(() => setApiLogEnabled(true));
  it('generateRaw 记录可见参数与完整返回值，不改参数或读取 getter', async () => {
    const prompt = '完整提示词'.repeat(2000);
    const getter = vi.fn(() => { throw new Error('不应读取'); });
    const options: any = { ordered_prompts: [{ role: 'user', content: prompt }], api_key: 'host-secret' };
    options.self = options;
    Object.defineProperty(options, 'dynamic', { enumerable: true, get: getter });
    mockTavernHelper.generateRaw = vi.fn().mockResolvedValue('完整回复 host-secret');
    expect(await generateRaw_ACU(options)).toBe('完整回复 host-secret');
    expect(mockTavernHelper.generateRaw.mock.calls[0][0]).toBe(options);
    expect(getter).not.toHaveBeenCalled();
    const logs = getAllLogs();
    expect(logs).toHaveLength(2);
    expect(logs.every(entry => entry.tag === 'API主连接')).toBe(true);
    expect(logs[0].message).toContain('非最终网络请求');
    expect(logs[0].message).toContain(prompt);
    expect(logs[0].message).toContain('循环引用');
    expect(logs[1].message).toContain('完整回复');
    expect(JSON.stringify(logs)).not.toContain('host-secret');
  });

  it('连接管理器保持三参/五参契约和返回值身份，错误仍原样抛出', async () => {
    const response = { content: '连接回复', session_token: 'session-secret' };
    const sendRequest = vi.fn().mockResolvedValue(response);
    mockSillyTavern.ConnectionManagerRequestService = { sendRequest };
    const messages = [{ role: 'user', content: '连接提示词' }];
    expect(await sendConnectionManagerRequest_ACU('p1', messages, 100)).toBe(response);
    expect(sendRequest).toHaveBeenLastCalledWith('p1', messages, 100);
    const custom = { apiKey: 'custom-secret' };
    const override = { tools: [{ type: 'function' }] };
    await sendConnectionManagerRequest_ACU('p1', messages, 100, custom, override);
    expect(sendRequest).toHaveBeenLastCalledWith('p1', messages, 100, custom, override);
    const error = new DOMException('用户取消 custom-secret', 'AbortError');
    sendRequest.mockRejectedValueOnce(error);
    await expect(sendConnectionManagerRequest_ACU('p1', messages, 100, custom)).rejects.toBe(error);
    const logs = getAllLogs();
    expect(logs.every(entry => entry.tag === 'API连接预设')).toBe(true);
    expect(JSON.stringify(logs)).toContain('连接回复');
    expect(JSON.stringify(logs)).toContain('AbortError');
    expect(JSON.stringify(logs)).not.toMatch(/session-secret|custom-secret/);
  });

  it('主连接和 Chat Completion 预设分行记录后端请求体及完整回复', async () => {
    mockSillyTavern.mainApi = 'openai';
    mockSillyTavern.chatCompletionSettings = { chat_completion_source: 'custom', custom_url: 'https://endpoint.test/v1?key=query-secret', proxy_password: 'proxy-secret' };
    mockSillyTavern.getRequestHeaders = () => ({ 'X-CSRF-Token': 'csrf-secret' });
    mockSillyTavern.CONNECT_API_MAP = { custom: { selected: 'openai', source: 'custom' } };
    const raw = '{ "choices": [{"message":{"content":"原始回复"}}], "usage": {"total_tokens":12} }';
    const original = new Response(raw);
    const read = vi.spyOn(original, 'text');
    mockFetch.mockResolvedValueOnce(original).mockResolvedValueOnce(new Response(raw));
    const messages = [{ role: 'user', content: '提示词正文' }];
    expect((await sendMainApiChatCompletionRequest_ACU(messages, {})).choices[0].message.content).toBe('原始回复');
    await sendProfileChatCompletionRequest_ACU({ id: 'p1', api: 'custom', model: 'model', 'api-url': 'https://profile.test/v1' }, messages, 100, {});
    expect(read).toHaveBeenCalledTimes(1);
    const logs = getAllLogs();
    expect(logs).toHaveLength(4);
    expect(logs.map(entry => entry.tag)).toEqual(['API主连接', 'API主连接', 'API连接预设', 'API连接预设']);
    expect(logs[0].message).toContain('酒馆后端请求体');
    expect(logs[0].message).toContain('提示词正文');
    expect(logs[1].message).toContain('原始回复');
    expect(logs[1].message).toContain('"total_tokens": 12');
    expect(logs[1].message).toContain('{\n');
    expect(JSON.stringify(logs)).not.toMatch(/query-secret|csrf-secret|proxy-secret/);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).custom_url).toContain('query-secret');
  });
});


describe('酒馆响应单次消费与取消', () => {
  beforeEach(() => setApiLogEnabled(true));
  it('流式回调只获取一个 reader，逐块读取且保留完整原始 SSE', async () => {
    const raw = 'data: {"choices":[{"delta":{"content":"流式正文"}}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(raw);
    const cancel = vi.fn();
    const original = new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.slice(0, 48)); controller.enqueue(bytes.slice(48)); controller.close(); },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } });
    const getReader = vi.spyOn(original.body!, 'getReader');
    const text = vi.spyOn(original, 'text');
    const clone = vi.spyOn(original, 'clone');
    mockFetch.mockResolvedValueOnce(original);
    const result = await postChatCompletionDirect_ACU({ messages: [], tools: [{ type: 'function' }] }, undefined, {
      streaming: true,
      readResponse: response => readFetchChatTurn_ACU(response, true),
    });
    expect(result.turn.content).toBe('流式正文');
    expect(getReader).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(original.body!.locked).toBe(false);
    expect(getAllLogs().at(-1)!.message).toContain(raw);
    expect(getAllLogs().at(-1)!.message).toContain('完整');
  });

  it('取消只记录已消费内容，原信号、读取错误和锁释放语义保持不变', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const original = new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('部分回复')); }, cancel,
    }));
    const reason = new DOMException('用户停止', 'AbortError');
    mockFetch.mockResolvedValueOnce(original);
    await expect(postChatCompletionDirect_ACU({ messages: [] }, controller.signal, {
      streaming: true,
      async readResponse(response) {
        const reader = response.body!.getReader();
        try { await reader.read(); controller.abort(reason); throw reason; }
        finally { reader.releaseLock(); }
      },
    })).rejects.toBe(reason);
    expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    expect(cancel).not.toHaveBeenCalled();
    expect(original.body!.locked).toBe(false);
    const reply = getAllLogs().find(entry => entry.message.includes('回复 HTTP'))!;
    expect(reply.message).toContain('部分回复');
    expect(reply.message).toContain('取消');
    expect(reply.message).not.toContain('（完整）');
  });

  it.each([['{ "error": { "message": "上游拒绝" } }', 429], ['非 JSON 完整错误正文', 502]])(
    'HTTP 错误仍记录完整正文，JSON 分行展示且保持原有异常', async (raw, status) => {
      mockFetch.mockResolvedValueOnce(new Response(raw, { status }));
      await expect(postChatCompletionDirect_ACU({ messages: [] })).rejects.toThrow();
      const expectedBody = status === 429 ? '"message": "上游拒绝"' : raw;
      expect(getAllLogs().find(entry => entry.message.includes('回复 HTTP'))!.message).toContain(expectedBody);
    },
  );
});
