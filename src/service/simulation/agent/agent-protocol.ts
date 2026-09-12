import { extractAgentKernelJsonObjects_ACU } from '../../agent-kernel/json-payload';
import {
  createWorldSimError_ACU,
  isWorldEntity_ACU,
  isWorldEvent_ACU,
  isWorldStableId_ACU,
  isWorldStateSnapshot_ACU,
  isWorldStoryClock_ACU,
  isWorldThread_ACU,
  WorldSimulationValidationError_ACU,
  type WorldEntityTransactionItem_ACU,
  type WorldEvent_ACU,
  type WorldEventTransactionItem_ACU,
  type WorldSimulationModule_ACU,
  type WorldSimulationTransaction_ACU,
  type WorldStateSnapshot_ACU,
  type WorldStoryClock_ACU,
  type WorldThreadTransactionItem_ACU,
} from '../model';
import type { WorldSimulationAgentDefinition_ACU } from './agent-catalog';

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU('WORLD_SIM_PROTOCOL_INVALID', 'protocol', message, true, details));
}

function exactKeys_ACU(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseOutput_ACU(raw: string | null | undefined): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) fail_ACU('世界推演 Agent 返回为空');
  const text = raw.trim();
  const objects = extractAgentKernelJsonObjects_ACU(text, 2);
  if (objects.length !== 1 || objects[0] !== text) fail_ACU('世界推演 Agent 必须只返回一个完整 JSON 对象');
  let value: unknown;
  try { value = JSON.parse(text); } catch (_) { fail_ACU('世界推演 Agent JSON 非法'); }
  if (!isRecord_ACU(value) || !exactKeys_ACU(value, ['expectedRevisions', 'entities', 'events', 'threads'])) {
    fail_ACU('世界推演 Agent 输出含缺失或未知顶层字段');
  }
  return value;
}

function parseItem_ACU<T>(raw: unknown, isValue: (value: unknown) => value is T, module: string): { action: 'upsert'; value: T } | { action: 'retire'; id: string; reason: string } {
  if (!isRecord_ACU(raw) || typeof raw.action !== 'string') fail_ACU(`${module} 写集条目非法`);
  if (raw.action === 'upsert') {
    if (!exactKeys_ACU(raw, ['action', 'value']) || !isValue(raw.value) || (raw.value as any).retired) fail_ACU(`${module} upsert 条目非法`);
    return { action: 'upsert', value: raw.value };
  }
  if (raw.action === 'retire') {
    if (!exactKeys_ACU(raw, ['action', 'id', 'reason']) || !isWorldStableId_ACU(raw.id) || typeof raw.reason !== 'string' || !raw.reason.trim()) fail_ACU(`${module} retire 条目非法`);
    return { action: 'retire', id: raw.id, reason: raw.reason.trim() };
  }
  return fail_ACU(`${module}.action 必须是 upsert 或 retire`);
}

type DurationTier_ACU = 'instant' | 'hour' | 'day' | 'week';

function durationTier_ACU(text: string): DurationTier_ACU | null {
  const value = text.trim();
  if (/(?:瞬时|立刻|当下|即时|instant)/i.test(value)) return 'instant';
  if (/(?:\d+|[一二三四五六七八九十两半]|几|数|若干)\s*(?:个)?(?:小时|钟头|hours?\b)/i.test(value)) return 'hour';
  if (/(?:\d+|[一二三四五六七八九十两半]|几|数|若干)\s*(?:个)?(?:天|日|昼夜|days?\b)/i.test(value)) return 'day';
  if (/(?:\d+|[一二三四五六七八九十两半]|几|数|若干)\s*(?:个)?(?:周|星期|礼拜|月|年|季|weeks?\b|months?\b|years?\b)/i.test(value)) return 'week';
  return null;
}


function assertEventDuration_ACU(event: WorldEvent_ACU, storyClock: WorldStoryClock_ACU, anchorMessageIndex: number): void {
  if (event.occurredIndex > anchorMessageIndex || !event.durationHint?.trim()) {
    fail_ACU(`事件 ${event.id} 的发生锚点或 durationHint 非法`, { id: event.id });
  }
  const eventTier = durationTier_ACU(event.durationHint);
  if (!eventTier) fail_ACU(`事件 ${event.id} 的 durationHint 无法识别`, { id: event.id, durationHint: event.durationHint });
  if (storyClock.precision === 'unknown' && eventTier !== 'instant') {
    fail_ACU(`unknown 时间精度下事件 ${event.id} 不得依赖时间跨度`, { id: event.id });
  }
  if (storyClock.precision === 'approximate') {
    const gateTier = durationTier_ACU(storyClock.elapsedSinceLastRun);
    const order: Record<DurationTier_ACU, number> = { instant: 0, hour: 1, day: 2, week: 3 };
    if (!gateTier || order[eventTier] > order[gateTier]) {
      fail_ACU(`事件 ${event.id} 的 durationHint 超过当前故事跨度`, { id: event.id, durationHint: event.durationHint, elapsed: storyClock.elapsedSinceLastRun });
    }
  }
}

function parseExpectedRevisions_ACU(raw: unknown, touched: readonly WorldSimulationModule_ACU[], snapshot: WorldStateSnapshot_ACU): WorldSimulationTransaction_ACU['expectedRevisions'] {
  if (!isRecord_ACU(raw)) fail_ACU('expectedRevisions 必须是对象');
  const actual = Object.keys(raw).sort();
  const expected = [...touched].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail_ACU('expectedRevisions 必须且只能声明实际写入的模块');
  const result: WorldSimulationTransaction_ACU['expectedRevisions'] = {};
  for (const module of touched) {
    const revision = raw[module];
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) fail_ACU(`${module} 的 expectedRevision 非法`);
    if (revision !== snapshot.revisions[module]) fail_ACU(`${module} 的 expectedRevision 已过期`, { module, expected: revision, actual: snapshot.revisions[module] });
    result[module] = revision;
  }
  return result;
}




/** Parses one role-restricted model output into the existing pure transaction seam. */
export function parseWorldSimulationAgentOutput_ACU(input: {
  raw: string | null | undefined;
  agent: WorldSimulationAgentDefinition_ACU;
  snapshot: WorldStateSnapshot_ACU;
  anchorMessageIndex: number;
  storyClock: WorldStoryClock_ACU;
}): WorldSimulationTransaction_ACU | null {
  if (!isWorldStateSnapshot_ACU(input.snapshot) || !Number.isInteger(input.anchorMessageIndex) || input.anchorMessageIndex < input.snapshot.anchorMessageIndex
    || !isWorldStoryClock_ACU(input.storyClock) || input.storyClock.updatedIndex !== input.anchorMessageIndex) {
    fail_ACU('世界推演 Agent 解析上下文非法');
  }
  const payload = parseOutput_ACU(input.raw);
  if (!Array.isArray(payload.entities) || !Array.isArray(payload.events) || !Array.isArray(payload.threads)) {
    fail_ACU('世界推演 Agent 模块写集必须都是数组');
  }
  const entities = payload.entities.map(item => parseItem_ACU(item, isWorldEntity_ACU, 'entities')) as WorldEntityTransactionItem_ACU[];
  const events = payload.events.map(item => parseItem_ACU(item, isWorldEvent_ACU, 'events')) as WorldEventTransactionItem_ACU[];
  const threads = payload.threads.map(item => parseItem_ACU(item, isWorldThread_ACU, 'threads')) as WorldThreadTransactionItem_ACU[];
  const modules = [['entities', entities], ['events', events], ['threads', threads]] as const;
  const touched = modules.filter(([, items]) => items.length > 0).map(([module]) => module);
  for (const [module, items] of modules) {
    if (items.length > 0 && !input.agent.writableModules.includes(module)) fail_ACU(`${input.agent.name} 未获授权写入 ${module}`, { agent: input.agent.name, module });
  }
  if (!touched.length) {
    if (!isRecord_ACU(payload.expectedRevisions) || Object.keys(payload.expectedRevisions).length !== 0) fail_ACU('空写集的 expectedRevisions 必须为空对象');
    return null;
  }
  const expectedRevisions = parseExpectedRevisions_ACU(payload.expectedRevisions, touched, input.snapshot);
  for (const item of events) if (item.action === 'upsert') assertEventDuration_ACU(item.value, input.storyClock, input.anchorMessageIndex);
  return { anchorMessageIndex: input.anchorMessageIndex, storyClock: input.storyClock, expectedRevisions, entities, events, threads };
}
