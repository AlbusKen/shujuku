import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { isAiMessage_ACU } from '../runtime/message-handler';
import { readWorldSimulationSettings_ACU } from './simulation-settings';
import { WorldSimulationRequirementsStore_ACU } from './simulation-requirements-store';
import type { WorldSimulationRequirementsStorePort_ACU } from './world-simulation-agent-session';
import { createWorldSimError_ACU, isWorldEntity_ACU, isWorldEvent_ACU, isWorldThread_ACU, WorldSimulationValidationError_ACU, type WorldSimulationModule_ACU, type WorldSimulationSettings_ACU, type WorldSimulationSwipeIdentity_ACU, type WorldSimulationTransaction_ACU, type WorldStateSnapshot_ACU } from './model';
import { renderWorldSimulationPublicDelta_ACU } from './simulation-public-delta';
import { parseWorldSimulationProjection_ACU } from './simulation-projection';
import { applyWorldSimulationTransaction_ACU, normalizeWorldSimulationTransactionVisibility_ACU } from './simulation-transaction';
import { resolveActiveWorldSimulationSwipe_ACU, sameWorldSimulationSwipeIdentity_ACU } from './simulation-swipe';
import { WorldSimulationStore_ACU } from './simulation-store';

export interface WorldSimulationUserEditBaseline_ACU { state: WorldStateSnapshot_ACU; anchorMessageIndex: number; replayDigest: string; parentReplayDigest: string | null; /** Complete active body identity used to reject edited/switched pages. */ swipe: WorldSimulationSwipeIdentity_ACU; /** Writer identity: existing system projections are addressed by their pre-projection body hash. */ commitSwipe: WorldSimulationSwipeIdentity_ACU; expectedProjectionBlockHash: string | null; }
export interface WorldSimulationUserRequirementsBaseline_ACU { anchorMessageIndex: number; swipe: WorldSimulationSwipeIdentity_ACU; revision: number | null; requirements: readonly unknown[]; sourceIds: readonly string[]; }
export type WorldSimulationUserEditRead_ACU = { kind: 'ready'; baseline: WorldSimulationUserEditBaseline_ACU; requirements: WorldSimulationUserRequirementsBaseline_ACU; diagnostics: { checkpointMessageIndex: number; checkpointId: string; deltaMessageIndices: readonly number[]; branchReparsed: boolean } } | { kind: 'empty'; requirements: WorldSimulationUserRequirementsBaseline_ACU | null };
export interface WorldSimulationUserEditDependencies_ACU { store: Pick<WorldSimulationStore_ACU, 'read' | 'commitProjection'>; getChat: () => any[]; createRecordId: () => string; readSettings: () => WorldSimulationSettings_ACU | null; requirementsStore: WorldSimulationRequirementsStorePort_ACU; }
function fail(code: 'WORLD_SIM_STALE' | 'WORLD_SIM_CONFLICT' | 'WORLD_SIM_PROTOCOL_INVALID', message: string): never { throw new WorldSimulationValidationError_ACU(createWorldSimError_ACU(code, 'persist', message, false)); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function latestAi(chat: any[]): number { for (let i = chat.length - 1; i >= 0; i -= 1) if (isAiMessage_ACU(chat[i])) return i; return -1; }
function settings(read: () => WorldSimulationSettings_ACU | null): WorldSimulationSettings_ACU { const value = read(); if (!value) fail('WORLD_SIM_PROTOCOL_INVALID', '世界推演设置不可用，无法保存用户编辑'); return value; }
function validItems(module: WorldSimulationModule_ACU, raw: unknown): any[] { if (!Array.isArray(raw) || !raw.every(value => module === 'entities' ? isWorldEntity_ACU(value) : module === 'events' ? isWorldEvent_ACU(value) : isWorldThread_ACU(value))) fail('WORLD_SIM_PROTOCOL_INVALID', `${module} 必须是完整领域对象数组`); const ids = raw.map((value: any) => value.id); if (new Set(ids).size !== ids.length) fail('WORLD_SIM_PROTOCOL_INVALID', `${module} 不允许重复稳定 id`); return clone(raw); }

function transactionForModule(module: WorldSimulationModule_ACU, state: WorldStateSnapshot_ACU, raw: unknown): WorldSimulationTransaction_ACU {
  const next = validItems(module, raw);
  const current = state[module] as any[];
  const nextById = new Map(next.map(item => [item.id, item]));
  if (current.some(item => !nextById.has(item.id))) fail('WORLD_SIM_CONFLICT', `${module} 不允许丢失既有条目；请以 retired 标记撤销`);
  const writes: any[] = [];
  for (const item of next) {
    const previous = current.find(entry => entry.id === item.id);
    if (previous && same(previous, item)) continue;
    if (previous?.retired) fail('WORLD_SIM_PROTOCOL_INVALID', `${module} 的已撤销条目不可直接修改`);
    if (item.retired) {
      if (!previous) fail('WORLD_SIM_PROTOCOL_INVALID', `${module} 新条目不可直接标记为撤销`);
      writes.push({ action: 'retire', id: item.id, reason: item.retiredReason?.trim() || '用户手动撤销' });
    } else writes.push({ action: 'upsert', value: item });
  }
  if (!writes.length) fail('WORLD_SIM_PROTOCOL_INVALID', `${module} 没有可保存的变化`);
  return {
    anchorMessageIndex: state.anchorMessageIndex,
    storyClock: clone(state.storyClock),
    expectedRevisions: { [module]: state.revisions[module] },
    entities: module === 'entities' ? writes : [],
    events: module === 'events' ? writes : [],
    threads: module === 'threads' ? writes : [],
  } as WorldSimulationTransaction_ACU;
}
function currentSwipe(anchor: number, chat: any[]): WorldSimulationSwipeIdentity_ACU {
  const message = chat[anchor];
  if (!message) fail('WORLD_SIM_STALE', '当前世界账本锚点楼层已不存在');
  return resolveActiveWorldSimulationSwipe_ACU(anchor, message).identity;
}
function requirementsBaseline(store: WorldSimulationRequirementsStorePort_ACU, anchor: number, chat: any[], swipe: WorldSimulationSwipeIdentity_ACU): WorldSimulationUserRequirementsBaseline_ACU {
  const snapshot = store.read(anchor, chat);
  return { anchorMessageIndex: anchor, swipe, revision: snapshot?.revision ?? null, requirements: clone(snapshot?.requirements ?? []), sourceIds: store.userSourceIds(anchor, chat) };
}
function sameBaseline(left: WorldSimulationUserEditBaseline_ACU, right: WorldSimulationUserEditBaseline_ACU): boolean {
  return left.anchorMessageIndex === right.anchorMessageIndex && left.replayDigest === right.replayDigest
    && left.parentReplayDigest === right.parentReplayDigest && left.expectedProjectionBlockHash === right.expectedProjectionBlockHash
    && sameWorldSimulationSwipeIdentity_ACU(left.commitSwipe, right.commitSwipe)
    && sameWorldSimulationSwipeIdentity_ACU(left.swipe, right.swipe);
}

export class WorldSimulationUserEditAdapter_ACU {
  constructor(private readonly dependencies: WorldSimulationUserEditDependencies_ACU) {}
  read(): WorldSimulationUserEditRead_ACU {
    const chat = this.dependencies.getChat();
    const replay = this.dependencies.store.read();
    const anchor = replay?.state.anchorMessageIndex ?? latestAi(chat);
    if (anchor < 0) return { kind: 'empty', requirements: null };
    const active = resolveActiveWorldSimulationSwipe_ACU(anchor, chat[anchor]);
    const swipe = active.identity;
    const requirements = requirementsBaseline(this.dependencies.requirementsStore, anchor, chat, swipe);
    if (!replay) return { kind: 'empty', requirements };
    const projection = parseWorldSimulationProjection_ACU(active.text);
    const commitSwipe = projection ? { ...swipe, baseTextHash: projection.baseTextHash } : swipe;
    return {
      kind: 'ready',
      baseline: {
        state: clone(replay.state), anchorMessageIndex: anchor, replayDigest: replay.digest,
        parentReplayDigest: this.dependencies.store.read(anchor - 1)?.digest ?? null,
        swipe, commitSwipe, expectedProjectionBlockHash: projection?.blockHash ?? null,
      },
      requirements,
      diagnostics: { checkpointMessageIndex: replay.checkpointMessageIndex, checkpointId: replay.checkpointId, deltaMessageIndices: [...replay.deltaMessageIndices], branchReparsed: replay.branchReparsed },
    };
  }
  async saveModule(baseline: WorldSimulationUserEditBaseline_ACU, module: WorldSimulationModule_ACU, raw: unknown): Promise<WorldSimulationUserEditBaseline_ACU> {
    const current = this.read();
    if (current.kind !== 'ready' || !sameBaseline(baseline, current.baseline)) fail('WORLD_SIM_STALE', 'active swipe、正文或世界账本已变化；请刷新后再保存');
    const config = settings(this.dependencies.readSettings);
    const transaction = normalizeWorldSimulationTransactionVisibility_ACU(transactionForModule(module, current.baseline.state, raw), config.visibilityPolicy);
    const after = applyWorldSimulationTransaction_ACU(current.baseline.state, transaction, config.maxTrackedEntities);
    const delta = renderWorldSimulationPublicDelta_ACU(current.baseline.state, transaction, after);
    await this.dependencies.store.commitProjection({
      anchorMessageIndex: current.baseline.anchorMessageIndex, recordId: this.dependencies.createRecordId(), state: after,
      delta: { anchorMessageIndex: current.baseline.anchorMessageIndex, storyClock: after.storyClock, entities: after.entities, events: after.events, threads: after.threads, revisions: after.revisions },
      checkpointInterval: config.checkpointInterval, expectedReplayDigest: current.baseline.replayDigest, parentReplayDigest: current.baseline.parentReplayDigest,
      swipe: current.baseline.commitSwipe, sourceAnchorMessageIndex: current.baseline.anchorMessageIndex,
      coverageStartMessageIndex: current.baseline.anchorMessageIndex, coverageEndMessageIndex: current.baseline.anchorMessageIndex,
      expectedProjectionBlockHash: current.baseline.expectedProjectionBlockHash, publicText: delta.text || null, publicEntryIds: delta.publicEntryIds,
    });
    const saved = this.read();
    if (saved.kind !== 'ready') fail('WORLD_SIM_STALE', '联合提交后无法重新读取 active swipe 世界账本');
    return saved.baseline;
  }

  async saveRequirements(baseline: WorldSimulationUserRequirementsBaseline_ACU, raw: unknown): Promise<WorldSimulationUserRequirementsBaseline_ACU> {
    if (!Array.isArray(raw)) fail('WORLD_SIM_PROTOCOL_INVALID', 'requirements 必须是 JSON 数组');
    const chat = this.dependencies.getChat();
    const swipe = currentSwipe(baseline.anchorMessageIndex, chat);
    if (!sameWorldSimulationSwipeIdentity_ACU(baseline.swipe, swipe)) fail('WORLD_SIM_STALE', 'active swipe 或正文已变化；请刷新后再保存要求');
    const current = this.dependencies.requirementsStore.read(baseline.anchorMessageIndex, chat);
    if ((current?.revision ?? null) !== baseline.revision) fail('WORLD_SIM_CONFLICT', '当前要求 revision 已变化；请刷新后再保存');
    const sourceIds = this.dependencies.requirementsStore.userSourceIds(baseline.anchorMessageIndex, chat);
    const appliedUserMessageId = sourceIds[sourceIds.length - 1];
    if (!appliedUserMessageId) fail('WORLD_SIM_PROTOCOL_INVALID', '没有可引用的用户输入，无法保存要求');
    await this.dependencies.requirementsStore.replace(baseline.anchorMessageIndex, {
      action: 'maintain_requirements', thought: '用户手动维护当前要求', expectedRevision: current?.revision ?? 0,
      appliedUserMessageId, requirements: raw, summary: '用户手动保存当前要求',
    }, chat);
    return requirementsBaseline(this.dependencies.requirementsStore, baseline.anchorMessageIndex, chat, swipe);
  }
}

export function createWorldSimulationUserEditAdapter_ACU(): WorldSimulationUserEditAdapter_ACU {
  return new WorldSimulationUserEditAdapter_ACU({
    store: new WorldSimulationStore_ACU(), getChat: getChatArray_ACU,
    createRecordId: () => `world-sim-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    readSettings: readWorldSimulationSettings_ACU, requirementsStore: new WorldSimulationRequirementsStore_ACU(),
  });
}
