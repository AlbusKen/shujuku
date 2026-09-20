import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { formatWorldSimulationLedgerRequiredFields_ACU, type WorldCollisionReport_ACU, type WorldSimulationLedger_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationSettings_ACU } from '../model';
import { applyWorldSimulationCandidates_ACU, preflightWorldSimulationCandidates_ACU } from '../simulation-transaction';
import type { WorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { mergeWorldSimulationEvidenceRegistrySnapshot_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU } from '../api-preset';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU } from './agent-catalog';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, worldSimulationDirectorProtocolInstruction_ACU } from './agent-defaults';
import type { WorldSimulationCandidate_ACU, WorldSimulationMainLoopResult_ACU, WorldSimulationSubagentOutcome_ACU } from './agent-model';
import type { WorldSimulationAnchorIdentity_ACU } from './agent-model';
import type { WorldSimulationSessionInput_ACU } from './agent-session-log';
import { createWorldSimulationPlaceholderResolvers_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { compactWorldSimulationProtocolError_ACU, createWorldSimulationProtocolRepairState_ACU, parseWorldSimulationMainOutput_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationDirectorProtocolRejection_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU } from './agent-read-gate';
import { clearWorldSimulationRunState_ACU, readWorldSimulationRunState_ACU, saveWorldSimulationRunState_ACU } from './agent-run-cache';
import { persistWorldSimulationRunState_ACU, restoreWorldSimulationRunState_ACU, clearWorldSimulationRunStateAtAnchor_ACU } from './agent-run-state-store';
import { beginWorldSimulationSessionRun_ACU, endWorldSimulationSessionRun_ACU, logWorldSimulationSession_ACU, readWorldSimulationSessionLog_ACU, updateWorldSimulationSession_ACU } from './agent-session-log';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './prompt-template';
import type { WorldSimulationAgentInvoker_ACU, WorldSimulationSubagentRuntime_ACU } from './agent-subagent-runtime';

export interface WorldSimulationMainLoopDependencies_ACU {
  invoke: WorldSimulationAgentInvoker_ACU;
  subagents: Pick<WorldSimulationSubagentRuntime_ACU, 'run' | 'runReviewer'>;
  countTokens?: WorldSimulationTokenCounter_ACU;
  apiPreset?: WorldSimulationApiPresetDependencies_ACU;
}
export interface WorldSimulationMainLoopInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  persistSessionEvent?: (eventKey: string, event: WorldSimulationSessionInput_ACU) => Promise<unknown>;
  anchor?: WorldSimulationAnchorIdentity_ACU;
  chat?: any[];
}

const compact_ACU = (error: unknown): string => error instanceof Error ? error.message : String(error);
const SILENT_DELEGATION_REJECT_LIMIT_ACU = 2;
const cursorKey_ACU = (identity: WorldSimulationRunIdentity_ACU): string => `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`;
const fingerprint_ACU = (outcome: WorldSimulationSubagentOutcome_ACU): string => sha256HexSync_ACU(JSON.stringify([outcome.agentName, outcome.status, outcome.summary, outcome.candidate?.candidateId])).slice(0, 24);

function upsertLatestOutcome_ACU(items: WorldSimulationSubagentOutcome_ACU[], outcome: WorldSimulationSubagentOutcome_ACU): void {
  const previous = items.findIndex(item => item.agentName === outcome.agentName);
  if (previous >= 0) items.splice(previous, 1);
  items.push(outcome);
}

function latestOutcomes_ACU(items: readonly WorldSimulationSubagentOutcome_ACU[]): WorldSimulationSubagentOutcome_ACU[] {
  const latest: WorldSimulationSubagentOutcome_ACU[] = [];
  for (const item of items) upsertLatestOutcome_ACU(latest, item);
  return latest;
}


function resultContext_ACU(
  base: WorldSimulationPlaceholderContext_ACU,
  registry: WorldSimulationEvidenceRegistry_ACU,
  candidates: readonly WorldSimulationCandidate_ACU[],
  outcomes: readonly WorldSimulationSubagentOutcome_ACU[],
): WorldSimulationPlaceholderContext_ACU {
  return {
    ...base,
    runtimeContext: { ...((base.runtimeContext && typeof base.runtimeContext === 'object') ? base.runtimeContext as Record<string, unknown> : {}), outcomes },
    worldCandidates: candidates,
    evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry),
  };
}

function toolResultText_ACU(results: Awaited<ReturnType<typeof runWorldSimulationToolBatch_ACU>>): string {
  return JSON.stringify(results.map(item => ({ kind: item.kind, address: item.address, status: item.status, summary: item.summary, evidenceRef: item.evidenceRef, content: item.content })));
}

function uniqueCandidates_ACU(items: readonly WorldSimulationCandidate_ACU[]): WorldSimulationCandidate_ACU[] {
  const byId = new Map<string, WorldSimulationCandidate_ACU>();
  for (const item of items) byId.set(item.candidateId, item);
  return [...byId.values()];
}

function record_ACU(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function candidateResourceKeys_ACU(candidate: WorldSimulationCandidate_ACU): Set<string> {
  const keys = new Set<string>();
  for (const [module, patch] of Object.entries(candidate.patch)) {
    const collection = record_ACU(patch);
    const upsert = collection?.upsert;
    if (Array.isArray(upsert)) {
      for (const item of upsert) {
        const entry = record_ACU(item);
        if (typeof entry?.id === 'string' && entry.id.trim()) keys.add(`${module}:${entry.id.trim()}`);
      }
      continue;
    }
    keys.add(module);
  }
  return keys;
}

function withoutCandidateResources_ACU(candidate: WorldSimulationCandidate_ACU, resources: ReadonlySet<string>): WorldSimulationCandidate_ACU | null {
  if (candidate.agentName === '' || !resources.size) return candidate;
  const patch: Record<string, unknown> = {};
  for (const [module, value] of Object.entries(candidate.patch)) {
    const collection = record_ACU(value);
    const upsert = collection?.upsert;
    if (Array.isArray(upsert)) {
      const remaining = upsert.filter(item => {
        const entry = record_ACU(item);
        return typeof entry?.id !== 'string' || !resources.has(`${module}:${entry.id.trim()}`);
      });
      if (remaining.length) patch[module] = { ...collection, upsert: remaining };
      continue;
    }
    if (!resources.has(module)) patch[module] = value;
  }
  return Object.keys(patch).length ? { ...candidate, patch } : null;
}

function upsertCandidateRevision_ACU(items: WorldSimulationCandidate_ACU[], candidate: WorldSimulationCandidate_ACU): void {
  const resources = candidateResourceKeys_ACU(candidate);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const existing = items[index];
    if (existing.agentName !== candidate.agentName) continue;
    const retained = withoutCandidateResources_ACU(existing, resources);
    if (retained) items[index] = retained;
    else items.splice(index, 1);
  }
  items.push(candidate);
}

export class WorldSimulationMainLoop_ACU {
  constructor(private readonly dependencies: WorldSimulationMainLoopDependencies_ACU) {}

  async run(input: WorldSimulationMainLoopInput_ACU): Promise<WorldSimulationMainLoopResult_ACU> {
    const cursorKey = cursorKey_ACU(input.identity);
    const resumed = readWorldSimulationRunState_ACU(input.identity.chatIdentity, input.identity.taskId, cursorKey);
    const anchorState = input.anchor && !resumed
      ? await restoreWorldSimulationRunState_ACU(input.anchor, input.identity.taskId, cursorKey, input.chat)
      : null;
    // 楼层记录与内存缓存语义等价：优先内存（活跃 run），楼层回退覆盖重启恢复。
    const resumedState = resumed ?? anchorState;
    if (resumedState?.evidenceSnapshot) {
      mergeWorldSimulationEvidenceRegistrySnapshot_ACU(input.registry, resumedState.evidenceSnapshot);
    }
    // 预算窗口重置：恢复时持久化 nextIteration 已达上限且没有可继续的进度（无候选且无派工结果），
    // 说明这是"预算耗尽后继续"而非正常推进；迭代与派工窗口重新起算，候选与证据全量保留。
    // "iteration budget exhausted" 是预算耗尽终局 persist 的专属标记；恢复时命中即代表
    // 用户显式要求以新窗口继续，迭代与派工预算全额重置，候选与证据保留。
    const budgetExhausted = !!resumedState
      && (resumedState.nextIteration > input.settings.agentRunBudget.maxIterations
        || resumedState.reviewerFeedback === 'iteration budget exhausted');
    const iterationStart = budgetExhausted ? 1 : Math.max(1, resumedState?.nextIteration ?? 1);
    const delegationsStart = budgetExhausted ? 0 : resumedState?.delegationsUsed ?? 0;
    const outcomes = latestOutcomes_ACU(resumedState?.subagentOutcomes ?? []);
    const candidates: WorldSimulationCandidate_ACU[] = resumedState?.candidates ? [...resumedState.candidates] : [];
    const perAgent = new Map<string, number>(Object.entries(resumedState?.perAgent ?? {}));
    let delegationsUsed = delegationsStart;
    let iteration = iterationStart;

    const transcript: Array<{ role: string; content: string }> = resumedState?.transcript ? [...resumedState.transcript] : [];
    const director = 'world-director' as const;
    // Director may correct several different mechanical fields in sequence; repeated identical
    // failures remain capped by the repair state's per-fingerprint guard.
    const protocolRepair = createWorldSimulationProtocolRepairState_ACU(4);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    let silentDelegationRejections = 0;
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, director, 'agent_loop', this.dependencies.apiPreset);
    const persistEntry = async (entryId: number, eventKey: string): Promise<void> => {
      if (!input.persistSessionEvent) return;
      const entry = readWorldSimulationSessionLog_ACU(input.identity.chatIdentity).find(item => item.id === entryId);
      if (!entry) return;
      await input.persistSessionEvent(eventKey, {
        kind: entry.kind, title: entry.title, detail: entry.detail,
        agentName: entry.agentName, ok: entry.ok, status: entry.status,
      });
    };
    const runEntryId = beginWorldSimulationSessionRun_ACU(
      input.identity.chatIdentity, '世界推演 Agent 运行',
      budgetExhausted ? `预算窗口重置，从第 1 轮继续（保留 ${candidates.length} 个候选）` : resumedState ? `从第 ${iteration} 次迭代恢复` : `stage=${input.identity.stageId}`,
      !!resumedState,
    );
    await persistEntry(runEntryId, resumedState ? 'run-resumed' : 'run-started');


    const persist = (nextIteration: number, reviewerFeedback = ''): void => {
      const unique = uniqueCandidates_ACU(candidates);
      const state = {
        taskId: input.identity.taskId,
        cursorKey,
        nextIteration,
        delegationsUsed,
        perAgent: Object.fromEntries(perAgent),
        outcomes: outcomes.map(item => ({ agentName: item.agentName, status: item.status, summary: item.summary, fingerprint: fingerprint_ACU(item) })),
        candidateFingerprint: sha256HexSync_ACU(JSON.stringify(unique.map(item => item.candidateId))),
        candidateSummary: unique.map(item => item.summary).join('；').slice(0, 1000),
        reviewerFeedback,
        candidates: unique,
        subagentOutcomes: outcomes,
        evidenceSnapshot: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry),
        transcript: [...transcript],
      };
      saveWorldSimulationRunState_ACU(input.identity.chatIdentity, state);
      if (input.anchor) {
        void persistWorldSimulationRunState_ACU(input.anchor, state, input.chat).catch(() => {
          // 楼层持久化失败不阻断运行；内存缓存已保存，下一次 persist 会重试落盘。
        });
      }
    };


    for (; iteration <= input.settings.agentRunBudget.maxIterations; iteration += 1) {
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const requestContext = resultContext_ACU(input.promptContext, input.registry, uniqueCandidates_ACU(candidates), outcomes);
      const mainEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
        kind: 'main_action',
        title: `主 Agent 第 ${iteration} 轮正在工作`,
        detail: iteration === 1 ? `正在分析本轮幕后推演：${input.promptContext.userGuidance || input.identity.stageId}` : '正在结合上一轮取证与派工结果决定下一步动作…',
        agentName: director,
        status: 'running',
      });
      let sent: Awaited<ReturnType<typeof executeWorldSimulationFinalRequest_ACU>>;
      try {
        const rendered = await renderWorldSimulationPrompt_ACU(
          input.settings.agentPrompts[director], director,
          createWorldSimulationPlaceholderResolvers_ACU({ ...requestContext, evidenceRegistry: requestSnapshot }),
        );
        sent = await executeWorldSimulationFinalRequest_ACU({
          messages: [...rendered.messages, { role: 'system', content: worldSimulationDirectorProtocolInstruction_ACU() }, ...transcript],
          historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          invoke: messages => this.dependencies.invoke(director, messages, preset),
        });
      } catch (error) {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮失败`, detail: compact_ACU(error), ok: false, status: 'failed' });
        await persistEntry(mainEntryId, `main-${iteration}-failed`);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_failed', title: '主 Agent 请求失败', detail: compact_ACU(error), agentName: director, ok: false });
        await persistEntry(failedId, `run-failed-main-${iteration}`);
        throw error;
      }
      if (sent.status === 'rejected') {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮失败`, detail: sent.reason, ok: false, status: 'failed' });
        await persistEntry(mainEntryId, `main-${iteration}-rejected`);
        persist(iteration);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_failed', title: '最终请求超出 Token 门禁', detail: sent.reason, agentName: director, ok: false });
        await persistEntry(failedId, `run-failed-token-${iteration}`);
        throw new Error(sent.reason);
      }
      const raw = String(sent.response ?? '');
      const allowDelegate = delegationsUsed < input.settings.agentRunBudget.maxDelegations;
      let action;
      try {
        action = parseWorldSimulationMainOutput_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[director], allowDelegate, requestSnapshot);
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(protocolRepair, error);
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 第 ${iteration} 轮协议未通过`, detail: `${failure.issue.reasonCode} ${failure.issue.path}`, ok: false, status: 'failed' });
        await persistEntry(mainEntryId, `main-${iteration}-protocol-failed`);
        if (!failure.retry) {
          persist(iteration, `${failure.issue.reasonCode}:${failure.issue.path}`);
          throw error;
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: renderWorldSimulationDirectorProtocolRejection_ACU(failure.issue, allowDelegate) });
        const retryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'protocol_retry', title: '主 Agent 协议修正', detail: `${failure.issue.reasonCode} ${failure.issue.path}\n模型返回片段：${raw.slice(0, 300) || '(空)'}`, agentName: director, ok: false });
        await persistEntry(retryId, `main-${iteration}-protocol-retry`);
        continue;
      }
      updateWorldSimulationSession_ACU(input.identity.chatIdentity, mainEntryId, { title: `主 Agent 动作：${action.kind}`, detail: `第 ${iteration} 轮决策完成`, ok: true, status: 'done' });
      await persistEntry(mainEntryId, `main-${iteration}-done`);

      if (action.kind === 'read' || action.kind === 'search' || action.kind === 'tools') {
        const calls = action.kind === 'tools' ? action.calls : [action];
        const toolEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, {
          kind: 'tool_read', title: '主 Agent 正在读取资料',
          detail: calls.map(call => call.kind === 'read' ? `read: ${call.reads.join(', ')}` : `search: ${call.query}`).join('；'),
          agentName: director, status: 'running',
        });
        let results: Awaited<ReturnType<typeof runWorldSimulationToolBatch_ACU>>;
        try {
          results = await runWorldSimulationToolBatch_ACU({
            calls, registry: input.registry, dependencies: input.tools,
            gate: {
              state: readGateState,
              config: { historyTokenBudget: input.settings.agentHistoryTokenBudget, readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
              usage: toolUsage,
              maxReads: input.settings.agentRunBudget.maxReads,
              count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
            },
          });
          const toolOk = results.every(result => result.status === 'ok' || result.status === 'empty');
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, toolEntryId, {
            title: toolOk ? `资料读取完成（${results.length} 项）` : '资料读取部分失败',
            detail: results.map(result => `${result.kind}:${result.status} ${result.address} ${result.summary}`).join('；'),
            ok: toolOk, status: toolOk ? 'done' : 'failed',
          });
          await persistEntry(toolEntryId, `tool-${iteration}`);
        } catch (error) {
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, toolEntryId, { title: '资料读取失败', detail: compact_ACU(error), ok: false, status: 'failed' });
          await persistEntry(toolEntryId, `tool-${iteration}-failed`);
          throw error;
        }
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: toolResultText_ACU(results) });
        persist(iteration + 1);
        continue;
      }

      if (action.kind === 'delegate') {
        const accepted = [] as typeof action.delegations;
        const rejected = [] as Array<{ agentName: string; reason: string }>;
        const runningEntries = new Map<(typeof action.delegations)[number], number>();
        for (const delegation of action.delegations) {
          const definition = WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === delegation.agentName);
          const used = perAgent.get(delegation.agentName) ?? 0;
          const allowedKind = definition && (definition.kind === 'specialist' || definition.kind === 'researcher');
          const reason = !allowedKind ? `角色 ${delegation.agentName} 不可派工`
            : delegationsUsed + accepted.length >= input.settings.agentRunBudget.maxDelegations ? `总派工预算已耗尽（${delegationsUsed + accepted.length}/${input.settings.agentRunBudget.maxDelegations}）`
            : used >= input.settings.agentRunBudget.maxSameAgent ? `同角色派工预算已耗尽（${used}/${input.settings.agentRunBudget.maxSameAgent}）`
            : accepted.length >= input.settings.agentRunBudget.maxConcurrent ? `并行派工预算已耗尽（${accepted.length}/${input.settings.agentRunBudget.maxConcurrent}）`
            : '';
          // 预算/角色门禁静默拦截：不调用子代理、不出会话卡片、不记 outcome，原因仅回灌 transcript。
          if (reason) {
            rejected.push({ agentName: delegation.agentName, reason });
            continue;
          }
          accepted.push(delegation);
          runningEntries.set(delegation, logWorldSimulationSession_ACU(input.identity.chatIdentity, {
            kind: 'delegation', title: `${delegation.agentName} 正在工作`, detail: delegation.instruction, agentName: delegation.agentName, status: 'running',
          }));
        }
        const budgetUsageText = `当前用量：总派工 ${delegationsUsed}/${input.settings.agentRunBudget.maxDelegations}${[...perAgent.entries()].map(([name, count]) => `；${name} ${count}/${input.settings.agentRunBudget.maxSameAgent}`).join('')}`;
        const rejectionText = `派工被预算门禁静默拦截（未调用任何子代理）：\n${rejected.map(item => `- ${item.agentName}：${item.reason}`).join('\n')}\n${budgetUsageText}\n请改派仍有预算的角色、基于现有候选 finalize，或在证据不足时输出 block。`;
        if (!accepted.length) {
          // 整轮派工被门禁清空：不消耗迭代轮数；连续整轮被拦达到上限即终止，防止无声空转。
          silentDelegationRejections += 1;
          transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `${rejectionText}（整轮拦截 ${silentDelegationRejections}/${SILENT_DELEGATION_REJECT_LIMIT_ACU}，达到上限即终止）` });
          if (silentDelegationRejections >= SILENT_DELEGATION_REJECT_LIMIT_ACU) {
            persist(iteration, 'delegation gate exhausted');
            const blockId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: '派工预算耗尽，连续整轮被门禁拦截', detail: rejectionText, agentName: director, ok: false });
            await persistEntry(blockId, 'block-delegation-gate');
            return { outcome: 'blocked', summary: '派工被预算门禁连续拦截，无可派工角色', unresolved: rejected.map(item => `${item.agentName}: ${item.reason}`), outcomes };
          }
          persist(iteration);
          iteration -= 1;
          continue;
        }
        silentDelegationRejections = 0;
        const settled = await Promise.all(accepted.map(async delegation => {
          try {
            return await this.dependencies.subagents.run({ delegation, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools });
          } catch (error) {
            const issue = compactWorldSimulationProtocolError_ACU(error);
            const reasonCode = issue.reasonCode === 'PROTOCOL_UNKNOWN_ERROR' ? 'WORLD_SIMULATION_SUBAGENT_FAILED' : issue.reasonCode;
            return { agentName: delegation.agentName, status: 'failed' as const, summary: compact_ACU(error), evidenceRefs: [], uncertainties: [], reasonCode };
          }
        }));
        for (let index = 0; index < settled.length; index += 1) {
          let outcome = settled[index];
          delegationsUsed += 1;
          perAgent.set(outcome.agentName, (perAgent.get(outcome.agentName) ?? 0) + 1);
          if (outcome.candidate) {
            const authorized = new Set(snapshotWorldSimulationEvidenceRegistry_ACU(input.registry).entries.flatMap(entry => entry.evidenceRef ? [entry.evidenceRef] : []));
            const violations = preflightWorldSimulationCandidates_ACU(input.promptContext.worldState as WorldSimulationLedger_ACU, [outcome.candidate], authorized, input.settings);
            if (violations.length) {
              const detail = violations.map(item => `${item.path || '$'}: ${item.message}`).join('\uff1b');
              outcome = { agentName: outcome.agentName, status: 'failed', summary: `\u5019\u9009\u9884\u68c0\u5931\u8d25\uff1a${detail}`, evidenceRefs: outcome.evidenceRefs, uncertainties: [], reasonCode: 'WORLD_SIMULATION_CANDIDATE_PREFLIGHT_FAILED' };
              settled[index] = outcome;
            } else {
              upsertCandidateRevision_ACU(candidates, outcome.candidate);
            }
          }
          upsertLatestOutcome_ACU(outcomes, outcome);
          const ok = outcome.status === 'candidate' || outcome.status === 'no_change';
          const entryId = runningEntries.get(accepted[index])!;
          updateWorldSimulationSession_ACU(input.identity.chatIdentity, entryId, { title: `${outcome.agentName} ${outcome.status}`, detail: outcome.summary, ok, status: ok ? 'done' : 'failed' });
          await persistEntry(entryId, `delegation-${iteration}-${index + 1}`);
        }
        const transcriptPayload: Array<{ role: string; content: string }> = [{ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: JSON.stringify(settled.map(item => ({ agentName: item.agentName, status: item.status, summary: item.summary, candidateId: item.candidate?.candidateId }))) }];
        if (rejected.length) {
          transcriptPayload.push({ role: 'user', content: rejectionText });
        }
        const preflightFailures = settled.filter(item => item.reasonCode === 'WORLD_SIMULATION_CANDIDATE_PREFLIGHT_FAILED');
        if (preflightFailures.length) {
          transcriptPayload.push({ role: 'user', content: `\u5019\u9009\u5165\u5e93\u9884\u68c0\u62d2\u7edd\uff1a\n${preflightFailures.map(item => `${item.agentName} ${item.summary}`).join('\n')}\n\u8bf7\u6309\u5168\u90e8\u8fdd\u89c4\u4e00\u6b21\u6027\u4fee\u6b63\u540e\u91cd\u65b0\u6d3e\u5de5\u3002\u5b8c\u6574\u5fc5\u586b\u5b57\u6bb5\u6a21\u677f\uff1a${formatWorldSimulationLedgerRequiredFields_ACU()}\u3002\u4e0d\u5f97\u628a\u672c\u6b21\u9884\u68c0\u5931\u8d25\u5f53\u4f5c\u4efb\u52a1\u7ec8\u5c40\u3002` });
        }
        transcript.push(...transcriptPayload);
        persist(iteration + 1);
        continue;
      }

      if (action.kind === 'block') {
        persist(iteration + 1, action.reason);
        const blockId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: action.reason, detail: action.unresolved.join('；'), agentName: director, ok: false });
        await persistEntry(blockId, `block-${iteration}`);
        return { outcome: 'blocked', summary: action.reason, unresolved: action.unresolved, outcomes };
      }


      if (action.outcome === 'no_change') {
        const insufficient = !action.evidenceRefs.length || !outcomes.length || outcomes.some(item => item.status !== 'no_change') || candidates.length > 0;
        if (insufficient) {
          persist(iteration + 1, 'no_change 缺少完整证据或存在候选/失败结果');
          transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: 'no_change 未满足门禁：必须有授权证据，且已有派工结果全部为 no_change，不得存在候选、失败或 blocked。请继续取证或输出 blocked。' });
          continue;
        }
        await clearWorldSimulationRunStateAtAnchor_ACU(input.anchor, input.chat);
        const completedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_completed', title: '世界推演无变化', detail: action.summary, agentName: director });
        await persistEntry(completedId, 'run-completed-no-change');
        return { outcome: 'no_change', summary: action.summary, outcomes };
      }

      const available = uniqueCandidates_ACU(candidates);
      if (!available.length) {
        persist(iteration + 1, 'commit 缺少候选');
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: 'commit 没有可审核候选。请继续派工，或在证据不足时输出 blocked。' });
        continue;
      }
      let reviewer;
      const reviewerEntryId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'delegation', title: '因果审核正在工作', detail: `正在审核 ${available.length} 个候选的时间、因果、权限与证据完整性`, agentName: 'causality-reviewer', status: 'running' });
      try {
        reviewer = await this.dependencies.subagents.runReviewer({ candidates: available, settings: input.settings, promptContext: requestContext, registry: input.registry, tools: input.tools });
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, reviewerEntryId, { title: `因果审核：${reviewer.verdict}`, detail: reviewer.summary, ok: reviewer.verdict !== 'reject', status: reviewer.verdict === 'reject' ? 'failed' : 'done' });
        await persistEntry(reviewerEntryId, `causality-review-${iteration}`);
      } catch (error) {
        updateWorldSimulationSession_ACU(input.identity.chatIdentity, reviewerEntryId, { title: '因果审核失败', detail: compact_ACU(error), ok: false, status: 'failed' });
        await persistEntry(reviewerEntryId, `causality-review-${iteration}-failed`);
        persist(iteration + 1, compact_ACU(error));
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `reviewer 未完成：${compact_ACU(error)}。请继续修正候选或输出 blocked。` });
        continue;
      }
      const acceptedIds = new Set(reviewer.acceptedCandidateIds);
      const acceptedCandidates = available.filter(item => acceptedIds.has(item.candidateId));
      const blockingFindings = reviewer.findings.filter(item => item.severity === 'blocking');
      if (reviewer.verdict !== 'accept' || !acceptedCandidates.length || blockingFindings.length) {
        persist(iteration + 1, reviewer.summary);
        const findings = reviewer.findings.filter(item => item.severity !== 'minor');
        const feedback = findings.length
          ? findings.map(item => `${item.severity}:${item.reasonCode}:${item.path}；期望=${item.expected}；实际=${String(item.actual)}`).join('\n')
          : 'reviewer 未接受任何候选';
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `reviewer 驳回或要求修订候选：${reviewer.summary}\n${feedback}\n请根据审核意见重新派工修正候选；不得把本次驳回当作任务终局。只有确实无法补足证据或修正时才输出 blocked。` },
        );
        continue;
      }
      const causalEvidenceRefs = [...new Set([...action.evidenceRefs, ...acceptedCandidates.flatMap(item => item.evidenceRefs)])];
      const guidanceCandidate = reviewer.guidance ? {
        candidateId: `candidate:guidance:${sha256HexSync_ACU(JSON.stringify([reviewer.guidance, action.summary])).slice(0, 24)}`,
        agentName: 'causality-reviewer',
        patch: { guidance: { signals: reviewer.guidance.signals.map(item => typeof item === 'string' ? { text: item, voice: 'ambient' as const } : item), excludedFacts: reviewer.guidance.excludedFacts, evidenceRefs: causalEvidenceRefs } },
        summary: '审核员压缩的可感知 guidance',
        evidenceRefs: causalEvidenceRefs,
        uncertainties: [] as string[],
        writableModules: ['guidance'],
      } : null;
      const finalCandidates = guidanceCandidate ? [...acceptedCandidates, guidanceCandidate] : acceptedCandidates;
      try {
        applyWorldSimulationCandidates_ACU(
          input.promptContext.worldState as WorldSimulationLedger_ACU,
          finalCandidates,
          new Set(causalEvidenceRefs),
          input.settings,
        );
      } catch (error) {
        const message = compact_ACU(error);
        persist(iteration + 1, message);
        const failedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'main_action', title: '候选事务应用失败，等待修订', detail: message, agentName: director, ok: false, status: 'failed' });
        await persistEntry(failedId, `candidate-transaction-failed-${iteration}`);
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: `已接受候选在账本事务应用阶段失败：${message}\n请把该错误作为修订约束重新派工。若为 revision 冲突，必须基于当前账本 revision 重建受影响条目；若为字段缺失，必须一次性补齐该模块全部持久化必填字段。完整必填字段模板：${formatWorldSimulationLedgerRequiredFields_ACU()}。不得把本次事务失败当作任务终局，只有确实无法修正时才输出 blocked。` },
        );
        continue;
      }
      await clearWorldSimulationRunStateAtAnchor_ACU(input.anchor, input.chat);
      const commitCandidate = { runId: input.identity.runId, taskId: input.identity.taskId, stageId: input.identity.stageId, stageRevision: input.identity.stageRevision, baseLedgerRevision: input.identity.baseLedgerRevision, summary: action.summary, acceptedCandidates: finalCandidates, evidenceRefs: causalEvidenceRefs, reviewer, collisionReport: input.promptContext.worldCollisions as WorldCollisionReport_ACU };
      const completedId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'run_completed', title: `候选通过审核（${acceptedCandidates.length}/${available.length}${guidanceCandidate ? '+guidance' : ''}）`, detail: action.summary, agentName: director });
      await persistEntry(completedId, 'run-completed-commit');
      return { outcome: 'commit', summary: action.summary, commitCandidate, outcomes };
    }

    persist(input.settings.agentRunBudget.maxIterations, 'iteration budget exhausted');
    const blockId = logWorldSimulationSession_ACU(input.identity.chatIdentity, { kind: 'block', title: '迭代预算耗尽', detail: `maxIterations=${input.settings.agentRunBudget.maxIterations}`, agentName: director, ok: false });
    await persistEntry(blockId, 'block-iteration-budget');
    return { outcome: 'blocked', summary: '世界推演主循环迭代预算耗尽', unresolved: ['iteration budget exhausted'], outcomes };
  }
}
