import { WORLD_GUIDANCE_SIGNAL_MAX_CHARS_ACU, WORLD_GUIDANCE_SIGNAL_VOICES_ACU, WORLD_PLAYER_CONTACTS_ACU, WORLD_SIMULATION_LEDGER_MODULES_ACU, WORLD_SIMULATION_SCHEMA_VERSION_ACU, WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldGuidanceSignal_ACU, type WorldSimulationLedger_ACU, type WorldSimulationStagePlan_ACU } from '../model';
import { applyWorldSimulationProjection_ACU } from '../simulation-projection';
import { coerceWorldSimulationEnum_ACU, coerceWorldSimulationInteger_ACU, coerceWorldSimulationStringArray_ACU } from '../simulation-patch-normalize';
import { parseRestrictedSqlDml_ACU, type RestrictedSqlStatement_ACU, type RestrictedSqlValue_ACU } from '../../shared/restricted-sql-dml';
import { findUnauthorizedWorldSimulationEvidenceRefs_ACU, type WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { WORLD_SIMULATION_TOOL_ADDRESSES_ACU } from '../world-simulation-agent-tools';
import { findWorldSimulationAgentDefinition_ACU } from './agent-catalog';
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
  if (action === 'open_round') {
    const raw = closedObject_ACU(normalizedValue, '$', ['action', 'summary', 'focus', 'dispatchChronicler'], ['skipModules']);
    if (typeof raw.dispatchChronicler !== 'boolean') fail_ACU('BOOLEAN_REQUIRED', '$.dispatchChronicler', 'boolean', raw.dispatchChronicler);
    const skipModules = [...new Set(optionalList_ACU(raw.skipModules, '$.skipModules'))];
    for (const module of skipModules) {
      if (!(WORLD_SIMULATION_LEDGER_MODULES_ACU as readonly string[]).includes(module)) {
        fail_ACU('INVALID_LEDGER_MODULE', '$.skipModules', WORLD_SIMULATION_LEDGER_MODULES_ACU.join(' | '), module);
      }
    }
    return {
      kind: 'open_round',
      summary: requiredText_ACU(raw.summary, '$.summary'),
      focus: requiredText_ACU(raw.focus, '$.focus'),
      dispatchChronicler: raw.dispatchChronicler,
      skipModules,
    };
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
  fail_ACU('INVALID_ACTION', '$.action', 'read | search | delegate | open_round | finalize | block', normalizedValue.action);
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

const WORLD_SIMULATION_SQL_TABLE_MODULE_ACU = {
  dimensions: 'dimensions',
  seeds: 'seeds',
  actors: 'actors',
  rumors: 'rumors',
  chronicle: 'chronicle',
  clock: 'clock',
  player: 'player',
  guidance: 'guidance',
  chronicle_archive: 'chronicleArchive',
  chronicle_overview: 'chronicleArchive',
} as const;

const WORLD_SIMULATION_SQL_COLUMNS_ACU: Readonly<Record<string, ReadonlySet<string>>> = {
  dimensions: new Set(['id', 'name', 'kind', 'value', 'trend', 'rationale', 'evidence_refs', 'expected_revision']),
  seeds: new Set(['id', 'title', 'status', 'level', 'catalyst', 'visibility', 'actor_ids', 'location', 'expires_at_day', 'missed_outcome', 'expose_policy', 'evidence_refs', 'retired_reason', 'expected_revision']),
  actors: new Set(['id', 'name', 'interests', 'location', 'location_ref', 'life', 'died_at_day', 'death_summary', 'resources', 'goals', 'constraints', 'information_sources', 'known_facts', 'visibility', 'evidence_refs', 'expected_revision']),
  rumors: new Set(['id', 'fact', 'origin_day', 'earliest_reveal_day', 'channels', 'related_actor_ids', 'status', 'revealed_at_day', 'evidence_refs', 'expected_revision']),
  chronicle: new Set(['id', 'at', 'summary', 'related_ids', 'evidence_refs']),
  clock: new Set(['days', 'story_time', 'slot', 'evidence_refs', 'expected_revision']),
  player: new Set(['location', 'contact', 'evidence_refs', 'expected_revision']),
  guidance: new Set(['signals', 'excluded_facts', 'evidence_refs', 'expected_revision']),
  chronicle_archive: new Set(['archive_ref', 'day', 'summary', 'fingerprints', 'related_ids', 'source_chronicle_ids']),
  chronicle_overview: new Set(['fingerprint', 'day', 'one_line', 'archive_ref']),
};

function simulationSqlColumnName_ACU(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function simulationSqlValue_ACU(value: RestrictedSqlValue_ACU): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed); } catch { /* ordinary text remains a string */ }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return value;
}

function simulationSqlText_ACU(value: RestrictedSqlValue_ACU | undefined, path: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) fail_ACU('SQL_REQUIRED_TEXT', path, 'non-empty string', value);
  return result;
}

function simulationSqlRecord_ACU(table: string, values: Record<string, RestrictedSqlValue_ACU>, omitted: readonly string[] = []): Record<string, unknown> {
  const allowed = WORLD_SIMULATION_SQL_COLUMNS_ACU[table];
  if (!allowed) fail_ACU('SQL_TABLE_FORBIDDEN', '$.sql', 'whitelisted table', table);
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(values)) {
    if (!allowed.has(column)) fail_ACU('SQL_COLUMN_FORBIDDEN', `$.sql.${table}.${column}`, 'whitelisted column', column);
    if (!omitted.includes(column)) result[simulationSqlColumnName_ACU(column)] = simulationSqlValue_ACU(value);
  }
  return result;
}

function simulationSqlWhere_ACU(statement: RestrictedSqlStatement_ACU): Record<string, RestrictedSqlValue_ACU> {
  if (statement.kind === 'insert') return {};
  const allowed = new Set(['id', 'archive_ref', 'expected_revision', 'reason']);
  for (const key of Object.keys(statement.where)) {
    if (!allowed.has(key)) fail_ACU('SQL_WHERE_FORBIDDEN', `$.sql.where.${key}`, 'id/archive_ref plus expected_revision/reason', key);
  }
  return statement.where;
}

function simulationSqlExactWhere_ACU(where: Record<string, RestrictedSqlValue_ACU>, required: readonly string[], optional: readonly string[] = []): void {
  for (const column of required) {
    if (!Object.prototype.hasOwnProperty.call(where, column)) fail_ACU('SQL_WHERE_REQUIRED', `$.sql.where.${column}`, 'required WHERE condition', undefined);
  }
  for (const column of Object.keys(where)) {
    if (!required.includes(column) && !optional.includes(column)) fail_ACU('SQL_WHERE_FORBIDDEN', `$.sql.where.${column}`, 'only supported WHERE conditions', column);
  }
}

function worldSimulationSqlPatch_ACU(statements: readonly RestrictedSqlStatement_ACU[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const statement of statements) {
    if (!Object.prototype.hasOwnProperty.call(WORLD_SIMULATION_SQL_TABLE_MODULE_ACU, statement.table)) {
      fail_ACU('SQL_TABLE_FORBIDDEN', '$.sql', Object.keys(WORLD_SIMULATION_SQL_TABLE_MODULE_ACU).join(' | '), statement.table);
    }
    const module = WORLD_SIMULATION_SQL_TABLE_MODULE_ACU[statement.table as keyof typeof WORLD_SIMULATION_SQL_TABLE_MODULE_ACU];
    const where = simulationSqlWhere_ACU(statement);
    if (statement.kind !== 'delete') {
      simulationSqlRecord_ACU(statement.table, statement.values);
      if ('expected_revision' in statement.values && statement.kind === 'update') fail_ACU('SQL_REVISION_LOCATION', `$.sql.${statement.table}.expected_revision`, 'revision in WHERE only', statement.values.expected_revision);
    }
    if (module === 'clock' || module === 'player' || module === 'guidance') {
      if (statement.kind !== 'update') fail_ACU('SQL_SINGLETON_OPERATION', `$.sql.${statement.table}`, 'UPDATE', statement.kind);
      simulationSqlExactWhere_ACU(where, ['expected_revision']);
      const revision = where.expected_revision;
      if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) fail_ACU('SQL_REVISION_INVALID', `$.sql.${statement.table}.expected_revision`, 'non-negative integer', revision);
      if (isRecord_ACU(patch[module]) && patch[module].expectedRevision !== revision) fail_ACU('SQL_REVISION_CONFLICT', `$.sql.${statement.table}.expected_revision`, 'consistent revision', revision);
      patch[module] = { ...(isRecord_ACU(patch[module]) ? patch[module] : {}), ...simulationSqlRecord_ACU(statement.table, statement.values, ['expected_revision']), expectedRevision: revision };
      continue;
    }
    if (statement.table === 'chronicle_archive' || statement.table === 'chronicle_overview') {
      if (statement.kind === 'delete') {
        fail_ACU('SQL_ARCHIVE_DELETE_FORBIDDEN', `$.sql.${statement.table}`, 'archive removal requires a paired replacement through domain transaction', statement.kind);
      }
      if (statement.kind !== 'insert') fail_ACU('SQL_ARCHIVE_OPERATION', `$.sql.${statement.table}`, 'INSERT', statement.kind);
      const archivePatch = (patch.chronicleArchive ??= { archiveEntries: [], overviewRows: [], collapseRefs: [] }) as Record<string, unknown>;
      const target = statement.table === 'chronicle_archive' ? archivePatch.archiveEntries : archivePatch.overviewRows;
      (target as unknown[]).push(simulationSqlRecord_ACU(statement.table, statement.values));
      continue;
    }
    if (module === 'chronicle') {
      if (statement.kind === 'insert') {
        const chroniclePatch = (patch.chronicle ??= { append: [], remove: [] }) as Record<string, unknown>;
        (chroniclePatch.append as unknown[]).push(simulationSqlRecord_ACU(statement.table, statement.values));
      } else if (statement.kind === 'delete') {
        simulationSqlExactWhere_ACU(where, ['id', 'reason']);
        const chroniclePatch = (patch.chronicle ??= { append: [], remove: [] }) as Record<string, unknown>;
        (chroniclePatch.remove as unknown[]).push({ id: simulationSqlText_ACU(where.id, '$.sql.chronicle.WHERE id'), reason: simulationSqlText_ACU(where.reason, '$.sql.chronicle.WHERE reason') });
      } else {
        fail_ACU('SQL_CHRONICLE_OPERATION', '$.sql.chronicle', 'INSERT or DELETE', statement.kind);
      }
      continue;
    }
    const collection = (patch[module] ??= { upsert: [], remove: [] }) as Record<string, unknown>;
    if (statement.kind === 'delete') {
      simulationSqlExactWhere_ACU(where, ['id', 'reason', 'expected_revision']);
      (collection.remove as unknown[]).push({
        id: simulationSqlText_ACU(where.id, `$.sql.${statement.table}.WHERE id`),
        expectedRevision: where.expected_revision,
        reason: simulationSqlText_ACU(where.reason, `$.sql.${statement.table}.WHERE reason`),
      });
    } else {
      const row = simulationSqlRecord_ACU(statement.table, statement.values, ['expected_revision']);
      if (statement.kind === 'update') simulationSqlExactWhere_ACU(where, ['id', 'expected_revision']);
      if (statement.kind === 'update') row.id = simulationSqlText_ACU(where.id, `$.sql.${statement.table}.WHERE id`);
      const expectedRevision = statement.kind === 'insert' ? statement.values.expected_revision : where.expected_revision;
      if (expectedRevision !== undefined) {
        if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) fail_ACU('SQL_REVISION_INVALID', `$.sql.${statement.table}.expected_revision`, 'non-negative integer', expectedRevision);
        row.expectedRevision = expectedRevision;
      }
      (collection.upsert as unknown[]).push(row);
    }
  }
  return patch;
}

function normalizeSpecialistSql_ACU(value: Record<string, unknown>): Record<string, unknown> {
  if (value.sql === undefined) return value;
  if (typeof value.sql !== 'string') fail_ACU('SQL_TEXT_REQUIRED', '$.sql', 'string', value.sql);
  if (value.patch !== undefined) fail_ACU('SQL_PATCH_AMBIGUOUS', '$', 'exactly one of sql or patch', value);
  const { sql, ...rest } = value;
  try {
    const statements = parseRestrictedSqlDml_ACU(sql);
    if (!statements.length) fail_ACU('SQL_EMPTY', '$.sql', 'non-empty DML write set', sql);
    return { ...rest, patch: worldSimulationSqlPatch_ACU(statements) };
  } catch (error) {
    if (error instanceof WorldSimulationValidationError_ACU) throw error;
    fail_ACU('SQL_INVALID', '$.sql', 'restricted INSERT/UPDATE/DELETE statements', error instanceof Error ? error.message : String(error));
  }
}

function invalidSpecialistPatch_ACU(path: string, expected: string, actual: unknown): never {
  fail_ACU('INVALID_SPECIALIST_PATCH', path, expected, actual);
}

function specialistStringList_ACU(value: unknown, path: string): void {
  if (!coerceWorldSimulationStringArray_ACU(value).ok) {
    invalidSpecialistPatch_ACU(path, 'string array with non-empty items', value);
  }
}

function specialistGuidanceSignals_ACU(value: unknown, path: string): void {
  if (!Array.isArray(value)) invalidSpecialistPatch_ACU(path, 'array of {text, voice, sourceId}', value);
  value.forEach((item, index) => {
    if (!isRecord_ACU(item)) invalidSpecialistPatch_ACU(`${path}[${index}]`, 'object', item);
    specialistPatchRecord_ACU(item, `${path}[${index}]`, ['text', 'voice', 'sourceId']);
    if (!text_ACU(item.text)) invalidSpecialistPatch_ACU(`${path}[${index}].text`, 'non-empty string', item.text);
    if (!coerceWorldSimulationEnum_ACU(item.voice, WORLD_GUIDANCE_SIGNAL_VOICES_ACU).ok) {
      invalidSpecialistPatch_ACU(`${path}[${index}].voice`, WORLD_GUIDANCE_SIGNAL_VOICES_ACU.join(' | '), item.voice);
    }
    if (!text_ACU(item.sourceId)) invalidSpecialistPatch_ACU(`${path}[${index}].sourceId`, 'non-empty ledger source id, clock, or player', item.sourceId);
  });
}

function specialistPatchRecord_ACU(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord_ACU(value)) invalidSpecialistPatch_ACU(path, 'object', value);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalidSpecialistPatch_ACU(`${path}.${key}`, 'no additional fields', value[key]);
  }
  return value;
}

function validateWorldSimulationSpecialistPatch_ACU(value: unknown): Record<string, unknown> {
  if (!isRecord_ACU(value) || !Object.keys(value).length) invalidSpecialistPatch_ACU('$.patch', 'non-empty ledger patch object', value);
  for (const [module, patch] of Object.entries(value)) {
    const path = `$.patch.${module}`;
    if (!(WORLD_SIMULATION_LEDGER_MODULES_ACU as readonly string[]).includes(module) && module !== 'chronicleArchive') {
      invalidSpecialistPatch_ACU(path, [...WORLD_SIMULATION_LEDGER_MODULES_ACU, 'chronicleArchive'].join(' | '), patch);
    }
    if (module === 'chronicleArchive') {
      if (!isRecord_ACU(patch)) invalidSpecialistPatch_ACU(path, 'object', patch);
      const raw = specialistPatchRecord_ACU(patch, path, ['archiveEntries', 'overviewRows', 'collapseRefs']);
      if (raw.archiveEntries !== undefined && !Array.isArray(raw.archiveEntries)) invalidSpecialistPatch_ACU(`${path}.archiveEntries`, 'array', raw.archiveEntries);
      if (raw.overviewRows !== undefined && !Array.isArray(raw.overviewRows)) invalidSpecialistPatch_ACU(`${path}.overviewRows`, 'array', raw.overviewRows);
      if (raw.collapseRefs !== undefined && (!Array.isArray(raw.collapseRefs) || raw.collapseRefs.some(ref => !text_ACU(ref)))) invalidSpecialistPatch_ACU(`${path}.collapseRefs`, 'non-empty string array', raw.collapseRefs);
      if (!Array.isArray(raw.archiveEntries) || !Array.isArray(raw.overviewRows) || !raw.archiveEntries.length || !raw.overviewRows.length) invalidSpecialistPatch_ACU(path, 'paired non-empty archiveEntries and overviewRows', patch);
      continue;
    }
    if (module === 'dimensions' || module === 'seeds' || module === 'actors' || module === 'rumors') {
      const raw = specialistPatchRecord_ACU(patch, path, ['upsert', 'remove']);
      const upserts = raw.upsert === undefined ? [] : raw.upsert;
      const removals = raw.remove === undefined ? [] : raw.remove;
      if (!Array.isArray(upserts) || !Array.isArray(removals) || (!upserts.length && !removals.length)) invalidSpecialistPatch_ACU(path, 'non-empty upsert or remove array', patch);
      upserts.forEach((item, index) => {
        if (!isRecord_ACU(item)) invalidSpecialistPatch_ACU(`${path}.upsert[${index}]`, 'object', item);
        if (item.id !== undefined && !text_ACU(item.id)) invalidSpecialistPatch_ACU(`${path}.upsert[${index}].id`, 'non-empty string', item.id);
        const labelField = module === 'seeds' ? 'title' : module === 'rumors' ? 'fact' : 'name';
        if (item[labelField] !== undefined && !text_ACU(item[labelField])) {
          invalidSpecialistPatch_ACU(`${path}.upsert[${index}].${labelField}`, 'non-empty string', item[labelField]);
        }
        if (item.expectedRevision !== undefined) {
          const revision = coerceWorldSimulationInteger_ACU(item.expectedRevision);
          if (!revision.ok || revision.value < 0) {
            invalidSpecialistPatch_ACU(`${path}.upsert[${index}].expectedRevision`, 'non-negative integer', item.expectedRevision);
          }
        }
      });
      removals.forEach((item, index) => {
        const itemPath = `${path}.remove[${index}]`;
        if (!isRecord_ACU(item)) invalidSpecialistPatch_ACU(itemPath, 'object', item);
        specialistPatchRecord_ACU(item, itemPath, ['id', 'expectedRevision', 'reason']);
        if (!text_ACU(item.id)) invalidSpecialistPatch_ACU(`${itemPath}.id`, 'non-empty string', item.id);
        if (!text_ACU(item.reason)) invalidSpecialistPatch_ACU(`${itemPath}.reason`, 'non-empty string', item.reason);
        const revision = coerceWorldSimulationInteger_ACU(item.expectedRevision);
        if (!revision.ok || revision.value < 0) invalidSpecialistPatch_ACU(`${itemPath}.expectedRevision`, 'non-negative integer', item.expectedRevision);
      });
      continue;
    }
    if (module === 'chronicle') {
      const raw = specialistPatchRecord_ACU(patch, path, ['append', 'remove']);
      const append = raw.append === undefined ? [] : raw.append;
      const remove = raw.remove === undefined ? [] : raw.remove;
      if (!Array.isArray(append) || !Array.isArray(remove) || (!append.length && !remove.length)) invalidSpecialistPatch_ACU(path, 'non-empty append or remove array', patch);
      remove.forEach((item, index) => {
        const itemPath = `${path}.remove[${index}]`;
        if (!isRecord_ACU(item)) invalidSpecialistPatch_ACU(itemPath, 'object', item);
        specialistPatchRecord_ACU(item, itemPath, ['id', 'reason']);
        if (!text_ACU(item.id) || !text_ACU(item.reason)) invalidSpecialistPatch_ACU(itemPath, 'non-empty id and reason', item);
      });
      continue;
    }
    if (module === 'clock') {
      const raw = specialistPatchRecord_ACU(patch, path, ['days', 'storyTime', 'slot', 'evidenceRefs', 'expectedRevision']);
      if (raw.expectedRevision !== undefined && (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0)) invalidSpecialistPatch_ACU(`${path}.expectedRevision`, 'non-negative integer', raw.expectedRevision);
      if (!Object.keys(raw).length) invalidSpecialistPatch_ACU(path, 'non-empty object', patch);
      if (raw.days !== undefined) {
        const days = coerceWorldSimulationInteger_ACU(raw.days);
        if (!days.ok || days.value < 0) invalidSpecialistPatch_ACU(`${path}.days`, 'non-negative integer', raw.days);
      }
      if (raw.storyTime !== undefined && typeof raw.storyTime !== 'string') invalidSpecialistPatch_ACU(`${path}.storyTime`, 'string', raw.storyTime);
      if (raw.slot !== undefined && typeof raw.slot !== 'string') invalidSpecialistPatch_ACU(`${path}.slot`, 'string', raw.slot);
      if (raw.evidenceRefs !== undefined) specialistStringList_ACU(raw.evidenceRefs, `${path}.evidenceRefs`);
      continue;
    }
    if (module === 'player') {
      const raw = specialistPatchRecord_ACU(patch, path, ['location', 'contact', 'evidenceRefs', 'expectedRevision']);
      if (raw.expectedRevision !== undefined && (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0)) invalidSpecialistPatch_ACU(`${path}.expectedRevision`, 'non-negative integer', raw.expectedRevision);
      if (!Object.keys(raw).length) invalidSpecialistPatch_ACU(path, 'non-empty object', patch);
      if (raw.contact !== undefined && !coerceWorldSimulationEnum_ACU(raw.contact, WORLD_PLAYER_CONTACTS_ACU).ok) {
        invalidSpecialistPatch_ACU(`${path}.contact`, WORLD_PLAYER_CONTACTS_ACU.join(' | '), raw.contact);
      }
      if (raw.evidenceRefs !== undefined) specialistStringList_ACU(raw.evidenceRefs, `${path}.evidenceRefs`);
      if (raw.location !== undefined && raw.location !== null) {
        if (!isRecord_ACU(raw.location)) invalidSpecialistPatch_ACU(`${path}.location`, 'object or null', raw.location);
        specialistPatchRecord_ACU(raw.location, `${path}.location`, ['region', 'place']);
        if (!text_ACU(raw.location.region)) invalidSpecialistPatch_ACU(`${path}.location.region`, 'non-empty string', raw.location.region);
        if (raw.location.place !== undefined && typeof raw.location.place !== 'string') invalidSpecialistPatch_ACU(`${path}.location.place`, 'string', raw.location.place);
      }
      continue;
    }
    if (module !== 'guidance') invalidSpecialistPatch_ACU(path, WORLD_SIMULATION_LEDGER_MODULES_ACU.join(' | '), patch);
    const raw = specialistPatchRecord_ACU(patch, path, ['signals', 'excludedFacts', 'evidenceRefs', 'expectedRevision']);
    if (raw.expectedRevision !== undefined && (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0)) invalidSpecialistPatch_ACU(`${path}.expectedRevision`, 'non-negative integer', raw.expectedRevision);
    if (!Object.keys(raw).length) invalidSpecialistPatch_ACU(path, 'non-empty object', patch);
    if (raw.signals !== undefined) specialistGuidanceSignals_ACU(raw.signals, `${path}.signals`);
    if (raw.excludedFacts !== undefined) specialistStringList_ACU(raw.excludedFacts, `${path}.excludedFacts`);
    if (raw.evidenceRefs !== undefined) specialistStringList_ACU(raw.evidenceRefs, `${path}.evidenceRefs`);
  }
  return value;
}

export function parseWorldSimulationSpecialistResult_ACU(value: unknown, evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU): WorldSimulationSpecialistResult_ACU {
  if (!isRecord_ACU(value)) fail_ACU('OBJECT_REQUIRED', '$', 'specialist result object', value);
  const normalized = normalizeSpecialistStatus_ACU(normalizeSpecialistSql_ACU(value));
  const status = text_ACU(normalized.status);
  const agentName = requiredText_ACU(normalized.agentName, '$.agentName');
  if (status === 'candidate') {
    const raw = closedObject_ACU(normalized, '$', ['status', 'agentName', 'patch', 'summary', 'evidenceRefs', 'uncertainties']);
    const patch = validateWorldSimulationSpecialistPatch_ACU(raw.patch);
    return { status, agentName, patch, summary: requiredText_ACU(raw.summary, '$.summary'), evidenceRefs: authorizedEvidenceRefs_ACU(raw.evidenceRefs, '$.evidenceRefs', true, evidenceRegistry), uncertainties: texts_ACU(raw.uncertainties) };
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
  return {
    verdict: verdict as WorldSimulationReviewerResult_ACU['verdict'],
    summary: requiredText_ACU(raw.summary, '$.summary'),
    findings,
    acceptedCandidateIds: texts_ACU(raw.acceptedCandidateIds),
  };
}

function pushGuidanceAnchorSentence_ACU(target: string[], value: string | null | undefined): void {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 6) target.push(trimmed);
}

export function collectWorldSimulationGuidanceAnchorSentences_ACU(ledger: WorldSimulationLedger_ACU, anchorMessage = ''): string[] {
  const sentences: string[] = [];
  const stripped = applyWorldSimulationProjection_ACU(String(anchorMessage ?? ''), null);
  for (const chunk of stripped.split(/[。！？!?\n]+/)) pushGuidanceAnchorSentence_ACU(sentences, chunk);
  for (const rumor of ledger.rumors) pushGuidanceAnchorSentence_ACU(sentences, rumor.fact);
  for (const actor of ledger.actors) {
    for (const goal of actor.goals) pushGuidanceAnchorSentence_ACU(sentences, goal);
    for (const fact of actor.knownFacts) pushGuidanceAnchorSentence_ACU(sentences, fact);
    pushGuidanceAnchorSentence_ACU(sentences, actor.deathSummary);
  }
  for (const seed of ledger.seeds) {
    pushGuidanceAnchorSentence_ACU(sentences, seed.title);
    pushGuidanceAnchorSentence_ACU(sentences, seed.catalyst);
    pushGuidanceAnchorSentence_ACU(sentences, seed.missedOutcome);
  }
  for (const dimension of ledger.dimensions) pushGuidanceAnchorSentence_ACU(sentences, dimension.rationale);
  for (const entry of ledger.chronicle) pushGuidanceAnchorSentence_ACU(sentences, entry.summary);
  return sentences;
}

export function validateWorldSimulationGuidanceComposerSignals_ACU(
  signals: readonly WorldGuidanceSignal_ACU[],
  ledger: WorldSimulationLedger_ACU,
  anchorMessage = '',
): WorldGuidanceSignal_ACU[] {
  const knownIds = new Set<string>([
    'clock',
    'player',
    ...ledger.actors.map(item => item.id),
    ...ledger.seeds.map(item => item.id),
    ...ledger.rumors.map(item => item.id),
    ...ledger.dimensions.map(item => item.id),
    ...ledger.chronicle.map(item => item.id),
  ]);
  const anchors = collectWorldSimulationGuidanceAnchorSentences_ACU(ledger, anchorMessage);
  return signals.map((signal, index) => {
    const sourceId = String(signal.sourceId ?? '').trim();
    const text = String(signal.text ?? '').trim();
    if (!sourceId || !knownIds.has(sourceId)) {
      fail_ACU('UNKNOWN_GUIDANCE_SOURCE', `signals[${index}].sourceId`, 'ledger source id, clock, or player', sourceId);
    }
    if (text.length > WORLD_GUIDANCE_SIGNAL_MAX_CHARS_ACU) {
      fail_ACU('GUIDANCE_SIGNAL_TOO_LONG', `signals[${index}].text`, `text with at most ${WORLD_GUIDANCE_SIGNAL_MAX_CHARS_ACU} characters`, text);
    }
    for (const anchor of anchors) {
      if (text.includes(anchor) || anchor.includes(text)) {
        fail_ACU('GUIDANCE_RESTATES_ANCHOR', `signals[${index}].text`, 'non-quoted world fact', text);
      }
    }
    return { text, voice: signal.voice, sourceId };
  });
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

/** 子代理专用写动作；主 Agent 与 reviewer 继续使用只读主协议。 */
export function parseWorldSimulationSubagentToolCalls_ACU(raw: string | null | undefined, prefill = '', evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU, writable = false): Array<{ kind: 'write_sql'; sql: string; evidenceRefs: string[] } | Extract<WorldSimulationMainAction_ACU, { kind: 'read' | 'search' }>> | null {
  const text = stripNoise_ACU(String(raw ?? ''));
  const candidates = text.startsWith('{') || !prefill ? [text, `${prefill}${text}`] : [`${prefill}${text}`, text];
  for (const candidate of candidates) {
    const records = objects_ACU(candidate).map(normalizeLegacyToolAction_ACU);
    if (!records.length) continue;
    if (!records.some(record => ['read', 'search', 'write_sql'].includes(text_ACU(record.action)))) return null;
    return records.map(record => {
      if (record.action !== 'write_sql') return parseWorldSimulationMainAction_ACU(record, false, evidenceRegistry) as Extract<WorldSimulationMainAction_ACU, { kind: 'read' | 'search' }>;
      if (!writable) fail_ACU('WRITE_SCOPE_DENIED', '$.action', 'read/search', record.action);
      const payload = closedObject_ACU(record, '$', ['action', 'sql'], ['evidenceRefs']);
      return { kind: 'write_sql' as const, sql: requiredText_ACU(payload.sql, '$.sql'), evidenceRefs: authorizedEvidenceRefs_ACU(payload.evidenceRefs, '$.evidenceRefs', false, evidenceRegistry) };
    });
  }
  return null;
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
    'read 与 search 使用函数调用，不要写成 JSON。推理写在思维链里，闭合后再输出一个决策 JSON。不要 Markdown 围栏，也不要输出 <WORLD_SIMULATION_ENGINE_SEAM:...> 标签。',
    '调用 read 时参数 reads 必须是非空地址数组；调用 search 时参数 query 必填，可选 scope、maxResults、isRegex。不要添加 evidenceRef、purpose 或其他字段。',
    'evidenceRef 由服务端在读取成功后随工具结果颁发；只能在后续 finalize / candidate 的 evidenceRefs 数组中引用，不能由模型在 read/search 请求中生成。',
    'delegate 只能包含 action、delegations；open_round 只能包含 action、summary、focus、dispatchChronicler，skipModules 可选；block 只能包含 action、reason、unresolved。evidenceRefs 只允许出现在 finalize 顶层，其他动作禁止携带。',
    '调阅时调用函数，决策动作格式必须是下面之一：',
    '调用 read，参数 {"reads":["ledger:current","summary:current"]}',
    '调用 search，参数 {"query":"关键词","scope":["worldbook"],"maxResults":10}',
  ];
  if (allowDelegate) lines.push('{"action":"delegate","delegations":[{"agentName":"dramatis-keeper","instruction":"按用户要求核对人物档案","reads":[]}]}');
  lines.push('{"action":"open_round","summary":"锁定本轮幕后焦点并启动固定工作流","focus":"时间推进与暗流压力","dispatchChronicler":false}');
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
    '推理写在思维链里。闭合后只输出一个 JSON 对象，不要 Markdown、解释或额外字段。',
    'status 必须精确为 candidate、no_change、failed、blocked 之一。',
    `agentName 必须精确为 ${agentName}。`,
  ];
  if (writableModules.length) {
    lines.push(`candidate 的 sql 只允许写：${writableModules.join(' | ')}${writableModules.includes('chronicle') ? ' | chronicle_archive | chronicle_overview' : ''}；不得输出 patch。`);
    lines.push('使用受限 INSERT/UPDATE/DELETE；数组模块 UPDATE/DELETE 的 WHERE 必须带 id、expected_revision，DELETE 还须带 reason；chronicle 仅允许 INSERT 或 DELETE，DELETE WHERE 只带 id、reason，不带 expected_revision；单例 UPDATE 只带 expected_revision。字符串用单引号，数组与对象用单引号包裹 JSON 文本；禁止 SELECT、DDL、函数及子查询。');
    const firstModule = writableModules[0];
    const sqlExample = ['clock', 'player', 'guidance'].includes(firstModule)
      ? `UPDATE ${firstModule} SET ${firstModule === 'clock' ? 'days = 1' : firstModule === 'player' ? "contact = 'open'" : "signals = '[]'"} WHERE expected_revision = 0;`
      : `INSERT INTO ${firstModule} (${firstModule === 'chronicle' ? 'summary' : firstModule === 'seeds' ? 'title' : firstModule === 'rumors' ? 'fact' : 'name'}) VALUES ('示例');`;
    lines.push(JSON.stringify({
      status: 'candidate',
      agentName,
      sql: sqlExample,
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

export function renderWorldSimulationReviewerProtocolRejection_ACU(issue: WorldSimulationProtocolIssue_ACU): string {
  return [
    `你上一次的审核输出没有被采纳。原因：${issue.reasonCode} ${issue.path} 应为 ${issue.expected}。`,
    '推理写在思维链里，闭合后再输出一个 JSON 对象。不要 Markdown 围栏、解释、<WORLD_SIMULATION_ENGINE_SEAM:...> 标签或额外字段。',
    '顶层必须且只能包含 verdict、summary、findings、acceptedCandidateIds；不得输出 guidance。',
    'verdict 必须精确为 accept、revise、reject 之一；不得使用 approve、approved、pass、success、done 等别名。',
    'findings 必须是数组；每项必须且只能包含 severity、reasonCode、path、expected、actual。severity 必须精确为 blocking、major、minor 之一。',
    'accept 必须包含至少一个真实候选 ID；reject 的 acceptedCandidateIds 必须为空；不得编造候选 ID。',
    '不得输出 guidance：投影由 guidance-composer 专责，审核只判断时间、空间、因果、权限与证据。',
    JSON.stringify({ verdict: 'accept', summary: '候选满足时间、因果、权限与证据约束', findings: [], acceptedCandidateIds: ['candidate:已有候选ID'] }),
    JSON.stringify({
      verdict: 'revise',
      summary: '候选仍需修正',
      findings: [{ severity: 'major', reasonCode: 'CAUSE_GAP', path: '$.clock', expected: '时间与因果连续', actual: '缺少因果说明' }],
      acceptedCandidateIds: [],
    }),
    JSON.stringify({
      verdict: 'reject',
      summary: '候选不满足证据约束',
      findings: [{ severity: 'blocking', reasonCode: 'EVIDENCE_GAP', path: '$', expected: '可验证证据', actual: '缺失' }],
      acceptedCandidateIds: [],
    }),
  ].join('\n');
}

export function renderWorldSimulationPlannerProtocolRejection_ACU(issue: WorldSimulationProtocolIssue_ACU): string {
  return [
    `你上一次的阶段规划输出没有被采纳。原因：${issue.reasonCode} ${issue.path} 应为 ${issue.expected}。`,
    '推理写在思维链里，闭合后再输出一个 JSON 对象。不要 Markdown 围栏、解释、<WORLD_SIMULATION_ENGINE_SEAM:...> 标签或额外字段。',
    '顶层必须且只能包含 action、summary、plan；action 必须精确为 plan，summary 必须是非空字符串，plan 不得省略、设为 null 或只返回摘要。',
    `plan 必须完整包含 schemaVersion、title、objective、impactScope、factsToVerify、plannedTools、plannedSpecialists、expectedLedgerChanges、convergenceConditions、blockingConditions、completedSteps、nextStep。expectedLedgerChanges 只能使用：${WORLD_SIMULATION_LEDGER_MODULES_ACU.join(' | ')}。`,
    JSON.stringify({
      action: 'plan',
      summary: '锁定本轮幕后推演焦点',
      plan: {
        schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU,
        title: '推演本轮幕后动态',
        objective: '根据最新剧情推算幕后世界演变',
        impactScope: ['当前世界状态'],
        factsToVerify: ['时间是否推进'],
        plannedTools: ['read'],
        plannedSpecialists: ['timekeeper', 'undercurrent-analyst'],
        expectedLedgerChanges: ['clock'],
        convergenceConditions: ['证据与候选闭合'],
        blockingConditions: ['缺少锚点'],
        completedSteps: [],
        nextStep: '读取当前账本',
      },
    }),
  ].join('\n');
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

/** write_sql 的逐栏意图；旧 specialist 最终契约的整行转换不参与此入口。 */
export interface WorldSimulationSqlFieldIntent_ACU {
  kind: 'insert' | 'update' | 'delete';
  module: keyof typeof WORLD_SIMULATION_SQL_TABLE_MODULE_ACU;
  id: string;
  fields: Record<string, unknown>;
  expectedRevision?: number;
  reason?: string;
}
export interface WorldSimulationSqlFieldRejection_ACU { path: string; reason: string }
export interface WorldSimulationSqlFieldParseResult_ACU {
  intents: WorldSimulationSqlFieldIntent_ACU[];
  rejected: WorldSimulationSqlFieldRejection_ACU[];
}

/** 语法错误抛协议错误；无权的语句与非法栏目分别拒绝，不吞掉相邻合法栏目。 */
export function parseWorldSimulationSqlFieldWrites_ACU(sql: string, role: string): WorldSimulationSqlFieldParseResult_ACU {
  let statements: RestrictedSqlStatement_ACU[];
  try { statements = parseRestrictedSqlDml_ACU(sql); }
  catch (error) { fail_ACU('SQL_INVALID', '$.sql', 'restricted INSERT/UPDATE/DELETE', error instanceof Error ? error.message : String(error)); }
  if (!statements.length) fail_ACU('SQL_EMPTY', '$.sql', 'non-empty DML write set', sql);
  const writable = new Set(findWorldSimulationAgentDefinition_ACU(role)?.writableModules ?? []);
  const result: WorldSimulationSqlFieldParseResult_ACU = { intents: [], rejected: [] };
  statements.forEach((statement, index) => {
    const path = `sql[${index}].${statement.table}`;
    const reject = (field: string, reason: string) => result.rejected.push({ path: `${path}${field ? `.${field}` : ''}`, reason });
    const module = WORLD_SIMULATION_SQL_TABLE_MODULE_ACU[statement.table as keyof typeof WORLD_SIMULATION_SQL_TABLE_MODULE_ACU];
    if (!module || !writable.has(module === 'chronicleArchive' ? 'chronicle' : module)) { reject('', '角色无权写入该表'); return; }
    const archive = statement.table === 'chronicle_archive' || statement.table === 'chronicle_overview';
    const singleton = statement.table === 'clock' || statement.table === 'player' || statement.table === 'guidance';
    const chronicle = statement.table === 'chronicle';
    if ((archive || chronicle) && statement.kind === 'update'
      || archive && statement.kind !== 'insert'
      || singleton && statement.kind !== 'update') { reject('', '该表不允许此操作'); return; }
    const where = statement.kind === 'insert' ? {} : statement.where;
    const required = singleton ? ['expected_revision'] : chronicle ? ['id', 'reason'] : ['id', 'expected_revision', ...(statement.kind === 'delete' ? ['reason'] : [])];
    if (statement.kind !== 'insert' && (Object.keys(where).some(key => !required.includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(where, key)))) {
      reject('WHERE', `WHERE 只允许且必须包含 ${required.join(', ')}`); return;
    }
    if (statement.kind !== 'insert' && !singleton && (typeof where.id !== 'string' || !where.id.trim())) { reject('WHERE.id', '必须指定非空 ID'); return; }
    if (statement.kind === 'delete' && (typeof where.reason !== 'string' || !where.reason.trim())) { reject('WHERE.reason', '必须指定非空理由'); return; }
    const rawRevision = statement.kind === 'insert' ? statement.values.expected_revision : where.expected_revision;
    if (!archive && !chronicle && (typeof rawRevision !== 'number' || !Number.isInteger(rawRevision) || rawRevision < 0)) {
      reject('expected_revision', '必须指定非负整数 revision'); return;
    }
    const id = singleton ? '_' : statement.kind === 'insert' ? statement.values.id : where.id;
    if (statement.kind === 'insert' && id !== undefined && (typeof id !== 'string' || !id.trim())) { reject('id', 'ID 必须为非空字符串'); return; }
    if (statement.kind === 'delete') {
      result.intents.push({ kind: 'delete', module: statement.table as WorldSimulationSqlFieldIntent_ACU['module'], id: String(id).trim(), fields: {},
        ...(typeof rawRevision === 'number' ? { expectedRevision: rawRevision } : {}), reason: String(where.reason).trim() });
      return;
    }
    const fields: Record<string, unknown> = {};
    const columns = WORLD_SIMULATION_SQL_COLUMNS_ACU[statement.table];
    for (const [column, value] of Object.entries(statement.values)) {
      if (column === 'expected_revision' || column === 'id') {
        if (statement.kind !== 'insert') reject(column, 'SET 不得写入 ID 或 revision');
        continue;
      }
      if (!columns?.has(column)) { reject(column, 'field_forbidden'); continue; }
      fields[simulationSqlColumnName_ACU(column)] = simulationSqlValue_ACU(value);
    }
    if (!Object.keys(fields).length) { reject('', '没有可提交的栏目'); return; }
    result.intents.push({ kind: statement.kind, module: statement.table as WorldSimulationSqlFieldIntent_ACU['module'],
      id: typeof id === 'string' ? id.trim() : '', fields,
      ...(typeof rawRevision === 'number' ? { expectedRevision: rawRevision } : {}) });
  });
  return result;
}
