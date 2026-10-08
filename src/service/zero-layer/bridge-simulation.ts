import { WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_RUN_STATE_FIELD_ACU, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU } from '../simulation/agent/agent-model';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, validateWorldSimulationEnvelope_ACU,
  resolveWorldSimulationAnchor_ACU, readWorldSimulationBucketEntry_ACU } from '../simulation/simulation-store';
import { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU,
  assertSingleActiveSimulationCheckpoint_ACU, seedLedgerFieldView_ACU } from '../simulation/simulation-ledger-fold';
import { readWorldSimulationConversationRecordStrict_ACU } from '../simulation/agent/agent-conversation-store';
import { emptyWorldSimulationUserRequirementsSnapshot_ACU,
  validateWorldSimulationUserRequirementsSnapshot_ACU } from '../simulation/agent/agent-user-requirements';
import { validateWorldSimulationRunStateRecord_ACU } from '../simulation/agent/agent-run-state-store';
import { validateWorldSimulationRunWriteProof_ACU, hasPartialWorldSimulationRunWrites_ACU } from '../simulation/simulation-run-write-state';
import { validateZeroLayerSimulationState_ACU } from './simulation-validation';
import { ZeroLayerError_ACU, type ZeroLayerSimulationState_ACU } from './model';
import type { ZeroLayerActivationCut_ACU, ZeroLayerBridgeCandidate_ACU } from './bridge-model';

function fail(message: string): never {
  throw new ZeroLayerError_ACU('migration-conflict', message);
}
const fields = [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_RUN_STATE_FIELD_ACU, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU];

/** 只读回放当前 swipe；宿主引用仅证明旧完成状态，不授予逻辑运行资格。 */
export function buildBridgeSimulation_ACU(chat: Record<string, unknown>[], cut: ZeroLayerActivationCut_ACU): {
  state: ZeroLayerSimulationState_ACU; availability: 'persisted' | 'absent';
  hostCompletion: ZeroLayerBridgeCandidate_ACU['simulationHostCompletion'];
} {
  if (chat.length !== cut.messageCount) fail('推演源长度与桥接切点不一致。');
  const raw = chat[0]?.[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
  const envelope = raw === undefined ? null : validateWorldSimulationEnvelope_ACU(raw);
  if (envelope?.task?.activeRun) fail('旧推演仍有未收尾运行，请先在普通模式收尾。');
  const anchors = new Map<number, ReturnType<typeof resolveWorldSimulationAnchor_ACU>>();
  let persisted = raw !== undefined;

  let userRequirements = emptyWorldSimulationUserRequirementsSnapshot_ACU();
  let latestProof: ReturnType<typeof validateWorldSimulationRunWriteProof_ACU> | null = null;
  for (const [index, message] of chat.entries()) {
    const hasFields = fields.some(field => message[field] !== undefined);
    if (message.is_user === true || message.is_system === true) {
      if (hasFields) fail('推演字段不在有效 assistant 来源上。');
      continue;
    }
    const anchor = resolveWorldSimulationAnchor_ACU(index, chat);
    if (cut.refs[index]?.swipeId !== Number(anchor.swipeId)) fail('推演 swipe 与桥接切点不一致。');
    anchors.set(index, anchor);
    for (const field of fields) {
      const value = readWorldSimulationBucketEntry_ACU(field, anchor, rawValue => rawValue, chat);
      if (value !== null) persisted = true;
    }
    const runState = readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_RUN_STATE_FIELD_ACU,
      anchor, validateWorldSimulationRunStateRecord_ACU, chat);
    if (runState) fail('旧推演仍有恢复游标，不能丢弃未收尾运行。');
    const proof = readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_RUN_WRITE_FIELD_ACU,
      anchor, validateWorldSimulationRunWriteProof_ACU, chat);
    if (proof) latestProof = proof;
    const requirements = readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
      anchor, validateWorldSimulationUserRequirementsSnapshot_ACU, chat);
    if (requirements) userRequirements = requirements;
  }
  const conflict = assertSingleActiveSimulationCheckpoint_ACU(chat);
  if (conflict) fail(conflict);
  const folded = foldWorldSimulationLedger_ACU(chat);
  if (!envelope && folded) fail('旧推演账本缺少首楼权威信封。');
  if (envelope && folded) envelope.ledger = structuredClone(folded.ledger);
  const state: ZeroLayerSimulationState_ACU = { schemaVersion: 1, envelope,
    fields: folded?.fields ?? (envelope ? seedLedgerFieldView_ACU(envelope.ledger, envelope.updatedAt) : { records: {} }),
    archive: foldWorldSimulationArchive_ACU(chat).snapshot,
    conversation: readWorldSimulationConversationRecordStrict_ACU(chat), userRequirements,
    runState: null, runProof: null, confirmed: [] };
  if (envelope?.ledger.pendingFixes.length) fail('旧推演存在待修复栏目，请先在普通模式补齐。');
  if (envelope && hasPartialWorldSimulationRunWrites_ACU({ ledger: envelope.ledger,
    fields: state.fields, archive: state.archive }) && latestProof) fail('旧推演存在未收尾的逐栏写入证明。');
  let hostCompletion: ZeroLayerBridgeCandidate_ACU['simulationHostCompletion'] = null;
  const completed = envelope?.task?.completedAutoAnchor;
  if (completed) {
    if (completed.kind === 'logical') fail('旧推演完成锚点不能借用其他逻辑会话。');
    const matches = [...anchors].filter(([, anchor]) => anchor.chatIdentity === completed.chatIdentity
      && anchor.messageKey === completed.messageKey && anchor.swipeId === completed.swipeId);
    if (matches.length !== 1) fail('旧推演完成锚点不能唯一映射到桥接来源。');
    hostCompletion = { taskId: envelope!.task!.taskId,
      ref: structuredClone(cut.refs[matches[0][0]]), anchor: structuredClone(completed) };
  }
  validateZeroLayerSimulationState_ACU(state);
  return { state: structuredClone(state), availability: persisted ? 'persisted' : 'absent', hostCompletion };
}
