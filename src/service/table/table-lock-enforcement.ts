/**
 * service/table/table-lock-enforcement.ts — 表格锁定的 SQL 模式执行后差异回滚
 *
 * SQL 模式下 AI 输出的是任意 SQL，无法像 JSON 指令那样在解析期逐条拦截。
 * 本模块在"执行前快照 → 执行后快照"之间做锁定目标差异检测，产出补偿 SQL：
 * - 补偿语句在同一引擎会话内执行，使导出的 workingData 恢复锁定目标的前像；
 * - 补偿语句同时追加进持久化的语句集（storage frame V2 冷回放会重放 SQL，
 *   只改内存快照不追加语句会导致回放结果与运行时分叉）。
 *
 * 锁语义（与 JSON 解析器、可视化编辑器一致，基于身份键）：
 * - 行锁（row_id）：该行不可被 UPDATE 修改、不可被 DELETE 删除；
 * - 列锁（列显示名）：该列所有已存在行的值不可修改，列不可被 DROP；
 * - 单元格锁（row_id + 列名）：该格值不可修改；所在行被删除时整行恢复
 *   （锁定格的存续依赖行存在），所在列被 DROP 时整列从前像恢复（不臆造数据）。
 * - 锁不阻止新增行/新增列。
 */
import type { TableLockIdentities_ACU } from '../runtime/helpers-table-lock';

export interface LockRevertItem_ACU {
    sheetKey: string;
    /** 表显示名（面向用户上报）。 */
    tableName: string;
    kind: 'cell_restored' | 'row_restored' | 'column_restored';
    rowId?: string;
    /** 列显示名。 */
    colName?: string;
}

export interface LockRevertPlan_ACU {
    /** 需要在同一引擎会话内执行、并追加进持久化语句集的补偿 SQL。 */
    statements: string[];
    reverted: LockRevertItem_ACU[];
}

export interface BuildLockRevertPlanOptions_ACU {
    sheetKey: string;
    /** 表显示名。 */
    displayTableName: string;
    /** 引擎内物理表名（补偿 SQL 的目标）。 */
    physicalTableName: string;
    /** 执行前的 content（含表头行与 row_id 列）。 */
    beforeContent: any[][];
    /** 执行后的 content；表被整体 DROP 时为 null（结构性破坏由白名单守卫负责，此处跳过）。 */
    afterContent: any[][] | null;
    identities: TableLockIdentities_ACU;
    /** 显示列名 → 物理列名（来自执行前快照的 effective DDL，与 hydrate 一致）。 */
    displayToPhysicalCol: Map<string, string>;
    /** 物理列名 → 声明类型（用于恢复被 DROP 的锁定列；缺省 TEXT）。 */
    physicalColTypes?: Map<string, string | null>;
}

function quoteIdent_ACU(name: string): string {
    return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteValue_ACU(value: any): string {
    if (value === null || value === undefined) return "''";
    return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeCellValue_ACU(value: any): string {
    return value === null || value === undefined ? '' : String(value);
}

/** content → { headers（显示名，不含 row_id）, rows: row_id → 数据数组（不含 row_id 列） } */
function indexContent_ACU(content: any[][]): { headers: string[]; rows: Map<string, any[]> } {
    const headers = (content[0] || []).slice(1).map((h: any) => String(h ?? ''));
    const rows = new Map<string, any[]>();
    for (let i = 1; i < content.length; i += 1) {
        const row = content[i];
        if (!Array.isArray(row)) continue;
        const rowId = String(row[0] ?? '').trim();
        if (!rowId) continue;
        rows.set(rowId, row.slice(1));
    }
    return { headers, rows };
}

/**
 * 对单张表计算锁定目标的执行前后差异，产出补偿计划。
 * 无违规时返回空计划（statements 为空数组）。
 */
export function buildLockRevertPlanForSheet_ACU(options: BuildLockRevertPlanOptions_ACU): LockRevertPlan_ACU {
    const { sheetKey, displayTableName, physicalTableName, beforeContent, afterContent, identities, displayToPhysicalCol } = options;
    const plan: LockRevertPlan_ACU = { statements: [], reverted: [] };
    if (!identities.hasAny || !Array.isArray(beforeContent) || !Array.isArray(beforeContent[0])) return plan;
    if (!afterContent || !Array.isArray(afterContent[0])) return plan;

    const before = indexContent_ACU(beforeContent);
    const after = indexContent_ACU(afterContent);
    const beforeColIndex = new Map(before.headers.map((name, index) => [name, index]));
    const afterColSet = new Set(after.headers);
    const physicalCol = (displayName: string): string => displayToPhysicalCol.get(displayName) ?? displayName;

    const lockedCellsByRow = new Map<string, Set<string>>();
    for (const [rowId, colName] of identities.cellPairs) {
        if (!lockedCellsByRow.has(rowId)) lockedCellsByRow.set(rowId, new Set());
        lockedCellsByRow.get(rowId)!.add(colName);
    }

    // ── 1. 需要整列恢复的锁定列：列锁列被 DROP，或含锁定格的列被 DROP ─────────
    const columnsToRestore: string[] = [];
    for (const colName of identities.colNames) {
        if (beforeColIndex.has(colName) && !afterColSet.has(colName)) columnsToRestore.push(colName);
    }
    for (const [, colNames] of lockedCellsByRow) {
        for (const colName of colNames) {
            if (beforeColIndex.has(colName) && !afterColSet.has(colName) && !columnsToRestore.includes(colName)) {
                columnsToRestore.push(colName);
            }
        }
    }

    // ── 2. 需要整行恢复的行：行锁行被 DELETE，或含锁定格的行被 DELETE ─────────
    const rowsToRestore: string[] = [];
    for (const rowId of identities.rowIds) {
        if (before.rows.has(rowId) && !after.rows.has(rowId)) rowsToRestore.push(rowId);
    }
    for (const [rowId] of lockedCellsByRow) {
        if (before.rows.has(rowId) && !after.rows.has(rowId) && !rowsToRestore.includes(rowId)) {
            rowsToRestore.push(rowId);
        }
    }
    const rowRestoreSet = new Set(rowsToRestore);

    // ── 3. 需要按格恢复的值变化：rowId → (显示列名 → 前像值) ─────────
    const cellRestores = new Map<string, Map<string, any>>();
    const addCellRestore = (rowId: string, colName: string): void => {
        if (rowRestoreSet.has(rowId)) return; // 整行恢复已覆盖
        const beforeRow = before.rows.get(rowId);
        const afterRow = after.rows.get(rowId);
        const beforeIdx = beforeColIndex.get(colName);
        if (!beforeRow || !afterRow || beforeIdx === undefined) return;
        const afterIdx = after.headers.indexOf(colName);
        if (afterIdx < 0) return; // 列被 DROP：由整列恢复处理
        const beforeValue = beforeRow[beforeIdx];
        const afterValue = afterRow[afterIdx];
        if (normalizeCellValue_ACU(beforeValue) === normalizeCellValue_ACU(afterValue)) return;
        if (!cellRestores.has(rowId)) cellRestores.set(rowId, new Map());
        cellRestores.get(rowId)!.set(colName, beforeValue);
    };

    for (const rowId of identities.rowIds) {
        if (!before.rows.has(rowId) || !after.rows.has(rowId)) continue;
        for (const colName of before.headers) {
            if (afterColSet.has(colName)) addCellRestore(rowId, colName);
        }
    }
    for (const colName of identities.colNames) {
        if (!beforeColIndex.has(colName) || !afterColSet.has(colName)) continue;
        for (const rowId of after.rows.keys()) {
            if (before.rows.has(rowId)) addCellRestore(rowId, colName);
        }
    }
    for (const [rowId, colNames] of lockedCellsByRow) {
        for (const colName of colNames) {
            if (beforeColIndex.has(colName)) addCellRestore(rowId, colName);
        }
    }

    // ── 4. 生成补偿 SQL：先补列，再补行，最后按行分组 UPDATE ─────────
    const table = quoteIdent_ACU(physicalTableName);

    for (const colName of columnsToRestore) {
        const physical = physicalCol(colName);
        const declaredType = options.physicalColTypes?.get(physical) || 'TEXT';
        plan.statements.push(`ALTER TABLE ${table} ADD COLUMN ${quoteIdent_ACU(physical)} ${declaredType};`);
        plan.reverted.push({ sheetKey, tableName: displayTableName, kind: 'column_restored', colName });
        const beforeIdx = beforeColIndex.get(colName)!;
        for (const [rowId, beforeRow] of before.rows) {
            if (!after.rows.has(rowId) && !rowRestoreSet.has(rowId)) continue; // 行已不在且不恢复：无处可写
            if (rowRestoreSet.has(rowId)) continue; // 整行 INSERT 会带上该列
            const value = beforeRow[beforeIdx];
            if (normalizeCellValue_ACU(value) === '') continue;
            plan.statements.push(
                `UPDATE ${table} SET ${quoteIdent_ACU(physical)} = ${quoteValue_ACU(value)} WHERE ${quoteIdent_ACU('row_id')} = ${quoteValue_ACU(rowId)};`,
            );
        }
    }

    // 行恢复可写入的列 = 执行前存在，且执行后仍存在（或刚被补回）
    const restorableCols = before.headers.filter(colName => afterColSet.has(colName) || columnsToRestore.includes(colName));
    for (const rowId of rowsToRestore) {
        const beforeRow = before.rows.get(rowId)!;
        const insertCols = ['row_id', ...restorableCols.map(physicalCol)];
        const insertValues = [
            quoteValue_ACU(rowId),
            ...restorableCols.map(colName => quoteValue_ACU(beforeRow[beforeColIndex.get(colName)!])),
        ];
        plan.statements.push(
            `INSERT INTO ${table} (${insertCols.map(quoteIdent_ACU).join(', ')}) VALUES (${insertValues.join(', ')});`,
        );
        plan.reverted.push({ sheetKey, tableName: displayTableName, kind: 'row_restored', rowId });
    }

    const reportedCells = new Set<string>();
    for (const [rowId, colValues] of cellRestores) {
        const setClauses: string[] = [];
        for (const [colName, beforeValue] of colValues) {
            setClauses.push(`${quoteIdent_ACU(physicalCol(colName))} = ${quoteValue_ACU(beforeValue)}`);
            const cellKey = `${rowId}\u0000${colName}`;
            if (!reportedCells.has(cellKey)) {
                reportedCells.add(cellKey);
                plan.reverted.push({ sheetKey, tableName: displayTableName, kind: 'cell_restored', rowId, colName });
            }
        }
        if (setClauses.length === 0) continue;
        plan.statements.push(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${quoteIdent_ACU('row_id')} = ${quoteValue_ACU(rowId)};`,
        );
    }

    return plan;
}

/** 把回滚项汇总为一句可上报/可注入日志的人类可读描述。 */
export function formatLockRevertSummary_ACU(reverted: readonly LockRevertItem_ACU[]): string {
    if (!reverted.length) return '';
    const parts = reverted.map(item => {
        if (item.kind === 'row_restored') return `${item.tableName} 行 ${item.rowId} 已恢复（行被删除）`;
        if (item.kind === 'column_restored') return `${item.tableName} 列「${item.colName}」已恢复（列被删除）`;
        return `${item.tableName} 行 ${item.rowId} 列「${item.colName}」已恢复（值被修改）`;
    });
    return `锁定保护已回滚 ${reverted.length} 处修改：${parts.join('；')}`;
}
