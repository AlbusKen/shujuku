/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// runOwnedAi 的默认工厂读世界推演设置并按其解析 API 预设；fixed 空名/悬挂预设必须 fail-closed。
vi.mock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: vi.fn() }));

async function loadFactory(settings: unknown, presets: unknown[]) {
  vi.resetModules();
  const { _set_settings_ACU } = await import('../../../src/service/runtime/state-manager');
  _set_settings_ACU({
    worldSimulation: settings,
    apiPresets: presets,
    apiMode: 'custom',
    apiConfig: { url: 'https://current.example.com', model: 'm-current' },
  } as any);
  const module = await import('../../../src/service/simulation/simulation-runtime');
  return module.createWorldSimulationRuntime_ACU();
}

const enabledSettings = (patch: Record<string, unknown> = {}) => ({
  joinWaitMs: 0, checkpointInterval: 1, maxTrackedEntities: 1,
  visibilityPolicy: 'agent', showHiddenInUi: false, toolsEnabled: true,
  apiPresetMode: 'current', fixedApiPresetName: '',
  budgets: {
    light: { maxMasterModelTurns: 3, maxSpecialistModelTurns: 2, maxDelegations: 1, readTokenBudget: 'low', legacyReadCount: null },
    normal: { maxMasterModelTurns: 4, maxSpecialistModelTurns: 3, maxDelegations: 2, readTokenBudget: 'medium', legacyReadCount: null },
    deep: { maxMasterModelTurns: 5, maxSpecialistModelTurns: 4, maxDelegations: 4, readTokenBudget: 'high', legacyReadCount: null },
  },
  agentPrompts: {},
  promptForceDefaultVersion: 'spv6.2-world-sim-locked-seams-v8',
  ...patch,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('world simulation runOwnedAi preset resolution', () => {
  it('forwards the director role messages unchanged to the resolved provider call', async () => {
    let capturedMessages: any = null;
    vi.doMock('../../../src/service/ai/api-call', async importOriginal => ({
      ...(await importOriginal<any>()),
      callAIWithResolvedPreset_ACU: vi.fn(async (messages: any) => {
        capturedMessages = messages;
        return 'ok';
      }),
    }));
    const runtime = await loadFactory(enabledSettings(), []);
    const messages = [
      { role: 'system', content: '【行动规则】delegate/finalize' },
      { role: 'user', content: '<UNTRUSTED_WORLD_STATE>{}</UNTRUSTED_WORLD_STATE>' },
      { role: 'assistant', content: '收到' },
      { role: 'system', content: '【执行边界】' },
    ];
    await expect((runtime as any).dependencies.runOwnedAi({ source: 'world-sim-master', chatIdentity: 'c', prompt: 'flattened', messages })).resolves.toBe('ok');
    expect(capturedMessages).toEqual(messages);
  });

  it('resolves the user-fixed preset when it exists', async () => {
    let captured: any = null;
    vi.doMock('../../../src/service/ai/api-call', async importOriginal => ({
      ...(await importOriginal<any>()),
      callAIWithResolvedPreset_ACU: vi.fn(async (_messages: any, resolved: any) => {
        captured = resolved;
        return 'ok';
      }),
    }));
    const runtime = await loadFactory(enabledSettings({ apiPresetMode: 'fixed', fixedApiPresetName: '预设A' }), [{ name: '预设A', apiConfig: { url: 'https://a.example.com', model: 'm-preset-a' } }]);
    await expect((runtime as any).dependencies.runOwnedAi({ source: 'world-sim-master', chatIdentity: 'c', prompt: 'p' })).resolves.toBe('ok');
    expect(captured.apiConfig.model).toBe('m-preset-a');
  });

  it('rejects a fixed preset with an empty name (fail-closed)', async () => {
    const runtime = await loadFactory(enabledSettings({ apiPresetMode: 'fixed', fixedApiPresetName: '  ' }), []);
    await expect((runtime as any).dependencies.runOwnedAi({ source: 'world-sim-master', chatIdentity: 'c', prompt: 'p' }))
      .rejects.toThrow('固定 API 预设名称为空');
  });

  it('rejects a fixed preset that no longer exists (fail-closed)', async () => {
    const runtime = await loadFactory(enabledSettings({ apiPresetMode: 'fixed', fixedApiPresetName: '已删除' }), []);
    await expect((runtime as any).dependencies.runOwnedAi({ source: 'world-sim-master', chatIdentity: 'c', prompt: 'p' }))
      .rejects.toThrow('不存在');
  });

  it('follows the current global configuration in current mode', async () => {
    let captured: any = null;
    vi.doMock('../../../src/service/ai/api-call', async importOriginal => ({
      ...(await importOriginal<any>()),
      callAIWithResolvedPreset_ACU: vi.fn(async (_messages: any, resolved: any) => {
        captured = resolved;
        return 'ok';
      }),
    }));
    const runtime = await loadFactory(enabledSettings(), []);
    await expect((runtime as any).dependencies.runOwnedAi({ source: 'world-sim-master', chatIdentity: 'c', prompt: 'p' })).resolves.toBe('ok');
    expect(captured.apiConfig.model).toBe('m-current');
  });
});
