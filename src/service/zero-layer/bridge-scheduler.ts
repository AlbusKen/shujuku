import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerCarrierContext_ACU } from './carrier-context';
import { assertZeroLayerCarrier_ACU } from './carrier-context';
import { ZeroLayerStore_ACU } from './store';
import type { ZeroLayerCommand_ACU } from './store-command';
import { assertBridgeSource_ACU, assertBridgeHostIdle_ACU } from './bridge-source';
import { assertBridgeConfig_ACU } from './bridge-config';
import { buildBridgeCandidate_ACU } from './bridge-candidate';
import { checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';

/** 每次 commit 自带服务器严格回读；未知保存直接退出，只能由显式恢复入口处理。 */
export async function synchronizeZeroLayerBridge_ACU(store: ZeroLayerStore_ACU,
  source: ZeroLayerEnvelope_ACU, context: ZeroLayerCarrierContext_ACU,
  signal: AbortSignal, assertLease: () => void): Promise<ZeroLayerEnvelope_ACU> {
  let current = source;
  const sessionId = source.sessionId;
  const branchId = source.activeBranchId;
  const assertCurrent = () => {
    assertLease();
    signal.throwIfAborted();
    assertBridgeHostIdle_ACU();
    assertZeroLayerCarrier_ACU(context);
    if (current.sessionId !== sessionId || current.activeBranchId !== branchId) {
      throw new ZeroLayerError_ACU('scope-changed', '桥接会话或分支已变化。');
    }
    const bridge = current.branches.find(branch => branch.branchId === branchId)?.bridge;
    if (bridge) {
      assertBridgeSource_ACU(context.chat, bridge.sourceFingerprint);
      assertBridgeConfig_ACU(context.chat, bridge.configFingerprint);
    }
  };
  const commit = async (command: ZeroLayerCommand_ACU) => {
    assertCurrent();
    const saved = await store.commit(command, current.revision);
    current = saved;
    assertCurrent();
    const confirmed = await store.read();
    assertCurrent();
    if (!confirmed || fingerprint(confirmed) !== fingerprint(saved)) {
      throw new ZeroLayerError_ACU('revision-conflict', '桥接阶段保存后载体已变化，禁止推进。');
    }
    current = confirmed;
  };
  assertCurrent();
  let bridge = current.branches.find(branch => branch.branchId === branchId)!.bridge;
  if (bridge?.phase === 'reconciled') return current;
  if (current.enabled) throw new ZeroLayerError_ACU('migration-conflict', '已启用的旧载体不能覆盖首基线。');
  if (!bridge) {
    await commit({ type: 'begin-bridge', migrationId: crypto.randomUUID() });
  }

  const nextPhase = { inventory: 'normalized', normalized: 'candidate', candidate: 'verified',
    verified: 'activated', activated: 'reconciled' } as const;
  for (;;) {
    assertCurrent();
    bridge = current.branches.find(branch => branch.branchId === branchId)!.bridge;
    if (!bridge) throw new ZeroLayerError_ACU('corrupt-data', '桥接阶段账本缺失。');
    if (bridge.phase === 'reconciled') return current;
    const phase = nextPhase[bridge.phase];
    // Normalize 仅保存指纹；Candidate、Verify 均独立回放，不复用未保存的载荷。
    const candidate = phase === 'normalized' || phase === 'candidate' || phase === 'verified'
      ? await buildBridgeCandidate_ACU(current, bridge, context.chat as Record<string, unknown>[])
      : undefined;
    assertCurrent();
    await commit({ type: 'advance-bridge', migrationId: bridge.migrationId, phase,
      ...(candidate ? { candidate } : {}) });
  }
}
