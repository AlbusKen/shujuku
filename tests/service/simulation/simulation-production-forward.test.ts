import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const { model, direct, worldbooks, confirmRegistration } = vi.hoisted(() => ({ model: vi.fn(), direct: vi.fn(),
  worldbooks: vi.fn(async () => ({ available: true, entries: [] })), confirmRegistration: vi.fn(async () => true) }));
vi.mock('../../../src/presentation/theme/confirm-actor-registration', () => ({
  confirmWorldActorRegistration_ACU: confirmRegistration,
}));
vi.mock('../../../src/service/ai/api-call', async original => ({
  ...await original<typeof import('../../../src/service/ai/api-call')>(),
  callAIChatTurn_ACU: model, callAIWithResolvedPreset_ACU: direct,
}));
vi.mock('../../../src/service/continuation/agent/agent-worldbook-read', async original => ({
  ...await original<typeof import('../../../src/service/continuation/agent/agent-worldbook-read')>(),
  loadAgentWorldbookSnapshot_ACU: worldbooks,
}));

import { getWorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { settings_ACU } from '../../../src/service/runtime/state-manager';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { _forceExtensionMode } from '../../../src/shared/runtime-env';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { WorldDeliveryHostStore_ACU } from '../../../src/service/simulation/world-delivery-host-store';
import { readWorldSimulationLedgerAtAnchor_ACU } from '../../../src/service/simulation/agent/agent-module-store';
import { readWorldRoundPayload_ACU } from '../../helpers/world-round-payload';

const sourceText = '主角站在钟楼广场。';
const summary = '钟楼广场的城门已经关闭。';
const place = { region: '城区', place: '钟楼广场' };
let originalPresets: typeof settings_ACU.apiPresets;
const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;
let currentNetwork: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null;
const stableHostFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (!currentNetwork) throw new Error('测试宿主网络未准备');
  return currentNetwork(input, init);
};

_forceExtensionMode();
globalThis.fetch = stableHostFetch;
globalThis.location = { href: 'https://tavern.test/', origin: 'https://tavern.test' } as Location;

afterAll(() => {
  globalThis.fetch = originalFetch;
  globalThis.location = originalLocation;
});

afterEach(() => {
  if (originalPresets) settings_ACU.apiPresets = originalPresets;
  currentNetwork = null;
  confirmRegistration.mockReset();
  confirmRegistration.mockResolvedValue(true);
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

it('正式工厂把资料保存进AI正文，下一请求沿宿主历史读取且不重复追加system或自动审查', async () => {
  originalPresets = structuredClone(settings_ACU.apiPresets);
  settings_ACU.apiPresets = [{ name: 'production-test', apiMode: 'custom', tavernProfile: '', apiConfig: {
    url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test', apiKey: 'test', useMainApi: false,
    sendViaTavern: false, max_tokens: 128, temperature: 0.1, customApiFormat: 'openai_compat',
  } }];
  const chat: any[] = [{}, { message_id: 41, is_user: false, swipe_id: 0, mes: sourceText }];
  let remote = structuredClone(chat);
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = 'single';
  envelope.settings.apiPresetMode = 'fixed';
  envelope.settings.fixedApiPresetName = 'production-test';
  envelope.ledger.player.location = place;
  chat[0]._qrf_world_simulation = envelope;
  const generatedBodies: Record<string, any>[] = [];
  currentNetwork = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'object' && 'url' in input ? input.url : String(input);
    if (url.endsWith('/api/backends/chat-completions/generate')) {
      const body = input instanceof Request ? await input.json() : JSON.parse(String(init?.body));
      generatedBodies.push(body);
      chat.push({ message_id: 42, is_user: false, swipe_id: 0, mes: summary });
      remote = structuredClone(chat);
      return new Response('provider-response', { status: 200 });
    }
    return new Response(JSON.stringify([{}, ...structuredClone(remote)]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  _set_SillyTavern_API_ACU({ chat, chatId: 'production-forward', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'production.png', name: '角色' }], getCurrentChatId: () => 'production-forward',
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
  } as any);
  model.mockImplementation(async (messages: readonly { content: string }[]) => {
    const data = readWorldRoundPayload_ACU(messages);
    let content: unknown;
    if (data.stage === 'clock-candidate') content = { candidateClock: { day: 2, slot: '', storyTime: '第二日', precision: 'exact', evidenceRefs: [] } };
    else if (data.stage === 'recall-selection') content = { selections: [], worldSelection: {
      worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'world',
    } };
    else if (data.stage === 'world-page') content = { worldEventWrites: [], factWrites: [{ expectedRevision: 0, value: {
      id: 'gate-closed', summary, temporalKind: 'occurrence', happenedAt: { day: 2, slot: '' }, validFrom: null,
      validUntil: null, locationRef: place, actorIds: [], worldEventIds: [], projectionPolicy: 'scene', revealState: 'unlocked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    } }] };
    else if (data.stage === 'actor-batch') content = { actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [] };
    else if (messages.some(item => item.content.includes('"stage":"world-narrative-review-v1"'))) content = { locationRef: place, contactedActorIds: [],
      evidence: [{ kind: 'location', actorId: null, quote: '钟楼广场' }], reviews: [] };
    else throw new Error(`unexpected stage ${data.stage}`);
    return { content: JSON.stringify(content), toolCalls: [] };
  });
  direct.mockResolvedValue(JSON.stringify({ results: [{ factId: 'gate-closed', adopted: true, evidenceQuotes: [summary] }] }));
  const runtime = getWorldSimulationRuntime_ACU();
  const outcome = await runtime.sendAgentMessage('推进', 'first');
  if (!outcome || outcome.status === 'failed') throw new Error(JSON.stringify(outcome));
  expect(outcome).toMatchObject({ status: 'completed', identity: { workflowProtocol: 'world-round-v1' } });
  const source = resolveWorldSimulationAnchor_ACU(1, chat);
  expect(chat[1].mes).toContain(sourceText);
  expect(chat[1].mes).toContain(summary);
  expect(remote[1].mes).toBe(chat[1].mes);
  const modelCallsBeforeSend = model.mock.calls.length;
  const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [
      { role: 'assistant', content: chat[1].mes }, { role: 'user', content: '继续' },
    ] }) });
  expect(await response.text()).toBe('provider-response');
  expect(generatedBodies).toHaveLength(1);
  expect(JSON.stringify(generatedBodies[0].messages)).toContain(summary);
  expect(new WorldDeliveryHostStore_ACU(source).read().records).toEqual([]);
  expect(model).toHaveBeenCalledTimes(modelCallsBeforeSend);
  expect(generatedBodies[0].messages.filter((message: { role: string }) => message.role === 'system')).toEqual([]);
  expect(JSON.stringify(generatedBodies[0].messages).match(/qrf-world-simulation-projection:v2:start/g)).toHaveLength(1);
  chat[0]._qrf_world_simulation.settings.autoTriggerEnabled = false;
  const completion = await runtime.handleAssistantCompletion({ eventMessageId: 2, eventMessageIdKind: 'index',
    chatKey: 'production-forward', isolationKey: '', capturedAt: Date.now(), capturedChatLength: chat.length, capturedAiFloorCount: 2 });
  expect(completion).toMatchObject({ status: 'skipped', reason: 'disabled' });
  expect(new WorldDeliveryHostStore_ACU(source).read().records).toEqual([]);
  expect(direct).not.toHaveBeenCalled();
});

function guardedProductionFixture(semanticSatisfied: boolean) {
  originalPresets = structuredClone(settings_ACU.apiPresets);
  settings_ACU.apiPresets = [{ name: 'production-gated-test', apiMode: 'custom', tavernProfile: '', apiConfig: {
    url: 'http://127.0.0.1:43112/v1/chat/completions', model: 'test', apiKey: 'test', useMainApi: false,
    sendViaTavern: false, max_tokens: 128, temperature: 0.1, customApiFormat: 'openai_compat',
  } }];
  const guardedSource = semanticSatisfied
    ? '主角在钟楼广场主动向守卫询问密信。'
    : '主角在钟楼广场与守卫交谈，但没有询问密信。';
  const guardedSummary = '守卫持有钟楼密信原件。';
  const successorText = semanticSatisfied ? '守卫承认自己持有钟楼密信原件。' : '守卫点头，确认城门仍然关闭。';
  const chat: any[] = [{}, { message_id: 51, is_user: false, swipe_id: 0, mes: guardedSource }];
  let remote = structuredClone(chat);
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = 'single';
  envelope.settings.apiPresetMode = 'fixed';
  envelope.settings.fixedApiPresetName = 'production-gated-test';
  envelope.settings.worldRoundPrompts = Object.fromEntries(['joint-reviewer'].map(role => [role,
    [{ role: 'system', content: `CUSTOM_REVIEW_${role}`, enabled: true, deletable: true, pinned: false },
      { role: 'user', content: `DISABLED_REVIEW_${role}`, enabled: false, deletable: true, pinned: false }],
  ]));
  envelope.ledger.player.location = place;
  envelope.ledger.actors = [{
    id: 'tower-guard', name: '守卫', interests: [], location: '钟楼广场', locationRef: place, life: 'alive', diedAtDay: null,
    deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
    currentAction: null, shortTermAction: null, longTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
  }];
  envelope.ledger.facts = [{
    id: 'gated-letter', summary: guardedSummary, temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' }, validFrom: null,
    validUntil: null, locationRef: place, actorIds: ['tower-guard'], worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
    revealGate: { actorIds: ['tower-guard'], locationRef: place, notBefore: { day: 2, slot: '' }, semanticCondition: '主动向守卫询问密信' },
    nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
  }];
  chat[0]._qrf_world_simulation = envelope;
  const generatedBodies: Record<string, any>[] = [];
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'object' && 'url' in input ? input.url : String(input);
    if (url.endsWith('/api/backends/chat-completions/generate')) {
      const body = input instanceof Request ? await input.json() : JSON.parse(String(init?.body));
      generatedBodies.push(body);
      chat.push({ message_id: 52, is_user: false, swipe_id: 0, mes: successorText });
      remote = structuredClone(chat);
      return new Response('provider-response', { status: 200 });
    }
    return new Response(JSON.stringify([{}, ...structuredClone(remote)]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  currentNetwork = network;
  _set_SillyTavern_API_ACU({ chat, chatId: `production-gated-${semanticSatisfied}`, characterId: 0, this_chid: 0,
    characters: [{ avatar: 'production-gated.png', name: '角色' }], getCurrentChatId: () => `production-gated-${semanticSatisfied}`,
    saveChat: vi.fn(async () => { remote = structuredClone(chat); }),
  } as any);
  model.mockImplementation(async (messages: readonly { content: string }[]) => {
    const data = readWorldRoundPayload_ACU(messages);
    if (data.stage !== undefined) {
      if (data.stage === 'clock-candidate') return { content: JSON.stringify({ candidateClock: { day: 2, slot: '', storyTime: '第二日', precision: 'exact', evidenceRefs: [] } }), toolCalls: [] };
      if (data.stage === 'recall-selection') return { content: JSON.stringify({
        selections: data.directory.actorIds.map((actorId: string) => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'actor' })),
        worldSelection: { worldEventIds: [], factIds: [], reason: '无额外资料', priority: 1, scope: 'world' },
      }), toolCalls: [] };
      if (data.stage === 'world-page') return { content: JSON.stringify({ worldEventWrites: [], factWrites: [] }), toolCalls: [] };
      if (data.stage === 'actor-batch') return { content: JSON.stringify({ actorWrites: [],
        actorCompletions: data.actorIds.map((actorId: string) => ({ actorId, completion: 'no_change', expectedRevision: 1 })),
        factWrites: [], historyMilestoneWrites: [],
      }), toolCalls: [] };
      if (data.stage === 'world-narrative-review-v1') {
        const hasGatedCandidate = JSON.stringify(messages).includes('gated-letter');
        return { content: JSON.stringify({ locationRef: place, contactedActorIds: ['tower-guard'], evidence: [
          { kind: 'location', actorId: null, quote: '钟楼广场' }, { kind: 'contact', actorId: 'tower-guard', quote: semanticSatisfied ? '向守卫询问密信' : '与守卫交谈' },
        ], reviews: hasGatedCandidate ? [{ factId: 'gated-letter', triggered: semanticSatisfied,
          evidence: semanticSatisfied ? [{ quote: '主动向守卫询问密信' }] : [],
        }] : [] }), toolCalls: [] };
      }
      throw new Error(`unexpected stage ${data.stage}`);
    }
    throw new Error('unexpected production agent request');
  });
  direct.mockResolvedValue(JSON.stringify({ results: [{ factId: 'gated-letter', adopted: true,
    evidenceQuotes: [semanticSatisfied ? successorText : '守卫点头，确认城门仍然关闭。'] }] }));
  return { chat, generatedBodies, guardedSummary, network, clearNetwork: () => network.mockClear() };
}

describe('正式 gated 投送闭环', () => {
  it.each(['empty', 'internal'] as const)('只有 %s 资料时直接发送，不新增联合审查或投送记录', async kind => {
    const f = guardedProductionFixture(false);
    const ledger = f.chat[0]._qrf_world_simulation.ledger;
    ledger.facts = kind === 'empty' ? [] : ledger.facts.map((fact: Record<string, unknown>) => ({
      ...fact, projectionPolicy: 'internal', revealState: 'unlocked', revealGate: null,
    }));
    const outcome = await getWorldSimulationRuntime_ACU().sendAgentMessage('推进', `no-public-${kind}`);
    expect(outcome).toMatchObject({ status: 'completed' });
    const callsBeforeDispatch = model.mock.calls.length;
    const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '继续' }] }) });
    expect(await response.text()).toBe('provider-response');
    expect(model).toHaveBeenCalledTimes(callsBeforeDispatch);
    expect(f.generatedBodies).toHaveLength(1);
    expect(JSON.stringify(f.generatedBodies[0].messages)).not.toContain(f.guardedSummary);
    expect(new WorldDeliveryHostStore_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat)).read().records).toEqual([]);
    expect(direct).not.toHaveBeenCalled();
  });

  it('真实 runner 审核并同次解锁写入正文，下一请求不再独立system投送或重复审查', async () => {
    const f = guardedProductionFixture(true);
    const runtime = getWorldSimulationRuntime_ACU();
    const outcome = await runtime.sendAgentMessage('推进', 'gated-first');
    if (!outcome || outcome.status === 'failed') throw new Error(JSON.stringify(outcome));
    expect(outcome).toMatchObject({ status: 'completed', identity: { workflowProtocol: 'world-round-v1' } });
    expect(f.chat[0]._qrf_world_simulation.ledger.facts).toMatchObject([{ id: 'gated-letter', revealState: 'unlocked', revision: 2 }]);
    expect(f.chat[1].mes).toContain(f.guardedSummary);
    expect(f.chat[1].mes).toContain('qrf-world-simulation-projection:v2:start');
    expect(f.chat[0]._qrf_world_simulation.task.completedRun).toMatchObject({ workflowProtocol: 'world-round-v1', deliveryTarget: 'body' });
    expect(readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, f.chat), f.chat)?.revision)
      .toBe(f.chat[0]._qrf_world_simulation.ledger.revision);
    f.clearNetwork();
    expect(model.mock.calls.filter(([messages]) => readWorldRoundPayload_ACU(messages).stage === 'world-narrative-review-v1')).toHaveLength(1);
    const modelCallsBeforeDispatch = model.mock.calls.length;

    const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [
        { role: 'assistant', content: f.chat[1].mes }, { role: 'user', content: '继续' },
      ] }) });
    expect(await response.text()).toBe('provider-response');
    expect(f.network.mock.calls.filter(([input]) => {
      const url = typeof input === 'object' && 'url' in input ? input.url : String(input);
      return url.endsWith('/api/backends/chat-completions/generate');
    })).toHaveLength(1);
    expect(model.mock.calls.length).toBe(modelCallsBeforeDispatch);
    expect(model.mock.calls.filter(([messages]) => readWorldRoundPayload_ACU(messages).stage === 'world-narrative-review-v1')).toHaveLength(1);
    expect(f.generatedBodies).toHaveLength(1);
    expect(JSON.stringify(f.generatedBodies[0].messages)).toContain(f.guardedSummary);
    const source = resolveWorldSimulationAnchor_ACU(1, f.chat);
    expect(new WorldDeliveryHostStore_ACU(source).read().records).toEqual([]);
    expect(f.generatedBodies[0].messages.filter((message: { role: string }) => message.role === 'system')).toEqual([]);

    f.chat[0]._qrf_world_simulation.settings.autoTriggerEnabled = false;
    const completion = await runtime.handleAssistantCompletion({ eventMessageId: 2, eventMessageIdKind: 'index',
      chatKey: 'production-gated-true', isolationKey: '', capturedAt: Date.now(), capturedChatLength: f.chat.length, capturedAiFloorCount: 2 });
    expect(completion).toMatchObject({ status: 'skipped', reason: 'disabled' });
    expect(new WorldDeliveryHostStore_ACU(source).read().records).toEqual([]);
    expect(direct).not.toHaveBeenCalled();
    expect(JSON.stringify(model.mock.calls)).toContain('CUSTOM_REVIEW_joint-reviewer');
    expect(JSON.stringify(model.mock.calls)).not.toContain('DISABLED_REVIEW_');
    expect(JSON.stringify(f.generatedBodies[0].messages)).not.toContain('CUSTOM_REVIEW_');

    const callsAfterDelivery = model.mock.calls.length;
    f.network.mockImplementationOnce(async (input, init) => {
      const body = input instanceof Request ? await input.json() : JSON.parse(String(init?.body));
      f.generatedBodies.push(body);
      return new Response('second-provider-response', { status: 200 });
    });
    const second = await fetch('/api/backends/chat-completions/generate', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [
        { role: 'assistant', content: f.chat[1].mes }, { role: 'user', content: '继续' },
      ] }) });
    expect(await second.text()).toBe('second-provider-response');
    expect(model).toHaveBeenCalledTimes(callsAfterDelivery);
    expect(f.generatedBodies).toHaveLength(2);
    expect(JSON.stringify(f.generatedBodies[1].messages)).toContain(f.guardedSummary);
    expect(JSON.stringify(f.generatedBodies[1].messages).match(/qrf-world-simulation-projection:v2:start/g)).toHaveLength(1);
    expect(new WorldDeliveryHostStore_ACU(source).read().records).toEqual([]);
  });

  it('语义门槛未满足时保持 locked，最终请求不含秘密', async () => {
    const f = guardedProductionFixture(false);
    const runtime = getWorldSimulationRuntime_ACU();
    const outcome = await runtime.sendAgentMessage('推进', 'gated-blocked');
    if (!outcome || outcome.status === 'failed') throw new Error(JSON.stringify(outcome));
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(f.chat[0]._qrf_world_simulation.ledger.facts).toMatchObject([{ id: 'gated-letter', revealState: 'locked', revision: 1 }]);
    const callsBeforeDispatch = model.mock.calls.length;

    await fetch('/api/backends/chat-completions/generate', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '继续' }] }) });
    expect(f.generatedBodies).toHaveLength(1);
    expect(JSON.stringify(f.generatedBodies[0].messages)).not.toContain(f.guardedSummary);
    expect(model).toHaveBeenCalledTimes(callsBeforeDispatch);
    expect(model.mock.calls.some(([messages]) => Array.isArray(messages)
      && messages.some((item: { content: string }) => item.content.includes('"stage":"world-narrative-review-v1"')))).toBe(true);
    expect(direct).not.toHaveBeenCalled();
  });
});
