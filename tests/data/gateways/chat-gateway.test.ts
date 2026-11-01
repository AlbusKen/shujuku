/**
 * tests/data/gateways/chat-gateway.test.ts
 * 聊天数组访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSillyTavern, mockLogDebug, mockLogWarn } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
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
  afterEach(() => vi.unstubAllGlobals());

  function installReadback(messages: any[], persisted: any[], group = false) {
    mockSillyTavern.chat = messages;
    mockSillyTavern.chatId = 'save-test';
    mockSillyTavern.characterId = 0;
    mockSillyTavern.groupId = group ? 'group-a' : null;
    mockSillyTavern.characters = [{ name: '测试角色', avatar: 'test.png' }];
    mockSillyTavern.saveChat = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ ok: true, json: async () => group ? persisted : [{ chat_metadata: {} }, ...persisted] }));
    vi.stubGlobal('fetch', request);
    return request;
  }

  it.each([false, true])('容忍字段顺序、宿主元数据与身份类型差异，group=%s', async group => {
    const chat = [{ mes: '正文', message_id: 7, swipe_id: 0, is_user: false, extra: { localOnly: true },
      _qrf_world_simulation: { revision: 1, actors: [{ id: 'a', name: '甲' }] } }];
    const remote = [{ _qrf_world_simulation: { actors: [{ name: '甲', id: 'a' }], revision: 1 },
      message_id: '7', swipe_id: '0', mes: '正文', send_date: '宿主补充的时间' }];
    const request = installReadback(chat, remote, group);
    await expect(saveChatToHostStrict_ACU({ verify: true })).resolves.toBeUndefined();
    expect(request.mock.calls[0][0]).toBe(group ? '/api/chats/group/get' : '/api/chats/get');
  });

  it.each(['只有聊天读取函数', '只有旧角色索引', '两种字段均为旧接口', '群组聊天读取函数'])('%s 可以真实保存并回读', async kind => {
    const chat = [{ mes: '正文', _qrf_world_simulation: { revision: 1 } }];
    const group = kind === '群组聊天读取函数';
    const request = installReadback(chat, structuredClone(chat), group);
    if (kind !== '只有旧角色索引') {
      delete mockSillyTavern.chatId;
      mockSillyTavern.getCurrentChatId = () => 'save-test';
    }
    if (kind === '只有旧角色索引' || kind === '两种字段均为旧接口') {
      delete mockSillyTavern.characterId;
      mockSillyTavern.this_chid = 0;
    }
    await expect(saveChatToHostStrict_ACU({ verify: true })).resolves.toBeUndefined();
    expect(mockSillyTavern.saveChat).toHaveBeenCalledOnce();
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(group ? { id: 'save-test' }
      : { ch_name: '测试角色', file_name: 'save-test', avatar_url: 'test.png' });
  });

  it('聊天读取函数优先于旧快照字段，数字与字符串角色索引等价', async () => {
    const chat = [{ mes: '正文' }];
    const request = installReadback(chat, structuredClone(chat));
    mockSillyTavern.chatId = 'stale-snapshot';
    mockSillyTavern.getCurrentChatId = () => 'current-chat';
    mockSillyTavern.saveChat = vi.fn(async () => { mockSillyTavern.characterId = '0'; });
    await expect(saveChatToHostStrict_ACU({ verify: true })).resolves.toBeUndefined();
    expect(JSON.parse(request.mock.calls[0][1].body).file_name).toBe('current-chat');
  });

  it.each(['保存', '回读'])('仅函数提供聊天身份时，%s期间切换仍拒绝确认', async phase => {
    const chat = [{ mes: '正文' }];
    installReadback(chat, structuredClone(chat));
    delete mockSillyTavern.chatId;
    let id = 'save-test';
    mockSillyTavern.getCurrentChatId = () => id;
    if (phase === '保存') mockSillyTavern.saveChat = vi.fn(async () => { id = 'other-chat'; });
    else vi.stubGlobal('fetch', vi.fn(async () => {
      id = 'other-chat';
      return { ok: true, json: async () => [{}, ...chat] };
    }));
    await expect(saveChatToHostStrict_ACU({ verify: true })).rejects.toThrow('聊天已切换');
  });

  it('没有当前聊天时不调用保存，也不把空角色索引误当第一个角色', async () => {
    const chat = [{ mes: '正文' }];
    const request = installReadback(chat, structuredClone(chat));
    mockSillyTavern.getCurrentChatId = () => '';
    await expect(saveChatToHostStrict_ACU({ verify: true })).rejects.toThrow('本次尚未保存');
    expect(mockSillyTavern.saveChat).not.toHaveBeenCalled();
    mockSillyTavern.getCurrentChatId = () => 'save-test';
    mockSillyTavern.characterId = '';
    await expect(saveChatToHostStrict_ACU({ verify: true })).rejects.toThrow('本次尚未保存');
    expect(mockSillyTavern.saveChat).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('事实和人物按 ID 匹配，不因实体排列改变而拒收', async () => {
    const chat = [{ mes: '正文', _qrf_world_simulation: { actors: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] } }];
    const remote = structuredClone(chat);
    remote[0]._qrf_world_simulation.actors.reverse();
    installReadback(chat, remote);
    await expect(saveChatToHostStrict_ACU({ verify: true })).resolves.toBeUndefined();
  });

  it.each(['正文', '私有字段丢失', '数组顺序', 'swipe'])('实际业务数据变化仍不误报保存成功：%s', async kind => {
    const chat = [{ mes: '正文', swipe_id: 0, _qrf_world_simulation: { ids: ['a', 'b'] } }];
    const remote: any[] = structuredClone(chat);
    if (kind === '正文') remote[0].mes = '另一段正文';
    if (kind === '私有字段丢失') delete remote[0]._qrf_world_simulation;
    if (kind === '数组顺序') remote[0]._qrf_world_simulation.ids.reverse();
    if (kind === 'swipe') remote[0].swipe_id = 1;
    installReadback(chat, remote);
    await expect(saveChatToHostStrict_ACU({ verify: true })).rejects.toThrow('第 1 楼正文或插件数据不同');
  });

  it('局部提交只核对目标字段，不因其它旧楼层差异拒收', async () => {
    const chat = [{ mes: '本地旧正文' }, { mes: '当前正文', _qrf_world_simulation_state: { revision: 2 } }];
    const remote = [{ mes: '服务器格式化的旧正文' }, { mes: '当前正文', _qrf_world_simulation_state: { revision: 2 } }];
    installReadback(chat, remote);
    await expect(saveChatToHostStrict_ACU({ verify: true, verifyFields: [{ messageIndex: 1, keys: ['mes', '_qrf_world_simulation_state'] }] })).resolves.toBeUndefined();
    remote[1]._qrf_world_simulation_state = { revision: 1 };
    await expect(saveChatToHostStrict_ACU({ verify: true, verifyFields: [{ messageIndex: 1, keys: ['_qrf_world_simulation_state'] }] }))
      .rejects.toThrow('第 2 楼字段 _qrf_world_simulation_state 未保存');
  });

  it('回读期间换聊天或服务器失败仍不能确认保存', async () => {
    const chat = [{ mes: '正文' }];
    installReadback(chat, structuredClone(chat));
    vi.stubGlobal('fetch', vi.fn(async () => { mockSillyTavern.chatId = 'another-chat'; return { ok: true, json: async () => [{}, ...chat] }; }));
    await expect(saveChatToHostStrict_ACU({ verify: true })).rejects.toThrow('聊天已切换');
    installReadback(chat, structuredClone(chat));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(saveChatToHostStrict_ACU({ verify: true })).rejects.toThrow('HTTP 500');
  });

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