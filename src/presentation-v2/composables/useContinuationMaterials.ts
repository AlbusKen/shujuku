import { reactive, ref } from 'vue';
import {
  readAgentModuleSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  replaceAgentModuleSnapshotByUser_ACU,
  type AgentModuleSnapshotReadDiagnostics_ACU,
} from '../../service/continuation/agent/agent-module-store';
import { ContinuationValidationError_ACU } from '../../service/continuation/model';
import type { AgentModuleSnapshot_ACU } from '../../service/continuation/agent/agent-model';
import { useToastStore } from '../stores/toast-store';

/** 用户可分模块编辑的六项资料。schemaVersion / settledThroughIndex 等运行时字段不进草稿。 */
export const CONTINUATION_MATERIAL_MODULES_ACU = ['hooks', 'infoGap', 'constraints', 'storyArc', 'chronology', 'webRefs'] as const;
export type ContinuationMaterialModule_ACU = typeof CONTINUATION_MATERIAL_MODULES_ACU[number];

export const CONTINUATION_MATERIAL_MODULE_LABELS_ACU: Record<ContinuationMaterialModule_ACU, string> = {
  hooks: '伏笔账本',
  infoGap: '认知与信息差',
  constraints: '长期约束',
  storyArc: '故事总纲',
  chronology: '故事年代学账本',
  webRefs: '百科资料库',
};

interface ModuleDraftState_ACU {
  draft: string;
  dirty: boolean;
  error: string;
  saving: boolean;
}

function errorMessage_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return error.error.message;
  return error instanceof Error ? error.message : '资料操作失败';
}

function moduleDraftText_ACU(snapshot: AgentModuleSnapshot_ACU, module: ContinuationMaterialModule_ACU): string {
  return JSON.stringify(snapshot[module], null, 2);
}

function emptyModuleState_ACU(): ModuleDraftState_ACU {
  return { draft: '', dirty: false, error: '', saving: false };
}

/**
 * 本地资料快照的阅览与分模块编辑。
 *
 * 读取直接走楼层锚定存储（资料不在首楼信封里，与任务生命周期无关）；保存走领域层的
 * 用户写入路径，由它执行结构校验并推进修订号，页面不自行拼装快照对象。
 *
 * 四个模块（伏笔/信息差/长期约束/故事总纲）各自独立草稿与保存：save(module) 只把该模块
 * 数据提交给 replaceAgentModuleSnapshotByUser_ACU，其 merge 语义保留其余模块的磁盘值；
 * 一个模块保存成功只重置该模块的草稿，其他模块未保存的编辑不受影响（dirty 按模块隔离）。
 */
export function useContinuationMaterials() {
  const toast = useToastStore();
  const snapshot = ref<AgentModuleSnapshot_ACU | null>(null);
  const loadError = ref('');
  /** 最近一次读取的来源诊断：采用了哪一楼、是否宽容抢救、有哪些损坏楼层。 */
  const diagnostics = ref<AgentModuleSnapshotReadDiagnostics_ACU>({ candidates: [], adoptedIndex: null, salvaged: false });
  const modules = reactive<Record<ContinuationMaterialModule_ACU, ModuleDraftState_ACU>>({
    hooks: emptyModuleState_ACU(),
    infoGap: emptyModuleState_ACU(),
    constraints: emptyModuleState_ACU(),
    storyArc: emptyModuleState_ACU(),
    chronology: emptyModuleState_ACU(),
    webRefs: emptyModuleState_ACU(),
  });

  function resetModule(module: ContinuationMaterialModule_ACU, current: AgentModuleSnapshot_ACU): void {
    modules[module] = { draft: moduleDraftText_ACU(current, module), dirty: false, error: '', saving: false };
  }

  function reload(): void {
    try {
      const current = readAgentModuleSnapshot_ACU();
      snapshot.value = current;
      diagnostics.value = readAgentModuleSnapshotDiagnostics_ACU();
      for (const module of CONTINUATION_MATERIAL_MODULES_ACU) resetModule(module, current);
      loadError.value = '';
    } catch (caught) {
      snapshot.value = null;
      for (const module of CONTINUATION_MATERIAL_MODULES_ACU) modules[module] = emptyModuleState_ACU();
      loadError.value = errorMessage_ACU(caught);
    }
  }

  function updateDraft(module: ContinuationMaterialModule_ACU, value: string): void {
    modules[module].draft = value;
    modules[module].dirty = true;
  }

  function discard(module: ContinuationMaterialModule_ACU): void {
    if (snapshot.value) resetModule(module, snapshot.value);
    else modules[module] = emptyModuleState_ACU();
  }

  async function save(module: ContinuationMaterialModule_ACU): Promise<boolean> {
    const state = modules[module];
    if (state.saving) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.draft);
    } catch (caught) {
      state.error = caught instanceof Error ? `资料 JSON 无法解析：${caught.message}` : '资料 JSON 无法解析';
      return false;
    }
    if (!Array.isArray(parsed)) {
      state.error = `${CONTINUATION_MATERIAL_MODULE_LABELS_ACU[module]} 必须是 JSON 数组`;
      return false;
    }
    state.saving = true;
    try {
      // 只提交本模块：写入侧按 merge 语义保留其余模块的磁盘值，不会覆盖别的模块。
      const saved = await replaceAgentModuleSnapshotByUser_ACU({ [module]: parsed });
      snapshot.value = saved;
      resetModule(module, saved);
      toast.success(`${CONTINUATION_MATERIAL_MODULE_LABELS_ACU[module]}已保存，修订号已推进。`);
      return true;
    } catch (caught) {
      state.error = errorMessage_ACU(caught);
      return false;
    } finally {
      state.saving = false;
    }
  }

  return { snapshot, loadError, diagnostics, modules, reload, save, discard, updateDraft };
}
