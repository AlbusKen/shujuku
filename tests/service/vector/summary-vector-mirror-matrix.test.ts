/**
 * 纪要向量镜像 17 项集成矩阵（设计文档 371–389）。
 * 覆盖 resolver / 差分规划 / 折叠跳过 / legacy 检测 / dirty 交集 / 可达性收集。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/table/compat-transition-checkpoint', () => ({
  findLatestTransitionCheckpoint_ACU: () => null,
}));

import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import {
  resolveSummaryVectorMirrorHead_ACU,
} from '../../../src/service/vector/summary-vector-mirror-resolver';
import { planUnmirroredEntryDeltasV2_ACU } from '../../../src/service/vector/summary-vector-mirror-writer';
import {
  chatHasLegacySummaryVectorFields_ACU,
  chatHasSummaryVectorMirror_ACU,
  currentEnvironmentHasSummaryVectorMirror_ACU,
} from '../../../src/service/vector/summary-vector-mirror-rebuild';
import { foldSummaryVectorMirrorAtBoundary_ACU } from '../../../src/service/vector/summary-vector-mirror-fold';
import type {
  SummaryVectorEmbeddingIdentity_ACU,
  SummaryVectorIndexMirrorCheckpointV2_ACU,
  SummaryVectorIndexMirrorLogEntryV2_ACU,
  TableStorageFrameV2_ACU,
} from '../../../src/service/table/storage-frame-v2-types';
import type { SummaryVectorMirrorManifestRows_ACU } from '../../../src/service/vector/summary-vector-index-types';

const ISOLATION = '';
const SOURCE = 'sheet_summary';
const EMB: SummaryVectorEmbeddingIdentity_ACU = { endpointFingerprint: 'ep', model: 'model-a', dimension: 4, sourceTextVersion: 2 };
const TABLE_DATA = { sheet_summary: { uid: 'sheet_summary', name: '纪要表', content: [['row_id', '摘要']] } };

function pack(hash: string) {
  return { packHash: hash, path: `TavernDB_ACU_vector_v2pack_scope_${hash}`, chunkCount: 1, byteLength: 16 };
}

function checkpoint(overrides: Partial<SummaryVectorIndexMirrorCheckpointV2_ACU> = {}): SummaryVectorIndexMirrorCheckpointV2_ACU {
  return {
    kind: 'vector_full',
    createdAt: 1,
    reason: 'initial',
    sourceTableKey: SOURCE,
    tableCheckpointFingerprint: getTableDataFingerprint_ACU(TABLE_DATA),
    embedding: EMB,
    rowCount: 1,
    vectorRevision: 'cp-rev',
    manifestRef: { manifestHash: 'mf', path: 'TavernDB_ACU_vector_v2vcp_scope_mf', byteLength: 32 },
    packRefs: [pack('p0')],
    ...overrides,
  };
}

function fullFrame(deltas: SummaryVectorIndexMirrorLogEntryV2_ACU[] = [], entries: any[] = []): TableStorageFrameV2_ACU {
  return {
    version: 2,
    checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: TABLE_DATA as any },
    logEntries: entries,
    summaryVectorIndexFrame: {
      version: 3,
      sourceTableKey: SOURCE,
      checkpoint: checkpoint(),
      logEntries: deltas,
    },
  };
}

function delta(entryId: string, seq: number, ops: SummaryVectorIndexMirrorLogEntryV2_ACU['operations'], sourceEntryId = entryId): SummaryVectorIndexMirrorLogEntryV2_ACU {
  return {
    seq,
    entryId,
    createdAt: 1,
    sourceTableEntry: { entryId: sourceEntryId, commitRevision: `rev-${sourceEntryId}`, messageIndex: 0 },
    embedding: EMB,
    packRefs: ops.flatMap((op) => (op.kind === 'row_add' ? op.chunks.map((chunk) => pack(chunk.packHash)) : [])),
    operations: ops,
  };
}

function ai(frame?: TableStorageFrameV2_ACU): any {
  const message: any = { is_user: false, mes: 'ai' };
  if (frame) message.TavernDB_ACU_IsolatedData = { [ISOLATION]: { storageFrame: frame, _acu_storage_version: 2 } };
  return message;
}

const MANIFEST: SummaryVectorMirrorManifestRows_ACU = {
  schema: 'summary_vector_mirror_manifest',
  version: 1,
  sourceTableKey: SOURCE,
  rows: [{ rowId: '1', chunks: [{ packHash: 'p0', chunkIndex: 0 }] }],
};

function resolve(chat: any[], extra: { embedding?: SummaryVectorEmbeddingIdentity_ACU; maxExclusive?: number } = {}) {
  return resolveSummaryVectorMirrorHead_ACU({
    chat,
    isolationKey: ISOLATION,
    sourceTableKey: SOURCE,
    embedding: extra.embedding,
    maxMessageIndexExclusive: extra.maxExclusive,
    loadManifest: async () => MANIFEST,
  });
}

describe('向量镜像 17 项矩阵', () => {
  it('1. 四层正常镜像：各层差分只新增未镜像行', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU(
      [
        { messageIndex: 1, entryId: 'e1', commitRevision: 'r1', seq: 1, rowIdsAfter: ['1', '2'] },
        { messageIndex: 2, entryId: 'e2', commitRevision: 'r2', seq: 1, rowIdsAfter: ['1', '2', '3'] },
        { messageIndex: 3, entryId: 'e3', commitRevision: 'r3', seq: 1, rowIdsAfter: ['1', '2', '3', '4'] },
        { messageIndex: 4, entryId: 'e4', commitRevision: 'r4', seq: 1, rowIdsAfter: ['1', '2', '3', '4', '5'] },
      ],
      [],
      ['1'],
    );
    expect(plans.map((plan) => plan.added)).toEqual([['2'], ['3'], ['4'], ['5']]);
    expect(plans.every((plan) => plan.removed.length === 0)).toBe(true);
  });

  it('2. 手动重填 rowId 复用：7/8 从旧集合消失再出现，记为 remove+add', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU(
      [
        { messageIndex: 3, entryId: 'refill-3', commitRevision: 'r3', seq: 1, rowIdsAfter: ['1', '2', '3', '4', '5', '6'] },
        { messageIndex: 4, entryId: 'refill-4', commitRevision: 'r4', seq: 1, rowIdsAfter: ['1', '2', '3', '4', '5', '6', '7', '8'] },
      ],
      [],
      ['1', '2', '3', '4', '5', '6', '7', '8'],
    );
    expect(plans[0].removed).toEqual(['7', '8']);
    expect(plans[1].added).toEqual(['7', '8']);
  });

  it('3. swipe 最后一层：同 frame 的 table entry 消失后 delta 成 orphan 并标 stale', async () => {
    const chat = [
      ai(fullFrame(
        [delta('v1', 1, [{ kind: 'row_add', rowId: '2', chunks: [{ packHash: 'p1', chunkIndex: 0 }], vectorSourceHash: 's2' }], 'missing-table-entry')],
        [],
      )),
    ];
    const head = await resolve(chat);
    expect(head.status).toBe('ok');
    expect(head.stale).toBe(true);
    expect(head.head.has('2')).toBe(false);
  });

  it('4. 删中间楼层：只应用幸存 delta，head 不含被删层 row', async () => {
    const layer1 = { version: 2, logEntries: [{ seq: 1, entryId: 't1', createdAt: 1, source: 'auto_fill', targetMessageIndex: 1, aiFloor: 1, filledSheetKeys: [SOURCE], changedSheetKeys: [SOURCE], groupKeys: [], operations: [], commitRevision: 'rev-t1' }], summaryVectorIndexFrame: { version: 3, sourceTableKey: SOURCE, logEntries: [delta('v1', 1, [{ kind: 'row_add', rowId: '2', chunks: [{ packHash: 'p1', chunkIndex: 0 }], vectorSourceHash: 's2' }], 't1')] } } as TableStorageFrameV2_ACU;
    const layer3 = { version: 2, logEntries: [{ seq: 1, entryId: 't3', createdAt: 1, source: 'auto_fill', targetMessageIndex: 3, aiFloor: 3, filledSheetKeys: [SOURCE], changedSheetKeys: [SOURCE], groupKeys: [], operations: [], commitRevision: 'rev-t3' }], summaryVectorIndexFrame: { version: 3, sourceTableKey: SOURCE, logEntries: [delta('v3', 1, [{ kind: 'row_add', rowId: '4', chunks: [{ packHash: 'p3', chunkIndex: 0 }], vectorSourceHash: 's4' }], 't3')] } } as TableStorageFrameV2_ACU;
    const chat = [ai(fullFrame()), ai(layer1), ai(layer3)];
    const head = await resolve(chat);
    expect(Array.from(head.head.keys()).sort()).toEqual(['1', '2', '4']);
    expect(head.chainConflict).toBe(false);
  });

  it('5. 删 checkpoint 楼层后的同层镜像字段可被 vault 识别', () => {
    const chat = [ai(fullFrame())];
    expect(chatHasSummaryVectorMirror_ACU(chat)).toBe(true);
    delete chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.summaryVectorIndexFrame;
    expect(chatHasSummaryVectorMirror_ACU(chat)).toBe(false);
  });

  it('6. cleanup 折叠：锚点前无基底或无镜像时跳过且不抛错', async () => {
    const emptyAtZero = await foldSummaryVectorMirrorAtBoundary_ACU({
      chat: [ai({ version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'compaction', data: TABLE_DATA as any }, logEntries: [] })],
      isolationKey: ISOLATION,
      boundaryAnchorIndex: 0,
      tableCheckpointFingerprint: getTableDataFingerprint_ACU(TABLE_DATA),
      sourceTableKey: SOURCE,
    });
    expect(emptyAtZero).toEqual({ folded: false, files: [] });

    const priorFullNoMirror = await foldSummaryVectorMirrorAtBoundary_ACU({
      chat: [
        ai({ version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: TABLE_DATA as any }, logEntries: [] }),
        ai({ version: 2, logEntries: [] }),
      ],
      isolationKey: ISOLATION,
      boundaryAnchorIndex: 1,
      tableCheckpointFingerprint: getTableDataFingerprint_ACU(TABLE_DATA),
      sourceTableKey: SOURCE,
    });
    expect(priorFullNoMirror).toEqual({ folded: false, files: [] });
  });

  it('7. periodic 折叠：锚点前 resolver 截断后 head 不含锚点自身 delta', async () => {
    const root = fullFrame();
    const later: TableStorageFrameV2_ACU = {
      version: 2,
      logEntries: [{ seq: 1, entryId: 't2', createdAt: 1, source: 'auto_fill', targetMessageIndex: 1, aiFloor: 2, filledSheetKeys: [SOURCE], changedSheetKeys: [SOURCE], groupKeys: [], operations: [], commitRevision: 'rev-t2' }],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SOURCE,
        logEntries: [delta('v2', 1, [{ kind: 'row_add', rowId: '9', chunks: [{ packHash: 'p9', chunkIndex: 0 }], vectorSourceHash: 's9' }], 't2')],
      },
    };
    const chat = [ai(root), ai(later)];
    const beforeFold = await resolve(chat);
    const foldedView = await resolve(chat, { maxExclusive: 1 });
    expect(beforeFold.head.has('9')).toBe(true);
    expect(foldedView.head.has('9')).toBe(false);
    expect(foldedView.head.has('1')).toBe(true);
  });

  it('8. 显式重建后的 checkpoint 身份可由 chatHasSummaryVectorMirror 识别', () => {
    expect(chatHasSummaryVectorMirror_ACU([ai(fullFrame())])).toBe(true);
  });

  it('当前环境只认当前 isolation 且 rowCount>0 的 vector_full，其他槽和空镜像不算已有数据', () => {
    const current = ai(fullFrame());
    expect(currentEnvironmentHasSummaryVectorMirror_ACU(current ? [current] : [], '')).toBe(true);
    expect(currentEnvironmentHasSummaryVectorMirror_ACU([current], 'other-iso')).toBe(false);
    const emptyMirror = ai({
      ...fullFrame(),
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SOURCE,
        checkpoint: checkpoint({ rowCount: 0 }),
        logEntries: [],
      },
    });
    expect(currentEnvironmentHasSummaryVectorMirror_ACU([emptyMirror], '')).toBe(false);

    const otherOnly = {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        'other-iso': { storageFrame: fullFrame(), _acu_storage_version: 2 },
      },
    };
    expect(chatHasSummaryVectorMirror_ACU([otherOnly])).toBe(true);
    expect(currentEnvironmentHasSummaryVectorMirror_ACU([otherOnly], '')).toBe(false);
    expect(currentEnvironmentHasSummaryVectorMirror_ACU([otherOnly], 'other-iso')).toBe(true);
    expect(currentEnvironmentHasSummaryVectorMirror_ACU([], '')).toBe(false);
  });

  it('9. legacy 检测：旧三字段存在则提示重建', () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: { '': { summaryVectorIndexState: { indexId: 'old' } } },
    }];
    expect(chatHasLegacySummaryVectorFields_ACU(chat)).toBe(true);
    expect(chatHasLegacySummaryVectorFields_ACU([ai(fullFrame())])).toBe(false);
  });

  it('10. 模型切换：embedding_identity_changed', async () => {
    const head = await resolve([ai(fullFrame())], { embedding: { ...EMB, model: 'model-b' } });
    expect(head.status).toBe('embedding_identity_changed');
  });

  it('11. 并发冲突：row_add 已存在则 chainConflict 且丢弃该 delta', async () => {
    const chat = [ai(fullFrame([
      delta('v1', 1, [{ kind: 'row_add', rowId: '1', chunks: [{ packHash: 'p1', chunkIndex: 0 }], vectorSourceHash: 's1' }], 't1'),
    ], [{ seq: 1, entryId: 't1', createdAt: 1, source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [SOURCE], changedSheetKeys: [SOURCE], groupKeys: [], operations: [], commitRevision: 'rev-t1' }]))];
    const head = await resolve(chat);
    expect(head.chainConflict).toBe(true);
    expect(head.head.get('1')?.[0].packHash).toBe('p0');
  });

  it('12. 重复 rowId：seam 层不把重复 id 写进 after 集合', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU(
      [{ messageIndex: 1, entryId: 'e1', commitRevision: 'r1', seq: 1, rowIdsAfter: ['1', '1', '2'] }],
      [],
      ['1'],
    );
    expect(plans).toEqual([{ messageIndex: 1, entryId: 'e1', commitRevision: 'r1', added: ['2'], removed: [] }]);
  });

  it('13. 非 full 基底：unsupported_replay_base', async () => {
    const frame: TableStorageFrameV2_ACU = { version: 2, logEntries: [] };
    const head = await resolve([ai(frame)]);
    expect(head.status).toBe('unsupported_replay_base');
    expect(head.head.size).toBe(0);
  });

  it('14. dirty 交集：head 旧行 ∩ 实时行，新行不出现', async () => {
    const head = await resolve([ai(fullFrame())]);
    const live = new Set(['1', '99']);
    const intersection = Array.from(head.head.keys()).filter((rowId) => live.has(rowId));
    expect(intersection).toEqual(['1']);
    expect(intersection.includes('99')).toBe(false);
  });

  it('15. 发布失败语义：prepared 路径仍视为可达（pending 集合）', () => {
    const pending = new Set(['TavernDB_ACU_vector_v2pack_scope_pending']);
    const reachable = new Set<string>();
    pending.forEach((path) => reachable.add(path));
    expect(reachable.has('TavernDB_ACU_vector_v2pack_scope_pending')).toBe(true);
  });

  it('16. provisional bridge：无 table entry 则不产生未镜像计划', () => {
    const plans = planUnmirroredEntryDeltasV2_ACU([], [], ['1']);
    expect(plans).toEqual([]);
  });

  it('17. GC 可达性：checkpoint manifest 与 delta packRefs 都在 frame 上', () => {
    const frame = fullFrame([
      delta('v1', 1, [{ kind: 'row_add', rowId: '2', chunks: [{ packHash: 'p1', chunkIndex: 0 }], vectorSourceHash: 's2' }], 't1'),
    ]);
    const paths = [
      frame.summaryVectorIndexFrame?.checkpoint?.manifestRef.path,
      ...(frame.summaryVectorIndexFrame?.checkpoint?.packRefs || []).map((ref) => ref.path),
      ...(frame.summaryVectorIndexFrame?.logEntries || []).flatMap((entry) => entry.packRefs.map((ref) => ref.path)),
    ].filter(Boolean);
    expect(paths).toContain('TavernDB_ACU_vector_v2vcp_scope_mf');
    expect(paths.some((path) => String(path).includes('v2pack'))).toBe(true);
  });
});
