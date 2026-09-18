import type { WorldSimulationRunResumeState_ACU } from './agent-model';

export type { WorldSimulationRunResumeState_ACU } from './agent-model';

const states_ACU = new Map<string, WorldSimulationRunResumeState_ACU>();

function clone_ACU(state: WorldSimulationRunResumeState_ACU): WorldSimulationRunResumeState_ACU {
  return {
    ...state,
    perAgent: { ...state.perAgent },
    outcomes: state.outcomes.map(item => ({ ...item })),
    candidates: state.candidates?.map(item => ({ ...item, patch: { ...item.patch }, evidenceRefs: [...item.evidenceRefs], uncertainties: [...item.uncertainties], writableModules: [...item.writableModules] })),
    subagentOutcomes: state.subagentOutcomes?.map(item => ({ ...item, evidenceRefs: [...item.evidenceRefs], uncertainties: [...item.uncertainties], unresolved: item.unresolved ? [...item.unresolved] : undefined, candidate: item.candidate ? { ...item.candidate, patch: { ...item.candidate.patch }, evidenceRefs: [...item.candidate.evidenceRefs], uncertainties: [...item.candidate.uncertainties], writableModules: [...item.candidate.writableModules] } : undefined })),
    evidenceSnapshot: state.evidenceSnapshot ? { runId: state.evidenceSnapshot.runId, entries: state.evidenceSnapshot.entries.map(entry => ({ ...entry })) } : undefined,
  };
}
export function saveWorldSimulationRunState_ACU(chatIdentity: string, state: WorldSimulationRunResumeState_ACU): void { if (chatIdentity) states_ACU.set(chatIdentity, clone_ACU(state)); }
export function readWorldSimulationRunState_ACU(chatIdentity: string, taskId: string, cursorKey: string): WorldSimulationRunResumeState_ACU | null {
  const cached = states_ACU.get(chatIdentity);
  if (!cached) return null;
  if (cached.taskId !== taskId || cached.cursorKey !== cursorKey) { states_ACU.delete(chatIdentity); return null; }
  return clone_ACU(cached);
}
export function clearWorldSimulationRunState_ACU(chatIdentity: string): void { states_ACU.delete(chatIdentity); }
export function resetWorldSimulationRunCacheForTests_ACU(): void { states_ACU.clear(); }
