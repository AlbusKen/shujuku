import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
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
    { candidateId: 'candidate:guidance', agentName: 'causality-reviewer', patch: { guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient' }], evidenceRefs: ['e1'] } }, summary: '安全投影', evidenceRefs: ['e1'], uncertainties: [], writableModules: ['guidance'] },
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

    await commitWorldSimulationProjection_ACU(commitInput);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[1].mes).toBe(chat[1].swipes[0]);
    expect(chat[1].mes).toContain(userBlock);
    expect(chat[1].mes).toContain('远处钟声响起');
    const persistedAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
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
      { text: '远处钟声响起', voice: 'ambient' },
    ];

    await commitWorldSimulationProjection_ACU(commitInput);

    expect(saveChat).toHaveBeenCalledTimes(1);
    const ledger = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, chat), chat);
    expect(ledger.rumors[0]).toMatchObject({ status: 'ripe', revealedAtDay: null });
    expect(ledger.guidance.signals).toEqual([{ text: '远处钟声响起', voice: 'ambient' }]);
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
      { text: '远处钟声响起', voice: 'ambient' },
    ];

    await commitWorldSimulationProjection_ACU(commitInput);

    const ledger = readWorldSimulationLedgerAtAnchor_ACU(resolveWorldSimulationAnchor_ACU(1, chat), chat);
    expect(ledger.rumors[0]).toMatchObject({ status: 'revealed', revealedAtDay: 2 });
    expect(ledger.guidance.signals).toEqual([
      { text: '客栈传闻', voice: 'rumor', sourceId: 'rumor-1' },
      { text: '远处钟声响起', voice: 'ambient' },
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
