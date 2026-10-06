import { CONTINUATION_FIRST_FLOOR_FIELD_ACU, validateContinuationEnvelope_ACU,
  derivePausedContinuationEnvelopeAfterReload_ACU } from '../continuation/continuation-store';
import { reconcileContinuationEnvelopeCursor_ACU } from '../continuation/stage-cursor';
import type { ContinuationTask_ACU } from '../continuation/model';
import { AGENT_MODULE_FIELD_ACU, AGENT_CONVERSATION_FIELD_ACU } from '../continuation/agent/agent-model';
import { readAgentConversationRecordStrict_ACU } from '../continuation/agent/agent-conversation-store';
import { foldAgentModuleSnapshot_ACU } from '../continuation/agent/agent-module-frame';
import { agentModuleFrameDeps_ACU } from '../continuation/agent/agent-module-store';
import { ZeroLayerError_ACU, type ZeroLayerContinuationState_ACU } from './model';
import type { ZeroLayerActivationCut_ACU, ZeroLayerBridgeState_ACU } from './bridge-model';
import { checkpointFingerprint_ACU } from './checkpoint-payload';

/** 宿主历史仅通过 activation cut 绑定的只读引用保留，不生成逻辑回合。 */
export function buildBridgeContinuation_ACU(chat: Record<string, unknown>[], cut: ZeroLayerActivationCut_ACU): {
  state: ZeroLayerContinuationState_ACU; availability: 'persisted' | 'absent';
} {
  const raw = chat[0]?.[CONTINUATION_FIRST_FLOOR_FIELD_ACU];
  const envelope = raw === undefined ? null : validateContinuationEnvelope_ACU(raw);
  const task = envelope?.activeTask;
  if (task?.pendingHostTurn || task && ['drafting', 'running', 'stopping_after_inflight'].includes(task.status)) {
    throw new ZeroLayerError_ACU('migration-conflict', '旧续写仍有未完成宿主运行，请先在普通模式停止或收尾。');
  }
  if (task) {
    const anchors = [...task.timeline, ...(task.progressSelections ?? []),
      ...task.stages.flatMap(stage => stage.progressAdjustments ?? [])];
    for (const anchor of anchors) {
      if ('logicalRef' in anchor && anchor.logicalRef || 'logicalAnchor' in anchor && anchor.logicalAnchor
        || anchor.messageIndex !== undefined && !cut.refs.some(ref => ref.messageIndex === anchor.messageIndex)) {
        throw new ZeroLayerError_ACU('migration-conflict', '旧续写历史锚点不在桥接来源切点内。');
      }
    }
  }
  const folded = foldAgentModuleSnapshot_ACU(chat, agentModuleFrameDeps_ACU());
  if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
    throw new ZeroLayerError_ACU('migration-conflict', '旧续写资料损坏，禁止将抢救结果当作桥接基线。');
  }
  const moduleFrames: Record<string, unknown> = {};
  for (const [index, message] of chat.entries()) {
    if (message[AGENT_MODULE_FIELD_ACU] !== undefined) {
      moduleFrames[JSON.stringify(cut.refs[index])] = structuredClone(message[AGENT_MODULE_FIELD_ACU]);
    }
  }
  const effective = envelope === null ? null : reconcileContinuationEnvelopeCursor_ACU(
    derivePausedContinuationEnvelopeAfterReload_ACU(envelope), cut.messageCount);
  return { state: { schemaVersion: 1, envelope: effective, moduleFrames,
    conversation: readAgentConversationRecordStrict_ACU(chat), confirmed: [] },
    availability: raw !== undefined || chat.some(message => message[AGENT_MODULE_FIELD_ACU] !== undefined
      || message[AGENT_CONVERSATION_FIELD_ACU] !== undefined) ? 'persisted' : 'absent' };
}

/** 只认可桥接中保存的原进度记录；相同物理下标不能为新记录提供完成证明。 */
export function survivesBridgeContinuationAnchor_ACU(task: ContinuationTask_ACU,
  anchor: { messageIndex?: number; logicalAnchor?: unknown; logicalRef?: unknown },
  bridge: ZeroLayerBridgeState_ACU | undefined): boolean {
  const baseline = bridge?.phase === 'reconciled' ? bridge.candidate?.continuation.envelope?.activeTask : null;
  if (!baseline || baseline.taskId !== task.taskId || anchor.logicalAnchor || anchor.logicalRef
    || !Number.isSafeInteger(anchor.messageIndex) || anchor.messageIndex! < 0) return false;
  const ref = bridge!.activationCut.refs.find(item => item.messageIndex === anchor.messageIndex);
  if (!ref || ref.kind !== 'host' || ref.sourceFingerprint !== bridge!.activationCut.sourceFingerprint) return false;
  const records = [...baseline.timeline, ...(baseline.progressSelections ?? []),
    ...baseline.stages.flatMap(stage => stage.progressAdjustments ?? [])];
  const expected = checkpointFingerprint_ACU(anchor);
  return records.some(item => item.messageIndex === anchor.messageIndex
    && checkpointFingerprint_ACU(item) === expected);
}