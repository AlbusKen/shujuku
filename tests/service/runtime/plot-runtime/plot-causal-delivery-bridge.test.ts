import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { reviewWorldNarrativeScene_ACU } from '../../../../src/service/simulation/agent/world-scene-review';
import {
  attachPreparedPlotCausalDelivery_ACU,
  canonicalPlotDeliveryJson_ACU,
  claimPlotCausalDelivery_ACU,
  preparePlotCausalDelivery_ACU,
  readPreparedPlotCausalDelivery_ACU,
  restorePreparedPlotCausalDelivery_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-causal-delivery-bridge';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';

const ANCHOR_TEXT = '主角在钟楼广场当面遇到了守卫。';
const CLOCK_SQUARE = { region: '城区', place: '钟楼广场' };
const DOCK = { region: '港区', place: '港口仓库' };
const SAFE_FACT = '钟楼广场的守卫确认城门已经关闭。';
const LOCKED_SECRET = 'LOCKED_SECRET_守卫携带密钥。';
const INTERNAL_SECRET = 'INTERNAL_SECRET_暗门已打开。';
const OTHER_PLACE_SECRET = 'OTHER_PLACE_SECRET_港口仓库被封锁。';
const CROSS_DAY_GATED_SECRET = 'CROSS_DAY_GATED_SECRET_守卫已交出密钥。';
const FUTURE_GATED_SECRET = 'FUTURE_GATED_SECRET_明日才会发生的秘密。';

function anchor(turnId: string, attemptId: string, floorId: string, text = ANCHOR_TEXT) {
  return {
    kind: 'logical' as const,
    chatIdentity: 'chat-1',
    contentDigest: sha256HexSync_ACU(text),
    logicalRef: { sessionId: 'session-1', branchId: 'branch-1', turnId, attemptId, floorId },
  };
}

function fact(
  id: string,
  summary: string,
  locationRef: typeof CLOCK_SQUARE,
  projectionPolicy: 'scene' | 'gated' | 'internal',
  revealState: 'locked' | 'unlocked',
  happenedAt = { day: 7, slot: '夜' },
) {
  return {
    id, summary, temporalKind: 'occurrence' as const,
    happenedAt, validFrom: null, validUntil: null, locationRef, actorIds: ['guard'],
    worldEventIds: [], projectionPolicy, revealState, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  };
}

function ledger() {
  const current = buildEmptyWorldSimulationLedger_ACU();
  current.revision = 4;
  current.clock = { day: 7, slot: '夜', storyTime: '第七日夜', precision: 'exact', evidenceRefs: [] };
  current.player.location = CLOCK_SQUARE;
  current.actors = [{
    id: 'guard', name: '守卫', interests: [], location: '钟楼广场', locationRef: CLOCK_SQUARE, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
    currentAction: null, longTermAction: null, shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
  }];
  current.facts = [
    fact('safe-local', SAFE_FACT, CLOCK_SQUARE, 'scene', 'unlocked'),
    fact('cross-day-gated', CROSS_DAY_GATED_SECRET, CLOCK_SQUARE, 'gated', 'unlocked', { day: 6, slot: '夜' }),
    fact('cross-day-scene', 'CROSS_DAY_SCENE_昨日的场景事实。', CLOCK_SQUARE, 'scene', 'unlocked', { day: 6, slot: '夜' }),
    fact('locked-local', LOCKED_SECRET, CLOCK_SQUARE, 'gated', 'locked'),
    fact('internal-local', INTERNAL_SECRET, CLOCK_SQUARE, 'internal', 'unlocked'),
    fact('future-gated', FUTURE_GATED_SECRET, CLOCK_SQUARE, 'gated', 'unlocked', { day: 8, slot: '晨' }),
    fact('safe-other-place', OTHER_PLACE_SECRET, DOCK, 'gated', 'unlocked'),
  ];
  return current;
}

async function preparedDelivery(selectedFactIds = ['safe-other-place', 'internal-local', 'locked-local', 'safe-local']) {
  const currentLedger = ledger();
  const sourceAnchor = anchor('source-turn', 'source-attempt', 'source-floor');
  const targetAnchor = anchor('target-turn', 'target-attempt', 'target-floor', '未来用户输入');
  const review = await reviewWorldNarrativeScene_ACU({
    ledger: currentLedger, anchor: sourceAnchor, anchorText: ANCHOR_TEXT, signal: new AbortController().signal,
    assertCurrent: () => undefined, countTokens: async text => Math.max(1, Math.ceil(text.length / 8)),
    needsSemanticReview: false,
    invoke: async () => JSON.stringify({
      locationRef: CLOCK_SQUARE, contactedActorIds: ['guard'],
      evidence: [
        { kind: 'location', actorId: null, quote: '钟楼广场' },
        { kind: 'contact', actorId: 'guard', quote: '当面遇到了守卫' },
      ],
      reviews: [],
    }),
  });
  const delivery = preparePlotCausalDelivery_ACU({
    ledger: currentLedger, sourceAnchor, targetAnchor, anchorText: ANCHOR_TEXT,
    selectedFactIds, sceneReceipt: review.receipt,
    signal: new AbortController().signal, assertCurrent: () => undefined,
  });
  expect(delivery).not.toBeNull();
  return { ledger: currentLedger, sourceAnchor, targetAnchor, delivery: delivery!, review };
}

function candidateFrom(delivery: { message: string; manifest: object }, includeManifest = false) {
  const candidate: { finalMessage: string; causalDelivery?: any } = { finalMessage: `公开剧情。\n\n${delivery.message}` };
  if (includeManifest) candidate.causalDelivery = structuredClone(delivery.manifest);
  return candidate;
}

function attachedCandidateFrom(delivery: { message: string; manifest: object }) {
  const candidate = candidateFrom(delivery);
  attachPreparedPlotCausalDelivery_ACU(candidate, delivery.manifest as any);
  expect(candidate.causalDelivery).toBeDefined();
  return candidate;
}

function payload(finalMessage: string, extra: Record<string, unknown> = {}) {
  return {
    messages: [{ role: 'user', content: '原始用户请求' }, { role: 'system', content: finalMessage }],
    model: 'test-model', _acu_zero_layer_attempt_id: 'ephemeral-attempt', ...extra,
  };
}

describe('剧情因果交付桥', () => {
  it('真实 scene receipt 到 prepare、attach/read、claim 和 restore 全链路只交付同地解锁 scene 事实', async () => {
    const { ledger: currentLedger, sourceAnchor, targetAnchor, delivery } = await preparedDelivery();

    expect(delivery.manifest.factIds).toEqual(['safe-local']);
    expect(delivery.message).toContain(SAFE_FACT);
    expect(delivery.message).not.toContain(LOCKED_SECRET);
    expect(delivery.message).not.toContain(INTERNAL_SECRET);
    expect(delivery.message).not.toContain(OTHER_PLACE_SECRET);

    const candidate = candidateFrom(delivery);
    expect(() => attachPreparedPlotCausalDelivery_ACU(candidate, structuredClone(delivery.manifest))).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');
    attachPreparedPlotCausalDelivery_ACU(candidate, delivery.manifest);
    const capability = readPreparedPlotCausalDelivery_ACU(candidate);
    expect(capability).not.toBeNull();

    const firstPayload = payload(candidate.finalMessage!);
    const claimed = claimPlotCausalDelivery_ACU(capability!, {
      targetAnchor, finalMessage: candidate.finalMessage, payload: firstPayload,
    });
    const expectedPayload = structuredClone(firstPayload);
    delete (expectedPayload as any)._acu_zero_layer_attempt_id;
    expect(claimed.requestFingerprint).toBe(sha256HexSync_ACU(canonicalPlotDeliveryJson_ACU(expectedPayload)));
    expect(claimed.factIds).toEqual(['safe-local']);

    const restored = structuredClone(candidate);
    const restoredCapability = restorePreparedPlotCausalDelivery_ACU(restored, {
      ledger: currentLedger, sourceAnchor, targetAnchor, finalMessage: restored.finalMessage,
    });
    expect(readPreparedPlotCausalDelivery_ACU(restored)).toBe(restoredCapability);
    expect(() => restorePreparedPlotCausalDelivery_ACU(restored, {
      ledger: currentLedger, sourceAnchor, targetAnchor, finalMessage: restored.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');
  });

  it('跨日已解锁 gated 事实可经真实 prepare bridge 和 claim 投送，scene 与不可用事实仍拒绝', async () => {
    const { targetAnchor, delivery } = await preparedDelivery([
      'safe-other-place', 'future-gated', 'internal-local', 'locked-local', 'cross-day-scene', 'cross-day-gated',
    ]);

    expect(delivery.manifest.factIds).toEqual(['cross-day-gated']);
    expect(delivery.message).toContain(CROSS_DAY_GATED_SECRET);
    expect(delivery.message).not.toContain('CROSS_DAY_SCENE_昨日的场景事实。');
    expect(delivery.message).not.toContain(LOCKED_SECRET);
    expect(delivery.message).not.toContain(INTERNAL_SECRET);
    expect(delivery.message).not.toContain(FUTURE_GATED_SECRET);
    expect(delivery.message).not.toContain(OTHER_PLACE_SECRET);

    const candidate = attachedCandidateFrom(delivery);
    const capability = readPreparedPlotCausalDelivery_ACU(candidate)!;
    const claimed = claimPlotCausalDelivery_ACU(capability, {
      targetAnchor, finalMessage: candidate.finalMessage, payload: payload(candidate.finalMessage!),
    });
    expect(claimed.factIds).toEqual(['cross-day-gated']);
  });

  it('内部选择可包含真实冷层 ID，但 bridge 只投送仍为热层的事实，并以冷层替代关系排除旧事实', async () => {
    const currentLedger = ledger();
    currentLedger.factArchive = [
      fact('cold-internal', 'COLD_INTERNAL_只供内部因果选择。', CLOCK_SQUARE, 'internal', 'locked'),
      fact('cold-replacement', 'COLD_REPLACEMENT_替代既有公开事实。', CLOCK_SQUARE, 'internal', 'locked'),
    ];
    currentLedger.factArchive[1].supersedesFactIds = ['safe-local'];
    const sourceAnchor = anchor('source-turn', 'source-attempt', 'source-floor');
    const targetAnchor = anchor('target-turn', 'target-attempt', 'target-floor', '未来用户输入');
    const review = await reviewWorldNarrativeScene_ACU({ ledger: currentLedger, anchor: sourceAnchor, anchorText: ANCHOR_TEXT,
      signal: new AbortController().signal, assertCurrent: () => undefined, countTokens: async () => 1, needsSemanticReview: false,
      invoke: async () => JSON.stringify({ locationRef: CLOCK_SQUARE, contactedActorIds: ['guard'], evidence: [
        { kind: 'location', actorId: null, quote: '钟楼广场' }, { kind: 'contact', actorId: 'guard', quote: '当面遇到了守卫' },
      ], reviews: [] }), });
    const delivery = preparePlotCausalDelivery_ACU({ ledger: currentLedger, sourceAnchor, targetAnchor, anchorText: ANCHOR_TEXT,
      selectedFactIds: ['cold-internal', 'safe-local', 'cross-day-gated'], sceneReceipt: review.receipt,
      signal: new AbortController().signal, assertCurrent: () => undefined });
    expect(delivery?.manifest.factIds).toEqual(['cross-day-gated']);
    expect(delivery?.message).not.toContain('COLD_INTERNAL');
    expect(delivery?.message).not.toContain(SAFE_FACT);
  });

  it('跨 target、同 revision 的账本漂移与输出安全块篡改都拒绝 restore', async () => {
    const { ledger: currentLedger, sourceAnchor, targetAnchor, delivery } = await preparedDelivery();
    const alternateTarget = anchor('other-target', 'other-attempt', 'other-floor', '其他未来输入');

    const crossTarget = structuredClone(candidateFrom(delivery));
    crossTarget.causalDelivery = structuredClone(delivery.manifest);
    expect(() => restorePreparedPlotCausalDelivery_ACU(crossTarget, {
      ledger: currentLedger, sourceAnchor, targetAnchor: alternateTarget, finalMessage: crossTarget.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');

    const revisionDrift = structuredClone(currentLedger);
    revisionDrift.actors[0].name = '同 revision 篡改守卫';
    const driftCandidate = structuredClone(candidateFrom(delivery));
    driftCandidate.causalDelivery = structuredClone(delivery.manifest);
    expect(() => restorePreparedPlotCausalDelivery_ACU(driftCandidate, {
      ledger: revisionDrift, sourceAnchor, targetAnchor, finalMessage: driftCandidate.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');

    const markerDeleted = structuredClone(candidateFrom(delivery));
    markerDeleted.causalDelivery = structuredClone(delivery.manifest);
    markerDeleted.finalMessage = markerDeleted.finalMessage!.replace(delivery.manifest.marker, '');
    expect(() => restorePreparedPlotCausalDelivery_ACU(markerDeleted, {
      ledger: currentLedger, sourceAnchor, targetAnchor, finalMessage: markerDeleted.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');

    const markerDuplicated = structuredClone(candidateFrom(delivery));
    markerDuplicated.causalDelivery = structuredClone(delivery.manifest);
    markerDuplicated.finalMessage = `${markerDuplicated.finalMessage}\n${delivery.manifest.marker}`;
    expect(() => restorePreparedPlotCausalDelivery_ACU(markerDuplicated, {
      ledger: currentLedger, sourceAnchor, targetAnchor, finalMessage: markerDuplicated.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');

    const factIdForged = structuredClone(candidateFrom(delivery));
    factIdForged.causalDelivery = structuredClone(delivery.manifest);
    factIdForged.causalDelivery.factIds = ['locked-local'];
    expect(() => restorePreparedPlotCausalDelivery_ACU(factIdForged, {
      ledger: currentLedger, sourceAnchor, targetAnchor, finalMessage: factIdForged.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');

    const blockHashForged = structuredClone(candidateFrom(delivery));
    blockHashForged.causalDelivery = structuredClone(delivery.manifest);
    blockHashForged.causalDelivery.messageFingerprint = 'f'.repeat(64);
    expect(() => restorePreparedPlotCausalDelivery_ACU(blockHashForged, {
      ledger: currentLedger, sourceAnchor, targetAnchor, finalMessage: blockHashForged.finalMessage,
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');
  });

  it('claim 要求唯一同文 system 安全块，移除/重复/换 role 都拒绝，且 capability 只能使用一次', async () => {
    const invalidPayloadKinds = [
      (delivery: { manifest: { marker: string } }, finalMessage: string) => ({ messages: [{ role: 'system', content: finalMessage.replace(delivery.manifest.marker, '') }] }),
      (_delivery: unknown, finalMessage: string) => ({ messages: [{ role: 'system', content: finalMessage }, { role: 'system', content: finalMessage }] }),
      (_delivery: unknown, finalMessage: string) => ({ messages: [{ role: 'user', content: finalMessage }] }),
    ];
    for (const buildInvalid of invalidPayloadKinds) {
      const { targetAnchor, delivery } = await preparedDelivery();
      const candidate = attachedCandidateFrom(delivery);
      const capability = readPreparedPlotCausalDelivery_ACU(candidate)!;
      expect(() => claimPlotCausalDelivery_ACU(capability, {
        targetAnchor, finalMessage: candidate.finalMessage, payload: buildInvalid(delivery, candidate.finalMessage!),
      })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');
    }

    const { targetAnchor, delivery } = await preparedDelivery();
    const candidate = attachedCandidateFrom(delivery);
    const capability = readPreparedPlotCausalDelivery_ACU(candidate)!;
    expect(() => claimPlotCausalDelivery_ACU(capability, {
      targetAnchor, finalMessage: candidate.finalMessage, payload: payload(candidate.finalMessage!),
    })).not.toThrow();
    expect(() => claimPlotCausalDelivery_ACU(capability, {
      targetAnchor, finalMessage: candidate.finalMessage, payload: payload(candidate.finalMessage!),
    })).toThrow('PLOT_CAUSAL_DELIVERY_INVALID');
  });
});
