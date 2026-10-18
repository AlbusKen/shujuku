import { ref, shallowRef } from 'vue';
import { getLorebookEntriesByNames_ACU } from '../../service/worldbook/pipeline';
import { refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU } from '../../service/agent/agent-worldbook-takeover';
import {
  buildWorldbookSnapshotEntryIndexByBook_ACU,
  getWorldbookSnapshotEntryForDisplay_ACU,
  resolveWorldbookEntryTakeoverState_ACU,
} from './worldbook-entry-display';
import {
  deleteWorldbookEntrySkillMeta_ACU,
  parseWorldbookSkillMetaFromComment_ACU,
  saveWorldbookEntrySkillMeta_ACU,
  type WorldbookSkillMeta_ACU,
  type WorldbookSkillMetaUpdatedBy_ACU,
} from '../../service/agent/agent-worldbook-skill-meta';
import { isWorldbookEntrySkillifyCandidate_ACU } from '../../service/agent/agent-skillify-service';
import { resolveAgentWorldbookScopeBookNames_ACU } from '../../service/agent/agent-worldbook-config-meta';
import { logError_ACU } from '../../shared/utils';
import { buildWorldbookEntryDisplayLabel_ACU } from '../../shared/agent-worldbook-comment';
import type {
  WorldbookEntryDisplayGroup_ACU,
  WorldbookEntryDisplayItem_ACU,
  WorldbookEntryTakeoverState_ACU,
  WorldbookSkillifySelectedEntry_ACU,
} from './worldbook-entry-display';

export type AgentWorldbookEntryTakeoverState = WorldbookEntryTakeoverState_ACU;
export type AgentWorldbookEntryLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export type AgentWorldbookEntryItem = WorldbookEntryDisplayItem_ACU;
export type AgentWorldbookEntryGroup = WorldbookEntryDisplayGroup_ACU;
export type AgentWorldbookSkillifySelectedEntry = WorldbookSkillifySelectedEntry_ACU;

function getEntryLabel_ACU(entry: any): string {
  return buildWorldbookEntryDisplayLabel_ACU(String(entry?.comment || entry?.name || ''), entry?.uid);
}

function selectionKey_ACU(bookName: string, uid: number): string {
  return `${bookName}\u0000${String(uid)}`;
}

function isAgentWorldbookEntryVisible_ACU(
  bookName: string,
  entry: any,
  skillMeta: WorldbookSkillMeta_ACU | null,
  snapshotEntry: unknown,
): boolean {
  return isWorldbookEntrySkillifyCandidate_ACU(entry)
    || skillMeta !== null
    || !!snapshotEntry;
}

export interface UseAgentWorldbookEntriesOptions {
  onSkillMetaChanged?: () => Promise<unknown> | unknown;
}

export function useAgentWorldbookEntries(options: UseAgentWorldbookEntriesOptions = {}) {
  const groups = shallowRef<AgentWorldbookEntryGroup[]>([]);
  const status = ref<AgentWorldbookEntryLoadStatus>('idle');
  const error = ref('');
  const selected = ref(new Map<string, AgentWorldbookSkillifySelectedEntry>());
  let loadGeneration = 0;

  /**
   * 加载条目列表。返回 null 表示本次调用已被更新的调用取代（不写任何状态），
   * 调用方应忽略结果；返回 string[] 为解析到的世界书名列表（失败时为 []，status='error'）。
   */
  async function loadEntries(): Promise<string[] | null> {
    const generation = ++loadGeneration;
    const isStale = () => generation !== loadGeneration;
    status.value = 'loading';
    error.value = '';
    try {
      const bookNames = await resolveAgentWorldbookScopeBookNames_ACU();
      if (isStale()) return null;
      const uniqueBookNames = [...new Set(bookNames.filter(name => typeof name === 'string' && !!name.trim()))];
      if (uniqueBookNames.length === 0) {
        groups.value = [];
        selected.value = new Map();
        status.value = 'success';
        return [];
      }
      const snapshot = await refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU();
      if (isStale()) return null;
      const snapshotEntryIndexByBook = buildWorldbookSnapshotEntryIndexByBook_ACU(snapshot);
      const entriesByBook = await getLorebookEntriesByNames_ACU(uniqueBookNames) as Record<string, any[]>;
      if (isStale()) return null;
      const nextGroups: AgentWorldbookEntryGroup[] = [];
      const visibleSelections = new Set<string>();
      // 刷新后保留用户已展开的分组，避免每次保存/删除 Skill 都把列表全部收起。
      const previousExpandedByBook = new Map(groups.value.map(group => [group.bookName, group.expanded]));
      for (const bookName of uniqueBookNames) {
        const entries = Array.isArray(entriesByBook[bookName]) ? entriesByBook[bookName] : [];
        const items = entries.flatMap((entry: any): AgentWorldbookEntryItem[] => {
          const comment = String(entry?.comment || entry?.name || '');
          const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
          const snapshotEntry = getWorldbookSnapshotEntryForDisplay_ACU(snapshotEntryIndexByBook, bookName, entry);
          if (!isAgentWorldbookEntryVisible_ACU(bookName, entry, skillMeta, snapshotEntry)) {
            return [];
          }
          const key = selectionKey_ACU(bookName, entry.uid);
          visibleSelections.add(key);
          return [{
            uid: entry.uid,
            bookName,
            label: getEntryLabel_ACU(entry),
            comment,
            skillMeta,
            hasSkill: !!skillMeta,
            agentTakeoverState: resolveWorldbookEntryTakeoverState_ACU(entry, !!skillMeta, snapshotEntry),
            checked: false,
            skillifySelected: selected.value.has(key),
            skillifySelectable: isWorldbookEntrySkillifyCandidate_ACU(entry),
            disabled: false,
          }];
        });
        if (items.length > 0) nextGroups.push({ bookName, entries: items, expanded: previousExpandedByBook.get(bookName) ?? false });
      }
      selected.value = new Map([...selected.value].filter(([key]) => visibleSelections.has(key)));
      groups.value = nextGroups;
      status.value = 'success';
      return uniqueBookNames;
    } catch (cause: any) {
      logError_ACU('[ACU-V2] useAgentWorldbookEntries loadEntries failed', cause);
      if (isStale()) return null;
      error.value = cause?.message || '加载 Agent 世界书条目失败';
      status.value = 'error';
      return [];
    }
  }

  function syncSelection(): void {
    groups.value = groups.value.map(group => ({
      ...group,
      entries: group.entries.map(entry => ({ ...entry, skillifySelected: selected.value.has(selectionKey_ACU(entry.bookName, entry.uid)) })),
    }));
  }

  function toggleSkillifyEntry(bookName: string, uid: number, checked: boolean): void {
    const key = selectionKey_ACU(bookName, uid);
    const next = new Map(selected.value);
    const entry = groups.value.find(group => group.bookName === bookName)?.entries.find(item => item.uid === uid);
    if (checked && entry?.skillifySelectable) {
      next.set(key, { bookName, uid });
    } else {
      next.delete(key);
    }
    selected.value = next;
    syncSelection();
  }

  function selectAllForSkillify(): void {
    selected.value = new Map(groups.value.flatMap(group => group.entries
      .filter(entry => entry.skillifySelectable)
      .map(entry => [
        selectionKey_ACU(entry.bookName, entry.uid),
        { bookName: entry.bookName, uid: entry.uid },
      ] as const)));
    syncSelection();
  }

  function deselectAllForSkillify(): void {
    selected.value = new Map();
    syncSelection();
  }

  function getSelectedSkillifyEntries(): AgentWorldbookSkillifySelectedEntry[] {
    return Array.from(selected.value.values());
  }

  function updateEntrySkillMetaLocal(bookName: string, uid: number, comment: string): void {
    const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
    groups.value = groups.value.map(group => {
      if (group.bookName !== bookName) return group;
      return {
        ...group,
        entries: group.entries.map(entry => {
          if (entry.uid !== uid) return entry;
          return {
            ...entry,
            comment,
            label: buildWorldbookEntryDisplayLabel_ACU(comment, uid),
            skillMeta,
            hasSkill: !!skillMeta,
          };
        }),
      };
    });
  }

  async function notifySkillMetaChanged(): Promise<void> {
    if (!options.onSkillMetaChanged) return;
    try {
      await options.onSkillMetaChanged();
    } catch (cause) {
      logError_ACU('[ACU-V2] sync Agent worldbook takeover after Skill meta change failed', cause);
    }
  }

  /** 与 agent-worldbook-skill-meta 的 noop 返回语义对齐：内容未变化/本就没有元数据不算失败。 */
  const SKILL_META_NOOP_REASONS = new Set(['世界书 Skill 元数据未变化', '世界书条目没有 Skill 元数据']);

  function throwIfSkillMetaWriteFailed(result: { updated: boolean; reason?: string }): void {
    if (!result.updated && result.reason && !SKILL_META_NOOP_REASONS.has(result.reason)) {
      throw new Error(result.reason);
    }
  }

  async function saveEntrySkillMeta(
    bookName: string,
    uid: number,
    draft: Partial<WorldbookSkillMeta_ACU>,
    updatedBy: WorldbookSkillMetaUpdatedBy_ACU = 'manual',
  ): Promise<void> {
    const result = await saveWorldbookEntrySkillMeta_ACU(bookName, uid, draft, updatedBy);
    throwIfSkillMetaWriteFailed(result);
    if (result.entry && typeof result.entry.comment === 'string') {
      updateEntrySkillMetaLocal(bookName, uid, result.entry.comment);
    }
    if (result.updated) await notifySkillMetaChanged();
  }

  async function deleteEntrySkillMeta(bookName: string, uid: number): Promise<void> {
    const result = await deleteWorldbookEntrySkillMeta_ACU(bookName, uid);
    throwIfSkillMetaWriteFailed(result);
    if (result.entry && typeof result.entry.comment === 'string') {
      updateEntrySkillMetaLocal(bookName, uid, result.entry.comment);
    }
    if (result.updated) await notifySkillMetaChanged();
  }

  function toggleGroupExpanded(bookName: string): void {
    groups.value = groups.value.map(group => group.bookName === bookName ? { ...group, expanded: !group.expanded } : group);
  }

  return {
    groups,
    status,
    error,
    loadEntries,
    toggleSkillifyEntry,
    selectAllForSkillify,
    deselectAllForSkillify,
    getSelectedSkillifyEntries,
    saveEntrySkillMeta,
    deleteEntrySkillMeta,
    toggleGroupExpanded,
  };
}
