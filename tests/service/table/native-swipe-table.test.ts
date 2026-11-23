import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ chat: [] as any[], save: vi.fn(), replay: vi.fn() }));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.chat, saveChatToHostStrict_ACU: mocks.save,
}));
vi.mock('../../../src/service/chat/chat-service', () => ({ getActiveChatStorageIdentity_ACU: () => 'chat' }));
vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({ getCurrentFlightModeState_ACU: () => ({ enabled: false }) }));
vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: {} }));
vi.mock('../../../src/service/table/manual-catch-up-provisional-bridge', () => ({ readActiveProvisionalBridge_ACU: () => null }));
vi.mock('../../../src/service/table/storage-mode', () => ({ getCurrentStorageMode: () => 'native' }));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2Detailed_ACU: mocks.replay,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: async (_options: unknown, task: (ctx: any) => unknown) =>
    task({ runCommit: (commit: () => unknown) => commit() }),
}));

import {
  captureNativeSwipeTableIntent_ACU, hasNativeSwipeCandidateChange_ACU,
  readDeletedReplyRollback_ACU, readNativeSwipeWorldbookData_ACU, refillNativeSwipeTableCandidate_ACU,
  registerNativeSwipeTableCandidate_ACU, restoreNativeSwipeTableCandidate_ACU,
} from '../../../src/service/table/native-swipe-table';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';

const scope = { chatKey: 'chat', isolationKey: '', isCurrent: () => true };
const archiveField = 'TavernDB_ACU_NativeSwipeState';
const tableField = 'TavernDB_ACU_IsolatedData';

function tag(value: string, source = 'group_fill') {
  return { _acu_storage_version: 2, storageFrame: {
    version: 2, logEntries: [{ source, operations: [] }], headRevision: value,
  } };
}

function seedTag(filled = false) {
  return { ...tag('checkpoint:root'), storageFrame: {
    version: 2, logEntries: [], headRevision: 'checkpoint:root',
    checkpoint: { kind: 'full', reason: 'init', data: { sheet_a: { name: '纪要表' } },
      event: { filledSheetKeys: filled ? ['sheet_a'] : [] } },
  } };
}

function select(slot: number) {
  const message = mocks.chat.at(-1);
  message.swipe_id = slot;
  message.mes = message.swipes[slot];
}

function deliverSwipe(body = 'B') {
  const index = mocks.chat.length - 1;
  const reply = mocks.chat[index];
  reply.swipe_id = reply.swipes.length;
  const intent = captureNativeSwipeTableIntent_ACU(mocks.chat, index);
  expect(intent).not.toBeNull();
  reply.swipes.push(body);
  select(reply.swipe_id);
  return intent!;
}

async function registerSwipe(body = 'B') {
  const intent = deliverSwipe(body);
  expect(['updated', 'registered']).toContain(await registerNativeSwipeTableCandidate_ACU(scope, intent));
  return intent;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue(undefined);
  mocks.replay.mockResolvedValue({ baseKind: 'full_checkpoint' });
  mocks.chat.splice(0, mocks.chat.length,
    { is_user: false, mes: '开场白', [tableField]: { '': seedTag() } },
    { is_user: true, mes: '继续' },
    { is_user: false, mes: 'A', swipe_id: 0, swipes: ['A'], [tableField]: { '': tag('A') } },
  );
});

describe('原生末楼 Swipe 表格视图', () => {
  it('新候选正文尚不存在时，从同一回滚视图回放世界书数据', async () => {
    const reply = mocks.chat[2];
    reply.swipe_id = 1;
    const intent = captureNativeSwipeTableIntent_ACU(mocks.chat, 2)!;
    const baseline = { sheet_a: { content: [['row_id', '名称'], ['1', '前缀']] } };
    mocks.replay.mockImplementationOnce(async (view: any[]) => {
      expect(view[0][tableField]['']).toEqual(seedTag());
      expect(view[2][tableField]['']).toBeUndefined();
      expect(reply[tableField]['']).toEqual(tag('A'));
      return { baseKind: 'full_checkpoint', data: baseline };
    });
    await expect(readNativeSwipeWorldbookData_ACU(intent, 'chat', '', vi.fn())).resolves.toBe(baseline);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('首个原生 Swipe 的前楼独立补填在所有候选间共享，重开后仍保留', async () => {
    const opening = mocks.chat[0][tableField][''];
    const first = tag('A');
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async view => {
      expect(view.chat.map(message => message.mes)).toEqual(['开场白', '继续', 'B']);
      expect(view.chat[0][tableField]['']).toEqual(opening);
      expect(view.chat[2][tableField]['']).toBeUndefined();
      expect(mocks.chat[2][tableField]['']).toBeUndefined();
      view.chat[0][tableField] = { '': seedTag(true) };
      view.onFramesPersisted?.(0, [0]);
      view.chat[2][tableField] = { '': tag('B') };
      view.onFramesPersisted?.(2, [2]);
      return true;
    })).toBe('updated');
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].verifyFields.map((item: any) => item.messageIndex)).toEqual([0, 2, 2]);
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag(true));
    expect(Object.keys(mocks.chat[2][archiveField][''].base)).toEqual(['2']);
    const persisted = structuredClone(mocks.chat);
    mocks.chat.splice(0, mocks.chat.length, ...persisted);

    select(0);
    expect(hasNativeSwipeCandidateChange_ACU(mocks.chat, 2, '')).toBe(true);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag(true));
    expect(mocks.chat[2][tableField]['']).toEqual(first);
    select(1);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag(true));
    expect(mocks.chat[2][tableField]['']).toEqual(tag('B'));
  });

  it('使用候选正文的批次即使也改写前楼，仍按候选恢复', async () => {
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async ({ chat, onFramesPersisted }) => {
      chat[0][tableField] = { '': seedTag(true) };
      chat[2][tableField] = { '': tag('B') };
      onFramesPersisted?.(2, [0, 2]);
      return true;
    })).toBe('updated');
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe('C'), async ({ chat }) => {
      expect(chat[0][tableField]['']).toEqual(seedTag());
      expect(chat[2][tableField]['']).toBeUndefined();
      chat[2][tableField] = { '': tag('C') };
      return true;
    })).toBe('updated');
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag());
    select(1);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag(true));
  });

  it('普通调度没有安排填表时，也能切回原来的表格', async () => {
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async () => true)).toBe('unchanged');
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.chat[2][tableField]['']).toBeUndefined();
    select(0);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(mocks.chat[2][tableField]['']).toEqual(tag('A'));
  });

  it('首稿初始化写出的整库结果从 B 的表格视图中移除', async () => {
    delete mocks.chat[0][tableField];
    mocks.chat[2][tableField] = { '': seedTag(true) };
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async ({ chat }) => {
      expect(chat[2][tableField]['']).toBeUndefined();
      chat[2][tableField] = { '': seedTag(true) };
      return true;
    })).toBe('updated');
  });

  it('填表失败后丢弃已经完成的局部批次', async () => {
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async ({ chat }) => {
      chat[0][tableField] = { '': seedTag(true) };
      return false;
    })).toBe('unchanged');
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag());
    expect(mocks.chat[2][tableField]['']).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('切回 A 后拒绝迟到的 B 结果', async () => {
    await expect(refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async ({ chat }) => {
      chat[2][tableField] = { '': tag('B') };
      select(0);
      await restoreNativeSwipeTableCandidate_ACU(scope, 2);
      return true;
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.chat[2][tableField]['']).toEqual(tag('A'));
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('宿主保存失败时同时恢复全部涉及的楼层与归档', async () => {
    const intent = await registerSwipe();
    const previousArchive = mocks.chat[2][archiveField];
    mocks.save.mockRejectedValueOnce(new Error('host save failed'));
    await expect(refillNativeSwipeTableCandidate_ACU(scope, intent, async ({ chat }) => {
      chat[0][tableField] = { '': seedTag(true) };
      chat[2][tableField] = { '': tag('B') };
      return true;
    })).rejects.toThrow('host save failed');
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag());
    expect(mocks.chat[2][tableField]['']).toBeUndefined();
    expect(mocks.chat[2][archiveField]).toBe(previousArchive);
  });

  it('拒绝给没有归属记录的多个旧候选猜测表格归属', async () => {
    mocks.chat[2].swipes.push('X');
    select(1);
    expect(await registerNativeSwipeTableCandidate_ACU(scope, deliverSwipe())).toBe('unsupported');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('刷新后使用随普通填表保存的标记，识别实际拥有表格的候选', async () => {
    const reply = mocks.chat[2];
    reply.swipes.push('X');
    select(1);
    reply[archiveField] = { '': {
      version: 2, slot: 0, head: 'A', bodyFingerprint: getTableDataFingerprint_ACU('A'),
    } };
    const persisted = structuredClone(mocks.chat);
    mocks.chat.splice(0, mocks.chat.length, ...persisted);
    expect(await refillNativeSwipeTableCandidate_ACU(scope, await registerSwipe(), async ({ chat }) => {
      chat[2][tableField] = { '': tag('B') };
      return true;
    })).toBe('updated');
    expect(mocks.chat[2][archiveField][''].entries.map((entry: any) => entry.body)).toEqual(['A', 'B']);
  });

  it.each([0, 1])('跳过末尾 %s 楼时，下一次 Swipe 可在填表完成前成立', async skipFloors => {
    const intent = await registerSwipe();
    const targetIndex = skipFloors === 0 ? 2 : 0;
    let finish!: () => void;
    const waitForModel = new Promise<void>(resolve => { finish = resolve; });
    const late = refillNativeSwipeTableCandidate_ACU(scope, intent, async ({ chat }) => {
      await waitForModel;
      chat[targetIndex][tableField] = { '': tag('late-B') };
      return true;
    });
    const rejected = expect(late).rejects.toMatchObject({ name: 'AbortError' });
    const next = await registerSwipe('C');
    finish();
    await rejected;
    expect(mocks.chat[0][tableField]['']).toEqual(seedTag());
    expect(mocks.chat[2][tableField]['']).toBeUndefined();
    const persisted = skipFloors === 1 ? seedTag(true) : tag('C');
    expect(await refillNativeSwipeTableCandidate_ACU(scope, next, async ({ chat, onFramesPersisted }) => {
      chat[targetIndex][tableField] = { '': persisted };
      onFramesPersisted?.(targetIndex, [targetIndex]);
      return true;
    })).toBe('updated');
    select(1);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(mocks.chat[0][tableField]['']).toEqual(skipFloors === 1 ? persisted : seedTag());
    expect(mocks.chat[2][tableField]['']).toBeUndefined();
    select(2);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(mocks.chat[targetIndex][tableField]['']).toEqual(persisted);
    const removed = mocks.chat.pop();
    const rollback = readDeletedReplyRollback_ACU(mocks.chat, removed, 'chat', '');
    expect(rollback?.tailTag).toBeNull();
    expect(mocks.chat[0][tableField]['']).toEqual(skipFloors === 1 ? persisted : seedTag());
  });

  it('已有预览版归档仍可恢复，并在保存时换成分支格式', async () => {
    const reply = mocks.chat[2];
    reply.swipes.push('B');
    reply[archiveField] = { '': {
      version: 1, activeBody: 'A', prefixHead: 'checkpoint:root',
      prefixFingerprint: getTableDataFingerprint_ACU([seedTag(), null]),
      entries: [{ body: 'A', tag: tag('A') }, { body: 'B', tag: tag('B') }],
    } };
    select(1);
    expect(await restoreNativeSwipeTableCandidate_ACU(scope, 2)).toBe('updated');
    expect(reply[tableField]['']).toEqual(tag('B'));
    expect(reply[archiveField][''].version).toBe(2);
  });
});
