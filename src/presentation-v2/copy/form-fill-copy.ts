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
        "查看表格更新进度。更新中断时，可根据“上次更新”去调整“自动更新设置”。",
    },
    update: {
      title: "自动更新设置",
      description: "控制自动填表的各项参数。正常情况下不用改高级参数。",
    },
    filter: {
      title: "标签筛选",
      description:
        "按标签筛选内容，提升填表准确率。提取只保留指定范围，排除会去掉指定范围。",
    },
    prompt: {
      title: "填表提示词",
      description:
        "控制 AI 如何理解并写入表格。建议保持默认或导入他人的填表提示词，不建议手动修改。",
    },
    manual: {
      title: "手动填表",
      description:
        "可按指定范围重填所选表格，或一键补齐之前漏填的内容。使用“自动更新设置”里的 API。",
      runLabel: "执行手动填表",
      catchUpLabel: "一键追平还没填的内容",
      catchUpBusyLabel: "正在补齐…",
      catchUpBoundary:
        "只补每张表上次之后的新内容，已填好的不会重填。",
      syncPending: "补填的数据已保存，但世界书还没同步成功。",
      syncRetryLabel: "仅同步重试",
    },
  },
};
