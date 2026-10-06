import { readHostGenerationState_ACU } from '../../data/gateways/host-generation-state-gateway';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { ZERO_LAYER_CARRIER_FIELD_ACU, ZeroLayerError_ACU } from './model';
import type { ZeroLayerCarrierContext_ACU } from './carrier-context';
import { carrierSwipeId_ACU } from './carrier-context';
import type { ZeroLayerActivationCut_ACU } from './bridge-model';

/** 角色计数仅为调度水位；宿主实时忙态才用于排除在途生成。 */
export function assertBridgeHostIdle_ACU(): void {
  const state = readHostGenerationState_ACU();
  if (state !== 'idle') {
    throw new ZeroLayerError_ACU('migration-conflict', state === 'busy'
      ? '宿主仍有在途生成，禁止建立或推进桥接。'
      : '宿主生成状态不可确认，禁止建立或推进桥接。');
  }
}

/** 覆盖全部存量字段但排除自身；正文只参与摘要，不复制到迁移 manifest。 */
export function bridgeSourceFingerprint_ACU(chat: readonly unknown[]): string {
  const source = chat.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ZeroLayerError_ACU('migration-conflict', '桥接源包含无效消息。');
    }
    const copy = { ...value } as Record<string, unknown>;
    delete copy[ZERO_LAYER_CARRIER_FIELD_ACU];
    return copy;
  });
  return `sha256:${sha256HexSync_ACU(JSON.stringify(source))}`;
}

export function captureBridgeActivationCut_ACU(context: ZeroLayerCarrierContext_ACU,
  physicalFingerprint: string): ZeroLayerActivationCut_ACU {
  assertBridgeHostIdle_ACU();
  return { schemaVersion: 1, sourceFingerprint: physicalFingerprint,
    messageCount: context.chat.length,
    completedAiCount: context.chat.filter(value => {
      const message = value as Record<string, unknown>;
      return message.is_user !== true && message.is_system !== true;
    }).length,
    refs: context.chat.map((value, messageIndex) => ({ kind: 'host',
      scope: { ...context.scope }, sourceFingerprint: physicalFingerprint,
      messageIndex, swipeId: carrierSwipeId_ACU(value as Record<string, unknown>) })),
  };
}

export function assertBridgeSource_ACU(chat: readonly unknown[], expected: string): void {
  assertBridgeHostIdle_ACU();
  if (bridgeSourceFingerprint_ACU(chat) !== expected) {
    throw new ZeroLayerError_ACU('migration-conflict', '存量桥接来源已变化，保留旧数据及读取路径。');
  }
}
