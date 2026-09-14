import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import type { AgentKernelReadGateConfig_ACU } from '../agent-kernel/read-gate';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import { parseAgentRequirementsReplacement_ACU, type AgentRequirementSnapshot_ACU } from '../agent-kernel/requirements';
import { buildEmptyAgentWorldbookSnapshot_ACU, loadAgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import { buildWorldSimulationStoryContext_ACU, readWorldSimulationStoryBranchIdentity_ACU } from './world-simulation-story-context';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationTransaction_ACU, type WorldStateSnapshot_ACU } from './model';
import { parseWorldSimulationProjection_ACU } from './simulation-projection';
import { renderWorldSimulationPublicDelta_ACU } from './simulation-public-delta';
import { applyWorldSimulationTransaction_ACU } from './simulation-transaction';
import { resolveActiveWorldSimulationSwipe_ACU } from './simulation-swipe';
import { WorldSimulationStore_ACU } from './simulation-store';
import { WorldSimulationRequirementsStore_ACU } from './simulation-requirements-store';
import { appendWorldSimulationConversation_ACU, readNextPendingWorldSimulationInstruction_ACU, updateWorldSimulationConversationStatus_ACU, type WorldSimulationConversationRef_ACU } from './world-simulation-agent-conversation';
import { runWorldSimulationManualAgentExecution_ACU } from './world-simulation-agent-execution';
import type { WorldSimulationPromptMessage_ACU } from './world-simulation-agent-prompts';
import { isAiMessage_ACU } from '../runtime/message-handler';
import { captureWorldSimulationMaterialLease_ACU, refreshWorldSimulationMaterialLease_ACU, sameWorldSimulationMaterialLease_ACU, withWorldSimulationMaterialLeaseGrants_ACU, type WorldSimulationMaterialLease_ACU } from './world-simulation-material-lease';

export interface WorldSimulationAgentSessionDependencies_ACU {
  getChat: () => any[];
  getChatIdentity: (chat: unknown[]) => string;
  readSettings: () => import('./model').WorldSimulationSettings_ACU | null;
  store: WorldSimulationStore_ACU;
  countTokens: (text: string) => Promise<number>;
  runOwnedAi: (input: { source: string; chatIdentity: string; prompt: string; messages: Array<{ role: string; content: string }>; signal?: AbortSignal | null }) => Promise<string | null>;
  createRecordId: () => string;
  canRun: (chatIdentity: string) => boolean;
  requirementsStore?: WorldSimulationRequirementsStorePort_ACU;
  onIdle?: () => void;
  buildStoryContext?: (input: { chat: readonly unknown[]; anchorMessageIndex: number; chatIdentity: string; runId: string; settledThroughIndex: number }) => Promise<AgentStoryContextSnapshot_ACU>;
  loadWorldbook?: () => Promise<import('../continuation/agent/agent-worldbook-read').AgentWorldbookSnapshot_ACU>;
}

export interface WorldSimulationRequirementsStorePort_ACU {
  read: (targetIndex: number, chat: any[]) => AgentRequirementSnapshot_ACU | null;
  userSourceIds: (targetIndex: number, chat: any[]) => string[];
  pendingSourceIds: (targetIndex: number, chat: any[]) => string[];
  replace: (targetIndex: number, rawReplacement: unknown, chat: any[]) => Promise<AgentRequirementSnapshot_ACU>;
}

const defaultRequirementsStore_ACU = new WorldSimulationRequirementsStore_ACU();

export type WorldSimulationPendingAgentRunResult_ACU = 'not_run' | 'committed' | 'committed_with_audit_warning' | 'no_change' | 'no_change_with_audit_warning';
export type WorldSimulationAgentSubmitResult_ACU = 'started' | 'started_with_audit_warning' | 'queued';
export type WorldSimulationAgentStopResult_ACU = 'idle' | 'aborted' | 'committing' | 'committed';

function fail(code: 'WORLD_SIM_STALE' | 'WORLD_SIM_CONFLICT' | 'WORLD_SIM_PROTOCOL_INVALID', message: string): never { throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'agent', message, false)); }
function latestAi(chat: any[]): number { for (let i = chat.length - 1; i >= 0; i -= 1) if (isAiMessage_ACU(chat[i])) return i; return -1; }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function manualClock(base: WorldStateSnapshot_ACU | null, anchor: number) { return base ? { ...base.storyClock, updatedIndex: anchor } : { anchorText: `第 ${anchor + 1} 楼`, elapsedSinceLastRun: '即时', precision: 'unknown' as const, evidenceIndexes: [], updatedIndex: anchor }; }
function readGateConfig(budget: import('./model').WorldSimulationBudget_ACU): AgentKernelReadGateConfig_ACU {
  const tokens = budget.readTokenBudget === 'low' ? 2_000 : budget.readTokenBudget === 'medium' ? 6_000 : 12_000;
  return { historyTokenBudget: 0, readTokenBudget: tokens, fallbackTokens: tokens, defaultHistoryTokenBudget: 60_000, defaultFallbackTokens: tokens };
}

function derive(before: WorldStateSnapshot_ACU, after: WorldStateSnapshot_ACU, anchor: number): WorldSimulationTransaction_ACU | null {
  const output: any = { anchorMessageIndex: anchor, storyClock: after.storyClock, expectedRevisions: {}, entities: [], events: [], threads: [] };
  for (const module of ['entities', 'events', 'threads'] as const) {
    const previous = new Map(before[module].map(item => [item.id, item]));
    for (const next of after[module]) {
      const old = previous.get(next.id);
      if (same(old, next)) continue;
      if (next.retired) { if (old && !old.retired) output[module].push({ action: 'retire', id: next.id, reason: next.retiredReason || 'Agent 请求撤销' }); }
      else output[module].push({ action: 'upsert', value: next });
    }
    if (output[module].length) output.expectedRevisions[module] = before.revisions[module];
  }
  return Object.keys(output.expectedRevisions).length ? output : null;
}

export class WorldSimulationAgentSession_ACU {
  private running = false;
  private committing = false;
  private committed = false;
  private abort: AbortController | null = null;
  private readonly idleWaiters = new Set<() => void>();
  constructor(private readonly dependencies: WorldSimulationAgentSessionDependencies_ACU) {}
  isRunning(): boolean { return this.running; }
  isCommitting(): boolean { return this.committing; }
  stop(): WorldSimulationAgentStopResult_ACU {
    if (!this.running) return 'idle';
    if (this.committed) return 'committed';
    if (this.committing) return 'committing';
    this.abort?.abort();
    return 'aborted';
  }
  waitForIdle(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise(resolve => { this.idleWaiters.add(resolve); });
  }
  hasPendingRequest(chat = this.dependencies.getChat()): boolean { return readNextPendingWorldSimulationInstruction_ACU(chat) !== null; }
  private settleIdleWaiters(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
  private async assertCurrentMaterialLease_ACU(
    lease: WorldSimulationMaterialLease_ACU,
    requirementsStore: WorldSimulationRequirementsStorePort_ACU,
    anchor: number,
    identity: string,
  ): Promise<void> {
    try {
      const chat = this.dependencies.getChat();
      if (this.dependencies.getChatIdentity(chat) !== identity) fail('WORLD_SIM_STALE', '世界推演运行资料复验时聊天已切换');
      const requirementsSnapshot = requirementsStore.read(anchor, chat);
      const storyContext = await (this.dependencies.buildStoryContext ?? buildWorldSimulationStoryContext_ACU)({
        chat, anchorMessageIndex: anchor, chatIdentity: identity, runId: `manual-material-check:${anchor}`,
        settledThroughIndex: lease.settledThroughIndex,
      });
      let worldbook;
      try { worldbook = await (this.dependencies.loadWorldbook ?? loadAgentWorldbookSnapshot_ACU)(); }
      catch (_) { worldbook = buildEmptyAgentWorldbookSnapshot_ACU(false); }
      const current = refreshWorldSimulationMaterialLease_ACU(lease, { requirementsSnapshot, storyContext, settledThroughIndex: lease.settledThroughIndex, worldbook });
      if (!sameWorldSimulationMaterialLease_ACU(lease, current)) fail('WORLD_SIM_STALE', '世界推演要求、正文概览、正文快照或世界书授权资料已变化');
    } catch (error) {
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      fail('WORLD_SIM_STALE', `世界推演运行资料无法复验：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async submit(text: string, options: { forceQueue?: boolean } = {}): Promise<WorldSimulationAgentSubmitResult_ACU> {
    const chat = this.dependencies.getChat(); const anchor = latestAi(chat);
    if (anchor < 0) fail('WORLD_SIM_STALE', '当前聊天没有可承载世界推演会话的 AI 楼层');
    const request = text.trim();
    if (!request) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演 Agent 请求不能为空');
    const [entry] = await appendWorldSimulationConversation_ACU(anchor, [{ kind: 'user', status: 'pending', title: '你的补充', detail: request }], chat);
    const swipe = resolveActiveWorldSimulationSwipe_ACU(anchor, chat[anchor]).identity;
    const ref: WorldSimulationConversationRef_ACU = { messageIndex: anchor, swipe, id: entry.id, text: entry.detail };
    const identity = this.dependencies.getChatIdentity(chat);
    const replay = this.dependencies.store.read();
    const tip = replay ? (replay.deltaMessageIndices.length ? replay.deltaMessageIndices[replay.deltaMessageIndices.length - 1] : replay.checkpointMessageIndex) : -1;
    if (options.forceQueue || this.running || !this.dependencies.canRun(identity) || anchor <= tip) { await appendWorldSimulationConversation_ACU(anchor, [{ kind: 'queued', status: 'pending', title: '已排队', detail: '等待当前世界推演飞行完成后按顺序处理。' }], chat); return 'queued'; }
    const result = await this.run(ref, anchor);
    return result === 'committed_with_audit_warning' || result === 'no_change_with_audit_warning' ? 'started_with_audit_warning' : 'started';
  }

  async runPendingForAnchor(anchor: number, chat = this.dependencies.getChat()): Promise<WorldSimulationPendingAgentRunResult_ACU> {
    const pending = readNextPendingWorldSimulationInstruction_ACU(chat);
    if (!pending || this.running || !this.dependencies.canRun(this.dependencies.getChatIdentity(chat))) return 'not_run';
    return this.run(pending, anchor);
  }

  private async run(ref: WorldSimulationConversationRef_ACU, anchor: number): Promise<'committed' | 'committed_with_audit_warning' | 'no_change' | 'no_change_with_audit_warning'> {
    const chat = this.dependencies.getChat(); const settings = this.dependencies.readSettings();
    if (!settings?.enabled) fail('WORLD_SIM_PROTOCOL_INVALID', '请先启用并保存世界推演设置');
    if (anchor !== latestAi(chat) || !isAiMessage_ACU(chat[anchor])) fail('WORLD_SIM_STALE', '世界推演会话目标已不是当前最新 AI 楼层');
    const identity = this.dependencies.getChatIdentity(chat); if (!identity) fail('WORLD_SIM_STALE', '当前聊天身份不可用');
    if (!this.dependencies.canRun(identity)) fail('WORLD_SIM_STALE', '世界推演已有在飞任务，用户请求已保留待下一楼执行');
    const targetSwipe = resolveActiveWorldSimulationSwipe_ACU(anchor, chat[anchor]).identity;
    const sourceBranchIdentity = readWorldSimulationStoryBranchIdentity_ACU(chat, anchor);
    const isCurrent = (): boolean => {
      if (this.abort?.signal.aborted || this.dependencies.getChatIdentity(this.dependencies.getChat()) !== identity) return false;
      const current = this.dependencies.getChat();
      if (latestAi(current) !== anchor) return false;
      try {
        const sourceSwipe = resolveActiveWorldSimulationSwipe_ACU(ref.messageIndex, current[ref.messageIndex]).identity;
        const currentTargetSwipe = resolveActiveWorldSimulationSwipe_ACU(anchor, current[anchor]).identity;
        return JSON.stringify(sourceSwipe) === JSON.stringify(ref.swipe)
          && JSON.stringify(currentTargetSwipe) === JSON.stringify(targetSwipe)
          && readWorldSimulationStoryBranchIdentity_ACU(current, anchor) === sourceBranchIdentity;
      } catch (_) { return false; }
    };
    if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演会话来源或目标 swipe 已变化');
    this.abort = new AbortController(); this.running = true; this.committing = false; this.committed = false;
    // 本飞行一旦取得所有权就冻结 requirements 授权；首个 await 是运行状态审计，后到 submit
    // 可以在该窗口排队但绝不能扩展当前飞行可引用的 source 或最新 pending 水位。
    const requirementsStore = this.dependencies.requirementsStore ?? defaultRequirementsStore_ACU;
    let requirementSourceIds: string[] = [];
    let requirementsSnapshot: AgentRequirementSnapshot_ACU | null = null;
    let pendingRequirementSourceIds: string[] = [];
    const auditFailures: string[] = [];
    try {
      requirementSourceIds = [...requirementsStore.userSourceIds(anchor, chat)];
      const initialRequirementsSnapshot = requirementsStore.read(anchor, chat);
      requirementsSnapshot = initialRequirementsSnapshot === null ? null : JSON.parse(JSON.stringify(initialRequirementsSnapshot)) as AgentRequirementSnapshot_ACU;
      pendingRequirementSourceIds = [...requirementsStore.pendingSourceIds(anchor, chat)];
      try {
        await updateWorldSimulationConversationStatus_ACU(ref, 'running', undefined, chat);
      } catch (error) {
        auditFailures.push(`运行状态审计同步失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const base = this.dependencies.store.read(); const before = base?.state ?? { anchorMessageIndex: anchor, storyClock: manualClock(null, anchor), entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
      const settledThroughIndex = base?.state.anchorMessageIndex ?? -1;
      const expectedReplayDigest = base?.digest ?? null; const parentReplayDigest = this.dependencies.store.read(anchor - 1)?.digest ?? null;
      const storyContext = await (this.dependencies.buildStoryContext ?? buildWorldSimulationStoryContext_ACU)({
        chat, anchorMessageIndex: anchor, chatIdentity: identity, runId: `manual:${ref.messageIndex}:${ref.id}`,
        settledThroughIndex,
      });
      if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演正文快照装配后来源或目标 swipe 已变化');
      let baseMaterialLease = captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot, storyContext, settledThroughIndex });
      let masterCallsUsed = 0;
      let masterHistory: WorldSimulationPromptMessage_ACU[] = [];
      let execution: Awaited<ReturnType<typeof runWorldSimulationManualAgentExecution_ACU>>;
      for (;;) {
        execution = await runWorldSimulationManualAgentExecution_ACU({
          runId: `manual:${ref.messageIndex}:${ref.id}`, snapshot: before, anchorMessageIndex: anchor, storyClock: manualClock(base?.state ?? null, anchor), settings, reads: [], storyContext,
          requirementsSnapshot, pendingRequirementSourceIds, masterCallsUsed, history: masterHistory,
          readGateConfig: readGateConfig(settings.budgets.deep), userInstruction: ref.text, isCurrent,
        }, { countTokens: this.dependencies.countTokens, runAgent: async request => this.dependencies.runOwnedAi({ source: request.source, chatIdentity: identity, prompt: request.prompt, messages: [...request.messages], signal: this.abort?.signal }) });
        masterHistory = execution.history.map(message => ({ ...message }));
        masterCallsUsed += 1;
        if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演主 Agent 返回后来源或目标 swipe 已变化');
        if (execution.action.kind !== 'maintain_requirements') break;
        try {
          const replacement = parseAgentRequirementsReplacement_ACU(execution.action.payload, requirementSourceIds);
          const latestPendingSourceId = pendingRequirementSourceIds[pendingRequirementSourceIds.length - 1];
          if (!latestPendingSourceId || replacement.appliedUserMessageId !== latestPendingSourceId) {
            fail('WORLD_SIM_PROTOCOL_INVALID', `世界推演要求维护必须吸收最新用户输入 ${latestPendingSourceId ?? '(无)'}`);
          }
          const next = await requirementsStore.replace(anchor, execution.action.payload, chat);
          if (next.lastAppliedUserMessageId !== latestPendingSourceId) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演要求保存后未确认最新用户输入水位');
          if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演要求保存后来源或目标 swipe 已变化');
          requirementsSnapshot = next;
          pendingRequirementSourceIds = [];
          baseMaterialLease = captureWorldSimulationMaterialLease_ACU({ requirementsSnapshot, storyContext, settledThroughIndex });
          try {
            await appendWorldSimulationConversation_ACU(anchor, [{ kind: 'plan', status: 'done', title: '当前要求已维护', detail: `requirements revision 已更新为 ${next.revision}；主 Agent 将依据新要求重新决策。`, agentName: 'world-director' }], chat);
          } catch (error) {
            // requirements 已由独立严格 Store 提交；会话只是非权威审计，失败不能让调用方
            // 误以为要求未保存、更不能阻断基于新 revision 的下一次 master 决策。
            auditFailures.push(`requirements revision ${next.revision} 已保存，但维护审计同步失败：${error instanceof Error ? error.message : String(error)}`);
          }
        } catch (error) {
          if (error instanceof WorldSimulationValidationError_ACU) throw error;
          fail('WORLD_SIM_PROTOCOL_INVALID', `世界推演要求维护被拒绝：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演 Agent 返回时来源或目标 swipe 已变化');
      const materialLease = withWorldSimulationMaterialLeaseGrants_ACU(baseMaterialLease, execution.grants);
      const renderAuditWarnings = (): string => auditFailures.length ? `【审计警告】${auditFailures.join('；')}` : '';
      const planDetail = [
        renderAuditWarnings(),
        execution.plan.delegations.map(item => `${item.agent}：${item.instruction}`).join('\n') || '本次无需子代理写入。',
      ].filter(Boolean).join('\n');
      try {
        await appendWorldSimulationConversation_ACU(anchor, [{ kind: 'plan', status: 'done', title: '主 Agent 派工计划', detail: planDetail, agentName: 'world-director' }], chat);
      } catch (error) {
        auditFailures.push(`派工计划审计同步失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if (!execution.loop) {
        try {
          await updateWorldSimulationConversationStatus_ACU(ref, 'done', [renderAuditWarnings(), '主 Agent 判断本次无需修改世界账本。'].filter(Boolean).join('\n'), chat);
        } catch (error) {
          auditFailures.push(`无变更状态审计同步失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return auditFailures.length ? 'no_change_with_audit_warning' : 'no_change';
      }
      await this.assertCurrentMaterialLease_ACU(materialLease, requirementsStore, anchor, identity);
      try {
        await appendWorldSimulationConversation_ACU(anchor, execution.loop.agentsRun.map(agentName => ({
          kind: 'delegation' as const,
          status: 'done' as const,
          title: `${agentName} 已完成受限写集`,
          detail: `仅按角色获准模块生成候选事务；仍需通过 revision、swipe、replay digest 与联合提交校验。`,
          agentName: agentName as import('./model').WorldSimulationAgentName_ACU,
        })), chat);
      } catch (error) {
        auditFailures.push(`子代理候选审计同步失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const transaction = derive(before, execution.loop.snapshot, anchor);
      if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演提交前来源或目标 swipe 已变化');
      if (!transaction) {
        try {
          await updateWorldSimulationConversationStatus_ACU(ref, 'done', [renderAuditWarnings(), '子代理没有产生可提交的账本变化。'].filter(Boolean).join('\n'), chat);
        } catch (error) {
          auditFailures.push(`空候选状态审计同步失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return auditFailures.length ? 'no_change_with_audit_warning' : 'no_change';
      }
      const after = applyWorldSimulationTransaction_ACU(before, transaction, settings.maxTrackedEntities);
      const delta = renderWorldSimulationPublicDelta_ACU(before, transaction, after);
      const current = parseWorldSimulationProjection_ACU(String(chat[anchor].mes || ''));
      const commitInput = { anchorMessageIndex: anchor, recordId: this.dependencies.createRecordId(), state: after, delta: { anchorMessageIndex: anchor, storyClock: after.storyClock, entities: after.entities, events: after.events, threads: after.threads, revisions: after.revisions }, checkpointInterval: settings.checkpointInterval, expectedReplayDigest, parentReplayDigest, swipe: targetSwipe, sourceAnchorMessageIndex: anchor, coverageStartMessageIndex: anchor, coverageEndMessageIndex: anchor, expectedProjectionBlockHash: current?.blockHash ?? null, publicText: delta.text || null, publicEntryIds: [...delta.publicEntryIds] };
      // There is no cancellation seam once commitProjection enters the strict per-chat writer.
      // Mark the handoff synchronously so stop() is honest about the remaining host save.
      await this.assertCurrentMaterialLease_ACU(materialLease, requirementsStore, anchor, identity);
      this.committing = true;
      await this.dependencies.store.commitProjection(commitInput);
      // The ledger + projection joint save is now authoritative. Conversation writes are audit-only
      // and must never reclassify this committed fact as a failed business operation.
      this.committing = false;
      this.committed = true;
      try {
        await updateWorldSimulationConversationStatus_ACU(ref, 'done', `已受控提交 ${Object.keys(transaction.expectedRevisions).join('、')} 模块。`, chat);
      } catch (error) {
        auditFailures.push(`请求状态：${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await appendWorldSimulationConversation_ACU(anchor, [{ kind: auditFailures.length ? 'error' : 'commit', status: auditFailures.length ? 'failed' : 'done', title: auditFailures.length ? '账本已联合提交，但审计同步失败' : '世界账本已联合提交', detail: auditFailures.length ? `账本已提交；${auditFailures.join('；')}` : `已更新：${Object.keys(transaction.expectedRevisions).join('、')}。`, agentName: 'world-director' }], chat);
      } catch (error) {
        auditFailures.push(`提交审计：${error instanceof Error ? error.message : String(error)}`);
      }
      return auditFailures.length ? 'committed_with_audit_warning' : 'committed';
    } catch (error) {
      if (this.committed) throw error;
      try { await updateWorldSimulationConversationStatus_ACU(ref, 'failed', error instanceof Error ? error.message : String(error), chat); } catch (_) {}
      throw error;
    } finally {
      this.abort = null; this.committing = false; this.committed = false; this.running = false;
      this.settleIdleWaiters();
      try { this.dependencies.onIdle?.(); } catch (_) {}
    }
  }
}
