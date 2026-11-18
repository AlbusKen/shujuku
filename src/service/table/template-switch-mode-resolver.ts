import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { hasLegacyTopLevelTableData_ACU, isLegacyV1TagData_ACU, isV2TagData_ACU } from './storage-strategy-resolver';
import { deriveSheetLifecycleFromFramesV2_ACU } from './storage-frame-v2-replay';
import type { TableStorageFrameV2_ACU } from './storage-frame-v2-types';
import { settings_ACU } from '../runtime/state-manager';

/**
 * 会话级模板切换模式判定。
 *
 * 目标：把散落在调用方的 `storageStrategy.mode === 'empty'` 隐式判断收敛为
 * 基于 V2 frame 真实内容的显式判定，并区分三种语义：
 *
 * - pristine：该 isolationKey 下不存在任何含实质内容的 V2 frame（所有 frame 的
 *   logEntries 为空，checkpoint 与 perSheetCheckpoints 中所有表仅有表头行），
 *   且 lifecycle 中无 hidden / indeterminate 表。切换模板只落配置、不落数据帧。
 * - inherit：存在实质表格数据或隐藏表，走现有继承 + 隐藏逻辑。
 * - blocked：lifecycle 存在 indeterminate，或帧结构无法解析，fail-closed。
 *
 * 判定顺序必须保持：先 blocked（indeterminate / 损坏），再 inherit（hidden 表或实质数据），
 * 最后才是 pristine。任何解析失败都不得当作 pristine。
 */
export type TemplateSwitchMode_ACU =
  | { mode: 'pristine' }
  | { mode: 'inherit' }
  | { mode: 'blocked'; reason: string };

/**
 * 检测聊天中是否存在 legacy（V1 或顶层）表格数据证据。
 * legacy 会话（mode: 'legacy-v1'）可能没有任何 V2 frame，但其表格数据
 * 必须走继承路径，绝不能按 pristine 覆盖式 rekey —— 否则会丢失 legacy 数据。
 */
function chatHasLegacyTableEvidence_ACU(chat: any[], isolationKey: string): boolean {
  const isolationConfig = {
    enabled: Boolean(settings_ACU?.dataIsolationEnabled),
    code: typeof settings_ACU?.dataIsolationCode === 'string' ? settings_ACU.dataIsolationCode : '',
  };
  for (const message of chat) {
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    if (tagData && isLegacyV1TagData_ACU(tagData)) return true;
    if (hasLegacyTopLevelTableData_ACU(message, isolationConfig)) return true;
  }
  return false;
}

function isObjectRecord_ACU(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 判定一个 checkpoint 的 data 中是否存在任何含实质内容（非仅表头）的表。
 * data 可能是 TableDataObject（sheetKey → Sheet）或单表 Sheet 对象。
 */
function checkpointDataHasDataRows_ACU(data: unknown): boolean {
  if (!isObjectRecord_ACU(data)) return false;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('sheet_')) continue;
    if (!isObjectRecord_ACU(value)) return false; // 表结构损坏：无法判定 → 调用方按 blocked 处理
    const content = (value as { content?: unknown }).content;
    if (!Array.isArray(content) || content.length === 0) return false; // 结构损坏 → blocked
    if (content.length > 1) return true; // 存在数据行
  }
  return false;
}

/**
 * 判定单个 Sheet 对象是否含数据行。perSheetCheckpoints 的 data 是单表 Sheet（非 map）。
 */
function sheetHasDataRows_ACU(sheet: unknown): boolean {
  if (!isObjectRecord_ACU(sheet)) return false;
  const content = (sheet as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.length > 1;
}

/**
 * 判定单表 Sheet 结构是否损坏（content 缺失/非数组/空数组）。
 */
function sheetIsMalformed_ACU(sheet: unknown): boolean {
  if (!isObjectRecord_ACU(sheet)) return true;
  const content = (sheet as { content?: unknown }).content;
  return !Array.isArray(content) || content.length === 0;
}

/**
 * 遍历 chat 中该 isolationKey 的全部 V2 frame，返回是否含有任何实质表格内容。
 * 任一帧结构无法解析（logEntries 非数组 / checkpoint 结构损坏）时返回 blocked 信号。
 */
function scanFramesForSubstantialContent_ACU(
  chat: any[],
  isolationKey: string,
): { substantial: boolean; corrupt: boolean } {
  let substantial = false;
  for (const message of chat) {
    if (!message || message.is_user) continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey);
    if (!tagData || typeof tagData !== 'object' || Array.isArray(tagData)) continue;
    // V2 痕迹但结构无法解析：携带 _acu_storage_version:2 或 storageFrame 却非合法 V2 frame
    // 属于损坏的存储痕迹，绝不能当作 pristine（否则会在删除/切换时覆盖真实数据）。
    if (!isV2TagData_ACU(tagData)) {
      const hasV2Trace = (tagData as any)._acu_storage_version === 2
        || (tagData as any).storageFrame !== undefined;
      if (hasV2Trace) return { substantial: false, corrupt: true };
      continue;
    }
    const frame = tagData.storageFrame as TableStorageFrameV2_ACU;
    if (!Array.isArray(frame.logEntries)) return { substantial: false, corrupt: true };
    if (frame.logEntries.length > 0) {
      substantial = true;
      continue;
    }
    if (frame.checkpoint !== undefined && frame.checkpoint !== null) {
      if (!isObjectRecord_ACU(frame.checkpoint)) return { substantial: false, corrupt: true };
      const data = frame.checkpoint.data;
      if (data !== undefined && data !== null) {
        const hasRows = checkpointDataHasDataRows_ACU(data);
        if (hasRows === false) {
          // 结构损坏或纯表头：损坏必须 blocked，纯表头不算实质内容
          if (isObjectRecord_ACU(data)) {
            // 检查是否有表结构损坏（非 sheet_ 键不计入）
            for (const [key, value] of Object.entries(data)) {
              if (!key.startsWith('sheet_')) continue;
              if (!isObjectRecord_ACU(value) || !Array.isArray((value as { content?: unknown }).content) || ((value as { content?: unknown }).content as unknown[]).length === 0) {
                return { substantial: false, corrupt: true };
              }
            }
          } else {
            return { substantial: false, corrupt: true };
          }
        } else if (hasRows === true) {
          substantial = true;
        }
      }
    }
    if (frame.sheetTimelineEvents !== undefined) {
      if (!Array.isArray(frame.sheetTimelineEvents)) return { substantial: false, corrupt: true };
      const ordinals = new Set<number>();
      for (const event of frame.sheetTimelineEvents) {
        if (!event || !Number.isSafeInteger(event.ordinal) || event.ordinal < 0 || ordinals.has(event.ordinal)
          || !isObjectRecord_ACU(event.checkpoint) || !event.checkpoint.timeline) return { substantial: false, corrupt: true };
        ordinals.add(event.ordinal);
        const data = event.checkpoint.data;
        if (sheetIsMalformed_ACU(data)) return { substantial: false, corrupt: true };
        if (sheetHasDataRows_ACU(data)) substantial = true;
      }
    }
    if (frame.perSheetCheckpoints !== undefined && frame.perSheetCheckpoints !== null) {
      if (!isObjectRecord_ACU(frame.perSheetCheckpoints)) return { substantial: false, corrupt: true };
      for (const checkpoint of Object.values(frame.perSheetCheckpoints)) {
        if (!isObjectRecord_ACU(checkpoint)) return { substantial: false, corrupt: true };
        // per-sheet checkpoint 的 data 是单表 Sheet（不是 sheetKey map）
        const data = (checkpoint as { data?: unknown }).data;
        if (data === undefined || data === null) continue;
        if (sheetIsMalformed_ACU(data)) {
          return { substantial: false, corrupt: true };
        }
        if (sheetHasDataRows_ACU(data)) substantial = true;
      }
    }
  }
  return { substantial, corrupt: false };
}

/**
 * 会话级 pristine 判定：确定该 isolationKey 下切换模板应采取的模式。
 */
export function resolveTemplateSwitchMode_ACU(
  chat: any[] | null | undefined,
  isolationKey: string,
): TemplateSwitchMode_ACU {
  const chatArray = Array.isArray(chat) ? chat : [];

  // 0. legacy 数据证据优先：即使没有 V2 frame，legacy 表格数据也必须走继承。
  if (chatHasLegacyTableEvidence_ACU(chatArray, isolationKey)) {
    return { mode: 'inherit' };
  }

  // 1. lifecycle 派生：indeterminate → blocked，hidden → inherit
  const lifecycle = deriveSheetLifecycleFromFramesV2_ACU(chatArray, isolationKey);
  if (lifecycle.indeterminateSheetKeys.length > 0) {
    return {
      mode: 'blocked',
      reason: `表格历史状态不完整或顺序异常（indeterminate: ${lifecycle.indeterminateSheetKeys.join(', ')}），已拒绝切换模板。`,
    };
  }
  if (lifecycle.hiddenSheetKeys.length > 0) {
    // 隐藏表意味着历史上有过数据与切换记录，按 pristine 覆盖会丢掉隐藏表数据。
    return { mode: 'inherit' };
  }

  // 2. 帧内容扫描：存在任何实质内容 → inherit；结构损坏 → blocked
  const scan = scanFramesForSubstantialContent_ACU(chatArray, isolationKey);
  if (scan.corrupt) {
    return { mode: 'blocked', reason: '表格历史帧结构损坏，无法判定会话状态，已拒绝切换模板。' };
  }
  if (scan.substantial) return { mode: 'inherit' };

  // 3. 无任何实质内容 → pristine
  return { mode: 'pristine' };
}
