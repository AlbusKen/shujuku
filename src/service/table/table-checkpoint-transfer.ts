import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { hashUserInput_ACU, logDebug_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { peekChatScopedConfigContainer_ACU, peekChatSheetGuideContainer_ACU, setChatScopedConfigContainer_ACU, setChatSheetGuideContainer_ACU } from '../../data/storage/chat-history';
import { saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getChatArray_ACU, clearAllAiTableDataForCheckpointRestore_ACU, cleanupCheckpointVectorIndexManifestsAfterCommit_ACU } from '../chat/chat-service';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { applyTemplateScopeForCurrentChat_ACU } from '../settings/settings-service';
import { buildChatTemplateScopeStateFromCurrent_ACU, getChatSheetGuideDataForIsolationKey_ACU, getCurrentChatTemplateScopeState_ACU, normalizeGuideData_ACU, sanitizeChatSheetsObject_ACU, sanitizeTemplateSnapshotForChat_ACU, setChatSheetGuideDataForIsolationKey_ACU, setCurrentChatTemplateScopeState_ACU } from '../template/chat-scope';
import { deleteAllGeneratedEntries_ACU, refreshMergedDataAndNotify_ACU } from '../worldbook/pipeline';
import { isSqliteMode } from './storage-mode';
import { getActiveStorageProvider, getStorageProvider, reloadStorageProvider } from './table-storage-strategy';
import { getLatestAiMessageIndexFromChat_ACU } from './table-history';
import { persistTablesToChatMessage_ACU } from './table-service';
import { runTableWriteTransaction_ACU } from './table-write-transaction';
import { repairLegacyAutoMergedRowTails_ACU } from '../../shared/canonical-row-normalizer';
import { validateCanonicalCheckpointData_ACU } from '../../shared/canonical-checkpoint-validator';

const CHECKPOINT_FORMAT_ACU = 'acu-table-checkpoint' as const;
const CHECKPOINT_VERSION_ACU = 1 as const;
const DANGEROUS_KEYS_ACU = new Set(['__proto__', 'constructor', 'prototype']);

export interface TableCheckpointTemplateSnapshotV1_ACU {
  data: TableDataObject_ACU;
  presetName: string;
}
export interface TableCheckpointGuideSnapshotV1_ACU { data: Record<string, any>; }
export interface TableCheckpointIntegrityV1_ACU { algorithm: 'fnv1a'; payloadHash: string; }
export interface TableCheckpointFileV1_ACU {
  format: typeof CHECKPOINT_FORMAT_ACU;
  version: typeof CHECKPOINT_VERSION_ACU;
  createdAt: number;
  source: { storageMode: 'native' | 'sqlite' };
  tableSnapshot: TableDataObject_ACU;
  templateSnapshot: TableCheckpointTemplateSnapshotV1_ACU;
  guideSnapshot: TableCheckpointGuideSnapshotV1_ACU;
  integrity: TableCheckpointIntegrityV1_ACU;
}
export type TableCheckpointParseResult_ACU = { success: true; checkpoint: TableCheckpointFileV1_ACU } | { success: false; error: string };
export interface TableCheckpointRestorePostCondition_ACU {
  runtimeMatches: boolean;
  scopeIsChatOverride: boolean;
  templateMatches: boolean;
  guideMatches: boolean;
  providerMode: 'native' | 'sqlite' | null;
}
export interface TableCheckpointRestoreResult_ACU {
  success: boolean;
  restoredMessageIndex?: number;
  clearedCount?: number;
  cleanupWarnings?: string[];
  derivedRefreshWarnings?: string[];
  postCondition?: TableCheckpointRestorePostCondition_ACU;
  error?: string;
}

function cloneJson_ACU<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isRecord_ACU(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function assertSafeJsonValue_ACU(value: unknown, path = '$'): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertSafeJsonValue_ACU(item, `${path}[${index}]`)); return; }
  if (!isRecord_ACU(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS_ACU.has(key)) throw new Error(`Checkpoint 包含危险键：${path}.${key}`);
    assertSafeJsonValue_ACU(child, `${path}.${key}`);
  }
}
function canonicalize_ACU(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize_ACU);
  if (!isRecord_ACU(value)) return value;
  return Object.keys(value).sort().reduce((out: Record<string, any>, key) => { out[key] = canonicalize_ACU(value[key]); return out; }, {});
}
function payloadHash_ACU(payload: Omit<TableCheckpointFileV1_ACU, 'integrity'>): string { return hashUserInput_ACU(JSON.stringify(canonicalize_ACU(payload))); }

function normalizeTableData_ACU(value: unknown, label: string): TableDataObject_ACU {
  if (!isRecord_ACU(value)) throw new Error(`${label} 必须是对象。`);
  const sanitized = sanitizeChatSheetsObject_ACU(cloneJson_ACU(value), { ensureMate: true }) as TableDataObject_ACU;
  const sheetKeys = Object.keys(sanitized).filter(key => key.startsWith('sheet_'));
  if (sheetKeys.length === 0) throw new Error(`${label} 至少需要一张 sheet_ 表。`);
  for (const key of sheetKeys) {
    const sheet = sanitized[key] as any;
    if (!isRecord_ACU(sheet) || typeof sheet.name !== 'string' || !Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) {
      throw new Error(`${label}.${key} 不是有效表格。`);
    }
  }
  return sanitized;
}

function getSheetKeys_ACU(data: Record<string, any>): string[] {
  return Object.keys(data).filter(key => key.startsWith('sheet_')).sort();
}

function assertSameSheetKeys_ACU(left: Record<string, any>, right: Record<string, any>, leftLabel: string, rightLabel: string): void {
  const leftKeys = getSheetKeys_ACU(left);
  const rightKeys = getSheetKeys_ACU(right);
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    throw new Error(`${leftLabel} 与 ${rightLabel} 的 sheet_ 集合不一致。`);
  }
}

function assertMatchingSheetSchema_ACU(leftSheet: any, rightSheet: any, key: string, leftLabel: string, rightLabel: string): void {
  const leftUid = String(leftSheet?.uid || key);
  const rightUid = String(rightSheet?.uid || key);
  if (leftUid !== rightUid) throw new Error(`${leftLabel}.${key} 与 ${rightLabel}.${key} 的 uid 不一致。`);
  if (leftSheet?.name !== rightSheet?.name) throw new Error(`${leftLabel}.${key} 与 ${rightLabel}.${key} 的名称不一致。`);
  const leftHeader = leftSheet?.content?.[0];
  const rightHeader = rightSheet?.content?.[0];
  if (!Array.isArray(leftHeader) || !Array.isArray(rightHeader) || leftHeader.length !== rightHeader.length) {
    throw new Error(`${leftLabel}.${key} 与 ${rightLabel}.${key} 的表头宽度不一致。`);
  }
  for (let index = 0; index < leftHeader.length; index += 1) {
    if (leftHeader[index] !== rightHeader[index]) {
      throw new Error(`${leftLabel}.${key} 与 ${rightLabel}.${key} 的第 ${index + 1} 列表头不一致。`);
    }
  }
}

/**
 * 仅比较同一 Checkpoint 文件内的 runtime/template/guide 快照；绝不读取目标聊天当前模板。
 */
function assertCheckpointSchemaConsistency_ACU(
  tableSnapshot: TableDataObject_ACU,
  templateData: TableDataObject_ACU,
  guideData: Record<string, any>,
): void {
  assertSameSheetKeys_ACU(templateData, guideData, 'templateSnapshot.data', 'guideSnapshot.data');
  const templateSheetKeys = new Set(getSheetKeys_ACU(templateData));
  for (const key of getSheetKeys_ACU(tableSnapshot)) {
    if (!templateSheetKeys.has(key)) throw new Error(`tableSnapshot.${key} 在 templateSnapshot.data 中不存在。`);
  }
  for (const key of getSheetKeys_ACU(templateData)) {
    assertMatchingSheetSchema_ACU(templateData[key], guideData[key], key, 'templateSnapshot.data', 'guideSnapshot.data');
    if (tableSnapshot[key]) {
      assertMatchingSheetSchema_ACU(tableSnapshot[key], templateData[key], key, 'tableSnapshot', 'templateSnapshot.data');
    }
  }
}

function assertCanonicalCheckpointRows_ACU(data: TableDataObject_ACU, label: string): void {
  const validation = validateCanonicalCheckpointData_ACU(data);
  if (!validation.valid) {
    const locations = validation.issues.map(issue => `${issue.type}: ${issue.sheetKey || 'unknown'}${issue.rowIndex === undefined ? '' : ` 第 ${issue.rowIndex} 行`}`).join('；');
    throw new Error(`${label} 行标识或结构不合法：${locations}`);
  }
}

function repairCheckpointLegacyAutoMergedTails_ACU(
  tableSnapshot: TableDataObject_ACU,
  templateData: TableDataObject_ACU,
  guideData: Record<string, any>,
): boolean {
  const repairedTable = repairLegacyAutoMergedRowTails_ACU(tableSnapshot);
  const repairedTemplate = repairLegacyAutoMergedRowTails_ACU(templateData);
  const repairedGuide = repairLegacyAutoMergedRowTails_ACU(guideData);
  return repairedTable.length > 0 || repairedTemplate.length > 0 || repairedGuide.length > 0;
}

function normalizeCheckpointPayload_ACU(raw: unknown): TableCheckpointFileV1_ACU {
  assertSafeJsonValue_ACU(raw);
  if (!isRecord_ACU(raw)) throw new Error('Checkpoint 根节点必须是对象。');
  if (raw.format !== CHECKPOINT_FORMAT_ACU) throw new Error('不支持的 Checkpoint 格式。');
  if (raw.version !== CHECKPOINT_VERSION_ACU) throw new Error(`不支持的 Checkpoint 版本：${String(raw.version)}。`);
  if (!Number.isFinite(raw.createdAt) || Number(raw.createdAt) <= 0) throw new Error('Checkpoint createdAt 无效。');
  if (!isRecord_ACU(raw.source) || (raw.source.storageMode !== 'native' && raw.source.storageMode !== 'sqlite')) throw new Error('Checkpoint 来源存储模式无效。');
  if (!isRecord_ACU(raw.templateSnapshot) || !isRecord_ACU(raw.guideSnapshot) || !isRecord_ACU(raw.integrity)) throw new Error('Checkpoint 缺少模板、指导表或完整性信息。');
  const tableSnapshot = normalizeTableData_ACU(raw.tableSnapshot, 'tableSnapshot');
  const templateData = normalizeTableData_ACU(raw.templateSnapshot.data, 'templateSnapshot.data');
  const guideData = normalizeGuideData_ACU(raw.guideSnapshot.data);
  if (!guideData || !Object.keys(guideData).some(key => key.startsWith('sheet_'))) throw new Error('guideSnapshot.data 不包含有效指导表。');
  const checkpoint: TableCheckpointFileV1_ACU = {
    format: CHECKPOINT_FORMAT_ACU,
    version: CHECKPOINT_VERSION_ACU,
    createdAt: Number(raw.createdAt),
    source: { storageMode: raw.source.storageMode },
    tableSnapshot,
    templateSnapshot: { data: templateData, presetName: typeof raw.templateSnapshot.presetName === 'string' ? raw.templateSnapshot.presetName : '' },
    guideSnapshot: { data: guideData },
    integrity: { algorithm: raw.integrity.algorithm === 'fnv1a' ? 'fnv1a' : (() => { throw new Error('不支持的完整性算法。'); })(), payloadHash: String(raw.integrity.payloadHash || '') },
  };
  if (!checkpoint.integrity.payloadHash) throw new Error('Checkpoint 缺少完整性哈希。');
  const { integrity, ...payload } = checkpoint;
  // 先验证文件原始内容的哈希，再修复历史版本错误追加的尾标记；否则会把被篡改
  // 的文件误当作可兼容旧文件。修复后重签内部对象，使 parse → restore 幂等。
  if (payloadHash_ACU(payload) !== integrity.payloadHash) throw new Error('Checkpoint 完整性校验失败，文件可能已损坏或被篡改。');
  const repairedLegacyAutoMergedTails = repairCheckpointLegacyAutoMergedTails_ACU(tableSnapshot, templateData, guideData);
  assertCanonicalCheckpointRows_ACU(tableSnapshot, 'tableSnapshot');
  assertCanonicalCheckpointRows_ACU(templateData, 'templateSnapshot.data');
  assertCanonicalCheckpointRows_ACU(guideData as TableDataObject_ACU, 'guideSnapshot.data');
  assertCheckpointSchemaConsistency_ACU(tableSnapshot, templateData, guideData);
  if (repairedLegacyAutoMergedTails) {
    const { integrity: _previousIntegrity, ...repairedPayload } = checkpoint;
    checkpoint.integrity = { algorithm: 'fnv1a', payloadHash: payloadHash_ACU(repairedPayload) };
    logDebug_ACU('[Checkpoint] 已修复历史 auto_merged 越界尾列。');
  }
  return checkpoint;
}

export function parseTableCheckpointFile_ACU(text: string): TableCheckpointParseResult_ACU {
  try {
    if (!String(text || '').trim()) throw new Error('Checkpoint 文件为空。');
    return { success: true, checkpoint: normalizeCheckpointPayload_ACU(JSON.parse(text)) };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Checkpoint 解析失败。' };
  }
}

export function buildCurrentTableCheckpoint_ACU(): TableCheckpointFileV1_ACU {
  applyTemplateScopeForCurrentChat_ACU();
  const provider = getStorageProvider();
  const tableSnapshot = normalizeTableData_ACU(provider.getCurrentData(), '当前表格数据');
  const isolationKey = getCurrentIsolationKey_ACU();
  const templateData = normalizeTableData_ACU(parseTableTemplateJson_ACU({ stripSeedRows: false }), '当前生效模板');
  const guideData = normalizeGuideData_ACU(cloneJson_ACU(getChatSheetGuideDataForIsolationKey_ACU(isolationKey)));
  if (!guideData || !Object.keys(guideData).some(key => key.startsWith('sheet_'))) throw new Error('当前聊天缺少可导出的指导表。');
  repairCheckpointLegacyAutoMergedTails_ACU(tableSnapshot, templateData, guideData);
  assertCanonicalCheckpointRows_ACU(tableSnapshot, '当前表格数据');
  assertCanonicalCheckpointRows_ACU(templateData, '当前生效模板');
  assertCanonicalCheckpointRows_ACU(guideData as TableDataObject_ACU, '当前指导表');
  assertCheckpointSchemaConsistency_ACU(tableSnapshot, templateData, guideData);
  const scope = getCurrentChatTemplateScopeState_ACU({ isolationKey });
  const payload = {
    format: CHECKPOINT_FORMAT_ACU,
    version: CHECKPOINT_VERSION_ACU,
    createdAt: Date.now(),
    source: { storageMode: provider.mode },
    tableSnapshot: cloneJson_ACU(tableSnapshot),
    templateSnapshot: { data: cloneJson_ACU(templateData), presetName: String(scope?.presetName || '') },
    guideSnapshot: { data: cloneJson_ACU(guideData) },
  };
  const checkpoint: TableCheckpointFileV1_ACU = { ...payload, integrity: { algorithm: 'fnv1a', payloadHash: payloadHash_ACU(payload) } };
  logDebug_ACU(`[Checkpoint] 已构建导出快照：mode=${provider.mode}, sheets=${Object.keys(tableSnapshot).filter(key => key.startsWith('sheet_')).length}`);
  return checkpoint;
}

type MessageFieldSnapshot_ACU = { msg: any; fields: Record<string, { exists: boolean; value: any }> };
const RESTORE_MESSAGE_FIELDS_ACU = ['TavernDB_ACU_Data', 'TavernDB_ACU_SummaryData', 'TavernDB_ACU_IndependentData', 'TavernDB_ACU_Identity', 'TavernDB_ACU_IsolatedData', 'TavernDB_ACU_ModifiedKeys', 'TavernDB_ACU_UpdateGroupKeys'];
function captureMessageSnapshots_ACU(chat: any[]): MessageFieldSnapshot_ACU[] {
  return chat.filter(msg => msg && !msg.is_user).map(msg => ({ msg, fields: RESTORE_MESSAGE_FIELDS_ACU.reduce((out: Record<string, { exists: boolean; value: any }>, key) => {
    const exists = Object.prototype.hasOwnProperty.call(msg, key);
    out[key] = { exists, value: exists ? cloneJson_ACU(msg[key]) : undefined };
    return out;
  }, {}) }));
}
function restoreMessageSnapshots_ACU(snapshots: MessageFieldSnapshot_ACU[]): void {
  for (const snapshot of snapshots) for (const [key, field] of Object.entries(snapshot.fields)) {
    if (field.exists) snapshot.msg[key] = field.value; else delete snapshot.msg[key];
  }
}

type RuntimeRollbackStrategy_ACU =
  | { kind: 'binary'; snapshot: Uint8Array }
  | { kind: 'data'; data: TableDataObject_ACU }
  | { kind: 'empty' };

function sameCheckpointData_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize_ACU(left)) === JSON.stringify(canonicalize_ACU(right));
}

function scopeTemplateMatchesCheckpoint_ACU(scope: any, checkpointTemplate: TableDataObject_ACU): boolean {
  try {
    const scopeSnapshot = sanitizeTemplateSnapshotForChat_ACU(scope?.templateStr || null);
    const checkpointSnapshot = sanitizeTemplateSnapshotForChat_ACU(checkpointTemplate);
    if (!scopeSnapshot?.templateObj || !checkpointSnapshot?.templateObj) return false;
    return sameCheckpointData_ACU(
      normalizeTableData_ACU(scopeSnapshot.templateObj, '恢复后的聊天模板作用域'),
      normalizeTableData_ACU(checkpointSnapshot.templateObj, 'Checkpoint 模板快照'),
    );
  } catch {
    return false;
  }
}

async function runCheckpointDerivedRefresh_ACU(
  checked: TableCheckpointFileV1_ACU,
  isolationKey: string,
  vectorManifests: any[],
): Promise<Pick<TableCheckpointRestoreResult_ACU, 'cleanupWarnings' | 'derivedRefreshWarnings' | 'postCondition'>> {
  const derivedRefreshWarnings: string[] = [];
  const runDerivedStep = async (label: string, task: () => void | Promise<void>): Promise<void> => {
    try {
      await task();
    } catch (error: any) {
      derivedRefreshWarnings.push(`${label}：${error?.message || String(error)}`);
    }
  };

  await runDerivedStep('模板作用域应用失败', () => { applyTemplateScopeForCurrentChat_ACU(); });
  if (isSqliteMode()) await runDerivedStep('SQLite 运行时重载失败', async () => { await reloadStorageProvider(); });
  await runDerivedStep('旧世界书条目清理触发失败', () => deleteAllGeneratedEntries_ACU());
  await runDerivedStep('聊天运行时与世界书刷新失败', async () => { await refreshMergedDataAndNotify_ACU(); });

  let cleanupWarnings: string[] | undefined;
  try {
    const warnings = await cleanupCheckpointVectorIndexManifestsAfterCommit_ACU(vectorManifests);
    if (warnings.length) cleanupWarnings = warnings;
  } catch (error: any) {
    derivedRefreshWarnings.push(`向量索引清理失败：${error?.message || String(error)}`);
  }

  const finalProvider = getActiveStorageProvider();
  const finalScope = getCurrentChatTemplateScopeState_ACU({ isolationKey });
  const finalGuide = getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
  const postCondition: TableCheckpointRestorePostCondition_ACU = {
    runtimeMatches: !!finalProvider && sameCheckpointData_ACU(finalProvider.getCurrentData(), checked.tableSnapshot),
    scopeIsChatOverride: finalScope?.mode === 'chat_override',
    templateMatches: scopeTemplateMatchesCheckpoint_ACU(finalScope, checked.templateSnapshot.data),
    guideMatches: sameCheckpointData_ACU(finalGuide, checked.guideSnapshot.data),
    providerMode: finalProvider?.mode || null,
  };
  if (!finalProvider) derivedRefreshWarnings.push('恢复后的活动表格存储不可用。');
  if (!postCondition.runtimeMatches) derivedRefreshWarnings.push('恢复后的运行时数据与 Checkpoint 数据快照不一致。');
  if (!postCondition.scopeIsChatOverride) derivedRefreshWarnings.push('恢复后的模板作用域不是 chat_override。');
  if (!postCondition.templateMatches) derivedRefreshWarnings.push('恢复后的聊天模板快照与 Checkpoint 模板不一致。');
  if (!postCondition.guideMatches) derivedRefreshWarnings.push('恢复后的指导表与 Checkpoint 指导表不一致。');

  return {
    ...(cleanupWarnings ? { cleanupWarnings } : {}),
    ...(derivedRefreshWarnings.length ? { derivedRefreshWarnings } : {}),
    postCondition,
  };
}

export async function restoreTableCheckpointToLatestAi_ACU(parsed: TableCheckpointFileV1_ACU): Promise<TableCheckpointRestoreResult_ACU> {
  let checked: TableCheckpointFileV1_ACU;
  let chat: any[];
  let targetMessageIndex: number;
  let isolationKey: string;
  let provider: ReturnType<typeof getStorageProvider>;
  let rollbackStrategy: RuntimeRollbackStrategy_ACU;
  let messageSnapshots: MessageFieldSnapshot_ACU[];
  let oldScopeContainer: any;
  let oldGuideContainer: any;
  try {
    checked = normalizeCheckpointPayload_ACU(parsed);
    chat = getChatArray_ACU();
    targetMessageIndex = getLatestAiMessageIndexFromChat_ACU(chat);
    if (targetMessageIndex < 0) return { success: false, error: '当前聊天没有 AI 楼层，无法恢复 Checkpoint。' };
    isolationKey = getCurrentIsolationKey_ACU();
    provider = getStorageProvider();
    const currentData = provider.getCurrentData();
    const oldData = currentData === null ? null : cloneJson_ACU(currentData);
    const runtimeSnapshot = provider.createRuntimeSnapshot?.();
    if (runtimeSnapshot instanceof Uint8Array) {
      if (typeof provider.restoreRuntimeSnapshot !== 'function') throw new Error('当前表格存储不支持 SQLite 运行时快照回滚。');
      rollbackStrategy = { kind: 'binary', snapshot: runtimeSnapshot };
    } else if (oldData !== null) {
      if (typeof provider.replaceAllData !== 'function') throw new Error('当前表格存储不支持表格数据回滚。');
      rollbackStrategy = { kind: 'data', data: oldData };
    } else {
      if (typeof provider.clearRuntimeData !== 'function') throw new Error('当前表格存储不支持空运行时回滚。');
      rollbackStrategy = { kind: 'empty' };
    }
    if (typeof provider.replaceAllData !== 'function') throw new Error('当前表格存储不支持 Checkpoint 数据恢复。');
    messageSnapshots = captureMessageSnapshots_ACU(chat);
    oldScopeContainer = cloneJson_ACU(peekChatScopedConfigContainer_ACU(chat));
    oldGuideContainer = cloneJson_ACU(peekChatSheetGuideContainer_ACU(chat));
  } catch (error: any) {
    return { success: false, error: error?.message || 'Checkpoint 恢复预检失败。' };
  }
  let vectorManifests: any[] = [];
  try {
    const result = await runTableWriteTransaction_ACU({ source: 'import', reason: 'restoreTableCheckpoint', isolationKey, writeSet: [{ kind: 'all' }], maintenanceMode: 'exclusive' }, async (transactionContext) => {
      return transactionContext.runCommit(async () => {
        const cleared = await clearAllAiTableDataForCheckpointRestore_ACU();
        vectorManifests = cleared.vectorManifestsToDeleteAfterCommit;
        const replaced = await provider.replaceAllData(cloneJson_ACU(checked.tableSnapshot));
        if (!replaced?.success) throw new Error(replaced?.error || 'Checkpoint 表格运行时恢复失败。');
        const templateState = buildChatTemplateScopeStateFromCurrent_ACU({ isolationKey, presetName: checked.templateSnapshot.presetName, source: 'checkpoint_import', templateSource: checked.templateSnapshot.data, guideData: checked.guideSnapshot.data });
        if (!templateState || !setCurrentChatTemplateScopeState_ACU(templateState, { isolationKey, reason: 'checkpoint_import' })) throw new Error('Checkpoint 模板作用域恢复失败。');
        if (!setChatSheetGuideDataForIsolationKey_ACU(isolationKey, checked.guideSnapshot.data, { reason: 'checkpoint_import', syncTemplateScope: false })) throw new Error('Checkpoint 指导表恢复失败。');
        const sheetKeys = Object.keys(checked.tableSnapshot).filter(key => key.startsWith('sheet_'));
        const persisted = await persistTablesToChatMessage_ACU({ targetMessageIndex, tableData: checked.tableSnapshot, targetSheetKeys: sheetKeys, trackingSheetKeys: sheetKeys, trackAsUpdate: false, source: 'import', checkpointReason: 'import', operations: [{ kind: 'data_replace', data: checked.tableSnapshot, reason: 'checkpoint_fallback' }], strictSave: true, assumeCommitLock: true, transactionContext });
        if (!persisted.saved) throw new Error(persisted.error || 'Checkpoint 持久化失败。');
        return { clearedCount: cleared.clearedCount, restoredMessageIndex: persisted.messageIndex ?? targetMessageIndex };
      }, [{ kind: 'all' }]);
    });
    const derivedRefresh = await runCheckpointDerivedRefresh_ACU(checked, isolationKey, vectorManifests);
    return { success: true, ...result, ...derivedRefresh };
  } catch (error: any) {
    restoreMessageSnapshots_ACU(messageSnapshots);
    setChatScopedConfigContainer_ACU(chat, oldScopeContainer);
    setChatSheetGuideContainer_ACU(chat, oldGuideContainer);
    try {
      if (rollbackStrategy.kind === 'binary') {
        await provider.restoreRuntimeSnapshot!(rollbackStrategy.snapshot);
      } else if (rollbackStrategy.kind === 'data') {
        const restored = await provider.replaceAllData!(rollbackStrategy.data);
        if (!restored.success) throw new Error(restored.error || 'Checkpoint 表格运行时回滚失败。');
      } else {
        provider.clearRuntimeData!();
      }
      applyTemplateScopeForCurrentChat_ACU();
      await saveChatToHostStrict_ACU();
    } catch (rollbackError: any) {
      return { success: false, error: `Checkpoint 恢复失败：${error?.message || String(error)}；回滚保存也失败：${rollbackError?.message || String(rollbackError)}` };
    }
    return { success: false, error: error?.message || 'Checkpoint 恢复失败。' };
  }
}
