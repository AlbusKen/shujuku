import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetTableWriteTransactionLocksForTest_ACU,
  buildTableCommitScopeKey_ACU,
  buildTableMaintenanceScopeKey_ACU,
  buildTableSheetMutationScopeKey_ACU,
  normalizeTableWriteSet_ACU,
  resolveTableWriteTargetMessageIndex_ACU,
  captureTableRuntimeRevisionForWriteSet_ACU,
  runTableWriteTransaction_ACU,
  tableWriteSetsConflict_ACU,
} from '../../../src/service/table/table-write-transaction';
import { _set_currentChatFileIdentifier_ACU, _set_currentJsonTableData_ACU } from '../../../src/service/runtime/state-manager';

function deferred_ACU<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sheetWrite(sheetKey: string) {
  return [{ kind: 'sheet' as const, sheetKey }];
}

describe('table-write-transaction', () => {
  beforeEach(() => {
    _resetTableWriteTransactionLocksForTest_ACU();
    _set_currentChatFileIdentifier_ACU('chat-a');
    _set_currentJsonTableData_ACU({ mate: { type: 'acu', version: 1 }, sheet_0: { name: 'A', content: [['row_id']] } });
  });

  it('构造 maintenance / sheet / commit scope key', () => {
    expect(buildTableMaintenanceScopeKey_ACU({ chatKey: ' chat ', isolationKey: ' iso ' })).toBe('chat::iso::maintenance');
    expect(buildTableSheetMutationScopeKey_ACU({ chatKey: 'chat', isolationKey: 'iso', sheetKey: 'sheet_0' })).toBe('chat::iso::sheet::sheet_0');
    expect(buildTableSheetMutationScopeKey_ACU({ chatKey: 'chat', isolationKey: 'iso', sheetKey: '*' })).toBe('chat::iso::sheet::*');
    expect(buildTableCommitScopeKey_ACU({ chatKey: 'chat', isolationKey: 'iso' })).toBe('chat::iso::commit');
  });

  it('规范化空 writeSet 为 all', () => {
    expect(normalizeTableWriteSet_ACU([])).toEqual([{ kind: 'all' }]);
    expect(normalizeTableWriteSet_ACU([{ kind: 'all' }, { kind: 'sheet', sheetKey: 'sheet_0' }])).toEqual([{ kind: 'all' }]);
  });

  it('在事务内解析真实 AI 目标楼层', () => {
    const chat = [{ is_user: true }, { is_user: false }, { is_user: true }, { is_user: false }];
    expect(resolveTableWriteTargetMessageIndex_ACU(chat, -1)).toBe(3);
    expect(resolveTableWriteTargetMessageIndex_ACU(chat, null)).toBe(3);
    expect(resolveTableWriteTargetMessageIndex_ACU(chat, 1)).toBe(1);
    expect(resolveTableWriteTargetMessageIndex_ACU(chat, 2)).toBe(-1);
    expect(resolveTableWriteTargetMessageIndex_ACU([], -1)).toBe(-1);
  });

  it('按 writeSet 判断写入范围是否相交', () => {
    expect(tableWriteSetsConflict_ACU(sheetWrite('sheet_a'), sheetWrite('sheet_b'))).toBe(false);
    expect(tableWriteSetsConflict_ACU(sheetWrite('sheet_a'), sheetWrite('sheet_a'))).toBe(true);
    expect(tableWriteSetsConflict_ACU([{ kind: 'row', sheetKey: 'sheet_a', rowId: 'r1' }], [{ kind: 'row', sheetKey: 'sheet_a', rowId: 'r2' }])).toBe(false);
    expect(tableWriteSetsConflict_ACU([{ kind: 'cell', sheetKey: 'sheet_a', rowId: 'r1', columnKey: 'c1' }], [{ kind: 'cell', sheetKey: 'sheet_a', rowId: 'r1', columnKey: 'c2' }])).toBe(false);
    expect(tableWriteSetsConflict_ACU([{ kind: 'cell', sheetKey: 'sheet_a', rowId: 'r1', columnKey: 'c1' }], [{ kind: 'cell', sheetKey: 'sheet_a', rowId: 'r1', columnKey: 'c1' }])).toBe(true);
    expect(tableWriteSetsConflict_ACU([{ kind: 'schema', sheetKey: 'sheet_a' }], [{ kind: 'row', sheetKey: 'sheet_a', rowId: 'r1' }])).toBe(true);
    expect(tableWriteSetsConflict_ACU([{ kind: 'all' }], sheetWrite('sheet_b'))).toBe(true);
  });

  it('同一 sheet 的 mutation 串行', async () => {
    const gate = deferred_ACU();
    const firstStarted = deferred_ACU();
    const events: string[] = [];

    const first = runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'first', writeSet: sheetWrite('sheet_0') }, async () => {
      events.push('first:start');
      firstStarted.resolve();
      await gate.promise;
      events.push('first:end');
    });
    const second = runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'second', writeSet: sheetWrite('sheet_0') }, async () => {
      events.push('second:start');
    });

    await firstStarted.promise;
    expect(events).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('不同 sheet 可以并行 mutation，但 commit 串行', async () => {
    const firstCommitStarted = deferred_ACU();
    const releaseFirstCommit = deferred_ACU();
    const secondMutationStarted = deferred_ACU();
    const events: string[] = [];

    const first = runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'a', writeSet: sheetWrite('sheet_a') }, async (ctx) => {
      events.push('a:mutation');
      await ctx.runCommit(async () => {
        events.push('a:commit:start');
        firstCommitStarted.resolve();
        await releaseFirstCommit.promise;
        events.push('a:commit:end');
      });
    });

    await firstCommitStarted.promise;

    const second = runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'b', writeSet: sheetWrite('sheet_b') }, async (ctx) => {
      events.push('b:mutation');
      secondMutationStarted.resolve();
      await ctx.runCommit(async () => {
        events.push('b:commit');
      });
    });

    await secondMutationStarted.promise;
    expect(events).toEqual(['a:mutation', 'a:commit:start', 'b:mutation']);

    releaseFirstCommit.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['a:mutation', 'a:commit:start', 'b:mutation', 'a:commit:end', 'b:commit']);
  });

  it('sheet:* 与具体 sheet 互斥', async () => {
    const gate = deferred_ACU();
    const allStarted = deferred_ACU();
    const events: string[] = [];

    const all = runTableWriteTransaction_ACU({ source: 'raw_sql_batch', reason: 'unknown range', writeSet: [{ kind: 'all' }] }, async () => {
      events.push('all:start');
      allStarted.resolve();
      await gate.promise;
      events.push('all:end');
    });
    const concrete = runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'sheet', writeSet: sheetWrite('sheet_0') }, async () => {
      events.push('sheet:start');
    });

    await allStarted.promise;
    expect(events).toEqual(['all:start']);

    gate.resolve();
    await Promise.all([all, concrete]);
    expect(events).toEqual(['all:start', 'all:end', 'sheet:start']);
  });

  it('maintenance exclusive 排斥普通 shared 写事务', async () => {
    const gate = deferred_ACU();
    const cleanupStarted = deferred_ACU();
    const events: string[] = [];

    const cleanup = runTableWriteTransaction_ACU({ source: 'system_cleanup', reason: 'purge', writeSet: [{ kind: 'all' }], maintenanceMode: 'exclusive' }, async () => {
      events.push('cleanup:start');
      cleanupStarted.resolve();
      await gate.promise;
      events.push('cleanup:end');
    });
    const writer = runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'write', writeSet: sheetWrite('sheet_0') }, async () => {
      events.push('writer:start');
    });

    await cleanupStarted.promise;
    expect(events).toEqual(['cleanup:start']);

    gate.resolve();
    await Promise.all([cleanup, writer]);
    expect(events).toEqual(['cleanup:start', 'cleanup:end', 'writer:start']);
  });

  it('事务使用私有 workingData，不直接复用全局对象引用', async () => {
    const globalData: any = { mate: { type: 'acu', version: 1 }, sheet_0: { name: 'A', content: [['row_id'], ['r1']] } };
    _set_currentJsonTableData_ACU(globalData);

    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'working copy', writeSet: sheetWrite('sheet_0') }, async (_ctx, workingData: any) => {
      expect(workingData).not.toBe(globalData);
      workingData.sheet_0.content.push(['r2']);
    });

    expect(globalData.sheet_0.content).toEqual([['row_id'], ['r1']]);
  });

  it('workingDataMode=none 时不复制 initialData，并向不需要工作副本的提交回调传 null', async () => {
    const serializationProbe = {
      toJSON() {
        throw new Error('不应复制未使用的事务工作数据');
      },
    };
    let receivedWorkingData: any = 'unset';

    await runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'commit precomputed snapshot',
      writeSet: sheetWrite('sheet_0'),
      initialData: { sheet_0: serializationProbe } as any,
      workingDataMode: 'none',
    }, async (_ctx, workingData) => {
      receivedWorkingData = workingData;
    });

    expect(receivedWorkingData).toBeNull();
  });

  it('提交时同表运行时版本已变化则 assertFresh 抛出 runtime revision conflict（丢更新防护）', async () => {
    const staleRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'));

    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'first commit', writeSet: sheetWrite('sheet_0') }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    });

    const commits: string[] = [];
    await expect(runTableWriteTransaction_ACU({
      source: 'manual_crud',
      reason: 'stale commit',
      writeSet: sheetWrite('sheet_0'),
      baseRevision: staleRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => {
        ctx.assertFresh?.('test:before_persist');
        commits.push('commit');
        return 'ok';
      });
    })).rejects.toThrow(/runtime revision conflict/i);

    expect(commits).toEqual([]);
  });

  it('全局写入后旧 all 基线的 all 提交被 assertFresh 拒绝', async () => {
    const staleRevision = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);

    await runTableWriteTransaction_ACU({ source: 'import', reason: 'global commit', writeSet: [{ kind: 'all' }] }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    });

    const commits: string[] = [];
    await expect(runTableWriteTransaction_ACU({
      source: 'import',
      reason: 'stale global commit',
      writeSet: [{ kind: 'all' }],
      baseRevision: staleRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => {
        ctx.assertFresh?.('test:before_persist');
        commits.push('commit');
        return 'ok';
      });
    })).rejects.toThrow(/runtime revision conflict/i);

    expect(commits).toEqual([]);
  });

  it('基线新鲜时 assertFresh 放行；期间同表写入后再断言则抛冲突', async () => {
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'));

    await runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'fresh commit',
      writeSet: sheetWrite('sheet_0'),
      baseRevision,
    }, async (ctx) => {
      ctx.assertFresh?.('test:fresh');
      await ctx.runCommit(async () => 'ok');
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'stale after concurrent write',
      writeSet: sheetWrite('sheet_0'),
      baseRevision,
    }, async (ctx) => {
      ctx.assertFresh?.('test:stale');
    })).rejects.toThrow(/runtime revision conflict/i);
  });

  it('derived_metadata 提交不使同表 source_table 基线陈旧', async () => {
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'));

    await runTableWriteTransaction_ACU({
      source: 'vector_mirror',
      reason: 'mirror metadata commit',
      revisionImpact: 'derived_metadata',
      writeSet: sheetWrite('sheet_0'),
    }, async (ctx) => {
      expect(ctx.revisionImpact).toBe('derived_metadata');
      await ctx.runCommit(async () => 'ok');
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'source result remains fresh',
      writeSet: sheetWrite('sheet_0'),
      baseRevision,
    }, async (ctx) => {
      ctx.assertFresh?.('test:derived_metadata_does_not_stale');
      await ctx.runCommit(async () => 'ok');
    })).resolves.toBeUndefined();
  });

  it('source_table 默认值仍使同表基线陈旧', async () => {
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'));

    await runTableWriteTransaction_ACU({
      source: 'manual_crud',
      reason: 'source commit',
      writeSet: sheetWrite('sheet_0'),
    }, async (ctx) => {
      expect(ctx.revisionImpact).toBe('source_table');
      await ctx.runCommit(async () => 'ok');
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'source baseline stale',
      writeSet: sheetWrite('sheet_0'),
      baseRevision,
    }, async (ctx) => {
      ctx.assertFresh?.('test:source_table_stales');
    })).rejects.toThrow(/runtime revision conflict/i);
  });

  it('同一事务多次 runCommit 后 assertFresh 不被自身 bump 误判', async () => {
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'));
    const events: string[] = [];

    await runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'multi commit',
      writeSet: sheetWrite('sheet_0'),
      baseRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => {
        ctx.assertFresh?.('test:first_commit');
        events.push('first');
        return 'ok';
      });
      await ctx.runCommit(async () => {
        ctx.assertFresh?.('test:second_commit');
        events.push('second');
        return 'ok';
      });
    });

    expect(events).toEqual(['first', 'second']);
  });

  it('不可解析的哨兵 baseRevision 不做冲突校验（向后兼容）', async () => {
    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'bump sheet_0', writeSet: sheetWrite('sheet_0') }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    });

    const commits: string[] = [];
    await runTableWriteTransaction_ACU({
      source: 'manual_crud',
      reason: 'sentinel base',
      writeSet: sheetWrite('sheet_0'),
      baseRevision: 'runtime-v1:test',
    }, async (ctx) => {
      await ctx.runCommit(async () => {
        ctx.assertFresh?.('test:sentinel');
        commits.push('commit');
        return 'ok';
      });
    });

    expect(commits).toEqual(['commit']);
  });

  it('跨聊天作用域的基线快照被 assertFresh 拒绝', async () => {
    const otherScopeRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'), { chatKey: 'chat-b' });

    await expect(runTableWriteTransaction_ACU({
      source: 'manual_crud',
      reason: 'cross scope base',
      writeSet: sheetWrite('sheet_0'),
      baseRevision: otherScopeRevision,
    }, async (ctx) => {
      ctx.assertFresh?.('test:cross_scope');
    })).rejects.toThrow(/runtime revision conflict/i);
  });

  it('不同表版本未变化时允许基于旧快照提交', async () => {
    const sheetBRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_b'));

    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'sheet a commit', writeSet: sheetWrite('sheet_a') }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'manual_crud',
      reason: 'sheet b commit',
      writeSet: sheetWrite('sheet_b'),
      baseRevision: sheetBRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    })).resolves.toBeUndefined();
  });

  it('模板切回场景：曾被写过的表在 all 快照下不再被误判为已变化', async () => {
    // 先前一次切换已写入 sheet_in05z9vz，将其 per-sheet revision 推进（模拟“切到更多表”的模板）。
    await runTableWriteTransaction_ACU({ source: 'template_assistant', reason: 'switch to more sheets', writeSet: sheetWrite('sheet_in05z9vz') }, async (ctx) => {
      await ctx.runCommit(async () => 'ok', sheetWrite('sheet_in05z9vz'));
    });

    // 切回时按模板路径用 all 捕获基线（此后无并发写入）。
    const allRevision = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);

    // 提交的 writeSet 含该具体表（rebase/删除都会进 writeSet）。修复前 expected=0 vs actual>0 会误杀。
    await expect(runTableWriteTransaction_ACU({
      source: 'template_assistant',
      reason: 'chat_template_reconciliation',
      writeSet: sheetWrite('sheet_in05z9vz'),
      baseRevision: allRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => 'ok', sheetWrite('sheet_in05z9vz'));
    })).resolves.toBeUndefined();
  });

  it('all 快照下若期间发生任意写入仍可提交（不再被 global 检查拦截）', async () => {
    const allRevision = captureTableRuntimeRevisionForWriteSet_ACU([{ kind: 'all' }]);

    // 捕获后有并发 per-sheet 写入，global 必然变化。
    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'concurrent write', writeSet: sheetWrite('sheet_x') }, async (ctx) => {
      await ctx.runCommit(async () => 'ok', sheetWrite('sheet_x'));
    });

    const commits: string[] = [];
    await runTableWriteTransaction_ACU({
      source: 'template_assistant',
      reason: 'chat_template_reconciliation',
      writeSet: sheetWrite('sheet_x'),
      baseRevision: allRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => {
        commits.push('commit');
        return 'ok';
     });
    });

    expect(commits).toEqual(['commit']);
  });


  it('提交可只推进实际变更表的运行时版本，不推进锁定但未修改的表', async () => {
    const baseBRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_b'));

    await runTableWriteTransaction_ACU({ source: 'group_fill', reason: 'lock a b but change a', writeSet: [...sheetWrite('sheet_a'), ...sheetWrite('sheet_b')] }, async (ctx) => {
      await ctx.runCommit(async () => 'ok', sheetWrite('sheet_a'));
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'sheet b still fresh',
      writeSet: sheetWrite('sheet_b'),
      baseRevision: baseBRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    })).resolves.toBeUndefined();
  });

  it('显式空实际变更集合不会推进运行时版本', async () => {
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(sheetWrite('sheet_0'));

    await runTableWriteTransaction_ACU({ source: 'group_fill', reason: 'no effective changes', writeSet: sheetWrite('sheet_0') }, async (ctx) => {
      await ctx.runCommit(async () => 'ok', []);
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'group_fill',
      reason: 'same revision after no-op',
      writeSet: sheetWrite('sheet_0'),
      baseRevision,
    }, async (ctx) => {
      await ctx.runCommit(async () => 'ok');
    })).resolves.toBeUndefined();
  });

  it('mutation task 抛错后释放 sheet 锁', async () => {
    const events: string[] = [];

    await expect(runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'throw task', writeSet: sheetWrite('sheet_0') }, async () => {
      events.push('first:start');
      throw new Error('task failed');
    })).rejects.toThrow('task failed');

    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'after throw', writeSet: sheetWrite('sheet_0') }, async () => {
      events.push('second:start');
    });

    expect(events).toEqual(['first:start', 'second:start']);
  });

  it('commit task 抛错后释放 commit 锁和 sheet 锁', async () => {
    const events: string[] = [];

    await expect(runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'throw commit', writeSet: sheetWrite('sheet_a') }, async (ctx) => {
      events.push('first:mutation');
      await ctx.runCommit(async () => {
        events.push('first:commit');
        throw new Error('commit failed');
      });
    })).rejects.toThrow('commit failed');

    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'after commit throw', writeSet: sheetWrite('sheet_b') }, async (ctx) => {
      events.push('second:mutation');
      await ctx.runCommit(async () => {
        events.push('second:commit');
      });
    });

    await runTableWriteTransaction_ACU({ source: 'manual_crud', reason: 'same sheet after commit throw', writeSet: sheetWrite('sheet_a') }, async () => {
      events.push('third:same-sheet');
    });

    expect(events).toEqual(['first:mutation', 'first:commit', 'second:mutation', 'second:commit', 'third:same-sheet']);
  });
});


  it('拒绝在 source_table 变更后以过期基线提交 derived_metadata', async () => {
    const {
      captureTableRuntimeRevisionForWriteSet_ACU,
      runTableWriteTransaction_ACU,
    } = await import('../../../src/service/table/table-write-transaction');
    const isolationKey = 'derived-metadata-stale-baseline';
    const writeSet = [{ kind: 'sheet' as const, sheetKey: 'sheet_summary' }];
    const baseRevision = captureTableRuntimeRevisionForWriteSet_ACU(writeSet, { isolationKey });

    await runTableWriteTransaction_ACU({
      source: 'vector_mirror',
      reason: 'source_table_change_for_stale_baseline_test',
      isolationKey,
      writeSet,
      workingDataMode: 'none',
    }, async (ctx) => {
      await ctx.runCommit(async () => undefined);
    });

    await expect(runTableWriteTransaction_ACU({
      source: 'vector_mirror',
      reason: 'derived_metadata_rejects_stale_baseline_test',
      revisionImpact: 'derived_metadata',
      isolationKey,
      writeSet,
      baseRevision,
      workingDataMode: 'none',
    }, async (ctx) => {
      ctx.assertFresh?.('derived_metadata:before_write');
      await ctx.runCommit(async () => undefined);
    })).rejects.toThrow('runtime revision conflict');
  });
