import { WORLD_CHRONICLE_HOT_WINDOW_ACU, type WorldChronicleOverviewRow_ACU, type WorldLocationRef_ACU, type WorldSimulationLedger_ACU } from './model';
import { buildArchiveHints_ACU, type WorldArchiveHint_ACU } from './archive-hints';
import { recentWorldActorExperiences_ACU } from './actor-timeline';

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

function row_ACU(id: string, name: string, summary: string, module: string, max = 80): WorldCatalogRow_ACU {
  return { id, name, summary: clip_ACU(summary, max), readAddress: `${module}:${id}` };
}

function locationText_ACU(ref: WorldLocationRef_ACU | null | undefined, fallback = ''): string {
  return ref ? [ref.region, ref.place].filter(Boolean).join('·') : fallback;
}

/** 目录摘要是条目整体的浓缩：状态、位置、驱动因素与关联，一眼可判断是否需要精读。 */
function joinParts_ACU(parts: ReadonlyArray<string | false | 0 | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join('；');
}

/** 已结束条目的显式标注，避免其他 AI 把已收场的事当成仍在进行。 */
export function worldLedgerEndedLabel_ACU(module: 'seeds' | 'rumors' | 'actors', row: Record<string, unknown>): string | null {
  if (module === 'seeds') {
    if (row.status === 'resolved') return '已结束：已收束';
    if (row.status === 'retired') return `已结束：已退役${row.retiredReason ? `（${String(row.retiredReason)}）` : ''}`;
  }
  if (module === 'rumors') {
    if (row.status === 'revealed') return '已结束：主角已得知';
    if (row.status === 'dead') return '已结束：已失效';
  }
  if (module === 'actors' && row.life === 'dead') return '已结束：已死亡';
  return null;
}

/**
 * 注入子代理的完整行视图：已结束条目追加 ended 标注；人物经历只带最近若干条。
 * 只读视图，不写回账本；ended 不是可写列。
 */
export function worldLedgerRowsForAgent_ACU<T extends object>(module: 'seeds' | 'rumors' | 'actors', rows: readonly T[]): Array<T & { ended?: string }> {
  return rows.map(row => {
    const view = { ...row } as unknown as Record<string, unknown>;
    if (module === 'actors' && Array.isArray(view.experiences)) {
      view.experiences = recentWorldActorExperiences_ACU(view as { experiences: never[] });
    }
    const ended = worldLedgerEndedLabel_ACU(module, view);
    if (ended) view.ended = ended;
    return view as T & { ended?: string };
  });
}

function actorActionText_ACU(action: { text: string; expectedDuration: string } | null | undefined): string {
  return action ? `${action.text}（预计${action.expectedDuration}）` : '';
}

function actorLatestExperience_ACU(item: WorldSimulationLedger_ACU['actors'][number]): string {
  const latest = recentWorldActorExperiences_ACU(item, 1)[0];
  return latest ? `近期经历：${latest.text}（第${latest.endedAtDay}日${latest.status === 'done' ? '了结' : '中止'}）` : '';
}

export function buildInUseWorldCatalog_ACU(ledger: WorldSimulationLedger_ACU): WorldInUseCatalog_ACU {
  const activeSeeds = ledger.seeds.filter(seed => seed.status !== 'resolved' && seed.status !== 'retired');
  const activeRumors = ledger.rumors.filter(rumor => rumor.status === 'latent' || rumor.status === 'ripe');
  const hot = ledger.chronicle.slice(-WORLD_CHRONICLE_HOT_WINDOW_ACU);
  return {
    clock: ledger.clock,
    player: ledger.player,
    dimensions: ledger.dimensions.map(item => row_ACU(item.id, item.name, `${item.kind} ${item.value} ${item.trend} ${item.rationale}`, 'dimensions')),
    seeds: activeSeeds.map(item => row_ACU(item.id, item.title, joinParts_ACU([
      `${item.status} lv${item.level} ${item.visibility}`,
      locationText_ACU(item.location) && `@${locationText_ACU(item.location)}`,
      item.catalyst && `催化：${item.catalyst}`,
      item.expiresAtDay !== null && `时限第${item.expiresAtDay}日`,
      item.actorIds.length > 0 && `人物：${item.actorIds.join(',')}`,
    ]), 'seeds', 140)),
    actors: ledger.actors.map(item => row_ACU(item.id, item.name, joinParts_ACU([
      item.life === 'dead' ? `已结束：已死亡 ${item.visibility}` : `${item.life} ${item.visibility}`,
      `@${locationText_ACU(item.locationRef, item.location) || '未知'}`,
      item.life === 'dead' && item.deathSummary && `死因：${item.deathSummary}`,
      item.life !== 'dead' && item.currentAction && `在做：${actorActionText_ACU(item.currentAction)}`,
      item.life !== 'dead' && item.longTermAction && `长期：${actorActionText_ACU(item.longTermAction)}`,
      item.goals.length > 0 && `目标：${item.goals.slice(0, 2).join('、')}`,
      item.interests.length > 0 && `关切：${item.interests.slice(0, 2).join('、')}`,
      actorLatestExperience_ACU(item),
    ]), 'actors', 220)),
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
  // 普通角色的目录不能沿用导演的“任一条目可读”提示，也不能无条件附带玩家状态。
  const slice: Record<string, unknown> = {
    readHint: '仅按当前角色授权的目录地址调用 read；目录未列出的资料不代表可读取。字段地址必须包含条目 ID。',
  };
  if (writableModules.some(module => ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'rumors'].includes(module))) {
    slice.clock = catalog.clock;
  }
  if (writable.has('actors')) slice.player = catalog.player;
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
