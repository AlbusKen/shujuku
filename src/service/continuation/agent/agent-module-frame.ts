/**
 * service/continuation/agent/agent-module-frame.ts — 续写资料的楼层增量帧
 *
 * 楼层字段从全量快照升级为 { checkpoint, deltas }。读取从最近基线起按楼层顺序叠加
 * 当前 swipe 的 delta；删除楼层会让该楼 delta 物理消失，折叠结果自动回到剩余链。
 * schema 1/2 全量快照只在内存里充当 swipe 0 的基线，成功写入才替换成 schema 3。
 */

import {
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentModuleFloorDelta_ACU,
  type AgentWritableModule_ACU,
  type AgentModuleFloorFrame_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentPendingFix_ACU,
} from './agent-model';

export interface AgentModuleFrameDeps_ACU {
  validateSnapshot: (raw: unknown) => AgentModuleSnapshot_ACU | null;
  salvageSnapshot: (raw: unknown) => { snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null;
  emptySnapshot: () => AgentModuleSnapshot_ACU;
}

export interface AgentModuleFoldCandidate_ACU {
  index: number;
  valid: boolean;
  problems: string[];
}

export interface AgentModuleFoldResult_ACU {
  snapshot: AgentModuleSnapshot_ACU;
  candidates: AgentModuleFoldCandidate_ACU[];
  adoptedIndex: number | null;
  salvaged: boolean;
  checkpointIndex: number | null;
  foldedDeltaCount: number;
  /** 折叠范围内是否纳入过基线或 delta。空聊天为 false。 */
  contributed: boolean;
}

interface ParsedLegacy_ACU {
  kind: 'legacy';
  snapshot: AgentModuleSnapshot_ACU;
}

interface ParsedFrame_ACU {
  kind: 'frame';
  frame: AgentModuleFloorFrame_ACU;
  problems: string[];
}

interface ParsedBroken_ACU {
  kind: 'broken';
  problems: string[];
  salvaged: AgentModuleSnapshot_ACU | null;
}

type ParsedField_ACU = { kind: 'empty' } | ParsedLegacy_ACU | ParsedFrame_ACU | ParsedBroken_ACU;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readMessageSwipeId_ACU(message: unknown): string {
  if (!isRecord_ACU(message)) return '0';
  const swipeId = message.swipe_id;
  return typeof swipeId === 'number' && Number.isInteger(swipeId) && swipeId >= 0 ? String(swipeId) : '0';
}

function isAiMessage_ACU(message: unknown): boolean {
  return isRecord_ACU(message) && message.is_user !== true;
}

function latestAiIndex_ACU(chat: readonly unknown[]): number {
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    if (isAiMessage_ACU(chat[index])) return index;
  }
  return Math.max(0, chat.length - 1);
}

function clampWaterline_ACU(value: number, targetIndex: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, Math.max(0, targetIndex));
}

function semanticPayload_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  return JSON.stringify({
    settledThroughIndex: snapshot.settledThroughIndex,
    revisions: snapshot.revisions,
    hooks: snapshot.hooks,
    infoGap: snapshot.infoGap,
    constraints: snapshot.constraints,
    storyArc: snapshot.storyArc,
    chronology: snapshot.chronology,
    webRefs: snapshot.webRefs,
    userRequirements: snapshot.userRequirements,
    materialCompletion: snapshot.materialCompletion,
    pendingFixes: snapshot.pendingFixes,
  });
}

function sameSemantic_ACU(left: AgentModuleSnapshot_ACU, right: AgentModuleSnapshot_ACU): boolean {
  return semanticPayload_ACU(left) === semanticPayload_ACU(right);
}

function emptyFrame_ACU(): AgentModuleFloorFrame_ACU {
  return { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, deltas: [] };
}

function parseDelta_ACU(raw: unknown, deps: AgentModuleFrameDeps_ACU): AgentModuleFloorDelta_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) return null;
  if (typeof raw.swipeId !== 'string' || !raw.swipeId.trim()) return null;
  if (!isRecord_ACU(raw.writes) || !isRecord_ACU(raw.revisions)) return null;
  const seed = deps.emptySnapshot();
  seed.settledThroughIndex = 0;
  const applied = applyDelta_ACU(seed, {
    seq: raw.seq,
    swipeId: raw.swipeId,
    writes: raw.writes as AgentModuleFloorDelta_ACU['writes'],
    revisions: raw.revisions as AgentModuleFloorDelta_ACU['revisions'],
    ...(isRecord_ACU(raw.removedIds) ? { removedIds: raw.removedIds as AgentModuleFloorDelta_ACU['removedIds'] } : {}),
    ...(raw.pendingFixes === undefined ? {} : { pendingFixes: raw.pendingFixes as AgentPendingFix_ACU[] }),
    ...(raw.materialCompletion === undefined ? {} : { materialCompletion: raw.materialCompletion as AgentModuleFloorDelta_ACU['materialCompletion'] }),
    ...(raw.settledThroughIndex === undefined ? {} : { settledThroughIndex: raw.settledThroughIndex as number }),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  });
  if (!deps.validateSnapshot(applied)) return null;
  const delta: AgentModuleFloorDelta_ACU = {
    seq: raw.seq,
    swipeId: raw.swipeId,
    writes: cloneJson_ACU(raw.writes) as AgentModuleFloorDelta_ACU['writes'],
    revisions: cloneJson_ACU(raw.revisions) as Partial<AgentModuleRevisions_ACU>,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  };
  if (isRecord_ACU(raw.removedIds)) delta.removedIds = cloneJson_ACU(raw.removedIds) as AgentModuleFloorDelta_ACU['removedIds'];
  if (Array.isArray(raw.pendingFixes)) delta.pendingFixes = cloneJson_ACU(applied.pendingFixes);
  if (isRecord_ACU(raw.materialCompletion)) delta.materialCompletion = cloneJson_ACU(applied.materialCompletion);
  if (typeof raw.settledThroughIndex === 'number' && Number.isInteger(raw.settledThroughIndex) && raw.settledThroughIndex >= 0) {
    delta.settledThroughIndex = raw.settledThroughIndex;
  }
  return delta;
}

function parseField_ACU(raw: unknown, deps: AgentModuleFrameDeps_ACU): ParsedField_ACU {
  if (raw === undefined) return { kind: 'empty' };
  if (!isRecord_ACU(raw)) return { kind: 'broken', problems: ['资料字段不是对象'], salvaged: null };
  if (raw.schemaVersion === AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU) {
    if (!Array.isArray(raw.deltas)) return { kind: 'broken', problems: ['schema 3 缺少 deltas 数组'], salvaged: null };
    const problems: string[] = [];
    const deltas: AgentModuleFloorDelta_ACU[] = [];
    raw.deltas.forEach((item, index) => {
      const delta = parseDelta_ACU(item, deps);
      if (delta) deltas.push(delta);
      else problems.push(`deltas[${index}] 无法折叠，已跳过`);
    });
    deltas.sort((left, right) => left.seq - right.seq);
    const frame: AgentModuleFloorFrame_ACU = { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, deltas };
    if (isRecord_ACU(raw.checkpoint)) {
      const snapshot = deps.validateSnapshot(raw.checkpoint.snapshot);
      const swipeId = typeof raw.checkpoint.swipeId === 'string' && raw.checkpoint.swipeId.trim() ? raw.checkpoint.swipeId : '';
      if (snapshot && swipeId) frame.checkpoint = { swipeId, snapshot };
      else problems.push('checkpoint 未通过严格校验，已忽略');
    }
    return { kind: 'frame', frame, problems };
  }
  const legacy = deps.validateSnapshot(raw);
  if (legacy) return { kind: 'legacy', snapshot: legacy };
  const salvaged = deps.salvageSnapshot(raw);
  return {
    kind: 'broken',
    problems: salvaged?.problems ?? ['快照不是可折叠的资料帧'],
    salvaged: salvaged?.snapshot ?? null,
  };
}

function entryId_ACU(item: unknown): string {
  if (!isRecord_ACU(item) || typeof item.id !== 'string') return '';
  return item.id;
}

function applyModuleWrite_ACU(current: readonly unknown[], upserts: readonly unknown[] | undefined, removed: readonly string[] | undefined, replaceAll: boolean): unknown[] {
  if (replaceAll) return cloneJson_ACU([...(upserts ?? [])]);
  const removedIds = new Set(removed ?? []);
  const replacements = new Map<string, unknown>();
  for (const item of upserts ?? []) {
    const id = entryId_ACU(item);
    if (id) replacements.set(id, item);
  }
  const next: unknown[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const id = entryId_ACU(item);
    if (!id || removedIds.has(id)) continue;
    if (replacements.has(id)) {
      next.push(cloneJson_ACU(replacements.get(id)));
      seen.add(id);
    } else next.push(cloneJson_ACU(item));
  }
  for (const [id, item] of replacements) {
    if (!seen.has(id) && !removedIds.has(id)) next.push(cloneJson_ACU(item));
  }
  return next;
}

function applyDelta_ACU(snapshot: AgentModuleSnapshot_ACU, delta: AgentModuleFloorDelta_ACU): AgentModuleSnapshot_ACU {
  const next = cloneJson_ACU(snapshot);
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    if (!Object.prototype.hasOwnProperty.call(delta.writes, key) && !delta.removedIds?.[key as Exclude<AgentWritableModule_ACU, 'userRequirements'>]) continue;
    const replaceAll = key === 'userRequirements';
    const moduleKey = key as Exclude<AgentWritableModule_ACU, 'userRequirements'>;
    (next as unknown as Record<string, unknown>)[key] = applyModuleWrite_ACU(
      next[key] as unknown[],
      delta.writes[key] as unknown[] | undefined,
      replaceAll ? undefined : delta.removedIds?.[moduleKey],
      replaceAll,
    );
  }
  next.revisions = { ...next.revisions, ...delta.revisions };
  if (delta.pendingFixes) next.pendingFixes = cloneJson_ACU(delta.pendingFixes);
  if (delta.materialCompletion) next.materialCompletion = cloneJson_ACU(delta.materialCompletion);
  if (typeof delta.settledThroughIndex === 'number') next.settledThroughIndex = delta.settledThroughIndex;
  next.updatedAt = delta.updatedAt;
  return next;
}

function diffSnapshot_ACU(before: AgentModuleSnapshot_ACU, after: AgentModuleSnapshot_ACU, swipeId: string, seq: number): AgentModuleFloorDelta_ACU | null {
  const writes: AgentModuleFloorDelta_ACU['writes'] = {};
  const removedIds: NonNullable<AgentModuleFloorDelta_ACU['removedIds']> = {};
  const revisions: Partial<AgentModuleRevisions_ACU> = {};
  let changed = false;
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    if (key === 'userRequirements') {
      if (JSON.stringify(before.userRequirements) !== JSON.stringify(after.userRequirements)) {
        writes.userRequirements = cloneJson_ACU(after.userRequirements);
        changed = true;
      }
    } else {
      const previous = before[key] as unknown as Array<Record<string, unknown>>;
      const nextItems = after[key] as unknown as Array<Record<string, unknown>>;
      const previousById = new Map(previous.map(item => [entryId_ACU(item), item]));
      const nextIds = new Set(nextItems.map(item => entryId_ACU(item)));
      const upserts = nextItems.filter(item => {
        const id = entryId_ACU(item);
        const prior = previousById.get(id);
        return !prior || JSON.stringify(prior) !== JSON.stringify(item);
      });
      const removed = previous.map(item => entryId_ACU(item)).filter(id => id && !nextIds.has(id));
      if (upserts.length) {
        (writes as Record<string, unknown>)[key] = cloneJson_ACU(upserts);
        changed = true;
      }
      if (removed.length) {
        removedIds[key] = removed;
        changed = true;
      }
    }
    if (before.revisions[key] !== after.revisions[key]) {
      revisions[key] = after.revisions[key];
      changed = true;
    }
  }
  const delta: AgentModuleFloorDelta_ACU = { seq, swipeId, writes, revisions, updatedAt: after.updatedAt };
  if (Object.keys(removedIds).length) delta.removedIds = removedIds;
  if (JSON.stringify(before.pendingFixes) !== JSON.stringify(after.pendingFixes)) {
    delta.pendingFixes = cloneJson_ACU(after.pendingFixes);
    changed = true;
  }
  if (JSON.stringify(before.materialCompletion) !== JSON.stringify(after.materialCompletion)) {
    delta.materialCompletion = cloneJson_ACU(after.materialCompletion);
    changed = true;
  }
  if (before.settledThroughIndex !== after.settledThroughIndex) {
    delta.settledThroughIndex = after.settledThroughIndex;
    changed = true;
  }
  return changed ? delta : null;
}

function fieldOf_ACU(message: unknown): unknown {
  if (!isRecord_ACU(message) || !Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) return undefined;
  return message[AGENT_MODULE_FIELD_ACU];
}

function maxSeq_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): number {
  let max = 0;
  for (const message of chat) {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame') continue;
    for (const delta of parsed.frame.deltas) max = Math.max(max, delta.seq);
  }
  return max;
}

function hasSchema3Checkpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): boolean {
  return chat.some(message => {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    return parsed.kind === 'frame' && !!parsed.frame.checkpoint;
  });
}

/**
 * 从聊天头部折叠到 throughIndex（含）。不按数组长度钳制水位。
 */
export function foldAgentModuleSnapshot_ACU(
  chat: readonly unknown[],
  deps: AgentModuleFrameDeps_ACU,
  throughIndex = chat.length - 1,
): AgentModuleFoldResult_ACU {
  let snapshot = deps.emptySnapshot();
  let contributed = false;
  let sawSchema3Checkpoint = false;
  let checkpointIndex: number | null = null;
  let foldedDeltaCount = 0;
  let adoptedIndex: number | null = null;
  const candidates: AgentModuleFoldCandidate_ACU[] = [];
  let salvage: { index: number; snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null = null;
  const end = Math.min(throughIndex, chat.length - 1);

  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    const raw = fieldOf_ACU(message);
    if (raw === undefined) continue;
    const parsed = parseField_ACU(raw, deps);
    const swipeId = readMessageSwipeId_ACU(message);
    if (parsed.kind === 'legacy') {
      candidates.push({ index, valid: true, problems: [] });
      if (!sawSchema3Checkpoint && swipeId === '0') {
        snapshot = cloneJson_ACU(parsed.snapshot);
        contributed = true;
        checkpointIndex = index;
        adoptedIndex = index;
        foldedDeltaCount = 0;
      }
      continue;
    }
    if (parsed.kind === 'broken') {
      candidates.push({ index, valid: false, problems: parsed.problems });
      if (parsed.salvaged) salvage = { index, snapshot: parsed.salvaged, problems: parsed.problems };
      continue;
    }
    if (parsed.kind !== 'frame') continue;
    candidates.push({ index, valid: parsed.problems.length === 0, problems: parsed.problems });
    if (parsed.frame.checkpoint && parsed.frame.checkpoint.swipeId === swipeId) {
      snapshot = cloneJson_ACU(parsed.frame.checkpoint.snapshot);
      contributed = true;
      sawSchema3Checkpoint = true;
      checkpointIndex = index;
      adoptedIndex = index;
      foldedDeltaCount = 0;
    }
    for (const delta of parsed.frame.deltas) {
      if (delta.swipeId !== swipeId) continue;
      snapshot = applyDelta_ACU(snapshot, delta);
      contributed = true;
      foldedDeltaCount += 1;
      if (adoptedIndex === null) adoptedIndex = index;
    }
  }

  if (!contributed && salvage) {
    return {
      snapshot: cloneJson_ACU(salvage.snapshot),
      candidates,
      adoptedIndex: salvage.index,
      salvaged: true,
      checkpointIndex: salvage.index,
      foldedDeltaCount: 0,
      contributed: true,
    };
  }
  return {
    snapshot,
    candidates,
    adoptedIndex: contributed ? adoptedIndex : null,
    salvaged: false,
    checkpointIndex: contributed ? checkpointIndex : null,
    foldedDeltaCount,
    contributed,
  };
}

function readFrame_ACU(message: unknown, deps: AgentModuleFrameDeps_ACU): AgentModuleFloorFrame_ACU {
  const parsed = parseField_ACU(fieldOf_ACU(message), deps);
  if (parsed.kind === 'frame') return cloneJson_ACU(parsed.frame);
  return emptyFrame_ACU();
}

function writeFrame_ACU(message: Record<string, unknown>, frame: AgentModuleFloorFrame_ACU): void {
  const next: AgentModuleFloorFrame_ACU = {
    schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
    deltas: frame.deltas,
  };
  if (frame.checkpoint) next.checkpoint = frame.checkpoint;
  message[AGENT_MODULE_FIELD_ACU] = next;
}

function stripCurrentSwipeThrough_ACU(chat: unknown[], anchorIndex: number, deps: AgentModuleFrameDeps_ACU): void {
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!isRecord_ACU(message)) continue;
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame') continue;
    const swipeId = readMessageSwipeId_ACU(message);
    const frame = cloneJson_ACU(parsed.frame);
    delete frame.checkpoint;
    if (index <= anchorIndex) frame.deltas = frame.deltas.filter(delta => delta.swipeId !== swipeId);
    if (!frame.checkpoint && frame.deltas.length === 0) delete message[AGENT_MODULE_FIELD_ACU];
    else writeFrame_ACU(message, frame);
  }
}

/**
 * 把 throughIndex 及之前的当前 swipe 链折成锚点楼上的唯一 schema 3 基线。
 * 锚点之后的 delta 保留。没有可折叠内容时不写空基线。
 */
export function relocateContinuationCheckpoint_ACU(
  chat: unknown[],
  anchorIndex: number,
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= chat.length) return false;
  const anchor = chat[anchorIndex];
  if (!isAiMessage_ACU(anchor)) return false;
  const folded = foldAgentModuleSnapshot_ACU(chat, deps, anchorIndex);
  if (!folded.contributed || folded.salvaged) return false;
  const before = JSON.stringify(chat.map(message => fieldOf_ACU(message)));
  stripCurrentSwipeThrough_ACU(chat, anchorIndex, deps);
  const frame = readFrame_ACU(anchor, deps);
  frame.checkpoint = { swipeId: readMessageSwipeId_ACU(anchor), snapshot: cloneJson_ACU(folded.snapshot) };
  writeFrame_ACU(anchor as Record<string, unknown>, frame);
  const after = JSON.stringify(chat.map(message => fieldOf_ACU(message)));
  return before !== after;
}

function appendDelta_ACU(chat: unknown[], targetIndex: number, delta: AgentModuleFloorDelta_ACU, deps: AgentModuleFrameDeps_ACU): void {
  const message = chat[targetIndex];
  if (!isRecord_ACU(message)) return;
  const frame = readFrame_ACU(message, deps);
  frame.deltas = [...frame.deltas, delta].sort((left, right) => left.seq - right.seq);
  writeFrame_ACU(message, frame);
}

export interface AgentModuleWritePlan_ACU {
  changed: boolean;
  assignments: Array<{ index: number; existed: boolean; previous: unknown; value: unknown }>;
}

/**
 * 规划一次快照写入：已有 schema 3 基线时只追加 delta；否则把首基线放到表格 checkpoint 楼或最新 AI 楼。
 * 不修改传入的 chat。
 */
export function planAgentModuleSnapshotWrite_ACU(
  chat: unknown[],
  targetIndex: number,
  next: AgentModuleSnapshot_ACU,
  deps: AgentModuleFrameDeps_ACU,
  tableAnchorIndex: number | null,
): AgentModuleWritePlan_ACU {
  const scratch = chat.map(message => (isRecord_ACU(message) ? { ...message } : message));
  const before = foldAgentModuleSnapshot_ACU(scratch, deps);
  const clamped: AgentModuleSnapshot_ACU = {
    ...cloneJson_ACU(next),
    settledThroughIndex: clampWaterline_ACU(next.settledThroughIndex, targetIndex),
    updatedAt: Date.now(),
  };
  if (before.contributed && !before.salvaged && sameSemantic_ACU(before.snapshot, clamped)) {
    return { changed: false, assignments: [] };
  }
  const base = before.contributed ? before.snapshot : deps.emptySnapshot();
  const delta = diffSnapshot_ACU(base, clamped, readMessageSwipeId_ACU(scratch[targetIndex]), maxSeq_ACU(scratch, deps) + 1);
  const hadSchema3 = hasSchema3Checkpoint_ACU(scratch, deps);
  if (hadSchema3) {
    if (delta) appendDelta_ACU(scratch, targetIndex, delta, deps);
  } else {
    const tableAnchor = tableAnchorIndex !== null && isAiMessage_ACU(scratch[tableAnchorIndex]) ? tableAnchorIndex : null;
    const anchor = tableAnchor ?? latestAiIndex_ACU(scratch);
    const anchorMessage = scratch[anchor];
    if (isRecord_ACU(anchorMessage)) {
      const checkpointSnapshot = targetIndex <= anchor || !delta ? clamped : base;
      if (deps.validateSnapshot(checkpointSnapshot)) {
        const frame = readFrame_ACU(anchorMessage, deps);
        frame.checkpoint = { swipeId: readMessageSwipeId_ACU(anchorMessage), snapshot: cloneJson_ACU(checkpointSnapshot) };
        if (anchor === targetIndex) frame.deltas = frame.deltas.filter(item => item.swipeId !== frame.checkpoint?.swipeId);
        writeFrame_ACU(anchorMessage, frame);
      }
    }
    if (delta && targetIndex > anchor) appendDelta_ACU(scratch, targetIndex, delta, deps);
  }
  const assignments: AgentModuleWritePlan_ACU['assignments'] = [];
  scratch.forEach((message, index) => {
    const previous = fieldOf_ACU(chat[index]);
    const value = fieldOf_ACU(message);
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    assignments.push({
      index,
      existed: previous !== undefined,
      previous,
      value,
    });
  });
  return { changed: assignments.length > 0, assignments };
}

export function continuationCheckpointArtifact_ACU(
  message: unknown,
  deps: AgentModuleFrameDeps_ACU,
): { swipeId: string; snapshot: AgentModuleSnapshot_ACU } | null {
  const parsed = parseField_ACU(fieldOf_ACU(message), deps);
  if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) return null;
  return cloneJson_ACU(parsed.frame.checkpoint);
}

/** 把丢失的基线嫁到目标楼。目标楼同一 swipe 已有基线时不覆盖。 */
export function graftContinuationCheckpoint_ACU(
  message: unknown,
  artifact: { swipeId: string; snapshot: AgentModuleSnapshot_ACU },
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!isRecord_ACU(message)) return false;
  const frame = readFrame_ACU(message, deps);
  if (frame.checkpoint && frame.checkpoint.swipeId === artifact.swipeId) return false;
  if (frame.checkpoint) return false;
  frame.checkpoint = cloneJson_ACU(artifact);
  writeFrame_ACU(message, frame);
  return true;
}

/** 每个当前 swipe 至多一个 schema 3 基线。legacy 全量不计入。 */
export function assertSingleActiveContinuationCheckpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): string | null {
  const seen = new Map<string, number>();
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) continue;
    if (parsed.frame.checkpoint.swipeId !== readMessageSwipeId_ACU(message)) continue;
    const swipeId = parsed.frame.checkpoint.swipeId;
    const previous = seen.get(swipeId);
    if (previous !== undefined) return `续写资料 swipe ${swipeId} 存在多个活跃基线：楼层 ${previous} 与 ${index}`;
    seen.set(swipeId, index);
  }
  return null;
}

export function chatHasContinuationMaterial_ACU(chat: readonly unknown[]): boolean {
  return chat.some(message => fieldOf_ACU(message) !== undefined);
}
