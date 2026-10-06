import {
  ZERO_LAYER_SCHEMA_VERSION_ACU, ZeroLayerError_ACU,
  type ZeroLayerEnvelope_ACU, type ZeroLayerTurn_ACU, type ZeroLayerTurnPhase_ACU,
  type ZeroLayerTableResult_ACU, type ZeroLayerTableCandidate_ACU, type ZeroLayerPlotCandidate_ACU,
} from './model';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { validateContinuationEnvelope_ACU } from '../continuation/continuation-store';
import { validateAgentConversationFloorRecord_ACU } from '../continuation/agent/agent-conversation-store';
import type { ZeroLayerContinuationState_ACU } from './model';
import { validateZeroLayerSimulationState_ACU, validateZeroLayerSimulationRefs_ACU } from './simulation-validation';
import { validateZeroLayerCheckpointState_ACU } from './checkpoint-validation';
import { validateZeroLayerBridgeState_ACU } from './bridge-validation';
import { capturePublishedMaterials_ACU, validatePublishedMaterials_ACU } from './branch-materials';
import { checkpointPath_ACU, checkpointTurnRef_ACU } from './checkpoint-payload';
import { validateBranchPath_ACU } from './branch-path';
import { validateZeroLayerWorkingFrame_ACU, validateZeroLayerWorkingFrameScope_ACU } from './continuation-working-frame';
import { validateZeroLayerExitManifest_ACU } from './exit-validation';


const PHASES_ACU: readonly ZeroLayerTurnPhase_ACU[] = [
  'prepared', 'dispatching', 'response-durable', 'effects-durable',
  'published', 'cancelled', 'failed', 'delivery-unknown',
];
const EFFECTS_ACU = ['plot', 'table', 'continuation', 'simulation'] as const;

export function requireZeroLayerValue_ACU(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ZeroLayerError_ACU('corrupt-data', message);
}

function record_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function id_ACU(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function integer_ACU(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 只校验可序列化业务表，不接受运行时 descriptor 或未知空值。 */
export function validateZeroLayerTableData_ACU(raw: unknown): asserts raw is TableDataObject_ACU {
  requireZeroLayerValue_ACU(record_ACU(raw) && record_ACU(raw.mate), '表格快照缺少 mate。');
  for (const [key, sheet] of Object.entries(raw)) {
    if (key === 'mate') continue;
    requireZeroLayerValue_ACU(key.startsWith('sheet_') && record_ACU(sheet)
      && id_ACU(sheet.uid) && id_ACU(sheet.name) && record_ACU(sheet.sourceData)
      && record_ACU(sheet.updateConfig) && record_ACU(sheet.exportConfig)
      && typeof sheet.orderNo === 'number' && Number.isFinite(sheet.orderNo)
      && Array.isArray(sheet.content) && sheet.content.length > 0
      && sheet.content.every(row => Array.isArray(row)
        && row.every(cell => cell === null || typeof cell === 'string')), '表格快照结构无效。');
  }
}

export function validateZeroLayerTableFrontier_ACU(raw: unknown): asserts raw is Record<string, number> {
  requireZeroLayerValue_ACU(record_ACU(raw) && Object.entries(raw).every(([key, value]) =>
    key.startsWith('sheet_') && integer_ACU(value)), '逻辑表格覆盖前沿无效。');
}

export function validateZeroLayerTableResult_ACU(raw: unknown, floorId: string): asserts raw is ZeroLayerTableResult_ACU {
  requireZeroLayerValue_ACU(record_ACU(raw) && raw.floorId === floorId, '表格结果逻辑楼层身份无效。');
  validateZeroLayerTableData_ACU(raw.tableData);
  validateZeroLayerTableFrontier_ACU(raw.completedAiFloorBySheetKey);
  requireZeroLayerValue_ACU(Array.isArray(raw.filledSheetKeys)
    && raw.filledSheetKeys.every(key => typeof key === 'string' && key.startsWith('sheet_'))
    && new Set(raw.filledSheetKeys).size === raw.filledSheetKeys.length, '表格完成列表无效。');
}

export function validateZeroLayerTableCandidate_ACU(raw: unknown, floorId: string): asserts raw is ZeroLayerTableCandidate_ACU {
  validateZeroLayerTableResult_ACU(raw, floorId);
  const ids = (raw as Partial<ZeroLayerTableCandidate_ACU>).completedBucketIds;
  requireZeroLayerValue_ACU(Array.isArray(ids) && ids.every(id_ACU)
    && new Set(ids).size === ids.length, '表格候选桶身份无效。');
}

export function validateZeroLayerPlotCandidate_ACU(raw: unknown, floorId: string): asserts raw is ZeroLayerPlotCandidate_ACU {
  requireZeroLayerValue_ACU(record_ACU(raw) && raw.floorId === floorId
    && typeof raw.presetName === 'string' && ['generated', 'no-tasks', 'disabled'].includes(String(raw.outcome))
    && (raw.finalMessage === null || typeof raw.finalMessage === 'string')
    && typeof raw.content === 'string' && typeof raw.agentActive === 'boolean'
    && record_ACU(raw.taskContents) && Object.values(raw.taskContents).every(value => typeof value === 'string'),
  '剧情候选结构或逻辑楼层身份无效。');
  requireZeroLayerValue_ACU(Array.isArray(raw.finalPrompts) && raw.finalPrompts.every(prompt => record_ACU(prompt)
    && ['system', 'user', 'assistant'].includes(String(prompt.role)) && typeof prompt.content === 'string'
    && integer_ACU(prompt.depth)
    && ['before_character_definition', 'after_character_definition', 'at_depth'].includes(String(prompt.position))),
  '剧情正文世界书消息无效。');
  requireZeroLayerValue_ACU(Array.isArray(raw.filterEntries) && raw.filterEntries.every(entry => record_ACU(entry)
    && typeof entry.content === 'string' && typeof entry.comment === 'string'), '剧情过滤目录无效。');
  if (raw.outcome === 'generated') {
    requireZeroLayerValue_ACU(typeof raw.finalMessage === 'string' && raw.finalMessage.trim()
      && raw.content.trim(), '已生成剧情候选缺少有效内容。');
  } else {
    requireZeroLayerValue_ACU(raw.finalMessage === null && raw.content === ''
      && Object.keys(raw.taskContents).length === 0, '未执行剧情任务不能携带生成结果。');
  }
  if (raw.outcome === 'disabled') {
    requireZeroLayerValue_ACU(!raw.agentActive && raw.finalPrompts.length === 0
      && raw.filterEntries.length === 0, '禁用剧情不能携带 Agent 注入。');
  }
}

/** 确认标记必须与同一载体内的真实正文结算一致，不能只凭逻辑序号认领。 */
export function validateZeroLayerContinuationReceipt_ACU(turn: ZeroLayerTurn_ACU, sessionId: string): void {
  const identity = turn.continuationIdentity;
  requireZeroLayerValue_ACU(identity, '续写确认缺少完整尝试身份。');
  const data = { floorId: turn.assistantFloor.floorId, identity };
  const receipt = turn.effectReceipts.find(item => item.kind === 'continuation');
  const stored = turn.assistantFloor.data.continuation;
  requireZeroLayerValue_ACU(receipt && receipt.status === 'durable'
    && receipt.effectId === JSON.stringify([sessionId, turn.turnId, turn.attemptId, 'continuation'])
    && receipt.fingerprint === getTableDataFingerprint_ACU(data), '续写确认缺少匹配的持久化回执。');
  requireZeroLayerValue_ACU(record_ACU(stored) && stored.floorId === data.floorId
    && record_ACU(stored.identity) && Object.keys(stored).length === 2
    && Object.keys(stored.identity).length === 7, '续写确认附属数据无效。');
  const storedIdentity = stored.identity;
  requireZeroLayerValue_ACU((['chatIdentity', 'taskId', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId'] as const)
    .every(key => storedIdentity[key] === identity[key]), '续写确认附属数据与完整尝试身份不匹配。');
}

function validateTurn_ACU(raw: unknown): asserts raw is ZeroLayerTurn_ACU {
  requireZeroLayerValue_ACU(record_ACU(raw), '回合必须为对象。');
  for (const key of ['turnId', 'branchId', 'attemptId']) {
    requireZeroLayerValue_ACU(id_ACU(raw[key]), `回合 ${key} 无效。`);
  }
  requireZeroLayerValue_ACU(raw.parentTurnId === null || id_ACU(raw.parentTurnId), '回合父身份无效。');
  requireZeroLayerValue_ACU(typeof raw.input === 'string' && raw.input.trim(), '回合输入无效。');
  requireZeroLayerValue_ACU(raw.body === null || typeof raw.body === 'string', '回合正文无效。');
  requireZeroLayerValue_ACU(PHASES_ACU.includes(raw.phase as ZeroLayerTurnPhase_ACU), '回合阶段无效。');
  requireZeroLayerValue_ACU(integer_ACU(raw.createdAt) && integer_ACU(raw.updatedAt)
    && raw.updatedAt >= raw.createdAt, '回合时间无效。');
  requireZeroLayerValue_ACU(raw.errorCode === null || id_ACU(raw.errorCode), '回合错误码无效。');
  if (raw.continuationIdentity !== undefined) {
    const identity = raw.continuationIdentity;
    requireZeroLayerValue_ACU(record_ACU(identity) && Object.keys(identity).length === 7
      && ['chatIdentity', 'taskId', 'stageId', 'nodeId', 'turnId', 'attemptId'].every(key => id_ACU(identity[key]))
      && integer_ACU(identity.revision) && identity.revision > 0, '续写完整尝试身份无效。');
  }
  if (raw.tableInput !== undefined) {
    requireZeroLayerValue_ACU(record_ACU(raw.tableInput) && id_ACU(raw.tableInput.chatKey)
      && typeof raw.tableInput.isolationKey === 'string'
      && ['native', 'sqlite'].includes(String(raw.tableInput.storageMode)), '回合表格输入身份无效。');
    validateZeroLayerTableData_ACU(raw.tableInput.tableData);
    validateZeroLayerTableData_ACU(raw.tableInput.templateData);
    validateZeroLayerTableFrontier_ACU(raw.tableInput.completedAiFloorBySheetKey);
    requireZeroLayerValue_ACU(typeof raw.tableInput.autoUpdateEnabled === 'boolean', '回合自动填表开关无效。');
    if (raw.tableInput.scheduling !== undefined) {
      const scheduling = raw.tableInput.scheduling;
      requireZeroLayerValue_ACU(record_ACU(scheduling)
        && integer_ACU(scheduling.autoUpdateFrequency)
        && integer_ACU(scheduling.skipUpdateFloors)
        && integer_ACU(scheduling.autoUpdateThreshold)
        && integer_ACU(scheduling.updateBatchSize)
        && scheduling.updateBatchSize > 0, '持久表格调度快照无效。');
    }
  }
  for (const [key, role] of [['userFloor', 'user'], ['assistantFloor', 'assistant']] as const) {
    const floor = raw[key];
    requireZeroLayerValue_ACU(record_ACU(floor) && id_ACU(floor.floorId)
      && floor.role === role && record_ACU(floor.data), '逻辑楼层无效。');
  }
  requireZeroLayerValue_ACU(Array.isArray(raw.requiredEffects)
    && raw.requiredEffects.every(kind => EFFECTS_ACU.includes(kind))
    && new Set(raw.requiredEffects).size === raw.requiredEffects.length, '必需结算列表无效。');
  requireZeroLayerValue_ACU(Array.isArray(raw.effectReceipts), '结算回执必须为数组。');

  const receiptKinds = new Set<string>();
  const receiptIds = new Set<string>();
  for (const receipt of raw.effectReceipts) {
    requireZeroLayerValue_ACU(record_ACU(receipt) && id_ACU(receipt.effectId)
      && EFFECTS_ACU.includes(receipt.kind as typeof EFFECTS_ACU[number])
      && (receipt.status === 'durable' || receipt.status === 'skipped-by-config')
      && id_ACU(receipt.fingerprint), '结算回执无效。');
    requireZeroLayerValue_ACU(!receiptKinds.has(String(receipt.kind)) && !receiptIds.has(receipt.effectId), '结算回执重复。');
    receiptKinds.add(String(receipt.kind));
    receiptIds.add(receipt.effectId);
  }
  if (raw.tableCandidate !== undefined) {
    validateZeroLayerTableCandidate_ACU(raw.tableCandidate,
      (raw.assistantFloor as ZeroLayerTurn_ACU['assistantFloor']).floorId);
  }
  if (raw.materialBaseline !== undefined) {
    requireZeroLayerValue_ACU(record_ACU(raw.materialBaseline), '回合资料基底结构无效。');
    const baseline = raw.materialBaseline;
    if (baseline.continuation !== null) validateZeroLayerContinuationState_ACU(baseline.continuation);
    if (baseline.simulation !== null) validateZeroLayerSimulationState_ACU(baseline.simulation);
  }
  if (raw.plotCandidate !== undefined) {
    validateZeroLayerPlotCandidate_ACU(raw.plotCandidate, (raw.userFloor as ZeroLayerTurn_ACU['userFloor']).floorId);
    requireZeroLayerValue_ACU(raw.effectReceipts.some(receipt => receipt.kind === 'plot'
      && receipt.status === 'durable' && receipt.effectId === `${raw.turnId}:${raw.attemptId}:plot`
      && receipt.fingerprint === getTableDataFingerprint_ACU(raw.plotCandidate)),
    '已保存剧情候选缺少本轮持久回执。');
  }
  const tableResult = (raw.assistantFloor as ZeroLayerTurn_ACU['assistantFloor']).data.table;
  if (tableResult !== undefined) {
    validateZeroLayerTableResult_ACU(tableResult, (raw.assistantFloor as ZeroLayerTurn_ACU['assistantFloor']).floorId);
  }
  if (['response-durable', 'effects-durable', 'published'].includes(String(raw.phase))) {
    requireZeroLayerValue_ACU(typeof raw.body === 'string' && raw.body.trim(), '已保存响应阶段缺少完整正文。');
  }
  if (raw.phase === 'effects-durable' || raw.phase === 'published') {
    const receipts = raw.effectReceipts;
    requireZeroLayerValue_ACU(raw.requiredEffects.every(kind => receipts.some(
      (receipt: ZeroLayerTurn_ACU['effectReceipts'][number]) => receipt.kind === kind && (receipt.status === 'durable'
        || kind === 'simulation' && receipt.status === 'skipped-by-config'),
    )), '必需结算缺少持久化回执。');
  }
}

/** 独立命名空间中的续写状态；读取不迁移、不以空状态掩盖损坏。 */
export function validateZeroLayerContinuationState_ACU(raw: unknown): asserts raw is ZeroLayerContinuationState_ACU {
  requireZeroLayerValue_ACU(record_ACU(raw) && raw.schemaVersion === 1
    && record_ACU(raw.moduleFrames) && Array.isArray(raw.confirmed), '零层续写状态无效。');
  if (raw.workingFrame !== undefined) validateZeroLayerWorkingFrame_ACU(raw.workingFrame);
  if (raw.envelope !== null) validateContinuationEnvelope_ACU(raw.envelope);
  requireZeroLayerValue_ACU(validateAgentConversationFloorRecord_ACU(raw.conversation), '零层续写会话记录损坏。');
  const turns = new Set<string>();
  const attempts = new Set<string>();
  for (const item of raw.confirmed) {
    requireZeroLayerValue_ACU(record_ACU(item) && id_ACU(item.turnId) && id_ACU(item.attemptId)
      && id_ACU(item.floorId) && id_ACU(item.continuationAttemptId), '零层续写确认引用无效。');
    requireZeroLayerValue_ACU(!turns.has(item.turnId) && !attempts.has(item.continuationAttemptId), '零层续写确认重复。');
    turns.add(item.turnId);
    attempts.add(item.continuationAttemptId);
  }
}

/** 读取只校验，不修复、补默认值或写回。 */
export function validateZeroLayerEnvelope_ACU(raw: unknown): ZeroLayerEnvelope_ACU {
  requireZeroLayerValue_ACU(record_ACU(raw), '零层存档必须为对象。');
  if (raw.schemaVersion !== ZERO_LAYER_SCHEMA_VERSION_ACU) {
    throw new ZeroLayerError_ACU('unsupported-version', '零层存档版本不受支持。');
  }
  for (const key of ['sessionId', 'carrierId', 'activationFingerprint', 'activeBranchId']) {
    requireZeroLayerValue_ACU(id_ACU(raw[key]), `零层存档 ${key} 无效。`);
  }
  requireZeroLayerValue_ACU(record_ACU(raw.scope) && id_ACU(raw.scope.chatId)
    && id_ACU(raw.scope.characterKey), '零层聊天作用域无效。');
  requireZeroLayerValue_ACU(integer_ACU(raw.revision) && integer_ACU(raw.carrierSwipeId)
    && integer_ACU(raw.activationMessageCount) && raw.activationMessageCount > 0, '零层存档序号无效。');
  requireZeroLayerValue_ACU(typeof raw.seedBody === 'string' && typeof raw.enabled === 'boolean'
    && typeof raw.apiPresetName === 'string', '零层配置或开场白无效。');
  requireZeroLayerValue_ACU(Array.isArray(raw.branches) && raw.branches.length > 0
    && Array.isArray(raw.turns), '零层分支或回合列表无效。');
  const branchIds = new Set<string>();
  for (const branch of raw.branches) {
    requireZeroLayerValue_ACU(record_ACU(branch) && id_ACU(branch.branchId)
      && (branch.headTurnId === null || id_ACU(branch.headTurnId)), '分支身份无效。');
    requireZeroLayerValue_ACU(!branchIds.has(branch.branchId), '分支身份重复。');
    if (branch.continuation !== undefined) validateZeroLayerContinuationState_ACU(branch.continuation);
    if (branch.simulation !== undefined) validateZeroLayerSimulationState_ACU(branch.simulation);
    branchIds.add(branch.branchId);
  }
  requireZeroLayerValue_ACU(branchIds.has(String(raw.activeBranchId)), '活动分支不存在。');

  const turns = new Map<string, ZeroLayerTurn_ACU>();
  const floorIds = new Set<string>();
  const attemptIds = new Set<string>();
  const pendingBranches = new Set<string>();
  for (const value of raw.turns) {
    validateTurn_ACU(value);
    requireZeroLayerValue_ACU(branchIds.has(value.branchId), '回合所属分支不存在。');
    requireZeroLayerValue_ACU(!turns.has(value.turnId) && !attemptIds.has(value.attemptId), '回合或尝试身份重复。');
    if (value.parentTurnId !== null) {
      requireZeroLayerValue_ACU(turns.get(value.parentTurnId)?.phase === 'published', '父回合必须为之前已发布的回合。');
    }
    for (const floor of [value.userFloor, value.assistantFloor]) {
      requireZeroLayerValue_ACU(!floorIds.has(floor.floorId), '逻辑楼层身份重复。');
      floorIds.add(floor.floorId);
    }
    if (!['published', 'cancelled', 'failed'].includes(value.phase)) {
      requireZeroLayerValue_ACU(!pendingBranches.has(value.branchId), '同一分支存在多个未结算回合。');
      pendingBranches.add(value.branchId);
    }
    turns.set(value.turnId, value);
    attemptIds.add(value.attemptId);
  }
  for (const branch of raw.branches) {
    if (branch.headTurnId !== null) {
      requireZeroLayerValue_ACU(turns.get(branch.headTurnId)?.phase === 'published', '分支 head 未指向已发布回合。');
    }
    validateBranchPath_ACU(raw as unknown as ZeroLayerEnvelope_ACU, branch);
    validateZeroLayerWorkingFrameScope_ACU(raw as unknown as ZeroLayerEnvelope_ACU, branch);
    const path = checkpointPath_ACU(raw as unknown as ZeroLayerEnvelope_ACU, branch.branchId);
    const reachable = new Set(path.map(turn => turn.turnId));
    if (branch.continuation) {
      for (const ref of branch.continuation.confirmed) {
        const turn = turns.get(ref.turnId);
        requireZeroLayerValue_ACU(turn && turn.attemptId === ref.attemptId
          && (reachable.has(turn.turnId) || turn.branchId === branch.branchId
            && turn.parentTurnId === branch.headTurnId && turn.phase !== 'published')
          && turn.assistantFloor.floorId === ref.floorId
          && turn.continuationIdentity?.attemptId === ref.continuationAttemptId
          && ['response-durable', 'effects-durable', 'published'].includes(turn.phase),
        '续写确认必须引用已保存正文的真实逻辑回合。');
        validateZeroLayerContinuationReceipt_ACU(turn, String(raw.sessionId));
      }
    }
    if (branch.simulation) validateZeroLayerSimulationRefs_ACU(branch.simulation, String(raw.sessionId), branch.branchId, turns,
      branch.bridge?.phase === 'reconciled' ? branch.bridge.candidate?.simulationHostCompletion : undefined, reachable, branch.headTurnId);
    validateZeroLayerCheckpointState_ACU(raw as unknown as ZeroLayerEnvelope_ACU, branch);
    validateZeroLayerBridgeState_ACU(raw as unknown as ZeroLayerEnvelope_ACU, branch);
  }
  for (const turn of turns.values()) {
    if (turn.publishedMaterials !== undefined) {
      validatePublishedMaterials_ACU(turn.publishedMaterials, raw as unknown as ZeroLayerEnvelope_ACU, turn);
    }
  }
  validateZeroLayerExitManifest_ACU(raw as unknown as ZeroLayerEnvelope_ACU);
  return structuredClone(raw) as unknown as ZeroLayerEnvelope_ACU;
}

const TRANSITIONS_ACU: Readonly<Record<ZeroLayerTurnPhase_ACU, readonly ZeroLayerTurnPhase_ACU[]>> = {
  prepared: ['dispatching', 'cancelled', 'failed'],
  dispatching: ['response-durable', 'cancelled', 'failed', 'delivery-unknown'],
  'response-durable': ['effects-durable'],
  'effects-durable': ['published'],
  published: [], cancelled: [], failed: [],
  'delivery-unknown': ['response-durable', 'cancelled'],
};

/** 纯状态迁移；完整响应落盘后只补结算，不重新发送模型请求。 */
export function transitionZeroLayerTurn_ACU(
  envelope: ZeroLayerEnvelope_ACU,
  turnId: string,
  phase: ZeroLayerTurnPhase_ACU,
  changes: Pick<Partial<ZeroLayerTurn_ACU>, 'body' | 'effectReceipts' | 'errorCode'> = {},
): ZeroLayerEnvelope_ACU {
  const candidate = validateZeroLayerEnvelope_ACU(envelope);
  const turn = candidate.turns.find(item => item.turnId === turnId);
  if (!turn || !TRANSITIONS_ACU[turn.phase].includes(phase)) {
    throw new ZeroLayerError_ACU('invalid-transition', '零层回合状态迁移无效。');
  }
  Object.assign(turn, structuredClone(changes), { phase, updatedAt: Math.max(Date.now(), turn.updatedAt) });
  if (phase === 'published') {
    const branch = candidate.branches.find(item => item.branchId === turn.branchId);
    if (!branch || branch.headTurnId !== turn.parentTurnId) {
      throw new ZeroLayerError_ACU('revision-conflict', '发布时分支 head 已变化。');
    }
    validateZeroLayerWorkingFrameScope_ACU(candidate, branch);
    const continuation = branch.continuation;
    if (continuation?.workingFrame) {
      const key = JSON.stringify(checkpointTurnRef_ACU(candidate, turn));
      requireZeroLayerValue_ACU(!Object.prototype.hasOwnProperty.call(continuation.moduleFrames, key)
        && !Object.prototype.hasOwnProperty.call(branch.checkpoints?.replayFrames ?? {}, key),
      '发布不能覆盖已有资料帧或回放档案。');
      continuation.moduleFrames[key] = structuredClone(continuation.workingFrame.payload);
      delete continuation.workingFrame;
    }
    branch.headTurnId = turn.turnId;
    turn.publishedMaterials = capturePublishedMaterials_ACU(candidate, turn);
  }
  candidate.revision += 1;
  return validateZeroLayerEnvelope_ACU(candidate);
}
