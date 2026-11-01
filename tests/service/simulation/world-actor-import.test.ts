import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { appendWorldActors_ACU } from '../../../src/service/simulation/world-actor-import';
import { appendWorldSimulationActorsHost_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { foldWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import type { WorldActor_ACU } from '../../../src/service/simulation/model';

const actor = (id: string, name = id, loreRefs: string[] = []): WorldActor_ACU => ({
  id, name, loreRefs, interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
  deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
  visibility: 'hidden', currentAction: null, longTermAction: null, simulationStatus: 'active', experiences: [], revision: 1,
});

function host(saveChat = vi.fn().mockResolvedValue(undefined), withEnvelope = true) {
  const chat: any[] = [{ message_id: 0, is_user: true, mes: '开场' },
    { message_id: 5, is_user: false, mes: '正文', message: '正文', swipe_id: 1, swipes: ['旧正文', '正文'] }];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger.actors = [actor('old', '同名', ['old-lore'])];
  if (withEnvelope) chat[0]._qrf_world_simulation = envelope;
  chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = { keep: 'conversation' };
  _set_SillyTavern_API_ACU({ chat, chatId: 'actor-import', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'import-card.png', name: '测试' }], getCurrentChatId: () => 'actor-import', saveChat } as any);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_FETCH'); }));
  return { chat, envelope, saveChat };
}

beforeEach(() => { _set_SillyTavern_API_ACU(null as any); vi.unstubAllGlobals(); });

describe('appendWorldActors_ACU', () => {
  it('同名不同 lore 保留；相同 id 和同名共享 lore 跳过；逐条容错且只加人物', () => {
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    ledger.actors = [actor('old', '张 三', ['lore:1'])];
    const next = appendWorldActors_ACU(ledger, [actor('old'), actor('duplicate', '张  三', ['lore:1']),
      actor('other', '张 三', ['lore:2']), { ...actor('bad'), visibility: 'invalid' } as unknown as WorldActor_ACU,
      { ...actor('new', '新人物'), interests: undefined, currentAction: undefined, revision: 27 } as unknown as WorldActor_ACU]);
    expect(next.actors.map(item => item.id)).toEqual(['old', 'other', 'new']);
    expect(next.actors[0]).toBe(ledger.actors[0]);
    expect(next.actors[2]).toMatchObject({ interests: [], revision: 1, knownFacts: [], experiences: [], simulationStatus: 'active' });
    expect(next.revision).toBe(ledger.revision + 1);
    for (const key of Object.keys(ledger) as Array<keyof typeof ledger>) {
      if (key !== 'actors' && key !== 'revision') expect(next[key]).toBe(ledger[key]);
    }
    expect(appendWorldActors_ACU(next, [actor('other')])).toBe(next);
  });

  it('旧人宽容匹配直接跳过，合法新人逐条保留且不携带额外字段', () => {
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const existing = actor('Hero.One', '阿 洛', [' 世界书／人物 ']);
    const numericExisting = actor('42', '已有数字ID人物');
    ledger.actors = [existing, numericExisting];
    const invalid = { ...actor('invalid'), life: 'unknown' } as unknown as WorldActor_ACU;
    const next = appendWorldActors_ACU(ledger, [
      actor(' ＨＥＲＯ.ＯＮＥ ', '任意候选'),
      { ...actor('42'), id: 42 } as unknown as WorldActor_ACU,
      actor('same-lore', '阿  洛', ['世界书/人物']),
      actor('different', '阿 洛', ['其他引用']),
      { ...actor(' new.actor ', '新人'), interests: null, resources: '木剑', goals: undefined,
        informationSources: '世界书', loreRefs: '条目', futureField: '不保存' } as unknown as WorldActor_ACU,
      invalid,
      actor('ＮＥＷ.ＡＣＴＯＲ', '同批重复'),
    ]);
    expect(next.actors.map(item => item.id)).toEqual(['Hero.One', '42', 'different', 'new.actor']);
    expect(next.actors[0]).toBe(existing);
    expect(next.actors[1]).toBe(numericExisting);
    expect(next.actors[3]).toMatchObject({ interests: [], resources: ['木剑'], goals: [],
      informationSources: ['世界书'], loreRefs: ['条目'], revision: 1 });
    expect(next.actors[3]).not.toHaveProperty('futureField');
    expect(next.revision).toBe(ledger.revision + 1);
  });
});

describe('appendWorldSimulationActorsHost_ACU', () => {
  it('当前 swipe 保存 delta，保留所有其他模块、正文和会话并废弃暂停任务', async () => {
    const f = host();
    const anchor = resolveWorldSimulationAnchor_ACU(1, f.chat);
    const identity = { runId: 'old-run', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed',
      triggerConversationMessageId: null, anchorContentDigest: anchor.contentDigest, anchorMessageId: anchor.messageId,
      anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
      baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 } as any;
    f.envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '暂停', impactScope: [], factsToVerify: [],
          plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [],
          blockingConditions: [], completedSteps: [], nextStep: '' } }] }] as any;
    f.envelope.activeStageId = 'stage';
    f.envelope.task = { taskId: 'task', originInstruction: '推进', status: 'paused', activeRun: identity,
      completedRun: identity, createdAt: 1, updatedAt: 1, stopReason: null } as any;
    const old = structuredClone(f.chat);
    expect(await appendWorldSimulationActorsHost_ACU([{ ...actor('new', '同名', ['other-lore']), previousActionResult: '无' }])).toBe(1);
    expect(f.saveChat).toHaveBeenCalledOnce();
    expect(f.saveChat.mock.calls[0]).toEqual([]);
    expect(f.chat[1].mes).toBe(old[1].mes);
    expect(f.chat[1].message).toBe(old[1].message);
    expect(f.chat[1].swipes).toEqual(old[1].swipes);
    expect(f.chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toEqual(old[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]);
    expect(f.chat[0]._qrf_world_simulation.task).toMatchObject({ status: 'abandoned', activeRun: null });
    expect(f.chat[0]._qrf_world_simulation.task.completedRun).toBeUndefined();
    const folded = foldWorldSimulationLedger_ACU(f.chat, 1)!;
    expect(folded.ledger.actors.map(item => item.id)).toEqual(['old', 'new']);
    expect(folded.ledger.actors[0]).not.toHaveProperty('previousActionResult');
    expect(folded.ledger.actors[1].previousActionResult).toBe('无');
    expect(folded.fields.records.actors?.new.fields.previousActionResult.value).toBe('无');
    expect(folded.ledger.revision).toBe(1);
    for (const key of Object.keys(old[0]._qrf_world_simulation.ledger)) {
      if (key !== 'actors' && key !== 'revision')
        expect((folded.ledger as any)[key]).toEqual(old[0]._qrf_world_simulation.ledger[key]);
    }
    expect(await appendWorldSimulationActorsHost_ACU([actor('new')])).toBe(0);
    expect(f.saveChat).toHaveBeenCalledOnce();
  });

  it('保存时以最新账本判重，不因批准后其他资料变化拒绝', async () => {
    const f = host();
    f.envelope.ledger.clock.day = 3;
    f.envelope.ledger.guidance.signals.push({ text: '新资料', voice: 'ambient', sourceId: 'clock' });
    expect(await appendWorldSimulationActorsHost_ACU([actor('new')])).toBe(1);
    expect(foldWorldSimulationLedger_ACU(f.chat, 1)?.ledger.clock.day).toBe(3);
    expect(foldWorldSimulationLedger_ACU(f.chat, 1)?.ledger.guidance.signals).toEqual([
      { text: '新资料', voice: 'ambient', sourceId: 'clock' },
    ]);
    expect(await appendWorldSimulationActorsHost_ACU([actor('new')])).toBe(0);
    expect(f.saveChat).toHaveBeenCalledOnce();
  });

  it('首楼无 envelope 时默认创建；空候选不保存', async () => {
    const f = host(undefined, false);
    expect(await appendWorldSimulationActorsHost_ACU([])).toBe(0);
    expect(f.saveChat).not.toHaveBeenCalled();
    expect(await appendWorldSimulationActorsHost_ACU([actor('new')])).toBe(1);
    expect(f.chat[0]._qrf_world_simulation.ledger.actors.map((item: WorldActor_ACU) => item.id)).toEqual(['new']);
    expect(foldWorldSimulationLedger_ACU(f.chat, 1)?.ledger.actors.map(item => item.id)).toEqual(['new']);
  });

  it('保存失败仅恢复私有字段，保留宿主新正文', async () => {
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      f.chat[1].mes += '\n宿主尾注';
      f.chat[1].swipes[1] = f.chat[1].mes;
      throw new Error('save failed');
    }).mockResolvedValueOnce(undefined);
    const f = host(saveChat);
    const before = structuredClone(f.chat);
    await expect(appendWorldSimulationActorsHost_ACU([actor('new')]))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_PERSIST_FAILED', details: { recovery: 'saved' } } });
    expect(f.chat[0]).toEqual(before[0]);
    expect(f.chat[1].mes).toContain('宿主尾注');
    expect(f.chat[1].swipes[1]).toContain('宿主尾注');
    expect(foldWorldSimulationLedger_ACU(f.chat, 1)).toBeNull();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('取消及聊天切换不向其他会话写入', async () => {
    const f = host();
    const controller = new AbortController();
    controller.abort();
    await expect(appendWorldSimulationActorsHost_ACU([actor('new')], { signal: controller.signal }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' } });
    expect(f.saveChat).not.toHaveBeenCalled();
    const other = structuredClone(f.chat);
    f.saveChat.mockImplementationOnce(async () => {
      _set_SillyTavern_API_ACU({ chat: other, chatId: 'other', characterId: 0, this_chid: 0,
        characters: [{ avatar: 'other.png' }], getCurrentChatId: () => 'other', saveChat: f.saveChat } as any);
    });
    await expect(appendWorldSimulationActorsHost_ACU([actor('new')]))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', details: { recovery: 'unavailable' } } });
    expect(other).not.toHaveProperty('1._qrf_world_simulation_state');
    expect(other[0]._qrf_world_simulation.ledger.actors).toHaveLength(1);
    expect(f.saveChat).toHaveBeenCalledOnce();
  });
});
