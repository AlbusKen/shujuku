import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostChatSaveNotStartedError_ACU } from '../../../src/data/gateways/chat-gateway';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import {
  WORLD_DISPATCH_JOURNAL_FIELD_ACU,
  WorldDispatchHostStore_ACU,
} from '../../../src/service/simulation/world-dispatch-host-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import type { WorldDispatchRecord_ACU } from '../../../src/service/simulation/world-dispatch-journal';

let fixtureNumber = 0;

function digestSeed(seed: string): string {
  return sha256HexSync_ACU(seed);
}

function responseJson(value: unknown): Response {
  return { ok: true, json: async () => structuredClone(value) } as Response;
}

function fixture(options: { save?: (chat: any[], setRemote: (value: any[]) => void) => Promise<void>; minimalHost?: boolean } = {}) {
  const id = `dispatch-chat-${++fixtureNumber}`;
  const chat: any[] = [
    { is_system: true },
    { message_id: 41, is_user: false, swipe_id: 0, mes: '原始 assistant 正文', swipes: ['原始 assistant 正文'] },
    { message_id: 42, is_user: false, swipe_id: 0, mes: '后继 assistant 正文', swipes: ['后继 assistant 正文'] },
  ];
  let remote = structuredClone(chat);
  const setRemote = (value: any[]): void => { remote = structuredClone(value); };
  const saveChat = vi.fn(async () => {
    if (options.save) return options.save(chat, setRemote);
    setRemote(chat);
  });
  _set_SillyTavern_API_ACU({ chat, ...(!options.minimalHost ? { chatId: id, groupId: `group-${id}` } : {}), getCurrentChatId: () => id, saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => responseJson(remote)));
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  return {
    chat,
    anchor,
    saveChat,
    store: new WorldDispatchHostStore_ACU(anchor),
    setRemote,
    getRemote: () => remote,
    intent(deliveryId: string): Omit<WorldDispatchRecord_ACU, 'successor'> {
      return {
        deliveryId,
        source: {
          chatIdentity: anchor.chatIdentity,
          messageKey: anchor.messageKey,
          swipeId: anchor.swipeId,
          contentDigest: anchor.contentDigest,
        },
        ledgerRevision: 7,
        ledgerFingerprint: digestSeed(`b${deliveryId}`),
        factIds: [`fact-${deliveryId}`],
        requestFingerprint: digestSeed(`c${deliveryId}`),
        createdAt: 100,
      };
    },
  };
}

describe('WorldDispatchHostStore_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _set_SillyTavern_API_ACU(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('缺少字段时只读返回空 journal，绝不保存或创建字段', () => {
    const f = fixture();

    expect(f.store.read()).toEqual({ schemaVersion: 1, revision: 0, records: [] });
    expect(f.chat[1]).not.toHaveProperty(WORLD_DISPATCH_JOURNAL_FIELD_ACU);
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('意图只严格保存一次；相同 deliveryId 幂等且不再次保存', async () => {
    const f = fixture();
    const intent = f.intent('delivery-1');

    await expect(f.store.recordIntent(intent)).resolves.toMatchObject({ revision: 1, records: [{ deliveryId: 'delivery-1' }] });
    await expect(f.store.recordIntent(structuredClone(intent))).resolves.toMatchObject({ revision: 1, records: [{ deliveryId: 'delivery-1' }] });

    expect(f.saveChat).toHaveBeenCalledTimes(1);
    expect(f.getRemote()[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU].entries).toEqual(
      f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU].entries,
    );
  });

  it('宿主仅有 chat、getCurrentChatId、saveChat 时保存意图和后继均成功，不发 fetch', async () => {
    const f = fixture({ minimalHost: true });
    const intent = f.intent('minimal-host');
    await expect(f.store.recordIntent(intent)).resolves.toMatchObject({ revision: 1 });
    await expect(f.store.observeSuccessor(intent.deliveryId, resolveWorldSimulationAnchor_ACU(2, f.chat), 101))
      .resolves.toMatchObject({ revision: 2, records: [{ successor: { anchor: { messageKey: 'number:42' } } }] });
    expect(f.saveChat).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.store.read()).toMatchObject({ revision: 2 });
  });

  it('并发不同 deliveryId 在同一 chat 队列内重新读取基线，不丢失记录', async () => {
    const f = fixture();

    await Promise.all([f.store.recordIntent(f.intent('delivery-a')), f.store.recordIntent(f.intent('delivery-b'))]);

    expect(f.store.read()).toMatchObject({ revision: 2, records: [
      { deliveryId: 'delivery-a' }, { deliveryId: 'delivery-b' },
    ] });
    expect(f.saveChat).toHaveBeenCalledTimes(2);
  });

  it('source 正文摘要或 swipe 改变时拒绝，不触碰新状态', async () => {
    const f = fixture();
    f.chat[1].mes = '已被编辑的正文';

    await expect(f.store.recordIntent(f.intent('delivery-stale'))).rejects.toThrow();
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(f.chat[1]).not.toHaveProperty(WORLD_DISPATCH_JOURNAL_FIELD_ACU);

    const fresh = fixture();
    fresh.chat[1].swipe_id = 1;
    await expect(fresh.store.recordIntent(fresh.intent('delivery-swipe'))).rejects.toThrow();
    expect(fresh.saveChat).not.toHaveBeenCalled();
  });

  it('仅采纳当前宿主实际后继楼层，不接受调用者伪造的摘要', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('delivery-successor'));
    const fakeHint = { ...resolveWorldSimulationAnchor_ACU(2, f.chat), contentDigest: digestSeed('forged') };

    await expect(f.store.observeSuccessor('delivery-successor', fakeHint, 101)).rejects.toThrow('WORLD_DISPATCH_SUCCESSOR_INVALID');
    const actualHint = resolveWorldSimulationAnchor_ACU(2, f.chat);
    await expect(f.store.observeSuccessor('delivery-successor', actualHint, 101)).resolves.toMatchObject({
      revision: 2,
      records: [{ successor: { anchor: { messageKey: 'number:42' } } }],
    });

    const journal = f.store.read();
    expect(journal.records[0].successor!.anchor.contentDigest).toBe(resolveWorldSimulationAnchor_ACU(2, f.chat).contentDigest);
    await expect(f.store.observeSuccessor('delivery-successor', actualHint, 101)).resolves.toEqual(journal);
    expect(f.saveChat).toHaveBeenCalledTimes(2);
  });

  it('后继只能是源之后第一条 assistant，允许中间用户楼层但不能跳过更早正文', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('first-successor'));
    f.chat.splice(2, 0, { message_id: 90, is_user: true, mes: '用户追问' });
    f.chat.push({ message_id: 43, is_user: false, swipe_id: 0, mes: '更晚的 assistant 正文' });
    const later = resolveWorldSimulationAnchor_ACU(4, f.chat);
    await expect(f.store.observeSuccessor('first-successor', later, 101)).rejects.toThrow('不能跳过更早的 assistant');
    expect(f.saveChat).toHaveBeenCalledTimes(1);
    const first = resolveWorldSimulationAnchor_ACU(3, f.chat);
    const observed = await f.store.observeSuccessor('first-successor', first, 101);
    expect(observed.records[0].successor?.anchor.messageKey).toBe('number:42');
  });

  it('被 is_system 隐藏的真实 assistant 仍是第一后继，narrator 则不阻断', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('hidden-assistant'));
    f.chat[2].is_system = true;
    f.chat.push({ message_id: 43, is_user: false, swipe_id: 0, mes: '更晚正文' });
    const later = resolveWorldSimulationAnchor_ACU(3, f.chat);
    await expect(f.store.observeSuccessor('hidden-assistant', later, 101)).rejects.toThrow('不能跳过更早的 assistant');
    f.chat.splice(2, 0, { message_id: 88, is_user: false, extra: { type: 'narrator' }, mes: '旁白' });
    const first = resolveWorldSimulationAnchor_ACU(3, f.chat);
    const result = await f.store.observeSuccessor('hidden-assistant', first, 101);
    expect(result.records[0].successor?.anchor.messageKey).toBe('number:42');
  });

  it('保存结果未知会阻止所有实例继续读写；recover 从服务器 previous 恢复且不保存', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ save: async () => { throw new Error('SAVE_RESPONSE_LOST'); } });
    await expect(f.store.recordIntent(f.intent('delivery-unknown-previous'))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    expect(fetch).not.toHaveBeenCalled();
    const another = new WorldDispatchHostStore_ACU(f.anchor);
    expect(() => another.read()).toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    await expect(another.recordIntent(f.intent('delivery-blocked'))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');

    await expect(another.recover()).resolves.toMatchObject({ status: 'previous', journal: { revision: 0, records: [] } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.saveChat).toHaveBeenCalledTimes(1);
    _set_SillyTavern_API_ACU({ chat: f.chat, chatId: f.anchor.chatIdentity, groupId: `group-${f.anchor.chatIdentity}`,
      getCurrentChatId: () => f.anchor.chatIdentity, saveChat: async () => f.setRemote(f.chat) } as any);
    await expect(another.recordIntent(f.intent('delivery-unknown-previous'))).resolves.toMatchObject({ revision: 1 });
  });

  it('服务器已是候选值时 recover 只确认 candidate，不把它称为新的发送', async () => {
    const f = fixture({ save: async (chat, setRemote) => {
      setRemote(chat);
      throw new Error('SAVE_RESPONSE_LOST_AFTER_COMMIT');
    } });
    await expect(f.store.recordIntent(f.intent('delivery-unknown-candidate'))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');

    await expect(f.store.recover()).resolves.toMatchObject({ status: 'candidate', journal: {
      revision: 1, records: [{ deliveryId: 'delivery-unknown-candidate' }],
    } });
    expect(f.saveChat).toHaveBeenCalledTimes(1);
    await expect(f.store.recordIntent(f.intent('delivery-unknown-candidate'))).resolves.toMatchObject({ revision: 1 });
    expect(f.saveChat).toHaveBeenCalledTimes(1);
  });

  it('recover 通过服务器 source 精确定位，不使用旧 messageIndex；重复 source 拒绝恢复', async () => {
    const f = fixture({ save: async () => { throw new Error('SAVE_RESPONSE_LOST'); } });
    await expect(f.store.recordIntent(f.intent('delivery-remote-relocate'))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    const persistedCandidate = structuredClone(f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]);
    f.setRemote([
      { is_system: true },
      { is_user: true, mes: '新插入楼层' },
      { message_id: 41, is_user: false, swipe_id: 0, mes: '原始 assistant 正文', [WORLD_DISPATCH_JOURNAL_FIELD_ACU]: persistedCandidate },
      { message_id: 42, is_user: false, swipe_id: 0, mes: '后继 assistant 正文' },
    ]);
    await expect(f.store.recover()).resolves.toMatchObject({ status: 'candidate', journal: { revision: 1 } });

    const duplicate = fixture({ save: async () => { throw new Error('SAVE_RESPONSE_LOST'); } });
    await expect(duplicate.store.recordIntent(duplicate.intent('delivery-remote-duplicate'))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    const candidate = structuredClone(duplicate.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]);
    duplicate.setRemote([
      { is_system: true },
      { message_id: 41, is_user: false, swipe_id: 0, mes: '原始 assistant 正文', [WORLD_DISPATCH_JOURNAL_FIELD_ACU]: candidate },
      { message_id: 41, is_user: false, swipe_id: 0, mes: '原始 assistant 正文', [WORLD_DISPATCH_JOURNAL_FIELD_ACU]: candidate },
    ]);
    await expect(duplicate.store.recover()).rejects.toThrow('WORLD_DISPATCH_RECOVERY_UNRESOLVED');
  });

  it('运行时拒绝 logical anchor，保存途中本地字段变更进入 unknown 而不覆盖外部值', async () => {
    const f = fixture();
    expect(() => new WorldDispatchHostStore_ACU({ kind: 'logical', chatIdentity: f.anchor.chatIdentity,
      logicalRef: { sessionId: 's', branchId: 'b', turnId: 't', attemptId: 'a', floorId: 'f' },
      contentDigest: f.anchor.contentDigest } as any)).toThrow();

    let release!: () => void;
    f.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      f.setRemote(f.chat);
    });
    const pending = f.store.recordIntent(f.intent('delivery-local-overwrite'));
    await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledOnce());
    const external = { external: 'must-not-overwrite' };
    f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU] = external;
    release();
    await expect(pending).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    expect(f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]).toBe(external);
  });

  it('坏字段与伪造 source 不被伪装为空日志，也不发生保存', async () => {
    const damaged = fixture();
    damaged.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU] = { schemaVersion: 1, entries: { bad: {} } };
    expect(() => damaged.store.read()).toThrow('WORLD_DISPATCH_HOST_INVALID');
    await expect(damaged.store.recordIntent(damaged.intent('bad'))).rejects.toThrow('WORLD_DISPATCH_HOST_INVALID');
    expect(damaged.saveChat).not.toHaveBeenCalled();
    const forged = fixture();
    await expect(forged.store.recordIntent({ ...forged.intent('forged'), source: {
      ...forged.intent('forged').source, contentDigest: digestSeed('not-the-source'),
    } })).rejects.toThrow('WORLD_DISPATCH_SOURCE_STALE');
    expect(forged.saveChat).not.toHaveBeenCalled();
  });

  it('本地源楼层移动时仍通过唯一 message key 保存，其他 swipe 桶完整保留', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('swipe-zero'));
    const firstField = structuredClone(f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]);
    f.chat[1].swipes.push('第二个 swipe 正文');
    f.chat[1].swipe_id = 1; f.chat[1].mes = '第二个 swipe 正文';
    const secondAnchor = resolveWorldSimulationAnchor_ACU(1, f.chat);
    const secondStore = new WorldDispatchHostStore_ACU(secondAnchor);
    await secondStore.recordIntent({ ...f.intent('swipe-one'), source: {
      chatIdentity: secondAnchor.chatIdentity, messageKey: secondAnchor.messageKey,
      swipeId: secondAnchor.swipeId, contentDigest: secondAnchor.contentDigest,
    } });
    const combined = f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU];
    expect(Object.keys(combined.entries)).toHaveLength(2);
    for (const [key, value] of Object.entries(firstField.entries)) expect(combined.entries[key]).toEqual(value);
    f.chat[1].swipe_id = 0; f.chat[1].mes = '原始 assistant 正文';
    const source = f.chat[1];
    f.chat.unshift({ is_user: true, mes: '源前新增楼层' });
    await f.store.recordIntent(f.intent('moved-source'));
    expect(f.store.read().records.map(item => item.deliveryId)).toEqual(['swipe-zero', 'moved-source']);
    expect(source.mes).toBe('原始 assistant 正文');
    expect(Object.keys(source[WORLD_DISPATCH_JOURNAL_FIELD_ACU].entries)).toHaveLength(2);
  });

  it('并发 recover 串行只恢复一次，之后显式 intent 可正常保存', async () => {
    const f = fixture();
    f.saveChat.mockRejectedValueOnce(new Error('lost before remote commit'));
    const intent = f.intent('recover-once');
    await expect(f.store.recordIntent(intent)).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    let release!: () => void;
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return responseJson(f.getRemote());
    });
    const first = f.store.recover();
    const second = f.store.recover();
    const secondRejected = expect(second).rejects.toThrow('WORLD_DISPATCH_RECOVERY_UNAVAILABLE');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(() => f.store.read()).toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    release();
    await expect(first).resolves.toMatchObject({ status: 'previous' });
    await secondRejected;
    await f.store.recordIntent(intent);
    expect(f.saveChat).toHaveBeenCalledTimes(2);
  });

  it('recover 等待回读期间本字段被外部改写时不覆盖且保持 unknown', async () => {
    const f = fixture();
    f.saveChat.mockRejectedValueOnce(new Error('lost'));
    await expect(f.store.recordIntent(f.intent('recover-external'))).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    let release!: () => void;
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return responseJson(f.getRemote());
    });
    const pending = f.store.recover();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const external = { external: 'preserve' };
    f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU] = external;
    release();
    await expect(pending).rejects.toThrow('WORLD_DISPATCH_RECOVERY_UNRESOLVED');
    expect(f.chat[1][WORLD_DISPATCH_JOURNAL_FIELD_ACU]).toBe(external);
    expect(() => f.store.read()).toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
  });

  it('保存期间后继正文改变时进入 unknown，不能确认旧观察', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('changing-successor'));
    const successor = resolveWorldSimulationAnchor_ACU(2, f.chat);
    let release!: () => void;
    f.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      f.setRemote(f.chat);
    });
    const observing = f.store.observeSuccessor('changing-successor', successor, 101);
    await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledTimes(2));
    f.chat[2].mes = '保存期间改写后继';
    release();
    await expect(observing).rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    expect(() => f.store.read()).toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
  });

  it('成功保存不发远端回读，且无需 recover', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('remote-successor'));
    const successor = resolveWorldSimulationAnchor_ACU(2, f.chat);
    const remoteFetch = vi.mocked(fetch);
    remoteFetch.mockImplementation(async () => {
      const remote = structuredClone(f.getRemote());
      remote.splice(2, 0, { message_id: 91, is_user: false, swipe_id: 0, mes: '更早的远端助手' });
      return responseJson(remote);
    });
    await expect(f.store.observeSuccessor('remote-successor', successor, 101)).resolves.toMatchObject({ revision: 2 });
    expect(remoteFetch).not.toHaveBeenCalled();
    expect(() => f.store.read()).not.toThrow();
    await expect(f.store.recover()).rejects.toThrow('WORLD_DISPATCH_RECOVERY_UNAVAILABLE');
  });

  it.each(['remote-earlier', 'remote-swipe', 'local-earlier', 'local-digest'] as const)('recover candidate 复核第一后继而不只相信已保存日志：%s', async change => {
    const f = fixture();
    await f.store.recordIntent(f.intent(`recover-successor-${change}`));
    const successor = resolveWorldSimulationAnchor_ACU(2, f.chat);
    f.saveChat.mockImplementationOnce(async () => {
      f.setRemote(f.chat);
      throw new Error('saved but response lost');
    });
    await expect(f.store.observeSuccessor(`recover-successor-${change}`, successor, 101))
      .rejects.toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    const originalLocal = structuredClone(f.chat);
    const originalRemote = structuredClone(f.getRemote());
    const remote = structuredClone(originalRemote);
    if (change === 'remote-earlier') remote.splice(2, 0, { message_id: 92, is_user: false, swipe_id: 0, mes: '远端更早正文' });
    if (change === 'remote-swipe') remote[2].swipe_id = 1;
    if (change === 'local-earlier') f.chat.splice(2, 0, { message_id: 93, is_user: false, swipe_id: 0, mes: '本地更早正文' });
    if (change === 'local-digest') f.chat[2].mes = '本地后继已变';
    f.setRemote(remote);
    await expect(f.store.recover()).rejects.toThrow('WORLD_DISPATCH_RECOVERY_UNRESOLVED');
    expect(() => f.store.read()).toThrow('WORLD_DISPATCH_PERSIST_UNKNOWN');
    expect(f.saveChat).toHaveBeenCalledTimes(2);
    if (change === 'local-earlier') f.chat.splice(2, 1);
    if (change === 'local-digest') f.chat[2].mes = originalLocal[2].mes;
    f.setRemote(originalRemote);
    await expect(f.store.recover()).resolves.toMatchObject({ status: 'candidate', journal: {
      records: [{ successor: { anchor: { messageKey: 'number:42', contentDigest: successor.contentDigest } } }],
    } });
    expect(f.saveChat).toHaveBeenCalledTimes(2);
  });

  it('saveChat 不可用时安全撤回本字段，不留下 unknown 状态', async () => {
    const f = fixture();
    _set_SillyTavern_API_ACU({ chat: f.chat, chatId: f.anchor.chatIdentity, groupId: 'missing-save', getCurrentChatId: () => f.anchor.chatIdentity } as any);

    await expect(f.store.recordIntent(f.intent('delivery-no-save'))).rejects.toBeInstanceOf(HostChatSaveNotStartedError_ACU);
    expect(f.chat[1]).not.toHaveProperty(WORLD_DISPATCH_JOURNAL_FIELD_ACU);
    expect(f.store.read()).toEqual({ schemaVersion: 1, revision: 0, records: [] });
  });
});
