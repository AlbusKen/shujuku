/**
 * service/continuation/agent/agent-protocol.ts — Agent 文本协议解析
 *
 * 内部 AI 没有原生工具调用能力，所有动作都通过模型输出的 JSON 块表达。
 * 项目里既有的大纲链路证明：尾部 assistant 段在实际后端只起格式示范作用，
 * 模型常常重新完整输出而不是续写。所以解析必须同时容忍两种返回形态：
 * 直接输出完整 JSON，或只续写预填充之后的部分。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_HOOK_IMPORTANCES_ACU,
  AGENT_HOOK_STATUSES_ACU,
  AGENT_REVEAL_STATUSES_ACU,
  AGENT_REVIEW_VERDICTS_ACU,
  AGENT_SEARCH_SCOPES_ACU,
  AGENT_STORY_ARC_SCOPES_ACU,
  AGENT_STORY_ARC_STATUSES_ACU,
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

/**
 * 解析一份 Agent 协议载荷。对返回形态宽容：模型可以完整重输 JSON、只续写预填充、
 * 或在 JSON 前后写自然语言——运行时按判别键从全文中挑出正确的动作对象。
 * @param raw 模型返回的原始文本
 * @param prefill 该请求尾段预填充文本，可为空
 * @param requiredKeys 协议对象的判别键，含任意一个即视为目标对象；缺省不判别
 * @returns 解析出的对象
 */
export function parseAgentJsonPayload_ACU(raw: string | null | undefined, prefill = '', requiredKeys: readonly string[] = []): Record<string, unknown> {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) failProtocol_ACU('内部 AI 返回为空');
  // 剥掉围栏后以 { 开头视为完整重输，原文优先；否则视为续写预填充，拼接候选优先。
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  let firstParsed: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    for (const extracted of extractJsonObjects_ACU(candidate)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extracted);
      } catch {
        continue;
      }
      if (!isRecord_ACU(parsed)) continue;
      if (!requiredKeys.length || requiredKeys.some(key => key in parsed)) return parsed;
      if (!firstParsed) firstParsed = parsed;
    }
  }
  // 没有对象命中判别键时退回首个可解析对象，让上层契约校验给出准确的字段级报错。
  if (firstParsed) return firstParsed;
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
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) failProtocol_ACU('内部 AI 返回为空');
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records: Record<string, unknown>[] = [];
    for (const extracted of extractJsonObjects_ACU(candidate)) {
      try {
        const parsed = JSON.parse(extracted);
        if (isRecord_ACU(parsed) && 'action' in parsed) records.push(parsed);
      } catch { /* 无法解析的碎片直接跳过，由后续候选或报错兜底。 */ }
    }
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
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) return null;
  const looksComplete = stripMarkdownFences_ACU(text).startsWith('{');
  const candidates = looksComplete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const toolRecords: Record<string, unknown>[] = [];
    let sawAnyRecord = false;
    for (const extracted of extractJsonObjects_ACU(candidate)) {
      try {
        const parsed = JSON.parse(extracted);
        if (!isRecord_ACU(parsed)) continue;
        sawAnyRecord = true;
        const action = readText_ACU(parsed.action);
        if (action === 'read' || action === 'search') toolRecords.push(parsed);
      } catch { /* 跳过碎片 */ }
    }
    if (toolRecords.length) return toolRecords.slice(0, AGENT_TOOL_BATCH_LIMIT_ACU).map(parseAgentToolCall_ACU);
    if (sawAnyRecord) return null;
  }
  return null;
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

function parseHookItems_ACU(value: unknown): { items: AgentHookDeltaItem_ACU[]; patches: AgentHookPatch_ACU[] } {
  if (value === undefined || value === null) return { items: [], patches: [] };
  if (!Array.isArray(value)) failProtocol_ACU('delta.hooks 必须是数组');
  const items: AgentHookDeltaItem_ACU[] = [];
  const patches: AgentHookPatch_ACU[] = [];
  value.forEach((raw, index) => {
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
  });
  return { items, patches };
}

function parseInfoGapItems_ACU(value: unknown): { items: AgentInfoGapDeltaItem_ACU[]; patches: AgentInfoGapPatch_ACU[] } {
  if (value === undefined || value === null) return { items: [], patches: [] };
  if (!Array.isArray(value)) failProtocol_ACU('delta.infoGap 必须是数组');
  const items: AgentInfoGapDeltaItem_ACU[] = [];
  const patches: AgentInfoGapPatch_ACU[] = [];
  value.forEach((raw, index) => {
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
  });
  return { items, patches };
}

function parseStageNumbers_ACU(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) failProtocol_ACU(`${path} 必须是阶段编号数组`);
  return value.map(item => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) failProtocol_ACU(`${path} 的元素必须是从 1 起的整数阶段编号，实际收到：${JSON.stringify(item)}`);
    return item;
  });
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
  if (Object.keys(patch).length === 1) failProtocol_ACU(`delta.storyArc[${index}] 的 patch 至少要带一个要修改的字段`);
  return patch;
}

function parseStoryArcItems_ACU(value: unknown): { items: AgentStoryArcDeltaItem_ACU[]; patches: AgentStoryArcPatch_ACU[] } {
  if (value === undefined || value === null) return { items: [], patches: [] };
  if (!Array.isArray(value)) failProtocol_ACU('delta.storyArc 必须是数组');
  const items: AgentStoryArcDeltaItem_ACU[] = [];
  const patches: AgentStoryArcPatch_ACU[] = [];
  value.forEach((raw, index) => {
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
      stageNumbers: raw.stageNumbers === undefined ? [] : parseStageNumbers_ACU(raw.stageNumbers, `delta.storyArc[${index}].stageNumbers`),
      completionStageNumber: raw.completionStageNumber === undefined || raw.completionStageNumber === null ? null : (typeof raw.completionStageNumber === 'number' && Number.isInteger(raw.completionStageNumber) && raw.completionStageNumber >= 1 ? raw.completionStageNumber : failProtocol_ACU(`delta.storyArc[${index}].completionStageNumber 必须是从 1 起的整数或 null`)),
      completionState: readText_ACU(raw.completionState),
      continuationRationale: readText_ACU(raw.continuationRationale),
      reason: readText_ACU(raw.reason),
    });
  });
  return { items, patches };
}

function parseExpectedRevisions_ACU(value: unknown): AgentModuleDelta_ACU['expectedRevisions'] {
  if (!isRecord_ACU(value)) return {};
  const result: AgentModuleDelta_ACU['expectedRevisions'] = {};
  for (const key of ['hooks', 'infoGap', 'constraints', 'storyArc'] as const) {
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
  const rawDelta = isRecord_ACU(payload.delta) ? payload.delta : {};
  const hooks = parseHookItems_ACU(rawDelta.hooks);
  const infoGap = parseInfoGapItems_ACU(rawDelta.infoGap);
  const storyArc = parseStoryArcItems_ACU(rawDelta.storyArc);
  return {
    summary: readText_ACU(payload.summary),
    delta: {
      expectedRevisions: parseExpectedRevisions_ACU(rawDelta.expectedRevisions ?? payload.expectedRevisions),
      hooks: hooks.items,
      hookPatches: hooks.patches,
      infoGap: infoGap.items,
      infoGapPatches: infoGap.patches,
      storyArc: storyArc.items,
      storyArcPatches: storyArc.patches,
      constraintProposals: readTextList_ACU(rawDelta.constraintProposals),
    },
  };
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
