import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [{}] as any[],
  container: null as any,
  tableData: null as any,
  template: null as any,
  save: vi.fn().mockResolvedValue(undefined),
  strictSave: vi.fn().mockResolvedValue(undefined),
  setLock: vi.fn(),
  deleteLock: vi.fn(),
  commit: vi.fn(),
  scopeState: null as any,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: h.save,
  saveChatToHostStrict_ACU: h.strictSave,
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  getChatScopedConfigContainer_ACU: () => h.container,
  peekChatScopedConfigContainer_ACU: () => h.container,
  getActiveChatStorageIdentity_ACU: () => 'test-chat',
  normalizeChatScopedConfigContainer_ACU: (value: any) => JSON.parse(JSON.stringify(value || { version: 1 })),
  setChatScopedConfigContainer_ACU: (_chat: any[], value: any) => { h.container = value; },
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.tableData; },
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/service/runtime/helpers-table-lock', () => ({
  setSpecialIndexLockEnabled_ACU: h.setLock,
  deleteTableLocksForSheet_ACU: h.deleteLock,
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  applyChatTemplateSnapshotWithReconciliation_ACU: h.commit,
}));
vi.mock('../../../src/service/template/chat-scope/chat-scope-template', () => ({
  getCurrentChatTemplateScopeState_ACU: () => h.scopeState,
  getGlobalTemplateSnapshotForCurrentProfile_ACU: () => h.template,
}));
vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  canEnableFlightMode_ACU: () => ({ canEnable: true, visibleChronicleRowCount: 2 }),
  isChronicleBelowClassicThreshold_ACU: () => Array.isArray(h.tableData?.sheet_chronicle?.content)
    && h.tableData.sheet_chronicle.content.length - 1 < 15,
  getCurrentFlightModeState_ACU: () => h.container?.flightModeByIsolationKey?.[''] || h.container?.flightMode || { enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' },
  normalizeFlightModeState_ACU: (value: any) => value,
}));
vi.mock('../../../src/service/fill-mode/fill-mode-preferences', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/service/fill-mode/fill-mode-preferences')>(),
  isFillMode_ACU: (mode: unknown) => ['classic', 'vector', 'llm', 'crossfire'].includes(String(mode)),
  readFillModePreferences_ACU: () => ({ source: 'stored', diagnostics: [], preferences: {
    schemaVersion: 1, selectedMode: 'classic', classic: { recentChronicleRows: 15 },
    vector: { resultCount: 30, minScore: 0.35, candidateLimit: 100 },
  } }),
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: (message: any, key: string) => message?.tags?.[key] || null,
}));
vi.mock('../../../src/service/vector/summary-vector-index-archive-service', () => ({
  buildPreparedRows_ACU: () => ({ rows: [{ rowId: '1', rowKey: 'row-1' }], error: '' }),
}));

import { disableFlightMode_ACU, enableFlightMode_ACU } from '../../../src/service/flight-mode/flight-mode-transition';
import { ensureCurrentChatFillModeRecorded_ACU, setCurrentChatFillMode_ACU } from '../../../src/service/fill-mode/fill-mode-chat-switch';
import { resolveCurrentChatFillMode_ACU } from '../../../src/service/fill-mode/fill-mode-chat-record';

function chronicleTemplate() {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_chronicle: {
      uid: 'sheet_chronicle', name: '纪要表', content: [['row_id', '纪要'], ['1', 'a']],
      sourceData: {}, updateConfig: { uiSentinel: -1, contextDepth: 3, updateFrequency: 2, batchSize: 1, skipFloors: 0, groupId: 8 },
      exportConfig: { entryType: 'keyword', extraIndexEnabled: true }, orderNo: 2,
    },
  };
}

describe('flight-mode-transition', () => {
  beforeEach(() => {
    h.container = null;
    h.scopeState = null;
    h.tableData = { sheet_chronicle: { name: '纪要表', content: [['row_id'], ['1'], ['2']] } };
    h.template = { templateStr: JSON.stringify(chronicleTemplate()), presetName: '预设' };
    h.save.mockClear(); h.setLock.mockClear(); h.deleteLock.mockClear();
    h.chat = [{}];
    h.strictSave.mockReset().mockResolvedValue(undefined);
    h.commit.mockReset().mockResolvedValue({ saved: true, mode: 'v2_commit' });
  });

  it('启用时经正式协调提交，且不直写模板 scope', async () => {
    // 协调层按显示名派生真实 key；运行时数据是提交后的权威来源。
    h.commit.mockImplementation(async () => {
      h.tableData.sheet_da_zong_jie = { name: '大总结', content: [['row_id', '总结']] };
      return { saved: true, mode: 'v2_commit' };
    });

    await expect(enableFlightMode_ACU()).resolves.toEqual({ ok: true, visibleChronicleRowCount: 2 });

    const [submitted, options] = h.commit.mock.calls[0];
    expect(submitted.sheet_chronicle.exportConfig).toMatchObject({ entryType: 'constant', extraIndexEnabled: false });
    expect(submitted.sheet_acu_flight_big_summary).toMatchObject({ name: '大总结' });
    expect(submitted.sheet_acu_flight_big_summary.updateConfig).toEqual(submitted.sheet_chronicle.updateConfig);
    expect(h.container.fillModeByIsolationKey['']).toMatchObject({ mode: 'classic', recordedAt: expect.any(Number) });
    // 启用不得硬删任何表。
    expect(options.hardDeleteMissingSheets).toBeUndefined();
    // 模板 scope 只能由提交链路写入，飞行模式自己只写 flightMode 键。
    expect(h.container.template).toBeUndefined();
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'classic', recordStatus: 'recorded' });
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: false, reason: 'already_recorded' });
    expect(await setCurrentChatFillMode_ACU('vector')).toEqual({ ok: true, mode: 'vector', changed: true });
    expect(h.container.fillModeByIsolationKey[''].mode).toBe('vector');
    expect(await setCurrentChatFillMode_ACU('classic')).toEqual({ ok: true, mode: 'classic', changed: true });
    h.tableData.sheet_chronicle.content = [['row_id'], ...Array.from({ length: 15 }, (_, i) => [String(i)])];
    expect(await setCurrentChatFillMode_ACU('llm')).toEqual({ ok: false, reason: 'irreversible_confirmation_required', currentMode: 'classic' });
    expect(h.container.fillModeByIsolationKey[''].mode).toBe('classic');
  });

  it('启用后记录协调层派生的真实 key，而非占位常量', async () => {
    h.commit.mockImplementation(async () => {
      h.tableData.sheet_da_zong_jie = { name: '大总结', content: [['row_id', '总结']] };
      return { saved: true, mode: 'v2_commit' };
    });

    await enableFlightMode_ACU();

    expect(h.container.flightModeByIsolationKey[''].bigSummarySheetKey).toBe('sheet_da_zong_jie');
    expect(h.container.flightModeByIsolationKey[''].archive).toMatchObject({
      templateScopeWasAbsent: true,
      chronicleExportConfig: { entryType: 'keyword', extraIndexEnabled: true },
      templateScope: { templateStr: JSON.stringify(chronicleTemplate()), presetName: '预设' },
    });
    expect(h.setLock).toHaveBeenCalledWith('sheet_da_zong_jie', false);

    // 缺标记旧会话通过正式补记入口固定模式，不把推断当作已保存。
    h.container = null;
    h.tableData = { sheet_chronicle: { name: '纪要表', content: [['row_id'], ['1']] } };
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'llm', source: 'legacy', recordStatus: 'absent' });
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: true, mode: 'llm' });
    expect(h.container.fillModeByIsolationKey[''].mode).toBe('llm');

    const state: any = {
      sourceTableKey: 'sheet_chronicle',
      rows: [{ rowId: '1', rowKey: 'row-1', status: 'ready' }],
      chunks: [{ chunkId: 'chunk-1', rowKey: 'row-1', vector: [0.5, 1] }],
    };
    h.chat = [{ is_user: false, tags: { '': { summaryVectorIndexState: state } } }];
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: false, reason: 'already_recorded' });
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'llm', recordStatus: 'recorded' });
    h.container = null;
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: true, mode: 'crossfire' });
    expect(h.container.fillModeByIsolationKey[''].mode).toBe('crossfire');

    h.container = null;
    state.rows[0].status = 'removed';
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: true, mode: 'llm' });
    h.container = null;
    state.rows[0].status = 'ready';
    const inspect = vi.spyOn(await import('../../../src/service/fill-mode/fill-mode-chat-evidence'), 'inspectSummaryVectorDataForCurrentChat_ACU');
    inspect.mockResolvedValueOnce({ status: 'unknown', error: '数据块不可读' });
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toMatchObject({ recorded: false, reason: 'evidence_unavailable' });
    expect(h.container).toBeNull();
    inspect.mockImplementationOnce(async () => {
      h.chat = [{ is_user: false, mes: '切换后的历史' }];
      return { status: 'present' };
    });
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: false, reason: 'chat_changed' });
    expect(h.container).toBeNull();
    inspect.mockRestore();

    h.strictSave.mockRejectedValueOnce(new Error('标记保存拒绝'));
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toMatchObject({ recorded: false, reason: 'save_failed' });
    expect(h.container).toBeNull();
    h.container = { version: 1, fillModeByIsolationKey: { '': { mode: '损坏模式' } } };
    expect(await ensureCurrentChatFillModeRecorded_ACU()).toEqual({ recorded: false, reason: 'record_invalid' });
    expect(h.container.fillModeByIsolationKey[''].mode).toBe('损坏模式');
  });

  it('停用前检测到启用后的模板修改时拒绝静默覆盖，明确确认后才允许硬删恢复', async () => {
    h.scopeState = { templateStr: '{"template":"用户修改后"}', presetName: '当前模板' };
    h.container = { version: 1, flightMode: {
      enabled: true, hiddenRowIds: ['1'], bigSummarySheetKey: 'sheet_da_zong_jie',
      archive: {
        enabledTemplateStr: '{"template":"飞行模式启用后"}',
        templateScope: { templateStr: JSON.stringify(chronicleTemplate()), presetName: '启用前模板' },
      },
    } };

    await expect(disableFlightMode_ACU()).resolves.toEqual({ ok: false, reason: 'template_scope_changed' });
    h.tableData.sheet_chronicle.content = [['row_id'], ...Array.from({ length: 15 }, (_, i) => [String(i)])];
    expect(await setCurrentChatFillMode_ACU('llm')).toMatchObject({ ok: false, reason: 'irreversible_confirmation_required' });
    expect(await setCurrentChatFillMode_ACU('llm', { confirmIrreversibleChange: true })).toMatchObject({ ok: false, reason: 'template_scope_changed' });
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.deleteLock).not.toHaveBeenCalled();

    await expect(setCurrentChatFillMode_ACU('llm', { confirmIrreversibleChange: true, confirmTemplateScopeChange: true }))
      .resolves.toEqual({ ok: true, mode: 'llm', changed: true });
    expect(await setCurrentChatFillMode_ACU('classic')).toMatchObject({ ok: false, reason: 'classic_locked' });
    expect(h.commit).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      source: 'flight_mode_disable',
      hardDeleteMissingSheets: true,
      destructiveChangeConfirmed: true,
    }));
  });

  it('提交失败时透传拒绝原因，且不写状态不设锁', async () => {
    h.commit.mockResolvedValue({ saved: false, error: '当前楼层模板提交只能写入最新 AI 楼层：requested=3, latest=5。' });

    const result = await enableFlightMode_ACU();

    expect(result).toMatchObject({ ok: false, reason: 'commit_failed', error: expect.stringContaining('最新 AI 楼层') });
    // 启用前预存的待完成归档在提交失败后清除，且不写开关状态。
    expect(h.container?.flightModeByIsolationKey).toBeUndefined();
    expect(h.container?.flightModePendingEnableByIsolationKey).toBeUndefined();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.setLock).not.toHaveBeenCalled();
  });

  it('提交成功但运行时找不到大总结表时失败，不写入占位 key', async () => {
    h.commit.mockResolvedValue({ saved: true, mode: 'v2_commit' });

    const result = await enableFlightMode_ACU();

    expect(result).toMatchObject({ ok: false, reason: 'big_summary_sheet_key_unresolved' });
    expect(h.container?.flightModeByIsolationKey).toBeUndefined();
    expect(h.setLock).not.toHaveBeenCalled();
  });

  it('停用时按归档模板硬删大总结表并带破坏性确认', async () => {
    h.container = { version: 1, flightMode: {
      enabled: true, hiddenRowIds: ['1'], bigSummarySheetKey: 'sheet_da_zong_jie',
      archive: {
        templateScopeWasAbsent: true,
        chronicleExportConfig: { entryType: 'keyword', extraIndexEnabled: true },
        templateScope: { templateStr: JSON.stringify(chronicleTemplate()), presetName: '预设' },
      },
    } };

    await expect(disableFlightMode_ACU()).resolves.toEqual({ ok: true });

    const [submitted, options] = h.commit.mock.calls[0];
    expect(submitted.sheet_acu_flight_big_summary).toBeUndefined();
    expect(submitted.sheet_chronicle.exportConfig).toMatchObject({ entryType: 'keyword', extraIndexEnabled: true });
    // 摘要随隐藏纪要行恢复而失去意义，必须真删；硬删必须与破坏性确认成对。
    expect(options).toMatchObject({ hardDeleteMissingSheets: true, destructiveChangeConfirmed: true });
    expect(h.container.flightModeByIsolationKey['']).toMatchObject({ enabled: false, hiddenRowIds: [] });
    expect(h.container.flightModeByIsolationKey[''].archive).toBeUndefined();
    expect(h.container.fillModeByIsolationKey['']).toMatchObject({ mode: 'llm', recordedAt: expect.any(Number) });
    expect(h.deleteLock).toHaveBeenCalledWith('sheet_da_zong_jie');
  });

  it('停用提交失败时保留开启态，不清隐藏行也不删锁', async () => {
    h.container = { version: 1, flightMode: {
      enabled: true, hiddenRowIds: ['1'], bigSummarySheetKey: 'sheet_da_zong_jie',
      archive: { templateScope: { templateStr: JSON.stringify(chronicleTemplate()) } },
    } };
    h.commit.mockResolvedValue({ saved: false, blockers: ['当前 V2 历史存在结构性兼容修复'] });

    const result = await disableFlightMode_ACU();

    expect(result).toMatchObject({ ok: false, reason: 'commit_failed', blockers: ['当前 V2 历史存在结构性兼容修复'] });
    expect(h.container.flightMode).toMatchObject({ enabled: true, hiddenRowIds: ['1'] });
    expect(h.deleteLock).not.toHaveBeenCalled();
    const previous = JSON.parse(JSON.stringify(h.container));
    h.commit.mockResolvedValueOnce({ saved: true });
    h.strictSave.mockRejectedValueOnce(new Error('严格保存拒绝'));
    expect(await setCurrentChatFillMode_ACU('vector')).toMatchObject({ ok: false, reason: 'classic_disable_failed', error: expect.stringContaining('严格保存拒绝') });
    expect(h.container).toEqual(previous);
    expect(h.container.fillModeByIsolationKey).toBeUndefined();
    expect(h.deleteLock).not.toHaveBeenCalled();
  });

  it('兼容旧归档缺少 templateScope 时，从当前启用态模板移除大总结并恢复纪要配置', async () => {
    const enabledTemplate = chronicleTemplate() as any;
    enabledTemplate.sheet_chronicle.exportConfig = { entryType: 'constant', extraIndexEnabled: false };
    enabledTemplate.sheet_da_zong_jie = { name: '大总结', content: [['row_id', '总结'], ['1', '阶段总结']] };
    h.scopeState = { templateStr: JSON.stringify(enabledTemplate), presetName: '飞行模式模板' };
    h.container = { version: 1, flightMode: {
      enabled: true, hiddenRowIds: ['1'], bigSummarySheetKey: 'sheet_da_zong_jie',
      archive: {
        templateScopeWasAbsent: true,
        chronicleExportConfig: { entryType: 'keyword', extraIndexEnabled: true },
      },
    } };

    await expect(disableFlightMode_ACU()).resolves.toEqual({ ok: true });

    const [submitted, options] = h.commit.mock.calls[0];
    expect(submitted.sheet_da_zong_jie).toBeUndefined();
    expect(submitted.sheet_chronicle.exportConfig).toEqual({ entryType: 'keyword', extraIndexEnabled: true });
    expect(options).toMatchObject({ presetName: '飞行模式模板', hardDeleteMissingSheets: true, destructiveChangeConfirmed: true });
    expect(h.container.flightModeByIsolationKey['']).toMatchObject({ enabled: false, hiddenRowIds: [] });
  });

  it('归档和当前模板都不足以安全恢复时返回明确错误', async () => {
    h.container = { version: 1, flightMode: {
      enabled: true, hiddenRowIds: [], bigSummarySheetKey: 'sheet_da_zong_jie',
      archive: { templateScopeWasAbsent: true },
    } };

    await expect(disableFlightMode_ACU()).resolves.toEqual({
      ok: false,
      reason: 'restore_archive_missing',
      error: expect.stringContaining('缺少可验证的启用前模板归档'),
    });
    expect(h.commit).not.toHaveBeenCalled();
  });
});
