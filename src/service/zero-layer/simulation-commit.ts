import { ZeroLayerError_ACU, type ZeroLayerSimulationState_ACU } from './model';
import { ZeroLayerSimulationStore_ACU } from './simulation-store';
import { parseWorldSimulationSqlFieldWrites_ACU } from '../simulation/agent/agent-protocol';
import type { WorldSimulationLogicalAnchorIdentity_ACU } from '../simulation/agent/agent-model';
import type { WorldSimulationFieldCommitInput_ACU, WorldSimulationFieldCommitReceipt_ACU } from '../simulation/simulation-field-commit-adapter';
import { planWorldSimulationFieldCommit_ACU } from '../simulation/simulation-field-commit';
import { materializeWorldSimulationLedgerSqlView_ACU } from '../simulation/simulation-ledger-sql-view';
import { applyLedgerFieldUpsertsToView_ACU, reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { planWorldSimulationFinalCommit_ACU } from '../simulation/simulation-commit-adapter';
import { materializeReviewedWorldRoundCandidate_ACU, materializeWorldRoundCandidate_ACU, materializeWorldRoundPreview_ACU, type WorldRoundCandidate_ACU } from '../simulation/world-candidate';
import { claimWorldBodyProjection_ACU, type WorldBodyProjectionProof_ACU, type WorldFactRevealProof_ACU } from '../simulation/agent/world-projection-stage';
import { rebaseWorldSimulationRunWriteProof_ACU } from '../simulation/simulation-run-write-state';
import type { WorldSimulationOrchestratorDependencies_ACU } from '../simulation/simulation-orchestrator';
import type { WorldSimulationLedgerFieldUpserts_ACU, WorldSimulationRunIdentity_ACU } from '../simulation/model';
import { sameWorldSimulationTargetRef_ACU, worldSimulationRunTargetRef_ACU, worldSimulationTargetRef_ACU } from '../simulation/simulation-identity';
import { validateWorldSimulationEnvelope_ACU } from '../simulation/simulation-store';
import { buildZeroLayerSimulationEffect_ACU } from './simulation-result';
import { validateZeroLayerSimulationReceipt_ACU } from './simulation-validation';

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
const viewOf = (state: ZeroLayerSimulationState_ACU) => {
  if (!state.envelope) throw new ZeroLayerError_ACU('effects-pending', '推演账本尚未建立。');
  return { ledger: state.envelope.ledger, fields: state.fields, archive: state.archive };
};
function assertRun(state: ZeroLayerSimulationState_ACU, identity: WorldSimulationRunIdentity_ACU): void {
  const envelope = state.envelope;
  const run = envelope?.task?.activeRun;
  if (identity.kind !== 'logical' || !run || run.runId !== identity.runId
    || run.taskId !== identity.taskId || run.stageId !== identity.stageId || run.stageRevision !== identity.stageRevision
    || run.workflowProtocol !== identity.workflowProtocol
    || envelope?.task?.status !== 'running'
    || !sameWorldSimulationTargetRef_ACU(worldSimulationRunTargetRef_ACU(run), worldSimulationRunTargetRef_ACU(identity))) {
    throw new ZeroLayerError_ACU('revision-conflict', '推演联合提交运行租约已失效。');
  }
}

/** 终局复用同一领域规划；逻辑正文不变，交付与分支账本同次严格保存。 */
export async function commitZeroLayerSimulationFinal_ACU(
  store: ZeroLayerSimulationStore_ACU,
  input: Parameters<WorldSimulationOrchestratorDependencies_ACU['commitProjection']>[0],
): Promise<WorldSimulationLogicalAnchorIdentity_ACU> {
  store.assertAnchor(input.anchor);
  const anchor = structuredClone(input.anchor);
  const before = store.readState();
  if (before.envelope?.task?.activeRun?.deliveryTarget === 'plot'
    || (before.envelope?.task?.activeRun?.deliveryTarget === undefined && before.envelope?.settings.deliveryTarget === 'plot')) {
    throw new ZeroLayerError_ACU('invalid-transition', '剧情推进投送尚未接通，禁止通过旧推演交付路径提交。');
  }
  if (before.envelope?.task?.activeRun?.workflowProtocol === 'world-round-v1'
    || input.identity.workflowProtocol === 'world-round-v1') {
    throw new ZeroLayerError_ACU('invalid-transition', '新协议运行不得通过旧正文/SQL 提交路径写入。');
  }
  if (before.envelope?.task?.activeRun?.workflowMode === 'single'
    || (before.envelope?.task?.activeRun?.workflowMode === undefined && before.envelope?.settings.workflowMode === 'single')) {
    throw new ZeroLayerError_ACU('invalid-transition', '单 Agent 新工作流尚未接通，拒绝旧导演提交。');
  }
  assertRun(before, input.identity);
  const candidate = input.commitCandidate;
  if (candidate.runId !== input.identity.runId || candidate.taskId !== input.identity.taskId
    || candidate.stageId !== input.identity.stageId || candidate.stageRevision !== input.identity.stageRevision
    || candidate.baseLedgerRevision !== input.identity.baseLedgerRevision
    || !sameWorldSimulationTargetRef_ACU(worldSimulationRunTargetRef_ACU(input.identity), worldSimulationTargetRef_ACU(anchor))) {
    throw new ZeroLayerError_ACU('revision-conflict', '推演交付身份与运行租约不一致。');
  }
  const view = viewOf(before);
  input.runWrites?.assertCurrent(view);
  input.runWrites?.assertPersistedProof(input.identity, before.runProof);
  input.runWrites?.assertCandidatesDisjoint(candidate.acceptedCandidates);
  if (!candidate.acceptedCandidates.length && !input.runWrites?.hasConfirmedWrites) {
    throw new ZeroLayerError_ACU('invalid-transition', '终局缺少候选或已确认写入。');
  }
  const body = store.readSource().turns.find(turn => turn.turnId === anchor.logicalRef.turnId)!.body!;
  const planned = await planWorldSimulationFinalCommit_ACU(before.envelope!, input, body, view.archive);
  const fields = structuredClone(view.fields);
  reconcileLedgerFieldViewWithLedger_ACU(fields, planned.ledger, input.completedAt);
  const after = { ledger: planned.ledger, fields, archive: planned.archiveSnapshot };
  const proof = before.runProof ? rebaseWorldSimulationRunWriteProof_ACU(before.runProof, view, after) : null;
  const next = validateWorldSimulationEnvelope_ACU({ ...before.envelope!, ledger: planned.ledger,
    task: { ...before.envelope!.task!, status: 'completed', activeRun: null, completedRun: structuredClone(input.identity), stopReason: null,
      updatedAt: input.completedAt, ...(input.identity.triggerKind === 'assistant_completed'
        ? { completedAutoAnchor: worldSimulationTargetRef_ACU(anchor) } : {}) },
    stages: before.envelope!.stages.map(stage => stage.stageId === input.identity.stageId
      ? { ...stage, status: 'completed' } : stage),
    timeline: [...before.envelope!.timeline, ...planned.extraTimeline, { id: input.timelineId,
      at: input.completedAt, kind: 'committed', taskId: input.identity.taskId, stageId: input.identity.stageId,
      revision: input.identity.stageRevision, runId: input.identity.runId, message: candidate.summary }],
    updatedAt: input.completedAt, lastError: null }, 'persist');
  await store.updateState((state, source) => {
    store.assertAnchor(anchor, source);
    assertRun(state, input.identity);
    if (canonical(state.envelope) !== canonical(before.envelope) || canonical(viewOf(state)) !== canonical(view)
      || canonical(state.runProof) !== canonical(before.runProof)) {
      throw new ZeroLayerError_ACU('revision-conflict', '终局规划期间推演基线已变化。');
    }
    state.envelope = next;
    state.fields = fields;
    state.archive = planned.archiveSnapshot;
    state.runProof = proof;
    state.runState = null;
    const turn = source.turns.find(item => item.turnId === anchor.logicalRef.turnId)!;
    if (input.identity.triggerKind === 'assistant_completed' && turn.phase === 'response-durable') {
      if (turn.effectReceipts.some(item => item.kind === 'simulation')) validateZeroLayerSimulationReceipt_ACU(turn, store.sessionId);
      else state.confirmed.push({ ref: structuredClone(anchor.logicalRef), ledgerRevision: next.ledger.revision });
    }
  }, source => {
    const turn = source.turns.find(item => item.turnId === anchor.logicalRef.turnId)!;
    if (input.identity.triggerKind !== 'assistant_completed' || turn.phase !== 'response-durable'
      || turn.effectReceipts.some(item => item.kind === 'simulation')) return undefined;
    const state = source.branches.find(branch => branch.branchId === store.branchId)!.simulation!;
    return buildZeroLayerSimulationEffect_ACU(state, anchor, 'commit', candidate.summary);
  });
  return anchor;
}
type ZeroLayerSimulationRoundInput_ACU = { identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationLogicalAnchorIdentity_ACU; roundCandidate: WorldRoundCandidate_ACU;
  completedAt: number; timelineId: string; summary: string;
  bodyProjection?: { proof: WorldBodyProjectionProof_ACU } };
type ZeroLayerReviewedSimulationRoundInput_ACU = ZeroLayerSimulationRoundInput_ACU & {
  proof: WorldFactRevealProof_ACU; factIds: readonly string[] };

/** 新候选只结算账本；零层 carrier 的推演分支、栏目与回执在一次写队列候选中保存。 */
export async function commitZeroLayerSimulationRound_ACU(
  store: ZeroLayerSimulationStore_ACU, input: ZeroLayerSimulationRoundInput_ACU,
): Promise<WorldSimulationLogicalAnchorIdentity_ACU> {
  // 调用方即使绕过类型系统附带 proof/factIds，也不能让旧入口退化为 reviewed 提交。
  const supplied = input as unknown as Record<string, unknown>;
  if ('proof' in supplied || 'factIds' in supplied) {
    throw new ZeroLayerError_ACU('invalid-transition', '受审事实揭示必须使用显式 reviewed 提交入口。');
  }
  return commitZeroLayerSimulationRoundInternal_ACU(store, input);
}

/** 仅 reviewed wrapper 可消费一次性 proof；不提供正文投送或跨宿主原子性承诺。 */
export async function commitZeroLayerReviewedSimulationRound_ACU(
  store: ZeroLayerSimulationStore_ACU, input: ZeroLayerReviewedSimulationRoundInput_ACU,
): Promise<WorldSimulationLogicalAnchorIdentity_ACU> {
  // identity 与 targetAnchor 均以已类型化的提交入参为准，绝不采信调用方附带的授权声称。
  return commitZeroLayerSimulationRoundInternal_ACU(store, input, {
    proof: input.proof, factIds: input.factIds, identity: input.identity, targetAnchor: input.anchor,
  });
}

async function commitZeroLayerSimulationRoundInternal_ACU(
  store: ZeroLayerSimulationStore_ACU, input: ZeroLayerSimulationRoundInput_ACU,
  reviewed?: { proof: WorldFactRevealProof_ACU; factIds: readonly string[];
    identity: WorldSimulationRunIdentity_ACU; targetAnchor: WorldSimulationLogicalAnchorIdentity_ACU },
): Promise<WorldSimulationLogicalAnchorIdentity_ACU> {
  store.assertAnchor(input.anchor);
  const anchor = structuredClone(input.anchor);
  const before = store.readState();
  assertRun(before, input.identity);
  const run = before.envelope!.task!.activeRun!;
  const source = store.readSource();
  const turn = source.turns.find(item => item.turnId === anchor.logicalRef.turnId && item.attemptId === anchor.logicalRef.attemptId);
  if (input.identity.workflowProtocol !== run.workflowProtocol) {
    throw new ZeroLayerError_ACU('revision-conflict', '零层新候选协议与冻结运行不一致。');
  }
  if (!turn || turn.phase !== 'response-durable'
    || (turn.simulationDeliveryTarget ?? 'body') !== (run.deliveryTarget ?? 'body')
    || run.deliveryTarget !== input.identity.deliveryTarget || run.workflowMode !== input.identity.workflowMode
    || run.baseLedgerRevision !== input.identity.baseLedgerRevision
    || input.identity.baseLedgerRevision !== before.envelope!.ledger.revision) {
    throw new ZeroLayerError_ACU('revision-conflict', '零层新候选目标、回合或基础账本已变化。');
  }
  if (turn.effectReceipts.some(item => item.kind === 'simulation') || before.runProof
    || Object.values(before.fields.records).some(rows => Object.values(rows ?? {}).some(row => row.status === 'partial'))
    || input.roundCandidate.projection.anchor !== null || input.roundCandidate.projection.deliveries.length
    || before.envelope!.ledger.projection.anchor !== null || before.envelope!.ledger.projection.deliveries.length) {
    throw new ZeroLayerError_ACU('invalid-transition', '零层新候选不能混合旧逐栏写入或未实现的正文投影。');
  }
  // 全部运行、回合、目标、partial 和 base revision 检查完成之后，先物化未解锁预览，才能领取 body proof。
  if (input.bodyProjection && (run.deliveryTarget !== 'body' || input.identity.triggerKind !== 'assistant_completed')) {
    throw new ZeroLayerError_ACU('invalid-transition', '非正文完成锚点不能投送事实。');
  }
  const previewLedger = input.bodyProjection
    ? materializeWorldRoundPreview_ACU(before.envelope!.ledger, input.roundCandidate)
    : null;
  const bodyFactIds = input.bodyProjection
    ? claimWorldBodyProjection_ACU(input.bodyProjection.proof, previewLedger!, input.identity, anchor) : undefined;
  // reveal proof 仅在 body proof 领取之后消费；最终账本仍由原 reviewed 入口校验与物化。
  const ledger = reviewed
    ? materializeReviewedWorldRoundCandidate_ACU(before.envelope!.ledger, input.roundCandidate, {
      proof: reviewed.proof, factIds: reviewed.factIds, identity: input.identity, targetAnchor: anchor,
    })
    : previewLedger ?? materializeWorldRoundCandidate_ACU(before.envelope!.ledger, input.roundCandidate);
  const fields = structuredClone(before.fields);
  reconcileLedgerFieldViewWithLedger_ACU(fields, ledger, input.completedAt);
  const next = validateWorldSimulationEnvelope_ACU({ ...before.envelope!, ledger,
    task: { ...before.envelope!.task!, status: 'completed', activeRun: null, completedRun: structuredClone(input.identity), stopReason: null,
      updatedAt: input.completedAt, ...(input.identity.triggerKind === 'assistant_completed'
        ? { completedAutoAnchor: worldSimulationTargetRef_ACU(anchor) } : {}) },
    stages: before.envelope!.stages.map(stage => stage.stageId === input.identity.stageId
      ? { ...stage, status: 'completed' } : stage),
    timeline: [...before.envelope!.timeline, { id: input.timelineId, at: input.completedAt,
      kind: 'committed', taskId: input.identity.taskId, stageId: input.identity.stageId,
      revision: input.identity.stageRevision, runId: input.identity.runId, message: input.summary }],
    updatedAt: input.completedAt, lastError: null }, 'persist');
  await store.updateState((state, current) => {
    store.assertAnchor(anchor, current);
    assertRun(state, input.identity);
    if (canonical(state.envelope) !== canonical(before.envelope) || canonical(viewOf(state)) !== canonical(viewOf(before))
      || canonical(state.runProof) !== canonical(before.runProof)) {
      throw new ZeroLayerError_ACU('revision-conflict', '新候选提交期间推演分支已变化。');
    }
    const activeTurn = current.turns.find(item => item.turnId === turn.turnId && item.attemptId === turn.attemptId);
    if (!activeTurn || activeTurn.phase !== 'response-durable'
      || (activeTurn.simulationDeliveryTarget ?? 'body') !== (input.identity.deliveryTarget ?? 'body')
      || activeTurn.effectReceipts.some(item => item.kind === 'simulation')) {
      throw new ZeroLayerError_ACU('revision-conflict', '新候选提交期间逻辑回合已变化。');
    }
    state.envelope = next;
    state.fields = fields;
    state.runState = null;
    if (input.identity.triggerKind === 'assistant_completed') {
      state.confirmed.push({ ref: structuredClone(anchor.logicalRef), ledgerRevision: ledger.revision });
    }
  }, current => {
    if (input.identity.triggerKind !== 'assistant_completed') return undefined;
    const state = current.branches.find(branch => branch.branchId === store.branchId)!.simulation!;
    return buildZeroLayerSimulationEffect_ACU(state, anchor, 'commit', input.summary,
      bodyFactIds === undefined ? 'ledger-only' : 'body', bodyFactIds);
  });
  const saved = store.readState();
  if (canonical(viewOf(saved)) !== canonical({ ledger, fields, archive: before.archive })
    || saved.envelope?.task?.status !== 'completed' || saved.envelope.task.activeRun !== null
    || input.identity.triggerKind === 'assistant_completed' && !saved.confirmed.some(item => canonical(item.ref) === canonical(anchor.logicalRef)
      && item.ledgerRevision === ledger.revision)) {
    throw new ZeroLayerError_ACU('persist-unknown', '推演提交回读不一致，禁止继续请求。');
  }
  return anchor;
}

type LogicalFieldInput_ACU = Omit<WorldSimulationFieldCommitInput_ACU, 'anchor'> & { anchor: WorldSimulationLogicalAnchorIdentity_ACU };

/** 逐栏候选先经 SQL 复算；栏目、账本、归档与 proof 只进行一次 carrier 保存。 */
export async function commitZeroLayerSimulationFields_ACU(store: ZeroLayerSimulationStore_ACU,
  input: LogicalFieldInput_ACU): Promise<WorldSimulationFieldCommitReceipt_ACU> {
  store.assertAnchor(input.anchor);
  if (input.identity.workflowProtocol === 'world-round-v1') {
    throw new ZeroLayerError_ACU('invalid-transition', '新协议运行不得通过旧逐栏 SQL 提交路径写入。');
  }
  if (input.isCurrent?.() === false) throw new ZeroLayerError_ACU('scope-changed', '推演派工已失效。');
  const before = store.readState();
  if (before.envelope?.task?.activeRun?.workflowProtocol === 'world-round-v1') {
    throw new ZeroLayerError_ACU('invalid-transition', '新协议运行不得通过旧逐栏 SQL 提交路径写入。');
  }
  assertRun(before, input.identity);
  if (input.evidenceRegistry.runId !== input.identity.runId) throw new ZeroLayerError_ACU('revision-conflict', '推演证据不属于当前运行。');
  const view = viewOf(before);
  input.assertRunLedger?.(view);
  const parsed = parseWorldSimulationSqlFieldWrites_ACU(input.sql, input.role);
  if (input.allowedModules) parsed.intents = parsed.intents.filter(intent => {
    const module = intent.module === 'chronicle_archive' || intent.module === 'chronicle_overview' ? 'chronicle' : intent.module;
    if (input.allowedModules!.includes(module)) return true;
    parsed.rejected.push({ path: `${intent.module}#${intent.id}`, reason: '派工无权写入该模块' });
    return false;
  });
  const at = input.updatedAt ?? Date.now();
  const body = store.readSource().turns.find(turn => turn.turnId === input.anchor.logicalRef.turnId)!.body!;
  const plan = planWorldSimulationFieldCommit_ACU({ ...view, intents: parsed.intents, role: input.role,
    evidenceRegistry: input.evidenceRegistry, declaredEvidenceRefs: input.declaredEvidenceRefs,
    settings: before.envelope!.settings, anchorMessage: body, now: at });
  const rejected = [...parsed.rejected, ...plan.rejected];
  const partials = (fields: typeof view.fields) => Object.values(fields.records).flatMap(rows =>
    Object.values(rows ?? {}).filter(row => row.status === 'partial').map(row => ({ module: row.module, id: row.id, missingFields: [...row.missingFields] })));
  if (!plan.accepted.length) return { status: 'rejected', accepted: [], rejected,
    partials: partials(view.fields), ledgerRevision: view.ledger.revision };
  const sql = await materializeWorldSimulationLedgerSqlView_ACU(view.ledger, view.archive, view.fields);
  let fields = structuredClone(view.fields);
  try {
    let revision = view.ledger.revision;
    if (plan.archiveWrites.length) {
      const nextRows = new Map(plan.ledger.chronicleOverview.map(row => [row.fingerprint, row]));
      const oldRows = new Map(view.ledger.chronicleOverview.map(row => [row.fingerprint, row]));
      sql.applyArrayWrite({ module: 'chronicleOverview', expectedRevision: revision,
        upserts: [...nextRows].filter(([key, row]) => canonical(oldRows.get(key)) !== canonical(row)).map(([, row]) => row) as unknown as Record<string, unknown>[],
        removedIds: [...oldRows.keys()].filter(key => !nextRows.has(key)), updatedAt: at });
      sql.applyArchiveWrite({ upserts: plan.archiveWrites });
      revision = sql.readLedger().revision;
    }
    for (const batch of plan.batches) revision = sql.applyFieldBatch({ ...batch, expectedRevision: revision,
      advanceRevision: !plan.archiveWrites.length && batch.advanceRevision });
    if (canonical(sql.readLedger()) !== canonical(plan.ledger)) throw new Error('SQL 账本复算与领域规划不一致');
    if (plan.archiveWrites.length && canonical(sql.exportArchiveRecords()) !== canonical(Object.fromEntries(plan.archiveWrites.map(row => [row.archiveRef, row])))) {
      throw new Error('SQL 归档复算与领域规划不一致');
    }
    const upserts: WorldSimulationLedgerFieldUpserts_ACU = {};
    for (const batch of plan.batches) {
      const rows = (upserts[batch.module] ??= {});
      for (const [id, writes] of Object.entries(batch.fieldWrites ?? {})) rows[id] = { ...(rows[id] ?? {}), ...writes };
      for (const id of batch.discardPartialIds ?? []) rows[id] = Object.fromEntries(Object.keys(view.fields.records[batch.module]?.[id]?.fields ?? {}).map(field => [field, { unset: true }]));
    }
    fields = applyLedgerFieldUpsertsToView_ACU(fields, upserts, at);
    reconcileLedgerFieldViewWithLedger_ACU(fields, plan.ledger, at);
    const comparable = (row: { status: string; fields: Record<string, { value: unknown; revision: number }> } | null) => row
      ? { status: row.status, fields: Object.fromEntries(Object.entries(row.fields).map(([key, field]) => [key, { value: field.value, revision: field.revision }])) } : null;
    for (const batch of plan.batches) for (const id of new Set([...Object.keys(batch.fieldWrites ?? {}), ...Object.keys(batch.domainUpserts ?? {}), ...(batch.domainRemovedIds ?? []), ...(batch.discardPartialIds ?? [])])) {
      if (canonical(comparable(sql.readFieldRecord(batch.module, id))) !== canonical(comparable(fields.records[batch.module]?.[id] ?? null))) throw new Error('carrier 栏目与 SQL 复算不一致');
    }
  } catch (error) {
    return { status: 'rejected', accepted: [], rejected: [...rejected, { path: 'sqlView', reason: error instanceof Error ? error.message : String(error) }],
      partials: partials(view.fields), ledgerRevision: view.ledger.revision };
  } finally { sql.dispose(); }
  const nextView = { ledger: plan.ledger, fields, archive: plan.archive };
  if (!input.prepareRunProof) throw new ZeroLayerError_ACU('invalid-transition', '逻辑逐栏提交必须联合保存运行证明。');
  const proof = input.prepareRunProof(nextView, input.declaredEvidenceRefs ?? [], plan.accepted);
  await store.updateState((state, source) => {
    store.assertAnchor(input.anchor, source);
    assertRun(state, input.identity);
    if (input.isCurrent?.() === false || canonical(viewOf(state)) !== canonical(view)
      || canonical(state.runProof) !== canonical(before.runProof)) throw new ZeroLayerError_ACU('revision-conflict', '推演提交基线已变化。');
    input.assertRunLedger?.(viewOf(state));
    state.envelope!.ledger = plan.ledger;
    state.fields = fields;
    state.archive = plan.archive;
    state.runProof = proof;
  });
  const saved = store.readView();
  if (canonical(saved) !== canonical(nextView) || canonical(store.readState().runProof) !== canonical(proof)) {
    throw new ZeroLayerError_ACU('persist-unknown', '推演提交回读不一致，禁止继续请求。');
  }
  input.confirmRunLedger?.(saved, input.declaredEvidenceRefs ?? [], plan.accepted);
  return { status: 'committed', rejected, partials: partials(saved.fields), ledgerRevision: saved.ledger.revision,
    accepted: plan.accepted.map(item => { const field = saved.fields.records[item.module]?.[item.id]?.fields[item.field];
      return { ...item, revision: field?.revision ?? saved.ledger.revision, ...(field ? { value: field.value } : {}) }; }) };
}
