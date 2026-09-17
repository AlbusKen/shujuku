import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { FirstFloorWorldSimulationStore_ACU, validateWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/simulation-store';
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
