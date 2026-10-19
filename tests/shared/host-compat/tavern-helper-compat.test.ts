/**
 * tests/shared/host-compat/tavern-helper-compat.test.ts
 * TavernHelper 三级择优兼容适配器 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockHost, mockWorldInfoModule, mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockHost: {} as any,
  mockWorldInfoModule: {} as any,
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

vi.mock('../../../src/shared/runtime-env', () => ({ getHostWindow: () => mockHost }));

import {
  buildTavernHelperCompat_ACU,
  getLastHostCapabilities_ACU,
  formatHostCapabilities_ACU,
} from '../../../src/shared/host-compat/tavern-helper-compat';

/** 原生后端可用的最小 ST context */
function makeUsableStApi(overrides: Record<string, any> = {}) {
  return {
    loadWorldInfo: vi.fn().mockResolvedValue({ entries: {} }),
    saveWorldInfo: vi.fn(),
    executeSlashCommandsWithOptions: vi.fn().mockResolvedValue({ pipe: '' }),
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'test' }),
    chat: [],
    characters: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockHost).forEach(key => delete mockHost[key]);
  Object.keys(mockWorldInfoModule).forEach(key => delete mockWorldInfoModule[key]);
  Object.assign(mockWorldInfoModule, { world_info: {}, world_names: ['书'] });
  mockHost.fetch = vi.fn(() => { throw new Error('原生适配不应另发 HTTP 请求'); });
  mockHost.location = { href: 'https://tavern.test/', origin: 'https://tavern.test' };
  mockHost.document = {
    createElement: () => ({ remove: vi.fn() }),
    head: { appendChild: () => {
      const key = Object.keys(mockHost).find(key => key.startsWith('__ACU_WI_MODULE_'))!;
      mockHost[key].resolve(mockWorldInfoModule);
    } },
  };
});

afterEach(() => vi.restoreAllMocks());

describe('passthrough（旧版酒馆助手全量 API）', () => {
  it('旧版写入继续透传，读取直接使用 SillyTavern 原生能力', async () => {
    const rawTH = {
      getLorebookEntries: vi.fn().mockResolvedValue([{ uid: 1 }]),
      setLorebookEntries: vi.fn(),
      createLorebookEntries: vi.fn(),
      deleteLorebookEntries: vi.fn(),
      getLorebooks: vi.fn().mockReturnValue(['书']),
      getCurrentCharPrimaryLorebook: vi.fn(),
      getCharLorebooks: vi.fn(),
      getChatMessages: vi.fn(),
      getLastMessageId: vi.fn(),
      triggerSlash: vi.fn(),
      getCharData: vi.fn(),
      generateRaw: vi.fn(),
      getCharWorldbookNames: vi.fn(),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => makeUsableStApi());
    expect(capabilities.getLorebookEntries).toBe('native');
    expect(capabilities.getCharWorldbookNames).toBe('native');
    expect(capabilities.setLorebookEntries).toBe('passthrough');
    expect(await api.getLorebookEntries('书')).toEqual([]);
    expect(rawTH.getLorebookEntries).not.toHaveBeenCalled();
    await api.setLorebookEntries('书', [{ uid: 1 }]);
    expect(rawTH.setLorebookEntries).toHaveBeenCalledWith('书', [{ uid: 1 }]);
  });

  it('未适配的其余属性原样透传', () => {
    const rawTH = { getTavernHelperVersion: () => '3.0.0', triggerSlash: vi.fn() };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(api.getTavernHelperVersion()).toBe('3.0.0');
  });

  it('passthrough 路径仍暴露 invalidateLorebookListSnapshot，调用原生快照失效且安全', () => {
    const rawTH = { getLorebooks: vi.fn().mockReturnValue(['书']) };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(typeof api.invalidateLorebookListSnapshot).toBe('function');
    expect(() => api.invalidateLorebookListSnapshot()).not.toThrow();
  });
});

describe('mapped（新版改名 API）', () => {
  const newEntry = {
    uid: 5,
    name: '新条目',
    enabled: true,
    strategy: { type: 'selective', keys: ['k'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
    position: { type: 'at_depth', role: 'user', depth: 3, order: 10 },
    content: 'C',
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
  };

  it('新版助手存在时仍读取原生条目，输出旧版扁平格式', async () => {
    const rawTH = { getWorldbook: vi.fn().mockResolvedValue([newEntry]) };
    mockWorldInfoModule.loadWorldInfo = vi.fn().mockResolvedValue({ entries: {
      5: { uid: 5, comment: '新条目', content: 'C', position: 4, role: 1, depth: 3, order: 10, preventRecursion: true },
    } });
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => makeUsableStApi());
    expect(capabilities.getLorebookEntries).toBe('native');
    const entries = await api.getLorebookEntries('书');
    expect(rawTH.getWorldbook).not.toHaveBeenCalled();
    expect(entries[0]).toMatchObject({
      uid: 5,
      comment: '新条目',
      position: 'at_depth_as_user',
      depth: 3,
      order: 10,
      prevent_recursion: true,
      content: 'C',
    });
  });

  it('setLorebookEntries ← updateWorldbookWith，按 uid 合并且保留未指定字段', async () => {
    let capturedUpdater: any;
    const rawTH = {
      updateWorldbookWith: vi.fn().mockImplementation(async (_book: string, updater: any) => {
        capturedUpdater = updater;
        return updater([structuredClone(newEntry)]);
      }),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.setLorebookEntries).toBe('mapped');
    await api.setLorebookEntries('书', [{ uid: 5, comment: '改名', enabled: false }]);
    expect(rawTH.updateWorldbookWith).toHaveBeenCalledWith('书', expect.any(Function));
    const updated = capturedUpdater([structuredClone(newEntry)]);
    expect(updated[0].name).toBe('改名');
    expect(updated[0].enabled).toBe(false);
    // 未指定字段保持原值
    expect(updated[0].content).toBe('C');
    expect(updated[0].position).toEqual(newEntry.position);
  });

  it('createLorebookEntries ← createWorldbookEntries，返回 {entries, new_uids}', async () => {
    const rawTH = {
      createWorldbookEntries: vi.fn().mockResolvedValue({
        worldbook: [newEntry, { ...newEntry, uid: 6, name: '新增' }],
        new_entries: [{ ...newEntry, uid: 6, name: '新增' }],
      }),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.createLorebookEntries).toBe('mapped');
    const result = await api.createLorebookEntries('书', [{ comment: '新增', content: 'X' }]);
    expect(rawTH.createWorldbookEntries).toHaveBeenCalledWith('书', [expect.objectContaining({ name: '新增', content: 'X' })]);
    expect(result.new_uids).toEqual([6]);
    expect(result.entries).toHaveLength(2);
  });

  it('deleteLorebookEntries ← deleteWorldbookEntries，uid 谓词', async () => {
    const rawTH = {
      deleteWorldbookEntries: vi.fn().mockImplementation(async (_book: string, predicate: any) => {
        const all = [newEntry, { ...newEntry, uid: 6 }];
        const deleted = all.filter(predicate);
        return { worldbook: all.filter(e => !predicate(e)), deleted_entries: deleted };
      }),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.deleteLorebookEntries).toBe('mapped');
    const result = await api.deleteLorebookEntries('书', [6]);
    expect(result.delete_occurred).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it('目录与派生绑定均使用当前宿主，不调用新版助手缓存', async () => {
    const rawTH = {
      getWorldbookNames: vi.fn().mockReturnValue(['A', 'B']),
      getCharWorldbookNames: vi.fn().mockReturnValue({ primary: '主书', additional: ['附1'] }),
    };
    mockHost.document.head.appendChild = () => {
      const key = Object.keys(mockHost).find(key => key.startsWith('__ACU_WI_MODULE_'))!;
      mockHost[key].resolve({ world_names: ['A', 'B'], world_info: { charLore: [{ name: '角色', extraBooks: ['附1'] }] } });
    };
    const st = makeUsableStApi({ characterId: 0, characters: [{ avatar: '角色.png', data: { extensions: { world: '主书' } } }] });
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => st);
    expect(capabilities.getLorebooks).toBe('native');
    expect(capabilities.getCharWorldbookNames).toBe('native');
    expect(await api.getLorebooks()).toEqual(['A', 'B']);
    expect(await api.getCurrentCharPrimaryLorebook()).toBe('主书');
    expect(await api.getCharLorebooks({ type: 'additional' })).toEqual({ primary: null, additional: ['附1'] });
    expect(await api.getCharLorebooks()).toEqual({ primary: '主书', additional: ['附1'] });
    expect(rawTH.getCharWorldbookNames).not.toHaveBeenCalled();
    expect(rawTH.getWorldbookNames).not.toHaveBeenCalled();
  });

  it('缺少宿主绑定能力时不回退旧版绑定缓存', async () => {
    const rawTH = { getCharLorebooks: vi.fn().mockResolvedValue({ primary: '主', additional: ['附'] }) };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.getCharWorldbookNames).toBe('missing');
    expect(api.getCharWorldbookNames).toBeUndefined();
    expect(rawTH.getCharLorebooks).not.toHaveBeenCalled();
  });
});

describe('世界书后端组', () => {
  it('context 未导出 loader 时仍可使用原生模块 loadWorldInfo', async () => {
    mockWorldInfoModule.loadWorldInfo = vi.fn().mockResolvedValue({ entries: { 1: { uid: 1 } } });
    const stApi = makeUsableStApi({
      loadWorldInfo: undefined,
    });
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '主书', additional: [] }),
    };

    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => stApi);

    expect(capabilities.getCharWorldbookNames).toBe('native');
    expect(capabilities.getLorebookEntries).toBe('native');
    expect(capabilities.getLorebooks).toBe('native');
    expect(await api.getLorebookEntries('书')).toMatchObject([{ uid: 1 }]);
    expect(await api.getCharWorldbookNames('current')).toEqual({ primary: null, additional: [] });
    expect(mockWorldInfoModule.loadWorldInfo).toHaveBeenCalledWith('书');
    expect(mockHost.fetch).not.toHaveBeenCalled();
  });

  it('派生绑定视图复用同一个 getCharWorldbookNames 来源', async () => {
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '主书', additional: ['附书'] }),
    };
    const st = makeUsableStApi({ characterId: 0, characters: [{ avatar: '角色.png', data: { extensions: { world: '主书' } } }] });
    mockHost.document.head.appendChild = () => {
      const key = Object.keys(mockHost).find(key => key.startsWith('__ACU_WI_MODULE_'))!;
      mockHost[key].resolve({ world_info: { charLore: [{ name: '角色', extraBooks: ['附书'] }] } });
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => st);
    await expect(api.getCurrentCharPrimaryLorebook()).resolves.toBe('主书');
    await expect(api.getCharLorebooks({ type: 'additional' })).resolves.toEqual({ primary: null, additional: ['附书'] });
    expect(rawTH.getCharWorldbookNames).not.toHaveBeenCalled();
  });
});

describe('native（无酒馆助手，SillyTavern 原生兜底）', () => {
  it('rawTH 为 undefined 且 ST 可用时，核心方法全部落到 native', () => {
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi());
    for (const method of [
      'getLorebookEntries', 'setLorebookEntries', 'createLorebookEntries', 'deleteLorebookEntries',
      'getLorebooks', 'getCurrentCharPrimaryLorebook', 'getCharLorebooks', 'getCharWorldbookNames',
      'getChatMessages', 'getLastMessageId', 'triggerSlash', 'getCharData',
    ]) {
      expect(capabilities[method]).toBe('native');
      expect(typeof api[method]).toBe('function');
    }
  });

  it('generateRaw 无原生实现：不挂载并记为 missing', () => {
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi());
    expect(capabilities.generateRaw).toBe('missing');
    expect(api.generateRaw).toBeUndefined();
  });

  it('native 的 triggerSlash 实际调用 ST 原生 slash 执行器', async () => {
    const stApi = makeUsableStApi({ executeSlashCommandsWithOptions: vi.fn().mockResolvedValue({ pipe: 'p' }) });
    const { api } = buildTavernHelperCompat_ACU(undefined, () => stApi);
    expect(await api.triggerSlash('/trigger')).toBe('p');
  });

  it('目录每次读取原生实时导出，不依赖快照失效调用', async () => {
    mockWorldInfoModule.world_names = ['旧书'];
    const { api } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi());
    expect(await api.getLorebooks()).toEqual(['旧书']);
    mockWorldInfoModule.world_names = ['新书'];
    api.invalidateLorebookListSnapshot();
    expect(await api.getLorebooks()).toEqual(['新书']);
    expect(mockHost.fetch).not.toHaveBeenCalled();
  });

  it('rawTH 与 ST 都不可用时全部记为 missing', () => {
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => null);
    expect(Object.values(capabilities).every(backend => backend === 'missing')).toBe(true);
    expect(api.getLorebookEntries).toBeUndefined();
    expect(api.triggerSlash).toBeUndefined();
  });
});

describe('能力表诊断', () => {
  it('getLastHostCapabilities 返回最近一次构建结果；formatHostCapabilities 列出缺失项', () => {
    buildTavernHelperCompat_ACU(undefined, () => null);
    const capabilities = getLastHostCapabilities_ACU();
    expect(capabilities).not.toBeNull();
    const text = formatHostCapabilities_ACU(capabilities);
    expect(text).toContain('缺失');
    expect(text).toContain('getLorebookEntries');
    expect(formatHostCapabilities_ACU(null)).toContain('尚未生成');
  });
});

describe('原生读取边界', () => {
  it('特殊书名原样传给 loadWorldInfo，每次操作重新调用原生加载器', async () => {
    const name = '  全角Ａ / "引号" & # + \u200b ';
    mockWorldInfoModule.world_names = [name];
    let revision = 0;
    const loadWorldInfo = vi.fn(async () => ({ entries: { 1: { uid: 1, content: `版本${++revision}` } } }));
    const { api } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi({ loadWorldInfo }));
    expect(await api.getLorebooks()).toEqual([name]);
    expect(await api.getLorebookEntries(name)).toMatchObject([{ content: '版本1' }]);
    expect(await api.getLorebookEntries(name)).toMatchObject([{ content: '版本2' }]);
    expect(loadWorldInfo.mock.calls).toEqual([[name], [name]]);
    expect(mockHost.fetch).not.toHaveBeenCalled();
  });

  it('合法空书与目录中不存在的书可区分，不调用失效书的加载器', async () => {
    const st = makeUsableStApi();
    const { api } = buildTavernHelperCompat_ACU(undefined, () => st);
    await expect(api.getLorebookEntries('书')).resolves.toEqual([]);
    mockWorldInfoModule.world_names = [];
    await expect(api.getLorebookEntries('书')).rejects.toMatchObject({ category: 'lorebook_not_found' });
    expect(st.loadWorldInfo).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { entries: [] }, { entries: null }])('原生返回无效数据时不伪装成空书：%j', async data => {
    const st = makeUsableStApi({ loadWorldInfo: vi.fn().mockResolvedValue(data) });
    const { api } = buildTavernHelperCompat_ACU(undefined, () => st);
    await expect(api.getLorebookEntries('书')).rejects.toMatchObject({ category: 'unknown', reason: 'invalid_payload' });
  });

  it.each(['Error', 'AbortError'])('原生加载器拒绝时原样传递 %s，不切换读取来源', async name => {
    const error = Object.assign(new Error('原生加载失败'), { name });
    const st = makeUsableStApi({ loadWorldInfo: vi.fn().mockRejectedValue(error) });
    const raw = { getLorebookEntries: vi.fn() };
    const { api } = buildTavernHelperCompat_ACU(raw, () => st);
    await expect(api.getLorebookEntries('书')).rejects.toBe(error);
    expect(raw.getLorebookEntries).not.toHaveBeenCalled();
    expect(mockHost.fetch).not.toHaveBeenCalled();
  });

  it.each(['primary', 'additional', 'chat', 'deleted'])('原生读取期间 %s 变化时拒绝迟到结果', async kind => {
    const st = makeUsableStApi({ characterId: 0, chatId: 'chat-1', characters: [
      { avatar: '角色.png', data: { extensions: { world: '书' } } },
    ] });
    mockWorldInfoModule.world_info = { charLore: [{ name: '角色', extraBooks: ['书'] }] };
    st.loadWorldInfo.mockImplementation(async () => {
      if (kind === 'primary') st.characters[0].data.extensions.world = '';
      if (kind === 'additional') mockWorldInfoModule.world_info.charLore[0].extraBooks = [];
      if (kind === 'chat') st.chatId = 'chat-2';
      if (kind === 'deleted') mockWorldInfoModule.world_names = [];
      return { entries: { 1: { uid: 1, content: '迟到内容' } } };
    });
    const { api } = buildTavernHelperCompat_ACU(undefined, () => st);
    await expect(api.getLorebookEntries('书')).rejects.toMatchObject({
      category: kind === 'deleted' ? 'lorebook_not_found' : 'scope_changed',
    });
  });

  it('保留宿主待保存编辑，不清除或改写原生缓存', async () => {
    const cached = { entries: { 1: { uid: 1, content: '待保存编辑', key: ['关键词'] } } };
    const cache = { delete: vi.fn(), clear: vi.fn(), set: vi.fn() };
    mockWorldInfoModule.worldInfoCache = cache;
    mockWorldInfoModule.loadWorldInfo = vi.fn(async () => cached);
    const st = makeUsableStApi();
    const { api } = buildTavernHelperCompat_ACU(undefined, () => st);
    expect(await api.getLorebookEntries('书')).toMatchObject([{ content: '待保存编辑' }]);
    expect(cached.entries[1]).toEqual({ uid: 1, content: '待保存编辑', key: ['关键词'] });
    expect(cache.delete).not.toHaveBeenCalled();
    expect(cache.clear).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(st.saveWorldInfo).not.toHaveBeenCalled();
    expect(st.loadWorldInfo).not.toHaveBeenCalled();
    expect(mockHost.fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, ['书', 1], [' ']])('原生目录无效时拒绝读取：%j', async names => {
    mockWorldInfoModule.world_names = names;
    const { api } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi());
    await expect(api.getLorebooks()).rejects.toMatchObject({ category: 'unknown', operation: 'catalog' });
  });

  it('宿主模块加载失败后清理桥接，并允许重新加载', async () => {
    mockHost.document.head.appendChild = (script: any) => script.onerror();
    const { api } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi());
    await expect(api.getLorebooks()).rejects.toMatchObject({ category: 'api_unavailable' });
    expect(Object.keys(mockHost).some(key => key.startsWith('__ACU_WI_MODULE_'))).toBe(false);
    mockHost.document.head.appendChild = () => {
      const key = Object.keys(mockHost).find(key => key.startsWith('__ACU_WI_MODULE_'))!;
      mockHost[key].resolve(mockWorldInfoModule);
    };
    await expect(api.getLorebooks()).resolves.toEqual(['书']);
  });
});
