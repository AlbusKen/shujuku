import { describe, expect, it } from 'vitest';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import {
  assertCurrentWorldSimulationSwipe_ACU,
  captureWorldSimulationSwipeSnapshot_ACU,
  hashWorldSimulationBody_ACU,
  restoreWorldSimulationSwipeSnapshot_ACU,
  resolveActiveWorldSimulationSwipe_ACU,
  writeWorldSimulationSwipeText_ACU,
} from '../../../src/service/simulation/simulation-swipe';

function message(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    message_id: 'ai-7', is_user: false, mes: '第二页', swipe_id: 1,
    swipes: ['第一页', '第二页'],
    swipe_info: [{ note: 'first' }, { note: 'second' }],
    variables: [{ hp: 1 }, { hp: 2 }],
    TavernDB_ACU_IsolatedData: { '': { independentData: {} } },
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try { action(); throw new Error('expected validation error'); } catch (error) {
    expect(error).toBeInstanceOf(WorldSimulationValidationError_ACU);
    expect((error as WorldSimulationValidationError_ACU).error.code).toBe(code);
  }
}

describe('world simulation active swipe identity', () => {
  it('uses message identity, active swipe index, and an exact body hash', () => {
    const value = message({ mes: '\n第二页  \r\n', swipes: ['第一页', '\n第二页  \r\n'] });
    const resolved = resolveActiveWorldSimulationSwipe_ACU(7, value);
    expect(resolved.identity).toEqual({
      messageIndex: 7, messageKey: 'string:ai-7', swipeIndex: 1,
      baseTextHash: hashWorldSimulationBody_ACU('\n第二页  \r\n'),
    });
    expect(hashWorldSimulationBody_ACU('\n第二页  \r\n')).not.toBe(hashWorldSimulationBody_ACU('第二页'));
  });

  it('uses index fallback only when the host message id is absent', () => {
    const resolved = resolveActiveWorldSimulationSwipe_ACU(3, message({ message_id: undefined }));
    expect(resolved.identity.messageKey).toBe('index:3');
  });

  it('rejects invalid pages and current-body divergence without guessing', () => {
    expectCode(() => resolveActiveWorldSimulationSwipe_ACU(1, message({ mes: '用户切换后正文' })), 'WORLD_SIM_CONFLICT');
    expectCode(() => resolveActiveWorldSimulationSwipe_ACU(1, message({ swipe_id: 2 })), 'WORLD_SIM_CONFLICT');
    expectCode(() => resolveActiveWorldSimulationSwipe_ACU(1, message({ swipe_id: undefined })), 'WORLD_SIM_CONFLICT');
  });

  it('rejects user and narrator messages', () => {
    expectCode(() => resolveActiveWorldSimulationSwipe_ACU(1, message({ is_user: true })), 'WORLD_SIM_CONFLICT');
    expectCode(() => resolveActiveWorldSimulationSwipe_ACU(1, message({ extra: { type: 'narrator' } })), 'WORLD_SIM_CONFLICT');
  });

  it('updates and restores only the active page and the isolated-data snapshot', () => {
    const value = message();
    const originalFirstSwipe = value.swipes[0];
    const originalVariables = JSON.parse(JSON.stringify(value.variables));
    const originalSwipeInfo = JSON.parse(JSON.stringify(value.swipe_info));
    const snapshot = captureWorldSimulationSwipeSnapshot_ACU(7, value);
    writeWorldSimulationSwipeText_ACU(snapshot, '系统投影后的第二页');
    value.TavernDB_ACU_IsolatedData[''].worldSimulation = { id: 'candidate' };

    expect(value.mes).toBe('系统投影后的第二页');
    expect(value.swipes).toEqual(['第一页', '系统投影后的第二页']);
    expect(value.swipes[0]).toBe(originalFirstSwipe);
    expect(value.variables).toEqual(originalVariables);
    expect(value.swipe_info).toEqual(originalSwipeInfo);

    restoreWorldSimulationSwipeSnapshot_ACU(snapshot);
    expect(value.mes).toBe('第二页');
    expect(value.swipes).toEqual(['第一页', '第二页']);
    expect(value.TavernDB_ACU_IsolatedData).toEqual({ '': { independentData: {} } });
  });

  it('marks a post-capture user edit or swipe selection as stale', () => {
    const value = message();
    const snapshot = captureWorldSimulationSwipeSnapshot_ACU(7, value);
    value.mes = '用户编辑后的正文';
    value.swipes[1] = '用户编辑后的正文';
    expectCode(() => assertCurrentWorldSimulationSwipe_ACU(snapshot), 'WORLD_SIM_STALE');
  });
});
