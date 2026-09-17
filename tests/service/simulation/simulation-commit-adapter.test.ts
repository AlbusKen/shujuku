import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_CONVERSATION_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
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
  envelope.settings.planPreview = false;
  envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
  envelope.activeStageId = identity.stageId;
  envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true, plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: ['clock', 'guidance'], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '提交' } }] }];
  chat[0]._qrf_world_simulation = envelope;
  const acceptedCandidates: any[] = [
    { candidateId: 'candidate:clock', agentName: 'macro-dynamics-analyst', patch: { clock: { elapsed: '1h', evidenceRefs: ['e1'] } }, summary: '时间推进', evidenceRefs: ['e1'], uncertainties: [], writableModules: ['clock', 'dimensions', 'chronicle'] },
    { candidateId: 'candidate:guidance', agentName: 'guidance-reviewer', patch: { guidance: { signals: ['远处钟声响起'], evidenceRefs: ['e1'] } }, summary: '安全投影', evidenceRefs: ['e1'], uncertainties: [], writableModules: ['guidance'] },
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
    expect(ledger).toMatchObject({ revision: 1, clock: { elapsed: '1h' }, guidance: { signals: ['远处钟声响起'] } });
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
});
