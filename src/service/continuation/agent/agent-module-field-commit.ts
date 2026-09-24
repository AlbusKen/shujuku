/** 续写子代理逐栏 SQL：楼层帧是权威，SQLite 只负责复算。 */
import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import {
  AGENT_CHRONOLOGY_PRECISIONS_ACU, AGENT_HOOK_IMPORTANCES_ACU, AGENT_HOOK_STATUSES_ACU,
  AGENT_MODULE_FIELD_ACU, AGENT_MODULE_FIELD_MATRIX_ACU, AGENT_REVEAL_STATUSES_ACU,
  AGENT_STORY_ARC_SCOPES_ACU, AGENT_STORY_ARC_STATUSES_ACU, AGENT_VOLUME_NARRATIVE_ROLES_ACU,
  type AgentModuleDelta_ACU, type AgentModuleFieldRecord_ACU, type AgentModuleFieldSnapshot_ACU,
  type AgentModuleFloorDelta_ACU, type AgentModuleSnapshot_ACU, type AgentSubagentName_ACU,
  type AgentWebRefEntry_ACU, type AgentWritableModule_ACU, type AgentResearcherOutput_ACU,
} from './agent-model';
import { foldAgentModuleSnapshot_ACU, planAgentModuleCommitDelta_ACU, readMessageSwipeId_ACU } from './agent-module-frame';
import { materializeAgentModuleSqlView_ACU, type AgentModuleSqlFieldBatch_ACU } from './agent-module-sql-view';
import { agentModuleFrameDeps_ACU, captureAgentModuleCommitBaseline_ACU, readAgentModuleFoldState_ACU, writeAgentModuleCommitDelta_ACU, normalizeEvidenceIndexes_ACU } from './agent-module-store';
import { parseAgentModuleSqlFieldWrites_ACU, type AgentModuleSqlFieldIntent_ACU, type AgentModuleSqlFieldRejection_ACU } from './agent-protocol';
import { applyAgentModuleDelta_ACU, applyAgentWebRefsDelta_ACU, nextAgentWebRefId_ACU } from './agent-transaction';
import { agentStoryEvidenceFloorIndexes_ACU } from './agent-placeholder-resolver';

type Module_ACU = 'hooks' | 'infoGap' | 'storyArc' | 'chronology' | 'webRefs';
const ROLE_MODULES_ACU: Readonly<Partial<Record<AgentSubagentName_ACU, readonly AgentWritableModule_ACU[]>>> = {
  'arc-architect': ['storyArc'],
  'hook-cognition-maintainer': ['hooks', 'infoGap', 'chronology'],
  'web-researcher': ['webRefs'],
};

/** 本次派工抓取成功的网页句柄；不得由模型自行指定来源 URL。 */
export interface AgentFieldPage_ACU {
  title: string;
  source: AgentWebRefEntry_ACU['source'];
  url: string;
  query: string;
  sourceStatus: AgentWebRefEntry_ACU['sourceStatus'];
}
export interface AgentModuleFieldAccepted_ACU { module: Module_ACU; id: string; field: string; revision: number }
export interface AgentModuleFieldReceipt_ACU {
  status: 'committed' | 'rejected' | 'persist_failed' | 'readback_failed';
  accepted: AgentModuleFieldAccepted_ACU[];
  rejected: AgentModuleSqlFieldRejection_ACU[];
  /** null 表示保存/补偿后的当前状态无法确认；必须重新读取权威帧。 */
  partials: Array<{ module: Module_ACU; id: string; missingFields: string[]; promotionError?: string }> | null;
  revisions: AgentModuleSnapshot_ACU['revisions'] | null;
  constraintProposals: string[];
  sqlDiagnostics?: string;
  recovery?: 'saved' | 'failed' | 'unavailable';
}
export interface AgentModuleFieldPlan_ACU {
  batches: AgentModuleSqlFieldBatch_ACU[];
  snapshot: AgentModuleSnapshot_ACU;
  accepted: AgentModuleFieldAccepted_ACU[];
  rejected: AgentModuleSqlFieldRejection_ACU[];
  partials: NonNullable<AgentModuleFieldReceipt_ACU['partials']>;
}
function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function errorText_ACU(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function text_ACU(value: unknown): value is string { return typeof value === 'string'; }
function nonempty_ACU(value: unknown): boolean { return text_ACU(value) && !!value.trim(); }
function index_ACU(value: unknown): boolean { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function stringArray_ACU(value: unknown): boolean { return Array.isArray(value) && value.every(nonempty_ACU); }
function record_ACU(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function inList_ACU(value: unknown, list: readonly string[]): boolean { return text_ACU(value) && list.includes(value); }

/** 显式栏目逐栏校验；null、合法空值与缺栏不可混淆。 */
function fieldProblem_ACU(module: Module_ACU, field: string, value: unknown, snapshot: AgentModuleSnapshot_ACU, evidence?: ReadonlySet<number>): string | null {
  switch (module) {
    case 'hooks':
      if (field === 'status') return inList_ACU(value, AGENT_HOOK_STATUSES_ACU) ? null : 'status 枚举非法';
      if (field === 'importance') return inList_ACU(value, AGENT_HOOK_IMPORTANCES_ACU) ? null : 'importance 枚举非法';
      if (field === 'plantedIndex') return index_ACU(value) && (value as number) <= snapshot.settledThroughIndex && (!evidence || evidence.has(value as number)) ? null : 'plantedIndex 必须引用已结算正文楼层';
      return field === 'summary' ? (nonempty_ACU(value) ? null : 'summary 必须为非空文本') : (text_ACU(value) ? null : '必须为字符串');
    case 'infoGap':
      if (field === 'revealStatus') return inList_ACU(value, AGENT_REVEAL_STATUSES_ACU) ? null : 'revealStatus 枚举非法';
      if (field === 'revealIndex') return value === null || (index_ACU(value) && (value as number) <= snapshot.settledThroughIndex && (!evidence || evidence.has(value as number))) ? null : 'revealIndex 必须为空或已结算正文楼层';
      if (field === 'characterKnowledge') return Array.isArray(value) && value.every(item => record_ACU(item) && nonempty_ACU(item.name) && text_ACU(item.knows)) ? null : 'characterKnowledge 需要带 name / knows 的数组';
      return field === 'topic' ? (nonempty_ACU(value) ? null : 'topic 必须为非空文本') : (text_ACU(value) ? null : '必须为字符串');
    case 'chronology':
      if (field === 'precision') return inList_ACU(value, AGENT_CHRONOLOGY_PRECISIONS_ACU) ? null : 'precision 枚举非法';
      if (field === 'evidenceIndexes') {
        const indexes = normalizeEvidenceIndexes_ACU(value);
        return indexes?.length && indexes.every(item => item <= snapshot.settledThroughIndex && (!evidence || evidence.has(item))) ? null : 'evidenceIndexes 必须是非空、已结算正文楼层数组';
      }
      return nonempty_ACU(value) ? null : '时间事实栏目必须为非空文本';
    case 'storyArc':
      if (field === 'scope') return inList_ACU(value, AGENT_STORY_ARC_SCOPES_ACU) ? null : 'scope 枚举非法';
      if (field === 'status') return inList_ACU(value, AGENT_STORY_ARC_STATUSES_ACU) ? null : 'status 枚举非法';
      if (field === 'narrativeRole') return inList_ACU(value, AGENT_VOLUME_NARRATIVE_ROLES_ACU) ? null : 'narrativeRole 枚举非法';
      if (field === 'stageNumbers') return Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 1) ? null : 'stageNumbers 必须是正整数数组';
      if (field === 'completionStageNumber') return value === null || (Number.isInteger(value) && (value as number) >= 1) ? null : 'completionStageNumber 必须为正整数或 null';
      if (field === 'targetStageRange') return record_ACU(value) && Number.isInteger(value.min) && (value.min as number) >= 1 && Number.isInteger(value.max) && (value.max as number) >= (value.min as number) ? null : 'targetStageRange 需要 min/max 正整数且 max≥min';
      if (field === 'sustainingThreads' || field === 'payoffTargets') return stringArray_ACU(value) ? null : '必须是非空字符串数组';
      return ['title', 'direction'].includes(field) ? (nonempty_ACU(value) ? null : '必须为非空文本') : (text_ACU(value) ? null : '必须为字符串');
    case 'webRefs':
      if (field === 'tags') return Array.isArray(value) && value.every(nonempty_ACU) ? null : 'tags 必须是非空字符串数组';
      return ['title', 'brief'].includes(field) ? (nonempty_ACU(value) ? null : '必须为非空文本') : (text_ACU(value) ? null : '必须为字符串');
  }
}

function domainRow_ACU(snapshot: AgentModuleSnapshot_ACU, module: Module_ACU, id: string): Record<string, unknown> | null {
  return (snapshot[module] as unknown as Array<Record<string, unknown>>).find(item => item.id === id) ?? null;
}
function freshDelta_ACU(module: Module_ACU, revision: number): AgentModuleDelta_ACU {
  return { expectedRevisions: { [module]: revision }, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [],
    storyArc: [], storyArcPatches: [], chronology: [], chronologyPatches: [], constraintProposals: [] };
}

/** 逐 ID 复用既有领域事务：缺栏或领域不合格时不产生完整领域行。 */
function applyDomain_ACU(snapshot: AgentModuleSnapshot_ACU, module: Module_ACU, id: string, values: Record<string, unknown>, action: 'insert' | 'update' | 'delete', reason: string | undefined, completedStages: readonly number[], now: number): AgentModuleSnapshot_ACU {
  if (module === 'webRefs') {
    if (action === 'delete') return applyAgentWebRefsDelta_ACU(snapshot, {
      summary: '', expectedRevision: snapshot.revisions.webRefs, items: [{ action: 'retire', id, title: '', source: 'web', url: '', query: '', tags: [], brief: '', summary: '', sourceStatus: 'ok', reason: reason ?? '' }],
    }, snapshot.revisions.webRefs, now).snapshot;
    const row = domainRow_ACU(snapshot, module, id);
    const metadata = values as unknown as AgentWebRefEntry_ACU;
    const output: AgentResearcherOutput_ACU = row ? {
      summary: '', expectedRevision: snapshot.revisions.webRefs, items: [], patches: [{ id, title: values.title as string | undefined, brief: values.brief as string | undefined,
        tags: values.tags as string[] | undefined, summary: values.summary as string | undefined,
        ...(values.url !== undefined ? { url: values.url as string, source: metadata.source, query: metadata.query, sourceStatus: metadata.sourceStatus } : {}),
      }],
    } : {
      summary: '', expectedRevision: snapshot.revisions.webRefs, patches: [], items: [{ action: 'upsert' as const, id, title: values.title as string, brief: values.brief as string,
        tags: (values.tags as string[] | undefined) ?? [], summary: (values.summary as string | undefined) ?? '',
        url: metadata.url, source: metadata.source, query: metadata.query, sourceStatus: metadata.sourceStatus, reason: '',
      }],
    };
    const applied = applyAgentWebRefsDelta_ACU(snapshot, output, snapshot.revisions.webRefs, now);
    return { ...applied.snapshot, pendingFixes: snapshot.pendingFixes };
  }
  const delta = freshDelta_ACU(module, snapshot.revisions[module]);
  if (module === 'hooks') {
    if (action === 'update') delta.hookPatches.push({ id, ...values });
    else delta.hooks.push({ action: action === 'delete' ? 'retire' : 'upsert', id, summary: values.summary as string ?? '',
      status: values.status as AgentModuleDelta_ACU['hooks'][number]['status'] ?? 'planted',
      importance: values.importance as AgentModuleDelta_ACU['hooks'][number]['importance'] ?? 'mid',
      plantedIndex: values.plantedIndex as number ?? -1, plannedPayoff: values.plannedPayoff as string ?? '', reason: reason ?? '' });
  } else if (module === 'infoGap') {
    if (action === 'update') delta.infoGapPatches.push({ id, ...values });
    else delta.infoGap.push({ action: action === 'delete' ? 'retire' : 'upsert', id, topic: values.topic as string ?? '',
      objectiveFact: values.objectiveFact as string ?? '', readerKnown: values.readerKnown as string ?? '',
      characterKnowledge: values.characterKnowledge as AgentModuleDelta_ACU['infoGap'][number]['characterKnowledge'] ?? [],
      revealStatus: values.revealStatus as AgentModuleDelta_ACU['infoGap'][number]['revealStatus'] ?? 'unrevealed',
      revealIndex: values.revealIndex as number | null ?? null, reason: reason ?? '' });
  } else if (module === 'storyArc') {
    if (action === 'update') delta.storyArcPatches.push({ id, ...values });
    else delta.storyArc.push({ action: action === 'delete' ? 'retire' : 'upsert', id,
      scope: values.scope as AgentModuleDelta_ACU['storyArc'][number]['scope'] ?? 'volume', title: values.title as string ?? '',
      direction: values.direction as string ?? '', escalation: values.escalation as string ?? '', withheld: values.withheld as string ?? '',
      status: values.status as AgentModuleDelta_ACU['storyArc'][number]['status'] ?? 'planned', statusProvided: true,
      stageNumbers: values.stageNumbers as number[] ?? [], completionStageNumber: values.completionStageNumber as number | null ?? null,
      completionState: values.completionState as string ?? '', continuationRationale: values.continuationRationale as string ?? '',
      narrativeRole: values.narrativeRole as AgentModuleDelta_ACU['storyArc'][number]['narrativeRole'],
      targetStageRange: values.targetStageRange as AgentModuleDelta_ACU['storyArc'][number]['targetStageRange'],
      targetTimeSpan: values.targetTimeSpan as string | undefined, progressCeiling: values.progressCeiling as string | undefined,
      sustainingThreads: values.sustainingThreads as string[] | undefined, payoffTargets: values.payoffTargets as string[] | undefined,
      completionRationale: values.completionRationale as string | undefined, reason: reason ?? '' });
  } else {
    if (action === 'update') delta.chronologyPatches.push({ id, ...values });
    else delta.chronology.push({ action: action === 'delete' ? 'retire' : 'upsert', id,
      anchor: values.anchor as string ?? '', elapsed: values.elapsed as string ?? '',
      precision: values.precision as AgentModuleDelta_ACU['chronology'][number]['precision'] ?? 'unknown',
      transition: values.transition as string ?? '', evidenceIndexes: values.evidenceIndexes as number[] ?? [], reason: reason ?? '' });
  }
  const applied = applyAgentModuleDelta_ACU(snapshot, delta, [module], snapshot.settledThroughIndex, completedStages);
  // 单栏独立事务只使用领域规则校验，不把旧 pendingFixes 视作本次修复。
  return { ...applied.snapshot, pendingFixes: snapshot.pendingFixes };
}

/** 纯规划：单栏校验独立；跨字段合并仍调用领域事务作一致性检查。 */
export function planAgentModuleFieldCommit_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  fields: AgentModuleFieldSnapshot_ACU,
  intents: readonly AgentModuleSqlFieldIntent_ACU[],
  role: AgentSubagentName_ACU,
  completedStages: readonly number[] = [],
  resolvePage?: (handle: string) => AgentFieldPage_ACU | null,
  now = Date.now(),
  evidence?: ReadonlySet<number>,
): AgentModuleFieldPlan_ACU {
  let working = snapshot;
  const drafts = new Map<string, Record<string, unknown>>();
  const batches = new Map<Module_ACU, AgentModuleSqlFieldBatch_ACU>();
  const accepted: AgentModuleFieldAccepted_ACU[] = [];
  const rejected: AgentModuleSqlFieldRejection_ACU[] = [];
  const promotionProblems = new Map<string, string>();
  const reserved = new Set<string>();
  const modules = ROLE_MODULES_ACU[role] ?? [];
  const reject = (path: string, reason: string): void => { rejected.push({ path, reason }); };
  const bucketFor = (module: Module_ACU): AgentModuleSqlFieldBatch_ACU => {
    let batch = batches.get(module);
    if (!batch) {
      batch = { module, expectedRevision: snapshot.revisions[module], updatedAt: now, fieldWrites: {}, domainUpserts: {}, discardPartialIds: [] };
      batches.set(module, batch);
    }
    return batch;
  };
  for (const intent of intents) {
    const module = intent.module as Module_ACU;
    const id = intent.id || (module === 'webRefs' && intent.kind === 'insert'
      ? nextAgentWebRefId_ACU(snapshot.webRefs, new Set([...reserved, ...Object.keys(fields.records.webRefs ?? {})])) : '');
    const path = `${module}#${id || '(无 ID)'}`;
    if (!modules.includes(intent.module) || !['hooks', 'infoGap', 'storyArc', 'chronology', 'webRefs'].includes(module)) {
      reject(path, '角色无权写入该模块'); continue;
    }
    if (!id || id.includes('#') || ['__proto__', 'prototype', 'constructor'].includes(id) || id.length > 128) { reject(path, '条目 ID 无效'); continue; }
    if (intent.expectedRevision !== snapshot.revisions[module]) {
      reject(path, `revision_conflict: expected=${intent.expectedRevision}, actual=${snapshot.revisions[module]}`); continue;
    }
    const key = `${module}#${id}`;
    const existing = domainRow_ACU(working, module, id);
    const record = fields.records[module]?.[id];
    if (intent.kind === 'insert' && (existing || record || drafts.has(key) || reserved.has(id))) { reject(path, 'id_exists'); continue; }
    if (intent.kind !== 'insert' && !existing && !record && !drafts.has(key)) { reject(path, 'not_found'); continue; }
    if (existing?.retired && intent.kind !== 'delete') { reject(path, 'retired: 已退役条目不可修改'); continue; }
    if (intent.kind === 'delete') {
      if (existing) {
        try { working = applyDomain_ACU(working, module, id, {}, 'delete', intent.reason, completedStages, now); }
        catch (error) { reject(`${path}.reason`, errorText_ACU(error)); continue; }
        bucketFor(module).domainUpserts![id] = domainRow_ACU(working, module, id)!;
        accepted.push({ module, id, field: 'retired', revision: 0 });
      } else {
        const batch = bucketFor(module);
        (batch.discardPartialIds as string[]).push(id);
        delete batch.fieldWrites![id];
        drafts.delete(key);
        accepted.push({ module, id, field: 'discardPartial', revision: 0 });
      }
      continue;
    }
    const baseline: Record<string, unknown> = drafts.get(key) ?? (existing ? { ...existing } : Object.fromEntries(Object.entries(record?.fields ?? {}).map(([field, entry]) => [field, entry.value])));
    const writable: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(intent.fields)) {
      const fieldPath = `${path}.${field}`;
      if (!AGENT_MODULE_FIELD_MATRIX_ACU[module].fields.includes(field) || ['retired', 'retiredReason', 'updatedIndex', 'fetchedAt', 'source', 'url', 'query', 'sourceStatus'].includes(field)) {
        reject(fieldPath, 'field_forbidden'); continue;
      }
      if ((field === 'plantedIndex' && existing) || (field === 'scope' && existing && existing.scope !== raw)) {
        reject(fieldPath, '已登记的不可变栏目不能改写'); continue;
      }
      const problem = fieldProblem_ACU(module, field, raw, snapshot, evidence);
      if (problem) { reject(fieldPath, problem); continue; }
      writable[field] = raw;
    }
    if (intent.pageRef) {
      if (module !== 'webRefs') reject(`${path}.pageRef`, 'field_forbidden');
      else {
        const page = resolvePage?.(intent.pageRef) ?? null;
        if (!page || page.sourceStatus !== 'ok' || !nonempty_ACU(page.url) || !nonempty_ACU(page.title)) reject(`${path}.pageRef`, '页面句柄未在本次派工成功抓取');
        else Object.assign(writable, { url: page.url.trim(), source: page.source, query: page.query, sourceStatus: page.sourceStatus });
      }
    }
    if (!Object.keys(writable).length) continue;
    const merged = { ...baseline, ...writable };
    if (module === 'infoGap' && (Object.prototype.hasOwnProperty.call(writable, 'revealStatus') || Object.prototype.hasOwnProperty.call(writable, 'revealIndex'))
      && merged.revealStatus !== undefined && (merged.revealIndex !== undefined || !!existing)) {
      const status = merged.revealStatus;
      const reveal = merged.revealIndex ?? null;
      if ((status === 'unrevealed' && reveal !== null) || (status !== 'unrevealed' && reveal === null)) {
        for (const field of ['revealStatus', 'revealIndex']) if (Object.prototype.hasOwnProperty.call(writable, field)) {
          reject(`${path}.${field}`, 'consistency_group: 揭示状态与楼层必须一致'); delete writable[field];
        }
      }
    }
    if (!Object.keys(writable).length) continue;
    const candidate = { ...baseline, ...writable };
    const complete = existing || AGENT_MODULE_FIELD_MATRIX_ACU[module].required.every(field => Object.prototype.hasOwnProperty.call(candidate, field));
    if (complete) {
      try {
        working = applyDomain_ACU(working, module, id, existing ? writable : candidate, existing ? 'update' : 'insert', undefined, completedStages, now);
        bucketFor(module).domainUpserts![id] = domainRow_ACU(working, module, id)!;
        promotionProblems.delete(key);
      } catch (error) {
        if (existing) { for (const field of Object.keys(writable)) reject(`${path}.${field}`, errorText_ACU(error)); continue; }
        promotionProblems.set(key, errorText_ACU(error));
      }
    }
    drafts.set(key, candidate);
    const writes = (bucketFor(module).fieldWrites![id] ??= {});
    for (const [field, value] of Object.entries(writable)) {
      writes[field] = { value };
      accepted.push({ module, id, field, revision: 0 });
    }
    if (intent.kind === 'insert') reserved.add(id);
  }
  const partials: NonNullable<AgentModuleFieldReceipt_ACU['partials']> = [];
  for (const [key, values] of drafts) {
    const [module, id] = key.split('#') as [Module_ACU, string];
    if (domainRow_ACU(working, module, id)) continue;
    partials.push({ module, id, missingFields: AGENT_MODULE_FIELD_MATRIX_ACU[module].required.filter(field => !Object.prototype.hasOwnProperty.call(values, field)),
      ...(promotionProblems.has(key) ? { promotionError: promotionProblems.get(key) } : {}) });
  }
  return { snapshot: working, batches: [...batches.values()].filter(batch => Object.keys(batch.fieldWrites!).length || Object.keys(batch.domainUpserts!).length || batch.discardPartialIds!.length), accepted, rejected, partials };
}

function confirmedPartials_ACU(fields: AgentModuleFieldSnapshot_ACU, planned: NonNullable<AgentModuleFieldReceipt_ACU['partials']> = []): NonNullable<AgentModuleFieldReceipt_ACU['partials']> {
  const problems = new Map(planned.filter(item => item.promotionError).map(item => [`${item.module}#${item.id}`, item.promotionError!]));
  const partials: NonNullable<AgentModuleFieldReceipt_ACU['partials']> = [];
  for (const module of ['hooks', 'infoGap', 'storyArc', 'chronology', 'webRefs'] as const) {
    for (const [id, record] of Object.entries(fields.records[module] ?? {})) {
      if (record.status !== 'partial') continue;
      const problem = problems.get(`${module}#${id}`);
      partials.push({ module, id, missingFields: [...record.missingFields], ...(problem ? { promotionError: problem } : {}) });
    }
  }
  return partials;
}

function verifyRecords_ACU(actual: AgentModuleFieldSnapshot_ACU, sqlRecords: Map<string, AgentModuleFieldRecord_ACU | null>): boolean {
  for (const [key, expected] of sqlRecords) {
    const [module, id] = key.split('#') as [Module_ACU, string];
    if (canonical_ACU(actual.records[module]?.[id] ?? null) !== canonical_ACU(expected)) return false;
  }
  return true;
}
const queue_ACU = new WeakMap<any[], Promise<void>>();

/** 同聊天串行；只有宿主保存成功且楼层重新折叠验证后签发 accepted。 */
export function commitAgentModuleFieldWrites_ACU(input: {
  chat: any[];
  targetIndex: number;
  dispatchTarget?: { message: unknown; swipeId: string; content: unknown };
  sql: string;
  role: AgentSubagentName_ACU;
  completedStages?: readonly number[];
  resolvePage?: (handle: string) => AgentFieldPage_ACU | null;
  isCurrent?: () => boolean;
}): Promise<AgentModuleFieldReceipt_ACU> {
  const prior = queue_ACU.get(input.chat) ?? Promise.resolve();
  const run = prior.catch(() => {}).then(async (): Promise<AgentModuleFieldReceipt_ACU> => {
    const dispatchTargetCurrent = () => !input.dispatchTarget || (input.chat[input.targetIndex] === input.dispatchTarget.message
      && readMessageSwipeId_ACU(input.chat[input.targetIndex]) === input.dispatchTarget.swipeId
      && input.chat[input.targetIndex]?.mes === input.dispatchTarget.content);
    const isCurrent = () => (input.isCurrent?.() ?? true) && dispatchTargetCurrent();
    const parsed = parseAgentModuleSqlFieldWrites_ACU(input.sql, input.role);
    const folded = readAgentModuleFoldState_ACU(input.chat);
    const baseline = captureAgentModuleCommitBaseline_ACU(input.chat);
    const receipt: AgentModuleFieldReceipt_ACU = {
      status: 'rejected', accepted: [], rejected: [...parsed.rejected], partials: confirmedPartials_ACU(folded.fields),
      revisions: { ...folded.snapshot.revisions }, constraintProposals: parsed.constraintProposals,
    };
    if (!isCurrent() || getChatArray_ACU() !== input.chat || !input.chat[input.targetIndex] || input.chat[input.targetIndex].is_user === true || input.targetIndex !== input.chat.length - 1) {
      receipt.rejected.push({ path: 'chat', reason: '当前聊天或目标楼层已变化' });
      receipt.partials = null; receipt.revisions = null; return receipt;
    }
    if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
      receipt.rejected.push({ path: 'frame', reason: '资料帧损坏，拒绝在宽容抢救结果上写入' });
      receipt.partials = null; receipt.revisions = null; return receipt;
    }
    const now = Date.now();
    const plan = planAgentModuleFieldCommit_ACU(folded.snapshot, folded.fields, parsed.intents, input.role, input.completedStages, input.resolvePage, now, agentStoryEvidenceFloorIndexes_ACU(input.chat));
    receipt.rejected.push(...plan.rejected);
    if (!plan.batches.length) return receipt;
    let view: Awaited<ReturnType<typeof materializeAgentModuleSqlView_ACU>> | undefined;
    let delta: Pick<AgentModuleFloorDelta_ACU, 'writes' | 'revisions' | 'fieldUpserts' | 'removedIds'>;
    const expected = new Map<string, AgentModuleFieldRecord_ACU | null>();
    try {
      // 空聊天尚无合法基线；首个 schema-3 checkpoint 按现有帧契约使用水位 0。
      // 规划器仍基于原始 -1 水位校验正文证据，不能借首基线凭空结算第 0 楼。
      const base = folded.contributed ? folded.snapshot : { ...folded.snapshot, settledThroughIndex: 0 };
      view = await materializeAgentModuleSqlView_ACU(base, folded.fields);
      for (const batch of plan.batches) view.applyFieldBatch(batch);
      delta = view.exportDelta();
      for (const batch of plan.batches) {
        const ids = new Set([...Object.keys(batch.fieldWrites ?? {}), ...Object.keys(batch.domainUpserts ?? {}), ...(batch.discardPartialIds ?? [])]);
        for (const id of ids) expected.set(`${batch.module}#${id}`, view.readFieldRecord(batch.module, id));
      }
      const target = { ...plan.snapshot, settledThroughIndex: base.settledThroughIndex, revisions: { ...plan.snapshot.revisions, ...delta.revisions }, updatedAt: now };
      if (canonical_ACU({ ...view.readSnapshot(), updatedAt: now }) !== canonical_ACU(target)) throw new Error('SQL 复算领域快照与领域校验结果不一致');
      const scratch = input.chat.map(message => message && typeof message === 'object' ? { ...message } : message);
      const preview = planAgentModuleCommitDelta_ACU(scratch, input.targetIndex, delta, agentModuleFrameDeps_ACU(), null, now);
      if (!preview.changed) throw new Error('资料帧未能规划出可回读的写入');
      for (const assignment of preview.assignments) (scratch[assignment.index] as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU] = assignment.value;
      const projected = foldAgentModuleSnapshot_ACU(scratch, agentModuleFrameDeps_ACU());
      if (projected.salvaged || projected.candidates.some(item => !item.valid)
        || canonical_ACU({ ...projected.snapshot, updatedAt: now }) !== canonical_ACU({ ...view.readSnapshot(), updatedAt: now })
        || !verifyRecords_ACU(projected.fields, expected)) throw new Error('楼层帧与 SQL 逐栏复算不一致');
    } catch (error) {
      receipt.rejected.push({ path: 'sql', reason: errorText_ACU(error) });
      receipt.sqlDiagnostics = errorText_ACU(error);
      return receipt;
    } finally { view?.dispose(); }
    const result = await writeAgentModuleCommitDelta_ACU(input.chat, input.targetIndex, delta!, now, foldedResult =>
      !foldedResult.salvaged && foldedResult.candidates.every(item => item.valid)
      && canonical_ACU({ ...foldedResult.snapshot, updatedAt: now }) === canonical_ACU({ ...plan.snapshot, settledThroughIndex: folded.contributed ? plan.snapshot.settledThroughIndex : 0, revisions: { ...plan.snapshot.revisions, ...delta!.revisions }, updatedAt: now })
      && verifyRecords_ACU(foldedResult.fields, expected), baseline, isCurrent);
    receipt.status = result.status;
    if (result.recovery) receipt.recovery = result.recovery;
    if (result.status !== 'committed') {
      if (result.recovery !== 'saved') { receipt.partials = null; receipt.revisions = null; }
      receipt.rejected.push({ path: 'host', reason: result.reason ?? result.status }); return receipt;
    }
    const confirmed = readAgentModuleFoldState_ACU(input.chat);
    receipt.revisions = confirmed.snapshot.revisions;
    receipt.partials = confirmedPartials_ACU(confirmed.fields, plan.partials);
    receipt.accepted = plan.accepted.map(item => ({ ...item, revision: confirmed.fields.records[item.module]?.[item.id]?.fields[item.field]?.revision ?? 0 }));
    return receipt;
  });
  queue_ACU.set(input.chat, run.then(() => {}, () => {}));
  return run;
}
