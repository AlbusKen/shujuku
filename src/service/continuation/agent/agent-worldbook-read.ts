/**
 * service/continuation/agent/agent-worldbook-read.ts — Agent 的世界书只读接入
 *
 * 运行起点一次性预取启用条目做运行内快照，之后目录 / 精读 / 命中提示 / 搜索都基于
 * 同一份快照（世界书读取是异步宿主调用，预取后地址在一次运行内不漂移）。
 *
 * 暴露范围：已启用集合内的普通条目全部可读可搜（含插件生成的重要人物条目等）；
 * 遗留的总结条目（旧总结系统的残留）不再暴露；未启用条目不进目录、不进搜索、不可读。
 */

import type { AgentMaterialGrantSource_ACU } from '../../agent-kernel/material-grants';
import { getIsolationPrefix_ACU } from '../../worldbook/injection-engine-state';
import { getLorebookEntriesStrict_ACU } from '../../worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../../settings/settings-readers';
import { isEntryBlocked_ACU, logWarn_ACU } from '../../../shared/utils';
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
  content: string;
  /** 条目全文的 token 估算，供 AI 判断读取预算。 */
  tokens: number;
}

/** 一次 Agent 运行内的世界书快照。 */
export interface AgentWorldbookSnapshot_ACU {
  entries: AgentWorldbookEntryView_ACU[];
  /** 读取宿主失败时为 false；目录会如实标注，不当成「没有条目」。 */
  available: boolean;
  /** 仅 available=false 时出现；只含状态、计数与错误类别。 */
  failure?: AgentWorldbookSnapshotFailure_ACU;
}

export interface AgentWorldbookSnapshotFailure_ACU {
  status: string;
  categories: string[];
  failedBooks: number;
  invalidBookNames: number;
}

export function buildEmptyAgentWorldbookSnapshot_ACU(available = true): AgentWorldbookSnapshot_ACU {
  return available
    ? { entries: [], available: true }
    : {
      entries: [],
      available: false,
      failure: { status: 'unavailable', categories: ['unknown'], failedBooks: 0, invalidBookNames: 0 },
    };
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readEntryKeys_ACU(entry: Record<string, unknown>): string[] {
  const raw = Array.isArray(entry.keys) ? entry.keys : typeof entry.keys === 'string' ? entry.keys.split(/[,，]/) : [];
  return raw.map(key => String(key ?? '').trim()).filter(Boolean);
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
    const result = await getLorebookEntriesStrict_ACU(bookNames, {
      source: 'agent_runtime',
      validationPolicy: 'validate_list',
      runId: `agent-worldbook:${Date.now()}`,
    });
    if (result.status !== 'success') {
      const categories = [...new Set([
        ...result.failedBooks.map(item => item.errorCategory),
        ...(result.invalidBookNames.length ? ['invalid_selection'] : []),
      ])];
      if (!categories.length) categories.push(result.status);
      logWarn_ACU('[Continuation][Agent] 世界书快照预取失败，本轮目录与搜索将不含世界书。', {
        status: result.status,
        categories,
        failedBooks: result.failedBookNames.length,
        invalidBookNames: result.invalidBookNames.length,
      });
      return {
        entries: [],
        available: false,
        failure: {
          status: result.status,
          categories,
          failedBooks: result.failedBookNames.length,
          invalidBookNames: result.invalidBookNames.length,
        },
      };
    }
    const isolationPrefix = getIsolationPrefix_ACU();
    const enabledEntriesMap = getCurrentWorldbookConfig_ACU()?.enabledEntries;

    const entries: AgentWorldbookEntryView_ACU[] = [];
    for (const [bookName, rawEntries] of Object.entries(result.entriesByBook)) {
      for (const raw of rawEntries ?? []) {
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
export function renderAgentWorldbookHits_ACU(snapshot: AgentWorldbookSnapshot_ACU, scanText: string): string {
  if (!snapshot.available) return '本轮世界书读取失败，无法给出命中提示；请勿臆测世界书内容。';
  if (!snapshot.entries.length) return '当前没有已启用的世界书条目，无命中提示。';
  const haystack = String(scanText ?? '').toLowerCase();
  const hits = snapshot.entries.filter(entry =>
    entry.constant || (haystack && entry.keys.some(key => haystack.includes(key.toLowerCase()))));
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

/** Maps an already-read worldbook address to exact frozen entries; failed or partial addresses grant nothing. */
export function resolveAgentWorldbookGrantEntries_ACU(snapshot: AgentWorldbookSnapshot_ACU | undefined, token: string): AgentWorldbookEntryView_ACU[] {
  if (!snapshot?.available || !token.startsWith('$WORLDBOOK:')) return [];
  const body = token.slice('$WORLDBOOK:'.length);
  const separator = body.lastIndexOf(':');
  if (separator <= 0) return [];
  const bookName = body.slice(0, separator).trim();
  const uids = body.slice(separator + 1).split(/[,，]/).map(uid => uid.trim()).filter(Boolean);
  if (!bookName || !uids.length || new Set(uids).size !== uids.length) return [];
  const found = uids.map(uid => snapshot.entries.find(entry => entry.bookName === bookName && entry.uid === uid) ?? null);
  return found.every((entry): entry is AgentWorldbookEntryView_ACU => entry !== null) ? found : [];
}

/** Source identity is based on the frozen entry body, so same address with changed text cannot reuse a grant. */
export function createAgentWorldbookGrantSource_ACU(entry: AgentWorldbookEntryView_ACU): AgentMaterialGrantSource_ACU {
  let hash = 0x811c9dc5;
  const value = `${entry.bookName}\n${entry.uid}\n${entry.content}`;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  const digest = `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  return { address: `$WORLDBOOK:${entry.bookName}:${entry.uid}`, revision: `${entry.bookName}:${entry.uid}:${entry.content.length}`, digest };
}
