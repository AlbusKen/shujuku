import { isModelExchangeSequence_ACU } from '../ai/native-tool';
import { projectWorldSimulationConversationSegments_ACU, projectWorldSimulationDirectorSource_ACU,
  projectWorldSimulationDirectorMessages_ACU, validateWorldSimulationConversationFloorRecord_ACU,
  nextWorldSimulationUserInstructionSegmentId_ACU } from '../simulation/agent/agent-conversation-store';
import { validateWorldSimulationRunStateRecord_ACU } from '../simulation/agent/agent-run-state-store';
import { WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU, WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU,
  type WorldSimulationConversationAppend_ACU, type WorldSimulationConversationFloorRecord_ACU,
  type WorldSimulationLogicalAnchorIdentity_ACU } from '../simulation/agent/agent-model';
import type { WorldSimulationAgentStorage_ACU } from '../simulation/agent/agent-storage';
import type { WorldSimulationSessionInput_ACU } from '../simulation/agent/agent-session-log';
import { ZeroLayerError_ACU } from './model';
import { ZeroLayerSimulationStore_ACU } from './simulation-store';

type SegmentInput_ACU = { runId: string; taskId: string; stageId: string; stageRevision: number;
  segmentId: string; appends: readonly WorldSimulationConversationAppend_ACU[]; idempotent?: boolean };

/** 请求级历史读写只拥有当前逻辑分支；持久模型轮次保真，展示卡片沿用截断规则。 */
export function appendZeroLayerSimulationSegment_ACU(record: WorldSimulationConversationFloorRecord_ACU,
  input: SegmentInput_ACU): boolean {
  const usable = input.appends.filter(item => item.text.trim() || item.kind === 'model_agent' || item.toolCallId || item.toolCalls?.length);
  if (!usable.length) return false;
  const normalized = usable.map(item => ({ ...item, text: item.kind === 'model_agent' || item.kind === 'model_feedback'
    || item.toolCallId || item.text.length <= 8000 ? item.text : `${item.text.slice(0, 8000)}\n（本条内容超出 8000 字上限，已截断）`,
    digest: item.digest ?? '', turnKey: item.turnKey ?? '' }));
  const fingerprint = (items: readonly WorldSimulationConversationAppend_ACU[]) => JSON.stringify(items.map(item =>
    [item.kind, item.text, item.digest ?? '', item.turnKey ?? '', item.toolCalls ?? [], item.toolCallId ?? '']));
  const sameId = record.segments.find(segment => segment.segmentId === input.segmentId);
  if (sameId) {
    if (input.idempotent && fingerprint(sameId.messages) === fingerprint(normalized)) return true;
    throw new ZeroLayerError_ACU('revision-conflict', '推演会话段身份冲突。');
  }
  if (input.idempotent && record.segments.some(segment => segment.runId === input.runId
    && fingerprint(segment.messages) === fingerprint(normalized))) return true;
  let nextId = projectWorldSimulationConversationSegments_ACU(record.segments).nextId;
  const at = Date.now();
  record.segments.push({ schemaVersion: WORLD_SIMULATION_CONVERSATION_SCHEMA_VERSION_ACU,
    segmentId: input.segmentId, runId: input.runId, taskId: input.taskId, stageId: input.stageId,
    stageRevision: input.stageRevision, messages: normalized.map(item => ({ ...item, id: nextId++, at })), updatedAt: at });
  record.updatedAt = at;
  validateWorldSimulationConversationFloorRecord_ACU(record);
  return true;
}

export function createZeroLayerSimulationAgentStorage_ACU(
  store: ZeroLayerSimulationStore_ACU, anchor: WorldSimulationLogicalAnchorIdentity_ACU,
  signal?: AbortSignal,
): WorldSimulationAgentStorage_ACU {
  const chat = structuredClone(store.readChat(anchor));
  const assertCurrent = () => {
    if (signal?.aborted) throw new ZeroLayerError_ACU('scope-changed', '逻辑推演已中止。');
    store.assertAnchor(anchor);
  };
  const source = () => { assertCurrent(); return projectWorldSimulationDirectorSource_ACU(store.readState().conversation.segments); };
  return {
    mode: 'logical', hasPersistentHistory: true, canCompactHistory: true,
    readChat: () => { assertCurrent(); return structuredClone(chat); },
    restoreRunState: async (taskId, cursorKey) => {
      assertCurrent();
      const record = store.readState().runState;
      return record?.taskId === taskId && record.cursorKey === cursorKey ? structuredClone(record.state) : null;
    },
    persistRunState: async state => {
      const prepared = validateWorldSimulationRunStateRecord_ACU({ schemaVersion: WORLD_SIMULATION_RUN_STATE_SCHEMA_VERSION_ACU,
        taskId: state.taskId, cursorKey: state.cursorKey, state: structuredClone(state), updatedAt: Date.now() });
      await store.updateState((current, envelope) => {
        assertCurrent();
        store.assertAnchor(anchor, envelope);
        const run = current.envelope?.task?.activeRun;
        if (!run || run.taskId !== prepared.taskId
          || `${run.stageId}#${run.stageRevision}#${run.baseLedgerRevision}` !== prepared.cursorKey) {
          throw new ZeroLayerError_ACU('revision-conflict', '推演恢复游标不属于当前运行。');
        }
        current.runState = prepared;
      });
    },
    // 主循环在最终提交前调用；持久游标只由已确认终局清理，不能提前丢失恢复信息。
    clearRunState: async () => { assertCurrent(); },
    readDirectorHistory: () => projectWorldSimulationDirectorMessages_ACU(source().view.messages),
    readDirectorRunHistory: runId => {
      assertCurrent();
      return projectWorldSimulationDirectorMessages_ACU(store.readState().conversation.segments
        .filter(segment => segment.runId === runId).flatMap(segment => segment.messages
          .filter(message => message.kind === 'model_agent' || message.kind === 'model_feedback' || !!message.toolCallId)));
    },
    readCompactionSource: source,
    appendDirectorHistory: async input => {
      if (!input.messages.length) return false;
      if (!isModelExchangeSequence_ACU(input.messages)) throw new ZeroLayerError_ACU('corrupt-data', '推演模型动作与反馈必须成对保存。');
      const toolNames = new Map(input.messages.flatMap(item => (item.tool_calls ?? []).map(call => [call.id, call.function.name] as const)));
      await store.updateState((state, envelope) => {
        assertCurrent();
        store.assertAnchor(anchor, envelope);
        const run = state.envelope?.task?.activeRun;
        if (!run || run.runId !== input.runId || run.taskId !== input.taskId
          || run.stageId !== input.stageId || run.stageRevision !== input.stageRevision) {
          throw new ZeroLayerError_ACU('revision-conflict', '推演会话保存租约已失效。');
        }
        const prefix = `director:${input.runId}:`;
        appendZeroLayerSimulationSegment_ACU(state.conversation, { ...input,
          segmentId: `${prefix}${state.conversation.segments.filter(segment => segment.segmentId.startsWith(prefix)).length}`,
          appends: input.messages.map(item => ({ kind: item.role === 'assistant' ? 'model_agent' : item.role === 'tool' ? 'tool' : 'model_feedback',
            text: item.content, ...(item.role === 'tool' ? { digest: toolNames.get(item.tool_call_id ?? '') ?? 'tool' } : {}),
            ...(item.tool_call_id ? { toolCallId: item.tool_call_id } : {}),
            ...(item.tool_calls?.length ? { toolCalls: item.tool_calls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })) } : {}) })) });
      });
      return true;
    },
    writeCompaction: async input => {
      let changed = false;
      await store.updateState(state => {
        assertCurrent();
        const current = projectWorldSimulationDirectorSource_ACU(state.conversation.segments);
        if (input.expectedFingerprint && current.fingerprint !== input.expectedFingerprint) {
          throw new ZeroLayerError_ACU('revision-conflict', '推演压缩来源已变化。');
        }
        if ((current.view.compaction?.compactedThroughId ?? -1) >= input.compaction.compactedThroughId) return;
        const last = state.conversation.segments[state.conversation.segments.length - 1];
        if (!last) return;
        if (input.expectedStageId && last.stageId !== input.expectedStageId
          || input.expectedStageRevision !== undefined && last.stageRevision !== input.expectedStageRevision) {
          throw new ZeroLayerError_ACU('revision-conflict', '推演压缩阶段已变化。');
        }
        last.compaction = structuredClone(input.compaction);
        last.updatedAt = state.conversation.updatedAt = Date.now();
        validateWorldSimulationConversationFloorRecord_ACU(state.conversation);
        changed = true;
      });
      return changed;
    },
  };
}

export async function appendZeroLayerSimulationUserInstruction_ACU(
  store: ZeroLayerSimulationStore_ACU, anchor: WorldSimulationLogicalAnchorIdentity_ACU,
  input: Omit<SegmentInput_ACU, 'segmentId' | 'appends'> & { text: string; triggerConversationMessageId?: string | null },
): Promise<void> {
  await store.updateState((state, envelope) => {
    store.assertAnchor(anchor, envelope);
    appendZeroLayerSimulationSegment_ACU(state.conversation, { ...input,
      segmentId: nextWorldSimulationUserInstructionSegmentId_ACU(input.runId, state.conversation.segments),
      appends: [{ kind: 'user', text: input.text, turnKey: input.triggerConversationMessageId ?? input.runId }] });
  });
}

export async function appendZeroLayerSimulationSessionEvent_ACU(
  store: ZeroLayerSimulationStore_ACU, anchor: WorldSimulationLogicalAnchorIdentity_ACU,
  input: Omit<SegmentInput_ACU, 'segmentId' | 'appends'> & { eventKey: string; event: WorldSimulationSessionInput_ACU },
): Promise<void> {
  const event = structuredClone(input.event);
  const kind = event.kind === 'user_message' ? 'user' : ['run_started', 'run_resumed'].includes(event.kind) ? 'turn'
    : event.kind === 'tool_read' ? 'tool' : event.kind === 'handoff' ? 'handoff'
      : ['protocol_retry', 'thought'].includes(event.kind) ? 'runtime' : 'agent';
  await store.updateState((state, envelope) => {
    store.assertAnchor(anchor, envelope);
    appendZeroLayerSimulationSegment_ACU(state.conversation, { ...input,
      segmentId: `session:${input.runId}:${input.eventKey}:${state.conversation.segments.length}`,
      appends: [{ kind, text: event.detail || event.title, digest: event.title, turnKey: `${input.runId}:${input.eventKey}`,
        eventKind: event.kind, title: event.title, status: event.status ?? (event.ok === false ? 'failed' : 'done'),
        ...(event.agentName ? { agentName: event.agentName } : {}), ok: event.ok !== false }] });
  });
}
