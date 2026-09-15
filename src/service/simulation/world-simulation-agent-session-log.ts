export type WorldSimulationSessionEventKind_ACU = 'run_started' | 'user_message' | 'main_action' | 'delegation' | 'rebase' | 'run_failed' | 'run_completed';
export type WorldSimulationSessionEntryStatus_ACU = 'running' | 'done' | 'failed';

export interface WorldSimulationSessionEntry_ACU {
  id: number;
  at: number;
  kind: WorldSimulationSessionEventKind_ACU;
  title: string;
  detail: string;
  agentName: string;
  ok: boolean;
  status: WorldSimulationSessionEntryStatus_ACU;
}
export interface WorldSimulationSessionEventInput_ACU {
  kind: WorldSimulationSessionEventKind_ACU;
  title: string;
  detail?: string;
  agentName?: string;
  ok?: boolean;
  status?: WorldSimulationSessionEntryStatus_ACU;
}
export interface WorldSimulationSessionEntryPatch_ACU {
  title?: string;
  detail?: string;
  ok?: boolean;
  status?: WorldSimulationSessionEntryStatus_ACU;
}

const ENTRY_LIMIT_ACU = 300;
const DETAIL_LIMIT_ACU = 2_000;
let entries_ACU: WorldSimulationSessionEntry_ACU[] = [];
let nextId_ACU = 1;
let runningCount_ACU = 0;
const listeners_ACU = new Set<() => void>();

function notify_ACU(): void { for (const listener of listeners_ACU) { try { listener(); } catch (_) {} } }
function detail_ACU(value: unknown): string {
  const text = String(value ?? '');
  return text.length <= DETAIL_LIMIT_ACU ? text : `${text.slice(0, DETAIL_LIMIT_ACU)}\n（内容过长，已截断）`;
}
function terminal_ACU(kind: WorldSimulationSessionEventKind_ACU): boolean { return kind === 'run_failed' || kind === 'run_completed'; }

export function beginWorldSimulationSessionRun_ACU(title: string, detail = ''): void {
  runningCount_ACU += 1;
  logWorldSimulationSession_ACU({ kind: 'run_started', title, detail });
}
export function finishWorldSimulationSessionRun_ACU(title: string, detail = '', ok = true): void {
  if (runningCount_ACU > 0) runningCount_ACU -= 1;
  logWorldSimulationSession_ACU({ kind: ok ? 'run_completed' : 'run_failed', title, detail, ok });
}
export function logWorldSimulationSession_ACU(input: WorldSimulationSessionEventInput_ACU): number {
  const ok = input.ok !== false;
  const status = input.status ?? (ok ? 'done' : 'failed');
  const entry = { id: nextId_ACU++, at: Date.now(), kind: input.kind, title: input.title, detail: detail_ACU(input.detail), agentName: String(input.agentName ?? ''), ok, status };
  entries_ACU.push(entry);
  if (entries_ACU.length > ENTRY_LIMIT_ACU) entries_ACU = entries_ACU.slice(-ENTRY_LIMIT_ACU);
  if (terminal_ACU(input.kind)) runningCount_ACU = 0;
  notify_ACU();
  return entry.id;
}
export function updateWorldSimulationSession_ACU(id: number, patch: WorldSimulationSessionEntryPatch_ACU): void {
  const entry = entries_ACU.find(item => item.id === id);
  if (!entry) return;
  if (patch.title !== undefined) entry.title = patch.title;
  if (patch.detail !== undefined) entry.detail = detail_ACU(patch.detail);
  if (patch.ok !== undefined) entry.ok = patch.ok;
  entry.status = patch.status ?? (patch.ok === undefined ? entry.status : patch.ok ? 'done' : 'failed');
  notify_ACU();
}
export function readWorldSimulationSessionLog_ACU(): WorldSimulationSessionEntry_ACU[] { return [...entries_ACU]; }
export function hasWorldSimulationSessionEntries_ACU(): boolean { return entries_ACU.length > 0; }
export function isWorldSimulationSessionRunning_ACU(): boolean { return runningCount_ACU > 0; }
export function hydrateWorldSimulationSessionLog_ACU(items: readonly WorldSimulationSessionEventInput_ACU[]): number {
  if (entries_ACU.length || !items.length) return 0;
  for (const item of items) {
    const ok = item.ok !== false;
    entries_ACU.push({
      id: nextId_ACU++, at: Date.now(), kind: item.kind, title: item.title, detail: detail_ACU(item.detail),
      agentName: String(item.agentName ?? ''), ok, status: item.status ?? (ok ? 'done' : 'failed'),
    });
  }
  if (entries_ACU.length > ENTRY_LIMIT_ACU) entries_ACU = entries_ACU.slice(-ENTRY_LIMIT_ACU);
  notify_ACU();
  return items.length;
}
export function clearWorldSimulationSessionLog_ACU(options: { keepRunning?: boolean } = {}): void { entries_ACU = []; if (!options.keepRunning) runningCount_ACU = 0; notify_ACU(); }
export function subscribeWorldSimulationSessionLog_ACU(listener: () => void): () => void { listeners_ACU.add(listener); return () => { listeners_ACU.delete(listener); }; }
export function resetWorldSimulationSessionLogForTests_ACU(): void { entries_ACU = []; nextId_ACU = 1; runningCount_ACU = 0; listeners_ACU.clear(); }
