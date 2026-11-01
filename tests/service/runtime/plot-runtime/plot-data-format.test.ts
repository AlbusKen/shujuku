/**
 * tests/service/runtime/plot-runtime/plot-data-format.test.ts
 * 剧情数据格式化纯函数 单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('总结') || name.includes('大纲') || name.includes('纪要')),
  isStandardTable_ACU: vi.fn((name: string) => !name.includes('总结') && !name.includes('大纲') && !name.includes('纪要')),
}));

vi.mock('../../../../src/service/runtime/helpers-table-lock', () => ({
  getSummaryIndexColumnIndex_ACU: vi.fn(() => -1),
}));

vi.mock('../../../../src/data/gateways/character-gateway', () => ({
  getCharLorebooks_ACU: vi.fn(async () => []),
}));

vi.mock('../../../../src/data/gateways/worldbook-gateway', () => ({
  createLorebookReadGuard_ACU: vi.fn(async () => async (_names?: string[]) => {}),
  getLorebookEntries_ACU: vi.fn(async () => []),
  getLorebookEntriesRequired_ACU: (...args: any[]) => getLorebookEntries_ACU(...args as [string]),
  listLorebooks_ACU: vi.fn(async () => ['book1']),
}));

vi.mock('../../../../src/service/worldbook/injection-engine', () => ({
  getIsolationPrefix_ACU: vi.fn(() => 'ACU_'),
}));

import { getLorebookEntries_ACU } from '../../../../src/data/gateways/worldbook-gateway';
import {
  formatTableDataForLLM_ACU,
  formatOutlineTableForPlot_ACU,
  formatSummaryIndexForPlot_ACU,
  getSummaryIndexContentForPlot_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-data-format';

const mockTables = {
  sheet_0: {
    name: '背包物品表',
    content: [
      ['row_id', '物品名', '数量'],
      ['1', '铁剑', '1'],
      ['2', '药水', '5'],
    ],
  },
  sheet_1: {
    name: '总结表',
    content: [
      ['row_id', '事件', '时间'],
      ['1', '勇者出发', '第1天'],
      ['2', '遇到恶龙', '第3天'],
    ],
  },
};

describe('formatTableDataForLLM_ACU', () => {
  it('格式化标准表格为 Markdown', () => {
    const result = formatTableDataForLLM_ACU(mockTables);
    expect(result).toContain('背包物品表');
    expect(result).toContain('铁剑');
    expect(result).toContain('药水');
  });
  it('包含总结表', () => {
    const result = formatTableDataForLLM_ACU(mockTables);
    expect(result).toContain('总结表');
  });
  it('空数据返回提示文本', () => {
    expect(formatTableDataForLLM_ACU(null)).toContain('无任何可用');
    expect(formatTableDataForLLM_ACU({})).toContain('无任何可用');
  });
  it('只有表头的表格不输出（content.length <= 1）', () => {
    const data = { sheet_0: { name: '空表', content: [['row_id', '列A']] } };
    const result = formatTableDataForLLM_ACU(data);
    // content.length <= 1 时不输出该表
    expect(result).not.toContain('空表');
  });
});

describe('formatOutlineTableForPlot_ACU', () => {
  it('格式化大纲表', () => {
    const data = {
      sheet_0: {
        name: '总体大纲',
        content: [['row_id', '章节', '内容'], ['1', '第一章', '开始冒险']],
      },
    };
    const result = formatOutlineTableForPlot_ACU(data);
    expect(result).toContain('总体大纲');
    expect(result).toContain('开始冒险');
  });
  it('空数据返回提示文本', () => {
    expect(formatOutlineTableForPlot_ACU(null)).toContain('未获取到');
  });
});

describe('formatSummaryIndexForPlot_ACU', () => {
  it('格式化总结索引', () => {
    const result = formatSummaryIndexForPlot_ACU(mockTables);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('content');
    expect(typeof result.content).toBe('string');
  });
  it('空数据返回失败结果', () => {
    const result = formatSummaryIndexForPlot_ACU(null);
    expect(result.success).toBe(false);
    expect(result.content).toContain('纪要索引');
  });
});

// ═══ getSummaryIndexContentForPlot_ACU ═══
describe('getSummaryIndexContentForPlot_ACU', () => {
  it('无 plotSettings 时返回 null', async () => {
    const result = await getSummaryIndexContentForPlot_ACU(null);
    expect(result).toBeNull();
  });
  it('无 plotWorldbookConfig 时返回 null', async () => {
    const result = await getSummaryIndexContentForPlot_ACU({});
    expect(result).toBeNull();
  });
  it('手动模式且无选择时返回 null', async () => {
    const result = await getSummaryIndexContentForPlot_ACU({
      plotWorldbookConfig: { source: 'manual', manualSelection: [] },
    });
    expect(result).toBeNull();
  });
  it('character 模式绑定读取失败时向上传播，不伪装成没有索引', async () => {
    const { getCharLorebooks_ACU } = await import('../../../../src/data/gateways/character-gateway');
    vi.mocked(getCharLorebooks_ACU).mockRejectedValue(new Error('fail'));
    await expect(getSummaryIndexContentForPlot_ACU({
      plotWorldbookConfig: { source: 'character' },
    })).rejects.toThrow('fail');
  });
  it('找到纪要索引条目时返回内容', async () => {
    const { getCharLorebooks_ACU } = await import('../../../../src/data/gateways/character-gateway');
    const { getLorebookEntries_ACU } = await import('../../../../src/data/gateways/worldbook-gateway');
    const { getIsolationPrefix_ACU } = await import('../../../../src/service/worldbook/injection-engine');
    vi.mocked(getCharLorebooks_ACU).mockResolvedValue({ primary: 'book1' } as any);
    vi.mocked(getIsolationPrefix_ACU).mockReturnValue('ACU_');
    vi.mocked(getLorebookEntries_ACU).mockResolvedValue([
      { comment: 'ACU_TavernDB-ACU-CustomExport-纪要索引', content: '纪要内容', enabled: true },
    ] as any);
    const result = await getSummaryIndexContentForPlot_ACU({
      plotWorldbookConfig: { source: 'character' },
    });
    expect(result).toBe('纪要内容');
  });
});
