import { getCurrentScope, onScopeDispose, reactive, ref, watch } from 'vue';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { ZERO_LAYER_CARRIER_FIELD_ACU } from '../../service/zero-layer/model';
import { ZeroLayerStore_ACU } from '../../service/zero-layer/store';
import { subscribeZeroLayerChanges_ACU } from '../../service/zero-layer/notifications';
import { useChatChangedTick, useChatMutationTick } from './useChatChangedListener';
import {
  readAgentModuleFieldSnapshot_ACU,
  readAgentModuleSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  replaceAgentModuleSnapshotByUser_ACU,
  type AgentModuleSnapshotReadDiagnostics_ACU,
} from '../../service/continuation/agent/agent-module-store';
import { ContinuationValidationError_ACU } from '../../service/continuation/model';
import { getZeroLayerContinuationAgentStorage_ACU, readZeroLayerPublishedContinuationFold_ACU } from '../../service/zero-layer/continuation-agent-storage';
import { readMessageSwipeId_ACU } from '../../service/continuation/agent/agent-module-frame';
import type { AgentModuleFieldSnapshot_ACU, AgentModuleSnapshot_ACU } from '../../service/continuation/agent/agent-model';
import { useToastStore } from '../stores/toast-store';

/** 用户可分模块编辑的资料。schemaVersion / settledThroughIndex 等运行时字段不进草稿。 */
export const CONTINUATION_MATERIAL_MODULES_ACU = ['hooks', 'infoGap', 'constraints', 'storyArc', 'chronology', 'webRefs', 'userRequirements'] as const;
export type ContinuationMaterialModule_ACU = typeof CONTINUATION_MATERIAL_MODULES_ACU[number];

export const CONTINUATION_MATERIAL_MODULE_LABELS_ACU: Record<ContinuationMaterialModule_ACU, string> = {
  hooks: '伏笔账本',
  infoGap: '认知与信息差',
  constraints: '长期约束',
  storyArc: '故事总纲',
  chronology: '故事年代学账本',
  webRefs: '百科资料库',
  userRequirements: '用户要求',
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
 * 读取按模式选择物理存储或 carrier Adapter；保存共用领域层的
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
  const diagnostics = ref<AgentModuleSnapshotReadDiagnostics_ACU>({
    candidates: [],
    adoptedIndex: null,
    salvaged: false,
    checkpointIndex: null,
    foldedDeltaCount: 0,
  });
  /** 分栏视图：partial 记录只出现在这里，面板据此按模块/ID 展示已写字段与缺栏。 */
  const fieldSnapshot = ref<AgentModuleFieldSnapshot_ACU>({ records: {} });
  const modules = reactive<Record<ContinuationMaterialModule_ACU, ModuleDraftState_ACU>>({
    hooks: emptyModuleState_ACU(),
    infoGap: emptyModuleState_ACU(),
    constraints: emptyModuleState_ACU(),
    storyArc: emptyModuleState_ACU(),
    chronology: emptyModuleState_ACU(),
    webRefs: emptyModuleState_ACU(),
    userRequirements: emptyModuleState_ACU(),
  });

  const chatChangedTick = useChatChangedTick();
  const mutationTick = useChatMutationTick();
  type DraftSource = { chat: unknown[]; key: string; floors: Array<{ message: unknown; swipeId: string }> };
  let draftSource: DraftSource | null = null;
  function readSource(): DraftSource {
    const chat = getChatArray_ACU();
    const source = chat.some(message => message
      && Object.prototype.hasOwnProperty.call(message, ZERO_LAYER_CARRIER_FIELD_ACU))
      ? new ZeroLayerStore_ACU().readSnapshot() : null;
    return { chat, key: JSON.stringify([getActiveChatStorageIdentity_ACU(chat), chatChangedTick.value, mutationTick.value,
      source?.enabled ? [source.scope.characterKey, source.sessionId, source.activeBranchId, source.carrierSwipeId] : null]),
      floors: chat.map(message => ({ message, swipeId: readMessageSwipeId_ACU(message) })),
    };
  }
  // 普通追加正文仍属同一资料作用域；删除、替换或 swipe 立即失效，不等待通知防抖。
  function extendsSource(current: DraftSource, before: DraftSource): boolean {
    return current.chat === before.chat && current.key === before.key
      && current.floors.length >= before.floors.length
      && before.floors.every((floor, index) => current.floors[index].message === floor.message
        && current.floors[index].swipeId === floor.swipeId);
  }
  function matchesSource(source: DraftSource): boolean {
    return !!draftSource && extendsSource(source, draftSource);
  }
  function isSourceCurrent(source: DraftSource): boolean {
    try {
      const current = readSource();
      return extendsSource(current, source) && matchesSource(source);
    } catch { return false; }
  }
  if (getCurrentScope()) {
    watch([chatChangedTick, mutationTick], () => reload({ preserveDirty: true }));
    const unsubscribe = subscribeZeroLayerChanges_ACU(change => {
      if (change.scope.chatId === getActiveChatStorageIdentity_ACU(getChatArray_ACU())) {
        reload({ preserveDirty: true });
      }
    });
    onScopeDispose(unsubscribe);
  }

  function resetModule(module: ContinuationMaterialModule_ACU, current: AgentModuleSnapshot_ACU): void {
    modules[module] = { draft: moduleDraftText_ACU(current, module), dirty: false, error: '', saving: false };
  }

  /**
   * 重读楼层锚定的资料快照。
   * @param options.preserveDirty 为 true 时跳过用户正在编辑（dirty）的模块草稿——Agent 运行中每写一次
   *   快照都会触发自动刷新，不能把用户没保存的 JSON 冲掉；手动点「刷新」则全量重置。
   */
  function reload(options: { preserveDirty?: boolean } = {}): void {
    try {
      const source = readSource();
      const preserveDirty = options.preserveDirty && matchesSource(source);
      const folded = readZeroLayerPublishedContinuationFold_ACU();
      const current = folded?.snapshot ?? readAgentModuleSnapshot_ACU();
      snapshot.value = current;
      diagnostics.value = folded ? {
        candidates: folded.candidates, adoptedIndex: folded.adoptedIndex,
        salvaged: folded.salvaged, checkpointIndex: folded.checkpointIndex,
        foldedDeltaCount: folded.foldedDeltaCount,
      } : readAgentModuleSnapshotDiagnostics_ACU();
      // 与领域快照同一次折叠派生：partial 来自逐栏 delta，complete/legacy_unknown 来自领域数组。
      fieldSnapshot.value = folded?.fields ?? readAgentModuleFieldSnapshot_ACU();
      for (const module of CONTINUATION_MATERIAL_MODULES_ACU) {
        if (preserveDirty && modules[module].dirty) continue;
        resetModule(module, current);
      }
      draftSource = source;
      loadError.value = '';
    } catch (caught) {
      snapshot.value = null;
      draftSource = null;
      fieldSnapshot.value = { records: {} };
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
    let source: DraftSource;
    try {
      source = readSource();
      if (!matchesSource(source)) throw new Error('资料草稿所属聊天、模式或 swipe 已变化，请刷新后重新编辑。');
    } catch (caught) {
      modules[module].error = errorMessage_ACU(caught);
      return false;
    }
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
      const adapter = getZeroLayerContinuationAgentStorage_ACU();
      const saved = await replaceAgentModuleSnapshotByUser_ACU({ [module]: parsed },
        adapter?.readChat(), adapter ?? undefined);
      if (!isSourceCurrent(source) || modules[module] !== state) return false;
      snapshot.value = saved;
      resetModule(module, saved);
      toast.success(`${CONTINUATION_MATERIAL_MODULE_LABELS_ACU[module]}已保存，修订号已推进。`);
      return true;
    } catch (caught) {
      if (isSourceCurrent(source) && modules[module] === state) state.error = errorMessage_ACU(caught);
      return false;
    } finally {
      state.saving = false;
    }
  }

  return { snapshot, loadError, diagnostics, fieldSnapshot, modules, reload, save, discard, updateDraft };
}
