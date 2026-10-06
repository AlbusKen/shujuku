import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from './model';
import type { ZeroLayerExitSelection_ACU } from './exit-model';
import { checkpointFingerprint_ACU as fingerprint, checkpointTurnRef_ACU } from './checkpoint-payload';
import { carrierSwipeId_ACU } from './carrier-context';
import { readZeroLayerPublishedMaterials_ACU } from './published-materials';
import { readCheckpointMaterials_ACU } from './checkpoint-materials';
import { buildZeroLayerTimeline_ACU } from './timeline';
import { captureBridgeConfig_ACU } from './bridge-config';

export function requireExit_ACU(value: unknown, message: string): asserts value {
  if (!value) throw new ZeroLayerError_ACU('migration-conflict', `${message} 请先恢复状态或继续零层模式。`);
}

/** 来源只能由显式选择的原 FloorRef 证明；位置不生成逻辑身份。 */
export function captureExitSource_ACU(source: ZeroLayerEnvelope_ACU,
  chat: Record<string, unknown>[], selection: ZeroLayerExitSelection_ACU) {
  requireExit_ACU(!source.enabled && source.exitManifest === undefined, '必须先确认关闭，且不能覆盖已有退出 journal。');
  requireExit_ACU(source.revision === selection.expectedRevision, '退出 revision 已变化。');
  requireExit_ACU(source.turns.every(turn => ['published', 'failed', 'cancelled'].includes(turn.phase)), '仍有未收尾逻辑回合。');
  const branch = source.branches.find(item => item.branchId === source.activeBranchId);
  const head = source.turns.find(item => item.turnId === branch?.headTurnId);
  requireExit_ACU(head?.phase === 'published'
    && fingerprint(selection.head) === fingerprint(checkpointTurnRef_ACU(source, head)), '退出 head 必须是所选已发布前沿。');
  requireExit_ACU(!branch?.checkpoints?.pending && !branch?.checkpoints?.cleanupPending, '逻辑 checkpoint 尚未收尾。');
  const target = selection.target;
  const message = chat[target.messageIndex];
  requireExit_ACU(target.kind === 'host' && fingerprint(target.scope) === fingerprint(source.scope)
    && target.sourceFingerprint === source.activationFingerprint
    && target.messageIndex === source.activationMessageCount - 1 && chat.length === source.activationMessageCount
    && message && message.is_user !== true && message.is_system !== true
    && carrierSwipeId_ACU(message) === target.swipeId, '普通接入点必须是原物理前缀末尾的 assistant，不能猜测新楼层。');
  const materials = readZeroLayerPublishedMaterials_ACU(source);
  requireExit_ACU(materials.continuation && materials.simulation, '三类退出恢复素材不完整。');
  const table = readCheckpointMaterials_ACU(source).table;
  requireExit_ACU(table, '退出缺少所选 head 的表格结算。');
  return { branch: branch!, head, target, materials, table,
    timeline: buildZeroLayerTimeline_ACU(source, chat), config: captureBridgeConfig_ACU(chat) };
}
