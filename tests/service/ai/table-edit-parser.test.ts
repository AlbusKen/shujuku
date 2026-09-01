/**
 * tests/service/ai/table-edit-parser.test.ts
 * AI 响应表格编辑解析器单元测试
 *
 * 策略：
 * - extractTableEditInner_ACU 是纯函数（只依赖 settings_ACU），mock settings 后直接测试
 * - isSqlContent 是纯函数，直接测试
 * - parseAndApplyTableEdits_ACU 的 SQL 分支通过 mock isSqliteMode + getStorageProvider 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

let mockSettings: any = { tableEditLastPairOnly: false };
let mockCurrentJsonTableData: any = null;

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
}));

let mockIsSqliteMode = false;
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => mockIsSqliteMode),
}));

const mockApplyEdits = vi.fn().mockReturnValue({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 });
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(() => ({
    applyEdits: mockApplyEdits,
  })),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  ensureStableRowIdsForSeedRows_ACU: (rows: any[]) => {
    let nextId = 1;
    const used = new Set(rows.map(row => String(row?.[0] ?? '').trim()).filter(Boolean));
    return rows.map(row => {
      const copy = Array.isArray(row) ? [...row] : [];
      if (String(copy[0] ?? '').trim()) return copy;
      while (used.has(String(nextId))) nextId += 1;
      copy[0] = String(nextId);
      used.add(copy[0]);
      return copy;
    });
  },
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  applySummaryIndexSequenceToTable_ACU: vi.fn(),
  formatSummaryIndexCode_ACU: vi.fn(() => '001'),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => -1),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set(), cols: new Set(), cells: new Set() })),
}));

vi.mock('../../../src/service/ai/prompt-builder/json-sanitizer', () => ({
  sanitizeJsonPipeline_ACU: vi.fn(() => ({ success: false, result: '', layersApplied: [], error: 'mock' })),
  coerceLooseRowObject_ACU: vi.fn(() => ({ success: false, error: 'mock' })),
}));

import {
  extractTableEditInner_ACU,
  parseAndApplyTableEdits_ACU,
  parseAndApplyTableEditsToData_ACU,
  isSqlContent,
} from '../../../src/service/ai/prompt-builder/table-edit-parser';

// ═══════════════════════════════════════════════════════════════
// isSqlContent
// ═══════════════════════════════════════════════════════════════
describe('isSqlContent', () => {
  it('INSERT 开头返回 true', () => {
    expect(isSqlContent("INSERT INTO inventory VALUES (1, '铁剑', 3);")).toBe(true);
  });

  it('UPDATE 开头返回 true', () => {
    expect(isSqlContent('UPDATE inventory SET quantity = 5 WHERE row_id = 1;')).toBe(true);
  });

  it('DELETE 开头返回 true', () => {
    expect(isSqlContent('DELETE FROM inventory WHERE row_id = 1;')).toBe(true);
  });

  it('ALTER 开头返回 true', () => {
    expect(isSqlContent('ALTER TABLE inventory ADD COLUMN desc TEXT;')).toBe(true);
  });

  it('BEGIN 开头返回 true', () => {
    expect(isSqlContent('BEGIN TRANSACTION;')).toBe(true);
  });

  it('CREATE 开头返回 true', () => {
    expect(isSqlContent('CREATE TABLE new_table (id INTEGER);')).toBe(true);
  });

  it('DROP 开头返回 true', () => {
    expect(isSqlContent('DROP TABLE old_table;')).toBe(true);
  });

  it('REPLACE 开头返回 true', () => {
    expect(isSqlContent("REPLACE INTO inventory VALUES (1, '铁剑', 3);")).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isSqlContent("insert into inventory values (1, '铁剑', 3);")).toBe(true);
  });

  it('跳过空行后检测', () => {
    expect(isSqlContent("\n\n  INSERT INTO inventory VALUES (1);")).toBe(true);
  });

  it('跳过 SQL 注释行后检测', () => {
    expect(isSqlContent("-- 这是注释\nINSERT INTO inventory VALUES (1);")).toBe(true);
  });

  it('跳过 HTML 注释残留后检测', () => {
    expect(isSqlContent("<!--\n-->\nINSERT INTO inventory VALUES (1);")).toBe(true);
  });

  it('insertRow 指令不是 SQL', () => {
    expect(isSqlContent("insertRow(0, {0: '铁剑', 1: '3'})")).toBe(false);
  });

  it('updateRow 指令不是 SQL', () => {
    expect(isSqlContent("updateRow(0, 1, {0: '铁剑'})")).toBe(false);
  });

  it('deleteRow 指令不是 SQL', () => {
    expect(isSqlContent('deleteRow(0, 1)')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isSqlContent('')).toBe(false);
  });

  it('纯注释返回 false', () => {
    expect(isSqlContent('-- 只有注释\n-- 没有语句')).toBe(false);
  });

  it('纯空白返回 false', () => {
    expect(isSqlContent('   \n\t  ')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// extractTableEditInner_ACU
// ═══════════════════════════════════════════════════════════════
describe('extractTableEditInner_ACU', () => {
  beforeEach(() => {
    mockSettings = { tableEditLastPairOnly: false };
  });

  it('提取完整 <tableEdit> 标签内容', () => {
    const text = '一些文字 <tableEdit>insertRow(0, {0: "铁剑"})</tableEdit> 更多文字';
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
    expect(result!.inner).toBe('insertRow(0, {0: "铁剑"})');
    expect(result!.mode).toBe('full');
  });

  it('大小写不敏感', () => {
    const text = '<TABLEEDIT>insertRow(0, {})</TABLEEDIT>';
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
    expect(result!.inner).toContain('insertRow');
  });

  it('useLastPairOnly 模式取最后一对', () => {
    mockSettings = { tableEditLastPairOnly: true };
    const text = '<tableEdit>第一个</tableEdit> 中间文字 <tableEdit>第二个</tableEdit>';
    const result = extractTableEditInner_ACU(text, { useLastPairOnly: true });
    expect(result).not.toBeNull();
    expect(result!.inner).toBe('第二个');
    expect(result!.mode).toBe('full_last');
  });

  it('HTML 注释中的指令（comment_fallback）', () => {
    const text = '<!-- insertRow(0, {0: "铁剑"}) -->';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: true });
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('comment_fallback');
  });

  it('只有开标签时从注释中提取', () => {
    const text = '<tableEdit> <!-- insertRow(0, {0: "铁剑"}) -->';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: true });
    expect(result).not.toBeNull();
    expect(result!.hasOpen).toBe(true);
  });

  it('只有闭标签时从注释中提取', () => {
    const text = '<!-- insertRow(0, {0: "铁剑"}) --> </tableEdit>';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: true });
    expect(result).not.toBeNull();
    expect(result!.hasClose).toBe(true);
  });

  it('空字符串返回 null', () => {
    expect(extractTableEditInner_ACU('')).toBeNull();
  });

  it('无任何指令返回 null', () => {
    expect(extractTableEditInner_ACU('这是一段普通文字，没有任何指令')).toBeNull();
  });

  it('allowNoTableEditTags=false 且无标签时返回 null', () => {
    const text = '<!-- insertRow(0, {0: "铁剑"}) -->';
    const result = extractTableEditInner_ACU(text, { allowNoTableEditTags: false });
    expect(result).toBeNull();
  });

  it('处理 AI 响应中的转义字符', () => {
    const text = "'<tableEdit>insertRow(0, {0: \"铁剑\"})</tableEdit>'";
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
  });

  it('处理字符串拼接残留', () => {
    const text = "' + '<tableEdit>insertRow(0, {})</tableEdit>' + '";
    const result = extractTableEditInner_ACU(text);
    expect(result).not.toBeNull();
  });
});

describe('strict JSON parseAndApplyTableEditsToData_ACU', () => {
  beforeEach(() => {
    mockSettings = { tableEditLastPairOnly: false, strictJsonTableFillEnabled: true };
    mockIsSqliteMode = false;
  });

  it('直接解析并应用 table_edit_ops_v1', () => {
    const data = {
      sheet_0: {
        uid: 'sheet_0',
        name: '角色状态',
        content: [
          ['row_id', '姓名', '状态'],
          ['1', '小玉', '正常'],
        ],
      },
    };
    const response = JSON.stringify({
      format: 'table_edit_ops_v1',
      ops: [{ op: 'update', sheet: '角色状态', where: { 姓名: '小玉' }, set: { 状态: '疲惫' } }],
    });
    const result: any = parseAndApplyTableEditsToData_ACU(response, data);
    expect(result.success).toBe(true);
    expect(data.sheet_0.content[1][2]).toBe('疲惫');
  });

  it('strict 开启时 legacy 裸响应解析失败', () => {
    const data = { sheet_0: { uid: 'sheet_0', name: '表', content: [['row_id', '字段']] } };
    const result: any = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow(0,{"0":"x"})</tableEdit>', data);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseAndApplyTableEdits_ACU — SQL 分支
// ═══════════════════════════════════════════════════════════════
describe('parseAndApplyTableEdits_ACU — SQL 分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { tableEditLastPairOnly: false };
    mockIsSqliteMode = true;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']],
        updateConfig: {},
      },
    };
  });

  it('SQLite 模式下 SQL 内容不能由解析器直接执行', () => {
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 });

    expect(() => parseAndApplyTableEdits_ACU(aiResponse, 'standard')).toThrow('table update commit model');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('SQLite 模式下非 SQL 内容走原生解析路径', () => {
    const aiResponse = "<tableEdit>insertRow(0, {0: '药水', 1: '5'})</tableEdit>";
    mockApplyEdits.mockClear();

    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    // 非 SQL 内容不应调用 provider.applyEdits
    expect(mockApplyEdits).not.toHaveBeenCalled();
    // 应该走原生解析路径
    expect(result).toHaveProperty('success');
  });

  it('非 SQLite 模式下 SQL 内容走原生解析路径', () => {
    mockIsSqliteMode = false;
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockClear();

    parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('SQLite SQL 内容在解析器阶段直接拒绝，不调用 provider', () => {
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockImplementation(() => { throw new Error('SQL 语法错误'); });

    expect(() => parseAndApplyTableEdits_ACU(aiResponse, 'standard')).toThrow('table update commit model');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });

  it('currentJsonTableData 为 null 时返回 false', () => {
    mockCurrentJsonTableData = null;
    const result = parseAndApplyTableEdits_ACU("<tableEdit>INSERT INTO t VALUES (1);</tableEdit>");
    expect(result).toBe(false);
  });

  it('空 <tableEdit> 块返回 true', () => {
    const result = parseAndApplyTableEdits_ACU('<tableEdit></tableEdit>');
    expect(result).toBe(true);
  });

  it('SQLite SQL 内容不会把 updateMode 传给 provider 直写', () => {
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockReturnValue({ success: true, modifiedKeys: [], appliedEdits: 1 });

    expect(() => parseAndApplyTableEdits_ACU(aiResponse, 'auto_standard')).toThrow('table update commit model');
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// parseAndApplyTableEdits_ACU — DSL 分支（insertRow/updateRow/deleteRow）
// ═══════════════════════════════════════════════════════════════
describe('parseAndApplyTableEdits_ACU — DSL 分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { tableEditLastPairOnly: false };
    mockIsSqliteMode = false;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '背包物品表',
        content: [
          ['row_id', 'item_name', 'quantity'],
          ['1', '铁剑', '3'],
          ['2', '药水', '5'],
        ],
        updateConfig: {},
      },
    };
  });

  it('insertRow 指令正确插入新行', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "盾牌", "1": "1"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    // 验证表格数据被修改（新行被插入）
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(4); // 表头 + 原2行 + 新1行
  });

  it('删除中间行后插入使用最大 row_id 加一，并保留 0 和 false 单元格', () => {
    mockCurrentJsonTableData.sheet_0.content = [
      ['row_id', 'item_name', 'quantity'],
      ['1', '铁剑', '3'],
      ['2', '药水', '5'],
      ['3', '盾牌', '1'],
    ];

    const result = parseAndApplyTableEdits_ACU(
      '<tableEdit>deleteRow(0, 1)\ninsertRow(0, {"0": 0, "1": false})</tableEdit>',
      'standard',
    );

    expect(result).toHaveProperty('success');
    expect(mockCurrentJsonTableData.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'quantity'],
      ['1', '铁剑', '3'],
      ['3', '盾牌', '1'],
      ['4', 0, false],
    ]);
  });

  it('insertRow 指令中的 URL 不会被行尾注释逻辑截断', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "https://example.com/a//b?x=1#hash", "1": "1"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(4);
    expect(content[3][1]).toBe('https://example.com/a//b?x=1#hash');
  });

  it('命令闭合后的真实行尾注释会被剥离且不影响 URL 字符串值', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "https://example.com/a//b", "1": "2"}) // 模型追加说明</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(4);
    expect(content[3][1]).toBe('https://example.com/a//b');
    expect(content[3][2]).toBe('2');
  });

  it('deleteRow 指令正确删除行', () => {
    const aiResponse = '<tableEdit>deleteRow(0, 1)</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    // 验证行被删除
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(2); // 表头 + 剩余1行
  });

  it('行锁阻止 deleteRow：锁定行保留（与 SQL 模式回滚语义一致）', async () => {
    const { getTableLocksForSheet_ACU } = await import('../../../src/service/runtime/helpers-remaining');
    vi.mocked(getTableLocksForSheet_ACU).mockReturnValueOnce({ rows: new Set([1]), cols: new Set(), cells: new Set() } as any);
    const before = JSON.parse(JSON.stringify(mockCurrentJsonTableData.sheet_0.content));

    parseAndApplyTableEdits_ACU('<tableEdit>deleteRow(0, 1)</tableEdit>', 'standard');

    expect(mockCurrentJsonTableData.sheet_0.content).toEqual(before);
    // 查锁时必须传入工作副本 content，身份锁才能按当前副本解析索引
    expect(vi.mocked(getTableLocksForSheet_ACU)).toHaveBeenCalledWith('sheet_0', mockCurrentJsonTableData.sheet_0.content);
  });

  it('行锁阻止 updateRow：锁定行的值不变', async () => {
    const { getTableLocksForSheet_ACU } = await import('../../../src/service/runtime/helpers-remaining');
    vi.mocked(getTableLocksForSheet_ACU).mockReturnValueOnce({ rows: new Set([1]), cols: new Set(), cells: new Set() } as any);

    parseAndApplyTableEdits_ACU('<tableEdit>updateRow(0, 1, {"1": "99"})</tableEdit>', 'standard');

    expect(mockCurrentJsonTableData.sheet_0.content[2][2]).not.toBe('99');
  });

  it('updateRow 指令正确更新行', () => {
    const aiResponse = '<tableEdit>updateRow(0, 1, {"1": "10"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    // updateRow(0, 1, {"1": "10"}) → content[rowIndex+1][colIndex+1] = content[2][2]
    // rowIndex=1 对应第2行数据行（content[2]），colIndex=1 对应第2列数据列（content[][2]）
    expect(mockCurrentJsonTableData.sheet_0.content[2][2]).toBe('10');
  });

  it('多条指令按顺序执行', () => {
    const aiResponse = '<tableEdit>insertRow(0, {"0": "盾牌", "1": "1"})\ninsertRow(0, {"0": "头盔", "1": "2"})</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    expect(result).toHaveProperty('success');
    const content = mockCurrentJsonTableData.sheet_0.content;
    expect(content.length).toBe(5); // 表头 + 原2行 + 新2行
  });

  it('无法识别的指令不报错', () => {
    const aiResponse = '<tableEdit>unknownCommand(0, 1)</tableEdit>';
    const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    // 无法识别的指令应被跳过，不影响整体结果
    expect(result).toHaveProperty('success');
  });

  it('非 SQLite 模式下 SQL 内容走 DSL 解析路径', () => {
    mockIsSqliteMode = false;
    const aiResponse = "<tableEdit>INSERT INTO inventory VALUES (2, '药水', 5);</tableEdit>";
    mockApplyEdits.mockClear();
    parseAndApplyTableEdits_ACU(aiResponse, 'standard');
    // 非 SQLite 模式不应调用 provider.applyEdits
    expect(mockApplyEdits).not.toHaveBeenCalled();
  });
});

describe('parseAndApplyTableEditsToData_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { tableEditLastPairOnly: false };
    mockIsSqliteMode = false;
    mockCurrentJsonTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '全局表',
        content: [
          ['row_id', 'item_name', 'quantity'],
          ['1', '全局铁剑', '3'],
        ],
        updateConfig: {},
      },
    };
  });

  it('显式 tableData 修改只作用于传入对象，不污染全局 currentJsonTableData_ACU', () => {
    const explicitTableData = {
      sheet_0: {
        uid: 'sheet_0',
        name: '显式表',
        content: [['row_id', 'item_name', 'quantity'], ['1', '显式铁剑', '3']],
        updateConfig: {},
      },
    };

    const result = parseAndApplyTableEditsToData_ACU('<tableEdit>insertRow(0, {"0": "显式药水", "1": "5"})</tableEdit>', explicitTableData, 'standard');
    expect(result).toHaveProperty('success');
    expect(explicitTableData.sheet_0.content).toHaveLength(3);
    expect(explicitTableData.sheet_0.content[2][1]).toBe('显式药水');
    expect(mockCurrentJsonTableData.sheet_0.content).toHaveLength(2);
    expect(mockCurrentJsonTableData.sheet_0.content[1][1]).toBe('全局铁剑');
  });

  it('与 V2 replay DSL 对同一删除和连续插入序列产生完全一致的 content', async () => {
    const parserData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory', name: '显式表', updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 0,
        content: [['row_id', 'item_name', 'enabled'], ['1', '铁剑', true], ['3', '药水', true], ['alpha', '护符', true]],
      },
    } as any;
    const replayData = JSON.parse(JSON.stringify(parserData));
    const text = '<tableEdit>deleteRow(0, 1)\ninsertRow(0, {"0": 0, "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})</tableEdit>';
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult = parseAndApplyTableEditsToData_ACU(text, parserData, 'standard');
    await applyTableOperationV2_ACU(replayData, {
      kind: 'table_edit_dsl',
      text: 'deleteRow(0, 1)\ninsertRow(0, {"0": 0, "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})',
    } as any);

    expect(parserResult).toHaveProperty('success');
    expect(parserData.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'enabled'],
      ['1', '铁剑', true],
      ['alpha', '护符', true],
      ['2', 0, false],
      ['3', '卷轴', true],
    ]);
    expect(replayData.sheet_0.content).toEqual(parserData.sheet_0.content);
  });

  it('与 V2 replay DSL 对 header-only seedRows 的删除、更新和插入产生完全一致的 content', async () => {
    const parserData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'sheet_0', name: '带预置行的表', updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 0,
        content: [['row_id', 'item_name', 'enabled']],
        seedRows: [['1', '铁剑', true], ['3', '药水', true]],
      },
    } as any;
    const replayData = JSON.parse(JSON.stringify(parserData));
    const text = '<tableEdit>deleteRow(0, 1)\nupdateRow(0, 0, {"0": "钢剑", "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})</tableEdit>';
    const { applyTableOperationV2_ACU } = await import('../../../src/service/table/storage-frame-v2-replay');

    const parserResult = parseAndApplyTableEditsToData_ACU(text, parserData, 'standard');
    await applyTableOperationV2_ACU(replayData, {
      kind: 'table_edit_dsl',
      text: 'deleteRow(0, 1)\nupdateRow(0, 0, {"0": "钢剑", "1": false})\ninsertRow(0, {"0": "卷轴", "1": true})',
    } as any);

    expect(parserResult).toHaveProperty('success');
    expect(parserData.sheet_0.content).toEqual([
      ['row_id', 'item_name', 'enabled'],
      ['1', '钢剑', false],
      ['2', '卷轴', true],
    ]);
    expect(replayData.sheet_0.content).toEqual(parserData.sheet_0.content);
  });

  it('物化新 seedRows 时为缺失 row_id 分配稳定身份，而不把空身份交给 V2 persist', () => {
    const data = {
      sheet_0: {
        uid: 'sheet_0', name: '带空身份预置行的表', updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 0,
        content: [['row_id', 'item_name']],
        seedRows: [['', '铁剑'], [null, '药水'], ['fixed', '护符']],
      },
    } as any;

    const result = parseAndApplyTableEditsToData_ACU('<tableEdit>updateRow(0, 0, {"0": "钢剑"})</tableEdit>', data, 'standard');

    expect(result).toMatchObject({ success: true, appliedEdits: 1 });
    expect(data.sheet_0.content).toEqual([
      ['row_id', 'item_name'],
      ['1', '钢剑'],
      ['2', '药水'],
      ['fixed', '护符'],
    ]);
    expect(data.sheet_0.seedRows).toEqual([['', '铁剑'], [null, '药水'], ['fixed', '护符']]);
  });
});
