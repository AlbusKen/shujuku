import { invokeZeroLayerHostGeneration_ACU, requireZeroLayerHostGeneration_ACU } from '../../data/gateways/zero-layer-generation-gateway';
import type { ContinuationLogicalRef_ACU, TurnAttemptIdentity_ACU } from '../continuation/model';
import { installZeroLayerRequestForwarder_ACU } from './host-request-forwarder';
import { ZeroLayerError_ACU, type ZeroLayerEffectReceipt_ACU, type ZeroLayerEnvelope_ACU } from './model';
import { ZeroLayerSession_ACU, type ZeroLayerResponseSettlement_ACU, type ZeroLayerPreparedInvocation_ACU } from './session';
import { ZeroLayerStore_ACU } from './store';
import { carryForwardZeroLayerTableSettlement_ACU, computeAnchoredTableBackfill_ACU, createZeroLayerTableSettlement_ACU } from './table-settlement';
import { getPublishedZeroLayerPath_ACU } from './timeline';
import { getWorldSimulationRuntime_ACU } from '../simulation/simulation-runtime';
import type { ZeroLayerBranchCommand_ACU } from './branch-command';
import { captureZeroLayerCarrier_ACU, assertZeroLayerCarrier_ACU, type ZeroLayerCarrierContext_ACU } from './carrier-context';
import type { ZeroLayerExitSelection_ACU } from './exit-model';
import { assertZeroLayerFeatureEnabled_ACU } from './feature-policy';

/** 页面拥有的装配；初始化只注册拦截器，不创建或启用聊天存档。 */
export class ZeroLayerRuntime_ACU {
  readonly store = new ZeroLayerStore_ACU();
  readonly session = new ZeroLayerSession_ACU(this.store, async (...args) => {
    if (!this.settlement) throw new ZeroLayerError_ACU('effects-pending', '零层结算适配器尚未就绪。');
    const [envelope, turnId, attemptId, signal] = args;
    const activeTurn = envelope.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
    if (this.carryForwardNextSettlement) {
      this.carryForwardNextSettlement = false;
      await carryForwardZeroLayerTableSettlement_ACU(this.store, envelope, turnId, attemptId, signal, {
        markPendingBackfill: false,
      });
    } else if (this.asyncTableBackfillEnabled && !activeTurn?.continuationIdentity) {
      // 异步锚点填表流水线：先以当前已确认表底快速落盘占位并标记 tableBackfillStatus='pending'，
      // 让本轮正文 <20ms 内无损发布、立刻解锁下一轮正文，后台队列随后凭 (turnId, floorId) 精确回填并前向同步！
      await carryForwardZeroLayerTableSettlement_ACU(this.store, envelope, turnId, attemptId, signal, {
        markPendingBackfill: true,
      });
    } else {
      await this.settlement(...args);
    }
    const current = await this.store.read();
    const turn = current?.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
    if (!current || current.sessionId !== envelope.sessionId || !turn) {
      throw new ZeroLayerError_ACU('revision-conflict', '正文结算身份已变化。');
    }
    await getWorldSimulationRuntime_ACU().handleLogicalCompletion(current, turnId, attemptId, signal);
    const settled = await this.store.read();
    if (turn.continuationIdentity) {
      if (!this.continuationSettlement) throw new ZeroLayerError_ACU('effects-pending', '续写确认端口尚未接通。');
      if (!settled || settled.sessionId !== current.sessionId || settled.activeBranchId !== current.activeBranchId) {
        throw new ZeroLayerError_ACU('scope-changed', '推演结算后续写作用域已变化。');
      }
      await this.continuationSettlement(settled, turnId, attemptId, signal);
    }
  });
  private settlement: ZeroLayerResponseSettlement_ACU | null = null;
  private carryForwardNextSettlement = false;
  private asyncTableBackfillEnabled = true;
  private backfillRunning = false;
  private backfillController: AbortController | null = null;
  private continuationSettlement: ZeroLayerResponseSettlement_ACU | null = null;
  private uninstall: (() => void) | null = null;
  private submitting = false;
  private operationSettled: Promise<void> | null = null;
  private closing = false;
  private readonly closeBlocks = new Map<string, { context: ZeroLayerCarrierContext_ACU; release: () => void }>();
  private readonly continuationStops = new Set<() => Promise<void>>();

  constructor() {
    this.setSettlement(createZeroLayerTableSettlement_ACU(this.store));
  }

  install(): void {
    assertZeroLayerFeatureEnabled_ACU();
    if (this.uninstall) return;
    this.uninstall = installZeroLayerRequestForwarder_ACU({
      isActive: () => this.session.hasActiveTurn(),
      claim: request => this.session.claim(request),
    });
  }

  setSettlement(settlement: ZeroLayerResponseSettlement_ACU): void {
    if (this.submitting) throw new ZeroLayerError_ACU('pending-turn', '在途请求不能替换结算适配器。');
    this.settlement = settlement;
  }

  registerContinuationSettlement(settlement: ZeroLayerResponseSettlement_ACU): () => void {
    if (this.submitting) throw new ZeroLayerError_ACU('pending-turn', '在途请求不能替换续写确认端口。');
    this.continuationSettlement = settlement;
    return () => { if (this.continuationSettlement === settlement) this.continuationSettlement = null; };
  }

  async submit(input: string, requiredEffects: ZeroLayerEffectReceipt_ACU['kind'][],
    continuationIdentity?: TurnAttemptIdentity_ACU,
    beforeSend?: (ref: ContinuationLogicalRef_ACU) => Promise<void>,
  ): Promise<ZeroLayerEnvelope_ACU> {
    return this.submitPrepared(() => this.session.prepare(input,
      [...new Set<ZeroLayerEffectReceipt_ACU['kind']>([...requiredEffects, 'simulation'])], continuationIdentity), beforeSend);
  }

  /** 仅恢复未发送正文且剧情候选已确认的回合；不重新调用剧情 API。 */
  async resumePrepared(turnId: string, attemptId: string,
    beforeSend?: (ref: ContinuationLogicalRef_ACU) => Promise<void>,
  ): Promise<ZeroLayerEnvelope_ACU> {
    return this.submitPrepared(() => this.session.recoverPrepared(turnId, attemptId), beforeSend);
  }

  private async submitPrepared(
    prepare: () => Promise<ZeroLayerPreparedInvocation_ACU>,
    beforeSend?: (ref: ContinuationLogicalRef_ACU) => Promise<void>,
  ): Promise<ZeroLayerEnvelope_ACU> {
    if (!this.uninstall) throw new ZeroLayerError_ACU('mode-disabled', '零层请求拦截器尚未安装。');
    if (!this.settlement) throw new ZeroLayerError_ACU('effects-pending', '零层结算链尚未接通，禁止发送正文请求。');
    requireZeroLayerHostGeneration_ACU();
    const published = await this.runExclusive(async () => {
      const prepared = await prepare();
      let hostError: unknown;
      try {
        await beforeSend?.(prepared.logicalRef);
        await this.session.refreshPrepared(prepared.logicalRef);
        await invokeZeroLayerHostGeneration_ACU(prepared.quietPrompt, prepared.signal, prepared.worldInfoScanText);
      }
      catch (error) { hostError = error; }
      return await this.session.finish(hostError);
    });
    // 正文已发布并释放主互斥锁后，唤醒独立后台锚点填表队列（不阻塞下一层正文生成）
    this.scheduleTableBackfill();
    return published;
  }

  /** 启动/唤醒后台 FIFO 锚点填表队列：独立于主正文锁运行，按 Turn N -> N+1 顺序回填精确锚点并前向同步。 */
  scheduleTableBackfill(): void {
    if (this.backfillRunning || this.closing || !this.asyncTableBackfillEnabled) return;
    this.backfillRunning = true;
    const controller = new AbortController();
    this.backfillController = controller;
    void (async () => {
      let cleanExit = false;
      try {
        while (!controller.signal.aborted && !this.closing) {
          let context: ZeroLayerCarrierContext_ACU;
          let envelope: ZeroLayerEnvelope_ACU | null;
          try {
            context = captureZeroLayerCarrier_ACU();
            envelope = this.store.readSnapshot();
          } catch {
            break;
          }
          if (!envelope?.enabled || envelope.exitManifest) break;
          let path;
          try {
            path = getPublishedZeroLayerPath_ACU(envelope);
          } catch {
            break;
          }
          const anchor = path.find(turn => turn.tableBackfillStatus === 'pending');
          if (!anchor) {
            cleanExit = true;
            break;
          }

          let outcome: Awaited<ReturnType<typeof computeAnchoredTableBackfill_ACU>>;
          try {
            outcome = await computeAnchoredTableBackfill_ACU(
              envelope,
              context.chat as Record<string, unknown>[],
              anchor.turnId,
              anchor.attemptId,
              controller.signal,
            );
          } catch {
            break;
          }
          if (controller.signal.aborted) break;
          if ('aborted' in outcome && outcome.aborted) break;
          const commitResult = 'result' in outcome ? outcome.result : outcome.fallbackResult;
          const commitStatus = 'result' in outcome ? 'settled' : 'skipped';

          try {
            const committed = await this.store.commitAnchoredTableBackfill(
              envelope.sessionId,
              envelope.activeBranchId,
              {
                turnId: anchor.turnId,
                attemptId: anchor.attemptId,
                floorId: anchor.assistantFloor.floorId,
                result: commitResult,
                status: commitStatus,
              },
            );
            if (!committed.applied && committed.reason === 'scope-changed') break;
          } catch {
            break;
          }
        }
      } finally {
        if (this.backfillController === controller) this.backfillController = null;
        this.backfillRunning = false;
        if (cleanExit && !controller.signal.aborted && !this.closing) {
          try {
            const latest = this.store.readSnapshot();
            const hasMore = latest?.enabled && !latest.exitManifest
              && getPublishedZeroLayerPath_ACU(latest).some(t => t.tableBackfillStatus === 'pending');
            if (hasMore) this.scheduleTableBackfill();
          } catch { /* ignore */ }
        }
      }
    })();
  }

  private abortTableBackfill(): void {
    this.backfillController?.abort();
    this.backfillController = null;
  }

  /** 只恢复指定持久化回合的效果；不要求宿主生成能力，不发送正文请求。 */
  async recoverSettlement(turnId: string, attemptId: string): Promise<ZeroLayerEnvelope_ACU> {
    if (!this.settlement) throw new ZeroLayerError_ACU('effects-pending', '零层结算适配器尚未就绪。');
    return this.runExclusive(() => this.session.recoverSettlement(turnId, attemptId));
  }

  /** 快速自愈恢复：沿用已持久化表格基底直接发布滞留的 response-durable 回合（不阻塞在失败的远程填表重试上）。 */
  async recoverSettlementCarryForward(turnId: string, attemptId: string): Promise<ZeroLayerEnvelope_ACU> {
    if (!this.settlement) throw new ZeroLayerError_ACU('effects-pending', '零层结算适配器尚未就绪。');
    return this.runExclusive(async () => {
      this.carryForwardNextSettlement = true;
      try {
        return await this.session.recoverSettlement(turnId, attemptId);
      } finally {
        this.carryForwardNextSettlement = false;
      }
    });
  }

  /** 用户显式放弃正文未保存的回合；属于恢复操作，关闭未确认时也可执行，不发送请求。 */
  async abandonTurn(turnId: string, attemptId: string): Promise<ZeroLayerEnvelope_ACU> {
    return this.runExclusive(() => this.session.abandonPending(turnId, attemptId), 'recover');
  }

  /** 恢复 carrier 内已保存的 checkpoint 阶段，不开放任何模型发送入口。 */
  async recoverCheckpoints(): Promise<ZeroLayerEnvelope_ACU> {
    return this.runExclusive(() => this.session.recoverCheckpoints());
  }

  /** 显式启停共用 session 写租约；首次启用先严格确认桥接首基线。 */
  async setEnabled(enabled: boolean, apiPresetName?: string): Promise<ZeroLayerEnvelope_ACU> {
    if (enabled) assertZeroLayerFeatureEnabled_ACU();
    if (enabled) return this.runExclusive(() => this.session.setEnabled(true, apiPresetName));
    if (this.closing) throw new ZeroLayerError_ACU('pending-turn', '零层关闭正在收尾。');
    const context = captureZeroLayerCarrier_ACU();
    const previous = this.closeBlocks.get(context.key);
    if (!previous || previous.context.carrier !== context.carrier) {
      previous?.release();
      this.closeBlocks.set(context.key, { context, release: this.store.blockOperations() });
    }
    this.closing = true;
    this.abortTableBackfill();
    const settled = this.operationSettled;
    this.session.cancel();
    try {
      // 停机端口撤销规划租约并等待收尾，不清除逻辑等待引用。
      const stops = [...this.continuationStops].map(stop => Promise.resolve().then(stop));
      const results = await Promise.allSettled([...stops, ...(settled ? [settled] : [])]);
      // 某个停机端口失败也必须等待其他端口与原操作退出，不能提前释放关闭锁。
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      assertZeroLayerCarrier_ACU(context);
      const source = await this.store.read();
      assertZeroLayerCarrier_ACU(context);
      if (source?.enabled) await getWorldSimulationRuntime_ACU().stop();
      assertZeroLayerCarrier_ACU(context);
      const disabled = await this.runExclusive(() => this.session.setEnabled(false, apiPresetName), 'close');
      assertZeroLayerCarrier_ACU(context);
      this.releaseCloseBlock(context, disabled);
      return disabled;
    } finally {
      // 只释放收尾互斥锁；失败后的 carrier 冻结必须保留。
      this.closing = false;
    }
  }

  /** 显式恢复只回读载体并续接迁移，不发送请求或自动启用。 */
  async recoverBridge(): Promise<ZeroLayerEnvelope_ACU> {
    const context = captureZeroLayerCarrier_ACU();
    return this.runExclusive(async () => {
      const envelope = await this.session.recoverBridge();
      assertZeroLayerCarrier_ACU(context);
      this.releaseCloseBlock(context, envelope);
      return envelope;
    }, 'recover');
  }

  private releaseCloseBlock(context: ZeroLayerCarrierContext_ACU, envelope: ZeroLayerEnvelope_ACU): void {
    const block = this.closeBlocks.get(context.key);
    if (!envelope.enabled && block?.context.carrier === context.carrier) {
      block.release();
      this.closeBlocks.delete(context.key);
    }
  }

  /** 已确认关闭后显式退出；与正文及分支操作共享互斥锁。 */
  async exitToOrdinary(selection: ZeroLayerExitSelection_ACU): Promise<ZeroLayerEnvelope_ACU> {
    return this.runExclusive(() => this.session.exitToOrdinary(selection));
  }

  /** 只从服务器恢复已保存退出意图，不重新发送任何请求。 */
  async recoverExit(): Promise<ZeroLayerEnvelope_ACU> {
    const context = captureZeroLayerCarrier_ACU();
    return this.runExclusive(async () => {
      const envelope = await this.session.recoverExit();
      assertZeroLayerCarrier_ACU(context);
      this.releaseCloseBlock(context, envelope);
      return envelope;
    }, 'recover');
  }

  /** 回退/分叉与分支选择共享正文操作锁，调用者传入原 FloorRef。 */
  async changeBranch(command: ZeroLayerBranchCommand_ACU): Promise<ZeroLayerEnvelope_ACU> {
    this.abortTableBackfill();
    const res = await this.runExclusive(() => this.session.changeBranch(command));
    this.scheduleTableBackfill();
    return res;
  }

  registerContinuationStop(stop: () => Promise<void>): () => void {
    if (this.closing) throw new ZeroLayerError_ACU('pending-turn', '关闭期间不能装配续写运行时。');
    this.continuationStops.add(stop);
    return () => { this.continuationStops.delete(stop); };
  }

  private async runExclusive<T>(work: () => Promise<T>, access: 'normal' | 'close' | 'recover' = 'normal'): Promise<T> {
    if (access !== 'close') assertZeroLayerFeatureEnabled_ACU();
    if (this.submitting || this.closing && access !== 'close') {
      throw new ZeroLayerError_ACU('pending-turn', '已有零层操作正在执行或关闭收尾。');
    }
    if (access === 'normal') this.store.assertCanOperate();
    this.submitting = true;
    let release!: () => void;
    const settled = new Promise<void>(resolve => { release = resolve; });
    this.operationSettled = settled;
    try { return await work(); }
    finally {
      this.submitting = false;
      if (this.operationSettled === settled) this.operationSettled = null;
      release();
    }
  }

  invalidate(): void {
    this.abortTableBackfill();
    this.session.invalidate();
  }
  cancel(): void { this.session.cancel(); }
  dispose(): void {
    this.invalidate();
    this.uninstall?.();
    this.uninstall = null;
  }
}

let runtime_ACU: ZeroLayerRuntime_ACU | null = null;
export function getZeroLayerRuntime_ACU(): ZeroLayerRuntime_ACU {
  return runtime_ACU ??= new ZeroLayerRuntime_ACU();
}
