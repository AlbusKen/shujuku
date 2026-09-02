/**
 * service/continuation/agent/agent-module-store.ts — 楼层锚定的叙事资料快照存储
 *
 * 存储策略：全量快照写入被结算范围最后一楼的独立字段，读取时从尾向前找最近的合法快照。
 * 删楼、Swipe、编辑替换都会让该楼层连同快照一起消失，资料自动回退到上一个快照，
 * 因此这里不需要任何失效协调机制。
 */

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_BLOCK_CHAR_LIMIT_ACU,
  AGENT_CHRONOLOGY_PRECISIONS_ACU,
  AGENT_HOOK_IMPORTANCES_ACU,
  AGENT_HOOK_STATUSES_ACU,
  AGENT_HOT_HOOK_LIMIT_ACU,
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_REVEAL_STATUSES_ACU,
  AGENT_STORY_ARC_SCOPES_ACU,
  AGENT_STORY_ARC_STATUSES_ACU,
  AGENT_VOLUME_NARRATIVE_ROLES_ACU,
  type AgentChronologyEntry_ACU,
  type AgentConstraintEntry_ACU,
  type AgentHookEntry_ACU,
  type AgentInfoGapEntry_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentStoryArcEntry_ACU,
} from './agent-model';

const IMPORTANCE_WEIGHTS_ACU: Record<string, number> = { high: 3, mid: 2, low: 1 };

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText_ACU(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readIndex_ACU(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;
}

function readEnum_ACU(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export function buildEmptyAgentModuleSnapshot_ACU(): AgentModuleSnapshot_ACU {
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: -1,
    updatedAt: 0,
    revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0 },
    hooks: [],
    infoGap: [],
    constraints: [],
    storyArc: [],
    chronology: [],
  };
}

/** 证据楼层列表：只接受非负整数，去重后升序。是否越过结算水位由事务层校验。 */
export function normalizeEvidenceIndexes_ACU(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const indexes: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) return null;
    indexes.push(item);
  }
  return [...new Set(indexes)].sort((left, right) => left - right);
}

/** 阶段编号列表：只接受正整数，去重后升序。乱序或重复是模型回写进度时的常见噪音。 */
export function normalizeStageNumbers_ACU(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const numbers = value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 1);
  return [...new Set(numbers)].sort((left, right) => left - right);
}

function validateHookEntry_ACU(raw: unknown): AgentHookEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const summary = readText_ACU(raw.summary).trim();
  if (!id || !summary) return null;
  return {
    id,
    summary,
    status: readEnum_ACU(raw.status, AGENT_HOOK_STATUSES_ACU, 'planted') as AgentHookEntry_ACU['status'],
    importance: readEnum_ACU(raw.importance, AGENT_HOOK_IMPORTANCES_ACU, 'mid') as AgentHookEntry_ACU['importance'],
    plantedIndex: readIndex_ACU(raw.plantedIndex),
    updatedIndex: readIndex_ACU(raw.updatedIndex),
    plannedPayoff: readText_ACU(raw.plannedPayoff),
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

function validateInfoGapEntry_ACU(raw: unknown): AgentInfoGapEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const topic = readText_ACU(raw.topic).trim();
  if (!id || !topic) return null;
  const knowledge = Array.isArray(raw.characterKnowledge) ? raw.characterKnowledge : [];
  const revealStatus = readEnum_ACU(raw.revealStatus, AGENT_REVEAL_STATUSES_ACU, 'unrevealed') as AgentInfoGapEntry_ACU['revealStatus'];
  const revealIndex = readIndex_ACU(raw.revealIndex);
  return {
    id,
    topic,
    objectiveFact: readText_ACU(raw.objectiveFact),
    readerKnown: readText_ACU(raw.readerKnown),
    characterKnowledge: knowledge.flatMap(item => {
      if (!isRecord_ACU(item)) return [];
      const name = readText_ACU(item.name).trim();
      return name ? [{ name, knows: readText_ACU(item.knows) }] : [];
    }),
    revealStatus,
    // 未揭示的条目不允许携带揭示楼层，这是模型把计划写成事实的典型症状。
    revealIndex: revealStatus === 'unrevealed' || revealIndex < 0 ? null : revealIndex,
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

function readOptionalStoryArcText_ACU(raw: Record<string, unknown>, key: string): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return undefined;
  return typeof raw[key] === 'string' ? raw[key].trim() : null;
}

function readOptionalStoryArcTextList_ACU(raw: Record<string, unknown>, key: string): string[] | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return undefined;
  const value = raw[key];
  if (!Array.isArray(value)) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    normalized.push(item.trim());
  }
  return normalized;
}

function readOptionalTargetStageRange_ACU(raw: Record<string, unknown>): { min: number; max: number } | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(raw, 'targetStageRange')) return undefined;
  const value = raw.targetStageRange;
  if (!isRecord_ACU(value)) return null;
  const { min, max } = value;
  if (!Number.isInteger(min) || (min as number) < 1 || !Number.isInteger(max) || (max as number) < 1 || (min as number) > (max as number)) return null;
  return { min: min as number, max: max as number };
}

function validateStoryArcEntry_ACU(raw: unknown): AgentStoryArcEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const title = readText_ACU(raw.title).trim();
  if (!id || !title) return null;
  const narrativeRole = Object.prototype.hasOwnProperty.call(raw, 'narrativeRole')
    ? readEnum_ACU(raw.narrativeRole, AGENT_VOLUME_NARRATIVE_ROLES_ACU, '')
    : undefined;
  const targetStageRange = readOptionalTargetStageRange_ACU(raw);
  const targetTimeSpan = readOptionalStoryArcText_ACU(raw, 'targetTimeSpan');
  const progressCeiling = readOptionalStoryArcText_ACU(raw, 'progressCeiling');
  const sustainingThreads = readOptionalStoryArcTextList_ACU(raw, 'sustainingThreads');
  const payoffTargets = readOptionalStoryArcTextList_ACU(raw, 'payoffTargets');
  const completionRationale = readOptionalStoryArcText_ACU(raw, 'completionRationale');
  if (narrativeRole === '' || targetStageRange === null || targetTimeSpan === null || progressCeiling === null || sustainingThreads === null || payoffTargets === null || completionRationale === null) return null;
  return {
    id,
    scope: readEnum_ACU(raw.scope, AGENT_STORY_ARC_SCOPES_ACU, 'volume') as AgentStoryArcEntry_ACU['scope'],
    title,
    direction: readText_ACU(raw.direction),
    escalation: readText_ACU(raw.escalation),
    withheld: readText_ACU(raw.withheld),
    status: readEnum_ACU(raw.status, AGENT_STORY_ARC_STATUSES_ACU, 'planned') as AgentStoryArcEntry_ACU['status'],
    stageNumbers: normalizeStageNumbers_ACU(raw.stageNumbers),
    completionStageNumber: typeof raw.completionStageNumber === 'number' && Number.isInteger(raw.completionStageNumber) && raw.completionStageNumber >= 1 ? raw.completionStageNumber : null,
    completionState: readText_ACU(raw.completionState),
    continuationRationale: readText_ACU(raw.continuationRationale),
    narrativeRole: narrativeRole as AgentStoryArcEntry_ACU['narrativeRole'],
    targetStageRange,
    targetTimeSpan,
    progressCeiling,
    sustainingThreads,
    payoffTargets,
    completionRationale,
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

/**
 * 严格校验一条持久化的年代学记录。chronology 是 P3 才引入的字段：旧快照根本没有它，
 * 因此不存在「宽容旧形态」的需要——字段一旦出现就必须结构完整，坏条目不做静默降级。
 */
function validateChronologyEntry_ACU(raw: unknown): AgentChronologyEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const anchor = readText_ACU(raw.anchor).trim();
  const elapsed = readText_ACU(raw.elapsed).trim();
  const transition = readText_ACU(raw.transition).trim();
  if (!id || !anchor || !elapsed || !transition) return null;
  const precision = typeof raw.precision === 'string' && (AGENT_CHRONOLOGY_PRECISIONS_ACU as readonly string[]).includes(raw.precision) ? raw.precision : null;
  if (!precision) return null;
  const evidenceIndexes = normalizeEvidenceIndexes_ACU(raw.evidenceIndexes);
  if (!evidenceIndexes || !evidenceIndexes.length) return null;
  const updatedIndex = readIndex_ACU(raw.updatedIndex);
  if (updatedIndex < 0) return null;
  const retired = raw.retired === true;
  const retiredReason = readText_ACU(raw.retiredReason);
  if (retired && !retiredReason.trim()) return null;
  return {
    id,
    anchor,
    elapsed,
    precision: precision as AgentChronologyEntry_ACU['precision'],
    transition,
    evidenceIndexes,
    updatedIndex,
    retired,
    retiredReason,
  };
}

function validateConstraintEntry_ACU(raw: unknown): AgentConstraintEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const text = readText_ACU(raw.text).trim();
  if (!id || !text) return null;
  return { id, text, reason: readText_ACU(raw.reason), createdIndex: readIndex_ACU(raw.createdIndex) };
}

/**
 * 校验一份持久化快照。非法返回 null 而不抛错，让读取端可以继续向前寻找上一个合法快照，
 * 因为某一楼层的字段可能只是被外部工具污染，不代表整条链路不可用。
 */
export function validateAgentModuleSnapshot_ACU(raw: unknown): AgentModuleSnapshot_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_ACU) return null;
  if (!isRecord_ACU(raw.revisions)) return null;
  if (!Array.isArray(raw.hooks) || !Array.isArray(raw.infoGap) || !Array.isArray(raw.constraints)) return null;
  const settledThroughIndex = readIndex_ACU(raw.settledThroughIndex);
  if (settledThroughIndex < 0) return null;
  // storyArc 晚于前三个模块加入，存量楼层的快照里没有这个键。写成必需会让全部历史快照
  // 被判非法、资料静默回退成空，因此这里按「有则校验、无则空数组」处理。
  const storyArc = Array.isArray(raw.storyArc) ? raw.storyArc : [];
  const validatedStoryArc = storyArc.map(validateStoryArcEntry_ACU);
  // 总纲条目不能像普通搜索命中一样被悄悄过滤；任一结构损坏都应让读取端回退上一份完整快照。
  if (validatedStoryArc.some(entry => entry === null)) return null;
  // chronology 同样后于早期快照加入：缺字段兼容为空账本；但字段一旦存在就必须整体合法——
  // 时间事实被静默过滤比暂时回退旧快照更危险（后续结算会基于错误的时间线登记新事实）。
  if (Object.prototype.hasOwnProperty.call(raw, 'chronology') && !Array.isArray(raw.chronology)) return null;
  const chronology = Array.isArray(raw.chronology) ? raw.chronology : [];
  const validatedChronology = chronology.map(validateChronologyEntry_ACU);
  if (validatedChronology.some(entry => entry === null)) return null;
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    revisions: {
      hooks: Math.max(0, readIndex_ACU(raw.revisions.hooks)),
      infoGap: Math.max(0, readIndex_ACU(raw.revisions.infoGap)),
      constraints: Math.max(0, readIndex_ACU(raw.revisions.constraints)),
      storyArc: Math.max(0, readIndex_ACU(raw.revisions.storyArc)),
      chronology: Math.max(0, readIndex_ACU(raw.revisions.chronology)),
    },
    hooks: raw.hooks.flatMap(item => { const entry = validateHookEntry_ACU(item); return entry ? [entry] : []; }),
    infoGap: raw.infoGap.flatMap(item => { const entry = validateInfoGapEntry_ACU(item); return entry ? [entry] : []; }),
    constraints: raw.constraints.flatMap(item => { const entry = validateConstraintEntry_ACU(item); return entry ? [entry] : []; }),
    storyArc: validatedStoryArc as AgentStoryArcEntry_ACU[],
    chronology: validatedChronology as AgentChronologyEntry_ACU[],
  };
}

/**
 * 宽容解析一份损坏的快照：丢掉单条非法记录、修正非法水位，尽量保住其余数据。
 * 只在严格路径全程无命中时作为兜底使用——静默回退成空快照会让用户误以为数据从未写入。
 */
function salvageAgentModuleSnapshot_ACU(raw: unknown): { snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null {
  if (!isRecord_ACU(raw)) return null;
  const problems: string[] = [];
  if (raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_ACU) problems.push(`schemaVersion=${String(raw.schemaVersion)} 与当前 ${AGENT_MODULE_SCHEMA_VERSION_ACU} 不一致`);
  const revisions = isRecord_ACU(raw.revisions) ? raw.revisions : {};
  const pick = <T>(list: unknown, validate: (item: unknown) => T | null, label: string): T[] => {
    if (!Array.isArray(list)) { if (list !== undefined) problems.push(`${label} 不是数组`); return []; }
    const kept: T[] = [];
    list.forEach((item, index) => { const entry = validate(item); if (entry) kept.push(entry); else problems.push(`${label}[${index}] 结构非法，已丢弃`); });
    return kept;
  };
  const settledThroughIndex = readIndex_ACU(raw.settledThroughIndex);
  if (settledThroughIndex < 0) problems.push(`settledThroughIndex=${String(raw.settledThroughIndex)} 非法，按 0 处理`);
  const snapshot: AgentModuleSnapshot_ACU = {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: Math.max(0, settledThroughIndex),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    revisions: {
      hooks: Math.max(0, readIndex_ACU(revisions.hooks)),
      infoGap: Math.max(0, readIndex_ACU(revisions.infoGap)),
      constraints: Math.max(0, readIndex_ACU(revisions.constraints)),
      storyArc: Math.max(0, readIndex_ACU(revisions.storyArc)),
      chronology: Math.max(0, readIndex_ACU(revisions.chronology)),
    },
    hooks: pick(raw.hooks, validateHookEntry_ACU, 'hooks'),
    infoGap: pick(raw.infoGap, validateInfoGapEntry_ACU, 'infoGap'),
    constraints: pick(raw.constraints, validateConstraintEntry_ACU, 'constraints'),
    storyArc: pick(raw.storyArc, validateStoryArcEntry_ACU, 'storyArc'),
    chronology: pick(raw.chronology, validateChronologyEntry_ACU, 'chronology'),
  };
  return { snapshot, problems };
}

/** 一次读取的诊断：哪些楼层带有快照字段、是否通过严格校验、最终采用了哪一楼。 */
export interface AgentModuleSnapshotReadDiagnostics_ACU {
  /** 带快照字段的楼层（从末楼往前）。 */
  candidates: Array<{ index: number; valid: boolean; problems: string[] }>;
  /** 最终采用的楼层；无任何快照时为 null。 */
  adoptedIndex: number | null;
  /** 采用的是否为宽容抢救结果。 */
  salvaged: boolean;
}

let lastReadDiagnostics_ACU: AgentModuleSnapshotReadDiagnostics_ACU = { candidates: [], adoptedIndex: null, salvaged: false };

/** 最近一次 readAgentModuleSnapshot_ACU 的诊断信息，供面板解释“为什么资料是空的/是旧的”。 */
export function readAgentModuleSnapshotDiagnostics_ACU(): AgentModuleSnapshotReadDiagnostics_ACU {
  return lastReadDiagnostics_ACU;
}

/**
 * 读取当前生效的资料快照。
 * 严格路径：从尾向前找第一个完全合法的快照。全程无命中但存在损坏快照时，不再静默返回空，
 * 而是对最近一份做宽容抢救（丢单条坏记录）并记录诊断——数据消失必须可解释。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 最近的合法快照；全程无命中时返回 settledThroughIndex = -1 的空快照
 */
export function readAgentModuleSnapshot_ACU(chat?: any[]): AgentModuleSnapshot_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const highestIndex = messages.length - 1;
  const clamp = (snapshot: AgentModuleSnapshot_ACU): AgentModuleSnapshot_ACU => (
    // 删楼后残留快照记录的水位可能指向已不存在的楼层，必须钳制，否则未结算区间会算成负数。
    snapshot.settledThroughIndex > highestIndex ? { ...snapshot, settledThroughIndex: highestIndex } : snapshot
  );
  const diagnostics: AgentModuleSnapshotReadDiagnostics_ACU = { candidates: [], adoptedIndex: null, salvaged: false };
  let firstBroken: { index: number; raw: unknown } | null = null;
  for (let index = highestIndex; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) continue;
    const raw = (message as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU];
    const snapshot = validateAgentModuleSnapshot_ACU(raw);
    if (snapshot) {
      diagnostics.candidates.push({ index, valid: true, problems: [] });
      diagnostics.adoptedIndex = index;
      lastReadDiagnostics_ACU = diagnostics;
      return clamp(snapshot);
    }
    const salvaged = salvageAgentModuleSnapshot_ACU(raw);
    diagnostics.candidates.push({ index, valid: false, problems: salvaged?.problems ?? ['快照不是对象'] });
    if (!firstBroken) firstBroken = { index, raw };
  }
  if (firstBroken) {
    const salvaged = salvageAgentModuleSnapshot_ACU(firstBroken.raw);
    if (salvaged) {
      diagnostics.adoptedIndex = firstBroken.index;
      diagnostics.salvaged = true;
      lastReadDiagnostics_ACU = diagnostics;
      console.warn(`[SP·数据库][续写资料] 楼层 ${firstBroken.index} 的资料快照未通过严格校验，已按宽容模式读取：${salvaged.problems.join('；')}`);
      return clamp(salvaged.snapshot);
    }
  }
  lastReadDiagnostics_ACU = diagnostics;
  return buildEmptyAgentModuleSnapshot_ACU();
}

/**
 * 把快照写入指定楼层并真实提交到宿主。
 *
 * 结算水位以快照自带的 settledThroughIndex 为准，只做合法性钳制（0 ≤ 水位 ≤ 承载楼层）：
 * 写盘不推水位——立总纲、用户手动保存都不代表未结算正文被结算过，水位推进只由
 * 结算派工成功后显式设置。
 * @param chat 聊天数组
 * @param targetIndex 承载快照的楼层下标，通常是当前末楼
 * @param snapshot 待写入的全量快照
 */
export async function writeAgentModuleSnapshot_ACU(chat: any[], targetIndex: number, snapshot: AgentModuleSnapshot_ACU): Promise<void> {
  const message = Array.isArray(chat) ? chat[targetIndex] : null;
  if (!message || typeof message !== 'object') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 资料快照的目标楼层不可用', false, { targetIndex }));
  }
  const container = message as Record<string, unknown>;
  const hadPrevious = Object.prototype.hasOwnProperty.call(container, AGENT_MODULE_FIELD_ACU);
  const previous = container[AGENT_MODULE_FIELD_ACU];
  const settledThroughIndex = Math.min(Math.max(snapshot.settledThroughIndex, 0), targetIndex);
  try {
    container[AGENT_MODULE_FIELD_ACU] = { ...snapshot, settledThroughIndex, updatedAt: Date.now() };
    await saveChatToHostStrict_ACU();
  } catch (error) {
    if (hadPrevious) container[AGENT_MODULE_FIELD_ACU] = previous;
    else delete container[AGENT_MODULE_FIELD_ACU];
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 资料快照写盘失败，已还原楼层字段', false, { targetIndex, message: error instanceof Error ? error.message : String(error) }));
  }
}

function rejectSnapshotEdit_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', message, false, details));
}

/**
 * 用户手动改写资料快照。
 *
 * 与子代理写入的关键区别是「不容忍静默丢条目」：校验器为了容错会丢掉结构非法的单条记录，
 * 那对模型输出是合理的降级，但对用户编辑是数据丢失——用户会以为自己保存成功了。因此这里
 * 逐类比对条目数，只要有条目被丢弃就整份拒绝并指出是哪一类。
 * @param raw 用户编辑后的快照对象（可只带 hooks / infoGap / constraints / storyArc）
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 落盘后的快照
 */
export async function replaceAgentModuleSnapshotByUser_ACU(raw: unknown, chat?: any[]): Promise<AgentModuleSnapshot_ACU> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const targetIndex = messages.length - 1;
  if (targetIndex < 0) rejectSnapshotEdit_ACU('当前聊天没有可承载资料快照的楼层');
  if (!isRecord_ACU(raw)) rejectSnapshotEdit_ACU('资料快照必须是 JSON 对象');
  const current = readAgentModuleSnapshot_ACU(messages);
  const merged = {
    ...current,
    ...raw,
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    // 手动保存不推进结算水位：用户改资料不代表未结算正文被结算过。保留现有水位，
    // 新聊天的 -1 钳制为 0（校验器拒绝负值），上限钳制交给写盘函数。
    settledThroughIndex: Math.max(current.settledThroughIndex, 0),
    // 手动编辑同样推进修订号：否则携带旧修订号的子代理写集会通过并覆盖用户刚保存的内容。
    revisions: {
      hooks: current.revisions.hooks + 1,
      infoGap: current.revisions.infoGap + 1,
      constraints: current.revisions.constraints + 1,
      storyArc: current.revisions.storyArc + 1,
      chronology: current.revisions.chronology + 1,
    },
  };
  const validated = validateAgentModuleSnapshot_ACU(merged);
  if (!validated) rejectSnapshotEdit_ACU('资料快照结构非法：hooks / infoGap / constraints 必须是数组；storyArc / chronology 一旦提供必须整体结构合法（chronology 每条需要非空 id/anchor/elapsed/transition、合法 precision、非空非负整数 evidenceIndexes 与非负 updatedIndex，retire 需给理由）');
  const checks: Array<[string, unknown, readonly unknown[]]> = [
    ['伏笔账本 hooks', merged.hooks, validated.hooks],
    ['信息差 infoGap', merged.infoGap, validated.infoGap],
    ['长期约束 constraints', merged.constraints, validated.constraints],
    ['故事总纲 storyArc', merged.storyArc, validated.storyArc],
    ['故事年代学账本 chronology', merged.chronology, validated.chronology],
  ];
  for (const [label, input, accepted] of checks) {
    const inputLength = Array.isArray(input) ? input.length : 0;
    if (inputLength !== accepted.length) {
      rejectSnapshotEdit_ACU(`${label} 中有 ${inputLength - accepted.length} 条记录不符合结构要求（id 与关键文本字段不能为空），整份编辑未保存`, { label, inputLength, acceptedLength: accepted.length });
    }
  }
  await writeAgentModuleSnapshot_ACU(messages, targetIndex, validated);
  return validated;
}

/**
 * 从全部楼层清除资料快照字段。用于「一键清空」，只删扩展字段，绝不触碰正文。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否有楼层被改动
 */
export async function clearAgentModuleField_ACU(chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) continue;
    delete (message as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU];
    changed = true;
  }
  if (changed) await saveChatToHostStrict_ACU();
  return changed;
}

function truncateAgentBlock_ACU(text: string): string {
  if (text.length <= AGENT_BLOCK_CHAR_LIMIT_ACU) return text;
  return `${text.slice(0, AGENT_BLOCK_CHAR_LIMIT_ACU)}\n（本资料块超出 ${AGENT_BLOCK_CHAR_LIMIT_ACU} 字上限，已截断；未展示部分不代表不存在）`;
}

function compareHooks_ACU(left: AgentHookEntry_ACU, right: AgentHookEntry_ACU): number {
  const weight = (IMPORTANCE_WEIGHTS_ACU[right.importance] ?? 0) - (IMPORTANCE_WEIGHTS_ACU[left.importance] ?? 0);
  return weight !== 0 ? weight : right.plantedIndex - left.plantedIndex;
}

/**
 * 渲染伏笔账本的热上下文。
 * @param snapshot 当前快照
 * @returns 自然语言文本；活跃条目超过上限时如实标注未展示数量
 */
export function renderAgentHooksLedger_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  // 修订号必须放在首行：材料超长被截断时也不会丢失并发校验依据。
  const head = `当前修订号=${snapshot.revisions.hooks}`;
  const active = snapshot.hooks.filter(hook => !hook.retired);
  if (!active.length) return `${head}\n当前没有活跃伏笔。`;
  const sorted = [...active].sort(compareHooks_ACU);
  const shown = sorted.slice(0, AGENT_HOT_HOOK_LIMIT_ACU);
  const lines = shown.map(hook => [
    `- [${hook.id}] 重要度=${hook.importance} 状态=${hook.status} 埋设楼层=${hook.plantedIndex} 最近变动楼层=${hook.updatedIndex}`,
    `  内容：${hook.summary}`,
    hook.plannedPayoff ? `  计划回收：${hook.plannedPayoff}` : '',
  ].filter(Boolean).join('\n'));
  const hidden = sorted.length - shown.length;
  const tail = hidden > 0 ? `\n另有 ${hidden} 条活跃伏笔未进入本次热上下文，需要时请派工读取完整账本。` : '';
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}${tail}`);
}

/**
 * 渲染认知与信息差时间线。
 * @param snapshot 当前快照
 * @returns 自然语言文本，包含客观事实、读者已知、各角色知晓与揭示状态
 */
export function renderAgentInfoGap_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.infoGap}`;
  const active = snapshot.infoGap.filter(entry => !entry.retired);
  if (!active.length) return `${head}\n当前没有登记的信息差条目。`;
  const lines = active.map(entry => [
    `- [${entry.id}] ${entry.topic}（揭示状态=${entry.revealStatus}${entry.revealIndex === null ? '' : `，揭示楼层=${entry.revealIndex}`}）`,
    `  客观事实：${entry.objectiveFact || '（未登记）'}`,
    `  读者已知：${entry.readerKnown || '（未登记）'}`,
    entry.characterKnowledge.length ? `  角色知晓：${entry.characterKnowledge.map(item => `${item.name}=${item.knows}`).join('；')}` : '',
  ].filter(Boolean).join('\n'));
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}`);
}

/**
 * 渲染长期约束清单。
 * @param snapshot 当前快照
 * @returns 自然语言文本，每条包含约束内容与登记理由
 */
export function renderAgentConstraints_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.constraints}`;
  if (!snapshot.constraints.length) return `${head}\n当前没有登记的长期约束。`;
  const lines = snapshot.constraints.map(item => `- [${item.id}] ${item.text}${item.reason ? `（理由：${item.reason}）` : ''}`);
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}`);
}

/** 总纲条目排序：全书方向永远在最前，其后按卷推进状态（active → planned → done）排列。 */
const STORY_ARC_STATUS_WEIGHTS_ACU: Record<string, number> = { active: 0, planned: 1, done: 2 };

function compareStoryArc_ACU(left: AgentStoryArcEntry_ACU, right: AgentStoryArcEntry_ACU): number {
  if (left.scope !== right.scope) return left.scope === 'story' ? -1 : 1;
  return (STORY_ARC_STATUS_WEIGHTS_ACU[left.status] ?? 3) - (STORY_ARC_STATUS_WEIGHTS_ACU[right.status] ?? 3);
}

function renderStoryArcEntry_ACU(entry: AgentStoryArcEntry_ACU): string {
  const head = entry.scope === 'story' ? '全书方向' : '卷台阶';
  return [
    `- [${entry.id}] ${head}「${entry.title}」状态=${entry.status}${entry.stageNumbers.length ? ` 已承载阶段=${entry.stageNumbers.join('、')}` : ' 尚未由任何阶段承载'}${entry.retired ? ' 已废止' : ''}`,
    entry.narrativeRole ? `  结构职责：${entry.narrativeRole}` : '',
    entry.targetStageRange ? `  阶段容量：${entry.targetStageRange.min}–${entry.targetStageRange.max} 个阶段` : '',
    entry.targetTimeSpan ? `  故事时间目标：${entry.targetTimeSpan}` : '',
    entry.direction ? `  方向：${entry.direction}` : '',
    entry.escalation ? `  升级目标：${entry.escalation}` : '',
    entry.progressCeiling ? `  主线进度上限：${entry.progressCeiling}` : '',
    entry.sustainingThreads?.length ? `  持续经营线：${entry.sustainingThreads.join('；')}` : '',
    entry.payoffTargets?.length ? `  兑现目标：${entry.payoffTargets.join('；')}` : '',
    entry.withheld ? `  禁止提前翻的底牌：${entry.withheld}` : '',
    entry.completionStageNumber === null ? '' : `  完成依据：第 ${entry.completionStageNumber} 阶段；卷末状态=${entry.completionState || '（未登记）'}`,
    entry.completionRationale ? `  容量偏离说明：${entry.completionRationale}` : '',
    entry.continuationRationale ? `  续卷依据：${entry.continuationRationale}` : '',
    entry.retired && entry.retiredReason ? `  废止原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 判断总纲是否已经立起来。全部条目退役等价于没有总纲——门禁按活跃条目判定，
 * 否则用户清空总纲后大纲派工会以为总纲还在。
 * @param snapshot 当前快照
 * @returns 存在任一活跃总纲条目时为 true
 */
export function hasActiveStoryArc_ACU(snapshot: AgentModuleSnapshot_ACU): boolean {
  return snapshot.storyArc.some(entry => !entry.retired);
}

/** 判断是否存在可承载下一份阶段大纲的活动卷。全书方向本身不是阶段规划目标。 */
export function hasActiveStoryArcVolume_ACU(snapshot: AgentModuleSnapshot_ACU): boolean {
  return snapshot.storyArc.some(entry => (
    entry.scope === 'volume'
    && !entry.retired
    && entry.status === 'active'
  ));
}

/**
 * 找出已完成但没有登记进任何活跃 volume 条目 stageNumbers 的阶段编号。
 * 这些阶段是总纲进度的空洞：卷台阶不知道自己已经被走过，后续判断「本卷该收了没」就没有依据。
 * @param snapshot 当前快照
 * @param completedStageNumbers 已完成的阶段编号
 * @returns 未登记的阶段编号，升序去重
 */
export function findUnregisteredStageNumbers_ACU(snapshot: AgentModuleSnapshot_ACU, completedStageNumbers: readonly number[]): number[] {
  const registered = new Set<number>();
  for (const entry of snapshot.storyArc) {
    if (entry.retired) continue;
    for (const stageNumber of entry.stageNumbers) registered.add(stageNumber);
  }
  return [...new Set(completedStageNumbers)].filter(stageNumber => !registered.has(stageNumber)).sort((left, right) => left - right);
}

/**
 * 渲染活动卷给阶段规划与审查使用的集中上下文。
 * 阶段承载与卷收束是两层事实：stageNumbers 是卷已承载的阶段，completedStageNumbers 才是正文已完成的阶段。
 */
export function renderAgentActiveVolumePlanningContext_ACU(snapshot: AgentModuleSnapshot_ACU, completedStageNumbers: readonly number[]): string {
  const volumes = snapshot.storyArc.filter(entry => entry.scope === 'volume' && !entry.retired);
  const active = volumes.filter(entry => entry.status === 'active');
  const completed = new Set(completedStageNumbers);
  if (!volumes.length) return '【活动卷规划上下文】\n当前没有卷台阶；必须由 arc-architect 建立总纲后才能创建阶段大纲。';
  if (!active.length) {
    return '【活动卷规划上下文】\n所有既有卷均已完成。用户继续写作时，arc-architect 必须先根据最后一卷的结果、代价、关系变化或未解决问题在末尾追加一个 active 卷，再由 outline-architect 创建下一阶段大纲。';
  }
  if (active.length > 1) return `【活动卷规划上下文】\n总纲状态无效：当前存在 ${active.length} 个 active 卷（${active.map(entry => entry.id).join('、')}），必须先由 arc-architect 修复。`;
  const volume = active[0];
  const completedCarriers = volume.stageNumbers.filter(stageNumber => completed.has(stageNumber));
  const pendingCarriers = volume.stageNumbers.filter(stageNumber => !completed.has(stageNumber));
  return [
    '【活动卷规划上下文】',
    `当前 active 卷：[${volume.id}]「${volume.title}」`,
    `卷级结构职责：${volume.narrativeRole ?? '旧快照未标注'}`,
    `目标阶段容量：${volume.targetStageRange ? `${volume.targetStageRange.min}–${volume.targetStageRange.max} 个阶段` : '旧快照未标注'}`,
    `目标故事时间：${volume.targetTimeSpan || '旧快照未标注'}`,
    `已承载阶段：${volume.stageNumbers.length ? volume.stageNumbers.join('、') : '（尚无）'}`,
    `真实完成进度：${completedCarriers.length ? `已完成阶段 ${completedCarriers.join('、')}` : '尚未有已完成阶段'}${pendingCarriers.length ? `；已登记但尚未完成阶段 ${pendingCarriers.join('、')}` : ''}`,
    `本阶段只承担本卷尚未完成的一段：${volume.direction}`,
    `卷级收束条件：${volume.escalation}`,
    `主线进度上限：${volume.progressCeiling || '旧快照未标注'}`,
    `持续经营线：${volume.sustainingThreads?.length ? volume.sustainingThreads.join('；') : '旧快照未标注'}`,
    `兑现目标：${volume.payoffTargets?.length ? volume.payoffTargets.join('；') : '旧快照未标注'}`,
    `禁止提前释放：${volume.withheld || '（无额外底牌）'}`,
  ].join('\n');
}

/**
 * 渲染故事总纲的热上下文。
 * @param snapshot 当前快照
 * @param completedStageNumbers 已真实完成的阶段编号
 * @returns 自然语言文本；总纲为空时明确指出必须先派工 arc-architect
 */
export function renderAgentStoryArc_ACU(snapshot: AgentModuleSnapshot_ACU, completedStageNumbers: readonly number[] = []): string {
  const head = `当前修订号=${snapshot.revisions.storyArc}`;
  const active = snapshot.storyArc.filter(entry => !entry.retired);
  if (!active.length) return `${head}\n当前还没有故事总纲。总纲缺失时无法判断本阶段该走到哪一步，必须先派工 arc-architect 立总纲。`;
  const sorted = [...active].sort(compareStoryArc_ACU);
  return truncateAgentBlock_ACU(`${head}\n${sorted.map(renderStoryArcEntry_ACU).join('\n')}\n\n${renderAgentActiveVolumePlanningContext_ACU(snapshot, completedStageNumbers)}`);
}

function renderHookFull_ACU(hook: AgentHookEntry_ACU): string {
  return [
    `- [${hook.id}] 重要度=${hook.importance} 状态=${hook.status} 埋设楼层=${hook.plantedIndex} 最近变动楼层=${hook.updatedIndex}${hook.retired ? ' 已退休' : ''}`,
    `  内容：${hook.summary}`,
    hook.plannedPayoff ? `  计划回收：${hook.plannedPayoff}` : '',
    hook.retired && hook.retiredReason ? `  退休原因：${hook.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

function renderInfoGapFull_ACU(entry: AgentInfoGapEntry_ACU): string {
  return [
    `- [${entry.id}] ${entry.topic}（揭示状态=${entry.revealStatus}${entry.revealIndex === null ? '' : `，揭示楼层=${entry.revealIndex}`}${entry.retired ? '，已退休' : ''}）`,
    `  客观事实：${entry.objectiveFact || '（未登记）'}`,
    `  读者已知：${entry.readerKnown || '（未登记）'}`,
    entry.characterKnowledge.length ? `  角色知晓：${entry.characterKnowledge.map(item => `${item.name}=${item.knows}`).join('；')}` : '',
    entry.retired && entry.retiredReason ? `  退休原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

function renderConstraintFull_ACU(item: AgentConstraintEntry_ACU): string {
  return `- [${item.id}] ${item.text}${item.reason ? `（理由：${item.reason}）` : ''}（登记楼层=${item.createdIndex}）`;
}

interface AgentModuleReadSpec_ACU<Entry extends { id: string }> {
  label: string;
  revision: number;
  entries: readonly Entry[];
  render: (entry: Entry) => string;
}

interface RetirableEntry_ACU {
  id: string;
  retired?: boolean;
}

function renderModuleEntries_ACU<Entry extends RetirableEntry_ACU>(spec: AgentModuleReadSpec_ACU<Entry>, ids?: readonly string[]): string {
  const head = `当前修订号=${spec.revision}`;
  if (!ids || !ids.length) {
    // 全量读默认只列活跃条目；退休条目可被搜索命中并按 ID 精读，避免全量视图被历史噪音撑大。
    const active = spec.entries.filter(entry => entry.retired !== true);
    const retiredCount = spec.entries.length - active.length;
    if (!active.length) return `${head}\n${spec.label}当前没有活跃条目。${retiredCount ? `另有 ${retiredCount} 条已退休条目，可用 search 命中后按 ID 精读。` : ''}`;
    const tail = retiredCount ? `\n另有 ${retiredCount} 条已退休条目未列出，可用 search 命中后按 ID 精读。` : '';
    return `${head}\n${spec.label}活跃条目 ${active.length} 条：\n${active.map(spec.render).join('\n')}${tail}`;
  }
  const wanted = ids.map(id => id.trim()).filter(Boolean);
  const found = spec.entries.filter(entry => wanted.includes(entry.id));
  const missing = wanted.filter(id => !spec.entries.some(entry => entry.id === id));
  const lines: string[] = [head];
  if (found.length) lines.push(...found.map(spec.render));
  if (missing.length) lines.push(`以下 ID 不存在于${spec.label}：${missing.join('、')}。可先读全量或 search 确认可用 ID。`);
  if (!found.length && !missing.length) lines.push('未指定有效 ID。');
  return lines.join('\n');
}

/**
 * 按 ID 精读伏笔账本（含退休条目）；不传 ID 则输出全部活跃条目，支撑 `$HOOKS_LEDGER` / `$HOOKS_LEDGER:ID1,ID2`。
 */
export function renderAgentHooksByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '伏笔账本', revision: snapshot.revisions.hooks, entries: snapshot.hooks, render: renderHookFull_ACU }, ids);
}

/**
 * 按 ID 精读信息差时间线（含退休条目）；不传 ID 则输出全部活跃条目，支撑 `$INFO_GAP` / `$INFO_GAP:ID1,ID2`。
 */
export function renderAgentInfoGapByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '信息差时间线', revision: snapshot.revisions.infoGap, entries: snapshot.infoGap, render: renderInfoGapFull_ACU }, ids);
}

/**
 * 按 ID 精读长期约束；不传 ID 则输出全量，支撑 `$CONSTRAINTS` / `$CONSTRAINTS:ID1,ID2`。
 */
export function renderAgentConstraintsByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '长期约束清单', revision: snapshot.revisions.constraints, entries: snapshot.constraints, render: renderConstraintFull_ACU }, ids);
}

/**
 * 按 ID 精读故事总纲（含已废止条目）；不传 ID 则输出全部活跃条目，支撑 `$STORY_ARC` / `$STORY_ARC:ID1,ID2`。
 */
export function renderAgentStoryArcByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[], completedStageNumbers: readonly number[] = []): string {
  const entries = renderModuleEntries_ACU({ label: '故事总纲', revision: snapshot.revisions.storyArc, entries: snapshot.storyArc, render: renderStoryArcEntry_ACU }, ids);
  return ids?.length ? entries : `${entries}\n\n${renderAgentActiveVolumePlanningContext_ACU(snapshot, completedStageNumbers)}`;
}

const CHRONOLOGY_PRECISION_LABELS_ACU: Record<string, string> = { exact: '精确', approximate: '近似', unknown: '未知' };

function renderChronologyEntry_ACU(entry: AgentChronologyEntry_ACU): string {
  return [
    `- [${entry.id}] 时间锚：${entry.anchor}（精度=${CHRONOLOGY_PRECISION_LABELS_ACU[entry.precision] ?? entry.precision}${entry.retired ? '，已作废' : ''}）`,
    `  累计经过：${entry.elapsed}`,
    `  时间转换：${entry.transition}`,
    `  证据楼层：${entry.evidenceIndexes.join('、')}（结算楼层=${entry.updatedIndex}）`,
    entry.retired && entry.retiredReason ? `  作废原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

/** 年代学记录按结算次序展示：updatedIndex 相同（同一次结算多条转换）时保持登记顺序。 */
function sortChronology_ACU(entries: readonly AgentChronologyEntry_ACU[]): AgentChronologyEntry_ACU[] {
  return [...entries].sort((left, right) => left.updatedIndex - right.updatedIndex);
}

/**
 * 渲染故事年代学账本的热上下文。
 * @param snapshot 当前快照
 * @returns 自然语言文本；空账本时明确说明时间事实只能由维护代理依据真实正文结算
 */
export function renderAgentChronology_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.chronology}`;
  const active = sortChronology_ACU(snapshot.chronology.filter(entry => !entry.retired));
  const retiredCount = snapshot.chronology.length - active.length;
  const retiredNote = retiredCount ? `\n另有 ${retiredCount} 条已作废记录未列出，可用 search 命中后按 ID 精读。` : '';
  if (!active.length) return `${head}\n当前没有已结算的故事时间记录。时间事实只能由结算维护代理依据真实正文登记；大纲里的时间字段是计划，不是事实。${retiredNote}`;
  const latest = active[active.length - 1];
  return truncateAgentBlock_ACU([
    head,
    `当前时间锚：${latest.anchor}（精度=${CHRONOLOGY_PRECISION_LABELS_ACU[latest.precision] ?? latest.precision}）；自故事起点累计经过：${latest.elapsed}。`,
    ...active.map(renderChronologyEntry_ACU),
  ].join('\n') + retiredNote);
}

/**
 * 按 ID 精读故事年代学账本（含已作废条目）；不传 ID 则输出全部活跃条目，支撑 `$CHRONOLOGY` / `$CHRONOLOGY:ID1,ID2`。
 */
export function renderAgentChronologyByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '故事年代学账本', revision: snapshot.revisions.chronology, entries: sortChronology_ACU(snapshot.chronology), render: renderChronologyEntry_ACU }, ids);
}
