/**
 * tests/shared/host-compat/tavern-helper-compat.test.ts
 * TavernHelper 三级择优兼容适配器 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

import {
  buildTavernHelperCompat_ACU,
  getLastHostCapabilities_ACU,
  formatHostCapabilities_ACU,
} from '../../../src/shared/host-compat/tavern-helper-compat';

/** 原生后端可用的最小 ST context */
function makeUsableStApi(overrides: Record<string, any> = {}) {
  return {
    loadWorldInfo: vi.fn(),
    saveWorldInfo: vi.fn(),
    executeSlashCommandsWithOptions: vi.fn().mockResolvedValue({ pipe: '' }),
    chat: [],
    characters: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('passthrough（旧版酒馆助手全量 API）', () => {
  it('全部旧方法直接透传，行为零变化', async () => {
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
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.getLorebookEntries).toBe('passthrough');
    expect(capabilities.getCharWorldbookNames).toBe('passthrough');
    expect(capabilities.getCurrentCharPrimaryLorebook).toBe('mapped');
    expect(capabilities.getCharLorebooks).toBe('mapped');
    expect(await api.getLorebookEntries('书')).toEqual([{ uid: 1 }]);
    expect(rawTH.getLorebookEntries).toHaveBeenCalledWith('书');
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

  it('getLorebookEntries ← getWorldbook，输出旧版扁平格式', async () => {
    const rawTH = { getWorldbook: vi.fn().mockResolvedValue([newEntry]) };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.getLorebookEntries).toBe('mapped');
    const entries = await api.getLorebookEntries('书');
    expect(rawTH.getWorldbook).toHaveBeenCalledWith('书');
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

  it('getLorebooks ← getWorldbookNames；getCurrentCharPrimaryLorebook/getCharLorebooks ← getCharWorldbookNames', async () => {
    const rawTH = {
      getWorldbookNames: vi.fn().mockReturnValue(['A', 'B']),
      getCharWorldbookNames: vi.fn().mockReturnValue({ primary: '主书', additional: ['附1'] }),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.getLorebooks).toBe('mapped');
    expect(capabilities.getCurrentCharPrimaryLorebook).toBe('mapped');
    expect(capabilities.getCharLorebooks).toBe('mapped');
    expect(capabilities.getCharWorldbookNames).toBe('passthrough');
    expect(await api.getLorebooks()).toEqual(['A', 'B']);
    expect(await api.getCurrentCharPrimaryLorebook()).toBe('主书');
    expect(await api.getCharLorebooks({ type: 'additional' })).toEqual({ primary: null, additional: ['附1'] });
    expect(await api.getCharLorebooks()).toEqual({ primary: '主书', additional: ['附1'] });
  });

  it('getCharWorldbookNames ← 旧版 getCharLorebooks 反向映射', async () => {
    const rawTH = { getCharLorebooks: vi.fn().mockResolvedValue({ primary: '主', additional: ['附'] }) };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => null);
    expect(capabilities.getCharWorldbookNames).toBe('mapped');
    expect(await api.getCharWorldbookNames('current')).toEqual({ primary: '主', additional: ['附'] });
    expect(rawTH.getCharLorebooks).toHaveBeenCalledWith({ type: 'all' });
  });
});

describe('世界书后端组', () => {
  it('raw TavernHelper 存在但缺少条目读取时保持缺失，不调用 native 后端', async () => {
    const stApi = makeUsableStApi({
      loadWorldInfo: vi.fn().mockResolvedValue({ entries: { 1: { uid: 1 } } }),
    });
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '主书', additional: [] }),
    };

    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => stApi);

    expect(capabilities.getCharWorldbookNames).toBe('passthrough');
    expect(capabilities.getLorebookEntries).toBe('missing');
    expect(api.getLorebookEntries).toBeUndefined();
    expect(await api.getCharWorldbookNames('current')).toEqual({ primary: '主书', additional: [] });
    expect(stApi.loadWorldInfo).not.toHaveBeenCalled();
  });

  it('派生绑定视图复用同一个 getCharWorldbookNames 来源', async () => {
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '主书', additional: ['附书'] }),
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => null);
    await expect(api.getCurrentCharPrimaryLorebook()).resolves.toBe('主书');
    await expect(api.getCharLorebooks({ type: 'additional' })).resolves.toEqual({ primary: null, additional: ['附书'] });
    expect(rawTH.getCharWorldbookNames).toHaveBeenCalledTimes(2);
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

  it('native 路径的 invalidateLorebookListSnapshot 使 getLorebooks 重新拉取', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ world_names: ['旧书'], settings: '{}' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ world_names: ['新书'], settings: '{}' }) });
    globalThis.fetch = fetchMock as any;
    try {
      const { api } = buildTavernHelperCompat_ACU(undefined, () => makeUsableStApi());
      expect(await api.getLorebooks()).toEqual(['旧书']);
      expect(await api.getLorebooks()).toEqual(['旧书']);
      api.invalidateLorebookListSnapshot();
      expect(await api.getLorebooks()).toEqual(['新书']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
