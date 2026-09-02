import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  renderAgentActiveVolumePlanningContext_ACU,
  renderAgentChronology_ACU,
  renderAgentChronologyByIds_ACU,
  renderAgentConstraints_ACU,
  renderAgentHooksLedger_ACU,
  renderAgentInfoGap_ACU,
  validateAgentModuleSnapshot_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { AGENT_BLOCK_CHAR_LIMIT_ACU, AGENT_HOT_HOOK_LIMIT_ACU, AGENT_MODULE_FIELD_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { ContinuationValidationError_ACU } from '../../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

function snapshotAt_ACU(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

function hook_ACU(id: string, patch: Record<string, unknown> = {}) {
  return { id, summary: `伏笔 ${id}`, status: 'planted', importance: 'mid', plantedIndex: 3, updatedIndex: 3, plannedPayoff: '', retired: false, retiredReason: '', ...patch };
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
});

describe('Agent 资料快照存储', () => {
  it('从尾向前取最近的合法快照，跳过被污染的楼层', () => {
    const chat: any[] = [
      { mes: 'a', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 0, constraints: 0 } }) },
      { mes: 'b' },
      { mes: 'c', [AGENT_MODULE_FIELD_ACU]: { schemaVersion: 99, settledThroughIndex: 2 } },
    ];

    const snapshot = readAgentModuleSnapshot_ACU(chat);
    expect(snapshot.settledThroughIndex).toBe(0);
    expect(snapshot.revisions.hooks).toBe(1);
  });

  it('聊天里没有任何快照时返回未结算的空快照', () => {
    expect(readAgentModuleSnapshot_ACU([{ mes: 'a' }]).settledThroughIndex).toBe(-1);
  });

  it('删楼后残留的越界水位被钳制回当前最后一楼', () => {
    const chat: any[] = [{ mes: 'a', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(9) }];
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(0);
  });

  it('未揭示条目携带揭示楼层时读取阶段就把楼层清空', () => {
    const validated = validateAgentModuleSnapshot_ACU({
      schemaVersion: 1,
      settledThroughIndex: 2,
      updatedAt: 1,
      revisions: { hooks: 0, infoGap: 1, constraints: 0 },
      hooks: [],
      infoGap: [{ id: 'E1', topic: '幕后身份', revealStatus: 'unrevealed', revealIndex: 7, characterKnowledge: [] }],
      constraints: [],
    });

    expect(validated!.infoGap[0].revealIndex).toBeNull();
  });

  it('旧总纲缺少 P2 字段仍兼容读取，已出现但损坏的 P2 字段拒绝整份快照', () => {
    const base = {
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 1 },
      hooks: [], infoGap: [], constraints: [],
      storyArc: [{
        id: 'VOL-01', scope: 'volume', title: '旧卷', direction: '推进旧主线', escalation: '收在旧卷结点', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '',
      }],
    };

    const compatible = validateAgentModuleSnapshot_ACU(base);
    expect(compatible!.storyArc[0]).toMatchObject({ id: 'VOL-01', narrativeRole: undefined, targetStageRange: undefined });
    expect(validateAgentModuleSnapshot_ACU({
      ...base,
      storyArc: [{ ...base.storyArc[0], targetStageRange: { min: 6, max: 4 } }],
    })).toBeNull();
  });

  it('空快照初始化 chronology 为空账本且 revision 为 0', () => {
    const empty = buildEmptyAgentModuleSnapshot_ACU();
    expect(empty.chronology).toEqual([]);
    expect(empty.revisions.chronology).toBe(0);
  });

  it('旧快照缺 chronology 与其 revision 时兼容读成空账本，不误报数据丢失', () => {
    const legacy = validateAgentModuleSnapshot_ACU({
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0 },
      hooks: [hook_ACU('H1')], infoGap: [], constraints: [],
    });

    expect(legacy!.chronology).toEqual([]);
    expect(legacy!.revisions.chronology).toBe(0);
    expect(legacy!.hooks).toHaveLength(1);
  });

  it('合法 chronology 保真读取；已出现但非法的 chronology 使整份快照回退', () => {
    const entry = { id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [5, 4, 5], updatedIndex: 5, retired: false, retiredReason: '' };
    const base = {
      schemaVersion: 1, settledThroughIndex: 5, updatedAt: 1,
      revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 0, chronology: 2 },
      hooks: [], infoGap: [], constraints: [], chronology: [entry],
    };

    const validated = validateAgentModuleSnapshot_ACU(base);
    expect(validated!.chronology[0]).toMatchObject({ id: 'T1', precision: 'approximate', evidenceIndexes: [4, 5], updatedIndex: 5 });
    expect(validated!.revisions.chronology).toBe(2);

    // 字段一旦出现就必须整体合法：坏条目不做静默过滤，而是让读取端回退上一份合法快照。
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: '不是数组' })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, precision: '大概' }] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, evidenceIndexes: [] }] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, anchor: '' }] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, retired: true, retiredReason: '' }] })).toBeNull();

    // 读取端行为：末楼快照的 chronology 损坏时回退到更早的合法快照。
    const good = { ...base, settledThroughIndex: 0 };
    const chat: any[] = [
      { mes: 'a', [AGENT_MODULE_FIELD_ACU]: good },
      { mes: 'b', [AGENT_MODULE_FIELD_ACU]: { ...base, chronology: [{ ...entry, precision: '大概' }] } },
    ];
    expect(readAgentModuleSnapshot_ACU(chat).revisions.chronology).toBe(2);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(0);
  });

  it('全程没有合法快照但存在损坏快照时，按宽容模式抢救而不是静默返回空，并留下诊断', () => {
    const entry = { id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '休整七日', evidenceIndexes: [1], updatedIndex: 1, retired: false, retiredReason: '' };
    const broken = {
      schemaVersion: 1, settledThroughIndex: 1, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 1, chronology: 1 },
      hooks: [hook_ACU('H1')], infoGap: [], constraints: [],
      storyArc: [{ id: 'VOL-01', scope: 'volume', title: '卷一', direction: 'd', escalation: 'e', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '', targetStageRange: { min: 6, max: 4 } }],
      chronology: [entry, { ...entry, id: 'T2', precision: '大概' }],
    };
    const chat: any[] = [{ mes: 'a' }, { mes: 'b', [AGENT_MODULE_FIELD_ACU]: broken }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snapshot = readAgentModuleSnapshot_ACU(chat);
    warn.mockRestore();
    // 合法条目保住，坏条目丢弃。
    expect(snapshot.hooks).toHaveLength(1);
    expect(snapshot.chronology.map(item => item.id)).toEqual(['T1']);
    expect(snapshot.storyArc).toEqual([]);
    expect(snapshot.settledThroughIndex).toBe(1);
    const diagnostics = readAgentModuleSnapshotDiagnostics_ACU();
    expect(diagnostics).toMatchObject({ adoptedIndex: 1, salvaged: true });
    expect(diagnostics.candidates[0].problems.join('；')).toContain('storyArc[0]');
    expect(diagnostics.candidates[0].problems.join('；')).toContain('chronology[1]');

    // 有合法快照时诊断记录采用楼层且不标记抢救。
    const chatOk: any[] = [{ mes: 'a', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0) }];
    readAgentModuleSnapshot_ACU(chatOk);
    expect(readAgentModuleSnapshotDiagnostics_ACU()).toEqual({ candidates: [{ index: 0, valid: true, problems: [] }], adoptedIndex: 0, salvaged: false });
    readAgentModuleSnapshot_ACU([{ mes: 'a' }]);
    expect(readAgentModuleSnapshotDiagnostics_ACU().adoptedIndex).toBeNull();
  });

  it('写盘保留快照自带的水位（钳制在 0 与目标楼层之间），不再自动顶到目标楼层', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);

    // 水位只由结算子代理成功交付时显式推进：写盘时快照声明多少就是多少。
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(0, { hooks: [hook_ACU('H1') as any] }));
    expect(saveChat).toHaveBeenCalledOnce();
    expect(chat[1][AGENT_MODULE_FIELD_ACU].settledThroughIndex).toBe(0);
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toHaveLength(1);

    // 显式声明的水位如实落盘；越界声明（超过目标楼层 / 负值）被钳制回合法区间。
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(1));
    expect(chat[1][AGENT_MODULE_FIELD_ACU].settledThroughIndex).toBe(1);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(9));
    expect(chat[1][AGENT_MODULE_FIELD_ACU].settledThroughIndex).toBe(1);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(-1));
    expect(chat[1][AGENT_MODULE_FIELD_ACU].settledThroughIndex).toBe(0);
  });

  it('写盘失败时还原楼层字段而不留下半成品', async () => {
    const chat: any[] = [{ mes: 'a' }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockRejectedValue(new Error('save failed')) } as any);

    await expect(writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt_ACU(0))).rejects.toThrow(ContinuationValidationError_ACU);
    expect(Object.prototype.hasOwnProperty.call(chat[0], AGENT_MODULE_FIELD_ACU)).toBe(false);
  });

  it('目标楼层不存在时拒绝写入', async () => {
    await expect(writeAgentModuleSnapshot_ACU([], 0, snapshotAt_ACU(0))).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SNAPSHOT_INVALID' } });
  });
});

describe('Agent 资料热上下文渲染', () => {
  it('伏笔按重要度排序，退役条目不进热上下文，超限数量如实标注', () => {
    const hooks = [
      hook_ACU('H-low', { importance: 'low' }),
      hook_ACU('H-high', { importance: 'high' }),
      hook_ACU('H-retired', { importance: 'high', retired: true, retiredReason: '已回收' }),
      ...Array.from({ length: AGENT_HOT_HOOK_LIMIT_ACU }, (_, index) => hook_ACU(`H-fill-${index}`)),
    ];
    const text = renderAgentHooksLedger_ACU(snapshotAt_ACU(1, { hooks: hooks as any }));

    expect(text.indexOf('H-high')).toBeLessThan(text.indexOf('H-fill-0'));
    expect(text).not.toContain('H-retired');
    expect(text).toContain('另有 2 条活跃伏笔未进入本次热上下文');
  });

  it('空模块如实说明为空而不是返回空串', () => {
    const empty = buildEmptyAgentModuleSnapshot_ACU();
    expect(renderAgentHooksLedger_ACU(empty)).toContain('没有活跃伏笔');
    expect(renderAgentInfoGap_ACU(empty)).toContain('没有登记的信息差条目');
    expect(renderAgentConstraints_ACU(empty)).toContain('没有登记的长期约束');
  });

  it('活动卷规划上下文区分承载阶段、真实完成进度、剩余目标与禁翻底牌', () => {
    const snapshot = snapshotAt_ACU(4, {
      storyArc: [
        { id: 'VOL-01', scope: 'volume', title: '商行之乱', direction: '主角夺回商行控制权', escalation: '收在印信回归且第三方签名浮现', withheld: '第三方身份', status: 'active', stageNumbers: [1, 2], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '', narrativeRole: 'development', targetStageRange: { min: 4, max: 6 }, targetTimeSpan: '两个月', progressCeiling: '只查明第三方签名存在', sustainingThreads: ['主角与账房建立互信'], payoffTargets: ['兑现夺回印信的期待'] },
        { id: 'VOL-02', scope: 'volume', title: '追查签名', direction: '追查第三方势力', escalation: '收在幕后势力主动灭口', withheld: '幕后首脑身份', status: 'planned', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' },
      ],
    });

    const text = renderAgentActiveVolumePlanningContext_ACU(snapshot, [1]);

    expect(text).toContain('当前 active 卷：[VOL-01]「商行之乱」');
    expect(text).toContain('卷级结构职责：development');
    expect(text).toContain('目标阶段容量：4–6 个阶段');
    expect(text).toContain('目标故事时间：两个月');
    expect(text).toContain('已完成阶段 1');
    expect(text).toContain('已登记但尚未完成阶段 2');
    expect(text).toContain('主角夺回商行控制权');
    expect(text).toContain('主线进度上限：只查明第三方签名存在');
    expect(text).toContain('持续经营线：主角与账房建立互信');
    expect(text).toContain('兑现目标：兑现夺回印信的期待');
    expect(text).toContain('第三方身份');
  });


  it('三个模块都在首行给出修订号，作为写入并发校验的依据', () => {
    const snapshot = snapshotAt_ACU(2, { revisions: { hooks: 4, infoGap: 5, constraints: 6 } });
    expect(renderAgentHooksLedger_ACU(snapshot).startsWith('当前修订号=4')).toBe(true);
    expect(renderAgentInfoGap_ACU(snapshot).startsWith('当前修订号=5')).toBe(true);
    expect(renderAgentConstraints_ACU(snapshot).startsWith('当前修订号=6')).toBe(true);
  });

  it('超长资料块截断到上限并标注未展示部分不代表不存在', () => {
    const long = Array.from({ length: 6 }, (_, index) => ({
      id: `E${index}`,
      topic: `主题${index}`,
      objectiveFact: '事'.repeat(900),
      readerKnown: '知',
      characterKnowledge: [],
      revealStatus: 'unrevealed',
      revealIndex: null,
      retired: false,
      retiredReason: '',
    }));
    const text = renderAgentInfoGap_ACU(snapshotAt_ACU(1, { infoGap: long as any }));

    expect(text).toContain(`超出 ${AGENT_BLOCK_CHAR_LIMIT_ACU} 字上限，已截断`);
    expect(text).toContain('未展示部分不代表不存在');
    expect(text.startsWith('当前修订号=0')).toBe(true);
  });

  it('年代学热渲染给出当前时间锚与逐条转换，空账本说明事实来源', () => {
    const empty = renderAgentChronology_ACU(buildEmptyAgentModuleSnapshot_ACU());
    expect(empty).toContain('当前修订号=0');
    expect(empty).toContain('没有已结算的故事时间记录');
    expect(empty).toContain('大纲里的时间字段是计划');

    const snapshot = snapshotAt_ACU(6, {
      revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, chronology: 3 },
      chronology: [
        { id: 'T2', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [4, 5], updatedIndex: 5, retired: false, retiredReason: '' },
        { id: 'T1', anchor: '抵达临川城的当日', elapsed: '自开篇约十日', precision: 'approximate', transition: '行船三日抵达', evidenceIndexes: [2], updatedIndex: 3, retired: false, retiredReason: '' },
        { id: 'T0', anchor: '误登记的锚', elapsed: '未知', precision: 'unknown', transition: '误登记', evidenceIndexes: [1], updatedIndex: 2, retired: true, retiredReason: '登记错误' },
      ] as any,
    });
    const text = renderAgentChronology_ACU(snapshot);

    expect(text.startsWith('当前修订号=3')).toBe(true);
    // 按结算次序排列后，最新锚是 T2；作废条目不进热上下文但如实标注。
    expect(text).toContain('当前时间锚：入城后的第七天');
    expect(text.indexOf('T1')).toBeLessThan(text.indexOf('[T2]'));
    expect(text).not.toContain('误登记的锚');
    expect(text).toContain('另有 1 条已作废记录未列出');
    expect(text).toContain('证据楼层：4、5');
  });

  it('年代学按 ID 精读含已作废条目，未知 ID 如实提示', () => {
    const snapshot = snapshotAt_ACU(6, {
      revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, chronology: 2 },
      chronology: [
        { id: 'T0', anchor: '误登记的锚', elapsed: '未知', precision: 'unknown', transition: '误登记', evidenceIndexes: [1], updatedIndex: 2, retired: true, retiredReason: '登记错误' },
      ] as any,
    });

    const byId = renderAgentChronologyByIds_ACU(snapshot, ['T0', 'T9']);
    expect(byId).toContain('误登记的锚');
    expect(byId).toContain('作废原因：登记错误');
    expect(byId).toContain('以下 ID 不存在于故事年代学账本：T9');
  });

  it('信息差渲染包含客观事实、读者已知与角色知晓', () => {
    const text = renderAgentInfoGap_ACU(snapshotAt_ACU(4, {
      infoGap: [{ id: 'E1', topic: '守门人身份', objectiveFact: '守门人是内应', readerKnown: '只知道行为反常', characterKnowledge: [{ name: '林瑶', knows: '完全不知' }], revealStatus: 'partial', revealIndex: 4, retired: false, retiredReason: '' }],
    }));

    expect(text).toContain('守门人是内应');
    expect(text).toContain('只知道行为反常');
    expect(text).toContain('林瑶=完全不知');
    expect(text).toContain('揭示楼层=4');
  });
});
