export const dataMgmtCopy = {
  panels: {
    isolation: {
      title: "数据隔离（已退役）",
      description:
        "标签隔离已停用，留空即可。旧隔离码仅保留用于读取历史数据。",
    },
    backup: {
      title: "备份与恢复",
      description:
        "管理配置的备份、导入与导出。合并导入只覆盖提示词与模板，不改旧楼层；“特殊导出”带当前聊天表格数据，切去其他聊天前记得换回空模板以免串数据；Checkpoint 用于完整备份与恢复当前聊天表格和模板。同一 AI 楼层的不同 Swipe 分支共用同一份表格数据。",
      sqliteRuntime: {
        title: "SQLite 运行时诊断",
        description:
          "显示当前聊天的运行状态。重新初始化只重建内存数据，不会改动聊天、Checkpoint、模板或世界书。",
        reloadLabel: "重新初始化当前聊天 SQLite 运行时",
        reloadSuccess: "当前聊天 SQLite 内存运行时已重新初始化。",
        reloadDegraded: "SQLite 内存运行时重初始化后降级为 native；请查看脱敏状态快照。",
        reloadFailed: "SQLite 内存运行时重新初始化失败；请查看脱敏状态快照。",
        healthSnapshot: {
          status: "状态",
          expectedMode: "期望模式",
          activeMode: "实际模式",
          source: "加载来源",
          loadToken: "加载序号",
          failureCode: "失败代码",
          unavailable: "无",
        },
      },
    },
    cleanup: {
      title: "删除与清理",
      description:
        "用于清理当前聊天的本地表格数据，或将模板与提示词恢复默认，不影响聊天正文。自动保留策略在自动更新后清理旧楼层；删除按钮会立即按选定范围删除。",
    },
  },
};
