/**
 * 复现：开局前端脚本在只有 AI 首楼的新聊天里通过 CRUD API 写行（SQLite 模式）。
 * 不 mock persist / replay / SQLite runtime，检查写入后聊天帧与填表基底是否包含这些行。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  settings: {
    storageMode: 'sqlite',
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    skipUpdateFloors: 0,
    updateBatchSize: 1,
  } as any,
  chatIdentifier: 'frontend-crud-chat',
  isolationKey: '',
  currentJsonTableData: null as any,
  isAutoUpdating: false,
  provider: null as any,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
  registerPostChatSaveListener_ACU: vi.fn(),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/repositories/chat-message-data-repo')>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn(() => {}),
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
    parseTableTemplateJson_ACU: vi.fn(() => JSON.parse(JSON.stringify(TEMPLATE))),
  };
});

vi.mock('../../../src/service/runtime/state-manager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/runtime/state-manager')>();
  return {
    ...actual,
    settings_ACU: mocks.settings,
    get currentChatFileIdentifier_ACU() { return mocks.chatIdentifier; },
    get isAutoUpdatingCard_ACU() { return mocks.isAutoUpdating; },
    getCurrentIsolationKey_ACU: vi.fn(() => mocks.isolationKey),
    get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
    _set_currentJsonTableData_ACU: vi.fn((value: any) => { mocks.currentJsonTableData = value; }),
  };
});

vi.mock('../../../src/data/storage/chat-history', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/data/storage/chat-history')>();
  return {
    ...actual,
    getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentifier),
  };
});

vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true),
  getCurrentStorageMode: vi.fn(() => 'sqlite'),
}));

vi.mock('../../../src/service/table/table-storage-strategy', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/table/table-storage-strategy')>();
  return {
    ...actual,
    ensureStorageProviderReady_ACU: vi.fn(async () => mocks.provider),
    getStorageProvider: vi.fn(() => mocks.provider),
    getActiveStorageProvider: vi.fn(() => mocks.provider),
    reloadStorageProvider: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn(),
  loadAllChatMessages_ACU: vi.fn(),
  updateReadableLorebookEntry_ACU: vi.fn(),
}));

const TEMPLATE = {
  mate: { type: 'chatSheets', version: 1 },
  sheet_tong_shi: {
    uid: 'sheet_tong_shi',
    name: '同事状态表',
    sourceData: { ddl: 'CREATE TABLE tongshizhuangtaibiao (row_id INTEGER PRIMARY KEY, name TEXT UNIQUE, affection TEXT);' },
    content: [['row_id', 'name', 'affection']],
    updateConfig: {}, exportConfig: {}, orderNo: 0,
  },
};

import { SqlTableService } from '../../../src/service/table/sql-table-service';
import { runSqliteRuntimeMutationCommit_ACU } from '../../../src/service/table/table-update-commit';
import { loadTableStateFromFramesV2Detailed_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import { readIsolatedTagData_ACU } from '../../../src/data/repositories/chat-message-data-repo';
import { flushRuntimeOnlyPendingChanges_ACU } from '../../../src/service/table/runtime-only-pending-flush';
import { clearRuntimeOnlyPendingSheets_ACU, readRuntimeOnlyPendingSheets_ACU } from '../../../src/service/table/runtime-only-pending-state';
import { _set_currentChatFileIdentifier_ACU } from '../../../src/service/runtime/state-manager';

const pendingScope = () => ({ chatKey: mocks.chatIdentifier, isolationKey: '' });

async function frontendInsertRow(name: string, affection: string, extra: Record<string, any> = {}) {
  return runSqliteRuntimeMutationCommit_ACU<number>({
    source: 'manual_crud',
    reason: 'insertRow:sqlite',
    isolationKey: mocks.isolationKey,
    writeSet: [{ kind: 'sheet', sheetKey: 'sheet_tong_shi' }],
    revisionWriteSet: [{ kind: 'sheet', sheetKey: 'sheet_tong_shi' }],
    initialData: mocks.currentJsonTableData,
    targetMessageIndex: 0,
    targetSheetKeys: ['sheet_tong_shi'],
    updateGroupKeys: null,
    trackingSheetKeys: [],
    trackAsUpdate: false,
    sql: 'INSERT INTO `tongshizhuangtaibiao` (`name`, `affection`) VALUES (?, ?);',
    params: [name, affection],
    mapValue: ({ tableData }) => (tableData as any).sheet_tong_shi.content.length - 1,
    ...extra,
  });
}

describe('前端 CRUD 写入的真实持久化链路', () => {
  beforeEach(async () => {
    clearRuntimeOnlyPendingSheets_ACU();
    // src 模块通过 live binding 读取 chatKey；vitest 对 importOriginal 展开后的 let 导出不保证 getter 生效，直接写实际值。
    _set_currentChatFileIdentifier_ACU(mocks.chatIdentifier);
    mocks.chat.length = 0;
    mocks.chat.push({ is_user: false, mes: '开局选择器（首楼）' });
    mocks.saveChat.mockClear();
    mocks.currentJsonTableData = JSON.parse(JSON.stringify(TEMPLATE));
    mocks.provider = new SqlTableService();
    const load = await mocks.provider.loadFromData(JSON.parse(JSON.stringify(TEMPLATE)));
    expect(load.error).toBeUndefined();
  });

  it('普通 insertRow：帧应落盘且回放到首楼能看到行', async () => {
    const first = await frontendInsertRow('黑泽刹那', '15');
    expect(first.success).toBe(true);
    const second = await frontendInsertRow('星野桃', '20');
    expect(second.success).toBe(true);

    const tag = readIsolatedTagData_ACU(mocks.chat[0], '') as any;
    expect(tag?.storageFrame?.checkpoint?.kind).toBe('full');
    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, '', { maxMessageIndex: 0, updateRuntimeState: false });
    expect(replay?.data?.sheet_tong_shi?.content).toEqual([
      ['row_id', 'name', 'affection'],
      ['1', '黑泽刹那', '15'],
      ['2', '星野桃', '20'],
    ]);
    expect(mocks.provider.getCurrentData().sheet_tong_shi.content).toEqual(replay?.data?.sheet_tong_shi?.content);
  });

  it('skipChatSave（isImportMode）写入：楼层无帧、行只在运行时；填表前写回后聊天追上运行时', async () => {
    const first = await frontendInsertRow('黑泽刹那', '15', { skipChatSave: true });
    expect(first.success).toBe(true);
    const second = await frontendInsertRow('星野桃', '20', { skipChatSave: true });
    expect(second.success).toBe(true);

    // 用户看到的现象：数据库里有行、楼层帧里没有对应数据。
    expect(readIsolatedTagData_ACU(mocks.chat[0], '')).toBeNull();
    expect(mocks.provider.getCurrentData().sheet_tong_shi.content).toHaveLength(3);
    expect(readRuntimeOnlyPendingSheets_ACU(pendingScope())).toEqual({ all: false, sheetKeys: ['sheet_tong_shi'] });

    const flush = await flushRuntimeOnlyPendingChanges_ACU('processUpdatesBatch');
    expect(flush).toMatchObject({ flushed: true, sheetKeys: ['sheet_tong_shi'], messageIndex: 0 });
    expect(readRuntimeOnlyPendingSheets_ACU(pendingScope())).toBeNull();

    const tag = readIsolatedTagData_ACU(mocks.chat[0], '') as any;
    expect(tag?.storageFrame?.checkpoint?.kind).toBe('full');
    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, '', { maxMessageIndex: 0, updateRuntimeState: false });
    expect(replay?.data?.sheet_tong_shi?.content).toEqual([
      ['row_id', 'name', 'affection'],
      ['1', '黑泽刹那', '15'],
      ['2', '星野桃', '20'],
    ]);

    // 再次写回：运行时与聊天一致，不再产生新的帧写入。
    expect(await flushRuntimeOnlyPendingChanges_ACU('again')).toEqual({ flushed: false, sheetKeys: [] });
  });

  it('skipChatSave 写入后的普通写入会先把之前的运行时行一并落盘（已有 checkpoint 时也成立）', async () => {
    // 先用一次普通写入建立 init checkpoint，之后的 skipChatSave 行就不能再靠「首次 checkpoint 全量快照」顺带落盘。
    expect((await frontendInsertRow('金城理奈', '10')).success).toBe(true);
    expect((await frontendInsertRow('黑泽刹那', '15', { skipChatSave: true })).success).toBe(true);
    expect(readRuntimeOnlyPendingSheets_ACU(pendingScope())).toEqual({ all: false, sheetKeys: ['sheet_tong_shi'] });

    const persisted = await frontendInsertRow('星野桃', '20');
    expect(persisted.success).toBe(true);
    expect(readRuntimeOnlyPendingSheets_ACU(pendingScope())).toBeNull();

    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, '', { maxMessageIndex: 0, updateRuntimeState: false });
    expect(replay?.data?.sheet_tong_shi?.content).toEqual([
      ['row_id', 'name', 'affection'],
      ['1', '金城理奈', '10'],
      ['2', '黑泽刹那', '15'],
      ['3', '星野桃', '20'],
    ]);
    const frame = (readIsolatedTagData_ACU(mocks.chat[0], '') as any).storageFrame;
    expect(frame.logEntries.some((entry: any) => entry.source === 'system'
      && entry.operations.some((operation: any) => operation.kind === 'sheet_replace' && operation.sheetKey === 'sheet_tong_shi'))).toBe(true);
  });
});
