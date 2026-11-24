/**
 * tests/integration/floor-delete-rollback-refill.test.ts
 * 端到端回归：新建对话 → 生成一楼 → 填表（自动/手动）→ 删除该楼 → 验证工作台与世界书回滚 → 重生成该楼后再次触发填表
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _set_SillyTavern_API_ACU,
  _set_TavernHelper_API_ACU,
  SillyTavern_API_ACU,
  TavernHelper_API_ACU,
} from '../../src/shared/host-api';
import {
  _set_coreApisAreReady_ACU,
  _set_currentChatFileIdentifier_ACU,
  _set_currentJsonTableData_ACU,
  _set_independentTableStates_ACU,
  _set_settings_ACU,
  coreApisAreReady_ACU,
  currentChatFileIdentifier_ACU,
  currentJsonTableData_ACU,
  independentTableStates_ACU,
  settings_ACU,
} from '../../src/service/runtime/state-manager';
import {
  __resetCheckpointDeleteGuardForTests_ACU,
  captureCheckpointVaultForCurrentChat_ACU,
  recoverLostCheckpointsAfterMessageDeletion_ACU,
} from '../../src/service/chat/checkpoint-delete-guard';
import { refreshMergedDataAndNotify_ACU } from '../../src/service/worldbook/pipeline';
import { buildAutoUpdatePlan_ACU } from '../../src/service/table/update-scheduler';
import {
  buildChatSheetGuideDataFromTemplateObj_ACU,
  setChatSheetGuideDataForIsolationKey_ACU,
} from '../../src/service/template/chat-scope';
import { TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU } from '../../src/shared/defaults-json.js';

const original = {
  host: SillyTavern_API_ACU,
  helper: TavernHelper_API_ACU,
  ready: coreApisAreReady_ACU,
  chatId: currentChatFileIdentifier_ACU,
  tables: currentJsonTableData_ACU,
  independent: independentTableStates_ACU,
  settings: settings_ACU,
  template: TABLE_TEMPLATE_ACU,
};

function makeEmptyTemplateData() {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_items: {
      uid: 'sheet_items',
      name: '物品表',
      orderNo: 0,
      content: [['row_id', '物品名', '数量']],
      sourceData: {
        ddl: 'CREATE TABLE items (row_id INTEGER PRIMARY KEY, item_name TEXT, qty TEXT);',
      },
      updateConfig: {
        uiSentinel: -1,
        contextDepth: -1,
        updateFrequency: -1,
        batchSize: -1,
        skipFloors: -1,
        sendLatestRows: -1,
        groupId: -1,
      },
      exportConfig: { enabled: false },
    },
  };
}

function makeFilledData(itemName: string) {
  const data = makeEmptyTemplateData();
  data.sheet_items.content.push(['1', itemName, '1']);
  return data;
}

function createInMemoryWorldbookHost() {
  let nextUid = 100;
  const books = new Map<string, any[]>([['CharBook', []]]);
  const getEntries = (book: string) => books.get(book) || [];
  const helper = {
    getCharWorldbookNames: vi.fn(async () => ({ primary: 'CharBook', additional: [] })),
    getCharLorebooks: vi.fn(async () => ({ primary: 'CharBook', additional: [] })),
    getCurrentCharPrimaryLorebook: vi.fn(async () => 'CharBook'),
    getLorebooks: vi.fn(async () => ['CharBook']),
    getLorebookEntries: vi.fn(async (book: string) => structuredClone(getEntries(book))),
    createLorebookEntries: vi.fn(async (book: string, entries: any[]) => {
      const list = getEntries(book);
      const created = entries.map(entry => ({ ...structuredClone(entry), uid: nextUid++ }));
      list.push(...created);
      books.set(book, list);
      return created.map(entry => entry.uid);
    }),
    setLorebookEntries: vi.fn(async (book: string, updates: any[]) => {
      const list = getEntries(book);
      for (const patch of updates) {
        const target = list.find(item => item.uid === patch.uid);
        if (target) Object.assign(target, structuredClone(patch));
      }
    }),
    deleteLorebookEntries: vi.fn(async (book: string, uids: number[]) => {
      const uidSet = new Set(uids);
      books.set(book, getEntries(book).filter(entry => !uidSet.has(entry.uid)));
    }),
    getChatMessages: vi.fn(async () => []),
  };
  return {
    helper,
    getBookEntries: (book = 'CharBook') => structuredClone(getEntries(book)),
  };
}

describe('删楼回滚表格与世界书并在重生成时重新填表（端到端）', () => {
  let chat: any[];
  let saveChat: ReturnType<typeof vi.fn>;
  let wb: ReturnType<typeof createInMemoryWorldbookHost>;

  function setupHost(initialChat: any[], options: { frequency?: number; skipFloors?: number } = {}) {
    chat = initialChat;
    saveChat = vi.fn(async () => undefined);
    wb = createInMemoryWorldbookHost();
    _set_SillyTavern_API_ACU({
      chat,
      chatId: 'chat-floor-delete-repro',
      characterId: 0,
      chatMetadata: {},
      saveChat,
      saveMetadata: vi.fn(async () => undefined),
    } as any);
    _set_TavernHelper_API_ACU(wb.helper as any);
    _set_coreApisAreReady_ACU(true);
    _set_currentChatFileIdentifier_ACU('chat-floor-delete-repro');
    _set_TABLE_TEMPLATE_ACU(JSON.stringify(makeEmptyTemplateData()));
    _set_settings_ACU({
      ...original.settings,
      dataIsolationEnabled: false,
      dataIsolationCode: '',
      autoUpdateEnabled: true,
      autoUpdateThreshold: 3,
      autoUpdateFrequency: options.frequency ?? 1,
      skipUpdateFloors: options.skipFloors ?? 0,
      updateBatchSize: 3,
      storageMode: 'native',
      worldbookConfig: {
        ...(original.settings as any)?.worldbookConfig,
        source: 'character',
        manualSelection: [],
        injectionTarget: 'character',
        enabledEntries: {},
      },
    } as any);
    _set_currentJsonTableData_ACU(null);
    _set_independentTableStates_ACU({});
    const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(makeEmptyTemplateData(), { stripSeedRows: false });
    if (guideData) {
      setChatSheetGuideDataForIsolationKey_ACU('', guideData, {
        reason: 'test_setup',
        syncTemplateScope: true,
        templateSource: JSON.stringify(makeEmptyTemplateData()),
      });
    }
    __resetCheckpointDeleteGuardForTests_ACU();
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetCheckpointDeleteGuardForTests_ACU();
    _set_SillyTavern_API_ACU(original.host);
    _set_TavernHelper_API_ACU(original.helper);
    _set_coreApisAreReady_ACU(original.ready);
    _set_currentChatFileIdentifier_ACU(original.chatId);
    _set_currentJsonTableData_ACU(original.tables);
    _set_independentTableStates_ACU(original.independent);
    _set_settings_ACU(original.settings);
    _set_TABLE_TEMPLATE_ACU(original.template);
  });

  it('场景 A：未预种 0 层时首次自动填表写入新楼 init full，删该楼后工作台和世界书全部回滚，重生成再次触发填表', async () => {
    const filled = makeFilledData('一楼长剑');
    setupHost([
      { is_user: false, mes: '开场白' },
      { is_user: true, mes: '玩家第一轮行动' },
      {
        is_user: false,
        mes: 'AI 第一楼正文',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'cp-init-1',
              checkpoint: {
                kind: 'full',
                createdAt: 1000,
                reason: 'init',
                data: filled,
                event: {
                  filledSheetKeys: ['sheet_items'],
                  changedSheetKeys: ['sheet_items'],
                  groupKeys: ['sheet_items'],
                },
              },
              logEntries: [],
            },
          },
        },
      },
    ], { frequency: 2, skipFloors: 0 });

    // 填表后同步保管库与世界书
    captureCheckpointVaultForCurrentChat_ACU(chat);
    await refreshMergedDataAndNotify_ACU();
    expect(currentJsonTableData_ACU?.sheet_items?.content).toHaveLength(2);
    expect(wb.getBookEntries().some(entry => entry.comment === 'TavernDB-ACU-ReadableDataTable' && entry.content.includes('一楼长剑'))).toBe(true);

    // 删除一楼 AI 回复
    chat.splice(2, 1);
    const guardResult = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(guardResult).toEqual({ recovered: false, graftedCount: 0 });
    expect(chat[0].TavernDB_ACU_IsolatedData).toBeUndefined();

    // 删楼后重放并刷新世界书
    await refreshMergedDataAndNotify_ACU();
    expect(currentJsonTableData_ACU?.sheet_items?.content).toEqual([['row_id', '物品名', '数量']]);
    expect(wb.getBookEntries().filter(entry => String(entry.comment || '').startsWith('TavernDB-ACU-'))).toEqual([]);

    // 重生成该楼后，调度必须再次安排填表（即使 frequency=2，因为上次更新楼层已回退为 0）
    chat.push({ is_user: false, mes: '重新生成的 AI 第一楼正文' });
    const plan = buildAutoUpdatePlan_ACU(chat, currentJsonTableData_ACU as any, settings_ACU, '');
    expect(plan.tablesToUpdate.map(item => item.sheetKey)).toEqual(['sheet_items']);
    expect(plan.tablesToUpdate[0].indices).toEqual([0, 2]);
  });

  it('场景 B：0 层已写入干净模板基线、一楼写入增量日志，删一楼后回滚到空基线且重生成再次填表', async () => {
    const emptyBase = makeEmptyTemplateData();
    const filled = makeFilledData('增量长剑');
    setupHost([
      {
        is_user: false,
        mes: '开场白',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'cp-seed-0',
              checkpoint: {
                kind: 'full',
                createdAt: 1000,
                reason: 'init',
                data: emptyBase,
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '玩家第一轮行动' },
      {
        is_user: false,
        mes: 'AI 第一楼正文',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: '1:fill-2',
              logEntries: [{
                seq: 1,
                entryId: 'fill-2',
                createdAt: 2000,
                source: 'group_fill',
                targetMessageIndex: 2,
                aiFloor: 2,
                filledSheetKeys: ['sheet_items'],
                changedSheetKeys: ['sheet_items'],
                groupKeys: ['sheet_items'],
                operations: [{
                  kind: 'sheet_replace',
                  sheetKey: 'sheet_items',
                  sheet: filled.sheet_items,
                  reason: 'system',
                }],
              }],
            },
          },
        },
      },
    ], { frequency: 1, skipFloors: 0 });

    captureCheckpointVaultForCurrentChat_ACU(chat);
    await refreshMergedDataAndNotify_ACU();
    expect(currentJsonTableData_ACU?.sheet_items?.content).toHaveLength(2);
    expect(wb.getBookEntries().some(entry => entry.comment === 'TavernDB-ACU-ReadableDataTable' && entry.content.includes('增量长剑'))).toBe(true);

    // 删除一楼 AI 回复
    chat.splice(2, 1);
    const guardResult = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(guardResult).toEqual({ recovered: false, graftedCount: 0 });

    await refreshMergedDataAndNotify_ACU();
    expect(currentJsonTableData_ACU?.sheet_items?.content).toEqual([['row_id', '物品名', '数量']]);
    expect(wb.getBookEntries().filter(entry => String(entry.comment || '').startsWith('TavernDB-ACU-'))).toEqual([]);

    chat.push({ is_user: false, mes: '重新生成的 AI 第一楼正文' });
    const plan = buildAutoUpdatePlan_ACU(chat, currentJsonTableData_ACU as any, settings_ACU, '');
    expect(plan.tablesToUpdate.map(item => item.sheetKey)).toEqual(['sheet_items']);
  });

  it('场景 C：手动填表在最新 AI 楼写入 sheet_rebase（含 lastFilledAiFloor=2），删楼后彻底回滚且 frequency=1 重生成仍触发填表', async () => {
    const emptyBase = makeEmptyTemplateData();
    const filled = makeFilledData('手填秘剑');
    setupHost([
      {
        is_user: false,
        mes: '开场白',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'cp-seed-0',
              checkpoint: {
                kind: 'full',
                createdAt: 1000,
                reason: 'init',
                data: emptyBase,
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '玩家第一轮行动' },
      {
        is_user: false,
        mes: 'AI 第一楼正文',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: '1:manual-2',
              logEntries: [],
              sheetTimelineEvents: [{
                ordinal: 0,
                checkpoint: {
                  kind: 'sheet_full',
                  createdAt: 2000,
                  reason: 'manual',
                  sheetKey: 'sheet_items',
                  data: filled.sheet_items,
                  scheduleSummary: { lastFilledAiFloor: 2 },
                  timeline: { kind: 'sheet_rebase', activateAtMessageIndex: 2, afterSeq: 0 },
                },
              }],
            },
          },
        },
      },
    ], { frequency: 1, skipFloors: 0 });

    captureCheckpointVaultForCurrentChat_ACU(chat);
    await refreshMergedDataAndNotify_ACU();
    expect(currentJsonTableData_ACU?.sheet_items?.content).toHaveLength(2);
    expect(wb.getBookEntries().some(entry => entry.comment === 'TavernDB-ACU-ReadableDataTable' && entry.content.includes('手填秘剑'))).toBe(true);

    // 删除手动填表的一楼 AI 回复
    chat.splice(2, 1);
    const guardResult = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(guardResult).toEqual({ recovered: false, graftedCount: 0 });
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.sheetTimelineEvents).toBeUndefined();

    await refreshMergedDataAndNotify_ACU();
    expect(currentJsonTableData_ACU?.sheet_items?.content).toEqual([['row_id', '物品名', '数量']]);
    expect(wb.getBookEntries().filter(entry => String(entry.comment || '').startsWith('TavernDB-ACU-'))).toEqual([]);

    // 重生成该楼后，即使是 frequency=1、skipFloors=0 也必须再次触发填表（不再被旧 lastFilledAiFloor=2 卡死）
    chat.push({ is_user: false, mes: '重新生成的 AI 第一楼正文' });
    const plan = buildAutoUpdatePlan_ACU(chat, currentJsonTableData_ACU as any, settings_ACU, '');
    expect(plan.tablesToUpdate.map(item => item.sheetKey)).toEqual(['sheet_items']);
    expect(plan.tablesToUpdate[0].indices).toEqual([0, 2]);
  });
});
