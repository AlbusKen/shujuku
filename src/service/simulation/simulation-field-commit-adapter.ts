/** 世界推演逐栏生产提交：SQL 与帧仅作预演，楼层私有字段是保存权威。 */
import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU, WORLD_SIMULATION_STATE_FIELD_ACU,
  type WorldChronicleArchiveSnapshot_ACU, type WorldSimulationAnchorIdentity_ACU } from './agent/agent-model';
import { parseWorldSimulationSqlFieldWrites_ACU, type WorldSimulationSqlFieldRejection_ACU } from './agent/agent-protocol';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU,
  type WorldSimulationLedgerFieldUpserts_ACU, type WorldSimulationRunIdentity_ACU } from './model';
import { planWorldSimulationFieldCommit_ACU, type WorldSimulationFieldAccepted_ACU,
  type WorldSimulationFieldPlan_ACU } from './simulation-field-commit';
import { appendWorldSimulationCommitChain_ACU, appendWorldSimulationFieldDeltaChain_ACU,
  extractWorldSimulationPartialFields_ACU, foldWorldSimulationArchive_ACU,
  foldWorldSimulationLedger_ACU, type WorldSimulationLedgerFold_ACU } from './simulation-ledger-fold';
import { materializeWorldSimulationLedgerSqlView_ACU } from './simulation-ledger-sql-view';
import { readWorldSimulationRunWriteProof_ACU, stageWorldSimulationRunWriteProof_ACU,
  type WorldSimulationRunWriteProof_ACU, type WorldSimulationRunWriteView_ACU } from './simulation-run-write-state';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, resolveCurrentWorldSimulationAnchor_ACU, resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationEnvelope_ACU } from './simulation-store';
import type { WorldSimulationEvidenceRegistrySnapshot_ACU } from './world-simulation-evidence-registry';

export interface WorldSimulationFieldCommitInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  role: string;
  sql: string;
  evidenceRegistry: WorldSimulationEvidenceRegistrySnapshot_ACU;
  declaredEvidenceRefs?: readonly string[];
  allowedModules?: readonly import('./model').WorldSimulationLedgerModule_ACU[];
  updatedAt?: number;
  isCurrent?: () => boolean;
  assertRunLedger?: (view: WorldSimulationRunWriteView_ACU) => void;
  prepareRunProof?: (view: WorldSimulationRunWriteView_ACU, evidenceRefs: readonly string[], accepted: readonly WorldSimulationFieldAccepted_ACU[]) => WorldSimulationRunWriteProof_ACU;
  confirmRunLedger?: (view: WorldSimulationRunWriteView_ACU, evidenceRefs: readonly string[], accepted: readonly WorldSimulationFieldAccepted_ACU[]) => void;
}

export interface WorldSimulationFieldCommitReceipt_ACU {
  status: 'committed' | 'rejected' | 'persist_failed' | 'readback_failed';
  accepted: WorldSimulationFieldAccepted_ACU[];
  rejected: WorldSimulationSqlFieldRejection_ACU[];
  /** null 表示保存/补偿后的当前状态无法确认；必须重新读取权威帧。 */
  partials: WorldSimulationFieldPlan_ACU['partials'] | null;
  ledgerRevision: number | null;
  sqlDiagnostics?: string;
  recovery?: 'saved' | 'failed' | 'unavailable';
}

type Floor_ACU = Record<string, unknown>;
type Change_ACU = { target: Floor_ACU; key: string; existed: boolean; previous: unknown; staged: unknown; expected: string };
const isRecord_ACU = (value: unknown): value is Floor_ACU => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorText_ACU = (error: unknown): string => error instanceof Error ? error.message : String(error);
function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Floor_ACU;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const equal_ACU = (left: unknown, right: unknown): boolean => canonical_ACU(left) === canonical_ACU(right);

/** 基线重建仅携带 partial 的栏目值，不携带原 updatedAt；时间戳不作为可复算权威。 */
function comparableFieldRecord_ACU(record: { status: string; fields: Record<string, { value: unknown; revision: number }> } | null): unknown {
  if (!record) return null;
  return { status: record.status, fields: Object.fromEntries(Object.entries(record.fields).map(([key, field]) =>
    [key, { value: field.value, revision: field.revision }])) };
}

function confirmedPartials_ACU(fields: WorldSimulationLedgerFold_ACU['fields'] | undefined,
  planned: WorldSimulationFieldPlan_ACU['partials'] = []): WorldSimulationFieldPlan_ACU['partials'] {
  const problems = new Map(planned.filter(item => item.promotionError).map(item => [`${item.module}#${item.id}`, item.promotionError!]));
  const partials: WorldSimulationFieldPlan_ACU['partials'] = [];
  for (const [module, records] of Object.entries(fields?.records ?? {})) {
    for (const [id, record] of Object.entries(records ?? {})) {
      if (record.status !== 'partial') continue;
      const problem = problems.get(`${module}#${id}`);
      partials.push({ module: module as WorldSimulationFieldPlan_ACU['partials'][number]['module'], id,
        missingFields: [...record.missingFields], ...(problem ? { promotionError: problem } : {}) });
    }
  }
  return partials;
}

function fail_ACU(message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', message, false));
}

function checkContext_ACU(chat: unknown[], identity: WorldSimulationRunIdentity_ACU, anchor: WorldSimulationAnchorIdentity_ACU, first: Floor_ACU, expectedEnvelope: string): void {
  if (getChatArray_ACU() !== chat || chat[0] !== first || getActiveChatStorageIdentity_ACU(chat) !== identity.chatIdentity) fail_ACU('逐栏提交目标聊天已切换');
  resolveCurrentWorldSimulationAnchor_ACU(anchor, chat);
  const envelope = validateWorldSimulationEnvelope_ACU(first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU], 'persist');
  if (canonical_ACU(envelope) !== expectedEnvelope) fail_ACU('逐栏提交期间首楼世界状态已变化');
  const run = envelope.task?.activeRun;
  if (!run || envelope.task?.taskId !== identity.taskId || run.runId !== identity.runId
    || run.stageRevision !== identity.stageRevision || envelope.activeStageId !== identity.stageId) fail_ACU('逐栏提交运行租约已失效');
}

function stageChain_ACU(chat: unknown[], anchor: WorldSimulationAnchorIdentity_ACU,
  before: WorldSimulationLedgerFold_ACU | null, ledger: WorldSimulationLedgerFold_ACU['ledger'],
  archive: WorldChronicleArchiveSnapshot_ACU, plan: WorldSimulationFieldPlan_ACU, updatedAt: number): { chat: unknown[]; changes: Change_ACU[] } {
  const staged = chat.map(message => isRecord_ACU(message) ? { ...message } : message);
  if (!before || !equal_ACU(ledger, plan.ledger) || !equal_ACU(archive, plan.archive)) {
    appendWorldSimulationCommitChain_ACU({ chat: staged, messageIndex: anchor.messageIndex, anchor,
      beforeLedger: ledger, nextLedger: plan.ledger, evidenceRefs: [], updatedAt,
      checkpointIndex: before?.checkpointIndex ?? null, beforeArchive: archive, nextArchive: plan.archive,
      beforePartials: before ? extractWorldSimulationPartialFields_ACU(before.fields) : {} });
  }
  const fieldUpserts: WorldSimulationLedgerFieldUpserts_ACU = {};
  for (const batch of plan.batches) {
    const rows = (fieldUpserts[batch.module] ??= {});
    for (const [id, writes] of Object.entries(batch.fieldWrites ?? {})) rows[id] = { ...(rows[id] ?? {}), ...writes };
    for (const id of batch.discardPartialIds ?? []) {
      const record = before?.fields.records[batch.module]?.[id];
      if (record) rows[id] = Object.fromEntries(Object.keys(record.fields).map(field => [field, { unset: true }]));
    }
  }
  if (Object.values(fieldUpserts).some(rows => Object.keys(rows).length)
    && !appendWorldSimulationFieldDeltaChain_ACU({ chat: staged, messageIndex: anchor.messageIndex, anchor, fieldUpserts, updatedAt })) {
    throw new Error('逐栏帧无法追加：缺少可折叠账本基线');
  }
  const changes: Change_ACU[] = [];
  for (let index = 0; index < chat.length; index += 1) {
    const target = chat[index];
    const copy = staged[index];
    if (!isRecord_ACU(target) || !isRecord_ACU(copy)) continue;
    for (const key of [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU]) {
      if (target[key] !== copy[key]) changes.push({ target, key, existed: Object.prototype.hasOwnProperty.call(target, key), previous: target[key], staged: copy[key], expected: canonical_ACU(copy[key]) });
    }
  }
  return { chat: staged, changes };
}

async function verifySqlAndStage_ACU(chat: unknown[], anchor: WorldSimulationAnchorIdentity_ACU,
  before: WorldSimulationLedgerFold_ACU | null, ledger: WorldSimulationLedgerFold_ACU['ledger'],
  archive: WorldChronicleArchiveSnapshot_ACU, plan: WorldSimulationFieldPlan_ACU, updatedAt: number): Promise<ReturnType<typeof stageChain_ACU>> {
  const view = await materializeWorldSimulationLedgerSqlView_ACU(ledger, archive, before?.fields);
  try {
    let revision = ledger.revision;
    if (plan.archiveWrites.length) {
      const nextByFingerprint = new Map(plan.ledger.chronicleOverview.map(row => [row.fingerprint, row]));
      const beforeByFingerprint = new Map(ledger.chronicleOverview.map(row => [row.fingerprint, row]));
      const upserts = [...nextByFingerprint].filter(([key, row]) => !equal_ACU(beforeByFingerprint.get(key), row)).map(([, row]) => row);
      const removedIds = [...beforeByFingerprint.keys()].filter(key => !nextByFingerprint.has(key));
      view.applyArrayWrite({ module: 'chronicleOverview', expectedRevision: revision, upserts: upserts as unknown as Record<string, unknown>[], removedIds, updatedAt });
      view.applyArchiveWrite({ upserts: plan.archiveWrites });
      revision = view.readLedger().revision;
    }
    for (const batch of plan.batches) {
      revision = view.applyFieldBatch({ ...batch, expectedRevision: revision,
        advanceRevision: !plan.archiveWrites.length && batch.advanceRevision });
    }
    if (!equal_ACU(view.readLedger(), plan.ledger)) throw new Error('SQL 账本复算与领域规划不一致');
    if (plan.archiveWrites.length && !equal_ACU(view.exportArchiveRecords(),
      Object.fromEntries(plan.archiveWrites.map(row => [row.archiveRef, row])))) throw new Error('SQL 归档复算与领域规划不一致');
    const staged = stageChain_ACU(chat, anchor, before, ledger, archive, plan, updatedAt);
    const folded = foldWorldSimulationLedger_ACU(staged.chat, anchor.messageIndex);
    if (!folded || !equal_ACU(folded.ledger, plan.ledger)
      || !equal_ACU(foldWorldSimulationArchive_ACU(staged.chat).snapshot, plan.archive)) {
      throw new Error('影子楼层帧折叠与领域规划不一致');
    }
    for (const batch of plan.batches) {
      const ids = new Set([...Object.keys(batch.fieldWrites ?? {}), ...Object.keys(batch.domainUpserts ?? {}),
        ...(batch.domainRemovedIds ?? []), ...(batch.discardPartialIds ?? [])]);
      for (const id of ids) {
        if (!equal_ACU(comparableFieldRecord_ACU(view.readFieldRecord(batch.module, id)),
          comparableFieldRecord_ACU(folded.fields.records[batch.module]?.[id] ?? null))) {
          throw new Error(`影子楼层栏目 ${batch.module}#${id} 与 SQL 复算不一致`);
        }
      }
    }
    return staged;
  } finally { view.dispose(); }
}

export async function commitWorldSimulationFieldWritesWithinQueue_ACU(input: WorldSimulationFieldCommitInput_ACU): Promise<WorldSimulationFieldCommitReceipt_ACU> {
  const lease = { ...input.identity };
  if (input.isCurrent?.() === false) fail_ACU('逐栏提交派工租约已失效');
  const chat = getChatArray_ACU();
  const identity = getActiveChatStorageIdentity_ACU(chat);
  if (identity !== lease.chatIdentity || identity !== input.anchor.chatIdentity) fail_ACU('逐栏提交目标聊天身份已变化');
  const anchor = resolveCurrentWorldSimulationAnchor_ACU(input.anchor, chat);
  const first = chat[0];
  if (!isRecord_ACU(first)) fail_ACU('逐栏提交首楼不可用');
  const envelope = validateWorldSimulationEnvelope_ACU(first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU], 'persist');
  const run = envelope.task?.activeRun;
  if (!run || envelope.task?.taskId !== lease.taskId || run.runId !== lease.runId
    || run.stageRevision !== lease.stageRevision || envelope.activeStageId !== lease.stageId
    || input.evidenceRegistry.runId !== lease.runId) fail_ACU('逐栏提交运行租约已失效');
  const expectedEnvelope = canonical_ACU(envelope);
  const baseline = chat.map((message, index) => ({ message,
    assistant: isRecord_ACU(message) && message.is_user !== true && message.is_system !== true,
    anchor: isRecord_ACU(message) && message.is_user !== true && message.is_system !== true
      ? resolveWorldSimulationAnchor_ACU(index, chat) : null,
    fields: [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU].map(key => ({
      key, existed: isRecord_ACU(message) && Object.prototype.hasOwnProperty.call(message, key),
      content: isRecord_ACU(message) ? canonical_ACU(message[key]) : undefined,
    })),
  }));
  const baselineIntact = (excluded: ReadonlySet<string> = new Set()): boolean => chat.length === baseline.length
    && baseline.every((entry, index) => {
      if (chat[index] !== entry.message) return false;
      const assistant = isRecord_ACU(entry.message) && entry.message.is_user !== true && entry.message.is_system !== true;
      if (assistant !== entry.assistant) return false;
      if (entry.anchor && !equal_ACU(resolveWorldSimulationAnchor_ACU(index, chat), entry.anchor)) return false;
      return entry.fields.every(field => excluded.has(`${index}:${field.key}`) || (isRecord_ACU(entry.message)
        && Object.prototype.hasOwnProperty.call(entry.message, field.key) === field.existed
        && canonical_ACU(entry.message[field.key]) === field.content));
    });
  const before = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex);
  const ledger = before?.ledger ?? envelope.ledger;
  const archive = foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot;
  input.assertRunLedger?.({ ledger, fields: before?.fields, archive });
  const parsed = parseWorldSimulationSqlFieldWrites_ACU(input.sql, input.role);
  if (input.allowedModules) {
    const allowed = new Set(input.allowedModules);
    parsed.intents = parsed.intents.filter(intent => {
      const module = intent.module === 'chronicle_archive' || intent.module === 'chronicle_overview' ? 'chronicle' : intent.module;
      if (allowed.has(module)) return true;
      parsed.rejected.push({ path: `${intent.module}#${intent.id}`, reason: '派工无权写入该模块' });
      return false;
    });
  }
  const anchorMessage = chat[anchor.messageIndex] as Floor_ACU;
  const plan = planWorldSimulationFieldCommit_ACU({ ledger, fields: before?.fields ?? { records: {} }, archive,
    intents: parsed.intents, role: input.role, evidenceRegistry: input.evidenceRegistry,
    declaredEvidenceRefs: input.declaredEvidenceRefs, settings: envelope.settings,
    anchorMessage: typeof anchorMessage.mes === 'string' ? anchorMessage.mes : typeof anchorMessage.message === 'string' ? anchorMessage.message : '',
    now: input.updatedAt });
  const rejected = [...parsed.rejected, ...plan.rejected];
  const receipt = (status: WorldSimulationFieldCommitReceipt_ACU['status'], extra: Partial<WorldSimulationFieldCommitReceipt_ACU> = {}): WorldSimulationFieldCommitReceipt_ACU => ({
    status, accepted: status === 'committed' ? plan.accepted : [], rejected, partials: confirmedPartials_ACU(before?.fields),
    ledgerRevision: status === 'committed' ? plan.ledger.revision : ledger.revision, ...extra,
  });
  if (!plan.accepted.length) return receipt('rejected');
  const updatedAt = input.updatedAt ?? Date.now();
  let staged: ReturnType<typeof stageChain_ACU>;
  try {
    staged = await verifySqlAndStage_ACU(chat, anchor, before, ledger, archive, plan, updatedAt);
  } catch (error) {
    return receipt('rejected', { rejected: [...rejected, { path: 'sqlView', reason: errorText_ACU(error) }], sqlDiagnostics: errorText_ACU(error) });
  }
  const stagedFold = foldWorldSimulationLedger_ACU(staged.chat, anchor.messageIndex);
  const stagedArchive = foldWorldSimulationArchive_ACU(staged.chat, anchor.messageIndex).snapshot;
  if (input.confirmRunLedger && !input.prepareRunProof) fail_ACU('确认逐栏写入必须与运行证明同次保存');
  const proof = input.prepareRunProof?.({ ledger: stagedFold!.ledger, fields: stagedFold!.fields, archive: stagedArchive },
    input.declaredEvidenceRefs ?? [], plan.accepted);
  if (proof) {
    stageWorldSimulationRunWriteProof_ACU(staged.chat, anchor, proof, updatedAt);
    const target = chat[anchor.messageIndex] as Floor_ACU;
    const copy = staged.chat[anchor.messageIndex] as Floor_ACU;
    staged.changes.push({ target, key: WORLD_SIMULATION_RUN_WRITE_FIELD_ACU,
      existed: Object.prototype.hasOwnProperty.call(target, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU),
      previous: target[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU], staged: copy[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU],
      expected: canonical_ACU(copy[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU]) });
  }
  if (input.isCurrent?.() === false) fail_ACU('逐栏提交派工租约已失效');
  checkContext_ACU(chat, lease, anchor, first, expectedEnvelope);
  if (!baselineIntact()) fail_ACU('逐栏提交规划期间旧账本或归档已变化');
  const stagedKeys = new Set(staged.changes.map(change => `${chat.indexOf(change.target)}:${change.key}`));
  const unstagedIntact = (): boolean => baselineIntact(stagedKeys);
  for (const change of staged.changes) change.target[change.key] = change.staged;
  if (!unstagedIntact()) {
    if (staged.changes.every(change => change.target[change.key] === change.staged && canonical_ACU(change.staged) === change.expected)) {
      for (const change of staged.changes) {
        if (change.existed) change.target[change.key] = change.previous;
        else delete change.target[change.key];
      }
    }
    fail_ACU('逐栏提交保存前旧账本或归档已变化');
  }
  let status: 'persist_failed' | 'readback_failed' = 'persist_failed';
  try {
    if (input.isCurrent?.() === false) fail_ACU('逐栏提交派工租约已失效');
    await saveChatToHostStrict_ACU();
    status = 'readback_failed';
    if (input.isCurrent?.() === false) fail_ACU('逐栏提交派工租约已失效');
    checkContext_ACU(chat, lease, anchor, first, expectedEnvelope);
    if (!unstagedIntact()) fail_ACU('逐栏提交保存期间旧账本或归档已变化');
    const readback = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex);
    if (!readback || !stagedFold || !equal_ACU(readback.ledger, plan.ledger)
      || !equal_ACU(foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot, plan.archive)
      || !equal_ACU(readback.fields, stagedFold.fields)
      || (proof && !equal_ACU(readWorldSimulationRunWriteProof_ACU(anchor, chat), proof))
      || !staged.changes.every(change => change.target[change.key] === change.staged && canonical_ACU(change.staged) === change.expected)) throw new Error('保存后同内存聊天折叠与提交规划不一致');
    input.confirmRunLedger?.({ ledger: readback.ledger, fields: readback.fields, archive: foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot }, input.declaredEvidenceRefs ?? [], plan.accepted);
    return receipt('committed', { partials: confirmedPartials_ACU(readback.fields, plan.partials), accepted: plan.accepted.map(item => ({ ...item,
      revision: readback.fields.records[item.module]?.[item.id]?.fields[item.field]?.revision ?? readback.ledger.revision })) });
  } catch (error) {
    const staleBaseline = !unstagedIntact();
    const safe = staged.changes.every(change => change.target[change.key] === change.staged && canonical_ACU(change.staged) === change.expected);
    if (safe) for (const change of staged.changes) {
      if (change.existed) change.target[change.key] = change.previous;
      else delete change.target[change.key];
    }
    let recovery: WorldSimulationFieldCommitReceipt_ACU['recovery'] = 'unavailable';
    if (safe && !staleBaseline && input.isCurrent?.() !== false && getChatArray_ACU() === chat && chat[0] === first && getActiveChatStorageIdentity_ACU(chat) === identity) {
      let leaseActive = false;
      try { checkContext_ACU(chat, lease, anchor, first, expectedEnvelope); leaseActive = true; } catch { /* 租约失效时不覆盖宿主后续状态 */ }
      if (leaseActive) {
        const restored = staged.changes.map(change => ({ change, current: canonical_ACU(change.target[change.key]),
          existed: Object.prototype.hasOwnProperty.call(change.target, change.key) }));
        try {
          if (input.isCurrent?.() === false) fail_ACU('逐栏提交派工租约已失效');
          await saveChatToHostStrict_ACU();
          const unchanged = restored.every(({ change, current, existed }) =>
            Object.prototype.hasOwnProperty.call(change.target, change.key) === existed
            && canonical_ACU(change.target[change.key]) === current);
          if (unchanged && input.isCurrent?.() !== false && !staleBaseline && baselineIntact()) {
            try { checkContext_ACU(chat, lease, anchor, first, expectedEnvelope); recovery = 'saved'; }
            catch { /* 补偿期间上下文变化不能宣称恢复落盘 */ }
          }
        } catch { recovery = 'failed'; }
      }
    }
    return receipt(status, { recovery, ...(recovery === 'saved' ? {} : { partials: null, ledgerRevision: null }),
      rejected: [...rejected, { path: 'persist', reason: errorText_ACU(error) }] });
  }
}
