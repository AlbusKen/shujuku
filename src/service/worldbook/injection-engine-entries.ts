/**
 * service/worldbook/injection-engine-entries.ts — 大纲表、总结表、重要人物表注入
 * 从 injection-engine.ts 拆出
 */
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { isWorldbookApiAvailable_ACU } from '../../data/gateways/worldbook-gateway';
import { liveTableWorldbookEntryStore_ACU, type TableWorldbookEntryStore_ACU } from './table-worldbook-entry-store';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { getImportBatchPrefix_ACU } from '../../shared/constants';
import { ensureExportConfigDefaults_ACU, normalizePlacementConfig_ACU, getFixedPlacementDefaultsForTable_ACU, applyPlacementToEntry_ACU, isEntryPlacementMatched_ACU } from './injection-engine-config';
import { buildUsedOrderSet_ACU, allocOrder_ACU, allocConsecutiveOrderBlock_ACU } from './injection-engine-order';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from './injection-engine-state';
import { getSheetColumnProjection_ACU } from '../../shared/ddl-utils';

function projectWorldbookTable_ACU(table: any): { headers: string[]; rows: any[][] } {
    const visibleColumns = getSheetColumnProjection_ACU(table).visibleColumns.filter(column => column.sourceIndex > 0);
    return {
        headers: visibleColumns.map(column => column.header),
        rows: table.content.slice(1).map((row: any[]) => visibleColumns.map(column => row[column.sourceIndex])),
    };
}

  export function splitKeywordsByComma_ACU(text: string) {
      const raw = String(text || '').trim();
      if (!raw) return [];
      return raw.split(/[,，]/).map(k => k.trim()).filter(Boolean);
  }

  export async function updateOutlineTableEntry_ACU(outlineTable: any, isImport = false, targetLorebookOverride: string | null = null, entryStore?: TableWorldbookEntryStore_ACU) { // [外部导入] 添加 isImport 标志
    if (!entryStore && !isWorldbookApiAvailable_ACU()) return;
    const store = entryStore ?? liveTableWorldbookEntryStore_ACU;
    const primaryLorebookName = targetLorebookOverride || await getInjectionTargetLorebook_ACU();
    if (!primaryLorebookName) {
        logWarn_ACU('Cannot update outline table entry: No injection target lorebook set.');
        return;
    }

    // [修改] 0TK 只控制 OutlineTable 条目；交火模式可独立运行，但不能接管"纪要索引"条目的 enabled 状态。
    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const zeroTkOccupyMode = worldbookConfig?.zeroTkOccupyMode === true;
    const outlineEntryEnabled = !zeroTkOccupyMode;
    const summaryIndexEntryEnabled = !zeroTkOccupyMode;

    const IMPORT_PREFIX = getImportBatchPrefix_ACU();
    // [修改] 加入隔离标识前缀
    const isoPrefix = getIsolationPrefix_ACU();
    const baseComment = isImport ? `${IMPORT_PREFIX}TavernDB-ACU-OutlineTable` : 'TavernDB-ACU-OutlineTable';
    const OUTLINE_COMMENT = isoPrefix + baseComment;

    try {
        const allEntries = await store.get(primaryLorebookName);
        const usedOrders = buildUsedOrderSet_ACU(allEntries);
        const existingEntry = allEntries.find(e => e.comment === OUTLINE_COMMENT);

        // If no outline table data, delete the entry if it exists
        if (!outlineTable || outlineTable.content.length < 2) {
            if (existingEntry) {
                await store.remove(primaryLorebookName, [existingEntry.uid]);
                logDebug_ACU('Deleted outline table entry as there is no data.');
            }
            // [修复] 即使没有outlineTable数据，也要同步更新"纪要索引"条目的enabled状态。
            // 0TK 持续控制该条目是否启用；交火模式不应把它重新打开。
            try {
                const existingIndexEntry = allEntries.find(e => e.comment && e.comment.endsWith('TavernDB-ACU-CustomExport-纪要索引'));
                if (existingIndexEntry) {
                    if (existingIndexEntry.enabled !== summaryIndexEntryEnabled) {
                        await store.set(primaryLorebookName, [{
                            uid: existingIndexEntry.uid,
                            enabled: summaryIndexEntryEnabled,
                        }]);
                        logDebug_ACU(`Successfully updated 纪要索引 entry (no outline data). enabled=${summaryIndexEntryEnabled}`);
                    }
                }
            } catch (indexError) {
                if (entryStore) throw indexError;
                logWarn_ACU('Failed to update 纪要索引 entry enabled state (no outline data):', indexError);
            }
            return;
        }

        // Format the entire table as markdown
        const { headers, rows } = projectWorldbookTable_ACU(outlineTable);
        let content = `# ${outlineTable.name}\n\n`;
        if (headers.length > 0) {
            content += `| ${headers.join(' | ')} |\n`;
            content += `|${headers.map(() => '---').join('|')}|\n`;
        }
        rows.forEach((row: any) => {
            content += `| ${row.join(' | ')} |\n`;
        });

        const finalContent = `<剧情大纲编码索引>\n\n${content.trim()}\n\n</剧情大纲编码索引>`;
        const outlineCfg = ensureExportConfigDefaults_ACU(outlineTable?.exportConfig, outlineTable?.name || '总体大纲');
        const outlineFixedPlacement = normalizePlacementConfig_ACU(
            outlineCfg.fixedEntryPlacement,
            getFixedPlacementDefaultsForTable_ACU(outlineTable?.name || '总体大纲').entry
        );

        if (existingEntry) {
            const needsUpdate =
                existingEntry.content !== finalContent ||
                existingEntry.enabled !== outlineEntryEnabled ||
                existingEntry.type !== 'constant' ||
                existingEntry.prevent_recursion !== true ||
                !isEntryPlacementMatched_ACU(existingEntry, outlineFixedPlacement);

            if (needsUpdate) {
                const updatedEntry = applyPlacementToEntry_ACU({
                    uid: existingEntry.uid,
                    content: finalContent,
                    enabled: outlineEntryEnabled,
                    type: 'constant',
                    prevent_recursion: true,
                }, outlineFixedPlacement);
                await store.set(primaryLorebookName, [updatedEntry]);
                logDebug_ACU(`Successfully updated the outline table lorebook entry. enabled=${outlineEntryEnabled} (0TK占用模式=${zeroTkOccupyMode})`);
            } else {
                logDebug_ACU('Outline table lorebook entry is already up-to-date.');
            }
        } else {
            const newEntry = applyPlacementToEntry_ACU({
                comment: OUTLINE_COMMENT,
                content: finalContent,
                keys: [OUTLINE_COMMENT + '-Key'],
                enabled: outlineEntryEnabled,
                type: 'constant',
                // [优化] order(插入深度) 避免与任何现有条目重复
                order: allocOrder_ACU(usedOrders, outlineFixedPlacement.order, 1, 99999),
                prevent_recursion: true,
            }, outlineFixedPlacement);
            await store.create(primaryLorebookName, [newEntry]);
            logDebug_ACU(`Outline table lorebook entry not found. Created a new one. enabled=${outlineEntryEnabled} (0TK占用模式=${zeroTkOccupyMode})`);
        }

        // [新增] 同步更新"纪要索引"条目的enabled状态。
        // 0TK 持续控制该条目是否启用；交火模式不应把它重新打开。
        try {
            const existingIndexEntry = allEntries.find(e => e.comment && e.comment.endsWith('TavernDB-ACU-CustomExport-纪要索引'));
            if (existingIndexEntry) {
                if (existingIndexEntry.enabled !== summaryIndexEntryEnabled) {
                    await store.set(primaryLorebookName, [{
                        uid: existingIndexEntry.uid,
                        enabled: summaryIndexEntryEnabled,
                    }]);
                    logDebug_ACU(`Successfully updated 纪要索引 entry. enabled=${summaryIndexEntryEnabled}`);
                }
            }
        } catch (indexError) {
            if (entryStore) throw indexError;
            logWarn_ACU('Failed to update 纪要索引 entry enabled state:', indexError);
        }
    } catch(error) {
        logError_ACU('Failed to update outline table lorebook entry:', error);
    }
  }

  export async function updateSummaryTableEntries_ACU(summaryTable: any, isImport = false, targetLorebookOverride: string | null = null, entryStore?: TableWorldbookEntryStore_ACU) { // [外部导入] 添加 isImport 标志
    if (!entryStore && !isWorldbookApiAvailable_ACU()) return;
    const store = entryStore ?? liveTableWorldbookEntryStore_ACU;
    const primaryLorebookName = targetLorebookOverride || await getInjectionTargetLorebook_ACU();
    if (!primaryLorebookName) {
        logWarn_ACU('Cannot update summary entries: No injection target lorebook set.');
        return;
    }

    const IMPORT_PREFIX = getImportBatchPrefix_ACU();
    // [修改] 加入隔离标识前缀
    const isoPrefix = getIsolationPrefix_ACU();
    const baseSummaryPrefix = isImport ? `${IMPORT_PREFIX}总结条目` : '总结条目';
    const SUMMARY_ENTRY_PREFIX = isoPrefix + baseSummaryPrefix;
    // 旧版兼容前缀也要加上隔离判断
    const baseSmallSummaryPrefix = isImport ? `${IMPORT_PREFIX}小总结条目` : '小总结条目';
    const SMALL_SUMMARY_PREFIX = isoPrefix + baseSmallSummaryPrefix;

    try {
        const allEntries = await store.get(primaryLorebookName);
        const usedOrders = buildUsedOrderSet_ACU(allEntries);
        
        // --- 1. Delete old summary entries ---
        // 用户要求：外部导入每次导入前不清理（允许多批并存，避免后一批覆盖前一批）
        if (!isImport) {
            const uidsToDelete = allEntries
                .filter(e => e.comment && (e.comment.startsWith(SUMMARY_ENTRY_PREFIX) || e.comment.startsWith(SMALL_SUMMARY_PREFIX)))
                .map(e => e.uid);

            if (uidsToDelete.length > 0) {
                await store.remove(primaryLorebookName, uidsToDelete);
                logDebug_ACU(`Deleted ${uidsToDelete.length} old summary lorebook entries.`);
            }
        }

        // --- 2. Re-create entries from the table ---
        const projectedSummary = summaryTable?.content?.length > 0 ? projectWorldbookTable_ACU(summaryTable) : { headers: [], rows: [] };
        const summaryRows = projectedSummary.rows;
        if (summaryRows.length === 0) {
            logDebug_ACU('No summary rows to create entries for.');
            return;
        }

        const summaryCfg = ensureExportConfigDefaults_ACU(summaryTable?.exportConfig, summaryTable?.name || '总结表');
        const summaryFixedPlacement = normalizePlacementConfig_ACU(
            summaryCfg.fixedEntryPlacement,
            getFixedPlacementDefaultsForTable_ACU(summaryTable?.name || '总结表').entry
        );
        const headers = projectedSummary.headers;
        const keywordColumnIndex = headers.indexOf('编码索引');
        if (keywordColumnIndex === -1) {
            logError_ACU('Cannot find "编码索引" column in 总结表. Cannot process summary entries.');
            return;
        }

        const entriesToCreate: any[] = [];
        // [优化] 总结表"按表占深度"：所有总结行共用同一个 order(深度)，避免 N 行占 N 个深度
        // 注意：MemoryStart / MemoryEnd 的"3深度成组"会在 updateReadableLorebookEntry_ACU 中统一对齐并保证连续
        const sharedSummaryDataOrder = allocOrder_ACU(usedOrders, summaryFixedPlacement.order, 1, 99999);
        
        summaryRows.forEach((row: any, i: number) => {
            const keywordsRaw = row[keywordColumnIndex];
            if (!keywordsRaw) return; // Skip if no keywords

            const keywords = splitKeywordsByComma_ACU(keywordsRaw);
            if (keywords.length === 0) return;

            // 行条目只包含行数据，不包含表头
            const content = `| ${row.join(' | ')} |\n`;
            const newEntryData = applyPlacementToEntry_ACU({
                comment: `${SUMMARY_ENTRY_PREFIX}${i + 1}`,
                content: content,
                keys: keywords,
                enabled: true,
                type: 'keyword', // Green light entry
                // [优化] 同表所有行条目共用同一深度
                order: sharedSummaryDataOrder,
                prevent_recursion: true
            }, summaryFixedPlacement);
            entriesToCreate.push(newEntryData);
        });
        
        if (entriesToCreate.length > 0) {
            await store.create(primaryLorebookName, entriesToCreate);
            logDebug_ACU(`Successfully created ${entriesToCreate.length} new summary entries.`);
            // [兜底] 某些实现可能会在创建时自动改写/规范化 order，导致同表行条目仍然各占一个深度。
            // 这里在创建完成后，强制把"总结条目/小总结条目"统一回写到同一个 order。
            try {
                const latest = await store.get(primaryLorebookName);
                const toFix = latest.filter(e => {
                    const c = e?.comment || '';
                    return c.startsWith(SUMMARY_ENTRY_PREFIX) || c.startsWith(SMALL_SUMMARY_PREFIX);
                });
                if (toFix.length > 0) {
                    await store.set(
                        primaryLorebookName,
                        toFix.map(e => applyPlacementToEntry_ACU({ uid: e.uid, order: sharedSummaryDataOrder }, summaryFixedPlacement))
                    );
                }
            } catch (e) {
                if (entryStore) throw e;
                logWarn_ACU('[SummaryOrderFix] Failed to enforce shared order for summary entries:', e);
            }
        }

    } catch(error) {
        logError_ACU('Failed to update summary lorebook entries:', error);
    }
  }

  export async function updateImportantPersonsRelatedEntries_ACU(importantPersonsTable: any, isImport = false, targetLorebookOverride: string | null = null, entryStore?: TableWorldbookEntryStore_ACU) { // [外部导入] 添加 isImport 标志
    if (!entryStore && !isWorldbookApiAvailable_ACU()) return;
    const store = entryStore ?? liveTableWorldbookEntryStore_ACU;
    const primaryLorebookName = targetLorebookOverride || await getInjectionTargetLorebook_ACU();
    if (!primaryLorebookName) {
        logWarn_ACU('Cannot update important persons entries: No injection target lorebook set.');
        return;
    }

    const IMPORT_PREFIX = getImportBatchPrefix_ACU();
    // [修改] 加入隔离标识前缀
    const isoPrefix = getIsolationPrefix_ACU();
    const basePersonEntryPrefix = isImport ? `${IMPORT_PREFIX}重要人物条目` : '重要人物条目';
    const PERSON_ENTRY_PREFIX = isoPrefix + basePersonEntryPrefix;
    const basePersonIndexComment = isImport ? `${IMPORT_PREFIX}TavernDB-ACU-ImportantPersonsIndex` : 'TavernDB-ACU-ImportantPersonsIndex';
    const PERSON_INDEX_COMMENT = isoPrefix + basePersonIndexComment;
    const personsCfg = ensureExportConfigDefaults_ACU(importantPersonsTable?.exportConfig, importantPersonsTable?.name || '重要人物表');
    const personsEntryPlacement = normalizePlacementConfig_ACU(
        personsCfg.fixedEntryPlacement,
        getFixedPlacementDefaultsForTable_ACU(importantPersonsTable?.name || '重要人物表').entry
    );
    const personsIndexPlacement = normalizePlacementConfig_ACU(
        personsCfg.fixedIndexPlacement,
        getFixedPlacementDefaultsForTable_ACU(importantPersonsTable?.name || '重要人物表').index
    );

    try {
        const allEntries = await store.get(primaryLorebookName);
        const usedOrders = buildUsedOrderSet_ACU(allEntries);
        
        // --- 1. 全量删除 ---
        // 用户要求：外部导入每次导入前不清理（允许多批并存，避免后一批覆盖前一批）
        if (!isImport) {
            // 找出所有由插件管理的旧条目 (人物条目 + 索引条目)
            const uidsToDelete = allEntries
                .filter(e => e.comment && (e.comment.startsWith(PERSON_ENTRY_PREFIX) || e.comment === PERSON_INDEX_COMMENT || e.comment.includes('PersonsHeader')))
                .map(e => e.uid);

            if (uidsToDelete.length > 0) {
                await store.remove(primaryLorebookName, uidsToDelete);
                logDebug_ACU(`Deleted ${uidsToDelete.length} old person-related lorebook entries.`);
            }
        }

        // --- 2. 全量重建 ---
        const projectedPersons = importantPersonsTable?.content?.length > 0 ? projectWorldbookTable_ACU(importantPersonsTable) : { headers: [], rows: [] };
        const personRows = projectedPersons.rows;
        if (personRows.length === 0) {
            logDebug_ACU('No important persons to create entries for.');
            return; // 如果没有人物，删除后直接返回
        }

        const headers = projectedPersons.headers;
        const nameColumnIndex = headers.indexOf('姓名') !== -1 ? headers.indexOf('姓名') : headers.indexOf('角色名');
        if (nameColumnIndex === -1) {
            logError_ACU('Cannot find "姓名" or "角色名" column in 重要人物表. Cannot process person entries.');
            return;
        }

        const personEntriesToCreate: any[] = [];
        const personNames: string[] = [];

        // 2.1 准备要创建的人物条目
        const buildPersonNameKeywords_ACU = (rawName: string) => {
            const raw = String(rawName || '').trim();
            if (!raw) return [];
            const baseParts = splitKeywordsByComma_ACU(raw);
            const parts = baseParts.length > 0 ? baseParts : [raw];
            const keys: string[] = [];
            parts.forEach(part => {
                if (!part) return;
                keys.push(part);
                const bracketMatch = part.match(/^([^（(]+)[（(]/);
                if (bracketMatch) {
                    const nameBeforeBracket = bracketMatch[1].trim();
                    if (nameBeforeBracket && nameBeforeBracket !== part) {
                        keys.push(nameBeforeBracket);
                    }
                }
            });
            return [...new Set(keys)];
        };

        personRows.forEach((row: any, i: number) => {
            const personName = row[nameColumnIndex];
            if (!personName) return;
            personNames.push(personName);

            // [优化] 生成关键词：英文逗号分割为多关键词；每个关键词保留括号前的部分
            const keys = buildPersonNameKeywords_ACU(personName);

            const content = `| ${row.join(' | ')} |`
            const newEntryData = applyPlacementToEntry_ACU({
                comment: `${PERSON_ENTRY_PREFIX}${i + 1}`,
                content: content,
                keys: keys,
                enabled: true,
                type: 'keyword',
                // [优化] order(插入深度) 避免与任何现有条目重复（人物条目按序分配）
                order: null,
                prevent_recursion: true
            }, personsEntryPlacement);
            personEntriesToCreate.push(newEntryData);
        });



        // 2.1.5 创建重要人物表表头条目
        const personsHeaderContent = `# ${importantPersonsTable.name}\n\n| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|`;
        const personsHeaderEntryData = applyPlacementToEntry_ACU({
            // [修复] 外部导入时 PersonsHeader 也必须带外部导入前缀，避免被清理逻辑误删
            comment: isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-PersonsHeader` : 'TavernDB-ACU-PersonsHeader'),
            content: personsHeaderContent,
            keys: [isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-PersonsHeader-Key` : 'TavernDB-ACU-PersonsHeader-Key')],
            enabled: true,
            type: 'constant',
            order: null,
            prevent_recursion: true
        }, personsEntryPlacement);
        personEntriesToCreate.unshift(personsHeaderEntryData);

        // 2.2 准备要创建的索引条目
        let indexContent = "# 以下是之前剧情中登场过的角色\n\n";
        indexContent += `| ${headers[nameColumnIndex]} |\n|---|\n` + personNames.map(name => `| ${name} |`).join('\n');
        // indexContent 已是纯文本，由 Wrapper 条目包裹

        const indexEntryData: Record<string, any> = {
            comment: PERSON_INDEX_COMMENT,
            content: indexContent,
            keys: [PERSON_INDEX_COMMENT + "-Key"],
            enabled: true,
            type: 'constant',
            order: null,
            prevent_recursion: true
        };
        
        // 3. 执行创建
        // [优化] 重要人物表 3-depth 成组对齐：
        // - PersonsHeader / 人物行条目 / PersonsIndex 只占用连续 3 个 order(深度)
        // - 人物行条目共用同一个深度（不再每人占一个深度）
        const personsOrderBlockBase = allocConsecutiveOrderBlock_ACU(usedOrders, 3, Math.max(1, personsEntryPlacement.order - 1), 1, 99999);
        personEntriesToCreate[0].order = personsOrderBlockBase; // header
        for (let i = 1; i < personEntriesToCreate.length; i++) {
            personEntriesToCreate[i].order = personsOrderBlockBase + 1; // all persons share
        }
        indexEntryData.order = personsOrderBlockBase + 2; // index/footer
        const allCreates = [...personEntriesToCreate, applyPlacementToEntry_ACU(indexEntryData, personsIndexPlacement)];
        if (allCreates.length > 0) {
            await store.create(primaryLorebookName, allCreates);
            logDebug_ACU(`Successfully created ${allCreates.length} new person-related entries.`);
            // [兜底] 创建完成后强制回写 order，避免创建接口自动改写导致仍然"每人一深度"
            try {
                const latest = await store.get(primaryLorebookName);
                const header = latest.find(e => e.comment === personsHeaderEntryData.comment);
                const index = latest.find(e => e.comment === PERSON_INDEX_COMMENT);
                const rows = latest.filter(e => (e?.comment || '').startsWith(PERSON_ENTRY_PREFIX));
                const updates = [];
                if (header?.uid) updates.push(applyPlacementToEntry_ACU({ uid: header.uid, order: personsOrderBlockBase }, personsEntryPlacement));
                rows.forEach(e => { if (e?.uid) updates.push(applyPlacementToEntry_ACU({ uid: e.uid, order: personsOrderBlockBase + 1 }, personsEntryPlacement)); });
                if (index?.uid) updates.push(applyPlacementToEntry_ACU({ uid: index.uid, order: personsOrderBlockBase + 2 }, personsIndexPlacement));
                if (updates.length > 0) {
                    await store.set(primaryLorebookName, updates);
                }
            } catch (e) {
                if (entryStore) throw e;
                logWarn_ACU('[PersonsOrderFix] Failed to enforce grouped orders for important persons:', e);
            }
        }

    } catch(error) {
        logError_ACU('Failed to update important persons related lorebook entries:', error);
    }
  }
