import { CONTINUATION_FIRST_FLOOR_FIELD_ACU, validateContinuationEnvelope_ACU } from '../continuation/continuation-store';
import { AGENT_MODULE_FIELD_ACU, AGENT_CONVERSATION_FIELD_ACU } from '../continuation/agent/agent-model';
import { readAgentModuleFoldState_ACU } from '../continuation/agent/agent-module-store';
import { readAgentConversationRecordStrict_ACU } from '../continuation/agent/agent-conversation-store';
import { foldCheckpointContinuation_ACU } from './checkpoint-payload';
import { projectWorkingContinuation_ACU } from './checkpoint-projection';
import { continuationCheckpointPayload_ACU, checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';
import { requireExit_ACU, type captureExitSource_ACU } from './exit-source';
import type { ZeroLayerEnvelope_ACU } from './model';

type Source_ACU = ReturnType<typeof captureExitSource_ACU>;

/** 不将请求投影中的逻辑证据索引解释成普通物理楼层。 */
export function stageExitContinuation_ACU(source: ZeroLayerEnvelope_ACU,
  chat: Record<string, unknown>[], input: Source_ACU): void {
  const state = input.materials.continuation!;
  const envelope = state.envelope;
  requireExit_ACU(!envelope?.activeTask?.pendingHostTurn, '续写仍有等待正文回执。');
  requireExit_ACU(!envelope?.activeTask || !['running', 'drafting', 'stopping_after_inflight'].includes(envelope.activeTask.status),
    '续写任务尚未停止。');
  const projection = projectWorkingContinuation_ACU(source, input.timeline, state);
  const payload = continuationCheckpointPayload_ACU(projection.map(message => ({
    payload: message[AGENT_MODULE_FIELD_ACU], swipeId: String(message.swipe_id ?? 0),
  })));
  const snapshot = payload.checkpoint!.snapshot;
  const bridge = input.branch.bridge;
  requireExit_ACU(bridge?.phase === 'reconciled' && bridge.candidate, '续写缺少原物理资料的来源证明。');
  const original = foldCheckpointContinuation_ACU(bridge.activationCut.refs.map(ref => ({
    payload: bridge.candidate!.continuation.moduleFrames[JSON.stringify(ref)], swipeId: String(ref.swipeId),
  }))).snapshot;
  const sameCoordinates = <T extends { id: string }>(rows: T[], baseline: T[], coordinates: (row: T) => unknown) =>
    rows.every(row => {
      const old = baseline.find(item => item.id === row.id);
      return old !== undefined && fingerprint(coordinates(row)) === fingerprint(coordinates(old));
    });
  requireExit_ACU(sameCoordinates(snapshot.hooks, original.hooks, row => [row.plantedIndex, row.updatedIndex])
    && sameCoordinates(snapshot.infoGap, original.infoGap, row => row.revealIndex)
    && sameCoordinates(snapshot.constraints, original.constraints, row => row.createdIndex)
    && sameCoordinates(snapshot.chronology, original.chronology, row => [row.evidenceIndexes, row.updatedIndex])
    && fingerprint(snapshot.materialCompletion) === fingerprint(original.materialCompletion)
    && fingerprint(snapshot.settlementBoundary ?? null) === fingerprint(original.settlementBoundary ?? null),
  '续写资料含无法证明为原物理来源的证据索引，普通资料格式不能无损承接。');
  requireExit_ACU(snapshot.pendingFixes.length === 0, '续写资料仍有待修复条目。');
  // 非空资料的未结算逻辑范围不能通过重设水位隐藏。无资料来源时保留原空基底。
  const contributed = readAgentModuleFoldState_ACU(projection).contributed;
  requireExit_ACU(!contributed || snapshot.settledThroughIndex >= input.timeline.floors.length - 1,
    '续写资料仍有未结算逻辑历史，普通水位不能表达该缺口。');
  if (contributed) snapshot.settledThroughIndex = source.activationMessageCount - 1;
  payload.checkpoint!.swipeId = String(input.target.swipeId);
  for (const message of chat) {
    delete message[AGENT_MODULE_FIELD_ACU];
    delete message[AGENT_CONVERSATION_FIELD_ACU];
  }
  if (envelope) chat[0][CONTINUATION_FIRST_FLOOR_FIELD_ACU] = validateContinuationEnvelope_ACU(envelope, 'persist');
  else delete chat[0][CONTINUATION_FIRST_FLOOR_FIELD_ACU];
  chat[input.target.messageIndex][AGENT_MODULE_FIELD_ACU] = payload;
  chat[input.target.messageIndex][AGENT_CONVERSATION_FIELD_ACU] = structuredClone(state.conversation);
  const folded = readAgentModuleFoldState_ACU(chat);
  requireExit_ACU(!folded.salvaged && folded.candidates.every(item => item.valid)
    && fingerprint([folded.snapshot, folded.fields])
      === fingerprint([snapshot, payload.checkpoint!.fieldSnapshot]), '退出续写资料回放不等价。');
  requireExit_ACU(fingerprint(readAgentConversationRecordStrict_ACU(chat)) === fingerprint(state.conversation),
    '退出续写会话回放不等价。');
}
