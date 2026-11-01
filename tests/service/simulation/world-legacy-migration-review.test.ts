import { describe, expect, it } from 'vitest';

import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { foldWorldSimulationArchive_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import {
  buildWorldSimulationBucketKey_ACU,
  resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationLedger_ACU,
} from '../../../src/service/simulation/simulation-store';
import { reviewWorldLegacyMigration_ACU } from '../../../src/service/simulation/world-legacy-migration-review';

function assistant(mes: string) {
  return { is_user: false, message_id: mes, mes, swipe_id: 0 };
}

function legacyV6Ledger() {
  const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
  raw.schemaVersion = 6;
  delete raw.worldEvents;
  delete raw.facts;
  delete raw.historyMilestones;
  delete raw.projection;
  delete raw.legacyMigration;
  raw.chronicle = [{ id: 'chronicle-1', at: '很久以前', summary: '旧谈判', relatedIds: [], evidenceRefs: [], missedNote: null }];
  raw.chronicleOverview = [{ fingerprint: 'fp-1', day: 2, oneLine: '旧谈判归档', archiveRef: 'archive-1' }];
  return raw;
}

function foldedArchive(records: Record<string, unknown>) {
  const chat: any[] = [assistant('归档楼')];
  const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
  chat[0][WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU] = {
    schemaVersion: 1,
    entries: {
      [buildWorldSimulationBucketKey_ACU(anchor)]: {
        anchor,
        value: { schemaVersion: 1, records },
        updatedAt: 1,
      },
    },
  };
  return foldWorldSimulationArchive_ACU(chat).snapshot;
}

function validArchive() {
  return foldedArchive({
    'archive-1': {
      archiveRef: 'archive-1', day: 2, summary: '旧谈判详情：日期文本不可靠',
      fingerprints: ['fp-1'], relatedIds: [], sourceChronicleIds: ['chronicle-1'],
    },
  });
}

describe('旧迁移归档详情只读复核', () => {
  it('v6 经真实校验迁移后，以折叠归档消除唯一假缺口，不解析自由文本时间', () => {
    const raw = legacyV6Ledger();
    const ledger = validateWorldSimulationLedger_ACU(raw);
    const rawBefore = structuredClone(raw);
    const ledgerBefore = structuredClone(ledger);
    const archive = validArchive();
    const archiveBefore = structuredClone(archive);

    const first = reviewWorldLegacyMigration_ACU(ledger, archive);
    const second = reviewWorldLegacyMigration_ACU(ledger, archive);

    expect(ledger.legacyMigration.issues).toContainEqual({
      source: 'chronicleArchive', sourceId: 'archive-1', reason: 'archive_detail_unavailable',
    });
    expect(first).toEqual({
      issues: [{ source: 'chronicle', sourceId: 'chronicle-1', reason: 'unparseable_time' }],
      archiveDetailAvailableIds: ['archive-1'], unresolvedArchiveIds: [],
    });
    expect(second).toEqual(first);
    expect(raw).toEqual(rawBefore);
    expect(ledger).toEqual(ledgerBefore);
    expect(archive).toEqual(archiveBefore);
  });

  it('缺少详情或与旧目录不一致时保留原缺口', () => {
    const ledger = validateWorldSimulationLedger_ACU(legacyV6Ledger());
    const missing = foldedArchive({});
    expect(reviewWorldLegacyMigration_ACU(ledger, missing)).toEqual({
      issues: ledger.legacyMigration.issues,
      archiveDetailAvailableIds: [], unresolvedArchiveIds: ['archive-1'],
    });

    const mismatch = validArchive();
    mismatch.records['archive-1'].fingerprints = ['other-fingerprint'];
    expect(reviewWorldLegacyMigration_ACU(ledger, mismatch)).toMatchObject({
      issues: ledger.legacyMigration.issues,
      archiveDetailAvailableIds: [], unresolvedArchiveIds: ['archive-1'],
    });
  });

  it('详情损坏、目录多引用与重复缺口均由严格校验拒绝，不静默修复', () => {
    const ledger = validateWorldSimulationLedger_ACU(legacyV6Ledger());
    const broken = validArchive() as any;
    broken.records['archive-1'].day = '第二日';
    expect(() => reviewWorldLegacyMigration_ACU(ledger, broken)).toThrow(WorldSimulationValidationError_ACU);
    expect(() => reviewWorldLegacyMigration_ACU(ledger, broken)).toThrow(/chronicleArchive.records.archive-1.day/);

    const multipleOverview = structuredClone(ledger) as any;
    multipleOverview.chronicleOverview.push({ fingerprint: 'fp-2', day: 2, oneLine: '重复引用', archiveRef: 'archive-1' });
    expect(() => reviewWorldLegacyMigration_ACU(multipleOverview, validArchive())).toThrow(/重复 archiveRef/);

    const duplicateIssue = structuredClone(ledger) as any;
    duplicateIssue.legacyMigration.issues.push({
      source: 'chronicleArchive', sourceId: 'archive-1', reason: 'archive_detail_unavailable',
    });
    expect(() => reviewWorldLegacyMigration_ACU(duplicateIssue, validArchive())).toThrow(/legacyMigration.issues/);
  });

  it('不处理其他原因，且缺失来源纪要的详情不会被误报为可用', () => {
    const ledger = validateWorldSimulationLedger_ACU(legacyV6Ledger());
    ledger.legacyMigration.issues = [
      { source: 'chronicle', sourceId: 'chronicle-1', reason: 'unparseable_time' },
      { source: 'chronicleArchive', sourceId: 'archive-1', reason: 'archive_detail_unavailable' },
    ];
    const archive = validArchive();
    archive.records['archive-1'].sourceChronicleIds = ['other-chronicle'];

    expect(reviewWorldLegacyMigration_ACU(ledger, archive)).toEqual({
      issues: ledger.legacyMigration.issues,
      archiveDetailAvailableIds: [],
      unresolvedArchiveIds: ['archive-1'],
    });
  });
});
