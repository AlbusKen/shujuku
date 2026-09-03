/**
 * tests/service/ai/prompt-prepare-sql-mode.test.ts
 * prepareAIInput_ACU 在 SQL 模式下的行为测试
 *
 * 策略：mock 所有外部依赖，验证 SQL 模式下的表格格式化和 SQL 编辑格式说明追加
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

const mockGetEffectiveSeedRows = vi.fn(() => []);
vi.mock('../../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: (...args: any[]) => mockGetEffectiveSeedRows(...args),
  ensureChatSheetGuideSeeded_ACU: vi.fn().mockResolvedValue(null),
  attachSeedRowsToCurrentDataFromGuide_ACU: vi.fn(),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
  // 模板范围默认「未知」，即不过滤，保持既有用例语义。
  resolveTemplateScope_ACU: vi.fn(() => null),
  filterSheetKeysByTemplateScope_ACU: vi.fn((keys: string[], scope: any) => (scope ? keys.filter((k: string) => scope.sheetKeys.has(k)) : [...keys])),
  // 阶段 C：不再 mock 掉关键投影行为——同步复刻真实投影（隐藏列合并 +
  // runtime schema descriptor 保留），prompt-prepare 的调用点是同步的。
  projectSheetForTemplateScope_ACU: (sheet: any, scope: any, sheetKey: string) => {
    if (!scope || !scope.sheets?.[sheetKey]) return sheet;
    const scopeSheet = scope.sheets[sheetKey];
    const runtimeColumns = Array.isArray(sheet?.content?.[0]) ? sheet.content[0] : [];
    const templateColumns = Array.isArray(scopeSheet?.content?.[0]) ? scopeSheet.content[0] : [];
    const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const outOfScope = runtimeColumns.filter((header: string) => {
      const normalized = normalize(header);
      if (!normalized || normalized === 'row_id') return false;
      return !templateColumns.some((templateHeader: string) => normalize(templateHeader) === normalized);
    });
    if (outOfScope.length === 0) return sheet;
    const existingHidden = Array.isArray(sheet.sourceData?.hiddenPhysicalColumns)
      ? sheet.sourceData.hiddenPhysicalColumns.map((value: unknown) => String(value ?? '')).filter(Boolean)
      : [];
    const merged: string[] = [];
    [...existingHidden, ...outOfScope].forEach((name: string) => {
      if (!merged.some(value => normalize(value) === normalize(name))) merged.push(name);
    });
    const projected: Record<string, unknown> = {
      ...sheet,
      sourceData: { ...(sheet.sourceData || {}), hiddenPhysicalColumns: merged },
    };
    if (sheet && typeof sheet === 'object' && Object.prototype.hasOwnProperty.call(sheet, '_acu_runtimeEffectiveSchema')) {
      const descriptor = Object.getOwnPropertyDescriptor(sheet, '_acu_runtimeEffectiveSchema');
      if (descriptor) Object.defineProperty(projected, '_acu_runtimeEffectiveSchema', { ...descriptor, enumerable: false });
    }
    return projected;
  },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => text ? 'mock-ddl-digest' : ''),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  normalizeExtractRules_ACU: vi.fn(() => []),
  normalizeExcludeRules_ACU: vi.fn(() => []),
}));

let mockCurrentJsonTableData: any = null;
let mockSettings: any = {};
const mockGetCurrentFlightModeState = vi.fn(() => ({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' }));

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
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applyContextTagFilters_ACU: vi.fn((c: string) => c),
}));

let mockIsSqliteMode = true;
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const mockEnsureStorageProviderReady = vi.fn();
const mockGetStorageRuntimeHealth = vi.fn(() => ({
  status: 'ready', expectedMode: 'sqlite', activeMode: 'sqlite', loadToken: 1,
}));
const mockRuntimeProvider = {
  mode: 'sqlite',
  isReady: vi.fn(() => true),
  getCurrentData: vi.fn(() => mockCurrentJsonTableData),
};
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  ensureStorageProviderReady_ACU: (...args: any[]) => mockEnsureStorageProviderReady(...args),
  getStorageRuntimeHealth_ACU: () => mockGetStorageRuntimeHealth(),
}));

vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  getCurrentFlightModeState_ACU: (...args: any[]) => mockGetCurrentFlightModeState(...args),
}));
vi.mock('../../../src/service/flight-mode/flight-mode-hidden-rows', async () =>
  await vi.importActual('../../../src/service/flight-mode/flight-mode-hidden-rows')
);

import { formatTableForSqliteMode, prepareAIInput_ACU } from '../../../src/service/ai/prompt-builder/prompt-prepare';
import { SqliteEngine } from '../../../src/data/sqlite/sqlite-engine';
import { SyncBridge } from '../../../src/data/sqlite/sync-bridge';

// ═══════════════════════════════════════════════════════════════
// prepareAIInput_ACU — SQL 模式
// ═══════════════════════════════════════════════════════════════
describe('prepareAIInput_ACU — SQL 模式', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveSeedRows.mockReturnValue([]);
    mockRuntimeProvider.mode = 'sqlite';
    mockRuntimeProvider.getCurrentData.mockImplementation(() => mockCurrentJsonTableData);
    mockEnsureStorageProviderReady.mockReset().mockResolvedValue(mockRuntimeProvider);
    mockGetStorageRuntimeHealth.mockReturnValue({
      status: 'ready', expectedMode: 'sqlite', activeMode: 'sqlite', loadToken: 1,
    });
    mockIsSqliteMode = true;
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

  it('currentJsonTableData 为 null 时返回 runtime_export_null', async () => {
    mockCurrentJsonTableData = null;
    await expect(prepareAIInput_ACU([], 'standard')).resolves.toEqual({
      ok: false,
      failureCode: 'runtime_export_null',
      message: 'SQLite 运行时未导出可用表格数据。',
      retryable: true,
    });
  });

  it('SQLite runtime loading 时返回可操作的 failure code', async () => {
    mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('runtime pending'));
    mockGetStorageRuntimeHealth.mockReturnValueOnce({
      status: 'loading', expectedMode: 'sqlite', activeMode: null, loadToken: 2,
    });

    await expect(prepareAIInput_ACU([], 'standard')).resolves.toEqual({
      ok: false,
      failureCode: 'runtime_loading',
      message: 'SQLite 运行时正在加载，请等待加载完成后重试。',
      retryable: true,
    });
  });

  it('SQLite fallback 到 native 时返回 provider_fallback 而不是笼统 null', async () => {
    mockEnsureStorageProviderReady.mockRejectedValueOnce(new Error('provider fallback'));
    mockGetStorageRuntimeHealth.mockReturnValueOnce({
      status: 'degraded', expectedMode: 'sqlite', activeMode: 'native', loadToken: 2, failureCode: 'provider_fallback',
    });

    await expect(prepareAIInput_ACU([], 'standard')).resolves.toEqual({
      ok: false,
      failureCode: 'provider_fallback',
      message: 'SQLite 运行时加载失败，当前未使用 SQLite 数据库。',
      retryable: false,
    });
  });

  it('SQLite provider 导出空数据时返回 runtime_export_null', async () => {
    mockCurrentJsonTableData = null;

    await expect(prepareAIInput_ACU([], 'standard')).resolves.toEqual({
      ok: false,
      failureCode: 'runtime_export_null',
      message: 'SQLite 运行时未导出可用表格数据。',
      retryable: true,
    });
  });

  it('有 DDL 的表走 SQL 格式化路径', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quantity INTEGER);',
          note: '记录角色背包中的物品',
          insertNode: '获得新物品时插入',
          updateNode: '',
          deleteNode: '',
        },
        content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE inventory');
    expect(result!.tableDataText).not.toContain('CREATE TABLE beibaowupinbiao');
    expect(result!.tableDataText).toContain('SQL 写入必须严格使用本表上方 CREATE TABLE 中的表名 inventory；不得使用其他名称。');
    // 应输出 Note 注释
    expect(result!.tableDataText).toContain('-- Note: 记录角色背包中的物品');
    // 应输出当前数据（注释格式）
    expect(result!.tableDataText).toContain('-- 当前数据');
  });

  it('飞行模式 SQLite prompt 排除隐藏纪要行且不修改运行时物理数据', async () => {
    const chronicleRows = Array.from({ length: 20 }, (_, index) => [`c${index + 1}`, `纪要${index + 1}`]);
    mockCurrentJsonTableData = {
      sheet_chronicle: {
        name: '纪要表',
        sourceData: {
          ddl: 'CREATE TABLE chronicle (row_id TEXT PRIMARY KEY, event TEXT);',
        },
        content: [['row_id', 'event'], ...chronicleRows],
        updateConfig: {},
      },
      sheet_da_zong_jie: {
        name: '大总结',
        sourceData: { ddl: 'CREATE TABLE big_summary (row_id TEXT PRIMARY KEY, summary_text TEXT);' },
        content: [['row_id', 'summary_text'], ['s1', '此前大总结']],
        updateConfig: {},
      },
    };
    mockGetCurrentFlightModeState.mockReturnValue({
      enabled: true,
      hiddenRowIds: chronicleRows.slice(0, 5).map(row => row[0]),
      bigSummarySheetKey: 'sheet_da_zong_jie',
    });

    const result = await prepareAIInput_ACU([], 'standard');

    expect(result?.tableDataText).toContain('纪要6');
    expect(result?.tableDataText).toContain('纪要20');
    expect(result?.tableDataText).not.toContain('纪要5');
    expect(result?.tableDataText).not.toContain('summary table fixed limit');
    expect(result?.tableDataText).toContain('此前大总结');
    expect(mockCurrentJsonTableData.sheet_chronicle.content).toEqual([
      ['row_id', 'event'], ...chronicleRows,
    ]);
  });

  it('显式 sqlApplyScope 存在时，prompt 使用请求前模板的作者英文名而不是运行时 DDL 名', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        uid: 'inventory',
        name: '切换后模板表',
        sourceData: { ddl: 'CREATE TABLE runtime_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', '运行时数据']],
        updateConfig: {},
      },
    };
    const requestTemplate = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory',
        name: '请求前模板表',
        sourceData: { ddl: 'CREATE TABLE request_contract (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;

    const result = await prepareAIInput_ACU([], 'standard', null, {
      templateScope: { sheetKeys: new Set(['sheet_0']), sheets: { sheet_0: requestTemplate.sheet_0 } },
      sqlApplyScope: {
        isolationKey: 'scope-a',
        templateData: requestTemplate,
        templateDataWithRows: requestTemplate,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE request_contract');
    expect(result!.tableDataText).not.toContain('CREATE TABLE runtime_table');
    expect(result!.tableDataText).not.toContain('CREATE TABLE qingqiuqianmubanbiao');
    expect(result!.tableDataText).toContain('运行时数据');
  });
  it('SQL 活动投影剔除空业务表头表后，Prompt 只含有效表、不含休眠表', async () => {
    mockCurrentJsonTableData = {
      sheet_valid: {
        uid: 'valid_table',
        name: '有效表',
        sourceData: { ddl: 'CREATE TABLE valid_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', '有效数据']],
        updateConfig: {},
      },
      // 运行时仍保留历史数据，但模板侧因非首列空表头投影为休眠表。
      sheet_dormant: {
        uid: 'dormant_table',
        name: '空表头表',
        sourceData: { ddl: 'CREATE TABLE dormant_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', '历史数据']],
        updateConfig: {},
      },
    };
    const projectedTemplate = {
      mate: { type: 'acu', version: 1 },
      sheet_valid: {
        uid: 'valid_table',
        name: '有效表',
        sourceData: { ddl: 'CREATE TABLE valid_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;

    const result = await prepareAIInput_ACU([], 'standard', null, {
      // 投影后的模板：只有有效表，休眠表已被剔除（模拟 captureSqlTableApplyScope_ACU）。
      templateScope: {
        sheetKeys: new Set(['sheet_valid']),
        sheets: { sheet_valid: projectedTemplate.sheet_valid },
      },
      sqlApplyScope: {
        isolationKey: 'scope-dormant-prompt',
        templateData: projectedTemplate,
        templateDataWithRows: projectedTemplate,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE valid_table');
    expect(result!.tableDataText).not.toContain('dormant_table');
    expect(result!.tableDataText).not.toContain('空表头表');
  });

  it('全部模板表均为非首列空表头时，Prompt 不含任何表且不触发 fallback DDL 错误', async () => {
    mockCurrentJsonTableData = {
      sheet_a: {
        uid: 'dormant_a',
        name: '空表头A',
        sourceData: { ddl: 'CREATE TABLE dormant_a (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', 'a']],
        updateConfig: {},
      },
    };
    const allDormantTemplate = {
      mate: { type: 'acu', version: 1 },
      sheet_a: {
        uid: 'dormant_a',
        name: '空表头A',
        sourceData: { ddl: 'CREATE TABLE dormant_a (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', '']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;

    const result = await prepareAIInput_ACU([], 'standard', null, {
      templateScope: {
        sheetKeys: new Set(), // 已知无活动表（空集，不是 null）
        sheets: {},
      },
      sqlApplyScope: {
        isolationKey: 'scope-all-dormant-prompt',
        templateData: allDormantTemplate,
        templateDataWithRows: allDormantTemplate,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).not.toContain('CREATE TABLE');
    expect(result!.tableDataText).not.toContain('dormant_a');
    // 空集不等于 null：不应回退为不过滤导致运行时表重新出现。
    expect(result!.tableDataText).not.toContain('空表头A');
  });

  it('请求模板内作者 DDL 表名冲突时，仅冲突组降级为各自拼音物理名，不阻断整个 Prompt', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '甲表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_1: { name: '乙表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    // 冲突组不再使用冲突英文名，分别使用各自当前拼音物理名。
    expect(result!.tableDataText).not.toContain('CREATE TABLE shared_legacy');
    expect(result!.tableDataText).toContain('CREATE TABLE jiabiao');
    expect(result!.tableDataText).toContain('CREATE TABLE yibiao');
  });

  it('A/B 共用同一英文名时，仅 A/B 降级为各自物理名；唯一英文名 C 保持英文名', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '甲表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_1: { name: '乙表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_2: { name: '角色表', sourceData: { ddl: 'CREATE TABLE characters (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).not.toContain('CREATE TABLE shared_legacy');
    expect(result!.tableDataText).toContain('CREATE TABLE jiabiao');
    expect(result!.tableDataText).toContain('CREATE TABLE yibiao');
    // 唯一英文名 C 不受冲突组影响，继续使用英文名。
    expect(result!.tableDataText).toContain('CREATE TABLE characters');
    expect(result!.tableDataText).toContain('SQL 写入必须严格使用本表上方 CREATE TABLE 中的表名 characters；不得使用其他名称。');
  });

  it('英文名缺失的表降级为当前拼音物理名', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', sourceData: { note: '无 DDL' }, content: [['row_id', 'item_name'], ['1', '铁剑']], updateConfig: {} },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE beibaowupinbiao');
    expect(result!.tableDataText).toContain('-- WARNING: DDL 缺失，已使用运行时 fallback schema。 原始 DDL 未被改写。');
  });

  it('英文名大小写/引号规范化后相同的表视为同一冲突组，各自降级为物理名', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '甲表', sourceData: { ddl: 'CREATE TABLE "Shared_Legacy" (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_1: { name: '乙表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).not.toContain('Shared_Legacy');
    expect(result!.tableDataText).not.toContain('CREATE TABLE shared_legacy');
    expect(result!.tableDataText).toContain('CREATE TABLE jiabiao');
    expect(result!.tableDataText).toContain('CREATE TABLE yibiao');
  });

  it('英文名唯一时 Prompt 使用作者英文名，SQL 写入说明指向该英文名', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' }, content: [['row_id', 'item_name'], ['1', '铁剑']], updateConfig: {} },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE inventory');
    expect(result!.tableDataText).toContain('SQL 写入必须严格使用本表上方 CREATE TABLE 中的表名 inventory；不得使用其他名称。');
  });

  it('当前物理名本身冲突（拼音物理名碰撞）时前置失败，不得回退英文名掩盖真实 SQLite 冲突', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表', sourceData: { ddl: 'CREATE TABLE test_unique (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_1: { name: '测试表', sourceData: { ddl: 'CREATE TABLE test_other (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(typeof (result as any)?.failureCode).toBe('string');
  });


  it('r1: 改名后冲突组降级为各自新物理名，不沿用旧物理名', async () => {
    // 改名前：甲表/乙表 共用英文名 shared_legacy -> 降级为 jiabiao/yibiao。
    mockCurrentJsonTableData = {
      sheet_0: { name: '甲表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_1: { name: '乙表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
    };

    const before = await prepareAIInput_ACU([], 'standard');
    expect(before).not.toBeNull();
    expect(before!.tableDataText).toContain('CREATE TABLE jiabiao');
    expect(before!.tableDataText).toContain('CREATE TABLE yibiao');
    expect(before!.tableDataText).not.toContain('CREATE TABLE shared_legacy');

    // 改名后：sheet_0 显示名改为 背包物品表 -> 新物理名 beibaowupinbiao；英文名仍冲突。
    // 映射必须按本次 scope 重建，不得继续使用旧拼音物理名 jiabiao 作为新写入目标。
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
      sheet_1: { name: '乙表', sourceData: { ddl: 'CREATE TABLE shared_legacy (row_id INTEGER PRIMARY KEY);' }, content: [['row_id'], ['1']], updateConfig: {} },
    };

    const after = await prepareAIInput_ACU([], 'standard');
    expect(after).not.toBeNull();
    expect(after!.tableDataText).not.toContain('CREATE TABLE jiabiao');
    expect(after!.tableDataText).toContain('CREATE TABLE beibaowupinbiao');
    expect(after!.tableDataText).toContain('CREATE TABLE yibiao');
    expect(after!.tableDataText).not.toContain('CREATE TABLE shared_legacy');
  });

  it('r1: 改名后英文名仍唯一时 Prompt 保持英文名，映射按当前快照重算', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' }, content: [['row_id', 'item_name'], ['1', '铁剑']], updateConfig: {} },
    };

    const before = await prepareAIInput_ACU([], 'standard');
    expect(before).not.toBeNull();
    expect(before!.tableDataText).toContain('CREATE TABLE inventory');

    // 改名：显示名变化（物理名随之变化），英文名 inventory 仍唯一 -> Prompt 继续使用英文名。
    mockCurrentJsonTableData = {
      sheet_0: { name: '角色背包表', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' }, content: [['row_id', 'item_name'], ['1', '铁剑']], updateConfig: {} },
    };

    const after = await prepareAIInput_ACU([], 'standard');
    expect(after).not.toBeNull();
    expect(after!.tableDataText).toContain('CREATE TABLE inventory');
    expect(after!.tableDataText).toContain('SQL 写入必须严格使用本表上方 CREATE TABLE 中的表名 inventory；不得使用其他名称。');
  });

  it('无 DDL 的表在 SQLite 模式下使用 effective fallback DDL，且不使用 seedRows', async () => {
    mockGetEffectiveSeedRows.mockReturnValue([['9', '不应出现', '999']]);
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          note: '记录角色背包中的物品',
        },
        content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE beibaowupinbiao');
    expect(result!.tableDataText).toContain('-- WARNING: DDL 缺失，已使用运行时 fallback schema。 原始 DDL 未被改写。');
    expect(result!.tableDataText).toContain('-- | row_id | item_name | quantity |');
    expect(result!.tableDataText).not.toContain('不应出现');
  });

  it('显式 DDL 与遗留错序表头共存时按共享 columnMap 重排列名和行值', () => {
    const text = formatTableForSqliteMode({
      uid: 'chronicle',
      name: '纪要表',
      sourceData: {
        ddl: `CREATE TABLE chronicle (
          row_id INTEGER PRIMARY KEY, -- 行号
          code_index TEXT, -- 编码索引
          chronicle_text TEXT -- 纪要
        );`,
      },
      content: [['row_id', '纪要', '编码索引'], ['1', '完整纪要正文', 'AM0001']],
      updateConfig: {},
    }, 0, 'sheet_chronicle', null, { allowSeedRowsFallback: false });

    expect(text).toContain('-- | row_id | code_index | chronicle_text |');
    expect(text).toContain('-- | 1 | AM0001 | 完整纪要正文 |');
  });

  it('运行时建表失败 fallback 后，prompt 使用已采用的 runtime schema 而非原始 DDL', () => {
    const table: any = {
      uid: 'execution_broken',
      name: '执行失败回退表',
      sourceData: {
        ddl: 'CREATE TABLE execution_broken (row_id INTEGER PRIMARY KEY, item_name TEXT) INVALID_SUFFIX;',
      },
      content: [['row_id', '物品名称'], ['1', '铁剑']],
      updateConfig: {},
    };
    Object.defineProperty(table, '_acu_runtimeEffectiveSchema', {
      enumerable: false,
      value: {
        source: 'fallback_invalid',
        diagnostics: ['显式 DDL 无法在 runtime SQLite 执行，已使用 fallback schema。'],
        effectiveDDL: 'CREATE TABLE execution_broken (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  wu_pin_ming_cheng TEXT -- 物品名称\n);',
        columnMap: {
          mappings: [
            { sourceIndex: 0, displayName: 'row_id', sqlName: 'row_id', required: true },
            { sourceIndex: 1, displayName: '物品名称', sqlName: 'wu_pin_ming_cheng', required: false },
          ],
        },
      },
    });

    const text = formatTableForSqliteMode(table, 0, 'sheet_execution', null, {
      allowSeedRowsFallback: false,
      runtimeTableName: 'zhixinghuibiao',
      authoredTableName: 'execution_broken',
    });

    expect(text).toContain('CREATE TABLE execution_broken');
    expect(text).not.toContain('CREATE TABLE zhixinghuibiao');
    expect(text).toContain('wu_pin_ming_cheng TEXT');
    expect(text).toContain('-- | row_id | wu_pin_ming_cheng |');
    expect(text).not.toContain('INVALID_SUFFIX');
  });

  it('test31 无 DDL fallback + scope 隐藏列：Prompt 只出现 runtime actual 列，不出现错误拼写', () => {
    // 模拟 chat-scope-range.projectSheetForTemplateScope_ACU 投影后的运行时表：
    // sourceData 无 DDL（fallback），模板只声明了 row_id/时间范围/事件意义，
    // 其余列（大纲概要/相关人物/相关物品/编码索引）被合并进 hiddenPhysicalColumns。
    // 注意：无 DDL 表 getSheetColumnProjection_ACU 的 physicalName 回退到中文表头，
    // 因此 hiddenPhysicalColumns 记录的是中文表头名（与 resolveOutOfScopeColumns_ACU 一致）。
    const table: any = {
      uid: 'gushidagangbiao',
      name: '故事大纲表',
      sourceData: {
        hiddenPhysicalColumns: ['大纲概要', '相关人物', '相关物品', '编码索引'],
      },
      content: [
        ['row_id', '时间范围', '大纲概要', '事件意义', '相关人物', '相关物品', '编码索引'],
        ['1', '起点', '开局', '相遇', '主角', '信物', 'A001'],
      ],
      updateConfig: {},
    };
    // runtime effective schema 来自 SyncBridge 实际建表（拼音物理列）。
    Object.defineProperty(table, '_acu_runtimeEffectiveSchema', {
      enumerable: false,
      value: {
        source: 'fallback_missing',
        diagnostics: ['DDL 缺失，已使用运行时 fallback schema。'],
        effectiveDDL: 'CREATE TABLE gushidagangbiao (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  shi_jian_fan_wei TEXT, -- 时间范围\n  da_gang_gai_yao TEXT, -- 大纲概要\n  shi_jian_yi_yi TEXT, -- 事件意义\n  xiang_guan_ren_wu TEXT, -- 相关人物\n  xiang_guan_wu_pin TEXT, -- 相关物品\n  bian_ma_suo_yin TEXT -- 编码索引\n);',
        columnMap: {
          mappings: [
            { sourceIndex: 0, displayName: 'row_id', sqlName: 'row_id', required: true },
            { sourceIndex: 1, displayName: '时间范围', sqlName: 'shi_jian_fan_wei', required: false },
            { sourceIndex: 2, displayName: '大纲概要', sqlName: 'da_gang_gai_yao', required: false },
            { sourceIndex: 3, displayName: '事件意义', sqlName: 'shi_jian_yi_yi', required: false },
            { sourceIndex: 4, displayName: '相关人物', sqlName: 'xiang_guan_ren_wu', required: false },
            { sourceIndex: 5, displayName: '相关物品', sqlName: 'xiang_guan_wu_pin', required: false },
            { sourceIndex: 6, displayName: '编码索引', sqlName: 'bian_ma_suo_yin', required: false },
          ],
        },
      },
    });

    const text = formatTableForSqliteMode(table, 0, 'sheet_gushidagang', null, {
      allowSeedRowsFallback: false,
      runtimeTableName: 'gushidagangbiao',
      authoredTableName: 'gushidagangbiao',
    });

    // 表名保留作者表名。
    expect(text).toContain('CREATE TABLE gushidagangbiao');
    // 只出现 runtime actual 列（可见列）。
    expect(text).toContain('-- | row_id | shi_jian_fan_wei | shi_jian_yi_yi |');
    expect(text).toContain('-- | 1 | 起点 | 相遇 |');
    // 隐藏列从 DDL 与数据表头中剔除。
    expect(text).not.toContain('da_gang_gai_yao');
    expect(text).not.toContain('xiang_guan_ren_wu');
    expect(text).not.toContain('xiang_guan_wu_pin');
    expect(text).not.toContain('bian_ma_suo_yin');
    // 错误拼写绝不出现在 Prompt。
    expect(text).not.toContain('xi_xiang_guan_wu_pin');
    // DDL 中保留列的中文注释（列语义不丢失）。
    expect(text).toContain('shi_jian_fan_wei TEXT, -- 时间范围');
  });

  it('test31 组合链路：scope 投影隐藏列 + runtime schema 保留，Prompt 只含 SQLite 实际列', async () => {
    // 运行时表带 _acu_runtimeEffectiveSchema（SyncBridge 导出，无 DDL fallback）。
    const runtimeTable: any = {
      uid: 'gushidagangbiao',
      name: '故事大纲表',
      sourceData: {},
      content: [
        ['row_id', '时间范围', '大纲概要', '事件意义', '相关人物', '相关物品', '编码索引'],
        ['1', '起点', '开局', '相遇', '主角', '信物', 'A001'],
      ],
      updateConfig: {},
    };
    Object.defineProperty(runtimeTable, '_acu_runtimeEffectiveSchema', {
      enumerable: false,
      value: {
        source: 'fallback_missing',
        diagnostics: ['DDL 缺失，已使用运行时 fallback schema。'],
        effectiveDDL: 'CREATE TABLE gushidagangbiao (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  shi_jian_fan_wei TEXT, -- 时间范围\n  da_gang_gai_yao TEXT, -- 大纲概要\n  shi_jian_yi_yi TEXT, -- 事件意义\n  xiang_guan_ren_wu TEXT, -- 相关人物\n  xiang_guan_wu_pin TEXT, -- 相关物品\n  bian_ma_suo_yin TEXT -- 编码索引\n);',
        columnMap: {
          mappings: [
            { sourceIndex: 0, displayName: 'row_id', sqlName: 'row_id', required: true },
            { sourceIndex: 1, displayName: '时间范围', sqlName: 'shi_jian_fan_wei', required: false },
            { sourceIndex: 2, displayName: '大纲概要', sqlName: 'da_gang_gai_yao', required: false },
            { sourceIndex: 3, displayName: '事件意义', sqlName: 'shi_jian_yi_yi', required: false },
            { sourceIndex: 4, displayName: '相关人物', sqlName: 'xiang_guan_ren_wu', required: false },
            { sourceIndex: 5, displayName: '相关物品', sqlName: 'xiang_guan_wu_pin', required: false },
            { sourceIndex: 6, displayName: '编码索引', sqlName: 'bian_ma_suo_yin', required: false },
          ],
        },
      },
    });
    mockCurrentJsonTableData = { sheet_gushidagang: runtimeTable };

    // 模板只声明 row_id/时间范围/事件意义 → scope 投影会把其余列并入 hiddenPhysicalColumns。
    const scopeTemplate = {
      mate: { type: 'acu', version: 1 },
      sheet_gushidagang: {
        uid: 'gushidagangbiao',
        name: '故事大纲表',
        sourceData: { note: '' },
        content: [['row_id', '时间范围', '事件意义']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;

    const result = await prepareAIInput_ACU([], 'standard', null, {
      templateScope: {
        sheetKeys: new Set(['sheet_gushidagang']),
        sheets: { sheet_gushidagang: scopeTemplate.sheet_gushidagang },
      },
      sqlApplyScope: {
        isolationKey: 'scope-test31-chain',
        templateData: scopeTemplate,
        templateDataWithRows: scopeTemplate,
      },
    });

    expect(result).not.toBeNull();
    const text = result!.tableDataText;
    // 表名保留作者表名。
    expect(text).toContain('CREATE TABLE gushidagangbiao');
    // Prompt 只出现 runtime actual 可见列。
    expect(text).toContain('-- | row_id | shi_jian_fan_wei | shi_jian_yi_yi |');
    expect(text).toContain('-- | 1 | 起点 | 相遇 |');
    // 隐藏列与错误拼写不出现。
    expect(text).not.toContain('da_gang_gai_yao');
    expect(text).not.toContain('xiang_guan_ren_wu');
    expect(text).not.toContain('xiang_guan_wu_pin');
    expect(text).not.toContain('xi_xiang_guan_wu_pin');
  });

  it('执行期 fallback 经真实 export 和 runtime provider 后，prompt 仍使用实际 schema', async () => {
    const engine = new SqliteEngine();
    const bridge = new SyncBridge(engine);
    const originalDdl = 'CREATE TABLE execution_broken (row_id INTEGER PRIMARY KEY, -- 行号\nitem_name TEXT -- 物品名称\n) INVALID_SUFFIX;';
    try {
      await engine.init();
      bridge.loadFromTableData({
        mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: {} },
        sheet_execution: {
          uid: 'execution_broken',
          name: '执行失败回退表',
          sourceData: { ddl: originalDdl },
          content: [['row_id', '物品名称'], ['1', '铁剑']],
          updateConfig: {},
          exportConfig: {},
          orderNo: 0,
        },
      } as any, { strict: true, allowRuntimeDdlFallback: true });
      mockCurrentJsonTableData = bridge.exportToTableData({
        type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: {},
      } as any);

      const result = await prepareAIInput_ACU([], 'standard');

      expect(result!.tableDataText).toContain('wu_pin_ming_cheng TEXT');
      expect(result!.tableDataText).toContain('-- | row_id | wu_pin_ming_cheng |');
      expect(result!.tableDataText).not.toContain('INVALID_SUFFIX');
      expect((mockCurrentJsonTableData as any).sheet_execution.sourceData.ddl).toBe(originalDdl);
    } finally {
      engine.dispose();
    }
  });

  it('SQL 模式下 $0 不直接从模板 seedRows 兜底，数据必须来自运行时 DB', async () => {
    mockGetEffectiveSeedRows.mockReturnValue([['1', '格里芬临时基地-指挥室', '2062-07-18 14:35', 1]]);
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '当前位置',
        sourceData: {
          ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, current_location TEXT, cur_time TEXT, day_count INTEGER);',
          note: '记录当前位置。',
        },
        content: [['row_id', '当前位置', '当前时间', '天数']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('-- (该表格为空，请进行初始化。)');
    expect(result!.tableDataText).not.toContain('格里芬临时基地-指挥室');
  });

  it('SQL 编辑格式说明被追加到 tableDataText 末尾', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        },
        content: [['row_id'], ['1']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('SQL 编辑格式说明');
    expect(result!.tableDataText).toContain('INSERT INTO');
    expect(result!.tableDataText).toContain('INSERT OR REPLACE INTO');
    expect(result!.tableDataText).toContain('REPLACE INTO');
    expect(result!.tableDataText).toContain('普通 INSERT 必须显式列出业务列，不得包含 row_id');
    expect(result!.tableDataText).toContain('row_id 由系统在执行前分配稳定身份');
    expect(result!.tableDataText).not.toContain('row_id 值为当前表最大 row_id + 1');
    expect(result!.tableDataText).toContain('UNIQUE 约束');
    expect(result!.tableDataText).toContain('SQL 表名和列名必须严格照抄上方对应 CREATE TABLE 中提供的标识符，不得翻译、缩写、猜测或改写。');
    expect(result!.tableDataText).toContain('<tableEdit> 标签内');
    expect(result!.tableDataText).toContain('表达式更新');
    expect(result!.tableDataText).toContain('按 SQLite 原生整行替换语义执行');
  });

  it('strict JSON 模式沿用同一英文标识符契约', async () => {
    mockSettings.strictJsonTableFillEnabled = true;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
        content: [['row_id', 'item_name'], ['1', '铁剑']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE inventory');
    expect(result!.tableDataText).not.toContain('CREATE TABLE beibaowupinbiao');
    expect(result!.tableDataText).toContain('响应 JSON 的 sql 字符串中');
    expect(result!.tableDataText).toContain('SQL 表名和列名必须严格照抄上方对应 CREATE TABLE 中提供的标识符，不得翻译、缩写、猜测或改写。');
  });

  it('固定 row_id 约束不再生成专用 REPLACE 许可注释', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '鉴定建议表',
        sourceData: {
          ddl: 'CREATE TABLE advice (row_id INTEGER PRIMARY KEY CHECK (row_id BETWEEN 1 AND 5), advice TEXT);',
        },
        content: [['row_id', 'advice'], ['1', '先鉴定']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).not.toContain('-- REPLACE:');
  });

  it('普通表同样声明 REPLACE 原生语义而不生成专用许可注释', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);',
        },
        content: [['row_id', 'item_name'], ['1', '铁剑']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).not.toContain('-- REPLACE:');
    expect(result!.tableDataText).toContain('按 SQLite 原生整行替换语义执行');
  });

  it('非 SQL 模式下不追加 SQL 编辑格式说明', async () => {
    mockIsSqliteMode = false;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          note: '记录角色背包中的物品',
        },
        content: [['row_id', 'item_name'], ['1', '铁剑']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.tableDataText).not.toContain('SQL 编辑格式说明');
  });

  it('混合表格：有 DDL 和无 DDL 的表共存', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);',
          note: '背包',
        },
        content: [['row_id', 'item_name'], ['1', '铁剑']],
        updateConfig: {},
      },
      sheet_1: {
        name: '角色表',
        sourceData: {
          note: '角色信息',
          // 无 DDL
        },
        content: [['row_id', 'name'], ['1', '角色A']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    // 有 DDL 的表走 SQL 格式化
    expect(result!.tableDataText).toContain('CREATE TABLE inventory');
    // 无 DDL 的表也必须走 SQL effective fallback，避免模型收到无法执行的原生 DSL。
    expect(result!.tableDataText).toContain('CREATE TABLE juesebiao');
    expect(result!.tableDataText).toContain('-- | row_id | name |');
  });

  it('SQL 模式下显式 tableData 作为本批次行数据，不再被 live runtime 覆盖', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '运行时表',
        sourceData: {
          ddl: 'CREATE TABLE runtime_table (row_id INTEGER PRIMARY KEY, value TEXT);',
        },
        content: [['row_id', 'value'], ['1', '运行时值']],
        updateConfig: {},
      },
    };
    const explicitTableData = {
      sheet_0: {
        name: '显式快照表',
        sourceData: {
          ddl: 'CREATE TABLE explicit_table (row_id INTEGER PRIMARY KEY, value TEXT);',
        },
        content: [['row_id', 'value'], ['1', '显式快照值']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard', null, { tableData: explicitTableData });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE explicit_table');
    expect(result!.tableDataText).toContain('显式快照值');
    expect(result!.tableDataText).not.toContain('runtime_table');
    expect(result!.tableDataText).not.toContain('运行时值');
  });

  it('targetSheetKeys 过滤只输出指定表', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);',
        },
        content: [['row_id'], ['1']],
        updateConfig: {},
      },
      sheet_1: {
        name: '角色表',
        sourceData: {
          ddl: 'CREATE TABLE characters (row_id INTEGER PRIMARY KEY);',
        },
        content: [['row_id'], ['1']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard', ['sheet_1']);
    expect(result).not.toBeNull();
    // 只输出 sheet_1
    expect(result!.tableDataText).toContain('CREATE TABLE characters');
    expect(result!.tableDataText).not.toContain('CREATE TABLE inventory');
  });

  it('对话消息被正确格式化', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);' },
        content: [['row_id'], ['1']],
        updateConfig: {},
      },
    };

    const messages = [
      { is_user: true, mes: '你好' },
      { is_user: false, name: '角色', mes: '你好啊' },
    ];

    const result = await prepareAIInput_ACU(messages, 'standard');
    expect(result).not.toBeNull();
    expect(result!.messagesText).toContain('用户: 你好');
    expect(result!.messagesText).toContain('角色: 你好啊');
  });

  it('空消息数组时输出无最新对话内容', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY);' },
        content: [['row_id'], ['1']],
        updateConfig: {},
      },
    };

    const result = await prepareAIInput_ACU([], 'standard');
    expect(result).not.toBeNull();
    expect(result!.messagesText).toContain('无最新对话内容');
  });

  it('sqlApplyScope.runtimeData 冻结数据优先于 live provider，且不再次读取 provider', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: 'live 表',
        sourceData: { ddl: 'CREATE TABLE live_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', 'live 值']],
        updateConfig: {},
      },
    };
    const frozenRuntimeData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory', name: '冻结表',
        sourceData: { ddl: 'CREATE TABLE frozen_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', '冻结值']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    };
    mockEnsureStorageProviderReady.mockClear();

    const result = await prepareAIInput_ACU([], 'standard', null, {
      sqlApplyScope: {
        isolationKey: 'scope-frozen-prompt',
        templateData: frozenRuntimeData,
        templateDataWithRows: frozenRuntimeData,
        activeSheetKeys: ['sheet_0'],
        skippedSheets: [],
        runtimeData: frozenRuntimeData,
      } as any,
    });

    expect(result).not.toBeNull();
    // Prompt 使用冻结数据，而非 live provider 数据。
    expect(result!.tableDataText).toContain('CREATE TABLE frozen_table');
    expect(result!.tableDataText).toContain('冻结值');
    expect(result!.tableDataText).not.toContain('CREATE TABLE live_table');
    expect(result!.tableDataText).not.toContain('live 值');
    // 关键：不得再次读取 provider（冻结路径直接返回）。
    expect(mockEnsureStorageProviderReady).not.toHaveBeenCalled();
  });

  it('显式 tableData 行数据优先于 sqlApplyScope.runtimeData 冻结行', async () => {
    const frozenRuntimeData: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory', name: '冻结表',
        sourceData: { ddl: 'CREATE TABLE frozen_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    };
    const bucketSnapshot: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory', name: '冻结表',
        sourceData: { ddl: 'CREATE TABLE frozen_table (row_id INTEGER PRIMARY KEY, value TEXT);' },
        content: [['row_id', 'value'], ['1', '第一批结果']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    };
    mockEnsureStorageProviderReady.mockClear();

    const result = await prepareAIInput_ACU([], 'standard', null, {
      tableData: bucketSnapshot,
      sqlApplyScope: {
        isolationKey: 'scope-frozen-prompt',
        templateData: frozenRuntimeData,
        templateDataWithRows: frozenRuntimeData,
        activeSheetKeys: ['sheet_0'],
        skippedSheets: [],
        runtimeData: frozenRuntimeData,
      } as any,
    });

    expect(result).not.toBeNull();
    expect(result!.tableDataText).toContain('CREATE TABLE frozen_table');
    expect(result!.tableDataText).toContain('第一批结果');
    expect(result!.tableDataText).not.toContain('该表格为空');
    expect(mockEnsureStorageProviderReady).not.toHaveBeenCalled();
  });

  it('sqlApplyScope.runtimeSchemaFailure 存在时返回 failure，不读取 provider', async () => {
    mockEnsureStorageProviderReady.mockClear();
    const result = await prepareAIInput_ACU([], 'standard', null, {
      sqlApplyScope: {
        isolationKey: 'scope-failure-prompt',
        activeSheetKeys: [],
        skippedSheets: [],
        runtimeSchemaFailure: {
          code: 'SQL_RUNTIME_SCHEMA_INVALID_ACU',
          message: 'SQLite runtime 未导出表格数据，无法冻结 schema。',
        },
      } as any,
    });

    expect(result).not.toBeNull();
    expect((result as any).ok).toBe(false);
    expect(String((result as any).failureCode)).toBe('runtime_schema_invalid');
    expect((result as any).retryable).toBe(false);
    expect(mockEnsureStorageProviderReady).not.toHaveBeenCalled();
  });

});
