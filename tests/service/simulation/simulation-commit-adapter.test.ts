import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationOrchestrator_ACU, resetWorldSimulationOrchestratorStateForTests_ACU } from '../../../src/service/simulation/simulation-orchestrator';
import { WorldSimulationRunWriteState_ACU, readWorldSimulationRunWriteProof_ACU, restoreWorldSimulationRunWrites_ACU } from '../../../src/service/simulation/simulation-run-write-state';
import { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { FirstFloorWorldSimulationStore_ACU } from '../../../src/service/simulation/simulation-store';
import { commitWorldSimulationFieldWrites_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { appendWorldSimulationConversationSegment_ACU, readWorldSimulationConversation_ACU } from '../../../src/service/simulation/agent/agent-conversation-store';
import { readLatestWorldSimulationMaterials_ACU, readWorldSimulationLedgerAtAnchor_ACU } from '../../../src/service/simulation/agent/agent-module-store';
import { commitWorldSimulationProjection_ACU } from '../../../src/service/simulation/simulation-commit-adapter';
import { buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function fixture(saveChat = vi.fn().mockResolvedValue(undefined)) {
  const userBlock = '<与此同时>\n用户自有内容\n</与此同时>';
  const chat: any[] = [
    {},
    { message_id: 7, mes: `正文\n\n${userBlock}`, swipe_id: 0, swipes: [`正文\n\n${userBlock}`] },
  ];
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
  const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
  const identity = {
    runId: 'run-1', chatIdentity: 'chat-a', triggerKind: 'assistant_completed' as const,
    triggerConversationMessageId: null, anchorMessageId: anchor.messageId,
    anchorMessageKey: anchor.messageKey, anchorSwipeId: anchor.swipeId,
    anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
    taskId: 'task-1', stageId: 'stage-1', stageRevision: 1,
  };
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
  envelope.activeStageId = identity.stageId;
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: ['clock', 'guidance'], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '提交' } }] }];
  chat[0]._qrf_world_simulation = envelope;
  const acceptedCandidates: any[] = [
    { candidateId: 'candidate:clock', agentName: 'timekeeper', patch: { clock: { days: 1, storyTime: '1h', evidenceRefs: ['e1'] } }, summary: '时间推进', evidenceRefs: ['e1'], uncertainties: [], writableModules: ['clock'] },
    { candidateId: 'candidate:guidance', agentName: 'guidance-composer', patch: { guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' }], evidenceRefs: ['e1'] } }, summary: '安全投影', evidenceRefs: ['e1'], uncertainties: [], writableModules: ['guidance'] },
  ];
  const commitCandidate: any = {
    runId: identity.runId,
    taskId: identity.taskId,
    stageId: identity.stageId,
    stageRevision: identity.stageRevision,
    baseLedgerRevision: identity.baseLedgerRevision,
    summary: '世界推进完成',
    acceptedCandidates,
    evidenceRefs: ['e1'],
    reviewer: { status: 'accepted', summary: '因果一致', evidenceRefs: ['e1'], uncertainties: [] },
  };
  const commitInput = { identity, anchor, commitCandidate, completedAt: 10, timelineId: 'timeline-1' };
  return { chat, anchor, identity, acceptedCandidates, commitCandidate, commitInput, saveChat, userBlock };
}

describe('world simulation commit adapter', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(null as any);
  });

  it('联合提交 envelope、账本、材料与 active swipe，且主保存只调用一次', async () => {
    const { chat, commitInput, saveChat, userBlock } = fixture();

    const committedAnchor = await commitWorldSimulationProjection_ACU(commitInput);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[1].mes).toBe(chat[1].swipes[0]);
    expect(chat[1].mes).toContain(userBlock);
    expect(chat[1].mes).toContain('远处钟声响起');
    const persistedAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    expect(committedAnchor).toEqual(persistedAnchor);
    expect(persistedAnchor.contentDigest).not.toBe(commitInput.anchor.contentDigest);
    const ledger = readWorldSimulationLedgerAtAnchor_ACU(persistedAnchor, chat);
    expect(ledger).toMatchObject({ revision: 1, clock: { day: 2, storyTime: '1h' }, guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient' }] } });
    const materials = readLatestWorldSimulationMaterials_ACU(chat);
    expect(materials).toMatchObject({ adoptedIndex: 1, snapshot: { ledgerRevision: 1, evidenceRefs: ['e1'] } });
    expect(chat[0]._qrf_world_simulation.task).toMatchObject({ status: 'completed', activeRun: null });
    expect(chat[0]._qrf_world_simulation.timeline.at(-1)).toMatchObject({ kind: 'committed', id: 'timeline-1' });
  });

  it('正文 digest 改变时保留旧会话 entry，并把当前 segment 复制到新锚点', async () => {
    const { chat, anchor, identity, commitInput, saveChat } = fixture();
    await appendWorldSimulationConversationSegment_ACU({
      anchor,
      segmentId: 'user:run-1',
      runId: identity.runId,
      taskId: identity.taskId,
      stageId: identity.stageId,
      stageRevision: identity.stageRevision,
      appends: [{ kind: 'user', text: '手动推进', turnKey: 'turn-1' }],
    }, chat);
    saveChat.mockClear();
    const oldKey = buildWorldSimulationBucketKey_ACU(anchor);

    await commitWorldSimulationProjection_ACU(commitInput);

    const persistedAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const newKey = buildWorldSimulationBucketKey_ACU(persistedAnchor);
    const bucket = chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    expect(newKey).not.toBe(oldKey);
    expect(bucket.entries[oldKey]).toBeDefined();
    expect(bucket.entries[newKey]).toMatchObject({
      anchor: persistedAnchor,
      value: { segments: [{ segmentId: 'user:run-1' }] },
    });
    expect(readWorldSimulationConversation_ACU(chat)).toMatchObject({
      diagnostics: [], messages: [{ kind: 'user', text: '手动推进', turnKey: 'turn-1' }],
    });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('联合提交会把母版 version=1 会话升级为当前 bucket，并迁移到新 digest 锚点', async () => {
    const { chat, anchor, commitInput, saveChat } = fixture();
    chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = {
      version: 1,
      entries: [{
        swipe: {
          messageIndex: anchor.messageIndex,
          messageKey: anchor.messageKey,
          swipeIndex: Number(anchor.swipeId),
          baseTextHash: 'legacy-hash',
        },
        nextId: 2,
        messages: [{ id: 1, at: 10, kind: 'user', status: 'done', title: '你的补充', detail: '推进港口局势' }],
      }],
    };

    await commitWorldSimulationProjection_ACU(commitInput);

    const persistedAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const bucket = chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
    expect(bucket).toMatchObject({ schemaVersion: 1, entries: expect.any(Object) });
    expect(bucket.version).toBeUndefined();
    expect(bucket.entries[buildWorldSimulationBucketKey_ACU(anchor)]).toBeDefined();
    expect(bucket.entries[buildWorldSimulationBucketKey_ACU(persistedAnchor)]).toMatchObject({
      anchor: persistedAnchor,
      value: { segments: [{ messages: [{ kind: 'user', text: '推进港口局势' }] }] },
    });
    expect(readWorldSimulationConversation_ACU(chat).messages.map(item => item.text)).toEqual(['推进港口局势']);
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('legacy 会话迁移后的主保存失败会恢复原对象，不留下当前 bucket', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockResolvedValueOnce(undefined);
    const { chat, anchor, commitInput } = fixture(saveChat);
    const legacy = {
      version: 1,
      entries: [{
        swipe: { messageIndex: anchor.messageIndex, messageKey: anchor.messageKey, swipeIndex: Number(anchor.swipeId), baseTextHash: 'legacy-hash' },
        nextId: 2,
        messages: [{ id: 1, at: 10, kind: 'user', status: 'done', title: '你的补充', detail: '保持原数据' }],
      }],
    };
    chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = legacy;

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });

    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toBe(legacy);
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU]).toEqual(legacy);
  });

  it('当前 D0 entry 不存在时仍全量校验历史 conversation entries，并在保存前拒绝损坏 bucket', async () => {
    const { chat, anchor, commitInput, saveChat } = fixture();
    const historicalAnchor = { ...anchor, contentDigest: 'historical-digest' };
    chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = {
      schemaVersion: 1,
      entries: {
        'forged-history-key': {
          anchor: historicalAnchor,
          value: { schemaVersion: 1, segments: [], updatedAt: 1 },
          updatedAt: 1,
        },
      },
    };

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' },
    });
    expect(saveChat).not.toHaveBeenCalled();
    expect(chat[1][WORLD_SIMULATION_CONVERSATION_FIELD_ACU].entries['forged-history-key'].anchor).toEqual(historicalAnchor);
  });

  it('重复提交因原锚点已 stale 而在保存前失败', async () => {
    const { commitInput, saveChat } = fixture();
    await commitWorldSimulationProjection_ACU(commitInput);

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_ANCHOR_STALE' },
    });
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('stale anchor 与基础账本 revision 冲突均零保存', async () => {
    const stale = fixture();
    stale.chat[1].mes = '正文已变化';
    stale.chat[1].swipes[0] = '正文已变化';
    await expect(commitWorldSimulationProjection_ACU(stale.commitInput)).rejects.toBeTruthy();
    expect(stale.saveChat).not.toHaveBeenCalled();

    const conflict = fixture();
    conflict.chat[0]._qrf_world_simulation.ledger.revision = 1;
    await expect(commitWorldSimulationProjection_ACU(conflict.commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' },
    });
    expect(conflict.saveChat).not.toHaveBeenCalled();
  });

  it('主保存失败后恢复全部内存字段并执行一次补偿保存', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockResolvedValueOnce(undefined);
    const { chat, commitInput } = fixture(saveChat);
    const before = JSON.parse(JSON.stringify(chat));

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' },
    });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(chat).toEqual(before);
  });

  it('多楼旧 checkpoint 在终局保存失败后恢复，不留下重建基线', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockResolvedValueOnce(undefined);
    const f = fixture(saveChat);
    const previous: any = { message_id: 6, mes: '旧正文', swipe_id: 0, swipes: ['旧正文'] };
    f.chat.splice(1, 0, previous);
    const previousAnchor = resolveWorldSimulationAnchor_ACU(1, f.chat);
    previous._qrf_world_simulation_state = { schemaVersion: 1, entries: {
      [buildWorldSimulationBucketKey_ACU(previousAnchor)]: {
        anchor: previousAnchor, updatedAt: 1,
        value: { schemaVersion: 2, checkpoint: structuredClone(f.chat[0]._qrf_world_simulation.ledger), deltas: [] },
      },
    } };
    const currentAnchor = resolveWorldSimulationAnchor_ACU(2, f.chat);
    Object.assign(f.anchor, currentAnchor);
    Object.assign(f.identity, { anchorMessageId: currentAnchor.messageId, anchorMessageKey: currentAnchor.messageKey,
      anchorSwipeId: currentAnchor.swipeId, anchorContentDigest: currentAnchor.contentDigest });
    const before = structuredClone(f.chat);

    await expect(commitWorldSimulationProjection_ACU(f.commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' },
    });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(f.chat).toEqual(before);
  });

  it('补偿保存期间宿主改写字段时报告恢复不可确认，不覆盖宿主更新', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockImplementationOnce(async () => {
      chat[1].mes = '宿主更新的正文';
    });
    const { chat, commitInput } = fixture(saveChat);
    const before = structuredClone(chat);

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_PERSIST_FAILED', details: { recovery: 'unavailable' } },
    });
    expect(chat[1].mes).toBe('宿主更新的正文');
    expect(chat[0]).toEqual(before[0]);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('保存期换聊天时不补偿旧引用，也不写入新聊天', async () => {
    const saveChat = vi.fn().mockImplementationOnce(async () => {
      _set_SillyTavern_API_ACU({ chat: otherChat, chatId: 'chat-b', getCurrentChatId: () => 'chat-b', saveChat } as any);
    });
    const { chat, commitInput } = fixture(saveChat);
    const otherChat = structuredClone(chat);

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', details: { recovery: 'unavailable' } },
    });
    expect(otherChat[0]._qrf_world_simulation.task.status).toBe('running');
    expect(chat[0]._qrf_world_simulation.task.status).toBe('completed');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('宿主保存期间重排楼层时不按旧位置补偿', async () => {
    const saveChat = vi.fn().mockImplementationOnce(async () => { chat.splice(0, 0, {}); });
    const { chat, commitInput } = fixture(saveChat);

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', details: { recovery: 'unavailable' } },
    });
    expect(chat[1]._qrf_world_simulation.task.status).toBe('completed');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('提交失败补偿会同时恢复 conversation bucket，不留下新 digest entry', async () => {
    const saveChat = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce(undefined);
    const { chat, anchor, identity, commitInput } = fixture(saveChat);
    await appendWorldSimulationConversationSegment_ACU({
      anchor,
      segmentId: 'user:run-1',
      runId: identity.runId,
      taskId: identity.taskId,
      stageId: identity.stageId,
      stageRevision: identity.stageRevision,
      appends: [{ kind: 'user', text: '手动推进', turnKey: 'turn-1' }],
    }, chat);
    const before = JSON.parse(JSON.stringify(chat));

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' },
    });

    expect(saveChat).toHaveBeenCalledTimes(3);
    expect(chat).toEqual(before);
    expect(readWorldSimulationConversation_ACU(chat).messages).toMatchObject([{ text: '手动推进' }]);
  });

  it('补偿保存失败时保留主失败与补偿失败诊断', async () => {
    const saveChat = vi.fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(new Error('rollback failed'));
    const { chat, commitInput } = fixture(saveChat);
    const before = JSON.parse(JSON.stringify(chat));

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: {
        code: 'WORLD_SIMULATION_PERSIST_FAILED',
        details: { primaryMessage: 'primary failed', rollbackMessage: 'rollback failed' },
      },
    });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(chat).toEqual(before);
  });

  it('commit 清扫过期种子并写入 timeline swept', async () => {
    const { chat, commitInput, saveChat } = fixture();
    chat[0]._qrf_world_simulation.ledger.seeds = [{
      id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [],
      location: { region: '青阳城' }, expiresAtDay: 1, missedOutcome: '矿洞塌了', exposePolicy: 'on_collision',
      evidenceRefs: [], retiredReason: null, revision: 0,
    }];

    await commitWorldSimulationProjection_ACU(commitInput);

    expect(saveChat).toHaveBeenCalledTimes(1);
    const ledger = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, chat), chat);
    expect(ledger.seeds).toEqual([]);
    expect(ledger.chronicle.map((item: { summary: string }) => item.summary)).toContain('[错过] 矿洞塌了');
    expect(chat[0]._qrf_world_simulation.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'swept', message: 'seed-1' }),
      expect.objectContaining({ kind: 'swept', message: expect.stringContaining('seed-1') }),
      expect.objectContaining({ kind: 'committed', id: 'timeline-1' }),
    ]));
  });

  it('secluded 时剔除 rumor 信号且不阻断 commit，传闻保持 ripe', async () => {
    const { chat, commitInput, saveChat } = fixture();
    chat[0]._qrf_world_simulation.ledger.player = {
      location: { region: '青阳城' }, locationUpdatedAtDay: 1, regionVisits: [], contact: 'secluded', evidenceRefs: [],
    };
    chat[0]._qrf_world_simulation.ledger.rumors = [{
      id: 'rumor-1', fact: '铁匠死在北岭', originDay: 1, earliestRevealDay: 1, channels: ['青阳城'],
      relatedActorIds: [], status: 'ripe', revealedAtDay: null, revision: 0,
    }];
    commitInput.commitCandidate.acceptedCandidates[1].patch.guidance.signals = [
      { text: '客栈传闻', voice: 'rumor', sourceId: 'rumor-1' },
      { text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' },
    ];

    await commitWorldSimulationProjection_ACU(commitInput);

    expect(saveChat).toHaveBeenCalledTimes(1);
    const ledger = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, chat), chat);
    expect(ledger.rumors[0]).toMatchObject({ status: 'ripe', revealedAtDay: null });
    expect(ledger.guidance.signals).toEqual([{ text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' }]);
    expect(ledger.player.regionVisits).toEqual([]);
    expect(chat[1].mes).not.toContain('客栈传闻');
    expect(chat[1].mes).toContain('远处钟声响起');
  });

  it('open 且渠道命中时 rumor 信号保留并流转为 revealed', async () => {
    const { chat, commitInput } = fixture();
    chat[0]._qrf_world_simulation.ledger.player = {
      location: { region: '青阳城' }, locationUpdatedAtDay: 1, regionVisits: [], contact: 'open', evidenceRefs: [],
    };
    chat[0]._qrf_world_simulation.ledger.rumors = [{
      id: 'rumor-1', fact: '铁匠死在北岭', originDay: 1, earliestRevealDay: 1, channels: ['青阳城'],
      relatedActorIds: [], status: 'ripe', revealedAtDay: null, revision: 0,
    }];
    commitInput.commitCandidate.acceptedCandidates[1].patch.guidance.signals = [
      { text: '客栈传闻', voice: 'rumor', sourceId: 'rumor-1' },
      { text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' },
    ];

    await commitWorldSimulationProjection_ACU(commitInput);

    const ledger = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, chat), chat);
    expect(ledger.rumors[0]).toMatchObject({ status: 'revealed', revealedAtDay: 2 });
    expect(ledger.guidance.signals).toEqual([
      { text: '客栈传闻', voice: 'rumor', sourceId: 'rumor-1' },
      { text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' },
    ]);
    expect(ledger.player.regionVisits).toEqual([{ region: '青阳城', day: 2 }]);
  });

  it('strict 模式下 on_collision 未兑现则拒绝 commit 并回滚', async () => {
    const { chat, commitInput, saveChat } = fixture();
    chat[0]._qrf_world_simulation.ledger.player = {
      location: { region: '青阳城' }, locationUpdatedAtDay: 1, regionVisits: [], contact: 'open', evidenceRefs: [],
    };
    chat[0]._qrf_world_simulation.ledger.seeds = [{
      id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [],
      location: { region: '青阳城' }, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision',
      evidenceRefs: [], retiredReason: null, revision: 0,
    }];
    commitInput.commitCandidate.collisionReport = {
      playerRegion: '青阳城', playerContact: 'open', secludedNote: null, collidedSeeds: ['seed-1'], ripeRumors: [],
    };
    const before = JSON.parse(JSON.stringify(chat));

    await expect(commitWorldSimulationProjection_ACU(commitInput)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' },
    });
    expect(saveChat).not.toHaveBeenCalled();
    expect(chat).toEqual(before);
  });

  it('relaxed 模式下碰撞未兑现仅写入 timeline 警告', async () => {
    const { chat, commitInput, saveChat } = fixture();
    chat[0]._qrf_world_simulation.settings.dynamics.collisionEnforcement = 'relaxed';
    chat[0]._qrf_world_simulation.ledger.player = {
      location: { region: '青阳城' }, locationUpdatedAtDay: 1, regionVisits: [], contact: 'open', evidenceRefs: [],
    };
    chat[0]._qrf_world_simulation.ledger.seeds = [{
      id: 'seed-1', title: '暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [],
      location: { region: '青阳城' }, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision',
      evidenceRefs: [], retiredReason: null, revision: 0,
    }];
    commitInput.commitCandidate.collisionReport = {
      playerRegion: '青阳城', playerContact: 'open', secludedNote: null, collidedSeeds: ['seed-1'], ripeRumors: [],
    };

    await commitWorldSimulationProjection_ACU(commitInput);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[0]._qrf_world_simulation.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'failed', message: '碰撞种子 seed-1 缺少 encounter 信号' }),
      expect.objectContaining({ kind: 'committed', id: 'timeline-1' }),
    ]));
  });

  it('归档候选写入独立楼层桶，推进指令写入 progressed timeline', async () => {
    const { chat, commitInput, acceptedCandidates } = fixture();
    chat[0]._qrf_world_simulation.ledger.seeds = [{
      id: 'seed-edge', title: '远方暗流', status: 'active', level: 1, catalyst: '', visibility: 'hidden', actorIds: [],
      location: { region: '临川' }, expiresAtDay: 40, missedOutcome: null, exposePolicy: 'on_collision',
      evidenceRefs: [], retiredReason: null, revision: 0,
    }];
    acceptedCandidates.push({
      candidateId: 'candidate:archive',
      agentName: 'chronicler',
      patch: {
        chronicleArchive: {
          archiveEntries: [{
            archiveRef: 'arc-mine', day: 3, summary: '北岭塌方已归档',
            fingerprints: ['fp'], relatedIds: ['seed-edge'], sourceChronicleIds: [],
          }],
          overviewRows: [{ fingerprint: 'fp', day: 3, oneLine: '第3日 · 北岭塌方', archiveRef: 'arc-mine' }],
        },
      },
      summary: '归档完结事件',
      evidenceRefs: ['e1'],
      uncertainties: [],
      writableModules: ['chronicle'],
    });

    await commitWorldSimulationProjection_ACU(commitInput);

    expect(chat[0]._qrf_world_simulation.ledger.chronicleOverview).toEqual([
      expect.objectContaining({ archiveRef: 'arc-mine', oneLine: '第3日 · 北岭塌方' }),
    ]);
    expect(JSON.stringify(chat[1][WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU])).toContain('北岭塌方已归档');
    const progressed = chat[0]._qrf_world_simulation.timeline.filter((item: { kind: string }) => item.kind === 'progressed');
    expect(progressed).toHaveLength(1);
    expect(JSON.parse(progressed[0].message)).toMatchObject({ seedId: 'seed-edge', advance: 'catalyze' });
    expect(chat[0]._qrf_world_simulation.timeline.at(-1)).toMatchObject({ kind: 'committed', id: 'timeline-1' });
  });

});

describe('world simulation run-scoped field writes', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('已保存的完整条目与 partial 在无候选终局保留，既不重复写入也不清除草稿', async () => {
    const { chat, anchor, identity, commitCandidate, commitInput, saveChat } = fixture();
    const { WorldSimulationRunWriteState_ACU } = await import('../../../src/service/simulation/simulation-run-write-state');
    const { commitWorldSimulationFieldWrites_ACU } = await import('../../../src/service/simulation/simulation-commit-adapter');
    const { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU } = await import('../../../src/service/simulation/simulation-ledger-fold');
    const read = () => { const folded = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex); return {
      ledger: folded?.ledger ?? chat[0]._qrf_world_simulation.ledger,
      fields: folded?.fields, archive: foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot,
    }; };
    const runWrites = new WorldSimulationRunWriteState_ACU(read, identity.baseLedgerRevision);
    const fieldInput = { identity, anchor, role: 'undercurrent-analyst', evidenceRegistry: { runId: identity.runId, entries: [] },
      assertRunLedger: view => runWrites.assertCurrent(view), prepareRunProof: (view, refs, accepted) => runWrites.prepareConfirmation(identity, view, refs, accepted),
      confirmRunLedger: (view, refs, accepted) => runWrites.confirm(view, refs, accepted) } as const;
    expect((await commitWorldSimulationFieldWrites_ACU({ ...fieldInput,
      sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0)" })).status).toBe('committed');
    expect((await commitWorldSimulationFieldWrites_ACU({ ...fieldInput,
      sql: "UPDATE dimensions SET kind='pressure', value=10, trend='rising', rationale='海风', evidence_refs='[]' WHERE id='dim-a' AND expected_revision=0" })).status).toBe('committed');
    expect((await commitWorldSimulationFieldWrites_ACU({ ...fieldInput,
      sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-b', '暗潮', 0)" })).status).toBe('committed');
    const before = structuredClone(read().ledger.dimensions[0]);
    await commitWorldSimulationProjection_ACU({ ...commitInput, runWrites,
      commitCandidate: { ...commitCandidate, acceptedCandidates: [], evidenceRefs: [] } });
    const folded = foldWorldSimulationLedger_ACU(chat)!;
    expect(folded.ledger.dimensions).toEqual([before]);
    expect(folded.fields.records.dimensions?.['dim-b']).toMatchObject({ status: 'partial', fields: { name: { value: '暗潮' } } });
    expect(chat[0]._qrf_world_simulation.task.status).toBe('completed');
    expect(saveChat).toHaveBeenCalledTimes(4);
  });

  it('自身已确认写入后出现外部逐栏写入，终局冲突且不覆盖外部条目', async () => {
    const { chat, anchor, identity, commitCandidate, commitInput, saveChat } = fixture();
    const { WorldSimulationRunWriteState_ACU } = await import('../../../src/service/simulation/simulation-run-write-state');
    const { commitWorldSimulationFieldWrites_ACU } = await import('../../../src/service/simulation/simulation-commit-adapter');
    const { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU } = await import('../../../src/service/simulation/simulation-ledger-fold');
    const read = () => { const folded = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex); return {
      ledger: folded?.ledger ?? chat[0]._qrf_world_simulation.ledger, fields: folded?.fields,
      archive: foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot,
    }; };
    const runWrites = new WorldSimulationRunWriteState_ACU(read, identity.baseLedgerRevision);
    const fieldInput = { identity, anchor, role: 'undercurrent-analyst', evidenceRegistry: { runId: identity.runId, entries: [] } } as const;
    expect((await commitWorldSimulationFieldWrites_ACU({ ...fieldInput,
      sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0)",
      assertRunLedger: view => runWrites.assertCurrent(view),
      prepareRunProof: (view, refs, accepted) => runWrites.prepareConfirmation(identity, view, refs, accepted),
      confirmRunLedger: (view, refs, accepted) => runWrites.confirm(view, refs, accepted) })).status).toBe('committed');
    expect((await commitWorldSimulationFieldWrites_ACU({ ...fieldInput,
      sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('external', '外部变更', 0)" })).status).toBe('committed');
    saveChat.mockClear();
    await expect(commitWorldSimulationProjection_ACU({ ...commitInput, runWrites,
      commitCandidate: { ...commitCandidate, acceptedCandidates: [], evidenceRefs: [] } })).rejects.toBeTruthy();
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.external.fields.name.value).toBe('外部变更');
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('world simulation terminal candidate overlap', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(null as any); });

  it('a candidate for an already saved row is rejected without replaying or overwriting it', async () => {
    const { chat, anchor, identity, commitCandidate, commitInput, saveChat } = fixture();
    const { WorldSimulationRunWriteState_ACU } = await import('../../../src/service/simulation/simulation-run-write-state');
    const { commitWorldSimulationFieldWrites_ACU } = await import('../../../src/service/simulation/simulation-commit-adapter');
    const { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU } = await import('../../../src/service/simulation/simulation-ledger-fold');
    const read = () => { const folded = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex); return {
      ledger: folded?.ledger ?? chat[0]._qrf_world_simulation.ledger, fields: folded?.fields,
      archive: foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot,
    }; };
    const runWrites = new WorldSimulationRunWriteState_ACU(read, 0);
    const receipt = await commitWorldSimulationFieldWrites_ACU({ identity, anchor, role: 'undercurrent-analyst',
      sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0)",
      evidenceRegistry: { runId: identity.runId, entries: [] },
      assertRunLedger: view => runWrites.assertCurrent(view), prepareRunProof: (view, refs, accepted) => runWrites.prepareConfirmation(identity, view, refs, accepted),
      confirmRunLedger: (view, refs, accepted) => runWrites.confirm(view, refs, accepted) });
    expect(receipt.status).toBe('committed');
    saveChat.mockClear();
    const duplicate = { candidateId: 'candidate:dim-a', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [{ id: 'dim-a', name: '覆盖' }] } }, summary: '重复', evidenceRefs: [], uncertainties: [], writableModules: ['dimensions'] };
    await expect(commitWorldSimulationProjection_ACU({ ...commitInput, runWrites,
      commitCandidate: { ...commitCandidate, acceptedCandidates: [duplicate] } })).rejects.toThrow('WORLD_SIMULATION_RUN_WRITE_OVERLAP:dimensions:dim-a');
    expect(foldWorldSimulationLedger_ACU(chat)?.fields.records.dimensions?.['dim-a'].fields.name.value).toBe('风暴');
    expect(saveChat).not.toHaveBeenCalled();
  });
});

describe('world simulation durable run write proof', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(null as any);
    resetWorldSimulationOrchestratorStateForTests_ACU();
  });

  function resumeFixture(saveChat = vi.fn().mockResolvedValue(undefined)) {
    const f = fixture(saveChat);
    const { chat, anchor, identity } = f;
    const read = () => {
      const folded = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex);
      return { ledger: folded?.ledger ?? new FirstFloorWorldSimulationStore_ACU().read()!.ledger,
        fields: folded?.fields, archive: foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot };
    };
    const proof = new WorldSimulationRunWriteState_ACU(read, 0);
    const write = (sql: string) => commitWorldSimulationFieldWrites_ACU({ identity, anchor, sql, role: 'undercurrent-analyst',
      evidenceRegistry: { runId: identity.runId, entries: [] },
      assertRunLedger: view => { proof.assertCurrent(view); proof.assertPersistedProof(identity, readWorldSimulationRunWriteProof_ACU(anchor, chat)); },
      prepareRunProof: (view, refs, accepted) => proof.prepareConfirmation(identity, view, refs, accepted),
      confirmRunLedger: (view, refs, accepted) => proof.confirm(view, refs, accepted) });
    return { ...f, read, proof, write };
  }

  it('一次保存同时携带 partial 和证明；重载后继续完成条目并保留原始 run base revision', async () => {
    const { chat, anchor, identity, read, write, saveChat, commitInput, commitCandidate } = resumeFixture();
    expect((await write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-reload', '山雨', 0)")).status).toBe('committed');
    const saved = structuredClone(chat);
    expect(readWorldSimulationRunWriteProof_ACU(anchor, chat)).toMatchObject({ runId: identity.runId,
      baseLedgerRevision: 0, ledgerRevision: 0, confirmedWrites: 1, written: { dimensions: ['dim-reload'] } });
    expect(saved[anchor.messageIndex]._qrf_world_simulation_run_writes).toBeDefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
    const resumed = restoreWorldSimulationRunWrites_ACU(read, identity, anchor, chat);
    resumed.assertCurrent();
    const second = await commitWorldSimulationFieldWrites_ACU({ identity, anchor, role: 'undercurrent-analyst',
      sql: "UPDATE dimensions SET kind='pressure', value=10, trend='rising', rationale='山雨', evidence_refs='[]' WHERE id='dim-reload' AND expected_revision=0",
      evidenceRegistry: { runId: identity.runId, entries: [] },
      assertRunLedger: view => { resumed.assertCurrent(view); resumed.assertPersistedProof(identity, readWorldSimulationRunWriteProof_ACU(anchor, chat)); },
      prepareRunProof: (view, refs, accepted) => resumed.prepareConfirmation(identity, view, refs, accepted),
      confirmRunLedger: (view, refs, accepted) => resumed.confirm(view, refs, accepted) });
    expect(second).toMatchObject({ status: 'committed', ledgerRevision: 1 });
    expect(readWorldSimulationRunWriteProof_ACU(anchor, chat)).toMatchObject({ confirmedWrites: 2, ledgerRevision: 1 });
    const reloaded = restoreWorldSimulationRunWrites_ACU(read, identity, anchor, chat);
    await commitWorldSimulationProjection_ACU({ ...commitInput, runWrites: reloaded,
      commitCandidate: { ...commitCandidate, acceptedCandidates: [], evidenceRefs: [] } });
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toEqual([expect.objectContaining({ id: 'dim-reload' })]);
    expect(chat[0]._qrf_world_simulation.task).toMatchObject({ status: 'completed', activeRun: null });
    expect(saveChat).toHaveBeenCalledTimes(3);
  });

  it('revision 未前进的 partial 丢失证明时 fail-closed，不把已写栏目当作运行起点', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-reload', '山雨', 0)")).status).toBe('committed');
    expect(f.read().ledger.revision).toBe(f.identity.baseLedgerRevision);
    expect(f.read().fields?.records.dimensions?.['dim-reload'].status).toBe('partial');
    delete f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes;
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, f.identity, f.anchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
    expect(f.saveChat).toHaveBeenCalledTimes(1);
  });

  it('无证明且无 partial 的旧运行仍可按原始 revision 恢复', () => {
    const f = resumeFixture();
    const restored = restoreWorldSimulationRunWrites_ACU(f.read, f.identity, f.anchor, f.chat);
    expect(restored.currentLedgerRevision).toBe(0);
    expect(restored.hasConfirmedWrites).toBe(false);
  });

  it('别的运行留下的有来源 partial 可作为新运行基线；无来源的旧 partial 拒绝猜测归属', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-old', '山雨', 0)")).status).toBe('committed');
    const newRun = { ...f.identity, runId: 'run-next', taskId: 'task-next' };
    const restored = restoreWorldSimulationRunWrites_ACU(f.read, newRun, f.anchor, f.chat);
    expect(restored.hasConfirmedWrites).toBe(false);
    delete f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes;
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, newRun, f.anchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
  });

  it('终局正文换锚点后 partial 仍有来源证明；下一运行可从该已确认草稿起步', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-left', '旧雨', 0)")).status).toBe('committed');
    const input = { ...f.commitInput, runWrites: f.proof, commitCandidate: { ...f.commitCandidate, acceptedCandidates: [], evidenceRefs: [] } };
    await commitWorldSimulationProjection_ACU(input);
    const nextAnchor = resolveWorldSimulationAnchor_ACU(f.anchor.messageIndex, f.chat);
    const nextRead = () => {
      const folded = foldWorldSimulationLedger_ACU(f.chat, nextAnchor.messageIndex);
      return { ledger: folded!.ledger, fields: folded!.fields,
        archive: foldWorldSimulationArchive_ACU(f.chat, nextAnchor.messageIndex).snapshot };
    };
    expect(nextRead().fields.records.dimensions?.['dim-left'].status).toBe('partial');
    expect(readWorldSimulationRunWriteProof_ACU(nextAnchor, f.chat)).toMatchObject({ runId: f.identity.runId });
    const nextRun = { ...f.identity, runId: 'next-run', taskId: 'next-task',
      anchorContentDigest: nextAnchor.contentDigest, baseLedgerRevision: nextRead().ledger.revision };
    expect(restoreWorldSimulationRunWrites_ACU(nextRead, nextRun, nextAnchor, f.chat).hasConfirmedWrites).toBe(false);
    delete f.chat[nextAnchor.messageIndex]._qrf_world_simulation_run_writes.entries[buildWorldSimulationBucketKey_ACU(nextAnchor)];
    expect(() => restoreWorldSimulationRunWrites_ACU(nextRead, nextRun, nextAnchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
  });

  it('终局保存监听器原地改写证明时不覆盖变化或宣称补偿成功', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-left', '山雨', 0)")).status).toBe('committed');
    const before = structuredClone(f.chat);
    f.saveChat.mockImplementationOnce(async () => {
      const nextAnchor = resolveWorldSimulationAnchor_ACU(f.anchor.messageIndex, f.chat);
      f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes.entries[
        buildWorldSimulationBucketKey_ACU(nextAnchor)].value.fingerprint = 'host mutation';
    }).mockResolvedValue(undefined);
    await expect(commitWorldSimulationProjection_ACU({ ...f.commitInput, runWrites: f.proof,
      commitCandidate: { ...f.commitCandidate, acceptedCandidates: [], evidenceRefs: [] } })).rejects.toMatchObject({
        error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT', details: { recovery: 'unavailable' } },
      });
    expect(f.chat).not.toEqual(before);
    const nextAnchor = resolveWorldSimulationAnchor_ACU(f.anchor.messageIndex, f.chat);
    expect(f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes.entries[
      buildWorldSimulationBucketKey_ACU(nextAnchor)].value.fingerprint).toBe('host mutation');
    expect(() => readWorldSimulationRunWriteProof_ACU(nextAnchor, f.chat)).toThrow('运行写入证明损坏');
    expect(foldWorldSimulationLedger_ACU(f.chat)?.fields.records.dimensions?.['dim-left'].status).toBe('partial');
    expect(f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes.entries[
      buildWorldSimulationBucketKey_ACU(f.anchor)].value.confirmedWrites).toBe(1);
    expect(f.saveChat).toHaveBeenCalledTimes(2);
  });

  it('同 revision 外部归档改写不能借先前运行证明恢复', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-left', '山雨', 0)")).status).toBe('committed');
    const archiveField = f.chat[f.anchor.messageIndex]._qrf_world_simulation_chronicle_archive;
    archiveField.entries[buildWorldSimulationBucketKey_ACU(f.anchor)].value.checkpoint.records['arc-other'] = {
      archiveRef: 'arc-other', day: 1, summary: '外部', fingerprints: [], relatedIds: [], sourceChronicleIds: [],
    };
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, f.identity, f.anchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
  });

  it('逐栏保存失败或保存后证明被改写时既不签发回执也不前移内存证明', async () => {
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockResolvedValue(undefined);
    const f = resumeFixture(saveChat);
    const sql = "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-reload', '山雨', 0)";
    expect(await f.write(sql)).toMatchObject({ status: 'persist_failed', accepted: [], recovery: 'saved' });
    expect(f.proof.confirmedWrites).toBe(0);
    expect(readWorldSimulationRunWriteProof_ACU(f.anchor, f.chat)).toBeNull();
    saveChat.mockImplementationOnce(async () => {
      f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes.entries[
        buildWorldSimulationBucketKey_ACU(f.anchor)].value.fingerprint = 'tampered';
    }).mockResolvedValue(undefined);
    expect(await f.write(sql)).toMatchObject({ status: 'readback_failed', accepted: [] });
    expect(f.proof.confirmedWrites).toBe(0);
  });

  it('重载时拒绝外部 revision、同 revision 的分栏或归档篡改，以及损坏的证明', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-reload', '山雨', 0)")).status).toBe('committed');
    const snapshot = structuredClone(f.chat);
    f.chat[f.anchor.messageIndex]._qrf_world_simulation_state.entries[buildWorldSimulationBucketKey_ACU(f.anchor)].value.deltas.at(-1).fieldUpserts.dimensions['dim-reload'].name.value = '外部改写';
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, f.identity, f.anchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
    f.chat.splice(0, f.chat.length, ...structuredClone(snapshot));
    f.chat[f.anchor.messageIndex]._qrf_world_simulation_state.entries[buildWorldSimulationBucketKey_ACU(f.anchor)].value.deltas.at(-1).revision = 2;
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, f.identity, f.anchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
    f.chat.splice(0, f.chat.length, ...structuredClone(snapshot));
    f.chat[f.anchor.messageIndex]._qrf_world_simulation_run_writes.entries[buildWorldSimulationBucketKey_ACU(f.anchor)].value.confirmedWrites = -1;
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, f.identity, f.anchor, f.chat)).toThrow('运行写入证明损坏');
    f.chat.splice(0, f.chat.length, ...structuredClone(snapshot));
    expect(() => restoreWorldSimulationRunWrites_ACU(f.read, { ...f.identity, runId: 'other', baseLedgerRevision: 1 }, f.anchor, f.chat)).toThrow('WORLD_SIMULATION_LEDGER_STALE');
  });

  it('生产级编排器在自身逐栏写入后暂停重载，核验证明并以空候选终局', async () => {
    const f = resumeFixture();
    expect((await f.write("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-reload', '山雨', 0)")).status).toBe('committed');
    f.chat[0]._qrf_world_simulation.task.status = 'paused';
    const store = new FirstFloorWorldSimulationStore_ACU();
    let allocated = 0;
    const orchestrator = new WorldSimulationOrchestrator_ACU({
      store, now: () => 123, allocateId: kind => `${kind}-${++allocated}`,
      assertAnchorCurrent: () => undefined,
      readResumeLedgerRevision: (identity, anchor) => restoreWorldSimulationRunWrites_ACU(f.read, identity, anchor, f.chat).currentLedgerRevision,
      prepare: async ({ identity, anchor }) => ({
        revision: store.read()!.stages[0].revisions[0],
        runWrites: restoreWorldSimulationRunWrites_ACU(f.read, identity, anchor, f.chat),
        execute: async () => ({ outcome: 'no_change' as const, summary: '已保存', outcomes: [] }),
      }),
      commitProjection: commitWorldSimulationProjection_ACU,
    });
    const result = await orchestrator.resume({ anchor: f.anchor });
    expect(result).toMatchObject({ status: 'completed', identity: { baseLedgerRevision: 0, runId: f.identity.runId },
      result: { outcome: 'commit', commitCandidate: { acceptedCandidates: [] } } });
    expect(f.chat[0]._qrf_world_simulation.task.status).toBe('completed');
  });
});
