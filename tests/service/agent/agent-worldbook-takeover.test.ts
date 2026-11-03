import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEntriesByBook,
  mockPersistSettings,
  mockResolveBookNames,
  mockHashUserInput,
  mockGetLorebookEntries,
  mockSetLorebookEntries,
  mockReadAgentWorldbookState,
  mockWriteAgentWorldbookState,
  mockDeleteAgentWorldbookState,
  mockStateSnapshot,
} = vi.hoisted(() => ({
  mockEntriesByBook: new Map<string, any[]>(),
  mockPersistSettings: vi.fn(),
  mockResolveBookNames: vi.fn(async () => ['角色A世界书']),
  mockHashUserInput: vi.fn((value: string) => `hash:${value}`),
  mockGetLorebookEntries: vi.fn(async (bookName: string) => mockEntriesByBook.get(bookName) || []),
  mockSetLorebookEntries: vi.fn(),
  mockReadAgentWorldbookState: vi.fn(),
  mockWriteAgentWorldbookState: vi.fn(),
  mockDeleteAgentWorldbookState: vi.fn(),
  mockStateSnapshot: { current: { active: false, selectionSignature: '', createdAt: 0, books: {} } as any },
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: mockGetLorebookEntries,
  getLorebookEntriesRequired_ACU: mockGetLorebookEntries,
  deleteLorebookEntries_ACU: vi.fn(async (bookName: string, uids: any[]) => {
    const uidSet = new Set((uids || []).map(uid => String(uid)));
    const entries = mockEntriesByBook.get(bookName) || [];
    mockEntriesByBook.set(bookName, entries.filter(entry => !uidSet.has(String(entry.uid))));
  }),
  deleteLorebookEntriesRequired_ACU: vi.fn(async (bookName: string, uids: any[]) => {
    const uidSet = new Set((uids || []).map(uid => String(uid)));
    const entries = mockEntriesByBook.get(bookName) || [];
    mockEntriesByBook.set(bookName, entries.filter(entry => !uidSet.has(String(entry.uid))));
  }),
  setLorebookEntries_ACU: mockSetLorebookEntries,
  setLorebookEntriesRequired_ACU: mockSetLorebookEntries,
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  persistTavernSettings_ACU: mockPersistSettings,
}));

vi.mock('../../../src/shared/utils', () => ({
  hashUserInput_ACU: mockHashUserInput,
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { plotSettings: {} },
}));

vi.mock('../../../src/service/agent/agent-skillify-service', () => ({
  isWorldbookEntrySkillifyCandidate_ACU: vi.fn((entry: any) => {
    const comment = String(entry?.comment || entry?.name || '').trim();
    if (entry?.enabled === false) return false;
    if (String(entry?.type || '').toLowerCase() === 'constant') return false;
    if (comment.startsWith('TavernDB-ACU-AgentWorldbookConfig')) return false;
    if (comment.startsWith('TavernDB-ACU-AgentWorldbookSnapshot')) return false;
    if (comment.startsWith('TavernDB-ACU-AgentFinalGenerationGreenlights')) return false;
    if (comment.startsWith('TavernDB-ACU-') && !comment.startsWith('TavernDB-ACU-AgentGreenlight')) return false;
    return true;
  }),
  getWorldbookEntryKeywordsForSkillify_ACU: vi.fn((entry: any) => entry?.keys || []),
}));

vi.mock('../../../src/service/agent/agent-worldbook-skill-meta', () => ({
  resolveAgentWorldbookFilterAvailability_ACU: vi.fn(async () => {
    const bookNames = await mockResolveBookNames();
    return bookNames.length === 0
      ? { available: false, reason: 'empty_scope', bookNames, skillMetas: [] }
      : { available: true, reason: 'available', bookNames, skillMetas: bookNames.flatMap((bookName: string) => (mockEntriesByBook.get(bookName) || []).filter(entry => entry?.uid !== undefined).map(entry => ({ bookName, uid: entry.uid, skillMeta: {} }))) };
  }),
  stripWorldbookSkillMetaBlock_ACU: vi.fn((comment: unknown) => String(comment || '')
    .replace(/<!--\s*ACU_SKILL_META_START[\s\S]*?ACU_SKILL_META_END\s*-->/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  ),
  hasUsableWorldbookSkillMeta_ACU: vi.fn((comment: unknown) => {
    const match = /<!--\s*ACU_SKILL_META_START\s*\n([\s\S]*?)\nACU_SKILL_META_END\s*-->/.exec(String(comment || ''));
    if (!match) return false;
    try {
      const meta = JSON.parse(match[1].trim());
      if (meta.version !== 1) return false;
      return !!String(meta.description || '').trim() || !!String(meta.triggerWhen || '').trim() || Number(meta.tk) > 0;
    } catch {
      return false;
    }
  }),
}));

vi.mock('../../../src/service/agent/agent-worldbook-config-meta', () => ({
  readAgentWorldbookStateFromWorldbooks_ACU: mockReadAgentWorldbookState,
  writeAgentWorldbookStateToWorldbook_ACU: mockWriteAgentWorldbookState,
  deleteAgentWorldbookStateEntry_ACU: mockDeleteAgentWorldbookState,
  resolveAgentWorldbookScopeBookNames_ACU: mockResolveBookNames,
}));

import { settings_ACU } from '../../../src/service/runtime/state-manager';
import {
  AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU,
  AGENT_WORLDBOOK_SNAPSHOT_COMMENT_ACU,
  buildWorldbookSelectionSignature_ACU,
  clearFinalGenerationGreenlights_ACU,
  ensurePlotAgentWorldbookSnapshotHydrated_ACU,
  getPlotAgentWorldbookSnapshot_ACU,
  readFinalGenerationGreenlights_ACU,
  recoverAgentWorldbookAfterFailure_ACU,
  resolvePreTakeoverWorldbookSnapshot_ACU,
  refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU,
  resetPlotAgentWorldbookSessionSnapshot_ACU,
  restoreWorldbookGreenlights_ACU,
  setPlotAgentWorldbookSnapshot_ACU,
  takeoverWorldbookGreenlights_ACU,
  writeFinalGenerationGreenlights_ACU,
} from '../../../src/service/agent/agent-worldbook-takeover';
import { getAgentWorldbookRuntimeRevision_ACU, isAgentWorldbookNativeFallback_ACU, resetAgentWorldbookRuntime_ACU, setLoadedAgentWorldbookControl_ACU } from '../../../src/service/agent/agent-worldbook-runtime-state';

function snapshotEntry(bookName = '角色A世界书'): any {
  return (mockEntriesByBook.get(bookName) || []).find(entry => entry.comment === AGENT_WORLDBOOK_SNAPSHOT_COMMENT_ACU);
}

function finalGenerationGreenlightEntry(bookName = '角色A世界书'): any {
  return (mockEntriesByBook.get(bookName) || []).find(entry => entry.comment === AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU);
}

const skillMetaBlock_ACU = '<!-- ACU_SKILL_META_START\n{"version":1,"description":"描述","triggerWhen":"触发","tk":12,"updatedAt":1,"updatedBy":"agent-skillify"}\nACU_SKILL_META_END -->';
const skillComment_ACU = `普通条目A\n\n${skillMetaBlock_ACU}`;
const skillCommentB_ACU = `普通条目B\n\n${skillMetaBlock_ACU}`;

beforeEach(() => {
  vi.clearAllMocks();
  resetAgentWorldbookRuntime_ACU();
  mockEntriesByBook.clear();
  mockGetLorebookEntries.mockImplementation(async (bookName: string) => mockEntriesByBook.get(bookName) || []);
  mockResolveBookNames.mockResolvedValue(['角色A世界书']);
  mockSetLorebookEntries.mockImplementation(async (bookName: string, patches: any[]) => {
    const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
    const entries = mockEntriesByBook.get(bookName) || [];
    mockEntriesByBook.set(bookName, entries.map(entry => {
      const patch = patchByUid.get(String(entry.uid));
      if (!patch) return entry;
      return { ...entry, ...patch };
    }));
  });
  mockStateSnapshot.current = { active: false, selectionSignature: '', createdAt: 0, books: {} };
  mockReadAgentWorldbookState.mockImplementation(async () => ({
    control: {},
    snapshot: mockStateSnapshot.current,
    source: 'default',
    bookName: '',
    duplicateCount: 0,
    writableBookName: '角色A世界书',
  }));
  mockWriteAgentWorldbookState.mockImplementation(async (patch: any) => {
    if (patch?.snapshot) mockStateSnapshot.current = patch.snapshot;
    return { updated: true, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
  });
  mockDeleteAgentWorldbookState.mockImplementation(async () => { mockStateSnapshot.current = { active: false, selectionSignature: '', createdAt: 0, books: {} }; return 1; });
  setPlotAgentWorldbookSnapshot_ACU({ active: false, selectionSignature: '', createdAt: 0, books: {} });
  (settings_ACU as any).plotSettings = {};
  mockEntriesByBook.set('角色A世界书', [
    { uid: 1, enabled: true, keys: ['钥匙A'], comment: skillComment_ACU, content: '内容A' },
  ]);
});

describe('agent worldbook session snapshot reset', () => {
  it('切换会话时只丢弃内存 snapshot，不触碰持久 Agent state', async () => {
    setPlotAgentWorldbookSnapshot_ACU({
      active: true,
      selectionSignature: '旧角色世界书',
      createdAt: 1,
      books: { 旧角色世界书: [{ uid: 1, previousEnabled: true }] },
    } as any);

    resetPlotAgentWorldbookSessionSnapshot_ACU();

    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual({ active: false, selectionSignature: '', createdAt: 0, books: {} });
    expect(mockWriteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
  });
});

describe('agent worldbook takeover native trigger suppression', () => {
  it('接管会保存 active snapshot 并禁用原世界书条目，避免最终正文被正常世界书机制重复触发', async () => {
    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('native_worldbook_trigger_disabled');
    expect(result.totalCandidates).toBe(1);
    expect(result.disabled).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.snapshot.active).toBe(true);
    expect(result.snapshot.books['角色A世界书']).toEqual([
      expect.objectContaining({
        uid: 1,
        previousEnabled: true,
        previousKeys: ['钥匙A'],
        commentHash: 'hash:普通条目A',
      }),
    ]);
    expect(result.updates).toEqual([{ bookName: '角色A世界书', uid: 1 }]);
    const patchedEntry = mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1);
    expect(patchedEntry?.enabled).toBe(false);
    expect(patchedEntry?.comment).toContain(skillComment_ACU);
    expect(patchedEntry?.comment).toMatch(/<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n([\s\S]+?)\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->/);
    const metaMatch = /<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n([\s\S]+?)\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->/.exec(patchedEntry?.comment || '');
    expect(JSON.parse(metaMatch![1])).toMatchObject({
      version: 1,
      kind: 'agent_worldbook_takeover',
      selectionSignature: result.selectionSignature,
      previousEnabled: true,
      previousKeys: ['钥匙A'],
      commentHash: 'hash:普通条目A',
    });
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(true);
    expect(mockWriteAgentWorldbookState).toHaveBeenCalledWith({ snapshot: expect.objectContaining({ active: true, selectionSignature: 'hash:{"scope":"agent-worldbook-takeover","books":["角色A世界书"]}' }) });
    expect(snapshotEntry()).toBeUndefined();
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
  });

  it('独立 state 丢失后会从条目 takeover meta 重建快照并安全恢复原状态', async () => {
    await takeoverWorldbookGreenlights_ACU();
    mockStateSnapshot.current = { active: false, selectionSignature: '', createdAt: 0, books: {} };
    setPlotAgentWorldbookSnapshot_ACU({ active: false, selectionSignature: '', createdAt: 0, books: {} });

    const rebuiltSnapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
    const restoreResult = await restoreWorldbookGreenlights_ACU();
    const restoredEntry = mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1);

    expect(rebuiltSnapshot).toMatchObject({
      active: true,
      books: {
        角色A世界书: [expect.objectContaining({ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'] })],
      },
    });
    expect(mockStateSnapshot.current.active).toBe(false);
    expect(restoreResult).toMatchObject({ restored: 1, skipped: 0, failed: 0 });
    expect(restoredEntry).toMatchObject({ enabled: true, keys: ['钥匙A'] });
    expect(restoredEntry?.comment).toBe(skillComment_ACU);
  });

  it('条目 patch 失败时以 pending 快照收敛 state、cache 与 result，避免 enabled 条目被标记为已接管', async () => {
    mockSetLorebookEntries.mockRejectedValueOnce(new Error('entry patch failed'));

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result).toMatchObject({ disabled: 0, failed: 1, snapshot: { active: true, books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] } } });
    expect(mockStateSnapshot.current).toEqual(result.snapshot);
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(result.snapshot);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, comment: skillComment_ACU });
  });

  it('跨世界书禁用部分失败时以 applied/pending 账本持久化每个 UID 的实际结果', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书', '角色B世界书']);
    mockEntriesByBook.set('角色B世界书', [
      { uid: 2, enabled: true, keys: ['钥匙B'], type: 'selective', comment: skillCommentB_ACU, content: '内容B' },
    ]);
    mockSetLorebookEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (bookName === '角色B世界书') throw new Error('book B patch failed');
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      const entries = mockEntriesByBook.get(bookName) || [];
      mockEntriesByBook.set(bookName, entries.map(entry => ({ ...entry, ...patchByUid.get(String(entry.uid)) })));
    });

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result).toMatchObject({ disabled: 1, failed: 1, snapshot: { active: true } });
    expect(result.snapshot.books).toEqual({
      角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'applied' })],
      角色B世界书: [expect.objectContaining({ uid: 2, takeoverStatus: 'pending' })],
    });
    expect(mockStateSnapshot.current.books).toEqual(result.snapshot.books);
    expect(getPlotAgentWorldbookSnapshot_ACU().books).toEqual(result.snapshot.books);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: false });
    expect(mockEntriesByBook.get('角色B世界书')?.find(entry => entry.uid === 2)).toMatchObject({ enabled: true, comment: skillCommentB_ACU });
  });

  it('禁用部分成功但最终账本写入失败时，state、cache 与 result 保留同一 pending 集合', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书', '角色B世界书']);
    mockEntriesByBook.set('角色B世界书', [
      { uid: 2, enabled: true, keys: ['钥匙B'], type: 'selective', comment: skillCommentB_ACU, content: '内容B' },
    ]);
    mockSetLorebookEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (bookName === '角色B世界书') throw new Error('book B patch failed');
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      const entries = mockEntriesByBook.get(bookName) || [];
      mockEntriesByBook.set(bookName, entries.map(entry => ({ ...entry, ...patchByUid.get(String(entry.uid)) })));
    });
    let writes = 0;
    mockWriteAgentWorldbookState.mockImplementation(async (patch: any) => {
      writes += 1;
      if (writes === 2) return { updated: false, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
      if (patch?.snapshot) mockStateSnapshot.current = patch.snapshot;
      return { updated: true, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
    });

    const result = await takeoverWorldbookGreenlights_ACU();
    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }]);

    expect(result).toMatchObject({ failed: 3, snapshot: { active: true } });
    expect(result.snapshot.books).toEqual({
      角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })],
      角色B世界书: [expect.objectContaining({ uid: 2, takeoverStatus: 'pending' })],
    });
    expect(mockStateSnapshot.current).toEqual(result.snapshot);
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(result.snapshot);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: false });
    expect(mockEntriesByBook.get('角色B世界书')?.find(entry => entry.uid === 2)).toMatchObject({ enabled: true });
    expect(written).toBe(false);
  });

  it('接管写入 state snapshot 抛错时不污染 active cache、不禁用原条目且阻止后续正文绿灯误写', async () => {
    mockWriteAgentWorldbookState.mockRejectedValueOnce(new Error('state write failed'));

    const result = await takeoverWorldbookGreenlights_ACU();
    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '正文需要' }]);

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('snapshot_state_write_failed');
    expect(result.totalCandidates).toBe(1);
    expect(result.disabled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.snapshot).toMatchObject({ active: false, books: {} });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(result.snapshot);
    expect(mockStateSnapshot.current.active).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      keys: ['钥匙A'],
    });
    expect(written).toBe(false);
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
  });

  it('接管写入 state snapshot 返回 updated false 时不污染 active cache、不禁用原条目且阻止后续正文绿灯误写', async () => {
    mockWriteAgentWorldbookState.mockResolvedValueOnce({ updated: false, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} });

    const result = await takeoverWorldbookGreenlights_ACU();
    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '正文需要' }]);

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('snapshot_state_write_failed');
    expect(result.totalCandidates).toBe(1);
    expect(result.disabled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.snapshot).toMatchObject({ active: false, books: {} });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(result.snapshot);
    expect(mockStateSnapshot.current.active).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      keys: ['钥匙A'],
    });
    expect(written).toBe(false);
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
  });

  it('重复接管时如果候选已被禁用，不覆盖既有 active snapshot，保证后续仍可恢复', async () => {
    const first = await takeoverWorldbookGreenlights_ACU();
    expect(first.reason).toBe('native_worldbook_trigger_disabled');

    const second = await takeoverWorldbookGreenlights_ACU();

    expect(second.updated).toBe(false);
    expect(second.reason).toBe('native_worldbook_trigger_already_disabled');
    expect(second.totalCandidates).toBe(0);
    expect(second.disabled).toBe(0);
    expect(second.failed).toBe(0);
    expect(second.snapshot.active).toBe(true);
    expect(second.snapshot.books['角色A世界书']).toEqual([
      expect.objectContaining({
        uid: 1,
        previousEnabled: true,
        previousKeys: ['钥匙A'],
      }),
    ]);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(true);
  });

  it('旧 snapshot-only 接管会在已禁用条目仍匹配原 comment 时惰性补写 takeover meta', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 10,
      books: {
        角色A世界书: [{
          uid: 1,
          previousEnabled: true,
          previousKeys: ['钥匙A'],
          previousType: 'selective',
          commentHash: 'hash:普通条目A',
        }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);

    const result = await takeoverWorldbookGreenlights_ACU();
    const patchedEntry = mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1);

    expect(result).toMatchObject({
      reason: 'native_worldbook_trigger_already_disabled',
      totalCandidates: 0,
      disabled: 0,
      snapshot: expect.objectContaining({ active: true }),
    });
    expect(patchedEntry).toMatchObject({ enabled: false, keys: ['钥匙A'], type: 'selective' });
    expect(patchedEntry?.comment).toContain(skillComment_ACU);
    expect(patchedEntry?.comment).toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META_START');
    expect(patchedEntry?.comment).toContain('"previousEnabled":true');
  });

  it('meta-only 接管在 state 丢失后再次接管时复用原始快照，不把 disabled 误记为原本关闭', async () => {
    await takeoverWorldbookGreenlights_ACU();
    mockStateSnapshot.current = { active: false, selectionSignature: '', createdAt: 0, books: {} };
    setPlotAgentWorldbookSnapshot_ACU({ active: false, selectionSignature: '', createdAt: 0, books: {} });

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result).toMatchObject({
      reason: 'native_worldbook_trigger_already_disabled',
      totalCandidates: 0,
      disabled: 0,
      snapshot: {
        active: true,
        books: {
          角色A世界书: [expect.objectContaining({ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'] })],
        },
      },
    });
  });

  it('已有接管快照与新候选共存时合并快照，只禁用并记录新候选', async () => {
    await takeoverWorldbookGreenlights_ACU();
    const firstEntry = mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1);
    mockEntriesByBook.set('角色A世界书', [
      firstEntry,
      { uid: 2, enabled: true, keys: ['钥匙B'], type: 'selective', comment: skillCommentB_ACU, content: '内容B' },
    ]);
    mockSetLorebookEntries.mockClear();

    const result = await takeoverWorldbookGreenlights_ACU();
    const entries = mockEntriesByBook.get('角色A世界书') || [];
    const secondEntry = entries.find(entry => entry.uid === 2);

    expect(result).toMatchObject({
      reason: 'native_worldbook_trigger_disabled',
      totalCandidates: 1,
      disabled: 1,
      snapshot: {
        active: true,
        books: {
          角色A世界书: [
            expect.objectContaining({ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'] }),
            expect.objectContaining({ uid: 2, previousEnabled: true, previousKeys: ['钥匙B'] }),
          ],
        },
      },
    });
    expect(secondEntry).toMatchObject({ enabled: false, keys: ['钥匙B'], type: 'selective' });
    expect(secondEntry?.comment).toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META_START');
    expect(mockSetLorebookEntries).toHaveBeenLastCalledWith('角色A世界书', [
      expect.objectContaining({ uid: 2, enabled: false }),
    ]);
  });

  it('损坏或范围不匹配的 meta 不会把普通 disabled 条目纳入接管快照', async () => {
    const foreignSignature = buildWorldbookSelectionSignature_ACU(['其他世界书']);
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['钥匙A'], type: 'selective', comment: `${skillComment_ACU}\n\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n{"version":1,"kind":"agent_worldbook_takeover","selectionSignature":"${foreignSignature}","createdAt":1,"previousEnabled":true}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`, content: '内容A' },
      { uid: 2, enabled: false, keys: ['钥匙B'], type: 'selective', comment: `${skillCommentB_ACU}\n\n<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\nnot-json\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`, content: '内容B' },
    ]);

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result).toMatchObject({ reason: 'empty_candidates', totalCandidates: 0, disabled: 0 });
    expect(result.snapshot).toMatchObject({ active: false, books: {} });
  });

  it('重复接管时会恢复并剔除已失去 Skill meta 的旧 active snapshot 条目', async () => {
    const first = await takeoverWorldbookGreenlights_ACU();
    expect(first.reason).toBe('native_worldbook_trigger_disabled');
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], type: 'selective', comment: '普通条目A', content: '内容A' },
    ]);

    const second = await takeoverWorldbookGreenlights_ACU();

    expect(second.updated).toBe(true);
    expect(second.reason).toBe('native_worldbook_trigger_snapshot_reconciled');
    expect(second.totalCandidates).toBe(0);
    expect(second.snapshot.active).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, keys: ['钥匙A'] });
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(false);
  });

  it('接管快照剪枝的最终 state 写入失败时不提前恢复条目，保留持久恢复依据', async () => {
    await takeoverWorldbookGreenlights_ACU();
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], type: 'selective', comment: '普通条目A', content: '内容A' },
    ]);
    mockWriteAgentWorldbookState
      .mockResolvedValueOnce({ updated: true, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} })
      .mockResolvedValueOnce({ updated: false, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} });

    const result = await takeoverWorldbookGreenlights_ACU();
    const entry = mockEntriesByBook.get('角色A世界书')?.find(item => item.uid === 1);

    expect(result).toMatchObject({
      reason: 'snapshot_state_write_failed',
      disabled: 0,
      failed: 1,
      snapshot: {
        active: true,
        books: { 角色A世界书: [expect.objectContaining({ uid: 1, previousEnabled: true })] },
      },
    });
    expect(entry).toMatchObject({ enabled: false, keys: ['新钥匙'], type: 'selective' });
    expect(entry?.comment).toContain('普通条目A');
    expect(entry?.comment).toContain('ACU_AGENT_WORLDBOOK_TAKEOVER_META_START');
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, previousEnabled: true })] },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(result.snapshot);
  });

  it('快照剪枝恢复跨世界书部分失败时，只保留未恢复 UID，避免已恢复条目重新进入 state', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书', '角色B世界书']);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书', '角色B世界书']);
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙A'], type: 'selective', comment: '普通条目A', content: '内容A' },
    ]);
    mockEntriesByBook.set('角色B世界书', [
      { uid: 2, enabled: false, keys: ['新钥匙B'], type: 'selective', comment: '普通条目B', content: '内容B' },
    ]);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], type: 'selective', commentHash: 'hash:普通条目A' }],
        角色B世界书: [{ uid: 2, previousEnabled: true, previousKeys: ['钥匙B'], type: 'selective', commentHash: 'hash:普通条目B' }],
      },
    };
    mockSetLorebookEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (bookName === '角色B世界书') throw new Error('book B restore failed');
      const patchByUid = new Map((patches || []).map(patch => [String(patch.uid), patch]));
      const entries = mockEntriesByBook.get(bookName) || [];
      mockEntriesByBook.set(bookName, entries.map(entry => ({ ...entry, ...patchByUid.get(String(entry.uid)) })));
    });

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result).toMatchObject({
      reason: 'native_worldbook_trigger_snapshot_reconciled',
      disabled: 0,
      failed: 1,
      snapshot: { active: true, books: { 角色B世界书: [expect.objectContaining({ uid: 2 })] } },
    });
    expect(result.snapshot.books.角色A世界书).toBeUndefined();
    expect(mockStateSnapshot.current.books).toEqual(result.snapshot.books);
    expect(getPlotAgentWorldbookSnapshot_ACU().books).toEqual(result.snapshot.books);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, keys: ['钥匙A'] });
    expect(mockEntriesByBook.get('角色B世界书')?.find(entry => entry.uid === 2)).toMatchObject({ enabled: false, keys: ['新钥匙B'] });
  });

  it('世界书范围为空时不启用运行时过滤', async () => {
    mockResolveBookNames.mockResolvedValue([]);

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('empty_scope');
    expect(result.totalCandidates).toBe(0);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(false);
  });

  it('无 Skill meta 时不写入 active snapshot 且不禁用原生世界书条目', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: '普通条目A', content: '内容A' },
      { uid: 2, enabled: true, keys: ['常量'], type: 'constant', comment: '常量条目', content: '内容B' },
      { uid: 3, enabled: true, keys: ['内部'], type: 'selective', comment: 'TavernDB-ACU-AgentWorldbookConfig', content: '{}' },
      { uid: 4, enabled: true, keys: ['数据库'], type: 'selective', comment: 'TavernDB-ACU-自动生成条目', content: '内容D' },
    ]);

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result.reason).toBe('empty_candidates');
    expect(result.totalCandidates).toBe(0);
    expect(result.snapshot.active).toBe(false);
    expect(result.updates).toEqual([]);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true });
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 2)).toMatchObject({ enabled: true, type: 'constant' });
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 3)).toMatchObject({ enabled: true });
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 4)).toMatchObject({ enabled: true });
  });

  it('有 Skill meta 的 enabled selective 条目会进入 snapshot 并被禁用', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result.reason).toBe('native_worldbook_trigger_disabled');
    expect(result.totalCandidates).toBe(1);
    expect(result.snapshot.active).toBe(true);
    expect(result.snapshot.books['角色A世界书']).toEqual([
      expect.objectContaining({ uid: 1, previousKeys: ['钥匙A'], previousType: 'selective' }),
    ]);
    expect(result.updates).toEqual([{ bookName: '角色A世界书', uid: 1 }]);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: false });
  });

  it('disabled 且有 Skill meta 的条目不进入 snapshot 且不被启用或禁用', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);

    const result = await takeoverWorldbookGreenlights_ACU();

    expect(result.reason).toBe('empty_candidates');
    expect(result.totalCandidates).toBe(0);
    expect(result.snapshot.active).toBe(false);
    expect(result.updates).toEqual([]);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: false });
  });

  it('刷新快照时保留当前 selection 的 active snapshot，确保 takeover 后 UI refresh 不破坏 restore', async () => {
    const takeoverResult = await takeoverWorldbookGreenlights_ACU();
    expect(takeoverResult.reason).toBe('native_worldbook_trigger_disabled');
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)?.enabled).toBe(false);

    const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
    expect(snapshot.active).toBe(true);
    expect(snapshot.books['角色A世界书']).toEqual([
      expect.objectContaining({ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'] }),
    ]);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(true);

    const restoreResult = await restoreWorldbookGreenlights_ACU();
    expect(restoreResult.reason).toBe('native_worldbook_trigger_restored');
    expect(restoreResult.restored).toBe(1);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)?.enabled).toBe(true);
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(false);
  });

  it('冷 cache 会从持久化状态 hydration active snapshot', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const persistedSnapshot = {
      active: true,
      selectionSignature,
      createdAt: 10,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
      },
    };
    mockStateSnapshot.current = persistedSnapshot;
    setPlotAgentWorldbookSnapshot_ACU({ active: false, selectionSignature: '', createdAt: 0, books: {} });

    const resolved = await resolvePreTakeoverWorldbookSnapshot_ACU();

    expect(resolved.snapshot).toBe(persistedSnapshot);
    expect(resolved.expectedSignature).toBe(selectionSignature);
    // getter 返回缓存的隔离副本（防外部原地修改污染缓存），断言内容而非对象身份。
    expect(getPlotAgentWorldbookSnapshot_ACU()).toStrictEqual(persistedSnapshot);
  });

  it('ensure 水合：reset 后首次调用读取持久账本填充内存，已水合后不再重复读取', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const persistedSnapshot = {
      active: true,
      selectionSignature,
      createdAt: 10,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
      },
    };
    mockStateSnapshot.current = persistedSnapshot;
    resetPlotAgentWorldbookSessionSnapshot_ACU();
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(false);

    await ensurePlotAgentWorldbookSnapshotHydrated_ACU();

    expect(getPlotAgentWorldbookSnapshot_ACU()).toStrictEqual(persistedSnapshot);
    const readsAfterFirstEnsure = mockReadAgentWorldbookState.mock.calls.length;
    expect(readsAfterFirstEnsure).toBeGreaterThan(0);

    await ensurePlotAgentWorldbookSnapshotHydrated_ACU();
    expect(mockReadAgentWorldbookState.mock.calls.length).toBe(readsAfterFirstEnsure);
  });

  it('并发 pre_takeover hydration 共享同一次持久化读取', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const persistedSnapshot = {
      active: true,
      selectionSignature,
      createdAt: 10,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
      },
    };
    mockStateSnapshot.current = persistedSnapshot;

    const [first, second] = await Promise.all([
      resolvePreTakeoverWorldbookSnapshot_ACU(),
      resolvePreTakeoverWorldbookSnapshot_ACU(),
    ]);

    expect(first).toEqual({ snapshot: persistedSnapshot, expectedSignature: selectionSignature });
    expect(second).toEqual({ snapshot: persistedSnapshot, expectedSignature: selectionSignature });
    expect(mockReadAgentWorldbookState).toHaveBeenCalledTimes(1);
  });

  it('pre_takeover hydration 失败后会释放 single-flight 并允许下一次重试', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const persistedSnapshot = {
      active: true,
      selectionSignature,
      createdAt: 10,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
      },
    };
    mockReadAgentWorldbookState
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce({ control: {}, snapshot: persistedSnapshot, source: 'worldbook', bookName: '角色A世界书', duplicateCount: 0, writableBookName: '角色A世界书' });

    await expect(resolvePreTakeoverWorldbookSnapshot_ACU()).rejects.toThrow('temporary read failure');
    await expect(resolvePreTakeoverWorldbookSnapshot_ACU()).resolves.toEqual({ snapshot: persistedSnapshot, expectedSignature: selectionSignature });
    expect(mockReadAgentWorldbookState).toHaveBeenCalledTimes(2);
  });

  it('hydration 期间 cache 被新状态更新时，旧读取结果不得覆盖新状态', async () => {
    let releaseRead!: (value: any) => void;
    mockReadAgentWorldbookState.mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
    const hydrationPromise = refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
    await vi.waitFor(() => expect(mockReadAgentWorldbookState).toHaveBeenCalledTimes(1));

    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const originalSnapshot = {
      active: true,
      selectionSignature,
      createdAt: 10,
      books: { 角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }] },
    };
    const newerSnapshot = {
      active: true,
      selectionSignature: 'newer-signature',
      createdAt: 20,
      books: { 新范围: [{ uid: 9, previousEnabled: true, previousKeys: ['新'], previousType: 'selective' }] },
    };
    setPlotAgentWorldbookSnapshot_ACU(newerSnapshot);
    releaseRead({
      control: {},
      snapshot: originalSnapshot,
      source: 'worldbook',
      bookName: '角色A世界书',
      duplicateCount: 0,
      writableBookName: '角色A世界书',
    });

    await expect(hydrationPromise).resolves.toBe(originalSnapshot);
    // getter 返回缓存的隔离副本，断言内容而非对象身份。
    expect(getPlotAgentWorldbookSnapshot_ACU()).toStrictEqual(newerSnapshot);
  });


  it('不同 selection signature 的并发 hydration 不共享结果', async () => {
    const signatureA = buildWorldbookSelectionSignature_ACU(['书A']);
    const signatureB = buildWorldbookSelectionSignature_ACU(['书B']);
    let releaseA!: (value: any) => void;
    mockResolveBookNames.mockResolvedValueOnce(['书A']).mockResolvedValueOnce(['书B']);
    mockReadAgentWorldbookState
      .mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }))
      .mockResolvedValueOnce({
        control: {},
        snapshot: { active: true, selectionSignature: signatureB, createdAt: 2, books: { 书B: [{ uid: 2, previousEnabled: true }] } },
        source: 'worldbook', bookName: '书B', duplicateCount: 0, writableBookName: '书B',
      });

    const promiseA = resolvePreTakeoverWorldbookSnapshot_ACU();
    await vi.waitFor(() => expect(mockReadAgentWorldbookState).toHaveBeenCalledTimes(1));
    const promiseB = resolvePreTakeoverWorldbookSnapshot_ACU();
    await vi.waitFor(() => expect(mockReadAgentWorldbookState).toHaveBeenCalledTimes(2));
    releaseA({
      control: {},
      snapshot: { active: true, selectionSignature: signatureA, createdAt: 1, books: { 书A: [{ uid: 1, previousEnabled: true }] } },
      source: 'worldbook', bookName: '书A', duplicateCount: 0, writableBookName: '书A',
    });

    await expect(promiseA).resolves.toEqual(expect.objectContaining({ expectedSignature: signatureA }));
    await expect(promiseB).resolves.toEqual(expect.objectContaining({ expectedSignature: signatureB }));
    expect(mockReadAgentWorldbookState).toHaveBeenCalledTimes(2);
  });

  it('刷新快照时会清空 selection 不匹配的过期 active snapshot', async () => {
    (settings_ACU as any).plotSettings.agentWorldbookControlSnapshot = {
      active: true,
      selectionSignature: 'stale',
      createdAt: 1,
      books: { stale: [{ uid: 9, previousEnabled: true }] },
    };

    const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();

    expect(snapshot.active).toBe(false);
    expect(snapshot.books).toEqual({});
    expect(getPlotAgentWorldbookSnapshot_ACU()).toMatchObject({ active: false, books: {} });
  });

  it('正文绿灯写入会把 active snapshot 内放行条目改为保留关键词的常量蓝灯并可读回', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], comment: skillComment_ACU, content: '内容A' },
      { uid: 'final-state', enabled: false, type: 'constant', keys: [], comment: AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU, content: '{}' },
    ]);
    await takeoverWorldbookGreenlights_ACU();

    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '正文需要' }]);
    const readBack = await readFinalGenerationGreenlights_ACU();
    const patchedEntry = mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1);

    expect(written).toBe(true);
    expect(readBack).toEqual([{ bookName: '角色A世界书', uid: 1 }]);
    expect(patchedEntry).toMatchObject({ enabled: true, type: 'constant', keys: ['钥匙A'] });
    expect(finalGenerationGreenlightEntry()).toBeDefined();
  });

  it('正文绿灯写入会用可信快照修复旧版本清空的关键词', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: [], type: 'constant', comment: skillComment_ACU, content: '内容A' },
    ]);

    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '修复旧绿灯' }]);

    expect(written).toBe(true);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      type: 'constant',
      keys: ['钥匙A'],
    });
  });

  it('正文绿灯写入不会用快照覆盖用户修改 comment 后主动清空的关键词', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: [], type: 'constant', comment: `用户已修改条目\n\n${skillMetaBlock_ACU}`, content: '内容A' },
    ]);

    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '不得覆盖用户修改' }]);

    expect(written).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      type: 'constant',
      keys: [],
    });
  });

  it('正文绿灯写入在快照缺少 commentHash 时不推断恢复旧空关键词', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    mockSetLorebookEntries.mockClear();
    const snapshot = structuredClone(mockStateSnapshot.current);
    snapshot.books['角色A世界书'][0].commentHash = undefined;
    mockStateSnapshot.current = snapshot;
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: [], type: 'constant', comment: skillComment_ACU, content: '内容A' },
    ]);

    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '缺少编辑指纹' }]);

    expect(written).toBe(false);
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      type: 'constant',
      keys: [],
    });
  });

  it('正文绿灯写入遇到已启用 constant 且 keys 非空的受控条目时不重复 patch 或清空 keys', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    mockSetLorebookEntries.mockClear();
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['仍有关键词'], type: 'constant', comment: skillComment_ACU, content: '内容A' },
    ]);

    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '正文需要' }]);

    expect(written).toBe(true);
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, type: 'constant', keys: ['仍有关键词'] });
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([{ bookName: '角色A世界书', uid: 1 }]);
  });

  it('正文绿灯覆盖写入会关闭上一轮放行条目并只开启本轮 allowlist', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
      { uid: 2, enabled: true, keys: ['钥匙B'], type: 'selective', comment: skillCommentB_ACU, content: '内容B' },
    ]);
    await takeoverWorldbookGreenlights_ACU();

    await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '第一轮正文需要' }]);
    await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 2, reason: '第二轮正文需要' }]);
    const entries = mockEntriesByBook.get('角色A世界书') || [];

    expect(entries.find(entry => entry.uid === 1)).toMatchObject({ enabled: false });
    expect(entries.find(entry => entry.uid === 2)).toMatchObject({ enabled: true, type: 'constant', keys: ['钥匙B'] });
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([{ bookName: '角色A世界书', uid: 2 }]);
  });

  it('空选择按完整集合关闭上一轮全部受控条目，不改无关条目', async () => {
    await takeoverWorldbookGreenlights_ACU();
    await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }]);
    mockEntriesByBook.get('角色A世界书')!.push({ uid: 99, enabled: true, type: 'constant', comment: '无关条目' });

    await expect(writeFinalGenerationGreenlights_ACU([])).resolves.toBe(true);
    expect(mockEntriesByBook.get('角色A世界书')!.find(entry => entry.uid === 1)?.enabled).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')!.find(entry => entry.uid === 99)?.enabled).toBe(true);
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([]);
  });

  it('Agent 失败仅按持久快照恢复原条目，忽略矛盾的内存快照并保留恢复依据', async () => {
    mockEntriesByBook.get('角色A世界书')![0].type = 'selective';
    await takeoverWorldbookGreenlights_ACU();
    await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }]);
    const persisted = structuredClone(mockStateSnapshot.current);
    const staleCache = structuredClone(persisted);
    staleCache.books['角色A世界书'][0].previousEnabled = false;
    staleCache.books['角色A世界书'][0].previousKeys = ['错误缓存'];
    setPlotAgentWorldbookSnapshot_ACU(staleCache);
    mockWriteAgentWorldbookState.mockClear();
    const reportWarning = vi.fn();

    await recoverAgentWorldbookAfterFailure_ACU(new Error('Agent 请求失败'), { phase: 'agent_decision', assertCurrent: () => {}, reportWarning });

    expect(mockEntriesByBook.get('角色A世界书')![0]).toMatchObject({ enabled: true, type: 'selective', keys: ['钥匙A'], comment: skillComment_ACU });
    expect(mockStateSnapshot.current).toEqual(persisted);
    expect(mockWriteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(isAgentWorldbookNativeFallback_ACU()).toBe(true);
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(reportWarning.mock.calls[0][0]).toContain('已按持久快照恢复');
  });

  it('持久快照缺失时不会拿内存快照恢复条目', async () => {
    await takeoverWorldbookGreenlights_ACU();
    mockStateSnapshot.current = { active: false, selectionSignature: '', createdAt: 0, books: {} };
    mockSetLorebookEntries.mockClear();
    mockWriteAgentWorldbookState.mockClear();

    await recoverAgentWorldbookAfterFailure_ACU(new Error('Agent 请求失败'), { phase: 'agent_decision', assertCurrent: () => {} });

    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
    expect(mockEntriesByBook.get('角色A世界书')![0].enabled).toBe(false);
    expect(mockWriteAgentWorldbookState).not.toHaveBeenCalled();
  });

  it('跨书选择部分写入失败后按持久快照恢复全部原状态', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书', '角色B世界书']);
    mockEntriesByBook.get('角色A世界书')![0].type = 'selective';
    mockEntriesByBook.set('角色B世界书', [{ uid: 2, enabled: true, type: 'selective', keys: ['钥匙B'], comment: skillCommentB_ACU }]);
    await takeoverWorldbookGreenlights_ACU();
    const applyPatches = mockSetLorebookEntries.getMockImplementation()!;
    let rejected = false;
    mockSetLorebookEntries.mockImplementation(async (bookName: string, patches: any[]) => {
      if (bookName === '角色B世界书' && !rejected) { rejected = true; throw new Error('宿主写入失败'); }
      return applyPatches(bookName, patches);
    });
    await expect(writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }, { bookName: '角色B世界书', uid: 2 }])).rejects.toThrow('宿主写入失败');
    expect(mockEntriesByBook.get('角色A世界书')![0].type).toBe('constant');

    await recoverAgentWorldbookAfterFailure_ACU(new Error('选择未完整写入'), { phase: 'apply_selection', assertCurrent: () => {} });

    expect(mockEntriesByBook.get('角色A世界书')![0]).toMatchObject({ enabled: true, type: 'selective', keys: ['钥匙A'] });
    expect(mockEntriesByBook.get('角色B世界书')![0]).toMatchObject({ enabled: true, type: 'selective', keys: ['钥匙B'] });
    expect(mockStateSnapshot.current.active).toBe(true);
  });

  it.each(['用户修改', '读取失败'])('Agent 恢复遇到%s时保留持久证据并独立告警', async failure => {
    await takeoverWorldbookGreenlights_ACU();
    const persisted = structuredClone(mockStateSnapshot.current);
    const reportWarning = vi.fn();
    if (failure === '用户修改') mockEntriesByBook.get('角色A世界书')![0].comment = '用户修改后的条目';
    else mockGetLorebookEntries.mockRejectedValueOnce(new Error('读取失败'));

    await expect(recoverAgentWorldbookAfterFailure_ACU(new Error('Agent 请求失败'), { phase: 'agent_decision', assertCurrent: () => {}, reportWarning })).resolves.toBeUndefined();

    expect(mockStateSnapshot.current).toEqual(persisted);
    expect(mockEntriesByBook.get('角色A世界书')![0].enabled).toBe(false);
    expect(reportWarning.mock.calls[0][0]).toContain('部分原始状态未能恢复');
    expect(reportWarning.mock.calls[0][0]).toContain('普通剧情继续');
  });

  it('取消发生在恢复开始前时不读写世界书，也不设置回退状态', async () => {
    const assertCurrent = () => { throw new Error('TaskAbortedByUser'); };
    await expect(recoverAgentWorldbookAfterFailure_ACU(new Error('Agent 请求失败'), { phase: 'agent_decision', assertCurrent })).rejects.toThrow('TaskAbortedByUser');
    expect(mockReadAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
    expect(isAgentWorldbookNativeFallback_ACU()).toBe(false);
  });

  it('恢复读完条目前会话已失效时不写入条目', async () => {
    await takeoverWorldbookGreenlights_ACU();
    mockSetLorebookEntries.mockClear();
    let current = true;
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => { current = false; return mockEntriesByBook.get(bookName) || []; });
    await expect(recoverAgentWorldbookAfterFailure_ACU(new Error('Agent 请求失败'), {
      phase: 'agent_decision', assertCurrent: () => { if (!current) throw new Error('TaskAbortedByUser'); },
    })).rejects.toThrow('TaskAbortedByUser');
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
  });

  it('旧决策在排队前配置已变化时不读取或写入新配置范围', async () => {
    await takeoverWorldbookGreenlights_ACU();
    const expectedRevision = getAgentWorldbookRuntimeRevision_ACU();
    setLoadedAgentWorldbookControl_ACU(null, expectedRevision, true);
    mockReadAgentWorldbookState.mockClear();
    mockSetLorebookEntries.mockClear();

    await expect(writeFinalGenerationGreenlights_ACU([], { expectedRevision })).resolves.toBe(false);
    expect(mockReadAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
    const reportWarning = vi.fn();
    await recoverAgentWorldbookAfterFailure_ACU(new Error('旧决策失败'), {
      phase: 'apply_selection', assertCurrent: () => {}, expectedRevision, reportWarning,
    });
    expect(mockReadAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
    expect(isAgentWorldbookNativeFallback_ACU()).toBe(false);
    expect(reportWarning.mock.calls[0][0]).toContain('未覆盖新配置');
  });

  it.each(['cancelled', 'configuration_changed'])('选择预读后发生 %s 时不提交条目开关', async reason => {
    await takeoverWorldbookGreenlights_ACU();
    mockSetLorebookEntries.mockClear();
    const expectedRevision = getAgentWorldbookRuntimeRevision_ACU();
    let current = true;
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      if (reason === 'configuration_changed') setLoadedAgentWorldbookControl_ACU(null, getAgentWorldbookRuntimeRevision_ACU(), true);
      current = false;
      return mockEntriesByBook.get(bookName) || [];
    });
    const operation = writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }], {
      expectedRevision,
      assertCurrent: () => { if (reason === 'cancelled' && !current) throw new Error('TaskAbortedByUser'); },
    });
    if (reason === 'cancelled') await expect(operation).rejects.toThrow('TaskAbortedByUser');
    else await expect(operation).resolves.toBe(false);
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
  });

  it('宿主未完整应用开关补丁时返回失败，保留持久恢复快照', async () => {
    await takeoverWorldbookGreenlights_ACU();
    const persisted = structuredClone(mockStateSnapshot.current);
    mockSetLorebookEntries.mockImplementationOnce(async () => {});

    await expect(writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }])).resolves.toBe(false);
    expect(mockStateSnapshot.current).toEqual(persisted);
  });

  it('快照仍 pending 时拒绝完整选择且不写条目', async () => {
    await takeoverWorldbookGreenlights_ACU();
    mockStateSnapshot.current.books['角色A世界书'][0].takeoverStatus = 'pending';
    mockSetLorebookEntries.mockClear();

    await expect(writeFinalGenerationGreenlights_ACU([])).resolves.toBe(false);
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
  });

  it('清理正文绿灯只关闭当前蓝灯条目并清理旧版本隐藏状态条目', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
      { uid: 'final-state', enabled: false, type: 'constant', keys: [], comment: AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU, content: '{}' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '正文需要' }]);

    const cleared = await clearFinalGenerationGreenlights_ACU();

    expect(cleared).toMatchObject({ status: 'cleared', patched: 2, staleBookNames: [] });
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: false, type: 'constant', keys: ['钥匙A'] });
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([]);
  });


  it('constant 且 keys 非空的受控条目同样视为正文蓝灯并可被 clear 关闭', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['仍有关键词'], type: 'constant', comment: skillComment_ACU, content: '内容A' },
    ]);

    const readBack = await readFinalGenerationGreenlights_ACU();
    const cleared = await clearFinalGenerationGreenlights_ACU();

    expect(readBack).toEqual([{ bookName: '角色A世界书', uid: 1 }]);
    expect(cleared).toMatchObject({ status: 'cleared', patched: expect.any(Number) });
    expect(cleared.patched).toBeGreaterThanOrEqual(1);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: false,
      type: 'constant',
      keys: ['仍有关键词'],
    });
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([]);
  });

  it('宿主存在已删除世界书引用时隔离 stale，其余有效世界书继续清理绿灯', async () => {
    mockResolveBookNames.mockResolvedValue(['已删除世界书', '角色A世界书']);
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      if (bookName === '已删除世界书') throw new Error('Worldbook not found: 已删除世界书');
      return mockEntriesByBook.get(bookName) || [];
    });
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    // 预先建立有效书的 active snapshot（绕过 collectTakeoverCandidates 对 not-found 无隔离的既有行为）
    setPlotAgentWorldbookSnapshot_ACU({
      active: true,
      selectionSignature: buildWorldbookSelectionSignature_ACU(['已删除世界书', '角色A世界书']),
      createdAt: Date.now(),
      books: { '角色A世界书': [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }] },
    } as any);
    mockWriteAgentWorldbookState.mockImplementation(async () => ({ updated: true, bookName: '角色A世界书', snapshot: {}, control: {} }));

    const cleared = await clearFinalGenerationGreenlights_ACU();

    expect(cleared.status).toBe('isolated_stale');
    expect(cleared.staleBookNames).toEqual(['已删除世界书']);
  });

  it('全部候选世界书已删除时返回 isolated_stale 且不写任何内容', async () => {
    mockResolveBookNames.mockResolvedValue(['已删除世界书A', '已删除世界书B']);
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      throw new Error(`Worldbook not found: ${bookName}`);
    });
    mockStateSnapshot.current = { active: true, selectionSignature: buildWorldbookSelectionSignature_ACU(['已删除世界书A', '已删除世界书B']), createdAt: 1, books: {} };

    const cleared = await clearFinalGenerationGreenlights_ACU();

    expect(cleared.status).toBe('isolated_stale');
    expect(cleared.staleBookNames).toEqual(['已删除世界书A', '已删除世界书B']);
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
  });


  it('没有 active snapshot 时正文绿灯写入返回 false 且不修改真实条目', async () => {
    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1, reason: '正文需要' }]);

    expect(written).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, keys: ['钥匙A'] });
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([]);
  });

  it('正文绿灯写入会忽略 active snapshot 之外的 uid，避免 Agent 任意修改世界书', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
    ]);
    await takeoverWorldbookGreenlights_ACU();
    mockEntriesByBook.set('角色A世界书', [
      ...(mockEntriesByBook.get('角色A世界书') || []),
      { uid: 100, enabled: true, keys: ['接管后新增'], type: 'selective', comment: '接管后新增条目', content: '新增内容' },
    ]);

    const written = await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 100, reason: '越界正文需要' }]);

    expect(written).toBe(false);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 100)).toMatchObject({ enabled: true, type: 'selective', keys: ['接管后新增'] });
    expect(await readFinalGenerationGreenlights_ACU()).toEqual([]);
  });

  it('恢复会按 active snapshot 恢复原世界书条目状态并清理旧版本内部隐藏条目', async () => {
    mockEntriesByBook.set('角色A世界书', [


      { uid: 1, enabled: false, keys: ['钥匙A'], comment: '普通条目A', content: '内容A' },
      { uid: 'final-state', enabled: false, type: 'constant', keys: [], comment: AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU, content: '{}' },
      { uid: 'snapshot-state', enabled: false, type: 'constant', keys: [], comment: AGENT_WORLDBOOK_SNAPSHOT_COMMENT_ACU, content: '{}' },
    ]);
    (settings_ACU as any).plotSettings.agentWorldbookControlSnapshot = {
      active: true,
      selectionSignature: 'hash:{"scope":"agent-worldbook-takeover","books":["角色A世界书"]}',
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU();

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('native_worldbook_trigger_restored');
    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)?.enabled).toBe(true);
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
    expect(snapshotEntry()).toBeUndefined();
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(false);
  });

  it('显式清理并初始化在 state snapshot 恢复成功后删除 state 条目', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: '普通条目A', content: '内容A' },
    ]);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('native_worldbook_trigger_restored');
    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
    expect(mockStateSnapshot.current.active).toBe(false);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(false);
  });

  it('restore_only 恢复受控条目但保留 state 与 snapshot 条目', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: '普通条目A', content: '内容A' },
      { uid: 'final-state', enabled: false, type: 'constant', keys: [], comment: AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU, content: '{}' },
      { uid: 'snapshot-state', enabled: false, type: 'constant', keys: [], comment: AGENT_WORLDBOOK_SNAPSHOT_COMMENT_ACU, content: '{}' },
    ]);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'restore_only' });

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('native_worldbook_trigger_restored');
    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, keys: ['钥匙A'] });
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
    expect(snapshotEntry()).toBeDefined();
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current.active).toBe(true);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(true);
  });

  it('显式清理并初始化在恢复写回失败时保留 state 条目和 active snapshot', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: '普通条目A', content: '内容A' },
    ]);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };
    mockSetLorebookEntries.mockRejectedValueOnce(new Error('write failed'));

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result.updated).toBe(true);
    expect(result.reason).toBe('native_worldbook_trigger_restore_failed');
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current.active).toBe(true);
    expect(getPlotAgentWorldbookSnapshot_ACU().active).toBe(true);
  });

  it('full restore 在读取世界书失败时报告所有待恢复 UID 为失败并保留 pending 账本', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙A'], type: 'selective', comment: '普通条目A', content: '内容A' },
      { uid: 2, enabled: false, keys: ['新钥匙B'], type: 'selective', comment: '普通条目B', content: '内容B' },
    ]);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' },
          { uid: 2, previousEnabled: true, previousKeys: ['钥匙B'], previousType: 'selective', commentHash: 'hash:普通条目B' },
        ],
      },
    };
    let reads = 0;
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      reads += 1;
      if (reads === 2) throw new Error('restore read failed');
      return mockEntriesByBook.get(bookName) || [];
    });

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({
      updated: true,
      reason: 'native_worldbook_trigger_restore_failed',
      restored: 0,
      skipped: 0,
      failed: 2,
    });
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: {
        角色A世界书: [
          expect.objectContaining({ uid: 1, takeoverStatus: 'pending' }),
          expect.objectContaining({ uid: 2, takeoverStatus: 'pending' }),
        ],
      },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
  });


  it('显式清理并初始化在没有 active snapshot 时不删除 state 条目', async () => {
    mockStateSnapshot.current = {
      active: false,
      selectionSignature: buildWorldbookSelectionSignature_ACU(['角色A世界书']),
      createdAt: 1,
      books: {},
    };

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('no_active_snapshot');
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
  });

  it('恢复 state snapshot 时忽略 Skill 元数据块变化但保留该元数据，避免一键 Skill 化后清除并初始化误跳过', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: `普通条目A\n\n${skillMetaBlock_ACU}`, content: '内容A' },
    ]);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result.reason).toBe('native_worldbook_trigger_restored');
    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      keys: ['钥匙A'],
      comment: `普通条目A\n\n${skillMetaBlock_ACU}`,
    });
  });

  it('恢复 state snapshot 时兼容旧 commentHash 口径包含 Skill 元数据块的条目', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const takeoverMetaBlock = `<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n${JSON.stringify({
      version: 1,
      kind: 'agent_worldbook_takeover',
      selectionSignature,
      createdAt: 1,
      previousEnabled: true,
      previousKeys: ['钥匙A'],
      commentHash: `hash:普通条目A\n\n${skillMetaBlock_ACU}`,
    })}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`;
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: `普通条目A\n\n${skillMetaBlock_ACU}\n\n${takeoverMetaBlock}`, content: '内容A' },
    ]);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: `hash:普通条目A\n\n${skillMetaBlock_ACU}` },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result.reason).toBe('native_worldbook_trigger_restored');
    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      keys: ['钥匙A'],
      comment: `普通条目A\n\n${skillMetaBlock_ACU}`,
    });
  });

  it('恢复 state snapshot 时旧 commentHash 口径包含 Skill 元数据但用户已改 comment 仍跳过并保留 state', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const takeoverMetaBlock = `<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n${JSON.stringify({
      version: 1,
      kind: 'agent_worldbook_takeover',
      selectionSignature,
      createdAt: 1,
      previousEnabled: true,
      previousKeys: ['钥匙A'],
      commentHash: `hash:普通条目A\n\n${skillMetaBlock_ACU}`,
    })}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`;
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: `用户已改名\n\n${skillMetaBlock_ACU}\n\n${takeoverMetaBlock}`, content: '内容A' },
    ]);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: `hash:普通条目A\n\n${skillMetaBlock_ACU}` },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('native_worldbook_trigger_restore_skipped');
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current.active).toBe(true);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: false,
      keys: ['新钥匙'],
      comment: `用户已改名\n\n${skillMetaBlock_ACU}\n\n${takeoverMetaBlock}`,
    });
  });

  it('有效但不完整的 state 会与同 scope 条目 meta 合并，恢复时不会遗留 disabled 条目', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const metaForSecondEntry = `<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n${JSON.stringify({
      version: 1,
      kind: 'agent_worldbook_takeover',
      selectionSignature,
      createdAt: 2,
      previousEnabled: true,
      previousKeys: ['钥匙B'],
      previousType: 'selective',
      commentHash: 'hash:普通条目B',
    })}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`;
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['钥匙A'], type: 'selective', comment: skillComment_ACU, content: '内容A' },
      { uid: 2, enabled: false, keys: ['钥匙B'], type: 'selective', comment: `${skillCommentB_ACU}\n\n${metaForSecondEntry}`, content: '内容B' },
    ]);

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });
    const entries = mockEntriesByBook.get('角色A世界书') || [];

    expect(result).toMatchObject({ restored: 2, skipped: 0, failed: 0 });
    expect(entries.find(entry => entry.uid === 1)).toMatchObject({ enabled: true, keys: ['钥匙A'], type: 'selective' });
    expect(entries.find(entry => entry.uid === 2)).toMatchObject({ enabled: true, keys: ['钥匙B'], type: 'selective', comment: skillCommentB_ACU });
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
  });

  it('同 UID state 缺少恢复字段时由合法 meta 补齐，用户改 comment 后仍保守跳过', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const takeoverMetaBlock = `<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n${JSON.stringify({
      version: 1,
      kind: 'agent_worldbook_takeover',
      selectionSignature,
      createdAt: 2,
      previousEnabled: true,
      previousKeys: ['钥匙A'],
      previousType: 'selective',
      commentHash: 'hash:普通条目A',
    })}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`;
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['用户新关键词'], type: 'selective', comment: `用户已改名\n\n${skillMetaBlock_ACU}\n\n${takeoverMetaBlock}`, content: '内容A' },
    ]);

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });
    const entry = mockEntriesByBook.get('角色A世界书')?.find(item => item.uid === 1);

    expect(result).toMatchObject({ restored: 0, skipped: 1, failed: 0 });
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current.books['角色A世界书'][0]).toMatchObject({
      uid: 1,
      previousEnabled: true,
      previousKeys: ['钥匙A'],
      previousType: 'selective',
      commentHash: 'hash:普通条目A',
    });
    expect(entry).toMatchObject({ enabled: false, keys: ['用户新关键词'] });
    expect(entry?.comment).toContain(takeoverMetaBlock);
  });

  it('恢复时如果 comment 已变化则跳过该条目，避免误恢复用户已改写的世界书条目', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: '用户已改名', content: '内容A' },
    ]);
    (settings_ACU as any).plotSettings.agentWorldbookControlSnapshot = {
      active: true,
      selectionSignature: 'hash:{"scope":"agent-worldbook-takeover","books":["角色A世界书"]}',
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU();

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('native_worldbook_trigger_restore_skipped');
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: false,
      keys: ['新钥匙'],
      comment: '用户已改名',
    });
  });

  it('恢复 state snapshot 时如果 comment 已变化则保留 state 条目，避免丢失手动恢复依据', async () => {
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], comment: '用户已改名', content: '内容A' },
    ]);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature: 'hash:{"scope":"agent-worldbook-takeover","books":["角色A世界书"]}',
      createdAt: 1,
      books: {
        '角色A世界书': [
          { uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], commentHash: 'hash:普通条目A' },
        ],
      },
    };

    const result = await restoreWorldbookGreenlights_ACU();

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('native_worldbook_trigger_restore_skipped');
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current.active).toBe(true);
  });

  it('full restore 部分成功时从 state 与 cache 移除已恢复 UID，仅保留跳过 UID', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书', '角色B世界书']);
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书', '角色B世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }],
        角色B世界书: [{ uid: 2, previousEnabled: true, previousKeys: ['钥匙B'], previousType: 'selective', commentHash: 'hash:普通条目B' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙A'], type: 'constant', comment: '普通条目A', content: '内容A' },
    ]);
    mockEntriesByBook.set('角色B世界书', [
      { uid: 2, enabled: false, keys: ['用户关键词B'], type: 'selective', comment: '用户已改名', content: '内容B' },
    ]);

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({
      reason: 'native_worldbook_trigger_restored',
      restored: 1,
      skipped: 1,
      failed: 0,
    });
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色B世界书: [expect.objectContaining({ uid: 2 })] },
    });
    expect(mockStateSnapshot.current.books.角色A世界书).toBeUndefined();
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      keys: ['钥匙A'],
      type: 'selective',
    });
    expect(mockEntriesByBook.get('角色B世界书')?.find(entry => entry.uid === 2)).toMatchObject({
      enabled: false,
      keys: ['用户关键词B'],
      comment: '用户已改名',
    });
    expect(await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }])).toBe(false);
  });

  it('full restore 最终账本写入未落盘时保留 pending cache 与 state，避免已恢复 UID 被重新消费', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], type: 'constant', comment: '普通条目A', content: '内容A' },
    ]);
    let writes = 0;
    mockWriteAgentWorldbookState.mockImplementation(async (patch: any) => {
      writes += 1;
      if (writes === 2) return { updated: false, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
      if (patch?.snapshot) mockStateSnapshot.current = patch.snapshot;
      return { updated: true, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
    });

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({ reason: 'snapshot_state_write_failed', restored: 1, skipped: 0, failed: 0 });
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
    expect(await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }])).toBe(false);

    const retry = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(retry).toMatchObject({ restored: 0, skipped: 0, failed: 0 });
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
    expect(mockStateSnapshot.current).toMatchObject({ active: false, books: {} });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toMatchObject({ active: false, books: {} });
  });

  it('full restore 重试时用户修改 comment 会保留 pending 恢复证据', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], type: 'constant', comment: '普通条目A', content: '内容A' },
    ]);
    let writes = 0;
    mockWriteAgentWorldbookState.mockImplementation(async (patch: any) => {
      writes += 1;
      if (writes === 2) return { updated: false, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
      if (patch?.snapshot) mockStateSnapshot.current = patch.snapshot;
      return { updated: true, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
    });

    await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: '用户已修改条目', content: '内容A' },
    ]);

    const retry = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(retry).toMatchObject({ restored: 0, skipped: 0, failed: 0 });
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
  });

  it('full restore 最终账本写入抛错时保留 pending cache 与 state，避免已恢复 UID 被重新消费', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], type: 'constant', comment: '普通条目A', content: '内容A' },
    ]);
    let writes = 0;
    mockWriteAgentWorldbookState.mockImplementation(async (patch: any) => {
      writes += 1;
      if (writes === 2) throw new Error('final state write failed');
      if (patch?.snapshot) mockStateSnapshot.current = patch.snapshot;
      return { updated: true, bookName: '角色A世界书', snapshot: mockStateSnapshot.current, control: {} };
    });

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({ reason: 'snapshot_state_write_failed', restored: 1, skipped: 0, failed: 0 });
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
    expect(await writeFinalGenerationGreenlights_ACU([{ bookName: '角色A世界书', uid: 1 }])).toBe(false);

    const retry = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(retry).toMatchObject({ restored: 0, skipped: 0, failed: 0 });
    expect(mockDeleteAgentWorldbookState).toHaveBeenCalledTimes(1);
    expect(mockStateSnapshot.current).toMatchObject({ active: false, books: {} });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toMatchObject({ active: false, books: {} });
  });

  it('full restore 重试时 pending 缺少 commentHash 会保留恢复证据', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, takeoverStatus: 'pending', previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'selective', comment: '用户已修改条目', content: '内容A' },
    ]);

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({ restored: 0, skipped: 0, failed: 0 });
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: true,
      keys: ['钥匙A'],
      type: 'selective',
      comment: '用户已修改条目',
    });
  });

  it('full restore 对缺少 commentHash 的 applied 条目不覆盖内容并保留 pending 证据', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['用户关键词'], type: 'constant', comment: '用户已修改条目', content: '内容A' },
    ]);

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({ restored: 0, skipped: 1, failed: 0 });
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] },
    });
    expect(getPlotAgentWorldbookSnapshot_ACU()).toEqual(mockStateSnapshot.current);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: false,
      keys: ['用户关键词'],
      type: 'constant',
      comment: '用户已修改条目',
    });
  });

  it('full restore 遇到未知版本接管元数据时保留条目与 state 证据', async () => {
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['角色A世界书']);
    const futureMeta = `<!-- ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\n${JSON.stringify({ version: 2, kind: 'agent_worldbook_takeover', selectionSignature })}\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END -->`;
    mockStateSnapshot.current = {
      active: true,
      selectionSignature,
      createdAt: 1,
      books: {
        角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }],
      },
    };
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: false, keys: ['新钥匙'], type: 'selective', comment: `普通条目A\n\n${futureMeta}`, content: '内容A' },
    ]);

    const result = await restoreWorldbookGreenlights_ACU({ cleanupMode: 'full' });

    expect(result).toMatchObject({ restored: 0, skipped: 1, failed: 0 });
    expect(mockDeleteAgentWorldbookState).not.toHaveBeenCalled();
    expect(mockStateSnapshot.current).toMatchObject({
      active: true,
      books: { 角色A世界书: [expect.objectContaining({ uid: 1, takeoverStatus: 'pending' })] },
    });
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({
      enabled: false,
      keys: ['新钥匙'],
      comment: `普通条目A\n\n${futureMeta}`,
    });
  });

  it('没有 active snapshot 或遗留内部条目时恢复返回空操作结果', async () => {
    const result = await restoreWorldbookGreenlights_ACU();

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('no_active_snapshot');
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)?.enabled).toBe(true);
    expect(snapshotEntry()).toBeUndefined();
    expect(finalGenerationGreenlightEntry()).toBeUndefined();
  });

/**
 * T1 回归基线：真实 readContext + strict 包装路径。
 * gateway 对 stale 书抛 Worldbook not found → getAgentRuntimeLorebookEntries_ACU 经 pipeline
 * 包成 StrictLorebookReadError_ACU → clearFinalGenerationGreenlights_ACU 必须识别 strict 结构。
 */
describe('clearFinalGenerationGreenlights_ACU with strict readContext (T1 baseline)', () => {
  function buildReadContext(runId = 'run-strict'): any {
    return {
      runId,
      bookEntriesPromises: new Map(),
      availableBookNamesPromise: Promise.resolve(['已删除世界书', '角色A世界书']),
      isActive: () => true,
      isAborted: () => false,
    };
  }

  it('strict-wrapped not-found 被分类为 stale 而非 failed/unknown', async () => {
    mockResolveBookNames.mockResolvedValue(['已删除世界书']);
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      throw new Error(`Worldbook not found: ${bookName}`);
    });
    mockStateSnapshot.current = { active: true, selectionSignature: buildWorldbookSelectionSignature_ACU(['已删除世界书']), createdAt: 1, books: {} };

    const cleared = await clearFinalGenerationGreenlights_ACU(buildReadContext());

    expect(cleared.status).toBe('isolated_stale');
    expect(cleared.staleBookNames).toEqual(['已删除世界书']);
    expect(cleared.error).toBeUndefined();
  });

  it('strict-wrapped stale + 有效书：有效书完成清绿灯，stale 只出现在 staleBookNames', async () => {
    mockResolveBookNames.mockResolvedValue(['已删除世界书', '角色A世界书']);
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      if (bookName === '已删除世界书') throw new Error(`Worldbook not found: ${bookName}`);
      return mockEntriesByBook.get(bookName) || [];
    });
    mockEntriesByBook.set('角色A世界书', [
      { uid: 1, enabled: true, keys: ['钥匙A'], type: 'constant', comment: skillComment_ACU, content: '内容A' },
      { uid: 'final-state', enabled: false, type: 'constant', keys: [], comment: AGENT_FINAL_GENERATION_GREENLIGHT_COMMENT_ACU, content: '{}' },
    ]);
    // 先建立只含有效书的 active snapshot（避免 takeover 读取 stale 书本身失败）
    const selectionSignature = buildWorldbookSelectionSignature_ACU(['已删除世界书', '角色A世界书']);
    const activeSnapshot = {
      active: true,
      selectionSignature,
      createdAt: Date.now(),
      books: { '角色A世界书': [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }] },
    };
    mockStateSnapshot.current = activeSnapshot;
    setPlotAgentWorldbookSnapshot_ACU(activeSnapshot as any);
    mockWriteAgentWorldbookState.mockImplementation(async () => ({ updated: true, bookName: '角色A世界书', snapshot: {}, control: {} }));
    mockSetLorebookEntries.mockClear();

    const cleared = await clearFinalGenerationGreenlights_ACU(buildReadContext());

    expect(cleared.status).toBe('isolated_stale');
    expect(cleared.staleBookNames).toEqual(['已删除世界书']);
    expect(mockEntriesByBook.get('角色A世界书')?.find(entry => entry.uid === 1)).toMatchObject({ enabled: false, type: 'constant' });
    expect(finalGenerationGreenlightEntry('角色A世界书')).toBeUndefined();
  });

  it('strict-wrapped 权限/契约错误 → failed，安全摘要含 subphase 且不含原始 message', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书']);
    mockGetLorebookEntries.mockImplementation(async () => {
      throw new Error('Lorebook permission denied: secret-token');
    });
    mockStateSnapshot.current = { active: true, selectionSignature: buildWorldbookSelectionSignature_ACU(['角色A世界书']), createdAt: 1, books: { '角色A世界书': [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }] } };

    const cleared = await clearFinalGenerationGreenlights_ACU(buildReadContext());

    expect(cleared.status).toBe('failed');
    expect(cleared.error).toBeDefined();
    expect(cleared.error!.category).not.toBe('unknown');
    expect(cleared.error!.subphase).toBeDefined();
    expect(JSON.stringify(cleared.error)).not.toContain('secret-token');
  });

  it('全部候选 strict stale：返回 isolated_stale、patched 0，不调用 AI 链', async () => {
    mockResolveBookNames.mockResolvedValue(['已删除世界书A', '已删除世界书B']);
    mockGetLorebookEntries.mockImplementation(async (bookName: string) => {
      throw new Error(`Worldbook not found: ${bookName}`);
    });
    mockStateSnapshot.current = { active: true, selectionSignature: buildWorldbookSelectionSignature_ACU(['已删除世界书A', '已删除世界书B']), createdAt: 1, books: {} };

    const cleared = await clearFinalGenerationGreenlights_ACU(buildReadContext());

    expect(cleared.status).toBe('isolated_stale');
    expect(cleared.patched).toBe(0);
    expect(cleared.staleBookNames).toEqual(['已删除世界书A', '已删除世界书B']);
    expect(mockSetLorebookEntries).not.toHaveBeenCalled();
  });

  it('abort/scope_changed strict error 不得被分类为 unknown', async () => {
    mockResolveBookNames.mockResolvedValue(['角色A世界书']);
    mockGetLorebookEntries.mockImplementation(async () => []);
    mockStateSnapshot.current = { active: true, selectionSignature: buildWorldbookSelectionSignature_ACU(['角色A世界书']), createdAt: 1, books: { '角色A世界书': [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective', commentHash: 'hash:普通条目A' }] } };

    const abortedCtx = buildReadContext();
    abortedCtx.isAborted = () => true;
    const aborted = await clearFinalGenerationGreenlights_ACU(abortedCtx);
    expect(aborted.status).toBe('failed');
    expect(aborted.error!.category).toBe('aborted');

    const scopeChangedCtx = buildReadContext();
    scopeChangedCtx.isActive = () => false;
    const scopeChanged = await clearFinalGenerationGreenlights_ACU(scopeChangedCtx);
    expect(scopeChanged.status).toBe('failed');
    expect(scopeChanged.error!.category).toBe('scope_changed');
  });
});

});
