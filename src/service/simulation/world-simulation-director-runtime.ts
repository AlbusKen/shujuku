import { resolveAgentMaterialGrants_ACU, type AgentMaterialGrant_ACU, type AgentMaterialGrantTable_ACU } from '../agent-kernel/material-grants';
import { renderAgentTableByName_ACU } from '../continuation/agent/agent-tables';
import type { AgentKernelToolCall_ACU } from '../agent-kernel/agent-tools';
import type { AgentRequirementSnapshot_ACU } from '../agent-kernel/requirements';
import { buildEmptyAgentWorldbookSnapshot_ACU, createAgentWorldbookGrantSource_ACU, loadAgentWorldbookSnapshot_ACU, renderAgentWorldbookCatalog_ACU, renderAgentWorldbookEntries_ACU, renderAgentWorldbookHits_ACU, resolveAgentWorldbookGrantEntries_ACU, type AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import { createWorldSimError_ACU, WorldSimulationValidationError_ACU, type WorldSimulationSettings_ACU, type WorldStateSnapshot_ACU, type WorldStoryClock_ACU } from './model';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import type { WorldSimulationAgentLoopResult_ACU } from './agent/agent-main-loop';
import { WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU } from './agent/agent-catalog';
import { parseWorldSimulationMasterAction_ACU, type WorldSimulationDelegationPlan_ACU, type WorldSimulationMasterAction_ACU } from './world-simulation-agent-interaction';
import { parseTableAddress_ACU } from './world-simulation-agent-tools';
import { renderWorldSimulationMasterMessages_ACU, renderWorldSimulationUntrustedBlock_ACU, type WorldSimulationPromptMessage_ACU } from './world-simulation-agent-prompts';

export interface WorldSimulationDirectorRuntimeInput_ACU {
  runId: string; snapshot: WorldStateSnapshot_ACU; storyClock: WorldStoryClock_ACU; settings: WorldSimulationSettings_ACU;
  reads: readonly string[]; storyContext?: AgentStoryContextSnapshot_ACU; requirementsSnapshot?: AgentRequirementSnapshot_ACU | null;
  pendingRequirementSourceIds?: readonly string[]; masterCallsUsed?: number; isCurrent: () => boolean; userInstruction: string;
  /** 冻结表格快照：$TABLE 读取与 tables 搜索的唯一数据源（gate/主控/子代理同一份）。 */
  tableData?: unknown;
  /** 冻结纪要概览文本（共享上下文产出）；进入 runtime context 的 UNTRUSTED_SUMMARY_OVERVIEW。 */
  summaryOverview?: string;
  worldbook?: AgentWorldbookSnapshot_ACU; budget?: WorldSimulationSettings_ACU['budgets']['deep']; history?: readonly WorldSimulationPromptMessage_ACU[];
}
export interface WorldSimulationDirectorRuntimeDependencies_ACU {
  runMaster: (request: { source: string; messages: readonly WorldSimulationPromptMessage_ACU[]; prompt: string }) => Promise<string | null>;
  runSpecialists: (plan: WorldSimulationDelegationPlan_ACU, grantsByAgent: ReadonlyMap<string, readonly AgentMaterialGrant_ACU[]>, specialistModelTurns: number, worldbook: AgentWorldbookSnapshot_ACU, legacy: boolean, shared: { tableData?: unknown; summaryOverview?: string }) => Promise<WorldSimulationAgentLoopResult_ACU>;
  loadWorldbook?: () => Promise<AgentWorldbookSnapshot_ACU>;
}
export interface WorldSimulationDirectorRuntimeResult_ACU {
  action: WorldSimulationMasterAction_ACU; plan: WorldSimulationDelegationPlan_ACU; loop: WorldSimulationAgentLoopResult_ACU | null;
  grants: readonly AgentMaterialGrant_ACU[]; history: readonly WorldSimulationPromptMessage_ACU[];
}
function fail_ACU(code: 'WORLD_SIM_PROTOCOL_INVALID' | 'WORLD_SIM_BUDGET_EXCEEDED', message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'agent', message, false));
}
function flatten_ACU(messages: readonly WorldSimulationPromptMessage_ACU[]): string { return messages.map(message => `[${message.role}]\n${message.content}`).join('\n\n'); }
function emptyPlan_ACU(): WorldSimulationDelegationPlan_ACU { return { delegations: [] }; }

/** Strict main-agent coordinator; it owns no persistent state and cannot write the world ledger. */
export class WorldSimulationDirectorRuntime_ACU {
  async run(input: WorldSimulationDirectorRuntimeInput_ACU, dependencies: WorldSimulationDirectorRuntimeDependencies_ACU): Promise<WorldSimulationDirectorRuntimeResult_ACU> {
    if (!input.runId.trim() || typeof input.isCurrent !== 'function') fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'world-director 运行身份或租约非法');
    const budget = input.budget ?? input.settings.budgets.deep;
    let callsUsed = input.masterCallsUsed ?? 0;
    if (!Number.isInteger(callsUsed) || callsUsed < 0 || callsUsed >= budget.maxMasterModelTurns) fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', 'world-director 已无可用模型轮次');
    let worldbook: AgentWorldbookSnapshot_ACU;
    try { worldbook = input.worldbook ?? await (dependencies.loadWorldbook ?? loadAgentWorldbookSnapshot_ACU)(); }
    catch (_) { worldbook = buildEmptyAgentWorldbookSnapshot_ACU(false); }
    const table: AgentMaterialGrantTable_ACU = { feature: 'world-simulation', runId: input.runId, grants: [] };
    // Keep real conversation history separate from the stable runtime snapshot. Re-rendering a
    // changing tool result inside the prompt prefix defeats natural provider prefix caching.
    const history: WorldSimulationPromptMessage_ACU[] = (input.history ?? []).map(message => ({ ...message }));
    let candidate: WorldSimulationAgentLoopResult_ACU | null = null;
    let candidatePlan = emptyPlan_ACU();
    for (; callsUsed < budget.maxMasterModelTurns; callsUsed += 1) {
      if (!input.isCurrent()) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'world-director 调用前租约已失效');
      const worldbookScan = [input.userInstruction, input.storyContext?.overview.text ?? '', input.storyContext?.pending.text ?? '', input.storyContext?.bridge.text ?? ''].join('\n');
      const messages = renderWorldSimulationMasterMessages_ACU({ agent: WORLD_SIMULATION_DIRECTOR_DEFINITION_ACU, prompts: input.settings.agentPrompts, history, toolsEnabled: input.settings.toolsEnabled, snapshot: input.snapshot, storyClock: input.storyClock, reads: input.reads, storyContext: input.storyContext, summaryOverview: input.summaryOverview, userInstruction: input.userInstruction, requirementsSnapshot: input.requirementsSnapshot, pendingRequirementSourceIds: input.pendingRequirementSourceIds, worldbookCatalog: renderAgentWorldbookCatalog_ACU(worldbook), worldbookHits: renderAgentWorldbookHits_ACU(worldbook, worldbookScan) });
      const runtimeContext = messages.find(message => message.role === 'user' && message.content.includes('【本次运行上下文】'));
      if (runtimeContext) history.push({ ...runtimeContext });
      const raw = await dependencies.runMaster({ source: 'world-sim-master', messages, prompt: flatten_ACU(messages) });
      history.push({ role: 'assistant', content: raw ?? '（模型未返回动作）' });
      const action = parseWorldSimulationMasterAction_ACU(raw);
      if (!input.isCurrent()) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'world-director 返回后租约已失效');
      const pending = input.pendingRequirementSourceIds ?? [];
      if (pending.length && action.kind !== 'maintain_requirements') fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '存在尚未吸收的用户输入时主 Agent 只能输出 maintain_requirements');
      if (!pending.length && action.kind === 'maintain_requirements') fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '当前没有尚未吸收的用户输入，主 Agent 不得自发维护要求');
      if (action.kind === 'maintain_requirements') return { action, plan: emptyPlan_ACU(), loop: null, grants: table.grants, history };
      if (action.kind === 'tools') {
        if (!input.settings.toolsEnabled) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'world-director 工具能力已由设置关闭');
        const result = this.executeTools_ACU(action.calls, input, worldbook, table);
        history.push({ role: 'user', content: `【工具结果】\n${result}` });
        continue;
      }
      if (action.kind === 'delegate') {
        if (action.plan.delegations.length > budget.maxDelegations) fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', 'world-director 派工数量超过预算');
        const resolved = action.plan.delegations.map(item => resolveAgentMaterialGrants_ACU(table, 'world-simulation', input.runId, item.materialGrants));
        const rejected = resolved.find(item => item.kind === 'rejected');
        if (rejected?.kind === 'rejected') fail_ACU('WORLD_SIM_PROTOCOL_INVALID', rejected.reason === 'scope-mismatch' ? '世界书 grant 作用域不匹配' : `未经本轮读取授权的世界书 grant：${rejected.grantId ?? '未知'}`);
        const grantsByAgent = new Map<string, readonly AgentMaterialGrant_ACU[]>();
        action.plan.delegations.forEach((item, index) => grantsByAgent.set(item.agent, resolved[index]?.kind === 'accepted' ? resolved[index].grants : []));
        // Specialists have their own per-agent model-turn cap. A modern delegate still reserves
        // one later director call for finalize/block; legacy bare delegation returns immediately.
        if (!action.legacy && callsUsed + 1 >= budget.maxMasterModelTurns) fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', '派工后未保留主 Agent 收敛轮次');
        candidate = await dependencies.runSpecialists(action.plan, grantsByAgent, budget.maxSpecialistModelTurns, worldbook, action.legacy, { tableData: input.tableData, summaryOverview: input.summaryOverview }); candidatePlan = action.plan;
        if (action.legacy) return { action, plan: candidatePlan, loop: candidate, grants: table.grants, history };
        history.push({ role: 'user', content: `【子代理候选】\n${renderWorldSimulationUntrustedBlock_ACU('UNTRUSTED_SPECIALIST_CANDIDATES', JSON.stringify({ agents: candidate.agentsRun, transactions: candidate.transactions }))}` });
        continue;
      }

      if (action.kind === 'finalize') {
        if (action.decision === 'no_change') {
          if (action.acceptedAgents.length) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'no_change finalize 不得采用子代理候选');
          return { action, plan: emptyPlan_ACU(), loop: null, grants: table.grants, history };
        }
        if (!candidate) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'commit finalize 只能采用本次已返回的候选');
        if (!candidate.transactions.length) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', '空候选不得 finalize 为 commit；应输出 no_change 或 block');
        const returned = new Set(candidate.agentsRun);
        if (!action.acceptedAgents.length || action.acceptedAgents.length !== returned.size || new Set(action.acceptedAgents).size !== action.acceptedAgents.length || action.acceptedAgents.some(name => !returned.has(name))) {
          fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'finalize.acceptedAgents 必须且只能引用本次已返回的子代理候选');
        }
        if (!input.isCurrent()) fail_ACU('WORLD_SIM_PROTOCOL_INVALID', 'world-director 收敛前租约已失效');
        return { action, plan: candidatePlan, loop: candidate, grants: table.grants, history };
      }
      return { action, plan: emptyPlan_ACU(), loop: null, grants: table.grants, history };
    }
    fail_ACU('WORLD_SIM_BUDGET_EXCEEDED', 'world-director 在模型轮次内未收敛');
  }

  private executeTools_ACU(
    calls: readonly AgentKernelToolCall_ACU[], input: WorldSimulationDirectorRuntimeInput_ACU,
    worldbook: AgentWorldbookSnapshot_ACU, table: AgentMaterialGrantTable_ACU,
  ): string {
    const sections: string[] = [];
    for (const call of calls) {
      if (call.kind === 'read') {
        for (const address of call.reads) sections.push(this.readAddress_ACU(address, input, worldbook, table));
        continue;
      }
      const source = this.searchSource_ACU(call.scope, input, worldbook);
      let matcher: RegExp | null = null;
      try { matcher = call.isRegex ? new RegExp(call.query, 'i') : null; } catch (_) { sections.push(`搜索「${call.query}」被拒绝：正则表达式非法。`); continue; }
      const rows = source.split('\n').filter(row => matcher ? matcher.test(row) : row.toLowerCase().includes(call.query.toLowerCase())).slice(0, call.maxResults);
      sections.push(`搜索「${call.query}」结果：${rows.length ? rows.join('\n') : '（无匹配）'}`);
    }
    return renderWorldSimulationUntrustedBlock_ACU('UNTRUSTED_TOOL_RESULTS', sections.join('\n\n') || '（空工具结果）');
  }

  private readAddress_ACU(address: string, input: WorldSimulationDirectorRuntimeInput_ACU, worldbook: AgentWorldbookSnapshot_ACU, table: AgentMaterialGrantTable_ACU): string {
    if (address.startsWith('$WORLDBOOK:')) {
      const entries = resolveAgentWorldbookGrantEntries_ACU(worldbook, address);
      if (!entries.length) return `读取 ${address} 被拒绝：地址不在本轮冻结的已启用世界书快照中。`;
      const codes = this.registerWorldbookGrants_ACU(table, worldbook, address);
      return `${renderAgentWorldbookEntries_ACU(worldbook, ...this.worldbookParts_ACU(address))}\n\n本轮已授予：${codes.join('、')}。`;
    }
    if (address === '$WORLD_STATE' || address === '$LEDGER') return `### ${address}\n${JSON.stringify({ revisions: input.snapshot.revisions, entities: input.snapshot.entities, events: input.snapshot.events, threads: input.snapshot.threads })}`;
    if (address === '$STORY_OVERVIEW') return `### ${address}\n${input.storyContext?.overview.text ?? '（不可用）'}`;
    if (address === '$STORY_PENDING') return `### ${address}\n${input.storyContext?.pending.text ?? '（不可用）'}`;
    if (address === '$STORY_BRIDGE') return `### ${address}\n${input.storyContext?.bridge.text ?? '（不可用）'}`;
    if (address === '$STORY_CATALOG') return `### ${address}\n${input.storyContext?.catalog.text ?? '（不可用）'}`;
    if (address.startsWith('$TABLE:')) {
      const parsed = parseTableAddress_ACU(address);
      if (!parsed) return `读取 ${address} 被拒绝：写法为 $TABLE:表名 或 $TABLE:表名:起始行-结束行（1 基含两端）。`;
      const text = renderAgentTableByName_ACU(parsed.name, input.tableData, parsed.range ?? undefined);
      if (text.includes('不存在名为') || text.includes('读集里的表名为空')) return `读取 ${address} 被拒绝：${text}`;
      const code = this.registerTableGrant_ACU(table, address, text);
      return `### ${address}\n${text}\n\n本轮已授予：${code}。`;
    }
    return `读取 ${address} 被拒绝：world-director 不支持该地址；请从固定正文、账本或冻结世界书目录选择合法地址。`;
  }

  private searchSource_ACU(scope: readonly string[], input: WorldSimulationDirectorRuntimeInput_ACU, worldbook: AgentWorldbookSnapshot_ACU): string {
    const sections: string[] = [];
    if (scope.includes('story')) sections.push(input.storyContext?.overview.text ?? '', input.storyContext?.pending.text ?? '', input.storyContext?.bridge.text ?? '', input.storyContext?.catalog.text ?? '');
    if (scope.includes('ledger')) sections.push(JSON.stringify({ revisions: input.snapshot.revisions, entities: input.snapshot.entities, events: input.snapshot.events, threads: input.snapshot.threads }));
    if (scope.includes('worldbook')) sections.push(worldbook.entries.map(entry => `${entry.title}｜${entry.keys.join('、')}｜$WORLDBOOK:${entry.bookName}:${entry.uid}`).join('\n'));
    if (scope.includes('tables')) sections.push(input.tableData ? '表格数据可搜索；按表名或概览定位后用 read 精读。' : '该运行没有可读取的表格资料。');
    if (scope.includes('proposals')) sections.push('该运行没有可读取的提案资料。');
    return sections.join('\n');
  }

  private worldbookParts_ACU(token: string): [string, string[]] {
    const body = token.slice('$WORLDBOOK:'.length); const separator = body.lastIndexOf(':');
    return [body.slice(0, separator), body.slice(separator + 1).split(/[,，]/).map(item => item.trim()).filter(Boolean)];
  }

  private registerWorldbookGrants_ACU(table: AgentMaterialGrantTable_ACU, worldbook: AgentWorldbookSnapshot_ACU, token: string): string[] {
    const codes: string[] = [];
    for (const entry of resolveAgentWorldbookGrantEntries_ACU(worldbook, token)) {
      const source = createAgentWorldbookGrantSource_ACU(entry);
      const existing = table.grants.find(grant => grant.source.address === source.address && grant.source.revision === source.revision && grant.source.digest === source.digest);
      if (existing) { codes.push(existing.grantId); continue; }
      const grantId = `W${table.grants.length + 1}`;
      table.grants.push({ grantId, source, content: entry.content }); codes.push(grantId);
    }
    return codes;
  }

  /** 成功读取的冻结表格内容登记为本 run 授权资料；同一地址同一内容复用同一 grantId。 */
  private registerTableGrant_ACU(table: AgentMaterialGrantTable_ACU, address: string, content: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < content.length; index += 1) { hash ^= content.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
    const digest = `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    const existing = table.grants.find(grant => grant.source.address === address && grant.source.digest === digest);
    if (existing) return existing.grantId;
    const grantId = `W${table.grants.length + 1}`;
    table.grants.push({ grantId, source:{ address, revision: `${address}:${content.length}`, digest }, content });
    return grantId;
  }
}
