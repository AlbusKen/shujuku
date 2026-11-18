import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  scope: null as any,
  guide: null as any,
  saveStrict: vi.fn(),
  setGuide: vi.fn(),
  setRuntime: vi.fn(),
  hydrateStrict: vi.fn(),
  aliasConflicts: new Set<string>(),
  swappedChat: null as any[] | null,
  canonicalRowErrors: [] as string[],
  physicalNameError: null as Error | null,
  settings: { dataIsolationEnabled: false, dataIsolationCode: '', storageMode: 'native' } as any,
  writeInitFrame: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.swappedChat || mocks.chat,
  saveChatToHostStrict_ACU: mocks.saveStrict,
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: () => 'chat-a',
  peekChatScopedConfigContainer_ACU: () => mocks.scope,
  peekChatSheetGuideContainer_ACU: () => mocks.guide,
  setChatScopedConfigContainer_ACU: (_chat: any[], value: any) => { mocks.scope = value; },
  setChatSheetGuideContainer_ACU: (_chat: any[], value: any) => { mocks.guide = value; },
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => '', settings_ACU: mocks.settings,
  _set_currentJsonTableData_ACU: mocks.setRuntime,
}));
vi.mock('../../../src/shared/sheet-identity', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/sheet-identity');
  return {
    prepareStableSheetIdentities_ACU: actual.prepareStableSheetIdentities_ACU,
    canonicalizeDisplayName_ACU: (value: unknown) => String(value ?? '').trim(),
    assertNoPhysicalTableNameCollision_ACU: () => {
      if (mocks.physicalNameError) throw mocks.physicalNameError;
    },
  };
});
vi.mock('../../../src/shared/canonical-row-normalizer', () => ({
  normalizeCanonicalTableRows_ACU: () => ({ errors: mocks.canonicalRowErrors }),
}));
vi.mock('../../../src/shared/sql-read-resolver', () => ({ buildSheetTableAliasMap_ACU: () => ({ aliases: new Map(), conflicts: mocks.aliasConflicts }) }));
vi.mock('../../../src/service/table/canonical-checkpoint-builder', () => ({
  buildCanonicalFullCheckpoint_ACU: (value: any) => ({ checkpoint: { kind: 'full', ...value } }),
}));
vi.mock('../../../src/service/table/sqlite-template-validation', () => ({ hydrateTableDataStrict_ACU: mocks.hydrateStrict }));
vi.mock('../../../src/service/table/storage-mode', () => ({ getCurrentStorageMode: () => mocks.settings.storageMode }));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: async (_options: any, task: any) => task({ runCommit: (commit: any) => commit() }),
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  ensureStableRowIdsForSheetContent_ACU: (content: any[]) => content.map((row, index) => index === 0 || row[0] ? row : [`generated-${index}`, ...row.slice(1)]),
  buildChatSheetGuideDataFromTemplateObj_ACU: (template: any) => ({ mate: template.mate || {}, ...template }),
  clearCurrentChatTemplateSnapshots_ACU: async () => { mocks.scope = null; mocks.guide = null; },
  setChatSheetGuideDataForIsolationKey_ACU: mocks.setGuide,
}));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));
// S2-4：init frame 写入已收敛到 persist 层入口；此处 mock 忠实复刻其 frame 拼装行为，
// 入口自身的单根断言与参数校验在 storage-frame-v2-persist.test.ts 中直接单测。
vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  writeInitFullCheckpointFrameV2_ACU: mocks.writeInitFrame,
}));

import { resetCurrentChatTableStateFromTemplate_ACU } from '../../../src/service/table/template-state-reset';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aliasConflicts = new Set();
  mocks.swappedChat = null;
  mocks.canonicalRowErrors = [];
  mocks.physicalNameError = null;
  mocks.chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, checkpoint: { data: { sheet_old: {} } }, logEntries: [] } } } }];
  mocks.scope = { version: 1, template: { '': { mode: 'chat_override', templateStr: 'old' } } };
  mocks.guide = { version: 1, tags: { '': { data: { sheet_old: {} } } } };
  mocks.saveStrict.mockResolvedValue(undefined);
  mocks.setGuide.mockImplementation((_key: string, guide: any) => { mocks.guide = { version: 1, tags: { '': { data: guide } } }; mocks.scope = { version: 1, template: { '': { mode: 'chat_override' } } }; return true; });
  mocks.writeInitFrame.mockImplementation(({ chat, targetIndex, isolationKey, checkpoint }: any) => {
    chat[targetIndex].TavernDB_ACU_IsolatedData = {
      ...(chat[targetIndex].TavernDB_ACU_IsolatedData || {}),
      [isolationKey]: { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint, logEntries: [] } },
    };
  });
});

describe('resetCurrentChatTableStateFromTemplate_ACU', () => {
  it('替换旧历史、scope 与 guide，并以稳定 key 将种子数据写入单一 V2 init checkpoint', async () => {
    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      mate: { type: 'chatSheets', version: 1 },
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['', '助手']] },
    });

    expect(result).toMatchObject({ saved: true, messageIndex: 0 });
    const frame = mocks.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.logEntries).toEqual([]);
    expect(frame.checkpoint.data.sheet_role.uid).toBe('sheet_role');
    expect(frame.checkpoint.data.sheet_role.content[1]).toEqual(['1', '助手']);
    expect(frame.checkpoint.data.sheet_role.sourceData.tableAliases).toEqual(['sheet_random']);
    expect(frame.checkpoint.data.sheet_old).toBeUndefined();
    expect(mocks.guide.tags[''].data.sheet_role).toBeDefined();
    expect(mocks.guide.tags[''].data.sheet_role.sourceData.tableAliases).toEqual(['sheet_random']);
    expect(mocks.setRuntime).toHaveBeenCalledWith(expect.objectContaining({ sheet_role: expect.any(Object) }));
    expect(mocks.saveStrict).toHaveBeenCalledOnce();
  });

  it('缺失整列 row_id 的有数据模板在写入前规范化，并将同一候选用于 checkpoint、guide、runtime 与结果', async () => {
    const input = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_summary_log: {
        uid: 'sheet_summary_log', name: 'SummaryLog',
        content: [['时间', '摘要'], ['T1', '事件']], sourceData: {},
      },
    };

    const result = await resetCurrentChatTableStateFromTemplate_ACU(input);

    expect(result).toMatchObject({ saved: true });
    expect(result.normalizedTemplateData?.sheet_summarylog.content).toEqual([
      ['row_id', '时间', '摘要'], ['1', 'T1', '事件'],
    ]);
    expect(result.normalizationAudit).toEqual([expect.objectContaining({
      sheetKey: 'sheet_summary_log', headerAction: 'inserted', generatedRowIdCount: 1,
    })]);
    const committed = mocks.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_summarylog;
    expect(committed.content).toEqual(result.normalizedTemplateData?.sheet_summarylog.content);
    expect(mocks.guide.tags[''].data.sheet_summarylog.content).toEqual(committed.content);
    expect(mocks.setRuntime).toHaveBeenCalledWith(expect.objectContaining({ sheet_summarylog: expect.objectContaining({ content: committed.content }) }));
    expect(input.sheet_summary_log.content).toEqual([['时间', '摘要'], ['T1', '事件']]);
  });

  it('错位 row_id 在事务前拒绝，且不写入 guide、checkpoint 或 runtime', async () => {
    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_summary_log: { uid: 'sheet_summary_log', name: 'SummaryLog', content: [['时间', 'row_id'], ['T1', '1']], sourceData: {} },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('row_id 位于第 2 列') });
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveStrict).not.toHaveBeenCalled();
    expect(mocks.setRuntime).not.toHaveBeenCalled();
  });

  it('严格保存失败时恢复旧 V2 数据、scope 与 guide，再严格保存回滚状态', async () => {
    const oldFrame = JSON.parse(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData));
    const oldScope = JSON.parse(JSON.stringify(mocks.scope));
    const oldGuide = JSON.parse(JSON.stringify(mocks.guide));
    mocks.saveStrict.mockRejectedValueOnce(new Error('host write failed')).mockResolvedValueOnce(undefined);

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['r-1', '助手']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('host write failed') });
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData).toEqual(oldFrame);
    expect(mocks.scope).toEqual(oldScope);
    expect(mocks.guide).toEqual(oldGuide);
    expect(mocks.saveStrict).toHaveBeenCalledTimes(2);
    expect(mocks.setRuntime).not.toHaveBeenCalled();
  });

  it('主保存与回滚保存均失败时合并错误，并保持运行时未提交', async () => {
    mocks.saveStrict
      .mockRejectedValueOnce(new Error('primary host write failed'))
      .mockRejectedValueOnce(new Error('rollback host write failed'));

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['r-1', '助手']] },
    });

    expect(result).toMatchObject({ saved: false });
    expect(result.error).toContain('primary host write failed');
    expect(result.error).toContain('回滚保存也失败');
    expect(result.error).toContain('rollback host write failed');
    expect(mocks.saveStrict).toHaveBeenCalledTimes(2);
    expect(mocks.setRuntime).not.toHaveBeenCalled();
  });

  it('guide/scope 写入被拒绝时恢复旧状态且不触发宿主保存', async () => {
    const oldFrame = JSON.parse(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData));
    const oldScope = JSON.parse(JSON.stringify(mocks.scope));
    const oldGuide = JSON.parse(JSON.stringify(mocks.guide));
    mocks.setGuide.mockReturnValueOnce(false);

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['r-1', '助手']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('guide 与 template scope') });
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData).toEqual(oldFrame);
    expect(mocks.scope).toEqual(oldScope);
    expect(mocks.guide).toEqual(oldGuide);
    expect(mocks.saveStrict).not.toHaveBeenCalled();
    expect(mocks.setRuntime).not.toHaveBeenCalled();
  });

  it('聊天在提交中切换时恢复原聊天状态且拒绝保存', async () => {
    const oldFrame = JSON.parse(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData));
    mocks.setGuide.mockImplementationOnce(() => {
      mocks.swappedChat = [{ is_user: false, mes: 'another chat' }];
      return true;
    });

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['r-1', '助手']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('目标聊天已切换') });
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData).toEqual(oldFrame);
    expect(mocks.saveStrict).not.toHaveBeenCalled();
    expect(mocks.setRuntime).not.toHaveBeenCalled();
  });

  it('重复或非法 row_id 在任何写入前拒绝，不能留下半提交 guide 或 checkpoint', async () => {
    const oldFrame = JSON.parse(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData));
    const oldScope = JSON.parse(JSON.stringify(mocks.scope));
    const oldGuide = JSON.parse(JSON.stringify(mocks.guide));
    mocks.canonicalRowErrors = ['sheet_role: duplicate row_id'];

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['same', '助手'], ['same', '助手2']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('row_id「same」重复') });
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData).toEqual(oldFrame);
    expect(mocks.scope).toEqual(oldScope);
    expect(mocks.guide).toEqual(oldGuide);
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveStrict).not.toHaveBeenCalled();
  });

  it('SQLite 物理表名冲突在事务外预检并拒绝，不触碰聊天状态', async () => {
    const oldFrame = JSON.parse(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData));
    mocks.physicalNameError = new Error('物理表名冲突：role');

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('物理表名冲突') });
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData).toEqual(oldFrame);
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveStrict).not.toHaveBeenCalled();
  });

  it('init frame 经 persist 统一入口写入，且入口抛出单根违例时回滚聊天状态并拒绝保存', async () => {
    const oldFrame = JSON.parse(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData));
    const oldScope = JSON.parse(JSON.stringify(mocks.scope));
    const oldGuide = JSON.parse(JSON.stringify(mocks.guide));
    mocks.writeInitFrame.mockImplementationOnce(() => {
      throw new Error('V2 init_reset 违反单根不变量：同一隔离键下存在 2 个 full checkpoint');
    });

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name'], ['r-1', '助手']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('单根不变量') });
    expect(mocks.writeInitFrame).toHaveBeenCalledWith(expect.objectContaining({
      targetIndex: 0,
      isolationKey: '',
      checkpoint: expect.objectContaining({ kind: 'full', reason: 'init' }),
    }));
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData).toEqual(oldFrame);
    expect(mocks.scope).toEqual(oldScope);
    expect(mocks.guide).toEqual(oldGuide);
    expect(mocks.saveStrict).not.toHaveBeenCalled();
    expect(mocks.setRuntime).not.toHaveBeenCalled();
  });

  it('重键后别名注册表发现歧义时在写入前拒绝初始化', async () => {
    mocks.aliasConflicts = new Set(['共享名称']);

    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_random: { uid: 'sheet_random', name: 'Role', content: [['row_id', 'name']] },
    });

    expect(result).toMatchObject({ saved: false, error: expect.stringContaining('歧义表别名') });
    expect(mocks.setGuide).not.toHaveBeenCalled();
    expect(mocks.saveStrict).not.toHaveBeenCalled();
  });
});

  it('sqlite 模式下注入无 DDL 模板时授权 runtime DDL fallback 并成功保存（T4.5）', async () => {
    mocks.settings.storageMode = 'sqlite';
    const result = await resetCurrentChatTableStateFromTemplate_ACU({
      sheet_tianqi: { uid: 'sheet_tianqi', name: '天气表', content: [['row_id', '天气状况'], ['1', '晴']] },
    });

    expect(result).toMatchObject({ saved: true });
    // 无 DDL 表在 sqlite 模式必须走 hydrate，且授权 runtime fallback（与 table-import-service 语义一致）。
    expect(mocks.hydrateStrict).toHaveBeenCalledTimes(1);
    expect(mocks.hydrateStrict).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ allowRuntimeDdlFallback: true }),
    );
    expect(mocks.saveStrict).toHaveBeenCalledOnce();
  });
