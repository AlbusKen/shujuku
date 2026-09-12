import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationAgentSession_ACU } from '../../../src/service/simulation/world-simulation-agent-session';
import { readWorldSimulationConversationTimeline_ACU } from '../../../src/service/simulation/world-simulation-agent-conversation';

const saveChat = vi.fn(async () => undefined);
function chat() { return [{ is_user: true, mes: '用户正文' }, { is_user: false, message_id: 'ai-1', mes: 'AI 正文', swipe_id: 0, swipes: ['AI 正文'] }]; }
function entityOutput() { return JSON.stringify({ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: { id: 'entity-1', kind: 'character', name: '密探', importance: 'active', situation: '正在移动', agenda: '侦察', lastMovedIndex: 1, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 } }], events: [], threads: [] }); }
function createSession(value = chat(), runOwnedAi = vi.fn(async (request: any) => request.source === 'world-sim-master' ? '{"delegations":[{"agent":"entity-movement","instruction":"推进密探行动"}]}' : entityOutput()), canRun = () => true, settingsPatch: Record<string, unknown> = {}) {
  _set_SillyTavern_API_ACU({ chat: value, saveChat } as any);
  const commitProjection = vi.fn(async () => ({}));
  const session = new WorldSimulationAgentSession_ACU({
    getChat: () => value, getChatIdentity: () => 'chat-a', readSettings: () => ({ ...buildDefaultWorldSimulationSettings_ACU(), enabled: true, ...settingsPatch }),
    store: { read: () => null, commitProjection } as any, countTokens: async () => 1, runOwnedAi,
    createRecordId: () => 'manual-1', canRun,
  });
  return { session, value, runOwnedAi, commitProjection };
}

beforeEach(() => { saveChat.mockReset(); saveChat.mockResolvedValue(undefined); });

describe('world simulation Agent session', () => {
  it('treats a user message as an untrusted request, delegates to an allowed specialist, and commits only through commitProjection', async () => {
    const { session, runOwnedAi, commitProjection } = createSession();
    await expect(session.submit('让密探去码头观察')).resolves.toBe('started');
    expect(runOwnedAi.mock.calls.map(call => call[0].source)).toEqual(['world-sim-master', 'world-sim-agent:entity-movement']);
    expect(runOwnedAi.mock.calls[0][0].messages.at(-1).content).toContain('<UNTRUSTED_USER_REQUEST>');
    const specialistRequest = runOwnedAi.mock.calls[1][0];
    expect(specialistRequest.messages.at(-1).content).toContain('<UNTRUSTED_DELEGATION>');
    expect(specialistRequest.prompt).toContain('<UNTRUSTED_DELEGATION>');
    expect(specialistRequest.prompt).not.toContain('<DELEGATION>');
    expect(commitProjection).toHaveBeenCalledTimes(1);
    expect(commitProjection.mock.calls[0][0]).toMatchObject({ anchorMessageIndex: 1, recordId: 'manual-1', expectedReplayDigest: null, parentReplayDigest: null, sourceAnchorMessageIndex: 1, coverageEndMessageIndex: 1, delta: { revisions: { entities: 1 } } });
    expect(session.isRunning()).toBe(false);
  });

  it('applies the saved visibility policy to the manual transaction before commitProjection', async () => {
    const { session, commitProjection } = createSession(undefined, undefined, undefined, { visibilityPolicy: 'always_revealed' });
    await expect(session.submit('让密探公开现身')).resolves.toBe('started');
    expect(commitProjection).toHaveBeenCalledTimes(1);
    const input = commitProjection.mock.calls[0][0];
    expect(input.state.entities).toMatchObject([{ id: 'entity-1', visibility: { mode: 'revealed', revealedIndex: 1 } }]);
    expect(input.delta.entities).toMatchObject([{ id: 'entity-1', visibility: { mode: 'revealed', revealedIndex: 1 } }]);
  });

  it('reports no_change for a queued request that makes no ledger change', async () => {
    let allowed = false;
    const { session, commitProjection } = createSession(undefined, vi.fn(async () => '{"delegations":[]}'), () => allowed);
    await expect(session.submit('先排队')).resolves.toBe('queued');
    allowed = true;
    await expect(session.runPendingForAnchor(1)).resolves.toBe('no_change');
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('takes an honest non-cancellable committing state once the strict projection writer is entered', async () => {
    let releaseCommit: (() => void) | undefined;
    let commitEntered: (() => void) | undefined;
    let specialistSignal: AbortSignal | null | undefined;
    const commit = new Promise<void>(resolve => { releaseCommit = resolve; });
    const { session, runOwnedAi, commitProjection } = createSession();
    commitProjection.mockImplementationOnce(async () => {
      commitEntered?.();
      await commit;
      return {};
    });
    runOwnedAi.mockImplementation(async (request: any) => {
      if (request.source === 'world-sim-master') return '{"delegations":[{"agent":"entity-movement","instruction":"推进"}]}';
      specialistSignal = request.signal;
      return entityOutput();
    });
    const entered = new Promise<void>(resolve => { commitEntered = resolve; });
    const submitting = session.submit('提交后停止');
    await entered;
    expect(session.isCommitting()).toBe(true);
    expect(session.stop()).toBe('committing');
    expect(specialistSignal?.aborted).toBe(false);
    releaseCommit!();
    await expect(submitting).resolves.toBe('started');
    expect(session.isCommitting()).toBe(false);
    expect(commitProjection).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful projection committed when the post-commit request-status audit fails', async () => {
    let saves = 0;
    saveChat.mockImplementation(async () => {
      saves += 1;
      if (saves === 5) throw new Error('post-commit audit save failed');
    });
    const { session, value, commitProjection } = createSession();
    await expect(session.submit('提交后审计失败')).resolves.toBe('started_with_audit_warning');
    expect(commitProjection).toHaveBeenCalledTimes(1);
    const timeline = readWorldSimulationConversationTimeline_ACU(value);
    expect(timeline.find(entry => entry.kind === 'user')).toMatchObject({ status: 'running' });
    expect(timeline.find(entry => entry.kind === 'error')).toMatchObject({
      status: 'failed',
      title: '账本已联合提交，但审计同步失败',
    });
    expect(session.isRunning()).toBe(false);
  });

  it('reports committed rather than aborting while post-commit audit synchronization is pending', async () => {
    let releaseAudit: (() => void) | undefined;
    let auditStarted: (() => void) | undefined;
    const auditSave = new Promise<void>(resolve => { releaseAudit = resolve; });
    let saves = 0;
    saveChat.mockImplementation(async () => {
      saves += 1;
      if (saves === 5) {
        auditStarted?.();
        await auditSave;
      }
    });
    const { session, commitProjection } = createSession();
    const startedAudit = new Promise<void>(resolve => { auditStarted = resolve; });
    const submitting = session.submit('提交后等待审计');
    await startedAudit;
    expect(commitProjection).toHaveBeenCalledTimes(1);
    expect(session.isCommitting()).toBe(false);
    expect(session.stop()).toBe('committed');
    releaseAudit!();
    await expect(submitting).resolves.toBe('started');
  });

  it('aborts a late master result and never submits a ledger commit', async () => {
    let release: ((value: string) => void) | undefined;
    let started: (() => void) | undefined;
    const master = new Promise<string>(resolve => { release = resolve; });
    const { session, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') { started?.(); return master; }
      return entityOutput();
    }));
    const reachedMaster = new Promise<void>(resolve => { started = resolve; });
    const submitting = session.submit('停止前的请求');
    await reachedMaster;
    expect(session.stop()).toBe('aborted'); release!('{"delegations":[{"agent":"entity-movement","instruction":"不应执行"}]}');
    await expect(submitting).rejects.toThrow();
    await expect(session.waitForIdle()).resolves.toBeUndefined();
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('invalidates a running request when its source swipe body changes', async () => {
    let release: ((value: string) => void) | undefined;
    let started: (() => void) | undefined;
    const master = new Promise<string>(resolve => { release = resolve; });
    const { session, value, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') { started?.(); return master; }
      return entityOutput();
    }));
    const reachedMaster = new Promise<void>(resolve => { started = resolve; });
    const submitting = session.submit('请求'); await reachedMaster;
    value[1].mes = '用户编辑后的 AI 正文'; value[1].swipes[0] = value[1].mes;
    release!('{"delegations":[{"agent":"entity-movement","instruction":"不应执行"}]}');
    await expect(submitting).rejects.toThrow();
    expect(commitProjection).not.toHaveBeenCalled();
  });
});
