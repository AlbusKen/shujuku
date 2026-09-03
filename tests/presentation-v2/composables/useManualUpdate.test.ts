/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let displayTableData: any = {
  sheet_0: { name: '物品表', content: [['row_id', '名称']] },
};
let templateDisplayData: any = null;
let templateParseThrows = false;
let worldbookInjectionTarget: string | undefined = undefined;
let primaryLorebookName: string | null = '主世界书';

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`等待条件超时：${label}`);
}

async function importManualUpdate() {
  vi.resetModules();
  const settings: any = {
    autoUpdateThreshold: 3,
    updateBatchSize: 2,
    manualUpdateContextDepth: 3,
    manualUpdateBatchSize: 2,
    manualSelectedTables: ['sheet_0'],
    hasManualSelection: true,
  };
  const currentJsonTableData: any = {
    sheet_0: { name: '物品表', content: [['row_id', '名称']] },
  };
  const chat = [{ is_user: false, mes: 'AI 1' }];
  const orchestrateManualUpdate_ACU = vi.fn();
  const orchestrateManualCatchUp_ACU = vi.fn();
  const prepareManualCatchUpPlan_ACU = vi.fn();
  const refreshMergedDataAndNotify_ACU = vi.fn(async () => undefined);
  const notifyTableUpdate = vi.fn();
  const setWasStoppedByUser = vi.fn();
  const saveSettings_ACU = vi.fn();

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    currentJsonTableData_ACU: currentJsonTableData,
    settings_ACU: settings,
    abortAllActiveRequests_ACU: vi.fn(),
    _set_isAutoUpdatingCard_ACU: vi.fn(),
    _set_manualExtraHint_ACU: vi.fn(),
    _set_wasStoppedByUser_ACU: setWasStoppedByUser,
    getCurrentIsolationKey_ACU: vi.fn(() => ''),
  }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: vi.fn(() => chat),
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU,
  }));
  vi.doMock('../../../src/service/worldbook/worldbook-service', () => ({
    getCurrentCharPrimaryLorebook_ACU: vi.fn(async () => primaryLorebookName),
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentWorldbookConfig_ACU: vi.fn(() => ({ summaryVectorIndexModeEnabled: false, injectionTarget: worldbookInjectionTarget })),
    getCurrentTableDisplayData_ACU: () => {
      if (templateParseThrows) return null;
      return displayTableData || templateDisplayData;
    },
    hasRuntimeTableData_ACU: () => {
      return !!displayTableData;
    },
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: (tables: Record<string, unknown>) => Object.keys(tables),
  }));
  vi.doMock('../../../src/service/table/table-history', () => ({
    collectV2CheckpointFloorsFromChat_ACU: vi.fn(() => [{ messageIndex: 0, aiFloor: 1, reason: 'init' }]),
  }));
  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    executeCardUpdateCore_ACU: vi.fn(),
    orchestrateManualUpdate_ACU,
    orchestrateManualCatchUp_ACU,
    prepareManualCatchUpPlan_ACU,
    processUpdatesBatch_ACU: vi.fn(),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({
    refreshMergedDataAndNotify_ACU,
  }));
  vi.doMock('../../../src/shared/env', () => ({
    topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: notifyTableUpdate } },
  }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const [{ useManualUpdate }, { useDialogStore }, { useToastStore, __resetToastStoreForTests }] = await Promise.all([
    import('../../../src/presentation-v2/composables/useManualUpdate'),
    import('../../../src/presentation-v2/stores/dialog-store'),
    import('../../../src/presentation-v2/stores/toast-store'),
  ]);
  return {
    useManualUpdate,
    dialog: useDialogStore(),
    toast: useToastStore(),
    __resetToastStoreForTests,
    settings,
    saveSettings_ACU,
    orchestrateManualUpdate_ACU,
    orchestrateManualCatchUp_ACU,
    prepareManualCatchUpPlan_ACU,
    refreshMergedDataAndNotify_ACU,
    notifyTableUpdate,
    setWasStoppedByUser,
  };
}

beforeEach(() => {
  displayTableData = {
    sheet_0: { name: '物品表', content: [['row_id', '名称']] },
  };
  templateDisplayData = null;
  templateParseThrows = false;
  worldbookInjectionTarget = undefined;
  primaryLorebookName = '主世界书';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useManualUpdate 表格展示的模板回退', () => {
  it('runtime 为 null 时选择器显示全局模板表名', async () => {
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    const { useManualUpdate } = await importManualUpdate();
    const manual = useManualUpdate();

    expect(manual.sheetKeys.value).toEqual(['sheet_tpl']);
    expect(manual.sheetNames.value).toEqual({ sheet_tpl: '模板表' });
  });

  it('模板解析失败时维持空态，不抛出', async () => {
    displayTableData = null;
    templateParseThrows = true;
    const { useManualUpdate } = await importManualUpdate();
    const manual = useManualUpdate();

    expect(manual.sheetKeys.value).toEqual([]);
    expect(manual.sheetNames.value).toEqual({});
  });

  it('runtime 为空时展示模板表，但执行选择键保持为空，不得把模板表当作执行目标', async () => {
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    const { useManualUpdate } = await importManualUpdate();
    const manual = useManualUpdate();

    // 展示层可见模板表
    expect(manual.sheetKeys.value).toEqual(['sheet_tpl']);
    // 执行层必须为空：purge 后 runtime 未就绪
    expect(manual.selectedManualTableKeys.value).toEqual([]);
    // 全选也不能把模板表纳入执行目标
    manual.selectAllManualTables();
    expect(manual.selectedManualTableKeys.value).toEqual([]);
  });
});

describe('useManualUpdate destructive refill confirmation', () => {
  it('单次确认文案明示会删除范围内 checkpoint 与增量，并提示不可恢复风险', async () => {
    const { useManualUpdate, dialog, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');

    expect(dialog.active?.message).toContain('会先删除本次重填范围内选中表的 checkpoint 与 V2 增量日志');
    expect(dialog.active?.message).toContain('此前楼层的表格数据将无法恢复');
    expect(dialog.active?.message).toContain('范围外的 checkpoint、范围外聊天记录的表格数据和未选中的表不会被删除');
    // 二次确认链路已移除，首次文案不得再承诺它。
    expect(dialog.active?.message).not.toContain('第二次破坏性确认');
    // Issue #13：orchestrator 的失败语义是「不回滚、已清理不恢复、已提交批次保留」，文案不得承诺回滚。
    expect(dialog.active?.message).toContain('执行失败或中途终止时不会回滚');
    expect(dialog.active?.message).toContain('已成功提交的批次会保留');
    expect(dialog.active?.message).not.toContain('会回滚到本次操作前的状态');
    // 默认注入目标是角色卡绑定的主世界书：大规模回填前必须让用户看到条目将写去哪里。
    expect(dialog.active?.message).toContain('世界书注入目标：角色卡绑定世界书 · 主世界书');
    expect(dialog.active?.confirmVariant).toBe('danger');

    dialog.cancelActive();
    await pending;
    __resetToastStoreForTests();
  });

  it('注入目标为指定世界书时，确认文案显示该世界书名', async () => {
    worldbookInjectionTarget = '太渊战记外挂数据库';
    const { useManualUpdate, dialog, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');

    expect(dialog.active?.message).toContain('世界书注入目标：太渊战记外挂数据库');

    dialog.cancelActive();
    await pending;
    __resetToastStoreForTests();
  });

  it('角色卡主世界书解析失败时，确认文案降级提示而不阻断确认流程', async () => {
    primaryLorebookName = null;
    const { useManualUpdate, dialog, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');

    expect(dialog.active?.message).toContain('世界书注入目标：角色卡绑定世界书（未解析到主世界书）');

    dialog.cancelActive();
    await pending;
    __resetToastStoreForTests();
  });

  it('用户取消唯一确认时不调用 orchestrator，且不展示 error toast', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    dialog.cancelActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'error')).toBe(false);
    __resetToastStoreForTests();
  });

  it('用户确认后只调用 orchestrator 一次，且不再传 confirmBoundaryReset', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).toEqual(expect.objectContaining({ clearBeforeUpdate: true }));
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3]).not.toHaveProperty('confirmBoundaryReset');
    __resetToastStoreForTests();
  });

  it('orchestrator 失败时展示 error toast', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: false, error: '清理后重填失败' });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(toast.items.at(-1)?.kind).toBe('error');
    expect(toast.items.at(-1)?.text).toContain('清理后重填失败');
    __resetToastStoreForTests();
  });
});

describe('useManualUpdate purge 后执行边界守卫', () => {
  it('runtime 未就绪时 setManualSelectedKeys 不写持久化选择（不清空用户配置）', async () => {
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    // 模拟用户 purge 前已有显式手动选择
    const { useManualUpdate, __resetToastStoreForTests } = await importManualUpdate();
    // 修改 mock 设置以带出既有选择：直接通过 saveManualSelection 的守卫语义验证
    // （displayTableData 为 null 时 hasRuntimeTableData_ACU() 返回 false）
    const manual = useManualUpdate();

    // 展示层仍可见模板表，但执行选择为空
    expect(manual.sheetKeys.value).toEqual(['sheet_tpl']);
    expect(manual.runtimeReady.value).toBe(false);
    expect(manual.selectedManualTableKeys.value).toEqual([]);

    // 尝试选择模板表：因 runtime 未就绪，选择保持为空
    manual.setManualSelectedKeys(['sheet_tpl']);
    expect(manual.selectedManualTableKeys.value).toEqual([]);
    __resetToastStoreForTests();
  });

  it('runtime 未就绪时 runManualUpdate 不弹确认框、不调用 orchestrator', async () => {
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await pending;

    // 无确认弹窗、无 orchestrator 调用。
    // runtime 未就绪时选择必为空，先走“未选择”分支提示，而非误报“运行时未就绪”。
    expect(dialog.active).toBeNull();
    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('未选择需要手动填表的表格'))).toBe(true);
    __resetToastStoreForTests();
  });

  it('runtime 未就绪但 selection 被外部篡改（绕过 setter）：提示运行时未就绪并阻断', async () => {
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();

    // 外部直接写 Ref 绕过 setter 隔离：把模板表塞进执行选择
    manual.selectedManualTableKeys.value = ['sheet_tpl'];
    expect(manual.selectedManualTableKeys.value).toEqual(['sheet_tpl']);

    const pending = manual.runManualUpdate();
    await pending;

    // 运行时未就绪分支：快照为空，阻断且不弹确认框
    expect(dialog.active).toBeNull();
    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('运行时未就绪'))).toBe(true);
    __resetToastStoreForTests();
  });

  it('runtime 就绪时保存选择仍正常持久化', async () => {
    const { useManualUpdate, settings, saveSettings_ACU } = await importManualUpdate();
    const manual = useManualUpdate();
    // displayTableData 默认含 sheet_0，hasRuntimeTableData_ACU() 为 true
    expect(manual.runtimeReady.value).toBe(true);
    expect(manual.selectedManualTableKeys.value).toEqual(['sheet_0']);

    saveSettings_ACU.mockClear();
    // 选择 sheet_0 时写回持久化，hasManualSelection 置 true
    manual.setManualSelectedKeys(['sheet_0']);
    expect(manual.selectedManualTableKeys.value).toEqual(['sheet_0']);
    expect(settings.manualSelectedTables).toEqual(['sheet_0']);
    expect(settings.hasManualSelection).toBe(true);
    expect(saveSettings_ACU).toHaveBeenCalledTimes(1);

    saveSettings_ACU.mockClear();
    // 显式全不选：runtime 就绪时允许持久化空数组（用户明确选择不参与任何表）
    manual.selectNoManualTables();
    expect(manual.selectedManualTableKeys.value).toEqual([]);
    expect(settings.manualSelectedTables).toEqual([]);
    expect(settings.hasManualSelection).toBe(true);
    expect(saveSettings_ACU).toHaveBeenCalledTimes(1);
  });

  it('runtime 未就绪时选择模板表不写持久化，且不清除 purge 前既有选择', async () => {
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    const { useManualUpdate, settings, saveSettings_ACU } = await importManualUpdate();
    const manual = useManualUpdate();

    // 展示层可见模板表；执行选择为空；settings  purge 前的既有选择
    expect(manual.sheetKeys.value).toEqual(['sheet_tpl']);
    expect(manual.runtimeReady.value).toBe(false);
    expect(settings.manualSelectedTables).toEqual(['sheet_0']);
    expect(settings.hasManualSelection).toBe(true);

    saveSettings_ACU.mockClear();
    // 尝试选择模板表：因 runtime 未就绪，选择保持为空，且不写 settings、不触发保存
    manual.setManualSelectedKeys(['sheet_tpl']);
    expect(manual.selectedManualTableKeys.value).toEqual([]);
    expect(settings.manualSelectedTables).toEqual(['sheet_0']);
    expect(settings.hasManualSelection).toBe(true);
    expect(saveSettings_ACU).not.toHaveBeenCalled();
  });

  it('runtime 未就绪且用户本无既有选择时，选择模板表不写入空配置', async () => {
    const { useManualUpdate, settings, saveSettings_ACU } = await importManualUpdate();
    // 直接以空配置状态开始：无既有选择、无已确认选择
    settings.manualSelectedTables = [];
    settings.hasManualSelection = false;
    displayTableData = null;
    templateDisplayData = {
      sheet_tpl: { name: '模板表' },
    };
    const manual = useManualUpdate();

    expect(manual.runtimeReady.value).toBe(false);
    saveSettings_ACU.mockClear();
    manual.setManualSelectedKeys(['sheet_tpl']);

    expect(manual.selectedManualTableKeys.value).toEqual([]);
    expect(settings.manualSelectedTables).toEqual([]);
    expect(settings.hasManualSelection).toBe(false);
    expect(saveSettings_ACU).not.toHaveBeenCalled();
  });

  it('确认期间 runtime 被 purge：runManualUpdate 在 orchestrator 前阻断', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    // 用户在确认弹窗停留期间发生 purge：runtime 被清空
    displayTableData = null;
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('确认期间发生变化'))).toBe(true);
    // UI 复检失败分支同样经 finally refresh()：purge 后 selection 被清空，不残留失效目标
    expect(manual.selectedManualTableKeys.value).toEqual([]);
    __resetToastStoreForTests();
  });

  it('确认期间 runtime 表集合变化（新增表）：runManualUpdate 阻断且不静默缩减目标', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    // 确认期间新增 sheet_1：runtime 表集合与确认前快照不一致
    displayTableData = {
      sheet_0: { name: '物品表', content: [['row_id', '名称']] },
      sheet_1: { name: '新增表', content: [['row_id', '名称']] },
    };
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('确认期间发生变化'))).toBe(true);
    __resetToastStoreForTests();
  });

  it('确认期间 runtime 表被删除：runManualUpdate 阻断，不把模板表或过期键交给 orchestrator', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    // 确认期间 sheet_0 被删除，runtime 只剩 sheet_9
    displayTableData = {
      sheet_9: { name: '另一表', content: [['row_id', '名称']] },
    };
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('确认期间发生变化'))).toBe(true);
    __resetToastStoreForTests();
  });

  it('确认期间外部改写 selection ref：orchestrator 仍收到确认前快照', async () => {
    const { useManualUpdate, dialog, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    const manual = useManualUpdate();
    // 建立两个 runtime 表，确认前选择 sheet_0
    displayTableData = {
      sheet_0: { name: '物品表', content: [['row_id', '名称']] },
      sheet_1: { name: '另一表', content: [['row_id', '名称']] },
    };
    manual.setManualSelectedKeys(['sheet_0']);

    const pending = manual.runManualUpdate();
    await waitForCondition(() => dialog.active?.title === '执行手动填表', '确认弹窗出现');
    const confirmMessage = dialog.active?.message || '';
    // 确认期间外部直接改写 selection ref（绕过 setter），把目标换成 sheet_1
    manual.selectedManualTableKeys.value = ['sheet_1'];
    dialog.submitActive();
    await pending;

    expect(orchestrateManualUpdate_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    expect(orchestrateManualUpdate_ACU.mock.calls[0][3].executionSnapshot.sheetKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(confirmMessage).toContain('sheet_0');
    expect(confirmMessage).not.toContain('sheet_1');
    __resetToastStoreForTests();
  });

  it('追平确认期间外部改写 selection ref：orchestrator 仍收到确认前快照', async () => {
    const { useManualUpdate, dialog, prepareManualCatchUpPlan_ACU, orchestrateManualCatchUp_ACU, __resetToastStoreForTests } = await importManualUpdate();
    prepareManualCatchUpPlan_ACU.mockResolvedValue({
      success: true,
      plan: {
        targetAiFloor: 1,
        targetMessageIndex: 0,
        planSignature: 'sig',
        waves: [{
          startAiFloor: 1,
          endAiFloor: 1,
          messageIndices: [0],
          sheetKeys: ['sheet_0'],
          groups: [{ batchSize: 2, messageIndices: [0] }],
        }],
      },
    });
    orchestrateManualCatchUp_ACU.mockResolvedValue({ outcome: 'success', success: true, committedBucketCount: 1 });
    displayTableData = {
      sheet_0: { name: '物品表', content: [['row_id', '名称']] },
      sheet_1: { name: '另一表', content: [['row_id', '名称']] },
    };
    const manual = useManualUpdate();
    manual.setManualSelectedKeys(['sheet_0']);

    const pending = manual.runManualCatchUp();
    await waitForCondition(() => dialog.active?.title === '追平所选表未填楼层', '追平确认弹窗出现');
    const confirmMessage = dialog.active?.message || '';
    manual.selectedManualTableKeys.value = ['sheet_1'];
    dialog.submitActive();
    await pending;

    expect(orchestrateManualCatchUp_ACU).toHaveBeenCalledTimes(1);
    expect(orchestrateManualCatchUp_ACU.mock.calls[0][2].executionSnapshot.sheetKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(orchestrateManualCatchUp_ACU.mock.calls[0][0]).toEqual(['sheet_0']);
    // 追平确认文案用表名展示 wave 目标，确认前为 sheet_0（物品表），确认期间被改写的 sheet_1 不应出现
    expect(confirmMessage).toContain('物品表');
    expect(confirmMessage).not.toContain('另一表');
    __resetToastStoreForTests();
  });

  it('确认弹窗异常 reject 时手动填表 busy 复位且不调用 orchestrator', async () => {
    const { useManualUpdate, dialog, toast, orchestrateManualUpdate_ACU, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();
    orchestrateManualUpdate_ACU.mockResolvedValue({ success: true });
    vi.spyOn(dialog, 'confirm').mockRejectedValue(new Error('dialog store crashed'));

    await manual.runManualUpdate();

    expect(manual.manualUpdateBusy.value).toBe(false);
    expect(orchestrateManualUpdate_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'error' && item.text.includes('dialog store crashed'))).toBe(true);
    // finally 中 refresh() 会把 selection 恢复为当前 runtime 合法集合（sheet_0）
    expect(manual.selectedManualTableKeys.value).toEqual(['sheet_0']);
    __resetToastStoreForTests();
  });

  it('确认弹窗异常 reject 时手动追平 busy 复位且不调用 orchestrator', async () => {
    const { useManualUpdate, dialog, toast, prepareManualCatchUpPlan_ACU, orchestrateManualCatchUp_ACU, __resetToastStoreForTests } = await importManualUpdate();
    prepareManualCatchUpPlan_ACU.mockResolvedValue({
      success: true,
      plan: {
        targetAiFloor: 1,
        targetMessageIndex: 0,
        planSignature: 'sig',
        waves: [{
          startAiFloor: 1,
          endAiFloor: 1,
          messageIndices: [0],
          sheetKeys: ['sheet_0'],
          groups: [{ batchSize: 2, messageIndices: [0] }],
        }],
      },
    });
    const manual = useManualUpdate();
    vi.spyOn(dialog, 'confirm').mockRejectedValue(new Error('dialog store crashed'));

    await manual.runManualCatchUp();

    expect(manual.catchUpBusy.value).toBe(false);
    expect(orchestrateManualCatchUp_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'error' && item.text.includes('dialog store crashed'))).toBe(true);
    // finally 中 refresh() 会把 selection 恢复为当前 runtime 合法集合（sheet_0）
    expect(manual.selectedManualTableKeys.value).toEqual(['sheet_0']);
    __resetToastStoreForTests();
  });
});

  it('空选择时不提示运行时未就绪，而是提示未选择表格', async () => {
    const { useManualUpdate, dialog, toast, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();
    // runtime 就绪但用户未选择任何表
    manual.setManualSelectedKeys([]);
    expect(manual.runtimeReady.value).toBe(true);
    expect(manual.selectedManualTableKeys.value).toEqual([]);

    await manual.runManualUpdate();
    expect(dialog.active).toBeNull();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('未选择需要手动填表的表格'))).toBe(true);
    expect(toast.items.some(item => item.text.includes('运行时未就绪'))).toBe(false);
    __resetToastStoreForTests();
  });

  it('空选择时追平不提示运行时未就绪，而是提示未选择表格', async () => {
    const { useManualUpdate, dialog, toast, __resetToastStoreForTests } = await importManualUpdate();
    const manual = useManualUpdate();
    manual.setManualSelectedKeys([]);
    expect(manual.runtimeReady.value).toBe(true);

    await manual.runManualCatchUp();
    expect(dialog.active).toBeNull();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('未选择需要追平的表格'))).toBe(true);
    expect(toast.items.some(item => item.text.includes('运行时未就绪'))).toBe(false);
    __resetToastStoreForTests();
  });

  it('追平确认期间 runtime 被 purge：不调用 orchestrator，提示重新确认', async () => {
    const { useManualUpdate, dialog, toast, prepareManualCatchUpPlan_ACU, orchestrateManualCatchUp_ACU, __resetToastStoreForTests } = await importManualUpdate();
    // 生成一个非空计划，让流程走到确认弹窗
    prepareManualCatchUpPlan_ACU.mockResolvedValue({
      success: true,
      plan: {
        targetAiFloor: 1,
        targetMessageIndex: 0,
        planSignature: 'sig',
        waves: [{
          startAiFloor: 1,
          endAiFloor: 1,
          messageIndices: [0],
          sheetKeys: ['sheet_0'],
          groups: [{ batchSize: 2, messageIndices: [0] }],
        }],
      },
    });
    orchestrateManualCatchUp_ACU.mockResolvedValue({ outcome: 'success', success: true, committedBucketCount: 1 });
    const manual = useManualUpdate();

    const pending = manual.runManualCatchUp();
    await waitForCondition(() => dialog.active?.title === '追平所选表未填楼层', '追平确认弹窗出现');
    // 用户在确认弹窗停留期间发生 purge
    displayTableData = null;
    dialog.submitActive();
    await pending;

    expect(orchestrateManualCatchUp_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('确认期间发生变化'))).toBe(true);
    __resetToastStoreForTests();
  });

  it('追平确认期间 runtime 表集合变化：不执行，提示重新确认', async () => {
    const { useManualUpdate, dialog, toast, prepareManualCatchUpPlan_ACU, orchestrateManualCatchUp_ACU, __resetToastStoreForTests } = await importManualUpdate();
    prepareManualCatchUpPlan_ACU.mockResolvedValue({
      success: true,
      plan: {
        targetAiFloor: 1,
        targetMessageIndex: 0,
        planSignature: 'sig',
        waves: [{
          startAiFloor: 1,
          endAiFloor: 1,
          messageIndices: [0],
          sheetKeys: ['sheet_0'],
          groups: [{ batchSize: 2, messageIndices: [0] }],
        }],
      },
    });
    orchestrateManualCatchUp_ACU.mockResolvedValue({ outcome: 'success', success: true, committedBucketCount: 1 });
    const manual = useManualUpdate();

    const pending = manual.runManualCatchUp();
    await waitForCondition(() => dialog.active?.title === '追平所选表未填楼层', '追平确认弹窗出现');
    // 确认期间 runtime 表集合变化（sheet_0 被删、新增 sheet_9）
    displayTableData = {
      sheet_9: { name: '另一表', content: [['row_id', '名称']] },
    };
    dialog.submitActive();
    await pending;

    expect(orchestrateManualCatchUp_ACU).not.toHaveBeenCalled();
    expect(toast.items.some(item => item.kind === 'warning' && item.text.includes('确认期间发生变化'))).toBe(true);
    __resetToastStoreForTests();
  });

describe('useManualUpdate 手动追平表更新通知', () => {
  it('正常完成且提交数据时通知表更新一次', async () => {
    const {
      useManualUpdate,
      dialog,
      prepareManualCatchUpPlan_ACU,
      orchestrateManualCatchUp_ACU,
      notifyTableUpdate,
      __resetToastStoreForTests,
    } = await importManualUpdate();
    prepareManualCatchUpPlan_ACU.mockResolvedValue({
      success: true,
      plan: {
        targetAiFloor: 1,
        targetMessageIndex: 0,
        planSignature: 'sig',
        waves: [{
          startAiFloor: 1,
          endAiFloor: 1,
          messageIndices: [0],
          sheetKeys: ['sheet_0'],
          groups: [{ batchSize: 2, messageIndices: [0] }],
        }],
      },
    });
    orchestrateManualCatchUp_ACU.mockResolvedValue({
      outcome: 'complete',
      success: true,
      dataCommitted: true,
      committedBucketCount: 1,
    });
    const manual = useManualUpdate();

    const pending = manual.runManualCatchUp();
    await waitForCondition(() => dialog.active?.title === '追平所选表未填楼层', '追平确认弹窗出现');
    dialog.submitActive();
    await pending;

    expect(orchestrateManualCatchUp_ACU).toHaveBeenCalledTimes(1);
    expect(notifyTableUpdate).toHaveBeenCalledTimes(1);
    __resetToastStoreForTests();
  });
});