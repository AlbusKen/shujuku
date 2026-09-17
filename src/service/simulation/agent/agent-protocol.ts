import { WORLD_SIMULATION_SCHEMA_VERSION_ACU, WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationStagePlan_ACU } from '../model';
import { findUnauthorizedWorldSimulationEvidenceRefs_ACU, type WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import type { WorldSimulationMainAction_ACU, WorldSimulationPlannerOutput_ACU, WorldSimulationProtocolIssue_ACU, WorldSimulationReviewerResult_ACU, WorldSimulationSpecialistResult_ACU } from './agent-model';

const SCAN_LIMIT_ACU = 6;
const TERMINALS_ACU = ['commit', 'no_change', 'blocked', 'awaiting_plan_review', 'stage_replanned'] as const;
const isRecord_ACU = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text_ACU = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const texts_ACU = (value: unknown): string[] => Array.isArray(value) ? value.map(text_ACU).filter(Boolean) : [];

function fail_ACU(reasonCode: string, path: string, expected: string, actual: unknown): never {
  const issue: WorldSimulationProtocolIssue_ACU = { reasonCode, path, expected, actual };
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU('WORLD_SIMULATION_AGENT_PROTOCOL_INVALID', 'agent_loop', `${reasonCode}: ${path} 应为 ${expected}`, true, { ...issue }));
}

function stripNoise_ACU(raw: string): string {
  return raw.replace(/<(think|thinking|reasoning|thought|analysis)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/?(think|thinking|reasoning|thought|analysis)(?:\s[^>]*)?>/gi, '').replace(/```[a-zA-Z]*\n?/g, '').trim();
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

export function parseWorldSimulationMainAction_ACU(value: unknown, allowDelegate = true, evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU): WorldSimulationMainAction_ACU {
  if (!isRecord_ACU(value)) fail_ACU('OBJECT_REQUIRED', '$', 'object', value);
  const action = text_ACU(value.action);
  if (action === 'read') {
    const raw = closedObject_ACU(value, '$', ['action', 'reads']);
    return { kind: 'read', reads: requiredList_ACU(raw.reads, '$.reads') };
  }
  if (action === 'search') {
    const raw = closedObject_ACU(value, '$', ['action', 'query'], ['scope', 'maxResults', 'isRegex']);
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
    const raw = closedObject_ACU(value, '$', ['action', 'delegations']);
    if (!Array.isArray(raw.delegations) || !raw.delegations.length) fail_ACU('DELEGATIONS_REQUIRED', '$.delegations', 'non-empty array', raw.delegations);
    return { kind: 'delegate', delegations: raw.delegations.map((item, index) => {
      const delegation = closedObject_ACU(item, `$.delegations[${index}]`, ['agentName', 'instruction'], ['reads']);
      return { agentName: requiredText_ACU(delegation.agentName, `$.delegations[${index}].agentName`), instruction: requiredText_ACU(delegation.instruction, `$.delegations[${index}].instruction`), reads: optionalList_ACU(delegation.reads, `$.delegations[${index}].reads`) };
    }) };
  }
  if (action === 'finalize') {
    const raw = closedObject_ACU(value, '$', ['action', 'outcome', 'summary'], ['evidenceRefs']);
    const outcome = text_ACU(raw.outcome);
    if (!(TERMINALS_ACU as readonly string[]).includes(outcome)) fail_ACU('INVALID_OUTCOME', '$.outcome', TERMINALS_ACU.join(' | '), raw.outcome);
    return { kind: 'finalize', outcome: outcome as typeof TERMINALS_ACU[number], summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', false, evidenceRegistry) };
  }
  if (action === 'block') {
    const raw = closedObject_ACU(value, '$', ['action', 'reason', 'unresolved']);
    return { kind: 'block', reason: requiredText_ACU(raw.reason, '$.reason'), unresolved: requiredList_ACU(raw.unresolved, '$.unresolved') };
  }
  fail_ACU('INVALID_ACTION', '$.action', 'read | search | delegate | finalize | block', value.action);
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
  const modules = ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance'] as const;
  const expectedLedgerChanges = requiredList_ACU(raw.expectedLedgerChanges, `${path}.expectedLedgerChanges`);
  for (const item of expectedLedgerChanges) if (!(modules as readonly string[]).includes(item)) fail_ACU('INVALID_LEDGER_MODULE', `${path}.expectedLedgerChanges`, modules.join(' | '), item);
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
  if (action !== 'plan' && action !== 'replan') fail_ACU('INVALID_PLANNER_ACTION', '$.action', 'plan | replan', raw.action);
  return { action, summary: requiredText_ACU(raw.summary, '$.summary'), plan: stagePlan_ACU(raw.plan) };
}

export function parseWorldSimulationSpecialistResult_ACU(value: unknown, evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU): WorldSimulationSpecialistResult_ACU {
  if (!isRecord_ACU(value)) fail_ACU('OBJECT_REQUIRED', '$', 'specialist result object', value);
  const status = text_ACU(value.status);
  const agentName = requiredText_ACU(value.agentName, '$.agentName');
  if (status === 'candidate') {
    const raw = closedObject_ACU(value, '$', ['status', 'agentName', 'patch', 'summary', 'evidenceRefs', 'uncertainties']);
    if (!isRecord_ACU(raw.patch) || !Object.keys(raw.patch).length) fail_ACU('PATCH_REQUIRED', '$.patch', 'non-empty object', raw.patch);
    return { status, agentName, patch: raw.patch, summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', true, evidenceRegistry), uncertainties: texts_ACU(raw.uncertainties) };
  }
  if (status === 'no_change') {
    const raw = closedObject_ACU(value, '$', ['status', 'agentName', 'summary', 'evidenceRefs', 'uncertainties']);
    return { status, agentName, summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', false, evidenceRegistry), uncertainties: texts_ACU(raw.uncertainties) };
  }
  if (status === 'failed') {
    const raw = closedObject_ACU(value, '$', ['status', 'agentName', 'reasonCode', 'message']);
    return { status, agentName, reasonCode: requiredText_ACU(raw.reasonCode, '$.reasonCode'), message: requiredText_ACU(raw.message, '$.message') };
  }
  if (status === 'blocked') {
    const raw = closedObject_ACU(value, '$', ['status', 'agentName', 'unresolved']);
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
  const records = collectActionObjects_ACU(raw, prefill);
  const tools = records.filter(record => record.action === 'read' || record.action === 'search');
  if (tools.length) {
    return { kind: 'tools', calls: tools.map(record => parseWorldSimulationMainAction_ACU(record, allowDelegate, evidenceRegistry) as Extract<WorldSimulationMainAction_ACU, { kind: 'read' | 'search' }>) };
  }
  const action = records.find(record => Object.prototype.hasOwnProperty.call(record, 'action')) ?? records[0];
  return parseWorldSimulationMainAction_ACU(action, allowDelegate, evidenceRegistry);
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
