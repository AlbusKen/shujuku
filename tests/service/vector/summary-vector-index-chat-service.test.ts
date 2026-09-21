/**
 * summary-vector-index-chat-service — 当前聊天交火索引删除
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('deleteCurrentSummaryVectorIndexFromChat_ACU', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('清理当前聊天索引层，并按 scope 清热缓存、flush 队列和可回收外置文件', async () => {
    const manifest = {
      status: 'ready',
      indexId: 'idx-current',
      chatKey: 'chat-data',
      isolationKey: 'alpha',
      sourceTableKey: 'sheet_summary',
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        alpha: {
          summaryVectorIndexManifest: manifest,
          summaryVectorIndexState: {
            manifest,
            rows: [{ rowKey: 'r1', status: 'active' }],
            chunks: [],
          },
        },
        beta: {
          summaryVectorIndexState: { indexId: 'idx-beta', rows: [{ rowKey: 'r2' }] },
        },
      },
    }];
    const saveChat = vi.fn(async () => undefined);
    const deleteHotByScope = vi.fn(async () => undefined);
    const clearFlushByScope = vi.fn(async () => undefined);
    const saveStrict = vi.fn(async () => undefined);
    const cleanupUnreachable = vi.fn(async () => ({
      scannedRegisteredFileCount: 1,
      reachableFileCount: 0,
      deletedPaths: ['vector-file.json'],
      retainedPaths: [],
      blockedByReachability: [],
      failedDeletes: [],
    }));

    vi.doMock('../../../src/service/chat/chat-service', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: saveChat,
    }));
    vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: saveChat,
      saveChatToHostStrict_ACU: saveStrict,
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      currentChatFileIdentifier_ACU: 'chat-data',
      currentJsonTableData_ACU: {
        sheet_summary: { name: '纪要表' },
      },
      getCurrentIsolationKey_ACU: () => 'alpha',
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-state-service', () => ({
      getAggregatedSummaryVectorIndexSnapshot_ACU: () => ({
        summaryVectorIndexState: {
          manifest,
          rows: [{ rowKey: 'r1', status: 'active' }],
          chunks: [],
        },
        layers: [{
          messageIndex: 0,
          isolationKey: 'alpha',
          summaryVectorIndexState: {
            manifest,
            rows: [{ rowKey: 'r1', status: 'active' }],
            chunks: [],
          },
          tagData: chat[0].TavernDB_ACU_IsolatedData.alpha,
        }],
        rowOwners: new Map(),
      }),
      assignSummaryVectorIndexStateToTagData_ACU: vi.fn((tagData: any, state: any) => {
        if (!state) {
          delete tagData.summaryVectorIndexState;
          delete tagData.summaryVectorIndexManifest;
        }
      }),
    }));
    vi.doMock('../../../src/data/storage/vector-index-hot-cache', () => ({
      deleteSummaryVectorHotCacheByScope_ACU: deleteHotByScope,
      clearSummaryVectorFlushTasksByScope_ACU: clearFlushByScope,
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
      cleanupUnreachableSummaryVectorIndexFiles_ACU: cleanupUnreachable,
    }));

    const { deleteCurrentSummaryVectorIndexFromChat_ACU } = await import('../../../src/service/vector/summary-vector-index-chat-service');
    const changed = await deleteCurrentSummaryVectorIndexFromChat_ACU();

    const expectedScope = {
      chatKey: 'chat-data',
      isolationKey: 'alpha',
      sourceTableKey: 'sheet_summary',
    };
    expect(changed).toBe(true);
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.summaryVectorIndexState).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.summaryVectorIndexManifest).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.beta.summaryVectorIndexState.indexId).toBe('idx-beta');
    expect(deleteHotByScope).toHaveBeenCalledWith(expectedScope);
    expect(clearFlushByScope).toHaveBeenCalledWith(expectedScope);
    expect(cleanupUnreachable).toHaveBeenCalledWith({ scopeHints: [expectedScope] });
  });

  it('仅 V2 镜像存在时删除返回 true，并清空 summaryVectorIndexFrame', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        alpha: {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full' },
            logEntries: [],
            summaryVectorIndexFrame: {
              version: 3,
              sourceTableKey: 'sheet_summary',
              checkpoint: { kind: 'vector_full', sourceTableKey: 'sheet_summary', createdAt: 1 },
              logEntries: [],
            },
            otherKeep: true,
          },
        },
      },
    }];
    const saveStrict = vi.fn(async () => undefined);
    const deleteHotByScope = vi.fn(async () => undefined);
    const clearFlushByScope = vi.fn(async () => undefined);
    const cleanupUnreachable = vi.fn(async () => ({
      scannedRegisteredFileCount: 1,
      reachableFileCount: 0,
      deletedPaths: ['vector-v2.json'],
      retainedPaths: [],
      blockedByReachability: [],
      failedDeletes: [],
    }));

    vi.doMock('../../../src/service/chat/chat-service', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
      saveChatToHostStrict_ACU: saveStrict,
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      currentChatFileIdentifier_ACU: 'chat-data',
      currentJsonTableData_ACU: {
        sheet_summary: { name: '纪要表' },
      },
      getCurrentIsolationKey_ACU: () => 'alpha',
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-state-service', () => ({
      getAggregatedSummaryVectorIndexSnapshot_ACU: () => ({
        summaryVectorIndexState: null,
        layers: [],
        rowOwners: new Map(),
      }),
      assignSummaryVectorIndexStateToTagData_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/data/storage/vector-index-hot-cache', () => ({
      deleteSummaryVectorHotCacheByScope_ACU: deleteHotByScope,
      clearSummaryVectorFlushTasksByScope_ACU: clearFlushByScope,
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
      cleanupUnreachableSummaryVectorIndexFiles_ACU: cleanupUnreachable,
    }));

    const { deleteCurrentSummaryVectorIndexFromChat_ACU } = await import('../../../src/service/vector/summary-vector-index-chat-service');
    const changed = await deleteCurrentSummaryVectorIndexFromChat_ACU();

    expect(changed).toBe(true);
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.storageFrame.summaryVectorIndexFrame).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.storageFrame.otherKeep).toBe(true);
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.storageFrame.checkpoint).toEqual({ kind: 'full' });
    expect(deleteHotByScope).toHaveBeenCalledWith({
      chatKey: 'chat-data',
      isolationKey: 'alpha',
      sourceTableKey: 'sheet_summary',
    });
    expect(clearFlushByScope).toHaveBeenCalledWith({
      chatKey: 'chat-data',
      isolationKey: 'alpha',
      sourceTableKey: 'sheet_summary',
    });
  });

  it('没有任何 legacy 层或 V2 镜像时返回 false', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        alpha: {
          _acu_storage_version: 2,
          storageFrame: { version: 2, checkpoint: { kind: 'full' }, logEntries: [] },
        },
      },
    }];
    const saveStrict = vi.fn(async () => undefined);
    vi.doMock('../../../src/service/chat/chat-service', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
      saveChatToHostStrict_ACU: saveStrict,
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      currentChatFileIdentifier_ACU: 'chat-data',
      currentJsonTableData_ACU: {},
      getCurrentIsolationKey_ACU: () => 'alpha',
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-state-service', () => ({
      getAggregatedSummaryVectorIndexSnapshot_ACU: () => ({
        summaryVectorIndexState: null,
        layers: [],
        rowOwners: new Map(),
      }),
    }));
    vi.doMock('../../../src/data/storage/vector-index-hot-cache', () => ({
      deleteSummaryVectorHotCacheByScope_ACU: vi.fn(),
      clearSummaryVectorFlushTasksByScope_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
      cleanupUnreachableSummaryVectorIndexFiles_ACU: vi.fn(async () => ({ deletedPaths: [], failedDeletes: [] })),
    }));

    const { deleteCurrentSummaryVectorIndexFromChat_ACU } = await import('../../../src/service/vector/summary-vector-index-chat-service');
    await expect(deleteCurrentSummaryVectorIndexFromChat_ACU()).resolves.toBe(false);
    expect(saveStrict).not.toHaveBeenCalled();
  });
});

describe('clearSummaryVectorIndexLayerFromChat_ACU', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('只删除 indexId 匹配的目标层并严格保存聊天', async () => {
    const manifest = { indexId: 'idx-missing' } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        alpha: { summaryVectorIndexManifest: manifest, summaryVectorIndexState: { manifest } },
        beta: { summaryVectorIndexState: { manifest: { indexId: 'idx-beta' } } },
      },
    }];
    const saveStrict = vi.fn(async () => undefined);

    vi.doMock('../../../src/service/chat/chat-service', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
      saveChatToHostStrict_ACU: saveStrict,
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({
      currentChatFileIdentifier_ACU: 'chat-data',
      currentJsonTableData_ACU: {},
    }));
    vi.doMock('../../../src/data/storage/vector-index-hot-cache', () => ({
      deleteSummaryVectorHotCacheByScope_ACU: vi.fn(),
      clearSummaryVectorFlushTasksByScope_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
      cleanupUnreachableSummaryVectorIndexFiles_ACU: vi.fn(async () => ({ deletedPaths: [], failedDeletes: [] })),
    }));

    const { clearSummaryVectorIndexLayerFromChat_ACU } = await import('../../../src/service/vector/summary-vector-index-chat-service');
    await expect(clearSummaryVectorIndexLayerFromChat_ACU({ messageIndex: 0, isolationKey: 'alpha', indexId: 'idx-missing' })).resolves.toBe(true);

    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.summaryVectorIndexState).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.summaryVectorIndexManifest).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.beta.summaryVectorIndexState.manifest.indexId).toBe('idx-beta');
  });

  it('indexId 不匹配时不删除也不保存', async () => {
    const manifest = { indexId: 'idx-current' } as any;
    const chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { alpha: { summaryVectorIndexManifest: manifest, summaryVectorIndexState: { manifest } } } }];
    const saveStrict = vi.fn(async () => undefined);

    vi.doMock('../../../src/service/chat/chat-service', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
      saveChatToHostStrict_ACU: saveStrict,
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({ currentChatFileIdentifier_ACU: 'chat-data', currentJsonTableData_ACU: {} }));
    vi.doMock('../../../src/data/storage/vector-index-hot-cache', () => ({ deleteSummaryVectorHotCacheByScope_ACU: vi.fn(), clearSummaryVectorFlushTasksByScope_ACU: vi.fn() }));
    vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({ cleanupUnreachableSummaryVectorIndexFiles_ACU: vi.fn(async () => ({ deletedPaths: [], failedDeletes: [] })) }));

    const { clearSummaryVectorIndexLayerFromChat_ACU } = await import('../../../src/service/vector/summary-vector-index-chat-service');
    await expect(clearSummaryVectorIndexLayerFromChat_ACU({ messageIndex: 0, isolationKey: 'alpha', indexId: 'idx-missing' })).resolves.toBe(false);
    expect(saveStrict).not.toHaveBeenCalled();
    expect(chat[0].TavernDB_ACU_IsolatedData.alpha.summaryVectorIndexManifest.indexId).toBe('idx-current');
  });

  it('严格保存失败时完整恢复原始 IsolatedData', async () => {
    const manifest = { indexId: 'idx-missing' } as any;
    const original = JSON.stringify({
      alpha: { summaryVectorIndexManifest: manifest, summaryVectorIndexState: { manifest } },
      beta: { marker: 'keep' },
    });
    const chat = [{ is_user: false, TavernDB_ACU_IsolatedData: original }];
    const saveError = new Error('save failed');

    vi.doMock('../../../src/service/chat/chat-service', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
    }));
    vi.doMock('../../../src/data/gateways/chat-gateway', () => ({
      getChatArray_ACU: () => chat,
      saveChatToHost_ACU: vi.fn(),
      saveChatToHostStrict_ACU: vi.fn(async () => { throw saveError; }),
    }));
    vi.doMock('../../../src/service/runtime/state-manager', () => ({ currentChatFileIdentifier_ACU: 'chat-data', currentJsonTableData_ACU: {} }));
    vi.doMock('../../../src/data/storage/vector-index-hot-cache', () => ({ deleteSummaryVectorHotCacheByScope_ACU: vi.fn(), clearSummaryVectorFlushTasksByScope_ACU: vi.fn() }));
    vi.doMock('../../../src/service/vector/summary-vector-index-storage-service', () => ({ cleanupUnreachableSummaryVectorIndexFiles_ACU: vi.fn(async () => ({ deletedPaths: [], failedDeletes: [] })) }));

    const { clearSummaryVectorIndexLayerFromChat_ACU } = await import('../../../src/service/vector/summary-vector-index-chat-service');
    await expect(clearSummaryVectorIndexLayerFromChat_ACU({
      messageIndex: 0,
      isolationKey: 'alpha',
      indexId: 'idx-missing',
    })).rejects.toThrow('save failed');

    expect(chat[0].TavernDB_ACU_IsolatedData).toBe(original);
  });
});
