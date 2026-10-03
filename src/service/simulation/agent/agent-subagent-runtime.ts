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
import { buildInUseWorldCatalog_ACU, worldLedgerRowsForAgent_ACU } from '../world-catalog';
import type { WorldSimulationEvidenceRegistry_ACU, WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { snapshotWorldSimulationEvidenceRegistry_ACU } from '../world-simulation-evidence-registry';
import { formatWorldSimulationToolAddressHints_ACU, runWorldSimulationToolBatch_ACU, type WorldSimulationReadRoundState_ACU, type WorldSimulationToolDependencies_ACU } from '../world-simulation-agent-tools';
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
import { createWorldSimulationProtocolRepairState_ACU, normalizeOneShotSpecialistPayload_ACU, worldSimulationSqlWritableColumns_ACU, parseWorldSimulationSubagentToolCalls_ACU, parseWorldSimulationJsonDraft_ACU, parseWorldSimulationJsonPayload_ACU, parseWorldSimulationMainAction_ACU, parseWorldSimulationMainOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU, recordWorldSimulationProtocolFailure_ACU, renderWorldSimulationReviewerProtocolRejection_ACU, renderWorldSimulationSpecialistProtocolRejection_ACU } from './agent-protocol';
import { createWorldSimulationReadGateState_ACU, resolveWorldSimulationReadBudget_ACU } from './agent-read-gate';
import { logWorldSimulationSession_ACU, updateWorldSimulationSession_ACU } from './agent-session-log';
import { executeWorldSimulationFinalRequest_ACU } from './final-request-token-gate';
import { renderWorldSimulationPrompt_ACU } from './prompt-template';
import { renderWorldSimulationSnapshotSections_ACU, splitWorldSimulationSubagentPrompt_ACU, verifyWorldSimulationSnapshotSections_ACU, verifyWorldSimulationFixedWorldbook_ACU, type WorldSimulationFixedWorldbook_ACU } from './agent-shared-materials';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent-token-budget';
import { agentNativeTools_ACU, nativeToolArguments_ACU, nativeToolExchange_ACU, normalizeAgentModelReply_ACU, withJsonTailPrefill_ACU, withNativeToolThinkPrefill_ACU, type AiChatTurn_ACU, type AiNativeToolCall_ACU, type AiNativeToolDefinition_ACU, type AiWireMessage_ACU } from '../../ai/native-tool';
import { resolveAgentToolMode_ACU, type AgentToolMode_ACU } from '../../ai/agent-tool-mode';
import { adaptWorldSimulationPromptSegmentsToToolMode_ACU, worldSimulationProtocolForMode_ACU } from './agent-prompt-mode';
import { AGENT_SUBMIT_TOOL_NAME_ACU, splitNativeDecisionCalls_ACU, submitPayloadObject_ACU, worldSimulationOneShotSubmitTool_ACU, worldSimulationReviewerSubmitTool_ACU, worldSimulationSpecialistSubmitTool_ACU } from '../../ai/agent-decision-tools';

/** 一次推演请求的工具声明：tools 进请求体，cacheTools 进缓存键；json 模式 tools 为空、cacheTools 为 mode:json。 */
export interface WorldSimulationInvokeTools_ACU { tools: readonly AiNativeToolDefinition_ACU[]; cacheTools: readonly string[]; }
export interface WorldSimulationAgentInvoker_ACU { (agentName: WorldSimulationAgentName_ACU, messages: readonly { role: string; content: string }[], preset: WorldSimulationResolvedApiPreset_ACU, request?: WorldSimulationInvokeTools_ACU): Promise<string | AiChatTurn_ACU>; }

/** 按模式给出请求工具：tools 模式携带函数，json 模式请求体不带 tools。 */
export function worldSimulationInvokeTools_ACU(mode: AgentToolMode_ACU, tools: readonly AiNativeToolDefinition_ACU[]): WorldSimulationInvokeTools_ACU {
  return mode === 'tools'
    ? { tools, cacheTools: tools.map(tool => tool.function.name) }
    : { tools: [], cacheTools: ['mode:json'] };
}

/**
 * 按模式收尾请求：tools 模式补思维链预填充；json 模式把工具历史投影成纯文本，
 * 并在没有用户预填充时把 JSON 预填充放到请求最末。
 */
export function finishWorldSimulationMessages_ACU<T extends { role: string; content: string }>(mode: AgentToolMode_ACU, messages: readonly T[], jsonPrefill?: string): T[] {
  if (mode === 'tools') return withNativeToolThinkPrefill_ACU(messages as never) as T[];
  const primed = jsonPrefill ? [...messages, { role: 'assistant', content: jsonPrefill } as T] : messages;
  return withJsonTailPrefill_ACU(primed as never) as T[];
}

export function resolveWorldSimulationToolMode_ACU(preset: WorldSimulationResolvedApiPreset_ACU): AgentToolMode_ACU {
  return resolveAgentToolMode_ACU('worldSimulation', preset as never);
}
export interface WorldSimulationSubagentRuntimeDependencies_ACU { invoke: WorldSimulationAgentInvoker_ACU; countTokens?: WorldSimulationTokenCounter_ACU; apiPreset?: WorldSimulationApiPresetDependencies_ACU; protocolRetries?: number; }
export interface WorldSimulationSubagentRunInput_ACU {
  delegation: WorldSimulationDelegation_ACU;
  settings: WorldSimulationSettings_ACU;
  toolMode?: AgentToolMode_ACU;
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
export interface WorldSimulationReviewInput_ACU { candidates: readonly WorldSimulationCandidate_ACU[]; settings: WorldSimulationSettings_ACU; toolMode?: AgentToolMode_ACU; promptContext: WorldSimulationPlaceholderContext_ACU; registry: WorldSimulationEvidenceRegistry_ACU; tools: WorldSimulationToolDependencies_ACU; isCurrent?: () => boolean; roundId?: string; readRoundState?: WorldSimulationReadRoundState_ACU; directorMaterials?: string; triggeredWorldbook?: string; fixedWorldbook?: WorldSimulationFixedWorldbook_ACU; }

export interface WorldSimulationOneShotInput_ACU {
  agentName: WorldSimulationOneShotRole_ACU;
  settings: WorldSimulationSettings_ACU;
  toolMode?: AgentToolMode_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  registry: WorldSimulationEvidenceRegistry_ACU;
  tools: WorldSimulationToolDependencies_ACU;
  runId: string;
  candidateSeq: number;
  focus: string;
  anchorEvidenceRef: string;
  givenLedger: WorldSimulationLedger_ACU;
  baseLedgerRevision: number;
  /** 工作流从同一锚点一次计算的本轮明确经过天数；并发角色共享，不由角色间推断传播。 */
  elapsedDays?: number;
  roundChanges?: string;
  injectWorldbook: boolean;
  triggeredWorldbook?: string;
  fixedWorldbook?: WorldSimulationFixedWorldbook_ACU;
  isCurrent?: () => boolean;
  /**
   * 会话流分区。与智能续写主循环同一做法：子代理的读取与被拒提交也要进会话流，
   * 否则用户只看到派工卡片，看不到这一轮实际读了什么、提交了什么、被拒在哪。
   */
  sessionChatIdentity?: string;
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

type OneShotAction_ACU = { name: string; args: Record<string, unknown>; read?: Extract<ReturnType<typeof parseWorldSimulationMainAction_ACU>, { kind: 'read' }> };

/** json 模式的一次性动作：只把 read 与 write_sql 的 JSON 对象识别为动作；其它文本返回 null，交给终态行判断。 */
function oneShotJsonActions_ACU(raw: string, snapshot: WorldSimulationEvidenceRegistrySnapshot_ACU): OneShotAction_ACU[] | null {
  const calls = parseWorldSimulationSubagentToolCalls_ACU(raw, '', snapshot, true);
  return calls ? calls.map((call): OneShotAction_ACU => call.kind === 'write_sql'
    ? { name: 'write_sql', args: { action: 'write_sql', sql: call.sql } }
    : { name: call.kind, args: { action: call.kind }, ...(call.kind === 'read' ? { read: call } : {}) }) : null;
}

/** One protocol per request; the editable PROTOCOL seam only points here. */
export function worldSimulationOneShotProtocol_ACU(name: WorldSimulationOneShotRole_ACU, modules: readonly WorldSimulationLedgerModule_ACU[], mode: AgentToolMode_ACU = 'tools'): string {
  const tables = oneShotTables_ACU(modules);
  const details: Record<WorldSimulationOneShotRole_ACU, string> = {
    'undercurrent-analyst': 'clock: UPDATE SET days, story_time, slot; dimensions: name, kind, value, trend, rationale，其中 kind 只能是英文原值 pressure 或 growth，trend 只能是 rising、stable、falling；seeds: title, status, level, catalyst, visibility, location, expires_at_day, missed_outcome, actor_ids, expose_policy, retired_reason。seeds.actor_ids 只能是已存在的 actor.id 字符串数组，例如 actor_ids = \'["actor-1"]\'；没有已确认人物 ID 就省略该列，绝不能写人物对象数组。seeds.location 必须是 JSON 对象字符串，例如 location = \'{"region":"江南府","place":"城外"}\'，只有 region 必填；无确定地点则省略 location，不可填单独地名。其中 visibility 只能是英文原值 hidden、limited、public，status 只能是 established、incubating、active、converging、resolved、retired。枚举不得填写中文解释、组合描述或其他同义词。',
    'dramatis-keeper': 'player: UPDATE SET location, contact（仅这两列及 evidence_refs，location_updated_at_day 与 region_visits 是内部派生字段，绝对不可写进 SQL）；actors: name, interests, location, location_ref, goals, information_sources, known_facts, life, died_at_day, death_summary, current_action, long_term_action; rumors 仅死亡伴生: fact, origin_day, earliest_reveal_day, channels, related_actor_ids。current_action 写 JSON 对象，例如 current_action = \'{"text":"在客栈盯着往来客商","expected_duration":"今夜之内"}\'；long_term_action 另带 status（ongoing/done/abandoned）与可选 outcome，例如 long_term_action = \'{"text":"护送粮车南下","expected_duration":"约三日","status":"done","outcome":"顺利抵达江南府"}\'。行为的开始时间与经历时间线由程序派生，不能写 experiences 或任何时间戳。',
    'guidance-composer': 'chronicle: INSERT summary, related_ids, missed_note 或 DELETE id, reason；missed_note 只在主角错过了重要幕后事件时写（说明错过了什么），普通纪要省略该列；chronicle_archive 只能写 archive_ref, day, summary, fingerprints, related_ids, source_chronicle_ids；chronicle_overview 只能写 fingerprint, day, one_line, archive_ref，二者必须用同一个 archive_ref 成对 INSERT，不能把 summary/related_ids 写入 chronicle_overview。rumors: fact, origin_day, earliest_reveal_day, channels, related_actor_ids, status, revealed_at_day；guidance: 只能 UPDATE signals, excluded_facts（必须带 WHERE expected_revision）。guidance.signals 的 sourceId 只能指向本次输入账本中已经存在的条目 ID、clock 或 player；本候选新 INSERT 的 rumor/chronicle 不能在同一候选中作为 sourceId，不得编造 rumors:1 等地址。',
  };
  return [
    mode === 'tools'
      ? '【交付协议】有可证实的变更时先调用 write_sql，参数只填 sql 字段（一条或多条受限 SQL）；它仅生成待验证候选，不即时写入账本。收到候选校验回执后，下一次回复单独调用 submit 交付，不与 read 或 write_sql 同回复。不得用正文交付或输出裸 SQL。'
      : '【交付协议】有可证实的变更时先输出 {"action":"write_sql","sql":"一条或多条受限 SQL"}，只填 action 与 sql；它仅生成待验证候选，不即时写入账本。收到候选校验回执后，下一次回复单独输出完整交付 JSON，不与工具动作混用，不输出裸 SQL。',
    `交付字段：status、agentName。candidate 仅确认已校验的候选，另填 summary、evidenceRefs、uncertainties；无变化用 no_change 并填 summary、evidenceRefs、uncertainties；无法完成用 failed 并填 reasonCode、message，或 blocked 并填非空 unresolved。agentName 必须为 ${name}。交付不带 sql 或 patch。${mode === 'tools' ? '交付只能调用 submit。' : '交付只能输出 JSON 对象。'}空回复和裸状态行均不是交付。`,
    `只能写表：${tables.join(' | ')}。一次 write_sql 收齐本角色所有变更，不拆成多次写入；失败时按工具回执修正，仅允许一次纠错。`,
    `【可写列白名单】${oneShotColumnWhitelist_ACU(tables)}。SET 与 INSERT 只能用这些列；revision、day 等行字段只读，修订号只写在 WHERE expected_revision = 值 中：数组行用该行 revision 字段的值，clock/player/guidance 单例用运行时“单例修订号”。`,
    '提交前按提示词【推演步骤】对每个负责模块逐一得出写或不写的结论；多个模块有变化时全部放进同一次 write_sql，不能只维护其中一两个模块就提交。',
    `运行时已给出本角色完整行与关联资料；只有目录中出现具体 readAddress 且确需详情时才${mode === 'tools' ? '调用 read，参数 reads 填该地址' : '输出 {"action":"read","reads":["该地址"]}'}。目录为空就不要为核对空资料而读取；ledger:current 并非普通角色可读地址。不能把 $.reads、裸模块名或错误路径当作地址。`,
    'SQL 只允许 INSERT INTO 表 (列) VALUES (字面量)、UPDATE 表 SET 列 = 字面量 WHERE 条件、DELETE FROM 表 WHERE 条件；不得使用 SELECT、函数、子查询或表达式。字符串单引号须转义为两个，列名使用 snake_case。',
    '归档列名必须严格区分：chronicle_archive=(archive_ref, day, summary, fingerprints, related_ids, source_chronicle_ids)；chronicle_overview=(fingerprint, day, one_line, archive_ref)。chronicle_overview 没有 summary 或 related_ids 列。guidance 是单例，只能 UPDATE 且 WHERE 只能带 expected_revision。',
    'guidance.signals 的 sourceId 只能引用运行时已注入账本中已有的条目 ID，或 clock/player；不能引用本次 SQL 刚 INSERT 的 rumors/chronicle，也不能写 rumors:1、rumors:<数字> 等未出现在账本目录中的伪 ID。',
    details[name],
  ].join('\n');
}



/** 角色可写模块展开为 SQL 表；编年同时开放成对归档表。 */
function oneShotTables_ACU(modules: readonly WorldSimulationLedgerModule_ACU[]): string[] {
  return modules.flatMap(module => module === 'chronicle' ? ['chronicle', 'chronicle_archive', 'chronicle_overview'] : [module]);
}

/**
 * 首轮与空模块标记：空账本时子代理容易把“没有旧条目可改”当成无变化。
 * 这里只陈述事实，建账要求在提示词【首轮建账】里。
 */
export function oneShotBootstrapNotice_ACU(baseRevision: number, modules: readonly WorldSimulationLedgerModule_ACU[], ledger: WorldSimulationLedger_ACU): string[] {
  const empty = modules.filter(module => Array.isArray(ledger[module]) && !(ledger[module] as unknown[]).length);
  if (baseRevision === 0) return [`【首轮建账】账本尚未建立（基线修订号 0）。按提示词【首轮建账】依据世界书与锚点为你负责的模块建立初始条目；空表不是无变化的理由。${empty.length ? `当前为空的负责模块：${empty.join('、')}。` : ''}`];
  if (empty.length) return [`【空模块】你负责的 ${empty.join('、')} 当前为空。按提示词【首轮建账】检查世界书与锚点能否建档，空表不是无变化的理由。`];
  return [];
}

/**
 * 建账轮的覆盖检查。参考智能续写的 missingFields 回执：只写了其中一个模块就交付时，
 * 要明确点出仍然空着的模块再要一轮，而不是把「只写了 clock」当成整批完成。
 * 只看本来为空的数组模块；clock/player/guidance 是单例，没有「建档」语义。
 */
const ONE_SHOT_BOOTSTRAP_MODULES_ACU: readonly WorldSimulationLedgerModule_ACU[] = ['dimensions', 'seeds', 'actors'];

export function oneShotUncoveredModules_ACU(
  modules: readonly WorldSimulationLedgerModule_ACU[],
  ledger: WorldSimulationLedger_ACU,
  patch: Record<string, unknown>,
  baseRevision: number,
): WorldSimulationLedgerModule_ACU[] {
  // 仅首轮建账要求覆盖，且只覆盖必须建档的模块：纪要与风声按提示词本就允许没有素材。
  if (baseRevision !== 0) return [];
  return modules.filter(module => {
    if (!ONE_SHOT_BOOTSTRAP_MODULES_ACU.includes(module)) return false;
    if (!Array.isArray(ledger[module]) || (ledger[module] as unknown[]).length) return false;
    const written = patch[module] as { upsert?: unknown[]; append?: unknown[] } | undefined;
    return !written || !((written.upsert?.length ?? 0) + (written.append?.length ?? 0));
  });
}

/** 与解析器同源的可写列清单，提示词与纠错回执不再各自手写列名。 */
function oneShotColumnWhitelist_ACU(tables: readonly string[]): string {
  return tables.map(table => `${table}(${worldSimulationSqlWritableColumns_ACU(table).join(', ')})`).join('；');
}

/** Explain domain rejections without silently inventing entity IDs or changing the patch. */
function oneShotRepairHint_ACU(issues: readonly WorldSimulationSubagentIssue_ACU[], tables: readonly string[]): string {
  const hints: string[] = [];
  if (issues.some(issue => /(?:^|\.)actorIds$/.test(issue.path) && issue.module === 'seeds')) {
    hints.push('seeds.actor_ids 只能写 SQL 单引号包裹的 JSON 字符串 ID 数组，例如 actor_ids = \'["actor-1"]\'；仅能引用当前账本已有的 actor.id。没有可确认的人物 ID 就从每条出错的 INSERT/UPDATE 中省略 actor_ids，不能写人物对象数组、单个对象、数字或 null。');
  }
  if (issues.some(issue => /(?:^|\.)(?:interests|resources|goals|constraints|informationSources|knownFacts|channels|relatedActorIds)$/.test(issue.path))) {
    hints.push('字符串数组列必须写 SQL 单引号包裹的 JSON 字符串数组，例如 channels = \'["市井"]\'；不能写对象数组、数字或 null。涉及人物关联的 ID 必须来自已确认的账本。');
  }
  if (issues.some(issue => /(?:^|\.)(?:location|locationRef)$/.test(issue.path) && /必须是对象或 null/.test(issue.message))) {
    hints.push('seeds.location、actors.location_ref 和 player.location 需要 SQL 单引号包裹的 JSON 对象，如 location = \'{"region":"江南府"}\'；不能填裸地名。actors.location 则是地名文本。');
  }
  if (issues.some(issue => /actors\.upsert\[\d+\]\.location$/.test(issue.path) && /必须是字符串/.test(issue.message))) {
    hints.push('actors.location 是地名纯文本，只能写 location = \'江南府·客栈\' 这样的字符串，不能写 JSON；结构化地点改写到 location_ref = \'{"region":"江南府","place":"客栈"}\'。');
  }
  if (issues.some(issue => /(?:sourceId|UNKNOWN_GUIDANCE_SOURCE)/.test(`${issue.path} ${issue.message}`))) {
    hints.push('guidance.signals.sourceId 只能使用运行时账本中已经存在的条目 ID、clock 或 player；不能引用本次候选刚 INSERT 的 rumors/chronicle，也不能编造 rumors:1 等未出现在目录中的 ID。无法绑定已有来源时删除该 signal，不要把新建条目的猜测 ID 填进去。');
  }
  if (issues.some(issue => /SQL 值只允许字符串、数字或 NULL/.test(issue.message))) {
    hints.push('字符串值必须用英文半角单引号 \' 包裹，例如 visibility = \'public\'、evidence_refs 可直接省略；不能用中文弯引号 ‘’、全角 ＇、反斜杠 \\\' 或夹带零宽字符，正文里的单引号写成两个 \'\'。');
  }
  if (issues.some(issue => /SQL_COLUMN_FORBIDDEN/.test(issue.message))) {
    hints.push(`被拒的列不在该表白名单内，删掉该列或换成白名单列，不要改名重试：${oneShotColumnWhitelist_ACU(tables)}。修订号只写在 WHERE expected_revision，不写进 SET 或 INSERT 列。`);
  }
  if (issues.some(issue => /chronicle_overview|chronicle_archive/.test(issue.message))) {
    hints.push('归档 SQL 列必须严格使用 chronicle_archive=(archive_ref, day, summary, fingerprints, related_ids, source_chronicle_ids) 与 chronicle_overview=(fingerprint, day, one_line, archive_ref)；chronicle_overview 不允许 summary 或 related_ids。');
  }
  return hints.join(' ');
}

/** 仅识别锚点中可机械确认的整日跨度；不确定时保守返回零，避免把回忆或旧旅程重复计入。 */
export function inferWorldSimulationElapsedDays_ACU(anchor: string): number {
  const text = String(anchor ?? '').replace(/\s+/g, '');
  if (!text) return 0;
  const arabic = (value: string): number => Number.parseInt(value, 10);
  const chinese: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const explicit = text.match(/(?:经过|已过|过去|耗时|用了|历时)(\d+|[一两二三四五六七八九十])(?:天|日|昼夜)/);
  if (explicit) return arabic(explicit[1]) || chinese[explicit[1]] || 0;
  const repeated = text.match(/(?:连续|一连)(\d+|[一两二三四五六七八九十])(?:天|日|昼夜)/);
  if (repeated) return arabic(repeated[1]) || chinese[repeated[1]] || 0;
  if (/(?:一昼夜|一日一夜|一夜一天|过了一夜|隔了一夜)/.test(text)) return 1;
  if (/(?:昨日|昨天|前日|前天)/.test(text) && /(?:今日|今天|今夜|次日|翌日|第二天|第二日)/.test(text)) return 1;
  return 0;
}

export class WorldSimulationSubagentRuntime_ACU {
  constructor(private readonly dependencies: WorldSimulationSubagentRuntimeDependencies_ACU) {}

  async runOneShot(input: WorldSimulationOneShotInput_ACU): Promise<WorldSimulationSubagentOutcome_ACU> {
    const definition = findWorldSimulationAgentDefinition_ACU(input.agentName);
    if (!definition || !['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'].includes(input.agentName)) throw new Error('WORLD_SIMULATION_ONE_SHOT_AGENT_INVALID');
    const modules = definition.writableModules;
    const failed = (error: unknown, source: WorldSimulationPendingFixSource_ACU = 'protocol_failed',
      located: WorldSimulationSubagentIssue_ACU[] = []): WorldSimulationSubagentOutcome_ACU => {
      const message = error instanceof Error ? error.message : String(error);
      // A protocol/tool error has no ledger module. Preserve it in the summary;
      // only transaction/SQL issues with a proven owner become pending fixes.
      return { agentName: input.agentName, status: 'failed', summary: message, reasonCode: 'WORLD_SIMULATION_ONE_SHOT_FAILED',
        evidenceRefs: [], uncertainties: [], completion: 'failed', acceptedKeys: [],
        moduleCompletion: Object.fromEntries(modules.map(module => [module, 'failed'])),
        unresolvedIssues: located };
    };
    const preset = resolveWorldSimulationAgentApiPreset_ACU(input.settings, input.agentName, 'agent_delegate', this.dependencies.apiPreset);
    const toolMode = input.toolMode ?? resolveWorldSimulationToolMode_ACU(preset);
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
            // 传闻单行很短，不设上限整组完整注入；只排除已消亡条目。
            ? input.givenLedger.rumors.filter(row => row.status !== 'dead')
            : rows;
      own[module] = module === 'seeds' || module === 'actors' || module === 'rumors'
        ? worldLedgerRowsForAgent_ACU(module, selected as readonly object[])
        : selected;
      const kept = new Set(selected.map(row => row.id));
      for (const row of rows) if (!kept.has(row.id)) omitted.push({ id: row.id, name: 'name' in row ? String(row.name) : 'title' in row ? String(row.title) : String(row.fact), readAddress: `${module}:${row.id}` });
    }
    const related: Record<string, unknown> = { omitted };
    const profile = getWorldSimulationAgentAccessProfile_ACU(input.agentName);
    for (const module of profile.readModules) {
      if (modules.includes(module as WorldSimulationLedgerModule_ACU)) continue;
      if (module === 'clock' || module === 'player') related[module] = input.givenLedger[module];
      else if (module === 'chronicle') related[module] = catalog.chronicleHot;
      // 维度与传闻单行很短，直接注入完整行，不再拆成目录与详情；种子与人物字段多，仍用浓缩目录。
      else if (module === 'dimensions') related[module] = input.givenLedger.dimensions;
      else if (module === 'rumors') related[module] = worldLedgerRowsForAgent_ACU('rumors', input.givenLedger.rumors.filter(row => row.status !== 'dead'));
      else if (module in catalog) related[module] = catalog[module as 'dimensions' | 'seeds' | 'actors' | 'rumors'];
    }
    const anchor = typeof input.promptContext.anchorMessage === 'string' ? input.promptContext.anchorMessage : '';
    const elapsedDays = Number.isInteger(input.elapsedDays) && input.elapsedDays! >= 0
      ? input.elapsedDays!
      : inferWorldSimulationElapsedDays_ACU(anchor);
    const runtime = ['【本回合运行时数据】', `本轮焦点：${input.focus}`, `本轮锚点证据引用：${input.anchorEvidenceRef}（evidence_refs 只能用已授权引用）`,
      `时序：day=${input.givenLedger.clock.day} slot=${input.givenLedger.clock.slot} storyTime=${input.givenLedger.clock.storyTime}`,
      ...oneShotBootstrapNotice_ACU(input.baseLedgerRevision, modules, input.givenLedger),
      // 批次二串行接在批次一之后，输入 clock 已包含本轮推进；这里不能再让它叠加经过天数。
      input.agentName === 'guidance-composer'
        ? `【共同时间基准】本轮共享的明确经过天数为 ${elapsedDays}（由工作流对同一锚点一次计算）。批次一已按这段跨度维护 clock，当前日 ${input.givenLedger.clock.day} 已包含本轮推进（本轮内存预览，尚未持久化）；直接采用该日，不再叠加经过天数。幕后纪要 day、风声 origin_day 与 earliest_reveal_day 以当前日为准，并按本轮经过的时间跨度判断哪些幕后事件已完结、哪些消息已传开；不把回忆或既已计入的旅程重复累加。`
        : `【共同时间基准】本轮共享的明确经过天数为 ${elapsedDays}（由工作流对同一锚点一次计算；无明确时间流逝即为 0）。当前已提交日为 ${input.givenLedger.clock.day}；不把回忆或既已计入的旅程重复累加。undercurrent-analyst 独占 clock 写入，clock.days 只能表达这一本轮推进量；dramatis-keeper 不写 clock，但人物状态、死亡时间及伴生传闻的演算必须使用本轮共享经过天数。另一并发角色的推断尚未落账，不得当作已提交事实。`,
      `单例修订号：${input.baseLedgerRevision}（clock/player/guidance 的 UPDATE 写 WHERE expected_revision = ${input.baseLedgerRevision}；数组行用各自 revision 字段）`, `【你负责的资料（完整行）】${JSON.stringify(own)}`,
      `【关联只读资料】局势刻度与风声为完整行；伏线与人物谱为浓缩目录，需细节时按 readAddress 调用 read。${JSON.stringify(related)}`, `【待修复】${JSON.stringify(input.givenLedger.pendingFixes.filter(fix => modules.includes(fix.module)))}`,
      ...(input.roundChanges ? [`【本轮变更清单】${input.roundChanges}`] : []), `【锚点正文】\n${stripWritingAnnotations_ACU(anchor)}`,
      ...(input.injectWorldbook && input.triggeredWorldbook ? [input.triggeredWorldbook] : [])].join('\n');
    const resolvers = createWorldSimulationPlaceholderResolvers_ACU({ ...input.promptContext, worldState: input.givenLedger });
    const rendered = await renderWorldSimulationPrompt_ACU(adaptWorldSimulationPromptSegmentsToToolMode_ACU(input.agentName, input.settings.agentPrompts[input.agentName], toolMode), input.agentName, resolvers);
    const protocol = worldSimulationOneShotProtocol_ACU(input.agentName, modules, toolMode);
    const base = [{ role: 'system', content: protocol }, ...rendered.messages.filter(message => message.content !== USER_PREFILL_CONTENT_ACU)];
    // 末尾预填充是用户在提示词里设置的 user 段，必须按 role: 'user' 原样补回请求末尾，与主 Agent、
    // legacy specialist、reviewer 三条链路一致。漏掉它，withNativeToolThinkPrefill_ACU 会改追加
    // assistant <think> 预填充，请求以 model turn 结尾，Gemini 等通道直接 400。
    const trailingPrefill = rendered.messages.some(message => message.content === USER_PREFILL_CONTENT_ACU)
      ? [{ role: 'user', content: USER_PREFILL_CONTENT_ACU }]
      : [];
    const transcript: AiWireMessage_ACU[] = [];
    const readGateState = createWorldSimulationReadGateState_ACU();
    const usage = { readsUsed: 0 };
    let reads = 0;
    let repairs = 0;
    // 首轮算出的部分候选兜底：纠错轮整批失效时，仍落账首轮已合法的语句，而不是一起丢掉。
    let salvaged: WorldSimulationSubagentOutcome_ACU | null = null;
    let pendingDelivery: WorldSimulationSubagentOutcome_ACU | null = null;
    let writeAttempted = false;
    const maxReads = input.settings.agentRunBudget.maxExtraReads > 0 ? 1 : 0;
    const authorized = () => new Set(snapshotWorldSimulationEvidenceRegistry_ACU(input.registry).entries.flatMap(entry => entry.evidenceRef ? [entry.evidenceRef] : []));
    const sessionId = input.sessionChatIdentity?.trim();
    const logSession = (entry: { kind: 'tool_read' | 'protocol_retry' | 'write_sql'; title: string; detail: string; ok: boolean; status?: 'running' | 'done' | 'failed' }): number | null =>
      sessionId ? logWorldSimulationSession_ACU(sessionId, { ...entry, agentName: input.agentName }) : null;
    const updateSession = (id: number | null, patch: { title?: string; detail?: string; ok?: boolean; status?: 'running' | 'done' | 'failed' }): void => {
      if (sessionId && id !== null) updateWorldSimulationSession_ACU(sessionId, id, patch);
    };
    const requestDelivery = (outcome: WorldSimulationSubagentOutcome_ACU, turn: AiChatTurn_ACU, raw: string): void => {
      pendingDelivery = outcome;
      const receipt = JSON.stringify({ status: 'candidate', agentName: input.agentName,
        summary: outcome.summary, evidenceRefs: outcome.evidenceRefs, uncertainties: outcome.uncertainties,
        unresolvedIssues: outcome.unresolvedIssues,
        instruction: toolMode === 'tools' ? '候选已校验，下一回复单独调用 submit 确认交付。' : '候选已校验，下一回复单独输出 status、agentName、summary、evidenceRefs、uncertainties 的交付 JSON。' });
      if (toolMode === 'tools') transcript.push(...nativeToolExchange_ACU(turn.content, turn.toolCalls, turn.toolCalls.map(() => receipt)));
      else transcript.push({ role: 'assistant', content: raw }, { role: 'user', content: receipt });
    };
    for (let attempt = 0; attempt < 3 + maxReads; attempt++) {
      if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
      let locatedIssues: WorldSimulationSubagentIssue_ACU[] = [];
      let sqlSubmitted = false;
      // 本次尝试提交的 SQL 在会话流里的条目 id；成败都回写到同一条，避免内容与结论分家。
      let writeEntryId: number | null = null;
      const messages = finishWorldSimulationMessages_ACU(toolMode, [...base, { role: 'user', content: runtime }, ...transcript, ...trailingPrefill]);
      const requestTools = maxReads && reads === 0 ? ['read', 'write_sql'] as const : ['write_sql'] as const;
      // 声明必须与本路径的校验一致：write_sql 在 one-shot 只收 sql，证据引用由程序按锚点绑定。
      // 共享目录里宣传 evidenceRefs 会让模型照着填，再被“多余参数”拒掉。json 模式请求不带 tools。
      const request = worldSimulationInvokeTools_ACU(toolMode, [...agentNativeTools_ACU(requestTools).map(tool => tool.function.name === 'read'
        ? { ...tool, function: { ...tool.function,
          description: '仅精读本轮运行时资料中明确列出的具体 readAddress；没有可精读条目就不要调用。完整行、锚点和世界书已经注入，不要重复读取；ledger:current 对普通角色未授权。reads 必须是实际可读地址数组。' } }
        : tool.function.name === 'write_sql'
          ? { ...tool, function: { ...tool.function,
            description: '把本角色本轮全部变更一次写入你负责的表。参数只有 sql：一条或多条用分号隔开的 INSERT/UPDATE/DELETE，字符串用英文半角单引号，正文里的单引号写成两个。证据引用由程序按锚点绑定，不要自己传 evidenceRefs。没有可证实变化就不要调用本工具。',
            parameters: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'], additionalProperties: false } } }
          : tool), worldSimulationOneShotSubmitTool_ACU()]);
      let sent: Awaited<ReturnType<typeof executeWorldSimulationFinalRequest_ACU>>;
      try {
        sent = await executeWorldSimulationFinalRequest_ACU({ messages, inputLimitTokens: input.settings.agentHistoryTokenBudget,
          tools: request.tools, historyBudgetTokens: input.settings.agentHistoryTokenBudget,
          count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
          invoke: value => {
            if (input.injectWorldbook && input.fixedWorldbook) {
              if (input.fixedWorldbook.text !== (input.triggeredWorldbook ?? '')) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
              verifyWorldSimulationFixedWorldbook_ACU(input.fixedWorldbook, value);
            }
            return this.dependencies.invoke(input.agentName, value, preset, request);
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
        let payload: Record<string, unknown>;
        let delivery: Record<string, unknown> | null = null;
        let actions: OneShotAction_ACU[] | null = null;
        if (toolMode === 'tools') {
          if (!turn.toolCalls.length) throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_REQUIRED: 必须调用 read、write_sql 或 submit');
          const split = splitNativeDecisionCalls_ACU(nativeToolArguments_ACU(turn.toolCalls), [AGENT_SUBMIT_TOOL_NAME_ACU]);
          delivery = split.decision ? submitPayloadObject_ACU(split.decision.payload) : null;
          actions = split.tools.length ? split.tools.map(({ call, payload: args }) => ({ name: call.name, args })) : null;
        } else {
          if (turn.toolCalls.length) throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: 当前为 JSON 模式，不要调用函数；把 read 或 write_sql 写成 JSON 对象');
          actions = oneShotJsonActions_ACU(raw, snapshotWorldSimulationEvidenceRegistry_ACU(input.registry));
          if (!actions) delivery = parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[input.agentName], ['status']);
        }
        if (delivery) {
          if (delivery.agentName !== input.agentName) throw new Error('WORLD_SIMULATION_ONE_SHOT_AGENT_MISMATCH');
          if (Object.keys(delivery).some(key => ['sql', 'patch', 'action'].includes(key))) throw new Error('WORLD_SIMULATION_ONE_SHOT_DELIVERY_WRITE_FORBIDDEN');
          if (delivery.status === 'candidate' && !pendingDelivery?.candidate) throw new Error('WORLD_SIMULATION_ONE_SHOT_CANDIDATE_REQUIRED');
          if (delivery.status === 'no_change' && writeAttempted) throw new Error('WORLD_SIMULATION_ONE_SHOT_NO_CHANGE_AFTER_WRITE');
          const result = parseWorldSimulationSpecialistResult_ACU({ ...delivery,
            ...(delivery.status === 'candidate' ? { patch: pendingDelivery!.candidate!.patch } : {}) }, snapshotWorldSimulationEvidenceRegistry_ACU(input.registry));
          const outcome = outcomeFromSpecialistResult_ACU(result, modules, input.runId, input.candidateSeq, false);
          return result.status === 'candidate' ? { ...pendingDelivery!, ...outcome,
            summary: pendingDelivery!.unresolvedIssues?.length ? `${outcome.summary}（另有 ${pendingDelivery!.unresolvedIssues.length} 项未完成，留待下一轮补录）` : outcome.summary,
            unresolvedIssues: pendingDelivery!.unresolvedIssues } : outcome;
        }
        if (actions) {
          if (pendingDelivery) throw new Error('WORLD_SIMULATION_ONE_SHOT_DELIVERY_REQUIRED');
          if (actions.some(action => action.name === 'write_sql')) writeAttempted = true;
          if (actions.length !== 1) throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_LIMIT');
          const [{ name, args, read }] = actions;
          if (name === 'read') {
            // 分开说明拒绝原因，纠错轮与会话流都能看出是哪条规则。
            if (writeAttempted) throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: 已提交过 write_sql，之后不能再 read');
            if (reads >= maxReads) throw new Error(`WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: 本轮 read 额度（${maxReads} 次）已用完，只能提交 write_sql 或交付结果`);
            const parsed = read ?? parseWorldSimulationMainAction_ACU(args, false, snapshotWorldSimulationEvidenceRegistry_ACU(input.registry));
            if (parsed.kind !== 'read') throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: read 参数只能是 {"reads":["具体地址"]}');
            reads++;
            const results = await runWorldSimulationToolBatch_ACU({ calls: [parsed], registry: input.registry, dependencies: input.tools,
              gate: { state: readGateState, config: { historyTokenBudget: input.settings.agentHistoryTokenBudget,
                readTokenBudget: input.settings.agentReadTokenBudget, fallbackTokens: input.settings.agentReadFallbackTokens },
                usage, maxReads: input.settings.agentRunBudget.maxReads, readOnce: true,
                canReadAddress: address => worldSimulationCanReadAddress_ACU(input.agentName, address),
                count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU } });
            if (toolMode === 'tools') transcript.push(...nativeToolExchange_ACU(turn.content, turn.toolCalls, [toolText_ACU(results)]));
            else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `【工具结果】\n${toolText_ACU(results)}` });
            logSession({ kind: 'tool_read', title: `读取资料（${results.length} 项）`,
              detail: results.map(item => `${item.address} ${item.status}${item.summary ? `：${item.summary}` : ''}`).join('；'),
              ok: results.every(item => item.status === 'ok' || item.status === 'empty') });
            continue;
          }
          if (name !== 'write_sql') throw new Error(`WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: 只允许 read 或 write_sql，收到 ${name}`);
          // evidenceRefs 是共享工具目录的历史参数：这里按锚点自行绑定证据，收到就忽略，不判失败。
          const extra = Object.keys(args).filter(key => !['action', 'sql', 'evidenceRefs'].includes(key));
          if (extra.length) throw new Error(`WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: write_sql 只接受 sql 参数，多余参数 ${extra.join(', ')}`);
          if (typeof args.sql !== 'string' || !args.sql.trim()) throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_FORBIDDEN: write_sql 的 sql 参数必须是非空字符串');
          payload = { status: 'candidate', sql: args.sql };
          sqlSubmitted = true;
          // 提交的 SQL 原文进会话历史：用户要能看到这一轮究竟写了什么，而不只是成功或失败。
          writeEntryId = logSession({ kind: 'write_sql', ok: true, status: 'running',
            title: `提交 SQL（${args.sql.split(';').filter(part => part.trim()).length} 条语句）`, detail: args.sql });
        } else throw new Error('WORLD_SIMULATION_ONE_SHOT_TOOL_REQUIRED');
        if (payload.status === 'failed') return failed(payload.message);
        const normalized = normalizeOneShotSpecialistPayload_ACU(payload, { agentName: input.agentName, writableModules: modules,
          givenLedger: input.givenLedger, baseLedgerRevision: input.baseLedgerRevision, anchorEvidenceRef: input.anchorEvidenceRef, authorizedRefs: authorized() });
        locatedIssues = normalized.issues;
        // 与智能续写同样宽容：合法语句已被逐条隔离出来，不能因为个别语句非法就整批丢弃。
        // 完全没有可用语句才直接要纠错；有可用语句时先把部分候选算出来，再决定是回执还是落账。
        const usablePatch = normalized.payload.status === 'candidate';
        if (!usablePatch && (normalized.issues.length || payload.status === 'candidate')) {
          throw new Error(normalized.issues.slice(0, 8).map(issue => `${issue.path}: ${issue.message}`).join('；') || 'WORLD_SIMULATION_ONE_SHOT_SQL_REJECTED');
        }
        const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(input.registry);
        let outcome: WorldSimulationSubagentOutcome_ACU;
        try { outcome = outcomeFromSpecialistResult_ACU(parseWorldSimulationSpecialistResult_ACU(normalized.payload, snapshot), modules, input.runId, input.candidateSeq, false); }
        catch (error) {
          if (normalized.payload.status !== 'candidate') throw error;
          outcome = salvageCandidateOutcome_ACU(normalized.payload, modules, snapshot, input.runId, input.candidateSeq, false);
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
          if (report.blocking.length) {
            locatedIssues = report.blocking.filter(item => modules.includes(item.module as WorldSimulationLedgerModule_ACU))
              .map(item => ({ module: item.module as WorldSimulationLedgerModule_ACU, source: 'transaction_rejected', path: item.path, message: item.message }));
            throw new Error(report.blocking.slice(0, 8).map(item => `${item.path}: ${item.message}${item.details?.expected ? `；允许 ${item.details.expected}` : ''}`).join('；'));
          }
        }
        // 首轮建账只覆盖了部分模块时，记为待修复而不是再烧一轮模型调用。
        // 与智能续写的 missingFields 回执同义：已接受的先落账，缺的模块由下一轮按 pendingFixes 补齐。
        const uncovered = outcome.candidate
          ? oneShotUncoveredModules_ACU(modules, input.givenLedger, outcome.candidate.patch as Record<string, unknown>, input.baseLedgerRevision)
          : [];
        const residual: WorldSimulationSubagentIssue_ACU[] = [...locatedIssues,
          ...uncovered.map(module => ({ module, source: 'contract_rejected' as const, path: module,
            message: `首轮建账未覆盖 ${module}，该模块仍为空；下一轮须依据世界书与锚点补上初始条目` }))];
        // 先算出这一轮可交付的候选：有残余就带上 unresolvedIssues，供跨轮兜底与下一轮补录。
        const deliverable: WorldSimulationSubagentOutcome_ACU = residual.length
          ? { ...outcome, unresolvedIssues: residual,
            summary: `${outcome.summary}（另有 ${residual.length} 项未完成，留待下一轮补录）` }
          : outcome;
        // 跨轮保留残余更少的一份：纠错轮整批失效时，不把上一轮已合法的语句丢掉。
        if (!salvaged || (deliverable.unresolvedIssues?.length ?? 0) <= (salvaged.unresolvedIssues?.length ?? 0)) salvaged = deliverable;
        // 校验与交付分开；缺口留给下一轮，但本轮候选仍须独立确认。
        if (!locatedIssues.length) {
          updateSession(writeEntryId, { ok: true, status: 'done',
            title: residual.length ? `已通过校验，另有 ${residual.length} 项留待下一轮` : '已通过校验' });
          requestDelivery(deliverable, turn, raw);
          continue;
        }
        // 首轮仍回执一次，给模型改对整批的机会；salvaged 已记下这份候选。
        if (repairs < 1) {
          throw new Error(locatedIssues.slice(0, 8).map(issue => `${issue.path}: ${issue.message}`).join('；') || 'WORLD_SIMULATION_ONE_SHOT_SQL_REJECTED');
        }
        updateSession(writeEntryId, { ok: true, status: 'done', title: `部分采纳，另有 ${residual.length} 项留待下一轮` });
        requestDelivery(salvaged ?? deliverable, turn, raw);
        continue;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const lastAttempt = repairs++ >= 1;
        // SQL 原文已由 write_sql 条目完整保留；只有没有工具调用（纯文本回复）时才在这里附原文片段。
        const submitted = !sqlSubmitted ? (turn.toolCalls.map(call => `${call.name} ${call.arguments}`).join('；') || raw) : '';
        updateSession(writeEntryId, { ok: false, status: 'failed',
          title: lastAttempt ? '提交被拒，纠错次数已用完' : '提交被拒，已回执纠错' });
        logSession({ kind: 'protocol_retry', ok: false,
          title: lastAttempt ? (salvaged ? '纠错未成功，落账首轮已合法的部分' : '提交被拒，纠错次数已用完') : '提交被拒，已回执纠错',
          detail: `${reason}${submitted ? `｜模型提交：${submitted.slice(0, 900)}` : ''}` });
        // 纠错写入失效时可保留首轮合法候选；交付错误不能触发自动成功。
        if (lastAttempt) {
          if (sqlSubmitted && salvaged?.candidate && !pendingDelivery) {
            requestDelivery(salvaged, turn, raw);
            continue;
          }
          return failed(error, 'protocol_failed', locatedIssues);
        }
        const hint = oneShotRepairHint_ACU(locatedIssues, oneShotTables_ACU(modules));
        const retry = toolMode === 'tools'
          ? '若确有变化，只重新调用一次 write_sql 并修正拒绝的 SQL；已校验候选或无变化时单独调用 submit，无法完成用 submit 交付 failed。不要输出 JSON 或裸 SQL，不得将空回复视为无变化。'
          : '若确有变化，只重新输出一次 {"action":"write_sql","sql":"..."} 并修正拒绝的 SQL；已校验候选或无变化时单独输出交付 JSON，无法完成用 failed 契约。不要输出裸 SQL，不得将空回复视为无变化。';
        const feedback = `上一次提交未被采纳：${reason}。${hint} ${retry}`;
        if (toolMode === 'tools' && turn.toolCalls.length && turn.toolCalls.every(call => call.id && call.name)) transcript.push(...nativeToolExchange_ACU(turn.content, turn.toolCalls, turn.toolCalls.map(() => feedback)));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: feedback });
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
    const toolMode = input.toolMode ?? resolveWorldSimulationToolMode_ACU(preset);
    // tools 模式：现有工具 + submit 交付函数；json 模式请求不带 tools，缓存键带 mode:json。
    const request = worldSimulationInvokeTools_ACU(toolMode, [...agentNativeTools_ACU(legacyTools), worldSimulationSpecialistSubmitTool_ACU()]);
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
      const split = splitWorldSimulationSubagentPrompt_ACU(adaptWorldSimulationPromptSegmentsToToolMode_ACU(agentName, legacyPrompt, toolMode), agentName);
      const rendered = await renderWorldSimulationPrompt_ACU(split.segments, agentName, resolvers);
      const snapshot = await renderWorldSimulationSnapshotSections_ACU(split.snapshotTemplate, resolvers,
        isWorldSimulationLedgerContext_ACU(requestContext.worldState) ? { ledger: requestContext.worldState.revision } : {});
      const snapshotText = snapshot.text;
      const guidance = split.movedGuidanceIndex >= 0 ? rendered.messages[split.movedGuidanceIndex]?.content : '';
      const appendix = [snapshotText, guidance, input.triggeredWorldbook ?? ''].filter(Boolean).join('\n\n');
      const protocolGuard = { role: 'system', content: worldSimulationProtocolForMode_ACU(agentName, worldSimulationSpecialistRuntimeProtocolInstruction_ACU(agentName, writableModules), toolMode) };
      const drafted = [protocolGuard, ...rendered.messages.filter((message, index) => index !== split.movedGuidanceIndex && message.content !== USER_PREFILL_CONTENT_ACU), ...transcript, ...(appendix ? [{ role: 'user', content: appendix }] : []), ...(rendered.messages.some(message => message.content === USER_PREFILL_CONTENT_ACU)
        ? [{ role: 'user', content: USER_PREFILL_CONTENT_ACU }]
        : [])];
      const messages = finishWorldSimulationMessages_ACU(toolMode, drafted, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName]);
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages,
        inputLimitTokens: input.settings.agentHistoryTokenBudget,
        tools: request.tools,
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => {
          if (snapshot.text) verifyWorldSimulationSnapshotSections_ACU(snapshot, value);
          if (input.fixedWorldbook) {
            if (input.fixedWorldbook.text !== (input.triggeredWorldbook ?? '')) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
            verifyWorldSimulationFixedWorldbook_ACU(input.fixedWorldbook, value);
          }
          return this.dependencies.invoke(agentName, value, preset, request);
        },
      });
      if (input.isCurrent && !input.isCurrent()) throw new Error('WORLD_SIMULATION_RUN_STALE');
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const turn = normalizeAgentModelReply_ACU(sent.response);
      const nativeCalls: AiNativeToolCall_ACU[] = turn.toolCalls;
      const raw = typeof sent.response === 'string' ? sent.response : turn.content;
      let calls: ReturnType<typeof parseWorldSimulationSubagentToolCalls_ACU>;
      // tools 模式下 submit 的参数（已去掉 action），交给原契约解析器。
      let submitted: Record<string, unknown> | null = null;
      try {
        if (toolMode === 'tools') {
          if (!nativeCalls.length) throw new Error('工具模式下必须调用函数：读取与写入用对应函数，交付结果调用 submit，不要输出 JSON 文本');
          const split = splitNativeDecisionCalls_ACU(nativeToolArguments_ACU(nativeCalls), [AGENT_SUBMIT_TOOL_NAME_ACU]);
          if (split.decision) submitted = submitPayloadObject_ACU(split.decision.payload);
          calls = split.tools.length ? split.tools.map(({ call, payload }) => {
            if (call.name === 'write_sql') {
              if (!legacyTools.includes('write_sql') || !input.writeSql || !writableModules.length || Object.keys(payload).some(key => !['action', 'sql', 'evidenceRefs'].includes(key))) throw new Error('write_sql 未授权或参数非法');
              return parseWorldSimulationSubagentToolCalls_ACU(JSON.stringify(payload), '', requestSnapshot, true)![0];
            }
            if (!worldSimulationAgentNativeTools_ACU(agentName).includes(call.name as 'read' | 'search')) throw new Error(`工具 ${call.name} 未获 ${agentName} profile 授权`);
            const parsed = parseWorldSimulationMainAction_ACU(payload, false, requestSnapshot);
            if (parsed.kind !== call.name) throw new Error('工具名称与动作不一致');
            return parsed as Extract<ReturnType<typeof parseWorldSimulationMainAction_ACU>, { kind: 'read' | 'search' }>;
          }) : null;
        } else {
          if (nativeCalls.length) throw new Error('当前为 JSON 模式，不要调用函数；把动作写成 JSON 对象输出');
          // 文本 JSON 的 read/search/write_sql 按批次执行；授权与 tools 模式同一口径。
          calls = parseWorldSimulationSubagentToolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot,
            legacyTools.includes('write_sql') && !!input.writeSql && writableModules.length > 0);
          for (const call of calls ?? []) {
            if (call.kind !== 'write_sql' && !worldSimulationAgentNativeTools_ACU(agentName).includes(call.kind)) throw new Error(`工具 ${call.kind} 未获 ${agentName} profile 授权`);
          }
        }
      } catch (error) {
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry && writeAttempted) return checkedOutcome({ agentName, status: 'failed', summary: '逐栏工具协议重试耗尽',
          reasonCode: 'WORLD_SIMULATION_PROTOCOL_FAILED', evidenceRefs: [], uncertainties: [], completion: 'failed',
          unresolvedIssues: [{ module: writableModules[0], source: 'protocol_failed', path: 'write_sql', message: `${failure.issue.reasonCode}: ${failure.issue.path}` }],
          acceptedKeys: [...confirmedFields] });
        if (!failure.retry) throw error;
        const reason = renderWorldSimulationSpecialistProtocolRejection_ACU(failure.issue, agentName, writableModules, toolMode);
        if (toolMode === 'tools' && nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => reason)));
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
        if (toolMode === 'tools') transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, perCall.map(items => JSON.stringify({ results: items, ...summary }))));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `【工具结果】\n${JSON.stringify({ results: perCall.flat(), ...summary })}` });
        continue;
      }
      try {
        const draft = submitted
          ? { payload: submitted, truncated: false }
          : parseWorldSimulationJsonDraft_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['status']);
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
        const rejection = renderWorldSimulationSpecialistProtocolRejection_ACU(failure.issue, agentName, definition.writableModules, toolMode);
        if (toolMode === 'tools' && nativeCalls.length) transcript.push(...nativeToolExchange_ACU(turn.content, nativeCalls, nativeCalls.map(() => rejection)));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: rejection });
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
    const toolMode = input.toolMode ?? resolveWorldSimulationToolMode_ACU(preset);
    const request = worldSimulationInvokeTools_ACU(toolMode, [...agentNativeTools_ACU(worldSimulationAgentNativeTools_ACU(agentName)), worldSimulationReviewerSubmitTool_ACU()]);
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
      const split = splitWorldSimulationSubagentPrompt_ACU(adaptWorldSimulationPromptSegmentsToToolMode_ACU(agentName, input.settings.agentPrompts[agentName], toolMode), agentName);
      const rendered = await renderWorldSimulationPrompt_ACU(split.segments, agentName, resolvers);
      const snapshot = await renderWorldSimulationSnapshotSections_ACU(split.snapshotTemplate, resolvers,
        isWorldSimulationLedgerContext_ACU(requestContext.worldState) ? { ledger: requestContext.worldState.revision } : {});
      const snapshotText = snapshot.text;
      const guidance = split.movedGuidanceIndex >= 0 ? rendered.messages[split.movedGuidanceIndex]?.content : '';
      const appendix = [snapshotText, guidance, input.triggeredWorldbook ?? ''].filter(Boolean).join('\n\n');
      const protocolGuard = { role: 'system', content: worldSimulationProtocolForMode_ACU(agentName, worldSimulationReviewerRuntimeProtocolInstruction_ACU(), toolMode) };
      const reviewerDraft = [protocolGuard, ...rendered.messages.filter((message, index) => index !== split.movedGuidanceIndex && message.content !== USER_PREFILL_CONTENT_ACU), ...transcript, ...(appendix ? [{ role: 'user', content: appendix }] : []), ...(rendered.messages.some(message => message.content === USER_PREFILL_CONTENT_ACU)
        ? [{ role: 'user', content: USER_PREFILL_CONTENT_ACU }]
        : [])];
      const sent = await executeWorldSimulationFinalRequest_ACU({
        messages: finishWorldSimulationMessages_ACU(toolMode, reviewerDraft, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName]),
        inputLimitTokens: input.settings.agentHistoryTokenBudget,
        tools: request.tools,
        historyBudgetTokens: input.settings.agentHistoryTokenBudget,
        count: this.dependencies.countTokens ?? countWorldSimulationTokens_ACU,
        invoke: value => {
          if (snapshot.text) verifyWorldSimulationSnapshotSections_ACU(snapshot, value);
          if (input.fixedWorldbook) {
            if (input.fixedWorldbook.text !== (input.triggeredWorldbook ?? '')) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
            verifyWorldSimulationFixedWorldbook_ACU(input.fixedWorldbook, value);
          }
          return this.dependencies.invoke(agentName, value, preset, request);
        },
      });
      if (input.isCurrent?.() === false) throw new Error('WORLD_SIMULATION_RUN_STALE');
      if (sent.status === 'rejected') throw new Error(sent.reason);
      const reviewerTurn = normalizeAgentModelReply_ACU(sent.response);
      const reviewerNative = reviewerTurn.toolCalls;
      const raw = typeof sent.response === 'string' ? sent.response : reviewerTurn.content;
      let calls: ReturnType<typeof toolCalls_ACU>;
      let submitted: Record<string, unknown> | null = null;
      try {
        if (toolMode === 'tools') {
          if (!reviewerNative.length) throw new Error('工具模式下必须调用函数：补读用 read，交付审核结论调用 submit，不要输出 JSON 文本');
          const split = splitNativeDecisionCalls_ACU(nativeToolArguments_ACU(reviewerNative), [AGENT_SUBMIT_TOOL_NAME_ACU]);
          if (split.decision) submitted = submitPayloadObject_ACU(split.decision.payload);
          calls = split.tools.length ? split.tools.map(({ call, payload }) => {
            if (!worldSimulationAgentNativeTools_ACU(agentName).includes(call.name as 'read' | 'search')) throw new Error(`工具 ${call.name} 未获 ${agentName} profile 授权`);
            const parsed = parseWorldSimulationMainAction_ACU(payload, false, requestSnapshot);
            if (parsed.kind !== 'read') throw new Error('reviewer 只允许 read');
            return parsed as Extract<ReturnType<typeof parseWorldSimulationMainAction_ACU>, { kind: 'read' | 'search' }>;
          }) : null;
        } else {
          if (reviewerNative.length) throw new Error('当前为 JSON 模式，不要调用函数；把动作写成 JSON 对象输出');
          calls = toolCalls_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], requestSnapshot);
          if (calls?.some(call => call.kind !== 'read')) throw new Error('reviewer 只允许 read');
        }
      } catch (error) {
        if (toolMode === 'tools' && reviewerNative.length) {
          const reason = error instanceof Error ? error.message : String(error);
          transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative, reviewerNative.map(() => reason)));
          continue;
        }
        const failure = recordWorldSimulationProtocolFailure_ACU(repair, error);
        if (!failure.retry) throw error;
        transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: renderWorldSimulationReviewerProtocolRejection_ACU(failure.issue, toolMode) });
        continue;
      }
      if (calls) {
        if (toolRounds >= input.settings.agentRunBudget.maxExtraReads) {
          const exhausted = toolMode === 'tools'
            ? 'reviewer 的 read 轮次已用尽，请依据现有候选与证据调用 submit 交付审核结论。'
            : 'reviewer 的 read 轮次已用尽，请依据现有候选与证据输出终审 JSON。';
          if (toolMode === 'tools') transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative, reviewerNative.map(() => exhausted)));
          else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: exhausted });
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
        if (toolMode === 'tools') transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative,
          calls.map((_, index) => index === 0 ? toolText_ACU(batchResults) : '本逻辑读取批次已统一结算，结果见首个工具回执。')));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: `【工具结果】\n${toolText_ACU(batchResults)}` });
        continue;
      }
      try {
        const payload = submitted ?? parseWorldSimulationJsonPayload_ACU(raw, WORLD_SIMULATION_AGENT_PREFILLS_ACU[agentName], ['verdict']);
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
        const rejection = renderWorldSimulationReviewerProtocolRejection_ACU(failure.issue, toolMode);
        if (toolMode === 'tools' && reviewerNative.length) transcript.push(...nativeToolExchange_ACU(reviewerTurn.content, reviewerNative, reviewerNative.map(() => rejection)));
        else transcript.push({ role: 'assistant', content: raw || '(empty)' }, { role: 'user', content: rejection });
      }
    }
    throw new Error(`WORLD_SIMULATION_REVIEWER_CALL_LIMIT:${maxCalls}`);
  }

}
