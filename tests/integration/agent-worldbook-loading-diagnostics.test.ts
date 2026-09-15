import { afterEach, describe, expect, it, vi } from 'vitest';
import { _set_TavernHelper_API_ACU } from '../../src/shared/host-api';
import * as settings from '../../src/service/settings/settings-readers';
import { loadAgentWorldbookSnapshot_ACU } from '../../src/service/continuation/agent/agent-worldbook-read';

// Exercise the production loader/pipeline, not a prebuilt snapshot.
afterEach(() => { vi.restoreAllMocks(); _set_TavernHelper_API_ACU(undefined as any); });
function host(read: ReturnType<typeof vi.fn>, names = ['设定集']) {
  vi.spyOn(settings, 'getCurrentWorldbookConfig_ACU').mockReturnValue({ source: 'manual', manualSelection: ['设定集'], enabledEntries: {} } as any);
  _set_TavernHelper_API_ACU({ getLorebooks: async () => names, getLorebookEntries: read } as any);
}
describe('shared Agent worldbook loading diagnostics', () => {
  it('loads existing enabled data through the real pipeline', async () => {
    const read = vi.fn().mockResolvedValue([{ uid: 7, enabled: true, comment: '港口规则', keys: ['港口'], content: '夜间封锁', type: 'constant' }]);
    host(read);
    const result = await loadAgentWorldbookSnapshot_ACU();
    expect(read).toHaveBeenCalledWith('设定集');
    expect(result.available).toBe(true);
    expect(result.entries).toMatchObject([{ bookName: '设定集', uid: '7', content: '夜间封锁' }]);
  });
  it('does not mask a host read rejection as an available empty snapshot', async () => {
    const read = vi.fn().mockRejectedValue(new Error('diagnostic host read failure'));
    host(read);
    const result = await loadAgentWorldbookSnapshot_ACU();
    expect(result.available).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.failure?.status).toBe('read_failed');
    expect(result.failure?.failedBooks).toBe(1);
    expect(read).toHaveBeenCalledWith('设定集');
  });
  it('does not treat a selected book absent from a nonempty host list as an available empty snapshot', async () => {
    const read = vi.fn().mockResolvedValue([{ uid: 7, enabled: true, content: '数据仍存在' }]);
    host(read, ['另一本书']);
    const result = await loadAgentWorldbookSnapshot_ACU();
    expect(result.available).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.failure?.status).toBe('invalid_selection');
    expect(result.failure?.invalidBookNames).toBe(1);
    expect(read).not.toHaveBeenCalled();
  });
  it('reports an available empty snapshot when no worldbook is selected', async () => {
    const read = vi.fn();
    vi.spyOn(settings, 'getCurrentWorldbookConfig_ACU').mockReturnValue({ source: 'manual', manualSelection: [], enabledEntries: {} } as any);
    _set_TavernHelper_API_ACU({ getLorebooks: async () => ['设定集'], getLorebookEntries: read } as any);
    await expect(loadAgentWorldbookSnapshot_ACU()).resolves.toEqual({ available: true, entries: [] });
    expect(read).not.toHaveBeenCalled();
  });
});
