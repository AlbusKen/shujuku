/**
 * service/continuation/agent/agent-protocol.ts — Agent 文本协议解析
 *
 * 内部 AI 没有原生工具调用能力，所有动作都通过模型输出的 JSON 块表达。
 * 项目里既有的大纲链路证明：尾部 assistant 段在实际后端只起格式示范作用，
 * 模型常常重新完整输出而不是续写。所以解析必须同时容忍两种返回形态：
 * 直接输出完整 JSON，或只续写预填充之后的部分。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import { parseJsonLenient_ACU, salvageTruncatedJson_ACU, stripReasoningBlocks_ACU } from '../lenient-text';
import {
  AGENT_CHRONOLOGY_PRECISIONS_ACU,
  AGENT_HOOK_IMPORTANCES_ACU,
  AGENT_HOOK_STATUSES_ACU,
  AGENT_REVEAL_STATUSES_ACU,
  AGENT_REVIEW_VERDICTS_ACU,
  AGENT_SEARCH_SCOPES_ACU,
  AGENT_STORY_ARC_SCOPES_ACU,
  AGENT_STORY_ARC_STATUSES_ACU,
  AGENT_VOLUME_NARRATIVE_ROLES_ACU,
  AGENT_WEB_TOOL_ACTIONS_ACU,
  type AgentChronologyDeltaItem_ACU,
  type AgentDelegation_ACU,
  type AgentFinalReviewerOutput_ACU,
  type AgentHookDeltaItem_ACU,
  type AgentHookPatch_ACU,
  type AgentInfoGapDeltaItem_ACU,
  type AgentInfoGapPatch_ACU,
  type AgentMainAction_ACU,
  type AgentMaintainerOutput_ACU,
  type AgentModuleDelta_ACU,
  type AgentPlannerOutput_ACU,
  type AgentReviewerOutput_ACU,
  type AgentSearchScope_ACU,
  type AgentStoryArcDeltaItem_ACU,
  type AgentStoryArcPatch_ACU,
  type AgentToolCall_ACU,
  type AgentWebRefSource_ACU,
  type AgentWebToolCall_ACU,
} from './agent-model';

function failProtocol_ACU(reason: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_loop', reason, true, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText_ACU(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readTextList_ACU(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readText_ACU).filter(Boolean);
}

/** 单次解析里最多扫描的顶层配平对象数，防止超长返回里的花括号碎片拖垮解析。 */
const JSON_OBJECT_SCAN_LIMIT_ACU = 6;

function balancedObjectFrom_ACU(text: string, start: number): { json: string; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = inString; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { json: text.slice(start, index + 1), end: index + 1 };
    }
  }
  return null;
}

/**
 * 从任意文本里提取首个配平的 JSON 对象。
 * @param text 模型返回的原始文本，可能带 Markdown 围栏或前后解释
 * @returns 提取到的 JSON 子串；找不到返回 null
 */
export function extractFirstJsonObject_ACU(text: string): string | null {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  return balancedObjectFrom_ACU(text, start)?.json ?? null;
}

/**
 * 从任意文本里依次提取多个顶层配平 JSON 对象（已消费区间内的嵌套对象不重复提取）。
 * @param text 模型返回的原始文本
 * @returns 提取到的 JSON 子串列表，最多 6 个
 */
export function extractJsonObjects_ACU(text: string): string[] {
  if (typeof text !== 'string') return [];
  const objects: string[] = [];
  let cursor = 0;
  while (objects.length < JSON_OBJECT_SCAN_LIMIT_ACU) {
    const start = text.indexOf('{', cursor);
    if (start < 0) break;
    const balanced = balancedObjectFrom_ACU(text, start);
    if (!balanced) {
      // 从该花括号起无法配平（多半是散文里的孤立花括号），跳过它继续找。
      cursor = start + 1;
      continue;
    }
    objects.push(balanced.json);
    cursor = balanced.end;
  }
  return objects;
}

function stripMarkdownFences_ACU(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').trim();
}

/** 统一的原文预处理：剥推理块。围栏由花括号扫描天然跳过，不在这里处理。 */
function normalizeModelText_ACU(raw: string | null | undefined): string {
  return typeof raw === 'string' ? stripReasoningBlocks_ACU(raw) : '';
}

/** 在候选文本里按优先级提取全部可解析的顶层对象（严格失败时走宽松 JSON）。 */
function parseObjectsFrom_ACU(candidate: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const extracted of extractJsonObjects_ACU(candidate)) {
    const parsed = parseJsonLenient_ACU(extracted);
    if (isRecord_ACU(parsed)) records.push(parsed);
  }
  return records;
}

/**
 * 解析一份 Agent 协议载荷。对返回形态宽容：模型可以完整重输 JSON、只续写预填充、
 * 或在 JSON 前后写自然语言——运行时按判别键从全文中挑出正确的动作对象。
 * @param raw 模型返回的原始文本
 * @param prefill 该请求尾段预填充文本，可为空
 * @param requiredKeys 协议对象的判别键，含任意一个即视为目标对象；缺省不判别
 * @returns 解析出的对象
 */
export function parseAgentJsonPayload_ACU(raw: string | null | undefined, prefill = '', requiredKeys: readonly string[] = []): Record<string, unknown> {
  const text = normalizeModelText_ACU(raw);
  if (!text.trim()) failProtocol_ACU('内部 AI 返回为空');
  // 剥掉围栏后以 { 开头视为完整重输，原文优先；否则视为续写预填充，拼接候选优先。
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  let firstParsed: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    for (const parsed of parseObjectsFrom_ACU(candidate)) {
      if (!requiredKeys.length || requiredKeys.some(key => key in parsed)) return parsed;
      if (!firstParsed) firstParsed = parsed;
    }
  }
  // 没有对象命中判别键时退回首个可解析对象，让上层契约校验给出准确的字段级报错。
  if (firstParsed) return firstParsed;
  failProtocol_ACU(`返回内容不包含可解析的 JSON 对象。模型返回片段：${text.trim().slice(0, 300)}`);
}

export interface AgentJsonPayloadDraft_ACU {
  payload: Record<string, unknown>;
  /** 输出在 JSON 中途被截断，payload 只含抢救出的完整条目。 */
  truncated: boolean;
}

/**
 * 契约载荷的草稿解析：完整 JSON 直接返回；配平失败时尝试抢救截断的 JSON——保留已写完的
 * 条目、丢掉未完成的尾部，并标记 truncated，让调用方向模型索要“剩余条目”而不是整份重来。
 * @param raw 模型返回的原始文本
 * @param prefill 尾段预填充
 * @param requiredKeys 契约对象判别键
 */
export function parseAgentJsonPayloadDraft_ACU(raw: string | null | undefined, prefill = '', requiredKeys: readonly string[] = []): AgentJsonPayloadDraft_ACU {
  const text = normalizeModelText_ACU(raw);
  if (!text.trim()) failProtocol_ACU('内部 AI 返回为空');
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  let firstParsed: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    const stripped = stripMarkdownFences_ACU(candidate);
    const start = stripped.indexOf('{');
    if (start < 0) continue;
    // 逐个候选判定：首个 { 能配平就按完整对象解析；配不平才视为截断去抢救。
    // 决不能对已经完整的原文再去试“预填充 + 原文”的拼接——预填充以未闭合引号结尾，拼上完整 JSON
    // 后必然配不平，会被当成截断抢救出一份没有 delta 的假载荷，让子代理“成功”却什么都没写。
    if (balancedObjectFrom_ACU(stripped, start)) {
      for (const parsed of parseObjectsFrom_ACU(stripped)) {
        if (!requiredKeys.length || requiredKeys.some(key => key in parsed)) return { payload: parsed, truncated: false };
        if (!firstParsed) firstParsed = parsed;
      }
      continue;
    }
    const salvaged = salvageTruncatedJson_ACU(stripped);
    if (!salvaged) continue;
    const parsed = parseJsonLenient_ACU(salvaged.json);
    if (isRecord_ACU(parsed) && (!requiredKeys.length || requiredKeys.some(key => key in parsed))) {
      return { payload: parsed, truncated: true };
    }
  }
  if (firstParsed) return { payload: firstParsed, truncated: false };
  failProtocol_ACU(`返回内容不包含可解析的 JSON 对象。模型返回片段：${text.trim().slice(0, 300)}`);
}

function parseDelegations_ACU(value: unknown): AgentDelegation_ACU[] {
  if (!Array.isArray(value) || !value.length) failProtocol_ACU('delegate 动作必须提供非空的 delegations 数组');
  return value.map((raw, index) => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delegations[${index}] 必须是对象`);
    const agentName = readText_ACU(raw.agentName);
    const prompt = readText_ACU(raw.prompt);
    if (!agentName) failProtocol_ACU(`delegations[${index}].agentName 不能为空`);
    if (!prompt) failProtocol_ACU(`delegations[${index}].prompt 不能为空`);
    // 旧协议的 writes 字段静默忽略：写入范围由子代理职责固定决定，不再由主 Agent 授权。
    return { agentName, prompt, reads: readTextList_ACU(raw.reads) };
  });
}

/** 单次 read 调用最多允许的地址数，防止一口气抄全目录。 */
const READ_ADDRESS_LIMIT_ACU = 8;

/** search 单次调用默认与上限的返回条数。 */
export const AGENT_SEARCH_DEFAULT_MAX_RESULTS_ACU = 30;
export const AGENT_SEARCH_MAX_RESULTS_CAP_ACU = 100;

function parseSearchScope_ACU(value: unknown): AgentSearchScope_ACU[] {
  if (value === undefined || value === null) return [...AGENT_SEARCH_SCOPES_ACU];
  const list = Array.isArray(value) ? value : [value];
  const scopes: AgentSearchScope_ACU[] = [];
  for (const raw of list) {
    const scope = readText_ACU(raw);
    if (!scope) continue;
    if (!(AGENT_SEARCH_SCOPES_ACU as readonly string[]).includes(scope)) {
      failProtocol_ACU(`search 的 scope 只能是 ${AGENT_SEARCH_SCOPES_ACU.join(' / ')}，实际收到：${scope}`);
    }
    if (!scopes.includes(scope as AgentSearchScope_ACU)) scopes.push(scope as AgentSearchScope_ACU);
  }
  return scopes.length ? scopes : [...AGENT_SEARCH_SCOPES_ACU];
}

/**
 * 把一个 JSON 载荷解析成工具调用。
 * @param payload 已解析且 action 为 read / search 的载荷
 * @returns 工具调用对象；字段非法时抛可回灌的协议错误
 */
export function parseAgentToolCall_ACU(payload: Record<string, unknown>): AgentToolCall_ACU {
  const action = readText_ACU(payload.action);
  if (action === 'read') {
    const reads = readTextList_ACU(payload.reads);
    if (!reads.length) failProtocol_ACU('read 动作必须提供非空的 reads 数组（资料地址列表）');
    if (reads.length > READ_ADDRESS_LIMIT_ACU) failProtocol_ACU(`一次 read 最多 ${READ_ADDRESS_LIMIT_ACU} 个地址；请拆成多次或先用 search 缩小范围`);
    return { kind: 'read', reads: [...new Set(reads)] };
  }
  if (action === 'search') {
    const query = readText_ACU(payload.query);
    if (!query) failProtocol_ACU('search 动作必须提供非空 query');
    let maxResults = AGENT_SEARCH_DEFAULT_MAX_RESULTS_ACU;
    if (payload.maxResults !== undefined) {
      if (typeof payload.maxResults !== 'number' || !Number.isInteger(payload.maxResults) || payload.maxResults < 1) {
        failProtocol_ACU('search 的 maxResults 必须是正整数');
      }
      maxResults = Math.min(payload.maxResults, AGENT_SEARCH_MAX_RESULTS_CAP_ACU);
    }
    return { kind: 'search', query, scope: parseSearchScope_ACU(payload.scope), isRegex: payload.isRegex === true, maxResults };
  }
  failProtocol_ACU(`工具动作必须是 read / search，实际收到：${action || '(空)'}`);
}

/** 一次输出里最多接受的工具调用数（与 JSON 扫描上限一致）。 */
export const AGENT_TOOL_BATCH_LIMIT_ACU = JSON_OBJECT_SCAN_LIMIT_ACU;

interface ParsedActionObjects_ACU {
  records: Record<string, unknown>[];
}

/** 按 parseAgentJsonPayload 的候选优先级提取全部带 action 键的顶层对象。 */
function collectActionObjects_ACU(raw: string | null | undefined, prefill: string): ParsedActionObjects_ACU {
  const text = normalizeModelText_ACU(raw);
  if (!text.trim()) failProtocol_ACU('内部 AI 返回为空（或只有推理文字，没有任何动作 JSON）');
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records = parseObjectsFrom_ACU(candidate).filter(parsed => 'action' in parsed);
    if (records.length) return { records };
  }
  failProtocol_ACU(`返回内容不包含带 action 字段的 JSON 对象。模型返回片段：${text.trim().slice(0, 300)}`);
}

/**
 * 解析主 Agent 的一次完整输出。
 *
 * 输出里出现任意 read / search 对象时，本次视为工具并发批次：收集全部工具调用同时执行，
 * 混入的决策动作被忽略（决策必须在拿到工具结果后单独输出）。否则按单动作解析。
 * @param raw 模型返回的原始文本
 * @param prefill 尾段预填充
 * @param allowDelegate 本轮是否仍允许派工
 * @returns 判别联合形式的动作对象（可能是 tools 批次）
 */
export function parseAgentMainOutput_ACU(raw: string | null | undefined, prefill: string, allowDelegate: boolean): AgentMainAction_ACU {
  const { records } = collectActionObjects_ACU(raw, prefill);
  const toolRecords = records.filter(record => { const action = readText_ACU(record.action); return action === 'read' || action === 'search'; });
  if (toolRecords.length) {
    const calls = toolRecords.slice(0, AGENT_TOOL_BATCH_LIMIT_ACU).map(parseAgentToolCall_ACU);
    return { kind: 'tools', thought: readText_ACU(toolRecords[0].thought), calls };
  }
  return parseAgentMainAction_ACU(records[0], allowDelegate);
}

/**
 * 从子代理输出里提取工具并发批次。
 * @param raw 模型返回的原始文本
 * @param prefill 尾段预填充
 * @returns 工具调用列表；输出里没有任何 read / search 对象时返回 null（应按契约解析）
 */
export function parseAgentSubagentToolCalls_ACU(raw: string | null | undefined, prefill: string): AgentToolCall_ACU[] | null {
  const text = normalizeModelText_ACU(raw);
  if (!text.trim()) return null;
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records = parseObjectsFrom_ACU(candidate);
    const toolRecords = records.filter(parsed => { const action = readText_ACU(parsed.action); return action === 'read' || action === 'search'; });
    if (toolRecords.length) return toolRecords.slice(0, AGENT_TOOL_BATCH_LIMIT_ACU).map(parseAgentToolCall_ACU);
    if (records.length) return null;
  }
  return null;
}

const ENCYCLOPEDIA_SOURCE_ALIASES_ACU: Record<string, Exclude<AgentWebRefSource_ACU, 'web'>> = {
  moegirl: 'moegirl', 萌娘百科: 'moegirl', 萌娘: 'moegirl', moe: 'moegirl',
  wikipedia_zh: 'wikipedia_zh', wikipedia: 'wikipedia_zh', zhwiki: 'wikipedia_zh', 维基百科: 'wikipedia_zh', 中文维基: 'wikipedia_zh', 维基: 'wikipedia_zh',
  wikipedia_en: 'wikipedia_en', enwiki: 'wikipedia_en', 英文维基: 'wikipedia_en',
  baidu: 'baidu', baike: 'baidu', 百度百科: 'baidu', 百度: 'baidu',
};

function parseEncyclopediaSource_ACU(value: unknown, path: string): Exclude<AgentWebRefSource_ACU, 'web'> {
  const raw = readText_ACU(value);
  const source = ENCYCLOPEDIA_SOURCE_ALIASES_ACU[raw] ?? ENCYCLOPEDIA_SOURCE_ALIASES_ACU[raw.toLowerCase()];
  if (!source) failProtocol_ACU(`${path} 必须是 moegirl / wikipedia_zh / wikipedia_en / baidu 之一，实际收到：${raw || '(空)'}`);
  return source;
}

/**
 * 把一个 JSON 载荷解析成 web-researcher 的出网工具调用。
 * @param payload 已解析且 action 为四种出网动作之一的载荷
 */
export function parseAgentWebToolCall_ACU(payload: Record<string, unknown>): AgentWebToolCall_ACU {
  const action = readText_ACU(payload.action);
  if (action === 'encyclopedia_search') {
    const query = readText_ACU(payload.query);
    if (!query) failProtocol_ACU('encyclopedia_search 必须提供非空 query');
    const rawSources = payload.sources === undefined || payload.sources === null ? [] : (Array.isArray(payload.sources) ? payload.sources : [payload.sources]);
    const sources = [...new Set(rawSources.map((item, index) => parseEncyclopediaSource_ACU(item, `encyclopedia_search.sources[${index}]`)))];
    return { kind: 'encyclopedia_search', query, sources };
  }
  if (action === 'encyclopedia_read') {
    const title = readText_ACU(payload.title);
    if (!title) failProtocol_ACU('encyclopedia_read 必须提供非空 title（词条标题，从 encyclopedia_search 的候选里复制）');
    return { kind: 'encyclopedia_read', source: parseEncyclopediaSource_ACU(payload.source, 'encyclopedia_read.source'), title };
  }
  if (action === 'web_search') {
    const query = readText_ACU(payload.query);
    if (!query) failProtocol_ACU('web_search 必须提供非空 query');
    return { kind: 'web_search', query };
  }
  if (action === 'web_read') {
    const url = readText_ACU(payload.url);
    if (!url) failProtocol_ACU('web_read 必须提供非空 url');
    return { kind: 'web_read', url };
  }
  failProtocol_ACU(`出网工具动作必须是 ${AGENT_WEB_TOOL_ACTIONS_ACU.join(' / ')}，实际收到：${action || '(空)'}`);
}

function isWebToolAction_ACU(action: string): boolean {
  return (AGENT_WEB_TOOL_ACTIONS_ACU as readonly string[]).includes(action);
}

/**
 * 从 web-researcher 输出里提取工具并发批次：本地 read/search 与四种出网工具混排。
 * @returns 工具调用列表；输出里没有任何工具对象时返回 null（应按契约解析）
 */
export function parseAgentResearcherToolCalls_ACU(raw: string | null | undefined, prefill: string): Array<AgentToolCall_ACU | AgentWebToolCall_ACU> | null {
  const text = normalizeModelText_ACU(raw);
  if (!text.trim()) return null;
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records = parseObjectsFrom_ACU(candidate);
    const toolRecords = records.filter(parsed => {
      const action = readText_ACU(parsed.action);
      return action === 'read' || action === 'search' || isWebToolAction_ACU(action);
    });
    if (toolRecords.length) {
      return toolRecords.slice(0, AGENT_TOOL_BATCH_LIMIT_ACU).map(record => (
        isWebToolAction_ACU(readText_ACU(record.action)) ? parseAgentWebToolCall_ACU(record) : parseAgentToolCall_ACU(record)
      ));
    }
    if (records.length) return null;
  }
  return null;
}

/**
 * 提取 web-researcher 为已读网页写下的精炼工作笔记。网页正文不进子代理历史；
 * 下一次工具动作须把从上一批网页获得的事实写入 notes，运行时仅保留这部分。
 */
export function parseAgentResearcherWorkingNotes_ACU(raw: string | null | undefined, prefill: string): string[] {
  const text = normalizeModelText_ACU(raw);
  if (!text.trim()) return [];
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records = parseObjectsFrom_ACU(candidate);
    const notes: string[] = [];
    for (const record of records) {
      const action = readText_ACU(record.action);
      if (!action || (!isWebToolAction_ACU(action) && action !== 'read' && action !== 'search')) continue;
      const rawNotes = record.notes ?? record.workingNotes;
      const items = Array.isArray(rawNotes) ? rawNotes : [rawNotes];
      for (const item of items) {
        const note = readText_ACU(item);
        if (note) notes.push(note.length > 800 ? `${note.slice(0, 800)}…` : note);
      }
    }
    if (notes.length || records.length) return [...new Set(notes)].slice(0, 12);
  }
  return [];
}

/** web-researcher 契约里的单条写集（pageRef 尚未回填）。 */
export interface AgentResearcherDraftItem_ACU {
  action: 'upsert' | 'retire';
  id: string;
  pageRef: string;
  title: string;
  tags: string[];
  brief: string;
  summary: string;
  reason: string;
}

export interface AgentResearcherDraft_ACU {
  summary: string;
  expectedRevision: number | undefined;
  items: AgentResearcherDraftItem_ACU[];
}

/**
 * 解析 web-researcher 的契约输出（回填前）。每条资料以一个实体分份，固定字段只有
 * name（名称）与 brief（一句话简介）；detail 自由发挥。upsert 必须带 pageRef、name、brief；
 * retire 必须带 id 与 reason。
 * @param payload 已解析的 JSON 载荷
 */
export function parseAgentResearcherOutput_ACU(payload: Record<string, unknown>): AgentResearcherDraft_ACU {
  const rawDelta = isRecord_ACU(payload.delta) ? payload.delta : payload;
  const list = rawDelta.webRefs ?? rawDelta.entries ?? rawDelta.items;
  if (list === undefined || list === null) {
    return { summary: readText_ACU(payload.summary), expectedRevision: parseWebRefsExpectedRevision_ACU(rawDelta.expectedRevisions ?? payload.expectedRevisions), items: [] };
  }
  if (!Array.isArray(list)) failProtocol_ACU('delta.webRefs 必须是数组');
  const items = list.map((raw, index): AgentResearcherDraftItem_ACU => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.webRefs[${index}] 必须是对象`);
    const actionText = readText_ACU(raw.action) || 'upsert';
    if (actionText !== 'upsert' && actionText !== 'retire') failProtocol_ACU(`delta.webRefs[${index}].action 必须是 upsert / retire`);
    const action = actionText as 'upsert' | 'retire';
    const id = readText_ACU(raw.id);
    if (action === 'retire') {
      if (!id) failProtocol_ACU(`delta.webRefs[${index}] retire 需要 id`);
      return { action, id, pageRef: '', title: '', tags: [], brief: '', summary: '', reason: readText_ACU(raw.reason) };
    }
    const pageRef = readText_ACU(raw.pageRef ?? raw.page ?? raw.ref);
    if (!pageRef) failProtocol_ACU(`delta.webRefs[${index}] upsert 必须带 pageRef（工具结果里的页面句柄，如 P1）；不允许手写 url 或原文`);
    const title = readText_ACU(raw.name ?? raw.title);
    if (!title) failProtocol_ACU(`delta.webRefs[${index}]（pageRef=${pageRef}）的 name 不能为空：写这条资料对应的实体名称（角色 / 物品 / 法术 / 事件…）`);
    const brief = readText_ACU(raw.brief ?? raw.intro ?? raw.oneLine);
    if (!brief) failProtocol_ACU(`delta.webRefs[${index}]「${title}」的 brief 不能为空：一句话说清它是什么`);
    const detailRaw = raw.detail ?? raw.summary ?? raw.body;
    const summary = typeof detailRaw === 'string' ? detailRaw.trim() : (detailRaw && typeof detailRaw === 'object' ? JSON.stringify(detailRaw, null, 1) : '');
    return { action, id, pageRef, title, tags: readTextList_ACU(raw.tags), brief, summary, reason: '' };
  });
  return { summary: readText_ACU(payload.summary), expectedRevision: parseWebRefsExpectedRevision_ACU(rawDelta.expectedRevisions ?? payload.expectedRevisions), items };
}

function parseWebRefsExpectedRevision_ACU(value: unknown): number | undefined {
  if (!isRecord_ACU(value)) return undefined;
  const raw = value.webRefs;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

/**
 * 解析主 Agent 的一次协议动作。
 * @param payload 已解析的 JSON 载荷
 * @param allowDelegate 本轮是否仍允许派工（预算最后一轮为 false）
 * @returns 判别联合形式的动作对象
 */
export function parseAgentMainAction_ACU(payload: Record<string, unknown>, allowDelegate: boolean): AgentMainAction_ACU {
  const action = readText_ACU(payload.action);
  const thought = readText_ACU(payload.thought);
  if (action === 'delegate') {
    if (!allowDelegate) failProtocol_ACU('本轮为预算最后一轮，已禁用 delegate，必须输出 finalize 或 block');
    return { kind: 'delegate', thought, delegations: parseDelegations_ACU(payload.delegations) };
  }
  if (action === 'finalize') {
    const instruction = readText_ACU(payload.instruction);
    if (!instruction) failProtocol_ACU('finalize 动作必须提供非空 instruction');
    const rawConstraints = payload.constraints;
    let constraints: { add: string[]; retire: string[] } | null = null;
    if (isRecord_ACU(rawConstraints)) {
      // 兼容旧全量形态：current 视为「确保存在」（已存在的条目由事务层幂等跳过），retired 同 retire。
      const add = [...new Set([...readTextList_ACU(rawConstraints.add), ...readTextList_ACU(rawConstraints.current)])];
      const retire = [...new Set([...readTextList_ACU(rawConstraints.retire), ...readTextList_ACU(rawConstraints.retired)])];
      if (add.length || retire.length) constraints = { add, retire };
    }
    return { kind: 'finalize', thought, instruction, summary: readText_ACU(payload.summary), constraints };
  }
  if (action === 'block') {
    const reason = readText_ACU(payload.reason);
    if (!reason) failProtocol_ACU('block 动作必须提供 reason');
    return { kind: 'block', thought, reason, unresolved: readTextList_ACU(payload.unresolved) };
  }
  if (action === 'read' || action === 'search') {
    return { kind: 'tools', thought, calls: [parseAgentToolCall_ACU(payload)] };
  }
  failProtocol_ACU(`action 必须是 read / search / delegate / finalize / block 之一；大纲调整请派工 outline-architect，实际收到：${action || '(空)'}`);
}

function parseCharacterKnowledge_ACU(value: unknown): AgentInfoGapDeltaItem_ACU['characterKnowledge'] {
  const knowledge = Array.isArray(value) ? value : [];
  return knowledge.flatMap(item => {
    if (!isRecord_ACU(item)) return [];
    const name = readText_ACU(item.name);
    return name ? [{ name, knows: readText_ACU(item.knows) }] : [];
  });
}

function parseHookPatch_ACU(raw: Record<string, unknown>, index: number): AgentHookPatch_ACU {
  const id = readText_ACU(raw.id);
  if (!id) failProtocol_ACU(`delta.hooks[${index}] 的 patch 需要 id`);
  const patch: AgentHookPatch_ACU = { id };
  if (typeof raw.summary === 'string' && raw.summary.trim()) patch.summary = raw.summary.trim();
  const status = readText_ACU(raw.status);
  if (status) {
    if (!(AGENT_HOOK_STATUSES_ACU as readonly string[]).includes(status)) failProtocol_ACU(`delta.hooks[${index}] 的 patch.status 非法：${status}`);
    patch.status = status as AgentHookPatch_ACU['status'];
  }
  const importance = readText_ACU(raw.importance);
  if (importance) {
    if (!(AGENT_HOOK_IMPORTANCES_ACU as readonly string[]).includes(importance)) failProtocol_ACU(`delta.hooks[${index}] 的 patch.importance 非法：${importance}`);
    patch.importance = importance as AgentHookPatch_ACU['importance'];
  }
  if (typeof raw.plannedPayoff === 'string') patch.plannedPayoff = raw.plannedPayoff.trim();
  if (Object.keys(patch).length === 1) failProtocol_ACU(`delta.hooks[${index}] 的 patch 至少要带一个要修改的字段`);
  return patch;
}

function parseInfoGapPatch_ACU(raw: Record<string, unknown>, index: number): AgentInfoGapPatch_ACU {
  const id = readText_ACU(raw.id);
  if (!id) failProtocol_ACU(`delta.infoGap[${index}] 的 patch 需要 id`);
  const patch: AgentInfoGapPatch_ACU = { id };
  if (typeof raw.topic === 'string' && raw.topic.trim()) patch.topic = raw.topic.trim();
  if (typeof raw.objectiveFact === 'string') patch.objectiveFact = raw.objectiveFact.trim();
  if (typeof raw.readerKnown === 'string') patch.readerKnown = raw.readerKnown.trim();
  if (Array.isArray(raw.characterKnowledge)) patch.characterKnowledge = parseCharacterKnowledge_ACU(raw.characterKnowledge);
  const revealStatus = readText_ACU(raw.revealStatus);
  if (revealStatus) {
    if (!(AGENT_REVEAL_STATUSES_ACU as readonly string[]).includes(revealStatus)) failProtocol_ACU(`delta.infoGap[${index}] 的 patch.revealStatus 非法：${revealStatus}`);
    patch.revealStatus = revealStatus as AgentInfoGapPatch_ACU['revealStatus'];
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'revealIndex')) {
    if (raw.revealIndex === null) patch.revealIndex = null;
    else if (typeof raw.revealIndex === 'number' && Number.isInteger(raw.revealIndex) && raw.revealIndex >= 0) patch.revealIndex = raw.revealIndex;
    else failProtocol_ACU(`delta.infoGap[${index}] 的 patch.revealIndex 必须是非负整数或 null`);
  }
  if (Object.keys(patch).length === 1) failProtocol_ACU(`delta.infoGap[${index}] 的 patch 至少要带一个要修改的字段`);
  return patch;
}

/** 契约里单条被拒的条目：合法条目已收下，只有这些需要模型重发。 */
export interface AgentContractRejection_ACU {
  module: 'hooks' | 'infoGap' | 'storyArc' | 'chronology';
  index: number;
  id: string;
  reason: string;
}

type RejectionSink_ACU = AgentContractRejection_ACU[] | undefined;

/**
 * 逐条解析时的收集包装：给了 sink 就把单条协议错误记下并跳过该条，没给就按原样抛出。
 * 数组本身不是数组这类结构错误不在此范围，始终抛出。
 */
function collectItem_ACU(sink: RejectionSink_ACU, module: AgentContractRejection_ACU['module'], index: number, raw: unknown, parse: () => void): void {
  try {
    parse();
  } catch (error) {
    if (!sink || !(error instanceof ContinuationValidationError_ACU) || error.error.code !== 'CONTINUATION_AGENT_PROTOCOL_INVALID') throw error;
    sink.push({ module, index, id: isRecord_ACU(raw) ? readText_ACU(raw.id) : '', reason: error.error.message });
  }
}

function parseHookItems_ACU(value: unknown, rejected?: RejectionSink_ACU): { items: AgentHookDeltaItem_ACU[]; patches: AgentHookPatch_ACU[] } {
  if (value === undefined || value === null) return { items: [], patches: [] };
  if (!Array.isArray(value)) failProtocol_ACU('delta.hooks 必须是数组');
  const items: AgentHookDeltaItem_ACU[] = [];
  const patches: AgentHookPatch_ACU[] = [];
  value.forEach((raw, index) => collectItem_ACU(rejected, 'hooks', index, raw, () => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.hooks[${index}] 必须是对象`);
    const action = readText_ACU(raw.action);
    if (action === 'patch') { patches.push(parseHookPatch_ACU(raw, index)); return; }
    if (action !== 'upsert' && action !== 'retire') failProtocol_ACU(`delta.hooks[${index}].action 必须是 upsert / patch / retire`);
    const status = readText_ACU(raw.status);
    const importance = readText_ACU(raw.importance);
    items.push({
      action,
      id: readText_ACU(raw.id),
      summary: readText_ACU(raw.summary),
      status: ((AGENT_HOOK_STATUSES_ACU as readonly string[]).includes(status) ? status : 'planted') as AgentHookDeltaItem_ACU['status'],
      importance: ((AGENT_HOOK_IMPORTANCES_ACU as readonly string[]).includes(importance) ? importance : 'mid') as AgentHookDeltaItem_ACU['importance'],
      plantedIndex: typeof raw.plantedIndex === 'number' && Number.isInteger(raw.plantedIndex) && raw.plantedIndex >= 0 ? raw.plantedIndex : -1,
      plannedPayoff: readText_ACU(raw.plannedPayoff),
      reason: readText_ACU(raw.reason),
    });
  }));
  return { items, patches };
}

function parseInfoGapItems_ACU(value: unknown, rejected?: RejectionSink_ACU): { items: AgentInfoGapDeltaItem_ACU[]; patches: AgentInfoGapPatch_ACU[] } {
  if (value === undefined || value === null) return { items: [], patches: [] };
  if (!Array.isArray(value)) failProtocol_ACU('delta.infoGap 必须是数组');
  const items: AgentInfoGapDeltaItem_ACU[] = [];
  const patches: AgentInfoGapPatch_ACU[] = [];
  value.forEach((raw, index) => collectItem_ACU(rejected, 'infoGap', index, raw, () => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.infoGap[${index}] 必须是对象`);
    const action = readText_ACU(raw.action);
    if (action === 'patch') { patches.push(parseInfoGapPatch_ACU(raw, index)); return; }
    if (action !== 'upsert' && action !== 'retire') failProtocol_ACU(`delta.infoGap[${index}].action 必须是 upsert / patch / retire`);
    const revealStatus = readText_ACU(raw.revealStatus);
    items.push({
      action,
      id: readText_ACU(raw.id),
      topic: readText_ACU(raw.topic),
      objectiveFact: readText_ACU(raw.objectiveFact),
      readerKnown: readText_ACU(raw.readerKnown),
      characterKnowledge: parseCharacterKnowledge_ACU(raw.characterKnowledge),
      revealStatus: ((AGENT_REVEAL_STATUSES_ACU as readonly string[]).includes(revealStatus) ? revealStatus : 'unrevealed') as AgentInfoGapDeltaItem_ACU['revealStatus'],
      revealIndex: typeof raw.revealIndex === 'number' && Number.isInteger(raw.revealIndex) && raw.revealIndex >= 0 ? raw.revealIndex : null,
      reason: readText_ACU(raw.reason),
    });
  }));
  return { items, patches };
}

function parseStageNumbers_ACU(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) failProtocol_ACU(`${path} 必须是阶段编号数组`);
  return value.map(item => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) failProtocol_ACU(`${path} 的元素必须是从 1 起的整数阶段编号，实际收到：${JSON.stringify(item)}`);
    return item;
  });
}

function parseTargetStageRange_ACU(value: unknown, path: string): { min: number; max: number } {
  if (!isRecord_ACU(value)) failProtocol_ACU(`${path} 必须是包含 min / max 的对象`);
  const { min, max } = value;
  if (!Number.isInteger(min) || (min as number) < 1 || !Number.isInteger(max) || (max as number) < 1) {
    failProtocol_ACU(`${path}.min / max 必须是从 1 起的整数`);
  }
  if ((min as number) > (max as number)) failProtocol_ACU(`${path}.min 不能大于 max`);
  return { min: min as number, max: max as number };
}

function parseStoryArcTextList_ACU(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) failProtocol_ACU(`${path} 必须是字符串数组`);
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) failProtocol_ACU(`${path}[${index}] 必须是非空字符串`);
    return item.trim();
  });
}

function parseNarrativeRole_ACU(value: unknown, path: string): AgentStoryArcPatch_ACU['narrativeRole'] {
  const role = readText_ACU(value);
  if (!(AGENT_VOLUME_NARRATIVE_ROLES_ACU as readonly string[]).includes(role)) {
    failProtocol_ACU(`${path} 必须是 ${AGENT_VOLUME_NARRATIVE_ROLES_ACU.join(' / ')}，实际收到：${role || '(空)'}`);
  }
  return role as AgentStoryArcPatch_ACU['narrativeRole'];
}

function parseStoryArcPatch_ACU(raw: Record<string, unknown>, index: number): AgentStoryArcPatch_ACU {
  const id = readText_ACU(raw.id);
  if (!id) failProtocol_ACU(`delta.storyArc[${index}] 的 patch 需要 id`);
  const patch: AgentStoryArcPatch_ACU = { id };
  if (typeof raw.title === 'string' && raw.title.trim()) patch.title = raw.title.trim();
  if (typeof raw.direction === 'string' && raw.direction.trim()) patch.direction = raw.direction.trim();
  if (typeof raw.escalation === 'string') patch.escalation = raw.escalation.trim();
  if (typeof raw.withheld === 'string') patch.withheld = raw.withheld.trim();
  const status = readText_ACU(raw.status);
  if (status) {
    if (!(AGENT_STORY_ARC_STATUSES_ACU as readonly string[]).includes(status)) failProtocol_ACU(`delta.storyArc[${index}] 的 patch.status 非法：${status}，只能是 ${AGENT_STORY_ARC_STATUSES_ACU.join(' / ')}`);
    patch.status = status as AgentStoryArcPatch_ACU['status'];
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'stageNumbers')) patch.stageNumbers = parseStageNumbers_ACU(raw.stageNumbers, `delta.storyArc[${index}].stageNumbers`);
  if (Object.prototype.hasOwnProperty.call(raw, 'completionStageNumber')) {
    const value = raw.completionStageNumber;
    if (value !== null && (!Number.isInteger(value) || (value as number) < 1)) {
      failProtocol_ACU(`delta.storyArc[${index}].completionStageNumber 必须是从 1 起的整数或 null`);
    }
    patch.completionStageNumber = value as number | null;
  }
  if (typeof raw.completionState === 'string') patch.completionState = raw.completionState.trim();
  if (typeof raw.continuationRationale === 'string') patch.continuationRationale = raw.continuationRationale.trim();
  if (Object.prototype.hasOwnProperty.call(raw, 'narrativeRole')) patch.narrativeRole = parseNarrativeRole_ACU(raw.narrativeRole, `delta.storyArc[${index}].narrativeRole`);
  if (Object.prototype.hasOwnProperty.call(raw, 'targetStageRange')) patch.targetStageRange = parseTargetStageRange_ACU(raw.targetStageRange, `delta.storyArc[${index}].targetStageRange`);
  for (const key of ['targetTimeSpan', 'progressCeiling', 'completionRationale'] as const) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      if (typeof raw[key] !== 'string') failProtocol_ACU(`delta.storyArc[${index}].${key} 必须是字符串`);
      patch[key] = raw[key].trim();
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sustainingThreads')) patch.sustainingThreads = parseStoryArcTextList_ACU(raw.sustainingThreads, `delta.storyArc[${index}].sustainingThreads`);
  if (Object.prototype.hasOwnProperty.call(raw, 'payoffTargets')) patch.payoffTargets = parseStoryArcTextList_ACU(raw.payoffTargets, `delta.storyArc[${index}].payoffTargets`);
  if (Object.keys(patch).length === 1) failProtocol_ACU(`delta.storyArc[${index}] 的 patch 至少要带一个要修改的字段`);
  return patch;
}

function parseStoryArcItems_ACU(value: unknown, rejected?: RejectionSink_ACU): { items: AgentStoryArcDeltaItem_ACU[]; patches: AgentStoryArcPatch_ACU[] } {
  if (value === undefined || value === null) return { items: [], patches: [] };
  if (!Array.isArray(value)) failProtocol_ACU('delta.storyArc 必须是数组');
  const items: AgentStoryArcDeltaItem_ACU[] = [];
  const patches: AgentStoryArcPatch_ACU[] = [];
  value.forEach((raw, index) => collectItem_ACU(rejected, 'storyArc', index, raw, () => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.storyArc[${index}] 必须是对象`);
    const action = readText_ACU(raw.action);
    if (action === 'patch') { patches.push(parseStoryArcPatch_ACU(raw, index)); return; }
    if (action !== 'upsert' && action !== 'retire') failProtocol_ACU(`delta.storyArc[${index}].action 必须是 upsert / patch / retire`);
    const scope = readText_ACU(raw.scope);
    // scope 决定这条是全书方向还是卷台阶，写错会让唯一性约束落在错误的层级上，不能静默回落。
    if (action === 'upsert' && !(AGENT_STORY_ARC_SCOPES_ACU as readonly string[]).includes(scope)) {
      failProtocol_ACU(`delta.storyArc[${index}].scope 必须是 ${AGENT_STORY_ARC_SCOPES_ACU.join(' / ')}，实际收到：${scope || '(空)'}`);
    }
    const status = readText_ACU(raw.status);
    if (action === 'upsert' && status && !(AGENT_STORY_ARC_STATUSES_ACU as readonly string[]).includes(status)) {
      failProtocol_ACU(`delta.storyArc[${index}].status 必须是 ${AGENT_STORY_ARC_STATUSES_ACU.join(' / ')}，实际收到：${status}`);
    }
    items.push({
      action,
      id: readText_ACU(raw.id),
      scope: (scope || 'volume') as AgentStoryArcDeltaItem_ACU['scope'],
      title: readText_ACU(raw.title),
      direction: readText_ACU(raw.direction),
      escalation: readText_ACU(raw.escalation),
      withheld: readText_ACU(raw.withheld),
      status: (status || 'planned') as AgentStoryArcDeltaItem_ACU['status'],
      statusProvided: !!status,
      stageNumbers: raw.stageNumbers === undefined ? [] : parseStageNumbers_ACU(raw.stageNumbers, `delta.storyArc[${index}].stageNumbers`),
      completionStageNumber: raw.completionStageNumber === undefined || raw.completionStageNumber === null ? null : (typeof raw.completionStageNumber === 'number' && Number.isInteger(raw.completionStageNumber) && raw.completionStageNumber >= 1 ? raw.completionStageNumber : failProtocol_ACU(`delta.storyArc[${index}].completionStageNumber 必须是从 1 起的整数或 null`)),
      completionState: readText_ACU(raw.completionState),
      continuationRationale: readText_ACU(raw.continuationRationale),
      narrativeRole: raw.narrativeRole === undefined ? undefined : parseNarrativeRole_ACU(raw.narrativeRole, `delta.storyArc[${index}].narrativeRole`),
      targetStageRange: raw.targetStageRange === undefined ? undefined : parseTargetStageRange_ACU(raw.targetStageRange, `delta.storyArc[${index}].targetStageRange`),
      targetTimeSpan: raw.targetTimeSpan === undefined
        ? undefined
        : (typeof raw.targetTimeSpan === 'string'
          ? raw.targetTimeSpan.trim()
          : failProtocol_ACU(`delta.storyArc[${index}].targetTimeSpan 必须是字符串`)),
      progressCeiling: raw.progressCeiling === undefined
        ? undefined
        : (typeof raw.progressCeiling === 'string'
          ? raw.progressCeiling.trim()
          : failProtocol_ACU(`delta.storyArc[${index}].progressCeiling 必须是字符串`)),
      sustainingThreads: raw.sustainingThreads === undefined ? undefined : parseStoryArcTextList_ACU(raw.sustainingThreads, `delta.storyArc[${index}].sustainingThreads`),
      payoffTargets: raw.payoffTargets === undefined ? undefined : parseStoryArcTextList_ACU(raw.payoffTargets, `delta.storyArc[${index}].payoffTargets`),
      completionRationale: raw.completionRationale === undefined
        ? undefined
        : (typeof raw.completionRationale === 'string'
          ? raw.completionRationale.trim()
          : failProtocol_ACU(`delta.storyArc[${index}].completionRationale 必须是字符串`)),
      reason: readText_ACU(raw.reason),
    });
  }));
  return { items, patches };
}

/**
 * 解析年代学写集。时间事实的登记契约是硬边界：非法 action、非法 precision、非空必填
 * 文本缺失、证据数组为空或含非整数楼层都必须拒绝——把坏时间记录静默降级会污染后续
 * 每一次时间一致性审查的基准。
 */
function parseChronologyItems_ACU(value: unknown, rejected?: RejectionSink_ACU): AgentChronologyDeltaItem_ACU[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) failProtocol_ACU('delta.chronology 必须是数组');
  const items: AgentChronologyDeltaItem_ACU[] = [];
  value.forEach((raw, index) => collectItem_ACU(rejected, 'chronology', index, raw, () => {
    if (!isRecord_ACU(raw)) failProtocol_ACU(`delta.chronology[${index}] 必须是对象`);
    const action = readText_ACU(raw.action);
    if (action !== 'upsert' && action !== 'retire') failProtocol_ACU(`delta.chronology[${index}].action 必须是 upsert / retire，实际收到：${action || '(空)'}`);
    const id = readText_ACU(raw.id);
    if (!id) failProtocol_ACU(`delta.chronology[${index}] 需要非空 id`);
    if (action === 'retire') {
      items.push({ action, id, anchor: readText_ACU(raw.anchor), elapsed: readText_ACU(raw.elapsed), precision: 'unknown' as const, transition: readText_ACU(raw.transition), evidenceIndexes: [] as number[], reason: readText_ACU(raw.reason) });
      return;
    }
    const anchor = readText_ACU(raw.anchor);
    const elapsed = readText_ACU(raw.elapsed);
    const transition = readText_ACU(raw.transition);
    if (!anchor) failProtocol_ACU(`delta.chronology[${index}].anchor 不能为空：必须给出可用于正文定位的相对时间锚`);
    if (!elapsed) failProtocol_ACU(`delta.chronology[${index}].elapsed 不能为空：无法可靠量化时明确写「未知」或「约……」`);
    if (!transition) failProtocol_ACU(`delta.chronology[${index}].transition 不能为空：写清从上一锚点到本锚点实际发生的时间转换`);
    const precision = readText_ACU(raw.precision);
    if (!(AGENT_CHRONOLOGY_PRECISIONS_ACU as readonly string[]).includes(precision)) {
      failProtocol_ACU(`delta.chronology[${index}].precision 必须是 ${AGENT_CHRONOLOGY_PRECISIONS_ACU.join(' / ')}，实际收到：${precision || '(空)'}`);
    }
    if (!Array.isArray(raw.evidenceIndexes) || !raw.evidenceIndexes.length) {
      failProtocol_ACU(`delta.chronology[${index}].evidenceIndexes 必须是非空数组：每条时间事实都要引用真实正文楼层`);
    }
    const evidenceIndexes = raw.evidenceIndexes.map(item => {
      if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
        failProtocol_ACU(`delta.chronology[${index}].evidenceIndexes 的元素必须是非负整数楼层号，实际收到：${JSON.stringify(item)}`);
      }
      return item;
    });
    items.push({
      action,
      id,
      anchor,
      elapsed,
      precision: precision as AgentChronologyDeltaItem_ACU['precision'],
      transition,
      evidenceIndexes: [...new Set(evidenceIndexes)].sort((left, right) => left - right),
      reason: readText_ACU(raw.reason),
    });
  }));
  return items;
}

function parseExpectedRevisions_ACU(value: unknown): AgentModuleDelta_ACU['expectedRevisions'] {
  if (!isRecord_ACU(value)) return {};
  const result: AgentModuleDelta_ACU['expectedRevisions'] = {};
  for (const key of ['hooks', 'infoGap', 'constraints', 'storyArc', 'chronology', 'webRefs'] as const) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) result[key] = raw;
  }
  return result;
}

/**
 * 解析维护类子代理的输出。
 * @param payload 已解析的 JSON 载荷
 * @returns 摘要 + 写集事务 + 追加读取请求
 */
export function parseAgentMaintainerOutput_ACU(payload: Record<string, unknown>): AgentMaintainerOutput_ACU {
  const draft = parseAgentMaintainerOutputDraft_ACU(payload);
  if (draft.rejected.length) failProtocol_ACU(draft.rejected[0].reason, { rejected: draft.rejected.length });
  return draft.output;
}

export interface AgentMaintainerOutputDraft_ACU {
  output: AgentMaintainerOutput_ACU;
  rejected: AgentContractRejection_ACU[];
}

/**
 * 维护/总纲契约的草稿解析：合法条目收进 output，单条非法的记进 rejected 而不是整份拒绝，
 * 让运行时只向模型索要需要修正的那几条。数组结构本身非法仍然抛出。
 * @param payload 已解析的 JSON 载荷
 */
/**
 * 把模型常写的错位形状归一化到 delta.storyArc：顶层 storyArc / volumes、delta.volumes、
 * 以 id 为键的对象。这些以前会被静默忽略成“0 条写入”，让一份写满卷台阶的输出白白作废。
 */
function normalizeStoryArcShape_ACU(payload: Record<string, unknown>, rawDelta: Record<string, unknown>): unknown {
  const candidates = [rawDelta.storyArc, rawDelta.volumes, rawDelta.story_arc, payload.storyArc, payload.volumes, payload.story_arc];
  const merged: unknown[] = [];
  let sawAlternative = false;
  candidates.forEach((candidate, index) => {
    if (Array.isArray(candidate)) {
      if (index > 0 && candidate.length) sawAlternative = true;
      merged.push(...candidate);
    } else if (isRecord_ACU(candidate) && Object.keys(candidate).length) {
      sawAlternative = true;
      merged.push(...Object.entries(candidate).map(([id, value]) => (isRecord_ACU(value) ? { id, action: 'upsert', ...value } : value)));
    }
  });
  // 只有标准位置且为空/缺失时保持原值，让“未提供”与“提供了空数组”的语义与其他模块一致。
  if (!sawAlternative && !merged.length) return rawDelta.storyArc;
  return merged;
}

export function parseAgentMaintainerOutputDraft_ACU(payload: Record<string, unknown>): AgentMaintainerOutputDraft_ACU {
  const rawDelta = isRecord_ACU(payload.delta) ? payload.delta : {};
  const rejected: AgentContractRejection_ACU[] = [];
  const hooks = parseHookItems_ACU(rawDelta.hooks, rejected);
  const infoGap = parseInfoGapItems_ACU(rawDelta.infoGap, rejected);
  const storyArc = parseStoryArcItems_ACU(normalizeStoryArcShape_ACU(payload, rawDelta), rejected);
  const chronology = parseChronologyItems_ACU(rawDelta.chronology, rejected);
  return {
    output: {
      summary: readText_ACU(payload.summary),
      delta: {
        expectedRevisions: parseExpectedRevisions_ACU(rawDelta.expectedRevisions ?? payload.expectedRevisions),
        hooks: hooks.items,
        hookPatches: hooks.patches,
        infoGap: infoGap.items,
        infoGapPatches: infoGap.patches,
        storyArc: storyArc.items,
        storyArcPatches: storyArc.patches,
        chronology,
        constraintProposals: readTextList_ACU(rawDelta.constraintProposals),
      },
    },
    rejected,
  };
}

/**
 * 按 (模块, id) 把后一份契约草稿合并进前一份：同 id 后者覆盖，新 id 追加，约束提议取并集，
 * 摘要与 expectedRevisions 以首次非空为准。用于截断续写与条目修补的多轮累积。
 * @param base 已累积的输出
 * @param incoming 本轮新收到的输出
 */
export function mergeAgentMaintainerOutputs_ACU(base: AgentMaintainerOutput_ACU, incoming: AgentMaintainerOutput_ACU): AgentMaintainerOutput_ACU {
  const mergeById = <T extends { id: string }>(left: readonly T[], right: readonly T[]): T[] => {
    const byId = new Map<string, T>();
    const order: string[] = [];
    let anonymous = 0;
    for (const item of [...left, ...right]) {
      const key = item.id.trim() || `__anonymous_${anonymous++}`;
      if (!byId.has(key)) order.push(key);
      byId.set(key, item);
    }
    return order.map(key => byId.get(key)!);
  };
  const revisions = { ...incoming.delta.expectedRevisions, ...base.delta.expectedRevisions };
  return {
    summary: base.summary || incoming.summary,
    delta: {
      expectedRevisions: revisions,
      hooks: mergeById(base.delta.hooks, incoming.delta.hooks),
      hookPatches: mergeById(base.delta.hookPatches, incoming.delta.hookPatches),
      infoGap: mergeById(base.delta.infoGap, incoming.delta.infoGap),
      infoGapPatches: mergeById(base.delta.infoGapPatches, incoming.delta.infoGapPatches),
      storyArc: mergeById(base.delta.storyArc, incoming.delta.storyArc),
      storyArcPatches: mergeById(base.delta.storyArcPatches, incoming.delta.storyArcPatches),
      chronology: mergeById(base.delta.chronology, incoming.delta.chronology),
      constraintProposals: [...new Set([...base.delta.constraintProposals, ...incoming.delta.constraintProposals])],
    },
  };
}

/**
 * 渲染截断/条目修补的续写请求：告诉模型哪些条目已收下（不要重发）、哪些条目要修正、
 * 以及输出是否在中途被截断需要从下一条继续。回复只需含剩余/修正条目。
 */
export function renderAgentContractContinuationRequest_ACU(accepted: AgentMaintainerOutput_ACU, rejected: readonly AgentContractRejection_ACU[], truncated: boolean): string {
  const acceptedIds: string[] = [];
  for (const [label, list] of [
    ['伏笔', [...accepted.delta.hooks, ...accepted.delta.hookPatches]],
    ['信息差', [...accepted.delta.infoGap, ...accepted.delta.infoGapPatches]],
    ['总纲', [...accepted.delta.storyArc, ...accepted.delta.storyArcPatches]],
    ['年代学', accepted.delta.chronology],
  ] as const) {
    const ids = list.map(item => item.id).filter(Boolean);
    if (ids.length) acceptedIds.push(`${label}：${ids.join('、')}`);
  }
  const lines: string[] = [];
  if (truncated) {
    lines.push('你上一次的输出在 JSON 中途被截断。截断前已写完整的条目已经收下，不要重发它们；请从被截断的那一条开始，只输出剩余条目。');
  } else {
    lines.push('你上一次的输出大部分已收下，只有下列条目不符合契约，请只重发这些条目（修正后），其余不要重发。');
  }
  if (acceptedIds.length) lines.push(`已收下的条目：${acceptedIds.join('；')}。`);
  if (rejected.length) {
    lines.push('需要修正的条目：');
    for (const item of rejected) lines.push(`- ${item.module}[${item.index}]${item.id ? `（id=${item.id}）` : ''}：${item.reason}`);
  }
  lines.push('回复格式与原契约相同，只是 delta 里各数组只放剩余或修正的条目；summary 可省略；所有条目都写完时 delta 各数组为空即可。');
  return lines.join('\n');
}

/**
 * 解析策划类子代理的输出。外层字段结构化，创作内容保持自然语言。
 * @param payload 已解析的 JSON 载荷
 * @returns 摘要、建议正文、必须保留项与风险项
 */
export function parseAgentPlannerOutput_ACU(payload: Record<string, unknown>): AgentPlannerOutput_ACU {
  const recommendation = readText_ACU(payload.recommendation);
  if (!recommendation) failProtocol_ACU('策划子代理必须给出 recommendation；资料不足时应先输出 read / search 工具调用补齐资料');
  return {
    summary: readText_ACU(payload.summary),
    recommendation,
    mustPreserve: readTextList_ACU(payload.mustPreserve),
    risks: readTextList_ACU(payload.risks),
  };
}

/**
 * 解析审查类子代理的输出。
 * @param payload 已解析的 JSON 载荷
 * @returns 判词、理由与修正建议
 */
export function parseAgentReviewerOutput_ACU(payload: Record<string, unknown>): AgentReviewerOutput_ACU {
  const verdict = readText_ACU(payload.verdict);
  if (!(AGENT_REVIEW_VERDICTS_ACU as readonly string[]).includes(verdict)) {
    failProtocol_ACU(`审查子代理的 verdict 必须是 pass / revise / block，实际收到：${verdict || '(空)'}；资料不足时应先输出 read / search 工具调用`);
  }
  return {
    verdict: verdict as AgentReviewerOutput_ACU['verdict'],
    reason: readText_ACU(payload.reason),
    fixes: readTextList_ACU(payload.fixes),
  };
}

/** 解析发送前最终审查的结构化只读反馈。 */
export function parseAgentFinalReviewerOutput_ACU(payload: Record<string, unknown>): AgentFinalReviewerOutput_ACU {
  const verdict = readText_ACU(payload.verdict);
  if (!(AGENT_REVIEW_VERDICTS_ACU as readonly string[]).includes(verdict)) {
    failProtocol_ACU(`最终审查的 verdict 必须是 pass / revise / block，实际收到：${verdict || '(空)'}；资料不足时应先输出 read / search 工具调用`);
  }
  return {
    verdict: verdict as AgentFinalReviewerOutput_ACU['verdict'],
    summary: readText_ACU(payload.summary),
    emotionFindings: readTextList_ACU(payload.emotionFindings),
    worldFindings: readTextList_ACU(payload.worldFindings),
    logicFindings: readTextList_ACU(payload.logicFindings),
    requiredFixes: readTextList_ACU(payload.requiredFixes),
    preserve: readTextList_ACU(payload.preserve),
  };
}

/** 把协议错误压成可回喂给模型的紧凑单行原因串。 */
export function compactAgentProtocolError_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return `${error.error.code}: ${error.error.message}`;
  return error instanceof Error ? error.message : String(error);
}
