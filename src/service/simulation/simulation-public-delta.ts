import type { WorldSimulationTransaction_ACU, WorldStateSnapshot_ACU } from './model';

export interface WorldSimulationPublicDelta_ACU {
  text: string;
  publicEntryIds: readonly string[];
}

export interface WorldSimulationPublicDeltaOptions_ACU {
  maxEntries?: number;
  maxChars?: number;
}

type Module_ACU = 'entities' | 'events' | 'threads';
type PublicEntry_ACU = { key: string; publicEntryId: string; text: string };

const DEFAULT_MAX_ENTRIES_ACU = 12;
const DEFAULT_MAX_CHARS_ACU = 1800;

function clean_ACU(value: unknown): string {
  return String(value ?? '').replace(/<\/?与此同时>/g, '').replace(/\s+/g, ' ').trim();
}

function prefix_ACU(mode: 'revealed' | 'rumored'): string {
  return mode === 'rumored' ? '传闻｜' : '';
}

function entryText_ACU(module: Module_ACU, value: any): string | null {
  if (!value || value.retired || !['revealed', 'rumored'].includes(value.visibility?.mode)) return null;
  const prefix = prefix_ACU(value.visibility.mode);
  if (module === 'entities') return `${prefix}实体｜${clean_ACU(value.kind)}｜${clean_ACU(value.name)}：${clean_ACU(value.situation)}；意图：${clean_ACU(value.agenda)}`;
  if (module === 'events') return `${prefix}事件｜${clean_ACU(value.summary)}；发生于：${clean_ACU(value.occurredAt)}`;
  return `${prefix}线索｜${clean_ACU(value.title)}：${clean_ACU(value.summary)}；状态：${clean_ACU(value.status)}`;
}

function findById_ACU(state: WorldStateSnapshot_ACU, module: Module_ACU, id: string): any | undefined {
  return state[module].find(item => item.id === id);
}

function collectTouchedPublicEntries_ACU(before: WorldStateSnapshot_ACU, transaction: WorldSimulationTransaction_ACU, after: WorldStateSnapshot_ACU): PublicEntry_ACU[] {
  const entries: PublicEntry_ACU[] = [];
  for (const module of ['entities', 'events', 'threads'] as const) {
    for (const item of transaction[module]) {
      const id = item.action === 'upsert' ? item.value.id : item.id;
      const key = `${module}:${id}`;
      if (item.action === 'upsert') {
        const text = entryText_ACU(module, findById_ACU(after, module, id));
        if (text) entries.push({ key, publicEntryId: key, text });
        continue;
      }
      const prior = findById_ACU(before, module, id);
      if (prior && !prior.retired && ['revealed', 'rumored'].includes(prior.visibility.mode)) {
        entries.push({ key, publicEntryId: key, text: `${prefix_ACU(prior.visibility.mode)}${module === 'entities' ? '实体' : module === 'events' ? '事件' : '线索'}｜${clean_ACU(prior.name ?? prior.summary ?? prior.title)}的公开动态已结束。` });
      }
    }
  }
  return entries;
}

function positiveLimit_ACU(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Renders only touched public world changes. Hidden items never cross this seam,
 * and whole entries are retained or omitted rather than character-truncated.
 */
export function renderWorldSimulationPublicDelta_ACU(
  before: WorldStateSnapshot_ACU,
  transaction: WorldSimulationTransaction_ACU,
  after: WorldStateSnapshot_ACU,
  options: WorldSimulationPublicDeltaOptions_ACU = {},
): WorldSimulationPublicDelta_ACU {
  const maxEntries = positiveLimit_ACU(options.maxEntries, DEFAULT_MAX_ENTRIES_ACU);
  const maxChars = positiveLimit_ACU(options.maxChars, DEFAULT_MAX_CHARS_ACU);
  const selected: PublicEntry_ACU[] = [];
  const selectedKeys = new Set<string>();
  let length = 0;
  for (const entry of collectTouchedPublicEntries_ACU(before, transaction, after)) {
    if (!entry.key || !entry.text || selectedKeys.has(entry.key) || selected.length >= maxEntries) continue;
    const nextLength = length + (selected.length ? 1 : 0) + entry.text.length;
    if (nextLength > maxChars) break;
    selected.push(entry);
    selectedKeys.add(entry.key);
    length = nextLength;
  }
  return { text: selected.map(entry => entry.text).join('\n'), publicEntryIds: selected.map(entry => entry.publicEntryId) };
}
