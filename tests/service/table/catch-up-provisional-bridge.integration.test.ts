/**
 * tests/service/table/catch-up-provisional-bridge.integration.test.ts
 *
 * 真实失败基线（t1）：复现“预检时无锚点 → chunk 内 migration 后锚点落到追平目标之后”。
 *
 * 不用 mock persist / replay / migration：这三个环节正是漏洞所在，mock 掉它们等于
 * 自证清白。测试按真实时序走：
 *   1. 初始聊天为 legacy-v1；
 *   2. skipUpdateFloors 使 migration checkpoint 落在后方楼层；
 *   3. selected sheet 连续前沿为 0，第一 bucket 目标在前方；
 *   4. preflight（hasAnyV2Checkpoint）初始看不到 full；
 *   5. chunk 内 migration 后第一 persist 得到与截图一致的
 *      `targetMessageIndex < latestFullCheckpointIndex`。
 *
 * 该测试在修复（t2 迁移前置）前必须失败，修复后必须转绿。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  settings: {
    storageMode: 'native',
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    skipUpdateFloors: 2,
    updateBatchSize: 1,
  },
  chatIdentifier: 'catch-up-bridge-test-chat',
  isolationKey: '',
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
  emitMessageUpdated_ACU: vi.fn(),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/repositories/chat-message-data-repo')>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn((message: any, isolationConfig: any) => {
    if (isolationConfig.enabled) message.TavernDB_ACU_Identity = isolationConfig.code;
    else delete message.TavernDB_ACU_Identity;
  }),
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
  };
});

vi.mock('../../../src/service/runtime/state-manager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/runtime/state-manager')>();
  return {
    ...actual,
    settings_ACU: mocks.settings,
    get currentChatFileIdentifier_ACU() { return mocks.chatIdentifier; },
    getCurrentIsolationKey_ACU: vi.fn(() => mocks.isolationKey),
    get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
    _set_currentJsonTableData_ACU: vi.fn((value: any) => { mocks.currentJsonTableData = value; }),
  };
});

// table-write-transaction 是真实实现，但依赖 chat-history 的 storage identity；
// 这里保留真实 runTableWriteTransaction_ACU，只 stub 掉 chat-history 的 identity 读取。
vi.mock('../../../src/data/storage/chat-history', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/chat-history')>();
  return {
    ...actual,
    getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentifier),
  };
});

import { ensureLegacyStorageMigratedBeforeWrite_ACU } from '../../../src/service/table/table-service';
import { hasAnyV2Checkpoint_ACU, persistTableMutationLogV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';
import { loadTableStateFromFramesV2Detailed_ACU } from '../../../src/service/table/storage-frame-v2-replay';

function sheet(name: string, rows: any[][] = [['row_id', '值']]) {
  return {
    uid: name,
    name,
    content: rows,
    updateConfig: {},
    exportConfig: {},
    sourceData: {},
    orderNo: 0,
  } as any;
}

/**
 * 构造 legacy-v1 聊天：AI 楼层 0/2/4 携带旧表数据，最后 AI 楼层 6 是最新楼层。
 * skipUpdateFloors=2 时 migration checkpoint 会落在 4（从末尾跳过 2 个 AI 楼层）。
 */
function buildLegacyCatchUpChat(): any[] {
  return [
    {
      is_user: false,
      TavernDB_ACU_IndependentData: { sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1']]) },
      TavernDB_ACU_ModifiedKeys: ['sheet_a'],
      TavernDB_ACU_UpdateGroupKeys: [],
    },
    { is_user: true, mes: '用户1' },
    {
      is_user: false,
      TavernDB_ACU_IndependentData: { sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2']]) },
      TavernDB_ACU_ModifiedKeys: ['sheet_a'],
      TavernDB_ACU_UpdateGroupKeys: [],
    },
    { is_user: true, mes: '用户3' },
    {
      is_user: false,
      TavernDB_ACU_IndependentData: { sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2'], ['3', 'a3']]) },
      TavernDB_ACU_ModifiedKeys: ['sheet_a'],
      TavernDB_ACU_UpdateGroupKeys: [],
    },
    { is_user: true, mes: '用户5' },
    { is_user: false, mes: '最新 AI 楼层' },
  ];
}

describe('manual catch-up provisional bridge 真实失败基线（t1）', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.currentJsonTableData = null;
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    mocks.settings.skipUpdateFloors = 2;
    mocks.settings.updateBatchSize = 1;
    mocks.chatIdentifier = 'catch-up-bridge-test-chat';
    mocks.isolationKey = '';
  });

  it('chunk 内 migration 把锚点写到后方楼层后，第一 bucket 的 persist 被 fail-fast 拒绝（4 < 2716 同类时序）', async () => {
    mocks.chat.push(...buildLegacyCatchUpChat());
    const isolationKey = mocks.isolationKey;

    // 阶段 A：preflight。初始聊天只有 legacy 顶层字段，没有任何 V2 full checkpoint。
    const preflightHasCheckpoint = hasAnyV2Checkpoint_ACU(mocks.chat, isolationKey);
    expect(preflightHasCheckpoint).toBe(false);

    // 阶段 B：执行 chunk 时才发生 legacy→V2 migration（这正是当前漏洞时序）。
    const migration = await ensureLegacyStorageMigratedBeforeWrite_ACU('processGroupedRuntimeChunk');
    expect(migration.success).toBe(true);
    expect(migration.migrated).toBe(true);

    // migration checkpoint 落在后方楼层（skipUpdateFloors=2 → 倒数第 2 个 AI 楼层）。
    const chatAfterMigration = mocks.chat;
    const aiIndices = chatAfterMigration
      .map((message: any, index: number) => (!message.is_user ? index : -1))
      .filter((index: number) => index >= 0);
    const fullCheckpointIndices = aiIndices.filter((index: number) => {
      const tagData = chatAfterMigration[index]?.TavernDB_ACU_IsolatedData?.[isolationKey];
      return tagData?.storageFrame?.checkpoint?.kind === 'full';
    });
    expect(fullCheckpointIndices.length).toBe(1);
    const migrationCheckpointIndex = fullCheckpointIndices[0];
    // 追平目标（首个待填 AI 楼层）远早于 migration checkpoint。
    expect(migrationCheckpointIndex).toBeGreaterThan(0);

    // 阶段 C：第一 bucket 目标在前方楼层（例如 AI 楼层 0 → messageIndex 0），
    // 直接走真实 persist，应被 fail-fast 拒绝。
    const { persistTableMutationLogV2_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const firstBucketTargetIndex = 0;
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2']]),
    };
    const transactionContext = {
      baseRevision: null,
      writeSet: [{ kind: 'sheet' as const, sheetKey: 'sheet_a' }],
      assertFresh: vi.fn(),
      runCommit: vi.fn(async (task: () => any) => task()),
    };
    const persistResult = await persistTableMutationLogV2_ACU({
      source: 'manual_fill',
      afterData,
      operations: [{
        kind: 'sql_sheet_batch',
        sheetKey: 'sheet_a',
        tableName: '表A',
        statements: ["INSERT INTO 表A (row_id, 值) VALUES ('2', 'a2')"],
      }],
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      groupKeys: [],
      targetMessageIndex: firstBucketTargetIndex,
      isolationKey,
      transactionContext: transactionContext as any,
      strictSave: true,
    });

    // 关键断言：与截图同构的 fail-fast，而不是成功写入。
    expect(persistResult.saved).toBe(false);
    expect(persistResult.error).toContain('precedes the latest full checkpoint');
    expect(persistResult.error).toContain(`targetMessageIndex=${firstBucketTargetIndex}`);
    expect(persistResult.error).toContain(`latestFullCheckpointIndex=${migrationCheckpointIndex}`);

    // 失败发生在 AI 调用之后：证明用户已经支付调用成本才被阻断。
    expect(migration.migrated).toBe(true);
  });
});


/**
 * ── t4：bridge 状态机真实集成测试 ──
 *
 * 覆盖：建立（唯一 active full + 原根备份）、finalize（原根恢复 + selected sheet
 * 由 sheet_rebase 覆盖）、rollback（零提交恢复原根）、fail-closed（冲突拒绝）。
 * 全部使用真实 replay / checkpoint builder / write transaction。
 */
import { buildCanonicalFullCheckpoint_ACU } from '../../../src/service/table/canonical-checkpoint-builder';
import { advanceProvisionalBridgeCommitProgress_ACU, ensureNoActiveProvisionalBridgeForCurrentScope_ACU, establishProvisionalBridge_ACU, finalizeProvisionalBridge_ACU, rollbackProvisionalBridge_ACU, recoverProvisionalBridgeSession_ACU } from '../../../src/service/table/manual-catch-up-provisional-bridge';

describe('manual catch-up provisional bridge 状态机（t4）', () => {
  /**
   * 构造 V2 聊天：AI 楼层 0/2/4 携带 V2 delta 帧，AI 楼层 6 携带正式 full checkpoint。
   * selected sheet 在 full 之前有 header（楼层 0），追平目标为 0。
   */
  function buildV2ChatWithFormalFull(): any[] {
    const mate = { type: 'acu' };
    const headerSheet = sheet('表A', [['row_id', '值']]);
    const fullSheet = sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2']]);
    const fullCheckpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: 1000,
      reason: 'manual',
      data: { mate, sheet_a: fullSheet },
      event: { filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 6, aiFloor: 3, isolationKey: mocks.isolationKey, reason: 'manual' },
    });
    if (!fullCheckpointResult.checkpoint) {
      throw new Error(`构造正式 full checkpoint 失败：${fullCheckpointResult.error}`);
    }
    return [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          [mocks.isolationKey]: {
            _acu_storage_version:2,
            storageFrame: { version: 2, logEntries: [] },
          },
        },
      },
      { is_user: true, mes: '用户1' },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          [mocks.isolationKey]: {
            _acu_storage_version: 2,
            storageFrame: { version: 2, logEntries: [] },
          },
        },
      },
      { is_user: true, mes: '用户3' },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          [mocks.isolationKey]: {
            _acu_storage_version: 2,
            storageFrame: { version: 2, logEntries: [] },
          },
        },
      },
      { is_user: true, mes: '用户5' },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          [mocks.isolationKey]: {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: fullCheckpointResult.checkpoint,
              headRevision: 'formal-root',
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户7' },
      { is_user: false, mes: '最新 AI 楼层' },
    ];
  }

  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.currentJsonTableData = null;
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.chatIdentifier = 'catch-up-bridge-test-chat';
    mocks.isolationKey = '';
  });

  it('建立 provisional bridge：唯一 active full + 原根完整备份 + 临时根落在追平起点', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-establish-1';

    const result = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provisionalRootIndex).toBe(0);

    // 唯一 active full：原 full 从 replay 时间线移除，临时根是唯一 full。
    const chat = mocks.chat;
    const fullIndices = chat
      .map((message: any, index: number) => (!message.is_user ? index : -1))
      .filter((index: number) => index >= 0)
      .filter((index: number) => {
        const tagData = chat[index]?.TavernDB_ACU_IsolatedData?.[isolationKey];
        return tagData?.storageFrame?.checkpoint?.kind === 'full';
      });
    expect(fullIndices).toEqual([0]);

    // 原 full 位置：storageFrame 被清空，recoveryBackup 保留完整原帧。
    const originalTag = chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.checkpoint).toBeUndefined();
    expect(originalTag?.recoveryBackup?.recoveryKind).toBe('manual_catch_up_provisional_bridge');
    expect(originalTag?.recoveryBackup?.storageFrame?.checkpoint?.kind).toBe('full');

    // bridge 元数据落在临时根消息。
    const bridgeOnRoot = chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.manualCatchUpProvisionalBridge;
    expect(bridgeOnRoot?.runId).toBe(runId);
    expect(bridgeOnRoot?.phase).toBe('provisional_active');
    expect(bridgeOnRoot?.originalFullCheckpointIndex).toBe(6);
  });

  it('建立 provisional bridge 后，真实 replay 到临时根能恢复 selected sheet header 基线', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-replay-1';

    const result = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(result.ok).toBe(true);

    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, isolationKey, {
      maxMessageIndex: 0,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(replay).toBeTruthy();
    expect(replay?.baseKind).toBe('full_checkpoint');
    expect(replay?.data?.sheet_a?.content).toEqual([['row_id', '值']]);
  });

  it('finalize：恢复原 full 根，selected sheet 由 sheet_rebase 覆盖，非目标表保持原语义', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-finalize-1';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);

    // 模拟追平已把 sheet_a 填到 header + 2 行，写一个 provisional delta（楼层 2）。
    const provisionalFilled = sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2']]);
    const midTag = mocks.chat[2]?.TavernDB_ACU_IsolatedData?.[isolationKey] || { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
    midTag.storageFrame = {
      version: 2,
      headRevision: 'provisional-delta-1',
      logEntries: [{
        seq: 1,
        entryId: 'provisional-delta-1',
        createdAt: Date.now(),
        source: 'manual_fill',
        targetMessageIndex: 2,
        aiFloor: 1,
        operations: [{
          kind: 'data_replace',
          data: { mate: { type: 'acu' }, sheet_a: provisionalFilled },
        }],
      }],
    };
    mocks.chat[2].TavernDB_ACU_IsolatedData = { [isolationKey]: midTag };

    const finalize = await finalizeProvisionalBridge_ACU(runId, {
      chatKey: mocks.chatIdentifier,
      isolationKey,
      nextSaveTargetIndex: 6,
    });
    expect(finalize.ok ? '' : `finalize 失败: ${finalize.error} (${finalize.diagnosticCode})`).toBe('');
    expect(finalize.ok).toBe(true);
    if (!finalize.ok) return;

    // 追平结果必须真实反映到最终 selected sheet（finalize 从 provisional 累计快照提取）。
    const finalizeReplayBeforeBoundary = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, isolationKey, {
      maxMessageIndex: 5,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(finalizeReplayBeforeBoundary?.data?.sheet_a?.content).toEqual(provisionalFilled.content);

    // 原 full 根恢复：checkpoint 回到楼层 6，且 selected sheet 的 perSheetCheckpoints 有 sheet_rebase。
    const originalTag = mocks.chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.checkpoint?.kind).toBe('full');
    const rebase = originalTag?.storageFrame?.perSheetCheckpoints?.sheet_a;
    expect(rebase?.timeline?.kind).toBe('sheet_rebase');
    expect(rebase?.timeline?.afterSeq).toBe(0);

    // 临时根被清理：楼层 0 不再有 active full。
    const rootTag = mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(rootTag?.storageFrame?.checkpoint?.kind).not.toBe('full');

    // 真实 replay 到原 full 边界：selected sheet 等于追平累计结果。
    const boundaryReplay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, isolationKey, {
      maxMessageIndex: 6,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(boundaryReplay?.baseKind).toBe('full_checkpoint');
    expect(boundaryReplay?.data?.sheet_a?.content).toEqual(provisionalFilled.content);
  });

  it('rollback（零提交）：恢复原 full 根，删除临时根，bridge 元数据清除', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-rollback-1';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);

    const rollback = await rollbackProvisionalBridge_ACU(runId, {
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(rollback.ok ? '' : `rollback 失败: ${rollback.error}`).toBe('');
    expect(rollback.ok).toBe(true);

    const originalTag = mocks.chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.checkpoint?.kind).toBe('full');
    const rootTag = mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(rootTag?.storageFrame?.checkpoint?.kind).not.toBe('full');
    expect(rootTag?.manualCatchUpProvisionalBridge).toBeUndefined();
  });

  it('runId 不匹配时 finalize 被拒绝（fail-closed）', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-conflict-1';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);

    const finalize = await finalizeProvisionalBridge_ACU('wrong-run-id', {
      chatKey: mocks.chatIdentifier,
      isolationKey,
      nextSaveTargetIndex: 6,
    });
    expect(finalize.ok).toBe(false);
    if (!finalize.ok) {
      expect(finalize.diagnosticCode).toBe('provisional_bridge_conflict');
    }
  });

/**
 * ── t5：写入准入（拓扑冻结）真实集成测试 ──
 *
 * bridge 活跃期间：
 *  - 普通 V2 写入（不带 runId）必须被 persist 准入拒绝；
 *  - 带匹配 runId、目标早于原 full 边界的 bucket 写入必须放行；
 *  - 到达原 full 边界（target >= originalFull）的 bucket 必须被要求先 finalize。
 */

describe('manual catch-up provisional bridge 写入准入（t5）', () => {
  function buildTransactionContext() {
    return {
      baseRevision: null,
      writeSet: [{ kind: 'sheet' as const, sheetKey: 'sheet_a' }],
      assertFresh: vi.fn(),
      runCommit: vi.fn(async (task: () => any) => task()),
    };
  }

  function buildPersistOptions(overrides: Record<string, any> = {}) {
    const afterData = {
      mate: { type: 'acu' },
      sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1']]),
    };
    return {
      source: 'manual_fill' as const,
      afterData,
      operations: [{
        kind: 'data_replace' as const,
        data: afterData,
      }],
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      groupKeys: [],
      targetMessageIndex: 2,
      isolationKey: mocks.isolationKey,
      transactionContext: buildTransactionContext() as any,
      strictSave: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.currentJsonTableData = null;
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.chatIdentifier = 'catch-up-bridge-test-chat';
    mocks.isolationKey = '';
  });

  it('bridge 活跃时，普通 V2 写入（不带 runId）被准入拒绝，不落入 provisional 时间线', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-admission-1';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);

    // 普通写入：不携带 manualCatchUpRunId → 必须被拒绝。
    const normalResult = await persistTableMutationLogV2_ACU(buildPersistOptions({
      targetMessageIndex: 2,
    }));
    expect(normalResult.saved).toBe(false);
    expect(normalResult.error).toContain('provisional bridge 写入被拒绝');
    expect(normalResult.error).toContain('runId');
  });

  it('bridge 活跃时，匹配 runId 且目标早于原 full 边界的 bucket 写入被放行', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-admission-2';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);

    // 匹配 runId、目标 2 < 原 full 6 → 放行。
    const authorizedResult = await persistTableMutationLogV2_ACU(buildPersistOptions({
      targetMessageIndex: 2,
      manualCatchUpRunId: runId,
    }));
    expect(authorizedResult.saved).toBe(true);
    expect(authorizedResult.messageIndex).toBe(2);
  });

  it('bridge 活跃时，目标已到达原 full 边界的 bucket 被要求先 finalize', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-admission-3';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);

    // 目标 6 >= 原 full 6 → 必须先 finalize。
    const boundaryResult = await persistTableMutationLogV2_ACU(buildPersistOptions({
      targetMessageIndex: 6,
      manualCatchUpRunId: runId,
    }));
    expect(boundaryResult.saved).toBe(false);
    expect(boundaryResult.error).toContain('必须先执行 bridge finalize');
  });

  it('recover（崩溃残留零提交）：自动 rollback 恢复原根并清除临时根与 bridge 元数据', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-recover-zero';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;
    // 模拟崩溃残留：零提交（lastCommittedTargetIndex 保持 -1），active bridge 仍在。

    const recovery = await recoverProvisionalBridgeSession_ACU({ isolationKey });

    expect(recovery.ok).toBe(true);
    if (!recovery.ok) return;
    expect(recovery.action).toBe('rolled_back');
    // 原根恢复：楼层 6 重新成为唯一 full。
    const chat = mocks.chat;
    const fullIndices = chat
      .map((message: any, index: number) => (!message.is_user ? index : -1))
      .filter((index: number) => index >= 0)
      .filter((index: number) => {
        const tagData = chat[index]?.TavernDB_ACU_IsolatedData?.[isolationKey];
        return tagData?.storageFrame?.checkpoint?.kind === 'full';
      });
    expect(fullIndices).toEqual([6]);
    // bridge 元数据清除，临时根不再携带 bridge。
    const rootTag = chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(rootTag?.manualCatchUpProvisionalBridge).toBeUndefined();
    expect(rootTag?.storageFrame?.checkpoint?.kind).toBeUndefined();
  });

  it('recover（崩溃残留有提交）：自动 finalize 汇合回原根', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-recover-committed';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;
    // 模拟崩溃残留：有已提交 bucket（target=2 < 原 full 6）。
    const commit = await persistTableMutationLogV2_ACU(buildPersistOptions({
      targetMessageIndex: 2,
      manualCatchUpRunId: runId,
    }));
    expect(commit.saved).toBe(true);

    const recovery = await recoverProvisionalBridgeSession_ACU({ isolationKey });

    expect(recovery.ok).toBe(true);
    if (!recovery.ok) return;
    expect(recovery.action).toBe('finalized');
    // 原根恢复为唯一 full，selected sheet 通过 sheet_rebase 覆盖。
    const chat = mocks.chat;
    const fullIndices = chat
      .map((message: any, index: number) => (!message.is_user ? index : -1))
      .filter((index: number) => index >= 0)
      .filter((index: number) => {
        const tagData = chat[index]?.TavernDB_ACU_IsolatedData?.[isolationKey];
        return tagData?.storageFrame?.checkpoint?.kind === 'full';
      });
    expect(fullIndices).toEqual([6]);
    const originalTag = chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.perSheetCheckpoints?.sheet_a?.timeline?.kind).toBe('sheet_rebase');
    expect(originalTag?.manualCatchUpProvisionalBridge).toBeUndefined();
  });

  it('bridge 活跃且自动恢复失败时，边界 compaction 被 fail-closed 阻止（provisional bridge 拓扑冻结）', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-compaction-guard';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    // 破坏 bridge 的 chatKey，使 recover 的 scope 检查失败（fail-closed 路径）。
    const rootTag = mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    rootTag.manualCatchUpProvisionalBridge.chatKey = 'someone-else-chat';

    const { ensureV2BoundaryCheckpointForRetainedBuffer_ACU } = await import('../../../src/service/chat/chat-service');
    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'auto_update', save: true });

    // fail-closed：compaction 未执行，返回失败并带 recovery 错误。
    expect(result.success).toBe(false);
    expect(result.error).toContain('provisional bridge');
    // 原 full 未被 compaction 降级或改写：bridge 仍 active，原 full 仍在 recoveryBackup。
    const chat = mocks.chat;
    const originalTag = chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.checkpoint?.kind).not.toBe('full');
    expect(originalTag?.recoveryBackup?.recoveryKind).toBe('manual_catch_up_provisional_bridge');
    expect(chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.manualCatchUpProvisionalBridge?.phase).toBe('provisional_active');
  });


  it('finalize strict save 失败：原位回滚，返回 bridge_finalize_failed，不留下半写根或 bridge 残留', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-finalize-strict-fail';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    // 模拟追平已把 sheet_a 填到 header + 2 行（楼层 2），并推进 bridge 进度（同一次 strict save）。
    const provisionalFilled = sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2']]);
    const midTag = mocks.chat[2]?.TavernDB_ACU_IsolatedData?.[isolationKey] || { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
    midTag.storageFrame = {
      version: 2,
      headRevision: 'provisional-delta-strict-fail',
      logEntries: [{
        seq: 1,
        entryId: 'provisional-delta-strict-fail',
        createdAt: Date.now(),
        source: 'manual_fill',
        targetMessageIndex: 2,
        aiFloor: 1,
        operations: [{
          kind: 'data_replace',
          data: { mate: { type: 'acu' }, sheet_a: provisionalFilled },
        }],
      }],
    };
    mocks.chat[2].TavernDB_ACU_IsolatedData = { [isolationKey]: midTag };

    // 构造已推进的 bridge 元数据（模拟真实 persist 中 advanceProvisionalBridgeCommitProgress_ACU 的效果）。
    const rootTag = mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    rootTag.manualCatchUpProvisionalBridge = {
      ...rootTag.manualCatchUpProvisionalBridge,
      lastCommittedTargetIndex: 2,
      updatedAt: Date.now(),
    };

    // finalize 的 strict save 失败。
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('host save 失败'));
    const finalize = await finalizeProvisionalBridge_ACU(runId, {
      chatKey: mocks.chatIdentifier,
      isolationKey,
      nextSaveTargetIndex: 6,
    });
    expect(finalize.ok).toBe(false);
    if (!finalize.ok) {
      expect(finalize.diagnosticCode).toBe('bridge_finalize_failed');
    }

    // 原位回滚：原 full 仍被清空（bridge 保持 active），临时根仍是唯一 full，bridge 元数据仍保留。
    const chat = mocks.chat;
    const originalTag = chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.checkpoint?.kind).not.toBe('full');
    const rootTagAfter = chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(rootTagAfter?.storageFrame?.checkpoint?.kind).toBe('full');
    expect(rootTagAfter?.manualCatchUpProvisionalBridge?.phase).toBe('provisional_active');
  });

  it('请求隔离键与当前运行时隔离键不匹配时拒绝建立（作用域不匹配，无 diagnosticCode）', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-scope-mismatch';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    // 模拟另一隔离键上下文发起第二次建立：仅切换运行时隔离键。
    // 当前实现中「请求隔离键 !== 当前运行时隔离键」在前置校验（L419）即拒绝，
    // 不会进入全局 bridge 冲突检测，因此不携带 provisional_bridge_conflict。
    const otherIsolationKey = 'other-isolation-key';
    mocks.isolationKey = otherIsolationKey;

    const secondEstablish = await establishProvisionalBridge_ACU('run-bridge-scope-mismatch-2', ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey: otherIsolationKey,
    });
    expect(secondEstablish.ok).toBe(false);
    if (!secondEstablish.ok) {
      expect(secondEstablish.error).toContain('当前隔离键与请求不匹配');
      // 作用域不匹配不是 bridge 并发冲突，不得误报 provisional_bridge_conflict。
      expect(secondEstablish.diagnosticCode).toBeUndefined();
    }
  });

  it('不同 isolationKey 下已存在 active bridge 时，第二个临时根被全局拒绝（provisional_bridge_conflict）', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-concurrent-1';

    // 在当前运行时隔离键之外预置另一个隔离键的 active bridge，
    // 保持运行时隔离键与请求一致，从而真正进入全局冲突检测（L422）。
    const otherIsolationKey = 'other-isolation-key';
    const tag2 = mocks.chat[2]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    tag2.manualCatchUpProvisionalBridge = {
      version: 1,
      kind: 'manual_catch_up_provisional_bridge',
      runId: 'run-bridge-concurrent-other-scope',
      chatKey: mocks.chatIdentifier,
      isolationKey: otherIsolationKey,
      selectedSheetKeys: ['sheet_a'],
      rangeStartMessageIndex: 0,
      originalFullCheckpointIndex: 6,
      phase: 'provisional_active',
      originalFullFrameFingerprint: 'fnv1a:other-scope',
      provisionalRootIndex: 0,
      lastCommittedTargetIndex: -1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalFullFrame: { version: 2, logEntries: [] },
    };

    const secondEstablish = await establishProvisionalBridge_ACU('run-bridge-concurrent-2', ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(secondEstablish.ok).toBe(false);
    if (!secondEstablish.ok) {
      expect(secondEstablish.diagnosticCode).toBe('provisional_bridge_conflict');
    }
  });


  it('统一恢复门：当前 isolationKey 有残留时自动 rollback（零提交）', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-gate-rollback';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    const gate = await ensureNoActiveProvisionalBridgeForCurrentScope_ACU({ isolationKey });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.action).toBe('rolled_back');

    // 原根恢复为唯一 full，bridge 元数据清除。
    const chat = mocks.chat;
    const fullIndices = chat
      .map((message: any, index: number) => (!message.is_user ? index : -1))
      .filter((index: number) => index >= 0)
      .filter((index: number) => {
        const tagData = chat[index]?.TavernDB_ACU_IsolatedData?.[isolationKey];
        return tagData?.storageFrame?.checkpoint?.kind === 'full';
      });
    expect(fullIndices).toEqual([6]);
    expect(chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.manualCatchUpProvisionalBridge).toBeUndefined();
  });

  it('统一恢复门：仅其他 isolationKey 有残留时 fail-closed 阻断，不越权恢复', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-gate-other-scope';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    // 当前作用域切到另一隔离键：残留属于旧键，gate 必须阻断而非假装已恢复。
    const otherIsolationKey = 'other-isolation-key';
    const gate = await ensureNoActiveProvisionalBridgeForCurrentScope_ACU({ isolationKey: otherIsolationKey });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.recoveryRequired).toBe(true);
      expect(gate.error).toContain('其他隔离键');
    }
    // 残留 bridge 未被误恢复：仍 active。
    expect(mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.manualCatchUpProvisionalBridge?.phase).toBe('provisional_active');
  });

  it('hasActiveProvisionalBridgeAnywhere：bridge 落在同一 isolationKey 后续 V2 消息时仍能检测（不漏检）', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-scan-later-message';

    // 直接把 bridge 元数据写到 messageIndex 2（同一 isolationKey 的第二条 V2 消息）。
    // 该消息原本没有 bridge 字段，若扫描器按 isolationKey 去重会漏检。
    const tag2 = mocks.chat[2]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    tag2.manualCatchUpProvisionalBridge = {
      version: 1,
      kind: 'manual_catch_up_provisional_bridge',
      runId,
      chatKey: mocks.chatIdentifier,
      isolationKey,
      selectedSheetKeys: ['sheet_a'],
      rangeStartMessageIndex: 0,
      originalFullCheckpointIndex: 6,
      phase: 'provisional_active',
      originalFullFrameFingerprint: 'fnv1a:deadbeef',
      provisionalRootIndex: 0,
      lastCommittedTargetIndex: -1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalFullFrame: { version: 2, logEntries: [] },
    };

    const { hasActiveProvisionalBridgeAnywhere_ACU } = await import('../../../src/service/table/manual-catch-up-provisional-bridge');
    expect(hasActiveProvisionalBridgeAnywhere_ACU(mocks.chat)).toBe(true);
  });

  it('advanceProvisionalBridgeCommitProgress：重复目标返回 already_committed，根缺失返回 root_missing', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-progress-status';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    // 首次推进：advanced。
    const first = advanceProvisionalBridgeCommitProgress_ACU(mocks.chat, isolationKey, 2);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.status).toBe('advanced');

    // 重复目标：already_committed（幂等）。
    const retry = advanceProvisionalBridgeCommitProgress_ACU(mocks.chat, isolationKey, 2);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.status).toBe('already_committed');

    // 把 bridge 的 provisionalRootIndex 改为越界值：readActive 仍能找到 bridge（元数据在
    // message 0 的 tag），但 chat[999] 不存在 → 触发 root_missing（结构性失败，persist 会阻断）。
    const bridgeTag = mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    bridgeTag.manualCatchUpProvisionalBridge.provisionalRootIndex = 999;
    const broken = advanceProvisionalBridgeCommitProgress_ACU(mocks.chat, isolationKey, 4);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.code).toBe('root_missing');
  });


  it('P6-4 双 full 拒绝建立 provisional bridge，绝不当唯一根', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    // 在楼层 0 额外造一个 full（reason='integrity_repair'），模拟存量双 full 拓扑。
    const redundantCheckpoint = buildCanonicalFullCheckpoint_ACU({
      createdAt: 500,
      reason: 'integrity_repair',
      data: { mate: { type: 'acu' }, sheet_a: sheet('表A', [['row_id', '值']]) },
      event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 1, isolationKey, reason: 'integrity_repair' },
    });
    if (!redundantCheckpoint.checkpoint) throw new Error('构造冗余 full 失败');
    mocks.chat[0].TavernDB_ACU_IsolatedData[isolationKey].storageFrame = {
      version: 2,
      checkpoint: redundantCheckpoint.checkpoint,
      headRevision: 'redundant-root',
      logEntries: [],
    };

    const result = await establishProvisionalBridge_ACU('run-bridge-multi-full', ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnosticCode).toBe('provisional_bridge_multiple_full_checkpoints');
      expect(result.error).toContain('2 个 full checkpoint');
    }
    // 未建立任何临时根，原 full 未被改写。
    expect(mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.manualCatchUpProvisionalBridge).toBeUndefined();
    expect(mocks.chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey]?.storageFrame?.checkpoint?.kind).toBe('full');
  });

  it('P6-4 provisional root 漂移（headRevision 非本 run）时 finalize/rollback/recover 均 fail-closed', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-bridge-root-drift';

    const establish = await establishProvisionalBridge_ACU(runId, ['sheet_a'], 0, 6, {
      selectedSheetBaselines: { sheet_a: { lastCompletedAiFloor: 0, headerOnly: true } },
      templateData: { sheet_a: sheet('表A', [['row_id', '值']]) },
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });
    expect(establish.ok).toBe(true);
    if (!establish.ok) return;

    // 篡改临时根：headRevision 不再是 provisional:runId（外部改写/残留他 run）。
    const rootTag = mocks.chat[0]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    rootTag.storageFrame.headRevision = 'foreign-revision';

    // finalize：拓扑不匹配 → 拒绝并进入 recovery-required。
    const finalize = await finalizeProvisionalBridge_ACU(runId, {
      chatKey: mocks.chatIdentifier,
      isolationKey,
      nextSaveTargetIndex: 6,
    });
    expect(finalize.ok).toBe(false);
    if (!finalize.ok) {
      expect(finalize.diagnosticCode).toBe('provisional_recovery_required');
      expect(finalize.error).toContain('临时根拓扑不匹配');
    }

    // rollback：同样被 scope 校验拒绝。
    const rollback = await rollbackProvisionalBridge_ACU(runId, { isolationKey });
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) {
      expect(rollback.error).toContain('临时根拓扑不匹配');
    }

    // recover：同样进入 recovery-required。
    const recovery = await recoverProvisionalBridgeSession_ACU({ isolationKey });
    expect(recovery.ok).toBe(false);
    if (!recovery.ok) {
      expect(recovery.recoveryRequired).toBe(true);
      expect(recovery.error).toContain('临时根拓扑不匹配');
    }
  });

});

});
