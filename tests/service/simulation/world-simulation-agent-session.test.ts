import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { WorldSimulationAgentSession_ACU } from '../../../src/service/simulation/world-simulation-agent-session';
import { readWorldSimulationConversationTimeline_ACU } from '../../../src/service/simulation/world-simulation-agent-conversation';
import type { WorldSimulationRequirementsStorePort_ACU } from '../../../src/service/simulation/world-simulation-agent-session';

const saveChat = vi.fn(async () => undefined);
function chat() { return [{ is_user: true, mes: '用户正文' }, { is_user: false, message_id: 'ai-1', mes: 'AI 正文', swipe_id: 0, swipes: ['AI 正文'] }]; }
function entityOutput() { return JSON.stringify({ expectedRevisions: { entities: 0 }, entities: [{ action: 'upsert', value: { id: 'entity-1', kind: 'character', name: '密探', importance: 'active', situation: '正在移动', agenda: '侦察', lastMovedIndex: 1, lastMovedAt: '即时', visibility: { mode: 'hidden' }, retired: false, updatedIndex: 0 } }], events: [], threads: [] }); }
function specialistCandidate(evidenceRefs: string[]) { return JSON.stringify({ ...JSON.parse(entityOutput()), evidenceRefs, summary: '密探继续观察', uncertainties: [] }); }
const source = 'world-simulation-user:1:string:ai-1:0:1';
function maintainOutput(appliedUserMessageId = source, expectedRevision = 0) { return JSON.stringify({ action: 'maintain_requirements', thought: '吸收最新用户要求', expectedRevision, appliedUserMessageId, requirements: [{ id: 'R1', category: 'canon', priority: 'hard', text: '港口封锁', sourceRefs: [appliedUserMessageId] }], summary: '同步港口规则' }); }
function requirementsStore(options: {
  snapshot?: any | null;
  sourceIds?: string[];
  pendingSourceIds?: string[];
  replace?: (raw: unknown) => Promise<any>;
} = {}): WorldSimulationRequirementsStorePort_ACU & { replacements: unknown[] } {
  let snapshot = options.snapshot ?? null;
  const sourceIds = options.sourceIds ?? [];
  const pendingSourceIds = options.pendingSourceIds ?? [];
  const replacements: unknown[] = [];
  return {
    read: () => snapshot,
    userSourceIds: () => [...sourceIds],
    pendingSourceIds: () => [...pendingSourceIds],
    replace: async (_target, raw) => {
      replacements.push(raw);
      if (options.replace) return options.replace(raw);
      const replacement = raw as any;
      snapshot = { feature: 'world-simulation', revision: (snapshot?.revision ?? 0) + 1, lastAppliedUserMessageId: replacement.appliedUserMessageId, requirements: replacement.requirements };
      return snapshot;
    },
    replacements,
  };
}
function createSession(value = chat(), runOwnedAi = vi.fn(async (request: any) => request.source === 'world-sim-master' ? '{"delegations":[{"agent":"entity-movement","instruction":"推进密探行动"}]}' : entityOutput()), canRun = () => true, settingsPatch: Record<string, unknown> = {}, requirementStore = requirementsStore(), onIdle?: () => void) {
  _set_SillyTavern_API_ACU({ chat: value, saveChat } as any);
  const commitProjection = vi.fn(async () => ({}));
  const session = new WorldSimulationAgentSession_ACU({
    getChat: () => value, getChatIdentity: () => 'chat-a', readSettings: () => ({ ...buildDefaultWorldSimulationSettings_ACU(), ...settingsPatch }),
    store: { read: () => null, commitProjection } as any, countTokens: async () => 1, runOwnedAi,
    createRecordId: () => 'manual-1', canRun, requirementsStore: requirementStore, onIdle,
  });
  return { session, value, runOwnedAi, commitProjection, requirementStore };
}

beforeEach(() => { saveChat.mockReset(); saveChat.mockResolvedValue(undefined); });

describe('world simulation Agent session', () => {
  it('maintains the frozen latest requirement source before re-deciding and committing a specialist candidate', async () => {
    let masterCalls = 0;
    const requirementStore = requirementsStore({ sourceIds: [source], pendingSourceIds: [source] });
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') {
        masterCalls += 1;
        return masterCalls === 1
          ? maintainOutput()
          : '{"delegations":[{"agent":"entity-movement","instruction":"推进密探行动"}]}';
      }
      return entityOutput();
    }), undefined, {}, requirementStore);

    await expect(session.submit('港口封锁，密探继续观察')).resolves.toBe('started');
    expect(requirementStore.replacements).toHaveLength(1);
    expect(masterCalls).toBe(2);
    expect(runOwnedAi.mock.calls.map(call => call[0].source)).toEqual(['world-sim-master', 'world-sim-master', 'world-sim-agent:entity-movement']);
    const firstMaster = runOwnedAi.mock.calls[0][0].messages;
    expect(firstMaster.find((message: any) => message.content.includes('<UNTRUSTED_PENDING_REQUIREMENT_SOURCES>'))).toMatchObject({ role: 'user' });
    const secondMaster = runOwnedAi.mock.calls[1][0].messages;
    const firstAction = secondMaster.find((message: any) => message.role === 'assistant' && message.content.includes('"action":"maintain_requirements"'));
    expect(firstAction).toBeDefined();
    const contexts = secondMaster.filter((message: any) => message.content.includes('【本次运行上下文】'));
    expect(contexts).toHaveLength(2);
    expect(contexts.at(-1)?.content).toContain('"revision":1');
    expect(secondMaster.findIndex((message: any) => message === contexts.at(-1))).toBeGreaterThan(secondMaster.findIndex((message: any) => message === firstAction));
    expect(secondMaster.findIndex((message: any) => message.role === 'system' && message.content.includes('【执行边界】'))).toBeGreaterThan(secondMaster.findIndex((message: any) => message === contexts.at(-1)));
    expect(commitProjection).toHaveBeenCalledTimes(1);
  });

  it('continues re-decision after requirements save when its non-authoritative audit write fails', async () => {
    let saves = 0;
    saveChat.mockImplementation(async () => {
      saves += 1;
      if (saves === 3) throw new Error('requirements audit save failed');
    });
    let masterCalls = 0;
    const requirementStore = requirementsStore({ sourceIds: [source], pendingSourceIds: [source] });
    const { session, value, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') {
        masterCalls += 1;
        return masterCalls === 1
          ? maintainOutput()
          : '{"delegations":[{"agent":"entity-movement","instruction":"推进密探行动"}]}';
      }
      return entityOutput();
    }), undefined, {}, requirementStore);

    await expect(session.submit('审计失败也要继续')).resolves.toBe('started_with_audit_warning');
    expect(requirementStore.replacements).toHaveLength(1);
    expect(masterCalls).toBe(2);
    expect(runOwnedAi.mock.calls.map(call => call[0].source)).toEqual(['world-sim-master', 'world-sim-master', 'world-sim-agent:entity-movement']);
    expect(commitProjection).toHaveBeenCalledTimes(1);
    expect(readWorldSimulationConversationTimeline_ACU(value).some(entry => entry.detail.includes('维护审计同步失败'))).toBe(true);
  });

  it('commits once when requirements and every later pre-commit audit save fail', async () => {
    let saves = 0;
    saveChat.mockImplementation(async () => {
      saves += 1;
      if (saves >= 3) throw new Error(`audit save ${saves} failed`);
    });
    let masterCalls = 0;
    const requirementStore = requirementsStore({ sourceIds: [source], pendingSourceIds: [source] });
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') {
        masterCalls += 1;
        return masterCalls === 1
          ? maintainOutput()
          : '{"delegations":[{"agent":"entity-movement","instruction":"推进密探行动"}]}';
      }
      return entityOutput();
    }), undefined, {}, requirementStore);

    await expect(session.submit('审计持续失败仍要完成权威提交')).resolves.toBe('started_with_audit_warning');
    expect(requirementStore.replacements).toHaveLength(1);
    expect(masterCalls).toBe(2);
    expect(runOwnedAi.mock.calls.map(call => call[0].source)).toEqual(['world-sim-master', 'world-sim-master', 'world-sim-agent:entity-movement']);
    expect(commitProjection).toHaveBeenCalledTimes(1);
    expect(saves).toBeGreaterThanOrEqual(5);
  });

  it('rejects a pending direct delegation before specialists or commitProjection run', async () => {
    const requirementStore = requirementsStore({ sourceIds: [source], pendingSourceIds: [source] });
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async () => '{"delegations":[{"agent":"entity-movement","instruction":"不应执行"}]}'), undefined, {}, requirementStore);

    await expect(session.submit('先维护要求')).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PROTOCOL_INVALID' } });
    expect(requirementStore.replacements).toHaveLength(0);
    expect(runOwnedAi).toHaveBeenCalledTimes(1);
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('retries an older pending source after feeding its rejection back to the master', async () => {
    const latest = 'world-simulation-user:1:string:ai-1:0:2';
    const requirementStore = requirementsStore({ sourceIds: [source, latest], pendingSourceIds: [source, latest] });
    let masterCalls = 0;
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source !== 'world-sim-master') return entityOutput();
      masterCalls += 1;
      if (masterCalls === 1) return maintainOutput(source);
      if (masterCalls === 2) {
        expect(request.messages.some((message: any) => message.content.includes('<UNTRUSTED_REQUIREMENTS_REJECTION>'))).toBe(true);
        return maintainOutput(latest);
      }
      return '{"delegations":[{"agent":"entity-movement","instruction":"推进密探行动"}]}';
    }), undefined, {}, requirementStore);

    await expect(session.submit('先补充再修改')).resolves.toBe('started');
    expect(requirementStore.replacements).toHaveLength(1);
    expect(masterCalls).toBe(3);
    expect(runOwnedAi.mock.calls.filter(call => call[0].source === 'world-sim-master')).toHaveLength(3);
    expect(commitProjection).toHaveBeenCalledTimes(1);
  });

  it('still stops immediately when the target swipe changes after requirements persistence', async () => {
    const requirementStore = requirementsStore({
      sourceIds: [source],
      pendingSourceIds: [source],
      replace: async raw => {
        const replacement = raw as any;
        return { feature: 'world-simulation', revision: 1, lastAppliedUserMessageId: replacement.appliedUserMessageId, requirements: replacement.requirements };
      },
    });
    const value = chat();
    const { session, runOwnedAi, commitProjection } = createSession(value, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') return maintainOutput();
      return entityOutput();
    }), undefined, {}, requirementStore);
    requirementStore.replacements.length = 0;
    const replace = requirementStore.replace;
    requirementStore.replace = async (...args: any[]) => {
      const next = await replace(...args);
      value[1]!.swipe_id = 1;
      return next;
    };

    await expect(session.submit('保存后切换分支')).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(requirementStore.replacements).toHaveLength(1);
    expect(runOwnedAi).toHaveBeenCalledTimes(1);
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('fails closed without committing when the requirements Store keeps rejecting persistence', async () => {
    const requirementStore = requirementsStore({ sourceIds: [source], pendingSourceIds: [source], replace: async () => { throw new Error('strict save failed'); } });
    let masterCalls = 0;
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source !== 'world-sim-master') return entityOutput();
      masterCalls += 1;
      if (masterCalls > 1) {
        expect(request.messages.some((message: any) => message.content.includes('<UNTRUSTED_REQUIREMENTS_REJECTION>'))).toBe(true);
      }
      return maintainOutput();
    }), undefined, {}, requirementStore);

    await expect(session.submit('保存必须成功')).rejects.toMatchObject({ error: { code: 'WORLD_SIM_BUDGET_EXCEEDED' } });
    expect(masterCalls).toBeGreaterThan(1);
    expect(requirementStore.replacements).toHaveLength(masterCalls);
    expect(runOwnedAi).toHaveBeenCalledTimes(masterCalls);
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('rejects self-initiated requirements maintenance when no pending source exists', async () => {
    const requirementStore = requirementsStore({ sourceIds: [source], pendingSourceIds: [] });
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async () => maintainOutput()), undefined, {}, requirementStore);

    await expect(session.submit('不能伪造用户要求')).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PROTOCOL_INVALID' } });
    expect(requirementStore.replacements).toHaveLength(0);
    expect(runOwnedAi).toHaveBeenCalledTimes(1);
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('treats a user message as an untrusted request, delegates to an allowed specialist, and commits only through commitProjection', async () => {
    const { session, runOwnedAi, commitProjection } = createSession();
    await expect(session.submit('让密探去码头观察')).resolves.toBe('started');
    expect(runOwnedAi.mock.calls.map(call => call[0].source)).toEqual(['world-sim-master', 'world-sim-agent:entity-movement']);
    expect(runOwnedAi.mock.calls[0][0].messages.find((message: any) => message.content.includes('<UNTRUSTED_USER_REQUEST>'))).toMatchObject({ role: 'user' });
    const specialistRequest = runOwnedAi.mock.calls[1][0];
    expect(specialistRequest.messages.find((message: any) => message.content.includes('<UNTRUSTED_DELEGATION>'))).toMatchObject({ role: 'user' });
    expect(specialistRequest.prompt).toContain('<UNTRUSTED_DELEGATION>');
    expect(specialistRequest.prompt).not.toContain('<DELEGATION>');
    expect(commitProjection).toHaveBeenCalledTimes(1);
    expect(commitProjection.mock.calls[0][0]).toMatchObject({ anchorMessageIndex: 1, recordId: 'manual-1', expectedReplayDigest: null, parentReplayDigest: null, sourceAnchorMessageIndex: 1, coverageEndMessageIndex: 1, delta: { revisions: { entities: 1 } } });
    expect(session.isRunning()).toBe(false);
  });

  it('passes a modern delegation seed read only into its selected specialist request', async () => {
    let masterCalls = 0;
    let specialistCalls = 0;
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source !== 'world-sim-master') {
        specialistCalls += 1;
        return specialistCalls === 1
          ? '{"thought":"需要核对当前状态","action":"tools","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}'
          : specialistCandidate(['$WORLD_STATE']);
      }
      masterCalls += 1;
      return masterCalls === 1
        ? '{"action":"delegate","thought":"补证后核验","delegations":[{"agentName":"entity-movement","task":"只核验密探位置","materialGrants":[],"reads":["$STORY_PENDING"]}]}'
        : '{"action":"finalize","thought":"候选可用","decision":"commit","acceptedAgents":["entity-movement"],"summary":"提交实体变化","unresolved":[]}';
    }));

    await expect(session.submit('核验密探位置')).resolves.toBe('started');
    const specialistCallsForAgent = runOwnedAi.mock.calls.filter(call => call[0].source === 'world-sim-agent:entity-movement');
    const specialist = specialistCallsForAgent[0]![0];
    const seedRead = specialist.messages.find((message: any) => message.content.includes('<UNTRUSTED_READ_MATERIAL>'));
    expect(seedRead).toMatchObject({ role: 'user' });
    expect(seedRead.content).toContain('### $STORY_PENDING');
    const toolResults = specialistCallsForAgent[1]![0].messages.find((message: any) => message.content.includes('<UNTRUSTED_TOOL_RESULTS>'));
    expect(toolResults).toMatchObject({ role: 'user' });
    expect(toolResults.content).toContain('### $WORLD_STATE');
    expect(commitProjection).toHaveBeenCalledTimes(1);
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

  it('drains pending user instructions in FIFO order and notifies runtime after each request settles', async () => {
    let allowed = false;
    const onIdle = vi.fn();
    const { session, runOwnedAi } = createSession(undefined, undefined, () => allowed, {}, requirementsStore(), onIdle);
    await expect(session.submit('先处理')).resolves.toBe('queued');
    await expect(session.submit('后处理')).resolves.toBe('queued');
    allowed = true;
    await expect(session.runPendingForAnchor(1)).resolves.toBe('committed');
    const master = runOwnedAi.mock.calls.find(call => call[0].source === 'world-sim-master')![0];
    const request = master.messages.find((message: any) => message.content.includes('<UNTRUSTED_USER_REQUEST>'));
    expect(request).toMatchObject({ role: 'user' });
    expect(request.content).toContain('先处理');
    expect(request.content).not.toContain('后处理');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('returns no_change_with_audit_warning when an empty delegation status audit fails', async () => {
    let saves = 0;
    saveChat.mockImplementation(async () => {
      saves += 1;
      if (saves === 4) throw new Error('empty delegation status audit failed');
    });
    let allowed = false;
    const { session, commitProjection } = createSession(undefined, vi.fn(async () => '{"delegations":[]}'), () => allowed);
    await expect(session.submit('先排队')).resolves.toBe('queued');
    allowed = true;

    await expect(session.runPendingForAnchor(1)).resolves.toBe('no_change_with_audit_warning');
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('returns started_with_audit_warning when an empty specialist candidate status audit fails', async () => {
    let saves = 0;
    saveChat.mockImplementation(async () => {
      saves += 1;
      if (saves === 4) throw new Error('empty candidate status audit failed');
    });
    const { session, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') return '{"delegations":[{"agent":"entity-movement","instruction":"核验但不改动"}]}';
      return '{"expectedRevisions":{},"entities":[],"events":[],"threads":[]}';
    }));

    await expect(session.submit('无世界状态改动')).resolves.toBe('started_with_audit_warning');
    expect(commitProjection).not.toHaveBeenCalled();
  });

  it('does not commit an empty modern C5 specialist candidate', async () => {
    let masterCalls = 0;
    const { session, runOwnedAi, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source !== 'world-sim-master') {
        return '{"expectedRevisions":{},"entities":[],"events":[],"threads":[],"evidenceRefs":[],"summary":"当前没有安全变化","uncertainties":["暂无新增事实"]}';
      }
      masterCalls += 1;
      return masterCalls === 1
        ? '{"action":"delegate","thought":"核验但不改动","delegations":[{"agentName":"entity-movement","task":"仅在有依据时修改","materialGrants":[],"reads":[]}]}'
        : '{"action":"finalize","thought":"没有候选写集","decision":"no_change","acceptedAgents":[],"summary":"无需提交","unresolved":[]}';
    }));
    await expect(session.submit('无世界状态改动')).resolves.toBe('started');
    expect(runOwnedAi.mock.calls.map(call => call[0].source)).toEqual(['world-sim-master', 'world-sim-agent:entity-movement', 'world-sim-master']);
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

  it('rejects a late candidate when the frozen requirements revision changes before commitProjection', async () => {
    let revision = 0;
    const requirementStore: any = {
      read: () => ({ feature: 'world-simulation', revision, lastAppliedUserMessageId: null, requirements: [] }),
      userSourceIds: () => [], pendingSourceIds: () => [], replace: vi.fn(),
    };
    const { session, commitProjection } = createSession(undefined, vi.fn(async (request: any) => {
      if (request.source === 'world-sim-master') return '{"delegations":[{"agent":"entity-movement","instruction":"推进"}]}';
      revision = 1;
      return entityOutput();
    }), undefined, {}, requirementStore);
    await expect(session.submit('资料变化后不得提交')).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(commitProjection).not.toHaveBeenCalled();
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
