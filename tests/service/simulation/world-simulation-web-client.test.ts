import { describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { evaluateWorldSimulationWebUrl_ACU, WorldSimulationWebClient_ACU } from '../../../src/service/simulation/world-simulation-web-client';

describe('世界推演网页客户端', () => {
  it('拒绝危险 URL 与用户黑名单域', () => {
    expect(evaluateWorldSimulationWebUrl_ACU('not-a-url', '')).toBe('invalid-url');
    expect(evaluateWorldSimulationWebUrl_ACU('file:///etc/passwd', '')).toBe('disallowed-url');
    expect(evaluateWorldSimulationWebUrl_ACU('https://example.com:8080', '')).toBe('disallowed-url');
    for (const url of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.1/x', 'http://[::1]/x', 'http://host.local/x']) {
      expect(evaluateWorldSimulationWebUrl_ACU(url, '')).toBe('blocked-host');
    }
    expect(evaluateWorldSimulationWebUrl_ACU('https://sub.example.com/x', 'example.com')).toBe('blocked-domain');
    expect(evaluateWorldSimulationWebUrl_ACU('https://safe.example/x', 'example.com')).toBeNull();
  });

  it('解析 SearXNG HTML，而不是把响应误当 JSON', async () => {
    const html = '<article class="result"><h3><a href="https://example.com/a">标题 <b>A</b></a></h3><p class="content">摘要 &amp; 内容</p></article>';
    const fetcher = vi.fn(async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const settings = { ...buildDefaultWorldSimulationSettings_ACU().webResearch, searchProvider: 'searxng' as const, searxngBaseUrl: 'https://search.example' };
    const result = await new WorldSimulationWebClient_ACU(fetcher).webSearch('线索', settings);
    expect(result).toEqual({ hits: [{ title: '标题 A', url: 'https://example.com/a', summary: '摘要 & 内容' }], note: '' });
    expect(fetcher).toHaveBeenCalledWith('/api/search/searxng', expect.objectContaining({ method: 'POST' }));
  });

  it('网页读取区分 HTTP 失败并保留截断标记', async () => {
    const settings = { ...buildDefaultWorldSimulationSettings_ACU().webResearch, pageCharLimit: 5 };
    const failed = new WorldSimulationWebClient_ACU(vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch);
    expect(await failed.webRead('https://example.com', settings)).toMatchObject({ text: '', truncated: false, note: 'http-502' });

    const fetcher = vi.fn(async () => new Response('<main>abcdefgh</main>', { status: 200 })) as unknown as typeof fetch;
    expect(await new WorldSimulationWebClient_ACU(fetcher).webRead('https://example.com', settings)).toEqual({ text: 'abcde', truncated: true, note: '' });
  });

  it('百科搜索和读取使用独立 API 并传播空结果', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(['q', ['条目 A']]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: { 1: { extract: '' } } } }), { status: 200 })) as unknown as typeof fetch;
    const client = new WorldSimulationWebClient_ACU(fetcher);
    expect((await client.searchEncyclopedia('moegirl', '条目')).hits[0]?.title).toBe('条目 A');
    expect(String((fetcher as any).mock.calls[0][0])).toContain('action=opensearch');
    expect(await client.readEncyclopedia('wikipedia_zh', '缺失', 500)).toEqual({ text: '', truncated: false, note: 'empty' });
  });
});
