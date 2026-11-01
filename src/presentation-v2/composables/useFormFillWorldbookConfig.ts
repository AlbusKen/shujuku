/**
 * useFormFillWorldbookConfig — 填表"附加世界书条目"来源（Component B，§4.2）
 *
 * 操作 worldbookConfig.source / worldbookConfig.manualSelection。
 * 决定填表 AI 提示词附带的条目从哪本书来。
 *   - source='character'：跟随角色卡的所有世界书（primary + additional）
 *   - source='manual'：手动指定多本世界书（manualSelection）
 *
 * 与 useFormFillInjectionTarget（写入侧）相互独立。
 */
import { computed, ref } from 'vue';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { getCharLorebooks_ACU } from '../../service/worldbook/worldbook-service';

export type FormFillWorldbookSource = 'character' | 'manual';

function normalizeSelection(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const result: string[] = [];
  for (const name of names) {
    const trimmed = typeof name === 'string' ? name : '';
    if (trimmed.trim() && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

export function useFormFillWorldbookConfig() {
  const source = ref<FormFillWorldbookSource>('character');
  const manualSelection = ref<string[]>([]);
  const manualBook = computed<string>(() => manualSelection.value[0] || '');

  function refreshFromSettings(): void {
    const cfg = getCurrentWorldbookConfig_ACU();
    source.value = cfg.source === 'manual' ? 'manual' : 'character';
    manualSelection.value = normalizeSelection(cfg.manualSelection);
  }

  function setSource(next: FormFillWorldbookSource): void {
    const cfg = getCurrentWorldbookConfig_ACU();
    cfg.source = next;
    source.value = next;
    saveSettings_ACU();
  }

  function setManualSelection(names: string[]): void {
    const cfg = getCurrentWorldbookConfig_ACU();
    const next = normalizeSelection(names);
    cfg.source = 'manual';
    cfg.manualSelection = next;
    source.value = 'manual';
    manualSelection.value = [...next];
    saveSettings_ACU();
  }

  function toggleManualBook(name: string, checked: boolean): void {
    const trimmed = String(name || '');
    if (!trimmed.trim()) return;
    const current = normalizeSelection(manualSelection.value);
    const next = checked
      ? (current.includes(trimmed) ? current : [...current, trimmed])
      : current.filter(item => item !== trimmed);
    setManualSelection(next);
  }

  async function resolveBookNames(): Promise<string[]> {
    const cfg = getCurrentWorldbookConfig_ACU();
    if (cfg.source === 'manual') {
      return normalizeSelection(cfg.manualSelection);
    }
    const names: string[] = [];
    const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
    if (charLorebooks.primary) names.push(charLorebooks.primary);
    if (charLorebooks.additional?.length) names.push(...charLorebooks.additional);
    return normalizeSelection(names);
  }

  return {
    source,
    manualSelection,
    manualBook,
    refreshFromSettings,
    setSource,
    setManualSelection,
    toggleManualBook,
    resolveBookNames,
  };
}
