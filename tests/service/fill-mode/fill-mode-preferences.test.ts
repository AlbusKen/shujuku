import { describe, expect, it } from 'vitest';

import { normalizeFillModePreferences_ACU } from '../../../src/service/fill-mode/fill-mode-preferences';

describe('fill mode preferences', () => {
  it('drops the unused LLM API preset profile while normalizing legacy saved data', () => {
    const result = normalizeFillModePreferences_ACU({
      schemaVersion: 1,
      selectedMode: 'llm',
      classic: { recentChronicleRows: 20 },
      vector: { resultCount: 40, minScore: 0.4, candidateLimit: 300 },
      llm: { apiPresetName: 'unused-preset' },
    } as any);

    expect(result.preferences).toEqual({
      schemaVersion: 1,
      selectedMode: 'llm',
      classic: { recentChronicleRows: 20 },
      vector: { resultCount: 40, minScore: 0.4, candidateLimit: 300 },
    });
    expect('llm' in result.preferences).toBe(false);
  });
});
