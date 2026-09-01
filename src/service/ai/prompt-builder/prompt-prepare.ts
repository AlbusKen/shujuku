/**
 * service/ai/prompt-builder/prompt-prepare.ts
 * AI 输入准备 — 格式化表格数据和对话内容为 AI 可读文本
 * 从 prompt-builder.ts 拆出（L14-L194）
 */
import { manualExtraHint_ACU } from '../../runtime/state-manager';
import { currentJsonTableData_ACU, settings_ACU } from '../../runtime/state-manager';
import type { TemplateScope_ACU } from '../../template/chat-scope';
import type { SqlTableApplyScope_ACU } from '../../../shared/table-storage-provider';
import { getUserName_ACU } from '../../../data/gateways/host-state-gateway';
import { attachSeedRowsToCurrentDataFromGuide_ACU, ensureChatSheetGuideSeeded_ACU, getEffectiveSeedRowsForSheet_ACU, getSortedSheetKeys_ACU, filterSheetKeysByTemplateScope_ACU, projectSheetForTemplateScope_ACU, resolveTemplateScope_ACU } from '../../template/chat-scope';
import { getCombinedWorldbookContent_ACU } from '../../worldbook/pipeline';
import { isDatabaseGeneratedLorebookEntry_ACU, resolveGeneratedEntriesForTable_ACU, resolveUniqueTableExportIdentity_ACU } from '../../worldbook/worldbook-placeholder-classification';
import { createLorebookReadContext_ACU, type LorebookReadContext_ACU } from '../../worldbook/read-context';
import { buildTableCandidateScope_ACU, collectAsyncTableCandidateScope_ACU, resolveLorebookReadTargets_ACU } from '../../worldbook/read-scope';
import { getCurrentWorldbookConfig_ACU } from '../../settings/settings-readers';
import { getInjectionTargetLorebook_ACU } from '../../worldbook/injection-engine';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../../data/gateways/character-gateway';
import { resolvePreTakeoverWorldbookSnapshot_ACU } from '../../agent/agent-worldbook-takeover';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, normalizeExcludeRules_ACU, normalizeExtractRules_ACU } from '../../../shared/utils';
import { applyContextTagFilters_ACU } from '../../runtime/helpers-remaining';
import { getTableLockIdentitiesForSheet_ACU } from '../../runtime/helpers-table-lock';
import { isSqliteMode } from '../../table/storage-mode';
import { ensureStorageProviderReady_ACU, getStorageRuntimeHealth_ACU } from '../../table/table-storage-strategy';
import { parseDDLTableName, rebindCreateTableName_ACU, resolveEffectiveDDL, type EffectiveDDLColumnMap_ACU } from '../../../data/sqlite/schema-mapper';
import { getSheetColumnProjection_ACU, projectSheetDDLForVisibleColumns_ACU } from '../../../shared/ddl-utils';
import { getPhysicalTableNameForSheet_ACU } from '../../../shared/sheet-identity';
import { buildSheetTableAliasMap_ACU } from '../../../shared/sql-read-resolver';
import { decodeSqlIdentifier_ACU } from '../../../shared/sql-mutation-table-rebind';
import { replaceDbSqlVariables } from '../../runtime/template-vars/sql-query-var';
import { getCurrentFlightModeState_ACU } from '../../flight-mode/flight-mode-state';
import { projectFlightModeHiddenChronicleRows_ACU } from '../../flight-mode/flight-mode-hidden-rows';

const AUTHOR_SQL_TABLE_IDENTIFIER_ACU = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface PromptRowWindow_ACU {
    rowsToProcess: any[];
    startIndex: number;
    limitNote?: string;
}

function resolvePromptRowWindow_ACU(
    table: any,
    effectiveAllRows: any[],
    flightModeEnabled: boolean,
): PromptRowWindow_ACU {
    const tableName = String(table?.name || '').trim();
    const isChronicleTable = tableName === '纪要表';
    const isFixedSummaryTable = isChronicleTable || tableName === '总结表';
    const shouldShowAllVisibleChronicleRows = flightModeEnabled && isChronicleTable;

    if (isFixedSummaryTable && !shouldShowAllVisibleChronicleRows && effectiveAllRows.length > 10) {
        const rowsToProcess = effectiveAllRows.slice(-10);
        return {
            rowsToProcess,
            startIndex: effectiveAllRows.length - rowsToProcess.length,
            limitNote: `Showing last ${rowsToProcess.length} of ${effectiveAllRows.length} entries (summary table fixed limit).`,
        };
    }

    if (!isFixedSummaryTable) {
        const sendLatestRows = typeof table?.updateConfig?.sendLatestRows === 'number'
            ? table.updateConfig.sendLatestRows
            : -1;
        if (sendLatestRows > 0 && effectiveAllRows.length > sendLatestRows) {
            const rowsToProcess = effectiveAllRows.slice(-sendLatestRows);
            return {
                rowsToProcess,
                startIndex: effectiveAllRows.length - rowsToProcess.length,
                limitNote: `Showing last ${rowsToProcess.length} of ${effectiveAllRows.length} entries (sendLatestRows=${sendLatestRows}).`,
            };
        }
    }

    return { rowsToProcess: effectiveAllRows, startIndex: 0 };
}

  export interface PrepareAIInputFailure_ACU {
    ok: false;
    failureCode: string;
    message: string;
    retryable: boolean;
  }

  function createPromptRuntimeFailure_ACU(
    failureCode: string,
    message: string,
    retryable: boolean,
  ): PrepareAIInputFailure_ACU {
    return { ok: false, failureCode, message, retryable };
  }

  function getPromptRuntimeFailureFromHealth_ACU(): PrepareAIInputFailure_ACU {
    const health = getStorageRuntimeHealth_ACU();
    if (health.status === 'loading') {
      return createPromptRuntimeFailure_ACU('runtime_loading', 'SQLite 运行时正在加载，请等待加载完成后重试。', true);
    }
    if (health.failureCode === 'provider_fallback' || health.activeMode === 'native') {
      return createPromptRuntimeFailure_ACU('provider_fallback', 'SQLite 运行时加载失败，当前未使用 SQLite 数据库。', false);
    }
    return createPromptRuntimeFailure_ACU(
      health.failureCode || 'provider_load_failed',
      'SQLite 运行时未就绪，已阻止准备 AI 输入。',
      health.status === 'idle',
    );
  }

  async function resolvePromptSourceTableData_ACU(options: any, sqlMode: boolean): Promise<any | PrepareAIInputFailure_ACU> {
    if (!sqlMode) {
        return options?.tableData || currentJsonTableData_ACU;
    }

    // schema 权威仍冻结在 sqlApplyScope（templateData / 列绑定走请求前快照）。
    // 行数据必须用本批次 tableData（baseSnapshot）：手动 SQL 重填会先清空再一次性捕获
    // runtimeData，若这里优先返回冻结行，第二桶起 AI 会一直看到空表。
    if (options?.tableData) {
        return options.tableData;
    }
    if (options?.sqlApplyScope?.runtimeData) {
        return options.sqlApplyScope.runtimeData;
    }
    if (options?.sqlApplyScope?.runtimeSchemaFailure) {
        return createPromptRuntimeFailure_ACU(
            options.sqlApplyScope.runtimeSchemaFailure.code === 'SQL_RUNTIME_SCHEMA_INVALID_ACU'
                ? 'runtime_schema_invalid'
                : 'provider_unavailable',
            options.sqlApplyScope.runtimeSchemaFailure.message,
            false,
        );
    }

    try {
        const provider = await ensureStorageProviderReady_ACU({ signal: options?.signal });
        if (provider.mode !== 'sqlite') {
            logError_ACU('prepareAIInput_ACU: SQLite mode expected a SQLite runtime provider.');
            return createPromptRuntimeFailure_ACU('provider_fallback', 'SQLite 运行时加载失败，当前未使用 SQLite 数据库。', false);
        }
        const runtimeData = provider.getCurrentData();
        if (!runtimeData) {
            logError_ACU('prepareAIInput_ACU: SQLite runtime exported no table data.');
            return createPromptRuntimeFailure_ACU('runtime_export_null', 'SQLite 运行时未导出可用表格数据。', true);
        }
        return runtimeData;
    } catch (e) {
        if ((e as any)?.name === 'AbortError') {
            throw e;
        }
        const failure = getPromptRuntimeFailureFromHealth_ACU();
        logError_ACU(`prepareAIInput_ACU: SQLite runtime unavailable (${failure.failureCode}).`, e);
        return failure;
    }
  }

  export async function prepareAIInput_ACU(
    messages: any[],
    updateMode = 'standard',
    targetSheetKeys: string[] | null = null,
    options: { tableData?: any; excludeImportTaggedWorldbookEntries?: boolean; agentGreenlights?: any[]; isolationKey?: string; templateScope?: TemplateScope_ACU; sqlApplyScope?: SqlTableApplyScope_ACU; signal?: AbortSignal; worldbookReadContext?: LorebookReadContext_ACU } = {},
  ) {
    const sqlMode = isSqliteMode();
    const sourceTableData = await resolvePromptSourceTableData_ACU(options, sqlMode);
    if (sourceTableData && typeof sourceTableData === 'object' && sourceTableData.ok === false) {
        return sourceTableData;
    }
    if (!sourceTableData) {
        logError_ACU(sqlMode
            ? 'prepareAIInput_ACU: Cannot prepare AI input, SQLite runtime DB data is null.'
            : 'prepareAIInput_ACU: Cannot prepare AI input, currentJsonTableData_ACU is null.');
        return null;
    }

    let _seedGuideDataForThisPrepare_ACU: Record<string, any> | null = null;
    let workingTableData = sourceTableData;
    try {
        if (!sqlMode) {
            _seedGuideDataForThisPrepare_ACU = await ensureChatSheetGuideSeeded_ACU({ reason: 'prepare_ai_input_seedrows' });
            if (_seedGuideDataForThisPrepare_ACU) {
                if (options?.tableData) {
                    workingTableData = JSON.parse(JSON.stringify(sourceTableData));
                    Object.keys(workingTableData).forEach((sheetKey) => {
                        if (!sheetKey.startsWith('sheet_')) return;
                        const table = workingTableData[sheetKey];
                        if (!table || typeof table !== 'object') return;
                        const existing = table?.seedRows;
                        if (Array.isArray(existing) && existing.length > 0) return;
                        const seedRows = _seedGuideDataForThisPrepare_ACU?.[sheetKey]?.seedRows;
                        if (Array.isArray(seedRows) && seedRows.length > 0) {
                            table.seedRows = JSON.parse(JSON.stringify(seedRows));
                        }
                    });
                } else {
                    attachSeedRowsToCurrentDataFromGuide_ACU(_seedGuideDataForThisPrepare_ACU);
                }
            }
        }
    } catch (e) { logWarn_ACU('[AI输入准备] ensureChatSheetGuideSeeded 失败, seed rows 可能不完整:', e); }

    const flightMode = getCurrentFlightModeState_ACU();
    if (flightMode.enabled && flightMode.hiddenRowIds.length > 0) {
        try {
            workingTableData = projectFlightModeHiddenChronicleRows_ACU(workingTableData, flightMode);
        } catch (error) {
            // 仅 prompt 投影失败时必须保留原始数据，不能以异常换来空表或中断填表。
            logWarn_ACU('[FlightMode] 填表 prompt 纪要隐藏行投影失败，已回退为未过滤数据。', error);
        }
    }

    let tableDataText = '';
    let _seedRowsTablesUsed_ACU: string[] = [];
    // 模板只起指导作用：只有模板声明的表参与 prompt。
    // 范围未知（解析失败）时不过滤，避免把所有表判成不参与。
    const templateScope = Object.prototype.hasOwnProperty.call(options, 'templateScope')
        ? options.templateScope ?? null
        : resolveTemplateScope_ACU(options.isolationKey);
    const tableIndexes = filterSheetKeysByTemplateScope_ACU(getSortedSheetKeys_ACU(workingTableData), templateScope);
    // 作者 DDL 名是 AI 写入契约。以本次请求捕获的完整模板作用域建立英文名归属索引：
    // 唯一英文名优先；冲突/缺失回退到当前拼音物理名；当前物理名碰撞必须 fail-loud。
    // 显式 sqlApplyScope 必须使用请求前模板快照，不能读取请求后变化的全局模板。
    const promptIdentifierSource = options.sqlApplyScope?.templateData || workingTableData;
    const promptTableNameForSheet = sqlMode
        ? resolvePromptTableNameForSheet_ACU(promptIdentifierSource, tableIndexes)
        : null;
    for (let tableIndex = 0; tableIndex < tableIndexes.length; tableIndex += 1) {
        const sheetKey = tableIndexes[tableIndex];
        const rawTable = workingTableData[sheetKey];
        if (!rawTable || !rawTable.name || !rawTable.content) continue;
        // 模板未声明的列合并进 hiddenPhysicalColumns，只影响投影，不改写持久化数据。
        const table: any = projectSheetForTemplateScope_ACU(rawTable, templateScope, sheetKey);

        if (targetSheetKeys && Array.isArray(targetSheetKeys)) {
            if (!targetSheetKeys.includes(sheetKey)) continue;
        }

        const isSummaryTable = isSummaryOrOutlineTable_ACU(table.name);
        let shouldShowData = true;
        
        if (!targetSheetKeys) {
            const isUnifiedMode = (updateMode === 'full' || updateMode === 'manual_unified' || updateMode === 'auto_unified');
            const isStandardMode = (updateMode === 'standard' || updateMode === 'auto_standard' || updateMode === 'manual_standard');
            const isSummaryMode = (updateMode === 'summary' || updateMode === 'auto_summary_silent' || updateMode === 'manual_summary');
            
            if (isUnifiedMode) {
                 shouldShowData = true;
            } else if (isStandardMode && isSummaryTable) {
                shouldShowData = false;
            } else if (isSummaryMode && !isSummaryTable) {
                shouldShowData = false;
            }
        }

        if (!shouldShowData) {
            continue;
        }

        // SQLite 模式：输出 DDL + 注释数据格式；数据只来自运行时 DB，不再从模板 seedRows 兜底。
        if (sqlMode) {
            const selectedPromptName = promptTableNameForSheet?.(sheetKey);
            if (selectedPromptName && typeof selectedPromptName === 'object' && 'ok' in selectedPromptName) {
                return selectedPromptName;
            }
            tableDataText += formatTableForSqliteMode(table, tableIndex, sheetKey, _seedGuideDataForThisPrepare_ACU, {
                allowSeedRowsFallback: false,
                flightModeEnabled: flightMode.enabled,
                ...(selectedPromptName as { authoredTableName?: string; runtimeTableName?: string }),
            });
            // 锁定信息软约束：硬保护由执行后差异回滚兜底，此处提示模型避开锁定目标，
            // 减少被回滚浪费的输出。
            tableDataText += buildSqlLockPromptNote_ACU(sheetKey, rawTable?.content);
            continue;
        }

        const allRows = table.content.slice(1);
        const seedRows = sqlMode ? [] : getEffectiveSeedRowsForSheet_ACU(sheetKey, { guideData: _seedGuideDataForThisPrepare_ACU, allowTemplateFallback: true });
        try {
            if ((!Array.isArray(table.seedRows) || table.seedRows.length === 0) && Array.isArray(seedRows) && seedRows.length > 0) {
                table.seedRows = JSON.parse(JSON.stringify(seedRows));
            }
        } catch (e) {}
        const isUsingSeedRows = (allRows.length === 0 && seedRows.length > 0);
        if (isUsingSeedRows) {
            try { _seedRowsTablesUsed_ACU.push(String(table.name || sheetKey)); } catch (e) {}
        }
        const effectiveAllRows = (allRows.length > 0) ? allRows : (seedRows.length > 0 ? seedRows : []);
        const visibleColumns = getSheetColumnProjection_ACU(table).visibleColumns.filter(column => column.sourceIndex > 0);
        const visibleHeaders = visibleColumns.map(column => column.header);

        if (effectiveAllRows.length === 0) {
            tableDataText += `[${tableIndex}:${table.name}]\n`;
            // [修复] 列头编号使用 0 基索引，与原生 DSL insertRow/updateRow 的对象键语义一致。
            // 原先使用 i + 1 导致列头标注为 [1:列名],[2:列名]...，
            // 而默认提示词示例使用 {"0":"...","1":"..."} 的 0 基格式，
            // 模型会把列头编号 "1" 跟对象键 "1" 做映射，导致所有数据整体右移一列。
            const headers = visibleHeaders.length > 0 ? visibleHeaders.map((h: any, i: number) => `[${i}:${h}]`).join(', ') : 'No Headers';
            tableDataText += `  Columns: ${headers}\n`;

            if (table.sourceData) {
                tableDataText += `  - Note: ${table.sourceData.note || 'N/A'}\n`;
                const initNodeContent = table.sourceData.initNode || table.sourceData.insertNode || 'N/A';
                tableDataText += `  - Init Trigger: ${initNodeContent}\n`;
            }
            tableDataText += `  (该表格为空，请进行初始化。)\n\n`;
        } else {
            tableDataText += `[${tableIndex}:${table.name}]\n`;
            // [修复] 同上——列头编号 0 基，与原生 DSL 对象键语义对齐
            const headers = visibleHeaders.length > 0 ? visibleHeaders.map((h: any, i: number) => `[${i}:${h}]`).join(', ') : 'No Headers';
            tableDataText += `  Columns: ${headers}\n`;
            if (table.sourceData) {
                tableDataText += `  - Note: ${table.sourceData.note || 'N/A'}\n`;
                tableDataText += `  - Insert Trigger: ${table.sourceData.insertNode || table.sourceData.initNode || 'N/A'}\n`;
                tableDataText += `  - Update Trigger: ${table.sourceData.updateNode || 'N/A'}\n`;
                tableDataText += `  - Delete Trigger: ${table.sourceData.deleteNode || 'N/A'}\n`;
            }
            if (isUsingSeedRows) {
                tableDataText += `  - SeedRows: 已提供模板基础数据（尚未写入聊天楼层数据；本次填表可直接基于这些行更新）\n`;
            }

            const rowWindow = resolvePromptRowWindow_ACU(table, effectiveAllRows, flightMode.enabled);
            const { rowsToProcess, startIndex } = rowWindow;
            if (rowWindow.limitNote) {
                tableDataText += `  - Note: ${rowWindow.limitNote}\n`;
            }

            if (rowsToProcess.length > 0) {
                rowsToProcess.forEach((row: any, index: number) => {
                    const originalRowIndex = startIndex + index;
                    const rowData = visibleColumns.map(column => Array.isArray(row) ? row[column.sourceIndex] : null).join(', ');
                    tableDataText += `  [${originalRowIndex}] ${rowData}\n`;
                });
            } else {
                tableDataText += '  (No data rows)\n';
            }
            tableDataText += '\n';
        }
    }
    if (_seedRowsTablesUsed_ACU.length > 0) {
        logDebug_ACU(`[SeedRows] $0 使用 seedRows 作为基础数据：${_seedRowsTablesUsed_ACU.join('、')}`);
    }
    
    let messagesText = '当前最新对话内容:\n';
    const conditionalSeedParts: string[] = [];
    if (messages && messages.length > 0) {
        const extractTags = (settings_ACU.tableContextExtractTags || '').trim();
        const extractRules = normalizeExtractRules_ACU(settings_ACU.tableContextExtractRules, extractTags);
        const excludeTags = (settings_ACU.tableContextExcludeTags || '').trim();
        const excludeRules = normalizeExcludeRules_ACU(settings_ACU.tableContextExcludeRules, excludeTags);

        messagesText += messages.map((msg: any) => {
            const prefix = msg.is_user ? getUserName_ACU() : msg.name || '角色';
            let content = msg.mes || msg.message || '';

            if (!msg.is_user && (extractTags || extractRules.length > 0 || excludeTags || excludeRules.length > 0)) {
                content = applyContextTagFilters_ACU(content, { extractTags, extractRules, excludeTags, excludeRules });
            }
            if (typeof content === 'string' && content) {
                conditionalSeedParts.push(content);
            }

            return `${prefix}: ${content}`;
        }).join('\n');
    } else {
        messagesText += '(无最新对话内容)';
    }
    const conditionalSeedContent = conditionalSeedParts.join('\n');

    const worldbookScanText = messagesText;
    const excludeImportTaggedWorldbookEntries = options?.excludeImportTaggedWorldbookEntries === true;
    let entryStateSnapshot;
    let entryStateSnapshotSignature = '';
    try {
        const resolvedSnapshot = await resolvePreTakeoverWorldbookSnapshot_ACU();
        entryStateSnapshot = resolvedSnapshot.snapshot;
        entryStateSnapshotSignature = resolvedSnapshot.expectedSignature;
    } catch (error) {
        logWarn_ACU('[Worldbook] 无法读取 Agent 世界书接管快照，填表世界书将使用 live 状态。', error);
    }
    const worldbookOptions = {
        excludeImportTaggedEntries: excludeImportTaggedWorldbookEntries,
        agentGreenlights: Array.isArray(options?.agentGreenlights) ? options.agentGreenlights : [],
        entryStateView: 'pre_takeover',
        entryStateSnapshot,
        entryStateSnapshotSignature,
    };
    // 请求级世界书读取上下文：$4/$9、表名 resolver 与同 bucket 并发 job 共享物理读取。
    // 未由上层传入时惰性创建；调用方负责 dispose（填表按 bucket attempt 管理生命周期）。
    const ownedReadContext = options?.worldbookReadContext
      ?? createLorebookReadContext_ACU({ source: 'form_fill', isActive: () => options?.signal?.aborted !== true });
    const readContext = options?.worldbookReadContext ?? ownedReadContext;
    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const syncReadScopeNames = buildTableCandidateScope_ACU([
      () => Array.isArray(worldbookConfig?.manualSelection) ? worldbookConfig.manualSelection : [],
      () => {
        const enabled = worldbookConfig?.enabledEntries;
        return enabled && typeof enabled === 'object' ? Object.keys(enabled) : [];
      },
      () => Array.isArray(options?.agentGreenlights) ? options.agentGreenlights.map((g: any) => String(g?.bookName || '').trim()).filter(Boolean) : [],
    ]);
    const asyncReadScopeNames = await collectAsyncTableCandidateScope_ACU([
      // 来源 4：当前数据注入目标世界书（内部已做宿主存在性验证，失败静默返回 null）
      async () => {
        const target = await getInjectionTargetLorebook_ACU();
        return target ? [target] : [];
      },
      // 来源 5：角色模式下当前角色绑定的 primary/additional 世界书
      async () => {
        if (worldbookConfig?.source !== 'character') return [];
        const binding = await getCurrentCharacterWorldbookBinding_ACU();
        return binding?.orderedNames || [];
      },
    ]);
    const readScopeNames = [...syncReadScopeNames, ...asyncReadScopeNames];
    const [worldbookContent, worldbookDatabaseExcludedContent] = await Promise.all([
        getCombinedWorldbookContent_ACU(worldbookScanText, {
            ...worldbookOptions,
            readContext,
            entriesByBook: await buildSharedEntriesByBook_ACU(readContext, readScopeNames),
        }),
        getCombinedWorldbookContent_ACU(worldbookScanText, {
            ...worldbookOptions,
            readContext,
            entriesByBook: await buildSharedEntriesByBook_ACU(readContext, readScopeNames),
            excludeEntry: isDatabaseGeneratedLorebookEntry_ACU,
        }),
    ]);
    const resolveTableWorldbookContent = async (tableName: string): Promise<string | null> => {
        const normalizedTableName = String(tableName || '').trim();
        if (!normalizedTableName) return null;
        try {
            const identity = resolveUniqueTableExportIdentity_ACU(normalizedTableName, workingTableData);
            if (!identity) {
                logDebug_ACU('[Worldbook] 表名占位符观测', {
                    phase: 'table_token',
                    tokenCount: 1,
                    validIdentityCount: 0,
                    candidateBookCount: 0,
                });
                return null;
            }
            // 候选作用域：只读取本次配置显式涉及的书，绝不为了找生成条目扫全库。
            const scopedEntries = await resolveCandidateScopeEntriesForTable_ACU(
                readContext,
                readScopeNames,
                normalizedTableName,
                workingTableData,
            );
            if (scopedEntries.length === 0) return null;
            const scopedKeys = new Set(scopedEntries.map((entry: any) => `${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`));
            const content = await getCombinedWorldbookContent_ACU(worldbookScanText, {
                ...worldbookOptions,
                readContext,
                entriesByBook: await buildSharedEntriesByBook_ACU(readContext, readScopeNames),
                includeGeneratedEntries: true,
                entryScope: (entry: any) => scopedKeys.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`),
            });
            return `<worldbook_context>\n${content}\n</worldbook_context>`;
        } catch (error) {
            if (String((error as any)?.message || '').startsWith('StrictLorebookRead:')) throw error;
            logWarn_ACU(`[Worldbook] 无法解析填表表名占位符 "${normalizedTableName}"，保留原 token。`, { phase: 'table_token', error: { category: 'read_failed' } });
            return null;
        }
    };
    const manualExtraHintText = manualExtraHint_ACU || '';

    // SQLite 模式下追加 SQL 编辑格式兜底说明（Q17 确认：$0 自带格式说明）
    if (isSqliteMode() && tableDataText) {
        const identifierContract = 'SQL 表名和列名必须严格照抄上方对应 CREATE TABLE 中提供的标识符，不得翻译、缩写、猜测或改写。';
        if (settings_ACU.strictJsonTableFillEnabled === true) {
            tableDataText += `\n-- [SQL 编辑格式说明]\n-- 请在响应 JSON 的 sql 字符串中仅使用 INSERT INTO / INSERT OR REPLACE INTO / REPLACE INTO / UPDATE / DELETE FROM 数据变更语句\n-- ${identifierContract}\n-- 上方 CREATE TABLE 仅用于说明表结构，严禁复制或输出 CREATE、ALTER、DROP、SELECT、PRAGMA、VACUUM、BEGIN、COMMIT、ROLLBACK 等语句\n-- 所有 UPDATE 和 DELETE 必须带 WHERE 条件，优先参考各表 Note 中的 SQL 示例和 DDL 中的 UNIQUE 约束选择定位方式\n-- 普通 INSERT 必须显式列出业务列，不得包含 row_id；row_id 由系统在执行前分配稳定身份\n-- INSERT OR REPLACE / REPLACE INTO 按 SQLite 原生整行替换语义执行，应显式提供目标列及用于冲突定位的 row_id 或 UNIQUE 列\n-- 支持表达式更新（如 SET quantity = quantity + 1）、条件批量更新、CASE 条件更新标准 SQL 写法\n-- 每条语句以分号结尾，多条语句用换行分隔\n`;
        } else {
            tableDataText += `\n-- [SQL 编辑格式说明]\n-- 请在 <tableEdit> 标签内仅使用 INSERT INTO / INSERT OR REPLACE INTO / REPLACE INTO / UPDATE / DELETE FROM 数据变更语句\n-- ${identifierContract}\n-- 上方 CREATE TABLE 仅用于说明表结构，严禁复制或输出 CREATE、ALTER、DROP、SELECT、PRAGMA、VACUUM、BEGIN、COMMIT、ROLLBACK 等语句\n-- 所有 UPDATE 和 DELETE 必须带 WHERE 条件，优先参考各表 Note 中的 SQL 示例和 DDL 中的 UNIQUE 约束选择定位方式\n-- 普通 INSERT 必须显式列出业务列，不得包含 row_id；row_id 由系统在执行前分配稳定身份\n-- INSERT OR REPLACE / REPLACE INTO 按 SQLite 原生整行替换语义执行，应显式提供目标列及用于冲突定位的 row_id 或 UNIQUE 列\n-- 支持表达式更新（如 SET quantity = quantity + 1）、条件批量更新、CASE 条件更新等标准 SQL 写法\n-- 每条语句以分号结尾，多条语句用换行分隔\n`;
        }
    }

    return {
        tableDataText,
        messagesText,
        conditionalSeedContent,
        worldbookContent,
        worldbookDatabaseExcludedContent,
        resolveTableWorldbookContent,
        manualExtraHint: manualExtraHintText,
    };
}


/**
 * Resolves the user-authored DDL identifier that AI must use for mutations.
 * Runtime names are deliberately excluded from the prompt: they are an
 * implementation detail rebound at the write boundary.
 *
 * Returns the unique author DDL name, or undefined when the name is missing,
 * invalid, or shared by more than one sheet in the same request scope.
 */
function resolveAuthoredTableNameForPrompt_ACU(data: any, sheetKey: string): string | undefined {
    const sheet = data?.[sheetKey];
    const rawTableName = parseDDLTableName(String(sheet?.sourceData?.ddl || ''));
    // 执行层 rebind 用 decodeSqlIdentifier_ACU 剥引号后做规范化比较；Prompt 层必须一致，
    // 否则带引号的 "Shared_Legacy" 会被当成无合法英文名而漏判冲突。
    const tableName = decodeSqlIdentifier_ACU(rawTableName);
    if (!tableName || !AUTHOR_SQL_TABLE_IDENTIFIER_ACU.test(tableName)) return undefined;

    let ownedPhysicalName: string | undefined;
    try {
        const registry = buildSheetTableAliasMap_ACU([data], { includeExtendedAliases: false });
        const normalized = canonicalizeAliasForPrompt_ACU(tableName);
        if (registry.conflicts.has(normalized)) return undefined;
        // owner index 的 key 可能带引号，需剥引号后匹配；冲突集同样按剥引号后的规范比较。
        const conflictKey = [...registry.conflicts].find(key => canonicalizeAliasForPrompt_ACU(decodeSqlIdentifier_ACU(key)) === normalized);
        if (conflictKey) return undefined;
        ownedPhysicalName = [...registry.aliases.entries()]
            .find(([key]) => canonicalizeAliasForPrompt_ACU(decodeSqlIdentifier_ACU(key)) === normalized)?.[1];
    } catch {
        return undefined;
    }
    const physicalName = resolvePhysicalNameForSheet_ACU(data, sheetKey);
    if (!ownedPhysicalName || !physicalName || ownedPhysicalName !== physicalName) return undefined;
    return tableName;
}

function canonicalizeAliasForPrompt_ACU(value: unknown): string {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function resolvePhysicalNameForSheet_ACU(data: any, sheetKey: string): string | undefined {
    try {
        return getPhysicalTableNameForSheet_ACU(data, sheetKey);
    } catch (error: any) {
        logWarn_ACU(`[AI输入准备] 无法解析 runtime 物理表名: ${sheetKey}: ${error?.message || error}`);
        return undefined;
    }
}

/**
 * Builds a per-request, per-sheet prompt table-name selector from the complete
 * request template scope. The selector returns the chosen prompt identifier
 * plus its authored counterpart:
 *
 * - unique author DDL name  -> { authoredTableName, runtimeTableName }
 * - missing/ambiguous name  -> { runtimeTableName } (current pinyin physical name)
 * - physical-name collision -> structured precondition failure that must not
 *                              be hidden by falling back to the author name.
 */
function resolvePromptTableNameForSheet_ACU(
    data: any,
    _sheetKeys: string[],
): (sheetKey: string) => { authoredTableName?: string; runtimeTableName?: string } | PrepareAIInputFailure_ACU {
    let registry: { aliases: Map<string, string>; conflicts: Set<string> };
    let registryFailure: PrepareAIInputFailure_ACU | null = null;
    try {
        registry = buildSheetTableAliasMap_ACU([data], { includeExtendedAliases: false });
    } catch (error: any) {
        // 当前拼音物理名自身碰撞：结构化前置失败，绝不回退英文名掩盖真实 SQLite 冲突。
        registryFailure = createPromptRuntimeFailure_ACU(
            'authored_table_name_conflict',
            `表身份解析失败：${error?.message || String(error)}`,
            false,
        );
        registry = { aliases: new Map(), conflicts: new Set() };
    }
    const ambiguousEnglishNames = new Set(
        [...registry.conflicts].map(key => canonicalizeAliasForPrompt_ACU(decodeSqlIdentifier_ACU(key))),
    );
    const ownerByEnglishName = new Map<string, string>();
    for (const [alias, physicalName] of registry.aliases) {
        const normalized = canonicalizeAliasForPrompt_ACU(decodeSqlIdentifier_ACU(alias));
        if (!normalized || ambiguousEnglishNames.has(normalized)) continue;
        ownerByEnglishName.set(normalized, physicalName);
    }
    return (sheetKey: string) => {
        if (registryFailure) return registryFailure;
        const authoredName = resolveAuthoredTableNameForPrompt_ACU(data, sheetKey);
        const runtimeName = resolvePhysicalNameForSheet_ACU(data, sheetKey);
        if (authoredName && runtimeName) {
            const normalized = canonicalizeAliasForPrompt_ACU(authoredName);
            if (!ambiguousEnglishNames.has(normalized)
                && ownerByEnglishName.get(normalized) === runtimeName) {
                return { authoredTableName: authoredName, runtimeTableName: runtimeName };
            }
        }
        if (!runtimeName) {
            return createPromptRuntimeFailure_ACU(
                'authored_table_name_conflict',
                `无法为表 ${sheetKey} 解析当前拼音物理名，已阻止构造可能误写的 AI prompt。`,
                false,
            );
        }
        return { runtimeTableName: runtimeName };
    };
}

/**
 * SQL 模式锁定信息的提示词软约束注释。
 * 无锁或内容不可解析时返回空串；有锁时输出一段 `--` 注释，
 * 用 AI 可见的定位方式（row_id / 列显示名）列出禁改目标。
 */
function buildSqlLockPromptNote_ACU(sheetKey: string, content: any[][] | null | undefined): string {
    try {
        if (!Array.isArray(content) || !Array.isArray(content[0])) return '';
        const identities = getTableLockIdentitiesForSheet_ACU(sheetKey, content);
        if (!identities.hasAny) return '';
        const parts: string[] = [];
        if (identities.rowIds.size > 0) {
            parts.push(`锁定行（禁止 UPDATE/DELETE）：row_id ∈ [${[...identities.rowIds].join(', ')}]`);
        }
        if (identities.colNames.size > 0) {
            parts.push(`锁定列（禁止修改该列任何值）：${[...identities.colNames].map(name => `「${name}」`).join('、')}`);
        }
        if (identities.cellPairs.length > 0) {
            parts.push(`锁定单元格（禁止修改）：${identities.cellPairs.map(([rowId, colName]) => `(row_id=${rowId}, 列「${colName}」)`).join('、')}`);
        }
        return `-- [锁定] 用户已锁定以下目标，请勿在 SQL 中修改它们（违规修改会被系统自动回滚）：\n${parts.map(part => `--   ${part}`).join('\n')}\n`;
    } catch (e) {
        // 软约束注入失败不能阻断填表 prompt 构建。
        return '';
    }
}

/**
 * SQLite 模式下的表格格式化
 * 输出 DDL + Note/Trigger 注释 + 当前数据（注释格式）
 */
export function formatTableForSqliteMode(
    table: any,
    tableIndex: number,
    sheetKey: string,
    guideData: any,
    options: { allowSeedRowsFallback?: boolean; runtimeTableName?: string; authoredTableName?: string; flightModeEnabled?: boolean } = {},
): string {
    let text = '';
    const projection = getSheetColumnProjection_ACU(table);
    const hasHiddenPhysicalColumns = projection.hiddenPhysicalColumns.length > 0;
    const visibleSourceIndexes = new Set(projection.visibleColumns.map(column => column.sourceIndex));
    // 显式 DDL + 隐藏列场景：resolveInsertColumnMappings 会用完整表头对齐 DDL，
    // 隐藏列表头（如「旧备注」）有业务值时会被误判为「没有对应的 DDL 列」而抛错。
    // 因此先构造仅含可见列的投影副本再 resolve，使 buildExplicitColumnMap_ACU
    // 只看到可见列（与旧实现「先压缩后 resolve」同语义，但只用于 resolve 阶段，
    // 不改变 runtime schema 权威与数据行原始布局）。
    // 投影副本构建时记录「投影下标 → 原表 sourceIndex」映射，供 resolve 结果回映射。
    const projectedIndexToOriginal: number[] = projection.visibleColumns.map(column => column.sourceIndex);
    const projectedTableForResolve = (hasHiddenPhysicalColumns && !table?._acu_runtimeEffectiveSchema)
        ? {
            ...table,
            sourceData: { ...(table.sourceData || {}), hiddenPhysicalColumns: undefined },
            content: [
                table.content[0].filter((_: unknown, index: number) => visibleSourceIndexes.has(index)),
                ...(Array.isArray(table.content) ? table.content.slice(1) : []).map((row: unknown[]) =>
                    Array.isArray(row) ? row.filter((_: unknown, index: number) => visibleSourceIndexes.has(index)) : row),
            ],
        }
        : table;
    const runtimeSchema = table?._acu_runtimeEffectiveSchema;
    // runtime effective schema（来自 SyncBridge 实际建表）是唯一权威：无 DDL fallback
    // 表或执行失败回退表都必须以此为准，禁止对模板/投影副本重新 resolve fallback，
    // 否则可能生成与既有 SQLite 表不同的列身份（test31 列漂移根因 3.1）。
    const resolvedDDL = runtimeSchema
        ? {
            effectiveDDL: runtimeSchema.effectiveDDL,
            columnMap: runtimeSchema.columnMap,
            source: runtimeSchema.source,
            diagnostics: runtimeSchema.diagnostics,
        }
        : (() => {
            const resolved = resolveEffectiveDDL(projectedTableForResolve, table.uid || sheetKey, options.runtimeTableName);
            // 投影 resolve 的 sourceIndex 是投影下标；回映射到原表下标，
            // 使 columnMappings 过滤与行取值都基于原表物理列布局。
            if (!hasHiddenPhysicalColumns) return resolved;
            return { ...resolved, columnMap: { ...resolved.columnMap, mappings: resolved.columnMap.mappings.map(mapping => ({
                ...mapping,
                sourceIndex: projectedIndexToOriginal[mapping.sourceIndex] ?? mapping.sourceIndex,
            })) } };
        })();
    let ddl = resolvedDDL.effectiveDDL;
    // 隐藏列只对 runtime DDL 做列集合投影；禁止重新生成 fallback schema。
    // 列名绝不从作者 note/trigger/旧 DDL 或重新 slug 的表头覆盖 runtime 列。
    if (hasHiddenPhysicalColumns) {
        ddl = projectSheetDDLForVisibleColumns_ACU(table, ddl);
    }
    const promptTableName = options.authoredTableName || options.runtimeTableName;
    if (promptTableName) {
        ddl = rebindCreateTableName_ACU(ddl, promptTableName);
    }
    // 隐藏列集合以投影为准，按权威列序 sourceIndex 过滤 runtime columnMap：
    // 无 DDL fallback 表的 runtime sqlName 是拼音、而投影 physicalName 是中文表头，
    // 按名称匹配会把全部列过滤掉；sourceIndex 是 SQLite 实际建表与表头之间的唯一对齐轴。
    const allowSeedRowsFallback = options.allowSeedRowsFallback !== false;

    // 输出 DDL
    text += ddl.trim() + '\n';
    if (resolvedDDL.source !== 'explicit') {
        text += `-- WARNING: ${resolvedDDL.diagnostics[0]} 原始 DDL 未被改写。\n`;
    }
    text += '-- SQL 写入时，以上 CREATE TABLE 中的列名是本轮唯一权威；Note/Trigger 中与其不一致的示例不得照抄，必须按上述列名改写。\n';
    if (options.authoredTableName) {
        text += `-- SQL 写入必须严格使用本表上方 CREATE TABLE 中的表名 ${options.authoredTableName}；不得使用其他名称。\n`;
    }

    // 输出 Note 和 Trigger（作为 SQL 注释）
    if (table.sourceData) {
        if (table.sourceData.note) text += `-- Note: ${table.sourceData.note.replace(/\n/g, '\n-- ')}\n`;
        if (table.sourceData.insertNode) text += `-- INSERT: ${table.sourceData.insertNode}\n`;
        if (table.sourceData.updateNode) text += `-- UPDATE: ${table.sourceData.updateNode}\n`;
        if (table.sourceData.deleteNode) text += `-- DELETE: ${table.sourceData.deleteNode}\n`;
    }

    // 获取有效数据行
    const allRows = table.content.slice(1);
    const seedRows = allowSeedRowsFallback ? getEffectiveSeedRowsForSheet_ACU(sheetKey, { guideData, allowTemplateFallback: true }) : [];
    const isUsingSeedRows = (allRows.length === 0 && seedRows.length > 0);
    const sourceRows = (allRows.length > 0) ? allRows : (seedRows.length > 0 ? seedRows : []);
    // 数据行必须保持原始物理列布局：columnMappings 按 runtime columnMap.sourceIndex
    // 从原始行取值（见下方 orderedValues）。若先按 visibleColumns 压缩行，再用
    // sourceIndex 取值会双重重映射错位（test31 场景第 3 个值被读成 undefined）。
    const effectiveAllRows = sourceRows;

    if (effectiveAllRows.length === 0) {
        if (table.sourceData?.initNode) {
            text += `-- INIT: ${table.sourceData.initNode.replace(/\n/g, '\n-- ')}\n`;
        }
        text += `-- (该表格为空，请进行初始化。)\n\n`;
        return text;
    }

    if (isUsingSeedRows) {
        text += `-- SeedRows: 已提供模板基础数据（尚未写入聊天楼层数据；本次填表可直接基于这些行更新）\n`;
    }

    const columnMappings: EffectiveDDLColumnMap_ACU['mappings'] = projection.hiddenPhysicalColumns.length === 0
        ? resolvedDDL.columnMap.mappings
        : resolvedDDL.columnMap.mappings.filter((mapping: EffectiveDDLColumnMap_ACU['mappings'][number]) => visibleSourceIndexes.has(mapping.sourceIndex));
    const headers = columnMappings.map(mapping => mapping.sqlName);
    const sendRowsSqlTemplate = typeof table.updateConfig?.sendRowsSqlTemplate === 'string'
        ? table.updateConfig.sendRowsSqlTemplate.trim()
        : '';

    if (sendRowsSqlTemplate && !hasHiddenPhysicalColumns) {
        const renderedRows = replaceDbSqlVariables(sendRowsSqlTemplate).trim();
        text += `\n-- 当前数据\n`;
        text += renderedRows
            ? `${renderedRows}\n`
            : '-- (No data rows)\n';
        text += '\n';
        return text;
    }
    if (sendRowsSqlTemplate) {
        logWarn_ACU(`[SQLite prompt] 已忽略表 ${table.name || sheetKey} 的 sendRowsSqlTemplate：隐藏 physical columns 时无法证明自定义 SQL 不会泄露隐藏数据。`);
    }



    // 行数限制逻辑（与原生模式一致）
    const rowWindow = resolvePromptRowWindow_ACU(table, effectiveAllRows, options.flightModeEnabled === true);
    const { rowsToProcess, startIndex } = rowWindow;
    if (rowWindow.limitNote) {
        text += `-- Note: ${rowWindow.limitNote}\n`;
    }

    // 输出当前数据（注释格式的表格）
    // 优先使用 DDL 中的英文列名作为表头，避免 AI 看到中文列名后用中文属性名写 SQL
    text += `\n-- 当前数据 (${rowsToProcess.length} rows)\n`;
    text += `-- | ${headers.join(' | ')} |\n`;
    rowsToProcess.forEach((row: any) => {
        const orderedValues = columnMappings.map(mapping => Array.isArray(row) ? row[mapping.sourceIndex] : null);
        text += `-- | ${orderedValues.join(' | ')} |\n`;
    });
    text += '\n';

    return text;
}


/**
 * 在请求级读取上下文中解析候选作用域内唯一 hostName 的条目，返回 { requestedName: entries } 映射。
 * 只读取本次配置显式涉及的书；同一 hostName 由多个逻辑名指向时只物理读取一次（readContext 去重）。
 */
async function buildSharedEntriesByBook_ACU(
  readContext: LorebookReadContext_ACU | undefined,
  scopeNames: string[],
): Promise<Record<string, any[]>> {
  const targets = await resolveLorebookReadTargets_ACU(readContext, scopeNames);
  const entriesByBook: Record<string, any[]> = {};
  await Promise.all(targets.map(async target => {
    if (!target.hostName) return;
    const entries = await readContext?.readBookEntries(target.hostName) ?? [];
    entriesByBook[target.requestedName] = entries;
  }));
  return entriesByBook;
}

/**
 * 在候选作用域内解析表名对应的生成条目。
 * 只读取候选书，绝不为了找生成条目扫全库。
 */
async function resolveCandidateScopeEntriesForTable_ACU(
  readContext: LorebookReadContext_ACU | undefined,
  scopeNames: string[],
  tableName: string,
  tableData: Record<string, any>,
): Promise<Record<string, any>[]> {
  const targets = await resolveLorebookReadTargets_ACU(readContext, scopeNames);
  logDebug_ACU('[Worldbook] 表名占位符观测', {
    phase: 'table_token',
    tokenCount: 1,
    validIdentityCount: 1,
    candidateBookCount: targets.filter(target => !!target.hostName).length,
  });
  const allEntries: Record<string, any>[] = [];
  await Promise.all(targets.map(async target => {
    if (!target.hostName) return;
    const entries = await readContext?.readBookEntries(target.hostName) ?? [];
    entries.forEach((entry: any) => allEntries.push({ ...entry, bookName: target.hostName }));
  }));
  return resolveGeneratedEntriesForTable_ACU(allEntries, tableName, tableData);
}
