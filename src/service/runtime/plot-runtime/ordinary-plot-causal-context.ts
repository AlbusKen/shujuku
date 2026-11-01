import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { readWorldSimulationLedgerAtAnchor_ACU } from '../../simulation/agent/agent-module-store';
import { WORLD_SIMULATION_STATE_FIELD_ACU } from '../../simulation/agent/agent-model';
import { foldWorldSimulationLedger_ACU } from '../../simulation/simulation-ledger-fold';
import { FirstFloorWorldSimulationStore_ACU, readWorldSimulationBucketEntry_ACU, resolveWorldSimulationAnchor_ACU, validateWorldSimulationLedger_ACU } from '../../simulation/simulation-store';
import type { WorldSimulationLedger_ACU } from '../../simulation/model';
import { buildPlotWorldContext_ACU } from './plot-world-context';

/** 普通剧情仅使用与完成运行绑定的 host 楼层；不执行私有模型审查或程序筛选。 */
export async function createOrdinaryPlotCausalContext_ACU(input: {
  plotSettings: Record<string, any>; userMessage: string; signal: AbortSignal; assertCurrent(): void;
  explicitWorldSimulation?: boolean;
}): Promise<{ worldContext: ReturnType<typeof buildPlotWorldContext_ACU> } | null> {
  if (input.plotSettings?.enabled === false) return null;
  input.assertCurrent();
  const chat = getChatArray_ACU();
  let sourceIndex = chat.length - 1;
  while (sourceIndex >= 0 && (chat[sourceIndex]?.is_user === true || chat[sourceIndex]?._qrf_plot_pending_placeholder)) sourceIndex--;
  if (sourceIndex < 0) return null;
  const hostAnchor = resolveWorldSimulationAnchor_ACU(sourceIndex, chat);
  if (input.explicitWorldSimulation === true) {
    // 显式占位符读取当前聊天、当前 active swipe 截止到来源楼层的提交链；
    // first-floor envelope 的 ledger 仅用于尚未迁移出首楼的旧账本，不覆盖已有折叠结果。
    const folded = foldWorldSimulationLedger_ACU(chat, sourceIndex);
    const envelope = new FirstFloorWorldSimulationStore_ACU().read();
    const hasCommittedFold = folded?.lastContributedIndex !== null && folded?.lastContributedIndex !== undefined
      && folded.lastContributedIndex <= sourceIndex;
    // 首楼旧账本只在从未写入楼层提交链时读取，不能把 envelope 缓存的候选覆盖历史折叠。
    const ledger = hasCommittedFold ? folded!.ledger : foldWorldSimulationLedger_ACU(chat) ? null : envelope?.ledger;
    if (!ledger) return null;
    const task = envelope?.task;
    const run = task?.completedRun;
    const completedAnchor = task?.completedAutoAnchor;
    const runMatchesSource = task?.status === 'completed' && run?.kind === 'host'
      && completedAnchor && completedAnchor.kind !== 'logical'
      && completedAnchor.chatIdentity === hostAnchor.chatIdentity && completedAnchor.messageKey === hostAnchor.messageKey
      && completedAnchor.swipeId === hostAnchor.swipeId && completedAnchor.contentDigest === hostAnchor.contentDigest
      && run.chatIdentity === hostAnchor.chatIdentity && run.anchorMessageKey === hostAnchor.messageKey
      && run.anchorSwipeId === hostAnchor.swipeId;
    const previousFold = folded && folded.lastContributedIndex === sourceIndex && sourceIndex > 0
      ? foldWorldSimulationLedger_ACU(chat, sourceIndex - 1) : null;
    let previousLedger: WorldSimulationLedger_ACU | null = previousFold
      && previousFold.ledger.revision !== ledger.revision
      && (!runMatchesSource || previousFold.ledger.revision === run.baseLedgerRevision)
      ? previousFold.ledger : null;
    if (!previousLedger && folded && folded.lastContributedIndex === sourceIndex && runMatchesSource) {
      // 首次提交的提交前账本可能保存在本楼层 checkpoint。
      const frame = readWorldSimulationBucketEntry_ACU<unknown>(WORLD_SIMULATION_STATE_FIELD_ACU, hostAnchor, value => value, chat);
      if (frame && typeof frame === 'object' && 'checkpoint' in frame && frame.checkpoint) {
        const checkpoint = validateWorldSimulationLedger_ACU(frame.checkpoint, 'load');
        if (checkpoint.revision === run.baseLedgerRevision && checkpoint.revision !== ledger.revision) previousLedger = checkpoint;
      }
    }
    const summary = runMatchesSource
      ? [...(envelope?.timeline ?? [])].reverse().find(entry =>
        entry.taskId === task.taskId && entry.runId === run.runId && entry.message?.trim())?.message ?? '已保存的世界模拟资料。'
      : '已保存的世界模拟资料。';
    input.assertCurrent();
    return { worldContext: buildPlotWorldContext_ACU({ ledger, previousLedger, summary }) };
  }
  const envelope = new FirstFloorWorldSimulationStore_ACU().read();
  const task = envelope?.task;
  const completedAnchor = task?.completedAutoAnchor;
  const run = task?.completedRun;
  if (!task || task.status !== 'completed' || task.activeRun !== null || run?.deliveryTarget !== 'plot'
    || !completedAnchor || completedAnchor.kind === 'logical' || run.kind === 'logical') return null;
  if (completedAnchor.chatIdentity !== hostAnchor.chatIdentity || completedAnchor.messageKey !== hostAnchor.messageKey
    || completedAnchor.swipeId !== hostAnchor.swipeId || completedAnchor.contentDigest !== hostAnchor.contentDigest
    || run.chatIdentity !== hostAnchor.chatIdentity || run.anchorMessageKey !== hostAnchor.messageKey
    || run.anchorSwipeId !== hostAnchor.swipeId) return null;
  const ledger = readWorldSimulationLedgerAtAnchor_ACU(hostAnchor, chat);
  if (!ledger) return null;
  const baseRevision = run.baseLedgerRevision;
  const previousFold = sourceIndex > 0 ? foldWorldSimulationLedger_ACU(chat, sourceIndex - 1) : null;
  let previousLedger: WorldSimulationLedger_ACU | null = previousFold?.ledger.revision === baseRevision ? previousFold.ledger : null;
  if (!previousLedger) {
    // 首次提交可能把提交前账本留在本楼层 checkpoint；只读当前 host/swipe 的严格分桶。
    const frame = readWorldSimulationBucketEntry_ACU<unknown>(WORLD_SIMULATION_STATE_FIELD_ACU, hostAnchor, value => value, chat);
    if (frame && typeof frame === 'object' && 'checkpoint' in frame && frame.checkpoint) {
      const checkpoint = validateWorldSimulationLedger_ACU(frame.checkpoint, 'load');
      if (checkpoint.revision === baseRevision) previousLedger = checkpoint;
    }
  }
  const summary = [...(envelope?.timeline ?? [])].reverse().find(entry =>
    entry.taskId === task.taskId && entry.runId === run.runId && entry.message?.trim())?.message ?? '本轮世界模拟已完成。';
  input.assertCurrent();
  return { worldContext: buildPlotWorldContext_ACU({ ledger, previousLedger, summary }) };
}
