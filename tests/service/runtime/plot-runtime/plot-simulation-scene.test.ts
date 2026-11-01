import { describe, expect, it, vi } from 'vitest';
import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import {
  PLOT_SIMULATION_SCENE_MAX_TOKENS_ACU,
  PLOT_SIMULATION_SCENE_TOKEN_ACU,
  renderPlotSimulationSceneFacts_ACU,
  type PlotSimulationSceneContext_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-simulation-scene';
import type { ConfirmedSimulationCausalView_ACU } from '../../../../src/service/zero-layer/simulation-causal-view';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fact(id: string, summary: string, overrides: Record<string, unknown> = {}) {
  return {
    id, summary, temporalKind: 'condition', happenedAt: null,
    validFrom: { day: 2, slot: '' }, validUntil: { day: 4, slot: '' },
    locationRef: { region: '城区', place: '钟楼广场' }, actorIds: ['actor-secret'], worldEventIds: ['event-secret'],
    projectionPolicy: 'scene', revealState: 'unlocked', revealGate: { internal: 'secret' },
    nextCheck: null, sourceRefs: ['source-secret'], evidenceRefs: ['evidence-secret'], supersedesFactIds: [], revision: 1,
    ...overrides,
  };
}

function createView(facts: unknown[] = []): ConfirmedSimulationCausalView_ACU {
  const view = {
    revision: 7,
    source: { sessionId: 'session', branchId: 'branch', turnId: 'turn', attemptId: 'attempt', floorId: 'floor' },
    worldEvents: [{ id: 'event-secret', title: '不得出现' }],
    actors: [{ id: 'actor-secret', goals: ['不得出现'], knownFacts: ['不得出现'] }],
    historyMilestones: [{ id: 'history-secret', summary: '不得出现', sourceFactIds: ['secret'] }],
    facts,
    fingerprint: '',
  } as unknown as ConfirmedSimulationCausalView_ACU;
  view.fingerprint = sha256HexSync_ACU(canonicalJson({
    revision: view.revision,
    ref: view.source,
    worldEvents: view.worldEvents,
    actors: view.actors,
    historyMilestones: view.historyMilestones,
    facts: view.facts,
  }));
  return view;
}

function scene(): PlotSimulationSceneContext_ACU {
  return { time: { day: 3, slot: '午后' }, location: { region: '城区', place: '钟楼广场' } };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    signal: new AbortController().signal,
    assertCurrent: vi.fn(),
    scene: scene(),
    countTokens: async () => 10,
    ...overrides,
  };
}

function parsePayload(text: string): unknown {
  return JSON.parse(text.slice(text.indexOf('\n') + 1));
}

describe('剧情推演场景事实渲染', () => {
  it('导出固定占位符，并只输出同地、有效、解锁且未被替代的 scene 安全字段', async () => {
    expect(PLOT_SIMULATION_SCENE_TOKEN_ACU).toBe('$SIMULATION_SCENE_FACTS');
    const view = createView([
      fact('z-public', '末尾公开事实'),
      fact('a-public', '开头公开事实'),
      fact('other-street', '同城不同街不得出现', { locationRef: { region: '城区', place: '河岸街' } }),
      fact('unknown-place', '未知地点不得出现', { locationRef: null }),
      fact('future', '未来事实不得出现', { validFrom: { day: 5, slot: '' }, validUntil: { day: 6, slot: '' } }),
      fact('expired', '过期事实不得出现', { validFrom: { day: 1, slot: '' }, validUntil: { day: 2, slot: '' } }),
      fact('old-occurrence', '旧发生事实不得出现', { temporalKind: 'occurrence', happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null }),
      fact('slot-mismatch', '同日自由时段不可排序不得出现', { temporalKind: 'occurrence', happenedAt: { day: 3, slot: '上午' }, validFrom: null, validUntil: null }),
      fact('locked-secret', '锁定秘密不得出现', { revealState: 'locked' }),
      fact('internal-secret', '内部秘密不得出现', { projectionPolicy: 'internal' }),
      fact('gated-secret', '门控秘密不得出现', { projectionPolicy: 'gated' }),
      fact('replaced', '已被纠正的旧事实不得出现'),
      fact('correction', '纠正事实仍可出现', { supersedesFactIds: ['replaced'] }),
    ]);

    const result = await renderPlotSimulationSceneFacts_ACU(view, options());

    expect(result).toContain('当前场景中仍有效');
    expect(result).not.toContain('全局公开');
    for (const forbidden of ['同城不同街', '未知地点', '未来事实', '过期事实', '旧发生事实', '同日自由时段', '锁定秘密', '内部秘密', '门控秘密', '已被纠正', 'actor-secret', 'history-secret', 'source-secret', 'evidence-secret']) {
      expect(result).not.toContain(forbidden);
    }
    expect(parsePayload(result)).toEqual({
      revision: 7,
      source: view.source,
      facts: [
        { id: 'a-public', summary: '开头公开事实' },
        { id: 'correction', summary: '纠正事实仍可出现' },
        { id: 'z-public', summary: '末尾公开事实' },
      ],
    });
    expect(result).not.toContain('fingerprint');
    expect(result).not.toContain('worldEvents');
    expect(result).not.toContain('actors');
    expect(result).not.toContain('historyMilestones');
  });

  it('null view 返回空结果；非 null view 缺少或损坏场景不可降级为全局读取', async () => {
    const countTokens = vi.fn(async (text: string) => {
      expect(text).toBe('（当前场景没有可投影的已解锁事实）');
      return 4;
    });
    await expect(renderPlotSimulationSceneFacts_ACU(null, options({ scene: undefined, countTokens })))
      .resolves.toBe('（当前场景没有可投影的已解锁事实）');
    await expect(renderPlotSimulationSceneFacts_ACU(createView([fact('public', '公开')]), options({ scene: undefined })))
      .rejects.toThrow('场景上下文无效');
    await expect(renderPlotSimulationSceneFacts_ACU(createView([fact('public', '公开')]), options({ scene: { time: { day: 3, slot: '午后' }, location: null } })))
      .rejects.toThrow('场景上下文无效');
    await expect(renderPlotSimulationSceneFacts_ACU(createView([fact('public', '公开')]), options({ scene: { time: { day: 3, slot: '午后' }, location: { region: '城区', place: '' } } })))
      .rejects.toThrow('场景上下文无效');
    expect(countTokens).toHaveBeenCalledTimes(1);
  });

  it.each([NaN, Infinity, 0, PLOT_SIMULATION_SCENE_MAX_TOKENS_ACU + 1])('拒绝非法或超限令牌计数 %s', async count => {
    await expect(renderPlotSimulationSceneFacts_ACU(createView([fact('public', '公开')]), options({ countTokens: async () => count })))
      .rejects.toThrow('令牌预算');
  });

  it('拒绝伪造、形状错误或与原始 canonical 内容不匹配的 fingerprint', async () => {
    const forged = createView([fact('public', '公开')]);
    forged.fingerprint = '0'.repeat(64);
    await expect(renderPlotSimulationSceneFacts_ACU(forged, options())).rejects.toThrow('校验失败');

    const malformed = createView([]) as any;
    malformed.extra = 'not-allowed';
    await expect(renderPlotSimulationSceneFacts_ACU(malformed, options())).rejects.toThrow('结构无效');
  });

  it('计数期间 causal view 或 scene 变化、取消和超额均 fail-closed，计数器只接触安全文本', async () => {
    const mutable = createView([fact('public', '安全摘要也不得进入异常')]);
    const sceneContext = scene();
    const mutatingCounter = vi.fn(async (text: string) => {
      expect(text).not.toContain('actor-secret');
      mutable.facts[0].summary = '已被异步修改';
      return 8;
    });
    await expect(renderPlotSimulationSceneFacts_ACU(mutable, options({ scene: sceneContext, countTokens: mutatingCounter })))
      .rejects.toThrow('校验失败');

    const sceneChanging = scene();
    await expect(renderPlotSimulationSceneFacts_ACU(createView([fact('public', '公开')]), options({
      scene: sceneChanging,
      countTokens: async () => { sceneChanging.location!.place = '河岸街'; return 8; },
    }))).rejects.toThrow('场景在渲染期间已变化');

    const controller = new AbortController();
    const aborted = renderPlotSimulationSceneFacts_ACU(createView([fact('public', '安全摘要也不得进入异常')]), {
      signal: controller.signal, assertCurrent: vi.fn(), scene: scene(), countTokens: async () => {
        controller.abort();
        return PLOT_SIMULATION_SCENE_MAX_TOKENS_ACU + 1;
      },
    });
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  });
});
