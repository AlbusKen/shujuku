import type { TableReplayBaseKindV2_ACU, TableReplayCompatibilityRepairV2_ACU, TableReplayResultV2_ACU } from './storage-frame-v2-replay';

/**
 * 阶段 E：单次 v2-replay 的仅内存复用证据。
 *
 * 只在同一宿主进程内存活，绝不写入聊天/存储帧/持久化介质。它记录「上次一次
 * 成功 replay 的完整判定条件」，供同 chat + 同 isolationKey + 同 boundary 的
 * 重复调用直接复用结果，跳过整轮 SQLite 回放。
 *
 * 复用边界刻意最严：只有满足全部条件的成功结果才允许被复用，任何条件不满足
 * 都静默回退冷 replay（fail-open 语义：绝不因 evidence 失效而抛错或返回旧数据）。
 */
export interface V2ReplayEvidence_ACU {
  /** 绑定 chat 数组身份（引用比较）。 */
  chatIdentity: unknown[];
  isolationKey: string;
  /** 目标 boundary：maxMessageIndex（undefined = 到末尾）。 */
  maxMessageIndex?: number;
  /** 复用只允许 full_checkpoint 基。 */
  baseKind: TableReplayBaseKindV2_ACU;
  /** 复用只允许无结构 repair（provisional 也不允许：provisional 需要收敛）。 */
  compatibilityRepairs: readonly TableReplayCompatibilityRepairV2_ACU[] | null;
  requiresCheckpointConvergence?: boolean;
  /** 上次成功 replay 的结果（data 在返回时深克隆，引用不外泄）。 */
  data: TableReplayResultV2_ACU['data'];
  /**
   * chat 内容变化信号：所有 V2 frame 的 headRevision 汇总哈希。chat 数组可能
   * 被原地 mutate（fill run 每批提交后写入新 entry），引用比较无法捕捉内容变化；
   * 复用前必须比对 headRevision 汇总，不一致即失效（fail-open 回退冷 replay）。
   */
  headRevisionDigest: string;
  /**
   * 结构映射信号：当前聊天模板 header-only 快照的指纹。
   * 回放核心用该模板做列重绑/临时补锚的 supplemental evidence；
   * 模板结构变化（全局模板或 chat scope 切换）会使同一冻结历史的结果可能改变，
   * 必须使 evidence 失效（fail-open 回退冷 replay）。
   */
  structureMappingDigest: string;
  /**
   * 影响回放结果的 options 指纹：allowTemporaryTemplateBaseline、
   * compatibilityMode、enableAliasContext。与 buildInflightReplayKey_ACU 的
   * options 段保持一致；任一变化都禁止复用上次结果。
   */
  replayOptionsFingerprint: string;
  /** 生成时间戳（诊断用，不参与判定）。 */
  createdAt: number;
}

/**
 * 归一化影响回放结果的 options 为轻量指纹。
 * 与 in-flight key 的 options 段保持一致；evidence 复用必须携带并比对。
 */
export function buildReplayOptionsFingerprint_ACU(options: {
  allowTemporaryTemplateBaseline?: boolean;
  compatibilityMode?: 'apply' | 'disabled';
  enableAliasContext?: boolean;
}): string {
  return [
    'tpl', options.allowTemporaryTemplateBaseline ? 1 : 0,
    'compat', options.compatibilityMode ?? 'default',
    'alias', options.enableAliasContext === false ? 0 : 1,
  ].join('|');
}

/**
 * 判定 evidence 是否可复用于「同 chat + 同 isolationKey + 同 boundary」的调用。
 *
 * 全部条件必须满足：
 * - chat 引用一致（同一数组对象，杜绝内容漂移误判）；
 * - isolationKey 一致；
 * - boundary（maxMessageIndex）一致；
 * - 上次结果是 full_checkpoint 基（replacement/temporary baseline/transition
 *   基都依赖外部状态，不允许跨调用复用）；
 * - 无任何 compatibility repair（含 provisional：provisional 需要收敛验证，
 *   复用会跳过该验证）；
 * - 无 requiresCheckpointConvergence。
 *
 * 返回 true 才可复用；false 一律走冷 replay。
 */
export function validateV2ReplayEvidenceFresh_ACU(
  evidence: V2ReplayEvidence_ACU | null | undefined,
  chat: unknown[],
  isolationKey: string,
  options: { maxMessageIndex?: number } = {},
  currentHeadRevisionDigest?: string,
  currentStructureMappingDigest?: string,
  currentReplayOptionsFingerprint?: string,
): boolean {
  if (!evidence) return false;
  if (evidence.chatIdentity !== chat) return false;
  if (evidence.isolationKey !== isolationKey) return false;
  // chat 内容可能原地变化（headRevision 递增）。digest 必须严格一致，任意一方为空也按
  // 不一致处理（fail-open：宁可冷 replay 也不复用可能过期的旧数据）。写入与调用使用
  // 同一 computeReplayHeadRevisionDigest_ACU，chat 未变时必然相等；仅 chat 内容变化
  // （且 headRevision 亦变化）才会产生差异，此时必须失效。
  if (evidence.headRevisionDigest !== currentHeadRevisionDigest) return false;
  if (evidence.structureMappingDigest !== currentStructureMappingDigest) return false;
  if (evidence.replayOptionsFingerprint !== currentReplayOptionsFingerprint) return false;
  if (evidence.maxMessageIndex !== options.maxMessageIndex) return false;
  if (evidence.baseKind !== 'full_checkpoint') return false;
  if (evidence.compatibilityRepairs && evidence.compatibilityRepairs.length > 0) return false;
  if (evidence.requiresCheckpointConvergence) return false;
  return true;
}

/**
 * 汇总 chat 内所有 V2 frame 的 headRevision 为一个轻量 digest。
 * 空 chat / 无 V2 frame → 空串（此时引用比较已足够，digest 不额外拦截）。
 * 绝不含聊天正文、单元格或 SQL：只取 headRevision 标识符。
 */
export function computeReplayHeadRevisionDigest_ACU(
  chat: unknown[],
  isolationKey: string,
): string {
  let digest = '';
  if (!Array.isArray(chat)) return digest;
  for (const message of chat) {
    const isolated = (message as Record<string, any> | null | undefined)?.TavernDB_ACU_IsolatedData;
    const frame = isolated?.[isolationKey]?.storageFrame;
    const revision = frame?.headRevision;
    if (typeof revision === 'string' && revision) {
      digest += `${revision}\u0000`;
    }
  }
  return digest;
}
