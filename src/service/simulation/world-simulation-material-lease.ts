import type { AgentMaterialGrant_ACU } from '../agent-kernel/material-grants';
import type { AgentRequirementSnapshot_ACU } from '../agent-kernel/requirements';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import { createAgentWorldbookGrantSource_ACU, resolveAgentWorldbookGrantEntries_ACU, type AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';

export interface WorldSimulationMaterialGrantIdentity_ACU { grantId: string; address: string; revision: string; digest: string; }
export interface WorldSimulationMaterialLease_ACU {
  requirementsRevision: number | null;
  overviewDigest: string | null;
  storySourceDigest: string | null;
  storySourceRevision: string | null;
  settledThroughIndex: number;
  grants: readonly WorldSimulationMaterialGrantIdentity_ACU[];
}

type GrantLike_ACU = Pick<AgentMaterialGrant_ACU, 'grantId' | 'source'>;

function identities_ACU(grants: readonly GrantLike_ACU[]): WorldSimulationMaterialGrantIdentity_ACU[] {
  return grants.map(grant => ({ grantId: grant.grantId, address: grant.source.address, revision: grant.source.revision, digest: grant.source.digest }))
    .sort((left, right) => left.grantId.localeCompare(right.grantId));
}

/** Captures only stable runtime material identities; no story or worldbook body enters a lease. */
export function captureWorldSimulationMaterialLease_ACU(input: {
  requirementsSnapshot?: AgentRequirementSnapshot_ACU | null;
  storyContext?: AgentStoryContextSnapshot_ACU | null;
  settledThroughIndex: number;
  grants?: readonly GrantLike_ACU[];
}): WorldSimulationMaterialLease_ACU {
  return {
    requirementsRevision: input.requirementsSnapshot?.revision ?? null,
    overviewDigest: input.storyContext?.overview.digest ?? null,
    storySourceDigest: input.storyContext?.sourceDigest ?? null,
    storySourceRevision: input.storyContext?.sourceRevision ?? null,
    settledThroughIndex: input.settledThroughIndex,
    grants: identities_ACU(input.grants ?? []),
  };
}

export function withWorldSimulationMaterialLeaseGrants_ACU(
  lease: WorldSimulationMaterialLease_ACU,
  grants: readonly GrantLike_ACU[],
): WorldSimulationMaterialLease_ACU {
  return { ...lease, grants: identities_ACU(grants) };
}

/** Re-resolves the sources of previously granted entries against a fresh frozen worldbook snapshot. */
export function rebindWorldSimulationMaterialLeaseGrants_ACU(
  lease: WorldSimulationMaterialLease_ACU,
  worldbook: AgentWorldbookSnapshot_ACU,
): WorldSimulationMaterialLease_ACU {
  const grants = lease.grants.map(grant => {
    const entries = resolveAgentWorldbookGrantEntries_ACU(worldbook, grant.address);
    if (entries.length !== 1) return { ...grant, revision: '', digest: '' };
    const source = createAgentWorldbookGrantSource_ACU(entries[0]!);
    return { grantId: grant.grantId, address: source.address, revision: source.revision, digest: source.digest };
  });
  return { ...lease, grants };
}

/** Rebuilds the non-grant identities from fresh sidecars and rebinds the fixed grant ids. */
export function refreshWorldSimulationMaterialLease_ACU(
  lease: WorldSimulationMaterialLease_ACU,
  input: {
    requirementsSnapshot?: AgentRequirementSnapshot_ACU | null;
    storyContext?: AgentStoryContextSnapshot_ACU | null;
    settledThroughIndex: number;
    worldbook: AgentWorldbookSnapshot_ACU;
  },
): WorldSimulationMaterialLease_ACU {
  const base = captureWorldSimulationMaterialLease_ACU({
    requirementsSnapshot: input.requirementsSnapshot,
    storyContext: input.storyContext,
    settledThroughIndex: input.settledThroughIndex,
  });
  return { ...base, grants: rebindWorldSimulationMaterialLeaseGrants_ACU(lease, input.worldbook).grants };
}

export function sameWorldSimulationMaterialLease_ACU(
  left: WorldSimulationMaterialLease_ACU,
  right: WorldSimulationMaterialLease_ACU,
): boolean {
  return left.requirementsRevision === right.requirementsRevision
    && left.overviewDigest === right.overviewDigest
    && left.storySourceDigest === right.storySourceDigest
    && left.storySourceRevision === right.storySourceRevision
    && left.settledThroughIndex === right.settledThroughIndex
    && left.grants.length === right.grants.length
    && left.grants.every((grant, index) => {
      const other = right.grants[index];
      return other !== undefined && grant.grantId === other.grantId && grant.address === other.address
        && grant.revision === other.revision && grant.digest === other.digest;
    });
}
