import { afterEach, describe, expect, it, vi } from 'vitest';
const { host } = vi.hoisted(() => ({ host: {} as any }));
vi.mock('../../src/shared/runtime-env', () => ({ getHostWindow: () => host }));
import { buildTavernHelperCompat_ACU } from '../../src/shared/host-compat/tavern-helper-compat';
import { _set_TavernHelper_API_ACU } from '../../src/shared/host-api';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../src/data/gateways/character-gateway';
import { getLorebookEntriesStrict_ACU } from '../../src/service/worldbook/pipeline';

function makeNativeContext(loadWorldInfo = vi.fn()) {
  return {
    loadWorldInfo,
    saveWorldInfo: vi.fn(),
    executeSlashCommandsWithOptions: vi.fn(),
    chat: [],
    characters: [],
  };
}

afterEach(() => {
  _set_TavernHelper_API_ACU(undefined as any);
});

describe('世界书统一宿主链路', () => {
  it('绑定与严格读取统一使用宿主新鲜数据，不读取助手或 loadWorldInfo 缓存', async () => {
    const nativeLoadWorldInfo = vi.fn().mockResolvedValue(null);
    host.location = { href: 'https://tavern.test/', origin: 'https://tavern.test' };
    host.fetch = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith('/api/settings/get') ? { world_names: ['目标书'] }
        : { entries: { 1: { uid: 1, content: '宿主新鲜内容' } } },
    }));
    host.document = {
      createElement: () => ({ remove: vi.fn() }),
      head: { appendChild: () => {
        const key = Object.keys(host).find(key => key.startsWith('__ACU_WI_MODULE_'))!;
        host[key].resolve({ world_info: {} });
      } },
    };
    const context = { ...makeNativeContext(nativeLoadWorldInfo), getRequestHeaders: () => ({}), characterId: 0,
      characters: [{ avatar: '角色.png', data: { extensions: { world: '目标书' } } }] };
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '目标书', additional: [] }),
      getLorebookEntries: vi.fn().mockResolvedValue([{ uid: 1, content: '来自 raw TavernHelper' }]),
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => context);
    _set_TavernHelper_API_ACU(api as any);

    await expect(getCurrentCharacterWorldbookBinding_ACU()).resolves.toMatchObject({
      orderedNames: ['目标书'],
      apiSource: 'getCharWorldbookNames',
    });
    await expect(getLorebookEntriesStrict_ACU(['目标书'], {
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'raw-host-chain',
    })).resolves.toMatchObject({
      status: 'success',
      entriesByBook: { '目标书': [{ uid: 1, content: '宿主新鲜内容' }] },
    });
    expect(rawTH.getLorebookEntries).not.toHaveBeenCalled();
    expect(nativeLoadWorldInfo).not.toHaveBeenCalled();
  });

  it('宿主缺少请求能力时严格链路报告 API 不可用，不退回缓存', async () => {
    const nativeLoadWorldInfo = vi.fn().mockResolvedValue({ entries: { 1: { uid: 1 } } });
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '目标书', additional: [] }),
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => makeNativeContext(nativeLoadWorldInfo));
    _set_TavernHelper_API_ACU(api as any);

    const result = await getLorebookEntriesStrict_ACU(['目标书'], {
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'missing-raw-read',
    });

    expect(result.status).toBe('read_failed');
    expect(result.failedBooks).toEqual([{ bookName: '目标书', errorCategory: 'api_unavailable' }]);
    expect(nativeLoadWorldInfo).not.toHaveBeenCalled();
  });
});
