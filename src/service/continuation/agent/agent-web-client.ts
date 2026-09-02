/**
 * service/continuation/agent/agent-web-client.ts — web-researcher 专用的出网客户端
 *
 * 四类能力：
 * - 百科检索 / 精读：维基百科与萌娘百科走 MediaWiki API（带 origin=* 的 CORS，浏览器直连）；
 *   百度百科没有 CORS 头，经酒馆服务器 `/api/search/visit`（html:false 原样透传）同源转发。
 * - 通用搜索：DuckDuckGo HTML 版经 /visit 抓页解析（免 key）；Serper / Tavily / SearXNG 复用
 *   酒馆自身「网页搜索」扩展已配置的 key 或实例，走 `/api/search/<provider>`。
 * - 任意网页抓取：经 /visit 抓 HTML，抽纯文本并按字数截断。
 *
 * 出网只发生在这里，且只由 web-researcher 调用。所有 URL 先过域名黑名单（内网、酒馆自身、
 * 用户追加），所有响应都截断到设置上限，所有失败都以文本结果返回而不是抛错——
 * 子代理要看到失败原因才能换词重搜，而不是让整次派工崩掉。
 */

import { getHostRequestHeaders_ACU } from '../../../data/gateways/ai-gateway';
import type { ContinuationWebResearchSettings_ACU, ContinuationWebSearchProvider_ACU } from '../model';
import type { AgentWebRefSource_ACU, AgentWebRefStatus_ACU } from './agent-model';

/** 百科来源（不含泛网页）。 */
export type AgentEncyclopediaSource_ACU = Exclude<AgentWebRefSource_ACU, 'web'>;

export const AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU: Record<AgentEncyclopediaSource_ACU, string> = {
  moegirl: '萌娘百科',
  wikipedia_zh: '中文维基百科',
  wikipedia_en: '英文维基百科',
  baidu: '百度百科',
};

/** 单次出网请求超时。百科 API 通常 1–3 秒；网页抓取给宽一点。 */
const WEB_REQUEST_TIMEOUT_MS_ACU = 20000;
/** 搜索结果条数上限：再多也只是让模型多花 token 挑选。 */
const SEARCH_RESULT_LIMIT_ACU = 8;
/** 百科检索候选条数上限。 */
const ENCYCLOPEDIA_CANDIDATE_LIMIT_ACU = 6;
/** 百度词条卡片 abstract 请求长度上限（该接口参数）。 */
const BAIDU_ABSTRACT_LENGTH_ACU = 3000;

const MEDIAWIKI_ENDPOINTS_ACU: Record<Exclude<AgentEncyclopediaSource_ACU, 'baidu'>, { api: string; page: string }> = {
  moegirl: { api: 'https://zh.moegirl.org.cn/api.php', page: 'https://zh.moegirl.org.cn/' },
  wikipedia_zh: { api: 'https://zh.wikipedia.org/w/api.php', page: 'https://zh.wikipedia.org/wiki/' },
  wikipedia_en: { api: 'https://en.wikipedia.org/w/api.php', page: 'https://en.wikipedia.org/wiki/' },
};

/** 始终拦截的主机模式：本机、内网、链路本地、.local 与酒馆自身。 */
const ALWAYS_BLOCKED_HOST_PATTERNS_ACU: readonly RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
];

/** 一条搜索结果。 */
export interface AgentWebSearchHit_ACU {
  title: string;
  url: string;
  snippet: string;
}

/** 一条百科候选词条。 */
export interface AgentEncyclopediaCandidate_ACU {
  source: AgentEncyclopediaSource_ACU;
  title: string;
  url: string;
  snippet: string;
}

/** 一次抓取到的页面。给子代理的工具结果与契约回填共用同一份对象。 */
export interface AgentFetchedPage_ACU {
  source: AgentWebRefSource_ACU;
  title: string;
  url: string;
  text: string;
  status: AgentWebRefStatus_ACU;
  /** 抓取失败或被拦时的原因，给模型看。 */
  note: string;
}

export interface AgentWebClientDependencies_ACU {
  fetch: typeof fetch;
  hostHeaders: () => Record<string, string>;
  now: () => number;
}

const defaultDependencies_ACU: AgentWebClientDependencies_ACU = {
  fetch: (input, init) => globalThis.fetch(input, init),
  hostHeaders: getHostRequestHeaders_ACU,
  now: () => Date.now(),
};

function decodeHtmlEntities_ACU(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags_ACU(html: string): string {
  // 百科页面的上标是引用角标（<sup>4</sup>），进正文只会变成噪音数字。
  const withoutSup = html.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');
  // 行内标签（加粗、链接、高亮）直接去掉，不能变成空格把一个词拆成两半；块级标签才换成空格。
  const withoutInline = withoutSup.replace(/<\/?(b|i|em|strong|span|a|mark|u|small|font|code)\b[^>]*>/gi, '');
  return decodeHtmlEntities_ACU(withoutInline.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * 折叠 MediaWiki extract 与网页正文里的空白：萌娘百科的模板表格会残留成片的制表符与空行。
 * 保留段落边界（双换行）以便按行编入搜索索引。
 */
export function collapseWhitespace_ACU(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把整页 HTML 抽成可读纯文本：去脚本样式导航，块级标签换行，去标签解实体，折叠空白。
 * 不追求 Readability 级别的正文提取——原文按字数截断后由模型自己挑重点。
 * @param html 页面 HTML
 * @returns { title, text }
 */
export function extractReadableText_ACU(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags_ACU(titleMatch[1]) : '';
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|dd|dt)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  const text = collapseWhitespace_ACU(decodeHtmlEntities_ACU(body.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' '));
  return { title, text };
}

/**
 * 截断到字数上限并标注；上限以内原样返回。
 */
export function truncateWebText_ACU(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n（原文超出 ${limit} 字上限，已截断；未展示部分不代表不存在）`;
}

/**
 * 解析用户追加的域名黑名单：逗号 / 换行 / 空白分隔，小写，去掉协议与路径。
 */
export function parseBlockedDomains_ACU(raw: string): string[] {
  return String(raw ?? '')
    .split(/[\n,，;；\s]+/)
    .map(item => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
}

/**
 * 判定 URL 是否允许抓取。
 * @returns 允许时返回 null；否则返回拒绝原因
 */
export function evaluateWebUrlPolicy_ACU(rawUrl: string, blockedDomains: readonly string[], hostOrigin?: string): string | null {
  let url: URL;
  try {
    url = new URL(String(rawUrl ?? '').trim());
  } catch {
    return 'URL 格式非法（必须是完整的 http(s) 地址）';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '只允许 http / https 协议';
  if (url.port && url.port !== '80' && url.port !== '443') return '不允许非标准端口';
  const host = url.hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return '不允许直接访问 IP 地址';
  if (ALWAYS_BLOCKED_HOST_PATTERNS_ACU.some(pattern => pattern.test(host))) return '内网或本机地址被拦截';
  if (hostOrigin) {
    try {
      if (new URL(hostOrigin).hostname.toLowerCase() === host) return '不允许抓取酒馆服务器自身';
    } catch { /* 宿主 origin 不可解析时忽略该项 */ }
  }
  for (const blocked of blockedDomains) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return `域名 ${host} 在黑名单内`;
  }
  return null;
}

function encyclopediaPageUrl_ACU(source: AgentEncyclopediaSource_ACU, title: string): string {
  if (source === 'baidu') return `https://baike.baidu.com/item/${encodeURIComponent(title)}`;
  return `${MEDIAWIKI_ENDPOINTS_ACU[source].page}${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** 客户端实例。无状态：页面缓存由子代理运行时按派工持有。 */
export class AgentWebClient_ACU {
  constructor(private readonly dependencies: AgentWebClientDependencies_ACU = defaultDependencies_ACU) {}

  /** 直连 fetch（百科 API），带超时。 */
  private async fetchDirect_ACU(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_REQUEST_TIMEOUT_MS_ACU);
    try {
      return await this.dependencies.fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 经酒馆服务器 /api/search/visit 同源转发。html=true 只接受 text/html 并返回正文；
   * html=false 原样透传任意 content-type（百度 openapi 的 JSON 就靠这个）。
   */
  private async visitViaHost_ACU(url: string, html: boolean): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
    try {
      const response = await this.fetchDirect_ACU('/api/search/visit', {
        method: 'POST',
        headers: { ...this.dependencies.hostHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, html }),
      });
      if (!response.ok) {
        return { ok: false, reason: response.status === 400 ? '酒馆服务器拒绝了该 URL（格式、端口或 IP 直连不被允许）' : `酒馆服务器转发失败（HTTP ${response.status}）：目标站点可能拒绝访问、返回了非 HTML 内容或需要登录` };
      }
      return { ok: true, text: await response.text() };
    } catch (error) {
      return { ok: false, reason: `酒馆服务器转发请求异常：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async fetchMediawikiJson_ACU(source: Exclude<AgentEncyclopediaSource_ACU, 'baidu'>, params: Record<string, string>): Promise<{ ok: true; data: any } | { ok: false; reason: string }> {
    const search = new URLSearchParams({ ...params, format: 'json', origin: '*', utf8: '1' });
    const url = `${MEDIAWIKI_ENDPOINTS_ACU[source].api}?${search.toString()}`;
    try {
      const response = await this.fetchDirect_ACU(url, { method: 'GET' });
      if (!response.ok) return { ok: false, reason: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 返回 HTTP ${response.status}` };
      const data = await response.json();
      if (data && typeof data === 'object' && data.error) {
        return { ok: false, reason: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} API 错误：${String(data.error.info ?? data.error.code ?? '未知')}` };
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, reason: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 请求失败（网络不可达或被浏览器拦截）：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 在一个百科来源里检索候选词条。
   * 萌娘百科关闭了 list=search，改用 opensearch（前缀匹配，返回标题与链接）；维基用全文 search。
   */
  async searchEncyclopedia(source: AgentEncyclopediaSource_ACU, query: string): Promise<{ candidates: AgentEncyclopediaCandidate_ACU[]; note: string }> {
    const trimmed = query.trim();
    if (!trimmed) return { candidates: [], note: '检索词为空' };
    if (source === 'baidu') {
      // 百度没有公开的检索接口，词条卡片按精确名称命中；命中即视为唯一候选。
      const card = await this.fetchBaiduCard_ACU(trimmed);
      if (card.ok === false) return { candidates: [], note: card.reason };
      return { candidates: [{ source, title: card.title, url: card.url, snippet: card.desc }], note: '' };
    }
    if (source === 'moegirl') {
      const result = await this.fetchMediawikiJson_ACU(source, { action: 'opensearch', search: trimmed, limit: String(ENCYCLOPEDIA_CANDIDATE_LIMIT_ACU), redirects: 'resolve' });
      if (result.ok === false) return { candidates: [], note: result.reason };
      const titles: unknown = Array.isArray(result.data) ? result.data[1] : [];
      const urls: unknown = Array.isArray(result.data) ? result.data[3] : [];
      const list = Array.isArray(titles) ? titles : [];
      const candidates = list.map((title, index) => ({
        source,
        title: String(title),
        url: Array.isArray(urls) && typeof urls[index] === 'string' ? urls[index] : encyclopediaPageUrl_ACU(source, String(title)),
        snippet: '',
      }));
      return { candidates, note: candidates.length ? '' : '萌娘百科 opensearch 无候选（它按标题前缀匹配，试试角色全名、作品名或去掉修饰词）' };
    }
    const result = await this.fetchMediawikiJson_ACU(source, { action: 'query', list: 'search', srsearch: trimmed, srlimit: String(ENCYCLOPEDIA_CANDIDATE_LIMIT_ACU) });
    if (result.ok === false) return { candidates: [], note: result.reason };
    const hits: unknown = result.data?.query?.search;
    const candidates = (Array.isArray(hits) ? hits : []).flatMap(hit => {
      const title = typeof hit?.title === 'string' ? hit.title : '';
      return title ? [{ source, title, url: encyclopediaPageUrl_ACU(source, title), snippet: stripTags_ACU(String(hit.snippet ?? '')) }] : [];
    });
    return { candidates, note: candidates.length ? '' : `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 无命中` };
  }

  /**
   * 精读一个百科词条的纯文本正文。
   * @param source 百科来源
   * @param title 词条标题（可来自 searchEncyclopedia 的候选）
   * @param charLimit 原文字数上限
   */
  async readEncyclopedia(source: AgentEncyclopediaSource_ACU, title: string, charLimit: number): Promise<AgentFetchedPage_ACU> {
    const trimmed = title.trim();
    const url = encyclopediaPageUrl_ACU(source, trimmed);
    if (!trimmed) return { source, title: '', url, text: '', status: 'unavailable', note: '词条标题为空' };
    if (source === 'baidu') {
      const card = await this.fetchBaiduCard_ACU(trimmed);
      if (card.ok === false) return { source, title: trimmed, url, text: '', status: 'unavailable', note: card.reason };
      return { source, title: card.title, url: card.url, text: truncateWebText_ACU(card.text, charLimit), status: 'ok', note: '' };
    }
    const result = await this.fetchMediawikiJson_ACU(source, { action: 'query', prop: 'extracts', explaintext: '1', exlimit: '1', exsectionformat: 'plain', redirects: '1', titles: trimmed });
    if (result.ok === false) return { source, title: trimmed, url, text: '', status: 'unavailable', note: result.reason };
    const pages = result.data?.query?.pages;
    const page = pages && typeof pages === 'object' ? Object.values(pages as Record<string, any>)[0] : null;
    if (!page || page.missing !== undefined || typeof page.extract !== 'string') {
      return { source, title: trimmed, url, text: '', status: 'unavailable', note: `${AGENT_ENCYCLOPEDIA_SOURCE_LABELS_ACU[source]} 没有名为「${trimmed}」的词条；先用 encyclopedia_search 找准确标题` };
    }
    const resolvedTitle = typeof page.title === 'string' && page.title ? page.title : trimmed;
    const text = collapseWhitespace_ACU(page.extract);
    if (!text) return { source, title: resolvedTitle, url: encyclopediaPageUrl_ACU(source, resolvedTitle), text: '', status: 'unavailable', note: '词条存在但正文为空（可能是消歧义页或纯模板页）' };
    return { source, title: resolvedTitle, url: encyclopediaPageUrl_ACU(source, resolvedTitle), text: truncateWebText_ACU(text, charLimit), status: 'ok', note: '' };
  }

  /** 百度百科词条卡片（旧版 openapi，无 CORS，经酒馆转发）。 */
  private async fetchBaiduCard_ACU(key: string): Promise<{ ok: true; title: string; url: string; desc: string; text: string } | { ok: false; reason: string }> {
    const api = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(key)}&bk_length=${BAIDU_ABSTRACT_LENGTH_ACU}`;
    const visited = await this.visitViaHost_ACU(api, false);
    if (visited.ok === false) return { ok: false, reason: `百度百科不可用：${visited.reason}` };
    let data: any;
    try {
      data = JSON.parse(visited.text);
    } catch {
      return { ok: false, reason: '百度百科返回了非 JSON 内容（接口可能已变更或触发了验证）' };
    }
    if (!data || typeof data !== 'object' || (!data.title && !data.abstract)) {
      const message = typeof data?.errmsg === 'string' ? data.errmsg : '无此词条';
      return { ok: false, reason: `百度百科无命中「${key}」：${message}。百度只按精确词条名匹配，试试角色全名或作品内译名` };
    }
    const title = String(data.title ?? key);
    const url = typeof data.url === 'string' && data.url ? String(data.url).replace(/^http:/, 'https:') : encyclopediaPageUrl_ACU('baidu', title);
    const desc = stripTags_ACU(String(data.desc ?? ''));
    const cardLines: string[] = [];
    if (Array.isArray(data.card)) {
      for (const item of data.card) {
        const name = stripTags_ACU(String(item?.name ?? ''));
        const values = Array.isArray(item?.value) ? item.value.map((value: unknown) => stripTags_ACU(String(value ?? ''))).filter(Boolean) : [];
        if (name && values.length) cardLines.push(`${name}：${values.join('、')}`);
      }
    }
    const abstract = collapseWhitespace_ACU(stripTags_ACU(String(data.abstract ?? '')));
    const text = [desc ? `简介：${desc}` : '', cardLines.length ? `【词条卡片】\n${cardLines.join('\n')}` : '', abstract ? `【概述】\n${abstract}` : ''].filter(Boolean).join('\n\n');
    return { ok: true, title, url, desc, text };
  }

  /**
   * 通用网页搜索。
   * @param query 检索词
   * @param settings 网页检索设置（提供方与 SearXNG 地址）
   */
  async webSearch(query: string, settings: Pick<ContinuationWebResearchSettings_ACU, 'searchProvider' | 'searxngBaseUrl'>): Promise<{ hits: AgentWebSearchHit_ACU[]; note: string }> {
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], note: '检索词为空' };
    const provider: ContinuationWebSearchProvider_ACU = settings.searchProvider;
    if (provider === 'duckduckgo') return this.searchDuckDuckGo_ACU(trimmed);
    if (provider === 'searxng') return this.searchSearxng_ACU(trimmed, settings.searxngBaseUrl);
    return this.searchViaHostProvider_ACU(provider, trimmed);
  }

  private async searchDuckDuckGo_ACU(query: string): Promise<{ hits: AgentWebSearchHit_ACU[]; note: string }> {
    const visited = await this.visitViaHost_ACU(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, true);
    if (visited.ok === false) return { hits: [], note: `DuckDuckGo 不可用：${visited.reason}` };
    return { hits: parseDuckDuckGoHtml_ACU(visited.text), note: '' };
  }

  private async searchSearxng_ACU(query: string, baseUrl: string): Promise<{ hits: AgentWebSearchHit_ACU[]; note: string }> {
    if (!baseUrl.trim()) return { hits: [], note: 'SearXNG 实例地址未配置（续写设置 → 网页检索）' };
    try {
      const response = await this.fetchDirect_ACU('/api/search/searxng', {
        method: 'POST',
        headers: { ...this.dependencies.hostHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), query }),
      });
      if (!response.ok) return { hits: [], note: `SearXNG 请求失败（HTTP ${response.status}）` };
      return { hits: parseSearxngHtml_ACU(await response.text()), note: '' };
    } catch (error) {
      return { hits: [], note: `SearXNG 请求异常：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async searchViaHostProvider_ACU(provider: 'serper' | 'tavily', query: string): Promise<{ hits: AgentWebSearchHit_ACU[]; note: string }> {
    try {
      const response = await this.fetchDirect_ACU(`/api/search/${provider}`, {
        method: 'POST',
        headers: { ...this.dependencies.hostHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (response.status === 400) return { hits: [], note: `${provider} 未在酒馆里配置 API key（酒馆设置 → API 密钥）` };
      if (!response.ok) return { hits: [], note: `${provider} 请求失败（HTTP ${response.status}）` };
      const data: any = await response.json();
      const hits: AgentWebSearchHit_ACU[] = [];
      if (provider === 'serper') {
        for (const item of Array.isArray(data?.organic) ? data.organic : []) {
          if (typeof item?.link === 'string') hits.push({ title: String(item.title ?? ''), url: item.link, snippet: String(item.snippet ?? '') });
        }
        if (data?.answerBox?.snippet) hits.unshift({ title: String(data.answerBox.title ?? '精选摘要'), url: String(data.answerBox.link ?? ''), snippet: String(data.answerBox.snippet) });
      } else {
        for (const item of Array.isArray(data?.results) ? data.results : []) {
          if (typeof item?.url === 'string') hits.push({ title: String(item.title ?? ''), url: item.url, snippet: String(item.content ?? '') });
        }
        if (typeof data?.answer === 'string' && data.answer.trim()) hits.unshift({ title: 'Tavily 综合回答', url: '', snippet: data.answer.trim() });
      }
      return { hits: hits.slice(0, SEARCH_RESULT_LIMIT_ACU), note: '' };
    } catch (error) {
      return { hits: [], note: `${provider} 请求异常：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 抓取任意网页并抽纯文本。
   * @param url 目标地址
   * @param settings 黑名单与字数上限
   * @param hostOrigin 酒馆自身 origin，用于拒绝抓自己
   */
  async webRead(url: string, settings: Pick<ContinuationWebResearchSettings_ACU, 'blockedDomains' | 'pageCharLimit'>, hostOrigin?: string): Promise<AgentFetchedPage_ACU> {
    const trimmed = String(url ?? '').trim();
    const denied = evaluateWebUrlPolicy_ACU(trimmed, parseBlockedDomains_ACU(settings.blockedDomains), hostOrigin);
    if (denied) return { source: 'web', title: '', url: trimmed, text: '', status: 'blocked', note: denied };
    const visited = await this.visitViaHost_ACU(trimmed, true);
    if (visited.ok === false) return { source: 'web', title: '', url: trimmed, text: '', status: 'unavailable', note: visited.reason };
    const extracted = extractReadableText_ACU(visited.text);
    if (!extracted.text) return { source: 'web', title: extracted.title, url: trimmed, text: '', status: 'unavailable', note: '页面没有可读文本（可能是纯脚本渲染的页面）' };
    return { source: 'web', title: extracted.title || trimmed, url: trimmed, text: truncateWebText_ACU(extracted.text, settings.pageCharLimit), status: 'ok', note: '' };
  }
}

/** 解析 DuckDuckGo HTML 版结果页：`result__a` 是标题链接（带 uddg 跳转参数），`result__snippet` 是摘要。 */
export function parseDuckDuckGoHtml_ACU(html: string): AgentWebSearchHit_ACU[] {
  const hits: AgentWebSearchHit_ACU[] = [];
  const blocks = html.split(/<div[^>]*class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const anchor = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const snippetMatch = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const href = decodeHtmlEntities_ACU(anchor[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    let url = href;
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch { url = href; }
    } else if (url.startsWith('//')) {
      url = `https:${url}`;
    }
    if (!/^https?:\/\//i.test(url)) continue;
    hits.push({ title: stripTags_ACU(anchor[2]), url, snippet: stripTags_ACU(snippetMatch?.[1] ?? snippetMatch?.[2] ?? '') });
    if (hits.length >= SEARCH_RESULT_LIMIT_ACU) break;
  }
  return hits;
}

/** 解析 SearXNG 结果页：`article.result` 内 `h3 > a` 为标题链接，`p.content` 为摘要。 */
export function parseSearxngHtml_ACU(html: string): AgentWebSearchHit_ACU[] {
  const hits: AgentWebSearchHit_ACU[] = [];
  const blocks = html.split(/<article[^>]*class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const anchor = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = decodeHtmlEntities_ACU(anchor[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const content = /<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    hits.push({ title: stripTags_ACU(anchor[2]), url, snippet: stripTags_ACU(content?.[1] ?? '') });
    if (hits.length >= SEARCH_RESULT_LIMIT_ACU) break;
  }
  return hits;
}

/** 按设置得到启用的百科来源列表；全部关闭时返回空数组，由调用方给出提示。 */
export function enabledEncyclopediaSources_ACU(settings: Pick<ContinuationWebResearchSettings_ACU, 'sources'>): AgentEncyclopediaSource_ACU[] {
  const list: AgentEncyclopediaSource_ACU[] = [];
  if (settings.sources.moegirl) list.push('moegirl');
  if (settings.sources.wikipediaZh) list.push('wikipedia_zh');
  if (settings.sources.wikipediaEn) list.push('wikipedia_en');
  if (settings.sources.baidu) list.push('baidu');
  return list;
}
