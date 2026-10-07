/**
 * 桌宠与通知气泡外观的对外读写入口：AutoCardUpdaterAPI.deskPet / AutoCardUpdaterAPI.noticeBubble。
 * 读取每次返回新对象；写入严格校验后保存，并立即刷新桌宠和气泡。开关类设置仍在 features 命名空间。
 */
import { DESK_PET_IMAGE_KEYS_ACU, type DeskPetImageKey_ACU } from '../../../shared/desk-pet-appearance';
import {
  deskPetAppearanceStore_ACU,
  noticeBubbleAppearanceStore_ACU,
  readDeskPetPosition_ACU,
  resetDeskPetPosition_ACU,
  setDeskPetPosition_ACU,
  type AppearanceStore_ACU,
} from '../../../service/settings/desk-pet-appearance-settings';

function appearanceMethods_ACU<T>(store: AppearanceStore_ACU<T>) {
  return {
    describe: () => store.describe(),
    getDefaults: () => store.defaults(),
    getAppearance: () => store.read().appearance,
    getOverrides: () => store.read().overrides,
    getIssues: () => store.read().issues,
    updateAppearance: (patch: unknown) => store.update(patch),
    resetAppearance: (keys?: string | string[]) => store.reset(keys),
  };
}

export function createDeskPetAppearanceApi_ACU() {
  return {
    deskPet: Object.freeze({
      ...appearanceMethods_ACU(deskPetAppearanceStore_ACU),
      imageKeys: (): DeskPetImageKey_ACU[] => [...DESK_PET_IMAGE_KEYS_ACU],
      getPosition: readDeskPetPosition_ACU,
      setPosition: (position: unknown) => setDeskPetPosition_ACU(position),
      resetPosition: resetDeskPetPosition_ACU,
    }),
    noticeBubble: Object.freeze(appearanceMethods_ACU(noticeBubbleAppearanceStore_ACU)),
  };
}
