import type { ZeroLayerEnvelope_ACU } from './model';
import { ZeroLayerError_ACU } from './model';
import type { ZeroLayerCarrierContext_ACU } from './carrier-context';
import { captureBridgeActivationCut_ACU, bridgeSourceFingerprint_ACU, assertBridgeSource_ACU } from './bridge-source';
import { ZERO_LAYER_BRIDGE_PHASES_ACU, type ZeroLayerBridgePhase_ACU, type ZeroLayerBridgeCandidate_ACU } from './bridge-model';
import { validateBridgeCandidate_ACU } from './bridge-validation';
import { captureBridgeConfig_ACU, assertBridgeConfig_ACU } from './bridge-config';
import { checkpointFingerprint_ACU } from './checkpoint-payload';

export type ZeroLayerBridgeCommand_ACU =
  | { type: 'begin-bridge'; migrationId: string }
  | { type: 'advance-bridge'; migrationId: string; phase: Exclude<ZeroLayerBridgePhase_ACU, 'inventory'>;
      candidate?: ZeroLayerBridgeCandidate_ACU };

/** 纯阶段迁移；每次推进必须经 carrier 严格保存回读后才能发出下一命令。 */
export function applyZeroLayerBridgeCommand_ACU(source: ZeroLayerEnvelope_ACU,
  command: ZeroLayerBridgeCommand_ACU, context: ZeroLayerCarrierContext_ACU): ZeroLayerEnvelope_ACU {
  const next = structuredClone(source);
  const branch = next.branches.find(item => item.branchId === next.activeBranchId)!;
  if (command.type === 'begin-bridge') {
    if (next.enabled || next.turns.length || branch.bridge || branch.continuation || branch.simulation || branch.checkpoints) {
      throw new ZeroLayerError_ACU('migration-conflict', '已有逻辑工作状态，禁止覆盖首基线。');
    }
    const sourceFingerprint = bridgeSourceFingerprint_ACU(context.chat);
    const config = captureBridgeConfig_ACU(context.chat);
    branch.bridge = { schemaVersion: 1, migrationId: command.migrationId, phase: 'inventory',
      sourceRevision: source.revision, sourceFingerprint,
      createdAt: Date.now(), config,
      configFingerprint: checkpointFingerprint_ACU(config),
      activationCut: captureBridgeActivationCut_ACU(context, source.activationFingerprint), normalizedFingerprint: null, candidate: null,
      receipts: [{ phase: 'inventory', sourceRevision: source.revision, sourceFingerprint, normalizedFingerprint: null }] };
  } else {
    const bridge = branch.bridge;
    if (!bridge || bridge.migrationId !== command.migrationId) {
      throw new ZeroLayerError_ACU('migration-conflict', '桥接迁移身份不匹配。');
    }
    assertBridgeSource_ACU(context.chat, bridge.sourceFingerprint);
    assertBridgeConfig_ACU(context.chat, bridge.configFingerprint);
    const index = ZERO_LAYER_BRIDGE_PHASES_ACU.indexOf(bridge.phase);
    if (ZERO_LAYER_BRIDGE_PHASES_ACU[index + 1] !== command.phase) {
      throw new ZeroLayerError_ACU('invalid-transition', '桥接阶段不能跳过或重复提交。');
    }
    if (command.phase === 'normalized') {
      validateBridgeCandidate_ACU(command.candidate, next, bridge.activationCut);
      bridge.normalizedFingerprint = command.candidate.fingerprint;
    } else {
      if (command.phase === 'candidate') {
        validateBridgeCandidate_ACU(command.candidate, next, bridge.activationCut);
        if (command.candidate.fingerprint !== bridge.normalizedFingerprint) {
          throw new ZeroLayerError_ACU('migration-conflict', '候选回放与已确认规范化指纹不一致。');
        }
        bridge.candidate = structuredClone(command.candidate);
      }
      if (!bridge.candidate) {
        throw new ZeroLayerError_ACU('corrupt-data', '桥接阶段缺少已保存候选。');
      }
      validateBridgeCandidate_ACU(bridge.candidate, next, bridge.activationCut);
      if (command.phase === 'verified') {
        validateBridgeCandidate_ACU(command.candidate, next, bridge.activationCut);
        if (command.candidate.fingerprint !== bridge.candidate.fingerprint) {
          throw new ZeroLayerError_ACU('migration-conflict', '源回放与已保存桥接候选不一致。');
        }
      }
      if (command.phase === 'reconciled') {
        branch.continuation = structuredClone(bridge.candidate.continuation);
        branch.simulation = structuredClone(bridge.candidate.simulation);
      }
    }
    bridge.phase = command.phase;
    bridge.receipts.push({ phase: command.phase, sourceRevision: source.revision,
      sourceFingerprint: bridge.sourceFingerprint, normalizedFingerprint: bridge.normalizedFingerprint });
  }
  next.revision += 1;
  return next;
}
