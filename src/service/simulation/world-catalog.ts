import { WORLD_CHRONICLE_HOT_WINDOW_ACU, type WorldChronicleOverviewRow_ACU, type WorldSimulationLedger_ACU } from './model';
import { buildArchiveHints_ACU, type WorldArchiveHint_ACU } from './archive-hints';

export interface WorldCatalogRow_ACU {
  id: string;
  name: string;
  summary: string;
  readAddress: string;
}

export interface WorldInUseCatalog_ACU {
  clock: WorldSimulationLedger_ACU['clock'];
  player: WorldSimulationLedger_ACU['player'];
  dimensions: WorldCatalogRow_ACU[];
  seeds: WorldCatalogRow_ACU[];
  actors: WorldCatalogRow_ACU[];
  rumors: WorldCatalogRow_ACU[];
  chronicleHot: WorldCatalogRow_ACU[];
  readHint: string;
}

export const WORLD_CATALOG_READ_HINT_ACU = '目录中任一条目可通过 read 工具按地址调阅详细信息（在用条目如 seeds:{id}；逐栏状态必须使用 field:seeds:{id} 或 field:seeds:{id}:title；归档总结经 chronicle-archive:{archiveRef}）。不得省略 field 地址中的条目 ID。';
export const WORLD_SUBAGENT_DEDUP_HINT_ACU = '以下目录包含正在生效的资料与已经发生的事情（含已归档总结索引）；若你正要推演的事件与已发生目录中某条实质相同，不要重复推演。';

function clip_ACU(value: string, max = 80): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function row_ACU(id: string, name: string, summary: string, module: string): WorldCatalogRow_ACU {
  return { id, name, summary: clip_ACU(summary), readAddress: `${module}:${id}` };
}

export function buildInUseWorldCatalog_ACU(ledger: WorldSimulationLedger_ACU): WorldInUseCatalog_ACU {
  const activeSeeds = ledger.seeds.filter(seed => seed.status !== 'resolved' && seed.status !== 'retired');
  const activeRumors = ledger.rumors.filter(rumor => rumor.status === 'latent' || rumor.status === 'ripe');
  const hot = ledger.chronicle.slice(-WORLD_CHRONICLE_HOT_WINDOW_ACU);
  return {
    clock: ledger.clock,
    player: ledger.player,
    dimensions: ledger.dimensions.map(item => row_ACU(item.id, item.name, `${item.kind} ${item.value} ${item.trend} ${item.rationale}`, 'dimensions')),
    seeds: activeSeeds.map(item => row_ACU(item.id, item.title, `${item.status} lv${item.level} ${item.location?.region ?? ''}`, 'seeds')),
    actors: ledger.actors.map(item => row_ACU(item.id, item.name, `${item.life} ${item.locationRef?.region ?? item.location}`, 'actors')),
    rumors: activeRumors.map(item => row_ACU(item.id, item.fact, `${item.status} ${item.channels.join(',')}`, 'rumors')),
    chronicleHot: hot.map(item => ({
      id: item.id,
      name: item.at,
      summary: clip_ACU(item.summary),
      readAddress: `chronicle:${item.id}`,
    })),
    readHint: WORLD_CATALOG_READ_HINT_ACU,
  };
}

export const WORLD_RELATED_READONLY_MODULES_ACU: Record<string, readonly string[]> = {
  dimensions: ['actors'],
  seeds: ['actors', 'rumors'],
  actors: ['seeds', 'dimensions'],
  rumors: ['seeds'],
  chronicle: ['seeds', 'actors', 'rumors'],
};
export const WORLD_RELATED_READONLY_HINT_ACU = '关联模块只读目录：仅供对齐引用与一致性核对，禁止写入；目录行含 readAddress，可用 read 工具调阅详情。';

export function sliceModuleCatalog_ACU(
  catalog: WorldInUseCatalog_ACU,
  overview: readonly WorldChronicleOverviewRow_ACU[],
  writableModules: readonly string[],
): Record<string, unknown> {
  const writable = new Set(writableModules);
  const slice: Record<string, unknown> = { readHint: catalog.readHint, clock: catalog.clock, player: catalog.player };
  if (writable.has('dimensions')) slice.dimensions = catalog.dimensions;
  if (writable.has('seeds')) slice.seeds = catalog.seeds;
  if (writable.has('actors')) slice.actors = catalog.actors;
  if (writable.has('rumors')) slice.rumors = catalog.rumors;
  if (writable.has('chronicle')) {
    slice.chronicleHot = catalog.chronicleHot;
    slice.chronicleOverview = overview.map(row => ({
      day: row.day,
      oneLine: row.oneLine,
      archiveRef: row.archiveRef,
      readAddress: `chronicle-archive:${row.archiveRef}`,
    }));
    slice.dedupHint = WORLD_SUBAGENT_DEDUP_HINT_ACU;
  }
  const readonlyModules: Record<string, unknown> = {};
  for (const module of writableModules) {
    for (const related of WORLD_RELATED_READONLY_MODULES_ACU[module] ?? []) {
      if (writable.has(related) || readonlyModules[related]) continue;
      readonlyModules[related] = (catalog as unknown as Record<string, unknown>)[related];
    }
  }
  if (Object.keys(readonlyModules).length) {
    slice.relatedReadonly = readonlyModules;
    slice.relatedHint = WORLD_RELATED_READONLY_HINT_ACU;
  }
  return slice;
}

export function summarizeCandidatePatches_ACU(candidates: readonly { candidateId: string; agentName: string; patch: Record<string, unknown>; summary: string }[]): Array<Record<string, unknown>> {
  return candidates.map(candidate => {
    const diff: Record<string, string> = {};
    for (const [module, patch] of Object.entries(candidate.patch)) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        diff[module] = 'updated';
        continue;
      }
      const record = patch as Record<string, unknown>;
      if (Array.isArray(record.upsert)) diff[module] = `upsert+${record.upsert.length}`;
      else if (Array.isArray(record.append)) diff[module] = `append+${record.append.length}`;
      else if (module === 'chronicleArchive' && Array.isArray(record.overviewRows)) diff[module] = `archive+${record.overviewRows.length}`;
      else diff[module] = `keys:${Object.keys(record).join(',')}`;
    }
    return { candidateId: candidate.candidateId, agentName: candidate.agentName, summary: candidate.summary, diff };
  });
}

export function catalogArchiveHints_ACU(
  candidates: readonly { patch: Record<string, unknown> }[],
  overview: readonly WorldChronicleOverviewRow_ACU[],
): WorldArchiveHint_ACU[] {
  const entries = candidates.flatMap(candidate => {
    const chronicle = candidate.patch.chronicle;
    if (!chronicle || typeof chronicle !== 'object' || Array.isArray(chronicle)) return [];
    const append = (chronicle as { append?: unknown }).append;
    return Array.isArray(append) ? append as Array<{ summary?: string; at?: string; relatedIds?: string[] }> : [];
  }).flatMap(item => typeof item?.summary === 'string' && typeof item.at === 'string'
    ? [{ summary: item.summary, at: item.at, relatedIds: Array.isArray(item.relatedIds) ? item.relatedIds.filter((id): id is string => typeof id === 'string') : [] }]
    : []);
  return buildArchiveHints_ACU(entries, overview);
}
