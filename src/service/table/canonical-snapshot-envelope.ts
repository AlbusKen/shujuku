/**
 * service/table/canonical-snapshot-envelope.ts — CanonicalSnapshotEnvelope 内部契约
 *
 * 阶段 C：同一调用链内可信 canonical 数据的显式载体（不是缓存）。
 *
 * 约束（计划 §3.2）：
 * - 不暴露为公共插件 API；仅本扩展内部 service/table 与 worldbook pipeline 使用。
 * - envelope 只能被当前 orchestration 立即消费；函数返回后不得进入长期 Map、store 或单例。
 * - 构造入口使用白名单（createCanonicalSnapshotEnvelope_ACU），禁止任意调用方自称 canonical。
 * - data 必须是与调用方隔离的深克隆：provider 与 UI/runtime 不共享可变引用。
 * - createdAt 仅用于诊断，不作为 freshness 判据；freshness 由调用方在 hydrate 前后
 *   复核 chat/isolation/storageMode/lifecycleEpoch 决定。
 */

import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { getTableDataFingerprint_ACU } from './table-data-upgrade-audit';

/** 受限来源枚举：envelope 只能由这些权威路径产出。 */
export type CanonicalSnapshotSource_ACU =
  | 'merged_refresh'
  | 'post_save_replay'
  | 'system_reload_replay'
  | 'boundary_commit_head';

/**
 * 同一调用链内可信 canonical 数据的显式载体。
 * 全部字段只读；data 由构造 helper 深克隆，调用方持有副本。
 */
export interface CanonicalSnapshotEnvelope_ACU {
  /** 深克隆的 canonical TableDataObject_ACU。 */
  readonly data: TableDataObject_ACU;
  /** 当前聊天稳定身份（currentChatFileIdentifier_ACU 等）。 */
  readonly chatIdentity: string;
  /** 隔离键（dataIsolationEnabled ? dataIsolationCode : ''）。 */
  readonly isolationKey: string;
  /** 存储模式：仅 sqlite 需要 hydrate；native 不创建 SQLite provider。 */
  readonly storageMode: 'native' | 'sqlite';
  /** 生命周期 epoch：与 table-storage-strategy 的 runtimeLifecycleEpoch_ACU 对齐。 */
  readonly lifecycleEpoch: number;
  /** headRevision / runtime revision 证据：取得到才填，缺失时不得伪造。 */
  readonly headRevision?: string;
  /** 受限来源枚举。 */
  readonly source: CanonicalSnapshotSource_ACU;
  /** 规范化数据指纹：用于测试、诊断和可选运行时复核。 */
  readonly fingerprint: string;
  /** 仅诊断：创建时刻。不是 freshness 判据。 */
  readonly createdAt: number;
}

/** envelope 构造白名单参数：调用方必须显式声明来源与身份。 */
export interface CreateCanonicalSnapshotEnvelopeParams_ACU {
  data: TableDataObject_ACU | Record<string, any> | null | undefined;
  chatIdentity: string;
  isolationKey: string;
  storageMode: 'native' | 'sqlite';
  lifecycleEpoch: number;
  source: CanonicalSnapshotSource_ACU;
  headRevision?: string | null;
}

/**
 * 白名单构造 helper。data 为 null/undefined 时返回 null（禁止伪造 canonical）。
 * data 被深克隆，调用方对入参的后续修改不影响 envelope。
 */
export function createCanonicalSnapshotEnvelope_ACU(
  params: CreateCanonicalSnapshotEnvelopeParams_ACU,
): CanonicalSnapshotEnvelope_ACU | null {
  if (!params.data || typeof params.data !== 'object') return null;
  const data = JSON.parse(JSON.stringify(params.data)) as TableDataObject_ACU;
  return {
    data,
    chatIdentity: String(params.chatIdentity || ''),
    isolationKey: String(params.isolationKey || ''),
    storageMode: params.storageMode,
    lifecycleEpoch: params.lifecycleEpoch,
    ...(params.headRevision ? { headRevision: String(params.headRevision) } : {}),
    source: params.source,
    fingerprint: getTableDataFingerprint_ACU(data),
    createdAt: Date.now(),
  };
}

/**
 * 结构校验：确认对象确实是本契约的 envelope（不含身份比对）。
 * 身份比对（chat/isolation/mode/lifecycle）由调用方在 hydrate 前后执行。
 */
export function isCanonicalSnapshotEnvelope_ACU(
  value: unknown,
): value is CanonicalSnapshotEnvelope_ACU {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CanonicalSnapshotEnvelope_ACU>;
  return typeof candidate.data === 'object'
    && candidate.data !== null
    && typeof candidate.chatIdentity === 'string'
    && typeof candidate.isolationKey === 'string'
    && (candidate.storageMode === 'native' || candidate.storageMode === 'sqlite')
    && typeof candidate.lifecycleEpoch === 'number'
    && (candidate.source === 'merged_refresh'
      || candidate.source === 'post_save_replay'
      || candidate.source === 'system_reload_replay'
      || candidate.source === 'boundary_commit_head')
    && typeof candidate.fingerprint === 'string'
    && typeof candidate.createdAt === 'number';
}
