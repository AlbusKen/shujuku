import type { WorldChronicleEntry_ACU, WorldChronicleOverviewRow_ACU } from './model';
import { eventFingerprint_ACU, fuzzySimilarity_ACU, JACCARD_SIMILAR_THRESHOLD_ACU } from './event-similarity';

export type WorldArchiveHintLevel_ACU = 'exact' | 'similar';

export interface WorldArchiveHint_ACU {
  candidateIndex: number;
  level: WorldArchiveHintLevel_ACU;
  matchedDay: number;
  matchedOneLine: string;
  matchedArchiveRef: string;
}

export function buildArchiveHints_ACU(
  candidateChronicleEntries: readonly Pick<WorldChronicleEntry_ACU, 'summary' | 'at' | 'relatedIds'>[],
  chronicleOverview: readonly WorldChronicleOverviewRow_ACU[],
): WorldArchiveHint_ACU[] {
  const hints: WorldArchiveHint_ACU[] = [];
  for (const [candidateIndex, candidate] of candidateChronicleEntries.entries()) {
    const fingerprint = eventFingerprint_ACU(candidate.summary, candidate.at, candidate.relatedIds);
    const exact = chronicleOverview.find(row => row.fingerprint === fingerprint);
    if (exact) {
      hints.push({
        candidateIndex,
        level: 'exact',
        matchedDay: exact.day,
        matchedOneLine: exact.oneLine,
        matchedArchiveRef: exact.archiveRef,
      });
      continue;
    }
    let best: WorldChronicleOverviewRow_ACU | null = null;
    let bestScore = 0;
    for (const row of chronicleOverview) {
      const score = fuzzySimilarity_ACU(candidate.summary, row.oneLine);
      if (score >= JACCARD_SIMILAR_THRESHOLD_ACU && score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    if (best) {
      hints.push({
        candidateIndex,
        level: 'similar',
        matchedDay: best.day,
        matchedOneLine: best.oneLine,
        matchedArchiveRef: best.archiveRef,
      });
    }
  }
  return hints;
}
