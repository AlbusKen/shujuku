import { WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU, WORLD_SIMULATION_RUN_STATE_FIELD_ACU,
  WORLD_SIMULATION_RUN_WRITE_FIELD_ACU } from '../simulation/agent/agent-model';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, validateWorldSimulationEnvelope_ACU,
  resolveWorldSimulationAnchor_ACU, buildWorldSimulationBucketKey_ACU,
  readWorldSimulationBucketEntry_ACU } from '../simulation/simulation-store';
import { assertWorldSimulationHostEnvelope_ACU } from '../simulation/simulation-identity';
import { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU,
  extractWorldSimulationPartialFields_ACU, WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU } from '../simulation/simulation-ledger-fold';
import { readWorldSimulationConversationRecordStrict_ACU } from '../simulation/agent/agent-conversation-store';
import { validateWorldSimulationUserRequirementsSnapshot_ACU } from '../simulation/agent/agent-user-requirements';
import { checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';
import { requireExit_ACU, type captureExitSource_ACU } from './exit-source';

type Source_ACU = ReturnType<typeof captureExitSource_ACU>;
const fields = [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU];

/** 只在影子聊天建立普通基线；不转换逻辑运行身份，不丢弃恢复游标。 */
export function stageExitSimulation_ACU(chat: Record<string, unknown>[], input: Source_ACU): void {
  const state = input.materials.simulation!;
  const envelope = state.envelope;
  requireExit_ACU(!state.runState && !state.runProof && !envelope?.task?.activeRun,
    '推演仍有未收尾运行、恢复游标或写入证明。');
  requireExit_ACU(!envelope?.task || !['running', 'drafting', 'stopping_after_inflight'].includes(envelope.task.status),
    '推演任务尚未停止。');
  if (envelope) assertWorldSimulationHostEnvelope_ACU(envelope);
  requireExit_ACU(!envelope?.ledger.pendingFixes.length, '推演仍有待修复栏目。');
  for (const message of chat) {
    requireExit_ACU(message[WORLD_SIMULATION_RUN_STATE_FIELD_ACU] === undefined
      && message[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU] === undefined,
    '普通前缀仍有运行恢复字段，不能覆盖其来源。');
    for (const field of fields) delete message[field];
  }

  if (envelope) chat[0][WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = validateWorldSimulationEnvelope_ACU(envelope, 'persist');
  else delete chat[0][WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
  const anchor = resolveWorldSimulationAnchor_ACU(input.target.messageIndex, chat);
  const target = chat[input.target.messageIndex];
  const bucket = (value: unknown) => ({ schemaVersion: 1,
    entries: { [buildWorldSimulationBucketKey_ACU(anchor)]: {
      anchor: structuredClone(anchor), value: structuredClone(value), updatedAt: envelope?.updatedAt ?? 0,
    } } });
  if (envelope) {
    target[WORLD_SIMULATION_STATE_FIELD_ACU] = bucket({
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: envelope.ledger, checkpointFields: state.fields,
      checkpointPartials: extractWorldSimulationPartialFields_ACU(state.fields), deltas: [],
    });
  }
  target[WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU] = bucket({
    schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, checkpoint: state.archive, deltas: [],
  });
  target[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = bucket(state.conversation);
  target[WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU] = bucket(state.userRequirements);
  const replay = foldWorldSimulationLedger_ACU(chat);
  requireExit_ACU(envelope ? replay && fingerprint([replay.ledger, replay.fields])
    === fingerprint([envelope.ledger, state.fields]) : replay === null,
  '退出推演账本或分栏回放不等价。');
  requireExit_ACU(fingerprint(foldWorldSimulationArchive_ACU(chat).snapshot) === fingerprint(state.archive),
    '退出推演归档回放不等价。');
  requireExit_ACU(fingerprint(readWorldSimulationConversationRecordStrict_ACU(chat)) === fingerprint(state.conversation),
    '退出推演会话回放不等价。');
  requireExit_ACU(fingerprint(readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
    anchor, validateWorldSimulationUserRequirementsSnapshot_ACU, chat)) === fingerprint(state.userRequirements),
  '退出推演用户要求回放不等价。');
}
