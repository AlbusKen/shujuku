import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
  type Ref,
} from "vue";
import { getChatArray_ACU } from "../../service/chat/chat-service";
import {
  coreApisAreReady_ACU,
  currentChatFileIdentifier_ACU,
  getCurrentIsolationKey_ACU,
  settings_ACU,
} from "../../service/runtime/state-manager";
import {
  saveSettings_ACU,
  setGlobalPlotEnabled_ACU,
  setSummaryVectorIndexMode_ACU,
  setZeroTkOccupyMode_ACU,
} from "../../service/settings/settings-service";
import { getCurrentStorageMode } from "../../service/table/storage-mode";
import { resolveTableHistoryStateFromChat_ACU } from "../../service/table/table-history";
import { switchStorageMode } from "../../service/table/table-storage-strategy";
import { getCurrentTableDisplayData_ACU } from "../../service/settings/settings-readers";
import { setStorageMode_ACU, setAutoUpdateEnabled_ACU } from "../../service/settings/settings-write-service";
import { getSortedSheetKeys_ACU } from "../../service/template/chat-scope";
import { getActiveTemplatePresetMeta_ACU } from "../../service/template/template-preset-service";
import {
  disableFlightMode_ACU,
  enableFlightMode_ACU,
  type FlightModeTransitionResult_ACU,
} from "../../service/flight-mode/flight-mode-transition";
import { getCurrentFlightModeState_ACU } from "../../service/flight-mode/flight-mode-state";
import {
  getCurrentVectorMemoryConfig_ACU,
  validateSummaryVectorIndexConfig_ACU,
} from "../../service/vector/vector-memory-config";
import { validateDDLTextAgainstHeaders_ACU } from "../../shared/ddl-utils";
import {
  DEFAULT_CHAR_CARD_PROMPT_ACU,
  DEFAULT_CHAR_CARD_PROMPT_SQL_ACU,
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
} from "../../shared/defaults-json.js";
import { getAllLogs, subscribe, type LogEntry } from "../../shared/log-buffer";
import type { StorageMode } from "../../shared/table-storage-provider";
import {
  logError_ACU,
  isSummaryOrOutlineTable_ACU,
  normalizeNonNegativeInteger_ACU,
  normalizePositiveInteger_ACU,
} from "../../shared/utils";
import {
  isContentReplaceEnabledBySettings,
  setContentReplaceEnabledBySettings,
  syncContentReplaceAvailability,
} from "../stores/content-replace-gate";
import { dashboardCopy } from "../copy/dashboard-copy";
import { useToastStore } from "../stores/toast-store";
import { useApiPresetStore } from "../stores/api-preset-store";
import { useDevOptions } from "./useDevOptions";

type MessageKind = "info" | "success" | "warning" | "error";
type HealthKind = "ok" | "info" | "warning" | "error";
type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger";

export interface DashboardTableStatusRow {
  key: string;
  name: string;
  frequency: number;
  skip: number;
  unrecorded: number;
  effectiveUnrecorded: number;
  lastUpdatedAiFloor: number;
  nextTriggerAiFloor: number | null;
  hasTrackedUpdate: boolean;
  hasAnyData: boolean;
  frequencyLabel: string;
  unrecordedLabel: string;
  lastUpdatedLabel: string;
  nextTriggerLabel: string;
  ready: boolean;
  disabled: boolean;
}

export interface DashboardMessage {
  kind: MessageKind;
  text: string;
}

export interface DashboardToggleItem {
  key: string;
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
}

export interface DashboardStorageOption {
  value: StorageMode;
  label: string;
  description: string;
}

export interface DashboardHealthAction {
  label: string;
  pageId: string;
}

export interface DashboardHealthItem {
  key: string;
  title: string;
  summary: string;
  badge: string;
  kind: HealthKind;
  badgeVariant: BadgeVariant;
  iconClass: string;
  action?: DashboardHealthAction;
}

export interface DashboardPageState {
  chatFileIdentifier: Ref<string>;
  aiMessageCount: ComputedRef<number>;
  coreApisReady: Ref<boolean>;
  isolationKey: Ref<string>;
  storageMode: Ref<StorageMode>;
  storageMessage: Ref<DashboardMessage | null>;
  storageOptions: DashboardStorageOption[];
  tableRows: ComputedRef<DashboardTableStatusRow[]>;
  hasTables: ComputedRef<boolean>;
  basicToggles: ComputedRef<DashboardToggleItem[]>;
  advancedToggles: ComputedRef<DashboardToggleItem[]>;
  healthItems: ComputedRef<DashboardHealthItem[]>;
  contentReplaceGateEnabled: ComputedRef<boolean>;
  refresh: () => Promise<void>;
  setFlightMode: (enabled: boolean, options?: { confirmTemplateScopeChange?: boolean }) => Promise<FlightModeTransitionResult_ACU>;
  setToggle: (key: string, value: boolean) => void;
  setStorageMode: (mode: string) => Promise<void>;
}

interface Snapshot {
  chatFileIdentifier: string;
  coreApisReady: boolean;
  isolationKey: string;
  storageMode: StorageMode;
}

let deferLogRefresh = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeReadSnapshot(): Snapshot {
  try {
    return {
      chatFileIdentifier: String(currentChatFileIdentifier_ACU || ""),
      coreApisReady: coreApisAreReady_ACU === true,
      isolationKey: String(getCurrentIsolationKey_ACU?.() || ""),
      storageMode: getCurrentStorageMode(),
    };
  } catch {
    return {
      chatFileIdentifier: "",
      coreApisReady: false,
      isolationKey: "",
      storageMode: "native",
    };
  }
}

function currentSheetKeys(): string[] {
  try {
    deferLogRefresh = true;
    try {
      return getSortedSheetKeys_ACU(getCurrentTableDisplayData_ACU() || {});
    } finally {
      deferLogRefresh = false;
    }
  } catch {
    return [];
  }
}

function countAiMessages(): number {
  try {
    return getChatArray_ACU().filter((msg: any) => msg && !msg.is_user).length;
  } catch {
    return 0;
  }
}

function normalizeStorageMode(raw: string): StorageMode {
  return raw === "sqlite" ? "sqlite" : "native";
}

function hasActiveChatContext(chatFileIdentifier: string): boolean {
  const normalized = String(chatFileIdentifier || "").trim();
  return !!normalized && normalized !== "unknown_chat_init";
}

function ensurePromptTemplateEnabled(): void {
  if (
    !settings_ACU.promptTemplateSettings ||
    typeof settings_ACU.promptTemplateSettings !== "object"
  ) {
    settings_ACU.promptTemplateSettings = {};
  }
  if (settings_ACU.promptTemplateSettings.enabled === true) return;
  settings_ACU.promptTemplateSettings.enabled = true;
  saveSettings_ACU();
}

function makeHealthItem(input: {
  key: string;
  title: string;
  summary: string;
  badge: string;
  kind: HealthKind;
  action?: DashboardHealthAction;
  iconClass?: string;
}): DashboardHealthItem {
  const badgeVariantByKind: Record<HealthKind, BadgeVariant> = {
    ok: "success",
    info: "neutral",
    warning: "warning",
    error: "danger",
  };
  const iconByKind: Record<HealthKind, string> = {
    ok: "fa-solid fa-check",
    info: "fa-solid fa-circle-info",
    warning: "fa-solid fa-triangle-exclamation",
    error: "fa-solid fa-circle-exclamation",
  };
  return {
    ...input,
    badgeVariant: badgeVariantByKind[input.kind],
    iconClass: input.iconClass || iconByKind[input.kind],
  };
}

function normalizeDashboardApiConfig(value: any): {
  url: string;
  apiKey: string;
  model: string;
  useMainApi: boolean;
  max_tokens: number;
  temperature: number;
} {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const maxTokens = Number(source.max_tokens ?? source.maxTokens ?? 60000);
  const temperature = Number(source.temperature ?? 1);
  return {
    url: typeof source.url === "string" ? source.url : "",
    apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
    model: typeof source.model === "string" ? source.model : "",
    useMainApi: source.useMainApi !== false,
    max_tokens:
      Number.isFinite(maxTokens) && maxTokens > 0
        ? Math.floor(maxTokens)
        : 60000,
    temperature: Number.isFinite(temperature) ? temperature : 1,
  };
}

function resolveApiConnectionStatus(input: {
  apiMode: string;
  apiConfig: any;
  tavernProfile: string;
}): { ready: boolean; label: string; issue: string } {
  const apiMode = input.apiMode === "tavern" ? "tavern" : "custom";
  const apiConfig = normalizeDashboardApiConfig(input.apiConfig);
  const tavernProfile = String(input.tavernProfile || "").trim();
  if (apiMode === "tavern") {
    return tavernProfile
      ? {
          ready: true,
          label: dashboardCopy.api.tavernPresetLabel(tavernProfile),
          issue: "",
        }
      : {
          ready: false,
          label: dashboardCopy.api.tavernPresetMissingLabel,
          issue: dashboardCopy.api.tavernPresetMissingIssue,
        };
  }
  if (apiConfig.useMainApi)
    return { ready: true, label: dashboardCopy.api.mainApiLabel, issue: "" };
  if (apiConfig.url.trim() && apiConfig.model.trim())
    return { ready: true, label: apiConfig.model.trim(), issue: "" };
  const missing = [
    apiConfig.url.trim() ? "" : dashboardCopy.api.endpointField,
    apiConfig.model.trim() ? "" : dashboardCopy.api.modelField,
  ]
    .filter(Boolean)
    .join("、");
  return {
    ready: false,
    label: dashboardCopy.api.customApiLabel,
    issue: dashboardCopy.api.missingIssue(missing),
  };
}

function apiPresetMatchesCurrentConfig(preset: any): boolean {
  const presetConfig = normalizeDashboardApiConfig(preset?.apiConfig);
  const currentConfig = normalizeDashboardApiConfig(settings_ACU.apiConfig);
  return (
    String(preset?.apiMode || "custom") ===
      String(settings_ACU.apiMode || "custom") &&
    String(preset?.tavernProfile || "") ===
      String(settings_ACU.tavernProfile || "") &&
    presetConfig.useMainApi === currentConfig.useMainApi &&
    presetConfig.url === currentConfig.url &&
    presetConfig.apiKey === currentConfig.apiKey &&
    presetConfig.model === currentConfig.model &&
    presetConfig.max_tokens === currentConfig.max_tokens &&
    presetConfig.temperature === currentConfig.temperature
  );
}

function resolveCurrentApiPreset(): {
  name: string;
  apiMode: string;
  apiConfig: any;
  tavernProfile: string;
} {
  const presets = Array.isArray(settings_ACU.apiPresets)
    ? settings_ACU.apiPresets.filter((item: any) =>
        String(item?.name || "").trim(),
      )
    : [];
  const findPreset = (name: string) =>
    presets.find(
      (item: any) => String(item?.name || "") === String(name || "").trim(),
    );
  const chatKey =
    String(currentChatFileIdentifier_ACU || "").trim() || "unknown_chat";
  const boundName = String(
    settings_ACU.apiPresetBindingsByChat?.[chatKey]?.presetName || "",
  ).trim();
  const defaultName = String(settings_ACU.defaultApiPresetName || "").trim();
  const preset =
    findPreset(boundName) ||
    findPreset(defaultName) ||
    presets.find(apiPresetMatchesCurrentConfig);
  if (preset) {
    return {
      name: String(preset.name || "").trim(),
      apiMode: String(preset.apiMode || "custom"),
      apiConfig: preset.apiConfig || {},
      tavernProfile: String(preset.tavernProfile || ""),
    };
  }
  return {
    name: "",
    apiMode: String(settings_ACU.apiMode || "custom"),
    apiConfig: settings_ACU.apiConfig || {},
    tavernProfile: String(settings_ACU.tavernProfile || ""),
  };
}

function buildApiHealthItem(coreReady: boolean): DashboardHealthItem {
  const action = { label: dashboardCopy.api.action, pageId: "api" };
  if (!coreReady) {
    return makeHealthItem({
      key: "api",
      title: dashboardCopy.api.title,
      badge: dashboardCopy.api.unavailableBadge,
      kind: "error",
      summary: dashboardCopy.api.unavailableSummary,
      action,
    });
  }
  const current = resolveCurrentApiPreset();
  const status = resolveApiConnectionStatus(current);
  if (!status.ready) {
    return makeHealthItem({
      key: "api",
      title: dashboardCopy.api.title,
      badge: dashboardCopy.api.unconfiguredBadge,
      kind: "error",
      summary: current.name
        ? dashboardCopy.api.namedPresetNotReady(current.name, status.issue)
        : dashboardCopy.api.noUsablePreset(status.issue),
      action,
    });
  }
  return makeHealthItem({
    key: "api",
    title: dashboardCopy.api.title,
    badge: dashboardCopy.api.configuredBadge,
    kind: "ok",
    summary: current.name
      ? dashboardCopy.api.namedPresetReady(current.name, status.label)
      : dashboardCopy.api.configReadyWithoutPreset(status.label),
  });
}

function buildTableHealthItem(
  rows: DashboardTableStatusRow[],
  hasTables: boolean,
  totalAi: number,
  hasActiveChat: boolean,
): DashboardHealthItem {
  if (!hasActiveChat) {
    return makeHealthItem({
      key: "tables",
      title: dashboardCopy.tableHealth.title,
      badge: dashboardCopy.tableHealth.noChatBadge,
      kind: "info",
      summary: dashboardCopy.tableHealth.noChatSummary,
    });
  }

  if (!hasTables) {
    return makeHealthItem({
      key: "tables",
      title: dashboardCopy.tableHealth.title,
      badge: dashboardCopy.tableHealth.notLoadedBadge,
      kind: "info",
      summary: dashboardCopy.tableHealth.notLoadedSummary(totalAi),
      action: {
        label: dashboardCopy.tableHealth.updateSettingsAction,
        pageId: "form-fill",
      },
    });
  }
  const activeRows = rows.filter((row) => !row.disabled);
  const dueRows = activeRows.filter((row) => row.ready);
  const initialDueRows = activeRows.filter(
    (row) => !row.hasTrackedUpdate && row.effectiveUnrecorded >= row.frequency,
  );
  if (dueRows.length || initialDueRows.length) {
    const maxOverdue = dueRows.reduce(
      (max, row) => Math.max(max, row.effectiveUnrecorded - row.frequency),
      0,
    );
    const issueCount = dueRows.length + initialDueRows.length;
    const detailParts = [
      dueRows.length
        ? dashboardCopy.tableHealth.dueRowsDetail(dueRows.length)
        : "",
      initialDueRows.length
        ? dashboardCopy.tableHealth.initialDueRowsDetail(
            initialDueRows.length,
          )
        : "",
      maxOverdue > 0
        ? dashboardCopy.tableHealth.maxOverdueDetail(maxOverdue)
        : "",
    ].filter(Boolean);
    return makeHealthItem({
      key: "tables",
      title: dashboardCopy.tableHealth.title,
      badge: dashboardCopy.tableHealth.overdueBadge,
      kind: "info",
      summary: dashboardCopy.tableHealth.overdueSummary(
        issueCount,
        detailParts.join("；"),
      ),
      action: {
        label: dashboardCopy.tableHealth.statusAction,
        pageId: "form-fill",
      },
    });
  }
  const disabledCount = rows.filter((row) => row.disabled).length;
  return makeHealthItem({
    key: "tables",
    title: dashboardCopy.tableHealth.title,
    badge: dashboardCopy.tableHealth.okBadge,
    kind: "ok",
    summary: dashboardCopy.tableHealth.okSummary(
      activeRows.length,
      totalAi,
      disabledCount,
    ),
  });
}

interface SqlTemplateCheck {
  total: number;
  ddlCount: number;
  missingDdlNames: string[];
  invalidDdlNames: string[];
}

function readCurrentSqlTemplateCheck(): SqlTemplateCheck {
  const result: SqlTemplateCheck = {
    total: 0,
    ddlCount: 0,
    missingDdlNames: [],
    invalidDdlNames: [],
  };

  const displayData = getCurrentTableDisplayData_ACU();
  if (!displayData) return result;

  for (const key of currentSheetKeys()) {
    const table = displayData[key] as any;
    if (!table || typeof table !== "object") continue;
    result.total++;

    const name = String(table.name || key);
    const ddl = String(table.sourceData?.ddl || "").trim();
    if (!ddl) {
      result.missingDdlNames.push(name);
      continue;
    }

    result.ddlCount++;
    const headers = Array.isArray(table.content?.[0])
      ? table.content[0].map((item: any) => String(item ?? ""))
      : [];
    const validation = validateDDLTextAgainstHeaders_ACU(ddl, headers);
    if (!validation.valid) {
      result.invalidDdlNames.push(name);
    }
  }

  return result;
}

function formatTableNameSamples(names: string[]): string {
  const visible = names.slice(0, 3).join("、");
  return dashboardCopy.sqlHealth.tableNameSamples(visible, names.length);
}

function buildSqlTemplateHealthItem(
  mode: StorageMode,
  hasActiveChat: boolean,
  showDeveloperDiagnostics: boolean,
): DashboardHealthItem {
  const action = { label: dashboardCopy.sqlHealth.action, pageId: "form-fill" };
  const sqlEnabled = mode === "sqlite";

  if (!hasActiveChat) {
    return makeHealthItem({
      key: "sql-template",
      title: dashboardCopy.sqlHealth.title,
      badge: dashboardCopy.sqlHealth.noChatBadge,
      kind: "info",
      summary: dashboardCopy.sqlHealth.noChatSummary(sqlEnabled),
    });
  }

  const check = readCurrentSqlTemplateCheck();

  if (!check.total) {
    return makeHealthItem({
      key: "sql-template",
      title: dashboardCopy.sqlHealth.title,
      badge: sqlEnabled
        ? dashboardCopy.sqlHealth.pendingBadge
        : dashboardCopy.sqlHealth.disabledBadge,
      kind: "info",
      summary: dashboardCopy.sqlHealth.noTemplatesSummary(sqlEnabled),
      action,
    });
  }

  if (!sqlEnabled) {
    if (check.ddlCount > 0 && showDeveloperDiagnostics) {
      return makeHealthItem({
        key: "sql-template",
        title: dashboardCopy.sqlHealth.title,
        badge: dashboardCopy.sqlHealth.looksSqlBadge,
        kind: "info",
        summary: dashboardCopy.sqlHealth.looksSqlSummary(
          check.ddlCount,
          check.total,
        ),
        action,
      });
    }
    return makeHealthItem({
      key: "sql-template",
      title: dashboardCopy.sqlHealth.title,
      badge:
        check.ddlCount > 0
          ? dashboardCopy.sqlHealth.nativeModeBadge
          : dashboardCopy.sqlHealth.nativeMatchBadge,
      kind: check.ddlCount > 0 ? "info" : "ok",
      summary:
        check.ddlCount > 0
          ? dashboardCopy.sqlHealth.nativeModeSummary(check.total)
          : dashboardCopy.sqlHealth.nativeMatchSummary(check.total),
    });
  }

  if (check.missingDdlNames.length > 0) {
    return makeHealthItem({
      key: "sql-template",
      title: dashboardCopy.sqlHealth.title,
      badge: dashboardCopy.sqlHealth.missingDdlBadge,
      kind: "warning",
      summary: dashboardCopy.sqlHealth.missingDdlSummary(
        check.missingDdlNames.length,
        check.total,
        formatTableNameSamples(check.missingDdlNames),
      ),
      action,
    });
  }

  if (check.invalidDdlNames.length > 0) {
    return makeHealthItem({
      key: "sql-template",
      title: dashboardCopy.sqlHealth.title,
      badge: dashboardCopy.sqlHealth.invalidDdlBadge,
      kind: "error",
      summary: dashboardCopy.sqlHealth.invalidDdlSummary(
        check.invalidDdlNames.length,
        check.total,
        formatTableNameSamples(check.invalidDdlNames),
      ),
      action,
    });
  }

  return makeHealthItem({
    key: "sql-template",
    title: dashboardCopy.sqlHealth.title,
    badge: dashboardCopy.sqlHealth.templateMatchBadge,
    kind: "ok",
    summary: dashboardCopy.sqlHealth.templateMatchSummary(check.total),
  });
}

function buildVectorHealthItem(): DashboardHealthItem {
  const enabled = settings_ACU.summaryVectorIndexModeDefault === true;
  if (!enabled) {
    return makeHealthItem({
      key: "vector",
      title: dashboardCopy.vectorHealth.title,
      badge: dashboardCopy.vectorHealth.disabledBadge,
      kind: "info",
      summary: dashboardCopy.vectorHealth.disabledSummary,
    });
  }
  try {
    const validation = validateSummaryVectorIndexConfig_ACU(
      getCurrentVectorMemoryConfig_ACU(),
    );
    if (!validation.valid) {
      const readableErrors = formatVectorConfigErrors(validation.errors);
      return makeHealthItem({
        key: "vector",
        title: dashboardCopy.vectorHealth.title,
        badge: dashboardCopy.vectorHealth.incompleteBadge,
        kind: "warning",
        summary: dashboardCopy.vectorHealth.incompleteSummary(readableErrors),
        action: {
          label: dashboardCopy.vectorHealth.configureAction,
          pageId: "vector-index",
        },
      });
    }
    return makeHealthItem({
      key: "vector",
      title: dashboardCopy.vectorHealth.title,
      badge: dashboardCopy.vectorHealth.configuredBadge,
      kind: "ok",
      summary: dashboardCopy.vectorHealth.configuredSummary,
    });
  } catch (error: any) {
    return makeHealthItem({
      key: "vector",
      title: dashboardCopy.vectorHealth.title,
      badge: dashboardCopy.vectorHealth.readFailedBadge,
      kind: "error",
      summary: dashboardCopy.vectorHealth.readFailedSummary(
        error?.message || dashboardCopy.vectorHealth.readFailedFallback,
      ),
      action: {
        label: dashboardCopy.vectorHealth.configureAction,
        pageId: "vector-index",
      },
    });
  }
}

function formatVectorConfigErrors(errors: string[]): string[] {
  return errors.map((error) => {
    if (error.includes("embeddingEndpoint")) {
      return dashboardCopy.vectorHealth.missingEmbeddingEndpoint;
    }
    if (error.includes("embeddingModel")) {
      return dashboardCopy.vectorHealth.missingEmbeddingModel;
    }
    if (error.includes("rerankEndpoint") || error.includes("rerankModel")) {
      return dashboardCopy.vectorHealth.rerankPairRequired;
    }
    return error;
  });
}

function interpretLogEntry(entry: LogEntry): string {
  const message = String(entry.message || "");
  if (
    /API未配置|API未就绪|API请求失败|自定义API的URL或模型未配置|TavernHelper\.generateRaw|未选择酒馆连接预设|无法找到ID为|没有配置API|没有选择预设/.test(
      message,
    )
  ) {
    return dashboardCopy.logs.apiIssue;
  }
  if (
    /AI响应中未找到完整有效的 <tableEdit>|No recognizable table edit block|AI回复过短|解析或应用AI更新时出错/.test(
      message,
    )
  ) {
    return dashboardCopy.logs.outputFormatIssue;
  }
  if (
    /Primary JSON parse failed|JSON sanitization pipeline failed|Sanitized JSON parse failed|Failed to parse command line|Skipping malformed/.test(
      message,
    )
  ) {
    return dashboardCopy.logs.commandParseIssue;
  }
  if (
    /\[SQL Mode\] SQL 执行失败|no such table|no such column|UNIQUE constraint|\[SQL\] 表达式执行失败|\[ORM\]/.test(
      message,
    )
  ) {
    return dashboardCopy.logs.sqlIssue;
  }
  if (
    /无法将更新后的数据库保存到聊天记录|saveChat|setChatMessages|Save failed|Save aborted|聊天记录为空/.test(
      message,
    )
  ) {
    return dashboardCopy.logs.saveIssue;
  }
  return entry.level === "error"
    ? dashboardCopy.logs.genericError
    : dashboardCopy.logs.genericWarning;
}

function buildLogHealthItem(showDeveloperDiagnostics: boolean): DashboardHealthItem {
  const logs = getAllLogs();
  const errorEntries = logs.filter((entry) => entry.level === "error");
  const warnCount = logs.filter((entry) => entry.level === "warn").length;
  if (!errorEntries.length) {
    return makeHealthItem({
      key: "logs",
      title: dashboardCopy.logs.title,
      badge: dashboardCopy.logs.noErrorBadge,
      kind: "ok",
      summary: dashboardCopy.logs.noErrorSummary(
        showDeveloperDiagnostics ? warnCount : 0,
        showDeveloperDiagnostics,
      ),
    });
  }
  const latest = errorEntries[errorEntries.length - 1];
  return makeHealthItem({
    key: "logs",
    title: dashboardCopy.logs.title,
    badge: dashboardCopy.logs.errorBadge(errorEntries.length),
    kind: "error",
    summary: dashboardCopy.logs.errorSummary(
      interpretLogEntry(latest),
      errorEntries.length,
      warnCount,
      latest.tag,
    ),
    action: { label: dashboardCopy.logs.action, pageId: "advanced-tools" },
  });
}

export function useDashboardPage(): DashboardPageState {
  const toast = useToastStore();
  const {
    developerOptionsEnabled,
    setDeveloperOptionsEnabled,
    refresh: refreshDevOptions,
  } = useDevOptions();
  const initial = safeReadSnapshot();
  const chatFileIdentifier = ref(initial.chatFileIdentifier);
  const coreApisReady = ref(initial.coreApisReady);
  const isolationKey = ref(initial.isolationKey);
  const storageMode = ref<StorageMode>(initial.storageMode);
  const storageMessage = ref<DashboardMessage | null>(null);
  const dataRefreshTick = ref(0);
  const logRefreshTick = ref(0);
  let unsubscribeLogs: (() => void) | null = null;
  let logRefreshQueued = false;

  const storageOptions: DashboardStorageOption[] = [
    {
      value: "native",
      label: dashboardCopy.storage.modeLabel("native"),
      description: dashboardCopy.storage.optionDescription.native,
    },
    {
      value: "sqlite",
      label: dashboardCopy.storage.modeLabel("sqlite"),
      description: dashboardCopy.storage.optionDescription.sqlite,
    },
  ];

  const sheetKeys = computed(() => {
    void dataRefreshTick.value;
    return currentSheetKeys();
  });

  const hasTables = computed(() => sheetKeys.value.length > 0);
  const aiMessageCount = computed(() => {
    void dataRefreshTick.value;
    return countAiMessages();
  });

  const tableRows = computed<DashboardTableStatusRow[]>(() => {
    void dataRefreshTick.value;
    const displayData = getCurrentTableDisplayData_ACU();
    if (!displayData) return [];
    const chat = getChatArray_ACU();
    const totalAi = chat.filter((msg: any) => msg && !msg.is_user).length;
    const globalFrequency = normalizePositiveInteger_ACU(
      settings_ACU.autoUpdateFrequency,
      1,
    );
    const globalSkip = normalizeNonNegativeInteger_ACU(
      settings_ACU.skipUpdateFloors,
      0,
    );
    const currentIsolationKey = getCurrentIsolationKey_ACU();

    return sheetKeys.value.map((key) => {
      const table = displayData[key] || {};
      const config = table.updateConfig || {};
      const rawFrequency = Number.isFinite(config.updateFrequency)
        ? Math.trunc(config.updateFrequency)
        : -1;
      const rawSkip = Number.isFinite(config.skipFloors)
        ? Math.trunc(config.skipFloors)
        : -1;
      const frequency = rawFrequency === -1 ? globalFrequency : rawFrequency;
      const skip = Math.max(0, rawSkip === -1 ? globalSkip : rawSkip);
      const disabled = frequency <= 0;
      const history = resolveTableHistoryStateFromChat_ACU(chat, {
        sheetKey: key,
        isSummaryTable: isSummaryOrOutlineTable_ACU(String(table.name || "")),
        isolationKey: currentIsolationKey,
        settings: settings_ACU,
      });
      const lastFloor = history.lastTrackedUpdateAiFloor;
      const found = history.hasTrackedUpdate;

      if (disabled) {
        return {
          key,
          name: String(table.name || key),
          frequency,
          skip,
          unrecorded: found ? Math.max(0, totalAi - lastFloor) : 0,
          effectiveUnrecorded: found
            ? Math.max(0, totalAi - skip - lastFloor)
            : Math.max(0, totalAi - skip),
          lastUpdatedAiFloor: lastFloor,
          nextTriggerAiFloor: null as number | null,
          hasTrackedUpdate: found,
          hasAnyData: history.hasAnyData,
          frequencyLabel: dashboardCopy.tableStatus.none,
          unrecordedLabel: found
            ? String(Math.max(0, totalAi - lastFloor))
            : "—",
          lastUpdatedLabel: found
            ? String(lastFloor)
            : dashboardCopy.tableStatus.notInitialized,
          nextTriggerLabel: dashboardCopy.tableStatus.none,
          ready: false,
          disabled: true,
        };
      }

      const effectiveUnrecorded = found
        ? Math.max(0, totalAi - skip - lastFloor)
        : 0;
      const effectiveInitialUnrecorded = found
        ? effectiveUnrecorded
        : Math.max(0, totalAi - skip);
      const nextTriggerAiFloor = found ? lastFloor + frequency + skip : null;
      return {
        key,
        name: String(table.name || key),
        frequency,
        skip,
        unrecorded: found ? Math.max(0, totalAi - lastFloor) : 0,
        effectiveUnrecorded: effectiveInitialUnrecorded,
        lastUpdatedAiFloor: lastFloor,
        nextTriggerAiFloor,
        hasTrackedUpdate: found,
        hasAnyData: history.hasAnyData,
        frequencyLabel: String(frequency),
        unrecordedLabel: found ? String(Math.max(0, totalAi - lastFloor)) : "—",
        lastUpdatedLabel: found
          ? String(lastFloor)
          : dashboardCopy.tableStatus.notInitialized,
        nextTriggerLabel: found
          ? String(lastFloor + frequency + skip)
          : dashboardCopy.tableStatus.pendingInitial,
        ready: found && effectiveUnrecorded >= frequency,
        disabled: false,
      };
    });
  });

  /** 基础设置 — 同一聊天里时不时开关的功能。 */
  const basicToggles = computed<DashboardToggleItem[]>(() => {
    void dataRefreshTick.value;
    const flightMode = getCurrentFlightModeState_ACU();
    const hasActiveChat = hasActiveChatContext(chatFileIdentifier.value);
    return [
      {
        key: "flightMode",
        label: dashboardCopy.toggles.flightMode.label,
        description: dashboardCopy.toggles.flightMode.description,
        value: flightMode.enabled,
        disabled: !hasActiveChat,
      },
      {
        key: "autoUpdateEnabled",
        label: dashboardCopy.toggles.autoUpdate.label,
        description: dashboardCopy.toggles.autoUpdate.description,
        value: settings_ACU.autoUpdateEnabled !== false,
      },
      {
        key: "toastMuteEnabled",
        label: dashboardCopy.toggles.toastMute.label,
        description: dashboardCopy.toggles.toastMute.description,
        value: settings_ACU.toastMuteEnabled === true,
      },
      {
        key: "zeroTkOccupyModeDefault",
        label: dashboardCopy.toggles.zeroTk.label,
        description: dashboardCopy.toggles.zeroTk.description,
        value: settings_ACU.zeroTkOccupyModeDefault === true,
      },
      {
        key: "streamingEnabled",
        label: dashboardCopy.toggles.streaming.label,
        description: dashboardCopy.toggles.streaming.description,
        value: settings_ACU.streamingEnabled === true,
      },
    ];
  });

  /** 高级设置 — 配置后基本不动；动了出问题是正常的。 */
  const advancedToggles = computed<DashboardToggleItem[]>(() => {
    void dataRefreshTick.value;
    const items: DashboardToggleItem[] = [
      {
        key: "plotEnabled",
        label: dashboardCopy.toggles.plot.label,
        description: dashboardCopy.toggles.plot.description,
        value: settings_ACU.plotSettings?.enabled === true,
      },
      {
        key: "continuationPageEnabled",
        label: dashboardCopy.toggles.continuation.label,
        description: dashboardCopy.toggles.continuation.description,
        value: settings_ACU.continuationPageEnabled !== false,
      },
      {
        key: "worldSimulationPageEnabled",
        label: dashboardCopy.toggles.worldSimulation.label,
        description: dashboardCopy.toggles.worldSimulation.description,
        value: settings_ACU.worldSimulationPageEnabled !== false,
      },
      {
        key: "externalImportPageEnabled",
        label: dashboardCopy.toggles.externalImport.label,
        description: dashboardCopy.toggles.externalImport.description,
        value: settings_ACU.externalImportPageEnabled !== false,
      },
      {
        key: "contentReplaceEnabled",
        label: dashboardCopy.toggles.contentReplace.label,
        description: dashboardCopy.toggles.contentReplace.description,
        value: isContentReplaceEnabledBySettings(),
      },
    ];
    items.push(
      {
        key: "summaryVectorIndexModeEnabled",
        label: dashboardCopy.toggles.vector.label,
        description: dashboardCopy.toggles.vector.description,
        value: settings_ACU.summaryVectorIndexModeDefault === true,
      },
      {
        key: "developerOptionsEnabled",
        label: dashboardCopy.developerToggle.label,
        description: dashboardCopy.developerToggle.description,
        value: developerOptionsEnabled.value,
      },
    );
    return items;
  });

  const healthItems = computed<DashboardHealthItem[]>(() => {
    void dataRefreshTick.value;
    void logRefreshTick.value;
    const hasActiveChat = hasActiveChatContext(chatFileIdentifier.value);
    const showDeveloperDiagnostics = developerOptionsEnabled.value === true;
    return [
      buildApiHealthItem(coreApisReady.value),
      buildTableHealthItem(
        tableRows.value,
        hasTables.value,
        aiMessageCount.value,
        hasActiveChat,
      ),
      buildSqlTemplateHealthItem(
        storageMode.value,
        hasActiveChat,
        showDeveloperDiagnostics,
      ),
      buildVectorHealthItem(),
      buildLogHealthItem(showDeveloperDiagnostics),
    ];
  });

  const contentReplaceGateEnabled = computed(() => {
    void dataRefreshTick.value;
    return isContentReplaceEnabledBySettings();
  });

  onMounted(() => {
    unsubscribeLogs = subscribe((entry) => {
      if (entry.level === "debug") return;
      if (!deferLogRefresh) {
        logRefreshTick.value++;
        return;
      }
      if (!logRefreshQueued) {
        logRefreshQueued = true;
        queueMicrotask(() => {
          logRefreshQueued = false;
          logRefreshTick.value++;
        });
      }
    });
  });

  onBeforeUnmount(() => {
    unsubscribeLogs?.();
    unsubscribeLogs = null;
  });

  async function refresh(): Promise<void> {
    refreshDevOptions();
    ensurePromptTemplateEnabled();
    syncContentReplaceAvailability();
    const next = safeReadSnapshot();
    chatFileIdentifier.value = next.chatFileIdentifier;
    coreApisReady.value = next.coreApisReady;
    isolationKey.value = next.isolationKey;
    storageMode.value = next.storageMode;
    dataRefreshTick.value++;
  }

  async function setFlightMode(
    enabled: boolean,
    options: { confirmTemplateScopeChange?: boolean } = {},
  ): Promise<FlightModeTransitionResult_ACU> {
    try {
      return enabled
        ? await enableFlightMode_ACU()
        : await disableFlightMode_ACU(options);
    } catch (error: any) {
      return {
        ok: false,
        reason: "commit_failed",
        error: error?.message || String(error || "飞行模式切换失败。"),
      };
    } finally {
      await refresh();
    }
  }

  function setToggle(key: string, value: boolean): void {
    if (key === "plotEnabled") {
      const next = !!value;
      try {
        setGlobalPlotEnabled_ACU(next);
      } catch {
        if (
          !settings_ACU.plotSettings ||
          typeof settings_ACU.plotSettings !== "object"
        ) {
          settings_ACU.plotSettings = {};
        }
        settings_ACU.plotSettings.enabled = next;
      }
      saveSettings_ACU();
    } else if (key === "zeroTkOccupyModeDefault") {
      setZeroTkOccupyMode_ACU(!!value);
    } else if (key === "summaryVectorIndexModeEnabled") {
      setSummaryVectorIndexMode_ACU(!!value);
    } else if (key === "developerOptionsEnabled") {
      setDeveloperOptionsEnabled(!!value);
    } else if (
      key === "continuationPageEnabled" ||
      key === "worldSimulationPageEnabled" ||
      key === "externalImportPageEnabled"
    ) {
      settings_ACU[key] = !!value;
      saveSettings_ACU();
    } else if (key === "contentReplaceEnabled") {
      setContentReplaceEnabledBySettings(!!value);
      saveSettings_ACU();
    } else if (
      key === "autoUpdateEnabled" ||
      key === "toastMuteEnabled" ||
      key === "streamingEnabled"
    ) {
      if (key === "autoUpdateEnabled") {
        setAutoUpdateEnabled_ACU(!!value);
      } else if (key === "streamingEnabled") {
        useApiPresetStore().setStreamingEnabled(!!value);
      } else {
        settings_ACU[key] = !!value;
        saveSettings_ACU();
      }
    }
    dataRefreshTick.value++;
    dataRefreshTick.value++;
  }

  async function setStorageMode(rawMode: string): Promise<void> {
    const mode = normalizeStorageMode(rawMode);
    const previousMode = normalizeStorageMode(getCurrentStorageMode());
    // 先通过 service 原子写 settings（含提示词重置）；保存失败即返回，不触发 provider 切换。
    const writeResult = setStorageMode_ACU(mode);
    if (!writeResult.ok) {
      storageMessage.value = {
        kind: "error",
        text: writeResult.message || "存储模式保存失败。",
      };
      await refresh();
      return;
    }
    storageMode.value = mode;
    try {
      await switchStorageMode(mode);
      storageMessage.value = null;
      toast.success(dashboardCopy.storage.switched(mode));
    } catch (error: any) {
      logError_ACU("[ACU-V2] storage mode switch failed", error);
      // provider 切换失败：回滚 settings 到切换前的模式，避免 storageMode 与运行时 provider 分叉。
      // 失败时运行时 provider 已由 switchStorageMode 内部回退或保持旧 provider，按 previousMode 重置提示词并保存。
      const rollbackResult = setStorageMode_ACU(previousMode);
      if (!rollbackResult.ok) {
        logError_ACU("[ACU-V2] storage mode rollback failed", rollbackResult.message);
      }
      storageMode.value = previousMode;
      storageMessage.value = null;
      toast.error("存储模式切换失败，详情见运行日志");
    } finally {
      await refresh();
    }
  }

  return {
    chatFileIdentifier,
    aiMessageCount,
    coreApisReady,
    isolationKey,
    storageMode,
    storageMessage,
    storageOptions,
    tableRows,
    hasTables,
    basicToggles,
    advancedToggles,
    healthItems,
    contentReplaceGateEnabled,
    refresh,
    setFlightMode,
    setToggle,
    setStorageMode,
  };
}

/** 模板预设状态条数据来源（与"当前活动 API / 当前剧情推进预设"并列展示）。 */
export interface TemplatePresetSnapshot {
  displayName: string;
  scopeLabel: string;
}

export function readActiveTemplatePresetSnapshot(): TemplatePresetSnapshot {
  try {
    const meta = getActiveTemplatePresetMeta_ACU();
    return {
      displayName: String(meta.displayName || dashboardCopy.templatePreset.defaultName),
      scopeLabel: String(meta.scopeLabel || dashboardCopy.templatePreset.globalScope),
    };
  } catch {
    return { displayName: dashboardCopy.templatePreset.readFailed, scopeLabel: "" };
  }
}
