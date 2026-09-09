import { describe, expect, it } from 'vitest';

import {
  purgeManualRefillIncrementalSheetKeysFromMessage_ACU,
  purgeSheetKeysFromMessage_ACU,
} from '../../../src/data/repositories/chat-message-data-repo';

const SUMMARY = 'sheet_summary';
const OTHER = 'sheet_other';
const EMB = { endpointFingerprint: 'ep', model: 'm', dimension: 4, sourceTextVersion: 2 };

function pack(hash: string) {
  return { packHash: hash, path: `TavernDB_ACU_vector_v2pack_scope_${hash}`, chunkCount: 1, byteLength: 8 };
}

function vectorCheckpoint() {
  return {
    kind: 'vector_full',
    createdAt: 1,
    reason: 'initial',
    sourceTableKey: SUMMARY,
    tableCheckpointFingerprint: 'fp',
    embedding: EMB,
    rowCount: 1,
    vectorRevision: 'rev',
    manifestRef: { manifestHash: 'mf', path: 'TavernDB_ACU_vector_v2vcp_scope_mf', byteLength: 8 },
    packRefs: [pack('p0')],
  };
}

function vectorDelta(entryId: string, sourceEntryId: string, rowId: string) {
  return {
    seq: 1,
    entryId,
    createdAt: 1,
    sourceTableEntry: { entryId: sourceEntryId, commitRevision: `rev-${sourceEntryId}`, messageIndex: 0 },
    embedding: EMB,
    packRefs: [pack(`p-${rowId}`)],
    operations: [{ kind: 'row_add', rowId, chunks: [{ packHash: `p-${rowId}`, chunkIndex: 0 }], vectorSourceHash: 'h' }],
  };
}

function tableEntry(entryId: string, sheetKey: string, seq: number) {
  return {
    seq,
    entryId,
    commitRevision: `rev-${entryId}`,
    filledSheetKeys: [sheetKey],
    changedSheetKeys: [sheetKey],
    operations: [{ kind: 'row_upsert', sheetKey, rowId: `r-${entryId}`, cells: [`r-${entryId}`] }],
    writeSet: [{ kind: 'sheet', sheetKey }],
  };
}

function messageWithFrame(frame: any): any {
  return { is_user: false, TavernDB_ACU_IsolatedData: { tag1: { storageFrame: frame } } };
}

function frameOf(msg: any): any {
  return msg.TavernDB_ACU_IsolatedData.tag1.storageFrame;
}

describe('purgeSheetKeysFromMessage_ACU 与纪要向量镜像', () => {
  it('删除纪要表 sheetKey 时整体移除 summaryVectorIndexFrame（checkpoint + delta）', () => {
    const msg = messageWithFrame({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { [SUMMARY]: { name: '纪要表' }, [OTHER]: { name: '其他表' } } },
      logEntries: [tableEntry('e1', SUMMARY, 1)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        checkpoint: vectorCheckpoint(),
        logEntries: [vectorDelta('v1', 'e1', '1')],
      },
    });

    expect(purgeSheetKeysFromMessage_ACU(msg, [SUMMARY])).toBe(true);
    const frame = frameOf(msg);
    expect(frame.summaryVectorIndexFrame).toBeUndefined();
    expect(frame.checkpoint.data[OTHER]).toBeDefined();
  });

  it('删除其他表不触碰镜像', () => {
    const msg = messageWithFrame({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { [SUMMARY]: { name: '纪要表' }, [OTHER]: { name: '其他表' } } },
      logEntries: [tableEntry('e1', SUMMARY, 1)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        checkpoint: vectorCheckpoint(),
        logEntries: [vectorDelta('v1', 'e1', '1')],
      },
    });

    expect(purgeSheetKeysFromMessage_ACU(msg, [OTHER])).toBe(true);
    const frame = frameOf(msg);
    expect(frame.summaryVectorIndexFrame.checkpoint).toEqual(vectorCheckpoint());
    expect(frame.summaryVectorIndexFrame.logEntries).toHaveLength(1);
  });

  it('checkpoint.data 被清空导致表格 checkpoint 删除时同步删除 vector checkpoint，保留仍有来源 entry 的 delta', () => {
    // 镜像的 sourceTableKey 指向一个已不存在于 sheetKeys 的键，确保走的是"锚点消失"而非"删纪要表"分支。
    const msg = messageWithFrame({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { [OTHER]: { name: '其他表' } } },
      logEntries: [tableEntry('e1', SUMMARY, 1)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        checkpoint: vectorCheckpoint(),
        logEntries: [vectorDelta('v1', 'e1', '1')],
      },
    });

    expect(purgeSheetKeysFromMessage_ACU(msg, [OTHER])).toBe(true);
    const frame = frameOf(msg);
    expect(frame.checkpoint).toBeUndefined();
    expect(frame.summaryVectorIndexFrame).toBeDefined();
    expect(frame.summaryVectorIndexFrame.checkpoint).toBeUndefined();
    expect(frame.summaryVectorIndexFrame.logEntries.map((delta: any) => delta.entryId)).toEqual(['v1']);
  });

  it('表格 entry 被完整裁掉后其 vector delta 作为 orphan 一并移除，其余 delta 保留', () => {
    const msg = messageWithFrame({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { [SUMMARY]: { name: '纪要表' }, [OTHER]: { name: '其他表' } } },
      logEntries: [tableEntry('keep', SUMMARY, 1), tableEntry('drop', OTHER, 2)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        checkpoint: vectorCheckpoint(),
        logEntries: [vectorDelta('v-keep', 'keep', '1'), vectorDelta('v-drop', 'drop', '2')],
      },
    });

    expect(purgeSheetKeysFromMessage_ACU(msg, [OTHER])).toBe(true);
    const frame = frameOf(msg);
    expect(frame.logEntries.map((entry: any) => entry.entryId)).toEqual(['keep']);
    expect(frame.summaryVectorIndexFrame.logEntries.map((delta: any) => delta.entryId)).toEqual(['v-keep']);
    expect(frame.summaryVectorIndexFrame.checkpoint).toBeDefined();
  });

  it('镜像既无 checkpoint 又无剩余 delta 时整个 summaryVectorIndexFrame 被删除', () => {
    const msg = messageWithFrame({
      version: 2,
      logEntries: [tableEntry('drop', OTHER, 1)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        logEntries: [vectorDelta('v-drop', 'drop', '2')],
      },
    });

    expect(purgeSheetKeysFromMessage_ACU(msg, [OTHER])).toBe(true);
    expect(frameOf(msg).summaryVectorIndexFrame).toBeUndefined();
  });

  it('没有镜像的 frame 不因镜像逻辑产生变更', () => {
    const msg = messageWithFrame({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { [SUMMARY]: { name: '纪要表' } } },
      logEntries: [tableEntry('e1', SUMMARY, 1)],
    });

    expect(purgeSheetKeysFromMessage_ACU(msg, [OTHER])).toBe(false);
    expect(frameOf(msg).summaryVectorIndexFrame).toBeUndefined();
  });
});

describe('purgeManualRefillIncrementalSheetKeysFromMessage_ACU 与纪要向量镜像', () => {
  it('手动重填预清除裁掉纪要表 entry 后，其 vector delta 随之移除；checkpoint 不动', () => {
    const msg = messageWithFrame({
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { [SUMMARY]: { name: '纪要表' }, [OTHER]: { name: '其他表' } } },
      logEntries: [tableEntry('summary-entry', SUMMARY, 1), tableEntry('other-entry', OTHER, 2)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        checkpoint: vectorCheckpoint(),
        logEntries: [vectorDelta('v-summary', 'summary-entry', '1')],
      },
    });

    expect(purgeManualRefillIncrementalSheetKeysFromMessage_ACU(msg, 'tag1', [SUMMARY])).toBe(true);
    const frame = frameOf(msg);
    expect(frame.checkpoint.data[SUMMARY]).toBeDefined();
    expect(frame.logEntries.map((entry: any) => entry.entryId)).toEqual(['other-entry']);
    expect(frame.summaryVectorIndexFrame.checkpoint).toBeDefined();
    expect(frame.summaryVectorIndexFrame.logEntries).toEqual([]);
  });

  it('预清除未影响纪要表 entry 时 delta 保留', () => {
    const msg = messageWithFrame({
      version: 2,
      logEntries: [tableEntry('summary-entry', SUMMARY, 1), tableEntry('other-entry', OTHER, 2)],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: SUMMARY,
        logEntries: [vectorDelta('v-summary', 'summary-entry', '1')],
      },
    });

    expect(purgeManualRefillIncrementalSheetKeysFromMessage_ACU(msg, 'tag1', [OTHER])).toBe(true);
    const frame = frameOf(msg);
    expect(frame.logEntries.map((entry: any) => entry.entryId)).toEqual(['summary-entry']);
    expect(frame.summaryVectorIndexFrame.logEntries.map((delta: any) => delta.entryId)).toEqual(['v-summary']);
  });
});
