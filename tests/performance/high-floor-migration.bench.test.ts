/**
 * H3：高楼层 legacy→V2 迁移基准（默认跳过，见 high-floor-bench-config.ts）。
 *
 * 运行：$env:ACU_HIGH_FLOOR_BENCH='1'; & .\node_modules\.bin\vitest.cmd run tests/performance/high-floor-migration.bench.test.ts
 *
 * 每个 AI 楼层前有一条用户楼；AI 楼层轮流写入 17 张表之一的旧字段。
 * 合并结果按楼层顺序取每表最后一次写入。heapUsedDeltaMB 受 GC 影响，仅作参考。
 */

import { describe, it, expect, vi } from 'vitest';
import { HIGH_FLOOR_BENCH_ENABLED_ACU, HIGH_FLOOR_BENCH_TIMEOUT_MS_ACU, resolveHighFloorBenchSizes_ACU } from './high-floor-bench-config';

const { mockChatRef, mockSaveChatToHost } = vi.hoisted(() => ({
  mockChatRef: { value: [] as any[] },
  mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChatRef.value),
  saveChatToHostStrict_ACU: mockSaveChatToHost,
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: { storageMode: 'native' },
  currentChatFileIdentifier_ACU: 'high-floor-bench-chat',
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../src/shared/utils');
  return { ...actual, logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() };
});

import { migrateLegacyStorageToV2OnLoad_ACU } from '../../src/service/table/storage-v2-migration';

const SHEET_COUNT = 17;

function legacySheet(index: number, floor: number): any {
  return {
    uid: `uid_${index}`,
    name: `表${index}`,
    content: [['row_id', 'name', 'value'], ['1', `行${index}`, floor]],
    updateConfig: {},
    exportConfig: {},
    sourceData: {},
    orderNo: index,
  };
}

function buildLegacyChat(aiFloors: number): { chat: any[]; data: Record<string, any> } {
  const chat: any[] = [];
  const data: Record<string, any> = {};
  for (let floor = 1; floor <= aiFloors; floor += 1) {
    const index = floor % SHEET_COUNT;
    const key = `sheet_${index}`;
    const sheet = legacySheet(index, floor);
    chat.push({ is_user: true, mes: `用户 ${floor}` });
    chat.push({ is_user: false, mes: `AI ${floor}`, TavernDB_ACU_IndependentData: { [key]: sheet }, TavernDB_ACU_ModifiedKeys: [key] });
    data[key] = JSON.parse(JSON.stringify(sheet));
  }
  return { chat, data };
}

describe.skipIf(!HIGH_FLOOR_BENCH_ENABLED_ACU)('H3 高楼层迁移基准', () => {
  it('legacy→V2 迁移随楼层的耗时', async () => {
    const rows: Record<string, unknown> = {};
    for (const size of resolveHighFloorBenchSizes_ACU()) {
      const { chat, data } = buildLegacyChat(size);
      mockChatRef.value = chat;
      mockSaveChatToHost.mockClear();
      const heapBefore = process.memoryUsage().heapUsed;
      const start = performance.now();
      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data: data as any, isolationKey: '', isolationConfig: { enabled: false, code: '' } });
      const elapsedMs = performance.now() - start;
      const heapDelta = process.memoryUsage().heapUsed - heapBefore;
      expect(result, String(result.error ?? '')).toMatchObject({ migrated: true });
      rows[`floors_${size}`] = {
        messageCount: chat.length,
        elapsedMs: elapsedMs.toFixed(1),
        perAiFloorMs: (elapsedMs / size).toFixed(3),
        saveCalls: mockSaveChatToHost.mock.calls.length,
        heapUsedDeltaMB: (heapDelta / 1048576).toFixed(1),
      };
    }
    // eslint-disable-next-line no-console
    console.table(rows);
  }, HIGH_FLOOR_BENCH_TIMEOUT_MS_ACU);
});
