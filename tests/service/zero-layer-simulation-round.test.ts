import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { commitZeroLayerSimulationFields_ACU, commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { emptyZeroLayerSimulation_ACU, type ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { mergeZeroLayerEffectReceipt_ACU } from '../../src/service/zero-layer/store-command';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { sha256HexSync_ACU } from '../../src/shared/sha256-sync';
import type { WorldRoundCandidate_ACU } from '../../src/service/simulation/world-candidate';
import type { ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';

function setup() {
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const state = emptyZeroLayerSimulation_ACU();
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'card-1' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '开场', activationFingerprint: 'fingerprint',
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 0,
    activeBranchId: 'branch-1', branches: [{ branchId: 'branch-1', headTurnId: null, simulation: state }],
    turns: [{ turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1',
      input: '继续', body: '主角在广场等待', phase: 'response-durable', createdAt: 1, updatedAt: 1,
      userFloor: { floorId: 'user-1', role: 'user', data: {} },
      assistantFloor: { floorId: 'floor-1', role: 'assistant', data: {} },
      simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [], errorCode: null }],
  };
  const anchor = { kind: 'logical' as const, chatIdentity: 'logical-chat', contentDigest: sha256HexSync_ACU(source.turns[0].body!),
    logicalRef: { sessionId: 'session-1', branchId: 'branch-1', turnId: 'turn-1', attemptId: 'attempt-1', floorId: 'floor-1' } };
  const identity = { runId: 'run-1', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, kind: 'logical' as const, logicalRef: anchor.logicalRef,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'task-1', stageId: 'stage-1', stageRevision: 1, deliveryTarget: 'body' as const,
    workflowMode: 'layered' as const, workflowProtocol: 'world-round-v1' as const };
  envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1,
    updatedAt: 1, activeRun: identity, stopReason: null };
  envelope.activeStageId = identity.stageId;
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
    revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
      plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [],
        plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [],
        blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
  state.envelope = envelope;
  state.fields = seedLedgerFieldView_ACU(envelope.ledger, 1);
  const input: { identity: typeof identity; anchor: typeof anchor; roundCandidate: WorldRoundCandidate_ACU;
    completedAt: number; timelineId: string; summary: string } = {
    identity, anchor, completedAt: 10, timelineId: 'timeline-1', summary: '账本结算',
    roundCandidate: { baseRevision: 0, candidateClock: { ...envelope.ledger.clock, day: 2 },
      worldEventWrites: [], actorWrites: [], factWrites: [], historyMilestoneWrites: [], actorCompletions: [],
      projection: { anchor: null, deliveries: [] }, completion: 'changed' },
  };
  let committed = source;
  let writes = 0;
  let failSave = false;
  const store = {
    sessionId: source.sessionId, branchId: source.activeBranchId,
    assertAnchor: (value: typeof anchor, candidate = committed) => {
      if (value.logicalRef.turnId !== candidate.turns[0].turnId || value.contentDigest !== sha256HexSync_ACU(candidate.turns[0].body!)) {
        throw new Error('锚点变化');
      }
    },
    readSource: () => committed,
    readState: () => committed.branches[0].simulation!,
    updateState: async (mutator: (state: typeof state, source: ZeroLayerEnvelope_ACU) => void,
      effect?: (candidate: ZeroLayerEnvelope_ACU) => any) => {
      const candidate = structuredClone(committed);
      mutator(candidate.branches[0].simulation!, candidate);
      const receipt = effect?.(candidate);
      if (receipt) mergeZeroLayerEffectReceipt_ACU(candidate.turns[0], receipt);
      candidate.revision += 1;
      validateZeroLayerEnvelope_ACU(candidate);
      writes += 1;
      if (failSave) throw new Error('模拟保存失败，结果未知');
      committed = candidate;
    },
  } as unknown as ZeroLayerSimulationStore_ACU;
  return { store, input, getSource: () => committed, getWrites: () => writes, fail: () => { failSave = true; } };
}

describe('零层新候选的载体装配（模拟写队列，不代表宿主落盘）', () => {
  it('账本、栏目视图与 ledger-only 回执作为一个候选通过结构校验', async () => {
    const f = setup();
    await commitZeroLayerSimulationRound_ACU(f.store, f.input);
    const source = f.getSource();
    expect(f.getWrites()).toBe(1);
    expect(source.branches[0].simulation?.envelope?.ledger.clock.day).toBe(2);
    expect(source.branches[0].simulation?.confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(source.turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'ledger-only', projection: null });
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toBeTruthy();
    expect(f.getWrites()).toBe(1);
  });

  it('旧身份或协议调包不能提交新候选', async () => {
    const f = setup();
    const oldIdentity = { ...f.input.identity } as any;
    delete oldIdentity.workflowProtocol;
    await expect(commitZeroLayerSimulationRound_ACU(f.store, { ...f.input, identity: oldIdentity })).rejects.toThrow(/运行租约|协议/);
    expect(f.getWrites()).toBe(0);
  });

  it('持久新协议即使伪造身份删除字段也不能经零层逐栏 SQL 写入', async () => {
    const f = setup();
    const forged = { ...f.input.identity } as any;
    delete forged.workflowProtocol;
    const before = structuredClone(f.getSource());
    await expect(commitZeroLayerSimulationFields_ACU(f.store, {
      identity: forged, anchor: f.input.anchor, role: 'undercurrent-analyst',
      sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0)",
      evidenceRegistry: { runId: forged.runId, entries: [] },
    } as any)).rejects.toThrow(/新协议/);
    expect(f.getSource()).toEqual(before);
    expect(f.getWrites()).toBe(0);
  });

  it('候选缺少 active 人物覆盖证明时不进入保存阶段', async () => {
    const f = setup();
    const actor = { id: 'actor-1', name: '人物', interests: [], location: '', locationRef: null,
      life: 'alive' as const, diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
      informationSources: [], knownFacts: [], visibility: 'hidden' as const, currentAction: null, longTermAction: null,
      shortTermAction: null, simulationStatus: 'active' as const, loreRefs: [], experiences: [], revision: 1 };
    f.getSource().branches[0].simulation!.envelope!.ledger.actors = [actor];
    f.getSource().branches[0].simulation!.fields = seedLedgerFieldView_ACU(f.getSource().branches[0].simulation!.envelope!.ledger, 1);
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toThrow(/缺少本轮覆盖证明/);
    expect(f.getSource().branches[0].simulation!.envelope!.ledger.clock.day).toBe(1);
    expect(f.getWrites()).toBe(0);
  });

  it('模拟保存异常不把内存候选当已提交账本', async () => {
    const f = setup();
    f.fail();
    await expect(commitZeroLayerSimulationRound_ACU(f.store, f.input)).rejects.toThrow(/结果未知/);
    expect(f.getSource().branches[0].simulation!.envelope!.ledger.clock.day).toBe(1);
    expect(f.getSource().turns[0].effectReceipts).toEqual([]);
  });
});
