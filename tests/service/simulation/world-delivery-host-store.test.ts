import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostChatSaveNotStartedError_ACU } from '../../../src/data/gateways/chat-gateway';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { WorldDeliveryHostStore_ACU, WORLD_DELIVERY_LIFECYCLE_FIELD_ACU } from '../../../src/service/simulation/world-delivery-host-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';

const hash = (value: string) => sha256HexSync_ACU(value);
let sequence = 0;

function response(value: unknown): Response { return { ok: true, json: async () => structuredClone(value) } as Response; }
function fixture(save?: (chat: any[], remote: (value: any[]) => void) => Promise<void>, minimalHost = false) {
  const chat: any[] = [{ is_system: true }, { message_id: 1, is_user: false, swipe_id: 0, mes: 'source' }, { message_id: 2, is_user: false, swipe_id: 0, mes: 'first successor' }];
  let remote = structuredClone(chat); const setRemote = (value: any[]) => { remote = structuredClone(value); };
  const saveChat = vi.fn(async () => save ? save(chat, setRemote) : setRemote(chat));
  const chatId = `delivery-${++sequence}`;
  _set_SillyTavern_API_ACU({ chat, ...(!minimalHost ? { chatId, groupId: chatId } : {}), getCurrentChatId: () => chatId, saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(async () => response(remote)));
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  const store = new WorldDeliveryHostStore_ACU(anchor);
  const intent = (deliveryId: string) => ({ deliveryId, target: 'body' as const, source: { chatIdentity: anchor.chatIdentity, messageKey: anchor.messageKey, swipeId: anchor.swipeId, contentDigest: anchor.contentDigest }, ledgerRevision: 1, ledgerFingerprint: hash(`ledger-${deliveryId}`), factIds: [`fact-${deliveryId}`], requestFingerprint: hash(`request-${deliveryId}`), createdAt: 1 });
  return { chat, remote: () => remote, setRemote, saveChat, store, anchor, intent };
}

describe('WorldDeliveryHostStore_ACU', () => {
  beforeEach(() => { vi.clearAllMocks(); _set_SillyTavern_API_ACU(undefined); });
  afterEach(() => { vi.unstubAllGlobals(); _set_SillyTavern_API_ACU(undefined); });

  it('严格写 intent 并按 swipe 分桶；未取得真实发送授权时不能登记后继', async () => {
    const f = fixture();
    await f.store.recordIntent(f.intent('one'));
    await expect(f.store.recordDurableSuccessor('one')).rejects.toThrow('intent');
    expect(f.store.read().records[0]).toMatchObject({ status: 'intent', successor: null });
    expect(f.chat[1][WORLD_DELIVERY_LIFECYCLE_FIELD_ACU].entries).toHaveProperty(hash(JSON.stringify([f.anchor.chatIdentity, f.anchor.messageKey, '0'])));
    f.chat[1].swipe_id = 1; f.chat[1].mes = 'other swipe';
    const other = new WorldDeliveryHostStore_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat));
    await other.recordIntent({ ...f.intent('two'), source: { chatIdentity: f.anchor.chatIdentity, messageKey: f.anchor.messageKey, swipeId: '1', contentDigest: hash('other swipe') } });
    expect(Object.keys(f.chat[1][WORLD_DELIVERY_LIFECYCLE_FIELD_ACU].entries)).toHaveLength(2);
  });

  it('伪造结构型 authorization 不能取得实际发送权限', async () => {
    const f = fixture(); const dispatch = vi.fn(async () => 'unexpected');
    await expect(f.store.runAttempt(f.intent('run'), { assertCurrent: () => undefined }, { messages: [] }, dispatch))
      .rejects.toThrow('authorization 不是本模块签发');
    expect(dispatch).not.toHaveBeenCalled();
    expect(f.store.read().records).toEqual([]);
    expect(f.saveChat).not.toHaveBeenCalled();
  });

  it('宿主仅有 chat、getCurrentChatId、saveChat 时正常保存，不请求远端聊天', async () => {
    const f = fixture(undefined, true);
    await expect(f.store.recordIntent(f.intent('minimal-host'))).resolves.toMatchObject({ records: [{ deliveryId: 'minimal-host' }] });
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(f.store.read().records).toHaveLength(1);
  });

  it('saveChat 拒绝保留 unknown，显式 recover 从服务器读取而不重新保存', async () => {
    const f = fixture(async () => { throw new Error('save rejected'); });
    await expect(f.store.recordIntent(f.intent('rejected'))).rejects.toThrow('WORLD_DELIVERY_PERSIST_UNKNOWN');
    expect(() => f.store.read()).toThrow('WORLD_DELIVERY_PERSIST_UNKNOWN');
    expect(fetch).not.toHaveBeenCalled();
    await expect(f.store.recover()).resolves.toMatchObject({ status: 'previous', lifecycle: { records: [] } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.saveChat).toHaveBeenCalledOnce();
  });

  it('缺少 saveChat 时保存尚未开始，撤回本地字段且无 pending', async () => {
    const f = fixture();
    _set_SillyTavern_API_ACU({ chat: f.chat, getCurrentChatId: () => f.anchor.chatIdentity } as any);
    await expect(f.store.recordIntent(f.intent('no-save'))).rejects.toBeInstanceOf(HostChatSaveNotStartedError_ACU);
    expect(f.chat[1]).not.toHaveProperty(WORLD_DELIVERY_LIFECYCLE_FIELD_ACU);
    expect(f.store.read().records).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('保存响应丢失时阻断，recover 仅确认远端值而不自动重发', async () => {
    const f = fixture(async (chat, setRemote) => { setRemote(chat); throw new Error('lost after save'); });
    await expect(f.store.recordIntent(f.intent('lost'))).rejects.toThrow('WORLD_DELIVERY_PERSIST_UNKNOWN');
    expect(() => f.store.read()).toThrow('WORLD_DELIVERY_PERSIST_UNKNOWN');
    expect(fetch).not.toHaveBeenCalled();
    await expect(f.store.recover()).resolves.toMatchObject({ status: 'candidate', lifecycle: { records: [{ deliveryId: 'lost' }] } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.saveChat).toHaveBeenCalledOnce();
  });
});
