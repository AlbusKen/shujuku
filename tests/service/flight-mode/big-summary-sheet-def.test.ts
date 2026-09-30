import { describe, expect, it } from 'vitest';
import { validateDDLTextAgainstHeaders_ACU } from '../../../src/shared/ddl-utils';
import { getPhysicalTableNameForSheet_ACU } from '../../../src/shared/sheet-identity';
import { isSummaryOrOutlineTable_ACU } from '../../../src/shared/utils';
import { buildFlightModeBigSummarySheet_ACU } from '../../../src/service/flight-mode/big-summary-sheet-def';
import {
  FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
} from '../../../src/shared/models/flight-mode-model';
import {
  RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU,
} from '../../../src/service/fill-mode/fill-mode-preferences';

describe('buildFlightModeBigSummarySheet_ACU', () => {
  const chronicle: any = {
    uid: 'sheet_chronicle',
    name: '纪要表',
    content: [['row_id', '事件']],
    sourceData: {},
    updateConfig: { groupId: 8, batchSize: 1 },
    exportConfig: {},
    orderNo: 2,
  };

  it('生成可校验的 DDL、复制纪要更新配置且使用固定世界书位置', () => {
    const sheet = buildFlightModeBigSummarySheet_ACU(chronicle, {
      mate: { type: 'acu', version: 1 },
      sheet_chronicle: chronicle,
    });

    expect(validateDDLTextAgainstHeaders_ACU(sheet.sourceData.ddl, sheet.content[0])).toMatchObject({ valid: true });
    expect(sheet.updateConfig).toEqual(chronicle.updateConfig);
    expect(sheet.updateConfig).not.toBe(chronicle.updateConfig);
    expect(sheet.exportConfig).toMatchObject({
      entryType: 'constant',
      extraIndexEnabled: false,
      entryPlacement: { position: 'at_depth_as_system', depth: 1000, order: 10010 },
    });
  });

  it('以不可变、连续且完整归纳的契约约束大总结新增', () => {
    const sheet = buildFlightModeBigSummarySheet_ACU(chronicle, { sheet_chronicle: chronicle });

    expect(sheet.sourceData.note).toContain(`达到 ${RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU} 条`);
    expect(sheet.sourceData.note).toContain('全部可见纪要');
    expect(sheet.sourceData.note).toContain('辑连贯');
    expect(sheet.sourceData.insertNode).toContain(`达到 ${RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU} 条`);
    expect(sheet.sourceData.insertNode).toContain('全部可见内容');
    expect(sheet.sourceData.updateNode).toContain('禁止修改');
    expect(sheet.sourceData.deleteNode).toContain('禁止删除');
  });

  it('不会命中既有纪要/总结特判，且物理表名不与既有表冲突', () => {
    const sheet = buildFlightModeBigSummarySheet_ACU(chronicle, { sheet_chronicle: chronicle });
    const data: any = {
      sheet_chronicle: chronicle,
      sheet_summary: { name: '总结表' },
      [FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU]: sheet,
    };

    expect(isSummaryOrOutlineTable_ACU(sheet.name)).toBe(false);
    expect(getPhysicalTableNameForSheet_ACU(data, FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU)).toBe('dazongjie');
    expect(getPhysicalTableNameForSheet_ACU(data, 'sheet_summary')).toBe('zongjiebiao');
    expect(getPhysicalTableNameForSheet_ACU(data, 'sheet_chronicle')).toBe('jiyaobiao');
  });
});
