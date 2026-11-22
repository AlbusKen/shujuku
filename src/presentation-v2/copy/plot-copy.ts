export const plotCopy = {
  pageTitle: "剧情推进",
  unsupported: (modeLabel: string) => `当前填表模式为「${modeLabel}」，不支持也不需要剧情推进。`,
  nav: { settings: "剧情推进", preset: "剧情推进预设", worldbook: "剧情推进世界书" },
  controls: {
    title: "剧情推进",
    description: "LLM模型逻辑召回模式与交火模式依赖剧情推进在正文生成前分析记忆。关闭后保留表格召回，不再执行剧情规划。",
    enableLabel: "启用剧情推进",
    enableHint: "关闭后写正文前不再额外调用 AI，其它记忆功能不变。",
    disguiseDisabledLabel: "解除发送伪装",
    disguiseDisabledHint: "默认关闭。开启后你发的话会留在输入框里等剧情推进跑完再发，不显示临时楼层；失败或手动终止则取消发送。",
  },
  panels: {
    preset: {
      title: "剧情推进预设",
      description:
        "下拉框切换剧情推进预设，点星标设为全局默认。内置默认预设不能直接改，请用“从默认新建”。一套预设可包含多个任务，支持同时或按顺序运行。",
    },
    worldbook: {
      title: "剧情推进世界书",
      description:
        "剧情推进参考的世界书，默认跟随角色卡主世界书，也可手动指定。开启 Agent 模式后，由 Agent 决定放行哪些世界书条目。",
    },
  },
  worldbook: {
    emptyDefault: "所选世界书中无可显示的条目。",
    emptyCharacter:
      "未找到角色卡世界书。打开聊天后会显示条目，也可手动选一本。",
    emptyManual: "请先选择一本世界书。",
  },
  agentControl: {
    title: "Agent 世界书总控",
    description: "切换 Agent 接管状态。开启后由 Agent 决定放行哪些世界书条目；点“清理并初始化”会还原世界书并关闭接管。",
    modes: { disabled: "关闭", passive: "仅观察", agent: "Agent 接管" },
    modeChanged: {
      disabled: "Agent 世界书模式已关闭。",
      passive: "Agent 世界书已切换为仅观察模式。",
      agent: "Agent 世界书已切换为接管模式。",
    },
    status: {
      inactive: "运行时过滤未启用",
      active: () => "运行时过滤已启用",
    },
    config: {
      status: (state: { source: string; bookName?: string; writableBookName?: string; reason?: string }) => {
        if (state.source === "worldbook" && state.bookName) return `配置保存在世界书：${state.bookName}`;
        if (state.source === "legacy_settings") {
          return state.writableBookName
            ? `正在使用旧全局配置；下次保存会写入世界书：${state.writableBookName}`
            : "正在使用旧全局配置；当前未找到可写世界书，无法保存为卡级配置。";
        }
        if (state.writableBookName) return `当前使用默认配置；保存后写入世界书：${state.writableBookName}`;
        return "当前使用默认配置；未找到可写世界书，无法保存卡级 Agent 配置。";
      },
      saveFailed: (reason: string) => reason === "no_config_host_book"
        ? "未找到可写世界书，卡级 Agent 配置未保存。"
        : `卡级 Agent 配置保存失败：${reason || "未知原因"}`,
    },
    apiPresets: {
      decisionLabel: "Agent 决策 API",
      decisionHint: "供 Agent 挑选世界书条目使用的 API，留空则用当前 API。",
      skillLabel: "Agent Skill 化 API",
      skillHint: "供“一键 Skill 化”生成条目简介使用的 API，留空则用当前 API。",
      followCurrentLabel: "使用当前 API 配置",
    },
    restore: {
      button: "清理并初始化",
      confirm: {
        title: "清理并初始化 Agent 世界书状态",
        message: "恢复被 Agent 改过的世界书条目，关闭 Agent 模式，并清掉内部记录，下次使用会重新初始化。",
        confirmLabel: "确认清理并初始化",
        cancelLabel: "取消",
      },
      success: () => "已清理并初始化 Agent 世界书状态；Agent 模式已关闭，下次使用时会重新初始化。",
      noop: "没有需要恢复的 Agent 快照或内部状态；Agent 模式已关闭。",
      error: "清理并初始化 Agent 世界书状态失败",
      reasons: {
        runtime_filter_only: "当前使用运行时过滤机制，没有需要恢复的世界书条目状态；Agent 模式已关闭。",
        legacy_artifacts_cleaned: "已清理 Agent 内部条目与旧版本残留状态；Agent 模式已关闭。",
        native_worldbook_trigger_restored: "已按快照恢复被 Agent 改写的世界书条目状态，并关闭 Agent 模式。",
        native_worldbook_trigger_restore_failed: "部分世界书条目恢复失败，已保留 Agent 快照以避免永久丢失；Agent 模式已关闭。",
        native_worldbook_trigger_restore_skipped: "部分世界书条目存在冲突，已保留 Agent 快照以避免永久丢失；Agent 模式已关闭。",
        no_active_snapshot: "没有可恢复的 Agent 快照；Agent 模式已关闭。",
      } as Record<string, string>,
    },
    skillify: {
      button: "一键 Skill 化",
      confirm: {
        title: "一键生成 Skill 元数据",
        message: "调用 API 为勾选的世界书条目批量生成用途说明和触发时机，已写过的条目会自动跳过。",
        confirmLabel: "开始生成",
        cancelLabel: "取消",
      },
      success: (updated: number, skipped: number) => `Skill 化完成：更新 ${updated} 条，跳过 ${skipped} 条。`,
      partial: (updated: number, skipped: number, failed: number) => `Skill 化部分完成：更新 ${updated} 条，跳过 ${skipped} 条，失败 ${failed} 条。`,
      noSelection: "请先勾选要 Skill 化的世界书条目。",
      noCandidates: "当前范围没有可 Skill 化的世界书条目。",
      error: "一键 Skill 化失败",
    },
    clearSkillMeta: {
      button: "清除 Skill 化",
      confirm: {
        title: "清除世界书 Skill 元数据",
        message: "删除勾选条目的 Skill 简介信息，不会删除世界书正文，也不影响其它配置。",
        confirmLabel: "确认清除",
        cancelLabel: "取消",
      },
      success: (cleared: number) => `已清除 ${cleared} 条世界书 Skill 元数据。`,
      partial: (cleared: number, skipped: number, failed: number) => `Skill 元数据清除部分完成：清除 ${cleared} 条，跳过 ${skipped} 条，失败 ${failed} 条。`,
      noop: "当前 Agent 世界书范围内没有可清除的 Skill 元数据。",
      error: "清除 Skill 元数据失败",
    },
    advanced: {
      button: "Agent 高级设置",
      title: "Agent 世界书高级设置",
      description: "编辑 Agent 相关提示词，并调整上下文层数、候选上限和同时请求数。",
    },
    decisionSettings: {
      title: "Agent 决策执行参数",
      description: "把世界书条目拆成多批同时分析。开得越高越快，但请求次数和消耗也会成倍增加。",
      concurrency: {
        label: "Agent 决策并发数",
        hint: "默认 1。调大后分批同时分析条目，并按比例分摊绿灯 Token 预算，合并后仍按总上限校验。",
      },
    },
    skillifySettings: {
      title: "Skill 化执行参数",
      description: "控制一键 Skill 化的执行速度。同时处理数越高越快，但也越容易触发 API 限流。",
      maxConcurrency: {
        label: "Skill 化 API 并发数",
        hint: "一键 Skill 化同时处理的条目数，默认 3。",
      },
    },
    executionMode: {
      label: "Agent 与剧情推进执行方式",
      hint: "串行模式由 Agent 全权接管剧情任务和世界书绿灯；并发模式下剧情任务按原规则跑，Agent 只负责正文的世界书绿灯判断。",
      options: {
        sequential: "串行接管",
        concurrent: "并发旁路",
      },
    },
    contextSettings: {
      title: "上下文参数",
      description: "控制 Agent 决策、Skill 化和世界书扫描的范围。数值设太大既增加 API 消耗，也可能超出模型上限。",
      resetButton: "恢复默认上下文参数",
      resetSuccess: "已恢复默认上下文参数。",
      fields: {
        decisionRecentContextCharLimit: {
          label: "最近上下文层数",
          hint: "发给 Agent 参考的最近对话轮数（1 轮 = 1 条用户输入 + 1 条 AI 回复）。",
        },
        decisionWorldbookCandidateLimit: {
          label: "决策世界书候选数",
          hint: "每次最多提供多少条世界书给 Agent 挑选（只传名称和简介，不传正文）。",
        },
        skillifyMaxEntries: {
          label: "Skill 化最大条目数",
          hint: "一键 Skill 化单次最多处理多少条世界书。",
        },
        plotWorldbookScanMessageLimit: {
          label: "剧情世界书扫描消息数",
          hint: "剧情推进扫描世界书时往前看几条聊天消息。",
        },
        agentAiMaxRetries: {
          label: "Agent AI 最大尝试次数",
          hint: "Agent 和 Skill 化调用失败时的最大重试次数，设太高只会增加消耗。",
        },
        greenlightMinTkBudget: {
          label: "绿灯最小 TK 预算",
          hint: "Agent 挑绿灯条目的参考字数下限，避免选得过少，但不会强塞无关条目。",
        },
        greenlightMaxTkBudget: {
          label: "绿灯最大 TK 预算",
          hint: "每个通道/任务可放行的绿灯条目 Token 上限，防止超出预算。",
        },
      },
    },
    prompts: {
      title: "提示词模板",
      description: "支持使用内置占位符，写错不会生效，请勿随意改动。",
      scopeHint: "编辑先存为草稿。“保存到当前世界书”只改当前这本；“保存为全局模板”只改全局模板，不影响当前世界书。",
      unsavedChanges: "提示词草稿存在未保存修改。关闭将放弃这些修改。",
      scopeChanged: "底层 Agent 配置已发生变化，当前草稿可能属于旧角色或旧世界书。为防止误写，保存已锁定；请关闭并放弃草稿后重新打开。",
      loadingNotReady: "Agent 世界书配置仍在加载，请稍候。加载完成前不会接受编辑或保存。",
      loadFailed: "Agent 世界书配置读取失败。为避免默认值覆盖已保存配置，编辑与保存已锁定。",
      retryLoad: "重新读取配置",
      saveCurrent: "保存到当前世界书",
      saveCurrentSuccess: "已保存到当前世界书。",
      saveAsGlobal: "保存为全局模板",
      saveAsGlobalSuccess: "已保存到全局模板，当前世界书未变更。",
      decisionTitle: "Agent 决策提示词",
      decisionReset: "载入内置默认决策提示词",
      decisionResetSuccess: "已载入内置默认决策提示词；点击保存后才会写入选定作用域。",
      skillifyTitle: "Agent Skill 化提示词",
      skillifyReset: "载入内置默认 Skill 化提示词",
      skillifyResetSuccess: "已载入内置默认 Skill 化提示词；点击保存后才会写入选定作用域。",
      emptyText: "暂无提示词段。",
    },
  },
};
