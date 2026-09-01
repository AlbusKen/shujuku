/**
 * service/template/dormant-data-service.ts — 休眠数据可见性与唤醒（S3-4）
 *
 * 职责：
 * 1. listDormantTables_ACU：从 V2 生命周期投影列出当前聊天的休眠表（含休眠楼层/时间/来源模板）。
 * 2. listDormantColumns_ACU：从运行时模板快照列出各现役表的休眠列（hiddenPhysicalColumns 投影）。
 * 3. wakeDormantTable_ACU / wakeDormantColumn_ACU：构造包含目标项的模板快照，
 *    统一经 applyChatTemplateSnapshotWithReconciliation_ACU 应用——表级唤醒复用协调器的
 *    reveal 链路（含 S1-4 reveal 后列级再协调），列级唤醒复用 canonical 匹配复活链路。
 *    不新增任何持久化写路径。
 *
 * 清单是只读投影：本模块不缓存任何状态，每次调用都从聊天历史/运行时重新派生。
 */

import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { deriveSheetLifecycleFromFramesV2_ACU } from '../table/storage-frame-v2-replay';
import type { Sheet_ACU } from '../../shared/models/table-data';
import { getSheetColumnProjection_ACU } from '../../shared/ddl-utils';
import { buildStableSheetKeyCandidate_ACU, canonicalizeDisplayName_ACU } from '../../shared/sheet-identity';
import { logWarn_ACU } from '../../shared/utils';
import {
  applyChatTemplateSnapshotWithReconciliation_ACU,
  getRuntimeTemplateSnapshot_ACU,
  resolveActiveTemplatePresetName_ACU,
} from './template-preset-service';

/** 休眠表清单条目（展示 + 唤醒前置判定）。 */
export interface DormantTableEntry_ACU {
  sheetKey: string;
  /** 休眠时的表显示名；快照缺失时回退 sheetKey。 */
  name: string;
  /** 休眠快照中的数据行数（不含表头行）。 */
  rowCount: number;
  /** 休眠快照中的列数（不含 row_id 首列）。 */
  columnCount: number;
  /** 休眠事件所在楼层（消息下标）。 */
  hiddenAtMessageIndex?: number;
  /** 休眠时间（毫秒时间戳）；历史 checkpoint 缺失时为 undefined。 */
  hiddenAtTime?: number;
  /** 休眠前活跃的模板预设名；S3-4 之前的历史数据无此信息（undefined，展示层显示「未记录」）。 */
  sourcePresetName?: string;
  /** 唤醒前置判定结果。 */
  canWake: boolean;
  /** canWake=false 时的不可唤醒原因（用户可读）。 */
  wakeBlockedReason?: string;
}

/** 休眠列清单条目。 */
export interface DormantColumnEntry_ACU {
  sheetKey: string;
  /** 所属现役表显示名。 */
  sheetName: string;
  /** 隐藏列的显示表头名。 */
  header: string;
  /** 隐藏集中记录的身份（sqlite=物理列名，native=表头名）；唤醒时以此为准。 */
  hiddenName: string;
}

export interface DormantListResult_ACU<T> {
  ok: boolean;
  entries: T[];
  /** ok=false 时的用户可读错误（区分「无休眠」与「读不出」）。 */
  error?: string;
}

export interface DormantWakeResult_ACU {
  saved: boolean;
  error?: string;
}

/** 休眠完整性问题条目（S3-3）。 */
export interface DormantIntegrityIssue_ACU {
  sheetKey: string;
  /** 可读表名；恢复快照不可用时回退 sheetKey。 */
  name: string;
  kind: 'missing_restore_data' | 'corrupt_restore_data' | 'indeterminate_lifecycle';
  /** 用户可读的问题描述与后果。 */
  message: string;
}

export interface DormantIntegrityAuditResult_ACU {
  /** 生命周期派生是否成功；false 时 issues 为空且 error 给出原因。 */
  ok: boolean;
  issues: DormantIntegrityIssue_ACU[];
  /** 本次审计覆盖的 hidden 表数量（诊断展示用）。 */
  hiddenCount: number;
  error?: string;
}

/** V2 边界内数据均为纯 JSON（与 storage-frame-v2-persist 同语义的克隆）。 */
function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** 从休眠快照统计数据行数/列数；结构异常时返回 0 而不抛错（仅展示用途）。 */
function countRestoreShape_ACU(restore: Sheet_ACU | undefined): { rowCount: number; columnCount: number } {
  const content = Array.isArray(restore?.content) ? restore.content : [];
  const headers = Array.isArray(content[0]) ? content[0] : [];
  return {
    rowCount: Math.max(0, content.length - 1),
    // content[0] 首列为 row_id 占位；展示列数按用户可感知的业务列计。
    columnCount: Math.max(0, headers.length - 1),
  };
}

/** 在模板快照中按 canonical 显示名查找现役表；返回命中的 sheetKey（无则 null）。 */
function findSheetKeyByCanonicalName_ACU(templateObj: Record<string, any>, displayName: string): string | null {
  const canonical = canonicalizeDisplayName_ACU(displayName);
  if (!canonical) return null;
  for (const [key, sheet] of Object.entries(templateObj)) {
    if (!key.startsWith('sheet_')) continue;
    if (canonicalizeDisplayName_ACU((sheet as Sheet_ACU)?.name) === canonical) return key;
  }
  return null;
}

/**
 * 对单个休眠表做唤醒前置判定。列表与唤醒动作共用同一守卫，
 * 保证 UI 显示「可唤醒」与实际唤醒结果一致。
 */
function evaluateWakeGuards_ACU(
  sheetKey: string,
  restore: Sheet_ACU | undefined,
  runtimeTemplateObj: Record<string, any> | null,
): { canWake: boolean; reason?: string } {
  if (!restore || !Array.isArray(restore.content) || !Array.isArray(restore.content[0])) {
    return { canWake: false, reason: '休眠数据快照缺失或损坏，无法唤醒。' };
  }
  const derivedKey = buildStableSheetKeyCandidate_ACU(restore.name);
  if (!derivedKey || derivedKey !== sheetKey) {
    return {
      canWake: false,
      reason: '该表的历史标识与当前名称派生结果不一致（可能休眠前后经历过改名），暂不支持自动唤醒。',
    };
  }
  if (!runtimeTemplateObj) {
    return { canWake: false, reason: '当前运行时模板不可用，无法构造唤醒模板。' };
  }
  const conflictKey = findSheetKeyByCanonicalName_ACU(runtimeTemplateObj, String(restore.name ?? ''));
  if (conflictKey) {
    return {
      canWake: false,
      reason: `当前模板已存在同名表「${String(restore.name ?? '')}」，唤醒会导致数据合并歧义；请先重命名现役表。`,
    };
  }
  return { canWake: true };
}

/**
 * 列出当前聊天（当前隔离键）的全部休眠表。
 *
 * 数据来源：V2 生命周期投影（deriveSheetLifecycleFromFramesV2_ACU）。
 * 派生失败返回 ok=false 错误态——展示层必须区分「没有休眠表」与「历史读不出」。
 */
export function listDormantTables_ACU(): DormantListResult_ACU<DormantTableEntry_ACU> {
  let lifecycle;
  const chat = getChatArray_ACU();
  const isolationKey = getCurrentIsolationKey_ACU();
  try {
    lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, isolationKey);
  } catch (e) {
    logWarn_ACU('[DormantData] 生命周期派生失败，休眠表清单不可用:', e);
    return { ok: false, entries: [], error: `无法读取表格历史（生命周期派生失败）：${e instanceof Error ? e.message : String(e)}` };
  }
  const runtimeSnapshot = getRuntimeTemplateSnapshot_ACU();
  const runtimeTemplateObj = runtimeSnapshot?.templateObj ?? null;
  const entries = lifecycle.hiddenSheetKeys.map((sheetKey): DormantTableEntry_ACU => {
    const entry = lifecycle.statusBySheetKey[sheetKey];
    const restore = entry?.restoreSourceData;
    const { rowCount, columnCount } = countRestoreShape_ACU(restore);
    const guards = evaluateWakeGuards_ACU(sheetKey, restore, runtimeTemplateObj);
    return {
      sheetKey,
      name: String(restore?.name ?? '') || sheetKey,
      rowCount,
      columnCount,
      hiddenAtMessageIndex: entry?.lastTimelineMessageIndex,
      hiddenAtTime: entry?.lastTimelineCreatedAt,
      sourcePresetName: entry?.hideSourcePresetName,
      canWake: guards.canWake,
      ...(guards.reason ? { wakeBlockedReason: guards.reason } : {}),
    };
  });
  return { ok: true, entries };
}

/**
 * 列出当前运行时模板中各现役表的休眠列。
 *
 * 数据来源：运行时模板快照的 hiddenPhysicalColumns 投影（与协调器同一契约：
 * sqlite 隐藏身份=物理列名，native=表头名）。单表投影失败不拖垮整体——
 * 该表跳过并记录警告，其余表正常列出。
 */
export function listDormantColumns_ACU(): DormantListResult_ACU<DormantColumnEntry_ACU> {
  const snapshot = getRuntimeTemplateSnapshot_ACU();
  if (!snapshot?.templateObj) {
    return { ok: false, entries: [], error: '当前运行时模板不可用，无法读取休眠列。' };
  }
  const entries: DormantColumnEntry_ACU[] = [];
  for (const [sheetKey, sheet] of Object.entries(snapshot.templateObj)) {
    if (!sheetKey.startsWith('sheet_')) continue;
    let projection;
    try {
      projection = getSheetColumnProjection_ACU(sheet as Sheet_ACU);
    } catch (e) {
      logWarn_ACU(`[DormantData] 表 ${sheetKey} 列投影失败，休眠列清单跳过该表:`, e);
      continue;
    }
    if (projection.hiddenPhysicalColumns.length === 0) continue;
    const sheetName = String((sheet as Sheet_ACU)?.name ?? '') || sheetKey;
    // 以隐藏集条目为主序：每个 hiddenName 找到对应投影列取表头；
    // 找不到投影列（理论上被投影校验拦截）时以 hiddenName 自身兜底展示。
    for (const hiddenName of projection.hiddenPhysicalColumns) {
      const canonical = hiddenName.toLowerCase();
      const column = projection.columns.find(item => item.hidden && (
        item.physicalName.toLowerCase() === canonical || item.header.toLowerCase() === canonical
      ));
      entries.push({
        sheetKey,
        sheetName,
        header: column?.header || hiddenName,
        hiddenName,
      });
    }
  }
  return { ok: true, entries };
}

/**
 * 休眠完整性自检（S3-3）：校验每个 hidden 表的恢复来源可达，发现孤儿即报告。
 *
 * 纯只读，不做任何修复或写入。判定语义与唤醒守卫（evaluateWakeGuards_ACU 首条）
 * 及 compaction 前滚的 fail-closed 条件（隐藏表缺 restoreSourceData 时拒绝写边界）
 * 保持同源：审计报警的表，唤醒必然被拦、边界前滚必然失败——
 * 及早警告让用户在旧楼层仍在（数据仍可抢救）时处理，而不是事后才暴露。
 *
 * indeterminate 生命周期（无法判定 active/hidden）同样计入警告面：
 * 它意味着该表的历史 checkpoint 链不完整，恢复来源不可达。
 */
export function auditDormantDataIntegrity_ACU(): DormantIntegrityAuditResult_ACU {
  const chat = getChatArray_ACU();
  const isolationKey = getCurrentIsolationKey_ACU();
  let lifecycle;
  try {
    lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, isolationKey);
  } catch (e) {
    return {
      ok: false,
      issues: [],
      hiddenCount: 0,
      error: `无法读取表格历史（生命周期派生失败）：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const issues: DormantIntegrityIssue_ACU[] = [];
  for (const sheetKey of lifecycle.hiddenSheetKeys) {
    const entry = lifecycle.statusBySheetKey[sheetKey];
    const restore = entry?.restoreSourceData;
    if (!restore) {
      issues.push({
        sheetKey,
        name: sheetKey,
        kind: 'missing_restore_data',
        message: `休眠表 ${sheetKey} 的恢复数据缺失：找不到对应的休眠 checkpoint，该表无法唤醒，且在旧楼层被清理后数据将永久丢失。`,
      });
      continue;
    }
    if (!Array.isArray(restore.content) || !Array.isArray(restore.content[0])) {
      const name = String(restore.name ?? '') || sheetKey;
      issues.push({
        sheetKey,
        name,
        kind: 'corrupt_restore_data',
        message: `休眠表「${name}」的恢复数据已损坏（缺少有效表头），该表无法唤醒；请在旧楼层被清理前导出备份。`,
      });
    }
  }
  for (const sheetKey of lifecycle.indeterminateSheetKeys) {
    issues.push({
      sheetKey,
      name: sheetKey,
      kind: 'indeterminate_lifecycle',
      message: `表 ${sheetKey} 的生命周期无法判定（历史 checkpoint 链不完整），其休眠数据的恢复来源不可达。`,
    });
  }
  return { ok: true, issues, hiddenCount: lifecycle.hiddenSheetKeys.length };
}

/**
 * 唤醒一个休眠表：把它的 header-only 结构壳并入当前运行时模板快照，
 * 经协调器应用——协调器识别到模板含派生 key 命中生命周期 hidden 的表后
 * 产出 reveal 变更，持久层从 hide checkpoint 恢复离开时的完整数据（S1-4 再协调对齐结构）。
 *
 * 守卫（与 listDormantTables_ACU 的 canWake 判定一致，fail-loud）：
 * 快照存在且结构有效、派生 key 与历史 key 一致、当前模板无 canonical 同名表。
 */
export async function wakeDormantTable_ACU(
  sheetKey: string,
  options: { signal?: AbortSignal } = {},
): Promise<DormantWakeResult_ACU> {
  const chat = getChatArray_ACU();
  const isolationKey = getCurrentIsolationKey_ACU();
  let lifecycle;
  try {
    lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chat, isolationKey);
  } catch (e) {
    return { saved: false, error: `无法读取表格历史（生命周期派生失败）：${e instanceof Error ? e.message : String(e)}` };
  }
  const entry = lifecycle.statusBySheetKey[sheetKey];
  if (!entry || entry.status !== 'hidden') {
    return { saved: false, error: `表 ${sheetKey} 当前不处于休眠状态，无法唤醒。` };
  }
  const snapshot = getRuntimeTemplateSnapshot_ACU();
  const guards = evaluateWakeGuards_ACU(sheetKey, entry.restoreSourceData, snapshot?.templateObj ?? null);
  if (!guards.canWake) {
    return { saved: false, error: guards.reason || '该休眠表当前不可唤醒。' };
  }
  // header-only 壳：保留结构（表头/DDL/隐藏集/别名/配置），剥掉数据行——
  // 数据由 reveal 链路从 hide checkpoint 权威恢复，模板携带数据行反而会造成重复合并语义。
  const shell = deepClone_ACU(entry.restoreSourceData) as Sheet_ACU;
  shell.content = [shell.content[0]];
  const templateObj = deepClone_ACU(snapshot!.templateObj) as Record<string, any>;
  templateObj[sheetKey] = shell;
  return await applyChatTemplateSnapshotWithReconciliation_ACU(templateObj, {
    source: 'dormant_wake_table',
    presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true, isolationKey }),
    signal: options.signal,
  });
}

/**
 * 唤醒一个休眠列：从当前运行时模板快照中该表的 hiddenPhysicalColumns 移除目标项
 * （大小写不敏感精确匹配隐藏集条目），经协调器应用——该列成为目标可见列后由
 * canonical 匹配复活其数据。
 */
export async function wakeDormantColumn_ACU(
  sheetKey: string,
  hiddenName: string,
  options: { signal?: AbortSignal } = {},
): Promise<DormantWakeResult_ACU> {
  const requested = String(hiddenName ?? '').trim();
  if (!requested) return { saved: false, error: '未指定要唤醒的休眠列。' };
  const snapshot = getRuntimeTemplateSnapshot_ACU();
  if (!snapshot?.templateObj) {
    return { saved: false, error: '当前运行时模板不可用，无法唤醒休眠列。' };
  }
  const templateObj = deepClone_ACU(snapshot.templateObj) as Record<string, any>;
  const sheet = templateObj[sheetKey] as Sheet_ACU | undefined;
  if (!sheet || typeof sheet !== 'object') {
    return { saved: false, error: `当前模板中不存在表 ${sheetKey}，无法唤醒其休眠列。` };
  }
  const rawHidden = sheet.sourceData?.hiddenPhysicalColumns;
  const hidden = Array.isArray(rawHidden) ? rawHidden.map(value => String(value ?? '')) : [];
  const requestedCanonical = requested.toLowerCase();
  const remaining = hidden.filter(value => value.trim().toLowerCase() !== requestedCanonical);
  if (remaining.length === hidden.length) {
    return { saved: false, error: `列「${requested}」不在表「${String(sheet.name ?? sheetKey)}」的休眠集中，无法唤醒。` };
  }
  if (!sheet.sourceData || typeof sheet.sourceData !== 'object') {
    return { saved: false, error: `表 ${sheetKey} 缺少 sourceData，休眠集状态异常。` };
  }
  if (remaining.length > 0) {
    sheet.sourceData.hiddenPhysicalColumns = remaining;
  } else {
    delete sheet.sourceData.hiddenPhysicalColumns;
  }
  return await applyChatTemplateSnapshotWithReconciliation_ACU(templateObj, {
    source: 'dormant_wake_column',
    presetName: resolveActiveTemplatePresetName_ACU({ fallbackToGlobal: true }),
    signal: options.signal,
  });
}
