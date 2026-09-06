import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[], save: vi.fn().mockResolvedValue(undefined),
  scope: { chatKey: 'recovery-test', isolationKey: '' },
  storageMode: 'native' as 'native' | 'sqlite',
  reload: vi.fn().mockResolvedValue(undefined),
  didFallback: vi.fn(() => false),
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: () => h.storageMode,
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: h.reload,
  didSqliteFallbackAfterReload_ACU: h.didFallback,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHostStrict_ACU: h.save,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '', storageMode: 'native' },
  get currentChatFileIdentifier_ACU() { return h.scope.chatKey; },
  getCurrentIsolationKey_ACU: () => h.scope.isolationKey,
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: async (_options: any, task: any) => task({ runCommit: async (commit: any) => commit() }),
}));

import { commitPreparedV2Recovery_ACU, prepareV2Recovery_ACU, scanV2IsolationDiagnostics_ACU } from '../../../src/service/table/table-v2-recovery-service';
import { loadTableStateFromFramesV2_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import * as storageFrameV2Replay from '../../../src/service/table/storage-frame-v2-replay';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';


function data(rows: any[][] = [['1', '铁剑']]) {
  return { mate: { type: 'acu', version: 1 }, sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '名称'], ...rows], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } } as any;
}
function frame(checkpoint: any, logEntries: any[] = []) {
  return { version: 2, checkpoint, logEntries };
}
function chatWithFrame(storageFrame: any) {
  return [{ is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame } } }];
}

describe('table-v2-recovery-service', () => {
  beforeEach(() => {
    h.chat = [];
    h.save.mockReset();
    h.save.mockResolvedValue(undefined);
    h.scope.chatKey = 'recovery-test';
    h.scope.isolationKey = '';
    h.storageMode = 'native';
    h.reload.mockReset();
    h.reload.mockResolvedValue(undefined);
    h.didFallback.mockReset();
    h.didFallback.mockReturnValue(false);
  });

  it('扫描全部 V2 isolationKey 只返回诊断，不创建恢复计划或触发持久化副作用', async () => {
    h.scope.isolationKey = 'beta';
    h.chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        alpha: { _acu_storage_version: 2, storageFrame: frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) }) },
        beta: { _acu_storage_version: 2, storageFrame: frame(undefined, [{ seq: 1, entryId: 'log-only', createdAt: 1, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'row_delete', sheetKey: 'sheet_0', rowId: '1' }] }]) },
      },
    }];
    const before = structuredClone(h.chat);

    const diagnostics = await scanV2IsolationDiagnostics_ACU();

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ isolationKey: 'alpha', status: 'recoverable_repaired_checkpoint', isCurrentIsolation: false }),
      expect.objectContaining({ isolationKey: 'beta', status: 'unrecoverable_no_base', isCurrentIsolation: true }),
    ]));
    expect(h.chat).toEqual(before);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    await expect(commitPreparedV2Recovery_ACU('not-created-by-scan')).resolves.toMatchObject({
      status: 'commit_failed_rolled_back', error: expect.stringContaining('不存在或已失效'),
    });
  });

  it('修复重复 row_id checkpoint，持久化原 frame 备份并生成 integrity_repair anchor', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    const prepared = await prepareV2Recovery_ACU();

    expect(prepared).toMatchObject({ status: 'recoverable_repaired_checkpoint', requiresConfirmation: false });
    const result = await commitPreparedV2Recovery_ACU(prepared.planId!);
    const tag = h.chat[0].TavernDB_ACU_IsolatedData[''];

    expect(result).toEqual({ status: 'committed', planId: prepared.planId });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(tag.storageFrame.checkpoint.reason).toBe('integrity_repair');
    expect(tag.recoveryBackup.storageFrame).toEqual(source);
    expect(h.reload).not.toHaveBeenCalled();
    await expect(loadTableStateFromFramesV2_ACU(h.chat, '', { updateRuntimeState: false })).resolves.toBeTruthy();
  });

  it('重复 row_id 与可尾部补齐短行共存时可生成恢复候选，短行不引入身份引用歧义', async () => {
    const checkpointData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory', name: '背包',
        content: [['row_id', '名称', '备注'], ['1', '铁剑', '完整'], [' 1 ', '副本']],
        sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: checkpointData });
    h.chat = chatWithFrame(source);

    const prepared = await prepareV2Recovery_ACU();

    expect(prepared).toMatchObject({ status: 'recoverable_repaired_checkpoint', requiresConfirmation: false });
    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });
    const repaired = h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0.content;
    expect(repaired).toEqual([
      ['row_id', '名称', '备注'],
      ['1', '铁剑', '完整'],
      ['2', '副本', null],
    ]);
  });

  it('健康 full checkpoint 的历史 SQL 依赖临时 Sheet 补锚时，生成并提交严格可回放的收敛 checkpoint', async () => {
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state', name: '全局数据表',
        content: [['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'], ['99', '模板示例', '0分', '模板时间']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, prev_scene_time TEXT, elapsed_time TEXT, cur_time TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    } as any;
    const source = frame(
      { kind: 'full', createdAt: 1, reason: 'init', data: data() },
      [{
        seq: 1, entryId: 'missing-global-sheet', createdAt: 2, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
        filledSheetKeys: ['sheet_global'], changedSheetKeys: ['sheet_global'], groupKeys: [],
        operations: [{
          kind: 'sql_sheet_batch', sheetKey: 'sheet_global', tableName: 'quanjushujubiao',
          statements: ["INSERT INTO quanjushujubiao (row_id, prev_scene_time, elapsed_time, cur_time) VALUES (1, '2026-08-07 00:15', '5分', '2026-08-07 00:20')"],
          reason: 'system',
        }],
      }],
    );
    h.chat = [{
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: { '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) } },
      },
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: source } },
    }];

    const prepared = await prepareV2Recovery_ACU();
    expect(prepared).toMatchObject({
      status: 'recoverable_temporary_sheet_anchor',
      requiresConfirmation: false,
      sourceMessageIndex: 0,
      affectedSheetKeys: ['sheet_global'],
      compatibilityRepairs: [expect.objectContaining({
        kind: 'temporary_sheet_anchor', sheetKey: 'sheet_global', messageIndex: 0, seq: 1, operationIndex: 0,
      })],
    });
    expect(prepared.message).toContain('sheet_global');
    expect(prepared.message).toContain('#0/seq=1/op=0');
    expect(prepared.message).toContain('自动收敛');

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });
    const tag = h.chat[0].TavernDB_ACU_IsolatedData[''];
    expect(tag.storageFrame.checkpoint).toMatchObject({ kind: 'full', reason: 'integrity_repair' });
    expect(tag.storageFrame.logEntries).toEqual([]);
    expect(tag.storageFrame.checkpoint.data.sheet_global.content).toEqual([
      ['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'],
      ['1', '2026-08-07 00:15', '5分', '2026-08-07 00:20'],
    ]);
    expect(tag.storageFrame.checkpoint.data.sheet_global.content).not.toContainEqual(['99', '模板示例', '0分', '模板时间']);
    expect(tag.recoveryBackup).toMatchObject({ recoveryKind: 'temporary_sheet_anchor_convergence', storageFrame: source });
    const strictReplay = await storageFrameV2Replay.loadTableStateFromFramesV2Detailed_ACU(h.chat, '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(strictReplay?.requiresCheckpointConvergence).toBeUndefined();
    expect(strictReplay?.compatibilityRepairs).toBeUndefined();
  });

  it('模板临时根数据完整时仅作为可升级根诊断，不创建修复计划或写入', async () => {
    const templateRoot = frame({
      kind: 'full', createdAt: 1, reason: 'manual', data: data(),
      fallbackProvenance: {
        version: 1, kind: 'manual_refill_template_root', runId: 'manual-refill:test',
        isolationKey: '', targetSheetKeys: ['sheet_0'], rangeStartMessageIndex: 0,
        rangeEndMessageIndex: 0, templateFingerprint: 'fnv1a:test', createdAt: 1,
      },
    });
    h.chat = chatWithFrame(templateRoot);

    const summary = await prepareV2Recovery_ACU();

    expect(summary).toMatchObject({
      status: 'unrecoverable',
      requiresConfirmation: false,
      message: expect.stringContaining('模板临时根'),
    });
    expect(summary.planId).toBeUndefined();
    expect(h.save).not.toHaveBeenCalled();
  });


  it('较晚 canonical checkpoint 两侧均有 replay artifact 时给出人工恢复引导且零写入', async () => {
    const logEntry = (entryId: string, targetMessageIndex: number) => ({
      seq: 1, entryId, createdAt: 1, source: 'system', targetMessageIndex, aiFloor: targetMessageIndex + 1,
      filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
      operations: [{ kind: 'data_replace', data: data([[String(targetMessageIndex + 1), entryId]]), reason: 'system' }],
    });
    h.chat = [
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, [logEntry('discarded-prefix', 0)]) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame({ kind: 'full', createdAt: 2, reason: 'init', data: data() }) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, [logEntry('unsafe-suffix', 2)]) } } },
    ];

    const summary = await prepareV2Recovery_ACU();

    expect(summary).toMatchObject({
      status: 'unrecoverable_late_checkpoint_artifacts',
      sourceMessageIndex: 1,
      requiresConfirmation: false,
      message: expect.stringContaining('自动前移会改变后缀回放语义'),
    });
    expect(summary.planId).toBeUndefined();
    expect(h.save).not.toHaveBeenCalled();
  });


  it('后续 operation 引用被重复身份修复重映射的 row_id 时拒绝猜测', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    h.chat.push({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: frame(undefined, [{
            seq: 1, entryId: 'ambiguous-row-id', createdAt: 2, source: 'system', targetMessageIndex: 1, aiFloor: 1,
            filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
            operations: [{ kind: 'row_delete', sheetKey: 'sheet_0', rowId: '1' }],
          }]),
        },
      },
    });

    expect(await prepareV2Recovery_ACU()).toMatchObject({
      status: 'unrecoverable',
      message: expect.stringContaining('重复 row_id 修复会改变后续引用的语义'),
    });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('后续 SQL operation 绑定被重映射的 row_id 时拒绝猜测', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    h.chat.push({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: frame(undefined, [{
            seq: 1, entryId: 'ambiguous-sql-row-id', createdAt: 2, source: 'system', targetMessageIndex: 1, aiFloor: 1,
            filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [],
            operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: ['DELETE FROM inventory WHERE row_id = ?'], params: [['1']] }],
          }]),
        },
      },
    });

    expect(await prepareV2Recovery_ACU()).toMatchObject({
      status: 'unrecoverable',
      message: expect.stringContaining('重复 row_id 修复会改变后续引用的语义'),
    });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('孤立 data_replace 需要明确确认，未确认时零写入零保存', async () => {
    const source = frame(undefined, [{ seq: 1, entryId: 'replace', createdAt: 1, source: 'import', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [], operations: [{ kind: 'data_replace', data: data(), reason: 'import' }] }]);
    h.chat = chatWithFrame(source);
    const before = structuredClone(h.chat);
    const prepared = await prepareV2Recovery_ACU();

    expect(prepared).toMatchObject({ status: 'recoverable_orphan_data_replace', requiresConfirmation: true });
    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({ status: 'commit_failed_rolled_back', error: expect.stringContaining('必须显式确认') });
    expect(h.chat).toEqual(before);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('宿主严格保存失败时恢复 live chat', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    const before = structuredClone(h.chat);
    const prepared = await prepareV2Recovery_ACU();
    h.save.mockRejectedValueOnce(new Error('host write failed'));

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
      status: 'commit_failed_rolled_back', error: expect.stringContaining('host write failed'),
    });
    expect(h.chat).toEqual(before);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.reload).not.toHaveBeenCalled();

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it('恢复候选 replay 校验失败时不保存且不改写 live chat', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    const before = structuredClone(h.chat);
    const prepared = await prepareV2Recovery_ACU();
    const replaySpy = vi.spyOn(storageFrameV2Replay, 'loadTableStateFromFramesV2Detailed_ACU').mockRejectedValueOnce(new Error('candidate replay failed'));

    try {
      await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
        status: 'commit_failed_rolled_back', error: expect.stringContaining('候选 replay 校验失败'),
      });
      expect(h.chat).toEqual(before);
      expect(h.save).not.toHaveBeenCalled();
      expect(h.reload).not.toHaveBeenCalled();
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('SQLite 恢复保存后重载 provider', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    h.storageMode = 'sqlite';
    const prepared = await prepareV2Recovery_ACU();

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.didFallback).toHaveBeenCalledWith('sqlite');
  });

  it('SQLite provider 重载失败时保留已保存恢复结果并报告后置条件失败', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    h.storageMode = 'sqlite';
    const prepared = await prepareV2Recovery_ACU();
    h.reload.mockRejectedValueOnce(new Error('sqlite reload failed'));

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
      status: 'committed_postcondition_failed', planId: prepared.planId, error: expect.stringContaining('sqlite reload failed'),
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.reason).toBe('integrity_repair');
  });

  it('SQLite reload 静默 fallback 时保留已保存恢复结果并报告后置条件失败', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    h.storageMode = 'sqlite';
    h.didFallback.mockReturnValueOnce(true);
    const prepared = await prepareV2Recovery_ACU();

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
      status: 'committed_postcondition_failed', planId: prepared.planId, error: expect.stringContaining('静默回退'),
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.didFallback).toHaveBeenCalledWith('sqlite');
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.reason).toBe('integrity_repair');
  });

  it('SQLite reload 执行期间设置切换为 native 时不误报 fallback', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    h.storageMode = 'sqlite';
    h.reload.mockImplementationOnce(async () => { h.storageMode = 'native'; });
    h.didFallback.mockImplementationOnce(expectedMode => expectedMode === 'sqlite' && h.storageMode === 'sqlite');
    const prepared = await prepareV2Recovery_ACU();

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.didFallback).toHaveBeenCalledWith('sqlite');
    expect(h.storageMode).toBe('native');
  });

  it('计划生成后 chat identifier 或 isolation key 漂移时拒绝提交且零保存', async () => {
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) }));
    const before = structuredClone(h.chat);
    const prepared = await prepareV2Recovery_ACU();
    h.scope.chatKey = 'other-chat';

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({ status: 'commit_failed_rolled_back' });
    expect(h.chat).toEqual(before);
    expect(h.save).not.toHaveBeenCalled();
    h.scope.chatKey = 'recovery-test';
    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
      status: 'commit_failed_rolled_back', error: expect.stringContaining('不存在或已失效'),
    });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('同一作用域重新诊断会淘汰旧计划，仅最新计划可提交', async () => {
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) }));
    const first = await prepareV2Recovery_ACU();
    const second = await prepareV2Recovery_ACU();

    expect(first.planId).not.toBe(second.planId);
    await expect(commitPreparedV2Recovery_ACU(first.planId!)).resolves.toMatchObject({
      status: 'commit_failed_rolled_back', error: expect.stringContaining('不存在或已失效'),
    });
    await expect(commitPreparedV2Recovery_ACU(second.planId!)).resolves.toEqual({ status: 'committed', planId: second.planId });
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('恢复源 frame 漂移后使计划失效，旧计划不能覆盖新 frame', async () => {
    const source = frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) });
    h.chat = chatWithFrame(source);
    const prepared = await prepareV2Recovery_ACU();
    h.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame = frame({ kind: 'full', createdAt: 2, reason: 'init', data: data([['2', '新源']]) });

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
      status: 'commit_failed_rolled_back', error: expect.stringContaining('恢复源 frame 已变化'),
    });
    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toMatchObject({
      status: 'commit_failed_rolled_back', error: expect.stringContaining('不存在或已失效'),
    });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('可验证的坏 checkpoint 基底修复后保留并严格回放后缀 artifact', async () => {
    const invalidWithLog = frame(
      { kind: 'full', createdAt: 1, reason: 'init', data: data([['1', '铁剑'], [' 1 ', '副本']]) },
      [{ seq: 1, entryId: 'later', createdAt: 2, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'data_replace', data: data([['2', '后续']]), reason: 'system' }] }],
    );
    h.chat = chatWithFrame(invalidWithLog);
    const prepared = await prepareV2Recovery_ACU();
    expect(prepared).toMatchObject({
      status: 'recoverable_repaired_checkpoint',
      message: expect.stringContaining('保留并严格回放后缀 artifact'),
    });
    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });
    const tag = h.chat[0].TavernDB_ACU_IsolatedData[''];
    expect(tag.recoveryBackup).toMatchObject({ recoveryKind: 'repaired_full_checkpoint', storageFrame: invalidWithLog });
    expect(tag.storageFrame.logEntries).toEqual(invalidWithLog.logEntries);
    await expect(loadTableStateFromFramesV2_ACU(h.chat, '', { updateRuntimeState: false })).resolves.toEqual(data([['2', '后续']]));

    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: data() }));
    expect(await prepareV2Recovery_ACU()).toMatchObject({ status: 'unrecoverable', message: expect.stringContaining('无需恢复') });
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('纯无 base 日志保持不可恢复且零保存', async () => {
    h.chat = chatWithFrame(frame(undefined, [{ seq: 1, entryId: 'log-only', createdAt: 1, source: 'system', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [], operations: [{ kind: 'row_delete', sheetKey: 'sheet_0', rowId: '1' }] }]));
    expect(await prepareV2Recovery_ACU()).toMatchObject({ status: 'unrecoverable_no_base' });
    expect(h.save).not.toHaveBeenCalled();
  });



  it('P4-8 双 full (0,10) 收敛：仅保留末位 full，冗余帧降级为 data_replace fallback 且回放结果不变', async () => {
    const rootData = data([['1', '根层数据']]);
    const convergedData = data([['1', '根层数据'], ['2', '10 层累积']]);
    const rootFrame = frame({ kind: 'full', createdAt: 1, reason: 'init', data: rootData }, []);
    const lateFrame = frame({ kind: 'full', createdAt: 2, reason: 'integrity_repair', data: convergedData }, []);
    const beforeFingerprint = getTableDataFingerprint_ACU(await loadTableStateFromFramesV2_ACU([
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: rootFrame } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: lateFrame } } },
    ], '', { updateRuntimeState: false }));
    h.chat = [
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: rootFrame } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: frame(undefined, []) } } },
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: lateFrame } } },
    ];

    const prepared = await prepareV2Recovery_ACU();
    expect(prepared.status).toBe('recoverable_redundant_full_checkpoint');
    expect(prepared.planId).toBeDefined();
    expect(prepared.message).toContain('保留末位');
    expect(prepared.message).toContain('无损降级');

    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });

    const rootTag = h.chat[0].TavernDB_ACU_IsolatedData[''];
    expect(rootTag.storageFrame.checkpoint).toBeUndefined();
    expect(rootTag.storageFrame.logEntries[0].operations[0]).toMatchObject({ kind: 'data_replace', data: rootData });
    expect(rootTag.recoveryBackup).toMatchObject({ recoveryKind: 'redundant_full_checkpoint_convergence', storageFrame: rootFrame });

    const lateTag = h.chat[10].TavernDB_ACU_IsolatedData[''];
    expect(lateTag.storageFrame.checkpoint).toMatchObject({ kind: 'full', data: convergedData });

    const afterFingerprint = getTableDataFingerprint_ACU(await loadTableStateFromFramesV2_ACU(h.chat, '', { updateRuntimeState: false }));
    expect(afterFingerprint).toBe(beforeFingerprint);
  });

  it('冗余 full 降级保留原 logEntries/perSheetCheckpoints/手动重填进度与真实 aiFloor，回放指纹不变', async () => {
    const redundantData = data([['1', '第二根']]);
    const lateData = data([['1', '第二根'], ['3', '末位累积']]);
    const originalLog = {
      seq: 1,
      entryId: 'before-root',
      createdAt: 2,
      source: 'system' as const,
      targetMessageIndex: 2,
      aiFloor: 3,
      filledSheetKeys: ['sheet_0'],
      changedSheetKeys: [],
      groupKeys: [],
      operations: [],
    };
    const redundantFrame = {
      ...frame({ kind: 'full', createdAt: 1, reason: 'init', data: redundantData, event: { filledSheetKeys: ['sheet_0'], changedSheetKeys: [], groupKeys: [] } }, [originalLog]),
      perSheetCheckpoints: {
        sheet_0: {
          kind: 'sheet_full' as const,
          createdAt: 2,
          reason: 'schema_change' as const,
          sheetKey: 'sheet_0',
          data: redundantData.sheet_0,
          timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 2, afterSeq: 1 } as const,
        },
      },
      manualRefillProgress: {
        kind: 'manual_refill' as const,
        status: 'in_progress' as const,
        selectedSheetKeys: ['sheet_0'],
        contextMessageIndices: [0, 1, 2],
        originalStartMessageIndex: 0,
        targetMessageIndex: 2,
        batchSize: 10,
        completedUntilMessageIndex: 2,
      },
    } as any;
    const lateFrame = frame({ kind: 'full', createdAt: 2, reason: 'integrity_repair', data: lateData }, []);
    const buildChat = () => Array.from({ length: 11 }, (_, messageIndex) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2 as const,
          storageFrame: messageIndex === 2
            ? redundantFrame
            : messageIndex === 10 ? lateFrame : frame(undefined, []),
        },
      },
    }));

    const beforeFingerprint = getTableDataFingerprint_ACU(await loadTableStateFromFramesV2_ACU(buildChat(), '', { updateRuntimeState: false }));
    h.chat = buildChat();

    const prepared = await prepareV2Recovery_ACU();
    expect(prepared.status).toBe('recoverable_redundant_full_checkpoint');
    await expect(commitPreparedV2Recovery_ACU(prepared.planId!)).resolves.toEqual({ status: 'committed', planId: prepared.planId });

    const degradedTag = h.chat[2].TavernDB_ACU_IsolatedData[''];
    expect(degradedTag.storageFrame.checkpoint).toBeUndefined();
    expect(degradedTag.storageFrame.logEntries.map((entry: any) => entry.entryId)).toEqual(['before-root', 'redundant-full-fallback-2']);
    expect(degradedTag.storageFrame.logEntries[1]).toMatchObject({
      seq: 2,
      aiFloor: 3,
      filledSheetKeys: ['sheet_0'],
      changedSheetKeys: [],
      groupKeys: [],
    });
    expect(degradedTag.storageFrame.perSheetCheckpoints.sheet_0.timeline.kind).toBe('sheet_rebase');
    expect(degradedTag.storageFrame.manualRefillProgress).toMatchObject({ status: 'in_progress', targetMessageIndex: 2 });
    expect(degradedTag.recoveryBackup).toMatchObject({ recoveryKind: 'redundant_full_checkpoint_convergence', storageFrame: { checkpoint: { kind: 'full', data: redundantData } } });

    const afterFingerprint = getTableDataFingerprint_ACU(await loadTableStateFromFramesV2_ACU(h.chat, '', { updateRuntimeState: false }));
    expect(afterFingerprint).toBe(beforeFingerprint);
  });

  it('含双身份/物理表名冲突的 full checkpoint 诊断为 unrecoverable_identity_conflict 且零保存', async () => {
    const conflictData = {
      mate: { type: 'acu', version: 1 },
      sheet_legacy: { uid: 'bag', name: '背包', content: [['row_id', '名称'], ['1', '旧剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_beibao: { uid: 'bag2', name: '背包', content: [['row_id', '名称'], ['2', '新盾']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: conflictData }, []));

    const prepared = await prepareV2Recovery_ACU();

    expect(prepared.status).toBe('unrecoverable_identity_conflict');
    expect(prepared.affectedSheetKeys).toEqual(expect.arrayContaining(['sheet_legacy', 'sheet_beibao']));
    expect(prepared.message).toContain('identity_merge_failed');
    expect(prepared.message).toContain('heterogeneous_with_data');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('双身份分类：空壳冲突给出 empty_shell 且零保存', async () => {
    const conflictData = {
      mate: { type: 'acu', version: 1 },
      sheet_legacy: { uid: 'bag', name: '背包', content: [['row_id', '名称']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_beibao: { uid: 'bag2', name: '背包', content: [['row_id', '名称']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: conflictData }, []));

    const prepared = await prepareV2Recovery_ACU();

    expect(prepared.status).toBe('unrecoverable_identity_conflict');
    expect(prepared.message).toContain('empty_shell');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('双身份分类：等结构重复冲突给出 duplicate_structure 且零保存', async () => {
    const conflictData = {
      mate: { type: 'acu', version: 1 },
      sheet_legacy: { uid: 'bag', name: '背包', content: [['row_id', '名称'], ['1', '铁剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_beibao: { uid: 'bag2', name: '背包', content: [['row_id', '名称'], ['1', '铁剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: conflictData }, []));

    const prepared = await prepareV2Recovery_ACU();

    expect(prepared.status).toBe('unrecoverable_identity_conflict');
    expect(prepared.message).toContain('duplicate_structure');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('双身份分类：同结构但同 row_id 值不同给出 ambiguous_conflict 且零保存', async () => {
    const conflictData = {
      mate: { type: 'acu', version: 1 },
      sheet_legacy: { uid: 'bag', name: '背包', content: [['row_id', '名称'], ['1', '旧剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_beibao: { uid: 'bag2', name: '背包', content: [['row_id', '名称'], ['1', '新剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: conflictData }, []));

    const prepared = await prepareV2Recovery_ACU();

    expect(prepared.status).toBe('unrecoverable_identity_conflict');
    expect(prepared.message).toContain('ambiguous_conflict');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('双身份分类：同音不同表名给出 homophone_distinct_names 且零保存', async () => {
    const conflictData = {
      mate: { type: 'acu', version: 1 },
      sheet_beibao: { uid: 'bag', name: '背包', content: [['row_id', '名称'], ['1', '背包物品']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_beibao2: { uid: 'bag2', name: '被包', content: [['row_id', '名称'], ['2', '被包物品']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    h.chat = chatWithFrame(frame({ kind: 'full', createdAt: 1, reason: 'init', data: conflictData }, []));

    const prepared = await prepareV2Recovery_ACU();

    expect(prepared.status).toBe('unrecoverable_identity_conflict');
    expect(prepared.message).toContain('homophone_distinct_names');
    expect(prepared.message).toContain('被包');
    expect(h.save).not.toHaveBeenCalled();
  });

});

