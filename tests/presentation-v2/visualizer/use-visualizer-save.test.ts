/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const runtimeMock = vi.hoisted(() => {
  let currentData: Record<string, any> = {};
  return {
    get currentJsonTableData_ACU() {
      return currentData;
    },
    getCurrentData: () => currentData,
    resetCurrentData: () => {
      currentData = {};
    },
    _set_currentJsonTableData_ACU: vi.fn((next: Record<string, any>) => {
      currentData = next;
    }),
    getCurrentIsolationKey_ACU: vi.fn(() => 'iso-test'),
    settings_ACU: {},
  };
});

const serviceMock = vi.hoisted(() => ({
  deleteLocalDataInChatCore_ACU: vi.fn(async () => 1),
  getChatArray_ACU: vi.fn(() => [{ mes: 'ai message' }]),
  saveChatToHost_ACU: vi.fn(async () => undefined),
  applySpecialIndexSequenceToSummaryTables_ACU: vi.fn(),
  applySummaryIndexSequenceToTable_ACU: vi.fn(),
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set<number>(), cols: new Set<number>(), cells: new Set<string>() })),
  deleteTableLocksForSheet_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => -1),
  saveTableLocksForSheet_ACU: vi.fn(),
  setSpecialIndexLockEnabled_ACU: vi.fn(),
  getCurrentWorldbookConfig_ACU: vi.fn(() => ({ summaryVectorIndexModeEnabled: false })),

  saveIndependentTableToChatHistory_ACU: vi.fn(async () => undefined),
  replayData: null as Record<string, any> | null,
  ensureLegacyStorageMigratedBeforeWrite_ACU: vi.fn(async () => ({ success: true, migrated: false })),
  runTableWriteTransaction_ACU: vi.fn(async (options: any, task: any) => task({
    runCommit: async (commitTask: any) => commitTask(),
    baseRevision: 'test-revision',
    writeSet: options.writeSet,
    assertFresh: vi.fn(),
  }, JSON.parse(JSON.stringify(options.initialData)))),
  persistTableMutationLogBatchV2_ACU: vi.fn(async (options: any) => {
    serviceMock.replayData = options.afterData;
    return { saved: true, messageIndices: [0] };
  }),
  getLatestV2FullCheckpointMessageIndex_ACU: vi.fn(() => 0),
  getLatestV2SheetReplayMessageIndex_ACU: vi.fn(() => -1),
  runTableUpdateCommit_ACU: vi.fn(async (options: any, apply: any) => {
    const workingData = options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : runtimeMock.getCurrentData();
    const applied = await apply({ transactionContext: { runCommit: async (task: any) => task() }, workingData });
    if (applied.tableData) runtimeMock._set_currentJsonTableData_ACU(applied.tableData);
    return { success: applied.success !== false, value: applied.value, tableData: applied.tableData, saved: true };
  }),
  getLatestAiMessageIndexFromChat_ACU: vi.fn(() => 0),
  getLatestTableAppendMessageIndexFromChat_ACU: vi.fn(() => 0),
  resolveTableHistoryStateFromChat_ACU: vi.fn(() => ({
    latestDataMessageIndex: -1,
    latestAiMessageIndex: 0,
    latestDataAiFloor: 0,
  })),
  isSqliteMode: vi.fn(() => false),
  ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU: vi.fn(async () => ({ success: true, dataWasReset: false })),
  commitCurrentFloorTemplateChanges_ACU: vi.fn(async () => ({ saved: true, mode: 'template_only', messageIndex: 0, checkpoints: [], removedNullRowCount: 0 })),
  commitCurrentFloorTemplateScopeOnly_ACU: vi.fn(async () => ({ saved: true, mode: 'scope_only', messageIndex: 0, checkpoints: [], removedNullRowCount: 0 })),
  demoteTemplateOnlyRootToScopeOnly_ACU: vi.fn(async () => ({
    ok: false,
    demoted: false,
    noReplayRoot: true,
    reason: '当前状态为 pristine_without_checkpoint，不存在需要降级的回放根。',
  })),
  resolveTemplateSwitchMode_ACU: vi.fn(() => ({ mode: 'inherit' })),
  reloadStorageProvider: vi.fn(async () => undefined),
  applyTemplateScopeForCurrentChat_ACU: vi.fn(() => ({ mode: 'chat_override' })),
  buildChatSheetGuideDataFromData_ACU: vi.fn((data: Record<string, any>) => data),
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => ({ templateObj: { mate: { type: 'chatSheets', version: 1 } } })),
  getSortedSheetKeys_ACU: vi.fn((data: Record<string, any>) =>
    Object.keys(data || {}).filter(key => key.startsWith('sheet_')),
  ),
  materializeDataFromSheetGuide_ACU: vi.fn((data: Record<string, any>) => data),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(() => ({ templateStr: '{"mate":{"type":"chatSheets","version":1}}' })),
  setChatSheetGuideDataForIsolationKey_ACU: vi.fn(),
  applyTemplatePresetToCurrent_ACU: vi.fn(async () => true),
  resolveActiveTemplatePresetName_ACU: vi.fn(() => '现有预设'),
  upsertTemplatePreset_ACU: vi.fn(() => true),
  getTemplatePreset_ACU: vi.fn(() => ({ templateStr: '{"mate":{"type":"chatSheets","version":1}}', templateObj: { mate: { type: 'chatSheets', version: 1 } } })),
  getGlobalInjectionConfigFromData_ACU: vi.fn(() => ({})),
  // 贴近真实的规范化实现：缺失字段补默认值。若用 vi.fn(x => x)，
  // 「基线缺字段 + 草稿被补齐默认值」的伪变更哨兵测试将失去意义。
  ensureGlobalInjectionConfigDefaults_ACU: vi.fn((rawConfig: any) => {
    const base = {
      readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
      wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
    };
    const raw = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    const normalize = (value: any, def: any) => {
      const v = (value && typeof value === 'object') ? value : {};
      return {
        position: v.position || def.position,
        depth: v.depth ?? def.depth,
        order: v.order ?? def.order,
      };
    };
    return {
      readableEntryPlacement: normalize(raw.readableEntryPlacement, base.readableEntryPlacement),
      wrapperPlacement: normalize(raw.wrapperPlacement, base.wrapperPlacement),
    };
  }),
  purgeSheetKeysFromChatHistoryHard_ACU: vi.fn(async () => ({ changed: true })),
  refreshMergedDataAndNotify_ACU: vi.fn(async () => undefined),
  updateReadableLorebookEntry_ACU: vi.fn(async () => undefined),
  enqueueSummaryVectorIndexFlush_ACU: vi.fn(async () => undefined),
  deleteCurrentSummaryVectorIndexFromChat_ACU: vi.fn(async () => false),
  preflightSchemaMigrations_ACU: vi.fn(async () => ({ changedSheetKeys: [], blockers: [], operations: [] })),
  captureTableRuntimeRevisionForWriteSet_ACU: vi.fn(() => 'captured-template-revision'),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => runtimeMock);
vi.mock('../../../src/service/chat/chat-service', () => ({
  deleteLocalDataInChatCore_ACU: serviceMock.deleteLocalDataInChatCore_ACU,
  getChatArray_ACU: serviceMock.getChatArray_ACU,
  saveChatToHost_ACU: serviceMock.saveChatToHost_ACU,
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applySpecialIndexSequenceToSummaryTables_ACU: serviceMock.applySpecialIndexSequenceToSummaryTables_ACU,
  applySummaryIndexSequenceToTable_ACU: serviceMock.applySummaryIndexSequenceToTable_ACU,
  getTableLocksForSheet_ACU: serviceMock.getTableLocksForSheet_ACU,
  deleteTableLocksForSheet_ACU: serviceMock.deleteTableLocksForSheet_ACU,
  getSummaryIndexColumnIndex_ACU: serviceMock.getSummaryIndexColumnIndex_ACU,
  saveTableLocksForSheet_ACU: serviceMock.saveTableLocksForSheet_ACU,
  setSpecialIndexLockEnabled_ACU: serviceMock.setSpecialIndexLockEnabled_ACU,
}));
vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: serviceMock.getCurrentWorldbookConfig_ACU,
}));
vi.mock('../../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: serviceMock.saveIndependentTableToChatHistory_ACU,
  ensureLegacyStorageMigratedBeforeWrite_ACU: serviceMock.ensureLegacyStorageMigratedBeforeWrite_ACU,
}));
vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: serviceMock.runTableUpdateCommit_ACU,
}));
vi.mock('../../../src/service/table/table-history', () => ({
  getLatestAiMessageIndexFromChat_ACU: serviceMock.getLatestAiMessageIndexFromChat_ACU,
  getLatestTableAppendMessageIndexFromChat_ACU: serviceMock.getLatestTableAppendMessageIndexFromChat_ACU,
  getLatestV2FullCheckpointMessageIndex_ACU: serviceMock.getLatestV2FullCheckpointMessageIndex_ACU,
  getLatestV2SheetReplayMessageIndex_ACU: serviceMock.getLatestV2SheetReplayMessageIndex_ACU,
  resolveTableHistoryStateFromChat_ACU: serviceMock.resolveTableHistoryStateFromChat_ACU,
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: serviceMock.isSqliteMode,
}));
vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  validateCurrentChatTableRecoveryWithGuide_ACU: serviceMock.validateCurrentChatTableRecoveryWithGuide_ACU || vi.fn(async () => ({ success: true })),
  hasStructuralReplayCompatibilityRepairs_ACU: vi.fn(() => false),
  loadTableStateFromFramesV2Detailed_ACU: vi.fn(async () => {
    // Data-save now uses V2 replay as the write base before persist.
    const data = serviceMock.replayData || runtimeMock.getCurrentData() || {};
    return {
      baseKind: 'full_checkpoint',
      data: JSON.parse(JSON.stringify(data)),
    };
  }),
  loadTableStateFromFramesV2_ACU: vi.fn(async () => {
    const data = serviceMock.replayData || runtimeMock.getCurrentData() || {};
    return JSON.parse(JSON.stringify(data));
  }),
}));
vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  commitCurrentFloorTemplateChanges_ACU: serviceMock.commitCurrentFloorTemplateChanges_ACU,
  commitCurrentFloorTemplateScopeOnly_ACU: serviceMock.commitCurrentFloorTemplateScopeOnly_ACU,
  demoteTemplateOnlyRootToScopeOnly_ACU: serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU,
  persistTableMutationLogBatchV2_ACU: serviceMock.persistTableMutationLogBatchV2_ACU,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: serviceMock.runTableWriteTransaction_ACU,
  captureTableRuntimeRevisionForWriteSet_ACU: serviceMock.captureTableRuntimeRevisionForWriteSet_ACU,
}));
vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: serviceMock.applyTemplateScopeForCurrentChat_ACU,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: serviceMock.reloadStorageProvider,
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatSheetGuideDataFromData_ACU: serviceMock.buildChatSheetGuideDataFromData_ACU,
  getChatSheetGuideDataForIsolationKey_ACU: serviceMock.getChatSheetGuideDataForIsolationKey_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: serviceMock.getGlobalTemplateSnapshotForCurrentProfile_ACU,
  getSortedSheetKeys_ACU: serviceMock.getSortedSheetKeys_ACU,
  materializeDataFromSheetGuide_ACU: serviceMock.materializeDataFromSheetGuide_ACU,
  sanitizeTemplateSnapshotForChat_ACU: serviceMock.sanitizeTemplateSnapshotForChat_ACU,
  setChatSheetGuideDataForIsolationKey_ACU: serviceMock.setChatSheetGuideDataForIsolationKey_ACU,
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  applyTemplatePresetToCurrent_ACU: serviceMock.applyTemplatePresetToCurrent_ACU,
  resolveActiveTemplatePresetName_ACU: serviceMock.resolveActiveTemplatePresetName_ACU,
  upsertTemplatePreset_ACU: serviceMock.upsertTemplatePreset_ACU,
  getTemplatePreset_ACU: serviceMock.getTemplatePreset_ACU,
}));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getGlobalInjectionConfigFromData_ACU: serviceMock.getGlobalInjectionConfigFromData_ACU,
  ensureGlobalInjectionConfigDefaults_ACU: serviceMock.ensureGlobalInjectionConfigDefaults_ACU,
  purgeSheetKeysFromChatHistoryHard_ACU: serviceMock.purgeSheetKeysFromChatHistoryHard_ACU,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: serviceMock.refreshMergedDataAndNotify_ACU,
}));
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({
  enqueueSummaryVectorIndexFlush_ACU: serviceMock.enqueueSummaryVectorIndexFlush_ACU,
}));
vi.mock('../../../src/service/vector/summary-vector-index-chat-service', () => ({
  deleteCurrentSummaryVectorIndexFromChat_ACU: serviceMock.deleteCurrentSummaryVectorIndexFromChat_ACU,
}));
vi.mock('../../../src/service/table/schema-migration-preflight', () => ({
  preflightSchemaMigrations_ACU: serviceMock.preflightSchemaMigrations_ACU,
}));
vi.mock('../../../src/service/table/template-switch-mode-resolver', () => ({
  resolveTemplateSwitchMode_ACU: serviceMock.resolveTemplateSwitchMode_ACU,
}));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => toastMock,
}));

function sheet(name = '角色状态') {
  return {
    uid: 'sheet_test_vz2',
    name,
    orderNo: 0,
    content: [['row_id', '姓名', '状态'], ['1', 'A', '平静']],
    sourceData: {
      ddl: `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  col_1 TEXT, -- 姓名
  col_2 TEXT -- 状态
);`,
    },
  };
}

describe('useVisualizerSave', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    runtimeMock.resetCurrentData();
    vi.clearAllMocks();
    serviceMock.preflightSchemaMigrations_ACU.mockReset();
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValue({ changedSheetKeys: [], blockers: [], operations: [] });
    // once 队列跨用例泄漏会污染后续用例（mockReturnValueOnce/mockRejectedValueOnce
    // 不清除即残留），因此这里重置受影响 mock 并恢复默认实现。
    serviceMock.resolveTemplateSwitchMode_ACU.mockReset();
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValue({ mode: 'inherit' });
    serviceMock.purgeSheetKeysFromChatHistoryHard_ACU.mockReset();
    serviceMock.purgeSheetKeysFromChatHistoryHard_ACU.mockResolvedValue({ changed: true });
    serviceMock.replayData = null;
  });

  it('保存数据到当前消息会提交数据增量并清理 dirty', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();
    store.updateCell(0, 1, '紧张');

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(true);
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledTimes(1);
    expect(runtimeMock.getCurrentData().sheet_test_vz2.content[1][2]).toBe('紧张');
    expect(serviceMock.runTableWriteTransaction_ACU).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual_crud',
      reason: 'visualizer_save_v2_replay',
      writeSet: [expect.objectContaining({ kind: 'cell', sheetKey: 'sheet_test_vz2' })],
    }), expect.any(Function));
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledWith(expect.objectContaining({
      targets: [expect.objectContaining({ changedSheetKeys: ['sheet_test_vz2'] })],
    }));
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('data');
  });

  it('新增行保存时分配 highestNumericId+1 的 row_id，并生成可重放的 row_upsert', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: {
        ...sheet(),
        content: [['row_id', '姓名', '状态'], ['1', 'A', '平静'], ['3', 'B', '紧张']],
      },
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();
    store.addRow();
    store.currentSheet.content[3][1] = 'C';
    store.currentSheet.content[3][2] = '就绪';

    await expect(useVisualizerSave().saveToChat()).resolves.toBe(true);

    expect(runtimeMock.getCurrentData().sheet_test_vz2.content).toEqual([
      ['row_id', '姓名', '状态'], ['1', 'A', '平静'], ['3', 'B', '紧张'], ['4', 'C', '就绪'],
    ]);
  });

  it('保存到全局模板被取消时不写入聊天、不清理 dirty', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('取消测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => false),
    }).saveToGlobal();

    expect(saved).toBe(false);
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(serviceMock.upsertTemplatePreset_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveIndependentTableToChatHistory_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
    expect(store.lastSavedTarget).toBeNull();
  });

  it('保存模板到全局确认后会写入当前可视化草稿，不混入旧全局模板', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    serviceMock.getGlobalTemplateSnapshotForCurrentProfile_ACU.mockReturnValueOnce({
      templateStr: '{"mate":{"type":"chatSheets","version":1},"sheet_old":{"name":"旧表","content":[["row_id"]]}}',
      templateObj: { mate: { type: 'chatSheets', version: 1 }, sheet_old: { name: '旧表', content: [['row_id']] } },
    });
    serviceMock.sanitizeTemplateSnapshotForChat_ACU.mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value),
      templateObj: value,
    }));
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('确认测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => true),
    }).saveToGlobal();

    expect(saved).toBe(true);
    expect(serviceMock.upsertTemplatePreset_ACU).toHaveBeenCalledWith('现有预设', expect.any(String));
    const savedTemplate = JSON.parse(serviceMock.upsertTemplatePreset_ACU.mock.calls[0][1]);
    expect(savedTemplate.sheet_test_vz2.name).toBe('确认测试表');
    expect(savedTemplate.sheet_test_vz2.content).toEqual([['row_id', '姓名', '状态']]);
    expect(savedTemplate.sheet_old).toBeUndefined();
    expect(serviceMock.applyTemplatePresetToCurrent_ACU).toHaveBeenCalledWith('现有预设', expect.objectContaining({
      source: 'visualizer_v2_save_to_global',
      updateGlobal: true,
      save: true,
      persistChatScope: false,
    }));
    expect(serviceMock.runTableUpdateCommit_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
    expect(store.lastSavedTarget).toBe('template-global');
  });

  it('保存到全局：目标预设不存在时视为有变化，必须落库', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('新建预设测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);
    serviceMock.getTemplatePreset_ACU.mockReturnValueOnce(undefined);
    // 默认 sanitize mock 固定返回 {"mate":...}，会丢失表内容；
    // 真实化后才可断言落库内容 = 当前草稿（对比现有用例 L351 的做法）。
    serviceMock.sanitizeTemplateSnapshotForChat_ACU.mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value),
      templateObj: value,
    }));

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => true),
    }).saveToGlobal();

    expect(saved).toBe(true);
    expect(serviceMock.upsertTemplatePreset_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.upsertTemplatePreset_ACU).toHaveBeenCalledWith('现有预设', expect.any(String));
    const savedTemplate = JSON.parse(serviceMock.upsertTemplatePreset_ACU.mock.calls[0][1]);
    expect(savedTemplate.sheet_test_vz2.name).toBe('新建预设测试表');
    expect(store.lastSavedTarget).toBe('template-global');
  });

  it('保存到全局：与目标预设内容一致时标记 unchanged，不落库', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('一致测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);
    // 闭包：源码 L314 先 sanitize 得到 preparedSnapshot，L317 才调 getTemplatePreset_ACU。
    // 让目标预设串 = 当前草稿的真实化串，二者必然相等 → unchanged。
    let presetStr = '';
    serviceMock.sanitizeTemplateSnapshotForChat_ACU.mockImplementationOnce((value: any) => {
      presetStr = JSON.stringify(value);
      return { templateStr: presetStr, templateObj: value };
    });
    serviceMock.getTemplatePreset_ACU.mockImplementationOnce(() => ({ templateStr: presetStr }));

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => true),
    }).saveToGlobal();

    expect(saved).toBe(true);
    expect(serviceMock.upsertTemplatePreset_ACU).not.toHaveBeenCalled();
    expect(store.lastSavedTarget).toBe('template-global');
  });

  it('保存到全局：内容等于全局 profile 串但不同于目标预设时，仍必须落库', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('差异测试表'),
    }, ['sheet_test_vz2']);
    store.setDirty(true);
    serviceMock.getTemplatePreset_ACU.mockReturnValueOnce({
      templateStr: '{"mate":{"type":"chatSheets","version":1},"sheet_test_vz2":{"name":"旧目标预设表","content":[["row_id","姓名","状态"]]}}',
      templateObj: { mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: { name: '旧目标预设表', content: [['row_id', '姓名', '状态']] } },
    });
    serviceMock.sanitizeTemplateSnapshotForChat_ACU.mockImplementationOnce((value: any) => ({
      templateStr: JSON.stringify(value),
      templateObj: value,
    }));
    serviceMock.getGlobalTemplateSnapshotForCurrentProfile_ACU.mockReturnValueOnce({
      templateStr: JSON.stringify({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: { name: '差异测试表', content: [['row_id', '姓名', '状态']] } }),
      templateObj: { mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: { name: '差异测试表', content: [['row_id', '姓名', '状态']] } },
    });

    const saved = await useVisualizerSave({
      confirmOverwriteGlobalPreset: vi.fn(async () => true),
    }).saveToGlobal();

    expect(saved).toBe(true);
    expect(serviceMock.upsertTemplatePreset_ACU).toHaveBeenCalledTimes(1);
    expect(store.lastSavedTarget).toBe('template-global');
  });

  it('保存独立导出位置时用本次草稿同步聊天指导表', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: {
        ...sheet('独立导出表'),
        exportConfig: {
          enabled: true,
          entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        },
      },
    }, ['sheet_test_vz2']);
    store.currentSheet.exportConfig.entryPlacement = {
      position: 'at_depth_as_system',
      depth: 7,
      order: 12345,
    };
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(runtimeMock.getCurrentData().sheet_test_vz2.exportConfig.entryPlacement).toEqual({
      position: 'at_depth_as_system',
      depth: 7,
      order: 12345,
    });
    expect(serviceMock.buildChatSheetGuideDataFromData_ACU).toHaveBeenCalledWith(
      expect.objectContaining({
        sheet_test_vz2: expect.objectContaining({
          exportConfig: expect.objectContaining({
            entryPlacement: { position: 'at_depth_as_system', depth: 7, order: 12345 },
          }),
        }),
      }),
      expect.objectContaining({
        orderedKeys: ['sheet_test_vz2'],
      }),
    );
  });

  it('当前聊天模板原子提交成功后发布一次运行时刷新通知', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const { subscribeTemplateRuntimeChanges_ACU } = await import('../../../src/shared/template-runtime-change');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.setDirty(true);
    const received = vi.fn();
    const unsubscribe = subscribeTemplateRuntimeChanges_ACU(received);

    try {
      await expect(useVisualizerSave().saveTemplateToCurrentChat()).resolves.toBe(true);
      expect(received).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('inherit 模板保存只提交一次核心请求，不触发历史 recovery guard', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: 'iso-test',
      baseRevision: 'captured-template-revision',
      guideData: expect.any(Object),
      syncTemplateScope: true,
      templateSource: expect.objectContaining({
        sheet_test_vz2: expect.objectContaining({ name: '新表名' }),
      }),
      sheetChanges: [expect.objectContaining({
        kind: 'operations',
        sheetKey: 'sheet_test_vz2',
        operations: [expect.objectContaining({
          kind: 'meta_update',
          meta: expect.not.objectContaining({ sourceData: expect.objectContaining({ ddl: expect.anything() }) }),
        })],
      })],
    }));
    expect(serviceMock.captureTableRuntimeRevisionForWriteSet_ACU).toHaveBeenCalledWith(
      [{ kind: 'schema', sheetKey: 'sheet_test_vz2' }],
      { isolationKey: 'iso-test' },
    );
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledWith(expect.objectContaining({
      sheet_test_vz2: expect.objectContaining({ name: '新表名' }),
    }));
    expect(serviceMock.refreshMergedDataAndNotify_ACU).toHaveBeenCalled();
    expect(store.lastSavedTarget).toBe('template-chat');
  });

  it('pristine 无回放根 → 放行并走 scope-only，零 storage frame 写入（助手场景回归哨兵）', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({
      ok: false,
      demoted: false,
      noReplayRoot: true,
      reason: '当前状态为 pristine_without_checkpoint，不存在需要降级的回放根。',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: 'iso-test',
      pristineOverride: true,
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('pristine 有根但清不掉 → 阻止且零提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({
      ok: false,
      demoted: false,
      reason: '检测到含真实数据或后缀 artifact 的 full checkpoint，无法安全移除回放根，拒绝降级，零写入。',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining('模板保存被降级预检阻止'),
      expect.any(Object),
    );
  });

  it('pristine 降级成功 → 继续 scope-only', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({ ok: true, demoted: true });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('pristine + 删表时 purge 失败仅 warning 不回滚（R1）', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除'), uid: 'sheet_delete' },
    }, ['sheet_keep', 'sheet_delete']);
    store.deleteSheet('sheet_delete');
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({
      ok: false,
      demoted: false,
      noReplayRoot: true,
      reason: '当前状态为 pristine_without_checkpoint，不存在需要降级的回放根。',
    });
    serviceMock.purgeSheetKeysFromChatHistoryHard_ACU.mockRejectedValueOnce(new Error('purge failed'));

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalled();
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).toHaveBeenCalledWith(['sheet_delete']);
  });


  it('新增表保存时只将新增表提交给 V2 当前楼层 writer', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('已有表'),
    }, ['sheet_test_vz2']);
    store.addSheet('sheet_new_vz2', { ...sheet('新增表'), uid: 'sheet_new_vz2' });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[{ sheetChanges }]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(sheetChanges).toEqual([expect.objectContaining({
      kind: 'introduction',
      sheetKey: 'sheet_new_vz2',
    })]);
  });

  it('重排已有表时只提交 orderNo 实际变化的表', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_first: { ...sheet('第一张表'), uid: 'sheet_first', orderNo: 0 },
      sheet_second: { ...sheet('第二张表'), uid: 'sheet_second', orderNo: 1 },
      sheet_unchanged: { ...sheet('未变表'), uid: 'sheet_unchanged', orderNo: 2 },
    }, ['sheet_first', 'sheet_second', 'sheet_unchanged']);
    store.moveSheet('sheet_second', 'up');

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[{ sheetChanges }]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(sheetChanges).toHaveLength(2);
    expect(sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'operations', sheetKey: 'sheet_first' }),
      expect.objectContaining({ kind: 'operations', sheetKey: 'sheet_second' }),
    ]));
    expect(sheetChanges.map((change: any) => change.sheetKey)).not.toContain('sheet_unchanged');
  });

  it('新增表并修改旧表时只提交新增表和实际修改的旧表', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_changed: { ...sheet('原名称'), uid: 'sheet_changed', orderNo: 0 },
      sheet_unchanged: { ...sheet('未变表'), uid: 'sheet_unchanged', orderNo: 1 },
    }, ['sheet_changed', 'sheet_unchanged']);
    store.currentSheet.name = '更新后的名称';
    store.addSheet('sheet_new_vz2', { ...sheet('新增表'), uid: 'sheet_new_vz2' });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[{ sheetChanges }]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(sheetChanges).toHaveLength(2);
    expect(sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'operations', sheetKey: 'sheet_changed' }),
      expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_new_vz2' }),
    ]));
    expect(sheetChanges.map((change: any) => change.sheetKey)).not.toContain('sheet_unchanged');
  });

  it('已有 Sheet 同时变更 schema 与 metadata 时按 migration 再 meta_update 下传', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.currentSheet.content = [['row_id', '姓名', '状态', '职业'], ['1', 'A', '平静', null]];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  col_1 TEXT, -- 姓名
  col_2 TEXT, -- 状态
  col_3 TEXT -- 职业
);`;
    const migration = { kind: 'sheet_schema_migrate', contractVersion: 1, sheetKey: 'sheet_test_vz2' };
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'],
      blockers: [],
      operations: [migration],
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[{ sheetChanges }]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(sheetChanges).toHaveLength(1);
    expect(sheetChanges[0]).toMatchObject({
      kind: 'operations',
      sheetKey: 'sheet_test_vz2',
      targetSheetData: expect.objectContaining({ name: '新表名' }),
    });
    expect(sheetChanges[0].operations).toEqual([
      migration,
      expect.objectContaining({
        kind: 'meta_update',
        sheetKey: 'sheet_test_vz2',
        meta: expect.objectContaining({ name: '新表名' }),
      }),
    ]);
    expect(sheetChanges[0].operations[1].meta.sourceData).not.toHaveProperty('ddl');
  });

  it('schema 变更 Sheet 在 preflight 判定为 rebase 时以整表 rebase action 下传，不伪造 migration operation', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名'], ['1', 'A']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  col_1 TEXT -- 姓名
);`;
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'],
      blockers: [],
      issues: [],
      operations: [],
      decisions: [{ sheetKey: 'sheet_test_vz2', status: 'auto_apply', code: 'REBASE_AVAILABLE' }],
      applyModes: { sheet_test_vz2: 'rebase' },
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[{ sheetChanges }]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(sheetChanges).toHaveLength(1);
    expect(sheetChanges[0]).toMatchObject({
      kind: 'rebase',
      sheetKey: 'sheet_test_vz2',
      sheetData: expect.objectContaining({ name: '旧表名' }),
    });
    expect(sheetChanges[0]).not.toHaveProperty('operations');
  });


  it.each([
    ['缺少 operation', { changedSheetKeys: ['sheet_test_vz2'], blockers: [], operations: [] }],
    ['重复 operation', {
      changedSheetKeys: ['sheet_test_vz2'], blockers: [],
      operations: [{ sheetKey: 'sheet_test_vz2' }, { sheetKey: 'sheet_test_vz2' }],
    }],
    ['changedSheetKeys 不一致', {
      changedSheetKeys: ['sheet_other'], blockers: [], operations: [{ sheetKey: 'sheet_test_vz2' }],
    }],
  ])('schema migration preflight %s 时 fail closed', async (_label, preflightResult) => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名', '状态', '职业'], ['1', 'A', '平静', null]];
    store.currentSheet.sourceData.ddl = 'CREATE TABLE sheet_test_vz2 (row_id INTEGER PRIMARY KEY, col_1 TEXT, col_2 TEXT, col_3 TEXT);';
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce(preflightResult as any);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('migration 或 rebase action'), { muteable: false });
  });

  it('schema migration preflight 阻断时不创建 checkpoint 或推进模板状态', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    const baseDataBeforeSave = JSON.parse(JSON.stringify(store.templateBaseData));
    store.currentSheet.content = [['row_id', '姓名', '状态', '职业'], ['1', 'A', '平静', '战士']];
    store.setDirty(true);
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'],
      blockers: ['sheet_test_vz2: 缺少显式 V2 intent'],
      operations: [],
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledWith(expect.objectContaining({
      baselineData: store.templateBaseData,
      candidateData: expect.objectContaining({ sheet_test_vz2: expect.any(Object) }),
    }));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('schema migration preflight'), { muteable: false });
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).not.toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(store.templateBaseData).toEqual(baseDataBeforeSave);
    expect(store.lastSavedTarget).toBeNull();
    expect(store.dirty).toBe(true);
    expect(store.isSaving).toBe(false);
  });

  it('删列保存经确认后以同一候选快照二次预检并仅提交一次', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名'], ['1', 'A']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  col_1 TEXT -- 姓名
);`;
    const destructiveIssue = {
      code: 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED',
      sheetKey: 'sheet_test_vz2',
      tableName: '角色状态',
      droppedColumns: [{ physicalName: 'col_2', displayHeader: '状态', index: 2 }],
      affectedRowCount: 1,
      message: '删除状态需要显式确认。',
    };
    const migration = {
      kind: 'sheet_schema_migrate', contractVersion: 1, sheetKey: 'sheet_test_vz2',
      migrationPolicy: { destructiveChangeConfirmed: true },
    };
    serviceMock.preflightSchemaMigrations_ACU
      .mockResolvedValueOnce({ changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 删除状态需要显式确认。'], issues: [destructiveIssue], operations: [] })
      .mockResolvedValueOnce({ changedSheetKeys: ['sheet_test_vz2'], blockers: [], issues: [], operations: [migration] });
    const confirmDestructiveSchemaChange = vi.fn(async () => true);

    const saved = await useVisualizerSave({ confirmDestructiveSchemaChange }).saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(confirmDestructiveSchemaChange).toHaveBeenCalledWith({
      sheets: [{
        sheetKey: 'sheet_test_vz2', tableName: '角色状态',
        droppedColumns: [{ physicalName: 'col_2', displayHeader: '状态', index: 2 }], affectedRowCount: 1,
      }],
    });
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenNthCalledWith(1, expect.objectContaining({ destructiveChangeConfirmed: false }));
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenNthCalledWith(2, expect.objectContaining({ destructiveChangeConfirmed: true }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
  });

  it('schema migration 需要列身份选择时绑定当前快照二次预检并仅提交一次', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名', '状态'], ['1', 'A', '平静']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  renamed_col TEXT, -- 姓名
  col_2 TEXT -- 状态
);`;
    const selectedIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'col_1', toPhysicalName: 'renamed_col' }],
      fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    const migration = { kind: 'sheet_schema_migrate', contractVersion: 2, sheetKey: 'sheet_test_vz2' };
    serviceMock.preflightSchemaMigrations_ACU
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 需要确认列身份。'], issues: [], operations: [],
        decisions: [{
          sheetKey: 'sheet_test_vz2', status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: '需要确认列身份。',
          choices: [{ id: 'map:col_1->renamed_col', label: '姓名（col_1）→ 姓名（renamed_col）', intent: selectedIntent }],
        }],
      })
      .mockResolvedValueOnce({ changedSheetKeys: ['sheet_test_vz2'], blockers: [], issues: [], operations: [migration], decisions: [] });
    const requestSchemaMigrationChoice = vi.fn(async () => 'map:col_1->renamed_col');

    const saved = await useVisualizerSave({ requestSchemaMigrationChoice }).saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(requestSchemaMigrationChoice).toHaveBeenCalledWith(expect.objectContaining({
      sheetKey: 'sheet_test_vz2',
      choices: [{ id: 'map:col_1->renamed_col', label: expect.stringContaining('renamed_col') }],
    }));
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenNthCalledWith(2, expect.objectContaining({
      intents: { sheet_test_vz2: selectedIntent },
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
  });

  it('列身份选择中选择按当前表结构重建时，以 rebase action 原子提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '品质', '状态'], ['1', 'normal', '平静']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  quality INTEGER, -- 品质
  col_2 TEXT -- 状态
);`;
    serviceMock.preflightSchemaMigrations_ACU
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 需要确认列身份。'], issues: [], operations: [],
        decisions: [{
          sheetKey: 'sheet_test_vz2', status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: '需要确认列身份。',
          choices: [{ id: 'map:col_1->quality', label: '姓名（col_1）→ 品质（quality）', intent: { physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false } } }],
        }],
      })
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2'], blockers: [], issues: [], operations: [], decisions: [],
        applyModes: { sheet_test_vz2: 'rebase' },
      });
    const requestSchemaMigrationChoice = vi.fn(async ({ rebaseChoiceId }: { rebaseChoiceId: string }) => rebaseChoiceId);

    const saved = await useVisualizerSave({ requestSchemaMigrationChoice }).saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(requestSchemaMigrationChoice).toHaveBeenCalledWith(expect.objectContaining({
      sheetKey: 'sheet_test_vz2', rebaseChoiceId: 'rebase:sheet_test_vz2',
    }));
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenNthCalledWith(2, expect.objectContaining({
      rebaseSheetKeys: ['sheet_test_vz2'], intents: {}, destructiveChangeConfirmed: false,
    }));
    const [[{ sheetChanges }]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(sheetChanges).toEqual([expect.objectContaining({ kind: 'rebase', sheetKey: 'sheet_test_vz2' })]);
  });


  it('取消 schema migration 列身份选择时没有提交或后置副作用', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名', '状态'], ['1', 'A', '平静']];
    store.currentSheet.sourceData.ddl = 'CREATE TABLE sheet_test_vz2 (row_id INTEGER PRIMARY KEY, renamed_col TEXT, col_2 TEXT);';
    store.setDirty(true);
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 需要确认列身份。'], issues: [], operations: [],
      decisions: [{
        sheetKey: 'sheet_test_vz2', status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: '需要确认列身份。',
        choices: [{
          id: 'map:col_1->renamed_col', label: '姓名（col_1）→ 姓名（renamed_col）',
          intent: { physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false } },
        }],
      }],
    });

    const saved = await useVisualizerSave({ requestSchemaMigrationChoice: vi.fn(async () => null) }).saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).not.toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
  });

  it('schema migration 选择期间草稿变化时拒绝陈旧 intent', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名', '状态'], ['1', 'A', '平静']];
    store.currentSheet.sourceData.ddl = 'CREATE TABLE sheet_test_vz2 (row_id INTEGER PRIMARY KEY, renamed_col TEXT, col_2 TEXT);';
    store.setDirty(true);
    const selectedIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'col_1', toPhysicalName: 'renamed_col' }],
      fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 需要确认列身份。'], issues: [], operations: [],
      decisions: [{
        sheetKey: 'sheet_test_vz2', status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: '需要确认列身份。',
        choices: [{ id: 'map:col_1->renamed_col', label: '姓名（col_1）→ 姓名（renamed_col）', intent: selectedIntent }],
      }],
    });
    const requestSchemaMigrationChoice = vi.fn(async () => {
      store.currentSheet.name = '选择期间变更';
      return 'map:col_1->renamed_col';
    });

    const saved = await useVisualizerSave({ requestSchemaMigrationChoice }).saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith('模板结构在 schema migration 选择期间已变化；请重新保存。', { muteable: false });
  });

  it('schema migration 选择器返回未知 ID 时 fail-closed 且不提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.sourceData.ddl = 'CREATE TABLE sheet_test_vz2 (row_id INTEGER PRIMARY KEY, renamed_col TEXT, col_2 TEXT);';
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 需要确认列身份。'], issues: [], operations: [],
      decisions: [{
        sheetKey: 'sheet_test_vz2', status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: '需要确认列身份。',
        choices: [{
          id: 'map:col_1->renamed_col', label: '姓名（col_1）→ 姓名（renamed_col）',
          intent: { physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false } },
        }],
      }],
    });

    const saved = await useVisualizerSave({ requestSchemaMigrationChoice: vi.fn(async () => 'unknown-choice') }).saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).not.toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('schema migration 返回了无效选择：sheet_test_vz2。', { muteable: false });
  });

  it('缺少 schema migration 选择 interaction 时保留 blocker 并 fail-closed', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.sourceData.ddl = 'CREATE TABLE sheet_test_vz2 (row_id INTEGER PRIMARY KEY, renamed_col TEXT, col_2 TEXT);';
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 需要确认列身份。'], issues: [], operations: [],
      decisions: [{
        sheetKey: 'sheet_test_vz2', status: 'needs_choice', code: 'AMBIGUOUS_COLUMN_IDENTITY', message: '需要确认列身份。',
        choices: [{
          id: 'map:col_1->renamed_col', label: '姓名（col_1）→ 姓名（renamed_col）',
          intent: { physicalColumnMappings: [], fills: {}, conversions: [], migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false } },
        }],
      }],
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      '模板结构未通过 schema migration preflight：sheet_test_vz2: 需要确认列身份。',
      { muteable: false },
    );
  });

  it('多 Sheet 列身份选择全部绑定后只执行一次二次 preflight', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const secondSheet = {
      ...sheet('第二张表'), uid: 'sheet_second_vz2',
      sourceData: { ddl: 'CREATE TABLE sheet_second_vz2 (row_id INTEGER PRIMARY KEY, col_1 TEXT, col_2 TEXT);' },
    };
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet(), sheet_second_vz2: secondSheet,
    }, ['sheet_test_vz2', 'sheet_second_vz2']);
    store.tempData.sheet_test_vz2.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- row_id
  renamed_one TEXT, -- 姓名
  col_2 TEXT -- 状态
);`;
    store.tempData.sheet_second_vz2.sourceData.ddl = `CREATE TABLE sheet_second_vz2 (
  row_id INTEGER PRIMARY KEY, -- row_id
  renamed_two TEXT, -- 姓名
  col_2 TEXT -- 状态
);`;
    const firstIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'col_1', toPhysicalName: 'renamed_one' }], fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    const secondIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'col_1', toPhysicalName: 'renamed_two' }], fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    serviceMock.preflightSchemaMigrations_ACU
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2', 'sheet_second_vz2'], blockers: ['first', 'second'], issues: [], operations: [],
        decisions: [
          { sheetKey: 'sheet_test_vz2', status: 'needs_choice', message: 'first', choices: [{ id: 'first', label: 'first', intent: firstIntent }] },
          { sheetKey: 'sheet_second_vz2', status: 'needs_choice', message: 'second', choices: [{ id: 'second', label: 'second', intent: secondIntent }] },
        ],
      })
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2', 'sheet_second_vz2'], blockers: [], issues: [], decisions: [],
        operations: [
          { kind: 'sheet_schema_migrate', sheetKey: 'sheet_test_vz2' },
          { kind: 'sheet_schema_migrate', sheetKey: 'sheet_second_vz2' },
        ],
      });
    const requestSchemaMigrationChoice = vi.fn(async ({ sheetKey }: { sheetKey: string }) => (
      sheetKey === 'sheet_test_vz2' ? 'first' : 'second'
    ));

    const saved = await useVisualizerSave({ requestSchemaMigrationChoice }).saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(requestSchemaMigrationChoice).toHaveBeenCalledTimes(2);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(2);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenNthCalledWith(2, expect.objectContaining({
      intents: { sheet_test_vz2: firstIntent, sheet_second_vz2: secondIntent },
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
  });

  it('列身份选择后二次 preflight 仍要求删列确认时保留 intent 到确认预检', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名'], ['1', 'A']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- row_id
  renamed_col TEXT -- 姓名
);`;
    const selectedIntent = {
      physicalColumnMappings: [{ fromPhysicalName: 'col_1', toPhysicalName: 'renamed_col' }], fills: {}, conversions: [],
      migrationPolicy: { destructiveChangeConfirmed: false, lossyConversionConfirmed: false },
    };
    const destructiveIssue = {
      code: 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED', sheetKey: 'sheet_test_vz2', tableName: '角色状态',
      droppedColumns: [{ physicalName: 'col_2', displayHeader: '状态', index: 2 }], affectedRowCount: 1, message: '删除状态需要显式确认。',
    };
    serviceMock.preflightSchemaMigrations_ACU
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2'], blockers: ['choice'], issues: [], operations: [],
        decisions: [{ sheetKey: 'sheet_test_vz2', status: 'needs_choice', message: 'choice', choices: [{ id: 'mapping', label: 'mapping', intent: selectedIntent }] }],
      })
      .mockResolvedValueOnce({ changedSheetKeys: ['sheet_test_vz2'], blockers: ['drop'], issues: [destructiveIssue], operations: [], decisions: [] })
      .mockResolvedValueOnce({
        changedSheetKeys: ['sheet_test_vz2'], blockers: [], issues: [], decisions: [],
        operations: [{ kind: 'sheet_schema_migrate', contractVersion: 2, sheetKey: 'sheet_test_vz2' }],
      });

    const saved = await useVisualizerSave({
      requestSchemaMigrationChoice: vi.fn(async () => 'mapping'),
      confirmDestructiveSchemaChange: vi.fn(async () => true),
    }).saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(3);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenNthCalledWith(3, expect.objectContaining({
      intents: { sheet_test_vz2: selectedIntent }, destructiveChangeConfirmed: true,
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
  });

  it('取消删列保存确认时没有提交或后置副作用', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名'], ['1', 'A']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  col_1 TEXT -- 姓名
);`;
    store.setDirty(true);
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'],
      blockers: ['sheet_test_vz2: 删除状态需要显式确认。'],
      issues: [{
        code: 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED', sheetKey: 'sheet_test_vz2', tableName: '角色状态',
        droppedColumns: [{ physicalName: 'col_2', displayHeader: '状态', index: 2 }], affectedRowCount: 1, message: '删除状态需要显式确认。',
      }],
      operations: [],
    });

    const saved = await useVisualizerSave({ confirmDestructiveSchemaChange: vi.fn(async () => false) }).saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).not.toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
  });

  it('危险确认期间草稿变化时拒绝陈旧提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名'], ['1', 'A']];
    store.currentSheet.sourceData.ddl = `CREATE TABLE sheet_test_vz2 (
  row_id INTEGER PRIMARY KEY, -- 行号
  col_1 TEXT -- 姓名
);`;
    store.setDirty(true);
    serviceMock.preflightSchemaMigrations_ACU.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_test_vz2'], blockers: ['sheet_test_vz2: 删除状态需要显式确认。'], operations: [],
      issues: [{ code: 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED', sheetKey: 'sheet_test_vz2', tableName: '角色状态', droppedColumns: [{ physicalName: 'col_2', displayHeader: '状态', index: 2 }], affectedRowCount: 1, message: '删除状态需要显式确认。' }],
    });
    const confirmDestructiveSchemaChange = vi.fn(async () => {
      store.currentSheet.name = '确认期间变更';
      return true;
    });

    const saved = await useVisualizerSave({ confirmDestructiveSchemaChange }).saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.preflightSchemaMigrations_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith('模板结构在危险确认期间已变化；请重新保存。', { muteable: false });
  });

  it('schema migration preflight 期间模板变化时不提交陈旧 checkpoint', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.content = [['row_id', '姓名', '状态', '职业'], ['1', 'A', '平静', '战士']];
    store.setDirty(true);
    let resolvePreflight: (value: { changedSheetKeys: string[]; blockers: string[]; operations: any[] }) => void;
    serviceMock.preflightSchemaMigrations_ACU.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreflight = resolve;
    }));

    const saving = useVisualizerSave().saveTemplateToCurrentChat();
    store.currentSheet.name = 'preflight 期间的新表名';
    store.setDirty(true);
    resolvePreflight!({ changedSheetKeys: ['sheet_test_vz2'], blockers: [], operations: [{ sheetKey: 'sheet_test_vz2' }] });

    await expect(saving).resolves.toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).not.toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(store.currentSheet.name).toBe('preflight 期间的新表名');
    expect(store.templateBaseData.sheet_test_vz2.name).toBe('旧表名');
    expect(store.lastSavedTarget).toBeNull();
    expect(store.dirty).toBe(true);
    expect(store.isSaving).toBe(false);
    expect(toastMock.warning).toHaveBeenCalledWith('模板结构在 schema migration preflight 期间已变化；请重新保存。', { muteable: false });
  });

  it('当前聊天模板原子提交失败时不推进运行时、基线、scope 或锁草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    const baseDataBeforeSave = JSON.parse(JSON.stringify(store.templateBaseData));
    const baseOrderBeforeSave = [...store.templateBaseSheetOrder];
    store.currentSheet.name = '未提交的新表名';
    store.queueLockChanges([
      {
        sheetKey: 'sheet_test_vz2',
        rows: [{ rowIndex: 0, locked: true }],
        columns: [],
        cells: [],
        specialIndexLocked: false,
      },
    ]);
    serviceMock.commitCurrentFloorTemplateChanges_ACU.mockResolvedValueOnce({
      saved: false,
      error: '提交被业务层拒绝',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith('提交被业务层拒绝', { muteable: false });
    expect(runtimeMock._set_currentJsonTableData_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveTableLocksForSheet_ACU).not.toHaveBeenCalled();
    expect(serviceMock.setSpecialIndexLockEnabled_ACU).not.toHaveBeenCalled();
    expect(serviceMock.isSqliteMode).not.toHaveBeenCalled();
    expect(serviceMock.reloadStorageProvider).not.toHaveBeenCalled();
    expect(serviceMock.refreshMergedDataAndNotify_ACU).not.toHaveBeenCalled();
    expect(store.templateBaseData).toEqual(baseDataBeforeSave);
    expect(store.templateBaseSheetOrder).toEqual(baseOrderBeforeSave);
    expect(store.pendingLockChanges).toHaveLength(1);
    expect(store.lastSavedTarget).toBeNull();
    expect(store.dirty).toBe(true);
    expect(store.isSaving).toBe(false);
  });

  it('SQLite 运行时刷新失败不会回滚成功的模板提交或重复提交 checkpoint', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '已提交的新表名';
    store.setDirty(true);
    serviceMock.isSqliteMode.mockReturnValueOnce(true);
    serviceMock.reloadStorageProvider.mockRejectedValueOnce(new Error('reload failed'));

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.reloadStorageProvider).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalledWith(
      '模板已保存，但 SQLite 运行时刷新失败；请重新载入当前聊天后重试。',
      { muteable: false },
    );
    expect(serviceMock.applyTemplateScopeForCurrentChat_ACU).toHaveBeenCalledTimes(1);
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledWith(expect.objectContaining({
      sheet_test_vz2: expect.objectContaining({ name: '已提交的新表名' }),
    }));
    expect(serviceMock.refreshMergedDataAndNotify_ACU).toHaveBeenCalledTimes(1);
    expect(store.templateBaseData.sheet_test_vz2.name).toBe('已提交的新表名');
    expect(store.lastSavedTarget).toBe('template-chat');
    expect(store.dirty).toBe(false);
    expect(store.isSaving).toBe(false);
  });

  it('合并数据刷新失败不会把成功的模板提交伪装为保存失败', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '已提交但刷新失败的新表名';
    store.setDirty(true);
    serviceMock.refreshMergedDataAndNotify_ACU.mockRejectedValueOnce(new Error('merged refresh failed'));

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalledWith(
      '模板已保存，但合并数据刷新失败；请重新载入当前聊天后重试。',
      { muteable: false },
    );
    expect(store.templateBaseData.sheet_test_vz2.name).toBe('已提交但刷新失败的新表名');
    expect(store.lastSavedTarget).toBe('template-chat');
    expect(store.dirty).toBe(false);
    expect(store.isSaving).toBe(false);
  });

  it('模板作用域运行时同步失败不会回滚成功的模板提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '已提交但 scope 同步失败的新表名';
    store.setDirty(true);
    serviceMock.applyTemplateScopeForCurrentChat_ACU.mockImplementationOnce(() => {
      throw new Error('scope sync failed');
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalledWith(
      '模板已保存，但模板作用域运行时同步失败；请重新载入当前聊天后重试。',
      { muteable: false },
    );
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledWith(expect.objectContaining({
      sheet_test_vz2: expect.objectContaining({ name: '已提交但 scope 同步失败的新表名' }),
    }));
    expect(store.templateBaseData.sheet_test_vz2.name).toBe('已提交但 scope 同步失败的新表名');
    expect(store.lastSavedTarget).toBe('template-chat');
    expect(store.dirty).toBe(false);
    expect(store.isSaving).toBe(false);
  });

  it('保存时提交 AI 助手暂存的锁变化并在成功后清空队列', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    }, ['sheet_test_vz2']);
    store.queueLockChanges([
      {
        sheetKey: 'sheet_test_vz2',
        rows: [{ rowIndex: 0, locked: true }],
        columns: [{ colIndex: 1, locked: true }],
        cells: [{ rowIndex: 0, colIndex: 1, locked: false }],
        specialIndexLocked: false,
      },
    ]);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.saveTableLocksForSheet_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.saveTableLocksForSheet_ACU).toHaveBeenCalledWith(
      'sheet_test_vz2',
      expect.objectContaining({
        rows: expect.any(Set),
        cols: expect.any(Set),
        cells: expect.any(Set),
      }),
      expect.anything(),
    );
    expect(serviceMock.setSpecialIndexLockEnabled_ACU).toHaveBeenCalledWith('sheet_test_vz2', false);
    expect(store.pendingLockChanges).toEqual([]);
  });

  it('运行时数据同步失败时仍保存锁草稿并完成模板提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '运行时同步失败的新表名';
    store.queueLockChanges([
      {
        sheetKey: 'sheet_test_vz2',
        rows: [{ rowIndex: 0, locked: true }],
        columns: [],
        cells: [],
        specialIndexLocked: false,
      },
    ]);
    runtimeMock._set_currentJsonTableData_ACU.mockImplementationOnce(() => {
      throw new Error('runtime sync failed');
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.saveTableLocksForSheet_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalledWith(
      '模板已保存，但运行时数据同步失败；请重新载入当前聊天后重试。',
      { muteable: false },
    );
    expect(store.pendingLockChanges).toEqual([]);
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('template-chat');
  });

  it('锁草稿保存失败时保留手动锁改动并在重试时不重复提交 checkpoint', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet('旧表名'),
    }, ['sheet_test_vz2']);
    store.currentSheet.name = '锁保存失败的新表名';
    store.toggleRowLock('sheet_test_vz2', 0);
    serviceMock.saveTableLocksForSheet_ACU.mockImplementationOnce(() => {
      throw new Error('lock save failed');
    });

    const firstSaved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(firstSaved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).toHaveBeenCalledWith(
      '模板已保存，但表格锁定设置未保存；请重试保存。',
      { muteable: false },
    );
    expect(store.templateBaseData.sheet_test_vz2.name).toBe('锁保存失败的新表名');
    expect(store.pendingLockChanges).toEqual([]);
    expect(store.lockDirty).toBe(true);
    expect(store.isRowLocked('sheet_test_vz2', 0)).toBe(true);
    expect(store.dirty).toBe(true);
    expect(store.lastSavedTarget).toBe('template-chat');

    const retrySaved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(retrySaved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.saveTableLocksForSheet_ACU).toHaveBeenCalledTimes(2);
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it('当前聊天模板仅删表时将删除意图交给原子模板提交，且不走独立 hard purge', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep', orderNo: 0 },
      sheet_mid: { ...sheet('中间表'), uid: 'sheet_mid', orderNo: 1 },
      sheet_tail: { ...sheet('尾表'), uid: 'sheet_tail', orderNo: 2 },
    }, ['sheet_keep', 'sheet_mid', 'sheet_tail']);
    store.tableLockDrafts.sheet_mid = { rows: [0], cols: [], cells: [], specialIndexLocked: true };
    store.deleteSheet('sheet_mid');

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    const [[options]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(options.deletedSheetKeys).toEqual(['sheet_mid']);
    expect(options.sheetChanges).toEqual([]);
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).not.toHaveBeenCalled();
    expect(serviceMock.applySummaryIndexSequenceToTable_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveTableLocksForSheet_ACU).not.toHaveBeenCalledWith('sheet_mid', expect.anything());
    expect(store.tableLockDrafts.sheet_mid).toBeUndefined();
    expect(store.tempData?.sheet_keep.orderNo).toBe(0);
    expect(store.tempData?.sheet_tail.orderNo).toBe(2);
    expect(store.deletedSheetKeys).toEqual([]);
    expect(store.lastSavedTarget).toBe('template-chat');
  });

  it('模板保存路径不因删表空洞对存活表生成 orderNo meta_update，也不重写摘要索引', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { ...sheet('保留表A'), uid: 'sheet_a', orderNo: 0 },
      sheet_b: { ...sheet('总结表'), uid: 'sheet_b', orderNo: 1, content: [['row_id', '事件', '编码索引'], ['1', '旧值', 'AM0001']] },
      sheet_c: { ...sheet('保留表C'), uid: 'sheet_c', orderNo: 2 },
    }, ['sheet_a', 'sheet_b', 'sheet_c']);
    store.tableLockDrafts.sheet_b = { rows: [], cols: [], cells: [], specialIndexLocked: true };
    store.deleteSheet('sheet_b');

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[options]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(options.deletedSheetKeys).toEqual(['sheet_b']);
    expect(options.sheetChanges).toEqual([]);
    expect(serviceMock.applySummaryIndexSequenceToTable_ACU).not.toHaveBeenCalled();
    expect(store.tempData?.sheet_a.orderNo).toBe(0);
    expect(store.tempData?.sheet_c.orderNo).toBe(2);
  });

  it('删除最后一张摘要表后清除当前聊天摘要向量索引，而不保留陈旧索引', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_summary: { ...sheet('总结表'), uid: 'sheet_summary' },
    }, ['sheet_keep', 'sheet_summary']);
    serviceMock.getCurrentWorldbookConfig_ACU.mockReturnValueOnce({ summaryVectorIndexModeEnabled: true });
    store.deleteSheet('sheet_summary');

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({
      deletedSheetKeys: ['sheet_summary'],
      sheetChanges: [],
    }));
    expect(serviceMock.deleteCurrentSummaryVectorIndexFromChat_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.enqueueSummaryVectorIndexFlush_ACU).not.toHaveBeenCalled();
    expect(store.deletedSheetKeys).toEqual([]);
    expect(store.lastSavedTarget).toBe('template-chat');
  });


  it('删除摘要表但仍保留摘要表时同步索引而不删除当前聊天索引', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_summary_keep: { ...sheet('总体大纲'), uid: 'sheet_summary_keep' },
      sheet_summary_delete: { ...sheet('总结表'), uid: 'sheet_summary_delete' },
    }, ['sheet_keep', 'sheet_summary_keep', 'sheet_summary_delete']);
    serviceMock.getCurrentWorldbookConfig_ACU.mockReturnValueOnce({ summaryVectorIndexModeEnabled: true });
    store.deleteSheet('sheet_summary_delete');

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[options]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(options.deletedSheetKeys).toEqual(['sheet_summary_delete']);
    expect(options.templateSource.sheet_keep).toBeDefined();
    expect(options.templateSource.sheet_summary_keep).toBeDefined();
    expect(options.templateSource.sheet_summary_delete).toBeUndefined();
    expect(options.guideData.sheet_summary_keep).toBeDefined();
    expect(serviceMock.enqueueSummaryVectorIndexFlush_ACU).toHaveBeenCalledWith({
      mode: 'sync',
      reason: 'visualizer_v2_template_sheet_delete',
    });
    expect(serviceMock.deleteCurrentSummaryVectorIndexFromChat_ACU).not.toHaveBeenCalled();
  });


  it('删表与 metadata 变更一起保存时只将存活表生成 sheetChanges', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除表'), uid: 'sheet_delete' },
    }, ['sheet_keep', 'sheet_delete']);
    store.currentSheet.name = '保留表更新';
    store.deleteSheet('sheet_delete');

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    const [[options]] = serviceMock.commitCurrentFloorTemplateChanges_ACU.mock.calls;
    expect(options.deletedSheetKeys).toEqual(['sheet_delete']);
    expect(options.sheetChanges).toEqual([expect.objectContaining({ kind: 'operations', sheetKey: 'sheet_keep' })]);
    expect(options.sheetChanges.map((change: any) => change.sheetKey)).not.toContain('sheet_delete');
  });

  it('模板删表原子提交失败时保留删除状态、基线和锁草稿供重试', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除表'), uid: 'sheet_delete' },
    };
    store.loadSnapshot(initialData, ['sheet_keep', 'sheet_delete']);
    store.tableLockDrafts.sheet_delete = { rows: [0], cols: [], cells: [], specialIndexLocked: true };
    const baseDataBeforeSave = JSON.parse(JSON.stringify(store.templateBaseData));
    store.deleteSheet('sheet_delete');
    serviceMock.commitCurrentFloorTemplateChanges_ACU.mockResolvedValueOnce({ saved: false, error: '原子删除失败' });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({ deletedSheetKeys: ['sheet_delete'], sheetChanges: [] }));
    expect(store.deletedSheetKeys).toEqual(['sheet_delete']);
    expect(store.templateBaseData).toEqual(baseDataBeforeSave);
    expect(store.tableLockDrafts.sheet_delete).toEqual({ rows: [0], cols: [], cells: [], specialIndexLocked: true });
    expect(store.dirty).toBe(true);
    expect(toastMock.error).toHaveBeenCalledWith('原子删除失败', { muteable: false });
  });


  it('行数据增量与整表删除同时存在时拒绝混合提交并保留草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除表'), uid: 'sheet_delete' },
    };
    store.loadSnapshot(initialData, ['sheet_keep', 'sheet_delete']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();

    store.deleteSheet('sheet_delete');
    store.updateCell(0, 1, '保留表更新');

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(
      '行数据增量与整表删除无法原子提交；请分别保存行数据和删表操作。',
      { muteable: false },
    );
    expect(serviceMock.runTableWriteTransaction_ACU).not.toHaveBeenCalled();
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).not.toHaveBeenCalled();
    expect(store.deletedSheetKeys).toEqual(['sheet_delete']);
    expect(store.dirty).toBe(true);
  });

  it('只删除整张表且没有行级增量时仍会执行硬删除清理', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_keep: { ...sheet('保留表'), uid: 'sheet_keep' },
      sheet_delete: { ...sheet('删除表'), uid: 'sheet_delete' },
    };
    store.loadSnapshot(initialData, ['sheet_keep', 'sheet_delete']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();

    store.deleteSheet('sheet_delete');

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(true);
    expect(serviceMock.runTableUpdateCommit_ACU).not.toHaveBeenCalled();
    expect(serviceMock.purgeSheetKeysFromChatHistoryHard_ACU).toHaveBeenCalledWith(['sheet_delete']);
    expect(serviceMock.refreshMergedDataAndNotify_ACU).toHaveBeenCalled();
    expect(store.deletedSheetKeys).toEqual([]);
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('data');
  });

it('仅修改表格锁时保存锁草稿，不创建 V2 行级 operation log', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    }, ['sheet_test_vz2']);
    store.loadLockDrafts({
      sheet_test_vz2: { rows: [], cols: [], cells: [], specialIndexLocked: true },
    });
    store.toggleRowLock('sheet_test_vz2', 0);

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(true);
    expect(serviceMock.runTableWriteTransaction_ACU).not.toHaveBeenCalled();
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveTableLocksForSheet_ACU).toHaveBeenCalledWith('sheet_test_vz2', expect.objectContaining({
      rows: new Set([0]),
    }), expect.anything());
    expect(store.lockDirty).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.lastSavedTarget).toBe('data');
  });

it('已载入但未修改的锁草稿不会触发数据保存', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    }, ['sheet_test_vz2']);
    store.loadLockDrafts({
      sheet_test_vz2: { rows: [0], cols: [], cells: [], specialIndexLocked: true },
    });

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(false);
    expect(serviceMock.runTableWriteTransaction_ACU).not.toHaveBeenCalled();
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveTableLocksForSheet_ACU).not.toHaveBeenCalled();
  });

it('运行时 merged refresh 失败后重试只刷新，不重复持久化数据增量', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();
    store.updateCell(0, 1, '紧张');
    serviceMock.refreshMergedDataAndNotify_ACU.mockRejectedValueOnce(new Error('merged refresh failed'));

    const first = await useVisualizerSave().saveToChat();

    expect(first).toBe(false);
    expect(store.pendingDataOps.committed).toEqual(expect.objectContaining({ afterData: expect.any(Object) }));
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.runTableWriteTransaction_ACU).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith(
      '数据已持久化，但本地运行时刷新失败：merged refresh failed',
      { muteable: false },
    );
    expect(store.dirty).toBe(true);

    const second = await useVisualizerSave().saveToChat();

    expect(second).toBe(true);
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.runTableWriteTransaction_ACU).toHaveBeenCalledTimes(1);
    expect(store.pendingDataOps.committed).toBeUndefined();
    expect(store.dirty).toBe(false);
  });

it('成功保存后回填临时行 ID，refresh 失败时不提前回填', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const initialData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(initialData, ['sheet_test_vz2']);
    runtimeMock._set_currentJsonTableData_ACU(JSON.parse(JSON.stringify(initialData)));
    runtimeMock._set_currentJsonTableData_ACU.mockClear();
    store.addRow();
    const temporaryRowId = String(store.currentSheet.content[2][0]);
    serviceMock.refreshMergedDataAndNotify_ACU.mockRejectedValueOnce(new Error('merged refresh failed'));

    const first = await useVisualizerSave().saveToChat();

    expect(first).toBe(false);
    expect(store.currentSheet.content[2][0]).toBe(temporaryRowId);
    expect(store.pendingDataOps.committed).toEqual(expect.objectContaining({
      insertedRowIds: { [temporaryRowId]: '2' },
    }));

    const second = await useVisualizerSave().saveToChat();

    expect(second).toBe(true);
    expect(store.currentSheet.content[2][0]).toBe('2');
    expect(store.pendingDataOps.committed).toBeUndefined();
  });

  it('仅修改全局注入配置时以 scope-only 提交，不调用结构提交（inherit 模式）', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: 'iso-test',
      pristineOverride: false,
      reason: 'visualizer_v2_template_mate_only',
      templateSource: expect.objectContaining({
        mate: expect.objectContaining({
          globalInjectionConfig: expect.objectContaining({
            readableEntryPlacement: expect.objectContaining({ depth: 7 }),
          }),
        }),
      }),
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(runtimeMock._set_currentJsonTableData_ACU).toHaveBeenCalledWith(expect.objectContaining({
      mate: expect.objectContaining({
        globalInjectionConfig: expect.objectContaining({
          readableEntryPlacement: expect.objectContaining({ depth: 7 }),
        }),
      }),
    }));
    expect(store.lastSavedTarget).toBe('template-chat');
    expect(store.dirty).toBe(false);
  });

  it('仅修改全局注入配置时保存成功后推进基线，再次保存提示无变化', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);

    const first = await useVisualizerSave().saveTemplateToCurrentChat();
    expect(first).toBe(true);
    expect(store.templateBaseData.mate.globalInjectionConfig.readableEntryPlacement.depth).toBe(7);

    const second = await useVisualizerSave().saveTemplateToCurrentChat();
    expect(second).toBe(false);
    expect(toastMock.info).toHaveBeenCalledWith('模板结构没有变化。', { muteable: false });
  });

  it('全局注入配置 + 锁同时变更时一次提交并保存锁草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);
    store.toggleRowLock('sheet_test_vz2', 1);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(serviceMock.saveTableLocksForSheet_ACU).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('全局注入配置与表格锁定设置已保存到当前聊天。', { muteable: false });
  });

  it('pristine 会话下仅修改全局注入配置仍先执行降级预检（noReplayRoot 放行）', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({
      ok: false, demoted: false, noReplayRoot: true, reason: 'pristine，无回放根。',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU).toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      // mate-only 不得绕过 Sheet 投影校验（计划 :77 / 风险 R2）。
      pristineOverride: false,
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('pristine 会话下降级预检失败时零提交并报错', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({
      ok: false, demoted: false, reason: '检测到含真实数据的 full checkpoint，拒绝降级，零写入。',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('模板保存被降级预检阻止'), expect.any(Object));
  });

  it('pristine 会话下仅修改全局注入配置但 Sheet 投影不一致时零落盘并给出先保存数据指引', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'pristine' });
    serviceMock.demoteTemplateOnlyRootToScopeOnly_ACU.mockResolvedValueOnce({
      ok: true, demoted: true,
    });
    serviceMock.commitCurrentFloorTemplateScopeOnly_ACU.mockResolvedValueOnce({
      saved: false,
      error: 'scope-only 模板提交要求 baseline 与 candidate 的持久化 Sheet 投影完全一致。',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).toHaveBeenCalledWith(expect.objectContaining({
      pristineOverride: false,
    }));
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining('存在未提交的表内容差异，请先保存数据到当前消息，再保存全局配置。'),
      { muteable: false },
    );
  });

  it('blocked 会话下仅修改全局注入配置零提交并报错', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);
    serviceMock.resolveTemplateSwitchMode_ACU.mockReturnValueOnce({ mode: 'blocked', reason: '状态损坏' });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('模板保存已阻止'), expect.any(Object));
  });

  it('基线缺失时拒绝保存全局配置且零提交', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    store.loadSnapshot({
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
    }, []);
    store.templateBaseData = null;
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('模板基线缺失'), expect.any(Object));
  });

  it('scope-only 投影不一致时如实报错并给出先保存数据的指引', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);
    serviceMock.commitCurrentFloorTemplateScopeOnly_ACU.mockResolvedValueOnce({
      saved: false,
      error: 'scope-only 模板提交要求 baseline 与 candidate 的持久化 Sheet 投影完全一致。',
    });

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining('存在未提交的表内容差异，请先保存数据到当前消息，再保存全局配置。'),
      { muteable: false },
    );
  });

  it('基线缺少 globalInjectionConfig 而草稿被补齐默认值时不视为变更（伪变更哨兵）', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    // 基线 mate 无 globalInjectionConfig 字段。
    store.loadSnapshot({ mate: { type: 'chatSheets', version: 1 }, sheet_test_vz2: sheet() }, ['sheet_test_vz2']);
    // 草稿被 ensureWriteBack 补齐了默认值，但内容与规范化后的基线一致。
    store.tempData.mate.globalInjectionConfig = {
      readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
      wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
    };
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(false);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).not.toHaveBeenCalled();
    expect(toastMock.info).toHaveBeenCalledWith('模板结构没有变化。', { muteable: false });
  });

  it('全局注入配置变更叠加表结构变更时仍走结构提交且不重复调用 scope-only', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.currentSheet.name = '新表名';
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);

    const saved = await useVisualizerSave().saveTemplateToCurrentChat();

    expect(saved).toBe(true);
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledTimes(1);
    expect(serviceMock.commitCurrentFloorTemplateScopeOnly_ACU).not.toHaveBeenCalled();
    expect(serviceMock.commitCurrentFloorTemplateChanges_ACU).toHaveBeenCalledWith(expect.objectContaining({
      templateSource: expect.objectContaining({
        mate: expect.objectContaining({
          globalInjectionConfig: expect.objectContaining({
            readableEntryPlacement: expect.objectContaining({ depth: 7 }),
          }),
        }),
      }),
    }));
  });

  it('数据路径：仅有全局注入配置变更时提示改用模板保存且零持久化', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerSave } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerSave');
    const store = useVisualizerStore();
    const base = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      } },
      sheet_test_vz2: sheet(),
    };
    store.loadSnapshot(base, ['sheet_test_vz2']);
    store.tempData.mate.globalInjectionConfig.readableEntryPlacement.depth = 7;
    store.setDirty(true);

    const saved = await useVisualizerSave().saveToChat();

    expect(saved).toBe(false);
    expect(toastMock.info).toHaveBeenCalledWith('全局注入配置属于模板层，请使用「保存模板到当前聊天」保存。', { muteable: false });
    expect(serviceMock.persistTableMutationLogBatchV2_ACU).not.toHaveBeenCalled();
    expect(serviceMock.runTableWriteTransaction_ACU).not.toHaveBeenCalled();
  });
});
