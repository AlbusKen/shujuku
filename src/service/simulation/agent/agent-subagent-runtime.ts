import { USER_PREFILL_CONTENT_ACU } from '../../../shared/user-prefill.js';
import { WORLD_CHRONICLE_HOT_WINDOW_ACU } from '../model';
import type {
  WorldSimulationLedger_ACU,
  WorldSimulationLedgerFieldSnapshot_ACU,
  WorldSimulationLedgerModule_ACU,
  WorldSimulationPendingFixSource_ACU,
  WorldSimulationSettings_ACU,
} from '../model';
import { resolveWorldSimulationAgentApiPreset_ACU, type WorldSimulationApiPresetDependencies_ACU, type WorldSimulationResolvedApiPreset_ACU } from '../api-preset';
import { stripWritingAnnotations_ACU } from '../simulation-projection';
import { preflightWorldSimulationCandidates_ACU } from '../simulation-transaction';
import { buildInUseWorldCatalog_ACU } from '../world-catalog';
import type { WorldSimulationEvidenceRegistry_ACU, WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { runWorldSimulationToolBatch_ACU, type WorldSimulationReadRoundState_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
import type { WorldSimulationFieldCommitReceipt_ACU } from '../simulation-field-commit-adapter';
import { findWorldSimulationAgentDefinition_ACU, getWorldSimulationAgentAccessProfile_ACU, worldSimulationAgentNativeTools_ACU, worldSimulationCanReadAddress_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import { buildV20WorldSimulationAgentPrompt_ACU } from './agent-defaults';
import { WORLD_SIMULATION_AGENT_PREFILLS_ACU, renderWorldSimulationWriteRepair_ACU, worldSimulationReviewerRuntimeProtocolInstruction_ACU, worldSimulationSpecialistRuntimeProtocolInstruction_ACU, type WorldSimulationOneShotRole_ACU } from './agent-defaults';
import type {
  WorldSimulationCandidate_ACU,
  WorldSimulationDelegation_ACU,
  WorldSimulationReviewerResult_ACU,
  WorldSimulationSpecialistResult_ACU,
  WorldSimulationSubagentIssue_ACU,
  WorldSimulationSubagentOutcome_ACU,
} from './agent-model';
import { createWorldSimulationPlaceholderResolvers_ACU, isWorldSimulationLedgerContext_ACU, type WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { createWorldSimulationProtocolRepairState_ACU, normalizeOneShotSpecialistPayload_ACU, parseWorldSimulationSubagentToolCalls_ACU, parseWorldSimulationJsonDraft_ACU, parseWorldSimulationJsonPayload_ACU, parseWorldSimulationMainAction_ACU, parseWorldSimulationMainOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationReviewerProtocolRejection_ACU, renderWorldSimulationSpecialistProtocolRejection_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU, resolveWorldSimulationReadBudget_ACU } from './agent-read-gate';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './prompt-template';
import { renderWorldSimulationSnapshotSections_ACU, splitWorldSimulationSubagentPrompt_ACU, verifyWorldSimulationSnapshotSections_ACU, verifyWorldSimulationFixedWorldbook_ACU, type WorldSimulationFixedWorldbook_ACU } from './agent-shared-materials';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { agentNativeTools_ACU, nativeToolArguments_ACU, nativeToolExchange_ACU, normalizeAgentModelReply_ACU, withNativeToolThinkPrefill_ACU, type AiChatTurn_ACU, type AiNativeToolCall_ACU, type AiWireMessage_ACU } from '../../ai/native-tool';

export interface WorldSimulationAgentInvoker_ACU { (agentName: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[], preset: WorldSimulationResolvedApiPreset_ACU, nativeTools?: readonly import('../../ai/native-tool').AgentNativeToolName_ACU[]): Promise<string | AiChatTurn_ACU>; }
export interface WorldSimulationSubagentRuntimeDependencies_ACU { invoke: WorldSimulationAgentInvoker_ACU; countTokens?: WorldSimulationTokenCounter_ACU; apiPreset?: WorldSimulationApiPresetDependencies_ACU; protocolRetries?: number; }
export interface WorldSimulationSubagentRunInput_ACU {
  delegation: WorldSimulationDelegation_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  runId: string;
  roundId?: string;
  readRoundState?: WorldSimulationReadRoundState_ACU;
  candidateSeq?: number;
  writableModules?: readonly WorldSimulationLedgerModule_ACU[];
  writeSql?: (input: { role: string; sql: string; evidenceRegistry: WorldSimulationEvidenceRegistrySnapshot_ACU; declaredEvidenceRefs: readonly string[]; allowedModules: readonly WorldSimulationLedgerModule_ACU[]; isCurrent?: () => boolean }) => Promise<WorldSimulationFieldCommitReceipt_ACU>;
  readCurrent?: () => WorldSimulationLedger_ACU;
  readFieldSnapshot?: () => WorldSimulationLedgerFieldSnapshot_ACU;
  isCurrent?: () => boolean;
  /** 主会话快照里未单独注入的部分，以及主会话已经读到的全文。 */
  directorMaterials?: string;
  /** 本轮关键词已触发的世界书全文。导演与各子代理共用，不再自行精读条目。 */
  triggeredWorldbook?: string;
  fixedWorldbook?: WorldSimulationFixedWorldbook_ACU;
}
export interface WorldSimulationReviewInput_ACU { candidates: readonly WorldSimulationCandidate_ACU[]; settings: WorldSimulationSettings_ACU; promptContext: WorldSimulationPlaceholderContext_ACU; registry: WorldSimulationEvidenceRegistry_ACU; tools: WorldSimulationToolDependencies_ACU; isCurrent?: () => boolean; roundId?: string; readRoundState?: WorldSimulationReadRoundState_ACU; directorMaterials?: string; triggeredWorldbook?: string; fixedWorldbook?: WorldSimulationFixedWorldbook_ACU; }

export interface WorldSimulationOneShotInput_ACU {
  agentName: WorldSimulationOneShotRole_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  runId: string;
  candidateSeq: number;
  focus: string;
  anchorEvidenceRef: string;
  givenLedger: WorldSimulationLedger_ACU;
  baseLedgerRevision: number;
  roundChanges?: string;
  injectWorldbook: boolean;
  triggeredWorldbook?: string;
  fixedWorldbook?: WorldSimulationFixedWorldbook_ACU;
  isCurrent?: () => boolean;
}


function candidate_ACU(
  result: Extract<WorldSimulationSpecialistResult_ACU, { status: 'candidate' }>,
  writableModules: readonly string[],
  runId: string,
  candidateSeq: number,
): WorldSimulationCandidate_ACU {
  const keys = Object.keys(result.patch);
  const denied = keys.filter(key => key === 'chronicleArchive' ? !writableModules.includes('chronicle') : !writableModules.includes(key));
  if (denied.length) throw new Error(`WORLD_SIMULATION_PATCH_SCOPE_DENIED:${denied.join(',')}`);
  const candidateId = `${runId}:${result.agentName}:${candidateSeq}`;
  return { candidateId, agentName: result.agentName, patch: result.patch, summary: result.summary, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties, writableModules: [...writableModules] };
}


function withTask_ACU(
  context: WorldSimulationPlaceholderContext_ACU,
  task: unknown,
  candidates?: readonly WorldSimulationCandidate_ACU[],
  writableModules?: readonly string[],
): WorldSimulationPlaceholderContext_ACU {
  return {
    ...context,
    task,
    worldCandidates: candidates ?? context.worldCandidates,
    evidenceRegistry: context.evidenceRegistry,
    candidateView: candidates ? 'full' : context.candidateView,
    writableModules: writableModules ?? context.writableModules,
  };
}

function bindSpecialistIdentity_ACU(payload: Record<string, unknown>, agentName: WorldSimulationAgentName_ACU): Record<string, unknown> {
  const supplied = typeof payload.agentName === 'string' ? payload.agentName.trim() : '';
  return supplied ? payload : { ...payload, agentName };
}

const ITEM_PATCH_MODULES_ACU = new Set<WorldSimulationLedgerModule_ACU>(['dimensions', 'seeds', 'actors', 'rumors']);

function patchModule_ACU(key: string): WorldSimulationLedgerModule_ACU | null {
  if (key === 'chronicleArchive') return 'chronicle';
  return ['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player'].includes(key)
    ? key as WorldSimulationLedgerModule_ACU
    : null;
}

function protocolPath_ACU(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const wrapped = error as { error?: { details?: Record<string, unknown> } };
  return typeof wrapped.error?.details?.path === 'string' ? wrapped.error.details.path : fallback;
}

function issue_ACU(
  module: WorldSimulationLedgerModule_ACU,
  source: WorldSimulationPendingFixSource_ACU,
  error: unknown,
  fallbackPath: string,
  id?: string,
): WorldSimulationSubagentIssue_ACU {
  return {
    module,
    source,
    path: protocolPath_ACU(error, fallbackPath),
    message: error instanceof Error ? error.message : String(error),
    ...(id ? { id } : {}),
  };
}

function acceptedPatchKeys_ACU(patch: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [rawModule, value] of Object.entries(patch)) {
    const module = patchModule_ACU(rawModule);
    if (!module) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const items = [...(Array.isArray(record.upsert) ? record.upsert : []), ...(Array.isArray(record.append) ? record.append : []), ...(Array.isArray(record.remove) ? record.remove : [])];
      if (items.length) {
        items.forEach((item, index) => {
          const id = item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string'
            ? String((item as Record<string, unknown>).id).trim()
            : '';
          keys.push(`${module}:${id || `index:${index}`}`);
        });
        continue;
      }
    }
    keys.push(`${module}:$`);
  }
  return keys;
}

function outcomeFromSpecialistResult_ACU(
  result: WorldSimulationSpecialistResult_ACU,
  writableModules: readonly WorldSimulationLedgerModule_ACU[],
  runId: string,
  candidateSeq: number,
  truncated: boolean,
): WorldSimulationSubagentOutcome_ACU {
  const moduleCompletion: WorldSimulationSubagentOutcome_ACU['moduleCompletion'] = {};
  const unresolvedIssues: WorldSimulationSubagentIssue_ACU[] = [];
  if (result.status === 'candidate') {
    const candidate = candidate_ACU(result, writableModules, runId, candidateSeq);
    const acceptedKeys = acceptedPatchKeys_ACU(result.patch);
    for (const module of writableModules) {
      const changed = Object.keys(result.patch).some(key => patchModule_ACU(key) === module);
      moduleCompletion[module] = truncated ? (changed ? 'partial' : 'failed') : (changed ? 'complete_changed' : 'complete_no_change');
      if (truncated) unresolvedIssues.push({ module, source: 'truncated', path: `$.patch.${module}`, message: 'specialist JSON 在输出中途截断，尾部写集尚未确认完整' });
    }
    return {
      agentName: result.agentName,
      status: 'candidate',
      summary: result.summary,
      candidate,
      evidenceRefs: result.evidenceRefs,
      uncertainties: result.uncertainties,
      completion: truncated ? 'partial' : 'complete_changed',
      moduleCompletion,
      unresolvedIssues,
      acceptedKeys,
    };
  }
  if (result.status === 'no_change') {
    for (const module of writableModules) {
      moduleCompletion[module] = truncated ? 'failed' : 'complete_no_change';
      if (truncated) unresolvedIssues.push({ module, source: 'truncated', path: module, message: 'no_change 输出被截断，不能据此确认模块完整' });
    }
    return { agentName: result.agentName, status: result.status, summary: result.summary, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties, completion: truncated ? 'failed' : 'complete_no_change', moduleCompletion, unresolvedIssues, acceptedKeys: [] };
  }
  for (const module of writableModules) moduleCompletion[module] = 'failed';
  const message = result.status === 'blocked' ? result.unresolved.join('；') : result.message;
  const source: WorldSimulationPendingFixSource_ACU = 'protocol_failed';
  for (const module of writableModules) unresolvedIssues.push({ module, source, path: module, message });
  return result.status === 'blocked'
    ? { agentName: result.agentName, status: result.status, summary: 'blocked', evidenceRefs: [], uncertainties: [], unresolved: result.unresolved, completion: 'failed', moduleCompletion, unresolvedIssues, acceptedKeys: [] }
    : { agentName: result.agentName, status: result.status, summary: result.message, evidenceRefs: [], uncertainties: [], reasonCode: result.reasonCode, completion: 'failed', moduleCompletion, unresolvedIssues, acceptedKeys: [] };
}

export function salvageCandidateOutcome_ACU(
  payload: Record<string, unknown>,
  writableModules: readonly WorldSimulationLedgerModule_ACU[],
  snapshot: WorldSimulationEvidenceRegistrySnapshot_ACU,
  runId: string,
  candidateSeq: number,
  truncated: boolean,
): WorldSimulationSubagentOutcome_ACU {
  const patch = payload.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('WORLD_SIMULATION_SPECIALIST_PATCH_REQUIRED');
  const acceptedPatch: Record<string, unknown> = {};
  const issues: WorldSimulationSubagentIssue_ACU[] = [];
  for (const [rawModule, rawPatch] of Object.entries(patch as Record<string, unknown>)) {
    const module = patchModule_ACU(rawModule);
    if (!module || !writableModules.includes(module)) {
      for (const target of writableModules) issues.push({ module: target, source: 'contract_rejected', path: `$.patch.${rawModule}`, message: `Agent 无权写入模块 ${rawModule}` });
      continue;
    }
    const base = { ...payload, patch: { [rawModule]: rawPatch } };
    if (ITEM_PATCH_MODULES_ACU.has(module) && rawPatch && typeof rawPatch === 'object' && !Array.isArray(rawPatch) && (Array.isArray((rawPatch as Record<string, unknown>).upsert) || Array.isArray((rawPatch as Record<string, unknown>).remove))) {
      const record = rawPatch as Record<string, unknown>;
      const acceptedItems: Record<string, unknown[]> = {};
      for (const kind of ['upsert', 'remove'] as const) {
        if (!Array.isArray(record[kind])) continue;
        const accepted: unknown[] = [];
        (record[kind] as unknown[]).forEach((item, index) => {
          const id = item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string' ? String((item as Record<string, unknown>).id).trim() : '';
          try {
            parseWorldSimulationSpecialistResult_ACU({ ...payload, patch: { [rawModule]: { [kind]: [item] } } }, snapshot);
            accepted.push(item);
          } catch (error) {
            issues.push(issue_ACU(module, 'contract_rejected', error, `$.patch.${rawModule}.${kind}[${index}]`, id));
          }
        });
        if (accepted.length) acceptedItems[kind] = accepted;
      }
      const extra = Object.keys(record).filter(key => key !== 'upsert' && key !== 'remove');
      if (extra.length) issues.push({ module, source: 'contract_rejected', path: `$.patch.${rawModule}.${extra[0]}`, message: `模块 patch 含未授权字段：${extra.join(',')}` });
      if (Object.keys(acceptedItems).length) acceptedPatch[rawModule] = acceptedItems;
      continue;
    }
    try {
      const parsed = parseWorldSimulationSpecialistResult_ACU(base, snapshot);
      if (parsed.status === 'candidate') acceptedPatch[rawModule] = parsed.patch[rawModule];
    } catch (error) {
      issues.push(issue_ACU(module, 'contract_rejected', error, `$.patch.${rawModule}`));
    }
  }
  if (truncated) {
    for (const module of writableModules) issues.push({ module, source: 'truncated', path: `$.patch.${module}`, message: 'specialist JSON 在输出中途截断，尾部写集尚未确认完整' });
  }
  if (!Object.keys(acceptedPatch).length && !issues.length) throw new Error('WORLD_SIMULATION_SPECIALIST_PATCH_EMPTY');
  const result = parseWorldSimulationSpecialistResult_ACU({ ...payload, patch: acceptedPatch }, snapshot) as Extract<WorldSimulationSpecialistResult_ACU, { status: 'candidate' }>;
  const candidate = candidate_ACU(result, writableModules, runId, candidateSeq);
  const acceptedKeys = acceptedPatchKeys_ACU(acceptedPatch);
  const issueModules = new Set(issues.map(item => item.module));
  const moduleCompletion: WorldSimulationSubagentOutcome_ACU['moduleCompletion'] = {};
  for (const module of writableModules) {
    const changed = Object.keys(acceptedPatch).some(key => patchModule_ACU(key) === module);
    moduleCompletion[module] = issueModules.has(module) ? (changed ? 'partial' : 'failed') : (changed ? 'complete_changed' : 'complete_no_change');
  }
  return { agentName: result.agentName, status: 'candidate', summary: result.summary, candidate, evidenceRefs: result.evidenceRefs, uncertainties: result.uncertainties, completion: issues.length ? 'partial' : 'complete_changed', moduleCompletion, unresolvedIssues: issues, acceptedKeys };
}

function toolCalls_ACU(raw: string, prefill: string, snapshot: WorldSimulationEvidenceRegistrySnapshot_ACU) {
  try {
    const action = parseWorldSimulationMainOutput_ACU(raw, prefill, false, snapshot);
    if (action.kind === 'read' || action.kind === 'search') return [action];
    if (action.kind === 'tools') return action.calls;
  } catch { /* specialist/reviewer output is not a tool action */ }
  return null;
}

/** 拒绝路径是诊断，不是任意可读地址；未知恢复状态不据此推导当前 ID。 */
function rejectedFieldReadAddresses_ACU(receipt: WorldSimulationFieldCommitReceipt_ACU): string[] {
  if (receipt.partials === null || receipt.ledgerRevision === null) return [];
  return receipt.rejected.flatMap(({ path }) => {
    const match = /^(clock|dimensions|seeds|actors|player|rumors|chronicle|guidance)#([A-Za-z0-9_-]{1,128})(?:\.[A-Za-z][A-Za-z0-9]*|$)$/.exec(path);
    return match && (match[2] !== '_' || ['clock', 'player', 'guidance'].includes(match[1]))
      ? [`field:${match[1]}:${match[2]}`] : [];
  });
}

function toolText_ACU(results: Awaited<ReturnType<typeof runWorldSimulationToolBatch_ACU>>): string {
  return JSON.stringify(results.map(item => ({ kind: item.kind, address: item.address, status: item.status, summary: item.summary, evidenceRef: item.evidenceRef, content: item.content })));
}

/** One protocol per request; the editable PROTOCOL seam only points here. */
export function worldSimulationOneShotProtocol_ACU(name: WorldSimulationOneShotRole_ACU, modules: readonly WorldSimulationLedgerModule_ACU[]): string {
  const tables = modules.flatMap(module => module === 'chronicle' ? ['chronicle', 'chronicle_archive', 'chronicle_overview'] : [module]);
  const details: Record<WorldSimulationOneShotRole_ACU, string> = {
    'undercurrent-analyst': 'clock: UPDATE SET days, story_time, slot; dimensions: name, kind, value, trend, rationale，其中 kind 只能是英文原值 pressure 或 growth，trend 只能是 rising、stable、falling；seeds: title, status, level, catalyst, visibility, location, expires_at_day, missed_outcome, actor_ids, expose_policy, retired_reason，其中 visibility 只能是英文原值 hidden、limited、public，status 只能是 established、incubating、active、converging、resolved、retired。枚举不得填写中文解释、组合描述或其他同义词。',
    'dramatis-keeper': 'player: UPDATE SET location, contact（仅这两列及 evidence_refs，location_updated_at_day 与 region_visits 是内部派生字段，绝对不可写进 SQL）；actors: name, interests, location, location_ref, goals, information_sources, known_facts, life, died_at_day, death_summary; rumors 仅死亡伴生: fact, origin_day, earliest_reveal_day, channels, related_actor_ids。',
    'guidance-composer': 'chronicle: INSERT summary, related_ids 或 DELETE id, reason；chronicle_archive 与 chronicle_overview 成对 INSERT；rumors: fact, origin_day, earliest_reveal_day, channels, related_actor_ids, status, revealed_at_day；guidance: UPDATE SET signals, excluded_facts。',
  };
  return [
    '【输出协议】推理闭合后只输出一个 JSON 对象，不附加 Markdown、解释或其他字段。',
    `有改动：{"status":"candidate","agentName":"${name}","sql":"一条或多条受限 SQL","summary":"本轮修改","uncertainties":[]}`,
    `无改动：{"status":"no_change","agentName":"${name}","summary":"没有需要修改的内容","uncertainties":[]}`,
    `无法完成：{"status":"failed","agentName":"${name}","reasonCode":"UNRESOLVED","message":"原因"}`,
    `status 只能是 candidate、no_change、failed；agentName 必须精确为 ${name}。只能写表：${tables.join(' | ')}。`,
    'SQL 只允许 INSERT INTO 表 (列) VALUES (字面量)、UPDATE 表 SET 列 = 字面量 WHERE 条件、DELETE FROM 表 WHERE 条件；不得使用 SELECT、函数、子查询或表达式。字符串单引号须转义为两个，列名使用 snake_case。',
    details[name],
  ].join('\n');
}

export class WorldSimulationSubagentRuntime_ACU {
  constructor(private readonly dependencies: WorldSimulationSubagentRuntimeDependencies_ACU) {}

  async runOneShot(input: WorldSimulationOneShotInput_ACU): Promise<WorldSimulationSubagentOutcome_ACU> {
    const definition = findWorldSimulationAgentDefinition_ACU(input.agentName);
    if (!definition || !['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'].includes(input.agentName)) throw new Error('WORLD_SIMULATION_ONE_SHOT_AGENT_INVALID');
    const modules = definition.writableModules;
    const failed = (error: unknown, source: WorldSimulationPendingFixSource_ACU = 'protocol_failed'): WorldSimulationSubagentOutcome_ACU => {
      const message = error instanceof Error ? error.message : String(error);
      return { agentName: input.agentName, status: 'failed', summary: message, reasonCode: 'WORLD_SIMULATION_ONE_SHOT_FAILED',
        evidenceRefs: [], uncertainties: [], completion: 'failed', acceptedKeys: [],
        moduleCompletion: Object.fromEntries(modules.map(module => [module, 'failed'])),
        unresolvedIssues: modules.map(module => ({ module, source, path: `$.patch.${module}`, message })) };
    };
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, input.agentName, 'agent_delegate', this.dependencies.apiPreset);
    const catalog = buildInUseWorldCatalog_ACU(input.givenLedger);
    const own: Record<string, unknown> = {};
    const omitted: Array<{ id: string; name: string; readAddress: string }> = [];
    for (const module of modules) {
      if (module === 'clock' || module === 'player' || module === 'guidance') { own[module] = input.givenLedger[module]; continue; }
      if (module === 'chronicle') {
        own.chronicle = input.givenLedger.chronicle.slice(-WORLD_CHRONICLE_HOT_WINDOW_ACU);
        own.chronicleOverview = input.givenLedger.chronicleOverview;
        continue;
      }
      const rows = [...input.givenLedger[module]];
      const selected = module === 'seeds'
        ? input.givenLedger.seeds.filter(row => row.status !== 'resolved' && row.status !== 'retired').slice(0, 30)
        : module === 'actors'
          ? [...input.givenLedger.actors].sort((a, b) => Number(b.life === 'alive') - Number(a.life === 'alive') || b.revision - a.revision).slice(0, 30)
          : module === 'rumors'
            ? input.givenLedger.rumors.filter(row => row.status !== 'dead').slice(0, 30)
            : rows;
      own[module] = selected;
      const kept = new Set(selected.map(row => row.id));
      for (const row of rows) if (!kept.has(row.id)) omitted.push({ id: row.id, name: 'name' in row ? String(row.name) : 'title' in row ? String(row.title) : String(row.fact), readAddress: `${module}:${row.id}` });
    }
    const related: Record<string, unknown> = { omitted };
    const profile = getWorldSimulationAgentAccessProfile_ACU(input.agentName);
    for (const module of profile.readModules) {
      if (modules.includes(module as WorldSimulationLedgerModule_ACU)) continue;
      if (module === 'clock' || module === 'player') related[module] = input.givenLedger[module];
      else if (module === 'chronicle') related[module] = catalog.chronicleHot;
      else if (module in catalog) related[module] = catalog[module as 'dimensions' | 'seeds' | 'actors' | 'rumors'];
    }
    const anchor = typeof input.promptContext.anchorMessage === 'string' ? input.promptContext.anchorMessage : '';
    const runtime = ['【本回合运行时数据】', `本轮焦点：${input.focus}`, `本轮锚点证据引用：${input.anchorEvidenceRef}（evidence_refs 只能用已授权引用）`,
      `世界时钟：day=${input.givenLedger.clock.day} slot=${input.givenLedger.clock.slot} storyTime=${input.givenLedger.clock.storyTime}`,
      `单例修订号：${input.baseLedgerRevision}`, `【你负责的资料（完整行）】${JSON.stringify(own)}`,
      `【关联只读目录】${JSON.stringify(related)}`, `【待修复】${JSON.stringify(input.givenLedger.pendingFixes.filter(fix => modules.includes(fix.module)))}`,
      ...(input.roundChanges ? [`【本轮变更清单】${input.roundChanges}`] : []), `【锚点正文】\n${stripWritingAnnotations_ACU(anchor)}`,
      ...(input.injectWorldbook && input.triggeredWorldbook ? [input.triggeredWorldbook] : [])].join('\n');
    const resolvers = createWorldSimulationPlaceholderResolvers_ACU({ ...input.promptContext, worldState: input.givenLedger });
    const rendered = await renderWorldSimulationPrompt_ACU(input.settings.agentPrompts[input.agentName], input.agentName, resolvers);
    const protocol = worldSimulationOneShotProtocol_ACU(input.agentName, modules);
    const base = [{ role: 'system', content: protocol }, ...rendered.messages.filter(message => message.content !== USER_PREFILL_CONTENT_ACU)];
    const prefill = rendered.messages.some(message => message.content === USER_PREFILL_CONTENT_ACU);
    const transcript: AiWireMessage_ACU[] = [];
    const readGateState = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0 };
    let reads = 0;
    let repairs = 0;
    const maxReads = input.settings.agentRunBudget.maxExtraReads > 0 ? 1 : 0;
    const authorized = () => new Set(snapshotWorldSimulationEvidenceRegistry_ACU(input.registry).entries.flatMap(entry => entry.evidenceRef ? [entry.evidenceRef] : []));
    for (let attempt = 0; attempt < 2 + maxReads; attempt++) {
      if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
      const messages = withNativeToolThinkPrefill_ACU([...base, ...transcript, { role: 'user', content: runtime }, ...(prefill ? [{ role: 'user', content: USER_PREFILL_CONTENT_ACU }] : [])]);
      const requestTools = maxReads && reads === 0 ? ['read'] as const : [] as const;
      let sent: Awaited<ReturnType<typeof executeWorldSimulationFinalRequest_ACU>>;
      try {
        sent = await executeWorldSimulationFinalRequest_ACU({ messages, inputLimitTokens: input.settings.agentHistoryTokenBudget,
          tools: agentNativeTools_ACU(requestTools), historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          invoke: value => {
            if (input.injectWorldbook && input.fixedWorldbook) {
              if (input.fixedWorldbook.text !== (input.triggeredWorldbook ?? '')) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
              verifyWorldSimulationFixedWorldbook_ACU(input.fixedWorldbook, value);
            }
            return this.dependencies.invoke(input.agentName, value, preset, requestTools);
          } });
      } catch (error) {
        if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
        return failed(error, 'invoke_failed');
      }
      if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
      if (sent.status === 'rejected') return failed(sent.reason, 'invoke_failed');
      const turn = normalizeAgentModelReply_ACU(sent.response);
      const raw = typeof sent.response === 'string' ? sent.response : turn.content;
      try {
        if (turn.toolCalls.length) {
          if (turn.toolCalls.length !== 1) throw new Error('WORLD_SIMULATION_ONE_SHOT_READ_LIMIT');
          const calls = nativeToolArguments_ACU(turn.toolCalls).map(({ call, payload }) => {
            if (call.name !== 'read' || reads >= maxReads) throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN');
            const parsed = parseWorldSimulationMainAction_ACU(payload, false, snapshotWorldSimulationEvidenceRegistry_ACU(input.registry));
            if (parsed.kind !== 'read') throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN');
            return parsed;
          });
          reads++;
          const results = await runWorldSimulationToolBatch_ACU({ calls, registry: input.registry, dependencies: input.tools,
            gate: { state: readGateState, config: { historyTokenBudget: input.settings.agentHistoryTokenBudget,
              readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
              usage, maxReads: input.settings.agentRunBudget.maxReads, readOnce: true,
              canReadAddress: address => worldSimulationCanReadAddress_ACU(input.agentName, address),
              count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU } });
          transcript.push(...nativeToolExchange_ACU(turn.content, turn.toolCalls, turn.toolCalls.map((_, index) => index === 0 ? toolText_ACU(results) : '本批次读取结果见首条回执')));
          continue;
        }
        const draft = parseWorldSimulationJsonDraft_ACU(raw, '{', ['status']);
        if (draft.truncated) throw new Error('WORLD_SIMULATION_ONE_SHOT_TRUNCATED');
        const normalized = normalizeOneShotSpecialistPayload_ACU(draft.payload, { agentName: input.agentName, writableModules: modules,
          givenLedger: input.givenLedger, baseLedgerRevision: input.baseLedgerRevision, anchorEvidenceRef: input.anchorEvidenceRef, authorizedRefs: authorized() });
        if (normalized.issues.length && repairs === 0) throw new Error(normalized.issues.slice(0, 8).map(issue => `${issue.path}: ${issue.message}`).join('；'));
        const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
        let outcome: WorldSimulationSubagentOutcome_ACU;
        try { outcome = outcomeFromSpecialistResult_ACU(parseWorldSimulationSpecialistResult_ACU(normalized.payload, snapshot), modules, input.runId, input.candidateSeq, false); }
        catch (error) {
          if (normalized.payload.status !== 'candidate') throw error;
          outcome = salvageCandidateOutcome_ACU(normalized.payload, modules, snapshot, input.runId, input.candidateSeq, false);
        }
        if (normalized.issues.length) {
          outcome.unresolvedIssues = [...(outcome.unresolvedIssues ?? []), ...normalized.issues];
          const troubled = new Set(normalized.issues.map(issue => issue.module));
          for (const module of troubled) outcome.moduleCompletion![module] = outcome.candidate && Object.keys(outcome.candidate.patch).some(key => key === module || (module === 'chronicle' && key === 'chronicleArchive')) ? 'partial' : 'failed';
          if (outcome.candidate) outcome.completion = 'partial';
        }
        if (outcome.candidate) {
          // Match the transaction's domain validation before releasing a candidate; do not
          // treat a syntactically valid SQL reply as a successfully applied write. Batch two
          // sees a preview ledger, but its singleton revisions must remain bound to the run
          // base for the final replay. Adjust only a disposable preflight copy.
          const candidate = outcome.candidate;
          const previewPatch = Object.fromEntries(Object.entries(candidate.patch).map(([module, value]) =>
            ['clock', 'player', 'guidance'].includes(module) && value && typeof value === 'object'
              ? [module, { ...value, expectedRevision: input.givenLedger.revision }]
              : [module, value])) as typeof candidate.patch;
          const report = preflightWorldSimulationCandidates_ACU(input.givenLedger,
            [{ ...candidate, patch: previewPatch }], authorized(), input.settings);
          if (report.blocking.length) throw new Error(report.blocking.slice(0, 8).map(item => `${item.path}: ${item.message}${item.details?.expected ? `；允许 ${item.details.expected}` : ''}`).join('；'));
        }
        return outcome;
      } catch (error) {
        if (repairs++ >= 1) return failed(error);
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `上一次输出未被采纳：${error instanceof Error ? error.message : String(error)}。只修正问题，保留合法语句，重新输出完整 JSON；仍失败则输出 failed JSON。` });
      }
    }
    return failed('WORLD_SIMULATION_ONE_SHOT_CALL_LIMIT');
  }

  async run(input: WorldSimulationSubagentRunInput_ACU): Promise<WorldSimulationSubagentOutcome_ACU> {
    const definition = findWorldSimulationAgentDefinition_ACU(input.delegation.agentName);
    if (!definition || !['specialist', 'researcher'].includes(definition.kind)) {
      throw new Error('WORLD_SIMULATION_DELEGATION_AGENT_INVALID');
    }
    const agentName = definition.name;
    // 旧逐栏运行恢复时保留原写入工具；新一次性调用仍仅开放 read。
    const legacyTools = definition.writableModules.length && !worldSimulationAgentNativeTools_ACU(agentName).includes('write_sql')
      ? [...worldSimulationAgentNativeTools_ACU(agentName), 'write_sql' as const] : worldSimulationAgentNativeTools_ACU(agentName);
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, agentName, 'agent_delegate', this.dependencies.apiPreset);
    const writableModules = definition.writableModules.filter(module => !input.writableModules || input.writableModules.includes(module));
    const context = withTask_ACU(input.promptContext, { instruction: input.delegation.instruction, reads: input.delegation.reads }, undefined, writableModules);
    const transcript: Array<{ role: string; content: string }> = [];
    const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    let toolRounds = 0;
    let writeRounds = 0;
    const confirmedFields = new Set<string>();
    const writeProblems = new Map<string, WorldSimulationSubagentIssue_ACU>();
    let writeAttempted = false;
    let writeStateUnknown = false;
    const recordWriteReceipt = (receipt: WorldSimulationFieldCommitReceipt_ACU): void => {
      if (receipt.partials === null || receipt.ledgerRevision === null) writeStateUnknown = true;
      if (receipt.status === 'committed') { writeProblems.delete('host'); for (const item of receipt.accepted) writeProblems.delete(`${item.module}#${item.id}`); }
      for (const item of receipt.accepted) {
        confirmedFields.add(`${item.module}:${item.id}:${item.field}`);
        writeProblems.delete(`${item.module}#${item.id}.${item.field}`);
      }
      for (const item of receipt.rejected) {
        const match = /^(clock|dimensions|seeds|actors|player|rumors|chronicle|guidance)#([^.#]+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(item.path);
        const module = match?.[1] as WorldSimulationLedgerModule_ACU | undefined;
        writeProblems.set(item.path, { module: module && writableModules.includes(module) ? module : writableModules[0],
          source: 'transaction_rejected', path: item.path, message: item.reason,
          ...(match ? { id: match[2] } : {}) });
      }
    };
    const terminalIssues = (): WorldSimulationSubagentIssue_ACU[] => {
      if (!writeAttempted) return [];
      const issues = new Map(writeProblems);
      if (writeStateUnknown) issues.set('write_state', { module: writableModules[0], source: 'invoke_failed',
        path: 'write_state', message: '逐栏保存或补偿状态未确认，必须重新读取权威账本' });
      let fields: WorldSimulationLedgerFieldSnapshot_ACU | undefined;
      try { fields = input.readFieldSnapshot?.(); }
      catch (error) { issues.set('field_view', { module: writableModules[0], source: 'invoke_failed', path: 'field_view',
        message: error instanceof Error ? error.message : String(error) }); }
      if (!fields && !issues.has('field_view')) issues.set('field_view', { module: writableModules[0], source: 'invoke_failed', path: 'field_view',
        message: '当前权威分栏视图不可用' });
      if (fields) {
        for (const module of writableModules) for (const record of Object.values(fields.records[module] ?? {})) {
          if (record.status !== 'partial') continue;
          for (const field of record.missingFields) issues.set(`${module}#${record.id}.${field}`, { module,
            source: 'transaction_rejected', id: record.id, path: `${module}#${record.id}.${field}`, message: `必填栏目 ${field} 尚未提交` });
        }
        for (const key of confirmedFields) {
          const [module, id, field] = key.split(':') as [WorldSimulationLedgerModule_ACU, string, string];
          if (!fields.records[module]?.[id]?.fields[field]) issues.set(`${module}#${id}.${field}`, { module, id,
            source: 'invoke_failed', path: `${module}#${id}.${field}`, message: '写入回执未在当前权威账本中得到确认' });
        }
      }
      return [...issues.values()];
    };
    const checkedOutcome = (outcome: WorldSimulationSubagentOutcome_ACU): WorldSimulationSubagentOutcome_ACU => {
      const issues = terminalIssues();
      if (!issues.length) return confirmedFields.size && outcome.status === 'no_change'
        ? { ...outcome, acceptedKeys: [...confirmedFields], completion: 'complete_changed',
          moduleCompletion: Object.fromEntries(writableModules.map(module => [module, 'complete_changed'])) }
        : outcome;
      return { agentName, status: 'failed', summary: '逐栏维护尚未合格', reasonCode: 'WORLD_SIMULATION_FIELD_INCOMPLETE',
        evidenceRefs: [], uncertainties: [], completion: 'failed',
        moduleCompletion: Object.fromEntries(writableModules.map(module => [module, 'failed'])),
        unresolvedIssues: [...issues, ...(outcome.unresolvedIssues ?? [])], acceptedKeys: [...confirmedFields] };
    };
    const maxWriteRounds = input.writeSql && writableModules.length ? Math.max(1, input.settings.agentRunBudget.maxIterations) : 0;
    const maxCalls = 1 + input.settings.agentRunBudget.maxExtraReads + maxWriteRounds + repair.maxAttempts + 1;

    for (let attempt = 0; attempt < maxCalls; attempt += 1) {
      if (input.isCurrent && !input.isCurrent()) throw new Error('WORLD_SIMULATION_RUN_STALE');
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const readBudget = resolveWorldSimulationReadBudget_ACU({
        historyTokenBudget: input.settings.agentHistoryTokenBudget,
        readTokenBudget: input.settings.agentReadTokenBudget,
        fallbackTokens: input.settings.agentReadFallbackTokens,
      });
      const remainingTokens = Math.max(0, readBudget.effectiveMaxReadTokens - readGateState.grantedTokens);
      const remainingRounds = Math.max(0, input.settings.agentRunBudget.maxExtraReads - toolRounds);
      const readAction = definition.kind === 'researcher' ? 'read/search' : 'read';
      const readBudgetText = `本轮剩余阅读预算：约 ${remainingTokens} tokens（上限 ${readBudget.effectiveMaxReadTokens}，已授予 ${readGateState.grantedTokens}）；剩余 ${readAction} 轮次 ${remainingRounds}/${input.settings.agentRunBudget.maxExtraReads}。`;
      const requestContext = { ...context, ...(input.readCurrent ? { worldState: input.readCurrent() } : {}), evidenceRegistry: requestSnapshot, readBudgetText };
      const resolvers = createWorldSimulationPlaceholderResolvers_ACU(requestContext);
      // 旧会话的逐栏恢复必须继续使用 write_sql 协议；v21 的三个默认提示词只供 runOneShot。
      const legacyPrompt = (['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'] as readonly string[]).includes(agentName)
        ? buildV20WorldSimulationAgentPrompt_ACU(agentName)
        : input.settings.agentPrompts[agentName]
          ?? (agentName === 'timekeeper' || agentName === 'chronicler'
            ? buildV20WorldSimulationAgentPrompt_ACU(agentName) : undefined);
      if (!legacyPrompt) throw new Error(`WORLD_SIMULATION_AGENT_PROMPT_MISSING:${agentName}`);
      const split = splitWorldSimulationSubagentPrompt_ACU(legacyPrompt, agentName);
      const rendered = await renderWorldSimulationPrompt_ACU(split.segments, agentName, resolvers);
      const snapshot = await renderWorldSimulationSnapshotSections_ACU(split.snapshotTemplate, resolvers,
        isWorldSimulationLedgerContext_ACU(requestContext.worldState) ? { ledger: requestContext.worldState.revision } : {});
      const snapshotText = snapshot.text;
      const guidance = split.movedGuidanceIndex >= 0 ? rendered.messages[split.movedGuidanceIndex]?.content : '';
      const appendix = [snapshotText, guidance, input.triggeredWorldbook ?? ''].filter(Boolean).join('\n\n');
      const protocolGuard = { role: 'system', content: worldSimulationSpecialistRuntimeProtocolInstruction_ACU(agentName, writableModules) };
      const drafted = [protocolGuard, ...rendered.messages.filter((message, index) => index !== split.movedGuidanceIndex && message.content !== USER_PREFILL_CONTENT_ACU), ...transcript, ...(appendix ? [{ role: 'user', content: appendix }] : []), ...(rendered.messages.some(message => message.content === USER_PREFILL_CONTENT_ACU)
        ? [{ role: 'user', content: USER_PREFILL_CONTENT_ACU }]
        : [])];
      const messages = withNativeToolThinkPrefill_ACU(drafted);
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages,
        inputLimitTokens: input.settings.agentHistoryTokenBudget,
        tools: agentNativeTools_ACU(legacyTools),
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => {
          if (snapshot.text) verifyWorldSimulationSnapshotSections_ACU(snapshot, value);
          if (input.fixedWorldbook) {
            if (input.fixedWorldbook.text !== (input.triggeredWorldbook ?? '')) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
            verifyWorldSimulationFixedWorldbook_ACU(input.fixedWorldbook, value);
          }
          return this.dependencies.invoke(agentName, value, preset, legacyTools);
        },
      });
      if (input.isCurrent && !input.isCurrent()) throw new Error('WORLD_SIMULATION_RUN_STALE');
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const turn = normalizeAgentModelReply_ACU(sent.response);
      const nativeCalls: AiNativeToolCall_ACU[] = turn.toolCalls;
      const raw = typeof sent.response === 'string' ? sent.response : turn.content;
      let calls: ReturnType<typeof parseWorldSimulationSubagentToolCalls_ACU>;
      try {
        calls = nativeCalls.length ? nativeToolArguments_ACU(nativeCalls).map(({ call, payload }) => {
          if (call.name === 'write_sql') {
            if (!legacyTools.includes('write_sql') || !input.writeSql || !writableModules.length || Object.keys(payload).some(key => !['action', 'sql', 'evidenceRefs'].includes(key))) throw new Error('write_sql 未授权或参数非法');
            return parseWorldSimulationSubagentToolCalls_ACU(JSON.stringify(payload), '', requestSnapshot, true)![0];
          }
          if (!worldSimulationAgentNativeTools_ACU(agentName).includes(call.name as 'read' | 'search')) throw new Error(`工具 ${call.name} 未获 ${agentName} profile 授权`);
          const parsed = parseWorldSimulationMainAction_ACU(payload, false, requestSnapshot);
          if (parsed.kind !== call.name) throw new Error('工具名称与动作不一致');
          return parsed as Extract<ReturnType<typeof parseWorldSimulationMainAction_ACU>, { kind: 'read' | 'search' }>;
        }) : null;
        if (!nativeCalls.length && parseWorldSimulationSubagentToolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot, !!input.writeSql && writableModules.length > 0)) throw new Error('工具必须使用原生函数调用');
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry && writeAttempted) return checkedOutcome({ agentName, status: 'failed', summary: '逐栏工具协议重试耗尽',
          reasonCode: 'WORLD_SIMULATION_PROTOCOL_FAILED', evidenceRefs: [], uncertainties: [], completion: 'failed',
          unresolvedIssues: [{ module: writableModules[0], source: 'protocol_failed', path: 'write_sql', message: `${failure.issue.reasonCode}: ${failure.issue.path}` }],
          acceptedKeys: [...confirmedFields] });
        if (!failure.retry) throw error;
        const reason = renderWorldSimulationSpecialistProtocolRejection_ACU(failure.issue, agentName, writableModules);
        if (nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: reason }); // 非工具协议纠错
        continue;
      }
      if (calls) {
        const perCall: unknown[][] = [];
        for (let index = 0; index < calls.length; index += 1) {
          const call = calls[index];
          const bucket: unknown[] = [];
          perCall.push(bucket);
          if (call.kind === 'write_sql') {
            if (writeRounds >= maxWriteRounds) {
              bucket.push({ action: 'write_sql', originalSql: call.sql, status: 'rejected', accepted: [], reason: 'write_sql 轮次已用尽', remainingWriteRounds: 0 });
              continue;
            }
            writeRounds += 1;
            writeAttempted = true;
            if (input.isCurrent && !input.isCurrent()) throw new Error('WORLD_SIMULATION_RUN_STALE');
            try {
              const receipt = await input.writeSql!({ role: agentName, sql: call.sql,
                evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(input.registry), declaredEvidenceRefs: call.evidenceRefs, allowedModules: writableModules,
                isCurrent: input.isCurrent });
              if (input.isCurrent && !input.isCurrent()) throw new Error('WORLD_SIMULATION_RUN_STALE');
              recordWriteReceipt(receipt);
              const repair = renderWorldSimulationWriteRepair_ACU(writableModules, receipt);
              bucket.push({ action: 'write_sql', originalSql: call.sql, ...receipt,
                fieldOutcome: receipt.partials === null || receipt.ledgerRevision === null ? '保存状态不明；先读取权威字段' : {
                  saved: receipt.accepted.map(item => ({ module: item.module, id: item.id, field: item.field, revision: item.revision, ...('value' in item ? { value: item.value } : {}) })),
                  notSaved: [...receipt.partials.flatMap(item => item.missingFields.map(field => `${item.module}#${item.id}.${field}`)), ...receipt.rejected.map(item => item.path)],
                  generatedIds: [...new Set(receipt.accepted.map(item => `${item.module}#${item.id}`))],
                }, ...(repair ? { repair } : {}), readAddresses: [...new Set([
                ...receipt.accepted.map(item => `field:${item.module}:${item.id}:${item.field}`),
                ...(receipt.partials ?? []).map(item => `field:${item.module}:${item.id}`),
                ...rejectedFieldReadAddresses_ACU(receipt),
              ])],
                remainingWriteRounds: maxWriteRounds - writeRounds });
            } catch (error) {
              if (error instanceof Error && error.message === 'WORLD_SIMULATION_RUN_STALE') throw error;
              const reason = error instanceof Error ? error.message : String(error);
              writeStateUnknown = true;
              writeProblems.set('host', { module: writableModules[0], source: 'invoke_failed', path: 'host', message: reason });
              const unknown: Parameters<typeof renderWorldSimulationWriteRepair_ACU>[1] & Record<string, unknown> = { action: 'write_sql', originalSql: call.sql, status: 'rejected', accepted: [], rejected: [{ path: 'host', reason }],
                partials: null, ledgerRevision: null, readAddresses: [], reason,
                remainingReadRounds: Math.max(0, input.settings.agentRunBudget.maxExtraReads - toolRounds),
                remainingWriteRounds: maxWriteRounds - writeRounds };
              bucket.push({ ...unknown, repair: renderWorldSimulationWriteRepair_ACU(writableModules, unknown) });
            }
          } else if (toolRounds >= input.settings.agentRunBudget.maxExtraReads) {
            bucket.push({ action: call.kind, status: 'rejected', reason: `${definition.kind === 'researcher' ? 'read/search' : 'read'} 轮次已用尽` });
          } else {
            if (call.kind === 'read') {
              const batch = [call];
              while (index + 1 < calls.length && calls[index + 1].kind === 'read') {
                batch.push(calls[++index] as typeof call);
                perCall.push([]);
              }
              toolRounds += 1;
              bucket.push(...await runWorldSimulationToolBatch_ACU({
                calls: batch, registry: input.registry, dependencies: input.tools,
                gate: { state: readGateState,
                  config: { historyTokenBudget: input.settings.agentHistoryTokenBudget, readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
                  usage: toolUsage, maxReads: input.settings.agentRunBudget.maxReads, readOnce: definition.kind !== 'researcher',
                  ...(sent.defaultReadFenceTokens === undefined ? {} : { defaultReadFenceTokens: sent.defaultReadFenceTokens }),
                  ...(input.readRoundState && input.roundId ? { readRoundState: input.readRoundState,
                    readRoundKey: JSON.stringify([agentName, input.roundId]) } : {}),
                  canReadAddress: address => worldSimulationCanReadAddress_ACU(agentName, address),
                  count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU },
              }));
              continue;
            }
            toolRounds += 1;
            bucket.push(...await runWorldSimulationToolBatch_ACU({
              calls: [call], registry: input.registry, dependencies: input.tools,
              gate: { state: readGateState,
                config: { historyTokenBudget: input.settings.agentHistoryTokenBudget, readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
                usage: toolUsage, maxReads: input.settings.agentRunBudget.maxReads,
                count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU },
            }));
          }
        }
        const summary = { remainingReadRounds: Math.max(0, input.settings.agentRunBudget.maxExtraReads - toolRounds), remainingWriteRounds: maxWriteRounds - writeRounds };
        transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, perCall.map(items => JSON.stringify({ results: items, ...summary }))));
        continue;
      }
      try {
        const draft = parseWorldSimulationJsonDraft_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['status']);
        const payload = bindSpecialistIdentity_ACU(draft.payload, agentName);
        if (String(payload.agentName ?? '').trim() !== agentName) throw new Error('WORLD_SIMULATION_AGENT_IDENTITY_MISMATCH');
        try {
          const result = parseWorldSimulationSpecialistResult_ACU(payload, requestSnapshot);
          return checkedOutcome(outcomeFromSpecialistResult_ACU(
            result,
            definition.writableModules,
            input.runId,
            input.candidateSeq ?? 1,
            draft.truncated,
          ));
        } catch (strictError) {
          try {
            return checkedOutcome(salvageCandidateOutcome_ACU(
              payload,
              definition.writableModules,
              requestSnapshot,
              input.runId,
              input.candidateSeq ?? 1,
              draft.truncated,
            ));
          } catch {
            throw strictError;
          }
        }
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry && writeAttempted) return checkedOutcome({ agentName, status: 'failed', summary: '逐栏契约协议重试耗尽',
          reasonCode: 'WORLD_SIMULATION_PROTOCOL_FAILED', evidenceRefs: [], uncertainties: [], completion: 'failed',
          unresolvedIssues: [{ module: writableModules[0], source: 'protocol_failed', path: 'contract', message: `${failure.issue.reasonCode}: ${failure.issue.path}` }],
          acceptedKeys: [...confirmedFields] });
        if (!failure.retry) throw error;
        transcript.push(
          { role: 'assistant', content: raw || '(empty)' },
          { role: 'user', content: renderWorldSimulationSpecialistProtocolRejection_ACU(failure.issue, agentName, definition.writableModules) },
        );
      }
    }
    if (writeAttempted) return checkedOutcome({ agentName, status: 'failed', summary: '逐栏工具/模型预算耗尽',
      reasonCode: 'WORLD_SIMULATION_SUBAGENT_CALL_LIMIT', evidenceRefs: [], uncertainties: [],
      completion: 'failed', moduleCompletion: Object.fromEntries(writableModules.map(module => [module, 'failed'])),
      unresolvedIssues: [], acceptedKeys: [...confirmedFields] });
    throw new Error(`WORLD_SIMULATION_SUBAGENT_CALL_LIMIT:${agentName}:${maxCalls}`);
  }

  async runReviewer(input: WorldSimulationReviewInput_ACU): Promise<WorldSimulationReviewerResult_ACU> {
    if (!input.candidates.length) throw new Error('WORLD_SIMULATION_REVIEW_CANDIDATES_REQUIRED');
    const agentName = 'causality-reviewer' as const;
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, agentName, 'agent_delegate', this.dependencies.apiPreset);
    const context = withTask_ACU(input.promptContext, { objective: '审核候选的时间、因果、权限、revision 与证据完整性' }, input.candidates, []);
    const transcript: Array<{ role: string; content: string }> = [];
    const repair = createWorldSimulationProtocolRepairState_ACU(this.dependencies.protocolRetries ?? 2);
    const readGateState = createWorldSimulationReadGateState_ACU();
    const toolUsage = { readsUsed: 0 };
    let toolRounds = 0;
    const maxCalls = 1 + input.settings.agentRunBudget.maxExtraReads + repair.maxAttempts + 1;
    for (let attempt = 0; attempt < maxCalls; attempt += 1) {
      if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
      const requestSnapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
      const readBudget = resolveWorldSimulationReadBudget_ACU({
        historyTokenBudget: input.settings.agentHistoryTokenBudget,
        readTokenBudget: input.settings.agentReadTokenBudget,
        fallbackTokens: input.settings.agentReadFallbackTokens,
      });
      const readBudgetText = `本轮剩余阅读预算：约 ${Math.max(0, readBudget.effectiveMaxReadTokens - readGateState.grantedTokens)} tokens；剩余 read 轮次 ${Math.max(0, input.settings.agentRunBudget.maxExtraReads - toolRounds)}/${input.settings.agentRunBudget.maxExtraReads}。`;
      const requestContext = { ...context, evidenceRegistry: requestSnapshot, readBudgetText };
      const resolvers = createWorldSimulationPlaceholderResolvers_ACU(requestContext);
      const split = splitWorldSimulationSubagentPrompt_ACU(input.settings.agentPrompts[agentName], agentName);
      const rendered = await renderWorldSimulationPrompt_ACU(split.segments, agentName, resolvers);
      const snapshot = await renderWorldSimulationSnapshotSections_ACU(split.snapshotTemplate, resolvers,
        isWorldSimulationLedgerContext_ACU(requestContext.worldState) ? { ledger: requestContext.worldState.revision } : {});
      const snapshotText = snapshot.text;
      const guidance = split.movedGuidanceIndex >= 0 ? rendered.messages[split.movedGuidanceIndex]?.content : '';
      const appendix = [snapshotText, guidance, input.triggeredWorldbook ?? ''].filter(Boolean).join('\n\n');
      const protocolGuard = { role: 'system', content: worldSimulationReviewerRuntimeProtocolInstruction_ACU() };
      const reviewerDraft = [protocolGuard, ...rendered.messages.filter((message, index) => index !== split.movedGuidanceIndex && message.content !== USER_PREFILL_CONTENT_ACU), ...transcript, ...(appendix ? [{ role: 'user', content: appendix }] : []), ...(rendered.messages.some(message => message.content === USER_PREFILL_CONTENT_ACU)
        ? [{ role: 'user', content: USER_PREFILL_CONTENT_ACU }]
        : [])];
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages: withNativeToolThinkPrefill_ACU(reviewerDraft),
        inputLimitTokens: input.settings.agentHistoryTokenBudget,
        tools: agentNativeTools_ACU(worldSimulationAgentNativeTools_ACU(agentName)),
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => {
          if (snapshot.text) verifyWorldSimulationSnapshotSections_ACU(snapshot, value);
          if (input.fixedWorldbook) {
            if (input.fixedWorldbook.text !== (input.triggeredWorldbook ?? '')) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
            verifyWorldSimulationFixedWorldbook_ACU(input.fixedWorldbook, value);
          }
          return this.dependencies.invoke(agentName, value, preset);
        },
      });
      if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const reviewerTurn = normalizeAgentModelReply_ACU(sent.response);
      const reviewerNative = reviewerTurn.toolCalls;
      const raw = typeof sent.response === 'string' ? sent.response : reviewerTurn.content;
      let calls: ReturnType<typeof toolCalls_ACU>;
      try {
        calls = reviewerNative.length ? nativeToolArguments_ACU(reviewerNative).map(({ call, payload }) => {
          if (!worldSimulationAgentNativeTools_ACU(agentName).includes(call.name as 'read' | 'search')) throw new Error(`工具 ${call.name} 未获 ${agentName} profile 授权`);
          const parsed = parseWorldSimulationMainAction_ACU(payload, false, requestSnapshot);
          if (parsed.kind !== 'read') throw new Error('reviewer 只允许 read');
          return parsed as Extract<ReturnType<typeof parseWorldSimulationMainAction_ACU>, { kind: 'read' | 'search' }>;
        }) : null;
        if (!reviewerNative.length && toolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot)) throw new Error('read 必须使用原生函数调用');
      } catch (error) {
        if (!reviewerNative.length) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative, reviewerNative.map(() => reason)));
        continue;
      }
      if (calls) {
        if (toolRounds >= input.settings.agentRunBudget.maxExtraReads) {
          const exhausted = 'reviewer 的 read 轮次已用尽，请依据现有候选与证据输出终审 JSON。';
          transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative, reviewerNative.map(() => exhausted)));
          continue;
        }
        toolRounds += 1;
        const batchResults = await runWorldSimulationToolBatch_ACU({
          calls, registry: input.registry, dependencies: input.tools,
          gate: {
            state: readGateState,
            config: { historyTokenBudget: input.settings.agentHistoryTokenBudget, readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
            usage: toolUsage,
            maxReads: input.settings.agentRunBudget.maxReads,
            readOnce: true,
            ...(sent.defaultReadFenceTokens === undefined ? {} : { defaultReadFenceTokens: sent.defaultReadFenceTokens }),
            ...(input.readRoundState && input.roundId ? { readRoundState: input.readRoundState,
              readRoundKey: JSON.stringify([agentName, input.roundId]) } : {}),
            canReadAddress: address => worldSimulationCanReadAddress_ACU(agentName, address),
            count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          },
        });
        if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
        transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative,
          calls.map((_, index) => index === 0 ? toolText_ACU(batchResults) : '本逻辑读取批次已统一结算，结果见首个工具回执。')));
        continue;
      }
      try {
        const payload = parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['verdict']);
        const result = parseWorldSimulationReviewerResult_ACU(payload);
        const known = new Set(input.candidates.map(item => item.candidateId));
        const unknown = result.acceptedCandidateIds.filter(id => !known.has(id));
        if (unknown.length) throw new Error(`WORLD_SIMULATION_REVIEW_UNKNOWN_CANDIDATE:${unknown.join(',')}`);
        if (result.verdict === 'accept' && !result.acceptedCandidateIds.length) throw new Error('WORLD_SIMULATION_REVIEW_ACCEPTANCE_REQUIRED');
        if (result.verdict === 'reject' && result.acceptedCandidateIds.length) throw new Error('WORLD_SIMULATION_REVIEW_REJECT_WITH_ACCEPTED');
        return result;
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry) throw error;
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: renderWorldSimulationReviewerProtocolRejection_ACU(failure.issue) });
      }
    }
    throw new Error(`WORLD_SIMULATION_REVIEWER_CALL_LIMIT:${maxCalls}`);
  }

}
