import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { readWorldNarrativeScene_ACU, readWorldNarrativeSemanticReviews_ACU, rebindWorldNarrativeSceneReceipt_ACU, reviewWorldFactPrune_ACU, reviewWorldNarrativeScene_ACU, WORLD_REVIEW_MAINTENANCE_STAGE_ACU } from '../../../../src/service/simulation/agent/world-scene-review';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import type { WorldSimulationTargetAnchor_ACU } from '../../../../src/service/simulation/agent/agent-model';

const anchorText = '我在青石巷的茶馆里向阿宁当面询问昨夜的动静。';
const hostAnchor: WorldSimulationTargetAnchor_ACU = {
  chatIdentity: 'chat-1', messageIndex: 3, messageId: 'message-3', messageKey: 'message-key-3', swipeId: 'swipe-3', contentDigest: sha256HexSync_ACU(anchorText),
};
const logicalAnchor: WorldSimulationTargetAnchor_ACU = {
  kind: 'logical', chatIdentity: 'chat-1', contentDigest: sha256HexSync_ACU(anchorText),
  logicalRef: { sessionId: 'session-1', branchId: 'branch-1', turnId: 'turn-3', attemptId: 'attempt-1', floorId: 'floor-3' },
};

function validLedger() {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.clock = { day: 8, slot: '夜', storyTime: '第八日夜', precision: 'exact', evidenceRefs: [] };
  ledger.player.location = { region: '临安', place: '青石巷' };
  ledger.actors = [{
    id: 'ning', name: '阿宁', interests: [], location: '茶馆', locationRef: { region: '临安', place: '青石巷' }, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: ['绝密账本内容'], visibility: 'hidden',
    currentAction: null, longTermAction: null, shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
  }];
  ledger.facts = [{
    id: 'secret', summary: '绝密事实全文', temporalKind: 'condition', happenedAt: null, validFrom: { day: 1, slot: '' }, validUntil: null,
    locationRef: { region: '临安', place: '密室' }, actorIds: ['ning'], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
    revealGate: { secret: '禁止泄露' }, nextCheck: { day: 9, slot: '', reason: '秘密后续' }, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  }];
  return ledger;
}

function input(anchor: WorldSimulationTargetAnchor_ACU = hostAnchor) {
  const calls: Array<readonly { role: string; content: string }[]> = [];
  return {
    ledger: validLedger(), anchor, anchorText, signal: new AbortController().signal, assertCurrent: () => undefined,
    countTokens: async (text: string) => Math.max(1, Math.ceil(text.length / 8)),
    needsSemanticReview: false,
    invoke: async (messages: readonly { role: string; content: string }[]) => {
      calls.push(messages);
      return JSON.stringify({
        locationRef: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'],
        evidence: [
          { kind: 'location', actorId: null, quote: '青石巷的茶馆里' },
          { kind: 'contact', actorId: 'ning', quote: '向阿宁当面询问' },
        ],
        reviews: [],
      });
    },
    calls,
  };
}

describe('正文场景 AI 审查', () => {
  it('以 host 锚点从正文证据得出地点和实际接触，时钟严格来自账本', async () => {
    const current = input();
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(result).toMatchObject({ sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], time: { day: 8, slot: '夜' }, source: 'narrative-review' });
    expect(current.calls).toHaveLength(1);
    const sent = JSON.stringify(current.calls[0]);
    expect(sent).not.toContain('绝密事实全文');
    expect((sent.match(/我在青石巷的茶馆里向阿宁当面询问昨夜的动静。/g) ?? [])).toHaveLength(1);
    expect(sent).toContain('WORLD_TASK');
    expect(sent).toContain('READ_BUDGET');
    expect(sent).not.toContain('绝密账本内容');
    expect(sent).not.toContain('禁止泄露');
    expect(sent).not.toContain('密室');
  });

  it('同楼层正文摘要变化可审查和读取，跨 swipe 与替换审查文本仍拒绝', async () => {
    const current = input();
    current.anchor = { ...hostAnchor, contentDigest: 'old-host-digest' };
    const reviewed = await reviewWorldNarrativeScene_ACU(current);
    expect(readWorldNarrativeScene_ACU(reviewed.receipt, { ...current, anchor: { ...hostAnchor, contentDigest: 'plugin-new-digest' } }).sceneLocation)
      .toEqual({ region: '临安', place: '青石巷' });
    expect(() => readWorldNarrativeScene_ACU(reviewed.receipt, { ...current, anchor: { ...hostAnchor, swipeId: 'other-swipe' } })).toThrow(/已变化/);
    expect(() => readWorldNarrativeScene_ACU(reviewed.receipt, { ...current, anchorText: '另一段正文' })).toThrow(/已变化/);
  });

  it('以 logical 锚点接受无证据的 null/空联系人结论', async () => {
    const current = input(logicalAnchor);
    current.invoke = async () => JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
    await expect(reviewWorldNarrativeScene_ACU(current)).resolves.toMatchObject({ sceneLocation: null, contactedActorIds: [], time: { day: 8, slot: '夜' } });
  });

  it('缺证据、伪造引用和未知联系人只剔除对应结论，不丢失整轮', async () => {
    const cases = [
      [{ locationRef: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], evidence: [{ kind: 'location', actorId: null, quote: '青石巷' }] }, { sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: [] }],
      [{ locationRef: { region: '临安', place: '青石巷' }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '不存在' }] }, { sceneLocation: null, contactedActorIds: [] }],
      [{ locationRef: null, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '青石巷' }] }, { sceneLocation: null, contactedActorIds: [] }],
      [{ locationRef: null, contactedActorIds: ['other'], evidence: [{ kind: 'contact', actorId: 'other', quote: '阿宁' }] }, { sceneLocation: null, contactedActorIds: [] }],
    ] as const;
    for (const [reply, expected] of cases) {
      const current = input();
      current.invoke = async () => JSON.stringify(reply);
      await expect(reviewWorldNarrativeScene_ACU(current)).resolves.toMatchObject(expected);
    }
  });

  it('接受唯一 JSON 包裹、额外字段、缺数组与姓名归一；坏证据不影响有证据接触', async () => {
    const current = input();
    current.invoke = async () => `这里是审查结果：\n\`\`\`json\n${JSON.stringify({
      locationRef: { region: '临安', place: '青石巷', note: '额外字段' }, contactedActorIds: [' NING ', '阿宁', 'other'],
      evidence: [
        { kind: 'location', quote: '青石巷的茶馆里', note: true },
        { kind: 'contact', actorId: ' 阿宁 ', quote: '向阿宁当面询问' },
        { kind: 'contact', actorId: 'ning', quote: '不存在' },
      ], note: '忽略',
    })}\n\`\`\``;
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(result).toMatchObject({ sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'] });
    const empty = input();
    empty.invoke = async () => JSON.stringify({ locationRef: null, evidence: null, contactedActorIds: null, reviews: null });
    await expect(reviewWorldNarrativeScene_ACU(empty)).resolves.toMatchObject({ sceneLocation: null, contactedActorIds: [] });
  });

  it('空白差异引文仅匹配冻结正文连续片段；语义候选缺失默认 false，真实引文可触发', async () => {
    const current = input();
    current.anchorText = '我在青石巷的茶馆里向阿宁当面询问昨夜的动静。\n她提到了密室。';
    current.anchor = { ...hostAnchor, contentDigest: sha256HexSync_ACU(current.anchorText) };
    current.needsSemanticReview = true;
    current.ledger.facts[0].revealGate = { semanticCondition: '她提到密室' };
    current.invoke = async () => JSON.stringify({
      locationRef: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'],
      evidence: [{ kind: 'location', quote: '青石巷 的茶馆里' }, { kind: 'contact', actorId: 'ning', quote: '向阿宁 当面询问' }],
      reviews: [{ factId: 'secret', triggered: true, evidence: [{ quote: '不存在' }] }, { factId: 'extra', triggered: true, evidence: [{ quote: '密室' }] }],
    });
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(result).toMatchObject({ sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'] });
    expect(readWorldNarrativeSemanticReviews_ACU(result.receipt, current).get('secret')).toBe(false);
    current.invoke = async () => JSON.stringify({ reviews: [
      { factId: 'secret', triggered: false },
      { factId: 'secret', triggered: true, evidence: [{ quote: '她提到了密室' }] },
    ] });
    const triggered = await reviewWorldNarrativeScene_ACU(current);
    expect(readWorldNarrativeSemanticReviews_ACU(triggered.receipt, current).get('secret')).toBe(true);
    current.invoke = async () => JSON.stringify({});
    const missing = await reviewWorldNarrativeScene_ACU(current);
    expect(readWorldNarrativeSemanticReviews_ACU(missing.receipt, current).get('secret')).toBe(false);
  });

  it('无法解析或包含多个 JSON 对象的响应仍报错', async () => {
    for (const reply of ['没有结果', '{}\n{}', '[]']) {
      const current = input();
      current.invoke = async () => reply;
      await expect(reviewWorldNarrativeScene_ACU(current)).rejects.toThrow(/JSON/);
    }
  });

  it('回执绑定完整账本、锚点与冻结正文，只返回深拷贝冻结结果', async () => {
    const current = input();
    const result = await reviewWorldNarrativeScene_ACU(current);
    const first = readWorldNarrativeScene_ACU(result.receipt, current);
    first.contactedActorIds.push('forged');
    first.time.day = 99;
    expect(readWorldNarrativeScene_ACU(result.receipt, current)).toEqual({
      sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], time: { day: 8, slot: '夜' }, source: 'narrative-review',
    });
    await expect(Promise.resolve().then(() => readWorldNarrativeScene_ACU({} as never, current))).rejects.toThrow(/回执/);
    current.ledger.actors[0].name = '篡改';
    expect(() => readWorldNarrativeScene_ACU(result.receipt, current)).toThrow(/已变化/);
  });

  it('取消、租约失效、非法账本/时钟、回调故障或异步期间输入篡改均 fail closed', async () => {
    const cancelled = input();
    const controller = new AbortController(); controller.abort();
    cancelled.signal = controller.signal;
    await expect(reviewWorldNarrativeScene_ACU(cancelled)).rejects.toThrow(/取消/);

    const stale = input();
    stale.assertCurrent = () => { throw new Error('租约已失效'); };
    await expect(reviewWorldNarrativeScene_ACU(stale)).rejects.toThrow(/租约/);

    const malformed = input();
    malformed.ledger.clock.day = 0;
    await expect(reviewWorldNarrativeScene_ACU(malformed)).rejects.toThrow(/账本/);
    const fractional = input();
    fractional.ledger.clock.day = 1.5;
    await expect(reviewWorldNarrativeScene_ACU(fractional)).rejects.toThrow(/账本|时钟/);

    const countFailure = input();
    countFailure.countTokens = async () => { throw new Error('secret-token'); };
    await expect(reviewWorldNarrativeScene_ACU(countFailure)).rejects.toThrow(/令牌计数调用失败/);
    const invokeFailure = input();
    invokeFailure.invoke = async () => { throw new Error('api-key-secret'); };
    await expect(reviewWorldNarrativeScene_ACU(invokeFailure)).rejects.toThrow(/模型调用失败/);

    const tampered = input();
    tampered.invoke = async () => {
      tampered.anchorText = '已篡改正文';
      return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [] });
    };
    await expect(reviewWorldNarrativeScene_ACU(tampered)).rejects.toThrow(/已变化/);
  });
  it('自定义 scene-review 提示词插在固定协议后，禁用段不发送且超预算不调用', async () => {
    const current = input();
    current.settings = { worldRoundPrompts: { 'joint-reviewer': [
      { role: 'system', content: 'JOINT_REVIEW_CUSTOM_MARKER', enabled: true, deletable: true, pinned: false },
      { role: 'user', content: 'JOINT_REVIEW_DISABLED_MARKER', enabled: false, deletable: true, pinned: false },
    ] } };
    await reviewWorldNarrativeScene_ACU(current);
    const sent = current.calls[0];
    expect(sent[0].role).toBe('system');
    expect(JSON.stringify(sent)).toContain('JOINT_REVIEW_CUSTOM_MARKER');
    expect(JSON.stringify(sent)).not.toContain('JOINT_REVIEW_DISABLED_MARKER');

    const overflow = input();
    overflow.settings = { ...current.settings, agentHistoryTokenBudget: 8000 };
    overflow.countTokens = async () => 9000;
    await expect(reviewWorldNarrativeScene_ACU(overflow)).rejects.toThrow(/9000.*8000.*预算/);
    expect(overflow.calls).toHaveLength(0);
  });

  it('场景输入超过旧8192上限但在页面预算内正常审查，不再合计输出拒收', async () => {
    const current = input();
    current.settings = { agentHistoryTokenBudget: 30000 };
    const counted: string[] = [];
    current.countTokens = async text => {
      counted.push(text);
      return text.startsWith('[') ? 9000 : 29000;
    };
    await expect(reviewWorldNarrativeScene_ACU(current)).resolves.toMatchObject({ contactedActorIds: ['ning'] });
    expect(current.calls).toHaveLength(1);
    expect(current.calls[0].map(message => message.content).join('\n')).toMatch(/"inputTokenBudget"\s*:\s*30000/);
    expect(JSON.stringify(current.calls[0])).not.toContain('inputOutputTokenBudget');
    expect(counted).toHaveLength(1);
  });

  it('未传预算或仅传自定义提示词时使用全局默认输入预算，等于上限可调用', async () => {
    const budget = buildDefaultWorldSimulationSettings_ACU().agentHistoryTokenBudget;
    for (const settings of [undefined, { worldRoundPrompts: {} }]) {
      const current = { ...input(), settings };
      current.countTokens = async () => budget;
      await reviewWorldNarrativeScene_ACU(current);
      expect(current.calls[0].map(message => message.content).join('\n')).toMatch(new RegExp(`"inputTokenBudget"\\s*:\\s*${budget}`));
      const overflow = { ...input(), settings };
      overflow.countTokens = async () => budget + 1;
      await expect(reviewWorldNarrativeScene_ACU(overflow)).rejects.toThrow(`${budget} 令牌预算`);
      expect(overflow.calls).toHaveLength(0);
    }
  });
});

const pruneCandidate = { id: 'stale', summary: '旧封路状态', projectionPolicy: 'internal' as const, revealState: 'locked' as const, temporalKind: 'occurrence' as const };
function staleFact() {
  return { id: 'stale', summary: '旧封路状态全文', temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
    locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'internal' as const, revealState: 'locked' as const, revealGate: null,
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
}
const sceneReply = {
  locationRef: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'],
  evidence: [{ kind: 'location', actorId: null, quote: '青石巷的茶馆里' }, { kind: 'contact', actorId: 'ning', quote: '向阿宁当面询问' }],
  reviews: [],
};

describe('联合审查的内部事实清理职责', () => {
  it('同一次场景审查请求附带可清理候选目录，回复的 pruneFactIds 只保留目录内 ID', async () => {
    const current = { ...input(), pruneCandidates: [pruneCandidate] };
    current.ledger.facts.push(staleFact());
    current.invoke = async messages => {
      current.calls.push(messages);
      return JSON.stringify({ ...sceneReply, pruneFactIds: ['stale', 'ghost', 'secret'] });
    };
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(current.calls).toHaveLength(1);
    expect(result).toMatchObject({ sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], pruneFactIds: ['stale'] });
    const sent = JSON.stringify(current.calls[0]);
    expect(sent).toContain('pruneCandidates');
    expect(sent).toContain('旧封路状态');
    expect(current.calls[0][0].content).toContain('"pruneFactIds":string[]');
    expect(sent).not.toContain('旧封路状态全文');
    expect(sent).not.toContain('绝密事实全文');
  });

  it('没有候选时请求与协议不含清理说明，pruneFactIds 为空', async () => {
    const current = input();
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(result.pruneFactIds).toEqual([]);
    // 固定协议与资料块不含清理字段；默认业务稿的清理说明本身以“程序提供可清理候选时”为条件。
    expect(current.calls[0][0].content).not.toContain('pruneFactIds');
    expect(current.calls[0].map(message => message.content).join('\n')).not.toContain('"pruneCandidates"');
  });

  it('清理部分畸形只使清理为空，场景与接触结论不受影响', async () => {
    for (const pruneFactIds of ['stale', [null, 3, {}], { stale: true }]) {
      const current = { ...input(), pruneCandidates: [pruneCandidate] };
      current.invoke = async () => JSON.stringify({ ...sceneReply, pruneFactIds });
      await expect(reviewWorldNarrativeScene_ACU(current)).resolves.toMatchObject({
        sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], pruneFactIds: [],
      });
    }
  });

  it('目录与场景审查一起超预算时先折半收缩目录，场景审查本身放不下才报错', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ ...pruneCandidate, id: `stale-${index}`, summary: `旧状态${index}` }));
    const current = { ...input(), pruneCandidates: many };
    current.settings = { agentHistoryTokenBudget: 8000 };
    current.countTokens = async text => (text.match(/stale-\d/g) ?? []).length > 2 ? 9000 : 100;
    current.invoke = async messages => {
      current.calls.push(messages);
      return JSON.stringify({ ...sceneReply, pruneFactIds: many.map(item => item.id) });
    };
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(result.pruneFactIds.length).toBeLessThanOrEqual(2);
    expect(result.pruneFactIds.length).toBeGreaterThan(0);
    const hopeless = { ...input(), pruneCandidates: many };
    hopeless.settings = { agentHistoryTokenBudget: 8000 };
    hopeless.countTokens = async () => 9000;
    await expect(reviewWorldNarrativeScene_ACU(hopeless)).rejects.toThrow(/预算/);
    expect(hopeless.calls).toHaveLength(0);
  });

  it('仅清理请求：无候选不发请求；有候选使用同一角色自定义稿与输入预算并解析目录内 ID', async () => {
    const calls: Array<readonly { role: string; content: string }[]> = [];
    const base = {
      signal: new AbortController().signal, assertCurrent: () => undefined, countTokens: async () => 10,
      settings: { agentHistoryTokenBudget: 30000, worldRoundPrompts: { 'joint-reviewer': [
        { role: 'system' as const, content: 'PRUNE_CUSTOM_MARKER', enabled: true, deletable: true, pinned: false },
      ] } },
      invoke: async (messages: readonly { role: string; content: string }[]) => { calls.push(messages); return '说明文字 {"pruneFactIds":["stale","ghost"]}'; },
    };
    await expect(reviewWorldFactPrune_ACU({ ...base, candidates: [] })).resolves.toEqual({ pruneFactIds: [], pruneEventIds: [], offered: 0, offeredEvents: 0 });
    expect(calls).toHaveLength(0);
    await expect(reviewWorldFactPrune_ACU({ ...base, candidates: [pruneCandidate], anchorText })).resolves.toMatchObject({ pruneFactIds: ['stale'], pruneEventIds: [], offered: 1 });
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]);
    expect(sent).toContain('PRUNE_CUSTOM_MARKER');
    expect(sent).toContain('pruneCandidates');
    expect(sent).toMatch(/inputTokenBudget\\?"\s*:\s*30000/);
    expect(sent).toContain(anchorText);
    expect(calls[0][0].content).toContain('不审查场景');
  });

  it('仅清理请求：回复无法解析、超预算或取消均抛错而不静默，由调用方决定跳过', async () => {
    const base = { candidates: [pruneCandidate], signal: new AbortController().signal, assertCurrent: () => undefined, countTokens: async () => 10,
      invoke: async () => '不是 JSON' };
    await expect(reviewWorldFactPrune_ACU(base)).rejects.toThrow(/JSON/);
    await expect(reviewWorldFactPrune_ACU({ ...base, invoke: async () => '{"pruneFactIds":[]}', countTokens: async () => 10_000_000 })).rejects.toThrow(/预算/);
    const controller = new AbortController(); controller.abort();
    await expect(reviewWorldFactPrune_ACU({ ...base, signal: controller.signal })).rejects.toThrow(/取消/);
  });

  it('清理后回执改绑到新账本：旧账本不再通过，且新账本不得仍含被删事实', async () => {
    const current = { ...input(), pruneCandidates: [pruneCandidate] };
    current.ledger.facts.push(staleFact());
    current.invoke = async () => JSON.stringify({ ...sceneReply, pruneFactIds: ['stale'] });
    const result = await reviewWorldNarrativeScene_ACU(current);
    const pruned = structuredClone(current.ledger);
    pruned.facts = pruned.facts.filter(item => item.id !== 'stale');
    const rebind = (ledger: typeof pruned) => rebindWorldNarrativeSceneReceipt_ACU(result.receipt, { ...current, prunedLedger: ledger, removedFactIds: ['stale'] });
    expect(() => rebind(current.ledger)).toThrow(/仍含被删事实/);
    rebind(pruned);
    expect(readWorldNarrativeScene_ACU(result.receipt, { ...current, ledger: pruned }).contactedActorIds).toEqual(['ning']);
    expect(() => readWorldNarrativeScene_ACU(result.receipt, current)).toThrow(/已变化/);
    expect(() => rebind({ ...pruned, clock: { ...pruned.clock, day: 99 } })).toThrow();
  });
});

const pruneEvent = { id: 'ended-a', title: '旧封路', state: '已收束', status: 'resolved' as const };

describe('联合审查的已结束事件清理职责', () => {
  it('同一次场景审查请求附带事件目录，回复的 pruneEventIds 只保留目录内 ID，协议与任务文案带上事件字段', async () => {
    const current = { ...input(), pruneEventCandidates: [pruneEvent] };
    current.invoke = async messages => {
      current.calls.push(messages);
      return JSON.stringify({ ...sceneReply, pruneEventIds: ['ended-a', 'active-1', 'ghost'], pruneFactIds: ['ended-a'] });
    };
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(current.calls).toHaveLength(1);
    expect(result).toMatchObject({ contactedActorIds: ['ning'], pruneEventIds: ['ended-a'], pruneFactIds: [] });
    const sent = JSON.stringify(current.calls[0]);
    expect(sent).toContain('pruneEventCandidates');
    expect(sent).toContain('旧封路');
    expect(sent).not.toContain('"pruneCandidates"');
    expect(current.calls[0][0].content).toContain('"pruneEventIds":string[]');
    expect(current.calls[0][0].content).not.toContain('"pruneFactIds":string[]');
    expect(sent).toContain('pruneEventIds');
  });

  it('事实与事件目录同时存在时两个字段都出现在协议里', async () => {
    const current = { ...input(), pruneCandidates: [pruneCandidate], pruneEventCandidates: [pruneEvent] };
    current.ledger.facts.push(staleFact());
    current.invoke = async messages => {
      current.calls.push(messages);
      return JSON.stringify({ ...sceneReply, pruneFactIds: ['stale'], pruneEventIds: ['ended-a'] });
    };
    await expect(reviewWorldNarrativeScene_ACU(current)).resolves.toMatchObject({ pruneFactIds: ['stale'], pruneEventIds: ['ended-a'] });
    expect(current.calls[0][0].content).toContain('"pruneFactIds":string[]、"pruneEventIds":string[]');
  });

  it('没有事件目录时 pruneEventIds 为空数组，回复里有也不采纳；畸形回复只让清理为空', async () => {
    const plain = input();
    plain.invoke = async messages => { plain.calls.push(messages); return JSON.stringify({ ...sceneReply, pruneEventIds: ['ended-a'] }); };
    await expect(reviewWorldNarrativeScene_ACU(plain)).resolves.toMatchObject({ pruneEventIds: [] });
    expect(plain.calls[0][0].content).not.toContain('pruneEventIds');
    for (const pruneEventIds of ['ended-a', [null, 3, {}], { 'ended-a': true }]) {
      const current = { ...input(), pruneEventCandidates: [pruneEvent] };
      current.invoke = async () => JSON.stringify({ ...sceneReply, pruneEventIds });
      await expect(reviewWorldNarrativeScene_ACU(current)).resolves.toMatchObject({
        sceneLocation: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], pruneEventIds: [],
      });
    }
  });

  it('事实与事件目录共享预算，超预算时一起折半', async () => {
    const facts = Array.from({ length: 8 }, (_, index) => ({ ...pruneCandidate, id: `stale-${index}`, summary: `旧状态${index}` }));
    const events = Array.from({ length: 8 }, (_, index) => ({ ...pruneEvent, id: `ended-${index}`, title: `旧事件${index}` }));
    const current = { ...input(), pruneCandidates: facts, pruneEventCandidates: events };
    current.settings = { agentHistoryTokenBudget: 8000 };
    current.countTokens = async text => (text.match(/stale-\d|ended-\d/g) ?? []).length > 4 ? 9000 : 100;
    current.invoke = async messages => {
      current.calls.push(messages);
      return JSON.stringify({ ...sceneReply, pruneFactIds: facts.map(item => item.id), pruneEventIds: events.map(item => item.id) });
    };
    const result = await reviewWorldNarrativeScene_ACU(current);
    expect(result.pruneFactIds.length + result.pruneEventIds.length).toBeLessThanOrEqual(4);
    expect(result.pruneFactIds.length).toBeGreaterThan(0);
    expect(result.pruneEventIds.length).toBeGreaterThan(0);
  });

  it('仅清理请求：只有事件目录也发请求，带本轮正文，回复解析 pruneEventIds；两类目录都空才不发', async () => {
    const calls: Array<readonly { role: string; content: string }[]> = [];
    const base = {
      signal: new AbortController().signal, assertCurrent: () => undefined, countTokens: async () => 10,
      invoke: async (messages: readonly { role: string; content: string }[]) => { calls.push(messages); return '{"pruneEventIds":["ended-a","ghost"],"pruneFactIds":["stale"]}'; },
    };
    await expect(reviewWorldFactPrune_ACU({ ...base, candidates: [], eventCandidates: [] })).resolves.toEqual({
      pruneFactIds: [], pruneEventIds: [], offered: 0, offeredEvents: 0 });
    expect(calls).toHaveLength(0);
    await expect(reviewWorldFactPrune_ACU({ ...base, candidates: [], eventCandidates: [pruneEvent], anchorText })).resolves.toEqual({
      pruneFactIds: [], pruneEventIds: ['ended-a'], offered: 0, offeredEvents: 1 });
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]);
    expect(sent).toContain('pruneEventCandidates');
    expect(sent).not.toContain('"pruneCandidates"');
    expect(sent).toContain(anchorText);
    expect(calls[0][0].content).toContain('{"pruneEventIds":string[]}');
    expect(calls[0][0].content).toContain('内部管理事实清理审查');
  });

  it('清理后回执改绑到新账本：新账本不得仍含被删事件', async () => {
    const current = { ...input(), pruneEventCandidates: [pruneEvent] };
    const event = { id: 'ended-a', title: '旧封路', state: '已收束', status: 'resolved' as const, actorIds: [], organizationIds: [], locationRefs: [],
      startedAt: null, deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null };
    current.ledger.worldEvents = [event];
    current.invoke = async () => JSON.stringify({ ...sceneReply, pruneEventIds: ['ended-a'] });
    const result = await reviewWorldNarrativeScene_ACU(current);
    const pruned = structuredClone(current.ledger);
    pruned.worldEvents = [];
    const rebind = (ledger: typeof pruned) => rebindWorldNarrativeSceneReceipt_ACU(result.receipt, {
      ...current, prunedLedger: ledger, removedFactIds: [], removedEventIds: ['ended-a'] });
    expect(() => rebind(current.ledger)).toThrow(/仍含被删事件/);
    rebind(pruned);
    expect(readWorldNarrativeScene_ACU(result.receipt, { ...current, ledger: pruned }).contactedActorIds).toEqual(['ning']);
  });

  describe('重要历史职责', () => {
    const historyMaterials = (): import('../../../../src/service/simulation/world-history-review').WorldHistoryReviewMaterials_ACU => ({
      changes: { facts: [{ id: 'f1', summary: '两人约定同行' }, { id: 'f2', summary: '第二条' }], actors: [], events: [] },
      catalog: [{ id: 'h-old', summary: '旧事', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [] }],
      recordingMaterials: [], deliveryText: '',
    });
    const sceneReply = { locationRef: { region: '临安', place: '青石巷' }, contactedActorIds: ['ning'], evidence: [
      { kind: 'location', actorId: null, quote: '青石巷的茶馆里' }, { kind: 'contact', actorId: 'ning', quote: '向阿宁当面询问' }], reviews: [] };

    it('联合请求：协议与任务声明历史职责，资料进入 WORLD_RUNTIME_CONTEXT，回复里的历史原样交给调用方（未经结构校验）', async () => {
      const current = { ...input(), history: historyMaterials() };
      current.invoke = async messages => {
        current.calls.push(messages);
        return JSON.stringify({ ...sceneReply, History_Milestones: { id: 'x', summary: '单对象' }, recordings: [] });
      };
      const result = await reviewWorldNarrativeScene_ACU(current);
      const sent = JSON.stringify(current.calls[0]);
      expect(current.calls[0][0].content).toContain('"historyMilestoneWrites"');
      expect(current.calls[0][0].content).not.toContain('historyRecordingCandidates');
      expect(current.calls[0][0].content).not.toContain('pruneFactIds');
      expect(sent).toContain('historyChanges');
      expect(sent).toContain('historyCatalog');
      expect(sent).toContain('两人约定同行');
      expect(result.history!.offered.changes.facts.map(item => item.id)).toEqual(['f1', 'f2']);
      expect(result.history!.reply).toEqual({ milestones: [{ id: 'x', summary: '单对象' }], recordings: [], malformed: false });
      expect(result.contactedActorIds).toEqual(['ning']);
    });

    it('没有历史职责时请求与回复保持原样；历史字段畸形不影响场景审查', async () => {
      const plain = input();
      const plainResult = await reviewWorldNarrativeScene_ACU(plain);
      expect(plainResult.history).toBeUndefined();
      expect(plain.calls[0][0].content).not.toContain('historyMilestoneWrites');
      expect(plain.calls[0].some(message => message.content.includes('\"historyChanges\"'))).toBe(false);
      const current = { ...input(), history: historyMaterials() };
      current.invoke = async () => JSON.stringify({ ...sceneReply, historyMilestoneWrites: '垃圾' });
      const result = await reviewWorldNarrativeScene_ACU(current);
      expect(result.history!.reply).toEqual({ milestones: [], recordings: [], malformed: true });
      expect(result.sceneLocation).toEqual({ region: '临安', place: '青石巷' });
    });

    it('超预算时事实、历史资料一起折半后仍能发出请求，offered 反映折半后的资料', async () => {
      const current = { ...input(), history: { ...historyMaterials(), changes: {
        facts: Array.from({ length: 8 }, (_, index) => ({ id: `f${index}`, summary: `事实${index}` })), actors: [], events: [] } } };
      current.settings = { agentHistoryTokenBudget: 8000 };
      current.countTokens = async text => (text.includes('事实7') ? 9000 : 100);
      current.invoke = async messages => { current.calls.push(messages); return JSON.stringify(sceneReply); };
      const result = await reviewWorldNarrativeScene_ACU(current);
      expect(current.calls).toHaveLength(1);
      expect(result.history!.offered.changes.facts.map(item => item.id)).toEqual(['f0', 'f1', 'f2', 'f3']);
      expect(JSON.stringify(current.calls[0])).not.toContain('事实7');
    });

    it('仅审查请求：stage 为 world-review-maintenance-v1，只有历史资料也发请求，任务与协议声明历史字段，标记资料带投送文本', async () => {
      const calls: Array<readonly { role: string; content: string }[]> = [];
      const base = {
        signal: new AbortController().signal, assertCurrent: () => undefined, countTokens: async () => 10, candidates: [],
        invoke: async (messages: readonly { role: string; content: string }[]) => { calls.push(messages); return '{"historyRecordingCandidates":{"historyId":"h-old"},"historyMilestoneWrites":[]}'; },
      };
      const materials = { ...historyMaterials(), recordingMaterials: [{ id: 'h-old', summary: '旧事', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [],
        locationRef: null, sourceFactIds: [], importance: 1, category: '行动', visibility: 'internal' as const, revision: 1, legacyRefs: [] }], deliveryText: '投送：旧事' };
      // 只有已有历史目录（没有变化、没有标记资料）不构成职责，不发请求。
      await expect(reviewWorldFactPrune_ACU({ ...base, history: { ...historyMaterials(), changes: { facts: [], actors: [], events: [] } } }))
        .resolves.toEqual({ pruneFactIds: [], pruneEventIds: [], offered: 0, offeredEvents: 0 });
      expect(calls).toHaveLength(0);
      const result = await reviewWorldFactPrune_ACU({ ...base, history: materials, anchorText });
      expect(calls).toHaveLength(1);
      expect(WORLD_REVIEW_MAINTENANCE_STAGE_ACU).toBe('world-review-maintenance-v1');
      const sent = JSON.stringify(calls[0]);
      expect(sent).toContain('world-review-maintenance-v1');
      expect(sent).not.toContain('world-fact-prune-v1');
      expect(sent).toContain('historyRecordingMaterials');
      expect(sent).toContain('投送：旧事');
      expect(sent).toContain(anchorText);
      expect(calls[0][0].content).toContain('"historyMilestoneWrites"');
      expect(calls[0][0].content).toContain('"historyRecordingCandidates"');
      expect(result.history!.reply.recordings).toEqual([{ historyId: 'h-old' }]);
      expect(result.pruneFactIds).toEqual([]);
    });
  });
});
