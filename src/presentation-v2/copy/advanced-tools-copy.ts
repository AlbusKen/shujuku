export const advancedToolsCopy = {
  nav: {
    sql: "SQL 控制台",
    logs: "运行日志",
  },
  panels: {
    sql: {
      title: "SQL 控制台",
      description:
        "直接在当前聊天数据库执行 SQLite 运行库。执行报错时先检查结果区，再确认表名、列名和当前聊天是否已经加载表格。",
    },
    logs: {
      title: "运行日志",
      description:
        "查看数据库运行日志。各 API 渠道的请求与结果默认采集，无需开启 Debug；宿主包装调用记录可见参数与返回值，不代表最终网络请求。认证信息隐藏，但日志含完整提示词与回复，分享或导出前请检查隐私。筛选仅影响显示和导出，容量不足时淘汰完整旧条目。每条报错下方附有可展开的处理建议。",
    },
  },
};
