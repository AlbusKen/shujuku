import { describe, expect, it, vi } from 'vitest';
import { AgentStoryOverviewProvider_ACU, renderAgentStoryOverviewProviderResult_ACU } from '../../../src/service/agent-kernel/story-overview-provider';

const comment = 'ACU-[scope-a]-TavernDB-ACU-CustomExport-纪要索引';
function provider(entries: unknown[] | Error, target = '目标书') {
  return new AgentStoryOverviewProvider_ACU({
    resolveTarget: vi.fn().mockResolvedValue(target),
    getIsolationPrefix: vi.fn(() => 'ACU-[scope-a]-'),
    readEntries: vi.fn().mockImplementation(async () => { if (entries instanceof Error) throw entries; return entries; }),
  });
}

describe('AgentStoryOverviewProvider_ACU', () => {
  it('uses only the exact current-isolation generated entry and fingerprints its snapshot', async () => {
    const result = await provider([
      { comment: 'TavernDB-ACU-CustomExport-纪要索引', content: 'wrong scope' },
      { comment, content: '  current projection  ' },
    ]).read();
    expect(result).toMatchObject({ state: 'ready', content: 'current projection', comment, worldbookName: '目标书' });
    expect(result.digest).toMatch(/^fnv1a-[0-9a-f]{8}$/);
    expect(renderAgentStoryOverviewProviderResult_ACU(result)).toBe('current projection');
  });

  it('does not collapse missing, empty, invalid, and failed sources into empty history', async () => {
    await expect(provider([]).read()).resolves.toMatchObject({ state: 'missing', content: '' });
    await expect(provider([{ comment, content: '   ' }]).read()).resolves.toMatchObject({ state: 'empty', content: '' });
    await expect(provider([{ comment, content: 'ok' }, { comment, content: 'duplicate' }]).read()).resolves.toMatchObject({ state: 'invalid', content: '' });
    await expect(provider(new Error('unavailable')).read()).resolves.toMatchObject({ state: 'failed', content: '' });
    await expect(provider([], null as any).read()).resolves.toMatchObject({ state: 'missing', worldbookName: null });
  });
});