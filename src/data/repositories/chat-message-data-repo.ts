/**
 * data/repositories/chat-message-data-repo.ts — 消息级表格数据 CRUD
 *
 * 封装所有对 message.TavernDB_ACU_* 字段的底层读写操作。
 * 纯数据层：不包含业务逻辑（合并策略、优先级判断等在 service/ 层）。
 *
 * 设计决策：
 * 1. 纯函数导出（与 isolation-repo.ts、profile-repo.ts 风格一致）
 * 2. 隔离配置作为参数传入（不引用 service 层的 state-manager）
 * 3. 不包含业务逻辑（不做合并策略、不做优先级判断，只做字段级 CRUD）
 * 4. 统一处理 string/object 格式（IsolatedData 可能是 JSON 字符串）
 */

import { safeJsonParse_ACU } from '../../shared/json-helpers';
import { isUsableIsolationSlotKey_ACU } from '../../shared/isolation-policy';
import { canonicalizeDisplayName_ACU, resolvePhysicalTableName_ACU } from '../../shared/sheet-identity';
import type { Sheet_ACU } from '../../shared/models/table-data';
import type {
    IsolationTagData_ACU,
    IsolatedDataContainer_ACU,
    LegacyTableContainer_ACU,
    IsolationConfig_ACU,
} from '../models/chat-message-data';

// ════════════════════════════════════════════════════════════════
// 字段清单常量（单一事实来源）
// ════════════════════════════════════════════════════════════════

/**
 * 消息上全部本地表格数据字段清单。
 * 硬清空、残留扫描与事务快照必须基于此清单；新增存储字段必须同步更新。
 */
export const MESSAGE_TABLE_FIELDS_ACU: readonly string[] = [
    'TavernDB_ACU_IsolatedData',
    'TavernDB_ACU_IndependentData',
    'TavernDB_ACU_Data',
    'TavernDB_ACU_SummaryData',
    'TavernDB_ACU_Identity',
    'TavernDB_ACU_LocalMessageAnchor',
    'TavernDB_ACU_ModifiedKeys',
    'TavernDB_ACU_UpdateGroupKeys',
    '_acu_local_template_base_state_seeded',
] as const;

/**
 * chat[0] 上额外挂载的聊天级 scope/Guide 镜像字段（含旧版表头清单）。
 * 仅在首条消息上清空；chatMetadata 侧的对应字段由 storage 层 setter 清空。
 */
export const FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU: readonly string[] = [
    'TavernDB_ACU_ScopedConfig',
    'TavernDB_ACU_InternalSheetGuide',
    'TavernDB_ACU_TableHeaderGuide',
] as const;

// ════════════════════════════════════════════════════════════════
// 内部辅助
// ════════════════════════════════════════════════════════════════

/**
 * 将 IsolatedData 字段解析为对象（处理 string/object 两种格式）。
 * 如果字段不存在或解析失败，返回 null。
 */
function parseIsolatedDataField(msg: any): IsolatedDataContainer_ACU | null {
    const raw = msg?.TavernDB_ACU_IsolatedData;
    if (!raw) return null;
    if (typeof raw === 'string') {
        const parsed = safeJsonParse_ACU(raw, null);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            ? parsed as IsolatedDataContainer_ACU
            : null;
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as IsolatedDataContainer_ACU;
    }
    return null;
}

/**
 * 检查对象中是否还有 sheet_ 开头的键。
 */
function hasAnySheetKey(obj: any): boolean {
    return obj && typeof obj === 'object' && Object.keys(obj).some(k => k.startsWith('sheet_'));
}

/**
 * 安全深拷贝。
 */
function safeClone<T>(obj: T): T {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

/**
 * 从数组中移除指定元素，返回新数组和是否发生变化。
 */
function removeFromArray(arr: string[], key: string): { result: string[]; changed: boolean } {
    if (!Array.isArray(arr) || arr.length === 0) return { result: arr || [], changed: false };
    const next = arr.filter(x => x !== key);
    return { result: next, changed: next.length !== arr.length };
}

function isObjectRecord_ACU(value: any): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasSheetKeyInRecord_ACU(record: any): boolean {
    return isObjectRecord_ACU(record) && Object.keys(record).some(k => k.startsWith('sheet_'));
}

function hasSheetKeyInArray_ACU(value: any): boolean {
    return Array.isArray(value) && value.some(item => typeof item === 'string' && item.startsWith('sheet_'));
}

/**
 * 判断候选 tagData 是否携带 Legacy-V1 表格 payload。
 *
 * 判定覆盖 V1 的表数据形态（independentData/incrementalData 含 sheet_ 键、
 * modifiedKeys/updateGroupKeys 含 sheet_ 键、_acu_storage_version === 1 且存在
 * 表字段）。合法 V2 slot（storageFrame.version === 2）与纯向量 metadata
 * （vectorMemoryState / summaryVectorIndexState / summaryVectorIndexManifest）
 * 不在此列，但“V2 frame + V1 payload 混合”仍会被拒绝。
 *
 * 该判定只识别 V1 表数据形态；是否放行由写入 barrier 结合 V2 结构统一裁决。
 */
export function isV1TablePayloadCandidate_ACU(tagData: unknown): boolean {
    if (!isObjectRecord_ACU(tagData)) return false;
    if (hasSheetKeyInRecord_ACU(tagData.independentData)) return true;
    if (hasSheetKeyInRecord_ACU(tagData.incrementalData)) return true;
    if (hasSheetKeyInArray_ACU(tagData.modifiedKeys)) return true;
    if (hasSheetKeyInArray_ACU(tagData.updateGroupKeys)) return true;
    if (tagData._acu_storage_version === 1) {
        if (Object.prototype.hasOwnProperty.call(tagData, 'independentData')
            || Object.prototype.hasOwnProperty.call(tagData, 'incrementalData')) {
            return true;
        }
    }
    return false;
}


function deleteSheetKeysFromRecord_ACU(record: any, sheetKeys: Set<string>): boolean {
    if (!isObjectRecord_ACU(record)) return false;
    let changed = false;
    sheetKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            delete record[key];
            changed = true;
        }
    });
    return changed;
}

function filterSheetKeyArray_ACU(value: any, sheetKeys: Set<string>): { value: any; changed: boolean } {
    if (!Array.isArray(value)) return { value, changed: false };
    const next = value.filter(item => !sheetKeys.has(item));
    return { value: next, changed: next.length !== value.length };
}

function purgeEventSheetKeysV2_ACU(eventLike: any, sheetKeys: Set<string>): boolean {
    if (!isObjectRecord_ACU(eventLike)) return false;
    let changed = false;
    ['filledSheetKeys', 'changedSheetKeys', 'groupKeys'].forEach(field => {
        const result = filterSheetKeyArray_ACU(eventLike[field], sheetKeys);
        if (result.changed) {
            eventLike[field] = result.value;
            changed = true;
        }
    });
    return changed;
}

const RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU = 'runtime-v1:';

function normalizeSqlIdentifierForPurge_ACU(value: any): string {
    return typeof value === 'string' ? value.trim().replace(/^[`'"\[]|[`'"\]]$/g, '').toLowerCase() : '';
}

function parseSqlDDLTableNameForPurge_ACU(ddl: any): string {
    if (typeof ddl !== 'string') return '';
    const match = ddl.match(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|'([^']+)'|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/i);
    return normalizeSqlIdentifierForPurge_ACU(match?.slice(1).find(Boolean));
}

function collectSqlTableNameCandidatesFromSheetForPurge_ACU(sheetKey: string, sheet: any, targetNames: Set<string>): void {
    const sheetKeyName = normalizeSqlIdentifierForPurge_ACU(sheetKey);
    if (sheetKeyName) targetNames.add(sheetKeyName);
    if (!isObjectRecord_ACU(sheet)) return;
    const uid = normalizeSqlIdentifierForPurge_ACU(sheet.uid);
    const name = normalizeSqlIdentifierForPurge_ACU(sheet.name);
    const ddlName = parseSqlDDLTableNameForPurge_ACU(sheet.sourceData?.ddl);
    // SQLite runtime 真正使用的物理表名是显示名的拼音 slug（如「主角信息表」→ zhujuexinxibiao），
    // AI 写出的 INSERT/UPDATE 语句引用的正是这个名字，而不是 sheetKey 或显示名本身。
    const physicalName = normalizeSqlIdentifierForPurge_ACU(resolvePhysicalTableName_ACU(sheet as Sheet_ACU, sheetKey));
    if (uid) targetNames.add(uid);
    if (name) targetNames.add(name);
    if (ddlName) targetNames.add(ddlName);
    if (physicalName) targetNames.add(physicalName);
}

function collectSqlTargetTableNamesFromRecordForPurge_ACU(record: any, sheetKeys: Set<string>, targetNames: Set<string>): void {
    if (!isObjectRecord_ACU(record)) return;
    sheetKeys.forEach(sheetKey => {
        if (Object.prototype.hasOwnProperty.call(record, sheetKey)) {
            collectSqlTableNameCandidatesFromSheetForPurge_ACU(sheetKey, record[sheetKey], targetNames);
        }
    });
}

function collectSqlTargetTableNamesFromOperationForPurge_ACU(operation: any, sheetKeys: Set<string>, targetNames: Set<string>): void {
    if (!isObjectRecord_ACU(operation)) return;
    if (operation.kind === 'sheet_replace' && sheetKeys.has(operation.sheetKey)) {
        collectSqlTableNameCandidatesFromSheetForPurge_ACU(operation.sheetKey, operation.sheet, targetNames);
        return;
    }
    if (operation.kind === 'data_replace') {
        collectSqlTargetTableNamesFromRecordForPurge_ACU(operation.data, sheetKeys, targetNames);
    }
}

export function collectSqlTargetTableNamesFromStorageFrameV2_ACU(frame: any, sheetKeys: Set<string>): Set<string> {
    const targetNames = new Set<string>();
    sheetKeys.forEach(sheetKey => {
        const normalizedSheetKey = normalizeSqlIdentifierForPurge_ACU(sheetKey);
        if (normalizedSheetKey) targetNames.add(normalizedSheetKey);
    });
    collectSqlTargetTableNamesFromRecordForPurge_ACU(frame?.checkpoint?.data, sheetKeys, targetNames);
    if (isObjectRecord_ACU(frame?.perSheetCheckpoints)) {
        sheetKeys.forEach(sheetKey => {
            const checkpoint = frame.perSheetCheckpoints[sheetKey];
            if (!isObjectRecord_ACU(checkpoint)) return;
            collectSqlTableNameCandidatesFromSheetForPurge_ACU(sheetKey, checkpoint.data, targetNames);
        });
    }
    if (Array.isArray(frame?.logEntries)) {
        frame.logEntries.forEach((entry: any) => {
            if (!isObjectRecord_ACU(entry)) return;
            if (Array.isArray(entry.operations)) {
                entry.operations.forEach(operation => collectSqlTargetTableNamesFromOperationForPurge_ACU(operation, sheetKeys, targetNames));
            }
            if (Array.isArray(entry.patches)) {
                entry.patches.forEach(patch => collectSqlTargetTableNamesFromOperationForPurge_ACU(patch, sheetKeys, targetNames));
            }
        });
    }
    return targetNames;
}

interface SqlPurgeToken_ACU {
    value: string;
    quoted: boolean;
}

interface SqlPurgeTokenizeResult_ACU {
    tokens: SqlPurgeToken_ACU[];
    reliable: boolean;
}

function tokenizeTopLevelSqlForPurge_ACU(statement: string): SqlPurgeTokenizeResult_ACU {
    const tokens: SqlPurgeToken_ACU[] = [];
    let depth = 0;
    let index = 0;
    let reliable = true;
    while (index < statement.length) {
        const char = statement[index];
        const next = statement[index + 1];
        if (/\s/.test(char)) {
            index += 1;
            continue;
        }
        if (char === '-' && next === '-') {
            index += 2;
            while (index < statement.length && statement[index] !== '\n' && statement[index] !== '\r') index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            index += 2;
            while (index < statement.length && !(statement[index] === '*' && statement[index + 1] === '/')) index += 1;
            if (index >= statement.length) {
                reliable = false;
                break;
            }
            index += 2;
            continue;
        }
        if (char === '(') {
            depth += 1;
            index += 1;
            continue;
        }
        if (char === ')') {
            if (depth === 0) reliable = false;
            depth = Math.max(0, depth - 1);
            index += 1;
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            const closing = char === '[' ? ']' : char;
            let value = '';
            let closed = false;
            index += 1;
            while (index < statement.length) {
                const current = statement[index];
                if (current === '\\' && index + 1 < statement.length) {
                    value += statement[index + 1];
                    index += 2;
                    continue;
                }
                if (current === closing) {
                    if (statement[index + 1] === closing) {
                        value += closing;
                        index += 2;
                        continue;
                    }
                    index += 1;
                    closed = true;
                    break;
                }
                value += current;
                index += 1;
            }
            if (!closed) {
                reliable = false;
                break;
            }
            if (depth === 0) tokens.push({ value, quoted: true });
            continue;
        }
        if (char === '.') {
            if (depth === 0) tokens.push({ value: '.', quoted: false });
            index += 1;
            continue;
        }
        if (/[A-Za-z_]/.test(char)) {
            const start = index;
            index += 1;
            while (index < statement.length && /[A-Za-z0-9_]/.test(statement[index])) index += 1;
            if (depth === 0) tokens.push({ value: statement.slice(start, index), quoted: false });
            continue;
        }
        index += 1;
    }
    return { tokens, reliable: reliable && depth === 0 };
}

function findTopLevelSqlKeywordForPurge_ACU(tokens: SqlPurgeToken_ACU[], keyword: string, startIndex = 0): number {
    for (let index = startIndex; index < tokens.length; index++) {
        if (!tokens[index].quoted && tokens[index].value.toUpperCase() === keyword) return index;
    }
    return -1;
}

interface SqlPurgeTableTokenResult_ACU {
    names: string[];
    nextIndex: number;
}

function readSqlTableTokenForPurge_ACU(tokens: SqlPurgeToken_ACU[], index: number): SqlPurgeTableTokenResult_ACU {
    const token = tokens[index];
    if (!token || (!token.quoted && token.value === '.')) return { names: [], nextIndex: index };
    const tableName = normalizeSqlIdentifierForPurge_ACU(token.value);
    if (!tableName) return { names: [], nextIndex: index };

    const separator = tokens[index + 1];
    const qualifiedTableToken = tokens[index + 2];
    if (!separator?.quoted && separator?.value === '.' && qualifiedTableToken
        && (qualifiedTableToken.quoted || qualifiedTableToken.value !== '.')) {
        const qualifiedTableName = normalizeSqlIdentifierForPurge_ACU(qualifiedTableToken.value);
        if (qualifiedTableName) {
            return {
                names: [`${tableName}.${qualifiedTableName}`, qualifiedTableName],
                nextIndex: index + 3,
            };
        }
    }

    return { names: [tableName], nextIndex: index + 1 };
}

function extractMutatedSqlTableNamesForPurge_ACU(statement: any): string[] {
    if (typeof statement !== 'string') return [];
    const tokenized = tokenizeTopLevelSqlForPurge_ACU(statement);
    if (!tokenized.reliable) return [];
    const tokens = tokenized.tokens;
    const conflictActions = new Set(['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE']);
    const mutationKeywords = new Set(['INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'ALTER']);
    const firstKeyword = tokens.find(token => !token.quoted)?.value.toUpperCase();
    if (!firstKeyword || (!mutationKeywords.has(firstKeyword) && firstKeyword !== 'WITH')) return [];
    const startIndex = firstKeyword === 'WITH' ? 1 : 0;
    for (let index = startIndex; index < tokens.length; index++) {
        if (tokens[index].quoted) continue;
        const keyword = tokens[index].value.toUpperCase();
        if (!mutationKeywords.has(keyword)) continue;
        if (keyword === 'INSERT') {
            const intoIndex = findTopLevelSqlKeywordForPurge_ACU(tokens, 'INTO', index + 1);
            return intoIndex >= 0 ? readSqlTableTokenForPurge_ACU(tokens, intoIndex + 1).names : [];
        }
        if (keyword === 'REPLACE') {
            const intoIndex = findTopLevelSqlKeywordForPurge_ACU(tokens, 'INTO', index + 1);
            return intoIndex >= 0 ? readSqlTableTokenForPurge_ACU(tokens, intoIndex + 1).names : [];
        }
        if (keyword === 'UPDATE') {
            let tableIndex = index + 1;
            if (!tokens[tableIndex]?.quoted && tokens[tableIndex]?.value.toUpperCase() === 'OR') {
                const action = tokens[tableIndex + 1];
                if (!action || action.quoted || !conflictActions.has(action.value.toUpperCase())) return [];
                tableIndex += 2;
            }
            return readSqlTableTokenForPurge_ACU(tokens, tableIndex).names;
        }
        if (keyword === 'DELETE') {
            const fromIndex = findTopLevelSqlKeywordForPurge_ACU(tokens, 'FROM', index + 1);
            return fromIndex >= 0 ? readSqlTableTokenForPurge_ACU(tokens, fromIndex + 1).names : [];
        }
        if (keyword === 'ALTER') {
            const tableIndex = findTopLevelSqlKeywordForPurge_ACU(tokens, 'TABLE', index + 1);
            if (tableIndex < 0) return [];
            const sourceTable = readSqlTableTokenForPurge_ACU(tokens, tableIndex + 1);
            const renameToken = tokens[sourceTable.nextIndex];
            const toToken = tokens[sourceTable.nextIndex + 1];
            if (!renameToken?.quoted && renameToken?.value.toUpperCase() === 'RENAME'
                && !toToken?.quoted && toToken?.value.toUpperCase() === 'TO') {
                const targetTable = readSqlTableTokenForPurge_ACU(tokens, sourceTable.nextIndex + 2);
                return [...sourceTable.names, ...targetTable.names];
            }
            return sourceTable.names;
        }
    }
    return [];
}

function purgeRuntimeRevisionSnapshotSheetKeysV2_ACU(value: any, sheetKeys: Set<string>): { value: any; changed: boolean } {
    if (typeof value !== 'string' || !value.startsWith(RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU)) {
        return { value, changed: false };
    }

    let snapshot: any;
    try {
        snapshot = JSON.parse(value.slice(RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU.length));
    } catch {
        return { value, changed: false };
    }

    if (!isObjectRecord_ACU(snapshot) || !isObjectRecord_ACU(snapshot.sheets)) {
        return { value, changed: false };
    }

    if (!deleteSheetKeysFromRecord_ACU(snapshot.sheets, sheetKeys)) {
        return { value, changed: false };
    }

    return {
        value: `${RUNTIME_REVISION_SNAPSHOT_PREFIX_V2_ACU}${JSON.stringify(snapshot)}`,
        changed: true,
    };
}

function purgeManualRefillProgressV2_ACU(progress: any, sheetKeys: Set<string>): boolean {
    if (!isObjectRecord_ACU(progress)) return false;
    let changed = false;
    const selected = filterSheetKeyArray_ACU(progress.selectedSheetKeys, sheetKeys);
    if (selected.changed) {
        progress.selectedSheetKeys = selected.value;
        changed = true;
    }
    if (deleteSheetKeysFromRecord_ACU(progress.completedSheetMessageIndexByKey, sheetKeys)) {
        changed = true;
    }
    if (Array.isArray(progress.selectedSheetKeys) && progress.selectedSheetKeys.length === 0) {
        // 不留下无目标表、无法继续或恢复的幽灵运行记录。
        progress.status = 'complete';
        if (typeof progress.lastError === 'string') delete progress.lastError;
        changed = true;
    }
    return changed;
}

function purgeSqlBatchOperationV2_ACU(operation: any, targetSqlTableNames: Set<string>): { operation: any | null; changed: boolean } {
    if (!Array.isArray(operation.statements) || targetSqlTableNames.size === 0) {
        return { operation, changed: false };
    }
    const keepIndices: number[] = [];
    operation.statements.forEach((statement: any, index: number) => {
        const mutatedTables = extractMutatedSqlTableNamesForPurge_ACU(statement);
        const touchesTarget = mutatedTables.some(tableName => targetSqlTableNames.has(tableName));
        if (!touchesTarget) keepIndices.push(index);
    });
    if (keepIndices.length === operation.statements.length) return { operation, changed: false };
    if (keepIndices.length === 0) return { operation: null, changed: true };
    const nextOperation: any = {
        ...operation,
        statements: keepIndices.map(index => operation.statements[index]),
    };
    if (Array.isArray(operation.params)) {
        nextOperation.params = keepIndices.map(index => operation.params[index]);
    }
    return { operation: nextOperation, changed: true };
}

/**
 * sql_sheet_batch 的 sheetKey 可能是同一张表的另一代 key（模板换代、兼容归并），
 * 但语句里的物理表名不会变。key 不命中时按 tableName / 语句改写的表名再判一次，
 * 否则「删除主角信息表」会放过旧 key 写下的 INSERT INTO zhujuexinxibiao。
 */
function purgeSqlSheetBatchOperationV2_ACU(operation: any, targetSqlTableNames: Set<string>): { operation: any | null; changed: boolean } {
    const tableName = normalizeSqlIdentifierForPurge_ACU(operation.tableName);
    if (tableName && targetSqlTableNames.has(tableName)) {
        return { operation: null, changed: true };
    }
    return purgeSqlBatchOperationV2_ACU(operation, targetSqlTableNames);
}

function purgeOperationV2_ACU(operation: any, sheetKeys: Set<string>, targetSqlTableNames: Set<string>): { operation: any | null; changed: boolean } {
    if (!isObjectRecord_ACU(operation)) return { operation, changed: false };

    if (
        (operation.kind === 'sheet_replace'
            || operation.kind === 'sheet_schema_migrate'
            || operation.kind === 'row_upsert'
            || operation.kind === 'row_delete'
            || operation.kind === 'meta_update'
            || operation.kind === 'sql_sheet_batch')
        && sheetKeys.has(operation.sheetKey)
    ) {
        return { operation: null, changed: true };
    }

    if (operation.kind === 'data_replace') {
        // data_replace 是整库替换：仅裁掉目标表 payload 会让回放状态缺失该表，
        // 也会伪造并不存在的历史。调用方若需要覆盖目标表，必须写入末端 rebase。
        return { operation, changed: false };
    }

    if (operation.kind === 'sql_batch') {
        return purgeSqlBatchOperationV2_ACU(operation, targetSqlTableNames);
    }

    if (operation.kind === 'sql_sheet_batch') {
        return purgeSqlSheetBatchOperationV2_ACU(operation, targetSqlTableNames);
    }

    return { operation, changed: false };
}

function purgePatchV2_ACU(patch: any, sheetKeys: Set<string>, targetSqlTableNames: Set<string>): { patch: any | null; changed: boolean } {
    if (!isObjectRecord_ACU(patch)) return { patch, changed: false };
    if (
        (patch.kind === 'sheet_replace'
            || patch.kind === 'row_upsert'
            || patch.kind === 'row_delete'
            || patch.kind === 'meta_update'
            || patch.kind === 'sql_sheet_batch')
        && sheetKeys.has(patch.sheetKey)
    ) {
        return { patch: null, changed: true };
    }

    if (patch.kind === 'data_replace') {
        // 旧 derived patch 同样可能承载整库替换，不能按 sheetKey 伪造局部历史。
        return { patch, changed: false };
    }

    if (patch.kind === 'sql_batch') {
        const result = purgeSqlBatchOperationV2_ACU(patch, targetSqlTableNames);
        return { patch: result.operation, changed: result.changed };
    }
    if (patch.kind === 'sql_sheet_batch') {
        const result = purgeSqlSheetBatchOperationV2_ACU(patch, targetSqlTableNames);
        return { patch: result.operation, changed: result.changed };
    }
    return { patch, changed: false };
}

function purgeWriteSetV2_ACU(writeSet: any, sheetKeys: Set<string>): { writeSet: any; changed: boolean } {
    if (!Array.isArray(writeSet)) return { writeSet, changed: false };
    const next = writeSet.filter(unit => {
        if (!isObjectRecord_ACU(unit)) return true;
        if (unit.kind === 'all') return true;
        return !sheetKeys.has(unit.sheetKey);
    });
    return { writeSet: next, changed: next.length !== writeSet.length };
}

function purgeOperationArrayV2_ACU(operations: any, sheetKeys: Set<string>, targetSqlTableNames: Set<string>): { value: any; changed: boolean } {
    if (!Array.isArray(operations)) return { value: operations, changed: false };
    let changed = false;
    const next: any[] = [];
    operations.forEach(operation => {
        const result = purgeOperationV2_ACU(operation, sheetKeys, targetSqlTableNames);
        if (result.changed) changed = true;
        if (result.operation) next.push(result.operation);
    });
    return { value: next, changed };
}

function hasNonEmptyArray_ACU(value: any): boolean {
    return Array.isArray(value) && value.length > 0;
}

function hasMeaningfulManualRefillLogPayloadV2_ACU(entry: any): boolean {
    return hasNonEmptyArray_ACU(entry?.operations) || hasNonEmptyArray_ACU(entry?.patches) || hasNonEmptyArray_ACU(entry?.filledSheetKeys) || hasNonEmptyArray_ACU(entry?.changedSheetKeys) || hasNonEmptyArray_ACU(entry?.groupKeys) || hasNonEmptyArray_ACU(entry?.event?.filledSheetKeys) || hasNonEmptyArray_ACU(entry?.event?.changedSheetKeys) || hasNonEmptyArray_ACU(entry?.event?.groupKeys) || (Array.isArray(entry?.writeSet) && entry.writeSet.some((unit: any) => isObjectRecord_ACU(unit) && unit.kind !== 'all')) || hasNonEmptyArray_ACU(entry?.manualRefillProgress?.selectedSheetKeys) || (isObjectRecord_ACU(entry?.manualRefillProgress?.completedSheetMessageIndexByKey) && Object.keys(entry.manualRefillProgress.completedSheetMessageIndexByKey).length > 0);
}

function purgePatchArrayV2_ACU(patches: any, sheetKeys: Set<string>, targetSqlTableNames: Set<string>): { value: any; changed: boolean } {
    if (!Array.isArray(patches)) return { value: patches, changed: false };
    let changed = false;
    const next: any[] = [];
    patches.forEach(patch => {
        const result = purgePatchV2_ACU(patch, sheetKeys, targetSqlTableNames);
        if (result.changed) changed = true;
        if (result.patch) next.push(result.patch);
    });
    return { value: next, changed };
}

function purgeTransitionDataReplacePayloads_ACU(frame: any, sheetKeys: Set<string>): boolean {
    if (!Array.isArray(frame?.logEntries)) return false;
    let changed = false;
    for (const entry of frame.logEntries) {
        if (!isObjectRecord_ACU(entry)) continue;
        for (const field of ['operations', 'patches']) {
            const artifacts = entry[field];
            if (!Array.isArray(artifacts)) continue;
            for (const artifact of artifacts) {
                if (!isObjectRecord_ACU(artifact) || artifact.kind !== 'data_replace') continue;
                if (deleteSheetKeysFromRecord_ACU(artifact.data, sheetKeys)) changed = true;
            }
        }
    }
    return changed;
}

/**
 * 私有过渡根是已经 canonical 的完整状态。单表删除直接裁剪它及所有整库替换
 * payload，不再要求 cutoff artifact 仍存在，也不把删除操作变成新的准入门禁。
 */
function purgeSpv79TransitionCheckpointSheetKeys_ACU(tagData: any, sheetKeys: Set<string>): boolean {
    let changed = false;
    for (const slotKey of ['spv79TransitionCheckpoint', 'compatTransitionCheckpoint'] as const) {
        const checkpoint = tagData?.[slotKey];
        if (!isObjectRecord_ACU(checkpoint)) continue;
        let slotChanged = false;
        if (deleteSheetKeysFromRecord_ACU(checkpoint.data, sheetKeys)) slotChanged = true;
        if (deleteSheetKeysFromRecord_ACU(checkpoint.scheduleSummary, sheetKeys)) slotChanged = true;
        if (purgeTransitionDataReplacePayloads_ACU(tagData.storageFrame, sheetKeys)) slotChanged = true;
        if (slotChanged && !hasSheetKeyInRecord_ACU(checkpoint.data)) {
            delete tagData[slotKey];
        }
        if (slotChanged) changed = true;
    }
    return changed;
}

function mergeKnownSqlTableNamesForPurge_ACU(targetSqlTableNames: Set<string>, knownSqlTableNames?: Iterable<string>): void {
    if (!knownSqlTableNames) return;
    for (const tableName of knownSqlTableNames) {
        const normalized = normalizeSqlIdentifierForPurge_ACU(tableName);
        if (normalized) targetSqlTableNames.add(normalized);
    }
}

/**
 * 纪要向量镜像随纪要表 sheetKey 一起删除：sheetKeys 含 summaryVectorIndexFrame.sourceTableKey
 * 时整体移除镜像 frame（checkpoint + delta）。外置对象由 reachability GC 回收。
 */
function purgeSummaryVectorMirrorForDeletedSheetsV2_ACU(frame: any, sheetKeys: Set<string>): boolean {
    if (!isObjectRecord_ACU(frame)) return false;
    const mirror = frame.summaryVectorIndexFrame;
    if (!isObjectRecord_ACU(mirror)) return false;
    const sourceTableKey = typeof mirror.sourceTableKey === 'string' ? mirror.sourceTableKey : '';
    if (!sourceTableKey || !sheetKeys.has(sourceTableKey)) return false;
    delete frame.summaryVectorIndexFrame;
    return true;
}

/**
 * 表格 full checkpoint 被移除后 vector checkpoint 失去锚点（不变量：vector checkpoint 只允许存在于
 * full checkpoint frame），必须同步删除；同层 delta 仍与各自 table entry 同生共死，保留。
 */
function purgeSummaryVectorCheckpointWithoutTableCheckpointV2_ACU(frame: any): boolean {
    if (!isObjectRecord_ACU(frame)) return false;
    const mirror = frame.summaryVectorIndexFrame;
    if (!isObjectRecord_ACU(mirror) || mirror.checkpoint === undefined) return false;
    if (frame.checkpoint?.kind === 'full') return false;
    delete mirror.checkpoint;
    return true;
}

/**
 * vector delta 与来源 table entry 同生共死（R2）：logEntries 被裁剪后，sourceTableEntry.entryId
 * 已不存在的 delta 是 orphan，直接移除。镜像 frame 既无 checkpoint 也无 delta 时整体删除，
 * 避免残留空容器被误判为"已建立镜像"。
 */
function purgeOrphanSummaryVectorDeltasV2_ACU(frame: any): boolean {
    if (!isObjectRecord_ACU(frame)) return false;
    const mirror = frame.summaryVectorIndexFrame;
    if (!isObjectRecord_ACU(mirror)) return false;
    let changed = false;
    if (Array.isArray(mirror.logEntries)) {
        const tableEntryIds = new Set<string>(
            (Array.isArray(frame.logEntries) ? frame.logEntries : [])
                .map((entry: any) => entry?.entryId)
                .filter((entryId: unknown): entryId is string => typeof entryId === 'string' && entryId.length > 0),
        );
        const nextDeltas = mirror.logEntries.filter((delta: any) => {
            const sourceEntryId = delta?.sourceTableEntry?.entryId;
            return typeof sourceEntryId === 'string' && tableEntryIds.has(sourceEntryId);
        });
        if (nextDeltas.length !== mirror.logEntries.length) {
            mirror.logEntries = nextDeltas;
            changed = true;
        }
    }
    const hasDeltas = Array.isArray(mirror.logEntries) && mirror.logEntries.length > 0;
    if (!hasDeltas && mirror.checkpoint === undefined) {
        delete frame.summaryVectorIndexFrame;
        changed = true;
    }
    return changed;
}

function purgeSheetKeysFromStorageFrameV2_ACU(frame: any, sheetKeys: Set<string>, knownSqlTableNames?: Iterable<string>): boolean {
    if (!isObjectRecord_ACU(frame)) return false;
    let changed = false;
    const previousHeadRevision = frame.headRevision;
    // 本帧可能没有目标表的定义（只有增量），物理表名要靠调用方从整条聊天/运行时收集后传入。
    const targetSqlTableNames = collectSqlTargetTableNamesFromStorageFrameV2_ACU(frame, sheetKeys);
    mergeKnownSqlTableNamesForPurge_ACU(targetSqlTableNames, knownSqlTableNames);

    // 删除的是纪要表本身时，向量镜像整体随之消失。
    if (purgeSummaryVectorMirrorForDeletedSheetsV2_ACU(frame, sheetKeys)) changed = true;

    const checkpoint = frame.checkpoint;
    if (isObjectRecord_ACU(checkpoint)) {
        if (deleteSheetKeysFromRecord_ACU(checkpoint.data, sheetKeys)) changed = true;
        if (deleteSheetKeysFromRecord_ACU(checkpoint.scheduleSummary, sheetKeys)) changed = true;
        if (purgeEventSheetKeysV2_ACU(checkpoint.event, sheetKeys)) changed = true;
        if (purgeManualRefillProgressV2_ACU(checkpoint.manualRefillProgress, sheetKeys)) changed = true;
        // Task 5：checkpoint.data 已无任何 sheet_ 键时，该 checkpoint 失去全部表内容，
        // 保留只会让 replay 以空根继续（并诱发“写目标早于回放根”类伪拓扑）。直接移除，
        // 让 frame 退回“无锚点 + logEntries”形态，由后续写入按初始 checkpoint 重建。
        // 例外：checkpoint 仍携带 manualRefillProgress 时保留——那是进度的合法载体，
        // 删除会丢失重填进度（既有测试「从 V2 manualRefillProgress 中移除目标 sheet」依赖此行为）。
        if (!hasSheetKeyInRecord_ACU(checkpoint.data) && checkpoint.manualRefillProgress === undefined) {
            delete frame.checkpoint;
            changed = true;
            // 表格 full checkpoint 消失后 vector checkpoint 失去锚点，同步删除。
            if (purgeSummaryVectorCheckpointWithoutTableCheckpointV2_ACU(frame)) changed = true;
        }
    }

    if (purgeEventSheetKeysV2_ACU(frame.event, sheetKeys)) changed = true;

    if (purgeManualRefillProgressV2_ACU(frame.manualRefillProgress, sheetKeys)) changed = true;

    if (isObjectRecord_ACU(frame.perSheetCheckpoints)) {
        sheetKeys.forEach(sheetKey => {
            if (!Object.prototype.hasOwnProperty.call(frame.perSheetCheckpoints, sheetKey)) return;
            delete frame.perSheetCheckpoints[sheetKey];
            changed = true;
        });
    }

    if (Array.isArray(frame.logEntries)) {
        const previousEntryRevisions = new Set(frame.logEntries
            .map((entry: any) => entry?.commitRevision)
            .filter((revision: unknown): revision is string => typeof revision === 'string'));
        const nextEntries: any[] = [];
        frame.logEntries.forEach((entry: any) => {
            if (!isObjectRecord_ACU(entry)) {
                nextEntries.push(entry);
                return;
            }
            let entryChanged = false;
            if (purgeEventSheetKeysV2_ACU(entry, sheetKeys)) entryChanged = true;
            const operations = purgeOperationArrayV2_ACU(entry.operations, sheetKeys, targetSqlTableNames);
            if (operations.changed) {
                entry.operations = operations.value;
                entryChanged = true;
            }
            const patches = purgePatchArrayV2_ACU(entry.patches, sheetKeys, targetSqlTableNames);
            if (patches.changed) {
                entry.patches = patches.value;
                entryChanged = true;
            }
            const writeSet = purgeWriteSetV2_ACU(entry.writeSet, sheetKeys);
            if (writeSet.changed) {
                entry.writeSet = writeSet.writeSet;
                entryChanged = true;
            }
            if (purgeManualRefillProgressV2_ACU(entry.manualRefillProgress, sheetKeys)) entryChanged = true;
            const baseRevision = purgeRuntimeRevisionSnapshotSheetKeysV2_ACU(entry.baseRevision, sheetKeys);
            if (baseRevision.changed) {
                entry.baseRevision = baseRevision.value;
                entryChanged = true;
            }
            const parentRevision = purgeRuntimeRevisionSnapshotSheetKeysV2_ACU(entry.parentRevision, sheetKeys);
            if (parentRevision.changed) {
                entry.parentRevision = parentRevision.value;
                entryChanged = true;
            }
            if (entryChanged) changed = true;
            if (!entryChanged || hasMeaningfulManualRefillLogPayloadV2_ACU(entry)) nextEntries.push(entry);
        });
        if (nextEntries.length !== frame.logEntries.length) changed = true;
        frame.logEntries = nextEntries;
        if (changed) normalizeManualRefillFrameHeadRevisionV2_ACU(frame, previousHeadRevision, previousEntryRevisions);
        // Task 5：logEntries 清空后 headRevision 失去语义（它指向日志头），必须一并清掉，
        // 否则空 frame 仍带 headRevision 会被 hasUnanchoredReplayArtifacts 类判定误认为 artifact。
        if (frame.logEntries.length === 0 && frame.headRevision !== undefined && frame.headRevision !== null) {
            frame.headRevision = null;
            changed = true;
        }
    }

    // 来源 table entry 被裁掉的 vector delta 随之移除（R2）。
    if (purgeOrphanSummaryVectorDeltasV2_ACU(frame)) changed = true;

    return changed;
}

function normalizeManualRefillFrameHeadRevisionV2_ACU(frame: any, previousHeadRevision: unknown, previousEntryRevisions: Set<string>): void {
    const entries = Array.isArray(frame.logEntries) ? frame.logEntries : [];
    const latestEntryRevision = [...entries].reverse().find((entry: any) => typeof entry?.commitRevision === 'string')?.commitRevision;
    frame.headRevision = latestEntryRevision || (typeof previousHeadRevision === 'string' && !previousEntryRevisions.has(previousHeadRevision) ? previousHeadRevision : null);
}

export function purgeManualRefillIncrementalSheetKeysFromStorageFrameV2_ACU(frame: any, sheetKeys: Set<string>, knownSqlTableNames?: Iterable<string>): boolean {
    if (!isObjectRecord_ACU(frame)) return false;
    // 单表 checkpoint 是重放基底；增量预清除只裁剪日志和重填进度，不能删除或改写 shard。
    // 需要替换基底时必须走完整的 purgeSheetKeysFromStorageFrameV2_ACU 流程。
    let changed = false;
    const targetSqlTableNames = collectSqlTargetTableNamesFromStorageFrameV2_ACU(frame, sheetKeys);
    mergeKnownSqlTableNamesForPurge_ACU(targetSqlTableNames, knownSqlTableNames);

    const checkpoint = frame.checkpoint;
    if (isObjectRecord_ACU(checkpoint)) {
        if (purgeManualRefillProgressV2_ACU(checkpoint.manualRefillProgress, sheetKeys)) changed = true;
    }

    if (purgeEventSheetKeysV2_ACU(frame.event, sheetKeys)) changed = true;

    if (purgeManualRefillProgressV2_ACU(frame.manualRefillProgress, sheetKeys)) changed = true;

    if (Array.isArray(frame.logEntries)) {
        const previousHeadRevision = frame.headRevision;
        const previousEntryRevisions = new Set(frame.logEntries
            .map((entry: any) => entry?.commitRevision)
            .filter((revision: unknown): revision is string => typeof revision === 'string'));
        const nextEntries: any[] = [];
        frame.logEntries.forEach((entry: any) => {
            if (!isObjectRecord_ACU(entry)) {
                nextEntries.push(entry);
                return;
            }
            let entryChanged = false;
            if (purgeEventSheetKeysV2_ACU(entry, sheetKeys)) entryChanged = true;
            if (purgeEventSheetKeysV2_ACU(entry.event, sheetKeys)) entryChanged = true;
            const operations = purgeOperationArrayV2_ACU(entry.operations, sheetKeys, targetSqlTableNames);
            if (operations.changed) {
                entry.operations = operations.value;
                entryChanged = true;
            }
            const patches = purgePatchArrayV2_ACU(entry.patches, sheetKeys, targetSqlTableNames);
            if (patches.changed) {
                entry.patches = patches.value;
                entryChanged = true;
            }
            const writeSet = purgeWriteSetV2_ACU(entry.writeSet, sheetKeys);
            if (writeSet.changed) {
                entry.writeSet = writeSet.writeSet;
                entryChanged = true;
            }
            if (purgeManualRefillProgressV2_ACU(entry.manualRefillProgress, sheetKeys)) entryChanged = true;
            const baseRevision = purgeRuntimeRevisionSnapshotSheetKeysV2_ACU(entry.baseRevision, sheetKeys);
            if (baseRevision.changed) {
                entry.baseRevision = baseRevision.value;
                entryChanged = true;
            }
            const parentRevision = purgeRuntimeRevisionSnapshotSheetKeysV2_ACU(entry.parentRevision, sheetKeys);
            if (parentRevision.changed) {
                entry.parentRevision = parentRevision.value;
                entryChanged = true;
            }
            if (entryChanged) changed = true;
            if (!entryChanged || hasMeaningfulManualRefillLogPayloadV2_ACU(entry)) {
                nextEntries.push(entry);
            }
        });
        if (nextEntries.length !== frame.logEntries.length) changed = true;
        frame.logEntries = nextEntries;
        if (changed) normalizeManualRefillFrameHeadRevisionV2_ACU(frame, previousHeadRevision, previousEntryRevisions);
    }

    // 手动重填预清除裁掉 table entry 后，其 vector delta 随之移除（R2）。
    if (purgeOrphanSummaryVectorDeltasV2_ACU(frame)) changed = true;

    return changed;
}

export function purgeManualRefillIncrementalSheetKeysFromMessage_ACU(msg: any, isolationKey: string, sheetKeys: string[], knownSqlTableNames?: Iterable<string>): boolean {
    if (!msg || !Array.isArray(sheetKeys) || sheetKeys.length === 0) return false;

    let msgChanged = false;
    const sheetKeySet = new Set(sheetKeys);
    const isolated = parseIsolatedDataField(msg);
    if (!isolated) return false;

    const nextIsolated = safeClone(isolated);
    const tagData = nextIsolated[isolationKey || ''];
    if (!tagData || typeof tagData !== 'object') return false;
    if (purgeManualRefillIncrementalSheetKeysFromStorageFrameV2_ACU((tagData as any).storageFrame, sheetKeySet, knownSqlTableNames)) {
        msgChanged = true;
    }

    if (msgChanged) {
        msg.TavernDB_ACU_IsolatedData = nextIsolated;
    }
    return msgChanged;
}

export function purgeSheetKeysFromMessageForIsolation_ACU(
    msg: any,
    isolationKey: string,
    sheetKeys: string[],
    knownSqlTableNames?: Iterable<string>,
): boolean {
    if (!msg || !Array.isArray(sheetKeys) || sheetKeys.length === 0) return false;

    let msgChanged = false;
    const sheetKeySet = new Set(sheetKeys);
    const isolated = parseIsolatedDataField(msg);
    if (!isolated) return false;

    const nextIsolated = safeClone(isolated);
    const tagKey = isolationKey || '';
    const tagData = nextIsolated[tagKey];
    if (!tagData || typeof tagData !== 'object') return false;

    if ((tagData as any).independentData && typeof (tagData as any).independentData === 'object') {
        sheetKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call((tagData as any).independentData, key)) {
                delete (tagData as any).independentData[key];
                msgChanged = true;
            }
        });
    }

    if (Array.isArray((tagData as any).modifiedKeys)) {
        sheetKeys.forEach(key => {
            const result = removeFromArray((tagData as any).modifiedKeys, key);
            if (result.changed) {
                (tagData as any).modifiedKeys = result.result;
                msgChanged = true;
            }
        });
    }

    if (Array.isArray((tagData as any).updateGroupKeys)) {
        sheetKeys.forEach(key => {
            const result = removeFromArray((tagData as any).updateGroupKeys, key);
            if (result.changed) {
                (tagData as any).updateGroupKeys = result.result;
                msgChanged = true;
            }
        });
    }

    if (purgeSpv79TransitionCheckpointSheetKeys_ACU(tagData, sheetKeySet)) {
        msgChanged = true;
    }
    if (purgeSheetKeysFromStorageFrameV2_ACU((tagData as any).storageFrame, sheetKeySet, knownSqlTableNames)) msgChanged = true;

    if (msgChanged) msg.TavernDB_ACU_IsolatedData = nextIsolated;
    return msgChanged;
}

export interface SheetIdentityAliasesForPurge_ACU {
    /** 原始目标 key ∪ 整条聊天中显示名相同的其它代 key。 */
    sheetKeys: string[];
    /** 上述全部 key 在运行时与各帧定义中的 SQL 表名候选（含拼音物理表名），已小写规范化。 */
    sqlTableNames: string[];
}

function forEachSheetDefinitionInTagData_ACU(
    tagData: any,
    visit: (sheetKey: string, sheet: any) => void,
): void {
    if (!isObjectRecord_ACU(tagData)) return;
    const visitRecord = (record: any): void => {
        if (!isObjectRecord_ACU(record)) return;
        Object.keys(record).forEach(sheetKey => {
            if (sheetKey.startsWith('sheet_')) visit(sheetKey, record[sheetKey]);
        });
    };
    for (const slotKey of ['spv79TransitionCheckpoint', 'compatTransitionCheckpoint'] as const) {
        visitRecord(tagData[slotKey]?.data);
    }
    const frame = tagData.storageFrame;
    if (!isObjectRecord_ACU(frame)) return;
    visitRecord(frame.checkpoint?.data);
    if (isObjectRecord_ACU(frame.perSheetCheckpoints)) {
        Object.keys(frame.perSheetCheckpoints).forEach(sheetKey => {
            if (!sheetKey.startsWith('sheet_')) return;
            visit(sheetKey, frame.perSheetCheckpoints[sheetKey]?.data);
        });
    }
    if (!Array.isArray(frame.logEntries)) return;
    frame.logEntries.forEach((entry: any) => {
        if (!isObjectRecord_ACU(entry)) return;
        for (const field of ['operations', 'patches'] as const) {
            const artifacts = entry[field];
            if (!Array.isArray(artifacts)) continue;
            artifacts.forEach(artifact => {
                if (!isObjectRecord_ACU(artifact)) return;
                if (artifact.kind === 'sheet_replace' && typeof artifact.sheetKey === 'string') {
                    visit(artifact.sheetKey, artifact.sheet);
                } else if (artifact.kind === 'data_replace') {
                    visitRecord(artifact.data);
                }
            });
        }
    });
}

/**
 * 按「表的身份 = 显示名」把删除目标扩展到整条聊天里的所有 key 代，并收集它们的 SQL 表名。
 *
 * 模板换代 / 兼容归并会让同一张表在历史里以多个 sheetKey 出现（如 sheet_DpKcVGqg 与
 * sheet_zhu_jue_xin_xi_biao 都是「主角信息表」）；AI 写下的 sql_sheet_batch 引用的又是
 * 显示名派生的物理表名。只按当前 key 删除会放过旧 key 的 op 与物理表名 SQL，留下用户看不到、
 * 却会在回放里撞 UNIQUE 的残留。显示名比较用 canonicalizeDisplayName_ACU 严格相等，
 * 「主角信息」不会被并入「主角信息表」。
 *
 * @param runtimeData 当前运行时表数据（可选）：目标 key 的显示名与物理表名优先从这里取。
 */
export function collectSheetIdentityAliasesForPurge_ACU(
    chat: any[] | null | undefined,
    isolationKey: string,
    sheetKeys: string[],
    runtimeData?: Record<string, any> | null,
): SheetIdentityAliasesForPurge_ACU {
    const targetKeys = new Set(
        (Array.isArray(sheetKeys) ? sheetKeys : []).filter(key => typeof key === 'string' && key.startsWith('sheet_')),
    );
    if (targetKeys.size === 0) return { sheetKeys: [], sqlTableNames: [] };

    const targetDisplayNames = new Set<string>();
    const noteDisplayName = (sheet: any): void => {
        const canonical = canonicalizeDisplayName_ACU(sheet?.name);
        if (canonical) targetDisplayNames.add(canonical);
    };
    const messages = Array.isArray(chat) ? chat : [];
    const tagDataList: any[] = [];
    messages.forEach(message => {
        if (!message || message.is_user) return;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        if (tagData) tagDataList.push(tagData);
    });

    if (isObjectRecord_ACU(runtimeData)) {
        targetKeys.forEach(sheetKey => noteDisplayName(runtimeData[sheetKey]));
    }
    tagDataList.forEach(tagData => forEachSheetDefinitionInTagData_ACU(tagData, (sheetKey, sheet) => {
        if (targetKeys.has(sheetKey)) noteDisplayName(sheet);
    }));

    const expandedKeys = new Set(targetKeys);
    if (targetDisplayNames.size > 0) {
        tagDataList.forEach(tagData => forEachSheetDefinitionInTagData_ACU(tagData, (sheetKey, sheet) => {
            if (targetDisplayNames.has(canonicalizeDisplayName_ACU(sheet?.name))) expandedKeys.add(sheetKey);
        }));
        if (isObjectRecord_ACU(runtimeData)) {
            Object.keys(runtimeData).forEach(sheetKey => {
                if (!sheetKey.startsWith('sheet_')) return;
                if (targetDisplayNames.has(canonicalizeDisplayName_ACU(runtimeData[sheetKey]?.name))) expandedKeys.add(sheetKey);
            });
        }
    }

    const sqlTableNames = new Set<string>();
    expandedKeys.forEach(sheetKey => {
        collectSqlTableNameCandidatesFromSheetForPurge_ACU(sheetKey, isObjectRecord_ACU(runtimeData) ? runtimeData[sheetKey] : undefined, sqlTableNames);
    });
    tagDataList.forEach(tagData => {
        if (!isObjectRecord_ACU(tagData?.storageFrame)) return;
        collectSqlTargetTableNamesFromStorageFrameV2_ACU(tagData.storageFrame, expandedKeys)
            .forEach(tableName => sqlTableNames.add(tableName));
    });

    return {
        sheetKeys: [...expandedKeys].sort(),
        sqlTableNames: [...sqlTableNames].sort(),
    };
}

// ════════════════════════════════════════════════════════════════
// 读取类
// ════════════════════════════════════════════════════════════════

/**
 * 读取消息上的完整隔离标签容器。
 * 返回原始容器引用；调用方如需修改必须先克隆，避免绕过仓储写入契约。
 */
export function readIsolatedDataContainer_ACU(msg: any): IsolatedDataContainer_ACU | null {
    return parseIsolatedDataField(msg);
}

/**
 * 从消息读取指定隔离标签的 IsolationTagData。
 * 统一处理 IsolatedData 字段的 string/object 两种格式。
 *
 * @param msg 聊天消息对象
 * @param isolationKey 隔离标签键名
 * @returns 标签数据，或 null（不存在时）
 */
export function readIsolatedTagData_ACU(msg: any, isolationKey: string): IsolationTagData_ACU | null {
    const container = readIsolatedDataContainer_ACU(msg);
    if (!container) return null;
    const tagData = container[isolationKey];
    if (!tagData || typeof tagData !== 'object') return null;
    return tagData;
}

/**
 * 从消息读取旧版 IndependentData。
 *
 * @param msg 聊天消息对象
 * @returns 独立表格数据，或 null
 */
export function readLegacyIndependentData_ACU(msg: any): Record<string, Sheet_ACU> | null {
    const data = msg?.TavernDB_ACU_IndependentData;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, Sheet_ACU>;
}

/**
 * 从消息读取旧版 Data（标准表）。
 *
 * @param msg 聊天消息对象
 * @returns 标准表容器，或 null
 */
export function readLegacyStandardData_ACU(msg: any): LegacyTableContainer_ACU | null {
    const data = msg?.TavernDB_ACU_Data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as LegacyTableContainer_ACU;
}

/**
 * 从消息读取旧版 SummaryData（摘要表）。
 *
 * @param msg 聊天消息对象
 * @returns 摘要表容器，或 null
 */
export function readLegacySummaryData_ACU(msg: any): LegacyTableContainer_ACU | null {
    const data = msg?.TavernDB_ACU_SummaryData;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as LegacyTableContainer_ACU;
}

/**
 * 从消息读取 Identity 字段。
 *
 * @param msg 聊天消息对象
 * @returns 隔离标识字符串，或 undefined（未设置时）
 */
export function readMessageIdentity_ACU(msg: any): string | undefined {
    return msg?.TavernDB_ACU_Identity;
}

/**
 * 从消息读取本地消息锚点字段。
 *
 * @param msg 聊天消息对象
 * @returns 本地锚点字符串，或 undefined（未设置时）
 */
export function readLocalMessageAnchor_ACU(msg: any): string | undefined {
    const anchor = String(msg?.TavernDB_ACU_LocalMessageAnchor || '').trim();
    return anchor || undefined;
}

/**
 * 从消息读取 ModifiedKeys。
 *
 * @param msg 聊天消息对象
 * @returns 修改键列表（不存在时返回空数组）
 */
export function readModifiedKeys_ACU(msg: any): string[] {
    const keys = msg?.TavernDB_ACU_ModifiedKeys;
    return Array.isArray(keys) ? keys : [];
}

/**
 * 从消息读取 UpdateGroupKeys。
 *
 * @param msg 聊天消息对象
 * @returns 更新组键列表（不存在时返回空数组）
 */
export function readUpdateGroupKeys_ACU(msg: any): string[] {
    const keys = msg?.TavernDB_ACU_UpdateGroupKeys;
    return Array.isArray(keys) ? keys : [];
}

/**
 * 判断旧版消息是否匹配当前隔离配置。
 * 封装隔离匹配逻辑：
 * - 开启隔离：Identity === code 时匹配
 * - 关闭隔离（无标签模式）：Identity 不存在时匹配
 *
 * @param msg 聊天消息对象
 * @param isolationConfig 隔离配置
 * @returns 是否匹配
 */
export function isLegacyMatchForIsolation_ACU(msg: any, isolationConfig: IsolationConfig_ACU): boolean {
    const msgIdentity = msg?.TavernDB_ACU_Identity;
    if (isolationConfig.enabled) {
        return msgIdentity === isolationConfig.code;
    }
    return !msgIdentity;
}

// ════════════════════════════════════════════════════════════════
// 写入类
// ════════════════════════════════════════════════════════════════

/**
 * 写入指定隔离标签的数据到 IsolatedData 容器。
 * 如果容器不存在会自动创建。
 *
 * @param msg 聊天消息对象
 * @param isolationKey 隔离标签键名
 * @param tagData 要写入的标签数据
 */
/**
 * Legacy-V1 表格写入被写入屏障拒绝时的稳定错误码。
 *
 * 业务层必须 fail-closed：遇到该错误码不得降级为普通 V1 写入，
 * 也不得通过自动选边、删除检测或覆盖任一侧数据“修复” mixed 冲突。
 * 诊断日志只能包含字段名、isolationKey、source 等安全元信息，
 * 不得记录表格单元格内容。
 */
export const LEGACY_V1_TABLE_WRITE_FORBIDDEN_ACU = 'LEGACY_V1_TABLE_WRITE_FORBIDDEN_ACU' as const;

/**
 * 原子写入指定隔离标签的数据到 IsolatedData 容器。
 *
 * 写入屏障：候选 tagData 若携带 Legacy-V1 表格 payload（含“V2 frame + V1
 * payload”混合形态），则拒绝写入并抛出稳定错误码，message 保持原样。
 * 合法 V2 slot（storageFrame.version === 2）与纯向量 metadata 更新不受影响。
 *
 * 屏障验证发生在对真实 message 的任何赋值之前；调用方必须自行 clone
 * 候选，避免把内存中的引用直接挂到宿主消息上。
 *
 * @throws {Error} 携带 LEGACY_V1_TABLE_WRITE_FORBIDDEN_ACU 错误码，当候选为 V1 表 payload。
 */
export function writeIsolatedTagData_ACU(msg: any, isolationKey: string, tagData: IsolationTagData_ACU): void {
    if (!msg) return;
    if (isV1TablePayloadCandidate_ACU(tagData)) {
        const error = new Error(
            `[write-barrier] 拒绝写入 Legacy-V1 表格 payload：${LEGACY_V1_TABLE_WRITE_FORBIDDEN_ACU} `
            + `isolationKey=${String(isolationKey)}`,
        );
        (error as any).code = LEGACY_V1_TABLE_WRITE_FORBIDDEN_ACU;
        throw error;
    }
    if (!msg.TavernDB_ACU_IsolatedData || typeof msg.TavernDB_ACU_IsolatedData !== 'object') {
        msg.TavernDB_ACU_IsolatedData = {};
    }
    msg.TavernDB_ACU_IsolatedData[isolationKey] = tagData;
}

/**
 * Replaces only the worldSimulation extension inside one isolation slot.
 *
 * This intentionally does not use the metadata-patch API: that API rejects
 * unknown extensions by contract. It also avoids writeIsolatedTagData_ACU,
 * whose Legacy-V1 barrier correctly rejects an unchanged slot that happens to
 * contain legacy table data. The existing slot is cloned as a whole, so table
 * fields remain byte-for-byte JSON-equivalent while only worldSimulation moves.
 */
export function writeIsolatedTagWorldSimulation_ACU(
    msg: any,
    isolationKey: string,
    worldSimulation: import('../../service/simulation/model').WorldSimulationPersistedValue_ACU,
): void {
    if (!msg) return;
    if (!isUsableIsolationSlotKey_ACU(isolationKey)) {
        throw new Error(`worldSimulation isolationKey 非法：${String(isolationKey)}`);
    }
    const rawContainer = msg.TavernDB_ACU_IsolatedData;
    const currentContainer = readIsolatedDataContainer_ACU(msg);
    if (rawContainer !== undefined && !currentContainer) {
        throw new Error('worldSimulation 隔离数据容器无法解析');
    }
    const currentSlot = currentContainer?.[isolationKey];
    if (currentSlot !== undefined && !isObjectRecord_ACU(currentSlot)) {
        throw new Error(`worldSimulation 隔离数据槽格式非法：${isolationKey}`);
    }
    const nextSlot = {
        ...(currentSlot ? safeClone(currentSlot) : {}),
        worldSimulation: safeClone(worldSimulation),
    };
    const nextContainer = isObjectRecord_ACU(currentContainer)
        ? { ...currentContainer, [isolationKey]: nextSlot }
        : { [isolationKey]: nextSlot };
    // Preserve the host's original container representation. Some persisted
    // chats use JSON strings, and silently changing them to objects makes an
    // unrelated table-storage representation observable to other consumers.
    msg.TavernDB_ACU_IsolatedData = typeof rawContainer === 'string'
        ? JSON.stringify(nextContainer)
        : nextContainer;
}

/**
 * 根据隔离配置设置或删除 Identity 字段。
 * - 隔离启用：设置 Identity 为隔离代码
 * - 隔离关闭：删除 Identity 字段
 *
 * @param msg 聊天消息对象
 * @param isolationConfig 隔离配置
 */
export function writeMessageIdentity_ACU(msg: any, isolationConfig: IsolationConfig_ACU): void {
    if (!msg) return;
    if (isolationConfig.enabled) {
        msg.TavernDB_ACU_Identity = isolationConfig.code;
    } else {
        delete msg.TavernDB_ACU_Identity;
    }
}

/**
 * 写入或删除本地消息锚点字段。
 *
 * @param msg 聊天消息对象
 * @param anchor 本地锚点；空字符串表示删除
 */
export function writeLocalMessageAnchor_ACU(msg: any, anchor: string): void {
    if (!msg) return;
    const normalizedAnchor = String(anchor || '').trim();
    if (normalizedAnchor) {
        msg.TavernDB_ACU_LocalMessageAnchor = normalizedAnchor;
    } else {
        delete msg.TavernDB_ACU_LocalMessageAnchor;
    }
}

// ════════════════════════════════════════════════════════════════
// 删除类
// ════════════════════════════════════════════════════════════════

/**
 * 从单条消息的所有字段中删除指定 sheetKey 的数据（新版+旧版）。
 * 处理删除后空对象的清理。
 *
 * @param msg 聊天消息对象
 * @param sheetKeys 要删除的 sheetKey 列表
 * @returns 是否发生了变化
 */
export function purgeSheetKeysFromMessage_ACU(msg: any, sheetKeys: string[]): boolean {
    if (!msg || !Array.isArray(sheetKeys) || sheetKeys.length === 0) return false;

    let msgChanged = false;
    const sheetKeySet = new Set(sheetKeys);

    // ── 新版：按标签分组（对该消息内所有标签槽执行删除） ──
    const isolated = parseIsolatedDataField(msg);
    if (isolated) {
        const nextIsolated = safeClone(isolated);
        Object.keys(nextIsolated).forEach(tagKey => {
            const tagData = nextIsolated[tagKey];
            if (!tagData || typeof tagData !== 'object') return;

            // 删除 independentData 中的指定 sheetKey
            if (tagData.independentData && typeof tagData.independentData === 'object') {
                sheetKeys.forEach(k => {
                    if (tagData.independentData[k]) {
                        delete tagData.independentData[k];
                        msgChanged = true;
                    }
                });
            }

            // 从 modifiedKeys 中移除
            if (Array.isArray(tagData.modifiedKeys)) {
                sheetKeys.forEach(k => {
                    const r = removeFromArray(tagData.modifiedKeys, k);
                    if (r.changed) {
                        tagData.modifiedKeys = r.result;
                        msgChanged = true;
                    }
                });
            }

            // 从 updateGroupKeys 中移除
            if (Array.isArray(tagData.updateGroupKeys)) {
                sheetKeys.forEach(k => {
                    const r = removeFromArray(tagData.updateGroupKeys, k);
                    if (r.changed) {
                        tagData.updateGroupKeys = r.result;
                        msgChanged = true;
                    }
                });
            }

            if (purgeSpv79TransitionCheckpointSheetKeys_ACU(tagData, sheetKeySet)) {
                msgChanged = true;
            }
            if (purgeSheetKeysFromStorageFrameV2_ACU((tagData as any).storageFrame, sheetKeySet)) msgChanged = true;
        });
        if (msgChanged) {
            msg.TavernDB_ACU_IsolatedData = nextIsolated;
        }
    }

    // ── 旧版：独立数据 ──
    if (msg.TavernDB_ACU_IndependentData && typeof msg.TavernDB_ACU_IndependentData === 'object') {
        const next = safeClone(msg.TavernDB_ACU_IndependentData);
        let indepChanged = false;
        sheetKeys.forEach(k => {
            if (next[k]) {
                delete next[k];
                indepChanged = true;
            }
        });
        if (indepChanged) {
            msgChanged = true;
            if (!hasAnySheetKey(next)) {
                const hasNonSheet = Object.keys(next).some(k => !k.startsWith('sheet_'));
                if (!hasNonSheet) {
                    delete msg.TavernDB_ACU_IndependentData;
                } else {
                    msg.TavernDB_ACU_IndependentData = next;
                }
            } else {
                msg.TavernDB_ACU_IndependentData = next;
            }
        }
    }

    // ── 旧版：ModifiedKeys / UpdateGroupKeys ──
    if (Array.isArray(msg.TavernDB_ACU_ModifiedKeys)) {
        let next = [...msg.TavernDB_ACU_ModifiedKeys];
        let any = false;
        sheetKeys.forEach(k => {
            const r = removeFromArray(next, k);
            if (r.changed) { next = r.result; any = true; }
        });
        if (any) { msg.TavernDB_ACU_ModifiedKeys = next; msgChanged = true; }
    }
    if (Array.isArray(msg.TavernDB_ACU_UpdateGroupKeys)) {
        let next = [...msg.TavernDB_ACU_UpdateGroupKeys];
        let any = false;
        sheetKeys.forEach(k => {
            const r = removeFromArray(next, k);
            if (r.changed) { next = r.result; any = true; }
        });
        if (any) { msg.TavernDB_ACU_UpdateGroupKeys = next; msgChanged = true; }
    }

    // ── 旧版：标准表 ──
    if (msg.TavernDB_ACU_Data && typeof msg.TavernDB_ACU_Data === 'object') {
        const next = safeClone(msg.TavernDB_ACU_Data);
        let dataChanged = false;
        sheetKeys.forEach(k => {
            if (next[k]) { delete next[k]; dataChanged = true; }
        });
        if (dataChanged) {
            msgChanged = true;
            if (!hasAnySheetKey(next)) {
                const hasNonSheet = Object.keys(next).some(k => !k.startsWith('sheet_'));
                if (!hasNonSheet) {
                    delete msg.TavernDB_ACU_Data;
                } else {
                    msg.TavernDB_ACU_Data = next;
                }
            } else {
                msg.TavernDB_ACU_Data = next;
            }
        }
    }

    // ── 旧版：摘要表 ──
    if (msg.TavernDB_ACU_SummaryData && typeof msg.TavernDB_ACU_SummaryData === 'object') {
        const next = safeClone(msg.TavernDB_ACU_SummaryData);
        let summaryChanged = false;
        sheetKeys.forEach(k => {
            if (next[k]) { delete next[k]; summaryChanged = true; }
        });
        if (summaryChanged) {
            msgChanged = true;
            if (!hasAnySheetKey(next)) {
                const hasNonSheet = Object.keys(next).some(k => !k.startsWith('sheet_'));
                if (!hasNonSheet) {
                    delete msg.TavernDB_ACU_SummaryData;
                } else {
                    msg.TavernDB_ACU_SummaryData = next;
                }
            } else {
                msg.TavernDB_ACU_SummaryData = next;
            }
        }
    }

    return msgChanged;
}

/**
 * 清除消息上所有 TavernDB_ACU_* 表格数据字段（用于重置）。
 *
 * @param msg 聊天消息对象
 */
export function clearAllTableFields_ACU(msg: any): void {
    if (!msg) return;
    MESSAGE_TABLE_FIELDS_ACU.forEach(field => {
        delete msg[field];
    });
}

/**
 * 只读残留扫描：返回消息上仍存在的本地表格数据字段名（含字符串/损坏值形态）。
 *
 * 硬清空事务必须：
 * 1. 保存前调用本函数，若存在残留则拒绝严格保存（fail-closed）；
 * 2. 保存成功后再次调用，复核 post-condition，任一字段残留视为清空未生效。
 *
 * 与 hasAnyTableData_ACU 的区别：本函数按字段名精确判定，覆盖 LocalMessageAnchor、
 * ModifiedKeys、UpdateGroupKeys 与 `_acu_local_template_base_state_seeded` 等
 * 非表格 payload 的本地数据痕迹，且不依赖隔离匹配。
 *
 * @param msg 聊天消息对象
 * @returns 仍存在的本地表格数据字段名列表（无残留时为空数组）
 */
export function scanResidualTableFields_ACU(msg: any): string[] {
    if (!msg || typeof msg !== 'object') return [];
    const residual: string[] = [];
    MESSAGE_TABLE_FIELDS_ACU.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(msg, field)) {
            residual.push(field);
        }
    });
    return residual;
}

/**
 * 只读残留扫描：返回 chat[0] 上仍存在的聊天级 scope/Guide 镜像字段名。
 * 硬清空后与 peek*Container 的 null 断言配合使用，覆盖 legacy 与 metadata 镜像。
 *
 * @param chat 聊天消息数组
 * @returns 仍存在的首条消息 scope/Guide 字段名列表
 */
export function scanResidualFirstMessageScopeFields_ACU(chat: unknown[]): string[] {
    const first = Array.isArray(chat) && chat.length > 0 ? chat[0] : null;
    if (!first || typeof first !== 'object') return [];
    const residual: string[] = [];
    FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(first, field)) {
            residual.push(field);
        }
    });
    return residual;
}

/**
 * 按隔离标签清空单条消息上的表格数据（精确版 clearAllTableFields）。
 *
 * 与 clearAllTableFields_ACU 的区别：
 * - clearAllTableFields_ACU：无差别删除所有标签的所有字段，会误删同一消息上其他标签的数据。
 * - 本函数：只删除当前隔离标签下的数据；如果消息上还有其他标签的数据则保留。
 *
 * 清理范围：
 * 1. 新版 IsolatedData[isolationKey] 槽 → 删除该标签槽；若容器变空则删除整个 IsolatedData 字段。
 * 2. 旧版兼容字段（IndependentData / Data / SummaryData / ModifiedKeys / UpdateGroupKeys / Identity）
 *    → 仅在 isolationConfig 不启用隔离或该消息的 Identity 匹配当前隔离代码时才删除。
 *    这样可以避免把同一消息上属于其他隔离标签的旧版数据误删。
 * 3. 不删除消息正文（mes）、不删除非表格业务字段。
 *
 * @param msg 聊天消息对象
 * @param isolationKey 当前隔离标签键名
 * @param isolationConfig 隔离配置（用于判断旧版字段是否属于当前标签）
 * @returns 是否有任何字段被修改（用于调用方决定是否 saveChat）
 */
export function clearTableFieldsForIsolation_ACU(
    msg: any,
    isolationKey: string,
    isolationConfig: IsolationConfig_ACU,
): boolean {
    if (!msg) return false;

    let changed = false;

    // ── 新版：删除指定隔离标签的槽 ──
    const container = parseIsolatedDataField(msg);
    if (container && container[isolationKey]) {
        delete container[isolationKey];
        changed = true;
        // 如果容器里已经没有任何标签槽了，删除整个字段
        if (Object.keys(container).length === 0) {
            delete msg.TavernDB_ACU_IsolatedData;
        } else {
            msg.TavernDB_ACU_IsolatedData = container;
        }
    }

    // ── 旧版：仅在消息属于当前隔离标签时才删除 ──
    // 判断条件与 mergeAllIndependentTables_ACU 中的 legacy 兼容逻辑一致：
    // - 隔离启用：msg.TavernDB_ACU_Identity === code 时匹配
    // - 隔离关闭（无标签模式）：msg.TavernDB_ACU_Identity 不存在时匹配
    if (isLegacyMatchForIsolation_ACU(msg, isolationConfig)) {
        if (msg.TavernDB_ACU_IndependentData) {
            delete msg.TavernDB_ACU_IndependentData;
            changed = true;
        }
        if (msg.TavernDB_ACU_Data) {
            delete msg.TavernDB_ACU_Data;
            changed = true;
        }
        if (msg.TavernDB_ACU_SummaryData) {
            delete msg.TavernDB_ACU_SummaryData;
            changed = true;
        }
        if (msg.TavernDB_ACU_Identity !== undefined) {
            delete msg.TavernDB_ACU_Identity;
            changed = true;
        }
        if (msg.TavernDB_ACU_ModifiedKeys) {
            delete msg.TavernDB_ACU_ModifiedKeys;
            changed = true;
        }
        if (msg.TavernDB_ACU_UpdateGroupKeys) {
            delete msg.TavernDB_ACU_UpdateGroupKeys;
            changed = true;
        }
    }

    return changed;
}

// ════════════════════════════════════════════════════════════════
// 辅助类
// ════════════════════════════════════════════════════════════════

/**
 * 检查消息是否包含任何表格数据（新版或旧版）。
 * 可选传入 isolationKey 和 isolationConfig 来限定检查范围。
 *
 * @param msg 聊天消息对象
 * @param isolationKey 可选，指定检查的隔离标签
 * @param isolationConfig 可选，用于旧版数据的隔离匹配
 * @returns 是否包含表格数据
 */
export function hasAnyTableData_ACU(
    msg: any,
    isolationKey?: string,
    isolationConfig?: IsolationConfig_ACU,
): boolean {
    if (!msg) return false;

    // 检查新版 IsolatedData
    if (isolationKey) {
        const tagData = readIsolatedTagData_ACU(msg, isolationKey);
        if (tagData?.independentData && Object.keys(tagData.independentData).some(k => k.startsWith('sheet_'))) {
            return true;
        }
    } else {
        const container = parseIsolatedDataField(msg);
        if (container && Object.keys(container).length > 0) {
            return true;
        }
    }

    // 检查旧版数据（如果提供了隔离配置，先检查匹配）
    if (isolationConfig && !isLegacyMatchForIsolation_ACU(msg, isolationConfig)) {
        return false;
    }

    if (msg.TavernDB_ACU_IndependentData && hasAnySheetKey(msg.TavernDB_ACU_IndependentData)) return true;
    if (msg.TavernDB_ACU_Data && hasAnySheetKey(msg.TavernDB_ACU_Data)) return true;
    if (msg.TavernDB_ACU_SummaryData && hasAnySheetKey(msg.TavernDB_ACU_SummaryData)) return true;

    return false;
}

/**
 * 深拷贝 IsolatedData 容器（安全修改用）。
 * 如果字段不存在或解析失败，返回空对象。
 *
 * @param msg 聊天消息对象
 * @returns 深拷贝后的 IsolatedData 容器
 */
export function cloneIsolatedData_ACU(msg: any): IsolatedDataContainer_ACU {
    const container = parseIsolatedDataField(msg);
    if (!container) return {};
    return safeClone(container);
}


// ════════════════════════════════════════════════════════════════
// 向量 metadata patch 边界（V1/V2 表存储投影保留专用）
// ════════════════════════════════════════════════════════════════

/**
 * metadata patch 越权修改非批准字段时的稳定错误码。
 *
 * 与 LEGACY_V1_TABLE_WRITE_FORBIDDEN_ACU 不同：该错误表示调用方向 metadata
 * patch API 传入（或试图修改）了表存储投影字段。这不是 V1 表写入，而是 API
 * 契约违规，必须 fail-closed，不得降级为整槽写入，也不得调用宿主保存。
 */
export const ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU = 'ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU' as const;

/**
 * metadata patch 的预期条件冲突错误码。
 *
 * 表示调用方声明的 expected indexId / revision 与提交时真实槽不一致，
 * 用于并发保护；不伪装成宿主保存失败。
 */
export const ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU = 'ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU' as const;

/**
 * metadata patch 批准字段白名单。
 *
 * 只允许修改向量 metadata 字段；表存储投影（storageFrame、independentData、
 * incrementalData、modifiedKeys、updateGroupKeys、_acu_*）及未知扩展字段
 * 一律不允许出现在 patch 中。新增批准字段必须先经过 contract 评审。
 */
export const ISOLATED_TAG_METADATA_PATCH_ALLOWLIST_ACU: readonly string[] = [
    'summaryVectorIndexState',
    'summaryVectorIndexManifest',
] as const;

/**
 * 返回 tagData 中不属于批准白名单的字段清单（表投影 + 未知扩展字段）。
 * vectorMemoryState 未列入白名单，因此也在此列（不允许 patch 修改）。
 */
function collectNonAllowlistedTagFields_ACU(tagData: Record<string, any>): string[] {
    return Object.keys(tagData).filter((key) => !ISOLATED_TAG_METADATA_PATCH_ALLOWLIST_ACU.includes(key as any));
}

function isDeepEqualJson_ACU(left: unknown, right: unknown): boolean {
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

/**
 * 校验候选 tagData 与当前槽的非白名单字段 key 集合一致。
 *
 * 这是 O(字段数) 的不变量检查而非深比较：候选由当前槽 clone 后仅 patch 白名单
 * 字段构造，因此表投影值在构造上不可能改变；此处只防御未来误用（例如在 clone
 * 后意外改动表字段引用），禁止对大型表做完整 JSON stringify 指纹。
 */
function hasEquivalentTableProjection_ACU(
    currentTagData: Record<string, any> | null,
    candidateTagData: Record<string, any>,
): boolean {
    const currentKeys = new Set(currentTagData ? collectNonAllowlistedTagFields_ACU(currentTagData) : []);
    const candidateKeys = new Set(collectNonAllowlistedTagFields_ACU(candidateTagData));
    if (currentKeys.size !== candidateKeys.size) return false;
    for (const key of currentKeys) {
        if (!candidateKeys.has(key)) return false;
    }
    return true;
}

/**
 * 原子 metadata patch：只允许修改批准白名单字段，保留表存储投影逐字段不变。
 *
 * 约束：
 * - 调用方只能传 patch（批准字段），不能传整份 tag snapshot。
 * - 提交时从消息重新读取最新槽（不接收外部 I/O 前捕获的 stale snapshot）。
 * - 全部校验在真实消息赋值前完成；失败时消息引用与值均不变。
 * - patch 不携带表字段时通过投影等价校验，V1/V2 表数据原样保留。
 * - patch 值语义固定：`undefined` 表示不修改该字段；`null` 表示删除该字段。
 * - 不调用宿主保存（保存由上层事务负责）。
 *
 * @param msg 聊天消息对象
 * @param isolationKey 隔离标签键名。标签隔离已退役，未开启时为 ''，空串是合法默认槽。
 * @param patch 批准字段的增量修改（仅白名单 key）
 * @param options.expectedIndexId 可选 CAS 条件：当前槽必须存在该 indexId
 * @returns { changed: boolean; tagData: IsolationTagData_ACU | null }
 */
export function patchIsolatedTagMetadata_ACU(
    msg: any,
    isolationKey: string,
    patch: Partial<Pick<IsolationTagData_ACU, 'summaryVectorIndexState' | 'summaryVectorIndexManifest'>>,
    options?: { expectedIndexId?: string },
): { changed: boolean; tagData: IsolationTagData_ACU | null } {
    if (!msg || !isUsableIsolationSlotKey_ACU(isolationKey)) return { changed: false, tagData: null };
    if (!isObjectRecord_ACU(patch)) {
        const error = new Error(
            `[metadata-patch] patch 必须是对象：${ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU} isolationKey=${String(isolationKey)}`,
        );
        (error as any).code = ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU;
        throw error;
    }

    // 1. 白名单校验：任何非批准 key 直接拒绝（赋值前，含 undefined 值 key）。
    const patchKeys = Object.keys(patch);
    const forbiddenKeys = patchKeys.filter((key) => !ISOLATED_TAG_METADATA_PATCH_ALLOWLIST_ACU.includes(key as any));
    if (forbiddenKeys.length > 0) {
        const error = new Error(
            `[metadata-patch] 越权修改非批准字段：${ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU} `
            + `isolationKey=${String(isolationKey)} fields=${forbiddenKeys.join(',')}`,
        );
        (error as any).code = ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU;
        throw error;
    }
    // 值为 undefined 的 key 表示不修改该字段。
    const effectivePatchKeys = patchKeys.filter((key) => (patch as Record<string, any>)[key] !== undefined);

    // 2. 提交时重新读取当前容器与槽（不信任调用方传入的 stale snapshot）。
    const container = readIsolatedDataContainer_ACU(msg);
    const currentTagData = (container && isObjectRecord_ACU(container[isolationKey])) ? container[isolationKey] : null;

    // 3. CAS 条件：expectedIndexId 必须与当前槽 indexId 一致。
    const expectedIndexId = options?.expectedIndexId;
    if (expectedIndexId != null) {
        const currentManifest = currentTagData?.summaryVectorIndexManifest || currentTagData?.summaryVectorIndexState?.manifest || null;
        const currentIndexId = currentManifest?.indexId ?? currentTagData?.summaryVectorIndexState?.indexId;
        if (String(currentIndexId || '') !== String(expectedIndexId)) {
            const error = new Error(
                `[metadata-patch] 预期 indexId 冲突：${ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU} `
                + `isolationKey=${String(isolationKey)} expected=${String(expectedIndexId)} actual=${String(currentIndexId || '')}`,
            );
            (error as any).code = ISOLATED_TAG_METADATA_PATCH_CONFLICT_ACU;
            throw error;
        }
    }

    // 4. 构造候选：从当前槽 clone 后仅 patch 白名单字段；无槽时构造最小槽。
    const baseTagData: Record<string, any> = currentTagData ? safeClone(currentTagData) : {};
    const candidateTagData: Record<string, any> = { ...baseTagData };
    for (const key of effectivePatchKeys) {
        const value = (patch as Record<string, any>)[key];
        if (value === null) {
            delete candidateTagData[key];
        } else {
            candidateTagData[key] = value;
        }
    }

    // 5. 投影等价校验：非白名单字段（表投影 + 未知字段）必须与当前槽逐字段一致。
    if (currentTagData) {
        if (!hasEquivalentTableProjection_ACU(currentTagData, candidateTagData)) {
            const error = new Error(
                `[metadata-patch] 表存储投影不得被 metadata patch 修改：${ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU} `
                + `isolationKey=${String(isolationKey)}`,
            );
            (error as any).code = ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU;
            throw error;
        }
    } else {
        // 无槽时：候选不得包含任何非白名单字段（最小 metadata-only 槽）。
        const nonAllowlisted = collectNonAllowlistedTagFields_ACU(candidateTagData);
        if (nonAllowlisted.length > 0) {
            const error = new Error(
                `[metadata-patch] 新槽不得携带表字段：${ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU} `
                + `isolationKey=${String(isolationKey)} fields=${nonAllowlisted.join(',')}`,
            );
            (error as any).code = ISOLATED_TAG_METADATA_PATCH_FORBIDDEN_ACU;
            throw error;
        }
    }

    // 6. no-op 检测：仅比较被 patch 的批准字段（不序列化表投影），
    //    全部等价时不制造新容器、不赋值。
    const patchedValuesEqual = effectivePatchKeys.every((key) => isDeepEqualJson_ACU(
        currentTagData ? (currentTagData as Record<string, any>)[key] : undefined,
        (candidateTagData as Record<string, any>)[key],
    ));
    if (currentTagData && patchedValuesEqual) return { changed: false, tagData: currentTagData };

    // 7. 一次赋值：替换整槽（新槽或更新槽）。
    //    必须构造新容器对象再整体赋值，禁止就地修改原容器：
    //    上层事务快照保存的是容器字段引用，就地改槽会让快照引用指向
    //    同一被污染对象，导致 strict save 失败时无法回滚对象容器
    //    （字符串容器因替换成新对象不受影响）。浅拷贝容器 + 槽 clone，
    //    不序列化表投影，符合性能约束。
    const currentContainer = readIsolatedDataContainer_ACU(msg);
    const nextContainer = isObjectRecord_ACU(currentContainer)
        ? { ...currentContainer, [isolationKey]: candidateTagData }
        : { [isolationKey]: candidateTagData };
    msg.TavernDB_ACU_IsolatedData = nextContainer;
    return { changed: true, tagData: candidateTagData as IsolationTagData_ACU };
}
