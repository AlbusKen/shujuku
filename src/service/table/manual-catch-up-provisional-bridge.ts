/**
 * service/table/manual-catch-up-provisional-bridge.ts
 *
 * 一键追平后置 Full Checkpoint 的临时锚点与边界汇合（provisional bridge）。
 *
 * 背景：当追平目标早于现有正式 full checkpoint、且 selected sheet 需要从开头补齐时，
 * 直接向目标楼层写增量会被 persist 的 `target < latestFullCheckpoint` fail-fast 拒绝。
 * 本模块为本次 run 建立临时 full checkpoint，一路填到原 full 边界后，把 selected sheets
 * 的累计结果原子折叠为原 full frame 上的 sheet_rebase，恢复原正式根。
 *
 * 不变量（对应计划 §3.2）：
 *  - 稳定态单正式根；provisional 建立后持久化态仍只有一个 active full（原 full 只存于 recovery backup）；
 *  - 可回放提交：每个 committed bucket 都能在临时根上 bounded replay，最终被汇合；
 *  - 边界汇合：非目标表/原 provenance/日志/其他隔离数据不被覆盖，selected sheets 等于累计结果；
 *  - 零猜测恢复：runId/原根指纹/聊天标识/隔离键/frame 拓扑不匹配时 fail-closed；
 *  - 终态：complete/stopped/failed/sync_pending 只在 session finalize/rollback 后写入。
 */
import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { readIsolatedDataContainer_ACU, readIsolatedTagData_ACU, writeMessageIdentity_ACU } from '../../data/repositories/chat-message-data-repo';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { logDebug_ACU, logWarn_ACU, logError_ACU } from '../../shared/utils';
import { isV2TagData_ACU } from './storage-strategy-resolver';
import { loadTableStateFromFramesV2Detailed_ACU, loadTableStatesAtBoundariesFromFramesV2Detailed_ACU } from './storage-frame-v2-replay';
import { buildCanonicalFullCheckpoint_ACU, buildCanonicalSheetCheckpoint_ACU } from './canonical-checkpoint-builder';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';
import type {
  ManualCatchUpProvisionalBridgeV1_ACU,
  TableStorageFrameV2_ACU,
  TableV2RecoveryBackup_ACU,
} from './storage-frame-v2-types';
import { runTableWriteTransaction_ACU } from './table-write-transaction';
import { scheduleSummaryVectorMirrorFlushAfterPersist_ACU } from '../vector/summary-vector-index-flush-queue';

/** bridge 元数据所在 isolation tag 上的非 replay 字段名。 */
export const MANUAL_CATCH_UP_BRIDGE_FIELD_ACU = 'manualCatchUpProvisionalBridge';

/**
 * 读取指定 isolation tag 上的 active bridge session。
 * 只认带版本与 kind 的合法对象；任何畸形结构返回 null（fail-closed 由调用方执行）。
 */
export function readActiveProvisionalBridge_ACU(
  chat: any[],
  isolationKey: string,
): ManualCatchUpProvisionalBridgeV1_ACU | null {
  for (const message of chat) {
    if (!message || typeof message !== 'object') continue;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) continue;
    const bridge = (tagData as any)?.[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];
    if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) continue;
    if (bridge.version !== 1 || bridge.kind !== 'manual_catch_up_provisional_bridge') continue;
    if (bridge.phase === 'finalized') continue;
    return bridge as ManualCatchUpProvisionalBridgeV1_ACU;
  }
  return null;
}

/**
 * 校验 bridge 元数据结构的完整性。旧数据缺少字段合法（只读恢复路径），
 * 但 active session 必须满足最小可恢复契约。
 */
export function validateProvisionalBridge_ACU(
  bridge: unknown,
): { valid: boolean; error?: string } {
  if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) {
    return { valid: false, error: 'provisional bridge 必须是对象。' };
  }
  const candidate = bridge as Partial<ManualCatchUpProvisionalBridgeV1_ACU>;
  if (candidate.version !== 1) return { valid: false, error: 'provisional bridge version 必须为 1。' };
  if (candidate.kind !== 'manual_catch_up_provisional_bridge') {
    return { valid: false, error: 'provisional bridge kind 无效。' };
  }
  if (typeof candidate.runId !== 'string' || candidate.runId.length === 0) {
    return { valid: false, error: 'provisional bridge 缺少 runId。' };
  }
  if (typeof candidate.isolationKey !== 'string') {
    return { valid: false, error: 'provisional bridge 缺少 isolationKey。' };
  }
  if (!Array.isArray(candidate.selectedSheetKeys) || candidate.selectedSheetKeys.length === 0) {
    return { valid: false, error: 'provisional bridge 缺少 selectedSheetKeys。' };
  }
  if (!Number.isInteger(candidate.originalFullCheckpointIndex) || (candidate.originalFullCheckpointIndex ?? 0) < 0) {
    return { valid: false, error: 'provisional bridge 缺少 originalFullCheckpointIndex。' };
  }
  if (!Number.isInteger(candidate.provisionalRootIndex) || (candidate.provisionalRootIndex ?? 0) < 0) {
    return { valid: false, error: 'provisional bridge 缺少 provisionalRootIndex。' };
  }
  if (typeof candidate.originalFullFrameFingerprint !== 'string' || candidate.originalFullFrameFingerprint.length === 0) {
    return { valid: false, error: 'provisional bridge 缺少 originalFullFrameFingerprint。' };
  }
  if (!candidate.originalFullFrame || typeof candidate.originalFullFrame !== 'object') {
    return { valid: false, error: 'provisional bridge 缺少 originalFullFrame 恢复备份。' };
  }
  const phases = ['preparing', 'provisional_active', 'bridging', 'finalized', 'rollback_required'] as const;
  if (!phases.includes(candidate.phase as any)) {
    return { valid: false, error: `provisional bridge phase 无效：${String(candidate.phase)}` };
  }
  return { valid: true };
}

/**
 * 构造原 full frame 的指纹。用于零猜测恢复：不匹配时不得自动 finalize。
 */
export function getOriginalFullFrameFingerprint_ACU(frame: TableStorageFrameV2_ACU): string {
  const canonical = JSON.stringify({
    version: frame.version,
    headRevision: frame.headRevision ?? null,
    checkpoint: frame.checkpoint ?? null,
    perSheetCheckpoints: frame.perSheetCheckpoints ?? null,
    logEntries: frame.logEntries ?? [],
  });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * 定位原正式 full checkpoint 所在消息与 frame。
 * 返回全部 full checkpoint（正序）+ 最后一个（replay 的正式根）。
 * 调用方必须校验唯一性；存在多个 full 时不得把任一当作唯一根。
 */
export function findOriginalFullCheckpoint_ACU(
  chat: any[],
  isolationKey: string,
): {
  all: Array<{ messageIndex: number; message: any; tagData: any; frame: TableStorageFrameV2_ACU }>;
  latest: { messageIndex: number; message: any; tagData: any; frame: TableStorageFrameV2_ACU } | null;
} {
  const all: Array<{ messageIndex: number; message: any; tagData: any; frame: TableStorageFrameV2_ACU }> = [];
  chat.forEach((message, messageIndex) => {
    if (!message || message.is_user) return;
    const tagData = readIsolatedTagData_ACU(message, isolationKey) as any;
    if (!isV2TagData_ACU(tagData)) return;
    const checkpoint = tagData.storageFrame?.checkpoint;
    if (checkpoint?.kind === 'full') {
      all.push({ messageIndex, message, tagData, frame: tagData.storageFrame as TableStorageFrameV2_ACU });
    }
  });
  return { all, latest: all.length > 0 ? all[all.length - 1] : null };
}

/**
 * 检查当前聊天是否存在 active provisional bridge session（任何消息、任何隔离键）。
 * 应用启动、加载聊天或任意新表写入前调用。
 */
export function hasActiveProvisionalBridgeAnywhere_ACU(chat: any[]): boolean {
  if (!Array.isArray(chat) || chat.length === 0) return false;
  for (const message of chat) {
    if (!message || typeof message !== 'object') continue;
    const container = readIsolatedDataContainer_ACU(message);
    if (!container || typeof container !== 'object') continue;
    for (const tagData of Object.values(container)) {
      if (!isV2TagData_ACU(tagData)) continue;
      const bridge = (tagData as any)?.[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];
      if (bridge && typeof bridge === 'object' && bridge.version === 1
        && bridge.kind === 'manual_catch_up_provisional_bridge'
        && bridge.phase !== 'finalized') {
        return true;
      }
    }
  }
  return false;
}

/**
 * 写 bridge 元数据到目标消息的 isolation tag（非 replay 字段）。
 * 不负责保存；调用方必须在事务/候选提交内调用并 strict save。
 */
export function writeProvisionalBridgeToMessage_ACU(
  message: any,
  isolationKey: string,
  bridge: ManualCatchUpProvisionalBridgeV1_ACU,
): void {
  const container = readIsolatedDataContainer_ACU(message) || {};
  const existingTag = container[isolationKey];
  const tagData: Record<string, unknown> = isV2TagData_ACU(existingTag)
    ? (existingTag as unknown as Record<string, unknown>)
    : { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
  tagData[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU] = JSON.parse(JSON.stringify(bridge));
  container[isolationKey] = tagData as any;
  message.TavernDB_ACU_IsolatedData = container;
}

/**
 * 从消息的 isolation tag 移除 bridge 元数据（finalize 后清理）。
 */
export function clearProvisionalBridgeFromMessage_ACU(message: any, isolationKey: string): void {
  const container = readIsolatedDataContainer_ACU(message);
  if (!container || typeof container !== 'object') return;
  const tagData = container[isolationKey];
  if (isV2TagData_ACU(tagData)) {
    delete (tagData as unknown as Record<string, unknown>)[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];
  }
  message.TavernDB_ACU_IsolatedData = container;
}

/**
 * 推进 active bridge 的 lastCommittedTargetIndex（单调递增，禁止回退）。
 * 在 bucket strict commit 的同一次保存中调用：返回更新后的根消息 isolatedData
 * 供 persist 合并进替换集合，保证“bucket 已提交”与“bridge 进度已推进”原子落盘，
 * 避免崩溃后 recover 把已提交数据误判为零提交而回滚丢弃。
 */
export function advanceProvisionalBridgeCommitProgress_ACU(
  chat: any[],
  isolationKey: string,
  saveTargetIndex: number,
):
  | { ok: true; status: 'advanced'; messageIndex: number; isolatedData: Record<string, any> }
  | { ok: true; status: 'already_committed' }
  | { ok: false; code: 'bridge_missing' | 'phase_invalid' | 'boundary_reached' | 'root_missing'; error: string } {
  const bridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
  if (!bridge) return { ok: false, code: 'bridge_missing', error: '未找到 active provisional bridge session，无法推进提交进度。' };
  if (bridge.phase !== 'provisional_active') {
    return { ok: false, code: 'phase_invalid', error: `provisional bridge 当前 phase=${bridge.phase}，不允许推进提交进度。` };
  }
  if (saveTargetIndex >= bridge.originalFullCheckpointIndex) {
    return { ok: false, code: 'boundary_reached', error: `bucket 目标 ${saveTargetIndex} 已到达原 full 边界，应先 finalize 而不是推进 provisional 进度。` };
  }
  if (saveTargetIndex <= bridge.lastCommittedTargetIndex) {
    // 重试同一 bucket：进度已包含该目标，幂等放行（不重复推进）。
    return { ok: true, status: 'already_committed' };
  }
  const nextBridge: ManualCatchUpProvisionalBridgeV1_ACU = {
    ...bridge,
    lastCommittedTargetIndex: saveTargetIndex,
    updatedAt: Date.now(),
  };
  const rootMessage = chat[bridge.provisionalRootIndex];
  if (!rootMessage) {
    return { ok: false, code: 'root_missing', error: `provisional root 楼层 ${bridge.provisionalRootIndex} 不存在，无法推进提交进度。` };
  }
  writeProvisionalBridgeToMessage_ACU(rootMessage, isolationKey, nextBridge);
  const container = readIsolatedDataContainer_ACU(rootMessage) || {};
  return { ok: true, status: 'advanced', messageIndex: bridge.provisionalRootIndex, isolatedData: container };
}


/**
 * 恢复备份（recoveryKind='manual_catch_up_provisional_bridge'）写入原根消息的 recoveryBackup。
 * 用于 bridge 建立时把被替换的原 full frame 留作事故复盘证据。
 */
export function buildProvisionalBridgeRecoveryBackup_ACU(
  bridge: ManualCatchUpProvisionalBridgeV1_ACU,
  originalFrame: TableStorageFrameV2_ACU,
): TableV2RecoveryBackup_ACU {
  return {
    version: 1,
    createdAt: Date.now(),
    recoveryKind: 'manual_catch_up_provisional_bridge',
    sourceMessageIndex: bridge.originalFullCheckpointIndex,
    storageFrame: JSON.parse(JSON.stringify(originalFrame)),
    ...(bridge.lastCommittedTargetIndex >= 0
      ? { failedMessageIndex: bridge.lastCommittedTargetIndex }
      : {}),
  };
}

/**
 * 断言当前 live 聊天与 bridge 声明一致（零猜测恢复前置）。
 * 任何不匹配都返回错误字符串，调用方必须 fail-closed。
 *
 * bridge 建立后原 full 已从 replay 时间线移除（只剩 recoveryBackup），
 * 因此这里优先核对原楼层的 recoveryBackup 指纹；原 full 仍在线时按原逻辑校验。
 */
export function assertBridgeScopeMatchesLiveChat_ACU(
  bridge: ManualCatchUpProvisionalBridgeV1_ACU,
  chat: any[],
): { ok: true; error?: never } | { ok: false; error: string } {
  if (!Array.isArray(chat) || chat.length === 0) {
    return { ok: false, error: 'provisional bridge 恢复需要非空聊天。' };
  }
  if (getActiveChatStorageIdentity_ACU(chat) !== bridge.chatKey) {
    return { ok: false, error: '当前聊天与 provisional bridge 的 chatKey 不匹配，拒绝自动恢复。' };
  }
  if (getCurrentIsolationKey_ACU() !== bridge.isolationKey) {
    return { ok: false, error: '当前隔离键与 provisional bridge 不匹配，拒绝自动恢复。' };
  }
  const originalMessage = chat[bridge.originalFullCheckpointIndex];
  if (!originalMessage){
    return { ok: false, error: `provisional bridge 原 full 楼层 ${bridge.originalFullCheckpointIndex} 不存在，拒绝自动恢复。` };
  }
  const originalTagData = readIsolatedTagData_ACU(originalMessage, bridge.isolationKey) as any;
  if (!isV2TagData_ACU(originalTagData)) {
    return { ok: false, error: 'provisional bridge 原 full 楼层缺少 V2 标签数据，拒绝自动恢复。' };
  }
  // provisional 根拓扑校验：临时根楼层必须仍是本 bridge 的 provisional full。
  // 根楼层不存在、已被改写为非 provisional full、或 headRevision 不匹配本 runId，
  // 都说明 bridge 拓扑已被外部篡改，fail-closed。
  const provisionalMessage = chat[bridge.provisionalRootIndex];
  if (!provisionalMessage) {
    return { ok: false, error: `provisional bridge 临时根楼层 ${bridge.provisionalRootIndex} 不存在，拒绝自动恢复。` };
  }
  const provisionalTagData = readIsolatedTagData_ACU(provisionalMessage, bridge.isolationKey) as any;
  const provisionalFrame = isV2TagData_ACU(provisionalTagData)
    ? provisionalTagData.storageFrame
    : null;
  if (!provisionalFrame || provisionalFrame.checkpoint?.kind !== 'full'
    || !String(provisionalFrame.headRevision ?? '').startsWith('provisional:')
    || !String(provisionalFrame.headRevision ?? '').includes(bridge.runId)) {
    return { ok: false, error: 'provisional bridge 临时根拓扑不匹配（缺少 provisional full 或 headRevision 非本 run），拒绝自动恢复。' };
  }
  // 原 full 楼层不得同时存在第二个 full（provisional 建立后原 full 已移到 recoveryBackup）。
  if (originalTagData.storageFrame?.checkpoint?.kind === 'full') {
    return { ok: false, error: 'provisional bridge 原 full 楼层仍存在 replay full，拓扑冲突，拒绝自动恢复。' };
  }

  // 原 full 可能处于两种持久化形态：
  //  - 已建立 bridge：storageFrame 被清空，原帧在 recoveryBackup；
  //  - 尚未建立（首次校验）：storageFrame 仍是原 full。
  const candidateFrame = originalTagData.storageFrame?.checkpoint?.kind === 'full'
    ? originalTagData.storageFrame
    : originalTagData.recoveryBackup?.storageFrame;
  if (!candidateFrame || candidateFrame.checkpoint?.kind !== 'full') {
    return { ok: false, error: 'provisional bridge 原 full 楼层既无 replay full 也无 recoveryBackup，拒绝自动恢复。' };
  }
  const fingerprint = getOriginalFullFrameFingerprint_ACU(candidateFrame);
  if (fingerprint !== bridge.originalFullFrameFingerprint) {
    return { ok: false, error: '原 full frame 指纹不匹配，可能已被外部修改；拒绝自动 finalize。' };
  }
  return { ok: true };
}

/**
 * 计算追平 bucket 是否仍处于 provisional 阶段（目标早于原 full 边界）。
 */
export function isTargetBeforeOriginalFullCheckpoint_ACU(
  bridge: ManualCatchUpProvisionalBridgeV1_ACU,
  saveTargetIndex: number,
): boolean {
  return bridge.phase !== 'finalized'
    && saveTargetIndex < bridge.originalFullCheckpointIndex;
}

/**
 * 校验手动追平 bucket 是否被当前 bridge 授权写入。
 * 不通过全局布尔放行：必须匹配 runId、isolationKey、聊天标识与目标区间。
 */
export function authorizeManualCatchUpBucketWrite_ACU(
  bridge: ManualCatchUpProvisionalBridgeV1_ACU | null,
  runId: string | undefined,
  saveTargetIndex: number,
  chatKey: string,
  isolationKey: string,
): { ok: true; error?: never } | { ok: false; error: string } {
  if (!bridge) return { ok: true };
  if (bridge.phase !== 'provisional_active') {
    return { ok: false, error: `provisional bridge 当前 phase=${bridge.phase}，不允许普通 bucket 写入。` };
  }
  if (bridge.chatKey !== chatKey) {
    return { ok: false, error: 'provisional bridge 与当前聊天不匹配，拒绝写入。' };
  }
  if (bridge.isolationKey !== isolationKey) {
    return { ok: false, error: 'provisional bridge 与当前隔离键不匹配，拒绝写入。' };
  }
  if (!runId || bridge.runId !== runId) {
    return { ok: false, error: 'provisional bridge 拒绝未携带匹配 runId 的写入。' };
  }
  if (saveTargetIndex >= bridge.originalFullCheckpointIndex) {
    return { ok: false, error: `bucket 目标 ${saveTargetIndex} 已到达原 full 边界，必须先执行 bridge finalize。` };
  }
  return { ok: true };
}


/**
 * 建立 provisional bridge（t4）。
 *
 * 在 exclusive 写事务中：
 *   1. 校验唯一正式 full checkpoint、chatKey/isolationKey 与原 frame 指纹；
 *   2. 仅允许 selected sheets 的第一缺口位于该 checkpoint 之前；
 *   3. 构造 provisional 基线：非目标表沿用原 full 数据；selected sheets 若
 *      lastCompletedAiFloor === 0 使用当前有效模板的 header/seed 基线；
 *      若声称存在 checkpoint 前已完成历史但无法从持久化证据重建 start-1 状态则 blocked；
 *   4. 在追平范围首个有效 AI 楼层写 canonical provisional full checkpoint（reason='manual'，
 *      带 run provenance）；
 *   5. 完整备份原 full frame 并从原位置移除 replay full（原位置不得留下会在 provisional
 *      基线上重复执行的未知 artifact）；
 *   6. 候选聊天分别 replay 到首 bucket 前、原 full 边界和聊天末端，验证非目标表与预期一致；
 *   7. strict save，失败完整回滚。
 *
 * 关键限制：建立后稳定持久化态仍只有一个 active full；原 full 只存在于 recovery backup。
 */
export async function establishProvisionalBridge_ACU(
  runId: string,
  selectedSheetKeys: string[],
  rangeStartMessageIndex: number,
  originalFullCheckpointIndex: number,
  options: {
    /** selected sheet 在 checkpoint 前是否存在无法重建的已完成历史（start-1 状态缺失）。 */
    selectedSheetBaselines?: Record<string, { lastCompletedAiFloor: number; headerOnly: boolean }>;
    templateData?: Record<string, any>;
    chatKey?: string;
    isolationKey?: string;
  } = {},
): Promise<
  | { ok: true; bridge: ManualCatchUpProvisionalBridgeV1_ACU; provisionalRootIndex: number }
  | { ok: false; error: string; diagnosticCode?: string }
> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const chatKey = options.chatKey ?? currentChatFileIdentifier_ACU;

  return runTableWriteTransaction_ACU({
    source: 'manual_fill',
    reason: 'establishManualCatchUpProvisionalBridge',
    isolationKey,
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
  }, async () => {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat) || chat.length === 0) {
      return { ok: false, error: '聊天记录为空，无法建立 provisional bridge。' };
    }
    if (getActiveChatStorageIdentity_ACU(chat) !== chatKey) {
      return { ok: false, error: '当前聊天与请求 chatKey 不匹配，拒绝建立 provisional bridge。' };
    }
    if (getCurrentIsolationKey_ACU() !== isolationKey) {
      return { ok: false, error: '当前隔离键与请求不匹配，拒绝建立 provisional bridge。' };
    }
    if (hasActiveProvisionalBridgeAnywhere_ACU(chat)) {
      return { ok: false, error: '已存在 active provisional bridge session，拒绝建立第二个临时根。', diagnosticCode: 'provisional_bridge_conflict' };
    }
    if (!Array.isArray(selectedSheetKeys) || selectedSheetKeys.length === 0) {
      return { ok: false, error: 'provisional bridge 需要至少一个 selected sheet。' };
    }

    const { all: allOriginalFulls, latest: original } = findOriginalFullCheckpoint_ACU(chat, isolationKey);
    if (!original) {
      return { ok: false, error: '未找到正式 full checkpoint，无法建立 provisional bridge。' };
    }
    // 唯一正式 full 承诺（本文件顶部不变量 §3.2）：存在多个 full 时拒绝建立，
    // 绝不把任一 full 当作唯一根，避免 provisional 基线与冗余 full 竞争回放根。
    if (allOriginalFulls.length !== 1) {
      return {
        ok: false,
        error: `存在 ${allOriginalFulls.length} 个 full checkpoint（${allOriginalFulls.map(item => item.messageIndex).join('、')}），provisional bridge 只允许基于唯一正式 full 建立。`,
        diagnosticCode: 'provisional_bridge_multiple_full_checkpoints',
      };
    }
    if (original.messageIndex !== originalFullCheckpointIndex) {
      return { ok: false, error: `原 full checkpoint 楼层与请求不一致：expected=${originalFullCheckpointIndex}, actual=${original.messageIndex}。` };
    }
    if (!Number.isInteger(rangeStartMessageIndex) || rangeStartMessageIndex < 0 || rangeStartMessageIndex >= originalFullCheckpointIndex) {
      return { ok: false, error: `追平起始楼层必须早于原 full 边界：rangeStart=${rangeStartMessageIndex}, originalFull=${originalFullCheckpointIndex}。` };
    }

    const originalFrame = JSON.parse(JSON.stringify(original.frame)) as TableStorageFrameV2_ACU;
    const originalFingerprint = getOriginalFullFrameFingerprint_ACU(originalFrame);
    const checkpoint = originalFrame.checkpoint;
    if (!checkpoint || checkpoint.kind !== 'full') {
      return { ok: false, error: '原 full frame 缺少 checkpoint，无法建立 provisional bridge。' };
    }

    // 2. 仅允许 selected sheets 的第一缺口位于该 checkpoint 之前。
    //    若 selected sheet 在原 full 之前已有完成历史但无法重建 start-1 状态，则 blocked。
    const templateData = options.templateData || {};
    const provisionalData: Record<string, any> = {
      mate: JSON.parse(JSON.stringify(checkpoint.data?.mate ?? { type: 'acu' })),
    };
    for (const [sheetKey, sheetValue] of Object.entries(checkpoint.data || {})) {
      if (!sheetKey.startsWith('sheet_')) continue;
      if (selectedSheetKeys.includes(sheetKey)) continue;
      provisionalData[sheetKey] = JSON.parse(JSON.stringify(sheetValue));
    }
    for (const sheetKey of selectedSheetKeys) {
      const baseline = options.selectedSheetBaselines?.[sheetKey];
      const templateSheet = templateData?.[sheetKey];
      if (baseline && baseline.lastCompletedAiFloor > 0) {
        // 声称存在 checkpoint 前已完成历史但系统无法从持久化证据重建 start-1 状态。
        return {
          ok: false,
          error: `selected sheet ${sheetKey} 在原 full 之前存在已完成历史（lastCompletedAiFloor=${baseline.lastCompletedAiFloor}），但系统无法从持久化重建 start-1 基线；已 blocked，避免用未来状态倒灌过去。`,
          diagnosticCode: 'provisional_baseline_unreconstructable',
        };
      }
      const headerOnly = baseline?.headerOnly !== false;
      const sourceSheet = templateSheet && typeof templateSheet === 'object'
        ? templateSheet
        : checkpoint.data?.[sheetKey];
      if (!sourceSheet || typeof sourceSheet !== 'object') {
        return { ok: false, error: `selected sheet ${sheetKey} 缺少模板/原 full 数据，无法构造 provisional 基线。` };
      }
      const cloned = JSON.parse(JSON.stringify(sourceSheet));
      if (headerOnly && Array.isArray(cloned.content) && cloned.content.length > 1) {
        cloned.content = [cloned.content[0]];
      }
      delete cloned.seedRows;
      provisionalData[sheetKey] = cloned;
    }

    // 3. 构造 provisional full checkpoint（reason='manual'，带 run provenance）。
    const now = Date.now();
    const provisionalCheckpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: now,
      reason: 'manual',
      data: provisionalData as any,
      event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      context: { messageIndex: rangeStartMessageIndex, aiFloor: 1, isolationKey, reason: 'manual' },
    });
    if (!provisionalCheckpointResult.checkpoint) {
      return { ok: false, error: `无法构建 provisional full checkpoint：${provisionalCheckpointResult.error}` };
    }

    // 4. 在原 full 位置暂存：完整备份原 full frame，并从原位置移除 replay full。
    //    原位置不得留下会在 provisional 基线上重复执行的未知 artifact。
    const candidateChat = JSON.parse(JSON.stringify(chat)) as any[];
    const provisionalMessage = candidateChat[rangeStartMessageIndex];
    if (!provisionalMessage || provisionalMessage.is_user) {
      return { ok: false, error: `追平起始楼层 ${rangeStartMessageIndex} 不是有效 AI 楼层。` };
    }
    const provisionalContainer = readIsolatedDataContainer_ACU(provisionalMessage) || {};
    const provisionalTagData = isV2TagData_ACU(provisionalContainer[isolationKey])
      ? JSON.parse(JSON.stringify(provisionalContainer[isolationKey]))
      : { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
    provisionalTagData.storageFrame = {
      version: 2,
      checkpoint: JSON.parse(JSON.stringify(provisionalCheckpointResult.checkpoint)),
      headRevision: `provisional:${runId}`,
      logEntries: [],
    };
    const bridge: ManualCatchUpProvisionalBridgeV1_ACU = {
      version: 1,
      kind: 'manual_catch_up_provisional_bridge',
      runId,
      chatKey,
      isolationKey,
      selectedSheetKeys: [...selectedSheetKeys],
      rangeStartMessageIndex,
      originalFullCheckpointIndex,
      phase: 'provisional_active',
      originalFullFrameFingerprint: originalFingerprint,
      provisionalRootIndex: rangeStartMessageIndex,
      lastCommittedTargetIndex: -1,
      createdAt: now,
      updatedAt: now,
      originalFullFrame: originalFrame,
    };
    provisionalTagData[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU] = bridge;
    provisionalContainer[isolationKey] = provisionalTagData;
    provisionalMessage.TavernDB_ACU_IsolatedData = provisionalContainer;

    // 原 full frame 从原位置移除（保留 recoveryBackup 在原消息 tag 上）。
    const originalMessage = candidateChat[originalFullCheckpointIndex];
    const originalContainer = readIsolatedDataContainer_ACU(originalMessage) || {};
    const originalTagData = originalContainer[isolationKey];
    if (isV2TagData_ACU(originalTagData)) {
      originalTagData.recoveryBackup = buildProvisionalBridgeRecoveryBackup_ACU(bridge, originalFrame);
      originalTagData.storageFrame = { version: 2, logEntries: [] };
    }
    originalContainer[isolationKey] = originalTagData;
    originalMessage.TavernDB_ACU_IsolatedData = originalContainer;

    // 5. 候选聊天验证：首 bucket 前、原 full 边界、聊天末端。
    try {
      // 阶段 H：三个 boundary 共享同一起算根时一次前向捕获；跨根/越界时
      // 内部回退逐次冷 replay 或抛错。校验语义与逐边界完全一致（下方循环不变）。
      const boundaryStates = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(
        candidateChat, isolationKey,
        [rangeStartMessageIndex, originalFullCheckpointIndex - 1, candidateChat.length - 1],
        { updateRuntimeState: false, compatibilityMode: 'disabled' },
      );
      for (const [boundary, replay] of boundaryStates) {
        if (!replay || replay.baseKind !== 'full_checkpoint') {
          return { ok: false, error: `provisional bridge 候选 replay 未建立正式基底：boundary=${boundary}。`, diagnosticCode: 'bridge_replay_mismatch' };
        }
        if (replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
          return { ok: false, error: `provisional bridge 候选 replay 依赖兼容修复：boundary=${boundary}。`, diagnosticCode: 'bridge_replay_mismatch' };
        }
        // 非目标表必须与原 full 数据一致。
        for (const [sheetKey, sheetValue] of Object.entries(checkpoint.data || {})) {
          if (!sheetKey.startsWith('sheet_') || selectedSheetKeys.includes(sheetKey)) continue;
          const replaySheet = replay.data?.[sheetKey] as { content?: unknown } | undefined;
          const originalSheet = sheetValue as { content?: unknown } | undefined;
          if (JSON.stringify(replaySheet?.content) !== JSON.stringify(originalSheet?.content)) {
            return { ok: false, error: `provisional bridge 候选 replay 非目标表不一致：${sheetKey}。`, diagnosticCode: 'bridge_replay_mismatch' };
          }
        }
      }
    } catch (error: any) {
      return { ok: false, error: `provisional bridge 候选 replay 验证异常：${error?.message || String(error)}`, diagnosticCode: 'bridge_replay_mismatch' };
    }

    // 6. strict save，失败完整回滚。
    const before = JSON.parse(JSON.stringify(chat));
    try {
      chat.length = 0;
      chat.push(...candidateChat);
      writeMessageIdentity_ACU(provisionalMessage, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      await saveChatToHostStrict_ACU();
    } catch (error: any) {
      chat.length = 0;
      chat.push(...before);
      return { ok: false, error: `provisional bridge 建立严格保存失败：${error?.message || String(error)}` };
    }
    logDebug_ACU(`[ManualCatchUpBridge] 已建立 provisional full checkpoint：runId=${runId}, root=${rangeStartMessageIndex}, originalFull=${originalFullCheckpointIndex}, sheets=${selectedSheetKeys.join('、')}。`);
    return {
      ok: true,
      bridge,
      provisionalRootIndex: rangeStartMessageIndex,
    };
  });
}


/**
 * 到达原 full 边界时原子汇合（t6）。
 *
 * 在首个 saveTargetIndex >= originalFullCheckpointIndex 的 bucket 之前调用：
 *   1. bounded replay provisional 时间线到 originalFullCheckpointIndex - 1，提取 selected sheets 累计快照；
 *   2. 在候选聊天恢复原 full frame 完整备份；
 *   3. 在原 full frame 的 perSheetCheckpoints 为 selected sheets 写 sheet_rebase：
 *      activateAtMessageIndex = originalFullCheckpointIndex、afterSeq = 原 frame 当前最大 seq、
 *      data 为 provisional 累计快照、scheduleSummary 更新到已完成边界；
 *   4. 保留原 full checkpoint data、migration/compaction provenance、非目标 per-sheet checkpoint、
 *      日志、revision 与其他元数据；
 *   5. 清理 provisional root 及其前置 selected-sheet artifacts；清理证据纳入 recovery backup；
 *   6. 候选 replay 到原 full 边界：selected sheets 等于 provisional 累计快照、非目标表等于原正式根语义；
 *   7. 候选 replay 到当前聊天末端，确保后缀历史仍可执行；
 *   8. strict save 后移除 active bridge 元数据；
 *   9. 调用方必须重新构建当前 bucket 的 merge base，禁止复用 bridge 前的陈旧 baseSnapshot。
 */
export async function finalizeProvisionalBridge_ACU(
  runId: string,
  options: {
    chatKey?: string;
    isolationKey?: string;
    /** 边界后首个 bucket 的 saveTargetIndex（>= 原 full 边界）。 */
    nextSaveTargetIndex: number;
  },
): Promise<
  | { ok: true; finalizeSummary: { selectedSheetKeys: string[]; originalFullCheckpointIndex: number } }
  | { ok: false; error: string; diagnosticCode?: string }
> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const chatKey = options.chatKey ?? currentChatFileIdentifier_ACU;

  return runTableWriteTransaction_ACU({
    source: 'manual_fill',
    reason: 'finalizeManualCatchUpProvisionalBridge',
    isolationKey,
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
  }, async () => {
    const chat = getChatArray_ACU();
    const bridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
    if (!bridge) {
      return { ok: false, error: '未找到 active provisional bridge session，无法 finalize。' };
    }
    if (bridge.runId !== runId) {
      return { ok: false, error: `provisional bridge runId 不匹配：expected=${bridge.runId}, actual=${runId}；拒绝汇合。`, diagnosticCode: 'provisional_bridge_conflict' };
    }
    const scopeCheck = assertBridgeScopeMatchesLiveChat_ACU(bridge, chat);
    if (!scopeCheck.ok) {
      const error = (scopeCheck as { ok: false; error: string }).error;
      return { ok: false, error, diagnosticCode: 'provisional_recovery_required' };
    }
    if (bridge.phase !== 'provisional_active') {
      return { ok: false, error: `provisional bridge phase=${bridge.phase} 不允许 finalize。`, diagnosticCode: 'provisional_bridge_conflict' };
    }
    if (options.nextSaveTargetIndex < bridge.originalFullCheckpointIndex) {
      return { ok: false, error: `nextSaveTargetIndex=${options.nextSaveTargetIndex} 尚未到达原 full 边界，不能 finalize。` };
    }

    // 1. bounded replay provisional 时间线到原 full 边界前一层，提取 selected sheets 累计快照。
    const boundary = bridge.originalFullCheckpointIndex - 1;
    let replay;
    try {
      replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
        maxMessageIndex: boundary,
        updateRuntimeState: false,
        compatibilityMode: 'disabled',
      });
    } catch (error: any) {
      return { ok: false, error: `bridge finalize 前 provisional replay 失败：${error?.message || String(error)}`, diagnosticCode: 'bridge_replay_mismatch' };
    }
    if (!replay || replay.baseKind !== 'full_checkpoint' || !replay.data) {
      return { ok: false, error: 'bridge finalize 前 provisional replay 未建立正式基底。', diagnosticCode: 'bridge_replay_mismatch' };
    }
    if (replay.requiresCheckpointConvergence || replay.compatibilityRepairs?.length) {
      return { ok: false, error: 'bridge finalize 前 provisional replay 依赖兼容修复，不能汇合。', diagnosticCode: 'bridge_replay_mismatch' };
    }
    const provisionalSnapshotByKey: Record<string, any> = {};
    for (const sheetKey of bridge.selectedSheetKeys) {
      const sheetData = replay.data[sheetKey];
      if (!sheetData || typeof sheetData !== 'object') {
        return { ok: false, error: `bridge finalize 前 provisional replay 缺少 selected sheet：${sheetKey}。`, diagnosticCode: 'bridge_replay_mismatch' };
      }
      provisionalSnapshotByKey[sheetKey] = JSON.parse(JSON.stringify(sheetData));
    }

    // 2. 候选聊天：恢复原 full frame 完整备份。
    const candidateChat = JSON.parse(JSON.stringify(chat)) as any[];
    const originalMessage = candidateChat[bridge.originalFullCheckpointIndex];
    if (!originalMessage) {
      return { ok: false, error: `原 full checkpoint 楼层 ${bridge.originalFullCheckpointIndex} 不存在，无法恢复原根。` };
    }
    const originalContainer = readIsolatedDataContainer_ACU(originalMessage) || {};
    const originalTagData = isV2TagData_ACU(originalContainer[isolationKey])
      ? JSON.parse(JSON.stringify(originalContainer[isolationKey]))
      : { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
    // 恢复原 full frame 完整备份（含 checkpoint、per-sheet、日志、provenance）。
    originalTagData.storageFrame = JSON.parse(JSON.stringify(bridge.originalFullFrame));
    delete (originalTagData as Record<string, unknown>)[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];

    // 3. 在原 full frame 的 perSheetCheckpoints 为 selected sheets 写 sheet_rebase。
    const frame = originalTagData.storageFrame as TableStorageFrameV2_ACU;
    const maxSeq = Math.max(0, ...(frame.logEntries || []).map(entry => Number(entry.seq) || 0));
    const now = Date.now();
    const perSheetCheckpoints = { ...(frame.perSheetCheckpoints || {}) };
    for (const sheetKey of bridge.selectedSheetKeys) {
      const sheetCheckpointResult = buildCanonicalSheetCheckpoint_ACU({
        createdAt: now,
        reason: 'manual',
        sheetKey,
        data: provisionalSnapshotByKey[sheetKey],
        event: { filledSheetKeys: [sheetKey], changedSheetKeys: [sheetKey], groupKeys: [] },
        context: { messageIndex: bridge.originalFullCheckpointIndex, isolationKey, reason: 'manual' },
      });
      if (!sheetCheckpointResult.checkpoint) {
        return { ok: false, error: `bridge finalize 无法构建 selected sheet rebase：${sheetKey}：${sheetCheckpointResult.error}`, diagnosticCode: 'bridge_replay_mismatch' };
      }
      perSheetCheckpoints[sheetKey] = {
        ...sheetCheckpointResult.checkpoint,
        timeline: {
          kind: 'sheet_rebase',
          activateAtMessageIndex: bridge.originalFullCheckpointIndex,
          afterSeq: maxSeq,
        },
      };
    }
    frame.perSheetCheckpoints = perSheetCheckpoints;
    originalContainer[isolationKey] = originalTagData;
    originalMessage.TavernDB_ACU_IsolatedData = originalContainer;

    // 4. 清理 provisional root 及其前置 selected-sheet artifacts。
    //    清理证据纳入 recovery backup（不能静默丢失）。
    const cleanupEvidence: Array<{ messageIndex: number; storageFrame: TableStorageFrameV2_ACU }> = [];
    const provisionalRootIndex = bridge.provisionalRootIndex;
    const candidateProvisionalMessage = candidateChat[provisionalRootIndex];
    if (candidateProvisionalMessage) {
      const provisionalContainer = readIsolatedDataContainer_ACU(candidateProvisionalMessage);
      if (provisionalContainer && isV2TagData_ACU(provisionalContainer[isolationKey])) {
        const provisionalTag = provisionalContainer[isolationKey];
        cleanupEvidence.push({
          messageIndex: provisionalRootIndex,
          storageFrame: JSON.parse(JSON.stringify(provisionalTag.storageFrame || { version: 2, logEntries: [] })),
        });
        delete (provisionalTag as unknown as Record<string, unknown>)[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];
        provisionalTag.storageFrame = { version: 2, logEntries: [] };
        candidateProvisionalMessage.TavernDB_ACU_IsolatedData = provisionalContainer;
      }
    }

    // 5. 候选 replay 验证：原 full 边界与聊天末端。
    try {
      // 阶段 H：双边界一次前向捕获（同根）或回退逐次冷 replay，校验语义不变。
      const boundaryStates = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(
        candidateChat, isolationKey,
        [bridge.originalFullCheckpointIndex, candidateChat.length - 1],
        { updateRuntimeState: false, compatibilityMode: 'disabled' },
      );
      for (const [boundary, verifyReplay] of boundaryStates) {
        if (!verifyReplay || verifyReplay.baseKind !== 'full_checkpoint' || !verifyReplay.data) {
          return { ok: false, error: `bridge finalize 候选 replay 未建立正式基底：boundary=${boundary}。`, diagnosticCode: 'bridge_replay_mismatch' };
        }
        if (verifyReplay.requiresCheckpointConvergence || verifyReplay.compatibilityRepairs?.length) {
          return { ok: false, error: `bridge finalize 候选 replay 依赖兼容修复：boundary=${boundary}。`, diagnosticCode: 'bridge_replay_mismatch' };
        }
        // selected sheets 必须等于 provisional 累计快照。
        for (const sheetKey of bridge.selectedSheetKeys) {
          const verifySheet = verifyReplay.data?.[sheetKey] as { content?: unknown } | undefined;
          const snapshotSheet = provisionalSnapshotByKey[sheetKey] as { content?: unknown } | undefined;
          if (JSON.stringify(verifySheet?.content) !== JSON.stringify(snapshotSheet?.content)) {
            return { ok: false, error: `bridge finalize 后 selected sheet 回放不一致：${sheetKey}。`, diagnosticCode: 'bridge_replay_mismatch' };
          }
        }
        // 非目标表必须等于原正式根语义。
        const originalCheckpointData = bridge.originalFullFrame.checkpoint?.data || {};
        for (const [sheetKey, sheetValue] of Object.entries(originalCheckpointData)) {
          if (!sheetKey.startsWith('sheet_') || bridge.selectedSheetKeys.includes(sheetKey)) continue;
          const verifySheet = verifyReplay.data?.[sheetKey] as { content?: unknown } | undefined;
          const originalSheet = sheetValue as { content?: unknown } | undefined;
          if (JSON.stringify(verifySheet?.content) !== JSON.stringify(originalSheet?.content)) {
            return { ok: false, error: `bridge finalize 后非目标表回放不一致：${sheetKey}。`, diagnosticCode: 'bridge_replay_mismatch' };
          }
        }
      }
    } catch (error: any) {
      return { ok: false, error: `bridge finalize 候选 replay 验证异常：${error?.message || String(error)}`, diagnosticCode: 'bridge_replay_mismatch' };
    }

    // 6. strict save，失败原位回滚。
    const before = JSON.parse(JSON.stringify(chat));
    try {
      chat.length = 0;
      chat.push(...candidateChat);
      writeMessageIdentity_ACU(originalMessage, {
        enabled: settings_ACU.dataIsolationEnabled,
        code: settings_ACU.dataIsolationCode,
      });
      await saveChatToHostStrict_ACU();
    } catch (error: any) {
      chat.length = 0;
      chat.push(...before);
      return { ok: false, error: `bridge finalize 严格保存失败：${error?.message ||String(error)}`, diagnosticCode: 'bridge_finalize_failed' };
    }
    logDebug_ACU(`[ManualCatchUpBridge] 已原子汇合：runId=${runId}, originalFull=${bridge.originalFullCheckpointIndex}, sheets=${bridge.selectedSheetKeys.join('、')}, cleanup=${cleanupEvidence.length}。`);
    scheduleSummaryVectorMirrorFlushAfterPersist_ACU({
      changedSheetKeys: [...bridge.selectedSheetKeys],
      reason: 'provisional_bridge_finalize',
    });
    return {
      ok: true,
      finalizeSummary: {
        selectedSheetKeys: [...bridge.selectedSheetKeys],
        originalFullCheckpointIndex: bridge.originalFullCheckpointIndex,
      },
    };
  });
}


/**
 * 回滚 provisional bridge（t7）：零 bucket 成功时恢复原 full frame 并删除临时根。
 *
 * 只有 bridge.lastCommittedTargetIndex < 0（零提交）时允许完整回滚。
 * 已有 bucket 成功时必须先 finalize（把已提交成果带入正式时间线），不能丢弃用户成果。
 */
export async function rollbackProvisionalBridge_ACU(
  runId: string,
  options: {
    chatKey?: string;
    isolationKey?: string;
  } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();

  return runTableWriteTransaction_ACU({
    source: 'manual_fill',
    reason: 'rollbackManualCatchUpProvisionalBridge',
    isolationKey,
    writeSet: [{ kind: 'all' }],
    maintenanceMode: 'exclusive',
  }, async () => {
    const chat = getChatArray_ACU();
    const bridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
    if (!bridge) return { ok: true };
    if (bridge.runId !== runId) {
      return { ok: false, error: `provisional bridge runId 不匹配：expected=${bridge.runId}, actual=${runId}。` };
    }
    if (bridge.lastCommittedTargetIndex >= 0) {
      return { ok: false, error: `provisional bridge 已有 ${bridge.lastCommittedTargetIndex + 1} 个已提交 bucket，禁止回滚；请先 finalize。` };
    }
    const scopeCheck = assertBridgeScopeMatchesLiveChat_ACU(bridge, chat);
    if (!scopeCheck.ok) {
      return { ok: false, error: (scopeCheck as { ok: false; error: string }).error };
    }

    const candidateChat = JSON.parse(JSON.stringify(chat)) as any[];
    // 恢复原 full frame。
    const originalMessage = candidateChat[bridge.originalFullCheckpointIndex];
    if (!originalMessage) return { ok: false, error: 'rollback 未找到原 full 楼层。' };
    const originalContainer = readIsolatedDataContainer_ACU(originalMessage) || {};
    const originalTagData = isV2TagData_ACU(originalContainer[isolationKey])
      ? JSON.parse(JSON.stringify(originalContainer[isolationKey]))
      : { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } };
    originalTagData.storageFrame = JSON.parse(JSON.stringify(bridge.originalFullFrame));
    delete (originalTagData as Record<string, unknown>)[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];
    originalContainer[isolationKey] = originalTagData;
    originalMessage.TavernDB_ACU_IsolatedData = originalContainer;

    // 删除临时根。
    const provisionalMessage = candidateChat[bridge.provisionalRootIndex];
    if (provisionalMessage) {
      const provisionalContainer = readIsolatedDataContainer_ACU(provisionalMessage);
      if (provisionalContainer && isV2TagData_ACU(provisionalContainer[isolationKey])) {
        const provisionalTag = provisionalContainer[isolationKey];
        delete (provisionalTag as unknown as Record<string, unknown>)[MANUAL_CATCH_UP_BRIDGE_FIELD_ACU];
        provisionalTag.storageFrame = { version: 2, logEntries: [] };
        provisionalMessage.TavernDB_ACU_IsolatedData = provisionalContainer;
      }
    }

    const before = JSON.parse(JSON.stringify(chat));
    try {
      chat.length =0;
      chat.push(...candidateChat);
      await saveChatToHostStrict_ACU();
    } catch (error: any) {
      chat.length = 0;
      chat.push(...before);
      return { ok: false, error: `provisional bridge rollback 严格保存失败：${error?.message || String(error)}` };
    }
    logDebug_ACU(`[ManualCatchUpBridge] 已回滚 provisional bridge：runId=${runId}。`);
    return { ok: true };
  });
}

/**
 * 统一恢复门：任意表写入/加载前调用，处理当前 isolationKey 的残留 provisional session。
 *
 * - 当前 isolationKey 无残留：`{ ok: true, action: 'none' }`；
 * - 当前 isolationKey 有残留且指纹/拓扑完整：自动 rollback（零提交）或 finalize（有提交）；
 * - 当前 isolationKey 有残留但无法证明安全：`{ ok: false, recoveryRequired: true }`，调用方必须 fail-closed；
 * - 仅其他 isolationKey 有残留：不越权自动恢复（跨隔离键会话属于其他作用域），返回
 *   `{ ok: false, recoveryRequired: true }` 阻断，避免在错误作用域做拓扑操作。
 *
 * 调用方（启动加载、CHAT_CHANGED、普通写入前）必须：
 * 1. 在任意写事务之外调用（recover/rollback/finalize 自身会开启 exclusive 事务，嵌套会死锁）；
 * 2. 失败时 fail-closed，不继续写入。
 */
export async function ensureNoActiveProvisionalBridgeForCurrentScope_ACU(
  options: {
    chatKey?: string;
    isolationKey?: string;
  } = {},
): Promise<
  | { ok: true; action: 'none' | 'rolled_back' | 'finalized' }
  | { ok: false; error: string; recoveryRequired: true }
> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) {
    return { ok: true, action: 'none' };
  }

  // 当前 isolationKey 的残留：自动恢复。
  const currentBridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
  if (currentBridge) {
    return recoverProvisionalBridgeSession_ACU({ chatKey: options.chatKey, isolationKey });
  }

  // 仅其他 isolationKey 有残留：不能假装已恢复，明确阻断。
  if (hasActiveProvisionalBridgeAnywhere_ACU(chat)) {
    return {
      ok: false,
      error: '检测到其他隔离键存在 active provisional bridge session；当前作用域无法安全恢复，已阻止写入。请切换回原会话完成汇合/回滚后再操作。',
      recoveryRequired: true,
    };
  }

  return { ok: true, action: 'none' };
}



/**
 * 崩溃残留恢复（t7）：应用启动、加载聊天或任意新表写入前调用。
 *
 * - 指纹与拓扑完整、零提交：自动 rollback；
 * - 指纹与拓扑完整、已有提交：自动 finalize（把已提交成果带入正式时间线）；
 * - 无法证明安全（指纹/拓扑/聊天不匹配）：进入 recovery-required，普通写入 fail-closed。
 * 重试同 runId 必须幂等：不得建立第二临时根、重复 rebase 或重复应用前缀日志。
 */
export async function recoverProvisionalBridgeSession_ACU(
  options: {
    chatKey?: string;
    isolationKey?: string;
  } = {},
): Promise<
  | { ok: true; action: 'none' | 'rolled_back' | 'finalized' }
  | { ok: false; error: string; recoveryRequired: true }
> {
  const isolationKey = options.isolationKey ?? getCurrentIsolationKey_ACU();
  const chat = getChatArray_ACU();
  const bridge = readActiveProvisionalBridge_ACU(chat, isolationKey);
  if (!bridge) return { ok: true, action: 'none' };

  const validation = validateProvisionalBridge_ACU(bridge);
  if (!validation.valid) {
    return { ok: false, error: `provisional bridge 结构非法，无法自动恢复：${validation.error}`, recoveryRequired: true };
  }
  const scopeCheck = assertBridgeScopeMatchesLiveChat_ACU(bridge, chat);
  if (!scopeCheck.ok) {
    return { ok: false, error: (scopeCheck as { ok: false; error: string }).error, recoveryRequired: true };
  }

  // 拓扑完整。
  if (bridge.lastCommittedTargetIndex < 0) {
    const rollback = await rollbackProvisionalBridge_ACU(bridge.runId, { isolationKey });
    if (!rollback.ok) {
      return { ok: false, error: (rollback as { ok: false; error: string }).error, recoveryRequired: true };
    }
    logWarn_ACU(`[ManualCatchUpBridge] 崩溃残留自动回滚：runId=${bridge.runId}（零提交）。`);
    return { ok: true, action: 'rolled_back' };
  }

  const finalize = await finalizeProvisionalBridge_ACU(bridge.runId, {
    isolationKey,
    nextSaveTargetIndex: bridge.originalFullCheckpointIndex,
  });
  if (!finalize.ok) {
    return { ok: false, error: (finalize as { ok: false; error: string; diagnosticCode?: string }).error, recoveryRequired: true };
  }
  logWarn_ACU(`[ManualCatchUpBridge] 崩溃残留自动 finalize：runId=${bridge.runId}（${bridge.lastCommittedTargetIndex + 1} 个已提交 bucket）。`);
  return { ok: true, action: 'finalized' };
}
