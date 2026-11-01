/**
 * 有界并发映射：结果按输入顺序返回，同时最多运行 limit 个任务。
 * 任一任务抛错时整体 reject（与串行 for-await 的失败语义一致），调用方自行决定如何处理。
 */
export async function mapWithBoundedConcurrency_ACU<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(items.length, Math.floor(Number(limit) || 1)));
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
