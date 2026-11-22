import type { StorageMode } from "../../shared/table-storage-provider";

export const dashboardCopy = {
  pageTitle: "仪表盘",
  panels: {
    healthTitle: "运行概览",
    healthDescription:
      "这里会显示当前聊天和已开功能正不正常。只有标为“需要处理”的项目才会影响使用；“未启用”或“待准备”不必理会。",
    togglesTitle: "开关",
    togglesDescription:
      "基础设置：随时可以开关；高级设置：调整后可能会影响运行，需谨慎修改。",
  },
  groups: {
    ariaLabel: "开关分组切换",
    basic: "基础设置",
    advanced: "高级设置",
  },
  developerToggle: {
    label: "启用开发者选项",
    description: "默认关闭。显示开发者页面，不推荐无经验用户启用。",
  },
  storage: {
    sectionLabel: "存储模式",
    description:
      "选择表格数据的存储模式。切换后会把填表提示词恢复成默认；要是填表异常，可切回原模式检查。",
    modeLabel(mode: StorageMode): string {
      return mode === "sqlite" ? "SQLite" : "原生 JSON";
    },
    optionDescription: {
      native: "兼容性高，适合基础表格。",
      sqlite: "准确率高，适合复杂表格与多表关联。",
    },
    switchLabel(mode: StorageMode): string {
      return mode === "sqlite" ? "SQL" : "原生";
    },
    badge(mode: StorageMode): string {
      return mode === "native" ? "兼容性最佳" : "适合复杂表";
    },
    switched(mode: StorageMode): string {
      return `已切换到 ${dashboardCopy.storage.modeLabel(mode)} 模式。`;
    },
    switchFailed: "存储模式切换失败。",
  },
  api: {
    title: "API",
    action: "配置 API",
    unavailableBadge: "不可用",
    unavailableSummary: "数据库没连接上酒馆，当前 API 状态无法确认。",
    unconfiguredBadge: "未配置",
    configuredBadge: "已配置",
    tavernPresetLabel(name: string): string {
      return `酒馆连接预设 ${name}`;
    },
    tavernPresetMissingLabel: "酒馆连接预设",
    tavernPresetMissingIssue: "未选择酒馆连接预设",
    mainApiLabel: "酒馆主 API",
    customApiLabel: "自定义 API",
    endpointField: "端点",
    modelField: "模型",
    missingIssue(fields: string): string {
      return `缺少${fields}`;
    },
    namedPresetNotReady(name: string, issue: string): string {
      return `API 页当前预设 "${name}" 还不能发起请求：${issue}。`;
    },
    noUsablePreset(issue: string): string {
      return `API 页当前没有可用预设，当前连接配置也不完整：${issue}。`;
    },
    namedPresetReady(name: string, statusLabel: string): string {
      return `API 页当前预设 "${name}" 已配置，使用${statusLabel}。`;
    },
    configReadyWithoutPreset(statusLabel: string): string {
      return `当前连接配置已配置，使用${statusLabel}，但还没有选中 API 预设。`;
    },
  },
  tableHealth: {
    title: "表格更新",
    noChatBadge: "未加载聊天",
    noChatSummary:
      "你现在没打开任何聊天窗口，无法读取表格。",
    notLoadedBadge: "待准备",
    notLoadedSummary(totalAi: number): string {
      return `当前聊天还没建好表格，等第一次填表后这里就会显示更新状态；目前已有 ${totalAi} 条 AI 回复。`;
    },
    updateSettingsAction: "查看填表工作台",
    statusAction: "查看表格状态",
    overdueBadge: "待更新",
    dueRowsDetail(count: number): string {
      return `${count} 张表已到触发点但最后更新楼层没有前进`;
    },
    initialDueRowsDetail(count: number): string {
      return `${count} 张表满足首次更新条件但尚未记录过更新`;
    },
    maxOverdueDetail(count: number): string {
      return `最大积压 ${count} 层`;
    },
    overdueSummary(issueCount: number, detail: string): string {
      return detail
        ? `已经有 ${issueCount} 张表到该更新的时候了，下次填表时会继续更新：${detail}。`
        : `已经有 ${issueCount} 张表到该更新的时候了，下次填表时会继续更新。`;
    },
    okBadge: "正常",
    okSummary(
      activeCount: number,
      totalAi: number,
      disabledCount: number,
    ): string {
      return activeCount
        ? `当前 ${activeCount} 张自动更新表没有积压；已有 ${totalAi} 条 AI 回复${disabledCount ? `，另有 ${disabledCount} 张表不参与自动更新` : ""}。`
        : `当前没有参与自动更新的表；已有 ${totalAi} 条 AI 回复。`;
    },
  },
  sqlHealth: {
    title: "SQL 模式",
    action: "查看表格模板",
    tableNameSamples(visibleNames: string, totalCount: number): string {
      return totalCount > 3
        ? `${visibleNames} 等 ${totalCount} 张表`
        : visibleNames;
    },
    noChatBadge: "未加载聊天",
    noChatSummary(sqlEnabled: boolean): string {
      return sqlEnabled
        ? "当前没有加载 SillyTavern 聊天，暂时无法检查当前聊天的表格模板是否适配。"
        : "当前没有加载 SillyTavern 聊天，暂时无法检查当前聊天的表格模板是否适配。";
    },
    pendingBadge: "待检查",
    disabledBadge: "未启用",
    noTemplatesSummary(sqlEnabled: boolean): string {
      return sqlEnabled
        ? "当前是 SQLite 模式，但还没加载表格模板。第一次填表前，请确认表格模板拥有 SQL 语法。"
        : "当前是原生 JSON 模式，但还没加载表格模板。继续使用原生 JSON 时不用删掉 SQL 语法。";
    },
    looksSqlBadge: "开发者提示",
    looksSqlSummary(ddlCount: number, total: number): string {
      return `当前是原生 JSON 模式，但表格模板里有 ${ddlCount}/${total} 张表包含 SQL 语法。想换 SQLite 模式可以去切换；继续使用原生 JSON 则无需理会。`;
    },
    nativeModeBadge: "原生 JSON",
    nativeModeSummary(total: number): string {
      return `当前存储模式是原生 JSON，已加载 ${total} 张表。模板中的 SQL 信息不会影响原生 JSON 模式运行；需要切换 SQLite 时再检查模板。`;
    },
    nativeMatchBadge: "模板适配",
    nativeMatchSummary(total: number): string {
      return `当前存储模式是原生 JSON，当前 ${total} 张表也都是普通表格模板，模式与模板适配。`;
    },
    missingDdlBadge: "模板未适配",
    missingDdlSummary(count: number, total: number, names: string): string {
      return `当前是 SQLite 模式，但有 ${count}/${total} 张表 SQL 语法不完整：${names}。请去“表格模板”里补齐，或切回原生 JSON。`;
    },
    invalidDdlBadge: "模板不适配",
    invalidDdlSummary(count: number, total: number, names: string): string {
      return `当前是 SQLite 模式，但有 ${count}/${total} 张表的 SQL 语法和表头不一致：${names}，可能导致写入失败，请先校准模板。`;
    },
    templateMatchBadge: "模板适配",
    templateMatchSummary(total: number): string {
      return `当前存储模式是 SQLite，当前 ${total} 张表都是适配 SQL 的表格模板，表结构也与表头一致。`;
    },
  },
  vectorHealth: {
    title: "交火向量",
    configureAction: "前往填表模式",
    disabledBadge: "未启用",
    disabledSummary: "当前填表模式用不到向量服务，无需配置。",
    incompleteBadge: "配置不完整",
    incompleteSummary(errors: string[]): string {
      return errors.length
        ? `当前填表模式需要向量服务，但它还不能正常使用：${errors.join("；")}。`
        : "当前填表模式需要向量服务，但它还不能正常使用。";
    },
    configuredBadge: "已配置",
    configuredSummary:
      "当前填表模式需要向量服务，向量服务已配置完整。",
    readFailedBadge: "读取失败",
    readFailedSummary(message: string): string {
      return `交火向量配置读取失败：${message}。`;
    },
    readFailedFallback: "请到填表工作台重新检查向量服务配置",
    missingEmbeddingEndpoint: "缺少“向量化URL”",
    missingEmbeddingModel: "缺少“向量化模型名”",
    rerankPairRequired: "“重排 URL”和“重排模型名”必须同时填写，或同时留空。",
  },
  logs: {
    title: "运行日志",
    action: "查看运行日志",
    noErrorBadge: "无报错",
    noErrorSummary(warnCount: number, showDeveloperDiagnostics = false): string {
      return showDeveloperDiagnostics && warnCount
        ? `本次前端会话没有记录到 Error 级别日志；开发者模式下可见 ${warnCount} 条 Warn。`
        : "本次前端会话没有记录到 Error 级别日志。";
    },
    errorBadge(errorCount: number): string {
      return `${errorCount} 条报错`;
    },
    errorSummary(
      reason: string,
      errorCount: number,
      warnCount: number,
      tag: string,
    ): string {
      return `${reason}本次前端会话累计 ${errorCount} 条 Error、${warnCount} 条 Warn，最近一条来自 ${tag}。`;
    },
    apiIssue: "最近报错指向 API 配置或连接问题，填表请求可能没发出去。",
    outputFormatIssue:
      "最近报错指向填表输出格式问题，AI 返回的内容没被识别成有效改表指令。",
    commandParseIssue: "最近报错指向填表指令解析问题，可能有部分修改没生效。",
    sqlIssue:
      "最近报错指向 SQL 语法或表结构问题，请检查表格模板、列名和 SQL 填表提示词。",
    saveIssue: "最近报错指向保存失败，表格虽已修改，但没成功保存进聊天记录。",
    genericError: "运行日志中有报错，请去高级工具查看具体内容。",
    genericWarning: "运行日志中有警告，请去高级工具确认是否需要处理。",
  },
  tableStatus: {
    none: "无",
    notInitialized: "未初始",
    pendingInitial: "待初始",
  },
  toggles: {
    takeover: { label: "启用数据库接管", description: "数据库总开关。关闭后暂停所有功能并保留原配置。" },
    autoUpdate: {
      label: "自动更新",
      description:
        "默认开启。关闭后无法自动更新，只能手动更新表格。",
    },
    silentMode: {
      label: "静默模式",
      description:
        "默认关闭。开启后不再弹出任何弹窗，报错仅会写入日志。",
    },
    desktopPet: {
      label: "桌面宠物",
      description:
        "默认开启。开启后通知弹窗会出现在桌宠身边。",
    },
    deskPetJokes: {
      label: "冷笑话插播",
      description:
        "默认开启。桌宠空闲时会插播冷笑话。",
    },
    deskPetRealWork: {
      label: "显示真实工作内容",
      description:
        "默认关闭。开启后弹窗直接显示正常任务进度，不再显示“正在XXXX…”状态词。",
    },
    zeroTk: {
      label: "0TK 占用模式",
      description: "默认开启。开启后纪要概览不占用上下文。",
    },
    streaming: {
      label: "开启流式输出",
      description:
        "开启后会进行流式生成；关闭后则是直接完整输出结果。",
    },
    continuation: {
      label: "智能续写",
      description: "手动功能。代替你自动发送提示词，让 AI 持续续写。",
    },
    worldSimulation: {
      label: "格林推演",
      description: "自动推演主角看不见的幕后变化，确认后能把角色能察觉到的场外信号写进正文。",
    },
    externalImport: {
      label: "外部导入",
      description:
        "手动功能。将 TXT 转换为世界书条目，方便制作角色卡。",
    },
    contentReplace: {
      label: "正文替换",
      description:
        "默认关闭。开启后每轮正文生成完，会自动检查并优化 AI 回复。",
    },
  },
  templatePreset: {
    defaultName: "默认预设",
    globalScope: "全局",
    readFailed: "读取失败",
  },
};
