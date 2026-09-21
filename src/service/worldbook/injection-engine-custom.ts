/**
 * service/worldbook/injection-engine-custom.ts — 自定义表格导出
 * 从 injection-engine.ts 拆出
 */
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { settings_ACU } from '../runtime/state-manager';
import { isWorldbookApiAvailable_ACU, getLorebookEntries_ACU, setLorebookEntries_ACU, createLorebookEntries_ACU, deleteLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { saveSettings_ACU } from '../settings/settings-service';
import { getSortedSheetKeys_ACU } from '../template/chat-scope';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { classifyLorebookReadError_ACU } from '../../shared/lorebook-read-error';
import { getImportBatchPrefix_ACU } from '../../shared/constants';
import { DEFAULT_ENTRY_PLACEMENT_ACU, DEFAULT_EXTRA_INDEX_PLACEMENT_ACU, ensureExportConfigDefaults_ACU, normalizePlacementConfig_ACU, applyPlacementToEntry_ACU } from './injection-engine-config';
import { buildUsedOrderSet_ACU, allocOrder_ACU, allocConsecutiveOrderBlock_ACU } from './injection-engine-order';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from './injection-engine-state';
import { splitKeywordsByComma_ACU } from './injection-engine-entries';
import { getLatestSummaryVectorIndexSnapshotState_ACU } from '../vector/summary-vector-index-state-service';
import { didLastSummaryVectorRecallSucceed_ACU } from '../vector/summary-vector-index-recall-status';
import { getEffectiveSummaryVectorIndexConfig_ACU } from '../vector/vector-memory-config';
import { isSqliteMode } from '../table/storage-mode';
import { buildExternalCustomTableExportComment_ACU, type ExternalCustomTableExportMarker_ACU } from './worldbook-placeholder-classification';
import { getSheetColumnProjection_ACU } from '../../shared/ddl-utils';
import { getCurrentFlightModeState_ACU } from '../flight-mode/flight-mode-state';
import { projectFlightModeHiddenChronicleRows_ACU } from '../flight-mode/flight-mode-hidden-rows';

  // [新增] 处理自定义表格导出逻辑
  // [修复] 当 mergedData 为空/null 时，仍需执行"清理旧自定义导出条目"逻辑，
  // 避免删除楼层回溯到空数据时旧条目残留在世界书中。
  export async function updateCustomTableExports_ACU(mergedData: Record<string, any> | null, isImport = false, targetLorebookOverride: string | null = null) {
      if (!isWorldbookApiAvailable_ACU()) return;
      if (mergedData) {
          const flightMode = getCurrentFlightModeState_ACU();
          if (flightMode.enabled && flightMode.hiddenRowIds.length > 0) {
              try {
                  mergedData = projectFlightModeHiddenChronicleRows_ACU(mergedData, flightMode);
              } catch (error) {
                  // 投影失败不得阻断世界书重建，更不能误删运行时数据。
                  logWarn_ACU('[FlightMode] 世界书纪要隐藏行投影失败，已回退为未过滤数据。', error);
              }
          }
      }
      const primaryLorebookName = targetLorebookOverride || await getInjectionTargetLorebook_ACU();
      if (!primaryLorebookName) return;

      const IMPORT_PREFIX = getImportBatchPrefix_ACU();
      const isoPrefix = getIsolationPrefix_ACU();
      // [修复] 外部导入的自定义导出条目必须加外部导入前缀，避免被当作普通注入条目/或被清理逻辑误删
      // [修改] 外部导入时只使用"外部导入-"前缀，不再包含"TavernDB-ACU-CustomExport-"
      const exportPrefix = isoPrefix + (isImport ? IMPORT_PREFIX : '');
      // [修复] 外部导入时的条目命名辅助函数：只使用"外部导入-"前缀
      const getImportEntryName = (name: string, marker?: Omit<ExternalCustomTableExportMarker_ACU, 'version' | 'kind'>) => {
          const comment = isImport ? `${exportPrefix}${name}` : `${exportPrefix}TavernDB-ACU-CustomExport-${name}`;
          if (!isImport || !marker) return comment;
          return buildExternalCustomTableExportComment_ACU(comment, {
              version: 1,
              kind: 'custom_table_export',
              ...marker,
          });
      };
      // [修改] 定义旧版前缀用于清理（非外部导入模式）
      const baseLegacyPrefix = 'TavernDB-ACU-CustomExport';
      const LEGACY_EXPORT_PREFIX = isoPrefix + baseLegacyPrefix;
      
      // [修改] 0TK 与交火模式允许同时启用：交火模式可保留/覆盖纪要索引内容，但 0TK 仍持续控制该条目的 enabled 状态。
      const worldbookConfig = getCurrentWorldbookConfig_ACU();
      const zeroTkOccupyMode = worldbookConfig?.zeroTkOccupyMode === true;
      const summaryVectorIndexModeEnabled = worldbookConfig?.summaryVectorIndexModeEnabled === true;
      const extraIndexEntryEnabled = !zeroTkOccupyMode;
      logDebug_ACU(`[CustomExport] 0TK模式=${zeroTkOccupyMode}, 交火纪要索引=${summaryVectorIndexModeEnabled}, 纪要索引条目enabled=${extraIndexEntryEnabled}`);

      // [spv3.6.4] 计算交火索引是否已达门槛：未达门槛时内容保护补丁不生效，让普通填表正常更新纪要索引条目
      let crossfireThresholdMet = false;
      if (summaryVectorIndexModeEnabled) {
          try {
              const snapshot = getLatestSummaryVectorIndexSnapshotState_ACU();
              const state = snapshot?.summaryVectorIndexState || null;
              if (state) {
                  const activeRowKeys = new Set((state as any).manifest?.snapshot?.activeRowKeys || []);
                  const indexedRowCount = Array.isArray((state as any).rows)
                      ? (state as any).rows.filter((row: any) => row.status !== 'removed' && (activeRowKeys.size === 0 || activeRowKeys.has(row.rowKey))).length
                      : 0;
                  const config = getEffectiveSummaryVectorIndexConfig_ACU();
                  crossfireThresholdMet = indexedRowCount >= config.summaryIndexKeywordMinRows;
              }
          } catch (e) {
              logWarn_ACU('[CustomExport] 无法获取交火索引状态，默认不保护纪要索引条目内容:', e);
          }
      }
      logDebug_ACU(`[CustomExport] 交火门槛已达标=${crossfireThresholdMet}`);

      try {
          const allEntries = await getLorebookEntries_ACU(primaryLorebookName);
          const usedOrders = buildUsedOrderSet_ACU(allEntries);
          
          // 1. Delete entries
          // [修改] 使用 knownCustomEntryNames 和 LEGACY_PREFIX 进行全面清理
          // 即使是回退或改名，只要曾经记录在 knownCustomEntryNames 中，并且符合当前隔离前缀，就会被清理
          
          // 加载已知条目列表（外部导入模式不使用 knownNames，以避免把第三方世界书纳入"本插件管理范围"）
          let knownNames = settings_ACU.knownCustomEntryNames || [];
          if (!Array.isArray(knownNames)) knownNames = [];

          const uidsToDelete = allEntries
              .filter(e => {
                  const comment = typeof e?.comment === 'string' ? e.comment : '';
                  if (!comment) return false;

                  // 用户要求：外部导入每次导入前不清理（允许多批并存）
                  if (isImport) return false;
                  
                  // 1. 检查旧版前缀 (兼容性)
                  // LEGACY_EXPORT_PREFIX 已经包含了 isoPrefix
                  if (comment.startsWith(LEGACY_EXPORT_PREFIX)) return true;

                  // 2. 检查是否在已知列表中（仅非外部导入模式）
                  // 只有当条目属于当前隔离环境时才删除
                  if (comment.startsWith(isoPrefix)) {
                      if (knownNames.includes(comment)) return true;
                  }
                  return false;
              })
              .map(e => e.uid);
            
          // [新增] 还需要把当前配置会生成的名字也加入到"待删除"列表中，以防它们是新生成的但同名
          // 这一步会在后续生成 entriesToCreate 时自然覆盖，但显式删除更干净。
          // 由于我们下面会重新生成并添加到 knownNames，这里先删除所有已知的"本插件生成条目"是安全的。

          if (uidsToDelete.length > 0) {
                  await deleteLorebookEntries_ACU(primaryLorebookName, uidsToDelete);
              logDebug_ACU(`Deleted ${uidsToDelete.length} custom export entries (Legacy + Known).`);
          }
          
          // 每次更新时，我们重置 knownNames 列表（仅非外部导入模式）
          // 外部导入模式不维护 knownNames，避免影响第三方世界书
          if (!isImport) {
              if (isoPrefix) knownNames = knownNames.filter((name: string) => !name.startsWith(isoPrefix));
              else knownNames = knownNames.filter((name: string) => name.startsWith('ACU-'));
          }

          // [修复] 如果 mergedData 为空，清理完旧条目后直接返回，不再尝试创建新条目
          if (!mergedData) {
              logDebug_ACU('[CustomExport] mergedData 为空，已清理旧条目，跳过创建。');
              // 保存清理后的 knownNames
              if (!isImport) {
                  settings_ACU.knownCustomEntryNames = knownNames;
                  saveSettings_ACU();
              }
              return;
          }

          // 2. Create new entries
          const entriesToCreate: Record<string, any>[] = [];
          // [新增] 创建后 order 强制回写计划（按 comment 匹配 uid 再 setLorebookEntries）
          // 目的：防止创建接口把重复 order 自动改写，导致"同表行条目仍然各占一个深度"
          const postCreateOrderFixPlan: { comment: string; order: number; placement?: Record<string, any> }[] = [];
          // [新增] 用于合并同名条目的分组对象
          const mergedEntriesMap: Record<string, any> = {};
          
          // [FIX] 定义 newGeneratedNames 用于收集本次生成的名称
          const newGeneratedNames: string[] = [];

          // [FIX] 重新定义 tableKeys (之前的定义在 if 块内，这里无法访问)
          const tableKeys = getSortedSheetKeys_ACU(mergedData);
          
          // [新增] 为"自定义导出条目"分配不重叠的 order 段，避免不同表格的包裹/行条目互相穿插
          // 机制：严格按"用户手动顺序/模板顺序"分配，避免填表/读取后顺序漂移
          const sortedTableKeys = [...tableKeys];
          let nextCustomExportOrder = 10000; // 维持原本"自定义导出"大致优先级区间
          // [优化] 不允许重复 order：为每个条目分配唯一 order，并整体避开世界书现有 order
          const CUSTOM_EXPORT_ORDER_GAP = 1;
          const toIntOrFallback_ACU = (v: any, fb: number): number => {
              const n = parseInt(v, 10);
              return Number.isFinite(n) ? n : fb;
          };
          const calcPreferredBlockStart_ACU = (baseOrder: any, leadingSlots = 0, fallback = 1): number => {
              const o = toIntOrFallback_ACU(baseOrder, fallback);
              return Math.max(1, o - Math.max(0, toIntOrFallback_ACU(leadingSlots, 0)));
          };
          
          // [新增] 解析注入模板，提取用于前后包裹的常量条目内容
          const parseWrapperTemplate = (templateStr: string | null | undefined): { before: string; after: string } | null => {
              if (!templateStr || typeof templateStr !== 'string') return null;
              const markerIndex = templateStr.indexOf('$1');
              if (markerIndex === -1) return null;
              const before = templateStr.slice(0, markerIndex).trim();
              const after = templateStr.slice(markerIndex + 2).trim();
              if (!before && !after) return null;
              return { before, after };
          };

          // [新增] 统一的条目内容生成器，支持在包裹模式下忽略自定义模板
          const buildEntryContent = (entryName: string, tableData: string, template: string | null | undefined, ignoreTemplate = false, fallbackTemplate: string | null = null, isSplitMode = false): string => {
              let finalTemplate = ignoreTemplate ? null : template;
              if (!finalTemplate) {
                  if (fallbackTemplate) {
                      finalTemplate = fallbackTemplate;
                  } else if (isSplitMode) {
                      // 拆分模式下，不添加条目名称，只保留内容
                      finalTemplate = `$1`;
                  } else if (entryName === '重要人物表' || entryName === '总结表') {
                      finalTemplate = `# ${entryName}\n\n$1`;
                  } else {
                      finalTemplate = `# ${entryName}\n\n$1`;
                  }
              }
              return finalTemplate.replace('$1', tableData);
          };

          const buildMarkdownTableFromRows_ACU = (headerList: string[], rowList: any[]): string => {
              if (!Array.isArray(headerList) || headerList.length === 0) return '';
              const lines = [];
              lines.push(`| ${headerList.join(' | ')} |`);
              lines.push(`|${headerList.map(() => '---').join('|')}|`);
              (Array.isArray(rowList) ? rowList : []).forEach(row => {
                  const cells = headerList.map((_, idx) => {
                      const v = Array.isArray(row) ? row[idx] : '';
                      return v === null || v === undefined ? '' : String(v);
                  });
                  lines.push(`| ${cells.join(' | ')} |`);
              });
              return lines.join('\n');
          };

          const resolveExtraIndexSpec_ACU = (cfg: Record<string, any> | null, originalHeaders: string[], rawRows: any[][], defaultName: string) => {
              if (!cfg || cfg.extraIndexEnabled !== true) return null;
              if (!Array.isArray(originalHeaders) || originalHeaders.length === 0) return null;
              const selectedRaw = Array.isArray(cfg.extraIndexColumns) ? cfg.extraIndexColumns : [];
              const selectedCols = [...new Set(selectedRaw.filter(col => typeof col === 'string' && originalHeaders.includes(col)))];
              if (selectedCols.length === 0) return null;

              const modeMap = (cfg.extraIndexColumnModes && typeof cfg.extraIndexColumnModes === 'object')
                  ? cfg.extraIndexColumnModes
                  : {};
              const selectedMeta = selectedCols.map((col: string) => {
                  const idx = originalHeaders.indexOf(col);
                  const mode = (modeMap as Record<string, string>)[col] === 'index_only' ? 'index_only' : 'both';
                  return { name: col, idx, mode };
              }).filter(m => m.idx >= 0);
              if (selectedMeta.length === 0) return null;

              const indexCols = selectedMeta.map(m => m.name);
              const indexColIndexes = selectedMeta.map(m => m.idx);
              const indexOnlySet = new Set(selectedMeta.filter(m => m.mode === 'index_only').map(m => m.idx));
              const mainColIndexes = originalHeaders
                  .map((_, idx) => idx)
                  .filter(idx => !indexOnlySet.has(idx));
              const mainCols = mainColIndexes.map(idx => originalHeaders[idx]);
              const mapRowsByIndexes = (rows: any[][], indexes: number[]): string[][] => {
                  const safeRows = Array.isArray(rows) ? rows : [];
                  return safeRows.map(row => indexes.map(i => {
                      const v = Array.isArray(row) ? row[i] : '';
                      return v === null || v === undefined ? '' : String(v);
                  }));
              };

              return {
                  entryName: String(cfg.extraIndexEntryName || `${defaultName}-索引`).trim() || `${defaultName}-索引`,
                  indexCols,
                  indexRows: mapRowsByIndexes(rawRows, indexColIndexes),
                  mainCols,
                  mainRows: mapRowsByIndexes(rawRows, mainColIndexes),
              };
          };

          const buildExtraIndexEntryBlock_ACU = ({ exportPrefix, extraIndexSpec, templateStr, startOrder, placement, usedOrderSet, enabled = true, marker }: { exportPrefix: string; extraIndexSpec: any; templateStr?: string; startOrder: number; placement: Record<string, any>; usedOrderSet?: Set<any>; enabled?: boolean; marker?: Omit<ExternalCustomTableExportMarker_ACU, 'version' | 'kind' | 'role' | 'rowIndex'> }) => {
              if (!extraIndexSpec) return { entries: [], names: [], plans: [], nextOrder: startOrder, span: 0 };
              const cursor = allocOrder_ACU(usedOrderSet || usedOrders, startOrder, 1, 99999);
              const names = [];
              const plans = [];
              const entries = [];
              const fullTable = buildMarkdownTableFromRows_ACU(extraIndexSpec.indexCols, extraIndexSpec.indexRows);
              const fallbackTemplate = `# ${extraIndexSpec.entryName}\n\n$1`;
              // 自定义表格导出的附加索引条目：在注释名中加入统一标记，便于在世界书 UI 中识别为"数据库生成条目"并默认隐藏
              // [修复] 外部导入时只使用"外部导入-"前缀
              const mainComment = getImportEntryName(extraIndexSpec.entryName, marker ? { ...marker, role: 'index' } : undefined);
              const isCrossfireSummaryEntry = extraIndexSpec.entryName === '纪要索引';
              let mainContent = buildEntryContent(
                  extraIndexSpec.entryName,
                  fullTable,
                  templateStr,
                  false,
                  fallbackTemplate
              );
              if (!isImport && isCrossfireSummaryEntry && summaryVectorIndexModeEnabled && crossfireThresholdMet && didLastSummaryVectorRecallSucceed_ACU()) {
                  const existingEntry = allEntries.find(e => e.comment === mainComment);
                  if (existingEntry?.content) {
                      mainContent = existingEntry.content;
                      logDebug_ACU('[CustomExport] 交火模式已启用、已达门槛且上一轮召回成功，保留现有纪要索引召回内容，避免覆盖发送前召回结果。');
                  }
              } else if (!isImport && isCrossfireSummaryEntry && summaryVectorIndexModeEnabled && !didLastSummaryVectorRecallSucceed_ACU()) {
                  logDebug_ACU('[CustomExport] 交火模式已启用但上一轮召回未成功，纪要索引条目使用普通填表概览覆盖写入。');
              } else if (!isImport && isCrossfireSummaryEntry && summaryVectorIndexModeEnabled && !crossfireThresholdMet) {
                  logDebug_ACU('[CustomExport] 交火模式已启用但未达门槛，纪要索引条目使用普通填表数据，不保护现有内容。');
              }
              names.push(mainComment);
              const normalizedPlacement = normalizePlacementConfig_ACU(placement, DEFAULT_EXTRA_INDEX_PLACEMENT_ACU);
              plans.push({ comment: mainComment, order: cursor, placement: normalizedPlacement });
              // [修复] 0TK 模式仍持续控制"纪要索引"条目的 enabled；交火模式只控制内容保护，不接管 enabled。
              const finalEnabled = extraIndexSpec.entryName === '纪要索引' ? enabled : true;
              entries.push(applyPlacementToEntry_ACU({
                  comment: mainComment,
                  content: mainContent,
                  keys: [],
                  enabled: finalEnabled,
                  type: 'constant',
                  prevent_recursion: true,
                  order: cursor
              }, normalizedPlacement));

              return {
                  entries,
                  names,
                  plans,
                  nextOrder: cursor + 1,
                  span: entries.length,
              };
          };

          sortedTableKeys.forEach(sheetKey => {
              const table = mergedData[sheetKey];
              // Check for exportConfig
              // [修改] 增加 injectIntoWorldbook === false 的检查，如果被禁用，即使 enabled 为 true 也不导出
              if (!table || !table.exportConfig || !table.exportConfig.enabled) return;
              
              // [新增] 检查是否只导出索引条目（主条目不注入但索引条目启用）
              const mainEntryDisabled = table.exportConfig.injectIntoWorldbook === false;
              const hasExtraIndexEnabled = table.exportConfig.extraIndexEnabled === true;
              
              // 如果主条目和索引条目都不导出，则跳过
              if (mainEntryDisabled && !hasExtraIndexEnabled) return;

              const config = ensureExportConfigDefaults_ACU(table.exportConfig, table.name || sheetKey);
              const tableName = table.name;
              const sqlInjectionTemplate = isSqliteMode() && typeof config.sqlInjectionTemplate === 'string'
                  ? config.sqlInjectionTemplate.trim()
                  : '';
              const entryPlacement = normalizePlacementConfig_ACU(config.entryPlacement, DEFAULT_ENTRY_PLACEMENT_ACU);
              const extraIndexPlacement = normalizePlacementConfig_ACU(config.extraIndexPlacement, DEFAULT_EXTRA_INDEX_PLACEMENT_ACU);
              const visibleColumns = getSheetColumnProjection_ACU(table).visibleColumns.filter(column => column.sourceIndex > 0);
              const headers: string[] = visibleColumns.map(column => column.header);
              const rows = table.content.slice(1).map((row: any[]) => visibleColumns.map(column => row[column.sourceIndex]));
              const hasAnyNonEmptyExportCell_ACU = (row: any[]) => Array.isArray(row) && row.some((cell: any) => {
                  const text = cell === null || cell === undefined ? '' : String(cell);
                  return text.trim() !== '';
              });
              const effectiveRows = rows.filter(hasAnyNonEmptyExportCell_ACU);
              const extraIndexSpec = resolveExtraIndexSpec_ACU(
                  config,
                  headers,
                  effectiveRows,
                  config.entryName || tableName || '表格'
              );
              const mainHeaders = extraIndexSpec ? extraIndexSpec.mainCols : headers;
              const mainRows = extraIndexSpec ? extraIndexSpec.mainRows : effectiveRows;
              const markerBase = {
                  sheetKey,
                  tableName: String(tableName || sheetKey),
                  entryName: String(config.entryName || tableName || sheetKey),
              };
              
              // [新增] 检查是否有有效的索引条目数据
              const hasExtraIndex = hasExtraIndexEnabled && extraIndexSpec && extraIndexSpec.indexCols.length > 0 && extraIndexSpec.indexRows.length > 0;

              const wrapperParts = parseWrapperTemplate(config.injectionTemplate);
              const useWrapperEntries = !!wrapperParts;

              if (effectiveRows.length === 0 && !hasExtraIndex && !sqlInjectionTemplate) return; // 仅存在空白行且无模板时不注入任何表格相关条目

              // [新增] 如果主条目禁用但索引条目启用，只处理索引条目
              if (mainEntryDisabled && hasExtraIndex) {
                  // 只导出索引条目
                  const extraBlock = buildExtraIndexEntryBlock_ACU({
                      exportPrefix,
                      extraIndexSpec,
                      templateStr: config.extraIndexInjectionTemplate,
                      startOrder: toIntOrFallback_ACU(extraIndexPlacement.order, nextCustomExportOrder),
                      placement: extraIndexPlacement,
                      usedOrderSet: usedOrders,
                      enabled: extraIndexEntryEnabled,
                      marker: markerBase,
                  });
                  newGeneratedNames.push(...extraBlock.names);
                  postCreateOrderFixPlan.push(...extraBlock.plans);
                  entriesToCreate.push(...extraBlock.entries);
                  nextCustomExportOrder = extraBlock.nextOrder + CUSTOM_EXPORT_ORDER_GAP;
                  return; // 跳过主条目处理
              }

              if (sqlInjectionTemplate) {
                  const entryName = config.entryName || tableName;
                  let keys = config.keywords ? splitKeywordsByComma_ACU(config.keywords) : [];
                  if (config.entryType === 'keyword' && keys.length === 0) return;

                  const mainOrder = allocOrder_ACU(usedOrders, toIntOrFallback_ACU(entryPlacement.order, nextCustomExportOrder), 1, 99999);
                  const fullComment = getImportEntryName(entryName, { ...markerBase, entryName, role: 'main' });
                  newGeneratedNames.push(fullComment);
                  postCreateOrderFixPlan.push({ comment: fullComment, order: mainOrder, placement: entryPlacement });
                  entriesToCreate.push(applyPlacementToEntry_ACU({
                      comment: fullComment,
                      content: sqlInjectionTemplate,
                      keys,
                      enabled: true,
                      type: config.entryType || 'constant',
                      prevent_recursion: config.preventRecursion !== false,
                      order: mainOrder,
                  }, entryPlacement));

                  let nextOrder = mainOrder + CUSTOM_EXPORT_ORDER_GAP;
                  if (hasExtraIndex) {
                      const extraBlock = buildExtraIndexEntryBlock_ACU({
                          exportPrefix,
                          extraIndexSpec,
                          templateStr: config.extraIndexInjectionTemplate,
                          startOrder: toIntOrFallback_ACU(extraIndexPlacement.order, nextOrder),
                          placement: extraIndexPlacement,
                          usedOrderSet: usedOrders,
                          enabled: extraIndexEntryEnabled,
                          marker: markerBase,
                      });
                      newGeneratedNames.push(...extraBlock.names);
                      postCreateOrderFixPlan.push(...extraBlock.plans);
                      entriesToCreate.push(...extraBlock.entries);
                      nextOrder = extraBlock.nextOrder;
                  }
                  nextCustomExportOrder = nextOrder + CUSTOM_EXPORT_ORDER_GAP;
                  return;
              }

              // 准备表格数据内容 (Common logic)
              let tableContentMarkdown = "";
              if (config.splitByRow) {
                  // Will be handled inside loop
              } else {
                  // Whole table content
                  tableContentMarkdown = buildMarkdownTableFromRows_ACU(mainHeaders, mainRows);
              }

              if (config.splitByRow) {
                  // Split export: One entry per row
                  const rowEntries = [];
                  const hasWrapperBefore = !!(wrapperParts && wrapperParts.before);
                  const hasWrapperAfter = !!(wrapperParts && wrapperParts.after);
                  const use3DepthWrapperGroup = !!(useWrapperEntries && (hasWrapperBefore || hasWrapperAfter));
                  const needsHeader = (!use3DepthWrapperGroup && mainHeaders.length > 0);
                  const hasExtraIndexEntry = !!(extraIndexSpec && extraIndexSpec.indexCols.length > 0);
                  const blockSpan = (use3DepthWrapperGroup ? 3 : (needsHeader ? 2 : 1));
                  const leadingSlots = (use3DepthWrapperGroup && hasWrapperBefore) ? 1 : ((!useWrapperEntries && mainHeaders.length > 0) ? 1 : 0);
                  const preferredMainOrder = toIntOrFallback_ACU(entryPlacement.order, nextCustomExportOrder);
                  const preferredBlockStart = calcPreferredBlockStart_ACU(preferredMainOrder, leadingSlots, nextCustomExportOrder);
                  const baseOrder = allocConsecutiveOrderBlock_ACU(usedOrders, Math.max(1, blockSpan), preferredBlockStart, 1, 99999);
                  let orderCursor = baseOrder;
                  
                  // 准备表头markdown
                  const headerMarkdown = mainHeaders.length
                      ? `# ${tableName}\n\n${buildMarkdownTableFromRows_ACU(mainHeaders, [])}`
                      : `# ${tableName}`;

                  // 在拆分模式下，如果存在包裹模板，先追加前置常量条目（包含表头）
                  if (use3DepthWrapperGroup && hasWrapperBefore) {
                      const wrapperName = getImportEntryName(`${(config.entryName || tableName)}-包裹-上`, { ...markerBase, role: 'wrapper_before' });
                      newGeneratedNames.push(wrapperName);
                      postCreateOrderFixPlan.push({ comment: wrapperName, order: orderCursor, placement: entryPlacement });
                      const wrapperContent = [wrapperParts.before, headerMarkdown].filter(Boolean).join('\n\n').trim();
                      rowEntries.push(applyPlacementToEntry_ACU({
                          comment: wrapperName, content: wrapperContent, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: orderCursor++
                      }, entryPlacement));
                  } else if (!useWrapperEntries && mainHeaders.length > 0) {
                      const headerName = getImportEntryName(`${(config.entryName || tableName)}-表头`, { ...markerBase, role: 'header' });
                      newGeneratedNames.push(headerName);
                      postCreateOrderFixPlan.push({ comment: headerName, order: orderCursor, placement: entryPlacement });
                      rowEntries.push(applyPlacementToEntry_ACU({
                          comment: headerName, content: headerMarkdown, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: orderCursor++
                      }, entryPlacement));
                  }

                  const dataOrder = orderCursor++;
                  mainRows.forEach((rowData: any[], i: number) => {
                      const entryName = config.entryName ? `${config.entryName}-${i + 1}` : `${tableName}-${i + 1}`;
                      let keys: string[] = [];
                      if (config.keywords) {
                          const keywordList = splitKeywordsByComma_ACU(config.keywords);
                          keywordList.forEach((k: string) => {
                              const colIndex = headers.indexOf(k);
                              if (colIndex !== -1) {
                                  const rawRowData = rows[i] || [];
                                  const cellContent = rawRowData[colIndex];
                                  if (cellContent) { keys.push(...splitKeywordsByComma_ACU(cellContent)); }
                              } else { keys.push(k); }
                          });
                      }
                      if (config.entryType === 'keyword' && keys.length === 0) return;

                      const rowTableMarkdown = mainHeaders.length > 0 ? `| ${rowData.join(' | ')} |\n` : '';
                      const finalContent = buildEntryContent(entryName, rowTableMarkdown, config.injectionTemplate, useWrapperEntries, null, true);
                      const fullComment = getImportEntryName(entryName, { ...markerBase, role: 'row', rowIndex: i + 1 });
                      newGeneratedNames.push(fullComment);
                      postCreateOrderFixPlan.push({ comment: fullComment, order: dataOrder, placement: entryPlacement });
                      rowEntries.push(applyPlacementToEntry_ACU({
                          comment: fullComment, content: finalContent, keys: keys, enabled: true,
                          type: config.entryType || 'constant', prevent_recursion: config.preventRecursion !== false, order: dataOrder
                      }, entryPlacement));
                  });

                  if (use3DepthWrapperGroup && hasWrapperAfter) {
                      const wrapperName = getImportEntryName(`${(config.entryName || tableName)}-包裹-下`, { ...markerBase, role: 'wrapper_after' });
                      newGeneratedNames.push(wrapperName);
                      postCreateOrderFixPlan.push({ comment: wrapperName, order: orderCursor, placement: entryPlacement });
                      rowEntries.push(applyPlacementToEntry_ACU({
                          comment: wrapperName, content: wrapperParts.after, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: orderCursor++
                      }, entryPlacement));
                  }

                  if (hasExtraIndexEntry) {
                      const extraBlock = buildExtraIndexEntryBlock_ACU({
                          exportPrefix, extraIndexSpec, templateStr: config.extraIndexInjectionTemplate,
                          startOrder: toIntOrFallback_ACU(extraIndexPlacement.order, orderCursor),
                          placement: extraIndexPlacement, usedOrderSet: usedOrders, enabled: extraIndexEntryEnabled,
                          marker: markerBase,
                      });
                      newGeneratedNames.push(...extraBlock.names);
                      postCreateOrderFixPlan.push(...extraBlock.plans);
                      rowEntries.push(...extraBlock.entries);
                      orderCursor = extraBlock.nextOrder;
                  }

                  entriesToCreate.push(...rowEntries);
                  nextCustomExportOrder = orderCursor + CUSTOM_EXPORT_ORDER_GAP;

              } else {
                  if (extraIndexSpec) {
                      const entryName = config.entryName || tableName;
                      let keys = config.keywords ? splitKeywordsByComma_ACU(config.keywords) : [];
                      if (config.entryType === 'keyword' && keys.length === 0) return;

                      const hasWrapperBefore = !!(wrapperParts && wrapperParts.before);
                      const hasWrapperAfter = !!(wrapperParts && wrapperParts.after);
                      const useWrapperBlock = !!(useWrapperEntries && (hasWrapperBefore || hasWrapperAfter));
                      const needsHeader = (!useWrapperBlock && mainHeaders.length > 0);
                      const blockSize = (useWrapperBlock ? 2 : 0) + (needsHeader ? 1 : 0) + 1;
                      const leadingSlots = (useWrapperBlock && hasWrapperBefore) ? 1 : ((!useWrapperEntries && mainHeaders.length > 0) ? 1 : 0);
                      const preferredMainOrder = toIntOrFallback_ACU(entryPlacement.order, nextCustomExportOrder);
                      const preferredBlockStart = calcPreferredBlockStart_ACU(preferredMainOrder, leadingSlots, nextCustomExportOrder);
                      const baseOrder = allocConsecutiveOrderBlock_ACU(usedOrders, Math.max(1, blockSize), preferredBlockStart, 1, 99999);
                      let cursor = baseOrder;
                      const blockEntries = [];
                      const tableHeader = mainHeaders.length > 0
                          ? `# ${tableName}\n\n${buildMarkdownTableFromRows_ACU(mainHeaders, [])}`
                          : `# ${tableName}`;

                      if (useWrapperBlock && hasWrapperBefore) {
                          const wrapperName = getImportEntryName(`${entryName}-包裹-上`, { ...markerBase, entryName, role: 'wrapper_before' });
                          const wrapperContent = [wrapperParts.before, tableHeader].filter(Boolean).join('\n\n').trim();
                          newGeneratedNames.push(wrapperName);
                          postCreateOrderFixPlan.push({ comment: wrapperName, order: cursor, placement: entryPlacement });
                          blockEntries.push(applyPlacementToEntry_ACU({
                              comment: wrapperName, content: wrapperContent, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: cursor++
                          }, entryPlacement));
                      } else if (!useWrapperEntries && mainHeaders.length > 0) {
                          const headerName = getImportEntryName(`${entryName}-表头`, { ...markerBase, entryName, role: 'header' });
                          newGeneratedNames.push(headerName);
                          postCreateOrderFixPlan.push({ comment: headerName, order: cursor, placement: entryPlacement });
                          blockEntries.push(applyPlacementToEntry_ACU({
                              comment: headerName, content: tableHeader, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: cursor++
                          }, entryPlacement));
                      }

                      const mainBody = buildMarkdownTableFromRows_ACU(mainHeaders, mainRows);
                      const mainContent = buildEntryContent(entryName, mainBody, config.injectionTemplate, useWrapperBlock, '$1');
                      const fullComment = getImportEntryName(entryName, { ...markerBase, entryName, role: 'main' });
                      newGeneratedNames.push(fullComment);
                      postCreateOrderFixPlan.push({ comment: fullComment, order: cursor, placement: entryPlacement });
                      blockEntries.push(applyPlacementToEntry_ACU({
                          comment: fullComment, content: mainContent, keys: keys, enabled: true,
                          type: config.entryType || 'constant', prevent_recursion: config.preventRecursion !== false, order: cursor++
                      }, entryPlacement));

                      if (useWrapperBlock && hasWrapperAfter) {
                          const wrapperName = getImportEntryName(`${entryName}-包裹-下`, { ...markerBase, entryName, role: 'wrapper_after' });
                          newGeneratedNames.push(wrapperName);
                          postCreateOrderFixPlan.push({ comment: wrapperName, order: cursor, placement: entryPlacement });
                          blockEntries.push(applyPlacementToEntry_ACU({
                              comment: wrapperName, content: wrapperParts.after, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: cursor++
                          }, entryPlacement));
                      }

                      const extraBlock = buildExtraIndexEntryBlock_ACU({
                          exportPrefix, extraIndexSpec, templateStr: config.extraIndexInjectionTemplate,
                          startOrder: toIntOrFallback_ACU(extraIndexPlacement.order, cursor),
                          placement: extraIndexPlacement, usedOrderSet: usedOrders, enabled: extraIndexEntryEnabled,
                          marker: markerBase,
                      });
                      newGeneratedNames.push(...extraBlock.names);
                      postCreateOrderFixPlan.push(...extraBlock.plans);
                      blockEntries.push(...extraBlock.entries);
                      cursor = extraBlock.nextOrder;

                      entriesToCreate.push(...blockEntries);
                      nextCustomExportOrder = cursor + CUSTOM_EXPORT_ORDER_GAP;
                      return;
                  }

                  // Whole table export
                  const entryName = config.entryName || tableName;
                  let keys = config.keywords ? splitKeywordsByComma_ACU(config.keywords) : [];
                  
                  if (config.entryType === 'keyword' && keys.length === 0) return;

                  // [合并逻辑] 检查是否可以合并
                  const mergeKey = `${entryName}|${config.entryType || 'constant'}|${keys.sort().join(',')}${isImport ? `|${sheetKey}` : ''}`;
                  
                  if (!mergedEntriesMap[mergeKey]) {
                      mergedEntriesMap[mergeKey] = {
                          entryName: entryName, entryType: config.entryType || 'constant', keywords: keys,
                          preventRecursion: config.preventRecursion !== false, sheetKeys: [], tableContents: [], tableName: String(tableName || sheetKey),
                          injectionTemplate: config.injectionTemplate, wrapperParts: wrapperParts,
                          useWrapperEntries: useWrapperEntries, entryPlacement: entryPlacement
                      };
                  }
                  if (!mergedEntriesMap[mergeKey].wrapperParts && wrapperParts) {
                      mergedEntriesMap[mergeKey].wrapperParts = wrapperParts;
                      mergedEntriesMap[mergeKey].useWrapperEntries = useWrapperEntries;
                  }
                  if (!mergedEntriesMap[mergeKey].injectionTemplate && config.injectionTemplate) {
                      mergedEntriesMap[mergeKey].injectionTemplate = config.injectionTemplate;
                  }
                  if (!mergedEntriesMap[mergeKey].entryPlacement) {
                      mergedEntriesMap[mergeKey].entryPlacement = entryPlacement;
                  }
                  
                  mergedEntriesMap[mergeKey].sheetKeys.push(sheetKey);
                  if (!mergedEntriesMap[mergeKey].tableHeaders) {
                      mergedEntriesMap[mergeKey].tableHeaders = [];
                  }
                  mergedEntriesMap[mergeKey].tableHeaders.push({ name: tableName, headers: headers });
                  const rowsOnly = rows.map((row: any[]) => `| ${row.join(' | ')} |`).join('\n');
                  mergedEntriesMap[mergeKey].tableContents.push(rowsOnly);
                  
                  if (config.preventRecursion === false) {
                      mergedEntriesMap[mergeKey].preventRecursion = false;
                  }
              }
          });

          // Process Merged Entries
          Object.keys(mergedEntriesMap).forEach(key => {
              const group = mergedEntriesMap[key];
              const combinedTableData = group.tableContents.join('\n\n');

              const wrapperParts = group.useWrapperEntries ? group.wrapperParts : null;
              const useWrapperEntries = !!(group.useWrapperEntries && (wrapperParts?.before || wrapperParts?.after));
              const groupPlacement = normalizePlacementConfig_ACU(group.entryPlacement, DEFAULT_ENTRY_PLACEMENT_ACU);

              const blockEntries: Record<string, any>[] = [];
              const allHeadersContent = group.tableHeaders ? group.tableHeaders.map((th: { name: string; headers: string[] }) => {
                  return `# ${th.name}\n\n| ${th.headers.join(' | ')} |\n|${th.headers.map(() => '---').join('|')}|`;
              }).join('\n\n') : '';

              const needsHeader = (!useWrapperEntries && !!allHeadersContent);
              const blockSize = (useWrapperEntries ? 2 : 0) + (needsHeader ? 1 : 0) + 1;
              const leadingSlots = (useWrapperEntries && wrapperParts?.before) ? 1 : ((!useWrapperEntries && !!allHeadersContent) ? 1 : 0);
              const preferredMainOrder = toIntOrFallback_ACU(groupPlacement.order, nextCustomExportOrder);
              const preferredBlockStart = calcPreferredBlockStart_ACU(preferredMainOrder, leadingSlots, nextCustomExportOrder);
              const baseOrder = allocConsecutiveOrderBlock_ACU(usedOrders, Math.max(1, blockSize), preferredBlockStart, 1, 99999);
              let cursor = baseOrder;
              const groupMarker = {
                  sheetKey: String(group.sheetKeys[0] || ''),
                  tableName: String(group.tableName || ''),
                  entryName: String(group.entryName || ''),
              };
              const getMergedEntryComment_ACU = (name: string, role: ExternalCustomTableExportMarker_ACU['role']) => isImport
                  ? getImportEntryName(name, { ...groupMarker, role })
                  : `${exportPrefix}${name}`;

              if (useWrapperEntries && wrapperParts?.before) {
                  const wrapperName = getMergedEntryComment_ACU(`${group.entryName}-包裹-上`, 'wrapper_before');
                  newGeneratedNames.push(wrapperName);
                  const wrapperContent = [wrapperParts.before, allHeadersContent].filter(Boolean).join('\n\n').trim();
                  postCreateOrderFixPlan.push({ comment: wrapperName, order: cursor, placement: groupPlacement });
                  blockEntries.push(applyPlacementToEntry_ACU({
                      comment: wrapperName, content: wrapperContent, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: cursor++
                  }, groupPlacement));
              } else if (!useWrapperEntries && allHeadersContent) {
                  const headerName = getMergedEntryComment_ACU(`${group.entryName}-表头`, 'header');
                  newGeneratedNames.push(headerName);
                  postCreateOrderFixPlan.push({ comment: headerName, order: cursor, placement: groupPlacement });
                  blockEntries.push(applyPlacementToEntry_ACU({
                      comment: headerName, content: allHeadersContent, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: cursor++
                  }, groupPlacement));
              }

              const finalContent = buildEntryContent(group.entryName, combinedTableData, group.injectionTemplate, useWrapperEntries, '$1');
              const fullComment = getMergedEntryComment_ACU(group.entryName, 'main');
              newGeneratedNames.push(fullComment);
              postCreateOrderFixPlan.push({ comment: fullComment, order: cursor, placement: groupPlacement });
              blockEntries.push(applyPlacementToEntry_ACU({
                  comment: fullComment, content: finalContent, keys: group.keywords, enabled: true,
                  type: group.entryType, prevent_recursion: group.preventRecursion, order: cursor++
              }, groupPlacement));

              if (useWrapperEntries && wrapperParts?.after) {
                  const wrapperName = getMergedEntryComment_ACU(`${group.entryName}-包裹-下`, 'wrapper_after');
                  newGeneratedNames.push(wrapperName);
                  postCreateOrderFixPlan.push({ comment: wrapperName, order: cursor, placement: groupPlacement });
                  blockEntries.push(applyPlacementToEntry_ACU({
                      comment: wrapperName, content: wrapperParts.after, keys: [], enabled: true, type: 'constant', prevent_recursion: true, order: cursor++
                  }, groupPlacement));
              }

              entriesToCreate.push(...blockEntries);
              nextCustomExportOrder = cursor + CUSTOM_EXPORT_ORDER_GAP;
          });

          if (entriesToCreate.length > 0) {
                  await createLorebookEntries_ACU(primaryLorebookName, entriesToCreate);
              logDebug_ACU(`Successfully created ${entriesToCreate.length} new custom export entries.`);
              // [兜底] 创建完成后强制回写 order（通过 comment 找 uid）
              if (postCreateOrderFixPlan.length > 0) {
                  try {
                      const latest = await getLorebookEntries_ACU(primaryLorebookName);
                      const byComment = new Map();
                      latest.forEach((e: any) => { if (e?.comment) byComment.set(e.comment, e); });
                      const updates: Record<string, any>[] = [];
                      postCreateOrderFixPlan.forEach((p) => {
                          const e = byComment.get(p.comment);
                          if (e?.uid != null && Number.isFinite(p.order)) {
                              const fixed = applyPlacementToEntry_ACU({ uid: e.uid, order: p.order }, p.placement || DEFAULT_ENTRY_PLACEMENT_ACU);
                              updates.push(fixed);
                          }
                      });
                      if (updates.length > 0) {
                          await setLorebookEntries_ACU(primaryLorebookName, updates);
                      }
                  } catch (e) {
                      logWarn_ACU('[CustomExportOrderFix] Failed to enforce grouped orders for split exports:', e);
                  }
              }
          }
          
          // [新增] 更新并保存 knownCustomEntryNames（外部导入模式不写入，避免绑定第三方世界书）
          if (!isImport) {
          settings_ACU.knownCustomEntryNames = [...knownNames, ...newGeneratedNames];
          settings_ACU.knownCustomEntryNames = [...new Set(settings_ACU.knownCustomEntryNames)];
          saveSettings_ACU();
          logDebug_ACU(`Updated knownCustomEntryNames. Count: ${settings_ACU.knownCustomEntryNames.length}`);
          }

      } catch (error) {
          // not-found 属于目标世界书重命名/切换期间的瞬态形态：导出条目下次触发会重建，
          // 只记 warn；其余失败仍按 error 上报。
          if (classifyLorebookReadError_ACU(error) === 'lorebook_not_found') {
              logWarn_ACU('Custom table export skipped: target lorebook not found (likely renamed or switching).', error);
          } else {
              logError_ACU('Failed to update custom table export entries:', error);
          }
      }
  }
