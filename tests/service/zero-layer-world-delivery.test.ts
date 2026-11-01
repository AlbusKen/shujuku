import { describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));
import { applyZeroLayerCommand_ACU } from '../../src/service/zero-layer/store-command';
import type { ZeroLayerCarrierContext_ACU } from '../../src/service/zero-layer/carrier-context';
import type { ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { sha256HexSync_ACU } from '../../src/shared/sha256-sync';

function setup(): { current: ZeroLayerEnvelope_ACU; context: ZeroLayerCarrierContext_ACU } {
  const carrier = { is_user: false, mes: '开场', swipe_id: 0 };
  const chat = [carrier];
  const scope = { characterKey: 'card:test', chatId: 'chat-test' };
  const context = { chat, carrier, carrierIndex: 0, swipeId: 0, scope,
    key: JSON.stringify([scope.characterKey, scope.chatId]), source: '', messageRefs: [...chat] };
  const current = applyZeroLayerCommand_ACU(null, { type: 'initialize', apiPresetName: '' }, context, 'fingerprint');
  current.enabled = true;
  const prepared = applyZeroLayerCommand_ACU(current, {
    type: 'prepare-turn', turnId: 'turn-1', attemptId: 'attempt-1', input: '继续', requiredEffects: [],
  }, context, 'fingerprint');
  return { current: prepared, context };
}

function intent(current: ZeroLayerEnvelope_ACU) {
  const turn = current.turns[0];
  const source = { kind: 'logical' as const, chatIdentity: 'source',
    logicalRef: { sessionId: 's', branchId: 'b', turnId: 'old', attemptId: 'old-a', floorId: 'old-floor' },
    contentDigest: 'a'.repeat(64) };
  const target = { kind: 'logical' as const,
    chatIdentity: JSON.stringify(['zero-layer-simulation', JSON.stringify(['card:test', 'chat-test']), current.sessionId, turn.branchId]),
    logicalRef: { sessionId: current.sessionId, branchId: turn.branchId, turnId: turn.turnId,
      attemptId: turn.attemptId, floorId: turn.assistantFloor.floorId }, contentDigest: sha256HexSync_ACU(turn.input) };
  const manifest = { schemaVersion: 1 as const, sourceAnchor: source, targetAnchor: target,
    ledgerRevision: 2, ledgerFingerprint: 'b'.repeat(64), factIds: ['fact-1'],
    sceneLocation: { region: '城内', place: '广场' }, time: { day: 2, slot: '' },
    marker: '[[ACU_PLOT_CAUSAL_FACTS:12345678-1234-1234-1234-123456789012]]', messageFingerprint: 'c'.repeat(64) };
  turn.plotCandidate = { floorId: turn.userFloor.floorId, presetName: 'p', outcome: 'generated',
    finalMessage: `${manifest.marker}\n场景事实`, content: '剧情', taskContents: {}, finalPrompts: [], filterEntries: [], agentActive: true,
    causalDelivery: manifest } as any;
  return { deliveryId: manifest.marker, target: 'plot' as const, source, ledgerRevision: 2,
    ledgerFingerprint: manifest.ledgerFingerprint, factIds: ['fact-1'], requestFingerprint: 'd'.repeat(64), createdAt: 1 };
}

describe('零层世界投递命令守卫', () => {
  it('拒绝 caller 自传的投递 intent，未附经过桥验证的冻结基底不能 mint 生命周期', () => {
    const { current, context } = setup();
    const forged = intent(current);
    expect(() => applyZeroLayerCommand_ACU(current, { type: 'record-world-delivery-attempt',
      turnId: 'turn-1', attemptId: 'attempt-1', intent: forged }, context, 'fingerprint')).toThrow(/持久回执|冻结账本|已验证/);
  });

  it('未知发送只能从已开始投递标记，不能取消后自动重试', () => {
    const { current, context } = setup();
    expect(() => applyZeroLayerCommand_ACU(current, { type: 'record-world-delivery-unknown',
      turnId: 'turn-1', attemptId: 'attempt-1', deliveryId: 'unknown' }, context, 'fingerprint')).toThrow(/已开始/);
  });
});
