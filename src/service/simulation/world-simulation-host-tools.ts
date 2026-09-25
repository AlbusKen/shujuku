import { isWorldbookApiAvailable_ACU } from '../../data/gateways/worldbook-gateway';
import { loadAgentWorldbookSnapshot_ACU, type AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import type { WorldSimulationWebResearchSettings_ACU } from './model';
import { createWorldSimulationToolDependencies_ACU, type WorldSimulationToolContext_ACU, type WorldSimulationToolReadResult_ACU, type WorldSimulationToolSearchResult_ACU } from './world-simulation-agent-tools';
import { WorldSimulationWebClient_ACU, type WorldSimulationEncyclopediaSource_ACU } from './world-simulation-web-client';

const encode_ACU = (value: unknown): string => encodeURIComponent(String(value ?? ''));
const decode_ACU = (value: string): string => { try { return decodeURIComponent(value); } catch { return ''; } };
const encyclopediaSourceEnabled_ACU = (
  settings: WorldSimulationWebResearchSettings_ACU,
  source: WorldSimulationEncyclopediaSource_ACU,
): boolean => source === 'moegirl'
  ? settings.sources.moegirl
  : source === 'wikipedia_zh'
    ? settings.sources.wikipediaZh
    : settings.sources.wikipediaEn;

export interface WorldSimulationHostToolContext_ACU extends WorldSimulationToolContext_ACU { webResearch: WorldSimulationWebResearchSettings_ACU; webClient?: Pick<WorldSimulationWebClient_ACU, 'searchEncyclopedia' | 'readEncyclopedia' | 'webSearch' | 'webRead'>; worldbookSnapshot?: Promise<AgentWorldbookSnapshot_ACU>; }

export function createWorldSimulationHostToolDependencies_ACU(context: WorldSimulationHostToolContext_ACU) {
  const client = context.webClient ?? new WorldSimulationWebClient_ACU();
  const worldbookSnapshot = context.worldbookSnapshot ?? loadAgentWorldbookSnapshot_ACU();
  const externalRead = async (address: string): Promise<WorldSimulationToolReadResult_ACU> => {
    if (address.startsWith('worldbook:entry:')) {
      const [bookPart, uidPart, ...rest] = address.slice('worldbook:entry:'.length).split(':');
      const book = decode_ACU(bookPart);
      const uid = decode_ACU(uidPart);
      if (!book || !uid || rest.length) return { status: 'failed', summary: 'invalid worldbook address' };
      const snapshot = await worldbookSnapshot;
      if (!snapshot.available) return { status: 'failed', summary: 'worldbook snapshot unavailable' };
      const entry = snapshot.entries.find(item => item.bookName === book && item.uid === uid);
      return entry ? { status: 'ok', content: entry.content, summary: entry.title, exact: true }
        : { status: 'empty', summary: 'worldbook entry is not enabled or does not exist' };
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
      else try {
        const snapshot = await worldbookSnapshot;
        if (!snapshot.available) throw new Error('worldbook snapshot unavailable');
        const matcher = isRegex ? new RegExp(query, 'i') : null;
        for (const entry of snapshot.entries) {
          const value = [entry.title, ...entry.keys, entry.content].join('\n');
          const matched = matcher ? matcher.exec(value) : null;
          const plainIndex = matcher ? -1 : value.toLowerCase().indexOf(query.toLowerCase());
          if (!(matcher ? matched : plainIndex >= 0)) continue;
          const at = matcher ? matched!.index : plainIndex;
          const flat = value.replace(/\s+/g, ' ').trim();
          const start = Math.max(0, at - 40);
          const slice = flat.slice(start, start + 160);
          const excerpt = `${start > 0 ? '…' : ''}${slice}${start + 160 < flat.length ? '…' : ''}`;
          hits.push({ address: `worldbook:entry:${encode_ACU(entry.bookName)}:${encode_ACU(entry.uid)}`, summary: `${entry.bookName}#${entry.uid}｜${excerpt}` });
          if (hits.length >= maxResults) break;
        }
      } catch (error) { sawFailed = true; diagnostics.push(error instanceof Error ? error.message : String(error)); }
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
