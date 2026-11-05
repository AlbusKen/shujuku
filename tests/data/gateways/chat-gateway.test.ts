/**
 * tests/data/gateways/chat-gateway.test.ts
 * 聊天数组访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSillyTavern, mockLogDebug, mockLogWarn, mockIsTauriTavernHost } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
  mockIsTauriTavernHost: vi.fn(() => false),
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: mockLogWarn,
  cleanChatName_ACU: (name: string) => name.replace(/\.jsonl$|\.json$/i, ''),
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  getHostRequestHeaders_ACU: () => ({}),
}));

vi.mock('../../../src/shared/host-detect', () => ({
  isTauriTavernHost_ACU: mockIsTauriTavernHost,
}));

import {
  getChatArray_ACU,
  getChatLength_ACU,
  getLastMessageIndex_ACU,
  saveChatToHost_ACU,
  saveChatToHostStrict_ACU,
  stopGeneration_ACU,
  deleteLastMessage_ACU,
  setChatMessages_ACU,
  emitMessageUpdated_ACU,
  listAllHostChatNames_ACU,
  readChatFromHostStrict_ACU,
} from '../../../src/data/gateways/chat-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('全量存活聊天枚举', () => {
  const request = vi.fn();
  beforeEach(() => {
    mockSillyTavern.characters = [{ avatar: 'alice.png' }];
    mockSillyTavern.groups = [];
    vi.stubGlobal('SillyTavern', undefined);
    request.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('完整空列表是有效空集合', async () => {
    expect(await listAllHostChatNames_ACU()).toEqual(new Set());
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ avatar_url: 'alice.png', simple: true });
  });

  it('合并跨角色和群组同名聊天，兼容历史数字群组 ID', async () => {
    mockSillyTavern.characters.push({ avatar: 'bob.png' });
    mockSillyTavern.groups = [{ chats: ['shared', 'group-only', 123] }];
    request.mockResolvedValueOnce({ ok: true, json: async () => [{ file_name: 'shared.jsonl' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ file_name: 'shared.jsonl' }, { file_name: 'bob-only.jsonl' }] });
    expect(await listAllHostChatNames_ACU()).toEqual(new Set(['shared', 'bob-only', 'group-only', '123']));
  });

  it.each([undefined, null, {}, [null], [{}], [{ chats: {} }], [{ chats: [null] }], [{ chats: [{}] }], [{ chats: [''] }]])(
    '群组列表不完整时返回 null：%j', async groups => {
      mockSillyTavern.groups = groups;
      expect(await listAllHostChatNames_ACU()).toBeNull();
    },
  );

  it.each([null, {}, { unexpected: 'invalid payload' }, { error: true }, [{}], [{ file_name: 7 }], [{ file_name: '' }]])(
    '角色响应不是完整成功列表时返回 null：%j', async payload => {
      request.mockResolvedValue({ ok: true, json: async () => payload });
      expect(await listAllHostChatNames_ACU()).toBeNull();
    },
  );

  it.each([undefined, {}, [null], [{}], [{ avatar: 7 }]])('角色列表缺少身份时不返回残缺集合：%j', async characters => {
    mockSillyTavern.characters = characters;
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });

  it.each(['http', 'network', 'json'])('第二个角色读取失败（%s）丢弃已收集的部分结果', async failure => {
    mockSillyTavern.characters.push({ avatar: 'bob.png' });
    request.mockResolvedValueOnce({ ok: true, json: async () => [{ file_name: 'alive.jsonl' }] });
    if (failure === 'network') request.mockRejectedValueOnce(new Error('offline'));
    else request.mockResolvedValueOnce({ ok: failure !== 'http', json: async () => { throw new Error('invalid json'); } });
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });

  it('宿主上下文群组可用时优先读取，抛错时不使用旧列表掩盖失败', async () => {
    vi.stubGlobal('SillyTavern', { getContext: () => ({ groups: [{ chats: ['host-group'] }] }) });
    expect(await listAllHostChatNames_ACU()).toEqual(new Set(['host-group']));
    vi.stubGlobal('SillyTavern', { getContext: () => { throw new Error('unavailable'); } });
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });
});

describe('getChatArray_ACU', () => {
  it('无 chat 时返回空数组', () => {
    expect(getChatArray_ACU()).toEqual([]);
  });

  it('有 chat 时返回引用', () => {
    const chat = [{ mes: '消息1' }, { mes: '消息2' }];
    mockSillyTavern.chat = chat;
    expect(getChatArray_ACU()).toBe(chat);
  });
});

describe('getChatLength_ACU', () => {
  it('无 chat 时返回 0', () => {
    expect(getChatLength_ACU()).toBe(0);
  });

  it('有 chat 时返回长度', () => {
    mockSillyTavern.chat = [{ mes: '1' }, { mes: '2' }, { mes: '3' }];
    expect(getChatLength_ACU()).toBe(3);
  });
});

describe('getLastMessageIndex_ACU', () => {
  it('空聊天返回 0', () => {
    expect(getLastMessageIndex_ACU()).toBe(0);
  });

  it('有消息时返回最后索引', () => {
    mockSillyTavern.chat = [{ mes: '1' }, { mes: '2' }];
    expect(getLastMessageIndex_ACU()).toBe(1);
  });
});

describe('saveChatToHost_ACU', () => {
  it('saveChat 不可用时静默跳过', async () => {
    await saveChatToHost_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('saveChat 可用时调用', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);
    await saveChatToHost_ACU();
    expect(mockSillyTavern.saveChat).toHaveBeenCalled();
  });
});

describe('saveChatToHostStrict_ACU', () => {
  it('saveChat 不可用时抛错，不把未提交误认为保存成功', async () => {
    await expect(saveChatToHostStrict_ACU()).rejects.toThrow('宿主 saveChat 不可用');
  });

  it('saveChat 可用时执行真实保存', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);

    await saveChatToHostStrict_ACU();

    expect(mockSillyTavern.saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('stopGeneration_ACU', () => {
  it('不可用时静默跳过', () => {
    stopGeneration_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时调用', () => {
    mockSillyTavern.stopGeneration = vi.fn();
    stopGeneration_ACU();
    expect(mockSillyTavern.stopGeneration).toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalled();
  });
});

describe('deleteLastMessage_ACU', () => {
  it('不可用时静默跳过', async () => {
    await deleteLastMessage_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时调用', async () => {
    mockSillyTavern.deleteLastMessage = vi.fn().mockResolvedValue(undefined);
    await deleteLastMessage_ACU();
    expect(mockSillyTavern.deleteLastMessage).toHaveBeenCalled();
  });
});

describe('setChatMessages_ACU', () => {
  it('不可用时返回 false', async () => {
    expect(await setChatMessages_ACU([{ message_id: 0, mes: '新内容' }])).toBe(false);
  });

  it('可用时调用并返回 true', async () => {
    mockSillyTavern.setChatMessages = vi.fn().mockResolvedValue(undefined);
    const result = await setChatMessages_ACU([{ message_id: 0, mes: '新内容' }], { refresh: 'affected' });
    expect(result).toBe(true);
    expect(mockSillyTavern.setChatMessages).toHaveBeenCalledWith(
      [{ message_id: 0, mes: '新内容' }],
      { refresh: 'affected' },
    );
  });
});

describe('emitMessageUpdated_ACU', () => {
  it('eventSource 不可用时静默跳过', async () => {
    await emitMessageUpdated_ACU(0);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('有 eventTypes.MESSAGE_UPDATED 时使用常量', async () => {
    const emit = vi.fn();
    mockSillyTavern.eventSource = { emit };
    mockSillyTavern.eventTypes = { MESSAGE_UPDATED: 'MESSAGE_UPDATED_CONST' };
    await emitMessageUpdated_ACU(5);
    expect(emit).toHaveBeenCalledWith('MESSAGE_UPDATED_CONST', 5);
  });

  it('无 eventTypes 时降级使用宿主事件名', async () => {
    const emit = vi.fn();
    mockSillyTavern.eventSource = { emit };
    await emitMessageUpdated_ACU(3);
    expect(emit).toHaveBeenCalledWith('message_updated', 3);
  });
});

describe('群聊回读 JSONL header', () => {
  const header = { user_name: 'u', character_name: 'g', chat_metadata: { integrity: 'x' } };
  const chat = [{ name: 'A', mes: '一' }, { name: 'B', mes: '二' }];
  const request = vi.fn();
  const respond = (persisted: any[]) => request.mockResolvedValue({ ok: true, json: async () => persisted });

  beforeEach(() => {
    Object.assign(mockSillyTavern, { chat, chatId: 'group-chat', groupId: 'group-1', characterId: undefined, characters: [] });
    mockIsTauriTavernHost.mockReturnValue(false);
    request.mockReset();
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ST 首条带 chat_metadata 时剥离 header，并按群聊 id 请求', async () => {
    respond([header, ...chat]);
    expect(await readChatFromHostStrict_ACU()).toEqual(chat);
    expect(request.mock.calls[0][0]).toBe('/api/chats/group/get');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ id: 'group-chat' });
  });

  it('ST 首条不带 chat_metadata 时保留首条消息', async () => {
    respond([...chat]);
    expect(await readChatFromHostStrict_ACU()).toEqual(chat);
  });

  it('TT 首条总是 header，即使不带 chat_metadata 也剥离', async () => {
    mockIsTauriTavernHost.mockReturnValue(true);
    respond([{ user_name: 'u' }, ...chat]);
    expect(await readChatFromHostStrict_ACU()).toEqual(chat);
  });

  it('verify 回读群聊时 header 不再导致保存确认失败', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);
    respond([header, ...chat]);
    await expect(saveChatToHostStrict_ACU({ verify: true })).resolves.toBeUndefined();
    expect(mockSillyTavern.saveChat).toHaveBeenCalledTimes(1);
  });

  it('角色聊天仍固定剥离首行 header，不受宿主判断影响', async () => {
    Object.assign(mockSillyTavern, { groupId: undefined, characterId: 0, characters: [{ name: 'Alice', avatar: 'alice.png' }] });
    respond([{ user_name: 'u' }, ...chat]);
    expect(await readChatFromHostStrict_ACU()).toEqual(chat);
    expect(request.mock.calls[0][0]).toBe('/api/chats/get');
    expect(mockIsTauriTavernHost).not.toHaveBeenCalled();
  });
});

describe('保存后只回读校验指定楼层字段', () => {
  const frame = { iso: { storageFrame: { version: 2, checkpoint: { kind: 'full' } } } };
  const request = vi.fn();
  const respond = (persisted: any[]) => request.mockResolvedValue({ ok: true, json: async () => [{ user_name: 'u' }, ...persisted] });
  let chat: any[];

  beforeEach(() => {
    chat = [{ mes: '开场', TavernDB_ACU_IsolatedData: frame }, { mes: '二' }];
    Object.assign(mockSillyTavern, {
      chat, chatId: 'chat-a', groupId: undefined, characterId: 0,
      characters: [{ name: 'Alice', avatar: 'alice.png' }], saveChat: vi.fn().mockResolvedValue(undefined),
    });
    request.mockReset();
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  const verifyFields = [{ messageIndex: 0, field: 'TavernDB_ACU_IsolatedData' }];

  it('目标字段一致时放行，不比对其他楼层正文', async () => {
    respond([{ mes: '开场', TavernDB_ACU_IsolatedData: structuredClone(frame) }, { mes: '服务器上的别的正文' }]);
    await expect(saveChatToHostStrict_ACU({ verifyFields })).resolves.toBeUndefined();
    expect(mockSillyTavern.saveChat).toHaveBeenCalledTimes(1);
  });

  it('目标楼字段与本轮写入不一致时报错', async () => {
    respond([{ mes: '开场' }, { mes: '二' }]);
    await expect(saveChatToHostStrict_ACU({ verifyFields })).rejects.toThrow('第 0 楼的 TavernDB_ACU_IsolatedData');
  });

  it('服务器楼层数不一致时报错', async () => {
    respond([{ mes: '开场', TavernDB_ACU_IsolatedData: structuredClone(frame) }]);
    await expect(saveChatToHostStrict_ACU({ verifyFields })).rejects.toThrow('楼层数');
  });

  it('目标下标无效时不发起保存', async () => {
    await expect(saveChatToHostStrict_ACU({ verifyFields: [{ messageIndex: 5, field: 'TavernDB_ACU_IsolatedData' }] }))
      .rejects.toMatchObject({ name: 'HostChatSaveNotStartedError_ACU' });
    expect(mockSillyTavern.saveChat).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('宿主缺少聊天身份时照常保存并跳过字段回读', async () => {
    mockSillyTavern.chatId = '';
    await expect(saveChatToHostStrict_ACU({ verifyFields })).resolves.toBeUndefined();
    expect(mockSillyTavern.saveChat).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
});
