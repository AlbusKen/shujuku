import type { AgentWorldbookControlSnapshot_ACU, AgentWorldbookControlSnapshotEntry_ACU } from '../../shared/models/agent-worldbook-model';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { allChatMessages_ACU, coreApisAreReady_ACU, currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU, _set_allChatMessages_ACU} from '../runtime/state-manager';
import { getLorebookEntriesRequired_ACU as gwGetLorebookEntriesRequired_ACU, getLorebookEntries_ACU as gwGetLorebookEntries_ACU, setLorebookEntries_ACU as gwSetLorebookEntries_ACU, createLorebookEntries_ACU as gwCreateLorebookEntries_ACU, deleteLorebookEntries_ACU as gwDeleteLorebookEntries_ACU, listLorebooks_ACU, getWorldBooks_ACU as gwGetWorldBooks_ACU, isWorldbookApiAvailable_ACU, normalizeLorebookEntriesForRead_ACU, resolveLorebookNameFromList_ACU } from '../../data/gateways/worldbook-gateway';
import { getCharLorebooks_ACU, getChatMessages_ACU } from '../../data/gateways/character-gateway';
import { getChatLength_ACU } from '../../data/gateways/chat-gateway';
import { saveSettings_ACU } from '../settings/settings-service';
import { getChatSheetGuideDataForIsolationKey_ACU, getSortedSheetKeys_ACU, materializeDataFromSheetGuide_ACU, reorderDataBySheetKeys_ACU } from '../template/chat-scope';
import { getImportBatchPrefix_ACU, getImportStablePrefix_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { isEntryBlocked_ACU } from '../../shared/utils';
import { classifyLorebookReadError_ACU, summarizeStrictLorebookReadError_ACU as sharedSummarizeStrictLorebookReadError_ACU } from '../../shared/lorebook-read-error';
import { resolveLorebookReadTargets_ACU } from './read-scope';
import { consumeLastMergeQuarantinedSheetKeys_ACU, consumeLastMergeWarnings_ACU, formatJsonToReadable_ACU, maybeLiftWorldbookSuppression_ACU, mergeAllIndependentTables_ACU, shouldSuppressWorldbookInjection_ACU } from '../runtime/helpers-remaining';
import { normalizeCanonicalTableRows_ACU, repairLegacyAutoMergedRowTails_ACU } from '../../shared/canonical-row-normalizer';
import { getSheetColumnProjection_ACU } from '../../shared/ddl-utils';
import { persistNullRowCleanupShards_ACU, type NullRowCleanupPersistStatus_ACU } from '../table/storage-frame-v2-persist';
import { allocConsecutiveOrderBlock_ACU, applyPlacementToEntry_ACU, buildDefaultGlobalInjectionConfig_ACU, buildUsedOrderSet_ACU, ensureExportConfigDefaults_ACU, ensureGlobalInjectionConfigDefaults_ACU, getEntryOrderNumber_ACU, getFixedPlacementDefaultsForTable_ACU, getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU, isEntryPlacementMatched_ACU, normalizeLorebookPosition_ACU, normalizePlacementConfig_ACU, updateCustomTableExports_ACU, updateImportantPersonsRelatedEntries_ACU, updateOutlineTableEntry_ACU, updateSummaryTableEntries_ACU } from './injection-engine';
// pipeline.ts
// 从 05_core_tail.js 迁入

export   async function updateReadableLorebookEntry_ACU(createIfNeeded = false, isImport = false, targetLorebookOverride: string | null = null, dataOverride: Record<string, any> | null = null) { // [外部导入] 添加 targetLorebookOverride 参数，避免临时修改 worldbookConfig 被兜底补齐逻辑覆盖
    // [健全性] 新对话开场白阶段：禁止自动创建/更新世界书条目
    // - 仅影响非导入流程（isImport=false）
    // - 仅在“无任何用户消息”的开场白阶段生效
    // - 用户一旦开始对话，会自动解除抑制
    if (!isImport) {
        maybeLiftWorldbookSuppression_ACU();
        if (shouldSuppressWorldbookInjection_ACU()) {
            // 注意：这里必须“只抑制注入/创建”，但不能抑制“清理旧条目/回退导致的删除”。
            // 因此在抑制期间，我们仍然执行一次清理，以确保新开对话会清除旧世界书条目。
            try {
                await deleteAllGeneratedEntries_ACU();
                logDebug_ACU('[Worldbook] Greeting-stage suppression: cleanup-only (no create/update).');
            } catch (e) {
                logWarn_ACU('[Worldbook] Greeting-stage cleanup-only failed:', e);
            }
            return;
        }
    }

    // [新增] 分别从最新的标准表和总结表数据源中拉取数据并合并
    let mergedData = null;

    if (dataOverride) {
        // 填表保存后调用方已经持有本轮权威快照，不需要再从聊天历史回放。
        mergedData = JSON.parse(JSON.stringify(dataOverride));
        _set_currentJsonTableData_ACU(mergedData);
    } else if (isImport) {
        // 外部导入时，直接使用 currentJsonTableData_ACU
        mergedData = currentJsonTableData_ACU;
    } else {
        // 冷启动/切换聊天/显式刷新时，才使用全表合并逻辑从整段聊天记录恢复最新版本。
        await loadAllChatMessages_ACU();
        const mergedFromHistory = await mergeAllIndependentTables_ACU();
        if (mergedFromHistory) {
            mergedData = mergedFromHistory;
            // 同步内存中的全局数据，确保后续调用保持一致
            _set_currentJsonTableData_ACU(mergedFromHistory);
        } else {
            // 如果合并失败，退回到当前内存数据避免中断
            mergedData = currentJsonTableData_ACU;
        }
    }

    if (!mergedData) {
        logWarn_ACU('Update readable lorebook aborted: no data available.');
        return;
    }
    
    const { readableText, importantPersonsTable, summaryTable, outlineTable } = formatJsonToReadable_ACU(mergedData);
    const hasNonEmptyVisibleCell_ACU = (table: any) => {
        const content = table?.content;
        if (!Array.isArray(content) || content.length <= 1) return false;
        let visibleColumns: ReturnType<typeof getSheetColumnProjection_ACU>['visibleColumns'];
        try {
            visibleColumns = getSheetColumnProjection_ACU(table).visibleColumns
                .filter(column => column.sourceIndex > 0);
        } catch {
            return false;
        }
        for (let r = 1; r < content.length; r++) {
            const row = content[r];
            if (!Array.isArray(row)) continue;
            for (const column of visibleColumns) {
                const cell = row[column.sourceIndex];
                if (cell === null || cell === undefined) continue;
                if (typeof cell === 'string') {
                    if (cell.trim() !== '') return true;
                } else if (typeof cell === 'number') {
                    if (!Number.isNaN(cell)) return true;
                } else {
                    return true;
                }
            }
        }
        return false;
    };
    const hasAnyNonEmptyCell_ACU = (data: Record<string, any> | null) => {
        if (!data) return false;
        const sheetKeys = Object.keys(data).filter(k => k.startsWith('sheet_'));
        for (const sheetKey of sheetKeys) {
            if (hasNonEmptyVisibleCell_ACU(data[sheetKey])) return true;
        }
        return false;
    };

    const hasNonEmptyCellData_ACU = hasAnyNonEmptyCell_ACU(mergedData);
    const hasReadableContent_ACU = !!(readableText && readableText.trim() !== '' && !readableText.includes('数据库为空。'));
    let isDatabaseEmpty = false;
    if (isImport) {
        // [修复] 该判空放宽逻辑仅对“外部导入”生效：
        // - 外部导入可能只选择“单独导出到世界书”的表格，此时 readableText 会故意为空；
        // - 重要人物表 / 总结表 / 总体大纲也会被 formatJsonToReadable_ACU 排除在 readableText 之外。
        // 只要 mergedData 里仍有非空单元格，就必须继续走世界书条目创建链路。
        isDatabaseEmpty = !hasNonEmptyCellData_ACU;
        if (!hasReadableContent_ACU && hasNonEmptyCellData_ACU) {
            logDebug_ACU('[Worldbook][Import] readableText 为空，但 mergedData 仍有有效单元格；按“数据库非空”继续创建世界书条目。');
        }
    } else {
        if (!readableText || readableText.trim() === '' || readableText.includes('数据库为空。')) {
            isDatabaseEmpty = true;
        } else if (!hasNonEmptyCellData_ACU) {
            isDatabaseEmpty = true;
        }
    }

    // Call all the individual entry updaters
    await updateImportantPersonsRelatedEntries_ACU(importantPersonsTable, isImport, targetLorebookOverride);
    await updateSummaryTableEntries_ACU(summaryTable, isImport, targetLorebookOverride);
    await updateOutlineTableEntry_ACU(outlineTable, isImport, targetLorebookOverride);

    // [修复] 自定义导出/按行拆分条目是否需要注入，应以 mergedData 中是否存在真实单元格数据为准，
    // 不能再依赖 readableText 判空。
    // 否则当所有表格都开启“按行拆分”后，readableText 会为空，进而误判为“数据库为空”，
    // 导致本应创建的拆分世界书条目被整体跳过。
    if (hasNonEmptyCellData_ACU) {
        await updateCustomTableExports_ACU(mergedData, isImport, targetLorebookOverride);
    } else {
        await updateCustomTableExports_ACU(null, isImport, targetLorebookOverride); // 仅清理旧自定义导出条目，不创建新条目
    }

    // [修复] 外部导入时优先使用 targetLorebookOverride 参数，避免临时修改 worldbookConfig 被兜底补齐逻辑覆盖
    const primaryLorebookName = targetLorebookOverride || await getInjectionTargetLorebook_ACU();
    if (primaryLorebookName) {
        try {
            const IMPORT_PREFIX = getImportBatchPrefix_ACU();
            // [修改] 加入隔离标识前缀
            const isoPrefix = getIsolationPrefix_ACU();
            const baseReadableComment = isImport ? `${IMPORT_PREFIX}TavernDB-ACU-ReadableDataTable` : 'TavernDB-ACU-ReadableDataTable';
            const READABLE_LOREBOOK_COMMENT = isoPrefix + baseReadableComment;
            // [修复] 外部导入的包裹条目必须带外部导入前缀，避免被 deleteAllGeneratedEntries_ACU 当作“本体注入条目”清理
            const WRAPPER_START_COMMENT = isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-WrapperStart` : 'TavernDB-ACU-WrapperStart');
            const WRAPPER_END_COMMENT = isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-WrapperEnd` : 'TavernDB-ACU-WrapperEnd');
            
            const entries = await gwGetLorebookEntries_ACU(primaryLorebookName);
            const usedOrders = buildUsedOrderSet_ACU(entries);
            const db2Entry = entries.find(e => e.comment === READABLE_LOREBOOK_COMMENT);
            const templateObjForGlobalCfg = parseTableTemplateJson_ACU({ stripSeedRows: false });
            const globalCfgRaw =
                mergedData?.mate?.globalInjectionConfig
                ?? currentJsonTableData_ACU?.mate?.globalInjectionConfig
                ?? templateObjForGlobalCfg?.mate?.globalInjectionConfig;
            const globalCfgFromData = ensureGlobalInjectionConfigDefaults_ACU(globalCfgRaw);
            const globalDefaults = buildDefaultGlobalInjectionConfig_ACU();
            const globalFixedEntryPlacement = normalizePlacementConfig_ACU(globalCfgFromData?.readableEntryPlacement, globalDefaults.readableEntryPlacement);
            const globalFixedIndexPlacement = normalizePlacementConfig_ACU(globalCfgFromData?.wrapperPlacement, globalDefaults.wrapperPlacement);
            const summaryCfg = ensureExportConfigDefaults_ACU(summaryTable?.exportConfig, summaryTable?.name || '总结表');
            const summaryFixedEntryPlacement = normalizePlacementConfig_ACU(
                summaryCfg.fixedEntryPlacement,
                getFixedPlacementDefaultsForTable_ACU(summaryTable?.name || '总结表').entry
            );
            const summaryFixedIndexPlacement = normalizePlacementConfig_ACU(
                summaryCfg.fixedIndexPlacement,
                getFixedPlacementDefaultsForTable_ACU(summaryTable?.name || '总结表').index
            );

            // [修复] 自定义导出条目与全局条目必须共用同一套“数据库是否为空”判定。
            // 否则会出现：全局条目已正确判空不注入，但自定义导出条目因为更早执行而提前被创建。
            if (isDatabaseEmpty) {
                // 数据库为空：不应在世界书中固定注入任何包裹条目，顺便清理旧条目避免残留
                const toDelete = [];
                if (db2Entry) toDelete.push(db2Entry.uid);

                const wrapperStartOld = entries.find(e => e.comment === WRAPPER_START_COMMENT);
                const wrapperEndOld = entries.find(e => e.comment === WRAPPER_END_COMMENT);
                const memoryStartOld = entries.find(e => e.comment === (isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-MemoryStart` : 'TavernDB-ACU-MemoryStart')));
                const memoryEndOld = entries.find(e => e.comment === (isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-MemoryEnd` : 'TavernDB-ACU-MemoryEnd')));
                if (wrapperStartOld) toDelete.push(wrapperStartOld.uid);
                if (wrapperEndOld) toDelete.push(wrapperEndOld.uid);
                if (memoryStartOld) toDelete.push(memoryStartOld.uid);
                if (memoryEndOld) toDelete.push(memoryEndOld.uid);

                if (toDelete.length > 0) {
                    await gwDeleteLorebookEntries_ACU(primaryLorebookName, toDelete);
                    logDebug_ACU(`Deleted ${toDelete.length} lorebook entries because database is empty/reset (readable + wrappers).`);
                }
                return; // 数据库为空时，不再继续创建或更新
            }

            // [修复2026-03-29] 全局条目顺序修正：使用 allocConsecutiveOrderBlock_ACU 分配连续的 3 个 order 区块
            // 确保顺序始终为：包裹上(baseOrder) → 全局内容(baseOrder+1) → 包裹下(baseOrder+2)
            // 即使默认 order 值被占用，也能保证三个条目的 order 是连续的
            const globalWrapperBlockBase = allocConsecutiveOrderBlock_ACU(usedOrders, 3, globalFixedIndexPlacement.order, 1, 99999);
            const wrapperStartOrder = globalWrapperBlockBase;
            const globalContentOrder = globalWrapperBlockBase + 1;
            const wrapperEndOrder = globalWrapperBlockBase + 2;
            
            if (db2Entry) {
                const newContent = readableText;
                const needsUpdate =
                    (db2Entry.content !== newContent) ||
                    (db2Entry.type !== 'constant') ||
                    (db2Entry.enabled !== true) ||
                    (db2Entry.prevent_recursion !== true) ||
                    (getEntryOrderNumber_ACU(db2Entry) !== globalContentOrder) ||
                    !isEntryPlacementMatched_ACU(db2Entry, globalFixedIndexPlacement);
                if (needsUpdate) {
                    const updatedDb2Entry = applyPlacementToEntry_ACU({
                        uid: db2Entry.uid,
                        content: newContent,
                        enabled: true,
                        type: 'constant',
                        order: globalContentOrder,
                        prevent_recursion: true,
                    }, globalFixedIndexPlacement);
                    await gwSetLorebookEntries_ACU(primaryLorebookName, [updatedDb2Entry]);
                    logDebug_ACU('Successfully updated the global readable lorebook entry.');
                } else {
                    logDebug_ACU('Global readable lorebook entry is already up-to-date.');
                }
            } else if (createIfNeeded) {
                const newDb2Entry = applyPlacementToEntry_ACU({
                    comment: READABLE_LOREBOOK_COMMENT,
                    content: readableText,
                    keys: ['TavernDB-ACU-ReadableDataTable-Key'],
                    enabled: true,
                    type: 'constant',
                    order: globalContentOrder,
                    prevent_recursion: true,
                }, globalFixedIndexPlacement);
                await gwCreateLorebookEntries_ACU(primaryLorebookName, [newDb2Entry]);
                logDebug_ACU('Global readable lorebook entry not found. Created a new one.');
            }

            // [新增] 创建 WrapperStart 条目
            const wrapperStartEntry = entries.find(e => e.comment === WRAPPER_START_COMMENT);
            const wrapperStartContent = '<最新数据与记录>\n以下是在这个时间点，当前场景下剧情相关的最新数据与记录，你在进行剧情分析时必须以此最新的数据为准，以下数据与记录的优先级高于其他任何背景设定：\n\n';
            if (!wrapperStartEntry) {
                await gwCreateLorebookEntries_ACU(primaryLorebookName, [applyPlacementToEntry_ACU({
                    comment: WRAPPER_START_COMMENT,
                    content: wrapperStartContent,
                    keys: ['TavernDB-ACU-WrapperStart-Key'],
                    enabled: true,
                    type: 'constant',
                    order: wrapperStartOrder,
                    prevent_recursion: true,
                }, globalFixedIndexPlacement)]);
                logDebug_ACU('Created wrapper start entry.');
            } else {
                const wrapperStartNeedsUpdate =
                    wrapperStartEntry.content !== wrapperStartContent ||
                    wrapperStartEntry.enabled !== true ||
                    wrapperStartEntry.type !== 'constant' ||
                    wrapperStartEntry.prevent_recursion !== true ||
                    getEntryOrderNumber_ACU(wrapperStartEntry) !== wrapperStartOrder ||
                    !isEntryPlacementMatched_ACU(wrapperStartEntry, globalFixedIndexPlacement);
                if (wrapperStartNeedsUpdate) {
                    await gwSetLorebookEntries_ACU(primaryLorebookName, [
                        applyPlacementToEntry_ACU({
                            uid: wrapperStartEntry.uid,
                            content: wrapperStartContent,
                            enabled: true,
                            type: 'constant',
                            order: wrapperStartOrder,
                            prevent_recursion: true,
                        }, globalFixedIndexPlacement)
                    ]);
                }
            }

            // [新增] 创建或更新 MemoryStart 条目（整合总结表表头）
            const MEMORY_START_COMMENT = isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-MemoryStart` : 'TavernDB-ACU-MemoryStart');
            const MEMORY_END_COMMENT = isoPrefix + (isImport ? `${IMPORT_PREFIX}TavernDB-ACU-MemoryEnd` : 'TavernDB-ACU-MemoryEnd');
            const memoryStartEntry = entries.find(e => e.comment === MEMORY_START_COMMENT);
            const memoryEndEntry = entries.find(e => e.comment === MEMORY_END_COMMENT);

            // 对外世界书只由可见列驱动；隐藏历史数据不能制造空壳记忆条目。
            const hasSummaryData = hasNonEmptyVisibleCell_ACU(summaryTable);
            
            if (!hasSummaryData) {
                // [修复] 没有总结表数据时，删除已存在的 MemoryStart/MemoryEnd 条目
                const memoryEntriesToDelete = [];
                if (memoryStartEntry) memoryEntriesToDelete.push(memoryStartEntry.uid);
                if (memoryEndEntry) memoryEntriesToDelete.push(memoryEndEntry.uid);
                
                if (memoryEntriesToDelete.length > 0) {
                    await gwDeleteLorebookEntries_ACU(primaryLorebookName, memoryEntriesToDelete);
                    logDebug_ACU(`Deleted ${memoryEntriesToDelete.length} MemoryStart/MemoryEnd entries because summary table is empty.`);
                }
            } else {
                // 有总结表数据时，正常创建或更新 MemoryStart/MemoryEnd 条目
                // 准备总结表表头内容
                let summaryHeaderContent = '';
                const summaryHeaders = getSheetColumnProjection_ACU(summaryTable).visibleColumns
                    .filter(column => column.sourceIndex > 0)
                    .map(column => column.header);
                if (summaryHeaders.length > 0) {
                    summaryHeaderContent = `# ${summaryTable.name}\n\n| ${summaryHeaders.join(' | ')} |\n|${summaryHeaders.map(() => '---').join('|')}|`;
                }
                
                // 构建 MemoryStart 条目内容
                let memoryStartContent = '<过往记忆>\n\n以下是你回忆起的跟当前剧情有关的过往的记忆，你要特地注意该记忆所标注的时间，以及分析与当前剧情的相关性，完美地将其融入本轮的剧情编写中：\n\n';
                if (summaryHeaderContent) {
                    memoryStartContent += summaryHeaderContent + '\n\n';
                }

                // =========================
                // [总结表] 3-depth 成组对齐：
                // - MemoryStart / 总结行条目 / MemoryEnd 只占用连续 3 个 order(深度)
                // - 这 3 个深度不能与任何已有条目重合，且必须紧挨在一起
                // =========================
                const baseSummaryPrefix2 = isImport ? `${IMPORT_PREFIX}总结条目` : '总结条目';
                const baseSmallSummaryPrefix2 = isImport ? `${IMPORT_PREFIX}小总结条目` : '小总结条目';
                const SUMMARY_ENTRY_PREFIX2 = isoPrefix + baseSummaryPrefix2;
                const SMALL_SUMMARY_PREFIX2 = isoPrefix + baseSmallSummaryPrefix2;
                const summaryOrderBlockBase = allocConsecutiveOrderBlock_ACU(usedOrders, 3, Math.max(1, summaryFixedEntryPlacement.order - 1), 1, 99999);
                const memoryStartOrder = summaryOrderBlockBase;
                const summaryDataOrder = summaryOrderBlockBase + 1;
                const memoryEndOrder = summaryOrderBlockBase + 2;

                // 将"总结条目/小总结条目"统一挪到 summaryDataOrder（多条共用同一深度）
                const summaryEntriesToReorder = entries.filter(e => {
                    const c = e?.comment || '';
                    return c.startsWith(SUMMARY_ENTRY_PREFIX2) || c.startsWith(SMALL_SUMMARY_PREFIX2);
                });
                if (summaryEntriesToReorder.length > 0) {
                    await gwSetLorebookEntries_ACU(
                        primaryLorebookName,
                        summaryEntriesToReorder.map(e => applyPlacementToEntry_ACU({ uid: e.uid, order: summaryDataOrder }, summaryFixedEntryPlacement))
                    );
                }
                
                if (!memoryStartEntry) {
                    // 创建新条目
                    await gwCreateLorebookEntries_ACU(primaryLorebookName, [applyPlacementToEntry_ACU({
                            comment: MEMORY_START_COMMENT,
                            content: memoryStartContent,
                            keys: ['AM'],
                            enabled: true,
                            type: 'keyword',
                            order: memoryStartOrder,
                            prevent_recursion: true,
                        }, summaryFixedIndexPlacement)]);
                } else {
                    // 更新现有条目（内容/深度）
                    const needsUpdate =
                        (memoryStartEntry.content !== memoryStartContent) ||
                        (getEntryOrderNumber_ACU(memoryStartEntry) !== memoryStartOrder) ||
                        !isEntryPlacementMatched_ACU(memoryStartEntry, summaryFixedIndexPlacement);
                    if (needsUpdate) {
                        await gwSetLorebookEntries_ACU(primaryLorebookName, [{
                            ...applyPlacementToEntry_ACU({
                                uid: memoryStartEntry.uid,
                                content: memoryStartContent,
                                order: memoryStartOrder,
                                enabled: true,
                                type: 'keyword',
                                prevent_recursion: true,
                                keys: memoryStartEntry.keys || memoryStartEntry.key || ['AM'],
                            }, summaryFixedIndexPlacement)
                        }]);
                    }
                }

                // [新增] 创建 MemoryEnd 条目
                if (!memoryEndEntry) {
                    await gwCreateLorebookEntries_ACU(primaryLorebookName, [applyPlacementToEntry_ACU({
                            comment: MEMORY_END_COMMENT,
                            content: '</过往记忆>',
                            keys: ['AM'],
                            enabled: true,
                            type: 'keyword',
                            order: memoryEndOrder,
                            prevent_recursion: true,
                        }, summaryFixedIndexPlacement)]);
                } else {
                    const needsUpdate =
                        (getEntryOrderNumber_ACU(memoryEndEntry) !== memoryEndOrder) ||
                        !isEntryPlacementMatched_ACU(memoryEndEntry, summaryFixedIndexPlacement);
                    if (needsUpdate) {
                        await gwSetLorebookEntries_ACU(primaryLorebookName, [{
                            ...applyPlacementToEntry_ACU({
                                uid: memoryEndEntry.uid,
                                order: memoryEndOrder,
                                enabled: true,
                                type: 'keyword',
                                prevent_recursion: true,
                                keys: memoryEndEntry.keys || memoryEndEntry.key || ['AM'],
                            }, summaryFixedIndexPlacement)
                        }]);
                    }
                }
            } // end of hasSummaryData

            // [新增] 创建 WrapperEnd 条目
            // [修复2026-03-29] 使用 globalWrapperBlockBase + 2 作为 wrapperEndOrder（已在上方通过 allocConsecutiveOrderBlock_ACU 分配）
            const wrapperEndEntry = entries.find(e => e.comment === WRAPPER_END_COMMENT);
            const wrapperEndContent = '</最新数据与记录>';
            if (!wrapperEndEntry) {
                await gwCreateLorebookEntries_ACU(primaryLorebookName, [applyPlacementToEntry_ACU({
                    comment: WRAPPER_END_COMMENT,
                    content: wrapperEndContent,
                    keys: ['TavernDB-ACU-WrapperEnd-Key'],
                    enabled: true,
                    type: 'constant',
                    order: wrapperEndOrder,
                    prevent_recursion: true,
                }, globalFixedIndexPlacement)]);
                logDebug_ACU('Created wrapper end entry.');
            } else {
                const wrapperEndNeedsUpdate =
                    wrapperEndEntry.content !== wrapperEndContent ||
                    wrapperEndEntry.enabled !== true ||
                    wrapperEndEntry.type !== 'constant' ||
                    wrapperEndEntry.prevent_recursion !== true ||
                    getEntryOrderNumber_ACU(wrapperEndEntry) !== wrapperEndOrder ||
                    !isEntryPlacementMatched_ACU(wrapperEndEntry, globalFixedIndexPlacement);
                if (wrapperEndNeedsUpdate) {
                    await gwSetLorebookEntries_ACU(primaryLorebookName, [
                        applyPlacementToEntry_ACU({
                            uid: wrapperEndEntry.uid,
                            content: wrapperEndContent,
                            enabled: true,
                            type: 'constant',
                            order: wrapperEndOrder,
                            prevent_recursion: true,
                        }, globalFixedIndexPlacement)
                    ]);
                }
            }
        } catch(error) {
            // not-found 属于目标世界书重命名/切换期间的瞬态形态：注入本身可跳过（下次
            // 触发会按新解析结果重建条目），只记 warn；其余失败仍按 error 上报。
            if (classifyLorebookReadError_ACU(error) === 'lorebook_not_found') {
                logWarn_ACU('Readable lorebook entry update skipped: target lorebook not found (likely renamed or switching).', error);
            } else {
                logError_ACU('Failed to get or update readable lorebook entry:', error);
            }
        }
    }
  }


export   async function deleteAllGeneratedEntries_ACU(targetLorebook: string | null = null) {
    const primaryLorebookName = targetLorebook || (await getInjectionTargetLorebook_ACU());
    if (!primaryLorebookName) return;

    try {
        const allEntries = await gwGetLorebookEntries_ACU(primaryLorebookName);
        
        // [修改] 根据隔离状态构建删除逻辑
        const isolationPrefix = getIsolationPrefix_ACU();
        
        const basePrefixes = [
            'TavernDB-ACU-ReadableDataTable',
            'TavernDB-ACU-OutlineTable',
            '重要人物条目',
            'TavernDB-ACU-ImportantPersonsIndex',
            '总结条目',
            '小总结条目',
            'TavernDB-ACU-CustomExport',
            'TavernDB-ACU-WrapperStart',
            'TavernDB-ACU-WrapperEnd',
            'TavernDB-ACU-MemoryStart',
            'TavernDB-ACU-MemoryEnd',
            'TavernDB-ACU-PersonsHeader'
        ];

        // [修改] 使用 knownCustomEntryNames 增强删除逻辑
        const knownNames = settings_ACU.knownCustomEntryNames || [];
        
        // [新增] 获取当前配置的预期前缀作为补充 (防止 knownNames 丢失)
        const currentConfigPrefixes = new Set();
        if (currentJsonTableData_ACU) {
             const tableKeys = getSortedSheetKeys_ACU(currentJsonTableData_ACU);
             tableKeys.forEach(sheetKey => {
                 const table = currentJsonTableData_ACU[sheetKey];
                 if (table && table.exportConfig && table.exportConfig.enabled) {
                     const entryName = table.exportConfig.entryName || table.name;
                     if (entryName) {
                         currentConfigPrefixes.add(entryName);
                     }
                 }
             });
        }
        const importPrefix = getImportStablePrefix_ACU();

        const uidsToDelete = allEntries
            .filter(entry => {
                if (!entry.comment) return false;

                // [严重问题修复] 外部导入生成的条目一律不参与“自动清理”
                // 说明：切回脚本/读不到聊天表格数据时，可能会触发 deleteAllGeneratedEntries_ACU 清理旧条目；
                // 但外部导入条目应被视为第三方条目，只允许用户手动清理/删除。
                if (settings_ACU.dataIsolationEnabled) {
                    if (isolationPrefix && entry.comment.startsWith(isolationPrefix + importPrefix)) return false;
                } else {
                    if (entry.comment.startsWith(importPrefix)) return false;
                }
                
                if (settings_ACU.dataIsolationEnabled) {
                    // 隔离模式：只删除匹配当前标识前缀的
                    if (!isolationPrefix) return false;
                    
                    // 1. 基础前缀
                    if (basePrefixes.some(prefix => entry.comment.startsWith(isolationPrefix + prefix))) return true;

                    // 2. 已知自定义条目 (Known List) - 必须匹配隔离前缀
                    if (knownNames.includes(entry.comment) && entry.comment.startsWith(isolationPrefix)) return true;

                    // 3. 当前配置前缀 (Fallback)
                    for (const customPrefix of currentConfigPrefixes) {
                        if (entry.comment.startsWith(isolationPrefix + customPrefix)) return true;
                    }

                    return false;
                } else {
                    // 非隔离模式
                    if (entry.comment.startsWith('ACU-[')) return false; // 避开隔离数据
                    
                    // 1. 基础前缀
                    if (basePrefixes.some(prefix => entry.comment.startsWith(prefix))) return true;

                    // 2. 已知自定义条目 (Known List) - 必须不带隔离前缀(或者说我们假设knownNames存了完整名，这里只需检查它是否不以ACU-[开头)
                    // 其实 knownNames 可能包含带隔离前缀的（如果是切模式过来的）。我们只删非隔离的。
                    if (knownNames.includes(entry.comment) && !entry.comment.startsWith('ACU-[')) return true;

                    // 3. 当前配置前缀 (Fallback)
                    for (const customPrefix of currentConfigPrefixes) {
                        if (entry.comment.startsWith(customPrefix)) return true;
                    }

                    return false;
                }
            })
            .map(entry => entry.uid);

        if (uidsToDelete.length > 0) {
            await gwDeleteLorebookEntries_ACU(primaryLorebookName, uidsToDelete);
            logDebug_ACU(`Successfully deleted ${uidsToDelete.length} generated database entries for new chat.`);
            
            // [新增] 清理 knownCustomEntryNames 中属于当前隔离环境的记录
            // 因为我们已经把它们删了。
            // 注意：如果是“新聊天”，我们其实是重置。
            if (settings_ACU.knownCustomEntryNames) {
                if (settings_ACU.dataIsolationEnabled) {
                    settings_ACU.knownCustomEntryNames = settings_ACU.knownCustomEntryNames.filter((n: string) => !n.startsWith(isolationPrefix));
                } else {
                    settings_ACU.knownCustomEntryNames = settings_ACU.knownCustomEntryNames.filter((n: string) => n.startsWith('ACU-[')); // 只保留隔离的
                }
                saveSettings_ACU();
            }
        }
    } catch(error) {
        logError_ACU('Failed to delete generated lorebook entries:', error);
    }
  }


function migrateLegacyAutoMergedOrderBeforeTailRepair_ACU(data: Record<string, any>): boolean {
    let changed = false;
    Object.entries(data).forEach(([sheetKey, sheet]) => {
        if (!sheetKey.startsWith('sheet_') || !sheet || typeof sheet !== 'object') return;
        const content = (sheet as any).content;
        const header = Array.isArray(content) ? content[0] : null;
        if (!Array.isArray(header) || !['纪要表', '总结表'].includes(String((sheet as any).name || ''))) return;
        content.slice(1).forEach((row: unknown) => {
            if (!Array.isArray(row) || row.length !== header.length + 1 || row[row.length - 1] !== 'auto_merged') return;
            const rowId = String(row[0] ?? '').trim();
            const autoMergedOrder = ((settings_ACU as any).autoMergedOrder ||= {}) as Record<string, any[]>;
            const order = Array.isArray(autoMergedOrder[sheetKey]) ? autoMergedOrder[sheetKey] : (autoMergedOrder[sheetKey] = []);
            if (!rowId || order.some(id => String(id) === rowId)) return;
            order.push(rowId);
            changed = true;
        });
    });
    return changed;
}

/**
 * 阶段 E：可选 canonical 输入。
 *
 * 调用链刚完成的 authoritative post-save replay（来自 applyVisualizerPendingDataOps_ACU）
 * 可直接作为 merged refresh 的基底，避免 mergeAllIndependentTables_ACU 内部再从聊天
 * 完整 replay 一次（v2 模式内部调用 loadTableStateFromFramesV2_ACU）。
 *
 * 提供 canonicalData 时：
 * - 仍执行 loadAllChatMessages_ACU（世界书/其他派生刷新需要最新聊天数组）；
 * - 跳过 mergeAllIndependentTables_ACU 的整链重放，直接用调用方提供的 canonical 数据；
 * - 规范化、自愈、排序、世界书、UI 副作用照常执行（不把去重 replay 写成跳过 refresh）。
 *
 * 不提供时保持原行为（冷路径全量回放），兼容全部既有调用方。
 */
export async function refreshMergedDataAndNotify_ACU(options: { canonicalData?: Record<string, any> | null } = {}) {
      // 重新加载聊天记录（canonical 快照路径也保留：世界书派生刷新依赖最新聊天数组）
    await loadAllChatMessages_ACU();
    let removedNullRowCount = 0;
    let canonicalIssues: Array<{ sheetKey: string; rowIndex: number; reason: string }> = [];
    let integrityFixed = false;
    let degraded = false;
    let nullRowCleanupPersisted: NullRowCleanupPersistStatus_ACU = 'skipped_no_changes';
    let nullRowCleanupError: string | undefined;
    let nullRowCleanupMessageIndex: number | undefined;
      
    // 合并数据 (使用新的独立表合并逻辑)
    let mergedData: Record<string, any> | null = null;
    try {
        if (options.canonicalData && typeof options.canonicalData === 'object') {
            mergedData = JSON.parse(JSON.stringify(options.canonicalData));
        } else {
            mergedData = await mergeAllIndependentTables_ACU();
        }
        // 单表隔离信息在合并函数内已做逐表 try/catch，正常路径下不会整体抛错。
        // 这里仅用于捕获非预期异常并补充诊断上下文，不吞掉异常。
        const quarantined = consumeLastMergeQuarantinedSheetKeys_ACU();
        if (quarantined.length > 0) {
            degraded = true;
            logWarn_ACU(`[数据加载] 表格合并已隔离 ${quarantined.length} 张异常表：${quarantined.join('、')}，其余表正常加载。`);
        }
        const mergeWarnings = consumeLastMergeWarnings_ACU();
        mergeWarnings.forEach(w => logWarn_ACU(w));
    } catch (error) {
        degraded = true;
        logError_ACU('[数据加载] 表格合并失败，已保留可用数据并降级。', error);
        // 不吞掉异常：吞掉会让 _set_currentJsonTableData_ACU 停留在旧状态，产生更隐蔽的不一致。
        throw error;
    }

    // 当回溯找不到任何表格数据时（mergedData 为 null），
    // 优先用"已保存指导表的物化结构（不展开 seedRows）"作为基底；
    // 若不存在指导表，才使用"模板结构（不展开预置数据）"。
    if (!mergedData) {
        const currentIsolationKey = getCurrentIsolationKey_ACU();
        const guide = getChatSheetGuideDataForIsolationKey_ACU(currentIsolationKey);
        if (guide && typeof guide === 'object' && Object.keys(guide).some(k => k.startsWith('sheet_'))) {
            logDebug_ACU('[回溯空数据] 无历史表格数据：使用已保存指导表物化结构（不展开 seedRows）作为基底。');
            mergedData = materializeDataFromSheetGuide_ACU(guide, { includeSeedRows: false });
            _set_currentJsonTableData_ACU(mergedData);
        } else {
            logDebug_ACU('[回溯空数据] 无历史表格数据且无指导表：使用模板结构（不展开预置数据）。');
            const templateData = parseTableTemplateJson_ACU({ stripSeedRows: true }); // 仅结构，不携带模板预置数据行
            if (templateData) {
                mergedData = templateData;
                _set_currentJsonTableData_ACU(templateData);
            } else {
                // 极端兜底：模板也解析失败，设为空对象
                mergedData = { mate: { type: 'chatSheets', version: 1 } };
                _set_currentJsonTableData_ACU(mergedData);
                logWarn_ACU('[回溯空数据] 模板解析失败，currentJsonTableData_ACU 设为最小空结构。');
            }
        }
        // UI 选择器刷新由 presentation 层调用方负责
    } else {
        // 旧版本把自动合并状态错误地追加为无表头的业务单元格；只修复精确的
        // 历史尾标记形态，其他行宽错误仍由后续 canonical/V2 校验拒绝。
        if (migrateLegacyAutoMergedOrderBeforeTailRepair_ACU(mergedData)) {
            // 先迁移状态再剥离尾标记，避免下一轮自动合并重复处理历史纪要。
            saveSettings_ACU();
            integrityFixed = true;
        }
        const repairedAutoMergedSheetKeys = repairLegacyAutoMergedRowTails_ACU(mergedData);
        if (repairedAutoMergedSheetKeys.length > 0) {
            integrityFixed = true;
            logDebug_ACU(`[数据修复] 已移除历史 auto_merged 越界尾列：${repairedAutoMergedSheetKeys.join('、')}`);
        }
        const normalization = normalizeCanonicalTableRows_ACU(mergedData);
        removedNullRowCount = normalization.removedRows.length;
        canonicalIssues = normalization.errors.map(issue => ({ ...issue }));
        const cleanupSheetDataByKey = Object.fromEntries(
            [...new Set(normalization.removedRows.map(issue => issue.sheetKey))]
                .filter(sheetKey => sheetKey.startsWith('sheet_') && mergedData[sheetKey])
                .map(sheetKey => [sheetKey, JSON.parse(JSON.stringify(mergedData[sheetKey]))]),
        );
        if (normalization.removedRows.length > 0) {
            logWarn_ACU(`[数据修复] 已移除 ${normalization.removedRows.length} 条缺少 row_id 的损坏数据行。`);
            integrityFixed = true;
        }
        if (normalization.errors.length > 0) {
            degraded = true;
            logWarn_ACU(`[数据修复] 发现 ${normalization.errors.length} 条无法自动合并的表格行问题。`);
        }

        if (normalization.removedRows.length > 0) {
            if (normalization.errors.length > 0) {
                nullRowCleanupPersisted = 'skipped_invalid_data';
            } else {
                const cleanupResult = await persistNullRowCleanupShards_ACU({
                    sheetDataByKey: cleanupSheetDataByKey,
                    isolationKey: getCurrentIsolationKey_ACU(),
                });
                nullRowCleanupPersisted = cleanupResult.status;
                nullRowCleanupError = cleanupResult.error;
                nullRowCleanupMessageIndex = cleanupResult.messageIndex;
                if (cleanupResult.status !== 'persisted') {
                    degraded = true;
                }
                if (cleanupResult.status === 'failed') {
                    logWarn_ACU('[数据修复] 空 row_id 已从内存数据移除，但 V2 shard 自愈持久化失败。', cleanupResult.error);
                }
            }
        }

        if (integrityFixed) {
            logDebug_ACU('数据完整性已完成受控修复。');
        }

        // [修复] 强制稳定顺序（用户手动顺序优先，否则模板顺序）
        const stableKeys = getSortedSheetKeys_ACU(mergedData);
        mergedData = reorderDataBySheetKeys_ACU(mergedData, stableKeys);
        _set_currentJsonTableData_ACU(mergedData);
        logDebug_ACU('Updated currentJsonTableData_ACU with independently merged data.');
        // UI 选择器刷新由 presentation 层调用方负责
    }
          
    // 更新世界书
    try {
        await updateReadableLorebookEntry_ACU(true, false, null, mergedData);
        logDebug_ACU('Updated worldbook entries with merged data.');
    } catch (error) {
        degraded = true;
        logWarn_ACU('[数据恢复] 表格数据已加载到内存，但世界书刷新失败；保留可读和可导出数据。', error);
    }

    // 返回结果，UI 通知由 presentation 层调用方负责
    return {
        mergedData,
        integrityFixed,
        removedNullRowCount,
        canonicalIssues,
        degraded,
        nullRowCleanupPersisted,
        ...(nullRowCleanupError ? { nullRowCleanupError } : {}),
        ...(nullRowCleanupMessageIndex !== undefined ? { nullRowCleanupMessageIndex } : {}),
    };
  }


export   async function loadAllChatMessages_ACU() {
    if (!coreApisAreReady_ACU || !isWorldbookApiAvailable_ACU()) return;
    try {
      const chatLen = getChatLength_ACU();
      const lastMessageId = chatLen > 0 ? chatLen - 1 : -1;
      if (lastMessageId < 0) {
        _set_allChatMessages_ACU([]);
        logDebug_ACU('No chat messages (ACU).');
        return;
      }
      const messagesFromApi = await getChatMessages_ACU(`0-${lastMessageId}`, {
        include_swipes: false,
      });
      if (messagesFromApi && messagesFromApi.length > 0) {
        _set_allChatMessages_ACU(messagesFromApi.map((msg, idx) => ({ id: idx, is_user: msg.is_user, message: msg.message }))); // Projected lightweight view: only consumed fields retained
        logDebug_ACU(`ACU Loaded ${allChatMessages_ACU.length} messages for: ${currentChatFileIdentifier_ACU}.`);
      } else {
        _set_allChatMessages_ACU([]);
      }
    } catch (error) {
      logError_ACU('ACU获取聊天记录失败: ' + error.message);
      _set_allChatMessages_ACU([]);
    }
  }


function normalizeWorldbookListNames_ACU(bookList: unknown): string[] {
      if (!Array.isArray(bookList)) return [];
      return bookList
          .map(item => String(typeof item === 'object' && item !== null ? (item as any).name || '' : item || ''))
          .filter(name => name.trim());
}

export   async function getWorldbookNames_ACU() {
      const bookNames = await listLorebooks_ACU();
      return normalizeWorldbookListNames_ACU(bookNames);
  }

export type LorebookReadSource_ACU = 'plot_runtime' | 'plot_table_index' | 'agent_runtime' | 'ui' | 'global_enumeration' | 'manual_validation';
export type LorebookValidationPolicy_ACU = 'trusted_direct' | 'validate_list' | 'enumerate_all';
export type StrictLorebookReadStatus_ACU = 'success' | 'invalid_selection' | 'read_failed' | 'scope_changed' | 'aborted';
export type StrictLorebookReadErrorCategory_ACU = 'lorebook_not_found' | 'api_unavailable' | 'unknown';

export interface StrictLorebookFailure_ACU {
  bookName: string;
  errorCategory: StrictLorebookReadErrorCategory_ACU;
}

export interface StrictLorebookBookReadResult_ACU {
  bookName: string;
  status: Extract<StrictLorebookReadStatus_ACU, 'success' | 'read_failed' | 'scope_changed' | 'aborted'>;
  entries: any[];
  errorCategory?: StrictLorebookReadErrorCategory_ACU;
}

export interface StrictLorebookReadContext_ACU {
  runId: string;
  bookEntriesPromises: Map<string, Promise<StrictLorebookBookReadResult_ACU>>;
  availableBookNamesPromise?: Promise<string[]>;
  isActive?: () => boolean;
  isAborted?: () => boolean;
}

export interface StrictLorebookReadOptions_ACU {
  source: LorebookReadSource_ACU;
  validationPolicy: LorebookValidationPolicy_ACU;
  runId: string;
  context?: StrictLorebookReadContext_ACU;
  /** table candidate read 的 not-found 处理：fail 阻断读取；isolate_stale 只隔离该候选书。 */
  notFoundPolicy?: 'fail' | 'isolate_stale';
}

export interface StrictLorebookReadResult_ACU {
  status: StrictLorebookReadStatus_ACU;
  source: LorebookReadSource_ACU;
  validationPolicy: LorebookValidationPolicy_ACU;
  runId: string;
  entriesByBook: Record<string, any[]>;
  invalidBookNames: string[];
  failedBookNames: string[];
  failedBooks: StrictLorebookFailure_ACU[];
  staleBookNames: string[];
}

export class StrictLorebookReadError_ACU extends Error {
  readonly status: StrictLorebookReadStatus_ACU;
  readonly source: LorebookReadSource_ACU;
  readonly validationPolicy: LorebookValidationPolicy_ACU;
  readonly runId: string;
  readonly failedBooks: StrictLorebookFailure_ACU[];
  readonly invalidBookNames: string[];
  readonly staleBookNames: string[];

  constructor(result: StrictLorebookReadResult_ACU) {
    super(`StrictLorebookRead:${result.status}`);
    this.name = 'StrictLorebookReadError_ACU';
    this.status = result.status;
    this.source = result.source;
    this.validationPolicy = result.validationPolicy;
    this.runId = result.runId;
    this.failedBooks = result.failedBooks.map(failure => ({ ...failure }));
    this.invalidBookNames = [...result.invalidBookNames];
    this.staleBookNames = [...result.staleBookNames];
  }
}

export function createStrictLorebookReadError_ACU(result: StrictLorebookReadResult_ACU): StrictLorebookReadError_ACU {
  return new StrictLorebookReadError_ACU(result);
}

export function isStrictLorebookReadError_ACU(error: unknown): error is StrictLorebookReadError_ACU {
  if (error instanceof StrictLorebookReadError_ACU) return true;
  if (!(error instanceof Error) || error.name !== 'StrictLorebookReadError_ACU') return false;
  const candidate = error as Partial<StrictLorebookReadError_ACU>;
  return typeof candidate.status === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.validationPolicy === 'string'
    && typeof candidate.runId === 'string'
    && Array.isArray(candidate.failedBooks)
    && Array.isArray(candidate.invalidBookNames)
    && Array.isArray(candidate.staleBookNames);
}

export function summarizeStrictLorebookReadError_ACU(error: unknown) {
  return sharedSummarizeStrictLorebookReadError_ACU(error);
}

function normalizeRequestedLorebookNames_ACU(bookNames: unknown): string[] {
  return [...new Set((Array.isArray(bookNames) ? bookNames : [])
    .map(name => String(name || ''))
    .filter(name => name.trim()))];
}

function cloneLorebookReadValue_ACU(value: any): any {
  if (Array.isArray(value)) return value.map(cloneLorebookReadValue_ACU);
  if (!value || typeof value !== 'object') return value;
  const copy: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) copy[key] = cloneLorebookReadValue_ACU(item);
  return copy;
}

function cloneLorebookEntriesForRead_ACU(entries: any[], bookName: string): any[] {
  return (Array.isArray(entries) ? entries : []).map(entry => ({
    ...cloneLorebookReadValue_ACU(entry),
    book: bookName,
  }));
}

function getStrictLorebookContextStatus_ACU(context: StrictLorebookReadContext_ACU | undefined): Extract<StrictLorebookReadStatus_ACU, 'scope_changed' | 'aborted'> | null {
  if (!context) return null;
  if (context.isAborted?.()) return 'aborted';
  if (context.isActive && !context.isActive()) return 'scope_changed';
  return null;
}

function classifyStrictLorebookReadError_ACU(error: any): StrictLorebookReadErrorCategory_ACU {
  const category = classifyLorebookReadError_ACU(error);
  // abort/scope_changed 已由 context 状态机处理；此处只关心书级分类。
  if (category === 'lorebook_not_found') return 'lorebook_not_found';
  if (category === 'api_unavailable') return 'api_unavailable';
  return 'unknown';
}

async function readStrictLorebookBook_ACU(bookName: string, context?: StrictLorebookReadContext_ACU): Promise<StrictLorebookBookReadResult_ACU> {
  const beforeStatus = getStrictLorebookContextStatus_ACU(context);
  if (beforeStatus) return { bookName, status: beforeStatus, entries: [] };
  try {
    const entries = await gwGetLorebookEntriesRequired_ACU(bookName);
    const afterStatus = getStrictLorebookContextStatus_ACU(context);
    if (afterStatus) return { bookName, status: afterStatus, entries: [] };
    return { bookName, status: 'success', entries: cloneLorebookEntriesForRead_ACU(entries, bookName) };
  } catch (error) {
    const failureStatus = getStrictLorebookContextStatus_ACU(context);
    if (failureStatus) return { bookName, status: failureStatus, entries: [] };
    const category = classifyLorebookReadError_ACU(error);
    if (category === 'aborted' || category === 'scope_changed') return { bookName, status: category, entries: [] };
    return { bookName, status: 'read_failed', entries: [], errorCategory: classifyStrictLorebookReadError_ACU(error) };
  }
}

async function getStrictLorebookBookRead_ACU(bookName: string, context?: StrictLorebookReadContext_ACU): Promise<StrictLorebookBookReadResult_ACU> {
  if (!context) return readStrictLorebookBook_ACU(bookName);
  const existing = context.bookEntriesPromises.get(bookName);
  if (existing) return existing;
  const promise = readStrictLorebookBook_ACU(bookName, context);
  context.bookEntriesPromises.set(bookName, promise);
  return promise;
}

async function getStrictLorebookAvailableBookNames_ACU(context?: StrictLorebookReadContext_ACU): Promise<string[]> {
  const availableBookNames = await (context?.availableBookNamesPromise ?? listLorebooks_ACU());
  return normalizeWorldbookListNames_ACU(availableBookNames);
}

export async function getLorebookEntriesStrict_ACU(bookNames: string[] = [], options: StrictLorebookReadOptions_ACU): Promise<StrictLorebookReadResult_ACU> {
  let requestedBookNames = normalizeRequestedLorebookNames_ACU(bookNames);
  const baseResult = {
    source: options.source,
    validationPolicy: options.validationPolicy,
    runId: options.runId,
    entriesByBook: {} as Record<string, any[]>,
    invalidBookNames: [] as string[],
    failedBookNames: [] as string[],
    failedBooks: [] as StrictLorebookFailure_ACU[],
    staleBookNames: [] as string[],
  };
  const initialStatus = getStrictLorebookContextStatus_ACU(options.context);
  if (initialStatus) return { ...baseResult, status: initialStatus };

  if (options.validationPolicy === 'enumerate_all') {
    try {
      requestedBookNames = await getStrictLorebookAvailableBookNames_ACU(options.context);
    } catch {
      const failureStatus = getStrictLorebookContextStatus_ACU(options.context);
      return { ...baseResult, status: failureStatus || 'read_failed' };
    }
  } else if (options.validationPolicy === 'validate_list') {
    try {
      const availableBookNames = await getStrictLorebookAvailableBookNames_ACU(options.context);
      const resolvedNames = requestedBookNames.map(name => ({
        requested: name,
        resolved: resolveLorebookNameFromList_ACU(name, availableBookNames),
      }));
      baseResult.invalidBookNames = resolvedNames.filter(item => !item.resolved).map(item => item.requested);
      requestedBookNames = [...new Set(resolvedNames.map(item => item.resolved).filter((name): name is string => !!name))];
      if (baseResult.invalidBookNames.length > 0) {
        if (options.notFoundPolicy === 'isolate_stale') {
          // 候选作用域：catalog 阶段不在列表的书直接隔离（记入 stale），继续读取其余候选。
          baseResult.staleBookNames.push(...baseResult.invalidBookNames);
          baseResult.invalidBookNames = [];
        } else {
          return { ...baseResult, status: 'invalid_selection' };
        }
      }
    } catch {
      const failureStatus = getStrictLorebookContextStatus_ACU(options.context);
      return { ...baseResult, status: failureStatus || 'read_failed' };
    }
  }

  const reads = await Promise.all(requestedBookNames.map(name => getStrictLorebookBookRead_ACU(name, options.context)));
  const finalStatus = getStrictLorebookContextStatus_ACU(options.context);
  if (finalStatus === 'aborted' || reads.some(read => read.status === 'aborted')) {
    return { ...baseResult, status: 'aborted' };
  }
  if (finalStatus === 'scope_changed' || reads.some(read => read.status === 'scope_changed')) {
    return { ...baseResult, status: 'scope_changed' };
  }
  // 候选作用域读取：not-found 处理由显式 policy 决定，不再硬编码为 enumerate_all 特例。
  const canIsolateStaleTableIndexBook = options.notFoundPolicy === 'isolate_stale';
  for (const read of reads) {
    if (read.status === 'success') {
      baseResult.entriesByBook[read.bookName] = cloneLorebookEntriesForRead_ACU(read.entries, read.bookName);
      continue;
    }
    if (canIsolateStaleTableIndexBook && read.errorCategory === 'lorebook_not_found') {
      baseResult.staleBookNames.push(read.bookName);
      continue;
    }
    baseResult.failedBookNames.push(read.bookName);
    baseResult.failedBooks.push({ bookName: read.bookName, errorCategory: read.errorCategory || 'unknown' });
  }
  return baseResult.failedBookNames.length > 0
    ? { ...baseResult, status: 'read_failed' }
    : { ...baseResult, status: 'success' };
}


export   async function getLorebookEntriesByNames_ACU(bookNames: string[] = []) {
      const uniqueNames = normalizeRequestedLorebookNames_ACU(bookNames);
      let readTargets = uniqueNames.map(requestedName => ({ requestedName, hostName: requestedName }));
      const entriesMap: Record<string, any[]> = {};
      const canUseTavernHelper = isWorldbookApiAvailable_ACU();
      let fallbackBooks = null;

      // [防御] 预先验证世界书是否真实存在，过滤掉不存在的名称
      // 防止 SillyTavern API 返回残留/缓存的不存在世界书名称导致报错
      try {
          const availableBooks = await listLorebooks_ACU();
          const availableBookNames = normalizeWorldbookListNames_ACU(availableBooks);
          if (availableBookNames.length > 0) {
              readTargets = readTargets.flatMap(target => {
                  const resolvedName = resolveLorebookNameFromList_ACU(target.requestedName, availableBookNames);
                  if (resolvedName) return [{ ...target, hostName: resolvedName }];
                  logDebug_ACU('[Worldbook] 世界书不在当前可用列表中，跳过读取。', {
                      phase: 'read_entries',
                      reason: 'not_in_available_list',
                      bookName: target.requestedName,
                  });
                  entriesMap[target.requestedName] = []; // 为不存在的书返回空数组，保持接口一致
                  return [];
              });
          }
      } catch (_e) {
          throw _e;
      }

      if (!canUseTavernHelper) {
          fallbackBooks = await gwGetWorldBooks_ACU();
      }

      for (const target of readTargets) {
          const { requestedName } = target;
          try {
              let entries = [];
              let hostName = target.hostName;
              if (canUseTavernHelper) {
                  entries = await gwGetLorebookEntries_ACU(hostName);
              } else if (Array.isArray(fallbackBooks)) {
                  const fallbackName = resolveLorebookNameFromList_ACU(hostName, fallbackBooks);
                  if (fallbackName) hostName = fallbackName;
                  const matchedBook = fallbackBooks.find((book: any) => book?.name === hostName);
                  entries = normalizeLorebookEntriesForRead_ACU((matchedBook as any)?.entries, hostName);
              }
              // 返回键保留调用方请求名称以兼容现有接口；条目 book 使用真实宿主名称。
              entriesMap[requestedName] = Array.isArray(entries) ? entries.map((entry: any) => ({ ...entry, book: hostName })) : [];
          } catch (error) {
              logWarn_ACU('[Worldbook] 获取世界书条目失败，忽略该书并继续。', {
                  phase: 'read_entries',
                  attempt: 1,
                  bookName: requestedName,
                  error: { category: 'read_failed' },
              });
              throw error;
          }
      }
      return entriesMap;
  }


export   async function getWorldBooks_ACU() {
      const bookNames = await getWorldbookNames_ACU();
      const entriesMap = await getLorebookEntriesByNames_ACU(bookNames);
      return bookNames.map((name: string) => ({
          name,
          entries: Array.isArray(entriesMap[name]) ? entriesMap[name] : [],
      }));
  }


export   function isImportTaggedLorebookEntry_ACU(entry: Record<string, any>) {
    const rawComment = String(entry?.comment || entry?.name || '').trim();
    if (!rawComment) return false;
    const normalizedComment = rawComment.replace(/^ACU-\[[^\]]+\]-/, '');
    return normalizedComment.startsWith(getImportStablePrefix_ACU());
  }


export   function getWorldbookCommentInfo_ACU(entry: Record<string, any>) {
      const rawComment = String(entry?.comment || entry?.name || '').trim();
      let normalizedComment = rawComment.replace(/^ACU-\[[^\]]+\]-/, '');
      normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');
      return { rawComment, normalizedComment };
  }


export   function getWorldbookEntryKeywords_ACU(entry: Record<string, any>) {
      const toStrArray = (v: any) => {
          if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x.trim());
          if (typeof v === 'string' && v.trim()) return [v];
          return [];
      };
      return [...new Set([...toStrArray(entry?.key), ...toStrArray(entry?.keys)])].map(k => k.toLowerCase());
  }


export   function getWorldbookEntryPlaceholderSortKey_ACU(entry: Record<string, any>) {
      const position = normalizeLorebookPosition_ACU(entry?.position, 'at_depth_as_system');
      const order = getEntryOrderNumber_ACU(entry);
      const normalizedOrder = order === null ? Number.MAX_SAFE_INTEGER : order;
      const depthValue = typeof entry?.depth === 'number' ? entry.depth : parseInt(String(entry?.depth ?? ''), 10);
      const normalizedDepth = Number.isFinite(depthValue) ? depthValue : 0;

      if (position === 'before_character_definition') {
          return { segment: 0, depthRank: 0, order: normalizedOrder };
      }
      if (position === 'after_character_definition') {
          return { segment: 1, depthRank: 0, order: normalizedOrder };
      }
      return { segment: 2, depthRank: -normalizedDepth, order: normalizedOrder };
  }


export   function compareWorldbookEntriesForPlaceholder_ACU(a: Record<string, any>, b: Record<string, any>) {
      const keyA = getWorldbookEntryPlaceholderSortKey_ACU(a);
      const keyB = getWorldbookEntryPlaceholderSortKey_ACU(b);

      if (keyA.segment !== keyB.segment) return keyA.segment - keyB.segment;
      if (keyA.depthRank !== keyB.depthRank) return keyA.depthRank - keyB.depthRank;
      if (keyA.order !== keyB.order) return keyA.order - keyB.order;

      const originalIndexA = Number.isFinite(a?._acuPlaceholderOriginalIndex) ? a._acuPlaceholderOriginalIndex : Number.MAX_SAFE_INTEGER;
      const originalIndexB = Number.isFinite(b?._acuPlaceholderOriginalIndex) ? b._acuPlaceholderOriginalIndex : Number.MAX_SAFE_INTEGER;
      if (originalIndexA !== originalIndexB) return originalIndexA - originalIndexB;

      const bookNameA = String(a?.bookName || '');
      const bookNameB = String(b?.bookName || '');
      if (bookNameA !== bookNameB) return bookNameA.localeCompare(bookNameB, 'zh-Hans-CN');

      const uidA = String(a?.uid ?? '');
      const uidB = String(b?.uid ?? '');
      return uidA.localeCompare(uidB, 'zh-Hans-CN');
  }


export type WorldbookEntryStateView_ACU = 'live' | 'pre_takeover';

function buildPreTakeoverSnapshotEntryMap_ACU(
    snapshot: AgentWorldbookControlSnapshot_ACU | null | undefined,
    expectedSignature: string,
): Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>> | null {
    if (snapshot?.active !== true) return null;
    if (!expectedSignature || snapshot.selectionSignature !== expectedSignature) return null;
    const result = new Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>>();
    for (const [bookName, entries] of Object.entries(snapshot.books || {})) {
        if (!Array.isArray(entries)) continue;
        const byUid = new Map<string, AgentWorldbookControlSnapshotEntry_ACU>();
        for (const entry of entries) {
            const uid = String(entry?.uid ?? '').trim();
            if (entry?.takeoverStatus === 'pending') continue;
            if (uid) byUid.set(uid, entry);
        }
        if (byUid.size > 0) result.set(bookName, byUid);
    }
    return result.size > 0 ? result : null;
}

function decorateWorldbookEntryStateView_ACU(
    entry: Record<string, any>,
    bookName: string,
    snapshotEntries: Map<string, Map<string, AgentWorldbookControlSnapshotEntry_ACU>> | null,
): { entry: Record<string, any>; snapshotHit: boolean } {
    const snapshotEntry = snapshotEntries?.get(bookName)?.get(String(entry?.uid ?? ''));
    if (!snapshotEntry) return { entry: { ...entry }, snapshotHit: false };
    const previousKeys = Array.isArray(snapshotEntry.previousKeys) ? [...snapshotEntry.previousKeys] : [];
    return {
        entry: {
            ...entry,
            enabled: snapshotEntry.previousEnabled !== false,
            _acuPreTakeoverSnapshotHit: true,
            key: previousKeys,
            keys: [...previousKeys],
            type: snapshotEntry.previousType,
        },
        snapshotHit: true,
    };
}


export   async function collectCombinedWorldbookEntriesByStrategy_ACU(options: any = {}) {
      const logPrefix = String(options?.logPrefix || '[Worldbook]');
      const bookNames = normalizeRequestedLorebookNames_ACU(options?.bookNames);
      const excludeEntry = typeof options?.excludeEntry === 'function' ? options.excludeEntry : () => false;
      const entryScope = typeof options?.entryScope === 'function' ? options.entryScope : () => true;
      const includeEntry = typeof options?.includeEntry === 'function' ? options.includeEntry : () => true;
      const isSelected = typeof options?.isSelected === 'function' ? options.isSelected : () => true;
      const forceIncludeEntry = typeof options?.forceIncludeEntry === 'function' ? options.forceIncludeEntry : () => false;
      const excludeDisabledEntries = options?.excludeDisabledEntries !== false;
      const includeConstantEntriesInBaseScan = options?.includeConstantEntriesInBaseScan === true;
      const sortEntries = typeof options?.sortEntries === 'function' ? options.sortEntries : compareWorldbookEntriesForPlaceholder_ACU;
      const entryStateView: WorldbookEntryStateView_ACU = options?.entryStateView === 'pre_takeover' ? 'pre_takeover' : 'live';
      const snapshotEntries = entryStateView === 'pre_takeover'
          ? buildPreTakeoverSnapshotEntryMap_ACU(options?.entryStateSnapshot, String(options?.entryStateSnapshotSignature || '').trim())
          : null;
      let snapshotHitCount = 0;
      let snapshotMissCount = 0;
      let entryCount = 0;

      if (bookNames.length === 0) {
          logWarn_ACU(`${logPrefix} 没有找到任何世界书，内容将为空`);
          return [];
      }

      const providedEntriesMap = options?.entriesByBook;
      let entriesMap: any = providedEntriesMap && typeof providedEntriesMap === 'object'
        ? providedEntriesMap
        : null;
      if (!entriesMap && options?.readContext) {
        // 请求级上下文：只读取候选作用域内的书，物理读取由 context 去重与限流。
        const targets = await resolveLorebookReadTargets_ACU(options.readContext, bookNames);
        entriesMap = {};
        await Promise.all(targets.map(async (target) => {
          if (!target.hostName) return;
          entriesMap[target.requestedName] = await options.readContext.readBookEntries(target.hostName);
        }));
      }
      if (!entriesMap) {
        entriesMap = await getLorebookEntriesByNames_ACU(bookNames);
      }
      let allEntries: any[] = [];
      let placeholderOriginalIndex = 0;
      for (const bookName of bookNames) {
          const bookEntries = Array.isArray(entriesMap[bookName])
            ? cloneLorebookEntriesForRead_ACU(entriesMap[bookName], bookName)
            : [];
          logDebug_ACU(`${logPrefix} 世界书 "${bookName}" 条目数量:`, bookEntries.length);
          bookEntries.forEach(entry => {
              entryCount++;
              const stateViewResult = entryStateView === 'pre_takeover'
                  ? decorateWorldbookEntryStateView_ACU(entry, bookName, snapshotEntries)
                  : { entry: { ...entry }, snapshotHit: false };
              if (entryStateView === 'pre_takeover') stateViewResult.snapshotHit ? snapshotHitCount++ : snapshotMissCount++;
              const { rawComment, normalizedComment } = getWorldbookCommentInfo_ACU(stateViewResult.entry);
              const decoratedEntry = {
                  ...stateViewResult.entry,
                  bookName,
                  rawComment,
                  normalizedComment,
                  _acuPlaceholderOriginalIndex: placeholderOriginalIndex++,
              };
              if (excludeEntry(decoratedEntry) === true) return;
              if (entryScope(decoratedEntry) === false) return;
              if (includeEntry(decoratedEntry) === false) return;
              allEntries.push(decoratedEntry);
          });
      }
      logDebug_ACU(`${logPrefix} view=${entryStateView}; entries=${entryCount}; snapshotValid=${snapshotEntries !== null}; snapshotHits=${snapshotHitCount}; snapshotMisses=${snapshotMissCount}`);
      const hasInvalidActivePreTakeoverSnapshot = entryStateView === 'pre_takeover'
          && options?.entryStateSnapshot?.active === true
          && snapshotEntries === null;
      if (hasInvalidActivePreTakeoverSnapshot) {
          logWarn_ACU(`${logPrefix} pre_takeover snapshot unavailable or signature mismatch; using live entry state.`);
      }

      if (typeof options?.onEntriesFiltered === 'function') {
          try { options.onEntriesFiltered(allEntries); } catch (e) {}
      }
      if (allEntries.length === 0) {
          logDebug_ACU(`${logPrefix} 所选世界书在过滤后无可用条目。`);
          return [];
      }

      const forcedEntries = allEntries.filter(entry => forceIncludeEntry(entry) === true);
      const forcedEntrySet = new Set(forcedEntries);
      let userEnabledEntries = allEntries.filter(entry => (
          (excludeDisabledEntries ? !!entry.enabled : true) || forcedEntrySet.has(entry)
      ));
      userEnabledEntries = userEnabledEntries.filter(entry => isSelected(entry) !== false);
      if (typeof options?.onSelectedEntries === 'function') {
          try { options.onSelectedEntries(userEnabledEntries); } catch (e) {}
      }
      if (userEnabledEntries.length === 0) {
          logDebug_ACU(`${logPrefix} 当前配置下没有启用的世界书条目。`);
          return [];
      }

      let baseScanText = '';
      if (typeof options?.baseScanText === 'string' && options.baseScanText.trim()) {
          baseScanText = options.baseScanText;
      } else if (typeof options?.fallbackScanText === 'string' && options.fallbackScanText.trim()) {
          baseScanText = options.fallbackScanText;
      }
      baseScanText = baseScanText.toLowerCase();

      const constantEntries = userEnabledEntries.filter(entry => entry.type === 'constant');
      let keywordEntries = userEnabledEntries.filter(entry => entry.type !== 'constant' && !forcedEntrySet.has(entry));

      if (includeConstantEntriesInBaseScan) {
          const constantBaseText = constantEntries
              .filter(entry => !entry.prevent_recursion)
              .map(entry => entry.content || '')
              .join('\n')
              .toLowerCase();
          if (constantBaseText) {
              baseScanText = [baseScanText, constantBaseText].filter(Boolean).join('\n');
          }
      }

      const triggeredEntries = new Set([...constantEntries, ...userEnabledEntries.filter(entry => forcedEntrySet.has(entry))]);
      let recursionDepth = 0;
      const MAX_RECURSION_DEPTH = 10;

      while (recursionDepth < MAX_RECURSION_DEPTH) {
          recursionDepth++;
          let hasChangedInThisPass = false;

          const recursionSourceContent = Array.from(triggeredEntries)
              .filter(entry => !entry.prevent_recursion)
              .map(entry => entry.content)
              .join('\n')
              .toLowerCase();
          const fullSearchText = `${baseScanText}\n${recursionSourceContent}`;

          const remainingKeywordEntries = [];
          for (const entry of keywordEntries) {
              const keywords = getWorldbookEntryKeywords_ACU(entry);
              const isTriggered = keywords.length > 0 && keywords.some(keyword =>
                  entry.exclude_recursion ? baseScanText.includes(keyword) : fullSearchText.includes(keyword)
              );

              if (isTriggered) {
                  triggeredEntries.add(entry);
                  hasChangedInThisPass = true;
              } else {
                  remainingKeywordEntries.push(entry);
              }
          }

          if (!hasChangedInThisPass) {
              logDebug_ACU(`${logPrefix} Worldbook recursion stabilized after ${recursionDepth} passes.`);
              break;
          }

          keywordEntries = remainingKeywordEntries;
      }

      if (recursionDepth >= MAX_RECURSION_DEPTH) {
          logWarn_ACU(`${logPrefix} Worldbook recursion reached max depth of ${MAX_RECURSION_DEPTH}. Breaking loop.`);
      }

      let finalEntries = Array.from(triggeredEntries);
      if (sortEntries) {
          finalEntries = finalEntries.sort(sortEntries);
      }

      return finalEntries;
  }


export   function formatCombinedWorldbookEntries_ACU(entries: any[], formatEntry?: (entry: any) => string) {
      const effectiveFormatEntry = typeof formatEntry === 'function'
          ? formatEntry
          : ((entry: any) => `# ${entry.comment || `Entry from ${entry.bookName}`}\n${entry.content}`);
      return (Array.isArray(entries) ? entries : [])
          .map(entry => effectiveFormatEntry(entry))
          .filter(chunk => typeof chunk === 'string' && chunk.trim())
          .join('\n\n')
          .trim();
  }


export   async function buildCombinedWorldbookContentByStrategy_ACU(options: any = {}) {
      const logPrefix = String(options?.logPrefix || '[Worldbook]');
      const finalEntries = await collectCombinedWorldbookEntriesByStrategy_ACU(options);
      const combinedContent = formatCombinedWorldbookEntries_ACU(finalEntries, options?.formatEntry);

      if (!combinedContent) {
          logDebug_ACU(`${logPrefix} No worldbook entries were ultimately triggered.`);
          return '';
      }

      logDebug_ACU(`${logPrefix} Combined worldbook content generated, length: ${combinedContent.length}. ${finalEntries.length} entries triggered.`);
      return combinedContent;
  }


export   async function getCombinedWorldbookContent_ACU(initialScanTextOverride = '', options: any = {}) {
    logDebug_ACU('Starting to get combined worldbook content with advanced logic...');
    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const excludeImportTaggedEntries = options?.excludeImportTaggedEntries === true;
    const includeGeneratedEntries = options?.includeGeneratedEntries === true;
    const agentGreenlightKeySet = new Set((Array.isArray(options?.agentGreenlights) ? options.agentGreenlights : [])
        .map((ref: any) => `${String(ref?.bookName || '').trim()}\u0000${String(ref?.uid || '').trim()}`)
        .filter((key: string) => !key.startsWith('\u0000') && !key.endsWith('\u0000')));

    if (!isWorldbookApiAvailable_ACU()) {
        logWarn_ACU('[ACU] Worldbook API not available, cannot get worldbook content.');
        return '';
    }

    try {
        let bookNames = [];
        
        if (worldbookConfig.source === 'manual') {
            bookNames = worldbookConfig.manualSelection || [];
        } else { // 'character' mode
            try {
                const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
                if (charLorebooks.primary) bookNames.push(charLorebooks.primary);
                if (charLorebooks.additional?.length) bookNames.push(...charLorebooks.additional);
            } catch {
                logError_ACU('[Worldbook] 获取角色世界书失败:', {
                    phase: 'resolve_character',
                    error: { category: 'read_failed' },
                });
                return '';
            }
        }

        const enabledEntriesMap = worldbookConfig?.enabledEntries;
        const hasAnySelection = enabledEntriesMap && typeof enabledEntriesMap === 'object' && Object.keys(enabledEntriesMap).length > 0;
        const entryStateView: WorldbookEntryStateView_ACU = options?.entryStateView === 'pre_takeover' ? 'pre_takeover' : 'live';
        return await buildCombinedWorldbookContentByStrategy_ACU({
            logPrefix: '[Worldbook]',
            bookNames,
            entriesByBook: options?.entriesByBook,
            readContext: options?.readContext,
            formatEntry: (entry: any) => String(entry?.content || '').trim(),
            baseScanText: (typeof initialScanTextOverride === 'string' && initialScanTextOverride.trim()) ? initialScanTextOverride : '',
            fallbackScanText: allChatMessages_ACU.map(message => message.message).join('\n'),
            entryStateView,
            entryStateSnapshot: options?.entryStateSnapshot,
            entryStateSnapshotSignature: String(options?.entryStateSnapshotSignature || '').trim(),
            excludeEntry: typeof options?.excludeEntry === 'function' ? options.excludeEntry : undefined,
            entryScope: typeof options?.entryScope === 'function' ? options.entryScope : undefined,
            includeEntry: (entry: any) => {
                const comment = entry.comment || '';
                const isAgentGreenlight = agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
                if (isAgentGreenlight) return true;
                if (!includeGeneratedEntries && comment.startsWith('TavernDB-ACU-')) return false;
                if (!includeGeneratedEntries && comment.startsWith('重要人物条目')) return false;
                if (!includeGeneratedEntries && comment.startsWith('总结条目')) return false;
                if (excludeImportTaggedEntries && isImportTaggedLorebookEntry_ACU(entry)) return false;
                if (isEntryBlocked_ACU(entry)) return false;
                return true;
            },
            isSelected: (entry: any) => {
                const isAgentGreenlight = agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
                if (isAgentGreenlight) return true;
                if (!hasAnySelection) return true;
                const list = enabledEntriesMap?.[entry.bookName];
                if (typeof list === 'undefined') return true;
                if (!Array.isArray(list)) return true;
                return list.includes(entry.uid);
            },
            forceIncludeEntry: (entry: any) => {
                return agentGreenlightKeySet.has(`${String(entry.bookName || '').trim()}\u0000${String(entry.uid || '').trim()}`);
            },
            onEntriesFiltered: (entries: any[]) => {
                if (excludeImportTaggedEntries) {
                    logDebug_ACU(`[Worldbook][Import] Import prompt exclusion enabled. Remaining entries after excluding import-tagged lorebook items: ${entries.length}`);
                }
            },
        });

    } catch (error) {
        logError_ACU(`[ACU] An error occurred while processing worldbook logic:`, error);
        return ''; // Return empty string on error to prevent breaking the generation.
    }
  }
