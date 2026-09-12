import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, WORLD_SIMULATION_DEFAULT_BUDGETS_ACU, WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU } from '../../../src/service/simulation/defaults';
import { createWorldSimError_ACU, describeWorldEntityKind_ACU, describeWorldThreadStatus_ACU, describeWorldVisibility_ACU, isWorldEntity_ACU, isWorldEvent_ACU, isWorldStableId_ACU, isWorldStoryClock_ACU, isWorldThread_ACU, isWorldVisibility_ACU, type WorldSimulationErrorCode_ACU, type WorldStoryClock_ACU, type WorldThreadStatus_ACU } from '../../../src/service/simulation/model';

const WORLD_SIMULATION_ERROR_CODES_ACU: Record<WorldSimulationErrorCode_ACU, true> = {
  WORLD_SIM_GATE_FAILED: true,
  WORLD_SIM_PROTOCOL_INVALID: true,
  WORLD_SIM_STALE: true,
  WORLD_SIM_CONFLICT: true,
  WORLD_SIM_REBASE_REQUIRED: true,
  WORLD_SIM_REBASE_REJECTED: true,
  WORLD_SIM_JOIN_TIMEOUT: true,
  WORLD_SIM_BUDGET_EXCEEDED: true,
  WORLD_SIM_PERSIST_FAILED: true,
  WORLD_SIM_INJECTION_FAILED: true,
  WORLD_SIM_READ_FAILED: true,
};

describe('world simulation model', () => {
  it('uses the designed three-tier budget table without sharing mutable defaults', () => {
    expect(WORLD_SIMULATION_DEFAULT_BUDGETS_ACU).toEqual({
      light: { maxIterations: 1, maxDelegations: 0, maxReads: 2, readTokenBudget: 'low' },
      normal: { maxIterations: 3, maxDelegations: 2, maxReads: 6, readTokenBudget: 'medium' },
      deep: { maxIterations: 5, maxDelegations: 4, maxReads: 12, readTokenBudget: 'high' },
    });
    const first = buildDefaultWorldSimulationSettings_ACU();
    const second = buildDefaultWorldSimulationSettings_ACU();
    first.budgets.deep.maxReads = 0;
    expect(second.budgets.deep.maxReads).toBe(12);
    expect(first).toMatchObject({ enabled: false, joinWaitMs: WORLD_SIMULATION_MAX_JOIN_WAIT_MS_ACU, minFloorGap: 1, checkpointInterval: 20, maxTrackedEntities: 12, visibilityPolicy: 'agent', showHiddenInUi: false });
  });

  it('validates clock precision and visibility discriminants', () => {
    const unknown: WorldStoryClock_ACU = { anchorText: '不明', elapsedSinceLastRun: '未知', precision: 'unknown', evidenceIndexes: [], updatedIndex: 2 };
    expect(isWorldStoryClock_ACU(unknown)).toBe(true);
    expect(isWorldStoryClock_ACU({ ...unknown, precision: 'guess' })).toBe(false);
    expect(isWorldStoryClock_ACU({ ...unknown, evidenceIndexes: [1.5] })).toBe(false);
    expect(isWorldStoryClock_ACU({ ...unknown, updatedIndex: '2' })).toBe(false);
    expect(isWorldVisibility_ACU({ mode: 'hidden' })).toBe(true);
    expect(isWorldVisibility_ACU({ mode: 'rumored', reason: '酒客传言' })).toBe(true);
    expect(isWorldVisibility_ACU({ mode: 'revealed', revealedIndex: 7 })).toBe(true);
    expect(isWorldVisibility_ACU({ mode: 'revealed', revealedIndex: -1 })).toBe(false);
    expect(isWorldVisibility_ACU({ mode: 'hidden', reason: 1 })).toBe(false);
    expect(isWorldVisibility_ACU({ mode: 'unknown' })).toBe(false);
    expect(['character', 'faction', 'location'].map(describeWorldEntityKind_ACU)).toEqual(['角色', '势力', '地点']);
    expect([
      { mode: 'hidden' as const },
      { mode: 'rumored' as const, reason: '酒客传言' },
      { mode: 'revealed' as const, revealedIndex: 7 },
    ].map(describeWorldVisibility_ACU)).toEqual(['暗线', '传闻层', '已揭示']);
    const statuses: readonly WorldThreadStatus_ACU[] = ['brewing', 'active', 'converging', 'closed'];
    expect(statuses.map(describeWorldThreadStatus_ACU)).toEqual(['酝酿中', '推进中', '收束中', '已结束']);
  });

  it('accepts only canonical stable ids across entities, events, threads, and references', () => {
    const entity = { id: 'ent-1', kind: 'character' as const, name: '角色', importance: 'active' as const, situation: '待命', agenda: '观察', lastMovedIndex: 1, lastMovedAt: '第一日', visibility: { mode: 'hidden' as const }, retired: false, updatedIndex: 1 };
    const event = { id: 'evt-1', summary: '事件', actorIds: ['ent-1'], occurredIndex: 1, occurredAt: '第一日', visibility: { mode: 'rumored' as const }, retired: false, updatedIndex: 1 };
    const thread = { id: 'thr-1', title: '线索', status: 'active' as const, summary: '持续', visibility: { mode: 'hidden' as const }, relatedEventIds: ['evt-1'], retired: false, updatedIndex: 1 };
    expect(isWorldStableId_ACU('ent-1')).toBe(true);
    expect(isWorldStableId_ACU(' ent-1 ')).toBe(false);
    expect(isWorldStableId_ACU('')).toBe(false);
    expect(isWorldEntity_ACU(entity)).toBe(true);
    expect(isWorldEntity_ACU({ ...entity, id: ' ent-1 ' })).toBe(false);
    expect(isWorldEvent_ACU(event)).toBe(true);
    expect(isWorldEvent_ACU({ ...event, id: ' evt-1 ' })).toBe(false);
    expect(isWorldEvent_ACU({ ...event, actorIds: [' ent-1 '] })).toBe(false);
    expect(isWorldThread_ACU(thread)).toBe(true);
    expect(isWorldThread_ACU({ ...thread, id: ' thr-1 ' })).toBe(false);
    expect(isWorldThread_ACU({ ...thread, relatedEventIds: [' evt-1 '] })).toBe(false);
    expect(isWorldThread_ACU({ ...thread, visibility: undefined })).toBe(false);
  });

  it('creates every plan-defined error code without losing structured diagnostics', () => {
    const codes = Object.keys(WORLD_SIMULATION_ERROR_CODES_ACU) as WorldSimulationErrorCode_ACU[];
    expect(codes).toHaveLength(11);
    for (const code of codes) {
      const error = createWorldSimError_ACU(code, 'protocol', '结构化原因', code === 'WORLD_SIM_PROTOCOL_INVALID', { code });
      expect(error).toEqual({ code, phase: 'protocol', message: '结构化原因', retryable: code === 'WORLD_SIM_PROTOCOL_INVALID', details: { code } });
    }
  });
});
