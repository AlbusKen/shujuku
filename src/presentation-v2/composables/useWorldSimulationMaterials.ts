import { reactive, ref } from 'vue';
import {
  createWorldSimulationUserEditAdapter_ACU,
  type WorldSimulationUserEditBaseline_ACU,
  type WorldSimulationUserEditRead_ACU,
  type WorldSimulationUserRequirementsBaseline_ACU,
} from '../../service/simulation/world-simulation-user-edit';
import { WorldSimulationValidationError_ACU, type WorldSimulationModule_ACU, type WorldStateSnapshot_ACU } from '../../service/simulation/model';
import { useToastStore } from '../stores/toast-store';

export const WORLD_SIMULATION_MATERIAL_MODULES_ACU = ['entities', 'events', 'threads'] as const;
export type WorldSimulationMaterialModule_ACU = typeof WORLD_SIMULATION_MATERIAL_MODULES_ACU[number];
export const WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU: Record<WorldSimulationMaterialModule_ACU, string> = { entities: '实体', events: '事件', threads: '线索' };

type DraftState_ACU = { draft: string; dirty: boolean; saving: boolean; error: string };
export interface WorldSimulationMaterialsAdapterPort_ACU {
  read(): WorldSimulationUserEditRead_ACU;
  saveModule(baseline: WorldSimulationUserEditBaseline_ACU, module: WorldSimulationModule_ACU, raw: unknown): Promise<WorldSimulationUserEditBaseline_ACU>;
  saveRequirements(baseline: WorldSimulationUserRequirementsBaseline_ACU, raw: unknown): Promise<WorldSimulationUserRequirementsBaseline_ACU>;
}
function emptyDraft(): DraftState_ACU { return { draft: '', dirty: false, saving: false, error: '' }; }
function message(error: unknown): string { return error instanceof WorldSimulationValidationError_ACU ? error.error.message : error instanceof Error ? error.message : '资料操作失败'; }
function json(value: unknown): string { return JSON.stringify(value, null, 2); }

/** 只管理瞬时草稿；所有世界账本/投影写入必须经 user-edit adapter。 */
export function useWorldSimulationMaterials(adapter: WorldSimulationMaterialsAdapterPort_ACU = createWorldSimulationUserEditAdapter_ACU()) {
  const toast = useToastStore();
  const snapshot = ref<WorldStateSnapshot_ACU | null>(null);
  const baseline = ref<WorldSimulationUserEditBaseline_ACU | null>(null);
  const requirementsBaseline = ref<WorldSimulationUserRequirementsBaseline_ACU | null>(null);
  const diagnostics = ref<Extract<WorldSimulationUserEditRead_ACU, { kind: 'ready' }>['diagnostics'] | null>(null);
  const loadError = ref('');
  const modules = reactive<Record<WorldSimulationMaterialModule_ACU, DraftState_ACU>>({ entities: emptyDraft(), events: emptyDraft(), threads: emptyDraft() });
  const requirements = reactive<DraftState_ACU>(emptyDraft());
  function resetModule(module: WorldSimulationMaterialModule_ACU, state: WorldStateSnapshot_ACU | null): void { modules[module] = { ...emptyDraft(), draft: json(state?.[module] ?? []) }; }
  function resetRequirements(current: WorldSimulationUserRequirementsBaseline_ACU | null): void { Object.assign(requirements, emptyDraft(), { draft: json(current?.requirements ?? []) }); }
  function reload(options: { preserveDirty?: boolean } = {}): void {
    try {
      const current = adapter.read();
      requirementsBaseline.value = current.requirements;
      if (!options.preserveDirty || !requirements.dirty) resetRequirements(current.requirements);
      if (current.kind === 'ready') { snapshot.value = current.baseline.state; baseline.value = current.baseline; diagnostics.value = current.diagnostics; }
      else { snapshot.value = null; baseline.value = null; diagnostics.value = null; }
      for (const module of WORLD_SIMULATION_MATERIAL_MODULES_ACU)if (!options.preserveDirty || !modules[module].dirty) resetModule(module, snapshot.value);
      loadError.value = '';
    } catch (error) { snapshot.value = null; baseline.value = null; diagnostics.value = null; loadError.value = message(error); }
  }
  function updateDraft(module: WorldSimulationMaterialModule_ACU, value: string): void { modules[module].draft = value; modules[module].dirty = true; modules[module].error = ''; }
  function updateRequirementsDraft(value: string): void { requirements.draft = value; requirements.dirty = true; requirements.error = ''; }
  function discard(module: WorldSimulationMaterialModule_ACU): void { resetModule(module, snapshot.value); }
  function discardRequirements(): void { resetRequirements(requirementsBaseline.value); }
  async function save(module: WorldSimulationMaterialModule_ACU): Promise<boolean> {
    const draft = modules[module]; if (draft.saving || !baseline.value) { if (!baseline.value) draft.error = '当前 active swipe 没有可编辑的世界账本。'; return false; }
    let raw: unknown; try { raw = JSON.parse(draft.draft); } catch (error) { draft.error = error instanceof Error ? `资料 JSON 无法解析：${error.message}` : '资料 JSON 无法解析'; return false; }
    if (!Array.isArray(raw)) { draft.error = `${WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU[module]}必须是 JSON 数组`; return false; }
    draft.saving = true; try { const saved = await adapter.saveModule(baseline.value, module, raw); snapshot.value = saved.state; baseline.value = saved; resetModule(module, saved.state); toast.success(`${WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU[module]}已保存。`); return true; } catch (error) { draft.error = message(error); return false; } finally { draft.saving = false; }
  }
  async function saveRequirements(): Promise<boolean> {
    if (requirements.saving || !requirementsBaseline.value) { if (!requirementsBaseline.value) requirements.error = '当前 active swipe 没有可保存的要求资料。'; return false; }
    let raw: unknown; try { raw = JSON.parse(requirements.draft); } catch (error) { requirements.error = error instanceof Error ? `要求 JSON 无法解析：${error.message}` : '要求 JSON 无法解析'; return false; }
    if (!Array.isArray(raw)) { requirements.error = '要求必须是 JSON 数组'; return false; }
    requirements.saving = true; try { requirementsBaseline.value = await adapter.saveRequirements(requirementsBaseline.value, raw); resetRequirements(requirementsBaseline.value); toast.success('当前要求已保存。'); return true; } catch (error) { requirements.error = message(error); return false; } finally { requirements.saving = false; }
  }
  return { snapshot, baseline, requirementsBaseline, diagnostics, loadError, modules, requirements, reload, updateDraft, updateRequirementsDraft, discard, discardRequirements, save, saveRequirements };
}
