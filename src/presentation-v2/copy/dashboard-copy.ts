import type { StorageMode } from "../../shared/table-storage-provider";

export const dashboardCopy = {
  pageTitle: "仪表盘",
  panels: {
    healthTitle: "运行概览",
    healthDescription:
      "这里显示当前聊天和已开启功能的状态。只有标为“需要处理”的项目才会影响使用；未启用或待准备通常不需要操作。",
    togglesTitle: "开关",
    togglesDescription:
      "基础设置：当前聊天中可随时开关的功能。高级设置：调整后可能影响数据库运行，请谨慎修改。",
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
      "选择表格数据的保存方式。切换会重置填表提示词。填表异常时，可切回原模式检查。",
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
    unavailableSummary: "插件还没有拿到酒馆侧运行接口，当前 API 状态无法确认。",
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
      "当前没有加载 SillyTavern 聊天，暂时无法读取对应数据库表格或计算自动更新楼层。",
    notLoadedBadge: "待准备",
    notLoadedSummary(totalAi: number): string {
      return `当前聊天还没有加载数据库表格。第一次填表或初始化后，这里会自动显示更新状态；当前已有 ${totalAi} 条 AI 回复。`;
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
        ? `${issueCount} 张表已经满足自动更新条件，后续填表或手动检查时会继续处理：${detail}。`
        : `${issueCount} 张表已经满足自动更新条件，后续填表或手动检查时会继续处理。`;
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
        ? "当前存储模式是 SQLite，还没有加载表格模板。第一次填表前，请确认模板已经补好 SQL 表结构信息。"
        : "当前存储模式是原生 JSON，还没有加载表格模板。继续使用原生 JSON 时无需处理 SQL 模板信息。";
    },
    looksSqlBadge: "开发者提示",
    looksSqlSummary(ddlCount: number, total: number): string {
      return `当前存储模式是原生 JSON，开发者检查发现 ${ddlCount}/${total} 张表包含 SQL 结构信息。若要使用 SQLite，请在高级设置里选择“SQLite”；继续使用原生 JSON 时通常无需处理。`;
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
      return `当前存储模式是 SQLite，但 ${count}/${total} 张表还不是完整的 SQL 模板：${names}。这些表可能无法正确保存到 SQLite，请到“表格模板”补齐 SQL 表结构信息，或切回原生 JSON。`;
    },
    invalidDdlBadge: "模板不适配",
    invalidDdlSummary(count: number, total: number, names: string): string {
      return `当前存储模式是 SQLite，但 ${count}/${total} 张表的 SQL 表结构信息与表头不一致：${names}。这可能导致数据写入失败，请先校准模板。`;
    },
    templateMatchBadge: "模板适配",
    templateMatchSummary(total: number): string {
      return `当前存储模式是 SQLite，当前 ${total} 张表都是适配 SQL 的表格模板，表结构也与表头一致。`;
    },
  },
  vectorHealth: {
    title: "交火向量",
    configureAction: "配置交火模式",
    disabledBadge: "未启用",
    disabledSummary: "交火模式是可选增强，未开启时不会影响基础数据库更新。",
    incompleteBadge: "配置不完整",
    incompleteSummary(errors: string[]): string {
      return errors.length
        ? `交火模式已开启，但向量服务还不能正常使用：${errors.join("；")}。`
        : "交火模式已开启，但向量服务还不能正常使用。";
    },
    configuredBadge: "已配置",
    configuredSummary:
      "交火模式已开启，必填的向量化服务已经配置完整。重排服务属于可选增强，未填写也不会阻止使用。",
    readFailedBadge: "读取失败",
    readFailedSummary(message: string): string {
      return `交火向量配置读取失败：${message}。`;
    },
    readFailedFallback: "请进入交火模式页重新检查配置",
    missingEmbeddingEndpoint: "缺少“向量化URL”",
    missingEmbeddingModel: "缺少“向量化模型名”",
    rerankPairRequired: "“重排URL”和“重排模型名”需要同时填写，或者同时留空",
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
    apiIssue: "最近日志指向 API 配置或连接问题，填表请求可能没有成功发出。",
    outputFormatIssue:
      "最近日志指向填表输出格式问题，模型返回内容可能没有被识别为有效表格修改。",
    commandParseIssue: "最近日志指向填表指令解析问题，部分修改可能没有应用。",
    sqlIssue:
      "最近日志指向 SQL 或表结构问题，请检查表格模板、列名和 SQL 填表提示词。",
    saveIssue: "最近日志指向保存失败，表格可能生成了修改但没有写回聊天记录。",
    genericError: "运行日志中有报错，请去高级工具查看具体内容。",
    genericWarning: "运行日志中有警告，请去高级工具确认是否需要处理。",
  },
  tableStatus: {
    none: "无",
    notInitialized: "未初始",
    pendingInitial: "待初始",
  },
  toggles: {
    flightMode: {
      label: "飞行模式",
      description: "仅对当前会话生效。开启后抑制剧情推进，并在大总结新增时隐藏已归纳纪要。",
      enableFailed: "飞行模式未开启",
      enabled: "已开启当前会话的飞行模式。",
      disableTitle: "关闭飞行模式",
      disableMessage: "关闭后，当前会话的隐藏纪要会恢复可见。",
      disableDanger: "将跨全部历史永久删除「大总结」表及其内容；此操作不可逆。",
      confirmDisable: "关闭并永久删除",
      disableFailed: "飞行模式未关闭",
      disabled: "已关闭飞行模式，并已永久删除大总结表。",
      templateScopeChangedTitle: "检测到模板已修改",
      templateScopeChangedMessage: "飞行模式启用后，此会话的表格模板已被修改。继续关闭会按启用前归档模板恢复，并覆盖这些模板修改。",
      templateScopeChangedDanger: "关闭飞行模式会跨全部历史永久删除「大总结」表及其内容；此操作不可逆。",
      confirmDisableLabel: "仍要关闭并删除",
      disabledNoChat: "请先加载一个聊天会话。",
    },
    autoUpdate: {
      label: "自动更新",
      description:
        "默认开启。关闭后需手动更新表。仅推荐在测试或自由发挥时关闭。",
    },
    toastMute: {
      label: "静默提示框",
      description:
        "默认关闭。开启后仅保留填表、规划等核心提示，其他浮窗通知不再弹出。",
    },
    streaming: {
      label: "开启流式输出",
      description:
        "开启后，支持流式的文本生成会边生成边返回；关闭后会等完整结果返回。",
    },
    zeroTk: {
      label: "0TK 占用模式",
      description: "默认开启。开启后纪要概览不占用上下文。",
    },
    plot: {
      label: "剧情推进",
      description:
        "默认开启。详情前往对应页面；默认仅召回记忆，进阶版含剧情规划。仅推荐在测试或自由发挥时关闭。",
    },
    continuation: {
      label: "智能续写",
      description: "手动功能。代替你自动发送提示词，AI 根据内容持续续写。",
    },
    worldSimulation: {
      label: "世界推演",
      description: "审计世界账本、阶段计划与证据，并在确认后把安全 guidance 投影到正文。",
    },
    externalImport: {
      label: "外部导入",
      description:
        "手动功能。将 TXT 小说快速转为未精修的世界书条目，方便制作角色卡。",
    },
    contentReplace: {
      label: "正文替换",
      description:
        "默认关闭。开启后每轮正文生成后会自动检查并优化 AI 回复的正文内容。",
    },
    vector: {
      label: "交火模式",
      description:
        "默认关闭。详情前往对应页面，增强记忆召回效果。需配置向量API服务。",
    },
  },
  templatePreset: {
    defaultName: "默认预设",
    globalScope: "全局",
    readFailed: "读取失败",
  },
};
