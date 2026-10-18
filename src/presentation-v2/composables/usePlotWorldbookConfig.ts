/**
 * usePlotWorldbookConfig — 剧情推进世界书配置（D23.1）
 *
 * settings_ACU.plotSettings.plotWorldbookConfig 形如：
 *   { source: 'character'|'manual', manualSelection: string[], enabledEntries: {...} }
 *
 * 手动模式支持多本世界书，按 manualSelection 的数组顺序持久化。
 */
import { computed, ref } from 'vue';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../service/worldbook/worldbook-service';

export type PlotWorldbookSource = 'character' | 'manual';

interface PlotWorldbookConfigShape {
  source: PlotWorldbookSource;
  manualSelection: string[];
  enabledEntries?: Record<string, unknown>;
}

function ensureConfig(): PlotWorldbookConfigShape {
  if (!settings_ACU.plotSettings || typeof settings_ACU.plotSettings !== 'object') {
    settings_ACU.plotSettings = {} as Record<string, unknown>;
  }
  const plot = settings_ACU.plotSettings as Record<string, any>;
  if (!plot.plotWorldbookConfig || typeof plot.plotWorldbookConfig !== 'object') {
    plot.plotWorldbookConfig = { source: 'character', manualSelection: [], enabledEntries: {} };
  }
  const cfg = plot.plotWorldbookConfig as PlotWorldbookConfigShape;
  if (cfg.source !== 'manual') cfg.source = 'character';
  if (!Array.isArray(cfg.manualSelection)) cfg.manualSelection = [];
  if (!cfg.enabledEntries || typeof cfg.enabledEntries !== 'object') cfg.enabledEntries = {};
  return cfg;
}

function normalizeSelection(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const result: string[] = [];
  for (const name of names) {
    const trimmed = typeof name === 'string' ? name : '';
    if (trimmed.trim() && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

export function usePlotWorldbookConfig() {
  // 用 ref 复制响应式快照（settings_ACU 不是 Vue reactive）
  const source = ref<PlotWorldbookSource>('character');
  const manualSelection = ref<string[]>([]);
  const manualBook = computed<string>(() => manualSelection.value[0] || '');

  function refreshFromSettings(): void {
    const cfg = ensureConfig();
    source.value = cfg.source;
    manualSelection.value = normalizeSelection(cfg.manualSelection);
  }

  function setSource(next: PlotWorldbookSource): void {
    const cfg = ensureConfig();
    cfg.source = next;
    source.value = next;
    saveSettings_ACU();
  }

  function setManualSelection(names: string[]): void {
    const cfg = ensureConfig();
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
    const cfg = ensureConfig();
    if (cfg.source === 'manual') {
      return normalizeSelection(cfg.manualSelection);
    }
    const binding = await getCurrentCharacterWorldbookBinding_ACU();
    return binding.orderedNames;
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
