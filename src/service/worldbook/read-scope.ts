/**
 * service/worldbook/read-scope.ts
 * 表格候选作用域：requested→host 目标解析、候选集合构建与顺序稳定去重。
 *
 * 候选集合只保留本次逻辑阶段的显式目标（当前选择 / enabledEntries 键 /
 * Agent greenlight / 注入目标 / 角色绑定），禁止用于全库扫描。
 */
import { resolveLorebookNameFromList_ACU, listLorebooks_ACU } from '../../data/gateways/worldbook-gateway';
import type { LorebookReadContext_ACU } from './read-context';

export interface LorebookReadTarget_ACU {
  requestedName: string;
  hostName: string | null;
}


/**
 * 将一组逻辑名称解析为 requested→host 目标，保持首次出现顺序、按 hostName 去重。
 * 精确匹配优先；归一化多解返回 null（调用方拒绝读取）。
 * 使用请求级上下文内的 catalog 懒解析，避免每次调用重复列全库。
 */
export async function resolveLorebookReadTargets_ACU(
  context: LorebookReadContext_ACU | undefined,
  requestedNames: Iterable<string>,
): Promise<LorebookReadTarget_ACU[]> {
  const seenRequested = new Set<string>();
  const seenHosts = new Set<string>();
  const targets: LorebookReadTarget_ACU[] = [];
  for (const raw of requestedNames) {
    const requested = String(raw ?? '');
    if (!requested.trim() || seenRequested.has(requested)) continue;
    seenRequested.add(requested);
    let hostName: string | null = null;
    if (context) {
      hostName = await context.resolveBookName(requested);
    } else {
      hostName = resolveLorebookNameFromList_ACU(requested, await listLorebooks_ACU());
    }
    if (hostName && seenHosts.has(hostName)) continue;
    if (hostName) seenHosts.add(hostName);
    targets.push({ requestedName: requested, hostName });
  }
  return targets;
}

/**
 * 表格候选作用域：从当前配置/角色绑定/注入目标等显式来源收集候选书名。
 * 保持首次出现顺序并去重；不包含任何全库枚举。
 */
export function buildTableCandidateScope_ACU(collectors: Array<() => Iterable<string>>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const collect of collectors) {
    for (const raw of collect()) {
      const name = String(raw ?? '');
      if (name.trim() && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * 收集异步来源的候选书名（注入目标 / 角色绑定等），与 buildTableCandidateScope_ACU
 * 保持相同的保序去重语义。单个来源失败时静默跳过：这些是可选来源，不阻断填表主流程，
 * 失败仅意味着该书本次不进入候选作用域（后续仍可通过来源 1-3 进入）。
 */
export async function collectAsyncTableCandidateScope_ACU(
  collectors: Array<() => Promise<Iterable<string>> | Iterable<string>>,
): Promise<string[]> {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const collect of collectors) {
    let values: Iterable<string>;
    try {
      values = await collect();
    } catch {
      continue;
    }
    for (const raw of values) {
      const name = String(raw ?? '');
      if (name.trim() && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}
