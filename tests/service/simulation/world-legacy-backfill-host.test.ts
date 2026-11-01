import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { getWorldSimulationRuntime_ACU } from '../../../src/service/simulation/simulation-runtime';
import { foldWorldSimulationLedger_ACU } from '../../../src/service/simulation/simulation-ledger-fold';
import { readLatestWorldSimulationMaterials_ACU } from '../../../src/service/simulation/agent/agent-module-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function fixture() {
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  envelope.ledger.dimensions = [{ id: 'pressure', name: '旧压力', kind: 'pressure', value: 2,
    trend: 'stable', rationale: '已确认旧局势', evidenceRefs: [], revision: 2 }];
  const chat: any[] = [{ _qrf_world_simulation: envelope }, { is_user: false, message_id: 11, swipe_id: 0, mes: '已经保存的正文。' }];
  let remote = structuredClone(chat);
  const save = vi.fn(async () => { remote = structuredClone(chat); });
  const api: any = { chat, chatId: 'backfill-host', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'backfill-host.png', name: '补迁角色' }], getCurrentChatId: () => api.chatId, saveChat: save,
    getRequestHeaders: () => ({}), extensionSettings: {} };
  _set_SillyTavern_API_ACU(api);
  vi.stubGlobal('location', { href: 'https://tavern.test/', origin: 'https://tavern.test' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));
  return { chat, api, save, remote: () => remote, runtime: getWorldSimulationRuntime_ACU() };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _set_SillyTavern_API_ACU(undefined); });

describe('普通宿主显式旧资料补迁', () => {
  it('预览零保存，确认后从真实楼层链严格回读，重复无变化零保存', async () => {
    const f = fixture();
    const before = structuredClone(f.chat);
    const plan = f.runtime.previewLegacyBackfill();
    expect(plan.addedEventIds).toHaveLength(1);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.chat).toEqual(before);
    await f.runtime.applyLegacyBackfill();
    expect(f.save).toHaveBeenCalledOnce();
    expect(foldWorldSimulationLedger_ACU(f.chat)!.ledger).toEqual(f.chat[0]._qrf_world_simulation.ledger);
    expect(foldWorldSimulationLedger_ACU(f.remote())!.ledger).toEqual(f.chat[0]._qrf_world_simulation.ledger);
    expect(readLatestWorldSimulationMaterials_ACU(f.remote()).snapshot!.ledger).toEqual(f.chat[0]._qrf_world_simulation.ledger);
    expect(f.runtime.previewLegacyBackfill().changed).toBe(false);
    expect((await f.runtime.applyLegacyBackfill()).changed).toBe(false);
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.chat[1].mes).toBe('已经保存的正文。');
  });

  it('主保存失败后补偿到旧快照，不留下楼层半迁移', async () => {
    const f = fixture();
    const before = structuredClone(f.chat);
    f.runtime.previewLegacyBackfill();
    f.save.mockRejectedValueOnce(new Error('保存失败'));
    await expect(f.runtime.applyLegacyBackfill()).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.chat).toEqual(before);
    expect(f.remote()).toEqual(before);
  });

  it.each(['聊天', 'swipe', '正文', '账本'] as const)('预览后%s变化即拒绝，不迁移另一版本', async kind => {
    const f = fixture();
    f.runtime.previewLegacyBackfill();
    if (kind === '聊天') f.api.chatId = 'other-chat';
    if (kind === 'swipe') f.chat[1].swipe_id = 1;
    if (kind === '正文') f.chat[1].mes = '新正文';
    if (kind === '账本') f.chat[0]._qrf_world_simulation.ledger.clock.day = 2;
    await expect(f.runtime.applyLegacyBackfill()).rejects.toBeTruthy();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.chat[0]._qrf_world_simulation.ledger.worldEvents).toEqual([]);
  });

  it('没有预览或存在暂停任务时不保存', async () => {
    const f = fixture();
    await expect(f.runtime.applyLegacyBackfill()).rejects.toBeTruthy();
    f.chat[0]._qrf_world_simulation.task = { taskId: 'paused', originInstruction: '暂停', status: 'paused',
      createdAt: 1, updatedAt: 1, activeRun: null, stopReason: 'manual' };
    f.runtime.previewLegacyBackfill();
    await expect(f.runtime.applyLegacyBackfill()).rejects.toBeTruthy();
    expect(f.save).not.toHaveBeenCalled();
  });
});
