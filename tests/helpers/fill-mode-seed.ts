/**
 * 测试辅助：通过真实宿主 chatMetadata 与全局偏好播种当前对话的填表模式。
 * 读取链路（chat-history / fill-mode-chat-record / flight-mode-state）保持真实实现。
 */
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import { globalMeta_ACU } from '../../src/data/repositories/profile-repo';
import { CHAT_SCOPED_CONFIG_FIELD_ACU } from '../../src/data/storage/chat-history';
import { FILL_MODE_PREFERENCES_KEY_ACU, type FillMode_ACU } from '../../src/service/fill-mode/fill-mode-preferences';

export interface FillModeSeed_ACU {
  /** 对话记录；省略或 null 表示无记录。 */
  record?: FillMode_ACU | null;
  /** 五角星偏好；省略或 null 表示从未保存（默认 classic）。 */
  preferred?: FillMode_ACU | null;
  /** 经典方案内部的飞行开关。 */
  flightEnabled?: boolean;
  chat?: any[];
  isolationKey?: string;
}

export function seedFillModeForTest_ACU(seed: FillModeSeed_ACU = {}): any[] {
  const chat = seed.chat ?? [{ is_user: false, mes: 'greeting' }];
  const key = seed.isolationKey ?? '';
  const container: Record<string, any> = { version: 1 };
  if (seed.record) container.fillModeByIsolationKey = { [key]: { mode: seed.record, recordedAt: 1 } };
  if (seed.flightEnabled) container.flightModeByIsolationKey = { [key]: { enabled: true, hiddenRowIds: [] } };
  _set_SillyTavern_API_ACU({
    chat,
    chatMetadata: { [CHAT_SCOPED_CONFIG_FIELD_ACU]: container },
    getCurrentChatId: () => 'fill-mode-test-chat',
  } as any);
  if (seed.preferred) globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU] = { schemaVersion: 1, selectedMode: seed.preferred };
  else delete globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];
  return chat;
}

export function resetFillModeSeed_ACU(): void {
  _set_SillyTavern_API_ACU(undefined);
  delete globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];
}
