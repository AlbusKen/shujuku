import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import { AGENT_MODULE_FIELD_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleFieldSnapshot_ACU, readAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { commitAgentModuleFieldWrites_ACU } from '../../../../src/service/continuation/agent/agent-module-field-commit';

const INSERT_PARTIAL = "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信件', 0)";
const UPDATE_REST = "UPDATE hooks SET status = 'planted', importance = 'mid', planted_index = 1, planned_payoff = '' WHERE id = 'H1' AND expected_revision = 1";
function setup() {
  const snapshot = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 };
  const chat: any[] = [
    { is_user: false, mes: 'root', [AGENT_MODULE_FIELD_ACU]: snapshot },
    { is_user: false, mes: 'tail' },
  ];
  const saveChat = vi.fn().mockResolvedValue(undefined);
  _set_SillyTavern_API_ACU({ chat, saveChat } as any);
  return { chat, saveChat };
}
beforeEach(() => _set_SillyTavern_API_ACU(null as any));
describe('续写逐栏真实提交', () => {
  it('没写 id 和 expected_revision 时按顺序补号，卷状态也一起补上', async () => {
    const { chat } = setup();
    const sql = [
      "INSERT INTO story_arc (title, direction, escalation, withheld) VALUES ('全书', '方向', '台阶', '底牌')",
      "INSERT INTO story_arc (scope, title, direction, escalation, withheld, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets) VALUES ('volume', '卷一', '方向', '台阶', '底牌', 'setup', '{\"min\":6,\"max\":10}', '十日', '到婚礼', '[\"线\"]', '[\"兑现\"]')",
      "INSERT INTO story_arc (title, direction, escalation, withheld, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets) VALUES ('卷二', '方向', '台阶', '底牌', 'development', '{\"min\":6,\"max\":10}', '十日', '到后宅', '[\"线\"]', '[\"兑现\"]')",
    ].join('; ');
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql, role: 'arc-architect' });
    expect(receipt.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(receipt.status).toBe('committed');
    const arc = readAgentModuleSnapshot_ACU(chat).storyArc;
    expect(arc.map(item => item.id).sort()).toEqual(['STORY-01', 'VOL-01', 'VOL-02']);
    expect(arc.find(item => item.id === 'VOL-01')?.status).toBe('active');
    expect(arc.find(item => item.id === 'VOL-02')?.status).toBe('planned');
    const renamed = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "UPDATE story_arc SET title = '新全书' WHERE id = 'STORY-01'", role: 'arc-architect' });
    expect(renamed.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).storyArc.find(item => item.id === 'STORY-01')?.title).toBe('新全书');
    const hook = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "INSERT INTO hooks (summary) VALUES ('信件')", role: 'hook-cognition-maintainer' });
    expect(hook.status).toBe('committed');
    expect(hook.accepted.map(item => item.id)).toContain('H001');
  });

  it('总纲单栏写入拒绝照抄格式示例，同时接受真实短标题', async () => {
    const { chat } = setup();
    const bad = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role: 'arc-architect',
      sql: "INSERT INTO story_arc (id, title, direction, expected_revision) VALUES ('STORY-01', '简称', '本层推进方向与人物驱动力', 0)",
    });
    expect(bad.status).toBe('committed');
    expect(bad.accepted.map(item => item.field)).toEqual(['scope', 'status']);
    expect(bad.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'storyArc#STORY-01.title', reason: expect.stringContaining('不能照抄') }),
      expect.objectContaining({ path: 'storyArc#STORY-01.direction', reason: expect.stringContaining('不能照抄') }),
    ]));
    const saved = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role: 'arc-architect',
      sql: `UPDATE story_arc SET title = '标题', direction = '主角追查禁区的真实来历' WHERE id = 'STORY-01' AND expected_revision = ${bad.revisions?.storyArc}`,
    });
    expect(saved.status).toBe('committed');
    expect(saved.partials).toEqual(expect.arrayContaining([expect.objectContaining({ module: 'storyArc', id: 'STORY-01', missingFields: expect.arrayContaining(['escalation', 'withheld']) })]));
  });

  it('同一条 SQL 一次写入多条新卷，再用同一修订号一次补齐 withheld', async () => {
    const { chat } = setup();
    const insert = [
      "INSERT INTO story_arc (id, scope, title, direction, escalation, status, expected_revision) VALUES ('STORY-01', 'story', '全书', '方向', '台阶', 'active', 0)",
      "INSERT INTO story_arc (id, scope, title, direction, escalation, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets, status, expected_revision) VALUES ('VOL-01', 'volume', '卷一', '方向', '台阶', 'setup', '{\"min\":6,\"max\":10}', '十日', '到婚礼', '[\"线\"]', '[\"兑现\"]', 'active', 0)",
      "INSERT INTO story_arc (id, scope, title, direction, escalation, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets, status, expected_revision) VALUES ('VOL-02', 'volume', '卷二', '方向', '台阶', 'development', '{\"min\":6,\"max\":10}', '十日', '到后宅', '[\"线\"]', '[\"兑现\"]', 'planned', 0)",
    ].join('; ');
    const inserted = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: insert, role: 'arc-architect' });
    expect(inserted.status).toBe('committed');
    expect(inserted.rejected.filter(item => item.reason.includes('revision_conflict'))).toEqual([]);
    expect(inserted.partials?.map(item => item.id).sort()).toEqual(['STORY-01', 'VOL-01', 'VOL-02']);
    const revision = inserted.revisions?.storyArc;
    const update = ['STORY-01', 'VOL-01', 'VOL-02']
      .map(id => `UPDATE story_arc SET withheld = '底牌' WHERE id = '${id}' AND expected_revision = ${revision}`)
      .join('; ');
    const filled = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: update, role: 'arc-architect' });
    expect(filled.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(filled.status).toBe('committed');
    expect(filled.rejected).toEqual([]);
    expect(readAgentModuleSnapshot_ACU(chat).storyArc.map(item => item.id).sort()).toEqual(['STORY-01', 'VOL-01', 'VOL-02']);
  });

  it('两次写入先保留草稿再提升完整领域行', async () => {
    const { chat, saveChat } = setup();
    const first = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(first.status).toBe('committed');
    expect(first.accepted).toEqual([{ module: 'hooks', id: 'H1', field: 'summary', revision: 1 }]);
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toHaveLength(0);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('partial');
    const second = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: UPDATE_REST, role: 'hook-cognition-maintainer' });
    expect(second.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).hooks[0]?.summary).toBe('信件');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('complete');
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('已有完整行的一栏非法时保留独立合法栏目', async () => {
    const { chat } = setup();
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: UPDATE_REST, role: 'hook-cognition-maintainer' });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "UPDATE hooks SET summary = '新信件', status = 'invalid' WHERE id = 'H1' AND expected_revision = 2", role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(receipt.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'hooks#H1.status' })]));
    expect(readAgentModuleSnapshot_ACU(chat).hooks[0].summary).toBe('新信件');
  });

  it('宿主保存失败不会出具 accepted 并恢复楼层', async () => {
    const { chat, saveChat } = setup();
    const before = structuredClone(chat);
    saveChat.mockRejectedValueOnce(new Error('disk failure'));
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt.status).not.toBe('committed');
    expect(receipt.accepted).toEqual([]);
    expect(receipt.partials).toEqual([]);
    expect(chat).toEqual(before);
  });

  it('补栏保存失败时回执只报告原先已保存的缺栏，而非未落盘的提升结果', async () => {
    const { chat, saveChat } = setup();
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    saveChat.mockRejectedValueOnce(new Error('disk failure'));
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: UPDATE_REST, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'saved' });
    expect(receipt.partials).toEqual([expect.objectContaining({ module: 'hooks', id: 'H1', missingFields: expect.arrayContaining(['status', 'importance', 'plantedIndex']) })]);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('partial');
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toHaveLength(0);
  });

  it('补偿失败时不把先前快照的缺栏和 revision 当作当前确认状态', async () => {
    const { chat, saveChat } = setup();
    expect((await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' })).status).toBe('committed');
    saveChat.mockRejectedValueOnce(new Error('primary failed')).mockRejectedValueOnce(new Error('rollback failed'));
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: UPDATE_REST, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'persist_failed', recovery: 'failed', accepted: [], partials: null, revisions: null });
  });

  it('损坏资料帧只返回结构化失败，不附带宽容折叠出的缺栏', async () => {
    const { chat, saveChat } = setup();
    chat[0][AGENT_MODULE_FIELD_ACU] = { schemaVersion: 3, deltas: 'corrupt' };
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'rejected', accepted: [], partials: null, revisions: null });
    expect(receipt.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'frame' })]));
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('无既有资料基线也能新建草稿', async () => {
    const chat: any[] = [{ is_user: false, mes: 'tail' }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 0, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('partial');
  });

  it('保存后宿主修改资料帧时回读失败且不发 accepted', async () => {
    const { chat, saveChat } = setup();
    saveChat.mockImplementationOnce(async () => { chat[1][AGENT_MODULE_FIELD_ACU].deltas = []; });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('readback_failed');
    expect(receipt.accepted).toEqual([]);
  });

  it('web_refs 页面句柄回填来源，拒绝模型伪造 URL', async () => {
    const { chat } = setup();
    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 1, role: 'web-researcher',
      sql: "INSERT INTO web_refs (name, brief, page_ref, expected_revision) VALUES ('海域', '世界设定', 'p1', 0)",
      resolvePage: handle => handle === 'p1' ? { title: '海域', source: 'web', url: 'https://example.org/a', query: '海域', sourceStatus: 'ok' } : null,
    });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).webRefs[0]).toMatchObject({ id: 'WR-001', url: 'https://example.org/a' });
  });


  it('同一模块两个独立 ID 的合法栏目只推进一次模块 revision', async () => {
    const { chat, saveChat } = setup();
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role: 'hook-cognition-maintainer',
      sql: `${INSERT_PARTIAL}; INSERT INTO hooks (id, summary, expected_revision) VALUES ('H2', '另一封信', 0)`,
    });
    expect(receipt.status).toBe('committed');
    expect(receipt.accepted).toHaveLength(2);
    expect(receipt.revisions.hooks).toBe(1);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('非法单栏、伪证据、陈旧 revision 与越权不保存', async () => {
    const { chat, saveChat } = setup();
    const cases = [
      { role: 'hook-cognition-maintainer' as const, sql: "INSERT INTO hooks (id, status, expected_revision) VALUES ('H1', 'fake', 0)" },
      { role: 'hook-cognition-maintainer' as const, sql: "INSERT INTO chronology (id, evidence_indexes, expected_revision) VALUES ('T1', '[99]', 0)" },
      { role: 'hook-cognition-maintainer' as const, sql: "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H1', '信', 99)" },
      { role: 'arc-architect' as const, sql: INSERT_PARTIAL },
    ];
    for (const input of cases) {
      const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, ...input });
      expect(receipt.status).toBe('rejected');
      expect(receipt.accepted).toEqual([]);
    }
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('已有 ID 的退役需理由，partial DELETE 仅丢弃草稿', async () => {
    const { chat } = setup();
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "DELETE FROM hooks WHERE id = 'H1' AND expected_revision = 1 AND reason = '草稿作废'", role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1).toBeUndefined();
  });

  it('补偿保存也失败时诊断双重失败且不出具接受回执', async () => {
    const { chat, saveChat } = setup();
    saveChat.mockRejectedValue(new Error('disk broken'));
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('persist_failed');
    expect(receipt.recovery).toBe('failed');
    expect(receipt.accepted).toEqual([]);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('补偿保存中字段被监听器改写时不报告已恢复落盘', async () => {
    const { chat, saveChat } = setup();
    saveChat.mockRejectedValueOnce(new Error('primary failed')).mockImplementationOnce(async () => {
      chat[1][AGENT_MODULE_FIELD_ACU] = { schemaVersion: 3, deltas: [] };
    });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[1][AGENT_MODULE_FIELD_ACU]).toEqual({ schemaVersion: 3, deltas: [] });
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('保存中切换聊天不发接受回执，并保留新聊天', async () => {
    const { chat, saveChat } = setup();
    const other = [{ is_user: false, mes: 'other' }];
    saveChat.mockImplementationOnce(async () => { _set_SillyTavern_API_ACU({ chat: other, saveChat } as any); });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('readback_failed');
    expect(receipt.accepted).toEqual([]);
    expect(other[0]).toEqual({ is_user: false, mes: 'other' });
  });


  it('信息差揭示两栏同批合并，非法成组时只拒绝相依栏', async () => {
    const { chat } = setup();
    const sql = "INSERT INTO info_gap (id, topic, objective_fact, reader_known, character_knowledge, reveal_status, expected_revision) VALUES ('G1', '秘密', '钥匙', '无人知道', '[]', 'unrevealed', 0)";
    expect((await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql, role: 'hook-cognition-maintainer' })).status).toBe('committed');
    const change = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "UPDATE info_gap SET reveal_status = 'revealed', reveal_index = 1, reader_known = '已见钥匙' WHERE id = 'G1' AND expected_revision = 1", role: 'hook-cognition-maintainer' });
    expect(change.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).infoGap[0]).toMatchObject({ revealStatus: 'revealed', revealIndex: 1, readerKnown: '已见钥匙' });
    const invalid = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "UPDATE info_gap SET reveal_status = 'unrevealed', reader_known = '另有线索' WHERE id = 'G1' AND expected_revision = 2", role: 'hook-cognition-maintainer' });
    expect(invalid.status).toBe('committed');
    expect(invalid.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'infoGap#G1.revealStatus' })]));
    expect(readAgentModuleSnapshot_ACU(chat).infoGap[0]).toMatchObject({ revealStatus: 'revealed', readerKnown: '另有线索' });
  });

  it('web_refs 无法解析页面句柄时保留独立草稿，不伪造完整行', async () => {
    const { chat } = setup();
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role: 'web-researcher',
      sql: "INSERT INTO web_refs (name, brief, page_ref, expected_revision) VALUES ('海域', '世界设定', 'fake', 0)",
      resolvePage: () => null,
    });
    expect(receipt.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'webRefs#WR-001.pageRef' })]));
    expect(readAgentModuleSnapshot_ACU(chat).webRefs).toHaveLength(0);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.webRefs?.['WR-001'].status).toBe('partial');
  });

  it('同一条草稿重复调用单栏 UPDATE 不伪造第二个完整 ID', async () => {
    const { chat } = setup();
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    const update = "UPDATE hooks SET summary = '信件' WHERE id = 'H1' AND expected_revision = 1";
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: update, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.fields.summary.revision).toBe(1);
  });


  it('旧 v1 全量资料被读作基线；新逐栏 delta 不覆写旧楼原文', async () => {
    const { chat, saveChat } = setup();
    const legacy = {
      schemaVersion: 1, settledThroughIndex: 1, updatedAt: 1,
      revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 0 },
      hooks: [], infoGap: [], constraints: [],
    };
    chat[0][AGENT_MODULE_FIELD_ACU] = legacy;
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'committed', accepted: [{ module: 'hooks', id: 'H1', field: 'summary', revision: 1 }] });
    expect(chat[0][AGENT_MODULE_FIELD_ACU]).toBe(legacy);
    expect(chat[1][AGENT_MODULE_FIELD_ACU]).toMatchObject({ schemaVersion: 3 });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('partial');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('旧基线和中间楼草稿经新末楼 checkpoint 迁移后保留，删末楼回退到原资料', async () => {
    const { chat } = setup();
    expect((await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' })).status).toBe('committed');
    const first = structuredClone(chat[1][AGENT_MODULE_FIELD_ACU]);
    chat.push({ is_user: false, mes: '新末楼' });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 2,
      sql: "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H2', '第二封信', 1)", role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.fields.summary.value).toBe('信件');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H2.fields.summary.value).toBe('第二封信');
    expect(chat[1][AGENT_MODULE_FIELD_ACU]).toEqual(first);
    chat.pop();
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H2).toBeUndefined();
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.fields.summary.value).toBe('信件');
  });

  it('切换 swipe 后不覆写旧 swipe 基线', async () => {
    const chat: any[] = [{ is_user: false, mes: 'root', swipe_id: 0,
      [AGENT_MODULE_FIELD_ACU]: { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0 } }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    const first = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 0, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(first.status).toBe('committed');
    const frame = structuredClone(chat[0][AGENT_MODULE_FIELD_ACU]);
    chat[0].swipe_id = 1;
    const switched = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 0, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(switched.status).toBe('rejected');
    expect(chat[0][AGENT_MODULE_FIELD_ACU]).toEqual(frame);
    expect(saveChat).toHaveBeenCalledTimes(1);
    chat[0].swipe_id = 0;
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.status).toBe('partial');
  });

  it('宿主保存返回前切换 active swipe 不签发旧派工 accepted', async () => {
    const { chat, saveChat } = setup();
    chat[1].swipe_id = 0;
    saveChat.mockImplementationOnce(async () => { chat[1].swipe_id = 1; });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[1].swipe_id).toBe(1);
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('宿主保存期间切换先前楼层 swipe 同样使逐栏回读失效', async () => {
    const { chat, saveChat } = setup();
    chat[0].swipe_id = 0;
    saveChat.mockImplementationOnce(async () => { chat[0].swipe_id = 1; });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[0].swipe_id).toBe(1);
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('损坏的旧资料帧不允许在其宽容结果上提交', async () => {
    const { chat, saveChat } = setup();
    chat[0][AGENT_MODULE_FIELD_ACU] = { schemaVersion: 3, deltas: 'corrupt' };
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'frame' })]));
    expect(saveChat).not.toHaveBeenCalled();
  });


  it('证据号虽不越水位但指向用户楼时逐栏拒绝', async () => {
    const { chat, saveChat } = setup();
    chat[0].is_user = true;
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, role: 'hook-cognition-maintainer',
      sql: "INSERT INTO chronology (id, evidence_indexes, expected_revision) VALUES ('T1', '[0]', 0)",
    });
    expect(receipt.status).toBe('rejected');
    expect(receipt.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'chronology#T1.evidenceIndexes' })]));
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('保存监听器改写未暂存的旧基线时不能在陈旧读取上签发 accepted', async () => {
    const { chat, saveChat } = setup();
    saveChat.mockImplementationOnce(async () => {
      chat[0][AGENT_MODULE_FIELD_ACU].hooks = [{ id: 'H-old', summary: '监听器线索', status: 'planted', importance: 'mid', plantedIndex: 0, updatedIndex: 0, plannedPayoff: '', retired: false, retiredReason: '' }];
    });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[0][AGENT_MODULE_FIELD_ACU].hooks[0].summary).toBe('监听器线索');
  });

  it('保存监听器原地改写暂存帧时不能签发 accepted，也不能擦除监听器变更', async () => {
    const { chat, saveChat } = setup();
    saveChat.mockImplementationOnce(async () => {
      chat[1][AGENT_MODULE_FIELD_ACU].deltas.at(-1).fieldUpserts.hooks.H1.summary.value = '监听器改写';
    });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1.fields.summary.value).toBe('监听器改写');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('旧楼基线保存期间变化时不发起可能覆盖新数据的补偿保存', async () => {
    const { chat, saveChat } = setup();
    saveChat.mockImplementationOnce(async () => {
      chat[0][AGENT_MODULE_FIELD_ACU].hooks = [{ id: 'H-old', summary: '新保存的线索' }];
    });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    expect(receipt).toMatchObject({ status: 'readback_failed', recovery: 'unavailable', accepted: [], partials: null, revisions: null });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('排队期间旧派工租约失效，迟到写入不触发宿主保存', async () => {
    const { chat, saveChat } = setup();
    let release!: () => void;
    saveChat.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    await vi.waitFor(() => expect(saveChat).toHaveBeenCalledTimes(1));
    let active = true;
    const second = commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1,
      sql: "INSERT INTO hooks (id, summary, expected_revision) VALUES ('H2', '迟到信件', 1)",
      role: 'hook-cognition-maintainer', isCurrent: () => active });
    active = false;
    release();
    expect((await first).status).toBe('committed');
    expect(await second).toMatchObject({ status: 'rejected', accepted: [] });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H2).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('宿主保存返回时租约失效，不签发 accepted 也不尝试旧派工补偿', async () => {
    const { chat, saveChat } = setup();
    let active = true;
    saveChat.mockImplementationOnce(async () => { active = false; });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL,
      role: 'hook-cognition-maintainer', isCurrent: () => active });
    expect(receipt).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('完整条目退役经领域校验并在保存后回读', async () => {
    const { chat } = setup();
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: INSERT_PARTIAL, role: 'hook-cognition-maintainer' });
    await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: UPDATE_REST, role: 'hook-cognition-maintainer' });
    const receipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex: 1, sql: "DELETE FROM hooks WHERE id = 'H1' AND expected_revision = 2 AND reason = '线索终结'", role: 'hook-cognition-maintainer' });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).hooks[0]).toMatchObject({ retired: true, retiredReason: '线索终结' });
  });

});
