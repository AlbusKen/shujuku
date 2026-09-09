// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chatKey: 'chat-a', isolationKey: 'iso-a', tables: { summary: { name: '纪要表' } } as any,
  chat: [{ is_user: false, mesId: 'm-1' }] as any[], tagData: null as any,
  registry: [] as any[], reads: vi.fn(), validate: vi.fn(), assign: vi.fn(), write: vi.fn(), save: vi.fn(), saveStrict: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: h.chatKey,
  getCurrentIsolationKey_ACU: () => h.isolationKey,
  get currentJsonTableData_ACU() { return h.tables; },
  settings_ACU: {},
}));
vi.mock('../../../src/shared/utils', () => ({ isSummaryOrOutlineTable_ACU: () => true, logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn() }));
vi.mock('../../../src/shared/template-preset-utils', () => ({ getCurrentCharacterCardName_ACU: () => 'char' }));
vi.mock('../../../src/data/storage/vector-index-st-files-storage', () => ({
  buildVectorIndexSingleSnapshotFilePath_ACU: (p: any) => p.chatName ? `named-${p.sourceTableKey}` : `unnamed-${p.sourceTableKey}`,
  buildLegacyVectorIndexSingleSnapshotFilePath_ACU: (p: any) => `legacy-${p.sourceTableKey}`,
  buildVectorIndexSingleSnapshotV2ScopeToken_ACU: (p: any) => `scope-${p.chatKey}-${p.isolationKey}-${p.sourceTableKey}`,
  loadVectorIndexRegistry_ACU: async () => ({ files: h.registry }),
  readVectorIndexJsonFile_ACU: (...args: any[]) => h.reads(...args),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({ validateSingleFileSnapshotIdentity_ACU: (...args: any[]) => h.validate(...args) }));
vi.mock('../../../src/service/vector/summary-vector-index-state-service', () => ({ assignSummaryVectorIndexStateToTagData_ACU: (...args: any[]) => h.assign(...args) }));
vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: (...args: any[]) => h.save(...args),
  saveChatToHostStrict_ACU: (...args: any[]) => h.saveStrict(...args),
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: (...args: any[]) => h.save(...args),
  saveChatToHostStrict_ACU: (...args: any[]) => h.saveStrict(...args),
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: (message: any) => structuredClone(message.TavernDB_ACU_IsolatedData || {}),
  readIsolatedTagData_ACU: () => h.tagData,
  readIsolatedDataContainer_ACU: (message: any) => {
    if (!message || typeof message.TavernDB_ACU_IsolatedData !== 'object' || Array.isArray(message.TavernDB_ACU_IsolatedData)) return null;
    return message.TavernDB_ACU_IsolatedData;
  },
  patchIsolatedTagMetadata_ACU: (message: any, isolationKey: string, patch: Record<string, any>, options?: { expectedIndexId?: string }) => {
    if (!message) return { changed: false, tagData: null };
    const container = message.TavernDB_ACU_IsolatedData && typeof message.TavernDB_ACU_IsolatedData === 'object'
      ? message.TavernDB_ACU_IsolatedData
      : {};
    const current = container[isolationKey] || {};
    if (options?.expectedIndexId != null) {
      const currentId = current.summaryVectorIndexManifest?.indexId ?? current.summaryVectorIndexState?.manifest?.indexId ?? current.summaryVectorIndexState?.indexId;
      if (String(currentId || '') !== String(options.expectedIndexId)) {
        const error = new Error('ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU');
        (error as any).code = 'ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU';
        throw error;
      }
    }
    const next = { ...current };
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === undefined) continue;
      if (value === null) delete next[key];
      else next[key] = value;
    }
    message.TavernDB_ACU_IsolatedData = { ...container, [isolationKey]: next };
    return { changed: true, tagData: next };
  },
  writeIsolatedTagData_ACU: (...args: any[]) => h.write(...args),
}));

import { tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU } from '../../../src/service/vector/summary-vector-index-chat-service';

function blob(overrides: any = {}) {
  const manifest = { indexId: 'idx-1', status: 'ready', chatKey: 'chat-a', isolationKey: 'iso-a', sourceTableKey: 'summary', sourceTableName: '纪要表', storageIdentity: { revision: 1 }, snapshot: { revision: 1 }, ...overrides };
  return { schema: 'single_file_snapshot', manifest, indexId: manifest.indexId, chatKey: manifest.chatKey, isolationKey: manifest.isolationKey, sourceTableKey: manifest.sourceTableKey, rows: [{ rowKey: 'r1' }], chunks: [{ chunkId: 'c1' }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.registry = []; h.tables = { summary: { name: '纪要表' } }; h.chat = [{ is_user: false, mesId: 'm-1' }]; h.tagData = null;
  h.reads.mockReset();
  h.validate.mockReset();
  h.assign.mockReset();
  h.write.mockReset();
  h.save.mockReset();
  h.saveStrict.mockReset();
  h.assign.mockImplementation((tagData: any, state: any) => { tagData.summaryVectorIndexState = state; });
  h.save.mockResolvedValue(undefined);
  h.saveStrict.mockResolvedValue(undefined);
});

describe('summary vector external snapshot recovery', () => {
  it('优先读取当前 canonical scope 的 V2 registry 候选并恢复合法快照', async () => {
    h.registry = [{ path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot', publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);
    expect(h.reads).toHaveBeenCalledWith('TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot');
    expect(h.validate).toHaveBeenCalledWith(expect.objectContaining({ indexId: 'idx-1' }), expect.anything(), expect.stringContaining('vector_v2_'));
    // 迁移后 metadata 经 patch 边界写入：断言 message 槽上 manifest 已恢复。
    expect(h.chat[0].TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState.manifest.indexId).toBe('idx-1');
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('拒绝 prepared registry orphan，并继续使用兼容 legacy 路径', async () => {
    h.registry = [{ path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_orphan_snapshot', publicationState: 'prepared' }];
    h.reads.mockImplementation(async (path: string) => path === 'legacy-summary' ? { ok: true, data: blob() } : { ok: false });

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    expect(h.reads).not.toHaveBeenCalledWith('TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_orphan_snapshot');
    expect(h.reads.mock.calls.map(([path]: [string]) => path)).toEqual(['named-summary', 'unnamed-summary', 'legacy-summary']);
  });

  it('按最高 revision 恢复 published V2，registry 顺序不能决定结果', async () => {
    const oldPath = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-old_write_snapshot';
    const newPath = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-new_write_snapshot';
    h.registry = [{ path: oldPath, publicationState: 'published' }, { path: newPath, publicationState: 'published' }];
    h.reads.mockImplementation(async (path: string) => ({ ok: true, data: path === oldPath ? blob({ indexId: 'idx-old', storageIdentity: { revision: 2 }, snapshot: { revision: 2 } }) : blob({ indexId: 'idx-new', storageIdentity: { revision: 3 }, snapshot: { revision: 3 } }) }));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    // 迁移后：断言 message 槽上恢复的是最新 revision 的 manifest。
    expect(h.chat[0].TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState.manifest.indexId).toBe('idx-new');
  });

  it('拒绝同 scope 同 revision 的多个 published V2 候选，不能伪造 generation 顺序', async () => {
    h.registry = [
      { path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-a_generation-a_snapshot', publicationState: 'published' },
      { path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-b_generation-z_snapshot', publicationState: 'published' },
    ];
    h.reads.mockImplementation(async (path: string) => path.startsWith('TavernDB_ACU_vector_v2_')
      ? { ok: true, data: blob({ indexId: path.includes('idx-a') ? 'idx-a' : 'idx-b', storageIdentity: { revision: 5 }, snapshot: { revision: 5 } }) }
      : { ok: false });

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    expect(h.write).not.toHaveBeenCalled();
    expect(h.saveStrict).not.toHaveBeenCalled();
  });

  it('多个纪要表并存且当前 canonical sourceTableKey 无法唯一确定时拒绝自动恢复', async () => {
    h.tables = {
      summary: { name: '纪要表' },
      outline: { name: '总体大纲' },
    };
    h.registry = [{ path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-outline_idx-1_write_snapshot', publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob({ sourceTableKey: 'outline' }) });

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    expect(h.reads).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.saveStrict).not.toHaveBeenCalled();
  });

  it('拒绝 scope 或 embedded identity 漂移，绝不写回当前聊天', async () => {
    h.registry = [{ path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot', publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    h.validate.mockImplementation(() => { throw new Error('embedded identity mismatch'); });
    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);
    expect(h.write).not.toHaveBeenCalled(); expect(h.saveStrict).not.toHaveBeenCalled();
  });

  it('拒绝 manifest scope 不匹配并继续尝试同 scope 的后续 legacy 候选', async () => {
    h.reads.mockImplementation(async (path: string) => {
      if (path === 'named-summary') return { ok: true, data: blob({ isolationKey: 'iso-other' }) };
      if (path === 'unnamed-summary') return { ok: true, data: blob() };
      return { ok: false };
    });

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    expect(h.reads.mock.calls.map(([path]: [string]) => path).slice(0, 2)).toEqual(['named-summary', 'unnamed-summary']);
    expect(h.validate).toHaveBeenCalledTimes(1);
    expect(h.chat[0].TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState.manifest.indexId).toBe('idx-1');
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
  });

  it('在 V2 registry 没有可信快照时兼容恢复 legacy 路径', async () => {
    h.reads.mockImplementation(async (path: string) => path === 'legacy-summary'
      ? { ok: true, data: blob() }
      : { ok: false });

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(true);

    expect(h.reads.mock.calls.map(([path]: [string]) => path)).toEqual(['named-summary', 'unnamed-summary', 'legacy-summary']);
    expect(h.chat[0].TavernDB_ACU_IsolatedData['iso-a'].summaryVectorIndexState.manifest.indexId).toBe('idx-1');
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
  });

  it('多个可信 legacy 快照候选并存时拒绝按路径顺序猜测恢复', async () => {
    h.reads.mockImplementation(async (path: string) => (
      path === 'named-summary' || path === 'legacy-summary'
        ? { ok: true, data: blob({ indexId: path === 'named-summary' ? 'idx-named' : 'idx-legacy' }) }
        : { ok: false }
    ));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    expect(h.reads.mock.calls.map(([path]: [string]) => path)).toEqual(['named-summary', 'unnamed-summary', 'legacy-summary']);
    expect(h.write).not.toHaveBeenCalled();
    expect(h.saveStrict).not.toHaveBeenCalled();
  });

  it('严格保存失败时回滚恢复前的 IsolatedData 原始字段，不报告恢复成功', async () => {
    const path = 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot';
    const before = JSON.stringify({ 'iso-a': { independentData: { sheet_0: { name: '纪要表' } }, modifiedKeys: [], updateGroupKeys: [] } });
    h.chat[0].TavernDB_ACU_IsolatedData = before;
    h.registry = [{ path, publicationState: 'published' }];
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    h.saveStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);

    expect(h.chat[0].TavernDB_ACU_IsolatedData).toBe(before);
    expect(h.saveStrict).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('已有 state 时不覆盖 pointer', async () => {
    h.registry = [{ path: 'TavernDB_ACU_vector_v2_scope-chat-a-iso-a-summary_idx-1_write_snapshot', publicationState: 'published' }];
    h.tagData = { summaryVectorIndexState: { manifest: { indexId: 'existing' } } };
    h.reads.mockResolvedValue({ ok: true, data: blob() });
    await expect(tryRecoverSummaryVectorIndexFromExternalSnapshot_ACU()).resolves.toBe(false);
    expect(h.assign).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled(); expect(h.saveStrict).not.toHaveBeenCalled();
  });
});
