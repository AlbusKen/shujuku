import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  available: vi.fn(),
  list: vi.fn(),
  entries: vi.fn(),
}));
vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  isWorldbookApiAvailable_ACU: gateway.available,
  listLorebooks_ACU: gateway.list,
  getLorebookEntriesRequired_ACU: gateway.entries,
}));

import { buildDefaultWorldSimulationSettings_ACU } from '../../../src/service/simulation/defaults';
import { createWorldSimulationHostToolDependencies_ACU } from '../../../src/service/simulation/world-simulation-host-tools';

function fixture(overrides: Record<string, unknown> = {}) {
  const webClient = {
    searchEncyclopedia: vi.fn(async () => ({ hits: [], note: 'empty' })),
    readEncyclopedia: vi.fn(async () => ({ text: '', truncated: false, note: 'empty' })),
    webSearch: vi.fn(async () => ({ hits: [], note: 'empty' })),
    webRead: vi.fn(async () => ({ text: '', truncated: false, note: 'empty' })),
  };
  const context: any = {
    anchorMessage: '', summary: '', ledger: {}, stagePlan: {}, candidates: [], chronicle: [], projectionPreview: {},
    webResearch: { ...buildDefaultWorldSimulationSettings_ACU().webResearch, enabled: true }, webClient,
    ...overrides,
  };
  return { dependencies: createWorldSimulationHostToolDependencies_ACU(context), webClient, context };
}

describe('世界推演宿主工具适配器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.available.mockReturnValue(false);
    gateway.list.mockResolvedValue([]);
    gateway.entries.mockResolvedValue([]);
  });

  it('strict 世界书读取区分依赖不可用、缺失与精确成功', async () => {
    const { dependencies } = fixture();
    expect(await dependencies.read('worldbook:entry:book:1')).toMatchObject({ status: 'dependency_unavailable' });
    gateway.available.mockReturnValue(true);
    expect(await dependencies.read('worldbook:entry:book:1')).toMatchObject({ status: 'empty' });
    gateway.entries.mockResolvedValue([{ uid: 1, name: '条目', content: '正文' }]);
    expect(await dependencies.read('worldbook:entry:book:1')).toMatchObject({ status: 'ok', exact: true, content: '条目\n正文' });
  });

  it('百科精读遵守单源开关且不会调用被禁用来源', async () => {
    const settings = buildDefaultWorldSimulationSettings_ACU().webResearch;
    const { dependencies, webClient } = fixture({ webResearch: { ...settings, enabled: true, sources: { ...settings.sources, moegirl: false } } });
    expect(await dependencies.read('encyclopedia:entry:moegirl:title')).toMatchObject({ status: 'dependency_unavailable', summary: 'encyclopedia source disabled: moegirl' });
    expect(webClient.readEncyclopedia).not.toHaveBeenCalled();
  });

  it('部分来源不可用但其他来源命中时返回 ok 并保留诊断', async () => {
    const { dependencies, webClient } = fixture();
    webClient.webSearch.mockResolvedValue({ hits: [{ title: '命中', url: 'https://example.com', summary: '摘要' }], note: '' });
    const result = await dependencies.search('线索', ['worldbook', 'web'], 5, false);
    expect(result).toMatchObject({ status: 'ok', summary: 'worldbook api unavailable' });
    expect(result.hits[0]?.address).toBe('web:url:https%3A%2F%2Fexample.com');
  });

  it('空白查询在调用任何外部依赖前返回 empty', async () => {
    const { dependencies, webClient } = fixture();
    expect(await dependencies.search('   ', [], 5, false)).toEqual({ status: 'empty', hits: [], summary: 'empty query' });
    expect(gateway.list).not.toHaveBeenCalled();
    expect(webClient.webSearch).not.toHaveBeenCalled();
  });

  it('全部无命中时按 failed 优先于 dependency_unavailable', async () => {
    const { dependencies, webClient } = fixture();
    webClient.webSearch.mockResolvedValue({ hits: [], note: 'http-500' });
    expect(await dependencies.search('线索', ['worldbook', 'web'], 5, false)).toMatchObject({ status: 'failed' });
  });
});
