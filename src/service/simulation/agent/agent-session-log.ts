export type WorldSimulationSessionEventKind_ACU = 'run_started' | 'run_resumed' | 'user_message' | 'thought' | 'main_action' | 'protocol_retry' | 'tool_read' | 'delegation' | 'stage_plan' | 'handoff' | 'finalize' | 'block' | 'run_failed' | 'run_completed';
export type WorldSimulationSessionStatus_ACU = 'running' | 'done' | 'failed';
export interface WorldSimulationSessionEntry_ACU { id: number; at: number; kind: WorldSimulationSessionEventKind_ACU; title: string; detail: string; agentName: string; ok: boolean; status: WorldSimulationSessionStatus_ACU; }
export interface WorldSimulationSessionInput_ACU { kind: WorldSimulationSessionEventKind_ACU; title: string; detail?: string; agentName?: string; ok?: boolean; status?: WorldSimulationSessionStatus_ACU; }
interface WorldSimulationSessionPartition_ACU {
  entries: WorldSimulationSessionEntry_ACU[];
  nextId: number;
  running: boolean;
  listeners: Set<() => void>;
}
const partitions_ACU = new Map<string, WorldSimulationSessionPartition_ACU>();
const clean_ACU = (value: unknown, limit: number) => { const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim(); return text.length <= limit ? text : `${text.slice(0, limit)}…`; };
function partition_ACU(chatIdentity: string): WorldSimulationSessionPartition_ACU {
  const key = chatIdentity.trim();
  if (!key) throw new Error('WORLD_SIMULATION_SESSION_CHAT_IDENTITY_REQUIRED');
  let partition = partitions_ACU.get(key);
  if (!partition) {
    partition = { entries: [], nextId: 1, running: false, listeners: new Set() };
    partitions_ACU.set(key, partition);
  }
  return partition;
}
function notify_ACU(partition: WorldSimulationSessionPartition_ACU): void { for (const listener of partition.listeners) { try { listener(); } catch { /* observer isolation */ } } }
export function beginWorldSimulationSessionRun_ACU(chatIdentity: string, label: string, detail = '', resume = false): void {
  partition_ACU(chatIdentity).running = true;
  logWorldSimulationSession_ACU(chatIdentity, { kind: resume ? 'run_resumed' : 'run_started', title: label, detail });
}
export function logWorldSimulationSession_ACU(chatIdentity: string, input: WorldSimulationSessionInput_ACU): number {
  const partition = partition_ACU(chatIdentity);
  const ok = input.ok !== false;
  const id = partition.nextId++;
  partition.entries.push({ id, at: Date.now(), kind: input.kind, title: clean_ACU(input.title, 300), detail: clean_ACU(input.detail, 2000), agentName: clean_ACU(input.agentName, 128), ok, status: input.status ?? (ok ? 'done' : 'failed') });
  if (partition.entries.length > 300) partition.entries = partition.entries.slice(-300);
  if (['run_completed', 'run_failed', 'block'].includes(input.kind)) partition.running = false;
  notify_ACU(partition); return id;
}
export function updateWorldSimulationSession_ACU(chatIdentity: string, id: number, patch: Partial<Pick<WorldSimulationSessionEntry_ACU, 'title' | 'detail' | 'ok' | 'status'>>): void {
  const partition = partition_ACU(chatIdentity);
  const entry = partition.entries.find(item => item.id === id); if (!entry) return;
  if (patch.title !== undefined) entry.title = clean_ACU(patch.title, 300);
  if (patch.detail !== undefined) entry.detail = clean_ACU(patch.detail, 2000);
  if (patch.ok !== undefined) entry.ok = patch.ok;
  entry.status = patch.status ?? (patch.ok === undefined ? entry.status : patch.ok ? 'done' : 'failed'); notify_ACU(partition);
}
export function readWorldSimulationSessionLog_ACU(chatIdentity: string): WorldSimulationSessionEntry_ACU[] { return partition_ACU(chatIdentity).entries.map(item => ({ ...item })); }
export function hydrateWorldSimulationSessionLog_ACU(chatIdentity: string, items: readonly WorldSimulationSessionInput_ACU[]): number { const partition = partition_ACU(chatIdentity); if (partition.entries.length) return 0; for (const item of items) logWorldSimulationSession_ACU(chatIdentity, item); partition.running = false; return items.length; }
export function clearWorldSimulationSessionLog_ACU(chatIdentity: string, options: { keepRunning?: boolean } = {}): void { const partition = partition_ACU(chatIdentity); partition.entries = []; if (!options.keepRunning) partition.running = false; notify_ACU(partition); }
/** 强制结束运行标记。异常路径（协议失败、API 异常）不会写 run_failed 事件，由终局兜底调用本函数，避免 UI 永远停在「正在工作」。返回是否确实结束了一次运行。 */
export function endWorldSimulationSessionRun_ACU(chatIdentity: string): boolean { const partition = partition_ACU(chatIdentity); if (!partition.running) return false; partition.running = false; notify_ACU(partition); return true; }
export function isWorldSimulationSessionRunning_ACU(chatIdentity: string): boolean { return partition_ACU(chatIdentity).running; }
export function subscribeWorldSimulationSessionLog_ACU(chatIdentity: string, listener: () => void): () => void { const listeners = partition_ACU(chatIdentity).listeners; listeners.add(listener); return () => { listeners.delete(listener); }; }
export function resetWorldSimulationSessionLogForTests_ACU(): void { partitions_ACU.clear(); }
