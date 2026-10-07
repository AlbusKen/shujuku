import {
  HostChatSaveNotStartedError_ACU, readChatFromHostStrict_ACU, saveChatToHostStrict_ACU,
} from '../../data/gateways/chat-gateway';
import {
  assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU, physicalHistoryFingerprint_ACU,
  physicalHistorySnapshot_ACU, readZeroLayerCarrier_ACU, type ZeroLayerCarrierContext_ACU,
  isolateZeroLayerCarrierCandidate_ACU, readZeroLayerCarrierCandidate_ACU,
} from './carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from './model';
import { notifyZeroLayerChanges_ACU } from './notifications';
import { validateZeroLayerEnvelope_ACU, validateZeroLayerContinuationReceipt_ACU } from './validation';
import type { ContinuationLogicalRef_ACU } from '../continuation/model';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { applyZeroLayerCommand_ACU, mergeZeroLayerEffectReceipt_ACU, type ZeroLayerCommand_ACU } from './store-command';
import { assertBridgeSource_ACU } from './bridge-source';
import { assertBridgeConfig_ACU } from './bridge-config';
import type { ZeroLayerExitSelection_ACU, ZeroLayerExitAssignment_ACU } from './exit-model';
import { buildZeroLayerExitCandidate_ACU } from './exit-candidate';
import { applyExitAssignments_ACU, exitAssignmentsMatch_ACU } from './exit-fields';
import { requireExit_ACU } from './exit-source';
import { pendingZeroLayerPersistence_ACU, type PendingZeroLayerPersistence_ACU } from './persistence-state';

type PendingPersistence_ACU = PendingZeroLayerPersistence_ACU;

/** 单实例链路的串行写口，不承诺宿主 CAS 或跨标签事务。 */
export class ZeroLayerStore_ACU {
  private static tails = new Map<string, Promise<void>>();
  private static unknown = pendingZeroLayerPersistence_ACU;
  private static operationBlocks = new WeakMap<ZeroLayerCarrierContext_ACU['carrier'], Set<symbol>>();

  /** 只阻断新操作，不阻断旧租约收尾和显式存档回读。 */
  blockOperations(): () => void {
    const { carrier } = captureZeroLayerCarrier_ACU();
    const blocks = ZeroLayerStore_ACU.operationBlocks.get(carrier) ?? new Set<symbol>();
    const token = Symbol();
    blocks.add(token);
    ZeroLayerStore_ACU.operationBlocks.set(carrier, blocks);
    return () => {
      blocks.delete(token);
      if (!blocks.size && ZeroLayerStore_ACU.operationBlocks.get(carrier) === blocks) {
        ZeroLayerStore_ACU.operationBlocks.delete(carrier);
      }
    };
  }

  assertCanOperate(): void {
    const { carrier } = captureZeroLayerCarrier_ACU();
    if (ZeroLayerStore_ACU.operationBlocks.get(carrier)?.size) {
      throw new ZeroLayerError_ACU('mode-disabled', '零层关闭尚未确认，请显式回读存档或再次关闭，禁止启动新操作。');
    }
  }

  /** 同步派生读取；保存未知仍必须先恢复，不能把已回滚的内存当权威状态。 */
  readSnapshot(): ZeroLayerEnvelope_ACU | null {
    const context = captureZeroLayerCarrier_ACU();
    if (ZeroLayerStore_ACU.unknown.has(context.key)) {
      throw new ZeroLayerError_ACU('persist-unknown', '零层保存结果未知，请先回读恢复。');
    }
    return readZeroLayerCarrier_ACU(context);
  }

  async read(): Promise<ZeroLayerEnvelope_ACU | null> {
    const context = captureZeroLayerCarrier_ACU();
    return this.enqueue(context, async () => {
      if (ZeroLayerStore_ACU.unknown.has(context.key)) {
        throw new ZeroLayerError_ACU('persist-unknown', '上次保存尚未确认，请先回读恢复。');
      }
      const current = readZeroLayerCarrier_ACU(context);
      await this.verifySource(context, current);
      if (!sameEnvelope_ACU(readZeroLayerCarrier_ACU(context), current)) {
        throw new ZeroLayerError_ACU('revision-conflict', '读取期间载体存档已变化。');
      }
      return current;
    });
  }

  commit(command: ZeroLayerCommand_ACU, expectedRevision: number | null): Promise<ZeroLayerEnvelope_ACU> {
    const context = captureZeroLayerCarrier_ACU();
    const snapshot = structuredClone(command);
    return this.enqueue(context, async () => {
      if (ZeroLayerStore_ACU.unknown.has(context.key)) {
        throw new ZeroLayerError_ACU('persist-unknown', '保存结果未知，禁止追加或重试提交。');
      }
      const current = readZeroLayerCarrier_ACU(context);
      if (current?.exitManifest) {
        throw new ZeroLayerError_ACU('mode-disabled', '退出 journal 已冻结零层历史，请使用显式退出恢复，不能重启或改写归档。');
      }
      if ((current?.revision ?? null) !== expectedRevision) {
        throw new ZeroLayerError_ACU('revision-conflict', '零层 revision 已变化，请重新读取。');
      }
      const fingerprint = await this.verifySource(context, current);
      const candidate = applyZeroLayerCommand_ACU(current, snapshot, context, fingerprint);
      return this.persist(context, current, candidate);
    });
  }

  /** 显式选择原 FloorRef；意图与完整候选均在同一 carrier 写队列内确认。 */
  exitToOrdinary(selection: ZeroLayerExitSelection_ACU, assertLease: () => void = () => {}): Promise<ZeroLayerEnvelope_ACU> {
    assertLease();
    const context = captureZeroLayerCarrier_ACU();
    const selected = structuredClone(selection);
    return this.enqueue(context, async () => {
      if (ZeroLayerStore_ACU.unknown.has(context.key)) {
        throw new ZeroLayerError_ACU('persist-unknown', '退出保存尚未确认，请先显式回读，禁止重复提交。');
      }
      const current = readZeroLayerCarrier_ACU(context);
      requireExit_ACU(current, '退出缺少已保存的零层载体。');
      await this.verifySource(context, current);
      const manifest = await buildZeroLayerExitCandidate_ACU(current,
        context.chat as Record<string, unknown>[], selected);
      assertLease();
      assertZeroLayerCarrier_ACU(context);
      assertBridgeConfig_ACU(context.chat, manifest.configFingerprint);
      requireExit_ACU(exitAssignmentsMatch_ACU(context.chat as Record<string, unknown>[], manifest.assignments, 'before'),
        '退出候选回放期间普通字段已变化。');
      const prepared = validateZeroLayerEnvelope_ACU({ ...current, revision: current.revision + 1, exitManifest: manifest });
      await this.persist(context, current, prepared);
      assertLease();
      return this.finishExitWithinQueue(context, prepared, assertLease);
    });
  }

  /** 先回读未知结果；只有已保存的意图才可继续，不重发任何模型请求。 */
  async recoverExit(assertLease: () => void = () => {}): Promise<ZeroLayerEnvelope_ACU> {
    assertLease();
    const recovered = await this.recover();
    assertLease();
    requireExit_ACU(recovered?.exitManifest, '服务器没有可续接的退出意图。');
    if (recovered.exitManifest.phase === 'committed') return recovered;
    const context = captureZeroLayerCarrier_ACU();
    return this.enqueue(context, async () => {
      if (ZeroLayerStore_ACU.unknown.has(context.key)) {
        throw new ZeroLayerError_ACU('persist-unknown', '回读后又出现未知保存，禁止推进退出。');
      }
      const current = readZeroLayerCarrier_ACU(context);
      requireExit_ACU(sameEnvelope_ACU(current, recovered), '退出回读后载体已变化。');
      return this.finishExitWithinQueue(context, recovered, assertLease);
    });
  }

  private async finishExitWithinQueue(context: ZeroLayerCarrierContext_ACU,
    prepared: ZeroLayerEnvelope_ACU, assertLease: () => void): Promise<ZeroLayerEnvelope_ACU> {
    assertLease();
    const journal = prepared.exitManifest;
    requireExit_ACU(journal?.phase === 'prepared' && !prepared.enabled, '退出缺少已确认的 prepared 意图。');
    await this.verifySource(context, prepared);
    assertLease();
    assertBridgeConfig_ACU(context.chat, journal.configFingerprint);
    requireExit_ACU(exitAssignmentsMatch_ACU(context.chat as Record<string, unknown>[], journal.assignments, 'before'),
      '退出意图的普通来源已变化。');
    const candidate = validateZeroLayerEnvelope_ACU({ ...prepared, revision: prepared.revision + 1,
      exitManifest: { ...journal, phase: 'committed' } });
    return this.persist(context, prepared, candidate, { values: journal.assignments, beforeSide: 'before' });
  }

  /** 同一零层写队列内更新分支续写状态；不授予调用者改写正文或其他效果的权限。 */
  updateContinuation(
    sessionId: string, branchId: string,
    mutator: (current: ZeroLayerEnvelope_ACU) => ZeroLayerEnvelope_ACU,
    confirmation?: ContinuationLogicalRef_ACU,
  ): Promise<ZeroLayerEnvelope_ACU> {
    const context = captureZeroLayerCarrier_ACU();
    const ref = confirmation ? structuredClone(confirmation) : undefined;
    return this.enqueue(context, async () => {
      if (ZeroLayerStore_ACU.unknown.has(context.key)) {
        throw new ZeroLayerError_ACU('persist-unknown', '续写保存结果未知，请先回读恢复。');
      }
      const current = readZeroLayerCarrier_ACU(context);
      if (!current?.enabled || current.sessionId !== sessionId || current.activeBranchId !== branchId) {
        throw new ZeroLayerError_ACU('scope-changed', '续写所属零层会话或分支已变化。');
      }
      const checkpoints = current.branches.find(branch => branch.branchId === branchId)!.checkpoints;
      if (checkpoints?.pending || checkpoints?.cleanupPending) {
        throw new ZeroLayerError_ACU('effects-pending', 'checkpoint 提交尚未收尾，禁止修改续写来源。');
      }
      await this.verifySource(context, current);
      let base = current;
      let alreadyConfirmed = false;
      if (ref) {
        const turn = current.turns.find(item => item.turnId === ref.turnId && item.attemptId === ref.attemptId);
        if (ref.sessionId !== sessionId || ref.branchId !== branchId
          || !turn?.continuationIdentity || turn.branchId !== branchId
          || turn.assistantFloor.floorId !== ref.floorId
          || !['response-durable', 'effects-durable', 'published'].includes(turn.phase)) {
          throw new ZeroLayerError_ACU('revision-conflict', '联合确认缺少本分支已保存的逻辑正文。');
        }
        const state = current.branches.find(branch => branch.branchId === branchId)!.continuation;
        alreadyConfirmed = !!state?.confirmed.some(item => item.turnId === ref.turnId);
        if (alreadyConfirmed) {
          validateZeroLayerContinuationReceipt_ACU(turn, sessionId);
        } else {
          const identity = turn.continuationIdentity;
          const pending = state?.envelope?.activeTask?.pendingHostTurn;
          const capturedRef = pending?.capture.logicalRef;
          if (turn.phase !== 'response-durable' || state?.envelope?.activeTask?.status !== 'running'
            || pending?.status !== 'awaiting_generation'
            || identity.chatIdentity !== JSON.stringify(['zero-layer-continuation', context.key, sessionId, branchId])
            || !(['chatIdentity', 'taskId', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId'] as const)
              .every(key => pending.identity[key] === identity[key])
            || !capturedRef || !(['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const)
              .every(key => capturedRef[key] === ref[key])
            || turn.effectReceipts.some(item => item.kind === 'continuation')) {
            throw new ZeroLayerError_ACU('revision-conflict', '联合确认不属于当前续写等待轮。');
          }
          const result = { floorId: ref.floorId, identity };
          // 仅组合内存候选；游标、通告与回执通过最终的一次 carrier 保存提交。
          base = applyZeroLayerCommand_ACU(current, {
            type: 'record-effect', turnId: turn.turnId, attemptId: turn.attemptId,
            receipt: { effectId: JSON.stringify([sessionId, turn.turnId, turn.attemptId, 'continuation']),
              kind: 'continuation', status: 'durable', fingerprint: getTableDataFingerprint_ACU(result) },
            assistantData: { continuation: result },
          }, context, current.activationFingerprint);
        }
      }
      const candidate = validateZeroLayerEnvelope_ACU(mutator(structuredClone(base)));
      const strip = (value: ZeroLayerEnvelope_ACU) => {
        const copy = structuredClone(value);
        delete copy.branches.find(branch => branch.branchId === branchId)!.continuation;
        return copy;
      };
      if (!sameEnvelope_ACU(strip(base), strip(candidate))) {
        throw new ZeroLayerError_ACU('invalid-transition', '续写写口只能更新当前分支的续写状态。');
      }
      const beforeFrames = base.branches.find(branch => branch.branchId === branchId)!.continuation?.moduleFrames ?? {};
      const afterFrames = candidate.branches.find(branch => branch.branchId === branchId)!.continuation?.moduleFrames ?? {};
      if (getTableDataFingerprint_ACU(beforeFrames) !== getTableDataFingerprint_ACU(afterFrames)) {
        throw new ZeroLayerError_ACU('invalid-transition', '续写规划只能更新分支工作帧，不能覆盖已封存或共享前缀资料帧。');
      }

      if (ref) {
        const state = candidate.branches.find(branch => branch.branchId === branchId)!.continuation;
        if (!state?.confirmed.some(item => item.turnId === ref.turnId)
          || (!alreadyConfirmed && state.envelope?.activeTask?.pendingHostTurn != null)) {
          throw new ZeroLayerError_ACU('invalid-transition', '联合确认必须同时保存确认引用并结束等待轮。');
        }
        if (alreadyConfirmed && !sameEnvelope_ACU(current, candidate)) {
          throw new ZeroLayerError_ACU('invalid-transition', '重复确认不能再次推进续写状态。');
        }
        return this.persist(context, current, candidate);
      }
      if (sameEnvelope_ACU(current, candidate)) return current;
      candidate.revision += 1;
      return this.persist(context, current, validateZeroLayerEnvelope_ACU(candidate));
    });
  }

  /** 推演只拥有当前分支的独立状态；沿用严格保存、回读与保存未知门禁。 */
  updateSimulation(
    sessionId: string, branchId: string,
    mutator: (current: ZeroLayerEnvelope_ACU) => ZeroLayerEnvelope_ACU,
    effect?: Extract<ZeroLayerCommand_ACU, { type: 'record-effect' }>
      | ((candidate: ZeroLayerEnvelope_ACU) => Extract<ZeroLayerCommand_ACU, { type: 'record-effect' }> | undefined),
  ): Promise<ZeroLayerEnvelope_ACU> {
    const context = captureZeroLayerCarrier_ACU();
    return this.enqueue(context, async () => {
      if (ZeroLayerStore_ACU.unknown.has(context.key)) {
        throw new ZeroLayerError_ACU('persist-unknown', '推演保存结果未知，请先回读恢复。');
      }
      const current = readZeroLayerCarrier_ACU(context);
      if (!current?.enabled || current.sessionId !== sessionId || current.activeBranchId !== branchId) {
        throw new ZeroLayerError_ACU('scope-changed', '推演所属零层会话或分支已变化。');
      }
      const checkpoints = current.branches.find(branch => branch.branchId === branchId)!.checkpoints;
      if (checkpoints?.pending || checkpoints?.cleanupPending) {
        throw new ZeroLayerError_ACU('effects-pending', 'checkpoint 提交尚未收尾，禁止修改推演来源。');
      }
      await this.verifySource(context, current);
      const candidate = mutator(structuredClone(current));
      const strip = (value: ZeroLayerEnvelope_ACU) => {
        const copy = structuredClone(value);
        delete copy.branches.find(branch => branch.branchId === branchId)!.simulation;
        return copy;
      };
      if (!sameEnvelope_ACU(strip(current), strip(candidate))) {
        throw new ZeroLayerError_ACU('invalid-transition', '推演写口只能更新当前分支的推演状态。');
      }
      const receipt = typeof effect === 'function' ? effect(structuredClone(candidate)) : effect;
      if (receipt) {
        if (receipt.receipt.kind !== 'simulation' || receipt.userData !== undefined
          || !receipt.assistantData || Object.keys(receipt.assistantData).some(key => key !== 'simulation')) {
          throw new ZeroLayerError_ACU('invalid-transition', '推演联合提交只允许本轮推演回执。');
        }
        const repeated = current.turns.find(turn => turn.turnId === receipt.turnId)?.effectReceipts
          .some(item => item.kind === 'simulation');
        if (repeated && !sameEnvelope_ACU(current, candidate)) {
          throw new ZeroLayerError_ACU('invalid-transition', '重复推演确认不能再次推进分支状态。');
        }
        const turn = candidate.turns.find(item => item.turnId === receipt.turnId && item.branchId === branchId);
        if (!turn) throw new ZeroLayerError_ACU('revision-conflict', '推演回执不属于当前分支。');
        const changed = mergeZeroLayerEffectReceipt_ACU(turn, structuredClone(receipt));
        if (!changed && sameEnvelope_ACU(current, candidate)) return current;
        candidate.revision += 1;
        return this.persist(context, current, validateZeroLayerEnvelope_ACU(candidate));
      }
      if (sameEnvelope_ACU(current, candidate)) return current;
      candidate.revision += 1;
      return this.persist(context, current, validateZeroLayerEnvelope_ACU(candidate));
    });
  }

  private async verifySource(context: ZeroLayerCarrierContext_ACU, current: ZeroLayerEnvelope_ACU | null): Promise<string> {
    const source = current?.exitManifest?.phase === 'committed'
      ? physicalHistorySnapshot_ACU(context.chat.slice(0, current.activationMessageCount)) : context.source;
    const fingerprint = await physicalHistoryFingerprint_ACU(source);
    assertZeroLayerCarrier_ACU(context);
    if (current && current.activationFingerprint !== fingerprint) {
      throw new ZeroLayerError_ACU('source-changed', '零层启用时的物理源历史指纹已变化。');
    }
    const bridge = current?.branches.find(branch => branch.branchId === current.activeBranchId)?.bridge;
    if (bridge && bridge.phase !== 'reconciled') {
      assertBridgeSource_ACU(context.chat, bridge.sourceFingerprint);
      assertBridgeConfig_ACU(context.chat, bridge.configFingerprint);
    }
    return fingerprint;
  }

  /** 设置展示专用服务器快照；不替换本地字段、不通知、不解除未知保存。 */
  readPersistedSnapshot(): Promise<ZeroLayerEnvelope_ACU | null> {
    const context = captureZeroLayerCarrier_ACU();
    return this.enqueue(context, async () => {
      const assertKnown = () => {
        if (ZeroLayerStore_ACU.unknown.has(context.key)) {
          throw new ZeroLayerError_ACU('persist-unknown', '保存结果未知，请使用显式恢复；状态读取不能解除门禁。');
        }
      };
      assertKnown();
      const beforeRaw = context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU];
      const before = structuredClone(readZeroLayerCarrier_ACU(context));
      const messages = await readChatFromHostStrict_ACU();
      assertZeroLayerCarrier_ACU(context);
      assertKnown();
      if (physicalHistorySnapshot_ACU(messages) !== context.source) {
        throw new ZeroLayerError_ACU('source-changed', '服务器物理历史与当前聊天不一致，不能显示为默认关闭。');
      }
      const persisted = readZeroLayerCarrier_ACU({ ...context, chat: messages,
        carrier: messages[context.carrierIndex] });
      await this.verifySource(context, persisted);
      assertKnown();
      if (context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] !== beforeRaw
        || !sameEnvelope_ACU(readZeroLayerCarrier_ACU(context), before)) {
        throw new ZeroLayerError_ACU('revision-conflict', '状态读取期间本地载体已变化，请重新读取。');
      }
      return structuredClone(persisted);
    });
  }

  /** 普通生命周期回读服务器权威快照；无权解除未知保存门禁。 */
  readPersisted(): Promise<ZeroLayerEnvelope_ACU | null> {
    return this.loadPersisted(false);
  }

  /** 保存未知后只回读；不重发模型、不盲目回滚服务器。 */
  recover(): Promise<ZeroLayerEnvelope_ACU | null> {
    return this.loadPersisted(true);
  }

  private loadPersisted(resolveUnknown: boolean): Promise<ZeroLayerEnvelope_ACU | null> {
    const context = captureZeroLayerCarrier_ACU();
    return this.enqueue(context, async () => {
      const pending = ZeroLayerStore_ACU.unknown.get(context.key);
      // 检查与回读共用写队列，不能由队列外的先读绕过新出现的未知保存。
      if (pending && !resolveUnknown) {
        throw new ZeroLayerError_ACU('persist-unknown', '上次保存尚未确认，启停不能代替显式恢复。');
      }
      const beforeRaw = context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU];
      const messages = await readChatFromHostStrict_ACU();
      assertZeroLayerCarrier_ACU(context);
      if (physicalHistorySnapshot_ACU(messages) !== context.source
        || (pending && pending.source !== context.source)) {
        throw new ZeroLayerError_ACU('source-changed', '服务器物理历史与当前载体不一致，拒绝恢复写入。');
      }
      const carrier = messages[context.carrierIndex];
      const persisted = readZeroLayerCarrier_ACU({ ...context, chat: messages, carrier });
      const persistedBridge = persisted?.branches.find(branch => branch.branchId === persisted.activeBranchId)?.bridge;
      const pendingBridge = pending?.candidate.branches.find(branch => branch.branchId === pending.candidate.activeBranchId)?.bridge;
      const previousBridge = pending?.before?.branches.find(branch => branch.branchId === pending.before!.activeBranchId)?.bridge;
      const recoveringMigration = pendingBridge && (pendingBridge.phase !== 'reconciled'
        || previousBridge?.phase !== 'reconciled' || pending!.candidate.enabled && !pending!.before?.enabled);
      const bridge = recoveringMigration ? pendingBridge : persistedBridge?.phase !== 'reconciled' ? persistedBridge : undefined;
      if (bridge) {
        // 不替换 chat[] 或旧字段；服务器与本地必须各自匹配冻结来源，才能清除未知保存状态。
        assertBridgeSource_ACU(messages, bridge.sourceFingerprint);
        assertBridgeSource_ACU(context.chat, bridge.sourceFingerprint);
        assertBridgeConfig_ACU(messages, bridge.configFingerprint);
        assertBridgeConfig_ACU(context.chat, bridge.configFingerprint);
      }
      await this.verifySource(context, persisted);
      if (context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] !== beforeRaw) {
        throw new ZeroLayerError_ACU('revision-conflict', '回读期间载体存档已变化。');
      }
      if (pending && !sameEnvelope_ACU(persisted, pending.candidate)
        && !sameEnvelope_ACU(persisted, pending.before)) {
        throw new ZeroLayerError_ACU('revision-conflict', '服务器存档既不是原快照也不是本次候选，需人工确认。');
      }
      const journal = pending?.candidate.exitManifest ?? persisted?.exitManifest;
      if (journal) {
        const chat = context.chat as Record<string, unknown>[];
        const localBefore = exitAssignmentsMatch_ACU(chat, journal.assignments, 'before');
        const localAfter = exitAssignmentsMatch_ACU(chat, journal.assignments, 'after');
        if (pending?.assignments) {
          const side = sameEnvelope_ACU(persisted, pending.candidate) ? 'after' : pending.assignments.beforeSide;
          requireExit_ACU(exitAssignmentsMatch_ACU(messages, journal.assignments, side)
            && (localBefore || localAfter), '退出保存回读不是完整旧状态或完整候选。');
          applyExitAssignments_ACU(chat, journal.assignments, side);
        } else if (persisted?.exitManifest?.phase === 'prepared') {
          requireExit_ACU(exitAssignmentsMatch_ACU(messages, journal.assignments, 'before') && localBefore,
            '退出意图的普通来源已变化。');
        } else if (persisted?.exitManifest?.phase === 'committed') {
          // 已有普通后缀时基线允许沿普通写口演化，不能把旧 assignments 再写回。
          requireExit_ACU(pending ? exitAssignmentsMatch_ACU(messages, journal.assignments, 'after') && localAfter
            : JSON.stringify(messages) === JSON.stringify(context.chat), '退出存档回读与当前完整聊天不一致。');
        } else {
          requireExit_ACU(exitAssignmentsMatch_ACU(messages, journal.assignments, 'before') && localBefore,
            '退出意图未保存，但普通来源已变化。');
        }
      }
      if (persisted === null) delete context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU];
      else context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = structuredClone(persisted);
      if (resolveUnknown) ZeroLayerStore_ACU.unknown.delete(context.key);
      if (persisted) notifyZeroLayerChanges_ACU(null, persisted, 'snapshot');
      return persisted;
    });
  }

  private async persist(
    context: ZeroLayerCarrierContext_ACU,
    before: ZeroLayerEnvelope_ACU | null,
    candidate: ZeroLayerEnvelope_ACU,
    assignments?: PendingPersistence_ACU['assignments'],
  ): Promise<ZeroLayerEnvelope_ACU> {
    assertZeroLayerCarrier_ACU(context);
    const chat = context.chat as Record<string, unknown>[];
    const journal = candidate.exitManifest;
    const verifyExit = (side: 'before' | 'after') => {
      if (!journal) return;
      assertBridgeConfig_ACU(context.chat, journal.configFingerprint);
      requireExit_ACU(exitAssignmentsMatch_ACU(chat, journal.assignments, side), '退出保存字段与冻结写集不一致。');
    };
    verifyExit(assignments?.beforeSide ?? (journal?.phase === 'committed' ? 'after' : 'before'));
    if (!sameEnvelope_ACU(readZeroLayerCarrier_ACU(context), before)) {
      throw new ZeroLayerError_ACU('revision-conflict', '保存前载体存档已变化。');
    }
    if (sameEnvelope_ACU(before, candidate)) return structuredClone(candidate);
    const bridge = candidate.branches.find(branch => branch.branchId === candidate.activeBranchId)?.bridge;
    const previousBridge = before?.branches.find(branch => branch.branchId === before.activeBranchId)?.bridge;
    // Reconcile 和首次启用的保存窗口同样受保护；正常逻辑工作不重新读取旧基底。
    const verifyBridge = () => {
      if (bridge && (bridge.phase !== 'reconciled' || previousBridge?.phase !== 'reconciled'
        || candidate.enabled && !before?.enabled)) {
        assertBridgeSource_ACU(context.chat, bridge.sourceFingerprint);
        assertBridgeConfig_ACU(context.chat, bridge.configFingerprint);
      }
    };
    verifyBridge();
    const previousRaw = context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU];
    const existed = Object.prototype.hasOwnProperty.call(context.carrier, ZERO_LAYER_CARRIER_FIELD_ACU);
    const releaseCandidate = isolateZeroLayerCarrierCandidate_ACU(context, before);
    context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = candidate;
    try {
      if (assignments) applyExitAssignments_ACU(chat, assignments.values, 'after');
      await saveChatToHostStrict_ACU({ verify: true });
      assertZeroLayerCarrier_ACU(context);
      verifyBridge();
      verifyExit(journal?.phase === 'committed' ? 'after' : 'before');
      const confirmed = readZeroLayerCarrierCandidate_ACU(context);
      if (!sameEnvelope_ACU(confirmed, candidate)) {
        throw new ZeroLayerError_ACU('revision-conflict', '保存确认后载体存档已变化。');
      }
      releaseCandidate();
      notifyZeroLayerChanges_ACU(before, candidate);
      return structuredClone(candidate);
    } catch (error) {
      if (assignments && exitAssignmentsMatch_ACU(chat, assignments.values, 'after')) {
        applyExitAssignments_ACU(chat, assignments.values, assignments.beforeSide);
      }
      if (context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] === candidate) {
        if (existed) context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = previousRaw;
        else delete context.carrier[ZERO_LAYER_CARRIER_FIELD_ACU];
      }
      if (error instanceof HostChatSaveNotStartedError_ACU) {
        throw new ZeroLayerError_ACU('persist-failed', '宿主保存未开始，零层字段已恢复。');
      }
      ZeroLayerStore_ACU.unknown.set(context.key, {
        before: structuredClone(before), candidate: structuredClone(candidate), source: context.source,
        ...(assignments ? { assignments: structuredClone(assignments) } : {}),
      });
      throw new ZeroLayerError_ACU('persist-unknown', '零层保存结果尚未确认；禁止继续提交，请从服务器回读恢复。');
    } finally {
      releaseCandidate();
    }
  }

  private enqueue<T>(context: ZeroLayerCarrierContext_ACU, operation: () => Promise<T>): Promise<T> {
    const previous = ZeroLayerStore_ACU.tails.get(context.key) ?? Promise.resolve();
    const result = previous.then(() => {
      assertZeroLayerCarrier_ACU(context);
      return operation();
    });
    const settled: Promise<void> = result.then((): void => undefined, (): void => undefined);
    ZeroLayerStore_ACU.tails.set(context.key, settled);
    void settled.then(() => {
      if (ZeroLayerStore_ACU.tails.get(context.key) === settled) ZeroLayerStore_ACU.tails.delete(context.key);
    });
    return result;
  }
}

function sameEnvelope_ACU(left: ZeroLayerEnvelope_ACU | null, right: ZeroLayerEnvelope_ACU | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
