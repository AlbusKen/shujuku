import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import {
  FirstFloorWorldSimulationStore_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  buildEmptyWorldChronicleArchiveSnapshot_ACU,
  readWorldSimulationBucketEntry_ACU,
  resolveCurrentWorldSimulationAnchor_ACU,
  resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationChronicleArchiveSnapshot_ACU,
  validateWorldSimulationEnvelope_ACU,
  validateWorldSimulationLedger_ACU,
  writeWorldSimulationBucketEntry_ACU,
  renameApiPresetReferencesInWorldSimulationSettings_ACU,
  clearApiPresetReferencesInWorldSimulationSettings_ACU,
} from '../../../src/service/simulation/simulation-store';
import { WORLD_CHRONICLE_OVERVIEW_CAP_ACU, WORLD_LEDGER_SCHEMA_VERSION_ACU, WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

describe('world simulation envelope store', () => {
  beforeEach(() => _set_SillyTavern_API_ACU(undefined));

  it('accepts the default closed envelope and rejects unknown fields', () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    expect(validateWorldSimulationEnvelope_ACU(envelope)).toEqual(envelope);
    expect(() => validateWorldSimulationEnvelope_ACU({ ...envelope, unexpected: true })).toThrow(WorldSimulationValidationError_ACU);
  });

  it('存量信封里的 requirements-maintainer 提示词与渠道在加载时丢弃，不拒绝整包', () => {
    const legacy: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    const preserved = { mode: 'fixed' as const, presetName: 'kept' };
    legacy.settings.agentPrompts['requirements-maintainer'] = legacy.settings.agentPrompts['world-director'];
    legacy.settings.agentApiPresets['requirements-maintainer'] = { mode: 'fixed', presetName: 'old' };
    legacy.settings.agentApiPresets['world-director'] = preserved;
    const loaded = validateWorldSimulationEnvelope_ACU(legacy);
    expect(Object.keys(loaded.settings.agentPrompts)).toEqual(Object.keys(buildDefaultWorldSimulationSettings_ACU().agentPrompts));
    expect(loaded.settings.agentPrompts).not.toHaveProperty('requirements-maintainer');
    expect(loaded.settings.agentApiPresets).not.toHaveProperty('requirements-maintainer');
    expect(loaded.settings.agentApiPresets['world-director']).toEqual(preserved);
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

  it('缺 workflow 时补默认自动修复配置，非法阈值回退', () => {
    const missing: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    delete missing.settings.workflow;
    expect(validateWorldSimulationEnvelope_ACU(missing).settings.workflow).toEqual({
      autoFixEnabled: true,
      chroniclerHotThreshold: 32,
    });
    const invalid: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    invalid.settings.workflow = { autoFixEnabled: 'yes', chroniclerHotThreshold: 0 };
    expect(validateWorldSimulationEnvelope_ACU(invalid).settings.workflow).toEqual({
      autoFixEnabled: true,
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

  it('锚点楼层 digest 变化时重扫 fail-closed', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'first-floor', swipe_id: 0 },
      { message_id: 20, mes: 'anchor-body', swipe_id: 0 },
    ];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const staleAnchor = resolveWorldSimulationAnchor_ACU(1, chat);
    await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, { token: 'kept' }, chat);

    chat[1].mes = 'anchor-body-edited';

    expect(() => resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat)).toThrow(WorldSimulationValidationError_ACU);
    expect(() => resolveCurrentWorldSimulationAnchor_ACU(staleAnchor, chat)).toThrow(/WORLD_SIMULATION_ANCHOR_STALE|冻结锚点已变化/);
    expect(() => readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, staleAnchor, raw => raw, chat))
      .toThrow(WorldSimulationValidationError_ACU);
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
