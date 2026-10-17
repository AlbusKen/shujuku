export const formFillCopy = {
  nav: {
    status: "表格状态",
    update: "自动更新",
    manual: "手动填表",
    filter: "标签筛选",
    prompt: "提示词",
  },
  panels: {
    status: {
      title: "表格状态",
      description:
        "查看表格更新进度。更新中断时，可依据「上次更新」调整「自动更新设置」。",
    },
    update: {
      title: "自动更新设置",
      description: "控制自动填表的各项参数。正常情况下不必手动修改高级参数。",
    },
    filter: {
      title: "标签筛选",
      description:
        "按标签提取内容，提升填表准确性。提取仅保留指定范围，排除移除指定范围。",
    },
    prompt: {
      title: "填表提示词",
      description:
        "控制AI如何理解与写入表格。建议保持默认或导入他人的填表提示词，不建议手动修改。",
    },
    manual: {
      title: "手动填表",
      description:
        "可以按指定范围重填所选表，也可以把每张表上次填完之后还没填的内容补上。填表 API 使用「自动更新设置」中的配置。",
      runLabel: "执行手动填表",
      catchUpLabel: "一键追平还没填的内容",
      catchUpBusyLabel: "正在补齐…",
      catchUpBoundary:
        "只会补每张表上次填完之后的新内容，已经填好的部分不会重填。",
      syncPending: "补填的数据已保存，但世界书还没同步好。",
      syncRetryLabel: "仅同步重试",
    },
  },
};
