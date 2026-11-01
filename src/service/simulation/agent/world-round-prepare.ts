import type { TableDataObject_ACU } from '../../../shared/models/table-data';
import type { WorldSimulationMainLoopResult_ACU, WorldSimulationTargetAnchor_ACU } from './agent-model';
import type { WorldSimulationAgentInvoker_ACU } from './agent-subagent-runtime';
import { runWorldRound_ACU, type WorldRoundRunnerInput_ACU } from './world-round-runner';
import { buildWorldRoundStageRevision_ACU } from '../simulation-stage-planner';
import { sameWorldSimulationTargetRef_ACU, worldSimulationRunTargetRef_ACU, worldSimulationTargetRef_ACU } from '../simulation-identity';
import type { WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import type { WorldSimulationEnvelope_ACU, WorldSimulationRunIdentity_ACU } from '../model';
import { validateWorldSimulationUserRequirementsSnapshot_ACU } from './agent-user-requirements';
import type { WorldSimulationUserRequirementsSnapshot_ACU } from './agent-model';
import type { AgentWorldbookSnapshot_ACU } from '../../continuation/agent/agent-worldbook-read';
import type { WorldRunMaterials_ACU } from '../world-run-materials';
import { buildWorldRunMaterials_ACU, sameWorldRunMaterials_ACU } from '../world-run-materials';

function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameFrozenRun_ACU(left: WorldSimulationRunIdentity_ACU, right: WorldSimulationRunIdentity_ACU): boolean {
  const bothLogical = left.kind === 'logical' && right.kind === 'logical';
  const bothHost = left.kind !== 'logical' && right.kind !== 'logical';
  const sameAnchor = bothLogical
    ? left.logicalRef.sessionId === right.logicalRef.sessionId && left.logicalRef.branchId === right.logicalRef.branchId
      && left.logicalRef.turnId === right.logicalRef.turnId && left.logicalRef.attemptId === right.logicalRef.attemptId
      && left.logicalRef.floorId === right.logicalRef.floorId
    : bothHost
      ? left.anchorMessageId === right.anchorMessageId && left.anchorMessageKey === right.anchorMessageKey
        && left.anchorSwipeId === right.anchorSwipeId
      : false;
  return sameAnchor && left.runId === right.runId && left.taskId === right.taskId && left.stageId === right.stageId
    && left.stageRevision === right.stageRevision && left.baseLedgerRevision === right.baseLedgerRevision
    && left.deliveryTarget === right.deliveryTarget && left.workflowMode === right.workflowMode
    && left.workflowProtocol === right.workflowProtocol && left.chatIdentity === right.chatIdentity
    && left.anchorContentDigest === right.anchorContentDigest;
}

// 在 prepare 时冻结协议、资料和用户业务提示词，不进入旧导演执行链。
export function prepareWorldRoundRun_ACU(input: {
  identity: WorldSimulationRunIdentity_ACU;
  envelope: WorldSimulationEnvelope_ACU;
  anchor: WorldSimulationTargetAnchor_ACU;
  anchorBody: string;
  /** 与目标正文同轮实际送达的剧情推进文本；缺少时不从指令推测。 */
  historyDeliveryText?: string;
  tableData?: TableDataObject_ACU;
  signal: AbortSignal;
  invoke: WorldSimulationAgentInvoker_ACU;
  onProgress?: WorldRoundRunnerInput_ACU['onProgress'];
  confirmActorRegistration?: WorldRoundRunnerInput_ACU['confirmActorRegistration'];
  readCurrent(): WorldSimulationEnvelope_ACU | null;
  assertAnchorCurrent(): void;
  hasLegacyWrites: boolean;
  /** 本轮即时意图；只在当前 prepare 内冻结，不写入持久 schema。 */
  instruction?: string;
  /** 已经严格校验的长期要求；损坏快照必须由调用方在进入本 helper 前拒绝。 */
  userRequirements?: WorldSimulationUserRequirementsSnapshot_ACU;
  /** 已预取的已启用世界书快照；省略代表调用方未提供，而非空宿主快照。 */
  worldbookSnapshot?: AgentWorldbookSnapshot_ACU;
  /** 已持久化且经 prepare 重读材料构建验证的 v1 指纹。 */
  runMaterials?: WorldRunMaterials_ACU;
  countTokens?: WorldSimulationTokenCounter_ACU;
  now?: number;
}): { revision: ReturnType<typeof buildWorldRoundStageRevision_ACU>; execute(identity: WorldSimulationRunIdentity_ACU): Promise<WorldSimulationMainLoopResult_ACU> } {
  const frozenIdentity = structuredClone(input.identity);
  const frozenEnvelope = structuredClone(input.envelope);
  const frozenAnchor = structuredClone(input.anchor);
  const anchorBody = `${input.anchorBody}`;
  const frozenHistoryDeliveryText = typeof input.historyDeliveryText === 'string' ? input.historyDeliveryText : '';
  const frozenTableData = input.tableData === undefined ? undefined : structuredClone(input.tableData);
  const frozenInstruction = typeof input.instruction === 'string' ? input.instruction : '';
  const frozenUserRequirements = input.userRequirements === undefined ? undefined
    : structuredClone(validateWorldSimulationUserRequirementsSnapshot_ACU(input.userRequirements));
  const frozenWorldbookSnapshot = input.worldbookSnapshot === undefined ? undefined : structuredClone(input.worldbookSnapshot);
  const frozenRunMaterials = input.runMaterials === undefined ? undefined : structuredClone(input.runMaterials);
  if (frozenIdentity.workflowProtocol !== 'world-round-v1') throw new Error('WORLD_ROUND_PROTOCOL_INCOMPATIBLE');
  if (!frozenRunMaterials) throw new Error('WORLD_RUN_MATERIALS_MISSING');
  if (!frozenWorldbookSnapshot?.available) throw new Error('WORLD_RUN_MATERIALS_WORLDBOOK_UNAVAILABLE');
  if (!frozenEnvelope.task?.runMaterials || !sameWorldRunMaterials_ACU(frozenEnvelope.task.runMaterials, frozenRunMaterials)) {
    throw new Error('WORLD_RUN_MATERIALS_MISMATCH');
  }
  let calculatedMaterials: WorldRunMaterials_ACU;
  try {
    calculatedMaterials = buildWorldRunMaterials_ACU({
      instruction: frozenEnvelope.task.originInstruction,
      ...(frozenUserRequirements ? { userRequirements: frozenUserRequirements } : {}),
      worldbookSnapshot: frozenWorldbookSnapshot,
      worldRoundPrompts: frozenEnvelope.settings.worldRoundPrompts,
      workflowMode: frozenIdentity.workflowMode,
      deliveryTarget: frozenIdentity.deliveryTarget,
    });
  } catch {
    throw new Error('WORLD_RUN_MATERIALS_INPUT_INVALID');
  }
  if (!sameWorldRunMaterials_ACU(frozenRunMaterials, calculatedMaterials)) {
    throw new Error('WORLD_RUN_MATERIALS_MISMATCH');
  }
  if (frozenIdentity.deliveryTarget !== 'body' && frozenIdentity.deliveryTarget !== 'plot') throw new Error('WORLD_ROUND_DELIVERY_TARGET_BLOCKED');
  if (frozenIdentity.workflowMode !== 'single' && frozenIdentity.workflowMode !== 'layered') {
    throw new Error('WORLD_ROUND_WORKFLOW_MODE_INVALID');
  }
  if (!sameWorldSimulationTargetRef_ACU(worldSimulationRunTargetRef_ACU(frozenIdentity), worldSimulationTargetRef_ACU(frozenAnchor))) {
    throw new Error('WORLD_SIMULATION_ANCHOR_STALE');
  }
  if (input.hasLegacyWrites) throw new Error('WORLD_ROUND_LEGACY_STATE_MIXED');
  const activeStage = frozenEnvelope.stages.find(stage => stage.stageId === frozenIdentity.stageId);
  const resumed = frozenEnvelope.task?.status === 'paused'
    ? activeStage?.revisions.find(revision => revision.revision === frozenIdentity.stageRevision && revision.frozen)
    : undefined;
  const frozenRevision = structuredClone(resumed ?? buildWorldRoundStageRevision_ACU({
    revision: frozenIdentity.stageRevision, now: input.now, workflowMode: frozenIdentity.workflowMode,
  }));
  const settings = structuredClone(frozenEnvelope.settings);
  const ledger = structuredClone(frozenEnvelope.ledger);
  const ledgerFingerprint = canonical_ACU(ledger);
  const assertCurrent = (runIdentity: WorldSimulationRunIdentity_ACU): void => {
    if (input.signal.aborted) throw new Error('WORLD_SIMULATION_RUN_STALE');
    input.assertAnchorCurrent();
    const current = input.readCurrent();
    const active = current?.task?.activeRun;
    const stage = current?.stages.find(item => item.stageId === frozenIdentity.stageId);
    const stageRevision = stage?.revisions.find(item => item.revision === frozenRevision.revision);
    const persistedMaterials = current?.task?.runMaterials;
    if (!current || !active || current.task?.taskId !== frozenIdentity.taskId || current.task.status !== 'running'
      || !persistedMaterials || !sameWorldRunMaterials_ACU(persistedMaterials, frozenRunMaterials)
      || current.activeStageId !== frozenIdentity.stageId || stage?.status !== 'running'
      || stage.activeRevision !== frozenRevision.revision || !stageRevision?.frozen
      || !sameFrozenRun_ACU(active, frozenIdentity) || !sameFrozenRun_ACU(runIdentity, frozenIdentity)
      || current.ledger.revision !== frozenIdentity.baseLedgerRevision || canonical_ACU(current.ledger) !== ledgerFingerprint) {
      throw new Error('WORLD_SIMULATION_RUN_STALE');
    }
  };
  return {
    revision: structuredClone(frozenRevision),
    execute: async runIdentity => {
      const executionIdentity = structuredClone(runIdentity);
      assertCurrent(executionIdentity);
      const result = await runWorldRound_ACU({
        identity: executionIdentity,
        settings: structuredClone(settings),
        ledger: structuredClone(ledger),
        anchorText: anchorBody,
        historyDeliveryText: frozenHistoryDeliveryText,
        ...(frozenTableData === undefined ? {} : { tableData: structuredClone(frozenTableData) }),
        targetAnchor: structuredClone(frozenAnchor),
        instruction: frozenInstruction,
        ...(frozenUserRequirements ? { userRequirements: structuredClone(frozenUserRequirements) } : {}),
        ...(frozenWorldbookSnapshot ? { worldbookSnapshot: structuredClone(frozenWorldbookSnapshot) } : {}),
        signal: input.signal,
        invoke: input.invoke,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        ...(input.confirmActorRegistration ? { confirmActorRegistration: input.confirmActorRegistration } : {}),
        ...(input.countTokens ? { countTokens: input.countTokens } : {}),
        isCurrent: () => {
          try { assertCurrent(executionIdentity); return true; }
          catch { return false; }
        },
      });
      assertCurrent(executionIdentity);
      return {
        outcome: 'world_round', summary: result.summary, roundCandidate: result.roundCandidate, outcomes: [],
        finalProjection: { content: null, sourceAgent: 'world-round', sourceRevision: result.ledger.revision, deliverable: false },
        ...(result.reviewedProjection ? { reviewedProjection: structuredClone(result.reviewedProjection) } : {}),
        ...(result.bodyProjection ? { bodyProjection: result.bodyProjection } : {}),
        ...(result.reviewedReveal ? { reviewedReveal: result.reviewedReveal } : {}),
      };
    },
  };
}
