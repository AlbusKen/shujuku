/**
 * tests/service/chat/chat-service.test.ts
 * 聊天数据服务 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableData, mockGetChatArray, mockSaveChatToHost, mockSaveChatToHostStrict, mockSetChatMessages, mockEmitMessageUpdated, mockLogDebug, mockGetCurrentIsolationKey, mockGetLastOptimizationBase, mockSetLastOptimizationBase, mockSanitizeSheet, mockPersistTablesToChatMessage, mockRunTableUpdateCommit, mockRunTableWriteTransaction, mockLoadTableStateFromFramesV2, mockLoadTableStateFromFramesV2Detailed, mockCollectScheduleSummaryFromFramesV2, mockDeleteSummaryVectorIndexExternal, mockCleanupUnreachable, mockDeriveSheetLifecycleFromFramesV2 } = vi.hoisted(() => ({
  mockSettings: {
    retainRecentLayers: 3,
    dataIsolationEnabled: false,
    dataIsolationCode: '',
  } as any,
  mockCurrentJsonTableData: {
    sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] },
    sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] },
  } as any,
  mockGetChatArray: vi.fn(),
  mockSaveChatToHost: vi.fn(),
  mockSaveChatToHostStrict: vi.fn(),
  mockSetChatMessages: vi.fn(),
  mockEmitMessageUpdated: vi.fn(),
  mockLogDebug: vi.fn(),
  mockGetCurrentIsolationKey: vi.fn(() => ''),
  mockGetLastOptimizationBase: vi.fn(() => null),
  mockSetLastOptimizationBase: vi.fn(),
  mockSanitizeSheet: vi.fn((sheet: any) => {
    if (!sheet || typeof sheet !== 'object') return sheet;
    const out: any = {};
    for (const key of ['uid', 'name', 'sourceData', 'content', 'updateConfig', 'exportConfig', 'orderNo']) {
      if (sheet[key] !== undefined) out[key] = JSON.parse(JSON.stringify(sheet[key]));
    }
    return out;
  }),
  mockPersistTablesToChatMessage: vi.fn(),
  mockRunTableUpdateCommit: vi.fn(),
  mockRunTableWriteTransaction: vi.fn(),
  mockLoadTableStateFromFramesV2: vi.fn(),
  mockLoadTableStateFromFramesV2Detailed: vi.fn(),
  mockCollectScheduleSummaryFromFramesV2: vi.fn(() => null),
  mockDeriveSheetLifecycleFromFramesV2: vi.fn(() => ({ statusBySheetKey: {}, activeSheetKeys: [], hiddenSheetKeys: [], indeterminateSheetKeys: [], neverSeenSheetKeys: [] })),
  mockDeleteSummaryVectorIndexExternal: vi.fn(),
  mockCleanupUnreachable: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  getChatLength_ACU: vi.fn(() => 0),
  getLastMessageIndex_ACU: vi.fn(() => -1),
  saveChatToHost_ACU: mockSaveChatToHost,
  saveChatToHostStrict_ACU: mockSaveChatToHostStrict,
  stopGeneration_ACU: vi.fn(),
  deleteLastMessage_ACU: vi.fn(),
  setChatMessages_ACU: mockSetChatMessages,
  emitMessageUpdated_ACU: mockEmitMessageUpdated,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要') || name.includes('总结')),
}));

vi.mock('../../../src/service/optimization/content-optimization', () => ({
  getLastOptimizationBase_ACU: mockGetLastOptimizationBase,
  setLastOptimizationBase_ACU: mockSetLastOptimizationBase,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  currentChatFileIdentifier_ACU: 'chat-test',
  getCurrentIsolationKey_ACU: mockGetCurrentIsolationKey,
  // purgeCurrentChatDatabaseState_ACU 经 clearTableRuntimeWithoutReload_ACU 依赖这些 setter；
  // 不补则真实 purge 在单测基建下无法运行。
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_independentTableStates_ACU: vi.fn(),
  disposeStorageProvider: vi.fn(),
  invalidateTableRuntimeRevision_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  sanitizeSheetForStorage_ACU: mockSanitizeSheet,
}));

vi.mock('../../../src/service/table/table-service', () => ({
  persistTablesToChatMessage_ACU: mockPersistTablesToChatMessage,
}));

vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: mockRunTableUpdateCommit,
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mockRunTableWriteTransaction,
  invalidateTableRuntimeRevision_ACU: vi.fn(),
}));

vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2_ACU: mockLoadTableStateFromFramesV2,
  loadTableStateFromFramesV2Detailed_ACU: mockLoadTableStateFromFramesV2Detailed,
  collectScheduleSummaryFromFramesV2_ACU: mockCollectScheduleSummaryFromFramesV2,
  deriveSheetLifecycleFromFramesV2_ACU: mockDeriveSheetLifecycleFromFramesV2,
}));

vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  deleteSummaryVectorIndexExternal_ACU: mockDeleteSummaryVectorIndexExternal,
  cleanupUnreachableSummaryVectorIndexFiles_ACU: mockCleanupUnreachable,
}));

import {
  replaceChatMessage_ACU,
  getOriginalContent_ACU,
  purgeOldLayerData_ACU,
  ensureV2BoundaryCheckpointForRetainedBuffer_ACU,
  shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU,
  replaceManualRefillSheetBaselineInRangeAtomic_ACU,
  commitManualRefillSheetSnapshotInRangeAtomic_ACU,
  clearManualRefillIncrementalDataInRange_ACU,
  clearTableDataAtFloors_ACU,
  deleteLocalDataInChatCore_ACU,
  deleteLocalDataWithScope_ACU,
  isFullRangeDeletionRequest_ACU,
  purgeCurrentChatDatabaseState_ACU,
  ensureManualCatchUpAnchorBeforeTarget_ACU,
  establishManualRefillTemplateRoot_ACU,
  overrideLatestLayerWithTemplateCore_ACU,
  saveCurrentDataForTable_ACU,
} from '../../../src/service/chat/chat-service';
import { resolveTableHistoryStateFromChat_ACU } from '../../../src/service/table/table-history';
import { resolveTableStorageStrategy_ACU } from '../../../src/service/table/storage-strategy-resolver';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { assertSingleActiveFullCheckpointV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.retainRecentLayers = 3;
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockGetCurrentIsolationKey.mockReturnValue('');
  mockSaveChatToHost.mockResolvedValue(undefined);
  mockSaveChatToHostStrict.mockResolvedValue(undefined);
  mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
  mockRunTableUpdateCommit.mockImplementation(async (options: any, apply: any) => {
    mockPersistTablesToChatMessage(options);
    const applied = await apply();
    return {
      success: applied?.success !== false,
      value: applied?.value,
      tableData: applied?.tableData,
      saved: true,
    };
  });
  mockRunTableWriteTransaction.mockImplementation(async (_options: any, task: any) => task());
  mockLoadTableStateFromFramesV2.mockResolvedValue({
    sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] },
  });
  mockLoadTableStateFromFramesV2Detailed.mockImplementation(async (candidateChat: any[], _isolationKey: string, options?: any) => {
    if (Number.isInteger(options?.maxMessageIndex)) return {
      baseKind: 'full_checkpoint',
      data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
    };
    const data: Record<string, any> = {};
    candidateChat.forEach(message => {
      const frame = message?.TavernDB_ACU_IsolatedData?.['']?.storageFrame;
      Object.assign(data, frame?.perSheetCheckpoints && Object.fromEntries(
        Object.entries(frame.perSheetCheckpoints).map(([sheetKey, checkpoint]: [string, any]) => [sheetKey, checkpoint.data]),
      ));
    });
    return { baseKind: 'full_checkpoint', data };
  });
  mockCollectScheduleSummaryFromFramesV2.mockReturnValue(null);
  mockDeriveSheetLifecycleFromFramesV2.mockReturnValue({ statusBySheetKey: {}, activeSheetKeys: [], hiddenSheetKeys: [], indeterminateSheetKeys: [], neverSeenSheetKeys: [] });
  mockDeleteSummaryVectorIndexExternal.mockResolvedValue(undefined);
  mockCleanupUnreachable.mockResolvedValue({ deletedPaths: [], retainedPaths: [], failedDeletes: [] });
});

// ═══ replaceChatMessage_ACU ═══
describe('replaceChatMessage_ACU', () => {
  it('成功替换消息内容', async () => {
    const chat = [
      { is_user: true, mes: '你好' },
      { is_user: false, mes: '原始内容', message_id: 'msg1', extra: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockSetChatMessages.mockResolvedValue(true);
    const result = await replaceChatMessage_ACU(1, '新内容');
    expect(result).toBe(true);
    expect(mockSetChatMessages).toHaveBeenCalledWith(
      [expect.objectContaining({ message_id: 'msg1', mes: '新内容' })],
      { refresh: 'affected' },
    );
  });

  it('消息不存在返回 false', async () => {
    mockGetChatArray.mockReturnValue([]);
    const result = await replaceChatMessage_ACU(5, '新内容');
    expect(result).toBe(false);
  });

  it('setChatMessages 不可用时使用降级方案', async () => {
    const chat = [
      { is_user: false, mes: '原始内容', message_id: 'msg1', extra: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockSetChatMessages.mockResolvedValue(false);
    const result = await replaceChatMessage_ACU(0, '新内容');
    expect(result).toBe(true);
    expect(chat[0].mes).toBe('新内容');
    expect(mockSaveChatToHost).toHaveBeenCalled();
  });

  it('保存原始内容到 extra._acu_original_content', async () => {
    const chat = [
      { is_user: false, mes: '原始内容', message_id: 'msg1', extra: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockSetChatMessages.mockResolvedValue(true);
    await replaceChatMessage_ACU(0, '新内容');
    expect(mockSetChatMessages).toHaveBeenCalledWith(
      [expect.objectContaining({
        extra: expect.objectContaining({ _acu_original_content: '原始内容' }),
      })],
      expect.anything(),
    );
  });
});

// ═══ getOriginalContent_ACU ═══
describe('getOriginalContent_ACU', () => {
  it('从缓存获取原始内容', () => {
    mockGetLastOptimizationBase.mockReturnValue({
      messageIndex: 1,
      messageId: 'msg1',
      baseContent: '原始内容',
    });
    mockGetChatArray.mockReturnValue([
      { is_user: true },
      { is_user: false, message_id: 'msg1' },
    ]);
    expect(getOriginalContent_ACU(1)).toBe('原始内容');
  });

  it('从 extra 获取原始内容', () => {
    mockGetLastOptimizationBase.mockReturnValue(null);
    mockGetChatArray.mockReturnValue([
      { is_user: false, extra: { _acu_original_content: '从extra获取' } },
    ]);
    expect(getOriginalContent_ACU(0)).toBe('从extra获取');
  });

  it('消息不存在返回 null', () => {
    mockGetLastOptimizationBase.mockReturnValue(null);
    mockGetChatArray.mockReturnValue([]);
    expect(getOriginalContent_ACU(5)).toBeNull();
  });
});

// ═══ purgeOldLayerData_ACU ═══
describe('purgeOldLayerData_ACU', () => {
  it('清理超出保留层数的旧数据', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_Data: { sheet_0: { index } },
    }));
    mockGetChatArray.mockReturnValue(chat);
    await purgeOldLayerData_ACU();
    expect(chat[0].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[1].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[2].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[12].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[22].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[23].TavernDB_ACU_Data).toBeDefined();
    expect(chat[24].TavernDB_ACU_Data).toBeDefined();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('chat[0] 只保护指导表字段，不保护普通本地数据', async () => {
    mockSettings.retainRecentLayers = 1;
    const chat = Array.from({ length: 23 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_InternalSheetGuide: index === 0 ? { sheet_0: { name: '指导表' } } : undefined,
      TavernDB_ACU_Data: { sheet_0: { index } },
    }));
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(chat[0].TavernDB_ACU_InternalSheetGuide).toEqual({ sheet_0: { name: '指导表' } });
    expect(chat[0].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[1].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[11].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[21].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[22].TavernDB_ACU_Data).toBeDefined();
  });

  it('达到保留数与 20 个 AI 楼层缓冲后，在最新保留 AI 窗口首个 AI 楼层补写 V2 checkpoint', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0
              ? {
                  checkpoint: {
                    kind: 'full',
                    createdAt: 1,
                    reason: 'init',
                    data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                  },
                }
              : {}),
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[22].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0.content[1][1]).toBe('剑');
    expect(chat[24].TavernDB_ACU_IsolatedData).toBeDefined();
  });

  it('boundary checkpoint 写入失败时保留旧 checkpoint 且不清理旧楼层', async () => {
    mockSettings.retainRecentLayers = 2;
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce(null);
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? {
                  kind: 'full',
                  createdAt: 1,
                  reason: 'init',
                  data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                }
              : index === 24
                ? {
                    kind: 'full',
                    createdAt: 24,
                    reason: 'manual',
                    data: { sheet_0: { name: '旧手动快照', content: [['row_id', '物品名'], ['1', '盾']] } },
                  }
                : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(chat[0].TavernDB_ACU_IsolatedData).toBeDefined();
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'manual',
    }));
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('宿主严格保存不可用时回滚边界 checkpoint 并中止 purge', async () => {
    mockSettings.retainRecentLayers = 2;
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('宿主 saveChat 不可用，无法提交破坏性聊天数据变更。'));
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id'], ['old']] } } }
              : index === 24
                ? { kind: 'full', createdAt: 24, reason: 'manual', data: { sheet_0: { name: '最新快照', content: [['row_id'], ['latest']] } } }
                : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    const firstMessageRef = chat[0];
    const firstFrameRef = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    const latestFrameRef = chat[24].TavernDB_ACU_IsolatedData[''].storageFrame;
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(chat[0]).toBe(firstMessageRef);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame).toBe(firstFrameRef);
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame).toBe(latestFrameRef);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'init' }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'manual' }));
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
  });

  it('anchor 前缺 full checkpoint 时即使保留区已有 compaction checkpoint 也必须中止清理', async () => {
    mockSettings.retainRecentLayers = 2;
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce(null);

    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 24
              ? {
                  checkpoint: {
                    kind: 'full',
                    createdAt: 24,
                    reason: 'compaction',
                    data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '盾']] } },
                  },
                }
              : {}),
            logEntries: index === 24
              ? []
              : [{
                  seq: 1,
                  entryId: `v2_log_${index}`,
                  createdAt: index,
                  source: 'auto_fill',
                  targetMessageIndex: index,
                  aiFloor: index + 1,
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  operations: [],
                  writeSet: [{ kind: 'all' }],
                }],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenCalledWith(chat, '', { maxMessageIndex: 23 });
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeDefined();
    expect(chat[22].TavernDB_ACU_IsolatedData).toBeDefined();
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('user 消息不参与 AI 楼层计数，purge anchor 仍落在第 21 个 AI 楼层', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat: any[] = [];
    for (let aiOrdinal = 0; aiOrdinal < 22; aiOrdinal++) {
      if (aiOrdinal === 5 || aiOrdinal === 12 || aiOrdinal === 20) {
        chat.push({ is_user: true, mes: `用户插入 ${aiOrdinal}` });
      }
      chat.push({
        is_user: false,
        mes: `AI ${aiOrdinal}`,
        TavernDB_ACU_IsolatedData: {
          '': {
            storageFrame: {
              version: 2,
              ...(aiOrdinal === 0
                ? {
                    checkpoint: {
                      kind: 'full',
                      createdAt: 1,
                      reason: 'init',
                      data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                    },
                  }
                : {}),
              logEntries: [],
            },
            _acu_storage_version: 2,
          },
        },
      });
    }
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(chat).toHaveLength(25);
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[22].is_user).toBe(true);
    expect(chat[23].is_user).toBe(false);
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(chat[24].TavernDB_ACU_IsolatedData).toBeDefined();
  });

  it('strict save 提交后 GC 删除失败仅告警，不能回滚已提交的楼层清理', async () => {
    mockSettings.retainRecentLayers = 2;
    const manifest = {
      indexId: 'idx-purge-gc-failure',
      status: 'ready',
      chatKey: 'chat-test',
      isolationKey: 'default',
      sourceTableKey: 'sheet_summary',
      snapshot: { revision: 1, mode: 'single_file_snapshot', activeRowKeys: [], activeChunkIds: [], parentIndexIds: [], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-default', writeGeneration: 'write-purge-gc-failure', revision: 1 },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_Data: { sheet_0: { index } },
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0 ? {
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id'], ['old']] } } },
            } : {}),
            logEntries: [],
          },
          ...(index === 0 ? {
            summaryVectorIndexManifest: manifest,
            summaryVectorIndexState: { manifest },
          } : {}),
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);
    mockCleanupUnreachable.mockResolvedValue({
      deletedPaths: [],
      retainedPaths: [],
      failedDeletes: [{ path: 'orphan.snapshot', error: 'host delete failed' }],
    });

    await purgeOldLayerData_ACU();

    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockCleanupUnreachable).toHaveBeenCalledWith({
      scopeHints: [{ chatKey: 'chat-test', isolationKey: 'default', sourceTableKey: 'sheet_summary' }],
    });
    expect(mockSaveChatToHostStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mockCleanupUnreachable.mock.invocationCallOrder[0],
    );
    expect(chat[0].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
  });

  it('purge 字段删除后的 strict save 失败时恢复消息且绝不进入 GC', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_Data: { sheet_0: { index } },
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 23
              ? { kind: 'full', createdAt: 23, reason: 'compaction', data: { sheet_0: { name: '物品表', content: [['row_id'], ['anchor']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('purge save failed'));

    await purgeOldLayerData_ACU();

    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockCleanupUnreachable).not.toHaveBeenCalled();
    expect(mockDeleteSummaryVectorIndexExternal).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

  it('retainRecentLayers=0 时跳过', async () => {
    mockSettings.retainRecentLayers = 0;
    mockGetChatArray.mockReturnValue([]);
    await purgeOldLayerData_ACU();
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('数据层数不超过保留数时不清理', async () => {
    mockSettings.retainRecentLayers = 10;
    const chat = [
      { is_user: false },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    await purgeOldLayerData_ACU();
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });
});

// ═══ ensureV2BoundaryCheckpointForRetainedBuffer_ACU ═══
describe('ensureV2BoundaryCheckpointForRetainedBuffer_ACU', () => {
  it('手动入口在最新保留 AI 窗口首个 AI 楼层写入 full boundary checkpoint，且不删除旧楼层数据', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0
              ? {
                  checkpoint: {
                    kind: 'full',
                    createdAt: 1,
                    reason: 'init',
                    data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                  },
                }
              : {}),
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'system_cleanup',
      reason: 'manual_refill_boundary_checkpoint',
      maintenanceMode: 'exclusive',
      writeSet: [{ kind: 'all' }],
    }), expect.any(Function));
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeDefined();
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0.content[1][1]).toBe('剑');
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('将兼容 replay 已重映射的旧 row_id 固化到边界 checkpoint，并无损降级旧 init 锚点', async () => {
    mockSettings.retainRecentLayers = 2;
    const legacyData = {
      sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑'], [' 1 ', '旧副本']] },
    };
    const repairedData = {
      sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑'], ['2', '旧副本']] },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0
              ? {
                  checkpoint: {
                    kind: 'full', createdAt: 1, reason: 'init', data: structuredClone(legacyData),
                  },
                }
              : {}),
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(repairedData) });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
      data: repairedData,
    }));
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0]).toMatchObject({
      operations: [{ kind: 'data_replace', data: legacyData, reason: 'checkpoint_fallback' }],
    });
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('compaction 对 temporary sheet anchor 兼容结果执行 disabled replay 验证后再固化', async () => {
    mockSettings.retainRecentLayers = 2;
    const convergedData = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state', name: '全局数据表',
        content: [['row_id', 'value'], ['1', '历史数据']],
        sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? {
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu', version: 1 } } },
            } : {}),
            logEntries: [],
          },
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({
        baseKind: 'full_checkpoint', data: structuredClone(convergedData),
        compatibilityRepairs: [{
          kind: 'temporary_sheet_anchor', sheetKey: 'sheet_global', messageIndex: 0,
          seq: 1, operationIndex: 0, templateFingerprint: 'fnv1a32:test', reason: 'missing_at_operation',
        }],
        requiresCheckpointConvergence: true,
      })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(convergedData) });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenNthCalledWith(1, chat, '', { maxMessageIndex: 23 });
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenNthCalledWith(2, expect.any(Array), '', {
      maxMessageIndex: 23,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toMatchObject({
      kind: 'full', reason: 'compaction', data: convergedData,
    });
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('过渡根晚于保留边界时跳过本轮 compaction，不以兼容根阻断旧聊天继续使用', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? {
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'init',
                data: { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '旧物']] } },
              },
            } : {}),
            ...(index === 24 ? {
              checkpoint: { kind: 'full', createdAt: 24, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '过渡态']] } } },
            } : {}),
            logEntries: [],
          },
          ...(index === 24 ? {
            spv79TransitionCheckpoint: {
              version: 1,
              kind: 'spv79_duplicate_row_id_transition',
              createdAt: 24,
              data: { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '过渡态']] } },
              cutoff: { messageIndex: 24, seq: 0, operationIndex: -1 },
            },
          } : {}),
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    await purgeOldLayerData_ACU();

    expect(chat).toEqual(before);
    expect(mockLoadTableStateFromFramesV2Detailed).not.toHaveBeenCalled();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('边界到达过渡根后以 strict full checkpoint 收敛并删除私有根', async () => {
    mockSettings.retainRecentLayers = 2;
    const data = { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '收敛态']] } };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? {
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: structuredClone(data) },
            } : {}),
            ...(index === 10 ? {
              checkpoint: { kind: 'full', createdAt: 10, reason: 'init', data: structuredClone(data) },
            } : {}),
            logEntries: [],
          },
          ...(index === 10 ? {
            spv79TransitionCheckpoint: {
              version: 1,
              kind: 'spv79_duplicate_row_id_transition',
              createdAt: 10,
              data: structuredClone(data),
              cutoff: { messageIndex: 10, seq: 0, operationIndex: -1 },
            },
          } : {}),
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({ baseKind: 'spv79_transition_checkpoint', data: structuredClone(data) })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(data) });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[10].TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full', reason: 'compaction', data,
    }));
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenNthCalledWith(2, expect.any(Array), '', {
      maxMessageIndex: 23,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    const activeFullCheckpoints = chat.flatMap(message => {
      const checkpoint = message.TavernDB_ACU_IsolatedData?.['']?.storageFrame?.checkpoint;
      return checkpoint?.kind === 'full' ? [checkpoint] : [];
    });
    expect(activeFullCheckpoints).toHaveLength(1);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('边界已有同楼层 compaction full 时，验证等价后仍移除过渡根', async () => {
    mockSettings.retainRecentLayers = 2;
    const data = { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '既有边界']] } };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: structuredClone(data) } } : {}),
            ...(index === 23 ? { checkpoint: { kind: 'full', createdAt: 23, reason: 'compaction', data: structuredClone(data) } } : {}),
            logEntries: [],
          },
          ...(index === 23 ? {
            spv79TransitionCheckpoint: {
              version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 23,
              data: structuredClone(data), cutoff: { messageIndex: 23, seq: 0, operationIndex: -1 },
            },
          } : {}),
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({ baseKind: 'spv79_transition_checkpoint', data: structuredClone(data) })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(data) });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full', reason: 'compaction', data,
    }));
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenNthCalledWith(2, expect.any(Array), '', {
      maxMessageIndex: 23,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('已有同楼层 compaction full 收敛后 strict save 失败时恢复私有过渡根', async () => {
    mockSettings.retainRecentLayers = 2;
    const data = { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '既有边界']] } };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 23 ? { checkpoint: { kind: 'full', createdAt: 23, reason: 'compaction', data: structuredClone(data) } } : {}),
            logEntries: [],
          },
          ...(index === 23 ? {
            spv79TransitionCheckpoint: {
              version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 23,
              data: structuredClone(data), cutoff: { messageIndex: 23, seq: 0, operationIndex: -1 },
            },
          } : {}),
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({ baseKind: 'spv79_transition_checkpoint', data: structuredClone(data) })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(data) });
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('existing boundary transition save failed'));

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({
      success: false, changed: false, anchorIndex: 23, error: 'existing boundary transition save failed',
    }));
    expect(chat).toEqual(before);
  });

  it('边界已有 compaction full 但无法严格替代过渡根时保留私有根', async () => {
    mockSettings.retainRecentLayers = 2;
    const transitionData = { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '过渡态']] } };
    const inconsistentData = { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '不一致']] } };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: { version: 2, ...(index === 23 ? { checkpoint: { kind: 'full', createdAt: 23, reason: 'compaction', data: structuredClone(inconsistentData) } } : {}), logEntries: [] },
          ...(index === 23 ? { spv79TransitionCheckpoint: { version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 23, data: structuredClone(transitionData), cutoff: { messageIndex: 23, seq: 0, operationIndex: -1 } } } : {}),
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({ baseKind: 'spv79_transition_checkpoint', data: structuredClone(transitionData) })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(inconsistentData) });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23, error: expect.stringContaining('无法严格替代') }));
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('过渡根收敛的严格保存失败时恢复私有根与所有消息字段', async () => {
    mockSettings.retainRecentLayers = 2;
    const data = { sheet_0: { name: '物品表', content: [['row_id', '名称'], ['1', '过渡态']] } };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: structuredClone(data) } } : {}),
            ...(index === 10 ? {
              checkpoint: { kind: 'full', createdAt: 10, reason: 'init', data: structuredClone(data) },
            } : {}),
            logEntries: [],
          },
          ...(index === 10 ? {
            spv79TransitionCheckpoint: {
              version: 1, kind: 'spv79_duplicate_row_id_transition', createdAt: 10,
              data: structuredClone(data), cutoff: { messageIndex: 10, seq: 0, operationIndex: -1 },
            },
          } : {}),
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({ baseKind: 'spv79_transition_checkpoint', data: structuredClone(data) })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(data) });
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('transition compaction save failed'));

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23, error: 'transition compaction save failed' }));
    expect(chat).toEqual(before);
  });

  it('compaction 固化模板临时根后将其降级为 data_replace，避免留下多个 full checkpoint', async () => {
    mockSettings.retainRecentLayers = 2;
    const templateData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '旧剑']] },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? {
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'manual', data: templateData,
                fallbackProvenance: {
                  version: 1, kind: 'manual_refill_template_root', runId: 'manual-refill:test',
                  isolationKey: '', targetSheetKeys: ['sheet_0'], rangeStartMessageIndex: 0,
                  rangeEndMessageIndex: 24, templateFingerprint: 'fnv1a:test', createdAt: 1,
                },
              },
            } : {}),
            logEntries: [],
          },
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: structuredClone(templateData) });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full', reason: 'compaction', data: templateData,
    }));
    const formerRoot = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(formerRoot.checkpoint).toBeUndefined();
    expect(formerRoot.logEntries[0]).toEqual(expect.objectContaining({
      operations: [{ kind: 'data_replace', data: templateData, reason: 'checkpoint_fallback' }],
    }));
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });


  it('边界 replay 结果仍含重复 row_id 时拒绝保存并回滚 anchor', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, () => ({ is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [] }, _acu_storage_version: 2 } } }));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce({
      baseKind: 'full_checkpoint',
      data: { sheet_0: { content: [['row_id'], ['1'], ['1']] } },
    });

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toMatchObject({ success: false, changed: false, failedIsolationKey: '', error: expect.stringContaining('未满足 canonical 契约') });
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('retainRecentLayers=100 且 30 个 AI 楼层时不触发边界 rotate', async () => {
    mockSettings.retainRecentLayers = 100;
    const chat = Array.from({ length: 30 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 29
              ? { kind: 'full', createdAt: 30, reason: 'manual', data: { sheet_0: { name: '默认保留', content: [['row_id'], ['30']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(false);
    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: false, skipped: true }));
    expect(mockLoadTableStateFromFramesV2).not.toHaveBeenCalled();
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(chat[29].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'manual' }));
  });

  it('唯一 immutable 向量 pointer 位于 purge 区时迁移到新 boundary，且不复制 chunks 或改写 manifest identity', async () => {
    mockSettings.retainRecentLayers = 2;
    const manifest = {
      version: 1, backend: 'st-files', status: 'ready', indexId: 'idx-boundary-relocate',
      chatKey: 'chat-test', isolationKey: 'default', sourceTableKey: 'sheet_summary', sourceTableName: '纪要表',
      snapshotMessageId: 'message-0', indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      rowCount: 1, chunkCount: 1, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
      rowsFile: 'vector-boundary.json', tombstoneFile: 'vector-boundary.json', manifestFile: 'vector-boundary.json', files: [],
      baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
      snapshot: { revision: 3, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: ['row-a'], activeChunkIds: ['chunk-a'], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-default', writeGeneration: 'write-a', revision: 3 },
    };
    const sourceState = {
      version: 1, backend: 'st-files', status: 'ready', indexId: manifest.indexId,
      snapshotMessageId: manifest.snapshotMessageId, sourceTableKey: manifest.sourceTableKey, sourceTableName: manifest.sourceTableName,
      indexedAt: manifest.indexedAt, rowCount: 1, chunkCount: 1, skippedRowCount: 0,
      rows: [{ rowKey: 'row-a', rowId: '1', rowOrder: 0, timeSpan: '', location: '', summary: '事件', indexCode: 'A', vectorSourceText: '事件', chunkIds: ['chunk-a'] }],
      chunks: [{ chunkId: 'chunk-a', rowKey: 'row-a', rowOrder: 0, sequence: 0, text: '事件', vector: [1, 2] }],
      manifest,
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0 ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id'], ['1']] } } } } : {}),
            logEntries: [],
          },
          ...(index === 0 ? { summaryVectorIndexState: sourceState, summaryVectorIndexManifest: manifest } : {}),
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    const anchorTag = chat[23].TavernDB_ACU_IsolatedData[''];
    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(anchorTag.summaryVectorIndexManifest).toEqual(manifest);
    expect(anchorTag.summaryVectorIndexManifest).not.toBe(manifest);
    expect(anchorTag.summaryVectorIndexState.manifest).toEqual(manifest);
    expect(anchorTag.summaryVectorIndexState.chunks).toBeUndefined();
    expect(anchorTag.summaryVectorIndexState.rows).toEqual([
      expect.objectContaining(sourceState.rows[0]),
    ]);
    expect(anchorTag.storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'compaction' }));
    expect(sourceState.chunks).toHaveLength(1);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('同 source scope 同 revision 存在多个 immutable generation 时拒绝猜测迁移并中止保存', async () => {
    mockSettings.retainRecentLayers = 2;
    const makeManifest = (indexId: string, writeGeneration: string) => ({
      version: 1, backend: 'st-files', status: 'ready', indexId,
      chatKey: 'chat-test', isolationKey: 'default', sourceTableKey: 'sheet_summary', sourceTableName: '纪要表',
      snapshotMessageId: indexId, indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      rowCount: 0, chunkCount: 0, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
      manifestFile: `${indexId}.json`, rowsFile: `${indexId}.json`, tombstoneFile: `${indexId}.json`, files: [],
      baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
      snapshot: { revision: 3, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: [], activeChunkIds: [], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-default', writeGeneration, revision: 3 },
    });
    const first = makeManifest('idx-generation-a', 'write-a');
    const second = makeManifest('idx-generation-b', 'write-b');
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0 ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id'], ['1']] } } } } : {}),
            logEntries: [],
          },
          ...(index === 0 ? { summaryVectorIndexManifest: first } : index === 1 ? { summaryVectorIndexManifest: second } : {}),
          _acu_storage_version: 2,
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23 }));
    expect(result.error).toContain('多个 immutable generation');
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

  it('同一 tag slot 的 state 与 standalone manifest 分裂为不同 generation 时拒绝迁移', async () => {
    mockSettings.retainRecentLayers = 2;
    const makeManifest = (indexId: string, writeGeneration: string) => ({
      version: 1, backend: 'st-files', status: 'ready', indexId,
      chatKey: 'chat-test', isolationKey: 'default', sourceTableKey: 'sheet_summary', sourceTableName: '纪要表',
      snapshotMessageId: indexId, indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      rowCount: 0, chunkCount: 0, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
      manifestFile: `${indexId}.json`, rowsFile: `${indexId}.json`, tombstoneFile: `${indexId}.json`, files: [],
      baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
      snapshot: { revision: 3, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: [], activeChunkIds: [], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-default', writeGeneration, revision: 3 },
    });
    const stateManifest = makeManifest('idx-state-generation', 'write-state');
    const standaloneManifest = makeManifest('idx-standalone-generation', 'write-standalone');
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0 ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id'], ['1']] } } } } : {}),
            logEntries: [],
          },
          ...(index === 0 ? {
            summaryVectorIndexState: { manifest: stateManifest },
            summaryVectorIndexManifest: standaloneManifest,
          } : {}),
          _acu_storage_version: 2,
        },
      },
    }));
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23 }));
    expect(result.error).toContain('多个 immutable generation');
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

  it('anchor 已有 compaction checkpoint 时仍迁移缺失 pointer，且保持既有 frame 引用不变', async () => {
    mockSettings.retainRecentLayers = 2;
    const manifest = {
      version: 1, backend: 'st-files', status: 'ready', indexId: 'idx-existing-boundary', chatKey: 'chat-test', isolationKey: 'default',
      sourceTableKey: 'sheet_summary', sourceTableName: '纪要表', snapshotMessageId: 'message-0', indexedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      rowCount: 1, chunkCount: 1, skippedRowCount: 0, embeddingModel: 'model-a', dimension: 2,
      rowsFile: 'existing-boundary.json', tombstoneFile: 'existing-boundary.json', manifestFile: 'existing-boundary.json', files: [],
      baseShardCount: 0, deltaShardCount: 0, tombstoneRowCount: 0, tombstoneChunkCount: 0, externalTotalBytes: 1,
      snapshot: { revision: 1, mode: 'single_file_snapshot', parentIndexIds: [], activeRowKeys: [], activeChunkIds: [], removedRowKeys: [], replacedRowKeys: [], batchIds: [] },
      storageIdentity: { layoutVersion: 2, scopeFingerprint: 'scope-default', writeGeneration: 'write-a', revision: 1 },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({ is_user: false, TavernDB_ACU_IsolatedData: { '': {
      storageFrame: { version: 2, checkpoint: index === 23 ? { kind: 'full', createdAt: 2, reason: 'compaction', data: { sheet_0: { name: '已有' } } } : undefined, logEntries: [] },
      ...(index === 0 ? { summaryVectorIndexManifest: manifest } : {}), _acu_storage_version: 2,
    } } }));
    const anchorFrame = chat[23].TavernDB_ACU_IsolatedData[''].storageFrame;
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame).toBe(anchorFrame);
    expect(chat[23].TavernDB_ACU_IsolatedData[''].summaryVectorIndexManifest.indexId).toBe(manifest.indexId);
    expect(mockLoadTableStateFromFramesV2).not.toHaveBeenCalled();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('已有 anchor compaction full checkpoint 时跳过写入并不保存', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 23
              ? { kind: 'full', createdAt: 2, reason: 'compaction', data: { sheet_0: { name: '已有', content: [['row_id']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: false, anchorIndex: 23 }));
    expect(mockLoadTableStateFromFramesV2).not.toHaveBeenCalled();
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('retained window 内已有非 compaction full 时仍写 anchor，并将旧 full 降级为 data_replace log', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 24
              ? {
                  kind: 'full',
                  createdAt: 24,
                  reason: 'manual',
                  data: { sheet_0: { name: '最新旧快照', content: [['row_id', '物品名'], ['1', '盾']] } },
                }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    const downgradedFrame = chat[24].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(downgradedFrame.checkpoint).toBeUndefined();
    expect(downgradedFrame.logEntries[0]).toEqual(expect.objectContaining({
      source: 'system',
      targetMessageIndex: 24,
      operations: [{ kind: 'data_replace', data: { sheet_0: { name: '最新旧快照', content: [['row_id', '物品名'], ['1', '盾']] } }, reason: 'checkpoint_fallback' }],
    }));
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('降级 retained window 内的 full 时保留同 frame 的单表 checkpoint', async () => {
    mockSettings.retainRecentLayers = 2;
    const sheetCheckpoint = {
      kind: 'sheet_full',
      createdAt: 24,
      reason: 'manual',
      sheetKey: 'sheet_aux',
      data: { name: '辅助表', content: [['row_id', '值'], ['1', '保留']] },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 24
              ? {
                  kind: 'full',
                  createdAt: 24,
                  reason: 'manual',
                  data: { mate: { type: 'acu', version: 1 }, sheet_0: { name: '最新旧快照', content: [['row_id', '物品名'], ['1', '盾']] }, sheet_other: { name: '其他表', content: [['row_id', '值'], ['1', '不变']] } },
                }
              : undefined,
            perSheetCheckpoints: index === 24 ? { sheet_aux: sheetCheckpoint } : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    const downgradedFrame = chat[24].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(downgradedFrame.checkpoint).toBeUndefined();
    expect(downgradedFrame.perSheetCheckpoints).toEqual({ sheet_aux: sheetCheckpoint });
    expect(downgradedFrame.logEntries[0]).toEqual(expect.objectContaining({
      operations: [{
        kind: 'data_replace',
        data: {
          mate: { type: 'acu', version: 1 },
          sheet_0: { name: '最新旧快照', content: [['row_id', '物品名'], ['1', '盾']] },
          sheet_other: { name: '其他表', content: [['row_id', '值'], ['1', '不变']] },
          sheet_aux: sheetCheckpoint.data,
        },
        reason: 'checkpoint_fallback',
      }],
    }));
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('降级 retained window 内的 full 时，timed 单表 checkpoint 不并入 data_replace 且保留在 perSheetCheckpoints', async () => {
    mockSettings.retainRecentLayers = 2;
    const untimedCheckpoint = {
      kind: 'sheet_full',
      createdAt: 24,
      reason: 'manual',
      sheetKey: 'sheet_aux',
      data: { name: '辅助表', content: [['row_id', '值'], ['1', '保留']] },
    };
    const timedHideCheckpoint = {
      kind: 'sheet_full',
      createdAt: 24,
      reason: 'schema_change',
      sheetKey: 'sheet_hidden',
      data: { name: '隐藏表', content: [['row_id', '值'], ['1', '隐藏前']] },
      timeline: { kind: 'sheet_hide', activateAtMessageIndex: 24, afterSeq: 0 },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 24
              ? {
                  kind: 'full',
                  createdAt: 24,
                  reason: 'manual',
                  data: { mate: { type: 'acu', version: 1 }, sheet_0: { name: '最新旧快照', content: [['row_id', '物品名'], ['1', '盾']] }, sheet_other: { name: '其他表', content: [['row_id', '值'], ['1', '不变']] } },
                }
              : undefined,
            perSheetCheckpoints: index === 24 ? { sheet_aux: untimedCheckpoint, sheet_hidden: timedHideCheckpoint } : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    const downgradedFrame = chat[24].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(downgradedFrame.checkpoint).toBeUndefined();
    expect(downgradedFrame.perSheetCheckpoints).toEqual({ sheet_aux: untimedCheckpoint, sheet_hidden: timedHideCheckpoint });
    const fallbackData = downgradedFrame.logEntries[0].operations[0].data;
    expect(fallbackData.sheet_aux).toEqual(untimedCheckpoint.data);
    expect(fallbackData.sheet_hidden).toBeUndefined();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('boundary checkpoint 恢复失败时不降级旧 full checkpoint 且不保存', async () => {
    mockSettings.retainRecentLayers = 2;
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce(null);
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? {
                  kind: 'full',
                  createdAt: 1,
                  reason: 'init',
                  data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                }
              : index === 24
                ? {
                    kind: 'full',
                    createdAt: 24,
                    reason: 'manual',
                    data: { sheet_0: { name: '旧手动快照', content: [['row_id', '物品名'], ['1', '盾']] } },
                  }
                : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23, failedIsolationKey: '' }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'manual',
    }));
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('多 isolationKey replay reject 时原位回滚并报告实际失败隔离域', async () => {
    mockSettings.retainRecentLayers = 2;
    const frozenReplayError = Object.freeze(new Error('tag_B replay 失败'));
    mockLoadTableStateFromFramesV2Detailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: { sheet_0: { name: '标签A', content: [['row_id'], ['1']] } } })
      .mockRejectedValueOnce(frozenReplayError);
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        tag_A: {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '标签A旧基线', content: [['row_id']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
        tag_B: {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '标签B旧基线', content: [['row_id']] } } }
              : index === 24
                ? { kind: 'full', createdAt: 24, reason: 'manual', data: { sheet_0: { name: '标签B手动快照', content: [['row_id'], ['b1']] } } }
                : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    const anchorMessageRef = chat[23];
    const anchorIsolatedDataRef = chat[23].TavernDB_ACU_IsolatedData;
    const anchorTagARef = chat[23].TavernDB_ACU_IsolatedData.tag_A;
    const anchorTagBRef = chat[23].TavernDB_ACU_IsolatedData.tag_B;
    const anchorTagAFrameRef = anchorTagARef.storageFrame;
    const anchorTagBFrameRef = anchorTagBRef.storageFrame;
    const anchorTagALogEntriesRef = anchorTagAFrameRef.logEntries;
    const anchorTagBLogEntriesRef = anchorTagBFrameRef.logEntries;
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23, failedIsolationKey: 'tag_B', error: 'tag_B replay 失败' }));
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenNthCalledWith(1, chat, 'tag_A', { maxMessageIndex: 23 });
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenNthCalledWith(2, chat, 'tag_B', { maxMessageIndex: 23 });
    expect(chat[23]).toBe(anchorMessageRef);
    expect(chat[23].TavernDB_ACU_IsolatedData).toBe(anchorIsolatedDataRef);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_A).toBe(anchorTagARef);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_B).toBe(anchorTagBRef);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_A.storageFrame).toBe(anchorTagAFrameRef);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_B.storageFrame).toBe(anchorTagBFrameRef);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_A.storageFrame.logEntries).toBe(anchorTagALogEntriesRef);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_B.storageFrame.logEntries).toBe(anchorTagBLogEntriesRef);
    expect(Object.prototype.hasOwnProperty.call(chat[23].TavernDB_ACU_IsolatedData.tag_A.storageFrame, 'checkpoint')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(chat[23].TavernDB_ACU_IsolatedData.tag_B.storageFrame, 'checkpoint')).toBe(true);
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_A.storageFrame.checkpoint).toBeUndefined();
    expect(chat[23].TavernDB_ACU_IsolatedData.tag_B.storageFrame.checkpoint).toBeUndefined();
    expect(chat[24].TavernDB_ACU_IsolatedData.tag_B.storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'manual' }));
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('保存失败时原位回滚边界写入及前后 full checkpoint 降级', async () => {
    mockSettings.retainRecentLayers = 2;
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('宿主保存失败'));
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '初始', content: [['row_id'], ['init']] } } }
              : index === 24
                ? { kind: 'full', createdAt: 24, reason: 'manual', data: { sheet_0: { name: '后置', content: [['row_id'], ['later']] } } }
                : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    const initMessageRef = chat[0];
    const anchorMessageRef = chat[23];
    const laterMessageRef = chat[24];
    const initIsolatedDataRef = chat[0].TavernDB_ACU_IsolatedData;
    const initTagRef = initIsolatedDataRef[''];
    const initFrameRef = initTagRef.storageFrame;
    const initCheckpointRef = initFrameRef.checkpoint;
    const initLogEntriesRef = initFrameRef.logEntries;
    const anchorIsolatedDataRef = chat[23].TavernDB_ACU_IsolatedData;
    const anchorTagRef = anchorIsolatedDataRef[''];
    const anchorFrameRef = anchorTagRef.storageFrame;
    const anchorLogEntriesRef = anchorFrameRef.logEntries;
    const laterIsolatedDataRef = chat[24].TavernDB_ACU_IsolatedData;
    const laterTagRef = laterIsolatedDataRef[''];
    const laterFrameRef = laterTagRef.storageFrame;
    const laterCheckpointRef = laterFrameRef.checkpoint;
    const laterLogEntriesRef = laterFrameRef.logEntries;
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: false, changed: false, anchorIndex: 23, error: '宿主保存失败' }));
    expect(chat[0]).toBe(initMessageRef);
    expect(chat[23]).toBe(anchorMessageRef);
    expect(chat[24]).toBe(laterMessageRef);
    expect(chat[0].TavernDB_ACU_IsolatedData).toBe(initIsolatedDataRef);
    expect(chat[0].TavernDB_ACU_IsolatedData['']).toBe(initTagRef);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame).toBe(initFrameRef);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBe(initCheckpointRef);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toBe(initLogEntriesRef);
    expect(chat[23].TavernDB_ACU_IsolatedData).toBe(anchorIsolatedDataRef);
    expect(chat[23].TavernDB_ACU_IsolatedData['']).toBe(anchorTagRef);
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame).toBe(anchorFrameRef);
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toBe(anchorLogEntriesRef);
    expect(chat[24].TavernDB_ACU_IsolatedData).toBe(laterIsolatedDataRef);
    expect(chat[24].TavernDB_ACU_IsolatedData['']).toBe(laterTagRef);
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame).toBe(laterFrameRef);
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBe(laterCheckpointRef);
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toBe(laterLogEntriesRef);
    expect(Object.prototype.hasOwnProperty.call(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame, 'checkpoint')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame, 'checkpoint')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame, 'checkpoint')).toBe(true);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'init' }));
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'manual' }));
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('user 消息不参与 AI 楼层计数，ensure anchor 写入第 21 个 AI 楼层对应的实际 chat index', async () => {
    mockSettings.retainRecentLayers = 2;
    const chat: any[] = [];
    for (let aiOrdinal = 0; aiOrdinal < 22; aiOrdinal++) {
      if (aiOrdinal === 5 || aiOrdinal === 12 || aiOrdinal === 20) {
        chat.push({ is_user: true, mes: `用户插入 ${aiOrdinal}` });
      }
      chat.push({
        is_user: false,
        mes: `AI ${aiOrdinal}`,
        TavernDB_ACU_IsolatedData: {
          '': {
            storageFrame: {
              version: 2,
              ...(aiOrdinal === 0
                ? {
                    checkpoint: {
                      kind: 'full',
                      createdAt: 1,
                      reason: 'init',
                      data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                    },
                  }
                : {}),
              logEntries: [],
            },
            _acu_storage_version: 2,
          },
        },
      });
    }
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    expect(chat).toHaveLength(25);
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeDefined();
    expect(chat[22].is_user).toBe(true);
    expect(chat[23].is_user).toBe(false);
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('retainRecentLayers=10 且 30 个 AI 楼层时在第 21 个 AI 楼层写边界并降级第 30 层 full', async () => {
    mockSettings.retainRecentLayers = 10;
    const fullRefillData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_1: {
        name: '纪要表',
        content: [
          ['row_id', '事件'],
          ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `第${index + 1}层事件`]),
        ],
      },
    };
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: {
        mate: { type: 'chatSheets', version: 1 },
        sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['20', '边界旧事件']] },
    } });
    const chat = Array.from({ length: 30 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 29
              ? { kind: 'full', createdAt: 30, reason: 'init', data: fullRefillData }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 20 }));
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenCalledWith(chat, '', { maxMessageIndex: 20 });
    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_1.content[1]).toEqual(['20', '边界旧事件']);
    const deletedLaterFrame = chat[29].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(deletedLaterFrame.checkpoint).toBeUndefined();
    expect(deletedLaterFrame.logEntries[0].operations[0]).toEqual({
      kind: 'data_replace',
      data: fullRefillData,
      reason: 'checkpoint_fallback',
    });
  });
  it('compaction 每 20 个 AI 楼层滚动一次，并在 29/30/41/50/70 节点保持节流', async () => {
    mockSettings.retainRecentLayers = 10;
    const createFrame = (index: number) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? {
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'init',
                data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
              },
            } : {}),
            logEntries: [],
          },
        },
      },
    });
    const chat = Array.from({ length: 29 }, (_, index) => createFrame(index));
    mockGetChatArray.mockReturnValue(chat);

    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(false);
    chat.push(createFrame(29));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(true);

    const first = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
    expect(first).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 20 }));
    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.compactionProvenance).toEqual({
      version: 1, triggeredAtAiCount: 30, retainCount: 10, bufferLayers: 20,
    });

    while (chat.length < 41) chat.push(createFrame(chat.length));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(false);

    while (chat.length < 50) chat.push(createFrame(chat.length));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(true);
    const second = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
    expect(second).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 40 }));
    expect(chat[40].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.compactionProvenance).toEqual({
      version: 1, triggeredAtAiCount: 50, retainCount: 10, bufferLayers: 20,
    });

    while (chat.length < 70) chat.push(createFrame(chat.length));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(true);
    const third = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
    expect(third).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 60 }));
    expect(chat[60].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.compactionProvenance).toEqual({
      version: 1, triggeredAtAiCount: 70, retainCount: 10, bufferLayers: 20,
    });
  });
  it('旧 compaction checkpoint 缺 provenance 时按锚点反推触发楼层，并在满 20 个 AI 楼层后滚动', async () => {
    mockSettings.retainRecentLayers = 10;
    const checkpointData = { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } };
    const chat = Array.from({ length: 50 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            ...(index === 0 ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData } } : {}),
            ...(index === 20 ? { checkpoint: { kind: 'full', createdAt: 20, reason: 'compaction', data: checkpointData } } : {}),
            logEntries: [],
          },
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(true);
    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 40 }));
    expect(chat[40].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.compactionProvenance).toMatchObject({
      triggeredAtAiCount: 50, retainCount: 10, bufferLayers: 20,
    });
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('缺少 provenance'));
  });

  it('有隐藏表时 compaction 将 hide checkpoint 迁移到边界 frame 的 perSheetCheckpoints（timeline=sheet_hide）', async () => {
    mockSettings.retainRecentLayers = 2;
    const hiddenSheet = {
      uid: 'sheet_hidden',
      name: '历史隐藏表',
      content: [['row_id', '值'], ['1', '隐藏前数据']],
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
    };
    mockDeriveSheetLifecycleFromFramesV2.mockReturnValue({
      statusBySheetKey: {
        sheet_hidden: { status: 'hidden', restoreSourceData: hiddenSheet },
      },
      activeSheetKeys: [],
      hiddenSheetKeys: ['sheet_hidden'],
      indeterminateSheetKeys: [],
      neverSeenSheetKeys: [],
    } as any);
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    const boundaryFrame = chat[23].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(boundaryFrame.perSheetCheckpoints.sheet_hidden).toMatchObject({
      kind: 'sheet_full',
      reason: 'compaction',
      sheetKey: 'sheet_hidden',
      data: { name: '历史隐藏表', content: [['row_id', '值'], ['1', '隐藏前数据']] },
      timeline: { kind: 'sheet_hide', activateAtMessageIndex: 23, afterSeq: 0 },
    });
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('无隐藏表时边界 frame 不含 perSheetCheckpoints 字段', async () => {
    mockSettings.retainRecentLayers = 2;
    // 默认 mockDeriveSheetLifecycleFromFramesV2 返回空 lifecycle（无隐藏表）。
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    const boundaryFrame = chat[23].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(Object.prototype.hasOwnProperty.call(boundaryFrame, 'perSheetCheckpoints')).toBe(false);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('隐藏表 restore 数据缺失时 compaction fail-closed 抛错，不静默丢数据', async () => {
    mockSettings.retainRecentLayers = 2;
    mockDeriveSheetLifecycleFromFramesV2.mockReturnValue({
      statusBySheetKey: {
        sheet_hidden: { status: 'hidden' },
      },
      activeSheetKeys: [],
      hiddenSheetKeys: ['sheet_hidden'],
      indeterminateSheetKeys: [],
      neverSeenSheetKeys: [],
    } as any);
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } } }
              : undefined,
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
    expect(result).toMatchObject({ success: false, changed: false, error: expect.stringContaining('隐藏表 sheet_hidden 缺少可迁移的 hide checkpoint 数据') });
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });






  it.each([
    ['periodic', '定期基线'],
    ['manual', '手动基线'],
    ['schema_change', '结构变更基线'],
    ['compaction', '旧压缩基线'],
    ['import', '导入基线'],
    ['migration', '迁移基线'],
    ['integrity_repair', '修复基线'],
  ] as const)('compaction 降级 pre-anchor 非 init full（reason=%s）为 data_replace，且指纹不变', async (reason, label) => {
    mockSettings.retainRecentLayers = 2;
    const preAnchorData = {
      sheet_0: { name: `物品表-${label}`, content: [['row_id', '物品名'], ['1', '剑']] },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0
              ? { checkpoint: { kind: 'full', createdAt: 1, reason, data: structuredClone(preAnchorData) } }
              : {}),
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    // anchor 前唯一 full 被无损降级为 data_replace fallback，同帧不再保留 full checkpoint。
    const formerRoot = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(formerRoot.checkpoint).toBeUndefined();
    expect(formerRoot.logEntries[0]).toEqual(expect.objectContaining({
      source: 'system',
      targetMessageIndex: 0,
      operations: [{
        kind: 'data_replace',
        data: expect.objectContaining({ sheet_0: preAnchorData.sheet_0 }),
        reason: 'checkpoint_fallback',
      }],
    }));
    // 指纹一致：降级 entry 的 data 与降级前 checkpoint.data 指纹完全相同，证明无损。
    expect(getTableDataFingerprint_ACU(formerRoot.logEntries[0].operations[0].data))
      .toBe(getTableDataFingerprint_ACU(preAnchorData));
    // 单根不变量：降级后全局只剩 anchor 的 compaction full。
    expect(chat[23].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
    expect(assertSingleActiveFullCheckpointV2_ACU(chat, '', 'test:p5-3')).toBeNull();
  });

  it('compaction 降级 pre-anchor full 后，真实回放指纹与降级前完全一致（无损举证）', async () => {
    mockSettings.retainRecentLayers = 2;
    const preAnchorData = {
      sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑'], ['2', '盾']] },
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          storageFrame: {
            version: 2,
            ...(index === 0
              ? { checkpoint: { kind: 'full', createdAt: 1, reason: 'periodic', data: structuredClone(preAnchorData) } }
              : {}),
            logEntries: [],
          },
          _acu_storage_version: 2,
        },
      },
    }));
    const before = structuredClone(chat);
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));
    const formerRoot = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(formerRoot.checkpoint).toBeUndefined();
    expect(formerRoot.logEntries[0].operations[0]).toMatchObject({ kind: 'data_replace', reason: 'checkpoint_fallback' });
    // 降级前后全链数据指纹一致：
    // - 降级前：pre-anchor full 的 checkpoint.data（before[0]）
    // - 降级后：同楼层 data_replace fallback entry 的 data（chat[0]）
    const beforeFingerprint = getTableDataFingerprint_ACU(before[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    const afterFingerprint = getTableDataFingerprint_ACU(formerRoot.logEntries[0].operations[0].data);
    expect(afterFingerprint).toBe(beforeFingerprint);
  });

  // ═══ S3-2 periodic full checkpoint 前滚 ═══

  const createPeriodicFrame = (withInitRoot: boolean) => ({
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': {
        storageFrame: {
          version: 2,
          ...(withInitRoot
            ? {
                checkpoint: {
                  kind: 'full', createdAt: 1, reason: 'init',
                  data: { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } },
                },
              }
            : {}),
          logEntries: [],
        },
        _acu_storage_version: 2,
      },
    },
  });

  it('retain=0（清理禁用）且根距尾部 ≥ 40 层时触发 periodic 前滚：写 reason=periodic 根、无损降级旧根、不清除任何楼层', async () => {
    mockSettings.retainRecentLayers = 0;
    const chat = Array.from({ length: 45 }, (_, index) => createPeriodicFrame(index === 0));
    mockGetChatArray.mockReturnValue(chat);

    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(true);
    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });

    // 锚点 = 倒数第 21 个 AI 楼层（尾部缓冲 20 层）：45 层全 AI → index 24。
    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 24 }));
    expect(chat[24].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'periodic',
      compactionProvenance: { version: 1, triggeredAtAiCount: 45, retainCount: 0, bufferLayers: 20 },
    }));
    // 旧 init 根被无损降级为 data_replace fallback entry，单根不变量保持。
    const formerRoot = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(formerRoot.checkpoint).toBeUndefined();
    expect(formerRoot.logEntries[0].operations[0]).toMatchObject({ kind: 'data_replace', reason: 'checkpoint_fallback' });
    expect(assertSingleActiveFullCheckpointV2_ACU(chat, '', 'test:s3-2')).toBeNull();
    // periodic 只前滚基线，不清除任何楼层。
    expect(chat).toHaveLength(45);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('retain=0 且根距尾部不足 40 层时不触发 periodic；无 V2 帧的聊天同样不触发', async () => {
    mockSettings.retainRecentLayers = 0;
    const chat = Array.from({ length: 39 }, (_, index) => createPeriodicFrame(index === 0));
    mockGetChatArray.mockReturnValue(chat);

    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(false);
    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });
    expect(result).toEqual(expect.objectContaining({ success: true, changed: false, skipped: true }));
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'init' }));
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();

    // 无任何 V2 帧：没有可前滚的根，不触发。
    mockGetChatArray.mockReturnValue(Array.from({ length: 60 }, () => ({ is_user: false })));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(false);
  });

  it('periodic 前滚后自节流：距新根不足 40 层不再触发，到期后再次前滚并降级上一个 periodic 根', async () => {
    mockSettings.retainRecentLayers = 0;
    const chat = Array.from({ length: 45 }, (_, index) => createPeriodicFrame(index === 0));
    mockGetChatArray.mockReturnValue(chat);

    const first = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });
    expect(first).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 24 }));

    // 新根在第 25 个 AI 楼层；到 64 层时距离 39 < 40，不触发。
    while (chat.length < 64) chat.push(createPeriodicFrame(false));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(false);

    // 65 层时距离 40，再次前滚到倒数第 21 层（index 44），上一个 periodic 根被降级。
    chat.push(createPeriodicFrame(false));
    expect(shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU()).toBe(true);
    const second = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });
    expect(second).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 44 }));
    expect(chat[44].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'periodic',
      compactionProvenance: { version: 1, triggeredAtAiCount: 65, retainCount: 0, bufferLayers: 20 },
    }));
    const formerPeriodicRoot = chat[24].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(formerPeriodicRoot.checkpoint).toBeUndefined();
    expect(formerPeriodicRoot.logEntries[0].operations[0]).toMatchObject({ kind: 'data_replace', reason: 'checkpoint_fallback' });
    expect(assertSingleActiveFullCheckpointV2_ACU(chat, '', 'test:s3-2-rethrottle')).toBeNull();
  });

  it('periodic 前滚在混合 user/AI 楼层下按 AI 序数取锚点，并把隐藏表 hide checkpoint 迁移到锚点 perSheetCheckpoints', async () => {
    mockSettings.retainRecentLayers = 0;
    const hiddenSheet = {
      uid: 'sheet_hidden',
      name: '历史隐藏表',
      content: [['row_id', '值'], ['1', '隐藏前数据']],
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
    };
    mockDeriveSheetLifecycleFromFramesV2.mockReturnValue({
      statusBySheetKey: {
        sheet_hidden: { status: 'hidden', restoreSourceData: hiddenSheet },
      },
      activeSheetKeys: [],
      hiddenSheetKeys: ['sheet_hidden'],
      indeterminateSheetKeys: [],
      neverSeenSheetKeys: [],
    } as any);
    // 90 条消息交替 user/AI：AI 楼层位于奇数 index，共 45 层；根在首个 AI 楼层（index 1）。
    const chat = Array.from({ length: 90 }, (_, index) => (
      index % 2 === 0
        ? { is_user: true }
        : createPeriodicFrame(index === 1)
    ));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });

    // 锚点 = 第 25 个 AI 楼层 = chat index 49。
    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 49 }));
    const boundaryFrame = chat[49].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(boundaryFrame.checkpoint).toEqual(expect.objectContaining({ kind: 'full', reason: 'periodic' }));
    expect(boundaryFrame.perSheetCheckpoints.sheet_hidden).toMatchObject({
      kind: 'sheet_full',
      reason: 'periodic',
      sheetKey: 'sheet_hidden',
      data: { name: '历史隐藏表', content: [['row_id', '值'], ['1', '隐藏前数据']] },
      timeline: { kind: 'sheet_hide', activateAtMessageIndex: 49, afterSeq: 0 },
    });
    expect(assertSingleActiveFullCheckpointV2_ACU(chat, '', 'test:s3-2-hidden')).toBeNull();
  });

  it('retain>0 且 cleanup 可滚动时优先 compaction，periodic 不抢跑', async () => {
    mockSettings.retainRecentLayers = 10;
    const chat = Array.from({ length: 50 }, (_, index) => createPeriodicFrame(index === 0));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 40 }));
    expect(chat[40].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      reason: 'compaction',
    }));
  });

});



// ═══ deleteLocalDataInChatCore_ACU ═══
describe('deleteLocalDataInChatCore_ACU', () => {
  it('mode=all 删除所有数据', async () => {
    const chat = [
      { is_user: true },
      { is_user: false, TavernDB_ACU_Data: { sheet_0: {} }, TavernDB_ACU_SummaryData: {} },
      { is_user: false, TavernDB_ACU_Data: { sheet_0: {} } },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('all');
    expect(count).toBe(2);
    expect(chat[1].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[2].TavernDB_ACU_Data).toBeUndefined();
  });

  it('全范围清空后不保留任何 storageFrame：数据、V2 frame、guide/scope 容器全部清除', async () => {
    const initialSheet = {
      uid: 'sheet_0',
      name: '物品表',
      content: [['row_id', '物品名'], ['1', '剑']],
      seedRows: [['2', '会复活的数据']],
    };
    const chat: any[] = [
      { is_user: true },
      {
        is_user: false,
        mes: 'AI 1',
      },
      {
        is_user: false,
        mes: 'AI 2',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: { version: 2, logEntries: [{ seq: 2, operations: [{ kind: 'row_upsert' }] }] },
          },
        },
      },
      {
        is_user: false,
        mes: 'AI 3',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'init',
                data: { mate: { type: 'acu' }, sheet_0: initialSheet },
              },
              perSheetCheckpoints: {
                sheet_0: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_0', data: initialSheet },
              },
              logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert' }] }],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await deleteLocalDataInChatCore_ACU('all');


    // 删光后回到「从未填表」状态：不再写回锚点 frame、不再保留空边界 frame。
    expect(count).toBe(2);
    expect(chat[1].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[2].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[3].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mockSaveChatToHost).toHaveBeenCalledOnce();
  });


  it('全范围清空后不残留旧 DDL/隐藏列：V2 frame 整体清除，会话回到 pristine', async () => {
    // 阶段 4 语义：删光数据后必须回到「从未填表」状态。旧实现会保留 header-only
    // init 锚点（含 sourceData 里的旧 DDL 与 hiddenPhysicalColumns），使存储策略仍判 v2，
    // 导致后续切模板走继承路径并读取残留 guide，这正是「删光数据后切模板报错」的成因。
    const initialSheet = {
      uid: 'sheet_dCudvUnH',
      name: '全局数据表',
      content: [['row_id', '主角当前所在地点'], ['1', '御苑']],
      sourceData: {
        ddl: 'CREATE TABLE global_state (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  current_location TEXT -- 主角当前所在地点\n);',
        hiddenPhysicalColumns: ['legacy_col'],
      },
    };
    const chat: any[] = [
      { is_user: true },
      { is_user: false, mes: 'AI 1' },
      {
        is_user: false,
        mes: 'AI 2',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'init',
                data: { mate: { type: 'acu' }, sheet_dCudvUnH: initialSheet },
              },
              logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert' }] }],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    await deleteLocalDataInChatCore_ACU('all');

    // 不再写回锚点 frame：旧 DDL 与隐藏列随数据一并清除。
    expect(chat[1].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(chat[2].TavernDB_ACU_IsolatedData).toBeUndefined();
    // 存储策略不再因残留 V2 痕迹而判 v2。
    expect(resolveTableStorageStrategy_ACU(chat, '')!.mode).toBe('empty');
  });


  it('手动追平预检将旧版较晚的 header-only reset checkpoint 前移到首个 AI 楼层', async () => {
    const resetFrame = {
      version: 2,
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '值']] } },
        event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      },
      logEntries: [],
    };
    const chat: any[] = [
      { is_user: false, mes: 'AI 1' },
      { is_user: false, mes: 'AI 2' },
      { is_user: false, mes: 'AI 3', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: resetFrame } } },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureManualCatchUpAnchorBeforeTarget_ACU(1, '');

    expect(result).toEqual({ status: 'repaired', checkpointMessageIndex: 0 });
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    expect(chat[2].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledOnce();
  });

  it('手动追平预检遇到含真实行数据的 canonical init checkpoint 时返回 provisional_bridge_required 且零写入', async () => {
    const chat: any[] = [
      { is_user: false, mes: 'AI 1' },
      {
        is_user: false, mes: 'AI 2', TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'init',
                data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '值'], ['1', '真实数据']] } },
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
    ];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureManualCatchUpAnchorBeforeTarget_ACU(0, '');

    // 含真实行数据的正式 full checkpoint 不能前移（bounded replay 语义会被污染），
    // 必须走 provisional bridge：不动原根、零写入。
    expect(result).toEqual({ status: 'provisional_bridge_required', checkpointMessageIndex: 1 });
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('手动追平预检丢弃 checkpoint 前已被 replay 忽略的 artifact，并保留恢复备份', async () => {
    const chat: any[] = [
      {
        is_user: false, mes: 'AI 1', TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [{ seq: 1, source: 'manual_crud', operations: [] }] } },
        },
      },
      {
        is_user: false, mes: 'AI 2', TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'init',
                data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '值']] } },
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureManualCatchUpAnchorBeforeTarget_ACU(0, '');

    expect(result).toEqual({ status: 'repaired', checkpointMessageIndex: 0 });
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeDefined();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].recoveryBackup).toMatchObject({
      recoveryKind: 'relocated_checkpoint_discarded_prefix',
      sourceMessageIndex: 1,
      discardedPrefixFrames: [{ messageIndex: 0 }],
    });
    expect(chat[1].TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledOnce();
  });

  it('手动追平预检遇到 checkpoint 之后的 artifact 时保持 blocked 且零写入', async () => {
    const checkpoint = {
      kind: 'full', createdAt: 1, reason: 'migration',
      data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '值']] } },
    };
    const chat: any[] = [
      { is_user: false, mes: 'AI 1' },
      { is_user: false, mes: 'AI 2', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint, logEntries: [] } } } },
      { is_user: false, mes: 'AI 3', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [{ seq: 1, operations: [] }] } } } },
    ];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await ensureManualCatchUpAnchorBeforeTarget_ACU(0, '');

    expect(result).toMatchObject({ status: 'blocked', error: expect.stringContaining('之后存在无法安全重排') });
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('手动追平锚点移动严格保存失败时恢复所有受影响 frame', async () => {
    const chat: any[] = [
      { is_user: false, mes: 'AI 1', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [{ seq: 1, operations: [] }] } } } },
      { is_user: false, mes: 'AI 2', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '值']] } } }, logEntries: [] } } } },
    ];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('host unavailable'));

    const result = await ensureManualCatchUpAnchorBeforeTarget_ACU(0, '');

    expect(result).toMatchObject({ status: 'blocked', error: expect.stringContaining('保存失败') });
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledOnce();
  });


  it('空聊天记录返回 0', async () => {
    mockGetChatArray.mockReturnValue([]);
    const count = await deleteLocalDataInChatCore_ACU('all');
    expect(count).toBe(0);
  });

  it('mode=current 只删除当前隔离标签的数据', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    mockGetCurrentIsolationKey.mockReturnValue('tag_A');
    const chat = [
      { is_user: false, TavernDB_ACU_Data: {}, TavernDB_ACU_Identity: 'tag_A', TavernDB_ACU_IsolatedData: { tag_A: { independentData: {} } } },
      { is_user: false, TavernDB_ACU_Data: {}, TavernDB_ACU_Identity: 'tag_B' },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('current');
    expect(count).toBe(1);
  });

  it('mode=current 删除无旧版 Identity 的 V2 当前隔离槽', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    mockGetCurrentIsolationKey.mockReturnValue('tag_A');
    const chat = [
      { is_user: false, TavernDB_ACU_IsolatedData: { tag_A: { storageFrame: { version: 2, checkpoint: { kind: 'full', data: {} }, logEntries: [] }, _acu_storage_version: 2 }, tag_B: { independentData: {} } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { tag_B: { independentData: {} } } },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await deleteLocalDataInChatCore_ACU('current');

    expect(count).toBe(1);
    expect(chat[0].TavernDB_ACU_IsolatedData.tag_A).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.tag_B).toBeDefined();
    expect(chat[1].TavernDB_ACU_IsolatedData.tag_B).toBeDefined();
  });

  it('mode=current 删除过渡根承载槽，后续读取不再有可复活的私有 checkpoint', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    mockGetCurrentIsolationKey.mockReturnValue('tag_A');
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        tag_A: {
          _acu_storage_version: 2,
          storageFrame: { version: 2, logEntries: [] },
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 1,
            data: { sheet_0: { content: [['row_id'], ['1']] } },
            cutoff: { messageIndex: 0, seq: 0, operationIndex: -1 },
          },
        },
        tag_B: { independentData: {} },
      },
    }];
    mockGetChatArray.mockReturnValue(chat);

    await deleteLocalDataInChatCore_ACU('current');

    expect(chat[0].TavernDB_ACU_IsolatedData.tag_A).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.tag_B).toBeDefined();
  });

  it('指定楼层范围', async () => {
    const chat = [
      { is_user: false, TavernDB_ACU_Data: {} }, // AI楼层1
      { is_user: false, TavernDB_ACU_Data: {} }, // AI楼层2
      { is_user: false, TavernDB_ACU_Data: {} }, // AI楼层3
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('all', 1, 2);
    expect(count).toBe(2);
    expect(chat[2].TavernDB_ACU_Data).toBeDefined(); // 第3层不在范围内
  });
  it('mode=all 全范围删除时清理挂在 chat[0] 的旧版表头清单', async () => {
    const chat: any[] = [
      { is_user: true, TavernDB_ACU_TableHeaderGuide: JSON.stringify({ tags: { '': { sheet_0: {} }, tag_B: { sheet_1: {} } } }) },
      { is_user: false, TavernDB_ACU_Data: { sheet_0: {} } },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('all');
    expect(count).toBeGreaterThan(0);
    // 旧版表头清单与 AI 楼层无关，不会被按楼层删除覆盖到，必须显式清理。
    expect(chat[0].TavernDB_ACU_TableHeaderGuide).toBeUndefined();
  });

  it('mode=current 只删旧版表头清单里当前隔离标识的分组', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    mockGetCurrentIsolationKey.mockReturnValue('tag_A');
    const chat: any[] = [
      { is_user: true, TavernDB_ACU_TableHeaderGuide: JSON.stringify({ tags: { tag_A: { sheet_0: {} }, tag_B: { sheet_1: {} } } }) },
      { is_user: false, TavernDB_ACU_IsolatedData: { tag_A: { independentData: {} } } },
    ];
    mockGetChatArray.mockReturnValue(chat);
    await deleteLocalDataInChatCore_ACU('current');
    const remaining = JSON.parse(chat[0].TavernDB_ACU_TableHeaderGuide);
    expect(remaining.tags.tag_A).toBeUndefined();
    expect(remaining.tags.tag_B).toBeDefined();
  });

  it('指定局部楼层范围时不动旧版表头清单', async () => {
    const guide = JSON.stringify({ tags: { '': { sheet_0: {} } } });
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {}, TavernDB_ACU_TableHeaderGuide: guide },
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    await deleteLocalDataInChatCore_ACU('all', 1, 2);
    // 局部删除不得误删仍被范围外楼层依赖的兼容指导数据。
    expect(chat[0].TavernDB_ACU_TableHeaderGuide).toBe(guide);
  });

  it('T1 字段清单防漂移：删除函数处理集合与权威清单差集恰为 IsolatedData', async () => {
    const { MESSAGE_TABLE_FIELDS_ACU } = await import('../../../src/data/repositories/chat-message-data-repo');
    const handled = new Set([
      'TavernDB_ACU_Data',
      'TavernDB_ACU_SummaryData',
      'TavernDB_ACU_IndependentData',
      'TavernDB_ACU_Identity',
      'TavernDB_ACU_LocalMessageAnchor',
      '_acu_local_template_base_state_seeded',
      'TavernDB_ACU_IsolatedData',
    ]);
    // ModifiedKeys/UpdateGroupKeys 是更新追踪元数据，非数据本体，刻意不置 modified；此处只断言数据字段差集。
    const dataFields = new Set(MESSAGE_TABLE_FIELDS_ACU.filter(field => !['TavernDB_ACU_ModifiedKeys', 'TavernDB_ACU_UpdateGroupKeys'].includes(field)));
    const missing = [...dataFields].filter(field => !handled.has(field));
    expect(missing).toEqual([]);
    expect([...dataFields].filter(field => field === 'TavernDB_ACU_IsolatedData')).toEqual(['TavernDB_ACU_IsolatedData']);
  });

  it('T2 mode=all 全范围后 LocalMessageAnchor 与 seed 标记均被删除', async () => {
    const chat: any[] = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_Data: { sheet_0: {} },
        TavernDB_ACU_LocalMessageAnchor: { messageIndex: 1, sheetKey: 'sheet_0' },
        _acu_local_template_base_state_seeded: 'GREETING_LOCAL_BASE_STATE_MARKER',
      },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('all');
    expect(count).toBe(1);
    expect(chat[1].TavernDB_ACU_LocalMessageAnchor).toBeUndefined();
    expect(chat[1]._acu_local_template_base_state_seeded).toBeUndefined();
    expect(mockSaveChatToHost).toHaveBeenCalledOnce();
  });

  it('T3 mode=current 且启用隔离时只删当前隔离键分片，其他标识数据保留', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'tag_A';
    mockGetCurrentIsolationKey.mockReturnValue('tag_A');
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_IsolatedData: { tag_A: { independentData: {} }, tag_B: { independentData: {} } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { tag_B: { independentData: {} } } },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('current');
    expect(count).toBe(1);
    expect(chat[0].TavernDB_ACU_IsolatedData.tag_A).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData.tag_B).toBeDefined();
    expect(chat[1].TavernDB_ACU_IsolatedData.tag_B).toBeDefined();
  });

  it('T4 仅剩 seed 标记可删时 deletedCount>0 且触发 saveChatToHost', async () => {
    const chat: any[] = [
      { is_user: true },
      { is_user: false, _acu_local_template_base_state_seeded: 'GREETING_LOCAL_BASE_STATE_MARKER' },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const count = await deleteLocalDataInChatCore_ACU('all');
    expect(count).toBe(1);
    expect(chat[1]._acu_local_template_base_state_seeded).toBeUndefined();
    expect(mockSaveChatToHost).toHaveBeenCalledOnce();
  });


// ═══ deleteLocalDataWithScope_ACU（范围感知分派） ═══
describe('deleteLocalDataWithScope_ACU', () => {
  it('S1 all + (null, null) 全范围留空 → purge 分支（真实 purge 清空 chat）', async () => {
    const chat: any[] = [
      { is_user: true },
      { is_user: false, TavernDB_ACU_Data: { sheet_0: {} } },
      { is_user: false, TavernDB_ACU_Data: { sheet_0: {} } },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('all', null, null);
    expect(outcome.path).toBe('purge');
    if (outcome.path === 'purge') {
      expect(outcome.result.saved).toBe(true);
    }
    expect(chat[1].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[2].TavernDB_ACU_Data).toBeUndefined();
  });

  it('S2 all + (1, aiCount) 显式覆盖全部 → purge 分支', async () => {
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('all', 1, 3);
    expect(outcome.path).toBe('purge');
    expect(chat[0].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[1].TavernDB_ACU_Data).toBeUndefined();
    expect(chat[2].TavernDB_ACU_Data).toBeUndefined();
  });

  it('S3 all + (1, 999) end 超上界 → purge 分支', async () => {
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('all', 1, 999);
    expect(outcome.path).toBe('purge');
  });

  it('S4 all + (1, aiCount-1) 未覆盖最后一层 → range 分支，core 被调用', async () => {
    mockRunTableWriteTransaction.mockImplementation(async (_opts: any, fn: any) => fn());
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('all', 1, 2);
    expect(outcome.path).toBe('range');
    if (outcome.path === 'range') {
      expect(outcome.deletedCount).toBe(2);
    }
    expect(mockRunTableWriteTransaction).toHaveBeenCalled();
    // 第 3 层不在范围内，数据保留
    expect(chat[2].TavernDB_ACU_Data).toBeDefined();
  });

  it('S5 all + (2, null) 未覆盖第一层 → range 分支', async () => {
    mockRunTableWriteTransaction.mockImplementation(async (_opts: any, fn: any) => fn());
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('all', 2, null);
    expect(outcome.path).toBe('range');
    expect(chat[0].TavernDB_ACU_Data).toBeDefined();
  });

  it('S6 current + (null, null) 永不 purge（C5 回归闸门）', async () => {
    mockRunTableWriteTransaction.mockImplementation(async (_opts: any, fn: any) => fn());
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('current', null, null);
    expect(outcome.path).toBe('range');
    if (outcome.path === 'range') {
      expect(outcome.deletedCount).toBeGreaterThanOrEqual(0);
    }
    expect(mockRunTableWriteTransaction).toHaveBeenCalled();
  });

  it('S7 aiCount=0（只有用户消息）+ all + (null, null) → purge 分支', async () => {
    const chat: any[] = [{ is_user: true }];
    mockGetChatArray.mockReturnValue(chat);
    const outcome = await deleteLocalDataWithScope_ACU('all', null, null);
    expect(outcome.path).toBe('purge');
  });

  it('S8 expectedPath 与实际判定不一致 → aborted，且不触发任何服务', async () => {
    mockRunTableWriteTransaction.mockClear();
    const chat: any[] = [
      { is_user: false, TavernDB_ACU_Data: {} },
      { is_user: false, TavernDB_ACU_Data: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    // 实际判定是 purge，但调用方预判为 range
    const outcome = await deleteLocalDataWithScope_ACU('all', null, null, 'range');
    expect(outcome.path).toBe('aborted');
    expect(mockRunTableWriteTransaction).not.toHaveBeenCalled();
    // purge 也不应执行：aborted 时 chat 保持原样
    expect(chat[0].TavernDB_ACU_Data).toBeDefined();
  });

  it('S9 isFullRangeDeletionRequest_ACU 纯函数判定表全覆盖', () => {
    // aiMessageCount = 5
    expect(isFullRangeDeletionRequest_ACU(null, null, 5)).toBe(true);
    expect(isFullRangeDeletionRequest_ACU(1, null, 5)).toBe(true);
    expect(isFullRangeDeletionRequest_ACU(1, 5, 5)).toBe(true);
    expect(isFullRangeDeletionRequest_ACU(1, 999, 5)).toBe(true);
    expect(isFullRangeDeletionRequest_ACU(1, 4, 5)).toBe(false);
    expect(isFullRangeDeletionRequest_ACU(2, null, 5)).toBe(false);
    expect(isFullRangeDeletionRequest_ACU(3, 5, 5)).toBe(false);
    // aiCount = 0（只有用户消息）：空范围视为覆盖全部
    expect(isFullRangeDeletionRequest_ACU(null, null, 0)).toBe(true);
  });

  it('S10 编排入口自身不包裹事务：deleteLocalDataWithScope_ACU 内部不会额外调用 runTableWriteTransaction', async () => {
    mockRunTableWriteTransaction.mockClear();
    const chat: any[] = [{ is_user: false, TavernDB_ACU_Data: {} }];
    mockGetChatArray.mockReturnValue(chat);
    // purge 分支：真实 purge 内部会调 runTableWriteTransaction（1 次），但编排入口本身不应再包一层
    const outcome = await deleteLocalDataWithScope_ACU('all', null, null);
    expect(outcome.path).toBe('purge');
    // 编排入口自身的判定/分派不应直接调用事务包装；真实 purge 内部调用恰好 1 次
    expect(mockRunTableWriteTransaction.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

});

// ═══ clearTableDataAtFloors_ACU ═══
describe('clearTableDataAtFloors_ACU', () => {
  it('按目标楼层和 selected sheet 精确清理 V2 storageFrame，保留同层其他表和范围外基底', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI范围外基底',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'compaction',
                data: {
                  sheet_0: { name: '范围外表', content: [['row_id'], ['base']] },
                },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户消息跳过' },
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            independentData: {
              sheet_0: { name: '旧目标表' },
              sheet_1: { name: '保留表' },
            },
            modifiedKeys: ['sheet_0', 'sheet_1'],
            updateGroupKeys: ['sheet_0', 'sheet_1'],
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'manual',
                data: {
                  sheet_0: { name: '旧目标表', content: [['row_id'], ['old']] },
                  sheet_1: { name: '保留表', content: [['row_id'], ['keep']] },
                },
                scheduleSummary: {
                  sheet_0: { lastFilledAiFloor: 1 },
                  sheet_1: { lastFilledAiFloor: 1 },
                },
                event: {
                  filledSheetKeys: ['sheet_0', 'sheet_1'],
                  changedSheetKeys: ['sheet_0', 'sheet_1'],
                  groupKeys: ['sheet_0', 'sheet_1'],
                },
              },
              logEntries: [
                {
                  seq: 1,
                  operations: [
                    { kind: 'data_replace', data: { sheet_0: { name: '旧目标表' }, sheet_1: { name: '保留表' } } },
                  ],
                  filledSheetKeys: ['sheet_0', 'sheet_1'],
                  changedSheetKeys: ['sheet_0', 'sheet_1'],
                  groupKeys: ['sheet_0', 'sheet_1'],
                },
              ],
            },
            spv79TransitionCheckpoint: {
              version: 1,
              kind: 'spv79_duplicate_row_id_transition',
              createdAt: 2,
              data: {
                sheet_0: { name: '旧目标表', content: [['row_id'], ['legacy-target']] },
                sheet_1: { name: '保留表', content: [['row_id'], ['legacy-keep']] },
              },
              cutoff: { messageIndex: 2, seq: 0, operationIndex: -1 },
              scheduleSummary: { sheet_0: { lastFilledAiFloor: 1 }, sheet_1: { lastFilledAiFloor: 1 } },
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearTableDataAtFloors_ACU([1, 2], ['sheet_0']);

    expect(count).toBe(1);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0).toBeDefined();
    expect(chat[1]).toEqual({ is_user: true, mes: '用户消息跳过' });
    const targetTag = chat[2].TavernDB_ACU_IsolatedData[''];
    expect(targetTag.independentData.sheet_0).toBeUndefined();
    expect(targetTag.independentData.sheet_1).toEqual({ name: '保留表' });
    expect(targetTag.modifiedKeys).toEqual(['sheet_1']);
    expect(targetTag.updateGroupKeys).toEqual(['sheet_1']);
    // 私有根本身就是 canonical 完整状态；删除只裁剪目标表，不再要求 cutoff artifact
    // 仍存在，也不通过“先收敛成功才允许删除”的门禁阻断旧聊天。
    expect(targetTag.spv79TransitionCheckpoint).toEqual(expect.objectContaining({
      kind: 'spv79_duplicate_row_id_transition',
      data: { sheet_1: { name: '保留表', content: [['row_id'], ['legacy-keep']] } },
      scheduleSummary: { sheet_1: { lastFilledAiFloor: 1 } },
    }));
    expect(targetTag.storageFrame.checkpoint.data.sheet_0).toBeUndefined();
    expect(targetTag.storageFrame.logEntries).toEqual([expect.objectContaining({
      seq: 1,
      operations: [{ kind: 'data_replace', data: { sheet_1: { name: '保留表' } } }],
      filledSheetKeys: ['sheet_1'],
      changedSheetKeys: ['sheet_1'],
      groupKeys: ['sheet_1'],
    })]);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('清空过渡根仅剩的表时删除私有 root，避免后续 replay 从已删除表复活', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: { version: 2, logEntries: [] },
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 1,
            data: { sheet_0: { name: '唯一表', content: [['row_id'], ['1']] } },
            cutoff: { messageIndex: 0, seq: 0, operationIndex: -1 },
          },
        },
      },
    }];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearTableDataAtFloors_ACU([0], ['sheet_0']);

    expect(count).toBe(1);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });
});


describe('clearManualRefillIncrementalDataInRange_ACU', () => {
  it('只清理目标楼层 selected sheet 的 V2 增量数据并保留 checkpoint.data', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI范围外基底',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'compaction',
                data: {
                  sheet_0: { name: '范围外表', content: [['row_id'], ['base']] },
                },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户消息跳过' },
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            independentData: {
              sheet_0: { name: '旧目标表' },
              sheet_1: { name: '保留表' },
            },
            modifiedKeys: ['sheet_0', 'sheet_1'],
            updateGroupKeys: ['sheet_0', 'sheet_1'],
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'manual',
                data: {
                  sheet_0: { name: '旧目标表', content: [['row_id'], ['old']] },
                  sheet_1: { name: '保留表', content: [['row_id'], ['keep']] },
                },
                scheduleSummary: {
                  sheet_0: { lastFilledAiFloor: 1 },
                  sheet_1: { lastFilledAiFloor: 1 },
                },
              },
              manualRefillProgress: {
                kind: 'manual_refill',
                status: 'in_progress',
                selectedSheetKeys: ['sheet_0', 'sheet_1'],
                completedSheetMessageIndexByKey: { sheet_0: 2, sheet_1: 3 },
              },
              logEntries: [
                {
                  seq: 1,
                  operations: [
                    { kind: 'row_upsert', sheetKey: 'sheet_0', rowId: 'old-only', cells: ['old-only'] },
                  ],
                  filledSheetKeys: ['sheet_0'],
                  changedSheetKeys: ['sheet_0'],
                  groupKeys: ['sheet_0'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
                },
                {
                  seq: 2,
                  operations: [
                    { kind: 'data_replace', data: { sheet_0: { name: '旧目标表' }, sheet_1: { name: '保留表' } } },
                  ],
                  filledSheetKeys: ['sheet_0', 'sheet_1'],
                  changedSheetKeys: ['sheet_0', 'sheet_1'],
                  groupKeys: ['sheet_0', 'sheet_1'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }, { kind: 'sheet', sheetKey: 'sheet_1' }],
                },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([1, 2], ['sheet_0']);

    expect(count).toBe(1);
    expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'system_cleanup',
      reason: 'clearIncrementalOnly',
      maintenanceMode: 'exclusive',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
    }), expect.any(Function));
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0).toBeDefined();
    expect(chat[1]).toEqual({ is_user: true, mes: '用户消息跳过' });
    const targetTag = chat[2].TavernDB_ACU_IsolatedData[''];
    expect(targetTag.independentData.sheet_0).toEqual({ name: '旧目标表' });
    expect(targetTag.modifiedKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(targetTag.updateGroupKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(targetTag.storageFrame.checkpoint.data.sheet_0.content[1][0]).toBe('old');
    expect(targetTag.storageFrame.checkpoint.data.sheet_1.content[1][0]).toBe('keep');
    expect(targetTag.storageFrame.checkpoint.scheduleSummary.sheet_0).toEqual({ lastFilledAiFloor: 1 });
    expect(targetTag.storageFrame.manualRefillProgress.selectedSheetKeys).toEqual(['sheet_1']);
    expect(targetTag.storageFrame.manualRefillProgress.completedSheetMessageIndexByKey).toEqual({ sheet_1: 3 });
    expect(targetTag.storageFrame.logEntries).toHaveLength(1);
    expect(targetTag.storageFrame.logEntries[0].seq).toBe(2);
    expect(targetTag.storageFrame.logEntries[0].operations[0].data).toEqual({ sheet_0: { name: '旧目标表' }, sheet_1: { name: '保留表' } });
    expect(targetTag.storageFrame.logEntries[0].filledSheetKeys).toEqual(['sheet_1']);
    expect(targetTag.storageFrame.logEntries[0].writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_1' }]);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('对 V2 runtime-v1 baseRevision 与 parentRevision 目标 sheet 指纹生效', async () => {
    const baseRevision = `runtime-v1:${JSON.stringify({
      sheets: {
        sheet_target: { name: '旧目标表', content: [['row_id'], ['target-base']] },
        sheet_keep: { name: '保留表', content: [['row_id'], ['keep-base']] },
      },
    })}`;
    const parentRevision = `runtime-v1:${JSON.stringify({
      sheets: {
        sheet_target: { name: '旧目标表', content: [['row_id'], ['target-parent']] },
        sheet_keep: { name: '保留表', content: [['row_id'], ['keep-parent']] },
      },
    })}`;
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  baseRevision,
                  parentRevision,
                  operations: [
                    { kind: 'data_replace', data: { sheet_target: { name: '旧目标表' }, sheet_keep: { name: '保留表' } } },
                  ],
                  filledSheetKeys: ['sheet_target', 'sheet_keep'],
                  changedSheetKeys: ['sheet_target', 'sheet_keep'],
                  groupKeys: ['sheet_target', 'sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }, { kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_target']);

    expect(count).toBe(1);
    const entry = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0];
    expect(entry.filledSheetKeys).toEqual(['sheet_keep']);
    expect(entry.changedSheetKeys).toEqual(['sheet_keep']);
    expect(entry.groupKeys).toEqual(['sheet_keep']);
    expect(entry.writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_keep' }]);
    expect(entry.operations[0].data).toEqual({ sheet_target: { name: '旧目标表' }, sheet_keep: { name: '保留表' } });

    const parsedBaseRevision = JSON.parse(entry.baseRevision.slice('runtime-v1:'.length));
    const parsedParentRevision = JSON.parse(entry.parentRevision.slice('runtime-v1:'.length));
    expect(parsedBaseRevision.sheets).toEqual({
      sheet_keep: { name: '保留表', content: [['row_id'], ['keep-base']] },
    });
    expect(parsedParentRevision.sheets).toEqual({
      sheet_keep: { name: '保留表', content: [['row_id'], ['keep-parent']] },
    });
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('对纯 revision-only 空壳 log entry 触发删除且 saveChatToHost 仍只调用一次', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  baseRevision: `runtime-v1:${JSON.stringify({
                    sheets: {
                      sheet_target: { name: '旧目标表', content: [['row_id'], ['target']] },
                    },
                  })}`,
                },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_target']);

    expect(count).toBe(1);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('保留异常 runtime-v1 与非 runtime-v1 revision 且无实际修改时不保存', async () => {
    const malformedRevision = 'runtime-v1:{bad json';
    const otherPrefixRevision = `other-prefix:${JSON.stringify({ sheets: { sheet_target: { name: '旧目标表' } } })}`;
    const nonObjectSheetsRevision = `runtime-v1:${JSON.stringify({ sheets: null })}`;
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                { seq: 1, baseRevision: malformedRevision },
                { seq: 2, baseRevision: otherPrefixRevision },
                { seq: 3, baseRevision: nonObjectSheetsRevision },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_target']);

    expect(count).toBe(0);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([
      { seq: 1, baseRevision: malformedRevision },
      { seq: 2, baseRevision: otherPrefixRevision },
      { seq: 3, baseRevision: nonObjectSheetsRevision },
    ]);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('按多个 targetSheetKeys 删除目标集合并保留非目标 sheet revision', async () => {
    const revision = `runtime-v1:${JSON.stringify({
      sheets: {
        sheet_a: { name: '目标表A', content: [['row_id'], ['a']] },
        sheet_b: { name: '保留表B', content: [['row_id'], ['b']] },
        sheet_c: { name: '目标表C', content: [['row_id'], ['c']] },
        sheet_d: { name: '保留表D', content: [['row_id'], ['d']] },
      },
    })}`;
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  baseRevision: revision,
                  operations: [
                    {
                      kind: 'data_replace',
                      data: {
                        sheet_a: { name: '目标表A' },
                        sheet_b: { name: '保留表B' },
                        sheet_c: { name: '目标表C' },
                        sheet_d: { name: '保留表D' },
                      },
                    },
                  ],
                  filledSheetKeys: ['sheet_a', 'sheet_b', 'sheet_c', 'sheet_d'],
                  changedSheetKeys: ['sheet_a', 'sheet_b', 'sheet_c', 'sheet_d'],
                  groupKeys: ['sheet_a', 'sheet_b', 'sheet_c', 'sheet_d'],
                  writeSet: [
                    { kind: 'sheet', sheetKey: 'sheet_a' },
                    { kind: 'sheet', sheetKey: 'sheet_b' },
                    { kind: 'sheet', sheetKey: 'sheet_c' },
                    { kind: 'sheet', sheetKey: 'sheet_d' },
                  ],
                },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_a', 'sheet_c']);

    expect(count).toBe(1);
    const entry = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0];
    expect(entry.filledSheetKeys).toEqual(['sheet_b', 'sheet_d']);
    expect(entry.changedSheetKeys).toEqual(['sheet_b', 'sheet_d']);
    expect(entry.groupKeys).toEqual(['sheet_b', 'sheet_d']);
    expect(entry.writeSet).toEqual([
      { kind: 'sheet', sheetKey: 'sheet_b' },
      { kind: 'sheet', sheetKey: 'sheet_d' },
    ]);
    expect(entry.operations[0].data).toEqual({
      sheet_a: { name: '目标表A' },
      sheet_b: { name: '保留表B' },
      sheet_c: { name: '目标表C' },
      sheet_d: { name: '保留表D' },
    });
    expect(JSON.parse(entry.baseRevision.slice('runtime-v1:'.length)).sheets).toEqual({
      sheet_b: { name: '保留表B', content: [['row_id'], ['b']] },
      sheet_d: { name: '保留表D', content: [['row_id'], ['d']] },
    });
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('清理旧版 patches.data_replace 与 entry.manualRefillProgress 中的目标 sheet 残留', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  patches: [
                    {
                      kind: 'data_replace',
                      data: {
                        sheet_target: { name: '旧目标表' },
                        sheet_keep: { name: '保留表' },
                      },
                    },
                  ],
                  manualRefillProgress: {
                    kind: 'manual_refill',
                    selectedSheetKeys: ['sheet_target', 'sheet_keep'],
                    completedSheetMessageIndexByKey: { sheet_target: 2, sheet_keep: 3 },
                  },
                  filledSheetKeys: ['sheet_target', 'sheet_keep'],
                  changedSheetKeys: ['sheet_target', 'sheet_keep'],
                  groupKeys: ['sheet_target', 'sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }, { kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_target']);

    expect(count).toBe(1);
    const entry = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0];
    expect(entry.patches).toEqual([
      {
        kind: 'data_replace',
        data: { sheet_target: { name: '旧目标表' }, sheet_keep: { name: '保留表' } },
      },
    ]);
    expect(entry.manualRefillProgress.selectedSheetKeys).toEqual(['sheet_keep']);
    expect(entry.manualRefillProgress.completedSheetMessageIndexByKey).toEqual({ sheet_keep: 3 });
    expect(entry.filledSheetKeys).toEqual(['sheet_keep']);
    expect(entry.changedSheetKeys).toEqual(['sheet_keep']);
    expect(entry.groupKeys).toEqual(['sheet_keep']);
    expect(entry.writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_keep' }]);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });


  it('目标表不存在时不修改消息且不保存', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  baseRevision: `runtime-v1:${JSON.stringify({ sheets: { sheet_keep: { name: '保留表' } } })}`,
                  filledSheetKeys: ['sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
        },
      },
    ];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_missing']);

    expect(count).toBe(0);
    expect(chat).toEqual(before);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('非空 isolationKey 只清当前标签且不串改旁路标签', async () => {
    const tagARevision = `runtime-v1:${JSON.stringify({
      sheets: {
        sheet_target: { name: '标签A目标表', content: [['row_id'], ['target-a']] },
        sheet_keep: { name: '标签A保留表', content: [['row_id'], ['keep-a']] },
      },
    })}`;
    const tagBRevision = `runtime-v1:${JSON.stringify({
      sheets: {
        sheet_target: { name: '标签B目标表', content: [['row_id'], ['target-b']] },
        sheet_keep: { name: '标签B保留表', content: [['row_id'], ['keep-b']] },
      },
    })}`;
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          'tag-a': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  baseRevision: tagARevision,
                  filledSheetKeys: ['sheet_target', 'sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }, { kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
          'tag-b': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [
                {
                  seq: 1,
                  baseRevision: tagBRevision,
                  filledSheetKeys: ['sheet_target', 'sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }, { kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
        },
      },
    ];
    const tagBBefore = JSON.parse(JSON.stringify(chat[0].TavernDB_ACU_IsolatedData['tag-b']));
    mockGetCurrentIsolationKey.mockReturnValue('tag-a');
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_target']);

    expect(count).toBe(1);
    const tagAEntry = chat[0].TavernDB_ACU_IsolatedData['tag-a'].storageFrame.logEntries[0];
    expect(tagAEntry.filledSheetKeys).toEqual(['sheet_keep']);
    expect(tagAEntry.writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_keep' }]);
    expect(JSON.parse(tagAEntry.baseRevision.slice('runtime-v1:'.length)).sheets).toEqual({
      sheet_keep: { name: '标签A保留表', content: [['row_id'], ['keep-a']] },
    });
    expect(chat[0].TavernDB_ACU_IsolatedData['tag-b']).toEqual(tagBBefore);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('清理后输出 targetKeys 残留诊断摘要且不增加保存次数', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'manual',
                data: {
                  sheet_target: { name: 'checkpoint目标表' },
                  sheet_keep: { name: 'checkpoint保留表' },
                },
                scheduleSummary: {
                  sheet_target: { lastFilledAiFloor: 3 },
                },
              },
              logEntries: [
                {
                  seq: 1,
                  baseRevision: `runtime-v1:${JSON.stringify({
                    sheets: {
                      sheet_target: { name: '旧目标表' },
                      sheet_keep: { name: '保留表' },
                    },
                  })}`,
                  filledSheetKeys: ['sheet_target', 'sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_target' }, { kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], ['sheet_target']);

    expect(count).toBe(1);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockLogDebug).toHaveBeenCalledWith('[手动重填诊断] 选中表清理后残留摘要', expect.objectContaining({
      clearedCount: 1,
      targetKeys: ['sheet_target'],
      fields: ['event', 'operations', 'patches', 'writeSet', 'revision', 'progress'],
      residue: {
        exactHits: 0,
        runtimeV1Hits: 0,
        substringOnlyPathCount: 0,
        checkpointDataRiskCount: 1,
        scheduleSummaryRiskCount: 1,
        checkpointDataRiskDetailCount: 1,
        checkpointDataRiskDetails: [
          {
            messageIndex: 0,
            tagKey: '',
            targetKey: 'sheet_target',
            reason: 'manual',
          },
        ],
      },
    }));
  });

  it('仅 checkpoint.data 残留目标表时输出风险诊断但不保存且不泄漏表内容', async () => {
    const targetKeys = Array.from({ length: 10 }, (_, index) => `sheet_target_${index + 1}`);
    const checkpointData = Object.fromEntries(targetKeys.map((key, index) => [key, { name: `checkpoint目标表${index + 1}`, content: [['row_id'], [`secret-${index + 1}`]] }]));
    const scheduleSummary = Object.fromEntries(targetKeys.map(key => [key, { lastFilledAiFloor: 3 }]));
    const chat = [
      {
        is_user: false,
        mes: 'AI目标层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'manual',
                createdAt: 123456,
                data: checkpointData,
                scheduleSummary,
              },
              logEntries: [
                {
                  seq: 1,
                  filledSheetKeys: ['sheet_keep'],
                  writeSet: [{ kind: 'sheet', sheetKey: 'sheet_keep' }],
                },
              ],
            },
          },
        },
      },
    ];
    const checkpointBefore = JSON.parse(JSON.stringify(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint));
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([0], targetKeys);

    expect(count).toBe(0);
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(checkpointBefore);
    const diagnosticCall = mockLogDebug.mock.calls.find(call => call[0] === '[手动重填诊断] 选中表清理后残留摘要');
    expect(diagnosticCall).toBeDefined();
    expect(diagnosticCall![1]).toEqual(expect.objectContaining({
      clearedCount: 0,
      targetKeys,
      residue: expect.objectContaining({
        exactHits: 0,
        runtimeV1Hits: 0,
        substringOnlyPathCount: 0,
        checkpointDataRiskCount: 1,
        scheduleSummaryRiskCount: 1,
        checkpointDataRiskDetailCount: 10,
      }),
    }));
    expect(diagnosticCall![1].residue.checkpointDataRiskDetails).toHaveLength(8);
    expect(diagnosticCall![1].residue.checkpointDataRiskDetails[0]).toEqual({
      messageIndex: 0,
      tagKey: '',
      targetKey: 'sheet_target_1',
      reason: 'manual',
      createdAt: 123456,
    });
    expect(JSON.stringify(diagnosticCall![1])).not.toContain('secret-1');
    expect(JSON.stringify(diagnosticCall![1])).not.toContain('checkpoint目标表1');
  });


  it('使用重填范围之前的 checkpoint 映射清理范围内 log-only sql_batch，避免回放 UPDATE 不存在表', async () => {
    const chat = [
      {
        is_user: false,
        mes: '历史基底',
        TavernDB_ACU_IsolatedData: JSON.stringify({
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'compaction',
                createdAt: 1,
                data: {
                  sheet_0: {
                    uid: 'chronicle',
                    name: '纪要表',
                    sourceData: { ddl: 'CREATE TABLE chronicle (row_id TEXT PRIMARY KEY, code_index TEXT)' },
                  },
                },
              },
              logEntries: [],
            },
          },
        }),
      },
      {
        is_user: false,
        mes: '待重填楼层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1,
                operations: [{
                  kind: 'sql_batch',
                  statements: ["UPDATE 'chronicle' SET 'code_index' = ? WHERE 'row_id' = ?"],
                  params: [['new-index', 'row-1']],
                }],
              }],
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const count = await clearManualRefillIncrementalDataInRange_ACU([1], ['sheet_0']);

    expect(count).toBe(1);
    const historicalTagData = JSON.parse(chat[0].TavernDB_ACU_IsolatedData);
    expect(historicalTagData[''].storageFrame.checkpoint.data.sheet_0.uid).toBe('chronicle');
    expect(chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('未指定目标表时拒绝执行，避免把手动重填增量清理退化成全量清理', async () => {
    await expect(clearManualRefillIncrementalDataInRange_ACU([1], [])).rejects.toThrow('手动重填增量清理必须指定目标表');
    await expect(clearManualRefillIncrementalDataInRange_ACU([1], null)).rejects.toThrow('手动重填增量清理必须指定目标表');
    await expect(clearManualRefillIncrementalDataInRange_ACU([1], undefined as unknown as string[])).rejects.toThrow('手动重填增量清理必须指定目标表');
    expect(mockRunTableWriteTransaction).not.toHaveBeenCalled();
  });
});

// ═══ overrideLatestLayerWithTemplateCore_ACU ═══
describe('overrideLatestLayerWithTemplateCore_ACU', () => {
  it('用模板覆盖最新层', async () => {
    const chat = [
      { is_user: true },
      { is_user: false, TavernDB_ACU_IsolatedData: {} },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const templateData = {
      sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑'], ['2', '盾']] },
    };
    const count = await overrideLatestLayerWithTemplateCore_ACU(templateData);
    expect(count).toBe(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 1,
      targetSheetKeys: ['sheet_0'],
      source: 'system',
    }));
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('空聊天记录返回 0', async () => {
    mockGetChatArray.mockReturnValue([]);
    const count = await overrideLatestLayerWithTemplateCore_ACU({ sheet_0: { name: '表' } });
    expect(count).toBe(0);
  });

  it('无 AI 消息返回 0', async () => {
    mockGetChatArray.mockReturnValue([{ is_user: true }]);
    const count = await overrideLatestLayerWithTemplateCore_ACU({ sheet_0: { name: '表' } });
    expect(count).toBe(0);
  });

  it('覆盖后只保留表头', async () => {
    const chat = [{ is_user: false }];
    mockGetChatArray.mockReturnValue(chat);
    const templateData = {
      sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑'], ['2', '盾']] },
    };
    await overrideLatestLayerWithTemplateCore_ACU(templateData);
    const call = mockPersistTablesToChatMessage.mock.calls[0]?.[0];
    expect(call.operations[0].kind).toBe('sheet_replace');
    expect(call.operations[0].sheet.content.length).toBe(1); // 只有表头
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
  });
});

// ═══ saveCurrentDataForTable_ACU ═══
describe('saveCurrentDataForTable_ACU', () => {
  beforeEach(() => {
    mockPersistTablesToChatMessage.mockClear();
  });

  it('无数据时不报错', async () => {
    mockCurrentJsonTableData.sheet_0 = undefined;
    await expect(saveCurrentDataForTable_ACU('sheet_0')).resolves.not.toThrow();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });
  it('无聊天记录时不报错', async () => {
    mockGetChatArray.mockReturnValue([]);
    await expect(saveCurrentDataForTable_ACU('sheet_0')).resolves.not.toThrow();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });
  it('聊天记录全为 user 消息时不调用持久化', async () => {
    const chat = [{ is_user: true, mes: '用户消息' }];
    mockGetChatArray.mockReturnValue(chat);
    mockCurrentJsonTableData.sheet_0 = { name: '物品表', content: [] };
    await saveCurrentDataForTable_ACU('sheet_0');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });
  it('标准表调用 persistTablesToChatMessage_ACU 持久化', async () => {
    const chat = [{ is_user: false, mes: 'AI回复' }];
    mockGetChatArray.mockReturnValue(chat);
    mockCurrentJsonTableData.sheet_0 = { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] };
    await saveCurrentDataForTable_ACU('sheet_0');
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_0'],
      updateGroupKeys: null,
      trackAsUpdate: true
    }));
  });
  it('存在历史数据时 trackAsUpdate 为 false 且指向历史数据楼层', async () => {
    const chat = [
      { is_user: false, mes: '旧AI回复', TavernDB_ACU_IsolatedData: { '': { independentData: { sheet_0: { name: '物品表' } } } } },
      { is_user: true, mes: '用户新消息' },
      { is_user: false, mes: '新AI回复' }
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockCurrentJsonTableData.sheet_0 = { name: '物品表', content: [] };
    await saveCurrentDataForTable_ACU('sheet_0');
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_0'],
      trackAsUpdate: false
    }));
  });
  it('纪要表调用 persistTablesToChatMessage_ACU 持久化', async () => {
    const chat = [{ is_user: false, mes: 'AI回复' }];
    mockGetChatArray.mockReturnValue(chat);
    mockCurrentJsonTableData.sheet_1 = { name: '纪要表', content: [['row_id', '事件'], ['1', '开始']] };
    await saveCurrentDataForTable_ACU('sheet_1');
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_1'],
      updateGroupKeys: null,
      trackAsUpdate: true
    }));
  });
});

// ═══ replaceManualRefillSheetBaselineInRangeAtomic_ACU ═══
describe('replaceManualRefillSheetBaselineInRangeAtomic_ACU', () => {
  const makeFullFrameMessage = (data: any, extraTagData: Record<string, any> = {}) => ({
    is_user: false,
    mes: 'AI full checkpoint',
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        independentData: {
          sheet_0: { name: '旧独立表0' },
          sheet_1: { name: '保留独立表1' },
        },
        modifiedKeys: ['sheet_0', 'sheet_1'],
        updateGroupKeys: ['sheet_0', 'sheet_1'],
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            reason: 'init',
            createdAt: 1,
            data,
          },
          logEntries: [],
        },
        ...extraTagData,
      },
    },
  });

  it('在单个 exclusive transaction 内清理目标表旧基底并写入 sheet_full checkpoint', async () => {
    const chat = [
      makeFullFrameMessage({
        sheet_0: { name: '旧表0', content: [['row_id', '值'], ['old', '旧']] },
        sheet_1: { name: '保留表1', content: [['row_id', '值'], ['keep', '保留']] },
      }),
      { is_user: true, mes: '用户消息' },
      {
        is_user: false,
        mes: 'AI incremental',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            independentData: {
              sheet_0: { name: '范围内旧表0' },
              sheet_1: { name: '范围内保留表1' },
            },
            modifiedKeys: ['sheet_0', 'sheet_1'],
            updateGroupKeys: ['sheet_0', 'sheet_1'],
            storageFrame: {
              version: 2,
              checkpoint: undefined,
              logEntries: [{
                seq: 1,
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: 'old', cells: ['old', '旧增量'] }],
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: ['sheet_0'],
                writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
              }],
              manualRefillProgress: {
                kind: 'manual_refill',
                status: 'in_progress',
                selectedSheetKeys: ['sheet_0', 'sheet_1'],
                completedSheetMessageIndexByKey: { sheet_0: 2, sheet_1: 2 },
              },
            },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockCollectScheduleSummaryFromFramesV2.mockReturnValue({ sheet_0: { lastFilledAiFloor: 0 } });

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0, 1, 2],
      targetSheetKeys: ['sheet_0'],
      baselineData: {
        sheet_0: { name: '新表0', content: [['row_id', '值'], ['new', '新']] },
      },
    });

    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, clearedCount: 2, checkpointCount: 1, targetMessageIndex: 0 }));
    expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'system_cleanup',
      reason: 'replaceManualRefillSheetBaselineInRange',
      maintenanceMode: 'exclusive',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
    }), expect.any(Function));
    const targetTag = chat[0].TavernDB_ACU_IsolatedData[''];
    expect(targetTag.storageFrame.checkpoint.kind).toBe('full');
    expect(targetTag.storageFrame.checkpoint.data.sheet_0).toBeUndefined();
    expect(targetTag.storageFrame.checkpoint.data.sheet_1.content[1][0]).toBe('keep');
    expect(targetTag.storageFrame.perSheetCheckpoints.sheet_0).toEqual(expect.objectContaining({
      kind: 'sheet_full',
      reason: 'manual',
      sheetKey: 'sheet_0',
      data: { name: '新表0', content: [['row_id', '值'], ['new', '新']] },
      scheduleSummary: { lastFilledAiFloor: 0 },
    }));
    const incrementalTag = chat[2].TavernDB_ACU_IsolatedData[''];
    expect(incrementalTag.independentData.sheet_0).toBeUndefined();
    expect(incrementalTag.independentData.sheet_1).toEqual({ name: '范围内保留表1' });
    // 目标表的唯一增量 entry 被裁剪后已无有效 payload，repository 契约要求删除空壳 entry。
    expect(incrementalTag.storageFrame.logEntries).toEqual([]);
    expect(incrementalTag.storageFrame.manualRefillProgress.selectedSheetKeys).toEqual(['sheet_1']);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('严格宿主保存失败时恢复目标范围内字段，避免内存半状态', async () => {
    const chat = [
      makeFullFrameMessage({
        sheet_0: { name: '旧表0', content: [['row_id'], ['old']] },
        sheet_1: { name: '保留表1', content: [['row_id'], ['keep']] },
      }),
      {
        is_user: false,
        mes: 'AI incremental',
        TavernDB_ACU_Identity: 'old_identity',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            independentData: { sheet_0: { name: '范围内旧表0' }, sheet_1: { name: '保留表1' } },
            modifiedKeys: ['sheet_0', 'sheet_1'],
            updateGroupKeys: ['sheet_0', 'sheet_1'],
            storageFrame: { version: 2, checkpoint: undefined, logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0' }], filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: ['sheet_0'], writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }] }] },
          },
        },
      },
    ];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('save failed'));

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0, 1],
      targetSheetKeys: ['sheet_0'],
      baselineData: { sheet_0: { name: '新表0', content: [['row_id'], ['new']] } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('save failed');
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('严格宿主保存失败时不删除外置向量索引文件', async () => {
    const manifest = { indexId: 'idx-save-failed', files: [{ path: 'vector-a.json', role: 'base_shard' }] };
    const chat = [
      makeFullFrameMessage({
        sheet_0: { name: '旧表0', content: [['row_id'], ['old']] },
        sheet_1: { name: '旧纪要表', content: [['row_id'], ['summary']] },
      }, {
        summaryVectorIndexManifest: manifest,
        summaryVectorIndexState: { manifest },
      }),
    ];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('save failed'));

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0],
      targetSheetKeys: ['sheet_1'],
      baselineData: { sheet_1: { name: '新纪要表', content: [['row_id'], ['new']] } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('save failed');
    expect(mockDeleteSummaryVectorIndexExternal).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

  it('严格宿主保存不可用时回滚聊天字段且不删除外置向量索引文件', async () => {
    const manifest = { indexId: 'idx-host-unavailable', files: [{ path: 'vector-host.json', role: 'base_shard' }] };
    const chat = [
      makeFullFrameMessage({
        sheet_0: { name: '旧表0', content: [['row_id'], ['old']] },
        sheet_1: { name: '旧纪要表', content: [['row_id'], ['summary']] },
      }, {
        summaryVectorIndexManifest: manifest,
        summaryVectorIndexState: { manifest },
      }),
    ];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('宿主 saveChat 不可用，无法提交破坏性聊天数据变更。'));

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0],
      targetSheetKeys: ['sheet_1'],
      baselineData: { sheet_1: { name: '新纪要表', content: [['row_id'], ['new']] } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('宿主 saveChat 不可用');
    expect(mockDeleteSummaryVectorIndexExternal).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

  it('替换目标 isolationKey 时不修改旁路 isolationKey 的 checkpoint、增量和向量 manifest', async () => {
    const otherManifest = { indexId: 'idx-other-isolation', files: [{ path: 'vector-other.json', role: 'base_shard' }] };
    const chat = [makeFullFrameMessage({
      sheet_0: { name: '旧表0', content: [['row_id'], ['old']] },
      sheet_1: { name: '保留表1', content: [['row_id'], ['keep']] },
    })];
    chat[0].TavernDB_ACU_IsolatedData.other = {
      _acu_storage_version: 2,
      independentData: { sheet_0: { name: '旁路表0' } },
      storageFrame: {
        version: 2,
        checkpoint: { kind: 'full', reason: 'init', createdAt: 9, data: { sheet_0: { name: '旁路 checkpoint' } } },
        perSheetCheckpoints: { sheet_0: { kind: 'sheet_full', sheetKey: 'sheet_0', data: { name: '旁路 shard' } } },
        logEntries: [{ seq: 2, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0' }] }],
      },
      summaryVectorIndexManifest: otherManifest,
      summaryVectorIndexState: { manifest: otherManifest },
    };
    const otherBefore = JSON.parse(JSON.stringify(chat[0].TavernDB_ACU_IsolatedData.other));
    mockGetChatArray.mockReturnValue(chat);

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0],
      targetSheetKeys: ['sheet_0'],
      baselineData: { sheet_0: { name: '新表0', content: [['row_id'], ['new']] } },
    });

    expect(result.success).toBe(true);
    expect(chat[0].TavernDB_ACU_IsolatedData.other).toEqual(otherBefore);
    expect(mockDeleteSummaryVectorIndexExternal).not.toHaveBeenCalledWith(otherManifest);
  });

  it('外置资源物理删除失败时仍返回成功并暴露清理告警', async () => {
    const manifest = { indexId: 'idx-cleanup-failed', files: [{ path: 'vector-b.json', role: 'base_shard' }] };
    const chat = [
      makeFullFrameMessage({
        sheet_0: { name: '旧表0', content: [['row_id'], ['old']] },
        sheet_1: { name: '旧纪要表', content: [['row_id'], ['summary']] },
      }, {
        summaryVectorIndexManifest: manifest,
        summaryVectorIndexState: { manifest },
      }),
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockDeleteSummaryVectorIndexExternal.mockRejectedValueOnce(new Error('external cleanup failed'));

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0],
      targetSheetKeys: ['sheet_1'],
      baselineData: { sheet_1: { name: '新纪要表', content: [['row_id'], ['new']] } },
    });

    expect(result.success).toBe(true);
    expect(result.cleanupWarnings).toEqual([expect.stringContaining('external cleanup failed')]);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockDeleteSummaryVectorIndexExternal).toHaveBeenCalledWith(manifest);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].summaryVectorIndexManifest).toBeUndefined();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].summaryVectorIndexState).toBeUndefined();
  });

  it('目标范围内找不到 full checkpoint 时返回错误且不保存', async () => {
    const chat = [
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: undefined, logEntries: [] } } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: undefined, logEntries: [] } } } },
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await replaceManualRefillSheetBaselineInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0, 1],
      targetSheetKeys: ['sheet_0'],
      baselineData: { sheet_0: { name: '新表0', content: [['row_id']] } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('找不到可承载单表 checkpoint 的整库 full checkpoint');
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
  });
});


describe('commitManualRefillSheetSnapshotInRangeAtomic_ACU', () => {
  const makeFrameMessage = (frame: any) => ({
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': { _acu_storage_version: 2, storageFrame: frame },
    },
  });

  it('在既有 full checkpoint 楼层写入完整快照，清理目标表旧数据并保留非目标表', async () => {
    const chat = [
      makeFrameMessage({
        version: 2,
        checkpoint: {
          kind: 'full',
          reason: 'compaction',
          createdAt: 20,
          data: {
            mate: { type: 'acu' },
            sheet_0: { name: '纪要表', content: [['row_id', '事件'], ['20', '旧事件']] },
            sheet_1: { name: '大纲表', content: [['row_id', '大纲'], ['20', '保留']] },
          },
        },
        logEntries: [],
      }),
      { is_user: true },
      makeFrameMessage({
        version: 2,
        logEntries: [{
          seq: 1,
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '30', cells: ['30', '旧增量'] }],
          filledSheetKeys: ['sheet_0'],
          changedSheetKeys: ['sheet_0'],
          groupKeys: [],
        }],
      }),
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0, 1, 2],
      targetSheetKeys: ['sheet_0'],
      snapshotData: {
        sheet_0: {
          name: '纪要表',
          content: [['row_id', '事件'], ['1', '重填事件'], ['30', '重填末层事件']],
        },
      },
    });

    expect(result).toEqual(expect.objectContaining({ success: true, targetMessageIndex: 0, checkpointCount: 1 }));
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0.content[1]).toEqual(['20', '旧事件']);
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_1.content[1]).toEqual(['20', '保留']);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations[0]).toEqual(expect.objectContaining({ sheetKey: 'sheet_0' }));
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_0).toEqual(expect.objectContaining({
      kind: 'sheet_full',
      timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 2, afterSeq: 1 },
      data: {
        name: '纪要表',
        content: [['row_id', '事件'], ['1', '重填事件'], ['30', '重填末层事件']],
      },
    }));
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
  });

  it('30层范围内将完整单表快照锚定到第20层既有 full checkpoint，而非末层', async () => {
    const chat = Array.from({ length: 30 }, () => ({ is_user: false } as any));
    chat[20] = makeFrameMessage({
      version: 2,
      checkpoint: {
        kind: 'full',
        reason: 'compaction',
        createdAt: 20,
        data: {
          mate: { type: 'acu' },
          sheet_0: { name: '纪要表', content: [['row_id', '事件'], ['20', '旧边界事件']] },
          sheet_1: { name: '大纲表', content: [['row_id', '大纲'], ['20', '保留']] },
        },
      },
      logEntries: [],
    });
    chat[29] = makeFrameMessage({
      version: 2,
      logEntries: [{
        seq: 1,
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '30', cells: ['30', '旧末层事件'] }],
        filledSheetKeys: ['sheet_0'],
        changedSheetKeys: ['sheet_0'],
        groupKeys: [],
      }],
    });
    const refilledSheet = {
      name: '纪要表',
      content: [
        ['row_id', '事件'],
        ...Array.from({ length: 30 }, (_, index) => [`${index + 1}`, `重填第${index + 1}层事件`]),
      ],
    };
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: Array.from({ length: 30 }, (_, index) => index),
      targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: refilledSheet },
    });

    expect(result).toEqual(expect.objectContaining({ success: true, targetMessageIndex: 20, checkpointCount: 1 }));
    expect(chat[29].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_0).toEqual(expect.objectContaining({
      kind: 'sheet_full',
      data: refilledSheet,
      scheduleSummary: { lastFilledAiFloor: 30 },
      timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 29, afterSeq: 1 },
    }));
    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints?.sheet_1).toBeUndefined();
    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_1.content[1]).toEqual(['20', '保留']);
    expect(chat[20].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.mate).toEqual({ type: 'acu' });

    const reloadedHistory = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: true,
      isolationKey: '',
      settings: mockSettings,
    });
    const untouchedSheetHistory = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_1',
      isSummaryTable: false,
      isolationKey: '',
      settings: mockSettings,
    });
    expect(reloadedHistory).toEqual(expect.objectContaining({ hasAnyData: true, hasTrackedUpdate: true, lastTrackedUpdateAiFloor: 30 }));
    expect(untouchedSheetHistory.hasTrackedUpdate).toBe(false);
  });

  it('显式 anchor 位于重填范围外时仍在唯一根 checkpoint 提交单表快照', async () => {
    const chat = [
      makeFrameMessage({
        version: 2,
        checkpoint: {
          kind: 'full', reason: 'manual', createdAt: 1,
          data: {
            mate: { type: 'acu' },
            sheet_0: { name: '目标表', content: [['row_id', '值']] },
            sheet_1: { name: '保留表', content: [['row_id', '值'], ['keep', '未选数据']] },
          },
        },
        logEntries: [],
      }),
      { is_user: true },
      makeFrameMessage({
        version: 2,
        logEntries: [{
          seq: 1,
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: 'old', cells: ['old', '旧数据'] }],
          filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
        }],
      }),
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '', targetMessageIndex: 0, targetMessageIndices: [2], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值'], ['new', '重填数据']] } },
    });

    expect(result).toEqual(expect.objectContaining({ success: true, targetMessageIndex: 0 }));
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_0.data.content[1]).toEqual(['new', '重填数据']);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_0.timeline).toEqual({ kind: 'sheet_rebase', activateAtMessageIndex: 2, afterSeq: 1 });
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_1.content[1]).toEqual(['keep', '未选数据']);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
  });

  it('全局无 full 时在最早 V2 frame 建模板临时根，并在末层写入 rebase 且保留 data_replace', async () => {
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '目标表', content: [['row_id', '值'], ['seed', '模板值']] },
      sheet_1: { name: '非目标表', content: [['row_id', '值'], ['keep', '模板保留']] },
    };
    const dataReplace = { kind: 'data_replace', data: {
      ...template,
      sheet_0: { name: '目标表', content: [['row_id', '值'], ['old', '旧值']] },
      sheet_1: { name: '非目标表', content: [['row_id', '值'], ['keep', '历史值']] },
    }, reason: 'system' };
    const chat = [
      makeFrameMessage({ version: 2, headRevision: 'root-revision', manualRefillProgress: { runId: 'old' }, logEntries: [{ seq: 1, operations: [dataReplace] }] }),
      { is_user: true },
      makeFrameMessage({ version: 2, logEntries: [{ seq: 3, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: 'old', cells: ['old', '被重填覆盖'] }] }] }),
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0, 2],
      targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值'], ['final', '最终值']] } },
      templateData: template,
    });

    expect(result).toEqual(expect.objectContaining({ success: true, targetMessageIndex: 0 }));
    const rootFrame = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(rootFrame).toEqual(expect.objectContaining({ headRevision: 'root-revision', manualRefillProgress: { runId: 'old' } }));
    expect(rootFrame.checkpoint).toEqual(expect.objectContaining({
      kind: 'full',
      data: template,
      fallbackProvenance: expect.objectContaining({ kind: 'manual_refill_template_root', isolationKey: '', targetSheetKeys: ['sheet_0'] }),
    }));
    expect(rootFrame.logEntries[0].operations[0]).toEqual(dataReplace);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_0).toEqual(expect.objectContaining({
      data: { name: '目标表', content: [['row_id', '值'], ['final', '最终值']] },
      timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 2, afterSeq: 3 },
    }));
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenCalledWith(expect.any(Array), '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
  });

  it('同一模板与最终快照重复提交时复用模板临时根和末端 rebase，不再次保存', async () => {
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '目标表', content: [['row_id', '值'], ['seed', '模板值']] },
    };
    const finalSheet = { name: '目标表', content: [['row_id', '值'], ['final', '最终值']] };
    const chat = [
      makeFrameMessage({ version: 2, logEntries: [] }),
      { is_user: true },
      makeFrameMessage({ version: 2, logEntries: [] }),
    ];
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { ...template, sheet_0: finalSheet },
    });
    const options = {
      isolationKey: '', targetMessageIndices: [0, 2], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: finalSheet }, templateData: template,
    };

    const first = await commitManualRefillSheetSnapshotInRangeAtomic_ACU(options);
    const rootAfterFirst = JSON.parse(JSON.stringify(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame));
    const finalAfterFirst = JSON.parse(JSON.stringify(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame));
    const second = await commitManualRefillSheetSnapshotInRangeAtomic_ACU(options);

    expect(first).toEqual(expect.objectContaining({ success: true, changed: true }));
    expect(second).toEqual(expect.objectContaining({ success: true, changed: false }));
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(rootAfterFirst);
    expect(chat[2].TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(finalAfterFirst);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenCalledTimes(1);
  });


  it('同一 isolationKey 存在多个 full checkpoint 时 fail closed 且不保存', async () => {
    const chat = [
      makeFrameMessage({
        version: 2,
        checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_0: { name: '目标表', content: [['row_id', '值']] } } },
        logEntries: [],
      }),
      makeFrameMessage({
        version: 2,
        checkpoint: { kind: 'full', createdAt: 2, reason: 'manual', data: { mate: { type: 'acu' }, sheet_0: { name: '目标表', content: [['row_id', '值'], ['old', '旧值']] } } },
        logEntries: [],
      }),
    ];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '', targetMessageIndices: [0, 1], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值'], ['final', '最终值']] } },
    });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('多个整库 full checkpoint') }));
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('候选真实 replay 不能建立 full 基底时不保存也不修改 live chat', async () => {
    const template = { mate: { type: 'acu' }, sheet_0: { name: '目标表', content: [['row_id', '值']] } };
    const chat = [makeFrameMessage({ version: 2, logEntries: [] })];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);
    mockLoadTableStateFromFramesV2Detailed.mockResolvedValueOnce(null);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '', targetMessageIndices: [0], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值'], ['final', '最终值']] } }, templateData: template,
    });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('未能建立持久化 full checkpoint') }));
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('显式 targetMessageIndex 不等于唯一 full 回放根时 fail closed', async () => {
    const chat = [
      makeFrameMessage({
        version: 2,
        checkpoint: {
          kind: 'full', reason: 'init', createdAt: 1,
          data: { mate: { type: 'acu' }, sheet_0: { name: '目标表', content: [['row_id', '值']] } },
        },
        logEntries: [],
      }),
      { is_user: false },
    ];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '', targetMessageIndex: 1, targetMessageIndices: [0, 1], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值'], ['final', '最终值']] } },
    });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('不等于唯一回放根') }));
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('全局无 full 且冻结模板缺少 mate 时不修改聊天也不保存', async () => {
    const chat = [makeFrameMessage({ version: 2, logEntries: [] })];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '', targetMessageIndices: [0], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值']] } },
      templateData: { sheet_0: { name: '目标表', content: [['row_id', '值']] } },
    });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('缺少有效 mate') }));
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });


  it('全局无 full 但冻结模板不完整时不修改聊天也不保存', async () => {
    const chat = [makeFrameMessage({ version: 2, logEntries: [] })];
    const before = JSON.parse(JSON.stringify(chat));
    mockGetChatArray.mockReturnValue(chat);

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '', targetMessageIndices: [0], targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '目标表', content: [['row_id', '值']] } },
      templateData: { mate: { type: 'acu' }, sheet_1: { name: '错表', content: [['row_id', '值']] } },
    });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('缺少目标表') }));
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('严格保存失败时还原本轮范围，避免留下清理后但未提交的快照状态', async () => {
    const chat = [
      makeFrameMessage({
        version: 2,
        checkpoint:{
          kind: 'full',
          reason: 'compaction',
          createdAt: 20,
          data: { sheet_0: { name: '纪要表', content: [['row_id'], ['20']] } },
        },
        logEntries: [],
      }),
      makeFrameMessage({
        version: 2,
        logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '30', cells: ['30'] }], filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] }],
      }),
    ];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('save failed'));

    const result = await commitManualRefillSheetSnapshotInRangeAtomic_ACU({
      isolationKey: '',
      targetMessageIndices: [0, 1],
      targetSheetKeys: ['sheet_0'],
      snapshotData: { sheet_0: { name: '纪要表', content: [['row_id'], ['1'], ['30']] } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('save failed');
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

});


describe('establishManualRefillTemplateRoot_ACU', () => {
  const makeEmptyFrameMessage = (mes: string): any => ({
    is_user: false,
    mes,
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        storageFrame: { version: 2, logEntries: [] },
      },
    },
  });
  const templateData = {
    mate: { type: 'acu' },
    sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] },
  };

  beforeEach(() => {
    mockSaveChatToHostStrict.mockResolvedValue(undefined);
  });

  it('清理后全局无 full checkpoint 时，在 earliestV2FrameIndex 建立模板临时根', async () => {
    const chat = [
      makeEmptyFrameMessage('AI楼层0'),
      makeEmptyFrameMessage('AI楼层1'),
    ];
    mockGetChatArray.mockReturnValue(chat);

    const result = await establishManualRefillTemplateRoot_ACU({
      isolationKey: '',
      targetSheetKeys: ['sheet_0'],
      targetMessageIndices: [0, 1],
      templateData,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.targetMessageIndex).toBe(0);
    const rootFrame = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(rootFrame.checkpoint.kind).toBe('full');
    expect(rootFrame.checkpoint.reason).toBe('manual');
    expect(rootFrame.checkpoint.fallbackProvenance.kind).toBe('manual_refill_template_root');
    expect(rootFrame.checkpoint.fallbackProvenance.rangeStartMessageIndex).toBe(0);
    expect(rootFrame.checkpoint.fallbackProvenance.rangeEndMessageIndex).toBe(1);
    expect(rootFrame.checkpoint.fallbackProvenance.targetSheetKeys).toEqual(['sheet_0']);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    // 落点：earliestV2FrameIndex（与末尾 commit 同口径）
    expect(chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
  });

  it('清理后仍有 full checkpoint 时 no-op（部分选表/范围未覆盖场景）', async () => {
    const chat = [
      {
        is_user: false,
        mes: 'AI楼层0',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'manual',
                data: { sheet_1: { name: '保留表', content: [['row_id'], ['keep']] } },
              },
              logEntries: [],
            },
          },
        },
      },
      makeEmptyFrameMessage('AI楼层1'),
    ];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));

    const result = await establishManualRefillTemplateRoot_ACU({
      isolationKey: '',
      targetSheetKeys: ['sheet_0'],
      targetMessageIndices: [0, 1],
      templateData,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(false);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(chat).toEqual(before);
  });

  it('模板缺少目标表时失败且不写聊天', async () => {
    const chat = [makeEmptyFrameMessage('AI楼层0')];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));

    const result = await establishManualRefillTemplateRoot_ACU({
      isolationKey: '',
      targetSheetKeys: ['sheet_missing'],
      targetMessageIndices: [0],
      templateData,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('缺少目标表');
    expect(chat).toEqual(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('严格保存失败时原位恢复聊天内存状态', async () => {
    const chat = [makeEmptyFrameMessage('AI楼层0')];
    mockGetChatArray.mockReturnValue(chat);
    const before = JSON.parse(JSON.stringify(chat));
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('save failed'));

    const result = await establishManualRefillTemplateRoot_ACU({
      isolationKey: '',
      targetSheetKeys: ['sheet_0'],
      targetMessageIndices: [0],
      templateData,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('save failed');
    expect(JSON.parse(JSON.stringify(chat))).toEqual(before);
  });

  it('runId 与末尾 commit 同公式：isolationKey+范围+模板指纹', async () => {
    const chat = [
      makeEmptyFrameMessage('AI楼层0'),
      makeEmptyFrameMessage('AI楼层1'),
      makeEmptyFrameMessage('AI楼层2'),
      makeEmptyFrameMessage('AI楼层3'),
      makeEmptyFrameMessage('AI楼层4'),
    ];
    mockGetChatArray.mockReturnValue(chat);

    await establishManualRefillTemplateRoot_ACU({
      isolationKey: 'tag-1',
      targetSheetKeys: ['sheet_0'],
      targetMessageIndices: [0, 2, 4],
      templateData,
    });

    const fallbackRunId = chat[0].TavernDB_ACU_IsolatedData['tag-1'].storageFrame.checkpoint.fallbackProvenance.runId;
    const expectedRunId = `manual-refill:tag-1:0,2,4:${getTableDataFingerprint_ACU(templateData)}`;
    expect(fallbackRunId).toBe(expectedRunId);
  });
});
