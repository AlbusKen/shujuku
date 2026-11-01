import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { reviewWorldNarrativeScene_ACU } from '../../../../src/service/simulation/agent/world-scene-review';
import { runNarrativeReviewedWorldProjectionStage_ACU } from '../../../../src/service/simulation/agent/world-narrative-projection';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import type { WorldFact_ACU, WorldSimulationRunIdentity_ACU } from '../../../../src/service/simulation/model';

const anchorText = '我在青石巷的茶馆里向阿宁当面询问那封密信。';
const digest = sha256HexSync_ACU(anchorText);
const anchor = { chatIdentity: 'chat-1', messageIndex: 1, messageId: 'message-1', messageKey: 'message-key-1', swipeId: 'swipe-1', contentDigest: digest } as const;
const identity: WorldSimulationRunIdentity_ACU = {
  kind: 'host', runId: 'run-1', chatIdentity: 'chat-1', triggerKind: 'assistant_completed', triggerConversationMessageId: null,
  anchorContentDigest: digest, baseLedgerRevision: 1, taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
  deliveryTarget: 'body', workflowMode: 'single', workflowProtocol: 'world-round-v1', anchorMessageId: 'message-1', anchorMessageKey: 'message-key-1', anchorSwipeId: 'swipe-1',
};
const scene = { region: '临安', place: '青石巷' } as const;

function ledger(): ReturnType<typeof buildEmptyWorldSimulationLedger_ACU> {
  const current = buildEmptyWorldSimulationLedger_ACU();
  current.revision = 2;
  current.clock = { day: 3, slot: '', storyTime: '第三日', precision: 'exact', evidenceRefs: [] };
  current.player.location = { ...scene };
  current.actors = [{ id: 'ning', name: '阿宁', interests: [], location: '茶馆', locationRef: { ...scene }, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'limited', currentAction: null, longTermAction: null,
    shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 }];
  return current;
}
function gated(): WorldFact_ACU {
  return { id: 'secret', summary: '秘密全文', temporalKind: 'occurrence', happenedAt: { day: 3, slot: '' }, validFrom: null, validUntil: null,
    locationRef: { ...scene }, actorIds: ['ning'], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
    revealGate: { semanticCondition: '玩家主动向阿宁询问密信', actorIds: ['ning'], locationRef: scene, notBefore: { day: 3, slot: '' } },
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
}
function settings() {
  const current = buildDefaultWorldSimulationSettings_ACU();
  current.agentHistoryTokenBudget = 4096; current.agentReadTokenBudget = 4096; current.agentReadFallbackTokens = 4096;
  return current;
}
async function sceneReview(current: ReturnType<typeof ledger>, contact: boolean) {
  return reviewWorldNarrativeScene_ACU({ ledger: current, anchor, anchorText, signal: new AbortController().signal, assertCurrent: () => undefined,
    countTokens: async () => 1,
    needsSemanticReview: current.facts.length > 0,
    invoke: async () => JSON.stringify(contact
      ? { locationRef: scene, contactedActorIds: ['ning'], evidence: [{ kind: 'location', actorId: null, quote: '青石巷的茶馆里' }, { kind: 'contact', actorId: 'ning', quote: '向阿宁当面询问' }], reviews: [{ factId: 'secret', triggered: true, evidence: [{ quote: '向阿宁当面询问那封密信' }] }] }
      : { locationRef: scene, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '青石巷的茶馆里' }], reviews: current.facts.map(fact => ({ factId: fact.id, triggered: false, evidence: [] })) }),
  });
}

describe('正文审查投影转接', () => {
  it('联合 receipt 只消费单次模型语义结果，不再调用 projection 模型', async () => {
    const current = ledger(); current.facts = [gated()];
    const reviewed = await sceneReview(current, true);
    const calls: Array<readonly { role: string; content: string }[]> = [];
    const result = await runNarrativeReviewedWorldProjectionStage_ACU({
      sceneReceipt: reviewed.receipt, ledger: current, identity, targetAnchor: anchor, anchorText, settings: settings(), signal: new AbortController().signal,
      isCurrent: () => true, countTokens: async () => 1,
      invoke: async (_role, messages) => { calls.push(messages); return JSON.stringify({ reviews: [{ factId: 'secret', triggered: true, evidence: [{ quote: '向阿宁当面询问那封密信' }] }] }); },
    });
    expect(result).toMatchObject({ factIds: ['secret'], revealFactIds: ['secret'] });
    expect(calls).toHaveLength(0);
  });

  it('真实 scene receipt 可将新地点与精确 contact 引文转给 stage，不借直接 actor ID 或旧 player 地点', async () => {
    const newScene = { region: '临安', place: '青石巷' } as const;
    const current = ledger(); current.player.location = null;
    const secret = gated(); secret.locationRef = { ...newScene }; secret.revealGate = { ...secret.revealGate!, locationRef: newScene };
    current.facts = [secret]; current.actors[0].locationRef = { ...newScene };
    const reviewed = await reviewWorldNarrativeScene_ACU({ ledger: current, anchor, anchorText, signal: new AbortController().signal, assertCurrent: () => undefined,
      countTokens: async () => 1,
      invoke: async () => JSON.stringify({ locationRef: newScene, contactedActorIds: ['ning'], evidence: [
        { kind: 'location', actorId: null, quote: '青石巷的茶馆里' }, { kind: 'contact', actorId: 'ning', quote: '向阿宁当面询问' },
      ], reviews: [{ factId: 'secret', triggered: true, evidence: [{ quote: '向阿宁当面询问那封密信' }] }] }),
    });
    const result = await runNarrativeReviewedWorldProjectionStage_ACU({
      sceneReceipt: reviewed.receipt, ledger: current, identity, targetAnchor: anchor, anchorText, settings: settings(), signal: new AbortController().signal,
      isCurrent: () => true, countTokens: async () => 1,
      invoke: async () => JSON.stringify({ reviews: [{ factId: 'secret', triggered: true, evidence: [{ quote: '向阿宁当面询问那封密信' }] }] }),
    });
    expect(result).toMatchObject({ factIds: ['secret'], revealFactIds: ['secret'] });
  });

  it('正文未证明接触时仍保持 locked，原 semantic 模型不会被调用', async () => {
    const current = ledger(); current.facts = [gated()];
    const reviewed = await sceneReview(current, false);
    const result = await runNarrativeReviewedWorldProjectionStage_ACU({
      sceneReceipt: reviewed.receipt, ledger: current, identity, targetAnchor: anchor, anchorText, settings: settings(), signal: new AbortController().signal,
      isCurrent: () => true, countTokens: async () => 1, invoke: async () => { throw new Error('不应调用'); },
    });
    expect(result).toMatchObject({ factIds: [], revealFactIds: [] });
    expect(current.facts[0].revealState).toBe('locked');
  });

  it('stale isCurrent 会在读取 scene receipt 时拒绝，且零 projection invoke', async () => {
    const current = ledger();
    const reviewed = await sceneReview(current, false);
    let projectionCalls = 0;
    await expect(runNarrativeReviewedWorldProjectionStage_ACU({
      sceneReceipt: reviewed.receipt, ledger: current, identity, targetAnchor: anchor, anchorText, settings: settings(), signal: new AbortController().signal,
      isCurrent: () => false, countTokens: async () => 1, invoke: async () => { projectionCalls += 1; return ''; },
    })).rejects.toThrow(/租约|失效/);
    expect(projectionCalls).toBe(0);
  });

  it('无场景地点的审查回执拒绝转接，不伪造空 projection receipt', async () => {
    const current = ledger();
    const missing = await reviewWorldNarrativeScene_ACU({ ledger: current, anchor, anchorText, signal: new AbortController().signal, assertCurrent: () => undefined,
      countTokens: async () => 1, invoke: async () => JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] }) });
    await expect(runNarrativeReviewedWorldProjectionStage_ACU({
      sceneReceipt: missing.receipt, ledger: current, identity, targetAnchor: anchor, anchorText, settings: settings(), signal: new AbortController().signal,
      isCurrent: () => true, countTokens: async () => 1, invoke: async () => '',
    })).rejects.toThrow(/未确定场景地点/);
  });
});
