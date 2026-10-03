import { computed, ref, type ComputedRef, type Ref } from "vue";
import { settings_ACU } from "../../service/runtime/state-manager";
import { saveSettings_ACU } from "../../service/settings/settings-service";
import { setFeatureApiPreset_ACU } from "../../service/settings/feature-preset-reference-service";
import { setUpdateNumberFields_ACU, setTableContextRules_ACU, setCharCardPrompt_ACU } from "../../service/settings/settings-write-service";
import { getCurrentStorageMode } from "../../service/table/storage-mode";
import { buildTableFillDefaultPromptSegments_ACU } from "../../service/ai/prompt-builder/table-fill-tools";
import {
  DEFAULT_AUTO_UPDATE_FREQUENCY_ACU,
  DEFAULT_AUTO_UPDATE_THRESHOLD_ACU,
  DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU,
} from "../../shared/defaults";
import {
  DEFAULT_CHAR_CARD_PROMPT_ACU,
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
} from "../../shared/defaults-json.js";
import {
  normalizeExcludeRules_ACU,
  normalizeExtractRules_ACU,
  normalizeNonNegativeInteger_ACU,
  normalizePositiveInteger_ACU,
} from "../../shared/utils";
import { useToastStore } from "../stores/toast-store";

type MessageKind = "info" | "success" | "warning" | "error";

export interface FormFillPromptSegment {
  role: string;
  content: string;
  deletable?: boolean;
  mainSlot?: "A" | "B" | "";
  isMain?: boolean;
  isMain2?: boolean;
}

export interface FormFillRulePair {
  start: string;
  end: string;
}

export interface FormFillNumberField {
  key: NumberSettingKey;
  label: string;
  value: number;
  min: number;
  step: number;
  hint: string;
}

export interface FormFillMessage {
  kind: MessageKind;
  text: string;
  scope: "settings" | "prompt";
}

export type NumberSettingKey =
  | "autoUpdateThreshold"
  | "autoUpdateFrequency"
  | "updateBatchSize"
  | "maxConcurrentGroups"
  | "skipUpdateFloors"
  | "retainRecentLayers"
  | "autoUpdateTokenThreshold"
  | "tableMaxRetries";

export interface FormFillSettingsState {
  numberFields: ComputedRef<FormFillNumberField[]>;
  tableApiPreset: Ref<string>;
  tableEditLastPairOnly: Ref<boolean>;
  strictJsonTableFillEnabled: Ref<boolean>;
  tableFillNativeToolEnabled: Ref<boolean>;
  discardUnauthorizedTableEditsEnabled: Ref<boolean>;
  extractRules: Ref<FormFillRulePair[]>;
  excludeRules: Ref<FormFillRulePair[]>;
  promptSegments: Ref<FormFillPromptSegment[]>;
  promptTemplateMode: ComputedRef<"default" | "custom">;
  message: Ref<FormFillMessage | null>;
  promptDirty: Ref<boolean>;
  refresh: () => void;
  setTableApiPreset: (value: string) => void;
  setNumber: (key: NumberSettingKey, value: number | string) => void;
  setNumbers: (
    patch: Partial<Record<NumberSettingKey, number | string>>,
  ) => void;
  setTableEditLastPairOnly: (value: boolean) => void;
  setStrictJsonTableFillEnabled: (value: boolean) => void;
  setTableFillNativeToolEnabled: (value: boolean) => void;
  setDiscardUnauthorizedTableEditsEnabled: (value: boolean) => void;
  setExtractRules: (rules: FormFillRulePair[]) => void;
  setExcludeRules: (rules: FormFillRulePair[]) => void;
  addPromptSegment: (position: "top" | "bottom") => void;
  deletePromptSegment: (index: number) => void;
  updatePromptSegment: (
    index: number,
    patch: Partial<FormFillPromptSegment>,
  ) => void;
  savePrompt: () => void;
  resetPrompt: () => void;
  importPromptFile: (file: File) => Promise<void>;
  exportPrompt: () => void;
}

const NUMBER_FIELD_META: Array<Omit<FormFillNumberField, "value">> = [
  {
    key: "autoUpdateThreshold",
    label: "填表上下文层数",
    min: 0,
    step: 1,
    hint: "自动填表触发时最多处理最近 N 层 AI 回复。",
  },
  {
    key: "autoUpdateFrequency",
    label: "自动填表频率",
    min: 1,
    step: 1,
    hint: "每N层AI回复更新一次。",
  },
  {
    key: "updateBatchSize",
    label: "批处理层数",
    min: 1,
    step: 1,
    hint: "每次填表合并处理 N 层 AI 回复。",
  },
  {
    key: "maxConcurrentGroups",
    label: "最大并发数",
    min: 1,
    step: 1,
    hint: "同时处理的表格组数，默认为1。",
  },
  {
    key: "skipUpdateFloors",
    label: "跳过最新回复数",
    min: 0,
    step: 1,
    hint: "忽略最新N层回复，避免未稳定内容写入。",
  },
  {
    key: "retainRecentLayers",
    label: "保留数据层数",
    min: 0,
    step: 1,
    hint: "清理超出保留范围的数据，影响文件大小和楼层回溯，不影响聊天记录与数据呈现。",
  },
  {
    key: "autoUpdateTokenThreshold",
    label: "AI 回复最小长度",
    min: 0,
    step: 1,
    hint: "低于此值跳过自动填表。",
  },
  {
    key: "tableMaxRetries",
    label: "填表最大重试",
    min: 1,
    step: 1,
    hint: "失败时重试次数上限。",
  },
];

const FALLBACKS: Record<NumberSettingKey, number> = {
  autoUpdateThreshold: DEFAULT_AUTO_UPDATE_THRESHOLD_ACU,
  autoUpdateFrequency: DEFAULT_AUTO_UPDATE_FREQUENCY_ACU,
  updateBatchSize: 3,
  maxConcurrentGroups: 1,
  skipUpdateFloors: 0,
  retainRecentLayers: 100,
  autoUpdateTokenThreshold: DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU,
  tableMaxRetries: 3,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeNumber(key: NumberSettingKey, value: unknown): number {
  const meta = NUMBER_FIELD_META.find((item) => item.key === key);
  const fallback = FALLBACKS[key];
  const normalized =
    (meta?.min ?? 0) > 0
      ? normalizePositiveInteger_ACU(value, fallback)
      : normalizeNonNegativeInteger_ACU(value, fallback);
  return Math.max(meta?.min ?? 0, normalized);
}

function normalizeRules(
  rules: unknown,
  legacy = "",
  kind: "extract" | "exclude",
): FormFillRulePair[] {
  const normalized =
    kind === "extract"
      ? normalizeExtractRules_ACU(rules, legacy)
      : normalizeExcludeRules_ACU(rules, legacy);
  return normalized.map((rule: any) => ({
    start: String(rule.start || ""),
    end: String(rule.end || ""),
  }));
}

function coerceRulePairs(rules: unknown): FormFillRulePair[] {
  return Array.isArray(rules)
    ? rules.map((rule: any) => ({
        start: String(rule?.start ?? ""),
        end: String(rule?.end ?? ""),
      }))
    : [];
}

function normalizeRole(raw: unknown): string {
  const role = String(raw || "USER").trim();
  if (role === "assistant") return "assistant";
  if (role.toUpperCase() === "SYSTEM") return "SYSTEM";
  if (role.toUpperCase() === "USER") return "USER";
  if (role.toUpperCase() === "ASSISTANT") return "assistant";
  return role || "USER";
}

function normalizePromptSegment(raw: any): FormFillPromptSegment {
  const slot =
    raw?.mainSlot === "A" || raw?.isMain === true
      ? "A"
      : raw?.mainSlot === "B" || raw?.isMain2 === true
        ? "B"
        : "";
  return {
    role: normalizeRole(raw?.role),
    content: String(raw?.content ?? ""),
    deletable: slot ? false : raw?.deletable !== false,
    mainSlot: slot,
    isMain: slot === "A",
    isMain2: slot === "B",
  };
}

function normalizePromptSegments(input: unknown): FormFillPromptSegment[] {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string" && input.trim()
      ? [{ role: "USER", content: input }]
      : DEFAULT_CHAR_CARD_PROMPT_ACU;
  const segments = source.map(normalizePromptSegment);
  return ensureUniqueSlots(segments);
}

function ensureUniqueSlots(
  segments: FormFillPromptSegment[],
): FormFillPromptSegment[] {
  const next = segments.map((seg) => ({ ...seg }));
  for (const slot of ["A", "B"] as const) {
    let first = -1;
    for (let i = 0; i < next.length; i += 1) {
      if (next[i].mainSlot !== slot) continue;
      if (first === -1) {
        first = i;
        next[i].deletable = false;
        next[i].isMain = slot === "A";
        next[i].isMain2 = slot === "B";
      } else {
        next[i].mainSlot = "";
        next[i].isMain = false;
        next[i].isMain2 = false;
        next[i].deletable = next[i].deletable !== false;
      }
    }
  }
  return next;
}

function preparePromptForSave(
  segments: FormFillPromptSegment[],
): FormFillPromptSegment[] {
  return ensureUniqueSlots(segments).map((seg) => ({
    role: normalizeRole(seg.role),
    content: String(seg.content || ""),
    deletable: seg.mainSlot ? false : seg.deletable !== false,
    mainSlot: seg.mainSlot || "",
    isMain: seg.mainSlot === "A",
    isMain2: seg.mainSlot === "B",
  }));
}

function currentDefaultPromptSegments(): FormFillPromptSegment[] {
  if (settings_ACU.strictJsonTableFillEnabled === true) {
    const defaults =
      getCurrentStorageMode() === "sqlite"
        ? DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU
        : DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU;
    return normalizePromptSegments(defaults);
  }
  // 正文/工具两套默认主段按填表工具开关对齐，否则关着工具时编辑器会显示要求调用工具的默认提示词。
  return normalizePromptSegments(buildTableFillDefaultPromptSegments_ACU(
    getCurrentStorageMode() === "sqlite",
    settings_ACU.tableFillNativeToolEnabled === true,
  ));
}

function currentPromptSettingKey(): "charCardPrompt" | "strictJsonCharCardPrompt" | "strictJsonSqlCharCardPrompt" {
  if (settings_ACU.strictJsonTableFillEnabled === true) {
    return getCurrentStorageMode() === "sqlite"
      ? "strictJsonSqlCharCardPrompt"
      : "strictJsonCharCardPrompt";
  }
  return "charCardPrompt";
}

function currentPromptSource(): unknown {
  const key = currentPromptSettingKey();
  const value = settings_ACU[key];
  return Array.isArray(value) && value.length > 0 ? value : currentDefaultPromptSegments();
}

function promptFingerprint(segments: FormFillPromptSegment[]): string {
  return JSON.stringify(preparePromptForSave(segments));
}

export function useFormFillSettings(): FormFillSettingsState {
  const toast = useToastStore();
  const values = ref<Record<NumberSettingKey, number>>({ ...FALLBACKS });
  const tableApiPreset = ref(String(settings_ACU.tableApiPreset || ""));
  const tableEditLastPairOnly = ref(
    settings_ACU.tableEditLastPairOnly !== false,
  );
  const strictJsonTableFillEnabled = ref(
    settings_ACU.strictJsonTableFillEnabled === true,
  );
  const tableFillNativeToolEnabled = ref(
    settings_ACU.tableFillNativeToolEnabled === true,
  );
  const discardUnauthorizedTableEditsEnabled = ref(
    settings_ACU.discardUnauthorizedTableEditsEnabled !== false,
  );
  const extractRules = ref<FormFillRulePair[]>([]);
  const excludeRules = ref<FormFillRulePair[]>([]);
  const promptSegments = ref<FormFillPromptSegment[]>([]);
  const message = ref<FormFillMessage | null>(null);
  const promptDirty = ref(false);

  const numberFields = computed<FormFillNumberField[]>(() =>
    NUMBER_FIELD_META.map((meta) => ({
      ...meta,
      value: values.value[meta.key],
    })),
  );
  const promptTemplateMode = computed<"default" | "custom">(() =>
    promptFingerprint(promptSegments.value) ===
    promptFingerprint(currentDefaultPromptSegments())
      ? "default"
      : "custom",
  );

  function refresh(): void {
    const nextValues = { ...FALLBACKS } as Record<NumberSettingKey, number>;
    for (const key of Object.keys(FALLBACKS) as NumberSettingKey[]) {
      const normalized = normalizeNumber(key, settings_ACU[key]);
      nextValues[key] = normalized;
      settings_ACU[key] = normalized;
    }
    values.value = nextValues;
    tableApiPreset.value = String(settings_ACU.tableApiPreset || "");
    tableEditLastPairOnly.value = settings_ACU.tableEditLastPairOnly !== false;
    strictJsonTableFillEnabled.value = settings_ACU.strictJsonTableFillEnabled === true;
    tableFillNativeToolEnabled.value = settings_ACU.tableFillNativeToolEnabled === true;
    discardUnauthorizedTableEditsEnabled.value = settings_ACU.discardUnauthorizedTableEditsEnabled !== false;
    extractRules.value = normalizeRules(
      settings_ACU.tableContextExtractRules,
      settings_ACU.tableContextExtractTags || "",
      "extract",
    );
    excludeRules.value = normalizeRules(
      settings_ACU.tableContextExcludeRules,
      settings_ACU.tableContextExcludeTags || "",
      "exclude",
    );
    promptSegments.value = normalizePromptSegments(currentPromptSource());
    promptDirty.value = false;
  }

  function setTableApiPreset(value: string): void {
    const result = setFeatureApiPreset_ACU("table", String(value || ""));
    if (!result.ok) {
      message.value = { kind: "error", text: result.message || "API 预设更新失败。", scope: "settings" };
      return;
    }
    tableApiPreset.value = String(value || "");
    message.value = null;
  }

  function setNumber(key: NumberSettingKey, rawValue: number | string): void {
    const normalized = normalizeNumber(key, rawValue);
    const result = setUpdateNumberFields_ACU({ [key]: normalized });
    if (!result.ok) {
      message.value = { kind: "error", text: result.message || "设置保存失败。", scope: "settings" };
      return;
    }
    values.value = { ...values.value, [key]: normalized };
    message.value = null;
  }

  function setNumbers(
    patch: Partial<Record<NumberSettingKey, number | string>>,
  ): void {
    const nextValues = { ...values.value };
    const normalizedPatch: Partial<Record<NumberSettingKey, number>> = {};
    for (const key of Object.keys(patch) as NumberSettingKey[]) {
      const normalized = normalizeNumber(key, patch[key]);
      nextValues[key] = normalized;
      normalizedPatch[key] = normalized;
    }
    const result = setUpdateNumberFields_ACU(normalizedPatch);
    if (!result.ok) {
      message.value = { kind: "error", text: result.message || "设置保存失败。", scope: "settings" };
      return;
    }
    values.value = nextValues;
    message.value = null;
  }


  function setTableEditLastPairOnly(value: boolean): void {
    tableEditLastPairOnly.value = !!value;
    settings_ACU.tableEditLastPairOnly = tableEditLastPairOnly.value;
    saveSettings_ACU();
    message.value = null;
  }

  function setTableFillNativeToolEnabled(value: boolean): void {
    // 先按切换前的默认判定是否仍是默认提示词，再改开关，否则比对基准已变。
    const wasDefault = promptTemplateMode.value === "default";
    tableFillNativeToolEnabled.value = !!value;
    settings_ACU.tableFillNativeToolEnabled = tableFillNativeToolEnabled.value;
    // 仍用默认提示词时跟随切换到对应的默认主段；用户改写过的提示词原样保留。
    if (wasDefault) {
      promptSegments.value = currentDefaultPromptSegments();
      promptDirty.value = false;
    }
    saveSettings_ACU();
    message.value = null;
  }

  function setStrictJsonTableFillEnabled(value: boolean): void {
    strictJsonTableFillEnabled.value = !!value;
    settings_ACU.strictJsonTableFillEnabled = strictJsonTableFillEnabled.value;
    promptSegments.value = normalizePromptSegments(currentPromptSource());
    promptDirty.value = false;
    saveSettings_ACU();
    message.value = null;
  }

  function setDiscardUnauthorizedTableEditsEnabled(value: boolean): void {
    discardUnauthorizedTableEditsEnabled.value = !!value;
    settings_ACU.discardUnauthorizedTableEditsEnabled = discardUnauthorizedTableEditsEnabled.value;
    saveSettings_ACU();
    message.value = null;
  }

  function setExtractRules(rules: FormFillRulePair[]): void {
    extractRules.value = coerceRulePairs(rules);
    const result = setTableContextRules_ACU(
      "extract",
      normalizeRules(extractRules.value, "", "extract"),
    );
    if (!result.ok) {
      message.value = { kind: "error", text: result.message || "规则保存失败。", scope: "settings" };
      return;
    }
    message.value = null;
  }

  function setExcludeRules(rules: FormFillRulePair[]): void {
    excludeRules.value = coerceRulePairs(rules);
    const result = setTableContextRules_ACU(
      "exclude",
      normalizeRules(excludeRules.value, "", "exclude"),
    );
    if (!result.ok) {
      message.value = { kind: "error", text: result.message || "规则保存失败。", scope: "settings" };
      return;
    }
    message.value = null;
  }

  function addPromptSegment(position: "top" | "bottom"): void {
    const seg: FormFillPromptSegment = {
      role: "USER",
      content: "",
      deletable: true,
      mainSlot: "",
    };
    const next = promptSegments.value.slice();
    if (position === "top") next.unshift(seg);
    else next.push(seg);
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function deletePromptSegment(index: number): void {
    const target = promptSegments.value[index];
    if (!target || target.deletable === false) return;
    const next = promptSegments.value.slice();
    next.splice(index, 1);
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function updatePromptSegment(
    index: number,
    patch: Partial<FormFillPromptSegment>,
  ): void {
    if (!promptSegments.value[index]) return;
    const next = promptSegments.value.map(
      (seg: FormFillPromptSegment, i: number): FormFillPromptSegment => {
        if (i !== index) {
          if (
            (patch.mainSlot === "A" || patch.mainSlot === "B") &&
            seg.mainSlot === patch.mainSlot
          ) {
            return {
              ...seg,
              mainSlot: "",
              isMain: false,
              isMain2: false,
              deletable: true,
            };
          }
          return { ...seg };
        }
        const updated = { ...seg, ...patch };
        if (updated.mainSlot === "A" || updated.mainSlot === "B") {
          updated.deletable = false;
          updated.isMain = updated.mainSlot === "A";
          updated.isMain2 = updated.mainSlot === "B";
        } else {
          updated.mainSlot = "";
          updated.isMain = false;
          updated.isMain2 = false;
          updated.deletable = true;
        }
        return normalizePromptSegment(updated);
      },
    );
    promptSegments.value = ensureUniqueSlots(next);
    promptDirty.value = true;
  }

  function savePrompt(): void {
    const prepared = preparePromptForSave(promptSegments.value);
    const key = currentPromptSettingKey();
    let result: ReturnType<typeof setCharCardPrompt_ACU>;
    if (key === "charCardPrompt") {
      result = setCharCardPrompt_ACU(clone(prepared));
    } else {
      // strictJson 提示词：写入对应字段，保存失败回滚。
      const field = key;
      const snapshot = settings_ACU[field];
      settings_ACU[field] = clone(prepared);
      const saveResult = saveSettings_ACU();
      if (!saveResult.saved) {
        settings_ACU[field] = snapshot;
        message.value = { kind: "error", text: saveResult.warning || saveResult.error || "提示词保存失败。", scope: "prompt" };
        return;
      }
      result = { ok: true, code: "ok", changed: true, saveResult };
    }
    if (!result.ok) {
      message.value = { kind: "error", text: result.message || "提示词保存失败。", scope: "prompt" };
      return;
    }
    promptSegments.value = prepared;
    promptDirty.value = false;
    message.value = null;
    toast.success("提示词已保存");
  }

  function resetPrompt(): void {
    promptSegments.value = currentDefaultPromptSegments();
    promptDirty.value = true;
    message.value = {
      kind: "warning",
      text: "已载入当前存储模式默认提示词，保存后生效。",
      scope: "prompt",
    };
  }

  async function importPromptFile(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("提示词 JSON 必须是数组。");
      promptSegments.value = normalizePromptSegments(parsed);
      promptDirty.value = true;
      message.value = null;
      toast.success("提示词 JSON 已载入，保存后生效");
    } catch (error: any) {
      message.value = {
        kind: "error",
        text: error?.message || "提示词 JSON 读取失败。",
        scope: "prompt",
      };
    }
  }

  function exportPrompt(): void {
    try {
      const text = JSON.stringify(
        preparePromptForSave(promptSegments.value),
        null,
        2,
      );
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "acu-form-fill-prompt.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.value = null;
      toast.success("提示词 JSON 已导出");
    } catch (error: any) {
      message.value = {
        kind: "error",
        text: error?.message || "提示词导出失败。",
        scope: "prompt",
      };
    }
  }

  refresh();

  return {
    numberFields,
    tableApiPreset,
    tableEditLastPairOnly,
    strictJsonTableFillEnabled,
    tableFillNativeToolEnabled,
    discardUnauthorizedTableEditsEnabled,
    extractRules,
    excludeRules,
    promptSegments,
    promptTemplateMode,
    message,
    promptDirty,
    refresh,
    setTableApiPreset,
    setNumber,
    setNumbers,
    setTableEditLastPairOnly,
    setStrictJsonTableFillEnabled,
    setTableFillNativeToolEnabled,
    setDiscardUnauthorizedTableEditsEnabled,
    setExtractRules,
    setExcludeRules,
    addPromptSegment,
    deletePromptSegment,
    updatePromptSegment,
    savePrompt,
    resetPrompt,
    importPromptFile,
    exportPrompt,
  };
}
