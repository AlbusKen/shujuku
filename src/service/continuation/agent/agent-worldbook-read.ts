/**
 * service/continuation/agent/agent-worldbook-read.ts — Agent 的世界书只读接入
 *
 * 运行起点一次性预取启用条目做运行内快照，之后目录 / 精读 / 命中提示 / 搜索都基于
 * 同一份快照（世界书读取是异步宿主调用，预取后地址在一次运行内不漂移）。
 *
 * 暴露范围：已启用集合内的普通条目全部可读可搜（含插件生成的重要人物条目等）；
 * 遗留的总结条目（旧总结系统的残留）不再暴露；未启用条目不进目录、不进搜索、不可读。
 */

import { getIsolationPrefix_ACU } from '../../worldbook/injection-engine-state';
import { getLorebookEntriesByNames_ACU } from '../../worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../../settings/settings-readers';
import { isEntryBlocked_ACU, logWarn_ACU } from '../../../shared/utils';
import { getWorldbookEntryKeywords_ACU } from '../../worldbook/pipeline';
import {
  isSummaryEntryComment_ACU,
  normalizeGeneratedComment_ACU,
  resolveRelevantBookNames_ACU,
} from '../worldbook-context';
import { countAgentTokens_ACU } from './agent-token-budget';

/** 一条已启用的普通世界书条目。 */
export interface AgentWorldbookEntryView_ACU {
  bookName: string;
  uid: string;
  title: string;
  keys: string[];
  constant: boolean;
  /** 为真时，本条目正文不参与后续关键词迭代。对应世界书 prevent_recursion。 */
  preventRecursion?: boolean;
  /** 为真时，只对照最初扫描文本，不看后触发条目的正文。对应世界书 exclude_recursion。 */
  excludeRecursion?: boolean;
  content: string;
  /** 条目全文的 token 估算，供 AI 判断读取预算。 */
  tokens: number;
}

/** 一次 Agent 运行内的世界书快照。 */
export interface AgentWorldbookSnapshot_ACU {
  entries: AgentWorldbookEntryView_ACU[];
  /** 读取宿主失败时为 false；目录会如实标注，不当成「没有条目」。 */
  available: boolean;
}

export function buildEmptyAgentWorldbookSnapshot_ACU(available = true): AgentWorldbookSnapshot_ACU {
  return { entries: [], available };
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readEntryKeys_ACU(entry: Record<string, unknown>): string[] {
  return getWorldbookEntryKeywords_ACU(entry);
}

/** 与 pipeline 的 isSelected 语义一致：插件侧勾选表缺书/缺列表都视为全选。 */
function isEntrySelected_ACU(bookName: string, uid: string, enabledEntriesMap: unknown): boolean {
  if (!isRecord_ACU(enabledEntriesMap) || !Object.keys(enabledEntriesMap).length) return true;
  const list = enabledEntriesMap[bookName];
  if (typeof list === 'undefined' || !Array.isArray(list)) return true;
  return list.some(item => String(item) === uid);
}

/**
 * 条目 token 数的跨运行缓存。键含内容长度：同一条目被编辑后长度几乎必变，
 * 变了即重算；极小概率的等长改写只影响预算估算精度，不影响正确性。
 */
const entryTokenCache_ACU = new Map<string, number>();

async function countEntryTokens_ACU(bookName: string, uid: string, content: string): Promise<number> {
  const key = `${bookName}#${uid}#${content.length}`;
  const cached = entryTokenCache_ACU.get(key);
  if (cached !== undefined) return cached;
  const counted = await countAgentTokens_ACU(content);
  entryTokenCache_ACU.set(key, counted);
  return counted;
}

/**
 * 预取当前已启用的世界书条目为运行内快照。
 *
 * 启用判定与提示词注入管线一致：条目自身 enabled 为真、且通过插件侧 enabledEntries
 * 勾选表、且不属于屏蔽名单（当前屏蔽词为空，逻辑保留备用）。遗留总结条目直接跳过。
 * 内部插件条目（TavernDB-ACU- 前缀）是存储载体而非叙事资料，不暴露。
 * 每条条目在预取时统计 token 数（结果缓存跨运行复用），供目录标注读取预算。
 * @returns 快照；宿主读取失败时返回 available=false 的空快照
 */
export async function loadAgentWorldbookSnapshot_ACU(): Promise<AgentWorldbookSnapshot_ACU> {
  try {
    const bookNames = await resolveRelevantBookNames_ACU();
    if (!bookNames.length) return buildEmptyAgentWorldbookSnapshot_ACU();
    const entriesByBook = await getLorebookEntriesByNames_ACU(bookNames);
    const isolationPrefix = getIsolationPrefix_ACU();
    const enabledEntriesMap = getCurrentWorldbookConfig_ACU()?.enabledEntries;

    const entries: AgentWorldbookEntryView_ACU[] = [];
    for (const bookName of bookNames) {
      for (const raw of entriesByBook[bookName] ?? []) {
        if (!isRecord_ACU(raw)) continue;
        if (raw.enabled !== true) continue;
        const uid = String(raw.uid ?? '').trim();
        const title = normalizeGeneratedComment_ACU(raw, isolationPrefix);
        const content = String(raw.content ?? '').trim();
        // 旧总结系统的残留条目不再是可用资料域，静默跳过。
        if (isSummaryEntryComment_ACU(title)) continue;
        if (!uid || !content) continue;
        if (!isEntrySelected_ACU(bookName, uid, enabledEntriesMap)) continue;
        if (isEntryBlocked_ACU(raw)) continue;
        if (title.startsWith('TavernDB-ACU-')) continue;
        entries.push({
          bookName,
          uid,
          title: title || `条目 ${uid}`,
          keys: readEntryKeys_ACU(raw),
          constant: raw.type === 'constant',
          preventRecursion: raw.prevent_recursion === true,
          excludeRecursion: raw.exclude_recursion === true,
          content,
          tokens: await countEntryTokens_ACU(bookName, uid, content),
        });
      }
    }
    return { entries, available: true };
  } catch (error) {
    logWarn_ACU('[Continuation][Agent] 世界书快照预取失败，本轮目录与搜索将不含世界书。', { error: error instanceof Error ? error.message : String(error) });
    return buildEmptyAgentWorldbookSnapshot_ACU(false);
  }
}

/** 目录行里的内容摘要：压平空白后取前 10 个字符。 */
function entryExcerpt_ACU(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= 10 ? flat : `${flat.slice(0, 10)}…`;
}

/**
 * 渲染世界书目录：每条一行「标题｜关键词｜10 字摘要｜token 估算 → 精读地址」。
 * token 标注让 AI 在动手读之前就能对照读取预算分配额度。
 * @param snapshot 运行内快照
 * @returns 目录文本，进入主 Agent 骨架的 $WORLDBOOK_CATALOG
 */
export function renderAgentWorldbookCatalog_ACU(snapshot: AgentWorldbookSnapshot_ACU): string {
  if (!snapshot.available) return '本轮世界书读取失败，目录不可用；请勿臆测世界书内容，可照常使用其他资料域。';
  if (!snapshot.entries.length) return '当前没有已启用的世界书条目。';
  const lines = snapshot.entries.map(entry => {
    const keys = entry.keys.length ? entry.keys.join('、') : '（无）';
    return `- ${entry.title}｜关键词：${keys}｜摘要：${entryExcerpt_ACU(entry.content)}｜约 ${entry.tokens} token → 读取地址 $WORLDBOOK:${entry.bookName}:${entry.uid}`;
  });
  return `## 已启用的世界书条目（共 ${snapshot.entries.length} 条，只有这里列出的可读；行尾 token 数用于估算读取预算）\n${lines.join('\n')}`;
}

/**
 * 渲染本轮语境命中的世界书条目提示：常开条目始终列出，关键词条目在扫描文本
 * 命中任一关键词（大小写不敏感的包含匹配）时列出。
 * 这是「该读哪些设定」的直接信号——命中条目与本轮剧情高度相关，应优先精读。
 * @param snapshot 运行内快照
 * @param scanText 扫描文本（本轮目标 + 未结算正文 + 尾部楼层 + 用户初始要求）
 * @returns 命中提示文本；无命中/世界书不可用时如实说明
 */
/**
 * 与剧情推进、填表共用的触发规则。
 * 常量条目直接纳入；关键词条目最多迭代 10 轮，已触发且允许递归的正文会继续触发别的条目。
 * includeConstantContentInBaseScan 与剧情推进一致：常量正文也进入最初扫描文本，供排除递归的条目使用。
 */
export function selectTriggeredWorldbookEntries_ACU(
  entries: readonly AgentWorldbookEntryView_ACU[],
  scanText: string,
  options?: { includeConstantContentInBaseScan?: boolean },
): AgentWorldbookEntryView_ACU[] {
  const includeConstantContent = options?.includeConstantContentInBaseScan !== false;
  let baseScanText = String(scanText ?? '').toLowerCase();
  const constantEntries = entries.filter(entry => entry.constant);
  let keywordEntries = entries.filter(entry => !entry.constant);
  if (includeConstantContent) {
    const constantBaseText = constantEntries
      .filter(entry => entry.preventRecursion !== true)
      .map(entry => entry.content)
      .join('\n')
      .toLowerCase();
    if (constantBaseText) baseScanText = [baseScanText, constantBaseText].filter(Boolean).join('\n');
  }
  const triggered = new Set<AgentWorldbookEntryView_ACU>(constantEntries);
  for (let depth = 0; depth < 10; depth += 1) {
    const recursionSource = [...triggered]
      .filter(entry => entry.preventRecursion !== true)
      .map(entry => entry.content)
      .join('\n')
      .toLowerCase();
    const fullSearchText = `${baseScanText}\n${recursionSource}`;
    let changed = false;
    const remaining: AgentWorldbookEntryView_ACU[] = [];
    for (const entry of keywordEntries) {
      const keywords = entry.keys.map(key => key.toLowerCase()).filter(Boolean);
      const haystack = entry.excludeRecursion === true ? baseScanText : fullSearchText;
      if (keywords.length > 0 && keywords.some(keyword => haystack.includes(keyword))) {
        triggered.add(entry);
        changed = true;
      } else {
        remaining.push(entry);
      }
    }
    keywordEntries = remaining;
    if (!changed) break;
  }
  return entries.filter(entry => triggered.has(entry));
}

export function renderAgentWorldbookHits_ACU(snapshot: AgentWorldbookSnapshot_ACU, scanText: string): string {
  if (!snapshot.available) return '本轮世界书读取失败，无法给出命中提示；请勿臆测世界书内容。';
  if (!snapshot.entries.length) return '当前没有已启用的世界书条目，无命中提示。';
  const hits = selectTriggeredWorldbookEntries_ACU(snapshot.entries, scanText);
  if (!hits.length) return '本轮语境没有命中任何世界书条目的关键词，也没有常开条目。需要设定时从世界书目录挑选精读。';
  const lines = hits.map(entry =>
    `- ${entry.title}（${entry.constant ? '常开' : '关键词命中'}｜约 ${entry.tokens} token）→ $WORLDBOOK:${entry.bookName}:${entry.uid}`);
  return `以下条目与本轮语境直接相关（常开条目 + 关键词命中），本轮涉及对应设定时应精读：\n${lines.join('\n')}`;
}

/**
 * 按书名 + uid 列表精读世界书条目全文，支撑 `$WORLDBOOK:书名:uid1,uid2`。
 * @param snapshot 运行内快照
 * @param bookName 世界书名
 * @param uids 条目 uid 列表
 * @returns 条目全文；未知书名/uid 或条目未启用时回灌可修正的错误文本
 */
/** 主会话、伏笔等子代理与世界推演拒绝自行精读世界书时的说明。 */
export const WORLDBOOK_READ_REFUSAL_ACU = '世界书条目全文已经按关键词触发注入。不要 read 世界书地址。如果触发内容不够，用 search，scope 设为 ["worldbook"]，在全部世界书内容里按关键词检索。';

/** 总纲与大纲看到的是目录，由它们自己决定读哪一条。 */
export const WORLDBOOK_BROWSE_NOTE_ACU = '这是全部已启用世界书条目的目录，不是命中清单，没有注入条目全文。需要哪一条就按行尾地址 read。也可以用 search，scope 设为 ["worldbook"]，按关键词在世界书域里检索。';

const WORLDBOOK_TRIGGERED_NOTE_ACU = '以下是本轮按与剧情推进、填表相同的规则触发的世界书条目全文：常量条目直接纳入；关键词条目会迭代触发，已触发条目的正文可以继续带出别的关键词条目。不要再对世界书条目调用 read。如果这些内容不够，用 search，scope 设为 ["worldbook"]，在全部世界书内容里按关键词检索。';

/** 总纲、大纲使用的已启用目录。不附带命中条目全文。 */
export function renderAgentWorldbookBrowseCatalog_ACU(snapshot: AgentWorldbookSnapshot_ACU): string {
  return `${WORLDBOOK_BROWSE_NOTE_ACU}\n${renderAgentWorldbookCatalog_ACU(snapshot)}`;
}

/**
 * 本轮关键词已触发的世界书全文。
 * 常量条目直接纳入；关键词条目按已触发正文迭代，规则与剧情推进、填表相同。
 */
export function renderAgentWorldbookTriggeredInjection_ACU(snapshot: AgentWorldbookSnapshot_ACU, scanText: string): string {
  if (!snapshot.available) return `本轮世界书不可用。不要臆测设定。\n${WORLDBOOK_TRIGGERED_NOTE_ACU}`;
  return `${WORLDBOOK_TRIGGERED_NOTE_ACU}\n${renderAgentWorldbookHitBodies_ACU(snapshot, scanText)}`;
}

/** 世界推演整轮共用的触发注入。世界书不可用或没有已启用条目时不追加空段。 */
export async function loadTriggeredWorldbookInjection_ACU(scanText: string): Promise<string> {
  const snapshot = await loadAgentWorldbookSnapshot_ACU();
  if (!snapshot.available || !snapshot.entries.length) return '';
  return renderAgentWorldbookTriggeredInjection_ACU(snapshot, scanText);
}

/** 本轮命中的世界书条目全文。 */
export function renderAgentWorldbookHitBodies_ACU(snapshot: AgentWorldbookSnapshot_ACU, scanText: string): string {
  if (!snapshot.available) return '本轮世界书不可用。';
  if (!snapshot.entries.length) return '当前没有已启用的世界书条目。';
  const hits = selectTriggeredWorldbookEntries_ACU(snapshot.entries, scanText);
  if (!hits.length) return '本轮没有命中世界书条目。';
  const byBook = new Map<string, string[]>();
  for (const hit of hits) {
    const list = byBook.get(hit.bookName) ?? [];
    list.push(hit.uid);
    byBook.set(hit.bookName, list);
  }
  return [...byBook].map(([book, uids]) => renderAgentWorldbookEntries_ACU(snapshot, book, uids)).join('\n\n');
}

export function renderAgentWorldbookEntries_ACU(snapshot: AgentWorldbookSnapshot_ACU, bookName: string, uids: readonly string[]): string {
  if (!snapshot.available) return '本轮世界书读取失败，无法精读条目。';
  const book = String(bookName ?? '').trim();
  const wanted = uids.map(uid => String(uid ?? '').trim()).filter(Boolean);
  if (!book || !wanted.length) return '世界书读取地址不完整：需要 $WORLDBOOK:书名:uid（逗号分隔多个 uid）。地址请从世界书目录复制。';
  const inBook = snapshot.entries.filter(entry => entry.bookName === book);
  if (!inBook.length) return `已启用条目中不存在世界书「${book}」。可用地址见世界书目录；未启用的条目不可读。`;
  const found = inBook.filter(entry => wanted.includes(entry.uid));
  const missing = wanted.filter(uid => !inBook.some(entry => entry.uid === uid));
  const parts: string[] = found.map(entry => `### ${entry.title}（${entry.bookName}#${entry.uid}）\n${entry.content}`);
  if (missing.length) parts.push(`以下 uid 不存在于「${book}」的已启用条目中：${missing.join('、')}。地址请从世界书目录复制。`);
  return parts.join('\n\n');
}
