/**
 * tests/service/chat/checkpoint-delete-guard.test.ts
 * S0-4 删楼 checkpoint 保管库与前移恢复 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetChatArray,
  mockSaveChatToHostStrict,
  mockRegisterPostChatSaveListener,
  mockAssertSingleFull,
  mockRunTableWriteTransaction,
  mockState,
} = vi.hoisted(() => ({
  mockGetChatArray: vi.fn(),
  mockSaveChatToHostStrict: vi.fn(),
  mockRegisterPostChatSaveListener: vi.fn(),
  mockAssertSingleFull: vi.fn(() => null as string | null),
  mockRunTableWriteTransaction: vi.fn(),
  mockState: { chatKey: 'chat-a' },
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHostStrict_ACU: mockSaveChatToHostStrict,
  registerPostChatSaveListener_ACU: mockRegisterPostChatSaveListener,
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedDataContainer_ACU: (msg: any) => {
    const container = msg?.TavernDB_ACU_IsolatedData;
    return container && typeof container === 'object' && !Array.isArray(container) ? container : null;
  },
  readIsolatedTagData_ACU: (msg: any, isolationKey: string) => {
    const tagData = msg?.TavernDB_ACU_IsolatedData?.[isolationKey];
    return tagData && typeof tagData === 'object' ? tagData : null;
  },
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: (tagData: any) => !!tagData
    && typeof tagData === 'object'
    && tagData.storageFrame?.version === 2
    && Array.isArray(tagData.storageFrame.logEntries),
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  assertSingleActiveFullCheckpointV2_ACU: mockAssertSingleFull,
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mockRunTableWriteTransaction,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mockState.chatKey; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import {
  captureCheckpointVaultForCurrentChat_ACU,
  recoverLostCheckpointsAfterMessageDeletion_ACU,
  installCheckpointDeleteGuard_ACU,
  __getCheckpointVaultForTests_ACU,
  __resetCheckpointDeleteGuardForTests_ACU,
} from '../../../src/service/chat/checkpoint-delete-guard';

function fullCheckpoint(data: Record<string, any> = { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } }) {
  return { kind: 'full' as const, createdAt: 1000, reason: 'compaction' as const, data };
}

function hideCheckpoint(sheetKey: string, activateAt: number) {
  return {
    kind: 'sheet_full' as const,
    createdAt: 2000,
    reason: 'compaction' as const,
    sheetKey,
    data: { name: '休眠表', content: [['row_id', '备注'], ['1', '尘封']] },
    timeline: { kind: 'sheet_hide' as const, activateAtMessageIndex: activateAt, afterSeq: 3 },
  };
}

function aiMsg(mes: string, frame?: any, tagExtras?: Record<string, any>): any {
  const msg: any = { is_user: false, mes };
  if (frame || tagExtras) {
    msg.TavernDB_ACU_IsolatedData = { '': { ...(frame ? { storageFrame: frame, _acu_storage_version: 2 } : {}), ...(tagExtras || {}) } };
  }
  return msg;
}

function userMsg(mes: string): any {
  return { is_user: true, mes };
}

function logFrame(entries: any[] = [{ seq: 1, operations: [] }]) {
  return { version: 2, logEntries: entries };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCheckpointDeleteGuardForTests_ACU();
  mockState.chatKey = 'chat-a';
  mockSaveChatToHostStrict.mockResolvedValue(undefined);
  mockAssertSingleFull.mockReturnValue(null);
  mockRunTableWriteTransaction.mockImplementation(async (_options: any, task: any) => task());
});

describe('captureCheckpointVaultForCurrentChat_ACU', () => {
  it('捕获全部隔离键的产物帧与 log-only 信标', () => {
    const chat = [
      userMsg('u'),
      aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] }),
      aiMsg('inc', logFrame()),
    ];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const vault = __getCheckpointVaultForTests_ACU();
    expect(vault?.chatKey).toBe('chat-a');
    expect(vault?.entryCounts['']).toBe(2);
  });

  it('无 frame 的聊天捕获为空 vault', () => {
    mockGetChatArray.mockReturnValue([userMsg('u'), aiMsg('plain')]);
    captureCheckpointVaultForCurrentChat_ACU();
    expect(__getCheckpointVaultForTests_ACU()?.isolationKeys).toEqual([]);
  });
});

describe('recoverLostCheckpointsAfterMessageDeletion_ACU', () => {
  it('删掉唯一 full 根楼层后嫁接到后继增量帧的 checkpoint 槽位', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame([{ seq: 5, operations: [] }]));
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 宿主删根楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBe(1);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(fullCheckpoint());
    // 后继帧自身的增量日志保持不变（帧内 checkpoint 先于 logs 回放）
    expect(frame.logEntries).toEqual([{ seq: 5, operations: [] }]);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockAssertSingleFull).toHaveBeenCalledWith(chat, '', 'delete_recovery');
  });

  it('删掉携带 hide checkpoint 的楼层后 per-sheet 嫁接且 timeline 重写为目标楼层', async () => {
    const hideMsg = aiMsg('hide', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 2) } });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [userMsg('u'), aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] }), hideMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(2, 1); // 删 hide 楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBe(1);
    const grafted = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_9;
    expect(grafted.data).toEqual(hideCheckpoint('sheet_9', 2).data);
    expect(grafted.timeline).toEqual({
      kind: 'sheet_hide',
      activateAtMessageIndex: chat.indexOf(incMsg),
      afterSeq: 0,
    });
  });

  it('删 log-only 楼层零操作零保存', async () => {
    const chat = [
      aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] }),
      aiMsg('inc', logFrame()),
    ];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 删增量楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.graftedCount).toBe(0);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(mockRunTableWriteTransaction).not.toHaveBeenCalled();
  });

  it('批量删除多个产物楼层时各自嫁接到同一后继帧', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const hideMsg = aiMsg('hide', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 2) } });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, hideMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 2); // 一次删掉 root + hide 两楼
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBe(2);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint?.kind).toBe('full');
    expect(frame.perSheetCheckpoints.sheet_9.timeline.activateAtMessageIndex).toBe(0);
  });

  it('后继帧已有同 sheetKey 的 per-sheet checkpoint 时以幸存者为准跳过', async () => {
    const survivorCheckpoint = { ...hideCheckpoint('sheet_9', 3), createdAt: 9999 };
    const hideMsg = aiMsg('hide-old', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 1) } });
    const newerMsg = aiMsg('hide-new', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: survivorCheckpoint } });
    const chat = [hideMsg, newerMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.graftedCount).toBe(0);
    expect(newerMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_9.createdAt).toBe(9999);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('无后继帧时落到最后 AI 楼层并新建 frame', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const tailMsg = aiMsg('tail'); // 无 frame
    const chat = [rootMsg, tailMsg, userMsg('u-tail')];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    const tagData = tailMsg.TavernDB_ACU_IsolatedData[''];
    expect(tagData._acu_storage_version).toBe(2);
    expect(tagData.storageFrame.checkpoint).toEqual(fullCheckpoint());
    expect(tagData.storageFrame.logEntries).toEqual([]);
  });

  it('无后继帧且最后 AI 楼层携带更早增量帧时清空其 logs（已被恢复的 full 吸收）', async () => {
    const earlierMsg = aiMsg('earlier', logFrame([{ seq: 2, operations: [] }]));
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat = [earlierMsg, rootMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 删最后的 full 根楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    const frame = earlierMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(fullCheckpoint());
    expect(frame.logEntries).toEqual([]);
  });

  it('聊天中已无 AI 楼层时放弃且不保存', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat = [userMsg('u'), rootMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 只剩用户楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('单根断言违规时回滚目标楼层字段且返回错误', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const before = JSON.stringify(incMsg.TavernDB_ACU_IsolatedData);
    mockAssertSingleFull.mockReturnValue('违反单根不变量');

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.error).toContain('违反单根不变量');
    expect(JSON.stringify(incMsg.TavernDB_ACU_IsolatedData)).toBe(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('宿主保存失败时回滚改动、保留保管库、下轮可重试成功', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const before = JSON.stringify(incMsg.TavernDB_ACU_IsolatedData);

    chat.splice(0, 1);
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('host save failed'));
    const failed = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(failed.recovered).toBe(false);
    expect(failed.error).toContain('host save failed');
    expect(JSON.stringify(incMsg.TavernDB_ACU_IsolatedData)).toBe(before);

    const retried = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(retried.recovered).toBe(true);
    expect(incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(fullCheckpoint());
  });

  it('插件保存后 post-save 同步以当前聊天为权威，purge 掉的产物不复活', async () => {
    installCheckpointDeleteGuard_ACU();
    expect(mockRegisterPostChatSaveListener).toHaveBeenCalledTimes(1);
    const postSaveListener = mockRegisterPostChatSaveListener.mock.calls[0][0] as () => void;

    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1); // 插件自身 purge 删掉根楼层
    postSaveListener(); // purge 以插件保存收尾 → vault 权威同步

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(false);
    expect(incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
  });

  it('chatKey 不匹配（切聊后残留事件）时跳过', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat = [rootMsg, aiMsg('inc', logFrame())];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    mockState.chatKey = 'chat-b';
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(false);
    expect(mockRunTableWriteTransaction).not.toHaveBeenCalled();
  });

  it('过渡根丢失时原样嫁接到后继楼层 tagData', async () => {
    const transition = { kind: 'spv79_duplicate_row_id_transition', cutoff: { messageIndex: 0 }, data: { sheet_0: {} } };
    const transitionMsg = aiMsg('transition', logFrame([]), { spv79TransitionCheckpoint: transition });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [transitionMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(incMsg.TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toEqual(transition);
  });
});
