import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  saveSettings: vi.fn(),
  setAutoUpdate: vi.fn(),
  notify: vi.fn(),
  sim: {
    envelope: null as any,
    readUiSnapshot: vi.fn(),
    saveSettings: vi.fn(async () => undefined),
    saveUserRequirements: vi.fn(),
    sendAgentMessage: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    isInFlight: vi.fn(() => false),
  },
  cont: {
    envelope: null as any,
    read: vi.fn(),
    orchestrator: { replaceSettings: vi.fn() },
    continueTask: vi.fn(),
    stopGeneration: vi.fn(),
  },
}));

vi.mock('../../../../src/service/simulation/simulation-runtime', () => ({ getWorldSimulationRuntime_ACU: () => h.sim }));
vi.mock('../../../../src/service/continuation/continuation-runtime', () => ({ getContinuationRuntime_ACU: () => h.cont }));
vi.mock('../../../../src/service/runtime/state-manager', () => ({ settings_ACU: h.settings }));
vi.mock('../../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: () => h.saveSettings() }));
vi.mock('../../../../src/service/settings/settings-write-service', () => ({ setAutoUpdateEnabled_ACU: (value: boolean) => h.setAutoUpdate(value) }));
vi.mock('../../../../src/shared/notice-hub', () => ({ notifyNoticeSettingsChanged_ACU: () => h.notify() }));

import { createFeatureRuntimeApi_ACU } from '../../../../src/presentation/bootstrap/api-groups/feature-runtime-api';

describe('AutoCardUpdaterAPI 格林推演 / 智能续写 / 功能开关', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(h.settings)) delete h.settings[key];
    h.sim.envelope = { settings: { autoTriggerEnabled: true, dynamics: { rumorTTLDays: 30 } }, ledger: { revision: 3 }, task: null };
    h.sim.readUiSnapshot.mockImplementation(() => ({ envelope: h.sim.envelope, userRequirements: '只推演北境' }));
    h.sim.saveSettings.mockImplementation(async (next: any) => { h.sim.envelope = { ...h.sim.envelope, settings: next }; });
    h.cont.envelope = { settings: { stageSize: 'standard', maxAutomaticStages: 3 } };
    h.cont.read.mockImplementation(() => h.cont.envelope);
    h.cont.orchestrator.replaceSettings.mockImplementation(async ({ settings }: any) => { h.cont.envelope = { ...h.cont.envelope, settings }; return h.cont.envelope; });
  });

  it('格林推演读取返回深拷贝，补丁按顶层键合并后走 runtime 保存', async () => {
    const api = createFeatureRuntimeApi_ACU().worldSimulation;
    const read = api.getSettings()!;
    (read as any).dynamics.rumorTTLDays = 1;
    expect(h.sim.envelope.settings.dynamics.rumorTTLDays).toBe(30);
    const saved = await api.updateSettings({ autoTriggerEnabled: false } as any);
    expect(h.sim.saveSettings).toHaveBeenCalledWith({ autoTriggerEnabled: false, dynamics: { rumorTTLDays: 30 } });
    expect(saved).toEqual({ autoTriggerEnabled: false, dynamics: { rumorTTLDays: 30 } });
    expect(api.getLedger()).toEqual({ revision: 3 });
    expect(api.getUserRequirements()).toBe('只推演北境');
    h.sim.envelope = null;
    await expect(api.updateSettings({})).rejects.toThrow('还没有格林推演资料');
    await expect(createFeatureRuntimeApi_ACU().worldSimulation.updateSettings([] as any)).rejects.toThrow();
  });

  it('智能续写补丁合并后经 orchestrator.replaceSettings 保存', async () => {
    const api = createFeatureRuntimeApi_ACU().continuation;
    const saved = await api.updateSettings({ maxAutomaticStages: 5 } as any);
    expect(h.cont.orchestrator.replaceSettings).toHaveBeenCalledWith({ settings: { stageSize: 'standard', maxAutomaticStages: 5 } });
    expect(saved).toEqual({ stageSize: 'standard', maxAutomaticStages: 5 });
    api.stop();
    expect(h.cont.stopGeneration).toHaveBeenCalledOnce();
  });

  it('功能开关按仪表盘缺省语义读取，写入时保存并通知气泡/桌宠刷新，非法键值拒绝', () => {
    const features = createFeatureRuntimeApi_ACU().features;
    expect(features.getAll()).toMatchObject({ desktopPetEnabled: true, silentModeEnabled: false, worldSimulationPageEnabled: false, continuationPageEnabled: true });
    expect(features.set('desktopPetEnabled', false).desktopPetEnabled).toBe(false);
    expect(h.settings.desktopPetEnabled).toBe(false);
    expect(h.saveSettings).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenCalledOnce();
    features.set('worldSimulationPageEnabled', true);
    expect(h.notify).toHaveBeenCalledOnce();
    features.set('autoUpdateEnabled', false);
    expect(h.setAutoUpdate).toHaveBeenCalledWith(false);
    expect(() => features.set('unknownToggle', true)).toThrow('不支持的功能开关');
    expect(() => features.set('desktopPetEnabled', 'yes')).toThrow('true 或 false');
  });
});
