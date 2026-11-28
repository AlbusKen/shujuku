import { describe, expect, it } from 'vitest';
import {
  hasLegacyTopLevelTableData_ACU,
  hasV2TableHistoryEvidence_ACU,
  isLegacyV1TagData_ACU,
  isV2TagData_ACU,
  resolveTableStorageStrategy_ACU,
} from '../../../src/service/table/storage-strategy-resolver';

const isolationConfig = { enabled: true, code: 'tag-a' };

function aiMessage(extra: Record<string, any> = {}) {
  return { is_user: false, ...extra };
}

describe('storage-strategy-resolver', () => {
  it('空聊天返回 empty', () => {
    expect(resolveTableStorageStrategy_ACU([], 'tag-a', isolationConfig)).toEqual({ mode: 'empty' });
  });

  it('识别 isolated independentData 为 legacy-v1', () => {
    const chat = [aiMessage({
      TavernDB_ACU_IsolatedData: {
        'tag-a': { independentData: { sheet_0: {} }, modifiedKeys: [], updateGroupKeys: [] },
      },
    })];

    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig).mode).toBe('legacy-v1');
  });

  it('识别 isolated incrementalData 为 legacy-v1', () => {
    const chat = [aiMessage({
      TavernDB_ACU_IsolatedData: {
        'tag-a': { independentData: {}, modifiedKeys: [], updateGroupKeys: [], incrementalData: {}, _acu_storage_mode: 'delta' },
      },
    })];

    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig).mode).toBe('legacy-v1');
  });

  it('识别匹配隔离标识的旧顶层字段为 legacy-v1', () => {
    const message = aiMessage({
      TavernDB_ACU_Identity: 'tag-a',
      TavernDB_ACU_IndependentData: { sheet_0: {} },
    });

    expect(hasLegacyTopLevelTableData_ACU(message, isolationConfig)).toBe(true);
    expect(resolveTableStorageStrategy_ACU([message], 'tag-a', isolationConfig).mode).toBe('legacy-v1');
  });

  it('不把不匹配隔离标识的旧顶层字段识别为当前标签数据', () => {
    const message = aiMessage({
      TavernDB_ACU_Identity: 'tag-b',
      TavernDB_ACU_IndependentData: { sheet_0: {} },
    });

    expect(hasLegacyTopLevelTableData_ACU(message, isolationConfig)).toBe(false);
    expect(resolveTableStorageStrategy_ACU([message], 'tag-a', isolationConfig)).toEqual({ mode: 'empty' });
  });

  it('识别合法 storageFrame.version=2 为 v2', () => {
    const tagData = { storageFrame: { version: 2, logEntries: [] }, _acu_storage_version: 2 };
    const chat = [aiMessage({ TavernDB_ACU_IsolatedData: { 'tag-a': tagData } })];

    expect(isV2TagData_ACU(tagData)).toBe(true);
    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig)).toEqual({ mode: 'v2' });
  });

  it('畸形 V2 frame 仍按 v2 历史处理，禁止误判为 empty 后重分配 key', () => {
    const tagData = { storageFrame: { version: 2, logEntries: 'broken' }, _acu_storage_version: 2 };
    const chat = [aiMessage({ TavernDB_ACU_IsolatedData: { 'tag-a': tagData } })];

    expect(isV2TagData_ACU(tagData)).toBe(false);
    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig)).toEqual({ mode: 'v2' });
  });

  it('只有 V2 版本标记但 frame 缺失时也 fail-closed 为 v2', () => {
    const chat = [aiMessage({
      TavernDB_ACU_IsolatedData: {
        'tag-a': { _acu_storage_version: 2, summaryIndexManifest: { id: 'm1' } },
      },
    })];

    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig)).toEqual({ mode: 'v2' });
  });

  it.each([
    ['full checkpoint', { checkpoint: { kind: 'full', data: {} } }],
    ['per-sheet checkpoint', { perSheetCheckpoints: { sheet_a: { kind: 'sheet_full', data: {} } } }],
    ['non-empty log', { logEntries: [{ seq: 1 }] }],
    ['head revision', { headRevision: 'checkpoint:orphan' }],
    ['manual refill progress', { manualRefillProgress: { status: 'in_progress' } }],
  ])('缺失版本标记但残留 %s 时仍按 v2 历史 fail-closed', (_label, storageFrame) => {
    const tagData = { storageFrame };
    const chat = [aiMessage({ TavernDB_ACU_IsolatedData: { 'tag-a': tagData } })];

    expect(hasV2TableHistoryEvidence_ACU(tagData)).toBe(true);
    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig)).toEqual({ mode: 'v2' });
  });

  it('其他 isolationKey 的 markerless V2 artifact 不阻止当前隔离域 pristine', () => {
    const chat = [aiMessage({
      TavernDB_ACU_IsolatedData: { 'tag-b': { storageFrame: { headRevision: 'checkpoint:other' } } },
    })];

    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig)).toEqual({ mode: 'empty' });
  });

  it('V2 tag 上的空 legacy 兼容字段不触发 legacy-v1', () => {
    const chat = [aiMessage({
      TavernDB_ACU_IsolatedData: {
        'tag-a': {
          storageFrame: { version: 2, logEntries: [] },
          independentData: {},
          modifiedKeys: [],
          updateGroupKeys: [],
          _acu_storage_version: 2,
        },
      },
    })];

    expect(resolveTableStorageStrategy_ACU(chat, 'tag-a', isolationConfig)).toEqual({ mode: 'v2' });
  });

  it('纯向量索引 tagData 不按 legacy-v1 表格数据处理', () => {
    const tagData = { summaryVectorIndexManifest: { id: 'm1' } };

    expect(isLegacyV1TagData_ACU(tagData)).toBe(false);
    expect(resolveTableStorageStrategy_ACU([
      aiMessage({ TavernDB_ACU_IsolatedData: { 'tag-a': tagData } }),
    ], 'tag-a', isolationConfig).mode).toBe('empty');
  });

  it('Issue #83B：仅包含 manualRefillSessionV1 的隔离槽既不判为 v2 也不判为 legacy-v1，解析为 empty', () => {
    const tagData = {
      manualRefillSessionV1: {
        version: 1,
        kind: 'manual_refill_session',
        runId: 'run-1',
        isolationKey: 'tag-a',
        status: 'in_progress',
        rangeIndices: [1, 3],
        targetSheetKeys: ['sheet_0'],
        templateFingerprint: 'fp-1',
        batchSize: 1,
        perSheetProgress: {
          sheet_0: { lastCommittedMessageIndex: 1, committedBatchCount: 1, updatedAt: 100 },
        },
        createdAt: 100,
        updatedAt: 100,
      },
    };

    expect(hasV2TableHistoryEvidence_ACU(tagData)).toBe(false);
    expect(isV2TagData_ACU(tagData)).toBe(false);
    expect(isLegacyV1TagData_ACU(tagData)).toBe(false);
    expect(resolveTableStorageStrategy_ACU([
      aiMessage({ TavernDB_ACU_IsolatedData: { 'tag-a': tagData } }),
    ], 'tag-a', isolationConfig)).toEqual({ mode: 'empty' });
  });

  it('跨消息混合 V2 与 legacy 时 legacy-v1 优先并保留审计原因', () => {
    const result = resolveTableStorageStrategy_ACU([
      aiMessage({
        TavernDB_ACU_IsolatedData: {
          'tag-a': { storageFrame: { version: 2, logEntries: [] }, _acu_storage_version: 2 },
        },
      }),
      aiMessage({
        TavernDB_ACU_Identity: 'tag-a',
        TavernDB_ACU_IndependentData: { sheet_0: {} },
      }),
    ], 'tag-a', isolationConfig);

    expect(result).toEqual({
      mode: 'legacy-v1',
      reason: 'message#1: legacy top-level table fields',
      warning: 'mixed legacy-v1 and v2 data detected; legacy-v1 wins',
    });
  });
});
