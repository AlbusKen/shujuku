import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  evaluatePromptPreviewGate_ACU,
  type PromptPreviewGateResult_ACU,
} from '../../service/preview/prompt-preview-gate';
import {
  previewTableFillPrompt_ACU,
  type TableFillPromptPreview_ACU,
  type TableFillPreviewScenario_ACU,
} from '../../service/preview/table-fill-prompt-preview';
import {
  previewPlotPrompts_ACU,
  type PlotPromptPreview_ACU,
} from '../../service/preview/plot-prompt-preview';

/** 提示词查看器抽屉的展示模式 */
export type PromptPreviewMode = 'table-fill' | 'plot';

/** 结构化预览错误（供抽屉展示 message + 可选 detail） */
export interface PromptPreviewErrorView {
  message: string;
  detail?: string;
}

/** usePromptPreview 对外暴露的完整状态与方法 */
export interface PromptPreviewState {
  /** 抽屉是否打开 */
  drawerOpen: Ref<boolean>;
  /** 当前模式：填表 / 剧情 */
  mode: Ref<PromptPreviewMode>;
  /** 是否正在生成预览 */
  loading: Ref<boolean>;
  /** 最近一次生成的结构化错误（成功后清空） */
  error: Ref<PromptPreviewErrorView | null>;
  /** 门控评估结果；null = 尚未评估或评估失败（fail-closed） */
  gate: Ref<PromptPreviewGateResult_ACU | null>;
  /** 门控评估抛错时的兜底文案 */
  gateError: Ref<string>;
  /** 当前填表管线（抽屉顶部 tab） */
  scenario: Ref<TableFillPreviewScenario_ACU>;
  /** 填表提示词预览数据 */
  tableFillPreview: Ref<TableFillPromptPreview_ACU | null>;
  /** 剧情提示词预览数据 */
  plotPreview: Ref<PlotPromptPreview_ACU | null>;
  /** 剧情模式：模拟用户输入草稿（跨开关保留） */
  plotVirtualInput: Ref<string>;
  /** 填表入口是否可用 */
  tableFillAvailable: ComputedRef<boolean>;
  /** 填表入口禁用时的悬浮提示 */
  tableFillBlockerText: ComputedRef<string>;
  /** 剧情入口是否可用 */
  plotAvailable: ComputedRef<boolean>;
  /** 剧情入口禁用时的悬浮提示 */
  plotBlockerText: ComputedRef<string>;
  /** 重新评估门控（页面 onMounted / 抽屉打开时调用） */
  refreshGate(): void;
  /** 打开填表预览抽屉并立即生成（scenario 默认 'auto'） */
  openTableFillPreview(
    scenario?: TableFillPreviewScenario_ACU,
    targetSheetKeys?: string[] | null,
  ): void;
  /** 切换填表管线并重新生成（抽屉内 tab；仅在填表模式打开时生效） */
  selectScenario(scenario: TableFillPreviewScenario_ACU): void;
  /** 打开剧情预览抽屉（不自动生成，等待"生成预览"按钮） */
  openPlotPreview(): void;
  /** 以当前 plotVirtualInput 生成剧情预览 */
  generatePlotPreview(): Promise<void>;
  /** 更新模拟用户输入草稿 */
  setPlotVirtualInput(value: string): void;
  /** 关闭抽屉（保留已生成数据与草稿） */
  closeDrawer(): void;
}

function normalizeError(err: unknown): PromptPreviewErrorView {
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: unknown; detail?: unknown };
    const message =
      typeof e.message === 'string' && e.message ? e.message : safeStringify(err);
    if (typeof e.detail === 'string' && e.detail) return { message, detail: e.detail };
    return { message };
  }
  if (typeof err === 'string' && err) return { message: err };
  return { message: String(err) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 提示词查看器：门控 + 只读预览抽屉的状态与动作（与 service 契约一一对应） */
export function usePromptPreview(): PromptPreviewState {
  const drawerOpen = ref(false);
  const mode = ref<PromptPreviewMode>('table-fill');
  const loading = ref(false);
  const error = ref<PromptPreviewErrorView | null>(null);
  const gate = ref<PromptPreviewGateResult_ACU | null>(null);
  const gateError = ref('');
  const scenario = ref<TableFillPreviewScenario_ACU>('auto');
  const tableFillPreview = ref<TableFillPromptPreview_ACU | null>(null);
  const plotPreview = ref<PlotPromptPreview_ACU | null>(null);
  const plotVirtualInput = ref('');

  // 过期响应丢弃：只认最新一次发起的请求
  let requestSeq = 0;
  // 最近一次填表预览使用的 targetSheetKeys，切换管线重新生成时沿用
  let lastTargetSheetKeys: string[] | null | undefined;

  const tableFillAvailable = computed(() => gate.value?.tableFill.available === true);
  const plotAvailable = computed(() => gate.value?.plot.available === true);

  const tableFillBlockerText = computed(() => {
    if (gateError.value) return `门控评估失败：${gateError.value}`;
    const blockers = gate.value?.tableFill.blockers ?? [];
    if (blockers.length) return blockers.map(b => b.reason).join('；');
    return '当前配置下不可用';
  });

  const plotBlockerText = computed(() => {
    if (gateError.value) return `门控评估失败：${gateError.value}`;
    const blockers = gate.value?.plot.blockers ?? [];
    if (blockers.length) return blockers.map(b => b.reason).join('；');
    return '当前配置下不可用';
  });

  function refreshGate(): void {
    try {
      gate.value = evaluatePromptPreviewGate_ACU();
      gateError.value = '';
    } catch (err) {
      // 门控本身失败时按不可用处理（fail-closed），并保留原因文案
      gate.value = null;
      gateError.value = normalizeError(err).message;
    }
  }

  async function generateTableFill(
    nextScenario: TableFillPreviewScenario_ACU,
    targetSheetKeys: string[] | null | undefined,
  ): Promise<void> {
    const seq = ++requestSeq;
    loading.value = true;
    error.value = null;
    try {
      const options =
        targetSheetKeys === undefined
          ? { scenario: nextScenario }
          : { scenario: nextScenario, targetSheetKeys };
      const preview = await previewTableFillPrompt_ACU(options);
      if (seq !== requestSeq) return;
      tableFillPreview.value = preview;
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = normalizeError(err);
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  function openTableFillPreview(
    nextScenario: TableFillPreviewScenario_ACU = 'auto',
    targetSheetKeys?: string[] | null,
  ): void {
    mode.value = 'table-fill';
    scenario.value = nextScenario;
    lastTargetSheetKeys = targetSheetKeys;
    drawerOpen.value = true;
    refreshGate();
    void generateTableFill(nextScenario, targetSheetKeys);
  }

  function selectScenario(nextScenario: TableFillPreviewScenario_ACU): void {
    if (scenario.value === nextScenario) return;
    scenario.value = nextScenario;
    if (mode.value === 'table-fill' && drawerOpen.value) {
      void generateTableFill(nextScenario, lastTargetSheetKeys);
    }
  }

  function openPlotPreview(): void {
    mode.value = 'plot';
    drawerOpen.value = true;
    refreshGate();
    // 打开不自动生成：剧情预览由"生成预览"按钮驱动；模拟输入草稿保留
    plotPreview.value = null;
    error.value = null;
  }

  async function generatePlotPreview(): Promise<void> {
    const seq = ++requestSeq;
    loading.value = true;
    error.value = null;
    try {
      const preview = await previewPlotPrompts_ACU(plotVirtualInput.value);
      if (seq !== requestSeq) return;
      plotPreview.value = preview;
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = normalizeError(err);
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  function setPlotVirtualInput(value: string): void {
    plotVirtualInput.value = value;
  }

  function closeDrawer(): void {
    drawerOpen.value = false;
  }

  return {
    drawerOpen,
    mode,
    loading,
    error,
    gate,
    gateError,
    scenario,
    tableFillPreview,
    plotPreview,
    plotVirtualInput,
    tableFillAvailable,
    tableFillBlockerText,
    plotAvailable,
    plotBlockerText,
    refreshGate,
    openTableFillPreview,
    selectScenario,
    openPlotPreview,
    generatePlotPreview,
    setPlotVirtualInput,
    closeDrawer,
  };
}
