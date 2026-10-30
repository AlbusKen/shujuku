/**
 * 阶段 J：长历史 replay 性能基准（本地可复现，非浏览器验收）。
 *
 * 运行：npx vitest run tests/performance/v2-replay-performance.bench.test.ts
 *
 * 用 buildLongHistoryFixture_ACU（17 表 / 62 帧 / ~660 op）在真实 replay 核心上
 * 度量：冷 replay（默认 alias 开启）与显式关闭 alias（enableAliasContext:false）
 * 的单次耗时、alias build 次数、SQL 操作数、yield 让出次数。
 *
 * 输出纯数值指标（metrics 已由 SAFE_METRIC_KEYS_ACU 白名单保证不含业务数据），
 * 结果打印为表格。本文件不做断言（性能抖动不设硬门禁，绝对耗时留本地/浏览器报告）。
 */

import { describe, it, beforeAll, expect, vi } from 'vitest';
import { buildLongHistoryFixture_ACU } from '../service/table/v2-long-history-fixture';
import { clearLiveReplayCache_ACU, loadTableStateFromFramesV2Detailed_ACU, loadTableStatesAtBoundariesFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../src/shared/host-api';
import { _set_independentTableStates_ACU, independentTableStates_ACU } from '../../src/service/runtime/state-manager';

// 复用既有测试的模块解析方式：真实 state-manager/chat-gateway，仅静音 log。
vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logDebug_ACU: () => {}, logWarn_ACU: () => {} };
});

describe('阶段 J：长历史 replay 性能基准（本地可复现）', () => {
  let chat: any[];

  beforeAll(() => {
    chat = buildLongHistoryFixture_ACU().chat;
  });

  it('冷 replay（alias 默认开启）与显式关闭 alias 的耗时与计数', async () => {
    // warm-up：首次调用加载 SQLite runtime，不计入统计
    await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    const runs = 5;
    const results: Record<string, any> = {};

    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      const result = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
      const elapsed = performance.now() - start;
      const m = result?.metrics;
      results[`alias_on_${i}`] = {
        elapsedMs: elapsed.toFixed(1),
        frameCount: m?.frameCount,
        sqlOperationCount: m?.sqlOperationCount,
        tableAliasBuildCount: m?.tableAliasBuildCount,
        columnAliasBuildCount: m?.columnAliasBuildCount,
        aliasInvalidateCount: m?.aliasInvalidateCount,
        aliasCacheHitCount: m?.aliasCacheHitCount,
        yieldCount: m?.yieldCount,
      };
    }

    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      const result = await loadTableStateFromFramesV2Detailed_ACU(
        chat, '', { updateRuntimeState: false, enableAliasContext: false },
      );
      const elapsed = performance.now() - start;
      const m = result?.metrics;
      results[`alias_off_${i}`] = {
        elapsedMs: elapsed.toFixed(1),
        frameCount: m?.frameCount,
        sqlOperationCount: m?.sqlOperationCount,
        tableAliasBuildCount: m?.tableAliasBuildCount,
        columnAliasBuildCount: m?.columnAliasBuildCount,
        aliasInvalidateCount: m?.aliasInvalidateCount,
        aliasCacheHitCount: m?.aliasCacheHitCount,
        yieldCount: m?.yieldCount,
      };
    }

    // eslint-disable-next-line no-console
    console.table(results);
    // 单次冷 replay 约 1.6-1.8s，alias 开/关各 5 次共 10 次 ≈ 17-18s；全量并行（8 worker）
    // 的 CPU 争用下会顶破 15s 默认超时。基准的价值在耗时计量表与计数断言，超时只是防挂死护栏。
  }, 60_000);

  it('阶段 H：多 boundary 一次前向捕获 vs 逐次冷 replay 的耗时与结果一致性', async () => {
    const boundaries = [10, 30, 50];
    // 前向捕获：单次 replay 捕获 3 个 boundary
    const startFwd = performance.now();
    const fwd = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(chat, '', boundaries, {
      updateRuntimeState: false,
    });
    const fwdElapsed = performance.now() - startFwd;
    // 逐次冷 replay：3 次独立全量回放
    const startSeq = performance.now();
    const seq = new Map<number, any>();
    for (const boundary of boundaries) {
      seq.set(boundary, await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
        updateRuntimeState: false,
        maxMessageIndex: boundary,
      }));
    }
    const seqElapsed = performance.now() - startSeq;
    // 结果一致性：3 个 boundary 的 canonical data 严格深比较（vitest 原生，key 顺序无关）
    const consistent = boundaries.every((boundary) => {
      const a = fwd.get(boundary)?.data;
      const b = seq.get(boundary)?.data;
      try { expect(a).toEqual(b); return true; } catch { return false; }
    });
    // eslint-disable-next-line no-console
    console.table({
      forward_capture: { elapsedMs: fwdElapsed.toFixed(1), boundaryCount: fwd.size },
      sequential_cold: { elapsedMs: seqElapsed.toFixed(1), boundaryCount: seq.size },
      consistent: consistent,
    });
  });

  it('yield 预算下让出事件循环且 metrics 记录 yieldCount', async () => {
    const start = performance.now();
    const result = await loadTableStateFromFramesV2Detailed_ACU(
      chat, '', { updateRuntimeState: false, yieldBudgetMs: 8 },
    );
    const elapsed = performance.now() - start;
    const m = result?.metrics;
    // eslint-disable-next-line no-console
    console.table({ yield_run: { elapsedMs: elapsed.toFixed(1), yieldCount: m?.yieldCount, frameCount: m?.frameCount } });
  });

  it('宿主当前聊天回放缓存：命中结果与冷回放一致、副作用调用重放 schedule、帧原地改写后失效', async () => {
    const hostChat = buildLongHistoryFixture_ACU().chat;
    // 夹具日志不带填表事件；为尾部两帧补上事件，使 schedule 重放有可比内容。
    const framesWithEntries = hostChat
      .map((message: any) => message?.TavernDB_ACU_IsolatedData?.['']?.storageFrame)
      .filter((frame: any) => Array.isArray(frame?.logEntries) && frame.logEntries.length > 0);
    framesWithEntries.slice(-2).forEach((frame: any, index: number) => {
      const entry = frame.logEntries[frame.logEntries.length - 1];
      entry.filledSheetKeys = [`sheet_schedule_${index}`];
      entry.groupKeys = ['sheet_schedule_group'];
    });
    const previousHostApi = SillyTavern_API_ACU;
    const previousStates = independentTableStates_ACU;
    clearLiveReplayCache_ACU();
    try {
      _set_SillyTavern_API_ACU({ chat: hostChat } as any);
      const startCold = performance.now();
      const cold = await loadTableStateFromFramesV2Detailed_ACU(hostChat, '', { updateRuntimeState: false });
      const coldElapsed = performance.now() - startCold;
      const startHit = performance.now();
      const hit = await loadTableStateFromFramesV2Detailed_ACU(hostChat, '', { updateRuntimeState: false });
      const hitElapsed = performance.now() - startHit;
      expect(cold?.metrics?.replayReuseCount).toBe(0);
      expect(hit?.metrics?.replayReuseCount).toBe(1);
      expect(hit?.metrics?.sqliteHydrateCount).toBe(0);
      expect(hit?.data).toEqual(cold?.data);
      expect(hit?.data).not.toBe(cold?.data);

      // 副作用调用：命中缓存时 schedule 写入必须与冷回放完全一致。
      _set_independentTableStates_ACU({});
      clearLiveReplayCache_ACU();
      await loadTableStateFromFramesV2Detailed_ACU(hostChat, '', { updateRuntimeState: true });
      const coldSchedule = JSON.parse(JSON.stringify(independentTableStates_ACU));
      _set_independentTableStates_ACU({});
      const sideEffectHit = await loadTableStateFromFramesV2Detailed_ACU(hostChat, '', { updateRuntimeState: true });
      expect(sideEffectHit?.metrics?.replayReuseCount).toBe(1);
      expect(independentTableStates_ACU).toEqual(coldSchedule);
      expect(Object.keys(coldSchedule).length).toBeGreaterThan(0);

      // 不改 headRevision 的原地帧改写（如删楼嫁接/降级）必须使缓存失效。
      const lastFrameMessage = [...hostChat].reverse()
        .find((message: any) => message?.TavernDB_ACU_IsolatedData?.['']?.storageFrame?.logEntries?.length > 0);
      const frame = lastFrameMessage.TavernDB_ACU_IsolatedData[''].storageFrame;
      const removedEntry = frame.logEntries.pop();
      const afterMutation = await loadTableStateFromFramesV2Detailed_ACU(hostChat, '', { updateRuntimeState: false });
      expect(afterMutation?.metrics?.replayReuseCount).toBe(0);
      frame.logEntries.push(removedEntry);
      const restored = await loadTableStateFromFramesV2Detailed_ACU(hostChat, '', { updateRuntimeState: false });
      expect(restored?.data).toEqual(cold?.data);

      // eslint-disable-next-line no-console
      console.table({ live_cache: { coldMs: coldElapsed.toFixed(1), hitMs: hitElapsed.toFixed(1) } });
    } finally {
      clearLiveReplayCache_ACU();
      _set_SillyTavern_API_ACU(previousHostApi);
      _set_independentTableStates_ACU(previousStates);
    }
  }, 60_000);
});
