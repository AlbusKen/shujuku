import { describe, expect, it } from 'vitest';
import {
  EmbeddingBatchExecutionError_ACU,
  executeEmbeddingBatchPlan_ACU,
  planEmbeddingBatches_ACU,
} from '../../../src/service/vector/summary-vector-embedding-batches';

describe('summary-vector-embedding-batches', () => {
  it('keeps rows intact and applies row/character limits with an explicit over-budget row', () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'aa' }, { rowKey: 'a', text: 'bb' },
      { rowKey: 'b', text: 'ccc' }, { rowKey: 'c', text: '123456' },
    ], { maxRowsPerRequest: 2, maxInputCharsPerRequest: 5 });

    expect(plan.batches.map(batch => batch.sources.map(item => item.source.text))).toEqual([
      ['aa', 'bb'], ['ccc'], ['123456'],
    ]);
    expect(plan.batches.map(batch => batch.singleRowOverBudget)).toEqual([false, false, true]);
  });

  it('bounds concurrent requests and returns vectors in source order', async () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'a' }, { rowKey: 'b', text: 'b' }, { rowKey: 'c', text: 'c' },
    ], { maxRowsPerRequest: 1, maxInputCharsPerRequest: 10 });
    let active = 0;
    let peak = 0;
    const result = await executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 2,
      requestEmbeddings: async input => {
        active += 1; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, input[0] === 'a' ? 8 : 1));
        active -= 1;
        return [{ index: 0, embedding: [input[0].charCodeAt(0)] }];
      },
    });

    expect(peak).toBe(2);
    expect(result.embeddings).toEqual([[97], [98], [99]]);
    expect(result.stats).toMatchObject({ plannedBatchCount: 3, completedBatchCount: 3, successfulBatchCount: 3 });
  });

  it('recovers only missing sources inside the failed-response batch', async () => {
    const plan = planEmbeddingBatches_ACU([{ rowKey: 'a', text: 'a' }, { rowKey: 'b', text: 'b' }], { maxRowsPerRequest: 2, maxInputCharsPerRequest: 10 });
    const requests: string[][] = [];
    const result = await executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 1,
      requestEmbeddings: async input => {
        requests.push(input);
        return requests.length === 1 ? [{ index: 0, embedding: [1] }] : [{ index: 0, embedding: [2] }];
      },
    });
    expect(requests).toEqual([['a', 'b'], ['b']]);
    expect(result.embeddings).toEqual([[1], [2]]);
  });

  it('stops new dispatch after a failure and settles already-started work', async () => {
    const plan = planEmbeddingBatches_ACU([
      { rowKey: 'a', text: 'a' }, { rowKey: 'b', text: 'b' }, { rowKey: 'c', text: 'c' },
    ], { maxRowsPerRequest: 1, maxInputCharsPerRequest: 10 });
    const started: string[] = [];
    await expect(executeEmbeddingBatchPlan_ACU(plan, {
      maxConcurrentRequests: 2,
      requestEmbeddings: async input => {
        started.push(input[0]);
        if (input[0] === 'a') throw new Error('first failure');
        await new Promise(resolve => setTimeout(resolve, 5));
        return [{ index: 0, embedding: [1] }];
      },
    })).rejects.toBeInstanceOf(EmbeddingBatchExecutionError_ACU);
    expect(started).toEqual(['a', 'b']);
  });
});
