/**
 * H3：高楼层 replay 基准（默认跳过，见 high-floor-bench-config.ts）。
 *
 * 运行：$env:ACU_HIGH_FLOOR_BENCH='1'; & .\node_modules\.bin\vitest.cmd run tests/performance/high-floor-replay.bench.test.ts
 *
 * 每个规模度量：冷 replay；当前聊天回放缓存命中（命中前仍扫描帧计算输入指纹）；
 * 生命周期派生（以单次帧扫描为主，取 5 次平均）。只打印数值，不设耗时门禁。
 */

import { describe, it, expect, vi } from 'vitest';
import { buildLongHistoryFixture_ACU } from '../service/table/v2-long-history-fixture';
import { clearLiveReplayCache_ACU, deriveSheetLifecycleFromFramesV2_ACU, loadTableStateFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../src/shared/host-api';
import { HIGH_FLOOR_BENCH_ENABLED_ACU, HIGH_FLOOR_BENCH_TIMEOUT_MS_ACU, resolveHighFloorBenchSizes_ACU } from './high-floor-bench-config';

vi.mock('../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../src/shared/utils');
  return { ...actual, logDebug_ACU: () => {}, logWarn_ACU: () => {} };
});

describe.skipIf(!HIGH_FLOOR_BENCH_ENABLED_ACU)('H3 高楼层 replay 基准', () => {
  it('冷 replay、回放缓存命中与帧扫描随楼层的耗时', async () => {
    const sizes = resolveHighFloorBenchSizes_ACU();
    // warm-up：加载 SQLite runtime，不计入统计
    await loadTableStateFromFramesV2Detailed_ACU(buildLongHistoryFixture_ACU().chat, '', { updateRuntimeState: false });
    const rows: Record<string, unknown> = {};
    const previousHostApi = SillyTavern_API_ACU;
    try {
      for (const size of sizes) {
        const { chat } = buildLongHistoryFixture_ACU(size);
        clearLiveReplayCache_ACU();
        _set_SillyTavern_API_ACU({ chat } as any);
        let start = performance.now();
        const cold = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
        const coldMs = performance.now() - start;
        start = performance.now();
        const hit = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
        const hitMs = performance.now() - start;
        expect(hit?.metrics?.replayReuseCount).toBe(1);
        expect(hit?.data).toEqual(cold?.data);
        const scanRuns = 5;
        start = performance.now();
        for (let i = 0; i < scanRuns; i += 1) deriveSheetLifecycleFromFramesV2_ACU(chat, '');
        const scanMs = (performance.now() - start) / scanRuns;
        rows[`floors_${size}`] = {
          coldMs: coldMs.toFixed(1),
          coldPerFrameMs: (coldMs / size).toFixed(2),
          cacheHitMs: hitMs.toFixed(1),
          lifecycleScanMs: scanMs.toFixed(2),
          frameCount: cold?.metrics?.frameCount,
          sqlOperationCount: cold?.metrics?.sqlOperationCount,
          yieldCount: cold?.metrics?.yieldCount,
        };
      }
    } finally {
      clearLiveReplayCache_ACU();
      _set_SillyTavern_API_ACU(previousHostApi);
    }
    // eslint-disable-next-line no-console
    console.table(rows);
  }, HIGH_FLOOR_BENCH_TIMEOUT_MS_ACU);
});
