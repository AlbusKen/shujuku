import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import { AGENT_MODULE_FIELD_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { readMessageSwipeId_ACU } from '../../../../src/service/continuation/agent/agent-module-frame';
import { commitAgentModuleFieldWrites_ACU } from '../../../../src/service/continuation/agent/agent-module-field-commit';
import { applyWorldSimulationProjection_ACU, WORLD_SIMULATION_PROJECTION_MARKERS_ACU } from '../../../../src/service/simulation/simulation-projection';

const INSERT_HOOK = "INSERT INTO hooks (summary, status, importance, planted_index, planned_payoff) VALUES ('信件', 'planted', 'mid', 1, '入城后交出')";
const INSERT_SECOND = "INSERT INTO hooks (summary, status, importance, planted_index, planned_payoff) VALUES ('晶屑', 'planted', 'low', 1, '后续回收')";
const PROJECTION_ACU = `${WORLD_SIMULATION_PROJECTION_MARKERS_ACU.start}\n<与此同时>\n【此地此刻】\n- 码头有人低声议论\n</与此同时>\n${WORLD_SIMULATION_PROJECTION_MARKERS_ACU.end}`;

function setup() {
  const snapshot = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 };
  const chat: any[] = [
    { is_user: false, mes: 'root', [AGENT_MODULE_FIELD_ACU]: snapshot },
    { is_user: false, mes: '官船抵达江南府码头。', swipe_id: 0, swipes: ['官船抵达江南府码头。'] },
  ];
  _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
  // 与 agent-main-loop 的 moduleFieldWrite_ACU 一致：派工时绑定目标楼层的消息与 swipe。
  const message = chat[1];
  const dispatchTarget = { message, swipeId: readMessageSwipeId_ACU(message) };
  return { chat, dispatchTarget };
}

beforeEach(() => _set_SillyTavern_API_ACU(null as any));

describe('续写逐栏提交与目标楼层正文改写共存', () => {
  it('推演在续写途中把投影块写进目标楼层后，后续提交仍然成功', async () => {
    const { chat, dispatchTarget } = setup();
    const first = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, dispatchTarget, sql: INSERT_HOOK, role: 'hook-cognition-maintainer' });
    expect(first.status).toBe('committed');
    // 模拟 simulation-commit-adapter 改写锚点正文：只追加推演自有的投影块。
    chat[1].mes = applyWorldSimulationProjection_ACU(chat[1].mes, PROJECTION_ACU);
    chat[1].swipes[0] = chat[1].mes;
    const second = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, dispatchTarget, sql: INSERT_SECOND, role: 'hook-cognition-maintainer' });
    expect(second.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(second.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.summary)).toEqual(expect.arrayContaining(['信件', '晶屑']));
  });

  it('第三方改写同一目标楼正文后仍提交资料，并保留改写后的正文', async () => {
    const { chat, dispatchTarget } = setup();
    chat[1].mes = '官船抵达临川府码头。';
    chat[1].swipes[0] = chat[1].mes;
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, dispatchTarget, sql: INSERT_HOOK, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(receipt.rejected).toEqual([]);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.summary)).toContain('信件');
    expect(chat[1].mes).toBe('官船抵达临川府码头。');
    expect(chat[1].swipes[0]).toBe(chat[1].mes);
  });
});
