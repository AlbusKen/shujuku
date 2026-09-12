import { describe, expect, it, vi } from 'vitest';
import type { WorldSimulationLedgerRecord_ACU, WorldStateDelta_ACU, WorldStateSnapshot_ACU } from '../../../src/service/simulation/model';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { buildWorldSimulationReplayDigest_ACU, replayWorldSimulationFromChat_ACU } from '../../../src/service/simulation/simulation-replay';
import { WorldSimulationStore_ACU, type WorldSimulationProjectionCommitInput_ACU } from '../../../src/service/simulation/simulation-store';
import { renderWorldSimulationProjection_ACU } from '../../../src/service/simulation/simulation-projection';
import { hashWorldSimulationBody_ACU, resolveActiveWorldSimulationSwipe_ACU } from '../../../src/service/simulation/simulation-swipe';

const commitGuard = vi.hoisted(() => ({ mark: vi.fn() }));
vi.mock('../../../src/service/simulation/simulation-commit-guard', () => ({
  markWorldSimulationProjectionEmit_ACU: (...args: any[]) => commitGuard.mark(...args),
}));

const clock = (index: number) => ({ anchorText: `第${index}楼`, elapsedSinceLastRun: '约一日', precision: 'approximate' as const, evidenceIndexes: [index], updatedIndex: index });

function state(index: number, entityId = 'ent-a'): WorldStateSnapshot_ACU {
  return {
    anchorMessageIndex: index,
    storyClock: clock(index),
    entities: [{ id: entityId, kind: 'character', name: entityId, importance: 'active', situation: `处境${index}`, agenda: '推进', lastMovedIndex: index, lastMovedAt: `第${index}日`, visibility: { mode: 'hidden' }, retired: false, updatedIndex: index }],
    events: [], threads: [], revisions: { entities: index, events: index, threads: index },
  };
}

function delta(index: number, entityId = `ent-${index}`): WorldStateDelta_ACU {
  const next = state(index, entityId);
  return { anchorMessageIndex: index, storyClock: next.storyClock, entities: next.entities, revisions: next.revisions };
}

function checkpoint(index: number, id = `cp-${index}`): WorldSimulationLedgerRecord_ACU {
  return { version: 1, kind: 'checkpoint', id, anchorMessageIndex: index, state: state(index) };
}

function deltaRecord(index: number, id = `d-${index}`): WorldSimulationLedgerRecord_ACU {
  return { version: 1, kind: 'delta', id, anchorMessageIndex: index, delta: delta(index) };
}

function message(record?: WorldSimulationLedgerRecord_ACU): any {
  const slot: Record<string, unknown> = { independentData: { sheet_0: { name: 'unchanged' } } };
  if (record) slot.worldSimulation = record;
  return { TavernDB_ACU_IsolatedData: { '': slot } };
}

function activeSwipeMessage(index: number, swipeIndex: number, pages: readonly string[], persisted: unknown): any {
  const slot: Record<string, unknown> = { independentData: { sheet_0: { name: 'unchanged' } } };
  if (persisted !== undefined) slot.worldSimulation = persisted;
  return {
    message_id: `ai-${index}`,
    is_user: false,
    mes: pages[swipeIndex],
    swipe_id: swipeIndex,
    swipes: [...pages],
    TavernDB_ACU_IsolatedData: { '': slot },
  };
}

function perSwipeEntry(index: number, swipeIndex: number, baseText: string, parentReplayDigest: string | null, record: WorldSimulationLedgerRecord_ACU): any {
  const projection = renderWorldSimulationProjection_ACU(baseText, `第${index}楼公开进展`)!;
  return {
    swipe: { messageIndex: index, messageKey: `string:ai-${index}`, swipeIndex, baseTextHash: projection.baseTextHash },
    parentReplayDigest,
    sourceAnchorMessageIndex: 0,
    coverageStartMessageIndex: index,
    coverageEndMessageIndex: index,
    projection: { version: 1, blockHash: projection.blockHash, baseTextHash: projection.baseTextHash, publicEntryIds: [`entry-${index}-${swipeIndex}`] },
    record,
  };
}

function perSwipeEnvelope(...entries: any[]): any {
  return { version: 2, kind: 'per_swipe', entries };
}

function expectCode(action: () => unknown, code: string): void {
  try { action(); throw new Error('expected WorldSimulationValidationError_ACU'); } catch (error) {
    expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect((error as WorldSimulationValidationError_ACU).error.code).toBe(code);
  }
}

describe('world simulation replay', () => {
  it('replays checkpoint plus ordered deltas and emits a content-free identity digest', () => {
    const replay = replayWorldSimulationFromChat_ACU([message(checkpoint(0)), message(deltaRecord(1)), message(deltaRecord(2))], '')!;
    expect(replay).toMatchObject({ checkpointMessageIndex: 0, checkpointId: 'cp-0', deltaMessageIndices: [1, 2] });
    expect(replay.state.entities[0].id).toBe('ent-2');
    expect(replay.digest).toMatch(/^checkpoint:0:[0-9a-f]{8}\|deltas:1:[0-9a-f]{8},2:[0-9a-f]{8}$/);
    expect(replay.digest).not.toContain('处境');
    expect(replay.digest).not.toContain('cp-0');
  });

  it('drops a shifted suffix on branch deletion and fails closed for invalid history', () => {
    const original = [message(checkpoint(0)), message(deltaRecord(1)), message(deltaRecord(2))];
    const before = replayWorldSimulationFromChat_ACU(original, '')!;
    const after = replayWorldSimulationFromChat_ACU([original[0], original[2]], '')!;
    expect(after.state.entities[0].id).toBe('ent-a');
    expect(after.digest).not.toBe(before.digest);
    expectCode(() => replayWorldSimulationFromChat_ACU([message({ version: 1, kind: 'delta', id: 'bad', anchorMessageIndex: 0, delta: {} } as any)], ''), 'WORLD_SIM_READ_FAILED');
    expectCode(() => replayWorldSimulationFromChat_ACU([message(deltaRecord(0))], ''), 'WORLD_SIM_READ_FAILED');
  });

  it('selects only the active swipe record and restores its independent lineage when switched back', () => {
    const cp0 = checkpoint(0);
    const digest0 = buildWorldSimulationReplayDigest_ACU(0, cp0.id, []);
    const a = deltaRecord(1, 'a-1');
    a.delta = delta(1, 'ent-a-branch');
    const b = deltaRecord(1, 'b-1');
    b.delta = delta(1, 'ent-b-branch');
    const aProjection = renderWorldSimulationProjection_ACU('A正文', '第1楼公开进展')!;
    const bProjection = renderWorldSimulationProjection_ACU('B正文', '第1楼公开进展')!;
    const first = activeSwipeMessage(1, 0, ['A正文', 'B正文'], perSwipeEnvelope(
      perSwipeEntry(1, 0, 'A正文', digest0, a),
      perSwipeEntry(1, 1, 'B正文', digest0, b),
    ));
    first.mes = aProjection.fullText;
    first.swipes[0] = aProjection.fullText;
    const digestA = buildWorldSimulationReplayDigest_ACU(0, cp0.id, [a]);
    const afterA = deltaRecord(2, 'a-2');
    afterA.delta = delta(2, 'ent-after-a');
    const secondProjection = renderWorldSimulationProjection_ACU('第二楼正文', '第2楼公开进展')!;
    const second = activeSwipeMessage(2, 0, ['第二楼正文'], perSwipeEnvelope(
      perSwipeEntry(2, 0, '第二楼正文', digestA, afterA),
    ));
    second.mes = secondProjection.fullText;
    second.swipes[0] = secondProjection.fullText;
    const chat = [message(cp0), first, second];

    const replayA = replayWorldSimulationFromChat_ACU(chat, '')!;
    expect(replayA.state.entities[0].id).toBe('ent-after-a');
    expect(replayA.branchReparsed).toBe(false);

    first.swipe_id = 1;
    first.mes = bProjection.fullText;
    first.swipes[1] = bProjection.fullText;
    const replayB = replayWorldSimulationFromChat_ACU(chat, '')!;
    expect(replayB.state.entities[0].id).toBe('ent-b-branch');
    expect(replayB.deltaMessageIndices).toEqual([1]);
    expect(replayB.branchReparsed).toBe(true);

    first.swipe_id = 0;
    first.mes = aProjection.fullText;
    first.swipes[0] = aProjection.fullText;
    expect(replayWorldSimulationFromChat_ACU(chat,'')).toMatchObject({
      branchReparsed: false,
      state: { entities: [{ id: 'ent-after-a' }] },
    });
  });

  it('marks a selected v2 suffix with a wrong parent digest as reparsed without applying it', () => {
    const cp0 = checkpoint(0);
    const stale = deltaRecord(1, 'stale-1');
    stale.delta = delta(1, 'must-not-apply');
    const projection = renderWorldSimulationProjection_ACU('正文', '第1楼公开进展')!;
    const messageWithProjection = activeSwipeMessage(1, 0, ['正文'], perSwipeEnvelope(perSwipeEntry(1, 0, '正文', 'wrong-parent', stale)));
    messageWithProjection.mes = projection.fullText;
    messageWithProjection.swipes[0] = projection.fullText;
    const replay = replayWorldSimulationFromChat_ACU([
      message(cp0),
      messageWithProjection,
    ], '')!;
    expect(replay).toMatchObject({ branchReparsed: true, deltaMessageIndices: [] });
    expect(replay.state.entities[0].id).toBe('ent-a');
  });

  it('drops a matching v2 suffix when its terminal system projection is removed or edited', () => {
    const cp0 = checkpoint(0);
    const digest0 = buildWorldSimulationReplayDigest_ACU(0, cp0.id, []);
    const candidate = deltaRecord(1, 'candidate-1');
    candidate.delta = delta(1, 'must-not-apply');
    const projection = renderWorldSimulationProjection_ACU('正文', '第1楼公开进展')!;
    const target = activeSwipeMessage(1, 0, [projection.fullText], perSwipeEnvelope(perSwipeEntry(1, 0, '正文', digest0, candidate)));
    expect(replayWorldSimulationFromChat_ACU([message(cp0), target], '')).toMatchObject({ branchReparsed: false, state: { entities: [{ id: 'must-not-apply' }] } });
    target.mes = '正文\n\n<与此同时>\n用户改写\n</与此同时>';
    target.swipes[0] = target.mes;
    expect(replayWorldSimulationFromChat_ACU([message(cp0), target], '')).toMatchObject({ branchReparsed: true, state: { entities: [{ id: 'ent-a' }] } });
  });
});


describe('WorldSimulationStore_ACU', () => {
  function harness() {
    let chat: any[] = [message()];
    const save = vi.fn(async () => undefined);
    const emit = vi.fn();
    const dependencies = { getChat: () => chat, getChatIdentity: () => 'chat-a', getIsolationKey: () => '', saveChatStrict: save, emitMessageUpdated: emit };
    return { store: new WorldSimulationStore_ACU(dependencies), dependencies, save, emit, get chat() { return chat; }, set chat(value: any[]) { chat = value; } };
  }

  function projectionInput(target: any, patch: Partial<WorldSimulationProjectionCommitInput_ACU> = {}): WorldSimulationProjectionCommitInput_ACU {
    const swipe = resolveActiveWorldSimulationSwipe_ACU(0, target).identity;
    return {
      anchorMessageIndex: 0, recordId: 'projection-0', state: state(0, 'projection'), checkpointInterval: 20,
      expectedReplayDigest: null, parentReplayDigest: null, swipe,
      sourceAnchorMessageIndex: 0, coverageStartMessageIndex: 0, coverageEndMessageIndex: 0,
      expectedProjectionBlockHash: null, publicText: '北岸出现新的公开动向。', publicEntryIds: ['evt-public'],
      ...patch,
    };
  }

  it('writes checkpoint then delta, preserves table data, and checkpoints again at the interval', async () => {
    const h = harness();
    await h.store.commit({ anchorMessageIndex: 0, recordId: 'cp-0', state: state(0), checkpointInterval: 2, expectedReplayDigest: null });
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].independentData.sheet_0.name).toBe('unchanged');
    const first = h.store.read()!;
    h.chat.push(message());
    await h.store.commit({ anchorMessageIndex: 1, recordId: 'd-1', state: state(1, 'ent-1'), delta: delta(1, 'ent-1'), checkpointInterval: 2, expectedReplayDigest: first.digest });
    expect(h.chat[1].TavernDB_ACU_IsolatedData[''].worldSimulation.kind).toBe('delta');
    const second = h.store.read()!;
    h.chat.push(message());
    await h.store.commit({ anchorMessageIndex: 2, recordId: 'cp-2', state: state(2, 'ent-2'), delta: delta(2, 'ent-2'), checkpointInterval: 2, expectedReplayDigest: second.digest });
    expect(h.chat[2].TavernDB_ACU_IsolatedData[''].worldSimulation.kind).toBe('checkpoint');
    expect(h.save).toHaveBeenCalledTimes(3);
  });

  it('preserves an existing JSON-string isolation container while appending world simulation data', async () => {
    const h = harness();
    h.chat = [{ TavernDB_ACU_IsolatedData: JSON.stringify({ '': { independentData: { sheet_0: { name: 'string-preserved' } } } }) }];
    await h.store.commit({ anchorMessageIndex: 0, recordId: 'cp-string', state: state(0), checkpointInterval: 2, expectedReplayDigest: null });
    expect(typeof h.chat[0].TavernDB_ACU_IsolatedData).toBe('string');
    const slot = JSON.parse(h.chat[0].TavernDB_ACU_IsolatedData)[''];
    expect(slot.independentData.sheet_0.name).toBe('string-preserved');
    expect(slot.worldSimulation.id).toBe('cp-string');
  });

  it('commits one v2 ledger envelope and one active-page projection in a single save', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 1, ['旧 swipe', '原始 AI 正文'], undefined);
    const originalVariables = [{ hp: 1 }, { hp: 2 }];
    target.variables = JSON.parse(JSON.stringify(originalVariables));
    target.swipe_info = [{ branch: 'old' }, { branch: 'active' }];
    h.chat = [target];

    const result = await h.store.commitProjection(projectionInput(target));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.emit).toHaveBeenCalledWith(0);
    expect(target.mes).toBe('原始 AI 正文\n\n<与此同时>\n北岸出现新的公开动向。\n</与此同时>');
    expect(target.swipes).toEqual(['旧 swipe', target.mes]);
    expect(target.variables).toEqual(originalVariables);
    expect(target.swipe_info).toEqual([{ branch: 'old' }, { branch: 'active' }]);
    expect(target.TavernDB_ACU_IsolatedData[''].independentData.sheet_0.name).toBe('unchanged');
    expect(target.TavernDB_ACU_IsolatedData[''].worldSimulation).toMatchObject({ version: 2, kind: 'per_swipe', entries: [{ record: { id: 'projection-0' }, projection: result.projection }] });
    expect(h.store.read()).toMatchObject({ state: { entities: [{ id: 'projection' }] }, branchReparsed: false });
  });

  it('commits a hidden-only ledger without writing an empty terminal projection', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    h.chat = [target];

    const result = await h.store.commitProjection(projectionInput(target, { publicText: null, publicEntryIds: [] }));
    expect(result.projection).toBeNull();
    expect(target.mes).toBe('原始 AI 正文');
    expect(target.swipes).toEqual(['原始 AI 正文']);
    expect(target.TavernDB_ACU_IsolatedData[''].worldSimulation.entries[0].projection).toBeNull();
    expect(h.store.read()).toMatchObject({ branchReparsed: false, state: { entities: [{ id: 'projection' }] } });
    expect(h.save).toHaveBeenCalledTimes(1);

    target.mes = `${target.mes}\n\n<与此同时>\n用户补充\n</与此同时>`;
    target.swipes[0] = target.mes;
    // This is the first and only record, so a tampered active page leaves no
    // valid replay prefix to return.
    expect(h.store.read()).toBeNull();
  });

  it('removes only a verified existing system projection for a hidden-only revision', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    h.chat = [target];
    const first = await h.store.commitProjection(projectionInput(target));
    const digest = h.store.read()!.digest;
    const active = resolveActiveWorldSimulationSwipe_ACU(0, target).identity;
    if (!first.projection) throw new Error('expected public projection');

    const result = await h.store.commitProjection(projectionInput(target, {
      recordId: 'hidden-only-revision', expectedReplayDigest: digest, parentReplayDigest: null,
      swipe: { ...active, baseTextHash: first.projection.baseTextHash },
      expectedProjectionBlockHash: first.projection.blockHash, publicText: null, publicEntryIds: [],
    }));
    expect(result.projection).toBeNull();
    expect(target.mes).toBe('原始 AI 正文');
    expect(target.TavernDB_ACU_IsolatedData[''].worldSimulation.entries[0]).toMatchObject({ record: { id: 'hidden-only-revision' }, projection: null });
    expect(h.store.read()).toMatchObject({ branchReparsed: false, state: { entities: [{ id: 'projection' }] } });
  });





  it('replaces only a verified system projection with a current digest and preserves one entry', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    h.chat = [target];
    const first = await h.store.commitProjection(projectionInput(target));
    const currentDigest = h.store.read()!.digest;
    const active = resolveActiveWorldSimulationSwipe_ACU(0, target).identity;
    await h.store.commitProjection(projectionInput(target, {
      recordId: 'projection-0-revised', expectedReplayDigest: currentDigest, parentReplayDigest: null,
      swipe: { ...active, baseTextHash: first.projection.baseTextHash },
      expectedProjectionBlockHash: first.projection.blockHash, publicText: '北岸公开动向已经修正。',
    }));
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(target.mes).toContain('北岸公开动向已经修正。');
    expect(target.TavernDB_ACU_IsolatedData[''].worldSimulation.entries).toHaveLength(1);
    expect(target.TavernDB_ACU_IsolatedData[''].worldSimulation.entries[0].record.id).toBe('projection-0-revised');
  });

  it('restores active text and v2 ledger together when the primary save fails', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    h.chat = [target];
    const original = JSON.parse(JSON.stringify(target));
    h.save.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    await expect(h.store.commitProjection(projectionInput(target))).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED' } });
    expect(target).toEqual(original);
    expect(h.emit).not.toHaveBeenCalled();
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it('rejects a user edit after candidate capture without saving', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    h.chat = [target];
    const input = projectionInput(target);
    target.mes = '用户编辑后的正文';
    target.swipes[0] = target.mes;
    await expect(h.store.commitProjection(input)).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('preserves JSON-string isolation representation while jointly committing the active swipe projection', async () => {
    const h = harness();
    const target = {
      message_id: 'ai-0', is_user: false, mes: '原始 AI 正文', swipe_id: 0, swipes: ['原始 AI 正文'],
      TavernDB_ACU_IsolatedData: JSON.stringify({ '': { independentData: { sheet_0: { name: 'string-preserved' } } } }),
    };
    h.chat = [target];

    await h.store.commitProjection(projectionInput(target));
    expect(typeof target.TavernDB_ACU_IsolatedData).toBe('string');
    const slot = JSON.parse(target.TavernDB_ACU_IsolatedData)[''];
    expect(slot.independentData.sheet_0.name).toBe('string-preserved');
    expect(slot.worldSimulation).toMatchObject({ version: 2, kind: 'per_swipe' });
    expect(target.mes).toContain('<与此同时>');
  });

  it('marks the joint-commit repaint as system-owned before emitting MESSAGE_UPDATED', async () => {
    const h = harness();
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    h.chat = [target];
    commitGuard.mark.mockClear();

    await h.store.commitProjection(projectionInput(target));

    // Order matters: the token must exist before the event fires, otherwise the invalidation
    // listener treats our own repaint as a user edit and discards the settled candidate.
    expect(commitGuard.mark).toHaveBeenCalledWith(0);
    expect(h.emit).toHaveBeenCalledWith(0);
    expect(commitGuard.mark.mock.invocationCallOrder[0]!).toBeLessThan(h.emit.mock.invocationCallOrder[0]!);
  });

  it('reports persistence unknown without emitting when a joint save switches chats', async () => {
    const target = activeSwipeMessage(0, 0, ['原始 AI 正文'], undefined);
    const originalChat = [target];
    const otherChat = [message()];
    let chat = originalChat;
    const save = vi.fn(async () => { chat = otherChat; });
    const emit = vi.fn();
    const store = new WorldSimulationStore_ACU({
      getChat: () => chat,
      getChatIdentity: current => current === originalChat ? 'chat-a' : 'chat-b',
      getIsolationKey: () => '', saveChatStrict: save, emitMessageUpdated: emit,
    });

    await expect(store.commitProjection(projectionInput(target))).rejects.toMatchObject({
      error: { code: 'WORLD_SIM_PERSIST_FAILED', details: { persistenceState: 'unknown', rollbackAttempted: false } },
    });
    expect(target.mes).toBe('原始 AI 正文');
    expect(target.TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('refuses a user-owned terminal projection block rather than replacing it', async () => {
    const h = harness();
    const text = '原始 AI 正文\n\n<与此同时>\n用户自己的补充\n</与此同时>';
    const target = activeSwipeMessage(0, 0, [text], undefined);
    h.chat = [target];

    await expect(h.store.commitProjection(projectionInput(target))).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(h.save).not.toHaveBeenCalled();
    expect(target.mes).toContain('用户自己的补充');
  });

  it('rejects a stale digest before mutation and restores the original slot after failed strict save', async () => {
    const h = harness();
    const original = checkpoint(0);
    h.chat = [message(original), message()];
    await expect(h.store.commit({ anchorMessageIndex: 0, recordId: 'bad', state: state(0), checkpointInterval: 2, expectedReplayDigest: 'obsolete' })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_CONFLICT' } });
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toEqual(original);
    h.save.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    await expect(h.store.commit({ anchorMessageIndex: 1, recordId: 'replace', state: state(1, 'new'), delta: delta(1, 'new'), checkpointInterval: 2 })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED' } });
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toEqual(original);
    expect(h.chat[1].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it('classifies an invalid candidate delta as persist failure without mutating its target', async () => {
    const h = harness();
    h.chat = [message(checkpoint(0)), message()];
    const invalid = { ...delta(1, 'invalid'), revisions: { entities: -1, events: 0, threads: 0 } };
    await expect(h.store.commit({ anchorMessageIndex: 1, recordId: 'invalid', state: state(1, 'invalid'), delta: invalid, checkpointInterval: 2 })).rejects.toMatchObject({
      error: { code: 'WORLD_SIM_PERSIST_FAILED', phase: 'persist' },
    });
    expect(h.chat[1].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('rejects an empty historical hole before the active replay tip without saving', async () => {
    const h = harness();
    h.chat = [message(checkpoint(0)), message(), message(deltaRecord(2))];
    const before = h.store.read()!;

    await expect(h.store.commit({
      anchorMessageIndex: 1,
      recordId: 'late-checkpoint',
      state: state(1, 'should-not-write'),
      checkpointInterval: 2,
      expectedReplayDigest: before.digest,
    })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_CONFLICT' } });

    expect(h.chat[1].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(h.store.read()!.digest).toBe(before.digest);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('reports unknown persistence when a strict save resolves after a chat switch', async () => {
    const originalChat = [message()];
    const otherChat = [message()];
    let chat = originalChat;
    const save = vi.fn(async () => { chat = otherChat; });
    const store = new WorldSimulationStore_ACU({
      getChat: () => chat,
      getChatIdentity: current => current === originalChat ? 'chat-a' : 'chat-b',
      getIsolationKey: () => '',
      saveChatStrict: save,
    });

    await expect(store.commit({ anchorMessageIndex: 0, recordId: 'switched-resolve', state: state(0), checkpointInterval: 2 }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED', details: { persistenceState: 'unknown', rollbackAttempted: false } } });
    expect(originalChat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(save).toHaveBeenCalledOnce();
  });

  it('reports unknown persistence when a strict save rejects after a chat switch', async () => {
    const originalChat = [message()];
    const otherChat = [message()];
    let chat = originalChat;
    const save = vi.fn(async () => {
      chat = otherChat;
      throw new Error('save rejected after switch');
    });
    const store = new WorldSimulationStore_ACU({
      getChat: () => chat,
      getChatIdentity: current => current === originalChat ? 'chat-a-reject' : 'chat-b-reject',
      getIsolationKey: () => '',
      saveChatStrict: save,
    });

    await expect(store.commit({ anchorMessageIndex: 0, recordId: 'switched-reject', state: state(0), checkpointInterval: 2 }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED', details: { persistenceState: 'unknown', rollbackAttempted: false } } });
    expect(originalChat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(save).toHaveBeenCalledOnce();
  });

  it('reports unknown persistence when compensation save resolves after a chat switch', async () => {
    const originalChat = [message()];
    const otherChat = [message()];
    let chat = originalChat;
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockImplementationOnce(async () => { chat = otherChat; });
    const store = new WorldSimulationStore_ACU({
      getChat: () => chat,
      getChatIdentity: current => current === originalChat ? 'chat-a-compensate-resolve' : 'chat-b-compensate-resolve',
      getIsolationKey: () => '',
      saveChatStrict: save,
    });

    await expect(store.commit({ anchorMessageIndex: 0, recordId: 'compensate-switch-resolve', state: state(0), checkpointInterval: 2 }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED', details: { persistenceState: 'unknown', rollbackAttempted: true } } });
    expect(originalChat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reports unknown persistence when compensation save rejects after a chat switch', async () => {
    const originalChat = [message()];
    const otherChat = [message()];
    let chat = originalChat;
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockImplementationOnce(async () => {
        chat = otherChat;
        throw new Error('compensation failed after switch');
      });
    const store = new WorldSimulationStore_ACU({
      getChat: () => chat,
      getChatIdentity: current => current === originalChat ? 'chat-a-compensate-reject' : 'chat-b-compensate-reject',
      getIsolationKey: () => '',
      saveChatStrict: save,
    });

    await expect(store.commit({ anchorMessageIndex: 0, recordId: 'compensate-switch-reject', state: state(0), checkpointInterval: 2 }))
      .rejects.toMatchObject({
        error: {
          code: 'WORLD_SIM_PERSIST_FAILED',
          details: {
            persistenceState: 'unknown',
            rollbackAttempted: true,
            rollbackMessage: 'compensation failed after switch',
          },
        },
      });
    expect(originalChat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reports a failed compensation save and restores the original in-memory field', async () => {
    const h = harness();
    h.save.mockRejectedValueOnce(new Error('primary failed')).mockRejectedValueOnce(new Error('compensation failed'));

    await expect(h.store.commit({ anchorMessageIndex: 0, recordId: 'rollback-fails', state: state(0), checkpointInterval: 2 }))
      .rejects.toMatchObject({
        error: {
          code: 'WORLD_SIM_PERSIST_FAILED',
          details: {
            primaryMessage: 'primary failed',
            rollbackMessage: 'compensation failed',
            persistenceState: 'unknown',
            rollbackAttempted: true,
          },
        },
      });
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it('restores the exact JSON-string isolation container after a failed save', async () => {
    const h = harness();
    const original = JSON.stringify({ '': { independentData: { sheet_0: { name: 'string-before-failure' } } } });
    h.chat = [{ TavernDB_ACU_IsolatedData: original }];
    h.save.mockRejectedValueOnce(new Error('string save failed')).mockResolvedValueOnce(undefined);

    await expect(h.store.commit({ anchorMessageIndex: 0, recordId: 'string-rollback', state: state(0), checkpointInterval: 2 }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED' } });
    expect(h.chat[0].TavernDB_ACU_IsolatedData).toBe(original);
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it('continues a queued write after its predecessor fails', async () => {
    const chat = [message(), message()];
    let rejectFirstSave!: (reason?: unknown) => void;
    const firstSave = new Promise<void>((_resolve, reject) => { rejectFirstSave = reject; });
    const save = vi.fn().mockImplementationOnce(() => firstSave).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const dependencies = { getChat: () => chat, getChatIdentity: () => 'queue-recovery', getIsolationKey: () => '', saveChatStrict: save };
    const store = new WorldSimulationStore_ACU(dependencies);
    const first = store.commit({ anchorMessageIndex: 0, recordId: 'failed-first', state: state(0), checkpointInterval: 2 });
    const second = store.commit({ anchorMessageIndex: 1, recordId: 'after-failure', state: state(1), checkpointInterval: 2 });

    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    rejectFirstSave(new Error('first save failed'));
    await expect(first).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED' } });
    await expect(second).resolves.toMatchObject({ id: 'after-failure', kind: 'checkpoint' });
    expect(chat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toBeUndefined();
    expect(chat[1].TavernDB_ACU_IsolatedData[''].worldSimulation.id).toBe('after-failure');
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('rejects a second record at the same anchor instead of overwriting history', async () => {
    const h = harness();
    const original = checkpoint(0, 'original');
    h.chat = [message(original)];
    await expect(h.store.commit({ anchorMessageIndex: 0, recordId: 'replacement', state: state(0, 'new'), checkpointInterval: 2 })).rejects.toMatchObject({ error: { code: 'WORLD_SIM_CONFLICT' } });
    expect(h.chat[0].TavernDB_ACU_IsolatedData[''].worldSimulation).toEqual(original);
  });

  it('serializes same-chat commits across store instances', async () => {
    let chat: any[] = [message()];
    let releaseFirstSave: (() => void) | undefined;
    const firstSave = new Promise<void>(resolve => { releaseFirstSave = resolve; });
    const save = vi.fn().mockImplementationOnce(() => firstSave).mockResolvedValueOnce(undefined);
    const dependencies = { getChat: () => chat, getChatIdentity: () => 'queue-chat', getIsolationKey: () => '', saveChatStrict: save };
    const first = new WorldSimulationStore_ACU(dependencies);
    const second = new WorldSimulationStore_ACU(dependencies);
    const firstCommit = first.commit({ anchorMessageIndex: 0, recordId: 'first', state: state(0), checkpointInterval: 2 });
    const secondCommit = second.commit({ anchorMessageIndex: 0, recordId: 'second', state: state(0, 'ent-second'), checkpointInterval: 2 });
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    releaseFirstSave!();
    await firstCommit;
    await expect(secondCommit).rejects.toMatchObject({ error: { code: 'WORLD_SIM_CONFLICT' } });
    expect(save).toHaveBeenCalledOnce();
    expect(chat[0].TavernDB_ACU_IsolatedData[''].worldSimulation.id).toBe('first');
  });

});
