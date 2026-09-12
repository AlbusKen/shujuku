import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import type { WorldStateSnapshot_ACU } from './model';
import { replayWorldSimulationFromChat_ACU } from './simulation-replay';

export type WorldSimulationAgentPreview_ACU =
  | { kind: 'empty' }
  | { kind: 'ready'; anchorMessageIndex: number; branchReparsed: boolean; digest: string; state: WorldStateSnapshot_ACU }
  | { kind: 'failed'; message: string };

function visibleState_ACU(state: WorldStateSnapshot_ACU, showHidden: boolean): WorldStateSnapshot_ACU {
  if (showHidden) return {
    ...state,
    storyClock: { ...state.storyClock, evidenceIndexes: [...state.storyClock.evidenceIndexes] },
    entities: state.entities.map(item => ({ ...item, visibility: { ...item.visibility } })),
    events: state.events.map(item => ({ ...item, visibility: { ...item.visibility } })),
    threads: state.threads.map(item => ({ ...item, visibility: { ...item.visibility } })),
    revisions: { ...state.revisions },
  };
  return {
    ...state,
    storyClock: { ...state.storyClock, evidenceIndexes: [...state.storyClock.evidenceIndexes] },
    entities: state.entities.filter(item => item.visibility.mode !== 'hidden').map(item => ({ ...item, visibility: { ...item.visibility } })),
    events: state.events.filter(item => item.visibility.mode !== 'hidden').map(item => ({ ...item, visibility: { ...item.visibility } })),
    threads: state.threads.filter(item => item.visibility.mode !== 'hidden').map(item => ({ ...item, visibility: { ...item.visibility } })),
    revisions: { ...state.revisions },
  };
}

/** Read-only Agent UI projection. Hidden data is excluded unless a saved setting explicitly permits it. */
export function readWorldSimulationAgentPreview_ACU(chat: any[] = getChatArray_ACU(), isolationKey = getCurrentIsolationKey_ACU(), options: { showHidden?: boolean } = {}): WorldSimulationAgentPreview_ACU {
  try {
    const replay = replayWorldSimulationFromChat_ACU(chat, isolationKey);
    if (!replay) return { kind: 'empty' };
    return { kind: 'ready', anchorMessageIndex: replay.state.anchorMessageIndex, branchReparsed: replay.branchReparsed, digest: replay.digest, state: visibleState_ACU(replay.state, options.showHidden === true) };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
