import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  isolationKey: 'active',
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => h.chat,
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));

import {
  getAllSummaryVectorIndexSnapshotLayers_ACU,
  getAggregatedSummaryVectorIndexSnapshot_ACU,
} from '../../../src/service/vector/summary-vector-index-state-service';

function manifest(indexId: string, isolationKey: string): any {
  return {
    version: 1,
    backend: 'st-files',
    status: 'ready',
    indexId,
    chatKey: 'chat-a',
    isolationKey,
    snapshotMessageId: `message-${indexId}`,
    sourceTableKey: 'summary',
    sourceTableName: '纪要表',
    indexedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    rowCount: 1,
    chunkCount: 1,
    skippedRowCount: 0,
    embeddingModel: 'model-a',
    dimension: 2,
    rowsFile: `path-${indexId}`,
    tombstoneFile: `path-${indexId}`,
    manifestFile: `path-${indexId}`,
    files: [],
    baseShardCount: 0,
    deltaShardCount: 0,
    tombstoneRowCount: 0,
    tombstoneChunkCount: 0,
    externalTotalBytes: 1,
  };
}

describe('getAllSummaryVectorIndexSnapshotLayers_ACU', () => {
  beforeEach(() => {
    h.chat = [];
    h.isolationKey = 'active';
  });

  it('枚举全部 tag slot，并区分默认空槽与 manifest canonical default', () => {
    const defaultManifest = manifest('default-index', 'default');
    const otherManifest = manifest('other-index', 'other');
    h.chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': { summaryVectorIndexManifest: defaultManifest },
        other: { summaryVectorIndexState: { manifest: otherManifest } },
        noVector: { independentData: {} },
      },
    }];

    const layers = getAllSummaryVectorIndexSnapshotLayers_ACU();

    expect(layers).toHaveLength(2);
    expect(layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ isolationKey: '', summaryVectorIndexState: expect.objectContaining({ indexId: 'default-index' }) }),
      expect.objectContaining({ isolationKey: 'other', summaryVectorIndexState: expect.objectContaining({ indexId: 'other-index' }) }),
    ]));
  });

  it('支持字符串容器并忽略用户消息', () => {
    const vectorManifest = manifest('string-index', 'other');
    h.chat = [
      { is_user: true, TavernDB_ACU_IsolatedData: { other: { summaryVectorIndexManifest: vectorManifest } } },
      { is_user: false, TavernDB_ACU_IsolatedData: JSON.stringify({ other: { summaryVectorIndexManifest: vectorManifest } }) },
    ];

    expect(getAllSummaryVectorIndexSnapshotLayers_ACU()).toEqual([
      expect.objectContaining({ messageIndex: 1, isolationKey: 'other' }),
    ]);
  });

  it('不改变当前 isolation 聚合入口的既有语义', () => {
    h.chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        active: { summaryVectorIndexManifest: manifest('active-index', 'active') },
        other:{ summaryVectorIndexManifest: manifest('other-index', 'other') },
      },
    }];

    const snapshot = getAggregatedSummaryVectorIndexSnapshot_ACU();
    expect(snapshot?.layers).toHaveLength(1);
    expect(snapshot?.summaryVectorIndexState?.indexId).toBe('active-index');
  });
});
