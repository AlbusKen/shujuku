/**
 * 格林推演、智能续写与界面功能开关（桌宠、气泡、功能页等）的对外读写入口。
 * 读取一律返回深拷贝；写入走各自现有的校验与保存路径，不绕过运行时。
 */
import { getContinuationRuntime_ACU } from '../../../service/continuation/continuation-runtime';
import type { ContinuationSettings_ACU } from '../../../service/continuation/model';
import { settings_ACU } from '../../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../../service/settings/settings-service';
import { setAutoUpdateEnabled_ACU } from '../../../service/settings/settings-write-service';
import type { WorldSimulationSettings_ACU } from '../../../service/simulation/model';
import { getWorldSimulationRuntime_ACU } from '../../../service/simulation/simulation-runtime';
import { notifyNoticeSettingsChanged_ACU } from '../../../shared/notice-hub';

const clone_ACU = <T>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

/** 补丁只合并顶层键；嵌套对象（如 dynamics、projection）整体替换，再交给原有校验。 */
function mergeSettings_ACU<T extends object>(current: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('设置补丁必须是对象');
  return { ...structuredClone(current), ...structuredClone(patch as Partial<T>) };
}

/** 与仪表盘「高级设置」同一套缺省语义：值不是布尔时按这里的缺省处理。 */
const FEATURE_TOGGLE_DEFAULTS_ACU = {
  autoUpdateEnabled: true,
  silentModeEnabled: false,
  desktopPetEnabled: true,
  deskPetJokesEnabled: true,
  deskPetShowRealWork: false,
  continuationPageEnabled: true,
  worldSimulationPageEnabled: false,
  externalImportPageEnabled: true,
} as const;
export type FeatureToggleKey_ACU = keyof typeof FEATURE_TOGGLE_DEFAULTS_ACU;
const NOTICE_TOGGLES_ACU = new Set<string>(['silentModeEnabled', 'desktopPetEnabled', 'deskPetJokesEnabled', 'deskPetShowRealWork']);

function readFeatureToggles_ACU(): Record<FeatureToggleKey_ACU, boolean> {
  return Object.fromEntries(Object.entries(FEATURE_TOGGLE_DEFAULTS_ACU).map(([key, fallback]) => {
    const value = settings_ACU[key];
    return [key, typeof value === 'boolean' ? value : fallback];
  })) as Record<FeatureToggleKey_ACU, boolean>;
}

function setFeatureToggle_ACU(key: string, value: unknown): Record<FeatureToggleKey_ACU, boolean> {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_TOGGLE_DEFAULTS_ACU, key)) {
    throw new RangeError(`不支持的功能开关：${key}；可用：${Object.keys(FEATURE_TOGGLE_DEFAULTS_ACU).join('、')}`);
  }
  if (typeof value !== 'boolean') throw new TypeError('功能开关的值必须是 true 或 false');
  if (key === 'autoUpdateEnabled') {
    setAutoUpdateEnabled_ACU(value);
  } else {
    settings_ACU[key] = value;
    saveSettings_ACU();
    if (NOTICE_TOGGLES_ACU.has(key)) notifyNoticeSettingsChanged_ACU();
  }
  return readFeatureToggles_ACU();
}

function createWorldSimulationApi_ACU() {
  const runtime = () => getWorldSimulationRuntime_ACU();
  const envelope = () => runtime().readUiSnapshot().envelope;
  const settings = (): WorldSimulationSettings_ACU | null => clone_ACU(envelope()?.settings ?? null);
  return Object.freeze({
    getSettings: settings,
    async updateSettings(patch: Partial<WorldSimulationSettings_ACU>): Promise<WorldSimulationSettings_ACU | null> {
      const current = envelope()?.settings;
      if (!current) throw new Error('当前聊天还没有格林推演资料，请先打开格林推演页完成初始化');
      await runtime().saveSettings(mergeSettings_ACU(current, patch));
      return settings();
    },
    getLedger: () => clone_ACU(envelope()?.ledger ?? null),
    getTask: () => clone_ACU(envelope()?.task ?? null),
    getUserRequirements: () => clone_ACU(runtime().readUiSnapshot().userRequirements),
    setUserRequirements: (requirements: unknown) => runtime().saveUserRequirements(requirements),
    send: (text: string) => runtime().sendAgentMessage(text),
    resume: () => runtime().resume(),
    stop: () => runtime().stop(),
    isRunning: () => runtime().isInFlight(),
  });
}

function createContinuationApi_ACU() {
  const runtime = () => getContinuationRuntime_ACU();
  const settings = (): ContinuationSettings_ACU | null => clone_ACU(runtime().read()?.settings ?? null);
  return Object.freeze({
    getSettings: settings,
    async updateSettings(patch: Partial<ContinuationSettings_ACU>): Promise<ContinuationSettings_ACU> {
      const current = runtime().read()?.settings;
      if (!current) throw new Error('当前聊天还没有智能续写资料，请先打开智能续写页完成初始化');
      const saved = await runtime().orchestrator.replaceSettings({ settings: mergeSettings_ACU(current, patch) });
      return clone_ACU(saved.settings);
    },
    getEnvelope: () => clone_ACU(runtime().read()),
    continueTask: () => runtime().continueTask(),
    stop: () => runtime().stopGeneration(),
  });
}

export function createFeatureRuntimeApi_ACU() {
  return {
    worldSimulation: createWorldSimulationApi_ACU(),
    continuation: createContinuationApi_ACU(),
    features: Object.freeze({
      keys: (): FeatureToggleKey_ACU[] => Object.keys(FEATURE_TOGGLE_DEFAULTS_ACU) as FeatureToggleKey_ACU[],
      getAll: readFeatureToggles_ACU,
      set: setFeatureToggle_ACU,
    }),
  };
}
