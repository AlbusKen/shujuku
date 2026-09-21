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
} from '../../../src/service/simulation/simulation-store';
import { WORLD_CHRONICLE_OVERVIEW_CAP_ACU, WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

describe('world simulation envelope store', () => {
  beforeEach(() => _set_SillyTavern_API_ACU(undefined));

  it('accepts the default closed envelope and rejects unknown fields', () => {
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    expect(validateWorldSimulationEnvelope_ACU(envelope)).toEqual(envelope);
    expect(() => validateWorldSimulationEnvelope_ACU({ ...envelope, unexpected: true })).toThrow(WorldSimulationValidationError_ACU);
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

  it('读取 v1 账本时内存归一化为 v3，且不写回原对象', () => {
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
    expect(next.schemaVersion).toBe(3);
    expect(next.clock.day).toBe(3);
    expect(next.clock.slot).toBe('');
    expect(next.rumors).toEqual([]);
    expect(next.player).toMatchObject({ location: null, contact: 'open', locationUpdatedAtDay: 3, regionVisits: [] });
    expect(next.guidance.signals).toEqual([{ text: '风声', voice: 'ambient' }]);
    expect(next.chronicleOverview).toEqual([]);
    expect(raw).toEqual(snapshot);
  });

  it('读取 v2 账本时补 chronicleOverview 空数组归一化为 v3，且不写回原对象', () => {
    const raw: any = {
      ...buildEmptyWorldSimulationLedger_ACU(),
      schemaVersion: 2,
    };
    delete raw.chronicleOverview;
    const snapshot = JSON.parse(JSON.stringify(raw));
    const next = validateWorldSimulationLedger_ACU(raw);
    expect(next.schemaVersion).toBe(3);
    expect(next.chronicleOverview).toEqual([]);
    expect(raw).toEqual(snapshot);
    expect(raw).not.toHaveProperty('chronicleOverview');
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
