import { describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  entries: vi.fn(),
  bookNames: vi.fn(),
  count: vi.fn(async (text: string) => text.includes('改') ? 23 : 11),
}));

vi.mock('../../../../src/service/continuation/agent/agent-token-budget', () => ({ countAgentTokens_ACU: host.count }));
vi.mock('../../../../src/service/continuation/worldbook-context', () => ({
  resolveRelevantBookNames_ACU: host.bookNames,
  normalizeGeneratedComment_ACU: (entry: { comment?: string }) => entry.comment ?? '',
  isSummaryEntryComment_ACU: () => false,
  isSummaryIndexEntryComment_ACU: () => false,
}));
vi.mock('../../../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesByNames_ACU: host.entries,
  getWorldbookEntryKeywords_ACU: () => [],
}));
vi.mock('../../../../src/service/worldbook/injection-engine-state', () => ({ getIsolationPrefix_ACU: () => '' }));
vi.mock('../../../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: () => ({}) }));

import { loadAgentWorldbookSnapshot_ACU, renderAgentWorldbookHitBodies_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';

describe('世界书宿主正文完整性', () => {
  it('预取和固定命中注入保留宿主正文的首尾空白，仅排除纯空白条目', async () => {
    const content = `  开头\n${'完整正文。'.repeat(1000)}\n结尾  \n`;
    host.bookNames.mockResolvedValue(['设定集']);
    host.entries.mockResolvedValue({ 设定集: [
      { uid: 7, comment: '正文', enabled: true, type: 'constant', content },
      { uid: 8, comment: '空白', enabled: true, type: 'constant', content: ' \n ' },
    ] });
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.available).toBe(true);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].content).toBe(content);
    expect(renderAgentWorldbookHitBodies_ACU(snapshot, '')).toBe(`### 正文（设定集#7）\n${content}`);
  });
  it('同一条目等长改写后重新计量，未改正文才复用缓存', async () => {
    host.bookNames.mockResolvedValue(['等长改写测试']);
    const entry = (content: string) => ({ uid: 81, comment: '正文', enabled: true, type: 'constant', content });
    host.entries.mockResolvedValue({ 等长改写测试: [entry('原文内容')] });
    host.count.mockClear();
    const first = await loadAgentWorldbookSnapshot_ACU();
    expect(first.entries[0]).toMatchObject({ content: '原文内容', tokens: 11 });
    host.entries.mockResolvedValue({ 等长改写测试: [entry('改写内容')] });
    const second = await loadAgentWorldbookSnapshot_ACU();
    expect(second.entries[0]).toMatchObject({ content: '改写内容', tokens: 23 });
    await loadAgentWorldbookSnapshot_ACU();
    expect(host.count).toHaveBeenCalledTimes(2);
  });
});
