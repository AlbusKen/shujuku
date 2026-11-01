import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [{ is_user: false, mes: '守卫在钟楼广场巡逻。' }] as any[],
  envelope: null as any,
  ledger: null as any,
  previous: null as any,
  folded: null as any,
  futureOnly: false,
  frame: null as any,
  direct: vi.fn(), review: vi.fn(), delivery: vi.fn(),
}));
vi.mock('../../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => mocks.chat }));
vi.mock('../../../../src/service/simulation/simulation-store', () => ({
  FirstFloorWorldSimulationStore_ACU: class { read() { return mocks.envelope; } },
  resolveWorldSimulationAnchor_ACU: (index: number) => ({ chatIdentity: 'chat-1', messageIndex: index, messageId: 'm-1', messageKey: 'm-1', swipeId: '0', contentDigest: 'a'.repeat(64) }),
  readWorldSimulationBucketEntry_ACU: (_field: string, _anchor: unknown, validate: (value: unknown) => unknown) => mocks.frame ? validate(mocks.frame) : null,
  validateWorldSimulationLedger_ACU: (value: unknown) => value,
}));
vi.mock('../../../../src/service/simulation/simulation-ledger-fold', () => ({
  foldWorldSimulationLedger_ACU: (_chat: unknown[], throughIndex?: number) => throughIndex === undefined
    ? mocks.folded : mocks.futureOnly ? null
      : throughIndex === mocks.chat.findLastIndex(message => message.is_user !== true && !message._qrf_plot_pending_placeholder)
        && mocks.folded ? mocks.folded : mocks.previous ? { ledger: mocks.previous } : null,
}));
vi.mock('../../../../src/service/simulation/agent/agent-module-store', () => ({ readWorldSimulationLedgerAtAnchor_ACU: () => mocks.ledger }));
vi.mock('../../../../src/service/ai/api-call', () => ({ callAIWithResolvedPreset_ACU: mocks.direct }));
vi.mock('../../../../src/service/simulation/agent/world-scene-review', () => ({ reviewWorldNarrativeScene_ACU: mocks.review }));
vi.mock('../../../../src/service/runtime/plot-runtime/plot-causal-delivery-bridge', () => ({ preparePlotCausalDelivery_ACU: mocks.delivery }));

import { createOrdinaryPlotCausalContext_ACU } from '../../../../src/service/runtime/plot-runtime/ordinary-plot-causal-context';
const run = (explicitWorldSimulation = false) => createOrdinaryPlotCausalContext_ACU({ plotSettings: { enabled: true }, userMessage: '继续前进', signal: new AbortController().signal, assertCurrent: vi.fn(), explicitWorldSimulation });

describe('普通剧情完整世界资料适配', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat = [{ is_user: false, mes: '守卫在钟楼广场巡逻。' }];
    mocks.ledger = { revision: 4, clock: { day: 7, slot: '夜' }, worldEvents: [], actors: [], facts: [], historyMilestones: [] };
    mocks.previous = null;
    mocks.folded = null;
    mocks.futureOnly = false;
    mocks.frame = null;
    mocks.envelope = {
      settings: { deliveryTarget: 'body' }, timeline: [{ taskId: 'task', runId: 'run', kind: 'committed', message: '世界推进完成' }],
      task: { taskId: 'task', status: 'completed', activeRun: null, completedRun: {
        runId: 'run', deliveryTarget: 'plot', baseLedgerRevision: 3, kind: 'host',
        chatIdentity: 'chat-1', anchorMessageKey: 'm-1', anchorSwipeId: '0', anchorContentDigest: 'a'.repeat(64),
      }, completedAutoAnchor: {
        chatIdentity: 'chat-1', messageKey: 'm-1', swipeId: '0', contentDigest: 'a'.repeat(64),
      } },
    };
  });

  it('completed plot 绑定后无审查/模型调用，body 设置不影响冻结的 plot 目标', async () => {
    const result = await run();
    expect(result?.worldContext.round).toMatchObject({ comparison: 'unavailable', summary: '世界推进完成' });
    expect(mocks.direct).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it('显式占位符从当前楼层提交链取得完整六类资料，元数据缺失或不匹配、暂停或 body 不阻断', async () => {
    mocks.folded = { ledger: {
      ...mocks.ledger, clock: { day: 8, slot: '晨' },
      worldEvents: [{ id: 'event' }], actors: [{ id: 'actor', experiences: [] }],
      facts: [{ id: 'fact' }], factArchive: [{ id: 'cold-fact' }],
      historyMilestones: [{ id: 'milestone' }], historyArchive: [{ id: 'cold-milestone' }],
    }, lastContributedIndex: 0 };
    mocks.envelope.ledger = { ...mocks.ledger, facts: [{ id: 'uncommitted-candidate' }] };
    for (const task of [null, { status: 'paused' }, { ...mocks.envelope.task, completedRun: null },
      { ...mocks.envelope.task, completedAutoAnchor: null },
      { ...mocks.envelope.task, completedRun: { ...mocks.envelope.task.completedRun, anchorSwipeId: '1' } },
      { ...mocks.envelope.task, completedRun: { ...mocks.envelope.task.completedRun, deliveryTarget: 'body' } }]) {
      mocks.envelope.task = task;
      const result = (await run(true))!.worldContext;
      expect(Object.keys(result)).toEqual(['clock', 'round', 'worldEvents', 'actors', 'facts', 'historyMilestones']);
      expect(result.worldEvents).toHaveLength(1);
      expect(result.actors).toHaveLength(1);
      expect(result.facts.hot).toHaveLength(1);
      expect(result.facts.cold).toHaveLength(1);
      expect(result.historyMilestones.hot).toHaveLength(1);
      expect(result.historyMilestones.cold).toHaveLength(1);
      expect(result.facts.hot[0].id).toBe('fact');
      expect(result.round.comparison).toBe('unavailable');
      expect(result.round.summary).toBe(task?.completedRun?.anchorSwipeId === '0' && task?.completedAutoAnchor
        && task.status === 'completed' ? '世界推进完成' : '已保存的世界模拟资料。');
    }
    expect(mocks.direct).not.toHaveBeenCalled();
  });

  it('显式首楼旧账本可读，已有其他楼层折叠账本时拒绝回退未来缓存，未保存资料返回 null', async () => {
    mocks.envelope.task = null;
    mocks.envelope.ledger = mocks.ledger;
    expect((await run(true))?.worldContext.clock.day).toBe(7);
    mocks.chat.push({ is_user: true });
    mocks.futureOnly = true;
    mocks.folded = { ledger: { ...mocks.ledger, revision: 9 }, lastContributedIndex: 2 };
    mocks.envelope.ledger = { ...mocks.ledger, revision: 9 };
    expect(await run(true)).toBeNull();
    mocks.folded = null;
    mocks.envelope = null;
    expect(await run(true)).toBeNull();
  });

  it('显式比较仅限来源楼层新提交且有可确认前态；跳过用户与占位楼层', async () => {
    mocks.chat.push({ is_user: true, mes: '继续' }, { _qrf_plot_pending_placeholder: true });
    mocks.folded = { ledger: mocks.ledger, lastContributedIndex: 0 };
    mocks.envelope.ledger = mocks.ledger;
    mocks.previous = { ...mocks.ledger, revision: 3 };
    expect((await run(true))?.worldContext.round.comparison).toBe('unavailable');
    mocks.chat = [{ is_user: false, mes: '旧楼' }, { is_user: false, mes: '最新楼' }, { is_user: true }];
    mocks.folded = { ledger: mocks.ledger, lastContributedIndex: 1 };
    mocks.previous = { ...mocks.ledger, revision: 3 };
    expect((await run(true))?.worldContext.round.comparison).toBe('available');
  });

  it('显式不扩展非显式的元数据门槛', async () => {
    mocks.folded = { ledger: mocks.ledger, lastContributedIndex: 0 };
    mocks.envelope.task = null;
    expect(await run()).toBeNull();
    expect((await run(true))?.worldContext.facts.hot).toEqual([]);
  });

  it('运行冻结为 body 时不启用', async () => {
    mocks.envelope.task.completedRun.deliveryTarget = 'body';
    await expect(run()).resolves.toBeNull();
  });

  it('completed anchor 或 run 身份变化时拒绝', async () => {
    mocks.envelope.task.completedAutoAnchor.messageKey = 'other-message';
    await expect(run()).resolves.toBeNull();
    mocks.envelope.task.completedAutoAnchor.messageKey = 'm-1';
    mocks.envelope.task.completedRun.anchorSwipeId = '1';
    await expect(run()).resolves.toBeNull();
    expect(mocks.direct).not.toHaveBeenCalled();
  });

  it('同楼层 checkpoint 恰与冻结 base revision 匹配才用于 round 比较', async () => {
    mocks.frame = { checkpoint: { ...structuredClone(mocks.ledger), revision: 3, clock: { day: 6, slot: '夜' } }, deltas: [] };
    const result = await run();
    expect(result?.worldContext.round.clock).toMatchObject({ before: { day: 6 }, after: { day: 7 } });
    mocks.frame.checkpoint.revision = 2;
    expect((await run())?.worldContext.round.comparison).toBe('unavailable');
  });

  it('前楼层折叠结果必须匹配 base revision；缺基底不伪造新增', async () => {
    mocks.chat.unshift({ is_user: false, mes: '上一楼' });
    mocks.previous = { ...structuredClone(mocks.ledger), revision: 3, clock: { day: 6, slot: '夜' } };
    expect((await run())?.worldContext.round.comparison).toBe('available');
    mocks.previous.revision = 2;
    expect((await run())?.worldContext.round.comparison).toBe('unavailable');
  });
});
