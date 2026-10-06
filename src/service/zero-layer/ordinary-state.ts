import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentCharacterCardKey_ACU } from '../../data/gateways/host-state-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { captureZeroLayerCarrier_ACU, readZeroLayerCarrier_ACU } from './carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, ZeroLayerError_ACU } from './model';
import { pendingZeroLayerPersistence_ACU } from './persistence-state';

/** 无零层字段的普通聊天不进入零层校验；未知保存即使本地字段已回滚也不能放行。 */
export function readOrdinaryZeroLayerState_ACU(allowActive = false) {
  const chat = getChatArray_ACU();
  const key = JSON.stringify([getCurrentCharacterCardKey_ACU(), getActiveChatStorageIdentity_ACU(chat)]);
  if (pendingZeroLayerPersistence_ACU.has(key)) {
    throw new ZeroLayerError_ACU('persist-unknown', '保存结果未知，请显式从服务器回读恢复，禁止普通生成。');
  }
  if (!chat.some(message => message && typeof message === 'object'
    && Object.prototype.hasOwnProperty.call(message, ZERO_LAYER_CARRIER_FIELD_ACU))) return null;
  const context = captureZeroLayerCarrier_ACU();
  const envelope = readZeroLayerCarrier_ACU(context);
  if (!envelope) throw new ZeroLayerError_ACU('persist-unknown', '载体保存尚未确认，禁止普通生成。');
  if (allowActive && envelope.enabled && !envelope.exitManifest) return null;
  if (envelope.exitManifest?.phase !== 'committed') {
    throw new ZeroLayerError_ACU('mode-disabled', '普通生成前必须显式完成退出桥接；prepared 意图或仅关闭模式不能放行。');
  }
  return { context, envelope };
}
