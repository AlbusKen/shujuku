import type { AgentWorldbookControl_ACU } from '../../shared/models/agent-worldbook-model';
import { stripAgentTakeoverMetaBlockStrict_ACU } from '../../shared/agent-worldbook-comment';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import type { StrictLorebookReadContext_ACU } from '../worldbook/pipeline';
import { getAgentRuntimeLorebookEntries_ACU } from './agent-worldbook-runtime-read';
import { normalizeNonNegativeInteger_ACU, normalizePositiveInteger_ACU, logWarn_ACU } from '../../shared/utils';
import { normalizeTkBudgetNumber_ACU } from '../../shared/token-estimate';
import { callAIWithPreset_ACU, isRetryableAiRequestError_ACU } from '../ai/api-call';
import { countTextTokens_ACU } from '../ai/token-counter';
import { normalizePlotTask_ACU } from '../plot/plot-logic';
import { refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU } from './agent-worldbook-takeover';
import {
  parseWorldbookSkillMetaFromComment_ACU,
  stripWorldbookSkillMetaBlock_ACU,
} from './agent-worldbook-skill-meta';
import {
  getDefaultAgentDecisionPromptSegments_ACU,
  normalizeAgentContextSettings_ACU,
  renderAgentPromptSegments_ACU,
} from './agent-prompt-template';
import {
  getWorldbookEntryKeywordsForSkillify_ACU,
  isWorldbookEntrySkillifyCandidate_ACU,
} from './agent-skillify-service';
import { resolveAgentWorldbookScopeBookNames_ACU } from './agent-worldbook-config-meta';
import { rankAgentWorldbookCandidates_ACU, type AgentWorldbookRankingQuery_ACU } from './agent-worldbook-ranking';

export interface AgentWorldbookRef_ACU {
  bookName: string;
  uid: string | number;
  reason?: string;
  index?: number;
  tk?: number;
}

export interface AgentTaskPlanItem_ACU {
  taskId: string;
  run: boolean;
  effectiveStage: number;
  effectiveOrder: number;
  mode?: string;
  reason?: string;
}

export interface AgentDecisionResult_ACU {
  active: boolean;
  fallbackReason?: string;
  rawResponse?: string;
  taskPlan: AgentTaskPlanItem_ACU[];
  plotGreenlights: Record<string, AgentWorldbookRef_ACU[]>;
  finalGenerationGreenlights: AgentWorldbookRef_ACU[];
  effectiveTasks: any[];
}

interface AgentWorldbookSummary_ACU extends AgentWorldbookRef_ACU {
  comment: string;
  keys: string[];
  description: string;
  triggerWhen: string;
  tk: number;
}


function normalizeId_ACU(value: unknown): string {
  return String(value || '').trim();
}

function refKey_ACU(bookName: string, uid: string | number): string {
  return `${bookName}\u0000${String(uid)}`;
}

type AgentContextMessage_ACU = Record<string, any>;

function getMessageText_ACU(message: AgentContextMessage_ACU | null | undefined): string {
  if (!message) return '';
  return String(message.mes ?? message.message ?? message.content ?? '').trim();
}

function getMessageSpeaker_ACU(message: AgentContextMessage_ACU | null | undefined, fallback: string): string {
  const name = String(message?.name || '').trim();
  return name || fallback;
}

function getPlotTextFromMessage_ACU(message: AgentContextMessage_ACU | null | undefined): string {
  if (!message) return '';
  const directPlot = typeof message.qrf_plot === 'string' ? message.qrf_plot.trim() : '';
  if (directPlot) return directPlot;
  const taskPlots = message.qrf_plot_tasks;
  if (!taskPlots || typeof taskPlots !== 'object' || Array.isArray(taskPlots)) return '';
  return Object.entries(taskPlots)
    .map(([taskId, content]) => {
      const text = typeof content === 'string' ? content.trim() : '';
      return text ? `【${taskId}】\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function normalizeMessageArray_ACU(value: unknown): AgentContextMessage_ACU[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as AgentContextMessage_ACU[] : [];
}

function resolveAgentContextMessages_ACU(sharedContext: Record<string, any>, key: string): AgentContextMessage_ACU[] {
  if (sharedContext && Object.prototype.hasOwnProperty.call(sharedContext, key)) {
    return normalizeMessageArray_ACU(sharedContext[key]);
  }
  const fallbackMessages = normalizeMessageArray_ACU(sharedContext?.recentContextMessages);
  if (fallbackMessages.length > 0) return fallbackMessages;
  try {
    return normalizeMessageArray_ACU(getChatArray_ACU());
  } catch {
    return [];
  }
}

function collectRecentAiLayerPairs_ACU(
  messages: AgentContextMessage_ACU[],
  layerLimit: number,
): Array<{ user?: AgentContextMessage_ACU; ai: AgentContextMessage_ACU }> {
  const limit = normalizePositiveInteger_ACU(layerLimit, 1);
  const pairs: Array<{ user?: AgentContextMessage_ACU; ai: AgentContextMessage_ACU }> = [];
  for (let i = messages.length - 1; i >= 0 && pairs.length < limit; i--) {
    const ai = messages[i];
    if (!ai || ai.is_user || ai._qrf_from_planning) continue;
    const previous = i > 0 && messages[i - 1]?.is_user ? messages[i - 1] : undefined;
    pairs.unshift({ user: previous, ai });
  }
  return pairs;
}

function formatRecentContextByAiLayers_ACU(messages: AgentContextMessage_ACU[], layerLimit: number): string {
  const pairs = collectRecentAiLayerPairs_ACU(messages, layerLimit);
  return pairs
    .map((pair, index) => {
      const isLatestLayer = index === pairs.length - 1;
      const lines = [`【最近上下文 AI层 ${index + 1}】`];
      if (isLatestLayer) {
        const userText = getMessageText_ACU(pair.user);
        if (userText) lines.push(`${getMessageSpeaker_ACU(pair.user, '用户')}: ${userText}`);
        const userPlot = getPlotTextFromMessage_ACU(pair.user);
        if (userPlot) lines.push(`剧情推进记录: ${userPlot}`);
      }
      const aiText = getMessageText_ACU(pair.ai);
      if (aiText) lines.push(`${getMessageSpeaker_ACU(pair.ai, 'AI')}: ${aiText}`);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function resolveLegacyPreviousPlotPlaceholder_ACU(recentContext: string, legacyPlotContent: unknown): string {
  if (recentContext) return recentContext;
  return String(legacyPlotContent || '').trim();
}

function extractJsonObjectText_ACU(text: string): string | null {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function emptyDecision_ACU(effectiveTasks: any[], fallbackReason: string): AgentDecisionResult_ACU {
  return {
    active: false,
    fallbackReason,
    taskPlan: [],
    plotGreenlights: {},
    finalGenerationGreenlights: [],
    effectiveTasks,
  };
}

function isAgentModeEnabled_ACU(control: AgentWorldbookControl_ACU | null): boolean {
  return control.enabled === true && control.mode === 'agent';
}

function resolveResolvedAgentWorldbookControl_ACU(params: {
  agentWorldbookControl?: AgentWorldbookControl_ACU | null;
  sharedContext?: Record<string, any>;
  plotSettings?: Record<string, any>;
}): AgentWorldbookControl_ACU | null {
  const direct = params.agentWorldbookControl;
  if (direct && typeof direct === 'object') return direct;
  const fromContext = params.sharedContext?.agentWorldbookControl;
  if (fromContext && typeof fromContext === 'object') return fromContext as AgentWorldbookControl_ACU;
  const fromPlotSettings = params.plotSettings?.agentWorldbookControl;
  return fromPlotSettings && typeof fromPlotSettings === 'object' ? fromPlotSettings as AgentWorldbookControl_ACU : null;
}

function parseAgentDecisionResponse_ACU(responseText: string): any | null {
  const jsonText = extractJsonObjectText_ACU(responseText);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function hasUsableWorldbookSkillMeta_ACU(meta: ReturnType<typeof parseWorldbookSkillMetaFromComment_ACU>): boolean {
  return !!meta && (!!String(meta.description || '').trim() || !!String(meta.triggerWhen || '').trim());
}

function buildFallbackWorldbookSummaryText_ACU(entry: Record<string, any>, comment: string, keys: string[]): { description: string; triggerWhen: string } {
  const normalizedComment = stripWorldbookSkillMetaBlock_ACU(stripAgentTakeoverMetaBlockStrict_ACU(comment)).trim();
  const name = String(entry?.name || '').trim();
  const description = normalizedComment || name || keys.join('、') || '未命名世界书条目';
  const triggerWhen = keys.length > 0
    ? `关键词：${keys.join('、')}`
    : '未提供 Skill 元数据；请根据条目名称与上下文判断是否相关';
  return { description, triggerWhen };
}

interface AgentWorldbookDecisionCandidate_ACU {
  bookName: string;
  uid: string | number;
  comment: string;
  keys: string[];
  description: string;
  triggerWhen: string;
  content: string;
}

function buildDecisionCandidate_ACU(bookName: string, entry: Record<string, any>): AgentWorldbookDecisionCandidate_ACU | null {
  const uid = entry?.uid;
  if (uid === null || uid === undefined || String(uid).trim() === '') return null;
  const comment = String(entry.comment || entry.name || '');
  const meta = parseWorldbookSkillMetaFromComment_ACU(comment);
  const keys = getWorldbookEntryKeywordsForSkillify_ACU(entry);
  const fallback = hasUsableWorldbookSkillMeta_ACU(meta) ? null : buildFallbackWorldbookSummaryText_ACU(entry, comment, keys);
  return {
    bookName,
    uid,
    comment,
    keys,
    description: meta?.description || fallback?.description || '',
    triggerWhen: meta?.triggerWhen || fallback?.triggerWhen || '',
    content: String(entry.content || ''),
  };
}

async function summarizeDecisionCandidates_ACU(
  candidates: AgentWorldbookDecisionCandidate_ACU[],
  limit: number,
  query: AgentWorldbookRankingQuery_ACU,
): Promise<AgentWorldbookSummary_ACU[]> {
  const ranked = rankAgentWorldbookCandidates_ACU(candidates, query).slice(0, limit);
  return Promise.all(ranked.map(async (candidate, index) => ({
    bookName: candidate.bookName,
    uid: candidate.uid,
    index: index + 1,
    comment: candidate.comment,
    keys: candidate.keys,
    description: candidate.description,
    triggerWhen: candidate.triggerWhen,
    tk: await countTextTokens_ACU(candidate.content || candidate.comment),
  })));
}

async function collectWorldbookSummariesFromSnapshot_ACU(
  contextSettings: ReturnType<typeof normalizeAgentContextSettings_ACU>,
  readContext?: StrictLorebookReadContext_ACU,
  rankingQuery: AgentWorldbookRankingQuery_ACU = { userInput: '', recentContext: '', taskContext: '' },
  readOnly = false,
): Promise<{ summaries: AgentWorldbookSummary_ACU[]; allowedKeys: Set<string> }> {
  const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU(readContext, { readOnly });
  const snapshotCandidates: AgentWorldbookDecisionCandidate_ACU[] = [];

  for (const [bookName, snapshotEntries] of Object.entries(snapshot.books || {})) {
    const entries = await getAgentRuntimeLorebookEntries_ACU(bookName, readContext);
    const list = Array.isArray(snapshotEntries) ? snapshotEntries : [];
    for (const snapshotEntry of list) {
      const uid = snapshotEntry?.uid;
      if (uid === null || uid === undefined || String(uid).trim() === '') continue;
      const entry = (entries || []).find(item => String(item?.uid) === String(uid));
      if (!entry) continue;
      const candidate = buildDecisionCandidate_ACU(bookName, entry);
      if (candidate) snapshotCandidates.push(candidate);
    }
  }

  const candidates = snapshotCandidates.length > 0
    ? snapshotCandidates
    : await (async () => {
      const fallbackCandidates: AgentWorldbookDecisionCandidate_ACU[] = [];
      for (const bookName of await resolveAgentWorldbookScopeBookNames_ACU(undefined, readContext)) {
        const entries = await getAgentRuntimeLorebookEntries_ACU(bookName, readContext);
        for (const entry of entries) {
          if (!isWorldbookEntrySkillifyCandidate_ACU(entry)) continue;
          const candidate = buildDecisionCandidate_ACU(bookName, entry);
          if (candidate) fallbackCandidates.push(candidate);
        }
      }
      return fallbackCandidates;
    })();
  const summaries = await summarizeDecisionCandidates_ACU(candidates, contextSettings.decisionWorldbookCandidateLimit, rankingQuery);
  const allowedKeys = new Set(summaries.map(summary => refKey_ACU(summary.bookName, summary.uid)));
  return { summaries, allowedKeys };
}

function formatWorldbookPromptEntries_ACU(
  summaries: AgentWorldbookSummary_ACU[],
  limit: number,
): Array<Pick<AgentWorldbookSummary_ACU, 'index' | 'bookName' | 'uid' | 'description' | 'triggerWhen' | 'tk'> & { tokenEstimate: number; tokenDescription: string }> {
  return summaries.slice(0, limit).map((summary, index) => ({
    index: summary.index || index + 1,
    bookName: summary.bookName,
    uid: summary.uid,
    description: summary.description || '',
    triggerWhen: summary.triggerWhen || '',
    tk: summary.tk,
    tokenEstimate: summary.tk,
    tokenDescription: `预计消耗 ${summary.tk} Token；tk 是兼容字段，与 tokenEstimate 含义相同`,
  }));
}


function trimGreenlightReason_ACU(value: unknown): string {
  const reason = String(value || '').trim();
  return reason.length > 120 ? `${reason.slice(0, 120)}…` : reason;
}

function findWorldbookSummaryByIndex_ACU(index: unknown, summaries: AgentWorldbookSummary_ACU[]): AgentWorldbookSummary_ACU | null {
  const rawIndex = Number(index);
  if (!Number.isFinite(rawIndex) || rawIndex <= 0) return null;
  const normalizedIndex = Math.trunc(rawIndex);
  return summaries.find(summary => summary.index === normalizedIndex) || summaries[normalizedIndex - 1] || null;
}

function pushWorldbookRef_ACU(
  refs: AgentWorldbookRef_ACU[],
  seen: Set<string>,
  allowedKeys: Set<string>,
  bookName: string,
  uid: string | number,
  reason: unknown,
): void {
  if (!bookName || uid === null || uid === undefined || String(uid).trim() === '') return;
  const key = refKey_ACU(bookName, uid);
  if (!allowedKeys.has(key) || seen.has(key)) return;
  seen.add(key);
  refs.push({ bookName, uid, reason: trimGreenlightReason_ACU(reason) });
}

function normalizeIndexedWorldbookRefs_ACU(
  item: unknown,
  summaries: AgentWorldbookSummary_ACU[],
  allowedKeys: Set<string>,
  refs: AgentWorldbookRef_ACU[],
  seen: Set<string>,
): boolean {
  if (typeof item === 'number' || typeof item === 'string') {
    const summary = findWorldbookSummaryByIndex_ACU(item, summaries);
    if (!summary) return true;
    pushWorldbookRef_ACU(refs, seen, allowedKeys, summary.bookName, summary.uid, '');
    return true;
  }
  if (!item || typeof item !== 'object') return false;
  const raw = item as Record<string, unknown>;
  if (Array.isArray(raw.entries)) {
    for (const index of raw.entries) {
      const summary = findWorldbookSummaryByIndex_ACU(index, summaries);
      if (summary) pushWorldbookRef_ACU(refs, seen, allowedKeys, summary.bookName, summary.uid, raw.reason);
    }
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'index')) {
    const summary = findWorldbookSummaryByIndex_ACU(raw.index, summaries);
    if (summary) pushWorldbookRef_ACU(refs, seen, allowedKeys, summary.bookName, summary.uid, raw.reason);
    return true;
  }
  return false;
}

function normalizeWorldbookRefs_ACU(value: unknown, allowedKeys: Set<string>, summaries: AgentWorldbookSummary_ACU[]): AgentWorldbookRef_ACU[] {
  if (!Array.isArray(value)) return [];
  const refs: AgentWorldbookRef_ACU[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (normalizeIndexedWorldbookRefs_ACU(item, summaries, allowedKeys, refs, seen)) continue;
    const bookName = String((item as any)?.bookName || '').trim();
    const uid = (item as any)?.uid;
    pushWorldbookRef_ACU(refs, seen, allowedKeys, bookName, uid, (item as any)?.reason);
  }
  return refs;
}

function applyGreenlightTkBudget_ACU(refs: AgentWorldbookRef_ACU[], summaries: AgentWorldbookSummary_ACU[], maxBudget: number, maxEntries?: unknown): AgentWorldbookRef_ACU[] {
  const entryLimit = normalizePositiveInteger_ACU(maxEntries, refs.length || 1);
  const tkLimit = normalizeTkBudgetNumber_ACU(maxBudget, 0);
  const tkByRef = new Map(summaries.map(summary => [refKey_ACU(summary.bookName, summary.uid), summary.tk]));
  const selected: AgentWorldbookRef_ACU[] = [];
  let usedTk = 0;
  for (const ref of refs) {
    if (selected.length >= entryLimit) break;
    const tk = normalizeTkBudgetNumber_ACU(tkByRef.get(refKey_ACU(ref.bookName, ref.uid)), 0);
    if (tkLimit > 0 && usedTk + tk > tkLimit) continue;
    usedTk += tk;
    selected.push({ bookName: ref.bookName, uid: ref.uid, reason: ref.reason });
  }
  return selected;
}

function shouldSendPlotTaskToAgent_ACU(task: any): boolean {
  if (task?.agentControl?.selectable === false) return false;
  const description = String(task?.description || '').trim();
  const triggerWhen = String(task?.triggerWhen || '').trim();
  return !!(description || triggerWhen);
}

function hasDependencyCycle_ACU(taskIds: Set<string>, tasksById: Map<string, any>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): boolean => {
    if (visited.has(taskId)) return false;
    if (visiting.has(taskId)) return true;
    visiting.add(taskId);
    const deps = Array.isArray(tasksById.get(taskId)?.agentControl?.dependsOnTaskIds)
      ? tasksById.get(taskId).agentControl.dependsOnTaskIds
      : [];
    for (const dep of deps) {
      const depId = normalizeId_ACU(dep);
      if (taskIds.has(depId) && visit(depId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };
  return Array.from(taskIds).some(visit);
}

function sortEffectiveTasks_ACU(tasks: any[]): any[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftStage = normalizePositiveInteger_ACU(left.task?.stage, 1);
      const rightStage = normalizePositiveInteger_ACU(right.task?.stage, 1);
      if (leftStage !== rightStage) return leftStage - rightStage;
      const leftOrder = normalizeNonNegativeInteger_ACU(left.task?.order, 0);
      const rightOrder = normalizeNonNegativeInteger_ACU(right.task?.order, 0);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.index - right.index;
    })
    .map(item => item.task);
}

function normalizeTaskPlan_ACU(rawPlan: unknown, enabledTasks: any[], userOrderedTasks: any[] = []): { plan: AgentTaskPlanItem_ACU[]; effectiveTasks: any[]; reason?: string } {
  const normalizedTasks = enabledTasks.map((task, index) => normalizePlotTask_ACU(task, { index, fallbackTask: task }));
  const normalizedUserOrderedTasks = userOrderedTasks.map((task, index) => normalizePlotTask_ACU(task, { index, fallbackTask: task }));
  if (!Array.isArray(rawPlan)) {
    if (normalizedTasks.length === 0 && normalizedUserOrderedTasks.length > 0) {
      return { plan: [], effectiveTasks: sortEffectiveTasks_ACU(normalizedUserOrderedTasks) };
    }
    if (normalizedTasks.length === 0) return { plan: [], effectiveTasks: [] };
    return { plan: [], effectiveTasks: enabledTasks, reason: 'missing_task_plan' };
  }
  const tasksById = new Map(normalizedTasks.map(task => [String(task.id), task]));
  const plan: AgentTaskPlanItem_ACU[] = [];
  const effectiveTasks: any[] = [];
  const selectedIds = new Set<string>();

  for (const item of rawPlan) {
    const taskId = normalizeId_ACU((item as any)?.taskId);
    const sourceTask = tasksById.get(taskId);
    if (!sourceTask) continue;
    if (sourceTask.agentControl?.selectable === false) {
      plan.push({ taskId, run: false, effectiveStage: sourceTask.stage || 1, effectiveOrder: sourceTask.order || 0, mode: String((item as any)?.mode || '').trim(), reason: 'task_not_selectable' });
      continue;
    }
    const run = (item as any)?.run !== false;
    const effectiveStage = normalizePositiveInteger_ACU((item as any)?.effectiveStage, sourceTask.stage || 1);
    const effectiveOrder = normalizeNonNegativeInteger_ACU((item as any)?.effectiveOrder, sourceTask.order || 0);
    plan.push({ taskId, run, effectiveStage, effectiveOrder, mode: String((item as any)?.mode || '').trim(), reason: String((item as any)?.reason || '').trim() });
    if (run) {
      selectedIds.add(taskId);
      effectiveTasks.push({ ...sourceTask, stage: effectiveStage, order: effectiveOrder, __agentEffective: true });
    }
  }

  const effectiveIds = new Set(effectiveTasks.map(task => String(task.id)));
  for (const task of normalizedUserOrderedTasks) {
    if (!task.id || effectiveIds.has(String(task.id))) continue;
    effectiveIds.add(String(task.id));
    effectiveTasks.push(task);
  }

  if (plan.length === 0) {
    if (effectiveTasks.length > 0) return { plan: [], effectiveTasks: sortEffectiveTasks_ACU(effectiveTasks) };
    if (normalizedTasks.length === 0) return { plan: [], effectiveTasks: [] };
    return { plan: [], effectiveTasks: enabledTasks, reason: 'no_valid_task_plan_items' };
  }
  if (selectedIds.size > 0 && hasDependencyCycle_ACU(selectedIds, tasksById)) {
    return { plan: [], effectiveTasks: enabledTasks, reason: 'task_dependency_cycle' };
  }
  return { plan, effectiveTasks: sortEffectiveTasks_ACU(effectiveTasks) };
}

interface AgentDecisionShard_ACU {
  index: number;
  summaries: AgentWorldbookSummary_ACU[];
  allowedKeys: Set<string>;
  minTkBudget: number;
  maxTkBudget: number;
}

interface AgentDecisionShardResult_ACU {
  shard: AgentDecisionShard_ACU;
  rawResponse: string;
  parsed: any;
}

function createAgentDecisionShards_ACU(
  summaries: AgentWorldbookSummary_ACU[],
  candidateLimit: number,
  configuredConcurrency: unknown,
  minTkBudget: number,
  maxTkBudget: number,
): AgentDecisionShard_ACU[] {
  const candidates = summaries.slice(0, normalizePositiveInteger_ACU(candidateLimit, summaries.length || 1));
  if (candidates.length === 0) return [];
  const shardCount = Math.min(candidates.length, Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(configuredConcurrency) || 1))));
  const entriesPerShard = Math.floor(candidates.length / shardCount);
  const entryRemainder = candidates.length % shardCount;
  const totalMinBudget = normalizeTkBudgetNumber_ACU(minTkBudget, 0);
  const budgetPerShard = Math.floor(totalMinBudget / shardCount);
  const budgetRemainder = totalMinBudget % shardCount;
  const totalMaxBudget = normalizeTkBudgetNumber_ACU(maxTkBudget, 0);
  const maxBudgetPerShard = Math.floor(totalMaxBudget / shardCount);
  const maxBudgetRemainder = totalMaxBudget % shardCount;
  const shards: AgentDecisionShard_ACU[] = [];
  let offset = 0;
  for (let index = 0; index < shardCount; index++) {
    const size = entriesPerShard + (index < entryRemainder ? 1 : 0);
    const shardSummaries = candidates.slice(offset, offset + size).map((summary, localIndex) => ({ ...summary, index: localIndex + 1 }));
    offset += size;
    shards.push({
      index,
      summaries: shardSummaries,
      allowedKeys: new Set(shardSummaries.map(summary => refKey_ACU(summary.bookName, summary.uid))),
      minTkBudget: budgetPerShard + (index < budgetRemainder ? 1 : 0),
      maxTkBudget: maxBudgetPerShard + (index < maxBudgetRemainder ? 1 : 0),
    });
  }
  return shards;
}

function mergeWorldbookRefs_ACU(groups: AgentWorldbookRef_ACU[][]): AgentWorldbookRef_ACU[] {
  const seen = new Set<string>();
  const result: AgentWorldbookRef_ACU[] = [];
  for (const refs of groups) {
    for (const ref of refs) {
      const key = refKey_ACU(ref.bookName, ref.uid);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}

function buildAgentDecisionPrompt_ACU(params: {
  plotSettings: Record<string, any>;
  userMessage: string;
  sharedContext: Record<string, any>;
  enabledTasks: any[];
  worldbookSummaries: AgentWorldbookSummary_ACU[];
  contextSettings: ReturnType<typeof normalizeAgentContextSettings_ACU>;
  minTkBudget?: number;
  maxTkBudget?: number;
  shardIndex?: number;
  shardCount?: number;
}): Array<{ role: string; content: string }> {
  const taskSummaries = params.enabledTasks.map((task, index) => {
    const normalized = normalizePlotTask_ACU(task, { index, fallbackTask: task });
    return {
      taskId: normalized.id,
      name: normalized.name,
      stage: normalized.stage,
      order: normalized.order,
      description: normalized.description || '',
      triggerWhen: normalized.triggerWhen || '',
      agentControl: normalized.agentControl || {},
    };
  }).filter(task => shouldSendPlotTaskToAgent_ACU(task));

  const control = params.plotSettings?.agentWorldbookControl || {};
  const recentContextMessages = resolveAgentContextMessages_ACU(params.sharedContext, 'recentContextMessages');
  const recentContext = formatRecentContextByAiLayers_ACU(recentContextMessages, params.contextSettings.decisionRecentContextCharLimit)
    || String(params.sharedContext?.seedContentForConditional || '').trim();
  const previousPlot = resolveLegacyPreviousPlotPlaceholder_ACU(recentContext, params.sharedContext?.lastPlotContent);

  const placeholders = {
    'agent.userMessage': params.userMessage || '',
    'agent.previousPlot': previousPlot,
    'agent.recentContext': recentContext,
    'agent.tasksJson': taskSummaries,
    'agent.worldbookEntriesJson': formatWorldbookPromptEntries_ACU(params.worldbookSummaries, params.contextSettings.decisionWorldbookCandidateLimit),
    'agent.maxEntriesPerChannelJson': control.maxEntriesPerChannel || {},
    'agent.greenlightTkBudgetJson': {
      unit: 'Token',
      min: params.minTkBudget ?? params.contextSettings.greenlightMinTkBudget,
      max: params.maxTkBudget ?? params.contextSettings.greenlightMaxTkBudget,
      selectionRule: '每个通道和每个任务必须优先选择相关条目；相关条目足够时尽可能超过 min；相关条目总 Token 不足 min 时全选相关条目；任何情况下不得超过 max；不得为凑 min 选择无关条目。',
    },
    'agent.shard.index': (params.shardIndex ?? 0) + 1,
    'agent.shard.count': params.shardCount ?? 1,
    'agent.shard.candidateCount': params.worldbookSummaries.length,
    'agent.outputSchemaJson': {
      taskPlan: [{ taskId: '...', run: true, effectiveStage: 1, effectiveOrder: 0, mode: 'sequential', reason: '...' }],
      plotGreenlights: { taskId: [{ entries: [1, 2], reason: '每个编号一句话说明；也兼容旧 bookName/uid 格式' }] },
      finalGenerationGreenlights: [{ entries: [1], reason: '一句话说明；也兼容旧 bookName/uid 格式' }],
      fallbackMode: false,
      reason: '...',
    },
  };
  const messages = renderAgentPromptSegments_ACU(
    control.agentDecisionPromptSegments || getDefaultAgentDecisionPromptSegments_ACU(),
    placeholders,
    { enableSqlRender: true, promptKind: 'decision', sqlReadContext: params.sharedContext.requestContext?.sqlReadContext },
  );

  return messages.length > 0
    ? messages
    : renderAgentPromptSegments_ACU(getDefaultAgentDecisionPromptSegments_ACU(), placeholders, {
      enableSqlRender: true, promptKind: 'decision', sqlReadContext: params.sharedContext.requestContext?.sqlReadContext,
    });
}

function normalizePlotGreenlights_ACU(
  raw: unknown,
  allowedKeys: Set<string>,
  enabledTaskIds: Set<string>,
  summaries: AgentWorldbookSummary_ACU[],
  maxBudget: number,
  maxEntriesPerChannel: Record<string, unknown>,
  applyLimits = true,
): Record<string, AgentWorldbookRef_ACU[]> {
  const result: Record<string, AgentWorldbookRef_ACU[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [taskIdRaw, refs] of Object.entries(raw as Record<string, unknown>)) {
    const taskId = normalizeId_ACU(taskIdRaw);
    if (!enabledTaskIds.has(taskId)) continue;
    const resolvedRefs = normalizeWorldbookRefs_ACU(refs, allowedKeys, summaries);
    const normalizedRefs = applyLimits
      ? applyGreenlightTkBudget_ACU(resolvedRefs, summaries, maxBudget, maxEntriesPerChannel.plot)
      : resolvedRefs;
    if (normalizedRefs.length > 0) result[taskId] = normalizedRefs;
  }
  return result;
}

async function runAgentDecisionShard_ACU(params: {
  shard: AgentDecisionShard_ACU;
  shardCount: number;
  plotSettings: Record<string, any>;
  userMessage: string;
  sharedContext: Record<string, any>;
  enabledTasks: any[];
  contextSettings: ReturnType<typeof normalizeAgentContextSettings_ACU>;
  presetName: string;
  maxAiAttempts: number;
}): Promise<AgentDecisionShardResult_ACU> {
  const requestContext = params.sharedContext.requestContext as import('../runtime/plot-runtime/plot-request-context').PlotRequestContext_ACU | undefined;
  requestContext?.assertCurrent();
  const messages = buildAgentDecisionPrompt_ACU({
    plotSettings: params.plotSettings,
    userMessage: params.userMessage,
    sharedContext: params.sharedContext,
    enabledTasks: params.enabledTasks,
    worldbookSummaries: params.shard.summaries,
    contextSettings: params.contextSettings,
    minTkBudget: params.shard.minTkBudget,
    maxTkBudget: params.shard.maxTkBudget,
    shardIndex: params.shard.index,
    shardCount: params.shardCount,
  });
  let rawResponse = '';
  let failureReason = 'empty_agent_response';
  for (let attempt = 1; attempt <= params.maxAiAttempts; attempt++) {
    try {
      requestContext?.assertCurrent();
      rawResponse = requestContext
        ? await requestContext.callApi(messages, params.presetName)
        : await callAIWithPreset_ACU(messages, params.presetName);
      requestContext?.assertCurrent();
    } catch (error: any) {
      requestContext?.assertCurrent();
      failureReason = 'agent_request_error';
      const retryable = isRetryableAiRequestError_ACU(error);
      logWarn_ACU(`[Agent决策] 分片 ${params.shard.index + 1}/${params.shardCount} 第 ${attempt}/${params.maxAiAttempts} 次请求失败；${retryable ? '允许重试' : '不可重试'}；候选 ${params.shard.summaries.length} 条：${String(error?.message || 'unknown')}`);
      if (!retryable) break;
      continue;
    }
    if (!rawResponse) {
      failureReason = 'empty_agent_response';
      continue;
    }
    const parsed = parseAgentDecisionResponse_ACU(rawResponse);
    if (parsed && parsed.fallbackMode !== true) return { shard: params.shard, rawResponse, parsed };
    failureReason = parsed?.reason || 'invalid_agent_response';
  }
  throw new Error(`agent_decision_shard_${params.shard.index + 1}_failed:${failureReason}`);
}

export async function runAgentDecisionForPlot_ACU(params: {
  plotSettings: Record<string, any>;
  agentWorldbookControl?: AgentWorldbookControl_ACU | null;
  userMessage: string;
  sharedContext: Record<string, any>;
  enabledTasks: any[];
  requireTaskPlan?: boolean;
}): Promise<AgentDecisionResult_ACU> {
  const originalTasks = Array.isArray(params.enabledTasks) ? params.enabledTasks : [];
  const requestContext = params.sharedContext.requestContext as import('../runtime/plot-runtime/plot-request-context').PlotRequestContext_ACU | undefined;
  try {
    requestContext?.assertCurrent();
    const control = resolveResolvedAgentWorldbookControl_ACU(params);
    if (!isAgentModeEnabled_ACU(control)) return emptyDecision_ACU(originalTasks, 'agent_mode_disabled');

    const effectivePlotSettings = { ...params.plotSettings, agentWorldbookControl: control };
    const contextSettings = normalizeAgentContextSettings_ACU(control.contextSettings);
    const maxAiAttempts = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(contextSettings.agentAiMaxRetries) || 1)));
    const readContext = params.sharedContext?.worldbookReadContext as StrictLorebookReadContext_ACU | undefined;
    const recentContext = formatRecentContextByAiLayers_ACU(
      resolveAgentContextMessages_ACU(params.sharedContext, 'recentContextMessages'),
      contextSettings.decisionRecentContextCharLimit,
    ) || String(params.sharedContext?.seedContentForConditional || '').trim();
    const taskContext = originalTasks.map((task, index) => {
      const normalized = normalizePlotTask_ACU(task, { fallbackTask: task, index });
      return `${normalized.description || ''}\n${normalized.triggerWhen || ''}`;
    }).join('\n');
    const { summaries } = await collectWorldbookSummariesFromSnapshot_ACU(contextSettings, readContext, {
      userInput: params.userMessage,
      recentContext,
      taskContext,
    }, requestContext !== undefined);
    requestContext?.assertCurrent();
    const shards = createAgentDecisionShards_ACU(
      summaries,
      contextSettings.decisionWorldbookCandidateLimit,
      control.agentDecisionConcurrency,
      contextSettings.greenlightMinTkBudget,
      contextSettings.greenlightMaxTkBudget,
    );
    if (shards.length === 0) return emptyDecision_ACU(originalTasks, 'empty_worldbook_scope');
    const agentDecidableTasks = originalTasks.filter(task => shouldSendPlotTaskToAgent_ACU(normalizePlotTask_ACU(task, { fallbackTask: task })));
    const userOrderedTasks = originalTasks.filter(task => !shouldSendPlotTaskToAgent_ACU(normalizePlotTask_ACU(task, { fallbackTask: task })) && task?.agentControl?.selectable !== false);
    const presetName = String(control.agentApiPreset || '').trim();
    const settled = await Promise.allSettled(shards.map(shard => runAgentDecisionShard_ACU({
      shard,
      shardCount: shards.length,
      plotSettings: effectivePlotSettings,
      userMessage: params.userMessage,
      sharedContext: params.sharedContext,
      enabledTasks: agentDecidableTasks,
      contextSettings,
      presetName,
      maxAiAttempts,
    })));
    requestContext?.assertCurrent();
    if (requestContext) {
      const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    }
    const successfulShards = settled
      .filter((result): result is PromiseFulfilledResult<AgentDecisionShardResult_ACU> => result.status === 'fulfilled')
      .map(result => result.value)
      .sort((left, right) => left.shard.index - right.shard.index);
    if (successfulShards.length === 0) {
      const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      const reason = String(firstFailure?.reason?.message || 'agent_decision_error').split(':').pop() || 'agent_decision_error';
      return emptyDecision_ACU(originalTasks, reason);
    }
    if (successfulShards.length !== shards.length) {
      logWarn_ACU(`[Agent决策] 分片部分失败，成功 ${successfulShards.length}/${shards.length}；仅合并成功分片结果。`);
    }

    const authority = successfulShards.find(result => result.shard.index === 0);
    const normalizedPlan = params.requireTaskPlan === false || !authority
      ? { plan: [] as AgentTaskPlanItem_ACU[], effectiveTasks: originalTasks }
      : normalizeTaskPlan_ACU(authority.parsed.taskPlan, agentDecidableTasks, userOrderedTasks);
    if (authority && params.requireTaskPlan !== false && normalizedPlan.reason) {
      if (requestContext) throw new Error(normalizedPlan.reason);
      return emptyDecision_ACU(originalTasks, normalizedPlan.reason);
    }
    const effectivePlan = normalizedPlan.reason
      ? { plan: [] as AgentTaskPlanItem_ACU[], effectiveTasks: originalTasks }
      : normalizedPlan;

    const enabledTaskIds = new Set(agentDecidableTasks
      .map((task, index) => normalizePlotTask_ACU(task, { index, fallbackTask: task }))
      .filter(task => task.agentControl?.selectable !== false)
      .map(task => task.id)
      .filter(Boolean));
    const maxEntriesPerChannel: AgentWorldbookControl_ACU['maxEntriesPerChannel'] = control?.maxEntriesPerChannel || {
      plot: 0,
      tableFill: 0,
      finalGeneration: 0,
    };
    const plotRefsByTask: Record<string, AgentWorldbookRef_ACU[][]> = {};
    const finalRefGroups: AgentWorldbookRef_ACU[][] = [];
    for (const result of successfulShards) {
      const shardPlotGreenlights = normalizePlotGreenlights_ACU(
        result.parsed.plotGreenlights,
        result.shard.allowedKeys,
        enabledTaskIds,
        result.shard.summaries,
        contextSettings.greenlightMaxTkBudget,
        maxEntriesPerChannel,
        false,
      );
      for (const [taskId, refs] of Object.entries(shardPlotGreenlights)) {
        (plotRefsByTask[taskId] ||= []).push(refs);
      }
      finalRefGroups.push(normalizeWorldbookRefs_ACU(result.parsed.finalGenerationGreenlights, result.shard.allowedKeys, result.shard.summaries));
    }
    const plotGreenlights: Record<string, AgentWorldbookRef_ACU[]> = {};
    for (const [taskId, groups] of Object.entries(plotRefsByTask)) {
      const refs = applyGreenlightTkBudget_ACU(mergeWorldbookRefs_ACU(groups), summaries, contextSettings.greenlightMaxTkBudget, maxEntriesPerChannel.plot);
      if (refs.length > 0) plotGreenlights[taskId] = refs;
    }
    const finalGenerationGreenlights = applyGreenlightTkBudget_ACU(
      mergeWorldbookRefs_ACU(finalRefGroups),
      summaries,
      contextSettings.greenlightMaxTkBudget,
      maxEntriesPerChannel.finalGeneration,
    );

    return {
      active: true,
      rawResponse: authority?.rawResponse || successfulShards[0].rawResponse,
      taskPlan: effectivePlan.plan,
      plotGreenlights,
      finalGenerationGreenlights,
      effectiveTasks: effectivePlan.effectiveTasks,
    };
  } catch (error) {
    if (requestContext) throw error;
    logWarn_ACU('[Agent决策] 决策失败，回退原剧情推进逻辑:', error);
    return emptyDecision_ACU(originalTasks, 'agent_decision_error');
  }
}
