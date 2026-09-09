/**
 * 重建行集合选择：空 C / rowId 错位必须 seed 当前纪要表，空 vector_full 不算已有数据。
 */
import { describe, expect, it } from 'vitest';

import {
  chatHasSummaryVectorMirror_ACU,
  currentEnvironmentHasSummaryVectorMirror_ACU,
  selectRebuildSourceRowIds_ACU,
} from '../../../src/service/vector/summary-vector-mirror-rebuild';

function vectorMessage(rowCount: number, isolationKey = '') {
  return {
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      [isolationKey]: {
        storageFrame: {
          summaryVectorIndexFrame: {
            checkpoint: { kind: 'vector_full', rowCount },
          },
        },
      },
    },
  };
}

describe('selectRebuildSourceRowIds_ACU', () => {
  it('C 与当前表有交集时只索引对得上的 C 行', () => {
    expect(selectRebuildSourceRowIds_ACU({
      checkpointRowIds: ['1', '2'],
      preparedRowIds: ['1', '2', '3'],
    })).toEqual({ rowIds: ['1', '2'], seededFromLiveTable: false });
  });

  it('C 为空且当前表有行时 seed 当前表', () => {
    expect(selectRebuildSourceRowIds_ACU({
      checkpointRowIds: [],
      preparedRowIds: ['1', '2', '3'],
    })).toEqual({ rowIds: ['1', '2', '3'], seededFromLiveTable: true });
  });

  it('C 的 rowId 与当前表对不上时 seed 当前表，避免交叉过滤成 0 行', () => {
    expect(selectRebuildSourceRowIds_ACU({
      checkpointRowIds: ['1', '2', '3'],
      preparedRowIds: ['AM0001', 'AM0002', 'AM0003'],
    })).toEqual({ rowIds: ['AM0001', 'AM0002', 'AM0003'], seededFromLiveTable: true });
  });

  it('两边都没有可用行时返回空集合', () => {
    expect(selectRebuildSourceRowIds_ACU({
      checkpointRowIds: ['1'],
      preparedRowIds: [],
    })).toEqual({ rowIds: [], seededFromLiveTable: false });
  });
});

describe('空 vector_full 不算已有镜像', () => {
  it('rowCount=0 的当前 isolation 不阻断再次 initial 重建', () => {
    const chat = [vectorMessage(0)];
    expect(currentEnvironmentHasSummaryVectorMirror_ACU(chat, '')).toBe(false);
    expect(chatHasSummaryVectorMirror_ACU(chat)).toBe(false);
  });

  it('rowCount>0 才视为当前环境已有向量数据', () => {
    const chat = [vectorMessage(3)];
    expect(currentEnvironmentHasSummaryVectorMirror_ACU(chat, '')).toBe(true);
    expect(chatHasSummaryVectorMirror_ACU(chat)).toBe(true);
  });
});
