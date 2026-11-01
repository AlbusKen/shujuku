import { describe, expect, it, vi } from 'vitest';
import {
  HostGenerationInterceptedError_ACU,
  INTERNAL_GENERATION_FETCH_ACU,
  installHostGenerationInterceptor_ACU,
} from '../../../src/data/gateways/host-generation-interceptor';

const endpoint = '/api/backends/chat-completions/generate';

function createHost(network = vi.fn()): any {
  return {
    location: { href: 'https://tavern.test/', origin: 'https://tavern.test' },
    fetch: network,
  };
}

function post(host: any, init: RequestInit = {}): Promise<Response> {
  return host.fetch(endpoint, { method: 'POST', body: '{"messages":[{"role":"user","content":"原文"}]}', ...init });
}

async function expectBlocked(request: Promise<Response>): Promise<void> {
  await expect(request).rejects.toBeInstanceOf(HostGenerationInterceptedError_ACU);
}

describe('host generation dispatch observer', () => {
  it('等待 observer 后只以冻结请求发送一次并原样返回 Response', async () => {
    const reply = {} as Response;
    const network = vi.fn(async function (this: unknown, request: Request) {
      expect(this).toBe(host);
      expect(request).toBeInstanceOf(Request);
      expect(await request.text()).toContain('原文');
      return reply;
    });
    const host = createHost(network);
    let release!: () => void;
    const observer = vi.fn(async request => {
      expect((await request.readPayload()).messages).toEqual([{ role: 'user', content: '原文' }]);
      await new Promise<void>(resolve => { release = resolve; });
    });
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: observer }, host);
    try {
      const pending = post(host);
      await vi.waitFor(() => expect(observer).toHaveBeenCalledOnce());
      expect(network).not.toHaveBeenCalled();
      release();
      expect(await pending).toBe(reply);
      expect(network).toHaveBeenCalledOnce();
    } finally { dispose(); }
  });

  it.each([
    ['observer 拒绝', async () => { throw new Error('save failed'); }],
    ['observer 前已取消', async () => undefined],
  ])('%s 时不发送', async (label, observer) => {
    const network = vi.fn();
    const host = createHost(network);
    const controller = new AbortController();
    if (label === 'observer 前已取消') controller.abort();
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: observer }, host);
    try { await expectBlocked(post(host, { signal: controller.signal })); }
    finally { dispose(); }
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['取消', '撤销', '失活'] as const)('observer 等待中%s时阻断发送', async condition => {
    const network = vi.fn();
    const host = createHost(network);
    const controller = new AbortController();
    let active = true;
    let release!: () => void;
    const observer = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => active, claim: () => null,
      beforeDispatchObserver: observer }, host);
    const pending = post(host, { signal: controller.signal });
    await vi.waitFor(() => expect(observer).toHaveBeenCalledOnce());
    if (condition === '取消') controller.abort();
    if (condition === '撤销') dispose();
    if (condition === '失活') active = false;
    release();
    await expectBlocked(pending);
    expect(network).not.toHaveBeenCalled();
    if (condition !== '撤销') dispose();
  });

  it.each(['撤销', '失活'] as const)('JSON 解析尚未结束时%s，observer 和原发送都不执行', async condition => {
    const network = vi.fn();
    const host = createHost(network);
    const observer = vi.fn(async () => {});
    let active = true;
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => active, claim: () => null,
      beforeDispatchObserver: observer }, host);
    const pending = post(host);
    if (condition === '撤销') dispose();
    else active = false;
    try { await expectBlocked(pending); }
    finally { dispose(); }
    expect(observer).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['body', 'method', 'headers', 'signal'] as const)('await 期间 init %s 改变时拒绝发送', async field => {
    const network = vi.fn();
    const host = createHost(network);
    let release!: () => void;
    const observer = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: observer }, host);
    const initialSignal = new AbortController().signal;
    const init: RequestInit = { method: 'POST', body: '{"messages":[{"role":"user","content":"原文"}]}',
      headers: { 'x-observed': 'before' }, signal: initialSignal };
    try {
      const pending = host.fetch(endpoint, init);
      await vi.waitFor(() => expect(observer).toHaveBeenCalledOnce());
      if (field === 'body') init.body = '{"messages":[{"role":"user","content":"篡改"}]}';
      if (field === 'method') init.method = 'PUT';
      if (field === 'headers') init.headers = { 'x-observed': 'after' };
      if (field === 'signal') init.signal = new AbortController().signal;
      release();
      await expectBlocked(pending);
      expect(network).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('aroundDispatch 只能以改写 payload 发送一次并保留冻结请求属性', async () => {
    const reply = {} as Response;
    const network = vi.fn(async (request: Request) => {
      expect(request.headers.get('x-test')).toBe('preserved');
      expect(await request.json()).toEqual({ messages: [{ role: 'system', content: '安全事实' }] });
      return reply;
    });
    const host = createHost(network);
    const around = vi.fn(async (_request, forward) => forward({ messages: [{ role: 'system', content: '安全事实' }] }));
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, aroundDispatchActive: () => true,
      claim: () => null, aroundDispatch: around }, host);
    try {
      expect(await post(host, { headers: { 'x-test': 'preserved' } })).toBe(reply);
    } finally { dispose(); }
    expect(around).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledOnce();
  });

  it('aroundDispatch 的真实传输错误原样透传，review 错误仍拦截发送', async () => {
    const failure = new Error('around transport failed');
    const network = vi.fn(async () => { throw failure; });
    const host = createHost(network);
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, aroundDispatchActive: () => true,
      claim: () => null, aroundDispatch: async (_request, forward) => forward({ messages: [] }) }, host);
    try { await expect(post(host)).rejects.toBe(failure); }
    finally { dispose(); }
    expect(network).toHaveBeenCalledOnce();

    const blockedNetwork = vi.fn();
    const blockedHost = createHost(blockedNetwork);
    const blockedDispose = installHostGenerationInterceptor_ACU({ isActive: () => true, aroundDispatchActive: () => true,
      claim: () => null, aroundDispatch: async () => { throw new Error('review failed'); } }, blockedHost);
    try { await expectBlocked(post(blockedHost)); }
    finally { blockedDispose(); }
    expect(blockedNetwork).not.toHaveBeenCalled();
  });

  it('claim 与 rejectUnclaimed 均优先于 observer', async () => {
    const network = vi.fn();
    const host = createHost(network);
    const observer = vi.fn();
    const claimed = vi.fn(async () => {});
    let dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => claimed,
      beforeDispatchObserver: observer }, host);
    await expectBlocked(post(host));
    expect(claimed).toHaveBeenCalledOnce();
    expect(observer).not.toHaveBeenCalled();
    dispose();
    dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      rejectUnclaimed: true, beforeDispatchObserver: observer }, host);
    try { await expectBlocked(post(host)); }
    finally { dispose(); }
    expect(observer).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('非法 JSON、非字符串 body 与保存未知均阻断发送', async () => {
    for (const init of [
      { method: 'POST', body: '{bad json' },
      { method: 'POST', body: new Blob(['{"messages":[]}']) },
    ] as RequestInit[]) {
      const network = vi.fn();
      const host = createHost(network);
      const observer = vi.fn();
      const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
        beforeDispatchObserver: observer }, host);
      try { await expectBlocked(host.fetch(endpoint, init)); }
      finally { dispose(); }
      expect(network).not.toHaveBeenCalled();
    }
    const network = vi.fn();
    const host = createHost(network);
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: async () => { throw new Error('persist-unknown'); } }, host);
    try { await expectBlocked(post(host)); }
    finally { dispose(); }
    expect(network).not.toHaveBeenCalled();
  });

  it('Request 输入应用 init signal 覆盖并可阻断发送', async () => {
    const network = vi.fn();
    const host = createHost(network);
    const controller = new AbortController();
    let release!: () => void;
    const observer = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: observer }, host);
    const request = new Request(`https://tavern.test${endpoint}`, { method: 'POST', body: '{"messages":[]}' });
    try {
      const pending = host.fetch(request, { signal: controller.signal });
      await vi.waitFor(() => expect(observer).toHaveBeenCalledOnce());
      controller.abort();
      expect((observer.mock.calls[0][0] as any).signal.aborted).toBe(true);
      release();
      await expectBlocked(pending);
    } finally { dispose(); }
    expect(network).not.toHaveBeenCalled();
  });

  it('Request 输入应用 init headers 覆盖并以冻结副本发送', async () => {
    const reply = {} as Response;
    const network = vi.fn(async (request: Request) => {
      expect(request.headers.get('x-source')).toBe('override');
      return reply;
    });
    const host = createHost(network);
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: async () => {} }, host);
    const request = new Request(`https://tavern.test${endpoint}`, { method: 'POST',
      headers: { 'x-source': 'original' }, body: '{"messages":[]}' });
    try { expect(await host.fetch(request, { headers: { 'x-source': 'override' } })).toBe(reply); }
    finally { dispose(); }
    expect(network).toHaveBeenCalledOnce();
  });

  it('原传输错误原样透传且不重试', async () => {
    const failure = new Error('transport failed');
    const network = vi.fn(async () => { throw failure; });
    const host = createHost(network);
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: async () => {} }, host);
    try { await expect(post(host)).rejects.toBe(failure); }
    finally { dispose(); }
    expect(network).toHaveBeenCalledOnce();
  });

  it('inactive 请求保持原链且不调用 observer', async () => {
    const reply = {} as Response;
    const network = vi.fn(async () => reply);
    const host = createHost(network);
    const observer = vi.fn();
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => false, claim: () => null,
      beforeDispatchObserver: observer }, host);
    try { expect(await post(host)).toBe(reply); }
    finally { dispose(); }
    expect(observer).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledOnce();
  });

  it('active 时内部和非端点请求保持原链且不调用 observer', async () => {
    const reply = {} as Response;
    const network = vi.fn(async () => reply);
    const host = createHost(network);
    const observer = vi.fn();
    const dispose = installHostGenerationInterceptor_ACU({ isActive: () => true, claim: () => null,
      beforeDispatchObserver: observer }, host);
    try {
      expect(await host.fetch(endpoint, { method: 'POST', body: '{}', [INTERNAL_GENERATION_FETCH_ACU]: true })).toBe(reply);
      expect(await host.fetch('/api/other', { method: 'POST', body: '{}' })).toBe(reply);
    } finally { dispose(); }
    expect(observer).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(2);
  });
});
