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
  mockReadDeletedReplyRollback,
  mockState,
} = vi.hoisted(() => ({
  mockGetChatArray: vi.fn(),
  mockSaveChatToHostStrict: vi.fn(),
  mockRegisterPostChatSaveListener: vi.fn(),
  mockAssertSingleFull: vi.fn(() => null as string | null),
  mockRunTableWriteTransaction: vi.fn(),
  mockReadDeletedReplyRollback: vi.fn(),
  mockState: { chatKey: 'chat-a' },
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHostStrict_ACU: mockSaveChatToHostStrict,
  registerPostChatSaveListener_ACU: mockRegisterPostChatSaveListener,
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  cloneIsolatedData_ACU: (msg: any) => structuredClone(msg?.TavernDB_ACU_IsolatedData ?? {}),
  readIsolatedDataContainer_ACU: (msg: any) => {
    const container = msg?.TavernDB_ACU_IsolatedData;
    return container && typeof container === 'object' && !Array.isArray(container) ? container : null;
  },
  readIsolatedTagData_ACU: (msg: any, isolationKey: string) => {
    const tagData = msg?.TavernDB_ACU_IsolatedData?.[isolationKey];
    return tagData && typeof tagData === 'object' ? tagData : null;
  },
}));
vi.mock('../../../src/service/table/native-swipe-table', () => ({
  readDeletedReplyRollback_ACU: mockReadDeletedReplyRollback,
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
import { registerMaterialCheckpointRecoveryAdapter_ACU } from '../../../src/service/chat/material-checkpoint-sync';

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
  mockReadDeletedReplyRollback.mockReturnValue(null);
});

it('重生成删楼保留幸存楼层的补填，并且不嫁接被删回复自己的整库结果', async () => {
  const earlier = aiMsg('早期楼层', logFrame([{ seq: 2, operations: [] }]));
  const reply = aiMsg('B', { ...logFrame(), checkpoint: fullCheckpoint() });
  const chat = [earlier, userMsg('继续'), reply];
  mockGetChatArray.mockReturnValue(chat);
  const earlierData = earlier.TavernDB_ACU_IsolatedData;
  mockReadDeletedReplyRollback.mockReturnValue({ tailTag: null, isCurrent: () => true });
  captureCheckpointVaultForCurrentChat_ACU();
  chat.pop();
  expect(await recoverLostCheckpointsAfterMessageDeletion_ACU()).toMatchObject({ recovered: false, graftedCount: 0 });
  expect(mockReadDeletedReplyRollback).toHaveBeenCalledWith(chat, reply, 'chat-a', '');
  expect(earlier.TavernDB_ACU_IsolatedData).toBe(earlierData);
  expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
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
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints).toBeUndefined();
    const grafted = frame.sheetTimelineEvents[0].checkpoint;
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
    expect(frame.sheetTimelineEvents[0].checkpoint.timeline.activateAtMessageIndex).toBe(0);
  });

  it('后继帧已有同 sheetKey 的无时间快照时以幸存者为准跳过', async () => {
    const { timeline: _timeline, ...untimedCheckpoint } = hideCheckpoint('sheet_9', 1);
    const survivorCheckpoint = { ...untimedCheckpoint, createdAt: 9999 };
    const hideMsg = aiMsg('old', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: untimedCheckpoint } });
    const newerMsg = aiMsg('new', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: survivorCheckpoint } });
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

  it('旧 map 的 timed hide 不因后继同 key reveal 被丢弃，非 timeline shard 留在 map', async () => {
    const hide = hideCheckpoint('sheet_9', 0);
    const reveal = { ...hide, createdAt: 3000, timeline: { ...hide.timeline, kind: 'sheet_reveal', afterSeq: 0 } };
    const { timeline: _timeline, ...untimed } = hideCheckpoint('sheet_other', 0);
    const lost = aiMsg('旧 hide', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hide } });
    const survivor = aiMsg('后继 reveal', {
      version: 2, logEntries: [{ seq: 5, operations: [] }],
      perSheetCheckpoints: { sheet_9: reveal, sheet_other: untimed },
    });
    const chat = [lost, survivor];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(0, 1);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result).toMatchObject({ recovered: true, graftedCount: 1 });
    const frame = survivor.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints).toEqual({ sheet_other: untimed });
    expect(frame.sheetTimelineEvents.map((event: any) => event.ordinal)).toEqual([0, 1]);
    expect(frame.sheetTimelineEvents.map((event: any) => event.checkpoint.timeline.kind)).toEqual(['sheet_hide', 'sheet_reveal']);
    expect(frame.sheetTimelineEvents.every((event: any) => event.checkpoint.timeline.afterSeq === 0)).toBe(true);
    expect(frame.logEntries).toEqual([{ seq: 5, operations: [] }]);
  });

  it('同 key 多次事件前移到幸存 reveal 之前，保留间隔 ordinal 与后继日志屏障', async () => {
    const hide = hideCheckpoint('sheet_9', 0);
    const reveal = { ...hide, timeline: { ...hide.timeline, kind: 'sheet_reveal', afterSeq: 3 } };
    const lost = aiMsg('往返', { version: 2, logEntries: [], sheetTimelineEvents: [
      { ordinal: 2, checkpoint: hide },
      { ordinal: 8, checkpoint: reveal },
      { ordinal: 11, checkpoint: hide },
    ] });
    const survivor = aiMsg('后继', { version: 2, logEntries: [{ seq: 5, operations: [] }], sheetTimelineEvents: [
      { ordinal: 2, checkpoint: { ...reveal, timeline: { ...reveal.timeline, afterSeq: 0 } } },
    ] });
    const chat = [lost, survivor];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(0, 1);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result).toMatchObject({ recovered: true, graftedCount: 3 });
    const frame = survivor.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.sheetTimelineEvents.map((event: any) => event.ordinal)).toEqual([0, 1, 2, 3]);
    expect(frame.sheetTimelineEvents.map((event: any) => event.checkpoint.timeline.kind)).toEqual([
      'sheet_hide', 'sheet_reveal', 'sheet_hide', 'sheet_reveal',
    ]);
    expect(frame.sheetTimelineEvents.every((event: any) => event.checkpoint.timeline.afterSeq === 0)).toBe(true);
    expect(frame.logEntries).toEqual([{ seq: 5, operations: [] }]);
  });

  it('批量删楼保留各帧同 key 事件的物理顺序，并将幸存 legacy timeline 放在最后', async () => {
    const hide = hideCheckpoint('sheet_9', 0);
    const reveal = { ...hide, timeline: { ...hide.timeline, kind: 'sheet_reveal' } };
    const first = aiMsg('早', { version: 2, logEntries: [], sheetTimelineEvents: [{ ordinal: 6, checkpoint: hide }] });
    const second = aiMsg('晚', { version: 2, logEntries: [], sheetTimelineEvents: [{ ordinal: 0, checkpoint: reveal }] });
    const survivor = aiMsg('幸存', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hide } });
    const chat = [first, second, survivor];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(0, 2);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result).toMatchObject({ recovered: true, graftedCount: 2 });
    const frame = survivor.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.perSheetCheckpoints?.sheet_9).toBeUndefined();
    expect(frame.sheetTimelineEvents.map((event: any) => event.checkpoint.timeline.kind)).toEqual([
      'sheet_hide', 'sheet_reveal', 'sheet_hide',
    ]);
  });

  it('无后继时事件追加在更早幸存帧的真实日志尾，不回到帧首', async () => {
    const survivor = aiMsg('早', logFrame([{ seq: 7, operations: [] }]));
    const lost = aiMsg('末', { version: 2, logEntries: [], sheetTimelineEvents: [
      { ordinal: 4, checkpoint: hideCheckpoint('sheet_9', 1) },
    ] });
    const chat = [survivor, lost];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(1, 1);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result).toMatchObject({ recovered: true, graftedCount: 1 });
    const frame = survivor.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.sheetTimelineEvents[0].checkpoint.timeline).toMatchObject({ afterSeq: 7, activateAtMessageIndex: 0 });
    expect(frame.logEntries).toEqual([{ seq: 7, operations: [] }]);
  });

  it('批量删除末尾多楼时按原物理顺序追加混合 map 与新事件，且不撤销幸存 SQL', async () => {
    const hide = hideCheckpoint('sheet_9', 1);
    const reveal = { ...hide, timeline: { ...hide.timeline, kind: 'sheet_reveal' } };
    const survivor = aiMsg('根', {
      version: 2, checkpoint: fullCheckpoint(), logEntries: [{ seq: 7, operations: [] }],
      sheetTimelineEvents: [{ ordinal: 8, checkpoint: { ...reveal, timeline: { ...reveal.timeline, afterSeq: 7 } } }],
    });
    const first = aiMsg('较早 hide', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hide } });
    const second = aiMsg('较晚 reveal', {
      version: 2, logEntries: [], sheetTimelineEvents: [{ ordinal: 0, checkpoint: reveal }],
    });
    const chat = [survivor, first, second];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(1, 2);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result).toMatchObject({ recovered: true, graftedCount: 2 });
    const frame = survivor.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.sheetTimelineEvents.map((event: any) => event.ordinal)).toEqual([0, 1, 2]);
    expect(frame.sheetTimelineEvents.map((event: any) => event.checkpoint.timeline.kind)).toEqual([
      'sheet_reveal', 'sheet_hide', 'sheet_reveal',
    ]);
    expect(frame.sheetTimelineEvents.slice(1).map((event: any) => event.checkpoint.timeline)).toEqual([
      { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 7 },
      { kind: 'sheet_reveal', activateAtMessageIndex: 0, afterSeq: 7 },
    ]);
    expect(frame.logEntries).toEqual([{ seq: 7, operations: [] }]);
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

  it('删掉向量 checkpoint 楼层后嫁接到同一后继 frame，且不覆盖已有向量 checkpoint', async () => {
    const vectorCheckpoint = {
      kind: 'vector_full',
      createdAt: 1111,
      reason: 'initial',
      sourceTableKey: 'sheet_summary',
      tableCheckpointFingerprint: 'fp',
      embedding: { provider: 'x', model: 'm', dimension: 2 },
      rowCount: 1,
      vectorRevision: 'rev-1',
      manifestRef: { manifestHash: 'h', path: 'TavernDB_ACU_vector_v2vcp_x_h', byteLength: 1 },
      packRefs: [],
    };
    const rootMsg = aiMsg('root', {
      version: 2,
      checkpoint: fullCheckpoint(),
      logEntries: [],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: 'sheet_summary',
        checkpoint: vectorCheckpoint,
        logEntries: [],
      },
    });
    const incMsg = aiMsg('inc', logFrame([{ seq: 5, operations: [] }]));
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBeGreaterThanOrEqual(2);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(fullCheckpoint());
    expect(frame.summaryVectorIndexFrame.checkpoint).toEqual(vectorCheckpoint);
    expect(frame.logEntries).toEqual([{ seq: 5, operations: [] }]);
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

  it('删掉带续写基线的楼层后，基线嫁到后继楼，断言失败则回滚且不保存', async () => {
    const captureContinuation = (message: unknown) => {
      const marker = (message as { _qrf_continuation_agent?: { swipeId: string; snapshot: unknown } })._qrf_continuation_agent;
      return marker ? { continuation: marker, simulation: null } : null;
    };
    registerMaterialCheckpointRecoveryAdapter_ACU({
      capture: captureContinuation,
      graftContinuation(message, artifact) {
        const target = message as { _qrf_continuation_agent?: unknown };
        if (target._qrf_continuation_agent) return false;
        target._qrf_continuation_agent = artifact;
        return true;
      },
      graftSimulation() { return false; },
      assertContinuation() { return null; },
      assertSimulation() { return null; },
    });
    const root = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    root._qrf_continuation_agent = { swipeId: '0', snapshot: { hooks: ['H1'] } };
    const survivor = aiMsg('survivor', logFrame());
    const chat = [root, survivor];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(0, 1);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(survivor._qrf_continuation_agent).toEqual({ swipeId: '0', snapshot: { hooks: ['H1'] } });
    expect(mockSaveChatToHostStrict).toHaveBeenCalled();

    delete survivor._qrf_continuation_agent;
    captureCheckpointVaultForCurrentChat_ACU();
    const pluginDelete = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(pluginDelete.recovered).toBe(false);
    expect(survivor._qrf_continuation_agent).toBeUndefined();

    registerMaterialCheckpointRecoveryAdapter_ACU({
      capture: captureContinuation,
      graftContinuation(message, artifact) {
        (message as { _qrf_continuation_agent?: unknown })._qrf_continuation_agent = artifact;
        return true;
      },
      graftSimulation() { return false; },
      assertContinuation() { return '续写资料存在多个活跃基线'; },
      assertSimulation() { return null; },
    });
    const again = aiMsg('root2', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    again._qrf_continuation_agent = { swipeId: '0', snapshot: { hooks: ['H2'] } };
    const keep = aiMsg('keep', logFrame());
    const second = [again, keep];
    mockGetChatArray.mockReturnValue(second);
    captureCheckpointVaultForCurrentChat_ACU();
    second.splice(0, 1);
    mockSaveChatToHostStrict.mockClear();

    const rolled = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(rolled.recovered).toBe(false);
    expect(rolled.error).toContain('多个活跃基线');
    expect(keep._qrf_continuation_agent).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });
});
