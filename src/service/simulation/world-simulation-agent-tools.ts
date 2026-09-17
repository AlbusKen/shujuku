import type { WorldSimulationToolCall_ACU } from './agent/agent-model';
import { recordWorldSimulationEvidence_ACU, type WorldSimulationEvidenceRegistry_ACU, type WorldSimulationEvidenceStatus_ACU } from './world-simulation-evidence-registry';
import { gateWorldSimulationReadBatch_ACU, type WorldSimulationReadGateConfig_ACU, type WorldSimulationReadGateState_ACU } from './agent/agent-read-gate';
import type { WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';

export const WORLD_SIMULATION_TOOL_ADDRESSES_ACU = [
  'anchor:message', 'summary:current', 'worldbook:entry:', 'encyclopedia:entry:', 'web:url:',
  'ledger:current', 'stage-plan:current', 'candidates:current', 'chronicle:current', 'projection:preview',
] as const;
export interface WorldSimulationToolReadResult_ACU { status: WorldSimulationEvidenceStatus_ACU; content?: string; summary?: string; exact?: boolean; truncated?: boolean; directory?: boolean; }
export interface WorldSimulationToolSearchHit_ACU { address: string; summary: string; }
export interface WorldSimulationToolSearchResult_ACU { status: WorldSimulationEvidenceStatus_ACU; hits: readonly WorldSimulationToolSearchHit_ACU[]; summary?: string; }
export interface WorldSimulationToolDependencies_ACU {
  read(address: string): Promise<WorldSimulationToolReadResult_ACU>;
  search(query: string, scope: readonly string[], maxResults: number, isRegex: boolean): Promise<WorldSimulationToolSearchResult_ACU>;
}
export interface WorldSimulationToolResult_ACU { kind: 'read' | 'search'; address: string; status: WorldSimulationEvidenceStatus_ACU; content?: string; summary: string; evidenceRef?: string; }
export interface WorldSimulationToolBatchGate_ACU {
  state: WorldSimulationReadGateState_ACU;
  config: WorldSimulationReadGateConfig_ACU;
  usage: { readsUsed: number };
  maxReads: number;
  contextTokens?: number;
  count?: WorldSimulationTokenCounter_ACU;
}

export interface WorldSimulationToolContext_ACU {
  anchorMessage: unknown; summary: unknown; ledger: unknown; stagePlan: unknown;
  candidates: unknown; chronicle: unknown; projectionPreview: unknown;
  externalRead?: (address: string) => Promise<WorldSimulationToolReadResult_ACU>;
  externalSearch?: (query: string, scope: readonly string[], maxResults: number, isRegex: boolean) => Promise<WorldSimulationToolSearchResult_ACU>;
}

function summary_ACU(value: unknown): string { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function content_ACU(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value ?? null); }

export function createWorldSimulationToolDependencies_ACU(context: WorldSimulationToolContext_ACU): WorldSimulationToolDependencies_ACU {
  const local = new Map<string, unknown>([
    ['anchor:message', context.anchorMessage], ['summary:current', context.summary], ['ledger:current', context.ledger],
    ['stage-plan:current', context.stagePlan], ['candidates:current', context.candidates], ['chronicle:current', context.chronicle],
    ['projection:preview', context.projectionPreview],
  ]);
  return {
    async read(address) {
      if (local.has(address)) {
        const value = content_ACU(local.get(address));
        return value ? { status: 'ok', content: value, summary: summary_ACU(value), exact: true } : { status: 'empty', summary: 'empty local value', exact: true };
      }
      return context.externalRead ? context.externalRead(address) : { status: 'dependency_unavailable', summary: 'external read dependency unavailable' };
    },
    async search(query, scope, maxResults, isRegex) {
      return context.externalSearch ? context.externalSearch(query, scope, maxResults, isRegex) : { status: 'dependency_unavailable', hits: [], summary: 'external search dependency unavailable' };
    },
  };
}

export async function runWorldSimulationToolBatch_ACU(input: {
  calls: readonly WorldSimulationToolCall_ACU[];
  registry: WorldSimulationEvidenceRegistry_ACU;
  dependencies: WorldSimulationToolDependencies_ACU;
  gate?: WorldSimulationToolBatchGate_ACU;
}): Promise<WorldSimulationToolResult_ACU[]> {
  const results: WorldSimulationToolResult_ACU[] = [];
  for (const call of input.calls) {
    if (call.kind === 'read') {
      if (input.gate && input.gate.usage.readsUsed + call.reads.length > input.gate.maxReads) {
        for (const address of call.reads) {
          const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'read', address, status: 'failed', summary: 'WORLD_SIMULATION_READ_LIMIT_REACHED', exact: false });
          results.push({ kind: 'read', address, status: 'failed', summary: entry.summary });
        }
        continue;
      }
      const reads = await Promise.all(call.reads.map(async address => {
        try { return { address, read: await input.dependencies.read(address) }; }
        catch (error) { return { address, read: { status: 'failed', summary: error instanceof Error ? error.message : String(error) } as WorldSimulationToolReadResult_ACU }; }
      }));
      const normalized = reads.map(({ address, read }) => ({
        address,
        read,
        content: typeof read.content === 'string' ? read.content : undefined,
      }));
      if (input.gate) {
        const decision = await gateWorldSimulationReadBatch_ACU(
          normalized.flatMap(item => item.content ? [{ label: item.address, text: item.content }] : []),
          input.gate.state,
          input.gate.config,
          input.gate.contextTokens ?? 0,
          input.gate.count,
        );
        if (!decision.allowed) {
          for (const { address } of normalized) {
            const entry = recordWorldSimulationEvidence_ACU(input.registry, { operation: 'read', address, status: 'failed', summary: decision.report, exact: false });
            results.push({ kind: 'read', address, status: 'failed', summary: entry.summary });
          }
          continue;
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
