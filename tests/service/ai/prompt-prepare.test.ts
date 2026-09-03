/**
 * tests/service/ai/prompt-prepare.test.ts
 * formatTableForSqliteMode 纯函数单元测试
 *
 * 策略：mock getEffectiveSeedRowsForSheet_ACU，直接测试格式化输出
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

const mockGetEffectiveSeedRows = vi.fn(() => []);
const mockEnsureChatSheetGuideSeeded = vi.fn().mockResolvedValue(null);
const mockAttachSeedRows = vi.fn();
const mockReplaceDbSqlVariables = vi.fn((content: string) => content);
const mockGetWorldBooks = vi.fn().mockResolvedValue([]);
let mockCurrentJsonTableData: any = null;
let mockSettings: any = {};
const mockApplyContextTagFilters = vi.fn((content: string) => content);
const mockResolvePreTakeoverSnapshot = vi.fn(async () => ({
  snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
  expectedSignature: 'signature:["Agent书"]',
}));
const mockGetCurrentFlightModeState = vi.fn(() => ({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' }));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: (...args: any[]) => mockGetEffectiveSeedRows(...args),
  ensureChatSheetGuideSeeded_ACU: (...args: any[]) => mockEnsureChatSheetGuideSeeded(...args),
  attachSeedRowsToCurrentDataFromGuide_ACU: (...args: any[]) => mockAttachSeedRows(...args),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
  // 模板范围默认「未知」，即不过滤，保持既有用例语义。
  resolveTemplateScope_ACU: vi.fn(() => null),
  filterSheetKeysByTemplateScope_ACU: vi.fn((keys: string[]) => [...keys]),
  projectSheetForTemplateScope_ACU: vi.fn((sheet: any) => sheet),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  normalizeExtractRules_ACU: vi.fn(() => []),
  normalizeExcludeRules_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get manualExtraHint_ACU() { return ''; },
  get currentChatFileIdentifier_ACU() { return null; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  get settings_ACU() { return mockSettings; },
}));

// 请求级读取上下文底层依赖世界书网关；测试统一 mock 网关以隔离宿主 API。
const mockLorebookList = vi.fn<() => Promise<any[]>>(async () => []);
const mockLorebookEntries = vi.fn<(...args: any[]) => Promise<any[]>>(async () => []);
vi.mock('../../../src/data/gateways/worldbook-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/gateways/worldbook-gateway')>();
  return {
    ...actual,
    listLorebooks_ACU: (...args: any[]) => mockLorebookList(...args),
    getLorebookEntries_ACU: (...args: any[]) => mockLorebookEntries(...args),
  };
});

const mockInjectionTargetLorebook = vi.fn<() => Promise<string | null>>(async () => null);
vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getInjectionTargetLorebook_ACU: (...args: any[]) => mockInjectionTargetLorebook(...args),
}));

const mockCharacterBinding = vi.fn<() => Promise<any>>(async () => ({ primary: null, additional: [], orderedNames: [] }));
vi.mock('../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharacterWorldbookBinding_ACU: (...args: any[]) => mockCharacterBinding(...args),
}));

vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getUserName_ACU: vi.fn(() => '用户'),
  getCurrentCharacterCardKey_ACU: vi.fn(() => null),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  getCombinedWorldbookContent_ACU: vi.fn().mockResolvedValue(''),
  getWorldBooks_ACU: (...args: any[]) => mockGetWorldBooks(...args),
}));

vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({
  resolvePreTakeoverWorldbookSnapshot_ACU: (...args: any[]) => mockResolvePreTakeoverSnapshot(...args),
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applyContextTagFilters_ACU: (...args: any[]) => mockApplyContextTagFilters(...args),
}));

vi.mock('../../../src/service/runtime/template-vars/sql-query-var', () => ({
  replaceDbSqlVariables: (content: string) => mockReplaceDbSqlVariables(content),
}));

let mockIsSqliteMode = true;
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const mockRuntimeProvider = {
  mode: 'sqlite',
  isReady: vi.fn(() => true),
  getCurrentData: vi.fn(() => mockCurrentJsonTableData),
};
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: vi.fn(() => Promise.resolve(mockRuntimeProvider)),
}));

vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  getCurrentFlightModeState_ACU: (...args: any[]) => mockGetCurrentFlightModeState(...args),
}));
vi.mock('../../../src/service/flight-mode/flight-mode-hidden-rows', async () =>
  await vi.importActual('../../../src/service/flight-mode/flight-mode-hidden-rows')
);

import { formatTableForSqliteMode, prepareAIInput_ACU } from '../../../src/service/ai/prompt-builder/prompt-prepare';
import { getCombinedWorldbookContent_ACU } from '../../../src/service/worldbook/pipeline';

describe('formatTableForSqliteMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveSeedRows.mockReturnValue([]);
    mockEnsureChatSheetGuideSeeded.mockResolvedValue(null);
    mockAttachSeedRows.mockReset();
    mockReplaceDbSqlVariables.mockImplementation((content: string) => content);
    mockGetWorldBooks.mockResolvedValue([]);
    mockRuntimeProvider.mode = 'sqlite';
    mockRuntimeProvider.getCurrentData.mockImplementation(() => mockCurrentJsonTableData);
    mockIsSqliteMode = true;
    mockCurrentJsonTableData = null;
    mockResolvePreTakeoverSnapshot.mockResolvedValue({
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
      expectedSignature: 'signature:["Agent书"]',
    });
    mockSettings = {
      tableContextExtractTags: '',
      tableContextExcludeTags: '',
      tableContextExtractRules: '',
      tableContextExcludeRules: '',
    };
    mockLorebookList.mockResolvedValue([]);
    mockLorebookEntries.mockResolvedValue([]);
    mockInjectionTargetLorebook.mockResolvedValue(null);
    mockCharacterBinding.mockResolvedValue({ primary: null, additional: [], orderedNames: [] });
    mockGetCurrentFlightModeState.mockReset().mockReturnValue({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' });
  });

  // ═══════════════════════════════════════════════════════════════
  // DDL 输出
  // ═══════════════════════════════════════════════════════════════
  it('输出 DDL', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quantity INTEGER);',
        note: '',
        insertNode: '',
        updateNode: '',
        deleteNode: '',
      },
      content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('CREATE TABLE inventory');
    expect(result).toContain('以上 CREATE TABLE 中的列名是本轮唯一权威');
  });

  it('作者英文表名覆盖内部 runtime 名，供 AI 作为写入契约使用', () => {
    const table = {
      name: '主角信息',
      sourceData: {
        ddl: 'CREATE TABLE protagonist_info (row_id INTEGER PRIMARY KEY, character_name TEXT);',
        note: '', insertNode: '', updateNode: '', deleteNode: '',
      },
      content: [['row_id', 'character_name']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_zhujue', null, {
      runtimeTableName: 'zhujuexinxi',
      authoredTableName: 'protagonist_info',
    });

    expect(result).toContain('CREATE TABLE protagonist_info');
    expect(result).not.toContain('CREATE TABLE zhujuexinxi');
    expect(result).toContain('SQL 写入必须严格使用本表上方 CREATE TABLE 中的表名 protagonist_info；不得使用其他名称。');
  });

  it('未传 runtimeTableName 时保持原 DDL 表名（向后兼容）', () => {
    const table = {
      name: '主角信息',
      sourceData: {
        ddl: 'CREATE TABLE protagonist_info (row_id INTEGER PRIMARY KEY, character_name TEXT);',
        note: '', insertNode: '', updateNode: '', deleteNode: '',
      },
 content: [['row_id', 'character_name']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_zhujue', null);
    expect(result).toContain('CREATE TABLE protagonist_info');
  });

  // ═══════════════════════════════════════════════════════════════
  // Note 和 Trigger 注释
  // ═══════════════════════════════════════════════════════════════
  it('输出 Note 注释', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        note: '记录角色背包中的物品',
        insertNode: '',
        updateNode: '',
        deleteNode: '',
      },
      content: [['row_id'], ['1']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- Note: 记录角色背包中的物品');
  });

  it('输出 INSERT/UPDATE/DELETE Trigger 注释', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        note: '',
        insertNode: '获得新物品时插入',
        updateNode: '物品数量变化时更新',
        deleteNode: '丢弃物品时删除',
      },
      content: [['row_id'], ['1']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- INSERT: 获得新物品时插入');
    expect(result).toContain('-- UPDATE: 物品数量变化时更新');
    expect(result).toContain('-- DELETE: 丢弃物品时删除');
    expect(result).toContain('Note/Trigger 中与其不一致的示例不得照抄');
  });

  // ═══════════════════════════════════════════════════════════════
  // 数据输出
  // ═══════════════════════════════════════════════════════════════
  it('输出当前数据（注释格式的表格）', () => {
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
      content: [['row_id', 'item_name'], ['1', '铁剑'], ['2', '药水']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- 当前数据 (2 rows)');
    expect(result).toContain('-- | row_id | item_name |');
    expect(result).toContain('-- | 1 | 铁剑 |');
    expect(result).toContain('-- | 2 | 药水 |');
  });

  it('SQLite prompt 隐藏历史列但不修改底层 DDL 与行数据', () => {
    const table: any = {
      uid: 'inventory',
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT, quantity INTEGER);',
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [['row_id', 'item_name', '旧备注', 'quantity'], ['1', '铁剑', '历史秘密', '3']],
      updateConfig: {},
    };

    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);

    expect(result).toContain('item_name TEXT');
    expect(result).toContain('quantity INTEGER');
    expect(result).not.toContain('legacy_note');
    expect(result).not.toContain('历史秘密');
    expect(table.sourceData.ddl).toContain('legacy_note TEXT');
    expect(table.content[1]).toEqual(['1', '铁剑', '历史秘密', '3']);
  });

  it('隐藏列存在时忽略自定义 SQL 行模板并回退到可见列投影', () => {
    mockReplaceDbSqlVariables.mockReturnValue('-- | 1 | 铁剑 | 历史秘密 | 3 |');
    const table: any = {
      uid: 'inventory',
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT, quantity INTEGER);',
        hiddenPhysicalColumns: ['legacy_note'],
      },
      content: [['row_id', 'item_name', '旧备注', 'quantity'], ['1', '铁剑', '历史秘密', '3']],
      updateConfig: {
        sendRowsSqlTemplate: '{[sql "SELECT * FROM inventory"]}',
      },
    };

    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);

    expect(mockReplaceDbSqlVariables).not.toHaveBeenCalled();
    expect(result).toContain('-- | row_id | item_name | quantity |');
    expect(result).toContain('-- | 1 | 铁剑 | 3 |');
    expect(result).not.toContain('legacy_note');
    expect(result).not.toContain('历史秘密');
  });

  it('配置填表发送数据模板时只替换当前数据部分并保留 DDL 与规则', () => {
    mockReplaceDbSqlVariables.mockReturnValue('-- | 9 | 自定义行 |');
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);',
        note: '记录背包',
        insertNode: '获得物品时插入',
        updateNode: '数量变化时更新',
        deleteNode: '丢弃时删除',
      },
      content: [['row_id', 'item_name'], ['1', '铁剑'], ['2', '药水']],
      updateConfig: {
        sendRowsSqlTemplate: '{[sql "SELECT row_id, item_name FROM inventory WHERE row_id = 9"]}',
      },
    };

    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);

    expect(mockReplaceDbSqlVariables).toHaveBeenCalledWith('{[sql "SELECT row_id, item_name FROM inventory WHERE row_id = 9"]}');
    expect(result).toContain('CREATE TABLE inventory');
    expect(result).toContain('-- Note: 记录背包');
    expect(result).toContain('-- INSERT: 获得物品时插入');
    expect(result).toContain('-- UPDATE: 数量变化时更新');
    expect(result).toContain('-- DELETE: 丢弃时删除');
    expect(result).toContain('-- 当前数据');
    expect(result).toContain('-- | 9 | 自定义行 |');
    expect(result).not.toContain('-- | 1 | 铁剑 |');
  });

  // ═══════════════════════════════════════════════════════════════
  // 空表
  // ═══════════════════════════════════════════════════════════════
  it('空表输出初始化提示', () => {
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);' },
      content: [['row_id']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('该表格为空，请进行初始化');
  });

  it('空表时输出 INIT 规则', () => {
    const table = {
      name: '全局状态表',
      sourceData: {
        ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, current_location TEXT);',
        initNode: '故事初始化时插入唯一条目。',
        insertNode: '禁止新增。',
        updateNode: '每轮更新地点。',
        deleteNode: '禁止删除。',
      },
      content: [['row_id', 'current_location']],
      updateConfig: {},
    };

    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);

    expect(result).toContain('-- INIT: 故事初始化时插入唯一条目。');
    expect(result).toContain('-- (该表格为空，请进行初始化。)');
  });

  it('非空表时不输出 INIT 规则，避免后续更新误用初始化语义', () => {
    const table = {
      name: '全局状态表',
      sourceData: {
        ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, current_location TEXT);',
        initNode: '故事初始化时插入唯一条目。',
        insertNode: '禁止新增。',
        updateNode: '每轮更新地点。',
        deleteNode: '禁止删除。',
      },
      content: [['row_id', 'current_location'], ['1', '王城']],
      updateConfig: {},
    };

    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);

    expect(result).not.toContain('-- INIT:');
    expect(result).not.toContain('该表格为空，请进行初始化');
    expect(result).toContain('-- 当前数据 (1 rows)');
  });

  // ═══════════════════════════════════════════════════════════════
  // seedRows
  // ═══════════════════════════════════════════════════════════════
  it('使用 seedRows 时输出提示', () => {
    mockGetEffectiveSeedRows.mockReturnValue([['1', '铁剑'], ['2', '药水']]);
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
      content: [['row_id', 'item_name']], // 无数据行
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('SeedRows');
    expect(result).toContain('-- 当前数据 (2 rows)');
  });

  // ═══════════════════════════════════════════════════════════════
  // 行数限制
  // ═══════════════════════════════════════════════════════════════
  it('总结表超过10行时只显示最后10行', () => {
    const rows: any[][] = [['row_id', 'content']];
    for (let i = 1; i <= 15; i++) {
      rows.push([String(i), `内容${i}`]);
    }
    const table = {
      name: '总结表',
      sourceData: { ddl: 'CREATE TABLE summary (row_id INTEGER PRIMARY KEY, content TEXT);' },
      content: rows,
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('Showing last 10 of 15');
  });

  it('sendLatestRows 限制行数', () => {
    const rows: any[][] = [['row_id', 'item']];
    for (let i = 1; i <= 20; i++) {
      rows.push([String(i), `物品${i}`]);
    }
    const table = {
      name: '背包物品表',
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
      content: rows,
      updateConfig: { sendLatestRows: 5 },
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('Showing last 5 of 20');
  });

  // ═══════════════════════════════════════════════════════════════
  // 多行 Note
  // ═══════════════════════════════════════════════════════════════
  it('多行 Note 正确转为注释', () => {
    const table = {
      name: '背包物品表',
      sourceData: {
        ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        note: '第一行说明\n第二行说明',
      },
      content: [['row_id'], ['1']],
      updateConfig: {},
    };
    const result = formatTableForSqliteMode(table, 0, 'sheet_0', null);
    expect(result).toContain('-- Note: 第一行说明\n-- 第二行说明');
  });
});

describe('prepareAIInput_ACU — 显式 tableData 模式', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePreTakeoverSnapshot.mockResolvedValue({
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
      expectedSignature: 'signature:["Agent书"]',
    });
    mockGetEffectiveSeedRows.mockReturnValue([]);
    mockEnsureChatSheetGuideSeeded.mockResolvedValue(null);
    mockAttachSeedRows.mockReset();
    mockGetWorldBooks.mockResolvedValue([]);
    mockRuntimeProvider.mode = 'sqlite';
    mockRuntimeProvider.getCurrentData.mockImplementation(() => mockCurrentJsonTableData);
    mockIsSqliteMode = false;
    mockCurrentJsonTableData = null;
    mockSettings = {
      tableContextExtractTags: '',
      tableContextExcludeTags: '',
      tableContextExtractRules: '',
      tableContextExcludeRules: '',
    };
    mockGetCurrentFlightModeState.mockReset().mockReturnValue({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' });
  });

  it('传入显式 tableData 时优先使用显式数据而不是全局数据', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '全局表',
        content: [['row_id', 'name'], ['1', '全局值']],
        updateConfig: {},
      },
    };
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name'], ['1', '显式值']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard', null, { tableData: explicitTableData });
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('[0:显式表]');
    expect(result!.tableDataText).toContain('显式值');
    expect(result!.tableDataText).not.toContain('全局表');
    expect(result!.tableDataText).not.toContain('全局值');
  });

  it('if seed 使用本次填表消息范围内的用户输入与 AI 上下文', async () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name']],
        updateConfig: {},
      },
    };
    const messages = [
      { is_user: true, mes: '用户关键词应进入 seed' },
      { is_user: false, mes: '范围内 AI 第一层' },
      { is_user: true, mes: '用户补充也应进入 seed' },
      { is_user: false, mes: '范围内 AI 第二层' },
    ];

    const result = await prepareAIInput_ACU(messages, 'standard', null, { tableData: explicitTableData });

    expect(result?.conditionalSeedContent).toBe('用户关键词应进入 seed\n范围内 AI 第一层\n用户补充也应进入 seed\n范围内 AI 第二层');
    expect(result?.messagesText).toContain('用户关键词应进入 seed');
  });

  it('if seed 复用 $1 的 extract/exclude 过滤结果，被移除的 AI 关键词不进入 seed', async () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name']],
        updateConfig: {},
      },
    };
    // 模拟 extract/exclude 规则：AI 内容中的“被排除关键词”被过滤掉。
    mockApplyContextTagFilters.mockImplementation((content: string) =>
      content.replace(/被排除关键词/g, '').trim());
    mockSettings.tableContextExtractTags = 'tag'; // 触发过滤分支
    mockSettings.tableContextExtractRules = '';
    mockSettings.tableContextExcludeTags = 'exclude';
    mockSettings.tableContextExcludeRules = '';
    const messages = [
      { is_user: false, mes: '包含被排除关键词的 AI 内容' },
    ];

    const result = await prepareAIInput_ACU(messages, 'standard', null, { tableData: explicitTableData });

    expect(result?.conditionalSeedContent).toBe('包含的 AI 内容');
    expect(result?.conditionalSeedContent).not.toContain('被排除关键词');
    expect(result?.messagesText).not.toContain('被排除关键词');
  });

  it('本次填表范围内没有 AI 消息时 conditionalSeedContent 为空字符串', async () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard', null, { tableData: explicitTableData });

    expect(result?.conditionalSeedContent).toBe('');
    expect(result?.messagesText).toContain('(无最新对话内容)');
  });


  it('SQLite prompt 明确标注 DDL 仅用于结构参考并禁止复制 CREATE', async () => {
    mockIsSqliteMode = true;
    mockSettings.strictJsonTableFillEnabled = true;
    mockCurrentJsonTableData = {
      sheet_0: {
        uid: 'inventory',
        name: '背包表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);',
        },
        content: [['row_id', 'item_name'], ['1', '铁剑']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    };

    const result = await prepareAIInput_ACU([], 'standard', ['sheet_0'], {
      tableData: mockCurrentJsonTableData,
    });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE');
    expect(result!.tableDataText).toContain('上方 CREATE TABLE 仅用于说明表结构');
    expect(result!.tableDataText).toContain('严禁复制或输出 CREATE、ALTER、DROP、SELECT');
    expect(result!.tableDataText).toContain('仅使用 INSERT INTO / INSERT OR REPLACE INTO / REPLACE INTO / UPDATE / DELETE FROM 数据变更语句');
    expect(result!.tableDataText).toContain('按 SQLite 原生整行替换语义执行');
  });

  it('原生 prompt 使用 physical 投影隐藏历史列并保持右侧可见列对齐', async () => {
    const result = await prepareAIInput_ACU([], 'standard', null, {
      tableData: {
        sheet_0: {
          uid: 'sheet_0',
          name: '显式表',
          sourceData: {
            ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, legacy_note TEXT, status TEXT);',
            hiddenPhysicalColumns: ['legacy_note'],
          },
          content: [['row_id', '姓名', '旧备注', '状态'], ['1', '助手', '不可见', '正常']],
          updateConfig: {},
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('[0:姓名], [1:状态]');
    expect(result!.tableDataText).toContain('[0] 助手, 正常');
    expect(result!.tableDataText).not.toContain('旧备注');
    expect(result!.tableDataText).not.toContain('不可见');
  });

  it('飞行模式对填表 prompt 仅输出可见纪要行，不修改调用方快照', async () => {
    mockIsSqliteMode = false;
    const chronicleRows = Array.from({ length: 20 }, (_, index) => [`c${index + 1}`, `纪要${index + 1}`]);
    const data = {
      sheet_chronicle: {
        uid: 'sheet_chronicle', name: '纪要表', content: [['row_id', '事件'], ...chronicleRows], updateConfig: {},
      },
      sheet_da_zong_jie: {
        uid: 'sheet_da_zong_jie', name: '大总结', content: [['row_id', '总结'], ['s1', '此前大总结']], updateConfig: {},
      },
    };
    mockGetCurrentFlightModeState.mockReturnValue({
      enabled: true,
      hiddenRowIds: chronicleRows.slice(0, 5).map(row => row[0]),
      bigSummarySheetKey: 'sheet_da_zong_jie',
    });

    const result = await prepareAIInput_ACU([], 'standard', null, { tableData: data });

    expect(result?.tableDataText).toContain('纪要6');
    expect(result?.tableDataText).toContain('纪要20');
    expect(result?.tableDataText).not.toContain('纪要5');
    expect(result?.tableDataText).not.toContain('summary table fixed limit');
    expect(result?.tableDataText).toContain('此前大总结');
    expect(data.sheet_chronicle.content).toEqual([['row_id', '事件'], ...chronicleRows]);
  });

  it('关闭飞行模式后纪要表恢复最新 10 条窗口', async () => {
    mockIsSqliteMode = false;
    const chronicleRows = Array.from({ length: 15 }, (_, index) => [`c${index + 1}`, `纪要${index + 1}`]);
    const result = await prepareAIInput_ACU([], 'standard', null, {
      tableData: {
        sheet_chronicle: {
          uid: 'sheet_chronicle', name: '纪要表', content: [['row_id', '事件'], ...chronicleRows], updateConfig: {},
        },
      },
    });

    expect(result?.tableDataText).toContain('Showing last 10 of 15 entries (summary table fixed limit).');
    expect(result?.tableDataText).toContain('纪要6');
    expect(result?.tableDataText).toContain('纪要15');
    expect(result?.tableDataText).not.toContain('纪要5');
  });

  it('传入显式 tableData 且存在 guideData 时不调用全局 attach helper，且不污染原始显式对象', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '全局表',
        content: [['row_id', 'name']],
        updateConfig: {},
      },
    };
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name']],
        updateConfig: {},
      },
    };
    mockEnsureChatSheetGuideSeeded.mockResolvedValue({ sheet_0: { seedRows: [['1', '模板值']] } });

    await prepareAIInput_ACU([], 'standard', null, { tableData: explicitTableData });

    expect(mockAttachSeedRows).not.toHaveBeenCalled();
    expect(explicitTableData.sheet_0.seedRows).toBeUndefined();
    expect(mockCurrentJsonTableData.sheet_0.seedRows).toBeUndefined();
  });

  it('传入 Agent 绿灯时在同一 pre_takeover 读取视图中收集 $4 与 $9', async () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name'], ['1', '显式值']],
        updateConfig: {},
      },
    };
    const messages = [
      { is_user: true, mes: '用户触发普通关键词' },
      { is_user: false, mes: '角色回应' },
    ];
    const agentGreenlights = [{ bookName: '书A', uid: 7, reason: '正文需要' }];

    await prepareAIInput_ACU(messages, 'standard', null, {
      tableData: explicitTableData,
      agentGreenlights,
    });

    const calls = vi.mocked(getCombinedWorldbookContent_ACU).mock.calls;
    expect(calls).toHaveLength(2);
    calls.forEach(([, callOptions]) => {
      expect(callOptions).toEqual(expect.objectContaining({
        entryStateView: 'pre_takeover',
        entryStateSnapshot: expect.objectContaining({ active: false }),
        entryStateSnapshotSignature: 'signature:["Agent书"]',
        agentGreenlights,
      }));
    });
    expect(calls[0][1]).not.toHaveProperty('excludeEntry');
    expect(calls[1][1]).toEqual(expect.objectContaining({ excludeEntry: expect.any(Function) }));
  });

  it('返回 $9 世界书内容与请求内表名 resolver', async () => {
    // 候选作用域契约（§3.2）：生成条目只在候选来源（manualSelection / enabledEntries /
    // Agent greenlight / 注入目标 / 角色绑定）内的书中可解析。书 A 需显式进入候选。
    mockSettings.characterSettings = {
      default: { worldbookConfig: { source: 'manual', manualSelection: ['书A'], enabledEntries: {}, injectionTarget: '' } },
    };
    mockLorebookList.mockResolvedValue([{ name: '书A' }]);
    mockLorebookEntries.mockImplementation(async (hostName: string) => {
      if (hostName === '书A') {
        return [
          { uid: 7, comment: 'TavernDB-ACU-CustomExport-关系档案', content: '关系正文' },
          { uid: 8, comment: 'TavernDB-ACU-CustomExport-其他档案', content: '其他正文' },
        ];
      }
      return [];
    });
    vi.mocked(getCombinedWorldbookContent_ACU)
      .mockResolvedValueOnce('普通世界书')
      .mockResolvedValueOnce('排除内部后的世界书')
      .mockResolvedValueOnce('关系正文');
    const result = await prepareAIInput_ACU([], 'standard', null, {
      tableData: {
        sheet_0: {
          uid: 'sheet_0', name: '显式表', content: [['row_id', 'name']], updateConfig: {},
          exportConfig: { enabled: true, entryName: '关系档案' },
        },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      worldbookContent: '普通世界书',
      worldbookDatabaseExcludedContent: '排除内部后的世界书',
      resolveTableWorldbookContent: expect.any(Function),
    }));
    await expect(result!.resolveTableWorldbookContent('显式表')).resolves.toBe('<worldbook_context>\n关系正文\n</worldbook_context>');
    const [, resolverOptions] = vi.mocked(getCombinedWorldbookContent_ACU).mock.calls[2];
    expect(resolverOptions).toEqual(expect.objectContaining({
      includeGeneratedEntries: true,
      entryScope: expect.any(Function),
    }));
    expect(resolverOptions.entryScope({ bookName: '书A', uid: 7 })).toBe(true);
    expect(resolverOptions.entryScope({ bookName: '书A', uid: 8 })).toBe(false);
    await expect(result!.resolveTableWorldbookContent('不存在的表')).resolves.toBeNull();
  });

  it('active snapshot 使用 Agent 独立范围签名，不使用填表世界书范围自证', async () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name'], ['1', '显式值']],
        updateConfig: {},
      },
    };
    const snapshot = {
      active: true,
      selectionSignature: 'signature:["Agent书"]',
      createdAt: 1,
      books: { Agent书: [{ uid: 1, previousEnabled: true, previousKeys: ['触发'], previousType: 'selective' }] },
    };
    mockResolvePreTakeoverSnapshot.mockResolvedValue({ snapshot, expectedSignature: 'signature:["Agent书"]' });

    await prepareAIInput_ACU([], 'standard', null, { tableData: explicitTableData });

    expect(getCombinedWorldbookContent_ACU).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        entryStateView: 'pre_takeover',
        entryStateSnapshot: snapshot,
        entryStateSnapshotSignature: 'signature:["Agent书"]',
      }),
    );
  });

  it('hydration 失败时继续准备填表输入，并以空签名让管线退化 live', async () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'name'], ['1', '显式值']],
        updateConfig: {},
      },
    };
    mockResolvePreTakeoverSnapshot.mockRejectedValue(new Error('snapshot unavailable'));

    await expect(prepareAIInput_ACU([], 'standard', null, { tableData: explicitTableData })).resolves.toBeTruthy();

    expect(getCombinedWorldbookContent_ACU).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        entryStateView: 'pre_takeover',
        entryStateSnapshot: undefined,
        entryStateSnapshotSignature: '',
      }),
    );
  });
});
