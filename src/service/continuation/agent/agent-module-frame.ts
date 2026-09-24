/**
 * service/continuation/agent/agent-module-frame.ts — 续写资料的楼层增量帧
 *
 * 楼层字段从全量快照升级为 { checkpoint, deltas }。读取从最近基线起按楼层顺序叠加
 * 当前 swipe 的 delta；删除楼层会让该楼 delta 物理消失，折叠结果自动回到剩余链。
 * schema 1/2 全量快照只在内存里充当 swipe 0 的基线，成功写入才替换成 schema 3。
 */

import {
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
  AGENT_MODULE_FIELD_MATRIX_ACU,
  AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentModuleFloorDelta_ACU,
  type AgentWritableModule_ACU,
  type AgentModuleFloorFrame_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentPendingFix_ACU,
  type AgentModuleFieldRecord_ACU,
  type AgentModuleFieldSnapshot_ACU,
  type AgentModuleFieldUpserts_ACU,
  type AgentModuleFieldValue_ACU,
  type AgentModuleFieldWrite_ACU,
} from './agent-model';

export interface AgentModuleFrameDeps_ACU {
  validateSnapshot: (raw: unknown) => AgentModuleSnapshot_ACU | null;
  salvageSnapshot: (raw: unknown) => { snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null;
  emptySnapshot: () => AgentModuleSnapshot_ACU;
}

export interface AgentModuleFoldCandidate_ACU {
  index: number;
  valid: boolean;
  problems: string[];
}

export interface AgentModuleFoldResult_ACU {
  snapshot: AgentModuleSnapshot_ACU;
  candidates: AgentModuleFoldCandidate_ACU[];
  adoptedIndex: number | null;
  salvaged: boolean;
  checkpointIndex: number | null;
  foldedDeltaCount: number;
  /** 折叠范围内是否纳入过基线或 delta。空聊天为 false。 */
  contributed: boolean;
  /** 折叠派生的分栏视图（只读，绝不写回持久帧）。完整领域数组只来自整条 writes；partial 记录只出现在这里。 */
  fields: AgentModuleFieldSnapshot_ACU;
}

interface ParsedLegacy_ACU {
  kind: 'legacy';
  snapshot: AgentModuleSnapshot_ACU;
}

interface ParsedFrame_ACU {
  kind: 'frame';
  frame: AgentModuleFloorFrame_ACU;
  problems: string[];
}

interface ParsedBroken_ACU {
  kind: 'broken';
  problems: string[];
  salvaged: AgentModuleSnapshot_ACU | null;
}

type ParsedField_ACU = { kind: 'empty' } | ParsedLegacy_ACU | ParsedFrame_ACU | ParsedBroken_ACU;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 键序无关的 JSON 文本，用于比较栏目值是否真的变化。 */
function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
}

function isWritableModuleKey_ACU(value: string): value is AgentWritableModule_ACU {
  return (AGENT_WRITABLE_MODULES_ACU as readonly string[]).includes(value);
}

function isFieldWrite_ACU(value: unknown): value is AgentModuleFieldWrite_ACU {
  return isRecord_ACU(value) && (value.unset === true || Object.prototype.hasOwnProperty.call(value, 'value'));
}

/**
 * 解析逐栏写集（持久化 delta、基线草稿或调用方输入）。结构损坏——模块/ID/栏目层不是对象、写入值既无
 * value 也非 unset、ID 为空——返回 null，由调用方把整条记录判为不可折叠并留下诊断；未知模块或栏目名
 * 只忽略，给后续版本新增栏目留余地。
 */
export function parseAgentModuleFieldUpserts_ACU(raw: unknown): AgentModuleFieldUpserts_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const parsed: AgentModuleFieldUpserts_ACU = {};
  for (const [moduleKey, moduleUpserts] of Object.entries(raw)) {
    if (!isRecord_ACU(moduleUpserts)) return null;
    if (!isWritableModuleKey_ACU(moduleKey)) continue;
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[moduleKey];
    const kept: Record<string, Record<string, AgentModuleFieldWrite_ACU>> = {};
    for (const [rawId, writes] of Object.entries(moduleUpserts)) {
      if (!isRecord_ACU(writes)) return null;
      const id = moduleKey === 'userRequirements' ? AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU : rawId.trim();
      if (!id) return null;
      const keptFields: Record<string, AgentModuleFieldWrite_ACU> = {};
      for (const [field, write] of Object.entries(writes)) {
        if (!isFieldWrite_ACU(write)) return null;
        if (!matrix.fields.includes(field)) continue;
        keptFields[field] = write.unset === true ? { unset: true } : { value: cloneJson_ACU(write.value) };
      }
      if (Object.keys(keptFields).length) kept[id] = { ...(kept[id] ?? {}), ...keptFields };
    }
    if (Object.keys(kept).length) parsed[moduleKey] = kept;
  }
  return parsed;
}

function hasFieldUpserts_ACU(upserts: AgentModuleFieldUpserts_ACU | null | undefined): upserts is AgentModuleFieldUpserts_ACU {
  return !!upserts && Object.values(upserts).some(bucket => !!bucket && Object.keys(bucket).length > 0);
}

export function readMessageSwipeId_ACU(message: unknown): string {
  if (!isRecord_ACU(message)) return '0';
  const swipeId = message.swipe_id;
  return typeof swipeId === 'number' && Number.isInteger(swipeId) && swipeId >= 0 ? String(swipeId) : '0';
}

function isAiMessage_ACU(message: unknown): boolean {
  return isRecord_ACU(message) && message.is_user !== true;
}

function latestAiIndex_ACU(chat: readonly unknown[]): number {
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    if (isAiMessage_ACU(chat[index])) return index;
  }
  return Math.max(0, chat.length - 1);
}

function clampWaterline_ACU(value: number, targetIndex: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, Math.max(0, targetIndex));
}

function semanticPayload_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  return JSON.stringify({
    settledThroughIndex: snapshot.settledThroughIndex,
    revisions: snapshot.revisions,
    hooks: snapshot.hooks,
    infoGap: snapshot.infoGap,
    constraints: snapshot.constraints,
    storyArc: snapshot.storyArc,
    chronology: snapshot.chronology,
    webRefs: snapshot.webRefs,
    userRequirements: snapshot.userRequirements,
    materialCompletion: snapshot.materialCompletion,
    pendingFixes: snapshot.pendingFixes,
  });
}

function sameSemantic_ACU(left: AgentModuleSnapshot_ACU, right: AgentModuleSnapshot_ACU): boolean {
  return semanticPayload_ACU(left) === semanticPayload_ACU(right);
}

function emptyFrame_ACU(): AgentModuleFloorFrame_ACU {
  return { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, deltas: [] };
}

function parseDelta_ACU(raw: unknown, deps: AgentModuleFrameDeps_ACU): AgentModuleFloorDelta_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) return null;
  if (typeof raw.swipeId !== 'string' || !raw.swipeId.trim()) return null;
  if (!isRecord_ACU(raw.writes) || !isRecord_ACU(raw.revisions)) return null;
  // 逐栏写集结构损坏时整条 delta 不可折叠：静默丢掉草稿会让已提交的栏目凭空消失。
  const fieldUpserts = raw.fieldUpserts === undefined ? null : parseAgentModuleFieldUpserts_ACU(raw.fieldUpserts);
  if (raw.fieldUpserts !== undefined && !fieldUpserts) return null;
  const seed = deps.emptySnapshot();
  seed.settledThroughIndex = 0;
  const applied = applyDelta_ACU(seed, {
    seq: raw.seq,
    swipeId: raw.swipeId,
    writes: raw.writes as AgentModuleFloorDelta_ACU['writes'],
    revisions: raw.revisions as AgentModuleFloorDelta_ACU['revisions'],
    ...(isRecord_ACU(raw.removedIds) ? { removedIds: raw.removedIds as AgentModuleFloorDelta_ACU['removedIds'] } : {}),
    ...(raw.pendingFixes === undefined ? {} : { pendingFixes: raw.pendingFixes as AgentPendingFix_ACU[] }),
    ...(raw.materialCompletion === undefined ? {} : { materialCompletion: raw.materialCompletion as AgentModuleFloorDelta_ACU['materialCompletion'] }),
    ...(raw.settledThroughIndex === undefined ? {} : { settledThroughIndex: raw.settledThroughIndex as number }),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  });
  if (!deps.validateSnapshot(applied)) return null;
  const delta: AgentModuleFloorDelta_ACU = {
    seq: raw.seq,
    swipeId: raw.swipeId,
    writes: cloneJson_ACU(raw.writes) as AgentModuleFloorDelta_ACU['writes'],
    revisions: cloneJson_ACU(raw.revisions) as Partial<AgentModuleRevisions_ACU>,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  };
  if (hasFieldUpserts_ACU(fieldUpserts)) delta.fieldUpserts = fieldUpserts;
  if (isRecord_ACU(raw.removedIds)) delta.removedIds = cloneJson_ACU(raw.removedIds) as AgentModuleFloorDelta_ACU['removedIds'];
  if (Array.isArray(raw.pendingFixes)) delta.pendingFixes = cloneJson_ACU(applied.pendingFixes);
  if (isRecord_ACU(raw.materialCompletion)) delta.materialCompletion = cloneJson_ACU(applied.materialCompletion);
  if (typeof raw.settledThroughIndex === 'number' && Number.isInteger(raw.settledThroughIndex) && raw.settledThroughIndex >= 0) {
    delta.settledThroughIndex = raw.settledThroughIndex;
  }
  return delta;
}

function parseField_ACU(raw: unknown, deps: AgentModuleFrameDeps_ACU): ParsedField_ACU {
  if (raw === undefined) return { kind: 'empty' };
  if (!isRecord_ACU(raw)) return { kind: 'broken', problems: ['资料字段不是对象'], salvaged: null };
  if (raw.schemaVersion === AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU) {
    if (!Array.isArray(raw.deltas)) return { kind: 'broken', problems: ['schema 3 缺少 deltas 数组'], salvaged: null };
    const problems: string[] = [];
    const deltas: AgentModuleFloorDelta_ACU[] = [];
    raw.deltas.forEach((item, index) => {
      const delta = parseDelta_ACU(item, deps);
      if (delta) deltas.push(delta);
      else problems.push(`deltas[${index}] 无法折叠，已跳过`);
    });
    deltas.sort((left, right) => left.seq - right.seq);
    const frame: AgentModuleFloorFrame_ACU = { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, deltas };
    if (isRecord_ACU(raw.checkpoint)) {
      const snapshot = deps.validateSnapshot(raw.checkpoint.snapshot);
      const swipeId = typeof raw.checkpoint.swipeId === 'string' && raw.checkpoint.swipeId.trim() ? raw.checkpoint.swipeId : '';
      if (snapshot && swipeId) {
        frame.checkpoint = { swipeId, snapshot };
        if (raw.checkpoint.partials !== undefined) {
          const partials = parseAgentModuleFieldUpserts_ACU(raw.checkpoint.partials);
          if (!partials) problems.push('checkpoint.partials 结构非法，基线草稿栏目已忽略');
          else if (hasFieldUpserts_ACU(partials)) frame.checkpoint.partials = partials;
        }
      } else problems.push('checkpoint 未通过严格校验，已忽略');
    }
    return { kind: 'frame', frame, problems };
  }
  const legacy = deps.validateSnapshot(raw);
  if (legacy) return { kind: 'legacy', snapshot: legacy };
  const salvaged = deps.salvageSnapshot(raw);
  return {
    kind: 'broken',
    problems: salvaged?.problems ?? ['快照不是可折叠的资料帧'],
    salvaged: salvaged?.snapshot ?? null,
  };
}

function entryId_ACU(item: unknown): string {
  if (!isRecord_ACU(item) || typeof item.id !== 'string') return '';
  return item.id;
}

function applyModuleWrite_ACU(current: readonly unknown[], upserts: readonly unknown[] | undefined, removed: readonly string[] | undefined, replaceAll: boolean): unknown[] {
  if (replaceAll) return cloneJson_ACU([...(upserts ?? [])]);
  const removedIds = new Set(removed ?? []);
  const replacements = new Map<string, unknown>();
  for (const item of upserts ?? []) {
    const id = entryId_ACU(item);
    if (id) replacements.set(id, item);
  }
  const next: unknown[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const id = entryId_ACU(item);
    if (!id || removedIds.has(id)) continue;
    if (replacements.has(id)) {
      next.push(cloneJson_ACU(replacements.get(id)));
      seen.add(id);
    } else next.push(cloneJson_ACU(item));
  }
  for (const [id, item] of replacements) {
    if (!seen.has(id) && !removedIds.has(id)) next.push(cloneJson_ACU(item));
  }
  return next;
}

function applyDelta_ACU(snapshot: AgentModuleSnapshot_ACU, delta: AgentModuleFloorDelta_ACU): AgentModuleSnapshot_ACU {
  const next = cloneJson_ACU(snapshot);
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    if (!Object.prototype.hasOwnProperty.call(delta.writes, key) && !delta.removedIds?.[key as Exclude<AgentWritableModule_ACU, 'userRequirements'>]) continue;
    const replaceAll = key === 'userRequirements';
    const moduleKey = key as Exclude<AgentWritableModule_ACU, 'userRequirements'>;
    (next as unknown as Record<string, unknown>)[key] = applyModuleWrite_ACU(
      next[key] as unknown[],
      delta.writes[key] as unknown[] | undefined,
      replaceAll ? undefined : delta.removedIds?.[moduleKey],
      replaceAll,
    );
  }
  next.revisions = { ...next.revisions, ...delta.revisions };
  if (delta.pendingFixes) next.pendingFixes = cloneJson_ACU(delta.pendingFixes);
  if (delta.materialCompletion) next.materialCompletion = cloneJson_ACU(delta.materialCompletion);
  if (typeof delta.settledThroughIndex === 'number') next.settledThroughIndex = delta.settledThroughIndex;
  next.updatedAt = delta.updatedAt;
  return next;
}

function diffSnapshot_ACU(before: AgentModuleSnapshot_ACU, after: AgentModuleSnapshot_ACU, swipeId: string, seq: number): AgentModuleFloorDelta_ACU | null {
  const writes: AgentModuleFloorDelta_ACU['writes'] = {};
  const removedIds: NonNullable<AgentModuleFloorDelta_ACU['removedIds']> = {};
  const revisions: Partial<AgentModuleRevisions_ACU> = {};
  let changed = false;
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    if (key === 'userRequirements') {
      if (JSON.stringify(before.userRequirements) !== JSON.stringify(after.userRequirements)) {
        writes.userRequirements = cloneJson_ACU(after.userRequirements);
        changed = true;
      }
    } else {
      const previous = before[key] as unknown as Array<Record<string, unknown>>;
      const nextItems = after[key] as unknown as Array<Record<string, unknown>>;
      const previousById = new Map(previous.map(item => [entryId_ACU(item), item]));
      const nextIds = new Set(nextItems.map(item => entryId_ACU(item)));
      const upserts = nextItems.filter(item => {
        const id = entryId_ACU(item);
        const prior = previousById.get(id);
        return !prior || JSON.stringify(prior) !== JSON.stringify(item);
      });
      const removed = previous.map(item => entryId_ACU(item)).filter(id => id && !nextIds.has(id));
      if (upserts.length) {
        (writes as Record<string, unknown>)[key] = cloneJson_ACU(upserts);
        changed = true;
      }
      if (removed.length) {
        removedIds[key] = removed;
        changed = true;
      }
    }
    if (before.revisions[key] !== after.revisions[key]) {
      revisions[key] = after.revisions[key];
      changed = true;
    }
  }
  const delta: AgentModuleFloorDelta_ACU = { seq, swipeId, writes, revisions, updatedAt: after.updatedAt };
  if (Object.keys(removedIds).length) delta.removedIds = removedIds;
  if (JSON.stringify(before.pendingFixes) !== JSON.stringify(after.pendingFixes)) {
    delta.pendingFixes = cloneJson_ACU(after.pendingFixes);
    changed = true;
  }
  if (JSON.stringify(before.materialCompletion) !== JSON.stringify(after.materialCompletion)) {
    delta.materialCompletion = cloneJson_ACU(after.materialCompletion);
    changed = true;
  }
  if (before.settledThroughIndex !== after.settledThroughIndex) {
    delta.settledThroughIndex = after.settledThroughIndex;
    changed = true;
  }
  return changed ? delta : null;
}

function emptyFieldView_ACU(): AgentModuleFieldSnapshot_ACU {
  return { records: {} };
}

/** 基线时刻的领域条目：栏目 revision 从 0 起算，来源不可逐栏拆分，记为 legacy_unknown。 */
function seedFieldViewFromSnapshot_ACU(snapshot: AgentModuleSnapshot_ACU, updatedAt: number): AgentModuleFieldSnapshot_ACU {
  const view = emptyFieldView_ACU();
  reconcileFieldViewWithSnapshot_ACU(view, snapshot, updatedAt, true);
  return view;
}

/** 领域条目按 ID 取出：userRequirements 是整表单例，固定 ID、唯一栏目 value。 */
function domainEntriesOf_ACU(snapshot: AgentModuleSnapshot_ACU, module: AgentWritableModule_ACU): Map<string, Record<string, unknown>> {
  const entries = new Map<string, Record<string, unknown>>();
  if (module === 'userRequirements') {
    entries.set(AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU, { value: snapshot.userRequirements });
    return entries;
  }
  for (const item of snapshot[module] as unknown as unknown[]) {
    if (!isRecord_ACU(item)) continue;
    const id = entryId_ACU(item);
    if (id) entries.set(id, item);
  }
  return entries;
}

/** 从领域条目重建栏目：值未变的栏目沿用原 revision，变化或新出现的栏目 revision +1（基线为 0）。 */
function domainRecordFields_ACU(
  module: AgentWritableModule_ACU,
  item: Record<string, unknown>,
  previous: AgentModuleFieldRecord_ACU | undefined,
  updatedAt: number,
  baseline: boolean,
): { fields: Record<string, AgentModuleFieldValue_ACU>; changed: boolean } {
  const fields: Record<string, AgentModuleFieldValue_ACU> = {};
  let changed = !previous;
  for (const key of AGENT_MODULE_FIELD_MATRIX_ACU[module].fields) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
    // 归一化校验可能给可选栏留下显式 undefined（如 storyArc 的 narrativeRole）：JSON 语义下它就是缺席，
    // 跳过而不是拿 undefined 去 clone——否则任何带旧整条快照的楼层一折叠就抛 "undefined" is not valid JSON。
    if (item[key] === undefined) continue;
    const value = cloneJson_ACU(item[key]);
    const prior = previous?.fields[key];
    if (prior && canonicalJson_ACU(prior.value) === canonicalJson_ACU(value)) {
      fields[key] = { value, revision: prior.revision, updatedAt: prior.updatedAt };
      continue;
    }
    fields[key] = { value, revision: baseline ? 0 : (prior?.revision ?? 0) + 1, updatedAt };
    changed = true;
  }
  if (previous && Object.keys(previous.fields).some(key => !Object.prototype.hasOwnProperty.call(fields, key))) changed = true;
  return { fields, changed };
}

/** 视图里的 partial 草稿栏目，按逐栏写集形态导出（只含值写入）。基线重建时随基线保存。 */
export function extractAgentModulePartialFields_ACU(view: AgentModuleFieldSnapshot_ACU): AgentModuleFieldUpserts_ACU {
  const partials: AgentModuleFieldUpserts_ACU = {};
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const bucket = view.records[key];
    if (!bucket) continue;
    const kept: Record<string, Record<string, AgentModuleFieldWrite_ACU>> = {};
    for (const [id, record] of Object.entries(bucket)) {
      if (record.status !== 'partial' || !Object.keys(record.fields).length) continue;
      kept[id] = Object.fromEntries(Object.entries(record.fields).map(([field, entry]) => [field, { value: cloneJson_ACU(entry.value) }]));
    }
    if (Object.keys(kept).length) partials[key] = kept;
  }
  return partials;
}

/**
 * 每条 delta 后的按 ID 对账。领域数组是完整条目的唯一来源：在领域里的 ID 按领域值重建栏目，
 * 此前经逐栏写入（partial/complete）的记为 complete，其余记为 legacy_unknown；不在领域里的记录
 * 只保留仍有栏目的 partial 草稿——被整条删除的完整条目随之消失，草稿不会冒充完整条目。
 * 不能用整桶重建——那会抹掉 partial。
 */
function reconcileFieldViewWithSnapshot_ACU(
  view: AgentModuleFieldSnapshot_ACU,
  snapshot: AgentModuleSnapshot_ACU,
  updatedAt: number,
  baseline = false,
): void {
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const bucket = (view.records[key] ??= {});
    const domain = domainEntriesOf_ACU(snapshot, key);
    for (const [id, item] of domain) {
      const previous = bucket[id];
      const lineage = previous?.status === 'partial' || previous?.status === 'complete';
      const rebuilt = domainRecordFields_ACU(key, item, previous, updatedAt, baseline);
      bucket[id] = {
        module: key,
        id,
        status: lineage ? 'complete' : 'legacy_unknown',
        fields: rebuilt.fields,
        missingFields: [],
        updatedAt: rebuilt.changed || !previous ? updatedAt : previous.updatedAt,
      };
    }
    for (const id of Object.keys(bucket)) {
      if (domain.has(id)) continue;
      const record = bucket[id];
      if (record.status !== 'partial' || !Object.keys(record.fields).length) delete bucket[id];
    }
  }
}

/** 草稿记录不在领域数组中，恒为 partial；缺栏按模型必填栏计算。 */
function recomputePartialRecord_ACU(record: AgentModuleFieldRecord_ACU): void {
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[record.module];
  record.missingFields = matrix.required.filter(key => !Object.prototype.hasOwnProperty.call(record.fields, key));
  record.status = 'partial';
}

/**
 * 把逐栏写集叠到视图上。被写到的记录先一律按草稿重算，随后的领域对账再把在领域里的 ID
 * 改回完整状态；值未变的重复写入不推进栏目 revision。
 */
function applyFieldUpsertsToView_ACU(
  view: AgentModuleFieldSnapshot_ACU,
  upserts: AgentModuleFieldUpserts_ACU,
  updatedAt: number,
): AgentModuleFieldSnapshot_ACU {
  const next: AgentModuleFieldSnapshot_ACU = { records: {} };
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const bucket = view.records[key];
    if (bucket) next.records[key] = cloneJson_ACU(bucket) as Record<string, AgentModuleFieldRecord_ACU>;
  }
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const moduleUpserts = upserts[key];
    if (!moduleUpserts) continue;
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[key];
    const bucket = (next.records[key] ??= {});
    for (const [id, fieldWrites] of Object.entries(moduleUpserts)) {
      const stableId = key === 'userRequirements' ? AGENT_USER_REQUIREMENTS_SINGLETON_ID_ACU : String(id ?? '').trim();
      if (!stableId || !isRecord_ACU(fieldWrites)) continue;
      const record = (bucket[stableId] ??= { module: key, id: stableId, status: 'partial', fields: {}, missingFields: [], updatedAt: 0 });
      for (const [field, write] of Object.entries(fieldWrites as Record<string, AgentModuleFieldWrite_ACU>)) {
        if (!matrix.fields.includes(field) || !isFieldWrite_ACU(write)) continue;
        if (write.unset === true) {
          delete record.fields[field];
          continue;
        }
        const previous = record.fields[field];
        const value = cloneJson_ACU(write.value);
        if (previous && canonicalJson_ACU(previous.value) === canonicalJson_ACU(value)) continue;
        record.fields[field] = { value, revision: (previous?.revision ?? 0) + 1, updatedAt };
      }
      record.updatedAt = updatedAt;
      recomputePartialRecord_ACU(record);
    }
  }
  return next;
}

function fieldOf_ACU(message: unknown): unknown {
  if (!isRecord_ACU(message) || !Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) return undefined;
  return message[AGENT_MODULE_FIELD_ACU];
}

function maxSeq_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): number {
  let max = 0;
  for (const message of chat) {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame') continue;
    for (const delta of parsed.frame.deltas) max = Math.max(max, delta.seq);
  }
  return max;
}

function hasSchema3Checkpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): boolean {
  return chat.some(message => {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    return parsed.kind === 'frame' && parsed.frame.checkpoint?.swipeId === readMessageSwipeId_ACU(message);
  });
}

/**
 * 从聊天头部折叠到 throughIndex（含）。不按数组长度钳制水位。
 */
export function foldAgentModuleSnapshot_ACU(
  chat: readonly unknown[],
  deps: AgentModuleFrameDeps_ACU,
  throughIndex = chat.length - 1,
): AgentModuleFoldResult_ACU {
  let snapshot = deps.emptySnapshot();
  let contributed = false;
  let sawSchema3Checkpoint = false;
  let checkpointIndex: number | null = null;
  let foldedDeltaCount = 0;
  let adoptedIndex: number | null = null;
  const candidates: AgentModuleFoldCandidate_ACU[] = [];
  let salvage: { index: number; snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null = null;
  const end = Math.min(throughIndex, chat.length - 1);
  let view = emptyFieldView_ACU();

  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    const raw = fieldOf_ACU(message);
    if (raw === undefined) continue;
    const parsed = parseField_ACU(raw, deps);
    const swipeId = readMessageSwipeId_ACU(message);
    if (parsed.kind === 'legacy') {
      candidates.push({ index, valid: true, problems: [] });
      if (!sawSchema3Checkpoint && swipeId === '0') {
        snapshot = cloneJson_ACU(parsed.snapshot);
        view = seedFieldViewFromSnapshot_ACU(snapshot, parsed.snapshot.updatedAt);
        contributed = true;
        checkpointIndex = index;
        adoptedIndex = index;
        foldedDeltaCount = 0;
      }
      continue;
    }
    if (parsed.kind === 'broken') {
      candidates.push({ index, valid: false, problems: parsed.problems });
      if (parsed.salvaged) salvage = { index, snapshot: parsed.salvaged, problems: parsed.problems };
      continue;
    }
    if (parsed.kind !== 'frame') continue;
    candidates.push({ index, valid: parsed.problems.length === 0, problems: parsed.problems });
    if (parsed.frame.checkpoint && parsed.frame.checkpoint.swipeId === swipeId) {
      snapshot = cloneJson_ACU(parsed.frame.checkpoint.snapshot);
      view = seedFieldViewFromSnapshot_ACU(snapshot, parsed.frame.checkpoint.snapshot.updatedAt);
      if (parsed.frame.checkpoint.partials) {
        view = applyFieldUpsertsToView_ACU(view, parsed.frame.checkpoint.partials, parsed.frame.checkpoint.snapshot.updatedAt);
        reconcileFieldViewWithSnapshot_ACU(view, snapshot, parsed.frame.checkpoint.snapshot.updatedAt);
      }
      contributed = true;
      sawSchema3Checkpoint = true;
      checkpointIndex = index;
      adoptedIndex = index;
      foldedDeltaCount = 0;
    }
    for (const delta of parsed.frame.deltas) {
      if (delta.swipeId !== swipeId) continue;
      snapshot = applyDelta_ACU(snapshot, delta);
      if (delta.fieldUpserts) view = applyFieldUpsertsToView_ACU(view, delta.fieldUpserts, delta.updatedAt);
      reconcileFieldViewWithSnapshot_ACU(view, snapshot, delta.updatedAt);
      contributed = true;
      foldedDeltaCount += 1;
      if (adoptedIndex === null) adoptedIndex = index;
    }
  }

  if (!contributed && salvage) {
    return {
      snapshot: cloneJson_ACU(salvage.snapshot),
      fields: seedFieldViewFromSnapshot_ACU(salvage.snapshot, salvage.snapshot.updatedAt),
      candidates,
      adoptedIndex: salvage.index,
      salvaged: true,
      checkpointIndex: salvage.index,
      foldedDeltaCount: 0,
      contributed: true,
    };
  }
  return {
    snapshot,
    candidates,
    fields: view,
    adoptedIndex: contributed ? adoptedIndex : null,
    salvaged: false,
    checkpointIndex: contributed ? checkpointIndex : null,
    foldedDeltaCount,
    contributed,
  };
}

function readFrame_ACU(message: unknown, deps: AgentModuleFrameDeps_ACU): AgentModuleFloorFrame_ACU {
  const parsed = parseField_ACU(fieldOf_ACU(message), deps);
  if (parsed.kind === 'frame') return cloneJson_ACU(parsed.frame);
  return emptyFrame_ACU();
}

function writeFrame_ACU(message: Record<string, unknown>, frame: AgentModuleFloorFrame_ACU): void {
  const next: AgentModuleFloorFrame_ACU = {
    schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
    deltas: frame.deltas,
  };
  if (frame.checkpoint) next.checkpoint = frame.checkpoint;
  message[AGENT_MODULE_FIELD_ACU] = next;
}

function stripCurrentSwipeThrough_ACU(chat: unknown[], anchorIndex: number, deps: AgentModuleFrameDeps_ACU): void {
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!isRecord_ACU(message)) continue;
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame') continue;
    const swipeId = readMessageSwipeId_ACU(message);
    const frame = cloneJson_ACU(parsed.frame);
    delete frame.checkpoint;
    if (index <= anchorIndex) frame.deltas = frame.deltas.filter(delta => delta.swipeId !== swipeId);
    if (!frame.checkpoint && frame.deltas.length === 0) delete message[AGENT_MODULE_FIELD_ACU];
    else writeFrame_ACU(message, frame);
  }
}

/**
 * 把 throughIndex 及之前的当前 swipe 链折成锚点楼上的唯一 schema 3 基线。
 * 锚点之后的 delta 保留。没有可折叠内容时不写空基线。
 */
export function relocateContinuationCheckpoint_ACU(
  chat: unknown[],
  anchorIndex: number,
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= chat.length) return false;
  const anchor = chat[anchorIndex];
  if (!isAiMessage_ACU(anchor)) return false;
  const folded = foldAgentModuleSnapshot_ACU(chat, deps, anchorIndex);
  if (!folded.contributed || folded.salvaged) return false;
  const before = JSON.stringify(chat.map(message => fieldOf_ACU(message)));
  stripCurrentSwipeThrough_ACU(chat, anchorIndex, deps);
  const frame = readFrame_ACU(anchor, deps);
  frame.checkpoint = buildCheckpoint_ACU(readMessageSwipeId_ACU(anchor), folded.snapshot, extractAgentModulePartialFields_ACU(folded.fields));
  writeFrame_ACU(anchor as Record<string, unknown>, frame);
  const after = JSON.stringify(chat.map(message => fieldOf_ACU(message)));
  return before !== after;
}

export type AgentModuleCheckpoint_ACU = NonNullable<AgentModuleFloorFrame_ACU['checkpoint']>;

function buildCheckpoint_ACU(swipeId: string, snapshot: AgentModuleSnapshot_ACU, partials: AgentModuleFieldUpserts_ACU): AgentModuleCheckpoint_ACU {
  const checkpoint: AgentModuleCheckpoint_ACU = { swipeId, snapshot: cloneJson_ACU(snapshot) };
  if (hasFieldUpserts_ACU(partials)) checkpoint.partials = cloneJson_ACU(partials);
  return checkpoint;
}

function appendDelta_ACU(chat: unknown[], targetIndex: number, delta: AgentModuleFloorDelta_ACU, deps: AgentModuleFrameDeps_ACU): void {
  const message = chat[targetIndex];
  if (!isRecord_ACU(message)) return;
  const frame = readFrame_ACU(message, deps);
  frame.deltas = [...frame.deltas, delta].sort((left, right) => left.seq - right.seq);
  writeFrame_ACU(message, frame);
}

export interface AgentModuleWritePlan_ACU {
  changed: boolean;
  assignments: Array<{ index: number; existed: boolean; previous: unknown; value: unknown }>;
}

/**
 * 规划一次快照写入：已有 schema 3 基线时只追加 delta；否则把首基线放到表格 checkpoint 楼或最新 AI 楼。
 * fieldUpserts 与领域变化写进同一条 delta（逐栏提交的唯一持久化形态）；安装首基线时，基线同时携带
 * 该时刻的 partial 草稿，避免被基线覆盖的楼层 delta 带走草稿栏目。不修改传入的 chat。
 */
export function planAgentModuleSnapshotWrite_ACU(
  chat: unknown[],
  targetIndex: number,
  next: AgentModuleSnapshot_ACU,
  deps: AgentModuleFrameDeps_ACU,
  tableAnchorIndex: number | null,
  fieldUpserts?: AgentModuleFieldUpserts_ACU,
): AgentModuleWritePlan_ACU {
  const scratch = chat.map(message => (isRecord_ACU(message) ? { ...message } : message));
  const before = foldAgentModuleSnapshot_ACU(scratch, deps);
  const clamped: AgentModuleSnapshot_ACU = {
    ...cloneJson_ACU(next),
    settledThroughIndex: clampWaterline_ACU(next.settledThroughIndex, targetIndex),
    updatedAt: Date.now(),
  };
  const fieldWrites = fieldUpserts ? parseAgentModuleFieldUpserts_ACU(fieldUpserts) : null;
  const hasFieldWrites = hasFieldUpserts_ACU(fieldWrites);
  if (!hasFieldWrites && before.contributed && !before.salvaged && sameSemantic_ACU(before.snapshot, clamped)) {
    return { changed: false, assignments: [] };
  }
  const base = before.contributed ? before.snapshot : deps.emptySnapshot();
  const seq = maxSeq_ACU(scratch, deps) + 1;
  const swipeId = readMessageSwipeId_ACU(scratch[targetIndex]);
  let delta = diffSnapshot_ACU(base, clamped, swipeId, seq);
  if (hasFieldWrites) {
    delta ??= { seq, swipeId, writes: {}, revisions: {}, updatedAt: clamped.updatedAt };
    delta.fieldUpserts = fieldWrites;
  }
  const hadSchema3 = hasSchema3Checkpoint_ACU(scratch, deps);
  if (hadSchema3) {
    if (delta) appendDelta_ACU(scratch, targetIndex, delta, deps);
  } else {
    const tableAnchor = tableAnchorIndex !== null && isAiMessage_ACU(scratch[tableAnchorIndex]) ? tableAnchorIndex : null;
    const anchor = tableAnchor ?? latestAiIndex_ACU(scratch);
    const anchorMessage = scratch[anchor];
    if (isRecord_ACU(anchorMessage)) {
      const checkpointAfterWrite = targetIndex <= anchor || !delta;
      const checkpointSnapshot = checkpointAfterWrite ? clamped : base;
      let partials = extractAgentModulePartialFields_ACU(before.fields);
      if (checkpointAfterWrite && hasFieldWrites) {
        const afterView = applyFieldUpsertsToView_ACU(before.fields, fieldWrites, clamped.updatedAt);
        reconcileFieldViewWithSnapshot_ACU(afterView, clamped, clamped.updatedAt);
        partials = extractAgentModulePartialFields_ACU(afterView);
      }
      if (deps.validateSnapshot(checkpointSnapshot)) {
        const frame = readFrame_ACU(anchorMessage, deps);
        frame.checkpoint = buildCheckpoint_ACU(readMessageSwipeId_ACU(anchorMessage), checkpointSnapshot, partials);
        if (anchor === targetIndex) frame.deltas = frame.deltas.filter(item => item.swipeId !== frame.checkpoint?.swipeId);
        writeFrame_ACU(anchorMessage, frame);
      }
    }
    if (delta && targetIndex > anchor) appendDelta_ACU(scratch, targetIndex, delta, deps);
  }
  const assignments: AgentModuleWritePlan_ACU['assignments'] = [];
  scratch.forEach((message, index) => {
    const previous = fieldOf_ACU(chat[index]);
    const value = fieldOf_ACU(message);
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    assignments.push({
      index,
      existed: previous !== undefined,
      previous,
      value,
    });
  });
  return { changed: assignments.length > 0, assignments };
}

/** 将已校验的领域行与栏目变更放进同一条宿主楼层 delta，不从 SQL 视图读取权威状态。 */
export function planAgentModuleCommitDelta_ACU(
  chat: unknown[],
  targetIndex: number,
  changes: Pick<AgentModuleFloorDelta_ACU, 'writes' | 'revisions' | 'fieldUpserts' | 'removedIds'>,
  deps: AgentModuleFrameDeps_ACU,
  _tableAnchorIndex: number | null,
  updatedAt: number,
): AgentModuleWritePlan_ACU {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= chat.length || !isAiMessage_ACU(chat[targetIndex])) {
    return { changed: false, assignments: [] };
  }
  const scratch = chat.map(message => (isRecord_ACU(message) ? { ...message } : message));
  const before = foldAgentModuleSnapshot_ACU(scratch, deps);
  if (before.salvaged || before.candidates.some(item => !item.valid)) return { changed: false, assignments: [] };
  const delta: AgentModuleFloorDelta_ACU = {
    seq: maxSeq_ACU(scratch, deps) + 1,
    swipeId: readMessageSwipeId_ACU(scratch[targetIndex]),
    writes: cloneJson_ACU(changes.writes),
    revisions: cloneJson_ACU(changes.revisions),
    updatedAt,
  };
  if (changes.removedIds) delta.removedIds = cloneJson_ACU(changes.removedIds);
  if (changes.fieldUpserts) delta.fieldUpserts = cloneJson_ACU(changes.fieldUpserts);
  if (!hasSchema3Checkpoint_ACU(scratch.slice(0, targetIndex + 1), deps)) {
    // 把旧全量帧转换为当前目标楼基线；旧楼层若在表格锚点之后，提前安放基线会被旧帧覆盖。
    const message = scratch[targetIndex];
    if (!isRecord_ACU(message)) return { changed: false, assignments: [] };
    const frame = readFrame_ACU(message, deps);
    if (frame.checkpoint && frame.checkpoint.swipeId !== readMessageSwipeId_ACU(message)) {
      // 同一楼层只能容纳一个 checkpoint，切换 swipe 不可覆盖旧 swipe 的基线。
      return { changed: false, assignments: [] };
    }
    const snapshot = cloneJson_ACU(before.snapshot);
    if (snapshot.settledThroughIndex < 0) snapshot.settledThroughIndex = 0;
    if (!deps.validateSnapshot(snapshot)) return { changed: false, assignments: [] };
    frame.checkpoint = buildCheckpoint_ACU(readMessageSwipeId_ACU(message), snapshot, extractAgentModulePartialFields_ACU(before.fields));
    // 旧 schema 3 草稿 delta 已折入基线，不得在基线之上再执行一遍。
    frame.deltas = frame.deltas.filter(item => item.swipeId !== frame.checkpoint?.swipeId);
    writeFrame_ACU(message, frame);
  }
  appendDelta_ACU(scratch, targetIndex, delta, deps);
  const assignments: AgentModuleWritePlan_ACU['assignments'] = [];
  scratch.forEach((message, index) => {
    const previous = fieldOf_ACU(chat[index]);
    const value = fieldOf_ACU(message);
    if (JSON.stringify(previous) !== JSON.stringify(value)) {
      assignments.push({ index, existed: previous !== undefined, previous, value });
    }
  });
  return { changed: assignments.length > 0, assignments };
}

/**
 * 规划一次逐栏写入：只把 fieldUpserts 作为一条 delta 追加到目标楼层，
 * 不产生 checkpoint、不触碰领域数组；缺栏记录经折叠只进入受控分栏视图。
 * 不修改传入的 chat。无有效栏目时返回 changed=false。
 */
export function planAgentModuleFieldWrite_ACU(
  chat: unknown[],
  targetIndex: number,
  fieldUpserts: AgentModuleFieldUpserts_ACU,
  deps: AgentModuleFrameDeps_ACU,
): AgentModuleWritePlan_ACU {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= chat.length) {
    return { changed: false, assignments: [] };
  }
  const cleaned = parseAgentModuleFieldUpserts_ACU(fieldUpserts);
  if (!hasFieldUpserts_ACU(cleaned)) return { changed: false, assignments: [] };
  const scratch = chat.map(message => (isRecord_ACU(message) ? { ...message } : message));
  const delta: AgentModuleFloorDelta_ACU = {
    seq: maxSeq_ACU(scratch, deps) + 1,
    swipeId: readMessageSwipeId_ACU(scratch[targetIndex]),
    writes: {},
    fieldUpserts: cleaned,
    revisions: {},
    updatedAt: Date.now(),
  };
  appendDelta_ACU(scratch, targetIndex, delta, deps);
  const assignments: AgentModuleWritePlan_ACU['assignments'] = [];
  scratch.forEach((message, index) => {
    const previous = fieldOf_ACU(chat[index]);
    const value = fieldOf_ACU(message);
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    assignments.push({ index, existed: previous !== undefined, previous, value });
  });
  return { changed: assignments.length > 0, assignments };
}


/** 取出楼层上的基线（含 partial 草稿），供删楼守卫在基线楼被删除时嫁接。 */
export function continuationCheckpointArtifact_ACU(
  message: unknown,
  deps: AgentModuleFrameDeps_ACU,
): AgentModuleCheckpoint_ACU | null {
  const parsed = parseField_ACU(fieldOf_ACU(message), deps);
  if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) return null;
  return cloneJson_ACU(parsed.frame.checkpoint);
}

/** 把丢失的基线嫁到目标楼。目标楼同一 swipe 已有基线时不覆盖。 */
export function graftContinuationCheckpoint_ACU(
  message: unknown,
  artifact: AgentModuleCheckpoint_ACU,
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!isRecord_ACU(message)) return false;
  const frame = readFrame_ACU(message, deps);
  if (frame.checkpoint && frame.checkpoint.swipeId === artifact.swipeId) return false;
  if (frame.checkpoint) return false;
  frame.checkpoint = cloneJson_ACU(artifact);
  writeFrame_ACU(message, frame);
  return true;
}

/** 每个当前 swipe 至多一个 schema 3 基线。legacy 全量不计入。 */
export function assertSingleActiveContinuationCheckpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): string | null {
  const seen = new Map<string, number>();
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) continue;
    if (parsed.frame.checkpoint.swipeId !== readMessageSwipeId_ACU(message)) continue;
    const swipeId = parsed.frame.checkpoint.swipeId;
    const previous = seen.get(swipeId);
    if (previous !== undefined) return `续写资料 swipe ${swipeId} 存在多个活跃基线：楼层 ${previous} 与 ${index}`;
    seen.set(swipeId, index);
  }
  return null;
}

export function chatHasContinuationMaterial_ACU(chat: readonly unknown[]): boolean {
  return chat.some(message => fieldOf_ACU(message) !== undefined);
}
