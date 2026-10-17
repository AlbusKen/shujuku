/**
 * 桌宠动作菜单快捷动作：检测配置、跳转日志/表格编辑器、一键追平（规划 → 内联确认 → 执行）。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`等待条件超时：${label}`);
}

const plan = {
  targetAiFloor: 5,
  targetMessageIndex: 4,
  waves: [{
    startAiFloor: 3,
    endAiFloor: 5,
    messageIndices: [3, 4],
    sheetKeys: ['sheet_0', 'sheet_1'],
    groups: [{
      key: 'group-1',
      groupId: 1,
      batchSize: 2,
      sheetKeys: ['sheet_0', 'sheet_1'],
      requestOptions: null,
      updateMode: 'append',
      executionKind: 'standard' as const,
    }],
  }],
  planSignature: 'signature',
};

let runtimeKeys = ['sheet_0', 'sheet_1'];
let runtimeReady = true;
let prepareResult: any;
let orchestrateResult: any;
let orchestrateGate: Promise<void> | null = null;

async function importQuickActions() {
  vi.resetModules();
  const openAcuV2App = vi.fn(async () => undefined);
  const getAcuV2PiniaForBridge = vi.fn(() => ({}) as any);
  const setActivePage = vi.fn();
  const openVisualizerSurface_ACU = vi.fn(async () => true);
  const refreshMergedDataAndNotify_ACU = vi.fn(async () => undefined);
  const prepareManualCatchUpPlan_ACU = vi.fn(async () => prepareResult);
  const orchestrateManualCatchUp_ACU = vi.fn(async () => {
    if (orchestrateGate) await orchestrateGate;
    return orchestrateResult;
  });
  const getActiveTemplatePresetMeta_ACU = vi.fn(() => ({
    presetName: '默认预设',
    displayName: '默认预设',
    mode: 'global',
    scope: 'global',
    scopeLabel: '全局',
  }));
  const settings: any = { skipUpdateFloors: 0 };
  settings.skipUpdateFloors = 0;

  vi.doMock('../../../src/service/table/update-orchestrator', () => ({
    prepareManualCatchUpPlan_ACU,
    orchestrateManualCatchUp_ACU,
  }));
  vi.doMock('../../../src/service/settings/settings-readers', () => ({
    getCurrentTableDisplayData_ACU: vi.fn(() => ({ sheet_0: {}, sheet_1: {} })),
    hasRuntimeTableData_ACU: vi.fn(() => runtimeReady),
  }));
  vi.doMock('../../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: vi.fn(() => runtimeKeys.slice()),
  }));
  vi.doMock('../../../src/service/worldbook/pipeline', () => ({ refreshMergedDataAndNotify_ACU }));
  vi.doMock('../../../src/service/template/template-preset-service', () => ({ getActiveTemplatePresetMeta_ACU }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: settings }));
  vi.doMock('../../../src/presentation-v2/bootstrap/mount', () => ({ openAcuV2App, getAcuV2PiniaForBridge }));
  vi.doMock('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface', () => ({ openVisualizerSurface_ACU }));
  vi.doMock('../../../src/presentation-v2/stores/router-store', () => ({ useRouterStore: () => ({ setActivePage }) }));
  vi.doMock('../../../src/presentation-v2/stores/api-preset-store', () => ({
    useApiPresetStore: () => ({
      activePresetName: '填表预设',
      currentConfigLabel: '酒馆主 API',
      refreshFromSettings: vi.fn(),
    }),
  }));
  vi.doMock('../../../src/presentation-v2/stores/plot-preset-store', () => ({
    usePlotPresetStore: () => ({
      enabled: true,
      activePresetName: '剧情预设',
      defaultPresetName: '',
      pageApiPresetName: '剧情 API 预设',
      refreshFromSettings: vi.fn(),
    }),
  }));

  const { useDeskPetQuickActions } = await import('../../../src/presentation-v2/composables/useDeskPetQuickActions');
  const { __resetNoticeHubForTests_ACU, getNoticeHubSnapshot_ACU, beginNoticeTask_ACU } = await import('../../../src/shared/notice-hub');
  __resetNoticeHubForTests_ACU();
  const scope = effectScope();
  let actions: ReturnType<typeof useDeskPetQuickActions> | null = null;
  scope.run(() => {
    actions = useDeskPetQuickActions();
  });
  return {
    actions: actions!,
    scope,
    openAcuV2App,
    setActivePage,
    openVisualizerSurface_ACU,
    orchestrateManualCatchUp_ACU,
    getNoticeHubSnapshot_ACU,
    beginNoticeTask_ACU,
  };
}

beforeEach(() => {
  runtimeKeys = ['sheet_0', 'sheet_1'];
  runtimeReady = true;
  orchestrateGate = null;
  prepareResult = { success: true, plan };
  orchestrateResult = { success: true, outcome: 'complete', committedBucketCount: 2, dataCommitted: true };
  vi.resetModules();
});

describe('useDeskPetQuickActions', () => {
  it('检测配置汇总模板、填表 API、剧情预设与剧情 API', async () => {
    const { actions, scope } = await importQuickActions();
    expect(actions.configRows.value.map(row => row.label)).toEqual(['表格模板', '填表 API', '剧情预设', '剧情 API']);
    expect(actions.configRows.value.map(row => row.value)).toEqual([
      '默认预设（全局）',
      '填表预设',
      '剧情预设',
      '剧情 API 预设',
    ]);
    scope.stop();
  });

  it('一键追平先规划并给出内联确认，确认后用同一批表执行并播报结果', async () => {
    const { actions, scope, orchestrateManualCatchUp_ACU, getNoticeHubSnapshot_ACU } = await importQuickActions();

    await actions.requestCatchUp();
    await waitForCondition(() => actions.confirm.value !== null, '追平确认卡');
    expect(actions.confirm.value?.title).toBe('一键追平全表');
    expect(actions.confirm.value?.message).toContain('2 张表');
    expect(actions.confirm.value?.message).toContain('AI 第 3~5 层');

    actions.acceptCatchUp();
    await waitForCondition(() => getNoticeHubSnapshot_ACU().notices.length > 0, '追平结果通知');
    expect(orchestrateManualCatchUp_ACU).toHaveBeenCalledTimes(1);
    const call = orchestrateManualCatchUp_ACU.mock.calls[0] as any[];
    expect(call[0]).toEqual(['sheet_0', 'sheet_1']);
    expect(call[2].executionSnapshot).toEqual({ sheetKeys: ['sheet_0', 'sheet_1'] });
    expect(getNoticeHubSnapshot_ACU().notices[0].text).toContain('共提交 2 个 bucket');
    expect(getNoticeHubSnapshot_ACU().tasks).toHaveLength(0);
    scope.stop();
  });

  it('运行时就绪失败时只提示，不生成确认卡', async () => {
    const { actions, scope, getNoticeHubSnapshot_ACU } = await importQuickActions();
    runtimeReady = false;
    await actions.requestCatchUp();
    expect(actions.confirm.value).toBeNull();
    expect(getNoticeHubSnapshot_ACU().notices[0].text).toContain('运行时未就绪');
    scope.stop();
  });

  it('确认期间运行时表集合变化时 fail-closed 取消执行', async () => {
    const { actions, scope, orchestrateManualCatchUp_ACU, getNoticeHubSnapshot_ACU } = await importQuickActions();
    await actions.requestCatchUp();
    await waitForCondition(() => actions.confirm.value !== null, '追平确认卡');
    runtimeKeys = ['sheet_0'];
    actions.acceptCatchUp();
    await waitForCondition(() => getNoticeHubSnapshot_ACU().notices.length > 0, '取消提示');
    expect(orchestrateManualCatchUp_ACU).not.toHaveBeenCalled();
    expect(getNoticeHubSnapshot_ACU().notices[0].text).toContain('发生变化');
    scope.stop();
  });

  it('执行中被终止时播报保留的已提交 bucket，并恢复空闲状态', async () => {
    let release!: () => void;
    orchestrateGate = new Promise<void>(resolve => { release = resolve; });
    orchestrateResult = { success: false, outcome: 'stopped', committedBucketCount: 1, dataCommitted: false };
    const { actions, scope, getNoticeHubSnapshot_ACU } = await importQuickActions();
    await actions.requestCatchUp();
    await waitForCondition(() => actions.confirm.value !== null, '追平确认卡');
    actions.acceptCatchUp();
    await waitForCondition(() => actions.busy.value && getNoticeHubSnapshot_ACU().tasks.length > 0, '追平任务气泡');
    expect(actions.busy.value).toBe(true);
    release();
    await waitForCondition(() => !actions.busy.value, '追平结束');
    expect(getNoticeHubSnapshot_ACU().notices[0].text).toContain('保留了 1 个已提交 bucket');
    scope.stop();
  });

  it('已有追平任务在别处进行时拒绝重复启动', async () => {
    const { actions, scope, getNoticeHubSnapshot_ACU, beginNoticeTask_ACU } = await importQuickActions();
    const running = beginNoticeTask_ACU('手动追平', { detail: '正在填表…' });
    await actions.requestCatchUp();
    expect(actions.confirm.value).toBeNull();
    expect(getNoticeHubSnapshot_ACU().notices[0].text).toContain('已有追平任务在进行中');
    running.end();
    scope.stop();
  });

  it('打开日志切到高级工具页，打开表格编辑器走可视化入口', async () => {
    const { actions, scope, openAcuV2App, setActivePage, openVisualizerSurface_ACU } = await importQuickActions();
    actions.openLogs();
    await waitForCondition(() => setActivePage.mock.calls.length > 0, '日志页跳转');
    expect(openAcuV2App).toHaveBeenCalled();
    expect(setActivePage).toHaveBeenCalledWith('advanced-tools');

    actions.openVisualizer();
    await waitForCondition(() => openVisualizerSurface_ACU.mock.calls.length > 0, '编辑器入口');
    expect(openVisualizerSurface_ACU).toHaveBeenCalledWith({ source: 'v2-shell' });
    scope.stop();
  });
});
