import { describe, expect, it } from 'vitest';
import {
  assembleBucketWorkingView_ACU,
  createEmptyTargetOverlay_ACU,
  extractTargetOverlaySheets_ACU,
  mergeTargetOverlayFromBucket_ACU,
  planTableFillBoundaryStaging_ACU,
} from '../../../src/service/table/table-fill-boundary-staging';

describe('planTableFillBoundaryStaging_ACU', () => {
  it('待填范围跨越唯一 full 根时，把根前索引隔离为 staging 并冻结运行作用域', () => {
    const plan = planTableFillBoundaryStaging_ACU({
      runKind: 'auto_fill',
      runId: 'run-001',
      chatKey: 'chat-001',
      isolationKey: 'scope-a',
      targetSheetKeys: ['sheet_b', 'sheet_a'],
      templateFingerprint: 'template-v1',
      messageIndices: [11, 21, 31, 41],
      fullCheckpointIndices: [31],
    });

    expect(plan).toEqual({
      scope: {
        runKind: 'auto_fill',
        runId: 'run-001',
        chatKey: 'chat-001',
        isolationKey: 'scope-a',
        originalFullIndex: 31,
        rangeStartMessageIndex: 11,
        rangeEndMessageIndex: 41,
        targetSheetKeys: ['sheet_a', 'sheet_b'],
        templateFingerprint: 'template-v1',
      },
      preBoundaryIndices: [11, 21],
      postBoundaryIndices: [31, 41],
      requiresStaging: true,
      phase: 'pre_boundary_staging',
      lastStagedTargetMessageIndex: null,
      stagedBucketCount: 0,
      boundaryCommitted: false,
    });
  });

  it('将运行身份与边界事实冻结为独立 scope，后续阶段状态不能改写它', () => {
    const plan = planTableFillBoundaryStaging_ACU({
      runKind: 'manual_refill',
      runId: 'run-scope',
      chatKey: 'chat-scope',
      isolationKey: '',
      targetSheetKeys: ['sheet_a'],
      templateFingerprint: 'template-scope',
      messageIndices: [4, 8],
      fullCheckpointIndices: [8],
    });

    expect(plan.scope).toEqual({
      runKind: 'manual_refill',
      runId: 'run-scope',
      chatKey: 'chat-scope',
      isolationKey: '',
      originalFullIndex: 8,
      rangeStartMessageIndex: 4,
      rangeEndMessageIndex: 8,
      targetSheetKeys: ['sheet_a'],
      templateFingerprint: 'template-scope',
    });
    expect(Object.isFrozen(plan.scope)).toBe(true);
    expect(Object.isFrozen(plan.scope.targetSheetKeys)).toBe(true);
  });

  it('多 full checkpoint（多根）时在规划阶段 fail-closed，拒绝跨根 staging', () => {
    expect(() => planTableFillBoundaryStaging_ACU({
      runKind: 'manual_refill',
      runId: 'run-multi-root',
      chatKey: 'chat-multi-root',
      isolationKey: '',
      targetSheetKeys: ['sheet_a'],
      templateFingerprint: 'template-multi-root',
      messageIndices: [1, 2, 4, 5, 8, 9],
      fullCheckpointIndices: [4, 8],
    })).toThrow(/同一 isolationKey 下存在 2 个 full checkpoint/);
  });

});


import { splitMessageIndicesAtBoundary_ACU, splitMessageIndicesAtSchemaBoundaries_ACU } from '../../../src/service/table/table-fill-boundary-staging';

describe('splitMessageIndicesAtBoundary_ACU', () => {
  it('无 full 根时整段作为普通单段，基底取首楼前一层', () => {
    const segments = splitMessageIndicesAtBoundary_ACU([3, 4, 5], null);
    expect(segments).toEqual([{
      indices: [3, 4, 5],
      saveTargetIndex: 5,
      mergeBaseMaxMessageIndex: 2,
    }]);
  });

  it('单 batch 跨边界时拆为 pre/post 两段并各自重算 save target 与基底', () => {
    const segments = splitMessageIndicesAtBoundary_ACU([10, 20, 30, 40, 50], 30);
    expect(segments).toEqual([
      { indices: [10, 20], saveTargetIndex: 20, mergeBaseMaxMessageIndex: 9 },
      { indices: [30, 40, 50], saveTargetIndex: 50, mergeBaseMaxMessageIndex: 29 },
    ]);
  });

  it('边界楼层在待填集合内时，post 段基底至少覆盖原根', () => {
    const segments = splitMessageIndicesAtBoundary_ACU([30, 40, 50], 30, new Set([30]));
    expect(segments).toEqual([{
      indices: [30, 40, 50],
      saveTargetIndex: 50,
      mergeBaseMaxMessageIndex: 30,
    }]);
  });

  it('post 段段首不是原根时基底不人为抬高到原根', () => {
    const segments = splitMessageIndicesAtBoundary_ACU([35, 40], 30);
    expect(segments).toEqual([{
      indices: [35, 40],
      saveTargetIndex: 40,
      mergeBaseMaxMessageIndex: 34,
    }]);
  });

  it('空索引返回空段', () => {
    expect(splitMessageIndicesAtBoundary_ACU([], 30)).toEqual([]);
  });

  it('非法索引输入抛出规划错误', () => {
    expect(() => splitMessageIndicesAtBoundary_ACU([2, 1], 30)).toThrow(/严格递增/);
  });

  it('schema 边界切段：full 根与 schema rebase 边界同时存在时，按边界拆出第三段并携带 boundaryKind', () => {
    const segments = splitMessageIndicesAtSchemaBoundaries_ACU(
      [10, 20, 30, 40, 50],
      30,
      [{ index: 40, kind: 'sheet_rebase' }],
      new Set([30]),
    );
    expect(segments).toEqual([
      { indices: [10, 20], saveTargetIndex: 20, mergeBaseMaxMessageIndex: 9 },
      { indices: [30], saveTargetIndex: 30, mergeBaseMaxMessageIndex: 30 },
      // 后段从 schema rebase 生效帧开始，基底必须回放到 40 才能带出新结构。
      { indices: [40, 50], saveTargetIndex: 50, mergeBaseMaxMessageIndex: 40, boundaryKind: 'sheet_rebase' },
    ]);
  });

  it('schema 边界与 full 根同楼层时合并为一个切点，post 段带边界类型且基底覆盖原根', () => {
    const segments = splitMessageIndicesAtSchemaBoundaries_ACU(
      [30, 40, 50],
      30,
      [{ index: 30, kind: 'sheet_introduction' }],
      new Set([30]),
    );
    expect(segments).toEqual([
      { indices: [30, 40, 50], saveTargetIndex: 50, mergeBaseMaxMessageIndex: 30, boundaryKind: 'sheet_introduction' },
    ]);
  });

  it('无 full 根但存在 schema 边界时按 schema 边界拆段', () => {
    const segments = splitMessageIndicesAtSchemaBoundaries_ACU(
      [3, 4, 5],
      null,
      [{ index: 4, kind: 'sheet_hide' }],
    );
    expect(segments).toEqual([
      { indices: [3], saveTargetIndex: 3, mergeBaseMaxMessageIndex: 2 },
      // hide 生效帧同样进入该段基底，使回放能看到 hide 后的 active 投影。
      { indices: [4, 5], saveTargetIndex: 5, mergeBaseMaxMessageIndex: 4, boundaryKind: 'sheet_hide' },
    ]);
  });

  it('无 schema 边界时与旧 split 行为一致', () => {
    expect(splitMessageIndicesAtSchemaBoundaries_ACU([10, 20, 30, 40, 50], 30, [], new Set([30])))
      .toEqual(splitMessageIndicesAtBoundary_ACU([10, 20, 30, 40, 50], 30, new Set([30])));
  });
});

describe('target overlay 连续装配', () => {
  it('后续 pre bucket 看见前一 bucket 的目标表结果，且不带入未来非目标数据', () => {
    const overlay = createEmptyTargetOverlay_ACU(['sheet_b']);
    const afterBucket1 = mergeTargetOverlayFromBucket_ACU(overlay, {
      mate: { type: 'acu' },
      sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', '值'], ['1', 'future-a']] },
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值'], ['1', 'b1']] },
    }, 80);
    expect(Object.keys(afterBucket1.sheets)).toEqual(['sheet_b']);
    expect(afterBucket1.sheets.sheet_b.content).toEqual([['row_id', '值'], ['1', 'b1']]);

    const historicalAt80 = {
      mate: { type: 'acu' },
      sheet_a: { uid: 'sheet_a', name: 'A', content: [['row_id', '值']] },
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值']] },
    };
    const working = assembleBucketWorkingView_ACU(historicalAt80, afterBucket1);
    expect(working.sheet_b.content).toEqual([['row_id', '值'], ['1', 'b1']]);
    expect(working.sheet_a.content).toEqual([['row_id', '值']]);

    const afterBucket2 = mergeTargetOverlayFromBucket_ACU(afterBucket1, {
      sheet_b: { uid: 'sheet_b', name: 'B', content: [['row_id', '值'], ['1', 'b1-edited']] },
    }, 90);
    expect(afterBucket2.sheets.sheet_b.content).toEqual([['row_id', '值'], ['1', 'b1-edited']]);
    expect(afterBucket2.stagedBucketCount).toBe(2);
    expect(extractTargetOverlaySheets_ACU({ sheet_a: { uid: 'a' }, sheet_b: afterBucket2.sheets.sheet_b }, ['sheet_b'])).toEqual({
      sheet_b: afterBucket2.sheets.sheet_b,
    });
  });
});
