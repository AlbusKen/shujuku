import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import {
  FirstFloorWorldSimulationStore_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  readWorldSimulationBucketEntry_ACU,
  resolveCurrentWorldSimulationAnchor_ACU,
  resolveWorldSimulationAnchor_ACU,
  validateWorldSimulationEnvelope_ACU,
  writeWorldSimulationBucketEntry_ACU,
} from '../../../src/service/simulation/simulation-store';
import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
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
});
