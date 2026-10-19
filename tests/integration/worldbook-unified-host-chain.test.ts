import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  Object.keys(host).forEach(key => delete host[key]);
});

afterEach(() => {
  _set_TavernHelper_API_ACU(undefined as any);
});

describe('世界书统一宿主链路', () => {
  it('绑定与严格读取统一使用原生模块，不调用助手或额外 HTTP 链', async () => {
    const nativeLoadWorldInfo = vi.fn().mockResolvedValue({ entries: { 1: { uid: 1, content: '宿主编辑内容' } } });
    const contextLoadWorldInfo = vi.fn();
    const worldInfoModule = { world_names: ['目标书', '附加书'],
      world_info: { charLore: [{ name: '角色', extraBooks: ['附加书'] }] }, loadWorldInfo: nativeLoadWorldInfo };
    host.location = { href: 'https://tavern.test/', origin: 'https://tavern.test' };
    host.fetch = vi.fn(() => { throw new Error('不得自行读取 HTTP 接口'); });
    host.document = {
      createElement: () => ({ remove: vi.fn() }),
      head: { appendChild: () => {
        const key = Object.keys(host).find(key => key.startsWith('__ACU_WI_MODULE_'))!;
        host[key].resolve(worldInfoModule);
      } },
    };
    const context = { ...makeNativeContext(contextLoadWorldInfo), characterId: 0,
      characters: [{ avatar: '角色.png', data: { extensions: { world: '目标书' } } }] };
    const rawTH = {
      getCharWorldbookNames: vi.fn().mockResolvedValue({ primary: '目标书', additional: [] }),
      getLorebookEntries: vi.fn().mockResolvedValue([{ uid: 1, content: '来自 raw TavernHelper' }]),
      getWorldbook: vi.fn(),
    };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => context);
    _set_TavernHelper_API_ACU(api as any);

    await expect(getCurrentCharacterWorldbookBinding_ACU()).resolves.toMatchObject({
      orderedNames: ['目标书', '附加书'],
      apiSource: 'getCharWorldbookNames',
    });
    await expect(getLorebookEntriesStrict_ACU(['目标书'], {
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'raw-host-chain',
    })).resolves.toMatchObject({
      status: 'success',
      entriesByBook: { '目标书': [{ uid: 1, content: '宿主编辑内容' }] },
    });
    expect(rawTH.getLorebookEntries).not.toHaveBeenCalled();
    expect(rawTH.getWorldbook).not.toHaveBeenCalled();
    expect(rawTH.getCharWorldbookNames).not.toHaveBeenCalled();
    expect(nativeLoadWorldInfo).toHaveBeenCalledWith('目标书');
    expect(contextLoadWorldInfo).not.toHaveBeenCalled();
    expect(host.fetch).not.toHaveBeenCalled();
  });

  it('宿主缺少模块加载能力时严格链路报告 API 不可用，不退回助手', async () => {
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
