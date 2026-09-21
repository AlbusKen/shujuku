/**
 * tests/shared/host-compat/native-st-backend.test.ts
 * SillyTavern 原生后端 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

import { createNativeStBackend_ACU } from '../../../src/shared/host-compat/native-st-backend';
import { classifyLorebookReadError_ACU } from '../../../src/shared/lorebook-read-error';

function makeBookData(entries: Record<string, any>) {
  return { entries };
}

function makeStApi(overrides: Record<string, any> = {}) {
  return {
    loadWorldInfo: vi.fn(),
    saveWorldInfo: vi.fn().mockResolvedValue(undefined),
    executeSlashCommandsWithOptions: vi.fn().mockResolvedValue({ pipe: 'ok' }),
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    chat: [],
    characters: [],
    characterId: undefined,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('世界书条目 CRUD', () => {
  it('getLorebookEntries：书不存在时抛错，且文案能被错误分类器识别为 lorebook_not_found', async () => {
    const stApi = makeStApi({ loadWorldInfo: vi.fn().mockResolvedValue(null) });
    const backend = createNativeStBackend_ACU(() => stApi);
    let caught: unknown;
    try {
      await backend.getLorebookEntries('不存在的书');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(classifyLorebookReadError_ACU(caught)).toBe('lorebook_not_found');
  });

  it('getLorebookEntries：原生字典转换为旧版扁平数组', async () => {
    const stApi = makeStApi({
      loadWorldInfo: vi.fn().mockResolvedValue(makeBookData({
        0: { uid: 0, comment: '条目0', content: 'A', disable: false, constant: true, key: ['k'] },
        3: { uid: 3, comment: '条目3', content: 'B', disable: true },
      })),
    });
    const backend = createNativeStBackend_ACU(() => stApi);
    const entries = await backend.getLorebookEntries('书');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ uid: 0, comment: '条目0', content: 'A', enabled: true, type: 'constant', keys: ['k'] });
    expect(entries[1]).toMatchObject({ uid: 3, comment: '条目3', enabled: false });
  });

  it('setLorebookEntries：按 uid 合并 patch 并立即保存；未知 uid 跳过且不阻断整批', async () => {
    const data = makeBookData({
      0: { uid: 0, comment: '旧标题', content: '旧内容', disable: false },
    });
    const stApi = makeStApi({ loadWorldInfo: vi.fn().mockResolvedValue(data) });
    const backend = createNativeStBackend_ACU(() => stApi);
    await backend.setLorebookEntries('书', [
      { uid: 0, comment: '新标题', enabled: false },
      { uid: 99, comment: '不存在' },
    ]);
    expect(data.entries[0]).toMatchObject({ comment: '新标题', disable: true, content: '旧内容' });
    expect(stApi.saveWorldInfo).toHaveBeenCalledWith('书', data, true);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('uid=99'));
  });

  it('createLorebookEntries：uid 取 max+1 递增，返回 new_uids 与完整条目集', async () => {
    const data = makeBookData({
      2: { uid: 2, comment: '已有' },
    });
    const stApi = makeStApi({ loadWorldInfo: vi.fn().mockResolvedValue(data) });
    const backend = createNativeStBackend_ACU(() => stApi);
    const result = await backend.createLorebookEntries('书', [
      { comment: '新条目', content: 'X', type: 'constant' },
      { comment: '第二条' },
    ]);
    expect(result.new_uids).toEqual([3, 4]);
    expect(data.entries[3]).toMatchObject({ uid: 3, comment: '新条目', content: 'X', constant: true, displayIndex: 3 });
    expect(data.entries[4]).toMatchObject({ uid: 4, comment: '第二条' });
    expect(result.entries).toHaveLength(3);
    expect(stApi.saveWorldInfo).toHaveBeenCalledTimes(1);
  });

  it('deleteLorebookEntries：删除存在的 uid 并报告 delete_occurred', async () => {
    const data = makeBookData({
      0: { uid: 0 },
      1: { uid: 1 },
    });
    const stApi = makeStApi({ loadWorldInfo: vi.fn().mockResolvedValue(data) });
    const backend = createNativeStBackend_ACU(() => stApi);
    const result = await backend.deleteLorebookEntries('书', [1, 42]);
    expect(result.delete_occurred).toBe(true);
    expect(data.entries[1]).toBeUndefined();
    expect(result.entries).toHaveLength(1);

    const noop = await backend.deleteLorebookEntries('书', [42]);
    expect(noop.delete_occurred).toBe(false);
  });
});

describe('世界书列表与角色绑定（经 /api/settings/get）', () => {
  it('getLorebooks：返回 world_names；请求失败时返回空数组', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ world_names: ['书A', '书B'], settings: '{}' }),
    }) as any;
    const backend = createNativeStBackend_ACU(() => makeStApi());
    expect(await backend.getLorebooks()).toEqual(['书A', '书B']);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as any;
    const failing = createNativeStBackend_ACU(() => makeStApi());
    expect(await failing.getLorebooks()).toEqual([]);
  });

  it('getLorebooks 在 TTL 内复用快照，forceRefresh 强制重新拉取', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ world_names: ['旧书'], settings: '{}' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ world_names: ['新书'], settings: '{}' }) });
    globalThis.fetch = fetchMock as any;
    const backend = createNativeStBackend_ACU(() => makeStApi());
    expect(await backend.getLorebooks()).toEqual(['旧书']);
    expect(await backend.getLorebooks()).toEqual(['旧书']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await backend.getLorebooks({ forceRefresh: true })).toEqual(['新书']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loadWorldInfo not-found 会使名单快照失效，下一次 getLorebooks 重新拉取', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ world_names: ['旧书'], settings: '{}' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ world_names: ['新书'], settings: '{}' }) });
    globalThis.fetch = fetchMock as any;
    const stApi = makeStApi({ loadWorldInfo: vi.fn().mockResolvedValue(null) });
    const backend = createNativeStBackend_ACU(() => stApi);
    expect(await backend.getLorebooks()).toEqual(['旧书']);
    await expect(backend.getLorebookEntries('旧书')).rejects.toThrow('不存在');
    expect(await backend.getLorebooks()).toEqual(['新书']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getCharWorldbookNames：primary 取角色卡 extensions.world，additional 按头像基名匹配 charLore', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        world_names: [],
        settings: JSON.stringify({ world_info: { charLore: [{ name: 'Alice', extraBooks: ['附加书1', '附加书2'] }] } }),
      }),
    }) as any;
    const stApi = makeStApi({
      characters: [{ name: 'Alice', avatar: 'Alice.png', data: { extensions: { world: '主书' } } }],
      characterId: 0,
    });
    const backend = createNativeStBackend_ACU(() => stApi);
    expect(await backend.getCharWorldbookNames('current')).toEqual({ primary: '主书', additional: ['附加书1', '附加书2'] });
  });

  it('未选中角色时返回空绑定而不抛错', async () => {
    const backend = createNativeStBackend_ACU(() => makeStApi());
    expect(await backend.getCharWorldbookNames('current')).toEqual({ primary: null, additional: [] });
    expect(await backend.getCurrentCharPrimaryLorebook()).toBeNull();
  });

  it('getCharLorebooks：type 过滤', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ world_names: [], settings: JSON.stringify({ world_info: { charLore: [{ name: 'Bob', extraBooks: ['附'] }] } }) }),
    }) as any;
    const stApi = makeStApi({
      characters: [{ name: 'Bob', avatar: 'Bob.png', data: { extensions: { world: '主' } } }],
      characterId: 0,
    });
    const backend = createNativeStBackend_ACU(() => stApi);
    expect(await backend.getCharLorebooks({ type: 'primary' })).toEqual({ primary: '主', additional: [] });
    expect(await backend.getCharLorebooks({ type: 'additional' })).toEqual({ primary: null, additional: ['附'] });
    expect(await backend.getCharLorebooks()).toEqual({ primary: '主', additional: ['附'] });
  });
});

describe('聊天消息与 Slash', () => {
  const chat = [
    { name: '用户', is_user: true, is_system: false, mes: '你好', extra: {} },
    { name: 'AI', is_user: false, is_system: false, mes: '回复1', extra: {} },
    { name: 'AI', is_user: false, is_system: true, mes: '隐藏消息', extra: {} },
    { name: 'AI', is_user: false, is_system: false, mes: '回复2', extra: {} },
  ];

  it('getChatMessages：支持 0-{{lastMessageId}} 宏范围并映射 is_user/message', async () => {
    const backend = createNativeStBackend_ACU(() => makeStApi({ chat }));
    const messages = await backend.getChatMessages('0-{{lastMessageId}}');
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ message_id: 0, is_user: true, role: 'user', message: '你好' });
    expect(messages[2]).toMatchObject({ message_id: 2, is_hidden: true, role: 'system' });
    expect(messages[3]).toMatchObject({ message_id: 3, role: 'assistant', message: '回复2' });
  });

  it('getChatMessages：负数索引取末尾楼层，单楼层数字', async () => {
    const backend = createNativeStBackend_ACU(() => makeStApi({ chat }));
    expect(await backend.getChatMessages(-1)).toHaveLength(1);
    expect((await backend.getChatMessages(-1))[0].message).toBe('回复2');
    expect((await backend.getChatMessages(1))[0].message).toBe('回复1');
  });

  it('getChatMessages：role 与 hide_state 过滤', async () => {
    const backend = createNativeStBackend_ACU(() => makeStApi({ chat }));
    expect(await backend.getChatMessages('0-3', { role: 'user' })).toHaveLength(1);
    expect(await backend.getChatMessages('0-3', { hide_state: 'unhidden' })).toHaveLength(3);
    expect(await backend.getChatMessages('0-3', { hide_state: 'hidden' })).toHaveLength(1);
  });

  it('getLastMessageId：空聊天返回 -1', () => {
    expect(createNativeStBackend_ACU(() => makeStApi({ chat })).getLastMessageId()).toBe(3);
    expect(createNativeStBackend_ACU(() => makeStApi()).getLastMessageId()).toBe(-1);
  });

  it('triggerSlash：经 executeSlashCommandsWithOptions 返回 pipe', async () => {
    const stApi = makeStApi({ executeSlashCommandsWithOptions: vi.fn().mockResolvedValue({ pipe: '结果' }) });
    const backend = createNativeStBackend_ACU(() => stApi);
    expect(await backend.triggerSlash('/echo hi')).toBe('结果');
    expect(stApi.executeSlashCommandsWithOptions).toHaveBeenCalledWith('/echo hi');
  });
});

describe('可用性判定', () => {
  it('loadWorldInfo/saveWorldInfo/executeSlashCommandsWithOptions 齐备时可用', () => {
    expect(createNativeStBackend_ACU(() => makeStApi()).isUsable()).toBe(true);
    expect(createNativeStBackend_ACU(() => ({}) as any).isUsable()).toBe(false);
    expect(createNativeStBackend_ACU(() => null).isUsable()).toBe(false);
  });
});
