import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import {
  FirstFloorWorldSimulationStore_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  buildEmptyWorldChronicleArchiveSnapshot_ACU,
  buildWorldSimulationBucketKey_ACU,
  readWorldSimulationBucketEntry_ACU,
  resolveCurrentWorldSimulationAnchor_ACU,
  resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationChronicleArchiveSnapshot_ACU,
  validateWorldSimulationEnvelope_ACU,
  validateWorldSimulationLedger_ACU,
  collectWorldSimulationLedgerViolations_ACU,
  writeWorldSimulationBucketEntry_ACU,
  renameApiPresetReferencesInWorldSimulationSettings_ACU,
  clearApiPresetReferencesInWorldSimulationSettings_ACU,
} from '../../../src/service/simulation/simulation-store';
import { WORLD_CHRONICLE_HOT_WINDOW_ACU, WORLD_CHRONICLE_OVERVIEW_CAP_ACU, WORLD_LEDGER_SCHEMA_VERSION_ACU, WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { normalizeWorldHistoryArchive_ACU } from '../../../src/service/simulation/history-archive';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { sha256HexSync_ACU } from '../../../src/shared/sha256-sync';
import { buildV16WorldSimulationAgentPrompt_ACU, buildV21WorldSimulationAgentPrompt_ACU, WORLD_SIMULATION_PROMPT_VERSION_V21_ACU } from '../../../src/service/simulation/agent/agent-defaults';
import { WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU } from '../../../src/service/simulation/simulation-ledger-fold';

describe('world simulation envelope store', () => {
  beforeEach(() => _set_SillyTavern_API_ACU(undefined));

  it('新默认请求150000、读取100000，已有自定义预算读取不被覆盖', () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    expect(envelope.settings).toMatchObject({ agentHistoryTokenBudget: 150000, agentReadTokenBudget: 100000 });
    envelope.settings.agentHistoryTokenBudget = 90000;
    envelope.settings.agentReadTokenBudget = '20%';
    expect(validateWorldSimulationEnvelope_ACU(envelope).settings).toMatchObject({
      agentHistoryTokenBudget: 90000, agentReadTokenBudget: '20%',
    });
  });

  it('accepts the default closed envelope and rejects unknown fields', () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    expect(validateWorldSimulationEnvelope_ACU(envelope)).toEqual(envelope);
    expect(() => validateWorldSimulationEnvelope_ACU({ ...envelope, unexpected: true })).toThrow(WorldSimulationValidationError_ACU);
  });

  it('人物上一轮行动结果为可缺省字符串：旧档原样读取，新值保存并回读', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const actor = { id: 'actor-1', name: '人物', interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
      informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null,
      longTermAction: null, experiences: [], revision: 1 } as const;
    ledger.actors = [structuredClone(actor)];
    const old = structuredClone(ledger);
    expect(validateWorldSimulationLedger_ACU(ledger).actors[0]).not.toHaveProperty('previousActionResult');
    expect(ledger).toEqual(old);
    const persisted = validateWorldSimulationLedger_ACU({ ...ledger, actors: [{ ...actor, previousActionResult: '尚未查到线索' }] }, 'persist');
    expect(validateWorldSimulationLedger_ACU(persisted).actors[0].previousActionResult).toBe('尚未查到线索');
    expect(validateWorldSimulationLedger_ACU({ ...ledger, actors: [{ ...actor, previousActionResult: '' }] }).actors[0].previousActionResult).toBe('');
    for (const invalid of [null, 123]) {
      expect(() => validateWorldSimulationLedger_ACU({ ...ledger, actors: [{ ...actor, previousActionResult: invalid }] }))
        .toThrow(/previousActionResult 必须是字符串/);
    }
  });

  it('投送目标为独立长期偏好：旧存档默认 body，显式 plot 可回读，非法值拒绝', () => {
    const old: any = structuredClone(buildDefaultWorldSimulationEnvelope_ACU());
    delete old.settings.deliveryTarget;
    const snapshot = structuredClone(old);
    expect(validateWorldSimulationEnvelope_ACU(old).settings.deliveryTarget).toBe('body');
    expect(old).toEqual(snapshot);
    old.settings.deliveryTarget = 'plot';
    expect(validateWorldSimulationEnvelope_ACU(old).settings.deliveryTarget).toBe('plot');
    old.settings.deliveryTarget = 'auto';
    expect(() => validateWorldSimulationEnvelope_ACU(old)).toThrow(/settings.deliveryTarget 枚举非法/);
  });

  it('single/layered 为独立长期偏好，旧设置默认 layered，director 或 auto 均拒绝', () => {
    const old: any = structuredClone(buildDefaultWorldSimulationEnvelope_ACU());
    delete old.settings.workflowMode;
    const snapshot = structuredClone(old);
    expect(validateWorldSimulationEnvelope_ACU(old).settings.workflowMode).toBe('layered');
    expect(old).toEqual(snapshot);
    old.settings.workflowMode = 'single';
    expect(validateWorldSimulationEnvelope_ACU(old).settings.workflowMode).toBe('single');
    old.settings.workflowMode = 'director';
    expect(() => validateWorldSimulationEnvelope_ACU(old)).toThrow(/settings.workflowMode 枚举非法/);
  });

  it('运行身份冻结目标严格回读，旧身份缺字段仍保持兼容', () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: 'task', originInstruction: '推进', status: 'paused', createdAt: 1, updatedAt: 1,
      activeRun: {
        runId: 'run', chatIdentity: 'chat-a', triggerKind: 'assistant_completed', triggerConversationMessageId: null,
        anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
        anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', deliveryTarget: 'body',
      }, stopReason: 'manual' };
    envelope.activeStageId = 'stage';
    envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'planning', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: false,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
    expect(validateWorldSimulationEnvelope_ACU(envelope).task?.activeRun?.deliveryTarget).toBe('body');
    envelope.task.activeRun!.workflowMode = 'layered';
    expect(validateWorldSimulationEnvelope_ACU(envelope).task?.activeRun?.workflowMode).toBe('layered');
    (envelope.task.activeRun as any).workflowMode = 'director';
    expect(() => validateWorldSimulationEnvelope_ACU(envelope)).toThrow(/task.activeRun.workflowMode 枚举非法/);
    delete (envelope.task.activeRun as any).workflowMode;
    envelope.task.activeRun!.deliveryTarget = 'plot';
    expect(validateWorldSimulationEnvelope_ACU(envelope).task?.activeRun?.deliveryTarget).toBe('plot');
    (envelope.task.activeRun as any).deliveryTarget = 'invalid';
    expect(() => validateWorldSimulationEnvelope_ACU(envelope)).toThrow(/task.activeRun.deliveryTarget 枚举非法/);
    delete (envelope.task.activeRun as any).deliveryTarget;
    expect(validateWorldSimulationEnvelope_ACU(envelope).task?.activeRun?.deliveryTarget).toBeUndefined();
  });

  it('新协议运行冻结完整身份、未知协议或缺冻结字段均 fail-closed，读取不改原对象', () => {
    const envelope: any = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: 'task', originInstruction: '推进', status: 'paused', createdAt: 1, updatedAt: 1,
      activeRun: { runId: 'run', chatIdentity: 'chat-a', triggerKind: 'assistant_completed', triggerConversationMessageId: null,
        anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
        anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1' }, stopReason: 'manual' };
    envelope.activeStageId = 'stage';
    envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'planning', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: false,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
    const snapshot = structuredClone(envelope);
    expect(validateWorldSimulationEnvelope_ACU(envelope).task?.activeRun).toMatchObject({ workflowProtocol: 'world-round-v1', workflowMode: 'layered' });
    expect(envelope).toEqual(snapshot);
    delete envelope.task.activeRun.workflowMode;
    expect(() => validateWorldSimulationEnvelope_ACU(envelope)).toThrow(/新工作流协议必须冻结/);
    envelope.task.activeRun.workflowMode = 'layered';
    envelope.task.activeRun.workflowProtocol = 'unknown';
    expect(() => validateWorldSimulationEnvelope_ACU(envelope)).toThrow(/workflowProtocol 枚举非法/);
  });

  it('v1 运行材料严格校验、历史终态保留且旧暂停账本保持可读', () => {
    const materials = {
      schemaVersion: 1 as const,
      instructionHash: 'a'.repeat(64),
      requirementsHash: 'b'.repeat(64),
      worldbookHash: 'c'.repeat(64),
    };
    const makeV1 = (status: 'drafting' | 'paused' | 'completed', activeRun = status !== 'completed'): any => {
      const envelope: any = buildDefaultWorldSimulationEnvelope_ACU();
      envelope.task = {
        taskId: 'task', originInstruction: '推进', status, createdAt: 1, updatedAt: 1, stopReason: status === 'completed' ? null : 'manual',
        activeRun: activeRun ? {
          runId: 'run', chatIdentity: 'chat-a', triggerKind: 'assistant_completed', triggerConversationMessageId: null,
          anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1,
          anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', deliveryTarget: 'body', workflowMode: 'layered', workflowProtocol: 'world-round-v1',
        } : null,
        runMaterials: { ...materials },
      };
      envelope.activeStageId = 'stage';
      envelope.stages = [{ stageId: 'stage', stageNumber: 1, status: 'planning', activeRevision: 1,
        revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: false,
          plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [], convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '' } }] }];
      return envelope;
    };

    for (const status of ['drafting', 'paused', 'completed'] as const) {
      const envelope = makeV1(status);
      const snapshot = structuredClone(envelope);
      expect(validateWorldSimulationEnvelope_ACU(envelope).task?.runMaterials).toEqual(materials);
      expect(envelope).toEqual(snapshot);
    }
    const legacyPaused = makeV1('paused');
    delete legacyPaused.task.runMaterials;
    expect(validateWorldSimulationEnvelope_ACU(legacyPaused).task?.runMaterials).toBeUndefined();

    const uppercase = makeV1('drafting');
    uppercase.task.runMaterials.instructionHash = 'A'.repeat(64);
    expect(() => validateWorldSimulationEnvelope_ACU(uppercase)).toThrow(/小写 SHA-256/);
    const forged = makeV1('drafting');
    forged.task.runMaterials.requirementsHash = 'not-a-hash';
    expect(() => validateWorldSimulationEnvelope_ACU(forged)).toThrow(/小写 SHA-256/);
    const extra = makeV1('drafting');
    extra.task.runMaterials.unexpected = 'forged';
    expect(() => validateWorldSimulationEnvelope_ACU(extra)).toThrow(/未知持久化字段/);
    const symbolInjected = makeV1('drafting');
    Object.defineProperty(symbolInjected.task.runMaterials, Symbol('forged'), { value: 'x', enumerable: true });
    expect(() => validateWorldSimulationEnvelope_ACU(symbolInjected)).toThrow(/symbol 持久化字段/);
    const badSchema = makeV1('drafting');
    badSchema.task.runMaterials.schemaVersion = 2;
    expect(() => validateWorldSimulationEnvelope_ACU(badSchema)).toThrow(/schemaVersion 必须为 1/);

    const legacyActiveRun = makeV1('paused');
    delete legacyActiveRun.task.activeRun.workflowProtocol;
    expect(() => validateWorldSimulationEnvelope_ACU(legacyActiveRun)).toThrow(/仅允许 world-round-v1/);
    const runningWithoutActiveRun = makeV1('drafting', false);
    runningWithoutActiveRun.task.status = 'running';
    expect(() => validateWorldSimulationEnvelope_ACU(runningWithoutActiveRun)).toThrow(/仅允许保留在暂停、完成或失败/);
  });

  it('已完成自动锚点按独立可选字段回读，损坏的标记拒绝加载', () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: 'task', originInstruction: '推进', status: 'completed', createdAt: 1, updatedAt: 2,
      activeRun: null, stopReason: null, completedAutoAnchor: {
        chatIdentity: 'chat-a', messageKey: 'number:1', swipeId: '0', contentDigest: 'digest',
      } };
    expect(validateWorldSimulationEnvelope_ACU(envelope).task?.completedAutoAnchor).toEqual(envelope.task.completedAutoAnchor);
    expect(() => validateWorldSimulationEnvelope_ACU({ ...envelope, task: { ...envelope.task, completedAutoAnchor: { messageKey: 'number:1' } } }))
      .toThrow(WorldSimulationValidationError_ACU);
    const oldTask = { ...envelope.task };
    delete oldTask.completedAutoAnchor;
    expect(validateWorldSimulationEnvelope_ACU({ ...envelope, task: oldTask }).task?.completedAutoAnchor).toBeUndefined();
  });

  it('读取旧提示词不保留正文，timekeeper 渠道仍供新时钟角色使用，输入不改写', () => {
    const legacy: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    const preserved = { mode: 'fixed' as const, presetName: 'kept' };
    legacy.settings.agentPrompts['requirements-maintainer'] = [{ role: 'system', content: '旧正文' }];
    legacy.settings.agentApiPresets['requirements-maintainer'] = { mode: 'fixed', presetName: 'old' };
    legacy.settings.agentApiPresets.timekeeper = preserved;
    const input = structuredClone(legacy);
    const loaded = validateWorldSimulationEnvelope_ACU(legacy);
    expect(loaded.settings.agentPrompts).toEqual({});
    expect(loaded.settings.agentApiPresets).not.toHaveProperty('requirements-maintainer');
    expect(loaded.settings.agentApiPresets.timekeeper).toEqual(preserved);
    expect(legacy).toEqual(input);
  });

  it('只为完全缺失的 webResearch 补默认配置', () => {
    const legacy: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    delete legacy.settings.webResearch;
    expect(validateWorldSimulationEnvelope_ACU(legacy).settings.webResearch).toEqual(buildDefaultWorldSimulationSettings_ACU().webResearch);
  });

  it('显式残缺或非法的 webResearch 配置 fail-closed', () => {
    const missing: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    delete missing.settings.webResearch.searchProvider;
    expect(() => validateWorldSimulationEnvelope_ACU(missing)).toThrow(WorldSimulationValidationError_ACU);

    const invalid: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    invalid.settings.webResearch.searchProvider = 'unknown';
    expect(() => validateWorldSimulationEnvelope_ACU(invalid)).toThrow(WorldSimulationValidationError_ACU);

    const outOfRange: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    outOfRange.settings.webResearch.pageCharLimit = 499;
    expect(() => validateWorldSimulationEnvelope_ACU(outOfRange)).toThrow(WorldSimulationValidationError_ACU);
  });

  it('生产读取剔除 V16 旧提示词与版本标记，不修改持久原文', () => {
    const old = buildDefaultWorldSimulationEnvelope_ACU();
    old.settings.promptForceDefaultVersion = 'world-simulation-v20';
    old.settings.agentPrompts.timekeeper = buildV16WorldSimulationAgentPrompt_ACU('timekeeper');
    old.settings.agentPrompts['world-director'] = buildV16WorldSimulationAgentPrompt_ACU('world-director');
    const customIndex = old.settings.agentPrompts.timekeeper.findIndex(segment => segment.content.startsWith('<WORLD_SIMULATION_ENGINE_SEAM:WORKFLOW>'));
    old.settings.agentPrompts.timekeeper[customIndex].content += '\n用户自定义尾句';
    const expected = structuredClone(old.settings.agentPrompts.timekeeper[customIndex]);
    const chat: any[] = [{ _qrf_world_simulation: old }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const loaded = new FirstFloorWorldSimulationStore_ACU().read()!;
    expect(loaded.settings.agentPrompts).toEqual({});
    expect(loaded.settings.promptForceDefaultVersion).toBeUndefined();
    expect(chat[0]._qrf_world_simulation.settings.agentPrompts.timekeeper[customIndex]).toEqual(expected);
    expect(chat[0]._qrf_world_simulation.settings.agentPrompts['world-director']).toEqual(old.settings.agentPrompts['world-director']);
  });

  it('生产读取剔除 v21 旧提示词且不重建默认，读取不改写持久原文', () => {
    const old = buildDefaultWorldSimulationEnvelope_ACU();
    old.settings.promptForceDefaultVersion = WORLD_SIMULATION_PROMPT_VERSION_V21_ACU;
    for (const role of ['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'] as const) {
      old.settings.agentPrompts[role] = buildV21WorldSimulationAgentPrompt_ACU(role);
    }
    const customized = old.settings.agentPrompts['dramatis-keeper'];
    const workflowIndex = customized.findIndex(segment => segment.content.includes('WORLD_SIMULATION_ENGINE_SEAM:WORKFLOW'));
    customized[workflowIndex].content += '\n用户自定义人物核查规则';
    const persisted = structuredClone(old);
    const chat: any[] = [{ _qrf_world_simulation: old }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const loaded = new FirstFloorWorldSimulationStore_ACU().read()!;
    expect(loaded.settings.promptForceDefaultVersion).toBeUndefined();
    expect(loaded.settings.agentPrompts).toEqual({});
    expect(chat[0]._qrf_world_simulation).toEqual(persisted);
  });

  it('持久化旧提示词输入时不再输出旧正文与版本字段', async () => {
    const chat: any[] = [{ untouched: true }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.settings.agentPrompts['world-director'] = buildV16WorldSimulationAgentPrompt_ACU('world-director');
    envelope.settings.promptForceDefaultVersion = 'world-simulation-v20';
    const store = new FirstFloorWorldSimulationStore_ACU();
    await store.replaceAtomically(envelope);
    expect(chat[0]._qrf_world_simulation.settings.agentPrompts).toEqual({});
    expect(chat[0]._qrf_world_simulation.settings.promptForceDefaultVersion).toBeUndefined();
    expect(envelope.settings.agentPrompts['world-director']).toBeDefined();
  });

  it('读取及保存剔除旧三审查，保留新版自定义和显式空段', async () => {
    const chat: any[] = [{ untouched: true }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const segment = { role: 'system', content: '自定义世界稿', enabled: true, deletable: true, pinned: false };
    envelope.settings.worldRoundPrompts = {
      'clock-recaller': [], 'world-simulator': [], 'world-event-analyst': [segment],
      'actor-simulator': [], 'joint-reviewer': [], 'scene-review': [segment],
      'projection-review': [segment], 'adoption-review': [segment],
    };
    const original = structuredClone(envelope);
    const store = new FirstFloorWorldSimulationStore_ACU();
    await store.replaceAtomically(envelope);
    const expected = {
      'clock-recaller': [], 'world-simulator': [], 'world-event-analyst': [segment],
      'actor-simulator': [], 'joint-reviewer': [],
    };
    expect(store.read()!.settings.worldRoundPrompts).toEqual(expected);
    expect(chat[0]._qrf_world_simulation.settings.worldRoundPrompts).toEqual(expected);
    expect(envelope).toEqual(original);
  });

  it('persists only the independent first-floor field', async () => {
    const chat: any[] = [{ untouched: true }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const store = new FirstFloorWorldSimulationStore_ACU();
    await store.replaceAtomically(envelope);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(chat[0]._qrf_world_simulation).toEqual(envelope);
    expect(chat[0]._qrf_continuation).toBeUndefined();
    expect(store.read()).toEqual(envelope);
  });

  it('原子更新使用楼层折叠后的权威 ledger，避免首楼缓存滞后误触发 revision stale', async () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const foldedLedger = { ...envelope.ledger, revision: 2 };
    const saveChat = vi.fn().mockResolvedValue(undefined);
    const chat: any[] = [{
      is_user: false,
      message_id: 1,
      mes: 'anchor',
      swipe_id: 0,
      _qrf_world_simulation: envelope,
    }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, anchor, {
      schemaVersion: WORLD_SIMULATION_LEDGER_FRAME_SCHEMA_VERSION_ACU,
      checkpoint: foldedLedger,
      deltas: [],
    }, chat);
    const store = new FirstFloorWorldSimulationStore_ACU();
    let revisionSeenByMutator = -1;

    await store.updateAtomically(current => {
      revisionSeenByMutator = current!.ledger.revision;
      return { ...current!, updatedAt: 9 };
    });

    expect(revisionSeenByMutator).toBe(2);
    expect(chat[0]._qrf_world_simulation.ledger.revision).toBe(2);
    expect(store.read()?.ledger.revision).toBe(2);
  });

  it('restores the previous field when host save fails', async () => {
    const previous = buildDefaultWorldSimulationEnvelope_ACU();
    const chat: any[] = [{ _qrf_world_simulation: previous }];
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const candidate = { ...previous, updatedAt: 9 };
    await expect(new FirstFloorWorldSimulationStore_ACU().replaceAtomically(candidate)).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });
    expect(chat[0]._qrf_world_simulation).toEqual(previous);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('读取 v1 账本时内存归一化为当前版本，且不写回原对象', () => {
    const raw: any = {
      schemaVersion: 1,
      revision: 0,
      clock: { storyTime: '第三日黄昏', elapsed: '3日', precision: 'approximate', evidenceRefs: [] },
      dimensions: [],
      seeds: [],
      actors: [],
      chronicle: [],
      guidance: { signals: ['风声'], excludedFacts: [], evidenceRefs: [] },
    };
    const snapshot = JSON.parse(JSON.stringify(raw));
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.schemaVersion).toBe(WORLD_LEDGER_SCHEMA_VERSION_ACU);
    expect(next.clock.day).toBe(3);
    expect(next.clock.slot).toBe('');
    expect(next.rumors).toEqual([]);
    expect(next.player).toMatchObject({ location: null, contact: 'open', locationUpdatedAtDay: 3, regionVisits: [] });
    expect(next.guidance.signals).toEqual([{ text: '风声', voice: 'ambient' }]);
    expect(next.chronicleOverview).toEqual([]);
    expect(next.pendingFixes).toEqual([]);
    expect(next.materialCompletion).toMatchObject({ state: 'legacy_unknown', expectedModules: [], modules: {} });
    expect(raw).toEqual(snapshot);
  });

  it('读取 v2 账本时补 chronicleOverview 与完成状态并归一化为当前版本，且不写回原对象', () => {
    const raw: any = {
      ...buildEmptyWorldSimulationLedger_ACU(),
      schemaVersion: 2,
    };
    delete raw.chronicleOverview;
    delete raw.pendingFixes;
    delete raw.materialCompletion;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    const snapshot = JSON.parse(JSON.stringify(raw));
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.schemaVersion).toBe(WORLD_LEDGER_SCHEMA_VERSION_ACU);
    expect(next.chronicleOverview).toEqual([]);
    expect(next.pendingFixes).toEqual([]);
    expect(next.materialCompletion.state).toBe('legacy_unknown');
    expect(raw).toEqual(snapshot);
    expect(raw).not.toHaveProperty('chronicleOverview');
    expect(raw).not.toHaveProperty('pendingFixes');
    expect(raw).not.toHaveProperty('materialCompletion');
  });

  it('读取 v3 账本时补 pendingFixes 与完成状态并归一化为当前版本，且不写回原对象', () => {
    const raw: any = {
      ...buildEmptyWorldSimulationLedger_ACU(),
      schemaVersion: 3,
    };
    delete raw.pendingFixes;
    delete raw.materialCompletion;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    const snapshot = JSON.parse(JSON.stringify(raw));
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.schemaVersion).toBe(WORLD_LEDGER_SCHEMA_VERSION_ACU);
    expect(next.pendingFixes).toEqual([]);
    expect(next.materialCompletion.state).toBe('legacy_unknown');
    expect(raw).toEqual(snapshot);
    expect(raw).not.toHaveProperty('pendingFixes');
    expect(raw).not.toHaveProperty('materialCompletion');
  });

  it('读取 v4 账本时把旧 pending 缺口与缺失完成状态仅在内存归一化为 v5', () => {
    const raw: any = {
      ...buildEmptyWorldSimulationLedger_ACU(),
      schemaVersion: 4,
      pendingFixes: [{
        module: 'dimensions', candidateId: 'candidate:legacy', agentName: 'undercurrent-analyst',
        violations: [{ path: '$.patch.dimensions', message: '旧候选非法' }],
        attempts: 1, firstFailedAtDay: 1, lastError: '旧候选非法',
      }],
    };
    delete raw.materialCompletion;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    const snapshot = JSON.parse(JSON.stringify(raw));
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.schemaVersion).toBe(WORLD_LEDGER_SCHEMA_VERSION_ACU);
    expect(next.materialCompletion.state).toBe('legacy_unknown');
    expect(next.pendingFixes[0]).toMatchObject({
      module: 'dimensions', source: 'transaction_rejected', completion: 'failed',
      acceptedKeys: [], anchor: null, createdAt: 0, updatedAt: 0,
    });
    expect(raw).toEqual(snapshot);
  });

  it('真实 v6 账本升级到 v7 时保留旧字段和 knownFacts，且不修改原始对象', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    raw.actors = [{
      id: 'actor-1', name: '人物', interests: ['家人'], location: '上海', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: ['照顾家庭'],
      constraints: [], informationSources: ['短信'], knownFacts: ['家人已回家'], visibility: 'hidden',
      currentAction: null, longTermAction: null, experiences: [], revision: 1,
    }];
    raw.chronicle = [{ id: 'chronicle-1', at: '第一日', summary: '已有纪要', relatedIds: ['actor-1'], evidenceRefs: [], missedNote: null }];
    const snapshot = structuredClone(raw);
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.schemaVersion).toBe(7);
    expect(next.actors[0].knownFacts).toEqual(snapshot.actors[0].knownFacts);
    expect(next.chronicle).toEqual(snapshot.chronicle);
    expect(next).toMatchObject({ worldEvents: [], facts: [], historyMilestones: [], projection: { anchor: null, deliveries: [] } });
    expect(validateWorldSimulationLedger_ACU(next)).toEqual(next);
    expect(raw).toEqual(snapshot);
  });

  it('大于旧 128 人的 active 账本可加载，容量上限仍拒绝无界输入', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    const template = {
      name: '人物', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
      deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [],
      visibility: 'hidden', currentAction: null, longTermAction: null, shortTermAction: null,
      simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
    };
    ledger.actors = Array.from({ length: 260 }, (_, index) => ({ ...template, id: `actor-${index}` }));
    expect(validateWorldSimulationLedger_ACU(ledger).actors).toHaveLength(260);
    ledger.actors = Array.from({ length: 4097 }, (_, index) => ({ ...template, id: `actor-${index}` }));
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/ledger.actors 容量非法/);
  });

  it('v6 短期事务原样复制并默认 active，死亡或失踪不能自动归档', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete raw[key];
    const action = { text: '整理下周演出合同', expectedDuration: '约五日', startedAtDay: 2,
      startedAt: '第二日早晨', status: 'ongoing', outcome: null };
    raw.actors = [{
      id: 'actor-missing', name: '失踪的策划人', interests: [], location: '', locationRef: null,
      life: 'missing', diedAtDay: null, deathSummary: null, resources: [], goals: ['办成演出'],
      constraints: [], informationSources: [], knownFacts: ['合同已寄出'], visibility: 'hidden',
      currentAction: null, longTermAction: action, experiences: [], revision: 1,
    }];
    const snapshot = structuredClone(raw);
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.actors[0].shortTermAction).toEqual(action);
    expect(next.actors[0].longTermAction).toEqual(action);
    expect(next.actors[0].shortTermAction).not.toBe(action);
    expect(next.actors[0]).toMatchObject({ simulationStatus: 'active', loreRefs: [], knownFacts: ['合同已寄出'] });
    expect(validateWorldSimulationLedger_ACU(next)).toEqual(next);
    expect(raw).toEqual(snapshot);
    raw.actors[0].shortTermAction = null;
    expect(() => validateWorldSimulationLedger_ACU(raw)).toThrow(/v6 ledger.actors\[0\] 存在未知持久化字段/);
  });

  it('完整人物短期别名与旧事务字段反序仍可保存回读；真实差异拒绝，旧短期缺失兼容', async () => {
    const action = { text: '联系主办方', expectedDuration: '两天', startedAtDay: 1,
      startedAt: '第一日上午', status: 'ongoing', outcome: null };
    const reversedAction = { outcome: null, status: 'ongoing', startedAt: '第一日上午',
      startedAtDay: 1, expectedDuration: '两天', text: '联系主办方' };
    const envelope: any = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.ledger.actors = [{
      id: 'actor-1', name: '策划人', interests: ['演出'], location: '上海', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: ['电话'], goals: ['办成演出'],
      constraints: [], informationSources: ['短信'], knownFacts: ['场地待定'], visibility: 'hidden',
      currentAction: null, longTermAction: action, shortTermAction: reversedAction,
      simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
    }];
    const chat: any[] = [{ untouched: true }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const store = new FirstFloorWorldSimulationStore_ACU();
    await store.replaceAtomically(envelope);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(store.read()!.ledger.actors[0]).toMatchObject({ longTermAction: action, shortTermAction: action });
    expect(chat[0]._qrf_world_simulation.ledger.actors[0].shortTermAction).toEqual(action);
    expect(collectWorldSimulationLedgerViolations_ACU(envelope.ledger)).toEqual([]);

    const mismatch = structuredClone(envelope);
    mismatch.ledger.actors[0].shortTermAction.text = '联系其他人';
    await expect(store.replaceAtomically(mismatch)).rejects.toThrow(/shortTermAction 与旧长期事务不一致/);
    expect(collectWorldSimulationLedgerViolations_ACU(mismatch.ledger)).toEqual(expect.arrayContaining([
      expect.stringMatching(/shortTermAction 与旧长期事务不一致/),
    ]));
    expect(saveChat).toHaveBeenCalledOnce();

    const malformed = structuredClone(envelope);
    delete malformed.ledger.actors[0].shortTermAction.status;
    delete malformed.ledger.actors[0].longTermAction.status;
    await expect(store.replaceAtomically(malformed)).rejects.toThrow(/缺少必填字段：status/);
    expect(saveChat).toHaveBeenCalledOnce();

    const legacy = structuredClone(envelope);
    delete legacy.ledger.actors[0].shortTermAction;
    expect(validateWorldSimulationLedger_ACU(legacy.ledger).actors[0].shortTermAction).toBeUndefined();
    await store.replaceAtomically(legacy);
    expect(store.read()!.ledger.actors[0].shortTermAction).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('v7 相互矛盾的短期与旧事务拒绝加载，单独标记 archived 不改变 life', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{
      id: 'actor-1', name: '人物', interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [],
      constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null,
      longTermAction: null, shortTermAction: null, simulationStatus: 'archived', loreRefs: [], experiences: [], revision: 1,
    }];
    expect(validateWorldSimulationLedger_ACU(ledger).actors[0]).toMatchObject({ life: 'alive', simulationStatus: 'archived' });
    ledger.actors[0].shortTermAction = { text: '出行', expectedDuration: '三日', startedAtDay: null, startedAt: '', status: 'ongoing', outcome: null };
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/shortTermAction 与旧长期事务不一致/);
  });

  it('v6 已结束阶段事务迁为去重的内部事实，不改变人物认知或推断历史节点', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    const experience = {
      text: '联系主办方确认场地', expectedDuration: '两天', startedAtDay: 1, startedAt: '第一日',
      endedAtDay: 3, endedAt: '第三日傍晚', status: 'done', outcome: '场地确定',
    };
    raw.actors = [{
      id: 'actor-1', name: '策划人', interests: ['演出'], location: '上海', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: ['举办音乐节'],
      constraints: [], informationSources: ['电话'], knownFacts: ['主办方已回复'], visibility: 'hidden',
      currentAction: null, longTermAction: null, experiences: [experience, structuredClone(experience)], revision: 1,
    }];
    const snapshot = structuredClone(raw);
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.facts).toHaveLength(1);
    expect(next.facts[0]).toMatchObject({
      actorIds: ['actor-1'], temporalKind: 'occurrence', happenedAt: { day: 3, slot: '' },
      projectionPolicy: 'internal', revealState: 'locked',
    });
    expect(next.facts[0].summary).toContain('场地确定');
    expect(next.historyMilestones).toEqual([]);
    expect(next.actors[0].knownFacts).toEqual(['主办方已回复']);
    expect(next.actors[0].experiences).toEqual(snapshot.actors[0].experiences);
    expect(validateWorldSimulationLedger_ACU(raw).facts).toEqual(next.facts);
    expect(validateWorldSimulationLedger_ACU(next)).toEqual(next);
    expect(raw).toEqual(snapshot);
  });

  it('v6 仅把可证明日期、证据和人物关联的主角错过重要纪要迁为内部历史', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete raw[key];
    raw.clock.day = 12;
    raw.actors = [{
      id: 'actor-1', name: '人物', interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
      informationSources: [], knownFacts: ['原有认知'], visibility: 'hidden', currentAction: null,
      longTermAction: null, experiences: [], revision: 1,
    }];
    raw.seeds = [{
      id: 'seed-1', title: '旧引信', status: 'incubating', level: 1, catalyst: '', visibility: 'hidden',
      actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision',
      evidenceRefs: [], retiredReason: null, revision: 1,
    }];
    const important = (id: string, at: string, relatedIds = ['actor-1'], evidenceRefs = ['evidence-1']) => ({
      id, at, summary: `${id} 的重要幕后纪要`, relatedIds, evidenceRefs, missedNote: '主角错过了这件重要幕后事件',
    });
    raw.chronicle = [
      important('chronicle-cn', '第12日'), important('chronicle-d', 'd12'),
      { ...important('chronicle-ordinary', '第12日'), missedNote: null },
      important('chronicle-no-evidence', '第12日', ['actor-1'], []),
      important('chronicle-future', '第13日'), important('chronicle-noncanonical', '第十二日'),
      important('chronicle-trailing-newline', '第12日\n'),
      important('chronicle-mixed', '第12日', ['actor-1', 'seed-1']),
    ];
    const snapshot = structuredClone(raw);

    const next = validateWorldSimulationLedger_ACU(raw);

    expect(next.historyMilestones).toHaveLength(3);
    expect(next.historyMilestones.map(item => item.actorIds)).toEqual([['actor-1'], ['actor-1'], ['actor-1']]);
    expect(next.historyMilestones.map(item => item.worldEventIds)).toEqual([[], [], [expect.stringMatching(/^legacy-seed-/)]]);
    expect(next.historyMilestones.every(item => item.happenedAt.day === 12 && item.happenedAt.slot === ''
      && item.sourceFactIds.length === 0 && item.locationRef === null
      && item.importance === 1 && item.category === '旧重要纪要' && item.visibility === 'internal'
      && item.revision === 0)).toBe(true);
    expect(next.historyMilestones.map(item => item.legacyRefs)).toEqual([
      ['legacy:chronicle:chronicle-cn'], ['legacy:chronicle:chronicle-d'], ['legacy:chronicle:chronicle-mixed'],
    ]);
    expect(next.historyMilestones.every(item => /^legacy-history-[a-f0-9]{32}$/.test(item.id))).toBe(true);
    expect(next.legacyMigration.issues.filter(item => item.source === 'chronicle').map(item => item.sourceId)).toEqual([
      'chronicle-ordinary', 'chronicle-no-evidence', 'chronicle-future', 'chronicle-noncanonical',
      'chronicle-trailing-newline',
    ]);
    expect(next.facts).toEqual([]);
    expect(next.projection).toEqual({ anchor: null, deliveries: [] });
    expect(next.actors[0].knownFacts).toEqual(['原有认知']);
    expect(next.chronicle).toEqual(snapshot.chronicle);
    expect(validateWorldSimulationLedger_ACU(next)).toEqual(next);
    expect(raw).toEqual(snapshot);

    const duplicate = structuredClone(raw);
    duplicate.chronicle.push(structuredClone(duplicate.chronicle[0]));
    expect(() => validateWorldSimulationLedger_ACU(duplicate)).toThrow(/chronicle 存在重复 ID/);
  });

  it('已存 v7 不会因符合旧纪要条件而隐式补迁历史节点', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock.day = 12;
    ledger.actors = [{
      id: 'actor-1', name: '人物', interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
      informationSources: [], knownFacts: [], visibility: 'hidden', currentAction: null, longTermAction: null,
      shortTermAction: null, simulationStatus: 'active', loreRefs: [], experiences: [], revision: 1,
    }];
    ledger.chronicle = [{
      id: 'chronicle-important', at: '第12日', summary: '主角错过的重要幕后事件', relatedIds: ['actor-1'],
      evidenceRefs: ['evidence-1'], missedNote: '已判定为主角错过的重要幕后事件',
    }];
    const snapshot = structuredClone(ledger);

    expect(validateWorldSimulationLedger_ACU(ledger).historyMilestones).toEqual([]);
    expect(ledger).toEqual(snapshot);
  });

  it('v6 未映射纪要与冷归档形成结构化缺口，并保持原始资料', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    raw.dimensions = [{ id: 'dim-1', name: '商业压力', kind: 'pressure', value: 20, trend: 'stable', rationale: '合约待定', evidenceRefs: [], revision: 1 }];
    raw.seeds = [{
      id: 'seed-1', title: '巡演谈判', status: 'incubating', level: 1, catalyst: '签约', visibility: 'hidden',
      actorIds: [], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision',
      evidenceRefs: [], retiredReason: null, revision: 1,
    }];
    raw.chronicle = [{ id: 'chronicle-1', at: '很久以前', summary: '一次重要谈判', relatedIds: [], evidenceRefs: [], missedNote: null }];
    raw.chronicleOverview = [{ fingerprint: 'fp-1', day: 1, oneLine: '旧谈判', archiveRef: 'archive-1' }];
    raw.rumors = [{ id: 'rumor-1', fact: '听说签约了', originDay: 1, earliestRevealDay: 2, channels: ['上海'], relatedActorIds: [], status: 'latent', revealedAtDay: null, revision: 1 }];
    const snapshot = structuredClone(raw);
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.legacyMigration.issues).toEqual([
      { source: 'chronicle', sourceId: 'chronicle-1', reason: 'unparseable_time' },
      { source: 'rumor', sourceId: 'rumor-1', reason: 'missing_evidence' },
      { source: 'chronicleArchive', sourceId: 'archive-1', reason: 'archive_detail_unavailable' },
    ]);
    expect(next.worldEvents).toHaveLength(2);
    expect(next.worldEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '商业压力', state: '合约待定', status: 'active', startedAt: null,
        nextCheck: { day: raw.clock.day, slot: raw.clock.slot, reason: '旧资料迁移后复核' },
        legacy: { source: 'dimension', sourceId: 'dim-1', payload: snapshot.dimensions[0] } }),
      expect.objectContaining({ title: '巡演谈判', state: '签约', status: 'scheduled', startedAt: null,
        nextCheck: { day: raw.clock.day, slot: raw.clock.slot, reason: '旧资料迁移后复核' },
        legacy: { source: 'seed', sourceId: 'seed-1', payload: snapshot.seeds[0] } }),
    ]));
    expect(next.historyMilestones).toEqual([]);
    expect(next.facts).toEqual([]);
    expect(next.dimensions).toEqual(snapshot.dimensions);
    expect(next.seeds).toEqual(snapshot.seeds);
    expect(next.chronicle).toEqual(snapshot.chronicle);
    expect(validateWorldSimulationLedger_ACU(next).legacyMigration).toEqual(next.legacyMigration);
    expect(raw).toEqual(snapshot);
  });

  it('v6 dimensions、全部 seed 状态和多领域同 ID 均迁为可调度世界事件，原 payload 无损保留', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete raw[key];
    raw.clock = { day: 9, slot: '傍晚', storyTime: '第九日傍晚', precision: 'exact', evidenceRefs: ['clock-evidence'] };
    raw.actors = [{
      id: 'shared', name: '人物', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
      deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: ['既有认知'],
      visibility: 'hidden', currentAction: null, longTermAction: null, experiences: [], revision: 1,
    }];
    raw.dimensions = [
      { id: 'shared', name: '压力局势', kind: 'pressure', value: 80, trend: 'rising', rationale: '债务逼近', evidenceRefs: ['dim-e'], revision: 3 },
      { id: 'growth', name: '增长局势', kind: 'growth', value: 20, trend: 'falling', rationale: '', evidenceRefs: [], revision: 4 },
    ];
    const seed = (id: string, status: string, expiresAtDay: number | null, location: any) => ({
      id, title: `${status} 引信`, status, level: 8, catalyst: `${status} 局势`, visibility: 'hidden', actorIds: ['shared'],
      location, expiresAtDay, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [`${status}-e`],
      retiredReason: status === 'retired' ? '旧线退役' : null, revision: 6,
    });
    raw.seeds = [
      seed('established', 'established', null, null), seed('incubating', 'incubating', 12, { region: '上海', place: '码头' }),
      seed('active', 'active', null, { region: '北京' }), seed('converging', 'converging', 15, null),
      seed('resolved', 'resolved', null, null), seed('retired', 'retired', null, null),
      seed('shared', 'active', null, null),
    ];
    const snapshot = structuredClone(raw);
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.worldEvents).toHaveLength(9);
    expect(next.worldEvents.filter(event => event.id.startsWith('legacy-dimension-'))).toHaveLength(2);
    expect(next.worldEvents.filter(event => event.id.startsWith('legacy-seed-'))).toHaveLength(7);
    expect(new Set(next.worldEvents.map(event => event.id)).size).toBe(9);
    expect(next.worldEvents.find(event => event.title === '压力局势')).toMatchObject({
      state: '债务逼近', status: 'active', startedAt: null, nextCheck: { day: 9, slot: '傍晚', reason: '旧资料迁移后复核' },
      evidenceRefs: ['dim-e'], revision: 3, legacy: { source: 'dimension', sourceId: 'shared', payload: snapshot.dimensions[0] },
    });
    expect(next.worldEvents.find(event => event.title === '增长局势')).toMatchObject({ state: '旧局势待复核', status: 'active' });
    for (const [status, expected] of Object.entries({ established: 'scheduled', incubating: 'scheduled', active: 'active', converging: 'active', resolved: 'resolved', retired: 'cancelled' })) {
      const event = next.worldEvents.find(row => row.title === `${status} 引信`)!;
      expect(event.status).toBe(expected);
      expect(event.startedAt).toBeNull();
      expect(event.nextCheck).toEqual(['resolved', 'retired'].includes(status) ? null : { day: 9, slot: '傍晚', reason: '旧资料迁移后复核' });
      expect(event.legacy).toEqual({ source: 'seed', sourceId: status, payload: snapshot.seeds.find((row: any) => row.id === status) });
    }
    expect(next.worldEvents.find(event => event.title === 'incubating 引信')).toMatchObject({ deadline: { day: 12, slot: '' }, locationRefs: [{ region: '上海', place: '码头' }] });
    expect(next.worldEvents.find(event => event.title === 'active 引信')).toMatchObject({ deadline: null, locationRefs: [{ region: '北京' }] });
    expect(next.actors[0].knownFacts).toEqual(['既有认知']);
    expect(next.facts).toEqual([]);
    expect(next.legacyMigration.issues.filter(issue => issue.source === 'dimension' || issue.source === 'seed')).toEqual([]);
    expect(validateWorldSimulationLedger_ACU(next)).toEqual(next);
    expect(raw).toEqual(snapshot);
  });

  it('v6 重要纪要映射真实人物和事件、混合及未知关联保留追溯与复核', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete raw[key];
    raw.clock.day = 4;
    raw.actors = [{
      id: 'shared', name: '人物', interests: [], location: '', locationRef: null, life: 'alive', diedAtDay: null,
      deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
      currentAction: null, longTermAction: null, experiences: [], revision: 1,
    }];
    raw.dimensions = [{ id: 'shared', name: '共同局势', kind: 'pressure', value: 1, trend: 'stable', rationale: '持续', evidenceRefs: [], revision: 1 }];
    raw.seeds = [{ id: 'seed', title: '真实引信', status: 'active', level: 1, catalyst: '持续', visibility: 'hidden', actorIds: ['shared'], location: null, expiresAtDay: null, missedOutcome: null, exposePolicy: 'on_collision', evidenceRefs: [], retiredReason: null, revision: 1 }];
    raw.chronicle = [
      { id: 'mixed', at: '第4日', summary: '人物和引信共同推进', relatedIds: ['shared', 'seed'], evidenceRefs: ['e-1'], missedNote: '重要' },
    ];
    const next = validateWorldSimulationLedger_ACU(raw);
    const mixed = next.historyMilestones.find(row => row.summary === '人物和引信共同推进')!;
    expect(mixed.actorIds).toEqual(['shared']);
    expect(mixed.worldEventIds).toHaveLength(2);
    expect(mixed.legacyRefs).toEqual(expect.arrayContaining(['legacy:chronicle:mixed', 'legacy:chronicle:mixed:ambiguous-related:shared']));
    expect(next.legacyMigration.issues.filter(issue => issue.source === 'chronicle').map(issue => issue.sourceId)).toEqual(['mixed']);
    expect(next.facts).toEqual([]);
    const eventOnly = structuredClone(raw);
    eventOnly.chronicle = [{ id: 'event-only', at: '第4日', summary: '引信进入重要阶段', relatedIds: ['seed'], evidenceRefs: ['e-2'], missedNote: '主角错过重要进展' }];
    const eventHistory = validateWorldSimulationLedger_ACU(eventOnly);
    expect(eventHistory.historyMilestones).toMatchObject([{ actorIds: [], worldEventIds: [
      eventHistory.worldEvents.find(event => event.legacy?.sourceId === 'seed')!.id,
    ], legacyRefs: ['legacy:chronicle:event-only'] }]);
    expect(eventHistory.legacyMigration.issues).toEqual([]);
    const unknown = structuredClone(raw);
    unknown.chronicle = [{ id: 'unknown', at: '第4日', summary: '带未知关联', relatedIds: ['seed', 'unknown-id'], evidenceRefs: ['e-2'], missedNote: '重要' }];
    expect(() => validateWorldSimulationLedger_ACU(unknown)).toThrow(/chronicle\[0\] 引用了不存在的对象/);
  });

  it('v6 不同人物同一阶段事务分别留事实，放弃事务不假定成功结果', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    const experience = {
      text: '联系主办方', expectedDuration: '两天', startedAtDay: null, startedAt: '',
      endedAtDay: 3, endedAt: '第三日傍晚', status: 'abandoned', outcome: null,
    };
    raw.actors = ['actor-1', 'actor-2'].map(id => ({
      id, name: id, interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [],
      constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden',
      currentAction: null, longTermAction: null, experiences: [structuredClone(experience)], revision: 1,
    }));
    raw.guidance.signals = [{ text: '可以借此推动剧情', voice: 'ambient' }];
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.facts).toHaveLength(2);
    expect(new Set(next.facts.map(fact => fact.id)).size).toBe(2);
    expect(next.facts.map(fact => fact.actorIds)).toEqual([['actor-1'], ['actor-2']]);
    expect(next.facts.every(fact => fact.summary === '放弃阶段事务：联系主办方')).toBe(true);
    expect(next.facts.every(fact => fact.projectionPolicy === 'internal')).toBe(true);
    expect(next.historyMilestones).toEqual([]);
    expect(next.projection.deliveries).toEqual([]);
  });

  it('v6 经历损坏时拒绝迁移且不改写原对象', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    delete raw.worldEvents;
    delete raw.facts;
    delete raw.historyMilestones;
    delete raw.projection;
    delete raw.legacyMigration;
    raw.actors = [{
      id: 'actor-1', name: '人物', interests: [], location: '', locationRef: null,
      life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [],
      constraints: [], informationSources: [], knownFacts: ['原有认知'], visibility: 'hidden',
      currentAction: null, longTermAction: null, experiences: [{ text: '未结算事务', status: 'ongoing', endedAtDay: 2 }], revision: 1,
    }];
    const snapshot = structuredClone(raw);
    expect(() => validateWorldSimulationLedger_ACU(raw)).toThrow(WorldSimulationValidationError_ACU);
    expect(raw).toEqual(snapshot);
  });

  it('v6 携带 v7 专属字段与损坏的 v7 领域数据均拒绝加载', () => {
    const legacy: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    legacy.schemaVersion = 6;
    legacy.worldEvents = [{ id: 'unexpected' }];
    expect(() => validateWorldSimulationLedger_ACU(legacy)).toThrow(/v6 ledger 存在未知持久化字段/);
    legacy.worldEvents = undefined;
    delete legacy.worldEvents;
    for (const key of ['facts', 'historyMilestones', 'projection', 'legacyMigration']) delete legacy[key];
    legacy.historyArchive = [];
    expect(() => validateWorldSimulationLedger_ACU(legacy)).toThrow(/v6 ledger 存在未知持久化字段：historyArchive/);
    const malformed: any = buildEmptyWorldSimulationLedger_ACU();
    malformed.facts = [{ id: 'fact-1' }];
    expect(() => validateWorldSimulationLedger_ACU(malformed)).toThrow(/缺少必填字段/);
    const missing: any = buildEmptyWorldSimulationLedger_ACU();
    delete missing.projection;
    expect(() => validateWorldSimulationLedger_ACU(missing)).toThrow(/缺少必填字段/);
  });

  it('冷归档轮次元数据仅接受安全整数和本账本冷事实 ID，允许旧事实未盖戳', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    const cold = { id: 'cold-1', summary: '旧冷事实', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' },
      validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 0 };
    ledger.factArchive = [cold, { ...cold, id: 'cold-2' }];
    const snapshot = structuredClone(ledger);
    expect(validateWorldSimulationLedger_ACU(ledger).factArchiveRetention).toBeUndefined();
    expect(ledger).toEqual(snapshot);
    ledger.factArchiveRetention = { completedRounds: 12, enteredAtRound: { 'cold-1': 0 } };
    expect(validateWorldSimulationLedger_ACU(ledger).factArchiveRetention).toEqual(ledger.factArchiveRetention);
    for (const bad of [
      { completedRounds: -1, enteredAtRound: {} },
      { completedRounds: 1.5, enteredAtRound: {} },
      { completedRounds: Number.MAX_SAFE_INTEGER + 1, enteredAtRound: {} },
      { completedRounds: 12, enteredAtRound: { 'cold-1': -1 } },
      { completedRounds: 12, enteredAtRound: { 'cold-1': 13 } },
      { completedRounds: 12, enteredAtRound: { 'cold-1': 1.5 } },
      { completedRounds: 12, enteredAtRound: { missing: 1 } },
      { completedRounds: 12, enteredAtRound: [] },
      { completedRounds: 12, enteredAtRound: new Date() },
      { completedRounds: 12, enteredAtRound: {}, extra: true },
    ]) {
      ledger.factArchiveRetention = bad;
      expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(WorldSimulationValidationError_ACU);
      expect(collectWorldSimulationLedgerViolations_ACU(ledger)).toEqual(expect.arrayContaining([expect.stringMatching(/factArchiveRetention/)]));
    }
    ledger.factArchiveRetention = { completedRounds: 13, enteredAtRound: {} };
    ledger.factArchive = [];
    expect(validateWorldSimulationLedger_ACU(ledger).factArchiveRetention).toEqual(ledger.factArchiveRetention);
  });

  it('旧账本读取不补轮次元数据，显式轮次可经首楼更新保存并回读', async () => {
    const chat: any[] = [{ _qrf_world_simulation: buildDefaultWorldSimulationEnvelope_ACU() }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const store = new FirstFloorWorldSimulationStore_ACU();
    expect(store.read()!.ledger).not.toHaveProperty('factArchiveRetention');
    expect(chat[0]._qrf_world_simulation.ledger).not.toHaveProperty('factArchiveRetention');
    expect(saveChat).not.toHaveBeenCalled();
    await store.updateAtomically(current => ({ ...current!, ledger: {
      ...current!.ledger, factArchive: [], factArchiveRetention: { completedRounds: 11, enteredAtRound: {} },
    } }));
    expect(store.read()!.ledger.factArchiveRetention).toEqual({ completedRounds: 11, enteredAtRound: {} });
    expect(chat[0]._qrf_world_simulation.ledger.factArchiveRetention).toEqual({ completedRounds: 11, enteredAtRound: {} });
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('v6 迁移拒绝携带冷归档轮次元数据，不隐式升版本', () => {
    const raw: any = structuredClone(buildEmptyWorldSimulationLedger_ACU());
    raw.schemaVersion = 6;
    for (const key of ['worldEvents', 'facts', 'historyMilestones', 'projection', 'legacyMigration']) delete raw[key];
    raw.factArchiveRetention = { completedRounds: 1, enteredAtRound: {} };
    expect(() => validateWorldSimulationLedger_ACU(raw)).toThrow(/v6 ledger 存在未知持久化字段：factArchiveRetention/);
  });

  it('v7 已确认事实与纪要分层保存，投影只引用已解锁且可投送的事实', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [{
      id: 'fact-1', summary: '附近展台已经搭起', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '上午' }, validFrom: null, validUntil: null,
      locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
      projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    }];
    ledger.historyMilestones = [{
      id: 'history-1', summary: '活动筹备完成', happenedAt: { day: 1, slot: '上午' },
      actorIds: [], worldEventIds: [], locationRef: { region: '上海', place: '广场' },
      sourceFactIds: ['fact-1'], importance: 2, category: '重大事件', visibility: 'internal',
      revision: 1, legacyRefs: [],
    }];
    ledger.projection = { anchor: 'scene-1', deliveries: [{ factId: 'fact-1', status: 'delivered', attempts: 1 }] };
    const next = validateWorldSimulationLedger_ACU(ledger);
    expect(next.facts).toHaveLength(1);
    expect(next.historyMilestones[0].sourceFactIds).toEqual(['fact-1']);
    expect(next.projection.deliveries[0].factId).toBe('fact-1');
    expect(next.facts[0].locationRef).toEqual({ region: '上海', place: '广场' });
  });

  it('投送记录必须具备锚点及合法尝试次数，不能自报无界重投', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [{ id: 'fact-1', summary: '广场搭台', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
      locationRef: { region: '上海', place: '广场' }, actorIds: [], worldEventIds: [],
      projectionPolicy: 'scene', revealState: 'unlocked', revealGate: null, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    ledger.projection = { anchor: null, deliveries: [{ factId: 'fact-1', status: 'delivered', attempts: 1 }] };
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/必须有非空锚点/);
    ledger.projection.anchor = 'scene-1';
    ledger.projection.deliveries[0].attempts = 0;
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/attempts 必须/);
    ledger.projection.deliveries[0].attempts = 3;
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/attempts 必须/);
  });

  it('历史纪要冷层沿用完整节点校验，跨层重复与悬空引用均拒绝，旧对象不变', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    const milestone = {
      id: 'history-1', summary: '冷层历史', happenedAt: { day: 1, slot: '' }, actorIds: [], worldEventIds: [],
      locationRef: null, sourceFactIds: [], importance: 1, category: '事件', visibility: 'internal', revision: 1, legacyRefs: [],
    };
    ledger.historyArchive = [milestone];
    const snapshot = structuredClone(ledger);
    expect(validateWorldSimulationLedger_ACU(ledger).historyArchive).toEqual([milestone]);
    expect(ledger).toEqual(snapshot);

    ledger.historyMilestones = [milestone];
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/重复 ID/);
    ledger.historyMilestones = [];
    ledger.historyArchive[0].actorIds = ['absent'];
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/不存在的 actor/);
    ledger.historyArchive[0].actorIds = [];
    ledger.historyArchive[0].sourceFactIds = ['missing-fact'];
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/不存在的 fact/);
  });

  it('v7 正文标记独立保存、旧记录保持缺失，禁止损坏的正文引用', async () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const old = { id: 'old', summary: '旧历史摘要', happenedAt: { day: 1, slot: '' }, actorIds: [],
      worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2, category: '历史',
      visibility: 'internal' as const, revision: 1, legacyRefs: [] };
    const marker = { status: 'recorded' as const, recordedAt: { day: 3, slot: '夜' },
      anchorDigest: 'a'.repeat(64), deliveryQuote: '已投送的重要历史', evidenceQuote: '正文确实写出此事' };
    envelope.ledger.historyMilestones = [old, { ...old, id: 'marked', summary: '已记载摘要', narrativeRecord: marker }];
    const snapshot = structuredClone(envelope);
    const chat: any[] = [{ _qrf_world_simulation: envelope }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const store = new FirstFloorWorldSimulationStore_ACU();
    expect(store.read()!.ledger.historyMilestones[0]).not.toHaveProperty('narrativeRecord');
    expect(chat[0]._qrf_world_simulation).toEqual(snapshot);
    expect(saveChat).not.toHaveBeenCalled();
    await store.replaceAtomically(snapshot);
    expect(store.read()!.ledger.historyMilestones[1]).toMatchObject({ summary: '已记载摘要', narrativeRecord: marker });
    expect(chat[0]._qrf_world_simulation.ledger.historyMilestones[0]).not.toHaveProperty('narrativeRecord');
    expect(snapshot.ledger).toEqual(envelope.ledger);

    const invalid: any = structuredClone(snapshot.ledger);
    const row = invalid.historyMilestones[1];
    for (const value of [null, { ...marker, status: 'delivered' }, { ...marker, recordedAt: { day: 0, slot: '' } },
      { ...marker, anchorDigest: 'A'.repeat(64) }, { ...marker, deliveryQuote: '' },
      { ...marker, evidenceQuote: '  ' }, { ...marker, extra: true },
      { ...marker, recordedAt: { day: 3, slot: '', extra: true } }]) {
      row.narrativeRecord = value;
      expect(() => validateWorldSimulationLedger_ACU(invalid)).toThrow(WorldSimulationValidationError_ACU);
    }
    row.narrativeRecord = undefined;
    expect(() => validateWorldSimulationLedger_ACU(invalid)).toThrow(WorldSimulationValidationError_ACU);
  });

  it('正文记录直接进冷层，旧小账本不变；冷热重复归一不复热且摘要来源不变', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const history = (id: string, day: number) => ({ id, summary: `摘要-${id}`, happenedAt: { day, slot: '' },
      actorIds: [], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 2,
      category: '历史', visibility: 'internal' as const, revision: 1, legacyRefs: [] });
    const marker = { status: 'recorded' as const, recordedAt: { day: 40, slot: '' },
      anchorDigest: 'b'.repeat(64), deliveryQuote: '先前投送引用', evidenceQuote: '正文写出的引用' };
    ledger.historyMilestones = [history('only', 40)];
    expect(normalizeWorldHistoryArchive_ACU(ledger)).toBe(ledger);
    ledger.historyMilestones = [{ ...history('marked', 40), narrativeRecord: marker }];
    const single = normalizeWorldHistoryArchive_ACU(ledger);
    expect(single.historyMilestones).toEqual([]);
    expect(single.historyArchive).toEqual(ledger.historyMilestones);
    expect(single.historyArchive?.[0].summary).toBe('摘要-marked');
    expect(normalizeWorldHistoryArchive_ACU(single).historyArchive).toEqual(single.historyArchive);

    ledger.historyMilestones = [history('recent', 39), { ...history('marked', 40), narrativeRecord: marker },
      ...Array.from({ length: WORLD_CHRONICLE_HOT_WINDOW_ACU }, (_, i) => history(`older-${i}`, 38 - i))];
    const first = normalizeWorldHistoryArchive_ACU(ledger);
    expect(first.historyMilestones).toHaveLength(WORLD_CHRONICLE_HOT_WINDOW_ACU);
    expect(first.historyMilestones.some(row => row.id === 'marked')).toBe(false);
    expect(first.historyArchive?.map(row => row.id)).toEqual(['marked', `older-${WORLD_CHRONICLE_HOT_WINDOW_ACU - 1}`]);
    const second = normalizeWorldHistoryArchive_ACU({ ...first, historyMilestones: first.historyMilestones.slice(1) });
    expect(second.historyArchive?.some(row => row.id === 'marked')).toBe(true);
    expect(second.historyMilestones.some(row => row.id === 'marked')).toBe(false);
    expect(second.historyArchive?.find(row => row.id === 'marked')?.summary).toBe('摘要-marked');
    expect([...second.historyMilestones, ...(second.historyArchive ?? [])].every(row => row.summary === `摘要-${row.id}`)).toBe(true);
    expect(ledger.historyArchive).toBeUndefined();
  });

  it('违规收集器单独报告损坏的历史冷层结构', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.historyArchive = [{ id: 'cold-only' }];
    expect(collectWorldSimulationLedgerViolations_ACU(ledger)).toEqual(expect.arrayContaining([
      expect.stringMatching(/ledger\.historyMilestones\[0\].*缺少必填字段/),
    ]));
  });

  it('违规收集器报告冷事实的真实路径，并拒绝跨层重复 ID', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.factArchive = [{ id: 'cold-only' }];
    expect(collectWorldSimulationLedgerViolations_ACU(ledger)).toEqual(expect.arrayContaining([
      expect.stringMatching(/ledger\.factArchive\[0\].*缺少必填字段/),
    ]));
    const fact = {
      id: 'same', summary: '同一事实', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '' }, validFrom: null,
      validUntil: null, locationRef: null, actorIds: [], worldEventIds: [], projectionPolicy: 'internal', revealState: 'locked',
      revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    };
    ledger.factArchive = [fact];
    ledger.facts = [fact];
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/factArchive 与 facts 存在重复 ID/);
  });

  it('v7 领域验证禁止悬空引用、锁定事实投影和错误时间形态', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    const fact = {
      id: 'fact-1', summary: '已确定的事实', temporalKind: 'occurrence', happenedAt: { day: 1, slot: '上午' },
      validFrom: null, validUntil: null, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'gated', revealState: 'locked', revealGate: { condition: '当面询问' }, nextCheck: null,
      sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    };
    ledger.facts = [fact];
    ledger.projection = { anchor: 'scene-1', deliveries: [{ factId: 'fact-1', status: 'delivered', attempts: 1 }] };
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/不可投送/);
    ledger.projection.deliveries = [];
    ledger.facts[0].worldEventIds = ['absent'];
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/不存在的 event/);
    ledger.facts[0].worldEventIds = [];
    ledger.facts[0].happenedAt = null;
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/时间形态非法/);
  });

  it('pendingFixes 非数组或条目缺键 fail-closed', () => {
    const notArray: any = buildEmptyWorldSimulationLedger_ACU();
    notArray.pendingFixes = { module: 'clock' };
    expect(() => validateWorldSimulationLedger_ACU(notArray)).toThrow(/pendingFixes 必须是数组/);
    const missing: any = buildEmptyWorldSimulationLedger_ACU();
    missing.pendingFixes = [{ module: 'clock', candidateId: 'c1', agentName: 'timekeeper' }];
    expect(() => validateWorldSimulationLedger_ACU(missing)).toThrow(/缺少必填字段/);
  });

  it('chronicleOverview 超过 512 行 fail-closed', () => {
    const ledger: any = buildEmptyWorldSimulationLedger_ACU();
    ledger.chronicleOverview = Array.from({ length: WORLD_CHRONICLE_OVERVIEW_CAP_ACU + 1 }, (_, index) => ({
      fingerprint: `fp${index}`,
      day: 1,
      oneLine: `事件${index}`,
      archiveRef: `arc-${index}`,
    }));
    expect(() => validateWorldSimulationLedger_ACU(ledger)).toThrow(/chronicleOverview 容量非法/);
  });

  it('chronicleOverview 行缺字段或未知字段 fail-closed', () => {
    const missing: any = buildEmptyWorldSimulationLedger_ACU();
    missing.chronicleOverview = [{ fingerprint: 'fp', day: 1, oneLine: '一行' }];
    expect(() => validateWorldSimulationLedger_ACU(missing)).toThrow(/缺少必填字段/);
    const extra: any = buildEmptyWorldSimulationLedger_ACU();
    extra.chronicleOverview = [{ fingerprint: 'fp', day: 1, oneLine: '一行', archiveRef: 'arc-1', extra: true }];
    expect(() => validateWorldSimulationLedger_ACU(extra)).toThrow(/未知持久化字段/);
  });

  it('无法从 elapsed/storyTime 解析 day 时回退为 1', () => {
    const next = validateWorldSimulationLedger_ACU({
      schemaVersion: 1,
      revision: 0,
      clock: { storyTime: '未知', elapsed: '很久以前', precision: 'unknown', evidenceRefs: [] },
      dimensions: [],
      seeds: [],
      actors: [],
      chronicle: [],
      guidance: { signals: [], excludedFacts: [], evidenceRefs: [] },
    });
    expect(next.clock.day).toBe(1);
  });

  it('dynamics 非法字段逐项回退默认值', () => {
    const envelope: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    envelope.settings.dynamics = { rumorTTLDays: -1, maxClockAdvanceDays: 7, collisionEnforcement: 'nope', missedSweepEnabled: true };
    const next = validateWorldSimulationEnvelope_ACU(envelope);
    expect(next.settings.dynamics).toEqual({
      rumorTTLDays: 30,
      maxClockAdvanceDays: 7,
      collisionEnforcement: 'strict',
      missedSweepEnabled: true,
    });
  });

  it('缺 workflow 时补默认编年阈值，旧自动修复开关读入后不再保留', () => {
    const missing: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    delete missing.settings.workflow;
    expect(validateWorldSimulationEnvelope_ACU(missing).settings.workflow).toEqual({
      chroniclerHotThreshold: 32,
    });
    const invalid: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    invalid.settings.workflow = { autoFixEnabled: false, chroniclerHotThreshold: 0 };
    expect(validateWorldSimulationEnvelope_ACU(invalid).settings.workflow).toEqual({
      chroniclerHotThreshold: 32,
    });
  });
});

describe('world simulation anchor rescan', () => {
  const saveChat = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    saveChat.mockClear();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('楼层位移后重扫定位当前下标，分桶读写仍命中原 entry', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const staleAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, { token: 'kept' }, chat);

    chat.splice(1, 0, { is_user: true, mes: 'inserted-floor' });

    expect(resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat).messageIndex).toBe(2);
    expect(readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, raw => raw as { token: string }, chat))
      .toEqual({ token: 'kept' });

    await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, { token: 'updated' }, chat);
    expect(readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, raw => raw as { token: string }, chat))
      .toEqual({ token: 'updated' });
    expect(chat[2][WORLD_SIMULATION_STATE_FIELD_ACU]).toBeDefined();
    expect(chat[1][WORLD_SIMULATION_STATE_FIELD_ACU]).toBeUndefined();
  });

  it('插件改写正文或替换同身份对象后仍读取旧摘要桶，保存时归并楼层桶', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const staleAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, { token: 'kept' }, chat);

    const key = buildWorldSimulationBucketKey_ACU(staleAnchor);
    const legacyKey = sha256HexSync_ACU([staleAnchor.chatIdentity, staleAnchor.messageKey, staleAnchor.swipeId, staleAnchor.contentDigest].join('\n'));
    const entry = chat[1][WORLD_SIMULATION_STATE_FIELD_ACU].entries[key];
    const legacy = { schemaVersion: 1, entries: { [legacyKey]: entry } };
    chat[1][WORLD_SIMULATION_STATE_FIELD_ACU] = legacy;
    chat[1] = { ...chat[1], mes: 'anchor-body-edited' };

    const current = resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat);
    expect(current.contentDigest).not.toBe(staleAnchor.contentDigest);
    expect(buildWorldSimulationBucketKey_ACU(current)).toBe(key);
    expect(readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, raw => raw, chat))
      .toEqual({ token: 'kept' });
    expect(chat[1][WORLD_SIMULATION_STATE_FIELD_ACU]).toBe(legacy);
    await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, { token: 'updated' }, chat);
    expect(Object.keys(chat[1][WORLD_SIMULATION_STATE_FIELD_ACU].entries)).toEqual([key]);
    expect(readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, current, raw => raw, chat))
      .toEqual({ token: 'updated' });

    chat[1].swipe_id = 1;
    expect(() => resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat)).toThrow(WorldSimulationValidationError_ACU);
    chat[1].swipe_id = 0;
    chat[1].message_id = 21;
    expect(() => resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat)).toThrow(WorldSimulationValidationError_ACU);
    chat[1].message_id = 20;
    chat.push({ ...chat[1] });
    expect(() => resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat)).toThrow(/无法唯一定位/);
  });

  it('归档桶随 swipe 分桶，切换 swipe 后读不到旧条目', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0, swipes: ['anchor-body', 'other-swipe'] },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const swipe0 = resolveWorldSimulationAnchor_ACU(1, chat);
    const snapshot = buildEmptyWorldChronicleArchiveSnapshot_ACU();
    snapshot.records['arc-1'] = {
      archiveRef: 'arc-1',
      day: 3,
      summary: '北岭塌方已归档',
      fingerprints: ['fp-1'],
      relatedIds: ['seed-1'],
      sourceChronicleIds: ['ch-1'],
    };
    await writeWorldSimulationBucketEntry_ACU(
      WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
      swipe0,
      validateWorldSimulationChronicleArchiveSnapshot_ACU(snapshot),
      chat,
    );
    expect(readWorldSimulationBucketEntry_ACU(
      WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
      swipe0,
      validateWorldSimulationChronicleArchiveSnapshot_ACU,
      chat,
    )?.records['arc-1']?.summary).toBe('北岭塌方已归档');

    chat[1].swipe_id = 1;
    chat[1].mes = 'other-swipe';
    const swipe1 = resolveWorldSimulationAnchor_ACU(1, chat);
    expect(readWorldSimulationBucketEntry_ACU(
      WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
      swipe1,
      validateWorldSimulationChronicleArchiveSnapshot_ACU,
      chat,
    )).toBeNull();
  });
});

describe('world simulation API preset reference cascade helpers', () => {
  it('rename 同步改写 fixed 与匹配的 agent presetName', () => {
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.apiPresetMode = 'fixed';
    settings.fixedApiPresetName = 'old';
    settings.agentApiPresets = {
      planner: { mode: 'fixed', presetName: 'old' },
      reviewer: { mode: 'current', presetName: 'old' },
      narrator: { mode: 'fixed', presetName: 'keep' },
    };
    const next = renameApiPresetReferencesInWorldSimulationSettings_ACU(settings, 'old', 'new');
    expect(next).not.toBe(settings);
    expect(next.fixedApiPresetName).toBe('new');
    expect(next.agentApiPresets.planner.presetName).toBe('new');
    expect(next.agentApiPresets.reviewer).toEqual({ mode: 'current', presetName: 'new' });
    expect(next.agentApiPresets.narrator).toEqual({ mode: 'fixed', presetName: 'keep' });
  });

  it('clear 置空引用并回退 current；非 fixed 渠道只清 presetName', () => {
    const settings = buildDefaultWorldSimulationSettings_ACU();
    settings.apiPresetMode = 'fixed';
    settings.fixedApiPresetName = 'old';
    settings.agentApiPresets = {
      planner: { mode: 'fixed', presetName: 'old' },
      reviewer: { mode: 'current', presetName: 'old' },
      narrator: { mode: 'fixed', presetName: 'keep' },
    };
    const next = clearApiPresetReferencesInWorldSimulationSettings_ACU(settings, 'old');
    expect(next.apiPresetMode).toBe('current');
    expect(next.fixedApiPresetName).toBe('');
    expect(next.agentApiPresets.planner).toEqual({ mode: 'current', presetName: '' });
    expect(next.agentApiPresets.reviewer).toEqual({ mode: 'current', presetName: '' });
    expect(next.agentApiPresets.narrator).toEqual({ mode: 'fixed', presetName: 'keep' });
  });
});
