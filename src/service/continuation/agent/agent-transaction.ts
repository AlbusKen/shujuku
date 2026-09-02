/**
 * service/continuation/agent/agent-transaction.ts — 资料模块写集事务
 *
 * 所有写入都是全量校验后一次性生效的事务：任一条目不合规就拒绝整份 delta，
 * 绝不做部分落盘。核心防线是「漏写不等于删除」——删除必须显式 retire 并给出理由。
 */

import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  isAgentWritableModule_ACU,
  type AgentChronologyDeltaItem_ACU,
  type AgentChronologyEntry_ACU,
  type AgentConstraintEntry_ACU,
  type AgentHookDeltaItem_ACU,
  type AgentHookEntry_ACU,
  type AgentHookPatch_ACU,
  type AgentInfoGapDeltaItem_ACU,
  type AgentInfoGapEntry_ACU,
  type AgentInfoGapPatch_ACU,
  type AgentModuleDelta_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentResearcherOutput_ACU,
  type AgentStoryArcDeltaItem_ACU,
  type AgentStoryArcEntry_ACU,
  type AgentStoryArcPatch_ACU,
  type AgentWebRefEntry_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';
import { normalizeEvidenceIndexes_ACU, normalizeStageNumbers_ACU } from './agent-module-store';

function reject_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_WRITE_REJECTED', 'agent_delegate', message, false, details));
}

function collectTouchedModules_ACU(delta: AgentModuleDelta_ACU): AgentWritableModule_ACU[] {
  const touched: AgentWritableModule_ACU[] = [];
  if (delta.hooks.length || delta.hookPatches.length) touched.push('hooks');
  if (delta.infoGap.length || delta.infoGapPatches.length) touched.push('infoGap');
  if (delta.storyArc.length || delta.storyArcPatches.length) touched.push('storyArc');
  if (delta.chronology.length) touched.push('chronology');
  return touched;
}

function assertWritePermission_ACU(delta: AgentModuleDelta_ACU, allowedWrites: readonly string[]): void {
  for (const module of collectTouchedModules_ACU(delta)) {
    if (!allowedWrites.includes(module)) {
      reject_ACU(`子代理试图写入未授权模块：${module}`, { module, allowedWrites: [...allowedWrites] });
    }
  }
  for (const key of Object.keys(delta.expectedRevisions)) {
    if (!isAgentWritableModule_ACU(key)) reject_ACU(`expectedRevisions 含非法模块名：${key}`, { key });
  }
}

function assertExpectedRevisions_ACU(delta: AgentModuleDelta_ACU, snapshot: AgentModuleSnapshot_ACU): void {
  for (const module of collectTouchedModules_ACU(delta)) {
    const expected = delta.expectedRevisions[module];
    // 未声明不拒绝：并发基准由运行时按渲染时刻捕获后补齐，不依赖子代理自报。
    if (expected === undefined) continue;
    if (expected !== snapshot.revisions[module]) {
      reject_ACU(`${module} 的 revision 已变化，写入被拒绝`, { module, expected, actual: snapshot.revisions[module] });
    }
  }
}

/**
 * 用「子代理读到资料的那一刻」的修订号补齐未声明的模块。
 * @param delta 子代理返回的写集
 * @param readRevisions 渲染读集材料时捕获的快照修订号
 * @returns 新的 delta；子代理已显式声明的模块保持原值，仍按显式断言校验
 */
export function mergeAgentDeltaRevisions_ACU(delta: AgentModuleDelta_ACU, readRevisions: AgentModuleRevisions_ACU): AgentModuleDelta_ACU {
  const merged: AgentModuleDelta_ACU['expectedRevisions'] = { ...delta.expectedRevisions };
  for (const module of collectTouchedModules_ACU(delta)) {
    if (merged[module] === undefined) merged[module] = readRevisions[module];
  }
  return { ...delta, expectedRevisions: merged };
}

function applyHookDelta_ACU(existing: AgentHookEntry_ACU[], items: AgentHookDeltaItem_ACU[], settledIndex: number): AgentHookEntry_ACU[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const item of items) {
    if (!item.id.trim()) reject_ACU('伏笔条目缺少 id');
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的伏笔不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 伏笔 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim(), updatedIndex: settledIndex });
      continue;
    }
    if (!item.summary.trim()) reject_ACU(`伏笔 ${item.id} 的 summary 不能为空`, { id: item.id });
    const previous = byId.get(item.id);
    byId.set(item.id, {
      id: item.id,
      summary: item.summary.trim(),
      status: item.status,
      importance: item.importance,
      plantedIndex: previous ? previous.plantedIndex : item.plantedIndex,
      updatedIndex: settledIndex,
      plannedPayoff: item.plannedPayoff,
      retired: false,
      retiredReason: '',
    });
  }
  return [...byId.values()];
}

function applyHookPatches_ACU(entries: AgentHookEntry_ACU[], patches: AgentHookPatch_ACU[], settledIndex: number): AgentHookEntry_ACU[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const patch of patches) {
    const current = byId.get(patch.id);
    if (!current) reject_ACU(`patch 的伏笔不存在：${patch.id}`, { id: patch.id });
    if (current.retired) reject_ACU(`伏笔 ${patch.id} 已退役，不可 patch；需要恢复请用 upsert 重新登记`, { id: patch.id });
    byId.set(patch.id, {
      ...current,
      summary: patch.summary ?? current.summary,
      status: patch.status ?? current.status,
      importance: patch.importance ?? current.importance,
      plannedPayoff: patch.plannedPayoff ?? current.plannedPayoff,
      updatedIndex: settledIndex,
    });
  }
  return [...byId.values()];
}

function applyInfoGapDelta_ACU(existing: AgentInfoGapEntry_ACU[], items: AgentInfoGapDeltaItem_ACU[], settledIndex: number): AgentInfoGapEntry_ACU[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const item of items) {
    if (!item.id.trim()) reject_ACU('信息差条目缺少 id');
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的信息差条目不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 信息差条目 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim() });
      continue;
    }
    if (!item.topic.trim()) reject_ACU(`信息差条目 ${item.id} 的 topic 不能为空`, { id: item.id });
    // 未揭示的事件不允许携带揭示楼层，否则等于把计划写成了已发生事实。
    if (item.revealStatus === 'unrevealed' && item.revealIndex !== null) {
      reject_ACU(`信息差条目 ${item.id} 标记为未揭示，揭示楼层必须为空`, { id: item.id, revealIndex: item.revealIndex });
    }
    if (item.revealStatus !== 'unrevealed' && item.revealIndex === null) {
      reject_ACU(`信息差条目 ${item.id} 已揭示，必须给出揭示楼层`, { id: item.id });
    }
    byId.set(item.id, {
      id: item.id,
      topic: item.topic.trim(),
      objectiveFact: item.objectiveFact,
      readerKnown: item.readerKnown,
      characterKnowledge: item.characterKnowledge,
      revealStatus: item.revealStatus,
      revealIndex: item.revealIndex,
      retired: false,
      retiredReason: '',
    });
  }
  void settledIndex;
  return [...byId.values()];
}

function applyInfoGapPatches_ACU(entries: AgentInfoGapEntry_ACU[], patches: AgentInfoGapPatch_ACU[]): AgentInfoGapEntry_ACU[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const patch of patches) {
    const current = byId.get(patch.id);
    if (!current) reject_ACU(`patch 的信息差条目不存在：${patch.id}`, { id: patch.id });
    if (current.retired) reject_ACU(`信息差条目 ${patch.id} 已退役，不可 patch`, { id: patch.id });
    const merged: AgentInfoGapEntry_ACU = {
      ...current,
      topic: patch.topic ?? current.topic,
      objectiveFact: patch.objectiveFact ?? current.objectiveFact,
      readerKnown: patch.readerKnown ?? current.readerKnown,
      characterKnowledge: patch.characterKnowledge ?? current.characterKnowledge,
      revealStatus: patch.revealStatus ?? current.revealStatus,
      revealIndex: 'revealIndex' in patch ? patch.revealIndex! : current.revealIndex,
    };
    // 合并结果必须满足与 upsert 相同的一致性规则：把计划写成事实的典型症状在 patch 路径同样要拦。
    if (merged.revealStatus === 'unrevealed' && merged.revealIndex !== null) {
      reject_ACU(`信息差条目 ${patch.id} patch 后标记为未揭示，揭示楼层必须同时清空（revealIndex 传 null）`, { id: patch.id, revealIndex: merged.revealIndex });
    }
    if (merged.revealStatus !== 'unrevealed' && merged.revealIndex === null) {
      reject_ACU(`信息差条目 ${patch.id} patch 后已揭示，必须给出揭示楼层`, { id: patch.id });
    }
    byId.set(patch.id, merged);
  }
  return [...byId.values()];
}

/**
 * 全书方向在任何时刻只能有一条活跃条目。允许在同一份 delta 里先 retire 旧的再 upsert 新的，
 * 因此判定放在全部条目应用完之后，而不是逐条拦截。
 */
function assertSingleActiveStoryScope_ACU(entries: readonly AgentStoryArcEntry_ACU[]): void {
  const active = entries.filter(entry => entry.scope === 'story' && !entry.retired);
  if (active.length > 1) {
    reject_ACU(
      `全书方向（scope=story）只能有一条活跃条目，当前会变成 ${active.length} 条：${active.map(entry => entry.id).join('、')}。修订全书方向请 patch 既有条目，或在同一份写集里先 retire 旧条目`,
      { ids: active.map(entry => entry.id) },
    );
  }
}

function hasVolumeContractField_ACU(entry: AgentStoryArcEntry_ACU): boolean {
  return entry.narrativeRole !== undefined
    || entry.targetStageRange !== undefined
    || entry.targetTimeSpan !== undefined
    || entry.progressCeiling !== undefined
    || entry.sustainingThreads !== undefined
    || entry.payoffTargets !== undefined
    || entry.completionRationale !== undefined;
}

function assertCompleteVolumeContract_ACU(volume: AgentStoryArcEntry_ACU, context: 'new' | 'done'): void {
  if (!volume.narrativeRole) reject_ACU(`卷台阶 ${volume.id} 缺少 narrativeRole`, { id: volume.id, context });
  if (!volume.targetStageRange) reject_ACU(`卷台阶 ${volume.id} 缺少 targetStageRange`, { id: volume.id, context });
  if (!Number.isInteger(volume.targetStageRange.min) || !Number.isInteger(volume.targetStageRange.max)
    || volume.targetStageRange.min < 1 || volume.targetStageRange.max < volume.targetStageRange.min) {
    reject_ACU(`卷台阶 ${volume.id} 的 targetStageRange 必须是 min≥1 且 max≥min 的整数范围`, { id: volume.id, context, targetStageRange: volume.targetStageRange });
  }
  if (!volume.targetTimeSpan?.trim()) reject_ACU(`卷台阶 ${volume.id} 缺少 targetTimeSpan`, { id: volume.id, context });
  if (!volume.progressCeiling?.trim()) reject_ACU(`卷台阶 ${volume.id} 缺少 progressCeiling`, { id: volume.id, context });
  if (!volume.sustainingThreads?.length) reject_ACU(`卷台阶 ${volume.id} 至少需要一条 sustainingThreads`, { id: volume.id, context });
  if (volume.sustainingThreads.some(thread => !thread.trim())) reject_ACU(`卷台阶 ${volume.id} 的 sustainingThreads 不得包含空项`, { id: volume.id, context });
  if (!volume.payoffTargets?.length) reject_ACU(`卷台阶 ${volume.id} 至少需要一条 payoffTargets`, { id: volume.id, context });
  if (volume.payoffTargets.some(target => !target.trim())) reject_ACU(`卷台阶 ${volume.id} 的 payoffTargets 不得包含空项`, { id: volume.id, context });
}

function assertVolumeCompletionContract_ACU(volume: AgentStoryArcEntry_ACU): void {
  if (!volume.targetStageRange) return;
  assertCompleteVolumeContract_ACU(volume, 'done');
  const stageCount = volume.stageNumbers.length;
  const withinTarget = stageCount >= volume.targetStageRange.min && stageCount <= volume.targetStageRange.max;
  if (!withinTarget && !volume.completionRationale?.trim()) {
    reject_ACU(`卷台阶 ${volume.id} 实际承载 ${stageCount} 个阶段，偏离目标 ${volume.targetStageRange.min}–${volume.targetStageRange.max} 时必须给出 completionRationale`, { id: volume.id, stageCount, targetStageRange: volume.targetStageRange });
  }
  for (const target of volume.payoffTargets ?? []) {
    if (!volume.completionState.includes(target)) {
      reject_ACU(`卷台阶 ${volume.id} 的 completionState 必须逐项说明 payoffTargets 的兑现证据：${target}`, { id: volume.id, target });
    }
  }
  for (const thread of volume.sustainingThreads ?? []) {
    if (!volume.completionState.includes(thread)) {
      reject_ACU(`卷台阶 ${volume.id} 的 completionState 必须逐项说明 sustainingThreads 的完成、转入后续卷或 retire 去向：${thread}`, { id: volume.id, thread });
    }
  }
}

function assertStoryArcContractShape_ACU(entries: readonly AgentStoryArcEntry_ACU[]): void {
  for (const entry of entries) {
    if (entry.retired || !hasVolumeContractField_ACU(entry)) continue;
    if (entry.scope !== 'volume') {
      reject_ACU(`全书方向 ${entry.id} 不得携带卷级容量字段`, { id: entry.id, scope: entry.scope });
    }
    assertCompleteVolumeContract_ACU(entry, 'new');
  }
}

/** 验证卷台阶的生命周期；阶段完成与卷完成是两层事实，不能互相替代。 */
function assertVolumeLifecycle_ACU(
  previous: readonly AgentStoryArcEntry_ACU[],
  next: readonly AgentStoryArcEntry_ACU[],
  completedStageNumbers: ReadonlySet<number>,
): void {
  const volumes = next.filter(entry => entry.scope === 'volume' && !entry.retired);
  if (!volumes.length) return;

  const previousById = new Map(previous.filter(entry => entry.scope === 'volume' && !entry.retired).map(entry => [entry.id, entry]));
  const previouslyActive = previous.filter(entry => entry.scope === 'volume' && !entry.retired && entry.status === 'active');
  for (const volume of volumes) {
    const prior = previousById.get(volume.id);
    if (!prior) continue;
    const newlyRegistered = volume.stageNumbers.filter(stageNumber => !prior.stageNumbers.includes(stageNumber));
    if (newlyRegistered.length && prior.status !== 'active') {
      reject_ACU(`阶段进度只能登记到当前 active 卷，卷 ${volume.id} 在改写前状态为 ${prior.status}`, { id: volume.id, priorStatus: prior.status, stageNumbers: newlyRegistered });
    }
    for (const stageNumber of newlyRegistered) {
      if (!completedStageNumbers.has(stageNumber)) {
        reject_ACU(`卷台阶 ${volume.id} 只能登记真实完成的阶段`, { id: volume.id, stageNumber });
      }
    }
    if (prior.status === 'done' && volume.status !== 'done') {
      reject_ACU(`已完成卷 ${volume.id} 不可重新激活`, { id: volume.id, from: prior.status, to: volume.status });
    }
    const order: Record<AgentStoryArcEntry_ACU['status'], number> = { planned: 0, active: 1, done: 2 };
    if (order[volume.status] < order[prior.status]) {
      reject_ACU(`卷台阶 ${volume.id} 状态只能 planned → active → done 单向推进`, { id: volume.id, from: prior.status, to: volume.status });
    }
    if (order[volume.status] > order[prior.status] + 1) {
      reject_ACU(`卷台阶 ${volume.id} 不可跳过 active 直接从 ${prior.status} 变为 ${volume.status}`, { id: volume.id, from: prior.status, to: volume.status });
    }
  }

  if (previouslyActive.length > 1) {
    reject_ACU(`写入前存在 ${previouslyActive.length} 个 active 卷，无法判定阶段承载归属`, { activeIds: previouslyActive.map(volume => volume.id) });
  }

  for (const volume of volumes) {
    if (previousById.has(volume.id)) continue;
    assertCompleteVolumeContract_ACU(volume, 'new');
    if (volume.status === 'done') {
      reject_ACU(`新卷 ${volume.id} 不可直接登记为 done`, { id: volume.id });
    }
    for (const stageNumber of volume.stageNumbers) {
      if (!completedStageNumbers.has(stageNumber)) {
        reject_ACU(`新卷 ${volume.id} 只能登记真实完成的阶段`, { id: volume.id, stageNumber });
      }
    }
  }

  for (const volume of volumes) {
    const prior = previous.find(entry => entry.id === volume.id);
    if (volume.status !== 'done') continue;
    if (volume.completionStageNumber === null) {
      reject_ACU(`卷台阶 ${volume.id} 标记 done 时必须提供 completionStageNumber`, { id: volume.id });
    }
    if (!volume.stageNumbers.includes(volume.completionStageNumber)) {
      reject_ACU(`卷台阶 ${volume.id} 的完成阶段必须已登记进 stageNumbers`, { id: volume.id, completionStageNumber: volume.completionStageNumber });
    }
    if (!completedStageNumbers.has(volume.completionStageNumber)) {
      reject_ACU(`卷台阶 ${volume.id} 的完成阶段尚未真实完成`, { id: volume.id, completionStageNumber: volume.completionStageNumber });
    }
    if (!volume.completionState.trim()) {
      reject_ACU(`卷台阶 ${volume.id} 标记 done 时必须说明已达到的卷末状态`, { id: volume.id });
    }
    assertVolumeCompletionContract_ACU(volume);
  }

  const unfinished = volumes.filter(volume => volume.status !== 'done');
  const active = volumes.filter(volume => volume.status === 'active');
  if (unfinished.length && active.length !== 1) {
    reject_ACU(`存在未完成卷时必须恰有一个 active 卷，当前为 ${active.length} 个`, { activeIds: active.map(volume => volume.id) });
  }

  const previousVolumes = previous.filter(entry => entry.scope === 'volume' && !entry.retired);
  if (previousVolumes.length && previousVolumes.every(volume => volume.status === 'done')) {
    for (const volume of active) {
      if (!volume.continuationRationale.trim()) {
        reject_ACU(`在既有卷全部完成后追加或激活卷 ${volume.id} 时必须说明续卷依据`, { id: volume.id });
      }
    }
  }
}

/**
 * 应用年代学写集。核心防线有三条：
 * 1. 时间事实必须有真实正文证据，且证据不得越过本次结算水位——未来楼层不是已发生事实。
 * 2. retire 必须命中既有条目并给理由；漏写不等于删除。
 * 3. 任一条目失败即整份 delta 拒绝，不做部分登记。
 */
function applyChronologyDelta_ACU(existing: AgentChronologyEntry_ACU[], items: AgentChronologyDeltaItem_ACU[], settledIndex: number): AgentChronologyEntry_ACU[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const item of items) {
    if (!item.id.trim()) reject_ACU('年代学条目缺少 id');
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的年代学条目不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 年代学条目 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim(), updatedIndex: settledIndex });
      continue;
    }
    if (!item.anchor.trim()) reject_ACU(`年代学条目 ${item.id} 的 anchor 不能为空`, { id: item.id });
    if (!item.elapsed.trim()) reject_ACU(`年代学条目 ${item.id} 的 elapsed 不能为空；无法可靠量化就明确写「未知」或「约……」`, { id: item.id });
    if (!item.transition.trim()) reject_ACU(`年代学条目 ${item.id} 的 transition 不能为空`, { id: item.id });
    const evidenceIndexes = normalizeEvidenceIndexes_ACU(item.evidenceIndexes);
    if (!evidenceIndexes || !evidenceIndexes.length) {
      reject_ACU(`年代学条目 ${item.id} 的 evidenceIndexes 必须是非空的非负整数楼层数组`, { id: item.id, evidenceIndexes: item.evidenceIndexes });
    }
    const future = evidenceIndexes.filter(index => index > settledIndex);
    if (future.length) {
      reject_ACU(`年代学条目 ${item.id} 引用了尚未结算的未来楼层：${future.join('、')}（本次结算水位=${settledIndex}）。时间事实只能引用已发生的真实正文`, { id: item.id, future, settledIndex });
    }
    byId.set(item.id, {
      id: item.id,
      anchor: item.anchor.trim(),
      elapsed: item.elapsed.trim(),
      precision: item.precision,
      transition: item.transition.trim(),
      evidenceIndexes,
      updatedIndex: settledIndex,
      retired: false,
      retiredReason: '',
    });
  }
  return [...byId.values()];
}

function applyStoryArcDelta_ACU(existing: AgentStoryArcEntry_ACU[], items: AgentStoryArcDeltaItem_ACU[]): AgentStoryArcEntry_ACU[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const item of items) {
    if (!item.id.trim()) reject_ACU('总纲条目缺少 id');
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的总纲条目不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 总纲条目 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim() });
      continue;
    }
    const previous = byId.get(item.id);
    // 对既有条目重复 upsert 时，省略或留空的字段沿用原值：主 Agent 常按惯性每轮派总纲“更新”，
    // 若把省略当成清空，几轮下来 escalation / withheld 会被抹掉、active 卷会被打回 planned。
    const title = item.title.trim() || previous?.title || '';
    const direction = item.direction.trim() || previous?.direction || '';
    const escalation = item.escalation.trim() || previous?.escalation || '';
    const withheld = item.withheld.trim() || previous?.withheld || '';
    const status = item.statusProvided || !previous ? item.status : previous.status;
    if (!title) reject_ACU(`总纲条目 ${item.id} 的 title 不能为空`, { id: item.id });
    // direction 是这个模块存在的意义：没有方向的条目只是一个标题，对大纲毫无约束力。
    if (!direction) reject_ACU(`总纲条目 ${item.id} 的 direction 不能为空，必须写清谁追求什么、对抗什么`, { id: item.id });
    if (item.scope === 'volume' && !escalation) {
      reject_ACU(`卷台阶 ${item.id} 必须写 escalation：本卷冲突抬到什么高度、收在哪`, { id: item.id });
    }
    byId.set(item.id, {
      id: item.id,
      scope: item.scope,
      title,
      direction,
      escalation,
      withheld,
      status,
      // 进度锚只增不减：upsert 不携带 stageNumbers 时保留既有记录，避免改一次方向就把承载历史抹平。
      stageNumbers: item.stageNumbers.length ? normalizeStageNumbers_ACU(item.stageNumbers) : (previous ? previous.stageNumbers : []),
      completionStageNumber: item.completionStageNumber ?? (previous?.completionStageNumber ?? null),
      completionState: item.completionState || previous?.completionState || '',
      continuationRationale: item.continuationRationale || previous?.continuationRationale || '',
      narrativeRole: item.narrativeRole ?? previous?.narrativeRole,
      targetStageRange: item.targetStageRange ?? previous?.targetStageRange,
      targetTimeSpan: item.targetTimeSpan ?? previous?.targetTimeSpan,
      progressCeiling: item.progressCeiling ?? previous?.progressCeiling,
      sustainingThreads: item.sustainingThreads ?? previous?.sustainingThreads,
      payoffTargets: item.payoffTargets ?? previous?.payoffTargets,
      completionRationale: item.completionRationale ?? previous?.completionRationale,
      retired: false,
      retiredReason: '',
    });
  }
  const next = [...byId.values()];
  assertSingleActiveStoryScope_ACU(next);
  assertStoryArcContractShape_ACU(next);
  return next;
}

function applyStoryArcPatches_ACU(entries: AgentStoryArcEntry_ACU[], patches: AgentStoryArcPatch_ACU[]): AgentStoryArcEntry_ACU[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const patch of patches) {
    const current = byId.get(patch.id);
    if (!current) reject_ACU(`patch 的总纲条目不存在：${patch.id}`, { id: patch.id });
    if (current.retired) reject_ACU(`总纲条目 ${patch.id} 已废止，不可 patch；需要恢复请用 upsert 重新登记`, { id: patch.id });
    const merged: AgentStoryArcEntry_ACU = {
      ...current,
      title: patch.title ?? current.title,
      direction: patch.direction ?? current.direction,
      escalation: patch.escalation ?? current.escalation,
      withheld: patch.withheld ?? current.withheld,
      status: patch.status ?? current.status,
      stageNumbers: patch.stageNumbers ? normalizeStageNumbers_ACU(patch.stageNumbers) : current.stageNumbers,
      completionStageNumber: Object.prototype.hasOwnProperty.call(patch, 'completionStageNumber') ? patch.completionStageNumber! : current.completionStageNumber,
      completionState: patch.completionState ?? current.completionState,
      continuationRationale: patch.continuationRationale ?? current.continuationRationale,
      narrativeRole: patch.narrativeRole ?? current.narrativeRole,
      targetStageRange: patch.targetStageRange ?? current.targetStageRange,
      targetTimeSpan: patch.targetTimeSpan ?? current.targetTimeSpan,
      progressCeiling: patch.progressCeiling ?? current.progressCeiling,
      sustainingThreads: patch.sustainingThreads ?? current.sustainingThreads,
      payoffTargets: patch.payoffTargets ?? current.payoffTargets,
      completionRationale: patch.completionRationale ?? current.completionRationale,
    };
    if (!merged.title.trim()) reject_ACU(`总纲条目 ${patch.id} patch 后 title 为空`, { id: patch.id });
    if (!merged.direction.trim()) reject_ACU(`总纲条目 ${patch.id} patch 后 direction 为空`, { id: patch.id });
    byId.set(patch.id, merged);
  }
  const next = [...byId.values()];
  assertStoryArcContractShape_ACU(next);
  return next;
}

/**
 * 把一份子代理写集事务应用到快照上。
 * @param snapshot 当前快照
 * @param delta 子代理返回的写集
 * @param allowedWrites 该子代理被授权的模块名列表
 * @param settledIndex 本次结算的水位楼层，用于记录条目变动楼层
 * @returns 应用后的新快照，被写入模块的 revision 各自 +1
 */
export function applyAgentModuleDelta_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  delta: AgentModuleDelta_ACU,
  allowedWrites: readonly string[],
  settledIndex: number,
  completedStageNumbers: readonly number[] = [],
): AgentModuleSnapshot_ACU {
  assertWritePermission_ACU(delta, allowedWrites);
  assertExpectedRevisions_ACU(delta, snapshot);
  const touched = collectTouchedModules_ACU(delta);
  if (!touched.length) return snapshot;
  const hooksTouched = delta.hooks.length > 0 || delta.hookPatches.length > 0;
  const infoGapTouched = delta.infoGap.length > 0 || delta.infoGapPatches.length > 0;
  const storyArcTouched = delta.storyArc.length > 0 || delta.storyArcPatches.length > 0;
  const chronologyTouched = delta.chronology.length > 0;
  let hooks = delta.hooks.length ? applyHookDelta_ACU(snapshot.hooks, delta.hooks, settledIndex) : snapshot.hooks;
  if (delta.hookPatches.length) hooks = applyHookPatches_ACU(hooks, delta.hookPatches, settledIndex);
  let infoGap = delta.infoGap.length ? applyInfoGapDelta_ACU(snapshot.infoGap, delta.infoGap, settledIndex) : snapshot.infoGap;
  if (delta.infoGapPatches.length) infoGap = applyInfoGapPatches_ACU(infoGap, delta.infoGapPatches);
  let storyArc = delta.storyArc.length ? applyStoryArcDelta_ACU(snapshot.storyArc, delta.storyArc) : snapshot.storyArc;
  if (delta.storyArcPatches.length) {
    storyArc = applyStoryArcPatches_ACU(storyArc, delta.storyArcPatches);
    assertSingleActiveStoryScope_ACU(storyArc);
  }
  if (storyArcTouched) assertVolumeLifecycle_ACU(snapshot.storyArc, storyArc, new Set(completedStageNumbers));
  const chronology = chronologyTouched ? applyChronologyDelta_ACU(snapshot.chronology, delta.chronology, settledIndex) : snapshot.chronology;
  return {
    ...snapshot,
    hooks,
    infoGap,
    storyArc,
    chronology,
    revisions: {
      hooks: snapshot.revisions.hooks + (hooksTouched ? 1 : 0),
      infoGap: snapshot.revisions.infoGap + (infoGapTouched ? 1 : 0),
      constraints: snapshot.revisions.constraints,
      storyArc: snapshot.revisions.storyArc + (storyArcTouched ? 1 : 0),
      chronology: snapshot.revisions.chronology + (chronologyTouched ? 1 : 0),
      webRefs: snapshot.revisions.webRefs,
    },
  };
}

/** 百科资料库条目 ID 前缀；模型漏写 id 时由运行时按此前缀顺延分配。 */
export const AGENT_WEB_REF_ID_PREFIX_ACU = 'WR-';

/**
 * 分配下一个可用的百科资料库 ID。按既有 WR-### 最大序号 +1，避免与退休条目撞号。
 * @param existing 当前全部条目（含退休）
 * @param taken 本次写集里已占用的 id
 */
export function nextAgentWebRefId_ACU(existing: readonly AgentWebRefEntry_ACU[], taken: ReadonlySet<string> = new Set()): string {
  let max = 0;
  for (const id of [...existing.map(entry => entry.id), ...taken]) {
    const matched = /^WR-(\d+)$/.exec(id);
    if (matched) max = Math.max(max, Number.parseInt(matched[1], 10));
  }
  return `${AGENT_WEB_REF_ID_PREFIX_ACU}${String(max + 1).padStart(3, '0')}`;
}

/**
 * 应用 web-researcher 的百科资料库写集。与叙事模块同一防线：retire 必须命中且给理由、
 * 任一条目失败整份拒绝、修订号并发校验；upsert 对既有条目按 id 覆盖但保留首次入库时间。
 * 写入不推进结算水位——百科条目不是正文事实。
 * @param snapshot 当前快照
 * @param output 子代理运行时已把 pageRef 回填成完整条目的输出
 * @param expectedRevision 子代理读到资料那一刻的 webRefs 修订号；与当前不一致即拒绝
 * @param now 入库时间
 * @returns 应用后的新快照；webRefs 修订号 +1（无实际变更时原样返回）
 */
export function applyAgentWebRefsDelta_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  output: AgentResearcherOutput_ACU,
  expectedRevision: number | undefined,
  now: number = Date.now(),
): AgentModuleSnapshot_ACU {
  if (!output.items.length) return snapshot;
  if (expectedRevision !== undefined && expectedRevision !== snapshot.revisions.webRefs) {
    reject_ACU('webRefs 的 revision 已变化，写入被拒绝', { module: 'webRefs', expected: expectedRevision, actual: snapshot.revisions.webRefs });
  }
  const byId = new Map(snapshot.webRefs.map(entry => [entry.id, entry]));
  const taken = new Set<string>();
  for (const item of output.items) {
    if (item.action === 'retire') {
      const current = byId.get(item.id);
      if (!current) reject_ACU(`retire 的百科条目不存在：${item.id}`, { id: item.id });
      if (!item.reason.trim()) reject_ACU(`retire 百科条目 ${item.id} 必须给出理由`, { id: item.id });
      byId.set(item.id, { ...current!, retired: true, retiredReason: item.reason.trim() });
      continue;
    }
    if (!item.title.trim()) reject_ACU(`百科条目 ${item.id || '(未命名)'} 的 title（名称）不能为空`, { id: item.id });
    if (!item.brief.trim()) reject_ACU(`百科条目「${item.title}」的 brief（一句话简介）不能为空`, { id: item.id });
    if (!item.url.trim()) reject_ACU(`百科条目 ${item.id || '(未命名)'} 缺少 url（pageRef 未能解析到已抓取页面）`, { id: item.id });
    const id = item.id.trim() || nextAgentWebRefId_ACU([...byId.values()], taken);
    taken.add(id);
    const previous = byId.get(id);
    byId.set(id, {
      id,
      title: item.title.trim(),
      source: item.source,
      url: item.url.trim(),
      query: item.query,
      tags: [...new Set(item.tags.map(tag => tag.trim()).filter(Boolean))],
      brief: item.brief.trim(),
      summary: item.summary.trim(),
      sourceStatus: item.sourceStatus,
      fetchedAt: previous?.fetchedAt || now,
      retired: false,
      retiredReason: '',
    });
  }
  return {
    ...snapshot,
    webRefs: [...byId.values()],
    revisions: { ...snapshot.revisions, webRefs: snapshot.revisions.webRefs + 1 },
  };
}

/** 渲染当前活跃约束清单，用于拒绝回显，让主 Agent 看到可引用的 id 与原文后自我修正。 */
function renderActiveConstraintList_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  if (!snapshot.constraints.length) return '（当前没有任何活跃约束）';
  return snapshot.constraints.map(item => `${item.id}：${item.text}`).join('；');
}

/**
 * 登记主 Agent 裁决后的长期约束。增量语义：add 只写新增文本，retire 只写要废除的
 * 条目（按 id 或原文精确匹配）。漏写既有条目不等于删除；重复登记已有文本幂等跳过。
 * @param snapshot 当前快照
 * @param add 新增的约束文本
 * @param retire 废除的约束（id 或原文）
 * @param settledIndex 登记时的水位楼层
 * @returns 应用后的新快照；有实际变更时 constraints 的 revision +1，否则原样返回
 */
export function applyAgentConstraintRegistration_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  add: readonly string[],
  retire: readonly string[],
  settledIndex: number,
): AgentModuleSnapshot_ACU {
  const retireKeys = [...new Set(retire.map(text => text.trim()).filter(Boolean))];
  const retiredIds = new Set<string>();
  for (const key of retireKeys) {
    const matched = snapshot.constraints.find(item => item.id === key || item.text === key);
    if (!matched) {
      reject_ACU(
        `retire 的约束不存在：「${key}」。retire 必须精确引用活跃条目的 id 或原文。当前活跃约束：${renderActiveConstraintList_ACU(snapshot)}`,
        { retireKey: key, active: snapshot.constraints.map(item => ({ id: item.id, text: item.text })) },
      );
    }
    retiredIds.add(matched.id);
  }
  const remaining = snapshot.constraints.filter(item => !retiredIds.has(item.id));
  const existingTexts = new Set(remaining.map(item => item.text));
  const addTexts: string[] = [];
  for (const raw of add) {
    const text = raw.trim();
    // 重复登记既有文本（含旧全量形态重抄整份清单）幂等跳过，不再构成拒绝理由。
    if (!text || existingTexts.has(text)) continue;
    existingTexts.add(text);
    addTexts.push(text);
  }
  if (!retiredIds.size && !addTexts.length) return snapshot;
  const nextRevision = snapshot.revisions.constraints + 1;
  const added: AgentConstraintEntry_ACU[] = addTexts.map((text, order) => ({
    id: `C${String(nextRevision).padStart(2, '0')}-${order + 1}`,
    text,
    reason: '主 Agent 本轮裁决登记',
    createdIndex: settledIndex,
  }));
  return { ...snapshot, constraints: [...remaining, ...added], revisions: { ...snapshot.revisions, constraints: nextRevision } };
}
