/**
 * Agent 世界书结构性写操作的互斥队列。
 *
 * 接管、恢复、正文绿灯写入/清理、UI 配置写入都遵循"读账本 → 算补丁 → 写条目 → 写账本"
 * 的多步异步序列，交错执行会让账本与条目状态互相覆盖（例如恢复读到接管写到一半的
 * pending 账本）。这里用 promise 链把它们串成单队列。
 *
 * 边界约束（防死锁）：
 * 1. 锁是非重入的。被包裹的入口（takeover / restoreWorldbookGreenlights / writeFinal /
 *    clearFinal / writeAgentWorldbookControlToWorldbook）之间不得互相调用；它们内部只能
 *    调用不加锁的实现层（如 writeAgentWorldbookStateToWorldbook_ACU、私有 restore 帮助函数）。
 * 2. skillify 的 comment 写入刻意不进队列：整批 skillify 含多次 AI 调用、耗时以分钟计，
 *    入队会长时间阻塞剧情绿灯操作；其与接管的交错由 commentHash 守卫与 reconcile 自愈。
 */

let agentWorldbookOperationQueue_ACU: Promise<void> = Promise.resolve();

export function runExclusiveAgentWorldbookOperation_ACU<T>(operation: () => Promise<T>): Promise<T> {
  const result = agentWorldbookOperationQueue_ACU.then(() => operation());
  // 队列尾部吞掉失败：异常只传递给本次调用方，不能把后续操作永久卡死。
  agentWorldbookOperationQueue_ACU = result.then((): void => undefined, (): void => undefined);
  return result;
}
