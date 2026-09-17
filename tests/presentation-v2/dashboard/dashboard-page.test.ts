/**
 * DashboardPage 集成 — 基础/高级开关、SQL 存储模式选择、开发者总开关
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "acu_v2_ui_state";

const m = vi.hoisted(() => ({
  parseTableTemplateJson_ACU: vi.fn(),
}));

function createSettings() {
  return {
    apiMode: "custom",
    apiConfig: {
      url: "",
      apiKey: "",
      model: "",
      useMainApi: true,
      max_tokens: 60000,
      temperature: 1,
    },
    tavernProfile: "",
    streamingEnabled: false,
    apiPresets: [
      {
        name: "table-fast",
        apiMode: "custom",
        apiConfig: {
          url: "",
          apiKey: "",
          model: "",
          useMainApi: true,
          max_tokens: 1000,
          temperature: 1,
        },
        tavernProfile: "",
      },
    ],
    defaultApiPresetName: "table-fast",
    apiPresetBindingsByChat: {},
    tableApiPreset: "",
    tableApiPresetOverridesByName: {},
    autoUpdateEnabled: true,
    continuationPageEnabled: true,
    externalImportPageEnabled: true,
    toastMuteEnabled: false,
    promptTemplateSettings: { enabled: true },
    zeroTkOccupyModeDefault: false,
    summaryVectorIndexModeDefault: false,
    vectorMemoryConfig: {
      embeddingEndpoint: "",
      embeddingModel: "",
      rerankEndpoint: "",
      rerankModel: "",
    },
    autoUpdateFrequency: 2,
    skipUpdateFloors: 0,
    updateBatchSize: 2,
    manualSelectedTables: [],
    hasManualSelection: false,
    storageMode: "native",
    contentOptimizationSettings: { apiPreset: "" },
    plotSettings: {
      enabled: false,
      plotTasks: [],
      promptPresets: [],
      plotWorldbookConfig: { worldbookName: "", enabledEntries: [] },
    },
    plotApiPreset: "",
    plotTaskApiPresetOverridesById: {},
  } as any;
}

function createTableData() {
  return {
    sheet_a: {
      name: "角色状态",
      content: [["id"], ["1"]],
      updateConfig: { updateFrequency: -1, skipFloors: -1 },
    },
    sheet_b: {
      name: "事件记录",
      content: [["id"], ["1"], ["2"]],
      updateConfig: { updateFrequency: 0, skipFloors: -1 },
    },
  };
}

function createSqlTableData() {
  return {
    sheet_a: {
      name: "角色状态",
      content: [
        ["row_id", "姓名"],
        ["1", "角色A"],
      ],
      sourceData: {
        ddl: "CREATE TABLE character_status (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  name TEXT -- 姓名\n);",
      },
      updateConfig: { updateFrequency: -1, skipFloors: -1 },
    },
    sheet_b: {
      name: "事件记录",
      content: [
        ["row_id", "事件"],
        ["1", "抵达城门"],
      ],
      sourceData: {
        ddl: "CREATE TABLE event_log (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  event_text TEXT -- 事件\n);",
      },
      updateConfig: { updateFrequency: 0, skipFloors: -1 },
    },
  };
}

async function mountDashboardPage(
  settings = createSettings(),
  tableData = createTableData(),
  options: {
    chatFileIdentifier?: string;
    developerOptionsEnabled?: boolean;
    warnLogEnabled?: boolean;
    failStorageSwitch?: boolean;
    historyState?: Record<string, unknown>;
    templateData?: Record<string, unknown> | null;
  } = {},
) {
  vi.resetModules();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  m.parseTableTemplateJson_ACU.mockReset();
  m.parseTableTemplateJson_ACU.mockImplementation(() => {
    // 默认注入可被 Dashboard 展示的确定性模板 fixture（含 seed row）
    return {
      sheet_purge: {
        name: "PurgeFallbackTable",
        content: [
          ["row_id", "值"],
          ["seed_row_1", "不应被视为聊天数据"],
        ],
        updateConfig: { updateFrequency: 7, skipFloors: 2 },
      },
    };
  });
  vi.doMock("../../../src/shared/utils", async () => {
    const actual = await vi.importActual<typeof import("../../../src/shared/utils")>("src/shared/utils");
    return {
      ...actual,
      parseTableTemplateJson_ACU: m.parseTableTemplateJson_ACU,
    };
  });

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      router: { activePageId: "dashboard" },
      devOptions: {
        developerOptionsEnabled: options.developerOptionsEnabled === true,
        warnLogEnabled: options.warnLogEnabled === true,
      },
    }),
  );

  const saveSettings = vi.fn(() => ({ saved: true, storageType: "memory" }));
  const enableFlightMode = vi.fn(async () => ({ ok: true, visibleChronicleRowCount: 2 }));
  const disableFlightMode = vi.fn(async () => ({ ok: true }));

  vi.doMock("../../../src/service/runtime/state-manager", () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU:
      options.chatFileIdentifier ?? "chat-dashboard",
    currentJsonTableData_ACU: tableData,
    coreApisAreReady_ACU: true,
    getCurrentIsolationKey_ACU: () => "",
  }));
  vi.doMock("../../../src/service/settings/settings-service", () => ({
    saveSettings_ACU: saveSettings,
    setGlobalPlotEnabled_ACU: vi.fn((enabled: boolean) => {
      settings.plotSettings.enabled = enabled;
    }),
    setZeroTkOccupyMode_ACU: vi.fn((enabled: boolean) => {
      settings.zeroTkOccupyModeDefault = enabled;
    }),
    setSummaryVectorIndexMode_ACU: vi.fn((enabled: boolean) => {
      settings.summaryVectorIndexModeDefault = enabled;
    }),
  }));
  vi.doMock("../../../src/service/chat/chat-service", () => ({
    getChatArray_ACU: () => [
      { is_user: true, mes: "u1" },
      { is_user: false, mes: "a1" },
      { is_user: true, mes: "u2" },
      { is_user: false, mes: "a2" },
      { is_user: false, mes: "a3" },
    ],
  }));
  vi.doMock("../../../src/service/template/chat-scope", () => ({
    getSortedSheetKeys_ACU: (data: any) =>
      Object.keys(data).filter((k) => k.startsWith("sheet_")),
    getCurrentChatPlotScopeState_ACU: () => null,
    setCurrentChatPlotScopeState_ACU: vi.fn(),
  }));
  vi.doMock("../../../src/service/template/template-preset-service", () => ({
    getActiveTemplatePresetMeta_ACU: () => ({
      displayName: "默认预设",
      scopeLabel: "全局",
    }),
  }));
  vi.doMock("../../../src/service/table/table-history", () => ({
    resolveTableHistoryStateFromChat_ACU: (_chat: any[], opts: any) => ({
      latestAiMessageIndex: 4,
      latestDataMessageIndex: 3,
      lastTrackedUpdateMessageIndex: opts.sheetKey === "sheet_a" ? 1 : -1,
      latestDataAiFloor: 2,
      lastTrackedUpdateAiFloor: opts.sheetKey === "sheet_a" ? 1 : 0,
      hasAnyData: opts.sheetKey === "sheet_a",
      hasTrackedUpdate: opts.sheetKey === "sheet_a",
      ...(options.historyState || {}),
    }),
  }));
  vi.doMock("../../../src/service/table/storage-mode", () => ({
    getCurrentStorageMode: () => settings.storageMode,
    isSqliteMode: () => settings.storageMode === "sqlite",
  }));
  vi.doMock("../../../src/service/table/table-storage-strategy", () => ({
    switchStorageMode: vi.fn(async (mode: string) => {
      if (options.failStorageSwitch) throw new Error("switch failed");
      settings.storageMode = mode;
    }),
  }));
  vi.doMock("../../../src/service/vector/vector-memory-config", () => ({
    getCurrentVectorMemoryConfig_ACU: () => settings.vectorMemoryConfig || {},
    validateSummaryVectorIndexConfig_ACU: (config: any) => {
      const errors: string[] = [];
      if (!String(config?.embeddingEndpoint || "").trim())
        errors.push("缺少 embeddingEndpoint");
      if (!String(config?.embeddingModel || "").trim())
        errors.push("缺少 embeddingModel");
      const hasRerankEndpoint = !!String(config?.rerankEndpoint || "").trim();
      const hasRerankModel = !!String(config?.rerankModel || "").trim();
      if (hasRerankEndpoint !== hasRerankModel)
        errors.push("rerankEndpoint 和 rerankModel 必须同时填写或同时留空");
      return { valid: errors.length === 0, errors };
    },
  }));
  vi.doMock("../../../src/service/ai/ai-service", () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({
      success: true,
      models: [],
    })),
  }));
  vi.doMock("../../../src/service/flight-mode/flight-mode-state", () => ({
    getCurrentFlightModeState_ACU: () => ({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: "" }),
  }));
  vi.doMock("../../../src/service/flight-mode/flight-mode-transition", () => ({
    enableFlightMode_ACU: enableFlightMode,
    disableFlightMode_ACU: disableFlightMode,
  }));

  vi.spyOn(window, "confirm").mockReturnValue(false);

  const mount = await import("../../../src/presentation-v2/bootstrap/mount");
  await mount.openAcuV2App();
  await new Promise((r) => setTimeout(r, 0));
  const { useDashboardPage } = await import("../../../src/presentation-v2/composables/useDashboardPage");
  const dashboard = useDashboardPage();
  return { mount, settings, saveSettings, enableFlightMode, disableFlightMode, dashboard };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DashboardPage", () => {
  it("runtime 为 null 时展示全局模板表名与配置，不把 seed rows 当作已有聊天数据", async () => {
    const { dashboard } = await mountDashboardPage(createSettings(), null);

    expect(dashboard.hasTables.value).toBe(true);
    const rows = dashboard.tableRows.value;
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("PurgeFallbackTable");
    // updateConfig 来自模板 fixture（updateFrequency=7, skipFloors=2），
    // 且模板 fixture 内含 seed row，不得被当作已初始化的聊天数据。
    expect(rows[0].frequency).toBe(7);
    expect(rows[0].skip).toBe(2);
    expect(rows[0].hasTrackedUpdate).toBe(false);
    expect(rows[0].hasAnyData).toBe(false);
    expect(rows[0].lastUpdatedLabel).toBe("未初始");
  });

  it("runtime 为 null 时模板回退以 stripSeedRows 读取全局模板", async () => {
    const { dashboard } = await mountDashboardPage(createSettings(), null);
    expect(dashboard.hasTables.value).toBe(true);
    // useDashboardPage 内的 display reader必须通过 parseTableTemplateJson_ACU({ stripSeedRows: true })
    // 读取模板，避免把模板预置行当作聊天数据。
    expect(m.parseTableTemplateJson_ACU).toHaveBeenCalledWith({ stripSeedRows: true });
  });

  it("配置状态面板移除后，仪表盘展示运行概览和开关面板", () => {
    const source = readFileSync(
      "src/presentation-v2/pages/DashboardPage.vue",
      "utf8",
    );
    const copySource = readFileSync(
      "src/presentation-v2/copy/dashboard-copy.ts",
      "utf8",
    );

    expect(source).toContain("dashboardCopy.panels.healthTitle");
    expect(source).toContain("dashboardCopy.panels.togglesTitle");
    expect(copySource).toContain('healthTitle: "运行概览"');
    expect(copySource).toContain('togglesTitle: "开关"');
    expect(source).not.toContain("ConfigStatusPanel");
    expect(source).not.toContain(
      "grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);",
    );
    expect(source).not.toContain("acu-v2-dashboard-page__spacer");
  });

  it("默认渲染运行概览和基础开关；header 不再有 subtitle / 刷新按钮 / API 三件套", async () => {
    const { mount } = await mountDashboardPage();

    const page = document.querySelector(".acu-v2-dashboard-page");
    expect(page).not.toBeNull();
    const text = page!.textContent || "";

    // 配置状态面板已移除，新的运行概览面板保留概览提醒
    expect(text).not.toContain("配置状态");
    expect(text).not.toContain("当前使用 table-fast");
    expect(text).not.toContain("默认预设（全局）");
    expect(text).not.toContain("存储模式原生SQL");
    expect(
      page!.querySelector(".acu-v2-dashboard-page__setup-item"),
    ).toBeNull();
    expect(
      page!.querySelector(".acu-v2-dashboard-page__status-table"),
    ).toBeNull();
    expect(text).not.toContain("下一次");
    expect(text).not.toContain("事件记录");
    expect(text).toContain("运行概览");
    expect(text).toContain("API");
    expect(text).toContain("表格更新");
    expect(text).toContain("SQL 模式");
    expect(text).toContain("交火向量");
    expect(text).toContain("运行日志");

    const vectorHealth = Array.from(
      page!.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    ).find((item) => (item.textContent || "").includes("交火向量"));
    expect(vectorHealth).toBeDefined();
    expect(vectorHealth!.textContent || "").toContain("未启用");
    expect(
      vectorHealth!.classList.contains(
        "acu-v2-dashboard-page__health-item--info",
      ),
    ).toBe(true);
    expect(vectorHealth!.querySelector(".acu-badge--neutral")).not.toBeNull();

    // 基础设置默认呈现
    expect(text).toContain("基础设置");
    expect(text).not.toContain("功能开关");
    expect(text).toContain("高级设置");
    expect(text).toContain("自动更新");
    expect(text).toContain("静默提示框");
    expect(text).toContain("开启流式输出");
    expect(text).toContain("0TK 占用模式");

    const visibleToggleKeys = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "button[data-acu-toggle-key]",
      ),
    ).map((button) => button.dataset.acuToggleKey);
    expect(visibleToggleKeys).toEqual([
      "flightMode",
      "autoUpdateEnabled",
      "toastMuteEnabled",
      "zeroTkOccupyModeDefault",
      "streamingEnabled",
    ]);

    // 默认在基础设置视图下，高级字段不可见
    expect(
      document.querySelector('button[data-acu-toggle-key="plotEnabled"]'),
    ).toBeNull();
    expect(text).not.toContain("启用条件模板功能");
    expect(text).not.toContain("交火模式默认关闭");
    expect(text).not.toContain("启用开发者选项");
    expect(text).not.toContain("启用SQL存储");
    // 旧存储模式 radio 不再由配置状态面板承载
    expect(text).not.toContain("决定表格数据如何持久化");
    expect(
      document.querySelector('div[role="radiogroup"][aria-label="存储模式"]'),
    ).toBeNull();
    expect(text).not.toContain("SQLite");

    // 旧设计已删除：subtitle / 刷新按钮 / API 三件套面板 / 规范填表 toggle
    expect(text).not.toContain("数据库运行态");
    expect(text).not.toContain("当前 API");
    expect(text).not.toContain("规范填表");
    expect(
      document.querySelector(
        'button[data-acu-toggle-key="standardizedTableFillEnabled"]',
      ),
    ).toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it("未加载聊天时表格更新和 SQL 模式使用白色提示，不显示黄色警告", async () => {
    const settings = createSettings();
    settings.storageMode = "sqlite";
    const { mount } = await mountDashboardPage(settings, createSqlTableData(), {
      chatFileIdentifier: "unknown_chat_init",
    });

    const healthItems = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    );
    const tableHealth = healthItems.find((item) =>
      (item.textContent || "").includes("表格更新"),
    );
    const sqlHealth = healthItems.find((item) =>
      (item.textContent || "").includes("SQL 模式"),
    );

    expect(tableHealth).toBeDefined();
    expect(sqlHealth).toBeDefined();
    for (const item of [tableHealth!, sqlHealth!]) {
      expect(item.textContent || "").toContain("未加载聊天");
      expect(
        item.classList.contains("acu-v2-dashboard-page__health-item--info"),
      ).toBe(true);
      expect(
        item.classList.contains("acu-v2-dashboard-page__health-item--warning"),
      ).toBe(false);
      expect(item.querySelector(".acu-badge--neutral")).not.toBeNull();
      expect(item.querySelector("button")).toBeNull();
    }
    expect(tableHealth!.textContent || "").toContain("无法读取对应数据库表格");
    expect(sqlHealth!.textContent || "").toContain(
      "无法检查当前聊天的表格模板是否适配",
    );

    mount.__resetAcuV2MountForTests();
  });

  it("SQLite 存储开启且表格模板适配时显示模板适配", async () => {
    const settings = createSettings();
    settings.storageMode = "sqlite";
    const { mount } = await mountDashboardPage(settings, createSqlTableData());

    const sqlHealth = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    ).find((item) => (item.textContent || "").includes("SQL 模式"));

    expect(sqlHealth).toBeDefined();
    expect(sqlHealth!.textContent || "").toContain("模板适配");
    expect(sqlHealth!.textContent || "").toContain("当前存储模式是 SQLite");
    expect(sqlHealth!.textContent || "").toContain(
      "当前 2 张表都是适配 SQL 的表格模板",
    );
    expect(sqlHealth!.querySelector("button")).toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it("SQLite 存储开启但表格模板不完整时提示去表格模板补齐", async () => {
    const settings = createSettings();
    settings.storageMode = "sqlite";
    const tableData = createSqlTableData() as any;
    delete tableData.sheet_b.sourceData.ddl;
    const { mount } = await mountDashboardPage(settings, tableData);

    const sqlHealth = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    ).find((item) => (item.textContent || "").includes("SQL 模式"));

    expect(sqlHealth).toBeDefined();
    expect(sqlHealth!.textContent || "").toContain("模板未适配");
    expect(sqlHealth!.textContent || "").toContain("当前存储模式是 SQLite");
    expect(sqlHealth!.textContent || "").toContain("事件记录");
    expect(sqlHealth!.textContent || "").toContain("补齐 SQL 表结构信息");
    expect(sqlHealth!.textContent || "").toContain("查看表格模板");

    const action = Array.from(
      sqlHealth!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => (button.textContent || "").includes("查看表格模板"));
    expect(action).toBeDefined();

    mount.__resetAcuV2MountForTests();
  });

  it("原生 JSON 存储但表格模板包含 SQL 信息时默认显示中性说明", async () => {
    const settings = createSettings();
    const { mount } = await mountDashboardPage(settings, createSqlTableData());

    const sqlHealth = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    ).find((item) => (item.textContent || "").includes("SQL 模式"));

    expect(sqlHealth).toBeDefined();
    expect(sqlHealth!.textContent || "").toContain("原生 JSON");
    expect(sqlHealth!.textContent || "").toContain("当前存储模式是原生 JSON");
    expect(sqlHealth!.textContent || "").toContain("不会影响原生 JSON 模式运行");
    expect(sqlHealth!.textContent || "").not.toContain("开发者检查");
    expect(
      sqlHealth!.classList.contains("acu-v2-dashboard-page__health-item--info"),
    ).toBe(true);
    expect(
      sqlHealth!.classList.contains(
        "acu-v2-dashboard-page__health-item--warning",
      ),
    ).toBe(false);

    mount.__resetAcuV2MountForTests();
  });

  it("开发者模式显示原生 JSON 下的 SQL 模板诊断", async () => {
    const settings = createSettings();
    const { mount } = await mountDashboardPage(settings, createSqlTableData(), {
      developerOptionsEnabled: true,
    });

    const sqlHealth = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    ).find((item) => (item.textContent || "").includes("SQL 模式"));

    expect(sqlHealth).toBeDefined();
    expect(sqlHealth!.textContent || "").toContain("开发者提示");
    expect(sqlHealth!.textContent || "").toContain("开发者检查发现");
    expect(sqlHealth!.textContent || "").toContain("选择“SQLite”");
    expect(
      sqlHealth!.classList.contains("acu-v2-dashboard-page__health-item--info"),
    ).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it("API 未配置时健康面板第一项给出最高优先级提醒并可跳到 API 页", async () => {
    const settings = createSettings();
    settings.apiPresets = [];
    settings.defaultApiPresetName = "";
    settings.apiConfig.useMainApi = false;
    const { mount } = await mountDashboardPage(settings);

    const healthItems = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    );
    expect(healthItems.length).toBeGreaterThanOrEqual(4);
    expect(healthItems[0].textContent || "").toContain("API");
    expect(healthItems[0].textContent || "").toContain("未配置");
    expect(healthItems[0].textContent || "").toContain(
      "API 页当前没有可用预设",
    );
    expect(healthItems[0].textContent || "").toContain("缺少端点、模型");

    const action = Array.from(
      healthItems[0].querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => (button.textContent || "").includes("配置 API"));
    expect(action).toBeDefined();
    action!.click();
    await Promise.resolve();

    const { useRouterStore } =
      await import("../../../src/presentation-v2/stores/router-store");
    expect(useRouterStore().activePageId).toBe("api");

    mount.__resetAcuV2MountForTests();
  });

  it("API 健康追踪 API 页当前预设，而不是填表专用 API", async () => {
    const settings = createSettings();
    settings.apiConfig.useMainApi = false;
    settings.tableApiPreset = "missing-table-only";
    const { mount } = await mountDashboardPage(settings);

    const healthItems = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-v2-dashboard-page__health-item",
      ),
    );
    const apiText = healthItems[0].textContent || "";
    expect(apiText).toContain('API 页当前预设 "table-fast" 已配置');
    expect(apiText).toContain("使用酒馆主 API");
    expect(
      healthItems[0].querySelector(".acu-v2-dashboard-page__health-meta"),
    ).toBeNull();
    expect(apiText).not.toContain("当前填表 API");
    expect(apiText).not.toContain("当前预设：");
    expect(apiText).not.toContain("连接：");
    expect(apiText).not.toContain("填表页指定");
    expect(apiText).not.toContain("missing-table-only");

    mount.__resetAcuV2MountForTests();
  });

  it("运行日志报错会在健康面板解释并统一跳转高级工具", async () => {
    const { mount } = await mountDashboardPage();
    const { pushLog } = await import("../../../src/shared/log-buffer");

    pushLog("error", ["[ACU]", "API请求失败: 500 bad gateway"]);
    await Promise.resolve();

    const page = document.querySelector(
      ".acu-v2-dashboard-page",
    ) as HTMLElement;
    expect(page.textContent || "").toContain("最近日志指向 API 配置或连接问题");
    expect(page.textContent || "").toContain("查看运行日志");

    const logAction = Array.from(
      page.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => (button.textContent || "").includes("查看运行日志"));
    expect(logAction).toBeDefined();
    logAction!.click();
    await Promise.resolve();

    const { useRouterStore } =
      await import("../../../src/presentation-v2/stores/router-store");
    expect(useRouterStore().activePageId).toBe("advanced-tools");

    mount.__resetAcuV2MountForTests();
  });

  it("运行日志 Warn 计数默认隐藏，仅开发者模式显示", async () => {
    const normal = await mountDashboardPage();
    let logBuffer = await import("../../../src/shared/log-buffer");

    logBuffer.pushLog("warn", ["[ACU]", "普通警告"]);
    await Promise.resolve();

    let pageText =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(pageText).toContain("本次前端会话没有记录到 Error 级别日志。");
    expect(pageText).not.toContain("Warn");

    normal.mount.__resetAcuV2MountForTests();

    const developer = await mountDashboardPage(createSettings(), createTableData(), {
      developerOptionsEnabled: true,
      warnLogEnabled: true,
    });
    logBuffer = await import("../../../src/shared/log-buffer");
    logBuffer.pushLog("warn", ["[ACU]", "开发者警告"]);
    await Promise.resolve();

    pageText =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(pageText).toContain("开发者模式下可见");
    expect(pageText).toContain("条 Warn");

    developer.mount.__resetAcuV2MountForTests();
  });

  it("交火模式开启但向量模型缺失时显示独立提醒", async () => {
    const settings = createSettings();
    settings.summaryVectorIndexModeDefault = true;
    const { mount } = await mountDashboardPage(settings);

    const text =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(text).toContain("交火向量");
    expect(text).toContain("配置不完整");
    expect(text).toContain("缺少“向量化URL”");
    expect(text).toContain("缺少“向量化模型名”");
    expect(text).not.toContain("embeddingEndpoint");
    expect(text).not.toContain("embeddingModel");
    expect(text).not.toContain(`服务${"地址"}`);
    expect(text).not.toContain(`模型${"名称"}`);
    expect(text).toContain("配置交火模式");

    mount.__resetAcuV2MountForTests();
  });

  it("飞行模式开关调用会话级入口，并在失败时展示可见错误", async () => {
    const { mount, enableFlightMode } = await mountDashboardPage();
    const toggle = document.querySelector('button[data-acu-toggle-key="flightMode"]') as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    toggle.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(enableFlightMode).toHaveBeenCalledOnce();
    expect(document.body.textContent || "").toContain("已开启当前会话的飞行模式。");

    mount.__resetAcuV2MountForTests();
  });

  it("修改自动填表开关会保存 settings", async () => {
    const { mount, settings, saveSettings } = await mountDashboardPage();

    const toggle = document.querySelector(
      'button[data-acu-toggle-key="autoUpdateEnabled"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(settings.autoUpdateEnabled).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it("切换到高级设置后显示高级开关、存储模式选择与开发者总开关", async () => {
    const { mount } = await mountDashboardPage();

    // 找到 segmented control 的"高级设置"按钮
    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    const advancedBtn = segmentedButtons.find(
      (b) => (b.textContent || "").trim() === "高级设置",
    );
    expect(advancedBtn).toBeDefined();
    advancedBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    const text =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(text).toContain("剧情推进");
    expect(text).toContain("智能续写");
    expect(text).toContain("世界推演");
    expect(text).toContain("外部导入");
    expect(text).toContain("交火模式");
    expect(text).toContain("存储模式");
    expect(text).toContain("原生 JSON");
    expect(text).toContain("SQLite");
    expect(text).toContain("兼容性最佳");
    expect(text).toContain("启用开发者选项");
    expect(text).not.toContain("启用SQL存储");
    expect(text).not.toContain("启用条件模板功能");
    expect(text).not.toContain("0TK 占用模式");
    expect(text).toContain("选择表格数据的保存方式");

    const visibleToggleKeys = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "button[data-acu-toggle-key]",
      ),
    ).map((button) => button.dataset.acuToggleKey);
    expect(visibleToggleKeys).toEqual([
      "plotEnabled",
      "continuationPageEnabled",
      "worldSimulationPageEnabled",
      "externalImportPageEnabled",
      "contentReplaceEnabled",
      "summaryVectorIndexModeEnabled",
      "developerOptionsEnabled",
    ]);

    const storageGroup = document.querySelector(
      'div[role="radiogroup"][aria-label="存储模式"]',
    );
    expect(storageGroup).not.toBeNull();
    expect(storageGroup!.closest(".acu-dashboard-storage-mode")).not.toBeNull();
    expect(
      storageGroup!.classList.contains("acu-dashboard-storage-mode__switch"),
    ).toBe(true);
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".acu-dashboard-storage-mode__card",
      ),
    );
    expect(cards).toHaveLength(2);
    expect(
      cards[0].classList.contains("acu-dashboard-storage-mode__card--active"),
    ).toBe(true);
    expect(
      cards[1].classList.contains("acu-dashboard-storage-mode__card--active"),
    ).toBe(false);
    expect(text.indexOf("启用开发者选项")).toBeLessThan(
      text.indexOf("存储模式原生SQL"),
    );

    mount.__resetAcuV2MountForTests();
  });

  it("修改流式输出开关会保存 settings", async () => {
    const { mount, settings, saveSettings } = await mountDashboardPage();

    const toggle = document.querySelector(
      'button[data-acu-toggle-key="streamingEnabled"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    toggle.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(settings.streamingEnabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it("高级设置里的存储模式选择会切换到 SQLite", async () => {
    const { mount, settings, saveSettings } = await mountDashboardPage();

    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    const advancedBtn = segmentedButtons.find(
      (b) => (b.textContent || "").trim() === "高级设置",
    );
    advancedBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    const page = document.querySelector(
      ".acu-v2-dashboard-page",
    ) as HTMLElement;
    const storageButtons = Array.from(
      page.querySelectorAll<HTMLButtonElement>(
        'div[role="radiogroup"][aria-label="存储模式"] button[role="radio"]',
      ),
    );
    expect(
      storageButtons.map((button) => (button.textContent || "").trim()),
    ).toEqual(["原生", "SQL"]);
    expect(
      storageButtons.map((button) => button.getAttribute("aria-checked")),
    ).toEqual(["true", "false"]);

    storageButtons[1].click();
    await new Promise((r) => setTimeout(r, 0));

    expect(settings.storageMode).toBe("sqlite");
    expect(
      storageButtons.map((button) => button.getAttribute("aria-checked")),
    ).toEqual(["false", "true"]);
    const cards = Array.from(
      page.querySelectorAll<HTMLElement>(".acu-dashboard-storage-mode__card"),
    );
    expect(
      cards.map((card) =>
        card.classList.contains("acu-dashboard-storage-mode__card--active"),
      ),
    ).toEqual([false, true]);
    expect(saveSettings).toHaveBeenCalled();
    expect(page.textContent || "").not.toContain("已切换到 SQLite 模式。");
    expect(document.body.textContent || "").toContain("已切换到 SQLite 模式。");

    mount.__resetAcuV2MountForTests();
  });

  it("关闭 v2 后清空 toast，重开不显示旧通知", async () => {
    const { mount } = await mountDashboardPage();

    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    segmentedButtons.find((b) => (b.textContent || "").trim() === "高级设置")!.click();
    await new Promise((r) => setTimeout(r, 0));

    const storageButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'div[role="radiogroup"][aria-label="存储模式"] button[role="radio"]',
      ),
    );
    storageButtons[1].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent || "").toContain("已切换到 SQLite 模式。");

    document.querySelector<HTMLButtonElement>(".acu-v2-app__close")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent || "").not.toContain("已切换到 SQLite 模式。");

    await mount.openAcuV2App();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent || "").not.toContain("已切换到 SQLite 模式。");

    mount.__resetAcuV2MountForTests();
  });

  it("存储模式切换失败时写日志并显示短 toast", async () => {
    const { mount } = await mountDashboardPage(createSettings(), createTableData(), {
      failStorageSwitch: true,
    });

    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    segmentedButtons.find((b) => (b.textContent || "").trim() === "高级设置")!.click();
    await new Promise((r) => setTimeout(r, 0));

    const storageButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'div[role="radiogroup"][aria-label="存储模式"] button[role="radio"]',
      ),
    );
    storageButtons[1].click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent || "").toContain("存储模式切换失败，详情见运行日志");
    const { getAllLogs } = await import("../../../src/shared/log-buffer");
    expect(getAllLogs().some((entry) => entry.message.includes("switch failed"))).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it("高级设置承载功能页开关，并控制对应一级页可见性", async () => {
    const { mount, settings } = await mountDashboardPage();

    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    const advancedBtn = segmentedButtons.find(
      (b) => (b.textContent || "").trim() === "高级设置",
    );
    expect(advancedBtn).toBeDefined();
    advancedBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    let text =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(text).toContain("剧情推进");
    expect(text).toContain("智能续写");
    expect(text).toContain("世界推演");
    expect(text).toContain("外部导入");
    expect(text).toContain("交火模式");
    expect(text).toContain("正文替换");

    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).not.toContain("剧情推进");
    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).toContain("智能续写");
    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).toContain("世界推演");
    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).toContain("外部导入");
    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).not.toContain("交火模式");

    const plotToggle = document.querySelector(
      'button[data-acu-toggle-key="plotEnabled"]',
    ) as HTMLButtonElement;
    const continuationToggle = document.querySelector(
      'button[data-acu-toggle-key="continuationPageEnabled"]',
    ) as HTMLButtonElement;
    const worldSimulationToggle = document.querySelector(
      'button[data-acu-toggle-key="worldSimulationPageEnabled"]',
    ) as HTMLButtonElement;
    const importToggle = document.querySelector(
      'button[data-acu-toggle-key="externalImportPageEnabled"]',
    ) as HTMLButtonElement;
    const vectorToggle = document.querySelector(
      'button[data-acu-toggle-key="summaryVectorIndexModeEnabled"]',
    ) as HTMLButtonElement;
    expect(plotToggle).not.toBeNull();
    expect(continuationToggle).not.toBeNull();
    expect(worldSimulationToggle).not.toBeNull();
    expect(importToggle).not.toBeNull();
    expect(vectorToggle).not.toBeNull();

    continuationToggle.click();
    worldSimulationToggle.click();
    importToggle.click();
    await Promise.resolve();

    expect(settings.continuationPageEnabled).toBe(false);
    expect(settings.worldSimulationPageEnabled).toBe(false);
    expect(settings.externalImportPageEnabled).toBe(false);
    text = document.querySelector(".acu-v2-sidebar")?.textContent || "";
    expect(text).not.toContain("功能");
    expect(text).not.toContain("智能续写");
    expect(text).not.toContain("世界推演");
    expect(text).not.toContain("外部导入");

    plotToggle.click();
    vectorToggle.click();
    await Promise.resolve();

    expect(settings.plotSettings.enabled).toBe(true);
    expect(settings.summaryVectorIndexModeDefault).toBe(true);
    text = document.querySelector(".acu-v2-sidebar")?.textContent || "";
    expect(text).toContain("剧情推进");
    expect(text).toContain("交火模式");
    expect(text).toContain("功能");

    mount.__resetAcuV2MountForTests();
  });

  it("正文替换开关常驻显示在外部导入下方，开启后才显示页面并启用功能", async () => {
    const settings = createSettings();
    settings.contentOptimizationSettings.enabled = false;
    const { mount } = await mountDashboardPage(settings);

    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    const advancedBtn = segmentedButtons.find(
      (b) => (b.textContent || "").trim() === "高级设置",
    );
    advancedBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    const text =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(text).not.toContain("功能开关");
    expect(text).toContain("正文替换");
    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).not.toContain("正文替换");
    expect(settings.contentOptimizationSettings.enabled).toBe(false);

    const visibleToggleKeys = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "button[data-acu-toggle-key]",
      ),
    ).map((button) => button.dataset.acuToggleKey);
    expect(visibleToggleKeys).toEqual([
      "plotEnabled",
      "continuationPageEnabled",
      "worldSimulationPageEnabled",
      "externalImportPageEnabled",
      "contentReplaceEnabled",
      "summaryVectorIndexModeEnabled",
      "developerOptionsEnabled",
    ]);

    const toggle = document.querySelector(
      'button[data-acu-toggle-key="contentReplaceEnabled"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    toggle.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(settings.contentOptimizationSettings.enabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(
      document.querySelector(".acu-v2-sidebar")?.textContent || "",
    ).toContain("正文替换");

    mount.__resetAcuV2MountForTests();
  });

  it("条件模板功能不再显示开关，并在刷新时保持开启", async () => {
    const settings = createSettings();
    settings.promptTemplateSettings.enabled = false;
    const { mount, saveSettings } = await mountDashboardPage(settings);

    const text =
      document.querySelector(".acu-v2-dashboard-page")?.textContent || "";
    expect(text).not.toContain("启用条件模板功能");
    expect(
      document.querySelector(
        'button[data-acu-toggle-key="promptTemplateEnabled"]',
      ),
    ).toBeNull();
    expect(settings.promptTemplateSettings.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });

  it("开发者总开关会写入 dev-options 持久化", async () => {
    const { mount } = await mountDashboardPage();

    const segmentedButtons = Array.from(
      document.querySelectorAll('button[role="radio"]'),
    ) as HTMLButtonElement[];
    const advancedBtn = segmentedButtons.find(
      (b) => (b.textContent || "").trim() === "高级设置",
    );
    advancedBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    const devToggle = document.querySelector(
      'button[data-acu-toggle-key="developerOptionsEnabled"]',
    ) as HTMLButtonElement;
    expect(devToggle).not.toBeNull();
    devToggle.click();
    await Promise.resolve();

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(persisted?.devOptions?.developerOptionsEnabled).toBe(true);

    mount.__resetAcuV2MountForTests();
  });
});
