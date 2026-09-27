import { describe, expect, it } from 'vitest';
import { allocateAgentDefaultReadFences_ACU, resolveAgentDefaultReadFenceUpper_ACU } from '../../../../src/service/continuation/agent/agent-default-fence';
import { resolveAgentReadAddressAxis_ACU, resolveAgentReadTokenWithProof_ACU, type AgentResolveContext_ACU } from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentReadFence_ACU } from '../../../../src/service/continuation/agent/agent-model';

/** 每个楼层正文约 200 字，远大于收窄说明行，便于用字符数计量推算预算。 */
const floorText_ACU = (index: number) => `第${String(index).padStart(2, '0')}楼正文${'甲'.repeat(200)}`;

function context_ACU(): AgentResolveContext_ACU {
  const chat = Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? { mes: `用户${index}`, is_user: true } : { mes: floorText_ACU(index) }));
  return {
    chat,
    storyWindowFloors: 20,
    storyTailFloors: 0,
    moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 0,
    execution: {} as any,
    originInstruction: '',
    recentTurnCount: 0,
    tableData: {
      s1: { name: '角色表', content: [['姓名', '状态'], ['甲', '一'], ['乙', '二'], ['丙', '三'], ['丁', '四']] },
      s2: { name: '单行表', content: [['键', '值'], ['唯一', '行']] },
      s3: { name: '长行表', content: [['键', '值'], ...Array.from({ length: 5 }, (_, row) => [`行${row + 1}`, '乙'.repeat(300)])] },
    },
  } as AgentResolveContext_ACU;
}

const count_ACU = async (text: string) => text.length;

describe('60% 默认上围栏的范围解析', () => {
  it('二分出预算可容纳的最大完整子范围，探测次数为对数级', async () => {
    const probed: number[] = [];
    const outcome = await resolveAgentDefaultReadFenceUpper_ACU({
      lower: 1, naturalUpper: 100, budgetTokens: 539,
      measure: async upper => { probed.push(upper); return upper * 10; },
    });
    expect(outcome).toEqual({ status: 'resolved', upper: 53, measuredTokens: 530 });
    expect(probed.length).toBeLessThanOrEqual(8);
  });

  it('自然全量可容纳时解析到 naturalUpper', async () => {
    const outcome = await resolveAgentDefaultReadFenceUpper_ACU({
      lower: 1, naturalUpper: 100, budgetTokens: 100000,
      measure: async upper => upper * 10,
    });
    expect(outcome).toEqual({ status: 'resolved', upper: 100, measuredTokens: 1000 });
  });

  it('连最小范围都超预算时 fail-closed，不伪造更小子范围', async () => {
    const outcome = await resolveAgentDefaultReadFenceUpper_ACU({
      lower: 1, naturalUpper: 5, budgetTokens: 3,
      measure: async () => 10,
    });
    expect(outcome).toEqual({ status: 'exhausted', measuredTokens: 10 });
  });

  it('非法坐标、预算或计量结果一律拒绝', async () => {
    const base = { lower: 1, naturalUpper: 5, budgetTokens: 10, measure: async () => 1 };
    await expect(resolveAgentDefaultReadFenceUpper_ACU({ ...base, naturalUpper: 0 })).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
    await expect(resolveAgentDefaultReadFenceUpper_ACU({ ...base, budgetTokens: 0 })).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
    await expect(resolveAgentDefaultReadFenceUpper_ACU({ ...base, budgetTokens: Number.NaN })).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
    await expect(resolveAgentDefaultReadFenceUpper_ACU({ ...base, measure: async () => Number.NaN })).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
  });

  it('计量非单调时不声称最大，但返回值实测仍不超预算', async () => {
    const outcome = await resolveAgentDefaultReadFenceUpper_ACU({
      lower: 1, naturalUpper: 10, budgetTokens: 50,
      measure: async upper => (upper % 2 ? upper * 10 : upper * 3),
    });
    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') expect(outcome.measuredTokens).toBeLessThanOrEqual(50);
  });
});

describe('读取地址坐标轴：token 预算只决定取前几项，不写进坐标', () => {
  const context = context_ACU();

  it('正文区间按窗口内 AI 楼层映射前缀，跳过用户楼层', () => {
    const axis = resolveAgentReadAddressAxis_ACU('$STORY_RANGE:1-9', context)!;
    expect(axis.length).toBe(5);
    expect(axis.addressAt(0)).toBe('$STORY_RANGE:1-1');
    expect(axis.addressAt(2)).toBe('$STORY_RANGE:1-5');
    expect(axis.addressAt(4)).toBe('$STORY_RANGE:1-9');
  });

  it('表格行区间与整表都映射为连续行号前缀', () => {
    expect(resolveAgentReadAddressAxis_ACU('$TABLE:角色表:2-4', context)!.addressAt(1)).toBe('$TABLE:角色表:2-3');
    const whole = resolveAgentReadAddressAxis_ACU('$TABLE:角色表', context)!;
    expect(whole.length).toBe(4);
    expect(whole.addressAt(0)).toBe('$TABLE:角色表:1-1');
  });

  it('世界书 uid 与模块 ID 是字符串坐标，只按列表位置取前缀', () => {
    const worldbook = resolveAgentReadAddressAxis_ACU('$WORLDBOOK:设定集:12,7,30', context)!;
    expect(worldbook.length).toBe(3);
    expect(worldbook.addressAt(1)).toBe('$WORLDBOOK:设定集:12,7');
    const hooks = resolveAgentReadAddressAxis_ACU('$HOOKS_LEDGER:H3,H1,H2', context)!;
    expect(hooks.addressAt(0)).toBe('$HOOKS_LEDGER:H3');
    expect(hooks.addressAt(2)).toBe('$HOOKS_LEDGER:H3,H1,H2');
  });

  it('整模块、单点地址、空 uid 与未知地址都是原子地址', () => {
    const atomic = ['$HOOKS_LEDGER', '$HOOKS_LEDGER:H1', '$STORY_RANGE:3-3', '$TABLE:单行表', '$WORLDBOOK:设定集:1,,2', '$WORLDBOOK:设定集:1', '$STORY_ARC', '$UNKNOWN:1,2'];
    for (const token of atomic) expect(resolveAgentReadAddressAxis_ACU(token, context), token).toBeNull();
  });
});

describe('批次内 60% 默认上围栏分配', () => {
  const context = context_ACU();
  const axis = (key: string) => resolveAgentReadAddressAxis_ACU(key, context);
  const resolve = (address: string, fence?: AgentReadFence_ACU) => resolveAgentReadTokenWithProof_ACU(address, context, fence);
  const candidate = (key: string, requestedFence?: AgentReadFence_ACU) => {
    const resolved = resolve(key, requestedFence);
    expect(resolved.status, key).not.toBe('failed');
    return { key, title: resolved.title, text: resolved.text, ...(requestedFence ? { requestedFence } : {}) };
  };
  const sized = (item: { key: string; title: string; text: string }) => count_ACU(`### ${item.title}（${item.key}）\n${item.text}`);

  it('完整正文可容纳时原样放行，不收窄', async () => {
    const allocation = await allocateAgentDefaultReadFences_ACU({
      candidates: [candidate('$STORY_RANGE:1-9')], budgetTokens: 100000, reservedTokens: 0, axis, resolve, count: count_ACU,
    });
    expect(allocation).toMatchObject({ status: 'resolved', reads: [{ key: '$STORY_RANGE:1-9', address: '$STORY_RANGE:1-9', narrowed: false }] });
  });

  it('超预算时收窄为可证明的最大前缀子范围，围栏内正文逐字完整', async () => {
    const full = candidate('$STORY_RANGE:1-9');
    const budget = (await sized(full)) - 100;
    const allocate = (budgetTokens: number) => allocateAgentDefaultReadFences_ACU({ candidates: [full], budgetTokens, reservedTokens: 0, axis, resolve, count: count_ACU });
    const allocation = await allocate(budget);
    expect(allocation.status).toBe('resolved');
    if (allocation.status !== 'resolved') return;
    const [read] = allocation.reads;
    expect(read).toMatchObject({ key: '$STORY_RANGE:1-9', narrowed: true });
    expect(read.tokens).toBeLessThanOrEqual(budget);
    expect(read.proof).toMatchObject({ stableAddress: read.address, completeWithinFence: true, resolvedFence: { lower: 1 } });
    const upper = Number(/-(\d+)$/.exec(read.address)![1]);
    expect(upper).toBeGreaterThan(1);
    expect(upper).toBeLessThan(9);
    // 注入正文 = 收窄地址独立解析的全文 + 如实标注，不是对原正文的截断。
    expect(read.text.endsWith(`\n${resolve(read.address).text}`)).toBe(true);
    expect(read.text).toContain(`原地址「$STORY_RANGE:1-9」`);
    for (let floor = 1; floor <= 9; floor += 2) {
      if (floor <= upper) expect(read.text).toContain(floorText_ACU(floor));
      else expect(read.text).not.toContain(floorText_ACU(floor));
    }
    // 再多一个楼层的预算就能多读一个楼层：确是预算内的最大前缀。
    const wider = await allocate(budget + floorText_ACU(1).length + 20);
    expect(wider.status === 'resolved' && Number(/-(\d+)$/.exec(wider.reads[0].address)![1])).toBeGreaterThan(upper);
  });

  it('原子地址超预算时整批 exhausted，不返回任何部分结果', async () => {
    const allocation = await allocateAgentDefaultReadFences_ACU({
      candidates: [candidate('$STORY_RANGE:1-3'), candidate('$STORY_RANGE:5-5')], budgetTokens: 10, reservedTokens: 0, axis, resolve, count: count_ACU,
    });
    expect(allocation.status).toBe('failed');
    if (allocation.status !== 'failed') return;
    expect(allocation.failures.map(failure => failure.reason)).toEqual(['default-fence-exhausted', 'default-fence-exhausted']);
    expect(allocation.failures[0].details).toMatchObject({ narrowable: true, budgetTokens: 10 });
    expect(allocation.failures[1].details).toMatchObject({ narrowable: false, budgetTokens: 10 });
  });

  it('批次其他资料占用计入预算；预算 0 报 exhausted，缺失报 unavailable', async () => {
    const base = { candidates: [candidate('$STORY_RANGE:1-9')], axis, resolve, count: count_ACU };
    const reserved = await allocateAgentDefaultReadFences_ACU({ ...base, budgetTokens: 500, reservedTokens: 500 });
    expect(reserved.status === 'failed' && reserved.failures[0].reason).toBe('default-fence-exhausted');
    const zero = await allocateAgentDefaultReadFences_ACU({ ...base, budgetTokens: 0, reservedTokens: 0 });
    expect(zero.status === 'failed' && zero.failures[0].reason).toBe('default-fence-exhausted');
    const missing = await allocateAgentDefaultReadFences_ACU({ ...base, budgetTokens: undefined, reservedTokens: 0 });
    expect(missing.status === 'failed' && missing.failures[0].reason).toBe('default-fence-budget-unavailable');
  });

  it('原子地址保留完整正文，可收窄地址只用剩余预算', async () => {
    const atomic = candidate('$STORY_RANGE:11-11');
    const ranged = candidate('$STORY_RANGE:1-9');
    const budget = (await sized(atomic)) + (await sized(ranged)) - 100;
    const allocation = await allocateAgentDefaultReadFences_ACU({ candidates: [ranged, atomic], budgetTokens: budget, reservedTokens: 0, axis, resolve, count: count_ACU });
    expect(allocation.status).toBe('resolved');
    if (allocation.status !== 'resolved') return;
    expect(allocation.reads.map(read => read.narrowed)).toEqual([true, false]);
    expect(allocation.reads[1].text).toBe(atomic.text);
    expect(allocation.reads.reduce((sum, read) => sum + read.tokens, 0)).toBeLessThanOrEqual(budget);
  });

  it('整表按行号前缀收窄并带证明，注入的每一行都完整', async () => {
    const table = candidate('$TABLE:长行表');
    const allocation = await allocateAgentDefaultReadFences_ACU({ candidates: [table], budgetTokens: (await sized(table)) - 100, reservedTokens: 0, axis, resolve, count: count_ACU });
    expect(allocation.status).toBe('resolved');
    if (allocation.status !== 'resolved') return;
    const [read] = allocation.reads;
    expect(read.address).toMatch(/^\$TABLE:长行表:1-[1-4]$/);
    expect(read.proof).toMatchObject({ stableAddress: read.address, completeWithinFence: true, resolvedFence: { lower: 1 } });
    expect(read.text.endsWith(`\n${resolve(read.address).text}`)).toBe(true);
  });

  it('收窄说明本身计入预算：省下的正文不足以抵消说明开销时 fail-closed，而非截断', async () => {
    const table = candidate('$TABLE:角色表');
    const allocation = await allocateAgentDefaultReadFences_ACU({ candidates: [table], budgetTokens: (await sized(table)) - 1, reservedTokens: 0, axis, resolve, count: count_ACU });
    expect(allocation.status === 'failed' && allocation.failures[0]).toMatchObject({ reason: 'default-fence-exhausted', details: { narrowable: true } });
  });

  it('收窄子范围的证明与地址不符时整批 proof-invalid', async () => {
    const full = candidate('$STORY_RANGE:1-9');
    const allocation = await allocateAgentDefaultReadFences_ACU({
      candidates: [full], budgetTokens: (await sized(full)) - 100, reservedTokens: 0, axis, count: count_ACU,
      resolve: address => { const resolved = resolve(address); return { ...resolved, proof: { ...resolved.proof!, stableAddress: '$STORY_RANGE:1-9' } }; },
    });
    expect(allocation.status === 'failed' && allocation.failures[0].reason).toBe('default-fence-proof-invalid');
  });

  it('显式下围栏随收窄一并校验，收窄地址仍在 requestedFence 内', async () => {
    const full = candidate('$STORY_RANGE:3-9', { lower: 3 });
    const allocation = await allocateAgentDefaultReadFences_ACU({ candidates: [full], budgetTokens: (await sized(full)) - 100, reservedTokens: 0, axis, resolve, count: count_ACU });
    expect(allocation.status).toBe('resolved');
    if (allocation.status !== 'resolved') return;
    expect(allocation.reads[0]).toMatchObject({ narrowed: true });
    expect(allocation.reads[0].proof).toMatchObject({ requestedFence: { lower: 3 }, resolvedFence: { lower: 3 }, completeWithinFence: true });
  });

  it('字符串下围栏的地址按原子地址处理：不自动前缀收窄，超预算时 fail-closed', async () => {
    // $HOOKS_LEDGER:H3,H1,H2 与世界书 uid 列表本可按列表位置取前缀收窄；
    // 但字符串下围栏指名的条目可能在被砍掉的前缀之外，字典序证明无法发现丢失，因此只能整体保留或整体失败。
    const hooks = { key: '$HOOKS_LEDGER:H3,H1,H2', title: '伏笔账本', text: 'H3 伏笔正文。H1 伏笔正文。H2 伏笔正文。', requestedFence: { lower: 'H1' } as AgentReadFence_ACU };
    const worldbook = { key: '$WORLDBOOK:设定集:12,7,30', title: '世界书', text: '条目12。条目7。条目30。', requestedFence: { lower: '7' } as AgentReadFence_ACU };
    // 地址本身在坐标轴上可收窄，收窄被抑制只能来自字符串下围栏。
    expect(axis(hooks.key)).not.toBeNull();
    expect(axis(worldbook.key)).not.toBeNull();
    // 预算足够时原样完整放行，不得收窄成只含 H3 的前缀。
    const ample = await allocateAgentDefaultReadFences_ACU({ candidates: [hooks, worldbook], budgetTokens: 100000, reservedTokens: 0, axis, resolve, count: count_ACU });
    expect(ample).toMatchObject({ status: 'resolved', reads: [
      { key: hooks.key, address: hooks.key, narrowed: false },
      { key: worldbook.key, address: worldbook.key, narrowed: false },
    ] });
    // 预算放不下完整正文时整批失败：不得注入不满足 lower 语义的前缀，也不得探测任何前缀子范围。
    const probed: string[] = [];
    const spiedResolve = (address: string, fence?: AgentReadFence_ACU) => { probed.push(address); return resolve(address, fence); };
    const short = await allocateAgentDefaultReadFences_ACU({ candidates: [hooks, worldbook], budgetTokens: 10, reservedTokens: 0, axis, resolve: spiedResolve, count: count_ACU });
    expect(short.status).toBe('failed');
    if (short.status !== 'failed') return;
    expect(short.failures.map(failure => failure.reason)).toEqual(['default-fence-exhausted', 'default-fence-exhausted']);
    expect(short.failures.every(failure => failure.details.narrowable === false)).toBe(true);
    expect(probed).toEqual([]);
  });

});
