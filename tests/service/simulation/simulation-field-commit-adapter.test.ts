import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { commitWorldSimulationFieldWrites_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { foldWorldSimulationArchive_ACU, foldWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import type { WorldSimulationFieldCommitInput_ACU } from '../../../src/service/simulation/simulation-field-commit-adapter';

function fixture(saveChat = vi.fn().mockResolvedValue(undefined)) {
  const chat: any[] = [{}, { message_id: 1, mes: '第一楼', swipe_id: 0 }, { message_id: 2, mes: '第二楼', swipe_id: 0 }];
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-field', getCurrentChatId: () => 'chat-field', saveChat } as any);
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
  const identity = { runId: 'field-run', chatIdentity: 'chat-field', triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
    anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'task-field', stageId: 'stage-field', stageRevision: 1 };
  envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1,
    activeRun: identity, stopReason: null };
  envelope.activeStageId = identity.stageId;
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
    revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
      plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
        plannedSpecialists: [], expectedLedgerChanges: ['dimensions'], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '提交' } }] }];
  chat[0]._qrf_world_simulation = envelope;
  const input: WorldSimulationFieldCommitInput_ACU = { identity, anchor, role: 'undercurrent-analyst',
    sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0)",
    evidenceRegistry: { runId: identity.runId, entries: [] }, updatedAt: 100 };
  return { chat, saveChat, input };
}

const complete = "UPDATE dimensions SET kind = 'pressure', value = 10, trend = 'rising', rationale = '海风', evidence_refs = '[]' WHERE id = 'dim-a' AND expected_revision = 0";

describe('world simulation field commit adapter', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('两次提交先 partial 后 complete，仅在宿主保存并折叠回读后发 accepted', async () => {
    const { chat, saveChat, input } = fixture();
    const first = await commitWorldSimulationFieldWrites_ACU(input);
    expect(first).toMatchObject({ status: 'committed', ledgerRevision: 0 });
    expect(first.accepted.map(item => item.field)).toEqual(['name']);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toEqual([]);
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].status).toBe('partial');
    const second = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete, updatedAt: 101 });
    if (second.status !== 'committed') throw new Error(JSON.stringify(second));
    expect(second).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    expect(second.accepted.map(item => item.field)).toEqual(expect.arrayContaining(['kind', 'value']));
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].status).toBe('complete');
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions[0]).toMatchObject({ id: 'dim-a', revision: 1 });
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('编年草稿拒绝坏 summary 后保留 at，仅补 summary 再提升；完整编年不可更新', async () => {
    const { chat, input, saveChat } = fixture();
    const base = { ...input, role: 'chronicler' };
    const first = await commitWorldSimulationFieldWrites_ACU({ ...base,
      sql: "INSERT INTO chronicle (id, at, summary) VALUES ('chr-1', '第一日', '')" });
    expect(first.status).toBe('committed');
    expect(first.accepted.map(item => item.field)).toEqual(['at']);
    expect(first.rejected).toEqual([expect.objectContaining({ path: 'chronicle#chr-1.summary' })]);
    expect(first.partials).toEqual([expect.objectContaining({ module: 'chronicle', id: 'chr-1', missingFields: ['summary'] })]);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.chronicle).toEqual([]);
    const second = await commitWorldSimulationFieldWrites_ACU({ ...base,
      sql: "UPDATE chronicle SET summary = '守门人夜间盘查' WHERE id = 'chr-1' AND expected_revision = 0" });
    expect(second.status).toBe('committed');
    expect(second.accepted.map(item => item.field)).toEqual(['summary']);
    expect(second.partials).toEqual([]);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.chronicle).toEqual([expect.objectContaining({ id: 'chr-1', at: '第一日', summary: '守门人夜间盘查' })]);
    const third = await commitWorldSimulationFieldWrites_ACU({ ...base,
      sql: "UPDATE chronicle SET summary = '改写' WHERE id = 'chr-1' AND expected_revision = 0" });
    expect(third.status).toBe('rejected');
    expect(third.rejected).toEqual([expect.objectContaining({ reason: expect.stringContaining('完整编年不可 UPDATE') })]);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('无权模块、伪证据、陈旧条目 revision 不产生保存', async () => {
    const { saveChat, input } = fixture();
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, sql: "INSERT INTO actors (id, name, expected_revision) VALUES ('actor-a', '陌生人', 0)" })).status).toBe('rejected');
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, sql: "INSERT INTO dimensions (id, evidence_refs, expected_revision) VALUES ('dim-b', '[\"fake\"]', 0)" })).accepted).toEqual([]);
    expect(saveChat).not.toHaveBeenCalled();
    await commitWorldSimulationFieldWrites_ACU(input);
    saveChat.mockClear();
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, sql: "UPDATE dimensions SET name = '新' WHERE id = 'dim-a' AND expected_revision = 9" })).rejected).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('revision_conflict') })]));
    expect(saveChat).not.toHaveBeenCalled();
  });


  it('完整条目触发基线迁移时主保存失败恢复锚点外所有 checkpoint 楼层', async () => {
    const saveChat = vi.fn().mockResolvedValue(undefined);
    const { chat, input } = fixture(saveChat);
    await commitWorldSimulationFieldWrites_ACU(input);
    saveChat.mockClear();
    // 把第一条成功写入的基线和 delta 移到另一楼，并用该楼自己的锚点重新分桶。
    const source = Object.values(chat[2]._qrf_world_simulation_state.entries)[0] as any;
    const earlierAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const earlierKey = buildWorldSimulationBucketKey_ACU(earlierAnchor);
    chat[1]._qrf_world_simulation_state = { schemaVersion: 1, entries: { [earlierKey]: { ...source, anchor: earlierAnchor } } };
    delete chat[2]._qrf_world_simulation_state;
    saveChat.mockRejectedValueOnce(new Error('primary failed')).mockResolvedValueOnce(undefined);
    const before = JSON.parse(JSON.stringify(chat));
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete, updatedAt: 101 });
    if (result.status !== 'persist_failed') throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'saved' });
    expect(chat).toEqual(before);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('补齐草稿的保存失败时只反馈先前已确认的缺栏', async () => {
    const { chat, input, saveChat } = fixture();
    await commitWorldSimulationFieldWrites_ACU(input);
    saveChat.mockRejectedValueOnce(new Error('disk failure'));
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete, updatedAt: 101 });
    expect(result).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'saved' });
    expect(result.partials).toEqual([expect.objectContaining({ module: 'dimensions', id: 'dim-a', missingFields: expect.arrayContaining(['kind', 'value']) })]);
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].status).toBe('partial');
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toEqual([]);
  });

  it('先前草稿补齐后补偿失败时不回报过时的缺栏与 revision', async () => {
    const { chat, input, saveChat } = fixture();
    expect((await commitWorldSimulationFieldWrites_ACU(input)).status).toBe('committed');
    saveChat.mockRejectedValueOnce(new Error('primary failed')).mockRejectedValueOnce(new Error('rollback failed'));
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete, updatedAt: 101 });
    expect(result).toMatchObject({ status: 'persist_failed', recovery: 'failed', accepted: [], partials: null, ledgerRevision: null });
    expect(chat[2]._qrf_world_simulation_state).toBeDefined();
  });

  it('宿主保存失败还原所有受影响楼层，并执行一次补偿保存', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockResolvedValueOnce(undefined);
    const { chat, input } = fixture(saveChat);
    const before = JSON.parse(JSON.stringify(chat));
    const result = await commitWorldSimulationFieldWrites_ACU(input);
    expect(result).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'saved', partials: [] });
    expect(chat).toEqual(before);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });
});

describe('world simulation field commit recovery', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('主保存返回成功但私有楼层字段被宿主改写时，禁止 accepted 并报告无法安全补偿', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      chat[2]._qrf_world_simulation_state = { schemaVersion: 1, entries: {} };
    }).mockResolvedValueOnce(undefined);
    const setup = fixture(saveChat);
    chat = setup.chat;
    const { input } = setup;
    const result = await commitWorldSimulationFieldWrites_ACU(input);
    expect(result.status).toBe('readback_failed');
    expect(result.accepted).toEqual([]);
    expect(result.recovery).toBe('unavailable');
  });

  it('保存监听器原地改写暂存帧时不擦除其改动，且不签发 accepted', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      const staged = chat[2]._qrf_world_simulation_state;
      (Object.values(staged.entries)[0] as any).value.deltas.at(-1).fieldUpserts.dimensions['dim-a'].name.value = '监听器改写';
    });
    const setup = fixture(saveChat);
    chat = setup.chat;
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].fields.name.value).toBe('监听器改写');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('旧楼锚点变化后不再报告旧草稿是当前确认的缺栏', async () => {
    const { chat, input, saveChat } = fixture();
    expect((await commitWorldSimulationFieldWrites_ACU(input)).status).toBe('committed');
    saveChat.mockImplementationOnce(async () => { chat[1].swipe_id = 1; });
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete, updatedAt: 101 });
    expect(result).toMatchObject({ status: 'readback_failed', recovery: 'unavailable', accepted: [], partials: null, ledgerRevision: null });
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('宿主保存期间旧楼 active swipe 切换即使折叠值未变化也不签发 accepted', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => { chat[1].swipe_id = 1; });
    const setup = fixture(saveChat);
    chat = setup.chat;
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[1].swipe_id).toBe(1);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('保存监听器改变运行租约时不能宣称本轮逐栏成功', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      chat[0]._qrf_world_simulation.task.activeRun = { ...chat[0]._qrf_world_simulation.task.activeRun, runId: 'other-run' };
    }).mockResolvedValueOnce(undefined);
    const setup = fixture(saveChat);
    chat = setup.chat;
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(result.accepted).toEqual([]);
    expect(result.status).toBe('readback_failed');
    expect(chat[0]._qrf_world_simulation.task.activeRun.runId).toBe('other-run');
  });

  it('保存监听器改写未暂存的旧楼账本时不能在陈旧基线上签发 accepted', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      (Object.values(chat[1]._qrf_world_simulation_state.entries)[0] as any).value.clock.storyTime = '监听器时间';
    });
    const setup = fixture(saveChat);
    chat = setup.chat;
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const key = buildWorldSimulationBucketKey_ACU(anchor);
    chat[1]._qrf_world_simulation_state = { schemaVersion: 1,
      entries: { [key]: { anchor, value: buildDefaultWorldSimulationEnvelope_ACU().ledger, updatedAt: 1 } } };
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.clock.storyTime).toBe('监听器时间');
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect((Object.values(chat[1]._qrf_world_simulation_state.entries)[0] as any).value.clock.storyTime).toBe('监听器时间');
  });

  it('保存监听器改写暂存之外的首楼账本时不能在旧规划上签发 accepted', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      chat[0]._qrf_world_simulation.ledger.revision = 9;
    });
    const setup = fixture(saveChat);
    chat = setup.chat;
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[0]._qrf_world_simulation.ledger.revision).toBe(9);
  });

  it('保存监听器原地改写与输入共用的运行租约时不能跟随变更签发 accepted', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      chat[0]._qrf_world_simulation.task.activeRun.runId = 'other-run';
    });
    const setup = fixture(saveChat);
    chat = setup.chat;
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[0]._qrf_world_simulation.task.activeRun.runId).toBe('other-run');
  });

  it('补偿保存监听器再次改写恢复字段时不能报告 recovery saved', async () => {
    let chat: any[];
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockImplementationOnce(async () => {
      chat[2]._qrf_world_simulation_state = { schemaVersion: 1, entries: {} };
    });
    const setup = fixture(saveChat);
    chat = setup.chat;
    const result = await commitWorldSimulationFieldWrites_ACU(setup.input);
    expect(result).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[2]._qrf_world_simulation_state.entries).toEqual({});
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('补偿宿主保存失败明确报告，内存恢复不冒称落盘', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockRejectedValueOnce(new Error('rollback failed'));
    const { chat, input } = fixture(saveChat);
    const before = JSON.parse(JSON.stringify(chat));
    const result = await commitWorldSimulationFieldWrites_ACU(input);
    expect(result).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'failed' });
    expect(chat).toEqual(before);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });
});

describe('world simulation dispatch lease', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('同聊天队列等待期间派工过期时不保存迟到逐栏写入', async () => {
    let releaseSave!: () => void;
    let notifySave!: () => void;
    const saving = new Promise<void>(resolve => { notifySave = resolve; });
    const blocked = new Promise<void>(resolve => { releaseSave = resolve; });
    const saveChat = vi.fn().mockImplementationOnce(async () => { notifySave(); await blocked; });
    const { chat, input } = fixture(saveChat);
    const first = commitWorldSimulationFieldWrites_ACU(input);
    await saving;
    let current = true;
    const late = commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete, isCurrent: () => current });
    current = false;
    releaseSave();
    expect((await first).status).toBe('committed');
    await expect(late).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' } });
    expect(foldWorldSimulationLedger_ACU(chat)!.fields.records.dimensions!['dim-a'].fields).toHaveProperty('name');
    expect(foldWorldSimulationLedger_ACU(chat)!.ledger.dimensions).toEqual([]);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('宿主保存返回时派工过期不签发 accepted 或发起补偿保存', async () => {
    let current = true;
    const saveChat = vi.fn().mockImplementationOnce(async () => { current = false; });
    const { chat, input } = fixture(saveChat);
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, isCurrent: () => current });
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat[2]._qrf_world_simulation_state).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('world simulation field commit batching', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('同批两模块完整变更仅推进一次 revision 且楼层保存一次', async () => {
    const { chat, input, saveChat } = fixture();
    const sql = "INSERT INTO dimensions (id, name, kind, value, trend, rationale, evidence_refs, expected_revision) VALUES ('dim-a', '风暴', 'pressure', 10, 'rising', '海风', '[]', 0); INSERT INTO seeds (id, title, status, level, catalyst, visibility, location, evidence_refs, expected_revision) VALUES ('seed-a', '出海', 'active', 1, '风向', 'public', NULL, '[]', 0)";
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, sql });
    expect(result).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toMatchObject({ revision: 1, dimensions: [{ id: 'dim-a' }], seeds: [{ id: 'seed-a' }] });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('逐栏归档提交后子代理调阅新归档，不使用开局冻结的归档快照', async () => {
    const { chat, input, saveChat } = fixture();
    const { createWorldSimulationToolDependencies_ACU, runWorldSimulationToolBatch_ACU } = await import('../../../src/service/simulation/world-simulation-agent-tools');
    const { createWorldSimulationEvidenceRegistry_ACU } = await import('../../../src/service/simulation/world-simulation-evidence-registry');
    const registry = createWorldSimulationEvidenceRegistry_ACU('archive-read');
    const tools = createWorldSimulationToolDependencies_ACU({ anchorMessage: '', summary: '', ledger: chat[0]._qrf_world_simulation.ledger,
      stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
      chronicleArchive: foldWorldSimulationArchive_ACU(chat, input.anchor.messageIndex).snapshot,
      liveArchive: () => foldWorldSimulationArchive_ACU(chat, input.anchor.messageIndex).snapshot });
    const sql = "INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-new', 1, '新归档'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-new', 1, 'fp-new', '新归档')";
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'chronicler', sql })).status).toBe('committed');
    const result = await runWorldSimulationToolBatch_ACU({ registry, dependencies: tools,
      calls: [{ kind: 'read', reads: ['chronicle-archive:archive-new'] }] });
    expect(result[0]).toMatchObject({ status: 'ok', content: expect.stringContaining('新归档') });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('单独成对编年归档仅推进一次 revision 且归档回读相同', async () => {
    const { chat, input, saveChat } = fixture();
    const sql = "INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-a', 1, '风暴'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-a', 1, 'fp-a', '风暴')";
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'chronicler', sql });
    expect(result).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.chronicleOverview).toHaveLength(1);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('world simulation field commit identity and no-op', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('过期锚点与聊天切换在落盘前拒绝', async () => {
    const stale = fixture();
    stale.chat[2].mes = '更新后的正文';
    await expect(commitWorldSimulationFieldWrites_ACU(stale.input)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_ANCHOR_STALE' } });
    expect(stale.saveChat).not.toHaveBeenCalled();
    const changed = fixture();
    _set_SillyTavern_API_ACU({ chat: changed.chat, chatId: 'other', getCurrentChatId: () => 'other', saveChat: changed.saveChat } as any);
    await expect(commitWorldSimulationFieldWrites_ACU(changed.input)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' } });
    expect(changed.saveChat).not.toHaveBeenCalled();
  });

  it('同值 partial UPDATE 保留同一 ID 与栏目 revision，且只有回读成功才签发回执', async () => {
    const { chat, input, saveChat } = fixture();
    expect((await commitWorldSimulationFieldWrites_ACU(input)).status).toBe('committed');
    const before = foldWorldSimulationLedger_ACU(chat)!.fields.records.dimensions!['dim-a'];
    const receipt = await commitWorldSimulationFieldWrites_ACU({ ...input,
      sql: "UPDATE dimensions SET name = '风暴' WHERE id = 'dim-a' AND expected_revision = 0", updatedAt: 101 });
    expect(receipt).toMatchObject({ status: 'committed', accepted: [{ module: 'dimensions', id: 'dim-a', field: 'name', revision: before.fields.name.revision }], ledgerRevision: 0 });
    const after = foldWorldSimulationLedger_ACU(chat)!.fields.records.dimensions!['dim-a'];
    expect(after.status).toBe('partial');
    expect(after.fields.name.revision).toBe(before.fields.name.revision);
    expect(foldWorldSimulationLedger_ACU(chat)!.ledger.dimensions).toEqual([]);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('锚点楼层在保存前移位时按冻结身份重定位，不把逐栏帧写到旧下标', async () => {
    const { chat, input, saveChat } = fixture();
    chat.splice(2, 0, { message_id: 3, mes: '插入的旧楼', swipe_id: 0 });
    const result = await commitWorldSimulationFieldWrites_ACU(input);
    expect(result).toMatchObject({ status: 'committed', accepted: [expect.objectContaining({ id: 'dim-a', field: 'name' })] });
    expect(chat[2]._qrf_world_simulation_state).toBeUndefined();
    expect(foldWorldSimulationLedger_ACU(chat, 2)?.fields.records.dimensions?.['dim-a']).toBeUndefined();
    expect(foldWorldSimulationLedger_ACU(chat, 3)?.fields.records.dimensions?.['dim-a'].fields.name.value).toBe('风暴');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('切换 active swipe 后不会把旧 swipe 草稿当作新记录，也不会覆盖旧分桶', async () => {
    const { chat, input, saveChat } = fixture();
    expect((await commitWorldSimulationFieldWrites_ACU(input)).status).toBe('committed');
    const previous = structuredClone(chat[2]._qrf_world_simulation_state);
    chat[2].swipe_id = 1;
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a']).toBeUndefined();
    await expect(commitWorldSimulationFieldWrites_ACU(input)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_ANCHOR_STALE' } });
    expect(chat[2]._qrf_world_simulation_state).toEqual(previous);
    chat[2].swipe_id = 0;
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].fields.name.value).toBe('风暴');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('旧完整条目值未变时不发 accepted、不保存、不推进 revision', async () => {
    const { chat, input, saveChat } = fixture();
    const insert = "INSERT INTO dimensions (id, name, kind, value, trend, rationale, evidence_refs, expected_revision) VALUES ('dim-a', '风暴', 'pressure', 10, 'rising', '海风', '[]', 0)";
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, sql: insert })).status).toBe('committed');
    saveChat.mockClear();
    const noop = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: "UPDATE dimensions SET value = 10 WHERE id = 'dim-a' AND expected_revision = 1" });
    expect(noop).toMatchObject({ status: 'rejected', accepted: [], ledgerRevision: 1 });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions[0].revision).toBe(1);
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('world simulation field commit compound writes', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('编年完整行和成对归档同批保存一次且仅推进一次账本 revision', async () => {
    const { chat, input, saveChat } = fixture();
    const sql = "INSERT INTO chronicle (id, at, summary, related_ids) VALUES ('chr-a', '第一天', '风暴', '[]'); INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-a', 1, '风暴'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-a', 1, 'fp-a', '风暴')";
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'chronicler', sql });
    expect(result).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    expect(result.accepted.map(item => item.field)).toContain('archive');
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger).toMatchObject({ revision: 1, chronicle: [{ id: 'chr-a' }], chronicleOverview: [{ archiveRef: 'archive-a' }] });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('已有归档时继续追加第二组成对归档，不把既有归档误判为 SQL 复算差异', async () => {
    const { chat, input, saveChat } = fixture();
    const first = "INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-a', 1, '风暴'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-a', 1, 'fp-a', '风暴')";
    const second = "INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-b', 2, '港口'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-b', 2, 'fp-b', '港口')";
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'chronicler', sql: first })).status).toBe('committed');
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'chronicler', sql: second, updatedAt: 101 });
    expect(result).toMatchObject({ status: 'committed', ledgerRevision: 2 });
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('完整条目 DELETE 后同内存折叠不残留栏目记录', async () => {
    const { chat, input, saveChat } = fixture();
    const insert = "INSERT INTO dimensions (id, name, kind, value, trend, rationale, evidence_refs, expected_revision) VALUES ('dim-a', '风暴', 'pressure', 10, 'rising', '海风', '[]', 0)";
    expect((await commitWorldSimulationFieldWrites_ACU({ ...input, sql: insert })).status).toBe('committed');
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, sql: "DELETE FROM dimensions WHERE id = 'dim-a' AND expected_revision = 1 AND reason = '消散'", updatedAt: 101 });
    expect(result).toMatchObject({ status: 'committed', ledgerRevision: 2 });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toEqual([]);
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a']).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('分离角色提交：合法 actor 完整保存，孤儿 rumor 仅保留 partial', async () => {
    const { chat, input, saveChat } = fixture();
    const actorSql = "INSERT INTO actors (id, name, interests, location, goals, information_sources, known_facts, life, died_at_day, death_summary, expected_revision) VALUES ('actor-ok', '水手', '[]', '港口', '[]', '[]', '[]', 'alive', NULL, NULL, 0)";
    const actorResult = await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'dramatis-keeper', sql: actorSql });
    expect(actorResult).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    const rumorSql = "INSERT INTO rumors (id, fact, origin_day, channels, related_actor_ids, expected_revision) VALUES ('rumor-bad', '不存在的人', 1, '[\"酒馆\"]', '[\"ghost\"]', 0)";
    const result = await commitWorldSimulationFieldWrites_ACU({ ...input, role: 'chronicler', sql: rumorSql, updatedAt: 101 });
    expect(result).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    expect(result.partials).toEqual([expect.objectContaining({ id: 'rumor-bad', promotionError: expect.any(String) })]);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.actors).toHaveLength(1);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.rumors).toEqual([]);
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.rumors?.['rumor-bad'].status).toBe('partial');
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('保存期间切换聊天不签发 accepted，不覆盖新聊天', async () => {
    const { chat, input } = fixture();
    const otherChat = [{}, { message_id: 1, mes: '其他聊天' }];
    const otherSave = vi.fn();
    const saveChat = vi.fn().mockImplementation(async () => {
      _set_SillyTavern_API_ACU({ chat: otherChat, chatId: 'other', getCurrentChatId: () => 'other', saveChat: otherSave } as any);
    });
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-field', getCurrentChatId: () => 'chat-field', saveChat } as any);
    const before = JSON.parse(JSON.stringify(chat));
    const result = await commitWorldSimulationFieldWrites_ACU(input);
    expect(result).toMatchObject({ status: 'readback_failed', accepted: [], recovery: 'unavailable' });
    expect(chat).toEqual(before);
    expect(otherChat).toEqual([{},{ message_id: 1, mes: '其他聊天' }]);
    expect(otherSave).not.toHaveBeenCalled();
  });

  it('损坏的活跃账本帧和归档帧不能按空状态继续提交', async () => {
    for (const field of ['_qrf_world_simulation_state', '_qrf_world_simulation_chronicle_archive']) {
      const { chat, input, saveChat } = fixture();
      const anchor = input.anchor;
      const key = buildWorldSimulationBucketKey_ACU(anchor);
      chat[2][field] = { schemaVersion: 1, entries: { [key]: { anchor, updatedAt: 1, value: { schemaVersion: 2, deltas: 'corrupt' } } } };
      await expect(commitWorldSimulationFieldWrites_ACU(input)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
      expect(saveChat).not.toHaveBeenCalled();
    }
  });

  it('当前分桶键下的锚点身份被篡改时拒绝提交，而不在伪造资料上续写', async () => {
    const { chat, input, saveChat } = fixture();
    const anchor = input.anchor;
    const key = buildWorldSimulationBucketKey_ACU(anchor);
    chat[2]._qrf_world_simulation_state = {
      schemaVersion: 1,
      entries: { [key]: { anchor: { ...anchor, swipeId: 'other' }, value: buildDefaultWorldSimulationEnvelope_ACU().ledger, updatedAt: 1 } },
    };
    await expect(commitWorldSimulationFieldWrites_ACU(input)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('旧 v1 全量账本可归一化作为只读基线，逐栏写入后仍保留旧楼原文', async () => {
    const { chat, input, saveChat } = fixture();
    const old: any = { ...buildDefaultWorldSimulationEnvelope_ACU().ledger, schemaVersion: 1 };
    old.clock = { storyTime: '第三日黄昏', elapsed: '3日', precision: 'approximate', evidenceRefs: [] };
    old.guidance = { signals: ['风声'], excludedFacts: [], evidenceRefs: [] };
    delete old.rumors;
    delete old.player;
    delete old.chronicleOverview;
    delete old.pendingFixes;
    delete old.materialCompletion;
    const firstAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const firstKey = buildWorldSimulationBucketKey_ACU(firstAnchor);
    chat[1]._qrf_world_simulation_state = { schemaVersion: 1, entries: { [firstKey]: { anchor: firstAnchor, value: old, updatedAt: 1 } } };
    const previous = structuredClone(chat[1]._qrf_world_simulation_state);
    const receipt = await commitWorldSimulationFieldWrites_ACU(input);
    expect(receipt).toMatchObject({ status: 'committed', ledgerRevision: 0 });
    expect(chat[1]._qrf_world_simulation_state).toEqual(previous);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.clock.day).toBe(3);
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].status).toBe('partial');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('损坏的活跃分桶不被视为另一 swipe 的空资料', async () => {
    const { chat, input, saveChat } = fixture();
    chat[2]._qrf_world_simulation_state = { schemaVersion: 1, entries: 'corrupt' };
    await expect(commitWorldSimulationFieldWrites_ACU(input)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('损坏的逐栏帧读取抛出结构化错误，不把它当空草稿写入', async () => {
    const { chat, input, saveChat } = fixture();
    expect((await commitWorldSimulationFieldWrites_ACU(input)).status).toBe('committed');
    const frame = Object.values(chat[2]._qrf_world_simulation_state.entries)[0] as any;
    frame.value.deltas.at(-1).fieldUpserts.dimensions['dim-a'].name = { notAWrite: true };
    saveChat.mockClear();
    await expect(commitWorldSimulationFieldWrites_ACU({ ...input, sql: complete })).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('world simulation subagent production write loop', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('连续真实请求只补缺栏，保存回执仅留在本次派工 transcript', async () => {
    const { chat, input, saveChat } = fixture();
    const { buildDefaultWorldSimulationSettings_ACU } = await import('../../../src/service/simulation/defaults');
    const { buildDefaultWorldSimulationAgentPrompts_ACU } = await import('../../../src/service/simulation/agent/agent-defaults');
    const { WorldSimulationSubagentRuntime_ACU } = await import('../../../src/service/simulation/agent/agent-subagent-runtime');
    const { createWorldSimulationToolDependencies_ACU } = await import('../../../src/service/simulation/world-simulation-agent-tools');
    const { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } = await import('../../../src/service/simulation/world-simulation-evidence-registry');
    const registry = createWorldSimulationEvidenceRegistry_ACU(input.identity.runId);
    const settings = { ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU() };
    const tools = createWorldSimulationToolDependencies_ACU({ anchorMessage: '第二楼', summary: '', ledger: chat[0]._qrf_world_simulation.ledger,
      stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
      liveLedger: () => foldWorldSimulationLedger_ACU(chat, input.anchor.messageIndex) ?? { ledger: chat[0]._qrf_world_simulation.ledger, fields: undefined } });
    const requests: Array<readonly { role: string; content: string }[]> = [];
    const responses: unknown[] = [
      { content: '', toolCalls: [{ id: 'call-write-1', name: 'write_sql', arguments: JSON.stringify({ sql: input.sql }) }] },
      { content: '', toolCalls: [{ id: 'call-write-2', name: 'write_sql', arguments: JSON.stringify({ sql: complete }) }] },
      { status: 'no_change', agentName: 'undercurrent-analyst', summary: '分栏已提交', evidenceRefs: [], uncertainties: [] },
    ];
    const invoke = vi.fn(async (_role: string, messages: readonly { role: string; content: string }[]) => {
      requests.push(messages.map(message => ({ ...message })));
      return responses.shift() as any;
    });
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke: invoke as any, countTokens: async () => 1,
      apiPreset: { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) } });
    const promptContext = { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '',
      worldState: chat[0]._qrf_world_simulation.ledger, anchorMessage: '第二楼', anchorIdentity: input.anchor, worldStagePlan: {},
      worldChronicle: [], worldCandidates: [], worldCollisions: {}, evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} };
    const run = () => runtime.run({ delegation: { agentName: 'undercurrent-analyst', instruction: '补齐维度', reads: [] },
      settings, promptContext: promptContext as any, registry, tools, runId: input.identity.runId,
      writeSql: write => commitWorldSimulationFieldWrites_ACU({ ...input, ...write }),
      readCurrent: () => foldWorldSimulationLedger_ACU(chat, input.anchor.messageIndex)?.ledger ?? chat[0]._qrf_world_simulation.ledger });
    await run();
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toHaveLength(1);
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions[0].name).toBe('风暴');
    const firstReceiptMessage = requests[1].find(message => message.role === 'tool'
      && (message as { tool_call_id?: string }).tool_call_id === 'call-write-1');
    if (!firstReceiptMessage) throw new Error('未找到 call-write-1 的原生工具回执');
    const firstReceipt = JSON.parse(firstReceiptMessage.content).results[0];
    expect(firstReceipt).toMatchObject({ status: 'committed', accepted: [expect.objectContaining({ field: 'name' })], ledgerRevision: 0 });
    expect(requests[1].at(-3)!.content).toContain('write_sql');
    expect(requests[1].at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('<thinking>') });
    expect(requests[2].some(message => message.content.includes('\"ledgerRevision\":1'))).toBe(true);
    const otherRequests: Array<readonly { role: string; content: string }[]> = [];
    const fresh = new WorldSimulationSubagentRuntime_ACU({ invoke: (async (_role: string, messages: readonly { role: string; content: string }[]) => {
      otherRequests.push(messages);
      return JSON.stringify({ status: 'no_change', summary: '新派工', evidenceRefs: [], uncertainties: [] });
    }) as any, countTokens: async () => 1,
    apiPreset: { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) } });
    await fresh.run({ delegation: { agentName: 'dramatis-keeper', instruction: '核对人物', reads: [] },
      settings, promptContext: promptContext as any, registry, tools, runId: 'next-run', readCurrent: () => foldWorldSimulationLedger_ACU(chat)!.ledger });
    expect(otherRequests[0].some(message => message.role === 'assistant' && message.content.includes(input.sql))).toBe(false);
    expect(otherRequests[0].some(message => message.role === 'user' && message.content.includes('"ledgerRevision":0'))).toBe(false);
    expect(otherRequests[0].some(message => message.content.includes('"name":"风暴"'))).toBe(true);
  });
});
