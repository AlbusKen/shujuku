import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEntriesByBook,
  mockCreated,
  mockDeleted,
  mockGetEntries,
  mockGetCharLorebooks,
  mockGetCurrentCharacterWorldbookBinding,
  mockCreateStrictLorebookReadError,
  mockGetLorebookEntriesStrict,
  mockIsLorebookNotFoundError,
  mockSaveSettings,
  mockSetEntries,
  mockSettings,
} = vi.hoisted(() => ({
  mockEntriesByBook: new Map<string, any[]>(),
  mockCreated: vi.fn(),
  mockDeleted: vi.fn(),
  mockGetEntries: vi.fn(async (bookName: string) => mockEntriesByBook.get(bookName) || []),
  mockGetCharLorebooks: vi.fn(async () => ({ primary: '主世界书', additional: [] })),
  mockGetCurrentCharacterWorldbookBinding: vi.fn(async () => ({
    primary: '主世界书',
    additional: [],
    orderedNames: ['主世界书'],
    apiSource: 'getCharWorldbookNames',
  })),
  mockCreateStrictLorebookReadError: vi.fn((result: any) => new Error(`strict lorebook read failed: ${JSON.stringify(result)}`)),
  mockGetLorebookEntriesStrict: vi.fn(),
  mockIsLorebookNotFoundError: vi.fn((error: any) => String(error?.message || error).includes('Worldbook not found')),
  mockSaveSettings: vi.fn(),
  mockSetEntries: vi.fn(async (bookName: string, patches: any[]) => {
    const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
    mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
  }),
  mockSettings: { plotSettings: {} as any },
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  createLorebookReadGuard_ACU: vi.fn(async () => async (_names?: string[]) => {}),
  listLorebooks_ACU: vi.fn(async () => []),
  getCurrentCharacterWorldbookBinding_ACU: mockGetCurrentCharacterWorldbookBinding,
  getCharLorebooks_ACU: mockGetCharLorebooks,
  isLorebookNotFoundError_ACU: mockIsLorebookNotFoundError,
  getLorebookEntries_ACU: mockGetEntries,
  createLorebookEntries_ACU: vi.fn(async (bookName: string, entries: any[]) => {
    mockCreated(bookName, entries);
    mockEntriesByBook.set(bookName, [...(mockEntriesByBook.get(bookName) || []), ...entries.map((entry, index) => ({ ...entry, uid: entry.uid ?? `new-${index}` }))]);
  }),
  setLorebookEntries_ACU: mockSetEntries,
  deleteLorebookEntries_ACU: vi.fn(async (bookName: string, uids: any[]) => {
    mockDeleted(bookName, uids);
    const uidSet = new Set((uids || []).map(uid => String(uid)));
    mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).filter(entry => !uidSet.has(String(entry.uid))));
  }),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  createStrictLorebookReadError_ACU: mockCreateStrictLorebookReadError,
  getLorebookEntriesStrict_ACU: mockGetLorebookEntriesStrict,
}));

import { createLorebookReadContext_ACU } from '../../../src/service/worldbook/read-context';

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: mockSettings }));
vi.mock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: mockSaveSettings }));

import { getCharLorebooks_ACU, getCurrentCharacterWorldbookBinding_ACU } from '../../../src/data/gateways/worldbook-gateway';
import { buildAgentWorldbookSelectionSignature_ACU } from '../../../src/service/agent/agent-worldbook-snapshot-restore';
import {
  AGENT_WORLDBOOK_CONFIG_COMMENT_ACU,
  deleteAgentWorldbookStateEntry_ACU,
  getAgentPromptTemplateDefaults_ACU,
  readAgentWorldbookStateFromWorldbooks_ACU,
  resolveAgentWorldbookScopeBookNames_ACU,
  setAgentPromptTemplateDefaults_ACU,
  writeAgentWorldbookControlToWorldbook_ACU,
  writeAgentWorldbookStateToWorldbook_ACU,
} from '../../../src/service/agent/agent-worldbook-config-meta';
import { resolveAgentWorldbookFilterAvailability_ACU } from '../../../src/service/agent/agent-worldbook-skill-meta';

function configEntry(content: unknown, uid: any = 'cfg', comment = AGENT_WORLDBOOK_CONFIG_COMMENT_ACU): any {
  return { uid, comment, enabled: false, keys: [], content: JSON.stringify(content) };
}

function activeScopeState(snapshotBooks: Record<string, any[]>, bookNames: string[] = ['主世界书']): any {
  return {
    version: 2,
    kind: 'agent_worldbook_state',
    updatedAt: 1,
    control: { mode: 'agent', worldbookScope: { source: 'character', manualSelection: [] } },
    snapshot: {
      active: true,
      selectionSignature: buildAgentWorldbookSelectionSignature_ACU(bookNames),
      createdAt: 1,
      books: snapshotBooks,
    },
  };
}

describe('agent worldbook config/state meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntriesByBook.clear();
    mockGetCharLorebooks.mockResolvedValue({ primary: '主世界书', additional: [] });
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主世界书',
      additional: [],
      orderedNames: ['主世界书'],
      apiSource: 'getCharWorldbookNames',
    });
    mockIsLorebookNotFoundError.mockImplementation((error: any) => String(error?.message || error).includes('Worldbook not found'));
    mockCreateStrictLorebookReadError.mockImplementation((result: any) => new Error(`strict lorebook read failed: ${JSON.stringify(result)}`));
    mockGetLorebookEntriesStrict.mockImplementation(async (bookNames: string[]) => ({
      status: 'success',
      entriesByBook: Object.fromEntries(bookNames.map(bookName => [bookName, mockEntriesByBook.get(bookName) || []])),
      invalidBookNames: [],
      failedBookNames: [],
    }));
    mockGetEntries.mockImplementation(async (bookName: string) => mockEntriesByBook.get(bookName) || []);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
    });
    mockSettings.plotSettings = {};
    mockSaveSettings.mockReturnValue({ saved: true });
    vi.mocked(getCharLorebooks_ACU).mockResolvedValue({ primary: '主世界书', additional: [] } as any);
  });

  it('reads legacy version 1 config as control with inactive snapshot', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 1,
      kind: 'agent_worldbook_config',
      updatedAt: 1,
      control: { mode: 'agent', agentApiPreset: 'preset-a' },
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.source).toBe('worldbook');
    expect(result.control.mode).toBe('agent');
    expect(result.control.enabled).toBe(true);
    expect(result.control.agentApiPreset).toBe('preset-a');
    expect(result.control.agentDecisionConcurrency).toBe(1);
    expect(result.snapshot).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
  });

  it('跳过已删除的候选世界书并继续从有效书读取 Agent 配置', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '幽灵书',
      additional: ['有效书'],
      orderedNames: ['幽灵书', '有效书'],
      apiSource: 'getCharWorldbookNames',
    });
    mockGetEntries.mockImplementation(async (bookName: string) => {
      if (bookName === '幽灵书') throw new Error('Worldbook not found');
      return mockEntriesByBook.get(bookName) || [];
    });
    mockEntriesByBook.set('有效书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'agent', agentApiPreset: 'valid-book' },
      snapshot: {},
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.source).toBe('worldbook');
    expect(result.bookName).toBe('有效书');
    expect(result.control.agentApiPreset).toBe('valid-book');
  });

  it.each([
    Object.assign(new Error('Worldbook not found'), { name: 'AbortError' }),
    new Error('TaskAbortedByUser'),
    new Error('permission denied'),
  ])('候选世界书读取的取消和非 not-found 错误继续传播', async error => {
    mockGetEntries.mockRejectedValue(error);
    mockIsLorebookNotFoundError.mockReturnValue(false);

    await expect(readAgentWorldbookStateFromWorldbooks_ACU()).rejects.toBe(error);
  });

  it('角色 scope 只使用统一 binding，忽略旧 API 中的幽灵书', async () => {
    vi.mocked(getCurrentCharacterWorldbookBinding_ACU).mockResolvedValue({
      primary: '主世界书',
      additional: ['有效附加书'],
      orderedNames: ['主世界书', '有效附加书'],
      apiSource: 'getCharWorldbookNames',
    });
    vi.mocked(getCharLorebooks_ACU).mockResolvedValue({ primary: '旧主书', additional: ['幽灵书'] } as any);

    await expect(resolveAgentWorldbookScopeBookNames_ACU({
      source: 'character',
      manualSelection: [],
    })).resolves.toEqual(['主世界书', '有效附加书']);
    expect(getCharLorebooks_ACU).not.toHaveBeenCalled();
  });

  it('Agent availability 严格读取链只消费统一 binding，不请求旧 API 的幽灵书', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主世界书',
      additional: ['有效附加书'],
      orderedNames: ['主世界书', '有效附加书'],
      apiSource: 'getCharWorldbookNames',
    });
    mockGetCharLorebooks.mockResolvedValue({ primary: '旧主书', additional: ['幽灵书'] });
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'agent', worldbookScope: { source: 'character', manualSelection: [] } },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    })]);
    mockEntriesByBook.set('有效附加书', [
      { uid: 'entry-1', comment: '没有 Skill 元数据的普通条目', enabled: true, keys: ['有效钥匙'] },
    ]);
    mockGetLorebookEntriesStrict.mockImplementation(async (bookNames: string[]) => {
      if (bookNames.includes('幽灵书') || bookNames.includes('旧主书')) {
        throw new Error('lorebook_not_found');
      }
      return {
        status: 'success',
        entriesByBook: Object.fromEntries(bookNames.map(bookName => [bookName, mockEntriesByBook.get(bookName) || []])),
        invalidBookNames: [],
        failedBookNames: [],
      };
    });
    // 用真实请求级 context：config 扫描与 skill-meta 读同一批书，物理读取由 context 去重为 2 次。
    const readContext = createLorebookReadContext_ACU({ source: 'test_ghost_worldbook' });

    const result = await resolveAgentWorldbookFilterAvailability_ACU(readContext);

    expect(result).toMatchObject({
      available: true,
      reason: 'available',
      bookNames: ['主世界书', '有效附加书'],
    });
    // 新语义（T7-3）：availability 的 config 扫描与 skill-meta 都使用同一 context；
    // 真实 context 按 hostName 去重物理读取。mock 不做去重，因此这里断言
    // 去重后的书集合（而非调用次数），保证不出现 bootstrap 之外的幽灵书。
    const strictBookCallSets = mockGetLorebookEntriesStrict.mock.calls.map(call => call[0]);
    expect([...new Set(strictBookCallSets.flat())]).toEqual(['主世界书', '有效附加书']);
    expect(strictBookCallSets.flat()).not.toContain('幽灵书');
    expect(strictBookCallSets.flat()).not.toContain('旧主书');
    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['主世界书'], expect.objectContaining({
      source: 'agent_runtime', validationPolicy: 'trusted_direct', context: readContext,
    }));
    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['有效附加书'], expect.any(Object));
    expect(mockGetCharLorebooks).not.toHaveBeenCalled();
  });

  it('Agent availability 保留 trusted_direct 严格读取失败，不降级为不可用结果', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主世界书',
      additional: ['失效附加书'],
      orderedNames: ['主世界书', '失效附加书'],
      apiSource: 'getCharWorldbookNames',
    });
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'agent', worldbookScope: { source: 'character', manualSelection: [] } },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    })]);
    const strictFailure = {
      status: 'read_failed',
      source: 'agent_runtime',
      validationPolicy: 'trusted_direct',
      requestedBookNames: ['失效附加书'],
      resolvedBookNames: [],
      entriesByBook: {},
      invalidBookNames: [],
      failedBookNames: ['失效附加书'],
      error: new Error('Worldbook not found: 失效附加书'),
    };
    const strictError = new Error('strict agent runtime lorebook read failed');
    mockCreateStrictLorebookReadError.mockReturnValue(strictError);
    mockGetLorebookEntriesStrict.mockImplementation(async (bookNames: string[]) => {
      if (bookNames[0] === '失效附加书') return strictFailure;
      return {
        status: 'success',
        entriesByBook: { 主世界书: [] },
        invalidBookNames: [],
        failedBookNames: [],
      };
    });
    const readContext = { runId: 'strict-failure-regression', bookEntriesPromises: new Map() };

    await expect(resolveAgentWorldbookFilterAvailability_ACU(readContext)).rejects.toBe(strictError);

    expect(mockGetLorebookEntriesStrict.mock.calls.map(call => call[0])).toEqual([
      ['主世界书'],
      ['失效附加书'],
    ]);
    expect(mockCreateStrictLorebookReadError).toHaveBeenCalledTimes(1);
    expect(mockCreateStrictLorebookReadError).toHaveBeenCalledWith(strictFailure);
  });

  it('preserves persisted Agent concurrency values above the former upper limit', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'agent', agentDecisionConcurrency: 99, maxSkillifyConcurrency: 88 },
      snapshot: {},
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.control.agentDecisionConcurrency).toBe(99);
    expect(result.control.maxSkillifyConcurrency).toBe(88);
  });

  it('reads version 2 state with normalized snapshot', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      control: { mode: 'passive' },
      snapshot: {
        active: true,
        selectionSignature: 'sig-1',
        createdAt: 123,
        books: {
          '剧情书': [
            { uid: 1, previousEnabled: false, previousKeys: [' key ', '', 7], previousType: 'selective', commentHash: ' hash ' },
            { uid: '', previousEnabled: true },
          ],
          '': [{ uid: 9, previousEnabled: true }],
        },
      },
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.control.mode).toBe('passive');
    expect(result.snapshot).toEqual({
      active: true,
      selectionSignature: 'sig-1',
      createdAt: 123,
      books: {
        '剧情书': [
          { uid: 1, previousEnabled: false, previousKeys: ['key', '7'], previousType: 'selective', commentHash: 'hash' },
        ],
      },
    });
  });

  it('reads version 2 state by content identity when comment was renamed', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      identity: {
        marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU,
        hostBookName: '主世界书',
        stateEntryUid: 'cfg-renamed',
      },
      control: { mode: 'agent', agentApiPreset: 'renamed-preset' },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    }, 'cfg-renamed', '用户改过的备注')]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.source).toBe('worldbook');
    expect(result.entryUid).toBe('cfg-renamed');
    expect(result.control.mode).toBe('agent');
    expect(result.control.agentApiPreset).toBe('renamed-preset');
  });

  it('writes renamed state entry by uid without creating a duplicate or overwriting user comment', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      identity: { marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU, hostBookName: '主世界书', stateEntryUid: 'cfg-renamed' },
      control: { mode: 'agent', agentApiPreset: 'old' },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    }, 'cfg-renamed', '用户改过的备注')]);

    const result = await writeAgentWorldbookControlToWorldbook_ACU({ agentApiPreset: 'new' } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];
    const state = JSON.parse(entries[0].content);

    expect(result.entryUid).toBe('cfg-renamed');
    expect(mockCreated).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
    expect(entries[0].comment).toBe('用户改过的备注');
    expect(state.identity).toMatchObject({ marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU, hostBookName: '主世界书', stateEntryUid: 'cfg-renamed' });
    expect(state.control.agentApiPreset).toBe('new');
  });

  it('对已归一为空串的状态条目仍写入既有规范 comment，不写回异常原值', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      identity: { marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU, hostBookName: '主世界书', stateEntryUid: 'cfg-normalized' },
      control: { mode: 'agent', agentApiPreset: 'old' },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    }, 'cfg-normalized', '')]);

    await writeAgentWorldbookControlToWorldbook_ACU({ agentApiPreset: 'new' } as any);

    const entries = mockEntriesByBook.get('主世界书') || [];
    expect(entries[0].comment).toBe(AGENT_WORLDBOOK_CONFIG_COMMENT_ACU);
    expect(mockSetEntries).toHaveBeenCalledWith('主世界书', [expect.objectContaining({
      uid: 'cfg-normalized',
      comment: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU,
    })]);
  });

  it('writes control without losing existing snapshot', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      control: { mode: 'agent', agentApiPreset: 'old' },
      snapshot: { active: true, selectionSignature: 'sig-2', createdAt: 456, books: { '剧情书': [{ uid: 2, previousEnabled: true, previousKeys: ['A'] }] } },
    }, 'cfg-1')]);

    const result = await writeAgentWorldbookControlToWorldbook_ACU({ agentApiPreset: 'new' } as any);
    const state = JSON.parse((mockEntriesByBook.get('主世界书') || [])[0].content);

    expect(result.updated).toBe(true);
    expect(result.entryUid).toBe('cfg-1');
    expect(state.version).toBe(2);
    expect(state.kind).toBe('agent_worldbook_state');
    expect(state.control.agentApiPreset).toBe('new');
    expect(state.snapshot).toMatchObject({ active: true, selectionSignature: 'sig-2', books: { '剧情书': [{ uid: 2, previousEnabled: true, previousKeys: ['A'] }] } });
  });

  it('writes snapshot without losing existing control', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      control: { mode: 'agent', agentApiPreset: 'keep-me' },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    }, 'cfg-1')]);

    const result = await writeAgentWorldbookStateToWorldbook_ACU({
      snapshot: { active: true, selectionSignature: 'sig-3', createdAt: 789, books: { '剧情书': [{ uid: 3, previousEnabled: true }] } },
    });
    const state = JSON.parse((mockEntriesByBook.get('主世界书') || [])[0].content);

    expect(result.updated).toBe(true);
    expect(state.control.agentApiPreset).toBe('keep-me');
    expect(state.control.mode).toBe('agent');
    expect(state.snapshot).toMatchObject({ active: true, selectionSignature: 'sig-3', books: { '剧情书': [{ uid: 3, previousEnabled: true }] } });
    expect(JSON.parse((mockEntriesByBook.get('主世界书') || [])[0].content).snapshot.books['剧情书']).toEqual([
      { uid: 3, previousEnabled: true, previousKeys: [] },
    ]);
  });

  it('overwrites an existing empty state snapshot with the active takeover snapshot content', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 2,
      control: { mode: 'agent', agentApiPreset: 'keep-me' },
      snapshot: { active: false, selectionSignature: '', createdAt: 0, books: {} },
    }, 'cfg-1')]);

    const activeSnapshot = {
      active: true,
      selectionSignature: 'sig-active',
      createdAt: 999,
      books: { '娇妻沦为仇敌性奴': [{ uid: 52, previousEnabled: true, previousKeys: ['钥匙52'], previousType: 'selective', commentHash: 'hash:旧备注' }] },
    };

    const result = await writeAgentWorldbookStateToWorldbook_ACU({ snapshot: activeSnapshot });
    const state = JSON.parse((mockEntriesByBook.get('主世界书') || [])[0].content);

    expect(result.updated).toBe(true);
    expect(result.snapshot).toEqual(activeSnapshot);
    expect(state.snapshot).toEqual(activeSnapshot);
  });

  it('creates version 2 state entry when no config entry exists', async () => {
    mockEntriesByBook.set('主世界书', [{ uid: 1, comment: '普通条目', enabled: true }]);

    const result = await writeAgentWorldbookStateToWorldbook_ACU({
      control: { mode: 'agent' } as any,
      snapshot: { active: true, selectionSignature: 'sig-4', createdAt: 1, books: { '剧情书': [{ uid: 4, previousEnabled: true, previousKeys: ['K4'] }] } },
    });

    expect(result.updated).toBe(true);
    expect(mockCreated).toHaveBeenCalledTimes(1);
    const created = (mockEntriesByBook.get('主世界书') || []).find(entry => entry.comment === AGENT_WORLDBOOK_CONFIG_COMMENT_ACU);
    expect(result.entryUid).toBe('new-0');
    expect(JSON.parse(created.content)).toMatchObject({
      version: 2,
      kind: 'agent_worldbook_state',
      identity: {
        marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU,
        hostBookName: '主世界书',
        stateEntryUid: 'new-0',
      },
      control: { mode: 'agent' },
      snapshot: { active: true, selectionSignature: 'sig-4', books: { '剧情书': [{ uid: 4, previousEnabled: true, previousKeys: ['K4'] }] } },
    });
  });

  it('changes scope only after restoring the active snapshot in the previous scope', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockEntriesByBook.set('主世界书', [
      configEntry({
        version: 2,
        kind: 'agent_worldbook_state',
        updatedAt: 1,
        control: { mode: 'agent', worldbookScope: { source: 'character', manualSelection: [] } },
        snapshot: {
          active: true,
          selectionSignature: buildAgentWorldbookSelectionSignature_ACU(['主世界书']),
          createdAt: 1,
          books: { '主世界书': [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }] },
        },
      }, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];
    const state = JSON.parse(entries.find(entry => entry.uid === 'cfg').content);
    const restored = entries.find(entry => entry.uid === 'entry-1');

    expect(result.updated).toBe(true);
    expect(state.control.worldbookScope).toEqual({ source: 'manual', manualSelection: ['手动书'] });
    expect(state.snapshot).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    expect(restored).toMatchObject({ enabled: true, keys: ['旧关键词'], type: 'selective' });
    expect(restored.comment).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META_START');
  });

  it('rolls back restored entries when writing the changed scope state entry fails', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
    });
    mockEntriesByBook.set('主世界书', [
      configEntry(initialState, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (bookName === '主世界书' && patches.some(patch => patch.uid === 'cfg')) throw new Error('config write failed');
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];
    const persisted = JSON.parse(entries.find(entry => entry.uid === 'cfg').content);
    const target = entries.find(entry => entry.uid === 'entry-1');

    expect(result).toMatchObject({ updated: false, reason: 'scope_state_write_failed' });
    expect(persisted).toEqual(initialState);
    expect(target).toEqual({ uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' });
  });

  it('rolls back restored entries when the config write resolves without changing the state entry', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
    });
    mockEntriesByBook.set('主世界书', [
      configEntry(initialState, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (patches.some(patch => patch.uid === 'cfg')) return;
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];

    expect(result).toMatchObject({ updated: false, reason: 'scope_state_write_unconfirmed' });
    expect(JSON.parse(entries.find(entry => entry.uid === 'cfg').content)).toEqual(initialState);
    expect(entries.find(entry => entry.uid === 'entry-1')).toEqual({ uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' });
  });

  it('reports rollback failure when the config write and restored-entry rollback both fail confirmation', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockEntriesByBook.set('主世界书', [
      configEntry(activeScopeState({
        主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      }), 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (patches.some(patch => patch.uid === 'cfg')) throw new Error('config write failed');
      if (patches.some(patch => patch.uid === 'entry-1' && patch.enabled === false)) return;
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);

    expect(result).toMatchObject({ updated: false, reason: 'scope_state_write_rollback_failed' });
    expect((mockEntriesByBook.get('主世界书') || []).find(entry => entry.uid === 'entry-1')).toMatchObject({
      enabled: true,
      keys: ['旧关键词'],
      type: 'selective',
    });
  });

  it('accepts a scope switch when the config write commits before its gateway response rejects', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockEntriesByBook.set('主世界书', [
      configEntry(activeScopeState({
        主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      }), 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      const reverseObjectKeys = (value: any): any => {
        if (Array.isArray(value)) return value.map(reverseObjectKeys);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reverseObjectKeys(nested)]));
      };
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => {
        const written = patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry;
        if (written.uid !== 'cfg') return written;
        const state = JSON.parse(written.content);
        state.control = reverseObjectKeys(state.control);
        return { ...written, content: JSON.stringify(state) };
      }));
      if (patches.some(patch => patch.uid === 'cfg')) throw new Error('response lost after commit');
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
      contextSettings: { agentAiMaxRetries: 4 },
    } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];
    const state = JSON.parse(entries.find(entry => entry.uid === 'cfg').content);

    expect(result.updated).toBe(true);
    expect(state.control.worldbookScope).toEqual({ source: 'manual', manualSelection: ['手动书'] });
    expect(state.snapshot).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    expect(entries.find(entry => entry.uid === 'entry-1')).toMatchObject({ enabled: true, keys: ['旧关键词'], type: 'selective' });
  });

  it('repairs a recognized partial scope write when another submitted control field was lost', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    let configWriteCount = 0;
    mockEntriesByBook.set('主世界书', [
      configEntry(activeScopeState({
        主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
      }), 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => {
        const patch = patchByUid.get(String(entry.uid));
        if (!patch) return entry;
        if (patch.uid !== 'cfg') return { ...entry, ...patch };
        const written = { ...entry, ...patch };
        if (configWriteCount++ === 0) {
          const state = JSON.parse(written.content);
          delete state.control.agentApiPreset;
          written.content = JSON.stringify(state);
        }
        return written;
      }));
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
      agentApiPreset: 'new-preset',
    } as any);
    const state = JSON.parse((mockEntriesByBook.get('主世界书') || []).find(entry => entry.uid === 'cfg').content);
    const restored = (mockEntriesByBook.get('主世界书') || []).find(entry => entry.uid === 'entry-1');

    expect(result.updated).toBe(true);
    expect(state.control.worldbookScope).toEqual({ source: 'manual', manualSelection: ['手动书'] });
    expect(state.control.agentApiPreset).toBe('new-preset');
    expect(state.snapshot).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    expect(restored).toMatchObject({ enabled: true, keys: ['旧关键词'], type: 'selective' });
  });


  it.each([
    ['next', undefined],
    ['current', undefined],
    ['partial_next', false],
    ['missing', false],
    ['unknown', false],
  ] as const)('handles a repair write reject-after-commit when readback is %s', async (repairState, expectedStateConfirmed) => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
    });
    let configWriteCount = 0;
    mockEntriesByBook.set('主世界书', [
      configEntry(initialState, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      const configPatch = patches.find(patch => patch.uid === 'cfg');
      if (!configPatch) {
        const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
        mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
        return;
      }
      const written = { ...(mockEntriesByBook.get(bookName) || []).find(entry => entry.uid === 'cfg'), ...configPatch };
      const state = JSON.parse(written.content);
      if (configWriteCount++ === 0 || repairState === 'partial_next') {
        delete state.control.agentApiPreset;
        written.content = JSON.stringify(state);
      } else if (repairState === 'current') {
        written.content = JSON.stringify(initialState);
      } else if (repairState === 'unknown') {
        state.control.agentApiPreset = 'foreign-preset';
        written.content = JSON.stringify(state);
      }
      const nextEntries = (mockEntriesByBook.get(bookName) || []).filter(entry => entry.uid !== 'cfg');
      if (repairState !== 'missing' || configWriteCount === 1) nextEntries.unshift(written);
      mockEntriesByBook.set(bookName, nextEntries);
      if (configWriteCount === 2) throw new Error('repair response lost after commit');
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
      agentApiPreset: 'new-preset',
    } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];
    const config = entries.find(entry => entry.uid === 'cfg');
    const restored = entries.find(entry => entry.uid === 'entry-1');

    if (repairState === 'next') {
      const persisted = JSON.parse(config.content);
      expect(result.updated).toBe(true);
      expect(persisted.control.agentApiPreset).toBe('new-preset');
      expect(restored).toMatchObject({ enabled: true, keys: ['旧关键词'], type: 'selective' });
      return;
    }
    expect(result).toMatchObject({ updated: false, reason: 'scope_state_write_unconfirmed', stateConfirmed: expectedStateConfirmed });
    if (repairState === 'current') {
      expect(JSON.parse(config.content)).toEqual(initialState);
      expect(restored).toEqual({ uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' });
      return;
    }
    if (repairState === 'missing') {
      expect(config).toBeUndefined();
    } else {
      const persisted = JSON.parse(config.content);
      expect(persisted.control.worldbookScope).toEqual({ source: 'manual', manualSelection: ['手动书'] });
      expect(persisted.snapshot).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
      expect(persisted.control.agentApiPreset).toBe(repairState === 'unknown' ? 'foreign-preset' : undefined);
    }
    expect(restored).toMatchObject({ enabled: true, keys: ['旧关键词'], type: 'selective' });
  });

  it('does not report success or blindly roll back when the state entry disappears after restore', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
    });
    mockEntriesByBook.set('主世界书', [
      configEntry(initialState, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (patches.some(patch => patch.uid === 'cfg')) {
        mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).filter(entry => entry.uid !== 'cfg'));
        return;
      }
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);
    const entries = mockEntriesByBook.get('主世界书') || [];

    expect(result).toMatchObject({ updated: false, reason: 'scope_state_write_unconfirmed' });
    expect(entries.find(entry => entry.uid === 'cfg')).toBeUndefined();
    expect(entries.find(entry => entry.uid === 'entry-1')).toMatchObject({ enabled: true, keys: ['旧关键词'], type: 'selective' });
  });

  it('rolls back already restored books when restoring another book fails', async () => {
    const mainTakeoverComment = '主书条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const additionalTakeoverComment = '附加书条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'main-entry', previousEnabled: true, previousKeys: ['主书关键词'], previousType: 'selective' }],
      附加书: [{ uid: 'additional-entry', previousEnabled: true, previousKeys: ['附加书关键词'], previousType: 'selective' }],
    }, ['主世界书', '附加书']);
    mockEntriesByBook.set('主世界书', [
      configEntry(initialState, 'cfg'),
      { uid: 'main-entry', comment: mainTakeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    mockEntriesByBook.set('附加书', [
      { uid: 'additional-entry', comment: additionalTakeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
    vi.mocked(getCurrentCharacterWorldbookBinding_ACU).mockResolvedValue({
      primary: '主世界书',
      additional: ['附加书'],
      orderedNames: ['主世界书', '附加书'],
      apiSource: 'getCharWorldbookNames',
    });
    mockSetEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (bookName === '附加书') throw new Error('additional restore failed');
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      mockEntriesByBook.set(bookName, (mockEntriesByBook.get(bookName) || []).map(entry => patchByUid.has(String(entry.uid)) ? { ...entry, ...patchByUid.get(String(entry.uid)) } : entry));
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);
    const mainEntries = mockEntriesByBook.get('主世界书') || [];

    expect(result).toMatchObject({ updated: false, reason: 'scope_restore_incomplete' });
    expect(JSON.parse(mainEntries.find(entry => entry.uid === 'cfg').content)).toEqual(initialState);
    expect(mainEntries.find(entry => entry.uid === 'main-entry')).toEqual({ uid: 'main-entry', comment: mainTakeoverComment, enabled: false, keys: [], type: 'constant' });
    expect(mockEntriesByBook.get('附加书')).toEqual([
      { uid: 'additional-entry', comment: additionalTakeoverComment, enabled: false, keys: [], type: 'constant' },
    ]);
  });

  it('does not restore entries when the target config host read fails before the scope transaction starts', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'entry-1', previousEnabled: true, previousKeys: ['旧关键词'], previousType: 'selective' }],
    });
    const initialEntries = [
      configEntry(initialState, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [], type: 'constant' },
    ];
    mockEntriesByBook.set('主世界书', initialEntries);
    let mainBookReads = 0;
    mockGetEntries.mockImplementation(async (bookName: string) => {
      if (bookName !== '主世界书') return mockEntriesByBook.get(bookName) || [];
      mainBookReads += 1;
      if (mainBookReads === 2) throw new Error('target host read failed');
      return mockEntriesByBook.get(bookName) || [];
    });

    await expect(writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any)).rejects.toThrow('target host read failed');

    expect(mockEntriesByBook.get('主世界书')).toEqual(initialEntries);
    expect(mockSetEntries).not.toHaveBeenCalled();
  });

  it('refuses an active scope switch if its state entry disappears before restore', async () => {
    const takeoverComment = '普通条目\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    const initialState = activeScopeState({
      主世界书: [{ uid: 'entry-1', previousEnabled: true }],
    });
    const initialEntries = [
      configEntry(initialState, 'cfg'),
      { uid: 'entry-1', comment: takeoverComment, enabled: false, keys: [] },
    ];
    mockEntriesByBook.set('主世界书', initialEntries);
    let mainBookReads = 0;
    mockGetEntries.mockImplementation(async (bookName: string) => {
      if (bookName !== '主世界书') return mockEntriesByBook.get(bookName) || [];
      mainBookReads += 1;
      return mainBookReads === 1 ? initialEntries : initialEntries.filter(entry => entry.uid !== 'cfg');
    });

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);

    expect(result).toMatchObject({ updated: false, reason: 'scope_state_entry_missing' });
    expect(mockSetEntries).not.toHaveBeenCalled();
    expect(mockEntriesByBook.get('主世界书')).toEqual(initialEntries);
  });

  it('refuses scope persistence when the active snapshot signature does not match its previous scope', async () => {
    const initialState = {
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'agent', worldbookScope: { source: 'character', manualSelection: [] } },
      snapshot: {
        active: true,
        selectionSignature: 'wrong-signature',
        createdAt: 1,
        books: { '主世界书': [{ uid: 'entry-1', previousEnabled: true }] },
      },
    };
    mockEntriesByBook.set('主世界书', [configEntry(initialState, 'cfg'), { uid: 'entry-1', comment: '普通条目', enabled: false }]);

    const result = await writeAgentWorldbookControlToWorldbook_ACU({
      worldbookScope: { source: 'manual', manualSelection: ['手动书'] },
    } as any);
    const persisted = JSON.parse((mockEntriesByBook.get('主世界书') || []).find(entry => entry.uid === 'cfg').content);

    expect(result).toMatchObject({ updated: false, reason: 'scope_restore_signature_mismatch' });
    expect(persisted).toEqual(initialState);
  });

  it('deletes parseable state entries even when comment was renamed', async () => {
    mockEntriesByBook.set('主世界书', [
      configEntry({ version: 2, kind: 'agent_worldbook_state', updatedAt: 1, identity: { marker: AGENT_WORLDBOOK_CONFIG_COMMENT_ACU, hostBookName: '主世界书', stateEntryUid: 'cfg-1' }, control: {}, snapshot: {} }, 'cfg-1', '用户改过的备注'),
      { uid: 'normal', comment: '普通条目' },
    ]);

    const deleted = await deleteAgentWorldbookStateEntry_ACU('主世界书');

    expect(deleted).toBe(1);
    expect(mockDeleted).toHaveBeenCalledWith('主世界书', ['cfg-1']);
    expect(mockEntriesByBook.get('主世界书')).toEqual([{ uid: 'normal', comment: '普通条目' }]);
  });

  it('deletes all exact state entries in the target book only', async () => {
    mockEntriesByBook.set('主世界书', [
      configEntry({ version: 2, kind: 'agent_worldbook_state', updatedAt: 1, control: {}, snapshot: {} }, 'cfg-1'),
      configEntry({ version: 2, kind: 'agent_worldbook_state', updatedAt: 1, control: {}, snapshot: {} }, 'cfg-2'),
      { uid: 'normal', comment: 'TavernDB-ACU-AgentWorldbookConfig-用户条目' },
    ]);

    const deleted = await deleteAgentWorldbookStateEntry_ACU('主世界书');

    expect(deleted).toBe(2);
    expect(mockDeleted).toHaveBeenCalledWith('主世界书', ['cfg-1', 'cfg-2']);
    expect(mockEntriesByBook.get('主世界书')).toEqual([{ uid: 'normal', comment: 'TavernDB-ACU-AgentWorldbookConfig-用户条目' }]);
  });

  it('未传 bookName 时会扫描角色 all lorebooks 与 manualSelection 中残留的 state/config，但不误删相似前缀', async () => {
    vi.mocked(getCharLorebooks_ACU).mockResolvedValue({ primary: '', additional: ['旧附加书'] } as any);
    mockSettings.plotSettings = {
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['手动书'],
      },
    };
    mockEntriesByBook.set('主世界书', [{ uid: 'normal-main', comment: '普通条目' }]);
    mockEntriesByBook.set('手动书', [
      configEntry({ version: 2, kind: 'agent_worldbook_state', updatedAt: 1, control: {}, snapshot: {} }, 'manual-cfg'),
      { uid: 'manual-normal', comment: 'TavernDB-ACU-AgentWorldbookConfig-用户条目' },
    ]);
    mockEntriesByBook.set('旧附加书', [
      configEntry({ version: 1, kind: 'agent_worldbook_config', updatedAt: 1, control: {} }, 'legacy-cfg'),
      { uid: 'additional-normal', comment: '普通条目' },
    ]);

    const deleted = await deleteAgentWorldbookStateEntry_ACU();

    expect(deleted).toBe(2);
    expect(mockDeleted).toHaveBeenCalledWith('手动书', ['manual-cfg']);
    expect(mockDeleted).toHaveBeenCalledWith('旧附加书', ['legacy-cfg']);
    expect(mockEntriesByBook.get('手动书')).toEqual([{ uid: 'manual-normal', comment: 'TavernDB-ACU-AgentWorldbookConfig-用户条目' }]);
    expect(mockEntriesByBook.get('旧附加书')).toEqual([{ uid: 'additional-normal', comment: '普通条目' }]);
  });

  it('缺失世界书提示词字段时读取全局模板，显式空数组则保留当前世界书覆盖', async () => {
    mockSettings.plotSettings.agentPromptTemplates = {
      agentDecisionPromptSegments: [{ role: 'system', content: 'global decision', deletable: false }],
      agentSkillifyPromptSegments: [{ role: 'user', content: 'global skillify', deletable: true }],
    };
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'passive', agentSkillifyPromptSegments: [] },
      snapshot: {},
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.control.agentDecisionPromptSegments).toEqual([{ role: 'system', content: 'global decision', deletable: false }]);
    expect(result.control.agentSkillifyPromptSegments).toEqual([]);
  });

  it('未显式提交提示词字段时，首次创建状态条目不物化全局模板', async () => {
    mockSettings.plotSettings.agentPromptTemplates = {
      agentDecisionPromptSegments: [{ role: 'system', content: 'global decision', deletable: false }],
      agentSkillifyPromptSegments: [{ role: 'user', content: 'global skillify', deletable: true }],
    };

    await writeAgentWorldbookControlToWorldbook_ACU({ mode: 'agent' } as any);

    const state = JSON.parse((mockEntriesByBook.get('主世界书') || [])[0].content);
    expect(state.control).not.toHaveProperty('agentDecisionPromptSegments');
    expect(state.control).not.toHaveProperty('agentSkillifyPromptSegments');
  });

  it('显式空提示词数组会持久化为当前世界书覆盖', async () => {
    await writeAgentWorldbookControlToWorldbook_ACU({
      agentDecisionPromptSegments: [],
      agentSkillifyPromptSegments: [],
    } as any);

    const state = JSON.parse((mockEntriesByBook.get('主世界书') || [])[0].content);
    expect(state.control.agentDecisionPromptSegments).toEqual([]);
    expect(state.control.agentSkillifyPromptSegments).toEqual([]);
  });

  it('全局提示词模板保存失败时回滚内存状态', () => {
    const previous = {
      agentDecisionPromptSegments: [{ role: 'system', content: 'previous decision', deletable: false }],
      agentSkillifyPromptSegments: [{ role: 'user', content: 'previous skillify', deletable: true }],
    };
    mockSettings.plotSettings.agentPromptTemplates = previous;
    mockSaveSettings.mockReturnValue({ saved: false });

    const saved = setAgentPromptTemplateDefaults_ACU({
      agentDecisionPromptSegments: [{ role: 'system', content: 'next decision', deletable: false }],
      agentSkillifyPromptSegments: [{ role: 'user', content: 'next skillify', deletable: true }],
    });

    expect(saved).toBe(false);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockSettings.plotSettings.agentPromptTemplates).toBe(previous);
    expect(getAgentPromptTemplateDefaults_ACU()).toEqual(previous);
  });
});

  it('bootstrap 严格读取：候选书全部 not-found 时隔离为 stale 并继续（不落 unknown）', async () => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主世界书',
      additional: ['有效书'],
      orderedNames: ['主世界书', '有效书'],
      apiSource: 'getCharWorldbookNames',
    });
    // mock 的 createStrict 必须产出可被 isStrictLorebookReadError_ACU 识别的结构，
    // 否则 bootstrap 的 catch 无法把 not-found 隔离为 continue。
    mockCreateStrictLorebookReadError.mockImplementation((result: any) => Object.assign(
      new Error(`StrictLorebookRead:${result.status}`),
      {
        name: 'StrictLorebookReadError_ACU',
        status: result.status,
        source: result.source,
        validationPolicy: result.validationPolicy,
        runId: result.runId,
        failedBooks: result.failedBooks,
        invalidBookNames: result.invalidBookNames,
        staleBookNames: result.staleBookNames,
      },
    ));
    // 主世界书严格读取失败为 lorebook_not_found：隔离跳过；有效书成功：继续读取。
    mockGetLorebookEntriesStrict.mockImplementation(async (bookNames: string[]) => {
      if (bookNames[0] === '主世界书') {
        return {
          status: 'read_failed',
          source: 'agent_runtime',
          validationPolicy: 'trusted_direct',
          runId: 'bootstrap-all-not-found',
          requestedBookNames: bookNames,
          resolvedBookNames: [],
          entriesByBook: {},
          invalidBookNames: [],
          failedBookNames: bookNames,
          failedBooks: bookNames.map(bookName => ({ bookName, errorCategory: 'lorebook_not_found' })),
          staleBookNames: bookNames,
        };
      }
      return {
        status: 'success',
        entriesByBook: Object.fromEntries(bookNames.map(bookName => [bookName, mockEntriesByBook.get(bookName) || []])),
        invalidBookNames: [],
        failedBookNames: [],
      };
    });
    mockEntriesByBook.set('有效书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: { mode: 'agent', agentApiPreset: 'valid-book' },
      snapshot: {},
    })]);
    // bootstrap catch 使用 isLorebookNotFoundError_ACU 判断隔离；
    // mock 默认只认 message 含 'Worldbook not found'，必须按 strict 结构判断。
    mockIsLorebookNotFoundError.mockImplementation((error: any) => {
      if (error?.name === 'StrictLorebookReadError_ACU') {
        return Array.isArray(error.failedBooks)
          && error.failedBooks.length > 0
          && error.failedBooks.every((failure: any) => failure?.errorCategory === 'lorebook_not_found');
      }
      return String(error?.message || error).includes('Worldbook not found');
    });
    const readContext = { runId: 'bootstrap-all-not-found', bookEntriesPromises: new Map() };

    const result = await readAgentWorldbookStateFromWorldbooks_ACU(readContext as any);

    // 主世界书 not-found 被隔离跳过，有效书仍被读到：不降级为空配置、不抛错。
    expect(result.source).toBe('worldbook');
    expect(result.bookName).toBe('有效书');
    expect(result.control.agentApiPreset).toBe('valid-book');
  });

  it.each([
    ['unknown', 'lorebook read failed for unknown reason'],
    ['api_unavailable', 'api unavailable'],
  ] as const)('bootstrap 严格读取：含 %s 的书级失败原样失败，不降级为空配置', async (category, hostMessage) => {
    mockGetCurrentCharacterWorldbookBinding.mockResolvedValue({
      primary: '主世界书',
      additional: [],
      orderedNames: ['主世界书'],
      apiSource: 'getCharWorldbookNames',
    });
    const strictFailure = {
      status: 'read_failed',
      source: 'agent_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'bootstrap-fail-closed',
      requestedBookNames: ['主世界书'],
      resolvedBookNames: [],
      entriesByBook: {},
      invalidBookNames: [],
      failedBookNames: ['主世界书'],
      failedBooks: [{ bookName: '主世界书', errorCategory: category }],
      staleBookNames: [],
    };
    const strictError = new Error(hostMessage);
    mockCreateStrictLorebookReadError.mockReturnValue(strictError);
    mockGetLorebookEntriesStrict.mockResolvedValue(strictFailure);
    const readContext = { runId: 'bootstrap-fail-closed', bookEntriesPromises: new Map() };

    await expect(readAgentWorldbookStateFromWorldbooks_ACU(readContext as any)).rejects.toBe(strictError);
    expect(mockCreateStrictLorebookReadError).toHaveBeenCalledWith(strictFailure);
  });


  it('preserves per-channel entry limits above the former 200-entry cap', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: {
        mode: 'agent',
        maxEntriesPerChannel: {
          plot: 201,
          tableFill: 500,
          finalGeneration: 1000,
        },
      },
      snapshot: {},
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.control.maxEntriesPerChannel).toEqual({
      plot: 201,
      tableFill: 500,
      finalGeneration: 1000,
    });
  });

  it('keeps per-channel entry-limit defaults and lower bounds', async () => {
    mockEntriesByBook.set('主世界书', [configEntry({
      version: 2,
      kind: 'agent_worldbook_state',
      updatedAt: 1,
      control: {
        mode: 'agent',
        maxEntriesPerChannel: {
          plot: 0,
          tableFill: -4,
          finalGeneration: 'invalid',
        },
      },
      snapshot: {},
    })]);

    const result = await readAgentWorldbookStateFromWorldbooks_ACU();

    expect(result.control.maxEntriesPerChannel).toEqual({
      plot: 1,
      tableFill: 1,
      finalGeneration: 20,
    });
  });

