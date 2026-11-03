import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEntriesByBook, mockGetLorebookEntriesStrict, mockSetLorebookEntries } = vi.hoisted(() => ({
  mockEntriesByBook: new Map<string, any[]>(),
  mockGetLorebookEntriesStrict: vi.fn(),
  mockSetLorebookEntries: vi.fn(async (bookName: string, patches: any[]) => {
    const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
    const entries = mockEntriesByBook.get(bookName) || [];
    mockEntriesByBook.set(bookName, entries.map(entry => {
      const patch = patchByUid.get(String(entry.uid));
      return patch ? { ...entry, ...patch } : entry;
    }));
  }),
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: vi.fn(async (bookName: string) => mockEntriesByBook.get(bookName) || []),
  setLorebookEntries_ACU: mockSetLorebookEntries,
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesStrict_ACU: mockGetLorebookEntriesStrict,
}));

vi.mock('../../../src/service/agent/agent-worldbook-config-meta', () => ({
  readAgentWorldbookControlFromWorldbooks_ACU: vi.fn(),
  resolveAgentWorldbookScopeBookNames_ACU: vi.fn(),
}));

import {
  readAgentWorldbookControlFromWorldbooks_ACU,
  resolveAgentWorldbookScopeBookNames_ACU,
} from '../../../src/service/agent/agent-worldbook-config-meta';
import {
  clearWorldbookSkillMetaBlocks_ACU,
  hasUsableWorldbookSkillMeta_ACU,
  resolveAgentWorldbookFilterAvailability_ACU,
} from '../../../src/service/agent/agent-worldbook-skill-meta';

const skillBlock = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"描述","triggerWhen":"触发","tk":12,"updatedAt":1,"updatedBy":"agent-skillify"}\nACU_SKILL_META_END -->';
const takeoverBlock = '<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';

describe('hasUsableWorldbookSkillMeta_ACU', () => {
  it('accepts skill meta when description, triggerWhen, or tk is usable', () => {
    expect(hasUsableWorldbookSkillMeta_ACU(skillBlock)).toBe(true);
    expect(hasUsableWorldbookSkillMeta_ACU('<!-- ACU_SKILL_META_START\n{"version":1,"description":"仅描述","triggerWhen":"","tk":0,"updatedAt":1,"updatedBy":"manual"}\nACU_SKILL_META_END -->')).toBe(true);
    expect(hasUsableWorldbookSkillMeta_ACU('<!-- ACU_SKILL_META_START\n{"version":1,"description":"","triggerWhen":"仅触发","tk":0,"updatedAt":1,"updatedBy":"manual"}\nACU_SKILL_META_END -->')).toBe(true);
    expect(hasUsableWorldbookSkillMeta_ACU('<!-- ACU_SKILL_META_START\n{"version":1,"description":"","triggerWhen":"","tk":3,"updatedAt":1,"updatedBy":"manual"}\nACU_SKILL_META_END -->')).toBe(true);
  });

  it('rejects missing, invalid, or empty skill meta blocks', () => {
    expect(hasUsableWorldbookSkillMeta_ACU('普通条目')).toBe(false);
    expect(hasUsableWorldbookSkillMeta_ACU('<!-- ACU_SKILL_META_START\n{"version":2,"description":"描述","triggerWhen":"触发","tk":12}\nACU_SKILL_META_END -->')).toBe(false);
    expect(hasUsableWorldbookSkillMeta_ACU('<!-- ACU_SKILL_META_START\n{"version":1,"description":"","triggerWhen":"","tk":0,"updatedAt":1,"updatedBy":"manual"}\nACU_SKILL_META_END -->')).toBe(false);
    expect(hasUsableWorldbookSkillMeta_ACU('<!-- ACU_SKILL_META_START\nnot-json\nACU_SKILL_META_END -->')).toBe(false);
  });
});

describe('clearWorldbookSkillMetaBlocks_ACU', () => {
  beforeEach(() => {
    mockEntriesByBook.clear();
    mockSetLorebookEntries.mockClear();
    vi.mocked(readAgentWorldbookControlFromWorldbooks_ACU).mockReset();
    vi.mocked(resolveAgentWorldbookScopeBookNames_ACU).mockReset();
  });

  it('clears only ACU skill meta blocks and keeps config/takeover comments untouched', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, comment: `普通条目\n${skillBlock}\n${takeoverBlock}` },
      { uid: 2, comment: 'TavernDB-ACU-AgentWorldbookConfig' },
      { uid: 3, comment: `仅接管\n${takeoverBlock}` },
    ]);

    const result = await clearWorldbookSkillMetaBlocks_ACU(['角色A世界书']);

    expect(result).toMatchObject({ total: 1, cleared: 1, skipped: 0, failed: 0, errors: [] });
    expect(mockSetLorebookEntries).toHaveBeenCalledTimes(1);
    const entries = mockEntriesByBook.get('角色A世界书') || [];
    expect(entries[0].comment).not.toContain('ACU_SKILL_META_START');
    expect(entries[0].comment).toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META_START');
    expect(entries[1].comment).toBe('TavernDB-ACU-AgentWorldbookConfig');
    expect(entries[2].comment).toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META_START');
  });

  it('does not scan or write when book names are empty', async () => {
    const result = await clearWorldbookSkillMetaBlocks_ACU();

    expect(result).toMatchObject({ total: 0, cleared: 0, skipped: 0, failed: 0, errors: [] });
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
  });
});

describe('resolveAgentWorldbookFilterAvailability_ACU', () => {
  beforeEach(() => {
    mockEntriesByBook.clear();
    mockSetLorebookEntries.mockClear();
    vi.mocked(readAgentWorldbookControlFromWorldbooks_ACU).mockReset();
    vi.mocked(resolveAgentWorldbookScopeBookNames_ACU).mockReset();
    mockGetLorebookEntriesStrict.mockReset();
  });

  it('agent 模式且世界书范围非空时 skillMetas 为空仍可用', async () => {
    vi.mocked(readAgentWorldbookControlFromWorldbooks_ACU).mockResolvedValue({
      control: { enabled: true, mode: 'agent' },
      source: 'worldbook',
      bookName: '角色A世界书',
      duplicateCount: 0,
      writableBookName: '角色A世界书',
    } as any);
    vi.mocked(resolveAgentWorldbookScopeBookNames_ACU).mockResolvedValue(['角色A世界书']);
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, comment: '没有 Skill 元数据的普通条目', enabled: true, keys: ['钥匙A'] },
    ]);

    const result = await resolveAgentWorldbookFilterAvailability_ACU();

    expect(result.available).toBe(true);
    expect(result.reason).toBe('available');
    expect(result.skillCount).toBe(0);
    expect(result.skillMetas).toEqual([]);
    expect(result.bookNames).toEqual(['角色A世界书']);
  });

  it('通过 request context 读取 Skill metadata，避免直接宿主读取', async () => {
    vi.mocked(readAgentWorldbookControlFromWorldbooks_ACU).mockResolvedValue({
      control: { enabled: true, mode: 'agent' }, source: 'worldbook', bookName: '角色A世界书', duplicateCount: 0, writableBookName: '角色A世界书',
    } as any);
    vi.mocked(resolveAgentWorldbookScopeBookNames_ACU).mockResolvedValue(['角色A世界书']);
    mockGetLorebookEntriesStrict.mockResolvedValue({
      status: 'success',
      entriesByBook: {
        角色A世界书: [{ uid: 1, comment: `条目\n${skillBlock}`, enabled: true }],
      },
      invalidBookNames: [],
      failedBookNames: [],
    });
    const readContext = { runId: 'plot-agent-meta-test', bookEntriesPromises: new Map() };

    const result = await resolveAgentWorldbookFilterAvailability_ACU(readContext);

    expect(result.skillCount).toBe(1);
    expect(mockGetLorebookEntriesStrict).toHaveBeenCalledWith(['角色A世界书'], expect.objectContaining({
      source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'plot-agent-meta-test', context: readContext,
    }));
  });

  it('读取 Skill 元数据时 label 剥离 takeover meta，保持纯净标题', async () => {
    const takeoverBlock = '<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"version":1,"kind":"agent_worldbook_takeover","selectionSignature":"sig","createdAt":1,"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->';
    mockEntriesByBook.clear();
    mockSetLorebookEntries.mockClear();
    vi.mocked(readAgentWorldbookControlFromWorldbooks_ACU).mockReset();
    vi.mocked(resolveAgentWorldbookScopeBookNames_ACU).mockReset();
    vi.mocked(resolveAgentWorldbookScopeBookNames_ACU).mockResolvedValue(['角色A世界书']);
    vi.mocked(readAgentWorldbookControlFromWorldbooks_ACU).mockResolvedValue({
      control: { enabled: true, mode: 'agent' }, source: 'worldbook', bookName: '角色A世界书', duplicateCount: 0, writableBookName: '角色A世界书',
    } as any);
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, comment: `条目正文\n\n${skillBlock}\n\n${takeoverBlock}`, enabled: true },
    ]);

    const result = await resolveAgentWorldbookFilterAvailability_ACU();

    expect(result.skillCount).toBe(1);
    expect(result.skillMetas[0].label).toBe('条目正文');
    expect(result.skillMetas[0].label).not.toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META');
    expect(result.skillMetas[0].label).not.toContain('ACU_SKILL_META');
  });
});
