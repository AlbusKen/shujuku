import type { AgentWorldbookControl_ACU } from '../../shared/models/agent-worldbook-model';

let revision = 0;
let loadedControl: AgentWorldbookControl_ACU | null = null;
let nativeFallback = false;

/** 只缓存已读取或已提交的功能配置，不作为接管快照的事实源。 */
export function getAgentWorldbookRuntimeRevision_ACU(): number {
  return revision;
}

export function getLoadedAgentWorldbookControl_ACU(): AgentWorldbookControl_ACU | null {
  return loadedControl ? JSON.parse(JSON.stringify(loadedControl)) : null;
}

export function isAgentWorldbookRuntimeEnabled_ACU(): boolean {
  return loadedControl?.enabled === true && loadedControl.mode === 'agent';
}

export function setLoadedAgentWorldbookControl_ACU(
  control: AgentWorldbookControl_ACU | null,
  expectedRevision: number,
  invalidatePendingReads = false,
): boolean {
  if (revision !== expectedRevision) return false;
  loadedControl = control ? JSON.parse(JSON.stringify(control)) : null;
  if (invalidatePendingReads) revision += 1;
  return true;
}

export function resetAgentWorldbookRuntime_ACU(): void {
  revision += 1;
  loadedControl = null;
  nativeFallback = false;
}

export function isAgentWorldbookNativeFallback_ACU(): boolean {
  return nativeFallback;
}

export function setAgentWorldbookNativeFallback_ACU(value: boolean): void {
  nativeFallback = value;
}
