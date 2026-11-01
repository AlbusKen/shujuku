import { afterEach, describe, expect, it, vi } from 'vitest';
import { installHostGenerationInterceptor_ACU, HostGenerationInterceptedError_ACU } from '../../../src/data/gateways/host-generation-interceptor';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import { WorldDispatchHostStore_ACU } from '../../../src/service/simulation/world-dispatch-host-store';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';

const endpoint = '/api/backends/chat-completions/generate';
const assistantBody = '助手已保存正文；世界投影只作为请求系统消息，不改写这里。';
const projection = '世界投影：一条极短、不可解锁的上下文。';

type Fixture = ReturnType<typeof createFixture>;
let fixtureSequence = 0;

function createFixture() {
  const chatId = `chat-${++fixtureSequence}`;
  const chat: Array<Record<string, unknown>> = [
    { is_user: true, mes: '用户原消息' },
    { is_user: false, mes: assistantBody, swipe_id: 0, message_id: 71 },
  ];
  const api: any = {
    chat, chatId, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => chatId,
  };
  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => { remote = structuredClone(api.chat); });
  api.saveChat = saveChat;
  _set_SillyTavern_API_ACU(api);
  const remoteFetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/chats/get');
    expect(init?.method).toBe('POST');
    return { ok: true, status: 200, json: async () => [{}, ...structuredClone(remote)] } as Response;
  });
  vi.stubGlobal('fetch', remoteFetch);
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  const store = new WorldDispatchHostStore_ACU(anchor);
  const network = vi.fn(async () => new Response('original response', { status: 200 }));
  const host: any = { location: { href: 'https://tavern.test/', origin: 'https://tavern.test' }, fetch: network };
  let active = true;
  return { api, anchor, store, chat, host, network, remoteFetch, saveChat, getRemote: () => remote,
    setRemote: (next: typeof chat) => { remote = structuredClone(next); }, setActive: (next: boolean) => { active = next; },
    isActive: () => active };
}

function payload(content = projection) {
  return JSON.stringify({ messages: [
    { role: 'system', content },
    { role: 'user', content: '继续当前故事' },
  ] });
}

function intent(f: Fixture, messages: unknown[], createdAt = 100) {
  return {
    deliveryId: 'delivery-1',
    source: { chatIdentity: f.anchor.chatIdentity, messageKey: f.anchor.messageKey,
      swipeId: f.anchor.swipeId, contentDigest: f.anchor.contentDigest },
    ledgerRevision: 7, ledgerFingerprint: sha256HexSync_ACU('ledger-revision-7'), factIds: ['fact-1'],
    requestFingerprint: sha256HexSync_ACU(JSON.stringify(messages)), createdAt,
  };
}

function install(f: Fixture) {
  return installHostGenerationInterceptor_ACU({
    isActive: f.isActive,
    claim: () => null,
    beforeDispatchObserver: async request => {
      const body = await request.readPayload();
      const messages = body.messages;
      if (!Array.isArray(messages)) throw new Error('fixture requires messages');
      await f.store.recordIntent(intent(f, messages));
    },
  }, f.host);
}

function request(f: Fixture, body = payload(), init: RequestInit = {}) {
  return f.host.fetch(endpoint, { method: 'POST', body, ...init });
}

async function expectBlocked(pending: Promise<Response>) {
  await expect(pending).rejects.toBeInstanceOf(HostGenerationInterceptedError_ACU);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('world dispatch observer integration', () => {
  it('真实 interceptor 在宿主保存完成前零原发送，随后只原样发送一次且不回读聊天', async () => {
    const f = createFixture();
    let releaseSave!: () => void;
    f.api.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseSave = resolve; });
      f.setRemote(structuredClone(f.api.chat));
    });
    const dispose = install(f);
    try {
      const pending = request(f);
      await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledOnce());
      expect(f.network).not.toHaveBeenCalled();
      expect(f.remoteFetch).not.toHaveBeenCalled();
      releaseSave();
      const response = await pending;
      expect(await response.text()).toBe('original response');
      expect(f.network).toHaveBeenCalledOnce();
      expect(f.remoteFetch).not.toHaveBeenCalled();
    } finally { dispose(); }
    const journal = f.store.read();
    expect(journal.records).toEqual([expect.objectContaining({ deliveryId: 'delivery-1', successor: null,
      factIds: ['fact-1'], ledgerFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(JSON.stringify(journal)).not.toContain(projection);
    expect(JSON.stringify(journal)).not.toContain('继续当前故事');
    expect(f.chat[1].mes).toBe(assistantBody);
  });

  it('保存失败或结果未知均阻断原发送，第二次观察不盲重试', async () => {
    const f = createFixture();
    f.api.saveChat.mockRejectedValue(new Error('save unknown'));
    const dispose = install(f);
    try {
      await expectBlocked(request(f));
      await expectBlocked(request(f));
      expect(f.network).not.toHaveBeenCalled();
      expect(f.saveChat).toHaveBeenCalledOnce();
      expect(await f.store.recover()).toMatchObject({ status: 'previous' });
    } finally { dispose(); }
  });

  it('恢复 previous 后显式新请求可单次转发；candidate 恢复不会自动转发或重存 intent', async () => {
    const previous = createFixture();
    previous.api.saveChat.mockRejectedValueOnce(new Error('transport after save'));
    const previousDispose = install(previous);
    try {
      await expectBlocked(request(previous));
      expect(await previous.store.recover()).toMatchObject({ status: 'previous' });
      await request(previous);
    } finally { previousDispose(); }
    expect(previous.network).toHaveBeenCalledOnce();
    expect(previous.saveChat).toHaveBeenCalledTimes(2);
    expect(previous.store.read().records).toHaveLength(1);

    const candidate = createFixture();
    candidate.api.saveChat.mockImplementationOnce(async () => {
      candidate.setRemote(structuredClone(candidate.api.chat));
      throw new Error('lost after save');
    });
    const candidateDispose = install(candidate);
    try {
      await expectBlocked(request(candidate));
      expect(await candidate.store.recover()).toMatchObject({ status: 'candidate' });
      // 调用方之后再次 fetch 是新动作：领域幂等不得吞掉该生命周期的唯一原发送。
      await request(candidate);
    } finally { candidateDispose(); }
    expect(candidate.network).toHaveBeenCalledOnce();
    expect(candidate.saveChat).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'swipe', 'body', 'digest', 'chat'] as const)('等待保存时 %s 变化则零发送且不触碰新聊天', async change => {
    const f = createFixture();
    let release!: () => void;
    f.api.saveChat.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      f.setRemote(structuredClone(f.api.chat));
    });
    const dispose = install(f);
    try {
      const controller = new AbortController();
      const init: RequestInit = { method: 'POST', body: payload(), signal: controller.signal };
      const pending = f.host.fetch(endpoint, init);
      await vi.waitFor(() => expect(f.saveChat).toHaveBeenCalledOnce());
      if (change === 'cancel') controller.abort();
      if (change === 'swipe') (f.chat[1] as any).swipe_id = 1;
      if (change === 'body') init.body = payload('changed body');
      if (change === 'digest') f.chat[1].mes = 'changed assistant body';
      if (change === 'chat') {
        f.api.chat = [{ is_user: false, mes: '另一聊天，不得写入', swipe_id: 0, message_id: 91 }];
        f.api.chatId = 'other-chat';
        f.api.getCurrentChatId = () => 'other-chat';
      }
      release();
      await expectBlocked(pending);
      if (change === 'cancel' || change === 'body') {
        expect(f.store.read().records).toHaveLength(1);
      }
      expect(f.remoteFetch).not.toHaveBeenCalled();
      if (change === 'chat') {
        expect(f.api.chat[0]).not.toHaveProperty('_qrf_world_projection_dispatch');
      }
    } finally { dispose(); }
    expect(f.network).not.toHaveBeenCalled();
  });

  it('同一 intent 重复观察不重持久化，但每次宿主请求仍各自经历一次原发送', async () => {
    const f = createFixture();
    const dispose = install(f);
    try {
      await request(f);
      await request(f);
    } finally { dispose(); }
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.network).toHaveBeenCalledTimes(2);
    expect(f.store.read().records).toHaveLength(1);
  });

  it('下一真实 assistant 仅关联 successor 而非确认采用，并拒绝伪造摘要', async () => {
    const f = createFixture();
    const dispose = install(f);
    try { await request(f); } finally { dispose(); }
    f.chat.push({ is_user: false, mes: '下一真实助手正文', swipe_id: 0, message_id: 72 });
    const successor = resolveWorldSimulationAnchor_ACU(2, f.chat);
    const fakeDigest = sha256HexSync_ACU('并非实际下一助手正文');
    await expect(f.store.observeSuccessor('delivery-1', { ...successor, contentDigest: fakeDigest }, 201)).rejects.toThrow();
    const observed = await f.store.observeSuccessor('delivery-1', successor, 200);
    expect(observed.records[0].successor).toEqual({ anchor: expect.objectContaining({ messageKey: 'number:72' }), observedAt: 200 });
    expect(JSON.stringify(observed)).not.toContain('acknowledged');
  });
});
