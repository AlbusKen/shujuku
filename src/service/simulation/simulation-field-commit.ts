/** 世界推演 write_sql 逐栏规划；草稿只进入分栏帧，绝不伪装成账本条目。 */
import {
  WORLD_PLAYER_CONTACTS_ACU, WORLD_GUIDANCE_SIGNAL_VOICES_ACU, WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU,
  WORLD_SIMULATION_SINGLETON_ID_ACU, type WorldSimulationLedger_ACU, type WorldSimulationLedgerFieldSnapshot_ACU,
  type WorldSimulationLedgerModule_ACU, type WorldSimulationSettings_ACU,
} from './model';
import { findWorldSimulationAgentDefinition_ACU } from './agent/agent-catalog';
import type { WorldSimulationSqlFieldIntent_ACU, WorldSimulationSqlFieldRejection_ACU } from './agent/agent-protocol';
import { applyWorldSimulationFieldDomain_ACU, applyChronicleArchive_ACU } from './simulation-transaction';
import { validateWorldSimulationUpsertField_ACU, allocateWorldSimulationPrefixedId_ACU, WORLD_SIMULATION_UPSERT_ID_PREFIX_ACU,
  type WorldSimulationUpsertModule_ACU } from './simulation-patch-normalize';
import { collectWorldSimulationLedgerViolations_ACU, validateWorldSimulationLedger_ACU } from './simulation-store';
import { findUnauthorizedWorldSimulationEvidenceRefs_ACU, type WorldSimulationEvidenceRegistrySnapshot_ACU } from './world-simulation-evidence-registry';
import type { WorldChronicleArchiveDetail_ACU, WorldChronicleArchiveSnapshot_ACU } from './agent/agent-model';
import type { WorldSimulationSqlFieldBatch_ACU } from './simulation-ledger-sql-view';

export interface WorldSimulationFieldAccepted_ACU { module: WorldSimulationLedgerModule_ACU; id: string; field: string; revision: number; value?: unknown }
export interface WorldSimulationFieldPlan_ACU {
  ledger: WorldSimulationLedger_ACU;
  batches: WorldSimulationSqlFieldBatch_ACU[];
  archive: WorldChronicleArchiveSnapshot_ACU;
  archiveWrites: WorldChronicleArchiveDetail_ACU[];
  accepted: WorldSimulationFieldAccepted_ACU[];
  rejected: WorldSimulationSqlFieldRejection_ACU[];
  partials: Array<{ module: WorldSimulationLedgerModule_ACU; id: string; missingFields: string[]; promotionError?: string }>;
}

interface PendingWrite_ACU {
  module: WorldSimulationLedgerModule_ACU;
  id: string;
  original: Record<string, unknown> | null;
  fields: Record<string, unknown>;
  changes: Record<string, unknown>;
  discard: boolean;
  remove: boolean;
  reason?: string;
  promotionError?: string;
}
const isRecord_ACU = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text_ACU = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const safeId_ACU = (id: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const errorText_ACU = (error: unknown): string => error instanceof Error ? error.message : String(error);
const same_ACU = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const ARRAY_MODULES_ACU = new Set(['dimensions', 'seeds', 'actors', 'rumors', 'chronicle']);
const UPSERT_MODULES_ACU = new Set(['dimensions', 'seeds', 'actors', 'rumors']);

function domainRow_ACU(ledger: WorldSimulationLedger_ACU, module: WorldSimulationLedgerModule_ACU, id: string): Record<string, unknown> | null {
  if (!ARRAY_MODULES_ACU.has(module)) return ledger[module] as unknown as Record<string, unknown>;
  return ((ledger[module] ?? []) as Array<{ id: string }>).find(item => item.id === id) as Record<string, unknown> | undefined ?? null;
}

function validateField_ACU(module: WorldSimulationLedgerModule_ACU, field: string, value: unknown, path: string,
  registry?: WorldSimulationEvidenceRegistrySnapshot_ACU, declared: ReadonlySet<string> = new Set()): { value?: unknown; problem?: string } {
  if (field === 'evidenceRefs') {
    if (!Array.isArray(value) || !value.every(text_ACU)) return { problem: `${path} 必须是字符串数组` };
    const unknown = [...findUnauthorizedWorldSimulationEvidenceRefs_ACU(value, registry), ...value.filter(ref => !declared.has(ref))];
    return unknown.length ? { problem: `${path} 包含未声明或未授权证据: ${[...new Set(unknown)].join(', ')}` } : { value: value.map(ref => ref.trim()) };
  }
  if (UPSERT_MODULES_ACU.has(module)) return validateWorldSimulationUpsertField_ACU(module as WorldSimulationUpsertModule_ACU, field, value, path);
  if (module === 'chronicle') {
    if (field === 'at' || field === 'summary') return text_ACU(value) ? { value: value.trim() } : { problem: `${path} 必须是非空字符串` };
    if (field === 'relatedIds') return Array.isArray(value) && value.every(text_ACU) ? { value: value.map(item => item.trim()) } : { problem: `${path} 必须是字符串数组` };
  }
  if (module === 'clock') {
    if (field === 'days') return Number.isInteger(value) && (value as number) >= 0 ? { value } : { problem: `${path} 必须是非负整数` };
    if (field === 'slot' || field === 'storyTime') return typeof value === 'string' ? { value } : { problem: `${path} 必须是字符串` };
  }
  if (module === 'player') {
    if (field === 'contact') return typeof value === 'string' && (WORLD_PLAYER_CONTACTS_ACU as readonly string[]).includes(value) ? { value } : { problem: `${path} contact 枚举非法` };
    if (field === 'location') {
      if (value === null) return { value: null };
      if (isRecord_ACU(value) && text_ACU(value.region) && (value.place === undefined || typeof value.place === 'string')
        && Object.keys(value).every(key => key === 'region' || key === 'place')) return { value };
      return { problem: `${path} 需要带 region 的位置对象或 null` };
    }
  }
  if (module === 'guidance') {
    if (field === 'excludedFacts') return Array.isArray(value) && value.every(text_ACU) ? { value: value.map(item => item.trim()) } : { problem: `${path} 必须是字符串数组` };
    if (field === 'signals') return Array.isArray(value) && value.every(item => isRecord_ACU(item) && text_ACU(item.text)
      && text_ACU(item.sourceId) && (WORLD_GUIDANCE_SIGNAL_VOICES_ACU as readonly string[]).includes(String(item.voice)))
      ? { value } : { problem: `${path} signals 格式非法` };
  }
  return { problem: `${path} 不允许写入` };
}

function groupProblem_ACU(module: WorldSimulationLedgerModule_ACU, merged: Record<string, unknown>, changed: Record<string, unknown>): string[] {
  if (module === 'actors' && ['life', 'diedAtDay', 'deathSummary'].some(field => field in changed)) {
    if (merged.life === 'dead' && (!Number.isInteger(merged.diedAtDay) || !text_ACU(merged.deathSummary))
      || merged.life !== undefined && merged.life !== 'dead' && (merged.diedAtDay != null || merged.deathSummary != null)) return ['life', 'diedAtDay', 'deathSummary'];
  }
  if (module === 'seeds' && ['status', 'retiredReason'].some(field => field in changed)) {
    if (merged.status === 'retired' && !text_ACU(merged.retiredReason)
      || merged.status !== undefined && merged.status !== 'retired' && merged.retiredReason != null) return ['status', 'retiredReason'];
  }
  if (module === 'rumors') {
    if (['originDay', 'earliestRevealDay'].some(field => field in changed)
      && typeof merged.originDay === 'number' && typeof merged.earliestRevealDay === 'number' && merged.earliestRevealDay < merged.originDay) return ['originDay', 'earliestRevealDay'];
    if (['status', 'revealedAtDay'].some(field => field in changed)
      && merged.status !== undefined && (merged.status === 'revealed' ? !Number.isInteger(merged.revealedAtDay) : merged.revealedAtDay != null)) return ['status', 'revealedAtDay'];
  }
  return [];
}

/** 一次写入只锁提交前的 revision；同一 ID 的多句写先合并，再验证最小一致性组和领域。 */
export function planWorldSimulationFieldCommit_ACU(input: {
  ledger: WorldSimulationLedger_ACU;
  fields: WorldSimulationLedgerFieldSnapshot_ACU;
  archive: WorldChronicleArchiveSnapshot_ACU;
  intents: readonly WorldSimulationSqlFieldIntent_ACU[];
  role: string;
  evidenceRegistry?: WorldSimulationEvidenceRegistrySnapshot_ACU;
  declaredEvidenceRefs?: readonly string[];
  settings?: WorldSimulationSettings_ACU;
  anchorMessage?: string;
  now?: number;
}): WorldSimulationFieldPlan_ACU {
  const now = input.now ?? Date.now();
  const baseRevision = input.ledger.revision;
  const pending = new Map<string, PendingWrite_ACU>();
  const rejected: WorldSimulationSqlFieldRejection_ACU[] = [];
  const declared = new Set(input.declaredEvidenceRefs ?? []);
  const writable = new Set(findWorldSimulationAgentDefinition_ACU(input.role)?.writableModules ?? []);
  const reject = (path: string, reason: string) => rejected.push({ path, reason });
  const archiveEntries: Record<string, unknown>[] = [];
  const overviewRows: Record<string, unknown>[] = [];
  const archiveIntentRefs = new Set<string>();

  for (const intent of input.intents) {
    if (intent.module === 'chronicle_archive' || intent.module === 'chronicle_overview') {
      if (!writable.has('chronicle')) { reject(intent.module, '角色无权写入归档'); continue; }
      const archiveRef = intent.fields.archiveRef;
      if (typeof archiveRef !== 'string' || !safeId_ACU(archiveRef) || archiveIntentRefs.has(`${intent.module}#${archiveRef}`)) {
        reject(`${intent.module}#${String(archiveRef)}`, '归档需明确且唯一的 archiveRef'); continue;
      }
      archiveIntentRefs.add(`${intent.module}#${archiveRef}`);
      (intent.module === 'chronicle_archive' ? archiveEntries : overviewRows).push({ ...intent.fields });
      continue;
    }
    const module = intent.module;
    if (!writable.has(module)) { reject(module, '角色无权写入模块'); continue; }
    const singleton = !ARRAY_MODULES_ACU.has(module);
    const occupied = new Set([
      ...(singleton ? [] : (input.ledger[module] as Array<{ id: string }>).map(row => row.id)),
      ...Object.keys(input.fields.records[module] ?? {}),
      ...[...pending.values()].filter(item => item.module === module).map(item => item.id),
    ]);
    const id = singleton ? WORLD_SIMULATION_SINGLETON_ID_ACU : intent.id || (intent.kind === 'insert'
      ? allocateWorldSimulationPrefixedId_ACU(module === 'chronicle' ? `chr-${input.ledger.clock.day}` : WORLD_SIMULATION_UPSERT_ID_PREFIX_ACU[module as WorldSimulationUpsertModule_ACU], occupied) : '');
    const path = `${module}#${id || '(无 ID)'}`;
    if (!singleton && !safeId_ACU(id)) { reject(path, '条目 ID 无效'); continue; }
    const key = `${module}#${id}`;
    const original = domainRow_ACU(input.ledger, module, id);
    const fieldRecord = input.fields.records[module]?.[id];
    const prior = pending.get(key);
    if (intent.kind === 'insert' && (original || fieldRecord || prior)) { reject(path, 'id_exists'); continue; }
    if (intent.kind !== 'insert' && !original && !fieldRecord && !prior) { reject(path, 'not_found'); continue; }
    if (module === 'chronicle' && intent.kind === 'update' && (original || fieldRecord?.status !== 'partial')) { reject(path, '完整编年不可 UPDATE；仅已保存的 partial 草稿可补栏'); continue; }
    if (module === 'chronicle' && intent.kind === 'update' && intent.expectedRevision !== 0) { reject(path, 'revision_conflict: 编年草稿补栏必须使用 expected_revision=0'); continue; }
    if (prior?.remove || prior?.discard) { reject(path, '同批已删除此 ID'); continue; }
    const revision = singleton ? baseRevision : typeof original?.revision === 'number' ? original.revision : 0;
    if (module !== 'chronicle' && intent.expectedRevision !== revision) {
      reject(path, `revision_conflict: expected=${intent.expectedRevision}, actual=${revision}`); continue;
    }
    if (intent.kind === 'delete') {
      if (singleton) { reject(path, '单例不能删除'); continue; }
      if (!text_ACU(intent.reason)) { reject(`${path}.reason`, '删除需要非空理由'); continue; }
      pending.set(key, { module, id, original, fields: {}, changes: {}, remove: !!original, discard: !original, reason: intent.reason });
      continue;
    }
    const entry = prior ?? { module, id, original, fields: original ? { ...original }
      : Object.fromEntries(Object.entries(fieldRecord?.fields ?? {}).map(([field, value]) => [field, value.value])), changes: {}, discard: false, remove: false };
    for (const [field, raw] of Object.entries(intent.fields)) {
      const fieldPath = `${path}.${field}`;
      if (field === 'revision' || !WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module].fields.includes(field) && !(module === 'clock' && field === 'days')) {
        reject(fieldPath, 'field_forbidden'); continue;
      }
      const normalized = validateField_ACU(module, field, raw, fieldPath, input.evidenceRegistry, declared);
      if (normalized.problem) { reject(fieldPath, normalized.problem); continue; }
      if (entry.original && same_ACU(entry.original[field], normalized.value)) {
        delete entry.changes[field];
        continue;
      }
      entry.fields[field] = normalized.value;
      entry.changes[field] = normalized.value;
    }
    if (Object.keys(entry.changes).length) pending.set(key, entry);
  }

  for (const item of pending.values()) {
    if (item.remove || item.discard) continue;
    const path = `${item.module}#${item.id}`;
    for (const field of groupProblem_ACU(item.module, item.fields, item.changes)) {
      if (!(field in item.changes)) continue;
      reject(`${path}.${field}`, 'consistency_group: 伴随栏目不完整或不一致');
      delete item.changes[field];
      if (item.original && field in item.original) item.fields[field] = item.original[field];
      else if (field in (input.fields.records[item.module]?.[item.id]?.fields ?? {})) item.fields[field] = input.fields.records[item.module]![item.id].fields[field].value;
      else delete item.fields[field];
    }
  }

  let ledger = input.ledger;
  const complete = new Set<string>();
  for (const [key, item] of pending) {
    if (item.discard || item.remove || !Object.keys(item.changes).length) continue;
    if (!item.original && !WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[item.module].required.every(field => Object.prototype.hasOwnProperty.call(item.fields, field))) continue;
    try {
      const values = item.module === 'clock' ? { ...item.changes } : item.original ? { ...item.changes } : { ...item.fields };
      ledger = applyWorldSimulationFieldDomain_ACU(ledger, item.module, item.id,
        UPSERT_MODULES_ACU.has(item.module) ? { ...values, expectedRevision: item.original?.revision ?? 0 } : values,
        item.original ? 'update' : 'insert', input.settings, input.anchorMessage, true);
      complete.add(key);
    } catch (error) { item.promotionError = errorText_ACU(error); }
  }
  for (const [key, item] of pending) {
    if (!item.remove) continue;
    try {
      ledger = applyWorldSimulationFieldDomain_ACU(ledger, item.module, item.id,
        { expectedRevision: item.original?.revision, reason: item.reason }, 'delete', input.settings, input.anchorMessage, true);
      complete.add(key);
    } catch (error) { item.promotionError = errorText_ACU(error); }
  }

  let archive = { ...input.archive, records: { ...input.archive.records } };
  let archiveWrites: WorldChronicleArchiveDetail_ACU[] = [];
  if (archiveEntries.length || overviewRows.length) {
    try {
      if (archiveEntries.length !== overviewRows.length
        || archiveEntries.some(row => !overviewRows.some(other => other.archiveRef === row.archiveRef))) {
        throw new Error('archiveEntries 与 overviewRows 必须按 archiveRef 一对一提交');
      }
      const archived = applyChronicleArchive_ACU(ledger.chronicleOverview, { archiveEntries, overviewRows, collapseRefs: [] }, ledger.clock.day);
      for (const row of archived.writes) {
        if (archive.records[row.archiveRef]) throw new Error(`archiveRef ${row.archiveRef} 已存在`);
        archive.records[row.archiveRef] = row;
      }
      archiveWrites = archived.writes;
      ledger = { ...ledger, chronicleOverview: archived.overview, revision: ledger.revision + 1 };
    } catch (error) { reject('chronicleArchive', `consistency_group: ${errorText_ACU(error)}`); }
  }

  // 批末检查跨模块关系；逐个剔除导致账本仍非法的完整写入，保留独立合法的条目。
  // 关联写入可以在同批共同满足条件，不能在逐条应用时先行宣称失败。
  const validateCandidate = (candidate: WorldSimulationLedger_ACU): string[] => {
    const problems = collectWorldSimulationLedgerViolations_ACU(candidate);
    if (problems.length) return problems;
    try { validateWorldSimulationLedger_ACU(candidate, 'agent_persist'); return []; }
    catch (error) { return [errorText_ACU(error)]; }
  };
  let problems = validateCandidate(ledger);
  if (problems.length) {
    const replay = (keys: ReadonlySet<string>, includeArchive: boolean): WorldSimulationLedger_ACU | null => {
      let candidate = input.ledger;
      try {
        for (const [key, item] of pending) {
          if (!keys.has(key)) continue;
          if (item.remove) candidate = applyWorldSimulationFieldDomain_ACU(candidate, item.module, item.id,
            { expectedRevision: item.original?.revision, reason: item.reason }, 'delete', input.settings, input.anchorMessage, true);
          else candidate = applyWorldSimulationFieldDomain_ACU(candidate, item.module, item.id,
            UPSERT_MODULES_ACU.has(item.module)
              ? { ...(item.original ? item.changes : item.fields), expectedRevision: item.original?.revision ?? 0 }
              : item.original ? item.changes : item.fields,
            item.original ? 'update' : 'insert', input.settings, input.anchorMessage, true);
        }
        if (includeArchive && archiveWrites.length) {
          const archived = applyChronicleArchive_ACU(candidate.chronicleOverview, { archiveEntries, overviewRows, collapseRefs: [] }, candidate.clock.day);
          candidate = { ...candidate, chronicleOverview: archived.overview };
        }
        return candidate;
      } catch { return null; }
    };
    // 只有删去一个完整写入后剩余组合实际通过全部领域校验，才隔离该项。
    // 多个互相依赖的失败组合无法安全定位时整组拒绝，不虚报任意 accepted。
    while (problems.length && complete.size) {
      let isolated = false;
      for (const key of [...complete].reverse()) {
        const remaining = new Set(complete);
        remaining.delete(key);
        const candidate = replay(remaining, archiveWrites.length > 0);
        if (!candidate || validateCandidate(candidate).length) continue;
        pending.get(key)!.promotionError = problems.join('；');
        complete.delete(key);
        ledger = candidate;
        isolated = true;
        break;
      }
      if (!isolated) break;
      problems = validateCandidate(ledger);
    }
    if (problems.length) {
      for (const key of complete) pending.get(key)!.promotionError = problems.join('；');
      ledger = input.ledger;
      complete.clear();
      archive = { ...input.archive, records: { ...input.archive.records } };
      archiveWrites = [];
      if (archiveEntries.length || overviewRows.length) reject('chronicleArchive', `consistency_group: ${problems.join('；')}`);
    }
  }
  ledger = { ...ledger, revision: baseRevision + Number(complete.size > 0 || archiveWrites.length > 0) };
  const batches = new Map<WorldSimulationLedgerModule_ACU, WorldSimulationSqlFieldBatch_ACU>();
  const batchFor = (module: WorldSimulationLedgerModule_ACU): WorldSimulationSqlFieldBatch_ACU => {
    let batch = batches.get(module);
    if (!batch) {
      batch = { module, expectedRevision: baseRevision, updatedAt: now, fieldWrites: {}, domainUpserts: {}, domainRemovedIds: [], discardPartialIds: [] };
      batches.set(module, batch);
    }
    return batch;
  };
  const accepted: WorldSimulationFieldAccepted_ACU[] = [];
  const partials: WorldSimulationFieldPlan_ACU['partials'] = [];
  for (const [key, item] of pending) {
    const path = `${item.module}#${item.id}`;
    if (item.discard || item.remove) {
      if (item.promotionError || item.remove && !complete.has(key)) { reject(path, item.promotionError ?? '领域删除失败'); continue; }
      if (item.discard) (batchFor(item.module).discardPartialIds as string[]).push(item.id);
      else (batchFor(item.module).domainRemovedIds as string[]).push(item.id);
      accepted.push({ module: item.module, id: item.id, field: item.discard ? 'discardPartial' : 'removed', revision: 0 });
      continue;
    }
    if (!Object.keys(item.changes).length) continue;
    if (item.original && !complete.has(key)) {
      for (const field of Object.keys(item.changes)) reject(`${path}.${field}`, item.promotionError ?? '领域验证失败');
      continue;
    }
    const batch = batchFor(item.module);
    if (complete.has(key)) batch.domainUpserts![item.id] = domainRow_ACU(ledger, item.module, item.id)!;
    const changes = { ...item.changes };
    if (item.module === 'clock' && 'days' in changes) {
      delete changes.days;
      if (ledger.clock.day !== input.ledger.clock.day) changes.day = ledger.clock.day;
    }
    if (Object.keys(changes).length) {
      const writes = (batch.fieldWrites![item.id] ??= {});
      for (const [field, value] of Object.entries(changes)) {
        writes[field] = { value };
        accepted.push({ module: item.module, id: item.id, field, revision: 0 });
      }
    }
    if (!complete.has(key)) partials.push({ module: item.module, id: item.id,
      missingFields: WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[item.module].required.filter(field => !(field in item.fields)),
      ...(item.promotionError ? { promotionError: item.promotionError } : {}) });
  }
  if (archiveWrites.length) accepted.push(...archiveWrites.map(row => ({ module: 'chronicle' as const, id: row.archiveRef, field: 'archive', revision: 0 })));
  const output = [...batches.values()].filter(batch => Object.keys(batch.fieldWrites ?? {}).length || Object.keys(batch.domainUpserts ?? {}).length
    || batch.domainRemovedIds?.length || batch.discardPartialIds?.length);
  const domainBatch = output.find(batch => Object.keys(batch.domainUpserts ?? {}).length || batch.domainRemovedIds?.length);
  for (const batch of output) batch.advanceRevision = batch === domainBatch && ledger.revision > baseRevision;
  return { ledger, batches: output, archive, archiveWrites, accepted, rejected, partials };
}
