import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ win: {} as any }));

vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: h.win }));
vi.mock('../../src/shared/constants', () => ({ SCRIPT_ID_PREFIX_ACU: 'ACU' }));
vi.mock('../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));

import { idbSet_ACU, idbWriteRequest_ACU, importTempSet_ACU, importTempMem_ACU } from '../../src/shared/idb-import-temp';

type Outcome = 'complete' | 'abort' | 'error';

function fakeTx(outcome: Outcome) {
  const tx: any = { error: null };
  const req: any = {};
  tx.objectStore = () => ({
    put: () => {
      queueMicrotask(() => {
        req.result = 'k';
        req.onsuccess?.();
        queueMicrotask(() => {
          if (outcome === 'complete') tx.oncomplete?.();
          else if (outcome === 'abort') { tx.error = new Error('aborted after success'); tx.onabort?.(); }
          else { tx.error = new Error('tx error'); tx.onerror?.(); }
        });
      });
      return req;
    },
  });
  return tx;
}

describe('idbWriteRequest_ACU 等待事务提交', () => {
  it('请求成功且事务 complete 后才返回结果', async () => {
    const tx = fakeTx('complete');
    const order: string[] = [];
    const pending = idbWriteRequest_ACU(tx, t => t.objectStore('kv').put(1, 'k'))
      .then(result => { order.push('resolved'); return result; });
    const commit = tx.oncomplete;
    tx.oncomplete = () => { order.push('complete'); commit(); };
    await expect(pending).resolves.toBe('k');
    expect(order).toEqual(['complete', 'resolved']);
  });

  it.each(['abort', 'error'] as const)('请求成功后事务 %s 时拒绝', async outcome => {
    await expect(idbWriteRequest_ACU(fakeTx(outcome), t => t.objectStore('kv').put(1, 'k'))).rejects.toThrow();
  });

  it('idbSet_ACU 在事务中止时抛错，importTempSet_ACU 回退内存暂存', async () => {
    const db = { objectStoreNames: { contains: () => true }, transaction: () => fakeTx('abort') };
    h.win.indexedDB = {
      open: () => {
        const req: any = { result: db };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    };
    await expect(idbSet_ACU('k', 1)).rejects.toThrow('aborted after success');
    importTempMem_ACU.clear();
    await importTempSet_ACU('k', 2);
    expect(importTempMem_ACU.get('k')).toBe(2);
  });
});
