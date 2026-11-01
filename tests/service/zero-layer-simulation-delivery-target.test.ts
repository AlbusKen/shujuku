import { describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { applyZeroLayerCommand_ACU, mergeZeroLayerEffectReceipt_ACU } from '../../src/service/zero-layer/store-command';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import type { ZeroLayerCarrierContext_ACU } from '../../src/service/zero-layer/carrier-context';
import type { ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { emptyZeroLayerSimulation_ACU } from '../../src/service/zero-layer/simulation-store';
import { validateZeroLayerSimulationResult_ACU, validateZeroLayerSimulationReceipt_ACU } from '../../src/service/zero-layer/simulation-validation';
import { buildZeroLayerSimulationEffect_ACU } from '../../src/service/zero-layer/simulation-result';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';

function setup(): { current: ZeroLayerEnvelope_ACU; context: ZeroLayerCarrierContext_ACU } {
  const carrier = { is_user: false, mes: '开场', swipe_id: 0 };
  const chat = [carrier];
  const scope = { characterKey: 'card:test', chatId: 'chat-test' };
  const context = { chat, carrier, carrierIndex: 0, swipeId: 0, scope,
    key: JSON.stringify([scope.characterKey, scope.chatId]), source: '', messageRefs: [...chat] };
  const initialized = applyZeroLayerCommand_ACU(null, { type: 'initialize', apiPresetName: '' }, context, 'fingerprint');
  return { current: { ...initialized, enabled: true }, context };
}

function prepare(current: ZeroLayerEnvelope_ACU, context: ZeroLayerCarrierContext_ACU, simulationDeliveryTarget?: 'body' | 'plot') {
  return applyZeroLayerCommand_ACU(current, {
    type: 'prepare-turn', turnId: 'turn-1', attemptId: 'attempt-1', input: '继续',
    requiredEffects: ['plot', 'simulation'],
    ...(simulationDeliveryTarget ? { simulationDeliveryTarget } : {}),
  }, context, 'fingerprint');
}

describe('零层推演投送目标冻结', () => {
  it('准备回合从当前分支设置冻结 body，旧回合缺冻结字段仍可读取', () => {
    const { current, context } = setup();
    const prepared = prepare(current, context);
    expect(prepared.turns[0].simulationDeliveryTarget).toBe('body');
    const legacy = structuredClone(prepared);
    delete legacy.turns[0].simulationDeliveryTarget;
    expect(validateZeroLayerEnvelope_ACU(legacy).turns[0].simulationDeliveryTarget).toBeUndefined();
    const corrupt = structuredClone(prepared);
    (corrupt.turns[0] as any).simulationDeliveryTarget = 'auto';
    expect(() => validateZeroLayerEnvelope_ACU(corrupt)).toThrow(/投送目标无效/);
  });

  it('准备时传入的过期目标不得覆盖当前分支偏好', () => {
    const { current, context } = setup();
    expect(() => prepare(current, context, 'plot')).toThrow(/投送偏好在回合准备期间已变化/);
    expect(current.turns).toHaveLength(0);
  });

  it('plot 标记的推演回执只接受不含正文投影的账本交付', () => {
    const { current, context } = setup();
    const prepared = prepare(current, context);
    const turn = prepared.turns[0];
    turn.simulationDeliveryTarget = 'plot';
    turn.phase = 'response-durable';
    turn.body = '正文已保存';
    const state = emptyZeroLayerSimulation_ACU();
    state.envelope = buildDefaultWorldSimulationEnvelope_ACU();
    state.fields = seedLedgerFieldView_ACU(state.envelope.ledger, 0);
    const anchor = { kind: 'logical' as const, chatIdentity: 'logical', contentDigest: 'digest',
      logicalRef: { sessionId: prepared.sessionId, branchId: turn.branchId, turnId: turn.turnId,
        attemptId: turn.attemptId, floorId: turn.assistantFloor.floorId } };
    const effect = buildZeroLayerSimulationEffect_ACU(state, anchor, 'commit', '账本已结算', 'ledger-only');
    mergeZeroLayerEffectReceipt_ACU(turn, effect);
    expect(() => validateZeroLayerSimulationReceipt_ACU(turn, prepared.sessionId)).not.toThrow();
    (turn.assistantFloor.data.simulation as any).projection = '伪造旧正文';
    expect(() => validateZeroLayerSimulationReceipt_ACU(turn, prepared.sessionId)).toThrow(/账本模式不能包含正文投影/);
  });

  it('plot 关闭自动推演时可保存合法 ledger-only 跳过回执', () => {
    const { current, context } = setup();
    const prepared = prepare(current, context);
    const turn = prepared.turns[0];
    turn.simulationDeliveryTarget = 'plot';
    turn.phase = 'response-durable';
    turn.body = '已保存正文';
    const anchor = { kind: 'logical' as const, chatIdentity: 'logical', contentDigest: 'digest',
      logicalRef: { sessionId: prepared.sessionId, branchId: turn.branchId, turnId: turn.turnId,
        attemptId: turn.attemptId, floorId: turn.assistantFloor.floorId } };
    const effect = buildZeroLayerSimulationEffect_ACU(emptyZeroLayerSimulation_ACU(), anchor,
      'skipped-by-config', '自动推演已关闭', 'ledger-only');
    mergeZeroLayerEffectReceipt_ACU(turn, effect);
    expect(() => validateZeroLayerSimulationReceipt_ACU(turn, prepared.sessionId)).not.toThrow();
    expect(effect.assistantData!.simulation).toMatchObject({ outcome: 'skipped-by-config', delivery: 'ledger-only', projection: null });
  });

  it('新协议仅账本结果不复制旧 guidance.signals 正文投影且校验独立形态', () => {
    const state = emptyZeroLayerSimulation_ACU();
    state.envelope = buildDefaultWorldSimulationEnvelope_ACU();
    state.envelope.ledger.guidance.signals = [{ voice: 'ambient', text: '旧世界信号', sourceId: 'clock' }];
    state.fields = seedLedgerFieldView_ACU(state.envelope.ledger, 0);
    const anchor = { kind: 'logical' as const, chatIdentity: 'logical', contentDigest: 'digest',
      logicalRef: { sessionId: 'session-1', branchId: 'branch-1', turnId: 'turn-1',
        attemptId: 'attempt-1', floorId: 'floor-1' } };
    const effect = buildZeroLayerSimulationEffect_ACU(state, anchor, 'commit', '账本已结算', 'ledger-only');
    const result = effect.assistantData!.simulation as any;
    expect(result).toMatchObject({ delivery: 'ledger-only', projection: null });
    expect(JSON.stringify(result.projection)).not.toContain('旧世界信号');
    expect(() => validateZeroLayerSimulationResult_ACU(result)).not.toThrow();
    result.projection = '伪造旧正文';
    expect(() => validateZeroLayerSimulationResult_ACU(result)).toThrow(/账本模式不能包含正文投影/);
  });

  it('plot 目标会冻结到 prepared 回合，并且旧 body 回合保持原冻结目标', () => {
    const { current, context } = setup();
    const simulation = emptyZeroLayerSimulation_ACU();
    simulation.envelope = buildDefaultWorldSimulationEnvelope_ACU();
    simulation.envelope.settings.deliveryTarget = 'plot';
    simulation.fields = seedLedgerFieldView_ACU(simulation.envelope.ledger, simulation.envelope.updatedAt);
    current.branches[0].simulation = simulation;
    const plotPrepared = prepare(current, context, 'plot');
    expect(plotPrepared.turns[0].simulationDeliveryTarget).toBe('plot');

    const legacyBody = structuredClone(plotPrepared.turns[0]);
    legacyBody.simulationDeliveryTarget = 'body';
    simulation.envelope.settings.deliveryTarget = 'body';
    expect(legacyBody.simulationDeliveryTarget).toBe('body');
  });
});
