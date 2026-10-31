import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  anyAbortSignal_ACU, captureTakeoverLease_ACU, isTakeoverEnabled_ACU, runTakeoverRequest_ACU,
  setTakeoverRuntimeEnabled_ACU, subscribeTakeoverControl_ACU,
} from '../../../src/shared/takeover-control';
import { createEmbeddings_ACU } from '../../../src/data/gateways/vector-embedding-gateway';
import { createRerankScores_ACU } from '../../../src/data/gateways/vector-rerank-gateway';
import { invokeZeroLayerHostGeneration_ACU } from '../../../src/data/gateways/zero-layer-generation-gateway';

beforeEach(() => setTakeoverRuntimeEnabled_ACU(true));
afterEach(() => { setTakeoverRuntimeEnabled_ACU(true); vi.unstubAllGlobals(); });

describe('数据库接管总开关', () => {
  it('暂停时零层 quiet 入口也在访问宿主之前拒绝', async () => {
    setTakeoverRuntimeEnabled_ACU(false);
    await expect(invokeZeroLayerHostGeneration_ACU('hello', new AbortController().signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
  it('暂停时在进入任何请求回调之前拒绝，恢复后新请求正常', async () => {
    const request = vi.fn(async () => 'ok');
    setTakeoverRuntimeEnabled_ACU(false);
    await expect(runTakeoverRequest_ACU(request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
    setTakeoverRuntimeEnabled_ACU(true);
    await expect(runTakeoverRequest_ACU(request)).resolves.toBe('ok');
    expect(request).toHaveBeenCalledOnce();
  });
  it('暂停取消进行中的请求；立即恢复也不采纳旧结果', async () => {
    let finish!: (value: string) => void;
    let signal!: AbortSignal;
    const task = runTakeoverRequest_ACU(s => { signal = s; return new Promise(resolve => { finish = resolve; }); });
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    setTakeoverRuntimeEnabled_ACU(false);
    setTakeoverRuntimeEnabled_ACU(true);
    expect(signal.aborted).toBe(true);
    finish('late result');
    await rejected;
    await expect(runTakeoverRequest_ACU(async () => 'fresh')).resolves.toBe('fresh');
  });
  it('旧队列租约永久作废，恢复不重放暂停前的任务', () => {
    const lease = captureTakeoverLease_ACU();
    setTakeoverRuntimeEnabled_ACU(false); setTakeoverRuntimeEnabled_ACU(true);
    expect(lease.isCurrent()).toBe(false);
    expect(() => lease.assertActive()).toThrow();
    expect(captureTakeoverLease_ACU().isCurrent()).toBe(true);
  });
  it('不会中止宿主或MVU独立控制器', () => {
    const host = new AbortController(), mvu = new AbortController();
    setTakeoverRuntimeEnabled_ACU(false);
    expect(host.signal.aborted).toBe(false); expect(mvu.signal.aborted).toBe(false);
  });
  it('重复设置无副作用，监听可释放', () => {
    const listener = vi.fn(), dispose = subscribeTakeoverControl_ACU(listener);
    setTakeoverRuntimeEnabled_ACU(false); setTakeoverRuntimeEnabled_ACU(false);
    expect(listener).toHaveBeenCalledTimes(1);
    dispose(); setTakeoverRuntimeEnabled_ACU(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('完成后移除父取消监听', async () => {
    const parent = new AbortController();
    const add = vi.spyOn(parent.signal, 'addEventListener'), remove = vi.spyOn(parent.signal, 'removeEventListener');
    await runTakeoverRequest_ACU(async () => 42, parent.signal);
    expect(add).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
  });
  it('暂停时Embedding和Rerank都不发HTTP请求', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); setTakeoverRuntimeEnabled_ACU(false);
    await expect(createEmbeddings_ACU({ endpoint: 'https://test/embeddings', model: 'test', input: ['hello'] })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(createRerankScores_ACU({ endpoint: 'https://test/rerank', model: 'test', query: 'hello', documents: ['world'] })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('暂停取消Embedding的HTTP，不因重新启用而重试', async () => {
    const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })));
    vi.stubGlobal('fetch', fetch);
    const task = createEmbeddings_ACU({ endpoint: 'https://test/embeddings', model: 'test', input: ['hello'] });
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
    setTakeoverRuntimeEnabled_ACU(false); setTakeoverRuntimeEnabled_ACU(true);
    await rejected;
    expect(fetch).toHaveBeenCalledOnce();
    expect(isTakeoverEnabled_ACU()).toBe(true);
  });
});


describe('AbortSignal.any 不可用时的信号合并回退', () => {
  const withoutNativeAny = (run: () => void) => {
    const original = (AbortSignal as any).any;
    (AbortSignal as any).any = undefined;
    try { run(); } finally { (AbortSignal as any).any = original; }
  };
  it('任一来源中止即以其 reason 中止，并移除对其余来源的监听', () => withoutNativeAny(() => {
    const a = new AbortController();
    const b = new AbortController();
    const removeA = vi.spyOn(a.signal, 'removeEventListener');
    const merged = anyAbortSignal_ACU([a.signal, b.signal]);
    expect(merged.aborted).toBe(false);
    const reason = new DOMException('stop', 'AbortError');
    b.abort(reason);
    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe(reason);
    expect(removeA).toHaveBeenCalledWith('abort', expect.any(Function));
  }));
  it('已中止的来源直接返回已中止信号', () => withoutNativeAny(() => {
    const a = new AbortController();
    a.abort('done');
    const merged = anyAbortSignal_ACU([a.signal, new AbortController().signal]);
    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe('done');
  }));
  it('带父信号的租约在回退下仍响应父中止与接管暂停', () => withoutNativeAny(() => {
    const parent = new AbortController();
    const byParent = captureTakeoverLease_ACU(parent.signal);
    parent.abort('parent');
    expect(byParent.signal.aborted).toBe(true);
    expect(byParent.signal.reason).toBe('parent');
    const byPause = captureTakeoverLease_ACU(new AbortController().signal);
    setTakeoverRuntimeEnabled_ACU(false);
    expect(byPause.signal.aborted).toBe(true);
    expect(byPause.signal.reason).toMatchObject({ name: 'AbortError' });
  }));
});
