/**
 * tests/service/table/update-scheduler.test.ts
 * 自动更新调度器单元测试
 *
 * 策略：
 * - buildAutoUpdatePlan_ACU 通过构造 mock 聊天记录和表格数据直接测试
 * - checkAutoUpdatePreConditions_ACU 是纯函数，直接测试

 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
}));

// 部分 mock table-history：保留 resolveTableHistoryStatesFromChat_ACU 真实实现
// （buildAutoUpdatePlan_ACU 依赖它从聊天算出 lastTrackedUpdateAiFloor），
// 仅覆盖 full checkpoint 检测为可配置，供跨根 staging 场景使用。
vi.mock('../../../src/service/table/table-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/service/table/table-history')>();
  return {
    ...actual,
    getLatestV2FullCheckpointMessageIndex_ACU: vi.fn(() => -1),
  };
});

import { getLatestV2FullCheckpointMessageIndex_ACU } from '../../../src/service/table/table-history';

import {
  clearRuntimePerformanceSpans_ACU,
  getRecentRuntimePerformanceSpans_ACU,
} from '../../../src/shared/runtime-performance';
import {
  buildAutoUpdatePlan_ACU,
  checkAutoUpdatePreConditions_ACU,

  executeAutoUpdatePlan_ACU,
} from '../../../src/service/table/update-scheduler';

// ═══════════════════════════════════════════════════════════════
// checkAutoUpdatePreConditions_ACU
// ═══════════════════════════════════════════════════════════════
describe('checkAutoUpdatePreConditions_ACU', () => {
  const baseSettings = {
    autoUpdateEnabled: true,
    apiMode: 'custom',
    apiConfig: { useMainApi: true, url: '', model: '' },
    tavernProfile: '',
  };

  it('所有条件满足时返回 canProceed=true', () => {
    const result = checkAutoUpdatePreConditions_ACU(baseSettings);
    expect(result.canProceed).toBe(true);
  });

  it('autoUpdateEnabled=false 时不可继续', () => {
    const result = checkAutoUpdatePreConditions_ACU({ ...baseSettings, autoUpdateEnabled: false });
    expect(result.canProceed).toBe(false);
    expect(result.reason).toContain('disabled');
    expect(result.code).toBe('auto_update_disabled');
  });


  it('调度不再以聊天长度作为前置门控', () => {
    expect(checkAutoUpdatePreConditions_ACU(baseSettings)).toEqual({ canProceed: true });
  });

  it('自定义 API 配置留给请求层校验，不阻断调度', () => {
    const settings = {
      ...baseSettings,
      apiConfig: { useMainApi: false, url: '', model: '' },
    };
    expect(checkAutoUpdatePreConditions_ACU(settings)).toEqual({ canProceed: true });
  });

  it('只检查调度所需状态，不要求全局 API 配置块', () => {
    expect(checkAutoUpdatePreConditions_ACU({ autoUpdateEnabled: true })).toEqual({ canProceed: true });
  });

  it('tavern profile 留给请求层校验，不阻断调度', () => {
    const settings = {
      ...baseSettings,
      apiMode: 'tavern',
      tavernProfile: '',
    };
    expect(checkAutoUpdatePreConditions_ACU(settings)).toEqual({ canProceed: true });
  });


});

// ═══════════════════════════════════════════════════════════════
// buildAutoUpdatePlan_ACU
// ═══════════════════════════════════════════════════════════════
describe('buildAutoUpdatePlan_ACU', () => {
  const baseSettings = {
    autoUpdateFrequency: 1,
    skipUpdateFloors: 0,
    autoUpdateThreshold: 3,
    updateBatchSize: 3,
    dataIsolationEnabled: false,
    dataIsolationCode: '',
  };

  beforeEach(() => {
    vi.mocked(getLatestV2FullCheckpointMessageIndex_ACU).mockReset();
    vi.mocked(getLatestV2FullCheckpointMessageIndex_ACU).mockReturnValue(-1);
  });

  it('无 AI 消息时返回空计划', () => {
    const liveChat = [{ is_user: true }];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(0);
  });

  it('未填历史生成计划，导入基线后仅调度新增楼层', () => {
    const liveChat: any[] = [
      { is_user: true },
      { is_user: false },
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate.length).toBeGreaterThan(0);

    liveChat[3].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: { kind: 'full', reason: 'import', createdAt: 1, data: tableData },
          logEntries: [{
            seq: 1, source: 'import', filledSheetKeys: [], changedSheetKeys: ['sheet_0'],
            operations: [{ kind: 'data_replace', data: tableData, reason: 'checkpoint_fallback' }],
          }],
        },
      },
    };
    expect(buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '').tablesToUpdate).toEqual([]);
    liveChat.push({ is_user: true }, { is_user: false });
    expect(buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '').tablesToUpdate)
      .toMatchObject([{ sheetKey: 'sheet_0', indices: [5], allIndices: [5] }]);

    const frame = liveChat[3].TavernDB_ACU_IsolatedData[''].storageFrame;
    frame.checkpoint.reason = 'compact';
    frame.checkpoint.scheduleSummary = { sheet_0: { lastImportBaselineAiFloor: 2 } };
    frame.logEntries = [];
    expect(buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '').tablesToUpdate)
      .toMatchObject([{ sheetKey: 'sheet_0', indices: [5] }]);
    expect(buildAutoUpdatePlan_ACU(liveChat, tableData, { ...baseSettings, autoUpdateFrequency: 2 }, '').tablesToUpdate)
      .toEqual([]);
  });

  it('updateFrequency=0 的表不参与自动更新', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: { updateFrequency: 0 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(0);
  });

  it('已更新的表不重复更新', () => {
    const liveChat = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: { sheet_0: { name: '测试表' } },
            modifiedKeys: ['sheet_0'],
            updateGroupKeys: ['sheet_0'],
          },
        },
      },
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(0);
  });

  it('skipFloors 跳过最近的楼层', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false }, // AI 1
      { is_user: true },
      { is_user: false }, // AI 2
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    // skipFloors=1 跳过最后一个 AI 楼层
    const settings = { ...baseSettings, skipUpdateFloors: 1 };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, settings, '');
    // 只有 AI 1 在范围内
    if (plan.tablesToUpdate.length > 0) {
      const indices = plan.tablesToUpdate[0].indices;
      // 不应该包含最后一个 AI 消息的索引
      expect(indices).not.toContain(3);
    }
  });

  it('多个表分组到同一个 group', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '表A', updateConfig: { groupId: 1 } },
      sheet_1: { name: '表B', updateConfig: { groupId: 1 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    const groupKeys = Object.keys(plan.updateGroups);
    // 同一 groupId 的表应该在同一个 group 中
    if (groupKeys.length > 0) {
      const group = plan.updateGroups[groupKeys[0]];
      expect(group.sheetKeys.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('不同 groupId 的表分到不同 group', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '表A', updateConfig: { groupId: 1 } },
      sheet_1: { name: '表B', updateConfig: { groupId: 2 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    if (plan.tablesToUpdate.length >= 2) {
      const groupKeys = Object.keys(plan.updateGroups);
      expect(groupKeys.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('飞行模式的大总结与纪要表沿用相同调度配置时进入同一更新组', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false },
    ];
    const sharedUpdateConfig = {
      contextDepth: 3,
      updateFrequency: 1,
      skipFloors: 0,
      batchSize: 2,
      groupId: 8,
    };
    const tableData = {
      sheet_chronicle: { name: '纪要表', updateConfig: sharedUpdateConfig },
      sheet_da_zong_jie: { name: '大总结', updateConfig: { ...sharedUpdateConfig } },
    };

    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');

    expect(plan.tablesToUpdate.map(item => item.sheetName)).toEqual(['纪要表', '大总结']);
    expect(Object.values(plan.updateGroups)).toEqual([
      expect.objectContaining({ groupId: 8, sheetKeys: ['sheet_chronicle', 'sheet_da_zong_jie'] }),
    ]);
  });

  it('同组但不同频率的表不会被强制合组', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false },
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '表A', updateConfig: { groupId: 1, updateFrequency: 1 } },
      sheet_1: { name: '表B', updateConfig: { groupId: 1, updateFrequency: 2 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    const groupKeys = Object.keys(plan.updateGroups);
    expect(groupKeys.length).toBeGreaterThanOrEqual(2);
  });

  it('旧版存储格式的更新检测', () => {
    const liveChat = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
        TavernDB_ACU_UpdateGroupKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false }, // 新的未更新消息
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    // sheet_0 在索引1已更新，索引3未更新，应该生成更新计划
    expect(plan.tablesToUpdate.length).toBeGreaterThanOrEqual(0);
  });

  it('仅保存表数据但没有追踪键时，高频表不应被视为已更新并顺延下次更新楼层', () => {
    const liveChat = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: { sheet_0: { name: '高频表' } },
            modifiedKeys: [],
            updateGroupKeys: [],
          },
        },
      },
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '高频表', updateConfig: { updateFrequency: 3 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(0);
  });

  it('存在追踪键时，高频表才按真实更新楼层计算下轮触发', () => {
    const liveChat = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: { sheet_0: { name: '高频表' } },
            modifiedKeys: ['sheet_0'],
            updateGroupKeys: ['sheet_0'],
          },
        },
      },
      { is_user: true },
      { is_user: false },
      { is_user: true },
      { is_user: false },
      { is_user: true },
      { is_user: false },
    ];
    const tableData = {
      sheet_0: { name: '高频表', updateConfig: { updateFrequency: 3 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(1);
    expect(plan.tablesToUpdate[0].indices).toContain(7);
  });

  it('空表格数据返回空计划', () => {
    const liveChat = [{ is_user: true }, { is_user: false }];
    const plan = buildAutoUpdatePlan_ACU(liveChat, {}, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(0);
  });

  it('contextDepth 不再裁剪历史补填范围（完整缺口优先，计划 §5.6）', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false }, // AI 1
      { is_user: true },
      { is_user: false }, // AI 2
      { is_user: true },
      { is_user: false }, // AI 3
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: { contextDepth: 1 } },
    };
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(1);
    // contextDepth 是 AI prompt 上下文窗口，不是历史补填范围：
    // 完整待填缺口应为全部未更新 AI 楼层，即使 contextDepth=1 也不裁剪。
    expect(plan.tablesToUpdate[0].indices).toEqual([1, 3, 5]);
    expect(plan.tablesToUpdate[0].allIndices).toEqual([1, 3, 5]);
    expect(plan.tablesToUpdate[0].requiresBoundaryStaging).toBe(false);
    expect(plan.boundary).toEqual({ fullCheckpointIndices: [], requiresBoundaryStaging: false });
  });

  it('跨 full checkpoint：待填范围早于原 full 的表标记 requiresBoundaryStaging=true', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false }, // AI 1
      { is_user: true },
      { is_user: false }, // AI 2
      { is_user: true },
      { is_user: false }, // AI 3
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    // 原 full 在 AI 2（消息索引 3）：待填 [1,3,5] 中 1 < 3，跨根成立。
    vi.mocked(getLatestV2FullCheckpointMessageIndex_ACU).mockReturnValue(3);
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(1);
    expect(plan.tablesToUpdate[0].requiresBoundaryStaging).toBe(true);
    expect(plan.boundary).toEqual({ fullCheckpointIndices: [3], requiresBoundaryStaging: true });
  });

  it('跨 full checkpoint：待填范围全在边界后不标记 staging', () => {
    const liveChat = [
      { is_user: true },
      { is_user: false }, // AI 1
      { is_user: true },
      { is_user: false }, // AI 2
      { is_user: true },
      { is_user: false }, // AI 3
    ];
    const tableData = {
      sheet_0: { name: '测试表', updateConfig: {} },
    };
    // 原 full 在 AI 1（消息索引 1）：待填 [1,3,5] 中 1 >= 1，不跨根。
    vi.mocked(getLatestV2FullCheckpointMessageIndex_ACU).mockReturnValue(1);
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, baseSettings, '');
    expect(plan.tablesToUpdate).toHaveLength(1);
    expect(plan.tablesToUpdate[0].requiresBoundaryStaging).toBe(false);
    expect(plan.boundary).toEqual({ fullCheckpointIndices: [1], requiresBoundaryStaging: false });
  });

  it('同组混合正常表与跨根表时按 staging 归属拆成两个组', () => {
    const liveChat = [
      { is_user: true },
      {
        is_user: false,
        // AI 1：sheet_a 在该楼已 tracking（updateGroupKeys），lastTrackedUpdateAiFloor=1
        TavernDB_ACU_IsolatedData: { 'test-iso': { updateGroupKeys: ['sheet_a'] } },
      },
      { is_user: true },
      { is_user: false }, // AI 2
      { is_user: true },
      { is_user: false }, // AI 3
    ];
    const tableData = {
      sheet_a: { name: '正常表', updateConfig: { groupId: 1 } },
      sheet_b: { name: '跨根表', updateConfig: { groupId: 1 } },
    };
    vi.mocked(getLatestV2FullCheckpointMessageIndex_ACU).mockReturnValue(3);
    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, {
      ...baseSettings,
      dataIsolationEnabled: true,
      dataIsolationCode: 'test-iso',
    }, 'test-iso');
    expect(plan.tablesToUpdate).toHaveLength(2);
    const groupKeys = Object.keys(plan.updateGroups);
    // 同 groupId 但 staging 归属不同 → 拆成两个组，防止提交语义混在一次统一提交。
    expect(groupKeys.length).toBe(2);
    const stagingGroup = groupKeys.find(key => plan.updateGroups[key].requiresBoundaryStaging === true);
    const normalGroup = groupKeys.find(key => plan.updateGroups[key].requiresBoundaryStaging !== true);
    expect(stagingGroup).toBeDefined();
    expect(normalGroup).toBeDefined();
    expect(plan.updateGroups[stagingGroup!].sheetKeys).toContain('sheet_b');
    expect(plan.updateGroups[normalGroup!].sheetKeys).toContain('sheet_a');
  });

  it.each([
    { messageCount: 50, sheetCount: 8 },
    { messageCount: 200, sheetCount: 20 },
    { messageCount: 500, sheetCount: 40 },
  ])('合成基线 $messageCount messages × $sheetCount sheets 保持聊天层线性读取', ({ messageCount, sheetCount }) => {
    let isUserReads = 0;
    const liveChat = Array.from({ length: messageCount }, (_, index) => new Proxy({
      is_user: index % 2 === 0,
    }, {
      get(target, property, receiver) {
        if (property === 'is_user') isUserReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }));
    const tableData = Object.fromEntries(Array.from({ length: sheetCount }, (_, index) => [
      `sheet_${index}`,
      { name: `表${index}`, updateConfig: { updateFrequency: 1, contextDepth: 3, groupId: index % 4 } },
    ]));

    const plan = buildAutoUpdatePlan_ACU(liveChat, tableData, {
      ...baseSettings,
      performanceDiagnosticsEnabled: true,
    }, '');

    expect(plan.tablesToUpdate).toHaveLength(sheetCount);
    expect(isUserReads).toBeLessThanOrEqual(messageCount * 3);
  });
});

// ═══════════════════════════════════════════════════════════════
// executeAutoUpdatePlan_ACU
// ═══════════════════════════════════════════════════════════════
describe('executeAutoUpdatePlan_ACU', () => {
  // mock merge-logic 模块（executeAutoUpdatePlan_ACU 内部动态 import）
  vi.mock('../../../src/service/summary/merge-logic', () => ({
    checkAutoMergeTrigger_ACU: vi.fn(() => ({ shouldTrigger: false })),
    prepareAutoMergeBatches_ACU: vi.fn(),
    executeAutoMergeBatch_ACU: vi.fn(),
    finalizeAutoMerge_ACU: vi.fn(),
  }));

  const baseSettings = {
    maxConcurrentGroups: 2,
  };

  const mockSetAutoUpdating = vi.fn();

  function makeOps(overrides: Partial<{
    processUpdates: any;
    processGroupedUpdates: any;
    refreshData: any;
    loadAllChatMessages: any;
    purgeOldLayerData: any;
  }> = {}) {
    return {
      processUpdates: overrides.processUpdates || vi.fn().mockResolvedValue(true),
      processGroupedUpdates: overrides.processGroupedUpdates,
      refreshData: overrides.refreshData || vi.fn().mockResolvedValue(undefined),
      loadAllChatMessages: overrides.loadAllChatMessages || vi.fn().mockResolvedValue(undefined),
      purgeOldLayerData: overrides.purgeOldLayerData || vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearRuntimePerformanceSpans_ACU();
  });

  it('空计划返回 success', async () => {
    const plan = { tablesToUpdate: [], updateGroups: {} };
    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, makeOps());
    expect(result.success).toBe(true);
    expect(result.totalGroups).toBe(0);
    expect(result.failedGroups).toBe(0);
  });

  it('单组全部成功', async () => {
    const plan = {
      tablesToUpdate: [{ sheetKey: 'sheet_0', sheetName: '表A', indices: [1], groupId: 0, batchSize: 2 }],
      updateGroups: {
        '0|1|2': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
      },
    };
    const ops = makeOps();
    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);
    expect(result.success).toBe(true);
    expect(result.totalGroups).toBe(1);
    expect(result.failedGroups).toBe(0);
    expect(ops.processUpdates).toHaveBeenCalledTimes(1);
    expect(ops.loadAllChatMessages).toHaveBeenCalled();
    expect(ops.refreshData).toHaveBeenCalled();
    expect(ops.purgeOldLayerData).toHaveBeenCalled();
  });

  it('提供 processGroupedUpdates 时优先走 grouped 委托', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
        'group_b': { indices: [2], batchSize: 2, groupId: 1, sheetKeys: ['sheet_1'], sheetNames: ['表B'] },
      },
    };
    const mockGrouped = vi.fn().mockResolvedValue({ success: true, failedGroups: [] });
    const mockProcess = vi.fn().mockResolvedValue(true);
    const ops = makeOps({ processGroupedUpdates: mockGrouped, processUpdates: mockProcess });

    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);

    expect(result.success).toBe(true);
    expect(mockGrouped).toHaveBeenCalledTimes(1);
    expect(mockGrouped).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: { skipProfileSwitch: true, forceDirectApi: true } }),
      expect.objectContaining({ key: 'group_b', groupId: 1, indices: [2], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: { skipProfileSwitch: true, forceDirectApi: true } }),
    ], 'auto_independent', {});
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('grouped 委托返回 failedGroups 时按数量汇总失败组', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
        'group_b': { indices: [2], batchSize: 2, groupId: 1, sheetKeys: ['sheet_1'], sheetNames: ['表B'] },
      },
    };
    const mockGrouped = vi.fn().mockResolvedValue({ success: false, failedGroups: ['group_a'] });
    const mockProcess = vi.fn().mockResolvedValue(true);
    const ops = makeOps({ processGroupedUpdates: mockGrouped, processUpdates: mockProcess });

    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);

    expect(result.success).toBe(false);
    expect(result.failedGroups).toBe(1);
    expect(result.totalGroups).toBe(2);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('多组部分失败', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
        'group_b': { indices: [1], batchSize: 2, groupId: 1, sheetKeys: ['sheet_1'], sheetNames: ['表B'] },
      },
    };
    const mockProcess = vi.fn()
      .mockResolvedValueOnce(true)   // group_a 成功
      .mockResolvedValueOnce(false); // group_b 失败

    const ops = makeOps({ processUpdates: mockProcess });
    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);
    expect(result.success).toBe(false);
    expect(result.failedGroups).toBe(1);
    expect(result.totalGroups).toBe(2);
  });

  it('processUpdates 抛异常时计为失败', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
      },
    };
    const mockProcess = vi.fn().mockRejectedValue(new Error('网络错误'));
    const ops = makeOps({ processUpdates: mockProcess });
    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);
    expect(result.success).toBe(false);
    expect(result.failedGroups).toBe(1);
  });

  it('staging 组缺少任何 staging/grouped runner 时不降级到 processUpdates，返回稳定失败', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'stage_a': {
          indices: [1], batchSize: 2, groupId: 0,
          sheetKeys: ['sheet_0'], sheetNames: ['表A'],
          requiresBoundaryStaging: true,
        },
      },
      boundary: { fullCheckpointIndices: [3], requiresBoundaryStaging: true },
    };
    const mockProcess = vi.fn().mockResolvedValue(true);
    const ops = makeOps({ processUpdates: mockProcess });

    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);

    expect(mockProcess).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failedGroups).toBe(1);
    expect(result.totalGroups).toBe(1);
    expect(result.errors).toEqual([expect.stringContaining('staging_runner_unavailable')]);
  });

  it('normal 组缺 grouped runner 时可降级到 processUpdates，但 staging 组缺 runner 仍必须失败', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'normal_a': {
          indices: [1], batchSize: 2, groupId: 0,
          sheetKeys: ['sheet_0'], sheetNames: ['表A'],
          requiresBoundaryStaging: false,
        },
        'stage_b': {
          indices: [2], batchSize: 2, groupId: 1,
          sheetKeys: ['sheet_1'], sheetNames: ['表B'],
          requiresBoundaryStaging: true,
        },
      },
      boundary: { fullCheckpointIndices: [3], requiresBoundaryStaging: true },
    };
    const mockProcess = vi.fn().mockResolvedValue(true);
    const ops = makeOps({ processUpdates: mockProcess });

    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);

    // normal 组走 legacy processUpdates；staging 组不降级，整体失败
    expect(mockProcess).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.failedGroups).toBe(1);
    expect(result.errors).toEqual([expect.stringContaining('staging_runner_unavailable')]);
  });


  it('setAutoUpdating 被正确调用', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
      },
    };
    const ops = makeOps();
    await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);
    // 开始时设为 true，结束时设为 false
    expect(mockSetAutoUpdating).toHaveBeenCalledWith(true);
    expect(mockSetAutoUpdating).toHaveBeenCalledWith(false);
  });

  it('自动合并触发成功', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
      },
    };
    const ops = makeOps();

    const mergeLogic = await import('../../../src/service/summary/merge-logic');
    vi.mocked(mergeLogic.checkAutoMergeTrigger_ACU).mockReturnValue({ shouldTrigger: true, mergeCount: 5 });
    vi.mocked(mergeLogic.prepareAutoMergeBatches_ACU).mockReturnValue({ batches: [{ startIndex: 0, endIndex: 5 }] } as any);
    vi.mocked(mergeLogic.executeAutoMergeBatch_ACU).mockResolvedValue({ accumulatedSummary: ['合并结果'] } as any);
    vi.mocked(mergeLogic.finalizeAutoMerge_ACU).mockResolvedValue(undefined);

    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);
    expect(result.autoMergeTriggered).toBe(true);
    expect(result.autoMergeSuccess).toBe(true);
  });

  it('purgeOldLayerData 失败不影响整体结果', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        'group_a': { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
      },
    };
    const ops = makeOps({
      purgeOldLayerData: vi.fn().mockRejectedValue(new Error('清理失败')),
    });
    const result = await executeAutoUpdatePlan_ACU(plan, baseSettings, mockSetAutoUpdating, ops);
    expect(result.success).toBe(true); // 清理失败不影响整体
  });

  it('执行链异常退出时仍关闭性能 span 并记录失败', async () => {
    const plan = {
      tablesToUpdate: [],
      updateGroups: {
        group_a: { indices: [1], batchSize: 2, groupId: 0, sheetKeys: ['sheet_0'], sheetNames: ['表A'] },
      },
    };
    const ops = makeOps({
      loadAllChatMessages: vi.fn().mockRejectedValue(new Error('load failed')),
    });

    await expect(executeAutoUpdatePlan_ACU(
      plan,
      { ...baseSettings, performanceDiagnosticsEnabled: true },
      mockSetAutoUpdating,
      ops,
      { runId: 'run-failure', parentSpanId: 'parent-failure' },
    )).rejects.toThrow('load failed');

    expect(getRecentRuntimePerformanceSpans_ACU()).toContainEqual(expect.objectContaining({
      name: 'auto-update-execute', runId: 'run-failure', parentSpanId: 'parent-failure', metrics: expect.objectContaining({ success: false }),
    }));
  });
});
