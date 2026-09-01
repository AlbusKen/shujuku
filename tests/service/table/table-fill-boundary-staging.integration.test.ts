/**
 * tests/service/table/table-fill-boundary-staging.integration.test.ts
 *
 * 跨 full checkpoint 分阶段提交的边界汇合（commitStagedSheetsAtFullBoundaryAtomic_ACU）
 * 真实集成测试。
 *
 * 不用 mock replay / checkpoint builder / write transaction：这三个环节正是
 * 汇合正确性的核心，mock 掉它们等于自证清白。测试按真实时序走：
 *   1. 构造 V2 聊天：AI 楼层 0/2/4 携带空 delta 帧，AI 楼层 6 携带正式 full checkpoint；
 *   2. 调用 boundary commit，把 staging 累计快照折叠为原 full frame 上的 sheet_rebase；
 *   3. 真实 replay 验证 selected sheet 等于 staging 快照、非目标表等于原正式根语义。
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
  chatIdentifier: 'boundary-staging-test-chat',
  isolationKey: '',
  currentJsonTableData: null as any,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
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

import { buildCanonicalFullCheckpoint_ACU } from '../../../src/service/table/canonical-checkpoint-builder';
import { commitStagedSheetsAtFullBoundaryAtomic_ACU } from '../../../src/service/table/table-fill-boundary-staging';
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
 * 构造 V2 聊天：AI 楼层 0/2/4 携带空 delta 帧，AI 楼层 6 携带正式 full checkpoint。
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
          _acu_storage_version: 2,
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

describe('commitStagedSheetsAtFullBoundaryAtomic_ACU 边界汇合（计划 5.4）', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.currentJsonTableData = null;
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    mocks.settings.dataIsolationEnabled = false;
    mocks.settings.dataIsolationCode = '';
    mocks.chatIdentifier = 'boundary-staging-test-chat';
    mocks.isolationKey = '';
  });

  it('把 staging 累计快照原子折叠为原 full frame 上的 sheet_rebase', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const runId = 'run-boundary-commit-1';
    // staging 累计快照：selected sheet 在边界前被填到 'a3'，比原根多一行。
    const stagedSnapshot = {
      mate: { type: 'acu' },
      sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2'], ['3', 'a3']]),
    };

    const result = await commitStagedSheetsAtFullBoundaryAtomic_ACU(runId, {
      originalFullIndex: 6,
      stagedSnapshot,
      targetSheetKeys: ['sheet_a'],
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boundaryCommitSummary).toEqual({
      selectedSheetKeys: ['sheet_a'],
      originalFullCheckpointIndex: 6,
    });

    // 原 full frame 上出现了 sheet_rebase，selected sheet 等于 staging 快照。
    const originalTag = mocks.chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    const rebase = originalTag?.storageFrame?.perSheetCheckpoints?.sheet_a;
    expect(rebase?.kind).toBe('sheet_full');
    expect(rebase?.timeline?.kind).toBe('sheet_rebase');
    expect(rebase?.timeline?.activateAtMessageIndex).toBe(6);
    expect(JSON.stringify(rebase?.data?.content)).toEqual(JSON.stringify(stagedSnapshot.sheet_a.content));

    // 真实 replay 到边界：selected sheet 等于 staging 快照，非目标表等于原根语义。
    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, isolationKey, {
      maxMessageIndex: 6,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(replay).toBeTruthy();
    expect(replay?.baseKind).toBe('full_checkpoint');
    expect(JSON.stringify(replay?.data?.sheet_a?.content)).toEqual(JSON.stringify(stagedSnapshot.sheet_a.content));
  });

  it('多个 full checkpoint 时 fail-closed，不写任何 sheet_rebase', async () => {
    const chat = buildV2ChatWithFormalFull();
    // 在楼层 0 再放一个 full checkpoint，制造多根。
    const mate = { type: 'acu' };
    const dupFull = buildCanonicalFullCheckpoint_ACU({
      createdAt: 900,
      reason: 'manual',
      data: { mate, sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1']]) },
      event: { filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: 0, aiFloor: 0, isolationKey: mocks.isolationKey, reason: 'manual' },
    });
    if (!dupFull.checkpoint) throw new Error(`构造重复 full checkpoint 失败：${dupFull.error}`);
    chat[0].TavernDB_ACU_IsolatedData[mocks.isolationKey] = {
      _acu_storage_version: 2,
      storageFrame: { version: 2, checkpoint: dupFull.checkpoint, headRevision: 'dup-root', logEntries: [] },
    };
    mocks.chat.push(...chat);
    const isolationKey = mocks.isolationKey;

    const result = await commitStagedSheetsAtFullBoundaryAtomic_ACU('run-multi-root', {
      originalFullIndex: 6,
      stagedSnapshot: { mate: { type: 'acu' }, sheet_a: sheet('表A', [['row_id', '值'], ['3', 'a3']]) },
      targetSheetKeys: ['sheet_a'],
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnosticCode).toBe('multiple_full_checkpoints');
    expect(result.error).toContain('2 个 full checkpoint');
    // 原 full frame 未被写入任何 rebase。
    const originalTag = mocks.chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.perSheetCheckpoints?.sheet_a).toBeUndefined();
  });

  it('原 full 根不匹配时 fail-closed，拒绝汇合', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;

    const result = await commitStagedSheetsAtFullBoundaryAtomic_ACU('run-root-mismatch', {
      originalFullIndex: 4,
      stagedSnapshot: { mate: { type: 'acu' }, sheet_a: sheet('表A', [['row_id', '值'], ['3', 'a3']]) },
      targetSheetKeys: ['sheet_a'],
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnosticCode).toBe('full_checkpoint_root_mismatch');
    expect(result.error).toContain('原 full 根不匹配');
  });

  it('strict save 失败时原位回滚 chat，不留下已修改的原根', async () => {
    mocks.chat.push(...buildV2ChatWithFormalFull());
    const isolationKey = mocks.isolationKey;
    const before = JSON.parse(JSON.stringify(mocks.chat));
    mocks.saveChatStrict.mockRejectedValueOnce(new Error('磁盘写入失败'));

    const result = await commitStagedSheetsAtFullBoundaryAtomic_ACU('run-save-fail', {
      originalFullIndex: 6,
      stagedSnapshot: { mate: { type: 'acu' }, sheet_a: sheet('表A', [['row_id', '值'], ['3', 'a3']]) },
      targetSheetKeys: ['sheet_a'],
      chatKey: mocks.chatIdentifier,
      isolationKey,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnosticCode).toBe('boundary_strict_save_failed');
    expect(result.error).toContain('严格保存失败');
    // chat 原位回滚：原 full frame 未被修改。
    expect(JSON.stringify(mocks.chat)).toEqual(JSON.stringify(before));
    const originalTag = mocks.chat[6]?.TavernDB_ACU_IsolatedData?.[isolationKey];
    expect(originalTag?.storageFrame?.perSheetCheckpoints?.sheet_a).toBeUndefined();
  });

  function buildChatWithNonTargetSuffix(options: {
    fullIndex: number;
    suffixIndex: number;
    headIndex: number;
    targetSuffix?: boolean;
  }): { chat: any[]; sheetA120: any; sheetB100: any; sheetBStaged: any } {
    const mate = { type: 'acu' };
    const sheetA100 = sheet('表A', [['row_id', '值'], ['1', 'a-at-full']]);
    const sheetB100 = sheet('表B', [['row_id', '值'], ['1', 'b-at-full']]);
    const sheetA120 = sheet('表A', [['row_id', '值'], ['1', 'a-at-suffix']]);
    const sheetBStaged = sheet('表B', [['row_id', '值'], ['1', 'b-at-full'], ['2', 'b-staged']]);
    const sheetBSuffix = sheet('表B', [['row_id', '值'], ['1', 'b-at-suffix']]);
    const fullCheckpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: 1000,
      reason: 'manual',
      data: { mate, sheet_a: sheetA100, sheet_b: sheetB100 },
      event: { filledSheetKeys: ['sheet_a', 'sheet_b'], changedSheetKeys: ['sheet_a', 'sheet_b'], groupKeys: [] },
      context: { messageIndex: options.fullIndex, aiFloor: 1, isolationKey: mocks.isolationKey, reason: 'manual' },
    });
    if (!fullCheckpointResult.checkpoint) throw new Error(`构造 full checkpoint 失败：${fullCheckpointResult.error}`);
    const chat: any[] = [];
    for (let index = 0; index <= options.headIndex; index += 1) {
      if (index === options.fullIndex) {
        chat.push({
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
        });
        continue;
      }
      if (index === options.suffixIndex) {
        const operations = options.targetSuffix
          ? [{ kind: 'sheet_replace', sheetKey: 'sheet_b', sheet: sheetBSuffix, reason: 'manual_crud' as const }]
          : [{ kind: 'sheet_replace', sheetKey: 'sheet_a', sheet: sheetA120, reason: 'manual_crud' as const }];
        chat.push({
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            [mocks.isolationKey]: {
              _acu_storage_version: 2,
              storageFrame: {
                version: 2,
                logEntries: [{
                  seq: 1,
                  entryId: 'suffix-edit',
                  createdAt: 2000,
                  source: 'manual_crud',
                  targetMessageIndex: options.suffixIndex,
                  aiFloor: 2,
                  filledSheetKeys: [],
                  changedSheetKeys: [options.targetSuffix ? 'sheet_b' : 'sheet_a'],
                  operations,
                }],
              },
            },
          },
        });
        continue;
      }
      chat.push({ is_user: index % 2 === 1, mes: `m${index}` });
    }
    return { chat, sheetA120, sheetB100, sheetBStaged };
  }

  it('full=100/A@120/head=122：只重填 B 时保留 A 的 checkpoint 后合法增量', async () => {
    const fixture = buildChatWithNonTargetSuffix({ fullIndex: 100, suffixIndex: 120, headIndex: 122 });
    mocks.chat.push(...fixture.chat);

    const result = await commitStagedSheetsAtFullBoundaryAtomic_ACU('run-100-120-122', {
      originalFullIndex: 100,
      stagedSnapshot: { sheet_b: fixture.sheetBStaged },
      targetSheetKeys: ['sheet_b'],
      chatKey: mocks.chatIdentifier,
      isolationKey: mocks.isolationKey,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verifiedHeadSnapshot.sheet_a.content).toEqual(fixture.sheetA120.content);
    expect(result.verifiedHeadSnapshot.sheet_b.content).toEqual(fixture.sheetBStaged.content);

    const replayHead = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, {
      maxMessageIndex: 122,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(JSON.stringify(replayHead?.data?.sheet_a?.content)).toEqual(JSON.stringify(fixture.sheetA120.content));
    expect(JSON.stringify(replayHead?.data?.sheet_b?.content)).toEqual(JSON.stringify(fixture.sheetBStaged.content));

    const fullFrames = mocks.chat.filter((message: any) => message?.TavernDB_ACU_IsolatedData?.[mocks.isolationKey]?.storageFrame?.checkpoint?.kind === 'full');
    expect(fullFrames).toHaveLength(1);
    expect(mocks.chat[100].TavernDB_ACU_IsolatedData[mocks.isolationKey].storageFrame.logEntries).toEqual([]);
    expect(mocks.chat[120].TavernDB_ACU_IsolatedData[mocks.isolationKey].storageFrame.logEntries).toHaveLength(1);
  });

  it('目标表 checkpoint 后存在 suffix log 时，head 校验允许 suffix 继续生效', async () => {
    const fixture = buildChatWithNonTargetSuffix({ fullIndex: 6, suffixIndex: 8, headIndex: 10, targetSuffix: true });
    mocks.chat.push(...fixture.chat);
    const stagedB = sheet('表B', [['row_id', '值'], ['1', 'b-rebased']]);

    const result = await commitStagedSheetsAtFullBoundaryAtomic_ACU('run-target-suffix', {
      originalFullIndex: 6,
      stagedSnapshot: { sheet_b: stagedB },
      targetSheetKeys: ['sheet_b'],
      chatKey: mocks.chatIdentifier,
      isolationKey: mocks.isolationKey,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replayHead = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, {
      maxMessageIndex: 10,
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(JSON.stringify(replayHead?.data?.sheet_b?.content)).not.toEqual(JSON.stringify(stagedB.content));
    expect(replayHead?.data?.sheet_b?.content?.[1]?.[1]).toBe('b-at-suffix');
  });
});
