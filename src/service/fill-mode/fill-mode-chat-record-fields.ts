import type { FillMode_ACU } from './fill-mode-preferences';

export const CHAT_FILL_MODE_FIELD_ACU = 'fillModeByIsolationKey';
export interface ChatFillModeRecord_ACU {
  mode: FillMode_ACU;
  recordedAt: number;
}

/** 仅暂存字段；调用方必须真实保存成功后才报告已记录。 */
export function stageChatFillModeRecord_ACU(container: Record<string, any>, isolationKey: string, mode: FillMode_ACU): void {
  const records = container[CHAT_FILL_MODE_FIELD_ACU];
  container[CHAT_FILL_MODE_FIELD_ACU] = {
    ...(records && typeof records === 'object' && !Array.isArray(records) ? records : {}),
    [isolationKey]: { mode, recordedAt: Date.now() },
  };
}
