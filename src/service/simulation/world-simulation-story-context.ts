import { AgentStoryOverviewProvider_ACU } from '../agent-kernel/story-overview-provider';
import { buildAgentStoryContextSnapshot_ACU, type AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import { getLorebookEntriesRequired_ACU } from '../../data/gateways/worldbook-gateway';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from '../worldbook/injection-engine-state';
import { parseWorldSimulationProjection_ACU } from './simulation-projection';
import { resolveActiveWorldSimulationSwipe_ACU } from './simulation-swipe';

export interface WorldSimulationStoryContextDependencies_ACU {
  resolveTarget: () => Promise<string | null>;
  getIsolationPrefix: () => string;
  readEntries: (worldbookName: string) => Promise<unknown[]>;
}
export interface WorldSimulationStoryContextInput_ACU {
  chat: readonly unknown[];
  anchorMessageIndex: number;
  chatIdentity: string;
  runId: string;
  settledThroughIndex: number;
  bridgeFloorCount?: number;
}

const defaultDependencies_ACU: WorldSimulationStoryContextDependencies_ACU = {
  resolveTarget: () => getInjectionTargetLorebook_ACU(),
  getIsolationPrefix: () => getIsolationPrefix_ACU(),
  readEntries: worldbookName => getLorebookEntriesRequired_ACU(worldbookName),
};

function isAiFloor_ACU(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).is_user !== true
    && (value as Record<string, any>).extra?.type !== 'narrator';
}

/**
 * Adapts active SillyTavern swipe pages to the shared context model. A valid terminal
 * projection is system-owned and removed; malformed projection markup remains ordinary
 * untrusted story text instead of silently deleting user content.
 */
export function readWorldSimulationStoryBranchIdentity_ACU(chat: readonly unknown[], anchorMessageIndex: number): string {
  if (!Array.isArray(chat) || !Number.isInteger(anchorMessageIndex) || anchorMessageIndex < 0 || anchorMessageIndex >= chat.length) {
    throw new Error('WORLD_SIM_STORY_CONTEXT_INVALID: 正文分支边界非法');
  }
  const branchParts: string[] = [];
  for (let index = 0; index <= anchorMessageIndex; index += 1) {
    const message = chat[index];
    if (!isAiFloor_ACU(message)) continue;
    const active = resolveActiveWorldSimulationSwipe_ACU(index, message);
    branchParts.push(`${active.identity.messageIndex}:${active.identity.messageKey}:${active.identity.swipeIndex}:${active.identity.baseTextHash}`);
  }
  return branchParts.join('|');
}

export async function buildWorldSimulationStoryContext_ACU(
  input: WorldSimulationStoryContextInput_ACU,
  dependencies: WorldSimulationStoryContextDependencies_ACU = defaultDependencies_ACU,
): Promise<AgentStoryContextSnapshot_ACU> {
  if (!Array.isArray(input.chat) || !Number.isInteger(input.anchorMessageIndex) || input.anchorMessageIndex < 0 || input.anchorMessageIndex >= input.chat.length
    || !Number.isInteger(input.settledThroughIndex) || input.settledThroughIndex < -1
    || typeof input.chatIdentity !== 'string' || !input.chatIdentity.trim() || typeof input.runId !== 'string' || !input.runId.trim()) {
    throw new Error('WORLD_SIM_STORY_CONTEXT_INVALID: 输入边界非法');
  }
  const floors: Array<{ index: number; text: string }> = [];
  for (let index = 0; index <= input.anchorMessageIndex; index += 1) {
    const message = input.chat[index];
    if (!isAiFloor_ACU(message)) continue;
    const active = resolveActiveWorldSimulationSwipe_ACU(index, message);
    const projection = parseWorldSimulationProjection_ACU(active.text);
    const text = projection?.baseText ?? active.text;
    // A system-only terminal projection is not story prose. Keep it in branch identity but do not turn it into an empty floor.
    if (text.trim()) floors.push({ index, text });
  }
  const overview = await new AgentStoryOverviewProvider_ACU({
    resolveTarget: dependencies.resolveTarget,
    getIsolationPrefix: dependencies.getIsolationPrefix,
    readEntries: dependencies.readEntries,
  }).read();
  return buildAgentStoryContextSnapshot_ACU({
    feature: 'world-simulation',
    runId: input.runId,
    chatIdentity: input.chatIdentity,
    branchIdentity: readWorldSimulationStoryBranchIdentity_ACU(input.chat, input.anchorMessageIndex),
    sourceRevision: `anchor:${input.anchorMessageIndex};settled:${input.settledThroughIndex}`,
    profile: 'world-director',
    overview: { state: overview.state, text: overview.content, digest: overview.digest, diagnostic: overview.diagnostic },
    settledThroughIndex: input.settledThroughIndex,
    bridgeFloorCount: input.bridgeFloorCount ?? 2,
    floors,
  });
}
