import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultContinuationSettings_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V17_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V27_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V40_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V50_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V52_ACU,
} from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, type ContinuationEnvelope_ACU } from '../../../src/service/continuation/model';
import {
  FirstFloorContinuationStore_ACU,
  buildMigratedContinuationEnvelope_ACU,
  buildLegacyContinuationMigration_ACU,
  stripLegacyContinuationLoopFields_ACU,
  renameApiPresetReferencesInContinuationSettings_ACU,
  clearApiPresetReferencesInContinuationSettings_ACU,
} from '../../../src/service/continuation/continuation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function buildEnvelope_ACU(): ContinuationEnvelope_ACU {
  return { schemaVersion: 1, settings: buildDefaultContinuationSettings_ACU(), activeTask: null };
}

function buildRunningEnvelope_ACU(): ContinuationEnvelope_ACU {
  const envelope = buildEnvelope_ACU();
  envelope.activeTask = {
    taskId: 'task-1',
    originInstruction: '推进剧情',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    runStartedAt: 1,
    deadlineAt: null,
    runStageCount: 1,
    activeStageId: 'stage-1',
    stages: [{
      stageId: 'stage-1',
      stageNumber: 1,
      status: 'running',
      chronicleStartCount: 0,
      chronicleEndCount: null,
      chronicleAddedCount: null,
      chronicleRange: null,
      activeRevision: 1,
      revisions: [{
        revision: 1,
        createdAt: 1,
        reason: 'initial',
        replanInstruction: '',
        frozen: true,
        outline: {
          schemaVersion: 1,
          title: '阶段',
          goal: '目标',
          totalTurns: 6,
          nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }],
        },
      }],
      activeNodeIndex: 0,
      activeTurnIndex: 0,
      completedTurns: 0,
    }],
    timeline: [],
    stopReason: null,
    lastError: null,
  };
  return envelope;
}

function expectCode_ACU(action: () => Promise<unknown>, code: string) {
  return expect(action()).rejects.toMatchObject({ error: { code } } satisfies Partial<ContinuationValidationError_ACU>);
}

describe('FirstFloorContinuationStore_ACU', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(undefined);
  });

  it('persists only the first-floor continuation field after host save', async () => {
    const chat: any[] = [{}];
    const chatMetadata = { untouched: true };
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatMetadata, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const store = new FirstFloorContinuationStore_ACU();
    const candidate = buildEnvelope_ACU();
    await store.replaceAtomically(candidate);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(chat[0]._qrf_continuation).toEqual(candidate);
    expect(chatMetadata).toEqual({ untouched: true });
    expect(store.read()).toEqual(candidate);
  });

  it('rejects corrupted raw snapshots without replacing them', () => {
    const chat: any[] = [{ _qrf_continuation: { schemaVersion: 1, settings: undefined, activeTask: null } }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const store = new FirstFloorContinuationStore_ACU();
    expect(() => store.read()).toThrow(ContinuationValidationError_ACU);
    try { store.read(); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_ENVELOPE_INVALID');
    }
    expect(chat[0]._qrf_continuation.settings).toBeUndefined();
  });

  it('fails closed on unknown persisted task states', () => {
    const invalid = buildRunningEnvelope_ACU() as any;
    invalid.activeTask.status = 'unknown_running_state';
    const chat: any[] = [{ _qrf_continuation: invalid }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
    try { new FirstFloorContinuationStore_ACU().read(); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_ENVELOPE_INVALID');
    }
    expect(chat[0]._qrf_continuation.activeTask.status).toBe('unknown_running_state');
  });

  it('normalizes a missing stage budget baseline from schema v1 and rejects invalid explicit baselines', async () => {
    const legacy = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: legacy }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const store = new FirstFloorContinuationStore_ACU();
    const restored = store.readPersisted()!;
    expect(restored.activeTask?.stageBudgetBaseCount).toBe(0);
    expect(chat[0]._qrf_continuation.activeTask.stageBudgetBaseCount).toBeUndefined();

    await store.replaceAtomically(restored, { chatIdentity: 'chat-a' });
    expect(saveChat).toHaveBeenCalledOnce();
    expect(chat[0]._qrf_continuation.activeTask.stageBudgetBaseCount).toBe(0);

    for (const stageBudgetBaseCount of [-1, 0.5, 2]) {
      const invalid = buildRunningEnvelope_ACU() as any;
      invalid.activeTask.stageBudgetBaseCount = stageBudgetBaseCount;
      _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: invalid }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
      expect(() => new FirstFloorContinuationStore_ACU().readPersisted()).toThrow(ContinuationValidationError_ACU);
    }

    const current = buildRunningEnvelope_ACU();
    current.activeTask!.stageBudgetBaseCount = 1;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: current }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(new FirstFloorContinuationStore_ACU().readPersisted()?.activeTask?.stageBudgetBaseCount).toBe(1);
  });

  it('fails closed on persisted prompt segments with an unsupported role or empty content', () => {
    const invalidRole = buildEnvelope_ACU() as any;
    invalidRole.settings.outlinePrompt = [{ role: 'tool', content: 'invalid', deletable: true }];
    const invalidContent = buildEnvelope_ACU() as any;
    invalidContent.settings.agentPrompts.main = [{ role: 'user', content: '   ', deletable: true }];

    for (const envelope of [invalidRole, invalidContent]) {
      const chat: any[] = [{ _qrf_continuation: envelope }];
      _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
      expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
    }
  });

  it('旧自动修复配置可读取但不执行修复，成功保存后退役字段不落盘', async () => {
    const legacy = buildEnvelope_ACU() as any;
    legacy.settings.workflow = { autoFixEnabled: false, autoFixMaxAttempts: 3, reviseLimit: 2, repairMaxExtraReads: 2 };
    const chat: any[] = [{ _qrf_continuation: legacy }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-legacy-repair', getCurrentChatId: () => 'chat-legacy-repair', saveChat } as any);
    const store = new FirstFloorContinuationStore_ACU();
    expect(store.read()?.settings.workflow).toEqual({ reviseLimit: 2 });
    expect(chat[0]._qrf_continuation.settings.workflow.autoFixEnabled).toBe(false);
    expect(saveChat).not.toHaveBeenCalled();
    await store.updateAtomically(current => ({ ...current!, settings: { ...current!.settings, workflow: { reviseLimit: 4 } } }));
    expect(chat[0]._qrf_continuation.settings.workflow).toEqual({ reviseLimit: 4 });
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('backfills default per-role channels for envelopes persisted before agentApiPresets existed', () => {
    const legacy = buildEnvelope_ACU() as any;
    delete legacy.settings.agentApiPresets;
    legacy.settings.apiPresetMode = 'fixed';
    legacy.settings.fixedApiPresetName = 'p1';
    const chat: any[] = [{ _qrf_continuation: legacy }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.agentApiPresets).toEqual({
      main: { mode: 'inherit', presetName: '' },
      outline: { mode: 'inherit', presetName: '' },
      arcArchitect: { mode: 'inherit', presetName: '' },
      maintainer: { mode: 'inherit', presetName: '' },
      mainlinePlanner: { mode: 'inherit', presetName: '' },
      beatPlanner: { mode: 'inherit', presetName: '' },
      finalReviewer: { mode: 'inherit', presetName: '' },
      webResearcher: { mode: 'inherit', presetName: '' },
      instructionComposer: { mode: 'inherit', presetName: '' },
    });
    expect(loaded.settings).toMatchObject({ apiPresetMode: 'fixed', fixedApiPresetName: 'p1' });
  });

  it('丢弃语义已作废的 downtimeTurnRatio 并补上连续高压轮上限，越界值仍被拒绝', () => {
    const legacy = buildEnvelope_ACU() as any;
    delete legacy.settings.maxConsecutivePressureTurns;
    legacy.settings.downtimeTurnRatio = 0.3;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: legacy }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const migrated = new FirstFloorContinuationStore_ACU().read()!.settings as any;
    expect(migrated.maxConsecutivePressureTurns).toBe(8);
    expect(migrated.downtimeTurnRatio).toBeUndefined();

    const outOfRange = buildEnvelope_ACU() as any;
    outOfRange.settings.maxConsecutivePressureTurns = 99;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: outOfRange }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
  });

  it.each([
    ['V16 及更早', 'spv2.2-continuation-v13'],
    ['V17', CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V17_ACU],
    ['V27', CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V27_ACU],
    ['V40', CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V40_ACU],
    ['V50', CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V50_ACU],
  ])('%s 信封读出时一次性整组重置提示词（含大纲与用户改写），渠道与其他设置不动', (_label, version) => {
    const legacy = buildEnvelope_ACU() as any;
    legacy.settings.promptForceDefaultVersion = version;
    legacy.settings.outlinePrompt = [{ role: 'user', content: '用户改过的大纲提示词', enabled: true, deletable: true }];
    legacy.settings.agentPrompts.main[1].content = '用户改写的主控段';
    legacy.settings.agentPrompts.maintainer.push({ role: 'user', content: '用户追加的维护规则', enabled: true, deletable: true });
    delete legacy.settings.agentPrompts.arcArchitect;
    legacy.settings.agentPrompts.reviewer = [{ role: 'user', content: '退役审查角色的旧提示词', enabled: true, deletable: true }];
    legacy.settings.apiPresetMode = 'fixed';
    legacy.settings.fixedApiPresetName = 'p1';
    legacy.settings.agentApiPresets.maintainer = { mode: 'fixed', presetName: 'p2' };
    legacy.settings.agentApiPresets.reviewer = { mode: 'fixed', presetName: 'p3' };
    legacy.settings.maxAutomaticStages = 3;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: legacy }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    const defaults = buildDefaultContinuationSettings_ACU();
    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V52_ACU);
    expect(loaded.settings.outlinePrompt).toEqual(defaults.outlinePrompt);
    expect(loaded.settings.agentPrompts).toEqual(defaults.agentPrompts);
    expect(loaded.settings.agentPrompts).not.toHaveProperty('reviewer');
    expect(loaded.settings.agentApiPresets).not.toHaveProperty('reviewer');
    expect(loaded.settings.agentApiPresets.maintainer).toEqual({ mode: 'fixed', presetName: 'p2' });
    expect(loaded.settings).toMatchObject({ apiPresetMode: 'fixed', fixedApiPresetName: 'p1', maxAutomaticStages: 3 });
  });

  it('V51 精确升级维护默认，保留改写、追加、停用与快照，保存后迁移幂等', async () => {
    const { buildV51MaintainerQaPrompt_ACU, buildMaintainerQaPrompt_ACU } = await import('../../../src/service/continuation/agent/maintainer-prompt');
    const { CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V51_ACU } = await import('../../../src/service/continuation/defaults');
    const current = buildEnvelope_ACU() as any;
    current.settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V51_ACU;
    current.settings.agentPrompts.maintainer = buildV51MaintainerQaPrompt_ACU();
    current.settings.agentPrompts.maintainer[2].enabled = false;
    current.settings.agentPrompts.maintainer[4].content += '\n用户补充';
    current.settings.agentPrompts.maintainer.find((segment: any) => segment.snapshotTemplate !== undefined).snapshotTemplate = '用户自定义快照';
    current.settings.outlinePrompt = [{ role: 'user', content: '用户改过的大纲提示词', enabled: true, deletable: true }];
    current.settings.agentPrompts.main[1].content = '用户改写的主控段';
    current.settings.agentPrompts.maintainer.push({ role: 'user', content: '用户追加的维护规则', enabled: true, deletable: true });
    current.settings.agentPrompts.beatPlanner[3].enabled = false;
    const expected = structuredClone(current.settings);
    const next = buildMaintainerQaPrompt_ACU();
    for (const index of [2, 14]) expected.agentPrompts.maintainer[index].content = next[index].content;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: current }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const first = new FirstFloorContinuationStore_ACU().read()!;
    const second = new FirstFloorContinuationStore_ACU().read()!;
    expect(first.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V52_ACU);
    expect(first.settings.outlinePrompt).toEqual(expected.outlinePrompt);
    expect(first.settings.agentPrompts).toEqual(expected.agentPrompts);
    expect(second.settings).toEqual(first.settings);
    expect(current.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V51_ACU);
    expect(current.settings.agentPrompts.maintainer[2].content).not.toContain('优先一次交付');
    await new FirstFloorContinuationStore_ACU().replaceAtomically(first);
    expect(current.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V51_ACU);
    expect(new FirstFloorContinuationStore_ACU().read()!.settings).toEqual(first.settings);
  });

  it('退役 reviewer 的提示词与渠道键读取时直接丢弃，不参与校验', () => {
    const legacy = buildEnvelope_ACU() as any;
    legacy.settings.agentPrompts.reviewer = [{ role: 'user', content: '退役审查角色的旧提示词', enabled: true, deletable: true }];
    legacy.settings.agentApiPresets.reviewer = { mode: 'random', presetName: '' };
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: legacy }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.agentPrompts).not.toHaveProperty('reviewer');
    expect(loaded.settings.agentApiPresets).not.toHaveProperty('reviewer');
  });

  it('存量或缺失的 promptCacheEnabled 读出后强制为 false', () => {
    const enabled = buildEnvelope_ACU() as any;
    enabled.settings.promptCacheEnabled = true;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: enabled }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(new FirstFloorContinuationStore_ACU().read()!.settings.promptCacheEnabled).toBe(false);

    const missing = buildEnvelope_ACU() as any;
    delete missing.settings.promptCacheEnabled;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: missing }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(new FirstFloorContinuationStore_ACU().read()!.settings.promptCacheEnabled).toBe(false);
    expect(buildDefaultContinuationSettings_ACU().promptCacheEnabled).toBe(false);
  });

  it('存量信封缺 minGenerationTokens 时补默认 1000', () => {
    const missing = buildEnvelope_ACU() as any;
    delete missing.settings.minGenerationTokens;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: missing }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(new FirstFloorContinuationStore_ACU().read()!.settings.minGenerationTokens).toBe(1000);
    expect(buildDefaultContinuationSettings_ACU().minGenerationTokens).toBe(1000);
  });

  it('V22 信封缺终审设置与提示词时补默认值且保留用户定制提示词', () => {
    const legacy = buildEnvelope_ACU() as any;
    legacy.settings.agentPrompts.main = [{ role: 'user', content: '保留的用户主控提示词', enabled: true, deletable: true }];
    delete legacy.settings.finalReview;
    delete legacy.settings.agentPrompts.finalReviewer;
    delete legacy.settings.agentApiPresets.finalReviewer;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: legacy }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.agentPrompts.main[0].content).toBe('保留的用户主控提示词');
    expect(loaded.settings.agentPrompts.finalReviewer).toEqual(buildDefaultContinuationSettings_ACU().agentPrompts.finalReviewer);
    expect(loaded.settings.finalReview).toEqual({ enabled: false, readTokenBudget: '20%', maxExtraReads: 6 });
    expect(loaded.settings.agentApiPresets.finalReviewer).toEqual({ mode: 'inherit', presetName: '' });
  });

  it('fails closed on persisted final-review settings with illegal values', () => {
    const invalid = buildEnvelope_ACU() as any;
    invalid.settings.finalReview = { enabled: 'yes', readTokenBudget: '0%', maxExtraReads: 11 };
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: invalid }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
  });

  it('fails closed on a persisted per-role channel with an illegal mode', () => {
    const invalid = buildEnvelope_ACU() as any;
    invalid.settings.agentApiPresets.finalReviewer = { mode: 'random', presetName: '' };
    const chat: any[] = [{ _qrf_continuation: invalid }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    expect(() => new FirstFloorContinuationStore_ACU().read()).toThrow(ContinuationValidationError_ACU);
  });

  it('restores in-memory first-floor data and attempts rollback persistence after a save failure', async () => {
    const original = buildEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: original }];
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const candidate = buildEnvelope_ACU();
    candidate.settings.loopTags = '<required>';
    await expectCode_ACU(() => new FirstFloorContinuationStore_ACU().replaceAtomically(candidate), 'CONTINUATION_PERSIST_FAILED');

    expect(chat[0]._qrf_continuation).toEqual(original);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('keeps the original first-floor value when both primary and rollback saves fail', async () => {
    const original = buildEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: original }];
    const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary save failed')).mockRejectedValueOnce(new Error('rollback save failed'));
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const candidate = buildEnvelope_ACU();
    candidate.settings.loopTags = '<candidate>';
    await expectCode_ACU(() => new FirstFloorContinuationStore_ACU().replaceAtomically(candidate), 'CONTINUATION_PERSIST_FAILED');

    expect(chat[0]._qrf_continuation).toEqual(original);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('rejects a late write when the active chat changes during persistence', async () => {
    const chatA: any[] = [{ _qrf_continuation: buildEnvelope_ACU() }];
    const chatB: any[] = [{}];
    let activeChat: any[] = chatA;
    let activeId = 'chat-a';
    const saveChat = vi.fn(async () => { activeChat = chatB; activeId = 'chat-b'; });
    _set_SillyTavern_API_ACU({ get chat() { return activeChat; }, get chatId() { return activeId; }, getCurrentChatId: () => activeId, saveChat } as any);

    const candidate = buildEnvelope_ACU();
    candidate.settings.loopTags = '<required>';
    await expectCode_ACU(() => new FirstFloorContinuationStore_ACU().replaceAtomically(candidate), 'CONTINUATION_CHAT_CHANGED');

    expect(chatA[0]._qrf_continuation.settings.loopTags).toBe('');
    expect(chatB[0]._qrf_continuation).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('derives a persisted running task as paused without changing its confirmed first-floor snapshot', () => {
    const persisted = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const restored = new FirstFloorContinuationStore_ACU().read();

    expect(restored?.activeTask?.status).toBe('paused');
    expect(chat[0]._qrf_continuation.activeTask.status).toBe('running');
  });

  it('rejects stale task, stage, and revision guards before writing', async () => {
    const current = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: current }];
    const saveChat = vi.fn();
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    await expectCode_ACU(
      () => new FirstFloorContinuationStore_ACU().replaceAtomically(buildRunningEnvelope_ACU(), { chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 2 }),
      'CONTINUATION_WRITE_GUARD_MISMATCH',
    );

    expect(saveChat).not.toHaveBeenCalled();
    expect(chat[0]._qrf_continuation).toEqual(current);
  });

  it('serializes writes across store instances for the same chat', async () => {
    const chat: any[] = [{}];
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>(resolve => { releaseFirstSave = resolve; });
    const saveChat = vi.fn()
      .mockImplementationOnce(() => firstSaveStarted)
      .mockResolvedValueOnce(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    const first = buildEnvelope_ACU();
    first.settings.loopTags = '<first>';
    const second = buildEnvelope_ACU();
    second.settings.loopTags = '<second>';
    const firstWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(first);
    const secondWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(second);

    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    releaseFirstSave!();
    await Promise.all([firstWrite, secondWrite]);

    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(chat[0]._qrf_continuation.settings.loopTags).toBe('<second>');
  });

  it('rejects a queued write if its captured chat becomes inactive before execution', async () => {
    const chatA: any[] = [{}];
    const chatB: any[] = [{}];
    let activeChat: any[] = chatA;
    let activeId = 'chat-a';
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>(resolve => { releaseFirstSave = resolve; });
    const saveChat = vi.fn().mockImplementationOnce(() => firstSaveStarted);
    _set_SillyTavern_API_ACU({ get chat() { return activeChat; }, get chatId() { return activeId; }, getCurrentChatId: () => activeId, saveChat } as any);

    const first = buildEnvelope_ACU();
    first.settings.loopTags = '<first>';
    const second = buildEnvelope_ACU();
    second.settings.loopTags = '<second>';
    const firstWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(first);
    const secondWrite = new FirstFloorContinuationStore_ACU().replaceAtomically(second);

    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    activeChat = chatB;
    activeId = 'chat-b';
    releaseFirstSave!();

    await expectCode_ACU(() => firstWrite, 'CONTINUATION_CHAT_CHANGED');
    await expectCode_ACU(() => secondWrite, 'CONTINUATION_CHAT_CHANGED');
    expect(chatA[0]._qrf_continuation).toBeUndefined();
    expect(chatB[0]._qrf_continuation).toBeUndefined();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('passes a reload-paused task into an atomic update', async () => {
    const persisted = buildRunningEnvelope_ACU();
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    let receivedStatus = '';
    await new FirstFloorContinuationStore_ACU().updateAtomically(current => {
      receivedStatus = current?.activeTask?.status || '';
      return current!;
    });

    expect(receivedStatus).toBe('paused');
    expect(chat[0]._qrf_continuation.activeTask.status).toBe('paused');
  });

  it('clears an unattributable awaiting host turn while deriving the reload pause', () => {
    const persisted = buildRunningEnvelope_ACU();
    persisted.activeTask!.pendingHostTurn = {
      identity: { chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 1, nodeId: 'node-1', turnId: 'turn-1', attemptId: 'attempt-1' },
      capture: { capturedAt: 1, capturedChatLength: 1, capturedAiFloorCount: 0, generationSeq: 3 },
      retryCount: 0,
      status: 'awaiting_generation',
    } as any;
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const restored = new FirstFloorContinuationStore_ACU().read();

    expect(restored!.activeTask!.status).toBe('paused');
    expect(restored!.activeTask!.pendingHostTurn).toBeNull();
    // 持久化快照本身不被读取路径改写。
    expect(chat[0]._qrf_continuation.activeTask.pendingHostTurn.status).toBe('awaiting_generation');
  });

  it('derives an interrupted drafting or planning task as a paused failed stage after reload', () => {
    const persisted = buildRunningEnvelope_ACU();
    persisted.activeTask!.status = 'drafting';
    persisted.activeTask!.stages[0].status = 'planning';
    const chat: any[] = [{ _qrf_continuation: persisted }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const restored = new FirstFloorContinuationStore_ACU().read();

    expect(restored?.activeTask).toMatchObject({ status: 'paused', lastError: { code: 'CONTINUATION_TASK_STATE_INVALID', phase: 'load' } });
    expect(restored?.activeTask?.stages[0].status).toBe('failed');
    expect(chat[0]._qrf_continuation.activeTask).toMatchObject({ status: 'drafting', stages: [{ status: 'planning' }] });
  });


  it('migrates only retained legacy settings and never assigns prompt-array semantics', () => {
    const legacy = {
      loopSettings: { quickReplyContent: ['do not migrate'], currentPromptIndex: 2, loopTags: '<tag>', loopDelay: 7, retryDelay: 4, loopTotalDuration: 9, maxRetries: 5 },
      contextTurnCount: 8,
      contextExtractRules: [{ start: '<a>', end: '</a>' }],
      contextExcludeRules: [{ start: '<b>', end: '</b>' }],
    };
    const migration = buildLegacyContinuationMigration_ACU(legacy);

    // contextTurnCount 已随 V17 退役：旧值不再迁入新设置。
    expect(migration.settings).toMatchObject({ loopTags: '<tag>', loopDelaySeconds: 7, retryDelaySeconds: 4, totalDurationMinutes: 9, generationRetryLimit: 5 });
    expect(migration.settings).not.toHaveProperty('contextTurnCount');
    expect(migration.settings).not.toHaveProperty('quickReplyContent');
    expect(stripLegacyContinuationLoopFields_ACU(legacy)).toEqual({ loopSettings: { loopTags: '<tag>', loopDelay: 7, retryDelay: 4, loopTotalDuration: 9, maxRetries: 5 }, contextTurnCount: 8, contextExtractRules: [{ start: '<a>', end: '</a>' }], contextExcludeRules: [{ start: '<b>', end: '</b>' }] });

    const migrated = buildMigratedContinuationEnvelope_ACU(legacy);
    expect(migrated).toMatchObject({ didMigrate: true, envelope: { schemaVersion: 1, activeTask: null } });
    expect(migrated.envelope.settings).not.toHaveProperty('quickReplyContent');
  });
});

describe('continuation API preset reference cascade helpers', () => {
  it('rename 同步改写 fixed 与匹配的 agent presetName，不改其它渠道', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.apiPresetMode = 'fixed';
    settings.fixedApiPresetName = 'old';
    settings.agentApiPresets.main = { mode: 'fixed', presetName: 'old' };
    settings.agentApiPresets.outline = { mode: 'inherit', presetName: 'old' };
    settings.agentApiPresets.reviewer = { mode: 'fixed', presetName: 'keep' };

    const next = renameApiPresetReferencesInContinuationSettings_ACU(settings, 'old', 'new');
    expect(next).not.toBe(settings);
    expect(next.fixedApiPresetName).toBe('new');
    expect(next.agentApiPresets.main.presetName).toBe('new');
    expect(next.agentApiPresets.outline).toEqual({ mode: 'inherit', presetName: 'new' });
    expect(next.agentApiPresets.reviewer).toEqual({ mode: 'fixed', presetName: 'keep' });
  });

  it('clear 置空引用并回退 current；inherit 只清 presetName', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.apiPresetMode = 'fixed';
    settings.fixedApiPresetName = 'old';
    settings.agentApiPresets.main = { mode: 'fixed', presetName: 'old' };
    settings.agentApiPresets.outline = { mode: 'inherit', presetName: 'old' };
    settings.agentApiPresets.reviewer = { mode: 'fixed', presetName: 'keep' };

    const next = clearApiPresetReferencesInContinuationSettings_ACU(settings, 'old');
    expect(next.apiPresetMode).toBe('current');
    expect(next.fixedApiPresetName).toBe('');
    expect(next.agentApiPresets.main).toEqual({ mode: 'current', presetName: '' });
    expect(next.agentApiPresets.outline).toEqual({ mode: 'inherit', presetName: '' });
    expect(next.agentApiPresets.reviewer).toEqual({ mode: 'fixed', presetName: 'keep' });
  });

  it('名称不匹配时返回同一对象', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.fixedApiPresetName = 'keep';
    expect(renameApiPresetReferencesInContinuationSettings_ACU(settings, 'old', 'new')).toBe(settings);
    expect(clearApiPresetReferencesInContinuationSettings_ACU(settings, 'old')).toBe(settings);
  });
});

describe('零层初始化与源历史校验', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(undefined); });

  it('无宿主生成状态接口时可初始化零层并冻结启用切点', async () => {
    const { applyZeroLayerCommand_ACU } = await import('../../../src/service/zero-layer/store-command');
    const { captureBridgeActivationCut_ACU } = await import('../../../src/service/zero-layer/bridge-source');
    const { physicalHistorySnapshot_ACU } = await import('../../../src/service/zero-layer/carrier-context');
    const { ZERO_LAYER_SCHEMA_VERSION_ACU } = await import('../../../src/service/zero-layer/model');
    const carrier = { is_user: false, mes: '开场', swipe_id: 0 };
    const chat = [carrier];
    const scope = { characterKey: 'card:test', chatId: 'chat-test' };
    const context = { chat, carrier, carrierIndex: 0, swipeId: 0, scope,
      key: JSON.stringify([scope.characterKey, scope.chatId]),
      source: physicalHistorySnapshot_ACU(chat), messageRefs: [...chat] };
    const fingerprint = 'sha256:activation';
    const initialized = applyZeroLayerCommand_ACU(null,
      { type: 'initialize', apiPresetName: 'database-direct' }, context, fingerprint);
    expect(initialized.schemaVersion).toBe(ZERO_LAYER_SCHEMA_VERSION_ACU);
    expect(initialized.enabled).toBe(false);
    expect(initialized.apiPresetName).toBe('database-direct');
    expect(initialized.scope).toEqual(scope);
    const cut = captureBridgeActivationCut_ACU(context, fingerprint);
    expect(cut.messageCount).toBe(1);
    expect(cut.completedAiCount).toBe(1);
    expect(cut.refs[0]).toMatchObject({ kind: 'host', scope, messageIndex: 0, swipeId: 0 });
  });

  it('桥接仍拒绝已变化的源历史', async () => {
    const { assertBridgeSource_ACU, bridgeSourceFingerprint_ACU } = await import('../../../src/service/zero-layer/bridge-source');
    const chat = [{ is_user: false, mes: '开场', swipe_id: 0 }];
    const fingerprint = bridgeSourceFingerprint_ACU(chat);
    expect(() => assertBridgeSource_ACU(chat, fingerprint)).not.toThrow();
    chat[0].mes = '已修改的开场';
    expect(() => assertBridgeSource_ACU(chat, fingerprint)).toThrow('存量桥接来源已变化');
  });
});