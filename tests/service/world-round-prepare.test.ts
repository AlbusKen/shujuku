import { describe, expect, it, vi } from 'vitest';
import { readWorldRoundPayload_ACU } from '../helpers/world-round-payload';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { prepareWorldRoundRun_ACU } from '../../src/service/simulation/agent/world-round-prepare';
import * as worldRoundRunner from '../../src/service/simulation/agent/world-round-runner';
import type { WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import type { AgentWorldbookSnapshot_ACU } from '../../src/service/continuation/agent/agent-worldbook-read';
import { sha256HexSync_ACU } from '../../src/shared/sha256-sync';
import { buildWorldRunMaterials_ACU } from '../../src/service/simulation/world-run-materials';
import type { TableDataObject_ACU } from '../../src/shared/models/table-data';

const anchorBody = '正文';
const anchorDigest = sha256HexSync_ACU(anchorBody);

function fixture(mode: 'single' | 'layered' = 'layered') {
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.settings.workflowMode = mode;
  const identity: WorldSimulationRunIdentity_ACU = {
    kind: 'logical', logicalRef: { sessionId: 'session', branchId: 'branch', turnId: 'turn', attemptId: 'attempt', floorId: 'floor' },
    chatIdentity: 'chat', triggerKind: 'assistant_completed', triggerConversationMessageId: null, anchorContentDigest: anchorDigest,
    baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1, runId: 'run',
    deliveryTarget: 'body', workflowMode: mode, workflowProtocol: 'world-round-v1',
  };
  // 有意与 external input 共用，验证 prepare 必须冻结身份，而非只比较同一个可变引用。
  envelope.task = { taskId: 'task', originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
  envelope.activeStageId = 'stage';
  envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'running', activeRevision: 1, revisions: [{
    revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
    plan: { schemaVersion: 1, title: '预留', objective: '', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' },
  }] }];
  const worldbookSnapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [] };
  envelope.task.runMaterials = buildWorldRunMaterials_ACU({ instruction: envelope.task.originInstruction, worldbookSnapshot, workflowMode: mode, deliveryTarget: 'body' });
  const signal = new AbortController();
  const anchor = { kind: 'logical' as const, chatIdentity: 'chat', contentDigest: anchorDigest, logicalRef: identity.logicalRef };
  return { envelope, identity, signal, anchor, worldbookSnapshot };
}

function stageReply(messages: readonly { content: string }[]): string {
  const protocol = messages[0]?.content ?? '';
  const data = readWorldRoundPayload_ACU(messages);
  if (data.stage === 'world-narrative-review-v1') return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
  if (protocol.includes('worldbook-selection')) return JSON.stringify({ refs: [] });
  if (protocol.includes('clock-candidate')) return JSON.stringify({ candidateClock: { day: 1, slot: '', storyTime: '', precision: 'unknown', evidenceRefs: [] } });
  if (protocol.includes('recall-selection')) return JSON.stringify({ selections: [], worldSelection: {
    worldEventIds: [], factIds: [], reason: '无到期资料', priority: 1, scope: 'world',
  } });
  if (protocol.includes('world-page')) return JSON.stringify({ worldEventWrites: [], factWrites: [] });
  if (protocol.includes('actor-batch')) return JSON.stringify({ actorWrites: [], actorCompletions: [], factWrites: [], historyMilestoneWrites: [] });
  throw new Error('unexpected stage');
}

function prepare(f: ReturnType<typeof fixture>, options: Partial<Parameters<typeof prepareWorldRoundRun_ACU>[0]> = {}) {
  return prepareWorldRoundRun_ACU({
    ...f,
    signal: f.signal.signal,
    anchorBody,
    invoke: vi.fn(async (_role, messages) => stageReply(messages)),
    readCurrent: () => structuredClone(f.envelope),
    assertAnchorCurrent: () => {},
    hasLegacyWrites: false,
    countTokens: () => 1,
    now: 2,
    worldbookSnapshot: f.worldbookSnapshot,
    runMaterials: f.envelope.task!.runMaterials!,
    ...options,
  });
}

describe('受限整轮 prepare', () => {
  it.each([
    ['single', ['clock-recaller', 'world-simulator']],
    ['layered', ['clock-recaller', 'world-event-analyst', 'actor-simulator']],
  ] as const)('%s 以真实分阶段 runner 包装整轮结果，且计划不混入旧导演链', async (mode, specialists) => {
    const f = fixture(mode);
    const invoke = vi.fn(async (_role, messages) => stageReply(messages));
    const prepared = prepare(f, { invoke });

    expect(prepared.revision.plan.title).toBe('受限整轮世界推演');
    expect(prepared.revision.plan.plannedSpecialists).toEqual(specialists);
    expect(prepared.revision.plan.plannedSpecialists).not.toContain('director');
    expect(prepared.revision.plan.plannedSpecialists).not.toContain('undercurrent-analyst');
    await expect(prepared.execute(f.identity)).resolves.toMatchObject({
      outcome: 'world_round', finalProjection: { deliverable: false, content: null },
    });
    expect(invoke).toHaveBeenCalledTimes(5);
  });

  it('prepare 冻结即时指令、长期要求与世界书快照，调用方异步修改不影响本轮 payload', async () => {
    const f = fixture();
    const userRequirements = { schemaVersion: 1 as const, requirements: ['长期要求'], updatedAt: 1 };
    const worldbookSnapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [{ bookName: '设定', uid: 'u1', title: '关键词设定', keys: ['正文'], constant: false, content: '原始世界书正文', tokens: 3 }] };
    f.envelope.task!.originInstruction = '即时意图';
    f.envelope.task!.runMaterials = buildWorldRunMaterials_ACU({ instruction: '即时意图', userRequirements, worldbookSnapshot, workflowMode: f.identity.workflowMode, deliveryTarget: f.identity.deliveryTarget });
    const payloads: Record<string, unknown>[] = [];
    const invoke = vi.fn(async (_role, messages) => {
      const data = readWorldRoundPayload_ACU(messages);
      if (data.stage === 'world-narrative-review-v1') return stageReply(messages);
      payloads.push(data);
      if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [{ bookName: '设定', uid: 'u1' }] });
      return stageReply(messages);
    });
    const prepared = prepare(f, { invoke, instruction: '即时意图', userRequirements, worldbookSnapshot });
    userRequirements.requirements[0] = '被篡改';
    worldbookSnapshot.entries[0].content = '被篡改世界书正文';
    await prepared.execute(f.identity);
    expect(payloads.every(item => (item.context as { instruction: string }).instruction === '即时意图')).toBe(true);
    expect(payloads.every(item => ((item.context as { userRequirements: string[] }).userRequirements).includes('长期要求'))).toBe(true);
    expect(JSON.stringify(payloads)).toContain('原始世界书正文');
    expect(JSON.stringify(payloads)).not.toContain('被篡改世界书正文');
  });

  it.each(['single', 'layered'] as const)('%s prepare 冻结表格快照，之后外部修改不会污染传给 runner 的请求或账本', async mode => {
    const f = fixture(mode);
    const baseline = structuredClone(f.envelope.ledger);
    const tableData = { mate: { type: 'chatSheets', version: 1 }, sheet_0: { name: '纪要表', content: [['日期', '纪要'], ['第一日', '$ANCHOR_MESSAGE {{user}} <%= 1 + 1 %>']] } } as unknown as TableDataObject_ACU;
    const original = structuredClone(tableData);
    const seen: string[] = [];
    const invoke = vi.fn(async (_role, messages) => {
      const data = readWorldRoundPayload_ACU(messages);
      if (data.stage !== 'world-narrative-review-v1') {
        seen.push(String(data.stage));
        const blocks = messages.flatMap(message => {
          try {
            const block = JSON.parse(message.content) as Record<string, unknown>;
            return block && !Array.isArray(block) && Object.prototype.hasOwnProperty.call(block, 'WORLD_TABLES') ? [block.WORLD_TABLES] : [];
          } catch { return []; }
        });
        expect(blocks).toEqual([[{ sheetKey: 'sheet_0', name: '纪要表', content: (original.sheet_0 as { content: string[][] }).content }]]);
      }
      return stageReply(messages);
    });
    const run = vi.spyOn(worldRoundRunner, 'runWorldRound_ACU');
    try {
      const prepared = prepare(f, { tableData, invoke });
      (tableData.sheet_0 as { name: string; content: string[][] }).name = '篡改后表';
      (tableData.sheet_0 as { content: string[][] }).content[1][1] = '篡改后值';
      tableData.sheet_1 = { name: '新增表', content: [['新增']] } as TableDataObject_ACU['sheet_1'];
      await expect(prepared.execute(f.identity)).resolves.toMatchObject({ outcome: 'world_round', roundCandidate: { completion: 'no_change' } });
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ tableData: original }));
      expect(seen).toEqual(['clock-candidate', 'recall-selection', 'world-page', 'actor-batch']);
      expect(f.envelope.ledger).toEqual(baseline);
    } finally { run.mockRestore(); }
  });

  it('未提供表格时 prepare 仍向各业务阶段传空 WORLD_TABLES', async () => {
    const f = fixture(); const seen: string[] = [];
    const invoke = vi.fn(async (_role, messages) => {
      const stage = String(readWorldRoundPayload_ACU(messages).stage);
      if (stage !== 'world-narrative-review-v1') {
        seen.push(stage);
        expect(messages.some(message => {
          try { return JSON.parse(message.content).WORLD_TABLES && JSON.stringify(JSON.parse(message.content).WORLD_TABLES) === '[]'; }
          catch { return false; }
        })).toBe(true);
      }
      return stageReply(messages);
    });
    await prepare(f, { invoke }).execute(f.identity);
    expect(seen).toEqual(['clock-candidate', 'recall-selection', 'world-page', 'actor-batch']);
  });

  it('prepare 透传确认回调，发送克隆人物且拒绝后不保存登记', async () => {
    const f = fixture();
    const anchorText = '林舟踏进钟楼。';
    const run = vi.spyOn(worldRoundRunner, 'runWorldRound_ACU');
    const confirmActorRegistration = vi.fn(async (candidate: { id: string; name: string }) => {
      candidate.name = '篡改克隆对象';
      return false;
    });
    const invoke = vi.fn(async (_role, messages) => {
      if (readWorldRoundPayload_ACU(messages).stage === 'actor-batch') {
        return JSON.stringify({ actorRegistrations: [{ value: {
          id: 'new', name: '林舟', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
          deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
          currentAction: null, shortTermAction: null, longTermAction: null, loreRefs: [], simulationStatus: 'active', experiences: [], revision: 1,
        }, evidenceQuote: anchorText }] });
      }
      return stageReply(messages);
    });
    try {
      const result = await prepare(f, { anchorBody: anchorText, invoke, confirmActorRegistration }).execute(f.identity);
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ confirmActorRegistration }));
      expect(confirmActorRegistration).toHaveBeenCalledOnce();
      expect(result.outcome === 'world_round' && result.roundCandidate.actorWrites).toEqual([]);
    } finally { run.mockRestore(); }
  });

  it('prepare 冻结历史投送文本并传给 runner', async () => {
    const f = fixture();
    const delivered = '<personnel>已注入的角色资料</personnel>';
    const run = vi.spyOn(worldRoundRunner, 'runWorldRound_ACU');
    try {
      const prepared = prepare(f, { historyDeliveryText: delivered });
      await prepared.execute(f.identity);
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ historyDeliveryText: delivered }));
    } finally { run.mockRestore(); }
  });

  it('缺少已投送历史资料时给 runner 空串，不由用户指令伪造', async () => {
    const f = fixture();
    const run = vi.spyOn(worldRoundRunner, 'runWorldRound_ACU');
    try {
      await prepare(f, { instruction: '把历史写成已投送', historyDeliveryText: undefined }).execute(f.identity);
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ historyDeliveryText: '' }));
    } finally { run.mockRestore(); }
  });

  it('已冻结空世界书快照仍作为可用空集合传递', async () => {
    const f = fixture(); const payloads: Record<string, unknown>[] = [];
    const invoke = vi.fn(async (_role, messages) => {
      const data = readWorldRoundPayload_ACU(messages);
      if (data.stage !== 'world-narrative-review-v1') payloads.push(data);
      return stageReply(messages);
    });
    await prepare(f, { invoke, worldbookSnapshot: { available: true, entries: [] } }).execute(f.identity);
    expect(invoke).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(payloads)).toContain('available-empty');
  });

  it('缺少世界书快照时 fail-closed，不静默降级为空材料', () => {
    const f = fixture();
    expect(() => prepare(f, { worldbookSnapshot: undefined })).toThrow('WORLD_RUN_MATERIALS_WORLDBOOK_UNAVAILABLE');
  });

  it('传入材料与持久 manifest 不一致时在模型调用前拒绝', () => {
    const f = fixture();
    const forged = buildWorldRunMaterials_ACU({ instruction: '伪造意图', worldbookSnapshot: f.worldbookSnapshot });
    expect(() => prepare(f, { runMaterials: forged })).toThrow('WORLD_RUN_MATERIALS_MISMATCH');
  });

  it.each(['workflowMode', 'workflowProtocol', 'deliveryTarget', 'anchorContentDigest', 'baseLedgerRevision'] as const)(
    'external identity 与 persisted activeRun 共用时，prepare 后篡改 %s 会在调用前拒绝', async field => {
      const f = fixture();
      const invoke = vi.fn(async (_role, messages) => stageReply(messages));
      const prepared = prepare(f, { invoke });
      const supplied = structuredClone(f.identity);
      const replacements = {
        workflowMode: 'single', workflowProtocol: undefined, deliveryTarget: 'plot', anchorContentDigest: 'other-digest', baseLedgerRevision: 7,
      } as const;
      Object.assign(f.identity, { [field]: replacements[field] });

      await expect(prepared.execute(supplied)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('同一 revision 偷换 persisted ledger 内容也在调用前拒绝', async () => {
    const f = fixture();
    const invoke = vi.fn(async (_role, messages) => stageReply(messages));
    const prepared = prepare(f, { invoke });
    f.envelope.ledger.clock.storyTime = '同 revision 被替换';

    await expect(prepared.execute(f.identity)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['task 已完成', (f: ReturnType<typeof fixture>) => { f.envelope.task!.status = 'completed'; }],
    ['taskId 不匹配', (f: ReturnType<typeof fixture>) => { f.envelope.task!.taskId = 'other-task'; }],
    ['activeStageId 不匹配', (f: ReturnType<typeof fixture>) => { f.envelope.activeStageId = 'other-stage'; }],
    ['stage status 不匹配', (f: ReturnType<typeof fixture>) => { f.envelope.stages[0].status = 'completed'; }],
    ['stage activeRevision 不匹配', (f: ReturnType<typeof fixture>) => { f.envelope.stages[0].activeRevision = 2; }],
    ['stage revision 不匹配', (f: ReturnType<typeof fixture>) => { f.envelope.stages[0].revisions[0].revision = 2; }],
    ['stage frozen 不匹配', (f: ReturnType<typeof fixture>) => { f.envelope.stages[0].revisions[0].frozen = false; }],
  ])('%s 时 execute 在首个调用前拒绝', async (_name, mutate) => {
    const f = fixture();
    const invoke = vi.fn(async (_role, messages) => stageReply(messages));
    // 准备后改变持久化证明；不让 fixture 的共享 identity 掩盖差异。
    f.envelope.task!.activeRun = structuredClone(f.identity);
    const prepared = prepare(f, { invoke });
    mutate(f);

    await expect(prepared.execute(f.identity)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('同一逻辑楼层正文摘要改变仍可准备并完成推演', async () => {
    const f = fixture();
    f.anchor.contentDigest = 'other-digest';
    const prepared = prepare(f);
    await expect(prepared.execute(f.identity)).resolves.toMatchObject({ outcome: 'world_round' });
  });

  it('不同逻辑楼层仍不接受原运行', () => {
    const f = fixture();
    f.anchor.logicalRef = { ...f.anchor.logicalRef, floorId: 'other-floor' };
    expect(() => prepare(f)).toThrow();
  });

  it('prepare 冻结 external envelope 的账本与设置；后续 API/预算修改不影响本轮', async () => {
    const f = fixture();
    const persisted = structuredClone(f.envelope);
    const sent: Array<{ preset: { source: string }; protocol: string; payload: Record<string, unknown> }> = [];
    const invoke = vi.fn(async (_role, messages, preset) => {
      sent.push({ preset, protocol: messages[0].content, payload: readWorldRoundPayload_ACU(messages) });
      return stageReply(messages);
    });
    const prepared = prepare(f, { invoke, readCurrent: () => structuredClone(persisted) });
    // readCurrent 始终回传 prepare 时的持久化快照；只改外部 input，检验 execute 不得重新读取它。
    f.envelope.ledger.clock.day = 99;
    f.envelope.settings.agentHistoryTokenBudget = 1;
    f.envelope.settings.apiPresetMode = 'fixed';
    f.envelope.settings.fixedApiPresetName = '';

    await expect(prepared.execute(f.identity)).resolves.toMatchObject({ outcome: 'world_round' });
    expect(sent).toHaveLength(5);
    expect(sent.every(call => call.preset.source === 'current')).toBe(true);
    expect(sent[0].payload.baseClock).toMatchObject({ day: 1 });
    expect(sent[0].protocol).not.toContain('输入：');
  });

  it('execute 复制调用方 identity，异步修改临时参数不污染冻结模式', async () => {
    const f = fixture();
    const supplied = structuredClone(f.identity);
    const invoke = vi.fn(async (_role, messages) => {
      supplied.workflowMode = 'single';
      return stageReply(messages);
    });
    const prepared = prepare(f, { invoke });

    await expect(prepared.execute(supplied)).resolves.toMatchObject({ outcome: 'world_round' });
    expect(invoke).toHaveBeenCalledTimes(5);
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['timekeeper', 'timekeeper', 'undercurrent-analyst', 'dramatis-keeper', 'guidance-composer']);
    expect(invoke.mock.calls[2][1][0].content).toContain('world-event-analyst');
    expect(f.envelope.task!.activeRun!.workflowMode).toBe('layered');
  });

  it('invoke 期间持久运行身份被修改时中止且不返回 candidate', async () => {
    const f = fixture();
    const supplied = structuredClone(f.identity);
    const invoke = vi.fn(async (_role, messages) => {
      f.envelope.task!.activeRun!.workflowMode = 'single';
      return stageReply(messages);
    });
    const prepared = prepare(f, { invoke });

    await expect(prepared.execute(supplied)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('取消发生在 invoke 中时不返回 candidate', async () => {
    const f = fixture();
    const invoke = vi.fn(async (_role, messages) => {
      f.signal.abort();
      return stageReply(messages);
    });
    const prepared = prepare(f, { invoke });

    await expect(prepared.execute(f.identity)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('plot 目标经真实 prepare 和 runner 仅返回账本候选，不执行正文投影', async () => {
    const f = fixture();
    f.identity.deliveryTarget = 'plot';
    f.envelope.settings.deliveryTarget = 'plot';
    f.envelope.task!.runMaterials = buildWorldRunMaterials_ACU({ instruction: f.envelope.task!.originInstruction,
      worldbookSnapshot: f.worldbookSnapshot, workflowMode: f.identity.workflowMode, deliveryTarget: 'plot' });
    const result = await prepare(f).execute(f.identity);
    expect(result).toMatchObject({ outcome: 'world_round', finalProjection: { content: null, deliverable: false } });
    expect(result.outcome === 'world_round' && result.roundCandidate.projection).toEqual({ anchor: null, deliveries: [] });
  });

  it('旧逐栏写入 proof 在 prepare gate 被阻断', () => {
    expect(() => prepare(fixture(), { hasLegacyWrites: true })).toThrow();
  });

  it('在调用前阻断 abort 与账本修订变化', async () => {
    const f = fixture();
    const invoke = vi.fn();
    const prepared = prepare(f, { invoke });
    f.signal.abort();
    await expect(prepared.execute(f.identity)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(invoke).not.toHaveBeenCalled();

    const g = fixture();
    const stale = prepare(g, { invoke, readCurrent: () => ({ ...g.envelope, ledger: { ...g.envelope.ledger, revision: 1 } }) });
    await expect(stale.execute(g.identity)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(invoke).not.toHaveBeenCalled();
  });
});
