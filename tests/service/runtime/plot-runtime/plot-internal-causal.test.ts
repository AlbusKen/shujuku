import { describe, expect, it, vi } from 'vitest';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { validateWorldSimulationLedger_ACU } from '../../../../src/service/simulation/simulation-store';
import {
  PLOT_INTERNAL_CAUSAL_MAX_TOKENS_ACU,
  buildPlotInternalCausalMessage_ACU,
  validatePlotInternalCausalView_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-internal-causal';
import { parsePlotInternalCausalResult_ACU } from '../../../../src/service/runtime/plot-runtime/plot-internal-causal-result';
import type { ConfirmedSimulationCausalView_ACU } from '../../../../src/service/zero-layer/simulation-causal-view';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createDomainView(): ConfirmedSimulationCausalView_ACU {
  const view = {
    revision: 7,
    source: { sessionId: 'session-1', branchId: 'branch-1', turnId: 'turn-1', attemptId: 'attempt-1', floorId: 'floor-1' },
    worldEvents: [{
      id: 'event-1', title: '商队停留', state: '商队已在边境停留', status: 'active', startedAt: { day: 2, slot: '上午' },
      nextCheck: { day: 3, slot: '下午', reason: '检查停留进展' }, deadline: null,
      locationRefs: [{ region: '边境', place: '驿站' }], actorIds: ['actor-1'], organizationIds: [],
      relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], legacy: null, revision: 1,
    }],
    actors: [{
      id: 'actor-1', name: '守卫', interests: [], location: '边境驿站', locationRef: { region: '边境', place: '驿站' },
      life: 'alive', diedAtDay: null, deathSummary: null, resources: ['钥匙'], goals: ['守住秘密'], constraints: [],
      informationSources: [], knownFacts: ['locked-fact'], visibility: 'hidden', currentAction: null, longTermAction: null,
      shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
    }],
    historyMilestones: [{
      id: 'history-1', summary: '守卫完成秘密调动', happenedAt: { day: 2, slot: '上午' }, actorIds: ['actor-1'],
      worldEventIds: ['event-1'], locationRef: { region: '边境', place: '驿站' }, sourceFactIds: ['locked-fact'],
      importance: 1, category: '行动', visibility: 'internal', revision: 1, legacyRefs: [],
    }],
    facts: [{
      id: 'locked-fact', summary: '锁定秘密：守卫已更换巡逻路线', temporalKind: 'occurrence', happenedAt: { day: 2, slot: '上午' },
      validFrom: null, validUntil: null, locationRef: { region: '边境', place: '驿站' }, actorIds: ['actor-1'],
      worldEventIds: ['event-1'], projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    }],
    fingerprint: '',
  } satisfies ConfirmedSimulationCausalView_ACU;
  validateWorldSimulationLedger_ACU({ ...buildEmptyWorldSimulationLedger_ACU(), revision: view.revision,
    worldEvents: view.worldEvents, actors: view.actors, historyMilestones: view.historyMilestones, facts: view.facts }, 'load');
  view.fingerprint = sha256HexSync_ACU(canonicalJson({
    revision: view.revision, ref: view.source, worldEvents: view.worldEvents, actors: view.actors,
    historyMilestones: view.historyMilestones, facts: view.facts,
  }));
  return view;
}

function options(countTokens = async () => 16) {
  return { signal: new AbortController().signal, assertCurrent: vi.fn(), countTokens };
}

function payload(message: { content: string }): unknown {
  return JSON.parse(message.content.slice(message.content.indexOf('\n') + 1));
}

describe('剧情任务内部因果资料', () => {
  it('仅以 system 消息完整封装四类已确认资料，含 locked 事实且明确不是正文授权', async () => {
    const view = createDomainView();
    const before = structuredClone(view);
    const message = await buildPlotInternalCausalMessage_ACU(view, options());

    expect(message.role).toBe('system');
    expect(message.content).toContain('仅供本内部因果任务使用');
    expect(message.content).toContain('不得将其视为正文授权');
    expect(message.content).toContain('只能是严格 JSON 对象');
    expect(message.content).toContain('锁定秘密：守卫已更换巡逻路线');
    expect(payload(message)).toEqual({
      revision: view.revision, source: view.source, worldEvents: view.worldEvents, actors: view.actors,
      historyMilestones: view.historyMilestones, facts: view.facts,
    });
    expect(view).toEqual(before);
  });

  it('拒绝 null、顶层或 source 非精确形状及伪造指纹', async () => {
    await expect(buildPlotInternalCausalMessage_ACU(null, options())).rejects.toThrow('结构无效');
    const malformed = createDomainView() as any;
    malformed.extra = true;
    await expect(buildPlotInternalCausalMessage_ACU(malformed, options())).rejects.toThrow('结构无效');
    const badSource = createDomainView() as any;
    badSource.source.extra = true;
    await expect(buildPlotInternalCausalMessage_ACU(badSource, options())).rejects.toThrow('结构无效');
    const forged = createDomainView();
    forged.fingerprint = '0'.repeat(64);
    await expect(buildPlotInternalCausalMessage_ACU(forged, options())).rejects.toThrow('校验失败');
  });

  it.each([NaN, Infinity, 0, PLOT_INTERNAL_CAUSAL_MAX_TOKENS_ACU + 1])('拒绝非法或超限令牌计数 %s', async count => {
    await expect(buildPlotInternalCausalMessage_ACU(createDomainView(), options(async () => count))).rejects.toThrow('令牌预算');
  });

  it('异步计数时视图变化或取消均 fail-closed，且错误不含 locked 摘要', async () => {
    const mutable = createDomainView();
    const secret = mutable.facts[0].summary;
    const changed = buildPlotInternalCausalMessage_ACU(mutable, options(async () => {
      mutable.facts[0].summary = '篡改';
      return 16;
    }));
    await expect(changed).rejects.not.toThrow(secret);
    await expect(changed).rejects.toThrow('校验失败');

    const controller = new AbortController();
    const aborted = buildPlotInternalCausalMessage_ACU(createDomainView(), {
      signal: controller.signal,
      assertCurrent: vi.fn(),
      countTokens: async () => {
        controller.abort();
        return 16;
      },
    });
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('计数器异常统一为安全分类，且不泄漏内部资料', async () => {
    const secret = createDomainView().facts[0].summary;
    await expect(buildPlotInternalCausalMessage_ACU(createDomainView(), options(async () => {
      throw new Error(`counter ${secret}`);
    }))).rejects.toThrow('令牌预算计算失败');
    try {
      await buildPlotInternalCausalMessage_ACU(createDomainView(), options(async () => {
        throw new Error(`counter ${secret}`);
      }));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
  it('严格解析冻结视图内的事实选择，并深克隆 typed 结果', () => {
    const view = createDomainView();
    const raw = JSON.stringify({ selectedFactIds: ['locked-fact'] });
    const result = parsePlotInternalCausalResult_ACU(raw, view);
    expect(result).toEqual({ schemaVersion: 1, viewFingerprint: view.fingerprint, selectedFactIds: ['locked-fact'] });
    result.selectedFactIds.push('mutated');
    expect(parsePlotInternalCausalResult_ACU(raw, view).selectedFactIds).toEqual(['locked-fact']);
  });

  it.each([
    '{"selectedFactIds":["missing"]}',
    '{"selectedFactIds":["locked-fact","locked-fact"]}',
    '{"selectedFactIds":[],"extra":true}',
    '```json\n{"selectedFactIds":[]}\n```',
    '{"selectedFactIds":[""]}',
  ])('拒绝越界、重复或非严格 JSON 内部结果', raw => {
    expect(() => parsePlotInternalCausalResult_ACU(raw, createDomainView())).toThrow('回复格式无效');
  });

  it('接受空选择并拒绝超过原始回复上限', () => {
    const view = createDomainView();
    expect(parsePlotInternalCausalResult_ACU('{"selectedFactIds":[]}', view).selectedFactIds).toEqual([]);
    expect(() => parsePlotInternalCausalResult_ACU(' '.repeat(32769), view)).toThrow('回复格式无效');
  });

  it('完整复核视图指纹，拒绝被篡改的冻结输入', () => {
    const view = createDomainView();
    view.facts[0].summary = '篡改';
    expect(() => validatePlotInternalCausalView_ACU(view)).toThrow('校验失败');
    expect(() => parsePlotInternalCausalResult_ACU('{"selectedFactIds":[]}', view)).toThrow('校验失败');
  });
});
