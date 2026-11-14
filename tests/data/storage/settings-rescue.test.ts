import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  win: {} as any,
  ns: null as any,
  state: 'unsaved' as string,
  stateListeners: new Set<(state: string) => void>(),
  writeListeners: new Set<(seq: number) => void>(),
  backup: null as any,
  persist: vi.fn(() => 7),
}));

vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: h.win }));
vi.mock('../../../src/shared/constants', () => ({ SCRIPT_ID_PREFIX_ACU: 'ACU' }));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));
vi.mock('../../../src/data/storage/tavern-storage', () => ({
  TAVERN_SETTINGS_NAMESPACE_ACU: 'ACU__userscript_settings_v1',
  readSettingsWrittenAt_ACU: (entries: any) => Number(entries?.__acuSettingsWrittenAt) || 0,
  getTavernSettingsNamespace_ACU: () => h.ns,
  persistTavernSettings_ACU: h.persist,
}));
vi.mock('../../../src/data/storage/settings-namespace-backup', () => ({
  buildSettingsNamespaceBackup_ACU: () => h.backup,
}));
vi.mock('../../../src/data/storage/settings-save-confirm', () => ({
  getSettingsPersistenceState_ACU: () => h.state,
  subscribeSettingsPersistence_ACU: (listener: (state: string) => void) => {
    h.stateListeners.add(listener);
    return () => { h.stateListeners.delete(listener); };
  },
  subscribeSettingsWrites_ACU: (listener: (seq: number) => void) => {
    h.writeListeners.add(listener);
    return () => { h.writeListeners.delete(listener); };
  },
}));

import {
  SETTINGS_RESCUE_WRITE_DELAY_MS_ACU,
  applySettingsRescueEntries_ACU,
  installSettingsRescueWriter_ACU,
  readSettingsRescue_ACU,
  selectSettingsRescueCandidates_ACU,
  writeSettingsRescue_ACU,
  _resetSettingsRescue_ACU,
  type SettingsRescueRecord_ACU,
  type StoredSettingsRescue_ACU,
} from '../../../src/data/storage/settings-rescue';

function makeRecord(writtenAt: number, declinedWrittenAt: number | null = null): SettingsRescueRecord_ACU {
  return {
    format: 'acu-settings-rescue',
    version: 1,
    writtenAt,
    savedAt: writtenAt,
    declinedWrittenAt,
    backup: {
      format: 'acu-settings-namespace-backup', version: 1, namespace: 'ACU__userscript_settings_v1',
      createdAt: writtenAt, persistence: 'unsaved', latestWriteSeq: 1, confirmedWriteSeq: 0,
      entries: { __acuSettingsWrittenAt: writtenAt, profile: 'p' },
    },
  };
}

function createFakeIndexedDb() {
  const data = new Map<string, unknown>();
  const request = (fn: () => unknown, tx?: any) => {
    const req: any = {};
    queueMicrotask(() => {
      try { req.result = fn(); req.onsuccess?.(); } catch (error) { req.error = error; req.onerror?.(); return; }
      if (tx) queueMicrotask(() => tx.oncomplete?.());
    });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    transaction: () => {
      const tx: any = {};
      tx.objectStore = () => ({
        get: (key: string) => request(() => data.get(key), tx),
        put: (value: unknown, key: string) => request(() => { data.set(key, structuredClone(value)); return key; }, tx),
      });
      return tx;
    },
  };
  return { data, indexedDB: { open: () => request(() => db) } };
}

const emitWrite = () => { for (const listener of [...h.writeListeners]) listener(1); };

beforeEach(() => {
  _resetSettingsRescue_ACU();
  for (const key of Object.keys(h.win)) delete h.win[key];
  h.ns = null;
  h.state = 'unsaved';
  h.backup = null;
  h.persist.mockClear();
  h.stateListeners.clear();
  h.writeListeners.clear();
});

afterEach(() => {
  _resetSettingsRescue_ACU();
  vi.useRealTimers();
});

describe('selectSettingsRescueCandidates_ACU', () => {
  const stored = (record: SettingsRescueRecord_ACU): StoredSettingsRescue_ACU => ({ backend: 'indexeddb', record });

  it('宿主标记未知时不提示', () => {
    expect(selectSettingsRescueCandidates_ACU([stored(makeRecord(200))], null)).toEqual([]);
  });

  it('副本新于宿主时提示，旧于或等于宿主时不提示，按新到旧排序', () => {
    const result = selectSettingsRescueCandidates_ACU([
      stored(makeRecord(150)), stored(makeRecord(300)), stored(makeRecord(100)), stored(makeRecord(80)),
    ], 100);
    expect(result.map(item => item.record.writtenAt)).toEqual([300, 150]);
  });

  it('已忽略的副本不再提示', () => {
    expect(selectSettingsRescueCandidates_ACU([stored(makeRecord(200, 200))], 100)).toEqual([]);
  });
});

describe('保全副本读写', () => {
  it('有 TT extension.store 时优先写入它', async () => {
    const setJson = vi.fn(async () => undefined);
    h.win.__TAURITAVERN__ = { api: { extension: { store: { setJson, tryGetJson: vi.fn() } } } };
    await expect(writeSettingsRescue_ACU(makeRecord(200))).resolves.toBe('tauritavern-store');
    expect(setJson).toHaveBeenCalledWith({ namespace: 'acu-shujuku', key: 'settings-rescue', value: makeRecord(200) });
  });

  it('TT extension.store 写入失败时回退到 IndexedDB，两个后端都能读回', async () => {
    const fake = createFakeIndexedDb();
    h.win.indexedDB = fake.indexedDB;
    h.win.__TAURITAVERN__ = { api: { extension: { store: {
      setJson: vi.fn(async () => { throw new Error('commit failed'); }),
      tryGetJson: vi.fn(async () => ({ found: true, value: makeRecord(150) })),
    } } } };
    await expect(writeSettingsRescue_ACU(makeRecord(200))).resolves.toBe('indexeddb');
    const result = await readSettingsRescue_ACU();
    expect(result.failures).toEqual([]);
    expect(result.records.map(item => [item.backend, item.record.writtenAt])).toEqual([
      ['tauritavern-store', 150], ['indexeddb', 200],
    ]);
  });

  it('格式无效与读取失败都记入 failures', async () => {
    h.win.__TAURITAVERN__ = { api: { extension: { store: {
      setJson: vi.fn(),
      tryGetJson: vi.fn(async () => ({ found: true, value: { format: 'other' } })),
    } } } };
    h.win.indexedDB = { open: () => { throw new Error('blocked'); } };
    const result = await readSettingsRescue_ACU();
    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([
      { backend: 'tauritavern-store', message: '副本格式无效' },
      { backend: 'indexeddb', message: 'blocked' },
    ]);
  });

  it('都不可用时返回 null', async () => {
    await expect(writeSettingsRescue_ACU(makeRecord(200))).resolves.toBeNull();
  });
});

describe('installSettingsRescueWriter_ACU', () => {
  it('未落盘时防抖写入命名空间快照，相同写入标记不重复写', async () => {
    vi.useFakeTimers();
    const setJson = vi.fn(async () => undefined);
    h.win.__TAURITAVERN__ = { api: { extension: { store: { setJson, tryGetJson: vi.fn() } } } };
    h.backup = makeRecord(200).backup;
    installSettingsRescueWriter_ACU();
    emitWrite();
    emitWrite();
    await vi.advanceTimersByTimeAsync(SETTINGS_RESCUE_WRITE_DELAY_MS_ACU);
    await vi.waitFor(() => expect(setJson).toHaveBeenCalledOnce());
    expect(setJson.mock.calls[0][0]).toMatchObject({ value: { writtenAt: 200, declinedWrittenAt: null, backup: h.backup } });
    emitWrite();
    await vi.advanceTimersByTimeAsync(SETTINGS_RESCUE_WRITE_DELAY_MS_ACU);
    expect(setJson).toHaveBeenCalledOnce();
  });

  it('已确认时不写副本', async () => {
    vi.useFakeTimers();
    const setJson = vi.fn(async () => undefined);
    h.win.__TAURITAVERN__ = { api: { extension: { store: { setJson, tryGetJson: vi.fn() } } } };
    h.backup = makeRecord(200).backup;
    h.state = 'confirmed';
    installSettingsRescueWriter_ACU();
    emitWrite();
    await vi.advanceTimersByTimeAsync(SETTINGS_RESCUE_WRITE_DELAY_MS_ACU * 2);
    expect(setJson).not.toHaveBeenCalled();
  });
});

describe('applySettingsRescueEntries_ACU', () => {
  it('只覆盖副本中的键并请求宿主保存', () => {
    h.ns = { profile: 'old', other: 'keep' };
    expect(applySettingsRescueEntries_ACU({ profile: 'new', __acuSettingsWrittenAt: 200 })).toBe(7);
    expect(h.ns).toEqual({ profile: 'new', other: 'keep', __acuSettingsWrittenAt: 200 });
    expect(h.persist).toHaveBeenCalledOnce();
  });

  it('酒馆设置不可用时抛错且不保存', () => {
    expect(() => applySettingsRescueEntries_ACU({ profile: 'new' })).toThrow('酒馆设置不可用');
    expect(h.persist).not.toHaveBeenCalled();
  });
});
