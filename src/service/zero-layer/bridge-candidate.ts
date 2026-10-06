import type { ZeroLayerEnvelope_ACU } from './model';
import { ZeroLayerError_ACU } from './model';
import type { ZeroLayerBridgeState_ACU, ZeroLayerBridgeCandidate_ACU } from './bridge-model';
import { buildBridgeTable_ACU } from './bridge-table';
import { buildBridgeContinuation_ACU } from './bridge-continuation';
import { buildBridgeSimulation_ACU } from './bridge-simulation';
import { assertBridgeSource_ACU } from './bridge-source';
import { bridgeCandidateFingerprint_ACU, validateBridgeCandidate_ACU } from './bridge-validation';

/** 三类候选消费同一源快照与切点；回放不保存、不启动模型、不复制旧正文。 */
export async function buildBridgeCandidate_ACU(source: ZeroLayerEnvelope_ACU,
  bridge: ZeroLayerBridgeState_ACU, chat: Record<string, unknown>[]): Promise<ZeroLayerBridgeCandidate_ACU> {
  assertBridgeSource_ACU(chat, bridge.sourceFingerprint);
  const before = structuredClone(chat);
  const continuation = buildBridgeContinuation_ACU(before, bridge.activationCut);
  const simulation = buildBridgeSimulation_ACU(before, bridge.activationCut);
  const table = await buildBridgeTable_ACU(before, bridge.createdAt, bridge.config);
  assertBridgeSource_ACU(before, bridge.sourceFingerprint);
  assertBridgeSource_ACU(chat, bridge.sourceFingerprint);
  if (chat.length !== bridge.activationCut.messageCount) {
    throw new ZeroLayerError_ACU('migration-conflict', '桥接回放超出启用切点。');
  }
  const candidate: ZeroLayerBridgeCandidate_ACU = { schemaVersion: 1, table: table.table,
    continuation: continuation.state, simulation: simulation.state,
    simulationHostCompletion: simulation.hostCompletion,
    availability: { table: table.availability, continuation: continuation.availability, simulation: simulation.availability },
    fingerprint: '' };
  candidate.fingerprint = bridgeCandidateFingerprint_ACU(candidate);
  validateBridgeCandidate_ACU(candidate, source, bridge.activationCut);
  return candidate;
}
