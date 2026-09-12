import { logWarn_ACU } from '../../shared/utils';
import { WorldSimulationHiddenContextProvider_ACU } from './injection-provider';

type HostInjectPrompt_ACU = { id: string; role: 'system'; content: string; position: 'in_chat'; depth: number; should_scan: false };
type HostInjectPrompts_ACU = (prompts: HostInjectPrompt_ACU[], options: { once: true }) => unknown;

export interface WorldSimulationHiddenContextInjectorDependencies_ACU {
  renderHidden: (input: { plotEnabled: boolean }) => string;
  getHostInjectPrompts: () => HostInjectPrompts_ACU | null;
  warn: (message: string, details: Record<string, unknown>) => void;
}

const SYSTEM_INJECT_ID_ACU = 'acu-world-simulation-hidden-context';

const defaultDependencies_ACU: WorldSimulationHiddenContextInjectorDependencies_ACU = {
  renderHidden: input => new WorldSimulationHiddenContextProvider_ACU().render(input),
  getHostInjectPrompts: () => {
    const candidate = (globalThis as any).injectPrompts;
    return typeof candidate === 'function' ? candidate as HostInjectPrompts_ACU : null;
  },
  warn: (message, details) => logWarn_ACU(message, details),
};

function systemInject_ACU(content: string): HostInjectPrompt_ACU {
  return { id: SYSTEM_INJECT_ID_ACU, role: 'system', content, position: 'in_chat', depth: 0, should_scan: false };
}

/** Owns hidden-only rendering and host-specific injection without touching user prompt text. */
export class WorldSimulationHiddenContextInjector_ACU {
  constructor(private readonly dependencies: WorldSimulationHiddenContextInjectorDependencies_ACU = defaultDependencies_ACU) {}

  appendToGenerateOptions(options: unknown, input: { plotEnabled: boolean }): boolean {
    const content = this.dependencies.renderHidden(input);
    if (!content) return false;
    if (!options || typeof options !== 'object' || Array.isArray(options)) return this.warn_ACU('invalid_generate_options');
    const target = options as Record<string, unknown>;
    if (target.injects === undefined) target.injects = [];
    if (!Array.isArray(target.injects)) return this.warn_ACU('invalid_generate_injects');
    target.injects.push({ role: 'system', content, position: 'in_chat', depth: 0, should_scan: false });
    return true;
  }

  injectForNextHostGeneration(input: { plotEnabled: boolean }): boolean {
    const content = this.dependencies.renderHidden(input);
    if (!content) return false;
    const injectPrompts = this.dependencies.getHostInjectPrompts();
    if (!injectPrompts) return this.warn_ACU('host_inject_unavailable');
    try {
      injectPrompts([systemInject_ACU(content)], { once: true });
      return true;
    } catch (error) {
      return this.warn_ACU('host_inject_failed', error);
    }
  }

  private warn_ACU(reason: string, error?: unknown): false {
    this.dependencies.warn('[世界推演 hidden 注入] 宿主 system context 注入失败，已跳过。', {
      code: 'WORLD_SIM_INJECTION_FAILED', phase: 'injection', reason,
      ...(error instanceof Error ? { errorName: error.name } : {}),
    });
    return false;
  }
}
