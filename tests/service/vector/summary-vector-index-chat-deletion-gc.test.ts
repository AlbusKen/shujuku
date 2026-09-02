/**
 * tests/service/vector/summary-vector-index-chat-deletion-gc.test.ts
 * P7：聊天删除向量清理的安全边界与清理编排验收。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  currentChatKey: 'current-chat-a',
  aliveChatNames: null as Set<string> | null,
  registryFiles: [] as any[],
  listAliveChats: vi.fn(),
  deleteHotCacheByScope: vi.fn(),
  clearFlushTasksByScope: vi.fn(),
  safeGc: vi.fn(),
  decodeScope: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  listAllHostChatNames_ACU: (...args: any[]) => h.listAliveChats(...args),
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  deleteSummaryVectorHotCacheByScope_ACU: (...args: any[]) => h.deleteHotCacheByScope(...args),
  clearSummaryVectorFlushTasksByScope_ACU: (...args: any[]) => h.clearFlushTasksByScope(...args),
}));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', () => ({
  loadVectorIndexRegistry_ACU: async () => ({ version: 1, updatedAt: '', files: h.registryFiles }),
  // 与真实实现同语义：新条目自带 scope 优先，旧条目退回路径反解。
  resolveVectorIndexRegistryFileScope_ACU: (file: any) => file?.scope ?? h.decodeScope(String(file?.path || '')),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  cleanupUnreachableSummaryVectorIndexFiles_ACU: (...args: any[]) => h.safeGc(...args),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return h.currentChatKey; },
}));
vi.mock('../../../src/shared/utils', () => ({
  cleanChatName_ACU: (name: string) => String(name || '').replace(/\.jsonl$|\.json$/i, ''),
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import {
  cleanupSummaryVectorIndexForDeletedChat_ACU,
  sweepOrphanSummaryVectorIndexFiles_ACU,
} from '../../../src/service/vector/summary-vector-index-chat-deletion-gc';

function registryFile(path: string, scope?: { chatKey: string; isolationKey: string; sourceTableKey: string }): any {
  return { path, role: 'snapshot', publicationState: 'published', ...(scope ? { scope } : {}) };
}

describe('cleanupSummaryVectorIndexForDeletedChat_ACU 安全边界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.currentChatKey = 'current-chat-a';
    h.registryFiles = [];
    h.listAliveChats.mockImplementation(async () => h.aliveChatNames);
    h.aliveChatNames = new Set<string>();
    h.deleteHotCacheByScope.mockResolvedValue(undefined);
    h.clearFlushTasksByScope.mockResolvedValue(undefined);
    h.safeGc.mockResolvedValue({ deletedPaths: [], retainedPaths: [] });
    h.decodeScope.mockReturnValue(null);
  });

  it('被删聊天等于当前聊天时 fail-safe 跳过，不做任何删除', async () => {
    const result = await cleanupSummaryVectorIndexForDeletedChat_ACU('current-chat-a.jsonl');
    expect(result).toMatchObject({ performed: false, reason: 'target_is_current_chat' });
    expect(h.safeGc).not.toHaveBeenCalled();
    expect(h.deleteHotCacheByScope).not.toHaveBeenCalled();
  });

  it('聊天枚举不可用（null）时 fail-safe 跳过', async () => {
    h.aliveChatNames = null;
    const result = await cleanupSummaryVectorIndexForDeletedChat_ACU('deleted-chat.jsonl');
    expect(result).toMatchObject({ performed: false, reason: 'chat_enumeration_unavailable' });
    expect(h.safeGc).not.toHaveBeenCalled();
  });

  it('跨角色存在同名存活聊天时跳过删除（共用 scope 不能动）', async () => {
    h.aliveChatNames = new Set(['deleted-chat']);
    const result = await cleanupSummaryVectorIndexForDeletedChat_ACU('deleted-chat.jsonl');
    expect(result).toMatchObject({ performed: false, reason: 'same_name_chat_alive' });
    expect(h.safeGc).not.toHaveBeenCalled();
    expect(h.deleteHotCacheByScope).not.toHaveBeenCalled();
  });

  it('确认无同名存活后：从 registry（新条目 scope 字段 + 旧条目路径反解）收集 scope，清 IDB 并以 scopeHints 调 Safe GC', async () => {
    h.registryFiles = [
      // 新格式：路径 token 是不可逆指纹，身份来自 registry 自带的 scope 字段。
      registryFile('TavernDB_ACU_vector_v2_fingerprintA_snap_x_wg_snapshot', { chatKey: 'deleted-chat', isolationKey: 'default', sourceTableKey: 'summary' }),
      // 旧格式：无 scope 字段，靠无损路径 token 反解；与上面同 scope，应去重成 1 个。
      registryFile('TavernDB_ACU_vector_v2_tokenA_snap_old_wg_snapshot'),
      registryFile('TavernDB_ACU_vector_v2_tokenB_snap_y_wg_snapshot'),
      registryFile('legacy_path_without_token'),
    ];
    h.decodeScope.mockImplementation((path: string) => {
      if (path.includes('tokenA')) return { chatKey: 'deleted-chat', isolationKey: 'default', sourceTableKey: 'summary' };
      if (path.includes('tokenB')) return { chatKey: 'other-chat', isolationKey: 'default', sourceTableKey: 'summary' };
      return null;
    });
    h.safeGc.mockResolvedValue({ deletedPaths: ['TavernDB_ACU_vector_v2_fingerprintA_snap_x_wg_snapshot'], retainedPaths: [] });

    const result = await cleanupSummaryVectorIndexForDeletedChat_ACU('deleted-chat.jsonl');

    expect(result).toMatchObject({ performed: true, scopeCount: 1, deletedFileCount: 1 });
    // IDB 清理按 chatKey partial scope，一次清空该聊天全部残留。
    expect(h.deleteHotCacheByScope).toHaveBeenCalledWith({ chatKey: 'deleted-chat', isolationKey: '', sourceTableKey: '' });
    expect(h.clearFlushTasksByScope).toHaveBeenCalledWith({ chatKey: 'deleted-chat', isolationKey: '', sourceTableKey: '' });
    // Safe GC 只带被删聊天的 scope hints，不包含其他聊天。
    expect(h.safeGc).toHaveBeenCalledWith({
      scopeHints: [expect.objectContaining({ chatKey: 'deleted-chat' })],
    });
  });

  it('registry 无匹配文件时仍清理 IDB 残留，但不调 Safe GC', async () => {
    h.registryFiles = [];
    const result = await cleanupSummaryVectorIndexForDeletedChat_ACU('deleted-chat.jsonl');
    expect(result).toMatchObject({ performed: true, scopeCount: 0, deletedFileCount: 0 });
    expect(h.deleteHotCacheByScope).toHaveBeenCalledWith({ chatKey: 'deleted-chat', isolationKey: '', sourceTableKey: '' });
    expect(h.safeGc).not.toHaveBeenCalled();
  });
});

describe('sweepOrphanSummaryVectorIndexFiles_ACU 孤儿清扫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.currentChatKey = 'current-chat-a';
    h.registryFiles = [];
    h.listAliveChats.mockImplementation(async () => h.aliveChatNames);
    h.aliveChatNames = new Set<string>();
    h.deleteHotCacheByScope.mockResolvedValue(undefined);
    h.clearFlushTasksByScope.mockResolvedValue(undefined);
    h.safeGc.mockResolvedValue({ deletedPaths: [], retainedPaths: [] });
    h.decodeScope.mockReturnValue(null);
    globalThis.localStorage?.removeItem?.('TavernDB_ACU_vector_orphan_sweep_last_run');
  });

  it('枚举不可用时 fail-safe 跳过', async () => {
    h.aliveChatNames = null;
    const result = await sweepOrphanSummaryVectorIndexFiles_ACU();
    expect(result).toMatchObject({ performed: false, reason: 'chat_enumeration_unavailable' });
    expect(h.safeGc).not.toHaveBeenCalled();
  });

  it('只清扫既不存活也非当前聊天的 scope；当前聊天即使不在枚举内也豁免', async () => {
    h.aliveChatNames = new Set(['alive-chat']);
    h.registryFiles = [
      registryFile('path-orphan'),
      registryFile('path-alive'),
      registryFile('path-current'),
    ];
    h.decodeScope.mockImplementation((path: string) => {
      if (path === 'path-orphan') return { chatKey: 'orphan-chat', isolationKey: 'default', sourceTableKey: 'summary' };
      if (path === 'path-alive') return { chatKey: 'alive-chat', isolationKey: 'default', sourceTableKey: 'summary' };
      if (path === 'path-current') return { chatKey: 'current-chat-a', isolationKey: 'default', sourceTableKey: 'summary' };
      return null;
    });

    const result = await sweepOrphanSummaryVectorIndexFiles_ACU();

    expect(result).toMatchObject({ performed: true, scopeCount: 1 });
    expect(h.safeGc).toHaveBeenCalledWith({
      scopeHints: [expect.objectContaining({ chatKey: 'orphan-chat' })],
    });
    expect(h.deleteHotCacheByScope).toHaveBeenCalledTimes(1);
    expect(h.deleteHotCacheByScope).toHaveBeenCalledWith({ chatKey: 'orphan-chat', isolationKey: '', sourceTableKey: '' });
  });

  it('24 小时节流：连续两次调用第二次跳过', async () => {
    // 节流依赖 localStorage；node 环境无此对象时源码 fail-open（不节流），
    // 这里 stub 内存实现验证节流路径本身。
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });
    try {
      h.aliveChatNames = new Set<string>();
      await sweepOrphanSummaryVectorIndexFiles_ACU();
      const second = await sweepOrphanSummaryVectorIndexFiles_ACU();
      expect(second).toMatchObject({ performed: false, reason: 'throttled' });
      expect(h.listAliveChats).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('localStorage 不可用时 fail-open：不节流，清扫仍执行', async () => {
    h.aliveChatNames = new Set<string>();
    await sweepOrphanSummaryVectorIndexFiles_ACU();
    const second = await sweepOrphanSummaryVectorIndexFiles_ACU();
    expect(second).toMatchObject({ performed: true });
    expect(h.listAliveChats).toHaveBeenCalledTimes(2);
  });
});
