import { ZeroLayerError_ACU, type ZeroLayerSimulationState_ACU, type ZeroLayerSimulationResult_ACU, type ZeroLayerTurn_ACU } from './model';
import { validateWorldSimulationEnvelope_ACU, validateWorldSimulationChronicleArchiveSnapshot_ACU, validateWorldSimulationLogicalRef_ACU } from '../simulation/simulation-store';
import { validateWorldSimulationConversationFloorRecord_ACU } from '../simulation/agent/agent-conversation-store';
import { validateWorldSimulationUserRequirementsSnapshot_ACU } from '../simulation/agent/agent-user-requirements';
import { validateWorldSimulationRunStateRecord_ACU } from '../simulation/agent/agent-run-state-store';
import { validateWorldSimulationRunWriteProof_ACU, rebaseWorldSimulationRunWriteProof_ACU } from '../simulation/simulation-run-write-state';
import { WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU, WORLD_SIMULATION_SINGLETON_ID_ACU, type WorldSimulationLedgerFieldSnapshot_ACU, type WorldSimulationLogicalRef_ACU } from '../simulation/model';
import { reconcileLedgerFieldViewWithLedger_ACU } from '../simulation/simulation-ledger-fold';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { validateWorldSimulationLedger_ACU } from '../simulation/simulation-store';
import { buildWorldFactBodyProjection_ACU, buildWorldSimulationProjection_ACU, worldSimulationProjectionTemplateError_ACU } from '../simulation/simulation-projection';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import type { ZeroLayerBridgeHostCompletion_ACU } from './bridge-model';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new ZeroLayerError_ACU('corrupt-data', message);
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const exact = (value: Record<string, unknown>, keys: string[]) => requireValue(
  keys.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => keys.includes(key)), '推演快照字段无效。');

export function validateZeroLayerSimulationFields_ACU(raw: unknown): asserts raw is WorldSimulationLedgerFieldSnapshot_ACU {
  requireValue(record(raw) && record(raw.records), '推演栏目快照无效。');
  exact(raw, ['records']);
  for (const [module, rows] of Object.entries(raw.records)) {
    requireValue(Object.prototype.hasOwnProperty.call(WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU, module), '推演栏目模块无效。');
    const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module as keyof typeof WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU];
    requireValue(matrix && record(rows), '推演栏目模块无效。');
    for (const [id, row] of Object.entries(rows)) {
      requireValue(!['clock', 'player', 'guidance'].includes(module) || id === WORLD_SIMULATION_SINGLETON_ID_ACU, '推演单例栏目身份无效。');
      requireValue(record(row) && row.module === module && row.id === id && id.trim()
        && ['complete', 'partial', 'legacy_unknown'].includes(String(row.status))
        && record(row.fields) && Array.isArray(row.missingFields) && integer(row.updatedAt), '推演栏目记录无效。');
      exact(row, ['module', 'id', 'status', 'fields', 'missingFields', 'updatedAt']);
      const fields = row.fields;
      for (const [field, entry] of Object.entries(fields)) {
        requireValue(matrix.fields.includes(field) && record(entry) && integer(entry.revision) && integer(entry.updatedAt), '推演栏目值无效。');
        exact(entry, ['value', 'revision', 'updatedAt']);
      }
      const missing = row.status === 'partial' ? matrix.required.filter(field => !(field in fields)) : [];
      requireValue(JSON.stringify(missing) === JSON.stringify(row.missingFields), '推演缺栏与快照不一致。');
    }
  }
}

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : record(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

/** 结构校验与跨载体引用校验分开；后者必须在所有逻辑回合校验完成后调用。 */
export function validateZeroLayerSimulationState_ACU(raw: unknown): asserts raw is ZeroLayerSimulationState_ACU {
  requireValue(record(raw) && raw.schemaVersion === 1 && Array.isArray(raw.confirmed), '零层推演状态无效。');
  exact(raw, ['schemaVersion', 'envelope', 'fields', 'archive', 'conversation', 'userRequirements', 'runState', 'runProof', 'confirmed',
    ...(raw.legacyBackfill === undefined ? [] : ['legacyBackfill']),
    ...(raw.actorRemoval === undefined ? [] : ['actorRemoval']),
    ...(raw.actorImport === undefined ? [] : ['actorImport']),
    ...(raw.eventRemoval === undefined ? [] : ['eventRemoval']),
    ...(raw.historyRemoval === undefined ? [] : ['historyRemoval'])]);
  const envelope = raw.envelope === null ? null : validateWorldSimulationEnvelope_ACU(raw.envelope, 'load');
  if (raw.legacyBackfill !== undefined) {
    const backfill = raw.legacyBackfill;
    requireValue(record(backfill), '旧资料补迁来源无效。');
    exact(backfill, ['sourceRef', 'baseLedgerRevision', 'baseLedgerFingerprint', 'ledgerRevision', 'ledgerFingerprint']);
    if (backfill.sourceRef !== null) validateWorldSimulationLogicalRef_ACU(backfill.sourceRef, 'simulation.legacyBackfill.sourceRef', 'load');
    requireValue(integer(backfill.baseLedgerRevision) && integer(backfill.ledgerRevision)
      && backfill.ledgerRevision > backfill.baseLedgerRevision
      && typeof backfill.baseLedgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(backfill.baseLedgerFingerprint)
      && typeof backfill.ledgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(backfill.ledgerFingerprint)
      && envelope && envelope.ledger.revision >= backfill.ledgerRevision, '旧资料补迁账本身份无效。');
    if (envelope.ledger.revision === backfill.ledgerRevision) {
      requireValue(sha256HexSync_ACU(canonical(envelope.ledger)) === backfill.ledgerFingerprint, '旧资料补迁账本指纹不匹配。');
    }
  }
  if (raw.actorRemoval !== undefined) {
    const removal = raw.actorRemoval;
    requireValue(record(removal), '人物删除维护来源无效。');
    exact(removal, ['sourceRef', 'baseLedgerRevision', 'baseLedgerFingerprint', 'ledgerRevision', 'ledgerFingerprint']);
    if (removal.sourceRef !== null) validateWorldSimulationLogicalRef_ACU(removal.sourceRef, 'simulation.actorRemoval.sourceRef', 'load');
    requireValue(integer(removal.baseLedgerRevision) && integer(removal.ledgerRevision)
      && removal.ledgerRevision > removal.baseLedgerRevision
      && typeof removal.baseLedgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(removal.baseLedgerFingerprint)
      && typeof removal.ledgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(removal.ledgerFingerprint)
      && envelope && envelope.ledger.revision >= removal.ledgerRevision,
    '人物删除维护账本身份无效。');
    if (envelope.ledger.revision === removal.ledgerRevision) {
      requireValue(sha256HexSync_ACU(canonical(envelope.ledger)) === removal.ledgerFingerprint,
        '人物删除维护账本指纹不匹配。');
    }
  }
  if (raw.actorImport !== undefined) {
    const imported = raw.actorImport;
    requireValue(record(imported), '人物入册维护来源无效。');
    exact(imported, ['sourceRef', 'baseLedgerRevision', 'baseLedgerFingerprint', 'ledgerRevision', 'ledgerFingerprint']);
    if (imported.sourceRef !== null) validateWorldSimulationLogicalRef_ACU(imported.sourceRef, 'simulation.actorImport.sourceRef', 'load');
    requireValue(integer(imported.baseLedgerRevision) && integer(imported.ledgerRevision)
      && imported.ledgerRevision > imported.baseLedgerRevision
      && typeof imported.baseLedgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(imported.baseLedgerFingerprint)
      && typeof imported.ledgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(imported.ledgerFingerprint)
      && envelope && envelope.ledger.revision >= imported.ledgerRevision,
    '人物入册维护账本身份无效。');
    if (envelope.ledger.revision === imported.ledgerRevision) {
      requireValue(sha256HexSync_ACU(canonical(envelope.ledger)) === imported.ledgerFingerprint,
        '人物入册维护账本指纹不匹配。');
    }
  }
  if (raw.eventRemoval !== undefined) {
    const removal = raw.eventRemoval;
    requireValue(record(removal), '事件删除维护来源无效。');
    exact(removal, ['sourceRef', 'baseLedgerRevision', 'baseLedgerFingerprint', 'ledgerRevision', 'ledgerFingerprint']);
    if (removal.sourceRef !== null) validateWorldSimulationLogicalRef_ACU(removal.sourceRef, 'simulation.eventRemoval.sourceRef', 'load');
    requireValue(integer(removal.baseLedgerRevision) && integer(removal.ledgerRevision)
      && removal.ledgerRevision > removal.baseLedgerRevision
      && typeof removal.baseLedgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(removal.baseLedgerFingerprint)
      && typeof removal.ledgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(removal.ledgerFingerprint)
      && envelope && envelope.ledger.revision >= removal.ledgerRevision, '事件删除维护账本身份无效。');
    if (envelope.ledger.revision === removal.ledgerRevision) {
      requireValue(sha256HexSync_ACU(canonical(envelope.ledger)) === removal.ledgerFingerprint,
        '事件删除维护账本指纹不匹配。');
    }
  }
  if (raw.historyRemoval !== undefined) {
    const removal = raw.historyRemoval;
    requireValue(record(removal), '历史删除维护来源无效。');
    exact(removal, ['sourceRef', 'baseLedgerRevision', 'baseLedgerFingerprint', 'ledgerRevision', 'ledgerFingerprint']);
    if (removal.sourceRef !== null) validateWorldSimulationLogicalRef_ACU(removal.sourceRef, 'simulation.historyRemoval.sourceRef', 'load');
    requireValue(integer(removal.baseLedgerRevision) && integer(removal.ledgerRevision)
      && removal.ledgerRevision > removal.baseLedgerRevision
      && typeof removal.baseLedgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(removal.baseLedgerFingerprint)
      && typeof removal.ledgerFingerprint === 'string' && /^[a-f0-9]{64}$/.test(removal.ledgerFingerprint)
      && envelope && envelope.ledger.revision >= removal.ledgerRevision, '历史删除维护账本身份无效。');
    if (envelope.ledger.revision === removal.ledgerRevision) {
      requireValue(sha256HexSync_ACU(canonical(envelope.ledger)) === removal.ledgerFingerprint,
        '历史删除维护账本指纹不匹配。');
    }
  }
  validateZeroLayerSimulationFields_ACU(raw.fields);
  validateWorldSimulationChronicleArchiveSnapshot_ACU(raw.archive, 'load');
  const conversation = validateWorldSimulationConversationFloorRecord_ACU(raw.conversation);
  validateWorldSimulationUserRequirementsSnapshot_ACU(raw.userRequirements);
  const runState = raw.runState === null ? null : validateWorldSimulationRunStateRecord_ACU(raw.runState);
  const proof = raw.runProof === null ? null : validateWorldSimulationRunWriteProof_ACU(raw.runProof);
  const ids = conversation.segments.flatMap(segment => segment.messages.map(message => message.id));
  requireValue(ids.every((id, index) => id === index + 1), '逻辑推演会话序号不连续。');
  requireValue(conversation.segments.every(segment => !segment.compaction
    || segment.compaction.compactedThroughId <= ids.length), '推演压缩引用超出持久会话。');
  if (!envelope) {
    requireValue(runState === null && proof === null && raw.confirmed.length === 0
      && Object.values(raw.fields.records).every(rows => Object.keys(rows ?? {}).length === 0), '推演状态缺少权威信封。');
  } else {
    const reconciled = structuredClone(raw.fields);
    reconcileLedgerFieldViewWithLedger_ACU(reconciled, envelope.ledger, envelope.updatedAt);
    requireValue(canonical(reconciled) === canonical(raw.fields), '推演栏目与权威账本不一致。');
    if (proof) {
      const view = { ledger: envelope.ledger, fields: raw.fields, archive: raw.archive as ZeroLayerSimulationState_ACU['archive'] };
      rebaseWorldSimulationRunWriteProof_ACU(proof, view, view);
    }
    const run = envelope.task?.activeRun;
    if (runState && run) requireValue(runState.taskId === run.taskId
      && runState.cursorKey === `${run.stageId}#${run.stageRevision}#${run.baseLedgerRevision}`, '推演恢复游标不属于当前运行。');
    if (proof && run && proof.runId === run.runId) requireValue(proof.taskId === run.taskId
      && proof.stageId === run.stageId && proof.stageRevision === run.stageRevision
      && proof.baseLedgerRevision === run.baseLedgerRevision, '推演证明不属于当前运行。');
  }
  const confirmed = new Set<string>();
  for (const item of raw.confirmed) {
    requireValue(record(item) && integer(item.ledgerRevision), '推演确认记录无效。');
    exact(item, ['ref', 'ledgerRevision']);
    const ref = validateWorldSimulationLogicalRef_ACU(item.ref, 'simulation.confirmed.ref', 'load');
    requireValue(!confirmed.has(ref.turnId) && envelope && item.ledgerRevision <= envelope.ledger.revision, '推演确认重复或 revision 无效。');
    confirmed.add(ref.turnId);
  }
}

export function validateZeroLayerSimulationRefs_ACU(
  state: ZeroLayerSimulationState_ACU, sessionId: string, branchId: string,
  turns: ReadonlyMap<string, ZeroLayerTurn_ACU>,
  hostCompletion?: ZeroLayerBridgeHostCompletion_ACU | null,
  reachable?: ReadonlySet<string>,
  headTurnId?: string | null,
): void {
  const assertRef = (ref: WorldSimulationLogicalRef_ACU, digest?: string) => {
    const turn = turns.get(ref.turnId);
    requireValue(ref.sessionId === sessionId && turn && ref.branchId === turn.branchId
      && (reachable ? reachable.has(turn.turnId)
        || turn.branchId === branchId && turn.parentTurnId === headTurnId && turn.phase !== 'published'
        : turn.branchId === branchId) && turn.attemptId === ref.attemptId
      && turn.assistantFloor.floorId === ref.floorId && typeof turn.body === 'string' && turn.body.trim()
      && ['response-durable', 'effects-durable', 'published'].includes(turn.phase), '推演引用必须对应本分支已保存的逻辑正文。');
    if (digest !== undefined) requireValue(sha256HexSync_ACU(turn.body) === digest, '推演正文指纹与逻辑引用不一致。');
  };
  const envelope = state.envelope;
  const run = envelope?.task?.activeRun;
  if (run) {
    requireValue(run.kind === 'logical', '零层推演不能保存宿主运行身份。');
    assertRef(run.logicalRef, run.anchorContentDigest);
  }
  const completed = envelope?.task?.completedAutoAnchor;
  if (completed) {
    if (completed.kind === 'logical') {
      assertRef(completed.logicalRef, completed.contentDigest);
    } else {
      requireValue(hostCompletion && hostCompletion.taskId === envelope?.task?.taskId
        && hostCompletion.ref.kind === 'host'
        && canonical(completed) === canonical(hostCompletion.anchor),
      '宿主完成锚点必须匹配本任务已确认的桥接来源证明。');
    }
  }
  for (const fix of envelope?.ledger.pendingFixes ?? []) if (fix.anchor) {
    requireValue('logicalRef' in fix.anchor && fix.anchor.logicalRef, '零层推演不能保存宿主待修复锚点。');
    assertRef(fix.anchor.logicalRef, fix.anchor.contentDigest);
  }
  const backfill = state.legacyBackfill;
  if (backfill?.sourceRef) {
    assertRef(backfill.sourceRef);
    const origin = turns.get(backfill.sourceRef.turnId)!;
    validateZeroLayerSimulationReceipt_ACU(origin, sessionId);
    const originalLedger = (origin.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU).ledger;
    requireValue(originalLedger?.revision === backfill.baseLedgerRevision
      && sha256HexSync_ACU(canonical(originalLedger)) === backfill.baseLedgerFingerprint,
    '旧资料补迁来源与原推演回执不一致。');
  }
  const removal = state.actorRemoval;
  if (removal?.sourceRef) {
    assertRef(removal.sourceRef);
    const origin = turns.get(removal.sourceRef.turnId)!;
    requireValue(origin.phase === 'published' && state.confirmed.some(item => canonical(item.ref) === canonical(removal.sourceRef)
      && item.ledgerRevision === removal.baseLedgerRevision), '人物删除维护必须来自已发布确认。');
    validateZeroLayerSimulationReceipt_ACU(origin, sessionId);
    const originalLedger = (origin.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU).ledger;
    requireValue(originalLedger?.revision === removal.baseLedgerRevision
      && sha256HexSync_ACU(canonical(originalLedger)) === removal.baseLedgerFingerprint,
    '人物删除维护来源与原推演回执不一致。');
  }
  const imported = state.actorImport;
  if (imported?.sourceRef) {
    assertRef(imported.sourceRef);
    const origin = turns.get(imported.sourceRef.turnId)!;
    requireValue(origin.phase === 'published' && state.confirmed.some(item => canonical(item.ref) === canonical(imported.sourceRef)
      && item.ledgerRevision === imported.baseLedgerRevision), '人物入册维护必须来自已发布确认。');
    validateZeroLayerSimulationReceipt_ACU(origin, sessionId);
    const originalLedger = (origin.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU).ledger;
    requireValue(originalLedger?.revision === imported.baseLedgerRevision
      && sha256HexSync_ACU(canonical(originalLedger)) === imported.baseLedgerFingerprint,
    '人物入册维护来源与原推演回执不一致。');
  }
  const eventRemoval = state.eventRemoval;
  if (eventRemoval?.sourceRef) {
    assertRef(eventRemoval.sourceRef);
    const origin = turns.get(eventRemoval.sourceRef.turnId)!;
    requireValue(origin.phase === 'published' && state.confirmed.some(item => canonical(item.ref) === canonical(eventRemoval.sourceRef)
      && item.ledgerRevision === eventRemoval.baseLedgerRevision), '事件删除维护必须来自已发布确认。');
    validateZeroLayerSimulationReceipt_ACU(origin, sessionId);
    const originalLedger = (origin.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU).ledger;
    requireValue(originalLedger?.revision === eventRemoval.baseLedgerRevision
      && sha256HexSync_ACU(canonical(originalLedger)) === eventRemoval.baseLedgerFingerprint,
    '事件删除维护来源与原推演回执不一致。');
  }
  const historyRemoval = state.historyRemoval;
  if (historyRemoval?.sourceRef) {
    assertRef(historyRemoval.sourceRef);
    const origin = turns.get(historyRemoval.sourceRef.turnId)!;
    requireValue(origin.phase === 'published' && state.confirmed.some(item => canonical(item.ref) === canonical(historyRemoval.sourceRef)
      && item.ledgerRevision === historyRemoval.baseLedgerRevision), '历史删除维护必须来自已发布确认。');
    validateZeroLayerSimulationReceipt_ACU(origin, sessionId);
    const originalLedger = (origin.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU).ledger;
    requireValue(originalLedger?.revision === historyRemoval.baseLedgerRevision
      && sha256HexSync_ACU(canonical(originalLedger)) === historyRemoval.baseLedgerFingerprint,
    '历史删除维护来源与原推演回执不一致。');
  }
  for (const item of state.confirmed) {
    assertRef(item.ref);
    const turn = turns.get(item.ref.turnId)!;
    validateZeroLayerSimulationReceipt_ACU(turn, sessionId);
    const result = turn.assistantFloor.data.simulation as ZeroLayerSimulationResult_ACU;
    requireValue(result.outcome !== 'skipped-by-config' && result.ledger?.revision === item.ledgerRevision,
      '推演确认与逻辑楼层结果不一致。');
  }
}

export function validateZeroLayerSimulationResult_ACU(raw: unknown): asserts raw is ZeroLayerSimulationResult_ACU {
  requireValue(record(raw) && raw.schemaVersion === 1 && typeof raw.summary === 'string'
    && ['commit', 'no_change', 'skipped-by-config'].includes(String(raw.outcome))
    && (raw.projection === null || typeof raw.projection === 'string'), '逻辑推演结果无效。');
  exact(raw, [...(raw.delivery === undefined ? [] : ['delivery']),
    ...(raw.bodyFactIds === undefined ? [] : ['bodyFactIds']), ...(raw.bodyTemplate === undefined ? [] : ['bodyTemplate']),
    'schemaVersion', 'ref', 'outcome', 'summary', 'ledger', 'fields', 'archive', 'projection']);
  if (raw.delivery !== undefined) requireValue(raw.delivery === 'ledger-only' || raw.delivery === 'body',
    '推演交付格式无效。');
  if (raw.delivery === 'ledger-only') requireValue(raw.projection === null
    && raw.bodyFactIds === undefined && raw.bodyTemplate === undefined, '账本模式不能包含正文投影。');
  if (raw.delivery === 'body') requireValue(Array.isArray(raw.bodyFactIds)
    && raw.bodyFactIds.every(id => typeof id === 'string' && !!id.trim())
    && new Set(raw.bodyFactIds).size === raw.bodyFactIds.length
    && typeof raw.bodyTemplate === 'string' && !worldSimulationProjectionTemplateError_ACU(raw.bodyTemplate),
    '正文投影事实或格式无效。');
  if (raw.delivery === undefined) requireValue(raw.bodyFactIds === undefined && raw.bodyTemplate === undefined,
    '旧推演结果不能混用新正文投影字段。');
  validateWorldSimulationLogicalRef_ACU(raw.ref, 'simulation.result.ref', 'load');
  validateZeroLayerSimulationFields_ACU(raw.fields);
  validateWorldSimulationChronicleArchiveSnapshot_ACU(raw.archive, 'load');
  if (raw.ledger !== null) {
    const ledger = validateWorldSimulationLedger_ACU(raw.ledger, 'load');
    if (raw.delivery === 'body') {
      requireValue((raw.bodyFactIds as string[]).every(id => ledger.facts.some(fact => fact.id === id
        && fact.revealState === 'unlocked' && fact.projectionPolicy !== 'internal' && !!fact.summary.trim())),
      '正文事实必须属于已解锁的结果账本。');
    }
    requireValue(raw.delivery === 'ledger-only' ? ledger.projection.anchor === null && !ledger.projection.deliveries.length
      : raw.delivery === 'body' ? raw.projection === buildWorldFactBodyProjection_ACU(ledger, raw.bodyFactIds as string[], raw.bodyTemplate as string)
        : raw.projection === buildWorldSimulationProjection_ACU(ledger), '逻辑推演投影不属于结果账本。');
    const fields = structuredClone(raw.fields);
    reconcileLedgerFieldViewWithLedger_ACU(fields, ledger, 0);
    requireValue(canonical(fields) === canonical(raw.fields), '逻辑推演结果栏目与账本不一致。');
  } else requireValue(raw.outcome === 'skipped-by-config' && raw.projection === null
    && Object.values(raw.fields.records).every(rows => !Object.keys(rows ?? {}).length), '逻辑推演结果缺少账本。');
}

export function validateZeroLayerSimulationReceipt_ACU(turn: ZeroLayerTurn_ACU, sessionId: string): void {
  const result = turn.assistantFloor.data.simulation;
  validateZeroLayerSimulationResult_ACU(result);
  if (turn.simulationDeliveryTarget === 'plot') {
    requireValue(result.delivery === 'ledger-only' && result.projection === null && result.bodyFactIds === undefined,
      '剧情推进投送只接受不含正文投影的账本交付。');
  }
  const ref = result.ref;
  requireValue(ref.sessionId === sessionId && ref.branchId === turn.branchId && ref.turnId === turn.turnId
    && ref.attemptId === turn.attemptId && ref.floorId === turn.assistantFloor.floorId, '推演回执逻辑身份不匹配。');
  const receipt = turn.effectReceipts.find(item => item.kind === 'simulation');
  requireValue(receipt && receipt.effectId === JSON.stringify([sessionId, turn.branchId, turn.turnId, 'simulation'])
    && receipt.status === (result.outcome === 'skipped-by-config' ? 'skipped-by-config' : 'durable')
    && receipt.fingerprint === getTableDataFingerprint_ACU(result), '推演回执与持久结果不匹配。');
}