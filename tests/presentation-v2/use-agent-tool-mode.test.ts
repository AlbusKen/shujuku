import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useAgentToolMode } from '../../src/presentation-v2/composables/useAgentToolMode';
import { __resetNoticeHubForTests_ACU, notifyNoticeSettingsChanged_ACU } from '../../src/shared/notice-hub';

const harness = vi.hoisted(() => ({
  settings: { continuationNativeToolEnabled: false, worldSimulationNativeToolEnabled: false },
  save: vi.fn(() => ({ saved: true, warning: '', error: '' })),
  error: vi.fn(), warning: vi.fn(),
}));
vi.mock('../../src/service/runtime/state-manager', () => ({ settings_ACU: harness.settings }));
vi.mock('../../src/service/settings/settings-service', () => ({ saveSettings_ACU: harness.save }));
vi.mock('../../src/presentation-v2/stores/toast-store', () => ({ useToastStore: () => harness }));
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  __resetNoticeHubForTests_ACU();
  harness.settings.continuationNativeToolEnabled = false;
  harness.settings.worldSimulationNativeToolEnabled = false;
  vi.clearAllMocks();
  harness.save.mockReturnValue({ saved: true, warning: '', error: '' });
});
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });

describe.each(['continuation', 'worldSimulation'] as const)('%s 全局工具开关', feature => {
  const key = feature === 'continuation' ? 'continuationNativeToolEnabled' : 'worldSimulationNativeToolEnabled';
  const other = feature === 'continuation' ? 'worldSimulationNativeToolEnabled' : 'continuationNativeToolEnabled';
  const setup = () => {
    const scope = effectScope(); scopes.push(scope);
    return scope.run(() => useAgentToolMode(feature))!;
  };
  it('初始化不保存，显式切换仅保存本功能全局字段', () => {
    const state = setup();
    expect(state.mode.value).toBe('json');
    expect(harness.save).not.toHaveBeenCalled();
    state.setEnabled(true);
    expect(harness.save).toHaveBeenCalledOnce();
    expect(state.mode.value).toBe('tools');
    expect(harness.settings[other]).toBe(false);
  });
  it('保存失败回滚并告知错误，外部 settingsVersion 通知刷新投影', () => {
    const state = setup();
    expect(state.enabled.value).toBe(false);
    harness.save.mockReturnValueOnce({ saved: false, warning: '', error: '宿主保存失败' });
    state.setEnabled(true);
    expect(harness.settings[key]).toBe(false);
    expect(state.enabled.value).toBe(false);
    expect(harness.error).toHaveBeenCalledWith('宿主保存失败');
    harness.settings[key] = true;
    notifyNoticeSettingsChanged_ACU();
    expect(state.enabled.value).toBe(true);
    expect(state.mode.value).toBe('tools');
    expect(harness.save).toHaveBeenCalledOnce();
  });
});
