import { WORLD_SIMULATION_LEDGER_MODULES_ACU, WORLD_SIMULATION_SCHEMA_VERSION_ACU, WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationStagePlan_ACU } from '../model';
import { findUnauthorizedWorldSimulationEvidenceRefs_ACU, type WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { WORLD_SIMULATION_TOOL_ADDRESSES_ACU } from '../world-simulation-agent-tools';
import type { WorldSimulationMainAction_ACU, WorldSimulationPlannerOutput_ACU, WorldSimulationProtocolIssue_ACU, WorldSimulationReviewerResult_ACU, WorldSimulationSpecialistResult_ACU } from './agent-model';

const SCAN_LIMIT_ACU = 6;
const TERMINALS_ACU = ['commit', 'no_change', 'blocked'] as const;
const isRecord_ACU = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text_ACU = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const texts_ACU = (value: unknown): string[] => Array.isArray(value) ? value.map(text_ACU).filter(Boolean) : [];

function fail_ACU(reasonCode: string, path: string, expected: string, actual: unknown): never {
  const issue: WorldSimulationProtocolIssue_ACU = { reasonCode, path, expected, actual };
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_loop', `${reasonCode}: ${path} 应为 ${expected}`, true, { ...issue }));
}

function stripNoise_ACU(raw: string): string {
  return raw
    .replace(/<(think|thinking|reasoning|thought|analysis)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(think|thinking|reasoning|thought|analysis)(?:\s[^>]*)?>/gi, '')
    .replace(/<\/?WORLD_SIMULATION_ENGINE_SEAM:[^>]*>/gi, '')
    .replace(/```[a-zA-Z]*\n?/g, '').trim();
}

function balanced_ACU(text: string, start: number): { json: string; end: number } | null {
  let depth = 0; let inString = false; let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && inString) { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return { json: text.slice(start, index + 1), end: index + 1 };
  }
  return null;
}

export function extractFirstWorldSimulationJsonObject_ACU(text: string): string | null {
  const start = String(text ?? '').indexOf('{');
  return start < 0 ? null : balanced_ACU(text, start)?.json ?? null;
}

export function extractWorldSimulationJsonObjects_ACU(text: string): string[] {
  const result: string[] = []; let cursor = 0;
  while (result.length < SCAN_LIMIT_ACU) {
    const start = text.indexOf('{', cursor); if (start < 0) break;
    const found = balanced_ACU(text, start); if (!found) { cursor = start + 1; continue; }
    result.push(found.json); cursor = found.end;
  }
  return result;
}

function parseLoose_ACU(text: string): unknown {
  try { return JSON.parse(text); } catch { /* limited formatting repair */ }
  const repaired = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3').replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(repaired); } catch { return undefined; }
}

function objects_ACU(candidate: string): Record<string, unknown>[] {
  return extractWorldSimulationJsonObjects_ACU(candidate).map(parseLoose_ACU).filter(isRecord_ACU);
}

export function parseWorldSimulationJsonPayload_ACU(raw: string | null | undefined, prefill = '', requiredKeys: readonly string[] = []): Record<string, unknown> {
  const text = stripNoise_ACU(String(raw ?? '')); if (!text) fail_ACU('EMPTY_RESPONSE', '$', 'non-empty JSON output', raw);
  const complete = text.startsWith('{'); const candidates = complete || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  let first: Record<string, unknown> | null = null;
  for (const candidate of candidates) for (const parsed of objects_ACU(candidate)) { if (!first) first = parsed; if (!requiredKeys.length || requiredKeys.some(key => key in parsed)) return parsed; }
  if (first) return first;
  fail_ACU('JSON_NOT_FOUND', '$', 'balanced JSON object', text.slice(0, 300));
}

export interface WorldSimulationJsonDraft_ACU { payload: Record<string, unknown>; truncated: boolean; }

function salvageDraft_ACU(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false; let escaped = false; let safe = -1; let safeStack: string[] = [];
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && inString) { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
    else if (char === '}' || char === ']') {
      if (!stack.length || stack[stack.length - 1] !== char) return null;
      stack.pop();
      if (!stack.length) return null;
      safe = index + 1; safeStack = [...stack];
    }
  }
  if (safe < 0 || !stack.length) return null;
  return `${text.slice(start, safe).replace(/,\s*$/, '')}${safeStack.reverse().join('')}`;
}

export function parseWorldSimulationJsonDraft_ACU(raw: string | null | undefined, prefill = '', requiredKeys: readonly string[] = []): WorldSimulationJsonDraft_ACU {
  const text = stripNoise_ACU(String(raw ?? ''));
  if (!text) fail_ACU('EMPTY_RESPONSE', '$', 'non-empty JSON output', raw);
  const candidates = text.startsWith('{') || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  let first: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start < 0) continue;
    if (balanced_ACU(candidate, start)) {
      for (const parsed of objects_ACU(candidate)) {
        if (!first) first = parsed;
        if (!requiredKeys.length || requiredKeys.some(key => key in parsed)) return { payload: parsed, truncated: false };
      }
      continue;
    }
    const salvaged = salvageDraft_ACU(candidate);
    const parsed = salvaged ? parseLoose_ACU(salvaged) : undefined;
    if (isRecord_ACU(parsed) && (!requiredKeys.length || requiredKeys.some(key => key in parsed))) return { payload: parsed, truncated: true };
  }
  if (first) return { payload: first, truncated: false };
  fail_ACU('JSON_NOT_FOUND', '$', 'balanced or salvageable JSON object', text.slice(0, 300));
}

function requiredText_ACU(value: unknown, path: string): string {
  const result = text_ACU(value);
  if (!result) fail_ACU('REQUIRED_TEXT', path, 'non-empty string', value);
  return result;
}
function optionalList_ACU(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  const result = texts_ACU(value);
  if (!Array.isArray(value) || result.length !== value.length) fail_ACU('TEXT_LIST', path, 'string array', value);
  return result;
}
function requiredList_ACU(value: unknown, path: string): string[] {
  const result = texts_ACU(value);
  if (!Array.isArray(value) || !result.length || result.length !== value.length) fail_ACU('REQUIRED_TEXT_LIST', path, 'non-empty string array', value);
  return result;
}

function authorizedEvidenceRefs_ACU(value: unknown, path: string, required: boolean, snapshot?: WorldSimulationEvidenceRegistrySnapshot_ACU): string[] {
  const refs = required ? requiredList_ACU(value, path) : optionalList_ACU(value, path);
  const unauthorized = findUnauthorizedWorldSimulationEvidenceRefs_ACU(refs, snapshot);
  if (unauthorized.length) fail_ACU(snapshot ? 'EVIDENCE_REF_UNAUTHORIZED' : 'EVIDENCE_REGISTRY_REQUIRED', path, 'refs registered in current run', unauthorized);
  return refs;
}

const SAFE_TOOL_REQUEST_METADATA_ACU = new Set(['evidenceRef', 'purpose']);
function normalizeToolRequestMetadata_ACU(value: Record<string, unknown>, action: string): Record<string, unknown> {
  if (action !== 'read' && action !== 'search') return value;
  const normalized = { ...value };
  for (const key of SAFE_TOOL_REQUEST_METADATA_ACU) delete normalized[key];
  return normalized;
}

function isAuthorizedToolAddress_ACU(address: string): boolean {
  return WORLD_SIMULATION_TOOL_ADDRESSES_ACU.some(allowed => allowed.endsWith(':')
    ? address.startsWith(allowed) && address.length > allowed.length
    : address === allowed);
}

const LEGACY_TOOL_ADDRESS_ALIASES_ACU: Readonly<Record<string, string>> = {
  '$WORLD_LEDGER': 'ledger:current',
  '$CLOCK': 'ledger:current',
  '$WORLD_SUMMARY': 'summary:current',
};

function normalizeToolAddress_ACU(value: unknown): string {
  const address = text_ACU(value);
  return LEGACY_TOOL_ADDRESS_ALIASES_ACU[address] ?? address;
}

function normalizeLegacyToolAction_ACU(value: Record<string, unknown>): Record<string, unknown> {
  if (text_ACU(value.action)) return value;
  const keys = Object.keys(value);
  const allowed = new Set(['address', 'reads', ...SAFE_TOOL_REQUEST_METADATA_ACU]);
  if (keys.some(key => !allowed.has(key))) return value;
  const address = normalizeToolAddress_ACU(value.address);
  if (address && isAuthorizedToolAddress_ACU(address)) return { action: 'read', reads: [address] };
  if (Array.isArray(value.reads)) {
    const reads = value.reads.map(normalizeToolAddress_ACU).filter(Boolean);
    if (reads.length === value.reads.length && reads.length > 0 && reads.every(isAuthorizedToolAddress_ACU)) return { action: 'read', reads };
  }
  return value;
}

function normalizeReadAction_ACU(value: Record<string, unknown>): Record<string, unknown> {
  if (text_ACU(value.action) !== 'read') return value;
  const normalized = normalizeToolRequestMetadata_ACU(value, 'read');
  if (normalized.reads === undefined && normalized.address !== undefined) {
    const { address: _address, ...rest } = normalized;
    return { ...rest, reads: [normalizeToolAddress_ACU(normalized.address)] };
  }
  if (typeof normalized.reads === 'string') return { ...normalized, reads: [normalizeToolAddress_ACU(normalized.reads)] };
  if (Array.isArray(normalized.reads)) return { ...normalized, reads: normalized.reads.map(normalizeToolAddress_ACU) };
  return normalized;
}

export function parseWorldSimulationMainAction_ACU(value: unknown, allowDelegate = true, evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU): WorldSimulationMainAction_ACU {
  if (!isRecord_ACU(value)) fail_ACU('OBJECT_REQUIRED', '$', 'object', value);
  const normalizedValue = normalizeLegacyToolAction_ACU(value);
  const action = text_ACU(normalizedValue.action);
  if (action === 'read') {
    const raw = closedObject_ACU(normalizeReadAction_ACU(normalizedValue), '$', ['action', 'reads']);
    const reads = requiredList_ACU(raw.reads, '$.reads');
    const invalid = reads.find(address => !isAuthorizedToolAddress_ACU(address));
    if (invalid) fail_ACU('INVALID_TOOL_ADDRESS', '$.reads', WORLD_SIMULATION_TOOL_ADDRESSES_ACU.join(' | '), invalid);
    return { kind: 'read', reads };
  }
  if (action === 'search') {
    const raw = closedObject_ACU(normalizeToolRequestMetadata_ACU(normalizedValue, action), '$', ['action', 'query'], ['scope', 'maxResults', 'isRegex']);
    let maxResults = 10;
    if (raw.maxResults !== undefined) {
      if (!Number.isInteger(raw.maxResults) || Number(raw.maxResults) < 1 || Number(raw.maxResults) > 50) fail_ACU('INVALID_MAX_RESULTS', '$.maxResults', 'integer from 1 to 50', raw.maxResults);
      maxResults = Number(raw.maxResults);
    }
    if (raw.isRegex !== undefined && typeof raw.isRegex !== 'boolean') fail_ACU('BOOLEAN_REQUIRED', '$.isRegex', 'boolean', raw.isRegex);
    return { kind: 'search', query: requiredText_ACU(raw.query, '$.query'), scope: optionalList_ACU(raw.scope, '$.scope'), maxResults, isRegex: raw.isRegex === true };
  }
  if (action === 'delegate') {
    if (!allowDelegate) fail_ACU('DELEGATION_BUDGET_EXHAUSTED', '$.action', 'non-delegate action', action);
    const raw = closedObject_ACU(normalizedValue, '$', ['action', 'delegations']);
    if (!Array.isArray(raw.delegations) || !raw.delegations.length) fail_ACU('DELEGATIONS_REQUIRED', '$.delegations', 'non-empty array', raw.delegations);
    return { kind: 'delegate', delegations: raw.delegations.map((item, index) => {
      const delegation = closedObject_ACU(item, `$.delegations[${index}]`, ['agentName', 'instruction'], ['reads']);
      return { agentName: requiredText_ACU(delegation.agentName, `$.delegations[${index}].agentName`), instruction: requiredText_ACU(delegation.instruction, `$.delegations[${index}].instruction`), reads: optionalList_ACU(delegation.reads, `$.delegations[${index}].reads`) };
    }) };
  }
  if (action === 'finalize') {
    const raw = closedObject_ACU(normalizedValue, '$', ['action', 'outcome', 'summary'], ['evidenceRefs']);
    const outcome = text_ACU(raw.outcome);
    if (!(TERMINALS_ACU as readonly string[]).includes(outcome)) fail_ACU('INVALID_OUTCOME', '$.outcome', TERMINALS_ACU.join(' | '), raw.outcome);
    return { kind: 'finalize', outcome: outcome as typeof TERMINALS_ACU[number], summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', false, evidenceRegistry) };
  }
  if (action === 'block') {
    const reason = text_ACU(normalizedValue.reason);
    const blockValue = !Object.prototype.hasOwnProperty.call(normalizedValue, 'unresolved') && reason
      ? { ...normalizedValue, unresolved: [reason] }
      : normalizedValue;
    const raw = closedObject_ACU(blockValue, '$', ['action', 'reason', 'unresolved']);
    return { kind: 'block', reason: requiredText_ACU(raw.reason, '$.reason'), unresolved: requiredList_ACU(raw.unresolved, '$.unresolved') };
  }
  fail_ACU('INVALID_ACTION', '$.action', 'read | search | delegate | finalize | block', normalizedValue.action);
}


function closedObject_ACU(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord_ACU(value)) fail_ACU('OBJECT_REQUIRED', path, 'object', value);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail_ACU('MISSING_FIELD', `${path}.${key}`, 'required field', undefined);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail_ACU('UNKNOWN_FIELD', `${path}.${key}`, 'no additional fields', value[key]);
  return value;
}

function stagePlan_ACU(value: unknown, path = '$.plan'): WorldSimulationStagePlan_ACU {
  const raw = closedObject_ACU(value, path, ['schemaVersion', 'title', 'objective', 'impactScope', 'factsToVerify', 'plannedTools', 'plannedSpecialists', 'expectedLedgerChanges', 'convergenceConditions', 'blockingConditions', 'completedSteps', 'nextStep']);
  if (raw.schemaVersion !== WORLD_SIMULATION_SCHEMA_VERSION_ACU) fail_ACU('INVALID_SCHEMA_VERSION', `${path}.schemaVersion`, String(WORLD_SIMULATION_SCHEMA_VERSION_ACU), raw.schemaVersion);
  const expectedLedgerChanges = requiredList_ACU(raw.expectedLedgerChanges, `${path}.expectedLedgerChanges`);
  for (const item of expectedLedgerChanges) if (!(WORLD_SIMULATION_LEDGER_MODULES_ACU as readonly string[]).includes(item)) fail_ACU('INVALID_LEDGER_MODULE', `${path}.expectedLedgerChanges`, WORLD_SIMULATION_LEDGER_MODULES_ACU.join(' | '), item);
  return {
    schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU,
    title: requiredText_ACU(raw.title, `${path}.title`),
    objective: requiredText_ACU(raw.objective, `${path}.objective`),
    impactScope: requiredList_ACU(raw.impactScope, `${path}.impactScope`),
    factsToVerify:texts_ACU(raw.factsToVerify),
    plannedTools: texts_ACU(raw.plannedTools),
    plannedSpecialists: texts_ACU(raw.plannedSpecialists),
    expectedLedgerChanges: expectedLedgerChanges as WorldSimulationStagePlan_ACU['expectedLedgerChanges'],
    convergenceConditions: requiredList_ACU(raw.convergenceConditions, `${path}.convergenceConditions`),
    blockingConditions: texts_ACU(raw.blockingConditions),
    completedSteps: texts_ACU(raw.completedSteps),
    nextStep: requiredText_ACU(raw.nextStep, `${path}.nextStep`),
  };
}

export function parseWorldSimulationPlannerOutput_ACU(value: unknown): WorldSimulationPlannerOutput_ACU {
  const raw = closedObject_ACU(value, '$', ['action', 'summary', 'plan']);
  const action = text_ACU(raw.action);
  if (action !== 'plan') fail_ACU('INVALID_PLANNER_ACTION', '$.action', 'plan', raw.action);
  return { action, summary: requiredText_ACU(raw.summary, '$.summary'), plan: stagePlan_ACU(raw.plan) };
}

function normalizeSpecialistStatus_ACU(value: Record<string, unknown>): Record<string, unknown> {
  const status = text_ACU(value.status);
  const hasNonEmptyPatch = isRecord_ACU(value.patch) && Object.keys(value.patch).length > 0;
  if (['success', 'completed', 'complete', 'done', 'ok'].includes(status) && hasNonEmptyPatch) return { ...value, status: 'candidate' };
  if (status === 'unchanged' && !Object.prototype.hasOwnProperty.call(value, 'patch')) return { ...value, status: 'no_change' };
  if (status === 'error' || status === 'failure') return { ...value, status: 'failed' };
  if (status === 'block' && Object.prototype.hasOwnProperty.call(value, 'unresolved')) return { ...value, status: 'blocked' };
  return value;
}

export function parseWorldSimulationSpecialistResult_ACU(value: unknown, evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU): WorldSimulationSpecialistResult_ACU {
  if (!isRecord_ACU(value)) fail_ACU('OBJECT_REQUIRED', '$', 'specialist result object', value);
  const normalized = normalizeSpecialistStatus_ACU(value);
  const status = text_ACU(normalized.status);
  const agentName = requiredText_ACU(normalized.agentName, '$.agentName');
  if (status === 'candidate') {
    const raw = closedObject_ACU(normalized, '$', ['status', 'agentName', 'patch', 'summary', 'evidenceRefs', 'uncertainties']);
    if (!isRecord_ACU(raw.patch) || !Object.keys(raw.patch).length) fail_ACU('PATCH_REQUIRED', '$.patch', 'non-empty object', raw.patch);
    return { status, agentName, patch: raw.patch, summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', true, evidenceRegistry), uncertainties: texts_ACU(raw.uncertainties) };
  }
  if (status === 'no_change') {
    const raw = closedObject_ACU(normalized, '$', ['status', 'agentName', 'summary', 'evidenceRefs', 'uncertainties']);
    return { status, agentName, summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', false, evidenceRegistry), uncertainties: texts_ACU(raw.uncertainties) };
  }
  if (status === 'failed') {
    const raw = closedObject_ACU(normalized, '$', ['status', 'agentName', 'reasonCode', 'message']);
    return { status, agentName, reasonCode: requiredText_ACU(raw.reasonCode, '$.reasonCode'), message: requiredText_ACU(raw.message, '$.message') };
  }
  if (status === 'blocked') {
    const raw = closedObject_ACU(normalized, '$', ['status', 'agentName', 'unresolved']);
    return { status, agentName, unresolved: requiredList_ACU(raw.unresolved, '$.unresolved') };
  }
  fail_ACU('INVALID_SPECIALIST_STATUS', '$.status', 'candidate | no_change | failed | blocked', value.status);
}

export function parseWorldSimulationReviewerResult_ACU(value: unknown): WorldSimulationReviewerResult_ACU {
  const raw = closedObject_ACU(value, '$', ['verdict', 'summary', 'findings', 'acceptedCandidateIds']);
  const verdict = text_ACU(raw.verdict);
  if (!['accept', 'revise', 'reject'].includes(verdict)) fail_ACU('INVALID_REVIEW_VERDICT', '$.verdict', 'accept | revise | reject', raw.verdict);
  if (!Array.isArray(raw.findings)) fail_ACU('FINDINGS_REQUIRED', '$.findings', 'array', raw.findings);
  const findings = raw.findings.map((item, index) => {
    const finding = closedObject_ACU(item, `$.findings[${index}]`, ['severity', 'reasonCode', 'path', 'expected', 'actual']);
    const severity = text_ACU(finding.severity);
    if (!['blocking', 'major', 'minor'].includes(severity)) fail_ACU('INVALID_FINDING_SEVERITY', `$.findings[${index}].severity`, 'blocking | major | minor', finding.severity);
    return { severity: severity as 'blocking' | 'major' | 'minor', reasonCode: requiredText_ACU(finding.reasonCode, `$.findings[${index}].reasonCode`), path: requiredText_ACU(finding.path, `$.findings[${index}].path`), expected: requiredText_ACU(finding.expected, `$.findings[${index}].expected`), actual: finding.actual };
  });
  return { verdict: verdict as WorldSimulationReviewerResult_ACU['verdict'], summary: requiredText_ACU(raw.summary, '$.summary'), findings, acceptedCandidateIds: texts_ACU(raw.acceptedCandidateIds) };
}

function collectActionObjects_ACU(raw: string | null | undefined, prefill: string): Record<string, unknown>[] {
  const text = stripNoise_ACU(String(raw ?? ''));
  if (!text) fail_ACU('EMPTY_RESPONSE', '$', 'non-empty JSON output', raw);
  const candidates = text.startsWith('{') || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records = objects_ACU(candidate);
    if (records.length) return records;
  }
  fail_ACU('JSON_NOT_FOUND', '$', 'balanced JSON object', text.slice(0, 300));
}

export function parseWorldSimulationMainOutput_ACU(raw: string | null | undefined, prefill = '', allowDelegate = true, evidenceRegistry?:WorldSimulationEvidenceRegistrySnapshot_ACU): WorldSimulationMainAction_ACU {
  const records = collectActionObjects_ACU(raw, prefill).map(normalizeLegacyToolAction_ACU);
  const tools = records.filter(record => record.action === 'read' || record.action === 'search');
  if (tools.length) {
    return { kind: 'tools', calls: tools.map(record => parseWorldSimulationMainAction_ACU(record, allowDelegate, evidenceRegistry) as Extract<WorldSimulationMainAction_ACU, { kind: 'read' | 'search' }>) };
  }
  const action = records.find(record => Object.prototype.hasOwnProperty.call(record, 'action')) ?? records[0];
  return parseWorldSimulationMainAction_ACU(action, allowDelegate, evidenceRegistry);
}

/**
 * 主 Agent 输出被协议层拒绝时的回灌文本：错误原因 + 合法动作样例。
 * 与智能续写 renderMainProtocolRejection_ACU 同语义：快速/推理模型对
 * 「照这个样子写」远比对「请修正」服从；同时显式禁止模仿系统提示词里的
 * WORLD_SIMULATION_ENGINE_SEAM 标记——推理模型会把这些标记当输出格式照抄。
 */
export function renderWorldSimulationDirectorProtocolRejection_ACU(issue: WorldSimulationProtocolIssue_ACU, allowDelegate: boolean): string {
  const lines = [
    `你上一次的输出没有被采纳。原因：${issue.reasonCode} ${issue.path} 应为 ${issue.expected}。`,
    '只输出一个 JSON 对象（不要 <think> 块、不要 Markdown 围栏、不要 <WORLD_SIMULATION_ENGINE_SEAM:...> 标签——这些标记只属于系统提示词，输出中禁止出现）。',
    'read 只能包含 action、reads；search 只能包含 action、query、scope、maxResults、isRegex。不要添加 evidenceRef、purpose 或其他字段。',
    'evidenceRef 由服务端在读取成功后随工具结果颁发；只能在后续 finalize / candidate 的 evidenceRefs 数组中引用，不能由模型在 read/search 请求中生成。',
    '动作格式必须是下面之一：',
    '{"action":"read","reads":["ledger:current","summary:current"]}',
    '{"action":"search","query":"关键词","scope":["worldbook"],"maxResults":10}',
  ];
  if (allowDelegate) lines.push('{"action":"delegate","delegations":[{"agentName":"macro-dynamics-analyst","instruction":"推演本轮幕后时间与资源演变","reads":[]}]}');
  lines.push('finalize 顶层只能包含 action、outcome、summary、evidenceRefs；candidateId、acceptedCandidateIds、status、verdict 禁止出现。');
  lines.push('outcome 必须精确为 commit、no_change、blocked 之一，不得使用 candidate、success、done、finalized 等别名。');
  lines.push('{"action":"finalize","outcome":"commit","summary":"提交已审核候选","evidenceRefs":["evidence:已颁发引用"]}');
  lines.push('{"action":"finalize","outcome":"no_change","summary":"证据表明无需变更","evidenceRefs":["evidence:已颁发引用"]}');
  lines.push('{"action":"block","reason":"……","unresolved":["……"]}');
  return lines.join('\n');
}

export function renderWorldSimulationSpecialistProtocolRejection_ACU(
  issue: WorldSimulationProtocolIssue_ACU,
  agentName: string,
  writableModules: readonly string[],
): string {
  const lines = [
    `你上一次的输出没有被采纳。原因：${issue.reasonCode} ${issue.path} 应为 ${issue.expected}。`,
    '只输出一个 JSON 对象，不要 Markdown、解释、思考标签或额外字段。',
    'status 必须精确为 candidate、no_change、failed、blocked 之一。',
    `agentName 必须精确为 ${agentName}。`,
  ];
  if (writableModules.length) {
    lines.push(`candidate 的 patch 顶层只能使用：${writableModules.join(' | ')}。`);
    lines.push(JSON.stringify({
      status: 'candidate',
      agentName,
      patch: { [writableModules[0]]: {} },
      summary: '基于已颁发证据形成候选',
      evidenceRefs: ['evidence:已颁发引用'],
      uncertainties: [],
    }));
  }
  lines.push(JSON.stringify({ status: 'no_change', agentName, summary: '没有需要修改的内容', evidenceRefs: [], uncertainties: [] }));
  lines.push(JSON.stringify({ status: 'failed', agentName, reasonCode: 'REASON_CODE', message: '失败原因' }));
  lines.push(JSON.stringify({ status: 'blocked', agentName, unresolved: ['仍需解决的问题'] }));
  return lines.join('\n');
}

function mergeDraftValue_ACU(base: unknown, continuation: unknown, path: string, depth: number): unknown {
  if (depth > 16) fail_ACU('DRAFT_MERGE_DEPTH', path, 'nesting depth at most 16', depth);
  if (base === undefined) return continuation;
  if (continuation === undefined) return base;
  if (Array.isArray(base) && Array.isArray(continuation)) return [...base, ...continuation];
  if (isRecord_ACU(base) && isRecord_ACU(continuation)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(continuation)) result[key] = mergeDraftValue_ACU(result[key], value, `${path}.${key}`, depth + 1);
    return result;
  }
  if (Object.is(base, continuation)) return base;
  fail_ACU('DRAFT_MERGE_CONFLICT', path, 'matching scalar values or mergeable arrays/objects', { base, continuation });
}

export function mergeWorldSimulationJsonDrafts_ACU(base: Record<string, unknown>, continuation: Record<string, unknown>): Record<string, unknown> {
  return mergeDraftValue_ACU(base, continuation, '$', 0) as Record<string, unknown>;
}

export function compactWorldSimulationProtocolError_ACU(error: unknown): WorldSimulationProtocolIssue_ACU {
  if (error instanceof WorldSimulationValidationError_ACU && error.error.code === 'WORLD_SIMULATION_AGENT_PROTOCOL_INVALID') {
    const details = error.error.details ?? {};
    return { reasonCode: text_ACU(details.reasonCode) || 'PROTOCOL_INVALID', path: text_ACU(details.path) || '$', expected: text_ACU(details.expected) || 'valid protocol value', actual: details.actual };
  }
  return { reasonCode: 'PROTOCOL_UNKNOWN_ERROR', path: '$', expected: 'valid protocol output', actual: error instanceof Error ? error.message : String(error) };
}

export interface WorldSimulationProtocolRepairState_ACU { attempts: number; maxAttempts: number; fingerprints: Record<string, number>; }
export function createWorldSimulationProtocolRepairState_ACU(maxAttempts = 2): WorldSimulationProtocolRepairState_ACU {
  return { attempts: 0, maxAttempts: Math.max(0, Math.floor(maxAttempts)), fingerprints: {} };
}
export function recordWorldSimulationProtocolFailure_ACU(state: WorldSimulationProtocolRepairState_ACU, error: unknown): { retry: boolean; fingerprint: string; issue: WorldSimulationProtocolIssue_ACU } {
  const issue = compactWorldSimulationProtocolError_ACU(error);
  const fingerprint = `${issue.reasonCode}|${issue.path}|${issue.expected}`;
  state.attempts += 1;
  state.fingerprints[fingerprint] = (state.fingerprints[fingerprint] ?? 0) + 1;
  return { retry: state.attempts <= state.maxAttempts && state.fingerprints[fingerprint] < 2, fingerprint, issue };
}
