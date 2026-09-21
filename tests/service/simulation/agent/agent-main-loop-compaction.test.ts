import { describe, expect, it } from 'vitest';
import { compactWorldSimulationTranscriptIfNeeded_ACU } from '../../../../src/service/simulation/agent/agent-main-loop';

const count = async (text: string) => text.length;
function longTranscript(rounds = 5) {
  const transcript: Array<{ role: string; content: string }> = [];
  for (let index = 0; index < rounds; index += 1) {
    transcript.push({ role: 'assistant', content: `A${index}:${'x'.repeat(30)}` });
    transcript.push({ role: 'user', content: `U${index}:${'y'.repeat(30)}` });
  }
  return transcript;
}

describe('世界推演 transcript 常态压缩', () => {
  it('超过 historyBudget×0.8 且不少于 5 轮时压缩最老段，保留最近 4 轮', async () => {
    const original = longTranscript(5);
    const result = await compactWorldSimulationTranscriptIfNeeded_ACU({
      transcript: original,
      unsettledCandidates: 0,
      historyTokenBudget: 100,
      countTokens: count,
    });
    expect(result.compacted).toBe(true);
    expect(result.transcript[0]).toMatchObject({ role: 'user' });
    expect(result.transcript[0].content.length).toBeGreaterThan(0);
    expect(result.transcript.slice(1)).toEqual(original.slice(-8));
  });

  it('未达阈值或轮次不足时不压缩', async () => {
    const short = longTranscript(5);
    const below = await compactWorldSimulationTranscriptIfNeeded_ACU({
      transcript: short,
      unsettledCandidates: 0,
      historyTokenBudget: 100000,
      countTokens: count,
    });
    expect(below).toEqual({ compacted: false, transcript: short });
    const fewRounds = longTranscript(4);
    const kept = await compactWorldSimulationTranscriptIfNeeded_ACU({
      transcript: fewRounds,
      unsettledCandidates: 0,
      historyTokenBudget: 10,
      countTokens: count,
    });
    expect(kept.compacted).toBe(false);
  });

  it('存在未结算候选时跳过压缩', async () => {
    const original = longTranscript(6);
    const result = await compactWorldSimulationTranscriptIfNeeded_ACU({
      transcript: original,
      unsettledCandidates: 2,
      historyTokenBudget: 10,
      countTokens: count,
    });
    expect(result).toEqual({ compacted: false, transcript: original });
  });
});
