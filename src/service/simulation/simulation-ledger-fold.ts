/**
 * service/simulation/simulation-ledger-fold.ts — 世界推演账本的楼层增量折叠
 *
 * STATE 分桶的当前 swipe 条目从全量账本改为 checkpoint + delta。
 * 读取按楼层顺序叠加；首楼 envelope.ledger 只是可重建缓存。
 * 编年归档用同一模式。会话分段已经按楼层增量存储，不在这里改写。
 */

import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  type WorldChronicleArchiveSnapshot_ACU,
  type WorldSimulationAnchorIdentity_ACU,
} from './agent/agent-model';
import {
  WORLD_LEDGER_SCHEMA_VERSION_ACU,
  type WorldClock_ACU,
  type WorldGuidance_ACU,
  type WorldPlayer_ACU,
  type WorldSimulationLedger_ACU,
  type WorldSimulationPendingFix_ACU,
} from './model';
import { findLatestTableFullCheckpointIndex_ACU } from '../chat/material-checkpoint-sync';
import {
  buildWorldSimulationBucketKey_ACU,
  registerWorldSimulationLedgerOverlay_ACU,
  resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationChronicleArchiveSnapshot_ACU,
  validateWorldSimulationLedger_ACU,
} from './simulation-store';
import type { WorldSimulationEnvelope_ACU } from './model';

export const WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU = 2 as const;

const ARRAY_MODULES_ACU = [
  ['dimensions', 'id'],
  ['seeds', 'id'],
  ['actors', 'id'],
  ['chronicle', 'id'],
  ['rumors', 'id'],
  ['chronicleOverview', 'fingerprint'],
] as const;

type ArrayModule_ACU = typeof ARRAY_MODULES_ACU[number][0];

export interface WorldSimulationLedgerDelta_ACU {
  seq: number;
  revision: number;
  upserts: Partial<Record<ArrayModule_ACU, Array<Record<string, unknown>>>>;
  removedIds: Partial<Record<ArrayModule_ACU, string[]>>;
  clock?: WorldClock_ACU;
  player?: WorldPlayer_ACU;
  guidance?: WorldGuidance_ACU;
  pendingFixes?: WorldSimulationPendingFix_ACU[];
  evidenceRefs?: string[];
  updatedAt: number;
}

export interface WorldSimulationLedgerFrame_ACU {
  schemaVersion: typeof WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU;
  checkpoint?: WorldSimulationLedger_ACU;
  deltas: WorldSimulationLedgerDelta_ACU[];
}

interface ArchiveDelta_ACU {
  seq: number;
  records: WorldChronicleArchiveSnapshot_ACU['records'];
}

interface ArchiveFrame_ACU {
  schemaVersion: typeof WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU;
  checkpoint?: WorldChronicleArchiveSnapshot_ACU;
  deltas: ArchiveDelta_ACU[];
}

export interface WorldSimulationLedgerFold_ACU {
  ledger: WorldSimulationLedger_ACU;
  evidenceRefs: string[];
  updatedAt: number;
  checkpointIndex: number | null;
  foldedDeltaCount: number;
  lastContributedIndex: number | null;
  contributedIndexes: number[];
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isAssistant_ACU(message: unknown): boolean {
  return isRecord_ACU(message) && message.is_user !== true && message.is_system !== true;
}

function bucketEntries_ACU(message: Record<string, unknown>, field: string): Record<string, { anchor?: WorldSimulationAnchorIdentity_ACU; value?: unknown }> {
  const raw = message[field];
  if (!isRecord_ACU(raw) || raw.schemaVersion !== 1 || !isRecord_ACU(raw.entries)) return {};
  return raw.entries as Record<string, { anchor?: WorldSimulationAnchorIdentity_ACU; value?: unknown }>;
}

function entryValue_ACU(message: unknown, field: string, anchor: WorldSimulationAnchorIdentity_ACU): unknown {
  if (!isRecord_ACU(message)) return undefined;
  return bucketEntries_ACU(message, field)[buildWorldSimulationBucketKey_ACU(anchor)]?.value;
}

function writeEntry_ACU(message: Record<string, unknown>, field: string, anchor: WorldSimulationAnchorIdentity_ACU, value: unknown, updatedAt: number): void {
  const previous = message[field];
  const entries = isRecord_ACU(previous) && previous.schemaVersion === 1 && isRecord_ACU(previous.entries)
    ? { ...previous.entries }
    : {};
  entries[buildWorldSimulationBucketKey_ACU(anchor)] = { anchor: { ...anchor }, value, updatedAt };
  message[field] = { schemaVersion: 1, entries };
}

function isLedgerValue_ACU(value: unknown): value is WorldSimulationLedger_ACU {
  return isRecord_ACU(value) && value.schemaVersion === WORLD_LEDGER_SCHEMA_VERSION_ACU && Array.isArray(value.dimensions) && Array.isArray(value.pendingFixes);
}

function isLedgerFrame_ACU(value: unknown): value is WorldSimulationLedgerFrame_ACU {
  return isRecord_ACU(value) && value.schemaVersion === WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU && Array.isArray(value.deltas);
}

function evidenceFromMaterials_ACU(message: unknown, anchor: WorldSimulationAnchorIdentity_ACU): string[] | null {
  const value = entryValue_ACU(message, WORLD_SIMULATION_MATERIALS_FIELD_ACU, anchor);
  if (!isRecord_ACU(value) || !Array.isArray(value.evidenceRefs)) return null;
  if (value.evidenceRefs.some(item => typeof item !== 'string' || !item.trim())) return null;
  return [...value.evidenceRefs] as string[];
}

function itemId_ACU(item: Record<string, unknown>, idKey: string): string {
  const id = item[idKey];
  return typeof id === 'string' ? id : '';
}

function applyArrayModule_ACU(
  current: readonly Record<string, unknown>[],
  upserts: readonly Record<string, unknown>[] | undefined,
  removed: readonly string[] | undefined,
  idKey: string,
): Record<string, unknown>[] {
  const removedIds = new Set(removed ?? []);
  const replacements = new Map<string, Record<string, unknown>>();
  for (const item of upserts ?? []) {
    const id = itemId_ACU(item, idKey);
    if (id) replacements.set(id, item);
  }
  const next: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const id = itemId_ACU(item, idKey);
    if (!id || removedIds.has(id)) continue;
    if (replacements.has(id)) {
      next.push(cloneJson_ACU(replacements.get(id)!));
      seen.add(id);
    } else next.push(cloneJson_ACU(item));
  }
  for (const [id, item] of replacements) {
    if (!seen.has(id) && !removedIds.has(id)) next.push(cloneJson_ACU(item));
  }
  return next;
}

function applyLedgerDelta_ACU(ledger: WorldSimulationLedger_ACU, delta: WorldSimulationLedgerDelta_ACU): WorldSimulationLedger_ACU {
  const next = cloneJson_ACU(ledger);
  for (const [moduleName, idKey] of ARRAY_MODULES_ACU) {
    const current = next[moduleName] as unknown as Record<string, unknown>[];
    next[moduleName] = applyArrayModule_ACU(current, delta.upserts[moduleName], delta.removedIds[moduleName], idKey) as never;
  }
  if (delta.clock) next.clock = cloneJson_ACU(delta.clock);
  if (delta.player) next.player = cloneJson_ACU(delta.player);
  if (delta.guidance) next.guidance = cloneJson_ACU(delta.guidance);
  if (delta.pendingFixes) next.pendingFixes = cloneJson_ACU(delta.pendingFixes);
  next.revision = delta.revision;
  return next;
}

export function diffWorldSimulationLedger_ACU(
  before: WorldSimulationLedger_ACU,
  after: WorldSimulationLedger_ACU,
  evidenceRefs: readonly string[] | undefined,
  updatedAt: number,
  seq: number,
): WorldSimulationLedgerDelta_ACU | null {
  const upserts: WorldSimulationLedgerDelta_ACU['upserts'] = {};
  const removedIds: WorldSimulationLedgerDelta_ACU['removedIds'] = {};
  let changed = before.revision !== after.revision;
  for (const [moduleName, idKey] of ARRAY_MODULES_ACU) {
    const previous = before[moduleName] as unknown as Record<string, unknown>[];
    const nextItems = after[moduleName] as unknown as Record<string, unknown>[];
    const previousById = new Map(previous.map(item => [itemId_ACU(item, idKey), item]));
    const nextIds = new Set(nextItems.map(item => itemId_ACU(item, idKey)));
    const moduleUpserts = nextItems.filter(item => {
      const id = itemId_ACU(item, idKey);
      const prior = previousById.get(id);
      return !prior || JSON.stringify(prior) !== JSON.stringify(item);
    });
    const moduleRemoved = previous.map(item => itemId_ACU(item, idKey)).filter(id => id && !nextIds.has(id));
    if (moduleUpserts.length) {
      upserts[moduleName] = cloneJson_ACU(moduleUpserts);
      changed = true;
    }
    if (moduleRemoved.length) {
      removedIds[moduleName] = moduleRemoved;
      changed = true;
    }
  }
  const delta: WorldSimulationLedgerDelta_ACU = { seq, revision: after.revision, upserts, removedIds, updatedAt };
  if (JSON.stringify(before.clock) !== JSON.stringify(after.clock)) {
    delta.clock = cloneJson_ACU(after.clock);
    changed = true;
  }
  if (JSON.stringify(before.player) !== JSON.stringify(after.player)) {
    delta.player = cloneJson_ACU(after.player);
    changed = true;
  }
  if (JSON.stringify(before.guidance) !== JSON.stringify(after.guidance)) {
    delta.guidance = cloneJson_ACU(after.guidance);
    changed = true;
  }
  if (JSON.stringify(before.pendingFixes) !== JSON.stringify(after.pendingFixes)) {
    delta.pendingFixes = cloneJson_ACU(after.pendingFixes);
    changed = true;
  }
  if (evidenceRefs) {
    delta.evidenceRefs = [...evidenceRefs];
    changed = true;
  }
  return changed ? delta : null;
}

function maxLedgerSeq_ACU(chat: readonly unknown[]): number {
  let max = 0;
  for (const message of chat) {
    if (!isRecord_ACU(message)) continue;
    for (const entry of Object.values(bucketEntries_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU))) {
      if (!isLedgerFrame_ACU(entry.value)) continue;
      for (const delta of entry.value.deltas) max = Math.max(max, delta.seq);
    }
  }
  return max;
}

export function foldWorldSimulationLedger_ACU(chat: readonly unknown[], throughIndex = chat.length - 1): WorldSimulationLedgerFold_ACU | null {
  let ledger: WorldSimulationLedger_ACU | null = null;
  let evidenceRefs: string[] = [];
  let updatedAt = 0;
  let checkpointIndex: number | null = null;
  let foldedDeltaCount = 0;
  let lastContributedIndex: number | null = null;
  const contributedIndexes: number[] = [];
  const end = Math.min(throughIndex, chat.length - 1);

  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
    if (isLedgerValue_ACU(value)) {
      ledger = validateWorldSimulationLedger_ACU(value, 'load');
      checkpointIndex = index;
      foldedDeltaCount = 0;
      lastContributedIndex = index;
      contributedIndexes.push(index);
      const materialsEvidence = evidenceFromMaterials_ACU(message, anchor);
      if (materialsEvidence) evidenceRefs = materialsEvidence;
      continue;
    }
    if (!isLedgerFrame_ACU(value)) continue;
    let touched = false;
    if (value.checkpoint) {
      ledger = validateWorldSimulationLedger_ACU(value.checkpoint, 'load');
      checkpointIndex = index;
      foldedDeltaCount = 0;
      touched = true;
    }
    for (const delta of [...value.deltas].sort((left, right) => left.seq - right.seq)) {
      if (!ledger) continue;
      ledger = validateWorldSimulationLedger_ACU(applyLedgerDelta_ACU(ledger, delta), 'load');
      foldedDeltaCount += 1;
      touched = true;
      if (delta.evidenceRefs) evidenceRefs = [...delta.evidenceRefs];
      updatedAt = delta.updatedAt;
    }
    if (touched) {
      lastContributedIndex = index;
      contributedIndexes.push(index);
    }
  }
  if (!ledger) return null;
  return { ledger, evidenceRefs, updatedAt, checkpointIndex, foldedDeltaCount, lastContributedIndex, contributedIndexes };
}

function isArchiveSnapshot_ACU(value: unknown): value is WorldChronicleArchiveSnapshot_ACU {
  return isRecord_ACU(value) && value.schemaVersion === 1 && isRecord_ACU(value.records);
}

function isArchiveFrame_ACU(value: unknown): value is ArchiveFrame_ACU {
  return isRecord_ACU(value) && value.schemaVersion === WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU && Array.isArray(value.deltas);
}

export function foldWorldSimulationArchive_ACU(chat: readonly unknown[], throughIndex = chat.length - 1): { snapshot: WorldChronicleArchiveSnapshot_ACU; checkpointIndex: number | null } {
  let records: WorldChronicleArchiveSnapshot_ACU['records'] = {};
  let checkpointIndex: number | null = null;
  const end = Math.min(throughIndex, chat.length - 1);
  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, anchor);
    if (isArchiveSnapshot_ACU(value)) {
      records = { ...validateWorldSimulationChronicleArchiveSnapshot_ACU(value, 'load').records };
      checkpointIndex = index;
      continue;
    }
    if (!isArchiveFrame_ACU(value)) continue;
    if (value.checkpoint) {
      records = { ...validateWorldSimulationChronicleArchiveSnapshot_ACU(value.checkpoint, 'load').records };
      checkpointIndex = index;
    }
    for (const delta of [...value.deltas].sort((left, right) => left.seq - right.seq)) {
      records = { ...records, ...delta.records };
    }
  }
  return { snapshot: { schemaVersion: 1, records }, checkpointIndex };
}

function clearActiveLedgerCheckpoints_ACU(chat: unknown[]): void {
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message) || !isRecord_ACU(message)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
    if (!isLedgerFrame_ACU(value) || !value.checkpoint) continue;
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      deltas: value.deltas,
    }, Date.now());
  }
}

export function appendWorldSimulationCommitChain_ACU(input: {
  chat: unknown[];
  messageIndex: number;
  anchor: WorldSimulationAnchorIdentity_ACU;
  beforeLedger: WorldSimulationLedger_ACU;
  nextLedger: WorldSimulationLedger_ACU;
  evidenceRefs: readonly string[];
  updatedAt: number;
  checkpointIndex: number | null;
  beforeArchive: WorldChronicleArchiveSnapshot_ACU;
  nextArchive: WorldChronicleArchiveSnapshot_ACU;
}): void {
  const message = input.chat[input.messageIndex];
  if (!isRecord_ACU(message)) return;
  const seq = maxLedgerSeq_ACU(input.chat) + 1;
  const delta = diffWorldSimulationLedger_ACU(input.beforeLedger, input.nextLedger, input.evidenceRefs, input.updatedAt, seq);
  const baselineFloor = input.checkpointIndex ?? ensureWorldSimulationBaselineFloor_ACU(input.chat, input.messageIndex);
  let baselineAnchor: WorldSimulationAnchorIdentity_ACU | null = null;
  if (baselineFloor !== null && baselineFloor !== input.messageIndex && isRecord_ACU(input.chat[baselineFloor])) {
    try {
      baselineAnchor = resolveWorldSimulationAnchor_ACU(baselineFloor, input.chat as any[]);
    } catch {
      baselineAnchor = null;
    }
  }
  const installCheckpoint = baselineAnchor === null;
  if (baselineAnchor && baselineFloor !== null) {
    const baselineMessage = input.chat[baselineFloor] as Record<string, unknown>;
    writeEntry_ACU(baselineMessage, WORLD_SIMULATION_STATE_FIELD_ACU, baselineAnchor, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: cloneJson_ACU(input.beforeLedger),
      deltas: [],
    }, input.updatedAt);
    writeEntry_ACU(baselineMessage, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, baselineAnchor, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: cloneJson_ACU(input.beforeArchive),
      deltas: [],
    }, input.updatedAt);
  }
  if (installCheckpoint) {
    clearActiveLedgerCheckpoints_ACU(input.chat);
    const frame: WorldSimulationLedgerFrame_ACU = {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: cloneJson_ACU(delta ? input.beforeLedger : input.nextLedger),
      deltas: delta ? [delta] : [],
    };
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor, frame, input.updatedAt);
  } else if (delta) {
    const current = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor);
    const frame: WorldSimulationLedgerFrame_ACU = isLedgerFrame_ACU(current)
      ? {
        schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
        ...(current.checkpoint ? { checkpoint: current.checkpoint } : {}),
        deltas: [...current.deltas, delta],
      }
      : { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, deltas: [delta] };
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, input.anchor, frame, input.updatedAt);
  }

  const changedRecords: WorldChronicleArchiveSnapshot_ACU['records'] = {};
  for (const [archiveRef, record] of Object.entries(input.nextArchive.records)) {
    if (JSON.stringify(input.beforeArchive.records[archiveRef]) !== JSON.stringify(record)) changedRecords[archiveRef] = record;
  }
  const archiveValue = entryValue_ACU(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, input.anchor);
  const archiveFrame: ArchiveFrame_ACU = isArchiveFrame_ACU(archiveValue)
    ? {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      ...(archiveValue.checkpoint ? { checkpoint: archiveValue.checkpoint } : {}),
      deltas: [...archiveValue.deltas],
    }
    : { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, deltas: [] };
  if (installCheckpoint) {
    archiveFrame.checkpoint = cloneJson_ACU(Object.keys(changedRecords).length ? input.beforeArchive : input.nextArchive);
    archiveFrame.deltas = Object.keys(changedRecords).length ? [{ seq, records: changedRecords }] : [];
  } else if (Object.keys(changedRecords).length) {
    archiveFrame.deltas = [...archiveFrame.deltas, { seq, records: changedRecords }];
  } else {
    return;
  }
  writeEntry_ACU(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, input.anchor, archiveFrame, input.updatedAt);
}

export function relocateWorldSimulationCheckpoint_ACU(chat: unknown[], anchorIndex: number): boolean {
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || !isAssistant_ACU(chat[anchorIndex])) return false;
  const folded = foldWorldSimulationLedger_ACU(chat, anchorIndex);
  if (!folded) return false;
  let anchor: WorldSimulationAnchorIdentity_ACU;
  try {
    anchor = resolveWorldSimulationAnchor_ACU(anchorIndex, chat as any[]);
  } catch {
    return false;
  }
  for (let index = 0; index <= anchorIndex; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message) || !isRecord_ACU(message)) continue;
    let current: WorldSimulationAnchorIdentity_ACU;
    try {
      current = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, current);
    if (!isLedgerFrame_ACU(value)) continue;
    writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, current, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      deltas: index < anchorIndex ? [] : value.deltas,
    }, Date.now());
  }
  writeEntry_ACU(chat[anchorIndex] as Record<string, unknown>, WORLD_SIMULATION_STATE_FIELD_ACU, anchor, {
    schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
    checkpoint: cloneJson_ACU(folded.ledger),
    deltas: [],
  }, folded.updatedAt || Date.now());
  return true;
}

export function readFoldedWorldSimulationLedgerForEnvelope_ACU(envelope: WorldSimulationEnvelope_ACU, chat: readonly unknown[]): WorldSimulationEnvelope_ACU {
  const folded = foldWorldSimulationLedger_ACU(chat);
  if (!folded) return envelope;
  return { ...envelope, ledger: folded.ledger };
}

export function simulationLedgerCheckpointArtifact_ACU(message: unknown): { anchor: WorldSimulationAnchorIdentity_ACU; ledger: WorldSimulationLedger_ACU } | null {
  if (!isRecord_ACU(message)) return null;
  for (const entry of Object.values(bucketEntries_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU))) {
    if (!entry.anchor) continue;
    if (isLedgerFrame_ACU(entry.value) && entry.value.checkpoint) {
      return { anchor: cloneJson_ACU(entry.anchor), ledger: cloneJson_ACU(entry.value.checkpoint) };
    }
    if (isLedgerValue_ACU(entry.value)) {
      return { anchor: cloneJson_ACU(entry.anchor), ledger: cloneJson_ACU(entry.value) };
    }
  }
  return null;
}

export function graftSimulationLedgerCheckpoint_ACU(
  chat: unknown[],
  message: unknown,
  artifact: { anchor: WorldSimulationAnchorIdentity_ACU; ledger: WorldSimulationLedger_ACU },
): boolean {
  if (!isRecord_ACU(message)) return false;
  const index = chat.indexOf(message);
  if (index < 0) return false;
  let anchor: WorldSimulationAnchorIdentity_ACU;
  try {
    anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
  } catch {
    return false;
  }
  const current = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
  if ((isLedgerFrame_ACU(current) && current.checkpoint) || isLedgerValue_ACU(current)) return false;
  const frame: WorldSimulationLedgerFrame_ACU = isLedgerFrame_ACU(current)
    ? { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, checkpoint: cloneJson_ACU(artifact.ledger), deltas: current.deltas }
    : { schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU, checkpoint: cloneJson_ACU(artifact.ledger), deltas: [] };
  writeEntry_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor, frame, Date.now());
  return true;
}

export function assertSingleActiveSimulationCheckpoint_ACU(chat: readonly unknown[]): string | null {
  let seen: number | null = null;
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (!isAssistant_ACU(message)) continue;
    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, chat as any[]);
    } catch {
      continue;
    }
    const value = entryValue_ACU(message, WORLD_SIMULATION_STATE_FIELD_ACU, anchor);
    const active = (isLedgerFrame_ACU(value) && !!value.checkpoint) || isLedgerValue_ACU(value);
    if (!active) continue;
    if (seen !== null) return `世界推演账本存在多个活跃基线：楼层 ${seen} 与 ${index}`;
    seen = index;
  }
  return null;
}

export function ensureWorldSimulationBaselineFloor_ACU(chat: readonly unknown[], latestAiIndex: number): number | null {
  const tableAnchor = findLatestTableFullCheckpointIndex_ACU(chat);
  if (tableAnchor !== null && isAssistant_ACU(chat[tableAnchor])) return tableAnchor;
  if (latestAiIndex >= 0 && isAssistant_ACU(chat[latestAiIndex])) return latestAiIndex;
  return null;
}

registerWorldSimulationLedgerOverlay_ACU((envelope, chat) => readFoldedWorldSimulationLedgerForEnvelope_ACU(envelope, chat as unknown[]));
