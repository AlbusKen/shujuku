import { getLorebookEntriesRequired_ACU, isWorldbookApiAvailable_ACU, listLorebooks_ACU } from '../../data/gateways/worldbook-gateway';
import type { WorldSimulationWebResearchSettings_ACU } from './model';
import { createWorldSimulationToolDependencies_ACU, type WorldSimulationToolContext_ACU, type WorldSimulationToolReadResult_ACU, type WorldSimulationToolSearchResult_ACU } from './world-simulation-agent-tools';
import { WorldSimulationWebClient_ACU, type WorldSimulationEncyclopediaSource_ACU } from './world-simulation-web-client';

const text_ACU = (value: unknown): string => typeof value === 'string' ? value : '';
const encode_ACU = (value: unknown): string => encodeURIComponent(String(value ?? ''));
const decode_ACU = (value: string): string => { try { return decodeURIComponent(value); } catch { return ''; } };
const content_ACU = (entry: any): string => [entry?.comment, entry?.name, entry?.content, entry?.text].map(text_ACU).filter(Boolean).join('\n');
const encyclopediaSourceEnabled_ACU = (
  settings: WorldSimulationWebResearchSettings_ACU,
  source: WorldSimulationEncyclopediaSource_ACU,
): boolean => source === 'moegirl'
  ? settings.sources.moegirl
  : source === 'wikipedia_zh'
    ? settings.sources.wikipediaZh
    : settings.sources.wikipediaEn;

export interface WorldSimulationHostToolContext_ACU extends WorldSimulationToolContext_ACU { webResearch: WorldSimulationWebResearchSettings_ACU; webClient?: Pick<WorldSimulationWebClient_ACU, 'searchEncyclopedia' | 'readEncyclopedia' | 'webSearch' | 'webRead'>; }

export function createWorldSimulationHostToolDependencies_ACU(context: WorldSimulationHostToolContext_ACU) {
  const client = context.webClient ?? new WorldSimulationWebClient_ACU();
  const externalRead = async (address: string): Promise<WorldSimulationToolReadResult_ACU> => {
    if (address.startsWith('worldbook:entry:')) {
      return { status: 'failed', summary: '世界书条目全文已按关键词触发注入。不要 read worldbook:entry。如果触发内容不够，用 search，scope 包含 worldbook，在全部世界书内容里按关键词检索。' };
    }
    if (address.startsWith('encyclopedia:entry:')) {
      if (!context.webResearch.enabled) return { status: 'dependency_unavailable', summary: 'web research disabled' };
      const [sourcePart, ...titleParts] = address.slice('encyclopedia:entry:'.length).split(':'); const source = sourcePart as WorldSimulationEncyclopediaSource_ACU; const title = decode_ACU(titleParts.join(':'));
      if (!['moegirl', 'wikipedia_zh', 'wikipedia_en'].includes(source) || !title) return { status: 'failed', summary: 'invalid encyclopedia address' };
      if (!encyclopediaSourceEnabled_ACU(context.webResearch, source)) return { status: 'dependency_unavailable', summary: `encyclopedia source disabled: ${source}` };
      const page = await client.readEncyclopedia(source, title, context.webResearch.pageCharLimit); return page.text ? { status: 'ok', content: page.text, summary: title, exact: true, truncated: page.truncated } : { status: page.note === 'empty' ? 'empty' : 'failed', summary: page.note };
    }
    if (address.startsWith('web:url:')) {
      if (!context.webResearch.enabled) return { status: 'dependency_unavailable', summary: 'web research disabled' };
      const url = decode_ACU(address.slice('web:url:'.length)); if (!url) return { status: 'failed', summary: 'invalid web address' };
      const page = await client.webRead(url, context.webResearch); return page.text ? { status: 'ok', content: page.text, summary: url, exact: true, truncated: page.truncated } : { status: page.note === 'empty' ? 'empty' : 'failed', summary: page.note };
    }
    return { status: 'dependency_unavailable', summary: 'unknown external address' };
  };
  const externalSearch = async (query: string, scope: readonly string[], maxResults: number, isRegex: boolean): Promise<WorldSimulationToolSearchResult_ACU> => {
    if (!query.trim()) return { status: 'empty', hits: [], summary: 'empty query' };
    const selected = scope.length ? new Set(scope) : new Set(['worldbook', 'encyclopedia', 'web']); const hits: Array<{ address: string; summary: string }> = [];
    const diagnostics: string[] = [];
    let sawFailed = false;
    let sawDependencyUnavailable = false;
    if (selected.has('worldbook')) {
      if (!isWorldbookApiAvailable_ACU()) { sawDependencyUnavailable = true; diagnostics.push('worldbook api unavailable'); }
      else try { const matcher = isRegex ? new RegExp(query, 'i') : null; for (const book of await listLorebooks_ACU()) for (const entry of await getLorebookEntriesRequired_ACU(book)) { const value = content_ACU(entry); const matched = matcher ? matcher.exec(value) : null; const plainIndex = matcher ? -1 : value.toLowerCase().indexOf(query.toLowerCase()); if (matcher ? matched : plainIndex >= 0) { const at = matcher ? (matched?.index ?? 0) : plainIndex; const flat = value.replace(/\s+/g, ' ').trim(); const start = Math.max(0, at - 40); const slice = flat.slice(start, start + 160); const excerpt = `${start > 0 ? '…' : ''}${slice}${start + 160 < flat.length ? '…' : ''}`; hits.push({ address: `worldbook:entry:${encode_ACU(book)}:${encode_ACU(entry?.uid)}`, summary: `${book}#${String(entry?.uid ?? '')}｜${excerpt}` }); } if (hits.length >= maxResults) break; } } catch (error) { sawFailed = true; diagnostics.push(error instanceof Error ? error.message : String(error)); }
    }
    if (selected.has('encyclopedia')) {
      if (!context.webResearch.enabled) { sawDependencyUnavailable = true; diagnostics.push('web research disabled'); }
      else for (const [enabled, source] of [[context.webResearch.sources.moegirl, 'moegirl'], [context.webResearch.sources.wikipediaZh, 'wikipedia_zh'], [context.webResearch.sources.wikipediaEn, 'wikipedia_en']] as const) if (enabled) { const result = await client.searchEncyclopedia(source, query); for (const hit of result.hits) hits.push({ address: `encyclopedia:entry:${source}:${encode_ACU(hit.title)}`, summary: hit.summary || hit.title }); if (!result.hits.length && result.note && result.note !== 'empty') { sawFailed = true; diagnostics.push(`${source}:${result.note}`); } }
    }
    if (selected.has('web')) {
      if (!context.webResearch.enabled) { sawDependencyUnavailable = true; diagnostics.push('web research disabled'); }
      else { const result = await client.webSearch(query, context.webResearch); for (const hit of result.hits) hits.push({ address: `web:url:${encode_ACU(hit.url)}`, summary: hit.summary || hit.title }); if (!result.hits.length && result.note && result.note !== 'empty') { sawFailed = true; diagnostics.push(`web:${result.note}`); } }
    }
    if (hits.length) return { status: 'ok', hits: hits.slice(0, maxResults), summary: diagnostics.join('; ') };
    if (sawFailed) return { status: 'failed', hits: [], summary: diagnostics.join('; ') };
    if (sawDependencyUnavailable) return { status: 'dependency_unavailable', hits: [], summary: diagnostics.join('; ') };
    return { status: 'empty', hits: [], summary: 'no results' };
  };
  return createWorldSimulationToolDependencies_ACU({ ...context, externalRead, externalSearch });
}
