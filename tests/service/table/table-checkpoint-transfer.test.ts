import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[], providerData: null as any, templateData: null as any, guideData: null as any, scope: { version: 1, old: true } as any, guide: { version: 1, tags: {} } as any,
  strictSave: vi.fn(), clear: vi.fn(), cleanup: vi.fn().mockResolvedValue([]), replace: vi.fn(), restoreRuntime: vi.fn(), clearRuntime: vi.fn(), persist: vi.fn(), runtimeSnapshot: undefined as unknown, snapshotError: null as Error | null, hasClearRuntime: true, hasRestoreRuntime: true,
  peekScope: vi.fn(), peekGuide: vi.fn(),
  setScope: vi.fn(), setGuideContainer: vi.fn(), setScopeState: vi.fn(), setGuideData: vi.fn(), applyScope: vi.fn(), reload: vi.fn(), deleteGenerated: vi.fn(), refreshMerged: vi.fn(), sanitizeTemplate: vi.fn(), sqliteMode: false, storageMode: 'native' as 'native' | 'sqlite',
}));
vi.mock('../../../src/shared/utils', () => ({ hashUserInput_ACU: (input: string) => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}, logDebug_ACU: vi.fn(), parseTableTemplateJson_ACU: () => h.templateData }));
vi.mock('../../../src/data/storage/chat-history', () => ({
  peekChatScopedConfigContainer_ACU: h.peekScope, peekChatSheetGuideContainer_ACU: h.peekGuide,
  setChatScopedConfigContainer_ACU: (_: any, value: any) => { h.scope = value; h.setScope(value); },
  setChatSheetGuideContainer_ACU: (_: any, value: any) => { h.guide = value; h.setGuideContainer(value); },
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ saveChatToHostStrict_ACU: h.strictSave }));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => h.chat, clearAllAiTableDataForCheckpointRestore_ACU: h.clear, cleanupCheckpointVectorIndexManifestsAfterCommit_ACU: h.cleanup }));
vi.mock('../../../src/service/runtime/state-manager', () => ({ getCurrentIsolationKey_ACU: () => '' }));
vi.mock('../../../src/service/settings/settings-service', () => ({ applyTemplateScopeForCurrentChat_ACU: h.applyScope }));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ deleteAllGeneratedEntries_ACU: h.deleteGenerated, refreshMergedDataAndNotify_ACU: h.refreshMerged }));
vi.mock('../../../src/service/table/storage-mode', () => ({ isSqliteMode: () => h.sqliteMode }));
vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatTemplateScopeStateFromCurrent_ACU: (options: any) => ({ mode: 'chat_override', templateStr: JSON.stringify(options.templateSource) }), getChatSheetGuideDataForIsolationKey_ACU: () => h.guideData, getCurrentChatTemplateScopeState_ACU: () => h.scope,
  normalizeGuideData_ACU: (data: any) => data, sanitizeChatSheetsObject_ACU: (data: any) => data,
  sanitizeTemplateSnapshotForChat_ACU: h.sanitizeTemplate,
  setChatSheetGuideDataForIsolationKey_ACU: (_: any, data: any) => { h.guideData = data; h.setGuideData(data); return true; }, setCurrentChatTemplateScopeState_ACU: (state: any) => { h.scope = state; h.setScopeState(state); return true; },
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({ getStorageProvider: () => ({ mode: h.storageMode, getCurrentData: () => h.providerData, replaceAllData: h.replace, ...(h.hasRestoreRuntime ? { restoreRuntimeSnapshot: h.restoreRuntime } : {}), ...(h.hasClearRuntime ? { clearRuntimeData: h.clearRuntime } : {}), createRuntimeSnapshot: () => { if (h.snapshotError) throw h.snapshotError; return h.runtimeSnapshot; } }), getActiveStorageProvider: () => ({ mode: h.storageMode, getCurrentData: () => h.providerData }), reloadStorageProvider: h.reload }));
vi.mock('../../../src/service/table/table-history', () => ({ getLatestAiMessageIndexFromChat_ACU: (chat: any[]) => chat.map((m, i) => !m.is_user ? i : -1).filter(i => i >= 0).pop() ?? -1 }));
vi.mock('../../../src/service/table/table-service', () => ({ persistTablesToChatMessage_ACU: h.persist }));
vi.mock('../../../src/service/table/table-write-transaction', () => ({ runTableWriteTransaction_ACU: async (_: any, task: any) => task({ runCommit: async (fn: any) => fn(), assertFresh: vi.fn() }) }));

import { buildCurrentTableCheckpoint_ACU, parseTableCheckpointFile_ACU, restoreTableCheckpointToLatestAi_ACU } from '../../../src/service/table/table-checkpoint-transfer';

const data = { mate: { type: 'acu', version: 1 }, sheet_0: { name: '表', content: [['row_id'], ['1']] } };
const canonicalize = (value: any): any => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.keys(value).sort().reduce((out: any, key) => ({ ...out, [key]: canonicalize(value[key]) }), {}) : value;
const payloadHash = (payload: any) => {
  const input = JSON.stringify(canonicalize(payload));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
};
const signCheckpoint = (payload: any) => ({ ...payload, integrity: { algorithm: 'fnv1a', payloadHash: payloadHash(payload) } });
const checkpoint = signCheckpoint({ format: 'acu-table-checkpoint', version: 1, createdAt: 1, source: { storageMode: 'native' }, tableSnapshot: data, templateSnapshot: { data, presetName: '预设' }, guideSnapshot: { data } }) as any;

describe('table checkpoint transfer', () => {
  beforeEach(() => { vi.clearAllMocks(); h.chat = [{ is_user: true }, { is_user: false, TavernDB_ACU_Data: { old: true } }]; h.providerData = null; h.templateData = data; h.guideData = data; h.runtimeSnapshot = undefined; h.snapshotError = null; h.hasClearRuntime = true; h.hasRestoreRuntime = true; h.sqliteMode = false; h.storageMode = 'native'; h.scope = { version: 1, old: true }; h.guide = { version: 1, tags: {} }; h.peekScope.mockImplementation(() => h.scope); h.peekGuide.mockImplementation(() => h.guide); h.sanitizeTemplate.mockImplementation((source: any) => { const templateObj = typeof source === 'string' ? JSON.parse(source) : JSON.parse(JSON.stringify(source)); return { templateObj, templateStr: JSON.stringify(templateObj) }; }); h.replace.mockImplementation(async (next: any) => { h.providerData = next; return { success: true }; }); h.persist.mockResolvedValue({ saved: true, messageIndex: 1 }); h.clear.mockImplementation(async () => { delete h.chat[1].TavernDB_ACU_Data; return { clearedCount: 1, vectorManifestsToDeleteAfterCommit: [] }; }); h.setScopeState.mockImplementation((state: any) => { h.scope = state; return true; }); });
  it('在解析阶段拒绝非法 JSON、危险键与完整性不匹配', () => { expect(parseTableCheckpointFile_ACU('{')).toMatchObject({ success: false }); expect(parseTableCheckpointFile_ACU('{"format":"acu-table-checkpoint","__proto__":{}}')).toMatchObject({ success: false }); expect(parseTableCheckpointFile_ACU(JSON.stringify({ ...checkpoint, integrity: { algorithm: 'fnv1a', payloadHash: 'bad' } }))).toMatchObject({ success: false }); });
  it('在解析阶段拒绝与运行时表头不一致的指导表', () => { const mismatched = { ...checkpoint, guideSnapshot: { data: { ...data, sheet_0: { ...data.sheet_0, content: [['row_id', '额外列']] } } } }; expect(parseTableCheckpointFile_ACU(JSON.stringify(mismatched))).toMatchObject({ success: false }); });
  it('允许模板和指导表包含尚未物化到运行时的表', () => { const deferredSheet = { name: '未物化表', content: [['row_id', '名称']] }; const valid = signCheckpoint({ ...checkpoint, integrity: undefined, templateSnapshot: { ...checkpoint.templateSnapshot, data: { ...data, sheet_1: deferredSheet } }, guideSnapshot: { data: { ...data, sheet_1: deferredSheet } } }); expect(parseTableCheckpointFile_ACU(JSON.stringify(valid))).toMatchObject({ success: true }); });
  it('在解析阶段拒绝模板与指导表未知的运行时表', () => { const invalid = { ...checkpoint, tableSnapshot: { ...data, sheet_1: { name: '运行时孤儿表', content: [['row_id', '名称'], ['1', '孤儿数据']] } } }; expect(parseTableCheckpointFile_ACU(JSON.stringify(invalid))).toMatchObject({ success: false }); });
  it('在解析阶段拒绝模板与指导表的 sheet 集合分裂', () => { const invalid = { ...checkpoint, templateSnapshot: { ...checkpoint.templateSnapshot, data: { ...data, sheet_1: { name: '模板独有表', content: [['row_id']] } } } }; expect(parseTableCheckpointFile_ACU(JSON.stringify(invalid))).toMatchObject({ success: false }); });
  it('恢复预检使用纯读取快照，不通过 getter 隐式迁移 metadata', async () => { h.snapshotError = new Error('snapshot failed'); await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(h.peekScope).not.toHaveBeenCalled(); expect(h.peekGuide).not.toHaveBeenCalled(); h.snapshotError = null; h.hasClearRuntime = false; await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(h.peekScope).not.toHaveBeenCalled(); expect(h.peekGuide).not.toHaveBeenCalled(); h.hasClearRuntime = true; await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(h.peekScope).toHaveBeenCalledWith(h.chat); expect(h.peekGuide).toHaveBeenCalledWith(h.chat); });
  it('以一次严格 data_replace 保存完整 checkpoint，不把恢复帧标成已填表', async () => { const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: true, restoredMessageIndex: 1 }); expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ strictSave: true, source: 'import', checkpointReason: 'import', targetSheetKeys: ['sheet_0'], trackingSheetKeys: ['sheet_0'], trackAsUpdate: false, operations: [{ kind: 'data_replace', data, reason: 'checkpoint_fallback' }] })); expect(h.persist.mock.calls[0][0].filledSheetKeys).toBeUndefined(); expect(h.strictSave).not.toHaveBeenCalled(); });
  it('持久化失败时恢复聊天、scope、guide 与 provider 旧状态', async () => { h.providerData = { ...data, sheet_0: { ...data.sheet_0, name: '旧表' } }; h.persist.mockResolvedValue({ saved: false, error: 'strict failed' }); const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: false, error: 'strict failed' }); expect(h.chat[1].TavernDB_ACU_Data).toEqual({ old: true }); expect(h.setScope).toHaveBeenLastCalledWith({ version: 1, old: true }); expect(h.setGuideContainer).toHaveBeenLastCalledWith({ version: 1, tags: {} }); expect(h.replace).toHaveBeenLastCalledWith(h.providerData); expect(h.strictSave).toHaveBeenCalledTimes(1); expect(h.cleanup).not.toHaveBeenCalled(); });
  it('旧运行时为空且 SQLite snapshot 为 null 时明确清空 provider', async () => { h.runtimeSnapshot = null; h.persist.mockResolvedValue({ saved: false, error: 'strict failed' }); await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(h.clearRuntime).toHaveBeenCalledTimes(1); expect(h.restoreRuntime).not.toHaveBeenCalled(); expect(h.replace).toHaveBeenCalledTimes(1); });
  it('有效二进制快照在持久化失败后优先恢复且不回放 JSON', async () => { h.providerData = data; h.runtimeSnapshot = new Uint8Array([1, 2, 3]); h.persist.mockResolvedValue({ saved: false, error: 'strict failed' }); await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(h.restoreRuntime).toHaveBeenCalledWith(h.runtimeSnapshot); expect(h.replace).toHaveBeenCalledTimes(1); });
  it('缺少二进制快照恢复能力时在清理前拒绝', async () => { h.providerData = data; h.runtimeSnapshot = new Uint8Array([1]); h.hasRestoreRuntime = false; const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: false, error: expect.stringContaining('快照回滚') }); expect(h.clear).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled(); });
  it('快照捕获失败时返回受控错误且不执行破坏性操作', async () => { h.snapshotError = new Error('snapshot failed'); const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: false, error: 'snapshot failed' }); expect(h.clear).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled(); });
  it('缺少空运行时恢复能力时在清理前拒绝', async () => { h.hasClearRuntime = false; const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: false, error: expect.stringContaining('不支持') }); expect(h.clear).not.toHaveBeenCalled(); expect(h.persist).not.toHaveBeenCalled(); });
  it('回滚宿主保存失败时保留原始持久化错误和回滚错误', async () => { h.persist.mockResolvedValue({ saved: false, error: 'strict failed' }); h.strictSave.mockRejectedValueOnce(new Error('rollback host save failed')); const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: false, error: expect.stringContaining('strict failed') }); expect(result.error).toContain('rollback host save failed'); expect(h.strictSave).toHaveBeenCalledTimes(1); });
  it('核心提交后在 SQLite provider 完成派生刷新并返回实际后置条件', async () => { h.sqliteMode = true; h.storageMode = 'sqlite'; const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: true, postCondition: { runtimeMatches: true, scopeIsChatOverride: true, templateMatches: true, guideMatches: true, providerMode: 'sqlite' } }); expect(h.applyScope).toHaveBeenCalledTimes(1); expect(h.reload).toHaveBeenCalledTimes(1); expect(h.deleteGenerated).toHaveBeenCalledTimes(1); expect(h.refreshMerged).toHaveBeenCalledTimes(1); expect(h.cleanup).toHaveBeenCalledTimes(1); });
  it('templateMatches 将 scope 与 Checkpoint 模板分别交给同一 sanitizer', async () => { const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result.postCondition?.templateMatches).toBe(true); expect(h.sanitizeTemplate).toHaveBeenCalledWith(expect.any(String)); expect(h.sanitizeTemplate).toHaveBeenCalledWith(checkpoint.templateSnapshot.data); expect(h.sanitizeTemplate).toHaveBeenCalledTimes(2); });
  it('模板作用域快照不一致时返回部分成功告警', async () => { h.setScopeState.mockImplementation(() => { h.scope = { mode: 'chat_override', templateStr: JSON.stringify({ mate: data.mate, sheet_0: { ...data.sheet_0, name: '错误模板' } }) }; return true; }); const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: true, postCondition: { scopeIsChatOverride: true, templateMatches: false }, derivedRefreshWarnings: [expect.stringContaining('模板快照与 Checkpoint 模板不一致')] }); });
  it('派生刷新失败仅返回警告且不会触发核心补偿', async () => { h.refreshMerged.mockRejectedValueOnce(new Error('worldbook refresh failed')); const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint); expect(result).toMatchObject({ success: true, derivedRefreshWarnings: [expect.stringContaining('worldbook refresh failed')] }); expect(h.strictSave).not.toHaveBeenCalled(); expect(h.setScope).not.toHaveBeenCalled(); expect(h.setGuideContainer).not.toHaveBeenCalled(); });
  it('在构建阶段拒绝模板与指导表未知的运行时表', () => { h.providerData = { ...data, sheet_1: { name: '运行时孤儿表', content: [['row_id', '名称'], ['1', '孤儿数据']] } }; expect(() => buildCurrentTableCheckpoint_ACU()).toThrow(/tableSnapshot\.sheet_1/); });
  it('构建 checkpoint 保留 SQLite provider 来源', () => { h.providerData = data; h.storageMode = 'sqlite'; expect(buildCurrentTableCheckpoint_ACU().source).toEqual({ storageMode: 'sqlite' }); });
  it('在构建阶段允许模板与指导表包含尚未物化的表', () => { const deferredSheet = { name: '未物化表', content: [['row_id', '名称']] }; h.providerData = data; h.templateData = { ...data, sheet_1: deferredSheet }; h.guideData = { ...data, sheet_1: deferredSheet }; const built = buildCurrentTableCheckpoint_ACU(); expect(parseTableCheckpointFile_ACU(JSON.stringify(built))).toMatchObject({ success: true }); });
  it('构建成功的 Checkpoint 能重新通过解析校验', () => { h.providerData = data; const built = buildCurrentTableCheckpoint_ACU(); expect(parseTableCheckpointFile_ACU(JSON.stringify(built))).toMatchObject({ success: true }); });
  it('原哈希通过后修复历史尾标记、重签并保持 parse 到 restore 幂等', async () => {
    const legacyData = { mate: { type: 'acu', version: 1 }, sheet_3NoMc1wI: { name: '纪要表', content: [['row_id', '内容'], ['1', '旧纪要', 'auto_merged']] } };
    const legacy = signCheckpoint({ format: 'acu-table-checkpoint', version: 1, createdAt: 1, source: { storageMode: 'native' }, tableSnapshot: legacyData, templateSnapshot: { data: legacyData, presetName: '旧预设' }, guideSnapshot: { data: legacyData } });

    const parsed = parseTableCheckpointFile_ACU(JSON.stringify(legacy));
    expect(parsed).toMatchObject({ success: true });
    if (!parsed.success) throw new Error(parsed.error);
    expect(parsed.checkpoint.tableSnapshot.sheet_3NoMc1wI.content).toEqual([['row_id', '内容'], ['1', '旧纪要']]);
    expect(parsed.checkpoint.integrity.payloadHash).not.toBe(legacy.integrity.payloadHash);
    expect(parseTableCheckpointFile_ACU(JSON.stringify(parsed.checkpoint))).toMatchObject({ success: true });
    await expect(restoreTableCheckpointToLatestAi_ACU(parsed.checkpoint)).resolves.toMatchObject({ success: true });
  });

  it('原哈希不匹配或非目标行宽错误仍拒绝导入', () => {
    const legacyData = { mate: { type: 'acu', version: 1 }, sheet_3NoMc1wI: { name: '纪要表', content: [['row_id', '内容'], ['1', '旧纪要', 'auto_merged']] } };
    const validLegacy = signCheckpoint({ format: 'acu-table-checkpoint', version: 1, createdAt: 1, source: { storageMode: 'native' }, tableSnapshot: legacyData, templateSnapshot: { data: legacyData, presetName: '旧预设' }, guideSnapshot: { data: legacyData } });
    const nonMarkerData = { mate: { type: 'acu', version: 1 }, sheet_3NoMc1wI: { name: '纪要表', content: [['row_id', '内容'], ['1', '旧纪要', 'manual']] } };
    const nonMarker = signCheckpoint({ format: 'acu-table-checkpoint', version: 1, createdAt: 1, source: { storageMode: 'native' }, tableSnapshot: nonMarkerData, templateSnapshot: { data: nonMarkerData, presetName: '旧预设' }, guideSnapshot: { data: nonMarkerData } });

    expect(parseTableCheckpointFile_ACU(JSON.stringify({ ...validLegacy, tableSnapshot: nonMarkerData }))).toMatchObject({ success: false, error: expect.stringContaining('完整性校验失败') });
    expect(parseTableCheckpointFile_ACU(JSON.stringify(nonMarker))).toMatchObject({ success: false, error: expect.stringContaining('row_width_mismatch') });
  });

  it.each(['native', 'sqlite'] as const)('目标 %s 模板异构时仍完全以 checkpoint 快照恢复', async (storageMode) => {
    h.sqliteMode = storageMode === 'sqlite';
    h.storageMode = storageMode;
    h.providerData = { mate: { type: 'acu', version: 1 }, sheet_target: { name: '目标旧表', content: [['row_id', '旧列', '多余列'], ['1', '旧数据', 'x']] } };
    h.templateData = h.providerData;
    h.guideData = h.providerData;

    const result = await restoreTableCheckpointToLatestAi_ACU(checkpoint);

    expect(result).toMatchObject({ success: true, postCondition: { providerMode: storageMode, templateMatches: true, guideMatches: true } });
    expect(h.providerData).toEqual(data);
    expect(JSON.parse(h.scope.templateStr)).toEqual(data);
    expect(h.guideData).toEqual(data);
  });

});
