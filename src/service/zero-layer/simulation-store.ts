import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU, type ZeroLayerCarrierContext_ACU } from './carrier-context';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerSimulationState_ACU } from './model';
import { ZeroLayerStore_ACU } from './store';
import { buildZeroLayerTimeline_ACU, getPublishedZeroLayerPath_ACU, projectZeroLayerPromptHistory_ACU } from './timeline';
import { buildEmptyWorldChronicleArchiveSnapshot_ACU, validateWorldSimulationEnvelope_ACU } from '../simulation/simulation-store';
import { seedLedgerFieldView_ACU } from '../simulation/simulation-ledger-fold';
import { emptyWorldSimulationUserRequirementsSnapshot_ACU } from '../simulation/agent/agent-user-requirements';
import { buildZeroLayerSimulationEffect_ACU } from './simulation-result';
import { validateZeroLayerSimulationReceipt_ACU } from './simulation-validation';
import type { WorldSimulationLogicalAnchorIdentity_ACU, WorldSimulationTargetAnchor_ACU } from '../simulation/agent/agent-model';
import type { WorldSimulationEnvelope_ACU, WorldSimulationRunIdentity_ACU } from '../simulation/model';
import type { WorldSimulationStorePort_ACU } from '../simulation/simulation-orchestrator';
import { readCheckpointSimulationView_ACU } from './checkpoint-materials';

export function emptyZeroLayerSimulation_ACU(): ZeroLayerSimulationState_ACU {
  return { schemaVersion: 1, envelope: null, fields: { records: {} },
    archive: buildEmptyWorldChronicleArchiveSnapshot_ACU(),
    conversation: { schemaVersion: 1, segments: [], updatedAt: 0 },
    userRequirements: emptyWorldSimulationUserRequirementsSnapshot_ACU(),
    runState: null, runProof: null, confirmed: [] };
}

/** 固定会话/分支的权威存储；不缓存候选，不借用普通模式私有字段。 */
export class ZeroLayerSimulationStore_ACU implements WorldSimulationStorePort_ACU {
  readonly context: ZeroLayerCarrierContext_ACU;
  readonly sessionId: string;
  readonly branchId: string;
  constructor(readonly store = new ZeroLayerStore_ACU()) {
    this.context = captureZeroLayerCarrier_ACU();
    const source = store.readSnapshot();
    if (!source?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '逻辑推演需要已启用的 carrier。');
    this.sessionId = source.sessionId;
    this.branchId = source.activeBranchId;
  }
  readSource(): ZeroLayerEnvelope_ACU {
    assertZeroLayerCarrier_ACU(this.context);
    const source = this.store.readSnapshot();
    if (!source?.enabled || source.sessionId !== this.sessionId || source.activeBranchId !== this.branchId) {
      throw new ZeroLayerError_ACU('scope-changed', '推演所属会话或分支已变化。');
    }
    return source;
  }
  getChatIdentity(): string {
    return JSON.stringify(['zero-layer-simulation', this.context.key, this.sessionId, this.branchId]);
  }
  readState(): ZeroLayerSimulationState_ACU {
    return this.readSource().branches.find(branch => branch.branchId === this.branchId)!.simulation ?? emptyZeroLayerSimulation_ACU();
  }
  read(): WorldSimulationEnvelope_ACU | null { return this.readState().envelope; }

  async updateState(
    mutator: (state: ZeroLayerSimulationState_ACU, source: ZeroLayerEnvelope_ACU) => void,
    effect?: Parameters<ZeroLayerStore_ACU['updateSimulation']>[3],
  ): Promise<void> {
    this.readSource();
    await this.store.updateSimulation(this.sessionId, this.branchId, source => {
      assertZeroLayerCarrier_ACU(this.context);
      const branch = source.branches.find(item => item.branchId === this.branchId)!;
      branch.simulation ??= emptyZeroLayerSimulation_ACU();
      mutator(branch.simulation, source);
      return source;
    }, effect);
  }
  async updateAtomically(
    mutator: (current: WorldSimulationEnvelope_ACU | null) => WorldSimulationEnvelope_ACU,
    guard?: Parameters<WorldSimulationStorePort_ACU['updateAtomically']>[1],
  ): Promise<void> {
    await this.updateState(state => {
      const current = state.envelope;
      const stage = current?.stages.find(item => item.stageId === current.activeStageId);
      if (guard && (guard.chatIdentity !== this.getChatIdentity()
        || guard.taskId !== undefined && guard.taskId !== (current?.task?.taskId ?? null)
        || guard.stageId !== undefined && guard.stageId !== (current?.activeStageId ?? null)
        || guard.revision !== undefined && guard.revision !== (stage?.activeRevision ?? null))) {
        throw new ZeroLayerError_ACU('revision-conflict', '推演任务或阶段守卫不匹配。');
      }
      const next = validateWorldSimulationEnvelope_ACU(mutator(structuredClone(current)), 'persist');
      if (current && JSON.stringify(current.ledger) !== JSON.stringify(next.ledger)) {
        throw new ZeroLayerError_ACU('invalid-transition', '账本更新必须通过推演联合提交写口。');
      }
      if (!current) state.fields = seedLedgerFieldView_ACU(next.ledger, next.updatedAt);
      const run = next.task?.activeRun;
      if (state.runState && (!run || state.runState.taskId !== run.taskId
        || state.runState.cursorKey !== `${run.stageId}#${run.stageRevision}#${run.baseLedgerRevision}`)) state.runState = null;
      state.envelope = next;
      const completed = next.task?.completedAutoAnchor;
      if (current?.task?.activeRun?.triggerKind === 'assistant_completed'
        && next.task?.status === 'completed' && completed?.kind === 'logical') {
        const turn = this.readSource().turns.find(item => item.turnId === completed.logicalRef.turnId)!;
        if (turn.phase === 'response-durable' && !turn.effectReceipts.some(item => item.kind === 'simulation')) {
          state.confirmed.push({ ref: structuredClone(completed.logicalRef), ledgerRevision: next.ledger.revision });
        }
      }
    }, candidate => {
      const state = candidate.branches.find(branch => branch.branchId === this.branchId)!.simulation!;
      const completed = state.envelope?.task?.completedAutoAnchor;
      if (state.envelope?.task?.status !== 'completed' || completed?.kind !== 'logical'
        || state.envelope.task.taskId !== guard?.taskId) return undefined;
      const turn = candidate.turns.find(item => item.turnId === completed.logicalRef.turnId)!;
      if (turn.phase !== 'response-durable' || turn.effectReceipts.some(item => item.kind === 'simulation')) return undefined;
      return buildZeroLayerSimulationEffect_ACU(state, completed, 'no_change',
        state.envelope.timeline[state.envelope.timeline.length - 1]?.message ?? '世界推演无变化');
    });
  }
  async skipAutomatic(anchor: WorldSimulationLogicalAnchorIdentity_ACU): Promise<void> {
    this.assertAnchor(anchor);
    const state = this.readState();
    const turn = this.readSource().turns.find(item => item.turnId === anchor.logicalRef.turnId)!;
    if (turn.effectReceipts.some(item => item.kind === 'simulation')) {
      validateZeroLayerSimulationReceipt_ACU(turn, this.sessionId);
      return;
    }
    await this.updateState(() => {}, buildZeroLayerSimulationEffect_ACU(state, anchor, 'skipped-by-config', '自动推演已关闭'));
  }
  anchorForTurn(turnId: string, source = this.readSource()): WorldSimulationLogicalAnchorIdentity_ACU {
    const turn = source.turns.find(item => item.turnId === turnId && (item.branchId === this.branchId
      || getPublishedZeroLayerPath_ACU(source).some(published => published.turnId === item.turnId)));
    if (!turn?.body?.trim() || !['response-durable', 'effects-durable', 'published'].includes(turn.phase)) {
      throw new ZeroLayerError_ACU('effects-pending', '推演锚点缺少已保存的逻辑正文。');
    }
    return { kind: 'logical', chatIdentity: this.getChatIdentity(), contentDigest: sha256HexSync_ACU(turn.body),
      logicalRef: { sessionId: this.sessionId, branchId: turn.branchId, turnId: turn.turnId,
        attemptId: turn.attemptId, floorId: turn.assistantFloor.floorId } };
  }
  assertAnchor(anchor: WorldSimulationTargetAnchor_ACU, source = this.readSource()): asserts anchor is WorldSimulationLogicalAnchorIdentity_ACU {
    if (!('logicalRef' in anchor) || anchor.kind !== 'logical' || anchor.chatIdentity !== this.getChatIdentity()) {
      throw new ZeroLayerError_ACU('scope-changed', '逻辑推演不接受宿主锚点或其他会话。');
    }
    const actual = this.anchorForTurn(anchor.logicalRef.turnId, source);
    if (actual.contentDigest !== anchor.contentDigest || !(['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const)
      .every(key => actual.logicalRef[key] === anchor.logicalRef[key])) {
      throw new ZeroLayerError_ACU('revision-conflict', '推演逻辑锚点已变化。');
    }
    const turn = source.turns.find(item => item.turnId === anchor.logicalRef.turnId)!;
    const path = getPublishedZeroLayerPath_ACU(source);
    const head = source.branches.find(item => item.branchId === this.branchId)!.headTurnId;
    if (turn.phase === 'published' ? !path.some(item => item.turnId === turn.turnId) : turn.parentTurnId !== head) {
      throw new ZeroLayerError_ACU('revision-conflict', '推演锚点不属于当前逻辑历史。');
    }
  }
  restoreAnchor(identity: WorldSimulationRunIdentity_ACU): WorldSimulationLogicalAnchorIdentity_ACU {
    if (identity.kind !== 'logical') throw new ZeroLayerError_ACU('corrupt-data', '逻辑推演不能恢复宿主运行。');
    const anchor: WorldSimulationLogicalAnchorIdentity_ACU = { kind: 'logical', chatIdentity: identity.chatIdentity,
      logicalRef: structuredClone(identity.logicalRef), contentDigest: identity.anchorContentDigest };
    this.assertAnchor(anchor);
    return anchor;
  }
  latestAnchor(): WorldSimulationLogicalAnchorIdentity_ACU | null {
    const source = this.readSource();
    const head = source.branches.find(item => item.branchId === this.branchId)!.headTurnId;
    return head ? this.anchorForTurn(head, source) : null;
  }
  readChat(anchor: WorldSimulationLogicalAnchorIdentity_ACU): any[] {
    const source = this.readSource();
    this.assertAnchor(anchor, source);
    const timeline = buildZeroLayerTimeline_ACU(source, this.context.chat as Record<string, unknown>[]);
    const turn = source.turns.find(item => item.turnId === anchor.logicalRef.turnId)!;
    const index = timeline.floors.findIndex(floor => floor.ref.kind === 'logical' && floor.ref.floorId === anchor.logicalRef.floorId);
    if (index >= 0) return projectZeroLayerPromptHistory_ACU({ ...timeline, floors: timeline.floors.slice(0, index + 1) });
    return [...projectZeroLayerPromptHistory_ACU(timeline, turn.input), { mes: turn.body, is_user: false, is_system: false }];
  }
  readView() {
    const source = this.readSource();
    const state = this.readState();
    if (!state.envelope) throw new ZeroLayerError_ACU('effects-pending', '逻辑推演账本尚未建立。');
    const view = readCheckpointSimulationView_ACU(source, state);
    if (!view.ledger) throw new ZeroLayerError_ACU('corrupt-data', '推演基线回放缺少账本。');
    return { ...view, ledger: view.ledger };
  }
}
