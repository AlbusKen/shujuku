import { getHostRequestHeaders_ACU } from '../../data/gateways/ai-gateway';
import { WORLD_SIMULATION_WEB_PROVIDERS_ACU, type WorldSimulationWebProvider_ACU, type WorldSimulationWebResearchSettings_ACU } from './model';

export type WorldSimulationEncyclopediaSource_ACU = 'wikipedia_zh' | 'wikipedia_en' | 'moegirl';
export interface WorldSimulationWebHit_ACU { title: string; url: string; summary: string; }
export interface WorldSimulationFetchedText_ACU { text: string; truncated: boolean; note: string; }

const WIKI_ACU = { wikipedia_zh: 'https://zh.wikipedia.org', wikipedia_en: 'https://en.wikipedia.org', moegirl: 'https://zh.moegirl.org.cn' } as const;
const BLOCKED_ACU = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /\.local$/i, /^\[?::1\]?$/];
function decode_ACU(text: string): string { return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function clean_ACU(text: string): string { return decode_ACU(text.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function limited_ACU(text: string, limit: number): WorldSimulationFetchedText_ACU { const value = text.trim(); return { text: value.slice(0, limit), truncated: value.length > limit, note: value ? '' : 'empty' }; }
function parseSearxng_ACU(html: string): WorldSimulationWebHit_ACU[] {
  const hits: WorldSimulationWebHit_ACU[] = [];
  const blocks = html.split(/<article[^>]*class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const anchor = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = decode_ACU(anchor[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const summary = /<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    hits.push({ title: clean_ACU(anchor[2]), url, summary: clean_ACU(summary?.[1] ?? '') });
    if (hits.length >= 8) break;
  }
  return hits;
}
export function evaluateWorldSimulationWebUrl_ACU(raw: string, extra: string): string | null { let url: URL; try { url = new URL(raw); } catch { return 'invalid-url'; } if (!['http:', 'https:'].includes(url.protocol) || (url.port && !['80', '443'].includes(url.port))) return 'disallowed-url'; const host = url.hostname.toLowerCase(); if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || BLOCKED_ACU.some(pattern => pattern.test(host))) return 'blocked-host'; const list = extra.split(/[\s,，;；]+/).map(item => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean); return list.some(item => host === item || host.endsWith(`.${item}`)) ? 'blocked-domain' : null; }

export class WorldSimulationWebClient_ACU {
  constructor(private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}
  private async fetch_ACU(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try { return await this.fetcher(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
  }
  private async visit_ACU(url: string): Promise<{ ok: true; text: string } | { ok: false; note: string }> {
    try { const response = await this.fetch_ACU('/api/search/visit', { method: 'POST', headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' }, body: JSON.stringify({ url, html: true }) }); return response.ok ? { ok: true, text: await response.text() } : { ok: false, note: `http-${response.status}` }; } catch (error) { return { ok: false, note: error instanceof Error ? error.message : String(error) }; }
  }
  async searchEncyclopedia(source: WorldSimulationEncyclopediaSource_ACU, query: string): Promise<{ hits: WorldSimulationWebHit_ACU[]; note: string }> {
    const base = WIKI_ACU[source]; const trimmed = query.trim(); if (!trimmed) return { hits: [], note: 'empty-query' };
    const params = source === 'moegirl'
      ? new URLSearchParams({ action: 'opensearch', search: trimmed, limit: '6', format: 'json', origin: '*' })
      : new URLSearchParams({ action: 'query', list: 'search', srsearch: trimmed, srlimit: '6', format: 'json', origin: '*' });
    try {
      const response = await this.fetch_ACU(`${base}/api.php?${params}`); if (!response.ok) return { hits: [], note: `http-${response.status}` }; const data: any = await response.json();
      const raw = source === 'moegirl' ? (Array.isArray(data?.[1]) ? data[1].map((title: unknown) => ({ title })) : []) : (Array.isArray(data?.query?.search) ? data.query.search : []);
      const hits = raw.flatMap((item: any) => item?.title ? [{ title: String(item.title), url: `${base}/wiki/${encodeURIComponent(String(item.title).replace(/ /g, '_'))}`, summary: clean_ACU(String(item.snippet ?? '')) }] : []);
      return { hits, note: hits.length ? '' : 'empty' };
    } catch (error) { return { hits: [], note: error instanceof Error ? error.message : String(error) }; }
  }
  async readEncyclopedia(source: WorldSimulationEncyclopediaSource_ACU, title: string, limit: number): Promise<WorldSimulationFetchedText_ACU> {
    const base = WIKI_ACU[source]; const params = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: title, format: 'json', origin: '*' });
    try { const response = await this.fetch_ACU(`${base}/api.php?${params}`); if (!response.ok) return { text: '', truncated: false, note: `http-${response.status}` }; const data: any = await response.json(); const page: any = Object.values(data?.query?.pages ?? {})[0]; return limited_ACU(typeof page?.extract === 'string' ? page.extract : '', limit); } catch (error) { return { text: '', truncated: false, note: error instanceof Error ? error.message : String(error) }; }
  }
  async webSearch(query: string, settings: WorldSimulationWebResearchSettings_ACU): Promise<{ hits: WorldSimulationWebHit_ACU[]; note: string }> {
    const trimmed = query.trim(); if (!trimmed) return { hits: [], note: 'empty-query' };
    if (!(WORLD_SIMULATION_WEB_PROVIDERS_ACU as readonly string[]).includes(settings.searchProvider)) return { hits: [], note: 'invalid-provider' };
    if (settings.searchProvider === 'duckduckgo') {
      const visited = await this.visit_ACU(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`); if (visited.ok === false) return { hits: [], note: visited.note };
      const hits: WorldSimulationWebHit_ACU[] = []; const pattern = /class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//gi; let match: RegExpExecArray | null;
      while ((match = pattern.exec(visited.text)) && hits.length < 8) { const encoded = /[?&]uddg=([^&]+)/.exec(decode_ACU(match[1])); let url = decode_ACU(match[1]); if (encoded) try { url = decodeURIComponent(encoded[1]); } catch { /* keep original */ } if (/^https?:\/\//i.test(url)) hits.push({ title: clean_ACU(match[2]), url, summary: clean_ACU(match[3]) }); }
      return { hits, note: hits.length ? '' : 'empty' };
    }
    const endpoint = settings.searchProvider === 'searxng' ? '/api/search/searxng' : `/api/search/${settings.searchProvider}`;
    if (settings.searchProvider === 'searxng' && !settings.searxngBaseUrl.trim()) return { hits: [], note: 'searxng-unconfigured' };
    try {
      const response = await this.fetch_ACU(endpoint, { method: 'POST', headers: { ...getHostRequestHeaders_ACU(), 'Content-Type': 'application/json' }, body: JSON.stringify(settings.searchProvider === 'searxng' ? { baseUrl: settings.searxngBaseUrl.trim(), query: trimmed } : { query: trimmed }) });
      if (!response.ok) return { hits: [], note: `http-${response.status}` };
      if (settings.searchProvider === 'searxng') {
        const hits = parseSearxng_ACU(await response.text());
        return { hits, note: hits.length ? '' : 'empty' };
      }
      const data: any = await response.json(); const rows = Array.isArray(data?.organic) ? data.organic : Array.isArray(data?.results) ? data.results : []; const hits = rows.flatMap((item: any) => { const url = String(item?.link ?? item?.url ?? ''); return /^https?:\/\//i.test(url) ? [{ title: String(item?.title ?? ''), url, summary: String(item?.snippet ?? item?.content ?? '') }] : []; }).slice(0, 8); return { hits, note: hits.length ? '' : 'empty' };
    } catch (error) { return { hits: [], note: error instanceof Error ? error.message : String(error) }; }
  }
  async webRead(url: string, settings: WorldSimulationWebResearchSettings_ACU): Promise<WorldSimulationFetchedText_ACU> {
    const denied = evaluateWorldSimulationWebUrl_ACU(url, settings.blockedDomains); if (denied) return { text: '', truncated: false, note: denied };
    const visited = await this.visit_ACU(url); return visited.ok === true ? limited_ACU(clean_ACU(visited.text), settings.pageCharLimit) : { text: '', truncated: false, note: visited.note };
  }
}

export type { WorldSimulationWebProvider_ACU, WorldSimulationWebResearchSettings_ACU };
