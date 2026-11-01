import { selectTriggeredWorldbookEntries_ACU, type AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';

export interface WorldRecallWorldbookRefs_ACU {
  available: boolean;
  triggered: Array<{ bookName: string; uid: string }>;
  deferred: Array<{ bookName: string; uid: string; reason: 'budget' }>;
}

/** 借用既有触发语义；仅暴露地址，精读仍需同一快照和 read gate 授权。 */
export function selectWorldRecallWorldbookRefs_ACU(
  snapshot: AgentWorldbookSnapshot_ACU, scanText: string, maxEntries: number,
): WorldRecallWorldbookRefs_ACU {
  if (!snapshot.available) return { available: false, triggered: [], deferred: [] };
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 64) throw new Error('世界书召回上限必须是 1..64');
  const hits = selectTriggeredWorldbookEntries_ACU(snapshot.entries, scanText);
  const refs = hits.map(entry => ({ bookName: entry.bookName, uid: entry.uid }));
  return { available: true, triggered: refs.slice(0, maxEntries),
    deferred: refs.slice(maxEntries).map(ref => ({ ...ref, reason: 'budget' as const })) };
}
