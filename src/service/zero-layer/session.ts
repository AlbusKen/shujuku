import type { InterceptedHostRequest_ACU } from '../../data/gateways/host-generation-interceptor';
import type { ContinuationLogicalRef_ACU, TurnAttemptIdentity_ACU } from '../continuation/model';
import type { ChatCompletionPromptContext_ACU } from '../runtime/helpers-remaining';
import { captureZeroLayerTableInput_ACU } from './table-state';
import { prepareZeroLayerPlot_ACU } from './plot-preparation';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU, readZeroLayerCarrier_ACU, type ZeroLayerCarrierContext_ACU } from './carrier-context';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerEffectReceipt_ACU } from './model';
import type { ZeroLayerRequestLease_ACU } from './host-request-forwarder';
import { bindZeroLayerPromptContext_ACU } from './request-context';
import { ZeroLayerStore_ACU } from './store';
import { buildZeroLayerTimeline_ACU, getPublishedZeroLayerPath_ACU, projectZeroLayerPromptHistory_ACU } from './timeline';
import { synchronizeZeroLayerCheckpoints_ACU } from './checkpoint-scheduler';
import { synchronizeZeroLayerBridge_ACU } from './bridge-scheduler';
import type { ZeroLayerBranchCommand_ACU } from './branch-command';
import type { ZeroLayerExitSelection_ACU } from './exit-model';
import { notifyZeroLayerViewPreview_ACU } from './view-preview';
import { buildZeroLayerWorldInfoScanText_ACU, readZeroLayerWorldInfoScanRounds_ACU } from './world-info-scan';

/** 仅用于本地装配到 fetch 的归属传递；数据库请求不携带该字段。 */
export const ZERO_LAYER_REQUEST_ID_ACU = '_acu_zero_layer_attempt_id';

export interface ZeroLayerPreparedInvocation_ACU {
  readonly quietPrompt: string;
  readonly signal: AbortSignal;
  readonly logicalRef: ContinuationLogicalRef_ACU;
  /** 只供酒馆世界书扫描的最近逻辑对话；不进入提示词，空串表示关闭。 */
  readonly worldInfoScanText: string;
}
export type ZeroLayerResponseSettlement_ACU = (
  envelope: ZeroLayerEnvelope_ACU, turnId: string, attemptId: string, signal: AbortSignal,
) => Promise<void>;

interface ActiveTurn_ACU {
  context: ZeroLayerCarrierContext_ACU;
  envelope: ZeroLayerEnvelope_ACU;
  turnId: string;
  attemptId: string;
  controller: AbortController;
  marker: string;
  promptContext: ChatCompletionPromptContext_ACU;
  messages: unknown[] | null;
  request: object | null;
  claimed: boolean;
  dispatchStarted: boolean;
  responseSaved: boolean;
  settlementFailed: boolean;
  previewSequence: number;
  previewOpen: boolean;
  failure?: unknown;
}

/** 一次只持有一个正文租约；不持有宿主物理消息写权限。 */
export class ZeroLayerSession_ACU {
  private active: ActiveTurn_ACU | null = null;
  private preparing = false;
  private recoveryController: AbortController | null = null;
  private epoch = 0;
  constructor(
    private readonly store = new ZeroLayerStore_ACU(),
    private readonly settleResponse?: ZeroLayerResponseSettlement_ACU,
  ) {}

  hasActiveTurn(): boolean { return this.active !== null || this.preparing || this.recoveryController !== null; }

  /** 在途正文租约的物理源是否仍一致；无在途正文时返回 null（准备与恢复步骤各自逐步复核）。 */
  isSourceCurrent(): boolean | null {
    const active = this.active;
    if (!active) return null;
    try { assertZeroLayerCarrier_ACU(active.context); return true; } catch { return false; }
  }

  async prepare(input: string, requiredEffects: ZeroLayerEffectReceipt_ACU['kind'][], continuationIdentity?: TurnAttemptIdentity_ACU): Promise<ZeroLayerPreparedInvocation_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '零层会话已有在途回合。');
    if (!input.trim()) throw new ZeroLayerError_ACU('corrupt-data', '零层输入不能为空。');
    this.preparing = true;
    try {
      return await this.prepareWithinLease(input, requiredEffects, continuationIdentity);
    } finally { this.preparing = false; }
  }

  private async prepareWithinLease(input: string, requiredEffects: ZeroLayerEffectReceipt_ACU['kind'][], continuationIdentity?: TurnAttemptIdentity_ACU): Promise<ZeroLayerPreparedInvocation_ACU> {
    const epoch = this.epoch;
    const context = captureZeroLayerCarrier_ACU();
    let envelope = await this.store.read();
    assertZeroLayerCarrier_ACU(context);
    if (epoch !== this.epoch) throw new ZeroLayerError_ACU('scope-changed', '准备期间会话已失效。');
    if (!envelope?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层模式未启用。');
    envelope = await synchronizeZeroLayerCheckpoints_ACU(this.store, envelope, new AbortController().signal, () => {
      assertZeroLayerCarrier_ACU(context);
      if (epoch !== this.epoch) throw new ZeroLayerError_ACU('scope-changed', 'checkpoint 恢复期间会话已失效。');
    });
    const turnId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const tableInput = captureZeroLayerTableInput_ACU(envelope, context.chat);
    assertZeroLayerCarrier_ACU(context);
    envelope = await this.store.commit({ type: 'prepare-turn', turnId, attemptId, input,
      requiredEffects: [...new Set<ZeroLayerEffectReceipt_ACU['kind']>([...requiredEffects, 'plot', ...(continuationIdentity ? ['continuation' as const] : [])])],
      tableInput, ...(continuationIdentity ? { continuationIdentity } : {}) }, envelope.revision);
    assertZeroLayerCarrier_ACU(context);
    if (epoch !== this.epoch) throw new ZeroLayerError_ACU('scope-changed', '准备保存后会话已失效，请恢复已保存回合。');
    const timeline = buildZeroLayerTimeline_ACU(envelope, context.chat as Record<string, unknown>[]);
    const active = this.createPreparedLease(envelope, context, turnId, attemptId);
    this.active = active;
    try {
      const turn = active.envelope.turns.find(item => item.turnId === turnId)!;
      const candidate = await prepareZeroLayerPlot_ACU(turn,
        projectZeroLayerPromptHistory_ACU(timeline), active.controller.signal, () => this.assertCurrent(active));
      this.assertCurrent(active);
      active.envelope = await this.store.commit({ type: 'prepare-plot', turnId, attemptId, candidate,
        receipt: { effectId: `${turnId}:${attemptId}:plot`, kind: 'plot', status: 'durable',
          fingerprint: getTableDataFingerprint_ACU(candidate) } }, active.envelope.revision);
      this.assertCurrent(active);
      active.promptContext.plotCandidate = structuredClone(candidate);
      return this.preparedInvocation(active);
    } catch (error) {
      try { await this.failActive(active, error); }
      finally { if (this.active === active) this.active = null; }
      throw error;
    }
  }

  /** 显式恢复正文尚未发送的指定回合；只回读候选，不再次调用剧情 API。 */
  async recoverPrepared(turnId: string, attemptId: string): Promise<ZeroLayerPreparedInvocation_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '已有零层任务正在执行。');
    const epoch = this.epoch;
    const context = captureZeroLayerCarrier_ACU();
    this.preparing = true;
    try {
      const envelope = await this.store.recover();
      assertZeroLayerCarrier_ACU(context);
      if (epoch !== this.epoch) throw new ZeroLayerError_ACU('scope-changed', '恢复期间会话已失效。');
      if (!envelope?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层模式未启用。');
      const turn = envelope.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
      const branch = envelope.branches.find(item => item.branchId === envelope.activeBranchId);
      if (!turn || turn.branchId !== envelope.activeBranchId || turn.phase !== 'prepared'
        || turn.body !== null || !turn.plotCandidate || !turn.tableInput || branch?.headTurnId !== turn.parentTurnId) {
        throw new ZeroLayerError_ACU('invalid-transition', '只能恢复已保存剧情候选且正文尚未发送的活动回合。');
      }
      const active = this.createPreparedLease(envelope, context, turnId, attemptId);
      this.active = active;
      this.assertCurrent(active);
      return this.preparedInvocation(active);
    } finally { this.preparing = false; }
  }

  private createPreparedLease(
    envelope: ZeroLayerEnvelope_ACU, context: ZeroLayerCarrierContext_ACU, turnId: string, attemptId: string,
  ): ActiveTurn_ACU {
    const turn = envelope.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
    if (!turn?.tableInput) throw new ZeroLayerError_ACU('effects-pending', '准备回合缺少表格快照。');
    const timeline = buildZeroLayerTimeline_ACU(envelope, context.chat as Record<string, unknown>[]);
    const active: ActiveTurn_ACU = {
      context, envelope, turnId, attemptId, controller: new AbortController(),
      marker: `ACU_ZERO_LAYER_${attemptId.replace(/-/g, '')}`,
      promptContext: { history: projectZeroLayerPromptHistory_ACU(timeline, turn.input),
        allTablesJson: structuredClone(turn.tableInput.tableData), storageMode: turn.tableInput.storageMode,
        ...(turn.plotCandidate ? { plotCandidate: structuredClone(turn.plotCandidate) } : {}),
        assertCurrent: () => this.assertCurrent(active) },
      messages: null, request: null, claimed: false, dispatchStarted: false, responseSaved: false,
      settlementFailed: false, previewSequence: 0, previewOpen: false,
    };
    return active;
  }

  private preparedInvocation(active: ActiveTurn_ACU): ZeroLayerPreparedInvocation_ACU {
    const turn = active.envelope.turns.find(item => item.turnId === active.turnId)!;
    return { quietPrompt: `${active.marker}_BEGIN\n${turn.input}\n${active.marker}_END`, signal: active.controller.signal,
      logicalRef: { sessionId: active.envelope.sessionId, branchId: turn.branchId,
        turnId: turn.turnId, attemptId: turn.attemptId, floorId: turn.assistantFloor.floorId },
      worldInfoScanText: buildZeroLayerWorldInfoScanText_ACU(active.envelope, readZeroLayerWorldInfoScanRounds_ACU()) };
  }

  /** 续写等待身份保存后接纳新 revision；正文与其它回合数据必须仍是原候选。 */
  async refreshPrepared(ref: ContinuationLogicalRef_ACU): Promise<void> {
    const active = this.active;
    if (!active || active.controller.signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '准备租约已失效。');
    assertZeroLayerCarrier_ACU(active.context);
    const current = await this.store.read();
    const turn = current?.turns.find(item => item.turnId === ref.turnId && item.attemptId === ref.attemptId);
    const before = active.envelope.turns.find(item => item.turnId === active.turnId);
    if (this.active !== active || active.controller.signal.aborted || !current || !turn
      || current.sessionId !== ref.sessionId || current.sessionId !== active.envelope.sessionId
      || current.activeBranchId !== ref.branchId || current.activeBranchId !== active.envelope.activeBranchId
      || turn.turnId !== active.turnId || turn.attemptId !== active.attemptId
      || turn.assistantFloor.floorId !== ref.floorId || turn.phase !== 'prepared'
      || JSON.stringify(turn) !== JSON.stringify(before)) {
      throw new ZeroLayerError_ACU('revision-conflict', '发送前逻辑正文候选已变化。');
    }
    if (turn.continuationIdentity) {
      const task = current.branches.find(branch => branch.branchId === ref.branchId)?.continuation?.envelope?.activeTask;
      const pending = task?.pendingHostTurn;
      if (task?.status !== 'running' || pending?.status !== 'awaiting_generation'
        || !(['chatIdentity', 'taskId', 'stageId', 'revision', 'nodeId', 'turnId', 'attemptId'] as const)
          .every(key => pending.identity[key] === turn.continuationIdentity![key])
        || !pending.capture.logicalRef || !(['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const)
          .every(key => pending.capture.logicalRef![key] === ref[key])) {
        throw new ZeroLayerError_ACU('revision-conflict', '正文发送前必须保存匹配的续写等待身份。');
      }
    }
    active.envelope = current;
    this.assertCurrent(active);
  }

  /** 请求级历史投影，保留酒馆已装配的角色卡、世界书及其前后位置。 */
  bindPrompt(data: { chat?: unknown[]; dryRun?: boolean }): void {
    const active = this.active;
    if (!active || data?.dryRun || !Array.isArray(data?.chat)) return;
    const start = `${active.marker}_BEGIN`;
    const end = `${active.marker}_END`;
    const matches = data.chat.flatMap((value, index) => {
      const message = value as Record<string, unknown>;
      return typeof message?.content === 'string' && message.content.includes(start) ? [index] : [];
    });
    if (!matches.length) return;
    this.assertCurrent(active);
    if (matches.length !== 1 || active.messages) throw new ZeroLayerError_ACU('revision-conflict', '本轮提示词身份重复或装配重入。');
    const index = matches[0];
    const message = data.chat[index] as Record<string, unknown>;
    const content = message.content as string;
    const begin = content.indexOf(start);
    const finish = content.indexOf(end, begin + start.length);
    if (finish < 0 || content.indexOf(start, begin + start.length) >= 0) {
      throw new ZeroLayerError_ACU('corrupt-data', '本轮提示词标记不完整。');
    }
    const replacement: unknown[] = [];
    const prefix = content.slice(0, begin);
    const suffix = content.slice(finish + end.length);
    if (prefix.trim()) replacement.push({ ...message, content: prefix });
    for (const turn of getPublishedZeroLayerPath_ACU(active.envelope)) {
      replacement.push({ role: 'user', content: turn.input }, { role: 'assistant', content: turn.body });
    }
    const turn = active.envelope.turns.find(item => item.turnId === active.turnId)!;
    if (!turn.plotCandidate) throw new ZeroLayerError_ACU('effects-pending', '正文装配缺少已确认的剧情候选。');
    if (turn.plotCandidate.finalMessage) replacement.push({ role: 'system', content: turn.plotCandidate.finalMessage });
    replacement.push({ role: 'user', content: turn.input });
    if (suffix.trim()) replacement.push({ ...message, content: suffix });
    data.chat.splice(index, 1, ...replacement);
    active.messages = data.chat;
  }

  bindSettings(data: Record<string, unknown>): void {
    const active = this.active;
    if (!active?.messages || !Array.isArray(data?.messages)) return;
    if (data.messages !== active.messages) return;
    this.assertCurrent(active);
    if (active.request && active.request !== data) throw new ZeroLayerError_ACU('revision-conflict', '本轮已绑定其他请求对象。');
    active.request = data;
    data[ZERO_LAYER_REQUEST_ID_ACU] = active.attemptId;
    bindZeroLayerPromptContext_ACU(data, active.promptContext);
  }

  claim(request: InterceptedHostRequest_ACU): ZeroLayerRequestLease_ACU | null {
    const active = this.active;
    if (!active || request.bodyText === null) return null;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(request.bodyText); }
    catch { return null; }
    if (payload?.[ZERO_LAYER_REQUEST_ID_ACU] !== active.attemptId) {
      if (request.bodyText.includes(active.marker)) throw new ZeroLayerError_ACU('corrupt-data', '零层请求尚未完成模板绑定，原发送已阻断。');
      return null;
    }
    this.assertCurrent(active);
    if (active.claimed) throw new ZeroLayerError_ACU('revision-conflict', '本次请求已经认领，禁止重复发送。');
    if (!active.request || JSON.stringify(payload.messages) !== JSON.stringify((active.request as Record<string, unknown>).messages)) {
      throw new ZeroLayerError_ACU('revision-conflict', '实际请求消息与本轮模板处理结果不一致。');
    }
    active.claimed = true;
    return {
      signal: active.controller.signal, presetName: active.envelope.apiPresetName,
      isCurrent: () => this.isCurrent(active),
      preview: body => this.preview(active, body),
      endPreview: () => this.preview(active, null),
      beforeDispatch: async () => {
        this.assertCurrent(active);
        await this.transition(active, 'dispatching');
        this.assertCurrent(active);
        active.dispatchStarted = true;
      },
      commitReply: async body => {
        this.assertCurrent(active);
        await this.transition(active, 'response-durable', { body, errorCode: null });
        active.responseSaved = true;
        this.assertCurrent(active);
        if (this.settleResponse) {
          try {
            active.envelope = await this.settleAndPublish(
              active.envelope, active.turnId, active.attemptId, active.controller.signal,
              () => {
                if (this.active !== active) throw new ZeroLayerError_ACU('scope-changed', '结算租约已失效。');
                assertZeroLayerCarrier_ACU(active.context);
              },
            );
          } catch (error) {
            active.settlementFailed = true;
            throw error;
          }
        }
      },
      fail: async error => {
        active.failure = error;
        try { await this.failActive(active, error); }
        catch (persistError) {
          active.failure = persistError;
          throw persistError;
        }
      },
    };
  }

  /** 宿主可能吞掉 fetch 的取消异常；结果仅以本轮内部响应保存状态判定。 */
  async finish(error?: unknown): Promise<ZeroLayerEnvelope_ACU> {
    const active = this.active;
    if (!active) throw new ZeroLayerError_ACU('scope-changed', '零层租约已失效。');
    try {
      if (!active.responseSaved) {
        const failure = active.failure ?? error;
        if (failure instanceof ZeroLayerError_ACU && ['persist-failed', 'persist-unknown', 'scope-changed', 'source-changed'].includes(failure.code)) {
          throw failure;
        }
        await this.failActive(active, failure);
        throw new ZeroLayerError_ACU(active.dispatchStarted ? 'pending-turn' : 'invalid-transition', '本轮未获得已保存的完整响应，请检查恢复状态。');
      }
      if (active.failure instanceof ZeroLayerError_ACU && ['persist-failed', 'persist-unknown'].includes(active.failure.code)) {
        throw active.failure;
      }
      if (this.active !== active || active.controller.signal.aborted) {
        throw new ZeroLayerError_ACU('scope-changed', '响应保存后租约已中止或失效。');
      }
      assertZeroLayerCarrier_ACU(active.context);
      const current = await this.store.read();
      const turn = current?.turns.find(item => item.turnId === active.turnId && item.attemptId === active.attemptId);
      if (!current || current.sessionId !== active.envelope.sessionId || !turn) {
        throw new ZeroLayerError_ACU('revision-conflict', '响应回读与本轮身份不匹配。');
      }
      if (active.settlementFailed || turn.phase !== 'published') {
        throw new ZeroLayerError_ACU('effects-pending', '完整响应已保存，结算尚未确认；仅恢复结算，不重发正文请求。');
      }
      return current;
    } finally {
      this.preview(active, null);
      if (this.active === active) this.active = null;
    }
  }

  /** 指定持久化身份补结算；不装配提示词、不认领 fetch，也不重发正文。 */
  async recoverSettlement(turnId: string, attemptId: string): Promise<ZeroLayerEnvelope_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '已有零层任务正在执行。');
    if (!this.settleResponse) throw new ZeroLayerError_ACU('effects-pending', '零层结算适配器尚未就绪。');
    const context = captureZeroLayerCarrier_ACU();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.recoveryController = controller;
    const assertLease = () => {
      if (epoch !== this.epoch || this.recoveryController !== controller) {
        throw new ZeroLayerError_ACU('scope-changed', '补结算期间会话已失效。');
      }
      assertZeroLayerCarrier_ACU(context);
    };
    try {
      const envelope = await this.store.recover();
      assertLease();
      if (controller.signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '补结算已中止。');
      if (!envelope?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层模式未启用。');
      return await this.settleAndPublish(envelope, turnId, attemptId, controller.signal, assertLease);
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  /** 用户显式放弃正文未保存的回合；先回读权威存档，只记取消，不认领宿主请求、不重发正文。 */
  async abandonPending(turnId: string, attemptId: string): Promise<ZeroLayerEnvelope_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '请先停止在途任务，再放弃未保存回合。');
    const context = captureZeroLayerCarrier_ACU();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.recoveryController = controller;
    const assertLease = () => {
      if (epoch !== this.epoch || this.recoveryController !== controller || controller.signal.aborted) {
        throw new ZeroLayerError_ACU('scope-changed', '放弃回合的租约已失效。');
      }
      assertZeroLayerCarrier_ACU(context);
    };
    try {
      const envelope = await this.store.recover();
      assertLease();
      if (!envelope) throw new ZeroLayerError_ACU('carrier-unavailable', '没有可放弃的零层回合。');
      const saved = await this.store.commit({ type: 'abandon-turn', turnId, attemptId }, envelope.revision);
      assertLease();
      return saved;
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  /** 分支操作只修改 carrier；保存未知时不能重试或重新生成正文。 */
  async changeBranch(command: ZeroLayerBranchCommand_ACU): Promise<ZeroLayerEnvelope_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '请先停止或恢复在途任务，再操作逻辑分支。');
    const frozen = structuredClone(command);
    const context = captureZeroLayerCarrier_ACU();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.recoveryController = controller;
    const assertLease = () => {
      if (epoch !== this.epoch || this.recoveryController !== controller || controller.signal.aborted) {
        throw new ZeroLayerError_ACU('scope-changed', '分支操作租约已失效。');
      }
      assertZeroLayerCarrier_ACU(context);
    };
    try {
      assertLease();
      let current = await this.store.read();
      assertLease();
      if (!current?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层模式未启用。');
      current = await synchronizeZeroLayerCheckpoints_ACU(this.store, current, controller.signal, assertLease);
      assertLease();
      const saved = await this.store.commit(frozen, current.revision);
      assertLease();
      const confirmed = await this.store.read();
      assertLease();
      if (!confirmed || getTableDataFingerprint_ACU(confirmed) !== getTableDataFingerprint_ACU(saved)) {
        throw new ZeroLayerError_ACU('revision-conflict', '分支保存回读不一致，禁止继续。');
      }
      return confirmed;
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  /** 退出只保存所选状态；不启动生成，也不改写原逻辑身份。 */
  async exitToOrdinary(selection: ZeroLayerExitSelection_ACU): Promise<ZeroLayerEnvelope_ACU> {
    const frozen = structuredClone(selection);
    return this.withExitLease(assertLease => this.store.exitToOrdinary(frozen, assertLease));
  }

  async recoverExit(): Promise<ZeroLayerEnvelope_ACU> {
    return this.withExitLease(assertLease => this.store.recoverExit(assertLease));
  }

  private async withExitLease(
    work: (assertLease: () => void) => Promise<ZeroLayerEnvelope_ACU>,
  ): Promise<ZeroLayerEnvelope_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '请先停止在途任务，再退出或恢复退出。');
    const context = captureZeroLayerCarrier_ACU();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.recoveryController = controller;
    const assertLease = () => {
      if (epoch !== this.epoch || this.recoveryController !== controller || controller.signal.aborted) {
        throw new ZeroLayerError_ACU('scope-changed', '退出操作租约已失效；已保存意图须显式恢复。');
      }
      assertZeroLayerCarrier_ACU(context);
    };
    try {
      assertLease();
      const saved = await work(assertLease);
      assertLease();
      return saved;
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  /** 聊天级启用必须先确认三类首基线；普通初始化和未知保存恢复不混用。 */
  async setEnabled(enabled: boolean, apiPresetName?: string): Promise<ZeroLayerEnvelope_ACU> {
    return this.configureBridge({ enabled, apiPresetName });
  }

  /** 仅显式回读并续接已保存迁移；不自动启用，不发送任何模型请求。 */
  async recoverBridge(): Promise<ZeroLayerEnvelope_ACU> {
    return this.configureBridge({ recover: true });
  }

  private async configureBridge(options: { enabled?: boolean; apiPresetName?: string; recover?: boolean }): Promise<ZeroLayerEnvelope_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '已有零层任务正在执行。');
    const context = captureZeroLayerCarrier_ACU();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.recoveryController = controller;
    const assertLease = () => {
      if (epoch !== this.epoch || this.recoveryController !== controller || controller.signal.aborted) {
        throw new ZeroLayerError_ACU('scope-changed', '零层启用或桥接恢复已失效。');
      }
      assertZeroLayerCarrier_ACU(context);
    };
    try {
      assertLease();
      // 启停不能把保存未知当成一次自动恢复；只有显式 recover 入口解除该门禁。
      let envelope = options.recover ? await this.store.recover() : await this.store.readPersisted();
      assertLease();
      if (!envelope) {
        if (options.enabled !== true || !options.apiPresetName?.trim()) {
          throw new ZeroLayerError_ACU('carrier-unavailable', '零层存档尚未初始化，首次启用需要数据库 API 预设。');
        }
        envelope = await this.store.commit({ type: 'initialize', apiPresetName: options.apiPresetName }, null);
        assertLease();
      }
      if (options.enabled === true || options.recover) {
        envelope = await synchronizeZeroLayerBridge_ACU(this.store, envelope, context, controller.signal, assertLease);
        assertLease();
      }
      if (options.enabled !== undefined && (options.enabled === false
        || envelope.enabled !== options.enabled
        || options.apiPresetName !== undefined && envelope.apiPresetName !== options.apiPresetName)) {
        envelope = await this.store.commit({ type: 'set-enabled', enabled: options.enabled,
          ...(options.apiPresetName === undefined ? {} : { apiPresetName: options.apiPresetName }) }, envelope.revision);
        assertLease();
      }
      const confirmed = await this.store.read();
      assertLease();
      if (!confirmed || getTableDataFingerprint_ACU(confirmed) !== getTableDataFingerprint_ACU(envelope)) {
        throw new ZeroLayerError_ACU('revision-conflict', '零层启用或恢复后载体已变化。');
      }
      return confirmed;
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  /** 显式恢复 checkpoint 阶段；不规划、不调用模型、不认领宿主请求。 */
  async recoverCheckpoints(): Promise<ZeroLayerEnvelope_ACU> {
    if (this.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '已有零层任务正在执行。');
    const context = captureZeroLayerCarrier_ACU();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.recoveryController = controller;
    const assertLease = () => {
      if (epoch !== this.epoch || this.recoveryController !== controller || controller.signal.aborted) {
        throw new ZeroLayerError_ACU('scope-changed', 'checkpoint 恢复已失效或中止。');
      }
      assertZeroLayerCarrier_ACU(context);
    };
    try {
      const envelope = await this.store.recover();
      assertLease();
      if (!envelope?.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层模式未启用。');
      return await synchronizeZeroLayerCheckpoints_ACU(this.store, envelope, controller.signal, assertLease);
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  private async settleAndPublish(
    envelope: ZeroLayerEnvelope_ACU, turnId: string, attemptId: string,
    signal: AbortSignal, assertLease: () => void,
  ): Promise<ZeroLayerEnvelope_ACU> {
    const assertCurrent = (current: ZeroLayerEnvelope_ACU | null): ZeroLayerEnvelope_ACU => {
      assertLease();
      if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '结算已中止。');
      if (!current || !current.enabled || current.sessionId !== envelope.sessionId
        || current.activeBranchId !== envelope.activeBranchId) {
        throw new ZeroLayerError_ACU('revision-conflict', '补结算会话或活动分支已变化。');
      }
      const turn = current.turns.find(item => item.turnId === turnId && item.attemptId === attemptId);
      if (!turn || turn.branchId !== current.activeBranchId) {
        throw new ZeroLayerError_ACU('revision-conflict', '补结算回合或尝试身份不匹配。');
      }
      if (!['response-durable', 'effects-durable', 'published'].includes(turn.phase)) {
        throw new ZeroLayerError_ACU('invalid-transition', '回合尚无已保存的完整响应，不能补结算。');
      }
      return current;
    };
    let current = assertCurrent(envelope);
    let turn = current.turns.find(item => item.turnId === turnId)!;
    if (turn.phase === 'response-durable') {
      if (!this.settleResponse) throw new ZeroLayerError_ACU('effects-pending', '零层结算适配器尚未就绪。');
      await this.settleResponse(structuredClone(current), turnId, attemptId, signal);
      current = assertCurrent(await this.store.read());
      turn = current.turns.find(item => item.turnId === turnId)!;
      if (turn.phase === 'response-durable') {
        if (!turn.requiredEffects.every(kind => turn.effectReceipts.some(
          receipt => receipt.kind === kind && (receipt.status === 'durable'
            || kind === 'simulation' && receipt.status === 'skipped-by-config'),
        ))) {
          throw new ZeroLayerError_ACU('effects-pending', '必需效果尚未取得持久化回执，禁止发布。');
        }
        current = assertCurrent(await this.store.commit({
          type: 'transition-turn', turnId, attemptId, phase: 'effects-durable',
        }, current.revision));
        turn = current.turns.find(item => item.turnId === turnId)!;
      }
    }
    if (turn.phase === 'effects-durable') {
      current = assertCurrent(await this.store.commit({
        type: 'transition-turn', turnId, attemptId, phase: 'published',
      }, current.revision));
    }
    return assertCurrent(await synchronizeZeroLayerCheckpoints_ACU(this.store, current, signal, assertLease));
  }

  cancel(): void {
    // preparation 的等待窗口同样撤销，不能在停止后新建活动请求。
    this.epoch += 1;
    this.active?.controller.abort();
    if (this.active) this.preview(this.active, null);
    this.recoveryController?.abort();
  }

  invalidate(): void {
    this.epoch += 1;
    this.cancel();
    this.active = null;
  }

  /** 仅临时展示；终止通知保留原身份，不能触发保存或把候选当 published。 */
  private preview(active: ActiveTurn_ACU, body: string | null): void {
    if (body !== null) {
      if (!this.isCurrent(active) || active.responseSaved) return;
      active.previewOpen = true;
    } else {
      if (!active.previewOpen) return;
      active.previewOpen = false;
    }
    notifyZeroLayerViewPreview_ACU({
      sessionId: active.envelope.sessionId, branchId: active.envelope.activeBranchId,
      carrierId: active.envelope.carrierId, carrierSwipeId: active.envelope.carrierSwipeId,
      turnId: active.turnId, attemptId: active.attemptId, revision: active.envelope.revision,
      sequence: ++active.previewSequence, body,
    });
  }

  private async failActive(active: ActiveTurn_ACU, error: unknown): Promise<void> {
    this.preview(active, null);
    if (active.responseSaved || this.active !== active) return;
    // 保存未知及作用域失效不追加写入；恢复时从权威 snapshot 决定后续。
    if (error instanceof ZeroLayerError_ACU && (['persist-unknown', 'source-changed'].includes(error.code)
      || (error.code === 'scope-changed' && !active.controller.signal.aborted))) return;
    assertZeroLayerCarrier_ACU(active.context);
    const turn = active.envelope.turns.find(item => item.turnId === active.turnId)!;
    if (!['prepared', 'dispatching'].includes(turn.phase)) return;
    const phase = active.dispatchStarted ? 'delivery-unknown' : active.controller.signal.aborted ? 'cancelled' : 'failed';
    await this.transition(active, phase, { errorCode: phase === 'delivery-unknown' ? 'delivery-unknown' : 'generation-failed' });
  }

  private async transition(
    active: ActiveTurn_ACU,
    phase: import('./model').ZeroLayerTurnPhase_ACU,
    changes?: Pick<Partial<import('./model').ZeroLayerTurn_ACU>, 'body' | 'errorCode'>,
  ): Promise<void> {
    assertZeroLayerCarrier_ACU(active.context);
    active.envelope = await this.store.commit({ type: 'transition-turn', turnId: active.turnId,
      attemptId: active.attemptId, phase, changes }, active.envelope.revision);
  }

  private isCurrent(active: ActiveTurn_ACU): boolean {
    try { this.assertCurrent(active); return true; } catch { return false; }
  }

  private assertCurrent(active: ActiveTurn_ACU): void {
    if (this.active !== active || active.controller.signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '本轮租约已中止或失效。');
    assertZeroLayerCarrier_ACU(active.context);
    const current = readZeroLayerCarrier_ACU(active.context);
    if (current?.sessionId !== active.envelope.sessionId || current.revision !== active.envelope.revision
      || current.activeBranchId !== active.envelope.activeBranchId || !current.enabled) {
      throw new ZeroLayerError_ACU('revision-conflict', '本轮会话或 revision 已变化。');
    }
  }
}
