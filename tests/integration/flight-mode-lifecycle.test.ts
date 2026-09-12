import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  data: null as any,
  scope: null as any,
  guide: null as any,
  scopeTemplate: null as any,
  mode: 'native' as 'native' | 'sqlite',
  save: vi.fn().mockResolvedValue(undefined),
  strictSave: vi.fn().mockResolvedValue(undefined),
  reloadStorageProvider: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: h.save,
  saveChatToHostStrict_ACU: h.strictSave,
  emitMessageUpdated_ACU: vi.fn(),
}));
vi.mock('../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: () => 'flight-mode-lifecycle',
  getChatScopedConfigContainer_ACU: () => h.scope,
  peekChatScopedConfigContainer_ACU: () => h.scope,
  normalizeChatScopedConfigContainer_ACU: (value: any) => JSON.parse(JSON.stringify(value || { version: 1 })),
  setChatScopedConfigContainer_ACU: (_chat: any[], value: any) => { h.scope = value; },
  peekChatSheetGuideContainer_ACU: () => h.guide,
  setChatSheetGuideContainer_ACU: (_chat: any[], value: any) => { h.guide = value; },
}));
vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.data; },
  _set_currentJsonTableData_ACU: (value: any) => { h.data = value; },
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));
vi.mock('../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));
vi.mock('../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: vi.fn(),
}));
vi.mock('../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: () => h.mode,
  isSqliteMode: () => h.mode === 'sqlite',
}));
vi.mock('../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: h.reloadStorageProvider,
  didSqliteFallbackAfterReload_ACU: () => false,
}));
vi.mock('../../src/service/table/storage-strategy-resolver', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/table/storage-strategy-resolver')>()),
  resolveTableStorageStrategy_ACU: () => ({ mode: 'v2' }),
}));
vi.mock('../../src/service/table/table-write-transaction', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/table/table-write-transaction')>()),
  captureTableRuntimeRevisionForWriteSet_ACU: () => 'flight-mode-revision',
  runTableWriteTransaction_ACU: async (_options: any, task: any) => task({
    baseRevision: 'flight-mode-revision',
    assertFresh: vi.fn(),
    runCommit: async (work: any) => work(),
  }),
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  sanitizeTemplateSnapshotForChat_ACU: (source: any) => {
    const templateObj = typeof source === 'string' ? JSON.parse(source) : clone(source);
    return { templateObj, templateStr: JSON.stringify(templateObj) };
  },
  buildChatSheetGuideDataFromData_ACU: (data: any) => clone(data),
  getChatSheetGuideDataForIsolationKey_ACU: () => h.guide,
  getCurrentChatTemplateScopeState_ACU: () => h.scopeTemplate || null,
  // S3-4 休眠溯源：协调提交前会解析切换前活跃预设名（resolveActiveTemplatePresetName_ACU），
  // 该解析依赖以下两个 chat-scope 导出。
  migrateLegacyTemplateScopeForCurrentChat_ACU: () => null,
  normalizeTemplateScopeMode_ACU: (mode: string) => (['chat_override', 'preset_link'].includes(mode) ? mode : 'inherit_global'),
  setChatSheetGuideDataForIsolationKey_ACU: (_key: string, guideData: any, options: any) => {
    h.guide = clone(guideData);
    if (options?.syncTemplateScope) h.scopeTemplate = { templateStr: JSON.stringify(options.templateSource), presetName: options.presetName || '' };
    return true;
  },
  normalizeGuideData_ACU: (data: any) => data,
}));
vi.mock('../../src/service/template/chat-scope/chat-scope-template', () => ({
  getCurrentChatTemplateScopeState_ACU: () => h.scopeTemplate || null,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: () => null,
}));
vi.mock('../../src/service/runtime/helpers-table-lock', () => ({
  setSpecialIndexLockEnabled_ACU: vi.fn(),
  deleteTableLocksForSheet_ACU: vi.fn(),
}));

import { disableFlightMode_ACU, enableFlightMode_ACU } from '../../src/service/flight-mode/flight-mode-transition';
import { getCurrentFlightModeState_ACU, stageFlightModeHiddenRowIds_ACU } from '../../src/service/flight-mode/flight-mode-state';
import { getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU, projectFlightModeHiddenChronicleRows_ACU } from '../../src/service/flight-mode/flight-mode-hidden-rows';
import { persistTableMutationLogV2_ACU } from '../../src/service/table/storage-frame-v2-persist';
import { loadTableStateFromFramesV2_ACU } from '../../src/service/table/storage-frame-v2-replay';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function sheet(key: string, name: string, ddl: string, rows: string[][] = []): any {
  return {
    uid: key, name, orderNo: 0, content: [['row_id', name === '纪要表' ? '事件' : '总结'], ...rows],
    sourceData: { ddl },
    updateConfig: { uiSentinel: -1, contextDepth: 3, updateFrequency: 1, batchSize: 1, skipFloors: 0, groupId: 8 },
    exportConfig: { enabled: true, splitByRow: false, entryName: name, entryType: 'keyword', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: true, extraIndexEntryName: `${name}-索引`, extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 } },
  };
}

function initialData(): any {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_chronicle: sheet(
      'sheet_chronicle',
      '纪要表',
      'CREATE TABLE chronicle (row_id INTEGER PRIMARY KEY, event TEXT NOT NULL);',
      [['1', '第一段纪要'], ['2', '第二段纪要']],
    ),
  };
}

function makeFrame(data: any): any {
  return {
    _acu_storage_version: 2,
    storageFrame: {
      version: 2,
      headRevision: 'checkpoint:flight-mode',
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: clone(data) },
      logEntries: [],
      perSheetCheckpoints: {},
    },
  };
}

describe.each(['native', 'sqlite'] as const)('flight mode lifecycle (%s)', (mode) => {
  beforeEach(() => {
    h.mode = mode;
    h.scope = null;
    h.guide = null;
    h.scopeTemplate = { templateStr: JSON.stringify(initialData()), presetName: '飞行模式集成' };
    h.data = clone(initialData());
    h.chat.splice(0, h.chat.length, {
      is_user: false,
      mes: '初始 AI 楼层',
      TavernDB_ACU_IsolatedData: { '': makeFrame(h.data) },
    });
    h.save.mockClear();
    h.strictSave.mockClear();
    h.reloadStorageProvider.mockClear();
  });

  it('经正式模板协调启用，写入大总结后隐藏纪要投影，并在停用时跨历史硬删大总结', async () => {
    await expect(enableFlightMode_ACU()).resolves.toEqual({ ok: true, visibleChronicleRowCount: 2 });

    const enabled = getCurrentFlightModeState_ACU();
    const summaryKey = enabled.bigSummarySheetKey;
    expect(enabled).toMatchObject({ enabled: true, hiddenRowIds: [] });
    expect(summaryKey).toMatch(/^sheet_/);
    expect(summaryKey).not.toBe('sheet_acu_flight_big_summary');
    expect(h.data.sheet_chronicle.exportConfig).toMatchObject({ entryType: 'constant', extraIndexEnabled: false });
    expect(h.data[summaryKey]).toMatchObject({ name: '大总结' });

    const beforeWrite = clone(h.data);
    const afterWrite = clone(h.data);
    afterWrite.sheet_chronicle.content.push(['3', '同批新增纪要']);
    afterWrite[summaryKey].content.push(['1', '阶段总结']);
    const hiddenRowIds = getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(beforeWrite, afterWrite, enabled);
    expect(hiddenRowIds).toEqual(['1', '2', '3']);
    const rollback = stageFlightModeHiddenRowIds_ACU(hiddenRowIds!);

    const persisted = await persistTableMutationLogV2_ACU({
      targetMessageIndex: 0,
      source: 'group_fill',
      afterData: afterWrite,
      operations: [
        { kind: 'data_replace', data: afterWrite, reason: 'system' },
      ],
      candidateChangedSheetKeys: ['sheet_chronicle', summaryKey],
      isolationKey: '',
      baseRevision: 'flight-mode-revision',
      writeSet: [{ kind: 'sheet', sheetKey: summaryKey }],
      transactionContext: { baseRevision: 'flight-mode-revision', runCommit: async (work: any) => work(), assertFresh: vi.fn() },
    });
    expect(persisted.saved).toBe(true);
    expect(rollback).toEqual(expect.any(Function));
    h.data = afterWrite;

    const replayed = await loadTableStateFromFramesV2_ACU(h.chat, '');
    expect(replayed?.sheet_chronicle.content).toEqual(afterWrite.sheet_chronicle.content);
    expect(projectFlightModeHiddenChronicleRows_ACU(replayed!, getCurrentFlightModeState_ACU()).sheet_chronicle.content).toEqual([['row_id', '事件']]);

    h.chat.push({ is_user: false, mes: '后续 AI 楼层', TavernDB_ACU_IsolatedData: { '': clone(h.chat[0].TavernDB_ACU_IsolatedData['']) } });
    await expect(disableFlightMode_ACU()).resolves.toEqual({ ok: true });

    expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: false, hiddenRowIds: [] });
    expect(h.data.sheet_chronicle.exportConfig).toMatchObject({ entryType: 'keyword', extraIndexEnabled: true });
    const terminalFrame = h.chat[h.chat.length - 1].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(terminalFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'schema_change' });
    expect(terminalFrame.logEntries).toEqual([]);
    expect(terminalFrame.perSheetCheckpoints).toBeUndefined();
    for (const message of h.chat) {
      expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data[summaryKey]).toBeUndefined();
      expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints?.[summaryKey]).toBeUndefined();
    }

    // data_replace 保持整库语义，硬删除不能只清 checkpoint/单表日志而让它在下一次 replay 复活。
    const afterDeleteReplay = await loadTableStateFromFramesV2_ACU(h.chat, '');
    expect(afterDeleteReplay?.[summaryKey]).toBeUndefined();

    await expect(enableFlightMode_ACU()).resolves.toEqual({ ok: true, visibleChronicleRowCount: 3 });
    expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: true, bigSummarySheetKey: summaryKey });
    expect(h.data[summaryKey]).toMatchObject({ name: '大总结' });

    await expect(disableFlightMode_ACU()).resolves.toEqual({ ok: true });
    expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: false, hiddenRowIds: [] });
    const secondTerminalFrame = h.chat[h.chat.length - 1].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(secondTerminalFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'schema_change' });
    expect(secondTerminalFrame.logEntries).toEqual([]);
    expect(secondTerminalFrame.perSheetCheckpoints).toBeUndefined();
    const afterSecondDeleteReplay = await loadTableStateFromFramesV2_ACU(h.chat, '');
    expect(afterSecondDeleteReplay?.[summaryKey]).toBeUndefined();
    expect(h.reloadStorageProvider).toHaveBeenCalledTimes(mode === 'sqlite' ? 4 : 0);
  });

  describe('sqlite + 已有数据且无 DDL 时飞行模式启停', () => {
    function noDdlSheet(key: string, name: string, rows: string[][] = []): any {
      const s = sheet(key, name, '', rows);
      s.sourceData = { note: '无 DDL，依赖运行时 fallback' };
      return s;
    }

    function initialNoDdlData(): any {
      return {
        mate: { type: 'chatSheets', version: 1 },
        sheet_chronicle: noDdlSheet('sheet_chronicle', '纪要表', [['1', '第一段纪要'], ['2', '第二段纪要']]),
        sheet_quan_ju: noDdlSheet('sheet_quan_ju', '全局数据表', [['1', '御苑']]),
      };
    }

    it('开启飞行模式成功，纪要表与普通表均获得 fallback DDL 且数据保留，停用后可恢复', async () => {
      h.mode = 'sqlite';
      h.scope = null;
      h.guide = null;
      const initial = initialNoDdlData();
      h.scopeTemplate = { templateStr: JSON.stringify(initial), presetName: '飞行模式集成' };
      h.data = clone(initial);
      h.chat.splice(0, h.chat.length, {
        is_user: false,
        mes: '初始 AI 楼层',
        TavernDB_ACU_IsolatedData: { '': makeFrame(h.data) },
      });
      h.save.mockClear();
      h.strictSave.mockClear();

      await expect(enableFlightMode_ACU()).resolves.toEqual({ ok: true, visibleChronicleRowCount: 2 });

      const enabled = getCurrentFlightModeState_ACU();
      expect(enabled).toMatchObject({ enabled: true, hiddenRowIds: [] });
      const summaryKey = enabled.bigSummarySheetKey;
      expect(h.data[summaryKey]).toMatchObject({ name: '大总结' });
      expect(h.data.sheet_chronicle.exportConfig).toMatchObject({ entryType: 'constant', extraIndexEnabled: false });

      // 原无 DDL 表在提交后的权威状态中获得合法 fallback DDL，数据保留。
      expect(h.data.sheet_chronicle.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(h.data.sheet_quan_ju.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(h.data.sheet_chronicle.content).toEqual([['row_id', '事件'], ['1', '第一段纪要'], ['2', '第二段纪要']]);
      expect(h.data.sheet_quan_ju.content).toEqual([['row_id', '总结'], ['1', '御苑']]);

      // 写入大总结并执行隐藏纪要逻辑，确认无回归。
      const beforeWrite = clone(h.data);
      const afterWrite = clone(h.data);
      afterWrite.sheet_chronicle.content.push(['3', '同批新增纪要']);
      afterWrite[summaryKey].content.push(['1', '阶段总结']);
      const hiddenRowIds = getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU(beforeWrite, afterWrite, enabled);
      expect(hiddenRowIds).toEqual(['1', '2', '3']);
      const roll = stageFlightModeHiddenRowIds_ACU(hiddenRowIds!);

      const persisted = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 0,
        source: 'group_fill',
        afterData: afterWrite,
        operations: [
          { kind: 'sheet_replace', sheetKey: 'sheet_chronicle', sheet: afterWrite.sheet_chronicle, reason: 'system' },
          { kind: 'sheet_replace', sheetKey: summaryKey, sheet: afterWrite[summaryKey], reason: 'system' },
        ],
        candidateChangedSheetKeys: ['sheet_chronicle', summaryKey],
        isolationKey: '',
        baseRevision: 'flight-mode-revision',
        writeSet: [{ kind: 'sheet', sheetKey: summaryKey }],
        transactionContext: { baseRevision: 'flight-mode-revision', runCommit: async (work: any) => work(), assertFresh: vi.fn() },
      });
      expect(persisted.saved).toBe(true);
      expect(roll).toEqual(expect.any(Function));
      h.data = afterWrite;

      const replayed = await loadTableStateFromFramesV2_ACU(h.chat, '');
      expect(replayed?.sheet_chronicle.content).toEqual(afterWrite.sheet_chronicle.content);

      h.chat.push({ is_user: false, mes: '后续 AI 楼层', TavernDB_ACU_IsolatedData: { '': clone(h.chat[0].TavernDB_ACU_IsolatedData['']) } });
      await expect(disableFlightMode_ACU()).resolves.toEqual({ ok: true });

      expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: false, hiddenRowIds: [] });
      expect(h.data.sheet_chronicle.exportConfig).toMatchObject({ entryType: 'keyword', extraIndexEnabled: true });
      // 停用后原表仍有效：fallback DDL 保留、数据不变。
      expect(h.data.sheet_chronicle.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(h.data.sheet_quan_ju.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      for (const message of h.chat) {
        expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data[summaryKey]).toBeUndefined();
        expect(message.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints?.[summaryKey]).toBeUndefined();
      }
    });
  });

});
