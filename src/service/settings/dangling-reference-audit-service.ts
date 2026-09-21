/**
 * service/settings/dangling-reference-audit-service.ts
 *
 * 只读校验 API 预设 / 世界书名称引用是否仍指向现存对象。
 * 审计路径不得改写持久化字段；清除必须由用户显式触发。
 */
import { settings_ACU } from '../runtime/state-manager';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';
import { saveSettings_ACU } from './settings-service';
import { getCurrentWorldbookConfig_ACU } from './settings-readers';
import {
  ensureApiSettingsShape_ACU,
} from './api-preset-service';
import { setFeatureApiPreset_ACU } from './feature-preset-reference-service';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { listLorebooks_ACU, resolveLorebookNameFromList_ACU } from '../../data/gateways/worldbook-gateway';
import { logWarn_ACU } from '../../shared/utils';
import {
  CONTINUATION_GLOBAL_SETTINGS_KEY_ACU,
  CONTINUATION_FIRST_FLOOR_FIELD_ACU,
  mutateCurrentContinuationApiPresetSettings_ACU,
  persistCurrentContinuationEnvelope_ACU,
} from '../continuation/continuation-store';
import { CONTINUATION_AGENT_API_PRESET_ROLES_ACU, type ContinuationSettings_ACU } from '../continuation/model';
import {
  WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU,
  mutateCurrentWorldSimulationApiPresetSettings_ACU,
  persistCurrentWorldSimulationEnvelope_ACU,
} from '../simulation/simulation-store';

export type DanglingReferenceKind_ACU = 'api_preset' | 'worldbook';

export interface DanglingReferenceItem_ACU {
  id: string;
  kind: DanglingReferenceKind_ACU;
  label: string;
  name: string;
  clearKey: string;
}

const CONTINUATION_ROLE_LABELS_ACU: Record<string, string> = {
  main: '主 Agent',
  outline: '大纲子代理',
  arcArchitect: '故事总纲子代理',
  maintainer: '伏笔维护子代理',
  mainlinePlanner: '主线策划子代理',
  beatPlanner: '节拍策划子代理',
  reviewer: '连续性审查子代理',
  finalReviewer: '发送前终审子代理',
  webResearcher: '网页检索子代理',
  requirementsMaintainer: '用户要求维护子代理',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function existingPresetNames_ACU(): Set<string> {
  ensureApiSettingsShape_ACU();
  return new Set((settings_ACU.apiPresets || []).map((preset: { name?: string }) => String(preset?.name || '').trim()).filter(Boolean));
}

function isDanglingPresetName_ACU(name: unknown, existing: Set<string>): string | null {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  return existing.has(normalized) ? null : normalized;
}

function pushPresetRef(
  items: DanglingReferenceItem_ACU[],
  existing: Set<string>,
  name: unknown,
  id: string,
  label: string,
  clearKey: string,
): void {
  const dangling = isDanglingPresetName_ACU(name, existing);
  if (!dangling) return;
  items.push({ id, kind: 'api_preset', label, name: dangling, clearKey });
}

function readKeywordApiPreset_ACU(): string {
  const holder = globalMeta_ACU?.vectorMemoryConfigGlobal && typeof globalMeta_ACU.vectorMemoryConfigGlobal === 'object'
    ? globalMeta_ACU.vectorMemoryConfigGlobal as { keywordApiPreset?: unknown }
    : settings_ACU.vectorMemoryConfig;
  return typeof holder?.keywordApiPreset === 'string' ? holder.keywordApiPreset : '';
}

function readContinuationGlobalSettings_ACU(): ContinuationSettings_ACU | null {
  const raw = (settings_ACU as Record<string, unknown>)[CONTINUATION_GLOBAL_SETTINGS_KEY_ACU];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as ContinuationSettings_ACU;
}

function collectFromContinuationSettings_ACU(
  items: DanglingReferenceItem_ACU[],
  existing: Set<string>,
  settings: ContinuationSettings_ACU | null,
  sourceLabel: string,
  keyPrefix: string,
): void {
  if (!settings) return;
  pushPresetRef(items, existing, settings.fixedApiPresetName, `${keyPrefix}-fixed`, `${sourceLabel}固定 API 预设`, `${keyPrefix}_fixed`);
  const presets = settings.agentApiPresets;
  if (!presets || typeof presets !== 'object') return;
  for (const role of CONTINUATION_AGENT_API_PRESET_ROLES_ACU) {
    const choice = presets[role];
    if (!choice) continue;
    const roleLabel = CONTINUATION_ROLE_LABELS_ACU[role] || role;
    pushPresetRef(items, existing, choice.presetName, `${keyPrefix}-agent-${role}`, `${sourceLabel}${roleLabel}渠道`, `${keyPrefix}_agent:${role}`);
  }
}

function collectFromSimulationSettings_ACU(
  items: DanglingReferenceItem_ACU[],
  existing: Set<string>,
  settings: { fixedApiPresetName?: string; agentApiPresets?: Record<string, { presetName?: string }> } | null,
  sourceLabel: string,
  keyPrefix: string,
): void {
  if (!settings) return;
  pushPresetRef(items, existing, settings.fixedApiPresetName, `${keyPrefix}-fixed`, `${sourceLabel}固定 API 预设`, `${keyPrefix}_fixed`);
  const presets = settings.agentApiPresets;
  if (!presets || typeof presets !== 'object') return;
  for (const [role, choice] of Object.entries(presets)) {
    if (!choice) continue;
    pushPresetRef(items, existing, choice.presetName, `${keyPrefix}-agent-${role}`, `${sourceLabel}Agent「${role}」渠道`, `${keyPrefix}_agent:${role}`);
  }
}

function peekFirstFloorField_ACU(field: string): unknown {
  try {
    const chat = getChatArray_ACU();
    const first = Array.isArray(chat) && chat[0] && typeof chat[0] === 'object' ? chat[0] as Record<string, unknown> : null;
    return first?.[field];
  } catch {
    return undefined;
  }
}

export function collectDanglingApiPresetReferences_ACU(): DanglingReferenceItem_ACU[] {
  const existing = existingPresetNames_ACU();
  const items: DanglingReferenceItem_ACU[] = [];
  pushPresetRef(items, existing, settings_ACU.tableApiPreset, 'table', '填表 API 预设', 'table');
  pushPresetRef(items, existing, settings_ACU.plotApiPreset, 'plot', '剧情推进 API 预设', 'plot');
  pushPresetRef(items, existing, settings_ACU.contentOptimizationSettings?.apiPreset, 'optimization', '正文优化 API 预设', 'optimization');
  pushPresetRef(items, existing, readKeywordApiPreset_ACU(), 'vector-keyword', '向量关键词 API 预设', 'vector_keyword');

  const tableOverrides = settings_ACU.tableApiPresetOverridesByName;
  if (tableOverrides && typeof tableOverrides === 'object') {
    for (const [sheetName, presetName] of Object.entries(tableOverrides)) {
      pushPresetRef(items, existing, presetName, `table-override-${sheetName}`, `表格「${sheetName}」API 预设`, `table_override:${sheetName}`);
    }
  }
  const plotOverrides = settings_ACU.plotTaskApiPresetOverridesById;
  if (plotOverrides && typeof plotOverrides === 'object') {
    for (const [taskId, presetName] of Object.entries(plotOverrides)) {
      pushPresetRef(items, existing, presetName, `plot-task-${taskId}`, `剧情任务「${taskId}」API 预设`, `plot_task:${taskId}`);
    }
  }

  collectFromContinuationSettings_ACU(items, existing, readContinuationGlobalSettings_ACU(), '智能续写（全局副本）', 'continuation_global');
  const continuationRaw = peekFirstFloorField_ACU(CONTINUATION_FIRST_FLOOR_FIELD_ACU);
  const continuationSettings = continuationRaw && typeof continuationRaw === 'object' && !Array.isArray(continuationRaw)
    ? (continuationRaw as { settings?: ContinuationSettings_ACU }).settings ?? null
    : null;
  collectFromContinuationSettings_ACU(items, existing, continuationSettings, '智能续写（当前聊天）', 'continuation');

  const simulationRaw = peekFirstFloorField_ACU(WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU);
  const simulationSettings = simulationRaw && typeof simulationRaw === 'object' && !Array.isArray(simulationRaw)
    ? (simulationRaw as { settings?: { fixedApiPresetName?: string; agentApiPresets?: Record<string, { presetName?: string }> } }).settings ?? null
    : null;
  collectFromSimulationSettings_ACU(items, existing, simulationSettings, '世界推演（当前聊天）', 'simulation');
  return items;
}

export async function collectDanglingWorldbookReferences_ACU(): Promise<DanglingReferenceItem_ACU[]> {
  const target = String(getCurrentWorldbookConfig_ACU()?.injectionTarget || '').trim();
  if (!target || target === 'character') return [];
  try {
    const books = await listLorebooks_ACU({ forceRefresh: true });
    if (resolveLorebookNameFromList_ACU(target, books)) return [];
    return [{
      id: 'injection-target',
      kind: 'worldbook',
      label: '填表写入目标世界书',
      name: target,
      clearKey: 'worldbook_injection',
    }];
  } catch (error) {
    logWarn_ACU('[引用审计] 读取世界书名单失败，本次不标记注入目标。', error);
    return [];
  }
}

export async function collectDanglingReferences_ACU(): Promise<DanglingReferenceItem_ACU[]> {
  const worldbook = await collectDanglingWorldbookReferences_ACU();
  return [...collectDanglingApiPresetReferences_ACU(), ...worldbook];
}

function clearContinuationField_ACU(settings: ContinuationSettings_ACU, clearKey: string): ContinuationSettings_ACU {
  if (clearKey.endsWith('_fixed') || clearKey === 'continuation_fixed' || clearKey === 'continuation_global_fixed') {
    return { ...settings, apiPresetMode: 'current', fixedApiPresetName: '' };
  }
  const agentPrefix = clearKey.includes('_agent:') ? clearKey.slice(clearKey.indexOf('_agent:') + '_agent:'.length) : '';
  if (!agentPrefix || !settings.agentApiPresets?.[agentPrefix as keyof typeof settings.agentApiPresets]) return settings;
  return {
    ...settings,
    agentApiPresets: {
      ...settings.agentApiPresets,
      [agentPrefix]: { mode: 'current', presetName: '' },
    },
  };
}

export async function clearDanglingReference_ACU(item: DanglingReferenceItem_ACU): Promise<{ ok: boolean; message?: string }> {
  const key = String(item.clearKey || '');
  if (key === 'table' || key === 'plot' || key === 'optimization' || key === 'vector_keyword') {
    const result = setFeatureApiPreset_ACU(key === 'vector_keyword' ? 'vector_keyword' : key, '');
    return { ok: result.ok, message: result.message };
  }
  if (key.startsWith('plot_task:')) {
    const taskId = key.slice('plot_task:'.length);
    const result = setFeatureApiPreset_ACU('plot_task', '', { taskId });
    return { ok: result.ok, message: result.message };
  }
  if (key.startsWith('table_override:')) {
    const sheetName = key.slice('table_override:'.length);
    if (!settings_ACU.tableApiPresetOverridesByName || typeof settings_ACU.tableApiPresetOverridesByName !== 'object') {
      return { ok: true };
    }
    const snapshot = clone(settings_ACU.tableApiPresetOverridesByName);
    delete settings_ACU.tableApiPresetOverridesByName[sheetName];
    const saveResult = saveSettings_ACU();
    if (!saveResult.saved) {
      settings_ACU.tableApiPresetOverridesByName = snapshot;
      return { ok: false, message: saveResult.warning || saveResult.error || '保存失败，已回滚。' };
    }
    return { ok: true };
  }
  if (key.startsWith('continuation')) {
    if (key.startsWith('continuation_global')) {
      const globalSettings = readContinuationGlobalSettings_ACU();
      if (globalSettings) {
        const next = clearContinuationField_ACU(globalSettings, key);
        (settings_ACU as Record<string, unknown>)[CONTINUATION_GLOBAL_SETTINGS_KEY_ACU] = next;
        const saveResult = saveSettings_ACU();
        if (!saveResult.saved) {
          (settings_ACU as Record<string, unknown>)[CONTINUATION_GLOBAL_SETTINGS_KEY_ACU] = globalSettings;
          return { ok: false, message: saveResult.warning || saveResult.error || '保存失败，已回滚。' };
        }
      }
    } else {
      mutateCurrentContinuationApiPresetSettings_ACU(settings => clearContinuationField_ACU(settings, key));
      try {
        await persistCurrentContinuationEnvelope_ACU();
      } catch (error) {
        logWarn_ACU('[引用审计] 续写信封清除已写入内存，但聊天保存失败。', error);
      }
    }
    return { ok: true };
  }
  if (key.startsWith('simulation')) {
    mutateCurrentWorldSimulationApiPresetSettings_ACU(settings => {
      if (key === 'simulation_fixed') {
        return { ...settings, apiPresetMode: 'current', fixedApiPresetName: '' };
      }
      const role = key.startsWith('simulation_agent:') ? key.slice('simulation_agent:'.length) : '';
      if (!role || !settings.agentApiPresets?.[role]) return settings;
      return {
        ...settings,
        agentApiPresets: {
          ...settings.agentApiPresets,
          [role]: { mode: 'current', presetName: '' },
        },
      };
    });
    try {
      await persistCurrentWorldSimulationEnvelope_ACU();
    } catch (error) {
      logWarn_ACU('[引用审计] 世界推演信封清除已写入内存，但聊天保存失败。', error);
    }
    return { ok: true };
  }
  if (key === 'worldbook_injection') {
    const cfg = getCurrentWorldbookConfig_ACU();
    const previous = cfg.injectionTarget;
    cfg.injectionTarget = 'character';
    const saveResult = saveSettings_ACU();
    if (!saveResult.saved) {
      cfg.injectionTarget = previous;
      return { ok: false, message: saveResult.warning || saveResult.error || '保存失败，已回滚。' };
    }
    return { ok: true };
  }
  return { ok: false, message: '未知的失效引用，无法清除。' };
}
