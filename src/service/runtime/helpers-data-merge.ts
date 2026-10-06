/**
 * service/runtime/helpers-data-merge.ts — 数据合并/格式化/首楼初始化/阈值
 * 从 helpers-remaining.ts 拆出
 */
import { deriveTemplatePresetNameForImport_ACU } from '../../shared/template-preset-utils';
import { TABLE_ORDER_FIELD_ACU } from '../../shared/constants';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, independentTableStates_ACU, settings_ACU, suppressWorldbookInjectionInGreeting_ACU, _set_suppressWorldbookInjectionInGreeting_ACU, _set_currentJsonTableData_ACU } from './state-manager';
import { isSqliteMode } from '../table/storage-mode';
import { getChatArray_ACU, saveChatToHost_ACU } from '../../data/gateways/chat-gateway';
import { applyTemplateScopeForCurrentChat_ACU, saveSettings_ACU } from '../settings/settings-service';
import { buildChatSheetGuideDataFromTemplateObj_ACU, ensureStableRowIdsForSheetContent_ACU, getChatSheetGuideDataForIsolationKey_ACU, getSortedSheetKeys_ACU, materializeDataFromSheetGuide_ACU, reorderDataBySheetKeys_ACU, sanitizeTemplateSnapshotForChat_ACU, setChatSheetGuideDataForIsolationKey_ACU } from '../template/chat-scope';
import { deleteAllGeneratedEntries_ACU } from '../worldbook/pipeline';
import { ensureSheetOrderNumbers_ACU, isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU, logWarn_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { getTemplateSheetKeys_ACU } from '../template/chat-scope';
import { upsertTemplatePreset_ACU } from '../template/template-preset-service';
import { readIsolatedTagData_ACU, readLegacyIndependentData_ACU, readLegacyStandardData_ACU, readLegacySummaryData_ACU, readModifiedKeys_ACU, readUpdateGroupKeys_ACU, readMessageIdentity_ACU, isLegacyMatchForIsolation_ACU } from '../../data/repositories/chat-message-data-repo';
import { applyTableDelta_ACU, isDeltaTagData_ACU, isCheckpointTagData_ACU } from '../table/table-delta';
import { isV2TagData_ACU, resolveTableStorageStrategy_ACU } from '../table/storage-strategy-resolver';
import { loadTableStateFromFramesV2_ACU } from '../table/storage-frame-v2-replay';
import { persistTableMutationLogV2_ACU } from '../table/storage-frame-v2-persist';
import { migrateLegacyStorageToV2OnLoad_ACU } from '../table/storage-v2-migration';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { normalizeCanonicalTableRows_ACU, restoreLegacyRowIdentity_ACU } from '../../shared/canonical-row-normalizer';
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../shared/stable-row-id-allocator';
import { getSheetColumnProjection_ACU } from '../../shared/ddl-utils';
import { canonicalizeDisplayName_ACU } from '../../shared/sheet-identity';
import { applyGuideMetadataToSheet_ACU, isSameSheetHeader_ACU } from '../template/guide-metadata-overlay';
import { repairLegacyAutoMergedRowTails_ACU, repairLegacyOrphanIdentityColumn_ACU } from '../../shared/canonical-row-normalizer';

/**
 * Legacy entry point retained for callers that need in-place normalization.
 *
 * 契约（见 canonical-row-normalizer.ts）：normalizeCanonicalTableRows_ACU 按现行
 * 协议把"空 row_id"当作删除语义，而 xing～spv7.9 时代的数据行按物理位置寻址、
 * row_id 列为 null/缺失——历史读路径必须先经 restoreLegacyRowIdentity_ACU 修复
 * 行身份（只给无身份的行补 ID，已有 row_id 的行保持不变，幂等），否则旧数据的
 * 全部真实行会在规范化时被当作删除剥掉。
 */
export function migrateContentNullToRowId(data: Record<string, any> | null): Record<string, any> | null {
    restoreLegacyRowIdentity_ACU(data);
    normalizeCanonicalTableRows_ACU(data);
    return data;
}

  function hasUsableSheetGuide_ACU(sheetGuideData: any): boolean {
      return !!(sheetGuideData && typeof sheetGuideData === 'object' && Object.keys(sheetGuideData).some(k => k.startsWith('sheet_')));
  }

  function isSheetAllowedByGuide_ACU(sheetKey: string, sheet: any, guideData: any, allowedKeys: Set<string>): boolean {
      if (allowedKeys.has(sheetKey)) return true;
      const canonicalName = canonicalizeDisplayName_ACU(sheet?.name);
      if (!canonicalName || !guideData || typeof guideData !== 'object') return false;
      return Object.keys(guideData).some(key => key.startsWith('sheet_')
          && canonicalizeDisplayName_ACU(guideData[key]?.name) === canonicalName);
  }

  /**
   * 表中是否存在真实数据行（表头之外的行）。
   * 全版本兼容读取契约：带真实行的表在任何读路径上都不允许被静默丢弃，
   * 无论它是否匹配当前模板/指导表（guide 过滤只允许拦截无行的占位表）。
   */
  function sheetHasRealRows_ACU(sheet: any): boolean {
      return Array.isArray(sheet?.content) && sheet.content.length > 1;
  }

  /**
   * 将 Sheet Guide 的结构/元数据叠加到合并数据上。
   *
   * structuralAuthority 决定结构权归属：
   * - 'data'：checkpoint/历史数据持结构权（V2 路径）。guide 只叠加非结构元数据；
   *   表头不一致时保留历史结构，不 padding、不截断、不抛错，仅记录 warning，
   *   并拒绝继承该表的 guide sourceData.ddl。
   * - 'guide'：guide 持结构权（legacy-v1 路径），行为与旧版一致（含 padding）。
   *
   * 返回 { data, quarantinedSheetKeys, warnings }：
   * - data：合并结果（guide 键集驱动过滤与排序语义不变）。
   * - quarantinedSheetKeys：单表处理异常被隔离的表键，不会拖垮整体加载。
   * - warnings：结构不一致等可定位的结构性提示。
   */
  function mergeSheetGuideStructureIntoData_ACU(
      mergedData: Record<string, any>,
      sheetGuideData: any,
      options: { structuralAuthority: 'data' | 'guide'; templateSnapshot?: Record<string, any> | null } = { structuralAuthority: 'guide' },
  ): { data: Record<string, any>; quarantinedSheetKeys: string[]; warnings: string[] } {
      const guided = materializeDataFromSheetGuide_ACU(sheetGuideData, { includeSeedRows: false });
      const guideKeys = getSortedSheetKeys_ACU(guided, { ignoreChatGuide: true, includeMissingFromGuide: true,
          templateSnapshot: options.templateSnapshot });
      const historicalKeysByCanonicalName = new Map<string, string[]>();
      Object.entries(mergedData).forEach(([key, sheet]: [string, any]) => {
          if (!key.startsWith('sheet_') || !sheet || typeof sheet !== 'object') return;
          const canonicalName = canonicalizeDisplayName_ACU(sheet.name);
          if (!canonicalName) return;
          const keys = historicalKeysByCanonicalName.get(canonicalName) || [];
          keys.push(key);
          historicalKeysByCanonicalName.set(canonicalName, keys);
      });
      const quarantinedSheetKeys: string[] = [];
      const warnings: string[] = [];
      const consumedHistoricalKeys = new Set<string>();
      guideKeys.forEach(k => {
          if (!k || !k.startsWith('sheet_')) return;
          // 本轮消费的历史 key：catch 兜底需要把它释放回"未消费"集合，
          // 让末尾的兼容携带循环按原 key 保留历史数据（隔离只丢 guide 表壳，不丢数据）。
          let consumedKeyThisGuide: string | null = null;
          try {
              const guideSheet = guided[k];
              const canonicalName = canonicalizeDisplayName_ACU(guideSheet?.name);
              const historicalKeys = canonicalName ? (historicalKeysByCanonicalName.get(canonicalName) || []) : [];
              // key 同一性优先于名字匹配：历史数据与 guide 使用同一 sheetKey 时，
              // 即使显示名被改过也必须继承，否则改名会导致数据被静默丢弃。
              const directKeyMatch = (mergedData[k] && typeof mergedData[k] === 'object') ? k : null;
              if (!directKeyMatch && historicalKeys.length > 1) {
                  logWarn_ACU(`[Merge] 指导表「${guideSheet?.name || k}」匹配多个历史 Sheet (${historicalKeys.join(', ')})，拒绝自动继承。`);
              }
              const historicalKey = directKeyMatch ?? (historicalKeys.length === 1 ? historicalKeys[0] : null);
              const hist = historicalKey ? mergedData[historicalKey] : undefined;
              if (hist && typeof hist === 'object') {
                  consumedHistoricalKeys.add(historicalKey);
                  consumedKeyThisGuide = historicalKey;
                  const next = JSON.parse(JSON.stringify(hist));
                  next.uid = k;

                  const guideHeader = (guideSheet && Array.isArray(guideSheet.content) && Array.isArray(guideSheet.content[0]))
                      ? guideSheet.content[0]
                      : null;
                  const histHeader = Array.isArray(next.content) && Array.isArray(next.content[0])
                      ? next.content[0]
                      : null;

                  if (options.structuralAuthority === 'data') {
                      // ── V2：checkpoint 持结构权 ──
                      // content 原样保留：不覆盖表头、不 padding、不截断。
                      if (!Array.isArray(next.content) || next.content.length === 0) {
                          next.content = [histHeader || ['row_id']];
                      }
                      const headerMatches = !!guideHeader && !!histHeader && isSameSheetHeader_ACU(guideHeader, histHeader);
                      if (guideHeader && histHeader && !headerMatches) {
                          const msg = `[Merge] 表「${String(next.name || guideSheet?.name || k)}」(${k}) 的 Sheet Guide 表头与历史权威数据不一致，`
                              + `已保留历史结构：guide=${guideHeader.length} 列, data=${histHeader.length} 列。`
                              + `如需变更列结构，请通过模板提交触发 schema migration。`;
                          logWarn_ACU(msg);
                          warnings.push(msg);
                      }
                      applyGuideMetadataToSheet_ACU(next, guideSheet, { inheritDdl: headerMatches });
                      if (Array.isArray(guideSheet?.seedRows)) next.seedRows = JSON.parse(JSON.stringify(guideSheet.seedRows));
                      guided[k] = next;
                  } else {
                      // ── legacy-v1：guide 持结构权（含 padding），结构冲突时降级为历史结构权 ──
                      // 全版本兼容读取契约：guide 表头非法（缺 row_id 首列）或历史行比 guide 表头宽
                      // （旧模板列更多，截断丢格、padding 无意义）时，不 throw、不隔离——该表退回与
                      // V2 分支一致的"保留历史结构 + 叠加 guide 非结构元数据"处理，数据行原样保留。
                      const guideHeaderValid = !guideHeader || String(guideHeader[0] ?? '') === 'row_id';
                      const hasOverwideRow = !!guideHeader && Array.isArray(next.content)
                          && next.content.slice(1).some((row: unknown) => Array.isArray(row) && row.length > guideHeader.length);
                      if (!guideHeaderValid || hasOverwideRow) {
                          if (!Array.isArray(next.content) || next.content.length === 0) {
                              next.content = [histHeader || ['row_id']];
                          }
                          applyGuideMetadataToSheet_ACU(next, guideSheet, { inheritDdl: false });
                          if (Array.isArray(guideSheet?.seedRows)) next.seedRows = JSON.parse(JSON.stringify(guideSheet.seedRows));
                          const reason = !guideHeaderValid
                              ? `Sheet Guide 表头缺少 row_id 首列`
                              : `历史行宽度（最大 ${Math.max(...next.content.slice(1).map((row: unknown) => Array.isArray(row) ? row.length : 0))} 列）超过 Sheet Guide 表头（${guideHeader!.length} 列）`;
                          const msg = `[Merge] 表「${String(next.name || guideSheet?.name || k)}」(${k}) ${reason}，`
                              + `已降级保留历史结构（数据行不截断、不丢弃）。如需变更列结构，请通过模板提交完成迁移。`;
                          logWarn_ACU(msg);
                          warnings.push(msg);
                          guided[k] = next;
                      } else {
                          if (guideSheet?.name) next.name = guideSheet.name;
                          if (guideSheet?.sourceData) next.sourceData = JSON.parse(JSON.stringify(guideSheet.sourceData));
                          if (guideSheet?.updateConfig) next.updateConfig = JSON.parse(JSON.stringify(guideSheet.updateConfig));
                          if (guideSheet?.exportConfig) next.exportConfig = JSON.parse(JSON.stringify(guideSheet.exportConfig));
                          if (!Array.isArray(next.content)) next.content = guideHeader ? [guideHeader] : [['row_id']];
                          if (guideHeader) {
                              next.content[0] = guideHeader;
                              const targetLen = guideHeader.length;
                              for (let r = 1; r < next.content.length; r++) {
                                  const row = next.content[r];
                                  if (!Array.isArray(row)) continue;
                                  while (row.length < targetLen) row.push(null);
                              }
                          }
                          if (Number.isFinite(guideSheet?.[TABLE_ORDER_FIELD_ACU])) next[TABLE_ORDER_FIELD_ACU] = Math.trunc(guideSheet[TABLE_ORDER_FIELD_ACU]);
                          if (Array.isArray(guideSheet?.seedRows)) next.seedRows = JSON.parse(JSON.stringify(guideSheet.seedRows));
                          guided[k] = next;
                      }
                  }
              } else {
                  // guide-only 表（checkpoint 中不存在）：guide 是唯一结构来源。
                  if (options.structuralAuthority === 'data') {
                      // V2：校验 row_id 首列后完整物化 guide（含 sourceData.ddl）。
                      const guideHeader = (guideSheet && Array.isArray(guideSheet.content) && Array.isArray(guideSheet.content[0]))
                          ? guideSheet.content[0]
                          : null;
                      if (guideHeader && String(guideHeader[0] ?? '') !== 'row_id') {
                          throw new Error(`Sheet Guide 表头缺少 row_id 首列：${String(guideSheet.uid || guideSheet.name || k)}`);
                      }
                  }
                  if (Number.isFinite(guideSheet?.[TABLE_ORDER_FIELD_ACU])) {
                      guided[k][TABLE_ORDER_FIELD_ACU] = Math.trunc(guideSheet[TABLE_ORDER_FIELD_ACU]);
                  }
              }
          } catch (e) {
              // 读宽容契约：guide 合并失败只隔离 guide 表壳，不允许连带丢历史数据。
              // 释放本轮已消费的历史 key，末尾的兼容携带循环会按原 key 原样保留该表。
              if (consumedKeyThisGuide) consumedHistoricalKeys.delete(consumedKeyThisGuide);
              logError_ACU(`[Merge] 表「${k}」合并失败，已隔离 guide 表壳（历史数据按全版本兼容模式原样保留）：`, e);
              delete guided[k];
              quarantinedSheetKeys.push(k);
          }
      });

      // ── 全版本兼容携带：未被任何 guide 表消费的历史表不允许静默丢弃 ──
      // structuralAuthority='data'（V2 checkpoint 权威）：checkpoint 中存在即有效，全部携带；
      // structuralAuthority='guide'（legacy-v1）：仅携带含真实数据行的表——无行的旧模板
      // 占位表继续按"切换模板后不复活"的既有语义丢弃。
      Object.keys(mergedData).forEach(historicalKey => {
          if (!historicalKey.startsWith('sheet_')) return;
          const sheet = mergedData[historicalKey];
          if (!sheet || typeof sheet !== 'object') return;
          if (consumedHistoricalKeys.has(historicalKey)) return;
          if (guided[historicalKey]) return; // key 已被消费或被 guide 占用（direct key match 已优先消费，此分支仅防御）
          const shouldCarry = options.structuralAuthority === 'data' || sheetHasRealRows_ACU(sheet);
          if (!shouldCarry) return;
          guided[historicalKey] = JSON.parse(JSON.stringify(sheet));
          const msg = `[Merge] 表「${String(sheet.name || historicalKey)}」(${historicalKey}) 不在当前模板/指导表中，已按全版本兼容模式保留（数据行不丢弃）。`;
          logWarn_ACU(msg);
          warnings.push(msg);
      });
      return { data: guided, quarantinedSheetKeys, warnings };
  }

  export async function mergeAllIndependentTablesLegacyV1_ACU(snapshot?: {
      chat: any[]; isolationKey: string; sheetGuideData: any; templateSheetKeys: string[];
      isolationConfig: { enabled: boolean; code: string }; templateData: Record<string, any>;
  }) {
      // 桥接只消费显式快照；诊断和调度写入仅发生在调用内存，不触碰普通运行时。
      const tableStates = snapshot ? {} as typeof independentTableStates_ACU : independentTableStates_ACU;
      const registerSheets = snapshot ? (_data: unknown): void => undefined : registerMergeSourceSheets_ACU;
      const registerDeltas = snapshot ? (_data: unknown): void => undefined : registerMergeSourceDeltaKeys_ACU;
      // 源带行表清单：每次合并从零开始登记，登记发生在读取点的任何过滤之前，
      // 使迁移保险闸消费的清单与合并实际读到的源严格同源（消除独立扫描的语义漂移）。
      if (!snapshot) lastMergeSourceInventory = new Map<string, string>();
      const chat = snapshot ? snapshot.chat : getChatArray_ACU();
      if (!chat || chat.length === 0) {
          logDebug_ACU('Cannot merge data: Chat history is empty.');
          return null;
      }

      // [数据隔离核心] 获取当前隔离标签键名
      const currentIsolationKey = snapshot ? snapshot.isolationKey : getCurrentIsolationKey_ACU();
      logDebug_ACU(`[Merge] Loading data for isolation key: [${currentIsolationKey || '无标签'}]`);

      // [新增] 聊天级"空白指导表"：一旦存在，本聊天合并/显示顺序都按指导表，不再按模板
      // 注意：该指导表按隔离标签分槽，因此切换标识时可拥有不同的"参数/表头/顺序总指导"
      const sheetGuideData = snapshot ? snapshot.sheetGuideData : getChatSheetGuideDataForIsolationKey_ACU(currentIsolationKey);
      const hasSheetGuide = hasUsableSheetGuide_ACU(sheetGuideData);

      // [新增] 获取当前模板/指导表的表格键列表，用于过滤非当前模板的数据
      // 优先使用指导表（如果存在），否则使用当前模板
      // 这样可以确保：切换/导入新模板后，只读取当前模板中存在的表格数据
      const templateSheetKeys = (() => {
          if (snapshot) return snapshot.templateSheetKeys;
          if (hasSheetGuide) {
              // 存在指导表：使用指导表的表格键（指导表已在导入/切换模板时更新）
              return Object.keys(sheetGuideData).filter(k => k.startsWith('sheet_'));
          }
          // 不存在指导表：使用当前模板的表格键
          return getTemplateSheetKeys_ACU();
      })();
      const templateSheetKeySet = new Set(templateSheetKeys);
      logDebug_ACU(`[Merge] Template/Guide filter: ${templateSheetKeys.length} tables allowed (${hasSheetGuide ? 'guide' : 'template'})`);

      // 1. [优化] 不使用模板作为基础，动态收集聊天记录中的所有实际数据
      let mergedData: Record<string, any> = {};
      const foundSheets: Record<string, boolean> = {};
      // 收集 delta 楼层的增量数据（逆序收集，后续正序叠加）
      const pendingDeltas: { index: number; tagData: any }[] = [];

      for (let i = chat.length - 1; i >= 0; i--) {
          const message = chat[i];
          if (message.is_user) continue;

          // [优先级1] 检查新版按标签分组存储
          const tagData = readIsolatedTagData_ACU(message, currentIsolationKey);
          if (tagData) {
              // delta 楼层：收集增量数据，稍后正序叠加
              if (isDeltaTagData_ACU(tagData)) {
                  // 清单登记：delta 槽的增量 key 与（畸形混合形态下可能存在的）independentData
                  // 带行表都会被 cleanup 删除，闸门必须看到它们。
                  registerDeltas(tagData.incrementalData);
                  registerSheets(tagData.independentData);
                  if (tagData.incrementalData && Object.keys(tagData.incrementalData).length > 0) {
                      pendingDeltas.push({ index: i, tagData });
                  }
                  continue;
              }

              // checkpoint / legacy 楼层：使用现有的 first-write-wins 逻辑
              const independentData = tagData.independentData || {};
              registerSheets(independentData);
              // 防御历史畸形 tracking 值：契约要求 string[]，但早期坏数据可能写入
              // `{}` 等 truthy 非数组；直接 `|| []` 无法兜底，会在下方 `.includes` 抛错。
              const modifiedKeys = Array.isArray(tagData.modifiedKeys) ? tagData.modifiedKeys : [];
              const updateGroupKeys = Array.isArray(tagData.updateGroupKeys) ? tagData.updateGroupKeys : [];

              Object.keys(independentData).forEach(storedSheetKey => {
                  // [全版本兼容] guide 过滤只拦截无真实行的占位表；带行数据的表永不静默丢弃
                  if (!isSheetAllowedByGuide_ACU(storedSheetKey, independentData[storedSheetKey], hasSheetGuide ? sheetGuideData : null, templateSheetKeySet)
                      && !sheetHasRealRows_ACU(independentData[storedSheetKey])) {
                      logDebug_ACU(`[Merge] Skipping sheet [${storedSheetKey}] - not in current template/guide`);
                      return;
                  }
    if (!foundSheets[storedSheetKey]) {
                      mergedData[storedSheetKey] = JSON.parse(JSON.stringify(independentData[storedSheetKey]));
                      foundSheets[storedSheetKey] = true;

                      // [修复] 如果数据来自基底状态消息（seedGreeting 写入的模板初始数据），
                      // 在 sheet 上标记 _acu_from_base_state，供 SqlTableService.loadFromChat 区分
                      // "基底数据"和"AI 真正填写的数据"，避免因基底数据提前建表
                      if (tagData._acu_base_state === GREETING_LOCAL_BASE_STATE_MARKER_ACU) {
                          mergedData[storedSheetKey]._acu_from_base_state = true;
                      }

                      // 更新表格状态
                      let wasUpdated = false;
                      if (updateGroupKeys.length > 0 && modifiedKeys.length > 0) {
                          wasUpdated = updateGroupKeys.includes(storedSheetKey);
                      } else if (modifiedKeys.length > 0) {
                          wasUpdated = modifiedKeys.includes(storedSheetKey);
                      } else {
                          wasUpdated = true;
                      }

                      if (wasUpdated) {
                          if (!tableStates[storedSheetKey]) {
                              tableStates[storedSheetKey] = {};
                          }
                          const currentAiFloor = chat.slice(0, i + 1).filter(m => !m.is_user).length;
                          tableStates[storedSheetKey].lastUpdatedAiFloor = currentAiFloor;
                      }
                  }
              });
          }

          // [优先级2] 兼容旧版存储格式 - 严格匹配隔离标签
          // [数据隔离核心逻辑] 无标签也是标签的一种，严格隔离不同标签的数据
          const isolationConfig = snapshot ? snapshot.isolationConfig : { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode };
          const isLegacyMatch = isLegacyMatchForIsolation_ACU(message, isolationConfig);

          if (isLegacyMatch) {
              // 检查旧版独立数据格式
              const legacyIndepData = readLegacyIndependentData_ACU(message);
              if (legacyIndepData) {
                  const independentData = legacyIndepData;
                  registerSheets(independentData);
                  const modifiedKeys = readModifiedKeys_ACU(message);
                  const updateGroupKeys = readUpdateGroupKeys_ACU(message);

                  Object.keys(independentData).forEach(storedSheetKey => {
                      // [全版本兼容] guide 过滤只拦截无真实行的占位表；带行数据的表永不静默丢弃
                      if (!isSheetAllowedByGuide_ACU(storedSheetKey, independentData[storedSheetKey], hasSheetGuide ? sheetGuideData : null, templateSheetKeySet)
                          && !sheetHasRealRows_ACU(independentData[storedSheetKey])) {
                          logDebug_ACU(`[Merge] Skipping sheet [${storedSheetKey}] (legacy) - not in current template/guide`);
                          return;
                      }
                      if (!foundSheets[storedSheetKey]) {
                          mergedData[storedSheetKey] = JSON.parse(JSON.stringify(independentData[storedSheetKey]));
                          foundSheets[storedSheetKey] = true;

                          let wasUpdated = false;
                          if (updateGroupKeys.length > 0 && modifiedKeys.length > 0) {
                              wasUpdated = updateGroupKeys.includes(storedSheetKey);
                          } else if (modifiedKeys.length > 0) {
                              wasUpdated = modifiedKeys.includes(storedSheetKey);
                          } else {
                              wasUpdated = true;
                          }

                          if (wasUpdated) {
                              if (!tableStates[storedSheetKey]) tableStates[storedSheetKey] = {};
                              const currentAiFloor = chat.slice(0, i + 1).filter(m => !m.is_user).length;
                              tableStates[storedSheetKey].lastUpdatedAiFloor = currentAiFloor;
                          }
                      }
                  });
              }

              // 检查旧版标准表/总结表格式
              // [全版本兼容·错字段宽容] Data 字段按约定只放标准表、SummaryData 只放总结表，
              // 但历史版本存在写错字段的形态（总结表落进 Data / 标准表落进 SummaryData）。
              // 带真实行的表无论落在哪个字段都不允许静默丢弃：字段判定不满足但有行时
              // 仍按 first-write-wins 收取并记 warning。
              const legacyStdData = readLegacyStandardData_ACU(message);
              if (legacyStdData) {
                  const standardData: any = legacyStdData;
                  registerSheets(standardData);
                  Object.keys(standardData).forEach(k => {
                      if (!k.startsWith('sheet_') || !standardData[k] || typeof standardData[k] !== 'object') return;
                      // [全版本兼容] guide 过滤只拦截无真实行的占位表；带行数据的表永不静默丢弃
                      if (!isSheetAllowedByGuide_ACU(k, standardData[k], hasSheetGuide ? sheetGuideData : null, templateSheetKeySet)
                          && !sheetHasRealRows_ACU(standardData[k])) {
                          return;
                      }
                      if (foundSheets[k]) return;
                      const matchesExpectedField = Boolean(standardData[k].name) && !isSummaryOrOutlineTable_ACU(standardData[k].name);
                      if (!matchesExpectedField) {
                          if (!sheetHasRealRows_ACU(standardData[k])) return;
                          logWarn_ACU(`[Merge] 表「${String(standardData[k].name || k)}」(${k}) 落在旧版标准表字段但不满足字段约定，含真实数据行，已按错字段宽容模式收取。`);
                      }
                      mergedData[k] = JSON.parse(JSON.stringify(standardData[k]));
                      foundSheets[k] = true;
                      if (!tableStates[k]) tableStates[k] = {};
                      const currentAiFloor = chat.slice(0, i + 1).filter(m => !m.is_user).length;
                      tableStates[k].lastUpdatedAiFloor = currentAiFloor;
                  });
              }
              const legacySumData = readLegacySummaryData_ACU(message);
              if (legacySumData) {
                  const summaryData: any = legacySumData;
                  registerSheets(summaryData);
                  Object.keys(summaryData).forEach(k => {
                      if (!k.startsWith('sheet_') || !summaryData[k] || typeof summaryData[k] !== 'object') return;
                      // [全版本兼容] guide 过滤只拦截无真实行的占位表；带行数据的表永不静默丢弃
                      if (!isSheetAllowedByGuide_ACU(k, summaryData[k], hasSheetGuide ? sheetGuideData : null, templateSheetKeySet)
                          && !sheetHasRealRows_ACU(summaryData[k])) {
                          return;
                      }
                      if (foundSheets[k]) return;
                      const matchesExpectedField = Boolean(summaryData[k].name) && isSummaryOrOutlineTable_ACU(summaryData[k].name);
                      if (!matchesExpectedField) {
                          if (!sheetHasRealRows_ACU(summaryData[k])) return;
                          logWarn_ACU(`[Merge] 表「${String(summaryData[k].name || k)}」(${k}) 落在旧版总结表字段但不满足字段约定，含真实数据行，已按错字段宽容模式收取。`);
                      }
                      mergedData[k] = JSON.parse(JSON.stringify(summaryData[k]));
                      foundSheets[k] = true;
                      if (!tableStates[k]) tableStates[k] = {};
                      const currentAiFloor = chat.slice(0, i + 1).filter(m => !m.is_user).length;
                      tableStates[k].lastUpdatedAiFloor = currentAiFloor;
                  });
              }
          }
      }

      // ── 正序叠加 delta 楼层的增量数据到已找到的 base 上 ──
      if (pendingDeltas.length > 0 && Object.keys(foundSheets).length > 0) {
          // pendingDeltas 是逆序收集的，需要反转为正序（从旧到新）
          pendingDeltas.reverse();
          logDebug_ACU(`[表格重建] 正序叠加 ${pendingDeltas.length} 个 delta 楼层到 base 上`);

          for (const { index: deltaIndex, tagData: deltaTagData } of pendingDeltas) {
              const incrementalData = deltaTagData.incrementalData || {};
              for (const [sheetKey, delta] of Object.entries(incrementalData)) {
                  // [全版本兼容] 按 base 表存在性判定（兼容携带的非模板表也要正常叠加 delta），
                  // 不再按 templateSheetKeySet 过滤——base 收集阶段已完成宽容过滤。
                  if (!mergedData[sheetKey]) {
                      if (snapshot) throw new Error('旧表格增量缺少基底，禁止建立桥接空状态。');
                      logWarn_ACU(`[表格重建] delta 楼层 #${deltaIndex} 引用了 sheetKey=${sheetKey}，但 base 中不存在该表，跳过`);
                      continue;
                  }
                  try {
                      mergedData[sheetKey] = applyTableDelta_ACU(mergedData[sheetKey], delta as any, sheetKey);
                      // 更新 lastUpdatedAiFloor 为 delta 楼层（最新变更来源）
                      if (!tableStates[sheetKey]) {
                          tableStates[sheetKey] = {};
                      }
                      const currentAiFloor = chat.slice(0, deltaIndex + 1).filter((m: any) => !m.is_user).length;
                      tableStates[sheetKey].lastUpdatedAiFloor = currentAiFloor;
                  } catch (e) {
                      if (snapshot) throw e;
                      logError_ACU(`[表格重建] 应用 delta 失败: sheetKey=${sheetKey}, 楼层=#${deltaIndex}`, e);
                  }
              }
          }
      }


      const foundCount = Object.keys(foundSheets).length;
      logDebug_ACU(`[Merge] Found ${foundCount} tables for tag [${currentIsolationKey || '无标签'}] from chat history.`);

      // 如果没有任何数据：
      // - 若存在"空白指导表"：优先返回"指导表物化结构"（表头+参数；seedRows 仅保留字段，不默认展开到 content）
      // - 否则返回 null，让调用方按旧逻辑处理（例如用完整模板结构作为占位符）
      if (foundCount <= 0) {
          if (hasSheetGuide) {
              // 直接物化：仅表头（seedRows 保留在字段中，但不作为"当前对话真实数据行"展示）
              const base = materializeDataFromSheetGuide_ACU(sheetGuideData, { includeSeedRows: false });
              const orderedKeys = getSortedSheetKeys_ACU(base,
                  snapshot ? { ignoreChatGuide: true, includeMissingFromGuide: true, templateSnapshot: snapshot.templateData } : undefined);
              return migrateContentNullToRowId(reorderDataBySheetKeys_ACU(base, orderedKeys));
          }
          return null;
      }

      // [兼容迁移] 旧版：updateConfig 的 0 表示"沿用UI"；新版：-1 表示"沿用UI"
      // 注意：聊天记录里保存的是"单表对象"，没有 mate 标记，因此用 updateConfig.uiSentinel 作为表级标记。
      Object.keys(mergedData).forEach(k => {
          if (!k.startsWith('sheet_')) return;
          const sheet = mergedData[k];
          const uc = (sheet && typeof sheet === 'object') ? sheet.updateConfig : null;
          if (!uc || typeof uc !== 'object') return;
          if (uc.uiSentinel === -1) return; // 已是新语义
          for (const field of ['contextDepth', 'updateFrequency', 'batchSize', 'skipFloors']) {
              if (Object.prototype.hasOwnProperty.call(uc, field) && uc[field] === 0) {
                  uc[field] = -1;
              }
          }
          uc.uiSentinel = -1;
      });

      // [修复顺序] 与 V2 分支一致：历史 auto_merged 越界尾列与孤儿身份列错位必须在
      // guide 结构比较/padding 之前复位，否则宽度差会被误判为结构不一致，甚至在
      // padding 时把错位形态进一步固化（2025-12 事故的成因正是在此点之后 padding）。
      {
          const autoMergedRepaired = repairLegacyAutoMergedRowTails_ACU(mergedData);
          if (autoMergedRepaired.length > 0) {
              logDebug_ACU(`[数据修复] (legacy) 已移除历史 auto_merged 越界尾列：${autoMergedRepaired.join('、')}`);
          }
          const orphanRepair = repairLegacyOrphanIdentityColumn_ACU(mergedData);
          if (orphanRepair.changedSheetKeys.length > 0) {
              logWarn_ACU(`[数据修复] (legacy) 已复位孤儿身份列错位（列对齐已恢复，数据无损）：${orphanRepair.changedSheetKeys.join('、')}`);
          }
          orphanRepair.warnings.forEach(warning => logWarn_ACU(warning));
      }

      // [新增] 若存在"空白指导表"，则：
      // 1) 过滤掉不在指导表里的表（UI/填表只以指导表为准，避免旧表复活）
      // 2) 对指导表中缺失的表：使用指导表结构作为初始值（seedRows 仅保留字段，不默认展开到 content）
      // 3) 对于存在历史数据的表：以历史数据为主，但表名/表头/参数/顺序以指导表为准；不把 seedRows 合并进真实数据行
      if (hasSheetGuide) {
          const guideMergeResult = mergeSheetGuideStructureIntoData_ACU(mergedData, sheetGuideData,
              snapshot ? { structuralAuthority: 'guide', templateSnapshot: snapshot.templateData } : undefined);
          mergedData = guideMergeResult.data;
          // 与 V2 分支一致：隔离表键与结构 warning 透出给加载路径报告，不再静默丢弃。
          if (snapshot && guideMergeResult.quarantinedSheetKeys.length) {
              throw new Error('旧表格存在结构隔离，不能证明桥接无损。');
          }
          if (!snapshot) {
              lastMergeQuarantinedSheetKeys = guideMergeResult.quarantinedSheetKeys;
              lastMergeWarnings = guideMergeResult.warnings;
          }
      }

      // [修复] 合并结果按"用户手动顺序/模板顺序"重排，避免合并过程导致的随机乱序
      const orderedKeys = getSortedSheetKeys_ACU(mergedData,
          snapshot ? { ignoreChatGuide: true, includeMissingFromGuide: true, templateSnapshot: snapshot.templateData } : undefined);
      mergedData = reorderDataBySheetKeys_ACU(mergedData, orderedKeys);
      return migrateContentNullToRowId(mergedData);
  }

  // ── 单表隔离信息暂存（模块级，无状态污染）──
  // mergeSheetGuideStructureIntoData_ACU 的隔离表键与结构 warning 通过这里透出，
  // 由 refreshMergedDataAndNotify_ACU 紧随合并调用之后读取并清空，避免污染数据对象。
  let lastMergeQuarantinedSheetKeys: string[] = [];
  let lastMergeWarnings: string[] = [];

  /**
   * 读取并清空上一次合并产生的隔离表键（供加载路径报告单表故障隔离）。
   */
  export function consumeLastMergeQuarantinedSheetKeys_ACU(): string[] {
      const keys = lastMergeQuarantinedSheetKeys;
      lastMergeQuarantinedSheetKeys = [];
      return keys;
  }

  /**
   * 读取并清空上一次合并产生的结构 warning（供加载路径记录可定位提示）。
   */
  export function consumeLastMergeWarnings_ACU(): string[] {
      const warnings = lastMergeWarnings;
      lastMergeWarnings = [];
      return warnings;
  }

  // ── 源带行表清单（sheetKey → 规范化显示名）──
  // legacy 合并在每个原始读取点、任何过滤之前登记"源里实际存在真实数据行的表"。
  // 迁移破坏保险闸消费该清单做逐表比对：清单与合并读取同源，闸门不再独立扫描，
  // 从根上消除"闸门收了合并根本不读的字段"导致的缺表误报。
  let lastMergeSourceInventory: Map<string, string> = new Map();

  /** 在过滤之前登记一个源数据容器中所有带真实行的表（first-write 保留已有名）。 */
  function registerMergeSourceSheets_ACU(data: Record<string, any> | null | undefined): void {
      if (!data || typeof data !== 'object') return;
      Object.keys(data).forEach(sheetKey => {
          if (!sheetKey.startsWith('sheet_')) return;
          const sheet = data[sheetKey];
          if (!sheet || typeof sheet !== 'object' || !sheetHasRealRows_ACU(sheet)) return;
          const name = canonicalizeDisplayName_ACU(sheet.name);
          if (!lastMergeSourceInventory.has(sheetKey) || (name && !lastMergeSourceInventory.get(sheetKey))) {
              lastMergeSourceInventory.set(sheetKey, name);
          }
      });
  }

  /** 登记 delta 槽的增量 sheetKey（无表名可取，名留空，比对退化为按 key 匹配）。 */
  function registerMergeSourceDeltaKeys_ACU(incrementalData: Record<string, any> | null | undefined): void {
      if (!incrementalData || typeof incrementalData !== 'object') return;
      Object.keys(incrementalData).forEach(sheetKey => {
          if (!sheetKey.startsWith('sheet_') || !incrementalData[sheetKey]) return;
          if (!lastMergeSourceInventory.has(sheetKey)) lastMergeSourceInventory.set(sheetKey, '');
      });
  }

  /**
   * 读取并清空上一次 legacy 合并登记的源带行表清单（供迁移保险闸逐表比对）。
   */
  export function consumeLastMergeSourceInventory_ACU(): Map<string, string> {
      const inventory = lastMergeSourceInventory;
      lastMergeSourceInventory = new Map();
      return inventory;
  }


  export async function mergeAllIndependentTables_ACU() {
      const chat = getChatArray_ACU();
      if (!chat || chat.length === 0) {
          logDebug_ACU('Cannot merge data: Chat history is empty.');
          return null;
      }

      const currentIsolationKey = getCurrentIsolationKey_ACU();
      const strategy = resolveTableStorageStrategy_ACU(chat, currentIsolationKey, {
          enabled: settings_ACU.dataIsolationEnabled,
          code: settings_ACU.dataIsolationCode,
      });

      if (strategy.mode === 'v2') {
          let mergedData = await loadTableStateFromFramesV2_ACU(chat, currentIsolationKey, {
              allowTemporaryTemplateBaseline: true,
          }) as Record<string, any> | null;
          // [修复顺序] 历史 auto_merged 越界尾列（行宽 = 表头 + 1 且尾格为 'auto_merged'）
          // 必须在 guide 结构比较之前剥离，否则 +1 宽度差会被误判为结构不一致。
        if (mergedData) {
            const repaired = repairLegacyAutoMergedRowTails_ACU(mergedData);
            if (repaired.length > 0) {
                logDebug_ACU(`[数据修复] 已移除历史 auto_merged 越界尾列：${repaired.join('、')}`);
            }
            // 孤儿身份列错位（表头 ["row_id", 空占位, …]）同样必须在 guide 结构比较之前
            // 复位：已固化进 checkpoint 的错位形态在此无损归位，宽度差不再误导 padding。
            const orphanRepair = repairLegacyOrphanIdentityColumn_ACU(mergedData);
            if (orphanRepair.changedSheetKeys.length > 0) {
                logWarn_ACU(`[数据修复] 已复位孤儿身份列错位（列对齐已恢复，数据无损）：${orphanRepair.changedSheetKeys.join('、')}`);
            }
            orphanRepair.warnings.forEach(warning => logWarn_ACU(warning));
        }
        const sheetGuideData = getChatSheetGuideDataForIsolationKey_ACU(currentIsolationKey);
          if (mergedData && hasUsableSheetGuide_ACU(sheetGuideData)) {
              const mergeResult = mergeSheetGuideStructureIntoData_ACU(mergedData, sheetGuideData, {
                  structuralAuthority: 'data',
              });
              lastMergeQuarantinedSheetKeys = mergeResult.quarantinedSheetKeys;
              lastMergeWarnings = mergeResult.warnings;
              const orderedKeys = getSortedSheetKeys_ACU(mergeResult.data);
              return migrateContentNullToRowId(reorderDataBySheetKeys_ACU(mergeResult.data, orderedKeys));
          }
          return migrateContentNullToRowId(mergedData);
      }

      if (strategy.mode === 'legacy-v1' && strategy.warning) {
          logWarn_ACU(`[TableStorage] ${strategy.warning}; reason=${strategy.reason}`);
      }

      if (strategy.mode === 'legacy-v1') {
          const mergedLegacyData = await mergeAllIndependentTablesLegacyV1_ACU();
          const sourceInventory = consumeLastMergeSourceInventory_ACU();
          try {
              const migrationResult = await migrateLegacyStorageToV2OnLoad_ACU({
                  data: mergedLegacyData,
                  isolationKey: currentIsolationKey,
                  isolationConfig: {
                      enabled: settings_ACU.dataIsolationEnabled,
                      code: settings_ACU.dataIsolationCode,
                  },
                  skipUpdateFloors: settings_ACU.skipUpdateFloors,
                  sourceInventory,
              });
              if (!migrationResult.migrated) {
                  throw new Error(`旧存储迁移到 V2 失败: ${migrationResult.error || '未执行迁移'}`);
              }
              if (!migrationResult.data) {
                  throw new Error('旧存储迁移到 V2 失败: 迁移成功结果缺少修复后的表格数据。');
              }
              const postStrategy = resolveTableStorageStrategy_ACU(chat, currentIsolationKey, {
                  enabled: settings_ACU.dataIsolationEnabled,
                  code: settings_ACU.dataIsolationCode,
              });
              if (postStrategy.mode !== 'v2') {
                  throw new Error(`旧存储迁移后二次校验失败：当前模式=${postStrategy.mode}${postStrategy.mode === 'legacy-v1' ? `，reason=${postStrategy.reason}` : ''}`);
              }
              return migrateContentNullToRowId(migrationResult.data);
          } catch (migrationError) {
              // C4 读取不阻塞：迁移失败（audit 不可修、mixed 阻断、provenance 非法等）
              // 时不再 throw——降级为 xing/7.9 之前的直读合并结果，数据照常可用。
              // 迁移待决已由 migrateLegacyStorageToV2OnLoad_ACU 内部登记（mixed 场景走
              // registerMixedStorageDecision_ACU 通道）；写入门闸
              // ensureLegacyStorageMigratedBeforeWrite_ACU 维持严格，写仍要求迁移成功。
              const message = migrationError instanceof Error ? migrationError.message : String(migrationError);
              logWarn_ACU(`[TableStorage] 旧存储迁移失败，已降级为直读旧格式（数据可用，写入前仍需完成迁移）：${message}`);
              return migrateContentNullToRowId(mergedLegacyData);
          }
      }

      return migrateContentNullToRowId(await mergeAllIndependentTablesLegacyV1_ACU());
  }

  // [重构] 刷新合并数据并通知前端和更新世界书

  export function formatJsonToReadable_ACU(jsonData: Record<string, any> | null) {
    if (!jsonData) return { readableText: "数据库为空。", importantPersonsTable: null as any, summaryTable: null as any, outlineTable: null as any };

    let readableText = '';
    let importantPersonsTable = null;
    let summaryTable = null;
    let outlineTable = null;
    // No longer need globalDataTable here as it's part of the main text.

    const tableIndexes = getSortedSheetKeys_ACU(jsonData);
    
    tableIndexes.forEach((sheetKey: string, tableIndex: number) => {
        const table = jsonData[sheetKey];
        if (!table || !table.name || !table.content) return;

        // Extract special tables
        switch (table.name.trim()) {
            case '重要人物表':
                importantPersonsTable = table;
                return; // Skip from main output
            case '总结表':
                summaryTable = table;
                return; // Skip from main output
            case '总体大纲':
                outlineTable = table;
                return; // Skip from main output
        }

        // [新增] 检查是否启用了单独注入（Custom Export），如果启用了，则不包含在基础条目中
        // [新增] 检查是否允许注入世界书 (injectIntoWorldbook)，如果为 false，则不包含在基础条目中
        if (table.exportConfig) {
            if (table.exportConfig.enabled) return; // Skip from main output because it will be exported separately
            if (table.exportConfig.injectIntoWorldbook === false) return; // Skip if injection is disabled
        }
        
        const sqlInjectionTemplate = isSqliteMode() && typeof table.exportConfig?.sqlInjectionTemplate === 'string'
            ? table.exportConfig.sqlInjectionTemplate.trim()
            : '';
        if (sqlInjectionTemplate) {
            readableText += `${sqlInjectionTemplate}\n\n`;
            return;
        }

        // All other tables, including '全局数据表', are added to the readable text
        readableText += `# ${table.name}\n\n`;
        const visibleColumns = getSheetColumnProjection_ACU(table).visibleColumns.filter(column => column.sourceIndex > 0);
        const headers = visibleColumns.map(column => column.header);
        if (headers.length > 0) {
            readableText += `| ${headers.join(' | ')} |\n`;
            readableText += `|${headers.map(() => '---').join('|')}|\n`;
        }
        
        const rows = table.content.slice(1);
        if (rows.length > 0) {
            rows.forEach((row: any[]) => {
                const rowData = visibleColumns.map(column => row[column.sourceIndex]);
                readableText += `| ${rowData.join(' | ')} |\n`;
            });
        }
        readableText += '\n';
    });
    
    return { readableText, importantPersonsTable, summaryTable, outlineTable };
  }

  // =========================
  // [新功能] 新建对话：将模板基础状态写入"楼层本地数据"（而非拼接到消息文本）
  // 目标：像填表一样，开场白楼层就拥有一份"当前模板"的数据库基底（模板有数据就带数据，没有就为空表）
  // 注意：此动作不触发世界书注入链路，只做本地数据写入 + 前端显示刷新
  // =========================
  export const GREETING_LOCAL_BASE_STATE_MARKER_ACU = 'ACU_TEMPLATE_BASE_STATE_LOCAL_V1';

  export function isNewChatGreetingStage_ACU(chat: any[]) {
      if (!Array.isArray(chat) || chat.length === 0) return false;
      const hasAnyUserMessage = chat.some(m => m && m.is_user);
      if (hasAnyUserMessage) return false;
      const firstAiIndex = chat.findIndex(m => m && !m.is_user);
      return firstAiIndex !== -1;
  }

  // [健全性] 你要求的监视点：任何"仅单一AI楼层、没有任何User回复"的聊天记录，都不进行世界书注入
  export function isSingleAiNoUserChat_ACU(chat: any[]) {
      if (!Array.isArray(chat) || chat.length === 0) return false;
      const userCount = chat.filter(m => m && m.is_user).length;
      const aiCount = chat.filter(m => m && !m.is_user).length;
      return userCount === 0 && aiCount === 1;
  }

  function messageHasTableDataForCurrentIsolation_ACU(message: any, isolationKey: string) {
      try {
          if (!message || message.is_user) return false;
          const tagData = readIsolatedTagData_ACU(message, isolationKey);
          if (isV2TagData_ACU(tagData) && (tagData.storageFrame.checkpoint?.kind === 'full' || (tagData.storageFrame.logEntries || []).length > 0)) return true;
          if (tagData?.independentData && Object.keys(tagData.independentData).some(k => k.startsWith('sheet_'))) return true;
          if (isLegacyMatchForIsolation_ACU(message, { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode })) {
              const legacyIndependent = readLegacyIndependentData_ACU(message);
              if (legacyIndependent && Object.keys(legacyIndependent).some(k => k.startsWith('sheet_'))) return true;
              const legacyStandard = readLegacyStandardData_ACU(message);
              if (legacyStandard && Object.keys(legacyStandard).some(k => k.startsWith('sheet_'))) return true;
              const legacySummary = readLegacySummaryData_ACU(message);
              if (legacySummary && Object.keys(legacySummary).some(k => k.startsWith('sheet_'))) return true;
          }
      } catch (_) {}
      return false;
  }

  function shouldCreateInitialSeedCheckpoint_ACU(chat: any[], { allowPendingFirstUserMessage = false } = {}) {
      if (!Array.isArray(chat) || chat.length === 0) return false;
      const userCount = chat.filter(m => m && m.is_user).length;
      if (userCount !== 1 && !(allowPendingFirstUserMessage && userCount === 0)) return false;
      const isolationKey = getCurrentIsolationKey_ACU();
      return !chat.some(message => messageHasTableDataForCurrentIsolation_ACU(message, isolationKey));
  }

  function normalizeInitialCheckpointV2Source_ACU(source: string) {
      if (source === 'game_init' || source === 'import') return 'import';
      return 'system';
  }

  export function shouldSuppressWorldbookInjection_ACU() {
      // 用户要求：取消"首楼填表后不注入书"的限制。
      // 是否创建条目，改由各条目更新逻辑自身基于"真实有效数据"判定，避免一刀切拦截整个链路。
      return false;
  }

  export function maybeLiftWorldbookSuppression_ACU() {
      if (!suppressWorldbookInjectionInGreeting_ACU) return;
      const chat = getChatArray_ACU();
      if (!Array.isArray(chat)) return;
      const hasAnyUserMessage = chat.some(m => m && m.is_user);
      if (hasAnyUserMessage) {
          _set_suppressWorldbookInjectionInGreeting_ACU(false);
          logDebug_ACU('[Worldbook] Greeting-stage suppression lifted (user message detected).');
      }
  }

  export function buildTemplateBaseStateDataForLocalStorage_ACU(templateObj: Record<string, any> | null) {
      if (!templateObj || typeof templateObj !== 'object') return null;
      const out: Record<string, any> = { mate: { type: 'chatSheets', version: 1 } };
      const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
      if (sheetKeys.length === 0) return null;
      sheetKeys.forEach(k => {
          const sheet = JSON.parse(JSON.stringify(templateObj[k]));
          if (Array.isArray(sheet?.content)) {
              if (sheet.content.length > 0 && (!Array.isArray(sheet.content[0]) || sheet.content[0][0] !== 'row_id')) {
                  throw new Error(`初始模板 Sheet「${k}」缺少 row_id 表头，拒绝写入 checkpoint。`);
              }
              if (sheet.content.slice(1).some((row: unknown) => !Array.isArray(row))) {
                  throw new Error(`初始模板 Sheet「${k}」包含非数组数据行，拒绝伪造 row_id。`);
              }
              sheet.content = ensureStableRowIdsForSheetContent_ACU(sheet.content);
          }
          out[k] = sheet;
      });
      return out;
  }

  async function writeInitialTemplateCheckpoint_ACU(templateObj: Record<string, any>, {
      reason = 'initial_seed_checkpoint',
      presetName = '',
      source = '',
      registerPreset = false,
      force = false,
      cleanupWorldbook = true,
  } = {}) {
      const chat = getChatArray_ACU();
      if (!chat || !Array.isArray(chat) || chat.length === 0) {
          logWarn_ACU('[InitialCheckpoint] 聊天记录为空，无法写入初始化数据');
          return false;
      }

      const isolationKey = getCurrentIsolationKey_ACU();
      const preStrategy = resolveTableStorageStrategy_ACU(chat, isolationKey, {
          enabled: settings_ACU.dataIsolationEnabled,
          code: settings_ACU.dataIsolationCode,
      });
      if (preStrategy.mode === 'legacy-v1') {
          logWarn_ACU(`[InitialCheckpoint] 检测到旧存储，禁止写入 init checkpoint，等待迁移流程处理。reason=${preStrategy.reason}`);
          return false;
      }

      const firstAiIndex = chat.findIndex(m => m && !m.is_user);
      if (firstAiIndex === -1) {
          logWarn_ACU('[InitialCheckpoint] 找不到第一楼AI消息');
          return false;
      }
      const firstMsg = chat[firstAiIndex];
      if (!force && firstMsg._acu_local_template_base_state_seeded === GREETING_LOCAL_BASE_STATE_MARKER_ACU) return false;

      const sheetKeys = Object.keys(templateObj || {}).filter(k => k.startsWith('sheet_'));
      if (sheetKeys.length === 0) {
          logWarn_ACU('[InitialCheckpoint] 模板中没有表格数据');
          return false;
      }
      ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: sheetKeys, forceRebuild: false });

      const templateSnapshot = sanitizeTemplateSnapshotForChat_ACU(templateObj);
      const normalizedPresetName = deriveTemplatePresetNameForImport_ACU({ presetName });
      const normalizedSource = source || reason;
      if (registerPreset && normalizedPresetName && templateSnapshot?.templateStr) {
          try {
              const savePresetOk = upsertTemplatePreset_ACU(normalizedPresetName, templateSnapshot.templateStr);
              if (!savePresetOk) {
                  logWarn_ACU(`[TemplateScope] 保存模板预设失败：${normalizedPresetName}`);
              }
          } catch (e) {
              logWarn_ACU('[TemplateScope] 保存模板预设失败:', e);
          }
      }

      const baseData = buildTemplateBaseStateDataForLocalStorage_ACU(templateObj);
      if (!baseData) return false;

      const guideData = buildChatSheetGuideDataFromTemplateObj_ACU(templateObj, { stripSeedRows: false });
      if (guideData) {
          const guideUpdated = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, guideData, {
              reason,
              syncTemplateScope: true,
              templateSource: templateSnapshot?.templateStr || templateObj,
              presetName: normalizedPresetName,
              source: normalizedSource,
          });
          if (!guideUpdated) {
              logWarn_ACU('[InitialCheckpoint] 初始化模板 scope 同步失败，已中止 checkpoint 写入。');
              return false;
          }
          applyTemplateScopeForCurrentChat_ACU();
      }

      const strategy = resolveTableStorageStrategy_ACU(chat, isolationKey, {
          enabled: settings_ACU.dataIsolationEnabled,
          code: settings_ACU.dataIsolationCode,
      });

      if (strategy.mode === 'legacy-v1') {
          // 前置 preStrategy 已 fail-closed；此处再兜底：legacy-v1 不得新建 V1 slot/兼容字段。
          logWarn_ACU(`[InitialCheckpoint] 检测到旧存储（strategy.mode=legacy-v1），拒绝写入 init checkpoint。reason=${strategy.reason}`);
          return false;
      } else {
          const saveResult = await runTableWriteTransaction_ACU({
              source: normalizeInitialCheckpointV2Source_ACU(normalizedSource),
              reason: 'initial_checkpoint_v2',
              isolationKey,
              writeSet: [{ kind: 'all' }],
              initialData: baseData as any,
          }, async (transactionContext) => persistTableMutationLogV2_ACU({
              targetMessageIndex: firstAiIndex,
              source: normalizeInitialCheckpointV2Source_ACU(normalizedSource),
              afterData: baseData as any,
              filledSheetKeys: [],
              candidateChangedSheetKeys: [],
              groupKeys: [],
              forceCheckpoint: true,
              checkpointReason: 'init',
              isolationKey,
              transactionContext,
          }));
          if (!saveResult.saved) {
              logWarn_ACU(`[InitialCheckpoint] V2 checkpoint 写入失败：${saveResult.error || 'unknown error'}`);
              return false;
          }
      }

      firstMsg._acu_local_template_base_state_seeded = GREETING_LOCAL_BASE_STATE_MARKER_ACU;
      _set_suppressWorldbookInjectionInGreeting_ACU(false);

      if (cleanupWorldbook) {
          try {
              await deleteAllGeneratedEntries_ACU();
              logDebug_ACU(`[InitialCheckpoint] Deleted generated entries before first real reply. reason=${reason}`);
          } catch (e) {
              logWarn_ACU('[InitialCheckpoint] Cleanup before first real reply failed:', e);
          }
      }

      _set_currentJsonTableData_ACU(reorderDataBySheetKeys_ACU(JSON.parse(JSON.stringify(baseData)), getSortedSheetKeys_ACU(baseData)));
      logDebug_ACU(`[InitialCheckpoint] 初始化 checkpoint 已写入。reason=${reason}, messageIndex=${firstAiIndex}, sheetCount=${sheetKeys.length}`);
      return { success: true, messageIndex: firstAiIndex, sheetCount: sheetKeys.length };
  }

  export async function ensureInitialSeedCheckpoint_ACU({ reason = 'initial_seed_checkpoint', allowPendingFirstUserMessage = false } = {}) {
      try {
          const chat = getChatArray_ACU();
          if (!shouldCreateInitialSeedCheckpoint_ACU(chat, { allowPendingFirstUserMessage })) return false;

          const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: false });
          if (!templateObj) return false;

          const result = await writeInitialTemplateCheckpoint_ACU(templateObj, {
              reason,
              source: reason,
              registerPreset: false,
              force: false,
              cleanupWorldbook: true,
          });
          if (result && typeof result === 'object' && result.success) {
              return { success: true, messageIndex: result.messageIndex };
          }
          return result;
      } catch (e) {
          logWarn_ACU('[InitialSeed] Failed to persist initial seed checkpoint:', e);
          return { success: false };
      }
  }

  export async function seedGreetingLocalDataFromTemplate_ACU() {
      return ensureInitialSeedCheckpoint_ACU({ reason: 'legacy_seed_greeting_alias' });
  }

  // 仅保留给既有 greeting seed 流程；initGameSession 已改用
  // resetCurrentChatTableStateFromTemplate_ACU，以确保删除旧状态、checkpoint、guide 与
  // template scope 在一次严格保存中提交或回滚。
  export async function fillFirstLayerWithTemplateData_ACU(templateObj: Record<string, any>, { reason = 'game_init', presetName = '', source = 'game_init', registerPreset = true } = {}) {
      try {
          return await writeInitialTemplateCheckpoint_ACU(templateObj, {
              reason,
              presetName,
              source,
              registerPreset,
              force: true,
              cleanupWorldbook: true,
          });
      } catch (e) {
          logError_ACU('[FillFirstLayer] 填充第一楼数据失败:', e);
          return { success: false };
      }
  }

  export function parseReadableToJson_ACU(text: string) {
    if (!currentJsonTableData_ACU) {
        logError_ACU("Parsing failed: currentJsonTableData_ACU is not available.");
        return null;
    }

    try {
        // Create a deep clone to safely modify, preserving original metadata.
        const newJsonData = JSON.parse(JSON.stringify(currentJsonTableData_ACU)); 
        const tablesText = text.trim().split('# ').slice(1);

        const parsedSheetContents: Record<string, any[][]> = {};

        for (const tableText of tablesText) {
            const lines = tableText.trim().split('\n');
            const tableName = lines[0].trim();
            
            const sheetKey = getSortedSheetKeys_ACU(newJsonData).find(k => newJsonData[k].name === tableName);
            if (!sheetKey) {
                logWarn_ACU(`Table "${tableName}" from text not found in current JSON structure. Skipping.`);
                continue;
            }

            const originalSheet = newJsonData[sheetKey];
            const originalHeaderRow = originalSheet.content[0];
            const newContent = [originalHeaderRow]; // Start with the original header row.
            const reservedRowIds = createStableRowIdReservation_ACU(originalSheet.content.slice(1));

            // Find all valid markdown table row lines, skipping the format line.
            const dataLines = lines.filter(line => line.trim().startsWith('|') && !line.includes('---'));

            // The first markdown row is the header text, which we ignore since we use the original header.
            for (let i = 1; i < dataLines.length; i++) {
                const line = dataLines[i];
                // Split by '|', remove the first and last empty elements, and trim whitespace.
                const columns = line.split('|').slice(1, -1).map(c => c.trim());
                
                const newRow = [allocateStableRowId_ACU(reservedRowIds), ...columns];
                
                // Pad or truncate the row to match the header's column count for consistency.
                if (newRow.length < originalHeaderRow.length) {
                     while(newRow.length < originalHeaderRow.length) newRow.push('');
                } else if (newRow.length > originalHeaderRow.length) {
                    newRow.splice(originalHeaderRow.length);
                }
                newContent.push(newRow);
            }
            parsedSheetContents[sheetKey] = newContent;
        }

        // Update the cloned JSON object only with sheets that were successfully parsed.
        for (const sheetKey in parsedSheetContents) {
            newJsonData[sheetKey].content = parsedSheetContents[sheetKey];
        }

        return newJsonData;

    } catch (error) {
        logError_ACU("Error parsing readable text back to JSON:", error);
        return null;
    }
  }

  export function getEffectiveAutoUpdateThreshold_ACU(calledFrom = 'system') {
    let threshold = Number(settings_ACU.autoUpdateThreshold); // Start with the in-memory setting, ensure number
    if (isNaN(threshold)) threshold = 3; // Default fallback

    // 移除：不再从 UI 输入框实时获取值
    // 原因：UI 可能处于隐藏状态或者未初始化完成，导致获取到的值为空或过时
    // 我们应完全信任 settings_ACU 中的值，因为 UI 修改后会同步到 settings_ACU
    /*
    if (
      $autoUpdateThresholdInput_ACU &&
      $autoUpdateThresholdInput_ACU.length > 0 &&
      $autoUpdateThresholdInput_ACU.is(':visible')
    ) {
      const uiThresholdVal = $autoUpdateThresholdInput_ACU.val();
      if (uiThresholdVal) {
        const parsedUiInput = parseInt(uiThresholdVal, 10);
        if (!isNaN(parsedUiInput) && parsedUiInput >= 1) {
          threshold = parsedUiInput;
        } 
        // ...
      }
    }
    */
    
    // logDebug_ACU(`getEffectiveAutoUpdateThreshold_ACU (calledFrom: ${calledFrom}): final threshold = ${threshold}`);
    return threshold;
  }


  // --- [剧情推进] 核心函数 ---

  /**
   * 剧情推进统一的API调用函数
   */

  /**
   * 将表格JSON数据转换为更适合LLM读取的文本格式。
   * @param {object} jsonData - 表格数据对象（例如本插件的 currentJsonTableData_ACU）。
   * @returns {string} - 格式化后的文本字符串。
   */
