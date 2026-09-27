import { WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU, WORLD_SIMULATION_SINGLETON_ID_ACU, type WorldSimulationLedger_ACU, type WorldSimulationLedgerFieldSnapshot_ACU, type WorldSimulationLedgerModule_ACU } from './model';
import type { WorldSimulationRequestedFence_ACU, WorldSimulationToolCall_ACU } from './agent/agent-model';
import { recordWorldSimulationEvidence_ACU, type WorldSimulationEvidenceRegistry_ACU, type WorldSimulationEvidenceStatus_ACU } from './world-simulation-evidence-registry';
import { gateWorldSimulationReadBatch_ACU, type WorldSimulationReadGateConfig_ACU, type WorldSimulationReadGateState_ACU } from './agent/agent-read-gate';
import type { WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';

export const WORLD_SIMULATION_TOOL_ADDRESSES_ACU = [
  'anchor:message', 'summary:current', 'worldbook:entry:', 'encyclopedia:entry:', 'web:url:',
  'ledger:current', 'stage-plan:current', 'candidates:current', 'chronicle:current', 'projection:preview',
  'player:current', 'rumors:current',
  'seeds:', 'actors:', 'rumors:', 'chronicle:', 'dimensions:', 'chronicle-archive:', 'field:',
] as const;

export function formatWorldSimulationToolAddressHints_ACU(): string {
  return WORLD_SIMULATION_TOOL_ADDRESSES_ACU
    .flatMap(address => address === 'field:' ? ['field:<module>:<id>', 'field:<module>:<id>:<field>'] : [address])
    .join(' | ');
}
/**
 * 读取边界证明。旧宿主适配器可以不提供这组字段；一旦提供 requestedFence，
 * 门禁将要求 resolvedFence、稳定地址、revision 与 completeWithinFence 全部闭合。
 */
export interface WorldSimulationReadFenceProof_ACU {
  requestedFence?: string;
  resolvedFence?: string;
  stableAddress?: string;
  revision?: string | number;
  completeWithinFence?: boolean;
}
export interface WorldSimulationToolReadResult_ACU extends WorldSimulationReadFenceProof_ACU {
  status: WorldSimulationEvidenceStatus_ACU; content?: string; summary?: string; exact?: boolean; truncated?: boolean; directory?: boolean;
}
export interface WorldSimulationToolSearchHit_ACU { address: string; summary: string; }
export interface WorldSimulationToolSearchResult_ACU { status: WorldSimulationEvidenceStatus_ACU; hits: readonly WorldSimulationToolSearchHit_ACU[]; summary?: string; }
export interface WorldSimulationToolDependencies_ACU {
  read(address: string, requestedFence?: WorldSimulationRequestedFence_ACU, defaultReadFenceTokens?: number): Promise<WorldSimulationToolReadResult_ACU>;
  search(query: string, scope: readonly string[], maxResults: number, isRegex: boolean): Promise<WorldSimulationToolSearchResult_ACU>;
}
export interface WorldSimulationToolResult_ACU { kind: 'read' | 'search'; address: string; status: WorldSimulationEvidenceStatus_ACU; content?: string; summary: string; evidenceRef?: string; }
/** A single successful read batch per agent and round, even across runtime instances. */
export interface WorldSimulationReadRoundState_ACU {
  successfulReadBatches: Set<string>;
  pendingReadBatches: Set<string>;
}
export function createWorldSimulationReadRoundState_ACU(): WorldSimulationReadRoundState_ACU {
  return { successfulReadBatches: new Set(), pendingReadBatches: new Set() };
}
export interface WorldSimulationToolBatchGate_ACU {
  state: WorldSimulationReadGateState_ACU;
  config: WorldSimulationReadGateConfig_ACU;
  usage: { readsUsed: number; successfulReadBatches?: number };
  maxReads: number;
  readOnce?: boolean;
  readRoundKey?: string;
  readRoundState?: WorldSimulationReadRoundState_ACU;
  canReadAddress?: (address: string) => boolean;
  /** 最终请求门禁按 60% 公式算出的默认读取上围栏预算（TK）；仅作地址适配器的解析输入，不是正文截断阈值。 */
  defaultReadFenceTokens?: number;
  contextTokens?: number;
  count?: WorldSimulationTokenCounter_ACU;
}

export interface WorldSimulationToolContext_ACU {
  anchorMessage: unknown; summary: unknown; ledger: unknown; stagePlan: unknown;
  candidates: unknown; chronicle: unknown; projectionPreview: unknown;
  chronicleArchive?: unknown;
  liveArchive?: () => unknown;
  /** 生产折叠的账本与分栏视图；读取失败不能伪装为空。 */
  liveLedger?: () => { ledger: WorldSimulationLedger_ACU; fields?: WorldSimulationLedgerFieldSnapshot_ACU };
  externalRead?: (address: string, requestedFence?: WorldSimulationRequestedFence_ACU, defaultReadFenceTokens?: number) => Promise<WorldSimulationToolReadResult_ACU>;
  externalSearch?: (query: string, scope: readonly string[], maxResults: number, isRegex: boolean) => Promise<WorldSimulationToolSearchResult_ACU>;
}

function summary_ACU(value: unknown): string { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function content_ACU(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value ?? null); }
function ledgerSlice_ACU(ledger: unknown, key: string): unknown {
  return ledger !== null && typeof ledger === 'object' && !Array.isArray(ledger) && Object.prototype.hasOwnProperty.call(ledger, key)
    ? (ledger as Record<string, unknown>)[key]
    : null;
}

function ledgerItem_ACU(ledger: unknown, collection: string, id: string): unknown {
  const list = ledgerSlice_ACU(ledger, collection);
  if (!Array.isArray(list) || !id) return undefined;
  return list.find(item => item !== null && typeof item === 'object' && (item as { id?: unknown }).id === id);
}

function archiveItem_ACU(archive: unknown, archiveRef: string): unknown {
  if (!archiveRef) return undefined;
  if (archive !== null && typeof archive === 'object' && !Array.isArray(archive) && 'records' in archive) {
    const records = (archive as { records?: unknown }).records;
    if (records !== null && typeof records === 'object' && !Array.isArray(records)) {
      return (records as Record<string, unknown>)[archiveRef];
    }
  }
  return undefined;
}

export function createWorldSimulationToolDependencies_ACU(context: WorldSimulationToolContext_ACU): WorldSimulationToolDependencies_ACU {
  const resolveLocal_ACU = (address: string): { found: boolean; value?: unknown; missing?: string } => {
    if (address === 'anchor:message') return { found: true, value: context.anchorMessage };
    if (address === 'summary:current') return { found: true, value: context.summary };
    if (address === 'stage-plan:current') return { found: true, value: context.stagePlan };
    if (address === 'candidates:current') return { found: true, value: context.candidates };
    if (address === 'projection:preview') return { found: true, value: context.projectionPreview };
    if (address.startsWith('chronicle-archive:')) return { found: true, value: archiveItem_ACU(context.liveArchive?.() ?? context.chronicleArchive, address.slice('chronicle-archive:'.length)) };
    if (address === 'ledger:current' || address === 'chronicle:current' || address === 'player:current' || address === 'rumors:current'
      || /^(seeds|actors|rumors|chronicle|dimensions):.+$/.test(address) || address.startsWith('field:')) {
      const current = context.liveLedger?.();
      const ledger = current?.ledger ?? context.ledger;
      if (address === 'ledger:current') return { found: true, value: ledger };
      if (address === 'chronicle:current') return { found: true, value: ledgerSlice_ACU(ledger, 'chronicle') };
      if (address === 'player:current') return { found: true, value: ledgerSlice_ACU(ledger, 'player') };
      if (address === 'rumors:current') return { found: true, value: ledgerSlice_ACU(ledger, 'rumors') };
      if (address.startsWith('field:')) {
        const match = address.match(/^field:([a-z]+):([^:]+)(?::([^:]+))?$/);
        if (!match || !Object.prototype.hasOwnProperty.call(WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU, match[1])) return { found: true, missing: 'invalid field address' };
        const module = match[1] as WorldSimulationLedgerModule_ACU;
        const id = ['clock', 'player', 'guidance'].includes(module) ? WORLD_SIMULATION_SINGLETON_ID_ACU : match[2];
        if (id !== match[2] || match[3] && !WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module].fields.includes(match[3])) return { found: true, missing: 'invalid field address' };
        if (!current?.fields) return { found: true, missing: 'field view unavailable' };
        const record = current.fields.records[module]?.[id];
        if (!record) return { found: true, value: undefined };
        if (!match[3]) return { found: true, value: record };
        const field = record.fields[match[3]];
        return field ? { found: true, value: { module, id, field: match[3], status: record.status, ...field } }
          : { found: true, missing: `missing ${module}#${id}.${match[3]}; required: ${record.missingFields.join(', ')}` };
      }
      const prefixed = address.match(/^(seeds|actors|rumors|chronicle|dimensions):(.+)$/);
      if (prefixed) {
        const item = ledgerItem_ACU(ledger, prefixed[1], prefixed[2]);
        return { found: true, value: item ?? current?.fields?.records[prefixed[1] as WorldSimulationLedgerModule_ACU]?.[prefixed[2]] };
      }
    }
    return { found: false };
  };
  return {
    async read(address, requestedFence, defaultReadFenceTokens) {
      const localHit = resolveLocal_ACU(address);
      if (localHit.found) {
        if (localHit.missing) return { status: 'failed', summary: localHit.missing };
        if (localHit.value === undefined || localHit.value === null) return { status: 'empty', summary: 'empty local value', exact: true };
        const value = content_ACU(localHit.value);
        return value ? { status: 'ok', content: value, summary: summary_ACU(value), exact: true } : { status: 'empty', summary: 'empty local value', exact: true };
      }
      if (!context.externalRead) return { status: 'dependency_unavailable', summary: 'external read dependency unavailable' };
      return context.externalRead(address, requestedFence, defaultReadFenceTokens);
    },
    async search(query, scope, maxResults, isRegex) {
      return context.externalSearch ? context.externalSearch(query, scope, maxResults, isRegex) : { status: 'dependency_unavailable', hits: [], summary: 'external search dependency unavailable' };
    },
  };
}

function requestedFenceKey_ACU(fence?: WorldSimulationRequestedFence_ACU): string | undefined {
  if (!fence) return undefined;
  return JSON.stringify({
    ...(fence.lower !== undefined ? { lower: fence.lower } : {}),
    ...(fence.upper !== undefined ? { upper: fence.upper } : {}),
  });
}

function resolvedFenceWithinRequest_ACU(resolved: string | undefined, requested: WorldSimulationRequestedFence_ACU): boolean {
  if (!resolved) return false;
  let value: unknown;
  try { value = JSON.parse(resolved); } catch { return false; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fence = value as Record<string, unknown>;
  if (Object.keys(fence).some(key => key !== 'lower' && key !== 'upper')) return false;
  for (const bound of ['lower', 'upper'] as const) {
    const actual = fence[bound];
    const expected = requested[bound];
    if (actual === undefined || typeof actual !== 'string' && typeof actual !== 'number') return false;
    if (expected === undefined) continue;
    if (typeof actual !== typeof expected) return false;
    if (typeof expected === 'number') {
      if (!Number.isSafeInteger(actual) || (bound === 'lower' ? (actual as number) < expected : (actual as number) > expected)) return false;
    } else if (actual !== expected) return false;
  }
  if (typeof fence.lower === 'number' && typeof fence.upper === 'number' && fence.lower > fence.upper) return false;
  return true;
}

function fenceProofInvalid_ACU(
  proof: WorldSimulationToolReadResult_ACU,
  address: string,
  requestedFence?: WorldSimulationRequestedFence_ACU,
): boolean {
  const expectedRequestedFence = requestedFenceKey_ACU(requestedFence);
  const fenceDeclared = proof.requestedFence !== undefined || proof.resolvedFence !== undefined
    || proof.stableAddress !== undefined || proof.revision !== undefined || proof.completeWithinFence !== undefined;
  if (!expectedRequestedFence && !fenceDeclared) return false;
  const baseInvalid = !proof.resolvedFence
    || proof.stableAddress !== address
    || !(typeof proof.revision === 'string' && proof.revision.trim() || typeof proof.revision === 'number' && Number.isSafeInteger(proof.revision) && proof.revision >= 0)
    || proof.completeWithinFence !== true;
  if (baseInvalid) return true;
  if (expectedRequestedFence === undefined) {
    // 默认上围栏由适配器按容量预算解析；代理未显式请求时不要求 requestedFence 回显。
    return false;
  }
  return !proof.requestedFence
    || proof.requestedFence !== expectedRequestedFence
    || !resolvedFenceWithinRequest_ACU(proof.resolvedFence!, requestedFence!);
}

export async function runWorldSimulationToolBatch_ACU(input: {
  calls: readonly WorldSimulationToolCall_ACU[];
  registry: WorldSimulationEvidenceRegistry_ACU;
  dependencies: WorldSimulationToolDependencies_ACU;
  gate?: WorldSimulationToolBatchGate_ACU;
}): Promise<WorldSimulationToolResult_ACU[]> {
  // 带门禁的相邻 read 共同构成一次逻辑批次；search 和导演的无门禁调用保持原语义。
  if (input.gate && input.calls.length > 1 && input.calls.every(call => call.kind === 'read')) {
    const firstFence = requestedFenceKey_ACU(input.calls[0].requestedFence);
    if (input.calls.every(call => requestedFenceKey_ACU(call.requestedFence) === firstFence)) {
      return runWorldSimulationToolBatch_ACU({ ...input, calls: [{ kind: 'read', reads: input.calls.flatMap(call => call.reads), ...(input.calls[0].requestedFence ? { requestedFence: input.calls[0].requestedFence } : {}) }] });
    }
    return input.calls.flatMap(call => call.reads.map(address => ({ kind: 'read' as const, address, status: 'failed' as const, summary: 'WORLD_SIMULATION_READ_BATCH_FAILED:multiple-requested-fences' })));
  }
  const results: WorldSimulationToolResult_ACU[] = [];
  for (const call of input.calls) {
    if (call.kind === 'read') {
      const round = input.gate?.readRoundState;
      const key = input.gate?.readRoundKey;
      if (input.gate?.readOnce && (input.gate.usage.successfulReadBatches || (key && round?.successfulReadBatches.has(key)))) {
        return call.reads.map(address => ({ kind: 'read', address, status: 'failed', summary: 'read-once-exhausted' }));
      }
      if (input.gate?.readOnce && key && round?.pendingReadBatches.has(key)) {
        return call.reads.map(address => ({ kind: 'read', address, status: 'failed', summary: 'read-in-progress' }));
      }
      if (input.gate?.readOnce && Boolean(round) !== Boolean(key)) {
        return call.reads.map(address => ({ kind: 'read', address, status: 'failed', summary: 'read-round-identity-invalid' }));
      }
      if (input.gate?.readOnce && input.gate.canReadAddress) {
        const denied = call.reads.find(address => !input.gate!.canReadAddress!(address));
        if (denied !== undefined) {
          return call.reads.map(address => ({ kind: 'read', address, status: 'failed',
            summary: `WORLD_SIMULATION_READ_BATCH_FAILED:${denied}:read-address-unauthorized` }));
        }
      }
      if (input.gate && input.gate.usage.readsUsed + call.reads.length > input.gate.maxReads) {
        for (const address of call.reads) {
          if (input.gate.readOnce) {
            results.push({ kind: 'read', address, status: 'failed', summary: 'WORLD_SIMULATION_READ_LIMIT_REACHED' });
          } else {
            const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'read', address, status: 'failed', summary: 'WORLD_SIMULATION_READ_LIMIT_REACHED', exact: false });
            results.push({ kind: 'read', address, status: 'failed', summary: entry.summary });
          }
        }
        continue;
      }
      if (input.gate?.readOnce && round && key) round.pendingReadBatches.add(key);
      try {
      const defaultReadFenceTokens = call.requestedFence === undefined ? input.gate?.defaultReadFenceTokens : undefined;
      const reads = await Promise.all(call.reads.map(async address => {
        try {
          const read = await input.dependencies.read(address, call.requestedFence, defaultReadFenceTokens);
          return { address, requestedFence: call.requestedFence, read };
        }
        catch (error) { return { address, requestedFence: call.requestedFence, read: { status: 'failed', summary: error instanceof Error ? error.message : String(error) } as WorldSimulationToolReadResult_ACU }; }
      }));
      const normalized = reads.map(({ address, requestedFence, read }) => ({
        address,
        requestedFence,
        read,
        content: typeof read.content === 'string' ? read.content : undefined,
      }));
      if (input.gate) {
        const invalid = input.gate.readOnce && normalized.find(item => {
          const proof = item.read;
          return proof.truncated || proof.status !== 'ok' || !item.content || proof.exact !== true
            || fenceProofInvalid_ACU(proof, item.address, item.requestedFence);
        });
        if (invalid) {
          const proof = invalid.read;
          const fenceInvalid = fenceProofInvalid_ACU(proof, invalid.address, invalid.requestedFence);
          const reason = invalid.read.truncated ? 'truncated' : invalid.read.status !== 'ok'
            ? invalid.read.status : fenceInvalid ? 'fence-proof-invalid' : 'read-completeness-unverified';
          return normalized.map(item => ({ kind: 'read', address: item.address, status: 'failed',
            summary: `WORLD_SIMULATION_READ_BATCH_FAILED:${invalid.address}:${reason}` }));
        }
        const decision = await gateWorldSimulationReadBatch_ACU(
          normalized.flatMap(item => item.content ? [{ label: item.address, text: item.content }] : []),
          input.gate.state,
          input.gate.config,
          input.gate.contextTokens ?? 0,
          input.gate.count,
        );
        if (!decision.allowed) {
          for (const { address } of normalized) {
            if (input.gate.readOnce) {
              results.push({ kind: 'read', address, status: 'failed', summary: decision.report });
            } else {
              const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'read', address, status: 'failed', summary: decision.report, exact: false });
              results.push({ kind: 'read', address, status: 'failed', summary: entry.summary });
            }
          }
          continue;
        }
        if (input.gate.readOnce) {
          input.gate.usage.successfulReadBatches = 1;
          if (round && key) round.successfulReadBatches.add(key);
        }
        input.gate.state.grantedTokens += decision.batchTokens;
        input.gate.usage.readsUsed += call.reads.length;
      }
      for (const { address, read, content: normalizedContent } of normalized) {
        const status = read.truncated ? 'truncated' : read.status === 'ok' && !normalizedContent ? 'empty' : read.status;
        const operation = read.directory ? 'directory' : 'read';
        const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation, address, status, summary: summary_ACU(read.summary), exact: operation === 'read' && read.exact === true && !read.truncated });
        results.push({ kind: 'read', address, status, content: normalizedContent, summary: entry.summary, evidenceRef: entry.evidenceRef });
      }
      continue;
      } finally {
        if (input.gate?.readOnce && round && key) round.pendingReadBatches.delete(key);
      }
    }
    let search: WorldSimulationToolSearchResult_ACU;
    try { search = await input.dependencies.search(call.query, call.scope, call.maxResults, call.isRegex); }
    catch (error) {
      const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'search', address: `search:${call.query}`, status: 'failed', summary: error instanceof Error ? error.message : String(error), exact: false });
      results.push({ kind: 'search', address: entry.address, status: entry.status, summary: entry.summary });
      continue;
    }
    if (search.status !== 'ok' || !search.hits.length) {
      const status = search.status === 'ok' ? 'empty' : search.status;
      const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'search', address: `search:${call.query}`, status, summary: search.summary ?? 'no results', exact: false });
      results.push({ kind: 'search', address: entry.address, status: entry.status, summary: entry.summary });
    } else for (const hit of search.hits.slice(0, call.maxResults)) {
      const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'search', address: hit.address, status: 'ok', summary: hit.summary, exact: false });
      results.push({ kind: 'search', address: entry.address, status: entry.status, summary: entry.summary });
    }
  }
  return results;
}
