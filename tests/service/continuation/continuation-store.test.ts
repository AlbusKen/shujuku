import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultContinuationSettings_ACU,
  V23_DEFAULT_OUTLINE_ACK_SEGMENT_ACU,
  V23_DEFAULT_OUTLINE_METHOD_ACK_SEGMENT_ACU,
  V23_DEFAULT_OUTLINE_PACING_SEGMENT_ACU,
  V23_DEFAULT_OUTLINE_SYSTEM_SEGMENT_ACU,
  V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU,
  V26_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU,
  V27_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU,
} from '../../../src/service/continuation/defaults';
import {
  V23_MAIN_AGENT_PACING_RULE_ACU,
  V24_MAIN_AGENT_PACING_RULE_ACU,
  V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU,
  V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU,
  V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU,
  V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU,
  V20_DEFAULT_ARC_ARCHITECT_CONTRACT_ACU,
  V20_DEFAULT_ARC_ARCHITECT_EPISTEMOLOGY_ACU,
  V20_DEFAULT_ARC_ARCHITECT_PURPOSE_ACU,
  V20_DEFAULT_ARC_ARCHITECT_SYSTEM_ACU,
  V20_DEFAULT_ARC_ARCHITECT_TASK_ACU,
  V19_DEFAULT_MAIN_AGENT_HISTORY_GUIDE_ACU,
  V19_DEFAULT_MAIN_AGENT_LAYOUT_ANSWER_ACU,
  V19_DEFAULT_MAIN_AGENT_RUNTIME_SEGMENT_ACU,
  currentDefaultMainAgentHistoryGuide_ACU,
  currentDefaultMainAgentLayoutAnswer_ACU,
} from '../../../src/service/continuation/agent/agent-defaults';
import { ContinuationValidationError_ACU, type ContinuationEnvelope_ACU } from '../../../src/service/continuation/model';
import {
  FirstFloorContinuationStore_ACU,
  buildMigratedContinuationEnvelope_ACU,
  buildLegacyContinuationMigration_ACU,
  stripLegacyContinuationLoopFields_ACU,
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
      reviewer: { mode: 'inherit', presetName: '' },
      finalReviewer: { mode: 'inherit', presetName: '' },
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

  it('V17 仅定向更新已知会话快照规则，并保留其余提示词与段字段', () => {
    const v17 = buildEnvelope_ACU() as any;
    v17.settings.promptForceDefaultVersion = 'spv2.5-continuation-story-layers-v17';
    const historyIndex = v17.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content).includes('【以下是你自己的会话记录】'),
    );
    expect(historyIndex).toBeGreaterThanOrEqual(0);
    v17.settings.agentPrompts.main[historyIndex] = {
      ...v17.settings.agentPrompts.main[historyIndex],
      content: '【以下是你自己的会话记录】\n用户对你说过的话、你历次迭代实际输出过的动作、运行时回灌给你的工具结果、派工结果与拒绝原因，按真实发生顺序排列，跨轮次持续累积。已经调阅到的资料就在这里，不要重复调阅；已经完成的工作不要重做，被拒过的写法不要重犯，用户的最新指令优先于你此前的计划。',
      enabled: false,
      deletable: true,
    };
    v17.settings.agentPrompts.main.splice(historyIndex + 1, 0, {
      role: 'assistant',
      content: '用户定制的附加提示词段',
      enabled: false,
      deletable: true,
    });
    const expectedPrompts = JSON.parse(JSON.stringify(v17.settings.agentPrompts));
    expectedPrompts.main[historyIndex].content = currentDefaultMainAgentHistoryGuide_ACU();
    const expectedOutlinePrompt = JSON.parse(JSON.stringify(v17.settings.outlinePrompt));
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v17 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts).toEqual(expectedPrompts);
    expect(loaded.settings.outlinePrompt).toEqual(expectedOutlinePrompt);
  });

  it('V17 自定义提示词未包含已知旧句时逐字保留，只推进契约版本', () => {
    const customized = buildEnvelope_ACU() as any;
    customized.settings.promptForceDefaultVersion = 'spv2.5-continuation-story-layers-v17';
    const historyIndex = customized.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content).includes('【以下是你自己的会话记录】'),
    );
    expect(historyIndex).toBeGreaterThanOrEqual(0);
    customized.settings.agentPrompts.main[historyIndex] = {
      role: 'system',
      content: '【自定义会话规则】只采用我明确标记为当前版本的资料。',
      enabled: false,
      deletable: true,
      pinned: false,
    };
    const expectedPrompts = JSON.parse(JSON.stringify(customized.settings.agentPrompts));
    const expectedOutlinePrompt = JSON.parse(JSON.stringify(customized.settings.outlinePrompt));
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: customized }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts).toEqual(expectedPrompts);
    expect(loaded.settings.outlinePrompt).toEqual(expectedOutlinePrompt);
  });

  it('V18 默认主 Agent 的非根 system 段迁移为 user，并删除未改写的运行时骨架段', () => {
    const v18 = buildEnvelope_ACU() as any;
    v18.settings.promptForceDefaultVersion = 'spv2.6-continuation-append-only-history-v18';
    const historyIndex = v18.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content).startsWith('【以下是你自己的会话记录】'),
    );
    const layoutIndex = v18.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content).startsWith('我收到的上下文分三层：'),
    );
    const anchorIndex = v18.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content) === '$HISTORY_ANCHOR',
    );
    v18.settings.agentPrompts.main[historyIndex] = {
      ...v18.settings.agentPrompts.main[historyIndex],
      content: V19_DEFAULT_MAIN_AGENT_HISTORY_GUIDE_ACU,
    };
    v18.settings.agentPrompts.main[layoutIndex] = {
      ...v18.settings.agentPrompts.main[layoutIndex],
      content: V19_DEFAULT_MAIN_AGENT_LAYOUT_ANSWER_ACU,
    };
    v18.settings.agentPrompts.main.splice(anchorIndex + 1, 0, {
      role: 'system',
      content: V19_DEFAULT_MAIN_AGENT_RUNTIME_SEGMENT_ACU,
      enabled: true,
      deletable: false,
      pinned: true,
    });
    const migratedHeadings = ['【文本协议规范】', '【子代理使用规则】', '【模式边界】', '【已经发生的小说正文】', '【以下是你自己的会话记录】', '$HISTORY_ANCHOR', '【本回合运行时数据】'];
    v18.settings.agentPrompts.main = v18.settings.agentPrompts.main.map((segment: any) => (
      migratedHeadings.some(heading => String(segment.content).startsWith(heading))
        ? { ...segment, role: 'system' }
        : segment
    ));
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v18 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content === V19_DEFAULT_MAIN_AGENT_RUNTIME_SEGMENT_ACU)).toBe(false);
    expect(loaded.settings.agentPrompts.main.filter(segment => segment.role === 'system')).toHaveLength(1);
    expect(loaded.settings.agentPrompts.main[0].role).toBe('system');
    expect(loaded.settings.agentPrompts.main.find(segment => String(segment.content).startsWith('【以下是你自己的会话记录】'))?.content).toBe(currentDefaultMainAgentHistoryGuide_ACU());
    expect(loaded.settings.agentPrompts.main.find(segment => String(segment.content).startsWith('我收到的上下文分三层：'))?.content).toBe(currentDefaultMainAgentLayoutAnswer_ACU());
  });

  it('V18 用户自定义的 system 段不会被缓存兼容迁移改写', () => {
    const v18 = buildEnvelope_ACU() as any;
    v18.settings.promptForceDefaultVersion = 'spv2.6-continuation-append-only-history-v18';
    const anchorIndex = v18.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content) === '$HISTORY_ANCHOR',
    );
    v18.settings.agentPrompts.main.splice(anchorIndex + 1, 0, {
      role: 'system',
      content: '【本回合运行时数据】\n这是用户定制的运行时提示词。',
      enabled: true,
      deletable: false,
      pinned: true,
    });
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v18 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    const runtimeIndex = loaded.settings.agentPrompts.main.findIndex(segment =>
      String(segment.content).startsWith('【本回合运行时数据】'),
    );

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.main[runtimeIndex]).toMatchObject({
      role: 'system',
      content: '【本回合运行时数据】\n这是用户定制的运行时提示词。',
    });
  });

  it('V19 未改写的运行时骨架段删除，排布问答与历史导语定向更新到 V20', () => {
    const v19 = buildEnvelope_ACU() as any;
    v19.settings.promptForceDefaultVersion = 'spv2.7-continuation-single-system-prefix-v19';
    const historyIndex = v19.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content).startsWith('【以下是你自己的会话记录】'),
    );
    const layoutIndex = v19.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content).startsWith('我收到的上下文分三层：'),
    );
    const anchorIndex = v19.settings.agentPrompts.main.findIndex((segment: any) =>
      String(segment.content) === '$HISTORY_ANCHOR',
    );
    v19.settings.agentPrompts.main[historyIndex].content = V19_DEFAULT_MAIN_AGENT_HISTORY_GUIDE_ACU;
    v19.settings.agentPrompts.main[layoutIndex].content = V19_DEFAULT_MAIN_AGENT_LAYOUT_ANSWER_ACU;
    v19.settings.agentPrompts.main.splice(anchorIndex + 1, 0, {
      role: 'user',
      content: V19_DEFAULT_MAIN_AGENT_RUNTIME_SEGMENT_ACU,
      enabled: true,
      deletable: false,
      pinned: true,
    });
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v19 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content === V19_DEFAULT_MAIN_AGENT_RUNTIME_SEGMENT_ACU)).toBe(false);
    expect(loaded.settings.agentPrompts.main.find(segment => String(segment.content).startsWith('【以下是你自己的会话记录】'))?.content).toBe(currentDefaultMainAgentHistoryGuide_ACU());
    expect(loaded.settings.agentPrompts.main.find(segment => String(segment.content).startsWith('我收到的上下文分三层：'))?.content).toBe(currentDefaultMainAgentLayoutAnswer_ACU());
  });

  it('V20 只更新未改写的总纲默认段，保留用户定制段与其他角色提示词', () => {
    const v20 = buildEnvelope_ACU() as any;
    v20.settings.promptForceDefaultVersion = 'spv2.8-continuation-runtime-snapshot-v20';
    const expectedMain = JSON.parse(JSON.stringify(v20.settings.agentPrompts.main));
    const expectedArc = JSON.parse(JSON.stringify(v20.settings.agentPrompts.arcArchitect));
    const customSegment = { role: 'user', content: '用户定制的总纲补充规则', enabled: true, deletable: true };
    expectedArc.push(customSegment);
    v20.settings.agentPrompts.arcArchitect[0].content = V20_DEFAULT_ARC_ARCHITECT_SYSTEM_ACU;
    v20.settings.agentPrompts.arcArchitect[2].content = V20_DEFAULT_ARC_ARCHITECT_PURPOSE_ACU;
    v20.settings.agentPrompts.arcArchitect[4].content = V20_DEFAULT_ARC_ARCHITECT_EPISTEMOLOGY_ACU;
    v20.settings.agentPrompts.arcArchitect[6].content = V20_DEFAULT_ARC_ARCHITECT_CONTRACT_ACU;
    v20.settings.agentPrompts.arcArchitect[7].content = V20_DEFAULT_ARC_ARCHITECT_TASK_ACU;
    v20.settings.agentPrompts.arcArchitect.push(customSegment);
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v20 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.main).toEqual(expectedMain);
    expect(loaded.settings.agentPrompts.arcArchitect).toEqual(expectedArc);
    expect(loaded.settings.agentPrompts.arcArchitect[2].content).toContain('总纲解决六件事');
    expect(loaded.settings.agentPrompts.arcArchitect[6].content).toContain('短线 7–8 卷');
  });

  it('migrates V21 default arc volume wording while preserving custom segments', () => {
    const v21 = buildEnvelope_ACU() as any;
    v21.settings.promptForceDefaultVersion = 'spv2.9-continuation-longform-story-arc-v21';
    v21.settings.agentPrompts.arcArchitect[6].content = v21.settings.agentPrompts.arcArchitect[6].content
      .replace('开局立总纲或全量重构时，卷数必须严格遵守本次请求末尾注入的【总纲卷数计划】：短线 7–8 卷、中线 10–14 卷、长线 20 卷，或自定义的精确卷数。资料不足时可以把远期卷标为待定方向，但不得缩减卷数；第一卷 status 设 active，其余 planned。', '开局立长篇总纲时，默认给出一条 story 条目和 6-10 条 volume 条目；只有用户明确要求短篇或素材容量明显不足时才可少于 6 卷，并在 summary 说明依据。禁止为了省事把完整长篇压成 3-5 个笼统部分。第一卷 status 设 active，其余 planned。');
    const custom = { role: 'user', content: '用户自定义分卷规则', enabled: true, deletable: true };
    v21.settings.agentPrompts.arcArchitect.push(custom);
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v21 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.arcArchitect[6].content).toContain('短线 7–8 卷');
    expect(loaded.settings.agentPrompts.arcArchitect).toContainEqual(custom);
  });

  it('migrates V22 volume lifecycle defaults while preserving custom prompt segments', () => {
    const v22 = buildEnvelope_ACU() as any;
    v22.settings.promptForceDefaultVersion = 'spv3.0-continuation-story-arc-volume-plan-v22';
    v22.settings.agentPrompts.arcArchitect[6].content = v22.settings.agentPrompts.arcArchitect[6].content
      .replace(',"completionStageNumber":"done 时为已完成阶段编号，否则 null","completionState":"done 时达到的卷末状态，否则空字符串","continuationRationale":"续卷时由前卷后果推出的依据，否则空字符串"', '')
      .replace('7. stage 是阶段大纲，volume 是长程卷台阶；一个 active 卷可由多份阶段大纲渐进承载。每完成一份阶段只 patch 当前 active 卷的 stageNumbers，不能因单个阶段完成就把卷设为 done。\n8. 仅当真实正文已达到本卷 escalation 的可判定收束状态时，才可把 active 卷 patch 为 done；同一 patch 必须给 completionStageNumber、completionState，且该阶段已真实完成并已登记在 stageNumbers。状态只能 planned→active→done；done 卷不可重激活。\n9. 所有既有卷 done 而用户继续写作时，先在末尾 upsert 一个 active 新卷，并以 continuationRationale 说明它如何由最后一卷的结果、代价、关系变化或未解决问题推出；之后才由 outline-architect 创建阶段大纲。\n10. patch 只带要改的字段，其余字段保持原样；新增或整条重写才用 upsert。', '7. 阶段完成后回写进度用 patch：{"action":"patch","id":"VOL-01","stageNumbers":[1,2,3]}。当前卷台阶走完时，把它 patch 成 done，同时把下一卷 patch 成 active。\n8. patch 只带要改的字段，其余字段保持原样；新增或整条重写才用 upsert。');
    v22.settings.agentPrompts.main = v22.settings.agentPrompts.main.map((segment: any) => ({
      ...segment,
      content: String(segment.content).replace('此外，剧情实际走向已越出总纲台阶、底牌被正文提前翻开、或当前卷已经由真实完成阶段达到可判定收束状态时，同样必须派它维护总纲。单个阶段完成只回写当前 active 卷的 stageNumbers；所有既有卷完成而用户继续写时，先派 arc-architect 依据最后一卷的后果扩充一个 active 新卷，再派 outline-architect，不要拖到下一阶段。', '此外，剧情实际走向已越出总纲台阶、底牌被正文提前翻开、或当前卷目标事实上已收束/明显提前推迟时，同样必须派它维护总纲，不要拖到下一阶段。'),
    }));
    const custom = { role: 'user', content: '保留的 V22 自定义卷规则', enabled: true, deletable: true };
    v22.settings.agentPrompts.arcArchitect.push(custom);
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v22 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.arcArchitect[6].content).toContain('completionStageNumber');
    expect(loaded.settings.agentPrompts.arcArchitect[6].content).toContain('continuationRationale');
    expect(loaded.settings.agentPrompts.main.some((segment: any) => String(segment.content).includes('单个阶段完成只回写当前 active 卷'))).toBe(true);
    expect(loaded.settings.agentPrompts.arcArchitect).toContainEqual(custom);
  });

  it('migrates V23 default pacing prompts to V24 and preserves custom segments', () => {
    const v23 = buildEnvelope_ACU() as any;
    v23.settings.promptForceDefaultVersion = 'spv3.1-continuation-volume-lifecycle-v23';
    v23.settings.outlinePrompt = v23.settings.outlinePrompt.filter(
      (segment: any) => segment.content !== V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU,
    );
    const actionRule = v23.settings.agentPrompts.main.find((segment: any) =>
      String(segment.content).includes(V24_MAIN_AGENT_PACING_RULE_ACU),
    );
    expect(actionRule).toBeDefined();
    actionRule.content = actionRule.content.replace(V24_MAIN_AGENT_PACING_RULE_ACU, V23_MAIN_AGENT_PACING_RULE_ACU);
    const custom = { role: 'user', content: '保留的 V23 自定义节奏说明', enabled: true, deletable: true };
    v23.settings.agentPrompts.main.push(custom);
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v23 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.outlinePrompt.some(segment => segment.content === V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU)).toBe(true);
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content.includes(V24_MAIN_AGENT_PACING_RULE_ACU))).toBe(true);
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content.includes(V23_MAIN_AGENT_PACING_RULE_ACU))).toBe(false);
    expect(loaded.settings.agentPrompts.arcArchitect.filter(
      segment => segment.content === V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU,
    )).toHaveLength(1);
    expect(loaded.settings.agentPrompts.main).toContainEqual(custom);
  });

  it('把真实 V23 形态的大纲协议段（旧 turn 标签、无 stage_role）精确升级为当前协议，并注入账本占位符', () => {
    const v23 = buildEnvelope_ACU() as any;
    v23.settings.promptForceDefaultVersion = 'spv3.1-continuation-volume-lifecycle-v23';
    // 真实 V23 用户的大纲提示词：旧 system / 确认 / 方法论确认三段 + V23 节奏段 + V26 形态的上下文段，没有长篇契约段。
    v23.settings.outlinePrompt = [
      { role: 'system', content: V23_DEFAULT_OUTLINE_SYSTEM_SEGMENT_ACU, enabled: true, deletable: true },
      { role: 'assistant', content: V23_DEFAULT_OUTLINE_ACK_SEGMENT_ACU, enabled: true, deletable: true },
      v23.settings.outlinePrompt.find((segment: any) => String(segment.content).startsWith('【阶段容量')),
      { role: 'user', content: V23_DEFAULT_OUTLINE_PACING_SEGMENT_ACU, enabled: true, deletable: true },
      v23.settings.outlinePrompt.find((segment: any) => String(segment.content).startsWith('【大纲方法论与强约束】')),
      { role: 'assistant', content: V23_DEFAULT_OUTLINE_METHOD_ACK_SEGMENT_ACU, enabled: true, deletable: true },
      { role: 'user', content: V26_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU, enabled: true, deletable: true },
    ];
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v23 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    const contents = loaded.settings.outlinePrompt.map(segment => segment.content);
    const defaults = buildDefaultContinuationSettings_ACU().outlinePrompt.map(segment => segment.content);

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    // 三段协议段被换成当前默认；旧协议文本一个不剩。
    expect(contents).toEqual(defaults);
    expect(contents.some(content => content.includes('每个 <turn> 都必须带 pacing 属性'))).toBe(false);
    expect(contents[0]).toContain('<stage_role>');
    expect(contents[0]).toContain('function="daily_bond"');
    // 上下文段升级为账本注入版本。
    expect(contents).toContain(V27_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU);
    expect(contents[contents.length - 1]).toContain('$HOOKS_LEDGER');
    expect(contents[contents.length - 1]).toContain('$CHRONOLOGY');
  });

  it('V26 用户的默认上下文段升级为 V27 账本注入版，改写过的段保留原文', () => {
    const v26 = buildEnvelope_ACU() as any;
    v26.settings.promptForceDefaultVersion = 'spv3.4-continuation-chronology-v26';
    v26.settings.outlinePrompt = v26.settings.outlinePrompt.map((segment: any) => segment.content === V27_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU
      ? { ...segment, content: V26_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU }
      : segment);
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v26 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.outlinePrompt.some(segment => segment.content === V27_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU)).toBe(true);

    const customized = buildEnvelope_ACU() as any;
    customized.settings.promptForceDefaultVersion = 'spv3.4-continuation-chronology-v26';
    customized.settings.outlinePrompt = customized.settings.outlinePrompt.map((segment: any) => segment.content === V27_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU
      ? { ...segment, content: `${V26_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU}\n用户自定义补充` }
      : segment);
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: customized }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const kept = new FirstFloorContinuationStore_ACU().read()!;
    expect(kept.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(kept.settings.outlinePrompt.some(segment => segment.content.endsWith('用户自定义补充'))).toBe(true);
    expect(kept.settings.outlinePrompt.some(segment => segment.content === V27_DEFAULT_OUTLINE_CONTEXT_SEGMENT_ACU)).toBe(false);
  });

  it('migrates an exact V24 default arc contract to V25 exactly once', () => {
    const v24 = buildEnvelope_ACU() as any;
    v24.settings.promptForceDefaultVersion = 'spv3.2-continuation-pacing-contract-v24';
    v24.settings.agentPrompts.arcArchitect = v24.settings.agentPrompts.arcArchitect.filter(
      (segment: any) => segment.content !== V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU,
    );
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v24 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.arcArchitect.filter(
      segment => segment.content === V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU,
    )).toHaveLength(1);
  });

  it('advances a customized V24 arc prompt without injecting the default V25 contract', () => {
    const customized = buildEnvelope_ACU() as any;
    customized.settings.promptForceDefaultVersion = 'spv3.2-continuation-pacing-contract-v24';
    customized.settings.agentPrompts.arcArchitect = [{
      role: 'user', content: '用户自定义总纲容量规则', enabled: true, deletable: true,
    }];
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: customized }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.arcArchitect).toEqual(customized.settings.agentPrompts.arcArchitect);
    expect(loaded.settings.agentPrompts.arcArchitect.some(
      (segment: any) => segment.content === V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU,
    )).toBe(false);
  });

  it('migrates an exact V25 default prompt set to V26 by inserting each chronology segment exactly once', () => {
    const v25 = buildEnvelope_ACU() as any;
    v25.settings.promptForceDefaultVersion = 'spv3.3-continuation-volume-capacity-v25';
    const chronologyContents = [V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU, V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU, V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU];
    for (const key of ['main', 'maintainer', 'finalReviewer']) {
      v25.settings.agentPrompts[key] = v25.settings.agentPrompts[key].filter(
        (segment: any) => !chronologyContents.includes(segment.content),
      );
    }
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: v25 }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.main.filter(segment => segment.content === V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU)).toHaveLength(1);
    expect(loaded.settings.agentPrompts.maintainer.filter(segment => segment.content === V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU)).toHaveLength(1);
    expect(loaded.settings.agentPrompts.finalReviewer.filter(segment => segment.content === V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU)).toHaveLength(1);
    // 迁移结果与当前默认组完全一致：插入位置也必须正确，而不只是“存在”。
    expect(loaded.settings.agentPrompts).toEqual(buildDefaultContinuationSettings_ACU().agentPrompts);
  });

  it('advances customized V25 prompts without injecting default chronology segments when anchors were rewritten', () => {
    const customized = buildEnvelope_ACU() as any;
    customized.settings.promptForceDefaultVersion = 'spv3.3-continuation-volume-capacity-v25';
    customized.settings.agentPrompts.maintainer = [{ role: 'user', content: '用户自定义维护提示词', enabled: true, deletable: true }];
    customized.settings.agentPrompts.finalReviewer = [{ role: 'user', content: '用户自定义终审提示词', enabled: true, deletable: true }];
    customized.settings.agentPrompts.main = customized.settings.agentPrompts.main
      .filter((segment: any) => segment.content !== V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU)
      .map((segment: any) => String(segment.content).startsWith('【子代理使用规则】')
        ? { ...segment, content: '【子代理使用规则】用户自己改写过的规则。' }
        : segment);
    const expectedPrompts = JSON.parse(JSON.stringify(customized.settings.agentPrompts));
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: customized }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts).toEqual(expectedPrompts);
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content === V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU)).toBe(false);
  });

  it('advances a customized V23 pacing configuration without overwriting its text', () => {
    const customized = buildEnvelope_ACU() as any;
    customized.settings.promptForceDefaultVersion = 'spv3.1-continuation-volume-lifecycle-v23';
    customized.settings.outlinePrompt = customized.settings.outlinePrompt
      .filter((segment: any) => segment.content !== V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU)
      .map((segment: any) => segment.content === V23_DEFAULT_OUTLINE_PACING_SEGMENT_ACU
        ? { ...segment, content: `${segment.content}\n用户自定义：低压轮优先经营领地。` }
        : segment);
    const customOutline = customized.settings.outlinePrompt.find((segment: any) =>
      String(segment.content).includes('用户自定义：低压轮优先经营领地。'),
    ).content;
    const actionRule = customized.settings.agentPrompts.main.find((segment: any) =>
      String(segment.content).includes(V24_MAIN_AGENT_PACING_RULE_ACU),
    );
    actionRule.content = '用户自定义主 Agent 节奏规则';
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: customized }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.outlinePrompt.some(segment => segment.content === customOutline)).toBe(true);
    expect(loaded.settings.outlinePrompt.some(segment => segment.content === V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU)).toBe(false);
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content === '用户自定义主 Agent 节奏规则')).toBe(true);
  });


  it('V16 及更早提示词版本仍整体强刷，存量信封因此拿到总纲子代理提示词组', () => {
    const stale = buildEnvelope_ACU() as any;
    stale.settings.promptForceDefaultVersion = 'spv2.2-continuation-v13';
    stale.settings.agentPrompts = { ...stale.settings.agentPrompts, main: [{ role: 'user', content: '用户改过的旧提示词', enabled: true, deletable: true }] };
    delete stale.settings.agentPrompts.arcArchitect;
    _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: stale }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.promptForceDefaultVersion).toBe('spv3.5-continuation-outline-ledgers-v27');
    expect(loaded.settings.agentPrompts.arcArchitect[0].content).toContain('故事总纲子代理');
    expect(loaded.settings.outlinePrompt.some(segment => segment.content.includes('<stage_tempo>'))).toBe(true);
    expect(loaded.settings.agentPrompts.main[0].content).not.toBe('用户改过的旧提示词');
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
    expect(loaded.settings.finalReview).toEqual({ enabled: false, readTokenBudget: '50%', maxExtraReads: 6 });
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
    invalid.settings.agentApiPresets.reviewer = { mode: 'random', presetName: '' };
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
