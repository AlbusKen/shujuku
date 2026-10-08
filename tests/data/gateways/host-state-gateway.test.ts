/**
 * tests/data/gateways/host-state-gateway.test.ts
 * 宿主运行时状态访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSillyTavern, mockTopLevelWindow, mockGetCurrentCharData, mockIsExtensionMode } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockTopLevelWindow: {} as any,
  mockGetCurrentCharData: vi.fn(() => null),
  mockIsExtensionMode: vi.fn(() => true),
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopLevelWindow,
}));

vi.mock('../../../src/shared/runtime-env', () => ({
  getHostWindow: () => mockTopLevelWindow,
  isExtensionMode: () => mockIsExtensionMode(),
}));

vi.mock('../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharData_ACU: mockGetCurrentCharData,
}));

import {
  getUserName_ACU,
  getPersonaDescription_ACU,
  getCurrentCharacterFallback_ACU,
  getCharDescription_ACU,
  getCurrentCharacterId_ACU,
} from '../../../src/data/gateways/host-state-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
  Object.keys(mockTopLevelWindow).forEach(k => delete mockTopLevelWindow[k]);
  mockGetCurrentCharData.mockReturnValue(null);
  mockIsExtensionMode.mockReturnValue(true);
});

describe('getUserName_ACU', () => {
  it('不可用时返回默认值 "用户"', () => {
    expect(getUserName_ACU()).toBe('用户');
  });

  it('可用时返回用户名', () => {
    mockSillyTavern.name1 = '冈部伦太郎';
    expect(getUserName_ACU()).toBe('冈部伦太郎');
  });
});

describe('getPersonaDescription_ACU', () => {
  it('所有来源不可用时返回空字符串', () => {
    expect(getPersonaDescription_ACU()).toBe('');
  });

  it('从 SillyTavern.getContext() 获取', () => {
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({
        powerUserSettings: { persona_description: '疯狂科学家' },
      }),
    };
    expect(getPersonaDescription_ACU()).toBe('疯狂科学家');
  });

  it('从 power_user 获取（降级）', () => {
    mockTopLevelWindow.power_user = { persona_description: '助手' };
    expect(getPersonaDescription_ACU()).toBe('助手');
  });

  it('从 SillyTavern_API_ACU 获取（最终降级）', () => {
    mockSillyTavern.powerUserSettings = { persona_description: 'API描述' };
    expect(getPersonaDescription_ACU()).toBe('API描述');
  });
});

describe('getCurrentCharacterId_ACU', () => {
  it('优先使用 SillyTavern API 的 this_chid，并保留 0', () => {
    mockSillyTavern.this_chid = 0;
    mockTopLevelWindow.SillyTavern = { getContext: () => ({ characterId: 9 }) };
    mockTopLevelWindow.this_chid = 12;
    expect(getCurrentCharacterId_ACU()).toBe('0');
  });

  it('降级使用 SillyTavern context 的 characterId', () => {
    mockTopLevelWindow.SillyTavern = { getContext: () => ({ characterId: 9 }) };
    mockTopLevelWindow.this_chid = 12;
    expect(getCurrentCharacterId_ACU()).toBe('9');
  });

  it('最终降级使用 window.this_chid，并在没有值时返回 null', () => {
    mockTopLevelWindow.this_chid = 12;
    expect(getCurrentCharacterId_ACU()).toBe('12');
    delete mockTopLevelWindow.this_chid;
    expect(getCurrentCharacterId_ACU()).toBeNull();
  });

  it('忽略字符串形式的初始化占位值', () => {
    mockSillyTavern.this_chid = 'null';
    mockTopLevelWindow.SillyTavern = { getContext: () => ({ characterId: 'undefined' }) };
    mockTopLevelWindow.this_chid = 'NULL';
    expect(getCurrentCharacterId_ACU()).toBeNull();
  });
});

describe('getCurrentCharacterFallback_ACU', () => {
  it('所有来源不可用时返回 null', () => {
    expect(getCurrentCharacterFallback_ACU()).toBeNull();
  });

  it('优先使用 TavernHelper.getCharData', () => {
    const charData = { name: '角色A', description: '描述A' };
    mockGetCurrentCharData.mockReturnValue(charData);
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });

  it('TavernHelper 不可用时降级到 SillyTavern_API', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    const charData = { name: '角色B' };
    mockSillyTavern.characters = { 0: charData };
    mockSillyTavern.this_chid = 0;
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });

  it('降级到 SillyTavern.getContext()', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    const charData = { name: '角色C' };
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({ characters: { 0: charData }, characterId: 0 }),
    };
    const result = getCurrentCharacterFallback_ACU();
    expect(result).toEqual(charData);
  });
});

describe('getCharDescription_ACU', () => {
  it('所有来源不可用时返回空字符串', () => {
    expect(getCharDescription_ACU()).toBe('');
  });

  it('从角色数据获取描述', () => {
    mockGetCurrentCharData.mockReturnValue({ description: '天才少女科学家' });
    expect(getCharDescription_ACU()).toBe('天才少女科学家');
  });

  it('从 data.description 获取', () => {
    mockGetCurrentCharData.mockReturnValue({ data: { description: '嵌套描述' } });
    expect(getCharDescription_ACU()).toBe('嵌套描述');
  });

  it('降级到 stContext.name2_description', () => {
    mockGetCurrentCharData.mockReturnValue(null);
    mockTopLevelWindow.SillyTavern = {
      getContext: () => ({ name2_description: '最终降级描述' }),
    };
    expect(getCharDescription_ACU()).toBe('最终降级描述');
  });
});


describe('零层宿主上下文', () => {
  let release: (() => void) | undefined;
  afterEach(() => { release?.(); release = undefined; });

  it('iframe 模式优先取得主窗口真实上下文而非事件代理', async () => {
    const { getZeroLayerHostContext_ACU } = await import('../../../src/data/gateways/zero-layer-generation-gateway');
    mockIsExtensionMode.mockReturnValue(false);
    mockSillyTavern.eventSource = { emit: vi.fn() };
    const context = { eventSource: { emit: vi.fn() } };
    mockTopLevelWindow.SillyTavern = { getContext: () => context };
    expect(getZeroLayerHostContext_ACU()).toBe(context);
    expect(getZeroLayerHostContext_ACU()?.eventSource).not.toBe(mockSillyTavern.eventSource);
  });

  it('iframe 只有代理时不把代理当成宿主接管对象', async () => {
    const { getZeroLayerHostContext_ACU } = await import('../../../src/data/gateways/zero-layer-generation-gateway');
    mockIsExtensionMode.mockReturnValue(false);
    mockSillyTavern.eventSource = { emit: vi.fn() };
    expect(getZeroLayerHostContext_ACU()).toBeUndefined();
  });

  it('主窗口旧式 API 可回退，但真实上下文读取失败不可回退代理', async () => {
    const { getZeroLayerHostContext_ACU } = await import('../../../src/data/gateways/zero-layer-generation-gateway');
    expect(getZeroLayerHostContext_ACU()).toBe(mockSillyTavern);
    mockTopLevelWindow.SillyTavern = { getContext: () => { throw new Error('context unavailable'); } };
    expect(() => getZeroLayerHostContext_ACU()).toThrow('context unavailable');
  });

  it('quiet 装配使用同一真实上下文并在捕获后取消酒馆原请求', async () => {
    const gateway = await import('../../../src/data/gateways/zero-layer-generation-gateway');
    const { installHostGenerationInterceptor_ACU } = await import('../../../src/data/gateways/host-generation-interceptor');
    mockIsExtensionMode.mockReturnValue(false);
    const originalFetch = vi.fn();
    mockTopLevelWindow.fetch = originalFetch;
    mockTopLevelWindow.location = { href: 'https://tavern.invalid/', origin: 'https://tavern.invalid' };
    mockSillyTavern.generate = vi.fn();
    let invocation: unknown;
    const context = { mainApi: 'openai', groupId: null,
      eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'settings' },
      generate: vi.fn(async (_type: string, options: unknown) => {
        invocation = options;
        expect(gateway.isZeroLayerHostInvocation_ACU(options)).toBe(true);
        await mockTopLevelWindow.fetch('/api/backends/chat-completions/generate', { method: 'POST', body: '{"messages":[{"role":"user","content":"行动"}]}' });
      }),
    };
    mockTopLevelWindow.SillyTavern = { getContext: () => context };
    const captured = vi.fn();
    release = installHostGenerationInterceptor_ACU({ isActive: () => true,
      claim: request => async () => { captured(await request.readPayload()); },
    });
    await expect(gateway.invokeZeroLayerHostGeneration_ACU('行动', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(captured).toHaveBeenCalledWith({ messages: [{ role: 'user', content: '行动' }] });
    expect(originalFetch).not.toHaveBeenCalled();
    expect(mockSillyTavern.generate).not.toHaveBeenCalled();
    expect(gateway.isZeroLayerHostInvocation_ACU(invocation)).toBe(false);
  });
});

describe('零层数据库请求转发', () => {
  let release: (() => void) | undefined;
  afterEach(() => {
    release?.(); release = undefined;
    vi.doUnmock('../../../src/service/ai/api-call');
    vi.doUnmock('../../../src/service/runtime/state-manager');
  });

  it('捕获的最终消息沿数据库直连路线处理，成功与失败均不放行酒馆原请求', async () => {
    const originalFetch = vi.fn();
    mockTopLevelWindow.fetch = originalFetch;
    mockTopLevelWindow.location = { href: 'https://tavern.invalid/', origin: 'https://tavern.invalid' };
    const preset = { apiMode: 'custom', apiConfig: { url: 'https://database.invalid', model: 'database-model', useMainApi: false } };
    const callAI = vi.fn().mockResolvedValue('数据库正文');
    vi.doMock('../../../src/service/ai/api-call', () => ({
      getApiConfigByPreset_ACU: () => preset,
      requireResolvedApiPreset_ACU: vi.fn(), assertResolvedPresetDirectTransport_ACU: vi.fn(),
      callAIWithResolvedPreset_ACU: callAI,
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: { streamingEnabled: true } }));
    const { installZeroLayerRequestForwarder_ACU } = await import('../../../src/service/zero-layer/host-request-forwarder');
    const lease = { signal: new AbortController().signal, presetName: 'database-direct',
      isCurrent: () => true, beforeDispatch: vi.fn(async () => {}),
      commitReply: vi.fn(async () => {}), fail: vi.fn(async () => {}) };
    release = installZeroLayerRequestForwarder_ACU({ isActive: () => true, claim: () => lease });
    const messages = [{ role: 'user', content: '最终装配行动' }];
    const send = () => mockTopLevelWindow.fetch('/api/backends/chat-completions/generate', {
      method: 'POST', body: JSON.stringify({ messages, model: 'host-model', type: 'quiet',
        stream: false, max_tokens: 512, _acu_zero_layer_attempt_id: 'attempt' }),
    });
    await expect(send()).rejects.toMatchObject({ name: 'AbortError' });
    expect(callAI).toHaveBeenCalledWith(messages, preset, expect.any(AbortSignal), undefined,
      expect.objectContaining({ streaming: true, requireDirectTransport: true,
        generationParameters: { type: 'quiet', max_tokens: 512 } }));
    expect(lease.beforeDispatch).toHaveBeenCalledBefore(callAI);
    expect(lease.commitReply).toHaveBeenCalledWith('数据库正文');
    expect(originalFetch).not.toHaveBeenCalled();
    callAI.mockRejectedValueOnce(new Error('database failed'));
    await expect(send()).rejects.toMatchObject({ name: 'AbortError' });
    expect(lease.fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'database failed' }));
    expect(lease.commitReply).toHaveBeenCalledTimes(1);
    expect(originalFetch).not.toHaveBeenCalled();
  });
});
