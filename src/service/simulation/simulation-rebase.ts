import {
  createWorldSimError_ACU,
  isWorldEntity_ACU,
  isWorldEvent_ACU,
  isWorldStableId_ACU,
  isWorldStateSnapshot_ACU,
  isWorldStoryClock_ACU,
  isWorldThread_ACU,
  WorldSimulationValidationError_ACU,
  type WorldEvent_ACU,
  type WorldEntityTransactionItem_ACU,
  type WorldEventTransactionItem_ACU,
  type WorldSimulationModule_ACU,
  type WorldSimulationTransaction_ACU,
  type WorldVisibilityPolicy_ACU,
  type WorldStateSnapshot_ACU,
  type WorldStoryClock_ACU,
  type WorldThreadTransactionItem_ACU,
} from './model';
import { applyWorldSimulationTransaction_ACU, normalizeWorldSimulationTransactionVisibility_ACU } from './simulation-transaction';

export type WorldSimulationRebaseOp_ACU =
  | { op: 'keep'; module: WorldSimulationModule_ACU; id: string }
  | { op: 'modify'; module: WorldSimulationModule_ACU; id: string; patch: Record<string, unknown>; reason: string }
  | { op: 'drop'; module: WorldSimulationModule_ACU; id: string; reason: string }
  | { op: 'insert'; module: WorldSimulationModule_ACU; item: unknown; reason: string }
  | { op: 'retire'; module: WorldSimulationModule_ACU; id: string; reason: string };

export interface WorldSimulationRebaseInput_ACU {
  current: WorldStateSnapshot_ACU;
  sourceTransactions: readonly WorldSimulationTransaction_ACU[];
  sourceAnchorMessageIndex: number;
  targetAnchorMessageIndex: number;
  coverageStartMessageIndex: number;
  coverageEndMessageIndex: number;
  rebaseStoryClock: WorldStoryClock_ACU;
  maxTrackedEntities: number;
  visibilityPolicy?: WorldVisibilityPolicy_ACU;
  rawDecision: string | null | undefined;
  isCurrent?: () => boolean;
}

export interface WorldSimulationRebaseRoundInput_ACU extends Omit<WorldSimulationRebaseInput_ACU, 'rawDecision'> {
  decide: () => Promise<string | null>;
}

export interface WorldSimulationRebaseSettlementInput_ACU<T> extends WorldSimulationRebaseRoundInput_ACU {
  settle: (result: WorldSimulationRebaseResult_ACU) => Promise<T>;
}

type SourceOp_ACU = { module: WorldSimulationModule_ACU; id: string; item: WorldEntityTransactionItem_ACU | WorldEventTransactionItem_ACU | WorldThreadTransactionItem_ACU };

function failRebase_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_REBASE_REJECTED', 'rebase', message, false, details));
}

function stale_ACU(message: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_STALE', 'rebase', message, false));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function existingIds_ACU(current: WorldStateSnapshot_ACU, module: WorldSimulationModule_ACU): Set<string> {
  return new Set(current[module].map(item => item.id));
}

function sourceOps_ACU(transactions: readonly WorldSimulationTransaction_ACU[], sourceAnchorMessageIndex: number): Map<string, SourceOp_ACU> {
  const result = new Map<string, SourceOp_ACU>();
  for (const transaction of transactions) {
    if (!Number.isInteger(transaction?.anchorMessageIndex) || transaction.anchorMessageIndex !== sourceAnchorMessageIndex) {
      failRebase_ACU('未落盘候选事务必须全部属于旧锚点', { sourceAnchorMessageIndex, transactionAnchor: transaction?.anchorMessageIndex });
    }
    for (const module of ['entities', 'events', 'threads'] as const) {
      for (const item of transaction[module]) {
        const id = item.action === 'upsert' ? item.value.id : item.id;
        const key = `${module}:${id}`;
        if (result.has(key)) failRebase_ACU(`未落盘候选重复操作同一条目：${key}`);
        result.set(key, { module, id, item });
      }
    }
  }
  return result;
}

type WorldSimulationRebaseDecision_ACU =
  | { verdict: 'compatible'; targetAnchorMessageIndex: number; coverageStartMessageIndex: number; coverageEndMessageIndex: number; rebaseStoryClock: WorldStoryClock_ACU }
  | { verdict: 'adjust'; targetAnchorMessageIndex: number; coverageStartMessageIndex: number; coverageEndMessageIndex: number; rebaseStoryClock: WorldStoryClock_ACU; ops: WorldSimulationRebaseOp_ACU[] };

function sameStoryClock_ACU(left: WorldStoryClock_ACU, right: WorldStoryClock_ACU): boolean {
  return left.anchorText === right.anchorText && left.elapsedSinceLastRun === right.elapsedSinceLastRun
    && left.precision === right.precision && left.updatedIndex === right.updatedIndex
    && left.evidenceIndexes.length === right.evidenceIndexes.length
    && left.evidenceIndexes.every((value, index) => value === right.evidenceIndexes[index]);
}

function parseOps_ACU(rawOps: unknown): WorldSimulationRebaseOp_ACU[] {
  if (!Array.isArray(rawOps)) failRebase_ACU('adjust 重锚定输出必须包含 ops');
  return rawOps.map((rawOp, index) => {
    if (!isRecord_ACU(rawOp) || typeof rawOp.op !== 'string' || !['entities', 'events', 'threads'].includes(String(rawOp.module))) failRebase_ACU(`ops[${index}] 操作或模块非法`);
    const module = rawOp.module as WorldSimulationModule_ACU;
    if (rawOp.op === 'insert') {
      if (Object.keys(rawOp).sort().join(',') !== 'item,module,op,reason' || typeof rawOp.reason !== 'string' || !rawOp.reason.trim()) failRebase_ACU(`ops[${index}] insert 非法`);
      return { op: 'insert', module, item: rawOp.item, reason: rawOp.reason.trim() };
    }
    if (!isWorldStableId_ACU(rawOp.id)) failRebase_ACU(`ops[${index}] 必须有规范 id`);
    if (rawOp.op === 'keep') {
      if (Object.keys(rawOp).sort().join(',') !== 'id,module,op') failRebase_ACU(`ops[${index}] keep 非法`);
      return { op: 'keep', module, id: rawOp.id };
    }
    if (typeof rawOp.reason !== 'string' || !rawOp.reason.trim()) failRebase_ACU(`ops[${index}] 必须有非空原因`);
    if (rawOp.op === 'modify') {
      if (Object.keys(rawOp).sort().join(',') !== 'id,module,op,patch,reason' || !isRecord_ACU(rawOp.patch) || !Object.keys(rawOp.patch).length) failRebase_ACU(`ops[${index}] modify patch 非法`);
      return { op: 'modify', module, id: rawOp.id, patch: rawOp.patch, reason: rawOp.reason.trim() };
    }
    if (!['drop', 'retire'].includes(rawOp.op) || Object.keys(rawOp).sort().join(',') !== 'id,module,op,reason') failRebase_ACU(`ops[${index}] 非法`);
    return { op: rawOp.op, module, id: rawOp.id, reason: rawOp.reason.trim() } as Extract<WorldSimulationRebaseOp_ACU, { op: 'drop' | 'retire' }>;
  });
}

function parseDecision_ACU(raw: string | null | undefined): WorldSimulationRebaseDecision_ACU {
  if (typeof raw !== 'string' || !raw.trim()) failRebase_ACU('重锚定回合未返回内容');
  let value: unknown;
  try { value = JSON.parse(raw.trim()); } catch (_) { failRebase_ACU('重锚定回合必须返回完整 JSON'); }
  if (!isRecord_ACU(value) || !['compatible', 'adjust'].includes(String(value.verdict))
    || typeof value.targetAnchorMessageIndex !== 'number' || !Number.isInteger(value.targetAnchorMessageIndex) || value.targetAnchorMessageIndex < 0
    || typeof value.coverageStartMessageIndex !== 'number' || !Number.isInteger(value.coverageStartMessageIndex) || value.coverageStartMessageIndex < 0
    || typeof value.coverageEndMessageIndex !== 'number' || !Number.isInteger(value.coverageEndMessageIndex) || value.coverageEndMessageIndex < 0
    || !isWorldStoryClock_ACU(value.rebaseStoryClock)
    || Object.keys(value.rebaseStoryClock).sort().join(',') !== 'anchorText,elapsedSinceLastRun,evidenceIndexes,precision,updatedIndex') {
    failRebase_ACU('重锚定输出契约非法');
  }
  const common = {
    targetAnchorMessageIndex: value.targetAnchorMessageIndex as number,
    coverageStartMessageIndex: value.coverageStartMessageIndex as number,
    coverageEndMessageIndex: value.coverageEndMessageIndex as number,
    rebaseStoryClock: value.rebaseStoryClock as WorldStoryClock_ACU,
  };
  if (value.verdict === 'compatible') {
    if (Object.keys(value).sort().join(',') !== 'coverageEndMessageIndex,coverageStartMessageIndex,rebaseStoryClock,targetAnchorMessageIndex,verdict') failRebase_ACU('compatible 重锚定输出契约非法');
    return { verdict: 'compatible', ...common };
  }
  if (Object.keys(value).sort().join(',') !== 'coverageEndMessageIndex,coverageStartMessageIndex,ops,rebaseStoryClock,targetAnchorMessageIndex,verdict') failRebase_ACU('adjust 重锚定输出契约非法');
  return { verdict: 'adjust', ...common, ops: parseOps_ACU(value.ops) };
}

function current_ACU(input: { isCurrent?: () => boolean }): void {
  if (input.isCurrent && !input.isCurrent()) stale_ACU('重锚定租约已失效');
}

function itemId_ACU(item: SourceOp_ACU['item']): string {
  return item.action === 'upsert' ? item.value.id : item.id;
}

function validInsert_ACU(module: WorldSimulationModule_ACU, value: unknown): SourceOp_ACU['item'] {
  if (module === 'entities' && isWorldEntity_ACU(value) && !value.retired) return { action: 'upsert', value };
  if (module === 'events' && isWorldEvent_ACU(value) && !value.retired) return { action: 'upsert', value };
  if (module === 'threads' && isWorldThread_ACU(value) && !value.retired) return { action: 'upsert', value };
  return failRebase_ACU(`insert 的 ${module} 条目必须是完整且未退役的领域对象`);
}

function modifySource_ACU(source: SourceOp_ACU, patch: Record<string, unknown>): SourceOp_ACU['item'] {
  if (source.item.action !== 'upsert') return failRebase_ACU(`modify 只能作用于未落盘 upsert 条目：${source.module}:${source.id}`);
  if (['id', 'retired', 'retiredReason', 'updatedIndex'].some(key => key in patch)) {
    return failRebase_ACU(`modify 不得修改身份、退役或更新锚点字段：${source.module}:${source.id}`);
  }
  const value = { ...source.item.value, ...patch };
  if (value.id !== source.id) return failRebase_ACU(`modify 不得改变 stable id：${source.module}:${source.id}`);
  if (source.module === 'entities' && isWorldEntity_ACU(value) && !value.retired) return { action: 'upsert', value };
  if (source.module === 'events' && isWorldEvent_ACU(value) && !value.retired) return { action: 'upsert', value };
  if (source.module === 'threads' && isWorldThread_ACU(value) && !value.retired) return { action: 'upsert', value };
  return failRebase_ACU(`modify 后的 ${source.module} 条目非法：${source.id}`);
}

type RebaseItems_ACU = { entities: WorldEntityTransactionItem_ACU[]; events: WorldEventTransactionItem_ACU[]; threads: WorldThreadTransactionItem_ACU[] };

function durationTier_ACU(value: string): number | null {
  if (/(?:瞬时|立刻|当下|即时|instant)/i.test(value)) return 0;
  if (/(?:\d+|[一二三四五六七八九十两半]|几|数|若干)\s*(?:个)?(?:小时|钟头|hours?\b)/i.test(value)) return 1;
  if (/(?:\d+|[一二三四五六七八九十两半]|几|数|若干)\s*(?:个)?(?:天|日|昼夜|days?\b)/i.test(value)) return 2;
  if (/(?:\d+|[一二三四五六七八九十两半]|几|数|若干)\s*(?:个)?(?:周|星期|礼拜|月|年|季|weeks?\b|months?\b|years?\b)/i.test(value)) return 3;
  return null;
}

function assertEventFeasible_ACU(event: WorldEvent_ACU, clock: WorldStoryClock_ACU, anchor: number): void {
  const eventTier = event.durationHint ? durationTier_ACU(event.durationHint) : null;
  if (event.occurredIndex > anchor || eventTier === null) failRebase_ACU(`重锚定事件 ${event.id} 的 durationHint 或锚点非法`);
  if (clock.precision === 'unknown' && eventTier !== 0) failRebase_ACU(`unknown 时间精度下不得重锚定时间跨度事件：${event.id}`);
  if (clock.precision === 'approximate') {
    const clockTier = durationTier_ACU(clock.elapsedSinceLastRun);
    if (clockTier === null || eventTier > clockTier) failRebase_ACU(`重锚定事件 ${event.id} 超过当前故事跨度`);
  }
}

function isEventUpsert_ACU(item: SourceOp_ACU['item']): item is Extract<WorldEventTransactionItem_ACU, { action: 'upsert' }> {
  return item.action === 'upsert' && isWorldEvent_ACU(item.value);
}

function addResult_ACU(results: RebaseItems_ACU, seen: Set<string>, module: WorldSimulationModule_ACU, item: SourceOp_ACU['item']): void {
  const key = `${module}:${itemId_ACU(item)}`;
  if (seen.has(key)) failRebase_ACU(`重锚定结果重复操作同一条目：${key}`);
  seen.add(key);
  if (module === 'entities') results.entities.push(item as WorldEntityTransactionItem_ACU);
  else if (module === 'events') results.events.push(item as WorldEventTransactionItem_ACU);
  else results.threads.push(item as WorldThreadTransactionItem_ACU);
}

export interface WorldSimulationRebaseResult_ACU {
  verdict: 'compatible' | 'adjust';
  transaction: WorldSimulationTransaction_ACU;
  state: WorldStateSnapshot_ACU;
  targetAnchorMessageIndex: number;
  coverageStartMessageIndex: number;
  coverageEndMessageIndex: number;
}

function assertRebaseInput_ACU(input: WorldSimulationRebaseInput_ACU): void {
  if (!isWorldStateSnapshot_ACU(input.current) || !Array.isArray(input.sourceTransactions) || !isWorldStoryClock_ACU(input.rebaseStoryClock)
    || !Number.isInteger(input.sourceAnchorMessageIndex) || input.sourceAnchorMessageIndex < 0
    || !Number.isInteger(input.targetAnchorMessageIndex) || input.targetAnchorMessageIndex <= input.sourceAnchorMessageIndex
    || !Number.isInteger(input.coverageStartMessageIndex) || input.coverageStartMessageIndex !== input.sourceAnchorMessageIndex
    || !Number.isInteger(input.coverageEndMessageIndex) || input.coverageEndMessageIndex !== input.targetAnchorMessageIndex
    || input.rebaseStoryClock.updatedIndex !== input.targetAnchorMessageIndex || input.targetAnchorMessageIndex < input.current.anchorMessageIndex
    || (input.visibilityPolicy !== undefined && !['agent', 'always_hidden', 'always_revealed'].includes(input.visibilityPolicy))
    || !Number.isInteger(input.maxTrackedEntities) || input.maxTrackedEntities < 1) {
    failRebase_ACU('重锚定输入、coverage 或新故事时钟非法');
  }
}

function assertDecisionMatchesInput_ACU(input: WorldSimulationRebaseInput_ACU, decision: WorldSimulationRebaseDecision_ACU): void {
  if (decision.targetAnchorMessageIndex !== input.targetAnchorMessageIndex
    || decision.coverageStartMessageIndex !== input.coverageStartMessageIndex
    || decision.coverageEndMessageIndex !== input.coverageEndMessageIndex
    || !sameStoryClock_ACU(decision.rebaseStoryClock, input.rebaseStoryClock)) {
    failRebase_ACU('light 重锚定 verdict 未精确匹配 target、coverage 或故事时钟');
  }
}

function appendCandidateItem_ACU(
  input: WorldSimulationRebaseInput_ACU,
  results: RebaseItems_ACU,
  resultSeen: Set<string>,
  source: SourceOp_ACU,
): number {
  if (source.module === 'events' && isEventUpsert_ACU(source.item)) {
    assertEventFeasible_ACU(source.item.value, input.rebaseStoryClock, input.targetAnchorMessageIndex);
  }
  addResult_ACU(results, resultSeen, source.module, source.item);
  return source.item.action === 'upsert' ? 1 : 0;
}

function buildRebasedResult_ACU(
  input: WorldSimulationRebaseInput_ACU,
  decision: WorldSimulationRebaseDecision_ACU,
): WorldSimulationRebaseResult_ACU {
  const source = sourceOps_ACU(input.sourceTransactions, input.sourceAnchorMessageIndex);
  if (!source.size) failRebase_ACU('没有可重锚定的未落盘候选操作');
  const results: RebaseItems_ACU = { entities: [], events: [], threads: [] };
  const resultSeen = new Set<string>();
  let liveCount = 0;

  if (decision.verdict === 'compatible') {
    for (const sourceOp of source.values()) {
      current_ACU(input);
      liveCount += appendCandidateItem_ACU(input, results, resultSeen, sourceOp);
    }
  } else {
    const candidateDecisions = new Set<string>();
    for (const op of decision.ops) {
      current_ACU(input);
      if (op.op === 'keep' || op.op === 'modify' || op.op === 'drop') {
        const key = `${op.module}:${op.id}`;
        const sourceOp = source.get(key);
        if (!sourceOp || candidateDecisions.has(key)) failRebase_ACU(`候选条目必须恰有一次 keep/modify/drop 裁决：${key}`);
        candidateDecisions.add(key);
        if (op.op === 'drop') continue;
        const item = op.op === 'keep' ? sourceOp.item : modifySource_ACU(sourceOp, op.patch);
        liveCount += appendCandidateItem_ACU(input, results, resultSeen, { module: op.module, id: sourceOp.id, item });
        continue;
      }
      if (op.op === 'insert') {
        const item = validInsert_ACU(op.module, op.item);
        const id = itemId_ACU(item);
        if (existingIds_ACU(input.current, op.module).has(id) || source.has(`${op.module}:${id}`)) failRebase_ACU(`insert 不得覆盖已落盘或候选条目：${op.module}:${id}`);
        if (op.module === 'events' && isEventUpsert_ACU(item)) assertEventFeasible_ACU(item.value, input.rebaseStoryClock, input.targetAnchorMessageIndex);
        addResult_ACU(results, resultSeen, op.module, item);
        liveCount += 1;
        continue;
      }
      if (!existingIds_ACU(input.current, op.module).has(op.id)) failRebase_ACU(`retire 必须命中已落盘条目：${op.module}:${op.id}`);
      addResult_ACU(results, resultSeen, op.module, { action: 'retire', id: op.id, reason: op.reason });
    }
    for (const key of source.keys()) if (!candidateDecisions.has(key)) failRebase_ACU(`未落盘候选条目未被重锚定裁决：${key}`);
  }

  if (!liveCount) failRebase_ACU('重锚定后没有 keep/modify/insert 存活条目');
  const expectedRevisions: WorldSimulationTransaction_ACU['expectedRevisions'] = {};
  if (results.entities.length) expectedRevisions.entities = input.current.revisions.entities;
  if (results.events.length) expectedRevisions.events = input.current.revisions.events;
  if (results.threads.length) expectedRevisions.threads = input.current.revisions.threads;
  const rawTransaction: WorldSimulationTransaction_ACU = { anchorMessageIndex: input.targetAnchorMessageIndex, storyClock: input.rebaseStoryClock, expectedRevisions, ...results };
  const transaction = normalizeWorldSimulationTransactionVisibility_ACU(rawTransaction, input.visibilityPolicy ?? 'agent');
  let state: WorldStateSnapshot_ACU;
  try { state = applyWorldSimulationTransaction_ACU(input.current, transaction, input.maxTrackedEntities); }
  catch (error) {
    if (error instanceof WorldSimulationValidationError_ACU) failRebase_ACU('重锚定结果未通过事务校验', { reason: error.error.message });
    throw error;
  }
  current_ACU(input);
  return {
    verdict: decision.verdict,
    transaction,
    state,
    targetAnchorMessageIndex: input.targetAnchorMessageIndex,
    coverageStartMessageIndex: input.coverageStartMessageIndex,
    coverageEndMessageIndex: input.coverageEndMessageIndex,
  };
}

/** Rebuilds one pending candidate at a newer target using a strict compatible/adjust verdict. */
export function rebaseWorldSimulationCandidate_ACU(input: WorldSimulationRebaseInput_ACU): WorldSimulationRebaseResult_ACU {
  current_ACU(input);
  assertRebaseInput_ACU(input);
  const decision = parseDecision_ACU(input.rawDecision);
  assertDecisionMatchesInput_ACU(input, decision);
  return buildRebasedResult_ACU(input, decision);
}



/** Runs exactly one injected light rebase decision; it never retries or falls back to the old anchor. */
export async function runWorldSimulationRebaseRound_ACU(input: WorldSimulationRebaseRoundInput_ACU): Promise<WorldSimulationRebaseResult_ACU> {
  current_ACU(input);
  let raw: string | null;
  try { raw = await input.decide(); }
  catch (error) { failRebase_ACU('重锚定 light 回合调用失败', { message: error instanceof Error ? error.message : String(error) }); }
  current_ACU(input);
  try { return rebaseWorldSimulationCandidate_ACU({ ...input, rawDecision: raw }); }
  catch (error) {
    if (error instanceof WorldSimulationValidationError_ACU && (error.error.code === 'WORLD_SIM_STALE' || error.error.code === 'WORLD_SIM_REBASE_REJECTED')) throw error;
    failRebase_ACU('重锚定 light 回合处理失败', { message: error instanceof Error ? error.message : String(error) });
  }
}

/** Hands one validated rebase result to the caller-owned settlement adapter. */
export async function settleWorldSimulationRebase_ACU<T>(input: WorldSimulationRebaseSettlementInput_ACU<T>): Promise<T> {
  const result = await runWorldSimulationRebaseRound_ACU(input);
  current_ACU(input);
  return input.settle(result);
}
