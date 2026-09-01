import { describe, expect, it } from 'vitest';
import { runExclusiveAgentWorldbookOperation_ACU } from '../../../src/service/agent/agent-worldbook-operation-lock';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('runExclusiveAgentWorldbookOperation_ACU', () => {
  it('后提交的操作等待前序操作完成后才开始执行', async () => {
    const events: string[] = [];
    const firstGate = deferred<void>();

    const first = runExclusiveAgentWorldbookOperation_ACU(async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first';
    });
    const second = runExclusiveAgentWorldbookOperation_ACU(async () => {
      events.push('second:start');
      return 'second';
    });

    // 给事件循环机会：若锁失效，second 会在 first 释放前启动。
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start']);

    firstGate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('前序操作抛出异常后队列不被卡死，后续操作仍执行', async () => {
    const failing = runExclusiveAgentWorldbookOperation_ACU(async () => {
      throw new Error('takeover failed');
    });
    const following = runExclusiveAgentWorldbookOperation_ACU(async () => 'ok');

    await expect(failing).rejects.toThrow('takeover failed');
    await expect(following).resolves.toBe('ok');
  });

  it('调用方收到操作的原始返回值与原始异常', async () => {
    const value = { restored: 3 };
    await expect(runExclusiveAgentWorldbookOperation_ACU(async () => value)).resolves.toBe(value);

    const error = new Error('write rejected');
    await expect(runExclusiveAgentWorldbookOperation_ACU(async () => { throw error; })).rejects.toBe(error);
  });

  it('并发提交多个操作时严格按提交顺序串行', async () => {
    const order: number[] = [];
    const operations = [0, 1, 2, 3].map(index =>
      runExclusiveAgentWorldbookOperation_ACU(async () => {
        order.push(index);
        // 让出事件循环，若无锁则完成顺序会交错。
        await new Promise(resolve => setTimeout(resolve, (3 - index) * 2));
        return index;
      }),
    );
    await expect(Promise.all(operations)).resolves.toEqual([0, 1, 2, 3]);
    expect(order).toEqual([0, 1, 2, 3]);
  });
});
