/**
 * tests/service/table/table-lock-enforcement.test.ts
 * SQL 模式锁定差异回滚计划 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  buildLockRevertPlanForSheet_ACU,
  formatLockRevertSummary_ACU,
  type BuildLockRevertPlanOptions_ACU,
} from '../../../src/service/table/table-lock-enforcement';
import type { TableLockIdentities_ACU } from '../../../src/service/runtime/helpers-table-lock';

function identities(partial: Partial<TableLockIdentities_ACU> = {}): TableLockIdentities_ACU {
  const value: TableLockIdentities_ACU = {
    rowIds: partial.rowIds ?? new Set(),
    colNames: partial.colNames ?? new Set(),
    cellPairs: partial.cellPairs ?? [],
    hasAny: false,
  };
  value.hasAny = value.rowIds.size > 0 || value.colNames.size > 0 || value.cellPairs.length > 0;
  return value;
}

const beforeContent = (): any[][] => ([
  ['row_id', '物品名', '数量', '备注'],
  ['r1', '剑', '1', '开局装备'],
  ['r2', '盾', '2', ''],
  ['r3', '药水', '5', '恢复用'],
]);

function buildOptions(overrides: Partial<BuildLockRevertPlanOptions_ACU>): BuildLockRevertPlanOptions_ACU {
  return {
    sheetKey: 'sheet_0',
    displayTableName: '背包物品表',
    physicalTableName: 'beibao',
    beforeContent: beforeContent(),
    afterContent: beforeContent(),
    identities: identities(),
    displayToPhysicalCol: new Map([
      ['物品名', 'item_name'],
      ['数量', 'quantity'],
      ['备注', 'note'],
    ]),
    ...overrides,
  };
}

describe('buildLockRevertPlanForSheet_ACU', () => {
  it('无锁时返回空计划', () => {
    const after = beforeContent();
    after[1][2] = '99';
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({ afterContent: after }));
    expect(plan.statements).toEqual([]);
    expect(plan.reverted).toEqual([]);
  });

  it('有锁但目标未被修改时返回空计划', () => {
    const after = beforeContent();
    after[2][2] = '99'; // 改的是未锁定的 r2
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ rowIds: new Set(['r1']) }),
    }));
    expect(plan.statements).toEqual([]);
  });

  it('锁定行的值被修改：生成按行分组的 UPDATE 恢复前像', () => {
    const after = beforeContent();
    after[1][2] = '99';
    after[1][3] = '被改的备注';
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ rowIds: new Set(['r1']) }),
    }));
    expect(plan.statements).toHaveLength(1);
    expect(plan.statements[0]).toBe(
      `UPDATE "beibao" SET "quantity" = '1', "note" = '开局装备' WHERE "row_id" = 'r1';`,
    );
    expect(plan.reverted).toEqual([
      { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'cell_restored', rowId: 'r1', colName: '数量' },
      { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'cell_restored', rowId: 'r1', colName: '备注' },
    ]);
  });

  it('锁定行被删除：生成 INSERT 恢复整行', () => {
    const after = beforeContent().filter(row => row[0] !== 'r2');
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ rowIds: new Set(['r2']) }),
    }));
    expect(plan.statements).toEqual([
      `INSERT INTO "beibao" ("row_id", "item_name", "quantity", "note") VALUES ('r2', '盾', '2', '');`,
    ]);
    expect(plan.reverted).toEqual([
      { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'row_restored', rowId: 'r2' },
    ]);
  });

  it('锁定列的值被修改：只恢复该列，未锁定列的修改保留', () => {
    const after = beforeContent();
    after[1][2] = '99'; // 锁定列「数量」
    after[1][1] = '长剑'; // 未锁定列「物品名」
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ colNames: new Set(['数量']) }),
    }));
    expect(plan.statements).toEqual([
      `UPDATE "beibao" SET "quantity" = '1' WHERE "row_id" = 'r1';`,
    ]);
  });

  it('锁定列不阻止行删除，也不阻止新增行', () => {
    const after = [
      ['row_id', '物品名', '数量', '备注'],
      ['r1', '剑', '1', '开局装备'],
      ['r3', '药水', '5', '恢复用'],
      ['r9', '新物品', '3', ''],
    ];
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ colNames: new Set(['数量']) }),
    }));
    expect(plan.statements).toEqual([]);
  });

  it('锁定列被 DROP：ALTER 补列并恢复所有行的前像值', () => {
    const after = beforeContent().map(row => row.slice(0, 3)); // 删掉「备注」列
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ colNames: new Set(['备注']) }),
      physicalColTypes: new Map([['note', 'TEXT']]),
    }));
    expect(plan.statements[0]).toBe(`ALTER TABLE "beibao" ADD COLUMN "note" TEXT;`);
    // r2 的备注前像为空串，跳过无意义 UPDATE
    expect(plan.statements.slice(1)).toEqual([
      `UPDATE "beibao" SET "note" = '开局装备' WHERE "row_id" = 'r1';`,
      `UPDATE "beibao" SET "note" = '恢复用' WHERE "row_id" = 'r3';`,
    ]);
    expect(plan.reverted).toEqual([
      { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'column_restored', colName: '备注' },
    ]);
  });

  it('锁定单元格的值被修改：仅恢复该格', () => {
    const after = beforeContent();
    after[3][2] = '0'; // r3.数量（锁定格）
    after[3][3] = '喝完了'; // r3.备注（未锁定）
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ cellPairs: [['r3', '数量']] }),
    }));
    expect(plan.statements).toEqual([
      `UPDATE "beibao" SET "quantity" = '5' WHERE "row_id" = 'r3';`,
    ]);
    expect(plan.reverted).toEqual([
      { sheetKey: 'sheet_0', tableName: '背包物品表', kind: 'cell_restored', rowId: 'r3', colName: '数量' },
    ]);
  });

  it('含锁定单元格的行被删除：整行恢复（锁定格的存续依赖行存在）', () => {
    const after = beforeContent().filter(row => row[0] !== 'r3');
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ cellPairs: [['r3', '数量']] }),
    }));
    expect(plan.statements).toEqual([
      `INSERT INTO "beibao" ("row_id", "item_name", "quantity", "note") VALUES ('r3', '药水', '5', '恢复用');`,
    ]);
  });

  it('值中的单引号被正确转义', () => {
    const before = [
      ['row_id', '物品名'],
      ['r1', "it's mine"],
    ];
    const after = [
      ['row_id', '物品名'],
      ['r1', 'changed'],
    ];
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      beforeContent: before,
      afterContent: after,
      identities: identities({ rowIds: new Set(['r1']) }),
      displayToPhysicalCol: new Map([['物品名', 'item_name']]),
    }));
    expect(plan.statements).toEqual([
      `UPDATE "beibao" SET "item_name" = 'it''s mine' WHERE "row_id" = 'r1';`,
    ]);
  });

  it('无物理列映射时回退使用显示名', () => {
    const after = beforeContent();
    after[1][2] = '99';
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ colNames: new Set(['数量']) }),
      displayToPhysicalCol: new Map(),
    }));
    expect(plan.statements).toEqual([
      `UPDATE "beibao" SET "数量" = '1' WHERE "row_id" = 'r1';`,
    ]);
  });

  it('afterContent 为 null（表被整体 DROP）时跳过，不生成计划', () => {
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: null,
      identities: identities({ rowIds: new Set(['r1']) }),
    }));
    expect(plan.statements).toEqual([]);
  });

  it('行锁 + 列 DROP 组合：恢复行时带上补回的列值', () => {
    // 「备注」列被 DROP，同时锁定行 r1 被删除
    const after = [
      ['row_id', '物品名', '数量'],
      ['r2', '盾', '2'],
      ['r3', '药水', '5'],
    ];
    const plan = buildLockRevertPlanForSheet_ACU(buildOptions({
      afterContent: after,
      identities: identities({ rowIds: new Set(['r1']), colNames: new Set(['备注']) }),
      physicalColTypes: new Map([['note', 'TEXT']]),
    }));
    expect(plan.statements[0]).toBe(`ALTER TABLE "beibao" ADD COLUMN "note" TEXT;`);
    // 补列后恢复存活行的列值（r2 前像为空串跳过）
    expect(plan.statements).toContain(`UPDATE "beibao" SET "note" = '恢复用' WHERE "row_id" = 'r3';`);
    // 恢复的行 INSERT 带上被补回的「备注」列
    expect(plan.statements).toContain(
      `INSERT INTO "beibao" ("row_id", "item_name", "quantity", "note") VALUES ('r1', '剑', '1', '开局装备');`,
    );
  });
});

describe('formatLockRevertSummary_ACU', () => {
  it('空清单返回空串', () => {
    expect(formatLockRevertSummary_ACU([])).toBe('');
  });
  it('汇总三类回滚', () => {
    const summary = formatLockRevertSummary_ACU([
      { sheetKey: 'sheet_0', tableName: '背包', kind: 'cell_restored', rowId: 'r1', colName: '数量' },
      { sheetKey: 'sheet_0', tableName: '背包', kind: 'row_restored', rowId: 'r2' },
      { sheetKey: 'sheet_0', tableName: '背包', kind: 'column_restored', colName: '备注' },
    ]);
    expect(summary).toContain('锁定保护已回滚 3 处修改');
    expect(summary).toContain('背包 行 r1 列「数量」已恢复（值被修改）');
    expect(summary).toContain('背包 行 r2 已恢复（行被删除）');
    expect(summary).toContain('背包 列「备注」已恢复（列被删除）');
  });
});
