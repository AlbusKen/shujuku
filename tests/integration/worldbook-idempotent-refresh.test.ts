/**
 * tests/integration/worldbook-idempotent-refresh.test.ts
 * Issue #80 回归：大世界书重复刷新 / 重开聊天时：
 * - 内容与字段完全一致时，不写回 saveWorldInfo，不发 WORLDINFO_UPDATED，已有条目保持原 order；
 * - 真实内容变更时，只写回一次并发一次 WORLDINFO_UPDATED，已有条目保持原 order；
 * - 新增条目时，已有条目保持原 order，只给新增条目分配新 order。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _set_SillyTavern_API_ACU,
  _set_TavernHelper_API_ACU,
  SillyTavern_API_ACU,
  TavernHelper_API_ACU,
} from '../../src/shared/host-api';
import { createNativeStBackend_ACU } from '../../src/shared/host-compat/native-st-backend';
import {
  _set_coreApisAreReady_ACU,
  _set_currentChatFileIdentifier_ACU,
  _set_currentJsonTableData_ACU,
  _set_settings_ACU,
  coreApisAreReady_ACU,
  currentChatFileIdentifier_ACU,
  currentJsonTableData_ACU,
  settings_ACU,
} from '../../src/service/runtime/state-manager';
import { updateReadableLorebookEntry_ACU } from '../../src/service/worldbook/pipeline';
import { __resetCustomTableExportStateForTests_ACU } from '../../src/service/worldbook/injection-engine-custom';
import {
  buildChatSheetGuideDataFromTemplateObj_ACU,
  setChatSheetGuideDataForIsolationKey_ACU,
} from '../../src/service/template/chat-scope';
import { TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU } from '../../src/shared/defaults-json.js';

const { mockHost, mockWorldInfoModule } = vi.hoisted(() => ({
  mockHost: {} as any,
  mockWorldInfoModule: {} as any,
}));

vi.mock('../../src/shared/runtime-env', () => ({
  getHostWindow: () => mockHost,
  isExtensionMode: () => false,
  isUserscriptMode: () => true,
}));

const original = {
  host: SillyTavern_API_ACU,
  helper: TavernHelper_API_ACU,
  ready: coreApisAreReady_ACU,
  chatId: currentChatFileIdentifier_ACU,
  tables: currentJsonTableData_ACU,
  settings: settings_ACU,
  template: TABLE_TEMPLATE_ACU,
};

function makeTableData(overrides: {
  bagItem?: string;
  customRows?: string[][];
  summaryRows?: string[][];
  personRows?: string[][];
  outlineText?: string;
} = {}) {
  const bagItem = overrides.bagItem ?? '铁剑';
  const customRows = overrides.customRows ?? [
    ['row_id', '事件', '详情'],
    ['1', '出发', '踏上旅途'],
  ];
  const summaryRows = overrides.summaryRows ?? [
    ['row_id', '编码索引', '总结'],
    ['1', 'AM0001', '第一幕总结'],
  ];
  const personRows = overrides.personRows ?? [
    ['row_id', '姓名', '状态'],
    ['1', '艾琳', '同行'],
  ];
  const outlineText = overrides.outlineText ?? '主线初章';

  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_bag: {
      uid: 'sheet_bag',
      name: '背包表',
      orderNo: 0,
      content: [['row_id', '物品', '数量'], ['1', bagItem, '1']],
      exportConfig: { enabled: false },
    },
    sheet_custom: {
      uid: 'sheet_custom',
      name: '纪要表',
      orderNo: 1,
      content: customRows,
      exportConfig: {
        enabled: true,
        splitByRow: true,
        entryName: '纪要',
        entryType: 'constant',
        preventRecursion: true,
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexEnabled: true,
        extraIndexEntryName: '纪要-索引',
        extraIndexColumns: ['事件'],
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      },
    },
    sheet_summary: {
      uid: 'sheet_summary',
      name: '总结表',
      orderNo: 2,
      content: summaryRows,
      exportConfig: { enabled: false },
    },
    sheet_persons: {
      uid: 'sheet_persons',
      name: '重要人物表',
      orderNo: 3,
      content: personRows,
      exportConfig: { enabled: false },
    },
    sheet_outline: {
      uid: 'sheet_outline',
      name: '总体大纲',
      orderNo: 4,
      content: [['row_id', '章节', '纲要'], ['1', '第一章', outlineText]],
      exportConfig: { enabled: false },
    },
  };
}

describe('Issue #80：世界书幂等刷新与已有条目 order 稳定', () => {
  let bookData: { entries: Record<number, any> };
  let saveWorldInfo: ReturnType<typeof vi.fn>;
  let emittedEvents: Array<{ event: string; args: any[] }>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetCustomTableExportStateForTests_ACU();
    emittedEvents = [];
    bookData = {
      entries: {
        0: {
          uid: 0,
          displayIndex: 0,
          comment: '用户手写世界书条目',
          content: '重要背景设定',
          key: ['背景'],
          keysecondary: [],
          constant: false,
          vectorized: false,
          selective: true,
          selectiveLogic: 0,
          order: 100,
          position: 0,
          disable: false,
          preventRecursion: false,
          excludeRecursion: false,
          delayUntilRecursion: 0,
          probability: 100,
          depth: 4,
          role: 0,
        },
      },
    };

    const loadWorldInfo = vi.fn(async (name: string) => {
      if (name !== 'GiantBook') return null;
      return JSON.parse(JSON.stringify(bookData));
    });
    saveWorldInfo = vi.fn(async (name: string, data: any) => {
      if (name !== 'GiantBook') throw new Error(`unexpected book ${name}`);
      bookData = JSON.parse(JSON.stringify(data));
      emittedEvents.push({ event: 'WORLDINFO_UPDATED', args: [name] });
    });

    Object.keys(mockHost).forEach(k => delete mockHost[k]);
    Object.keys(mockWorldInfoModule).forEach(k => delete mockWorldInfoModule[k]);
    Object.assign(mockWorldInfoModule, {
      world_names: ['GiantBook'],
      world_info: { charLore: [] },
      loadWorldInfo,
    });
    mockHost.location = { href: 'https://tavern.test/' };
    mockHost.document = {
      createElement: () => ({ remove: vi.fn() }),
      head: {
        appendChild: () => {
          const key = Object.keys(mockHost).find(k => k.startsWith('__ACU_WI_MODULE_'))!;
          mockHost[key].resolve(mockWorldInfoModule);
        },
      },
    };

    const stApi = {
      chat: [
        { is_user: false, mes: '开场白' },
        { is_user: true, mes: '你好' },
        { is_user: false, mes: '回复' },
      ],
      chatId: 'chat-issue-80',
      characterId: 0,
      characters: [{ name: '测试角色', avatar: 'test.png', data: { extensions: { world: 'GiantBook' } } }],
      chatMetadata: {},
      loadWorldInfo,
      saveWorldInfo,
      executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: '' })),
    };

    const backend = createNativeStBackend_ACU(() => stApi);
    _set_SillyTavern_API_ACU(stApi as any);
    _set_TavernHelper_API_ACU(backend as any);
    _set_coreApisAreReady_ACU(true);
    _set_currentChatFileIdentifier_ACU('chat-issue-80');
    const initialData = makeTableData();
    _set_TABLE_TEMPLATE_ACU(JSON.stringify(initialData));
    _set_settings_ACU({
      ...original.settings,
      dataIsolationEnabled: false,
      dataIsolationCode: '',
      knownCustomEntryNames: [],
      worldbookConfig: {
        ...(original.settings as any)?.worldbookConfig,
        source: 'character',
        manualSelection: [],
        injectionTarget: 'character',
        zeroTkOccupyMode: false,
        enabledEntries: {},
      },
    } as any);
    _set_currentJsonTableData_ACU(null);
    const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(initialData, { stripSeedRows: false });
    if (guideData) {
      setChatSheetGuideDataForIsolationKey_ACU('', guideData, {
        reason: 'test_setup',
        syncTemplateScope: true,
        templateSource: JSON.stringify(initialData),
      });
    }
  });

  afterEach(() => {
    __resetCustomTableExportStateForTests_ACU();
    _set_SillyTavern_API_ACU(original.host);
    _set_TavernHelper_API_ACU(original.helper);
    _set_coreApisAreReady_ACU(original.ready);
    _set_currentChatFileIdentifier_ACU(original.chatId);
    _set_currentJsonTableData_ACU(original.tables);
    _set_settings_ACU(original.settings);
    _set_TABLE_TEMPLATE_ACU(original.template);
  });

  it('内容与字段完全一致时重复刷新：0 次写回、0 次 WORLDINFO_UPDATED、全部已有条目保留原 order 与 uid', async () => {
    const data = makeTableData();
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', data);

    const snapshotAfterInit = Object.values(bookData.entries).map((e: any) => ({
      uid: e.uid,
      comment: e.comment,
      order: e.order,
      content: e.content,
    }));
    expect(snapshotAfterInit.length).toBeGreaterThan(5);

    saveWorldInfo.mockClear();
    emittedEvents.length = 0;

    // 模拟重开聊天 / 重复刷新（数据完全不变）
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData());

    expect(saveWorldInfo).not.toHaveBeenCalled();
    expect(emittedEvents).toHaveLength(0);
    const snapshotAfterRepeat = Object.values(bookData.entries).map((e: any) => ({
      uid: e.uid,
      comment: e.comment,
      order: e.order,
      content: e.content,
    }));
    expect(snapshotAfterRepeat).toEqual(snapshotAfterInit);
  });

  it('内容真实变化时：只写回一次、发一次 WORLDINFO_UPDATED，且已有条目保持原 order', async () => {
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData());

    const orderByCommentBefore = new Map<string, number>();
    const uidByCommentBefore = new Map<string, number>();
    for (const entry of Object.values(bookData.entries) as any[]) {
      orderByCommentBefore.set(entry.comment, entry.order);
      uidByCommentBefore.set(entry.comment, entry.uid);
    }

    saveWorldInfo.mockClear();
    emittedEvents.length = 0;

    // 仅改动背包表的一行内容（只影响全局可读条目）
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData({ bagItem: '秘银长剑' }));

    expect(saveWorldInfo).toHaveBeenCalledTimes(1);
    expect(emittedEvents).toEqual([{ event: 'WORLDINFO_UPDATED', args: ['GiantBook'] }]);

    const readable = (Object.values(bookData.entries) as any[]).find(e => e.comment === 'TavernDB-ACU-ReadableDataTable');
    expect(readable?.content).toContain('秘银长剑');
    for (const entry of Object.values(bookData.entries) as any[]) {
      expect(entry.order).toBe(orderByCommentBefore.get(entry.comment));
      expect(entry.uid).toBe(uidByCommentBefore.get(entry.comment));
    }
  });

  it('新增拆分行时：已有条目保持原 order 与 uid，只给新增条目分配新 order', async () => {
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData());

    const orderByCommentBefore = new Map<string, number>();
    const uidByCommentBefore = new Map<string, number>();
    for (const entry of Object.values(bookData.entries) as any[]) {
      orderByCommentBefore.set(entry.comment, entry.order);
      uidByCommentBefore.set(entry.comment, entry.uid);
    }

    saveWorldInfo.mockClear();
    emittedEvents.length = 0;

    // 给纪要表新增第 2 行（按行拆分）
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData({
      customRows: [
        ['row_id', '事件', '详情'],
        ['1', '出发', '踏上旅途'],
        ['2', '入城', '抵达王都'],
      ],
    }));

    expect(saveWorldInfo.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(emittedEvents.length).toBe(saveWorldInfo.mock.calls.length);

    // 已有条目全部保持原 order 与 uid
    for (const [comment, prevOrder] of orderByCommentBefore.entries()) {
      const current = (Object.values(bookData.entries) as any[]).find(e => e.comment === comment);
      expect(current).toBeDefined();
      expect(current.order).toBe(prevOrder);
      expect(current.uid).toBe(uidByCommentBefore.get(comment));
    }
    const newRowEntry = (Object.values(bookData.entries) as any[]).find(e => e.comment === 'TavernDB-ACU-CustomExport-纪要-2');
    expect(newRowEntry).toBeDefined();
    expect(newRowEntry.content).toContain('抵达王都');
    expect(Number.isFinite(newRowEntry.order)).toBe(true);
  });

  it('仅修改自定义导出表某行正文时：只写回一次、发一次 WORLDINFO_UPDATED，已有条目保持原 order 与 uid', async () => {
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData());

    const orderByCommentBefore = new Map<string, number>();
    const uidByCommentBefore = new Map<string, number>();
    for (const entry of Object.values(bookData.entries) as any[]) {
      orderByCommentBefore.set(entry.comment, entry.order);
      uidByCommentBefore.set(entry.comment, entry.uid);
    }

    saveWorldInfo.mockClear();
    emittedEvents.length = 0;

    // 仅修改纪要表第 1 行的详情列（不改事件列，索引条目内容不变）
    await updateReadableLorebookEntry_ACU(true, false, 'GiantBook', makeTableData({
      customRows: [
        ['row_id', '事件', '详情'],
        ['1', '出发', '带着补给踏上旅途'],
      ],
    }));

    expect(saveWorldInfo).toHaveBeenCalledTimes(1);
    expect(emittedEvents).toEqual([{ event: 'WORLDINFO_UPDATED', args: ['GiantBook'] }]);
    const row1 = (Object.values(bookData.entries) as any[]).find(e => e.comment === 'TavernDB-ACU-CustomExport-纪要-1');
    expect(row1?.content).toContain('带着补给踏上旅途');
    for (const entry of Object.values(bookData.entries) as any[]) {
      expect(entry.order).toBe(orderByCommentBefore.get(entry.comment));
      expect(entry.uid).toBe(uidByCommentBefore.get(entry.comment));
    }
  });
});
