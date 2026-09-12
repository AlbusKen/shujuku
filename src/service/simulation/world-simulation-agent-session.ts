import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import type { AgentKernelReadGateConfig_ACU } from '../agent-kernel/read-gate';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationTransaction_ACU, type WorldStateSnapshot_ACU } from './model';
import { parseWorldSimulationProjection_ACU } from './simulation-projection';
import { renderWorldSimulationPublicDelta_ACU } from './simulation-public-delta';
import { applyWorldSimulationTransaction_ACU } from './simulation-transaction';
import { resolveActiveWorldSimulationSwipe_ACU } from './simulation-swipe';
import { WorldSimulationStore_ACU } from './simulation-store';
import { appendWorldSimulationConversation_ACU, readLatestPendingWorldSimulationInstruction_ACU, updateWorldSimulationConversationStatus_ACU, type WorldSimulationConversationRef_ACU } from './world-simulation-agent-conversation';
import { runWorldSimulationManualAgentExecution_ACU } from './world-simulation-agent-execution';
import { isAiMessage_ACU } from '../runtime/message-handler';

export interface WorldSimulationAgentSessionDependencies_ACU {
  getChat: () => any[];
  getChatIdentity: (chat: unknown[]) => string;
  readSettings: () => import('./model').WorldSimulationSettings_ACU | null;
  store: WorldSimulationStore_ACU;
  countTokens: (text: string) => Promise<number>;
  runOwnedAi: (input: { source: string; chatIdentity: string; prompt: string; messages: Array<{ role: string; content: string }>; signal?: AbortSignal | null }) => Promise<string | null>;
  createRecordId: () => string;
  canRun: (chatIdentity: string) => boolean;
}

export type WorldSimulationPendingAgentRunResult_ACU = 'not_run' | 'committed' | 'committed_with_audit_warning' | 'no_change';
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
  private settleIdleWaiters(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  async submit(text: string): Promise<WorldSimulationAgentSubmitResult_ACU> {
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
    if (this.running || !this.dependencies.canRun(identity) || anchor <= tip) { await appendWorldSimulationConversation_ACU(anchor, [{ kind: 'queued', status: 'pending', title: '已排队', detail: '等待下一条 AI 楼层或当前世界推演飞行结束后执行。' }], chat); return 'queued'; }
    const result = await this.run(ref, anchor);
    return result === 'committed_with_audit_warning' ? 'started_with_audit_warning' : 'started';
  }

  async runPendingForAnchor(anchor: number, chat = this.dependencies.getChat()): Promise<WorldSimulationPendingAgentRunResult_ACU> {
    const pending = readLatestPendingWorldSimulationInstruction_ACU(chat);
    if (!pending || this.running || !this.dependencies.canRun(this.dependencies.getChatIdentity(chat))) return 'not_run';
    return this.run(pending, anchor);
  }

  private async run(ref: WorldSimulationConversationRef_ACU, anchor: number): Promise<'committed' | 'committed_with_audit_warning' | 'no_change'> {
    const chat = this.dependencies.getChat(); const settings = this.dependencies.readSettings();
    if (!settings?.enabled) fail('WORLD_SIM_PROTOCOL_INVALID', '请先启用并保存世界推演设置');
    if (anchor !== latestAi(chat) || !isAiMessage_ACU(chat[anchor])) fail('WORLD_SIM_STALE', '世界推演会话目标已不是当前最新 AI 楼层');
    const identity = this.dependencies.getChatIdentity(chat); if (!identity) fail('WORLD_SIM_STALE', '当前聊天身份不可用');
    if (!this.dependencies.canRun(identity)) fail('WORLD_SIM_STALE', '世界推演已有在飞任务，用户请求已保留待下一楼执行');
    const targetSwipe = resolveActiveWorldSimulationSwipe_ACU(anchor, chat[anchor]).identity;
    const isCurrent = (): boolean => {
      if (this.abort?.signal.aborted || this.dependencies.getChatIdentity(this.dependencies.getChat()) !== identity) return false;
      const current = this.dependencies.getChat();
      if (latestAi(current) !== anchor) return false;
      try {
        const sourceSwipe = resolveActiveWorldSimulationSwipe_ACU(ref.messageIndex, current[ref.messageIndex]).identity;
        const currentTargetSwipe = resolveActiveWorldSimulationSwipe_ACU(anchor, current[anchor]).identity;
        return JSON.stringify(sourceSwipe) === JSON.stringify(ref.swipe)
          && JSON.stringify(currentTargetSwipe) === JSON.stringify(targetSwipe);
      } catch (_) { return false; }
    };
    if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演会话来源或目标 swipe 已变化');
    this.abort = new AbortController(); this.running = true; this.committing = false; this.committed = false;
    try {
      await updateWorldSimulationConversationStatus_ACU(ref, 'running', undefined, chat);
      const base = this.dependencies.store.read(); const before = base?.state ?? { anchorMessageIndex: anchor, storyClock: manualClock(null, anchor), entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
      const expectedReplayDigest = base?.digest ?? null; const parentReplayDigest = this.dependencies.store.read(anchor - 1)?.digest ?? null;
      const execution = await runWorldSimulationManualAgentExecution_ACU({ snapshot: before, anchorMessageIndex: anchor, storyClock: manualClock(base?.state ?? null, anchor), settings, reads: [], readGateConfig: readGateConfig(settings.budgets.deep), userInstruction: ref.text, isCurrent }, { countTokens: this.dependencies.countTokens, runAgent: async request => this.dependencies.runOwnedAi({ source: request.source, chatIdentity: identity, prompt: request.prompt, messages: [...request.messages], signal: this.abort?.signal }) });
      if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演 Agent 返回时来源或目标 swipe 已变化');
      await appendWorldSimulationConversation_ACU(anchor, [{ kind: 'plan', status: 'done', title: '主 Agent 派工计划', detail: execution.plan.delegations.map(item => `${item.agent}：${item.instruction}`).join('\n') || '本次无需子代理写入。', agentName: 'world-director' }], chat);
      if (!execution.loop) { await updateWorldSimulationConversationStatus_ACU(ref, 'done', '主 Agent 判断本次无需修改世界账本。', chat); return 'no_change'; }
      await appendWorldSimulationConversation_ACU(anchor, execution.loop.agentsRun.map(agentName => ({
        kind: 'delegation' as const,
        status: 'done' as const,
        title: `${agentName} 已完成受限写集`,
        detail: `仅按角色获准模块生成候选事务；仍需通过 revision、swipe、replay digest 与联合提交校验。`,
        agentName: agentName as import('./model').WorldSimulationAgentName_ACU,
      })), chat);
      const transaction = derive(before, execution.loop.snapshot, anchor);
      if (!isCurrent()) fail('WORLD_SIM_STALE', '世界推演提交前来源或目标 swipe 已变化');
      if (!transaction) { await updateWorldSimulationConversationStatus_ACU(ref, 'done', '子代理没有产生可提交的账本变化。', chat); return 'no_change'; }
      const after = applyWorldSimulationTransaction_ACU(before, transaction, settings.maxTrackedEntities);
      const delta = renderWorldSimulationPublicDelta_ACU(before, transaction, after);
      const current = parseWorldSimulationProjection_ACU(String(chat[anchor].mes || ''));
      const commitInput = { anchorMessageIndex: anchor, recordId: this.dependencies.createRecordId(), state: after, delta: { anchorMessageIndex: anchor, storyClock: after.storyClock, entities: after.entities, events: after.events, threads: after.threads, revisions: after.revisions }, checkpointInterval: settings.checkpointInterval, expectedReplayDigest, parentReplayDigest, swipe: targetSwipe, sourceAnchorMessageIndex: anchor, coverageStartMessageIndex: anchor, coverageEndMessageIndex: anchor, expectedProjectionBlockHash: current?.blockHash ?? null, publicText: delta.text || null, publicEntryIds: [...delta.publicEntryIds] };
      // There is no cancellation seam once commitProjection enters the strict per-chat writer.
      // Mark the handoff synchronously so stop() is honest about the remaining host save.
      this.committing = true;
      await this.dependencies.store.commitProjection(commitInput);
      // The ledger + projection joint save is now authoritative. Conversation writes are audit-only
      // and must never reclassify this committed fact as a failed business operation.
      this.committing = false;
      this.committed = true;
      const auditFailures: string[] = [];
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
    } finally { this.abort = null; this.committing = false; this.committed = false; this.running = false; this.settleIdleWaiters(); }
  }
}
