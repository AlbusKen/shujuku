import type { WorldActor_ACU } from './model';

export interface WorldActorCompletion_ACU {
  actorId: string;
  completion: 'changed' | 'no_change';
  expectedRevision: number;
}

/** revision 是保存身份，JSON 属性顺序也不属于人物业务变化。 */
function canonicalActorState_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalActorState_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalActorState_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameActorState_ACU(left: WorldActor_ACU, right: WorldActor_ACU): boolean {
  const { revision: _leftRevision, ...leftState } = left;
  const { revision: _rightRevision, ...rightState } = right;
  return canonicalActorState_ACU(leftState) === canonicalActorState_ACU(rightState);
}

/** 每轮入口按稳定 ID 固定人物处理集合；next-check 和 life 不决定是否跳过。 */
export function activeWorldActorRoster_ACU(actors: readonly WorldActor_ACU[]): string[] {
  return actors.filter(actor => actor.simulationStatus !== 'archived').map(actor => actor.id).sort();
}

/** 稳定 ID 确定性分页；一次分配的页不依赖正文是否点名或人物 next-check。 */
export function pageActiveWorldActors_ACU(actors: readonly WorldActor_ACU[], pageSize: number): string[][] {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('人物批次大小必须是正整数');
  const ids = activeWorldActorRoster_ACU(actors);
  const pages: string[][] = [];
  for (let index = 0; index < ids.length; index += pageSize) pages.push(ids.slice(index, index + pageSize));
  return pages;
}

/** 召回页全部返回后再进入业务阶段；缺页、跨页重复或额外 ID 都拒绝。 */
export function validateWorldActorPages_ACU(actors: readonly WorldActor_ACU[], pages: readonly (readonly string[])[]): string[] {
  const expected = activeWorldActorRoster_ACU(actors);
  const flattened = pages.flatMap(page => page);
  const errors: string[] = [];
  if (pages.some(page => !page.length)) errors.push('人物召回页不能为空');
  if (new Set(flattened).size !== flattened.length) errors.push('人物召回页含重复 ID');
  if (JSON.stringify(flattened) !== JSON.stringify(expected)) errors.push('人物召回页未按稳定 ID 完整覆盖 active roster');
  return errors;
}

/** 候选在全部人物批次结束前只做纯校验，不持久化局部结果。 */
export function validateWorldActorCompletions_ACU(
  before: readonly WorldActor_ACU[], after: readonly WorldActor_ACU[], completions: readonly WorldActorCompletion_ACU[],
): string[] {
  const errors: string[] = [];
  const previous = new Map(before.map(actor => [actor.id, actor]));
  const next = new Map(after.map(actor => [actor.id, actor]));
  const roster = new Set(activeWorldActorRoster_ACU(before));
  for (const actor of after) {
    if (!previous.has(actor.id) && actor.simulationStatus !== 'archived') roster.add(actor.id);
  }
  const seen = new Set<string>();
  for (const entry of completions) {
    if (!roster.has(entry.actorId)) errors.push(`人物 ${entry.actorId} 不在本轮 active roster`);
    if (seen.has(entry.actorId)) errors.push(`人物 ${entry.actorId} 重复提交覆盖证明`);
    seen.add(entry.actorId);
    if (entry.completion !== 'changed' && entry.completion !== 'no_change') errors.push(`人物 ${entry.actorId} 完成状态非法`);
    const prior = previous.get(entry.actorId);
    const updated = next.get(entry.actorId);
    if (!updated) errors.push(`人物 ${entry.actorId} 不能从候选账本删除`);
    if (entry.expectedRevision !== (prior?.revision ?? 0)) errors.push(`人物 ${entry.actorId} revision 冲突`);
    if (!prior && entry.completion !== 'changed') errors.push(`新人物 ${entry.actorId} 必须标记 changed`);
    if (entry.completion === 'changed' && prior && updated && sameActorState_ACU(prior, updated)) {
      errors.push(`人物 ${entry.actorId} 未变化却标记 changed`);
    }
    if (prior && updated && entry.completion === 'no_change' && !sameActorState_ACU(prior, updated)) {
      errors.push(`人物 ${entry.actorId} 发生变化却标记 no_change`);
    }
  }
  for (const id of roster) if (!seen.has(id)) errors.push(`人物 ${id} 缺少本轮覆盖证明`);
  return errors;
}
