export const plotCopy = {
  pageTitle: "剧情推进",
  unsupported: (modeLabel: string) => `当前填表模式为「${modeLabel}」，不支持也不需要剧情推进。`,
  nav: { settings: "剧情推进", preset: "剧情推进预设", worldbook: "剧情推进世界书" },
  controls: {
    title: "剧情推进",
    description: "LLM模型逻辑召回模式与交火模式依赖剧情推进在正文生成前分析记忆。关闭后保留表格召回，不再执行剧情规划。",
    enableLabel: "启用剧情推进",
    enableHint: "关闭后不再在正文生成前额外调用 LLM；当前模式的其余召回行为不变。",
    disguiseDisabledLabel: "解除发送伪装",
    disguiseDisabledHint: "默认关闭。开启后原文停留在输入框等待剧情 AI 返回，再写入最终提示词；不显示临时用户楼层和思考楼层。最终发送仍受交接保护。",
  },
  panels: {
    preset: {
      title: "剧情推进预设",
      description:
        "下拉框切换当前的预设，星标设为全局默认。点击按钮，可导入新预设、管理全部预设。内置默认预设无法修改，请使用「从默认新建」。预设包含多个独立任务，支持并发或串行。",
    },
    worldbook: {
      title: "剧情推进世界书",
      description:
        "剧情推进参考的世界书条目。默认跟随角色卡主世界书，也可手动指定。Agent 模式会在运行时过滤提示词模板中的世界书条目，由 Agent 决策剧情、填表与正文通道的放行条目。",
    },
  },
  worldbook: {
    emptyDefault: "所选世界书中无可显示的条目。",
    emptyCharacter:
      "未解析到角色卡世界书。打开聊天后会显示条目；也可手动选择一本。",
    emptyManual: "请先选择一本世界书。",
  },
  agentControl: {
    title: "Agent 世界书总控",
    description: "切换 Agent 世界书模式；Agent 模式会在剧情推进时接管世界书条目的放行与过滤，清理并初始化会恢复快照并关闭 Agent 模式。",
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
      decisionHint: "用于 Agent 判断世界书条目是否应启用；留空则使用当前 API 配置。",
      skillLabel: "Agent Skill 化 API",
      skillHint: "用于一键生成世界书 Skill 元数据；留空则使用当前 API 配置。",
      followCurrentLabel: "使用当前 API 配置",
    },
    restore: {
      button: "清理并初始化",
      confirm: {
        title: "清理并初始化 Agent 世界书状态",
        message: "将先按快照恢复被 Agent 改写的世界书条目状态，关闭 Agent 模式，然后删除 Agent 快照/设置内部条目。下次使用时会重新初始化。",
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
        message: "将调用配置的 Agent Skill API，为当前世界书范围内可处理条目生成描述与触发时机。已有 Skill 元数据的条目会自动跳过，无论这些数据来自 AI 生成还是用户手动编辑。",
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
        message: "将删除当前 Agent 世界书范围内条目的 Skill 元数据块。此操作不会恢复接管状态，也不会删除世界书条目正文或 Agent 配置条目。",
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
      description: "编辑 Agent 决策、Skill 化提示词模板，并控制上下文层数、候选数量上限与各自独立的调用并发。",
    },
    decisionSettings: {
      title: "Agent 决策执行参数",
      description: "将当前接管条目分片后并发分析。请求数和最坏重试数会随并发数放大，别把 API 当免费算力池。",
      concurrency: {
        label: "Agent 决策并发数",
        hint: "默认 1，页面不设固定上限；实际并发不会超过可分析的条目数。条目按实际非空分片并发分析，绿灯最小与最大 TK 预算都会精确拆分并交给各分片辅助选择；合并后仍按完整最大预算做安全校验。",
      },
    },
    skillifySettings: {
      title: "Skill 化执行参数",
      description: "控制一键 Skill 化的执行行为。并发数越高，请求压力越大；别把 API 当成无限吞吐的黑洞。",
      maxConcurrency: {
        label: "Skill 化 API 并发数",
        hint: "一键 Skill 化同时调用 Agent Skill API 的条目数量。默认 3，页面不设固定上限；实际并发不会超过待处理条目数。",
      },
    },
    executionMode: {
      label: "Agent 与剧情推进执行方式",
      hint: "串行模式保持 Agent 接管剧情任务与剧情世界书绿灯；并发模式下 Agent 不决定哪些剧情任务生效，剧情任务也按非 Agent 模式读取世界书，只保留正文绿灯判断。",
      options: {
        sequential: "串行接管",
        concurrent: "并发旁路",
      },
    },
    contextSettings: {
      title: "上下文参数",
      description: "这些参数会影响 Agent 决策、世界书 Skill 化和剧情世界书扫描。页面不设固定上限；过大的候选数、上下文、重试次数或预算会放大 API 消耗，并可能超过模型与服务能力。",
      resetButton: "恢复默认上下文参数",
      resetSuccess: "已恢复默认上下文参数。",
      fields: {
        decisionRecentContextCharLimit: {
          label: "最近上下文层数",
          hint: "进入 Agent 决策提示词的最近对话层数；1 层 = 1 条 AI 回复 + 其上方 1 条用户输入。剧情推进记录保存在用户楼层，会随对应上下文一起传入。",
        },
        decisionWorldbookCandidateLimit: {
          label: "决策世界书候选数",
          hint: "进入 Agent 决策提示词的世界书候选条目最大数量。候选只包含条目名称、关键词、描述和触发时机，不再携带正文预览。",
        },
        skillifyMaxEntries: {
          label: "Skill 化最大条目数",
          hint: "一键 Skill 化单次最多处理的世界书条目数量。",
        },
        plotWorldbookScanMessageLimit: {
          label: "剧情世界书扫描消息数",
          hint: "剧情推进读取世界书内容时回看的聊天消息数量；未显式保存旧配置时仍回退原 contextTurnCount。",
        },
        agentAiMaxRetries: {
          label: "Agent AI 最大尝试次数",
          hint: "Agent 决策与一键 Skill 化的公共 AI 调用尝试次数。设置过高会放大请求量，不会让烂提示词自动变聪明。",
        },
        greenlightMinTkBudget: {
          label: "绿灯最小 TK 预算",
          hint: "Agent 选择绿灯条目时的目标下限。并发决策时按实际非空分片数精确拆分，用于提示各分片不要选得过少；不会为了凑下限强塞无关条目。",
        },
        greenlightMaxTkBudget: {
          label: "绿灯最大 TK 预算",
          hint: "Agent 每个通道、每个剧情任务可选择的绿灯条目 TK 上限。并发决策时按实际非空分片数精确拆分并直接交给各分片辅助选择；合并后仍按完整上限做安全校验。",
        },
      },
    },
    prompts: {
      title: "提示词模板",
      description: "可使用 {{agent.*}} 与 {{agent.skillify.*}} 占位符。未知占位符会原样保留，写错了模型不会替你变聪明。",
      scopeHint: "编辑仅修改本次草稿。保存到当前世界书只更新当前配置；保存为全局模板只更新全局模板，不会改写当前世界书。",
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
