import { describe, expect, it, vi } from 'vitest';
import { WorldSimulationHiddenContextInjector_ACU } from '../../../src/service/simulation/hidden-context-injector';

describe('WorldSimulationHiddenContextInjector_ACU', () => {
  it('appends a system inject without overwriting caller-provided injects', () => {
    const renderHidden = vi.fn(() => 'hidden context');
    const injector = new WorldSimulationHiddenContextInjector_ACU({ renderHidden, getHostInjectPrompts: () => null, warn: vi.fn() });
    const options: any = { injects: [{ role: 'user', content: 'caller data' }] };
    expect(injector.appendToGenerateOptions(options, { plotEnabled: true })).toBe(true);
    expect(options.injects).toEqual([
      { role: 'user', content: 'caller data' },
      { role: 'system', content: 'hidden context', position: 'in_chat', depth: 0, should_scan: false },
    ]);
  });

  it('uses exactly one host system injection and fails closed when unavailable', () => {
    const hostInject = vi.fn();
    const injector = new WorldSimulationHiddenContextInjector_ACU({ renderHidden: () => 'hidden context', getHostInjectPrompts: () => hostInject, warn: vi.fn() });
    expect(injector.injectForNextHostGeneration({ plotEnabled: true })).toBe(true);
    expect(hostInject).toHaveBeenCalledWith([
      { id: 'acu-world-simulation-hidden-context', role: 'system', content: 'hidden context', position: 'in_chat', depth: 0, should_scan: false },
    ], { once: true });

    const warn = vi.fn();
    const unavailable = new WorldSimulationHiddenContextInjector_ACU({ renderHidden: () => 'hidden context', getHostInjectPrompts: () => null, warn });
    expect(unavailable.injectForNextHostGeneration({ plotEnabled: true })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'WORLD_SIM_INJECTION_FAILED', phase: 'injection', reason: 'host_inject_unavailable' }));
  });
});
