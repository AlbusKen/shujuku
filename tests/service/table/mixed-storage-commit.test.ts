import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatRef, saveStrict, scope, reload, storageMode, didFallback } = vi.hoisted(() => ({
  chatRef: { value: [] as any[] },
  saveStrict: vi.fn().mockResolvedValue(undefined),
  scope: { chatIdentifier: 'mixed-commit-test', isolationKey: '' },
  reload: vi.fn().mockResolvedValue(undefined),
  storageMode: { current: 'native' as 'native' | 'sqlite' },
  didFallback: vi.fn(() => false),
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: vi.fn(() => chatRef.value), saveChatToHostStrict_ACU: saveStrict, emitMessageUpdated_ACU: vi.fn() }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '', storageMode: 'native' },
  get currentChatFileIdentifier_ACU() { return scope.chatIdentifier; },
  getCurrentIsolationKey_ACU: vi.fn(() => scope.isolationKey),
}));
vi.mock('../../../src/service/table/storage-mode', () => ({ getCurrentStorageMode: vi.fn(() => storageMode.current) }));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: reload,
  didSqliteFallbackAfterReload_ACU: didFallback,
}));

import { commitMixedStorageDecision_ACU } from '../../../src/service/table/mixed-storage-commit';
import { evaluateMixedStorageDecision_ACU } from '../../../src/service/table/mixed-storage-decision';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';

function sheet(rows: string[][]) {
  return { uid: 'inventory', name: '背包', content: [['row_id', '名称'], ...rows], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } as any;
}
function buildChat(legacyData: any, v2Data: any, provenance = true, appendAi = false) {
  const claim = provenance ? {
    version: 1 as const, legacyDataFingerprint: getTableDataFingerprint_ACU(legacyData), legacySourceMessageIndices: [0], legacySourceAiFloors: [1],
    legacyLastChangedAiFloorBySheet: { sheet_0: 1 }, targetMessageIndex: 1, targetAiFloor: 2, isolationKey: '', migratedAt: 1,
  } : undefined;
  return [
    { is_user: false, TavernDB_ACU_Data: legacyData, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
    { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, headRevision: 'anchor-r1', checkpoint: { kind: 'full', createdAt: 1, reason: 'migration', data: v2Data, scheduleSummary: { sheet_0: { lastChangedAiFloor: 1 } }, migrationProvenance: claim }, logEntries: [] } } } },
    ...(appendAi ? [{ is_user: false, mes: 'post-anchor AI' }] : []),
  ];
}
async function decisionFor(chat: any[], legacyData: any) {
  return evaluateMixedStorageDecision_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyData });
}

describe('mixed-storage-commit', () => {
  beforeEach(() => {
    chatRef.value = [];
    saveStrict.mockReset();
    saveStrict.mockResolvedValue(undefined);
    reload.mockReset();
    reload.mockResolvedValue(undefined);
    scope.chatIdentifier = 'mixed-commit-test';
    scope.isolationKey = '';
    storageMode.current = 'native';
    didFallback.mockReset();
    didFallback.mockReturnValue(false);
  });

  it('仅清理 verified keep_v2 的 legacy 字段，保持 V2 frame 且严格保存一次', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    const v2Before = structuredClone(chatRef.value[1].TavernDB_ACU_IsolatedData[''].storageFrame);

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual({ status: 'committed', decisionId: decision.decisionId });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
    expect(chatRef.value[1].TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(v2Before);
    expect(chatRef.value[1].TavernDB_ACU_IsolatedData[''].mixedStorageDecisionBackup).toMatchObject({
      version: 1,
      action: 'keep_v2',
      legacyData: legacy,
      legacyFingerprint: getTableDataFingerprint_ACU(legacy),
      decisionId: decision.decisionId,
      decisionKind: 'equivalent_provenance_verified',
      sourceMessageIndices: [0],
      sourceAiFloors: [1],
    });
  });

  it('无 provenance 但业务投影与覆盖可验证时，以 keep_v2 提交并保留决议 backup', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy), false);
    const decision = await decisionFor(chatRef.value, legacy);

    expect(decision).toMatchObject({ kind: 'equivalent_projection_verified' });
    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual({ status: 'committed', decisionId: decision.decisionId });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
    expect(chatRef.value[1].TavernDB_ACU_IsolatedData[''].mixedStorageDecisionBackup).toMatchObject({
      version: 1,
      action: 'keep_v2',
      decisionId: decision.decisionId,
      decisionKind: 'equivalent_projection_verified',
      legacyData: legacy,
      legacyFingerprint: getTableDataFingerprint_ACU(legacy),
    });
  });

  it('只使用 frozen merge candidate 写入新 checkpoint 并保存一次', async () => {
    const legacy = { sheet_0: sheet([['1', '药水'], ['2', '卷轴']]) } as any;
    chatRef.value = buildChat(legacy, { sheet_0: sheet([['1', '药水']]) }, false, true);
    const decision = await decisionFor(chatRef.value, legacy);
    const candidate = structuredClone(decision.frozenMergeCandidate);

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'commit_merge_candidate', isolationConfig: { enabled: false, code: '' } });

    expect(result.status).toBe('committed');
    expect(saveStrict).toHaveBeenCalledTimes(1);
    const checkpoint = chatRef.value[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint;
    expect(checkpoint.data).toEqual(candidate);
    expect(checkpoint.migrationProvenance.legacySourceMessageIndices).toEqual([0]);
    expect(chatRef.value[2].TavernDB_ACU_IsolatedData[''].mixedStorageDecisionBackup).toMatchObject({
      version: 1,
      action: 'commit_merge_candidate',
      legacyData: legacy,
      legacyFingerprint: getTableDataFingerprint_ACU(legacy),
      decisionId: decision.decisionId,
      decisionKind: 'legacy_has_v2_missing_data',
    });
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
  });

  it('commit_merge_candidate 写新根后同事务降级旧 anchor full checkpoint（单根不变量）', async () => {
    const legacy = { sheet_0: sheet([['1', '药水'], ['2', '卷轴']]) } as any;
    const v2Data = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, v2Data, false, true);
    const decision = await decisionFor(chatRef.value, legacy);

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'commit_merge_candidate', isolationConfig: { enabled: false, code: '' } });

    expect(result.status).toBe('committed');
    // 新 migration 根在 #2；旧 anchor（#1）的 full checkpoint 必须已降级，否则形成多根
    const fullCheckpointIndices = chatRef.value
      .map((message: any, index: number) => message?.TavernDB_ACU_IsolatedData?.['']?.storageFrame?.checkpoint?.kind === 'full' ? index : -1)
      .filter((index: number) => index !== -1);
    expect(fullCheckpointIndices).toEqual([2]);
    // 降级无损：旧 checkpoint.data 保留为 seq ≤ 0 的 data_replace fallback entry
    const downgradedFrame = chatRef.value[1].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(downgradedFrame.checkpoint).toBeUndefined();
    expect(downgradedFrame.logEntries).toHaveLength(1);
    const fallbackEntry = downgradedFrame.logEntries[0];
    expect(fallbackEntry.seq).toBeLessThanOrEqual(0);
    expect(fallbackEntry.operations).toEqual([
      { kind: 'data_replace', data: v2Data, reason: 'checkpoint_fallback' },
    ]);
  });

  it('宿主保存失败时恢复 live chat', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    const before = structuredClone(chatRef.value);
    saveStrict.mockRejectedValueOnce(new Error('host write failed'));

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'commit_failed_rolled_back', error: expect.stringContaining('host write failed') });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chatRef.value).toEqual(before);
  });

  it('scope 或 evidence 漂移时不保存也不写入', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    const before = structuredClone(chatRef.value);
    chatRef.value[0].TavernDB_ACU_Data.sheet_0.content[1][1] = '已变化';

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'commit_failed_rolled_back', error: expect.stringContaining('evidence changed') });
    expect(saveStrict).not.toHaveBeenCalled();
    expect(chatRef.value[0].TavernDB_ACU_Data.sheet_0.content[1][1]).toBe('已变化');
    expect(chatRef.value).not.toEqual(before);
  });

  it('提交前 chat scope 漂移时零保存、零 mutation', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    const before = structuredClone(chatRef.value);
    scope.chatIdentifier = 'other-chat';

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'commit_failed_rolled_back', error: expect.stringContaining('identifier changed') });
    expect(saveStrict).not.toHaveBeenCalled();
    expect(chatRef.value).toEqual(before);
  });

  it('宿主保存成功后的 scope 漂移报告 postcondition failure 且不伪造回滚', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    saveStrict.mockImplementationOnce(async () => { scope.chatIdentifier = 'other-chat'; });

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'committed_postcondition_failed', error: expect.stringContaining('scope changed after host save') });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
  });

  it('拒绝 evaluator 未授权的 action，且不保存', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'commit_merge_candidate', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'commit_failed_rolled_back', error: expect.stringContaining('does not authorize') });
    expect(saveStrict).not.toHaveBeenCalled();
  });

  it('SQLite runtime reload 成功且未 fallback 时保持 committed', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    storageMode.current = 'sqlite';

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual({ status: 'committed', decisionId: decision.decisionId });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(didFallback).toHaveBeenCalledWith('sqlite');
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
  });

  it('保存成功后 SQLite runtime reload 失败时保留已提交 chat 并返回独立状态', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    storageMode.current = 'sqlite';
    reload.mockRejectedValueOnce(new Error('reload failed'));

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'committed_postcondition_failed', error: 'reload failed' });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
  });

  it('SQLite reload 静默 fallback 时保留已提交 chat 并报告后置条件失败', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    storageMode.current = 'sqlite';
    didFallback.mockReturnValueOnce(true);

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toMatchObject({ status: 'committed_postcondition_failed', error: expect.stringContaining('静默回退') });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(didFallback).toHaveBeenCalledWith('sqlite');
    expect(chatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
  });

  it('SQLite reload 执行期间设置切换为 native 时不误报 fallback', async () => {
    const legacy = { sheet_0: sheet([['1', '药水']]) } as any;
    chatRef.value = buildChat(legacy, structuredClone(legacy));
    const decision = await decisionFor(chatRef.value, legacy);
    storageMode.current = 'sqlite';
    reload.mockImplementationOnce(async () => { storageMode.current = 'native'; });
    didFallback.mockImplementationOnce(expectedMode => expectedMode === 'sqlite' && storageMode.current === 'sqlite');

    const result = await commitMixedStorageDecision_ACU({ decision, action: 'keep_v2', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual({ status: 'committed', decisionId: decision.decisionId });
    expect(saveStrict).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(didFallback).toHaveBeenCalledWith('sqlite');
    expect(storageMode.current).toBe('native');
  });
});
