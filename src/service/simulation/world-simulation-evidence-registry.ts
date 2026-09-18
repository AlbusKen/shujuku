import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU } from './model';

export const WORLD_SIMULATION_EVIDENCE_STATUSES_ACU = ['ok', 'empty', 'failed', 'truncated', 'dependency_unavailable'] as const;
export type WorldSimulationEvidenceStatus_ACU = typeof WORLD_SIMULATION_EVIDENCE_STATUSES_ACU[number];
export type WorldSimulationEvidenceOperation_ACU = 'initial' | 'read' | 'search' | 'directory';

export interface WorldSimulationEvidenceEntry_ACU {
  evidenceRef?: string;
  operation: WorldSimulationEvidenceOperation_ACU;
  address: string;
  status: WorldSimulationEvidenceStatus_ACU;
  summary: string;
  exact: boolean;
}
export interface WorldSimulationEvidenceRegistrySnapshot_ACU {
  runId: string;
  entries: readonly WorldSimulationEvidenceEntry_ACU[];
}
export interface WorldSimulationEvidenceRegistry_ACU {
  runId: string;
  nextId: number;
  entries: WorldSimulationEvidenceEntry_ACU[];
}

function compact_ACU(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function createWorldSimulationEvidenceRegistry_ACU(runId: string): WorldSimulationEvidenceRegistry_ACU {
  const normalized = compact_ACU(runId);
  if (!normalized) throw new Error('WORLD_SIMULATION_EVIDENCE_RUN_ID_REQUIRED');
  return { runId: normalized, nextId: 1, entries: [] };
}

export function recordWorldSimulationEvidence_ACU(
  registry: WorldSimulationEvidenceRegistry_ACU,
  input: Omit<WorldSimulationEvidenceEntry_ACU, 'evidenceRef'>,
): WorldSimulationEvidenceEntry_ACU {
  const address = compact_ACU(input.address);
  if (!address) throw new Error('WORLD_SIMULATION_EVIDENCE_ADDRESS_REQUIRED');
  const eligible = input.status === 'ok' && input.exact && (input.operation === 'initial' || input.operation === 'read');
  const entry: WorldSimulationEvidenceEntry_ACU = {
    operation: input.operation,
    address,
    status: input.status,
    summary: compact_ACU(input.summary),
    exact: input.exact,
    ...(eligible ? { evidenceRef: `evidence:${registry.runId}:${registry.nextId++}` } : {}),
  };
  registry.entries.push(Object.freeze(entry));
  return entry;
}

export function snapshotWorldSimulationEvidenceRegistry_ACU(registry: WorldSimulationEvidenceRegistry_ACU): WorldSimulationEvidenceRegistrySnapshot_ACU {
  return Object.freeze({ runId: registry.runId, entries: Object.freeze(registry.entries.map(entry => Object.freeze({ ...entry }))) });
}

export function mergeWorldSimulationEvidenceRegistrySnapshot_ACU(
  registry: WorldSimulationEvidenceRegistry_ACU,
  snapshot: WorldSimulationEvidenceRegistrySnapshot_ACU,
): void {
  if (snapshot.runId !== registry.runId) throw new Error('WORLD_SIMULATION_EVIDENCE_RUN_MISMATCH');
  const escapedRunId = registry.runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refPattern = new RegExp(`^evidence:${escapedRunId}:(\\d+)$`);
  const operations: readonly WorldSimulationEvidenceOperation_ACU[] = ['initial', 'read', 'search', 'directory'];
  const known = new Set(registry.entries.map(entry => entry.evidenceRef
    ?? JSON.stringify([entry.operation, entry.address, entry.status, entry.summary, entry.exact])));
  for (const entry of snapshot.entries) {
    const validShape = entry !== null
      && typeof entry === 'object'
      && operations.includes(entry.operation)
      && (WORLD_SIMULATION_EVIDENCE_STATUSES_ACU as readonly string[]).includes(entry.status)
      && typeof entry.address === 'string'
      && !!entry.address.trim()
      && typeof entry.summary === 'string'
      && typeof entry.exact === 'boolean';
    if (!validShape) throw new Error('WORLD_SIMULATION_EVIDENCE_SNAPSHOT_INVALID');
    const eligible = entry.status === 'ok' && entry.exact && (entry.operation === 'initial' || entry.operation === 'read');
    const suffix = entry.evidenceRef?.match(refPattern)?.[1];
    if (eligible !== !!suffix) throw new Error('WORLD_SIMULATION_EVIDENCE_SNAPSHOT_INVALID');
    const key = entry.evidenceRef ?? JSON.stringify([entry.operation, entry.address, entry.status, entry.summary, entry.exact]);
    if (suffix) registry.nextId = Math.max(registry.nextId, Number(suffix) + 1);
    if (!known.has(key)) {
      registry.entries.push(Object.freeze({ ...entry }));
      known.add(key);
    }
  }
}

export function findUnauthorizedWorldSimulationEvidenceRefs_ACU(refs: readonly string[], snapshot?: WorldSimulationEvidenceRegistrySnapshot_ACU): string[] {
  if (!refs.length) return [];
  if (!snapshot) return [...refs];
  const allowed = new Set(snapshot.entries.flatMap(entry => entry.evidenceRef ? [entry.evidenceRef] : []));
  return refs.filter(ref => !allowed.has(ref));
}

export function assertWorldSimulationEvidenceRefsAuthorized_ACU(refs: readonly string[], snapshot?: WorldSimulationEvidenceRegistrySnapshot_ACU): void {
  const unauthorized = findUnauthorizedWorldSimulationEvidenceRefs_ACU(refs, snapshot);
  if (!unauthorized.length) return;
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_EVIDENCE_UNAUTHORIZED', 'agent_loop', 'evidenceRefs 包含当前 run 未授权引用', false, { unauthorized },
  ));
}
