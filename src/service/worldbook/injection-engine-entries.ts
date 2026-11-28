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
import {
    buildExistingEntryUpdatePatch_ACU,
    doesCreatedEntryNeedOrderFix_ACU,
    isLorebookEntryFieldsMatched_ACU,
} from './entry-diff';

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
        const existingManaged = !isImport
            ? allEntries.filter(e => e.comment && (e.comment.startsWith(SUMMARY_ENTRY_PREFIX) || e.comment.startsWith(SMALL_SUMMARY_PREFIX)))
            : [];

        // --- 1. Build desired entries ---
        const projectedSummary = summaryTable?.content?.length > 0 ? projectWorldbookTable_ACU(summaryTable) : { headers: [], rows: [] };
        const summaryRows = projectedSummary.rows;
        if (summaryRows.length === 0) {
            if (!isImport && existingManaged.length > 0) {
                await store.remove(primaryLorebookName, existingManaged.map(e => e.uid));
                logDebug_ACU(`Deleted ${existingManaged.length} old summary lorebook entries.`);
            }
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
            if (!isImport && existingManaged.length > 0) {
                await store.remove(primaryLorebookName, existingManaged.map(e => e.uid));
            }
            logError_ACU('Cannot find "编码索引" column in 总结表. Cannot process summary entries.');
            return;
        }

        const desiredEntries: Array<{ comment: string; content: string; keys: string[]; enabled: boolean; type: string; prevent_recursion: boolean }> = [];
        summaryRows.forEach((row: any, i: number) => {
            const keywordsRaw = row[keywordColumnIndex];
            if (!keywordsRaw) return; // Skip if no keywords

            const keywords = splitKeywordsByComma_ACU(keywordsRaw);
            if (keywords.length === 0) return;

            // 行条目只包含行数据，不包含表头
            const content = `| ${row.join(' | ')} |\n`;
            desiredEntries.push({
                comment: `${SUMMARY_ENTRY_PREFIX}${i + 1}`,
                content,
                keys: keywords,
                enabled: true,
                type: 'keyword', // Green light entry
                prevent_recursion: true,
            });
        });

        if (isImport) {
            if (desiredEntries.length === 0) return;
            const sharedSummaryDataOrder = allocOrder_ACU(usedOrders, summaryFixedPlacement.order, 1, 99999);
            const entriesToCreate = desiredEntries.map(spec => applyPlacementToEntry_ACU({
                ...spec,
                order: sharedSummaryDataOrder,
            }, summaryFixedPlacement));
            await store.create(primaryLorebookName, entriesToCreate);
            logDebug_ACU(`Successfully created ${entriesToCreate.length} new summary entries.`);
            try {
                const latest = await store.get(primaryLorebookName);
                const createdComments = new Set(desiredEntries.map(d => d.comment));
                const toFix = latest.filter(e => createdComments.has(e?.comment || '')
                    && doesCreatedEntryNeedOrderFix_ACU(e, sharedSummaryDataOrder, summaryFixedPlacement));
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
            return;
        }

        // --- 2. Diff against existing entries (已有条目保持原 order，只给新增条目分配) ---
        const existingByComment = new Map<string, any[]>();
        existingManaged.forEach(entry => {
            const list = existingByComment.get(entry.comment) || [];
            list.push(entry);
            existingByComment.set(entry.comment, list);
        });
        const matchedUids = new Set<any>();
        const entriesToUpdate: Record<string, any>[] = [];
        const newSpecs: typeof desiredEntries = [];

        let existingSharedOrder: number | null = null;
        for (const spec of desiredEntries) {
            const candidates = existingByComment.get(spec.comment);
            const existing = candidates?.shift();
            if (existing && existing.uid != null) {
                matchedUids.add(existing.uid);
                const existingOrder = typeof existing.order === 'number' ? existing.order : parseInt(String(existing.order ?? ''), 10);
                if (existingSharedOrder === null && Number.isFinite(existingOrder)) {
                    existingSharedOrder = existingOrder;
                }
                if (!isLorebookEntryFieldsMatched_ACU(existing, spec, summaryFixedPlacement)) {
                    const desiredPatch = applyPlacementToEntry_ACU({ ...spec }, summaryFixedPlacement);
                    entriesToUpdate.push(buildExistingEntryUpdatePatch_ACU(existing, desiredPatch));
                }
            } else {
                newSpecs.push(spec);
            }
        }

        const uidsToDelete = existingManaged.filter(e => !matchedUids.has(e.uid)).map(e => e.uid);
        if (uidsToDelete.length > 0) {
            await store.remove(primaryLorebookName, uidsToDelete);
            logDebug_ACU(`Deleted ${uidsToDelete.length} obsolete summary lorebook entries.`);
        }
        if (entriesToUpdate.length > 0) {
            await store.set(primaryLorebookName, entriesToUpdate);
            logDebug_ACU(`Updated ${entriesToUpdate.length} summary lorebook entries in-place.`);
        }
        if (newSpecs.length > 0) {
            const sharedSummaryDataOrder = existingSharedOrder !== null
                ? existingSharedOrder
                : allocOrder_ACU(usedOrders, summaryFixedPlacement.order, 1, 99999);
            const entriesToCreate = newSpecs.map(spec => applyPlacementToEntry_ACU({
                ...spec,
                order: sharedSummaryDataOrder,
            }, summaryFixedPlacement));
            await store.create(primaryLorebookName, entriesToCreate);
            logDebug_ACU(`Successfully created ${entriesToCreate.length} new summary entries.`);
            try {
                const latest = await store.get(primaryLorebookName);
                const createdComments = new Set(newSpecs.map(s => s.comment));
                const toFix = latest.filter(e => createdComments.has(e?.comment || '')
                    && doesCreatedEntryNeedOrderFix_ACU(e, sharedSummaryDataOrder, summaryFixedPlacement));
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
        const existingManaged = !isImport
            ? allEntries.filter(e => e.comment && (e.comment.startsWith(PERSON_ENTRY_PREFIX) || e.comment === PERSON_INDEX_COMMENT || e.comment.includes('PersonsHeader')))
            : [];

        // --- 1. Build desired entries ---
        const projectedPersons = importantPersonsTable?.content?.length > 0 ? projectWorldbookTable_ACU(importantPersonsTable) : { headers: [], rows: [] };
        const personRows = projectedPersons.rows;
        if (personRows.length === 0) {
            if (!isImport && existingManaged.length > 0) {
                await store.remove(primaryLorebookName, existingManaged.map(e => e.uid));
                logDebug_ACU(`Deleted ${existingManaged.length} old person-related lorebook entries.`);
            }
            logDebug_ACU('No important persons to create entries for.');
            return; // 如果没有人物，删除后直接返回
        }

        const headers = projectedPersons.headers;
        const nameColumnIndex = headers.indexOf('姓名') !== -1 ? headers.indexOf('姓名') : headers.indexOf('角色名');
        if (nameColumnIndex === -1) {
            if (!isImport && existingManaged.length > 0) {
                await store.remove(primaryLorebookName, existingManaged.map(e => e.uid));
            }
            logError_ACU('Cannot find "姓名" or "角色名" column in 重要人物表. Cannot process person entries.');
            return;
        }

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

        type PersonEntrySpec = {
            role: 'header' | 'row' | 'index';
            comment: string;
            content: string;
            keys: string[];
            enabled: boolean;
            type: string;
            prevent_recursion: boolean;
            placement: Record<string, any>;
        };

        const rowSpecs: PersonEntrySpec[] = [];
        personRows.forEach((row: any, i: number) => {
            const personName = row[nameColumnIndex];
            if (!personName) return;
            personNames.push(personName);

            const keys = buildPersonNameKeywords_ACU(personName);
            const content = `| ${row.join(' | ')} |`;
            rowSpecs.push({
                role: 'row',
                comment: `${PERSON_ENTRY_PREFIX}${i + 1}`,
                content,
                keys,
                enabled: true,
                type: 'keyword',
                prevent_recursion: true,
                placement: personsEntryPlacement,
            });
        });

        const personsHeaderComment = isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-PersonsHeader` : 'TavernDB-ACU-PersonsHeader');
        const personsHeaderContent = `# ${importantPersonsTable.name}\n\n| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|`;
        const headerSpec: PersonEntrySpec = {
            role: 'header',
            comment: personsHeaderComment,
            content: personsHeaderContent,
            keys: [isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-PersonsHeader-Key` : 'TavernDB-ACU-PersonsHeader-Key')],
            enabled: true,
            type: 'constant',
            prevent_recursion: true,
            placement: personsEntryPlacement,
        };

        let indexContent = "# 以下是之前剧情中登场过的角色\n\n";
        indexContent += `| ${headers[nameColumnIndex]} |\n|---|\n` + personNames.map(name => `| ${name} |`).join('\n');
        const indexSpec: PersonEntrySpec = {
            role: 'index',
            comment: PERSON_INDEX_COMMENT,
            content: indexContent,
            keys: [PERSON_INDEX_COMMENT + "-Key"],
            enabled: true,
            type: 'constant',
            prevent_recursion: true,
            placement: personsIndexPlacement,
        };

        const allDesiredSpecs: PersonEntrySpec[] = [headerSpec, ...rowSpecs, indexSpec];

        if (isImport) {
            const personsOrderBlockBase = allocConsecutiveOrderBlock_ACU(usedOrders, 3, Math.max(1, personsEntryPlacement.order - 1), 1, 99999);
            const orderForSpec = (spec: PersonEntrySpec) => spec.role === 'header'
                ? personsOrderBlockBase
                : spec.role === 'index'
                    ? personsOrderBlockBase + 2
                    : personsOrderBlockBase + 1;
            const allCreates = allDesiredSpecs.map(spec => applyPlacementToEntry_ACU({
                comment: spec.comment,
                content: spec.content,
                keys: spec.keys,
                enabled: spec.enabled,
                type: spec.type,
                order: orderForSpec(spec),
                prevent_recursion: spec.prevent_recursion,
            }, spec.placement));
            if (allCreates.length > 0) {
                await store.create(primaryLorebookName, allCreates);
                logDebug_ACU(`Successfully created ${allCreates.length} new person-related entries.`);
                try {
                    const latest = await store.get(primaryLorebookName);
                    const updates: Record<string, any>[] = [];
                    allDesiredSpecs.forEach(spec => {
                        const targetOrder = orderForSpec(spec);
                        const matched = latest.find(e => e?.comment === spec.comment);
                        if (matched && doesCreatedEntryNeedOrderFix_ACU(matched, targetOrder, spec.placement)) {
                            updates.push(applyPlacementToEntry_ACU({ uid: matched.uid, order: targetOrder }, spec.placement));
                        }
                    });
                    if (updates.length > 0) {
                        await store.set(primaryLorebookName, updates);
                    }
                } catch (e) {
                    if (entryStore) throw e;
                    logWarn_ACU('[PersonsOrderFix] Failed to enforce grouped orders for important persons:', e);
                }
            }
            return;
        }

        // --- 2. Diff against existing entries (已有条目保持原 order，只给新增条目分配) ---
        const existingByComment = new Map<string, any[]>();
        existingManaged.forEach(entry => {
            const list = existingByComment.get(entry.comment) || [];
            list.push(entry);
            existingByComment.set(entry.comment, list);
        });
        const matchedUids = new Set<any>();
        const entriesToUpdate: Record<string, any>[] = [];
        const newSpecs: PersonEntrySpec[] = [];
        let existingRowOrder: number | null = null;

        for (const spec of allDesiredSpecs) {
            const candidates = existingByComment.get(spec.comment);
            const existing = candidates?.shift();
            if (existing && existing.uid != null) {
                matchedUids.add(existing.uid);
                if (spec.role === 'row' && existingRowOrder === null) {
                    const n = typeof existing.order === 'number' ? existing.order : parseInt(String(existing.order ?? ''), 10);
                    if (Number.isFinite(n)) existingRowOrder = n;
                }
                if (!isLorebookEntryFieldsMatched_ACU(existing, spec, spec.placement)) {
                    const desiredPatch = applyPlacementToEntry_ACU({
                        content: spec.content,
                        keys: spec.keys,
                        enabled: spec.enabled,
                        type: spec.type,
                        prevent_recursion: spec.prevent_recursion,
                    }, spec.placement);
                    entriesToUpdate.push(buildExistingEntryUpdatePatch_ACU(existing, desiredPatch));
                }
            } else {
                newSpecs.push(spec);
            }
        }

        const uidsToDelete = existingManaged.filter(e => !matchedUids.has(e.uid)).map(e => e.uid);
        if (uidsToDelete.length > 0) {
            await store.remove(primaryLorebookName, uidsToDelete);
            logDebug_ACU(`Deleted ${uidsToDelete.length} obsolete person-related lorebook entries.`);
        }
        if (entriesToUpdate.length > 0) {
            await store.set(primaryLorebookName, entriesToUpdate);
            logDebug_ACU(`Updated ${entriesToUpdate.length} person-related lorebook entries in-place.`);
        }
        if (newSpecs.length > 0) {
            let blockBase: number | null = null;
            if (matchedUids.size === 0) {
                blockBase = allocConsecutiveOrderBlock_ACU(usedOrders, 3, Math.max(1, personsEntryPlacement.order - 1), 1, 99999);
            }
            let allocatedNewRowOrder: number | null = existingRowOrder;
            const createdOrderPlan: Array<{ comment: string; order: number; placement: Record<string, any> }> = [];
            const allCreates = newSpecs.map(spec => {
                let order: number;
                if (blockBase !== null) {
                    order = spec.role === 'header' ? blockBase : spec.role === 'index' ? blockBase + 2 : blockBase + 1;
                } else if (spec.role === 'row') {
                    if (allocatedNewRowOrder === null) {
                        allocatedNewRowOrder = allocOrder_ACU(usedOrders, personsEntryPlacement.order, 1, 99999);
                    }
                    order = allocatedNewRowOrder;
                } else {
                    order = allocOrder_ACU(usedOrders, spec.placement.order, 1, 99999);
                }
                createdOrderPlan.push({ comment: spec.comment, order, placement: spec.placement });
                return applyPlacementToEntry_ACU({
                    comment: spec.comment,
                    content: spec.content,
                    keys: spec.keys,
                    enabled: spec.enabled,
                    type: spec.type,
                    order,
                    prevent_recursion: spec.prevent_recursion,
                }, spec.placement);
            });
            await store.create(primaryLorebookName, allCreates);
            logDebug_ACU(`Successfully created ${allCreates.length} new person-related entries.`);
            try {
                const latest = await store.get(primaryLorebookName);
                const byComment = new Map<string, any>();
                latest.forEach(e => { if (e?.comment) byComment.set(e.comment, e); });
                const updates: Record<string, any>[] = [];
                createdOrderPlan.forEach(plan => {
                    const matched = byComment.get(plan.comment);
                    if (matched && doesCreatedEntryNeedOrderFix_ACU(matched, plan.order, plan.placement)) {
                        updates.push(applyPlacementToEntry_ACU({ uid: matched.uid, order: plan.order }, plan.placement));
                    }
                });
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
