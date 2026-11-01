import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { claimWorldBodyProjection_ACU, claimWorldFactRevealProof_ACU, prepareWorldBodyProjection_ACU, prepareWorldFactRevealProof_ACU, readReviewedWorldProjectionFacts_ACU, runWorldProjectionStage_ACU } from '../../../../src/service/simulation/agent/world-projection-stage';
import { materializeReviewedWorldRoundCandidate_ACU } from '../../../../src/service/simulation/world-candidate';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import type { WorldFact_ACU, WorldSimulationRunIdentity_ACU } from '../../../../src/service/simulation/model';

const anchorText = '我主动向守卫询问那封密信的去向。';
const anchorDigest = sha256HexSync_ACU(anchorText);
const identity: WorldSimulationRunIdentity_ACU = {
  kind: 'host', runId: 'run-1', chatIdentity: 'chat-1', triggerKind: 'assistant_completed', triggerConversationMessageId: null,
  anchorContentDigest: anchorDigest, baseLedgerRevision: 5, taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
  deliveryTarget: 'body', workflowMode: 'single', workflowProtocol: 'world-round-v1',
  anchorMessageId: 'message-1', anchorMessageKey: 'message-key-1', anchorSwipeId: 'swipe-1',
};
const anchor = { chatIdentity: 'chat-1', messageIndex: 1, messageId: 'message-1', messageKey: 'message-key-1', swipeId: 'swipe-1', contentDigest: anchorDigest } as const;
const place = { region: '上海', place: '广场' } as const;
const otherPlace = { region: '上海', place: '后街' } as const;

function fact(id: string, patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return {
    id, summary: `秘密摘要:${id}`, temporalKind: 'occurrence', happenedAt: { day: 3, slot: '' }, validFrom: null, validUntil: null,
    locationRef: place, actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null,
    nextCheck: null, sourceRefs: ['private-source'], evidenceRefs: [], supersedesFactIds: [], revision: 1, ...patch,
  };
}
function ledger(facts: WorldFact_ACU[]) {
  const current = buildEmptyWorldSimulationLedger_ACU();
  current.revision = 6; // 已物化 candidate：不是 identity.baseLedgerRevision。
  current.clock = { day: 3, slot: '', storyTime: '第三日', precision: 'exact', evidenceRefs: [] };
  current.player.location = { ...place };
  current.facts = facts;
  current.actors = [{ id: 'guard-1', name: '守卫', interests: [], location: '广场', locationRef: { ...place }, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'limited', currentAction: null,
    longTermAction: null, shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1 }];
  return current;
}
function settings() {
  const current = buildDefaultWorldSimulationSettings_ACU();
  current.workflowMode = 'single';
  current.agentReadTokenBudget = 1000;
  current.agentReadFallbackTokens = 1000;
  return current;
}
function reply(reviews: unknown[]) { return JSON.stringify({ reviews }); }
function baseInput(facts: WorldFact_ACU[], response = reply([])) {
  const calls: unknown[] = [];
  return {
    ledger: ledger(facts), identity, targetAnchor: anchor, anchorText, sceneLocation: place, settings: settings(),
    signal: new AbortController().signal, isCurrent: () => true,
    countTokens: async (text: string) => Math.max(1, Math.ceil(text.length / 8)),
    invoke: async (...args: unknown[]) => { calls.push(args); return response; }, calls,
  };
}

const gated = () => fact('secret-1', {
  projectionPolicy: 'gated', revealState: 'locked',
  revealGate: { semanticCondition: '玩家主动询问守卫关于密信', actorIds: ['guard-1'], locationRef: place, notBefore: { day: 3, slot: '' } },
});

describe('世界正文安全投影阶段', () => {
  it('body 一次精读签发 scene 与 gated 的独立许可，含揭示时复用同次读取', async () => {
    const input = baseInput([fact('scene-1'), gated()], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    let reads = 0;
    const read = { receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText, clock: input.ledger.clock,
      sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal,
      isCurrent: () => true, countTokens: async () => { reads++; return 1; } };
    const prepared = await prepareWorldBodyProjection_ACU(read);
    expect(reads).toBe(1);
    expect(prepared.factIds).toEqual(['scene-1', 'secret-1']);
    expect(prepared.reveal?.factIds).toEqual(['secret-1']);
    expect(JSON.stringify(prepared)).not.toContain('秘密摘要');
    expect(JSON.stringify(prepared.proof)).toBe('{}');
    expect(claimWorldBodyProjection_ACU(prepared.proof, input.ledger, identity, anchor)).toEqual(['scene-1', 'secret-1']);
    expect(() => claimWorldBodyProjection_ACU(prepared.proof, input.ledger, identity, anchor)).toThrow(/已领取/);
    expect(() => claimWorldFactRevealProof_ACU(prepared.reveal!.proof, input.ledger, ['secret-1'],
      { ...identity, anchorContentDigest: 'body-updated' }, { ...anchor, contentDigest: 'other-plugin-updated' })).not.toThrow();
    await expect(prepareWorldFactRevealProof_ACU(read)).rejects.toThrow(/已领取/);
  });

  it('body proof 拒绝伪造、跨 run/anchor/ledger 领取且失败后不可重领；canonical 键顺序保持兼容', async () => {
    const make = async () => {
      const input = baseInput([fact('scene-1')]);
      const stage = await runWorldProjectionStage_ACU(input);
      const prepared = await prepareWorldBodyProjection_ACU({ ...input, receipt: stage.receipt, clock: input.ledger.clock });
      return { input, prepared };
    };
    const { input, prepared } = await make();
    expect(prepared.reveal).toBeUndefined();
    const multi = baseInput([fact('z'), fact('a')]);
    const multiStage = await runWorldProjectionStage_ACU(multi);
    const multiProof = await prepareWorldBodyProjection_ACU({ ...multi, receipt: multiStage.receipt, clock: multi.ledger.clock });
    const reorderedMulti = structuredClone(multi.ledger);
    reorderedMulti.facts.reverse();
    expect(claimWorldBodyProjection_ACU(multiProof.proof, reorderedMulti, { ...identity, anchorContentDigest: 'modified-text' },
      { ...anchor, contentDigest: 'another-modified-text' })).toEqual(['a', 'z']);
    expect(() => claimWorldBodyProjection_ACU({} as never, input.ledger, identity, anchor)).toThrow(/proof/);
    expect(() => claimWorldBodyProjection_ACU(JSON.parse(JSON.stringify(prepared.proof)), input.ledger, identity, anchor)).toThrow(/proof/);
    const reordered = JSON.parse(JSON.stringify(input.ledger));
    reordered.facts.reverse();
    expect(claimWorldBodyProjection_ACU(prepared.proof, reordered, { ...identity }, { ...anchor })).toEqual(['scene-1']);
    for (const change of [
      (i: ReturnType<typeof make> extends Promise<infer T> ? T : never) => ({ ledger: i.input.ledger, identity: { ...identity, runId: 'other' }, anchor }),
      (i: ReturnType<typeof make> extends Promise<infer T> ? T : never) => ({ ledger: i.input.ledger, identity, anchor: { ...anchor, messageKey: 'other' } }),
      (i: ReturnType<typeof make> extends Promise<infer T> ? T : never) => ({ ledger: i.input.ledger, identity, anchor: { ...anchor, swipeId: 'other-swipe' } }),
      (i: ReturnType<typeof make> extends Promise<infer T> ? T : never) => ({ ledger: { ...i.input.ledger, revision: 42 }, identity, anchor }),
    ]) {
      const item = await make();
      const altered = change(item);
      expect(() => claimWorldBodyProjection_ACU(item.prepared.proof, altered.ledger, altered.identity, altered.anchor)).toThrow(/绑定|变化/);
      expect(() => claimWorldBodyProjection_ACU(item.prepared.proof, item.input.ledger, identity, anchor)).toThrow(/已领取/);
    }
  });

  it('无精确 scene 的真实空 receipt 可签 body 清旧块；旧 read 仍拒绝，非空 receipt 不可绕过', async () => {
    const input = baseInput([fact('scene-1')]);
    const stage = await runWorldProjectionStage_ACU({ ...input, sceneLocation: null });
    expect(stage.factIds).toEqual([]);
    const read = { ...input, receipt: stage.receipt, clock: input.ledger.clock, sceneLocation: null };
    await expect(readReviewedWorldProjectionFacts_ACU(read)).rejects.toThrow(/精确场景地点/);
    const prepared = await prepareWorldBodyProjection_ACU(read);
    expect(prepared.factIds).toEqual([]);
    expect(prepared.reveal).toBeUndefined();
    expect(claimWorldBodyProjection_ACU(prepared.proof, input.ledger, identity, anchor)).toEqual([]);
    await expect(prepareWorldBodyProjection_ACU(read)).rejects.toThrow(/已领取/);

    const realScene = await runWorldProjectionStage_ACU(input);
    await expect(prepareWorldBodyProjection_ACU({ ...read, receipt: realScene.receipt })).rejects.toThrow(/精确场景地点/);
    const wrongClock = await runWorldProjectionStage_ACU({ ...input, sceneLocation: null });
    await expect(prepareWorldBodyProjection_ACU({ ...read, receipt: wrongClock.receipt, clock: { ...input.ledger.clock, day: 4 } })).rejects.toThrow(/时钟/);
  });

  it('body 读取超预算、异步变化不签发许可，空事实合法领取空 ID', async () => {
    const input = baseInput([fact('scene-1')]);
    const stage = await runWorldProjectionStage_ACU(input);
    const read = { ...input, receipt: stage.receipt, clock: input.ledger.clock };
    await expect(prepareWorldBodyProjection_ACU({ ...read, countTokens: async () => 9999 })).rejects.toThrow(/预算/);
    const changed = baseInput([fact('scene-1')]);
    const changedStage = await runWorldProjectionStage_ACU(changed);
    await expect(prepareWorldBodyProjection_ACU({ ...changed, receipt: changedStage.receipt, clock: changed.ledger.clock,
      countTokens: async () => { changed.ledger.revision++; return 1; } })).rejects.toThrow(/变化/);
    const empty = baseInput([]);
    const emptyStage = await runWorldProjectionStage_ACU(empty);
    const prepared = await prepareWorldBodyProjection_ACU({ ...empty, receipt: emptyStage.receipt, clock: empty.ledger.clock });
    expect(prepared.factIds).toEqual([]);
    expect(claimWorldBodyProjection_ACU(prepared.proof, empty.ledger, identity, anchor)).toEqual([]);
  });

  it('稳定 ID 分页：scene 仅选择同一精确地点、已成立且 unlocked 的非 internal 事实', async () => {
    const scene = fact('scene-2');
    const far = fact('far-1', { locationRef: otherPlace });
    const future = fact('future-1', { happenedAt: { day: 4, slot: '' } });
    const expired = fact('expired-1', { temporalKind: 'condition', happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' } });
    const internal = fact('internal-1', { projectionPolicy: 'internal' });
    const locked = fact('locked-1', { revealState: 'locked' });
    const noPlace = fact('no-place-1', { locationRef: null });
    const input = baseInput([scene, far, future, expired, internal, locked, noPlace]);
    const result = await runWorldProjectionStage_ACU(input);
    expect(result.factIds).toEqual(['scene-2']);
    expect(result.revealFactIds).toEqual([]);
    expect(input.calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('秘密摘要');
    expect(input.ledger.projection).toEqual({ anchor: null, deliveries: [] });
  });

  it('空候选不调用模型；缺少精确 scene/place 安全返回空结果，地点不一致仍拒绝', async () => {
    const empty = baseInput([]);
    await expect(runWorldProjectionStage_ACU(empty)).resolves.toMatchObject({ factIds: [] });
    expect(empty.calls).toHaveLength(0);
    await expect(runWorldProjectionStage_ACU({ ...baseInput([fact('scene')]), sceneLocation: { region: '上海' } as never })).resolves.toMatchObject({ factIds: [] });
    await expect(runWorldProjectionStage_ACU({ ...baseInput([fact('scene')]), sceneLocation: otherPlace })).rejects.toThrow(/精确一致/);
  });

  it('已成立的冷层替代者在投影选择阶段排除热层事实', async () => {
    const input = baseInput([fact('hot-scene')]);
    input.ledger.factArchive = [fact('cold-replacement', { projectionPolicy: 'internal', revealState: 'locked',
      locationRef: null, supersedesFactIds: ['hot-scene'] })];
    await expect(runWorldProjectionStage_ACU(input)).resolves.toMatchObject({ factIds: [], revealFactIds: [] });
    expect(input.calls).toHaveLength(0);
  });

  it('narrative wrapper 可凭受审正文场景校准旧 player 地点，普通 stage 仍拒绝不一致地点', async () => {
    const secret = gated();
    const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    input.ledger.player.location = { ...otherPlace };
    await expect(runWorldProjectionStage_ACU({ ...input, sceneLocation: place, contactedActorIds: ['guard-1'] })).rejects.toThrow(/精确一致/);
    await expect(runWorldProjectionStage_ACU({ ...input, sceneLocation: place, contactedActorIds: ['guard-1'], trustedNarrativeScene: true }))
      .resolves.toMatchObject({ factIds: ['secret-1'], revealFactIds: ['secret-1'] });
  });

  it('narrative receipt 的新地点贯穿 read、proof 与候选物化，不以旧或空 player 覆盖受审场景', async () => {
    const newPlace = { region: '临安', place: '青石巷' } as const;
    const secret = gated();
    secret.locationRef = { ...newPlace };
    secret.revealGate = { ...secret.revealGate!, locationRef: newPlace };
    const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    input.ledger.player.location = null;
    const stage = await runWorldProjectionStage_ACU({ ...input, sceneLocation: newPlace, contactedActorIds: ['guard-1'], trustedNarrativeScene: true });
    const proof = await prepareWorldFactRevealProof_ACU({ receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText,
      clock: input.ledger.clock, sceneLocation: newPlace, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: input.countTokens });
    const base = structuredClone(input.ledger);
    base.revision -= 1;
    const candidate = { baseRevision: base.revision, candidateClock: structuredClone(input.ledger.clock), worldEventWrites: [], actorWrites: [], factWrites: [], historyMilestoneWrites: [],
      actorCompletions: [{ actorId: 'guard-1', completion: 'no_change' as const, expectedRevision: 1 }],
      projection: structuredClone(input.ledger.projection), completion: 'changed' as const };
    const materialized = materializeReviewedWorldRoundCandidate_ACU(base, candidate, { ...proof, identity, targetAnchor: anchor });
    expect(materialized.facts[0]).toMatchObject({ id: 'secret-1', revealState: 'unlocked' });
  });

  it('gated 未满足结构门禁不会调用语义模型，且秘密摘要不进入 prompt 或结果', async () => {
    const input = baseInput([gated()]);
    const result = await runWorldProjectionStage_ACU(input);
    expect(result).toMatchObject({ factIds: [], revealFactIds: [] });
    expect(input.calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('秘密摘要:secret-1');
  });

  it('真正语义命中、精确引文和显式 contact 上下文后，只有受限 read 才返回全文', async () => {
    const secret = gated();
    const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const before = structuredClone(input.ledger);
    const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    expect(stage).toMatchObject({ factIds: ['secret-1'], revealFactIds: ['secret-1'] });
    expect(JSON.stringify(stage)).not.toContain('秘密摘要:secret-1');
    expect(JSON.stringify(input.calls)).not.toContain('秘密摘要:secret-1');
    const read = await readReviewedWorldProjectionFacts_ACU({
      receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText, clock: input.ledger.clock,
      sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: input.countTokens,
    });
    expect(read.facts).toEqual([secret]);
    expect(read.facts[0].revealState).toBe('locked');
    expect(input.ledger).toEqual(before);
  });

  it('拒绝伪造引文、重复/遗漏/越权 ID；回答放在工具调用参数里也能读取', async () => {
    const secret = gated();
    const cases = [
      reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '不存在的文字' }] }]),
      reply([{ factId: 'secret-1', triggered: false, evidence: [] }, { factId: 'secret-1', triggered: false, evidence: [] }]),
      reply([{ factId: 'other', triggered: false, evidence: [] }]),
    ];
    for (const response of cases) await expect(runWorldProjectionStage_ACU({ ...baseInput([secret], response), contactedActorIds: ['guard-1'] })).rejects.toThrow();
    const calls: unknown[] = [];
    await expect(runWorldProjectionStage_ACU({ ...baseInput([secret]), contactedActorIds: ['guard-1'], invoke: async (...args: unknown[]) => {
      calls.push(args); return { content: '', toolCalls: [{ id: 'x', name: 'reply', arguments: reply([{ factId: 'secret-1', triggered: false, evidence: [] }]) }] };
    } })).resolves.toMatchObject({ revealFactIds: [] });
    expect(calls).toHaveLength(1);
  });

  it('预算、坏计数器、取消或失效租约都不会调用或返回投影', async () => {
    const secret = gated();
    const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: false, evidence: [] }]));
    input.settings.agentHistoryTokenBudget = 1;
    await expect(runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] })).rejects.toThrow(/预算/);
    expect(input.calls).toHaveLength(0);
    await expect(runWorldProjectionStage_ACU({ ...baseInput([secret]), contactedActorIds: ['guard-1'], countTokens: async () => Number.NaN })).rejects.toThrow(/令牌计数/);
    const controller = new AbortController(); controller.abort();
    await expect(runWorldProjectionStage_ACU({ ...baseInput([secret]), contactedActorIds: ['guard-1'], signal: controller.signal })).rejects.toThrow(/取消/);
    await expect(runWorldProjectionStage_ACU({ ...baseInput([secret]), contactedActorIds: ['guard-1'], isCurrent: () => false })).rejects.toThrow(/失效/);
  });

  it('receipt 绑定物化 ledger、anchor/clock/place/identity/contact/config，且预算失败不泄漏部分全文', async () => {
    const secret = gated();
    const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    const read = (patch: Record<string, unknown> = {}) => readReviewedWorldProjectionFacts_ACU({
      receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText, clock: input.ledger.clock,
      sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: input.countTokens, ...patch,
    });
    await expect(read({ ledger: { ...input.ledger, revision: 7 } })).rejects.toThrow(/绑定/);
    await expect(read({ targetAnchor: { ...anchor, messageKey: 'other' } })).rejects.toThrow(/身份|楼层/);
    await expect(read({ clock: { ...input.ledger.clock, day: 4 } })).rejects.toThrow(/时钟/);
    await expect(read({ sceneLocation: otherPlace })).rejects.toThrow(/可信精确|不一致|绑定/);
    await expect(read({ identity: { ...identity, taskId: 'other' } })).rejects.toThrow(/绑定/);
    await expect(read({ contactedActorIds: [] })).rejects.toThrow(/绑定/);
    const small = settings(); small.agentReadTokenBudget = 1;
    await expect(read({ settings: small })).rejects.toThrow(/绑定/);
    const other = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    await expect(read({ receipt: other.receipt })).resolves.toMatchObject({ factIds: ['secret-1'] });
    const constrained = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    await expect(readReviewedWorldProjectionFacts_ACU({ receipt: constrained.receipt, ledger: input.ledger, identity, targetAnchor: anchor,
      anchorText, clock: input.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: async () => 9999 })).rejects.toThrow(/预算/);
  });

  it('异步 invoke 与读取计数期间任一快照输入变化都会拒绝，且 read 回执只能领取一次', async () => {
    const secret = gated();
    const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: false, evidence: [] }]));
    input.invoke = async () => { input.ledger.facts[0].summary = '篡改'; return reply([{ factId: 'secret-1', triggered: false, evidence: [] }]); };
    await expect(runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] })).rejects.toThrow(/快照已变化/);

    const good = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const stage = await runWorldProjectionStage_ACU({ ...good, contactedActorIds: ['guard-1'] });
    const controller = new AbortController();
    const readInput = { receipt: stage.receipt, ledger: good.ledger, identity, targetAnchor: anchor, anchorText, clock: good.ledger.clock,
      sceneLocation: place, contactedActorIds: ['guard-1'], settings: good.settings, signal: controller.signal, isCurrent: () => true,
      countTokens: async () => { good.ledger.facts[0].summary = '计数期间篡改'; return 1; } };
    await expect(readReviewedWorldProjectionFacts_ACU(readInput)).rejects.toThrow(/快照已变化/);
    await expect(readReviewedWorldProjectionFacts_ACU({ ...readInput, countTokens: async () => 1 })).rejects.toThrow(/已失效|已领取/);

    const clean = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const cleanStage = await runWorldProjectionStage_ACU({ ...clean, contactedActorIds: ['guard-1'] });
    const claim = { receipt: cleanStage.receipt, ledger: clean.ledger, identity, targetAnchor: anchor, anchorText, clock: clean.ledger.clock,
      sceneLocation: place, contactedActorIds: ['guard-1'], settings: clean.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: async () => 1 };
    await expect(readReviewedWorldProjectionFacts_ACU(claim)).resolves.toMatchObject({ factIds: ['secret-1'] });
    await expect(readReviewedWorldProjectionFacts_ACU(claim)).rejects.toThrow(/已领取/);
  });

  it('scene-only 也经 ID 预算；百分比预算可用，17 条事实拒绝签发回执', async () => {
    const manyScene = Array.from({ length: 17 }, (_, index) => fact(`scene-${index}`));
    const input = baseInput(manyScene);
    input.settings.agentReadTokenBudget = '1%';
    input.settings.agentHistoryTokenBudget = 100;
    input.countTokens = async () => 100;
    await expect(runWorldProjectionStage_ACU(input)).rejects.toThrow(/ID 预算/);
    expect(input.calls).toHaveLength(0);
    const invalid = baseInput([fact('scene')]);
    invalid.settings.agentReadTokenBudget = 'NaN%' as never;
    await expect(runWorldProjectionStage_ACU(invalid)).rejects.toThrow(/读取预算配置非法/);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('scene 与全文精读 counter=%s 都不放行', async invalid => {
    const input = baseInput([fact('scene')]);
    await expect(runWorldProjectionStage_ACU({ ...input, countTokens: async () => invalid })).rejects.toThrow(/令牌计数/);
    const stage = await runWorldProjectionStage_ACU(input);
    await expect(readReviewedWorldProjectionFacts_ACU({ ...input, receipt: stage.receipt, clock: input.ledger.clock,
      countTokens: async () => invalid })).rejects.toThrow(/令牌计数/);
    expect(input.calls).toHaveLength(0);
  });

  it('百分比预算按 history 计算，长期偏好变化不改冻结角色，全文只可领取一次', async () => {
    const input = baseInput([fact('scene')]);
    input.settings.agentHistoryTokenBudget = 1000;
    input.settings.agentReadTokenBudget = '20%';
    input.settings.agentReadFallbackTokens = 1;
    input.settings.workflowMode = 'layered';
    input.settings.deliveryTarget = 'plot';
    const stage = await runWorldProjectionStage_ACU(input);
    const read = { ...input, receipt: stage.receipt, clock: input.ledger.clock, countTokens: async () => 100 };
    await expect(readReviewedWorldProjectionFacts_ACU(read)).resolves.toMatchObject({ factIds: ['scene'] });
    await expect(readReviewedWorldProjectionFacts_ACU(read)).rejects.toThrow(/已领取/);
  });

  it.each(['取消', '租约失效', '时钟', '地点', '配置'])('精读计数期间%s不返回全文', async scenario => {
    const input = baseInput([fact('scene')]);
    const stage = await runWorldProjectionStage_ACU(input);
    const controller = new AbortController();
    let current = true;
    const read = { ...input, receipt: stage.receipt, clock: structuredClone(input.ledger.clock),
      sceneLocation: { ...place }, settings: structuredClone(input.settings), signal: controller.signal,
      isCurrent: () => current, countTokens: async () => {
        if (scenario === '取消') controller.abort();
        if (scenario === '租约失效') current = false;
        if (scenario === '时钟') read.clock.day += 1;
        if (scenario === '地点') Object.assign(read.sceneLocation, { place: '后街' });
        if (scenario === '配置') read.settings.agentReadFallbackTokens += 1;
        return 1;
      } };
    await expect(readReviewedWorldProjectionFacts_ACU(read)).rejects.toThrow(/取消|失效|变化/);
  });

  it('伪造回执、错误正文摘要与空白引文拒绝，false 不授予秘密全文', async () => {
    const input = baseInput([gated()], reply([{ factId: 'secret-1', triggered: false, evidence: [] }]));
    const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    expect(stage.factIds).toEqual([]);
    await expect(readReviewedWorldProjectionFacts_ACU({ ...input, receipt: {}, clock: input.ledger.clock })).rejects.toThrow(/回执/);
    await expect(runWorldProjectionStage_ACU({ ...input, anchorText: '伪造正文' })).resolves.toMatchObject({ factIds: [] });
    const whitespace = baseInput([gated()], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: ' ' }] }]));
    await expect(runWorldProjectionStage_ACU({ ...whitespace, contactedActorIds: ['guard-1'] })).rejects.toThrow(/引文/);
    const omitted = baseInput([gated()], reply([]));
    await expect(runWorldProjectionStage_ACU({ ...omitted, contactedActorIds: ['guard-1'] })).rejects.toThrow(/恰好覆盖/);
  });

  it('proof 只签发已完整读取的 locked gated reveal IDs；不泄漏秘密正文且可对同一 preview 仅领取一次', async () => {
    const secret = gated();
    const visible = fact('scene-visible');
    const input = baseInput([visible, secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    const prepared = await prepareWorldFactRevealProof_ACU({ receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText,
      clock: input.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: input.countTokens });
    expect(prepared.factIds).toEqual(['secret-1']);
    expect(stage.factIds).toContain('scene-visible');
    expect(prepared.factIds).not.toContain('scene-visible');
    expect(JSON.stringify(prepared)).not.toContain('秘密摘要:secret-1');
    expect(JSON.stringify(prepared.proof)).toBe('{}');
    expect(() => claimWorldFactRevealProof_ACU(prepared.proof, input.ledger, ['secret-1'], identity, anchor)).not.toThrow();
    expect(() => claimWorldFactRevealProof_ACU(prepared.proof, input.ledger, ['secret-1'], identity, anchor)).toThrow(/已领取/);
  });

  it('proof 绑定 canonical run identity 与 anchor；相同 preview 不能跨 run 或正文摘要领取', async () => {
    const makePrepared = async (runIdentity: WorldSimulationRunIdentity_ACU, targetAnchor: typeof anchor, text: string) => {
      const input = baseInput([gated()], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
      const stage = await runWorldProjectionStage_ACU({ ...input, identity: runIdentity, targetAnchor, anchorText: text, contactedActorIds: ['guard-1'] });
      const prepared = await prepareWorldFactRevealProof_ACU({ receipt: stage.receipt, ledger: input.ledger, identity: runIdentity, targetAnchor, anchorText: text,
        clock: input.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: input.countTokens });
      return { input, prepared };
    };

    const anotherRun = { ...identity, runId: 'run-2' } as WorldSimulationRunIdentity_ACU;
    const runBound = await makePrepared(identity, anchor, anchorText);
    expect(() => claimWorldFactRevealProof_ACU(runBound.prepared.proof, runBound.input.ledger, ['secret-1'], anotherRun, anchor)).toThrow(/身份|锚点/);
    expect(() => claimWorldFactRevealProof_ACU(runBound.prepared.proof, runBound.input.ledger, ['secret-1'], identity, anchor)).toThrow(/已领取/);

    const anotherTask = { ...identity, taskId: 'task-2' } as WorldSimulationRunIdentity_ACU;
    const taskBound = await makePrepared(identity, anchor, anchorText);
    expect(() => claimWorldFactRevealProof_ACU(taskBound.prepared.proof, taskBound.input.ledger, ['secret-1'], anotherTask, anchor)).toThrow(/身份|锚点/);
    expect(() => claimWorldFactRevealProof_ACU(taskBound.prepared.proof, taskBound.input.ledger, ['secret-1'], identity, anchor)).toThrow(/已领取/);

    const alternateText = `${anchorText}守卫没有立刻作答。`;
    const alternateDigest = sha256HexSync_ACU(alternateText);
    const alternateIdentity = { ...identity, anchorContentDigest: alternateDigest } as WorldSimulationRunIdentity_ACU;
    const alternateAnchor = { ...anchor, contentDigest: alternateDigest } as const;
    const originalForAnchor = await makePrepared(identity, anchor, anchorText);
    expect(() => claimWorldFactRevealProof_ACU(originalForAnchor.prepared.proof, originalForAnchor.input.ledger, ['secret-1'], alternateIdentity, alternateAnchor)).not.toThrow();
    expect(() => claimWorldFactRevealProof_ACU(originalForAnchor.prepared.proof, originalForAnchor.input.ledger, ['secret-1'], identity, anchor)).toThrow(/已领取/);

    // 同一 messageKey/swipe 的不同正文摘要必须以自身合法正文重新签发 proof。
    const alternate = await makePrepared(alternateIdentity, alternateAnchor, alternateText);
    expect(() => claimWorldFactRevealProof_ACU(alternate.prepared.proof, alternate.input.ledger, ['secret-1'], alternateIdentity,
      { ...alternateAnchor, swipeId: 'other-swipe' })).toThrow(/身份|锚点/);
    expect(() => claimWorldFactRevealProof_ACU(alternate.prepared.proof, alternate.input.ledger, ['secret-1'], alternateIdentity, alternateAnchor)).toThrow(/已领取/);
  });

  it('proof 对伪造、错误时地、账本正文或 gate/clock/ID 篡改及无 reveal 的 receipt 均拒绝', async () => {
    const makePrepared = async () => {
      const secret = gated();
      const input = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
      const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
      const prepared = await prepareWorldFactRevealProof_ACU({ receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText,
        clock: input.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: input.countTokens });
      return { input, prepared };
    };
    await expect(prepareWorldFactRevealProof_ACU({ ...baseInput([gated()], reply([{ factId: 'secret-1', triggered: false, evidence: [] }])), receipt: {} as never, clock: ledger([]).clock })).rejects.toThrow(/回执/);
    expect(() => claimWorldFactRevealProof_ACU({} as never, ledger([gated()]), ['secret-1'], identity, anchor)).toThrow(/proof/);
    for (const patch of [
      (value: ReturnType<typeof ledger>) => { value.facts[0].summary = '偷改秘密正文'; },
      (value: ReturnType<typeof ledger>) => { value.facts[0].revealGate = null; },
      (value: ReturnType<typeof ledger>) => { value.clock.day = 4; },
      (value: ReturnType<typeof ledger>) => { value.player.location = { ...otherPlace }; },
    ]) {
      const { input, prepared } = await makePrepared();
      const preview = structuredClone(input.ledger);
      patch(preview);
      expect(() => claimWorldFactRevealProof_ACU(prepared.proof, preview, ['secret-1'], identity, anchor)).toThrow(/变化|时钟|场景/);
      expect(() => claimWorldFactRevealProof_ACU(prepared.proof, input.ledger, ['secret-1'], identity, anchor)).toThrow(/已领取/);
    }
    const { input, prepared } = await makePrepared();
    expect(() => claimWorldFactRevealProof_ACU(JSON.parse(JSON.stringify(prepared.proof)) as never, input.ledger, ['secret-1'], identity, anchor)).toThrow(/proof/);
    expect(() => claimWorldFactRevealProof_ACU(prepared.proof, input.ledger, [], identity, anchor)).toThrow(/ID/);
    const omitted = baseInput([gated()], reply([{ factId: 'secret-1', triggered: false, evidence: [] }]));
    const stage = await runWorldProjectionStage_ACU({ ...omitted, contactedActorIds: ['guard-1'] });
    await expect(prepareWorldFactRevealProof_ACU({ receipt: stage.receipt, ledger: omitted.ledger, identity, targetAnchor: anchor, anchorText,
      clock: omitted.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: omitted.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: omitted.countTokens })).rejects.toThrow(/没有已审核/);
  });

  it('proof 签发期间的异步输入变化、预算拒绝和其他 scene 事实都不能获得授权', async () => {
    const scene = fact('scene-visible');
    const secret = gated();
    const input = baseInput([scene, secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const stage = await runWorldProjectionStage_ACU({ ...input, contactedActorIds: ['guard-1'] });
    const proofInput = { receipt: stage.receipt, ledger: input.ledger, identity, targetAnchor: anchor, anchorText,
      clock: input.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: input.settings, signal: new AbortController().signal, isCurrent: () => true,
      countTokens: async () => { proofInput.anchorText = '异步篡改'; return 1; } };
    await expect(prepareWorldFactRevealProof_ACU(proofInput)).rejects.toThrow(/快照已变化/);
    const controller = new AbortController(); controller.abort();
    const cancelled = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const cancelledStage = await runWorldProjectionStage_ACU({ ...cancelled, contactedActorIds: ['guard-1'] });
    await expect(prepareWorldFactRevealProof_ACU({ receipt: cancelledStage.receipt, ledger: cancelled.ledger, identity, targetAnchor: anchor, anchorText,
      clock: cancelled.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: cancelled.settings, signal: controller.signal, isCurrent: () => true, countTokens: cancelled.countTokens })).rejects.toThrow(/取消/);
    const constrained = baseInput([secret], reply([{ factId: 'secret-1', triggered: true, evidence: [{ quote: '主动向守卫询问那封密信' }] }]));
    const constrainedStage = await runWorldProjectionStage_ACU({ ...constrained, contactedActorIds: ['guard-1'] });
    await expect(prepareWorldFactRevealProof_ACU({ receipt: constrainedStage.receipt, ledger: constrained.ledger, identity, targetAnchor: anchor, anchorText,
      clock: constrained.ledger.clock, sceneLocation: place, contactedActorIds: ['guard-1'], settings: constrained.settings, signal: new AbortController().signal, isCurrent: () => true, countTokens: async () => 9999 })).rejects.toThrow(/预算/);
  });

  it('layered 使用 guidance-composer 预设；每页最多 16 项且页 payload 不含秘密摘要', async () => {
    const many = Array.from({ length: 17 }, (_, index) => fact(`secret-${String(index).padStart(2, '0')}`, {
      projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '主动询问', locationRef: place },
    }));
    const current = baseInput(many, '');
    current.settings.workflowMode = 'layered';
    current.identity = { ...identity, workflowMode: 'layered' } as typeof identity;
    current.invoke = async (...args: unknown[]) => {
      current.calls.push(args);
      const message = (args[1] as Array<{ content: string }>)[1].content;
      const payload = JSON.parse(message);
      return reply(payload.candidates.map((candidate: { factId: string }) => ({ factId: candidate.factId, triggered: false, evidence: [] })));
    };
    const result = await runWorldProjectionStage_ACU(current);
    expect(result.factIds).toEqual([]);
    expect(current.calls).toHaveLength(2);
    for (const call of current.calls) {
      expect(call[0]).toBe('guidance-composer');
      const payload = JSON.parse((call[1] as Array<{ content: string }>)[1].content);
      expect(payload.candidates.length).toBeLessThanOrEqual(16);
      expect(JSON.stringify(call)).not.toContain('秘密摘要');
    }
  });

  it('自定义 projection-review 提示词进入最终请求，禁用段不发送且超预算零调用', async () => {
    const custom = baseInput([gated()], reply([{ factId: 'secret-1', triggered: false, evidence: [] }]));
    custom.settings.worldRoundPrompts = { 'projection-review': [
      { role: 'system', content: 'PROJECTION_REVIEW_CUSTOM_MARKER', enabled: true, deletable: true, pinned: false },
      { role: 'assistant', content: 'PROJECTION_REVIEW_DISABLED_MARKER', enabled: false, deletable: true, pinned: false },
    ] };
    await runWorldProjectionStage_ACU({ ...custom, contactedActorIds: ['guard-1'] });
    expect(custom.calls).toHaveLength(1);
    const messages = custom.calls[0][1] as Array<{ role: string; content: string }>;
    expect(messages[1]).toEqual({ role: 'system', content: 'PROJECTION_REVIEW_CUSTOM_MARKER' });
    expect(JSON.stringify(messages)).not.toContain('PROJECTION_REVIEW_DISABLED_MARKER');

    const overflow = baseInput([gated()], reply([{ factId: 'secret-1', triggered: false, evidence: [] }]));
    overflow.settings.worldRoundPrompts = custom.settings.worldRoundPrompts;
    overflow.countTokens = async () => 999_999;
    await expect(runWorldProjectionStage_ACU({ ...overflow, contactedActorIds: ['guard-1'] })).rejects.toThrow(/预算/);
    expect(overflow.calls).toHaveLength(0);
  });
});
