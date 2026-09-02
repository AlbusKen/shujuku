import { describe, expect, it, vi } from 'vitest';

import {
  AgentWebClient_ACU,
  collapseWhitespace_ACU,
  enabledEncyclopediaSources_ACU,
  evaluateWebUrlPolicy_ACU,
  extractReadableText_ACU,
  parseBlockedDomains_ACU,
  parseDuckDuckGoHtml_ACU,
  parseSearxngHtml_ACU,
  truncateWebText_ACU,
} from '../../../../src/service/continuation/agent/agent-web-client';

function jsonResponse_ACU(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse_ACU(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function client_ACU(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { client: AgentWebClient_ACU; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  return { client: new AgentWebClient_ACU({ fetch: fetch as unknown as typeof globalThis.fetch, hostHeaders: () => ({ 'X-CSRF-Token': 't' }), now: () => 1 }), fetch };
}

describe('URL 策略与文本处理', () => {
  it('拒绝非 http、IP 直连、内网、酒馆自身与黑名单域名', () => {
    const blocked = parseBlockedDomains_ACU('example.com, https://bad.org/path\nfoo.net');
    expect(blocked).toEqual(['example.com', 'bad.org', 'foo.net']);
    expect(evaluateWebUrlPolicy_ACU('ftp://x.org/a', blocked)).toContain('http');
    expect(evaluateWebUrlPolicy_ACU('http://127.0.0.1/a', blocked)).toContain('IP');
    expect(evaluateWebUrlPolicy_ACU('http://localhost/a', blocked)).toContain('内网');
    expect(evaluateWebUrlPolicy_ACU('http://router.local/', blocked)).toContain('内网');
    expect(evaluateWebUrlPolicy_ACU('https://my.tavern.host/api', blocked, 'https://my.tavern.host:8000')).toContain('酒馆');
    expect(evaluateWebUrlPolicy_ACU('https://sub.example.com/x', blocked)).toContain('黑名单');
    expect(evaluateWebUrlPolicy_ACU('https://zh.moegirl.org.cn/x', blocked)).toBeNull();
    expect(evaluateWebUrlPolicy_ACU('not a url', blocked)).toContain('非法');
  });

  it('HTML 抽纯文本：去脚本样式导航、块级换行、解实体、折叠空白', () => {
    const html = '<html><head><title>测试&amp;页</title><style>p{}</style></head><body><nav>菜单</nav><script>var a=1;</script><h1>标题</h1><p>第一段&nbsp;内容</p><div>第二段</div></body></html>';
    const result = extractReadableText_ACU(html);
    expect(result.title).toBe('测试&页');
    expect(result.text).toBe('标题\n第一段 内容\n第二段');
    expect(result.text).not.toContain('菜单');
    expect(result.text).not.toContain('var a');
  });

  it('折叠萌娘百科 extract 里成片的制表符与空行，保留段落边界', () => {
    expect(collapseWhitespace_ACU('简介\n\t\t\n\t\t\t\n\n\n经历\n  外貌  金发')).toBe('简介\n\n经历\n外貌 金发');
  });

  it('截断超出上限的原文并标注', () => {
    expect(truncateWebText_ACU('短文', 10)).toBe('短文');
    const long = truncateWebText_ACU('一二三四五六七八九十一二', 10);
    expect(long.startsWith('一二三四五六七八九十')).toBe(true);
    expect(long).toContain('已截断');
  });

  it('按设置得到启用的百科来源', () => {
    expect(enabledEncyclopediaSources_ACU({ sources: { moegirl: true, wikipediaZh: false, wikipediaEn: true, baidu: false } })).toEqual(['moegirl', 'wikipedia_en']);
  });
});

describe('搜索结果解析', () => {
  it('DuckDuckGo HTML：解 uddg 跳转参数得到真实 URL，取标题与摘要', () => {
    const html = [
      '<div class="result results_links results_links_deep web-result ">',
      '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzh.moegirl.org.cn%2F%E9%B2%81%E8%BF%AA&amp;rut=abc">鲁迪乌斯 - 萌娘百科</a>',
      '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">《无职转生》<b>主角</b></a>',
      '</div>',
      '<div class="result results_links"><a class="result__a" href="https://example.org/direct">直链</a></div>',
    ].join('');
    const hits = parseDuckDuckGoHtml_ACU(html);
    expect(hits).toEqual([
      { title: '鲁迪乌斯 - 萌娘百科', url: 'https://zh.moegirl.org.cn/鲁迪', snippet: '《无职转生》主角' },
      { title: '直链', url: 'https://example.org/direct', snippet: '' },
    ]);
  });

  it('SearXNG HTML：article.result 里的 h3 链接与 p.content', () => {
    const html = '<article class="result result-default"><h3><a href="https://a.org/1">标题一</a></h3><p class="content">摘要一</p></article><article class="result"><h3><a href="javascript:void(0)">坏链</a></h3></article>';
    expect(parseSearxngHtml_ACU(html)).toEqual([{ title: '标题一', url: 'https://a.org/1', snippet: '摘要一' }]);
  });
});

describe('AgentWebClient_ACU 百科通道', () => {
  it('萌娘百科用 opensearch 找候选，用 extracts 精读并折叠空白', async () => {
    const { client, fetch } = client_ACU(url => {
      if (url.includes('action=opensearch')) return jsonResponse_ACU(['鲁迪', ['鲁迪乌斯·格雷拉特'], [''], ['https://zh.moegirl.org.cn/%E9%B2%81']]);
      if (url.includes('prop=extracts')) return jsonResponse_ACU({ query: { pages: { 1: { pageid: 1, title: '鲁迪乌斯·格雷拉特', extract: '鲁迪乌斯是主角。\n\n\t\t\n简介\n转生者。' } } } });
      throw new Error(`unexpected ${url}`);
    });
    const search = await client.searchEncyclopedia('moegirl', '鲁迪');
    expect(search.candidates).toEqual([{ source: 'moegirl', title: '鲁迪乌斯·格雷拉特', url: 'https://zh.moegirl.org.cn/%E9%B2%81', snippet: '' }]);
    const page = await client.readEncyclopedia('moegirl', '鲁迪乌斯·格雷拉特', 4000);
    expect(page.status).toBe('ok');
    expect(page.text).toBe('鲁迪乌斯是主角。\n\n简介\n转生者。');
    expect(page.url).toContain('zh.moegirl.org.cn/');
    // 直连百科 API 必须带 origin=* 才有 CORS 头。
    expect(String(fetch.mock.calls[0][0])).toContain('origin=*');
  });

  it('维基百科 list=search 无命中与词条缺失都以说明文本返回而不抛错', async () => {
    const { client } = client_ACU(url => {
      if (url.includes('list=search')) return jsonResponse_ACU({ query: { search: [] } });
      if (url.includes('prop=extracts')) return jsonResponse_ACU({ query: { pages: { '-1': { title: '不存在', missing: '' } } } });
      throw new Error(`unexpected ${url}`);
    });
    const search = await client.searchEncyclopedia('wikipedia_zh', '不存在');
    expect(search.candidates).toEqual([]);
    expect(search.note).toContain('无命中');
    const page = await client.readEncyclopedia('wikipedia_zh', '不存在', 4000);
    expect(page.status).toBe('unavailable');
    expect(page.note).toContain('encyclopedia_search');
  });

  it('百度百科经酒馆 /api/search/visit 以 html:false 透传 JSON，并带宿主请求头', async () => {
    const { client, fetch } = client_ACU((url, init) => {
      if (url === '/api/search/visit') {
        const body = JSON.parse(String(init?.body));
        expect(body.html).toBe(false);
        expect(body.url).toContain('baike.baidu.com/api/openapi/BaikeLemmaCardApi');
        expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('t');
        return textResponse_ACU(JSON.stringify({ title: '鲁迪乌斯·格雷拉特', desc: '轻小说男主角', url: 'http://baike.baidu.com/item/x', card: [{ name: '别名', value: ['鲁迪<sup>1</sup>', '泥沼'] }], abstract: '前世是尼特。' }), 200, 'application/json');
      }
      throw new Error(`unexpected ${url}`);
    });
    const page = await client.readEncyclopedia('baidu', '鲁迪乌斯·格雷拉特', 4000);
    expect(page.status).toBe('ok');
    expect(page.url).toBe('https://baike.baidu.com/item/x');
    expect(page.text).toContain('简介：轻小说男主角');
    expect(page.text).toContain('别名：鲁迪、泥沼');
    expect(page.text).toContain('【概述】\n前世是尼特。');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('酒馆转发失败时百度返回 unavailable 且说明原因', async () => {
    const { client } = client_ACU(() => textResponse_ACU('', 500));
    const page = await client.readEncyclopedia('baidu', 'x', 4000);
    expect(page.status).toBe('unavailable');
    expect(page.note).toContain('酒馆服务器转发失败');
  });
});

describe('AgentWebClient_ACU 通用搜索与网页抓取', () => {
  it('DuckDuckGo 经 /visit 抓 HTML 解析结果', async () => {
    const { client } = client_ACU((url, init) => {
      expect(url).toBe('/api/search/visit');
      expect(JSON.parse(String(init?.body)).url).toContain('html.duckduckgo.com/html/?q=');
      return textResponse_ACU('<div class="result"><a class="result__a" href="https://a.org/x">A</a><a class="result__snippet">s</a></div>');
    });
    const result = await client.webSearch('q', { searchProvider: 'duckduckgo', searxngBaseUrl: '' });
    expect(result.hits).toEqual([{ title: 'A', url: 'https://a.org/x', snippet: 's' }]);
  });

  it('Serper 走酒馆 /api/search/serper；400 表示酒馆未配 key', async () => {
    const { client } = client_ACU(url => (url === '/api/search/serper' ? jsonResponse_ACU({ organic: [{ title: 'T', link: 'https://b.org', snippet: 'S' }] }) : textResponse_ACU('', 404)));
    const ok = await client.webSearch('q', { searchProvider: 'serper', searxngBaseUrl: '' });
    expect(ok.hits).toEqual([{ title: 'T', url: 'https://b.org', snippet: 'S' }]);
    const { client: noKey } = client_ACU(() => textResponse_ACU('', 400));
    const missing = await noKey.webSearch('q', { searchProvider: 'serper', searxngBaseUrl: '' });
    expect(missing.hits).toEqual([]);
    expect(missing.note).toContain('未在酒馆里配置');
  });

  it('SearXNG 未填地址时给出可操作提示', async () => {
    const { client, fetch } = client_ACU(() => textResponse_ACU(''));
    const result = await client.webSearch('q', { searchProvider: 'searxng', searxngBaseUrl: '' });
    expect(result.note).toContain('SearXNG 实例地址未配置');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('web_read 先过域名策略再经 /visit 抓 HTML，抽文本并截断', async () => {
    const { client, fetch } = client_ACU(() => textResponse_ACU('<html><title>页</title><body><p>正文一</p><p>正文二</p></body></html>'));
    const blocked = await client.webRead('http://192.168.1.1/admin', { blockedDomains: '', pageCharLimit: 100 });
    expect(blocked.status).toBe('blocked');
    expect(fetch).not.toHaveBeenCalled();
    const page = await client.webRead('https://fandom.example/wiki/X', { blockedDomains: '', pageCharLimit: 5 });
    expect(page.status).toBe('ok');
    expect(page.title).toBe('页');
    expect(page.text.startsWith('正文一\n正')).toBe(true);
    expect(page.text).toContain('已截断');
  });
});
