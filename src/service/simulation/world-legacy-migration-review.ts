/**
 * 旧账本迁移归档详情的只读复核。
 *
 * 该复核只消除已由独立归档快照严格证明的「详情不可用」假缺口；它不回写账本，
 * 不推断事实、里程碑或时间语义，也不把旧资料提升为新领域数据。
 */
import type { WorldChronicleArchiveSnapshot_ACU } from './agent/agent-model';
import type { WorldLegacyMigrationIssue_ACU, WorldSimulationLedger_ACU } from './model';
import {
  validateWorldSimulationChronicleArchiveSnapshot_ACU,
  validateWorldSimulationLedger_ACU,
} from './simulation-store';

export interface WorldLegacyMigrationReview_ACU {
  issues: WorldLegacyMigrationIssue_ACU[];
  archiveDetailAvailableIds: string[];
  unresolvedArchiveIds: string[];
}

/**
 * 只有旧目录行与快照详情可无歧义互证时，才将该 archive_detail_unavailable 标为可读。
 * 概览没有正文或来源纪要 ID，因此不把摘要、自由文本时间或详情内容解释成事实。
 */
function hasMatchingArchiveDetail_ACU(
  ledger: WorldSimulationLedger_ACU,
  archive: WorldChronicleArchiveSnapshot_ACU,
  archiveRef: string,
): boolean {
  const overviewRows = ledger.chronicleOverview.filter(row => row.archiveRef === archiveRef);
  if (overviewRows.length !== 1) return false;

  const detail = archive.records[archiveRef];
  if (!detail) return false;
  const [overview] = overviewRows;
  if (detail.day !== overview.day) return false;

  // 目录只有 fingerprint 可与详情互证；要求恰有一次匹配，拒绝含糊的重复来源。
  if (detail.fingerprints.filter(fingerprint => fingerprint === overview.fingerprint).length !== 1) return false;

  // 旧账本仍保留 chronicle 原数组时，详情来源必须能逐一回指其中的稳定 ID。
  const chronicleIds = new Set(ledger.chronicle.map(item => item.id));
  if (!detail.sourceChronicleIds.length
    || new Set(detail.sourceChronicleIds).size !== detail.sourceChronicleIds.length
    || detail.sourceChronicleIds.some(id => !chronicleIds.has(id))) return false;

  return true;
}

/**
 * 严格复核迁移账本和独立归档快照，不修改任一输入或任何持久化载体。
 */
export function reviewWorldLegacyMigration_ACU(
  ledger: WorldSimulationLedger_ACU,
  archive: WorldChronicleArchiveSnapshot_ACU,
): WorldLegacyMigrationReview_ACU {
  const validatedLedger = validateWorldSimulationLedger_ACU(ledger, 'load');
  const validatedArchive = validateWorldSimulationChronicleArchiveSnapshot_ACU(archive, 'load');
  const issues: WorldLegacyMigrationIssue_ACU[] = [];
  const archiveDetailAvailableIds: string[] = [];
  const unresolvedArchiveIds: string[] = [];

  for (const issue of validatedLedger.legacyMigration.issues) {
    const isArchiveDetailGap = issue.source === 'chronicleArchive'
      && issue.reason === 'archive_detail_unavailable';
    if (!isArchiveDetailGap) {
      issues.push(issue);
      continue;
    }

    if (hasMatchingArchiveDetail_ACU(validatedLedger, validatedArchive, issue.sourceId)) {
      archiveDetailAvailableIds.push(issue.sourceId);
      continue;
    }

    issues.push(issue);
    unresolvedArchiveIds.push(issue.sourceId);
  }

  return { issues, archiveDetailAvailableIds, unresolvedArchiveIds };
}
