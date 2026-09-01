import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  settings: { dataIsolationEnabled: false, dataIsolationCode: '' },
  collectSummary: vi.fn(() => ({ sheet_a: { lastFilledAiFloor: 7, lastChangedAiFloor: 6 } })),
  loadReplayState: vi.fn(),
  loadReplayDetailed: vi.fn(),
  scopeContainer: null as any,
  guideContainer: null as any,
  setGuide: vi.fn(() => true),
  runTransaction: vi.fn(),
  runCommit: vi.fn(),
  chatIdentity: 'chat-a',
  templateObj: null as any,
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/repositories/chat-message-data-repo')>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => {
    // 对齐真实实现 parseIsolatedDataField 的 string/object 双形态语义：
    // IsolatedData 为 JSON string 时先解析；object 时 JSON round-trip 深拷贝。
    const raw = message?.TavernDB_ACU_IsolatedData;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    return JSON.parse(JSON.stringify(raw || {}));
  }),
  writeMessageIdentity_ACU: vi.fn((message: any, isolationConfig: any) => {
    if (isolationConfig.enabled) {
      message.TavernDB_ACU_Identity = isolationConfig.code;
    } else {
      delete message.TavernDB_ACU_Identity;
    }
  }),
}));
vi.mock('../../../src/shared/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/shared/utils')>()),
  logDebug_ACU: vi.fn(),
  logWarn_ACU: mocks.logWarn_ACU,
  logError_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => text ? 'mock-ddl-digest' : ''),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  settings_ACU: mocks.settings,
}));
vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  hasV2TableHistoryEvidence_ACU: vi.fn((tagData: any) => {
    if (!tagData || typeof tagData !== 'object' || Array.isArray(tagData)) return false;
    if (tagData._acu_storage_version === 2) return true;
    const frame = tagData.storageFrame;
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return false;
    return frame.version === 2
      || frame.checkpoint !== undefined
      || frame.perSheetCheckpoints !== undefined
      || (Array.isArray(frame.logEntries) && frame.logEntries.length > 0)
      || frame.manualRefillProgress !== undefined
      || (frame.headRevision !== undefined && frame.headRevision !== null && (typeof frame.headRevision !== 'string' || frame.headRevision.length > 0));
  }),
  isV2TagData_ACU: vi.fn((tagData: any) => tagData?.storageFrame?.version === 2 && Array.isArray(tagData.storageFrame.logEntries)),
  isLegacyV1TagData_ACU: vi.fn((tagData: any) => {
    if (!tagData || typeof tagData !== 'object' || Array.isArray(tagData)) return false;
    if (tagData?.storageFrame?.version === 2 && Array.isArray(tagData.storageFrame.logEntries)) return false;
    return Object.keys(tagData.independentData || {}).some(key => key.startsWith('sheet_'))
      || Object.keys(tagData.incrementalData || {}).some(key => key.startsWith('sheet_'))
      || (tagData._acu_storage_version === 1
        && ('independentData' in tagData || 'incrementalData' in tagData));
  }),
  hasLegacyTopLevelTableData_ACU: vi.fn((message: any) => {
    if (!message || typeof message !== 'object') return false;
    return ['TavernDB_ACU_IndependentData', 'TavernDB_ACU_Data', 'TavernDB_ACU_SummaryData']
      .some(field => Object.keys(message[field] || {}).some(key => key.startsWith('sheet_')))
      || ['TavernDB_ACU_ModifiedKeys', 'TavernDB_ACU_UpdateGroupKeys']
        .some(field => Array.isArray(message[field]) && message[field].some((key: unknown) => typeof key === 'string' && key.startsWith('sheet_')));
  }),
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/service/table/storage-frame-v2-replay')>()),
  collectScheduleSummaryFromFramesV2_ACU: mocks.collectSummary,
  loadTableStateFromFramesV2_ACU: mocks.loadReplayState,
  loadTableStateFromFramesV2Detailed_ACU: mocks.loadReplayDetailed,
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentity),
  peekChatScopedConfigContainer_ACU: vi.fn(() => mocks.scopeContainer),
  peekChatSheetGuideContainer_ACU: vi.fn(() => mocks.guideContainer),
  setChatScopedConfigContainer_ACU: vi.fn((_chat: any[], value: any) => { mocks.scopeContainer = value; }),
  setChatSheetGuideContainer_ACU: vi.fn((_chat: any[], value: any) => { mocks.guideContainer = value; }),
}));
vi.mock('../../../src/service/template/chat-scope', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/service/template/chat-scope')>()),
  normalizeGuideData_ACU: vi.fn((data: any) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const normalized: Record<string, any> = { mate: data.mate && typeof data.mate === 'object' ? data.mate : { type: 'chatSheets', version: 1 } };
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('sheet_') || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const sheet = value as Record<string, any>;
      normalized[key] = {
        ...sheet,
        content: [Array.isArray(sheet.content?.[0]) ? sheet.content[0] : [null]],
      };
    }
    return normalized;
  }),
  setChatSheetGuideDataForIsolationKey_ACU: mocks.setGuide,
  getCurrentChatTemplateScopeState_ACU: vi.fn(() => (mocks.templateObj ? { templateObj: mocks.templateObj } : null)),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => (mocks.templateObj ? { templateObj: mocks.templateObj } : null)),
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mocks.runTransaction,
}));

import {
  commitCurrentFloorTemplateChanges_ACU,
  commitCurrentFloorTemplateScopeOnly_ACU,
  frameHasSuffixReplayArtifact_ACU,
  persistNullRowCleanupShards_ACU,
  persistTableMutationLogBatchV2_ACU,
  persistTableSheetCheckpointV2_ACU,
} from '../../../src/service/table/storage-frame-v2-persist';
import { buildSheetSchemaMigrationOperation_ACU, buildSheetSchemaMigrationOperationV2_ACU } from '../../../src/service/table/table-schema-migration';

const sheetA = { uid: 'a', name: 'A', sourceData: {}, content: [['row_id', 'value'], ['1', 'new']], updateConfig: {}, exportConfig: {}, orderNo: 1 } as any;
const sheetB = { uid: 'b', name: 'B', sourceData: {}, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 2 } as any;

function makeEntry(overrides: Record<string, any> = {}): any {
  return {
    seq: 1, entryId: 'entry-1', createdAt: 10, source: 'manual_fill', targetMessageIndex: 0, aiFloor: 1,
    filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [], ...overrides,
  };
}

function seedFrame(frameOverrides: Record<string, any> = {}): any {
  const frame = {
    version: 2,
    checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
    headRevision: '3:existing',
    manualRefillProgress: { kind: 'manual_refill', status: 'in_progress', selectedSheetKeys: ['sheet_b'] },
    logEntries: [makeEntry({ operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_b', sheet: sheetB, reason: 'system' }] })],
    perSheetCheckpoints: { sheet_b: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_b', data: sheetB } },
    ...frameOverrides,
  };
  const message = { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame } } };
  mocks.chat.splice(0, mocks.chat.length, message);
  const replayData = frame.checkpoint?.data ?? null;
  mocks.loadReplayState.mockResolvedValue(replayData);
  mocks.loadReplayDetailed.mockImplementation(async (...args: any[]) => {
    const data = await mocks.loadReplayState(...args);
    return data ? { baseKind: 'full_checkpoint', data } : null;
  });
  return message;
}

function makeTransaction(baseRevision: string | null = 'runtime-v1:test'): any {
  return {
    baseRevision,
    writeSet: [{ kind: 'sheet', sheetKey: 'sheet_a' }],
    assertFresh: vi.fn(),
    runCommit: vi.fn(async (task: () => any) => task()),
  };
}


describe('manualRefillProgress V2 validation', () => {
  it('接受无 version 的旧版手动重填进度', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    seedFrame({ manualRefillProgress: undefined });
    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { sheet_a: sheetA, sheet_b: sheetB } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }],
      manualRefillProgress: {
        kind: 'manual_refill', status: 'in_progress', selectedSheetKeys: ['sheet_a'], contextMessageIndices: [0],
        originalStartMessageIndex: 0, targetMessageIndex: 0, batchSize: 1, completedUntilMessageIndex: 0, updatedAt: 1,
      },
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });
    expect(result.saved).toBe(true);
  });

  it('仅更新新版手动追平进度时不追加 mutation entry 或创建 checkpoint', async () => {
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame();
    const frameBefore = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData[''].storageFrame));

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: frameBefore.checkpoint.data,
      filledSheetKeys: [],
      candidateChangedSheetKeys: [],
      operations: [],
      manualRefillProgress: {
        kind: 'manual_refill', version: 2, status: 'complete',
        selectedSheetKeys: ['sheet_a'], contextMessageIndices: [0],
        originalStartMessageIndex: 0, targetMessageIndex: 0, batchSize: 1,
        completedUntilMessageIndex: 0, completedSheetMessageIndexByKey: { sheet_a: 0 },
        runId: 'catch-up-run', mode: 'catch_up', targetAiFloor: 1,
        planSignature: 'plan-signature', waveIndex: 0, bucketIndex: 0,
        totalWaves: 1, totalBuckets: 1, updatedAt: 2,
      },
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    const frameAfter = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(result.saved).toBe(true);
    expect(frameAfter.manualRefillProgress).toEqual(expect.objectContaining({
      version: 2,
      status: 'complete',
      runId: 'catch-up-run',
      completedSheetMessageIndexByKey: { sheet_a: 0 },
    }));
    expect(frameAfter.logEntries).toEqual(frameBefore.logEntries);
    expect(frameAfter.checkpoint).toEqual(frameBefore.checkpoint);
    expect(frameAfter.headRevision).toBe(frameBefore.headRevision);
    expect(mocks.saveChat).toHaveBeenCalledTimes(1);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('无 full checkpoint 时拒绝 progress-only，且不创建无根 V2 frame 或触发保存', async () => {
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame({ checkpoint: undefined, logEntries: [], headRevision: null });
    const beforeIsolatedData = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData));

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA } as any,
      filledSheetKeys: [],
      candidateChangedSheetKeys: [],
      operations: [],
      manualRefillProgress: {
        kind: 'manual_refill', version: 2, status: 'stopped',
        selectedSheetKeys: ['sheet_a'], contextMessageIndices: [0],
        originalStartMessageIndex: 0, targetMessageIndex: 0, batchSize: 1,
        completedUntilMessageIndex: 0, completedSheetMessageIndexByKey: {},
        runId: 'catch-up-no-checkpoint', mode: 'catch_up', targetAiFloor: 1,
        planSignature: 'plan-signature', waveIndex: 0, bucketIndex: 0,
        totalWaves: 1, totalBuckets: 1, lastError: 'stopped', updatedAt: 2,
      },
      strictSave: true,
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result).toEqual({
      saved: false,
      error: 'V2 manualRefillProgress-only write requires an existing full checkpoint anchor.',
    });
    expect(message.TavernDB_ACU_IsolatedData).toEqual(beforeIsolatedData);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('拒绝写入位于最新 full checkpoint 之前的填表 artifact，且不产生副作用', async () => {
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const earlierMessage = { is_user: false, TavernDB_ACU_IsolatedData: {} as Record<string, any> };
    const checkpointMessage = seedFrame({ logEntries: [], manualRefillProgress: undefined });
    mocks.chat.splice(0, mocks.chat.length, earlierMessage, checkpointMessage);
    const beforeEarlierMessage = JSON.parse(JSON.stringify(earlierMessage));

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }] as any,
      manualRefillProgress: {
        kind: 'manual_refill', version: 2, status: 'committed',
        selectedSheetKeys: ['sheet_a'], contextMessageIndices: [0],
        originalStartMessageIndex: 0, targetMessageIndex: 0, batchSize: 1,
        completedUntilMessageIndex: 0, completedSheetMessageIndexByKey: { sheet_a: 0 },
        runId: 'checkpoint-after-target', mode: 'catch_up', targetAiFloor: 1,
        planSignature: 'plan-signature', waveIndex: 0, bucketIndex: 0,
        totalWaves: 1, totalBuckets: 1, updatedAt: 2,
      },
      strictSave: true,
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result).toEqual({
      saved: false,
      error: 'V2 write target precedes the latest full checkpoint and would never replay: targetMessageIndex=0, latestFullCheckpointIndex=1.',
    });
    expect(earlierMessage).toEqual(beforeEarlierMessage);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('progress-only 严格保存失败时恢复 frame metadata、headRevision 与 identity', async () => {
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockReset().mockRejectedValueOnce(new Error('strict save failed'));
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame();
    message.TavernDB_ACU_Identity = 'original-identity';
    const beforeIsolatedData = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData));

    await expect(persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: beforeIsolatedData[''].storageFrame.checkpoint.data,
      filledSheetKeys: [],
      candidateChangedSheetKeys: [],
      operations: [],
      manualRefillProgress: {
        kind: 'manual_refill', version: 2, status: 'failed',
        selectedSheetKeys: ['sheet_a'], contextMessageIndices: [0],
        originalStartMessageIndex: 0, targetMessageIndex: 0, batchSize: 1,
        completedUntilMessageIndex: 0, completedSheetMessageIndexByKey: {},
        runId: 'catch-up-save-failed', mode: 'catch_up', targetAiFloor: 1,
        planSignature: 'plan-signature', waveIndex: 0, bucketIndex: 0,
        totalWaves: 1, totalBuckets: 1, lastError: 'primary failure', updatedAt: 2,
      },
      strictSave: true,
      transactionContext: makeTransaction(), assumeCommitLock: true,
    })).rejects.toThrow('strict save failed');

    expect(message.TavernDB_ACU_IsolatedData).toEqual(beforeIsolatedData);
    expect(message.TavernDB_ACU_Identity).toBe('original-identity');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });
});

describe('persistTableMutationLogV2_ACU incremental replacement', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.loadReplayState.mockReset();
    mocks.loadReplayDetailed.mockReset();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
  });

  function makeReplacementOptions(targetMessageIndex: number) {
    return {
      targetMessageIndex,
      source: 'manual_fill' as const,
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sheet_replace' as const, sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' as const }],
      replaceExistingIncremental: { targetMessageIndices: [0, 1], targetSheetKeys: ['sheet_a'] },
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    };
  }

  it('拒绝包含空 row_id 的普通 full snapshot，且不修改聊天或保存', async () => {
    const message = seedFrame();
    message.TavernDB_ACU_Identity = 'identity-before-rejection';
    const isolatedDataBefore = message.TavernDB_ACU_IsolatedData;
    const messageBefore = JSON.parse(JSON.stringify(message));
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: {
        mate: { type: 'acu' },
        sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'new'], [' ', 'must-not-drop']] },
        sheet_b: sheetB,
      } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toEqual({ saved: false, error: expect.stringContaining('空 row_id') });
    expect(message).toEqual(messageBefore);
    expect(message.TavernDB_ACU_IsolatedData).toBe(isolatedDataBefore);
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('拒绝重复的非空 row_id，且不仲裁身份或修改聊天状态', async () => {
    const message = seedFrame();
    message.TavernDB_ACU_Identity = 'identity-before-rejection';
    const isolatedDataBefore = message.TavernDB_ACU_IsolatedData;
    const messageBefore = JSON.parse(JSON.stringify(message));
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: {
        mate: { type: 'acu' },
        sheet_a: { ...sheetA, content: [['row_id', 'value'], ['stable-id', 'first'], [' stable-id ', 'second']] },
        sheet_b: sheetB,
      } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toEqual({ saved: false, error: expect.stringContaining('duplicate_row_id') });
    expect(message).toEqual(messageBefore);
    expect(message.TavernDB_ACU_IsolatedData).toBe(isolatedDataBefore);
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'row_upsert 身份不一致', operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['2', 'new'] }] },
    { label: 'row_upsert 行宽不匹配', operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1'] }] },
  ])('通用 persist 原样保存已生成的 $label operation，且不做 replay applicability 预检', async ({ operations }) => {
    const message = seedFrame({ logEntries: [] });
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any,
      filledSheetKeys: [],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: operations as any,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result.saved).toBe(true);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations).toEqual(operations);
    // 阶段 F：单目标 persist 内部两次同 boundary replay 会透传去重 evidence，
    // 故只断言 boundary 与只读语义，不锁定完整选项对象。
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', expect.objectContaining({ maxMessageIndex: 0, updateRuntimeState: false }));
    // 去重通道保护：两次同 boundary replay 必须收到同一个 evidence 对象引用。
    // mock 不会写回 evidence，因此引用共享是「第二次能复用第一次结果」的唯一可验证信号；
    // 若哪次重构把它拆成两个独立对象，去重会静默退回两次冷回放而测试仍全绿。
    const evidenceArgs = mocks.loadReplayDetailed.mock.calls
      .map((call: any[]) => call[2]?.replayEvidence)
      .filter((value: unknown) => Boolean(value));
    expect(evidenceArgs.length).toBeGreaterThanOrEqual(2);
    for (const passed of evidenceArgs) {
      expect(passed).toBe(evidenceArgs[0]);
    }
    expect(mocks.saveChat).toHaveBeenCalledOnce();
  });

  it('已有 checkpoint 的单表增量只复制相关 afterData，不遍历未写入表', async () => {
    const message = seedFrame({ logEntries: [] });
    const untouchedToJson = vi.fn(() => {
      throw new Error('未写入表不应被增量持久化复制');
    });
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: {
        mate: { type: 'acu' },
        sheet_a: sheetA,
        sheet_b: { ...sheetB, toJSON: untouchedToJson },
      } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'updated'] }] as any,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result.saved).toBe(true);
    expect(untouchedToJson).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations).toEqual([
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'updated'] },
    ]);
  });

  it('operation 可应用但结果与 afterData 分叉时仍保存（不再做 afterData 相等性阻断）', async () => {
    const message = seedFrame({ logEntries: [] });
    const afterData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any;
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB });
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData,
      filledSheetKeys: [],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '回放后的名称' } }] as any,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result.saved).toBe(true);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(mocks.saveChat).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: 'sql_batch',
      operation: { kind: 'sql_batch', statements: ["UPDATE inventory SET value = ? WHERE row_id = ?"], params: [['sql-updated', 1]] },
    },
    {
      label: 'sql_sheet_batch',
      operation: {
        kind: 'sql_sheet_batch', sheetKey: 'sheet_a',
        statements: ['UPDATE inventory SET value = ? WHERE row_id = ?'],
        params: [['sql-updated', 1]],
        tableName: 'inventory', reason: 'manual_crud',
      },
    },
  ])('通用 persist 原样持久化 $label，不判断 replay applicability', async ({ operation }) => {
    const sqlBaseSheet = {
      ...sheetA,
      uid: 'inventory',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT);' },
    };
    const message = seedFrame({
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sqlBaseSheet, sheet_b: sheetB },
      },
      logEntries: [],
    });
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: { ...sqlBaseSheet, content: [['row_id', 'value'], ['1', 'sql-updated']] },
      sheet_b: sheetB,
    } as any;
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [operation] as any,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result.saved).toBe(true);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', expect.objectContaining({
      maxMessageIndex: 0,
      updateRuntimeState: false,
    }));
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations).toEqual([operation]);
    expect(mocks.saveChat).toHaveBeenCalledOnce();
  });

  it('provisional Sheet 补锚在同一严格提交中先收敛为根帧 per-sheet 锚点、保留 backup，再追加当前 SQL 写入', async () => {
    const message = seedFrame({ logEntries: [] });
    const preWriteData = {
      mate: { type: 'acu' },
      sheet_a: {
        ...sheetA,
        uid: 'inventory',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', '收敛前值']],
      },
      sheet_b: sheetB,
    } as any;
    // 模板必须是可解析的 header-only 快照，指纹与 repair 记录一致，收敛才能通过。
    mocks.templateObj = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, uid: 'inventory', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT);' }, content: [['row_id', 'value']] },
    } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    const provisionalRepair = {
      kind: 'temporary_sheet_anchor' as const,
      severity: 'provisional' as const,
      sheetKey: 'sheet_a', messageIndex: 0, seq: 1, operationIndex: 0,
      templateFingerprint: fingerprint, reason: 'missing_at_operation' as const,
    };
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true, compatibilityRepairs: [provisionalRepair] })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: preWriteData });
    const beforeFrame = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData[''].storageFrame));
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const operation = {
      kind: 'sql_sheet_batch', sheetKey: 'sheet_a', tableName: 'inventory', reason: 'manual_crud',
      statements: ['UPDATE inventory SET value = ? WHERE row_id = ?'], params: [['本次写入', 1]],
    } as any;

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: {
        ...preWriteData,
        sheet_a: { ...preWriteData.sheet_a, content: [['row_id', 'value'], ['1', '本次写入']] },
      },
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [operation],
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(result.saved).toBe(true);
    // 收敛不再写第二个 full：目标帧 checkpoint 保持既有 init full 不变。
    expect(frame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    expect(frame.checkpoint.data).toEqual(beforeFrame.checkpoint.data);
    // 锚点落在根帧（此处目标即根帧）的 perSheetCheckpoints，为 sheet_full 而非 full。
    expect(frame.perSheetCheckpoints?.sheet_a).toMatchObject({ kind: 'sheet_full', reason: 'integrity_repair', sheetKey: 'sheet_a' });
    // 全局仍只有 1 个 full checkpoint。
    const { collectV2FullCheckpointIndices_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
    expect(message.TavernDB_ACU_IsolatedData[''].recoveryBackup).toEqual(expect.objectContaining({
      recoveryKind: 'temporary_sheet_anchor_convergence',
      sourceMessageIndex: 0,
      storageFrame: beforeFrame,
    }));
    expect(frame.logEntries).toHaveLength(1);
    expect(frame.logEntries[0].operations).toEqual([operation]);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });


  it('provisional 收敛候选未达到严格回放时取消本次写入且不修改原 frame', async () => {
    const message = seedFrame({ logEntries: [] });
    const beforeIsolatedData = message.TavernDB_ACU_IsolatedData;
    const preWriteData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any;
    // 收敛必须能解析模板锚点，候选验证才会走到 suffix 拦截。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    const provisionalRepair = {
      kind: 'temporary_sheet_anchor' as const,
      severity: 'provisional' as const,
      sheetKey: 'sheet_a', messageIndex: 0, seq: 1, operationIndex: 0,
      templateFingerprint: fingerprint, reason: 'missing_at_operation' as const,
    };
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true, compatibilityRepairs: [provisionalRepair] })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true, compatibilityRepairs: [provisionalRepair] });
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: preWriteData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{
        kind: 'sql_sheet_batch', sheetKey: 'sheet_a', tableName: 'inventory', reason: 'manual_crud',
        statements: ['UPDATE inventory SET value = ? WHERE row_id = ?'], params: [['不会保存', 1]],
      }] as any,
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result).toEqual({ saved: false, error: expect.stringContaining('convergence_candidate_boundary_requires_repair') });
    expect(message.TavernDB_ACU_IsolatedData).toBe(beforeIsolatedData);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('既有 full 在第 0 层、convergence 目标在第 5 层时，锚点落在第 0 层根帧且全局仍单 full', async () => {
    const root = seedFrame({ logEntries: [] });
    const target = { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, headRevision: null, logEntries: [] } } } };
    mocks.chat.splice(0, mocks.chat.length, root, { is_user: false }, { is_user: false }, { is_user: false }, { is_user: false }, target);
    const preWriteData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any;
    // 收敛需要可解析的模板锚点；指纹与 repair 一致。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    const provisionalRepair = {
      kind: 'temporary_sheet_anchor' as const, severity: 'provisional' as const,
      sheetKey: 'sheet_a', messageIndex: 0, seq: 1, operationIndex: 0,
      templateFingerprint: fingerprint, reason: 'missing_at_operation' as const,
    };
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true, compatibilityRepairs: [provisionalRepair] })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: preWriteData });
    const beforeRootFrame = JSON.parse(JSON.stringify(root.TavernDB_ACU_IsolatedData[''].storageFrame));
 const beforeTargetFrame = JSON.parse(JSON.stringify(target.TavernDB_ACU_IsolatedData[''].storageFrame));
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 5,
      source: 'manual_fill',
      afterData: { ...preWriteData, sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '本次写入']] } },
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_a', tableName: 'inventory', reason: 'manual_crud', statements: ['UPDATE inventory SET value = ? WHERE row_id = ?'], params: [['本次写入', 1]] }],
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result.saved, JSON.stringify(result)).toBe(true);
    // 锚点落在第 0 层根帧，产物为 sheet_full 而非 full。
    const rootFrame = root.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(rootFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    expect(rootFrame.perSheetCheckpoints?.sheet_a).toMatchObject({ kind: 'sheet_full', reason: 'integrity_repair', sheetKey: 'sheet_a' });
    // 目标帧 checkpoint 不被改写，只保留 recoveryBackup证据。
    const targetFrame = target.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(targetFrame.checkpoint).toBeUndefined();
    expect(targetFrame.logEntries).toHaveLength(1);
    expect(target.TavernDB_ACU_IsolatedData[''].recoveryBackup).toEqual(expect.objectContaining({
      recoveryKind: 'temporary_sheet_anchor_convergence', sourceMessageIndex: 5, storageFrame: beforeTargetFrame,
    }));
    // 全局仍只有 1 个 full checkpoint（第 0 层）。
    const { collectV2FullCheckpointIndices_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
    // 根帧与目标帧同一次 strict save 原子落盘。
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(rootFrame.perSheetCheckpoints?.sheet_a.data.content[0]).toEqual(['row_id', 'value']);
    // 根帧原有 sheet_b per-sheet checkpoint 保留，sheet_a 锚点为新增。
    expect(rootFrame.perSheetCheckpoints?.sheet_b).toEqual(beforeRootFrame.perSheetCheckpoints?.sheet_b);
  });


  it('收敛模板指纹不一致时拒绝写入，零落盘且消息字段还原', async () => {
    const message = seedFrame({ logEntries: [] });
    const beforeIsolatedData = message.TavernDB_ACU_IsolatedData;
    const preWriteData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any;
    // 模板存在但指纹与 repair 记录不一致：模拟模板在补锚后被修改。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    const provisionalRepair = {
      kind: 'temporary_sheet_anchor' as const, severity: 'provisional' as const,
      sheetKey: 'sheet_a', messageIndex: 0, seq: 1, operationIndex: 0,
      templateFingerprint: 'stale-fingerprint-from-replay', reason: 'missing_at_operation' as const,
    };
    expect(fingerprint).not.toBe(provisionalRepair.templateFingerprint);
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true, compatibilityRepairs: [provisionalRepair] });
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { ...preWriteData, sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '不会保存']] } },
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_a', tableName: 'inventory', reason: 'manual_crud', statements: ['UPDATE inventory SET value = ? WHERE row_id = ?'], params: [['不会保存', 1]] }],
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result).toEqual({ saved: false, error: expect.stringContaining('模板指纹不一致') });
    expect(message.TavernDB_ACU_IsolatedData).toBe(beforeIsolatedData);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });


  it('跨 replacement 范围裁剪旧 bucket 增量、追加新 entry，并只严格保存一次', async () => {
    const first = seedFrame({
      headRevision: '1:first-old',
      logEntries: [makeEntry({ seq: 1, commitRevision: '1:first-old', filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: ['sheet_a'], operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: { ...sheetA, name: '旧 A' }, reason: 'system' }] })],
    });
    const second = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            headRevision: '2:target-old',
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [makeEntry({ seq: 2, entryId: 'target-old', commitRevision: '2:target-old', filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: ['sheet_a'], operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: { ...sheetA, name: '旧目标 A' }, reason: 'system' }] })],
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, first, second);
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    const result = await persistTableMutationLogV2_ACU(makeReplacementOptions(1));

    expect(result.saved).toBe(true);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.saveChat).not.toHaveBeenCalled();
    const firstFrame = first.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(firstFrame.logEntries).toEqual([]);
    expect(firstFrame.headRevision).toBeNull();
    const secondFrame = second.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(secondFrame.logEntries).toHaveLength(1);
    expect(secondFrame.logEntries[0]).toMatchObject({
      seq: 1,
      parentRevision: null,
      filledSheetKeys: ['sheet_a'],
      operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }],
    });
    expect(secondFrame.headRevision).toBe(secondFrame.logEntries[0].commitRevision);
  });

  it('replacement 的严格保存失败时恢复所有目标消息的内存状态', async () => {
    const first = seedFrame({
      headRevision: '1:first-old',
      logEntries: [makeEntry({ seq: 1, commitRevision: '1:first-old', filledSheetKeys: ['sheet_a'], operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }] })],
    });
    const second = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            headRevision: '2:target-old',
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [makeEntry({ seq: 2, entryId: 'target-old', commitRevision: '2:target-old', filledSheetKeys: ['sheet_a'], operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA, reason: 'system' }] })],
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, first, second);
    const firstBefore = first.TavernDB_ACU_IsolatedData;
    const secondBefore = second.TavernDB_ACU_IsolatedData;
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');

    await expect(persistTableMutationLogV2_ACU(makeReplacementOptions(1))).rejects.toThrow('host save failed');

    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(first.TavernDB_ACU_IsolatedData).toBe(firstBefore);
    expect(second.TavernDB_ACU_IsolatedData).toBe(secondBefore);
  });
});


describe('persistTableSheetCheckpointV2_ACU', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.collectSummary.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.scopeContainer = { version: 1, template: { '': { old: true } } };
    mocks.guideContainer = { version: 1, tags: { '': { data: { sheet_old: {} } } } };
    mocks.setGuide.mockReset().mockImplementation(() => true);
    mocks.runTransaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      baseRevision: 'runtime-v1:test',
      assertFresh: vi.fn(),
      runCommit: async (commitTask: () => any) => commitTask(),
    }));
  });

  it('拒绝包含空 row_id 的普通 sheet checkpoint，且不修改聊天或保存', async () => {
    const message = seedFrame();
    message.TavernDB_ACU_Identity = 'identity-before-rejection';
    const isolatedDataBefore = message.TavernDB_ACU_IsolatedData;
    const messageBefore = JSON.parse(JSON.stringify(message));

    const result = await persistTableSheetCheckpointV2_ACU({
      targetMessageIndex: 0,
      sheetKey: 'sheet_a',
      sheetData: { ...sheetA, content: [['row_id', 'value'], ['', 'must-not-drop']] },
      reason: 'manual',
      transactionContext: makeTransaction(),
    });

    expect(result).toEqual({ saved: false, error: expect.stringContaining('空 row_id') });
    expect(message).toEqual(messageBefore);
    expect(message.TavernDB_ACU_IsolatedData).toBe(isolatedDataBefore);
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });


  it('写入目标 shard 且保持根 checkpoint、revision、日志、进度和其他 shard 不变', async () => {
    const message = seedFrame();
    const beforeFrame = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData[''].storageFrame));
    const transaction = makeTransaction();
    const event = { filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: ['sheet_a'] };

    const result = await persistTableSheetCheckpointV2_ACU({
      targetMessageIndex: 0, sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', createdAt: 20,
      event, baseRevision: 'base-20', transactionContext: transaction,
    });

    expect(result.saved).toBe(true);
    expect(transaction.runCommit).toHaveBeenCalledWith(expect.any(Function), []);
    expect(transaction.assertFresh).toHaveBeenCalledWith('persistTableSheetCheckpointV2:before_persist');
    expect(mocks.saveChat).toHaveBeenCalledOnce();
    expect(mocks.collectSummary).toHaveBeenCalledWith(mocks.chat, '', { maxMessageIndex: 0 });
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints.sheet_a).toEqual({
      kind: 'sheet_full', createdAt: 20, reason: 'manual', sheetKey: 'sheet_a', data: sheetA,
      scheduleSummary: { lastFilledAiFloor: 7, lastChangedAiFloor: 6 }, event, baseRevision: 'base-20',
    });
    expect(frame.checkpoint).toEqual(beforeFrame.checkpoint);
    expect(frame.headRevision).toBe(beforeFrame.headRevision);
    expect(frame.logEntries).toEqual(beforeFrame.logEntries);
    expect(frame.manualRefillProgress).toEqual(beforeFrame.manualRefillProgress);
    expect(frame.perSheetCheckpoints.sheet_b).toEqual(beforeFrame.perSheetCheckpoints.sheet_b);

    sheetA.content[1][1] = 'caller-mutated';
    event.changedSheetKeys.push('sheet_b');
    expect(frame.perSheetCheckpoints.sheet_a.data.content[1][1]).toBe('new');
    expect(frame.perSheetCheckpoints.sheet_a.event.changedSheetKeys).toEqual(['sheet_a']);
    sheetA.content[1][1] = 'new';
  });

  it('宿主保存失败时恢复 isolated data 与 Identity，并继续抛出原错误', async () => {
    const message = seedFrame();
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    message.TavernDB_ACU_Identity = 'old-identity';
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    const saveError = new Error('host save failed');
    mocks.saveChat.mockRejectedValueOnce(saveError);

    await expect(persistTableSheetCheckpointV2_ACU({
      targetMessageIndex: 0,
      sheetKey: 'sheet_a',
      sheetData: sheetA,
      reason: 'manual',
      transactionContext: makeTransaction(),
    })).rejects.toBe(saveError);

    expect(mocks.saveChat).toHaveBeenCalledOnce();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });

  it('R1：没有 transactionContext 时拒绝直接写入', async () => {
    seedFrame();
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual' });
    expect(result).toEqual({ saved: false, error: expect.stringContaining('requires TableWriteTransactionContext') });
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it.each([
    ['R6 非 sheet_ key', { sheetKey: 'mate', sheetData: sheetA, reason: 'manual' }, 'sheetKey beginning'],
    ['R7 sheetData 缺失', { sheetKey: 'sheet_a', sheetData: undefined, reason: 'manual' }, 'object sheetData'],
    ['R7 sheetData 非对象', { sheetKey: 'sheet_a', sheetData: [], reason: 'manual' }, 'object sheetData'],
    ['R8 reason 缺失', { sheetKey: 'sheet_a', sheetData: sheetA }, 'explicit checkpoint reason'],
  ])('%s 时拒绝且不保存', async (_name, partial, errorText) => {
    seedFrame();
    const result = await persistTableSheetCheckpointV2_ACU({ ...partial, transactionContext: makeTransaction() } as any);
    expect(result.saved).toBe(false);
    expect(result.error).toContain(errorText);
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it.each([
    ['filledSheetKeys', makeEntry({ filledSheetKeys: ['sheet_a'] })],
    ['changedSheetKeys', makeEntry({ changedSheetKeys: ['sheet_a'] })],
    ['groupKeys', makeEntry({ groupKeys: ['sheet_a'] })],
    ['结构化 operation', makeEntry({ operations: [{ kind: 'row_delete', sheetKey: 'sheet_a', rowId: '1' }] })],
    ['legacy patch', makeEntry({ patches: [{ kind: 'row_delete', sheetKey: 'sheet_a', rowId: '1' }] })],
  ])('R9：目标 frame 已有目标表 %s 时拒绝', async (_name, entry) => {
    seedFrame({ logEntries: [entry] });
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('existing target-sheet log entry');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it.each(['data_replace', 'sql_batch', 'table_edit_dsl'])('R9：存在无法证明不影响目标表的 %s 时拒绝', async kind => {
    const operation = kind === 'data_replace'
      ? { kind, data: { mate: {}, sheet_a: sheetA }, reason: 'system' }
      : kind === 'sql_batch'
        ? { kind, statements: ['UPDATE anything SET value = 1'] }
        : { kind, text: 'unknown edit' };
    seedFrame({ logEntries: [makeEntry({ operations: [operation] })] });
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('R10：已有更新 createdAt 的同表 shard 时拒绝旧写覆盖', async () => {
    seedFrame({ perSheetCheckpoints: {
      sheet_a: { kind: 'sheet_full', createdAt: 30, reason: 'manual', sheetKey: 'sheet_a', data: sheetA },
      sheet_b: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_b', data: sheetB },
    } });
    const result = await persistTableSheetCheckpointV2_ACU({
      sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', createdAt: 20, transactionContext: makeTransaction(),
    });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('cannot replace a newer checkpoint');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('目标 frame 早于最后一个 full checkpoint 时拒绝写入无效 shard', async () => {
    const earlyMessage = seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
      logEntries: [],
    });
    const laterFullMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 10, reason: 'compaction', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [],
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, earlyMessage, laterFullMessage);

    const result = await persistTableSheetCheckpointV2_ACU({ targetMessageIndex: 0, sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('precedes the latest full checkpoint');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it('过渡根承载帧继续允许既有 shard 写入，不新增兼容期准入门禁', async () => {
    const root = seedFrame({ logEntries: [] });
    const transitionTarget = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 2, reason: 'compaction', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [],
          },
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 2,
            data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
            cutoff: { messageIndex: 1, seq: 0, operationIndex: -1 },
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, root, transitionTarget);

    const result = await persistTableSheetCheckpointV2_ACU({
      targetMessageIndex: 1, sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction(),
    });

    expect(result).toMatchObject({ saved: true, messageIndex: 1 });
    expect(result.checkpoint).toMatchObject({ kind: 'sheet_full', sheetKey: 'sheet_a', reason: 'manual' });
    expect(mocks.saveChat).toHaveBeenCalledOnce();
    expect(transitionTarget.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toEqual(result.checkpoint);
  });

  it('没有根 full checkpoint 时拒绝仅写 shard', async () => {
    seedFrame({ checkpoint: undefined });
    const result = await persistTableSheetCheckpointV2_ACU({ sheetKey: 'sheet_a', sheetData: sheetA, reason: 'manual', transactionContext: makeTransaction() });
    expect(result.saved).toBe(false);
    expect(result.error).toContain('existing full checkpoint anchor');
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });
});

describe('persistNullRowCleanupShards_ACU', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.collectSummary.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.runTransaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      baseRevision: 'runtime-v1:test',
      assertFresh: vi.fn(),
      runCommit: async (commitTask: () => any) => commitTask(),
    }));
  });

  it('在一次事务和一次严格宿主保存中批量写入受影响 shard，不写 guide 或根 frame 字段', async () => {
    const message = seedFrame({ logEntries: [] });
    const before = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData[''].storageFrame));

    const result = await persistNullRowCleanupShards_ACU({
      sheetDataByKey: { sheet_a: sheetA, sheet_b: sheetB },
      createdAt: 30,
    });

    expect(result).toMatchObject({ status: 'persisted', messageIndex: 0 });
    expect(result.checkpoints).toHaveLength(2);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(before.checkpoint);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual(before.logEntries);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.headRevision).toBe(before.headRevision);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toMatchObject({
      kind: 'sheet_full', reason: 'integrity_repair', createdAt: 30, sheetKey: 'sheet_a',
    });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_b).toMatchObject({
      kind: 'sheet_full', reason: 'integrity_repair', createdAt: 30, sheetKey: 'sheet_b',
    });
    expect(mocks.setGuide).not.toHaveBeenCalled();
  });

  it('没有 full checkpoint anchor 时跳过且不创建 V2 checkpoint', async () => {
    const message = seedFrame({ checkpoint: undefined, logEntries: [] });

    const result = await persistNullRowCleanupShards_ACU({ sheetDataByKey: { sheet_a: sheetA } });

    expect(result).toEqual({ status: 'skipped_no_anchor' });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
  });

  it('过渡根承载帧继续允许 null-row cleanup shard 写入，不新增兼容期准入门禁', async () => {
    const root = seedFrame({ logEntries: [] });
    const transitionTarget = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 2, reason: 'compaction', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [],
          },
          spv79TransitionCheckpoint: {
            version: 1,
            kind: 'spv79_duplicate_row_id_transition',
            createdAt: 2,
            data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
            cutoff: { messageIndex: 1, seq: 0, operationIndex: -1 },
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, root, transitionTarget);

    const result = await persistNullRowCleanupShards_ACU({ sheetDataByKey: { sheet_a: sheetA } });

    expect(result).toMatchObject({ status: 'persisted', messageIndex: 1 });
    expect(result.checkpoints).toEqual([expect.objectContaining({ kind: 'sheet_full', sheetKey: 'sheet_a', reason: 'integrity_repair' })]);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(transitionTarget.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toEqual(result.checkpoints?.[0]);
  });

  it('最新 AI 楼层不是 V2 frame 时跳过，不把 legacy 目标隐式迁移为 V2', async () => {
    const anchor = seedFrame({ logEntries: [] });
    const legacyTarget = { is_user: false, TavernDB_ACU_IndependentData: { sheet_a: { legacy: true } } };
    mocks.chat.splice(0, mocks.chat.length, anchor, legacyTarget);

    const result = await persistNullRowCleanupShards_ACU({ sheetDataByKey: { sheet_a: sheetA } });

    expect(result).toEqual({ status: 'skipped_no_v2_target' });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(legacyTarget.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(legacyTarget.TavernDB_ACU_Identity).toBeUndefined();
    expect(anchor.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
  });

  it('commit 前 freshness conflict 时零写入、零保存且不报告已持久化', async () => {
    const message = seedFrame({ logEntries: [] });
    const original = message.TavernDB_ACU_IsolatedData;
    mocks.runTransaction.mockImplementationOnce(async (_options: any, task: any) => task({
      baseRevision: 'runtime-v1:stale',
      assertFresh: () => { throw new Error('runtime revision conflict'); },
      runCommit: async (commitTask: () => any) => commitTask(),
    }));

    const result = await persistNullRowCleanupShards_ACU({ sheetDataByKey: { sheet_a: sheetA } });

    expect(result).toEqual({ status: 'failed', error: 'runtime revision conflict' });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(original);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
  });

  it('严格宿主保存失败时恢复 isolated data 与 identity，并报告失败', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    message.TavernDB_ACU_Identity = 'old-identity';
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));

    const result = await persistNullRowCleanupShards_ACU({ sheetDataByKey: { sheet_a: sheetA } });

    expect(result).toEqual({ status: 'failed', error: 'host save failed' });
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });

  it('提交与回滚宿主保存均失败时保留两个错误并恢复内存状态', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    message.TavernDB_ACU_Identity = 'old-identity';
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('commit save failed')).mockRejectedValueOnce(new Error('rollback save failed'));

    const result = await persistNullRowCleanupShards_ACU({ sheetDataByKey: { sheet_a: sheetA } });

    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('commit save failed') });
    expect(result.error).toContain('rollback save failed');
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });
});

describe('commitCurrentFloorTemplateChanges_ACU', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.collectSummary.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.chatIdentity = 'chat-a';
    mocks.scopeContainer = { version: 1, template: { '': { old: true } } };
    mocks.guideContainer = { version: 1, tags: { '': { data: { sheet_old: {} } } } };
    mocks.loadReplayState.mockReset();
    mocks.loadReplayDetailed.mockReset().mockImplementation(async (...args: any[]) => {
      const data = await mocks.loadReplayState(...args);
      return data ? { baseKind: 'full_checkpoint', data } : null;
    });

    mocks.setGuide.mockReset().mockImplementation(() => true);
    mocks.runCommit.mockReset().mockImplementation(async (commitTask: () => any) => commitTask());
    mocks.runTransaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      baseRevision: 'runtime-v1:test',
      assertFresh: vi.fn(),
      runCommit: mocks.runCommit,
    }));
  });

  describe('commitCurrentFloorTemplateScopeOnly_ACU', () => {
    const scopeOnlyData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: sheetA,
      sheet_b: sheetB,
    } as any;

    it('持久化 Sheet 投影一致时仅写入 guide 与 template scope，不创建 V2 frame', async () => {
      const message = { is_user: false } as any;
      mocks.chat.push(message);

      const result = await commitCurrentFloorTemplateScopeOnly_ACU({
        isolationKey: 'scope-only',
        baselineData: scopeOnlyData,
        candidateData: JSON.parse(JSON.stringify(scopeOnlyData)),
        guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
        templateSource: scopeOnlyData,
        presetName: '预设A',
        source: 'test',
        createdAt: 30,
      });

      expect(result).toEqual({ saved: true, mode: 'scope_only' });
      expect(mocks.runTransaction).toHaveBeenCalledWith(expect.objectContaining({
        source: 'template_assistant', isolationKey: 'scope-only', writeSet: [{ kind: 'all' }], maintenanceMode: 'exclusive',
      }), expect.any(Function));
      expect(mocks.runCommit).toHaveBeenCalledWith(expect.any(Function), []);
      expect(mocks.setGuide).toHaveBeenCalledWith('scope-only', expect.any(Object), expect.objectContaining({
        syncTemplateScope: true, templateSource: scopeOnlyData, presetName: '预设A', source: 'test', updatedAt: 30,
      }));
      expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
      expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    });

    it('事务锁内目标聊天身份变化时拒绝 scope-only 提交', async () => {
      const message = { is_user: false } as any;
      mocks.chat.push(message);
      mocks.chatIdentity = 'chat-b';

      const result = await commitCurrentFloorTemplateScopeOnly_ACU({
        baselineData: scopeOnlyData,
        candidateData: JSON.parse(JSON.stringify(scopeOnlyData)),
        guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
        templateSource: scopeOnlyData,
        expectedChatIdentity: 'chat-a',
        expectedFirstMessage: message,
      });

      expect(result).toMatchObject({ saved: false, error: expect.stringContaining('目标聊天已切换') });
      expect(mocks.setGuide).not.toHaveBeenCalled();
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    });

    it('事务锁内收到取消信号时拒绝 scope-only 提交', async () => {
      const message = { is_user: false } as any;
      mocks.chat.push(message);
      const controller = new AbortController();
      controller.abort();

      const result = await commitCurrentFloorTemplateScopeOnly_ACU({
        baselineData: scopeOnlyData,
        candidateData: JSON.parse(JSON.stringify(scopeOnlyData)),
        guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
        templateSource: scopeOnlyData,
        expectedChatIdentity: 'chat-a',
        expectedFirstMessage: message,
        signal: controller.signal,
      });

      expect(result).toMatchObject({ saved: false, error: expect.stringContaining('已取消') });
      expect(mocks.setGuide).not.toHaveBeenCalled();
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    });

    it('持久化 Sheet 投影不一致时拒绝，且不进入事务或保存', async () => {
      mocks.chat.push({ is_user: false });
      const changedCandidate = JSON.parse(JSON.stringify(scopeOnlyData));
      changedCandidate.sheet_a.name = '已变更';

      const result = await commitCurrentFloorTemplateScopeOnly_ACU({
        baselineData: scopeOnlyData,
        candidateData: changedCandidate,
        guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
        templateSource: changedCandidate,
      });

      expect(result).toMatchObject({ saved: false, error: expect.stringContaining('持久化 Sheet 投影完全一致') });
      expect(mocks.runTransaction).not.toHaveBeenCalled();
      expect(mocks.setGuide).not.toHaveBeenCalled();
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    });

    it('无效 guideData 时在副作用前拒绝', async () => {
      const result = await commitCurrentFloorTemplateScopeOnly_ACU({
        baselineData: scopeOnlyData,
        candidateData: JSON.parse(JSON.stringify(scopeOnlyData)),
        guideData: [] as any,
        templateSource: scopeOnlyData,
      });

      expect(result).toMatchObject({ saved: false, error: expect.stringContaining('有效的 guideData') });
      expect(mocks.runTransaction).not.toHaveBeenCalled();
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    });

    it('严格保存失败时恢复 scope 与 guide 容器并执行回滚保存', async () => {
      mocks.chat.push({ is_user: false });
      const originalScope = JSON.parse(JSON.stringify(mocks.scopeContainer));
      const originalGuide = JSON.parse(JSON.stringify(mocks.guideContainer));
      mocks.setGuide.mockImplementation(() => {
        mocks.scopeContainer.template[''].changed = true;
        mocks.guideContainer.tags[''].changed = true;
        return true;
      });
      mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed')).mockResolvedValueOnce(undefined);

      const result = await commitCurrentFloorTemplateScopeOnly_ACU({
        baselineData: scopeOnlyData,
        candidateData: JSON.parse(JSON.stringify(scopeOnlyData)),
        guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
        templateSource: scopeOnlyData,
      });

      expect(result).toEqual({ saved: false, error: 'host save failed' });
      expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
      expect(mocks.scopeContainer).toEqual(originalScope);
      expect(mocks.guideContainer).toEqual(originalGuide);
    });
  });

  it('structural commit 在异步 replay 期间取消时不修改 frame、guide 或保存', async () => {
    const message = seedFrame({ logEntries: [] });
    const frameBefore = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData));
    const guideBefore = JSON.parse(JSON.stringify(mocks.guideContainer));
    const scopeBefore = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const controller = new AbortController();
    let resolveReplay!: (value: any) => void;
    mocks.loadReplayState.mockImplementationOnce(() => new Promise(resolve => { resolveReplay = resolve; }));

    const pending = commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      deletedSheetKeys: ['sheet_b'],
      guideData: { sheet_a: { name: 'A' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA },
      expectedChatIdentity: 'chat-a',
      expectedFirstMessage: message,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.loadReplayState).toHaveBeenCalled());
    controller.abort();
    resolveReplay({ mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB });
    const result = await pending;

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('已取消') });
    expect(message.TavernDB_ACU_IsolatedData).toEqual(frameBefore);
    expect(mocks.guideContainer).toEqual(guideBefore);
    expect(mocks.scopeContainer).toEqual(scopeBefore);
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('structural commit 在异步 replay 期间切换聊天时不修改目标聊天或保存', async () => {
    const message = seedFrame({ logEntries: [] });
    const frameBefore = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData));
    const guideBefore = JSON.parse(JSON.stringify(mocks.guideContainer));
    const scopeBefore = JSON.parse(JSON.stringify(mocks.scopeContainer));
    let resolveReplay!: (value: any) => void;
    mocks.loadReplayState.mockImplementationOnce(() => new Promise(resolve => { resolveReplay = resolve; }));

    const pending = commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      deletedSheetKeys: ['sheet_b'],
      guideData: { sheet_a: { name: 'A' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA },
      expectedChatIdentity: 'chat-a',
      expectedFirstMessage: message,
    });
    await vi.waitFor(() => expect(mocks.loadReplayState).toHaveBeenCalled());
    mocks.chat.splice(0, mocks.chat.length, { is_user: false, switched: true });
    mocks.chatIdentity = 'chat-b';
    resolveReplay({ mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB });
    const result = await pending;

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('目标聊天已切换') });
    expect(message.TavernDB_ACU_IsolatedData).toEqual(frameBefore);
    expect(mocks.guideContainer).toEqual(guideBefore);
    expect(mocks.scopeContainer).toEqual(scopeBefore);
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('pristine 聊天保存完整模板快照时创建 header-only V2 checkpoint 与 sheet checkpoints', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const templateSource = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource,
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit', messageIndex: 0, removedNullRowCount: 0 });
    expect(result.checkpoints).toHaveLength(2);
    expect(mocks.loadReplayState).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.setGuide).toHaveBeenCalledOnce();
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    expect(frame.checkpoint.data.sheet_a.content).toEqual([['row_id', 'value']]);
    expect(frame.perSheetCheckpoints.sheet_a).toMatchObject({
      kind: 'sheet_full', sheetKey: 'sheet_a', data: { content: [['row_id', 'value']] },
    });
    expect(message.TavernDB_ACU_Identity).toBeUndefined();
  });

  it('native pristine 提交不生成、校验或写回 DDL', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const nativeSheet = {
      ...sheetA,
      sourceData: {},
      content: [['row_id', 'value'], ['1', 'native-value']],
    } as any;
    const templateSource = { mate: { type: 'acu' }, sheet_a: nativeSheet };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      storageMode: 'native',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: nativeSheet,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' } },
      templateSource,
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit' });
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint.data.sheet_a.sourceData).toEqual({});
    expect(frame.perSheetCheckpoints.sheet_a.data.sourceData).toEqual({});
    expect(templateSource.sheet_a.sourceData).toEqual({});
  });

  it('pristine 聊天删表时按 templateSource 重建基线，不再拒绕删除', async () => {
    // 回归：pristine 分支的 checkpoint 完全由 templateSource 重建，没有历史楼层需要回溯清理，
    // 因此新聊天删表必须能走通；旧守卫无条件拒绕，使首次填表前删表完全不可用。
    const message = { is_user: false } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      deletedSheetKeys: ['sheet_b'],
      guideData: { sheet_a: { name: 'A' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA },
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit', messageIndex: 0 });
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    // 被删表既不进新 checkpoint，也不会留下 per-sheet 基线。
    expect(Object.keys(frame.checkpoint.data).filter(key => key.startsWith('sheet_'))).toEqual(['sheet_a']);
    expect(frame.perSheetCheckpoints.sheet_b).toBeUndefined();
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
  });

  it('pristine 删表但 templateSource 仍保留该表时 fail-loud，不静默放行', async () => {
    const message = { is_user: false } as any;
    const scopeBefore = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const guideBefore = JSON.parse(JSON.stringify(mocks.guideContainer));
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      deletedSheetKeys: ['sheet_b'],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('仍包含已删除 Sheet') });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.scopeContainer).toEqual(scopeBefore);
    expect(mocks.guideContainer).toEqual(guideBefore);
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });


  it.each([
    ['full checkpoint', { checkpoint: { kind: 'full', data: { mate: { type: 'acu' } } } }],
    ['per-sheet checkpoint', { perSheetCheckpoints: { sheet_a: { kind: 'sheet_full', data: sheetA } } }],
    ['non-empty log', { logEntries: [{ seq: 1 }] }],
    ['head revision', { headRevision: 'checkpoint:orphan' }],
    ['manual refill progress', { manualRefillProgress: { status: 'in_progress' } }],
  ])('缺失版本标记但残留 %s 时拒绝创建新的 pristine checkpoint', async (_label, storageFrame) => {
    const message = {
      is_user: false,
      TavernDB_ACU_IsolatedData: { '': { storageFrame } },
    } as any;
    const isolatedDataBefore = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData));
    const scopeBefore = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const guideBefore = JSON.parse(JSON.stringify(mocks.guideContainer));
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('V2 存储痕迹') });
    expect(message.TavernDB_ACU_IsolatedData).toEqual(isolatedDataBefore);
    expect(mocks.scopeContainer).toEqual(scopeBefore);
    expect(mocks.guideContainer).toEqual(guideBefore);
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('拒绝写入更晚 full checkpoint 之前的填表数据，避免产生不可回放增量', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const earlyMessage = { is_user: false } as any;
    const laterCheckpointMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 2, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA } },
            logEntries: [],
          },
        },
      },
    } as any;
    mocks.chat.splice(0, mocks.chat.length, earlyMessage, laterCheckpointMessage);

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'x']] } } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'x'] }] as any,
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result).toEqual({
      saved: false,
      error: 'V2 write target precedes the latest full checkpoint and would never replay: targetMessageIndex=0, latestFullCheckpointIndex=1.',
    });
    expect(earlyMessage.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });


  it('目标表在本楼未被任何 checkpoint 锚定时，先补写 per-sheet checkpoint 再追加增量', async () => {
    // 复现：先用旧模板填过表，切到新模板（新增表/列，rebase 落在最新楼层），
    // 再对更早楼层追平。那些楼的 full checkpoint 不含新表，直接写增量会产出
    // 回放时 no such table 的日志。
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame({
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        // 旧模板基底：只有 sheet_a，没有 sheet_new。
        data: { mate: { type: 'acu' }, sheet_a: sheetA },
      },
      logEntries: [],
      perSheetCheckpoints: {},
    });

    const newSheet = { ...sheetB, uid: 'sheet_new', name: '新模板新表', content: [['row_id', 'value'], ['1', '新数据']] };
    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_new: newSheet } as any,
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_new', rowId: '1', cells: ['1', '新数据'] }] as any,
      candidateChangedSheetKeys: ['sheet_new'],
      filledSheetKeys: ['sheet_new'],
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.saved).toBe(true);
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    // 必须为本楼缺失的目标表补写 per-sheet checkpoint，否则增量无法回放。
    const introduced = frame.perSheetCheckpoints?.sheet_new;
    expect(introduced).toBeDefined();
    expect(introduced?.timeline?.kind).toBe('sheet_introduction');
    // 锚点只提供表结构：带上数据行会与本次增量的同 row_id 冲突（UNIQUE constraint failed）。
    expect(introduced?.data?.content).toEqual([['row_id', 'value']]);
    // 锚点必须在本次增量之前生效。
    const appendedSeq = frame.logEntries[frame.logEntries.length - 1]?.seq;
    expect(introduced?.timeline?.afterSeq).toBeLessThan(Number(appendedSeq));
    // 已锚定的 sheet_a 不应被重复补写。
    expect(frame.perSheetCheckpoints?.sheet_a).toBeUndefined();
  });

  it('历史曾存在但执行点已隐藏的目标表，按 bounded replay 判定为 inactive 并补 sheet_reveal', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const hiddenSheet = { ...sheetB, uid: 'hidden', name: '历史隐藏表', content: [['row_id', 'value'], ['1', '新数据']] };
    const message = seedFrame({
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_hidden: hiddenSheet },
      },
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full', createdAt: 2, reason: 'schema_change', sheetKey: 'sheet_hidden', data: hiddenSheet,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
        },
      },
    });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA },
    });

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_hidden: hiddenSheet } as any,
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_hidden', rowId: '1', cells: ['1', '新数据'] }] as any,
      candidateChangedSheetKeys: ['sheet_hidden'],
      filledSheetKeys: ['sheet_hidden'],
      transactionContext: makeTransaction(), assumeCommitLock: true,
    });

    expect(result).toMatchObject({ saved: true });
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', expect.objectContaining({
      maxMessageIndex: 0,
      updateRuntimeState: false,
    }));
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden).toMatchObject({
      timeline: { kind: 'sheet_reveal', activateAtMessageIndex: 0, afterSeq: 0 },
      data: { content: [['row_id', 'value']] },
    });
  });


  it('pristine 聊天提交 hide 变更时不要求 templateSource 包含被隐藏表', async () => {
    // 复现：无数据（无 full checkpoint）的聊天切模板，reconciler 会为模板中缺失的
    // 旧表产出 hide 变更，同时把它从 candidateData（即 templateSource）删除。
    // hide 的语义就是该表不再活跃，因此不能要求快照里还包含它。
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const templateSource = { mate: { type: 'acu' }, sheet_a: sheetA };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'hide', sheetKey: 'sheet_b', sheetData: sheetB },
        {
          kind: 'operations',
          sheetKey: 'sheet_a',
          targetSheetData: sheetA,
          operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
        },
      ],
      guideData: { sheet_a: { name: 'A' } },
      templateSource,
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit', messageIndex: 0 });
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    // 被隐藏的表不进新初始基线。
    expect(frame.checkpoint.data.sheet_b).toBeUndefined();
    expect(frame.checkpoint.data.sheet_a.content).toEqual([['row_id', 'value']]);
  });



  it('显式 baseRevision 在事务进入前透传，且 stale plan 在任何模板副作用前被拒绝', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const staleError = new Error('runtime revision conflict');
    mocks.runTransaction.mockImplementationOnce(async (_options: any, task: any) => task({
      baseRevision: 'runtime-v1:stale',
      assertFresh: () => { throw staleError; },
      runCommit: async (commitTask: () => any) => commitTask(),
    }));

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      baseRevision: 'runtime-v1:expected',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '新名称' } }],
      }],
      guideData: { sheet_a: { name: '新名称' }, sheet_b: { name: 'B' } },
    });

    expect(mocks.runTransaction).toHaveBeenCalledWith(expect.objectContaining({
      baseRevision: 'runtime-v1:expected',
      writeSet: [{ kind: 'schema', sheetKey: 'sheet_a' }],
    }), expect.any(Function));
    expect(result).toEqual({ saved: false, error: 'V2 stale_revision_conflict: runtime revision conflict' });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
  });

  it('尚无 full checkpoint 且缺少完整 templateSource 时拒绝并保持消息不变', async () => {
    const message = { is_user: false, marker: 'unchanged' } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' } },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('完整有效的 templateSource') });
    expect(message).toEqual({ is_user: false, marker: 'unchanged' });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
  });

  it('尚无 full checkpoint 时拒绝非法 mate，且不创建 storage frame', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: null, sheet_a: sheetA, sheet_b: sheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('templateSource.mate 无效') });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
  });

  it('尚无 full checkpoint 时拒绝未参与变更的畸形 Sheet', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: { ...sheetB, content: 'invalid' } },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('无效 Sheet：sheet_b') });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('尚无 full checkpoint 时拒绝未参与变更 Sheet 的 DDL 与表头不一致', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const invalidSheetB = {
      ...sheetB,
      sourceData: { ddl: 'CREATE TABLE b (row_id INTEGER PRIMARY KEY, missing TEXT);' },
    };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: invalidSheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('DDL 无法 strict hydrate：sheet_b') });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('尚无 full checkpoint 时通过静态映射但真实 SQLite hydrate 失败仍拒绝保存', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const hydrateInvalidSheetB = {
      ...sheetB,
      content: [['row_id', 'value'], ['1', null]],
      sourceData: { ddl: 'CREATE TABLE b (row_id INTEGER PRIMARY KEY, value TEXT CHECK (value IS NOT NULL));' },
    };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: hydrateInvalidSheetB },
    });

    expect(result).toMatchObject({
      saved: false,
      error: expect.stringContaining('完整 templateSource 无法通过 SQLite strict hydrate'),
    });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
  });

  it('尚无 full checkpoint 时拒绝 templateSource 与 guideData 的 Sheet 集合不一致', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] }],
      guideData: { sheet_a: { name: 'A' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('Sheet 集合不一致') });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('尚无 full checkpoint 时按规范化后的 guideData 拒绝会被丢弃的 Sheet', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: null },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('Sheet 集合不一致') });
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
  });

  it('template-only 严格保存失败时不创建 storage frame 或 identity', async () => {
    const message = { is_user: false, TavernDB_ACU_Identity: 'old-identity' } as any;
    mocks.chat.push(message);
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('initial template save failed')).mockResolvedValueOnce(undefined);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: 'initial template save failed' });
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });

  it('初次模板提交创建 V2 anchor，后续提交复用该 anchor', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const templateSource = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB };
    const options = {
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations' as const,
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update' as const, sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource,
      syncTemplateScope: true,
    };

    const first = await commitCurrentFloorTemplateChanges_ACU(options);
    mocks.loadReplayState.mockResolvedValue({
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value']] },
      sheet_b: sheetB,
    });
    const second = await commitCurrentFloorTemplateChanges_ACU(options);

    expect(first).toMatchObject({ saved: true, mode: 'v2_commit' });
    expect(second).toMatchObject({ saved: true, mode: 'v2_commit' });
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(mocks.setGuide).toHaveBeenCalledTimes(2);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toMatchObject({ kind: 'full' });
    expect(message.TavernDB_ACU_Identity).toBeUndefined();
  });

  it('首次模板 checkpoint 仅传递目标 isolation 的 guide/scope 更新请求', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: 'isolated-template',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      syncTemplateScope: true,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit' });
    expect(mocks.setGuide).toHaveBeenCalledWith('isolated-template', expect.any(Object), expect.objectContaining({
      syncTemplateScope: true,
      templateSource: expect.any(Object),
    }));
    expect(message.TavernDB_ACU_IsolatedData['isolated-template'].storageFrame.checkpoint).toMatchObject({
      kind: 'full',
      reason: 'init',
      data: { sheet_a: { content: [['row_id', 'value']] } },
    });
    expect(message.TavernDB_ACU_Identity).toBeUndefined();
  });

  it('template-only guide/scope 写入失败时恢复两个容器且不保存宿主', async () => {
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const originalScope = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const originalGuide = JSON.parse(JSON.stringify(mocks.guideContainer));
    mocks.setGuide.mockImplementation(() => {
      mocks.scopeContainer = { version: 1, template: { '': { changed: true } } };
      mocks.guideContainer = { version: 1, tags: { '': { changed: true } } };
      return false;
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('无法原子写入 guideData 与 template scope') });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.scopeContainer).toEqual(originalScope);
    expect(mocks.guideContainer).toEqual(originalGuide);
    expect(message.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(message.TavernDB_ACU_Identity).toBeUndefined();
  });

  it('初次模板提交创建 header-only init checkpoint，后续真实数据作为 V2 operation 写入', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = { is_user: false } as any;
    mocks.chat.push(message);
    const templateSource = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value']] },
      sheet_b: sheetB,
    };

    const templateResult = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: templateSource.sheet_a,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource,
    });

    expect(templateResult).toMatchObject({ saved: true, mode: 'v2_commit' });
    let frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toMatchObject({
      kind: 'full',
      reason: 'init',
      data: { sheet_a: { content: [['row_id', 'value']] } },
    });

    mocks.loadReplayState.mockResolvedValue({
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value']] },
      sheet_b: sheetB,
    });
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'first-real-data']] },
      sheet_b: sheetB,
    } as any;
    const firstWrite = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'first-real-data'] }],
      checkpointReason: 'init',
      forceCheckpoint: true,
      strictSave: true,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(firstWrite.saved).toBe(true);
    frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toMatchObject({
      kind: 'full', reason: 'init', data: { sheet_a: { content: [['row_id', 'value']] } },
    });
    expect(frame.logEntries).toMatchObject([
      { operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'first-real-data'] }] },
    ]);

    const firstImportMessage = { is_user: false } as any;
    mocks.chat.splice(0, mocks.chat.length, firstImportMessage);
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    const firstImport = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'import',
      afterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(firstImport.saved).toBe(true);
    expect(firstImportMessage.TavernDB_ACU_IsolatedData[''].storageFrame).toMatchObject({
      checkpoint: { kind: 'full', reason: 'init', data: afterData },
      logEntries: [],
    });
    expect(mocks.saveChat).toHaveBeenCalledOnce();

    const historicalImportMessage = { is_user: false } as any;
    const futureCheckpointMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 2, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
            logEntries: [],
          },
        },
      },
    } as any;
    mocks.chat.splice(0, mocks.chat.length, historicalImportMessage, futureCheckpointMessage);
    mocks.saveChat.mockClear();
    const historicalImport = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'import',
      afterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(historicalImport).toEqual({
      saved: false,
      error: 'V2 write target precedes the latest full checkpoint and would never replay: targetMessageIndex=0, latestFullCheckpointIndex=1.',
    });
    // 回放只从最后一个 full checkpoint 开始；因此不能把导入伪装成已保存的历史增量。
    expect(historicalImportMessage.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(futureCheckpointMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data).toEqual({
      mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB,
    });
    expect(mocks.saveChat).not.toHaveBeenCalled();

    const incrementalImportMessage = seedFrame({ logEntries: [] });
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB });
    mocks.saveChat.mockClear();
    const incrementalAfterData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, name: 'imported-sheet-a' },
      sheet_b: sheetB,
    } as any;
    const incrementalImport = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'import',
      afterData: incrementalAfterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(incrementalImport.saved).toBe(true);
    expect(incrementalImportMessage.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toMatchObject([
      { operations: [{ kind: 'data_replace', data: incrementalAfterData, reason: 'import' }] },
    ]);
    expect(mocks.saveChat).toHaveBeenCalledOnce();

    const rejectedInitialMessage = { is_user: false } as any;
    mocks.chat.splice(0, mocks.chat.length, rejectedInitialMessage);
    const initialSnapshot = JSON.parse(JSON.stringify(rejectedInitialMessage));
    const rejectedInitialIsolatedData = rejectedInitialMessage.TavernDB_ACU_IsolatedData;
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    for (const operation of [
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['2', 'identity-mismatch'] },
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1'] },
      { kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'unreplayed-change' } },
    ]) {
      const result = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 0,
        source: 'manual_fill',
        afterData,
        filledSheetKeys: ['sheet_a'],
        candidateChangedSheetKeys: ['sheet_a'],
        operations: [operation] as any,
        checkpointReason: 'init',
        forceCheckpoint: true,
        transactionContext: makeTransaction(),
        assumeCommitLock: true,
      });

      expect(result).toEqual({ saved: false, error: expect.stringContaining('初始 full checkpoint 不接受 operations') });
      expect(rejectedInitialMessage).toEqual(initialSnapshot);
      expect(rejectedInitialMessage.TavernDB_ACU_IsolatedData).toBe(rejectedInitialIsolatedData);
      expect(mocks.saveChat).not.toHaveBeenCalled();
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    }

    mocks.chat.splice(0, mocks.chat.length, message);
    mocks.loadReplayState.mockResolvedValue(afterData);
    const secondWrite = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      checkpointReason: 'init',
      forceCheckpoint: true,
      strictSave: true,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(secondWrite.saved).toBe(true);
    const persistedFrame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(persistedFrame.checkpoint).toMatchObject({
      kind: 'full',
      reason: 'init',
      data: { sheet_a: { content: [['row_id', 'value']] } },
    });
    expect(persistedFrame.logEntries).toHaveLength(2);
    expect(persistedFrame.logEntries[0].operations).toEqual([
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'first-real-data'] },
    ]);
    expect(persistedFrame.logEntries[1].operations).toEqual([
      { kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } },
    ]);
  });

  it('有 V2 frame 但无 full checkpoint 时拒绝隐式 migration 基线，且零写入零保存', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } },
      },
    } as any;
    mocks.chat.splice(0, mocks.chat.length, message);
    const before = JSON.parse(JSON.stringify(message));
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any,
      filledSheetKeys: [],
      candidateChangedSheetKeys: [],
      operations: [],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toEqual({
      saved: false,
      error: 'V2 storage contains frames but no full checkpoint anchor; refusing to create an implicit migration checkpoint at the current write target. Please run V2 recovery diagnostics first.',
    });
    expect(message).toEqual(before);
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });


  it('无锚点日志可由临时模板基线完整回放时，以 afterData 建立唯一正式 full checkpoint 并保留原 frame 备份', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const orphanFrame = {
      version: 2,
      checkpoint: undefined,
      headRevision: '1:orphan',
      logEntries: [makeEntry({
        changedSheetKeys: ['sheet_a'],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', '历史孤立数据'] }],
      })],
      perSheetCheckpoints: {
        sheet_a: {
          kind: 'sheet_full', createdAt: 1, reason: 'manual', sheetKey: 'sheet_a',
          data: sheetA,
          timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 0, afterSeq: 1 },
        },
      },
    };
    const message = seedFrame(orphanFrame);
    const replayedOrphanData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '历史孤立数据']] },
      sheet_b: sheetB,
    } as any;
    const afterData = {
      ...replayedOrphanData,
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '历史孤立数据'], ['2', '本次写入']] },
    } as any;
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      baseKind: 'temporary_template_baseline',
      data: replayedOrphanData,
    }).mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: afterData })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: afterData });
    mocks.saveChatStrict.mockClear();

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', '本次写入'] }],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toMatchObject({ saved: true, messageIndex: 0 });
    const tagData = message.TavernDB_ACU_IsolatedData[''];
    expect(tagData.storageFrame).toMatchObject({
      checkpoint: { kind: 'full', reason: 'integrity_repair', data: afterData },
      logEntries: [],
    });
    expect(tagData.storageFrame.perSheetCheckpoints).toBeUndefined();
    const expectedBackupFrame = {
      version: orphanFrame.version,
      headRevision: orphanFrame.headRevision,
      logEntries: orphanFrame.logEntries,
      perSheetCheckpoints: orphanFrame.perSheetCheckpoints,
    };
    expect(tagData.recoveryBackup).toMatchObject({
      version: 1,
      recoveryKind: 'temporary_template_baseline_upgrade',
      sourceMessageIndex: 0,
      storageFrame: expectedBackupFrame,
    });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
  });

  it('临时基线升级时若 operation 无法推导出 afterData 则 fail closed 且不覆盖 orphan 证据', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame({
      checkpoint: undefined,
      headRevision: '1:orphan',
      logEntries: [makeEntry({ operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', '历史孤立数据'] }] })],
    });
    const before = JSON.parse(JSON.stringify(message));
    const replayedOrphanData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '历史孤立数据']] },
      sheet_b: sheetB,
    } as any;
    mocks.loadReplayDetailed.mockResolvedValueOnce({ baseKind: 'temporary_template_baseline', data: replayedOrphanData });
    mocks.saveChatStrict.mockClear();

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'manual_fill',
      afterData: {
        ...replayedOrphanData,
        sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '历史孤立数据'], ['2', '不匹配数据']] },
      } as any,
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '2', cells: ['2', '另一份数据'] }],
      strictSave: true,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toEqual({ saved: false, error: expect.stringContaining('afterData 不一致') });
    expect(message).toEqual(before);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('临时基线升级即使调用方未声明 strictSave，宿主保存失败时仍恢复原 orphan frame 与 identity', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame({ checkpoint: undefined, headRevision: '1:orphan', logEntries: [makeEntry()] });
    message.TavernDB_ACU_Identity = 'old-identity';
    const beforeIsolatedData = message.TavernDB_ACU_IsolatedData;
    const replayedData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any;
    mocks.loadReplayDetailed.mockResolvedValueOnce({ baseKind: 'temporary_template_baseline', data: replayedData })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: replayedData })
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: replayedData });
    mocks.saveChatStrict.mockReset().mockRejectedValueOnce(new Error('upgrade save failed'));

    await expect(persistTableMutationLogV2_ACU({
      targetMessageIndex: 0, source: 'manual_fill', afterData: replayedData,
      filledSheetKeys: ['sheet_a'], candidateChangedSheetKeys: ['sheet_a'], operations: [],
      transactionContext: makeTransaction(), assumeCommitLock: true,
    })).rejects.toThrow('upgrade save failed');

    expect(message.TavernDB_ACU_IsolatedData).toBe(beforeIsolatedData);
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
  });

  it('在最新 AI 楼层原子追加多个既有 Sheet operation 与 guide，并且严格保存一次', async () => {
    const message = seedFrame({ logEntries: [] });
    const guideData = { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
        { kind: 'operations', sheetKey: 'sheet_b', targetSheetData: sheetB, operations: [{ kind: 'meta_update', sheetKey: 'sheet_b', meta: { name: 'B' } }] },
      ],
      guideData,
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    expect(result.messageIndex).toBe(0);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(mocks.setGuide).toHaveBeenCalledWith('', guideData, expect.objectContaining({
      syncTemplateScope: true,
      updatedAt: 30,
    }));
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints.sheet_a).toBeUndefined();
    expect(frame.perSheetCheckpoints.sheet_b).toBeDefined();
    expect(frame.logEntries).toHaveLength(1);
    expect(frame.logEntries[0]).toMatchObject({
      seq: 1, source: 'template_assistant', filledSheetKeys: [], changedSheetKeys: ['sheet_a', 'sheet_b'], groupKeys: [],
      operations: [
        { kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } },
        { kind: 'meta_update', sheetKey: 'sheet_b', meta: { name: 'B' } },
      ],
    });
  });

  it('当前 frame 已有目标 Sheet 日志时将 migration 和 meta_update 追加到尾部且不创建旧 Sheet checkpoint', async () => {
    const beforeSheet = {
      uid: 'inventory', name: '旧背包', orderNo: 0,
      content: [['row_id', '名称'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 名称\n);', note: '旧说明' },
      updateConfig: {}, exportConfig: {},
    } as any;
    const migratedSheet = {
      ...beforeSheet,
      content: [['row_id', '名称', '品质'], ['1', '铁剑', null]],
      sourceData: { ...beforeSheet.sourceData, ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT, -- 名称\n  quality TEXT -- 品质\n);' },
    } as any;
    const targetSheet = {
      ...migratedSheet,
      name: '新背包',
      orderNo: 4,
      sourceData: { ...migratedSheet.sourceData, note: '新说明' },
    } as any;
    const migration = await buildSheetSchemaMigrationOperation_ACU('sheet_a', beforeSheet, migratedSheet);
    const existingEntry = makeEntry({
      seq: 7,
      entryId: 'existing-target-entry',
      changedSheetKeys: ['sheet_a'],
      operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '旧背包' } }],
    });
    const message = seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: beforeSheet, sheet_b: sheetB } },
      logEntries: [existingEntry],
      perSheetCheckpoints: { sheet_b: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_b', data: sheetB } },
    });
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: beforeSheet, sheet_b: sheetB });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: targetSheet,
        operations: [
          migration,
          { kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '新背包', orderNo: 4, sourceData: { note: '新说明' } } },
        ],
      }],
      guideData: { sheet_a: { name: '新背包' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.logEntries[0]).toEqual(existingEntry);
    expect(frame.logEntries[1]).toMatchObject({
      seq: 8,
      source: 'template_assistant',
      changedSheetKeys: ['sheet_a'],
      operations: [
        expect.objectContaining({ kind: 'sheet_schema_migrate', sheetKey: 'sheet_a' }),
        { kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '新背包', orderNo: 4, sourceData: { note: '新说明' } } },
      ],
    });
    expect(frame.headRevision).toBe(frame.logEntries[1].commitRevision);
    expect(frame.perSheetCheckpoints.sheet_a).toBeUndefined();
  });

  it('contractVersion 2 migration 通过模板提交校验并原样写入日志', async () => {
    const beforeSheet = {
      uid: 'inventory', name: '背包', orderNo: 0,
      content: [['row_id', '名称'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT -- 名称\n);' },
      updateConfig: {}, exportConfig: {},
    } as any;
    const targetSheet = {
      ...beforeSheet,
      content: [['row_id', '名称', '品质'], ['1', '铁剑', 'normal']],
      sourceData: { ddl: "CREATE TABLE inventory (\n row_id INTEGER PRIMARY KEY, -- 行号\n item_name TEXT, -- 名称\n quality TEXT NOT NULL DEFAULT 'normal' -- 品质\n);" },
    } as any;
    const migration = await buildSheetSchemaMigrationOperationV2_ACU('sheet_a', beforeSheet, targetSheet, {
      physicalColumnMappings: [],
      fills: {
        quality: { kind: 'ddl_literal_default', literal: { kind: 'string', sql: "'normal'", value: 'normal' } },
      },
      conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    });
    const message = seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: beforeSheet, sheet_b: sheetB } },
      logEntries: [],
      perSheetCheckpoints: { sheet_b: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_b', data: sheetB } },
    });
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: beforeSheet, sheet_b: sheetB });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: targetSheet, operations: [migration] }],
      guideData: { sheet_a: { name: '背包' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.logEntries).toHaveLength(1);
    expect(frame.logEntries[0].operations).toEqual([migration]);
    expect(frame.logEntries[0].operations[0]).toMatchObject({ contractVersion: 2, fills: { quality: expect.any(Object) } });
  });

  it('同批 introduction 与已有 Sheet migration 使用旧尾 seq 激活并将 operation 写入下一 seq', async () => {
    const beforeSheet = {
      uid: 'inventory', name: '背包', orderNo: 0,
      content: [['row_id', '名称'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 名称\n);' },
      updateConfig: {}, exportConfig: {},
    } as any;
    const targetSheet = {
      ...beforeSheet,
      content: [['row_id', '名称', '品质'], ['1', '铁剑', null]],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT, -- 名称\n  quality TEXT -- 品质\n);' },
    } as any;
    const migration = await buildSheetSchemaMigrationOperation_ACU('sheet_a', beforeSheet, targetSheet);
    const introducedSheet = { ...sheetB, uid: 'new_sheet', name: '新增表', content: [['row_id', 'value']] } as any;
    const message = seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: beforeSheet, sheet_b: sheetB } },
      logEntries: [makeEntry({ seq: 7 })],
      perSheetCheckpoints: {},
    });
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: beforeSheet, sheet_b: sheetB });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet },
        { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: targetSheet, operations: [migration] },
      ],
      guideData: { sheet_a: { name: '背包' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints.sheet_new.timeline).toEqual({ kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 7 });
    expect(frame.logEntries[1]).toMatchObject({ seq: 8, operations: [expect.objectContaining({ kind: 'sheet_schema_migrate', sheetKey: 'sheet_a' })] });
  });

  it('新增 sheet 在目标 frame 尾部日志后写入 introduction timeline', async () => {
    const introducedSheet = { ...sheetB, uid: 'introduced', name: '新增表' };
    const message = seedFrame({
      logEntries: [makeEntry({
        seq: 7,
        operations: [{ kind: 'data_replace', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB }, reason: 'system' }],
      })],
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toMatchObject({
      kind: 'sheet_full', sheetKey: 'sheet_new',
      timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 7 },
    });
  });
  it('既有表的 rebase 在目标 frame 尾部日志后写入 sheet_rebase timeline 且携带数据行', async () => {
    const rebasedSheet = {
      uid: 'inventory', name: '背包', orderNo: 0,
      content: [['row_id', '名称', '品质'], ['1', '铁剑', '']],
      sourceData: { ddl: 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  quality TEXT NOT NULL -- 品质\n);' },
      updateConfig: {}, exportConfig: {},
    } as any;
    const message = seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
      logEntries: [makeEntry({ seq: 7 })],
      perSheetCheckpoints: {},
    });
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'rebase', sheetKey: 'sheet_a', sheetData: rebasedSheet }],
      guideData: { sheet_a: { name: '背包' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints.sheet_a).toMatchObject({
      kind: 'sheet_full', sheetKey: 'sheet_a', reason: 'schema_change',
      timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 0, afterSeq: 7 },
    });
    expect(frame.perSheetCheckpoints.sheet_a.data.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', '']]);
  });

  it('rebase 目标表不存在于 active replay state 时拒绝', async () => {
    const rebasedSheet = {
      uid: 'ghost', name: '幽灵表', orderNo: 0,
      content: [['row_id', 'value']],
      sourceData: { ddl: 'CREATE TABLE ghost (row_id INTEGER PRIMARY KEY, value TEXT);' },
      updateConfig: {}, exportConfig: {},
    } as any;
    seedFrame({
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } },
      logEntries: [makeEntry({ seq: 7 })],
      perSheetCheckpoints: {},
    });
    mocks.loadReplayState.mockResolvedValue({ mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'rebase', sheetKey: 'sheet_ghost', sheetData: rebasedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(false);
    expect(String(result.error || '')).toContain('rebase');
  });



  it('历史 full checkpoint 后的正常增量 frame 继续走 V2 commit', async () => {
    const historicalMessage = seedFrame({ logEntries: [], perSheetCheckpoints: {} });
    const targetMessage = seedFrame({ checkpoint: undefined, logEntries: [], perSheetCheckpoints: {} });
    mocks.chat.splice(0, mocks.chat.length, historicalMessage, targetMessage);
    mocks.loadReplayState.mockResolvedValue(historicalMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    const introducedSheet = { ...sheetB, uid: 'incremental-after-checkpoint', name: 'checkpoint 后新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: 'checkpoint 后新增表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit' });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toMatchObject({
      kind: 'sheet_full',
      sheetKey: 'sheet_new',
      timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 1, afterSeq: 0 },
    });
  });

  it('全历史没有 full checkpoint 的 V2 frame 时 fail closed，不覆盖 orphan 状态', async () => {
    const message = seedFrame({ checkpoint: undefined, logEntries: [], perSheetCheckpoints: {} });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: 'orphan-v2-frame', name: '无根 V2 表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '无根 V2 表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('缺少 full checkpoint 的 V2 存储痕迹') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toBeUndefined();
  });

  it('既有 full checkpoint 或当前 shard 的 sheet 被标为新增时受控拒绝且零写入', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const headerOnlySheetA = { ...sheetA, content: [sheetA.content[0]] };
    const headerOnlySheetB = { ...sheetB, content: [sheetB.content[0]] };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'introduction', sheetKey: 'sheet_a', sheetData: headerOnlySheetA },
        { kind: 'introduction', sheetKey:'sheet_b', sheetData: headerOnlySheetB },
      ],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('active_introduction_conflict') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });

  it('模板结构提交在同一严格提交中收敛 provisional replay 基线并保留原 frame backup', async () => {
    const message = seedFrame({ logEntries: [] });
    const preCommitData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '收敛前值']] },
      sheet_b: sheetB,
    } as any;
    // 收敛必须能解析模板锚点；指纹与 repair 一致。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    const beforeFrame = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData[''].storageFrame));
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      baseKind: 'full_checkpoint',
      data: preCommitData,
      requiresCheckpointConvergence: true,
      compatibilityRepairs: [{
        kind: 'temporary_sheet_anchor',
        severity: 'provisional',
        sheetKey: 'sheet_a',
        messageIndex: 384,
        seq: 1,
        operationIndex: 0,
        templateFingerprint: fingerprint,
        reason: 'missing_at_operation',
      }],
    }).mockResolvedValue({ baseKind: 'full_checkpoint', data: preCommitData });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, messageIndex: 0 });
    const tagData = message.TavernDB_ACU_IsolatedData[''];
    // 收敛不再写第二个 full：根帧（此处即目标帧）checkpoint 保持既有 init full。
    expect(tagData.storageFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    // 锚点以 per-sheet checkpoint（sheet_full）落在根帧。
    expect(tagData.storageFrame.perSheetCheckpoints?.sheet_a).toMatchObject({ kind: 'sheet_full', reason: 'integrity_repair', sheetKey: 'sheet_a' });
    const { collectV2FullCheckpointIndices_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
    expect(tagData.recoveryBackup).toEqual(expect.objectContaining({
      recoveryKind: 'temporary_sheet_anchor_convergence',
      sourceMessageIndex: 0,
      storageFrame: beforeFrame,
    }));
    expect(tagData.storageFrame.logEntries).toHaveLength(1);
    expect(tagData.storageFrame.logEntries[0]).toMatchObject({
      seq: 1,
      operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
    });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.setGuide).toHaveBeenCalledOnce();
  });

  it('模板结构提交遇到 structural replay repair 时保持零写入', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      baseKind: 'full_checkpoint',
      data: message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data,
      requiresCheckpointConvergence: true,
      compatibilityRepairs: [{
        kind: 'temporary_sheet_anchor',
        sheetKey: 'sheet_a', messageIndex: 384, seq: 1, operationIndex: 0,
        templateFingerprint: 'test-fingerprint', reason: 'missing_at_operation',
      }],
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('结构性 replay repair') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });

  it('同一楼 hide 过的表重新引入时自动转 reveal，恢复隐藏前数据（切回多表模板不再报错）', async () => {
    // 复现：切多表模板（introduce）→ 切回默认（hide）→ 再切回多表模板。
    // hide checkpoint 的语义是“该表已不活跃”，不能被当成“仍活跃”而拒绝重新引入。
    const hiddenData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', content: [['row_id', 'value'], ['1', '隐藏前的数据']] };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_hidden',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 1 },
        },
      },
    });
    // active replay state 里该表不存在（已隐藏）。
    mocks.loadReplayState.mockResolvedValue(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_hidden', sheetData: hiddenData }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_hidden: { name: '主角装备表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const revived = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden;
    expect(revived?.timeline?.kind).toBe('sheet_reveal');
    expect(revived?.data?.content).toEqual([['row_id', 'value'], ['1', '隐藏前的数据']]);
  });

  it('provisional 收敛清空 shard 前捕获同楼隐藏表来源，并继续以 reveal 恢复', async () => {
    const hiddenData = {
      ...sheetB,
      uid: 'sheet_hidden_convergence',
      name: '收敛期间隐藏表',
      content: [['row_id', 'value'], ['1', '不可丢失的数据']],
    };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden_convergence: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_hidden_convergence',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
        },
      },
    });
    const activeData = message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    // 收敛需要可解析的模板锚点（repair.sheetKey=sheet_a），指纹与 repair 一致。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);

    mocks.loadReplayDetailed
      .mockResolvedValueOnce({
        baseKind: 'full_checkpoint',
        data: activeData,
        requiresCheckpointConvergence: true,
        compatibilityRepairs: [{
          kind: 'temporary_sheet_anchor', severity: 'provisional', sheetKey: 'sheet_a', messageIndex: 0,
          seq: 1, operationIndex: 0, templateFingerprint: fingerprint, reason: 'missing_at_operation',
        }],
      })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: activeData });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_hidden_convergence', sheetData: hiddenData }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_hidden_convergence: { name: '收敛期间隐藏表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden_convergence).toMatchObject({
      timeline: { kind: 'sheet_reveal' },
      data: { content: [['row_id', 'value'], ['1', '不可丢失的数据']] },
    });
  });

  it('无 hide timeline 的残留 sheet checkpoint 不算仍活跃，重新引入时唤醒历史数据', async () => {
    // 复现：表已经离开 active state（data_replace / 早期删除逻辑），但 perSheetCheckpoints
    // 里还留着一个没有 hide timeline 的 sheet checkpoint。
    // 这种痕迹不能被当成“仍活跃”，否则切回带该表的模板会被误报“重复引入”。
    const staleData = { ...sheetB, uid: 'sheet_stale', name: '主角装备表', content: [['row_id', 'value'], ['1', '离开前的数据']] };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_stale: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_stale',
          data: staleData,
          // 注意：没有 timeline，不是 hide 标记。
        },
      },
    });
    const activeState = message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    // active replay state 里该表始终不存在；bounded replay 也找不回可见状态，
    // 唤醒数据只能来自 perSheetCheckpoints 里那个无 timeline 的残留 checkpoint。
    mocks.loadReplayState.mockResolvedValue(activeState);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_stale', sheetData: staleData }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_stale: { name: '主角装备表' } },
      createdAt: 30,
    });

    expect(result.error).toBeUndefined();
    expect(result.saved).toBe(true);
    const revived = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_stale;
    expect(revived?.timeline?.kind).toBe('sheet_reveal');
    expect(revived?.data?.content).toEqual([['row_id', 'value'], ['1', '离开前的数据']]);
  });

  it('无关 sheet 的合法 hide timeline 不得把真正的新空表误判为历史表', async () => {
    const hiddenData = {
      ...sheetB,
      uid: 'sheet_hidden',
      name: '已隐藏表',
      content: [['row_id', 'value']],
    };
    const newSheet = {
      ...sheetB,
      uid: 'sheet_new',
      name: '真正新增的空表',
      content: [['row_id', 'value']],
    };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_hidden',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
        },
      },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: newSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '真正新增的空表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toMatchObject({
      timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 0, afterSeq: 0 },
      data: { content: [['row_id', 'value']] },
    });
  });

  it('无关 sheet checkpoint 畸形时，仍可将目标新表作为 introduction 写入', async () => {
    const newSheet = {
      ...sheetB,
      uid: 'sheet_new',
      name: '真正新增的空表',
      content: [['row_id', 'value']],
    };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_other: {
          kind: 'sheet_full', createdAt: 10, sheetKey: 'sheet_other', data: sheetB,
          // 缺少 reason：历史损坏，但明确属于无关 sheet，不能污染 sheet_new 的证据。
        },
      },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: newSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '真正新增的空表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toMatchObject({
      timeline: { kind: 'sheet_introduction', activateAtMessageIndex:0, afterSeq: 0 },
      data: { content: [['row_id', 'value']] },
    });
  });

  it('同一楼隐藏过的 header-only 表重新切回时恢复为 reveal，而非误报重复 introduction', async () => {
    const hiddenData = {
      ...sheetB,
      uid: 'sheet_empty_switch',
      name: '模板 A 独有空表',
      content: [['row_id', 'value']],
    };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_empty_switch: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_empty_switch',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
        },
      },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_empty_switch', sheetData: hiddenData }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_empty_switch: { name: '模板 A 独有空表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_empty_switch).toMatchObject({
      timeline: { kind: 'sheet_reveal', activateAtMessageIndex: 0, afterSeq: 0 },
      data: { content: [['row_id', 'value']] },
    });
  });




  it('replay state 已存在同名 sheet 但 target frame 无 shard 时拒绝 introduction 且零写入', async () => {
    const message = seedFrame({ logEntries: [], perSheetCheckpoints: {} });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: 'replayed-sheet', name: '历史已存在表' };
    mocks.loadReplayState.mockResolvedValue({
      ...message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data,
      sheet_new: introducedSheet,
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '历史已存在表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('active_introduction_conflict') });
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', { maxMessageIndex: 0, updateRuntimeState: false });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });

  it('历史 full checkpoint 曾存在且后续 data_replace 删除同名 sheet 时拒绝 introduction 且零写入', async () => {
    const historicalSheet = { ...sheetB, uid: 'historical-sheet', name: '已删除历史表' };
    const historicalMessage = seedFrame({
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, sheet_new: historicalSheet },
      },
      logEntries: [],
      perSheetCheckpoints: {},
    });
    const targetMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 2, reason: 'system',
              data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
            },
            logEntries: [makeEntry({
              operations: [{ kind: 'data_replace', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB }, reason: 'system' }],
            })],
            perSheetCheckpoints: {},
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, historicalMessage, targetMessage);
    mocks.loadReplayState.mockResolvedValue(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    const originalIsolatedData = targetMessage.TavernDB_ACU_IsolatedData;

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: historicalSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '已删除历史表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('reveal_source_missing') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(targetMessage.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toBeUndefined();
  });
  it('历史存在但 bounded replay 全部失败时按 reveal_source_indeterminate 零写入', async () => {
    const historicalSheet = { ...sheetB, uid: 'historical-sheet', name: '损坏回放历史表' };
    const historicalMessage = seedFrame({
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, sheet_new: historicalSheet },
      },
      logEntries: [],
      perSheetCheckpoints: {},
    });
    const targetMessage = seedFrame({ logEntries: [], perSheetCheckpoints: {} });
    mocks.chat.splice(0, mocks.chat.length, historicalMessage, targetMessage);
    const activeData = targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    mocks.loadReplayState.mockResolvedValue(activeData);
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: activeData })
      .mockRejectedValue(new Error('replay corruption'));
    const originalIsolatedData = targetMessage.TavernDB_ACU_IsolatedData;

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: historicalSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '损坏回放历史表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('reveal_source_indeterminate') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(targetMessage.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });


  // [表级隐藏/reveal 语义1] 阶段一红测试：当前 introduction 死结的目标行为。
  // 场景同上（历史 full checkpoint 含 sheet_new 数据、active 已无），但按语义1，
  // 重新引入应走 reveal 恢复“离开时最新状态”，而非拒绝。阶段三实现后转绿。
  it('[reveal-语义1] 历史含同名 sheet 且 active 已无时，reveal 恢复离开时数据而非拒绝', async () => {
    const historicalSheetWithData = {
      ...sheetB,
      uid: 'historical-sheet',
      name: '重要NPC表',
      content: [['row_id', 'value'], ['1', '离开B时的数据']],
    };
    const historicalMessage = seedFrame({
      checkpoint: {
        kind: 'full', createdAt: 1, reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, sheet_new: historicalSheetWithData },
      },
      logEntries: [],
      perSheetCheckpoints: {},
    });
    const targetMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 2, reason: 'system',
              data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
            },
            logEntries: [makeEntry({
              operations: [{ kind: 'data_replace', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB }, reason: 'system' }],
            })],
            perSheetCheckpoints: {},
          },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, historicalMessage, targetMessage);
    mocks.loadReplayState.mockResolvedValue(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'reveal', sheetKey: 'sheet_new', sheetData: historicalSheetWithData } as any],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '重要NPC表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const revealCheckpoint = targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints?.sheet_new;
    expect(revealCheckpoint?.timeline?.kind).toBe('sheet_reveal');
    expect(revealCheckpoint?.data?.content).toEqual([['row_id', 'value'], ['1', '离开B时的数据']]);
  });


  it('模板自带数据的新 sheet 作为 introduction 直接连数据落 checkpoint', async () => {
    // 作者在模板里自带初始数据 = 明确的格式意图，引入时即写入 checkpoint；
    // 落盘后该表已非空，后续填表不会再对它重复插入同一批 row_id。
    const message = seedFrame({ logEntries: [] });
    const sheetWithDataRow = { ...sheetB, uid: 'sheet_new', name: '含数据新表', content: [['row_id', 'value'], ['1', '业务数据']] };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: sheetWithDataRow }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '含数据新表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const introduced = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new;
    expect(introduced?.timeline?.kind).toBe('sheet_introduction');
    expect(introduced?.data?.content).toEqual([['row_id', 'value'], ['1', '业务数据']]);
  });

  it('无数据的新 sheet 仍以 header-only 空壳引入（保留首次填表前可改结构）', async () => {
    const message = seedFrame({ logEntries: [] });
    const headerOnlySheet = { ...sheetB, uid: 'sheet_new', name: '空壳新表', content: [['row_id', 'value']] };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: headerOnlySheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '空壳新表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const introduced = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new;
    expect(introduced?.data?.content).toEqual([['row_id', 'value']]);
  });

  it.each([
    ['伪造 sheetKey 的全局 sql_batch', { kind: 'sql_batch', sheetKey: 'sheet_other', statements: ['UPDATE any_table SET value = 1'] }],
    ['伪造 sheetKey 的全局 table_edit_dsl', { kind: 'table_edit_dsl', sheetKey: 'sheet_other', text: '更新表格：任意表' }],
    ['伪造 sheetKey 的未知 operation', { kind: 'future_unknown_operation', sheetKey: 'sheet_other' }],
    ['目标 sheet 缺少 rowId 的单表 operation', { kind: 'row_delete', sheetKey: 'sheet_new' }],
  ])('无法证明安全的历史 %s 时拒绝 introduction 且零写入', async (_label, operation) => {
    const message = seedFrame({
      logEntries: [makeEntry({ operations: [operation] })],
      perSheetCheckpoints: {},
    });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: `unsafe-history-${_label}`, name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('history_indeterminate') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toBeUndefined();
  });

  it.each([
    ['logEntries 非数组', { logEntries: null }],
    ['perSheetCheckpoints 非对象', { logEntries: [], perSheetCheckpoints: [] }],
  ])('带 V2 标记的畸形历史 frame：%s 时拒绝 introduction 且零写入', async (_label, frameOverrides) => {
    const historicalMessage = seedFrame(frameOverrides);
    const targetMessage = seedFrame({ logEntries: [], perSheetCheckpoints: {} });
    mocks.chat.splice(0, mocks.chat.length, historicalMessage, targetMessage);
    mocks.loadReplayState.mockResolvedValue(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    const originalIsolatedData = targetMessage.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: `malformed-history-${_label}`, name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('history_indeterminate') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(targetMessage.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toBeUndefined();
  });

  it.each([
    ['缺少 createdAt 的 full checkpoint', { checkpoint: { kind: 'full', reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } } }, false],
    ['缺少 reason 的无关 sheet checkpoint', { perSheetCheckpoints: { sheet_other: { kind: 'sheet_full', sheetKey: 'sheet_other', createdAt: 1, data: sheetB } } }, true],
    ['V2 marker 与 frame version 不一致', { version: 1, logEntries: [] }, false],
    // entry envelope 字段（seq/entryId/createdAt/source/revision）与"目标表是否存在过"无因果关系：
    // 这里 operations 可遍历且唯一 operation 归属 sheet_other，足以证伪目标表 sheet_new 存在过。
    // 用无关字段畸形去否定目标表判定会让一条坏 entry 永久污染同 isolationKey 下所有表的 evidence。
    ['缺少 entry 必填字段但容器可遍历且 operation 归属无关表', { logEntries: [{ operations: [{ kind: 'row_delete', sheetKey: 'sheet_other', rowId: '1' }] }] }, true],
    ['空的无关 sheet_replace sheet', { logEntries: [makeEntry({ operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_other', sheet: {}, reason: 'system' }] })] }, true],
    ['空的无关 schema migration descriptor', { logEntries: [makeEntry({ operations: [{ kind: 'sheet_schema_migrate', sheetKey: 'sheet_other', contractVersion: 1, beforeSchemaDigest: 'before', targetSchemaDigest: 'after', beforeSchema: {}, targetSchema: {}, columnChanges: [], migrationPolicy: { destructiveChangeConfirmed: false } }] })] }, true],
    ['畸形全局 sql_sheet_batch', { logEntries: [makeEntry({ operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_other', statements: [123] }] })] }, false],
    ['畸形的无关 schema migration', { logEntries: [makeEntry({ operations: [{ kind: 'sheet_schema_migrate', sheetKey: 'sheet_other', contractVersion: 999 }] })] }, true],
    ['畸形的无关 row_upsert cells', { logEntries: [makeEntry({ operations: [{ kind: 'row_upsert', sheetKey: 'sheet_other', rowId: '1', cells: [1] }] })] }, true],
    ['未知 legacy patch', { logEntries: [makeEntry({ patches: [{ kind: 'future_unknown_patch', sheetKey: 'sheet_other' }] })] }, false],
  ])('不完整的历史 persisted contract：%s 时按目标相关性分类 introduction', async (_label, frameOverrides, shouldIntroduce) => {
    const historicalMessage = seedFrame(frameOverrides);
    const targetMessage = seedFrame({ logEntries: [], perSheetCheckpoints: {} });
    mocks.chat.splice(0, mocks.chat.length, historicalMessage, targetMessage);
    mocks.loadReplayState.mockResolvedValue(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    const originalIsolatedData = targetMessage.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: `incomplete-contract-${_label}`, name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    if (shouldIntroduce) {
      expect(result).toMatchObject({ saved: true });
      expect(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toMatchObject({
        timeline: { kind: 'sheet_introduction' },
      });
    } else {
      expect(result).toMatchObject({ saved: false, error: expect.stringContaining('history_indeterminate') });
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
      expect(mocks.setGuide).not.toHaveBeenCalled();
      expect(targetMessage.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
      expect(targetMessage.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toBeUndefined();
    }
  });

  it.each([
    { label: '重复', entries: [makeEntry({ seq: 7 }), makeEntry({ seq: 7, entryId: 'entry-2' })], error: '唯一且严格递增' },
    { label: '倒序', entries: [makeEntry({ seq: 8 }), makeEntry({ seq: 7, entryId: 'entry-2' })], error: '唯一且严格递增' },
    { label: '非法', entries: [makeEntry({ seq: -1 })], error: '非法 log seq' },
  ])('目标 frame log seq $label 时拒绝 introduction 且零写入', async ({ entries, error }) => {
    const message = seedFrame({ logEntries: entries });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: `introduced-${entries[0].seq}`, name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining(error) });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });

  it('别表合法 sql_sheet_batch 归属明确时可证伪目标表，不阻碍 introduction', async () => {
    // 阶段 1 修复：sql_sheet_batch 的 sheetKey 是完整影响面，别表合法写入
    // 不得把同 isolationKey 下目标表的 evidence 永久变成 indeterminate。
    const message = seedFrame({
      logEntries: [makeEntry({ operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_other', statements: ['UPDATE other_table SET value = ?'], params: [['v']] }] })],
    });
    const introducedSheet = { ...sheetB, uid: 'introduced-after-other-batch', name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_new).toMatchObject({
      timeline: { kind: 'sheet_introduction' },
    });
  });

  it('本表合法 sql_sheet_batch 判定 present（表已存在），重复 introduction 被拒绝且零写入', async () => {
    const message = seedFrame({
      logEntries: [makeEntry({ operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_new', statements: ['INSERT INTO new_table (value) VALUES (?)'], params: [['v']] }] })],
    });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: 'introduced-with-own-batch', name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    // present 语义 = 目标表在历史中存在：无可信恢复来源时 fail-closed（reveal_source_missing），
    // 证明本表 sql_sheet_batch 被正确识别为 present，而不是被误判为 absent/indeterminate。
    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('reveal_source_missing') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });

  it('本表 sql_sheet_batch statements 非数组时保持 indeterminate（分支 5 fail-closed）', async () => {
    const message = seedFrame({
      logEntries: [makeEntry({ operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_new', statements: 'not-an-array' }] })],
    });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const introducedSheet = { ...sheetB, uid: 'introduced-with-malformed-batch', name: '新增表' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_new', sheetData: introducedSheet }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_new: { name: '新增表' } },
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('history_indeterminate') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });


  it.each([
    ['空 operations', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [] }]],
    ['operation sheetKey 不一致', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_b', meta: { name: 'A' } }] }]],
    ['非法 operation kind', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'x'] }] }]],
    ['meta_update meta 不是普通对象', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: [] }] }]],
    ['meta_update meta 是 Date', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: new Date(0) }] }]],
    ['meta_update meta 是 class instance', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: new (class MetaPatch { name = 'A'; })() }] }]],
    ['meta_update sourceData 不是普通对象', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { sourceData: [] } }] }]],
    ['meta_update sourceData 是 Map', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { sourceData: new Map() } }] }]],
    ['meta_update updateConfig 是 Set', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { updateConfig: new Set() } }] }]],
    ['meta_update 包含非法字段', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { content: [] } }] }]],
    ['meta_update name 类型错误', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 1 } }] }]],
    ['重复 action', [
      { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
      { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { orderNo: 1 } }] },
    ]],
    ['meta_update 携带 ddl', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { sourceData: { ddl: 'unsafe' } } }] }]],
    ['畸形 migration', [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'sheet_schema_migrate', sheetKey: 'sheet_a', contractVersion: 999 }] }]],
  ])('%s 时在事务写入前 fail closed', async (_label, sheetChanges) => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: sheetChanges as any,
      guideData: { sheet_a: { name: 'A' } },
    });

    expect(result.saved).toBe(false);
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
  });

  it('operation 合法时不以 targetSheetData 全量快照否决模板提交', async () => {
    const message = seedFrame({ logEntries: [] });
    const mismatchedTarget = { ...sheetA, name: '目标名称' };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: mismatchedTarget,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '另一个名称' } }],
      }],
      guideData: { sheet_a: { name: '另一个名称' }, sheet_b: { name: 'B' } },
    });

    expect(result.saved).toBe(true);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.logEntries[frame.logEntries.length - 1]).toMatchObject({
      operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: '另一个名称' } }],
    });
  });

  it('严格保存失败时回滚 introduction shard、operation entry、headRevision、identity、guide 与 scope', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const originalFrame = JSON.parse(JSON.stringify(originalIsolatedData[''].storageFrame));
    message.TavernDB_ACU_Identity = 'old-identity';
    const originalScope = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const originalGuide = JSON.parse(JSON.stringify(mocks.guideContainer));
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.setGuide.mockImplementation(() => {
      mocks.scopeContainer.template[''].changed = true;
      mocks.guideContainer.tags[''].changed = true;
      return true;
    });
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'introduction', sheetKey: 'sheet_new', sheetData: { ...sheetB, uid: 'new-sheet', name: '新增表' } },
        { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
      ],
      guideData: { sheet_a: { name: 'A' } },
      syncTemplateScope: true,
    });

    expect(result).toEqual({ saved: false, error: 'host save failed' });
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(originalFrame);
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
    expect(mocks.scopeContainer).toEqual(originalScope);
    expect(mocks.guideContainer).toEqual(originalGuide);
  });

  it('提交与回滚宿主保存均失败时组合两个错误并恢复模板提交内存状态', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const originalFrame = JSON.parse(JSON.stringify(originalIsolatedData[''].storageFrame));
    message.TavernDB_ACU_Identity = 'old-identity';
    const originalScope = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const originalGuide = JSON.parse(JSON.stringify(mocks.guideContainer));
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.setGuide.mockImplementation(() => {
      mocks.scopeContainer.template[''].changed = true;
      mocks.guideContainer.tags[''].changed = true;
      return true;
    });
    mocks.saveChatStrict
      .mockRejectedValueOnce(new Error('commit save failed'))
      .mockRejectedValueOnce(new Error('rollback save failed'));

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'introduction', sheetKey: 'sheet_new', sheetData: { ...sheetB, uid: 'new-sheet', name: '新增表' } },
        { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
      ],
      guideData: { sheet_a: { name: 'A' } },
      syncTemplateScope: true,
    });

    expect(result.saved).toBe(false);
    expect(result.error).toContain('commit save failed');
    expect(result.error).toContain('rollback save failed');
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(originalFrame);
    expect(message.TavernDB_ACU_Identity).toBe('old-identity');
    expect(mocks.scopeContainer).toEqual(originalScope);
    expect(mocks.guideContainer).toEqual(originalGuide);
  });

  it('仅删表时在一次严格保存内清理全聊天 V2、全部隔离槽和 legacy 数据', async () => {
    const historical = seedFrame({ logEntries: [makeEntry({ operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_b', sheet: sheetB, reason: 'system' }] })] });
    historical.TavernDB_ACU_IsolatedData.archive = {
      _acu_storage_version: 2,
      storageFrame: JSON.parse(JSON.stringify(historical.TavernDB_ACU_IsolatedData[''].storageFrame)),
      independentData: { sheet_b: { archived: true } },
      modifiedKeys: ['sheet_b'],
      updateGroupKeys: ['sheet_b'],
    };
    historical.TavernDB_ACU_IndependentData = { sheet_b: { legacy: true } };
    historical.TavernDB_ACU_Data = { sheet_b: { legacy: true } };
    historical.TavernDB_ACU_SummaryData = { sheet_b: { legacy: true } };
    historical.TavernDB_ACU_ModifiedKeys = ['sheet_b'];
    historical.TavernDB_ACU_UpdateGroupKeys = ['sheet_b'];
    const target = seedFrame({ logEntries: [] });
    mocks.chat.splice(0, mocks.chat.length, historical, target);
    mocks.loadReplayState.mockResolvedValue(target.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint', data: { mate: { type: 'acu' }, sheet_a: sheetA },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '', sheetChanges: [], deletedSheetKeys: ['sheet_b'], guideData: { sheet_a: { name: 'A' } }, createdAt: 30,
    });

    expect(result).toMatchObject({ saved: true, mode: 'v2_commit', deletedSheetKeys: ['sheet_b'], purgedMessageCount: 2, checkpoints: [], hardDeleteCheckpointCreated: true });
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(1);
    for (const tagData of Object.values(historical.TavernDB_ACU_IsolatedData) as any[]) {
      expect(tagData.independentData?.sheet_b).toBeUndefined();
      expect(tagData.storageFrame.checkpoint.data.sheet_b).toBeUndefined();
      expect(tagData.storageFrame.perSheetCheckpoints.sheet_b).toBeUndefined();
    }
    expect(historical.TavernDB_ACU_IndependentData).toBeUndefined();
    expect(historical.TavernDB_ACU_Data).toBeUndefined();
    expect(historical.TavernDB_ACU_SummaryData).toBeUndefined();
    expect(historical.TavernDB_ACU_ModifiedKeys).toEqual([]);
    expect(historical.TavernDB_ACU_UpdateGroupKeys).toEqual([]);
    expect(target.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_b).toBeUndefined();
    expect(target.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    expect(target.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints).toBeUndefined();
  });

  it('删除 key 与模板变更 key 冲突时在事务前拒绝', async () => {
    const message = seedFrame({ logEntries: [] });
    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '', deletedSheetKeys: ['sheet_a'],
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] }],
      guideData: { sheet_a: { name: 'A' } },
    });
    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('同时删除和变更') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_a).toEqual(sheetA);
  });

  it('删表严格保存失败时恢复跨消息历史字段、guide 与 scope', async () => {
    const historical = seedFrame({ logEntries: [] });
    historical.TavernDB_ACU_Data = { sheet_b: { legacy: true } };
    const target = seedFrame({ logEntries: [] });
    mocks.chat.splice(0, mocks.chat.length, historical, target);
    mocks.loadReplayState.mockResolvedValue(target.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint', data: { mate: { type: 'acu' }, sheet_a: sheetA },
    });
    const beforeHistorical = JSON.parse(JSON.stringify(historical));
    const beforeTarget = JSON.parse(JSON.stringify(target));
    const beforeScope = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const beforeGuide = JSON.parse(JSON.stringify(mocks.guideContainer));
    mocks.setGuide.mockImplementation(() => {
      mocks.scopeContainer.template[''].changed = true;
      mocks.guideContainer.tags[''].changed = true;
      return true;
    });
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '', sheetChanges: [], deletedSheetKeys: ['sheet_b'], guideData: { sheet_a: { name: 'A' } }, createdAt: 30,
    });

    expect(result).toEqual({ saved: false, error: 'host save failed' });
    expect(mocks.saveChatStrict).toHaveBeenCalledTimes(2);
    expect(historical).toEqual(beforeHistorical);
    expect(target).toEqual(beforeTarget);
    expect(mocks.scopeContainer).toEqual(beforeScope);
    expect(mocks.guideContainer).toEqual(beforeGuide);
  });


  it('最新 AI 楼层不是 V2 frame 时拒绝提交，不隐式迁移或修改 guide/scope', async () => {
    const anchor = seedFrame({ logEntries: [] });
    const legacyTarget = { is_user: false, TavernDB_ACU_IndependentData: { sheet_a: { legacy: true } } };
    mocks.chat.splice(0, mocks.chat.length, anchor, legacyTarget);
    const originalScope = JSON.parse(JSON.stringify(mocks.scopeContainer));
    const originalGuide = JSON.parse(JSON.stringify(mocks.guideContainer));

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] }],
      guideData: { sheet_a: { name: 'A' } },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('legacy 持久化数据') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.scopeContainer).toEqual(originalScope);
    expect(mocks.guideContainer).toEqual(originalGuide);
    expect(legacyTarget.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(legacyTarget.TavernDB_ACU_Identity).toBeUndefined();
    expect(anchor.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
  });

  it('拒绝非最新 AI 楼层且不保存', async () => {
    seedFrame({ logEntries: [] });
    mocks.chat.push({ is_user: false });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      targetMessageIndex: 0,
      sheetChanges: [{ kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] }],
      guideData: { sheet_a: { name: 'A' } },
    });

    expect(result.saved).toBe(false);
    expect(result.error).toContain('最新 AI 楼层');
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('任一 shard 的 DDL 无法 strict hydrate 时拒绝整批提交且不写 guide', async () => {
    const message = seedFrame({ logEntries: [] });
    const originalIsolatedData = message.TavernDB_ACU_IsolatedData;
    const invalidSheet = {
      ...sheetB,
      sourceData: { ddl: 'CREATE TABLE sheet_b ( value TEXT );' },
    };

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [
        { kind: 'operations', sheetKey: 'sheet_a', targetSheetData: sheetA, operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
        { kind: 'operations', sheetKey: 'sheet_b', targetSheetData: invalidSheet, operations: [{ kind: 'meta_update', sheetKey: 'sheet_b', meta: { name: 'B' } }] },
      ],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
    });

    expect(result.saved).toBe(false);
    expect(result.error).toContain('DDL 无法 strict hydrate');
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toBe(originalIsolatedData);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a).toBeUndefined();
  });

  it('[阶段7] hide checkpoint 存在时 reveal 直接从 hide 数据恢复，不再逐边界 bounded replay', async () => {
    const hiddenData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', content: [['row_id', 'value'], ['1', '隐藏前的数据']] };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_hidden',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 1 },
        },
      },
    });
    const activeData = message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: activeData })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: activeData });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'introduction', sheetKey: 'sheet_hidden', sheetData: hiddenData }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' }, sheet_hidden: { name: '主角装备表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const revived = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden;
    expect(revived?.timeline?.kind).toBe('sheet_reveal');
    expect(revived?.data?.content).toEqual([['row_id', 'value'], ['1', '隐藏前的数据']]);
    // 只有 activeReplay 一次 detailed replay；reveal 数据来自 hide checkpoint，不触发逐边界回退。
    expect(mocks.loadReplayDetailed).toHaveBeenCalledTimes(1);
  });

  it('[阶段7] hide 直接取 active replay state 的当前数据，不触发逐边界 bounded replay', async () => {
    const sheetToHide = { ...sheetA, uid: 'sheet_a', name: '表A', content: [['row_id', 'value'], ['1', 'active-data']] };
    const message = seedFrame({ logEntries: [] });
    // activeReplayState 含该表（hide 的目标是当前可见表）。
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { sheet_a: sheetToHide, mate: { type: 'acu', version: 1 } },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'hide', sheetKey: 'sheet_a', sheetData: sheetToHide }],
      guideData: { sheet_a: { name: '表A' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const hidden = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a;
    expect(hidden?.timeline?.kind).toBe('sheet_hide');
    expect(hidden?.data?.content).toEqual([['row_id', 'value'], ['1', 'active-data']]);
    // hide 数据来自 activeReplayState（已加载），不再为 hide 单独逐边界回退。
    expect(mocks.loadReplayDetailed).toHaveBeenCalledTimes(1);
  });

  it('[S3-4] hide checkpoint 前向记录 hideSourcePresetName（休眠溯源）', async () => {
    const sheetToHide = { ...sheetA, uid: 'sheet_a', name: '表A', content: [['row_id', 'value'], ['1', 'active-data']] };
    const message = seedFrame({ logEntries: [] });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { sheet_a: sheetToHide, mate: { type: 'acu', version: 1 } },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'hide', sheetKey: 'sheet_a', sheetData: sheetToHide }],
      guideData: { sheet_a: { name: '表A' } },
      hideSourcePresetName: '切换前预设',
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const hidden = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a;
    expect(hidden?.timeline?.kind).toBe('sheet_hide');
    expect(hidden?.hideSourcePresetName).toBe('切换前预设');
  });

  it('[S3-4] 未提供 hideSourcePresetName（或空白）时 hide checkpoint 不写该字段', async () => {
    const sheetToHide = { ...sheetA, uid: 'sheet_a', name: '表A', content: [['row_id', 'value'], ['1', 'active-data']] };
    const message = seedFrame({ logEntries: [] });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { sheet_a: sheetToHide, mate: { type: 'acu', version: 1 } },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'hide', sheetKey: 'sheet_a', sheetData: sheetToHide }],
      guideData: { sheet_a: { name: '表A' } },
      hideSourcePresetName: '   ',
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const hidden = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_a;
    expect(hidden?.timeline?.kind).toBe('sheet_hide');
    expect('hideSourcePresetName' in (hidden || {})).toBe(false);
  });

  it('[阶段7] 显式 reveal 恢复 hide 前最后可信数据，不被 caller 模板空壳覆盖', async () => {
    const hiddenData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', content: [['row_id', 'value'], ['1', '历史数据行'], ['2', '另一行']] };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_hidden',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 1 },
        },
      },
    });
    const activeData = message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: activeData })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: activeData });

    // 协调器侧：hidden 表重新进入模板，模板表本身不带数据 → asIntroducedSheet_ACU 产出 header-only 空壳。
    const shellData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', content: [['row_id', 'value']] };
    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'reveal', sheetKey: 'sheet_hidden', sheetData: shellData }],
      guideData: { sheet_hidden: { name: '主角装备表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const revived = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden;
    expect(revived?.timeline?.kind).toBe('sheet_reveal');
    // 恢复的是 hide 前最后可信数据，而不是模板空壳。
    expect(revived?.data?.content).toEqual([['row_id', 'value'], ['1', '历史数据行'], ['2', '另一行']]);
  });

  it('[阶段7] 显式 reveal 无历史 hide checkpoint 时退回 bounded replay 恢复数据', async () => {
    const hiddenData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', content: [['row_id', 'value'], ['1', '历史数据行']] };
    const message = seedFrame({ logEntries: [] });
    const activeData = message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    // 无 perSheetCheckpoints.sheet_hidden（旧历史），loadReplayDetailed 在 bounded replay 中
    // 返回包含该表的完整 state → 恢复历史数据。
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: activeData })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: { mate: { type: 'acu' }, sheet_hidden: hiddenData } });

    const shellData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', content: [['row_id', 'value']] };
    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'reveal', sheetKey: 'sheet_hidden', sheetData: shellData }],
      guideData: { sheet_hidden: { name: '主角装备表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const revived = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden;
    expect(revived?.timeline?.kind).toBe('sheet_reveal');
    expect(revived?.data?.content).toEqual([['row_id', 'value'], ['1', '历史数据行']]);
  });

  it('reveal 后列级再协调（S1-4）：休眠期模板演进时补新列、模板缺失列进入列级休眠', async () => {
    // hide 时表结构为 [title, legacy]；休眠期间模板演进为 [title, priority]。
    const hiddenData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', sourceData: {}, content: [['row_id', 'title', 'legacy'], ['1', '找线索', '旧值']] };
    const message = seedFrame({
      logEntries: [],
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full', createdAt: 10, reason: 'schema_change', sheetKey: 'sheet_hidden',
          data: hiddenData,
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 1 },
        },
      },
    });
    const activeData = message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: activeData })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: activeData });

    const shellData = { ...sheetB, uid: 'sheet_hidden', name: '主角装备表', sourceData: {}, content: [['row_id', 'title', 'priority']] };
    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{ kind: 'reveal', sheetKey: 'sheet_hidden', sheetData: shellData }],
      guideData: { sheet_hidden: { name: '主角装备表' } },
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const revived = message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden;
    expect(revived?.timeline?.kind).toBe('sheet_reveal');
    // 匹配列（title）继承数据；模板新增列（priority，nullable）null 填充；
    // 模板缺失列（legacy）保留为尾部隐藏列，数据不删。
    expect(revived?.data?.content).toEqual([['row_id', 'title', 'priority', 'legacy'], ['1', '找线索', null, '旧值']]);
    expect(revived?.data?.sourceData?.hiddenPhysicalColumns).toHaveLength(1);
  });


});


describe('persistTableMutationLogBatchV2_ACU', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.loadReplayState.mockReset();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
  });

  function appendableFrame(): any {
    return {
      version: 2,
      headRevision: '1:existing',
      logEntries: [],
    };
  }

  function makeBatchOptions(afterData: any, targets: any[]) {
    return {
      source: 'manual_crud' as const,
      afterData,
      targets,
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    };
  }

  it('在不同消息层追加 scoped row operation 后只严格保存一次', async () => {
    const checkpointMessage = seedFrame({ logEntries: [] });
    const laterMessage = { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: appendableFrame() } } };
    mocks.chat.splice(0, mocks.chat.length, checkpointMessage, laterMessage);
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'updated']] },
      sheet_b: { ...sheetB, content: [['row_id', 'value'], ['2', 'inserted']] },
    };

    const result = await persistTableMutationLogBatchV2_ACU(makeBatchOptions(afterData, [
      { targetMessageIndex: 0, changedSheetKeys: ['sheet_a'], operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'updated'] }] },
      { targetMessageIndex: 1, changedSheetKeys: ['sheet_b'], operations: [{ kind: 'row_upsert', sheetKey: 'sheet_b', rowId: '2', cells: ['2', 'inserted'] }] },
    ]));

    expect(result).toMatchObject({ saved: true, messageIndices: [0, 1] });
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', {
      maxMessageIndex: 0,
      updateRuntimeState: false,
    });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
    expect(mocks.saveChat).not.toHaveBeenCalled();
    expect(checkpointMessage.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(laterMessage.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
  });

  it('batch provisional 补锚以最早目标的操作前状态收敛，验证边界与完整 suffix 后再保存', async () => {
    const first = seedFrame({ logEntries: [] });
    const second = { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: appendableFrame() } } };
    mocks.chat.splice(0, mocks.chat.length, first, second);
    const preWriteData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', '收敛前值']] },
      sheet_b: sheetB,
    } as any;
    // 收敛需要可解析的模板锚点，指纹与 repair 一致。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    const beforeFrame = JSON.parse(JSON.stringify(first.TavernDB_ACU_IsolatedData[''].storageFrame));
    const provisionalRepair = {
      kind: 'temporary_sheet_anchor' as const,
      severity: 'provisional' as const,
      sheetKey: 'sheet_a', messageIndex: 0, seq: 1, operationIndex: 0,
      templateFingerprint: fingerprint, reason: 'missing_at_operation' as const,
    };
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({ baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true, compatibilityRepairs: [provisionalRepair] })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: preWriteData });
    const afterData = {
      ...preWriteData,
      sheet_a: { ...preWriteData.sheet_a, content: [['row_id', 'value'], ['1', '最早目标写入']] },
      sheet_b: { ...sheetB, content: [['row_id', 'value'], ['2', '后续目标写入']] },
    };

    const result = await persistTableMutationLogBatchV2_ACU(makeBatchOptions(afterData, [
      { targetMessageIndex: 0, changedSheetKeys: ['sheet_a'], operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', '最早目标写入'] }] },
      { targetMessageIndex: 1, changedSheetKeys: ['sheet_b'], operations: [{ kind: 'row_upsert', sheetKey: 'sheet_b', rowId: '2', cells: ['2', '后续目标写入'] }] },
    ]));

    expect(result).toMatchObject({ saved: true, messageIndices: [0, 1] });
    const firstTagData = first.TavernDB_ACU_IsolatedData[''];
    // 收敛不再写第二个 full：根帧 checkpoint 保持既有 init full。
    expect(firstTagData.storageFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'init' });
    // 锚点以 per-sheet checkpoint（sheet_full）落在根帧。
    expect(firstTagData.storageFrame.perSheetCheckpoints?.sheet_a).toMatchObject({ kind: 'sheet_full', reason: 'integrity_repair', sheetKey: 'sheet_a' });
    const { collectV2FullCheckpointIndices_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
    expect(firstTagData.recoveryBackup).toEqual(expect.objectContaining({
      recoveryKind: 'temporary_sheet_anchor_convergence', sourceMessageIndex: 0, storageFrame: beforeFrame,
    }));
    expect(firstTagData.storageFrame.logEntries).toHaveLength(1);
    expect(firstTagData.storageFrame.logEntries[0].operations).toEqual([
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', '最早目标写入'] },
    ]);
    expect(second.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(second.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations).toEqual([
      { kind: 'row_upsert', sheetKey: 'sheet_b', rowId: '2', cells: ['2', '后续目标写入'] },
    ]);
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(expect.any(Array), '', expect.objectContaining({
      updateRuntimeState: false, compatibilityMode: 'disabled',
    }));
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(expect.any(Array), '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
  });

  it('batch provisional 收敛的严格保存失败时恢复所有 target 的 isolated data 与 identity', async () => {
    const first = seedFrame({ logEntries: [] });
    const second = { is_user: false, TavernDB_ACU_Identity: 'before-second', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: appendableFrame() } } };
    mocks.chat.splice(0, mocks.chat.length, first, second);
    const firstBefore = first.TavernDB_ACU_IsolatedData;
    const secondBefore = second.TavernDB_ACU_IsolatedData;
    const preWriteData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any;
    // 收敛必须能解析模板锚点；指纹与 repair 一致，收敛成功后才进入 strict save。
    mocks.templateObj = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value']] } } as any;
    const { resolveHeaderOnlyTemplateSnapshot_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');
    const { getTableDataFingerprint_ACU } = await import('../../../src/service/table/table-data-upgrade-audit');
    const resolvedTemplate = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, '');
    expect(resolvedTemplate).toBeTruthy();
    const fingerprint = getTableDataFingerprint_ACU(resolvedTemplate);
    mocks.loadReplayDetailed
      .mockResolvedValueOnce({
        baseKind: 'full_checkpoint', data: preWriteData, requiresCheckpointConvergence: true,
        compatibilityRepairs: [{ kind: 'temporary_sheet_anchor', severity: 'provisional', sheetKey: 'sheet_a', messageIndex: 0, seq: 1, operationIndex: 0, templateFingerprint: fingerprint, reason: 'missing_at_operation' }],
      })
      .mockResolvedValue({ baseKind: 'full_checkpoint', data: preWriteData });
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(persistTableMutationLogBatchV2_ACU(makeBatchOptions(preWriteData, [
      { targetMessageIndex: 0, changedSheetKeys: ['sheet_a'], operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
      { targetMessageIndex: 1, changedSheetKeys: ['sheet_b'], operations: [{ kind: 'meta_update', sheetKey: 'sheet_b', meta: { name: 'B' } }] },
    ]))).rejects.toThrow('host save failed');

    expect(first.TavernDB_ACU_IsolatedData).toBe(firstBefore);
    expect(second.TavernDB_ACU_IsolatedData).toBe(secondBefore);
    expect(second.TavernDB_ACU_Identity).toBe('before-second');
  });

  it('candidate 与 afterData 分叉时仍保存 batch（不再做 afterData 相等性阻断）', async () => {
    const message = seedFrame({ logEntries: [] });
    // afterData 与 operation 故意分叉：operation 写 'from-operation'，afterData 却声明 'from-after-data'
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'from-after-data']] },
      sheet_b: sheetB,
    };

    const result = await persistTableMutationLogBatchV2_ACU(makeBatchOptions(afterData, [
      {
        targetMessageIndex: 0,
        changedSheetKeys: ['sheet_a'],
        operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'from-operation'] }],
      },
    ]));

    expect(result).toMatchObject({ saved: true, messageIndices: [0] });
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', {
      maxMessageIndex: 0,
      updateRuntimeState: false,
    });
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toHaveLength(1);
    expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations).toEqual([
      { kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'from-operation'] },
    ]);
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
  });

  it('afterData 携带 runtime-only 字段（seedRows）时 batch 仍可保存', async () => {
    const message = seedFrame({ logEntries: [] });
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'updated']], seedRows: [['1', 'seed']] },
      sheet_b: sheetB,
    };

    const result = await persistTableMutationLogBatchV2_ACU(makeBatchOptions(afterData, [
      { targetMessageIndex: 0, changedSheetKeys: ['sheet_a'], operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'updated'] }] },
    ]));

    expect(result).toMatchObject({ saved: true, messageIndices: [0] });
    expect(mocks.loadReplayDetailed).toHaveBeenCalledWith(mocks.chat, '', {
      maxMessageIndex: 0,
      updateRuntimeState: false,
    });
    expect(mocks.saveChatStrict).toHaveBeenCalledOnce();
  });

  it('严格宿主保存失败时恢复所有 target 的 isolated data 与 identity', async () => {
    const first = seedFrame({ logEntries: [] });
    const second = { is_user: false, TavernDB_ACU_Identity: 'before-second', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: appendableFrame() } } };
    mocks.chat.splice(0, mocks.chat.length, first, second);
    const firstBefore = first.TavernDB_ACU_IsolatedData;
    const secondBefore = second.TavernDB_ACU_IsolatedData;
    const afterData = { mate: { type: 'acu' }, sheet_a: { ...sheetA, content: [['row_id', 'value'], ['1', 'updated']] }, sheet_b: sheetB };
    mocks.settings.dataIsolationEnabled = true;
    mocks.settings.dataIsolationCode = 'new-identity';
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save failed'));

    await expect(persistTableMutationLogBatchV2_ACU(makeBatchOptions(afterData, [
      { targetMessageIndex: 0, changedSheetKeys: ['sheet_a'], operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'updated'] }] },
      { targetMessageIndex: 1, changedSheetKeys: ['sheet_a'], operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }] },
    ]))).rejects.toThrow('host save failed');

    expect(first.TavernDB_ACU_IsolatedData).toBe(firstBefore);
    expect(second.TavernDB_ACU_IsolatedData).toBe(secondBefore);
    expect(second.TavernDB_ACU_Identity).toBe('before-second');
  });
});




// ═══════════════════════════════════════════════════════════════════════════
// [阶段0红测试] 统一表级可见性生命周期 + operation 契约
// 复现场景：目标表历史只存在于 log operation（manual_refill），
// active replay 已因模板 hide 移除该表。修复前：
//   persistTableMutationLogV2_ACU 补锚时调用 introductionHistoryEvidence_ACU
//   扫到 manual_refill operation → reason=目标相关 operation 无法验证
//   → history_indeterminate，第二次 runtime SQL 失败。
// ═══════════════════════════════════════════════════════════════════════════
describe('生命周期统一：隐藏表在连续 runtime SQL 中不触发历史补锚误阻断', () => {
  const targetKey = 'sheet_zhong_yao_jue_se_biao';
  let persistTableMutationLogV2_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['persistTableMutationLogV2_ACU'];
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.loadReplayState.mockReset();
    mocks.loadReplayDetailed.mockReset();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
  });
  beforeAll(async () => {
    ({ persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist'));
  });

  function makeTargetSheet(content: unknown[][] = [['row_id', 'value']]): any {
    return {
      uid: 'sheet_zhong_yao_jue_se_biao',
      name: '重要角色表',
      sourceData: {},
      content,
      updateConfig: {},
      exportConfig: {},
      orderNo: 1,
    };
  }

  function makeHistoryWithOperationOnly(operation: any): any {
    // 目标表只出现在历史 log operation 中；checkpoint 与 perSheetCheckpoints 均不含。
    // 这样 introductionHistoryEvidence_ACU 只能走到 operation 分支验证。
    return seedFrame({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      },
      logEntries: [
        makeEntry({
          seq: 1,
          source: 'manual_fill',
          operations: [operation],
        }),
      ],
      perSheetCheckpoints: {},
    });
  }

  it('目标表历史上仅以 manual_refill sql_sheet_batch 出现时，连续两次 runtime SQL 均成功且不报 history_indeterminate', async () => {
    const targetSheet = makeTargetSheet([['row_id', 'value'], ['1', '隐藏前数据']]);
    const message = makeHistoryWithOperationOnly({
      kind: 'sql_sheet_batch',
      sheetKey: targetKey,
      tableName: 'zhong_yao_jue_se_biao',
      statements: ["INSERT INTO zhong_yao_jue_se_biao (row_id, value) VALUES (1, 'hidden-data')"],
      reason: 'manual_refill',
    });
    // active replay state：目标表已被 hide 移出。
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    const afterData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, [targetKey]: targetSheet } as any;
    const operations = [{ kind: 'row_upsert', sheetKey: targetKey, rowId: '1', cells: ['1', '隐藏前数据'] }] as any;

    const first = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      operations,
      candidateChangedSheetKeys: [targetKey],
      filledSheetKeys: [targetKey],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });
    expect(first.error).toBeUndefined();
    expect(first.saved).toBe(true);

    const second = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData,
      operations,
      candidateChangedSheetKeys: [targetKey],
      filledSheetKeys: [targetKey],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });
    expect(second.error).toBeUndefined();
    expect(second.saved).toBe(true);
  });

  it('隐藏表在补锚路径被拒绝时（history_indeterminate），事务零副作用', async () => {
    // 保留原 fail-closed 语义：目标相关 operation 畸形时不得静默放行。
    const message = makeHistoryWithOperationOnly({
      kind: 'sql_sheet_batch',
      sheetKey: targetKey,
      tableName: 'zhong_yao_jue_se_biao',
      statements: 'not-an-array', // 畸形：历史证据无法验证
      reason: 'manual_refill',
    });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });
    const beforeIsolated = JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData));

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, [targetKey]: makeTargetSheet() } as any,
      operations: [{ kind: 'row_upsert', sheetKey: targetKey, rowId: '1', cells: ['1', 'x'] }] as any,
      candidateChangedSheetKeys: [targetKey],
      filledSheetKeys: [targetKey],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('history is indeterminate') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(message.TavernDB_ACU_IsolatedData).toEqual(beforeIsolated);
  });
});

describe('operation 契约：manual_refill reason 与共享 validator 对齐', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.loadReplayState.mockReset();
    mocks.loadReplayDetailed.mockReset();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
  });
  it('生产历史 manual_refill operation 在 history evidence 中可验证（兼容读取）', async () => {
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const message = seedFrame({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      },
      logEntries: [
        makeEntry({
          seq: 1,
          source: 'manual_fill',
          operations: [{
            kind: 'sql_sheet_batch',
            sheetKey: 'sheet_a',
            tableName: 'table_a',
            statements: ["INSERT INTO table_a (row_id, value) VALUES (1, 'committed')"],
            reason: 'manual_refill',
          }],
        }),
      ],
      perSheetCheckpoints: {},
    });

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } as any,
      operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1', 'x'] }] as any,
      candidateChangedSheetKeys: ['sheet_a'],
      filledSheetKeys: ['sheet_a'],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result).toMatchObject({ saved: true });
    expect(mocks.saveChat).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [阶段0-2 红测试] 证据缺口闭合前的基线
// A-1 全局 sql_batch 污染、A-2 无关 envelope 字段畸形污染、B-1 checkpoint
// 在旧楼层+最新 AI 楼层无 tagData、B-3 IsolatedData 为 string 时 classify
// 与 2772 结论相反。修复前必须稳定红灯；断言零副作用。
// ═══════════════════════════════════════════════════════════════════════════
describe('阶段0红测试：introduction history evidence 与模板提交 frame 作用域', () => {
  const targetKey = 'sheet_zhong_yao_jue_se_biao';
  const isolationKey = '';
  let persistTableMutationLogV2_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['persistTableMutationLogV2_ACU'];
  let commitCurrentFloorTemplateChanges_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['commitCurrentFloorTemplateChanges_ACU'];

  beforeAll(async () => {
    const mod = await import('../../../src/service/table/storage-frame-v2-persist');
    persistTableMutationLogV2_ACU = mod.persistTableMutationLogV2_ACU;
    commitCurrentFloorTemplateChanges_ACU = mod.commitCurrentFloorTemplateChanges_ACU;
  });

  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
    mocks.loadReplayState.mockReset();
    mocks.loadReplayDetailed.mockReset();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.setGuide.mockReset().mockImplementation(() => true);
    mocks.runCommit.mockReset().mockImplementation(async (task: () => any) => task());
    mocks.runTransaction.mockReset().mockImplementation(async (_options: any, task: any) => task({
      baseRevision: 'runtime-v1:test',
      assertFresh: vi.fn(),
      runCommit: mocks.runCommit,
    }));
    mocks.scopeContainer = { version: 1, template: { '': { old: true } } };
    mocks.guideContainer = { version: 1, tags: { '': { data: { sheet_old: {} } } } };
  });

  function makeTargetSheet(content: unknown[][] = [['row_id', 'value']]): any {
    return {
      uid: 'sheet_zhong_yao_jue_se_biao',
      name: '重要角色表',
      sourceData: {},
      content,
      updateConfig: {},
      exportConfig: {},
      orderNo: 1,
    };
  }

  function makeFrameWithGlobalSqlBatch(operation: any, entryOverrides: Record<string, any> = {}): any {
    // A-1：历史某条 entry 含一条合法全局 sql_batch（无 sheetKey），
    // 目标表仅以 sql_sheet_batch 出现于更晚楼层。
    return seedFrame({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      },
      logEntries: [
        makeEntry({
          seq: 1,
          source: 'raw_sql_batch',
          ...entryOverrides,
          operations: [operation],
        }),
      ],
      perSheetCheckpoints: {},
    });
  }

  it('A-1：历史含合法全局 sql_batch（无 sheetKey）不污染目标表 evidence，补锚成功', async () => {
    // 修复目标（阶段3）：scopedHistoryArtifactEvidence_ACU 对无 sheetKey 的
    // 全局 sql_batch 不应立即判 indeterminate；扫描继续，目标表无历史证据时
    // 应得 absent → 补锚走 sheet_introduction → saved: true。
    // 修复前（现状）：分支3 直接 indeterminate → 拒写 → 本测试红灯。
    const targetSheet = makeTargetSheet([['row_id', 'value'], ['1', '历史数据']]);
    const message = makeFrameWithGlobalSqlBatch({
      kind: 'sql_batch',
      statements: ["INSERT INTO unrelated_table (row_id, value) VALUES (1, 'global')"],
      reason: 'raw_sql_batch',
    });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, [targetKey]: targetSheet } as any,
      operations: [{ kind: 'row_upsert', sheetKey: targetKey, rowId: '1', cells: ['1', 'x'] }] as any,
      candidateChangedSheetKeys: [targetKey],
      filledSheetKeys: [targetKey],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result.saved).toBe(true);
    // 补锚成功。timeline kind 取 sheet_reveal：evidence 为 may_exist（历史只有
    // 归属未知的全局 sql_batch），按"可能存在过"标注，不宣称该表是全新表。
    // 两个 kind 在 replay 中数据应用与可见性判定完全等价
    // （storage-frame-v2-replay.ts:837-843 与 209），此处仅为生命周期标注。
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints[targetKey]).toMatchObject({
      kind: 'sheet_full',
      sheetKey: targetKey,
      timeline: { kind: 'sheet_reveal' },
    });
    expect(mocks.saveChat).toHaveBeenCalled();
  });

  it('A-2：无关 envelope 字段畸形（source 白名单外）不污染目标表 evidence，补锚成功', async () => {
    // 修复目标（阶段3）：logEntryIsValidForIntroductionHistory_ACU 降级为
    // 容器可遍历性校验，source 白名单移出判定；entry 可遍历且 operation
    // 触及目标表 → present → 补锚走 sheet_reveal → saved: true。
    // 修复前（现状）：source 白名单外 → 整条 entry indeterminate → 红灯。
    const targetSheet = makeTargetSheet([['row_id', 'value'], ['1', '历史数据']]);
    const message = makeFrameWithGlobalSqlBatch(
      { kind: 'row_upsert', sheetKey: targetKey, rowId: '1', cells: ['1', 'x'] },
      { source: 'unknown_source_contract' },
    );
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    const result = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB, [targetKey]: targetSheet } as any,
      operations: [{ kind: 'row_upsert', sheetKey: targetKey, rowId: '1', cells: ['1', 'x'] }] as any,
      candidateChangedSheetKeys: [targetKey],
      filledSheetKeys: [targetKey],
      transactionContext: makeTransaction(),
      assumeCommitLock: true,
    });

    expect(result.saved).toBe(true);
    // operation 触及目标表 → present → timeline 应为 sheet_reveal（历史曾存在）。
    const frame = message.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints[targetKey]).toMatchObject({
      kind: 'sheet_full',
      sheetKey: targetKey,
      timeline: { kind: 'sheet_reveal' },
    });
    expect(mocks.saveChat).toHaveBeenCalled();
  });

  it('B-1：checkpoint 在旧楼层、最新 AI 楼层无 tagData 时模板提交初始化空 frame 并成功', async () => {
    // 修复目标（阶段2）：目标楼层缺合法 V2 frame 时按 getOrInitV2Frame_ACU
    // 语义初始化空 frame（version:2, logEntries:[]），不再抛"请先完成既有迁移"。
    // 修复前（现状）：2772 守卫抛错 → 本测试红灯。
    const checkpointMessage = seedFrame({ logEntries: [] });
    const newAiMessage = { is_user: false, content: '新的 AI 回复' } as any;
    mocks.chat.splice(0, mocks.chat.length, checkpointMessage, newAiMessage);

    mocks.loadReplayState.mockResolvedValue({
      mate: { type: 'acu' },
      sheet_a: sheetA,
      sheet_b: sheetB,
    });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey,
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    // 新楼层被初始化出合法 V2 frame 并完成模板提交。
    const newFrame = newAiMessage.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(newFrame.version).toBe(2);
    expect(Array.isArray(newFrame.logEntries)).toBe(true);
    expect(mocks.saveChatStrict).toHaveBeenCalled();
  });

  it('B-3：IsolatedData 为 string 时 classify 与 2772 结论一致，模板提交成功', async () => {
    // 修复目标（阶段1）：2772 改用 readIsolatedTagData_ACU 统一读取 string/object，
    // 与 classify 结论一致 → 模板提交成功。
    // 修复前（现状）：2772 裸访问 string 形态拿不到 tagData → 抛错 → 红灯。
    const checkpointMessage = seedFrame({ logEntries: [] });
    // 把 IsolatedData 序列化为 string（宿主可能这么存储）。
    checkpointMessage.TavernDB_ACU_IsolatedData = JSON.stringify(checkpointMessage.TavernDB_ACU_IsolatedData);
    mocks.chat.splice(0, mocks.chat.length, checkpointMessage);
    mocks.loadReplayState.mockResolvedValue({
      mate: { type: 'acu' },
      sheet_a: sheetA,
      sheet_b: sheetB,
    });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey,
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    expect(mocks.saveChatStrict).toHaveBeenCalled();
  });

  it('阶段2负向：目标楼层有 V2 marker 但 frame 畸形时仍拒绝初始化并零副作用', async () => {
    // 有 V2 历史 marker（hasV2TableHistoryEvidence_ACU=true）却非合法 V2：
    // 说明是损坏的存储痕迹，绝不能当作缺 frame 静默初始化覆盖。
    // 构造：tagData._acu_storage_version=2（marker）但 storageFrame 非法（logEntries 非数组）。



    // 前置 classify 会先拦截"全 chat 范围内唯一畸形 marker"为 orphan_v2_artifacts；
    // 要测到 2798 守卫，需构造"旧楼层有合法 checkpoint（existing_full_checkpoint）+
    // 最新楼层是畸形 marker"的组合，绕过前置拦截。
    const checkpointMessage = seedFrame({ logEntries: [] });
    const malformedMessage = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: { version: 2, logEntries: 'not-an-array' },
        },
      },
    } as any;
    mocks.chat.splice(0, mocks.chat.length, checkpointMessage, malformedMessage);
    const beforeCheckpointMessage = JSON.parse(JSON.stringify(checkpointMessage));
    mocks.loadReplayState.mockResolvedValue({
      mate: { type: 'acu' },
      sheet_a: sheetA,
      sheet_b: sheetB,
    });
    mocks.loadReplayDetailed.mockResolvedValue({
      baseKind: 'full_checkpoint',
      data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
    });
    const beforeMessage = JSON.parse(JSON.stringify(malformedMessage));

    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey: '',
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('损坏的 V2 storage frame') });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    expect(malformedMessage).toEqual(beforeMessage);
    expect(checkpointMessage).toEqual(beforeCheckpointMessage);
  });

  it('阶段2：B-1 初始化空 frame 后 activeReplay 输入与初始化前完全一致', async () => {
    const checkpointMessage = seedFrame({ logEntries: [] });
    const newAiMessage = { is_user: false, content: '新的 AI 回复' } as any;
    mocks.chat.splice(0, mocks.chat.length, checkpointMessage, newAiMessage);

    const replayData = { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB };
    mocks.loadReplayState.mockResolvedValue(replayData);
    mocks.loadReplayDetailed.mockResolvedValue({ baseKind: 'full_checkpoint', data: replayData });

    const beforeReplayCalls = mocks.loadReplayDetailed.mock.calls.length;
    const result = await commitCurrentFloorTemplateChanges_ACU({
      isolationKey,
      sheetChanges: [{
        kind: 'operations',
        sheetKey: 'sheet_a',
        targetSheetData: sheetA,
        operations: [{ kind: 'meta_update', sheetKey: 'sheet_a', meta: { name: 'A' } }],
      }],
      guideData: { sheet_a: { name: 'A' }, sheet_b: { name: 'B' } },
      templateSource: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB },
      syncTemplateScope: true,
      createdAt: 30,
    });

    expect(result.saved).toBe(true);
    const replayCall = mocks.loadReplayDetailed.mock.calls[beforeReplayCalls];
    expect(replayCall[0]).toEqual([checkpointMessage, newAiMessage]);
    expect(replayCall[1]).toBe(isolationKey);
    expect(replayCall[2]).toMatchObject({ maxMessageIndex: 1 });
  });
});



describe('collectV2FullCheckpointIndices_ACU / assertSingleActiveFullCheckpointV2_ACU', () => {
  let collectV2FullCheckpointIndices_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['collectV2FullCheckpointIndices_ACU'];
  let assertSingleActiveFullCheckpointV2_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['assertSingleActiveFullCheckpointV2_ACU'];
  beforeAll(async () => {
    ({ collectV2FullCheckpointIndices_ACU, assertSingleActiveFullCheckpointV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist'));
  });

  function makeFullMessage(messageIndex: number, reason: string): any {
    return {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: messageIndex + 1, reason, data: { mate: { type: 'acu' }, sheet_a: sheetA } },
            logEntries: [],
          },
        },
      },
    };
  }
  function makeV2FrameWithoutFull(messageIndex: number): any {
    return {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: { version: 2, logEntries: [makeEntry({ seq: 1, entryId: `entry-${messageIndex}` })] },
        },
      },
    };
  }

  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.saveChat.mockReset().mockResolvedValue(undefined);
    mocks.saveChatStrict.mockReset().mockResolvedValue(undefined);
  });

  it('空聊天返回空数组，断言通过', () => {
    expect(collectV2FullCheckpointIndices_ACU([], '')).toEqual([]);
    expect(assertSingleActiveFullCheckpointV2_ACU([], '', 'test')).toBeNull();
  });

  it('0 个 full：仅 V2 frame 与 user 楼层不产生索引', () => {
    mocks.chat.splice(0, mocks.chat.length,
      { is_user: true, mes: 'user' },
      makeV2FrameWithoutFull(1),
      { is_user: false, mes: 'no-frame' },
    );
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([]);
    expect(assertSingleActiveFullCheckpointV2_ACU(mocks.chat, '', 'test')).toBeNull();
  });

  it('1 个 full：返回该索引且断言通过', () => {
    mocks.chat.splice(0, mocks.chat.length,
      { is_user: false, mes: 'a' },
      makeFullMessage(1, 'init'),
      makeV2FrameWithoutFull(2),
    );
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([1]);
    expect(assertSingleActiveFullCheckpointV2_ACU(mocks.chat, '', 'test')).toBeNull();
  });

  it('2 个 full：按楼层正序返回两个索引，断言返回含全部索引与各自 reason 的错误', () => {
    mocks.chat.splice(0, mocks.chat.length,
      makeFullMessage(0, 'init'),
      makeFullMessage(1, 'integrity_repair'),
    );
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0, 1]);
    const violation = assertSingleActiveFullCheckpointV2_ACU(mocks.chat, '', 'persist');
    expect(violation).toContain('2 个 full checkpoint');
    expect(violation).toContain('#0(init)');
    expect(violation).toContain('#1(integrity_repair)');
  });

  it('3 个 full：全部收集，断言计数为 3', () => {
    mocks.chat.splice(0, mocks.chat.length,
      makeFullMessage(0, 'init'),
      makeFullMessage(1, 'periodic'),
      makeFullMessage(2, 'manual'),
    );
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0, 1, 2]);
    expect(assertSingleActiveFullCheckpointV2_ACU(mocks.chat, '', 'test')).toContain('3 个 full checkpoint');
  });

  it('跨 isolationKey：只统计目标隔离键的 full', () => {
    const message = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' } } }, logEntries: [] } },
        'other-key': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' } } }, logEntries: [] } },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, message);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, 'other-key')).toEqual([0]);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, 'missing-key')).toEqual([]);
  });

  it('user 楼层不计入，但非 V2 frame 不阻断楼层编号', () => {
    mocks.chat.splice(0, mocks.chat.length,
      { is_user: true, mes: 'user' },
      makeFullMessage(1, 'init'),
      makeFullMessage(2, 'compaction'),
    );
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([1, 2]);
  });

  it('maxMessageIndex 边界：只统计该楼层及之前', () => {
    mocks.chat.splice(0, mocks.chat.length,
      makeFullMessage(0, 'init'),
      makeFullMessage(1, 'periodic'),
      makeFullMessage(2, 'manual'),
    );
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '', 0)).toEqual([0]);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '', 1)).toEqual([0, 1]);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '', 2)).toEqual([0, 1, 2]);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '', 99)).toEqual([0, 1, 2]);
  });

  it('非 V2 tag（version 非 2 或 logEntries 非数组）不计入 full', () => {
    const legacyTag = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 1,
          storageFrame: { checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' } } }, logEntries: [] },
        },
      },
    };
    const badLogEntries = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' } } }, logEntries: { seq: 1 } },
        },
      },
    };
    mocks.chat.splice(0, mocks.chat.length, legacyTag, badLogEntries);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([]);
    expect(assertSingleActiveFullCheckpointV2_ACU(mocks.chat, '', 'test')).toBeNull();
  });
});

describe('writeInitFullCheckpointFrameV2_ACU（S2-4 init 写协议统一入口）', () => {
  let writeInitFullCheckpointFrameV2_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['writeInitFullCheckpointFrameV2_ACU'];
  beforeAll(async () => {
    ({ writeInitFullCheckpointFrameV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist'));
  });

  function makeInitCheckpoint(reason: string = 'init'): any {
    return { kind: 'full', createdAt: 1, reason, data: { mate: { type: 'acu' }, sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', 'v']] } } };
  }

  it('正常写入：frame 形状正确，同楼其他隔离键数据原样保留', () => {
    const chat = [
      { is_user: true, mes: 'user' },
      { is_user: false, mes: 'ai', TavernDB_ACU_IsolatedData: { other_key: { legacy: true } } },
    ];
    const checkpoint = makeInitCheckpoint();

    writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex: 1, isolationKey: '', checkpoint });

    expect(chat[1].TavernDB_ACU_IsolatedData).toEqual({
      other_key: { legacy: true },
      '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint, logEntries: [] } },
    });
  });

  it('目标楼不存在或是 user 楼时抛错且不写入', () => {
    const chat = [{ is_user: true, mes: 'user' }];
    expect(() => writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex: 0, isolationKey: '', checkpoint: makeInitCheckpoint() }))
      .toThrow(/不是 AI 楼层/);
    expect(() => writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex: 5, isolationKey: '', checkpoint: makeInitCheckpoint() }))
      .toThrow(/不存在或不是 AI 楼层/);
    expect((chat[0] as any).TavernDB_ACU_IsolatedData).toBeUndefined();
  });

  it('非 init reason 或非 full kind 时拒绝', () => {
    const chat = [{ is_user: false, mes: 'ai' }];
    expect(() => writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex: 0, isolationKey: '', checkpoint: makeInitCheckpoint('manual') }))
      .toThrow(/只接受 reason:'init'/);
    const notFull = { ...makeInitCheckpoint(), kind: 'delta' };
    expect(() => writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex: 0, isolationKey: '', checkpoint: notFull }))
      .toThrow(/只接受 reason:'init'/);
  });

  it('写入后同隔离键存在多个 full checkpoint 时抛单根违例', () => {
    const existingFull = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: makeInitCheckpoint('compaction' as any), logEntries: [] } },
      },
    };
    // 既有 full 的 reason 与 init 无关，只要 kind=full 就计入单根统计
    (existingFull.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint as any).reason = 'compaction';
    const chat = [existingFull, { is_user: false, mes: 'ai-2' }];

    expect(() => writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex: 1, isolationKey: '', checkpoint: makeInitCheckpoint() }))
      .toThrow(/单根不变量.*2 个 full checkpoint/);
  });
});

describe('frameHasSuffixReplayArtifact_ACU', () => {
  const fullCheckpoint = { kind: 'full', createdAt: 1, reason: 'init', data: { mate: { type: 'acu' }, sheet_a: sheetA, sheet_b: sheetB } };
  const intrinsicShard = { kind: 'sheet_full', createdAt: 1, reason: 'schema_change', sheetKey: 'sheet_a', data: sheetA };

  it('自有 full checkpoint + 无 timeline 的 per-sheet（intrinsic）时无后缀 artifact', () => {
    const frame = { version: 2, checkpoint: fullCheckpoint, perSheetCheckpoints: { sheet_a: intrinsicShard } };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(false);
  });

  it('per-sheet 携带 timeline（补挂收敛锚点）时视为真实后缀 artifact', () => {
    const frame = {
      version: 2,
      checkpoint: fullCheckpoint,
      perSheetCheckpoints: {
        sheet_a: { ...intrinsicShard, timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 5, afterSeq: 3 } },
      },
    };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(true);
  });

  it('无自有 full checkpoint 但存在 per-sheet 时视为悬空 artifact', () => {
    const frame = { version: 2, perSheetCheckpoints: { sheet_a: intrinsicShard } };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(true);
  });

  it('自有 full checkpoint + headRevision 时无后缀 artifact', () => {
    const frame = { version: 2, checkpoint: fullCheckpoint, headRevision: '3:existing' };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(false);
  });

  it('无 full checkpoint + headRevision 时视为悬空 artifact', () => {
    const frame = { version: 2, headRevision: '3:existing' };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(true);
  });

  it('logEntries 非空即视为真实后缀 artifact', () => {
    const frame = { version: 2, checkpoint: fullCheckpoint, logEntries: [makeEntry()] };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(true);
  });

  it('manualRefillProgress 存在即视为真实后缀 artifact', () => {
    const frame = {
      version: 2,
      checkpoint: fullCheckpoint,
      manualRefillProgress: { kind: 'manual_refill', status: 'in_progress', selectedSheetKeys: ['sheet_b'] },
    };
    expect(frameHasSuffixReplayArtifact_ACU(frame as any)).toBe(true);
  });

  it('空 frame（无 checkpoint、无 shard、无 revision）无后缀 artifact', () => {
    expect(frameHasSuffixReplayArtifact_ACU({ version: 2 } as any)).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// demoteTemplateOnlyRootToScopeOnly_ACU 四行真值表（契约）
// 判据：聊天是否残留回放根（full checkpoint），而非「降级动作是否成功
// ═══════════════════════════════════════════════════════════════════════════
describe('demoteTemplateOnlyRootToScopeOnly_ACU 契约（四行真值表）', () => {
  let demoteTemplateOnlyRootToScopeOnly_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['demoteTemplateOnlyRootToScopeOnly_ACU'];
  let collectV2FullCheckpointIndices_ACU: typeof import('../../../src/service/table/storage-frame-v2-persist')['collectV2FullCheckpointIndices_ACU'];
  let buildCanonicalFullCheckpoint_ACU: typeof import('../../../src/service/table/canonical-checkpoint-builder')['buildCanonicalFullCheckpoint_ACU'];

  beforeAll(async () => {
    ({
      demoteTemplateOnlyRootToScopeOnly_ACU,
      collectV2FullCheckpointIndices_ACU,
    } = await import('../../../src/service/table/storage-frame-v2-persist'));
    ({ buildCanonicalFullCheckpoint_ACU } = await import('../../../src/service/table/canonical-checkpoint-builder'));
  });

  beforeEach(() => {
    mocks.chat.splice(0, mocks.chat.length);
    mocks.loadReplayDetailed.mockReset();
    mocks.loadReplayState.mockReset();
    mocks.loadReplayDetailed.mockImplementation(async (...args: any[]) => {
      const data = await mocks.loadReplayState(...args);
      return data ? { baseKind: 'full_checkpoint', data } : null;
    });
    mocks.saveChatStrict.mockClear();
    mocks.saveChat.mockClear();
  });

  it('空聊天：无回放根 → noReplayRoot: true，不构成阻断', async () => {
    mocks.chat.splice(0, mocks.chat.length);

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: false, demoted: false, noReplayRoot: true });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  });

  it('pristine_without_checkpoint：无任何 frame → noReplayRoot: true', async () => {
    mocks.chat.splice(0, mocks.chat.length, { is_user: false });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: false, demoted: false, noReplayRoot: true });
    expect(demotion.reason).toContain('pristine_without_checkpoint');
  });

  it('orphan_v2_artifacts：悬空 V2 帧无 full checkpoint → noReplayRoot: true 且 logWarn 留痕', async () => {
    mocks.chat.splice(0, mocks.chat.length, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: { version: 2, logEntries: [], headRevision: '3:orphan' },
        },
      },
    });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: false, demoted: false, noReplayRoot: true });
    expect(demotion.reason).toContain('orphan_v2_artifacts');
    expect(mocks.logWarn_ACU).toHaveBeenCalled();
  });

  it('existing_full_checkpoint：含真实数据行的 full checkpoint → noReplayRoot: false，fail-closed', async () => {
    const templateData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: sheetA, // sheetA.content 含数据行 ['1','new']
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'manual', // 非 init/migration，必不 template_only_root
      data: templateData,
      event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 0, isolationKey: '' },
    });
    if (!checkpointResult.checkpoint) throw new Error('构造 existing full checkpoint 失败');
    mocks.chat.splice(0, mocks.chat.length, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: checkpointResult.checkpoint,
            perSheetCheckpoints: {},
            logEntries: [],
            headRevision: 'checkpoint:mock',
          },
        },
      },
    });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: false, demoted: false, noReplayRoot: false });
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    // 残留根仍在，full checkpoint 数保持 1。
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
  });

  it('template_only_root：header-only init 根可安全降级 → ok: true 且事后零 full checkpoint', async () => {
    const headerOnlyData = {
      mate: { type: 'acu' },
      sheet_a: { ...sheetA, content: [['row_id', 'value']] },
      sheet_b: { ...sheetB, content: [['row_id', 'value']] },
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'init',
      data: headerOnlyData,
      event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 0, isolationKey: '' },
    });
    if (!checkpointResult.checkpoint) throw new Error('构造 header-only init checkpoint 失败');
    mocks.chat.splice(0, mocks.chat.length, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: checkpointResult.checkpoint,
            perSheetCheckpoints: {},
            logEntries: [],
            headRevision: '3:header-only-root',
          },
        },
      },
    });
    // 降级后候选帧为空帧，replay 退化为模板临时基线：mock 直接返回 header-only data。
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      data: headerOnlyData,
      baseKind: 'temporary_template_baseline',
    });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: true, demoted: true });
    expect(mocks.saveChatStrict).toHaveBeenCalled();
    // 降级后无 full checkpoint。
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([]);
  });

  it('P0 仅 updateConfig.updateFrequency 不同：降级成功且零 full checkpoint', async () => {
    // checkpoint 携带旧模板配置（updateFrequency 5），当前模板基线携带新配置
    // （updateFrequency 60）。旧实现在降级路径用「全量字段指纹」比较，配置差异
    // 会被误报为结构不一致；修复后只比较结构投影，应降级成功、零写入。
    const headerOnlyData = {
      mate: { type: 'acu', version: 1 },
      sheet_a: { ...sheetA, content: [['row_id', 'value']], updateConfig: { updateFrequency: 5 } },
      sheet_b: { ...sheetB, content: [['row_id', 'value']], updateConfig: { updateFrequency: 5 } },
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'init',
      data: headerOnlyData,
      event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 0, isolationKey: '' },
    });
    if (!checkpointResult.checkpoint) throw new Error('构造 header-only init checkpoint 失败');
    mocks.chat.splice(0, mocks.chat.length, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: checkpointResult.checkpoint,
            perSheetCheckpoints: {},
            logEntries: [],
            headRevision: '3:header-only-root',
          },
        },
      },
    });
    // 模板基线：与 checkpoint 结构一致，仅 updateConfig 不同。
    const replayData = {
      mate: { type: 'acu', version: 1 },
      sheet_a: { ...sheetA, content: [['row_id', 'value']], updateConfig: { updateFrequency: 60 } },
      sheet_b: { ...sheetB, content: [['row_id', 'value']], updateConfig: { updateFrequency: 60 } },
    };
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      data: replayData,
      baseKind: 'temporary_template_baseline',
    });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: true, demoted: true });
    expect(mocks.saveChatStrict).toHaveBeenCalled();
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([]);
  });

  it('P0 仅 mate.updateConfigUiSentinel / sourceData.note 不同：降级成功', async () => {
    const headerOnlyData = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 1, globalInjectionConfig: {} },
      sheet_a: { ...sheetA, content: [['row_id', 'value']], sourceData: { note: '旧注记' } },
      sheet_b: { ...sheetB, content: [['row_id', 'value']], sourceData: { note: '旧注记' } },
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'init',
      data: headerOnlyData,
      event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 0, isolationKey: '' },
    });
    if (!checkpointResult.checkpoint) throw new Error('构造 header-only init checkpoint 失败');
    mocks.chat.splice(0, mocks.chat.length, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: checkpointResult.checkpoint,
            perSheetCheckpoints: {},
            logEntries: [],
            headRevision: '3:header-only-root',
          },
        },
      },
    });
    const replayData = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 2, globalInjectionConfig: {} },
      sheet_a: { ...sheetA, content: [['row_id', 'value']], sourceData: { note: '新注记' } },
      sheet_b: { ...sheetB, content: [['row_id', 'value']], sourceData: { note: '新注记' } },
    };
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      data: replayData,
      baseKind: 'temporary_template_baseline',
    });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    expect(demotion).toMatchObject({ ok: true, demoted: true });
    expect(mocks.saveChatStrict).toHaveBeenCalled();
  });

  it('P0 表头内容不同（列改名）仍拒绝降级：fail-closed 且带诊断', async () => {
    const headerOnlyData = {
      mate: { type: 'acu', version: 1 },
      sheet_a: { ...sheetA, content: [['row_id', 'value']] },
      sheet_b: { ...sheetB, content: [['row_id', 'value']] },
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'init',
      data: headerOnlyData,
      event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 0, isolationKey: '' },
    });
    if (!checkpointResult.checkpoint) throw new Error('构造 header-only init checkpoint 失败');
    mocks.chat.splice(0, mocks.chat.length, {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: checkpointResult.checkpoint,
            perSheetCheckpoints: {},
            logEntries: [],
            headRevision: '3:header-only-root',
          },
        },
      },
    });
    // 模板基线：表头列名从 value 改为 display_name → 真实结构差异，必须拒绝。
    const replayData = {
      mate: { type: 'acu', version: 1 },
      sheet_a: { ...sheetA, content: [['row_id', 'display_name']] },
      sheet_b: { ...sheetB, content: [['row_id', 'value']] },
    };
    mocks.loadReplayDetailed.mockResolvedValueOnce({
      data: replayData,
      baseKind: 'temporary_template_baseline',
    });

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey: '' });

    // 结构不一致分支只返回 ok/demoted/reason，不带 noReplayRoot；调用方
    // 「!ok && noReplayRoot !== true → fail-closed」即阻止保存（useVisualizerSave.ts）。
    expect(demotion).toMatchObject({ ok: false, demoted: false });
    expect(demotion.noReplayRoot).toBeUndefined();
    expect(demotion.reason).toContain('表结构不一致');
    expect(demotion.reason).toContain('sheet_a.headerChanged');
    expect(mocks.saveChatStrict).not.toHaveBeenCalled();
    // 残留根仍在，full checkpoint 数保持 1。
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, '')).toEqual([0]);
  });
});

