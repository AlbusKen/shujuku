/**
 * 桌宠 / 通知气泡外观设置与桌宠位置的读写。
 *
 * 外观只存用户改过的项（settings_ACU.deskPetAppearance / noticeBubbleAppearance）；
 * 写入先严格校验，保存被拒绝或失败时回滚内存值并抛错，成功后通知桌宠与气泡立即刷新。
 */
import {
  applyAppearancePatch_ACU,
  describeAppearance_ACU,
  readAppearanceOverrides_ACU,
  resetAppearanceOverrides_ACU,
  resolveAppearance_ACU,
  validateAppearancePatch_ACU,
  type AppearanceFieldInfo_ACU,
  type AppearanceOverrides_ACU,
  type AppearanceSchema_ACU,
} from '../../shared/appearance-schema';
import {
  DESK_PET_APPEARANCE_SCHEMA_ACU,
  NOTICE_BUBBLE_APPEARANCE_SCHEMA_ACU,
  checkDeskPetAppearance_ACU,
  checkNoticeBubbleAppearance_ACU,
  normalizeDeskPetDockEdge_ACU,
  type DeskPetAppearance_ACU,
  type DeskPetPosition_ACU,
  type NoticeBubbleAppearance_ACU,
} from '../../shared/desk-pet-appearance';
import { notifyNoticeSettingsChanged_ACU } from '../../shared/notice-hub';
import { logWarn_ACU } from '../../shared/utils';
import { settings_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from './settings-service';

type AppearanceSettingsKey_ACU = 'deskPetAppearance' | 'noticeBubbleAppearance';

/** 写一个设置字段并保存；保存被拒绝或失败时恢复原值并抛错。value 为 undefined 表示删除该字段。 */
function commitSetting_ACU(key: AppearanceSettingsKey_ACU | 'desktopPetPosition', value: unknown): void {
  const had = Object.prototype.hasOwnProperty.call(settings_ACU, key);
  const previous = settings_ACU[key];
  if (value === undefined) delete settings_ACU[key];
  else settings_ACU[key] = value;
  const result = saveSettings_ACU();
  if (result?.saved === false) {
    if (had) settings_ACU[key] = previous;
    else delete settings_ACU[key];
    throw new Error(result.warning || result.error || '设置保存失败');
  }
  if (result?.warning) logWarn_ACU(`[外观设置] ${result.warning}`);
  notifyNoticeSettingsChanged_ACU();
}

export interface AppearanceState_ACU<T> {
  /** 生效值：缺省值叠加有效的覆盖项。 */
  appearance: T;
  /** 已存且有效的覆盖项。 */
  overrides: AppearanceOverrides_ACU;
  /** 已存数据里无法使用的项（已按缺省处理，下一次写入时丢弃）。 */
  issues: string[];
}

export interface AppearanceStore_ACU<T> {
  read(): AppearanceState_ACU<T>;
  defaults(): T;
  describe(): AppearanceFieldInfo_ACU[];
  update(patch: unknown): T;
  reset(keys?: unknown): T;
}

function createAppearanceStore_ACU<T>(config: {
  key: AppearanceSettingsKey_ACU;
  path: string;
  schema: AppearanceSchema_ACU;
  check: (appearance: T) => void;
}): AppearanceStore_ACU<T> {
  const resolve = (overrides: AppearanceOverrides_ACU): T => resolveAppearance_ACU(config.schema, overrides) as unknown as T;

  const read = (): AppearanceState_ACU<T> => {
    const { overrides, issues } = readAppearanceOverrides_ACU(config.schema, settings_ACU?.[config.key], config.path);
    return { appearance: resolve(overrides), overrides, issues };
  };

  const save = (next: AppearanceOverrides_ACU, dropped: string[]): T => {
    const appearance = resolve(next);
    config.check(appearance);
    if (dropped.length) logWarn_ACU(`[外观设置] ${config.path} 已存数据里的无效项在本次保存时丢弃：`, dropped);
    commitSetting_ACU(config.key, Object.keys(next).length ? next : undefined);
    return appearance;
  };

  return {
    read,
    defaults: () => resolve({}),
    describe: () => describeAppearance_ACU(config.schema),
    update(patch: unknown): T {
      const clean = validateAppearancePatch_ACU(config.schema, patch, config.path);
      const current = read();
      if (!Object.keys(clean).length) return current.appearance;
      return save(applyAppearancePatch_ACU(config.schema, current.overrides, clean), current.issues);
    },
    reset(keys?: unknown): T {
      const current = read();
      return save(resetAppearanceOverrides_ACU(config.schema, current.overrides, keys, config.path), current.issues);
    },
  };
}

export const deskPetAppearanceStore_ACU = createAppearanceStore_ACU<DeskPetAppearance_ACU>({
  key: 'deskPetAppearance',
  path: 'deskPet',
  schema: DESK_PET_APPEARANCE_SCHEMA_ACU,
  check: checkDeskPetAppearance_ACU,
});

export const noticeBubbleAppearanceStore_ACU = createAppearanceStore_ACU<NoticeBubbleAppearance_ACU>({
  key: 'noticeBubbleAppearance',
  path: 'noticeBubble',
  schema: NOTICE_BUBBLE_APPEARANCE_SCHEMA_ACU,
  check: checkNoticeBubbleAppearance_ACU,
});

/** 读取已保存的桌宠位置；未保存或数据无效时返回 null（使用默认右下角）。 */
export function readDeskPetPosition_ACU(): DeskPetPosition_ACU | null {
  const saved = settings_ACU?.desktopPetPosition;
  if (!saved || typeof saved !== 'object') return null;
  const x = Number(saved.x);
  const y = Number(saved.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1), edge: normalizeDeskPetDockEdge_ACU(saved.edge) };
}

/** 设置桌宠位置：x / y 为 0~1 的比例（0 最左 / 最上，1 最右 / 最下），edge 为吸附侧边，省略或 null 表示自由停放。 */
export function setDeskPetPosition_ACU(position: unknown): DeskPetPosition_ACU {
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    throw new TypeError('deskPet.position：应为 { x, y, edge? } 对象');
  }
  const { x, y, edge = null, ...rest } = position as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length) throw new RangeError(`deskPet.position.${extra[0]}：不支持的设置项；可用：x、y、edge`);
  for (const [name, value] of [['x', x], ['y', y]] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`deskPet.position.${name}：应为 0~1 的比例`);
    }
  }
  const dockEdge = normalizeDeskPetDockEdge_ACU(edge);
  if (edge !== null && dockEdge === null) throw new RangeError('deskPet.position.edge：可选 left / right / top / bottom 或 null');
  const next: DeskPetPosition_ACU = { x: Number((x as number).toFixed(4)), y: Number((y as number).toFixed(4)), edge: dockEdge };
  commitSetting_ACU('desktopPetPosition', next);
  return { ...next };
}

/** 清除保存的位置，桌宠回到默认的右下角。 */
export function resetDeskPetPosition_ACU(): null {
  commitSetting_ACU('desktopPetPosition', undefined);
  return null;
}
