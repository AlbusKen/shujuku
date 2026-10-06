import type { ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerExitSelection_ACU, ZeroLayerExitManifest_ACU } from './exit-model';
import { captureExitSource_ACU, requireExit_ACU } from './exit-source';
import { stageExitTable_ACU } from './exit-table';
import { stageExitContinuation_ACU } from './exit-continuation';
import { stageExitSimulation_ACU } from './exit-simulation';
import { ZERO_LAYER_EXIT_FIELDS_ACU, exitFieldValue_ACU } from './exit-fields';
import { exitCandidateFingerprint_ACU } from './exit-validation';
import { checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';
import { physicalHistorySnapshot_ACU } from './carrier-context';
import { bridgeSourceFingerprint_ACU } from './bridge-source';

/** 构造纯候选；三个模块都通过真实普通读口回放之后才允许登记意图。 */
export async function buildZeroLayerExitCandidate_ACU(source: ZeroLayerEnvelope_ACU,
  chat: Record<string, unknown>[], selection: ZeroLayerExitSelection_ACU): Promise<ZeroLayerExitManifest_ACU> {
  const original = structuredClone(chat);
  const staged = structuredClone(original);
  const input = captureExitSource_ACU(structuredClone(source), original, selection);
  stageExitContinuation_ACU(source, staged, input);
  stageExitSimulation_ACU(staged, input);
  await stageExitTable_ACU(staged, input);
  requireExit_ACU(physicalHistorySnapshot_ACU(staged) === physicalHistorySnapshot_ACU(original),
    '退出候选改动了物理正文或楼层。');
  const assignments = original.flatMap((message, messageIndex) => ZERO_LAYER_EXIT_FIELDS_ACU.map(field => ({
    messageIndex, field, before: exitFieldValue_ACU(message, field), after: exitFieldValue_ACU(staged[messageIndex], field),
  })));
  const manifest: ZeroLayerExitManifest_ACU = {
    schemaVersion: 1, exitId: crypto.randomUUID(), phase: 'prepared', scope: structuredClone(source.scope),
    sessionId: source.sessionId, branchId: source.activeBranchId, head: structuredClone(selection.head),
    sourceRevision: source.revision, activationMessageCount: source.activationMessageCount,
    activationFingerprint: source.activationFingerprint, target: structuredClone(selection.target),
    physicalPrefixSnapshot: physicalHistorySnapshot_ACU(original),
    configFingerprint: fingerprint(input.config), materialFingerprint: fingerprint([input.table, input.materials]),
    assignments, candidateFingerprint: '', createdAt: Date.now(),
  };
  manifest.candidateFingerprint = exitCandidateFingerprint_ACU(manifest);
  requireExit_ACU(bridgeSourceFingerprint_ACU(chat) === bridgeSourceFingerprint_ACU(original),
    '候选回放期间普通状态已变化。');
  return manifest;
}
