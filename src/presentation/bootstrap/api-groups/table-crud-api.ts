/**
 * presentation/bootstrap/api-groups/table-crud-api.ts
 * 表格 CRUD API — updateCell / updateRow / insertRow / deleteRow
 */

import { topLevelWindow_ACU } from '../../../shared/env';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { SillyTavern_API_ACU, type ACUMessage } from '../../../shared/host-api';
import {
    currentJsonTableData_ACU,
    settings_ACU,
    getCurrentIsolationKey_ACU,
} from '../../../service/runtime/state-manager';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../../components/pipeline-ui-helpers';
import type { ApiGroupContext } from './callback-api';
import { isSqliteMode } from '../../../service/table/storage-mode';
import { ensureGlobalNameMapperForDDLs_ACU, getNameMapper, resolveRuntimeEffectiveDDL_ACU } from '../../../service/runtime/template-vars/name-mapper';
import { parseDDLTableName } from '../../../shared/ddl-utils';
import { getPhysicalTableNameForSheet_ACU } from '../../../shared/sheet-identity';
import { getLatestTableAppendMessageIndexFromChat_ACU } from '../../../service/table/table-history';
import { enqueueSummaryVectorIndexFlush_ACU } from '../../../service/vector/summary-vector-index-flush-queue';
import { getCurrentWorldbookConfig_ACU } from '../../../service/settings/settings-readers';
import { runSqliteRuntimeMutationCommit_ACU, runTableUpdateCommit_ACU } from '../../../service/table/table-update-commit';
import { getTableLockIdentitiesForSheet_ACU } from '../../../service/runtime/helpers-table-lock';
import { ensureStorageProviderReady_ACU, getActiveStorageProvider } from '../../../service/table/table-storage-strategy';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../../shared/stable-row-id-allocator';

/**
 * 从完整表集合分配 runtime 物理表名。collision hash 依赖完整集合，不能从单个
 * sheet 或其 DDL 文本推导。
 */
function getEnglishTableName(tableData: Record<string, any>, sheetKey: string): string {
    return getPhysicalTableNameForSheet_ACU(tableData, sheetKey);
}

/**
 * CRUD 开放 API 与 AI 填表/SQL 差异回滚共用同一套身份锁判定（S2-2）：
 * 锁不再只防 AI，也防外部脚本。返回冲突描述；null 表示无锁冲突。
 * - update：目标行被行锁锁定、目标列被列锁锁定、或目标格被单元格锁锁定时拒绝；
 * - delete：目标行被行锁锁定或含任一锁定单元格时拒绝（与 SQL 模式回滚语义一致）。
 */
function findTableLockViolationForCrud_ACU(
    sheetKey: string,
    content: any[][],
    check: { rowIndex: number; colNames?: readonly string[] | null; kind: 'update' | 'delete' },
): string | null {
    const identities = getTableLockIdentitiesForSheet_ACU(sheetKey, content);
    if (!identities.hasAny) return null;
    const rowId = String(content?.[check.rowIndex]?.[0] ?? '').trim();
    if (!rowId) return null; // 目标行尚不存在（updateRow 扩容路径），无锁可判
    if (identities.rowIds.has(rowId)) return `行（row_id=${rowId}）已被行锁锁定`;
    if (check.kind === 'delete') {
        const lockedCell = identities.cellPairs.find(([cellRowId]) => cellRowId === rowId);
        return lockedCell ? `行（row_id=${rowId}）含锁定单元格「${lockedCell[1]}」，不可删除` : null;
    }
    for (const colName of check.colNames || []) {
        if (identities.colNames.has(colName)) return `列「${colName}」已被列锁锁定`;
        if (identities.cellPairs.some(([cellRowId, cellColName]) => cellRowId === rowId && cellColName === colName)) {
            return `单元格（row_id=${rowId}，列「${colName}」）已被锁定`;
        }
    }
    return null;
}

/**
 * CRUD 入口需要以本次 canonical JSON 视图为准同步 mapper。
 * 回滚和 provider 重载可以发生在 SqlTableService 的常规 hydrate 生命周期之外，
 * 不能让 getNameMapper() 的惰性空实例把中文展示列直接当 SQLite 物理列。
 *
 * 映射由活跃 provider 持有发布权。优先请其按本次快照刷新，保证 owner、内容与
 * schema 出自同一次发布。
 *
 * @returns 是否已取得与本次快照一致的可信映射。false 时调用方必须 fail-closed：
 * 继续解析会把中文展示名当成 SQLite 物理名下发。
 */
function ensureNameMapperForTableData_ACU(tableData: Record<string, any>): boolean {
    const activeProvider = getActiveStorageProvider();
    if (activeProvider?.mode === 'sqlite') {
        // 活跃 SQLite runtime 持有发布权，只能由它刷新。缺少该能力或发布被更新
        // runtime 拒绝时，都说明拿不到与本次快照同源的映射，必须 fail-closed。
        if (typeof activeProvider.refreshNameMapperForData_ACU !== 'function') {
            logWarn_ACU('[TableCRUD] 活跃 SQLite runtime 不支持 owner-aware 映射刷新，已拒绝本次表名解析。');
            return false;
        }
        if (!activeProvider.refreshNameMapperForData_ACU(tableData as any)) {
            logWarn_ACU('[TableCRUD] 活跃 SQLite runtime 未能发布本次快照的映射，已拒绝本次表名解析。');
            return false;
        }
        return true;
    }
    // 无活跃 SQLite runtime 时才需要自行推导 DDL 走兼容刷新。
    const ddlMap = new Map<string, string>();
    for (const [sheetKey, sheet] of Object.entries(tableData || {})) {
        if (!sheetKey.startsWith('sheet_') || !sheet || typeof sheet !== 'object') continue;
        const runtimeTableName = getEnglishTableName(tableData, sheetKey);
        const ddl = resolveRuntimeEffectiveDDL_ACU(
            sheet as any,
            (sheet as any).uid || sheetKey,
            runtimeTableName,
        ).effectiveDDL;
        ddlMap.set(runtimeTableName, ddl);
    }
    ensureGlobalNameMapperForDDLs_ACU(ddlMap);
    return true;
}

/**
 * 查找指定表格的目标 sheet 和 sheetKey
 * 支持中文显示名、英文物理表名、中英混用
 * 返回值包含英文物理表名（用于 SQL 拼接）
 */
function findTargetSheetInData_ACU(
    tableData: Record<string, any> | null | undefined,
    tableName: string,
): { sheet: any; sheetKey: string; englishTableName: string } | null {
    if (!tableData) return null;
    if (!ensureNameMapperForTableData_ACU(tableData)) return null;

    // 路径 1：按 sheet.name（中文显示名）直接匹配
    for (const sheetKey in tableData) {
        if (!sheetKey.startsWith('sheet_')) continue;
        const sheet = tableData[sheetKey];
        if (sheet?.name === tableName) {
            return {
                sheet,
                sheetKey,
                englishTableName: getEnglishTableName(tableData, sheetKey),
            };
        }
    }

    // 路径 2：用户传的可能是英文物理表名——通过 NameMapper 反查对应的中文名
    const mapper = getNameMapper();
    const maybeChineseName = mapper.getChineseTableName(tableName);
    if (maybeChineseName && maybeChineseName !== tableName) {
        for (const sheetKey in tableData) {
            if (!sheetKey.startsWith('sheet_')) continue;
            const sheet = tableData[sheetKey];
            if (sheet?.name === maybeChineseName) {
                return {
                    sheet,
                    sheetKey,
                    englishTableName: getEnglishTableName(tableData, sheetKey),
                };
            }
        }
    }

    // 路径 3：runtime physical name 直接匹配。
    for (const sheetKey in tableData) {
        if (!sheetKey.startsWith('sheet_')) continue;
        const sheet = tableData[sheetKey];
        const english = getEnglishTableName(tableData, sheetKey);
        if (english && english === tableName) {
            return {
                sheet,
                sheetKey,
                englishTableName: english,
            };
        }
    }

    // 路径 4：兼容历史 DDL 名称以定位 sheet；它绝不能成为 SQL 的目标表名。
    const ddlAliasMatches: Array<{ sheet: any; sheetKey: string }> = [];
    for (const sheetKey in tableData) {
        if (!sheetKey.startsWith('sheet_')) continue;
        const sheet = tableData[sheetKey];
        if (!sheet || typeof sheet !== 'object') continue;
        const ddlTableName = parseDDLTableName(String(sheet.sourceData?.ddl || ''));
        if (ddlTableName && ddlTableName === tableName) {
            ddlAliasMatches.push({ sheet, sheetKey });
        }
    }

    if (ddlAliasMatches.length === 1) {
        const [{ sheet, sheetKey }] = ddlAliasMatches;
        return {
            sheet,
            sheetKey,
            englishTableName: getEnglishTableName(tableData, sheetKey),
        };
    }

    return null;
}

export function findTargetSheet(
    tableName: string,
): { sheet: any; sheetKey: string; englishTableName: string } | null {
    return findTargetSheetInData_ACU(currentJsonTableData_ACU, tableName);
}

/**
 * 公共 CRUD 不能在 SQLite hydrate/reload 尚未发布 runtime 前，用过期快照解析表名。
 * 写前加入现有 readiness flight，随后重新读取 canonical 数据并以 active provider
 * 的 owner-aware mapper 解析目标。commit 内仍会再次检查 readiness 和 revision；
 * 这里仅消除「还没等运行时就先找不到模板表」的时序窗口。
 */
async function prepareTableMutationTarget_ACU(
    tableName: string,
): Promise<{ sheet: any; sheetKey: string; englishTableName: string } | null> {
    if (isSqliteMode()) {
        await ensureStorageProviderReady_ACU();
    }

    const latestData = currentJsonTableData_ACU;
    if (!latestData) return null;
    return findTargetSheetInData_ACU(latestData, tableName);
}

/**
 * 将用户传入的列名（可能是中文、英文、或数字索引得来的中文）
 * 翻译成英文列名（供 SQL 拼接）和中文列名（供原生模式 headers 匹配）
 *
 * 原生模式下 NameMapper 未构建，resolve* 方法会原样返回——
 * 此时 englishColName === chineseColName === 原始 colName，行为与旧版一致。
 */
function resolveColumnForSheet(
    englishTableName: string,
    sheetKey: string,
    colName: string,
): { englishColName: string; chineseColName: string; resolved: boolean } {
    const mapper = getNameMapper();
    const normalizedColumnName = String(colName || '').trim();
    const resolved = mapper.hasColumnName(englishTableName, normalizedColumnName);
    const englishColName = mapper.resolveColumnName(englishTableName, normalizedColumnName);
    const chineseColName = mapper.getChineseColumnName(englishTableName, englishColName);
    return {
        englishColName,
        chineseColName,
        resolved,
    };
}

function toSqlValueParam_ACU(value: any): string | number | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'boolean') return value ? 1 : 0;
    return String(value);
}

function isPlainObjectArg_ACU(value: any): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined_ACU<T = any>(...values: T[]): T | undefined {
    for (const value of values) {
        if (value !== undefined) return value;
    }
    return undefined;
}

function normalizeRowIndexArg_ACU(value: any, methodName: string): number | null {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
        logError_ACU(`${methodName}: Invalid rowIndex "${String(value)}". rowIndex must be an integer, where 1 is the first data row.`);
        return null;
    }
    return numericValue;
}

function normalizeTableNameArg_ACU(value: any, methodName: string): string | null {
    const tableName = String(value ?? '').trim();
    if (!tableName) {
        logError_ACU(`${methodName}: tableName is required.`);
        return null;
    }
    return tableName;
}

type TableCrudMutationOptions_ACU = {
    skipChatSave: boolean;
    skipNotify: boolean;
    assumeCommitLock?: boolean;
};

type ParsedUpdateCellArgs_ACU = TableCrudMutationOptions_ACU & {
    tableName: string;
    rowIndex: number;
    colIdentifier: string | number;
    value: any;
};

type ParsedUpdateRowArgs_ACU = TableCrudMutationOptions_ACU & {
    tableName: string;
    rowIndex: number;
    data: Record<string, any>;
};

type ParsedInsertRowArgs_ACU = TableCrudMutationOptions_ACU & {
    tableName: string;
    data: Record<string, any>;
};

type ParsedDeleteRowArgs_ACU = TableCrudMutationOptions_ACU & {
    tableName: string;
    rowIndex: number;
};

function toBooleanOption_ACU(value: any): boolean {
    if (value === true) return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    return value === 1;
}

function parseMutationOptions_ACU(options: Record<string, any> | null, rowData?: Record<string, any> | null): TableCrudMutationOptions_ACU {
    const skipChatSave = toBooleanOption_ACU(firstDefined_ACU(
        options?.skipChatSave,
        options?.skipSave,
        options?.isImportMode,
        rowData?.isImportMode,
    ));
    const skipNotify = toBooleanOption_ACU(firstDefined_ACU(
        options?.skipNotify,
        options?.silent,
        options?.isSilent,
        options?.suppressNotify,
        options?.suppressNotification,
        rowData?.skipNotify,
        rowData?.silent,
    ));
    return { skipChatSave, skipNotify };
}

function parseUpdateCellArgs_ACU(
    tableNameOrOptions: any,
    rowIndex?: any,
    colIdentifier?: any,
    value?: any,
): ParsedUpdateCellArgs_ACU | null {
    const options = isPlainObjectArg_ACU(tableNameOrOptions) ? tableNameOrOptions : null;
    const tableName = normalizeTableNameArg_ACU(
        options ? firstDefined_ACU(options.tableName, options.table, options.sheetName, options.name) : tableNameOrOptions,
        'updateCell',
    );
    const normalizedRowIndex = normalizeRowIndexArg_ACU(
        options ? firstDefined_ACU(options.rowIndex, options.row, options.index) : rowIndex,
        'updateCell',
    );
    const rawColIdentifier = options ? firstDefined_ACU(options.colIdentifier, options.column, options.colName, options.colIndex, options.columnIndex) : colIdentifier;
    if (rawColIdentifier === undefined || rawColIdentifier === null || rawColIdentifier === '') {
        logError_ACU('updateCell: colIdentifier is required.');
        return null;
    }
    if (!tableName || normalizedRowIndex === null) return null;
    return {
        tableName,
        rowIndex: normalizedRowIndex,
        colIdentifier: rawColIdentifier,
        value: options ? options.value : value,
        ...parseMutationOptions_ACU(options),
    };
}

function parseUpdateRowArgs_ACU(
    tableNameOrOptions: any,
    rowIndex?: any,
    data?: any,
): ParsedUpdateRowArgs_ACU | null {
    const options = isPlainObjectArg_ACU(tableNameOrOptions) ? tableNameOrOptions : null;
    const tableName = normalizeTableNameArg_ACU(
        options ? firstDefined_ACU(options.tableName, options.table, options.sheetName, options.name) : tableNameOrOptions,
        'updateRow',
    );
    const normalizedRowIndex = normalizeRowIndexArg_ACU(
        options ? firstDefined_ACU(options.rowIndex, options.row, options.index) : rowIndex,
        'updateRow',
    );
    const rowData = options ? firstDefined_ACU(options.data, options.values, options.rowData) : data;
    if (!isPlainObjectArg_ACU(rowData)) {
        logError_ACU('updateRow: data must be an object.');
        return null;
    }
    if (!tableName || normalizedRowIndex === null) return null;
    return {
        tableName,
        rowIndex: normalizedRowIndex,
        data: rowData,
        ...parseMutationOptions_ACU(options, rowData),
    };
}

function parseInsertRowArgs_ACU(
    tableNameOrOptions: any,
    data?: any,
): ParsedInsertRowArgs_ACU | null {
    const options = isPlainObjectArg_ACU(tableNameOrOptions) ? tableNameOrOptions : null;
    const tableName = normalizeTableNameArg_ACU(
        options ? firstDefined_ACU(options.tableName, options.table, options.sheetName, options.name) : tableNameOrOptions,
        'insertRow',
    );
    const rowData = options ? firstDefined_ACU(options.data, options.values, options.rowData) : data;
    if (!isPlainObjectArg_ACU(rowData)) {
        logError_ACU('insertRow: data must be an object.');
        return null;
    }
    if (!tableName) return null;
    return {
        tableName,
        data: rowData,
        ...parseMutationOptions_ACU(options, rowData),
    };
}

function parseDeleteRowArgs_ACU(
    tableNameOrOptions: any,
    rowIndex?: any,
): ParsedDeleteRowArgs_ACU | null {
    const options = isPlainObjectArg_ACU(tableNameOrOptions) ? tableNameOrOptions : null;
    const tableName = normalizeTableNameArg_ACU(
        options ? firstDefined_ACU(options.tableName, options.table, options.sheetName, options.name) : tableNameOrOptions,
        'deleteRow',
    );
    const normalizedRowIndex = normalizeRowIndexArg_ACU(
        options ? firstDefined_ACU(options.rowIndex, options.row, options.index) : rowIndex,
        'deleteRow',
    );
    if (!tableName || normalizedRowIndex === null) return null;
    return {
        tableName,
        rowIndex: normalizedRowIndex,
        ...parseMutationOptions_ACU(options),
    };
}

function assertSqlMutationChanged_ACU(
    methodName: string,
    actionLabel: string,
    result: { changes?: number; errors?: string[]; success?: boolean; error?: string },
): boolean {
    const errors = result.errors || (result.error ? [result.error] : []);
    if (result.success === false || errors.length > 0) {
        logError_ACU(`${methodName} SQL failed: ${errors.join(', ') || 'unknown error'}`);
        return false;
    }
    if ((result.changes ?? 0) <= 0) {
        logWarn_ACU(`${methodName}: SQL executed but affected 0 rows. action=${actionLabel}`);
        return false;
    }
    return true;
}

/**
 * 查找 V2 operation log 的当前有效追加楼层。
 * 手动 CRUD 必须追加到最新可承载表数据的 AI 楼，不能按单表历史楼层回写。
 */
function findTableLatestFloor(_targetSheetKey: string, _tableName: string): number {
    const chat = SillyTavern_API_ACU.chat;
    if (!chat || chat.length === 0) return -1;
    return getLatestTableAppendMessageIndexFromChat_ACU(
        chat as ACUMessage[],
        getCurrentIsolationKey_ACU(),
        settings_ACU,
    );
}

async function syncSummaryVectorIndexAfterTableEdit_ACU(
    tableName: string,
    methodName: string,
    tableLatestFloorIndex: number,
    skipSync?: boolean,
): Promise<void> {
    if (skipSync) {
        logDebug_ACU(`${methodName}: Skip summary vector index sync for [${tableName}] because this edit is marked as batch/import mode.`);
        return;
    }
    if (!isSummaryOrOutlineTable_ACU(tableName)) return;
    if (getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled !== true) return;

    const chat = SillyTavern_API_ACU.chat as ACUMessage[];
    const preferredTargetIndex = tableLatestFloorIndex >= 0 && chat?.[tableLatestFloorIndex] && !chat[tableLatestFloorIndex].is_user
        ? tableLatestFloorIndex
        : undefined;

    try {
        const result = await enqueueSummaryVectorIndexFlush_ACU({
            targetMessageIndex: preferredTargetIndex,
            mode: 'sync',
            reason: methodName,
        });
        if (!result.queued && !result.skipped) {
            logWarn_ACU(`${methodName}: Summary vector index flush enqueue failed after editing [${tableName}]. reason=${result.reason || 'unknown'}`);
        } else {
            logDebug_ACU(`${methodName}: Summary vector index flush queued after editing [${tableName}]. queued=${result.queued}, reason=${result.reason || 'ok'}`);
        }
    } catch (error) {
        logError_ACU(`${methodName}: Summary vector index flush enqueue threw after editing [${tableName}].`, error);
    }
}

async function finalizeTableEditAfterCommit_ACU(
    tableName: string,
    methodName: string,
    tableLatestFloorIndex: number,
    options: TableCrudMutationOptions_ACU,
): Promise<void> {
    let didNotifyThroughRefresh = false;
    // S2-1：skipChatSave 提交只改运行时未写聊天帧，通知回调时以 persisted=false 明示未落盘
    const notifyMeta = { persisted: !options.skipChatSave };
    await refreshMergedDataAndNotifyWithUI_ACU({ skipNotify: options.skipNotify, notifyMeta });
    didNotifyThroughRefresh = !options.skipNotify;
    logDebug_ACU(`${methodName}: Worldbook refreshed after saving [${tableName}]`);
    await syncSummaryVectorIndexAfterTableEdit_ACU(tableName, methodName, tableLatestFloorIndex, options.skipChatSave);
    if (!options.skipNotify && !didNotifyThroughRefresh) {
        (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate(notifyMeta);
    } else if (options.skipNotify) {
        logDebug_ACU(`${methodName}: Skip table update notification for [${tableName}] because this edit is marked as silent.`);
    }
}

export function createTableCrudApi(ctx: ApiGroupContext): Record<string, Function> {
    return {
        updateCell: async function(tableNameOrOptions: any, rowIndex?: any, colIdentifier?: any, value?: any) {
            try {
                const args = parseUpdateCellArgs_ACU(tableNameOrOptions, rowIndex, colIdentifier, value);
                if (!args) return false;
                const {
                    tableName,
                    rowIndex: normalizedRowIndex,
                    colIdentifier: normalizedColIdentifier,
                    value: normalizedValue,
                    skipChatSave,
                    skipNotify,
                } = args;

                const target = await prepareTableMutationTarget_ACU(tableName);
                if (!target) {
                    logError_ACU(`updateCell: Table "${tableName}" not found.`);
                    return false;
                }

                const { sheet: targetSheet, sheetKey: targetSheetKey, englishTableName } = target;

                if (!targetSheet.content || targetSheet.content.length === 0) {
                    logError_ACU(`updateCell: Table "${tableName}" has no content.`);
                    return false;
                }

                // 解析列名：先拿到一个「原始列名」（来自用户输入或表头索引）
                const numericColIdentifier = typeof normalizedColIdentifier === 'number'
                    ? normalizedColIdentifier
                    : (String(normalizedColIdentifier).trim() !== '' && Number.isInteger(Number(normalizedColIdentifier)) ? Number(normalizedColIdentifier) : null);
                let rawColName: string;
                if (numericColIdentifier !== null) {
                    const headers = targetSheet.content[0] || [];
                    if (numericColIdentifier < 0 || numericColIdentifier >= headers.length) {
                        logError_ACU(`updateCell: Column index ${numericColIdentifier} out of bounds in table "${tableName}".`);
                        return false;
                    }
                    rawColName = headers[numericColIdentifier]; // 中文
                } else {
                    rawColName = String(normalizedColIdentifier); // 可能中文也可能英文
                }

                // 统一翻译为英文+中文双形态
                const { englishColName, chineseColName, resolved } = resolveColumnForSheet(englishTableName, targetSheetKey, rawColName);
                if (isSqliteMode() && !resolved) {
                    logError_ACU(`updateCell: Column mapping is unavailable. sheetKey=${targetSheetKey}, table=${englishTableName}, column=${rawColName}; SQLite write was rejected.`);
                    return false;
                }

                // 校验列名：用中文形态和 headers 比对（headers 是中文），
                // 这样用户传英文列名也能通过校验
                if (numericColIdentifier === null) {
                    const headers = targetSheet.content[0] || [];
                    if (!headers.includes(chineseColName)) {
                        logError_ACU(`updateCell: Column "${normalizedColIdentifier}" not found in table "${tableName}".`);
                        return false;
                    }
                }

                if (normalizedRowIndex < 1 || normalizedRowIndex >= targetSheet.content.length) {
                    logError_ACU(`updateCell: Row index ${normalizedRowIndex} out of bounds in table "${tableName}".`);
                    return false;
                }

                const cellLockViolation = findTableLockViolationForCrud_ACU(targetSheetKey, targetSheet.content, {
                    rowIndex: normalizedRowIndex,
                    colNames: [chineseColName],
                    kind: 'update',
                });
                if (cellLockViolation) {
                    logWarn_ACU(`updateCell: 表 "${tableName}" ${cellLockViolation}，写入已拒绝。`);
                    return false;
                }

                if (isSqliteMode()) {
                    const rowId = targetSheet.content[normalizedRowIndex][0];
                    if (rowId === undefined || rowId === null) {
                        logError_ACU(`updateCell: row_id not found at index ${normalizedRowIndex}`);
                        return false;
                    }
                    const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                    if (!skipChatSave && tableLatestFloorIndex === -1) return false;
                    const sql = `UPDATE ${quoteIdentifier(englishTableName)} SET ${quoteIdentifier(englishColName)} = ? WHERE ${quoteIdentifier('row_id')} = ?;`;
                    const params = [toSqlValueParam_ACU(normalizedValue), toSqlValueParam_ACU(rowId)];
                    const result = await runSqliteRuntimeMutationCommit_ACU<boolean>({
                        source: 'manual_crud',
                        reason: 'updateCell:sqlite',
                        isolationKey: getCurrentIsolationKey_ACU(),
                        writeSet: [{ kind: 'cell', sheetKey: targetSheetKey, rowId: String(rowId), columnKey: String(chineseColName) }],
                        revisionWriteSet: [{ kind: 'cell', sheetKey: targetSheetKey, rowId: String(rowId), columnKey: String(chineseColName) }],
                        initialData: currentJsonTableData_ACU,
                        targetMessageIndex: tableLatestFloorIndex,
                        targetSheetKeys: [targetSheetKey],
                        updateGroupKeys: null,
                        trackingSheetKeys: [],
                        trackAsUpdate: false,
                        skipChatSave,
                        sql,
                        params,
                        validate: ({ mutationResult }) => assertSqlMutationChanged_ACU('updateCell', `table=${englishTableName}, row_id=${rowId}, col=${englishColName}`, mutationResult) ? null : 'updateCell SQLite mutation affected 0 rows',
                        mapValue: () => true,
                    });
                    if (!result.success) return false;
                    await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'updateCell', tableLatestFloorIndex, { skipChatSave, skipNotify });
                    return true;
                } else {
                    const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                    if (!skipChatSave && tableLatestFloorIndex === -1) return false;
                    const writeSet = [{ kind: 'cell' as const, sheetKey: targetSheetKey, rowId: String(targetSheet.content[normalizedRowIndex][0] ?? ''), columnKey: String(chineseColName) }];
                    const commitResult = await runTableUpdateCommit_ACU<boolean>({
                        source: 'manual_crud',
                        reason: 'updateCell',
                        isolationKey: getCurrentIsolationKey_ACU(),
                        writeSet,
                        revisionWriteSet: writeSet,
                        initialData: currentJsonTableData_ACU,
                        targetMessageIndex: tableLatestFloorIndex,
                        targetSheetKeys: [targetSheetKey],
                        updateGroupKeys: null,
                        trackingSheetKeys: [],
                        trackAsUpdate: false,
                        skipChatSave,
                    }, ({ workingData }) => {
                        const workingTarget = findTargetSheetInData_ACU(workingData as any, tableName);
                        if (!workingTarget) {
                            logError_ACU(`updateCell: Table "${tableName}" not found.`);
                            return { success: false, error: `Table "${tableName}" not found.` };
                        }
                        const workingSheet = workingTarget.sheet;
                        let colIndex = -1;
                        if (numericColIdentifier !== null) {
                            colIndex = numericColIdentifier;
                        } else {
                            const headers = workingSheet.content[0] || [];
                            colIndex = headers.indexOf(chineseColName);
                        }
                        if (colIndex < 0) {
                            logError_ACU(`updateCell: Column "${normalizedColIdentifier}" not found in table "${tableName}".`);
                            return { success: false, error: `Column "${normalizedColIdentifier}" not found.` };
                        }
                        workingSheet.content[normalizedRowIndex][colIndex] = normalizedValue;
                        const row = workingSheet.content[normalizedRowIndex];
                        const rowId = String(row?.[0] ?? '');
                        logDebug_ACU(`updateCell: Updated [${tableName}] row ${normalizedRowIndex}, col ${normalizedColIdentifier} = ${normalizedValue}`);
                        return {
                            success: true,
                            value: true,
                            tableData: workingData as any,
                            persist: {
                                operations: rowId ? [{ kind: 'row_upsert', sheetKey: targetSheetKey, rowId, cells: [...row] }] : [],
                            },
                        };
                    });
                    if (!commitResult.success || !commitResult.value) return false;
                    await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'updateCell', tableLatestFloorIndex, { skipChatSave, skipNotify });
                    return true;
                }
            } catch (e) {
                logError_ACU('updateCell failed:', e);
                return false;
            }
        },

        updateRow: async function(tableNameOrOptions: any, rowIndex?: any, data?: any) {
            try {
                const args = parseUpdateRowArgs_ACU(tableNameOrOptions, rowIndex, data);
                if (!args) return false;
                const {
                    tableName,
                    rowIndex: normalizedRowIndex,
                    data: normalizedData,
                    skipChatSave,
                    skipNotify,
                } = args;

                if (normalizedRowIndex < 1) {
                    logError_ACU('updateRow: Cannot modify header row (index 0).');
                    return false;
                }

                const target = await prepareTableMutationTarget_ACU(tableName);
                if (!target) {
                    logError_ACU(`updateRow: Table "${tableName}" not found.`);
                    return false;
                }

                const { sheet: targetSheet, sheetKey: targetSheetKey, englishTableName } = target;

                const updateRowColNames: string[] = [];
                for (const colName in normalizedData) {
                    if (colName === 'isImportMode') continue;
                    updateRowColNames.push(resolveColumnForSheet(englishTableName, targetSheetKey, colName).chineseColName);
                }
                const rowLockViolation = findTableLockViolationForCrud_ACU(targetSheetKey, targetSheet.content, {
                    rowIndex: normalizedRowIndex,
                    colNames: updateRowColNames,
                    kind: 'update',
                });
                if (rowLockViolation) {
                    logWarn_ACU(`updateRow: 表 "${tableName}" ${rowLockViolation}，写入已拒绝。`);
                    return false;
                }

                if (isSqliteMode()) {
                        // SQLite 模式：统一交给公共提交模型执行运行时 SQL 和持久化。
                        const rowId = targetSheet.content[normalizedRowIndex]?.[0];
                        if (rowId === undefined || rowId === null) {
                            logError_ACU(`updateRow: row_id not found at index ${normalizedRowIndex}`);
                            return false;
                        }
                        const setClauses: string[] = [];
                        const params: (string | number | null)[] = [];
                        const headers = targetSheet.content[0] || [];
                        for (const colName in normalizedData) {
                            if (colName === 'isImportMode') continue; // 跳过内部标记
                            const { englishColName, chineseColName, resolved } = resolveColumnForSheet(englishTableName, targetSheetKey, colName);
                            if (!resolved) {
                                logError_ACU(`updateRow: Column mapping is unavailable. sheetKey=${targetSheetKey}, table=${englishTableName}, column=${colName}; SQLite write was rejected.`);
                                return false;
                            }
                            if (!headers.includes(chineseColName)) {
                                logError_ACU(`updateRow: Column "${colName}" is absent from canonical headers. sheetKey=${targetSheetKey}, table=${englishTableName}; SQLite write was rejected.`);
                                return false;
                            }
                            setClauses.push(`${quoteIdentifier(englishColName)} = ?`);
                            params.push(toSqlValueParam_ACU(normalizedData[colName]));
                        }
                        if (setClauses.length === 0) {
                            logWarn_ACU('updateRow: No valid columns to update.');
                            return false;
                        }
                        params.push(toSqlValueParam_ACU(rowId));
                        const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                        if (!skipChatSave && tableLatestFloorIndex === -1) return false;
                        const sql = `UPDATE ${quoteIdentifier(englishTableName)} SET ${setClauses.join(', ')} WHERE ${quoteIdentifier('row_id')} = ?;`;
                        const result = await runSqliteRuntimeMutationCommit_ACU<boolean>({
                            source: 'manual_crud',
                            reason: 'updateRow:sqlite',
                            isolationKey: getCurrentIsolationKey_ACU(),
                            writeSet: [{ kind: 'sheet', sheetKey: targetSheetKey }],
                            revisionWriteSet: [{ kind: 'sheet', sheetKey: targetSheetKey }],
                            initialData: currentJsonTableData_ACU,
                            targetMessageIndex: tableLatestFloorIndex,
                            targetSheetKeys: [targetSheetKey],
                            updateGroupKeys: null,
                            trackingSheetKeys: [],
                            trackAsUpdate: false,
                            skipChatSave,
                            sql,
                            params,
                            validate: ({ mutationResult }) => assertSqlMutationChanged_ACU('updateRow', `table=${englishTableName}, row_id=${rowId}, cols=${setClauses.length}`, mutationResult) ? null : 'updateRow SQLite mutation affected 0 rows',
                            mapValue: () => true,
                        });
                        if (!result.success) return false;
                        await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'updateRow', tableLatestFloorIndex, { skipChatSave, skipNotify });
                        return true;
                } else {
                    const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                    if (!skipChatSave && tableLatestFloorIndex === -1) return false;
                    const writeSet = [{ kind: 'sheet' as const, sheetKey: targetSheetKey }];
                    const commitResult = await runTableUpdateCommit_ACU<boolean>({
                        source: 'manual_crud',
                        reason: 'updateRow',
                        isolationKey: getCurrentIsolationKey_ACU(),
                        writeSet,
                        revisionWriteSet: writeSet,
                        initialData: currentJsonTableData_ACU,
                        targetMessageIndex: tableLatestFloorIndex,
                        targetSheetKeys: [targetSheetKey],
                        updateGroupKeys: null,
                        trackingSheetKeys: [],
                        trackAsUpdate: false,
                        skipChatSave,
                    }, ({ workingData }) => {
                        const workingTarget = findTargetSheetInData_ACU(workingData as any, tableName);
                        if (!workingTarget) {
                            logError_ACU(`updateRow: Table "${tableName}" not found.`);
                            return { success: false, error: `Table "${tableName}" not found.` };
                        }
                        const workingSheet = workingTarget.sheet;
                        while (workingSheet.content.length <= normalizedRowIndex) {
                            const newRow = new Array((workingSheet.content[0] || []).length).fill('');
                            workingSheet.content.push(newRow);
                        }

                        const headers = workingSheet.content[0] || [];
                        const row = workingSheet.content[normalizedRowIndex];

                        let updated = 0;
                        for (const colName in normalizedData) {
                            if (colName === 'isImportMode') continue;
                            const { chineseColName } = resolveColumnForSheet(workingTarget.englishTableName, workingTarget.sheetKey, colName);
                            const colIndex = headers.indexOf(chineseColName);
                            if (colIndex !== -1) {
                                row[colIndex] = normalizedData[colName];
                                updated++;
                            } else {
                                logWarn_ACU(`updateRow: Column "${colName}" not found in table "${tableName}".`);
                            }
                        }

                        if (updated === 0) {
                            logWarn_ACU(`updateRow: No valid columns updated in [${tableName}] row ${normalizedRowIndex}.`);
                            return { success: false, error: 'No valid columns updated.' };
                        }
                        const rowId = String(row?.[0] ?? '');
                        logDebug_ACU(`updateRow: Updated ${updated} cells in [${tableName}] row ${normalizedRowIndex}`);
                        return {
                            success: true,
                            value: true,
                            tableData: workingData as any,
                            persist: {
                                operations: rowId ? [{ kind: 'row_upsert', sheetKey: targetSheetKey, rowId, cells: [...row] }] : [],
                            },
                        };
                    });
                    if (!commitResult.success || !commitResult.value) return false;
                    await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'updateRow', tableLatestFloorIndex, { skipChatSave, skipNotify });
                    return true;
                }

            } catch (e) {
                logError_ACU('updateRow failed:', e);
                return false;
            }
        },

        insertRow: async function(tableNameOrOptions: any, data?: any) {
            try {
                const args = parseInsertRowArgs_ACU(tableNameOrOptions, data);
                if (!args) return -1;
                const {
                    tableName,
                    data: normalizedData,
                    skipChatSave,
                    skipNotify,
                } = args;

                const target = await prepareTableMutationTarget_ACU(tableName);
                if (!target) {
                    logError_ACU(`insertRow: Table "${tableName}" not found.`);
                    return -1;
                }

                const { sheet: targetSheet, sheetKey: targetSheetKey, englishTableName } = target;
                const headers = targetSheet.content[0] || [];

                if (isSqliteMode()) {
                        // SQLite 模式：统一交给公共提交模型执行运行时 SQL 和持久化。
                        const beforeLength = targetSheet.content.length;
                        const colNames: string[] = [];
                        const params: (string | number | null)[] = [];
                        for (const colName in normalizedData) {
                            const { englishColName, chineseColName, resolved } = resolveColumnForSheet(englishTableName, targetSheetKey, colName);
                            // 跳过 row_id（自增主键），同时检查英文形态和原始名，防止用户传中文"行号"等变体
                            if (englishColName === 'row_id' || colName === 'row_id') continue;
                            if (!resolved) {
                                logError_ACU(`insertRow: Column mapping is unavailable. sheetKey=${targetSheetKey}, table=${englishTableName}, column=${colName}; SQLite write was rejected.`);
                                return -1;
                            }
                            if (!headers.includes(chineseColName)) {
                                logError_ACU(`insertRow: Column "${colName}" is absent from canonical headers. sheetKey=${targetSheetKey}, table=${englishTableName}; SQLite write was rejected.`);
                                return -1;
                            }
                            colNames.push(quoteIdentifier(englishColName));
                            params.push(toSqlValueParam_ACU(normalizedData[colName]));
                        }
                        const placeholders = colNames.map(() => '?').join(', ');
                        const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                        if (!skipChatSave && tableLatestFloorIndex === -1) return -1;
                        const sql = colNames.length > 0
                            ? `INSERT INTO ${quoteIdentifier(englishTableName)} (${colNames.join(', ')}) VALUES (${placeholders});`
                            : `INSERT INTO ${quoteIdentifier(englishTableName)} DEFAULT VALUES;`;
                        const result = await runSqliteRuntimeMutationCommit_ACU<number>({
                            source: 'manual_crud',
                            reason: 'insertRow:sqlite',
                            isolationKey: getCurrentIsolationKey_ACU(),
                            writeSet: [{ kind: 'sheet', sheetKey: targetSheetKey }],
                            revisionWriteSet: [{ kind: 'sheet', sheetKey: targetSheetKey }],
                            initialData: currentJsonTableData_ACU,
                            targetMessageIndex: tableLatestFloorIndex,
                            targetSheetKeys: [targetSheetKey],
                            updateGroupKeys: null,
                            trackingSheetKeys: [],
                            trackAsUpdate: false,
                            skipChatSave,
                            sql,
                            params,
                            validate: ({ mutationResult, tableData }) => {
                                if (!assertSqlMutationChanged_ACU('insertRow', `table=${englishTableName}, cols=${colNames.length}`, mutationResult)) return 'insertRow SQLite mutation affected 0 rows';
                                const refreshedTarget = findTargetSheetInData_ACU(tableData as any, tableName);
                                const refreshedLength = refreshedTarget?.sheet?.content?.length ?? 0;
                                return refreshedTarget && refreshedLength > beforeLength
                                    ? null
                                    : `insertRow: SQLite runtime mutation succeeded but exported JSON view did not contain a new row for [${tableName}].`;
                            },
                            mapValue: ({ tableData }) => {
                                const refreshedTarget = findTargetSheetInData_ACU(tableData as any, tableName);
                                return (refreshedTarget?.sheet?.content?.length ?? 1) - 1;
                            },
                        });
                        if (!result.success || typeof result.value !== 'number') return -1;
                        await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'insertRow', tableLatestFloorIndex, { skipChatSave, skipNotify });
                        return result.value;
                } else {
                    const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                    if (!skipChatSave && tableLatestFloorIndex === -1) return -1;
                    const writeSet = [{ kind: 'sheet' as const, sheetKey: targetSheetKey }];
                    const commitResult = await runTableUpdateCommit_ACU<number>({
                        source: 'manual_crud',
                        reason: 'insertRow',
                        isolationKey: getCurrentIsolationKey_ACU(),
                        writeSet,
                        revisionWriteSet: writeSet,
                        initialData: currentJsonTableData_ACU,
                        targetMessageIndex: tableLatestFloorIndex,
                        targetSheetKeys: [targetSheetKey],
                        updateGroupKeys: null,
                        trackingSheetKeys: [],
                        trackAsUpdate: false,
                        skipChatSave,
                    }, ({ workingData }) => {
                        const workingTarget = findTargetSheetInData_ACU(workingData as any, tableName);
                        if (!workingTarget) {
                            logError_ACU(`insertRow: Table "${tableName}" not found.`);
                            return { success: false, error: `Table "${tableName}" not found.` };
                        }
                        const workingSheet = workingTarget.sheet;
                        const workingHeaders = workingSheet.content[0] || [];
                        const newRow = new Array(workingHeaders.length).fill('');

                        for (const colName in normalizedData) {
                            const { chineseColName } = resolveColumnForSheet(workingTarget.englishTableName, workingTarget.sheetKey, colName);
                            const colIndex = workingHeaders.indexOf(chineseColName);
                            if (colIndex !== -1) {
                                newRow[colIndex] = normalizedData[colName];
                            }
                        }

                        newRow[0] = allocateStableRowId_ACU(createStableRowIdReservation_ACU(workingSheet.content.slice(1)));
                        const rowId = newRow[0];
                        workingSheet.content.push(newRow);
                        const newIndex = workingSheet.content.length - 1;

                        logDebug_ACU(`insertRow: Inserted row at index ${newIndex} in [${tableName}]`);
                        return {
                            success: true,
                            value: newIndex,
                            tableData: workingData as any,
                            persist: {
                                operations: [{ kind: 'row_upsert', sheetKey: targetSheetKey, rowId, cells: [...newRow] }],
                            },
                        };
                    });
                    if (!commitResult.success || typeof commitResult.value !== 'number') return -1;
                    await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'insertRow', tableLatestFloorIndex, { skipChatSave, skipNotify });
                    return commitResult.value;
                }
            } catch (e) {
                logError_ACU('insertRow failed:', e);
                return -1;
            }
        },

        deleteRow: async function(tableNameOrOptions: any, rowIndex?: any) {
            try {
                const args = parseDeleteRowArgs_ACU(tableNameOrOptions, rowIndex);
                if (!args) return false;
                const {
                    tableName,
                    rowIndex: normalizedRowIndex,
                    skipChatSave,
                    skipNotify,
                } = args;

                if (normalizedRowIndex < 1) {
                    logError_ACU('deleteRow: Cannot delete header row (index 0).');
                    return false;
                }

                const target = await prepareTableMutationTarget_ACU(tableName);
                if (!target) {
                    logError_ACU(`deleteRow: Table "${tableName}" not found.`);
                    return false;
                }

                const { sheet: targetSheet, sheetKey: targetSheetKey, englishTableName } = target;

                if (normalizedRowIndex >= targetSheet.content.length) {
                    logError_ACU(`deleteRow: Row index ${normalizedRowIndex} out of bounds.`);
                    return false;
                }

                const deleteLockViolation = findTableLockViolationForCrud_ACU(targetSheetKey, targetSheet.content, {
                    rowIndex: normalizedRowIndex,
                    kind: 'delete',
                });
                if (deleteLockViolation) {
                    logWarn_ACU(`deleteRow: 表 "${tableName}" ${deleteLockViolation}，删除已拒绝。`);
                    return false;
                }

                if (isSqliteMode()) {
                    const rowId = targetSheet.content[normalizedRowIndex]?.[0];
                        // SQLite 模式：统一交给公共提交模型执行运行时 SQL 和持久化。
                        if (rowId === undefined || rowId === null) {
                            logError_ACU(`deleteRow: row_id not found at index ${normalizedRowIndex}`);
                            return false;
                        }
                        const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                        if (!skipChatSave && tableLatestFloorIndex === -1) return false;
                        const sql = `DELETE FROM ${quoteIdentifier(englishTableName)} WHERE ${quoteIdentifier('row_id')} = ?;`;
                        const params = [toSqlValueParam_ACU(rowId)];
                        const result = await runSqliteRuntimeMutationCommit_ACU<boolean>({
                            source: 'manual_crud',
                            reason: 'deleteRow:sqlite',
                            isolationKey: getCurrentIsolationKey_ACU(),
                            writeSet: [{ kind: 'row', sheetKey: targetSheetKey, rowId: String(rowId) }],
                            revisionWriteSet: [{ kind: 'row', sheetKey: targetSheetKey, rowId: String(rowId) }],
                            initialData: currentJsonTableData_ACU,
                            targetMessageIndex: tableLatestFloorIndex,
                            targetSheetKeys: [targetSheetKey],
                            updateGroupKeys: null,
                            trackingSheetKeys: [],
                            trackAsUpdate: false,
                            skipChatSave,
                            sql,
                            params,
                            validate: ({ mutationResult }) => assertSqlMutationChanged_ACU('deleteRow', `table=${englishTableName}, row_id=${rowId}`, mutationResult) ? null : 'deleteRow SQLite mutation affected 0 rows',
                            mapValue: () => true,
                        });
                        if (!result.success) return false;
                        await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'deleteRow', tableLatestFloorIndex, { skipChatSave, skipNotify });
                        return true;
                } else {
                    const rowId = targetSheet.content[normalizedRowIndex]?.[0];
                    const tableLatestFloorIndex = findTableLatestFloor(targetSheetKey, targetSheet.name);
                    if (!skipChatSave && tableLatestFloorIndex === -1) return false;
                    const writeSet = rowId === undefined || rowId === null
                        ? [{ kind: 'sheet' as const, sheetKey: targetSheetKey }]
                        : [{ kind: 'row' as const, sheetKey: targetSheetKey, rowId: String(rowId) }];
                    const commitResult = await runTableUpdateCommit_ACU<boolean>({
                        source: 'manual_crud',
                        reason: 'deleteRow',
                        isolationKey: getCurrentIsolationKey_ACU(),
                        writeSet,
                        revisionWriteSet: writeSet,
                        initialData: currentJsonTableData_ACU,
                        targetMessageIndex: tableLatestFloorIndex,
                        targetSheetKeys: [targetSheetKey],
                        updateGroupKeys: null,
                        trackingSheetKeys: [],
                        trackAsUpdate: false,
                        skipChatSave,
                    }, ({ workingData }) => {
                        const workingTarget = findTargetSheetInData_ACU(workingData as any, tableName);
                        if (!workingTarget) {
                            logError_ACU(`deleteRow: Table "${tableName}" not found.`);
                            return { success: false, error: `Table "${tableName}" not found.` };
                        }
                        const workingSheet = workingTarget.sheet;
                        if (normalizedRowIndex >= workingSheet.content.length) {
                            logError_ACU(`deleteRow: Row index ${normalizedRowIndex} out of bounds.`);
                            return { success: false, error: `Row index ${normalizedRowIndex} out of bounds.` };
                        }
                        const deletedRowId = String(workingSheet.content[normalizedRowIndex]?.[0] ?? rowId ?? '');
                        workingSheet.content.splice(normalizedRowIndex, 1);
                        logDebug_ACU(`deleteRow: Deleted row ${normalizedRowIndex} from [${tableName}]`);
                        return {
                            success: true,
                            value: true,
                            tableData: workingData as any,
                            persist: {
                                operations: deletedRowId ? [{ kind: 'row_delete', sheetKey: targetSheetKey, rowId: deletedRowId }] : [],
                            },
                        };
                    });
                    if (!commitResult.success || !commitResult.value) return false;
                    await finalizeTableEditAfterCommit_ACU(targetSheet.name, 'deleteRow', tableLatestFloorIndex, { skipChatSave, skipNotify });
                    return true;
                }

            } catch (e) {
                logError_ACU('deleteRow failed:', e);
                return false;
            }
        },
    };
}

/**
 * 用反引号包裹标识符（表名/列名），防止中文或特殊字符导致 SQL 语法错误
 */
export function quoteIdentifier(name: string): string {
    return `\`${name.replace(/`/g, '``')}\``;
}
