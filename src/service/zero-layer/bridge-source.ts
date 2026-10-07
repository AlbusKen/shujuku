import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { ZERO_LAYER_CARRIER_FIELD_ACU, ZeroLayerError_ACU } from './model';
import type { ZeroLayerCarrierContext_ACU } from './carrier-context';
import { carrierSwipeId_ACU } from './carrier-context';
import type { ZeroLayerActivationCut_ACU } from './bridge-model';

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
  if (bridgeSourceFingerprint_ACU(chat) !== expected) {
    throw new ZeroLayerError_ACU('migration-conflict', '存量桥接来源已变化，保留旧数据及读取路径。');
  }
}
