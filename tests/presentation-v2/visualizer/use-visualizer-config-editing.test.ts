/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const runtimeMock = vi.hoisted(() => ({
  settings_ACU: {
    apiPresets: [{ name: 'alpha' }, { name: 'beta' }],
    tableApiPresetOverridesByName: {} as Record<string, string>,
  },
}));

const storageModeMock = vi.hoisted(() => ({
  sqliteMode: true,
}));

const saveSettingsMock = vi.hoisted(() => ({
  saveSettings_ACU: vi.fn(() => ({ saved: true, storageType: 'memory' })),
}));

const helperMock = vi.hoisted(() => ({
  applySummaryIndexSequenceToTable_ACU: vi.fn((table: any, colIndex: number) => {
    if (!Array.isArray(table?.content)) return;
    for (let rowIndex = 1; rowIndex < table.content.length; rowIndex += 1) {
      if (Array.isArray(table.content[rowIndex])) {
        table.content[rowIndex][colIndex + 1] = `AM${String(rowIndex).padStart(4, '0')}`;
      }
    }
  }),
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => 0),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => true),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => runtimeMock);
vi.mock('../../../src/service/settings/settings-service', () => saveSettingsMock);
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: () => storageModeMock.sqliteMode,
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => helperMock);
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => ({
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useVisualizerConfigEditing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    runtimeMock.settings_ACU.apiPresets = [{ name: 'alpha' }, { name: 'beta' }];
    runtimeMock.settings_ACU.tableApiPresetOverridesByName = {};
    storageModeMock.sqliteMode = true;
    vi.clearAllMocks();
  });

  async function loadSheet() {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: '背包表',
        orderNo: 0,
        content: [[null, '旧物品', '数量'], [null, '苹果', '2']],
        sourceData: {
          note: '背包',
          ddl: `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT, -- 旧物品
  quantity INTEGER -- 数量
);`,
        },
        updateConfig: {},
        exportConfig: {},
      },
    }, ['sheet_a']);
    return store;
  }

  it('编辑列名会同步 SQLite DDL 注释并标记 dirty', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.updateHeader(0, '物品名');

    expect(store.currentSheet.content[0][1]).toBe('物品名');
    expect(store.currentSheet.sourceData.ddl).toContain('item_name TEXT, -- 物品名');
    expect(store.dirty).toBe(true);
  });

  it('存在显式 DDL 时不受当前存储模式影响，改名仍同步 DDL 注释', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();
    storageModeMock.sqliteMode = false;

    config.updateHeader(0, '物品名');

    expect(store.currentSheet.content[0][1]).toBe('物品名');
    expect(store.currentSheet.sourceData.ddl).toContain('item_name TEXT, -- 物品名');
    expect(store.dirty).toBe(true);
  });

  it('新增列会同步所有数据行', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.addColumn('品质');
    expect(store.currentSheet.content[0]).toEqual([null, '旧物品', '数量', '品质']);
    expect(store.currentSheet.content[1]).toEqual([null, '苹果', '2', null]);
  });

  it('删除 SQLite 业务列时原子同步 DDL、表头和所有数据行', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.deleteColumn(1);
    expect(store.currentSheet.content[0]).toEqual([null, '旧物品']);
    expect(store.currentSheet.content[1]).toEqual([null, '苹果']);
    expect(store.currentSheet.sourceData.ddl).toContain('item_name TEXT -- 旧物品');
    expect(store.currentSheet.sourceData.ddl).not.toContain('quantity INTEGER');
  });

  it('存在显式 DDL 时不受当前存储模式影响，删除仍同步 DDL、表头和数据行', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();
    storageModeMock.sqliteMode = false;

    config.deleteColumn(0);

    expect(store.currentSheet.content[0]).toEqual([null, '数量']);
    expect(store.currentSheet.content[1]).toEqual([null, '2']);
    expect(store.currentSheet.sourceData.ddl).not.toContain('item_name TEXT');
    expect(store.currentSheet.sourceData.ddl).toContain('quantity INTEGER -- 数量');
  });

  it('DDL 已不一致或目标列受约束时拒绝删除且草稿不变', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    store.currentSheet.content[0].push('草稿列');
    const beforeMismatch = JSON.stringify(store.tempData);
    config.deleteColumn(1);

    expect(JSON.stringify(store.tempData)).toBe(beforeMismatch);
    expect(store.currentSheet.content[0]).toEqual([null, '旧物品', '数量', '草稿列']);
    store.currentSheet.content = [[null, '旧物品', '数量'], [null, '苹果', '2']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT, -- 旧物品
  quantity INTEGER UNIQUE -- 数量
);`;
    const beforeUnique = JSON.stringify(store.tempData);

    config.deleteColumn(1);

    expect(JSON.stringify(store.tempData)).toBe(beforeUnique);
  });

  it('全局注入配置作为模板级草稿写入 mate.globalInjectionConfig', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.updateGlobalPlacement('wrapperPlacement', 'order', 90001);

    expect(store.tempData?.mate.globalInjectionConfig.wrapperPlacement.order).toBe(90001);
    expect(store.dirty).toBe(true);
  });

  it('表级 API 预设覆盖写入设置而不标记模板 dirty', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.setTableApiPreset('beta');

    expect(runtimeMock.settings_ACU.tableApiPresetOverridesByName['背包表']).toBe('beta');
    expect(saveSettingsMock.saveSettings_ACU).toHaveBeenCalledTimes(1);
    expect(store.dirty).toBe(false);
  });

  it('冻结状态下拒绝表级 API 预设持久化且不改变设置', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();
    store.setSaving(true);

    expect(() => config.setTableApiPreset('beta')).toThrow('保存正在进行中');
    expect(runtimeMock.settings_ACU.tableApiPresetOverridesByName).toEqual({});
    expect(saveSettingsMock.saveSettings_ACU).not.toHaveBeenCalled();

    store.setSaving(false);
    store.pendingDataOps.committed = { afterData: {}, insertedRowIds: {} };
    expect(() => config.setTableApiPreset('beta')).toThrow('数据已持久化但本地刷新尚未完成');
    expect(runtimeMock.settings_ACU.tableApiPresetOverridesByName).toEqual({});
    expect(saveSettingsMock.saveSettings_ACU).not.toHaveBeenCalled();
  });

  it('编码索引自动编号开关写入锁草稿，开启时立即重排当前表', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        uid: 'sheet_summary',
        name: '总结表',
        orderNo: 0,
        content: [[null, '事件', '编码索引'], [null, '初遇', '手写编号']],
        sourceData: {},
        updateConfig: {},
        exportConfig: {},
      },
    }, ['sheet_summary']);
    store.loadLockDrafts({
      sheet_summary: { rows: [], cols: [], cells: [], specialIndexLocked: false },
    });
    helperMock.getSummaryIndexColumnIndex_ACU.mockReturnValue(1);
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    expect(config.specialIndex.value.locked).toBe(false);

    config.setSpecialIndexLock(true);

    expect(store.tableLockDrafts.sheet_summary.specialIndexLocked).toBe(true);
    expect(store.currentSheet.content[1][2]).toBe('AM0001');
    expect(helperMock.applySummaryIndexSequenceToTable_ACU).toHaveBeenCalledWith(store.currentSheet, 1);
    expect(store.dirty).toBe(true);
  });

  it('冻结状态下拒绝特殊索引锁编辑且不改变锁草稿或表内容', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary: {
        uid: 'sheet_summary',
        name: '总结表',
        orderNo: 0,
        content: [[null, '事件', '编码索引'], [null, '初遇', '手写编号']],
      },
    }, ['sheet_summary']);
    store.loadLockDrafts({
      sheet_summary: { rows: [], cols: [], cells: [], specialIndexLocked: false },
    });
    helperMock.getSummaryIndexColumnIndex_ACU.mockReturnValue(1);
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();
    store.pendingDataOps.committed = { afterData: {}, insertedRowIds: {} };
    const before = JSON.stringify({ content: store.currentSheet.content, locks: store.tableLockDrafts, dirty: store.dirty });

    expect(() => config.setSpecialIndexLock(true)).toThrow('数据已持久化但本地刷新尚未完成');

    expect(JSON.stringify({ content: store.currentSheet.content, locks: store.tableLockDrafts, dirty: store.dirty })).toBe(before);
  });

  it('重命名表自动把旧名累积进 tableAliases 并标记 dirty（S1-5）', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.renameSheet('我的背包表');

    expect(store.tempData.sheet_a.name).toBe('我的背包表');
    expect(store.tempData.sheet_a.sourceData.tableAliases).toEqual(['背包表']);
    expect(store.dirty).toBe(true);
  });

  it('往返改名后别名链只保留非当前名：A→B→A 得到 [B]', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.renameSheet('我的背包表');
    config.renameSheet('背包表');

    expect(store.tempData.sheet_a.name).toBe('背包表');
    // '背包表' 回到当前名（被剔除），'我的背包表' 作为历史名保留。
    expect(store.tempData.sheet_a.sourceData.tableAliases).toEqual(['我的背包表']);
  });

  it('canonical 等价改名（仅空白差异）不写入自指别名', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    config.renameSheet(' 背包表 ');

    expect(store.tempData.sheet_a.sourceData.tableAliases).toBeUndefined();
  });

  it('saving 或 committed 状态下拒绝配置和特殊索引锁编辑且不改变草稿', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();
    const actions = [
      () => config.renameSheet('新表名'),
      () => config.updateHeader(0, '新列名'),
      () => config.addColumn('品质'),
      () => config.deleteColumn(0),
      () => config.updateUpdateConfig('batchSize', 2),
      () => config.updateSourceData('note', '新备注'),
      () => config.updateExportConfig('entryType', 'keyword'),
      () => config.updateGlobalPlacement('wrapperPlacement', 'order', 90001),
    ];
    store.setSaving(true);
    const beforeSaving = JSON.stringify(store.tempData);
    actions.forEach(action => expect(action).toThrow('保存正在进行中'));
    expect(JSON.stringify(store.tempData)).toBe(beforeSaving);

    store.setSaving(false);
    store.pendingDataOps.committed = { afterData: {}, insertedRowIds: {} };
    const beforeCommitted = JSON.stringify(store.tempData);
    actions.forEach(action => expect(action).toThrow('数据已持久化但本地刷新尚未完成'));
    expect(JSON.stringify(store.tempData)).toBe(beforeCommitted);
  });

  it('世界书关键词条目类型沿用旧 service 识别的 keyword 枚举', async () => {
    const store = await loadSheet();
    const { useVisualizerConfigEditing } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerConfigEditing');
    const config = useVisualizerConfigEditing();

    expect(config.entryTypeOptions).toContainEqual({
      value: 'keyword',
      label: '关键词触发条目',
    });

    config.updateExportConfig('entryType', 'keyword');

    expect(store.currentSheet.exportConfig.entryType).toBe('keyword');
    expect(store.dirty).toBe(true);
  });
});
