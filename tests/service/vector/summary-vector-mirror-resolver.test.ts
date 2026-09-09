import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  transition: null as any,
}));

vi.mock('../../../src/service/table/compat-transition-checkpoint', () => ({
  findLatestTransitionCheckpoint_ACU: () => h.transition,
}));

import {
  assertSummaryVectorMirrorFrameInvariantsV2_ACU,
  computeSummaryVectorMirrorCheckpointRevision_ACU,
  computeSummaryVectorMirrorHeadRevision_ACU,
  locateSummaryVectorMirrorBase_ACU,
  resolveSummaryVectorMirrorHead_ACU,
  summaryVectorEmbeddingIdentityEquals_ACU,
  validateSummaryVectorMirrorDelta_ACU,
} from '../../../src/service/vector/summary-vector-mirror-resolver';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import type {
  SummaryVectorEmbeddingIdentity_ACU,
  SummaryVectorIndexMirrorCheckpointV2_ACU,
  SummaryVectorIndexMirrorLogEntryV2_ACU,
  SummaryVectorIndexMirrorOperationV2_ACU,
  SummaryVectorPackRef_ACU,
  TableStorageFrameV2_ACU,
} from '../../../src/service/table/storage-frame-v2-types';
import type { SummaryVectorMirrorManifestRows_ACU } from '../../../src/service/vector/summary-vector-index-types';

const ISOLATION = '';
const SOURCE = 'sheet_summary';
const EMB: SummaryVectorEmbeddingIdentity_ACU = { endpointFingerprint: 'ep', model: 'model-a', dimension: 4, sourceTextVersion: 2 };
const EMB_B: SummaryVectorEmbeddingIdentity_ACU = { ...EMB, model: 'model-b' };
const TABLE_DATA = { sheet_summary: { uid: 'sheet_summary', name: '纪要表', content: [['row_id', '摘要']] } };

function pack(hash: string): SummaryVectorPackRef_ACU {
  return { packHash: hash, path: `TavernDB_ACU_vector_v2pack_scope_${hash}`, chunkCount: 1, byteLength: 16 };
}

function add(rowId: string, hash: string, chunkIndex = 0): SummaryVectorIndexMirrorOperationV2_ACU {
  return { kind: 'row_add', rowId, chunks: [{ packHash: hash, chunkIndex }], vectorSourceHash: `src-${rowId}` };
}

function remove(rowId: string): SummaryVectorIndexMirrorOperationV2_ACU {
  return { kind: 'row_remove', rowId };
}

function delta(options: {
  seq: number;
  entryId: string;
  sourceEntryId: string;
  ops: SummaryVectorIndexMirrorOperationV2_ACU[];
  packs?: SummaryVectorPackRef_ACU[];
  embedding?: SummaryVectorEmbeddingIdentity_ACU;
}): SummaryVectorIndexMirrorLogEntryV2_ACU {
  const packs = options.packs ?? Array.from(new Set(
    options.ops.flatMap((op) => (op.kind === 'row_add' ? op.chunks.map((chunk) => chunk.packHash) : [])),
  )).map(pack);
  return {
    seq: options.seq,
    entryId: options.entryId,
    createdAt: 1,
    sourceTableEntry: { entryId: options.sourceEntryId, commitRevision: `rev-${options.sourceEntryId}`, messageIndex: 0 },
    embedding: options.embedding ?? EMB,
    packRefs: packs,
    operations: options.ops,
  };
}

function tableEntry(entryId: string, seq = 1): any {
  return {
    seq,
    entryId,
    createdAt: 1,
    source: 'auto_fill',
    targetMessageIndex: 0,
    aiFloor: 1,
    filledSheetKeys: [SOURCE],
    changedSheetKeys: [SOURCE],
    groupKeys: [],
    operations: [],
    commitRevision: `rev-${entryId}`,
  };
}

function checkpoint(overrides: Partial<SummaryVectorIndexMirrorCheckpointV2_ACU> = {}): SummaryVectorIndexMirrorCheckpointV2_ACU {
  return {
    kind: 'vector_full',
    createdAt: 1,
    reason: 'initial',
    sourceTableKey: SOURCE,
    tableCheckpointFingerprint: getTableDataFingerprint_ACU(TABLE_DATA),
    embedding: EMB,
    rowCount: 2,
    vectorRevision: 'cp-rev',
    manifestRef: { manifestHash: 'mf', path: 'TavernDB_ACU_vector_v2vcp_scope_mf', byteLength: 32 },
    packRefs: [pack('p0')],
    ...overrides,
  };
}

function fullFrame(options: {
  vectorCheckpoint?: SummaryVectorIndexMirrorCheckpointV2_ACU | null;
  entries?: any[];
  deltas?: SummaryVectorIndexMirrorLogEntryV2_ACU[];
  mirrorSourceTableKey?: string;
} = {}): TableStorageFrameV2_ACU {
  const frame: TableStorageFrameV2_ACU = {
    version: 2,
    checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: TABLE_DATA as any },
    logEntries: options.entries ?? [],
  };
  if (options.vectorCheckpoint !== null) {
    frame.summaryVectorIndexFrame = {
      version: 3,
      sourceTableKey: options.mirrorSourceTableKey ?? SOURCE,
      checkpoint: options.vectorCheckpoint ?? checkpoint(),
      logEntries: options.deltas ?? [],
    };
  }
  return frame;
}

function logFrame(entries: any[], deltas: SummaryVectorIndexMirrorLogEntryV2_ACU[] = [], extra: Partial<TableStorageFrameV2_ACU> = {}): TableStorageFrameV2_ACU {
  const frame: TableStorageFrameV2_ACU = { version: 2, logEntries: entries, ...extra };
  if (deltas.length > 0 || extra.summaryVectorIndexFrame) {
    frame.summaryVectorIndexFrame = extra.summaryVectorIndexFrame ?? { version: 3, sourceTableKey: SOURCE, logEntries: deltas };
  }
  return frame;
}

function ai(frame?: TableStorageFrameV2_ACU): any {
  const message: any = { is_user: false, mes: 'ai' };
  if (frame) message.TavernDB_ACU_IsolatedData = { [ISOLATION]: { storageFrame: frame, _acu_storage_version: 2 } };
  return message;
}

function user(): any {
  return { is_user: true, mes: 'user' };
}

const MANIFEST: SummaryVectorMirrorManifestRows_ACU = {
  schema: 'summary_vector_mirror_manifest',
  version: 1,
  sourceTableKey: SOURCE,
  rows: [
    { rowId: '1', chunks: [{ packHash: 'p0', chunkIndex: 0 }] },
    { rowId: '2', chunks: [{ packHash: 'p0', chunkIndex: 1 }] },
  ],
};

function resolve(chat: any[], options: {
  embedding?: SummaryVectorEmbeddingIdentity_ACU;
  maxMessageIndexExclusive?: number;
  manifest?: SummaryVectorMirrorManifestRows_ACU | null | (() => Promise<SummaryVectorMirrorManifestRows_ACU | null>);
  sourceTableKey?: string;
} = {}) {
  const manifest = options.manifest;
  return resolveSummaryVectorMirrorHead_ACU({
    chat,
    isolationKey: ISOLATION,
    sourceTableKey: options.sourceTableKey ?? SOURCE,
    embedding: options.embedding,
    maxMessageIndexExclusive: options.maxMessageIndexExclusive,
    loadManifest: typeof manifest === 'function'
      ? manifest
      : async () => (manifest === undefined ? MANIFEST : manifest),
  });
}

function headRows(result: Awaited<ReturnType<typeof resolve>>): string[] {
  return Array.from(result.head.keys()).sort();
}

beforeEach(() => {
  h.transition = null;
});

describe('locateSummaryVectorMirrorBase_ACU', () => {
  it('取最后一个 full checkpoint 楼层作为基底', () => {
    const chat = [user(), ai(fullFrame()), user(), ai(logFrame([tableEntry('e1')]))];
    expect(locateSummaryVectorMirrorBase_ACU(chat, ISOLATION)?.messageIndex).toBe(1);
  });

  it('flush scope token default 映射到空隔离槽，仍能定位 full checkpoint', () => {
    const chat = [user(), ai(fullFrame()), user(), ai(logFrame([tableEntry('e1')]))];
    expect(locateSummaryVectorMirrorBase_ACU(chat, 'default')?.messageIndex).toBe(1);
  });

  it('过渡根 cutoff 覆盖 full checkpoint 时返回 null（基底不是 full）', () => {
    const chat = [ai(fullFrame()), ai(logFrame([tableEntry('e1')]))];
    h.transition = { messageIndex: 1, aiFloor: 2, source: 'compat', checkpoint: { cutoff: { messageIndex: 1, seq: 0, operationIndex: -1 } } };
    expect(locateSummaryVectorMirrorBase_ACU(chat, ISOLATION)).toBeNull();
  });

  it('过渡根 cutoff 早于 full checkpoint 时仍以 full checkpoint 为基底', () => {
    const chat = [ai(logFrame([tableEntry('e0')])), ai(fullFrame())];
    h.transition = { messageIndex: 0, aiFloor: 1, source: 'spv79', checkpoint: { cutoff: { messageIndex: 0, seq: 0, operationIndex: -1 } } };
    expect(locateSummaryVectorMirrorBase_ACU(chat, ISOLATION)?.messageIndex).toBe(1);
  });

  it('maxMessageIndexExclusive 之外的 full checkpoint 不参与基底选择', () => {
    const chat = [ai(fullFrame()), ai(logFrame([tableEntry('e1')])), ai(fullFrame())];
    expect(locateSummaryVectorMirrorBase_ACU(chat, ISOLATION, 2)?.messageIndex).toBe(0);
    expect(locateSummaryVectorMirrorBase_ACU(chat, ISOLATION)?.messageIndex).toBe(2);
  });
});

describe('resolveSummaryVectorMirrorHead_ACU 状态判定', () => {
  it('空聊天 / 无 V2 frame → unsupported_replay_base', async () => {
    expect((await resolve([])).status).toBe('unsupported_replay_base');
    expect((await resolve([user(), ai()])).status).toBe('unsupported_replay_base');
  });

  it('只有 logEntries 无 full checkpoint（replacement anchor / temporary baseline 场景）→ unsupported_replay_base', async () => {
    const result = await resolve([ai(logFrame([tableEntry('e1')]))]);
    expect(result.status).toBe('unsupported_replay_base');
    expect(result.head.size).toBe(0);
  });

  it('过渡根接管 → unsupported_replay_base', async () => {
    h.transition = { messageIndex: 0, aiFloor: 1, source: 'compat', checkpoint: { cutoff: { messageIndex: 5, seq: 0, operationIndex: -1 } } };
    expect((await resolve([ai(fullFrame())])).status).toBe('unsupported_replay_base');
  });

  it('full checkpoint frame 无 vector checkpoint → no_mirror', async () => {
    const result = await resolve([ai(fullFrame({ vectorCheckpoint: null }))]);
    expect(result.status).toBe('no_mirror');
    expect(result.checkpointMessageIndex).toBe(0);
  });

  it('镜像 sourceTableKey 与请求不一致 → source_table_changed', async () => {
    const result = await resolve([ai(fullFrame())], { sourceTableKey: 'sheet_other' });
    expect(result.status).toBe('source_table_changed');
    expect(result.checkpoint).not.toBeNull();
  });

  it('表格 checkpoint 指纹不一致 → checkpoint_mismatch', async () => {
    const result = await resolve([ai(fullFrame({ vectorCheckpoint: checkpoint({ tableCheckpointFingerprint: 'stale' }) }))]);
    expect(result.status).toBe('checkpoint_mismatch');
  });

  it('embedding 身份与 checkpoint 不一致 → embedding_identity_changed；不传 embedding 时不校验', async () => {
    const chat = [ai(fullFrame())];
    expect((await resolve(chat, { embedding: EMB_B })).status).toBe('embedding_identity_changed');
    expect((await resolve(chat, { embedding: EMB })).status).toBe('ok');
    expect((await resolve(chat)).status).toBe('ok');
  });

  it('当前身份 dimension=0 视为尚未观测，不把已归档的真实维度误判成换模型', async () => {
    const chat = [ai(fullFrame())];
    const unseen: SummaryVectorEmbeddingIdentity_ACU = { ...EMB, dimension: 0 };
    expect(summaryVectorEmbeddingIdentityEquals_ACU(unseen, EMB)).toBe(true);
    expect((await resolve(chat, { embedding: unseen })).status).toBe('ok');
  });

  it('双方 dimension 都大于 0 且不同时仍判定 embedding 身份变化', async () => {
    const chat = [ai(fullFrame())];
    const otherDim: SummaryVectorEmbeddingIdentity_ACU = { ...EMB, dimension: 8 };
    expect(summaryVectorEmbeddingIdentityEquals_ACU(otherDim, EMB)).toBe(false);
    expect((await resolve(chat, { embedding: otherDim })).status).toBe('embedding_identity_changed');
  });

  it('manifest 返回 null / 抛错 / 结构非法 → manifest_unavailable', async () => {
    const chat = [ai(fullFrame())];
    expect((await resolve(chat, { manifest: null })).status).toBe('manifest_unavailable');
    const thrown = await resolve(chat, { manifest: async () => { throw new Error('boom'); } });
    expect(thrown.status).toBe('manifest_unavailable');
    expect(thrown.diagnostics.map((item) => item.code)).toContain('manifest_load_failed');
    const invalid = await resolve(chat, { manifest: { schema: 'wrong' } as any });
    expect(invalid.status).toBe('manifest_unavailable');
  });
});

describe('resolveSummaryVectorMirrorHead_ACU delta 应用', () => {
  it('checkpoint + 多层 add/remove 得到正确 head，并汇总 packRefs 与 applied entryId', async () => {
    const chat = [
      user(),
      ai(fullFrame({ entries: [tableEntry('c1')], deltas: [delta({ seq: 1, entryId: 'vc1', sourceEntryId: 'c1', ops: [add('3', 'p1')] })] })),
      user(),
      ai(logFrame([tableEntry('e2')], [delta({ seq: 1, entryId: 'v2', sourceEntryId: 'e2', ops: [add('4', 'p2'), remove('1')] })])),
      user(),
      ai(logFrame([tableEntry('e3')], [delta({ seq: 1, entryId: 'v3', sourceEntryId: 'e3', ops: [remove('4')] })])),
    ];
    const result = await resolve(chat);
    expect(result.status).toBe('ok');
    expect(headRows(result)).toEqual(['2', '3']);
    expect(result.head.get('3')).toEqual([{ packHash: 'p1', chunkIndex: 0 }]);
    expect(result.appliedDeltaEntryIds).toEqual(['vc1', 'v2', 'v3']);
    expect(result.appliedTableEntryIds).toEqual(['c1', 'e2', 'e3']);
    expect(result.packRefs.map((ref) => ref.packHash).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(result.stale).toBe(false);
    expect(result.chainConflict).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it('基底楼层之前的 frame 上的 delta 不参与应用', async () => {
    const chat = [
      ai(logFrame([tableEntry('e0')], [delta({ seq: 1, entryId: 'v0', sourceEntryId: 'e0', ops: [add('9', 'p9')] })])),
      ai(fullFrame()),
    ];
    const result = await resolve(chat);
    expect(headRows(result)).toEqual(['1', '2']);
    expect(result.appliedDeltaEntryIds).toEqual([]);
  });

  it('同层多条 delta 按 seq 升序应用；seq 重复记 duplicate_delta_seq 并按数组顺序', async () => {
    const chat = [
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1', 1), tableEntry('e2', 2)], [
        delta({ seq: 2, entryId: 'v2', sourceEntryId: 'e2', ops: [remove('3')] }),
        delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] }),
      ])),
    ];
    const ordered = await resolve(chat);
    expect(ordered.appliedDeltaEntryIds).toEqual(['v1', 'v2']);
    expect(headRows(ordered)).toEqual(['1', '2']);

    const dup = await resolve([
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1', 1), tableEntry('e2', 2)], [
        delta({ seq: 1, entryId: 'va', sourceEntryId: 'e1', ops: [add('3', 'p1')] }),
        delta({ seq: 1, entryId: 'vb', sourceEntryId: 'e2', ops: [remove('3')] }),
      ])),
    ]);
    expect(dup.appliedDeltaEntryIds).toEqual(['va', 'vb']);
    expect(dup.diagnostics.some((item) => item.code === 'duplicate_delta_seq')).toBe(true);
  });

  it('R2：来源 table entry 不存在的 delta 是 orphan，丢弃并 stale', async () => {
    const chat = [
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'gone', ops: [add('3', 'p1')] })])),
    ];
    const result = await resolve(chat);
    expect(result.status).toBe('ok');
    expect(headRows(result)).toEqual(['1', '2']);
    expect(result.stale).toBe(true);
    expect(result.chainConflict).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: 'orphan_delta', messageIndex: 1, entryId: 'v1' });
    expect(result.packRefs.map((ref) => ref.packHash)).toEqual(['p0']);
  });

  it('R6：row_add 已存在 rowId → chain_conflict，整条 delta 丢弃且后续 delta 继续', async () => {
    const chat = [
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('1', 'p1'), add('3', 'p1')] })])),
      ai(logFrame([tableEntry('e2')], [delta({ seq: 1, entryId: 'v2', sourceEntryId: 'e2', ops: [add('4', 'p2')] })])),
    ];
    const result = await resolve(chat);
    expect(headRows(result)).toEqual(['1', '2', '4']);
    expect(result.chainConflict).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.appliedDeltaEntryIds).toEqual(['v2']);
    expect(result.diagnostics[0]).toMatchObject({ code: 'chain_conflict', entryId: 'v1', rowId: '1' });
  });

  it('R6：row_remove 不存在 rowId → chain_conflict', async () => {
    const chat = [
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [remove('99')] })])),
    ];
    const result = await resolve(chat);
    expect(result.chainConflict).toBe(true);
    expect(headRows(result)).toEqual(['1', '2']);
  });

  it('同一 delta 内同 rowId 出现两次 → chain_conflict', async () => {
    const chat = [
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1'), remove('3')] })])),
    ];
    const result = await resolve(chat);
    expect(result.chainConflict).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({ code: 'chain_conflict', rowId: '3' });
  });

  it('row_add 缺 chunks 或引用的 pack 不在本 delta packRefs → invalid_delta 丢弃', async () => {
    const noChunks = delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [{ kind: 'row_add', rowId: '3', chunks: [], vectorSourceHash: 'x' }] });
    const foreignPack = delta({ seq: 2, entryId: 'v2', sourceEntryId: 'e1', ops: [add('4', 'p2')], packs: [pack('p1')] });
    const result = await resolve([ai(fullFrame()), ai(logFrame([tableEntry('e1')], [noChunks, foreignPack]))]);
    expect(headRows(result)).toEqual(['1', '2']);
    expect(result.stale).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toEqual(['invalid_delta', 'invalid_delta']);
  });

  it('delta embedding 身份与 checkpoint 不一致 → delta_embedding_mismatch 丢弃', async () => {
    const result = await resolve([
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')], embedding: EMB_B })])),
    ]);
    expect(result.status).toBe('ok');
    expect(headRows(result)).toEqual(['1', '2']);
    expect(result.diagnostics[0].code).toBe('delta_embedding_mismatch');
  });

  it('非基底楼层出现 vector checkpoint → misplaced_checkpoint，忽略该 checkpoint 但继续应用其 delta', async () => {
    const misplaced = logFrame([tableEntry('e1')], [], {
      summaryVectorIndexFrame: { version: 3, sourceTableKey: SOURCE, checkpoint: checkpoint(), logEntries: [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] })] },
    });
    const result = await resolve([ai(fullFrame()), ai(misplaced)]);
    expect(result.diagnostics.map((item) => item.code)).toEqual(['misplaced_checkpoint']);
    expect(headRows(result)).toEqual(['1', '2', '3']);
    expect(result.checkpointMessageIndex).toBe(0);
  });

  it('表格侧多个 full checkpoint 时以最后一个为基底，更早 full frame 上的 vector checkpoint 与 delta 不参与', async () => {
    const early = fullFrame({ entries: [tableEntry('c0')], deltas: [delta({ seq: 1, entryId: 'v0', sourceEntryId: 'c0', ops: [add('9', 'p9')] })] });
    const result = await resolve([ai(early), ai(fullFrame())]);
    expect(result.checkpointMessageIndex).toBe(1);
    expect(headRows(result)).toEqual(['1', '2']);
    expect(result.appliedDeltaEntryIds).toEqual([]);
  });

  it('maxMessageIndexExclusive 之后的楼层 delta 不应用（fold 语义）', async () => {
    const chat = [
      ai(fullFrame()),
      ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] })])),
      ai(logFrame([tableEntry('e2')], [delta({ seq: 1, entryId: 'v2', sourceEntryId: 'e2', ops: [add('4', 'p2')] })])),
    ];
    const folded = await resolve(chat, { maxMessageIndexExclusive: 2 });
    expect(headRows(folded)).toEqual(['1', '2', '3']);
    expect(folded.appliedDeltaEntryIds).toEqual(['v1']);
    const full = await resolve(chat);
    expect(headRows(full)).toEqual(['1', '2', '3', '4']);
  });

  it('镜像 frame sourceTableKey 与当前纪要表不一致的楼层整层跳过并 stale', async () => {
    const foreign = logFrame([tableEntry('e1')], [], {
      summaryVectorIndexFrame: { version: 3, sourceTableKey: 'sheet_other', logEntries: [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] })] },
    });
    const result = await resolve([ai(fullFrame()), ai(foreign)]);
    expect(headRows(result)).toEqual(['1', '2']);
    expect(result.stale).toBe(true);
    expect(result.diagnostics[0].code).toBe('invalid_delta');
  });

  it('manifest 重复 rowId 后者覆盖并记 manifest_duplicate_row_id', async () => {
    const result = await resolve([ai(fullFrame())], {
      manifest: {
        ...MANIFEST,
        rows: [
          { rowId: '1', chunks: [{ packHash: 'p0', chunkIndex: 0 }] },
          { rowId: '1', chunks: [{ packHash: 'p0', chunkIndex: 5 }] },
        ],
      },
    });
    expect(result.head.get('1')).toEqual([{ packHash: 'p0', chunkIndex: 5 }]);
    expect(result.diagnostics[0]).toMatchObject({ code: 'manifest_duplicate_row_id', rowId: '1' });
  });
});

describe('vectorRevision', () => {
  it('无 delta 时等于 checkpoint revision 的派生值，且稳定', async () => {
    const chat = [ai(fullFrame())];
    const a = await resolve(chat);
    const b = await resolve(chat);
    expect(a.vectorRevision).toBe(computeSummaryVectorMirrorHeadRevision_ACU('cp-rev', []));
    expect(a.vectorRevision).toBe(b.vectorRevision);
  });

  it('delta 增删改变 revision；messageIndex 位移不改变 revision', async () => {
    const d1 = delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] });
    const base = await resolve([ai(fullFrame()), ai(logFrame([tableEntry('e1')], [d1]))]);
    const withoutDelta = await resolve([ai(fullFrame()), ai(logFrame([tableEntry('e1')]))]);
    const shifted = await resolve([user(), ai(), user(), ai(fullFrame()), user(), ai(logFrame([tableEntry('e1')], [d1]))]);
    expect(base.vectorRevision).not.toBe(withoutDelta.vectorRevision);
    expect(shifted.vectorRevision).toBe(base.vectorRevision);
  });

  it('checkpoint revision 对 rowId 顺序不敏感、对引用变化敏感', () => {
    const a = computeSummaryVectorMirrorCheckpointRevision_ACU([
      { rowId: '2', chunks: [{ packHash: 'p', chunkIndex: 1 }] },
      { rowId: '1', chunks: [{ packHash: 'p', chunkIndex: 0 }] },
    ]);
    const b = computeSummaryVectorMirrorCheckpointRevision_ACU([
      { rowId: '1', chunks: [{ packHash: 'p', chunkIndex: 0 }] },
      { rowId: '2', chunks: [{ packHash: 'p', chunkIndex: 1 }] },
    ]);
    const c = computeSummaryVectorMirrorCheckpointRevision_ACU([
      { rowId: '1', chunks: [{ packHash: 'p', chunkIndex: 0 }] },
      { rowId: '2', chunks: [{ packHash: 'q', chunkIndex: 1 }] },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('validateSummaryVectorMirrorDelta_ACU', () => {
  it('合法 delta 返回 null', () => {
    expect(validateSummaryVectorMirrorDelta_ACU(delta({ seq: 1, entryId: 'v', sourceEntryId: 'e', ops: [add('1', 'p')] }))).toBeNull();
    expect(validateSummaryVectorMirrorDelta_ACU(delta({ seq: 1, entryId: 'v', sourceEntryId: 'e', ops: [remove('1')], packs: [] }))).toBeNull();
  });

  it('operations 为空 / rowId 为空 / 未知 kind / 缺 vectorSourceHash 均非法', () => {
    const base = delta({ seq: 1, entryId: 'v', sourceEntryId: 'e', ops: [add('1', 'p')] });
    expect(validateSummaryVectorMirrorDelta_ACU({ ...base, operations: [] })).toMatch(/operations 为空/);
    expect(validateSummaryVectorMirrorDelta_ACU({ ...base, operations: [{ kind: 'row_remove', rowId: '' }] })).toMatch(/rowId 为空/);
    expect(validateSummaryVectorMirrorDelta_ACU({ ...base, operations: [{ kind: 'row_upsert', rowId: '1' }] })).toMatch(/未知 operation kind/);
    expect(validateSummaryVectorMirrorDelta_ACU({ ...base, operations: [{ kind: 'row_add', rowId: '1', chunks: [{ packHash: 'p', chunkIndex: 0 }] }] })).toMatch(/vectorSourceHash/);
  });
});

describe('assertSummaryVectorMirrorFrameInvariantsV2_ACU', () => {
  it('合法结构返回 null；无镜像 frame 也返回 null', () => {
    const chat = [ai(fullFrame()), ai(logFrame([tableEntry('e1')], [delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] })]))];
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU(chat, ISOLATION, 'test')).toBeNull();
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(fullFrame({ vectorCheckpoint: null }))], ISOLATION, 'test')).toBeNull();
  });

  it('非 full frame 上的 vector checkpoint 被拒绝', () => {
    const misplaced = logFrame([tableEntry('e1')], [], {
      summaryVectorIndexFrame: { version: 3, sourceTableKey: SOURCE, checkpoint: checkpoint(), logEntries: [] },
    });
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(fullFrame()), ai(misplaced)], ISOLATION, 'test')).toMatch(/没有表格 full checkpoint 却存在 vector checkpoint/);
  });

  it('多个 vector checkpoint 被拒绝', () => {
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(fullFrame()), ai(fullFrame())], ISOLATION, 'test')).toMatch(/存在 2 个 vector checkpoint/);
  });

  it('非法 delta 与重复 entryId 被拒绝', () => {
    const bad = logFrame([tableEntry('e1')], [{ ...delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] }), operations: [] }]);
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(fullFrame()), ai(bad)], ISOLATION, 'test')).toMatch(/vector delta 非法/);

    const d = delta({ seq: 1, entryId: 'v1', sourceEntryId: 'e1', ops: [add('3', 'p1')] });
    const dup = logFrame([tableEntry('e1')], [d, { ...d, seq: 2 }]);
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(fullFrame()), ai(dup)], ISOLATION, 'test')).toMatch(/重复的 vector delta entryId=v1/);
  });

  it('镜像 frame 结构非法被拒绝', () => {
    const broken = logFrame([tableEntry('e1')], [], {
      summaryVectorIndexFrame: { version: 2, sourceTableKey: SOURCE, logEntries: [] } as any,
    });
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(fullFrame()), ai(broken)], ISOLATION, 'test')).toMatch(/结构非法/);
  });

  it('rowCount=0 但 embedding.dimension>0 的 vector_full 合法', () => {
    const emptyLegal = fullFrame({
      vectorCheckpoint: checkpoint({ rowCount: 0, packRefs: [], vectorRevision: computeSummaryVectorMirrorCheckpointRevision_ACU([]) }),
    });
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(emptyLegal)], ISOLATION, 'test')).toBeNull();
  });

  it('embedding.dimension=0 的 vector_full 结构非法', () => {
    const illegal = fullFrame({
      vectorCheckpoint: checkpoint({
        rowCount: 0,
        packRefs: [],
        embedding: { ...EMB, dimension: 0 },
      }),
    });
    expect(assertSummaryVectorMirrorFrameInvariantsV2_ACU([ai(illegal)], ISOLATION, 'test')).toMatch(/结构非法/);
  });
});
