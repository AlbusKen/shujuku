import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleSnapshot_ACU,
  renderAgentActiveVolumePlanningContext_ACU,
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
        { id: 'VOL-01', scope: 'volume', title: '商行之乱', direction: '主角夺回商行控制权', escalation: '收在印信回归且第三方签名浮现', withheld: '第三方身份', status: 'active', stageNumbers: [1, 2], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' },
        { id: 'VOL-02', scope: 'volume', title: '追查签名', direction: '追查第三方势力', escalation: '收在幕后势力主动灭口', withheld: '幕后首脑身份', status: 'planned', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' },
      ],
    });

    const text = renderAgentActiveVolumePlanningContext_ACU(snapshot, [1]);

    expect(text).toContain('当前 active 卷：[VOL-01]「商行之乱」');
    expect(text).toContain('已完成阶段 1');
    expect(text).toContain('已登记但尚未完成阶段 2');
    expect(text).toContain('主角夺回商行控制权');
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
